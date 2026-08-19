/*
  llama-peek.js
  ============================================================================
  Mascota reutilizable: la llama se asoma por detrás de una tarjeta o
  bloque de la web, con la cabeza sobresaliendo por encima del borde
  superior y las patas apoyadas sobre ese borde. Usa siempre la MISMA
  imagen, sin recortarla como archivo ni redibujarla
  (assets/img/llama-mascot-sleeping.png): se generan dos <img> con la
  misma imagen y se recorta cada una con clip-path (ver .llama-peek en
  components.css) — una muestra solo la cabeza (0%-60% de la imagen) y la
  otra solo las patas (76%-100%). La franja del cuerpo entre ambas nunca
  se dibuja, así que nunca hay que preocuparse por z-index respecto a la
  tarjeta: da la sensación de que la llama sale de detrás.

  Uso:
    SPFC_LLAMA_PEEK('.mi-tarjeta', { centroX: 0.5, ancho: 84 });

  Opciones (todas opcionales):
    ancho      — ancho en px de la llama (por defecto 64 en móvil, 84 en escritorio)
    centroX    — posición horizontal del centro de la llama sobre el
                 elemento, de 0 (borde izquierdo) a 1 (borde derecho). 0.5 por defecto.
    desplazX   — ajuste fino horizontal en px, se suma a centroX
    pokeArriba — cuántos px de las patas sobresalen por encima del borde
                 antes de apoyarse en la tarjeta (8px por defecto)
  ============================================================================
*/
(function () {
  var IMG_SRC = "assets/img/llama-mascot-sleeping.png";
  var RATIO_ALTO = 391 / 380;
  // Deben coincidir con los clip-path de .llama-peek--cabeza/--patas en components.css
  var CORTE_CABEZA = 60;
  var CORTE_PATAS = 76;

  function crearCapa(clase, ancho, left, top) {
    var img = document.createElement("img");
    img.src = IMG_SRC;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.className = "llama-peek " + clase;
    img.style.width = ancho + "px";
    img.style.left = left + "px";
    img.style.top = top + "px";
    document.body.appendChild(img);
    return img;
  }

  window.SPFC_LLAMA_PEEK = function (selector, opciones) {
    opciones = opciones || {};
    var el = typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!el) return null;

    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    var ancho = opciones.ancho || (window.innerWidth < 780 ? 64 : 84);
    var alto = ancho * RATIO_ALTO;
    var centroX = opciones.centroX != null ? opciones.centroX : 0.5;
    var pokeArriba = opciones.pokeArriba != null ? opciones.pokeArriba : 8;

    var left = rect.left + window.scrollX + rect.width * centroX - ancho / 2 + (opciones.desplazX || 0);
    var bordeSuperior = rect.top + window.scrollY;

    var cabeza = crearCapa("llama-peek--cabeza", ancho, left, bordeSuperior - alto * (CORTE_CABEZA / 100));
    var patas = crearCapa("llama-peek--patas", ancho, left, (bordeSuperior - pokeArriba) - alto * (CORTE_PATAS / 100));

    return { cabeza: cabeza, patas: patas };
  };
})();
