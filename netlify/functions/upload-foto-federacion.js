const { createClient } = require("@supabase/supabase-js");
const nodemailer = require("nodemailer");
const webpush = require("web-push");

const TIPOS_PERMITIDOS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};
const TAMANO_MAXIMO_BYTES = 8 * 1024 * 1024;

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }
  const { token, file_base64, file_type } = payload;
  if (!token || !file_base64 || !file_type) {
    return { statusCode: 400, body: "Faltan datos" };
  }
  const extension = TIPOS_PERMITIDOS[file_type];
  if (!extension) {
    return { statusCode: 400, body: "Formato no admitido — sube una foto en JPG, PNG, HEIC o WEBP" };
  }

  const base64Limpio = file_base64.includes(",") ? file_base64.split(",").pop() : file_base64;
  const buffer = Buffer.from(base64Limpio, "base64");
  if (buffer.length > TAMANO_MAXIMO_BYTES) {
    return { statusCode: 400, body: "El archivo pesa demasiado — sube una imagen de menos de 8 MB" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: player, error: playerError } = await supabase
    .from("players")
    .select("id, nombre")
    .eq("access_token", token)
    .single();
  if (playerError || !player) {
    return { statusCode: 404, body: "Enlace no válido" };
  }

  const ruta = `federacion/${player.id}-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("comprobantes")
    .upload(ruta, buffer, { contentType: file_type, upsert: false });
  if (uploadError) {
    return { statusCode: 502, body: "No se ha podido subir la foto: " + uploadError.message };
  }

  const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(ruta);
  const fotoUrl = urlData && urlData.publicUrl;

  const { error: updateError } = await supabase
    .from("players")
    .update({ foto_federacion_url: fotoUrl, foto_federacion_subida_en: new Date().toISOString() })
    .eq("id", player.id);
  if (updateError) {
    return { statusCode: 500, body: "La foto se subió pero no se ha podido guardar el enlace: " + updateError.message };
  }

  const { GMAIL_USER, GMAIL_APP_PASSWORD, PUBLIC_SITE_URL, URL: SITE_URL } = process.env;
  if (GMAIL_USER && GMAIL_APP_PASSWORD) {
    try {
      const baseUrl = PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info";
      const transporter = nodemailer.createTransport({ service: "gmail", auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
      await transporter.sendMail({
        from: `"Fútbol Femenino Santa Ponça" <${GMAIL_USER}>`,
        to: GMAIL_USER,
        subject: `Foto para ficha federativa recibida — ${player.nombre || ""}`,
        html: `
          <p>Se ha recibido la foto para la ficha de la Federación de <strong>${player.nombre || ""}</strong>.</p>
          <p><a href="${fotoUrl}" style="display:inline-block;background:#a855f7;color:#fff;padding:12px 24px;border-radius:4px;text-decoration:none;font-weight:bold;">Ver foto</a></p>
          <p>Esta foto no se publica en la web — es solo para el trámite con la Federación de Fútbol de Illes Balears.</p>
          <p>Puedes verla también desde <a href="${baseUrl}/admin/plantilla.html">Plantilla</a>.</p>
        `,
      });
    } catch (err) {
      // La foto ya se guardó bien.
    }
  }

  const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;
  if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    try {
      webpush.setVapidDetails(VAPID_SUBJECT || "mailto:ffsp2026@gmail.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
      const { data: subs } = await supabase.from("admin_push_subscriptions").select("*");
      const cuerpoNotificacion = JSON.stringify({
        titulo: "Foto de ficha federativa recibida",
        cuerpo: player.nombre || "",
        url: "/admin/plantilla.html",
      });
      const caducadas = [];
      await Promise.all((subs || []).map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, cuerpoNotificacion);
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) caducadas.push(sub.endpoint);
        }
      }));
      if (caducadas.length) {
        await supabase.from("admin_push_subscriptions").delete().in("endpoint", caducadas);
      }
    } catch (err) {
      // La foto ya se guardó bien.
    }
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, foto_federacion_url: fotoUrl }),
  };
};
