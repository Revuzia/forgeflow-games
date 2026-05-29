/**
 * FFG runtime — 3d/ffg_boot3d.js  (ES module entry for 3D games)
 * Imports the 3D kernel + the registered 3D genre modules, resolves the game's
 * content (window.FFG_CONTENT or ./content.json), and boots. 3D games include
 * this as <script type="module">. Add an import line per new 3D genre.
 */
import { boot3d } from "./ffg_kernel_3d.js";
import "./ffg_battleship_3d.js"; // registers genre "battleship"

async function resolveContent() {
  if (window.FFG_CONTENT) return window.FFG_CONTENT;
  const r = await fetch("./content.json");
  return r.json();
}

resolveContent()
  .then((content) => boot3d(content))
  .catch((e) => console.error("[FFG3D] boot failed:", e));
