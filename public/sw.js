// Minimal service worker so Campus Wallet is installable as a PWA.
// Network-first for navigations (balances must be fresh), with an offline
// fallback to the cached shell. Financial data is never served stale from cache.
const CACHE = "campus-wallet-v1";
const SHELL = ["/"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  // Never cache API calls — always hit the network.
  if (request.method !== "GET" || new URL(request.url).pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/")));
  }
});
