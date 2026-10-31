// American Flyers service worker: makes the app installable and quick to
// open. Pages come from the network when it's there (so updates show up),
// falling back to the last copy; the build's hashed files, 3D models and
// textures are cached after first use. Sign-in and the database are never
// cached.

const VERSION = 'af-v1';
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
  if (url.pathname.endsWith('.mp4') || req.headers.has('range')) return; // video streams

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) caches.open(VERSION).then((c) => c.put('/', copy));
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
    caches.open(VERSION).then(async (cache) => {
      const hit = await cache.match(req);
      const refresh = fetch(req).then((res) => {
        if (res.ok) cache.put(req, res.clone());
        return res;
      });
      if (hit) {
        if (!immutable) refresh.catch(() => {});
        return hit;
      }
      return refresh;
    }),
  );
});
