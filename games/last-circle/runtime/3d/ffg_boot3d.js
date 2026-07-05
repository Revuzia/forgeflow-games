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

const { boot3d } = await import("./ffg_kernel_3d.js" + V);
await import("./ffg_royale3d.js" + V);     // registers genre "royale"

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
