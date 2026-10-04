/*
  ticketing-data.js
  ============================================================================
  Lógica de datos compartida por las páginas de socios/abonos/entradas
  (socios.html, entradas.html, checkout.html, compra-completada.html,
  mi-ffsp.html, mi-carnet.html, entrada.html). Solo lectura/consultas a
  Supabase y helpers de formato — nada de HTML aquí, para que la fase 2
  pueda rehacer el diseño de esas páginas sin tocar esta lógica.
  ============================================================================
*/
window.SPFC_TICKETING = {
  async productosActivos(tipos) {
    if (!window.spfc) return [];
    let query = window.spfc.from("ticket_products").select("*, teams(nombre), matches(rival, fecha, hora)").eq("activo", true);
    if (tipos && tipos.length) query = query.in("tipo", tipos);
    const { data, error } = await query.order("precio");
    if (error) { console.warn("[ticketing] error cargando productos:", error.message); return []; }
    const ahora = new Date();
    return (data || []).filter((p) => {
      if (p.sales_start && ahora < new Date(p.sales_start)) return false;
      if (p.sales_end && ahora > new Date(p.sales_end)) return false;
      return true;
    });
  },

  async producto(id) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("ticket_products").select("*, teams(nombre), matches(rival, fecha, hora)").eq("id", id).single();
    return data || null;
  },

  async sesionActual() {
    if (!window.spfc) return null;
    const { data: { session } } = await window.spfc.auth.getSession();
    return session || null;
  },

  async pedido(id) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("orders").select("*, ticket_products(*)").eq("id", id).single();
    return data || null;
  },

  async misMembresias() {
    if (!window.spfc) return [];
    const { data } = await window.spfc.from("memberships").select("*, ticket_products(nombre, tipo), teams(nombre)").order("creado_en", { ascending: false });
    return data || [];
  },

  async misEntradas() {
    if (!window.spfc) return [];
    const { data } = await window.spfc.from("tickets").select("*, matches(rival, fecha, hora, campo)").order("creado_en", { ascending: false });
    return data || [];
  },

  async misPedidos() {
    if (!window.spfc) return [];
    const { data } = await window.spfc.from("orders").select("*, ticket_products(nombre, tipo)").order("creado_en", { ascending: false });
    return data || [];
  },

  async credencialDeMembership(membershipId) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("access_credentials").select("token").eq("membership_id", membershipId).single();
    return data ? data.token : null;
  },

  async credencialDeTicket(ticketId) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("access_credentials").select("token").eq("ticket_id", ticketId).single();
    return data ? data.token : null;
  },

  async iniciarCheckout(productId) {
    const { data: { session } } = await window.spfc.auth.getSession();
    const token = session ? session.access_token : null;
    const res = await fetch("/.netlify/functions/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (token || "") },
      body: JSON.stringify({ product_id: productId }),
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(texto || "No se ha podido iniciar el pago.");
    return JSON.parse(texto);
  },

  nombreTipo(tipo) {
    return { socio: "Socio FFSP", abono: "Abono de temporada", entrada: "Entrada de partido" }[tipo] || tipo;
  },

  fmtEuros(n) {
    return (Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  },

  fmtFecha(f) {
    return f ? new Date(f).toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" }) : "";
  },

  fmtFechaCorta(f) {
    return f ? new Date(f).toLocaleDateString("es-ES", { day: "2-digit", month: "short" }).replace(".", "") : "";
  },

  fmtDow(f) {
    return f ? new Date(f).toLocaleDateString("es-ES", { weekday: "short" }).replace(".", "") : "";
  },

  nombreTitular(user) {
    if (!user) return "";
    return (user.user_metadata && user.user_metadata.nombre) || user.email || "";
  },

  escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  },

  /*
    ------------------------------------------------------------------------
    A partir de aquí, helpers de PRESENTACIÓN (fase 2) — solo construyen
    HTML a partir de datos ya cargados, sin tocar Supabase. Reutilizados por
    mi-carnet.html, mi-ffsp.html, entradas.html, entrada.html e index.html.
    ------------------------------------------------------------------------
  */

  // membership: fila de `memberships` con join a ticket_products(nombre,tipo) y teams(nombre).
  // id: identificador único (dentro de la página) para el contenedor del QR
  // de esta tarjeta, p.ej. el índice de la lista — así mi-carnet.html puede
  // tener varias tarjetas sin que los QR se pisen.
  //
  // Tarjeta con flip real (como la física / como Apple Wallet): la
  // "portada" es solo el escudo + el nombre genérico de la tarjeta, igual
  // que la tarjeta impresa — nada de datos personales ahí. Al tocar la
  // tarjeta entera (sin botón aparte) gira y enseña el reverso con el
  // nombre, el nº de socio, el equipo y el código QR.
  membershipCardHTML(membership, nombreTitular, id) {
    const esc = this.escapeHtml;
    const qrBoxId = `mc-qr-${id}`;
    return `
      <div class="membership-card" tabindex="0" role="button" aria-pressed="false"
           aria-label="Tarjeta de socio de ${esc(nombreTitular)}. Toca para ver el código de acceso." data-card>
        <div class="membership-card__flip">
          <div class="membership-card__face membership-card__face--front">
            <img class="membership-card__front-crest" src="assets/img/escudo-santa-ponsa.png" alt="">
            <span class="membership-card__front-caption">Tarjeta de socio ${esc(membership.temporada)}</span>
          </div>
          <div class="membership-card__face membership-card__face--back">
            <div class="membership-card__back-head">
              <div class="membership-card__tipo">${membership.ticket_products.tipo === "socio" ? "Socio" : "Abono"}</div>
              <div class="membership-card__nombre">${esc(nombreTitular)}</div>
            </div>
            <div class="membership-card__back-qr" id="${qrBoxId}" data-qr-box></div>
            <div class="membership-card__back-foot">
              <div>
                <div class="membership-card__label">Nº socio</div>
                <div class="membership-card__numero">${String(membership.member_number).padStart(4, "0")}</div>
              </div>
              <div class="membership-card__scope">${membership.teams ? esc(membership.teams.nombre) : "Todo el club"}</div>
            </div>
          </div>
        </div>
      </div>`;
  },

  // Fila compacta para listas de partidos/entradas. opts: {href, fecha, teams, meta, priceLabel, ctaLabel}
  fixtureRowHTML(opts) {
    const esc = this.escapeHtml;
    return `
      <a class="fixture-row" href="${esc(opts.href)}">
        <div class="fixture-row__date">
          <span class="dow">${esc(opts.dow || "")}</span>
          <span class="dom">${esc(opts.dom || "")}</span>
        </div>
        <div class="fixture-row__main">
          <div class="fixture-row__teams">${opts.teams}</div>
          <div class="fixture-row__meta">${esc(opts.meta || "")}</div>
        </div>
        <div class="fixture-row__action">
          <div class="fixture-row__price">${esc(opts.priceLabel || "")}</div>
          <div class="fixture-row__cta">${esc(opts.ctaLabel || "Ver →")}</div>
        </div>
      </a>`;
  },

  // Próximo partido en casa al que da acceso una membresía activa (misma
  // regla de alcance que netlify/functions/scan-access.js: team_id null =
  // vale para cualquier equipo, team_id fijo = solo ese equipo). Solo
  // lectura/presentación — no decide ningún acceso real.
  async proximoPartidoElegible(membership) {
    if (!window.spfc || !membership) return null;
    let query = window.spfc.from("matches").select("id, rival, fecha, hora, team_id")
      .eq("condicion", "local").eq("estado", "programado")
      .gte("fecha", new Date().toISOString().slice(0, 10))
      .order("fecha", { ascending: true }).limit(1);
    if (membership.team_id) query = query.eq("team_id", membership.team_id);
    const { data } = await query;
    return (data && data[0]) || null;
  },

  // Módulo compacto de carné (homepage / hub). opts: {nombre, numero, scope}
  carnetModuleHTML(opts) {
    const esc = this.escapeHtml;
    return `
      <a class="carnet-module" href="mi-carnet.html">
        <img class="carnet-module__crest" src="assets/img/escudo-santa-ponsa.png" alt="">
        <div class="carnet-module__body">
          <div class="carnet-module__eyebrow">Tu carné · Socio ${esc(opts.temporada || "")}</div>
          <div class="carnet-module__nombre">${esc(opts.nombre)}</div>
          <div class="carnet-module__numero">Nº ${String(opts.numero).padStart(4, "0")}</div>
        </div>
        <span class="carnet-module__cta">Ver carné →</span>
      </a>`;
  },
};
