/*
  i18n.js — Selector de idioma ES/EN.
  ============================================================================
  Traduce el texto compartido de todas las páginas (menú, menú móvil, pie de
  página) sin tener que tocar cada página una a una — igual que search.js e
  install-banner.js, se inyecta solo. La elección se recuerda en
  localStorage y se aplica en cuanto carga la página siguiente.

  Alcance actual: solo el texto fijo del menú/pie de página y algunos
  botones comunes. El contenido que escribe el club (noticias, fichas de
  jugadoras, textos propios de cada página) sigue solo en español — eso
  necesitaría traducción automática con una clave de IA que el club
  todavía no ha dado de alta.
  ============================================================================
*/
(function () {
  const ES_TO_EN = {
    "Equipos": "Teams",
    "Partidos": "Matches",
    "Calendario": "Schedule",
    "Noticias": "News",
    "Contacto": "Contact",
    "Formulario de interés": "Interest form",
    "Menú": "Menu",
    "Cerrar": "Close",
    "Inicio": "Home",
    "Plantilla": "Roster",
    "Clasificación": "Standings",
    "Galería": "Gallery",
    "Club": "Club",
    "Patrocinadores": "Sponsors",
    "Acceso club": "Club login",
    "Competición": "Competition",
    "Historia y palmarés": "History & honours",
    "Ubicación y contacto": "Location & contact",
    "Prensa y noticias": "Press & news",
    "Club de fútbol femenino de Santa Ponça, Calvià (Mallorca). Formación, competición y pasión por el fútbol femenino desde la base hasta el primer equipo.":
      "Women's football club in Santa Ponça, Calvià (Mallorca). Player development, competition and a passion for women's football from grassroots to first team.",
  };
  const EN_TO_ES = Object.fromEntries(Object.entries(ES_TO_EN).map(([es, en]) => [en, es]));

  const SELECTOR_CHROME = ".hdr-nav a, .fullnav-link, .fullnav-admin, .btn-cta span, .fullnav-cta, footer h4, footer a, .footer-brand > p, #burger";

  function idioma() {
    return localStorage.getItem("spfc_lang") === "en" ? "en" : "es";
  }

  function traducirElemento(el, lang) {
    const texto = el.textContent.trim();
    if (!texto) return;
    const mapa = lang === "en" ? ES_TO_EN : EN_TO_ES;
    if (mapa[texto] !== undefined) el.textContent = mapa[texto];
  }

  function aplicarIdioma(lang) {
    document.documentElement.lang = lang === "en" ? "en" : "es";
    document.querySelectorAll(SELECTOR_CHROME).forEach((el) => traducirElemento(el, lang));
    document.querySelectorAll(".spfc-lang-btn").forEach((btn) => {
      btn.textContent = lang === "en" ? "ES" : "EN";
      btn.setAttribute("aria-label", lang === "en" ? "Cambiar a español" : "Switch to English");
    });
  }

  function init() {
    const hdrNav = document.querySelector(".hdr-nav");
    const fullnavFoot = document.querySelector(".fullnav-foot");
    if (!hdrNav || !fullnavFoot) return;

    const style = document.createElement("style");
    style.textContent = `
      .spfc-lang-btn {
        display: flex; align-items: center; justify-content: center; height: 22px; padding: 0 8px;
        border: 1px solid rgba(255,255,255,0.3); border-radius: 999px; background: transparent; color: #fff;
        cursor: pointer; flex-shrink: 0; font-size: 10.5px; font-weight: 700; letter-spacing: 0.03em; font-family: inherit;
      }
      .hdr.scrolled .spfc-lang-btn { color: var(--ink, #0a0a0a); border-color: rgba(10,10,10,0.25); }
      .spfc-lang-fullnav-btn {
        display: flex; align-items: center; background: none; border: 1px solid rgba(244,240,232,0.3); border-radius: 999px;
        cursor: pointer; padding: 3px 9px; color: rgba(244,240,232,0.7); font-size: 11px; font-weight: 700; font-family: inherit;
      }
      .spfc-lang-fullnav-btn:hover { color: var(--accent-light); border-color: var(--accent-light); }
    `;
    document.head.appendChild(style);

    const btnDesktop = document.createElement("button");
    btnDesktop.type = "button";
    btnDesktop.className = "spfc-lang-btn";
    hdrNav.appendChild(btnDesktop);

    const btnFullnav = document.createElement("button");
    btnFullnav.type = "button";
    btnFullnav.className = "spfc-lang-btn spfc-lang-fullnav-btn";
    fullnavFoot.insertBefore(btnFullnav, fullnavFoot.firstChild);

    function alternar() {
      const nuevo = idioma() === "en" ? "es" : "en";
      localStorage.setItem("spfc_lang", nuevo);
      aplicarIdioma(nuevo);
    }
    btnDesktop.addEventListener("click", alternar);
    btnFullnav.addEventListener("click", alternar);

    const burger = document.getElementById("burger");
    if (burger) burger.addEventListener("click", () => traducirElemento(burger, idioma()));

    aplicarIdioma(idioma());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
