// 네트워크 우선, 실패 시 캐시 (앱 껍데기만). Supabase API 요청은 건드리지 않음.
const CACHE = 'sd-v2';
const SHELL = ['./', 'index.html', 'style.css', 'config.js', 'dist/app.js', 'dist/pdf.worker.min.mjs', 'manifest.webmanifest', 'icon-192.png'];

self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {}))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' }).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request))
  );
});
