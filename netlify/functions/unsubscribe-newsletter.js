/*
  Baja de la newsletter de la tienda — GDPR: cualquiera puede darse de baja
  sin iniciar sesión, solo con su email. No borra la fila (se queda el
  historial de consentimiento con baja_en puesto) para poder demostrar que
  se respetó la baja si hiciera falta.
*/
const { createClient } = require("@supabase/supabase-js");

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
  if (!email) {
    return { statusCode: 400, body: "Falta el email." };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  await supabase
    .from("shop_newsletter_subscribers")
    .update({ baja_en: new Date().toISOString() })
    .eq("email", email);

  // Siempre "ok", exista o no ese email — no se confirma si un email está
  // o no en la lista a quien no lo haya demostrado por otra vía.
  return { statusCode: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: true }) };
};
