/*
  sw.js — Service worker mínimo, solo para que el sitio sea instalable como
  app (PWA) y funcione algo mejor con mala cobertura. No cachea nada
  dinámico: las llamadas a /.netlify/functions/* (formularios, pagos,
  admin...) y cualquier petición que no sea GET pasan siempre directas a
  la red, sin pasar por aquí.

  También recibe las notificaciones push (partidos, noticias) — ver
  assets/js/push-notifications.js para la parte de activarlas desde el
  navegador y send-push.js para el envío desde el admin.
  ============================================================================
*/
const CACHE_NAME = "spfc-v1";
const CACHE_URLS = [
  "/assets/css/variables.css",
  "/assets/css/base.css",
  "/assets/css/components.css",
  "/assets/img/escudo-santa-ponsa.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/.netlify/")) return;

  if (req.mode === "navigate") {
    // Páginas: siempre red primero (contenido dinámico), caché solo como
    // red de seguridad si no hay conexión.
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  // Estáticos (CSS/JS/imágenes propias): caché primero, red de refresco detrás.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch (err) {
    datos = { titulo: "Fútbol Femenino Santa Ponça", cuerpo: event.data ? event.data.text() : "" };
  }
  const titulo = datos.titulo || "Fútbol Femenino Santa Ponça";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: datos.cuerpo || "",
      icon: "/assets/img/icons/icon-192.png",
      badge: "/assets/img/icons/icon-192.png",
      data: { url: datos.url || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
