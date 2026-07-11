/*
  get-registro.js — Netlify Function
  ============================================================================
  Lectura pública (solo GET) de los datos básicos de UNA inscripción por su
  id, para que registro.html pueda mostrar "Hola, completa el registro de
  [jugadora]" antes de rellenar el resto de datos. Usa la service_role key
  porque `inscripciones` solo permite SELECT a administradores según RLS —
  el id (uuid) hace de token de acceso de facto para esa familia, igual que
  en get-pago.js. No devuelve nada del resto de familias.

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
    .select("jugadora_nombre, tutor_email, confirmada_en, registro_completado_en")
    .eq("id", id)
    .single();

  if (error || !inscripcion) {
    return { statusCode: 404, body: "No se ha encontrado ese registro" };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jugadora_nombre: inscripcion.jugadora_nombre,
      tutor_email: inscripcion.tutor_email,
      confirmada_en: inscripcion.confirmada_en,
      registro_completado_en: inscripcion.registro_completado_en,
    }),
  };
};
