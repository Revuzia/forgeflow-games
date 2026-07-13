/**
 * FFG runtime — 3d/ffg_boot3d_checkers.js  (ES module entry for Checkers)
 * Imports the shared 3D kernel + shell + the checkers renderer, resolves the
 * game's content, and boots. Cache-busting via this module's ?v= query so the
 * kernel/shell/game all resolve from the SAME version URLs.
 */
const V = new URL(import.meta.url).search;

const { boot3d } = await import("./ffg_kernel_3d.js" + V);
await import("../ffg_shell.js" + V);        // menu / pause / win-lose / settings shell
await import("./ffg_checkers3d.js" + V);    // registers genre "checkers3d"

async function resolveContent() {
  if (window.FFG_CONTENT) return window.FFG_CONTENT;
  const r = await fetch("./content.json");
  return r.json();
}

try {
  boot3d(await resolveContent());
} catch (e) {
  console.error("[FFG3D] checkers boot failed:", e);
}
