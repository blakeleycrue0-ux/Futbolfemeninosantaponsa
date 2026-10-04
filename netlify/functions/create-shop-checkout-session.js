/*
  Crea una sesión de Stripe Checkout para un pedido de la tienda (camisetas,
  pantalones...). El precio y el nombre SIEMPRE se leen de la base de datos
  aquí dentro — el navegador solo manda product_id/talla/cantidad, nunca el
  precio, para que no se pueda manipular desde el cliente.

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
  const { product_id, talla } = payload;
  const cantidad = Number(payload.cantidad) || 1;
  if (!product_id) {
    return { statusCode: 400, body: "Falta product_id" };
  }
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 10) {
    return { statusCode: 400, body: "Cantidad no válida." };
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

  const { data: product, error: productError } = await supabase
    .from("shop_products")
    .select("*")
    .eq("id", product_id)
    .eq("activo", true)
    .single();
  if (productError || !product) {
    return { statusCode: 404, body: "Ese producto no existe o ya no está a la venta." };
  }

  if (product.tallas && product.tallas.length) {
    if (!talla || !product.tallas.includes(talla)) {
      return { statusCode: 400, body: "Elige una talla válida." };
    }
  }

  const importe = Number(product.precio) * cantidad;

  const { data: order, error: orderError } = await supabase
    .from("shop_orders")
    .insert({
      user_id: user.id,
      product_id: product.id,
      talla: product.tallas && product.tallas.length ? talla : null,
      cantidad,
      importe,
      estado: "pendiente",
    })
    .select()
    .single();
  if (orderError || !order) {
    return { statusCode: 500, body: "No se ha podido crear el pedido: " + (orderError ? orderError.message : "") };
  }

  const baseUrl = (PUBLIC_SITE_URL || SITE_URL || "https://ffsp.info").replace(/\/$/, "");
  const stripe = Stripe(STRIPE_SECRET_KEY);

  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: user.email,
      line_items: [{
        price_data: {
          currency: "eur",
          product_data: {
            name: product.nombre + (order.talla ? ` (talla ${order.talla})` : ""),
            description: product.descripcion || undefined,
          },
          unit_amount: Math.round(Number(product.precio) * 100),
        },
        quantity: cantidad,
      }],
      metadata: { shop_order_id: order.id, product_id: product.id, user_id: user.id },
      success_url: `${baseUrl}/tienda-completada.html?order=${order.id}`,
      cancel_url: `${baseUrl}/tienda-checkout.html?producto=${product.id}&cancelado=1`,
      allow_promotion_codes: true,
    });
  } catch (err) {
    await supabase.from("shop_orders").update({ estado: "fallido" }).eq("id", order.id);
    return { statusCode: 502, body: "Stripe no ha podido crear el pago: " + err.message };
  }

  const { error: updateError } = await supabase
    .from("shop_orders")
    .update({ stripe_checkout_session_id: session.id })
    .eq("id", order.id);
  if (updateError) {
    return { statusCode: 500, body: "Pedido creado pero no se ha podido guardar la sesión de Stripe." };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: session.url }),
  };
};
