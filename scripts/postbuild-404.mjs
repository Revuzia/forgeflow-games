// scripts/postbuild-404.mjs — runs as `postbuild`, after vike/vite have written
// dist/client.
//
// WHY: Cloudflare Pages treats a project with NO top-level 404.html as a
// single-page app and answers EVERY unknown URL with HTTP 200 + the homepage.
// Measured on the live site: /zzz-not-a-page -> 200. Google calls that a "soft
// 404", and it is exactly the defect that sank Revuzia's AdSense application.
// Shipping a real top-level 404.html switches Pages to proper 404 status codes.
//
// This page is deliberately plain static HTML (no React bundle): it has to work
// for any URL at any depth, and it must carry noindex.
//
// SPA FALLBACK (2026-10-08). It is also the safety net for a game or category
// that exists in the registry but has no prerendered HTML yet (published after
// the last portal build): Pages serves this file, with HTTP 404, for every URL
// that has no static file, at any depth. For a URL matching SPA_ROUTE_SOURCE
// (exactly /games/<slug> or /category/<name>) the inline script below hands the
// URL to the app as /?spa=<encoded path>; the homepage's SPA-fallback effect
// (pages/index/+Page.tsx, src/lib/spaFallback.ts) client-routes to the real page,
// where a bogus slug ends on "Game Not Found". Every other URL stays a plain 404.
// The script never fires twice for the same path within SPA_MARKER_TTL_MS unless
// the app confirmed it landed, so it cannot loop.
//
// This replaced `/games/* / 200` + `/category/* / 200` in public/_redirects. On
// Cloudflare Pages a matching _redirects rule is followed even when a static file
// exists at that path, so those rewrites served the homepage for EVERY
// prerendered game and category page (and their index.pageContext.json).

import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist", "client");

if (!existsSync(OUT)) {
  console.error(`[404] ${OUT} does not exist — build output moved? Not writing 404.html`);
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

// Mirrors of src/lib/spaFallback.ts (this script cannot import TypeScript).
const SPA_PARAM = "spa";
const SPA_MARKER_KEY = "ffg-spa-fallback";
const SPA_MARKER_TTL_MS = 60000;
const SPA_ROUTE_SOURCE = "^/(games|category)/[^/]+/?$";
{
  const shared = readFileSync(join(ROOT, "src", "lib", "spaFallback.ts"), "utf8");
  const literals = [JSON.stringify(SPA_PARAM), JSON.stringify(SPA_MARKER_KEY), String(SPA_MARKER_TTL_MS), JSON.stringify(SPA_ROUTE_SOURCE)];
  const missing = literals.filter((l) => !shared.includes(l));
  if (missing.length) {
    console.error(`[404] src/lib/spaFallback.ts no longer contains ${missing.join(", ")}: update the mirrors in scripts/postbuild-404.mjs`);
    process.exit(1);
  }
}

// Runs in the browser, inlined into <head> before anything paints. Written as a
// real function (not a string) so it is syntax-checked with this file.
function spaHandoff(routeSource, param, markerKey, ttlMs) {
  var path = location.pathname;
  if (!new RegExp(routeSource).test(path)) return;
  try {
    var prev = JSON.parse(sessionStorage.getItem(markerKey) || "null");
    if (prev && prev.path === path && Date.now() - prev.t < ttlMs) {
      // Handed this URL off moments ago and the app came back here instead of
      // landing: stop and show the plain 404. Clearing lets a later manual reload try again.
      sessionStorage.removeItem(markerKey);
      return;
    }
    sessionStorage.setItem(markerKey, JSON.stringify({ path: path, t: Date.now() }));
  } catch (e) {
    /* storage blocked: hand off anyway (the client router does not hard-reload today) */
  }
  document.documentElement.className = "spa-handoff";
  location.replace("/?" + param + "=" + encodeURIComponent(path + location.search + location.hash));
}
const handoffScript = `(${spaHandoff.toString()})(${[SPA_ROUTE_SOURCE, SPA_PARAM, SPA_MARKER_KEY, SPA_MARKER_TTL_MS].map((v) => JSON.stringify(v)).join(", ")});`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>Page not found | ForgeFlow Games</title>
<link rel="icon" type="image/png" href="/images/favicon.png">
<script>${handoffScript}</script>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #0a0e1a; color: #d1d5db; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; padding: 24px; }
  main { max-width: 520px; text-align: center; }
  .code { font-size: 72px; font-weight: 800; letter-spacing: -2px; color: #ff8800; margin: 0; line-height: 1; }
  h1 { font-size: 24px; margin: 12px 0 8px; color: #f3f4f6; }
  p { margin: 0 0 24px; line-height: 1.6; color: #9ca3af; }
  a.btn { display: inline-block; padding: 12px 22px; border-radius: 10px; background: #ff8800; color: #0a0e1a;
    font-weight: 700; text-decoration: none; margin: 4px; }
  a.alt { background: transparent; color: #d1d5db; border: 1px solid #374151; }
  .spa-handoff main { visibility: hidden; }
</style>
</head>
<body>
<main>
  <p class="code">404</p>
  <h1>That page isn't here</h1>
  <p>The link may be old, or the game may have moved. Everything we have is a click away.</p>
  <a class="btn" href="/games/">Browse all games</a>
  <a class="btn alt" href="/">Home</a>
</main>
</body>
</html>
`;

writeFileSync(join(OUT, "404.html"), html, "utf8");
console.log("[404] wrote dist/client/404.html");
