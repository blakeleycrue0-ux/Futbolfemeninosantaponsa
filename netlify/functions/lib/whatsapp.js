/*
  Envío de WhatsApp vía WhatsApp Business Platform (Cloud API) de Meta —
  API oficial directa, sin SDK ni proveedor de terceros (solo fetch, ya
  disponible en el runtime de Netlify Functions).
  Referencia: https://developers.facebook.com/docs/whatsapp/cloud-api/reference/messages

  Este envío lo inicia el club (no es una respuesta dentro de las 24h de
  una conversación abierta por la propia familia), así que la Cloud API
  exige usar una plantilla ya aprobada en Meta Business Manager — no se
  puede mandar texto libre. Ver WHATSAPP_TEMPLATE_NAME más abajo.

  Si faltan las credenciales (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID),
  esta función no falla: funciona en modo simulado (no llama a Meta) y
  devuelve { ok:true, mock:true } con lo que se habría enviado, para poder
  probar el flujo completo de "Aceptar" sin credenciales reales todavía.

  Plantilla a dar de alta y aprobar en Meta Business Manager (nombre por
  defecto "plaza_aceptada", categoría UTILITY, idioma es, cuerpo con
  exactamente 2 variables — {{1}} nombre del tutor/a, {{2}} enlace):

    Hola, {{1}}. Tu solicitud ha sido aceptada. Puedes completar ahora tu
    inscripción desde este enlace privado:

    {{2}}

    Si tienes cualquier problema, ponte en contacto con nosotros.
*/

// Normaliza un teléfono español a formato E.164 sin "+" (el que pide la
// Cloud API), p.ej. "676 04 01 11" -> "34676040111". Devuelve null si no
// tiene pinta de móvil español válido (WhatsApp solo funciona con
// móviles, no con fijos).
function normalizarTelefonoEs(raw) {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d]/g, "");
  if (d.startsWith("0034")) d = d.slice(4);
  if (d.startsWith("34") && d.length === 11) return /^34[67]/.test(d) ? d : null;
  if (d.length === 9 && /^[67]/.test(d)) return "34" + d;
  return null;
}

async function enviarWhatsappPlazaAceptada({ telefono, nombre, enlace }) {
  const numero = normalizarTelefonoEs(telefono);
  if (!numero) {
    return { ok: false, skipped: true, error: "Número de teléfono no válido para WhatsApp (se esperaba un móvil español)." };
  }

  const { WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_TEMPLATE_NAME, WHATSAPP_API_VERSION } = process.env;

  if (!WHATSAPP_ACCESS_TOKEN || !WHATSAPP_PHONE_NUMBER_ID) {
    console.info("[whatsapp] Faltan WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID — modo simulado. Se habría enviado a " + numero, { nombre, enlace });
    return { ok: true, mock: true };
  }

  const version = WHATSAPP_API_VERSION || "v21.0";
  const templateName = WHATSAPP_TEMPLATE_NAME || "plaza_aceptada";

  let res;
  try {
    res = await fetch(`https://graph.facebook.com/${version}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: numero,
        type: "template",
        template: {
          name: templateName,
          language: { code: "es" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: nombre || "" },
                { type: "text", text: enlace },
              ],
            },
          ],
        },
      }),
    });
  } catch (err) {
    return { ok: false, error: "No se ha podido contactar con la API de WhatsApp: " + err.message };
  }

  if (!res.ok) {
    let detail = "";
    try { detail = JSON.stringify(await res.json()); } catch (err) { /* respuesta no era JSON */ }
    return { ok: false, error: `WhatsApp API respondió ${res.status}: ${detail}` };
  }

  return { ok: true };
}

module.exports = { enviarWhatsappPlazaAceptada, normalizarTelefonoEs };
