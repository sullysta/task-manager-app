/* ============================================================
   Sully's Task Manager — sw.js
   Service Worker: caches app shell, passes GitHub API to network
   ============================================================ */

const CACHE_NAME = 'sullys-task-manager-v1';

// Files to pre-cache (the app shell)
const APP_SHELL = [
  '/task-manager-app/',
  '/task-manager-app/index.html',
  '/task-manager-app/styles.css',
  '/task-manager-app/app.js',
  '/task-manager-app/manifest.json',
  '/task-manager-app/icons/icon-192.png',
  '/task-manager-app/icons/icon-512.png',
];

// ── Install: pre-cache app shell ───────────────────────────────
self.addEventListener('install', event => {
  self.skipWaiting();  // Activate immediately
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
});

// ── Activate: clean up old caches ─────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: routing strategy ────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 1. GitHub API — always go to network (never cache live data)
  if (url.hostname === 'api.github.com') {
    event.respondWith(fetch(event.request));
    return;
  }

  // 2. Non-GET requests — network only
  if (event.request.method !== 'GET') {
    event.respondWith(fetch(event.request));
    return;
  }

  // 3. App shell and other GET requests — cache-first, fallback to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Only cache valid same-origin responses
        if (
          response.ok &&
          response.type === 'basic' &&
          url.origin === self.location.origin
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback: return the cached index page for navigation requests
        if (event.request.mode === 'navigate') {
          return caches.match('/task-manager-app/index.html');
        }
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});
