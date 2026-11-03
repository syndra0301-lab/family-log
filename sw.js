// 오프라인(비행기 모드)에서도 앱이 열리도록 앱 파일을 기기에 저장해 둔다.
// 인터넷이 되면 항상 새 파일을 먼저 받아서(network-first) 앱을 고쳐도 새로고침만 하면 바뀐다.
// 일정·기록 데이터는 Firestore가 기기에 따로 저장하고, 오프라인에서 고친 내용은 연결되면 자동으로 올린다.
const CACHE = 'family-log-v1';
const CORE = ['./', './index.html', './shim.js', './config.js', './manifest.webmanifest',
  './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const FIREBASE = ['https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE);
    for (const u of FIREBASE) { try { const r = await fetch(u, { mode: 'cors' }); if (r.ok) await c.put(u, r); } catch (err) {} }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

function cacheable(url) {
  if (url.origin === self.location.origin) return true;
  if (url.host === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) return true;
  if (url.host === 'fonts.googleapis.com' || url.host === 'fonts.gstatic.com') return true;
  return false; // Firestore API 등은 건드리지 않는다
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!cacheable(url)) return;
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    try {
      const r = await fetch(req);
      if (r && (r.ok || r.type === 'opaque')) c.put(req, r.clone()).catch(() => {});
      return r;
    } catch (err) {
      const hit = await c.match(req, { ignoreSearch: req.mode === 'navigate' || url.origin === self.location.origin });
      if (hit) return hit;
      if (req.mode === 'navigate') { const idx = await c.match('./index.html'); if (idx) return idx; }
      throw err;
    }
  })());
});
