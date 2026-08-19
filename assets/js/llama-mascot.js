/*
  llama-mascot.js
  ============================================================================
  Easter egg del club: una llama dormidita, tumbada literalmente ENCIMA del
  título del carrusel de noticias del home. Solo vive en index.html, sale
  desde el minuto 0 (en cuanto ese título está en pantalla) y se muestra
  cada vez que se carga el home, no solo la primera vez.

  Reglas de seguridad, para que nunca estorbe:
  - Se coloca dentro del contenido (position: absolute sobre la página),
    nunca sobre la cabecera ni el menú (se fuerza un margen mínimo respecto
    a la cabecera fija para que no le tape nunca las orejas).
  - pointer-events: none — no puede robar ningún clic aunque se solape
    visualmente con algo.
  - Respeta prefers-reduced-motion (aparece igualmente, pero sin la
    animación de respiración).
  ============================================================================
*/
(function () {
  var CABECERA_ALTO = 72;
  var MARGEN_CABECERA = 16;
  var CLEARANCE_MIN = CABECERA_ALTO + MARGEN_CABECERA;
  var SOLAPE = 0.1; // solo un poco de la llama se apoya sobre la letra
  var INTENTOS_MAX = 30; // ~6s esperando a que cargue el carrusel de noticias
  var ESPERA_INTENTO_MS = 200;

  function escaparHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Envuelve una letra del título en un span (sin tocar espacios) para
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

  // Sitio fijo: el título del carrusel de noticias del home (lo primero
  // visible al entrar, sin hacer scroll). Si por lo que sea no existe,
  // recurre a un h1/h2 de la página como red de seguridad.
  function elegirLetra() {
    var titulo = document.querySelector(".news-slide-title");
    if (titulo && titulo.textContent && titulo.textContent.trim()) {
      var resultadoTitulo = medirLetraDe(titulo);
      if (resultadoTitulo) return resultadoTitulo;
    }

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

    // Apoyada literalmente ENCIMA de la letra: casi toda la llama queda por
    // encima del título, con solo un pequeño solape para que se vea que
    // está tumbada sobre el borde superior, no colgando sobre el texto.
    var anchoLlama = img.getBoundingClientRect().width || (window.innerWidth < 780 ? 66 : 96);
    var letraCentroX = rect.left + window.scrollX + rect.width / 2;
    var letraTopY = rect.top + window.scrollY;
    var top = letraTopY - anchoLlama * (1 - SOLAPE);
    top = Math.max(top, CLEARANCE_MIN); // nunca por debajo de la cabecera fija

    img.style.left = (letraCentroX - anchoLlama / 2) + "px";
    img.style.top = top + "px";

    requestAnimationFrame(function () {
      img.classList.add("is-visible");
    });
  }

  // El carrusel de noticias del home carga desde Supabase de forma
  // asíncrona, así que se espera un poco a que exista antes de rendirse.
  function intentarMostrar(intentosRestantes) {
    if (document.querySelector(".news-slide-title") || intentosRestantes <= 0) {
      mostrarLlama();
    } else {
      setTimeout(function () {
        intentarMostrar(intentosRestantes - 1);
      }, ESPERA_INTENTO_MS);
    }
  }

  function iniciar() {
    intentarMostrar(INTENTOS_MAX);
  }

  if (document.readyState === "complete") {
    iniciar();
  } else {
    window.addEventListener("load", iniciar);
  }
})();
