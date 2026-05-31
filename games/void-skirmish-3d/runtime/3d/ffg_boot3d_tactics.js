/**
 * FFG runtime — 3d/ffg_boot3d_tactics.js  (ES module entry for 3D tactics games)
 * Imports the 3D kernel + shell + the 3D isometric tactics renderer, resolves the
 * game's content, and boots. Cache-busting via this module's ?v= query.
 */
const V = new URL(import.meta.url).search;

const { boot3d } = await import("./ffg_kernel_3d.js" + V);
await import("../ffg_shell.js" + V);        // menu / pause / win-lose / music shell
await import("./ffg_tactics3d.js" + V);     // registers genre "tactics3d"

async function resolveContent() {
  if (window.FFG_CONTENT) return window.FFG_CONTENT;
  const r = await fetch("./content.json");
  return r.json();
}

try {
  boot3d(await resolveContent());
} catch (e) {
  console.error("[FFG3D] tactics boot failed:", e);
}
