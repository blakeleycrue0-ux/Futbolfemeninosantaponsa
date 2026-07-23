/*
  notificar-pago-extra.js — Netlify Function
  ============================================================================
  Admin-only. Se llama justo después de crear uno o varios pagos_extra
  (viajes, torneos, equipación...) desde admin/pagos-extra.html. Avisa a
  cada familia por email con el concepto, el importe y su enlace personal
  de mi-jugadora.html, donde puede ver los datos de la transferencia y
  subir el justificante.

  Si una familia no tiene email registrado o el envío falla, no se
  considera un error de la función — el pago ya ha quedado creado, que es
  lo importante.

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
    GMAIL_USER, GMAIL_APP_PASSWORD   (opcionales)
    PUBLIC_SITE_URL
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
    GMAIL_USER, GMAIL_APP_PASSWORD, PUBLIC_SITE_URL, URL: SITE_URL,
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
  const pagoExtraIds = Array.isArray(payload.pago_extra_ids) ? payload.pago_extra_ids : [];
  if (!pagoExtraIds.length) {
    return { statusCode: 400, body: "Falta pago_extra_ids" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const baseUrl = PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info";

  const { data: pagos, error: pagosError } = await supabase
    .from("pagos_extra")
    .select("id, concepto, importe, fecha_vencimiento, player_id, players(nombre, access_token, inscripcion_id)")
    .in("id", pagoExtraIds);
  if (pagosError) {
    return { statusCode: 500, body: "No se han podido cargar los pagos: " + pagosError.message };
  }

  const inscripcionIds = (pagos || []).map((p) => p.players && p.players.inscripcion_id).filter(Boolean);
  const { data: inscripciones } = inscripcionIds.length
    ? await supabase.from("inscripciones").select("id, tutor_email, tutor_nombre").in("id", inscripcionIds)
    : { data: [] };
  const inscripcionesById = Object.fromEntries((inscripciones || []).map((i) => [i.id, i]));

  let transporter = null;
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    transporter = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  }

  let enviados = 0;
  for (const p of pagos || []) {
    const jugadora = p.players || {};
    if (!transporter || !jugadora.inscripcion_id) continue;
    const inscripcion = inscripcionesById[jugadora.inscripcion_id];
    if (!inscripcion || !inscripcion.tutor_email) continue;
    const enlace = `${baseUrl}/mi-jugadora.html?token=${jugadora.access_token}`;
    const vencimientoTexto = p.fecha_vencimiento
      ? new Date(p.fecha_vencimiento + "T00:00:00").toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric" })
      : null;
    try {
      await transporter.sendMail({
        from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
        to: inscripcion.tutor_email,
        subject: `Pago pendiente — ${p.concepto} (${jugadora.nombre || ""})`,
        html: `
          <p>Hola ${inscripcion.tutor_nombre || ""},</p>
          <p>Tienes un pago pendiente de <strong>${jugadora.nombre || ""}</strong>: <strong>${p.concepto}</strong> — ${p.importe} €${vencimientoTexto ? ` (antes del ${vencimientoTexto})` : ""}.</p>
          <p><a href="${enlace}">Entra a su enlace personal</a> para ver los datos de la transferencia y subir el justificante.</p>
          <p>Fútbol Femenino Santa Ponça</p>
        `,
      });
      enviados++;
    } catch (err) {
      // Aviso de cortesía — el pago ya está creado.
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, enviados }),
  };
};
