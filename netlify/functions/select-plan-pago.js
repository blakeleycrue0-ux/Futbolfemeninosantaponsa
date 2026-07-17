/*
  select-plan-pago.js — Netlify Function
  ============================================================================
  Escritura pública (solo POST) llamada desde registro.html al terminar el
  registro (la familia ya eligió el plan ahí mismo, junto con el resto de
  datos) — o, como red de seguridad, desde el selector de pago.html si por
  lo que sea todavía no hay plazos creados. Crea los plazos
  correspondientes en inscripcion_pagos. Usa la service_role key porque
  esa tabla solo permite INSERT/UPDATE a administradores según RLS.

  La cuota es distinta según la edad de la jugadora: 650 € hasta los 18
  años (incluidos), 450 € a partir de los 19 (categoría Amateur) — mismas
  3 opciones de pago (único / 2 / 4 cuotas) en los dos casos.

  Solo se permite si el club ya aceptó la plaza (confirmada_en) y ya pidió
  el pago (pago_solicitado_en) — evita que alguien con el id de una
  inscripción todavía pendiente de revisión pueda generar plazos de pago
  por su cuenta. Si esa inscripción ya tiene plazos (la familia ya había
  elegido plan antes), no hace nada y devuelve los que ya existen.

  Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");

const PLANES_MENOR = {
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

// Cuota Amateur (mayores de edad): 450 €.
const PLANES_AMATEUR = {
  unico: [{ numero_cuota: 1, importe: 450, fecha_vencimiento: "2026-07-01" }],
  "2_cuotas": [
    { numero_cuota: 1, importe: 225, fecha_vencimiento: "2026-07-01" },
    { numero_cuota: 2, importe: 225, fecha_vencimiento: "2026-10-01" },
  ],
  "4_cuotas": [
    { numero_cuota: 1, importe: 150, fecha_vencimiento: "2026-07-01" },
    { numero_cuota: 2, importe: 100, fecha_vencimiento: "2026-10-01" },
    { numero_cuota: 3, importe: 100, fecha_vencimiento: "2026-12-01" },
    { numero_cuota: 4, importe: 100, fecha_vencimiento: "2027-02-01" },
  ],
};

function esMayorDeEdad(fechaNacimiento) {
  if (!fechaNacimiento) return false;
  const nacimiento = new Date(fechaNacimiento + "T00:00:00Z");
  const hoy = new Date();
  let edad = hoy.getUTCFullYear() - nacimiento.getUTCFullYear();
  const noHaCumplidoAun =
    hoy.getUTCMonth() < nacimiento.getUTCMonth() ||
    (hoy.getUTCMonth() === nacimiento.getUTCMonth() && hoy.getUTCDate() < nacimiento.getUTCDate());
  if (noHaCumplidoAun) edad--;
  return edad >= 19;
}

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
  if (!inscripcion_id || !plan_pago) {
    return { statusCode: 400, body: "Falta inscripcion_id o plan_pago" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: inscripcion, error: insError } = await supabase
    .from("inscripciones")
    .select("id, jugadora_fecha_nacimiento, confirmada_en, pago_solicitado_en")
    .eq("id", inscripcion_id)
    .single();
  if (insError || !inscripcion) {
    return { statusCode: 404, body: "No se ha encontrado esa inscripción" };
  }
  if (!inscripcion.confirmada_en || !inscripcion.pago_solicitado_en) {
    return { statusCode: 403, body: "Esta inscripción todavía no está lista para elegir plan de pago" };
  }

  const planes = esMayorDeEdad(inscripcion.jugadora_fecha_nacimiento) ? PLANES_AMATEUR : PLANES_MENOR;
  const cuotas = planes[plan_pago];
  if (!cuotas) {
    return { statusCode: 400, body: "Ese plan de pago no está disponible" };
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
      body: JSON.stringify({ ok: true, pagos: existentes, ya_existia: true }),
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
    body: JSON.stringify({ ok: true, pagos, ya_existia: false }),
  };
};
