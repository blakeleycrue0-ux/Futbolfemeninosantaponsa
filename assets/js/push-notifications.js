/*
  push-notifications.js
  ============================================================================
  Aviso flotante para activar notificaciones push (avisos de partidos y
  noticias nuevas, enviados a mano desde el admin — ver send-push.js).
  Se recuerda el cierre en localStorage, igual que install-banner.js — no
  vuelve a salir si ya se ha activado o si se ha cerrado hace poco.

  iOS solo permite notificaciones push si la web está instalada en la
  pantalla de inicio (no funciona en Safari normal) — si no está
  instalada, no se muestra nada en vez de ofrecer un botón que fallaría.

  Se muestra sola a los 20s de cargar la página (más tarde que el aviso
  de instalar la app, para no competir con él en pantalla a la vez).
  ============================================================================
*/
(function () {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
  if (!window.SPFC_CONFIG || !window.SPFC_CONFIG.VAPID_PUBLIC_KEY) return;
  if (Notification.permission === "denied") return;

  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  if (isIOS && !isStandalone) return;

  const CATORCE_DIAS_MS = 14 * 24 * 60 * 60 * 1000;
  const dismissedAt = Number(localStorage.getItem("spfc_push_dismissed_at"));
  const dismissedRecently = dismissedAt && (Date.now() - dismissedAt) < CATORCE_DIAS_MS;
  const yaSuscrito = localStorage.getItem("spfc_push_subscribed") === "1";
  if (dismissedRecently || yaSuscrito || Notification.permission === "granted") return;

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  function buildBanner() {
    const style = document.createElement("style");
    style.textContent = `
      #spfcPushBanner {
        position: fixed; left: 12px; right: 12px; bottom: 12px; z-index: 3000;
        background: #0a0a0a; color: #fff; border-radius: 12px; padding: 14px 14px 14px 16px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.4); display: flex; align-items: center; gap: 12px;
        transform: translateY(140%); transition: transform 0.4s cubic-bezier(.16,1,.3,1);
        font-family: 'Familjen Grotesk', sans-serif; max-width: 420px; margin: 0 auto;
      }
      #spfcPushBanner.show { transform: translateY(0); }
      #spfcPushBanner .spfc-pb-text { flex: 1; font-size: 12.5px; line-height: 1.4; color: rgba(255,255,255,0.7); }
      #spfcPushBanner .spfc-pb-text strong { display: block; font-size: 13.5px; margin-bottom: 2px; color: #fff; }
      #spfcPushBanner button { border: none; cursor: pointer; font-weight: 700; border-radius: 7px; flex-shrink: 0; }
      #spfcPushBanner .spfc-pb-activar { background: #a855f7; color: #fff; font-size: 12px; padding: 9px 14px; }
      #spfcPushBanner .spfc-pb-close { background: transparent; color: rgba(255,255,255,0.45); font-size: 17px; padding: 4px 6px; line-height: 1; }
    `;
    document.head.appendChild(style);

    const banner = document.createElement("div");
    banner.id = "spfcPushBanner";
    banner.innerHTML = `
      <div class="spfc-pb-text"><strong>Activa las notificaciones</strong>Entérate al momento de partidos y noticias del club.</div>
      <button type="button" class="spfc-pb-activar">Activar</button>
      <button type="button" class="spfc-pb-close" aria-label="Cerrar">✕</button>
    `;
    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add("show"));

    function dismiss() {
      banner.classList.remove("show");
      localStorage.setItem("spfc_push_dismissed_at", String(Date.now()));
      setTimeout(() => banner.remove(), 400);
    }
    banner.querySelector(".spfc-pb-close").addEventListener("click", dismiss);

    banner.querySelector(".spfc-pb-activar").addEventListener("click", async () => {
      const btn = banner.querySelector(".spfc-pb-activar");
      btn.disabled = true;
      btn.textContent = "Activando…";
      try {
        const permiso = await Notification.requestPermission();
        if (permiso !== "granted") {
          dismiss();
          return;
        }
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(window.SPFC_CONFIG.VAPID_PUBLIC_KEY),
        });
        await fetch("/.netlify/functions/save-push-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(subscription.toJSON()),
        });
        localStorage.setItem("spfc_push_subscribed", "1");
        dismiss();
      } catch (err) {
        dismiss();
      }
    });
  }

  setTimeout(() => {
    if (document.getElementById("spfcPushBanner")) return;
    buildBanner();
  }, 20000);
})();
