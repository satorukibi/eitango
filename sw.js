// オフライン対応 Service Worker（オンライン時は常に最新版を優先）
const CACHE = "eitango-v53";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./words.js",
  "./words_extra.js",
  "./words_extra2.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./header-logo.svg",
  "./header-cat.png"
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

self.addEventListener("message", (e) => {
  if (e.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;

  // ホーム画面起動（ページ遷移）はオンライン時ネットのみ → 古いHTMLを返さない
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request, { cache: "no-store" }).catch(() => caches.match(e.request))
    );
    return;
  }

  const path = new URL(e.request.url).pathname;
  const isAppFile = APP_FILES.test(path);

  e.respondWith(
    fetch(e.request, isAppFile ? { cache: "no-store" } : undefined)
      .then((res) => {
        if (res.ok && isAppFile) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
