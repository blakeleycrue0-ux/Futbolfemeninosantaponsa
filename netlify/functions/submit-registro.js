/*
  submit-registro.js — Netlify Function
  ============================================================================
  Escritura pública (solo POST) de los datos de registro completo (DNI,
  dirección, talla, segundo tutor/a, email verificado) de UNA inscripción,
  llamada desde registro.html — la página que llega enlazada solo en el
  email de "plaza confirmada" (confirm-inscripcion.js), no antes.

  Usa la service_role key porque `inscripciones` solo permite UPDATE a
  administradores según RLS. Para evitar que cualquiera con el id pueda
  reescribir una inscripción todavía pendiente de revisión, solo se permite
  completar el registro si confirmada_en ya está informado.

  Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");

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

  const { id, tutor_email, tutor_email_confirm } = payload;
  if (!id) {
    return { statusCode: 400, body: "Falta id" };
  }
  if (!tutor_email || !tutor_email_confirm || tutor_email.trim().toLowerCase() !== tutor_email_confirm.trim().toLowerCase()) {
    return { statusCode: 400, body: "Los dos correos electrónicos no coinciden" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: inscripcion, error: fetchError } = await supabase
    .from("inscripciones")
    .select("id, confirmada_en")
    .eq("id", id)
    .single();
  if (fetchError || !inscripcion) {
    return { statusCode: 404, body: "No se ha encontrado ese registro" };
  }
  if (!inscripcion.confirmada_en) {
    return { statusCode: 403, body: "Todavía no se ha confirmado la plaza de esta familia" };
  }

  const update = {
    jugadora_dni: (payload.jugadora_dni || "").trim() || null,
    talla_equipacion: payload.talla_equipacion || null,
    direccion: (payload.direccion || "").trim() || null,
    poblacion: (payload.poblacion || "").trim() || null,
    codigo_postal: (payload.codigo_postal || "").trim() || null,
    tutor_dni: (payload.tutor_dni || "").trim() || null,
    tutor_email: tutor_email.trim(),
    tutor2_nombre: (payload.tutor2_nombre || "").trim() || null,
    tutor2_dni: (payload.tutor2_dni || "").trim() || null,
    tutor2_telefono: (payload.tutor2_telefono || "").trim() || null,
    tutor2_email: (payload.tutor2_email || "").trim() || null,
    imagen_redes_sociales: payload.imagen_redes_sociales === true,
    imagen_web: payload.imagen_web === true,
    imagen_prensa: payload.imagen_prensa === true,
    imagen_material_promocional: payload.imagen_material_promocional === true,
    registro_completado_en: new Date().toISOString(),
  };

  const { error: updateError } = await supabase.from("inscripciones").update(update).eq("id", id);
  if (updateError) {
    return { statusCode: 500, body: "No se ha podido guardar: " + updateError.message };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
