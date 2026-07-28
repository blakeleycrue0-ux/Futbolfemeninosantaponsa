const cheerio = require("cheerio");
const { createClient } = require("@supabase/supabase-js");

const DEFAULT_JORNADA_TEMPLATE = "https://www.ffib.es/Fed/NPcd/NFG_CmpJornada?cod_primaria=1000114&cod_competicion={cod}";
const DEFAULT_CLASIFICACION_TEMPLATE = "https://www.ffib.es/Fed/NPcd/NFG_CmpClasificacion?cod_primaria=1000114&cod_competicion={cod}";

function buildUrl(template, cod) {
  return template.replace("{cod}", encodeURIComponent(cod));
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; SPFC-Web/1.0; +https://futbolfemeninosantaponsa.netlify.app)",
      Accept: "text/html",
    },
  });
  if (!res.ok) throw new Error(`FFIB respondió ${res.status} en ${url}`);
  return res.text();
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

async function logResult(supabase, teamId, ok, mensaje) {
  await supabase.from("ffib_sync_log").insert({ team_id: teamId, ok, mensaje });
}

exports.handler = async function () {
  const {
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    FFIB_COMPETITION_ID,
    FFIB_TEAM_ID,
    FFIB_JORNADA_URL_TEMPLATE,
    FFIB_CLASIFICACION_URL_TEMPLATE,
  } = process.env;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" };
  }
  if (!FFIB_COMPETITION_ID || !FFIB_TEAM_ID) {
    return { statusCode: 500, body: "Faltan FFIB_COMPETITION_ID / FFIB_TEAM_ID" };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const clasifUrl = buildUrl(FFIB_CLASIFICACION_URL_TEMPLATE || DEFAULT_CLASIFICACION_TEMPLATE, FFIB_COMPETITION_ID);
  const jornadaUrl = buildUrl(FFIB_JORNADA_URL_TEMPLATE || DEFAULT_JORNADA_TEMPLATE, FFIB_COMPETITION_ID);

  const results = { standings: false, matches: false, errors: [] };

  // --- Clasificación ---
  try {
    const html = await fetchHtml(clasifUrl);
    const standings = parseClasificacion(html);
    if (!standings.length) throw new Error("Tabla de clasificación vacía o formato no reconocido");

    const { data: team } = await supabase.from("teams").select("nombre").eq("id", FFIB_TEAM_ID).single();
    const clubNombre = (team && team.nombre) || "Fútbol Femenino Santa Ponça";

    const rows = standings.map((s) => ({
      team_id: FFIB_TEAM_ID,
      posicion: s.posicion,
      equipo: s.equipo,
      es_club: s.equipo.toLowerCase().includes("santa ponsa") || s.equipo.toLowerCase().includes(clubNombre.toLowerCase().split(" ")[0]),
      pj: s.pj, pg: s.pg, pe: s.pe, pp: s.pp, gf: s.gf, gc: s.gc, puntos: s.puntos,
      actualizado_en: new Date().toISOString(),
    }));

    await supabase.from("ffib_standings").delete().eq("team_id", FFIB_TEAM_ID);
    const { error: insertErr } = await supabase.from("ffib_standings").insert(rows);
    if (insertErr) throw insertErr;

    results.standings = true;
    await logResult(supabase, FFIB_TEAM_ID, true, `Clasificación actualizada (${rows.length} equipos)`);
  } catch (err) {
    results.errors.push(`clasificacion: ${err.message}`);
    await logResult(supabase, FFIB_TEAM_ID, false, `Error clasificación: ${err.message}`);
  }

  // --- Jornada / resultados ---
  try {
    const html = await fetchHtml(jornadaUrl);
    const parsed = parseJornada(html);
    if (!parsed.length) throw new Error("Jornada vacía o formato no reconocido");

    const { data: team } = await supabase.from("teams").select("nombre").eq("id", FFIB_TEAM_ID).single();
    const clubNombre = ((team && team.nombre) || "Santa Ponça").toLowerCase();

    const ownMatches = parsed.filter(
      (m) => m.local.toLowerCase().includes("santa ponsa") || m.visitante.toLowerCase().includes("santa ponsa") ||
             m.local.toLowerCase().includes(clubNombre) || m.visitante.toLowerCase().includes(clubNombre)
    );

    let upserted = 0;
    for (const m of ownMatches) {
      const esLocal = m.local.toLowerCase().includes("santa ponsa") || m.local.toLowerCase().includes(clubNombre);
      const rival = esLocal ? m.visitante : m.local;
      const golesEquipo = esLocal ? m.goles_local : m.goles_visitante;
      const golesRival = esLocal ? m.goles_visitante : m.goles_local;
      const sourceId = `${FFIB_COMPETITION_ID}-${m.local}-${m.visitante}`.replace(/\s+/g, "_");

      const { error } = await supabase.from("matches").upsert(
        {
          team_id: FFIB_TEAM_ID,
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
    await logResult(supabase, FFIB_TEAM_ID, true, `Jornada sincronizada (${upserted}/${ownMatches.length} partidos)`);
  } catch (err) {
    results.errors.push(`jornada: ${err.message}`);
    await logResult(supabase, FFIB_TEAM_ID, false, `Error jornada: ${err.message}`);
  }

  const statusCode = results.errors.length ? 207 : 200;
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(results),
  };
};
