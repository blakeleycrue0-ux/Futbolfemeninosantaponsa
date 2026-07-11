/*
  get-pago.js — Netlify Function
  ============================================================================
  Lectura pública (solo GET) de UN plazo de pago por su id, para que
  pago.html pueda mostrar "vas a pagar la cuota X de [jugadora]: Y €" antes
  de crear la sesión de Stripe. Usa la service_role key porque
  `inscripcion_pagos` solo permite SELECT a administradores según RLS — el
  id del plazo (uuid) hace de token de acceso de facto para esa familia.
  No devuelve nada del resto de inscripciones ni de otras familias.

  Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
  }

  const pagoId = event.queryStringParameters && event.queryStringParameters.id;
  if (!pagoId) {
    return { statusCode: 400, body: "Falta id" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: pago, error } = await supabase
    .from("inscripcion_pagos")
    .select("id, numero_cuota, importe, estado, fecha_vencimiento, inscripciones(jugadora_nombre)")
    .eq("id", pagoId)
    .single();

  if (error || !pago) {
    return { statusCode: 404, body: "No se ha encontrado ese plazo de pago" };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: pago.id,
      numero_cuota: pago.numero_cuota,
      importe: pago.importe,
      estado: pago.estado,
      fecha_vencimiento: pago.fecha_vencimiento,
      jugadora_nombre: pago.inscripciones ? pago.inscripciones.jugadora_nombre : "",
    }),
  };
};
