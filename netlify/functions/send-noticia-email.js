/*
  send-noticia-email.js — Netlify Function
  ============================================================================
  Admin-only. Envía por email una noticia ya publicada a todas las familias
  que tenemos registradas (tutor_email / tutor2_email de la tabla
  `inscripciones`) — para que se enteren aunque no entren a mirar la web.
  Se manda con copia oculta (BCC) en tandas, para no enseñar el email de
  una familia a las demás y para no pasarnos del límite de destinatarios
  por envío de Gmail.

  No se puede reenviar sin querer sin darse cuenta: se guarda
  email_enviado_en en la noticia y el admin ve el aviso en pantalla, pero
  esta función en sí no bloquea un segundo envío — a veces hace falta
  reenviar (se corrigió una errata, etc.), así que la decisión la deja en
  manos de quien pulsa el botón, con el aviso bien visible.

  Requiere que quien llama esté autenticado como admin (mismo esquema que
  confirm-inscripcion.js).

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
    GMAIL_USER, GMAIL_APP_PASSWORD
    PUBLIC_SITE_URL
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

const TAMANO_TANDA = 40;

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, PUBLIC_SITE_URL, URL: SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase" };
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return { statusCode: 500, body: "Faltan variables de entorno de email (GMAIL_USER / GMAIL_APP_PASSWORD)" };
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
  const { noticia_id } = payload;
  if (!noticia_id) {
    return { statusCode: 400, body: "Falta noticia_id" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: noticia, error: noticiaError } = await supabase
    .from("news")
    .select("id, titulo, resumen, imagen_url, publicado")
    .eq("id", noticia_id)
    .single();
  if (noticiaError || !noticia) {
    return { statusCode: 404, body: "No se ha encontrado esa noticia" };
  }
  if (!noticia.publicado) {
    return { statusCode: 400, body: "Esta noticia todavía es un borrador — publícala antes de enviarla por email" };
  }

  const { data: inscripciones, error: insError } = await supabase
    .from("inscripciones")
    .select("tutor_email, tutor2_email");
  if (insError) {
    return { statusCode: 500, body: "No se han podido cargar los emails de las familias: " + insError.message };
  }

  const emails = Array.from(new Set(
    (inscripciones || [])
      .flatMap((i) => [i.tutor_email, i.tutor2_email])
      .filter(Boolean)
      .map((e) => e.trim().toLowerCase())
  ));

  if (!emails.length) {
    return { statusCode: 400, body: "Todavía no hay ninguna familia registrada con email" };
  }

  const baseUrl = PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info";
  const noticiaUrl = `${baseUrl}/noticia.html?id=${noticia_id}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const cuerpoHtml = `
    ${noticia.imagen_url ? `<p><img src="${noticia.imagen_url}" alt="" style="max-width:100%;border-radius:8px;"></p>` : ""}
    <h2 style="margin:0 0 0.6rem;">${noticia.titulo}</h2>
    ${noticia.resumen ? `<p>${noticia.resumen}</p>` : ""}
    <p><a href="${noticiaUrl}" style="display:inline-block;background:#a855f7;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Leer la noticia completa</a></p>
    <p style="font-size:0.86rem;color:#666;">Recibes este email porque tu familia está registrada en Fútbol Femenino Santa Ponça.</p>
  `;

  let enviados = 0;
  const errores = [];
  for (let i = 0; i < emails.length; i += TAMANO_TANDA) {
    const tanda = emails.slice(i, i + TAMANO_TANDA);
    try {
      await transporter.sendMail({
        from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
        to: GMAIL_USER,
        bcc: tanda,
        subject: `${noticia.titulo} — Fútbol Femenino Santa Ponça`,
        html: cuerpoHtml,
      });
      enviados += tanda.length;
    } catch (err) {
      errores.push(err.message);
    }
  }

  await supabase.from("news").update({ email_enviado_en: new Date().toISOString() }).eq("id", noticia_id);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, enviados, total: emails.length, errores }),
  };
};
