/**
 * FFG runtime — 3d/ffg_boot3d.js  (ES module entry for Tide Breakers)
 * Imports the 3D kernel + the navalfree genre module + the standard shell,
 * resolves content (window.FFG_CONTENT or ./content.json), and boots.
 *
 * The version query on THIS module's URL (?v=...) is propagated to intra-runtime
 * imports so a redeploy never serves a stale runtime module. three/cannon-es are
 * bare specifiers resolved by the page importmap and are unaffected.
 */
const V = new URL(import.meta.url).search; // e.g. "?v=1717000000"

const { boot3d } = await import("./ffg_kernel_3d.js" + V);
await import("../ffg_shell.js" + V);          // standard menu/pause/win-lose/music shell (sets FFG.Shell)
await import("./ffg_navalfree3d.js" + V);     // registers genre "navalfree"

async function resolveContent() {
  if (window.FFG_CONTENT) return window.FFG_CONTENT;
  const r = await fetch("./content.json");
  return r.json();
}

try {
  boot3d(await resolveContent());
} catch (e) {
  console.error("[FFG3D] boot failed:", e);
}
