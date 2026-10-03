/*
  Webhook de Stripe: aquí y solo aquí se confirma un pago de verdad y se
  emite la membresía/entrada correspondiente. La redirección de "éxito" del
  navegador (compra-completada.html) nunca activa nada por sí misma — solo
  consulta si este webhook ya ha marcado el pedido como pagado.

  Idempotencia: cada event.id de Stripe se inserta una sola vez en
  stripe_webhook_events (clave primaria) — si Stripe reenvía el mismo
  evento (puede pasar), el conflicto de clave primaria hace que no se
  vuelva a procesar ni se emita una segunda membresía/entrada.
*/
const { createClient } = require("@supabase/supabase-js");
const Stripe = require("stripe");
const crypto = require("crypto");

function generarToken() {
  return "SPFC1-" + crypto.randomBytes(24).toString("base64url");
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase/Stripe" };
  }

  const stripe = Stripe(STRIPE_SECRET_KEY);
  const sig = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body || "", "utf8");

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return { statusCode: 400, body: "Firma de webhook inválida: " + err.message };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Idempotencia: si este evento ya se procesó, salimos ya — sin tocar nada.
  const { error: eventoYaExisteError } = await supabase
    .from("stripe_webhook_events")
    .insert({ event_id: stripeEvent.id });
  if (eventoYaExisteError) {
    // Violación de clave primaria = evento repetido, no es un fallo real.
    return { statusCode: 200, body: "Evento ya procesado anteriormente." };
  }

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const orderId = session.metadata && session.metadata.order_id;
    if (!orderId) {
      return { statusCode: 200, body: "Sesión sin order_id en metadata, ignorada." };
    }

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("*, ticket_products(*)")
      .eq("id", orderId)
      .single();
    if (orderError || !order) {
      return { statusCode: 200, body: "Pedido no encontrado, ignorado." };
    }
    if (order.estado === "pagado") {
      return { statusCode: 200, body: "Pedido ya estaba pagado." };
    }

    const product = order.ticket_products;

    await supabase
      .from("orders")
      .update({
        estado: "pagado",
        stripe_payment_intent_id: session.payment_intent || null,
        actualizado_en: new Date().toISOString(),
      })
      .eq("id", order.id);

    // Aforo: el incremento real (capacity_sold = capacity_sold + 1) lo hace
    // la función reservar_aforo() dentro de la misma instrucción SQL — así
    // sí es atómico de verdad incluso con dos webhooks casi simultáneos
    // (ver el comentario de la función en schema.sql). Si ya no quedaba
    // aforo, el pago ya se ha cobrado de todas formas (Stripe ya lo ha
    // confirmado), así que se emite la entrada igualmente en vez de dejar
    // a alguien que ya ha pagado sin nada — es una decisión de negocio
    // deliberada para ese caso límite, no un fallo.
    if (product.capacity != null) {
      await supabase.rpc("reservar_aforo", { p_product_id: product.id });
    }

    let credencialMembershipId = null;
    let credencialTicketId = null;

    if (product.tipo === "socio" || product.tipo === "abono") {
      const { data: membership } = await supabase
        .from("memberships")
        .insert({
          order_id: order.id,
          user_id: order.user_id,
          product_id: product.id,
          temporada: product.temporada,
          team_id: product.team_id,
        })
        .select()
        .single();
      if (membership) credencialMembershipId = membership.id;
    } else if (product.tipo === "entrada") {
      const { data: ticket } = await supabase
        .from("tickets")
        .insert({
          order_id: order.id,
          user_id: order.user_id,
          match_id: product.match_id,
        })
        .select()
        .single();
      if (ticket) credencialTicketId = ticket.id;
    }

    if (credencialMembershipId || credencialTicketId) {
      await supabase.from("access_credentials").insert({
        token: generarToken(),
        membership_id: credencialMembershipId,
        ticket_id: credencialTicketId,
      });
    }
  } else if (stripeEvent.type === "checkout.session.expired") {
    const session = stripeEvent.data.object;
    const orderId = session.metadata && session.metadata.order_id;
    if (orderId) {
      await supabase.from("orders").update({ estado: "cancelado" }).eq("id", orderId).eq("estado", "pendiente");
    }
  }

  return { statusCode: 200, body: "ok" };
};
