/*
  payment-reminders.js — Netlify Function (Scheduled)
  ============================================================================
  Se ejecuta sola cada día (cron, configurado en netlify.toml) — nadie del
  club tiene que hacer nada. Manda dos tipos de aviso por email a la
  familia, con el enlace personal de pago.html para la cuota que toque
  (la 2ª, 3ª o 4ª según el plan que hayan elegido — pago.html ya enseña
  siempre la próxima cuota pendiente sola):

  1. Un día ANTES del vencimiento (recordatorio_enviado).
  2. El MISMO día del vencimiento (recordatorio_mismo_dia_enviado).

  Cada aviso se manda una sola vez por plazo (se marca con su propio
  booleano para no repetirlo al día siguiente).

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
    GMAIL_USER, GMAIL_APP_PASSWORD
    PUBLIC_SITE_URL   (dominio público, p.ej. https://ffsp.info)
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

function fechaISO(diasDesdeHoy) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + diasDesdeHoy);
  return d.toISOString().slice(0, 10);
}

exports.handler = async function () {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, PUBLIC_SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return { statusCode: 500, body: "Faltan variables de entorno" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const baseUrl = PUBLIC_SITE_URL || "https://ffsp.info";

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  async function procesarTanda(fechaObjetivo, columnaFlag, cuerpo) {
    const { data: pagos, error } = await supabase
      .from("inscripcion_pagos")
      .select("*, inscripciones(jugadora_nombre, tutor_nombre, tutor_email)")
      .eq("estado", "pendiente")
      .eq(columnaFlag, false)
      .eq("fecha_vencimiento", fechaObjetivo);

    if (error) {
      return { enviados: 0, total: 0, errores: ["Error al buscar plazos (" + columnaFlag + "): " + error.message] };
    }
    if (!pagos || !pagos.length) {
      return { enviados: 0, total: 0, errores: [] };
    }

    let enviados = 0;
    const errores = [];

    for (const pago of pagos) {
      const inscripcion = pago.inscripciones;
      if (!inscripcion || !inscripcion.tutor_email) continue;

      const pagoUrl = `${baseUrl}/pago.html?id=${pago.inscripcion_id}`;
      try {
        await transporter.sendMail({
          from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
          to: inscripcion.tutor_email,
          subject: `Recordatorio de pago — ${inscripcion.jugadora_nombre}`,
          html: cuerpo(inscripcion, pago, pagoUrl),
        });
        await supabase.from("inscripcion_pagos").update({ [columnaFlag]: true }).eq("id", pago.id);
        enviados++;
      } catch (err) {
        errores.push(pago.id + ": " + err.message);
      }
    }

    return { enviados, total: pagos.length, errores };
  }

  const cuerpoManana = (inscripcion, pago, pagoUrl) => `
    <p>Hola ${inscripcion.tutor_nombre || ""},</p>
    <p>Recordatorio: mañana vence el pago de la cuota ${pago.numero_cuota} (${pago.importe} €) de <strong>${inscripcion.jugadora_nombre}</strong>.</p>
    <p><a href="${pagoUrl}" style="display:inline-block;background:#a855f7;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Ver datos de pago</a></p>
    <p>O copia y pega este enlace en el navegador:<br>${pagoUrl}</p>
    <p>Si ya la has pagado, ignora este mensaje.</p>
    <p>Cualquier duda, escríbenos a ffsp2026@gmail.com o llama al 676 04 01 11.</p>
    <p>Gracias,<br>Fútbol Femenino Santa Ponça</p>
  `;

  const cuerpoHoy = (inscripcion, pago, pagoUrl) => `
    <p>Hola ${inscripcion.tutor_nombre || ""},</p>
    <p>Hoy vence el pago de la cuota ${pago.numero_cuota} (${pago.importe} €) de <strong>${inscripcion.jugadora_nombre}</strong>.</p>
    <p><a href="${pagoUrl}" style="display:inline-block;background:#a855f7;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Ver datos de pago</a></p>
    <p>O copia y pega este enlace en el navegador:<br>${pagoUrl}</p>
    <p>Si ya la has pagado, ignora este mensaje.</p>
    <p>Cualquier duda, escríbenos a ffsp2026@gmail.com o llama al 676 04 01 11.</p>
    <p>Gracias,<br>Fútbol Femenino Santa Ponça</p>
  `;

  const resultadoManana = await procesarTanda(fechaISO(1), "recordatorio_enviado", cuerpoManana);
  const resultadoHoy = await procesarTanda(fechaISO(0), "recordatorio_mismo_dia_enviado", cuerpoHoy);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ok: true,
      manana: resultadoManana,
      hoy: resultadoHoy,
    }),
  };
};
