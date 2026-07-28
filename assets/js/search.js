(function () {
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function init() {
    const hdrNav = document.querySelector(".hdr-nav");
    const fullnavFoot = document.querySelector(".fullnav-foot");
    if (!hdrNav || !fullnavFoot) return;

    const style = document.createElement("style");
    style.textContent = `
      .spfc-search-btn {
        display: flex; align-items: center; justify-content: center; width: 22px; height: 22px;
        border: none; background: transparent; color: #fff; cursor: pointer; flex-shrink: 0; padding: 0;
      }
      .hdr.scrolled .spfc-search-btn { color: var(--ink, #0a0a0a); }
      .spfc-search-fullnav-btn {
        display: flex; align-items: center; background: none; border: none; cursor: pointer; padding: 0;
        color: rgba(244,240,232,0.5); transition: color 0.3s;
      }
      .spfc-search-fullnav-btn:hover { color: var(--accent-light); }
      .spfc-search-overlay {
        position: fixed; inset: 0; z-index: 2500; display: none; align-items: flex-start; justify-content: center;
        padding: 90px 16px 16px;
      }
      .spfc-search-overlay.open { display: flex; }
      .spfc-search-backdrop { position: absolute; inset: 0; background: rgba(10,10,10,0.72); backdrop-filter: blur(2px); }
      .spfc-search-panel {
        position: relative; z-index: 1; width: 100%; max-width: 560px; background: var(--paper, #fff);
        border-radius: 14px; box-shadow: 0 24px 60px rgba(0,0,0,0.4); overflow: hidden;
        max-height: calc(100vh - 120px); display: flex; flex-direction: column;
      }
      .spfc-search-bar { display: flex; align-items: center; gap: 0.6rem; padding: 0.9rem 1rem; border-bottom: 1px solid rgba(10,10,10,0.1); }
      .spfc-search-bar input {
        flex: 1; border: none; outline: none; font-size: 1rem; font-family: inherit; background: transparent; color: var(--ink, #0a0a0a);
      }
      .spfc-search-bar button { border: none; background: transparent; cursor: pointer; color: var(--text-on-cream-muted, #6b6570); font-size: 1.1rem; padding: 4px; }
      .spfc-search-results { overflow-y: auto; padding: 0.5rem 0; }
      .spfc-search-group-title {
        font-family: var(--font-display); font-size: 0.68rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
        color: var(--text-on-cream-muted, #6b6570); padding: 0.8rem 1.1rem 0.3rem;
      }
      .spfc-search-item { display: flex; align-items: center; gap: 0.7rem; padding: 0.6rem 1.1rem; text-decoration: none; color: var(--ink, #0a0a0a); }
      .spfc-search-item:hover { background: var(--cream-deep, #f0f0f0); }
      .spfc-search-item img { width: 34px; height: 34px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: var(--cream-deep, #eee); }
      .spfc-search-item .spfc-si-title { font-size: 0.88rem; font-weight: 600; }
      .spfc-search-item .spfc-si-meta { font-size: 0.76rem; color: var(--text-on-cream-muted, #6b6570); }
      .spfc-search-empty, .spfc-search-hint { padding: 1.4rem 1.1rem; font-size: 0.86rem; color: var(--text-on-cream-muted, #6b6570); text-align: center; }
      @media (max-width: 640px) { .spfc-search-overlay { padding-top: 78px; } }
    `;
    document.head.appendChild(style);

    // Icono de lupa en el menú de escritorio (.hdr-nav, hay sitio de sobra).
    const btnDesktop = document.createElement("button");
    btnDesktop.type = "button";
    btnDesktop.className = "spfc-search-btn";
    btnDesktop.setAttribute("aria-label", "Buscar");
    btnDesktop.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
    hdrNav.appendChild(btnDesktop);

    // Icono de lupa en la fila de redes sociales del menú móvil (no cabía
    // bien ni en la barra estrecha del header ni añadiendo una fila más a
    // la lista de enlaces, que ya va justa de alto en pantallas bajas).
    const fullnavItem = document.createElement("button");
    fullnavItem.type = "button";
    fullnavItem.className = "spfc-search-fullnav-btn";
    fullnavItem.setAttribute("aria-label", "Buscar");
    fullnavItem.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>';
    fullnavFoot.insertBefore(fullnavItem, fullnavFoot.firstChild);

    const overlay = document.createElement("div");
    overlay.className = "spfc-search-overlay";
    overlay.innerHTML = `
      <div class="spfc-search-backdrop"></div>
      <div class="spfc-search-panel">
        <div class="spfc-search-bar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="flex-shrink:0;color:var(--text-on-cream-muted,#6b6570);"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>
          <input type="search" placeholder="Buscar noticias, jugadoras, partidos…" autocomplete="off">
          <button type="button" aria-label="Cerrar">✕</button>
        </div>
        <div class="spfc-search-results"><p class="spfc-search-hint">Escribe al menos 2 letras para buscar.</p></div>
      </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("input");
    const resultsEl = overlay.querySelector(".spfc-search-results");
    const closeBtn = overlay.querySelector(".spfc-search-bar button");
    const backdrop = overlay.querySelector(".spfc-search-backdrop");

    function openSearch() {
      overlay.classList.add("open");
      document.body.style.overflow = "hidden";
      setTimeout(() => input.focus(), 50);
    }
    function closeSearch() {
      overlay.classList.remove("open");
      document.body.style.overflow = "";
    }
    btnDesktop.addEventListener("click", openSearch);
    fullnavItem.addEventListener("click", () => {
      const nav = document.getElementById("fullnav");
      if (nav && nav.classList.contains("open") && typeof toggleNav === "function") toggleNav();
      openSearch();
    });
    closeBtn.addEventListener("click", closeSearch);
    backdrop.addEventListener("click", closeSearch);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && overlay.classList.contains("open")) closeSearch();
      if ((e.key === "/" || (e.key === "k" && (e.metaKey || e.ctrlKey))) && !overlay.classList.contains("open") && document.activeElement.tagName !== "INPUT") {
        e.preventDefault();
        openSearch();
      }
    });

    function renderResults(res) {
      const groups = [];
      if (res.news.length) {
        groups.push(`<div class="spfc-search-group-title">Noticias</div>` + res.news.map((n) => `
          <a class="spfc-search-item" href="noticia.html?id=${encodeURIComponent(n.id)}">
            <div>
              <div class="spfc-si-title">${escapeHtml(n.titulo)}</div>
              <div class="spfc-si-meta">${n.fecha ? new Date(n.fecha).toLocaleDateString("es-ES") : ""}</div>
            </div>
          </a>`).join(""));
      }
      if (res.players.length) {
        groups.push(`<div class="spfc-search-group-title">Jugadoras</div>` + res.players.map((p) => `
          <a class="spfc-search-item" href="jugadora.html?id=${encodeURIComponent(p.id)}">
            <img src="${p.foto_url || "assets/img/escudo-santa-ponsa.png"}" alt="">
            <div>
              <div class="spfc-si-title">${escapeHtml(p.nombre)}</div>
              <div class="spfc-si-meta">${p.dorsal ? "Dorsal " + p.dorsal : ""}</div>
            </div>
          </a>`).join(""));
      }
      if (res.matches.length) {
        groups.push(`<div class="spfc-search-group-title">Partidos</div>` + res.matches.map((m) => `
          <a class="spfc-search-item" href="partido.html?id=${encodeURIComponent(m.id)}">
            <div>
              <div class="spfc-si-title">vs ${escapeHtml(m.rival)}</div>
              <div class="spfc-si-meta">${m.fecha ? new Date(m.fecha + "T00:00:00").toLocaleDateString("es-ES") : ""}</div>
            </div>
          </a>`).join(""));
      }
      resultsEl.innerHTML = groups.length ? groups.join("") : `<p class="spfc-search-empty">Sin resultados.</p>`;
    }

    let debounceTimer = null;
    input.addEventListener("input", () => {
      const q = input.value.trim();
      clearTimeout(debounceTimer);
      if (q.length < 2) {
        resultsEl.innerHTML = `<p class="spfc-search-hint">Escribe al menos 2 letras para buscar.</p>`;
        return;
      }
      resultsEl.innerHTML = `<p class="spfc-search-hint">Buscando…</p>`;
      debounceTimer = setTimeout(async () => {
        if (!window.SPFC_DATA) return;
        const res = await SPFC_DATA.search(q);
        if (input.value.trim() === q) renderResults(res);
      }, 300);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
