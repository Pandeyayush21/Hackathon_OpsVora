// Offline support: serve the game shell from cache, refresh it in the background.
const CACHE = 'arrow-escape-v2';
const SHELL = ['./', './index.html', './engine.js', './manifest.webmanifest', './icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(CACHE).then(async cache => {
    const hit = await cache.match(e.request);
    const net = fetch(e.request).then(res => { if (res.ok) cache.put(e.request, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
});
