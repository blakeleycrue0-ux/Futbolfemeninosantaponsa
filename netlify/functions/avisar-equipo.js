const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");
const webpush = require("web-push");

const TAMANO_TANDA = 40;

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
    GMAIL_USER, GMAIL_APP_PASSWORD,
    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
  } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase" };
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
  const teamId = payload.team_id;
  const titulo = (payload.titulo || "").trim();
  const mensaje = (payload.mensaje || "").trim();
  if (!teamId || !titulo || !mensaje) {
    return { statusCode: 400, body: "Falta team_id, titulo o mensaje" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: jugadoras, error: jugadorasError } = await supabase
    .from("players")
    .select("id, inscripcion_id")
    .eq("team_id", teamId)
    .eq("activa", true);
  if (jugadorasError) {
    return { statusCode: 500, body: "No se han podido cargar las jugadoras: " + jugadorasError.message };
  }
  if (!jugadoras || !jugadoras.length) {
    return { statusCode: 400, body: "Este equipo todavía no tiene jugadoras en Plantilla" };
  }

  const playerIds = jugadoras.map((j) => j.id);
  const inscripcionIds = jugadoras.map((j) => j.inscripcion_id).filter(Boolean);

  let emailsEnviados = 0;
  if (GMAIL_USER && GMAIL_APP_PASSWORD && inscripcionIds.length) {
    const { data: inscripciones } = await supabase
      .from("inscripciones")
      .select("tutor_email, tutor2_email")
      .in("id", inscripcionIds);
    const emails = Array.from(new Set(
      (inscripciones || [])
        .flatMap((i) => [i.tutor_email, i.tutor2_email])
        .filter(Boolean)
        .map((e) => e.trim().toLowerCase())
    ));
    if (emails.length) {
      const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
      const cuerpoHtml = `
        <h2 style="margin:0 0 0.6rem;">${titulo}</h2>
        <p>${mensaje.replace(/\n/g, "<br>")}</p>
        <p style="font-size:0.86rem;color:#666;">Fútbol Femenino Santa Ponça</p>
      `;
      for (let i = 0; i < emails.length; i += TAMANO_TANDA) {
        const tanda = emails.slice(i, i + TAMANO_TANDA);
        try {
          await transporter.sendMail({
            from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
            to: GMAIL_USER,
            bcc: tanda,
            subject: titulo,
            html: cuerpoHtml,
          });
          emailsEnviados += tanda.length;
        } catch (err) {
          // Se sigue con las demás tandas aunque una falle.
        }
      }
    }
  }

  let pushEnviados = 0;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:ffsp2026@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    const { data: subs } = await supabase.from("push_subscriptions").select("*").in("player_id", playerIds);
    const cuerpoNotificacion = JSON.stringify({ titulo, cuerpo: mensaje, url: "/" });
    const caducadas = [];
    await Promise.all((subs || []).map(async (sub) => {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, cuerpoNotificacion);
        pushEnviados++;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) caducadas.push(sub.endpoint);
      }
    }));
    if (caducadas.length) {
      await supabase.from("push_subscriptions").delete().in("endpoint", caducadas);
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, emails_enviados: emailsEnviados, push_enviados: pushEnviados }),
  };
};
