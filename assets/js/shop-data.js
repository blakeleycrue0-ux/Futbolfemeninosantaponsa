/*
  shop-data.js
  ============================================================================
  Lógica de datos de la tienda (merchandising: camisetas, sudaderas...),
  igual de separada del HTML que ticketing-data.js. Reutiliza de ahí los
  helpers genéricos (escapeHtml, fmtEuros, sesionActual) en vez de
  duplicarlos — las páginas de la tienda cargan los dos scripts.

  Modelo de stock: "stock real simple por talla" — cada variante
  (shop_product_variants: talla x color) tiene un número de unidades. El
  carrito y el checkout nunca confían en el stock que el navegador cree
  tener: el servidor (create-shop-checkout-session.js) lo revalida todo, y
  el descuento real y atómico ocurre en el webhook al confirmarse el pago.
  ============================================================================
*/
window.SPFC_SHOP = {
  async categoriasConProductos() {
    if (!window.spfc) return [];
    const [{ data: categorias }, { data: productos }] = await Promise.all([
      window.spfc.from("shop_categories").select("*").eq("activo", true).order("orden"),
      window.spfc.from("shop_products").select("category_id").eq("activo", true),
    ]);
    const idsConProducto = new Set((productos || []).map((p) => p.category_id).filter(Boolean));
    return (categorias || []).filter((c) => idsConProducto.has(c.id));
  },

  async productosActivos(filtros) {
    if (!window.spfc) return [];
    let q = window.spfc.from("shop_products").select("*, shop_product_images(url, orden), shop_product_variants(id, talla, color, stock)").eq("activo", true);
    if (filtros && filtros.categoryId) q = q.eq("category_id", filtros.categoryId);
    const { data, error } = await q.order("orden");
    if (error) { console.warn("[shop] error cargando productos:", error.message); return []; }
    return (data || []).map(this._normalizarProducto);
  },

  async producto(id) {
    if (!window.spfc) return null;
    const { data, error } = await window.spfc
      .from("shop_products")
      .select("*, shop_product_images(url, orden), shop_product_variants(id, talla, color, stock, orden)")
      .eq("id", id)
      .eq("activo", true)
      .single();
    if (error || !data) return null;
    return this._normalizarProducto(data);
  },

  async productosRelacionados(categoryId, excluirId) {
    if (!window.spfc || !categoryId) return [];
    const { data } = await window.spfc
      .from("shop_products")
      .select("*, shop_product_images(url, orden), shop_product_variants(id, talla, color, stock)")
      .eq("activo", true)
      .eq("category_id", categoryId)
      .neq("id", excluirId)
      .order("orden")
      .limit(4);
    return (data || []).map(this._normalizarProducto);
  },

  // Ventas reales agrupadas por producto — nunca una cifra inventada. Si
  // todavía no hay ninguna venta pagada, devuelve [] y quien lo use debe
  // ocultar la sección en vez de rellenarla con algo falso.
  async masVendidos(limite) {
    if (!window.spfc) return [];
    const { data: pedidos } = await window.spfc
      .from("shop_orders")
      .select("product_id, cantidad")
      .in("estado", ["pagado", "recogido"]);
    if (!pedidos || !pedidos.length) return [];
    const totales = {};
    pedidos.forEach((o) => { totales[o.product_id] = (totales[o.product_id] || 0) + o.cantidad; });
    const idsOrdenados = Object.keys(totales).sort((a, b) => totales[b] - totales[a]).slice(0, limite || 4);
    if (!idsOrdenados.length) return [];
    const { data: productos } = await window.spfc
      .from("shop_products")
      .select("*, shop_product_images(url, orden), shop_product_variants(id, talla, color, stock)")
      .in("id", idsOrdenados)
      .eq("activo", true);
    const porId = {};
    (productos || []).forEach((p) => { porId[p.id] = this._normalizarProducto(p); });
    return idsOrdenados.map((id) => porId[id]).filter(Boolean);
  },

  _normalizarProducto(p) {
    const imagenes = (p.shop_product_images || []).slice().sort((a, b) => a.orden - b.orden).map((i) => i.url);
    if (!imagenes.length && p.imagen_url) imagenes.push(p.imagen_url);
    const variantes = (p.shop_product_variants || []).slice().sort((a, b) => (a.orden || 0) - (b.orden || 0));
    const stockTotal = variantes.reduce((sum, v) => sum + (v.stock || 0), 0);
    const hoy = new Date().toISOString().slice(0, 10);
    return {
      ...p,
      imagenes,
      variantes,
      stockTotal,
      agotado: variantes.length > 0 && stockTotal === 0,
      esNuevo: !!(p.nuevo_hasta && p.nuevo_hasta >= hoy),
    };
  },

  async pedido(id) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("shop_orders").select("*, shop_products(*)").eq("id", id).single();
    return data || null;
  },

  async pedidosPorIds(ids) {
    if (!window.spfc || !ids || !ids.length) return [];
    const { data } = await window.spfc.from("shop_orders").select("*, shop_products(nombre, imagen_url)").in("id", ids);
    return data || [];
  },

  async misPedidos() {
    if (!window.spfc) return [];
    const { data } = await window.spfc.from("shop_orders").select("*, shop_products(nombre, imagen_url)").order("creado_en", { ascending: false });
    return data || [];
  },

  async misFavoritos() {
    if (!window.spfc) return [];
    const { data: { session } } = await window.spfc.auth.getSession();
    if (!session) return [];
    const { data } = await window.spfc
      .from("shop_favorites")
      .select("product_id, shop_products(*, shop_product_images(url, orden), shop_product_variants(id, talla, color, stock))")
      .order("creado_en", { ascending: false });
    return (data || []).filter((f) => f.shop_products).map((f) => this._normalizarProducto(f.shop_products));
  },

  async esFavorito(productId) {
    if (!window.spfc) return false;
    const { data: { session } } = await window.spfc.auth.getSession();
    if (!session) return false;
    const { data } = await window.spfc.from("shop_favorites").select("id").eq("product_id", productId).maybeSingle();
    return !!data;
  },

  async alternarFavorito(productId) {
    const { data: { session } } = await window.spfc.auth.getSession();
    if (!session) return { requiereSesion: true };
    const { data: existente } = await window.spfc.from("shop_favorites").select("id").eq("product_id", productId).maybeSingle();
    if (existente) {
      await window.spfc.from("shop_favorites").delete().eq("id", existente.id);
      return { favorito: false };
    }
    await window.spfc.from("shop_favorites").insert({ user_id: session.user.id, product_id: productId });
    return { favorito: true };
  },

  async unirseEspera(variantId, email) {
    if (!window.spfc) throw new Error("La tienda no está disponible ahora mismo.");
    const { error } = await window.spfc.from("shop_waitlist").insert({ variant_id: variantId, email });
    if (error) throw new Error(error.message);
  },

  async suscribirNewsletter(email) {
    const res = await fetch("/.netlify/functions/subscribe-newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(texto || "No se ha podido completar la suscripción.");
  },

  async darseBajaNewsletter(email) {
    await fetch("/.netlify/functions/unsubscribe-newsletter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
  },

  async iniciarCheckoutCarrito(items) {
    const { data: { session } } = await window.spfc.auth.getSession();
    const token = session ? session.access_token : null;
    const res = await fetch("/.netlify/functions/create-shop-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (token || "") },
      body: JSON.stringify({ items }),
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(texto || "No se ha podido iniciar el pago.");
    return JSON.parse(texto);
  },

  estadoTalla(variante) {
    if (!variante || variante.stock <= 0) return "agotada";
    if (variante.stock <= 3) return "ultimas";
    return "disponible";
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
