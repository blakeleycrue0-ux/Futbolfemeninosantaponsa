/*
  payment-reminders.js — Netlify Function (Scheduled)
  ============================================================================
  Se ejecuta sola cada día (cron, configurado en netlify.toml) — nadie del
  club tiene que hacer nada. Busca en inscripcion_pagos los plazos
  pendientes cuyo vencimiento es MAÑANA y que todavía no tienen el aviso
  enviado (recordatorio_enviado = false), y les manda un email de
  recordatorio SOLO a esa familia con el importe y el enlace personal de
  pago.html. Marca cada plazo avisado para no repetir el aviso al día
  siguiente.

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    GMAIL_USER, GMAIL_APP_PASSWORD
    PUBLIC_SITE_URL   (dominio público, p.ej. https://ffsp.info)
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

function manana() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

exports.handler = async function () {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, PUBLIC_SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return { statusCode: 500, body: "Faltan variables de entorno" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const baseUrl = PUBLIC_SITE_URL || "https://ffsp.info";
  const fechaObjetivo = manana();

  const { data: pagos, error } = await supabase
    .from("inscripcion_pagos")
    .select("*, inscripciones(jugadora_nombre, tutor_nombre, tutor_email)")
    .eq("estado", "pendiente")
    .eq("recordatorio_enviado", false)
    .eq("fecha_vencimiento", fechaObjetivo);

  if (error) {
    return { statusCode: 500, body: "Error al buscar plazos: " + error.message };
  }
  if (!pagos || !pagos.length) {
    return { statusCode: 200, body: "Sin recordatorios que enviar hoy." };
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  let enviados = 0;
  const errores = [];

  for (const pago of pagos) {
    const inscripcion = pago.inscripciones;
    if (!inscripcion || !inscripcion.tutor_email) continue;

    const pagoUrl = `${baseUrl}/pago.html?id=${pago.inscripcion_id}`;
    const cuerpoHtml = `
      <p>Hola ${inscripcion.tutor_nombre || ""},</p>
      <p>Recordatorio: mañana vence el pago de la cuota ${pago.numero_cuota} (${pago.importe} €) de <strong>${inscripcion.jugadora_nombre}</strong>.</p>
      <p><a href="${pagoUrl}" style="display:inline-block;background:#a855f7;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Pagar ahora</a></p>
      <p>O copia y pega este enlace en el navegador:<br>${pagoUrl}</p>
      <p>Si ya la has pagado, ignora este mensaje.</p>
      <p>Cualquier duda, escríbenos a ffsp2026@gmail.com o llama al 676 04 01 11.</p>
      <p>Gracias,<br>Fútbol Femenino Santa Ponça</p>
    `;

    try {
      await transporter.sendMail({
        from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
        to: inscripcion.tutor_email,
        subject: `Recordatorio de pago — ${inscripcion.jugadora_nombre}`,
        html: cuerpoHtml,
      });
      await supabase.from("inscripcion_pagos").update({ recordatorio_enviado: true }).eq("id", pago.id);
      enviados++;
    } catch (err) {
      errores.push(pago.id + ": " + err.message);
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, enviados, total: pagos.length, errores }),
  };
};
