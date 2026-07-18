/*
  notificar-nueva-solicitud.js — Netlify Function
  ============================================================================
  Escritura pública (solo POST) llamada desde inscripcion.html justo
  después de guardar un nuevo formulario de interés. Avisa por email al
  club al momento — así no hace falta entrar al admin a mirar cada rato
  si ha llegado alguna solicitud nueva. Es un aviso, no crítico: si falla
  el envío, no pasa nada — la solicitud ya se ha guardado bien en
  Supabase y sigue apareciendo en Formularios de interés igualmente.

  Variables de entorno requeridas:
    GMAIL_USER, GMAIL_APP_PASSWORD   (opcionales — si faltan, no se envía
                                       aviso pero tampoco se considera error)
  ============================================================================
*/
const nodemailer = require("nodemailer");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, enviado: false }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }
  const jugadoraNombre = (payload.jugadora_nombre || "").trim();
  const tutorNombre = (payload.tutor_nombre || "").trim();
  const tutorEmail = (payload.tutor_email || "").trim();
  const tutorTelefono = (payload.tutor_telefono || "").trim();

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
      to: GMAIL_USER,
      subject: `Nueva solicitud de interés — ${jugadoraNombre || "sin nombre"}`,
      html: `
        <p>Ha llegado un nuevo formulario de interés:</p>
        <p><strong>Jugadora:</strong> ${jugadoraNombre || "-"}<br>
        <strong>Madre/padre/tutor/a:</strong> ${tutorNombre || "-"}<br>
        <strong>Email:</strong> ${tutorEmail || "-"}<br>
        <strong>Teléfono:</strong> ${tutorTelefono || "-"}</p>
        <p>Revísala y acepta la plaza desde "Formularios de interés" en el panel del club.</p>
      `,
    });
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, enviado: true }) };
  } catch (err) {
    return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, enviado: false }) };
  }
};
