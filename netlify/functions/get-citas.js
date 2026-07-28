const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
  }

  const categoria = (event.queryStringParameters || {}).categoria;
  if (!categoria) {
    return { statusCode: 400, body: "Falta categoria" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from("citas_horario")
    .select("id, fecha, hora, duracion_min, disponible")
    .eq("categoria", categoria)
    .order("fecha")
    .order("hora");
  if (error) {
    return { statusCode: 500, body: "No se han podido cargar los horarios: " + error.message };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, citas: data || [] }),
  };
};
