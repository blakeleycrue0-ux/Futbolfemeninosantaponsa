const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");

// URLs reales de la FFIB para el equipo de 3ª RFEF (temporada 2026/27) —
// confirmadas a mano por el club, no adivinadas. Si el año que viene la
// FFIB cambia los códigos de competición, sobrescribe con las variables de
// entorno FFIB_JORNADA_URL / FFIB_CLASIFICACION_URL en vez de tocar esto.
const DEFAULT_JORNADA_URL =
  "https://www.ffib.es/Fed/NPcd/NFG_VisCalendario_Vis?cod_primaria=1000110&codtemporada=22&codcompeticion=23348501&codgrupo=23348502";
const DEFAULT_CLASIFICACION_URL =
  "https://www.ffib.es/Fed/NPcd/NFG_VisClasificacion?cod_primaria=1000110&codgrupo=23348502&codcompeticion=23348501&codjornada=";
const DEFAULT_TEAM_CATEGORIA = "3ª RFEF";

// ffib.es es una web antigua (ASP.NET) que puede exigir cookie de sesión
// entre peticiones y bloquear en silencio (200 con cuerpo vacío) a
// clientes que se identifican como bot. Usamos una cabecera de navegador
// normal y corriente, y dejamos pasar la cookie de sesión de una petición
// a la siguiente en vez de hacerlas totalmente sueltas.
async function fetchHtml(url, cookie) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "es-ES,es;q=0.9",
      Referer: "https://www.ffib.es/",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  if (!res.ok) throw new Error(`FFIB respondió ${res.status} en ${url}`);
  const setCookie = res.headers.get("set-cookie");
  const html = await res.text();
  return { html, setCookie };
}

// -- Parseo de clasificación --------------------------------------------
// Las páginas de clasificación de la FFIB publican una tabla HTML con una
// fila por equipo. Buscamos la primera tabla que tenga suficientes columnas
// numéricas (PJ, PG, PE, PP, GF, GC, Pts) en vez de depender de un id/clase
// concreto, porque esos ids cambian entre plantillas de la federación.
function parseClasificacion(html) {
  const $ = cheerio.load(html);
  const rows = [];

  $("table").each((_, table) => {
    const $table = $(table);
    const bodyRows = $table.find("tr").toArray();
    const parsed = [];

    bodyRows.forEach((tr) => {
      const cells = $(tr)
        .find("td")
        .toArray()
        .map((td) => $(td).text().trim());
      if (cells.length < 8) return;

      // Heurística: última columna numérica = puntos; penúltimas = GC/GF...
      const numericTail = cells.slice(-7).map((c) => parseInt(c.replace(/[^\d-]/g, ""), 10));
      if (numericTail.some((n) => Number.isNaN(n))) return;

      const [pj, pg, pe, pp, gf, gc, pts] = numericTail;
      const nombreEquipo = cells[1] || cells[0];
      if (!nombreEquipo) return;

      parsed.push({
        equipo: nombreEquipo,
        pj, pg, pe, pp, gf, gc,
        puntos: pts,
      });
    });

    if (parsed.length > rows.length) {
      rows.length = 0;
      rows.push(...parsed);
    }
  });

  return rows.map((r, i) => ({ posicion: i + 1, ...r }));
}

// -- Parseo de jornada / resultados --------------------------------------
// Igual de tolerante: busca bloques "Equipo A  N - M  Equipo B" repetidos
// en la tabla de la jornada.
function parseJornada(html) {
  const $ = cheerio.load(html);
  const matches = [];

  $("table tr").each((_, tr) => {
    const text = $(tr).text().replace(/\s+/g, " ").trim();
    const m = text.match(/(.+?)\s+(\d+)\s*-\s*(\d+)\s+(.+)/);
    if (!m) return;
    const [, local, golesLocal, golesVisitante, visitante] = m;
    if (!local.trim() || !visitante.trim()) return;
    matches.push({
      local: local.trim(),
      visitante: visitante.trim(),
      goles_local: parseInt(golesLocal, 10),
      goles_visitante: parseInt(golesVisitante, 10),
    });
  });

  return matches;
}

// Cuando el parser no reconoce el formato, describe qué hay realmente en la
// página (número de tablas, filas y una muestra de celdas) para poder
// ajustar el parser sin tener que abrir ffib.es directamente. Si no hay
// ninguna tabla, mira también si el contenido real está en un <iframe> (muy
// típico en webs antiguas tipo ASP.NET) y qué texto visible hay en el body.
function diagnosticoHtml(html, $) {
  const tablas = $("table").toArray();
  if (tablas.length) {
    const resumen = tablas.slice(0, 3).map((t, i) => {
      const $t = $(t);
      const filas = $t.find("tr").toArray();
      const muestra = filas.slice(0, 2).map((tr) =>
        $(tr).find("td,th").toArray().map((c) => $(c).text().trim()).filter(Boolean).join(" | ")
      );
      return `tabla ${i + 1}: ${filas.length} filas — ${muestra.join(" // ")}`;
    });
    return `${tablas.length} tablas. ${resumen.join(" · ")}`;
  }
  const iframes = $("iframe").toArray().map((f) => $(f).attr("src")).filter(Boolean);
  const scripts = $("script[src]").length;
  const textoVisible = $("body").text().replace(/\s+/g, " ").trim().slice(0, 300);
  return `0 tablas. HTML: ${html.length} caracteres, ${scripts} <script src>. iframes: ${iframes.length ? iframes.join(", ") : "ninguno"}. Texto del body: "${textoVisible}"`;
}

async function logResult(supabase, teamId, ok, mensaje) {
  await supabase.from("ffib_sync_log").insert({ team_id: teamId, ok, mensaje });
}

// Nombre con el que aparece el club en ffib.es — comparten club con el
// equipo masculino porque todavía no tienen federado uno propio, así que
// en la FFIB salen como "Santa Ponsa CF" (sin cedilla), no como "Fútbol
// Femenino Santa Ponça". Confirmado a mano por el club, no adivinado.
const NOMBRE_EN_FFIB = "santa ponsa";

async function resolverTeamId(supabase, teamIdEnv) {
  if (teamIdEnv) return teamIdEnv;
  const { data: team } = await supabase
    .from("teams")
    .select("id")
    .eq("categoria", DEFAULT_TEAM_CATEGORIA)
    .limit(1)
    .maybeSingle();
  return team && team.id;
}

async function ejecutarSincronizacion() {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    FFIB_TEAM_ID,
    FFIB_JORNADA_URL,
    FFIB_CLASIFICACION_URL,
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const teamId = await resolverTeamId(supabase, FFIB_TEAM_ID);
  if (!teamId) {
    return { statusCode: 500, body: `No se ha encontrado ningún equipo con categoría "${DEFAULT_TEAM_CATEGORIA}" para sincronizar` };
  }

  const clasifUrl = FFIB_CLASIFICACION_URL || DEFAULT_CLASIFICACION_URL;
  const jornadaUrl = FFIB_JORNADA_URL || DEFAULT_JORNADA_URL;

  const results = { standings: false, matches: false, errors: [] };

  // Visita primero la portada de ffib.es para conseguir una cookie de
  // sesión válida y usarla en las dos peticiones siguientes — sin ella,
  // esta web antigua puede responder 200 con el cuerpo vacío.
  let cookie;
  try {
    const inicio = await fetchHtml("https://www.ffib.es/");
    cookie = inicio.setCookie || undefined;
  } catch (err) {
    // Si falla, seguimos sin cookie — puede que no haga falta.
  }

  // --- Clasificación ---
  try {
    const { html, setCookie } = await fetchHtml(clasifUrl, cookie);
    if (setCookie) cookie = setCookie;
    const standings = parseClasificacion(html);
    if (!standings.length) throw new Error("Tabla de clasificación vacía o formato no reconocido — " + diagnosticoHtml(html, cheerio.load(html)));

    const rows = standings.map((s) => ({
      team_id: teamId,
      posicion: s.posicion,
      equipo: s.equipo,
      es_club: s.equipo.toLowerCase().includes(NOMBRE_EN_FFIB),
      pj: s.pj, pg: s.pg, pe: s.pe, pp: s.pp, gf: s.gf, gc: s.gc, puntos: s.puntos,
      actualizado_en: new Date().toISOString(),
    }));

    await supabase.from("ffib_standings").delete().eq("team_id", teamId);
    const { error: insertErr } = await supabase.from("ffib_standings").insert(rows);
    if (insertErr) throw insertErr;

    results.standings = true;
    await logResult(supabase, teamId, true, `Clasificación actualizada (${rows.length} equipos)`);
  } catch (err) {
    results.errors.push(`clasificacion: ${err.message}`);
    await logResult(supabase, teamId, false, `Error clasificación: ${err.message}`);
  }

  // --- Jornada / resultados ---
  try {
    const { html } = await fetchHtml(jornadaUrl, cookie);
    const parsed = parseJornada(html);
    if (!parsed.length) throw new Error("Jornada vacía o formato no reconocido — " + diagnosticoHtml(html, cheerio.load(html)));

    const ownMatches = parsed.filter(
      (m) => m.local.toLowerCase().includes(NOMBRE_EN_FFIB) || m.visitante.toLowerCase().includes(NOMBRE_EN_FFIB)
    );

    let upserted = 0;
    for (const m of ownMatches) {
      const esLocal = m.local.toLowerCase().includes(NOMBRE_EN_FFIB);
      const rival = esLocal ? m.visitante : m.local;
      const golesEquipo = esLocal ? m.goles_local : m.goles_visitante;
      const golesRival = esLocal ? m.goles_visitante : m.goles_local;
      const sourceId = `${m.local}-${m.visitante}`.replace(/\s+/g, "_");

      const { error } = await supabase.from("matches").upsert(
        {
          team_id: teamId,
          rival,
          condicion: esLocal ? "local" : "visitante",
          estado: "jugado",
          goles_equipo: golesEquipo,
          goles_rival: golesRival,
          fuente: "ffib",
          ffib_source_id: sourceId,
          fecha: new Date().toISOString().slice(0, 10),
          actualizado_en: new Date().toISOString(),
        },
        { onConflict: "ffib_source_id" }
      );
      if (!error) upserted += 1;
    }

    results.matches = true;
    await logResult(supabase, teamId, true, `Jornada sincronizada (${upserted}/${ownMatches.length} partidos)`);
  } catch (err) {
    results.errors.push(`jornada: ${err.message}`);
    await logResult(supabase, teamId, false, `Error jornada: ${err.message}`);
  }

  const statusCode = results.errors.length ? 207 : 200;
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(results),
  };
}

module.exports = { ejecutarSincronizacion };
