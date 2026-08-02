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

  const nombre = (payload.nombre || "").trim();
  const fechaNacimiento = (payload.fecha_nacimiento || "").trim();
  if (!nombre || !fechaNacimiento) {
    return { statusCode: 400, body: "Faltan nombre o fecha de nacimiento" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await supabase
    .from("inscripciones")
    .select("jugadora_nombre, estado")
    .ilike("jugadora_nombre", nombre)
    .eq("jugadora_fecha_nacimiento", fechaNacimiento)
    .order("creado_en", { ascending: false })
    .limit(1);

  if (error) {
    return { statusCode: 500, body: "No se ha podido comprobar la inscripción: " + error.message };
  }

  const inscripcion = data && data[0];
  if (!inscripcion) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, eligible: false, motivo: "no_encontrada" }),
    };
  }

  const eligible = inscripcion.estado === "pagado" || inscripcion.estado === "pago_parcial";

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      eligible,
      motivo: eligible ? null : "pago_pendiente",
      jugadora_nombre: inscripcion.jugadora_nombre,
    }),
  };
};
