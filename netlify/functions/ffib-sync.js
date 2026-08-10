const { ejecutarSincronizacion } = require("./lib/ffib-sync-core");

// Se ejecuta sola por el cron definido en netlify.toml — Netlify no permite
// invocar directamente por URL una función "scheduled" desde fuera (devuelve
// 403), así que para probarla a mano desde el panel se usa
// ffib-sync-manual.js, que ejecuta exactamente la misma lógica.
exports.handler = async function () {
  return ejecutarSincronizacion();
};
