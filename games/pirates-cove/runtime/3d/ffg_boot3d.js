/**
 * FFG runtime — 3d/ffg_boot3d.js  (ES module entry for Pirate's Cove)
 * Imports the shared 3D kernel + the REAL-TIME openseas genre module, resolves
 * content (window.FFG_CONTENT or ./content.json), and boots.
 *
 * The version query on THIS module's URL (?v=...) is propagated to intra-runtime
 * imports so a redeploy never serves a stale runtime module. three/cannon-es are
 * bare specifiers resolved by the page importmap and are unaffected.
 *
 * (No turn-based shell yet — the open-seas sandbox starts sailing immediately. A
 * title/menu/pause pass lands with the encounter + crew systems.)
 */
const V = new URL(import.meta.url).search;

const { boot3d } = await import("./ffg_kernel_3d.js" + V);
await import("./ffg_openseas3d.js" + V);     // registers genre "openseas"

async function resolveContent() {
  if (window.FFG_CONTENT) return window.FFG_CONTENT;
  const r = await fetch("./content.json" + V);   // cache-bust with the same ?v as the modules -> content.json never serves stale after a redeploy
  return r.json();
}

try {
  boot3d(await resolveContent());
} catch (e) {
  console.error("[FFG3D] boot failed:", e);
}
