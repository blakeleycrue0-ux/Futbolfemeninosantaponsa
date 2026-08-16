/*
  site-analytics.js
  ============================================================================
  Registra visitas anónimas de la web pública (para "visitas hoy/esta
  semana" en el panel de admin) y se une a un canal de presencia en tiempo
  real (para el contador de "conectados ahora"). No usa cookies: el
  identificador de visitante es un id aleatorio guardado en localStorage,
  sin ningún dato personal.
  ============================================================================
*/
(function () {
  if (!window.spfc) return;

  function visitanteId() {
    try {
      let id = localStorage.getItem("spfc_visitor_id");
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem("spfc_visitor_id", id);
      }
      return id;
    } catch (err) {
      return crypto.randomUUID();
    }
  }

  const visitorId = visitanteId();

  window.spfc
    .from("page_views")
    .insert({ pagina: location.pathname, visitante_id: visitorId })
    .then(
      () => {},
      () => {}
    );

  const canal = window.spfc.channel("site-presence", {
    config: { presence: { key: visitorId } },
  });
  canal.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      canal.track({ pagina: location.pathname, desde: new Date().toISOString() });
    }
  });
})();
