(function () {
  const toggle = document.querySelector("[data-nav-toggle]");
  const nav = document.querySelector("[data-nav]");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(isOpen));
    });
    nav.querySelectorAll("a").forEach((a) =>
      a.addEventListener("click", () => {
        nav.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
      })
    );
  }

  document.querySelectorAll("[data-year]").forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  const path = location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll("[data-nav] a[href]").forEach((a) => {
    const href = a.getAttribute("href");
    if (href === path || (path === "" && href === "index.html")) {
      a.setAttribute("aria-current", "page");
    }
  });

  // Header solidifies on scroll.
  const header = document.querySelector(".site-header");
  if (header) {
    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  // Scroll-reveal for cards/sections — progressive enhancement, no markup needed.
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
