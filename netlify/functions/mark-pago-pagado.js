/*
  mark-pago-pagado.js — Netlify Function
  ============================================================================
  Admin-only. El club cobra por transferencia bancaria (sin tarjeta, sin
  comisión de Stripe) — cuando ve el ingreso en la cuenta, marca la cuota
  correspondiente como pagada desde aquí. Recalcula el estado general de la
  inscripción igual que hacía antes el webhook de Stripe: 'pagado' si todos
  los plazos están pagados, 'pago_parcial' si solo alguno, 'pendiente' si
  ninguno.

  Requiere que quien llama esté autenticado como admin (mismo esquema que
  confirm-inscripcion.js).

  Variables de entorno requeridas:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
  ============================================================================
*/
const { createClient } = require("@supabase/supabase-js");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY } = process.env;
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
    .select("id, inscripcion_id")
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

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ok: true }),
  };
};
