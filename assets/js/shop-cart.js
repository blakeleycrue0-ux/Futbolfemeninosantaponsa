/*
  shop-cart.js
  ============================================================================
  Carrito de la tienda — persistido en localStorage (no en el servidor: no
  hace falta sesión para añadir cosas al carrito, solo para pagar). Es
  deliberadamente solo datos, sin tocar el DOM — shop-cart-ui.js es quien
  dibuja el cajón lateral a partir de esto.

  Cada línea: { variant_id, product_id, nombre, imagen_url, precio, talla,
  color, cantidad, stock }. El precio y el stock que guarda aquí son solo
  para pintar el carrito al vuelo — el servidor (create-shop-checkout-
  session.js) vuelve a leer el precio y el stock reales de la base de datos
  antes de cobrar nada, nunca se fía de lo que haya en localStorage.
  ============================================================================
*/
window.SPFC_CART = (function () {
  const KEY = "spfc_shop_cart_v1";
  const listeners = [];

  function leer() {
    try {
      const raw = localStorage.getItem(KEY);
      const items = raw ? JSON.parse(raw) : [];
      return Array.isArray(items) ? items : [];
    } catch (e) {
      return [];
    }
  }

  function guardar(items) {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* localStorage no disponible */ }
    listeners.forEach((cb) => { try { cb(items); } catch (e) { /* no romper por un listener */ } });
  }

  return {
    obtener() { return leer(); },

    onChange(cb) { listeners.push(cb); },

    añadir(item) {
      const items = leer();
      const existente = items.find((i) => i.variant_id === item.variant_id);
      if (existente) {
        existente.cantidad = Math.max(1, Math.min(10, existente.cantidad + (item.cantidad || 1)));
      } else {
        items.push({ ...item, cantidad: Math.max(1, Math.min(10, item.cantidad || 1)) });
      }
      guardar(items);
    },

    actualizarCantidad(variantId, cantidad) {
      const items = leer();
      const it = items.find((i) => i.variant_id === variantId);
      if (!it) return;
      if (cantidad <= 0) { this.quitar(variantId); return; }
      it.cantidad = Math.max(1, Math.min(10, cantidad));
      guardar(items);
    },

    quitar(variantId) {
      guardar(leer().filter((i) => i.variant_id !== variantId));
    },

    vaciar() { guardar([]); },

    total() { return leer().reduce((sum, i) => sum + Number(i.precio) * i.cantidad, 0); },

    contador() { return leer().reduce((sum, i) => sum + i.cantidad, 0); },
  };
})();
