// core/weapons/weapon_meshes.js [A4] — FP weapon GLB load + material repair +
// sockets (architecture §3.11, frozen: loadWeaponGLB(id) → Promise<Group>).
//
// GLB convention (produced by tools/a4_build_fp_weapons.py — fix the
// generator, never the artifact):
//   - origin at the grip, barrel down −Z, metres scale;
//   - sight line on the x=0 plane, top of sight post at y = view.sightY
//     EXACTLY (pixel-exact ADS alignment is BY CONSTRUCTION: at ADS the
//     weapon group sits at [0, -sightY, z], putting the sight on the
//     viewmodel camera's center ray — VT §5's 2-px-off red-dot tell);
//   - empties named SOCKET_muzzle / SOCKET_eject baked in (fallback: the
//     data offsets in weapon_data view.muzzle / view.eject);
//   - Draco compressed, ≤250 KB each (Part 5 budget), arms included.
//
// Doctrine §1/§3 discipline: strips any GLB-embedded light; defensive Meshy
// material repair (emissive-as-albedo bug) even though the build script
// authors materials — the next regenerated asset arrives broken the same way.
// On failure: HONEST dev placeholder (screaming magenta, unmistakably not a
// gun) + window.__FFG_FALLBACKS__ push — ship is BLOCKED while non-empty
// (doctrine §7). A primitive composition is never silently shipped as final.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { WEAPONS } from "./weapon_data.js";

const GLB_BASE = new URL("../../assets/weapons/", import.meta.url);
const DRACO_BASE = new URL("../../assets/vendor/draco/", import.meta.url).href;

let _loader = null;
function loader() {
  if (!_loader) {
    _loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_BASE);
    _loader.setDRACOLoader(draco);
  }
  return _loader;
}

const cache = new Map(); // id → Promise<THREE.Group|placeholder Group>

function pushFallback(msg) {
  try {
    if (typeof window !== "undefined") {
      window.__FFG_FALLBACKS__ = window.__FFG_FALLBACKS__ || [];
      if (!window.__FFG_FALLBACKS__.includes(msg)) window.__FFG_FALLBACKS__.push(msg);
    }
  } catch (e) { /* headless */ }
  console.warn("[A4]", msg);
}

// Doctrine §1 defensive repair + light strip + shadow discipline.
function repair(group) {
  const doomedLights = [];
  group.traverse((o) => {
    if (o.isLight) { doomedLights.push(o); return; } // NEVER a light outside the pool
    if (o.isMesh) {
      o.castShadow = false;    // viewmodel never casts into the world
      o.receiveShadow = false; // and never samples the 1024 moon map at 30 cm
      o.frustumCulled = false; // camera-space rig; bounds vs frustum lie
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        // Meshy export bug class: albedo bound as full-strength emissive.
        if (m.emissiveMap && m.emissiveMap === m.map) {
          m.emissiveMap = null;
          if (m.emissive) m.emissive.setRGB(0, 0, 0);
        }
        if (m.emissiveIntensity == null || m.emissiveIntensity > 1.001) m.emissiveIntensity = 1;
        if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
        m.needsUpdate = true;
      }
    }
  });
  for (const l of doomedLights) l.parent && l.parent.remove(l);
}

function findSocket(group, name) {
  let hit = null;
  group.traverse((o) => { if (!hit && o.name === name) hit = o; });
  return hit;
}

// Honest dev placeholder: a magenta slab that could never be mistaken for a
// finished gun. It exists so the game keeps RUNNING while the asset gap is
// visible and ship-blocked — not so the gap can hide.
function makePlaceholder(id) {
  const g = new THREE.Group();
  g.name = `wpn_placeholder_${id}`;
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff00ff, roughness: 0.4, metalness: 0.0,
    emissive: 0x550055, wireframe: false,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.10, 0.45), mat);
  body.position.set(0, 0.06, -0.18);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.05), mat);
  grip.position.set(0, -0.05, -0.02);
  g.add(body, grip);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  const view = (WEAPONS[id] && WEAPONS[id].view) || {};
  g.userData.muzzleOffset = (view.muzzle || [0, 0.05, -0.5]).slice();
  g.userData.ejectOffset = (view.eject || [0.03, 0.05, -0.1]).slice();
  g.userData.placeholder = true;
  g.userData.weaponId = id;
  return g;
}

/**
 * Load (and cache) the FP viewmodel GLB for a weapon id. Resolves to a
 * THREE.Group with userData:
 *   { weaponId, muzzle: Object3D|null, eject: Object3D|null,
 *     muzzleOffset:[3], ejectOffset:[3], placeholder?:true }
 * Callers clone via SkeletonUtils/clone() if they need independent copies;
 * viewmodel.js uses the cached prototype directly (single consumer).
 */
export async function loadWeaponGLB(id) {
  if (cache.has(id)) return cache.get(id);
  const p = (async () => {
    const w = WEAPONS[id];
    const rel = (w && w.view && w.view.glb) ? w.view.glb.split("/").pop() : `${id}.glb`;
    const url = new URL(rel, GLB_BASE).href;
    try {
      const gltf = await loader().loadAsync(url);
      const group = gltf.scene || (gltf.scenes && gltf.scenes[0]);
      if (!group) throw new Error("GLB contained no scene");
      repair(group);
      if (w && w.view && w.view.scale && w.view.scale !== 1) {
        group.scale.setScalar(w.view.scale);
      }
      const muzzle = findSocket(group, "SOCKET_muzzle");
      const eject = findSocket(group, "SOCKET_eject");
      group.userData.weaponId = id;
      group.userData.muzzle = muzzle;
      group.userData.eject = eject;
      group.userData.muzzleOffset = (w && w.view && w.view.muzzle ? w.view.muzzle : [0, 0.05, -0.5]).slice();
      group.userData.ejectOffset = (w && w.view && w.view.eject ? w.view.eject : [0.03, 0.05, -0.1]).slice();
      if (!muzzle) console.warn(`[A4] ${id}.glb has no SOCKET_muzzle — using weapon_data view.muzzle offset`);
      return group;
    } catch (err) {
      pushFallback(`A4: FP weapon GLB '${id}' failed to load (${err && err.message}) — dev placeholder active, ship blocked`);
      return makePlaceholder(id);
    }
  })();
  p.then((g) => { p._resolved = g; }, () => {}); // sync reader for prewarmables
  cache.set(id, p);
  return p;
}

// ---- private extras ---------------------------------------------------------

/** Prototypes loaded so far (resolved only) — viewmodel.prewarmables() source.
 *  Prewarm runs in boot phase 5, after phase 4 awaited warden+pike, so the
 *  mission-loadout prototypes are always present here by then. */
export function loadedPrototypes() {
  const out = [];
  for (const p of cache.values()) {
    if (p && p._resolved) out.push(p._resolved);
  }
  return out;
}
