/* Student Study offline shell.
   Place this file in the same GitHub Pages folder as the Student Study HTML page.
   Open the page once while online; after that it opens with no Wi-Fi.
   Bump CACHE_VERSION whenever you want to force every device to drop old copies. */
const CACHE_VERSION = 'student-study-v1';

// Third-party files the page needs to start: fonts and the Microsoft sign-in library
const CACHEABLE_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'alcdn.msauth.net'
];

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch Gemini or Graph POST/PATCH calls
  const url = new URL(req.url);

  // The page itself: network first so updates arrive, cached copy when offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(url.origin + url.pathname, fresh.clone());
        return fresh;
      } catch (e) {
        const cached = await cache.match(url.origin + url.pathname);
        return cached || new Response('<h1>Offline</h1><p>Open Student Study once while online so it can work offline.</p>',
          { headers: { 'Content-Type': 'text/html' } });
      }
    })());
    return;
  }

  // Same-folder files (this script, icons) and the startup libraries: cached copy first, refresh in background
  const sameOrigin = url.origin === self.location.origin;
  if (sameOrigin || CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = await cache.match(req);
      const network = fetch(req).then(res => {
        if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
  // Everything else (Gemini, Graph, sign-in pages) goes straight to the network
});
