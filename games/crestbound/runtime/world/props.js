/**
 * CRESTBOUND — runtime/world/props.js
 * ---------------------------------------------------------------------------
 * Set dressing. Two sources, one interface:
 *
 *   1. CURATED GLB PROPS  — real modelled assets, six to twelve per theme, in
 *      `assets/props/<theme>/*.glb`. They are re-baked, self-contained, a few
 *      tens of kB each (see assets/props/CREDITS.txt for provenance).
 *   2. PROCEDURAL PROPS   — twenty authored generators. They are the fallback
 *      for any missing GLB, AND they are theme set dressing in their own right:
 *      torches with a live flame and a point light, hanging chains, wind-blown
 *      banners and prayer flags, ice crystal clusters, lava vents, cable
 *      bundles, holo-signs and floating debris rocks. None of them is a
 *      primitive with a colour on it (see feedback_no_primitive_game_assets).
 *
 * Everything is instanced. Scatter is deterministic from a seeded RNG, so a
 * stage looks identical on every load and in every screenshot.
 *
 * PERF RULES ENFORCED HERE (feedback_forgeflow_games_fps):
 *   - every light embedded in a GLB is stripped on load; lights only ever come
 *     from the prop manifest, and only up to a per-call budget (default 8).
 *   - anything with a bounding radius < 0.75 m has castShadow FALSE.
 *   - one InstancedMesh per (prop, material) — never one Object3D per rock.
 *
 * @module runtime/world/props
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  getMaterial, getEmissive, getGlow,
  bevelBoxGeometry, boxGeometry, tubeGeometry, prismGeometry,
  ringGeometry, ringProfileGeometry, discGeometry, quadGeometry,
  capsuleGeometry, latheProfileGeometry,
} from './builders.js';
import { Mats } from './materials.js';

// ---------------------------------------------------------------------------
// module scratch — never allocate inside a build or update path
// ---------------------------------------------------------------------------
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _q0 = new THREE.Quaternion();
const _s0 = new THREE.Vector3(1, 1, 1);
const _m0 = new THREE.Matrix4();
const _box = new THREE.Box3();
const _YAXIS = new THREE.Vector3(0, 1, 0);

/** Shared animation clock for every animated prop material. */
const PROPS_TIME = { value: 0 };
let _timePinned = false;

/**
 * Pin the prop animation clock (deterministic capture). Pass null to unpin.
 * @param {number|null} t seconds
 */
export function setPropsTime(t) {
  if (t === null || t === undefined) { _timePinned = false; return; }
  _timePinned = true;
  PROPS_TIME.value = t;
}

function tickTime() {
  if (!_timePinned) {
    PROPS_TIME.value = (typeof performance !== 'undefined' ? performance.now() : Date.now()) * 0.001;
  }
}

/** mulberry32 — matches core/util.js so seeds are interchangeable. */
function mulberry32(seed) {
  let a = (seed | 0) >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// theme look — the colours the procedural set dresses itself in
// ---------------------------------------------------------------------------
const THEME_LOOK = {
  neon: {
    accent: 0x39d7ff, glow: 0x7ef0ff, flame: 0x46e2ff, ember: 0x2bb6ff,
    cloth: 0x1c4a7a, crystal: 0x6fe8ff, metal: 'metal', stone: 'panel', wood: 'panel',
    lightColor: 0x63d8ff, lightIntensity: 2.2, lightDistance: 11,
  },
  foundry: {
    accent: 0xff7a2a, glow: 0xffb03a, flame: 0xff8a2b, ember: 0xff4d15,
    cloth: 0x6b2a12, crystal: 0xff9a3c, metal: 'metal', stone: 'stone', wood: 'wood',
    lightColor: 0xff9448, lightIntensity: 2.8, lightDistance: 12,
  },
  spire: {
    accent: 0x8fd8ff, glow: 0xd8f4ff, flame: 0x9fe8ff, ember: 0x5fb8e8,
    cloth: 0x2b4c72, crystal: 0xbfeeff, metal: 'metal', stone: 'ice', wood: 'wood',
    lightColor: 0xa9e4ff, lightIntensity: 2.0, lightDistance: 10,
  },
  temple: {
    accent: 0xffd76a, glow: 0xffe9b0, flame: 0xffb347, ember: 0xff8c2e,
    cloth: 0x8c2f3a, crystal: 0xffe08a, metal: 'metal', stone: 'sand', wood: 'wood',
    lightColor: 0xffc477, lightIntensity: 2.5, lightDistance: 11,
  },
  hub: {
    accent: 0x6fe3c4, glow: 0xa8ffe6, flame: 0xffa64d, ember: 0xff7a2a,
    cloth: 0x24564a, crystal: 0x8ff0d4, metal: 'metal', stone: 'stone', wood: 'wood',
    lightColor: 0xffb268, lightIntensity: 2.3, lightDistance: 10,
  },
};

// --- CRESTBOUND realms (CONTRACT: keep / verdant / ember / rime / azure). The
// five Ascendant ids above are kept because the ported generators are written
// against them and the ported harnesses still address them by name.
THEME_LOOK.keep = {
  accent: 0xffd76a, glow: 0xffe9b0, flame: 0xffa64d, ember: 0xff7a2a,
  cloth: 0x6d2233, crystal: 0x9fd8ff, metal: 'metal', stone: 'stone', wood: 'wood',
  lightColor: 0xffc077, lightIntensity: 2.4, lightDistance: 11,
};
THEME_LOOK.verdant = {
  accent: 0x8fe06a, glow: 0xd9ffb8, flame: 0xffb347, ember: 0xff8c2e,
  cloth: 0x2f6b4a, crystal: 0x9ff0c4, metal: 'metal', stone: 'stone', wood: 'wood',
  lightColor: 0xffd9a0, lightIntensity: 2.1, lightDistance: 10,
};
THEME_LOOK.ember = {
  accent: 0xff7a2a, glow: 0xffb03a, flame: 0xff8a2b, ember: 0xff4d15,
  cloth: 0x6b2a12, crystal: 0xff9a3c, metal: 'metal', stone: 'stone', wood: 'wood',
  lightColor: 0xff9448, lightIntensity: 2.8, lightDistance: 12,
};
THEME_LOOK.rime = {
  accent: 0x8fd8ff, glow: 0xd8f4ff, flame: 0x9fe8ff, ember: 0x5fb8e8,
  cloth: 0x2b4c72, crystal: 0xbfeeff, metal: 'metal', stone: 'ice', wood: 'wood',
  lightColor: 0xa9e4ff, lightIntensity: 2.0, lightDistance: 10,
};
THEME_LOOK.azure = {
  accent: 0x59d8e8, glow: 0xbdf6ff, flame: 0x7fe6ff, ember: 0x2fa8c8,
  cloth: 0x16465c, crystal: 0x9ff0ff, metal: 'metal', stone: 'marble', wood: 'wood',
  lightColor: 0x9fe8ff, lightIntensity: 2.2, lightDistance: 11,
};

function look(themeId) { return THEME_LOOK[themeId] || THEME_LOOK.keep; }

// ---------------------------------------------------------------------------
// prop manifests
// ---------------------------------------------------------------------------
// `id`   file name in assets/props/<theme>/<id>.glb (unless procOnly)
// `h`    target size in metres — every prop is normalised to it, so a GLB
//        authored at any scale drops in correctly
// `fit`  which extent `h` measures: 'h' (default, the prop's HEIGHT) or 'max'
//        (its LARGEST extent). Flat, wide props — a coiled chain, a rope, a
//        rubble patch — MUST use 'max': normalising a 9 cm-tall coil to a 2.8 m
//        "height" scales it 31x into a 33 m sculpture
// `proc` procedural generator used as the fallback (and as the whole prop when
//        `procOnly` is set)
// `light` {color,intensity,distance,y01} — y01 is the light height as a
//        fraction of the prop height, so it survives normalisation
// `tags` 'clutter' | 'anchor' | 'hanging' | 'wide'
// ---------------------------------------------------------------------------
/** Hard ceiling on how far a source asset may be scaled UP to hit its target. */
const MAX_UPSCALE = 3.0;

const L_TORCH = { intensity: 2.6, distance: 10, y01: 0.92 };
const L_SOFT = { intensity: 1.6, distance: 7, y01: 0.7 };

const THEME_MANIFEST = {
  neon: [
    { id: 'crate', h: 1.10, proc: 'crate', tags: ['clutter'] },
    { id: 'crate_small', h: 0.45, proc: 'crate', params: { slats: 2 }, tags: ['clutter'] },
    { id: 'crate_tall', h: 0.70, proc: 'crate', params: { slats: 4, deep: 0.72 }, tags: ['clutter'] },
    { id: 'container', h: 0.62, proc: 'crate', params: { slats: 3, deep: 0.62, ribbed: true }, tags: ['clutter'] },
    { id: 'dumpster', h: 1.30, proc: 'crate', params: { slats: 3, deep: 0.75, lid: true }, tags: ['clutter'] },
    { id: 'coil', h: 0.55, fit: 'max', proc: 'chain', params: { coil: true }, tags: ['clutter'] },
    { id: 'chain', h: 2.60, proc: 'chain', procOnly: true, tags: ['hanging'] },
    { id: 'lantern', h: 0.95, proc: 'lantern', light: L_SOFT, tags: ['hanging'] },
    { id: 'cage', h: 0.90, proc: 'cage', tags: ['clutter'] },
    { id: 'holosign', h: 2.30, proc: 'holosign', procOnly: true, light: { intensity: 1.1, distance: 6, y01: 0.75 }, tags: ['anchor'] },
    { id: 'cables', h: 1.40, proc: 'cables', procOnly: true, tags: ['wide'] },
    { id: 'debris', h: 0.85, proc: 'debris', procOnly: true, tags: ['clutter'] },
  ],
  foundry: [
    { id: 'anvil', h: 0.62, proc: 'anvil', tags: ['clutter'] },
    { id: 'anvil_log', h: 1.05, proc: 'anvil', params: { block: true }, tags: ['clutter'] },
    { id: 'cauldron', h: 0.85, proc: 'barrel', params: { belly: 1.35, rim: true }, tags: ['clutter'] },
    { id: 'crate', h: 1.00, proc: 'crate', params: { ribbed: true }, tags: ['clutter'] },
    { id: 'barrel', h: 1.05, proc: 'barrel', tags: ['clutter'] },
    { id: 'bucket', h: 0.42, proc: 'barrel', params: { belly: 0.9, handle: true }, tags: ['clutter'] },
    { id: 'coil', h: 0.55, fit: 'max', proc: 'chain', params: { coil: true }, tags: ['clutter'] },
    { id: 'chain', h: 2.80, proc: 'chain', procOnly: true, tags: ['hanging'] },
    { id: 'torch', h: 0.80, proc: 'torch', light: L_TORCH, tags: ['anchor'] },
    { id: 'workbench', h: 0.95, proc: 'bench', params: { top: 2.0, heavy: true }, tags: ['wide'] },
    { id: 'pickaxe', h: 1.15, proc: 'tool', tags: ['clutter'] },
    { id: 'lavavent', h: 0.55, proc: 'lavavent', procOnly: true, light: { intensity: 3.0, distance: 9, y01: 0.5 }, tags: ['anchor'] },
    { id: 'cables', h: 1.40, proc: 'cables', procOnly: true, tags: ['wide'] },
    { id: 'debris', h: 0.80, proc: 'debris', procOnly: true, tags: ['clutter'] },
  ],
  spire: [
    { id: 'rubble', h: 0.62, fit: 'max', proc: 'rock', params: { chunks: 4 }, tags: ['clutter'] },
    { id: 'brick_a', h: 0.26, proc: 'rock', params: { chunks: 1 }, tags: ['clutter'] },
    { id: 'brick_b', h: 0.30, proc: 'rock', params: { chunks: 1 }, tags: ['clutter'] },
    { id: 'crate', h: 1.00, proc: 'crate', tags: ['clutter'] },
    { id: 'cage', h: 0.90, proc: 'cage', tags: ['clutter'] },
    { id: 'rope', h: 0.60, fit: 'max', proc: 'chain', params: { coil: true }, tags: ['clutter'] },
    { id: 'torch', h: 0.80, proc: 'torch', light: L_TORCH, tags: ['anchor'] },
    { id: 'coil', h: 0.55, fit: 'max', proc: 'chain', params: { coil: true }, tags: ['clutter'] },
    { id: 'chain', h: 2.80, proc: 'chain', procOnly: true, tags: ['hanging'] },
    { id: 'banner', h: 2.10, proc: 'banner', tags: ['anchor'] },
    { id: 'crystal', h: 1.60, proc: 'crystal', procOnly: true, light: { intensity: 1.4, distance: 8, y01: 0.55 }, tags: ['anchor'] },
    { id: 'flags', h: 1.10, proc: 'flags', procOnly: true, tags: ['wide'] },
    { id: 'debris', h: 0.75, proc: 'debris', procOnly: true, tags: ['clutter'] },
  ],
  temple: [
    { id: 'chandelier', h: 1.40, proc: 'lantern', params: { arms: 6, wide: 1.5 }, light: { intensity: 2.6, distance: 13, y01: 0.35 }, tags: ['hanging'] },
    { id: 'candles', h: 0.45, proc: 'torch', params: { candle: true }, light: { intensity: 0.9, distance: 5, y01: 0.95 }, tags: ['clutter'] },
    { id: 'candle_stand', h: 1.30, proc: 'torch', params: { candle: true, stand: true }, light: { intensity: 1.3, distance: 7, y01: 0.95 }, tags: ['anchor'] },
    { id: 'banner', h: 2.30, proc: 'banner', tags: ['anchor'] },
    { id: 'banner_alt', h: 1.95, proc: 'banner', params: { narrow: true }, tags: ['anchor'] },
    { id: 'chalice', h: 0.26, proc: 'barrel', params: { belly: 0.55, stem: true }, tags: ['clutter'] },
    { id: 'coins', h: 0.28, fit: 'max', proc: 'coins', tags: ['clutter'] },
    { id: 'urn', h: 0.52, proc: 'barrel', params: { belly: 1.3 }, tags: ['clutter'] },
    { id: 'urn_tall', h: 0.70, proc: 'barrel', params: { belly: 0.85, neck: true }, tags: ['clutter'] },
    { id: 'pot', h: 0.24, proc: 'barrel', params: { belly: 1.5 }, tags: ['clutter'] },
    { id: 'lantern', h: 0.95, proc: 'lantern', light: L_SOFT, tags: ['hanging'] },
    { id: 'arch_shelf', h: 1.60, proc: 'archway', tags: ['anchor'] },
    { id: 'brazier', h: 1.05, proc: 'brazier', procOnly: true, light: L_TORCH, tags: ['anchor'] },
    { id: 'flags', h: 1.10, proc: 'flags', procOnly: true, tags: ['wide'] },
    { id: 'debris', h: 0.70, proc: 'debris', procOnly: true, tags: ['clutter'] },
  ],
  hub: [
    { id: 'chest', h: 0.72, proc: 'crate', params: { lid: true, slats: 3 }, tags: ['clutter'] },
    { id: 'torch', h: 0.80, proc: 'torch', light: L_TORCH, tags: ['anchor'] },
    { id: 'banner', h: 2.30, proc: 'banner', tags: ['anchor'] },
    { id: 'crate', h: 1.00, proc: 'crate', tags: ['clutter'] },
    { id: 'barrel', h: 1.05, proc: 'barrel', tags: ['clutter'] },
    { id: 'bench', h: 0.55, proc: 'bench', params: { top: 2.6 }, tags: ['wide'] },
    { id: 'stool', h: 0.58, proc: 'bench', params: { top: 0.5, legs: 3 }, tags: ['clutter'] },
    { id: 'bookcase', h: 2.50, proc: 'shelf', tags: ['anchor'] },
    { id: 'lantern', h: 0.95, proc: 'lantern', light: L_SOFT, tags: ['hanging'] },
    { id: 'coins', h: 0.28, fit: 'max', proc: 'coins', tags: ['clutter'] },
    { id: 'brazier', h: 1.05, proc: 'brazier', procOnly: true, light: L_TORCH, tags: ['anchor'] },
    { id: 'pillar', h: 2.60, proc: 'pillar', procOnly: true, tags: ['anchor'] },
    { id: 'statue', h: 2.20, proc: 'statue', procOnly: true, tags: ['anchor'] },
    { id: 'cables', h: 1.40, proc: 'cables', procOnly: true, tags: ['wide'] },
  ],
};

// --- CRESTBOUND manifests ---------------------------------------------------
// THE KEEP is the only theme with curated GLBs on disk
// (assets/props/keep/*.glb: banner barrel bench bookcase chest coins crate
// lantern stool torch). Every other realm is procedural, which is deliberate:
// a realm's deco has to match its palette exactly, and a generator can be
// tinted per theme where a baked asset cannot.
THEME_MANIFEST.keep = [
  { id: 'torch', h: 0.80, proc: 'torch', light: L_TORCH, tags: ['anchor'] },
  { id: 'lantern', h: 0.95, proc: 'lantern', light: L_SOFT, tags: ['hanging'] },
  { id: 'banner', h: 2.30, proc: 'banner', tags: ['anchor'] },
  { id: 'barrel', h: 1.05, proc: 'barrel', tags: ['clutter'] },
  { id: 'crate', h: 1.00, proc: 'crate', tags: ['clutter'] },
  { id: 'chest', h: 0.72, proc: 'crate', params: { lid: true, slats: 3 }, tags: ['clutter'] },
  { id: 'bench', h: 0.55, fit: 'max', proc: 'bench', params: { top: 2.4 }, tags: ['wide'] },
  { id: 'stool', h: 0.58, proc: 'bench', params: { top: 0.5, legs: 3 }, tags: ['clutter'] },
  { id: 'bookcase', h: 2.50, proc: 'shelf', tags: ['anchor'] },
  { id: 'coins', h: 0.28, fit: 'max', proc: 'coins', tags: ['clutter'] },
  { id: 'brazier', h: 1.05, proc: 'brazier', procOnly: true, light: L_TORCH, tags: ['anchor'] },
  { id: 'pillar', h: 2.60, proc: 'pillar', procOnly: true, tags: ['anchor'] },
  { id: 'statue', h: 2.20, proc: 'statue', procOnly: true, tags: ['anchor'] },
  { id: 'flagpole', h: 4.60, proc: 'flagpole', procOnly: true, tags: ['anchor'] },
];
THEME_MANIFEST.verdant = [
  { id: 'mushroom', h: 0.55, proc: 'mushroom', procOnly: true, tags: ['clutter'] },
  { id: 'mushroom_ring', h: 0.70, fit: 'max', proc: 'mushroom', params: { count: 5 }, procOnly: true, tags: ['wide'] },
  { id: 'flowerbed', h: 1.10, fit: 'max', proc: 'flowerbed', procOnly: true, tags: ['wide'] },
  { id: 'bush', h: 0.80, proc: 'bush', procOnly: true, tags: ['clutter'] },
  { id: 'bush_small', h: 0.48, proc: 'bush', params: { lobes: 3, berries: false }, procOnly: true, tags: ['clutter'] },
  { id: 'stump', h: 0.60, proc: 'stump', procOnly: true, tags: ['clutter'] },
  { id: 'rock', h: 0.62, fit: 'max', proc: 'rock', params: { chunks: 4 }, tags: ['clutter'] },
  { id: 'crate', h: 1.00, proc: 'crate', tags: ['clutter'] },
  { id: 'barrel', h: 1.05, proc: 'barrel', tags: ['clutter'] },
  { id: 'banner', h: 2.20, proc: 'banner', tags: ['anchor'] },
  { id: 'torch', h: 0.80, proc: 'torch', light: L_TORCH, tags: ['anchor'] },
  { id: 'flagpole', h: 4.20, proc: 'flagpole', procOnly: true, tags: ['anchor'] },
  { id: 'cart', h: 0.95, fit: 'max', proc: 'bench', params: { top: 1.9, heavy: true }, procOnly: true, tags: ['wide'] },
];
THEME_MANIFEST.ember = [
  { id: 'lavaRock', h: 0.70, fit: 'max', proc: 'lavaRock', procOnly: true, light: { intensity: 1.2, distance: 6, y01: 0.3 }, tags: ['clutter'] },
  { id: 'lavavent', h: 0.55, proc: 'lavavent', procOnly: true, light: { intensity: 3.0, distance: 9, y01: 0.5 }, tags: ['anchor'] },
  { id: 'gear', h: 1.20, fit: 'max', proc: 'gear', procOnly: true, tags: ['anchor'] },
  { id: 'gear_small', h: 0.60, fit: 'max', proc: 'gear', params: { teeth: 10, spokes: 4, r: 0.34 }, procOnly: true, tags: ['clutter'] },
  { id: 'pipe', h: 2.60, fit: 'max', proc: 'pipe', procOnly: true, tags: ['wide'] },
  { id: 'anvil', h: 0.62, proc: 'anvil', tags: ['clutter'] },
  { id: 'barrel', h: 1.05, proc: 'barrel', tags: ['clutter'] },
  { id: 'crate', h: 1.00, proc: 'crate', params: { ribbed: true }, tags: ['clutter'] },
  { id: 'chain', h: 2.80, proc: 'chain', procOnly: true, tags: ['hanging'] },
  { id: 'torch', h: 0.80, proc: 'torch', light: L_TORCH, tags: ['anchor'] },
  { id: 'brazier', h: 1.05, proc: 'brazier', procOnly: true, light: L_TORCH, tags: ['anchor'] },
  { id: 'cactus', h: 1.75, proc: 'cactus', procOnly: true, tags: ['anchor'] },
  { id: 'sandstone', h: 1.40, proc: 'sandstone', procOnly: true, tags: ['anchor'] },
  { id: 'debris', h: 0.80, proc: 'debris', procOnly: true, tags: ['clutter'] },
];
THEME_MANIFEST.rime = [
  { id: 'icicle', h: 1.00, fit: 'max', proc: 'icicle', procOnly: true, tags: ['hanging'] },
  { id: 'icicle_fringe', h: 1.60, fit: 'max', proc: 'icicle', params: { count: 12, spread: 0.9 }, procOnly: true, tags: ['hanging'] },
  { id: 'snowdrift', h: 1.30, fit: 'max', proc: 'snowdrift', procOnly: true, tags: ['wide'] },
  { id: 'crystal', h: 1.60, proc: 'crystal', procOnly: true, light: { intensity: 1.4, distance: 8, y01: 0.55 }, tags: ['anchor'] },
  { id: 'rock', h: 0.62, fit: 'max', proc: 'rock', params: { chunks: 4 }, tags: ['clutter'] },
  { id: 'stump', h: 0.55, proc: 'stump', params: { moss: false }, procOnly: true, tags: ['clutter'] },
  { id: 'crate', h: 1.00, proc: 'crate', tags: ['clutter'] },
  { id: 'banner', h: 2.10, proc: 'banner', tags: ['anchor'] },
  { id: 'lantern', h: 0.95, proc: 'lantern', light: L_SOFT, tags: ['hanging'] },
  { id: 'torch', h: 0.80, proc: 'torch', light: L_TORCH, tags: ['anchor'] },
  { id: 'chain', h: 2.60, proc: 'chain', procOnly: true, tags: ['hanging'] },
  { id: 'flagpole', h: 4.40, proc: 'flagpole', procOnly: true, tags: ['anchor'] },
];
THEME_MANIFEST.azure = [
  { id: 'crystal', h: 1.50, proc: 'crystal', procOnly: true, light: { intensity: 1.5, distance: 9, y01: 0.55 }, tags: ['anchor'] },
  { id: 'gear', h: 1.20, fit: 'max', proc: 'gear', procOnly: true, tags: ['anchor'] },
  { id: 'gear_small', h: 0.58, fit: 'max', proc: 'gear', params: { teeth: 12, spokes: 4, r: 0.32 }, procOnly: true, tags: ['clutter'] },
  { id: 'pipe', h: 2.40, fit: 'max', proc: 'pipe', procOnly: true, tags: ['wide'] },
  { id: 'pillar', h: 2.80, proc: 'pillar', procOnly: true, tags: ['anchor'] },
  { id: 'statue', h: 2.20, proc: 'statue', procOnly: true, tags: ['anchor'] },
  { id: 'archway', h: 1.70, proc: 'archway', procOnly: true, tags: ['anchor'] },
  { id: 'coins', h: 0.28, fit: 'max', proc: 'coins', tags: ['clutter'] },
  { id: 'lantern', h: 0.95, proc: 'lantern', light: L_SOFT, tags: ['hanging'] },
  { id: 'banner', h: 2.30, proc: 'banner', tags: ['anchor'] },
  { id: 'cables', h: 1.40, fit: 'max', proc: 'cables', procOnly: true, tags: ['wide'] },
  { id: 'flowerbed', h: 0.90, fit: 'max', proc: 'flowerbed', params: { petal: 0x9ff0ff, petal2: 0x59d8e8 }, procOnly: true, tags: ['wide'] },
];

// ---------------------------------------------------------------------------
// animated materials
// ---------------------------------------------------------------------------
const _matCache = new Map();

/**
 * Per-instance phase preamble. `instanceMatrix` only exists under
 * USE_INSTANCING, so a single-instance prop falls back to a zero phase.
 */
const PHASE_GLSL = [
  '#ifdef USE_INSTANCING',
  '  vec3 aInstOff = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);',
  '#else',
  '  vec3 aInstOff = vec3(0.0);',
  '#endif',
  'float aPhase = dot(aInstOff, vec3(0.731, 0.271, 0.517));',
].join('\n');

/**
 * Cloth that moves. A standard PBR material with a wind displacement injected in
 * the vertex stage: the sway grows with height above `base` so the hanging edge
 * whips and the mounted edge stays pinned.
 */
function clothMaterial(color, wind, base, height) {
  const key = 'cloth' + color + ':' + wind + ':' + base + ':' + height;
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    color, roughness: 0.86, metalness: 0.0, side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = PROPS_TIME;
    sh.uniforms.uWind = { value: new THREE.Vector3(wind, base, Math.max(0.001, height)) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec3 uWind;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n' + PHASE_GLSL + '\n' +
        'float wT = clamp((position.y - uWind.y) / uWind.z, 0.0, 1.0);\n' +
        'float wA = pow(wT, 1.6) * uWind.x;\n' +
        'transformed.x += sin(uTime * 2.10 + aPhase + position.y * 2.7) * wA;\n' +
        'transformed.z += cos(uTime * 1.63 + aPhase * 1.7 + position.x * 2.1) * wA * 0.75;\n' +
        'transformed.y -= wA * 0.22 * wT;');
  };
  m.customProgramCacheKey = () => 'crestbound-cloth';
  m.name = 'prop_cloth';
  _matCache.set(key, m);
  return m;
}

/**
 * Flame. Additive, unlit, depth-tested but not depth-writing, with a scrolling
 * value-noise gradient and a per-instance phase so a row of torches never
 * flickers in lockstep.
 */
function flameMaterial(inner, outer, speed) {
  const key = 'flame' + inner + ':' + outer + ':' + speed;
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: PROPS_TIME,
      uInner: { value: new THREE.Color(inner) },
      uOuter: { value: new THREE.Color(outer) },
      uSpeed: { value: speed },
    },
    vertexShader: [
      'varying vec2 vFuv;',
      'varying float vPh;',
      'uniform float uTime;',
      'void main(){',
      '  vFuv = uv;',
      PHASE_GLSL,
      '  vPh = aPhase;',
      '  vec3 tp = position;',
      '  float t = clamp(uv.y, 0.0, 1.0);',
      '  tp.x += sin(uTime * 6.1 + aPhase + t * 5.0) * 0.045 * t;',
      '  tp.z += cos(uTime * 5.3 + aPhase * 1.3 + t * 4.2) * 0.045 * t;',
      '  tp.y += sin(uTime * 7.7 + aPhase) * 0.018 * t;',
      '  #ifdef USE_INSTANCING',
      '    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(tp, 1.0);',
      '  #else',
      '    gl_Position = projectionMatrix * modelViewMatrix * vec4(tp, 1.0);',
      '  #endif',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime, uSpeed;',
      'uniform vec3 uInner, uOuter;',
      'varying vec2 vFuv;',
      'varying float vPh;',
      'float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
      'float vn(vec2 p){',
      '  vec2 i = floor(p), f = fract(p);',
      '  f = f * f * (3.0 - 2.0 * f);',
      '  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x),',
      '             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);',
      '}',
      'void main(){',
      '  float t = clamp(vFuv.y, 0.0, 1.0);',
      '  float n = vn(vec2(vFuv.x * 5.0, vFuv.y * 3.4 - uTime * uSpeed + vPh));',
      '  n = n * 0.55 + vn(vec2(vFuv.x * 11.0 + 3.0, vFuv.y * 7.0 - uTime * uSpeed * 1.7)) * 0.45;',
      '  float body = smoothstep(0.92, 0.10, t) * (0.55 + n * 0.75);',
      '  float core = smoothstep(0.62, 0.0, t);',
      '  float a = clamp(body - (1.0 - n) * t * 0.85, 0.0, 1.0);',
      '  if (a < 0.02) discard;',
      '  vec3 c = mix(uOuter, uInner, clamp(core + n * 0.35, 0.0, 1.0));',
      '  gl_FragColor = vec4(c * (0.9 + a * 1.4), a);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  m.name = 'prop_flame';
  _matCache.set(key, m);
  return m;
}

/** Holographic panel: emissive with scrolling scanlines and an edge falloff. */
function holoMaterial(color, speed) {
  const key = 'holo' + color + ':' + speed;
  let m = _matCache.get(key);
  if (m) return m;
  m = new THREE.ShaderMaterial({
    uniforms: { uTime: PROPS_TIME, uColor: { value: new THREE.Color(color) }, uSpeed: { value: speed } },
    vertexShader: [
      'varying vec2 vH;',
      'void main(){',
      '  vH = uv;',
      '  #ifdef USE_INSTANCING',
      '    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);',
      '  #else',
      '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '  #endif',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform float uTime, uSpeed; uniform vec3 uColor;',
      'varying vec2 vH;',
      'void main(){',
      '  float scan = 0.55 + 0.45 * sin((vH.y * 60.0) - uTime * uSpeed * 6.0);',
      '  float sweep = smoothstep(0.0, 0.35, abs(fract(vH.y - uTime * uSpeed * 0.22) - 0.5));',
      '  vec2 e = abs(vH * 2.0 - 1.0);',
      '  float edge = 1.0 - smoothstep(0.80, 1.0, max(e.x, e.y));',
      '  float a = edge * (0.30 + 0.32 * scan + 0.22 * (1.0 - sweep));',
      '  if (a < 0.02) discard;',
      '  gl_FragColor = vec4(uColor * (1.1 + a), a);',
      '}',
    ].join('\n'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  m.name = 'prop_holo';
  _matCache.set(key, m);
  return m;
}

/** Rock that drifts. Standard PBR with a slow per-instance bob and tumble-lean. */
function driftMaterial(baseKey, themeId, amp, speed) {
  const key = 'drift' + baseKey + themeId + ':' + amp + ':' + speed;
  let m = _matCache.get(key);
  if (m) return m;
  const src = getMaterial(baseKey, { id: themeId }, null);
  m = src.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = PROPS_TIME;
    sh.uniforms.uDrift = { value: new THREE.Vector2(amp, speed) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform vec2 uDrift;')
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\n' + PHASE_GLSL + '\n' +
        'transformed.y += sin(uTime * uDrift.y + aPhase) * uDrift.x;\n' +
        'float dR = sin(uTime * uDrift.y * 0.43 + aPhase * 2.1) * 0.10;\n' +
        'transformed.xz = mat2(cos(dR), -sin(dR), sin(dR), cos(dR)) * transformed.xz;');
  };
  m.customProgramCacheKey = () => 'crestbound-drift';
  m.name = 'prop_drift';
  _matCache.set(key, m);
  return m;
}

// ---------------------------------------------------------------------------
// geometry helpers local to props
// ---------------------------------------------------------------------------
/**
 * A tube swept along a catenary between two points — cables, ropes, flag lines.
 * `sag` is the drop at mid-span in metres.
 */
function catenaryGeometry(ax, ay, az, bx, by, bz, sag, radius, segs, sides) {
  const S = Math.max(2, segs || 10);
  const parts = [];
  let px = ax, py = ay, pz = az;
  for (let i = 1; i <= S; i++) {
    const t = i / S;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t - Math.sin(Math.PI * t) * sag;
    const z = az + (bz - az) * t;
    const dx = x - px, dy = y - py, dz = z - pz;
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-5) {
      const g = tubeGeometry(radius, radius, len, sides || 6, 1.2);
      _v0.set(dx / len, dy / len, dz / len);
      _q0.setFromUnitVectors(_YAXIS, _v0);
      _v1.set((x + px) * 0.5, (y + py) * 0.5, (z + pz) * 0.5);
      _s0.set(1, 1, 1);
      _m0.compose(_v1, _q0, _s0);
      g.applyMatrix4(_m0);
      parts.push(g);
    }
    px = x; py = y; pz = z;
  }
  return parts.length ? (parts.length === 1 ? parts[0] : mergeGeometries(parts, false)) : null;
}

/** Place a geometry with an arbitrary transform (build time only). */
function put(geo, x, y, z, rx, ry, rz, sx, sy, sz) {
  _v0.set(x || 0, y || 0, z || 0);
  _q0.setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0));
  const u = sx === undefined ? 1 : sx;
  _s0.set(u, sy === undefined ? u : sy, sz === undefined ? u : sz);
  _m0.compose(_v0, _q0, _s0);
  geo.applyMatrix4(_m0);
  return geo;
}

/** Faceted low-poly rock — the base shape for rubble, bricks and debris. */
function rockGeometry(radius, seed, roughness) {
  const rnd = mulberry32(seed);
  const g = prismGeometry(radius, radius * 1.5, 7, 1.0);
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  // displace by a per-direction hash so identical seeds give identical rocks
  const key = new Map();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = Math.round(x * 40) + ':' + Math.round(y * 40) + ':' + Math.round(z * 40);
    let d = key.get(k);
    if (d === undefined) { d = 1 + (rnd() - 0.5) * roughness; key.set(k, d); }
    pos.setXYZ(i, x * d, y * d * 0.72, z * d);
  }
  pos.needsUpdate = true;
  nrm.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// PROCEDURAL PROP GENERATORS
// ---------------------------------------------------------------------------
// Each returns { parts:[{geometry, material}], animated:bool }.
// Built at natural scale; the loader normalises them to the manifest height.
// ---------------------------------------------------------------------------
/**
 * Material service override. Props normally resolve their materials through
 * `Mats` (the CONTRACT §14 bank of real PBR bakes) the moment somebody has
 * initialised it — but ONLY then: touching `Mats.get` before `Mats.init()` would
 * force every texture bake at prop-build time, which is exactly the wrong moment
 * (a harness or a Node validator would pay for 33 canvas bakes it never renders).
 * Until then a prop wears builders.js's fallback bank, which covers the same key
 * set. `setPropsMaterials()` lets a caller pin a service explicitly.
 */
let _matsService = null;

/**
 * Pin (or clear, with null) the material service every procedural prop resolves
 * against. Call it once after `Mats.init(renderer)`; props built BEFORE the call
 * keep the materials they were built with.
 * @param {object|null} service
 */
export function setPropsMaterials(service) {
  _matsService = (service && typeof service.get === 'function') ? service : null;
}

function activeMats() {
  if (_matsService) return _matsService;
  // `ready` is a getter that does NOT trigger a bake — the safe probe.
  try { if (Mats && Mats.ready) return Mats; } catch (e) { /* bank unavailable */ }
  return null;
}

function mat(key, themeId) { return getMaterial(key, { id: themeId }, activeMats()); }

/** Wall torch (or a candle, with params.candle) — bracket, shaft, flame, ember. */
function procTorch(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const parts = [];
  const steel = mat('metal', themeId);
  const wood = mat(p.candle ? 'sand' : L.wood, themeId);
  const emb = getEmissive(L.ember, 2.4);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  if (p.stand) {
    // floor candle stand: stepped base + slim column
    add(put(tubeGeometry(0.14, 0.22, 0.07, 12, 1.2), 0, 0.035, 0), steel);
    add(put(tubeGeometry(0.10, 0.15, 0.05, 12, 1.2), 0, 0.09, 0), steel);
    add(put(tubeGeometry(0.035, 0.05, 0.85, 10, 1.0), 0, 0.53, 0), steel);
    add(put(ringProfileGeometry(0.07, [0.022, 0.016, 0.006], 14, 1.4), 0, 0.60, 0), steel);
    add(put(tubeGeometry(0.10, 0.07, 0.045, 12, 1.4), 0, 0.975, 0), steel);
    add(put(tubeGeometry(0.038, 0.042, 0.22, 10, 1.6), 0, 1.10, 0), wood);
  } else if (p.candle) {
    add(put(tubeGeometry(0.09, 0.12, 0.035, 12, 1.4), 0, 0.018, 0), steel);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(put(tubeGeometry(0.026, 0.030, 0.26, 8, 1.6),
        Math.cos(a) * 0.055, 0.16, Math.sin(a) * 0.055), wood);
    }
  } else {
    // wall bracket + haft
    add(put(bevelBoxGeometry(0.10, 0.26, 0.07, 0.02, 1.2), 0, 0.13, -0.10), steel);
    add(put(bevelBoxGeometry(0.05, 0.05, 0.24, 0.012, 1.6), 0, 0.235, 0.02, 0.36, 0, 0), steel);
    add(put(tubeGeometry(0.032, 0.042, 0.46, 8, 1.2), 0, 0.44, 0.12, 0.30, 0, 0), wood);
    // iron cup
    add(put(tubeGeometry(0.085, 0.055, 0.13, 12, 1.4), 0, 0.66, 0.185, 0.30, 0, 0), steel);
    add(put(ringProfileGeometry(0.085, [0.016, 0.012, 0.005], 14, 1.6), 0, 0.715, 0.20, 0.30, 0, 0), steel);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      add(put(boxGeometry(0.012, 0.11, 0.012, 2.0),
        Math.cos(a) * 0.075, 0.66, 0.185 + Math.sin(a) * 0.075 * 0.95, 0.30, 0, 0), steel);
    }
  }

  // ember bed + flame
  const flameY = p.stand ? 1.22 : p.candle ? 0.31 : 0.755;
  const flameX = p.candle ? 0 : 0;
  const flameZ = p.stand || p.candle ? 0 : 0.215;
  const scale = p.candle ? 0.42 : 1;
  add(put(tubeGeometry(0.035 * scale, 0.055 * scale, 0.02, 10, 2.0), flameX, flameY - 0.03, flameZ), emb);
  const flame = flameMaterial(0xfff0c0, L.flame, 1.5);
  const cone = tubeGeometry(0.0, 0.085 * scale, 0.36 * scale, 9, 1);
  // remap UV.y to 0 (base) .. 1 (tip) for the flame gradient
  {
    const pos = cone.attributes.position, uv = cone.attributes.uv;
    const h = 0.36 * scale;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, uv.getX(i), (pos.getY(i) + h * 0.5) / h);
    uv.needsUpdate = true;
  }
  add(put(cone, flameX, flameY + 0.16 * scale, flameZ), flame);
  const cone2 = tubeGeometry(0.0, 0.05 * scale, 0.22 * scale, 7, 1);
  {
    const pos = cone2.attributes.position, uv = cone2.attributes.uv;
    const h = 0.22 * scale;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, uv.getX(i), (pos.getY(i) + h * 0.5) / h);
    uv.needsUpdate = true;
  }
  add(put(cone2, flameX, flameY + 0.10 * scale, flameZ), flame);
  return { parts, animated: true };
}

/** Standing brazier — three legs, a bowl, glowing coals and a flame. */
function procBrazier(themeId, o) {
  const L = look(themeId);
  const parts = [];
  const steel = mat('metal', themeId);
  const dark = mat('obsidian', themeId);
  const coal = getEmissive(L.ember, 2.8);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    add(put(bevelBoxGeometry(0.055, 0.72, 0.055, 0.012, 1.2),
      Math.cos(a) * 0.20, 0.36, Math.sin(a) * 0.20, 0.20 * Math.sin(a), -a, 0.20 * Math.cos(a)), steel);
    add(put(bevelBoxGeometry(0.10, 0.05, 0.16, 0.014, 1.4),
      Math.cos(a) * 0.26, 0.025, Math.sin(a) * 0.26, 0, -a, 0), steel);
  }
  add(put(ringProfileGeometry(0.19, [0.028, 0.022, 0.008], 12, 1.4), 0, 0.40, 0), steel);
  add(put(tubeGeometry(0.40, 0.20, 0.24, 20, 1.0), 0, 0.82, 0), steel);
  add(put(ringProfileGeometry(0.40, [0.035, 0.030, 0.012], 16, 1.2), 0, 0.94, 0), steel);
  add(put(tubeGeometry(0.34, 0.20, 0.14, 20, 1.6), 0, 0.82, 0), dark);
  const rnd = mulberry32(0x5eed);
  for (let i = 0; i < 9; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.26;
    add(put(rockGeometry(0.05 + rnd() * 0.03, 700 + i, 0.5),
      Math.cos(a) * r, 0.90, Math.sin(a) * r, rnd(), rnd() * 6.28, rnd()), coal);
  }
  const flame = flameMaterial(0xfff2cc, L.flame, 1.35);
  for (let i = 0; i < 2; i++) {
    const h = 0.62 - i * 0.20;
    const g = tubeGeometry(0.0, 0.26 - i * 0.09, h, 10, 1);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < pos.count; k++) uv.setXY(k, uv.getX(k), (pos.getY(k) + h * 0.5) / h);
    uv.needsUpdate = true;
    add(put(g, 0, 0.94 + h * 0.42, 0), flame);
  }
  return { parts, animated: true };
}

/** Hanging lantern / chandelier — frame, glass, a warm core, and a chain. */
function procLantern(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const arms = p.arms || 0;
  const wide = p.wide || 1;
  const parts = [];
  const steel = mat('metal', themeId);
  const glass = mat('glass', themeId);
  const core = getEmissive(L.glow, 2.6);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  // hanging chain above
  for (let i = 0; i < 4; i++) {
    add(put(ringProfileGeometry(0.028, [0.009, 0.009, 0.003], 8, 2.0),
      0, 1.12 + i * 0.055, 0, i % 2 ? Math.PI * 0.5 : 0, 0, Math.PI * 0.5), steel);
  }
  add(put(tubeGeometry(0.05, 0.10, 0.09, 10, 1.4), 0, 1.06, 0), steel);

  if (arms > 0) {
    // chandelier: a hub, radial arms and a candle cup at each tip
    add(put(tubeGeometry(0.07, 0.10, 0.16, 12, 1.2), 0, 0.92, 0), steel);
    add(put(ringProfileGeometry(0.34 * wide, [0.024, 0.018, 0.007], 26, 1.2), 0, 0.72, 0), steel);
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2;
      const cx = Math.cos(a) * 0.34 * wide, cz = Math.sin(a) * 0.34 * wide;
      add(put(bevelBoxGeometry(0.34 * wide, 0.028, 0.028, 0.008, 1.4), cx * 0.5, 0.86, cz * 0.5, 0, -a, -0.42), steel);
      add(put(tubeGeometry(0.026, 0.026, 0.30, 8, 1.4), cx, 0.86, cz), steel);
      add(put(tubeGeometry(0.055, 0.038, 0.05, 10, 1.6), cx, 1.02, cz), steel);
      add(put(tubeGeometry(0.030, 0.034, 0.10, 8, 1.8), cx, 1.09, cz), mat('sand', themeId));
      const g = tubeGeometry(0.0, 0.05, 0.20, 8, 1);
      const pos = g.attributes.position, uv = g.attributes.uv;
      for (let k = 0; k < pos.count; k++) uv.setXY(k, uv.getX(k), (pos.getY(k) + 0.10) / 0.20);
      uv.needsUpdate = true;
      add(put(g, cx, 1.24, cz), flameMaterial(0xfff0c0, L.flame, 1.5));
    }
    add(put(tubeGeometry(0.10, 0.0, 0.18, 12, 1.4), 0, 0.60, 0), steel);
    add(put(tubeGeometry(0.13, 0.13, 0.02, 14, 1.6), 0, 0.80, 0), core);
    return { parts, animated: true };
  }

  // box lantern: four posts, capped top and bottom, glass in between
  const hw = 0.115, hh = 0.30;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI * 0.25;
    add(put(bevelBoxGeometry(0.020, hh * 2, 0.020, 0.005, 2.0),
      Math.cos(a) * hw, 0.62, Math.sin(a) * hw, 0, -a, 0), steel);
  }
  add(put(tubeGeometry(0.05, 0.175, 0.14, 4, 1.2), 0, 0.98, 0, 0, Math.PI * 0.25, 0), steel);
  add(put(tubeGeometry(0.165, 0.150, 0.055, 4, 1.4), 0, 0.34, 0, 0, Math.PI * 0.25, 0), steel);
  add(put(tubeGeometry(0.108, 0.108, hh * 1.85, 4, 1.0), 0, 0.62, 0, 0, Math.PI * 0.25, 0), glass);
  add(put(tubeGeometry(0.055, 0.055, 0.20, 8, 1.6), 0, 0.60, 0), core);
  add(put(ringProfileGeometry(0.125, [0.014, 0.010, 0.004], 4, 1.8), 0, 0.905, 0, 0, Math.PI * 0.25, 0), steel);
  add(put(ringProfileGeometry(0.125, [0.014, 0.010, 0.004], 4, 1.8), 0, 0.372, 0, 0, Math.PI * 0.25, 0), steel);
  return { parts, animated: false };
}

/** Hanging chain (or a coiled rope, with params.coil). */
function procChain(themeId, o) {
  const p = o || {};
  const parts = [];
  const steel = mat('metal', themeId);
  const rope = mat(look(themeId).wood, themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  if (p.coil) {
    const turns = 3;
    for (let i = 0; i < turns; i++) {
      const r = 0.26 - i * 0.045;
      add(put(ringProfileGeometry(r, [0.032, 0.030, 0.012], 22, 1.2), 0, 0.035 + i * 0.055, 0), rope);
    }
    add(put(ringProfileGeometry(0.10, [0.030, 0.028, 0.011], 16, 1.4), 0.08, 0.22, 0.05, 0.5, 0.7, 0), rope);
    return { parts, animated: false };
  }

  // pitch must be under 2*(major - tube) or the links stop interlocking and the
  // chain reads as a string of beads
  const links = p.links || 24;
  const pitch = p.pitch || 0.088;
  for (let i = 0; i < links; i++) {
    add(put(ringProfileGeometry(0.062, [0.017, 0.030, 0.007], 8, 1.6),
      0, 2.6 - i * pitch, 0, Math.PI * 0.5, (i % 2) * Math.PI * 0.5, 0), steel);
  }
  add(put(bevelBoxGeometry(0.16, 0.05, 0.09, 0.014, 1.4), 0, 2.66, 0), steel);
  add(put(tubeGeometry(0.045, 0.075, 0.10, 10, 1.4), 0, 2.6 - links * pitch - 0.04, 0), steel);
  return { parts, animated: false };
}

/** Banner: a pole, a cross bar, finials and a wind-driven cloth. */
function procBanner(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const w = p.narrow ? 0.55 : 0.78;
  const h = 1.55;
  const parts = [];
  const steel = mat('metal', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  add(put(bevelBoxGeometry(w + 0.24, 0.05, 0.05, 0.014, 1.4), 0, 2.22, 0), steel);
  for (const s of [-1, 1]) {
    add(put(prismGeometry(0.045, 0.07, 6, 2.0), s * (w * 0.5 + 0.14), 2.22, 0), steel);
  }
  add(put(bevelBoxGeometry(0.06, 0.34, 0.06, 0.016, 1.4), 0, 2.38, 0), steel);
  for (let i = 0; i < 5; i++) {
    add(put(ringProfileGeometry(0.024, [0.008, 0.010, 0.003], 8, 2.0),
      -w * 0.4 + (w * 0.8 * i) / 4, 2.19, 0, Math.PI * 0.5, 0, 0), steel);
  }

  // cloth: a subdivided plane so the wind shader has vertices to move
  const cols = 6, rows = 10;
  const cloth = new THREE.PlaneGeometry(w, h, cols, rows).toNonIndexed();
  cloth.deleteAttribute('tangent');
  put(cloth, 0, 2.16 - h * 0.5, 0.012);
  add(cloth, clothMaterial(p.color || L.cloth, 0.075, 2.16 - h, h));

  // hem band + a chevron so the banner reads as heraldry, not a bedsheet
  const hem = new THREE.PlaneGeometry(w, 0.10, cols, 1).toNonIndexed();
  hem.deleteAttribute('tangent');
  put(hem, 0, 2.16 - h + 0.05, 0.016);
  add(hem, clothMaterial(L.accent, 0.075, 2.16 - h, h));
  const chev = new THREE.PlaneGeometry(w * 0.52, w * 0.52, 2, 2).toNonIndexed();
  chev.deleteAttribute('tangent');
  put(chev, 0, 2.16 - h * 0.42, 0.018, 0, 0, Math.PI * 0.25);
  add(chev, clothMaterial(L.accent, 0.06, 2.16 - h, h));
  return { parts, animated: true };
}

/** A string of prayer flags on a catenary line. */
function procFlags(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const span = p.span || 5.2;
  const sag = p.sag || 0.75;
  const n = p.count || 9;
  const parts = [];
  const steel = mat('metal', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  const line = catenaryGeometry(-span * 0.5, 1.45, 0, span * 0.5, 1.45, 0, sag, 0.014, 14, 5);
  if (line) add(line, steel);
  for (const s of [-1, 1]) {
    add(put(tubeGeometry(0.035, 0.055, 1.45, 8, 1.0), s * span * 0.5, 0.725, 0), steel);
    add(put(prismGeometry(0.075, 0.05, 6, 1.6), s * span * 0.5, 0.025, 0), steel);
  }
  const tints = [L.accent, L.cloth, L.glow, L.crystal, L.ember];
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const x = -span * 0.5 + span * t;
    const y = 1.45 - Math.sin(Math.PI * t) * sag;
    const flag = new THREE.PlaneGeometry(0.30, 0.40, 2, 4).toNonIndexed();
    flag.deleteAttribute('tangent');
    put(flag, x, y - 0.22, 0, 0, (i % 2 ? 0.12 : -0.12), 0);
    add(flag, clothMaterial(tints[i % tints.length], 0.055, y - 0.44, 0.44));
  }
  return { parts, animated: true };
}

/** Ice / energy crystal cluster: faceted spikes, a glowing heart, a rubble base. */
function procCrystal(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const parts = [];
  const shard = mat('crystal', themeId);
  const glow = getEmissive(L.crystal, 2.2);
  const base = mat(L.stone === 'ice' ? 'ice' : 'obsidian', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0xc0ffee : p.seed);

  add(put(rockGeometry(0.36, 91, 0.55), 0, 0.10, 0, 0, 0.6, 0, 1, 0.55, 1), base);
  const n = p.count || 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
    const r = 0.06 + rnd() * 0.24;
    const hgt = 0.45 + rnd() * 1.05;
    const rad = 0.055 + rnd() * 0.09;
    const lean = 0.10 + rnd() * 0.30;
    const g = tubeGeometry(0.0, rad, hgt, 5, 1.0);
    add(put(g, Math.cos(a) * r, 0.14 + hgt * 0.42, Math.sin(a) * r,
      Math.sin(a) * lean, -a, -Math.cos(a) * lean), shard);
    if (rnd() > 0.45) {
      const g2 = tubeGeometry(0.0, rad * 0.42, hgt * 0.45, 5, 1.4);
      add(put(g2, Math.cos(a) * (r + 0.10), 0.12 + hgt * 0.20, Math.sin(a) * (r + 0.10),
        Math.sin(a) * lean * 1.5, -a, -Math.cos(a) * lean * 1.5), glow);
    }
  }
  add(put(tubeGeometry(0.0, 0.10, 0.30, 6, 1.2), 0, 0.30, 0), glow);
  return { parts, animated: false };
}

/** Lava vent: a cracked stone collar, a glowing throat and a heat shimmer. */
function procLavaVent(themeId, o) {
  const L = look(themeId);
  const parts = [];
  const rock = mat('obsidian', themeId);
  const hot = getEmissive(L.ember, 3.2);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(0x1a7a);

  add(put(tubeGeometry(0.52, 0.72, 0.16, 14, 0.9), 0, 0.08, 0), rock);
  add(put(tubeGeometry(0.40, 0.52, 0.20, 14, 1.0), 0, 0.24, 0), rock);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.4;
    add(put(rockGeometry(0.16 + rnd() * 0.09, 300 + i, 0.6),
      Math.cos(a) * 0.58, 0.14, Math.sin(a) * 0.58, rnd() * 0.5, rnd() * 6.28, rnd() * 0.5), rock);
  }
  add(put(ringGeometry(0.0, 0.40, 22, 0.8), 0, 0.33, 0), hot);
  add(put(ringProfileGeometry(0.41, [0.03, 0.02, 0.008], 22, 1.4), 0, 0.335, 0), hot);
  // flame plume
  const flame = flameMaterial(0xffe0a0, L.flame, 0.9);
  for (let i = 0; i < 2; i++) {
    const h = 1.15 - i * 0.4;
    const g = tubeGeometry(0.0, 0.30 - i * 0.10, h, 9, 1);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < pos.count; k++) uv.setXY(k, uv.getX(k), (pos.getY(k) + h * 0.5) / h);
    uv.needsUpdate = true;
    add(put(g, 0, 0.34 + h * 0.45, 0), flame);
  }
  return { parts, animated: true };
}

/** Cable bundle: three sagging catenaries between two braced anchors. */
function procCables(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const span = p.span || 6.0;
  const parts = [];
  const steel = mat('metal', themeId);
  const jacket = mat('rubber', themeId);
  const trim = getEmissive(L.accent, 1.4);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  for (const s of [-1, 1]) {
    add(put(bevelBoxGeometry(0.22, 0.36, 0.26, 0.03, 1.0), s * span * 0.5, 1.24, 0), steel);
    add(put(bevelBoxGeometry(0.30, 0.10, 0.34, 0.02, 1.2), s * span * 0.5, 1.42, 0), steel);
    add(put(boxGeometry(0.26, 0.02, 0.30, 1.4), s * span * 0.5, 1.475, 0), trim);
    add(put(tubeGeometry(0.055, 0.085, 1.06, 8, 1.0), s * span * 0.5, 0.53, 0), steel);
    add(put(prismGeometry(0.16, 0.05, 6, 1.4), s * span * 0.5, 0.025, 0), steel);
  }
  const offs = [[0, 0.06, 0.05], [0, 0.0, -0.06], [0, -0.055, 0.0]];
  for (let i = 0; i < offs.length; i++) {
    const g = catenaryGeometry(
      -span * 0.5 + 0.08, 1.30 + offs[i][1], offs[i][2],
      span * 0.5 - 0.08, 1.30 + offs[i][1], offs[i][2],
      0.42 + i * 0.07, 0.035, 12, 6);
    if (g) add(g, jacket);
  }
  // service clamps
  for (let i = 1; i < 4; i++) {
    const t = i / 4;
    const x = -span * 0.5 + span * t;
    const y = 1.30 - Math.sin(Math.PI * t) * 0.49;
    add(put(ringProfileGeometry(0.085, [0.020, 0.030, 0.007], 10, 1.6), x, y, 0, 0, 0, Math.PI * 0.5), steel);
  }
  return { parts, animated: false };
}

/** Holo-sign: a machined post, a bezel, and an animated scanline panel. */
function procHoloSign(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const w = p.w || 1.35, h = p.h || 0.85;
  const parts = [];
  const steel = mat('metal', themeId);
  const panel = mat('panel', themeId);
  const trim = getEmissive(L.accent, 1.9);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  add(put(prismGeometry(0.22, 0.07, 8, 1.2), 0, 0.035, 0), steel);
  add(put(tubeGeometry(0.055, 0.085, 1.25, 10, 1.0), 0, 0.66, 0), steel);
  add(put(ringProfileGeometry(0.095, [0.022, 0.018, 0.006], 12, 1.6), 0, 1.20, 0), steel);
  const cy = 1.28 + h * 0.5;
  add(put(bevelBoxGeometry(w, h, 0.07, 0.02, 0.9), 0, cy, 0), panel);
  add(put(bevelBoxGeometry(w + 0.09, 0.055, 0.10, 0.016, 1.2), 0, cy + h * 0.5 + 0.02, 0), steel);
  add(put(bevelBoxGeometry(w + 0.09, 0.055, 0.10, 0.016, 1.2), 0, cy - h * 0.5 - 0.02, 0), steel);
  for (const s of [-1, 1]) {
    add(put(bevelBoxGeometry(0.055, h + 0.09, 0.10, 0.016, 1.2), s * (w * 0.5 + 0.02), cy, 0), steel);
    add(put(boxGeometry(0.016, h * 0.86, 0.02, 1.6), s * (w * 0.5 + 0.055), cy, 0.05), trim);
  }
  const holo = new THREE.PlaneGeometry(w * 0.9, h * 0.82, 1, 1).toNonIndexed();
  holo.deleteAttribute('tangent');
  put(holo, 0, cy, 0.045);
  add(holo, holoMaterial(L.glow, 1.0));
  const holoBack = new THREE.PlaneGeometry(w * 0.9, h * 0.82, 1, 1).toNonIndexed();
  holoBack.deleteAttribute('tangent');
  put(holoBack, 0, cy, -0.045, 0, Math.PI, 0);
  add(holoBack, holoMaterial(L.glow, 1.0));
  return { parts, animated: true };
}

/** Floating debris: faceted rocks that bob and lean on the drift shader. */
function procDebris(themeId, o) {
  const p = o || {};
  const parts = [];
  const rockMat = driftMaterial(look(themeId).stone === 'ice' ? 'ice' : 'stone', themeId, 0.11, 0.85);
  const shard = driftMaterial('obsidian', themeId, 0.11, 0.85);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0xd3b21 : p.seed);
  const n = p.count || 4;
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.55;
    const s = 0.16 + rnd() * 0.26;
    add(put(rockGeometry(s, 5100 + i * 13, 0.7),
      Math.cos(a) * r, 0.32 + rnd() * 0.5, Math.sin(a) * r,
      rnd() * 6.28, rnd() * 6.28, rnd() * 6.28), i % 3 === 0 ? shard : rockMat);
  }
  return { parts, animated: true };
}

/** Slatted crate / shipping container / chest. */
function procCrate(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const w = p.w || 0.9, h = p.h || 0.9, d = p.deep || 0.9;
  const slats = p.slats || 3;
  const parts = [];
  const body = mat(p.ribbed ? 'panel' : L.wood, themeId);
  const steel = mat('metal', themeId);
  const trim = getEmissive(L.accent, 0.9);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  add(put(bevelBoxGeometry(w * 0.94, h * 0.94, d * 0.94, 0.02, 1.0), 0, h * 0.5, 0), body);
  // corner posts
  const CS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let i = 0; i < 4; i++) {
    add(put(bevelBoxGeometry(0.075, h, 0.075, 0.014, 1.4),
      CS[i][0] * (w * 0.5 - 0.035), h * 0.5, CS[i][1] * (d * 0.5 - 0.035)), steel);
  }
  // slats / ribs
  for (let i = 0; i < slats; i++) {
    const y = h * ((i + 0.5) / slats);
    add(put(bevelBoxGeometry(w * 0.98, h / slats * 0.42, 0.032, 0.008, 1.8), 0, y, d * 0.5 - 0.006), steel);
    add(put(bevelBoxGeometry(w * 0.98, h / slats * 0.42, 0.032, 0.008, 1.8), 0, y, -d * 0.5 + 0.006), steel);
    add(put(bevelBoxGeometry(0.032, h / slats * 0.42, d * 0.98, 0.008, 1.8), w * 0.5 - 0.006, y, 0), steel);
    add(put(bevelBoxGeometry(0.032, h / slats * 0.42, d * 0.98, 0.008, 1.8), -w * 0.5 + 0.006, y, 0), steel);
  }
  // lid or top frame
  if (p.lid) {
    add(put(bevelBoxGeometry(w * 1.02, 0.10, d * 1.02, 0.022, 1.0), 0, h + 0.05, 0), body);
    add(put(bevelBoxGeometry(w * 1.04, 0.035, 0.09, 0.010, 1.6), 0, h + 0.10, 0), steel);
    add(put(bevelBoxGeometry(0.14, 0.08, 0.05, 0.014, 1.8), 0, h * 0.62, d * 0.5 + 0.02), steel);
  } else {
    add(put(bevelBoxGeometry(w, 0.055, d, 0.014, 1.2), 0, h - 0.02, 0), steel);
  }
  add(put(boxGeometry(w * 0.42, 0.014, 0.02, 1.6), 0, h * 0.5, d * 0.5 + 0.02), trim);
  add(put(bevelBoxGeometry(w * 1.02, 0.045, d * 1.02, 0.012, 1.2), 0, 0.022, 0), steel);
  return { parts, animated: false };
}

/** Staved vessel — barrel, urn, pot, cauldron, chalice, bucket. */
function procBarrel(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const belly = p.belly === undefined ? 1.0 : p.belly;
  const h = p.h || 0.95;
  const r = (p.r || 0.32) * belly;
  const parts = [];
  const body = mat(p.metal ? 'metal' : L.wood, themeId);
  const steel = mat('metal', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  if (p.stem) {
    add(put(tubeGeometry(0.055, 0.11, 0.03, 12, 1.4), 0, 0.015, 0), steel);
    add(put(tubeGeometry(0.024, 0.030, 0.09, 8, 1.6), 0, 0.08, 0), steel);
    add(put(tubeGeometry(0.095, 0.045, 0.13, 12, 1.4), 0, 0.19, 0), steel);
    add(put(ringProfileGeometry(0.095, [0.014, 0.010, 0.004], 14, 1.8), 0, 0.252, 0), steel);
    return { parts, animated: false };
  }

  // barrel: three stacked stave rings so the silhouette bulges
  const bands = [
    [r * 0.86, 0.00, h * 0.28],
    [r * 1.00, h * 0.28, h * 0.44],
    [r * 0.86, h * 0.72, h * 0.28],
  ];
  add(put(tubeGeometry(bands[1][0], bands[0][0], bands[0][2], 14, 0.9), 0, bands[0][1] + bands[0][2] * 0.5, 0), body);
  add(put(tubeGeometry(bands[1][0], bands[1][0], bands[1][2], 14, 0.9), 0, bands[1][1] + bands[1][2] * 0.5, 0), body);
  add(put(tubeGeometry(bands[2][0], bands[1][0], bands[2][2], 14, 0.9), 0, bands[2][1] + bands[2][2] * 0.5, 0), body);
  if (p.neck) {
    add(put(tubeGeometry(r * 0.42, r * 0.80, h * 0.26, 12, 1.2), 0, h * 1.02, 0), body);
    add(put(ringProfileGeometry(r * 0.46, [0.022, 0.016, 0.006], 14, 1.6), 0, h * 1.14, 0), steel);
  }
  for (const t of [0.16, 0.5, 0.86]) {
    add(put(ringProfileGeometry(r * (t === 0.5 ? 1.02 : 0.90), [0.020, 0.030, 0.008], 12, 1.4), 0, h * t, 0), steel);
  }
  if (p.rim) {
    add(put(ringProfileGeometry(r * 0.92, [0.035, 0.026, 0.010], 12, 1.4), 0, h * 0.99, 0), steel);
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(put(bevelBoxGeometry(0.05, h * 0.42, 0.05, 0.012, 1.4),
        Math.cos(a) * r * 0.86, -h * 0.16, Math.sin(a) * r * 0.86, 0.18 * Math.sin(a), -a, 0.18 * Math.cos(a)), steel);
    }
  }
  if (p.handle) {
    const g = catenaryGeometry(-r * 0.85, h * 0.92, 0, r * 0.85, h * 0.92, 0, -h * 0.42, 0.018, 8, 5);
    if (g) add(g, steel);
  }
  return { parts, animated: false };
}

/** Rubble / bricks — one to several faceted chunks. */
function procRock(themeId, o) {
  const p = o || {};
  const chunks = p.chunks || 3;
  const parts = [];
  const stone = mat(look(themeId).stone === 'ice' ? 'ice' : 'stone', themeId);
  const dark = mat('obsidian', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0x20cc : p.seed);
  for (let i = 0; i < chunks; i++) {
    const a = rnd() * Math.PI * 2, r = chunks === 1 ? 0 : Math.sqrt(rnd()) * 0.22;
    const s = (chunks === 1 ? 0.20 : 0.10 + rnd() * 0.10);
    add(put(rockGeometry(s, 880 + i * 31, 0.62),
      Math.cos(a) * r, s * 0.62, Math.sin(a) * r,
      (rnd() - 0.5) * 0.7, rnd() * 6.28, (rnd() - 0.5) * 0.7), i % 4 === 3 ? dark : stone);
  }
  return { parts, animated: false };
}

/** Barred cage. */
function procCage(themeId, o) {
  const p = o || {};
  const r = p.r || 0.36, h = p.h || 0.80;
  const parts = [];
  const steel = mat('metal', themeId);
  const dark = mat('obsidian', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(tubeGeometry(r * 1.05, r * 1.10, 0.07, 14, 1.0), 0, 0.035, 0), dark);
  add(put(ringProfileGeometry(r, [0.028, 0.022, 0.008], 12, 1.2), 0, 0.09, 0), steel);
  add(put(ringProfileGeometry(r, [0.028, 0.022, 0.008], 12, 1.2), 0, h * 0.55, 0), steel);
  add(put(ringProfileGeometry(r * 0.94, [0.030, 0.026, 0.009], 12, 1.2), 0, h, 0), steel);
  const bars = 9;
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2;
    add(put(tubeGeometry(0.016, 0.016, h - 0.06, 5, 1.6),
      Math.cos(a) * r, 0.06 + (h - 0.06) * 0.5, Math.sin(a) * r), steel);
  }
  add(put(tubeGeometry(0.02, 0.05, 0.10, 8, 1.4), 0, h + 0.05, 0), steel);
  add(put(ringProfileGeometry(0.05, [0.012, 0.016, 0.004], 10, 1.8), 0, h + 0.14, 0, Math.PI * 0.5, 0, 0), steel);
  return { parts, animated: false };
}

/** Plank furniture — bench, stool, workbench. */
function procBench(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const top = p.top || 1.8;
  const h = p.h || 0.52;
  const depth = p.depth || (top < 0.8 ? top : 0.52);
  const legs = p.legs || 4;
  const parts = [];
  const wood = mat(L.wood, themeId);
  const steel = mat('metal', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });

  const planks = Math.max(2, Math.round(depth / 0.18));
  for (let i = 0; i < planks; i++) {
    const z = -depth * 0.5 + depth * ((i + 0.5) / planks);
    add(put(bevelBoxGeometry(top, p.heavy ? 0.09 : 0.055, depth / planks * 0.88, 0.012, 1.0), 0, h, z), wood);
  }
  if (p.heavy) {
    add(put(bevelBoxGeometry(top * 1.02, 0.05, depth * 1.04, 0.012, 1.0), 0, h - 0.075, 0), steel);
  }
  if (legs === 3) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      add(put(tubeGeometry(0.032, 0.045, h, 7, 1.2),
        Math.cos(a) * top * 0.32, h * 0.5, Math.sin(a) * depth * 0.32,
        0.10 * Math.sin(a), -a, 0.10 * Math.cos(a)), wood);
    }
    add(put(ringProfileGeometry(top * 0.30, [0.018, 0.014, 0.005], 12, 1.4), 0, h * 0.34, 0), steel);
  } else {
    const CS = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (let i = 0; i < 4; i++) {
      add(put(bevelBoxGeometry(0.075, h, 0.075, 0.014, 1.2),
        CS[i][0] * (top * 0.5 - 0.10), h * 0.5, CS[i][1] * (depth * 0.5 - 0.08)), wood);
    }
    for (const s of [-1, 1]) {
      add(put(bevelBoxGeometry(top - 0.16, 0.05, 0.05, 0.012, 1.4), 0, h * 0.32, s * (depth * 0.5 - 0.08)), wood);
    }
    add(put(bevelBoxGeometry(0.05, 0.05, depth - 0.12, 0.012, 1.4), 0, h * 0.32, 0), wood);
  }
  if (p.heavy) {
    add(put(bevelBoxGeometry(0.30, 0.14, 0.22, 0.02, 1.2), top * 0.30, h + 0.12, 0), steel);
    add(put(prismGeometry(0.07, 0.05, 6, 1.6), -top * 0.30, h + 0.06, 0.06), steel);
  }
  return { parts, animated: false };
}

/** Shelving unit / bookcase. */
function procShelf(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const w = p.w || 1.30, h = p.h || 2.30, d = p.deep || 0.40;
  const shelves = p.shelves || 4;
  const parts = [];
  const wood = mat(L.wood, themeId);
  const steel = mat('metal', themeId);
  const trim = getEmissive(L.accent, 0.7);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(0xb00c);

  for (const s of [-1, 1]) {
    add(put(bevelBoxGeometry(0.07, h, d, 0.016, 0.9), s * (w * 0.5 - 0.035), h * 0.5, 0), wood);
  }
  add(put(bevelBoxGeometry(w, 0.06, d, 0.014, 0.9), 0, 0.03, 0), wood);
  add(put(bevelBoxGeometry(w * 1.05, 0.09, d * 1.08, 0.02, 0.9), 0, h - 0.045, 0), wood);
  add(put(bevelBoxGeometry(w - 0.10, h - 0.12, 0.035, 0.010, 1.0), 0, h * 0.5, -d * 0.5 + 0.02), wood);
  for (let i = 1; i < shelves; i++) {
    const y = (h - 0.12) * (i / shelves) + 0.06;
    add(put(bevelBoxGeometry(w - 0.10, 0.045, d - 0.04, 0.010, 1.0), 0, y, 0), wood);
    add(put(boxGeometry(w - 0.14, 0.012, 0.018, 1.4), 0, y + 0.03, d * 0.5 - 0.03), trim);
    // a row of books, deterministic
    let x = -w * 0.5 + 0.12;
    while (x < w * 0.5 - 0.14) {
      const bw = 0.055 + rnd() * 0.055;
      const bh = 0.20 + rnd() * 0.13;
      add(put(bevelBoxGeometry(bw, bh, d * 0.62, 0.006, 2.0), x + bw * 0.5, y + 0.022 + bh * 0.5, 0.02,
        0, 0, (rnd() > 0.88 ? 0.24 : 0)), rnd() > 0.5 ? steel : wood);
      x += bw + 0.006;
    }
  }
  return { parts, animated: false };
}

/** Anvil / heavy forge block. */
function procAnvil(themeId, o) {
  const p = o || {};
  const parts = [];
  const steel = mat('metal', themeId);
  const wood = mat(look(themeId).wood, themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  let y0 = 0;
  if (p.block) {
    add(put(tubeGeometry(0.30, 0.34, 0.42, 12, 0.9), 0, 0.21, 0), wood);
    add(put(ringProfileGeometry(0.31, [0.022, 0.026, 0.008], 16, 1.4), 0, 0.38, 0), steel);
    y0 = 0.42;
  }
  add(put(bevelBoxGeometry(0.44, 0.10, 0.26, 0.02, 1.0), 0, y0 + 0.05, 0), steel);
  add(put(bevelBoxGeometry(0.24, 0.14, 0.17, 0.02, 1.2), 0, y0 + 0.17, 0), steel);
  add(put(bevelBoxGeometry(0.56, 0.13, 0.24, 0.025, 1.0), 0, y0 + 0.30, 0), steel);
  add(put(tubeGeometry(0.02, 0.10, 0.26, 8, 1.2), 0.38, y0 + 0.30, 0, 0, 0, Math.PI * 0.5), steel);
  add(put(bevelBoxGeometry(0.10, 0.10, 0.20, 0.02, 1.4), -0.31, y0 + 0.30, 0), steel);
  add(put(prismGeometry(0.028, 0.05, 4, 2.0), -0.14, y0 + 0.38, 0), steel);
  return { parts, animated: false };
}

/** A leaning tool — pickaxe / hammer. */
function procTool(themeId, o) {
  const parts = [];
  const steel = mat('metal', themeId);
  const wood = mat(look(themeId).wood, themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(tubeGeometry(0.026, 0.034, 1.05, 8, 1.0), 0, 0.52, 0, 0, 0, 0.14), wood);
  add(put(bevelBoxGeometry(0.10, 0.09, 0.09, 0.018, 1.6), -0.075, 1.02, 0, 0, 0, 0.14), steel);
  add(put(tubeGeometry(0.012, 0.052, 0.34, 6, 1.4), -0.075, 1.02, 0, Math.PI * 0.5, 0, 1.35), steel);
  add(put(tubeGeometry(0.012, 0.052, 0.34, 6, 1.4), -0.075, 1.02, 0, Math.PI * 0.5, 0, -1.35), steel);
  add(put(ringProfileGeometry(0.030, [0.010, 0.014, 0.004], 8, 1.8), 0.055, 0.20, 0, Math.PI * 0.5, 0, 0.14), steel);
  return { parts, animated: false };
}

/** Pile of coins. */
function procCoins(themeId, o) {
  const L = look(themeId);
  const parts = [];
  const gold = getEmissive(L.accent, 0.55);
  const metal = mat('metal', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(0xc0125);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.13;
    const y = 0.006 + rnd() * 0.055;
    add(put(tubeGeometry(0.032, 0.032, 0.008, 10, 3.0),
      Math.cos(a) * r, y, Math.sin(a) * r, (rnd() - 0.5) * 0.5, rnd() * 6.28, (rnd() - 0.5) * 0.5),
      i % 3 === 0 ? metal : gold);
  }
  return { parts, animated: false };
}

/** Small decorative pillar. */
function procPillar(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const h = p.h || 2.4, r = p.r || 0.26;
  const parts = [];
  const stone = mat(L.stone === 'ice' ? 'ice' : L.stone, themeId);
  const steel = mat('metal', themeId);
  const trim = getEmissive(L.accent, 1.3);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(bevelBoxGeometry(r * 3.0, 0.14, r * 3.0, 0.03, 0.8), 0, 0.07, 0), stone);
  add(put(bevelBoxGeometry(r * 2.5, 0.10, r * 2.5, 0.025, 0.9), 0, 0.19, 0), stone);
  add(put(tubeGeometry(r * 0.86, r, h - 0.55, 12, 0.8), 0, 0.24 + (h - 0.55) * 0.5, 0), stone);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    add(put(bevelBoxGeometry(0.035, (h - 0.70) * 0.92, 0.06, 0.008, 1.4),
      Math.cos(a) * r * 0.97, 0.30 + (h - 0.70) * 0.46, Math.sin(a) * r * 0.97, 0, -a, 0), steel);
  }
  add(put(ringProfileGeometry(r * 1.04, [0.030, 0.030, 0.010], 16, 1.4), 0, h - 0.60, 0), steel);
  add(put(ringProfileGeometry(r * 1.10, [0.010, 0.018, 0.004], 16, 1.8), 0, h - 0.60, 0), trim);
  add(put(bevelBoxGeometry(r * 2.4, 0.10, r * 2.4, 0.025, 0.9), 0, h - 0.24, 0), stone);
  add(put(bevelBoxGeometry(r * 2.9, 0.12, r * 2.9, 0.03, 0.8), 0, h - 0.11, 0), stone);
  add(put(boxGeometry(r * 2.7, 0.014, r * 2.7, 1.2), 0, h - 0.045, 0), trim);
  return { parts, animated: false };
}

/** Plinth statue — an abstract guardian silhouette, no faces to get wrong. */
function procStatue(themeId, o) {
  const L = look(themeId);
  const parts = [];
  const stone = mat(L.stone === 'ice' ? 'ice' : L.stone, themeId);
  const dark = mat('obsidian', themeId);
  const trim = getEmissive(L.accent, 1.5);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(bevelBoxGeometry(0.86, 0.16, 0.86, 0.035, 0.8), 0, 0.08, 0), stone);
  add(put(bevelBoxGeometry(0.72, 0.44, 0.72, 0.03, 0.9), 0, 0.38, 0), stone);
  add(put(bevelBoxGeometry(0.80, 0.08, 0.80, 0.02, 1.0), 0, 0.64, 0), dark);
  add(put(boxGeometry(0.74, 0.014, 0.74, 1.2), 0, 0.685, 0), trim);
  // torso + shoulders + head, all chamfered blocks
  add(put(tubeGeometry(0.20, 0.28, 0.62, 8, 1.0), 0, 0.99, 0), stone);
  add(put(bevelBoxGeometry(0.62, 0.16, 0.30, 0.035, 1.0), 0, 1.34, 0), stone);
  add(put(bevelBoxGeometry(0.22, 0.24, 0.22, 0.045, 1.4), 0, 1.54, 0), stone);
  add(put(boxGeometry(0.16, 0.030, 0.02, 1.6), 0, 1.56, 0.11), trim);
  for (const s of [-1, 1]) {
    add(put(bevelBoxGeometry(0.13, 0.52, 0.13, 0.025, 1.2), s * 0.30, 1.06, 0, 0, 0, s * 0.10), stone);
    add(put(prismGeometry(0.075, 0.08, 6, 1.6), s * 0.30, 1.38, 0), dark);
  }
  // a staff
  add(put(tubeGeometry(0.025, 0.030, 1.42, 7, 1.0), 0.34, 1.18, 0.10, 0, 0, 0.06), dark);
  add(put(tubeGeometry(0.0, 0.075, 0.20, 6, 1.4), 0.30, 1.94, 0.10), trim);
  return { parts, animated: false };
}

/** A small archway / niche shelf. */
function procArchway(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const w = p.w || 1.15, h = p.h || 1.55, d = p.deep || 0.30;
  const parts = [];
  const stone = mat(L.stone === 'ice' ? 'ice' : L.stone, themeId);
  const steel = mat('metal', themeId);
  const trim = getEmissive(L.accent, 1.2);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const pier = w * 0.18;
  const rise = Math.min(h * 0.42, (w - pier * 2) * 0.5);
  const pierH = h - rise;
  for (const s of [-1, 1]) {
    add(put(bevelBoxGeometry(pier, pierH, d, 0.02, 0.9), s * (w * 0.5 - pier * 0.5), pierH * 0.5, 0), stone);
    add(put(bevelBoxGeometry(pier * 1.3, 0.07, d * 1.15, 0.015, 1.2), s * (w * 0.5 - pier * 0.5), 0.035, 0), steel);
  }
  const R = (w - pier * 2) * 0.5;
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N;
    const a = Math.PI * t;
    const ang = Math.atan2(Math.cos(a) * rise, Math.sin(a) * R);
    add(put(bevelBoxGeometry((Math.PI * R) / N * 1.08, 0.24, d, 0.018, 1.0),
      -Math.cos(a) * R, pierH + Math.sin(a) * rise, 0, 0, 0, -ang + Math.PI * 0.5), stone);
  }
  add(put(bevelBoxGeometry(0.22, 0.34, d * 1.10, 0.025, 1.2), 0, pierH + rise + 0.04, 0), steel);
  add(put(bevelBoxGeometry(w - pier * 2 + 0.06, 0.045, d * 0.55, 0.010, 1.2), 0, pierH - 0.02, 0), stone);
  add(put(boxGeometry(w - pier * 2, 0.014, d * 0.5, 1.4), 0, pierH + 0.01, 0), trim);
  return { parts, animated: false };
}

// ===========================================================================
// CRESTBOUND REALM DECO — CONTRACT §20
// ===========================================================================
// Ascendant was five indoor arenas; CRESTBOUND is four outdoor realms plus a
// hub, so the procedural set needs a botany and a geology as well as a props
// department. Every generator below follows the same house rules as the ported
// ones: multi-part, no naked primitive, deterministic from its seed, built at
// natural scale and normalised by `makeEntry`.
// ===========================================================================

/** A tapered blade/leaf card built as a 3-segment tube — cheap, and it bends. */
function bladeParts(add, material, x, z, len, rad, lean, yaw, bend) {
  const SEG = 3;
  let cy = 0, lx = 0, lz = 0;
  for (let i = 0; i < SEG; i++) {
    const t = i / SEG;
    const sl = len / SEG;
    const r0 = rad * (1 - t), r1 = rad * (1 - (i + 1) / SEG);
    const tilt = lean + bend * t;
    const g = tubeGeometry(Math.max(0.002, r1), Math.max(0.002, r0), sl, 4, 1.6);
    add(put(g, x + lx, cy + sl * 0.5, z + lz, Math.sin(yaw) * tilt, yaw, -Math.cos(yaw) * tilt), material);
    lx += Math.sin(yaw) * Math.sin(tilt) * sl;
    lz += Math.cos(yaw) * Math.sin(tilt) * sl * -1;
    cy += sl * Math.cos(tilt);
  }
}

/**
 * MUSHROOM — a fluted stalk with a bulbous foot, a domed cap turned on a lathe,
 * real radial gills underneath and speckle plates on the crown. Realms that own
 * a glow colour get an emissive gill ring, which is what makes a verdant grove
 * or an azure grotto read at night.
 */
function procMushroom(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0x5ee0 : p.seed);
  const stalkMat = mat(p.stalk || 'plaster', themeId);
  const capMat = mat(p.capMat || 'cloth', themeId);
  const gillMat = getEmissive(p.glowColor === undefined ? L.glow : p.glowColor, p.glow === false ? 0.35 : 1.5);
  const spotMat = mat('plaster', themeId);

  const n = p.count || 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.9;
    const rr = i === 0 ? 0 : 0.16 + rnd() * 0.24;
    const scale = i === 0 ? 1 : 0.42 + rnd() * 0.42;
    const px = Math.cos(a) * rr, pz = Math.sin(a) * rr;
    const H = (0.42 + rnd() * 0.22) * scale;
    const CR = (0.30 + rnd() * 0.10) * scale;

    // stalk: bulb foot -> waist -> flare under the cap
    add(put(latheProfileGeometry([
      [0, 0], [CR * 0.42, 0], [CR * 0.40, H * 0.10], [CR * 0.26, H * 0.34],
      [CR * 0.24, H * 0.72], [CR * 0.34, H * 0.94], [CR * 0.30, H],
    ], 12, 1.2), px, 0, pz), stalkMat);
    // annulus (the skirt)
    add(put(ringProfileGeometry(CR * 0.40, [0.030, 0.016, 0.006], 14, 1.6), px, H * 0.72, pz), stalkMat);
    // cap: a real dome, not a squashed sphere
    add(put(latheProfileGeometry([
      [0, H], [CR * 0.55, H - CR * 0.06], [CR * 0.86, H - CR * 0.20], [CR, H - CR * 0.40],
      [CR * 0.97, H - CR * 0.46], [CR * 0.70, H - CR * 0.30], [CR * 0.34, H - CR * 0.16], [0, H - CR * 0.12],
    ], 16, 1.1), px, 0, pz), capMat);
    // radial gills
    const gills = 14;
    for (let k = 0; k < gills; k++) {
      const ga = (k / gills) * Math.PI * 2;
      add(put(boxGeometry(CR * 0.62, 0.010, 0.012, 2.2),
        px + Math.cos(ga) * CR * 0.46, H - CR * 0.26, pz + Math.sin(ga) * CR * 0.46, 0, -ga, 0), gillMat);
    }
    // crown speckles
    const spots = 5 + Math.floor(rnd() * 4);
    for (let k = 0; k < spots; k++) {
      const sa = rnd() * Math.PI * 2;
      const sr = Math.sqrt(rnd()) * CR * 0.68;
      const sy = H - CR * 0.06 - (sr / CR) * (sr / CR) * CR * 0.34;
      add(put(prismGeometry(CR * (0.06 + rnd() * 0.06), 0.012, 7, 2.4),
        px + Math.cos(sa) * sr, sy + 0.006, pz + Math.sin(sa) * sr), spotMat);
    }
  }
  return { parts, animated: false };
}

/**
 * FLOWERBED — a low soil mound, grass tufts and five to nine flowers, each a
 * stem, a petal ring of individually rotated cards and a turned centre boss.
 * Wide, so its manifest entry measures by `fit:'max'`.
 */
function procFlowerbed(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0xf10a : p.seed);
  const soil = mat('dirt', themeId);
  const leaf = mat('leaves', themeId);
  const petalA = getEmissive(p.petal === undefined ? L.accent : p.petal, 0.55);
  const petalB = getEmissive(p.petal2 === undefined ? L.glow : p.petal2, 0.55);
  const boss = getEmissive(0xffd76a, 1.0);

  // soil mound
  add(put(rockGeometry(0.52, 4411, 0.30), 0, 0.05, 0, 0, 0, 0, 1, 0.30, 1), soil);
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2, r = 0.28 + rnd() * 0.22;
    add(put(rockGeometry(0.14 + rnd() * 0.08, 500 + i * 17, 0.5),
      Math.cos(a) * r, 0.035, Math.sin(a) * r, 0, rnd() * 6.28, 0, 1, 0.32, 1), soil);
  }
  // grass tufts
  for (let i = 0; i < 11; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.46;
    bladeParts(add, leaf, Math.cos(a) * r, Math.sin(a) * r,
      0.16 + rnd() * 0.16, 0.016, 0.15 + rnd() * 0.25, rnd() * 6.28, 0.5 + rnd() * 0.6);
  }
  // flowers
  const flowers = p.flowers || (5 + Math.floor(rnd() * 5));
  for (let i = 0; i < flowers; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.42;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const H = 0.22 + rnd() * 0.20;
    const lean = (rnd() - 0.5) * 0.35;
    const pm = rnd() > 0.5 ? petalA : petalB;
    add(put(tubeGeometry(0.010, 0.016, H, 5, 1.6), x + lean * H * 0.4, H * 0.5, z, lean, rnd() * 6.28, lean * 0.6), leaf);
    // two side leaves
    bladeParts(add, leaf, x, z, H * 0.55, 0.014, 0.9, rnd() * 6.28, 0.4);
    const pr = 0.055 + rnd() * 0.03;
    const petals = 5 + (rnd() > 0.6 ? 1 : 0);
    for (let k = 0; k < petals; k++) {
      const pa = (k / petals) * Math.PI * 2 + rnd() * 0.2;
      add(put(latheProfileGeometry([[0, 0], [pr * 0.55, 0.004], [pr * 0.35, 0.018], [0, 0.024]], 6, 3.0),
        x + lean * H * 0.8 + Math.cos(pa) * pr * 0.85, H + 0.012, z + Math.sin(pa) * pr * 0.85,
        Math.sin(pa) * 0.5, 0, -Math.cos(pa) * 0.5), pm);
    }
    add(put(latheProfileGeometry([[0, 0], [pr * 0.34, 0.006], [pr * 0.24, 0.022], [0, 0.030]], 8, 3.0),
      x + lean * H * 0.8, H + 0.012, z), boss);
  }
  return { parts, animated: false };
}

/** BUSH — four to six noisy foliage masses over a short woody stem. */
function procBush(themeId, o) {
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0xb005 : p.seed);
  const leaf = mat('leaves', themeId);
  const bark = mat('bark', themeId);
  const berryMat = getEmissive(p.berry === undefined ? look(themeId).accent : p.berry, 0.9);

  add(put(tubeGeometry(0.045, 0.075, 0.20, 6, 1.4), 0, 0.10, 0), bark);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd();
    add(put(tubeGeometry(0.020, 0.038, 0.24, 5, 1.6),
      Math.cos(a) * 0.06, 0.22, Math.sin(a) * 0.06, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5), bark);
  }
  const lobes = p.lobes || (4 + Math.floor(rnd() * 3));
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * Math.PI * 2 + rnd() * 0.6;
    const r = i === 0 ? 0 : 0.14 + rnd() * 0.14;
    const s = 0.20 + rnd() * 0.13;
    add(put(rockGeometry(s, 7100 + i * 53, 0.55),
      Math.cos(a) * r, 0.26 + rnd() * 0.16, Math.sin(a) * r,
      (rnd() - 0.5) * 0.6, rnd() * 6.28, (rnd() - 0.5) * 0.6), leaf);
  }
  if (p.berries !== false) {
    for (let i = 0; i < 7; i++) {
      const a = rnd() * Math.PI * 2, r = 0.16 + rnd() * 0.16;
      add(put(prismGeometry(0.022, 0.026, 6, 3.0),
        Math.cos(a) * r, 0.28 + rnd() * 0.22, Math.sin(a) * r), berryMat);
    }
  }
  return { parts, animated: false };
}

/** STUMP — a felled trunk: growth-ring top, ridged bark shell, splayed roots. */
function procStump(themeId, o) {
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0x57 : p.seed);
  const bark = mat('bark', themeId);
  const wood = mat('wood', themeId);
  const moss = mat('moss', themeId);
  const R = p.r || 0.42;
  const H = p.h || 0.52;

  add(put(tubeGeometry(R * 0.95, R, H, 11, 1.0), 0, H * 0.5, 0), bark);
  // bark ridges
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + rnd() * 0.2;
    add(put(tubeGeometry(0.024, 0.034, H * 0.94, 4, 1.8),
      Math.cos(a) * R * 0.99, H * 0.5, Math.sin(a) * R * 0.99, 0, -a, (rnd() - 0.5) * 0.10), bark);
  }
  // cut face: concentric growth rings
  add(put(ringGeometry(0, R * 0.93, 22, 1.0), 0, H + 0.003, 0), wood);
  for (let i = 1; i <= 4; i++) {
    add(put(ringProfileGeometry(R * 0.93 * (i / 4.6), [0.010, 0.005, 0.002], 20, 2.4), 0, H + 0.008, 0), bark);
  }
  // a split running off-centre
  add(put(boxGeometry(R * 1.2, 0.014, 0.030, 2.0), R * 0.10, H + 0.010, 0, 0, rnd() * 3.1, 0), bark);
  // roots
  const roots = 5;
  for (let i = 0; i < roots; i++) {
    const a = (i / roots) * Math.PI * 2 + rnd() * 0.4;
    const rl = R * (1.3 + rnd() * 0.7);
    add(put(tubeGeometry(0.05, 0.12, rl, 6, 1.3),
      Math.cos(a) * rl * 0.42, 0.07, Math.sin(a) * rl * 0.42,
      Math.sin(a) * 1.32, 0, -Math.cos(a) * 1.32), bark);
  }
  // moss cap
  if (p.moss !== false) {
    add(put(rockGeometry(R * 0.55, 6161, 0.35), R * 0.25, H + 0.012, R * 0.12, 0, 0, 0, 1, 0.18, 1), moss);
  }
  return { parts, animated: false };
}

/** LAVA ROCK — obsidian chunks split by glowing seams; ember realm bedrock. */
function procLavaRock(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0x1aa7 : p.seed);
  const rock = mat('obsidian', themeId);
  const crust = mat('stone', themeId);
  const hot = getEmissive(L.ember, 3.0);

  const chunks = p.chunks || 4;
  for (let i = 0; i < chunks; i++) {
    const a = rnd() * Math.PI * 2;
    const r = i === 0 ? 0 : 0.14 + rnd() * 0.20;
    const s = i === 0 ? 0.30 : 0.11 + rnd() * 0.12;
    add(put(rockGeometry(s, 3300 + i * 41, 0.72),
      Math.cos(a) * r, s * 0.60, Math.sin(a) * r,
      (rnd() - 0.5) * 0.8, rnd() * 6.28, (rnd() - 0.5) * 0.8), i % 3 === 2 ? crust : rock);
  }
  // glowing seams pushed into the crevices between chunks
  const seams = p.seams || 5;
  for (let i = 0; i < seams; i++) {
    const a = (i / seams) * Math.PI * 2 + rnd() * 0.5;
    const r = 0.10 + rnd() * 0.22;
    add(put(boxGeometry(0.30 + rnd() * 0.22, 0.012, 0.030, 2.0),
      Math.cos(a) * r, 0.06 + rnd() * 0.20, Math.sin(a) * r,
      (rnd() - 0.5) * 0.8, rnd() * 6.28, (rnd() - 0.5) * 0.8), hot);
  }
  add(put(ringGeometry(0.0, 0.20, 16, 1.0), 0, 0.012, 0), hot);
  return { parts, animated: false };
}

/** ICICLE — a fringe of tapering spikes hanging from a fractured ice shelf. */
function procIcicle(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0x1ce : p.seed);
  const ice = mat('ice', themeId);
  const glint = getEmissive(L.glow, 1.1);
  const n = p.count || 7;
  const spread = p.spread || 0.42;

  // the shelf the spikes hang from
  add(put(rockGeometry(spread * 0.9, 8181, 0.45), 0, -0.04, 0, 0, 0, 0, 1, 0.22, 1), ice);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * spread;
    const len = 0.28 + rnd() * 0.72;
    const rad = 0.030 + rnd() * 0.045;
    // a spike points DOWN: tubeGeometry(rTop, rBot, ...) flipped
    add(put(tubeGeometry(rad, 0.0, len, 6, 1.0),
      Math.cos(a) * r, -len * 0.5 - 0.02, Math.sin(a) * r,
      (rnd() - 0.5) * 0.10, rnd() * 6.28, (rnd() - 0.5) * 0.10), ice);
    // frost collar where it meets the shelf
    add(put(ringProfileGeometry(rad * 1.25, [0.010, 0.008, 0.003], 8, 2.4),
      Math.cos(a) * r, -0.02, Math.sin(a) * r), glint);
  }
  return { parts, animated: false };
}

/** SNOWDRIFT — wind-shaped mounds with a scalloped lip and a crust sparkle. */
function procSnowdrift(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0x5104 : p.seed);
  const snow = mat('snow', themeId);
  const sparkle = getEmissive(L.glow, 0.5);
  const wind = p.wind === undefined ? 0.6 : p.wind;    // yaw the drift leans into

  const mounds = p.mounds || 3;
  for (let i = 0; i < mounds; i++) {
    const t = i / Math.max(1, mounds - 1);
    const s = 0.62 - t * 0.28;
    add(put(rockGeometry(s, 9200 + i * 29, 0.32),
      Math.sin(wind) * t * 0.55, s * 0.16, Math.cos(wind) * t * 0.55,
      0, rnd() * 6.28, 0, 1, 0.26, 1), snow);
  }
  // the carved lip on the lee side — thin curved plates
  for (let i = 0; i < 6; i++) {
    const a = wind + Math.PI + (i - 2.5) * 0.26;
    const r = 0.46 + rnd() * 0.10;
    add(put(bevelBoxGeometry(0.24, 0.030, 0.16, 0.008, 1.6),
      Math.sin(a) * r, 0.10 + rnd() * 0.05, Math.cos(a) * r, -0.30, -a, 0), snow);
  }
  // crust sparkle
  for (let i = 0; i < 8; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.50;
    add(put(prismGeometry(0.014, 0.008, 5, 3.0), Math.cos(a) * r, 0.14 + rnd() * 0.06, Math.sin(a) * r), sparkle);
  }
  return { parts, animated: false };
}

/** CACTUS — a ribbed barrel with two raised arms, areole spines and a bloom. */
function procCactus(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0xcac2 : p.seed);
  const flesh = mat('moss', themeId);
  const spineMat = mat('sand', themeId);
  const bloom = getEmissive(p.bloom === undefined ? L.accent : p.bloom, 1.2);
  const R = p.r || 0.24;
  const H = p.h || 1.55;
  const RIBS = 9;

  // trunk
  add(put(latheProfileGeometry([
    [0, 0], [R * 0.92, 0.01], [R, R * 0.5], [R, H - R * 0.9],
    [R * 0.80, H - R * 0.25], [R * 0.42, H - 0.02], [0, H],
  ], 14, 1.0), 0, 0, 0), flesh);
  // ribs
  for (let i = 0; i < RIBS; i++) {
    const a = (i / RIBS) * Math.PI * 2;
    add(put(tubeGeometry(0.020, 0.028, H * 0.94, 4, 2.0),
      Math.cos(a) * R * 0.99, H * 0.49, Math.sin(a) * R * 0.99), flesh);
    // areole spines
    for (let k = 1; k < 6; k++) {
      const y = (k / 6) * H;
      add(put(prismGeometry(0.008, 0.055, 4, 3.0),
        Math.cos(a) * (R + 0.03), y, Math.sin(a) * (R + 0.03),
        Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4), spineMat);
    }
  }
  // arms
  const arms = p.arms === undefined ? 2 : p.arms;
  for (let i = 0; i < arms; i++) {
    const a = rnd() * Math.PI * 2;
    const ay = H * (0.38 + i * 0.20);
    const ar = R * 0.62;
    const reach = 0.34 + rnd() * 0.16;
    const rise = 0.42 + rnd() * 0.26;
    // elbow out, then up
    add(put(tubeGeometry(ar, ar * 1.05, reach, 10, 1.0),
      Math.cos(a) * (R + reach * 0.42), ay, Math.sin(a) * (R + reach * 0.42),
      Math.sin(a) * 1.57, 0, -Math.cos(a) * 1.57), flesh);
    add(put(latheProfileGeometry([
      [0, 0], [ar, 0.02], [ar, rise - ar * 0.7], [ar * 0.66, rise - 0.02], [0, rise],
    ], 10, 1.0), Math.cos(a) * (R + reach * 0.82), ay - ar * 0.2, Math.sin(a) * (R + reach * 0.82)), flesh);
    for (let k = 0; k < 5; k++) {
      const sa = (k / 5) * Math.PI * 2;
      add(put(prismGeometry(0.007, 0.04, 4, 3.0),
        Math.cos(a) * (R + reach * 0.82) + Math.cos(sa) * (ar + 0.02),
        ay + rise * 0.5, Math.sin(a) * (R + reach * 0.82) + Math.sin(sa) * (ar + 0.02),
        Math.sin(sa) * 1.4, 0, -Math.cos(sa) * 1.4), spineMat);
    }
  }
  // crown bloom
  if (p.flower !== false) {
    for (let k = 0; k < 6; k++) {
      const fa = (k / 6) * Math.PI * 2;
      add(put(latheProfileGeometry([[0, 0], [0.045, 0.004], [0.028, 0.016], [0, 0.022]], 6, 3.0),
        Math.cos(fa) * 0.045, H + 0.010, Math.sin(fa) * 0.045,
        Math.sin(fa) * 0.55, 0, -Math.cos(fa) * 0.55), bloom);
    }
  }
  return { parts, animated: false };
}

/** SANDSTONE — a wind-carved stack of undercut slabs under a hard capstone. */
function procSandstone(themeId, o) {
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const rnd = mulberry32(p.seed === undefined ? 0x5a11 : p.seed);
  const rock = mat('sand', themeId);
  const dark = mat('stone', themeId);
  const layers = p.layers || 5;
  const R = p.r || 0.62;

  let y = 0;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    // undercut: the middle bands are eroded narrower than the ones above
    const pinch = 0.62 + 0.38 * Math.abs(Math.cos(t * Math.PI * 1.35));
    const rr = R * pinch * (1 - t * 0.18);
    const hh = 0.16 + rnd() * 0.16;
    add(put(bevelBoxGeometry(rr * 2, hh, rr * 1.72, 0.035, 0.85),
      (rnd() - 0.5) * 0.07, y + hh * 0.5, (rnd() - 0.5) * 0.07, 0, rnd() * 0.4, 0),
      i % 3 === 1 ? dark : rock);
    // a wind-scoured lip on each band
    add(put(bevelBoxGeometry(rr * 2.10, 0.024, rr * 1.80, 0.008, 1.4),
      0, y + hh - 0.012, 0, 0, rnd() * 0.4, 0), dark);
    y += hh;
  }
  // capstone
  add(put(bevelBoxGeometry(R * 2.15, 0.20, R * 1.9, 0.045, 0.85), 0, y + 0.10, 0, 0, rnd() * 0.5, 0), rock);
  // rubble skirt
  for (let i = 0; i < 4; i++) {
    const a = rnd() * Math.PI * 2, r = R * (0.9 + rnd() * 0.5);
    add(put(rockGeometry(0.10 + rnd() * 0.08, 4400 + i * 13, 0.6),
      Math.cos(a) * r, 0.05, Math.sin(a) * r, 0, rnd() * 6.28, 0), rock);
  }
  return { parts, animated: false };
}

/** GEAR — a real toothed wheel: hub, spokes, rim, involute-ish teeth, bolts. */
function procGear(themeId, o) {
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const steel = mat('metal', themeId);
  const brass = mat('copper', themeId);
  const dark = mat('obsidian', themeId);
  const R = p.r || 0.58;
  const TH = p.thick || 0.13;
  const teeth = p.teeth || 14;
  const spokes = p.spokes || 5;

  // rim + teeth
  add(put(ringProfileGeometry(R * 0.86, [TH * 0.5, R * 0.10, TH * 0.14], 40, 1.0), 0, 0, 0), steel);
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const tw = (2 * Math.PI * R * 0.86) / teeth * 0.52;
    add(put(bevelBoxGeometry(tw, TH, R * 0.20, TH * 0.16, 1.2),
      Math.cos(a) * R * 0.95, 0, Math.sin(a) * R * 0.95, Math.PI * 0.5, -a, 0), steel);
  }
  // hub
  add(put(latheProfileGeometry([
    [0, -TH * 0.9], [R * 0.24, -TH * 0.9], [R * 0.26, -TH * 0.5], [R * 0.26, TH * 0.5],
    [R * 0.24, TH * 0.9], [0, TH * 0.9],
  ], 16, 1.2), 0, 0, 0, Math.PI * 0.5, 0, 0), brass);
  add(put(tubeGeometry(R * 0.11, R * 0.11, TH * 2.1, 12, 1.4), 0, 0, 0, Math.PI * 0.5, 0, 0), dark);
  // spokes
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    const len = R * 0.62;
    add(put(bevelBoxGeometry(R * 0.13, TH * 0.72, len, TH * 0.10, 1.1),
      Math.cos(a) * R * 0.50, 0, Math.sin(a) * R * 0.50, Math.PI * 0.5, -a + Math.PI * 0.5, 0), steel);
    // bolt at the rim end of each spoke
    add(put(prismGeometry(R * 0.055, TH * 0.9, 6, 2.0),
      Math.cos(a) * R * 0.78, 0, Math.sin(a) * R * 0.78, Math.PI * 0.5, 0, 0), brass);
  }
  return { parts, animated: false };
}

/** PIPE — a flanged run with an elbow, brackets and a valve wheel. */
function procPipe(themeId, o) {
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const steel = mat('metal', themeId);
  const brass = mat('copper', themeId);
  const dark = mat('obsidian', themeId);
  const R = p.r || 0.17;
  const run = p.run || 2.4;
  const rise = p.rise === undefined ? 0.9 : p.rise;

  // vertical leg
  add(put(tubeGeometry(R, R, rise, 12, 1.0), 0, rise * 0.5, 0), steel);
  // elbow: three short mitred segments
  for (let i = 0; i < 3; i++) {
    const a = (i + 0.5) / 3 * (Math.PI * 0.5);
    const er = R * 1.5;
    add(put(tubeGeometry(R, R, er * 0.62, 10, 1.2),
      Math.sin(a) * er * 0.9, rise + Math.cos(a) * er * 0.0 + er * 0.35 * (1 - Math.cos(a)) - 0.02,
      0, 0, 0, -a), steel);
  }
  // horizontal run
  add(put(tubeGeometry(R, R, run, 12, 1.0), R * 1.35 + run * 0.5, rise + R * 0.55, 0, 0, 0, Math.PI * 0.5), steel);
  // flanges + bolt rings
  const flange = (x, y, rot) => {
    add(put(latheProfileGeometry([
      [R * 0.98, -0.035], [R * 1.55, -0.035], [R * 1.55, 0.035], [R * 0.98, 0.035],
    ], 14, 1.4), x, y, 0, 0, 0, rot), brass);
    for (let k = 0; k < 6; k++) {
      const ba = (k / 6) * Math.PI * 2;
      add(put(prismGeometry(0.018, 0.024, 6, 2.4),
        x + (rot ? 0 : Math.cos(ba) * R * 1.3), y + (rot ? Math.cos(ba) * R * 1.3 : 0),
        Math.sin(ba) * R * 1.3, 0, 0, rot), dark);
    }
  };
  flange(0, rise * 0.18, 0);
  flange(R * 1.35 + run * 0.72, rise + R * 0.55, Math.PI * 0.5);
  // wall bracket
  add(put(bevelBoxGeometry(0.10, 0.30, R * 2.6, 0.02, 1.2), R * 1.35 + run * 0.30, rise + R * 0.55, 0), dark);
  // valve wheel
  const wy = rise + R * 0.55;
  const wx = R * 1.35 + run * 0.40;
  add(put(tubeGeometry(R * 0.36, R * 0.44, 0.22, 10, 1.2), wx, wy + 0.16, 0), steel);
  add(put(ringProfileGeometry(R * 1.05, [0.028, 0.028, 0.008], 18, 1.4), wx, wy + 0.30, 0), brass);
  for (let k = 0; k < 4; k++) {
    const sa = (k / 4) * Math.PI * 2;
    add(put(tubeGeometry(0.018, 0.018, R * 2.0, 5, 1.6),
      wx, wy + 0.30, 0, Math.PI * 0.5, sa, 0), brass);
  }
  return { parts, animated: false };
}

/** FLAGPOLE — turned base, tapered mast, finial, halyard and a swaying flag. */
function procFlagpole(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const parts = [];
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const steel = mat('metal', themeId);
  const stone = mat(L.stone === 'ice' ? 'ice' : L.stone, themeId);
  const gold = getEmissive(L.glow, 1.4);
  const rope = mat('rope', themeId);
  const H = p.h || 4.6;
  const R = p.r || 0.075;
  const flagW = p.flagW || 1.5;
  const flagH = p.flagH || 0.95;
  const cloth = clothMaterial(p.color === undefined ? L.cloth : p.color, 0.11, H * 0.62, flagH);

  // stepped stone footing
  add(put(latheProfileGeometry([
    [0, 0], [R * 5.4, 0], [R * 5.4, 0.10], [R * 4.2, 0.16],
    [R * 4.0, 0.26], [R * 2.6, 0.34], [R * 2.4, 0.44], [0, 0.44],
  ], 16, 1.0), 0, 0, 0), stone);
  // mast
  add(put(tubeGeometry(R * 0.62, R, H - 0.44, 10, 0.9), 0, 0.44 + (H - 0.44) * 0.5, 0), steel);
  for (let i = 1; i < 4; i++) {
    add(put(ringProfileGeometry(R * 1.16, [0.018, 0.026, 0.006], 12, 1.8), 0, 0.44 + (H - 0.44) * (i / 4), 0), gold);
  }
  // finial
  add(put(latheProfileGeometry([
    [0, 0], [R * 1.6, 0.03], [R * 1.35, 0.11], [R * 0.9, 0.20], [R * 0.35, 0.30], [0, 0.36],
  ], 12, 1.4), 0, H - 0.30, 0), gold);
  // halyard: a rope down the mast with a cleat
  add(put(tubeGeometry(0.010, 0.010, H * 0.70, 4, 2.0), R * 1.25, 0.55 + H * 0.35, 0), rope);
  add(put(bevelBoxGeometry(0.05, 0.09, 0.16, 0.012, 2.0), R * 1.4, 0.92, 0), steel);
  // the flag itself — a subdivided sheet so the cloth shader has vertices to move
  const cols = 8, rows = 4;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const cw = flagW / cols, ch = flagH / rows;
      add(put(boxGeometry(cw * 1.02, ch * 1.02, 0.006, 1.2),
        R + cw * (i + 0.5), H * 0.62 + ch * (j + 0.5) + 0.02, 0), cloth);
    }
  }
  // the hoist band that pins the flag to the mast
  add(put(bevelBoxGeometry(0.05, flagH + 0.04, 0.05, 0.012, 2.0), R, H * 0.62 + flagH * 0.5 + 0.02, 0), steel);
  return { parts, animated: true };
}


/* ======================================================================================
   CONTRACT 20 deco the shipped courses author but no generator answered.
   `placeProps` SKIPS an id the library cannot make, silently -- 48 objects in the Keep and
   19 in verdant-1 (post x30, plant x11, panel x8, godray x5, emblem x4, beam x2,
   monolith x2, chandelier/rail/sign/buttress/arch x1) were being dropped on every load.
   Each of these is a faceted, instanced, one-material-per-slot build in the house style.
   ====================================================================================== */

/** Bollard / fence post / hitching post. The Keep's most-authored deco by far. */
function procPost(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const h = p.h || 1.05, r = p.r || 0.085;
  const parts = [];
  const body = mat(p.stone ? (L.stone === 'ice' ? 'ice' : L.stone) : L.wood, themeId);
  const steel = mat('metal', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(bevelBoxGeometry(r * 3.1, 0.09, r * 3.1, 0.02, 0.9), 0, 0.045, 0), body);
  add(put(tubeGeometry(r * 0.82, r, h - 0.20, 8, 0.9), 0, 0.09 + (h - 0.20) * 0.5, 0), body);
  add(put(ringProfileGeometry(r * 1.05, [0.022, 0.016, 0.006], 10, 1.6), 0, h - 0.26, 0), steel);
  add(put(prismGeometry(r * 1.25, 0.13, 6, 1.1), 0, h - 0.055, 0), body);
  return { parts, animated: false };
}

/** Wall panel / plaque -- a recessed slab in a trim frame with an accent inlay. */
function procPanel(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const w = p.w || 1.10, h = p.h || 1.60, t = 0.075;
  const parts = [];
  const stone = mat(L.stone === 'ice' ? 'ice' : L.stone, themeId);
  const wood = mat(L.wood, themeId);
  const steel = mat('metal', themeId);
  const trim = getEmissive(L.accent, 1.15);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(bevelBoxGeometry(w, h, t, 0.02, 0.9), 0, h * 0.5, 0), stone);
  add(put(bevelBoxGeometry(w * 0.78, h * 0.80, t * 0.55, 0.016, 1.1), 0, h * 0.5, t * 0.55), wood);
  const bw = 0.05;
  add(put(bevelBoxGeometry(w * 0.86, bw, t * 0.9, 0.012, 1.4), 0, h * 0.5 + h * 0.40, t * 0.5), steel);
  add(put(bevelBoxGeometry(w * 0.86, bw, t * 0.9, 0.012, 1.4), 0, h * 0.5 - h * 0.40, t * 0.5), steel);
  for (const sx of [-1, 1]) {
    add(put(bevelBoxGeometry(bw, h * 0.80, t * 0.9, 0.012, 1.4), sx * w * 0.43, h * 0.5, t * 0.5), steel);
  }
  add(put(boxGeometry(w * 0.52, 0.016, t * 0.35, 1.2), 0, h * 0.5, t * 0.86), trim);
  return { parts, animated: false };
}

/** Heraldic emblem -- a rondel with a rim, a charge and an accent inlay. */
function procEmblem(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const r = p.r || 0.52;
  const parts = [];
  const stone = mat(L.stone === 'ice' ? 'ice' : L.stone, themeId);
  const steel = mat('metal', themeId);
  const gold = getEmissive(L.accent, 1.35);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  // the disc faces +Z; discGeometry lies in XZ, so tip it up
  add(put(tubeGeometry(r * 0.97, r, 0.075, 22, 0.9), 0, r, 0, Math.PI * 0.5, 0, 0), stone);
  add(put(discGeometry(r * 0.97, 24), 0, r, 0.040, -Math.PI * 0.5, 0, 0), stone);
  add(put(ringProfileGeometry(r * 0.99, [0.032, 0.030, 0.010], 22, 1.6), 0, r, 0.045, Math.PI * 0.5, 0, 0), steel);
  add(put(ringProfileGeometry(r * 0.62, [0.014, 0.020, 0.005], 18, 1.8), 0, r, 0.060, Math.PI * 0.5, 0, 0), gold);
  for (let i = 0; i < 3; i++) {
    const a = (-0.5 + i * 0.5) * 0.9;
    add(put(bevelBoxGeometry(r * 0.18, r * 0.62, 0.030, 0.008, 1.6),
      Math.sin(a) * r * 0.30, r + Math.cos(a) * r * 0.06, 0.070, 0, 0, a), gold);
  }
  return { parts, animated: false };
}

/**
 * Window light shaft. Two crossed additive tapered quads -- no volume, and the whole
 * effect is 4 triangles in 1 draw slot.
 *
 * The intensity is deliberately TINY. `getGlow` is AdditiveBlending with
 * `toneMapped:false`, so its alpha is added straight onto the graded frame: at the first
 * gain I tried (0.55) two overlapping quads summed to ~1.1 and painted the Keep's marble
 * hall pure white. Two quads x GODRAY_GAIN is the real ceiling -- keep it under ~0.25.
 * UV.y is rewritten so 0 is at the WINDOW (the shaft is brightest where the light enters
 * and thins toward the floor), which is the opposite of the quad's default mapping.
 */
const GODRAY_GAIN = 0.10;
/**
 * ROUND 1 VISUAL FIX (owner-observed: "the Keep is blown out", zoom
 * `_shots/_zoom_keepwin.png`). Two defects, both here:
 *
 *   a) A god ray from a raking key is a SLANTED shaft: it leaves the window
 *      high and lands on the floor well inside the room. This generator built
 *      a strictly VERTICAL widening column, and keep.js compensated by lifting
 *      it 6.4 m off the floor — so five windows' worth of 12 m columns hung in
 *      the air ABOVE head height and read as a bank of horizontal white slats,
 *      not as light. `tilt` (metres the foot slides per metre of drop, along
 *      local +Z) shears the quad so the top stays pinned at the window and the
 *      foot lands where the key actually points.
 *   b) `p.gain` was the only intensity channel and course data had no way to
 *      reach it (see `placeProps` — `def.params` was never populated by any
 *      course, and keep.js's authored `opacity: 0.16` was silently dropped).
 *      The alias in placeProps now delivers it.
 */
function procGodray(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const h = p.h || 6.0, w = p.w || 1.20, spread = p.spread === undefined ? 1.9 : p.spread;
  const tilt = p.tilt === undefined ? 0 : p.tilt;
  const parts = [];
  const glow = getGlow(p.color || L.glow, {
    mode: 'shaft', power: 2.1, speed: 0.30,
    gain: p.gain === undefined ? GODRAY_GAIN : p.gain,
  });
  for (let i = 0; i < 2; i++) {
    const g = quadGeometry(1, 1, 2, 1, 1);
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let v = 0; v < pos.count; v++) {
      const y01 = pos.getY(v) + 0.5;                 // 0 at the base, 1 at the top
      pos.setX(v, pos.getX(v) * w * (1 + (1 - y01) * (spread - 1)));
      pos.setY(v, y01 * h);
      // shear: the window end (y01 = 1) stays put, the floor end slides
      pos.setZ(v, pos.getZ(v) + (1 - y01) * tilt * h);
      if (uv) uv.setXY(v, uv.getX(v), 1 - y01);      // 0 = the window, 1 = the floor
    }
    pos.needsUpdate = true;
    if (uv) uv.needsUpdate = true;
    g.computeVertexNormals();
    parts.push({ geometry: put(g, 0, 0, 0, 0, i * Math.PI * 0.5, 0), material: glow });
  }
  return { parts, animated: false };
}

/** Hanging chandelier -- a ring of candles under a crown, on taut chains. */
function procChandelier(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const r = p.r || 0.52, n = Math.max(4, Math.round(p.arms || 6));
  const parts = [];
  const steel = mat('metal', themeId);
  const wax = mat('plaster', themeId);
  const flame = getEmissive(L.flame, 2.6);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(tubeGeometry(0.016, 0.016, 0.90, 6, 1.0), 0, 1.55, 0), steel);
  add(put(prismGeometry(0.09, 0.13, 6, 1.2), 0, 1.06, 0), steel);
  add(put(ringProfileGeometry(r, [0.026, 0.034, 0.009], 20, 1.6), 0, 0.86, 0), steel);
  add(put(ringProfileGeometry(r * 0.52, [0.018, 0.024, 0.006], 16, 1.8), 0, 1.00, 0), steel);
  const lean = Math.atan2(r * 0.45, 0.38);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    add(put(tubeGeometry(0.030, 0.038, 0.06, 8, 1.4), x, 0.90, z), steel);
    add(put(tubeGeometry(0.024, 0.028, 0.17, 8, 1.4), x, 1.01, z), wax);
    add(put(prismGeometry(0.026, 0.085, 5, 2.0), x, 1.14, z), flame);
    add(put(tubeGeometry(0.008, 0.008, 0.42, 5, 1.0),
      x * 0.55, 1.24, z * 0.55, lean * Math.sin(a), 0, -lean * Math.cos(a)), steel);
  }
  return { parts, animated: false };
}

/** Structural beam -- a squared member with end straps and corbels. `fit:'max'`. */
function procBeam(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const len = p.len || 4.0, t = p.t || 0.26;
  const parts = [];
  const body = mat(p.stone ? (L.stone === 'ice' ? 'ice' : L.stone) : L.wood, themeId);
  const steel = mat('metal', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(bevelBoxGeometry(len, t, t, 0.022, 0.7), 0, t * 0.5, 0), body);
  for (const sx of [-1, 1]) {
    add(put(bevelBoxGeometry(0.055, t * 1.08, t * 1.08, 0.010, 1.5), sx * (len * 0.5 - 0.16), t * 0.5, 0), steel);
    add(put(prismGeometry(t * 0.62, t * 0.75, 4, 1.0),
      sx * (len * 0.5 - 0.34), t * 0.10, 0, Math.PI, 0, Math.PI * 0.25), body);
  }
  return { parts, animated: false };
}

/** Balustrade rail -- two newels, a top rail and turned balusters. `fit:'max'`. */
function procRail(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const len = p.len || 2.6, h = p.h || 1.02;
  const parts = [];
  const stone = mat(L.stone === 'ice' ? 'ice' : L.stone, themeId);
  const steel = mat('metal', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(bevelBoxGeometry(len, 0.10, 0.30, 0.022, 0.8), 0, 0.05, 0), stone);
  add(put(bevelBoxGeometry(len, 0.11, 0.26, 0.024, 0.9), 0, h - 0.055, 0), stone);
  add(put(boxGeometry(len * 0.99, 0.016, 0.10, 1.2), 0, h + 0.006, 0), steel);
  for (const sx of [-1, 1]) {
    add(put(bevelBoxGeometry(0.20, h - 0.10, 0.28, 0.026, 1.0),
      sx * (len * 0.5 - 0.10), 0.10 + (h - 0.16) * 0.5, 0), stone);
  }
  const n = Math.max(3, Math.round((len - 0.44) / 0.30));
  for (let i = 0; i < n; i++) {
    const x = -((len - 0.60) * 0.5) + ((len - 0.60) * i) / (n - 1);
    add(put(latheProfileGeometry([[0.055, 0], [0.038, 0.14], [0.062, 0.36], [0.036, 0.62], [0.050, h - 0.20]], 8, 1.2),
      x, 0.10, 0), stone);
  }
  return { parts, animated: false };
}

/** Signboard on two posts -- the course tutorial board. */
function procSign(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const w = p.w || 1.9, bh = p.bh || 0.78, h = p.h || 2.0;
  const parts = [];
  const wood = mat(L.wood, themeId);
  const steel = mat('metal', themeId);
  const trim = getEmissive(L.accent, 1.0);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  for (const sx of [-1, 1]) {
    add(put(tubeGeometry(0.055, 0.068, h, 7, 1.0), sx * (w * 0.5 - 0.12), h * 0.5, 0), wood);
    add(put(prismGeometry(0.082, 0.09, 6, 1.2), sx * (w * 0.5 - 0.12), h - 0.03, 0), wood);
  }
  const by = h - bh * 0.5 - 0.20;
  add(put(bevelBoxGeometry(w, bh, 0.09, 0.022, 0.8), 0, by, 0), wood);
  add(put(bevelBoxGeometry(w * 0.94, bh * 0.86, 0.05, 0.016, 1.1), 0, by, 0.06), wood);
  add(put(boxGeometry(w * 0.86, 0.014, 0.03, 1.2), 0, by - bh * 0.30, 0.10), trim);
  for (const sy of [-1, 1]) {
    add(put(bevelBoxGeometry(w * 0.99, 0.035, 0.11, 0.010, 1.5), 0, by + sy * bh * 0.46, 0), steel);
  }
  return { parts, animated: false };
}

/** Wall buttress -- a battered pier with weathered set-offs and a sloped shoulder. */
function procButtress(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const h = p.h || 3.2, w = p.w || 0.78, d = p.d || 1.05;
  const parts = [];
  const stone = mat(L.stone === 'ice' ? 'ice' : L.stone, themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(bevelBoxGeometry(w * 1.28, 0.22, d * 1.20, 0.03, 0.7), 0, 0.11, 0), stone);
  const stages = 3;
  for (let i = 0; i < stages; i++) {
    const t = i / stages;
    const sy = (h - 0.22) / stages;
    add(put(bevelBoxGeometry(w * (1 - t * 0.22), sy * 0.96, d * (1 - t * 0.42), 0.026, 0.8),
      0, 0.22 + sy * (i + 0.5), -d * t * 0.20), stone);
    if (i < stages - 1) {
      add(put(prismGeometry(w * 0.5 * (1 - t * 0.22), 0.20, 4, 0.9),
        0, 0.22 + sy * (i + 1), -d * t * 0.20, 0, Math.PI * 0.25, 0), stone);
    }
  }
  add(put(prismGeometry(w * 0.44, 0.34, 4, 1.0), 0, h - 0.12, -d * 0.26, 0, Math.PI * 0.25, 0), stone);
  return { parts, animated: false };
}

/** Leafy plant -- a low fan of tapered blades on a scrape of soil. */
function procPlant(themeId, o) {
  const p = o || {};
  const h = p.h || 0.70;
  const seed = (p.seed === undefined ? 21 : p.seed) >>> 0;
  const rnd = mulberry32(seed * 2654435761 + 17);
  const parts = [];
  const leaf = mat('leaves', themeId);
  const dirt = mat('dirt', themeId);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  add(put(discGeometry(0.24, 12), 0, 0.012, 0), dirt);
  const n = 9 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.35;
    const lean = 0.42 + rnd() * 0.5;
    const ln = h * (0.62 + rnd() * 0.45);
    const blade = bevelBoxGeometry(0.052 + rnd() * 0.03, ln, 0.012, 0.006, 1.6);
    add(put(blade, Math.cos(a) * 0.05, ln * 0.5 * Math.cos(lean) + 0.02, Math.sin(a) * 0.05,
      Math.sin(a) * lean, -a, Math.cos(a) * lean), leaf);
  }
  return { parts, animated: false };
}

/** Standing stone -- one tall faceted monolith on a scatter of chocks. */
function procMonolith(themeId, o) {
  const L = look(themeId);
  const p = o || {};
  const h = p.h || 2.8, w = p.w || 0.72;
  const seed = (p.seed === undefined ? 7 : p.seed) >>> 0;
  const parts = [];
  const stone = mat(L.stone === 'ice' ? 'ice' : L.stone, themeId);
  const trim = getEmissive(L.accent, 0.85);
  const add = (g, m) => parts.push({ geometry: g, material: m });
  const g = prismGeometry(w * 0.62, h, 5, 0.9);
  const pos = g.attributes.position;
  const rnd = mulberry32(seed * 40503 + 3);
  for (let v = 0; v < pos.count; v++) {
    const y = pos.getY(v), t = Math.max(0, Math.min(1, y / h));
    pos.setX(v, pos.getX(v) * (1 - t * 0.30) + t * w * 0.16 + (rnd() - 0.5) * 0.035);
    pos.setZ(v, pos.getZ(v) * (1 - t * 0.24) + (rnd() - 0.5) * 0.035);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  add(put(g, 0, 0, 0), stone);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    add(put(rockGeometry(0.17 + rnd() * 0.08, seed + i, 0.5),
      Math.cos(a) * w * 0.72, 0.06, Math.sin(a) * w * 0.72), stone);
  }
  add(put(ringProfileGeometry(w * 0.34, [0.012, 0.016, 0.004], 12, 1.8),
    0, h * 0.72, w * 0.14, Math.PI * 0.5, 0, 0), trim);
  return { parts, animated: false };
}

const PROC = {
  torch: procTorch,
  brazier: procBrazier,
  lantern: procLantern,
  chain: procChain,
  banner: procBanner,
  flags: procFlags,
  crystal: procCrystal,
  lavavent: procLavaVent,
  cables: procCables,
  holosign: procHoloSign,
  debris: procDebris,
  crate: procCrate,
  barrel: procBarrel,
  rock: procRock,
  cage: procCage,
  bench: procBench,
  shelf: procShelf,
  anvil: procAnvil,
  tool: procTool,
  coins: procCoins,
  pillar: procPillar,
  statue: procStatue,
  archway: procArchway,
  // --- CRESTBOUND realm deco (CONTRACT 20) ---
  mushroom: procMushroom,
  flowerbed: procFlowerbed,
  bush: procBush,
  stump: procStump,
  lavaRock: procLavaRock,
  icicle: procIcicle,
  snowdrift: procSnowdrift,
  cactus: procCactus,
  sandstone: procSandstone,
  gear: procGear,
  pipe: procPipe,
  flagpole: procFlagpole,
  // --- CONTRACT 20 deco the shipped courses author (see the block above) ---
  post: procPost,
  panel: procPanel,
  emblem: procEmblem,
  godray: procGodray,
  chandelier: procChandelier,
  beam: procBeam,
  rail: procRail,
  sign: procSign,
  buttress: procButtress,
  plant: procPlant,
  monolith: procMonolith,
  arch: procArchway,          // `arch` is what the courses call `archway`
};

/** Names of every procedural generator — every one is a valid `def.model`. */
export const PROC_PROPS = Object.keys(PROC);

// ---------------------------------------------------------------------------
// normalisation + entry assembly
// ---------------------------------------------------------------------------
/**
 * Merge parts by material, normalise to `targetH` with the base at y = 0 and the
 * footprint centred in XZ, and compute the shadow/bounds metadata.
 */
function makeEntry(id, source, parts, targetH, spec) {
  // 1. union bounds
  _box.makeEmpty();
  for (let i = 0; i < parts.length; i++) {
    const g = parts[i].geometry;
    g.computeBoundingBox();
    if (g.boundingBox) _box.union(g.boundingBox);
  }
  if (_box.isEmpty()) _box.set(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  const size = _box.getSize(new THREE.Vector3());
  const centre = _box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const ref = (spec && spec.fit === 'max') ? maxDim : size.y;
  let scale = (targetH > 0 && ref > 1e-4) ? targetH / ref : 1;
  // Safety net: a curated asset should never need a large upscale. When one does,
  // the manifest and the asset disagree (almost always a flat prop measured by
  // height) — clamp rather than ship a 30 m sculpture, and say which prop it was.
  if (scale > MAX_UPSCALE) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[props] ' + id + ': ' + scale.toFixed(1) + 'x upscale clamped to '
        + MAX_UPSCALE + 'x - check its manifest h/fit.');
    }
    scale = MAX_UPSCALE;
  }

  // 2. bake the normalisation into every part
  for (let i = 0; i < parts.length; i++) {
    const g = parts[i].geometry;
    g.translate(-centre.x, -_box.min.y, -centre.z);
    g.scale(scale, scale, scale);
    g.computeBoundingBox();
    g.computeBoundingSphere();
  }
  size.multiplyScalar(scale);

  // 3. merge parts that share a material — one InstancedMesh per material
  const order = [];
  const byMat = new Map();
  for (let i = 0; i < parts.length; i++) {
    const m = parts[i].material;
    let list = byMat.get(m);
    if (!list) { list = []; byMat.set(m, list); order.push(m); }
    list.push(parts[i].geometry);
  }
  const merged = [];
  let radius = 0;
  for (let i = 0; i < order.length; i++) {
    const list = byMat.get(order[i]);
    let g = list.length === 1 ? list[0] : mergeGeometries(list, false);
    if (!g) { g = list[0]; }
    else if (list.length > 1) for (const x of list) x.dispose();
    g.computeBoundingSphere();
    if (g.boundingSphere && g.boundingSphere.radius > radius) radius = g.boundingSphere.radius;
    merged.push({ geometry: g, material: order[i] });
  }
  const wholeRadius = Math.max(size.x, size.y, size.z) * 0.5;

  const light = spec && spec.light ? {
    color: spec.light.color === undefined ? look(spec.themeId).lightColor : spec.light.color,
    intensity: spec.light.intensity === undefined ? 2.0 : spec.light.intensity,
    distance: spec.light.distance === undefined ? 9 : spec.light.distance,
    y: (spec.light.y01 === undefined ? 0.8 : spec.light.y01) * size.y,
    decay: 2,
  } : null;

  return {
    id,
    source,
    parts: merged,
    size,
    radius: wholeRadius,
    partRadius: radius,
    castShadow: wholeRadius >= 0.75,
    light,
    animated: !!(spec && spec.animated),
    tags: (spec && spec.tags) || [],
  };
}

/** Build an entry straight from a procedural generator. */
/**
 * Load-time accounting for the prop pipeline, read by
 * `_harness/_loadprofile.py`. Course load is gated at 1500 ms and prop work was
 * measured at ~3.6 s of a cold load, so where inside that it goes is not a
 * thing to guess at. Cheap enough to leave on: two counters and a clock read
 * per prop KIND (not per instance), none of it in a per-frame path.
 */
export const PROP_STATS = { buildMs: 0, entries: 0, placeMs: 0, placed: 0, slowest: '' };

/** Zero the counters (call before a load you want to attribute). */
export function resetPropStats() {
  PROP_STATS.buildMs = 0; PROP_STATS.entries = 0;
  PROP_STATS.placeMs = 0; PROP_STATS.placed = 0; PROP_STATS.slowest = '';
}

const _pnow = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now() : () => Date.now();
let _slowestMs = 0;

function buildProcEntry(id, themeId, spec) {
  const t0 = _pnow();
  const gen = PROC[(spec && spec.proc) || id] || PROC.crate;
  const params = Object.assign({}, (spec && spec.params) || null);
  const res = gen(themeId, params);
  const out = makeEntry(id, 'procedural', res.parts, (spec && spec.h) || 1, {
    fit: spec && spec.fit, light: spec && spec.light, tags: spec && spec.tags,
    animated: res.animated, themeId,
  });
  const ms = _pnow() - t0;
  PROP_STATS.buildMs += ms;
  PROP_STATS.entries++;
  if (ms > _slowestMs) { _slowestMs = ms; PROP_STATS.slowest = id + ' ' + ms.toFixed(0) + 'ms'; }
  return out;
}

/** Flatten a loaded glTF scene into {geometry, material} parts in world space. */
function flattenGltf(scene, maxAniso) {
  scene.updateMatrixWorld(true);

  // 1. strip every embedded light — theme lighting is ours, not the asset's
  const lights = [];
  scene.traverse((o) => { if (o.isLight) lights.push(o); });
  for (let i = 0; i < lights.length; i++) {
    if (lights[i].parent) lights[i].parent.remove(lights[i]);
  }

  const parts = [];
  const seenMats = new Set();
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
    const src = o.geometry;
    const g = (src.index ? src.toNonIndexed() : src.clone());
    // keep only the attributes every downstream merge understands
    for (const k in g.attributes) {
      if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k);
    }
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) {
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    }
    g.applyMatrix4(o.matrixWorld);

    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let mi = 0; mi < mats.length; mi++) {
      const m = mats[mi];
      if (!m || seenMats.has(m.uuid)) continue;
      seenMats.add(m.uuid);
      // 2. correct colour space + sampling on every texture the asset shipped
      if (m.map) { m.map.colorSpace = THREE.SRGBColorSpace; m.map.anisotropy = maxAniso; }
      if (m.emissiveMap) m.emissiveMap.colorSpace = THREE.SRGBColorSpace;
      for (const k of ['normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'alphaMap']) {
        if (m[k]) { m[k].colorSpace = THREE.NoColorSpace; m[k].anisotropy = maxAniso; }
      }
      if (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial) m.envMapIntensity = 1.0;
      m.shadowSide = THREE.FrontSide;
    }
    // multi-material GLB meshes carry groups; split so each part is single-material
    const groups = (g.groups && g.groups.length > 1) ? g.groups.slice() : null;
    if (groups) {
      for (let gi = 0; gi < groups.length; gi++) {
        const grp = groups[gi];
        const sub = new THREE.BufferGeometry();
        for (const k in g.attributes) {
          const a = g.attributes[k];
          const it = a.itemSize;
          const dst = new Float32Array(grp.count * it);
          dst.set(a.array.subarray(grp.start * it, (grp.start + grp.count) * it));
          sub.setAttribute(k, new THREE.BufferAttribute(dst, it));
        }
        parts.push({ geometry: sub, material: mats[grp.materialIndex] || mats[0] });
      }
      g.dispose();
    } else {
      g.clearGroups();
      parts.push({ geometry: g, material: mats[0] });
    }
  });
  return parts;
}

// ---------------------------------------------------------------------------
// loadProps
// ---------------------------------------------------------------------------
/**
 * Load the curated prop set for a theme.
 *
 * Every manifest entry resolves, always: a `.glb` that is missing, 404s or fails
 * to parse silently falls back to its procedural generator, so a stage is never
 * broken by an absent file.
 *
 * @param {string} themeId 'neon' | 'foundry' | 'spire' | 'temple' | 'hub'
 * @param {THREE.WebGLRenderer} [renderer] used only for max anisotropy
 * @param {object} [opts] {basePath, timeoutMs}
 * @returns {Promise<object>} the prop library
 */
/**
 * Prop libraries, keyed by theme id.
 *
 * MEASURED (`_harness/_loadprofile.py`, verdant-1, 2026-09-02): building the
 * library took **2920.8 ms of a 7226 ms course load** — by far the largest
 * single phase — and it was redone from scratch on every `loadCourse`, even
 * returning to a theme already visited. Almost none of that is file IO: four
 * of the five realms ship no GLBs at all, so the time is `buildProcEntry`
 * generating the same ~50 procedural prop geometries again.
 *
 * A library is template data: `placeProps` builds `InstancedMesh(part.geometry,
 * part.material, n)` straight off it and its own `dispose()` only frees the
 * per-instance buffers, so the entry geometries outlive any one course and are
 * safe — in fact cheaper — to share. Nothing called `library.dispose()`
 * before this, so those geometries were leaked once per load; now there is one
 * set per theme for the life of the page. `disposeProps()` clears the cache.
 *
 * @type {Map<string, object>}
 */
const _libCache = new Map();

/**
 * `assets/props/<theme>/index.json` → the Set of GLB basenames that theme ships,
 * cached for the life of the page.
 *
 * WHY IT IS CACHED, AND WHY IT IS PREFETCHED — this is a LOAD-TIME fix, not a
 * bandwidth one. `Course._build()` is one long synchronous block with exactly
 * one `await` in it (`_buildPropBatch`), and until this cache existed that
 * await was a real network round trip. A real round trip is a MACROTASK: the
 * stack unwinds, the browser runs the rAF loop, and the engine renders the
 * HALF-BUILT course — terrain, hazards and static art in the scene, but the
 * course's six-strong point-light pool not yet allocated.
 *
 * MEASURED (`_harness/_awaitprobe.py`, verdant-1 cold, 2026-09-03): exactly
 * THREE frames rendered inside that await and they cost **4570 ms** between
 * them, taking the program count from 70 to 100 — first-visibility compiles of
 * the whole course, at full 1080p, with the wrong light count. `numPointLights`
 * is a shader cache-key axis, so every one of those programs was compiled at 0
 * point lights and then compiled AGAIN at 6 once `_buildLightPool` ran.
 *
 * An `await` on an already-resolved promise is a MICROTASK, which does not let
 * rAF run. So keeping the manifest in memory does not merely save the fetch: it
 * removes the only yield in the build, and the course is never rendered until
 * it is finished and lit.
 *
 * @type {Map<string, Set<string>>}
 */
const _shippedCache = new Map();
/** in-flight manifest fetches, so two callers never fetch the same file twice */
const _shippedPending = new Map();
/** every theme whose manifest is worth having before its first course loads */
const PREFETCH_THEMES = ['keep', 'verdant', 'ember', 'rime', 'azure'];
let _prefetchStarted = false;

/**
 * Fetch one theme's shipped-GLB manifest, memoised. An absent or malformed
 * `index.json` means "this theme is fully procedural" — exactly what a failed
 * fetch used to mean — and is cached as an empty Set so it is never re-probed.
 * @param {string} themeId
 * @param {string} base
 * @returns {Promise<Set<string>>}
 */
function fetchShipped(themeId, base) {
  const hit = _shippedCache.get(themeId);
  if (hit) return Promise.resolve(hit);
  const inflight = _shippedPending.get(themeId);
  if (inflight) return inflight;
  const p = fetch(base + themeId + '/index.json', { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (Array.isArray(j) ? new Set(j.map(String)) : new Set()))
    .catch(() => new Set())
    .then((set) => {
      _shippedCache.set(themeId, set);
      _shippedPending.delete(themeId);
      return set;
    });
  _shippedPending.set(themeId, p);
  return p;
}

/**
 * Warm the manifest cache for every realm in the background.
 *
 * Called (once) from the first `loadProps`, which is the hub's — the hub is the
 * only theme that ships GLBs, so its load is already waiting on real IO and
 * four extra ~40-byte JSON files ride along inside that wait. By the time any
 * realm course loads, its manifest is resident and its build never yields.
 * Side-effect free at import (CONTRACT hard rule 6): nothing here runs until a
 * caller asks for a prop library.
 *
 * @param {string} [base] asset root; defaults to `assets/props/`
 * @returns {Promise<void>} resolves when every manifest is cached (never rejects)
 */
export function prefetchPropManifests(base) {
  const root = base || new URL('../../assets/props/', import.meta.url).href;
  _prefetchStarted = true;
  return Promise.all(PREFETCH_THEMES.map((t) => fetchShipped(t, root))).then(() => undefined);
}

/** Drop one theme's cached prop library (or all of them). */
export function invalidatePropLibrary(themeId) {
  if (themeId === undefined) {
    for (const lib of _libCache.values()) { try { lib.dispose(); } catch (e) { /* best effort */ } }
    _libCache.clear();
    return;
  }
  const lib = _libCache.get(themeId);
  if (lib) { try { lib.dispose(); } catch (e) { /* best effort */ } _libCache.delete(themeId); }
}

export async function loadProps(themeId, renderer, opts) {
  const o = opts || {};
  if (o.mats !== undefined) setPropsMaterials(o.mats);
  const cached = _libCache.get(themeId);
  if (cached && o.fresh !== true) return cached;
  const manifest = THEME_MANIFEST[themeId] || THEME_MANIFEST.keep;
  const maxAniso = (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy)
    ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  const base = o.basePath || new URL('../../assets/props/', import.meta.url).href;

  const entries = new Map();
  const missing = [];

  // `assets/props/<theme>/index.json` lists the GLBs that theme actually ships (basenames,
  // no extension). Probing for a file that is not there is a 404 the browser logs as a
  // console error, which fails _harness/bootcheck.py's clean-boot gate — and four of the
  // five realms are fully procedural today. An absent/!array manifest means "no GLBs":
  // every entry falls to its procedural generator, exactly as a failed fetch used to.
  //
  // Resolved from `_shippedCache` WITHOUT awaiting when it is already resident —
  // see the cache's own note: an await here is a macrotask that lets the engine
  // render the half-built course, and that costs seconds, not milliseconds.
  let shipped = _shippedCache.get(themeId) || null;
  if (!shipped) {
    /* First call of the page. Ride the one unavoidable wait and warm every
       other realm's manifest inside it, so no LATER course load ever yields. */
    if (!_prefetchStarted) prefetchPropManifests(base);
    shipped = await fetchShipped(themeId, base);
  }

  /* Only construct a loader if this theme actually ships GLBs — a GLTFLoader is
     cheap but it is also the only reason this function ever touches the network. */
  const wanted = manifest.filter((s) => !s.procOnly && shipped.has(s.id));
  const loader = wanted.length ? new GLTFLoader() : null;

  /* DEFERRED, not built: see the `lazy` note on makeLibrary. A course places a
     handful of prop kinds; building all ~50 up front was 2.9 s of the load. */
  const lazy = new Map();

  for (let i = 0; i < manifest.length; i++) {
    const spec = manifest[i];
    if (spec.procOnly || !shipped.has(spec.id)) {
      lazy.set(spec.id, spec);
      if (!spec.procOnly) missing.push(spec.id);
    }
  }

  const jobs = wanted.map(async (spec) => {
    const url = base + themeId + '/' + spec.id + '.glb';
    try {
      const gltf = await loader.loadAsync(url);
      const parts = flattenGltf(gltf.scene, maxAniso);
      if (!parts.length) throw new Error('no meshes in ' + url);
      entries.set(spec.id, makeEntry(spec.id, 'glb', parts, spec.h, {
        fit: spec.fit, light: spec.light, tags: spec.tags, animated: false, themeId,
      }));
    } catch (e) {
      missing.push(spec.id);
      lazy.set(spec.id, spec);
    }
  });
  await Promise.all(jobs);

  // every procedural generator is also addressable by name, so a stage can ask
  // for `model:'holosign'` in any theme — also deferred until asked for
  for (let i = 0; i < PROC_PROPS.length; i++) {
    const name = PROC_PROPS[i];
    if (!entries.has(name) && !lazy.has(name)) {
      lazy.set(name, { proc: name, h: PROC_DEFAULT_H[name] || 1, fit: PROC_DEFAULT_FIT[name] });
    }
  }

  const lib = makeLibrary(themeId, entries, missing, lazy);
  _libCache.set(themeId, lib);
  return lib;
}

/**
 * Natural target size for a generator addressed directly by name (i.e. a stage
 * asking for `model:'holosign'` in a theme whose manifest does not list it).
 * `PROC_DEFAULT_FIT` names the ones measured by their LARGEST extent rather than
 * their height — a coin pile is 4 cm tall and 40 cm across.
 */
const PROC_DEFAULT_FIT = {
  // beam and rail are measured by their LENGTH, not their height
  beam: 'max', rail: 'max',
  coins: 'max', rock: 'max', debris: 'max', flags: 'max', cables: 'max',
  flowerbed: 'max', lavaRock: 'max', snowdrift: 'max', gear: 'max', pipe: 'max', icicle: 'max',
};
const PROC_DEFAULT_H = {
  torch: 0.80, brazier: 1.05, lantern: 0.95, chain: 2.60, banner: 2.30, flags: 5.30,
  crystal: 1.60, lavavent: 0.55, cables: 6.00, holosign: 2.30, debris: 1.00,
  crate: 1.00, barrel: 1.05, rock: 0.30, cage: 0.90, bench: 0.55, shelf: 2.50,
  anvil: 0.62, tool: 1.15, coins: 0.28, pillar: 2.60, statue: 2.20, archway: 1.60,
  mushroom: 0.55, flowerbed: 1.10, bush: 0.80, stump: 0.60, lavaRock: 0.70,
  icicle: 1.00, snowdrift: 1.30, cactus: 1.75, sandstone: 1.40, gear: 1.20,
  pipe: 2.60, flagpole: 4.60,
  post: 1.05, panel: 1.60, emblem: 1.05, godray: 6.00, chandelier: 1.70,
  beam: 4.00, rail: 2.60, sign: 2.00, buttress: 3.20, plant: 0.70,
  monolith: 2.80, arch: 1.60,
};

/**
 * Build a library with no file IO at all — every prop procedural. Useful for
 * tests, for the hub, and as the last-resort path if the asset folder is gone.
 * @param {string} themeId
 * @returns {object} the prop library
 */
export function proceduralLibrary(themeId, mats) {
  if (mats !== undefined) setPropsMaterials(mats);
  const cached = _libCache.get(themeId);
  if (cached) return cached;
  const manifest = THEME_MANIFEST[themeId] || THEME_MANIFEST.keep;
  const entries = new Map();
  const lazy = new Map();
  for (let i = 0; i < manifest.length; i++) lazy.set(manifest[i].id, manifest[i]);
  for (let i = 0; i < PROC_PROPS.length; i++) {
    const name = PROC_PROPS[i];
    if (!entries.has(name)) {
      entries.set(name, buildProcEntry(name, themeId, {
        proc: name, h: PROC_DEFAULT_H[name] || 1, fit: PROC_DEFAULT_FIT[name],
      }));
    }
  }
  return makeLibrary(themeId, entries, manifest.map((s) => s.id));
}

function makeLibrary(themeId, entries, missing, lazy) {
  /**
   * `lazy` holds prop SPECS that have not been turned into geometry yet.
   *
   * MEASURED (`_harness/_loadprofile.py`, verdant-1): building every manifest
   * entry plus every generator in PROC_PROPS up front cost 2920.8 ms of a
   * 7226 ms course load — the single largest phase of a load — and a course
   * places a handful of prop kinds, not fifty. `placeProps` reaches the
   * library only through `get(id)` / `procedural(id, …)`, so a prop is
   * generated the first time something actually asks for it and never again.
   */
  const specs = lazy || new Map();

  const realise = (id) => {
    const hit = entries.get(id);
    if (hit) return hit;
    const spec = specs.get(id);
    if (!spec) return null;
    const e = buildProcEntry(id, themeId, spec);
    entries.set(id, e);
    specs.delete(id);
    return e;
  };

  return {
    theme: themeId,
    entries,
    missing,
    get ids() {
      const out = Array.from(entries.keys());
      for (const k of specs.keys()) if (out.indexOf(k) < 0) out.push(k);
      return out;
    },
    has(id) { return entries.has(id) || specs.has(id); },
    get(id) { return realise(id); },

    /**
     * A standalone, non-instanced copy of a prop. Pass `light:true` to attach a
     * real point light — do that for the ONE hero torch by the checkpoint and
     * nowhere else; use placeProps (with a lightSink) for the rest.
     * @param {string} id
     * @param {object} [o] {scale, yaw, light:true, name}
     * @returns {THREE.Group|null}
     */
    make(id, o) {
      const e = entries.get(id);
      if (!e) return null;
      const cfg = o || null;
      const g = new THREE.Group();
      g.name = 'prop_' + id;
      for (let i = 0; i < e.parts.length; i++) {
        const m = new THREE.Mesh(e.parts[i].geometry, e.parts[i].material);
        m.castShadow = e.castShadow;
        m.receiveShadow = true;
        if (e.animated) { m.userData.noMerge = true; m.onBeforeRender = tickTime; }
        g.add(m);
      }
      /* `light:true` is opt-IN now. A hero torch by a checkpoint is the one
       * place a real point light is worth it; everything else should register
       * a site with the stage budget via placeProps({lightSink}). */
      if (e.light && cfg && cfg.light === true) {
        const pl = new THREE.PointLight(e.light.color, e.light.intensity, e.light.distance, e.light.decay);
        pl.position.set(0, e.light.y, 0);
        pl.castShadow = false;
        g.add(pl);
      }
      const s = (cfg && cfg.scale) || 1;
      g.scale.setScalar(s);
      if (cfg && cfg.yaw) g.rotation.y = cfg.yaw;
      return g;
    },

    /** Build a procedural prop directly, bypassing the manifest. */
    procedural(name, params, targetH) {
      if (!PROC[name]) return null;
      const e = buildProcEntry(name, themeId, {
        proc: name, params, h: targetH || PROC_DEFAULT_H[name] || 1, fit: PROC_DEFAULT_FIT[name],
      });
      entries.set('proc:' + name + ':' + (targetH || 0), e);
      return e;
    },

    dispose() {
      for (const e of entries.values()) {
        for (let i = 0; i < e.parts.length; i++) e.parts[i].geometry.dispose();
      }
      entries.clear();
      specs.clear();
    },
  };
}

/**
 * Authored deco intent -> procedural-generator params.
 *
 * `procedural(name, params, h)` has always taken a params object, but nothing
 * ever built one: no course module in the repo writes `params:` (verified by
 * grep across runtime/data), so every knob a generator exposed was dead and
 * every generator ran on its defaults. keep.js's god rays are the case that
 * made it visible — they authored `tint` and `opacity: 0.16` and got the
 * hard-coded GODRAY_GAIN and the theme glow colour instead, which is half of
 * why the Keep blew out.
 *
 * The two aliases below are the vocabulary course data already uses; anything
 * under an explicit `params` still wins.
 */
function procParams(def) {
  const explicit = def.params;
  const out = {};
  if (def.tint !== undefined) out.color = def.tint;
  if (def.opacity !== undefined) out.gain = def.opacity;
  if (explicit) for (const k in explicit) out[k] = explicit[k];
  return out;
}

// ---------------------------------------------------------------------------
// placeProps
// ---------------------------------------------------------------------------
/**
 * Instanced, deterministic prop placement.
 *
 * Each def scatters `count` copies inside `spread` metres of `p`, with yaw and
 * scale jitter drawn from the seeded RNG. Everything with the same (prop,
 * material) collapses into ONE InstancedMesh, so a hundred crates is one draw
 * call, not a hundred.
 *
 * def: {kind:'deco', p:[x,y,z], model?, kindOf?, scale?, count?, spread?, seed?,
 *       rot?, jitter?, yJitter?, light?}
 *   model / kindOf  prop id, or the name of a procedural generator
 *   scale           base scale multiplier (default 1)
 *   count           copies (default 1)
 *   spread          scatter radius in metres (default 0 = exactly at p)
 *   seed            per-def seed; omit and the def's position hashes into one
 *   rot             fixed yaw in radians; omit for a random yaw
 *   jitter          scale jitter, 0..1 (default 0.18)
 *   yJitter         vertical jitter in metres (default 0)
 *   light           false to suppress this def's point lights
 *
 * LIGHTS. A torch is not worth a THREE.PointLight: three.js evaluates every
 * light in the scene per fragment, so a row of eight braziers taxes every
 * material within range of any of them. Pass `opts.lightSink` — Stage exposes
 * exactly this as `stage.addLightSite` — and each site is handed to the stage's
 * fixed light-pool budget instead, which points a small number of real lights
 * at whichever fixtures the player is nearest. Without a sink this falls back
 * to real point lights, and `maxLights` defaults to 2 rather than 8; the props
 * that miss out keep their emissive geometry and still read as lit.
 *
 * @param {THREE.Object3D} stageGroup  where the instanced meshes are parented
 * @param {object[]} defs
 * @param {object} propLibrary from loadProps / proceduralLibrary
 * @param {function} [rng] ()=>float01; omit and one is seeded per def
 * @param {object} [opts] {maxLights:2, shadows:true, lightSink:fn}
 * @returns {{meshes:THREE.InstancedMesh[], lights:THREE.PointLight[], sites:object[],
 *            instances:number, skipped:string[], dispose:function}}
 */
export function placeProps(stageGroup, defs, propLibrary, rng, opts) {
  const _t0 = _pnow();
  const o = opts || {};
  const sink = typeof o.lightSink === 'function' ? o.lightSink : null;
  const maxLights = o.maxLights === undefined ? 2 : o.maxLights;
  const shadows = o.shadows !== false;
  const out = { meshes: [], lights: [], sites: [], instances: 0, skipped: [], dispose: null };
  if (!stageGroup || !defs || !defs.length || !propLibrary) {
    out.dispose = () => {};
    return out;
  }

  // bucket key -> {entry, partIndex, mats:[Matrix4 arrays]}
  const buckets = new Map();
  const lightSites = [];

  for (let di = 0; di < defs.length; di++) {
    const def = defs[di];
    if (!def) continue;
    const id = def.model || def.kindOf;
    if (!id) continue;
    let entry = propLibrary.get(id);
    if (!entry && PROC[id]) entry = propLibrary.procedural(id, procParams(def), def.h);
    if (!entry) { if (out.skipped.indexOf(id) < 0) out.skipped.push(id); continue; }

    const p = def.p || [0, 0, 0];
    const seed = def.seed !== undefined
      ? (def.seed | 0)
      : hashString(id + ':' + (p[0] | 0) + ':' + (p[1] | 0) + ':' + (p[2] | 0) + ':' + di);
    const rand = rng || mulberry32(seed);
    const count = Math.max(1, Math.min(256, def.count || 1));
    const spread = def.spread || 0;
    const baseScale = def.scale || 1;
    const jitter = def.jitter === undefined ? 0.18 : def.jitter;
    const yJit = def.yJitter || 0;

    for (let i = 0; i < count; i++) {
      const a = rand() * Math.PI * 2;
      const r = spread > 0 ? Math.sqrt(rand()) * spread : 0;
      const x = (p[0] || 0) + Math.cos(a) * r;
      const z = (p[2] || 0) + Math.sin(a) * r;
      const y = (p[1] || 0) + (yJit ? (rand() - 0.5) * 2 * yJit : 0);
      const yaw = def.rot !== undefined && def.rot !== null
        ? (typeof def.rot === 'number' ? def.rot : (def.rot[1] || 0)) + (rand() - 0.5) * 0.35
        : rand() * Math.PI * 2;
      const s = baseScale * (1 + (rand() - 0.5) * 2 * jitter);
      const tilt = (rand() - 0.5) * (def.tilt === undefined ? 0.05 : def.tilt);

      _v0.set(x, y, z);
      _q0.setFromEuler(new THREE.Euler(tilt, yaw, tilt * 0.6));
      _s0.set(s, s, s);
      _m0.compose(_v0, _q0, _s0);

      for (let pi = 0; pi < entry.parts.length; pi++) {
        const key = entry.id + '#' + pi;
        let b = buckets.get(key);
        if (!b) { b = { entry, pi, m: [] }; buckets.set(key, b); }
        const arr = new Float32Array(16);
        arr.set(_m0.elements);
        b.m.push(arr);
      }
      out.instances++;

      if (entry.light && def.light !== false) {
        lightSites.push({ x, y: y + entry.light.y * s, z, light: entry.light, s });
      }
    }
  }

  /* --- decor budget -------------------------------------------------------
   *
   * Decor is the single largest consumer of both draw calls and triangles in a
   * built course (measured on verdant-1: 372 of 890 draws and 462k of 930k
   * triangles came from the prop container), and it is the part of the frame a
   * player never lands on.  The perf gate allows 260 draws / 450k triangles for
   * the WHOLE frame, so decor gets a stated slice of that and thins itself to
   * fit rather than silently spending the course's entire budget.
   *
   * Thinning is uniform across buckets — density drops evenly instead of one
   * species vanishing — and every bucket keeps at least one instance, so no
   * prop kind ever disappears from the course.
   */
  const budget = o.budget || null;
  if (budget) {
    const list = Array.from(buckets.values());
    const triOf = (b) => {
      const g = b.entry.parts[b.pi].geometry;
      if (!g || !g.attributes || !g.attributes.position) return 0;
      return (g.index ? g.index.count : g.attributes.position.count) / 3;
    };
    for (const b of list) b.tri = triOf(b);
    const totalTris = () => list.reduce((s, b) => s + b.keep * b.tri, 0);
    for (const b of list) b.keep = b.m.length;

    if (Number.isFinite(budget.tris) && budget.tris > 0 && totalTris() > budget.tris) {
      let lo = 0, hi = 1;
      for (let it = 0; it < 24; it++) {
        const f = (lo + hi) * 0.5;
        for (const b of list) b.keep = Math.max(1, Math.round(b.m.length * f));
        if (totalTris() > budget.tris) hi = f; else lo = f;
      }
      for (const b of list) b.keep = Math.max(1, Math.round(b.m.length * lo));
      out.thinnedTris = true;
    }

    /* Draws: a prop kind's FIRST part is its body and is never dropped; the
       trailing parts are trim (spots, bands, glints).  When the container is
       still over its draw budget the trim goes, deepest part index first. */
    if (Number.isFinite(budget.draws) && budget.draws > 0 && list.length > budget.draws) {
      const trim = list.filter((b) => b.pi > 0).sort((a, b) => (b.pi - a.pi) || (a.m.length - b.m.length));
      let over = list.length - budget.draws;
      for (let i = 0; i < trim.length && over > 0; i++) { trim[i].keep = 0; over--; }
      out.droppedTrim = true;
    }
    for (const b of list) if (b.keep < b.m.length) b.m.length = Math.max(0, b.keep);
  }

  // --- commit instanced meshes ---------------------------------------------
  const instMat = new THREE.Matrix4();
  for (const b of buckets.values()) {
    const n = b.m.length;
    if (n === 0) continue;
    const part = b.entry.parts[b.pi];
    const im = new THREE.InstancedMesh(part.geometry, part.material, n);
    im.name = 'props:' + b.entry.id + ':' + b.pi;
    for (let i = 0; i < n; i++) {
      instMat.fromArray(b.m[i]);
      im.setMatrixAt(i, instMat);
    }
    im.instanceMatrix.needsUpdate = true;
    im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    const rad = part.geometry.boundingSphere ? part.geometry.boundingSphere.radius : b.entry.radius;
    /* Small clutter never casts a shadow — feedback_forgeflow_games_fps.  The
       shadow pass is a SECOND full draw of every caster, so decor has to earn
       it: 1.5 m is roughly "big enough that its shadow is a shape, not a
       smudge" and matches world/course.js SHADOW_MIN_RADIUS. */
    im.castShadow = shadows && rad >= 1.5 && b.entry.castShadow && part.material.transparent !== true;
    im.receiveShadow = shadows && part.material.transparent !== true;
    im.frustumCulled = true;
    im.computeBoundingSphere();
    im.updateMatrix();
    im.matrixAutoUpdate = false;
    if (b.entry.animated) {
      im.userData.noMerge = true;
      im.onBeforeRender = tickTime;
      im.renderOrder = part.material.transparent ? 2 : 0;
    }
    stageGroup.add(im);
    out.meshes.push(im);
  }

  // --- light budget ---------------------------------------------------------
  // With a sink (Stage.addLightSite) EVERY fixture is registered: the stage owns
  // one small pool of real lights and moves it to whatever is nearest, so the
  // count on screen is bounded no matter how many torches a stage places.
  if (sink) {
    for (let i = 0; i < lightSites.length; i++) {
      const site = lightSites[i];
      const rec = sink({
        p: [site.x, site.y, site.z],
        color: site.light.color,
        intensity: site.light.intensity,
        distance: site.light.distance * site.s,
        decay: site.light.decay,
      });
      if (rec) out.sites.push(rec);
    }
  } else {
    // No sink: fall back to real lights, but only the first `maxLights` in def
    // order (deterministic). The rest keep their emissive geometry, so they
    // still read as lit without costing a per-fragment light term.
    const nLights = Math.min(maxLights, lightSites.length);
    for (let i = 0; i < nLights; i++) {
      const site = lightSites[i];
      const pl = new THREE.PointLight(site.light.color, site.light.intensity, site.light.distance * site.s, site.light.decay);
      pl.position.set(site.x, site.y, site.z);
      pl.castShadow = false;
      stageGroup.add(pl);
      out.lights.push(pl);
    }
  }

  PROP_STATS.placeMs += _pnow() - _t0;
  PROP_STATS.placed += out.instances | 0;

  out.dispose = function () {
    for (let i = 0; i < out.meshes.length; i++) {
      const m = out.meshes[i];
      if (m.parent) m.parent.remove(m);
      m.dispose();
    }
    for (let i = 0; i < out.lights.length; i++) {
      const l = out.lights[i];
      if (l.parent) l.parent.remove(l);
    }
    for (let i = 0; i < out.sites.length; i++) {
      const st = out.sites[i];
      if (st && typeof st.remove === 'function') st.remove();
    }
    out.meshes.length = 0;
    out.lights.length = 0;
    out.sites.length = 0;
  };
  return out;
}

/** Release every cached prop material AND prop library owned by this module. */
export function disposeProps() {
  invalidatePropLibrary();
  for (const m of _matCache.values()) m.dispose();
  _matCache.clear();
}
