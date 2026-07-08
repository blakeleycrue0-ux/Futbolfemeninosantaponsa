/*
  Plantilla de configuración pública del cliente.
  En el build de Netlify, scripts/inject-config.js sustituye los
  marcadores __SUPABASE_URL__ / __SUPABASE_ANON_KEY__ por las variables
  de entorno reales y escribe el resultado en assets/js/config.js
  (fichero generado, no versionado — ver .gitignore).

  En local, copia este fichero a assets/js/config.js y rellena los valores
  a mano, o define SUPABASE_URL / SUPABASE_ANON_KEY y ejecuta `npm run build`.
*/
window.SPFC_CONFIG = {
  SUPABASE_URL: "__SUPABASE_URL__",
  SUPABASE_ANON_KEY: "__SUPABASE_ANON_KEY__",
};
