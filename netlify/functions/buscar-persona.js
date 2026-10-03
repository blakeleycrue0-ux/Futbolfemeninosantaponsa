/*
  Búsqueda unificada de socios/entradas para el escáner y el admin:
  "BUSCAR PERSONA O ENTRADA" por nombre, número de socio o id de entrada.
  Necesita cruzar con auth.users (nombre/email), que la API pública de
  Supabase no expone — de ahí que pase por la función buscar_persona()
  (security definer) en vez de una consulta directa desde el cliente.

  El email solo se incluye en la respuesta si quien pregunta es admin —
  el personal de la puerta (staff) no necesita ver el email de nadie
  para hacer su trabajo.

  Si se manda match_id, cada resultado incluye si esa persona ya tiene
  acceso registrado (sin anular) para ESE partido en concreto — así el
  staff ve "DENTRO · 10:42" o "No ha accedido" al buscar.

  Requiere Authorization: Bearer <access_token> de una cuenta admin o
  staff.
*/
const { createClient } = require("@supabase/supabase-js");
const { cuentaAutorizada } = require("./lib/match-access");

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
  const q = (payload.q || "").trim();
  const matchId = payload.match_id || null;
  if (q.length < 2) {
    return { statusCode: 400, body: "Escribe al menos 2 caracteres." };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return { statusCode: 401, body: "Inicia sesión." };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData || !userData.user) {
    return { statusCode: 401, body: "Sesión no válida." };
  }

  const staff = await cuentaAutorizada(supabase, userData.user.email);
  if (!staff) {
    return { statusCode: 403, body: "Esta cuenta no tiene permiso para buscar." };
  }
  const esAdmin = staff.role === "admin";

  const { data: resultados, error: buscarError } = await supabase.rpc("buscar_persona", { p_query: q });
  if (buscarError) {
    return { statusCode: 500, body: "No se ha podido buscar: " + buscarError.message };
  }

  const enriquecidos = await Promise.all((resultados || []).map(async (r) => {
    const fila = {
      tipo: r.tipo,
      id: r.id,
      nombre: r.user_nombre,
      member_number: r.member_number,
      estado: r.estado,
      producto_nombre: r.producto_nombre,
      team_nombre: r.team_nombre,
      match_rival: r.match_rival,
      match_fecha: r.match_fecha,
    };
    if (esAdmin) fila.email = r.user_email;

    if (matchId) {
      const columna = r.tipo === "socio" ? "membership_id" : "ticket_id";
      const { data: credencial } = await supabase.from("access_credentials").select("id").eq(columna, r.id).maybeSingle();
      if (credencial) {
        fila.credential_id = credencial.id;
        const { data: acceso } = await supabase
          .from("match_access_log")
          .select("id, scanned_at")
          .eq("credential_id", credencial.id)
          .eq("match_id", matchId)
          .eq("reversed", false)
          .maybeSingle();
        fila.acceso_hoy = acceso ? { log_id: acceso.id, hora: acceso.scanned_at } : null;
      }
    }
    return fila;
  }));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resultados: enriquecidos }),
  };
};
