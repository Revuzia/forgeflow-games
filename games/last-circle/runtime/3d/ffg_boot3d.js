/**
 * FFG runtime — 3d/ffg_boot3d.js  (ES module entry for Last Circle)
 * Checks the host (sitelock) and WebGL 2, imports the shared 3D kernel + the royale
 * genre module, resolves content (window.FFG_CONTENT or ./content.json), and boots.
 *
 * The version query on THIS module's URL (?v=...) is propagated to intra-runtime
 * imports so a redeploy never serves a stale runtime module. three is a bare
 * specifier resolved by the page importmap (vendored under assets/vendor/three/).
 *
 * Every failure path PAINTS something, through the page's boot guard
 * (window.__LC_BOOT__, index.html) when it exists: a named failure card that
 * nothing overwrites. Without the guard (another page embedding this module) a
 * plain fallback card is drawn instead.
 */
const V = new URL(import.meta.url).search;
const guard = () => (typeof window !== "undefined" && window.__LC_BOOT__) || null;

// ── painting ─────────────────────────────────────────────────────────────────
function fallbackCard(title, msg) {
  const s = document.getElementById("lc-splash");
  if (s) s.remove();
  const host = document.getElementById("game-container") || document.body;
  const d = document.createElement("div");
  d.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;padding:24px;text-align:center;background:#08131f;font:600 15px/1.6 system-ui,sans-serif;color:#cfe3f5;z-index:60;white-space:pre-line";
  const h = document.createElement("div");
  h.style.cssText = "font:800 19px/1.3 system-ui,sans-serif;color:#ff8f7d";
  const m = document.createElement("div");
  const set = (t, x) => { if (t) h.textContent = t; if (x != null) m.textContent = x; };
  set(title, msg);
  d.append(h, m);
  host.appendChild(d);
  return { update: set, close: () => d.remove() };
}
function fail(title, msg, actions, opts) {
  const g = guard();
  if (g && typeof g.fail === "function") {
    try { return g.fail(title, msg, actions, opts) || null; } catch (e) { console.error("[FFG3D] boot guard fail() threw:", e); }
  }
  return fallbackCard(title, msg);
}
function status(msg) {
  const g = guard();
  if (g && typeof g.info === "function") try { g.info(msg); } catch (e) { /* cosmetic */ }
}
// The menu is up (or the boot is in the player's hands): the guard stands down and
// fades the splash after the first drawn frame. Without a guard: the old double rAF.
function handoff() {
  const g = guard();
  if (g && typeof g.handoff === "function") { try { g.handoff(); return; } catch (e) { console.error("[FFG3D] boot guard handoff() threw:", e); } }
  const s = document.getElementById("lc-splash");
  if (s) requestAnimationFrame(() => requestAnimationFrame(() => s.remove()));
}

// (No "desktop-only" card any more: phones have a native touch layer —
// royale/touch.js — and boot straight to the menu like desktop. PLAN L9 last
// step, Wave 3, after mobile.py passed 48/48. Only REAL capability checks gate
// the boot: the sitelock and WebGL 2, below.)

// ── checks that run BEFORE the engine is downloaded ─────────────────────────
// Sitelock. Keep the list here and nowhere else — a sitelock that is hard to
// update becomes the reason a legitimate build refuses to run. "" is file://
// (hostname is empty) and .pages.dev is every preview deploy; both are used by
// this repo's own verification workflow, so neither may be dropped.
// The exact workers.dev host is OUR OWN CDN — it is both the direct-play URL
// and the src the portal's GamePlayer iframe loads (an iframe's hostname is
// its own document's host, not the portal's). Exact match only: a ".workers.dev"
// suffix would license every rehoster who proxies the files through a worker.
const ALLOW = ["", "localhost", "127.0.0.1", "0.0.0.0", "[::1]", "forgeflowgames.com", "www.forgeflowgames.com", "forgeflow-games-cdn.isimcha85.workers.dev"];
const SUFFIX = [".forgeflowgames.com", ".pages.dev", ".r2.dev", ".crazygames.com", ".crazygames.dev"];
const hn = location.hostname;
const siteOk = ALLOW.includes(hn) || SUFFIX.some((s) => hn.endsWith(s));

// three r172 is WebGL-2-only. The head guard already asked once (and skipped the
// three preloads if the answer was no); reuse its answer instead of opening a
// second throwaway context.
function hasWebGL2() {
  const g = guard();
  if (g && typeof g.info === "function") {
    try { const i = g.info(); if (i && typeof i.webgl2 === "boolean") return i.webgl2; } catch (e) { /* ask directly */ }
  }
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl) return false;
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    return true;
  } catch (e) { return false; }
}
function webglCard(extra) {
  fail("WebGL 2 is required",
    "Last Circle draws its 3D world with WebGL 2, and this browser did not provide it.\n" +
    "Turn on hardware acceleration in your browser settings (it may need a browser restart), " +
    "update the browser or graphics driver, then press RELOAD." + (extra ? "\n(" + extra + ")" : ""));
}

// ── naming what actually failed ──────────────────────────────────────────────
// A dynamic import() of the kernel or the royale module rejects with a message that
// names only THAT top-level URL ("Failed to fetch dynamically imported module:
// .../ffg_royale3d.js"), even when the 404 was hud.js three levels down, and the
// classic sim/royale.js loader rejects with a bare Event. So: resource timing first
// (a completed 4xx/5xx response is listed with its status), then a walk of the
// module graph with no-store GETs until a file that does not answer 2xx is found.
function isFetchFailure(e) {
  if (typeof Event !== "undefined" && e instanceof Event) return true;
  const m = String((e && e.message) || e || "");
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Failed to fetch|NetworkError|Load failed|failed to load/i.test(m);
}
function describeError(e) {
  if (typeof Event !== "undefined" && e instanceof Event) {
    const t = e.target, u = t && (t.src || t.href);
    return "failed to load " + (u ? shortName(u) : "a script");
  }
  const m = (e && e.message) || String(e);
  return ((e && e.name && e.name !== "Error") ? e.name + ": " : "") + String(m).slice(0, 400);
}
function shortName(u) {
  try {
    const url = new URL(u, location.href);
    const dir = location.href.replace(/[?#].*$/, "").replace(/[^/]*$/, "");
    const bare = url.href.replace(/[?#].*$/, "");
    if (bare.startsWith(dir)) return bare.slice(dir.length);
    return url.origin === location.origin ? url.pathname : url.host + url.pathname;
  } catch (e) { return String(u); }
}
function importMap() {
  try { return JSON.parse(document.querySelector('script[type="importmap"]').textContent).imports || {}; } catch (e) { return {}; }
}
function resolveSpec(spec, base, imap) {
  if (/^(\.{1,2}\/|\/)/.test(spec)) return new URL(spec, base).href;
  if (imap[spec]) return new URL(imap[spec], location.href).href;
  let best = "";
  for (const k in imap) if (k.endsWith("/") && spec.startsWith(k) && k.length > best.length) best = k;
  if (best) return new URL(imap[best] + spec.slice(best.length), location.href).href;
  return null;   // absolute URLs (lazy third-party imports such as esm.sh) are not part of the boot graph
}
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|new URL\(\s*)["']([^"'\n]+?\.(?:m?js))["']/g;
function specifiers(src) {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
  const out = [];
  let m;
  SPEC.lastIndex = 0;
  while ((m = SPEC.exec(code))) out.push(m[1]);
  if (/\bfrom\s*["']three["']|import\s*\(\s*["']three["']/.test(code)) out.push("three");
  return out;
}
function probeUrl(u) { return u + (u.includes("?") ? "&" : "?") + "lcprobe=1"; }
async function getOnce(url, ms) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const to = setTimeout(() => { try { ctl && ctl.abort(); } catch (e) { /* done */ } }, ms);
  try {
    const r = await fetch(probeUrl(url), { cache: "no-store", credentials: "same-origin", signal: ctl ? ctl.signal : undefined });
    if (!r.ok) return { ok: false, why: "HTTP " + r.status };
    return { ok: true, text: await r.text() };
  } catch (e) {
    return { ok: false, why: (ctl && ctl.signal.aborted) ? "no answer in " + Math.round(ms / 1000) + " s" : "network error" };
  } finally { clearTimeout(to); }
}
// good: URLs whose whole graph is known to have loaded (an import() of them resolved).
// Pass 1 is the quick one: it re-fetches only OUR runtime files and trusts a vendored
// (third-party) file that resource timing lists as 2xx, so on a slow link the card names
// the file in two short round trips instead of re-downloading 1.3 MB of three first.
// Pass 2 (only if pass 1 found nothing) walks everything.
async function findFailedFiles(roots, onBad, good) {
  const report = (b) => { if (onBad) try { onBad(b); } catch (e) { /* cosmetic */ } };
  const bad = [];
  const seen = new Set();
  const ok2xx = new Set();
  try {
    for (const r of performance.getEntriesByType("resource")) {
      if (/lcprobe=/.test(r.name)) continue;
      if (r.responseStatus >= 400 && /\.(m?js|json)(\?|$)/.test(r.name) && !seen.has(r.name)) {
        seen.add(r.name);
        bad.push({ url: r.name, why: "HTTP " + r.responseStatus });
        report(bad[bad.length - 1]);
      } else if (r.responseStatus >= 200 && r.responseStatus < 300) ok2xx.add(r.name);
    }
  } catch (e) { /* no resource timing: walk */ }
  if (bad.length) return bad;
  const imap = importMap();
  const t0 = performance.now();
  const walk = async (quick) => {
    let level = roots.slice();
    const done = new Set(good || []);
    while (level.length && done.size < 90 && performance.now() - t0 < 20000) {
      const next = [];
      await Promise.all(level.map(async (u) => {
        if (done.has(u)) return;
        done.add(u);
        if (quick && !/\/runtime\//.test(u) && ok2xx.has(u)) return;
        const r = await getOnce(u, 8000);
        if (!r.ok) { bad.push({ url: u, why: r.why }); report(bad[bad.length - 1]); return; }   // named on the card at once, not at the end of the level
        for (const s of specifiers(r.text)) {
          const abs = resolveSpec(s, u, imap);
          if (abs && !done.has(abs)) next.push(abs.includes("?") || !/\/runtime\//.test(abs) ? abs : abs + V);
        }
      }));
      if (bad.length) break;
      level = Array.from(new Set(next));
    }
  };
  await walk(true);
  if (!bad.length && performance.now() - t0 < 20000) await walk(false);
  return bad;
}
async function engineFail(e, roots, good) {
  const fetchFail = isFetchFailure(e);
  if (!fetchFail) {
    // it downloaded but would not link/run: an import/export mismatch is what a half-finished
    // deploy looks like, so this takes the single automatic retry too
    fail("Last Circle could not start", describeError(e) + "\nIf Last Circle was just updated, wait a minute and press RELOAD.", null, { retry: true });
    return;
  }
  // With the guard: its single "could not load" card lists the file(s) and owns the one
  // automatic retry (it may already have named the file from resource timing).
  const g = guard();
  if (g && typeof g.loadFailed === "function") {
    try {
      g.loadFailed(null, null);                   // the card now, "finding out which one…"
      let found = [];
      let named = 0;
      try { found = await findFailedFiles(roots, (b) => { if (named++ < 4) g.loadFailed(b.url, b.why); }, good); } catch (x) { /* the note below */ }
      if (!found.length) g.loadFailed(null, "the game engine (" + describeError(e) + "); every file answers now, so it was probably a brief network drop");
      return;
    } catch (x) { console.error("[FFG3D] boot guard loadFailed() threw:", x); }
  }
  const h = fail("Last Circle could not load", "A game file did not download. Finding out which one…", null, { retry: true, waitForUpdate: true });
  let bad = [];
  try { bad = await findFailedFiles(roots, null, good); } catch (x) { /* fall through to the generic line */ }
  const lines = [];
  if (bad.length) {
    lines.push("A game file did not download:");
    for (const b of bad.slice(0, 4)) lines.push("  " + shortName(b.url) + "  (" + b.why + ")");
    const hosts = Array.from(new Set(bad.map((b) => { try { const u = new URL(b.url); return u.origin === location.origin ? "" : u.host; } catch (x) { return ""; } }).filter(Boolean)));
    if (hosts.length) lines.push("This network may be blocking " + hosts.join(", ") + ".");
  } else {
    lines.push("The game engine did not load (" + describeError(e) + "). Every file answers now, so it was probably a brief network drop.");
  }
  lines.push("Check your connection, then press RELOAD. If Last Circle was just updated, wait a minute and try again.");
  if (h && h.update) h.update(null, lines.join("\n"));
}

// ── content ──────────────────────────────────────────────────────────────────
class LoadError extends Error {
  constructor(file, why) { super(file + ": " + why); this.file = file; this.why = why; }
}
async function resolveContent() {
  if (window.FFG_CONTENT) return window.FFG_CONTENT;
  // no-cache: revalidate every time (the CDN serves content.json with max-age=86400,
  // so a changed file could stay stale for a day); the ?v= tag moves with each bump.
  let r;
  try { r = await fetch("./content.json" + V, { cache: "no-cache" }); } catch (e) { throw new LoadError("content.json", "network error"); }
  if (!r.ok) throw new LoadError("content.json", "HTTP " + r.status);
  try { return await r.json(); } catch (e) { throw new LoadError("content.json", "not valid JSON"); }
}

async function start(boot3d) {
  status("Loading the game data");
  let content;
  try { content = await resolveContent(); } catch (e) {
    console.error("[FFG3D] content load failed:", e);
    const g = guard();
    if (g && typeof g.loadFailed === "function") {
      try { g.loadFailed(new URL("./content.json" + V, location.href).href, e.why || describeError(e)); return; }
      catch (x) { console.error("[FFG3D] boot guard loadFailed() threw:", x); }
    }
    fail("Last Circle could not load",
      "A game file did not download:\n  " + (e.file || "content.json") + "  (" + (e.why || describeError(e)) + ")\n" +
      "Check your connection, then press RELOAD. If Last Circle was just updated, wait a minute and try again.",
      null, { retry: true });
    return;
  }
  status("Building the world");
  try {
    // boot3d is async and awaits the genre builder, so a rejection inside the builder lands here.
    const controller = await boot3d(content);
    // boot3d returns null for an unregistered genre; the splash used to vanish onto a blank page
    if (!controller) throw new Error('no 3D runtime is registered for genre "' + content.genre + '"');
    handoff();
  } catch (e) {
    console.error("[FFG3D] boot failed:", e);
    const m = String((e && e.message) || e);
    if (/WebGL|creating .*context|getContext/i.test(m)) { webglCard(describeError(e)); return; }
    fail("Last Circle could not start", describeError(e) + "\nPress RELOAD to try again.");
  }
}

async function main() {
  if (!siteOk) {
    // No RELOAD: reloading can never fix this, and telling the player to was the old bug.
    fail("Last Circle isn't available here",
      "This copy of Last Circle isn't licensed to run on " + (hn || "this page") + ".\nPlay it free at forgeflowgames.com.", []);
    return;
  }
  if (!hasWebGL2()) { webglCard(); return; }

  status("Loading the game engine");
  const kernelUrl = new URL("./ffg_kernel_3d.js" + V, import.meta.url).href;
  const royaleUrl = new URL("./ffg_royale3d.js" + V, import.meta.url).href;
  let boot3d, kernelIn = false;
  try {
    ({ boot3d } = await import("./ffg_kernel_3d.js" + V));
    kernelIn = true;                           // the kernel's whole graph (three included) is in
    await import("./ffg_royale3d.js" + V);     // registers genre "royale"
  } catch (e) {
    console.error("[FFG3D] engine load failed:", e);
    // once the kernel resolved only the royale graph can hold the failed file
    await engineFail(e, kernelIn ? [royaleUrl] : [kernelUrl, royaleUrl], kernelIn ? [kernelUrl] : []);
    return;
  }
  await start(boot3d);
}

main().catch((e) => {
  console.error("[FFG3D] boot crashed:", e);
  fail("Last Circle could not start", describeError(e) + "\nPress RELOAD to try again.");
});
