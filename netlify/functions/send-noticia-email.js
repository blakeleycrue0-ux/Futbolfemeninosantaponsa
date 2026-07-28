const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");

const TAMANO_TANDA = 40;

// Misma tabla de categorías por año de nacimiento que admin/plantilla.html
// y mark-pago-pagado.js — si cambia una, hay que cambiar las demás.
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

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, GMAIL_USER, GMAIL_APP_PASSWORD, PUBLIC_SITE_URL, URL: SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase" };
  }
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
    return { statusCode: 500, body: "Faltan variables de entorno de email (GMAIL_USER / GMAIL_APP_PASSWORD)" };
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
  const { noticia_id, categoria } = payload;
  if (!noticia_id) {
    return { statusCode: 400, body: "Falta noticia_id" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: noticia, error: noticiaError } = await supabase
    .from("news")
    .select("id, titulo, resumen, imagen_url, publicado, boton_texto, boton_url")
    .eq("id", noticia_id)
    .single();
  if (noticiaError || !noticia) {
    return { statusCode: 404, body: "No se ha encontrado esa noticia" };
  }
  if (!noticia.publicado) {
    return { statusCode: 400, body: "Esta noticia todavía es un borrador — publícala antes de enviarla por email" };
  }

  const { data: inscripciones, error: insError } = await supabase
    .from("inscripciones")
    .select("tutor_email, tutor2_email, jugadora_fecha_nacimiento");
  if (insError) {
    return { statusCode: 500, body: "No se han podido cargar los emails de las familias: " + insError.message };
  }

  const inscripcionesFiltradas = categoria
    ? (inscripciones || []).filter((i) => {
        const anio = i.jugadora_fecha_nacimiento ? Number(String(i.jugadora_fecha_nacimiento).slice(0, 4)) : null;
        return anio && categoriaPorAnio(anio) === categoria;
      })
    : (inscripciones || []);

  const emails = Array.from(new Set(
    inscripcionesFiltradas
      .flatMap((i) => [i.tutor_email, i.tutor2_email])
      .filter(Boolean)
      .map((e) => e.trim().toLowerCase())
  ));

  if (!emails.length) {
    return { statusCode: 400, body: categoria ? `No hay ninguna familia registrada en la categoría ${categoria}` : "Todavía no hay ninguna familia registrada con email" };
  }

  const baseUrl = PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info";
  const noticiaUrl = `${baseUrl}/noticia.html?id=${noticia_id}`;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });

  const cuerpoHtml = `
    ${noticia.imagen_url ? `<p><img src="${noticia.imagen_url}" alt="" style="max-width:100%;border-radius:8px;"></p>` : ""}
    <h2 style="margin:0 0 0.6rem;">${noticia.titulo}</h2>
    ${noticia.resumen ? `<p>${noticia.resumen}</p>` : ""}
    <p><a href="${noticiaUrl}" style="display:inline-block;background:#a855f7;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Leer la noticia completa</a></p>
    ${noticia.boton_url ? `<p><a href="${noticia.boton_url}" style="display:inline-block;background:#17151b;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">${noticia.boton_texto || "Más información"}</a></p>` : ""}
    <p style="font-size:0.86rem;color:#666;">Recibes este email porque tu familia está registrada en Fútbol Femenino Santa Ponça.</p>
  `;

  let enviados = 0;
  const errores = [];
  for (let i = 0; i < emails.length; i += TAMANO_TANDA) {
    const tanda = emails.slice(i, i + TAMANO_TANDA);
    try {
      await transporter.sendMail({
        from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
        to: GMAIL_USER,
        bcc: tanda,
        subject: `${noticia.titulo} — Fútbol Femenino Santa Ponça`,
        html: cuerpoHtml,
      });
      enviados += tanda.length;
    } catch (err) {
      errores.push(err.message);
    }
  }

  await supabase.from("news").update({ email_enviado_en: new Date().toISOString() }).eq("id", noticia_id);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, enviados, total: emails.length, errores }),
  };
};
