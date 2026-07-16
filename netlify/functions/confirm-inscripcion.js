/*
  confirm-inscripcion.js — Netlify Function
  ============================================================================
  Llamada desde Admin → Formularios de interés cuando el club revisa un
  formulario y le da a "Aceptar plaza y enviar email". Marca la inscripción
  como confirmada y envía UN ÚNICO email al tutor/a de esa familia con el
  enlace personal a registro.html, donde en un solo sitio completan el
  registro (DNI, dirección, talla, segundo tutor/a, condiciones generales),
  eligen plan de pago y suben el justificante de la transferencia. Antes
  esto eran dos pasos y dos emails (éste + send-payment-link.js); ahora es
  uno solo porque el pago ya no depende de un paso aparte del club, sino de
  que la familia rellene su enlace de principio a fin.

  Requiere que quien llama esté autenticado como admin: recibe el JWT del
  usuario en el header Authorization y comprueba is_app_admin() en Supabase
  antes de hacer nada (si no, cualquiera con la URL de la función podría
  confirmar inscripciones y disparar emails).

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
    GMAIL_USER, GMAIL_APP_PASSWORD   (cuenta de Gmail del club + contraseña
                                       de aplicación, no la contraseña normal)
    URL   (la inyecta Netlify automáticamente)
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

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

  const baseUrl = PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info";
  const registroUrl = `${baseUrl}/registro.html?id=${inscripcion_id}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const asunto = `Plaza confirmada — ${inscripcion.jugadora_nombre}`;
  const cuerpoHtml = `
    <p>Hola ${inscripcion.tutor_nombre || ""},</p>
    <p>¡Buenas noticias! Hay plaza para <strong>${inscripcion.jugadora_nombre}</strong> en el Fútbol Femenino Santa Ponça.</p>
    <p>Solo queda un paso: entra en este enlace personal y ahí mismo vas a poder completar todo de una vez — tus datos (DNI, dirección, talla, segundo tutor/a si aplica), las condiciones generales, el plan de pago que prefieras (único, 2 o 4 cuotas) y, al final, subir la foto del justificante de tu transferencia:</p>
    <p><a href="${registroUrl}" style="display:inline-block;background:#a855f7;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Completar registro y pago</a></p>
    <p>O copia y pega este enlace en el navegador:<br>${registroUrl}</p>
    <p>Este enlace es personal e intransferible — no lo compartas.</p>
    <p>El pago se hace por transferencia bancaria — al elegir tu plan en el propio enlace te daremos el número de cuenta y la referencia exacta que hay que poner. En cuanto recibamos el ingreso y el justificante, te lo confirmamos.</p>
    <p>Si no ves nuestros próximos emails en la bandeja de entrada, revisa también la carpeta de <strong>spam / correo no deseado</strong>, por si acaso.</p>
    <p>Cualquier duda, escríbenos a ffsp2026@gmail.com o llama al 676 04 01 11.</p>
    <p>¡Bienvenidas al club!<br>Fútbol Femenino Santa Ponça</p>
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

  const ahora = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("inscripciones")
    .update({ confirmada_en: ahora, pago_solicitado_en: ahora })
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
