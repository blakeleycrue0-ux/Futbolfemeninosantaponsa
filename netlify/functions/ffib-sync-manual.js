const { ejecutarSincronizacion } = require("./lib/ffib-sync-core");

// Función normal (no "scheduled"), para que el botón "Sincronizar ahora"
// del panel de admin pueda llamarla directamente por URL — Netlify bloquea
// esa llamada directa en las funciones "scheduled" como ffib-sync.js.
exports.handler = async function () {
  return ejecutarSincronizacion();
};
