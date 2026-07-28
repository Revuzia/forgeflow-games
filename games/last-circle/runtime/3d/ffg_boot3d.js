/**
 * FFG runtime — 3d/ffg_boot3d.js  (ES module entry for Last Circle)
 * Imports the shared 3D kernel + the royale genre module, resolves content
 * (window.FFG_CONTENT or ./content.json), and boots.
 *
 * The version query on THIS module's URL (?v=...) is propagated to intra-runtime
 * imports so a redeploy never serves a stale runtime module. three is a bare
 * specifier resolved by the page importmap and is unaffected.
 */
const V = new URL(import.meta.url).search;

// Every failure path here has to PAINT something. Before this, a failed boot
// logged to a console the player will never open and left a black rectangle.
function splashFail(msg) {
  const s = document.getElementById("lc-splash");
  if (s) {
    const bar = s.querySelector(".bar");
    if (bar) bar.style.cssText += ";animation:none;width:100%;background:#c8503c";  // progress bar stops, turns red
    const tip = document.getElementById("lc-splash-tip");
    if (tip) tip.textContent = msg;
    return;
  }
  // No splash in the page: paint the message ourselves rather than assume one
  // exists — the whole point of this path is that the player is told something.
  const host = document.getElementById("game-container") || document.body;
  const d = document.createElement("div");
  d.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:#08131f;font:600 15px/1.6 system-ui,sans-serif;color:#cfe3f5;z-index:60";
  d.textContent = msg;
  host.appendChild(d);
}

// Double rAF so the first rendered frame of the menu is already behind the
// splash when it goes: boot3d() only calls kernel.start() after the genre
// builder returns, so returning from it is not yet a drawn frame.
function splashDone() {
  const s = document.getElementById("lc-splash");
  if (s) requestAnimationFrame(() => requestAnimationFrame(() => s.remove()));
}

// A phone loads ~8 MB of character GLB and only then discovers there is no way
// to move: no touchstart/touchmove handler exists anywhere in runtime/ or
// game_controls.js. The honest answer is a card, not a twin-stick port of a
// game with ADS, six weapons and a parachute. PLAY ANYWAY is always there —
// this can never be a hard gate.
function desktopOnlyCard(onPlay) {
  const s = document.getElementById("lc-splash");
  if (s) s.remove();                                   // the card is the thing to read now
  const host = document.getElementById("game-container") || document.body;
  const card = document.createElement("div");
  card.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center;background:#08131f;font:14px/1.6 system-ui,sans-serif;color:#cfe3f5;z-index:60";
  card.innerHTML = '<div style="max-width:340px"><div style="font:700 18px/1.3 system-ui,sans-serif;color:#e8f4ff;margin-bottom:10px">LAST CIRCLE IS DESKTOP-ONLY</div><div style="margin-bottom:18px">Keyboard and mouse required — there are no touch controls yet. Come back on a computer for the full 50-player match.</div><button type="button" style="padding:11px 20px;border:0;border-radius:8px;background:#2f9e6e;color:#04140d;font:700 14px system-ui,sans-serif;cursor:pointer">PLAY ANYWAY</button></div>';
  card.querySelector("button").addEventListener("click", () => { card.remove(); onPlay(); });
  host.appendChild(card);
}

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

let boot3d;
try {
  // These two imports sat outside the try that boots the game, so a blocked or
  // slow cdn.jsdelivr.net — index.html resolves `three` there with no fallback,
  // and school/corporate networks routinely block it — threw before any handler
  // existed: nothing painted and nothing explained why.
  ({ boot3d } = await import("./ffg_kernel_3d.js" + V));
  await import("./ffg_royale3d.js" + V);     // registers genre "royale"
} catch (e) {
  console.error("[FFG3D] engine load failed:", e);
  splashFail("Could not load the game engine — this network may be blocking cdn.jsdelivr.net. Reload to try again.");
  throw e;
}

async function resolveContent() {
  if (window.FFG_CONTENT) return window.FFG_CONTENT;
  const r = await fetch("./content.json");
  return r.json();
}

async function start() {
  try {
    // boot3d is async and awaits the genre builder; this call used to be
    // unawaited, so a rejection inside the builder escaped as an unhandled
    // promise rejection instead of reaching the catch two lines below it.
    await boot3d(await resolveContent());
    splashDone();
  } catch (e) {
    console.error("[FFG3D] boot failed:", e);
    splashFail("Last Circle could not start. Reload the page to try again.");
  }
}

// A touchscreen laptop reports coarse AND fine — it must not be stopped, hence
// both queries rather than just the coarse one.
const coarse = !!(window.matchMedia && matchMedia("(pointer: coarse)").matches
                  && !matchMedia("(pointer: fine)").matches);

if (!siteOk) {
  splashFail("Last Circle isn't licensed to run on " + hn + ".");
} else if (coarse) {
  desktopOnlyCard(start);
} else {
  await start();
}
