/*
  send-payment-link.js — Netlify Function
  ============================================================================
  Llamada desde Admin → Formularios de interés cuando el club decide que
  ya toca pedir el pago (paso aparte y posterior a "Aceptar plaza"). El
  admin elige ahí mismo el plan (único / 2 / 4 cuotas, según lo que haya
  hablado con la familia) — esta función (re)genera los plazos en
  inscripcion_pagos según ese plan y envía un email SOLO al tutor/a de
  esa familia con el importe de la primera cuota y el enlace personal a
  pago.html — una página que no aparece en ningún menú y solo es
  accesible con ese enlace directo. No cobra nada aquí mismo: el cobro
  ocurre cuando la familia entra al enlace y pulsa pagar.

  Requiere que quien llama esté autenticado como admin (mismo esquema que
  confirm-inscripcion.js).

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
    GMAIL_USER, GMAIL_APP_PASSWORD
    PUBLIC_SITE_URL   (dominio público, p.ej. https://ffsp.info — si no
                       está definida, se cae a la URL que inyecta Netlify
                       automáticamente y luego a un valor fijo)
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

const PLAN_CUOTAS = {
  unico: [{ numero_cuota: 1, importe: 650, fecha_vencimiento: "2026-07-01" }],
  "2_cuotas": [
    { numero_cuota: 1, importe: 325, fecha_vencimiento: "2026-07-01" },
    { numero_cuota: 2, importe: 325, fecha_vencimiento: "2026-10-01" },
  ],
  "4_cuotas": [
    { numero_cuota: 1, importe: 245, fecha_vencimiento: "2026-07-01" },
    { numero_cuota: 2, importe: 135, fecha_vencimiento: "2026-10-01" },
    { numero_cuota: 3, importe: 135, fecha_vencimiento: "2026-12-01" },
    { numero_cuota: 4, importe: 135, fecha_vencimiento: "2027-02-01" },
  ],
};

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
  const { inscripcion_id, plan_pago } = payload;
  if (!inscripcion_id) {
    return { statusCode: 400, body: "Falta inscripcion_id" };
  }
  const cuotas = PLAN_CUOTAS[plan_pago];
  if (!cuotas) {
    return { statusCode: 400, body: "plan_pago no válido" };
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

  // Elimina cualquier plazo pendiente ya creado (p.ej. el pago único por
  // defecto del formulario de interés) para sustituirlo por el plan que
  // ha elegido el admin. Los plazos ya marcados como pagados se respetan.
  const { error: deleteError } = await supabase
    .from("inscripcion_pagos")
    .delete()
    .eq("inscripcion_id", inscripcion_id)
    .neq("estado", "pagado");
  if (deleteError) {
    return { statusCode: 500, body: "No se han podido preparar los plazos de pago: " + deleteError.message };
  }

  const { data: pagos, error: insertError } = await supabase
    .from("inscripcion_pagos")
    .insert(cuotas.map((c) => Object.assign({}, c, { inscripcion_id })))
    .select()
    .order("numero_cuota");
  if (insertError || !pagos || !pagos.length) {
    return { statusCode: 500, body: "No se han podido crear los plazos de pago: " + (insertError ? insertError.message : "") };
  }
  const primerPago = pagos.find((p) => p.estado !== "pagado") || pagos[0];

  await supabase
    .from("inscripciones")
    .update({ plan_pago, cuota_total: cuotas.reduce((sum, c) => sum + c.importe, 0) })
    .eq("id", inscripcion_id);

  const baseUrl = PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info";
  const pagoUrl = `${baseUrl}/pago.html?id=${primerPago.id}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const asunto = `Pago de la plaza — ${inscripcion.jugadora_nombre}`;
  const cuerpoHtml = `
    <p>Hola ${inscripcion.tutor_nombre || ""},</p>
    <p>Para confirmar la plaza de <strong>${inscripcion.jugadora_nombre}</strong>, falta el pago de la primera cuota (${primerPago.importe} €). Puedes hacerlo de forma segura desde este enlace personal:</p>
    <p><a href="${pagoUrl}" style="display:inline-block;background:#a855f7;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Pagar cuota</a></p>
    <p>O copia y pega este enlace en el navegador:<br>${pagoUrl}</p>
    <p>Este enlace es personal e intransferible — no lo compartas.</p>
    <p>Si tienes cualquier duda, escríbenos a ffsp2026@gmail.com o llama al 676 04 01 11.</p>
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
    .update({ pago_solicitado_en: new Date().toISOString() })
    .eq("id", inscripcion_id);
  if (updateError) {
    return { statusCode: 200, body: JSON.stringify({ ok: true, warning: "Email enviado, pero no se pudo marcar como enviado: " + updateError.message }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
