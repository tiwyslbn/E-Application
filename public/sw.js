// Service worker Medan Smart Tourism
// - Aset statis: precache + stale-while-revalidate (cepat, tetap segar)
// - Halaman: network-first. Hanya /tiket dan /tiket/KODE yang disalin untuk dibuka offline.
// - Tidak pernah menyimpan API, admin, login, atau permintaan POST.
const V = 'v4';
const STATIC = 'mst-static-' + V;
const PAGES = 'mst-pages-v3'; // harus sama dengan PAGES_CACHE di main.js
const SHELL = [
  '/offline.html', '/css/style.css', '/js/main.js', '/manifest.json',
  '/vendor/bootstrap/css/bootstrap.min.css', '/vendor/bootstrap/js/bootstrap.bundle.min.js', '/vendor/icons/bootstrap-icons.css',
  '/fonts/plus-jakarta-sans-latin-wght-normal.woff2', '/fonts/young-serif-latin-400-normal.woff2',
  '/img/icon.svg', '/img/icon-192.png', '/img/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => ![STATIC, PAGES].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const isStatic = (p) => /\.(css|js|png|jpg|jpeg|svg|woff2?|ico)$/.test(p) || p === '/manifest.json';
const isTicketPage = (p) => /^\/tiket(\/[A-Za-z0-9-]+)?$/.test(p);

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname === '/sw.js' || url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok && isTicketPage(url.pathname)) { const c = await caches.open(PAGES); c.put(req, res.clone()); }
        return res;
      } catch (err) {
        if (isTicketPage(url.pathname)) { const hit = await caches.match(req, { cacheName: PAGES }); if (hit) return hit; }
        return (await caches.match('/offline.html')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  if (isStatic(url.pathname) || url.pathname.startsWith('/vendor/') || url.pathname.startsWith('/fonts/')) {
    e.respondWith(caches.open(STATIC).then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    }));
  }
});
