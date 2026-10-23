// オフラインでも使えるようにするサービスワーカー（アプリ本体のファイルを変えたら VERSION を上げる）
const VERSION = 'v3';
// 同じサイト（samtoshi.github.io）の anki-app とキャッシュの置き場が共通なので、名前に ep- をつけて、自分のものだけ消す
const P = 'ep-';
const SHELL = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/app.js', 'js/srs.js', 'js/store.js', 'js/data.js', 'js/match.js', 'js/session.js', 'js/voice.js', 'js/merge.js', 'js/cloud.js', 'js/cloudsync.js', 'js/sheets.js', 'js/firebase-config.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(P + 'shell-' + VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith(P) && !k.endsWith('-' + VERSION)).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // Firebase の SDK（バージョンつきURLなので中身は変わらない）は、オフラインでも開けるようにキャッシュ優先
  if (url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) {
    e.respondWith(caches.open(P + 'sdk-' + VERSION).then(async (c) => (await c.match(e.request)) || fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; })));
    return;
  }
  if (url.origin !== location.origin) return;
  // ネット優先・だめならキャッシュ（フレーズや記録は端末の中なので、ここでは扱わない）
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      if (res.ok) caches.open(P + 'shell-' + VERSION).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
