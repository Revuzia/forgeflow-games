/**
 * FFG runtime — 3d/ffg_kernel_3d.js  (ES module)
 * Genre-agnostic three.js substrate: renderer, scene, camera, lights, render
 * loop, GLTF loader (cached), raycaster input, a DOM HUD overlay, a tiny tween
 * helper, and a genre registry. Fixed + versioned — NOT regenerated per game.
 *
 * 3D games are ES modules (three r172 ships ESM-only), so this is imported, not
 * loaded as a window-global. It still mirrors register/boot onto window.FFG for
 * tooling parity.
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const genres3d = {};
export function register3d(name, builder) { genres3d[name] = builder; }

export class Kernel3D {
  constructor(content) {
    this.content = content || {};
    const view = this.content.view || {};
    this.bg = view.background || "#0a1622";
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.bg);
    this.scene.fog = new THREE.FogExp2(this.bg, view.fog != null ? view.fog : 0.012);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.camera.position.set(0, 26, 30);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    // Lights — hemisphere fill + key sun with shadows.
    const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x223344, 0.9);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(40, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const d = 80;
    sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
    sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
    sun.shadow.camera.far = 250;
    this.scene.add(sun);
    this.sun = sun;

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.loader = new GLTFLoader();
    this._gltfCache = {};
    this._updaters = [];
    this._tweens = [];
    this._running = false;
  }

  mount(parentId) {
    this.parent = document.getElementById(parentId || "game-container") || document.body;
    this.parent.appendChild(this.renderer.domElement);
    // DOM HUD overlay (sharp text, never blurry — the shroud-font lesson)
    this.hudEl = document.createElement("div");
    Object.assign(this.hudEl.style, {
      position: "absolute", inset: "0", pointerEvents: "none",
      fontFamily: "monospace", color: "#dfeaff", textShadow: "0 1px 3px #000",
    });
    this.parent.style.position = this.parent.style.position || "relative";
    this.parent.appendChild(this.hudEl);
    this._resize();
    window.addEventListener("resize", () => this._resize());
    return this;
  }

  _resize() {
    const w = this.parent.clientWidth || window.innerWidth;
    const h = this.parent.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  hud(html) { if (this.hudEl) this.hudEl.innerHTML = html; }

  async loadGLTF(url) {
    if (this._gltfCache[url]) return this._gltfCache[url].clone(true);
    const gltf = await this.loader.loadAsync(url);
    const root = gltf.scene;
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this._gltfCache[url] = root;
    return root.clone(true);
  }

  /** Screen pointer (clientX/Y) -> intersections against `objects`. */
  raycast(clientX, clientY, objects) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(objects, true);
  }

  onUpdate(fn) { this._updaters.push(fn); }

  /** Minimal tween: lerps numeric props of obj.<path> to `to` over duration s. */
  tween(opts) {
    const t = {
      from: {}, to: opts.to || {}, target: opts.target,
      dur: opts.duration || 0.5, t: 0,
      ease: opts.ease || ((x) => x * x * (3 - 2 * x)), // smoothstep
      onUpdate: opts.onUpdate, onComplete: opts.onComplete,
    };
    for (const k in t.to) t.from[k] = _get(t.target, k);
    this._tweens.push(t);
    return t;
  }

  _stepTweens(dt) {
    for (let i = this._tweens.length - 1; i >= 0; i--) {
      const tw = this._tweens[i];
      tw.t = Math.min(1, tw.t + dt / tw.dur);
      const e = tw.ease(tw.t);
      for (const k in tw.to) _set(tw.target, k, tw.from[k] + (tw.to[k] - tw.from[k]) * e);
      if (tw.onUpdate) tw.onUpdate(e);
      if (tw.t >= 1) { if (tw.onComplete) tw.onComplete(); this._tweens.splice(i, 1); }
    }
  }

  start() {
    if (this._running) return;
    this._running = true;
    const loop = () => {
      if (!this._running) return;
      const dt = Math.min(0.05, this.clock.getDelta());
      this._stepTweens(dt);
      for (const u of this._updaters) u(dt, this.clock.elapsedTime);
      this.renderer.render(this.scene, this.camera);
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  stop() { this._running = false; if (this._raf) cancelAnimationFrame(this._raf); }
}

function _get(obj, path) { return path.split(".").reduce((o, k) => o[k], obj); }
function _set(obj, path, v) {
  const parts = path.split("."); const last = parts.pop();
  parts.reduce((o, k) => o[k], obj)[last] = v;
}

export async function boot3d(content) {
  const builder = genres3d[content.genre];
  if (!builder) { console.error("[FFG3D] no 3D runtime for genre:", content.genre, "have:", Object.keys(genres3d)); return null; }
  const kernel = new Kernel3D(content).mount(content.parent || "game-container");
  const controller = await builder(kernel, content);
  kernel.start();
  window.__FFG3D__ = { kernel, controller, content };
  return controller;
}

// tooling parity
if (typeof window !== "undefined") {
  window.FFG = window.FFG || {};
  window.FFG.genres3d = genres3d;
  window.FFG.boot3d = boot3d;
  window.FFG.VERSION3D = "2.0.0";
}
