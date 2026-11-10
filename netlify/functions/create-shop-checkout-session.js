/*
  Crea una sesión de Stripe Checkout para un pedido de la tienda (camisetas,
  sudaderas...). Precio, nombre y disponibilidad SIEMPRE se leen de la base
  de datos aquí dentro — el navegador solo manda variant_id/cantidad por
  cada línea del carrito, nunca el precio, para que no se pueda manipular
  desde el cliente.

  Acepta un carrito con varias líneas (items: [{variant_id, cantidad}]), no
  solo un producto — todas comparten una única sesión de Stripe y quedan
  unidas por shop_order_ids (coma) en los metadatos, que es lo que lee
  stripe-webhook.js al confirmarse el pago.

  Esto NO reserva stock durante el checkout (no hay sistema de reservas):
  aquí solo se comprueba que hay stock > 0 como aviso al cliente antes de
  pagar. El descuento de stock real, atómico y a prueba de doble venta
  ocurre en el webhook al confirmarse el pago (shop_descontar_stock).

  Sin envíos: la recogida es siempre en el club, así que no se pide
  dirección postal en ningún sitio de este flujo.

  Requiere sesión de Supabase Auth (Authorization: Bearer <access_token>).
  Devuelve { url } con la URL de Stripe Checkout a la que redirigir.
*/
const { createClient } = require("@supabase/supabase-js");
const Stripe = require("stripe");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, PUBLIC_SITE_URL, URL: SITE_URL } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 500, body: "Faltan variables de entorno de Supabase" };
  }
  if (!STRIPE_SECRET_KEY) {
    return { statusCode: 500, body: "Falta STRIPE_SECRET_KEY — todavía no se puede cobrar." };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    return { statusCode: 400, body: "JSON inválido" };
  }
  const items = Array.isArray(payload.items) ? payload.items : null;
  if (!items || !items.length) {
    return { statusCode: 400, body: "El carrito está vacío." };
  }
  if (items.length > 20) {
    return { statusCode: 400, body: "Demasiados artículos en el carrito." };
  }
  for (const it of items) {
    const cantidad = Number(it.cantidad);
    if (!it.variant_id || !Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) {
      return { statusCode: 400, body: "Carrito no válido." };
    }
  }

  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return { statusCode: 401, body: "Inicia sesión para comprar." };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData || !userData.user) {
    return { statusCode: 401, body: "Sesión no válida — vuelve a iniciar sesión." };
  }
  const user = userData.user;

  const lineasStripe = [];
  const pedidosCreados = [];

  for (const it of items) {
    const cantidad = Number(it.cantidad);

    const { data: variant, error: variantError } = await supabase
      .from("shop_product_variants")
      .select("*, shop_products(*)")
      .eq("id", it.variant_id)
      .single();
    if (variantError || !variant || !variant.shop_products || !variant.shop_products.activo) {
      // Deshacemos los pedidos "pendiente" ya creados en este mismo carrito
      // antes de devolver el error, para no dejar basura huérfana.
      for (const o of pedidosCreados) await supabase.from("shop_orders").delete().eq("id", o.id);
      return { statusCode: 404, body: "Uno de los productos del carrito ya no está disponible." };
    }
    if (variant.stock < cantidad) {
      for (const o of pedidosCreados) await supabase.from("shop_orders").delete().eq("id", o.id);
      return { statusCode: 409, body: `No queda stock suficiente de "${variant.shop_products.nombre}" (talla ${variant.talla}).` };
    }

    const producto = variant.shop_products;
    const importe = Number(producto.precio) * cantidad;

    const { data: order, error: orderError } = await supabase
      .from("shop_orders")
      .insert({
        user_id: user.id,
        product_id: producto.id,
        variant_id: variant.id,
        talla: variant.talla,
        color: variant.color,
        cantidad,
        importe,
        estado: "pendiente",
      })
      .select()
      .single();
    if (orderError || !order) {
      for (const o of pedidosCreados) await supabase.from("shop_orders").delete().eq("id", o.id);
      return { statusCode: 500, body: "No se ha podido crear el pedido: " + (orderError ? orderError.message : "") };
    }
    pedidosCreados.push(order);

    lineasStripe.push({
      price_data: {
        currency: "eur",
        product_data: {
          name: producto.nombre + " — Talla " + variant.talla + (variant.color ? ` · ${variant.color}` : ""),
          description: producto.descripcion || undefined,
        },
        unit_amount: Math.round(Number(producto.precio) * 100),
      },
      quantity: cantidad,
    });
  }

  const baseUrl = (PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info").replace(/\/$/, "");
  const stripe = Stripe(STRIPE_SECRET_KEY);
  const idsPedidos = pedidosCreados.map((o) => o.id).join(",");

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email,
      line_items: lineasStripe,
      metadata: { shop_order_ids: idsPedidos, user_id: user.id },
      success_url: `${baseUrl}/tienda-completada.html?orders=${idsPedidos}`,
      cancel_url: `${baseUrl}/carrito.html?cancelado=1`,
      allow_promotion_codes: true,
    });
  } catch (err) {
    for (const o of pedidosCreados) await supabase.from("shop_orders").update({ estado: "fallido" }).eq("id", o.id);
    return { statusCode: 502, body: "Stripe no ha podido crear el pago: " + err.message };
  }

  const idsArray = pedidosCreados.map((o) => o.id);
  const { error: updateError } = await supabase
    .from("shop_orders")
    .update({ stripe_checkout_session_id: session.id })
    .in("id", idsArray);
  if (updateError) {
    return { statusCode: 500, body: "Pedido creado pero no se ha podido guardar la sesión de Stripe." };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: session.url }),
  };
};
