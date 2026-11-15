/**
 * FFG runtime — 3d/ffg_boot3d_backgammon.js  (ES module entry for Backgammon)
 * Imports the shared 3D kernel + shell + the backgammon renderer, resolves the
 * game's content, and boots. Cache-busting via this module's ?v= query so the
 * kernel/shell/game all resolve from the SAME version URLs.
 */
const V = new URL(import.meta.url).search;

const { boot3d } = await import("./ffg_kernel_3d.js" + V);
await import("../ffg_shell.js" + V);           // menu / pause / win-lose / settings shell
await import("./ffg_backgammon3d.js" + V);     // registers genre "backgammon3d"

async function resolveContent() {
  if (window.FFG_CONTENT) return window.FFG_CONTENT;
  const r = await fetch("./content.json");
  return r.json();
}

try {
  boot3d(await resolveContent());
} catch (e) {
  console.error("[FFG3D] backgammon boot failed:", e);
}
