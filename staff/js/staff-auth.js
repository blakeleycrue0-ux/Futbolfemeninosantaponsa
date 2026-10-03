/*
  Guarda de autenticación de staff/. Mismo patrón que admin/js/admin-auth.js
  pero exige is_app_staff() (vale tanto para role='admin' como role='staff'
  en app_admins) en vez de is_app_admin() — el personal de control de
  acceso no necesita ni debe poder entrar en el resto del panel de admin.
  El login es el mismo formulario de siempre (admin/index.html); desde ahí
  se redirige aquí si la cuenta es staff pero no admin.
*/
(async function () {
  if (!window.spfc) {
    document.body.innerHTML =
      '<div style="padding:3rem;font-family:sans-serif;max-width:520px;margin:0 auto;">' +
      "<h1 style=\"font-size:1.2rem;\">Supabase no está configurado</h1>" +
      "<p>Define SUPABASE_URL y SUPABASE_ANON_KEY como variables de entorno en Netlify.</p>" +
      '<a href="../index.html">Volver a la web</a></div>';
    return;
  }

  const { data: { session } } = await window.spfc.auth.getSession();
  if (!session) {
    location.href = "../admin/index.html?volver=" + encodeURIComponent(location.pathname + location.search);
    return;
  }

  const { data: esStaff } = await window.spfc.rpc("is_app_staff");
  if (!esStaff) {
    await window.spfc.auth.signOut();
    location.href = "../admin/index.html?error=sin_acceso";
    return;
  }

  window.spfc.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") location.href = "../admin/index.html";
  });

  document.querySelectorAll("[data-admin-email]").forEach((el) => {
    el.textContent = session.user.email;
  });
  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await window.spfc.auth.signOut();
      location.href = "../admin/index.html";
    });
  });

  window.SPFC_STAFF_SESSION = session;
})();
