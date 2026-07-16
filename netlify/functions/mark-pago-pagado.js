/*
  mark-pago-pagado.js — Netlify Function
  ============================================================================
  Admin-only. El club cobra por transferencia bancaria (sin tarjeta, sin
  comisión de Stripe) — revisa el justificante que sube la familia en
  pago.html y, si está bien, marca la cuota correspondiente como pagada
  desde aquí. Recalcula el estado general de la inscripción igual que hacía
  antes el webhook de Stripe: 'pagado' si todos los plazos están pagados,
  'pago_parcial' si solo alguno, 'pendiente' si ninguno.

  Al marcarla, avisa por email a la familia: si es la cuota 1 (con eso la
  plaza queda confirmada según las condiciones del club), el email dice que
  ya está oficialmente inscrita; si es una cuota posterior, solo confirma
  que se ha recibido ese pago. Si el email falla, no se considera un error
  de la función — la cuota ya ha quedado marcada como pagada, que es lo
  importante.

  Requiere que quien llama esté autenticado como admin (mismo esquema que
  confirm-inscripcion.js).

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
    GMAIL_USER, GMAIL_APP_PASSWORD   (opcionales — si faltan, se marca como
                                       pagada pero sin aviso por email)
  ============================================================================
*/
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
  const { pago_id } = payload;
  if (!pago_id) {
    return { statusCode: 400, body: "Falta pago_id" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: pago, error: pagoError } = await supabase
    .from("inscripcion_pagos")
    .select("id, inscripcion_id, numero_cuota, importe, inscripciones(jugadora_nombre, tutor_nombre, tutor_email)")
    .eq("id", pago_id)
    .single();
  if (pagoError || !pago) {
    return { statusCode: 404, body: "No se ha encontrado ese plazo de pago" };
  }

  const { error: updError } = await supabase
    .from("inscripcion_pagos")
    .update({ estado: "pagado" })
    .eq("id", pago_id);
  if (updError) {
    return { statusCode: 500, body: "No se ha podido marcar como pagada: " + updError.message };
  }

  const { data: pagos } = await supabase
    .from("inscripcion_pagos")
    .select("estado")
    .eq("inscripcion_id", pago.inscripcion_id);

  let nuevoEstado = "pendiente";
  if (pagos && pagos.length) {
    const todosPagados = pagos.every((p) => p.estado === "pagado");
    const algunoPagado = pagos.some((p) => p.estado === "pagado");
    nuevoEstado = todosPagados ? "pagado" : algunoPagado ? "pago_parcial" : "pendiente";
  }
  await supabase.from("inscripciones").update({ estado: nuevoEstado }).eq("id", pago.inscripcion_id);

  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try {
      const inscripcion = pago.inscripciones || {};
      if (inscripcion.tutor_email) {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
        });
        const esPrimerPago = pago.numero_cuota === 1;
        const asunto = esPrimerPago
          ? `¡Ya está inscrita! — ${inscripcion.jugadora_nombre || ""}`
          : `Pago recibido — ${inscripcion.jugadora_nombre || ""} (cuota ${pago.numero_cuota})`;
        const cuerpoHtml = esPrimerPago
          ? `
            <p>Hola ${inscripcion.tutor_nombre || ""},</p>
            <p>Hemos comprobado la transferencia y ya está todo correcto — <strong>${inscripcion.jugadora_nombre || ""} ya está oficialmente inscrita</strong> en el Fútbol Femenino Santa Ponça para la temporada 2026/27. ¡Bienvenidas!</p>
            <p>Cualquier duda, escríbenos a ffsp2026@gmail.com o llama al 676 04 01 11.</p>
            <p>Fútbol Femenino Santa Ponça</p>
          `
          : `
            <p>Hola ${inscripcion.tutor_nombre || ""},</p>
            <p>Hemos comprobado la transferencia y ya está todo correcto — hemos recibido el pago de la cuota ${pago.numero_cuota} (${pago.importe} €) de <strong>${inscripcion.jugadora_nombre || ""}</strong>. ¡Gracias!</p>
            <p>Cualquier duda, escríbenos a ffsp2026@gmail.com o llama al 676 04 01 11.</p>
            <p>Fútbol Femenino Santa Ponça</p>
          `;
        await transporter.sendMail({
          from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
          to: inscripcion.tutor_email,
          subject: asunto,
          html: cuerpoHtml,
        });
      }
    } catch (err) {
      // La cuota ya ha quedado marcada como pagada — que falle el aviso no
      // debe impedir que el admin vea la operación como correcta.
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
