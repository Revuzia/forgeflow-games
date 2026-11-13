/**
 * FFG runtime — 3d/ffg_scene_boot.js  (ES module, FIXED TEMPLATE)
 * Boot for the Three-kernel author target: fetch content.json, build the AAA
 * environment (PBR + IBL) via ffg_scene.js, layer gameplay, mount + run. Exposes
 * window.__FFG3D__ so the deterministic render gate + preview QA can introspect it.
 */
import { Kernel3D } from "./ffg_kernel_3d.js";
import { buildEnvironment, buildGameplay } from "./ffg_scene.js";

async function boot() {
  let content = {};
  try { content = await (await fetch("content.json?v=1")).json(); } catch (e) { console.warn("[boot] content.json:", e && e.message); }
  const kernel = new Kernel3D(content);
  kernel.mount("game-container");
  const env = buildEnvironment(kernel, content);
  try { buildGameplay(kernel, content, env); } catch (e) { console.warn("[boot] gameplay:", e && e.message); }
  if (typeof kernel.run === "function") kernel.run();
  else if (typeof kernel.start === "function") kernel.start();
  window.__FFG3D__ = { kernel, content, env, ready: true };
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
