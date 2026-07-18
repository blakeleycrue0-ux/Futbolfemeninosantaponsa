/*
  install-banner.js
  ============================================================================
  Aviso para instalar la web como app — a propósito muy visible, en el
  centro de la pantalla con fondo oscuro detrás, para que la mayoría de
  gente lo instale (no es un simple avisito de esquina). Explica el motivo
  principal: sin la app instalada, en iPhone NO pueden llegar notificaciones
  push (ver push-notifications.js) — así que instalarla es lo que hace que
  de verdad se enteren de partidos y noticias en el momento.

  En Chrome/Android usa el evento beforeinstallprompt para instalar con un
  botón directo; en el resto de navegadores (Safari/iOS sobre todo, que no
  tiene ese evento) muestra los pasos a mano.

  Se recuerda el cierre en localStorage — pero solo 3 días (no 14), para
  que a quien lo cierra sin instalar se le vuelva a ofrecer pronto en vez
  de desaparecer casi para siempre.

  Por defecto se muestra sola a los 3s de cargar la página. Si otra página
  quiere controlar el momento exacto (p.ej. index.html, para que salga justo
  después del popup de "destacado"), debe poner
  window.SPFC_INSTALL_BANNER_MANUAL = true antes de cargar este script y
  llamar ella misma a window.SPFC_SHOW_INSTALL_BANNER() cuando le convenga.
  ============================================================================
*/
(function () {
  const yaInstalada = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const TRES_DIAS_MS = 3 * 24 * 60 * 60 * 1000;
  const dismissedAt = Number(localStorage.getItem("spfc_install_dismissed_at"));
  const dismissedRecently = dismissedAt && (Date.now() - dismissedAt) < TRES_DIAS_MS;
  if (yaInstalada || dismissedRecently) return;

  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;

  function buildBanner() {
    const style = document.createElement("style");
    style.textContent = `
      #spfcInstallModal {
        position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center;
        padding: 20px; opacity: 0; transition: opacity 0.35s ease;
      }
      #spfcInstallModal.show { opacity: 1; }
      #spfcInstallModal .spfc-im-backdrop { position: absolute; inset: 0; background: rgba(10,10,10,0.78); }
      #spfcInstallModal .spfc-im-card {
        position: relative; background: #0a0a0a; color: #fff; border-radius: 16px; padding: 2rem 1.8rem 1.8rem;
        max-width: 380px; width: 100%; text-align: center; font-family: 'Familjen Grotesk', sans-serif;
        box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        transform: translateY(16px) scale(0.97); transition: transform 0.35s cubic-bezier(.16,1,.3,1);
      }
      #spfcInstallModal.show .spfc-im-card { transform: translateY(0) scale(1); }
      #spfcInstallModal img.spfc-im-crest { width: 56px; height: 56px; object-fit: contain; margin-bottom: 0.8rem; }
      #spfcInstallModal h3 { margin: 0 0 0.3rem; font-size: 1.25rem; font-weight: 800; }
      #spfcInstallModal .spfc-im-sub { font-size: 0.86rem; color: rgba(255,255,255,0.6); margin: 0 0 1.3rem; }
      #spfcInstallModal ul.spfc-im-pros { list-style: none; margin: 0 0 1.1rem; padding: 0; text-align: left; }
      #spfcInstallModal ul.spfc-im-pros li { display: flex; gap: 0.6em; align-items: flex-start; font-size: 0.87rem; line-height: 1.4; margin-bottom: 0.65em; color: rgba(255,255,255,0.9); }
      #spfcInstallModal ul.spfc-im-pros li .spfc-im-icon { flex-shrink: 0; }
      #spfcInstallModal .spfc-im-warn {
        font-size: 0.8rem; line-height: 1.45; color: #fca5a5; background: rgba(220,38,38,0.12);
        border-radius: 9px; padding: 0.7rem 0.9rem; margin: 0 0 1.4rem;
      }
      #spfcInstallModal button.spfc-im-install {
        width: 100%; border: none; cursor: pointer; background: #a855f7; color: #fff; font-weight: 800;
        font-size: 0.95rem; padding: 0.85rem; border-radius: 9px; margin-bottom: 0.7rem;
      }
      #spfcInstallModal button.spfc-im-close {
        width: 100%; border: none; cursor: pointer; background: transparent; color: rgba(255,255,255,0.45);
        font-size: 0.82rem; padding: 0.4rem;
      }
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

    const modal = document.createElement("div");
    modal.id = "spfcInstallModal";
    modal.innerHTML = `
      <div class="spfc-im-backdrop"></div>
      <div class="spfc-im-card">
        <img class="spfc-im-crest" src="/assets/img/escudo-santa-ponsa.png" alt="">
        <h3>Instala la app del club</h3>
        <p class="spfc-im-sub">Fútbol Femenino Santa Ponça — 10 segundos, sin ocupar apenas espacio.</p>
        <ul class="spfc-im-pros">
          <li><span class="spfc-im-icon">🔔</span><span>Notificaciones en directo de partidos y noticias, al momento.</span></li>
          <li><span class="spfc-im-icon">⚡</span><span>Acceso directo desde tu pantalla de inicio, sin buscarla cada vez.</span></li>
          <li><span class="spfc-im-icon">📶</span><span>Va mejor incluso con poca cobertura en el campo.</span></li>
        </ul>
        <p class="spfc-im-warn">${isIOS
          ? "En iPhone, si no la instalas, Apple no permite recibir notificaciones — te perderás los avisos en directo."
          : "Si no la instalas, te puedes perder los avisos en directo de partidos y noticias."}</p>
        <button type="button" class="spfc-im-install">Instalar ahora</button>
        <button type="button" class="spfc-im-close">Ahora no</button>
      </div>
    `;
    document.body.appendChild(modal);

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

    requestAnimationFrame(() => modal.classList.add("show"));

    function dismiss() {
      modal.classList.remove("show");
      localStorage.setItem("spfc_install_dismissed_at", String(Date.now()));
      setTimeout(() => modal.remove(), 350);
    }
    modal.querySelector(".spfc-im-close").addEventListener("click", dismiss);

    modal.querySelector(".spfc-im-install").addEventListener("click", async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        dismiss();
      } else {
        const stepsList = document.getElementById("spfcInstallStepsList");
        stepsList.innerHTML = isIOS
          ? "<li>Toca el botón de compartir (el cuadrado con la flecha hacia arriba) en Safari.</li><li>Baja y elige «Añadir a pantalla de inicio».</li><li>Confirma arriba a la derecha con «Añadir».</li><li>Abre la app desde el icono nuevo (no desde Safari) para poder activar las notificaciones.</li>"
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
    if (document.getElementById("spfcInstallModal") || dismissedRecently) return;
    buildBanner();
  };

  if (!window.SPFC_INSTALL_BANNER_MANUAL) {
    setTimeout(() => window.SPFC_SHOW_INSTALL_BANNER(), 3000);
  }
})();
