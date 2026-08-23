/*
  socios-gate.js
  ============================================================================
  Bloquea contenido (noticias, vídeo de partidos) a quien no ha iniciado
  sesión. "Socia/o" es cualquier cuenta de Supabase Auth con email y
  contraseña creada en cuenta.html — la misma sesión que ya usa el panel
  de admin, sin ninguna tabla nueva. No distingue entre socias y personal
  del club: cualquiera con sesión iniciada cuenta.

  Uso:
    const dentro = await SPFC_SOCIOS.haySesion();
    if (!dentro) elemento.innerHTML = SPFC_SOCIOS.candado("Inicia sesión para ver esto.");
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
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 11V7a4 4 0 018 0v4" stroke="currentColor" stroke-width="1.6"/></svg>
        <p class="socios-candado-texto">${mensaje}</p>
        <a class="btn btn-primary btn-sm" href="cuenta.html?volver=${volver}">Iniciar sesión</a>
        <a class="socios-candado-crear" href="cuenta.html?crear=1&volver=${volver}">¿No tienes cuenta? Crear una</a>
      </div>`;
  },
};
