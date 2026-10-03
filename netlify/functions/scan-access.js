/*
  Valida una credencial (QR) en la puerta del campo. Único sitio donde se
  decide si un acceso es válido — el scanner del móvil nunca decide nada
  por sí mismo, solo manda el token leído y el partido elegido.

  Anti-doble-uso / concurrencia: el "insert" en match_access_log se hace
  con upsert({ ignoreDuplicates: true }) sobre la clave única
  (credential_id, match_id) — si dos escaneos del mismo QR para el mismo
  partido llegan a la vez, como mucho uno de los dos puede insertar la
  fila; es Postgres el que lo garantiza con una sola instrucción, no hace
  falta ningún lock a mano.

  Requiere Authorization: Bearer <access_token> de una cuenta admin o
  staff (tabla app_admins, cualquier rol).
*/
const { createClient } = require("@supabase/supabase-js");

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
  const { token, match_id } = payload;
  if (!token || !match_id) {
    return { statusCode: 400, body: "Falta token o match_id" };
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

  const { data: staffRow } = await supabase.from("app_admins").select("email").ilike("email", staffEmail).maybeSingle();
  if (!staffRow) {
    return { statusCode: 403, body: "Esta cuenta no tiene acceso al escáner." };
  }

  function respuesta(resultado, extra) {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ resultado }, extra)) };
  }

  const { data: credencial } = await supabase.from("access_credentials").select("*").eq("token", token).maybeSingle();
  if (!credencial) {
    return respuesta("INVALIDO", { motivo: "Código no reconocido." });
  }

  let etiqueta, credencialValida = false, motivoInvalido = "";

  if (credencial.membership_id) {
    const { data: membership } = await supabase
      .from("memberships")
      .select("*, ticket_products(nombre)")
      .eq("id", credencial.membership_id)
      .single();
    const { data: match } = await supabase.from("matches").select("team_id").eq("id", match_id).single();
    etiqueta = `${membership.ticket_products.nombre} · Nº ${String(membership.member_number).padStart(4, "0")}`;
    if (membership.estado !== "activa") {
      motivoInvalido = "Esta membresía está cancelada.";
    } else if (membership.team_id && match && membership.team_id !== match.team_id) {
      motivoInvalido = "Esta membresía no da acceso a este partido (otro equipo).";
    } else {
      credencialValida = true;
    }
  } else if (credencial.ticket_id) {
    const { data: ticket } = await supabase.from("tickets").select("*, matches(rival)").eq("id", credencial.ticket_id).single();
    etiqueta = `Entrada vs ${ticket.matches.rival}`;
    if (ticket.estado !== "valido") {
      motivoInvalido = "Esta entrada está cancelada o reembolsada.";
    } else if (ticket.match_id !== match_id) {
      motivoInvalido = "Esta entrada es para otro partido.";
    } else {
      credencialValida = true;
    }
  } else {
    motivoInvalido = "Credencial sin membresía ni entrada asociada.";
  }

  if (!credencialValida) {
    return respuesta("INVALIDO", { motivo: motivoInvalido, etiqueta });
  }

  const { data: insertado } = await supabase
    .from("match_access_log")
    .upsert({ credential_id: credencial.id, match_id, staff_email: staffEmail }, { onConflict: "credential_id,match_id", ignoreDuplicates: true })
    .select();

  if (insertado && insertado.length) {
    return respuesta("VALIDO", { etiqueta, hora: insertado[0].scanned_at });
  }

  const { data: existente } = await supabase
    .from("match_access_log")
    .select("scanned_at")
    .eq("credential_id", credencial.id)
    .eq("match_id", match_id)
    .single();

  return respuesta("YA_USADO", { etiqueta, hora_original: existente ? existente.scanned_at : null });
};
