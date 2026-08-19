const CACHE = "qb-supervisores-v245";
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
  "/app.js",
  "/icons.js",
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
