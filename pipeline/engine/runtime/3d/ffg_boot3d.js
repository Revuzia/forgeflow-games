/**
 * FFG runtime — 3d/ffg_boot3d.js  (ES module entry for 3D games)
 * Imports the 3D kernel + registered 3D genre modules, resolves the game's
 * content (window.FFG_CONTENT or ./content.json), and boots.
 *
 * Cache-busting: the version query on THIS module's URL (?v=...) is propagated
 * to its intra-runtime imports so a redeploy never serves stale runtime modules
 * (and dev iteration always loads fresh). three/cannon-es are bare specifiers
 * resolved by the page importmap and are unaffected.
 */
const V = new URL(import.meta.url).search; // e.g. "?v=1717000000"

const { boot3d } = await import("./ffg_kernel_3d.js" + V);
await import("./ffg_battleship_3d.js" + V); // registers genre "battleship"

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
