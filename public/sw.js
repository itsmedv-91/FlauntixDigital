/*
 * Flauntix HQ service worker.
 *
 * Scope, deliberately narrow — a service worker that caches too eagerly is far
 * worse than none at all, because it serves stale pages that look live:
 *
 *   - Navigations are NETWORK FIRST. The offline page is only ever shown when
 *     the network actually fails. Agency data must never come from a cache.
 *   - Only immutable build output (/_next/static/*) and the icons are cached,
 *     and those are cache first because their URLs change on every deploy.
 *   - Anything that is not a GET is passed straight through. A Server Action is
 *     a POST; caching one would be a data-loss bug.
 *   - Supabase requests are never touched: they carry auth and must not be
 *     answered from a cache shared between accounts on one device.
 *
 * Bump CACHE on any change here; the activate handler deletes every other one.
 */
const CACHE = 'flauntix-v1';
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll([OFFLINE_URL, '/icon-192.png'])).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isImmutable(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/apple-touch-icon.png' ||
    /^\/icon-[\w-]+\.png$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Only this origin. Supabase, fonts and anything else go straight to the
  // network: they carry credentials or are already cached by the browser.
  if (url.origin !== self.location.origin) return;

  if (isImmutable(url)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            // Only a clean 200 is worth keeping; an opaque or error response
            // cached here would stick until the next deploy.
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((hit) => hit || Response.error())),
    );
  }
});
