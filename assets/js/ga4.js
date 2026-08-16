/*
  Google Analytics 4 (GA4)
  ============================================================================
  PON AQUÍ TU ID DE MEDICIÓN: sustituye "G-XXXXXXXXXX" de la línea de abajo
  por el que te da Google Analytics (Administrador → Flujos de datos → tu
  flujo de datos web → "ID de medición", con forma "G-XXXXXXXXXX").

  Mientras el valor siga siendo el de ejemplo "G-XXXXXXXXXX", no se carga
  ningún script de Google y no se envía ningún dato — así que es seguro
  desplegar este archivo antes de tener el ID real.

  Este único archivo se carga en todas las páginas públicas, así que solo
  hay que poner el ID una vez, aquí.
  ============================================================================
*/
window.GA_MEASUREMENT_ID = "G-MP20DBMMSV";

(function () {
  var id = window.GA_MEASUREMENT_ID;
  if (!id || id === "G-XXXXXXXXXX") return;

  var script = document.createElement("script");
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtag/js?id=" + id;
  document.head.appendChild(script);

  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag("js", new Date());
  gtag("config", id);
})();
