/* Network-first, and genuinely so.
   A plain fetch() inside a worker still goes through the browser's HTTP
   cache, and GitHub Pages sets a max-age — so "network-first" could hand
   back a copy that was minutes old and never reach the server at all.
   Same-origin documents and scripts are refetched with cache:"reload",
   which skips the HTTP cache and revalidates. Cache is only a fallback
   for being offline. */
const CACHE = "cozy-chat-v2";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).catch(() => {}));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // never touch API traffic

  const isApp = req.mode === "navigate"
    || req.destination === "document"
    || url.pathname.endsWith("/")
    || url.pathname.endsWith("index.html")
    || url.pathname.endsWith("sw.js");

  const live = isApp
    ? fetch(new Request(req.url, { cache: "reload", credentials: "same-origin" }))
    : fetch(req);

  e.respondWith(
    live.then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(req).then(r => r || caches.match("./index.html")))
  );
});
