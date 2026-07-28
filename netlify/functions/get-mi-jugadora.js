const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
  }

  const token = (event.queryStringParameters || {}).token;
  if (!token) {
    return { statusCode: 400, body: "Falta token" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: player, error: playerError } = await supabase
    .from("players")
    .select("id, nombre, dorsal, posicion, foto_url, team_id, teams(nombre, categoria)")
    .eq("access_token", token)
    .single();
  if (playerError || !player) {
    return { statusCode: 404, body: "No se ha encontrado ninguna jugadora con este enlace" };
  }

  const { data: convocatorias, error: convError } = await supabase
    .from("convocatorias")
    .select("id, match_id, training_id, estado_asistencia, respondido_en, creado_en")
    .eq("player_id", player.id)
    .order("creado_en", { ascending: false });
  if (convError) {
    return { statusCode: 500, body: "No se han podido cargar las convocatorias: " + convError.message };
  }

  const matchIds = (convocatorias || []).map((c) => c.match_id).filter(Boolean);
  const trainingIds = (convocatorias || []).map((c) => c.training_id).filter(Boolean);

  const [{ data: matches }, { data: trainings }] = await Promise.all([
    matchIds.length
      ? supabase.from("matches").select("id, rival, fecha, hora, campo, condicion, estado").in("id", matchIds)
      : Promise.resolve({ data: [] }),
    trainingIds.length
      ? supabase.from("training_sessions").select("id, fecha, hora, lugar, notas").in("id", trainingIds)
      : Promise.resolve({ data: [] }),
  ]);

  const matchesById = Object.fromEntries((matches || []).map((m) => [m.id, m]));
  const trainingsById = Object.fromEntries((trainings || []).map((t) => [t.id, t]));

  const convocatoriasResueltas = (convocatorias || []).map((c) => {
    if (c.match_id) {
      const m = matchesById[c.match_id] || {};
      return {
        id: c.id,
        tipo: "partido",
        estado_asistencia: c.estado_asistencia,
        respondido_en: c.respondido_en,
        fecha: m.fecha,
        hora: m.hora,
        lugar: m.campo,
        rival: m.rival,
        condicion: m.condicion,
        evento_estado: m.estado,
      };
    }
    const t = trainingsById[c.training_id] || {};
    return {
      id: c.id,
      tipo: "entreno",
      estado_asistencia: c.estado_asistencia,
      respondido_en: c.respondido_en,
      fecha: t.fecha,
      hora: t.hora,
      lugar: t.lugar,
      notas: t.notas,
    };
  }).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));

  const { data: pagosExtra, error: pagosError } = await supabase
    .from("pagos_extra")
    .select("id, concepto, importe, fecha_vencimiento, estado, comprobante_url, comprobante_subido_en")
    .eq("player_id", player.id)
    .order("creado_en", { ascending: false });
  if (pagosError) {
    return { statusCode: 500, body: "No se han podido cargar los pagos: " + pagosError.message };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      player: {
        id: player.id,
        nombre: player.nombre,
        dorsal: player.dorsal,
        posicion: player.posicion,
        foto_url: player.foto_url,
        equipo: player.teams ? player.teams.nombre : null,
        categoria: player.teams ? player.teams.categoria : null,
      },
      convocatorias: convocatoriasResueltas,
      pagos_extra: pagosExtra || [],
    }),
  };
};
