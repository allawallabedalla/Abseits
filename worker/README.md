# Abseits Proxy (Cloudflare Worker)

Hält den Google-API-Key zentral, damit App-Nutzer keinen eigenen Key brauchen.
Cachet identische Suchen am Edge (weniger Google-Aufrufe = weniger Kosten).

## Voraussetzungen
- Kostenloses Cloudflare-Konto: https://dash.cloudflare.com/sign-up
- Node.js (ist installiert) → `npx wrangler` funktioniert ohne separate Installation

## Deploy (im Ordner `worker/`)

```bash
cd worker
npx wrangler login                 # Browser öffnet sich, Cloudflare-Login bestätigen
npx wrangler secret put GOOGLE_KEY # Google-API-Key einfügen (bleibt geheim im Worker)
npx wrangler deploy                # deployt; gibt die Worker-URL aus
```

Die ausgegebene URL sieht so aus:
`https://abseits-proxy.<dein-subdomain>.workers.dev`

## In der App eintragen
In `index.html` die Konstante `PROXY_URL` auf diese URL setzen:

```js
const PROXY_URL = "https://abseits-proxy.<dein-subdomain>.workers.dev";
```

Danach committen + pushen. Ab dann läuft Google über den Proxy — ohne Key im Browser.
Ist `PROXY_URL` leer, nutzt die App weiter den vom Nutzer eingegebenen Key (Rückfallebene).

## Sicherheit / Kosten
- `ALLOWED_ORIGIN` in `wrangler.toml` auf deine Pages-Domain stellen (nur deine App darf den Proxy nutzen).
- Google-Quota-Limit bleibt deine harte Kostenbremse (siehe Cloud Console).
- Worker-Free-Tier: 100.000 Anfragen/Tag — für privat mehr als genug.
