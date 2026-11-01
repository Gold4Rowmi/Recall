// Web app only, Tauri ships these files. Network first so a deploy lands on the next load; the cache covers no signal.
// Only this site's own GET requests pass through here: Supabase is cross-origin and auth never touches the cache.
const VERSION = 'dev', FILES = []; // pages.yml stamps both on deploy
const CACHE = 'recall-' + VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache:'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  // other project pages share this origin's cache storage, so only touch our own
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('recall-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request, scope = self.registration.scope, url = new URL(req.url);
  if (req.method !== 'GET' || !req.url.startsWith(scope) || url.pathname.endsWith('/sw.js')) return;
  const key = req.mode === 'navigate' ? new URL('index.html', scope).href : url.origin + url.pathname; // ?demo and / both open index.html
  const net = caches.open(CACHE).then(async c => { const r = await fetch(req); if (r.ok) await c.put(key, r.clone()); return r; });
  e.waitUntil(net.catch(() => {}));
  e.respondWith((async () => {
    const first = await Promise.race([net.catch(() => null), new Promise(r => setTimeout(r, 3000))]); // weak signal shouldn't hold the app up
    return first || await caches.match(key, { cacheName:CACHE }) || net;
  })());
});
