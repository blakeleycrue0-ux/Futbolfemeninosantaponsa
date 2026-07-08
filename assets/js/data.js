/*
  Capa de datos compartida. Todas las páginas públicas llaman a estas
  funciones en lugar de usar window.spfc directamente. Si Supabase no está
  configurado, o una consulta falla, se devuelve contenido de respaldo
  (SPFC_FALLBACK) para que la web nunca se quede en blanco.
*/
window.SPFC_FALLBACK = {
  club: {
    nombre: "Futbol Femenino Santa Ponsa",
    equipo_primero_id: "primer-equipo",
    ciudad: "Santa Ponsa, Calvià, Mallorca",
  },
  teams: [
    { id: "primer-equipo", nombre: "Primer Equipo", categoria: "Preferente Femenina", temporada: "2025/26" },
    { id: "cadete", nombre: "Cadete Femenino", categoria: "Cadete", temporada: "2025/26" },
    { id: "infantil", nombre: "Infantil Femenino", categoria: "Infantil", temporada: "2025/26" },
    { id: "alevin", nombre: "Alevín Femenino", categoria: "Alevín", temporada: "2025/26" },
  ],
  players: [
    { id: "p1", team_id: "primer-equipo", nombre: "Marta Bennasar", dorsal: 1, posicion: "Portera", goles: 0, partidos_jugados: 14 },
    { id: "p2", team_id: "primer-equipo", nombre: "Laura Ferrer", dorsal: 4, posicion: "Defensa", goles: 1, partidos_jugados: 16 },
    { id: "p3", team_id: "primer-equipo", nombre: "Aina Roig", dorsal: 6, posicion: "Centrocampista", goles: 3, partidos_jugados: 15 },
    { id: "p4", team_id: "primer-equipo", nombre: "Paula Vidal", dorsal: 9, posicion: "Delantera", goles: 11, partidos_jugados: 16 },
    { id: "p5", team_id: "primer-equipo", nombre: "Neus Amengual", dorsal: 3, posicion: "Defensa", goles: 0, partidos_jugados: 13 },
    { id: "p6", team_id: "primer-equipo", nombre: "Carla Mut", dorsal: 8, posicion: "Centrocampista", goles: 4, partidos_jugados: 16 },
  ],
  matches: [
    { id: "m1", team_id: "primer-equipo", rival: "CE Andratx Femení", fecha: "2026-07-12", hora: "18:00", condicion: "local", competicion: "Preferente Femenina", estado: "programado", campo: "Camp Municipal Santa Ponsa" },
    { id: "m2", team_id: "primer-equipo", rival: "Platges de Calvià", fecha: "2026-06-28", condicion: "visitante", competicion: "Preferente Femenina", estado: "jugado", goles_equipo: 2, goles_rival: 1 },
    { id: "m3", team_id: "primer-equipo", rival: "CD Son Ferriol", fecha: "2026-06-21", condicion: "local", competicion: "Preferente Femenina", estado: "jugado", goles_equipo: 1, goles_rival: 1 },
    { id: "m4", team_id: "primer-equipo", rival: "UD Poblense Femení", fecha: "2026-06-14", condicion: "visitante", competicion: "Preferente Femenina", estado: "jugado", goles_equipo: 0, goles_rival: 2 },
  ],
  standings: [
    { posicion: 1, equipo: "UD Poblense Femení", pj: 18, pg: 15, pe: 2, pp: 1, gf: 48, gc: 12, puntos: 47 },
    { posicion: 2, equipo: "CD Son Ferriol", pj: 18, pg: 13, pe: 3, pp: 2, gf: 40, gc: 18, puntos: 42 },
    { posicion: 3, equipo: "Futbol Femenino Santa Ponsa", pj: 18, pg: 11, pe: 4, pp: 3, gf: 35, gc: 20, puntos: 37, es_club: true },
    { posicion: 4, equipo: "Platges de Calvià", pj: 18, pg: 9, pe: 3, pp: 6, gf: 30, gc: 25, puntos: 30 },
    { posicion: 5, equipo: "CE Andratx Femení", pj: 18, pg: 6, pe: 5, pp: 7, gf: 24, gc: 28, puntos: 23 },
  ],
  news: [
    { id: "n1", titulo: "Victoria clave ante Platges de Calvià", resumen: "El equipo suma tres puntos de oro en la lucha por el ascenso.", fecha: "2026-06-29", autor: "Comunicación SPFC" },
    { id: "n2", titulo: "Abierta la campaña de socias 2026/27", resumen: "Hazte socia y apoya al club durante la próxima temporada.", fecha: "2026-06-20", autor: "Junta Directiva" },
    { id: "n3", titulo: "Cantera: convocatoria de pruebas para el equipo infantil", resumen: "El club amplía su apuesta por la formación femenina de base.", fecha: "2026-06-10", autor: "Coordinación de Cantera" },
  ],
  gallery: [],
  sponsors: [
    { id: "s1", nombre: "Ajuntament de Calvià", nivel: "principal" },
    { id: "s2", nombre: "Restaurant Es Molí", nivel: "colaborador" },
    { id: "s3", nombre: "Nàutica Santa Ponsa", nivel: "colaborador" },
  ],
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
      return safe((c) => c.from("teams").select("*").order("categoria"), window.SPFC_FALLBACK.teams);
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
    async upcomingMatch(teamId) {
      const list = await safe(
        (c) => c.from("matches").select("*").eq("team_id", teamId).eq("estado", "programado").order("fecha").limit(1),
        window.SPFC_FALLBACK.matches.filter((m) => m.estado === "programado")
      );
      return Array.isArray(list) ? list[0] : list;
    },
    async recentResults(teamId, limit) {
      limit = limit || 5;
      return safe(
        (c) => c.from("matches").select("*").eq("team_id", teamId).eq("estado", "jugado").order("fecha", { ascending: false }).limit(limit),
        window.SPFC_FALLBACK.matches.filter((m) => m.estado === "jugado").slice(0, limit)
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
