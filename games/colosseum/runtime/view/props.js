// Colosseum — generated equipment props (Meshy text-to-3D, static).
//
// The procedural galea/lorica/gladius are silhouette-correct but read as toys
// next to the Meshy character bodies — flat vertex colours against full PBR
// skin. These props close that gap: museum-grade helmet, muscled cuirass and
// ornate blades with real albedo/normal/roughness maps, decimated to game
// density (878k tris off the generator -> ~35k shipped) and Draco-compressed.
//
// THE CONTRACT with the rest of the view layer:
//   - Props are STATIC rigid shells. They ride the same solved mounts the
//     procedural pieces use (attachToBone / attachWeapon), so no rigging was
//     bought and no new attachment math exists — one solve, two wardrobes.
//   - Every consumer calls through makeProp()/makeWeapon(), which NORMALISE a
//     clone into the procedural piece's authoring convention: +Y up, +Z the
//     face/edge forward, origin where the joint expects it. If the prop is not
//     loaded (still streaming, fetch failed, headless probe with no network),
//     the caller's procedural fallback builds instead — the game can never
//     lose a helmet to a 404.
//   - Clones SHARE geometry and materials with the template. Equipment.unequip
//     disposes procedural geometry; prop mounts are tagged sharedGeo so it
//     skips them (disposing a shared geometry would strip every other wearer).
//
// Load cost: all four props total ~1.1 MB, streamed once, off the boot path —
// startMatch awaits them alongside the armatura bodies.

import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";

const loader = new GLTFLoader();
const draco = new DRACOLoader();
draco.setDecoderPath("assets/vendor/three/examples/jsm/libs/draco/");
draco.setDecoderConfig({ type: "js" });
loader.setDRACOLoader(draco);

/**
 * rotY: Meshy "front facing the camera" puts the face on +Z in the GLB, which
 * is already this game's forward — set per-prop only if a capture shows the
 * piece turned (verified visually before shipping, see the wiring commit).
 */
const DEFS = {
  galea_murmillo:   { url: "assets/props/galea_murmillo.glb",   rotY: 0 },
  lorica_musculata: { url: "assets/props/lorica_musculata.glb", rotY: 0 },
  gladius_ornate:   { url: "assets/props/gladius_ornate.glb",   rotY: 0 },
  spatha_ornate:    { url: "assets/props/spatha_ornate.glb",    rotY: 0 },
};

const templates = new Map();   // name -> { root: Group (normalised), box: Box3 }
let _preload = null;

function normalise(scene, rotY) {
  const root = new THREE.Group();
  root.name = "prop_template";
  // Flatten: keep only the meshes, world-baked, so the template carries no
  // generator node hierarchy (Meshy wraps output in scaled pivots).
  scene.updateMatrixWorld(true);
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const m of meshes) {
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    const mesh = new THREE.Mesh(g, m.material);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    root.add(mesh);
  }
  if (rotY) {
    const R = new THREE.Matrix4().makeRotationY(rotY);
    root.children.forEach((m) => m.geometry.applyMatrix4(R));
  }
  // Centre x/z on the origin; leave y raw (fit anchors handle it).
  const box = new THREE.Box3().setFromObject(root);
  const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
  root.children.forEach((m) => m.geometry.translate(-cx, 0, -cz));
  box.min.x -= cx; box.max.x -= cx; box.min.z -= cz; box.max.z -= cz;
  return { root, box };
}

/** Kick (or join) the one-shot preload of every prop. Failures are per-prop
 *  and non-fatal: a missing prop simply leaves its procedural stand-in on. */
export function preloadProps() {
  if (_preload) return _preload;
  _preload = Promise.all(Object.entries(DEFS).map(([name, def]) =>
    new Promise((res) => {
      loader.load(def.url,
        (gltf) => { try { templates.set(name, normalise(gltf.scene, def.rotY)); } catch (e) { console.warn(`[props] ${name} normalise failed:`, e && e.message); } res(); },
        undefined,
        (e) => { console.warn(`[props] ${name} load failed:`, (e && e.message) || e); res(); });
    })
  )).then(() => templates);
  return _preload;
}

export function hasProp(name) { return templates.has(name); }

/**
 * Clone a prop, fitted.
 *
 * Exactly ONE of the scale rules applies (checked in this order):
 *   scaleToWidth  — uniform scale so the x extent matches (helmets, cuirasses:
 *                   width is what must clear the body inside)
 *   scaleToLength — uniform scale so the y extent matches (blades)
 * Then ONE vertical anchor places it:
 *   minY / maxY / centerY — where that edge/centre of the fitted bbox lands.
 *
 * Returns a Group tagged sharedGeo (see module header) or null if unloaded.
 */
export function makeProp(name, { scaleToWidth = 0, scaleToLength = 0, minY = null, maxY = null, centerY = null } = {}) {
  const t = templates.get(name);
  if (!t) return null;
  const g = t.root.clone(true);
  g.name = `prop_${name}`;
  const w = t.box.max.x - t.box.min.x, h = t.box.max.y - t.box.min.y;
  const s = scaleToWidth ? scaleToWidth / Math.max(w, 1e-6)
    : scaleToLength ? scaleToLength / Math.max(h, 1e-6) : 1;
  g.scale.setScalar(s);
  if (minY !== null) g.position.y = minY - t.box.min.y * s;
  else if (maxY !== null) g.position.y = maxY - t.box.max.y * s;
  else if (centerY !== null) g.position.y = centerY - ((t.box.min.y + t.box.max.y) / 2) * s;
  g.userData.sharedGeo = true;
  g.traverse((o) => { o.userData.sharedGeo = true; });
  return g;
}

/**
 * The weapon-id -> prop mapping, with per-id fitted lengths that match the
 * historical articles the sim's reach values were tuned against: gladius
 * 0.68 m overall, spatha 0.9 m. The sica and dimachaerus blades reuse the
 * ornate gladius exactly as they reused the procedural one — same fidelity
 * trade as before, better mesh.
 *
 * Grip convention (the attachWeapon contract): grip at the origin, blade up
 * +Y, pommel just below zero — so the fitted bbox bottom sits at -0.06*L.
 */
const WEAPON_PROPS = {
  // Lengths bumped 2026-07-28 on direct player feedback: the ornate gladius
  // at 0.72 m read smaller in-hand than the old procedural blade (the prop's
  // bbox includes its pommel and guard, so more of its length is hilt).
  gladius:     { prop: "gladius_ornate", length: 0.82 },
  sica:        { prop: "gladius_ornate", length: 0.74 },
  dimachaerus: { prop: "gladius_ornate", length: 0.82 },
  rudis:       { prop: "gladius_ornate", length: 0.82 },
  spatha:      { prop: "spatha_ornate",  length: 0.98 },
};

/** Prop-backed weapon mesh for a weapon id, else the procedural fallback. */
export function makeWeapon(weaponId, fallbackMaker) {
  const def = WEAPON_PROPS[weaponId];
  if (def && hasProp(def.prop)) {
    const m = makeProp(def.prop, { scaleToLength: def.length, minY: -0.06 * def.length });
    if (m) return m;
  }
  return fallbackMaker();
}
