/*
  Crea una sesión de Stripe Checkout para comprar un producto de
  socio/abono/entrada. El precio y el nombre SIEMPRE se leen de la base de
  datos aquí dentro — el navegador solo manda el product_id, nunca el
  precio, para que no se pueda manipular desde el cliente.

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
  const { product_id } = payload;
  if (!product_id) {
    return { statusCode: 400, body: "Falta product_id" };
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
    .from("ticket_products")
    .select("*")
    .eq("id", product_id)
    .eq("activo", true)
    .single();
  if (productError || !product) {
    return { statusCode: 404, body: "Ese producto no existe o ya no está a la venta." };
  }

  const ahora = new Date();
  if (product.sales_start && ahora < new Date(product.sales_start)) {
    return { statusCode: 409, body: "La venta de este producto todavía no ha empezado." };
  }
  if (product.sales_end && ahora > new Date(product.sales_end)) {
    return { statusCode: 409, body: "La venta de este producto ya ha terminado." };
  }
  if (product.capacity != null && product.capacity_sold >= product.capacity) {
    return { statusCode: 409, body: "Aforo agotado." };
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({ user_id: user.id, product_id: product.id, estado: "pendiente", importe: product.precio })
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
            name: product.nombre,
            description: product.descripcion || undefined,
          },
          unit_amount: Math.round(Number(product.precio) * 100),
        },
        quantity: 1,
      }],
      metadata: { order_id: order.id, product_id: product.id, user_id: user.id },
      success_url: `${baseUrl}/compra-completada.html?order=${order.id}`,
      cancel_url: `${baseUrl}/checkout.html?producto=${product.id}&cancelado=1`,
      // Deja que Stripe muestre su propio campo de "código promocional" en
      // la página de pago — los códigos se crean/gestionan en el dashboard
      // de Stripe (Productos > Cupones), no hace falta nada más aquí.
      allow_promotion_codes: true,
    });
  } catch (err) {
    await supabase.from("orders").update({ estado: "fallido" }).eq("id", order.id);
    return { statusCode: 502, body: "Stripe no ha podido crear el pago: " + err.message };
  }

  const { error: updateError } = await supabase
    .from("orders")
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
