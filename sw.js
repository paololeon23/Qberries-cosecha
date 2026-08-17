const CACHE = "qb-supervisores-v181";
const ASSETS = [
  "/",
  "/index.html",
  "/inicio/",
  "/inicio/index.html",
  "/vinculo/",
  "/vinculo/index.html",
  "/registro/",
  "/registro/index.html",
  "/styles.css",
  "/app.js",
  "/icons.js",
  "/manifest.json",
  "/assets/logo-qberries.png",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/data/supervisores-cosecha.json",
  "/data/lotes-licapa.json",
  "/data/grupos-licapa.json",
  "/data/trabajadores.json",
  "/data/personas.json",
  "/vendor/jsQR.min.js",
  "/vendor/xlsx.full.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null)));
      await self.skipWaiting();
    })
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

function isApi(url) {
  return (
    url.pathname.includes("/.netlify/functions/") ||
    url.pathname.includes("/api/") ||
    url.hostname.includes("script.google.com") ||
    url.hostname.includes("googleusercontent.com")
  );
}

function isAppShell(url) {
  const p = url.pathname;
  return (
    p.endsWith("/") ||
    p.endsWith("/index.html") ||
    p.endsWith("/app.js") ||
    p.endsWith("/styles.css") ||
    p.endsWith("/icons.js") ||
    p.endsWith("/sw.js")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (isApi(url)) {
    event.respondWith(
      fetch(req).catch(
        () =>
          new Response(JSON.stringify({ ok: false, error: "Sin conexión" }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    return;
  }

  // HTML / JS / CSS: se responde al instante desde caché y se actualiza detrás.
  // Así cambiar de pestaña no espera a la red (se sentía como una recarga).
  if (req.mode === "navigate" || isAppShell(url)) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((cached) => {
        const network = fetch(req)
          .then((res) => {
            if (res && res.ok && url.origin === self.location.origin) {
              const copy = res.clone();
              caches.open(CACHE).then((cache) => cache.put(req, copy));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Resto: caché primero (offline)
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const fetching = fetch(req)
        .then((res) => {
          if (res && res.ok && url.origin === self.location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || fetching;
    })
  );
});
