/**
 * Cosmic Coils — runtime/3d/boot.js (ES module entry)
 * Creates the renderer + composer, loads content.json, boots the Game.
 * The ?v= on THIS module propagates to every intra-runtime import so a
 * redeploy never mixes stale modules (FFG house rule).
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const V = new URL(import.meta.url).search;
const { Game } = await import("./game.js" + V);

async function resolveContent() {
  if (window.FFG_CONTENT) return window.FFG_CONTENT;
  const r = await fetch("./content.json");
  return r.json();
}

function makeRenderer(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = false; // glow aesthetic — bloom carries the look, big perf win
  container.appendChild(renderer.domElement);
  return renderer;
}

try {
  const content = await resolveContent();
  const container = document.getElementById("game-container");
  const renderer = makeRenderer(container);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, container.clientWidth / container.clientHeight, 0.1, 4000);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // lower strength/threshold so world limb + essence don't blow out
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(container.clientWidth, container.clientHeight), 0.48, 0.45, 0.72);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  window.addEventListener("resize", () => {
    const w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderer.setSize(w, h); composer.setSize(w, h);
  });

  const game = new Game({ THREE, renderer, scene, camera, composer, bloom, container, content, V });
  await game.init();
  game.start();

  // context-loss resilience: prompt a reload instead of a black screen
  renderer.domElement.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    const d = document.createElement("div");
    d.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#050510;color:#9ff;z-index:99;font-family:system-ui;font-size:18px;cursor:pointer";
    d.textContent = "Graphics context lost — click to reload";
    d.onclick = () => location.reload();
    container.appendChild(d);
  });
} catch (e) {
  console.error("[CC] boot failed:", e);
  const d = document.createElement("div");
  d.style.cssText = "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#f66;font-family:system-ui;white-space:pre-wrap;padding:30px";
  d.textContent = "Cosmic Coils failed to start:\n" + (e && e.stack || e);
  document.body.appendChild(d);
}
