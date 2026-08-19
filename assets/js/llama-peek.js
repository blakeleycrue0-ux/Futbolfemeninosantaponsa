/*
  llama-peek.js
  ============================================================================
  Mascota reutilizable: la llama se asoma por detrás de una tarjeta o
  bloque de la web — cabeza y patas visibles, apoyada sobre el borde
  superior del elemento, con el resto del cuerpo oculto detrás.

  Usa assets/img/llama-peek.png, una única imagen ya recortada en esa
  pose (no se redibuja ni se recorta nada por código). Se coloca con su
  borde inferior justo sobre el borde superior del elemento, por delante
  de él (más adelante en el DOM = se pinta encima), así que no hace falta
  ningún truco de z-index ni de recorte.

  Uso:
    SPFC_LLAMA_PEEK('.mi-tarjeta', { centroX: 0.5, ancho: 84 });

  Opciones (todas opcionales):
    ancho      — ancho en px de la llama (por defecto 64 en móvil, 84 en escritorio)
    centroX    — posición horizontal del centro de la llama sobre el
                 elemento, de 0 (borde izquierdo) a 1 (borde derecho). 0.5 por defecto.
    desplazX   — ajuste fino horizontal en px, se suma a centroX
    solape     — cuántos px de las patas invaden el elemento por debajo
                 de su borde superior (26px por defecto)
  ============================================================================
*/
(function () {
  var IMG_SRC = "assets/img/llama-peek.png";
  var RATIO_ALTO = 297 / 360;

  window.SPFC_LLAMA_PEEK = function (selector, opciones) {
    opciones = opciones || {};
    var el = typeof selector === "string" ? document.querySelector(selector) : selector;
    if (!el) return null;

    var rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;

    var ancho = opciones.ancho || (window.innerWidth < 780 ? 64 : 84);
    var alto = ancho * RATIO_ALTO;
    var centroX = opciones.centroX != null ? opciones.centroX : 0.5;
    var solape = opciones.solape != null ? opciones.solape : 26;

    var left = rect.left + window.scrollX + rect.width * centroX - ancho / 2 + (opciones.desplazX || 0);
    var bordeSuperior = rect.top + window.scrollY;
    var top = bordeSuperior + solape - alto;

    var img = document.createElement("img");
    img.src = IMG_SRC;
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.className = "llama-peek";
    img.style.width = ancho + "px";
    img.style.left = left + "px";
    img.style.top = top + "px";
    document.body.appendChild(img);

    return img;
  };
})();
