/*
  save-push-subscription.js — Netlify Function
  ============================================================================
  Escritura pública (solo POST) llamada desde assets/js/push-notifications.js
  cuando alguien activa las notificaciones push en su navegador. Guarda el
  endpoint que genera el propio navegador (identifica ese dispositivo) y
  las claves p256dh/auth que hacen falta para poder enviarle avisos
  después (ver send-push.js). Upsert por endpoint: si ya existía (p.ej.
  se volvió a activar tras desactivarlo), no crea una fila duplicada.

  Si se manda player_id (activado desde mi-jugadora.html en vez del aviso
  general del sitio), ese dispositivo queda ligado a esa jugadora — sigue
  recibiendo los avisos generales de partidos/noticias igual, pero además
  recibe las convocatorias de esa jugadora en concreto (ver
  notificar-convocatoria.js). Un dispositivo solo puede estar ligado a una
  jugadora a la vez (una fila por endpoint).

  Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  ============================================================================
*/
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
  const endpoint = payload.endpoint;
  const keys = payload.keys || {};
  const playerId = payload.player_id || null;
  if (!endpoint || !keys.p256dh || !keys.auth) {
    return { statusCode: 400, body: "Falta endpoint o las claves de la suscripción" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { error } = await supabase
    .from("push_subscriptions")
    .upsert({ endpoint, p256dh: keys.p256dh, auth: keys.auth, player_id: playerId }, { onConflict: "endpoint" });
  if (error) {
    return { statusCode: 500, body: "No se ha podido guardar la suscripción: " + error.message };
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
};
