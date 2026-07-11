/*
  confirm-inscripcion.js — Netlify Function
  ============================================================================
  Llamada desde Admin → Inscripciones cuando el club revisa una solicitud y
  le da a "Confirmar y enviar enlace de pago". Marca la inscripción como
  confirmada y envía un email SOLO al tutor/a de esa inscripción con el
  enlace a pago.html para el primer plazo pendiente. No cobra nada aquí
  mismo — el cobro ocurre cuando la familia entra al enlace y pulsa pagar.

  Requiere que quien llama esté autenticado como admin: recibe el JWT del
  usuario en el header Authorization y comprueba is_app_admin() en Supabase
  antes de hacer nada (si no, cualquiera con la URL de la función podría
  confirmar inscripciones y disparar emails).

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    GMAIL_USER, GMAIL_APP_PASSWORD   (cuenta de Gmail del club + contraseña
                                       de aplicación, no la contraseña normal)
    URL                               (la inyecta Netlify automáticamente)
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, URL: SITE_URL } = process.env;
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
  const { inscripcion_id } = payload;
  if (!inscripcion_id) {
    return { statusCode: 400, body: "Falta inscripcion_id" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: inscripcion, error: insError } = await supabase
    .from("inscripciones")
    .select("*")
    .eq("id", inscripcion_id)
    .single();
  if (insError || !inscripcion) {
    return { statusCode: 404, body: "No se ha encontrado esa inscripción" };
  }

  const { data: pagos, error: pagosError } = await supabase
    .from("inscripcion_pagos")
    .select("*")
    .eq("inscripcion_id", inscripcion_id)
    .order("numero_cuota");
  if (pagosError || !pagos || !pagos.length) {
    return { statusCode: 404, body: "Esta inscripción no tiene plazos de pago" };
  }
  const primerPago = pagos.find((p) => p.estado !== "pagado") || pagos[0];

  const baseUrl = SITE_URL || "https://femeniniosantaponsa.netlify.app";
  const pagoUrl = `${baseUrl}/pago.html?id=${primerPago.id}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const asunto = `Inscripción confirmada — ${inscripcion.jugadora_nombre}`;
  const cuerpoHtml = `
    <p>Hola ${inscripcion.tutor_nombre || ""},</p>
    <p>Hemos confirmado la inscripción de <strong>${inscripcion.jugadora_nombre}</strong> en el Fútbol Femenino Santa Ponça.</p>
    <p>Para completarla, falta el pago de la primera cuota (${primerPago.importe} €). Puedes hacerlo de forma segura desde este enlace personal:</p>
    <p><a href="${pagoUrl}" style="display:inline-block;background:#a855f7;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Pagar cuota de inscripción</a></p>
    <p>O copia y pega este enlace en el navegador:<br>${pagoUrl}</p>
    <p>Si tienes cualquier duda, escríbenos a secretariaspfc@gmail.com o llama al 676 04 01 11.</p>
    <p>Gracias,<br>Fútbol Femenino Santa Ponça</p>
  `;

  try {
    await transporter.sendMail({
      from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
      to: inscripcion.tutor_email,
      subject: asunto,
      html: cuerpoHtml,
    });
  } catch (err) {
    return { statusCode: 502, body: "No se ha podido enviar el email: " + err.message };
  }

  const { error: updateError } = await supabase
    .from("inscripciones")
    .update({ confirmada_en: new Date().toISOString() })
    .eq("id", inscripcion_id);
  if (updateError) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, warning: "Email enviado, pero no se pudo marcar como confirmada: " + updateError.message }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
