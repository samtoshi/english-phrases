// オフラインでも使えるようにするサービスワーカー（アプリ本体のファイルを変えたら VERSION を上げる）
const VERSION = 'v1';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/srs.js', 'js/store.js', 'js/data.js', 'js/match.js', 'js/session.js', 'js/voice.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('shell-' + VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => !k.endsWith('-' + VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // ネット優先・だめならキャッシュ（フレーズや記録は端末の中なので、ここでは扱わない）
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open('shell-' + VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
