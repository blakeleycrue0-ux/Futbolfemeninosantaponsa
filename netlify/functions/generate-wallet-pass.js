/*
  Genera el .pkpass de Apple Wallet para una membresía (socio/abono) o una
  entrada de partido. Necesita un certificado de Apple Developer Program
  que, a día de escribir esto, el club todavía no tiene — mientras
  APPLE_* no estén definidas, esta Function responde "no configurado" en
  vez de devolver un .pkpass falso (nunca se simula un pase real).

  GET /.netlify/functions/generate-wallet-pass?membership=<id>
  GET /.netlify/functions/generate-wallet-pass?ticket=<id>
  Requiere Authorization: Bearer <access_token> de la propia dueña del
  carnet/entrada.
*/
const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const MODEL_DIR = path.join(__dirname, "lib", "wallet-pass-model");

function leerModelo() {
  const archivos = ["pass.json", "icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "logo@3x.png"];
  const buffers = {};
  for (const nombre of archivos) buffers[nombre] = fs.readFileSync(path.join(MODEL_DIR, nombre));
  return buffers;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const {
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    APPLE_TEAM_IDENTIFIER, APPLE_PASS_TYPE_IDENTIFIER,
    APPLE_PASS_CERT_BASE64, APPLE_PASS_KEY_BASE64, APPLE_PASS_KEY_PASSWORD,
    APPLE_WWDR_CERT_BASE64,
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase" };
  }

  const faltan = [];
  if (!APPLE_TEAM_IDENTIFIER) faltan.push("APPLE_TEAM_IDENTIFIER");
  if (!APPLE_PASS_TYPE_IDENTIFIER) faltan.push("APPLE_PASS_TYPE_IDENTIFIER");
  if (!APPLE_PASS_CERT_BASE64) faltan.push("APPLE_PASS_CERT_BASE64");
  if (!APPLE_PASS_KEY_BASE64) faltan.push("APPLE_PASS_KEY_BASE64");
  if (!APPLE_WWDR_CERT_BASE64) faltan.push("APPLE_WWDR_CERT_BASE64");
  if (faltan.length) {
    return {
      statusCode: 501,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        configured: false,
        error: "Apple Wallet todavía no está configurado — faltan estas variables de entorno: " + faltan.join(", "),
      }),
    };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return { statusCode: 401, body: "Inicia sesión." };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    return { statusCode: 401, body: "Sesión no válida." };
  }
  const user = userData.user;

  const params = event.queryStringParameters || {};
  let titulo, subtitulo, credencialToken;

  if (params.membership) {
    const { data: membership } = await supabase
      .from("memberships")
      .select("*, ticket_products(nombre), teams(nombre)")
      .eq("id", params.membership)
      .eq("user_id", user.id)
      .single();
    if (!membership) return { statusCode: 404, body: "Membresía no encontrada." };
    const { data: credencial } = await supabase.from("access_credentials").select("token").eq("membership_id", membership.id).single();
    if (!credencial) return { statusCode: 404, body: "Esta membresía no tiene credencial." };
    titulo = membership.ticket_products.nombre;
    subtitulo = `Nº ${String(membership.member_number).padStart(4, "0")} · ${membership.teams ? membership.teams.nombre : "Todo el club"} · ${membership.temporada}`;
    credencialToken = credencial.token;
  } else if (params.ticket) {
    const { data: ticket } = await supabase
      .from("tickets")
      .select("*, matches(rival, fecha, hora)")
      .eq("id", params.ticket)
      .eq("user_id", user.id)
      .single();
    if (!ticket) return { statusCode: 404, body: "Entrada no encontrada." };
    const { data: credencial } = await supabase.from("access_credentials").select("token").eq("ticket_id", ticket.id).single();
    if (!credencial) return { statusCode: 404, body: "Esta entrada no tiene credencial." };
    titulo = `vs ${ticket.matches.rival}`;
    subtitulo = ticket.matches.fecha;
    credencialToken = credencial.token;
  } else {
    return { statusCode: 400, body: "Falta membership o ticket." };
  }

  let PKPass;
  try {
    PKPass = require("passkit-generator").PKPass;
  } catch (err) {
    return { statusCode: 500, body: "passkit-generator no está disponible: " + err.message };
  }

  try {
    const pass = new PKPass(leerModelo(), {
      wwdr: Buffer.from(APPLE_WWDR_CERT_BASE64, "base64"),
      signerCert: Buffer.from(APPLE_PASS_CERT_BASE64, "base64"),
      signerKey: Buffer.from(APPLE_PASS_KEY_BASE64, "base64"),
      signerKeyPassphrase: APPLE_PASS_KEY_PASSWORD || undefined,
    }, {
      passTypeIdentifier: APPLE_PASS_TYPE_IDENTIFIER,
      teamIdentifier: APPLE_TEAM_IDENTIFIER,
      serialNumber: credencialToken,
      description: titulo,
    });

    pass.headerFields.push({ key: "club", label: "FFSP", value: "" });
    pass.primaryFields.push({ key: "titulo", label: "", value: titulo });
    pass.secondaryFields.push({ key: "detalle", label: "DETALLE", value: subtitulo });
    pass.secondaryFields.push({ key: "titular", label: "TITULAR", value: user.email });
    pass.setBarcodes(credencialToken);

    const buffer = pass.getAsBuffer();
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/vnd.apple.pkpass",
        "Content-Disposition": 'attachment; filename="ffsp.pkpass"',
      },
      body: buffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    return { statusCode: 500, body: "No se ha podido generar el pase de Wallet: " + err.message };
  }
};
