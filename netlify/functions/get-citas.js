/*
  get-citas.js — Netlify Function
  ============================================================================
  Lectura pública (solo GET) llamada desde citas.html para mostrar los
  huecos de una categoría (probarse la equipación) y cuáles ya están
  reservados. Usa la service_role key a propósito: citas_horario no tiene
  política de lectura pública en Supabase, así que esta función es el
  único sitio por el que se puede ver la disponibilidad — y solo devuelve
  fecha/hora/disponible, nunca el nombre o email de quien ha reservado
  cada hora (eso solo lo ve el admin).

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
