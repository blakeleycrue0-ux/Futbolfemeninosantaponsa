/*
  Plantilla de configuración pública del cliente.
  En el build de Netlify, scripts/inject-config.js sustituye los
  marcadores __SUPABASE_URL__ / __SUPABASE_ANON_KEY__ / __VAPID_PUBLIC_KEY__
  por las variables de entorno reales y escribe el resultado en
  assets/js/config.js (fichero generado, no versionado — ver .gitignore).

  En local, copia este fichero a assets/js/config.js y rellena los valores
  a mano, o define SUPABASE_URL / SUPABASE_ANON_KEY / VAPID_PUBLIC_KEY y
  ejecuta `npm run build`.

  VAPID_PUBLIC_KEY no es un secreto — es la clave pública del par VAPID
  de notificaciones push, está pensada para ir en el cliente (la privada
  se queda solo en send-push.js, por variable de entorno).
*/
window.SPFC_CONFIG = {
  SUPABASE_URL: "__SUPABASE_URL__",
  SUPABASE_ANON_KEY: "__SUPABASE_ANON_KEY__",
  VAPID_PUBLIC_KEY: "__VAPID_PUBLIC_KEY__",
};
