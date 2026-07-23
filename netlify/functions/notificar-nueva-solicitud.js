/*
  notificar-nueva-solicitud.js — Netlify Function
  ============================================================================
  Escritura pública (solo POST) llamada desde inscripcion.html justo
  después de guardar un nuevo formulario de interés. Avisa al club al
  momento por email y por notificación push (a quien la tenga activada
  desde el dashboard del admin) — así no hace falta entrar al admin a
  mirar cada rato si ha llegado alguna solicitud nueva. Es un aviso, no
  crítico: si falla el envío, no pasa nada — la solicitud ya se ha
  guardado bien en Supabase y sigue apareciendo en Formularios de interés
  igualmente.

  Variables de entorno requeridas:
    GMAIL_USER, GMAIL_APP_PASSWORD                       (opcionales)
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY               (opcionales —
                                                            hacen falta
                                                            solo para el
                                                            push)
    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   (opcionales)
  ============================================================================
*/
const nodemailer = require("nodemailer");
const webpush = require("web-push");
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
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

  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  let emailEnviado = false;
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
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
      emailEnviado = true;
    } catch (err) {
      // Aviso de cortesía — la solicitud ya se guardó bien.
    }
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
      webpush.setVapidDetails(VAPID_SUBJECT || "mailto:ffsp2026@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      const { data: subs } = await supabase.from("admin_push_subscriptions").select("*");
      const cuerpoNotificacion = JSON.stringify({
        titulo: "Nueva solicitud de interés",
        cuerpo: jugadoraNombre || "Revísala en el panel del club",
        url: "/admin/inscripciones.html",
      });
      const caducadas = [];
      await Promise.all((subs || []).map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, cuerpoNotificacion);
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) caducadas.push(sub.endpoint);
        }
      }));
      if (caducadas.length) {
        await supabase.from("admin_push_subscriptions").delete().in("endpoint", caducadas);
      }
    } catch (err) {
      // Aviso de cortesía — la solicitud ya se guardó bien.
    }
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true, enviado: emailEnviado }) };
};
