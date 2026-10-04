/*
  Webhook de Stripe: aquí y solo aquí se confirma un pago de verdad y se
  emite la membresía/entrada correspondiente. La redirección de "éxito" del
  navegador (compra-completada.html) nunca activa nada por sí misma — solo
  consulta si este webhook ya ha marcado el pedido como pagado.

  Idempotencia: por ESTADO, no por evento. stripe_webhook_events solo se usa
  para tener un registro (nunca bloquea el reprocesado). Antes de crear la
  membership/ticket/credencial se comprueba si ya existen para ese pedido —
  así, si Stripe reintenta el mismo evento, o si lo reenvías a mano desde el
  dashboard porque algo falló a mitad la primera vez, la función retoma por
  donde se quedó en vez de no hacer nada. La primera versión marcaba el
  evento como "procesado" nada más entrar, así que un fallo a mitad de
  camino (p.ej. al crear la credencial) dejaba el pedido pagado y con
  membership pero sin credencial para siempre, porque los reintentos de
  Stripe se cortaban en seco en ese primer insert.
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

  // Solo registro/auditoría — nunca decide si se procesa o no.
  await supabase.from("stripe_webhook_events").upsert(
    { event_id: stripeEvent.id },
    { onConflict: "event_id", ignoreDuplicates: true }
  );

  if (stripeEvent.type === "checkout.session.completed") {
    const session = stripeEvent.data.object;
    const shopOrderId = session.metadata && session.metadata.shop_order_id;
    if (shopOrderId) {
      // Pedido de la tienda (merchandising) — rama totalmente aparte de la
      // de socios/entradas de abajo: aquí solo se marca "pagado", no se
      // emite ninguna credencial (la recogida es en persona en el club,
      // sin QR ni control de acceso).
      await supabase
        .from("shop_orders")
        .update({
          estado: "pagado",
          stripe_payment_intent_id: session.payment_intent || null,
          actualizado_en: new Date().toISOString(),
        })
        .eq("id", shopOrderId)
        .eq("estado", "pendiente");
      return { statusCode: 200, body: "ok" };
    }

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

    const product = order.ticket_products;

    if (order.estado !== "pagado") {
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
      // deliberada para ese caso límite, no un fallo. Solo se reserva la
      // primera vez que se marca pagado, para no incrementar dos veces si
      // esto se reprocesa.
      if (product.capacity != null) {
        await supabase.rpc("reservar_aforo", { p_product_id: product.id });
      }
    }

    // A partir de aquí, "ya existe" (no "ya se procesó el evento") es lo
    // único que decide si se crea algo — así un reintento de Stripe o un
    // reenvío manual desde el dashboard siempre puede completar lo que
    // faltara, en vez de darse por hecho con solo marcar el pedido pagado.
    let credencialMembershipId = null;
    let credencialTicketId = null;

    if (product.tipo === "socio" || product.tipo === "abono") {
      const { data: existente } = await supabase.from("memberships").select("id").eq("order_id", order.id).maybeSingle();
      if (existente) {
        credencialMembershipId = existente.id;
      } else {
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
      }
    } else if (product.tipo === "entrada") {
      const { data: existente } = await supabase.from("tickets").select("id").eq("order_id", order.id).maybeSingle();
      if (existente) {
        credencialTicketId = existente.id;
      } else {
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
    }

    if (credencialMembershipId || credencialTicketId) {
      const { data: credencialExistente } = credencialMembershipId
        ? await supabase.from("access_credentials").select("id").eq("membership_id", credencialMembershipId).maybeSingle()
        : await supabase.from("access_credentials").select("id").eq("ticket_id", credencialTicketId).maybeSingle();
      if (!credencialExistente) {
        await supabase.from("access_credentials").insert({
          token: generarToken(),
          membership_id: credencialMembershipId,
          ticket_id: credencialTicketId,
        });
      }
    }
  } else if (stripeEvent.type === "checkout.session.expired") {
    const session = stripeEvent.data.object;
    const shopOrderId = session.metadata && session.metadata.shop_order_id;
    if (shopOrderId) {
      await supabase.from("shop_orders").update({ estado: "cancelado" }).eq("id", shopOrderId).eq("estado", "pendiente");
    }
    const orderId = session.metadata && session.metadata.order_id;
    if (orderId) {
      await supabase.from("orders").update({ estado: "cancelado" }).eq("id", orderId).eq("estado", "pendiente");
    }
  }

  return { statusCode: 200, body: "ok" };
};
