/*
  Alta en la newsletter de la tienda FFSP. Sin policy pública de insert en
  shop_newsletter_subscribers (ver schema.sql) — todo pasa por aquí con la
  service role, para poder validar el email en servidor antes de guardarlo.
  No envía ningún email de verdad (no hay proveedor de email configurado
  para esto todavía) — solo guarda el alta con su consentimiento.
*/
const { createClient } = require("@supabase/supabase-js");

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase" };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }

  const email = (payload.email || "").trim().toLowerCase();
  if (!email || !emailValido(email)) {
    return { statusCode: 400, body: "Escribe un email válido." };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await supabase
    .from("shop_newsletter_subscribers")
    .upsert({ email, consentimiento_en: new Date().toISOString(), baja_en: null }, { onConflict: "email" });
  if (error) {
    return { statusCode: 500, body: "No se ha podido guardar: " + error.message };
  }

  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
};
