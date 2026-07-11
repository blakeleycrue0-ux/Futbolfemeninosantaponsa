/*
  select-plan-pago.js — Netlify Function
  ============================================================================
  Escritura pública (solo POST) llamada desde pago.html la primera vez que
  la familia abre su enlace de pago y elige un plan (único / 2 / 4 cuotas).
  Crea los plazos correspondientes en inscripcion_pagos. Usa la
  service_role key porque esa tabla solo permite INSERT/UPDATE a
  administradores según RLS.

  Solo se permite si el club ya aceptó la plaza (confirmada_en) y ya pidió
  el pago (pago_solicitado_en) — evita que alguien con el id de una
  inscripción todavía pendiente de revisión pueda generar plazos de pago
  por su cuenta. Si esa inscripción ya tiene plazos (la familia ya había
  elegido plan antes), no hace nada y devuelve los que ya existen.

  Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");

const PLAN_CUOTAS = {
  unico: [{ numero_cuota: 1, importe: 650, fecha_vencimiento: "2026-07-01" }],
  "2_cuotas": [
    { numero_cuota: 1, importe: 325, fecha_vencimiento: "2026-07-01" },
    { numero_cuota: 2, importe: 325, fecha_vencimiento: "2026-10-01" },
  ],
  "4_cuotas": [
    { numero_cuota: 1, importe: 245, fecha_vencimiento: "2026-07-01" },
    { numero_cuota: 2, importe: 135, fecha_vencimiento: "2026-10-01" },
    { numero_cuota: 3, importe: 135, fecha_vencimiento: "2026-12-01" },
    { numero_cuota: 4, importe: 135, fecha_vencimiento: "2027-02-01" },
  ],
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }
  const { inscripcion_id, plan_pago } = payload;
  const cuotas = PLAN_CUOTAS[plan_pago];
  if (!inscripcion_id || !cuotas) {
    return { statusCode: 400, body: "Falta inscripcion_id o plan_pago no válido" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: inscripcion, error: insError } = await supabase
    .from("inscripciones")
    .select("id, confirmada_en, pago_solicitado_en")
    .eq("id", inscripcion_id)
    .single();
  if (insError || !inscripcion) {
    return { statusCode: 404, body: "No se ha encontrado esa inscripción" };
  }
  if (!inscripcion.confirmada_en || !inscripcion.pago_solicitado_en) {
    return { statusCode: 403, body: "Esta inscripción todavía no está lista para elegir plan de pago" };
  }

  const { data: existentes, error: existentesError } = await supabase
    .from("inscripcion_pagos")
    .select("*")
    .eq("inscripcion_id", inscripcion_id)
    .order("numero_cuota");
  if (existentesError) {
    return { statusCode: 500, body: "No se ha podido comprobar los plazos existentes: " + existentesError.message };
  }
  if (existentes && existentes.length) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, pagos: existentes }),
    };
  }

  const { data: pagos, error: insertError } = await supabase
    .from("inscripcion_pagos")
    .insert(cuotas.map((c) => Object.assign({}, c, { inscripcion_id })))
    .select()
    .order("numero_cuota");
  if (insertError || !pagos || !pagos.length) {
    return { statusCode: 500, body: "No se han podido crear los plazos de pago: " + (insertError ? insertError.message : "") };
  }

  await supabase
    .from("inscripciones")
    .update({ plan_pago, cuota_total: cuotas.reduce((sum, c) => sum + c.importe, 0) })
    .eq("id", inscripcion_id);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, pagos }),
  };
};
