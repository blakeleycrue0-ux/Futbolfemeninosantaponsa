/*
  qr.js
  ============================================================================
  Dibuja el código QR de una credencial de acceso. Envuelve la librería
  "qrcode" (cargada por CDN en la página, igual que @supabase/supabase-js)
  para que mi-carnet.html/entrada.html no tengan que saber nada de la
  librería concreta — si en la fase 2 se cambia de librería o de diseño,
  solo hay que tocar este fichero.
  ============================================================================
*/
window.SPFC_QR = {
  // contenedorEl: elemento donde meter el <canvas>. texto: el token de la
  // credencial (nunca datos personales).
  render(contenedorEl, texto) {
    if (!contenedorEl) return;
    contenedorEl.innerHTML = "";
    if (!window.QRCode) {
      contenedorEl.textContent = "No se ha podido generar el código QR.";
      return;
    }
    const canvas = document.createElement("canvas");
    contenedorEl.appendChild(canvas);
    window.QRCode.toCanvas(canvas, texto, { width: 240, margin: 1 }, (err) => {
      if (err) contenedorEl.textContent = "No se ha podido generar el código QR.";
    });
  },
};
