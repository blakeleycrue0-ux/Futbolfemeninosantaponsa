/*
  stripe-webhook.js — Netlify Function
  ============================================================================
  Endpoint que Stripe llama directamente (no el navegador) cuando pasa algo
  en un pago: lo configuramos en el Dashboard de Stripe en Developers ->
  Webhooks -> Add endpoint, apuntando a:

    https://<tu-sitio>.netlify.app/.netlify/functions/stripe-webhook

  con el evento "checkout.session.completed" activado. Stripe firma cada
  petición; verificamos esa firma con STRIPE_WEBHOOK_SECRET antes de creer
  nada de lo que llega — así nadie puede llamar a este endpoint a mano y
  marcar una inscripción como pagada sin haber pagado de verdad.

  Al confirmarse un pago:
    1. Marca esa fila de `inscripcion_pagos` como 'pagado'.
    2. Recalcula el estado de la `inscripcion` completa: 'pagado' si todos
       los plazos están pagados, 'pago_parcial' si solo alguno.

  AVISO — lo que este fichero NO hace todavía:
    - No cobra automáticamente los plazos 2/3/4 de los planes fraccionados
      cuando llega su fecha (eso necesita una función programada aparte que
      cargue una tarjeta guardada o genere un nuevo enlace de pago).
    - No manda recordatorios por email el día antes de cada cobro (necesita
      un servicio de email conectado, p.ej. Resend o SendGrid).
  Ambas cosas quedan pendientes de una fase 2 explícitamente pedida por el
  club antes de construirlas, para no dar por hecho cómo debe funcionar
  algo que cuesta dinero real si se hace mal.

  Variables de entorno requeridas:
    STRIPE_SECRET_KEY
    STRIPE_WEBHOOK_SECRET       (el "signing secret" que da Stripe al crear
                                 el endpoint del webhook, empieza por whsec_)
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY
  ============================================================================
*/
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  const { STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  if (!STRIPE_SECRET_KEY || !STRIPE_WEBHOOK_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno" };
  }

  const stripe = Stripe(STRIPE_SECRET_KEY);
  const signature = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;

  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(rawBody, signature, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return { statusCode: 400, body: `Firma de webhook inválida: ${err.message}` };
  }

  if (stripeEvent.type !== "checkout.session.completed") {
    // No nos interesa este tipo de evento, pero respondemos 200 para que
    // Stripe no lo siga reintentando.
    return { statusCode: 200, body: "ignored" };
  }

  const session = stripeEvent.data.object;
  const { inscripcion_id, pago_id } = session.metadata || {};
  if (!pago_id || !inscripcion_id) {
    return { statusCode: 200, body: "sin metadata, ignorado" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  await supabase
    .from("inscripcion_pagos")
    .update({ estado: "pagado", stripe_payment_intent_id: session.payment_intent })
    .eq("id", pago_id);

  const { data: pagos } = await supabase
    .from("inscripcion_pagos")
    .select("estado")
    .eq("inscripcion_id", inscripcion_id);

  let nuevoEstado = "pendiente";
  if (pagos && pagos.length) {
    const todosPagados = pagos.every((p) => p.estado === "pagado");
    const algunoPagado = pagos.some((p) => p.estado === "pagado");
    nuevoEstado = todosPagados ? "pagado" : algunoPagado ? "pago_parcial" : "pendiente";
  }

  await supabase.from("inscripciones").update({ estado: nuevoEstado }).eq("id", inscripcion_id);

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ received: true }) };
};
