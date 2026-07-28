const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
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
  const { pago_extra_id } = payload;
  if (!pago_extra_id) {
    return { statusCode: 400, body: "Falta pago_extra_id" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: pago, error: pagoError } = await supabase
    .from("pagos_extra")
    .select("id, concepto, importe, player_id, players(nombre, inscripcion_id)")
    .eq("id", pago_extra_id)
    .single();
  if (pagoError || !pago) {
    return { statusCode: 404, body: "No se ha encontrado ese pago" };
  }

  const { error: updError } = await supabase.from("pagos_extra").update({ estado: "pagado" }).eq("id", pago_extra_id);
  if (updError) {
    return { statusCode: 500, body: "No se ha podido marcar como pagado: " + updError.message };
  }

  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try {
      const jugadora = pago.players || {};
      if (jugadora.inscripcion_id) {
        const { data: inscripcion } = await supabase
          .from("inscripciones")
          .select("tutor_nombre, tutor_email")
          .eq("id", jugadora.inscripcion_id)
          .single();
        if (inscripcion && inscripcion.tutor_email) {
          const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
          await transporter.sendMail({
            from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
            to: inscripcion.tutor_email,
            subject: `Pago recibido — ${pago.concepto} (${jugadora.nombre || ""})`,
            html: `
              <p>Hola ${inscripcion.tutor_nombre || ""},</p>
              <p>Hemos comprobado la transferencia y ya está todo correcto — hemos recibido el pago de <strong>${pago.concepto}</strong> (${pago.importe} €) de <strong>${jugadora.nombre || ""}</strong>. ¡Gracias!</p>
              <p>Fútbol Femenino Santa Ponça</p>
            `,
          });
        }
      }
    } catch (err) {
      // El pago ya ha quedado marcado correctamente.
    }
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
};
