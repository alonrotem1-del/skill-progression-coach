/*
 * Skill Progression Coach — dedicated service worker.
 *
 * Scope is limited to this project site (/skill-progression-coach/) by its own location,
 * so it NEVER controls the Pull-Up Coach app on the same host. It caches
 * only this app's own files under a private, versioned namespace and, on
 * activation, deletes only obsolete Skill-Coach caches — never the original
 * app's caches. It also never intercepts requests outside its scope.
 */
const CACHE = 'skill-progression-coach-v1';
const SCOPE = new URL(self.registration.scope).pathname; // e.g. /skill-progression-coach/
const ASSETS = [
  './', './index.html',
  './app.js', './data.js', './engine.js', './progress.js', './store.js',
  './duration.js', './adapt.js', './settings.js',
  './manifest.webmanifest',
  './icon.svg', './icon-192.png', './icon-512.png', './icon-512-maskable.png', './apple-touch-icon.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      // Only ever remove OUR OWN obsolete caches. Original Pull-Up Coach caches
      // (e.g. pullup-coach-v4) are left completely untouched.
      keys.filter(k => k.indexOf('skill-progression-coach-') === 0 && k !== CACHE).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  // Never touch anything outside this app's own scope — the original app is safe.
  if (url.origin !== self.location.origin || url.pathname.indexOf(SCOPE) !== 0) return;

  if (req.mode === 'navigate') {
    // Network-first for the app shell so updates are picked up; cached shell
    // keeps the app openable offline.
    event.respondWith(
      fetch(req).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', clone));
        return res;
      }).catch(() => caches.match('./index.html', { ignoreSearch: true }).then(r => r || caches.match('./')))
    );
  } else {
    // Cache-first for versioned static assets (ignoreSearch so ?v= cache-busting
    // still resolves to the cached file).
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(cached => cached || fetch(req).then(res => {
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return res;
      }))
    );
  }
});
