/*
  llama-mascot.js
  ============================================================================
  Easter egg del club: una llama que aparece dormidita, tumbada encima de
  una letra de un título de la página — solo una vez por visita, y solo
  después de que la persona lleve unos 5 minutos navegando por la web (el
  tiempo se cuenta entre páginas, no se reinicia al cambiar de página).

  Reglas de seguridad, para que nunca estorbe:
  - Se coloca dentro del contenido (position: absolute sobre la página),
    nunca sobre la cabecera ni el menú.
  - pointer-events: none — no puede robar ningún clic aunque se solape
    visualmente con algo.
  - Respeta prefers-reduced-motion (aparece igualmente, pero sin la
    animación de respiración).
  ============================================================================
*/
(function () {
  var YA_MOSTRADA_KEY = "spfc_llama_mostrada";
  var INICIO_VISITA_KEY = "spfc_llama_visita_desde";
  var ESPERA_MS = 5 * 60 * 1000;

  if (sessionStorage.getItem(YA_MOSTRADA_KEY)) return;

  var inicio = Number(sessionStorage.getItem(INICIO_VISITA_KEY));
  if (!inicio) {
    inicio = Date.now();
    sessionStorage.setItem(INICIO_VISITA_KEY, String(inicio));
  }
  var restante = ESPERA_MS - (Date.now() - inicio);

  function escaparHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Envuelve una letra del encabezado en un span (sin tocar espacios) para
  // medir su posición exacta, y deshace el cambio justo después.
  function medirLetraDe(h) {
    var original = h.innerHTML;
    var texto = h.textContent;
    var letras = [];
    for (var i = 0; i < texto.length; i++) {
      if (/[a-zA-ZÀ-ÿ]/.test(texto[i])) letras.push(i);
    }
    if (!letras.length) return null;

    var candidatos = letras.filter(function (i) {
      return i > texto.length * 0.15 && i < texto.length * 0.85;
    });
    if (!candidatos.length) candidatos = letras;
    var indice = candidatos[Math.floor(Math.random() * candidatos.length)];

    h.innerHTML =
      escaparHtml(texto.slice(0, indice)) +
      '<span id="spfc-llama-letra">' + escaparHtml(texto[indice]) + "</span>" +
      escaparHtml(texto.slice(indice + 1));

    var span = document.getElementById("spfc-llama-letra");
    var rect = span.getBoundingClientRect();
    h.innerHTML = original;

    if (!rect.width || !rect.height) return null;
    return rect;
  }

  // h1 primero; si la página no tiene (o está vacío/oculto), prueba con
  // cada h2 en orden hasta encontrar uno visible con texto.
  function elegirLetra() {
    var encabezados = [];
    var h1 = document.querySelector("h1");
    if (h1) encabezados.push(h1);
    Array.prototype.forEach.call(document.querySelectorAll("h2"), function (h2) {
      encabezados.push(h2);
    });

    for (var e = 0; e < encabezados.length; e++) {
      var h = encabezados[e];
      if (!h.textContent || !h.textContent.trim()) continue;
      var rectEl = h.getBoundingClientRect();
      if (!rectEl.width || !rectEl.height) continue;
      var resultado = medirLetraDe(h);
      if (resultado) return resultado;
    }
    return null;
  }

  function mostrarLlama() {
    var rect = elegirLetra();
    if (!rect) return;

    var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var giro = (Math.random() * 14 - 7).toFixed(1);

    var img = document.createElement("img");
    img.src = "assets/img/llama-mascot-sleeping.png";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.className = "spfc-llama-sleeping";
    if (!reduceMotion) img.classList.add("spfc-llama-breathing");
    img.style.setProperty("--spfc-llama-tilt", giro + "deg");

    document.body.appendChild(img);

    // Centra la llama sobre la letra, apoyada justo en su borde superior.
    var anchoLlama = img.getBoundingClientRect().width || (window.innerWidth < 780 ? 66 : 96);
    var letraCentroX = rect.left + window.scrollX + rect.width / 2;
    var letraTopY = rect.top + window.scrollY;
    img.style.left = (letraCentroX - anchoLlama / 2) + "px";
    img.style.top = (letraTopY - anchoLlama * 0.62) + "px";

    requestAnimationFrame(function () {
      img.classList.add("is-visible");
    });

    sessionStorage.setItem(YA_MOSTRADA_KEY, "1");
  }

  function programar() {
    if (restante <= 0) {
      mostrarLlama();
    } else {
      setTimeout(mostrarLlama, restante);
    }
  }

  if (document.readyState === "complete") {
    programar();
  } else {
    window.addEventListener("load", programar);
  }
})();
