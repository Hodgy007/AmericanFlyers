// American Flyers service worker: makes the app installable and quick to
// open. Pages come from the network when it's there (so updates show up),
// falling back to the last copy; the build's hashed files, 3D models and
// textures are cached after first use. Sign-in and the database are never
// cached.

// The build (vite.config.ts) replaces this with the deploy's version, so each
// deploy gets a fresh cache; in dev the placeholder is left alone.
const VERSION = '__AF_VERSION__';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Neon, fonts: straight to the network
  if (url.pathname.startsWith('/api/')) return; // sign-in (/api/auth, proxied to Neon) and the AI function: never cached
  if (url.pathname.endsWith('.mp4') || req.headers.has('range')) return; // video streams

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            event.waitUntil(caches.open(VERSION).then((c) => c.put('/', copy)).catch(() => {}));
          }
          return res;
        })
        .catch(() => caches.match('/').then((r) => r ?? Response.error())),
    );
    return;
  }

  // Hashed build files never change: cache first. Models, textures, images and
  // icons: serve the cached copy and refresh it in the background.
  const immutable = url.pathname.startsWith('/assets/');
  event.respondWith(
    caches.open(VERSION).catch(() => null).then(async (cache) => {
      if (!cache) return fetch(req);
      const hit = await cache.match(req).catch(() => undefined);
      if (hit && immutable) return hit;
      const refresh = fetch(req).then(async (res) => {
        if (res.ok) {
          try { await cache.put(req, res.clone()); } catch { /* caching is best effort */ }
        }
        return res;
      });
      if (hit) {
        event.waitUntil(refresh.catch(() => {}));
        return hit;
      }
      return refresh;
    }),
  );
});
