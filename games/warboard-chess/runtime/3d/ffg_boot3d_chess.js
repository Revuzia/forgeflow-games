/**
 * FFG runtime — 3d/ffg_boot3d_chess.js  (ES module entry for Warboard Chess)
 * Imports the 3D kernel + shell + the chess renderer, resolves the game's
 * content, and boots. Cache-busting via this module's ?v= query (mirrors the
 * tactics boot so the kernel/shell/sim all resolve from the SAME version URLs —
 * a bare import would be a different kernel instance with an empty genre registry).
 */
const V = new URL(import.meta.url).search;

const { boot3d } = await import("./ffg_kernel_3d.js" + V);
await import("../ffg_shell.js" + V);        // menu / pause / win-lose / music shell
await import("./ffg_chess3d.js" + V);       // registers genre "chess3d"

async function resolveContent() {
  if (window.FFG_CONTENT) return window.FFG_CONTENT;
  const r = await fetch("./content.json");
  return r.json();
}

try {
  boot3d(await resolveContent());
} catch (e) {
  console.error("[FFG3D] chess boot failed:", e);
}
