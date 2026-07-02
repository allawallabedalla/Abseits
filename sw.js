// Abseits PWA Service Worker
const CACHE = "abseits-v31";
// Kartenkacheln, die Nutzer per "Diesen Ausschnitt speichern" (Info-Sheet)
// explizit für offline sichern — unversioniert, bleibt über App-Updates hinweg
const TILE_CACHE = "abseits-tiles";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./fonts/poppins-400.woff2",
  "./fonts/poppins-500.woff2",
  "./fonts/poppins-600.woff2",
  "./fonts/poppins-700.woff2"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return; // Overpass-POST, Google etc. unangetastet lassen

  const url = new URL(req.url);

  // Kartenkacheln: immer zuerst frisch vom Netz (aktuelle Karte beim Online-Sein),
  // aber bei Netzfehler aus dem explizit gespeicherten Offline-Gebiet bedienen.
  if (/tile\.openstreetmap/.test(url.host)) {
    e.respondWith(
      fetch(req).catch(() =>
        caches.open(TILE_CACHE).then(c => c.match(req)).then(m => m || new Response(null, { status: 504 }))
      )
    );
    return;
  }

  // Live-Daten nie cachen (Suche/Geocoding/Google bleiben aktuell)
  if (/nominatim|overpass|googleapis|google\.com/.test(url.host)) return;

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
