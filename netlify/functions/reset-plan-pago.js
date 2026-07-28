const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase" };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { statusCode: 401, body: "Falta iniciar sesión" };
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: isAdmin, error: adminError } = await authClient.rpc("is_app_admin");
  if (adminError || !isAdmin) {
    return { statusCode: 403, body: "No tienes permiso de administrador" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }
  const { inscripcion_id } = payload;
  if (!inscripcion_id) {
    return { statusCode: 400, body: "Falta inscripcion_id" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: pagos, error: pagosError } = await supabase
    .from("inscripcion_pagos")
    .select("id, estado")
    .eq("inscripcion_id", inscripcion_id);
  if (pagosError) {
    return { statusCode: 500, body: "No se han podido comprobar los plazos: " + pagosError.message };
  }
  if (!pagos || !pagos.length) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, borrados: 0 }) };
  }
  if (pagos.some((p) => p.estado === "pagado")) {
    return { statusCode: 409, body: "Esta inscripción ya tiene alguna cuota pagada — no se puede reiniciar el plan automáticamente. Escríbenos si hace falta corregirlo." };
  }

  const { error: delError } = await supabase.from("inscripcion_pagos").delete().eq("inscripcion_id", inscripcion_id);
  if (delError) {
    return { statusCode: 500, body: "No se han podido borrar los plazos: " + delError.message };
  }

  await supabase.from("inscripciones").update({ plan_pago: null, cuota_total: null }).eq("id", inscripcion_id);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, borrados: pagos.length }),
  };
};
