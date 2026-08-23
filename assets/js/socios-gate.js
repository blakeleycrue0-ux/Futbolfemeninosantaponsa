/*
  socios-gate.js
  ============================================================================
  Bloquea contenido (por ahora, solo el vídeo de los partidos) a quien no
  ha iniciado sesión. "Socia/o" es cualquier cuenta de Supabase Auth con
  email y contraseña creada en cuenta.html — la misma sesión que ya usa
  el panel de admin, sin ninguna tabla nueva. No distingue entre socias
  y personal del club: cualquiera con sesión iniciada cuenta.

  Uso:
    const dentro = await SPFC_SOCIOS.haySesion();
    if (!dentro) elemento.innerHTML = SPFC_SOCIOS.candado("Inicia sesión para ver el vídeo.");
  ============================================================================
*/
window.SPFC_SOCIOS = {
  async haySesion() {
    if (!window.spfc) return false;
    const { data: { session } } = await window.spfc.auth.getSession();
    return !!session;
  },

  candado(mensaje) {
    const volver = encodeURIComponent(location.pathname + location.search);
    return `
      <div class="socios-candado">
        <img class="socios-candado-crest" src="assets/img/escudo-santa-ponsa.png" alt="">
        <p class="socios-candado-titulo">Solo para socias y socios</p>
        <p class="socios-candado-texto">${mensaje}</p>
        <div class="socios-candado-acciones">
          <a class="btn btn-primary btn-sm" href="cuenta.html?volver=${volver}">Iniciar sesión</a>
          <a class="btn btn-outline btn-sm" href="cuenta.html?crear=1&volver=${volver}">Crear cuenta</a>
        </div>
      </div>`;
  },

  // Aviso emergente que sale nada más cargar la página, además del
  // candado colocado en el propio contenido. Se cierra con la X o
  // tocando fuera, pero el contenido sigue bloqueado igualmente.
  mostrarModal(mensaje) {
    if (document.getElementById("socios-modal")) return;
    const volver = encodeURIComponent(location.pathname + location.search);
    const overlay = document.createElement("div");
    overlay.id = "socios-modal";
    overlay.className = "socios-modal";
    overlay.innerHTML = `
      <div class="socios-modal-backdrop"></div>
      <div class="socios-modal-card" role="dialog" aria-modal="true" aria-labelledby="socios-modal-title">
        <button type="button" class="socios-modal-close" aria-label="Cerrar">✕</button>
        <img class="socios-modal-crest" src="assets/img/escudo-santa-ponsa.png" alt="">
        <h2 id="socios-modal-title" class="socios-modal-title">Solo para socias y socios</h2>
        <p class="socios-modal-texto">${mensaje}</p>
        <a class="btn btn-primary btn-block" href="cuenta.html?volver=${volver}">Iniciar sesión</a>
        <a class="btn btn-outline btn-block" href="cuenta.html?crear=1&volver=${volver}" style="margin-top:0.6rem;">Crear cuenta</a>
      </div>`;
    document.body.appendChild(overlay);
    function cerrar() { overlay.remove(); }
    overlay.querySelector(".socios-modal-close").addEventListener("click", cerrar);
    overlay.querySelector(".socios-modal-backdrop").addEventListener("click", cerrar);
  },
};
