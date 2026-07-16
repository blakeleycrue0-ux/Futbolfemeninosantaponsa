/*
  upload-comprobante.js — Netlify Function
  ============================================================================
  Escritura pública (solo POST) llamada desde pago.html cuando la familia
  sube la foto/captura del justificante de su transferencia bancaria. Se
  guarda en el bucket de Storage "comprobantes" (público, con el id de la
  inscripción y del plazo como ruta — igual de "token de facto" que el resto
  de funciones de esta familia) y se apunta la URL en
  inscripcion_pagos.comprobante_url para que el admin la revise antes de
  marcar la cuota como pagada.

  Solo se permite subir un justificante a un plazo (inscripcion_pagos) que
  ya existe — no se puede inventar un pago_id al azar porque hace falta que
  la fila exista de antemano (la crea select-plan-pago.js). Si ya había un
  justificante subido, este lo sustituye (por si se equivocaron de foto).

  Variables de entorno requeridas: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");

const TIPOS_PERMITIDOS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
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

  const { pago_id, file_base64, file_type } = payload;
  if (!pago_id || !file_base64 || !file_type) {
    return { statusCode: 400, body: "Falta pago_id, file_base64 o file_type" };
  }
  const extension = TIPOS_PERMITIDOS[file_type];
  if (!extension) {
    return { statusCode: 400, body: "Formato no admitido — sube una foto (JPG, PNG, HEIC), un WEBP o un PDF" };
  }

  const base64Limpio = file_base64.includes(",") ? file_base64.split(",").pop() : file_base64;
  const buffer = Buffer.from(base64Limpio, "base64");
  if (buffer.length > TAMANO_MAXIMO_BYTES) {
    return { statusCode: 400, body: "El archivo pesa demasiado — sube una imagen de menos de 8 MB" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: pago, error: pagoError } = await supabase
    .from("inscripcion_pagos")
    .select("id, inscripcion_id, numero_cuota")
    .eq("id", pago_id)
    .single();
  if (pagoError || !pago) {
    return { statusCode: 404, body: "No se ha encontrado ese plazo de pago" };
  }

  const ruta = `${pago.inscripcion_id}/cuota-${pago.numero_cuota}-${Date.now()}.${extension}`;
  const { error: uploadError } = await supabase.storage
    .from("comprobantes")
    .upload(ruta, buffer, { contentType: file_type, upsert: false });
  if (uploadError) {
    return { statusCode: 502, body: "No se ha podido subir el archivo: " + uploadError.message };
  }

  const { data: urlData } = supabase.storage.from("comprobantes").getPublicUrl(ruta);
  const comprobanteUrl = urlData && urlData.publicUrl;

  const { error: updateError } = await supabase
    .from("inscripcion_pagos")
    .update({ comprobante_url: comprobanteUrl, comprobante_subido_en: new Date().toISOString() })
    .eq("id", pago_id);
  if (updateError) {
    return { statusCode: 500, body: "El archivo se subió pero no se ha podido guardar el enlace: " + updateError.message };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true, comprobante_url: comprobanteUrl }),
  };
};
