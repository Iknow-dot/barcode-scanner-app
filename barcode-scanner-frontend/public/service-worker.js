// Minimal service worker — exists primarily to satisfy the PWA install
// criterion and to provide an offline fallback for the app shell. Cache
// strategy is network-first for static assets so we never serve stale
// JS/CSS once the user is back online.

const CACHE = 'iflow-cache-v1';
const APP_SHELL = ['/', '/index.html', '/manifest.json'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL).catch(() => {}))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    // Skip API calls, cross-origin requests, and non-http(s) schemes.
    if (url.origin !== self.location.origin) return;
    if (url.pathname.startsWith('/api/')) return;

    event.respondWith(
        fetch(req)
            .then((response) => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE).then((cache) => cache.put(req, clone)).catch(() => {});
                }
                return response;
            })
            .catch(() =>
                caches.match(req).then((cached) => cached || caches.match('/index.html'))
            )
    );
});
