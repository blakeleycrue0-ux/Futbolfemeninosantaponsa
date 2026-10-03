/*
  Alta manual de acceso: para cuando el QR falla (pantalla rota, poca luz,
  cámara estropeada, cobertura mala...) pero la persona tiene un carné o
  entrada válidos. Busca primero con buscar-persona.js, y llama a esta
  Function con el resultado elegido.

  IMPORTANTE: pasa por las MISMAS reglas de elegibilidad que el escáner
  (evaluarCredencial, en lib/match-access.js) — un alta manual nunca
  puede saltarse "partido equivocado", "carné no activo" o "entrada ya
  usada". Si existiera alguna vez una anulación de esas reglas, tendría
  que ser explícita y quedar auditada, no un efecto colateral de este
  endpoint.

  Requiere Authorization: Bearer <access_token> de una cuenta admin o
  staff.
*/
const { createClient } = require("@supabase/supabase-js");
const { cuentaAutorizada, evaluarCredencial } = require("./lib/match-access");

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
  const { tipo, id, match_id } = payload;
  if (!tipo || !id || !match_id || !["socio", "entrada"].includes(tipo)) {
    return { statusCode: 400, body: "Falta tipo, id o match_id." };
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
    return { statusCode: 403, body: "Esta cuenta no tiene permiso para registrar accesos." };
  }

  function respuesta(resultado, extra) {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ resultado }, extra)) };
  }

  const columna = tipo === "socio" ? "membership_id" : "ticket_id";
  const { data: credencial } = await supabase.from("access_credentials").select("*").eq(columna, id).maybeSingle();
  if (!credencial) {
    return respuesta("INVALIDO", { motivo: "No se ha encontrado una credencial para esa persona." });
  }

  const { valida, motivo, etiqueta } = await evaluarCredencial(supabase, credencial, match_id);
  if (!valida) {
    return respuesta("INVALIDO", { motivo, etiqueta });
  }

  const { data: registro, error: registroError } = await supabase
    .rpc("registrar_acceso", {
      p_credential_id: credencial.id,
      p_match_id: match_id,
      p_staff_email: staffEmail,
      p_metodo: "manual",
    })
    .single();

  if (registroError || !registro) {
    return respuesta("INVALIDO", { motivo: "No se ha podido registrar el acceso. Inténtalo de nuevo.", etiqueta });
  }

  if (registro.resultado === "VALIDO") {
    return respuesta("VALIDO", { etiqueta, hora: registro.scanned_at, log_id: registro.log_id });
  }

  return respuesta("YA_USADO", { etiqueta, hora_original: registro.scanned_at, log_id: registro.log_id });
};
