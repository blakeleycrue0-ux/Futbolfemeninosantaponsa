/*
  ticketing-data.js
  ============================================================================
  Lógica de datos compartida por las páginas de socios/abonos/entradas
  (socios.html, entradas.html, checkout.html, compra-completada.html,
  mi-ffsp.html, mi-carnet.html, entrada.html). Solo lectura/consultas a
  Supabase y helpers de formato — nada de HTML aquí, para que la fase 2
  pueda rehacer el diseño de esas páginas sin tocar esta lógica.
  ============================================================================
*/
window.SPFC_TICKETING = {
  async productosActivos(tipos) {
    if (!window.spfc) return [];
    let query = window.spfc.from("ticket_products").select("*, teams(nombre), matches(rival, fecha, hora)").eq("activo", true);
    if (tipos && tipos.length) query = query.in("tipo", tipos);
    const { data, error } = await query.order("precio");
    if (error) { console.warn("[ticketing] error cargando productos:", error.message); return []; }
    const ahora = new Date();
    return (data || []).filter((p) => {
      if (p.sales_start && ahora < new Date(p.sales_start)) return false;
      if (p.sales_end && ahora > new Date(p.sales_end)) return false;
      return true;
    });
  },

  async producto(id) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("ticket_products").select("*, teams(nombre), matches(rival, fecha, hora)").eq("id", id).single();
    return data || null;
  },

  async sesionActual() {
    if (!window.spfc) return null;
    const { data: { session } } = await window.spfc.auth.getSession();
    return session || null;
  },

  async pedido(id) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("orders").select("*, ticket_products(*)").eq("id", id).single();
    return data || null;
  },

  async misMembresias() {
    if (!window.spfc) return [];
    const { data } = await window.spfc.from("memberships").select("*, ticket_products(nombre, tipo), teams(nombre)").order("creado_en", { ascending: false });
    return data || [];
  },

  async misEntradas() {
    if (!window.spfc) return [];
    const { data } = await window.spfc.from("tickets").select("*, matches(rival, fecha, hora, campo)").order("creado_en", { ascending: false });
    return data || [];
  },

  async misPedidos() {
    if (!window.spfc) return [];
    const { data } = await window.spfc.from("orders").select("*, ticket_products(nombre, tipo)").order("creado_en", { ascending: false });
    return data || [];
  },

  async credencialDeMembership(membershipId) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("access_credentials").select("token").eq("membership_id", membershipId).single();
    return data ? data.token : null;
  },

  async credencialDeTicket(ticketId) {
    if (!window.spfc) return null;
    const { data } = await window.spfc.from("access_credentials").select("token").eq("ticket_id", ticketId).single();
    return data ? data.token : null;
  },

  async iniciarCheckout(productId) {
    const { data: { session } } = await window.spfc.auth.getSession();
    const token = session ? session.access_token : null;
    const res = await fetch("/.netlify/functions/create-checkout-session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + (token || "") },
      body: JSON.stringify({ product_id: productId }),
    });
    const texto = await res.text();
    if (!res.ok) throw new Error(texto || "No se ha podido iniciar el pago.");
    return JSON.parse(texto);
  },

  nombreTipo(tipo) {
    return { socio: "Socio FFSP", abono: "Abono de temporada", entrada: "Entrada de partido" }[tipo] || tipo;
  },

  fmtEuros(n) {
    return (Number(n) || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
  },

  fmtFecha(f) {
    return f ? new Date(f).toLocaleDateString("es-ES", { weekday: "long", day: "2-digit", month: "long" }) : "";
  },
};
