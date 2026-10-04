/*
  Lee una captura de pantalla del acta/resultado de un partido en la web de
  la FFIB y extrae goles y tarjetas por jugadora con la API de Claude
  (visión). Pensado para sustituir el scraping automático de ese dato
  concreto: la FFIB bloquea en silencio las peticiones que no parecen un
  navegador normal, así que en vez de pelearnos con eso, es la propia
  persona del club quien hace la captura (como cualquier visitante) y Claude
  solo la lee — no hay ninguna petición automática a ffib.es aquí dentro.

  Solo PROPONE datos: admin/partidos.html los usa para rellenar la tabla de
  estadísticas, pero quien gestiona el club tiene que revisarlos y pulsar
  "Guardar estadísticas" igual que si los hubiera escrito a mano. Nunca se
  guarda nada automáticamente desde aquí.

  Requiere Authorization: Bearer <access_token> de una cuenta con
  role = 'admin' en app_admins (no vale "staff" — esto no es control de
  acceso de partido, es gestión del club).
*/
const { createClient } = require("@supabase/supabase-js");

const MODELO_POR_DEFECTO = "claude-haiku-4-5-20251001";
const MAX_IMAGEN_BASE64_BYTES = 4.5 * 1024 * 1024; // deja margen bajo el límite de 6MB de la Function

// Claude a veces envuelve el JSON en ```json ... ``` a pesar de que se le pida que no lo haga.
function sinBloquesDeCodigo(t) {
  return t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, ANTHROPIC_ACTA_MODEL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase" };
  }
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: "Falta ANTHROPIC_API_KEY — todavía no se puede analizar capturas con IA." };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }
  const { image_base64, image_media_type, equipo_propio, rival, jugadoras } = payload;
  if (!image_base64 || !image_media_type) {
    return { statusCode: 400, body: "Falta la imagen." };
  }
  if (!["image/png", "image/jpeg", "image/webp"].includes(image_media_type)) {
    return { statusCode: 400, body: "Formato de imagen no soportado (usa PNG, JPG o WEBP)." };
  }
  if (image_base64.length > MAX_IMAGEN_BASE64_BYTES) {
    return { statusCode: 413, body: "La captura pesa demasiado — recórtala a solo la parte del acta/resultado e inténtalo de nuevo." };
  }
  if (!Array.isArray(jugadoras) || !jugadoras.length) {
    return { statusCode: 400, body: "Falta la lista de jugadoras del equipo (¿tiene plantilla este equipo?)." };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return { statusCode: 401, body: "Inicia sesión." };

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabase.auth.getUser(jwt);
  if (userError || !userData || !userData.user) {
    return { statusCode: 401, body: "Sesión no válida." };
  }
  const { data: cuenta } = await supabase.from("app_admins").select("role").ilike("email", userData.user.email).maybeSingle();
  if (!cuenta || cuenta.role !== "admin") {
    return { statusCode: 403, body: "Esta cuenta no tiene permiso para usar esta herramienta." };
  }

  const rosterTexto = jugadoras.map((j) => `- id: ${j.id} · nombre: ${j.nombre}`).join("\n");
  const prompt = `Esta es una captura de pantalla del acta o resultado de un partido de fútbol femenino en la web de la FFIB (Federació de Futbol de les Illes Balears).

El equipo del club es "${equipo_propio}" y el rival es "${rival}".

Plantilla real del equipo del club (usa EXACTAMENTE estos ids cuando reconozcas a una jugadora; si el nombre de la captura no coincide con confianza con ninguno de estos, deja jugadora_id en null):
${rosterTexto}

Léela y responde ÚNICAMENTE con un objeto JSON (sin bloques de código, sin texto antes ni después), con esta forma exacta:
{
  "resultado": { "goles_equipo": <number|null>, "goles_rival": <number|null> },
  "jugadoras": [
    { "jugadora_id": "<uuid de la lista de arriba, o null si no estás segura>", "nombre_detectado": "<nombre tal cual lo ves en la imagen>", "goles": <number>, "tarjetas_amarillas": <number>, "tarjetas_rojas": <number> }
  ],
  "aviso": "<texto corto si la imagen no se lee bien, falta información, o está incompleta — si no hay nada que avisar, cadena vacía>"
}

Reglas:
- Incluye en "jugadoras" SOLO a jugadoras del equipo del club (${equipo_propio}), nunca del rival.
- Si una jugadora del club no tiene goles ni tarjetas en el acta, no hace falta incluirla.
- Si no puedes leer la imagen con confianza razonable, deja "jugadoras" como array vacío y explica por qué en "aviso".
- No inventes datos que no veas en la imagen.`;

  let anthropicRes;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_ACTA_MODEL || MODELO_POR_DEFECTO,
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: image_media_type, data: image_base64 } },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });
  } catch (err) {
    return { statusCode: 502, body: "No se ha podido contactar con la API de Claude: " + err.message };
  }

  if (!anthropicRes.ok) {
    const textoError = await anthropicRes.text().catch(() => "");
    return { statusCode: 502, body: `La API de Claude ha devuelto un error (${anthropicRes.status}): ${textoError.slice(0, 500)}` };
  }

  const data = await anthropicRes.json();
  const textoRespuesta = (data.content || []).map((b) => b.text || "").join("").trim();

  let extraido;
  try {
    extraido = JSON.parse(sinBloquesDeCodigo(textoRespuesta));
  } catch (err) {
    return { statusCode: 502, body: "Claude ha respondido, pero no en el formato esperado. Prueba con una captura más clara o más recortada." };
  }

  const idsValidos = new Set(jugadoras.map((j) => j.id));
  const jugadorasLimpias = Array.isArray(extraido.jugadoras)
    ? extraido.jugadoras
        .filter((j) => j && (j.goles || j.tarjetas_amarillas || j.tarjetas_rojas))
        .map((j) => ({
          jugadora_id: j.jugadora_id && idsValidos.has(j.jugadora_id) ? j.jugadora_id : null,
          nombre_detectado: String(j.nombre_detectado || "").slice(0, 120),
          goles: Number(j.goles) || 0,
          tarjetas_amarillas: Number(j.tarjetas_amarillas) || 0,
          tarjetas_rojas: Number(j.tarjetas_rojas) || 0,
        }))
    : [];

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      resultado: extraido.resultado || null,
      jugadoras: jugadorasLimpias,
      aviso: extraido.aviso || "",
    }),
  };
};
