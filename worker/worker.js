// Abseits — Cloudflare Worker Proxy für Google Places API (New)
//
// Zweck: Der Google-API-Key liegt zentral als Secret im Worker, nicht im Browser.
// Nutzer der App brauchen keinen eigenen Key mehr. Edge-Caching reduziert
// die Zahl der Google-Aufrufe (= Kosten) für wiederholte Suchen derselben Gegend.
//
// Erwartet POST mit JSON: { lat, lng, radius, includedTypes?, maxResultCount? }
// Antwort: Google-Places-(New)-Response (JSON) mit places[].

const FIELD_MASK = [
  "places.displayName",
  "places.location",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.formattedAddress",
  "places.primaryType",
  "places.types",
].join(",");

export default {
  async fetch(request, env, ctx) {
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Vary": "Origin",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    // Health-Check: GET zeigt, ob der Worker laeuft und ein Key hinterlegt ist (ohne ihn zu verraten)
    if (request.method === "GET") {
      return json({ ok: true, hasKey: !!env.GOOGLE_KEY }, 200, cors);
    }
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405, cors);
    if (!env.GOOGLE_KEY) return json({ error: "server not configured" }, 500, cors);

    // ---- Missbrauchsschutz: nur die eigene App, und nicht im Übermaß ----
    // CORS schützt nur Browser; ein serverseitiger Origin-/Referer-Check sperrt
    // fremde Seiten und einfache Bots aus (verhindert Verbrennen des Google-Kontingents).
    if (!originOk(request, env)) return json({ error: "forbidden origin" }, 403, cors);
    if (await rateLimited(request, env, ctx)) return json({ error: "rate limited" }, 429, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, cors); }

    const lat = Number(body.lat), lng = Number(body.lng);
    if (!isFinite(lat) || !isFinite(lng)) return json({ error: "lat/lng required" }, 400, cors);
    const radius = Math.min(Math.max(Number(body.radius) || 5000, 1), 50000);
    const includedTypes = Array.isArray(body.includedTypes) && body.includedTypes.length
      ? body.includedTypes.slice(0, 50) : ["lodging"];
    const maxResultCount = Math.min(Math.max(Number(body.maxResultCount) || 20, 1), 20);

    // ---- Edge-Cache: gleiche (gerundete) Gegend nicht erneut bei Google anfragen ----
    const ckey = new Request(
      new URL(request.url).origin + "/cache?" + new URLSearchParams({
        lat: lat.toFixed(3), lng: lng.toFixed(3),
        r: String(Math.round(radius / 500) * 500),
        t: includedTypes.slice().sort().join(","),
        n: String(maxResultCount),
      }).toString(),
      { method: "GET" }
    );
    const cache = caches.default;
    const cached = await cache.match(ckey);
    if (cached) {
      const h = new Headers(cached.headers); Object.entries(cors).forEach(([k, v]) => h.set(k, v)); h.set("X-Cache", "HIT");
      return new Response(cached.body, { status: cached.status, headers: h });
    }

    const gResp = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": env.GOOGLE_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify({
        includedTypes,
        maxResultCount,
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
      }),
    });

    const text = await gResp.text();
    // Bei Google-Fehler die Ursache durchreichen (sonst kommt nur ein leerer 400 an)
    if (!gResp.ok) {
      return json({ error: "google", status: gResp.status, detail: text || "(leer)" }, gResp.status, cors);
    }
    const headers = {
      ...cors,
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=600",
      "X-Cache": "MISS",
    };
    const out = new Response(text, { status: gResp.status, headers });
    ctx.waitUntil(cache.put(ckey, out.clone()));
    return out;
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Nur Anfragen der eigenen App zulassen. ALLOWED_ORIGIN unset oder "*" => offen
// (Abwärtskompatibel). Sonst muss Origin exakt passen; ohne Origin-Header wird
// hilfsweise der Referer geprüft.
function originOk(request, env) {
  const allow = env.ALLOWED_ORIGIN;
  if (!allow || allow === "*") return true;
  const origin = request.headers.get("Origin");
  if (origin) return origin === allow;
  return (request.headers.get("Referer") || "").startsWith(allow);
}

// Leichtes Rate-Limit pro IP (fixes Minutenfenster) über die Edge-Cache-API.
// Bewusst grob/ohne Atomarität — als Bremse gegen Scraping, nicht als harte Grenze.
// Über env.RATE_LIMIT konfigurierbar (Anfragen/Minute/IP); 0 oder negativ = aus.
async function rateLimited(request, env, ctx) {
  const limit = Number(env.RATE_LIMIT ?? 60);
  if (!(limit > 0)) return false;
  const ip = request.headers.get("CF-Connecting-IP") || "anon";
  const minute = Math.floor(Date.now() / 60000);
  const key = new Request(
    new URL(request.url).origin + "/__rl?ip=" + encodeURIComponent(ip) + "&m=" + minute,
    { method: "GET" }
  );
  const cache = caches.default;
  let count = 0;
  const hit = await cache.match(key);
  if (hit) count = Number(await hit.text()) || 0;
  count++;
  ctx.waitUntil(cache.put(key, new Response(String(count), { headers: { "Cache-Control": "public, max-age=70" } })));
  return count > limit;
}
