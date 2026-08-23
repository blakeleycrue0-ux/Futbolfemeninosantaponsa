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

  // Scroll-reveal de la cabecera/pie compartidos — progressive enhancement.
  if ("IntersectionObserver" in window) {
    const roChrome = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add("in");
        });
      },
      { threshold: 0.09 }
    );
    document.querySelectorAll(".sr,.sr-l").forEach((el) => roChrome.observe(el));
  }

  // Scroll-reveal para tarjetas/secciones de contenido — progressive enhancement.
  const revealSelectors = [
    ".card", ".match-card", ".player-card",
    ".stats-sec .stat-cell", ".stat-item",
    ".section-head", "table.standings", ".sponsor-strip img",
  ];
  const revealables = document.querySelectorAll(revealSelectors.join(","));
  if (revealables.length && "IntersectionObserver" in window) {
    revealables.forEach((el, i) => {
      el.classList.add("reveal-init");
      el.style.transitionDelay = Math.min(i % 4, 3) * 0.09 + "s";
    });
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("reveal-in");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealables.forEach((el) => io.observe(el));
  }
})();
