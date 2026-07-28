const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");
const webpush = require("web-push");

function formatearFecha(fecha) {
  return new Date(fecha + "T00:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" });
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
    GMAIL_USER, GMAIL_APP_PASSWORD,
    VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
    PUBLIC_SITE_URL, URL: SITE_URL,
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
  const convocatoriaIds = Array.isArray(payload.convocatoria_ids) ? payload.convocatoria_ids : [];
  if (!convocatoriaIds.length) {
    return { statusCode: 400, body: "Falta convocatoria_ids" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const baseUrl = PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info";

  const { data: convocatorias, error: convError } = await supabase
    .from("convocatorias")
    .select("id, match_id, training_id, player_id, players(nombre, access_token, inscripcion_id)")
    .in("id", convocatoriaIds);
  if (convError) {
    return { statusCode: 500, body: "No se han podido cargar las convocatorias: " + convError.message };
  }

  const matchIds = (convocatorias || []).map((c) => c.match_id).filter(Boolean);
  const trainingIds = (convocatorias || []).map((c) => c.training_id).filter(Boolean);
  const inscripcionIds = (convocatorias || []).map((c) => c.players && c.players.inscripcion_id).filter(Boolean);

  const [{ data: matches }, { data: trainings }, { data: inscripciones }] = await Promise.all([
    matchIds.length ? supabase.from("matches").select("id, rival, fecha, hora, campo, condicion").in("id", matchIds) : Promise.resolve({ data: [] }),
    trainingIds.length ? supabase.from("training_sessions").select("id, fecha, hora, lugar").in("id", trainingIds) : Promise.resolve({ data: [] }),
    inscripcionIds.length ? supabase.from("inscripciones").select("id, tutor_email, tutor_nombre").in("id", inscripcionIds) : Promise.resolve({ data: [] }),
  ]);
  const matchesById = Object.fromEntries((matches || []).map((m) => [m.id, m]));
  const trainingsById = Object.fromEntries((trainings || []).map((t) => [t.id, t]));
  const inscripcionesById = Object.fromEntries((inscripciones || []).map((i) => [i.id, i]));

  let transporter = null;
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  }
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT || "mailto:ffsp2026@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  }

  let emailsEnviados = 0;
  let pushEnviados = 0;

  for (const c of convocatorias || []) {
    const jugadora = c.players || {};
    const evento = c.match_id ? matchesById[c.match_id] : trainingsById[c.training_id];
    if (!evento) continue;
    const cuandoTexto = formatearFecha(evento.fecha) + (evento.hora ? " a las " + String(evento.hora).slice(0, 5) : "");
    const dondeTexto = c.match_id
      ? `vs ${evento.rival} (${evento.condicion === "local" ? "local" : "visitante"})${evento.campo ? " · " + evento.campo : ""}`
      : `entrenamiento${evento.lugar ? " · " + evento.lugar : ""}`;
    const enlace = `${baseUrl}/mi-jugadora.html?token=${jugadora.access_token}`;

    const inscripcion = jugadora.inscripcion_id ? inscripcionesById[jugadora.inscripcion_id] : null;
    if (transporter && inscripcion && inscripcion.tutor_email) {
      try {
        await transporter.sendMail({
          from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
          to: inscripcion.tutor_email,
          subject: `Convocatoria — ${jugadora.nombre} (${cuandoTexto})`,
          html: `
            <p>Hola ${inscripcion.tutor_nombre || ""},</p>
            <p><strong>${jugadora.nombre}</strong> está convocada: ${dondeTexto}, ${cuandoTexto}.</p>
            <p><a href="${enlace}">Confirma o rechaza la asistencia aquí</a>.</p>
            <p>Fútbol Femenino Santa Ponça</p>
          `,
        });
        emailsEnviados++;
      } catch (err) {
        // Aviso de cortesía — si falla, la convocatoria ya está guardada.
      }
    }

    if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
      const { data: subs } = await supabase.from("push_subscriptions").select("*").eq("player_id", c.player_id);
      const cuerpoNotificacion = JSON.stringify({
        titulo: `Convocatoria — ${jugadora.nombre}`,
        cuerpo: `${dondeTexto}, ${cuandoTexto}`,
        url: `/mi-jugadora.html?token=${jugadora.access_token}`,
      });
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
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, emails_enviados: emailsEnviados, push_enviados: pushEnviados }),
  };
};
