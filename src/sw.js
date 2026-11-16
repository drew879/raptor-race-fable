// Service worker. Goals: the app works offline, and a new build always wins.
// - The page itself is fetched fresh from the network every launch (cache is only an offline fallback).
// - version.json is never cached.
// - Everything else (hashed scripts, models, audio) is cached per build and dropped when a new build lands.
const BUILD = '__BUILD__';
const CACHE = 'raptor-race-b' + BUILD;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.endsWith('version.json')) {
    event.respondWith(fetch(req.url, { cache: 'no-store' }));
    return;
  }

  const isPage =
    req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html');
  if (isPage) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        try {
          const res = await fetch(req.url, { cache: 'no-store' });
          if (res.ok) cache.put('page', res.clone());
          return res;
        } catch {
          return (await cache.match('page')) ?? Response.error();
        }
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req.url, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    })(),
  );
});
