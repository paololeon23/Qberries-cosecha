const CACHE = "qb-supervisores-v35";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./icons.js",
  "./manifest.json",
  "./assets/logo-qberries.png",
  "./data/lotes-licapa.json",
  "./data/grupos-licapa.json",
  "./data/personas.json",
  "./data/trabajadores.json",
  "./data/supervisores-cosecha.json",
  "./vendor/xlsx.full.min.js",
  "./vendor/jspdf.umd.min.js",
  "./vendor/jsQR.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (url.pathname.includes("/.netlify/functions/")) {
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
    caches.match(req).then((cached) => {
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
