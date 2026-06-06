// オフライン対応 Service Worker（オンライン時は常に最新版を優先）
const CACHE = "eitango-v13";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./words.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

const APP_FILES = /\.(html|js|css|webmanifest)$|\/$/;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS).catch(() => {})));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// アプリ本体: ネット優先（no-store）。オフライン時のみキャッシュ。
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const path = new URL(e.request.url).pathname;
  const isAppFile = APP_FILES.test(path);

  e.respondWith(
    fetch(e.request, isAppFile ? { cache: "no-store" } : undefined)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
