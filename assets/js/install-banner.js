/*
  install-banner.js
  ============================================================================
  Aviso flotante para instalar la web como app. En Chrome/Android usa el
  evento beforeinstallprompt para instalar con un botón directo; en el resto
  de navegadores (Safari/iOS sobre todo, que no tiene ese evento) muestra los
  pasos a mano. Se recuerda el cierre en localStorage — no vuelve a salir.

  Por defecto se muestra sola a los 12s de cargar la página. Si otra página
  quiere controlar el momento exacto (p.ej. index.html, para que salga justo
  después del popup de "destacado"), debe poner
  window.SPFC_INSTALL_BANNER_MANUAL = true antes de cargar este script y
  llamar ella misma a window.SPFC_SHOW_INSTALL_BANNER() cuando le convenga.
  ============================================================================
*/
(function () {
  const yaInstalada = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  if (yaInstalada || localStorage.getItem("spfc_install_dismissed")) return;

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  function buildBanner() {
    const style = document.createElement("style");
    style.textContent = `
      #spfcInstallBanner {
        position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 3000;
        background: #0a0a0a; color: #fff; border-radius: 12px; padding: 14px 14px 14px 16px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 12px;
        transform: translateY(140%); transition: transform 0.4s cubic-bezier(.16,1,.3,1);
        font-family: 'Familjen Grotesk', sans-serif; max-width: 420px; margin: 0 auto;
      }
      #spfcInstallBanner.show { transform: translateY(0); }
      #spfcInstallBanner img { width: 40px; height: 40px; border-radius: 9px; flex-shrink: 0; }
      #spfcInstallBanner .spfc-ib-text { flex: 1; font-size: 12.5px; line-height: 1.4; color: rgba(255,255,255,0.7); }
      #spfcInstallBanner .spfc-ib-text strong { display: block; font-size: 13.5px; margin-bottom: 2px; color: #fff; }
      #spfcInstallBanner button { border: none; cursor: pointer; font-weight: 700; border-radius: 7px; flex-shrink: 0; }
      #spfcInstallBanner .spfc-ib-install { background: #a855f7; color: #fff; font-size: 12px; padding: 9px 14px; }
      #spfcInstallBanner .spfc-ib-close { background: transparent; color: rgba(255,255,255,0.45); font-size: 17px; padding: 4px 6px; line-height: 1; }
      #spfcInstallSteps { position: fixed; inset: 0; z-index: 3001; display: none; align-items: center; justify-content: center; padding: 20px; }
      #spfcInstallSteps .spfc-is-backdrop { position: absolute; inset: 0; background: rgba(10,10,10,0.72); }
      #spfcInstallSteps .spfc-is-card {
        position: relative; background: #fff; color: #0a0a0a; border-radius: 14px; padding: 1.7rem 1.6rem;
        max-width: 360px; width: 100%; font-family: 'Familjen Grotesk', sans-serif;
      }
      #spfcInstallSteps h3 { margin: 0 0 0.9rem; font-size: 1.05rem; font-weight: 800; }
      #spfcInstallSteps ol { margin: 0; padding-left: 1.2rem; font-size: 0.88rem; line-height: 1.9; }
      #spfcInstallSteps button.spfc-is-close {
        position: absolute; top: 10px; right: 10px; border: none; background: rgba(10,10,10,0.08);
        width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 15px;
      }
    `;
    document.head.appendChild(style);

    const banner = document.createElement("div");
    banner.id = "spfcInstallBanner";
    banner.innerHTML = `
      <img src="/assets/img/icons/icon-192.png" alt="">
      <div class="spfc-ib-text"><strong>Instala la app del club</strong>Acceso directo desde tu móvil, sin buscarla cada vez.</div>
      <button type="button" class="spfc-ib-install">Instalar</button>
      <button type="button" class="spfc-ib-close" aria-label="Cerrar">✕</button>
    `;
    document.body.appendChild(banner);

    const stepsWrap = document.createElement("div");
    stepsWrap.id = "spfcInstallSteps";
    stepsWrap.innerHTML = `
      <div class="spfc-is-backdrop"></div>
      <div class="spfc-is-card">
        <button type="button" class="spfc-is-close" aria-label="Cerrar">✕</button>
        <h3>Cómo instalar la app</h3>
        <ol id="spfcInstallStepsList"></ol>
      </div>
    `;
    document.body.appendChild(stepsWrap);

    requestAnimationFrame(() => banner.classList.add("show"));

    function dismiss() {
      banner.classList.remove("show");
      localStorage.setItem("spfc_install_dismissed", "1");
      setTimeout(() => banner.remove(), 400);
    }
    banner.querySelector(".spfc-ib-close").addEventListener("click", dismiss);

    banner.querySelector(".spfc-ib-install").addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        dismiss();
      } else {
        const stepsList = document.getElementById("spfcInstallStepsList");
        stepsList.innerHTML = isIOS
          ? "<li>Toca el botón de compartir (el cuadrado con la flecha hacia arriba) en Safari.</li><li>Baja y elige «Añadir a pantalla de inicio».</li><li>Confirma arriba a la derecha con «Añadir».</li>"
          : "<li>Abre el menú del navegador (⋮ arriba a la derecha).</li><li>Elige «Instalar app» o «Añadir a pantalla de inicio».</li><li>Confirma y listo.</li>";
        stepsWrap.style.display = "flex";
      }
    });

    stepsWrap.querySelector(".spfc-is-close").addEventListener("click", () => {
      stepsWrap.style.display = "none";
      dismiss();
    });
    stepsWrap.querySelector(".spfc-is-backdrop").addEventListener("click", () => {
      stepsWrap.style.display = "none";
    });
  }

  window.SPFC_SHOW_INSTALL_BANNER = function () {
    if (document.getElementById("spfcInstallBanner") || localStorage.getItem("spfc_install_dismissed")) return;
    buildBanner();
  };

  if (!window.SPFC_INSTALL_BANNER_MANUAL) {
    setTimeout(() => window.SPFC_SHOW_INSTALL_BANNER(), 12000);
  }
})();
