// Abseits PWA Service Worker
const CACHE = "abseits-v4";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return; // Overpass-POST, Google etc. unangetastet lassen

  const url = new URL(req.url);
  // Live-Daten nie cachen (Suche/Geocoding/Google/Tiles bleiben aktuell)
  if (/nominatim|overpass|googleapis|google\.com|tile\.openstreetmap/.test(url.host)) return;

  // Seiten-Navigation: erst Netz (für Updates), sonst Cache
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(r => { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return r; })
        .catch(() => caches.match(req).then(m => m || caches.match("./index.html")))
    );
    return;
  }

  // Shell + CDN-Assets: Cache zuerst, sonst Netz und nachladen
  e.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(r => {
        if (r.ok) { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
        return r;
      });
    })
  );
});
