/*
  shop-cart-ui.js
  ============================================================================
  Dibuja el cajón lateral del carrito (assets/partials/cart-drawer.html) a
  partir de SPFC_CART (shop-cart.js) y lo mantiene sincronizado. Se incluye
  en todas las páginas de la tienda que tengan el partial del carrito.
  Expone window.SPFC_CART_UI.abrir() para que otras páginas (p.ej. al
  añadir un producto) abran el cajón después de añadir algo.
  ============================================================================
*/
(function () {
  function fmtEuros(n) {
    return (Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const scrim = document.getElementById("cart-scrim");
  const drawer = document.getElementById("cart-drawer");
  const openBtn = document.getElementById("cart-open-btn");
  const closeBtn = document.getElementById("cart-close-btn");
  const countEl = document.getElementById("cart-count");
  const bodyEl = document.getElementById("cart-drawer-body");
  const footEl = document.getElementById("cart-drawer-foot");
  const totalEl = document.getElementById("cart-drawer-total");

  if (!drawer || !bodyEl) return; // página sin cajón de carrito

  function render() {
    const items = window.SPFC_CART.obtener();
    if (countEl) countEl.textContent = window.SPFC_CART.contador();

    if (!items.length) {
      bodyEl.innerHTML = '<p class="cart-drawer__empty">Tu carrito está vacío. <a href="catalogo.html">Ver catálogo</a>.</p>';
      if (footEl) footEl.style.display = "none";
      return;
    }

    bodyEl.innerHTML = items.map((i) => `
      <div class="cart-item" data-variant="${escapeHtml(i.variant_id)}">
        ${i.imagen_url ? `<img class="cart-item__img" src="${escapeHtml(i.imagen_url)}" alt="">` : `<div class="cart-item__img"></div>`}
        <div class="cart-item__body">
          <p class="cart-item__nombre">${escapeHtml(i.nombre)}</p>
          <p class="cart-item__meta">${escapeHtml(i.talla)}${i.color ? " · " + escapeHtml(i.color) : ""}</p>
          <div class="cart-item__row">
            <div class="cart-item__qty">
              <button type="button" data-menos aria-label="Quitar una unidad">−</button>
              <span>${i.cantidad}</span>
              <button type="button" data-mas aria-label="Añadir una unidad">+</button>
            </div>
            <span class="cart-item__precio">${fmtEuros(i.precio * i.cantidad)}</span>
          </div>
          <button type="button" class="cart-item__del" data-quitar>Quitar</button>
        </div>
      </div>`).join("");

    if (footEl) footEl.style.display = "block";
    if (totalEl) totalEl.textContent = fmtEuros(window.SPFC_CART.total());

    bodyEl.querySelectorAll("[data-menos]").forEach((btn) => btn.addEventListener("click", (e) => {
      const variantId = e.currentTarget.closest("[data-variant]").dataset.variant;
      const item = window.SPFC_CART.obtener().find((i) => i.variant_id === variantId);
      if (item) window.SPFC_CART.actualizarCantidad(variantId, item.cantidad - 1);
    }));
    bodyEl.querySelectorAll("[data-mas]").forEach((btn) => btn.addEventListener("click", (e) => {
      const variantId = e.currentTarget.closest("[data-variant]").dataset.variant;
      const item = window.SPFC_CART.obtener().find((i) => i.variant_id === variantId);
      if (item) window.SPFC_CART.actualizarCantidad(variantId, item.cantidad + 1);
    }));
    bodyEl.querySelectorAll("[data-quitar]").forEach((btn) => btn.addEventListener("click", (e) => {
      const variantId = e.currentTarget.closest("[data-variant]").dataset.variant;
      window.SPFC_CART.quitar(variantId);
    }));
  }

  function abrir() {
    drawer.classList.add("is-open");
    scrim.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
  }
  function cerrar() {
    drawer.classList.remove("is-open");
    scrim.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
  }

  if (openBtn) openBtn.addEventListener("click", abrir);
  if (closeBtn) closeBtn.addEventListener("click", cerrar);
  if (scrim) scrim.addEventListener("click", cerrar);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrar(); });

  window.SPFC_CART.onChange(render);
  render();

  window.SPFC_CART_UI = { abrir, cerrar };

  // Resalta el enlace activo del sub-nav de la tienda.
  const pagina = location.pathname.split("/").pop() || "tienda.html";
  document.querySelectorAll("[data-shop-link]").forEach((a) => {
    if (a.getAttribute("href") === pagina) a.classList.add("is-active");
  });
})();
