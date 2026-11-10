/*
  shop-ui.js
  ============================================================================
  Piezas de interfaz compartidas entre las páginas de la tienda (la
  tarjeta de producto del catálogo/homepage, el corazón de favoritos, la
  vista rápida). Todo lo que es solo "datos" vive en shop-data.js; esto es
  solo HTML/eventos para no repetirlo en cada página.
  ============================================================================
*/
window.SPFC_SHOP_UI = (function () {
  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function fmtEuros(n) {
    return (Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  }

  function badgesHtml(p) {
    const badges = [];
    if (p.agotado) badges.push('<span class="shop-badge">Agotado</span>');
    else if (p.esNuevo) badges.push('<span class="shop-badge shop-badge--lilac">Nuevo</span>');
    if (p.edicion_limitada) badges.push('<span class="shop-badge shop-badge--outline">Edición limitada</span>');
    return badges.length ? `<div class="shop-product__badges">${badges.join("")}</div>` : "";
  }

  function tarjetaProducto(p, opciones) {
    opciones = opciones || {};
    const esFavorito = !!opciones.favoritoIds && opciones.favoritoIds.has(p.id);
    const imgBase = p.imagenes && p.imagenes[0];
    const imgHover = p.imagenes && p.imagenes[1];
    return `
    <article class="shop-product" data-producto="${p.id}">
      <div class="shop-product__media">
        ${badgesHtml(p)}
        <button type="button" class="shop-fav-btn" data-fav-btn data-activo="${esFavorito ? 1 : 0}" aria-label="Añadir a favoritos" aria-pressed="${esFavorito}">${esFavorito ? "♥" : "♡"}</button>
        <a href="producto.html?id=${p.id}">
          ${imgBase
            ? `<img class="shop-product__img shop-product__img--base" src="${escapeHtml(imgBase)}" alt="${escapeHtml(p.nombre)}">`
            : `<div class="shop-product__placeholder">Sin foto todavía</div>`}
          ${imgHover ? `<img class="shop-product__img shop-product__img--hover" src="${escapeHtml(imgHover)}" alt="">` : ""}
        </a>
        <div class="shop-product__quickview">
          <button type="button" class="shop-btn shop-btn--light shop-btn--block" data-qv-btn>Vista rápida</button>
        </div>
      </div>
      <div class="shop-product__body">
        <a href="producto.html?id=${p.id}" style="color:inherit;">
          <p class="shop-product__nombre">${escapeHtml(p.nombre)}</p>
          <p class="shop-product__precio">${fmtEuros(p.precio)}</p>
        </a>
      </div>
    </article>`;
  }

  // Conecta los botones de favorito de un contenedor ya pintado con
  // tarjetaProducto() — requiere sesión; si no hay, enlaza a iniciar sesión.
  function wireFavoritos(container) {
    container.querySelectorAll("[data-fav-btn]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const productId = btn.closest("[data-producto]").dataset.producto;
        const { data: { session } } = await window.spfc.auth.getSession();
        if (!session) {
          location.href = "cuenta.html?volver=" + encodeURIComponent(location.pathname + location.search);
          return;
        }
        const res = await window.SPFC_SHOP.alternarFavorito(productId);
        if (res.favorito) {
          btn.textContent = "♥";
          btn.dataset.activo = "1";
          btn.setAttribute("aria-pressed", "true");
        } else {
          btn.textContent = "♡";
          btn.dataset.activo = "0";
          btn.setAttribute("aria-pressed", "false");
        }
      });
    });
  }

  // Vista rápida: modal simple con imagen + selector de talla + añadir al
  // carrito, sin salir del catálogo.
  function wireQuickView(container, productosPorId) {
    const overlay = document.getElementById("shop-qv-overlay");
    if (!overlay) return;
    container.querySelectorAll("[data-qv-btn]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const productId = btn.closest("[data-producto]").dataset.producto;
        abrirQuickView(productosPorId[productId]);
      });
    });

    function abrirQuickView(p) {
      if (!p) return;
      const img = p.imagenes && p.imagenes[0];
      document.getElementById("shop-qv-body").innerHTML = `
        ${img ? `<img class="shop-qv-modal__img" src="${escapeHtml(img)}" alt="">` : `<div class="shop-qv-modal__img shop-product__placeholder">Sin foto todavía</div>`}
        <div class="shop-qv-modal__body">
          <p class="spd-info__eyebrow">FFSP Official Store</p>
          <h3 style="margin:0.3rem 0 0.6rem;">${escapeHtml(p.nombre)}</h3>
          <p class="spd-info__precio" style="font-size:1.1rem;">${fmtEuros(p.precio)}</p>
          <a class="shop-btn shop-btn--dark shop-btn--block" href="producto.html?id=${p.id}">Ver ficha completa</a>
        </div>`;
      overlay.classList.add("is-open");
    }

    document.getElementById("shop-qv-close").addEventListener("click", () => overlay.classList.remove("is-open"));
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.classList.remove("is-open"); });
  }

  return { escapeHtml, fmtEuros, badgesHtml, tarjetaProducto, wireFavoritos, wireQuickView };
})();
