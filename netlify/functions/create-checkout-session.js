/*
  create-checkout-session.js — Netlify Function
  ============================================================================
  Llamada desde inscripcion.html justo después de guardar la inscripción en
  Supabase. Recibe el id de UNA fila de `inscripcion_pagos` (el primer plazo
  a cobrar), crea una Stripe Checkout Session por el importe exacto de ESE
  plazo (nunca confía en un importe que venga del navegador) y devuelve la
  URL de Stripe a la que el navegador debe redirigir.

  El resto de plazos (cuota 2, 3, 4 de los planes fraccionados) NO se cobran
  aquí — hoy no hay ninguna función que los cobre automáticamente más
  adelante. Hace falta una función programada (cron) que, cerca de cada
  fecha de vencimiento, cree una nueva Checkout Session o cargue la tarjeta
  guardada. Ver el aviso en stripe-webhook.js.

  Variables de entorno requeridas:
    STRIPE_SECRET_KEY
    SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY   (clave de servicio: esta función necesita
                                 leer `inscripcion_pagos`, que solo admin
                                 puede leer según las políticas RLS)
    URL                          (la inyecta Netlify automáticamente con la
                                 URL pública del sitio; no hace falta
                                 configurarla a mano)
  ============================================================================
*/
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { STRIPE_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PUBLIC_SITE_URL, URL: SITE_URL } = process.env;
  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno (STRIPE_SECRET_KEY / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }
  const { pago_id } = payload;
  if (!pago_id) {
    return { statusCode: 400, body: "Falta pago_id" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: pago, error } = await supabase
    .from("inscripcion_pagos")
    .select("*, inscripciones(jugadora_nombre, tutor_email)")
    .eq("id", pago_id)
    .single();

  if (error || !pago) {
    return { statusCode: 404, body: "No se ha encontrado ese plazo de pago" };
  }
  if (pago.estado === "pagado") {
    return { statusCode: 400, body: "Este plazo ya está pagado" };
  }
  if (!pago.importe || pago.importe <= 0) {
    return { statusCode: 400, body: "Este plazo no tiene un importe válido" };
  }

  const stripe = Stripe(STRIPE_SECRET_KEY);
  const baseUrl = PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info";
  const jugadoraNombre = pago.inscripciones ? pago.inscripciones.jugadora_nombre : "";
  const tutorEmail = pago.inscripciones ? pago.inscripciones.tutor_email : undefined;

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: tutorEmail,
    line_items: [
      {
        price_data: {
          currency: "eur",
          unit_amount: Math.round(pago.importe * 100),
          product_data: {
            name: `Cuota temporada 2026/27 · Fútbol Femenino Santa Ponça (plazo ${pago.numero_cuota})`,
            description: jugadoraNombre ? `Jugadora: ${jugadoraNombre}` : undefined,
          },
        },
        quantity: 1,
      },
    ],
    metadata: {
      inscripcion_id: pago.inscripcion_id,
      pago_id: pago.id,
      numero_cuota: String(pago.numero_cuota),
    },
    success_url: `${baseUrl}/pago.html?id=${pago.id}&resultado=exito`,
    cancel_url: `${baseUrl}/pago.html?id=${pago.id}&resultado=cancelado`,
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: session.url }),
  };
};
