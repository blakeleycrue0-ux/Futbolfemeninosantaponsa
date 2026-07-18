/*
  send-push.js — Netlify Function
  ============================================================================
  Admin-only. Manda una notificación push a todos los dispositivos que la
  tengan activada — se llama a mano desde admin/emails.html (al publicar
  una noticia) o admin/partidos.html (aviso de partido), igual que el
  envío de emails: es una acción explícita, nunca automática.

  Si un envío falla con 404/410 (Gone) es que el navegador dio de baja
  esa suscripción por su cuenta (se desinstaló la app, caducó, etc.) — se
  aprovecha para borrarla de la tabla, así no se vuelve a intentar.

  Requiere que quien llama esté autenticado como admin (mismo esquema que
  confirm-inscripcion.js).

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");
const webpush = require("web-push");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
  } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase" };
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de notificaciones push (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)" };
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
  const titulo = (payload.titulo || "").trim();
  const cuerpo = (payload.cuerpo || "").trim();
  const url = payload.url || "/";
  if (!titulo) {
    return { statusCode: 400, body: "Falta titulo" };
  }

  webpush.setVapidDetails(VAPID_SUBJECT || "mailto:ffsp2026@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: subs, error: subsError } = await supabase.from("push_subscriptions").select("*");
  if (subsError) {
    return { statusCode: 500, body: "No se han podido cargar las suscripciones: " + subsError.message };
  }
  if (!subs || !subs.length) {
    return { statusCode: 400, body: "Todavía no hay nadie con las notificaciones activadas" };
  }

  const cuerpoNotificacion = JSON.stringify({ titulo, cuerpo, url });

  let enviados = 0;
  const caducadas = [];
  await Promise.all(subs.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        cuerpoNotificacion
      );
      enviados++;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        caducadas.push(sub.endpoint);
      }
    }
  }));

  if (caducadas.length) {
    await supabase.from("push_subscriptions").delete().in("endpoint", caducadas);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, enviados, total: subs.length, caducadas: caducadas.length }),
  };
};
