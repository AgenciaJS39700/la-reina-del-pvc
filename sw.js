// /sw.js — Service worker de La Reina del PVC.
// Estrategia:
//   · Páginas, JS, CSS y data.js → red primero (precios siempre frescos), caché si no hay conexión.
//   · Imágenes e iconos           → caché primero (son inmutables), con límite de entradas.
//   · /api/* y /vid/*              → nunca se interceptan (chat en vivo y vídeo con rangos).
const VERSION = "v1";
const SHELL = "rpvc-shell-" + VERSION;
const IMAGES = "rpvc-img-" + VERSION;
const MAX_IMAGES = 150;
const NET_TIMEOUT = 4000;
const OFFLINE_URL = "/offline"; // Cloudflare sirve offline.html en /offline (sin redirección)

const PRECACHE = [
  "/", OFFLINE_URL, "/styles.css", "/app.js", "/data.js", "/manifest.webmanifest",
  "/img/logo.webp", "/icons/icon-192.png", "/favicon-32.png",
  // Opcionales: si aún no existen en este despliegue, se ignoran.
  "/chat.css", "/chat.js", "/pwa.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // Uno a uno: un fichero que falte no rompe la instalación.
    await Promise.all(PRECACHE.map((url) =>
      fetch(url, { cache: "reload" }).then(async (res) => (res.ok ? cache.put(url, await unredirect(res)) : null)).catch(() => null)
    ));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, IMAGES]);
    for (const key of await caches.keys()) if (key.startsWith("rpvc-") && !keep.has(key)) await caches.delete(key);
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
    await self.clients.claim();
  })());
});

/**
 * Una respuesta que llegó tras una redirección no se puede usar para servir una
 * navegación (el navegador la rechaza). Se copia en una respuesta "limpia".
 */
async function unredirect(res) {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Red primero con tiempo límite; si falla, lo último guardado. */
async function networkFirst(request, preload) {
  const cache = await caches.open(SHELL);
  const isNav = request.mode === "navigate";
  // Las páginas se guardan sin query (?utm_source=pwa…) para no duplicarlas.
  const key = isNav ? new URL(request.url).pathname : request;
  try {
    const res = await Promise.race([
      preload ? preload.then((r) => r || fetch(request)) : fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), NET_TIMEOUT)),
    ]);
    if (res && res.ok && res.type === "basic") cache.put(key, await unredirect(res.clone()));
    return res;
  } catch (err) {
    const hit = (await cache.match(key)) ||
      // Los enlaces a «/legal/x.html» redirigen a «/legal/x»: probar también esa ruta.
      (isNav && key.endsWith(".html") ? await cache.match(key.slice(0, -5)) : undefined);
    if (hit) return hit;
    if (isNav) {
      const offline = await cache.match(OFFLINE_URL);
      if (offline) return offline;
    }
    throw err;
  }
}

/** Caché primero para imágenes; las nuevas se guardan y se recorta el exceso. */
async function cacheFirst(request) {
  const cache = await caches.open(IMAGES);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok && res.type === "basic") {
    await cache.put(request, res.clone());
    const keys = await cache.keys();
    if (keys.length > MAX_IMAGES) await Promise.all(keys.slice(0, keys.length - MAX_IMAGES).map((k) => cache.delete(k)));
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/vid/") || url.pathname === "/sw.js") return;

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req, event.preloadResponse));
  } else if (/\.(webp|png|jpe?g|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(req));
  } else if (/\.(js|css|webmanifest|html)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(req));
  }
});
