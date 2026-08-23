/*
  mantenimiento-check.js
  ============================================================================
  Si el modo mantenimiento está activado (se cambia al instante desde el
  admin, sin desplegar nada nuevo — ver site_settings.modo_mantenimiento),
  manda a quien visite cualquier página pública a mantenimiento.html. Quien
  entre la contraseña de "Acceso del equipo" en esa pantalla deja de verla
  en este navegador (localStorage), hasta que se borre a mano.
  ============================================================================
*/
(async function () {
  if (/\/mantenimiento\.html$/.test(location.pathname)) return;
  if (localStorage.getItem("spfc_preview_ok") === "1") return;
  if (!window.spfc) return;
  try {
    const { data } = await window.spfc.from("site_settings").select("modo_mantenimiento").eq("id", true).single();
    if (data && data.modo_mantenimiento) {
      location.replace("mantenimiento.html?volver=" + encodeURIComponent(location.pathname + location.search));
    }
  } catch (err) {
    // Si falla la consulta, no bloqueamos la web por un error de red.
  }
})();
