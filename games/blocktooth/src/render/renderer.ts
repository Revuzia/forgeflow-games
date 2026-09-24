// BLOCKTOOTH — render core (CONTRACT.md §6). render-core lane.
//
// Owns the WebGLRenderer, the Scene and the PerspectiveCamera. Everything else (views,
// lighting, env) is handed these through ViewCtx.
//
//   * antialias, powerPreference 'high-performance', sRGB output, NeutralToneMapping @ 1.0
//     (palette hex values read true on screen — CONTRACT §6.1).
//   * Shadows: ONE shadow-casting light (lighting.ts). three r186 REMOVED PCFSoftShadowMap
//     (WebGLShadowMap warns "PCFSoftShadowMap has been removed. Using PCFShadowMap instead."
//     on every first render), so we request PCFShadowMap directly — in r186 that IS the soft
//     path: 5 Vogel-disk taps × hardware 2×2 PCF, softened by `shadow.radius` (lighting.ts).
//   * DPR = min(devicePixelRatio, quality.dpr, BUDGET.dprMax). The drawing buffer follows the
//     canvas' CSS box (the app styles the canvas; we never write canvas.style).
//   * Honest counters: info.autoReset = false and ONE reset per frame inside render(), so any
//     extra passes in a frame (portraits, shots) are counted, not hidden (doctrine §3).

import * as THREE from 'three';
import type { Quality } from './viewtypes.ts';
import { BUDGET, CAMERA } from '../core/config.ts';

export interface RenderStats {
  draws: number;
  tris: number;
  programs: number;
  geometries: number;
  textures: number;
}

export interface RenderCore {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** the quality currently applied (same object views were handed; mutated by setQuality) */
  quality: Quality;
  /** re-reads the canvas' CSS box + DPR and resizes the drawing buffer / camera aspect */
  resize(): void;
  /** resets renderer.info, then renders scene with camera (auto-resizes if the canvas box changed) */
  render(): void;
  setQuality(q: Quality): void;
  stats(): RenderStats;
}

function deviceDpr(): number {
  const d = typeof window !== 'undefined' && Number.isFinite(window.devicePixelRatio) ? window.devicePixelRatio : 1;
  return d > 0 ? d : 1;
}

/** Sensible defaults for this machine: high quality on desktop, medium on touch devices. */
export function defaultQuality(): Quality {
  let coarse = false;
  let lowCores = false;
  try {
    coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    lowCores = typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number' && navigator.hardwareConcurrency > 0 && navigator.hardwareConcurrency < 4;
  } catch { /* non-browser: keep defaults */ }
  const level: 0 | 1 | 2 = coarse || lowCores ? 1 : 2;
  return {
    dpr: Math.min(deviceDpr(), BUDGET.dprMax),
    shadows: true,
    level,
    reduceFlashing: false,
    screenShake: true,
  };
}

/** The pixel ratio actually applied for a quality: min(device, requested, budget). */
export function effectiveDpr(q: Quality): number {
  const req = Number.isFinite(q.dpr) && q.dpr > 0 ? q.dpr : 1;
  return Math.max(0.5, Math.min(deviceDpr(), req, BUDGET.dprMax));
}

export function createRenderCore(canvas: HTMLCanvasElement, quality: Quality): RenderCore {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;      // r186: PCFSoft removed; PCF + shadow.radius is the soft path
  renderer.shadowMap.autoUpdate = true;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  scene.name = 'blocktooth';
  scene.background = new THREE.Color('#9fd8f0');   // lighting.applyBiome re-colours it to the fog colour

  const camera = new THREE.PerspectiveCamera(CAMERA.fovDeg, 16 / 9, 0.1, 1000);
  camera.name = 'mainCamera';
  camera.position.set(12, 10, 12);
  camera.lookAt(0, 0, 0);

  const q: Quality = quality;
  // CameraRig (constructed with just the camera, per the contract) reads the LIVE quality here,
  // so settings.screenShake applies without extra wiring. Same object setQuality() mutates.
  camera.userData.quality = q;
  let lastW = -1, lastH = -1, lastDpr = -1;

  function cssBox(): { w: number; h: number } {
    let w = canvas.clientWidth, h = canvas.clientHeight;
    if (!(w > 0 && h > 0)) {
      // canvas not laid out yet (display:none or detached) — fall back to the window, then a safe default
      w = typeof window !== 'undefined' ? window.innerWidth : 1280;
      h = typeof window !== 'undefined' ? window.innerHeight : 720;
    }
    return { w: Math.max(1, Math.floor(w)), h: Math.max(1, Math.floor(h)) };
  }

  function resize(): void {
    const { w, h } = cssBox();
    const dpr = effectiveDpr(q);
    if (dpr !== lastDpr) { renderer.setPixelRatio(dpr); lastDpr = dpr; lastW = -1; }
    if (w !== lastW || h !== lastH) {
      renderer.setSize(w, h, false);            // false: the app owns canvas.style
      lastW = w; lastH = h;
    }
    const aspect = w / h;
    if (Math.abs(camera.aspect - aspect) > 1e-6) {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
    }
  }

  function render(): void {
    // cheap per-frame check instead of a ResizeObserver: handles CSS layout changes,
    // fullscreen toggles and DPR changes (window dragged to another monitor) alike
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if ((w > 0 && h > 0 && (w !== lastW || h !== lastH)) || effectiveDpr(q) !== lastDpr) {
      const t0 = performance.now();
      resize();
      (renderer as unknown as { __resizeMs?: number }).__resizeMs = performance.now() - t0;
    }
    renderer.info.reset();
    renderer.render(scene, camera);
  }

  function setQuality(nq: Quality): void {
    const shadowsChanged = nq.shadows !== q.shadows;
    q.dpr = nq.dpr; q.shadows = nq.shadows; q.level = nq.level;
    q.reduceFlashing = nq.reduceFlashing; q.screenShake = nq.screenShake;
    if (shadowsChanged) {
      renderer.shadowMap.enabled = q.shadows;
      // shadow on/off is a program-cache key: flag every material so programs rebuild cleanly
      scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (!m) return;
        if (Array.isArray(m)) { for (const mm of m) mm.needsUpdate = true; } else m.needsUpdate = true;
      });
    }
    // No resize() here: setSize() clears the drawing buffer, and DynRes calls setQuality AFTER the
    // frame rendered (and settings call it while paused), so an immediate resize presented an empty
    // canvas for a frame (navy flash). render() sees effectiveDpr(q) !== lastDpr and resizes right
    // before it draws.
  }

  const out: RenderStats = { draws: 0, tris: 0, programs: 0, geometries: 0, textures: 0 };
  function stats(): RenderStats {
    const info = renderer.info;
    out.draws = info.render.calls;
    out.tris = info.render.triangles;
    out.programs = info.programs ? info.programs.length : 0;
    out.geometries = info.memory.geometries;
    out.textures = info.memory.textures;
    return out;
  }

  resize();
  return { renderer, scene, camera, quality: q, resize, render, setQuality, stats };
}
