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

  Además, en cuanto se marca pagada la primera cuota (numero_cuota === 1) —
  da igual si el plan es de pago único, 2 cuotas o 4 cuotas, con la primera
  ya basta — da de alta sola a la jugadora en Plantilla (tabla `players`)
  para que aparezca en la web sin esperar a que termine de pagar todo el
  plan. El equipo se elige por año de nacimiento con las mismas categorías
  que en admin/plantilla.html — si no hay ningún equipo creado para esa
  categoría, no se puede dar de alta (falta team_id) y se queda pendiente
  de añadirla a mano. inscripcion_id evita duplicados si se vuelve a marcar
  como pagada por error.

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

// Misma tabla de categorías por año de nacimiento que admin/plantilla.html
// — si cambia una, hay que cambiar la otra.
const CATEGORIA_POR_ANIO = [
  { min: 2015, max: 2018, categoria: "Benjamín Alevín" },
  { min: 2013, max: 2014, categoria: "Infantil" },
  { min: 2008, max: 2012, categoria: "Cadete Juvenil" },
  { min: -Infinity, max: 2007, categoria: "Amateur" },
];
function categoriaPorAnio(anio) {
  const rango = CATEGORIA_POR_ANIO.find((r) => anio >= r.min && anio <= r.max);
  return rango ? rango.categoria : null;
}

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
    .select("id, inscripcion_id, numero_cuota, importe, inscripciones(jugadora_nombre, jugadora_fecha_nacimiento, tutor_nombre, tutor_email)")
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

  // access_token de la jugadora en Plantilla (si ya existe o se acaba de
  // crear) — para poder incluir el enlace personal de mi-jugadora.html en
  // el email de "ya está inscrita" más abajo.
  let jugadoraAccessToken = null;

  if (pago.numero_cuota === 1) {
    try {
      const { data: yaExiste } = await supabase
        .from("players")
        .select("id, access_token")
        .eq("inscripcion_id", pago.inscripcion_id)
        .maybeSingle();
      if (yaExiste) {
        jugadoraAccessToken = yaExiste.access_token;
      } else {
        const inscripcion = pago.inscripciones || {};
        const anio = inscripcion.jugadora_fecha_nacimiento ? Number(String(inscripcion.jugadora_fecha_nacimiento).slice(0, 4)) : null;
        const categoria = anio ? categoriaPorAnio(anio) : null;
        if (categoria) {
          const { data: equipos } = await supabase.from("teams").select("id, nombre, categoria");
          const equipo = (equipos || []).find((t) =>
            (t.categoria || "").toLowerCase().includes(categoria.toLowerCase()) ||
            (t.nombre || "").toLowerCase().includes(categoria.toLowerCase()));
          if (equipo && inscripcion.jugadora_nombre) {
            const { data: nuevaJugadora } = await supabase.from("players").insert({
              nombre: inscripcion.jugadora_nombre,
              team_id: equipo.id,
              fecha_nacimiento: inscripcion.jugadora_fecha_nacimiento || null,
              inscripcion_id: pago.inscripcion_id,
              activa: true,
            }).select("access_token").single();
            if (nuevaJugadora) jugadoraAccessToken = nuevaJugadora.access_token;
          }
        }
      }
    } catch (err) {
      // Si falla el alta automática en Plantilla, no pasa nada grave — el
      // pago ya ha quedado marcado correctamente y se puede añadir a mano.
    }
  }

  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try {
      const inscripcion = pago.inscripciones || {};
      if (inscripcion.tutor_email) {
        const transporter = nodemailer.createTransport({
          service: "gmail",
          auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
        });
        const esPrimerPago = pago.numero_cuota === 1;
        const { PUBLIC_SITE_URL, URL: SITE_URL } = process.env;
        const baseUrl = PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info";
        const enlaceMiJugadora = jugadoraAccessToken ? `${baseUrl}/mi-jugadora.html?token=${jugadoraAccessToken}` : null;
        const asunto = esPrimerPago
          ? `¡Ya está inscrita! — ${inscripcion.jugadora_nombre || ""}`
          : `Pago recibido — ${inscripcion.jugadora_nombre || ""} (cuota ${pago.numero_cuota})`;
        const cuerpoHtml = esPrimerPago
          ? `
            <p>Hola ${inscripcion.tutor_nombre || ""},</p>
            <p>Hemos comprobado la transferencia y ya está todo correcto — <strong>${inscripcion.jugadora_nombre || ""} ya está oficialmente inscrita</strong> en el Fútbol Femenino Santa Ponça para la temporada 2026/27. ¡Bienvenidas!</p>
            ${enlaceMiJugadora ? `<p>Guarda este enlace — es el tuyo para toda la temporada: ahí verás las convocatorias de ${inscripcion.jugadora_nombre || "tu hija"} y podrás confirmar la asistencia a partidos y entrenos.<br><a href="${enlaceMiJugadora}">${enlaceMiJugadora}</a></p>` : ""}
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
