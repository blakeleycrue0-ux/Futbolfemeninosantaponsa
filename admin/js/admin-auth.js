/*
  Guarda de autenticación compartida por todas las páginas de admin/.
  Incluir después de supabase-client.js. index.html (login) también la
  incluye: si ya hay sesión, se redirige directamente al dashboard.
*/
(async function () {
  const isLoginPage = /\/admin\/(index\.html)?$/.test(location.pathname) || location.pathname.endsWith("/admin/index.html");

  if (!window.spfc) {
    if (!isLoginPage) {
      document.body.innerHTML =
        '<div style="padding:3rem;font-family:sans-serif;max-width:520px;margin:0 auto;">' +
        "<h1 style=\"font-size:1.2rem;\">Supabase no está configurado</h1>" +
        "<p>Define SUPABASE_URL y SUPABASE_ANON_KEY como variables de entorno en Netlify " +
        "(o en assets/js/config.js en local) para poder usar el panel de administración.</p>" +
        '<a href="../index.html">Volver a la web</a></div>';
    }
    return;
  }

  const { data: { session } } = await window.spfc.auth.getSession();

  if (!session && !isLoginPage) {
    location.href = "index.html";
    return;
  }
  if (session && isLoginPage) {
    location.href = "dashboard.html";
    return;
  }

  window.spfc.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") location.href = "index.html";
  });

  if (session) {
    document.querySelectorAll("[data-admin-email]").forEach((el) => {
      el.textContent = session.user.email;
    });
  }

  document.querySelectorAll("[data-logout]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await window.spfc.auth.signOut();
      location.href = "index.html";
    });
  });

  window.SPFC_ADMIN_SESSION = session;
})();
