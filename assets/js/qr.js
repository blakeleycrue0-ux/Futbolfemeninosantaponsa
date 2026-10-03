/*
  qr.js
  ============================================================================
  Dibuja el código QR de una credencial de acceso. Envuelve la librería
  "qrcodejs" (davidshimjs, cargada por CDN en la página) para que
  mi-carnet.html/entrada.html no tengan que saber nada de la librería
  concreta — si en la fase 2 se cambia de librería o de diseño, solo hay
  que tocar este fichero.

  Nota: se usa "qrcodejs" (cdnjs) y no el paquete npm "qrcode" (unpkg) —
  ese segundo no publica ningún fichero listo para <script src> en su
  versión 1.5.3 (su carpeta build/ no está en el paquete publicado), así
  que window.QRCode nunca llegaba a existir y el QR no se dibujaba nunca.
  ============================================================================
*/
window.SPFC_QR = {
  // contenedorEl: elemento donde dibujar el QR. texto: el token de la
  // credencial (nunca datos personales).
  render(contenedorEl, texto) {
    if (!contenedorEl) return;
    contenedorEl.innerHTML = "";
    if (!window.QRCode) {
      contenedorEl.textContent = "No se ha podido generar el código QR.";
      return;
    }
    new window.QRCode(contenedorEl, {
      text: texto,
      width: 220,
      height: 220,
      correctLevel: window.QRCode.CorrectLevel.M,
    });
  },
};
