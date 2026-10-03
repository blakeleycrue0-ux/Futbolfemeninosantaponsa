/*
  Anula un acceso registrado por error (escaneo accidental, la persona no
  llegó a entrar, error del personal...). NUNCA borra el registro
  original — solo le añade el estado de anulación (ver anular_acceso() en
  schema.sql). El historial completo (concedido → anulado → concedido de
  nuevo) queda siempre visible en el registro de accesos.

  Tras la anulación, el índice único parcial de match_access_log deja
  hueco para que esa misma credencial se pueda volver a registrar en ese
  partido — ni antes ni después hay forma de que quede "a medias".

  Requiere Authorization: Bearer <access_token> de una cuenta admin o
  staff (tabla app_admins). La autorización se comprueba aquí, en el
  servidor — nunca basta con ocultar el botón "Anular" en la interfaz.
*/
const { createClient } = require("@supabase/supabase-js");
const { cuentaAutorizada } = require("./lib/match-access");

const MOTIVOS_VALIDOS = {
  accidental: "Escaneo accidental",
  no_entro: "La persona no llegó a entrar",
  error_personal: "Error del personal",
  otro: "Otro",
};

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }
  const { log_id, motivo, detalle } = payload;
  if (!log_id || !motivo || !MOTIVOS_VALIDOS[motivo]) {
    return { statusCode: 400, body: "Falta log_id o el motivo no es válido." };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return { statusCode: 401, body: "Inicia sesión." };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData || !userData.user) {
    return { statusCode: 401, body: "Sesión no válida." };
  }
  const staffEmail = userData.user.email;

  const staff = await cuentaAutorizada(supabase, staffEmail);
  if (!staff) {
    return { statusCode: 403, body: "Esta cuenta no tiene permiso para anular accesos." };
  }

  const { data: registro } = await supabase.from("match_access_log").select("id, reversed").eq("id", log_id).maybeSingle();
  if (!registro) {
    return { statusCode: 404, body: "No se ha encontrado ese acceso." };
  }
  if (registro.reversed) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, ya_estaba_anulado: true }),
    };
  }

  const razon = motivo === "otro" && detalle ? `Otro: ${detalle}` : MOTIVOS_VALIDOS[motivo];
  const { data: anulado, error: anularError } = await supabase.rpc("anular_acceso", {
    p_log_id: log_id,
    p_staff_email: staffEmail,
    p_motivo: razon,
  });

  if (anularError) {
    return { statusCode: 500, body: "No se ha podido anular el acceso: " + anularError.message };
  }
  if (!anulado) {
    return { statusCode: 409, body: "Ese acceso ya no se puede anular (puede que alguien se te haya adelantado)." };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
