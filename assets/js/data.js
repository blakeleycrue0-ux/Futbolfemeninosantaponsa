/*
  Capa de datos compartida. Todas las páginas públicas llaman a estas
  funciones en lugar de usar window.spfc directamente. Si Supabase no está
  configurado, o una consulta falla, se devuelve contenido de respaldo
  (SPFC_FALLBACK) para que la web nunca se quede en blanco.
*/
window.SPFC_FALLBACK = {
  club: {
    nombre: "Fútbol Femenino Santa Ponça",
    equipo_primero_id: "3-rfef",
    ciudad: "Santa Ponça, Calvià, Mallorca",
  },
  teams: [],
  players: [],
  matches: [],
  standings: [],
  news: [],
  gallery: [],
  sponsors: [],
  destacado: null,
};

const SPFC_DATA = (function () {
  const client = () => window.spfc || null;

  async function safe(promiseFactory, fallback) {
    const c = client();
    if (!c) return fallback;
    try {
      const { data, error } = await promiseFactory(c);
      if (error) throw error;
      return data && data.length !== undefined ? (data.length ? data : fallback) : (data || fallback);
    } catch (err) {
      console.warn("[spfc-data] usando fallback:", err.message || err);
      return fallback;
    }
  }

  return {
    async teams() {
      return safe((c) => c.from("teams").select("*").order("orden"), window.SPFC_FALLBACK.teams);
    },
    async players(teamId) {
      return safe(
        (c) => c.from("players").select("*").eq("team_id", teamId).order("dorsal"),
        window.SPFC_FALLBACK.players.filter((p) => p.team_id === teamId)
      );
    },
    async playerById(id) {
      const all = await safe((c) => c.from("players").select("*").eq("id", id).limit(1), null);
      if (Array.isArray(all)) return all[0] || window.SPFC_FALLBACK.players.find((p) => p.id === id);
      return window.SPFC_FALLBACK.players.find((p) => p.id === id);
    },
    // Estadísticas partido a partido de una jugadora, con los datos del
    // partido ya incluidos (rival, fecha) — para el desglose en su ficha.
    async playerMatchStats(playerId) {
      return safe(
        (c) => c.from("match_player_stats").select("*, matches(rival, fecha, condicion)").eq("player_id", playerId).order("fecha", { foreignTable: "matches", ascending: false }),
        []
      );
    },
    // teamId es opcional: si no se pasa, mira partidos de CUALQUIER equipo
    // del club (así la portada nunca se queda "vacía" por estar mirando
    // solo a un equipo concreto).
    async upcomingMatch(teamId) {
      const list = await safe(
        (c) => {
          let q = c.from("matches").select("*").eq("estado", "programado").order("fecha").limit(1);
          if (teamId) q = q.eq("team_id", teamId);
          return q;
        },
        window.SPFC_FALLBACK.matches.filter((m) => m.estado === "programado" && (!teamId || m.team_id === teamId))
      );
      return Array.isArray(list) ? list[0] : list;
    },
    async recentResults(teamId, limit) {
      limit = limit || 5;
      return safe(
        (c) => {
          let q = c.from("matches").select("*").eq("estado", "jugado").order("fecha", { ascending: false }).limit(limit);
          if (teamId) q = q.eq("team_id", teamId);
          return q;
        },
        window.SPFC_FALLBACK.matches.filter((m) => m.estado === "jugado" && (!teamId || m.team_id === teamId)).slice(0, limit)
      );
    },
    async allMatches(teamId) {
      return safe(
        (c) => (teamId ? c.from("matches").select("*").eq("team_id", teamId).order("fecha", { ascending: false }) : c.from("matches").select("*").order("fecha", { ascending: false })),
        teamId ? window.SPFC_FALLBACK.matches.filter((m) => m.team_id === teamId) : window.SPFC_FALLBACK.matches
      );
    },
    async matchById(id) {
      const list = await safe((c) => c.from("matches").select("*").eq("id", id).limit(1), null);
      if (Array.isArray(list) && list[0]) return list[0];
      return window.SPFC_FALLBACK.matches.find((m) => m.id === id);
    },
    async standings(teamId) {
      return safe(
        (c) => c.from("ffib_standings").select("*").eq("team_id", teamId).order("posicion"),
        window.SPFC_FALLBACK.standings
      );
    },
    async news(limit) {
      return safe(
        (c) => c.from("news").select("*").eq("publicado", true).order("fecha", { ascending: false }).limit(limit || 20),
        window.SPFC_FALLBACK.news.slice(0, limit || 20)
      );
    },
    async newsById(id) {
      const list = await safe((c) => c.from("news").select("*").eq("id", id).limit(1), null);
      if (Array.isArray(list) && list[0]) return list[0];
      return window.SPFC_FALLBACK.news.find((n) => n.id === id);
    },
    async gallery(matchId) {
      return safe(
        (c) => (matchId ? c.from("gallery").select("*").eq("match_id", matchId).order("fecha", { ascending: false }) : c.from("gallery").select("*").order("fecha", { ascending: false })),
        window.SPFC_FALLBACK.gallery
      );
    },
    async sponsors() {
      return safe((c) => c.from("sponsors").select("*").order("nivel"), window.SPFC_FALLBACK.sponsors);
    },
    // Buscador del header: noticias + jugadoras + partidos que coincidan
    // con el texto, unos pocos resultados de cada uno.
    async search(q) {
      const c = client();
      if (!c || !q || !q.trim()) return { news: [], players: [], matches: [] };
      const term = `%${q.trim()}%`;
      const [news, players, matches] = await Promise.all([
        safe((c2) => c2.from("news").select("id,titulo,resumen,fecha").eq("publicado", true).ilike("titulo", term).order("fecha", { ascending: false }).limit(5), []),
        safe((c2) => c2.from("players").select("id,nombre,dorsal,team_id,foto_url").ilike("nombre", term).limit(5), []),
        safe((c2) => c2.from("matches").select("id,rival,fecha,team_id").ilike("rival", term).order("fecha", { ascending: false }).limit(5), []),
      ]);
      return { news: news || [], players: players || [], matches: matches || [] };
    },
    async destacado() {
      const list = await safe(
        (c) => c.from("destacado").select("*").eq("activo", true).order("actualizado_en", { ascending: false }).limit(1),
        window.SPFC_FALLBACK.destacado ? [window.SPFC_FALLBACK.destacado] : []
      );
      return Array.isArray(list) ? list[0] || null : list;
    },
    // Escritura pública (formulario de inscripción) — a diferencia del resto
    // de funciones de este objeto, no usa el patrón "safe": el formulario
    // necesita saber si el guardado falló para poder avisar a quien lo rellena.
    async submitInscripcion(payload, cuotas) {
      const c = client();
      if (!c) return { error: { message: "Supabase no está configurado en esta web." } };
      // Generamos el id en el cliente y no encadenamos .select() en los
      // inserts: quien rellena el formulario no está autenticado, y las
      // políticas RLS de lectura de "inscripciones"/"inscripcion_pagos"
      // son solo para admin — pedir de vuelta la fila insertada (RETURNING)
      // fallaría con "new row violates row-level security policy" aunque
      // el insert en sí esté permitido.
      const inscripcionId = crypto.randomUUID();
      const { error } = await c.from("inscripciones").insert(Object.assign({ id: inscripcionId }, payload));
      if (error) return { error };
      const data = { id: inscripcionId };
      let pagos = [];
      if (cuotas && cuotas.length) {
        const rows = cuotas.map((cu) => Object.assign({ id: crypto.randomUUID() }, cu, { inscripcion_id: inscripcionId }));
        const { error: pagosError } = await c.from("inscripcion_pagos").insert(rows);
        if (pagosError) return { data, error: pagosError };
        pagos = rows;
      }
      return { data, pagos };
    },
  };
})();

function spfcFormatDate(iso, opts) {
  if (!iso) return "";
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return d.toLocaleDateString("es-ES", opts || { day: "2-digit", month: "short", year: "numeric" });
}

function spfcResultLabel(m) {
  if (m.estado !== "jugado" || m.goles_equipo == null || m.goles_rival == null) return null;
  if (m.goles_equipo > m.goles_rival) return "W";
  if (m.goles_equipo < m.goles_rival) return "L";
  return "D";
}

/*
  "Escudo vs escudo, fecha/hora/competición, último resultado" — un solo
  componente para las tres páginas que lo necesitan (home, calendario,
  detalle de partido) en vez de tres implementaciones distintas. Devuelve
  el HTML del `.match-card.match-hero`; quien lo llame decide dónde
  colocarlo. Requiere `spfcFormatDate`/`spfcResultLabel` (arriba) y las
  clases ya existentes en components.css (.match-card, .match-hero,
  .match-team...).
*/
function spfcMatchCrest(esClub, rival, rivalEscudoUrl) {
  if (esClub) return `<img src="assets/img/escudo-santa-ponsa.png" alt="">`;
  if (rivalEscudoUrl) return `<img src="${rivalEscudoUrl}" alt="">`;
  return (rival || "").trim().slice(0, 2).toUpperCase() || "--";
}

function spfcMatchProtagonistHTML(match) {
  if (!match) return "";
  const esLocal = match.condicion === "local";
  const jugado = match.estado === "jugado";
  const res = jugado ? spfcResultLabel(match) : null;
  const resLabel = res === "W" ? "Victoria" : res === "L" ? "Derrota" : res === "D" ? "Empate" : "";
  const rivalName = match.rival || "Rival";

  let metaLine1;
  if (match.estado === "aplazado") {
    metaLine1 = "Partido aplazado";
  } else if (match.estado === "suspendido") {
    metaLine1 = "Partido suspendido";
  } else if (jugado) {
    metaLine1 = spfcFormatDate(match.fecha, { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  } else {
    metaLine1 = spfcFormatDate(match.fecha, { weekday: "long", day: "2-digit", month: "long", year: "numeric" }) + (match.hora ? " · " + match.hora.slice(0, 5) + "h" : "");
  }

  return `
    <div class="match-card match-hero">
      <span class="match-card__comp">${match.tipo && match.tipo !== "Liga" ? match.tipo + " · " : ""}${match.competicion || ""}${match.jornada ? " · Jornada " + match.jornada : ""}</span>
      <div class="match-card__teams">
        <div class="match-team">
          <span class="match-team__crest">${spfcMatchCrest(esLocal, rivalName, match.rival_escudo_url)}</span>
          <span class="match-team__name">${esLocal ? "Santa Ponça" : rivalName}</span>
        </div>
        ${jugado
          ? `<span class="match-card__score">${esLocal ? match.goles_equipo : match.goles_rival} — ${esLocal ? match.goles_rival : match.goles_equipo}</span>`
          : `<span class="match-card__vs">VS</span>`}
        <div class="match-team">
          <span class="match-team__crest">${spfcMatchCrest(!esLocal, rivalName, match.rival_escudo_url)}</span>
          <span class="match-team__name">${esLocal ? rivalName : "Santa Ponça"}</span>
        </div>
      </div>
      <div class="match-card__meta">
        <span>${metaLine1}</span>
        <span>${match.campo || ""}</span>
      </div>
      ${jugado && res ? `<div style="text-align:center;margin-top:1.2rem;"><span class="match-card__result result-${res}">${resLabel}</span></div>` : ""}
    </div>`;
}
