// core/weapons/world_weapon.js [A8/A4 shared] — THIRD-PERSON / WORLD weapon
// models. ONE implementation of the Meshy 3P weapon prep, used by:
//   - core/chars/soldiers.js  (guns in the bots' hands, barrel on +Z)
//   - loot pickups / dropped guns on the ground (buildWorldWeapon, below)
//
// ============================================================================
// PUBLIC API
// ============================================================================
//
//   buildWorldWeapon(weaponId) -> THREE.Group            (SYNCHRONOUS return)
//     weaponId : "warden" | "vesper" | "breaker" | "corvus" | "pike"
//                (weapon_data.js WEAPONS ids; unknown id -> magenta stand-in
//                box + a window.__FFG_FALLBACKS__ entry, never a silent gap)
//     The group is the low-detail third-person model of that weapon:
//       - ORIGIN AT THE GRIP (pistol-grip anchor; the bot's palm point),
//       - BARREL ALONG -Z (muzzle forward = -Z, like a three.js camera),
//         +Y is "up" (sights/top rail up, magazine down), +X is the gun's
//         right-hand side (the side the ejection port is on),
//       - UNITS ARE METRES at real size (see WORLD_WEAPON_INFO[id].length),
//       - castShadow = false on every mesh (pickups are not shadow casters);
//         receiveShadow = true (they darken in the same shadows as the ground),
//       - frustumCulled = TRUE on every mesh with real bounding volumes (it
//         culls normally; mesh bounds come from the shared geometry and move
//         with the group's transform),
//       - GEOMETRY AND MATERIALS ARE SHARED across every clone: one cached
//         prototype, clone(true) per call, ZERO per-call geometry/material
//         allocation (measured: 48 clones -> 1 geometry, 1 material). Instance
//         as many as you like. The material is one "pickup" variant per weapon
//         (derived once from the bot-gun material: same textures, albedo x1.25,
//         metalness x0.45 so a gun on night asphalt is not a black cut-out).
//         NEVER mutate or dispose the shared materials/geometry. If a pickup
//         needs its own glow/colour, add a separate additive sprite/mesh or
//         clone the one material you touch.
//     CACHING / TIMING: a per-weapon prototype is built once (GLB fetch + Draco
//     decode + albedo remap). If the prototype is already cached when you call,
//     the returned group already contains its mesh (a clone). If it is NOT yet
//     cached, the group is returned EMPTY and its mesh is added to it, in
//     place, the moment the GLB finishes loading (group.userData.brReady flips
//     true then). Nothing for the caller to do either way, but to avoid ever
//     seeing a gunless pickup, `await preloadWorldWeapons()` at match start.
//
//   preloadWorldWeapons() -> Promise<void>
//     Resolves once the prototypes for ALL FIVE weapons are cached (and
//     WORLD_WEAPON_INFO is exact). Idempotent / shared promise-per-kind; safe
//     to call from several places. Never rejects: a kind whose GLB fails to
//     load is reported to window.__FFG_FALLBACKS__ + console.error and the
//     caller still gets a (magenta placeholder) group, matching soldiers.js.
//     soldiers.js preloads all five kinds in its own ensureLoaded(), so by the
//     time a match is running the cache is normally already warm.
//
//   WORLD_WEAPON_INFO[weaponId] = {
//     length,          // metres, muzzle to butt (along Z)
//     groundOffsetY,   // metres: add this to the group's y to make the
//                      //   LOWEST point (magazine / grip / stock) of the model,
//                      //   as built (upright, sights up), rest on y = 0
//     groundOffsetYSide, // same, but for the gun lying ON ITS LEFT SIDE
//                      //   (group.rotation.z = +PI/2, i.e. sights toward -X)
//     width, height,   // metres, bounding-box extents (x / y) as built
//     box,             // [minx,miny,minz, maxx,maxy,maxz] in group space
//   }
//     Exported as a mutable table. It is pre-filled with the measured values
//     (so it is usable before any GLB loads) and re-derived from the real
//     precise bounding box when each prototype finishes loading, mutating the
//     SAME entry objects (hold a reference or re-read it, both stay valid).
//
//   Also exported for soldiers.js (one implementation, no copies):
//     WPN_KINDS, WPN_GLB, WPN_LEN, WPN_FLIP, WPN_GRIP, WPN_GRIP_SHIFT, WPN_ONE_HAND, WPN_KIND (tables)
//     prepWeaponProto(kind) -> Promise<Group>  (the BOT proto: barrel on +Z,
//         origin at the grip anchor, userData.brHold = support-hand height,
//         materials repaired, castShadow=true, frustumCulled=false)
//     getWeaponProtoSync(kind) -> Group | null (the proto if already resolved)
//     buildGunMaps / repairGunMaterial (albedo-luminance classifier remap)
//     createSupportHandIK(actorRoot) / PISTOL_SUPPORT  (3P pistol support-hand
//         IK, see the section of that name below; soldiers.js drives it)
//
// wiring: weapon_meshes.js will `export { buildWorldWeapon } from
// "./world_weapon.js"` (the viewmodel lane adds that line; this file never
// imports weapon_meshes.js so there is no cycle).
//
// MODULE-INSTANCE QUIRK (boot imports modules with ?v=N, sibling static
// imports carry no query, so two instances of this file can coexist): nothing
// here relies on a module-level singleton for CORRECTNESS. The prototype cache
// is parked on globalThis.__BR_WPN3P__ so every instance shares it (important:
// actor.js's loadGLB() hands back ONE gltf.scene per URL, and two independent
// preps of that scene would steal it from each other). Each prep also works
// on gltf.scene.clone(true), never the cached scene itself.
// ============================================================================

import * as THREE from "three";
import { loadGLB } from "../chars/actor.js";

// ---------------------------------------------------------------------------
// 3P weapon protos — transliterated from last-circle weapons.js (the proven
// recipe; memory: transliterate ports, no prose round-trip).
// ---------------------------------------------------------------------------
/** Model kinds, one per weapon class. */
export const WPN_KINDS = ["ar", "smg", "sniper", "pistol", "shotgun"];

// Game-root-relative GLB path per kind. ar/smg/sniper are the original Draco'd
// last-circle Meshy weapons; pistol/shotgun are the same pipeline (gltf-transform
// draco of last-circle's formerly unused wpn_pistol / wpn_shotgun).
export const WPN_GLB = {
  ar: "assets/chars/wpn3p_ar.glb",
  smg: "assets/chars/wpn3p_smg.glb",
  sniper: "assets/chars/wpn3p_sniper.glb",
  pistol: "assets/weapons/wpn3p_pistol.glb",
  shotgun: "assets/weapons/wpn3p_shotgun.glb",
};
// Overall length in metres. iter06: the old set (0.62 / 0.50 / 0.95) was
// sub-scale — a 0.62 m "assault rifle" is a prop, and it is also WHY the
// support hand had nothing to hold: the grip anchor sits 0.26 m behind the
// muzzle while the Mixamo rifle clips put the support fist ~0.35 m forward of
// the firing fist, so the handguard physically could not reach it (measured
// live this session: support fist at 0.372 m in weapon space vs a 0.322 m
// forward extent). These are the real lengths of the classes they represent —
// M4-with-stock-out 0.84, MP5-class 0.66, DMR 1.05 — which puts the support
// fist at ~85% of each weapon's forward extent, i.e. ON the handguard.
// pistol 0.22 (full-size 9 mm), shotgun 1.0 (pump, short stock).
export const WPN_LEN = { ar: 0.84, smg: 0.66, sniper: 1.05, pistol: 0.22, shotgun: 1.0 };
// MANUAL 180° overrides (last-circle owner playtest, verified by screenshots):
// the muzzle-thin/stock-dense heuristic picks WRONG on the AR — its rail/mag
// block out-clusters the stock. Same source GLBs, same override.
// SMG: measured in the viewer (iter A8-world, 2026) — with the heuristic alone
// the Vesper's suppressor/barrel ended up on -Z, i.e. the bot held it BACKWARDS.
export const WPN_FLIP = { ar: true, smg: true };
// Explicit GRIP ANCHOR where "dense cluster in the bottom third" lands on the
// wrong part: the pump shotgun's stock heel is its lowest point, so the bottom-
// third centroid sits on the BUTT PAD (measured: 0.06 m in front of the butt on
// a 1.0 m gun), which would put the bot's palm on the stock heel. fz = how far
// along the gun from the butt (fraction of overall length), fy = height above
// the lowest point (fraction of overall height): the wrist of the stock, just
// behind the receiver, which is where a right hand really holds a pump gun.
export const WPN_GRIP = { shotgun: { fz: 0.255, fy: 0.575 } };
// How far (m, along the barrel) the palm sits AHEAD of the grip anchor. The
// rifle clips hold the support fist 0.31 m ahead of the firing fist (measured
// live in weapon space: support knuckle z 0.40-0.45, firing knuckle z 0.08), and
// the default +0.06 ("stock clears the arm") was tuned on the AR/SMG/DMR. On the
// pump shotgun it left the support hand 4 cm PAST the forend's front tip, so it
// takes a NEGATIVE shift: the gun rides forward and the forend (z 0.085..0.365
// from the anchor) comes under the support hand (z 0.40) instead of behind it.
export const WPN_GRIP_SHIFT = { shotgun: -0.045 };
// Kinds too short for the rifle-clip support-hand reach: actor.js always solves
// the support hand ~0.37 m ahead of the palm, i.e. ~0.19 m PAST a 0.22 m pistol's
// muzzle. userData.brOneHand = 1 marks the proto; soldiers.js then runs the
// support-hand IK below (createSupportHandIK) for bots holding it.
export const WPN_ONE_HAND = { pistol: true };
// weapon id → 3P model kind (R4 ids; heavies carry warden → ar)
export const WPN_KIND = {
  warden: "ar", vesper: "smg", breaker: "shotgun", corvus: "sniper", pike: "pistol",
};

// Shared proto cache, parked on globalThis (see MODULE-INSTANCE QUIRK above).
// NEVER stash the proto in userData: Object3D.copy JSON-stringifies userData on
// every clone, and a THREE.Group in there is circular — measured as a pageerror
// storm on spawn. (Plain numbers / number arrays in userData are fine.)
const _G = (globalThis.__BR_WPN3P__ = globalThis.__BR_WPN3P__ ||
  { promises: new Map(), ready: new Map() });
const WPN_PROTO_CACHE = _G.promises; // kind -> Promise<Group>
const WPN_PROTO_READY = _G.ready;    // kind -> Group (once resolved)

// ---------------------------------------------------------------------------
// 3P WEAPON MATERIAL — parkerised steel + polymer furniture (iter06, ranked
// fix 7: "UNACTIONED FOR THREE CONSECUTIVE ITERATIONS", 3/3 critics).
//
// The defect, measured this session rather than assumed: the Meshy source GLBs
// ship a BAKED SATURATED albedo — the AR's baseColorTexture means sRGB
// (106,116,51) over the 69% of its texels with saturation > 0.30, i.e. the
// whole receiver/handguard/stock is highlighter lime; the sniper's is orange-
// brown. The old repair here only touched metalness/roughness FACTORS, so the
// lime went to the screen untouched and read as a missing-texture fallback.
// Its metallicRoughness map is also a real map (mean G 102/255 → roughness
// 0.40, B 9/255 → metalness 0.035), so factor 0.35/0.55 multiplied DOWN to
// roughness ~0.22 / metalness ~0.01: glossy dielectric, i.e. lime PLASTIC.
//
// Fix at the generator, not the artifact (doctrine §1/§3): remap the authored
// albedo through a luminance classifier into the same treatment the FP guns
// get (weapon_meshes.js repair(): read the maps as authored, let roughness
// vary PER PART, no albedo blowout). Dark source texels are the barrel/optic/
// magazine → parkerised phosphate steel; bright source texels are the painted
// furniture → black polymer. The two albedos sit close together (a cohesive
// dark firearm); the READ comes from the generated roughness/metalness map,
// which is VT §3's "distinct roughness per part" done per texel. Source tonal
// variation survives as a brightness modulation so the result is not a flat
// grey slab, and the GLB's normal map keeps carrying the real surface detail.
// Neutral-to-faintly-WARM greys: the night scene is lit by a deep-blue
// hemisphere (0x4c6486 @ 4.6) + a blue moon, so a cool-grey albedo (85,88,92 /
// 66,68,71 — the original values) rendered as royal-blue plastic in shadow
// (measured live on the Warden / Breaker). Warm-neutral albedo under blue
// light lands on gunmetal.
const GUN_STEEL = [92, 89, 85];    // parkerised receiver/barrel, sRGB
const GUN_POLY = [70, 68, 65];     // black polymer furniture, sRGB
const GUN_STEEL_R = 0.40, GUN_STEEL_M = 0.70;
const GUN_POLY_R = 0.76, GUN_POLY_M = 0.05;

/** Build {albedo, orm} CanvasTextures from an authored baseColor texture.
 *  Returns null when there is nothing to read (headless, or a mapless
 *  material) — the caller then falls back to flat gunmetal. */
export function buildGunMaps(src) {
  if (!src || !src.image || typeof document === "undefined") return null;
  const img = src.image;
  const w = img.width | 0, h = img.height | 0;
  if (!w || !h) return null;
  const ac = document.createElement("canvas");
  ac.width = w; ac.height = h;
  const ag = ac.getContext("2d", { willReadFrequently: true });
  if (!ag) return null;
  ag.drawImage(img, 0, 0, w, h);
  const idat = ag.getImageData(0, 0, w, h);
  const px = idat.data;
  const n = w * h;

  // Percentile-normalise luminance so ONE classifier works across the whole
  // set (the AR is bright-lime dominant, the SMG is dark-dominant): a fixed
  // threshold would classify a whole weapon as one material.
  const hist = new Uint32Array(256);
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    const L = 0.2126 * px[j] + 0.7152 * px[j + 1] + 0.0722 * px[j + 2];
    lum[i] = L;
    hist[L | 0]++;
  }
  let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.05) { lo = v; break; } }
  acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.95) { hi = v; break; } }
  const span = Math.max(8, hi - lo);

  const oc = document.createElement("canvas");
  oc.width = w; oc.height = h;
  const og = oc.getContext("2d");
  if (!og) return null;
  const odat = og.createImageData(w, h);
  const opx = odat.data;
  for (let i = 0; i < n; i++) {
    let t = (lum[i] - lo) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    let u = (t - 0.35) / 0.30;              // smoothstep → polymer weight
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const pw = u * u * (3 - 2 * u);
    const f = 0.85 + 0.30 * t;              // keep the authored tonal variation
    const j = i * 4;
    px[j] = Math.min(255, (GUN_STEEL[0] + (GUN_POLY[0] - GUN_STEEL[0]) * pw) * f);
    px[j + 1] = Math.min(255, (GUN_STEEL[1] + (GUN_POLY[1] - GUN_STEEL[1]) * pw) * f);
    px[j + 2] = Math.min(255, (GUN_STEEL[2] + (GUN_POLY[2] - GUN_STEEL[2]) * pw) * f);
    px[j + 3] = 255;
    opx[j] = 255;                                                     // (unused AO)
    opx[j + 1] = (255 * (GUN_STEEL_R + (GUN_POLY_R - GUN_STEEL_R) * pw)) | 0;
    opx[j + 2] = (255 * (GUN_STEEL_M + (GUN_POLY_M - GUN_STEEL_M) * pw)) | 0;
    opx[j + 3] = 255;
  }
  ag.putImageData(idat, 0, 0);
  og.putImageData(odat, 0, 0);

  const albedo = new THREE.CanvasTexture(ac);
  const orm = new THREE.CanvasTexture(oc);
  for (const t2 of [albedo, orm]) {
    // glTF textures are flipY:false and the pixels were read/written in the
    // SOURCE orientation — copying the sampler state keeps the UVs valid.
    t2.flipY = src.flipY;
    t2.wrapS = src.wrapS; t2.wrapT = src.wrapT;
    t2.repeat.copy(src.repeat); t2.offset.copy(src.offset);
    t2.anisotropy = src.anisotropy;
    if (src.channel !== undefined) t2.channel = src.channel;
    t2.needsUpdate = true;
  }
  albedo.colorSpace = THREE.SRGBColorSpace;
  orm.colorSpace = THREE.NoColorSpace;
  return { albedo, orm };
}

export function repairGunMaterial(mat) {
  if (!mat || mat.userData.__brGun) return;
  mat.userData.__brGun = true;
  // Meshy's emissive channel is the albedo-as-emissive export bug class — a
  // gun that glows cannot darken in shadow and feeds the bloom threshold.
  mat.emissiveMap = null;
  if (mat.emissive) mat.emissive.setHex(0x000000);
  if (mat.emissiveIntensity !== undefined) mat.emissiveIntensity = 0;
  // W1's iter05 lesson, transliterated: envMapIntensity 1.0 on metal mirrors
  // the sky PMREM and renders as chrome. 0.5 keeps the wet-metal cue.
  mat.envMapIntensity = 0.5;
  let built = null;
  try {
    built = buildGunMaps(mat.map);
  } catch (e) {
    console.warn("[world_weapon] 3P gun albedo remap failed — flat gunmetal", e);
  }
  if (built) {
    mat.map = built.albedo;
    mat.roughnessMap = built.orm;
    mat.metalnessMap = built.orm;
    mat.roughness = 1.0;   // the generated map is authoritative for both
    mat.metalness = 1.0;
    if (mat.color) mat.color.setHex(0xffffff);
  } else {
    mat.map = null;
    mat.roughnessMap = null;
    mat.metalnessMap = null;
    if (mat.color) mat.color.setHex(0x494c50);
    mat.roughness = 0.52;
    mat.metalness = 0.45;
  }
  mat.needsUpdate = true;
}

/** The BOT prototype for a kind (cached, shared across module instances):
 *  Group[ model ] with the barrel on +Z, origin at the grip anchor, metres,
 *  materials repaired, userData { brHold, brGripShiftZ, brLen, brOneHand }. */
export function prepWeaponProto(kind) {
  if (!WPN_PROTO_CACHE.has(kind)) {
    const p = _prepWeaponProto(kind).then((g) => {
      WPN_PROTO_READY.set(kind, g);
      try { _registerInfo(kind, g); } catch (e) { console.warn("[world_weapon] info", e); }
      return g;
    });
    WPN_PROTO_CACHE.set(kind, p);
    // a failed load must be retryable by a later call, not cached forever
    p.catch(() => { if (WPN_PROTO_CACHE.get(kind) === p) WPN_PROTO_CACHE.delete(kind); });
  }
  return WPN_PROTO_CACHE.get(kind);
}

/** The resolved bot prototype, or null while it is still loading. */
export function getWeaponProtoSync(kind) {
  return WPN_PROTO_READY.get(kind) || null;
}

async function _prepWeaponProto(kind) {
  const gltf = await loadGLB(`./${WPN_GLB[kind]}`);
  // loadGLB's cache hands every caller the SAME gltf.scene: prep a clone (shares
  // geometry + materials) so a second prep can never reparent / re-transform it.
  const m = gltf.scene.clone(true);
  // Meshy "side view" renders at a 3/4 angle sometimes → barrel diagonal in
  // XZ. Search the yaw that minimizes cross-width so the barrel lands on +Z.
  const bb = new THREE.Box3(), sz = new THREE.Vector3();
  let bestYaw = 0, bestW = 1e9;
  for (let deg = 0; deg < 180; deg += 3) {
    m.rotation.y = (deg * Math.PI) / 180;
    m.updateMatrixWorld(true);
    bb.setFromObject(m).getSize(sz);
    if (sz.x < bestW) { bestW = sz.x; bestYaw = m.rotation.y; }
  }
  m.rotation.y = bestYaw;
  m.updateMatrixWorld(true);
  bb.setFromObject(m);
  // 180° ambiguity: muzzle end is thin (few verts), grip/stock end dense.
  {
    const zMin = bb.min.z, zMax = bb.max.z, third = (zMax - zMin) / 3;
    let front = 0, back = 0;
    const wp = new THREE.Vector3();
    m.traverse((o) => {
      if (!o.isMesh) return;
      const posA = o.geometry.attributes.position;
      const step = Math.max(1, Math.floor(posA.count / 2000));
      for (let i = 0; i < posA.count; i += step) {
        wp.fromBufferAttribute(posA, i).applyMatrix4(o.matrixWorld);
        if (wp.z > zMax - third) front++;
        else if (wp.z < zMin + third) back++;
      }
    });
    if (front > back) { m.rotation.y += Math.PI; m.updateMatrixWorld(true); }
  }
  if (WPN_FLIP[kind]) { m.rotation.y += Math.PI; m.updateMatrixWorld(true); }
  // normalize to class length
  const size = bb.setFromObject(m).getSize(new THREE.Vector3());
  const s = WPN_LEN[kind] / Math.max(size.x, size.y, size.z, 0.001);
  m.scale.setScalar(s);
  m.updateMatrixWorld(true);
  // GRIP ANCHOR: the handle is the dense vertex cluster in the bottom third —
  // attach THAT to the hand (centering made guns float mid-body).
  bb.setFromObject(m);
  const yBand = bb.min.y + (bb.max.y - bb.min.y) * 0.34;
  const grip = new THREE.Vector3(); let gN = 0; const wp = new THREE.Vector3();
  m.traverse((o) => {
    if (!o.isMesh) return;
    const posA = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(posA.count / 3000));
    for (let i = 0; i < posA.count; i += step) {
      wp.fromBufferAttribute(posA, i).applyMatrix4(o.matrixWorld);
      if (wp.y <= yBand) { grip.add(wp); gN++; }
    }
  });
  if (gN) grip.multiplyScalar(1 / gN); else bb.getCenter(grip);
  const gOv = WPN_GRIP[kind];
  if (gOv) {
    // explicit anchor (see WPN_GRIP): keep the centroid's x, override y/z
    grip.z = bb.min.z + (bb.max.z - bb.min.z) * gOv.fz;
    grip.y = bb.min.y + (bb.max.y - bb.min.y) * gOv.fy;
  }
  // long guns: stock clears the arm. The world model undoes this shift (its
  // origin is the TRUE grip), so it is recorded in userData.
  const gripShiftZ = kind in WPN_GRIP_SHIFT ? WPN_GRIP_SHIFT[kind]
    : (WPN_LEN[kind] > 0.55 ? 0.06 : 0.0);
  grip.z += gripShiftZ;
  m.position.sub(grip); // grip → hand origin
  // Real firearm material (doctrine §1 repair, weapon edition — iter06).
  const done = new Set();
  m.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) {
      if (mat && !done.has(mat)) { done.add(mat); repairGunMaterial(mat); }
    }
    o.castShadow = true;
    // RECEIVE too (measured live, iter A8-world): without it the gun takes the
    // moon's UNSHADOWED directional term while the body it is held by sits in
    // shadow, so every 3P gun read as bright chrome against a dark soldier even
    // though its albedo is ~75/255. Same rule actor.js prepScene gives bodies.
    o.receiveShadow = true;
    o.frustumCulled = false; // rides a skinned hand — bounds lie like the body's
    if (o.geometry && !o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    if (o.geometry && !o.geometry.boundingBox) o.geometry.computeBoundingBox();
  });
  // SUPPORT-HAND HOLD HEIGHT. The weapon origin is the pistol-grip anchor,
  // which sits well BELOW the bore, so the line from the firing palm to the
  // support hand is NOT the bore — it rises toward the muzzle. actor.js needs
  // one number to correct for that: how far above the origin the underside of
  // the handguard sits. Measured off this weapon's own geometry (the 25th-
  // percentile y over the forward z-band a support hand can reach, which is
  // past the magazine and short of the muzzle device), so it is right for any
  // weapon a later wave drops in — never a per-model constant.
  m.updateMatrixWorld(true); // position.sub(grip) above left matrixWorld stale
  bb.setFromObject(m);
  const zF = bb.max.z;
  const ys = [];
  m.traverse((o) => {
    if (!o.isMesh) return;
    const posA = o.geometry.attributes.position;
    const step = Math.max(1, Math.floor(posA.count / 3000));
    for (let i = 0; i < posA.count; i += step) {
      wp.fromBufferAttribute(posA, i).applyMatrix4(o.matrixWorld);
      if (wp.z > zF * 0.40 && wp.z < zF * 0.85) ys.push(wp.y);
    }
  });
  ys.sort((a, b) => a - b);
  const hold = ys.length ? ys[Math.floor(ys.length * 0.25)] : 0.06 * WPN_LEN[kind];
  const g = new THREE.Group();
  g.userData.brHold = hold;
  g.userData.brGripShiftZ = gripShiftZ;
  g.userData.brOneHand = WPN_ONE_HAND[kind] ? 1 : 0;
  g.userData.brLen = WPN_LEN[kind];
  g.add(m);
  return g;
}

// ---------------------------------------------------------------------------
// 3P PISTOL SUPPORT-HAND IK
//
// Why it exists: every 3P clip is a RIFLE pose, and actor.js solves the bore as
// the ray from the firing palm through the support (left) hand's knuckle, which
// sits ~0.37 m ahead of the palm. That is on the handguard of a 0.66-1.05 m long
// gun and ~0.19 m PAST THE MUZZLE of a 0.22 m pistol — the bot reached out into
// thin air with an empty hand while the pistol hid at his hip. And in PVP every
// bot starts on the GS-9 Pike (content.json pvp.loadout), so that was the most
// common 3P weapon in the game.
//
// What it does: AFTER actor.update() (which has already seated the weapon with
// its own solve, unchanged — the bore still points where the rifle pose aims),
// a two-bone analytic IK swings the LEFT upper arm + forearm so the left middle
// knuckle lands on the pistol grip's left face (PISTOL_SUPPORT, weapon-proto
// space). Pure rotation of two bones, no scaling/translation, nothing written
// to actor.js state: actor.update() restores both arms to the clip pose on the
// next call (they are in its poseBones snapshot), so this never compounds. The
// support fingers are already curled by actor.js's baked CURL.
// ---------------------------------------------------------------------------
/** Target for the support-hand MIDDLE KNUCKLE in the pistol's proto space
 *  (origin = grip anchor, +Z = barrel, +Y = up, +X = the shooter's LEFT). */
export const PISTOL_SUPPORT = { x: 0.03, y: 0.012, z: 0.035 };

const _iv = Array.from({ length: 9 }, () => new THREE.Vector3());
const [_S, _E, _H, _K, _T, _u, _pole, _d0, _d1] = _iv;
const _E2 = new THREE.Vector3(), _W2 = new THREE.Vector3(), _off = new THREE.Vector3();
const _qs = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qp = new THREE.Quaternion();

/** Rotate `bone` (world-space swing) so direction `from` becomes `to`. */
function _swing(bone, from, to) {
  _qs.setFromUnitVectors(from, to);
  bone.getWorldQuaternion(_qb);
  _qb.premultiply(_qs);
  bone.parent.getWorldQuaternion(_qp);
  bone.quaternion.copy(_qp.invert().multiply(_qb));
  bone.updateMatrixWorld(true);
}

function _ikPass(b, target) {
  b.arm.getWorldPosition(_S);
  b.fore.getWorldPosition(_E);
  b.hand.getWorldPosition(_H);
  if (b.knuckle) b.knuckle.getWorldPosition(_K); else _K.copy(_H);
  _off.subVectors(_K, _H);               // wrist -> middle knuckle, as posed NOW
  _T.subVectors(target, _off);           // so this is where the WRIST must go
  const l1 = _S.distanceTo(_E), l2 = _E.distanceTo(_H);
  _u.subVectors(_T, _S);
  let d = _u.length();
  if (d < 1e-4) return;
  _u.multiplyScalar(1 / d);
  d = Math.min((l1 + l2) * 0.999, Math.max(Math.abs(l1 - l2) * 1.001 + 1e-3, d));
  // elbow stays on the side the clip put it (perpendicular part of the old one)
  _pole.subVectors(_E, _S);
  _pole.addScaledVector(_u, -_pole.dot(_u));
  if (_pole.lengthSq() < 1e-6) { _pole.set(0, -1, 0); _pole.addScaledVector(_u, -_pole.dot(_u)); }
  _pole.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  _E2.copy(_S).addScaledVector(_u, a).addScaledVector(_pole, h);
  _W2.copy(_S).addScaledVector(_u, d);
  _d0.subVectors(_E, _S).normalize();
  _d1.subVectors(_E2, _S).normalize();
  _swing(b.arm, _d0, _d1);
  b.fore.getWorldPosition(_E);
  b.hand.getWorldPosition(_H);
  _d0.subVectors(_H, _E).normalize();
  _d1.subVectors(_W2, _E).normalize();
  _swing(b.fore, _d0, _d1);
}

/** Per-actor support-hand IK (null when the rig lacks the left-arm chain).
 *  `solve(wpn, want, dt)`: call right AFTER actor.update(); `wpn` is the
 *  attached 3P weapon clone, `want` 1 to grip it (a one-hand-class weapon on a
 *  live bot) or 0 to leave the clip pose alone, `dt` the view dt for easing. */
export function createSupportHandIK(actorRoot) {
  const b = {};
  actorRoot.traverse((o) => {
    if (!o.isBone) return;
    const n = o.name.replace(/^mixamorig:?/i, "");
    if (n === "LeftArm") b.arm = o;
    else if (n === "LeftForeArm") b.fore = o;
    else if (n === "LeftHand") b.hand = o;
    else if (n === "LeftHandMiddle1") b.knuckle = o;
  });
  if (!(b.arm && b.fore && b.hand)) return null;
  let w = 0;
  const target = new THREE.Vector3();
  const qArm = new THREE.Quaternion(), qFore = new THREE.Quaternion();
  const qArmIK = new THREE.Quaternion(), qForeIK = new THREE.Quaternion();
  const api = {
    err: 0,
    solve(wpn, want, dt) {
      if (!want || !wpn) { w = 0; return; }
      w += (1 - w) * (dt > 0 ? 1 - Math.exp(-14 * dt) : 1);
      if (w < 0.002) return;
      actorRoot.updateMatrixWorld(true);          // the actor's own solve is done
      qArm.copy(b.arm.quaternion);
      qFore.copy(b.fore.quaternion);
      target.set(PISTOL_SUPPORT.x, PISTOL_SUPPORT.y, PISTOL_SUPPORT.z)
        .applyMatrix4(wpn.matrixWorld);
      // The wrist->knuckle offset (0.14 m on this rig) rotates with the forearm,
      // so one solve lands short; each pass shrinks the miss by ~offset/reach
      // (measured: 2 passes left the knuckle 9.5 cm off the grip).
      for (let i = 0; i < 5; i++) _ikPass(b, target);
      // residual (metres) between the support knuckle and its grip target — a
      // live health number for the harness, 0 when the pass converged
      if (b.knuckle) { b.knuckle.getWorldPosition(_K); api.err = _K.distanceTo(target); }
      if (w < 0.998) {
        qArmIK.copy(b.arm.quaternion); qForeIK.copy(b.fore.quaternion);
        b.arm.quaternion.slerpQuaternions(qArm, qArmIK, w);
        b.fore.quaternion.slerpQuaternions(qFore, qForeIK, w);
        b.arm.updateMatrixWorld(true);
      }
    },
  };
  return api;
}

// ---------------------------------------------------------------------------
// WORLD (pickup) models
// ---------------------------------------------------------------------------

/** Pre-filled so the table is usable before any GLB loads; _registerInfo()
 *  overwrites each entry in place from the real precise bounding box. */
export const WORLD_WEAPON_INFO = {
  // MEASURED live (precise vertex bbox of the built group) — the load-time
  // _registerInfo() re-derives and overwrites these in place.
  warden:  { length: 0.840, groundOffsetY: 0.047, groundOffsetYSide: 0.029, width: 0.067, height: 0.257, box: [-0.029, -0.047, -0.518, 0.038, 0.210, 0.322] },
  vesper:  { length: 0.660, groundOffsetY: 0.038, groundOffsetYSide: 0.019, width: 0.041, height: 0.185, box: [-0.019, -0.038, -0.493, 0.023, 0.147, 0.167] },
  breaker: { length: 1.000, groundOffsetY: 0.128, groundOffsetYSide: 0.026, width: 0.051, height: 0.222, box: [-0.026, -0.128, -0.745, 0.026, 0.095, 0.255] },
  corvus:  { length: 1.050, groundOffsetY: 0.051, groundOffsetYSide: 0.025, width: 0.069, height: 0.224, box: [-0.025, -0.051, -0.829, 0.044, 0.173, 0.221] },
  pike:    { length: 0.220, groundOffsetY: 0.031, groundOffsetYSide: 0.019, width: 0.039, height: 0.146, box: [-0.019, -0.031, -0.176, 0.020, 0.116, 0.044] },
};

const _tmpBox = new THREE.Box3();

// PICKUP MATERIAL. A bot's gun is lit like the bot (it stands in the same
// light) and reads fine dark. A gun lying on night asphalt, in the shadow of a
// crate, with the original (metalness-heavy, dark-albedo) material measured as
// a near-black cut-out on near-black ground — metal only reflects the dark
// environment. So pickups get ONE derived material per source material (never
// per call): same maps/textures (no extra GPU memory, same program), albedo x1.25
// and the metalness factor cut to 0.45 so the diffuse term shows. The caller
// adds its own glow on top.
const WORLD_LIFT = 1.25, WORLD_METAL = 0.45;
_G.worldMats = _G.worldMats || new WeakMap();
function _worldMaterial(src) {
  if (!src) return src;
  let w = _G.worldMats.get(src);
  if (!w) {
    w = src.clone();
    w.color.setScalar(WORLD_LIFT);
    w.metalness = WORLD_METAL;
    w.userData.__brWorld = true;
    w.needsUpdate = true;
    _G.worldMats.set(src, w);
  }
  return w;
}

/** Build the (un-parented) world-space model for a resolved proto: a clone
 *  sharing geometry + materials, turned so the barrel runs along -Z, with the
 *  true grip (not the bot's arm-clearance-shifted one) at the origin. */
function _makeWorldModel(proto) {
  const m = proto.clone(true);
  const shift = +proto.userData.brGripShiftZ || 0;
  // proto space has the TRUE grip at z = -shift; rotate PI about Y (barrel +Z
  // -> -Z) then move the (now +shift) true grip back onto the origin.
  m.rotation.y = Math.PI;
  m.position.set(0, 0, -shift);
  m.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map(_worldMaterial)
      : _worldMaterial(o.material);
    o.castShadow = false;       // pickups never cast
    o.receiveShadow = true;     // but DO sit in the world's shadows (see prep)
    o.frustumCulled = true;     // static pickup: let it cull; bounds are real
  });
  m.updateMatrixWorld(true);
  return m;
}

function _registerInfo(kind, proto) {
  const m = _makeWorldModel(proto);
  const holder = new THREE.Group();
  holder.add(m);
  holder.updateMatrixWorld(true);
  _tmpBox.makeEmpty().setFromObject(holder, true);
  const b = _tmpBox;
  for (const id of Object.keys(WPN_KIND)) {
    if (WPN_KIND[id] !== kind) continue;
    const e = WORLD_WEAPON_INFO[id] || (WORLD_WEAPON_INFO[id] = {});
    e.length = b.max.z - b.min.z;
    e.groundOffsetY = -b.min.y;
    // lying on its LEFT side: rotation.z = +PI/2 maps (x,y)->(-y,x), so the
    // lowest point is the gun's min x
    e.groundOffsetYSide = -b.min.x;
    e.width = b.max.x - b.min.x;
    e.height = b.max.y - b.min.y;
    e.box = [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z];
  }
}

function _fallbackBox(weaponId) {
  // HONEST dev placeholder (doctrine §7): screaming magenta, unmistakably not
  // a gun; ship is blocked while window.__FFG_FALLBACKS__ is non-empty.
  const len = (WORLD_WEAPON_INFO[weaponId] && WORLD_WEAPON_INFO[weaponId].length) || 0.6;
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.08, len),
    new THREE.MeshBasicMaterial({ color: 0xff00ff }));
  mesh.castShadow = false;
  return mesh;
}

function _reportFallback(weaponId, reason) {
  console.error(`[world_weapon] 3P/world weapon unavailable: ${weaponId}`, reason);
  if (typeof window !== "undefined") {
    (window.__FFG_FALLBACKS__ = window.__FFG_FALLBACKS__ || []).push(
      { lane: "A8-world-weapon", asset: WPN_GLB[WPN_KIND[weaponId]] || String(weaponId),
        reason: String(reason) });
  }
}

/** See the API block at the top of this file. */
export function buildWorldWeapon(weaponId) {
  const kind = WPN_KIND[weaponId];
  const g = new THREE.Group();
  g.name = `world_weapon_${weaponId}`;
  g.userData.brWorldWeapon = String(weaponId);
  g.userData.brReady = false;
  if (!kind) {
    _reportFallback(weaponId, "unknown weapon id");
    g.add(_fallbackBox(weaponId));
    return g;
  }
  const fill = (proto) => {
    g.add(_makeWorldModel(proto));
    g.userData.brReady = true;
  };
  const ready = WPN_PROTO_READY.get(kind);
  if (ready) { fill(ready); return g; }
  prepWeaponProto(kind).then(fill, (e) => {
    _reportFallback(weaponId, e);
    g.add(_fallbackBox(weaponId));
  });
  return g;
}

/** Resolves when the prototypes for all five weapons are cached. Never rejects. */
export function preloadWorldWeapons() {
  return Promise.all(WPN_KINDS.map((k) =>
    prepWeaponProto(k).catch((e) => {
      for (const id of Object.keys(WPN_KIND)) {
        if (WPN_KIND[id] === k) { _reportFallback(id, e); break; }
      }
    }))).then(() => undefined);
}
