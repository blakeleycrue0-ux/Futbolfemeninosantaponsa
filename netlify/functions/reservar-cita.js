/*
  reservar-cita.js — Netlify Function
  ============================================================================
  Escritura pública (solo POST) llamada desde citas.html cuando una
  familia elige un hueco para venir a probarse la equipación. La reserva
  es atómica (UPDATE ... WHERE disponible = true): si dos familias
  intentan coger la misma hora a la vez, solo una lo consigue — la otra
  recibe un 409 y tiene que elegir otra hora. Así se evita que dos
  familias se planten el mismo día a la misma hora.

  Avisa por email a la familia (confirmación con fecha/hora) y al club
  (para que sepa quién viene). Si el email falla no se deshace la
  reserva — el hueco ya ha quedado bien cogido, que es lo importante.

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    GMAIL_USER, GMAIL_APP_PASSWORD   (opcionales — si faltan, se reserva
                                       igual pero sin aviso por email)
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

function formatearFecha(fecha) {
  return new Date(fecha + "T00:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}
function formatearHora(hora) {
  return String(hora || "").slice(0, 5);
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }
  const cita_id = payload.cita_id;
  const nombre = (payload.nombre || "").trim();
  const email = (payload.email || "").trim();
  const jugadora_nombre = (payload.jugadora_nombre || "").trim();
  if (!cita_id || !nombre || !email || !jugadora_nombre) {
    return { statusCode: 400, body: "Faltan datos: nombre, email y nombre de la jugadora son obligatorios" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: reservada, error: updError } = await supabase
    .from("citas_horario")
    .update({
      disponible: false,
      reservado_nombre: nombre,
      reservado_email: email,
      jugadora_nombre,
      reservado_en: new Date().toISOString(),
    })
    .eq("id", cita_id)
    .eq("disponible", true)
    .select()
    .single();

  if (updError || !reservada) {
    return { statusCode: 409, body: "Esa hora ya no está disponible — elige otra, por favor." };
  }

  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
      });
      const cuandoTexto = `${formatearFecha(reservada.fecha)} a las ${formatearHora(reservada.hora)}`;
      await transporter.sendMail({
        from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
        to: email,
        subject: `Cita confirmada — ${jugadora_nombre} (${cuandoTexto})`,
        html: `
          <p>Hola ${nombre},</p>
          <p>Tu cita para que <strong>${jugadora_nombre}</strong> se pruebe la equipación (${reservada.categoria}) queda confirmada:</p>
          <p style="font-size:1.1rem;font-weight:bold;">${cuandoTexto}</p>
          <p>Cualquier duda o cambio, escríbenos a ffsp2026@gmail.com o llama al 676 04 01 11.</p>
          <p>Fútbol Femenino Santa Ponça</p>
        `,
      });
      await transporter.sendMail({
        from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
        to: GMAIL_USER,
        subject: `Nueva cita reservada — ${jugadora_nombre} (${reservada.categoria})`,
        html: `
          <p>Nueva cita para probarse la equipación:</p>
          <p><strong>Jugadora:</strong> ${jugadora_nombre} (${reservada.categoria})<br>
          <strong>Familia:</strong> ${nombre} — ${email}<br>
          <strong>Cuándo:</strong> ${cuandoTexto}</p>
        `,
      });
    } catch (err) {
      // La cita ya ha quedado reservada — que falle el aviso no debe
      // impedir que la familia vea la reserva como correcta.
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, cita: reservada }),
  };
};
