/*
  get-pago-inscripcion.js — Netlify Function
  ============================================================================
  Lectura pública (solo GET) del estado de pago de UNA inscripción por su
  id, para que pago.html sepa si ya hay un plan elegido (y qué plazos
  tiene) o si tiene que mostrar el selector de plan. Usa la service_role
  key porque inscripciones/inscripcion_pagos solo permiten SELECT a
  administradores según RLS — el id de la inscripción (uuid) hace de
  token de acceso de facto para esa familia, igual que en get-pago.js y
  get-registro.js. No devuelve nada del resto de familias.

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

  const id = event.queryStringParameters && event.queryStringParameters.id;
  if (!id) {
    return { statusCode: 400, body: "Falta id" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: inscripcion, error } = await supabase
    .from("inscripciones")
    .select("jugadora_nombre, jugadora_fecha_nacimiento, confirmada_en, pago_solicitado_en")
    .eq("id", id)
    .single();
  if (error || !inscripcion) {
    return { statusCode: 404, body: "No se ha encontrado esa inscripción" };
  }

  const { data: pagos } = await supabase
    .from("inscripcion_pagos")
    .select("id, numero_cuota, importe, estado, fecha_vencimiento, comprobante_url, comprobante_subido_en")
    .eq("inscripcion_id", id)
    .order("numero_cuota");

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jugadora_nombre: inscripcion.jugadora_nombre,
      jugadora_fecha_nacimiento: inscripcion.jugadora_fecha_nacimiento,
      confirmada_en: inscripcion.confirmada_en,
      pago_solicitado_en: inscripcion.pago_solicitado_en,
      pagos: pagos || [],
    }),
  };
};
