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
  const { convocatoria_id, token, respuesta } = payload;
  if (!convocatoria_id || !token || !["confirma", "rechaza"].includes(respuesta)) {
    return { statusCode: 400, body: "Faltan datos o la respuesta no es válida" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: player, error: playerError } = await supabase
    .from("players")
    .select("id")
    .eq("access_token", token)
    .single();
  if (playerError || !player) {
    return { statusCode: 404, body: "Enlace no válido" };
  }

  const { data: convocatoria, error: convError } = await supabase
    .from("convocatorias")
    .select("id, player_id")
    .eq("id", convocatoria_id)
    .single();
  if (convError || !convocatoria) {
    return { statusCode: 404, body: "No se ha encontrado esa convocatoria" };
  }
  if (convocatoria.player_id !== player.id) {
    return { statusCode: 403, body: "Esta convocatoria no corresponde a esta jugadora" };
  }

  const { error: updError } = await supabase
    .from("convocatorias")
    .update({ estado_asistencia: respuesta, respondido_en: new Date().toISOString() })
    .eq("id", convocatoria_id);
  if (updError) {
    return { statusCode: 500, body: "No se ha podido guardar la respuesta: " + updError.message };
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
};
