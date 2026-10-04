/*
  shop-data.js
  ============================================================================
  Lógica de datos de la tienda (merchandising: camisetas, pantalones...),
  igual de separada del HTML que ticketing-data.js. Reutiliza de ahí los
  helpers genéricos (escapeHtml, fmtEuros, sesionActual) en vez de
  duplicarlos — las páginas de la tienda cargan los dos scripts.
  ============================================================================
*/
window.SPFC_SHOP = {
  async productosActivos() {
    if (!window.spfc) return [];
    const { data, error } = await window.spfc.from("shop_products").select("*").eq("activo", true).order("orden");
    if (error) { console.warn("[shop] error cargando productos:", error.message); return []; }
    return data || [];
  },

  async producto(id) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("shop_products").select("*").eq("id", id).single();
    return data || null;
  },

  async pedido(id) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("shop_orders").select("*, shop_products(*)").eq("id", id).single();
    return data || null;
  },

  async misPedidos() {
    if (!window.spfc) return [];
    const { data } = await window.spfc.from("shop_orders").select("*, shop_products(nombre, imagen_url)").order("creado_en", { ascending: false });
    return data || [];
  },

  async iniciarCheckout(productId, talla, cantidad) {
    const { data: { session } } = await window.spfc.auth.getSession();
    const token = session ? session.access_token : null;
    const res = await fetch("/.netlify/functions/create-shop-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (token || "") },
      body: JSON.stringify({ product_id: productId, talla: talla || null, cantidad: cantidad || 1 }),
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(texto || "No se ha podido iniciar el pago.");
    return JSON.parse(texto);
  },

  nombreEstado(estado) {
    return {
      pendiente: "Pago pendiente",
      pagado: "Pagado — pendiente de recoger",
      recogido: "Recogido",
      cancelado: "Cancelado",
      fallido: "Pago fallido",
    }[estado] || estado;
  },
};
