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
    .select("jugadora_nombre, jugadora_fecha_nacimiento, tutor_email, confirmada_en, registro_completado_en")
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
      jugadora_fecha_nacimiento: inscripcion.jugadora_fecha_nacimiento,
      tutor_email: inscripcion.tutor_email,
      confirmada_en: inscripcion.confirmada_en,
      registro_completado_en: inscripcion.registro_completado_en,
    }),
  };
};
