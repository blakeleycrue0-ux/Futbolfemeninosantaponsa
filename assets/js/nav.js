(function () {
  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  // Cabecera + menú a pantalla completa (.hdr / #burger / #fullnav) — antes
  // este bloque estaba copiado a mano, casi idéntico, en cada página.
  const header = document.getElementById("hdr");
  const burger = document.getElementById("burger");
  const fullnav = document.getElementById("fullnav");

  if (header) {
    const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  if (burger && fullnav) {
    const toggleNav = () => {
      const open = fullnav.classList.toggle("open");
      burger.textContent = open ? "Cerrar" : "Menú";
      burger.setAttribute("aria-expanded", String(open));
      document.body.style.overflow = open ? "hidden" : "";
    };
    burger.addEventListener("click", toggleNav);
    fullnav.querySelectorAll(".fullnav-link").forEach((a) => a.addEventListener("click", toggleNav));
  }

  const path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".fullnav-link[href], .hdr-nav a[href]").forEach((a) => {
    if (a.getAttribute("href") === path) a.setAttribute("aria-current", "page");
  });

  // Scroll-reveal — un solo sistema (.sr / .sr-l + clase "in" al entrar en
  // vista) para todo: elementos marcados a mano en el HTML (p.ej. index.html)
  // y componentes genéricos (tarjetas, tablas...) que lo reciben aquí.
  // Antes había dos sistemas por separado con nombres de clase distintos
  // (.sr/.sr-l aquí, .reveal-init/.reveal-in solo para estos componentes) que
  // hacían lo mismo — ver assets/css/components.css.
  if ("IntersectionObserver" in window) {
    const genericSelectors = [
      ".card", ".match-card", ".player-card",
      ".stat-item", ".section-head", "table.standings", ".sponsor-strip img",
    ];
    const generics = document.querySelectorAll(genericSelectors.join(","));
    generics.forEach((el, i) => {
      el.classList.add("sr");
      if (!el.style.transitionDelay) el.style.transitionDelay = Math.min(i % 4, 3) * 0.09 + "s";
    });

    const revealer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            revealer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(".sr,.sr-l").forEach((el) => revealer.observe(el));
  }
})();
