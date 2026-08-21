const CACHE = "qb-supervisores-v379";
const ASSETS = [
  "/",
  "/index.html",
  "/inicio/",
  "/inicio/index.html",
  "/vinculo/",
  "/vinculo/index.html",
  "/registro/",
  "/registro/index.html",
  "/instalar/",
  "/instalar/index.html",
  "/styles.css",
  "/api-config.js",
  "/app.js",
  "/icons.js",
  "/native-bridge.js",
  "/manifest.json",
  "/assets/logo-qberries.png",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/apple-touch-icon.png",
  "/data/supervisores-cosecha.json",
  "/data/lotes-licapa.json",
  "/data/grupos-licapa.json",
  "/data/trabajadores.json",
  "/vendor/jsQR.min.js",
  "/vendor/xlsx.full.min.js",
  "/vendor/qrcode.min.js",
  "/vendor/jspdf.umd.min.js",
  "/vendor/sweetalert2.all.min.js",
];

function putInCache(req, res) {
  if (!res || !res.ok) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const copy = res.clone();
  caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
}

async function refreshCachedAssets() {
  const cache = await caches.open(CACHE);
  await Promise.all(
    ASSETS.map((url) =>
      fetch(url, { cache: "reload" })
        .then((res) => {
          if (res && res.ok) return cache.put(url, res);
        })
        .catch(() => null)
    )
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      const required = [
        "/",
        "/index.html",
        "/registro/index.html",
        "/vinculo/index.html",
        "/styles.css",
        "/api-config.js",
        "/app.js",
        "/icons.js",
        "/vendor/sweetalert2.all.min.js",
        "/data/trabajadores.json",
        "/data/supervisores-cosecha.json",
      ];
      const optional = ASSETS.filter((u) => !required.includes(u));
      const requiredResults = await Promise.all(
        required.map((url) =>
          cache.add(url).then(() => true).catch(() => false)
        )
      );
      const okRequired = requiredResults.every(Boolean);
      await Promise.all(optional.map((url) => cache.add(url).catch(() => null)));
      if (!okRequired) {
        // No activar una instalación incompleta (offline rompería la app)
        throw new Error("SW precache incomplete");
      }
      await self.skipWaiting();
    })()
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

self.addEventListener("message", (event) => {
  const type = event.data?.type || event.data;
  if (type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (type === "REFRESH_CACHE") {
    event.waitUntil(refreshCachedAssets());
  }
});

function isApi(url) {
  return (
    url.pathname.includes("/.netlify/functions/") ||
    url.pathname.includes("/api/") ||
    url.hostname.includes("script.google.com") ||
    url.hostname.includes("googleusercontent.com")
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

  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          putInCache(req, res);
          return res;
        })
        .catch(() => cached);
      /* Caché al instante (sin pestañeo). Lo descargado se guarda. */
      return cached || network;
    })
  );
});
