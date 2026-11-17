// core/fx/muzzle_socket.js [feel v153] — WHERE A ROUND VISIBLY LEAVES THE GUN.
//
// The sim fires every round from the shooter's EYE (player.js: origin = pos +
// eyeHeight), which is right for the damage ray and wrong for everything the
// eye sees: a bot's tracer and muzzle flash came out of its forehead, and the
// player's own tracer started dead centre on the crosshair, 0.9 m down the
// sight line, i.e. ON TOP OF the target it was flying at. This module answers
// "where is the muzzle on screen" for both cases, view-side only:
//
//  - PLAYER: the viewmodel is drawn by a second camera (VIEWMODEL fov 60° +
//    vmFovAdj) parented to the world camera, so vm.muzzleWorld() is a point in
//    that camera's frustum. The world camera (fov 74°) would draw the same
//    point somewhere else. Re-scale its camera-space x/y by tan(fovW/2) /
//    tan(fovVM/2) at the same depth: the result is the WORLD point that lands
//    on the same pixel as the barrel tip, which is where a world-space tracer
//    has to start to look like it leaves the gun.
//  - BOTS (and kill-cam ghosts): the held gun model (soldiers.js rec.wpn,
//    read-only). Its muzzle in the gun's local frame is found once per model
//    (the -Z end of the bounding boxes, the same convention soldiers.js uses
//    for the suppressor can) and cached by geometry.
//
// Zero allocations per call after the first sighting of a gun model.

import * as THREE from "three";

const _v = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _box = new THREE.Box3();
const _c = new THREE.Vector3();
const localCache = new Map(); // key (first mesh geometry uuid) -> Vector3 | null

function gunKey(wpn) {
  let key = null;
  wpn.traverse((o) => { if (!key && o.isMesh && o.geometry) key = o.geometry.uuid; });
  return key;
}

function localMuzzle(wpn) {
  const key = gunKey(wpn);
  if (!key) return null;
  if (localCache.has(key)) return localCache.get(key);
  wpn.updateMatrixWorld(true);
  _inv.copy(wpn.matrixWorld).invert();
  let minZ = Infinity;
  const boxes = [];
  wpn.traverse((o) => {
    if (!o.isMesh || !o.geometry || o.name === "__3p_suppressor__") return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _box.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld).applyMatrix4(_inv);
    boxes.push(_box.clone());
    if (_box.min.z < minZ) minZ = _box.min.z;
  });
  let m = null;
  if (boxes.length && isFinite(minZ)) {
    let sx = 0, sy = 0, n = 0;
    for (const b of boxes) {
      if (b.min.z > minZ + 0.03) continue;
      b.getCenter(_c);
      sx += _c.x; sy += _c.y; n++;
    }
    if (n) m = new THREE.Vector3(sx / n, sy / n, minZ);
  }
  localCache.set(key, m);
  return m;
}

// out: [3]. Returns true when a real socket was found.
export function botMuzzle(id, out) {
  const F = typeof window !== "undefined" ? window.__FPS__ : null;
  const sol = F && F.soldiers;
  const rec = sol && sol._actors ? sol._actors.get(id) : null;
  // [integration v153] the hold pass publishes the real barrel tip; the generated
  // 3P guns point their barrel along +Z, so the -Z guess below is the butt
  if (rec && rec.actor && typeof rec.actor.muzzleWorld === "function") {
    const m = rec.actor.muzzleWorld(_v);
    if (m && isFinite(m.x)) { out[0] = m.x; out[1] = m.y; out[2] = m.z; return true; }
  }
  const wpn = rec && rec.wpn;
  if (!wpn || !wpn.parent) return false;
  const lm = localMuzzle(wpn);
  if (!lm) return false;
  wpn.updateWorldMatrix(true, false);
  _v.copy(lm).applyMatrix4(wpn.matrixWorld);
  if (!isFinite(_v.x)) return false;
  out[0] = _v.x; out[1] = _v.y; out[2] = _v.z;
  return true;
}

// The world-camera point that renders on the same pixel as the viewmodel's
// barrel tip. out: [3].
export function playerMuzzle(camera, out) {
  const F = typeof window !== "undefined" ? window.__FPS__ : null;
  const vm = F && F.vm;
  if (!vm || typeof vm.muzzleWorld !== "function" || !camera) return false;
  try {
    const v = vm.muzzleWorld(_v.set(0, 0, 0));
    if (!v || !isFinite(v.x)) return false;
    camera.updateMatrixWorld();
    _inv.copy(camera.matrixWorld).invert();
    v.applyMatrix4(_inv);                     // camera space
    if (!(v.z < -0.05)) return false;
    const vmCam = vm.camera;
    const fovVm = vmCam && vmCam.fov ? vmCam.fov : 60;
    const k = Math.tan((camera.fov * Math.PI) / 360) / Math.tan((fovVm * Math.PI) / 360);
    v.x *= k; v.y *= k;
    v.applyMatrix4(camera.matrixWorld);
    out[0] = v.x; out[1] = v.y; out[2] = v.z;
    return true;
  } catch (e) { return false; }
}
