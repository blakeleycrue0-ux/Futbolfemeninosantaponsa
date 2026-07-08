/*
  Cliente Supabase compartido por toda la web pública.
  Requiere que la página cargue, en este orden:
    1. https://unpkg.com/@supabase/supabase-js@2 (UMD, expone window.supabase)
    2. assets/js/config.js (generado en build, define window.SPFC_CONFIG)
    3. este fichero

  Si config.js no existe o las claves están vacías (build local sin envs),
  window.spfc queda a null y las páginas deben caer en su contenido
  estático de respaldo — nunca deben lanzar una excepción por su ausencia.
*/
(function () {
  const cfg = window.SPFC_CONFIG || {};
  const hasSupabaseLib = typeof window.supabase !== "undefined" && window.supabase.createClient;
  const hasKeys = cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.startsWith("__") && !cfg.SUPABASE_ANON_KEY.startsWith("__");

  window.spfc = (hasSupabaseLib && hasKeys)
    ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY)
    : null;

  if (!window.spfc) {
    console.info("[spfc] Supabase no configurado: la página usará contenido estático de respaldo.");
  }
})();
