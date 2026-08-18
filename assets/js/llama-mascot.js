/*
  llama-mascot.js
  ============================================================================
  Easter egg del club: una pequeña llama que, de vez en cuando, aparece en
  una esquina inferior de la pantalla, da un par de saltitos y se va sola a
  los pocos segundos. No en todas las páginas ni todas las veces — es un
  detalle escondido, no un elemento fijo de la web.

  Reglas de seguridad, para que nunca estorbe:
  - position: fixed en una esquina inferior (nunca tapa la cabecera, el
    menú ni el pie de página).
  - pointer-events: none — no puede robar ningún clic aunque se solape
    visualmente con algo.
  - Respeta prefers-reduced-motion.
  ============================================================================
*/
(function () {
  var PROBABILIDAD = 0.35;
  if (Math.random() > PROBABILIDAD) return;

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var esquinas = ["left", "right"];
  var esquina = esquinas[Math.floor(Math.random() * esquinas.length)];

  function mostrarLlama() {
    var img = document.createElement("img");
    img.src = "assets/img/llama-mascot.png";
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.className = "spfc-llama-mascot spfc-llama-mascot--" + esquina;
    document.body.appendChild(img);

    requestAnimationFrame(function () {
      img.classList.add("is-visible");
    });

    setTimeout(function () {
      img.classList.remove("is-visible");
      setTimeout(function () {
        img.remove();
      }, 700);
    }, reduceMotion ? 6000 : 9000);
  }

  if (document.readyState === "complete") {
    setTimeout(mostrarLlama, 1200);
  } else {
    window.addEventListener("load", function () {
      setTimeout(mostrarLlama, 1200);
    });
  }
})();
