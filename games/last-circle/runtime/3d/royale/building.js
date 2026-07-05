/**
 * royale/building.js — Fortnite-style building for Last Circle.
 *
 * Rules (occupancy, HP ramp, support graph, cascade) live in sim BuildGrid
 * (W.grid). This module renders pieces, runs the human ghost preview, applies
 * placement/edit input for ALL actors (bots call W.tryBuild directly from
 * their brains — same rules, same costs), and exposes the collision/ray
 * surfaces other systems use:
 *
 *   W.queryBuildColliders(x,z,r)          → AABBs/ramps for movement
 *   W.buildSegmentHit(ax..bz)             → bullet hits
 *   W.buildRayHit(eye,dir,range)          → melee/edit targeting
 *   W.buildInRadius(x,y,z,r)              → explosions
 *   W.damageBuild(slotKey,dmg,byId) / W.destroyBuild(slotKey)
 *   W.tryBuild(actor,type)                → place from an actor's context
 *   W.tryEdit(actor)                      → toggle a door on the aimed wall
 */
import * as THREE from "three";

let K = null;
const G4 = 4; // grid meters (mirrors K.BUILD.gridM)

const state = {
  meshes: new Map(),      // slotKey -> { group, piece, colliders:[...] }
  chash: new Map(),       // spatial hash of build colliders
  mats: {}, geos: {},
  ghost: null, ghostOk: false,
};

const MAT_COLORS = { wood: 0xb08850, brick: 0xb06a55, metal: 0x8b98a5 };

export function init(W) {
  K = W.SIM;
  W.queryBuildColliders = (x, z, r) => queryC(x, z, r);
  W.buildSegmentHit = (ax, ay, az, bx, by, bz) => segHit(W, ax, ay, az, bx, by, bz);
  W.buildRayHit = (eye, dir, range) => segHit(W, eye.x, eye.y, eye.z, eye.x + dir.x * range, eye.y + dir.y * range, eye.z + dir.z * range);
  W.buildInRadius = (x, y, z, r) => inRadius(x, y, z, r);
  W.damageBuild = (sk, dmg, byId) => damage(W, sk, dmg, byId);
  W.destroyBuild = (sk) => destroy(W, sk);
  W.tryBuild = (a, type, dir) => tryBuild(W, a, type, dir);
  W.tryEdit = (a) => tryEdit(W, a);
  W.events.on("cycleBuildMat", () => {
    if (!W.player) return;
    const order = ["wood", "brick", "metal"];
    W.player.buildMat = order[(order.indexOf(W.player.buildMat) + 1) % 3];
    W.events.emit("buildMatChanged", W.player.buildMat);
  });
  W.events.on("editBuild", () => { if (W.player) tryEdit(W, W.player); });

  // network mirrors (remote client already paid costs / passed checks)
  W.netApplyBuild = (spec) => {
    const p = W.grid && W.grid.place(spec.type, spec.ix, spec.iy, spec.iz, spec.dir, spec.mat, W.t);
    if (p) { p.edit = spec.edit || null; spawnPieceMesh(W, p); }
  };
  W.netApplyEdit = (slotKey, edit) => {
    const entry = state.meshes.get(slotKey);
    if (entry) { entry.piece.edit = edit; respawnPieceMesh(W, entry.piece); }
  };
  W.netApplyDestroy = (slotKey) => destroy(W, slotKey);
  W.buildSyncState = () => {
    const out = [];
    if (W.grid) W.grid.pieces.forEach((p) => out.push({ type: p.type, ix: p.ix, iy: p.iy, iz: p.iz, dir: p.dir, mat: p.mat, edit: p.edit }));
    return out;
  };
}

export function onWorldReady(W) {
  for (const [, e] of state.meshes) if (e.group.parent) e.group.parent.remove(e.group);
  state.meshes.clear();
  state.chash.clear();
  if (!state.mats.wood) {
    for (const m of K.MAT_IDS) {
      state.mats[m] = new THREE.MeshStandardMaterial({ color: MAT_COLORS[m], roughness: 0.8, metalness: m === "metal" ? 0.5 : 0.05 });
      state.mats[m + "_ghost_ok"] = new THREE.MeshStandardMaterial({ color: 0x36e07c, transparent: true, opacity: 0.35, depthWrite: false });
      state.mats[m + "_ghost_no"] = new THREE.MeshStandardMaterial({ color: 0xe04a36, transparent: true, opacity: 0.35, depthWrite: false });
    }
  }
}

// ── geometry builders ────────────────────────────────────────────────────────
function pieceGroup(type, mat, edit) {
  const M = state.mats[mat];
  const g = new THREE.Group();
  const add = (w, h, d, x, y, z, rx, ry) => {
    const key = type + w + h + d;
    const geo = new THREE.BoxGeometry(w, h, d);
    const mesh = new THREE.Mesh(geo, M);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    if (ry) mesh.rotation.y = ry;
    mesh.castShadow = true; mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  if (type === "wall") {
    if (edit === "door") {
      add(1.3, 4, 0.24, -1.35, 2, 0);         // left of door
      add(1.3, 4, 0.24, 1.35, 2, 0);          // right
      add(1.4, 1.4, 0.24, 0, 3.3, 0);         // lintel
    } else {
      add(4, 4, 0.24, 0, 2, 0);
      add(3.4, 0.16, 0.3, 0, 2, 0.03);        // crossbar detail
      add(0.16, 3.4, 0.3, 0, 2, -0.03);
    }
  } else if (type === "floor") {
    add(4, 0.22, 4, 0, 0.11, 0);
    add(3.2, 0.06, 0.2, 0, 0.25, 0);
  } else if (type === "ramp") {
    const slab = add(4, 0.24, Math.SQRT2 * 4, 0, 2, 0);
    slab.rotation.x = -Math.PI / 4;
  } else if (type === "stair") {
    for (let i = 0; i < 4; i++) add(4, 0.24, 1.0, 0, 0.5 + i, -1.5 + i);
  }
  return g;
}

// world transform for a piece
function placeGroup(g, p) {
  const G = G4;
  const cx = (p.ix + 0.5) * G, cz = (p.iz + 0.5) * G, cy = p.iy * G;
  if (p.type === "wall") {
    // dir: 0=+X face,1=-X,2=+Z,3=-Z
    if (p.dir === 0) { g.position.set(p.ix * G + G, cy, cz); g.rotation.y = Math.PI / 2; }
    else if (p.dir === 1) { g.position.set(p.ix * G, cy, cz); g.rotation.y = Math.PI / 2; }
    else if (p.dir === 2) { g.position.set(cx, cy, p.iz * G + G); }
    else { g.position.set(cx, cy, p.iz * G); }
  } else if (p.type === "floor") {
    g.position.set(cx, cy, cz);
  } else {
    // ramp/stair ascend toward dir
    g.position.set(cx, cy, cz);
    g.rotation.y = p.dir === 0 ? -Math.PI / 2 : p.dir === 1 ? Math.PI / 2 : p.dir === 2 ? Math.PI : 0;
  }
}

// colliders for a piece (world AABBs; ramps as kind:'ramp')
function pieceColliders(p) {
  const G = G4;
  const x0 = p.ix * G, z0 = p.iz * G, y0 = p.iy * G;
  const T = 0.28;
  if (p.type === "wall") {
    let wx0, wx1, wz0, wz1;
    if (p.dir === 0) { wx0 = x0 + G - T; wx1 = x0 + G + T; wz0 = z0; wz1 = z0 + G; }
    else if (p.dir === 1) { wx0 = x0 - T; wx1 = x0 + T; wz0 = z0; wz1 = z0 + G; }
    else if (p.dir === 2) { wz0 = z0 + G - T; wz1 = z0 + G + T; wx0 = x0; wx1 = x0 + G; }
    else { wz0 = z0 - T; wz1 = z0 + T; wx0 = x0; wx1 = x0 + G; }
    if (p.edit === "door") {
      // two side segments + lintel (walk through the middle)
      const alongX = (p.dir === 2 || p.dir === 3);
      if (alongX) {
        return [
          { kind: "box", slotKey: p.slotKey, minX: wx0, maxX: wx0 + 1.35, minY: y0, maxY: y0 + G, minZ: wz0, maxZ: wz1 },
          { kind: "box", slotKey: p.slotKey, minX: wx1 - 1.35, maxX: wx1, minY: y0, maxY: y0 + G, minZ: wz0, maxZ: wz1 },
          { kind: "box", slotKey: p.slotKey, minX: wx0, maxX: wx1, minY: y0 + 2.6, maxY: y0 + G, minZ: wz0, maxZ: wz1 },
        ];
      }
      return [
        { kind: "box", slotKey: p.slotKey, minX: wx0, maxX: wx1, minY: y0, maxY: y0 + G, minZ: wz0, maxZ: wz0 + 1.35 },
        { kind: "box", slotKey: p.slotKey, minX: wx0, maxX: wx1, minY: y0, maxY: y0 + G, minZ: wz1 - 1.35, maxZ: wz1 },
        { kind: "box", slotKey: p.slotKey, minX: wx0, maxX: wx1, minY: y0 + 2.6, maxY: y0 + G, minZ: wz0, maxZ: wz1 },
      ];
    }
    return [{ kind: "box", slotKey: p.slotKey, minX: wx0, maxX: wx1, minY: y0, maxY: y0 + G, minZ: wz0, maxZ: wz1 }];
  }
  if (p.type === "floor") {
    return [{ kind: "box", slotKey: p.slotKey, minX: x0, maxX: x0 + G, minY: y0, maxY: y0 + 0.24, minZ: z0, maxZ: z0 + G }];
  }
  // ramp/stair: walkable slope rising toward dir
  return [{ kind: "ramp", slotKey: p.slotKey, minX: x0, maxX: x0 + G, minY: y0, maxY: y0 + G, minZ: z0, maxZ: z0 + G, dir: p.dir }];
}

// ── collider hash ────────────────────────────────────────────────────────────
const CELL = 8;
function hkey(cx, cz) { return cx + "," + cz; }
function addColliders(entry) {
  for (const c of entry.colliders) {
    const x0 = Math.floor(c.minX / CELL), x1 = Math.floor(c.maxX / CELL);
    const z0 = Math.floor(c.minZ / CELL), z1 = Math.floor(c.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const k = hkey(cx, cz);
      if (!state.chash.has(k)) state.chash.set(k, new Set());
      state.chash.get(k).add(c);
    }
  }
}
function removeColliders(entry) {
  for (const c of entry.colliders) {
    const x0 = Math.floor(c.minX / CELL), x1 = Math.floor(c.maxX / CELL);
    const z0 = Math.floor(c.minZ / CELL), z1 = Math.floor(c.maxZ / CELL);
    for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
      const s = state.chash.get(hkey(cx, cz));
      if (s) s.delete(c);
    }
  }
}
function queryC(x, z, r) {
  const out = [];
  const x0 = Math.floor((x - r) / CELL), x1 = Math.floor((x + r) / CELL);
  const z0 = Math.floor((z - r) / CELL), z1 = Math.floor((z + r) / CELL);
  const seen = new Set();
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const s = state.chash.get(hkey(cx, cz));
    if (s) for (const c of s) if (!seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

// ── placement ────────────────────────────────────────────────────────────────
function facingDir(yaw) {
  // forward = (-sin yaw, -cos yaw): map to +X/-X/+Z/-Z
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  if (Math.abs(fx) > Math.abs(fz)) return fx > 0 ? 0 : 1;
  return fz > 0 ? 2 : 3;
}

function targetFor(W, a, type) {
  const G = G4;
  const dir = facingDir(a.yaw);
  const ix = Math.floor(a.pos.x / G), iz = Math.floor(a.pos.z / G);
  // cell whose vertical span contains the feet — floor, NOT round (round put
  // walls a cell above the builder's head, where nothing grounds them)
  const iy = Math.max(0, Math.floor(a.pos.y / G + 0.02));
  if (type === "wall") return { type, ix, iy, iz, dir };
  // floor/ramp/stair go in the cell in front (floor can be own cell if empty below feet)
  const ox = dir === 0 ? 1 : dir === 1 ? -1 : 0;
  const oz = dir === 2 ? 1 : dir === 3 ? -1 : 0;
  if (type === "floor") return { type, ix: ix + ox, iy, iz: iz + oz, dir: 0 };
  return { type, ix: ix + (type === "ramp" || type === "stair" ? 0 : ox), iy, iz: iz + (type === "ramp" || type === "stair" ? 0 : oz), dir };
}

function canPlace(W, a, t) {
  if (!W.grid) return false;
  const sk = W.grid.slotKey(t.type, t.ix, t.iy, t.iz, t.dir);
  if (W.grid.pieces.has(sk)) return false;
  if ((a.inventory.mats[a.buildMat] || 0) < K.BUILD.cost) return false;
  // needs terrain contact or an adjacent piece
  const G = G4;
  const cx = (t.ix + 0.5) * G, cz = (t.iz + 0.5) * G;
  const grounded = t.iy * G <= W.map.heightAt(cx, cz) + 0.9;
  if (grounded) return true;
  // any neighboring piece?
  const probe = { type: t.type, ix: t.ix, iy: t.iy, iz: t.iz, dir: t.dir, slotKey: sk };
  return W.grid._neighbors(probe).length > 0;
}

function tryBuild(W, a, type, dirOverride) {
  const now = W.t;
  if (now - a.lastBuildT < K.BUILD.turboMs / 1000) return false;
  const t = targetFor(W, a, type);
  if (dirOverride != null) t.dir = dirOverride;
  if (!canPlace(W, a, t)) return false;
  const p = W.grid.place(t.type, t.ix, t.iy, t.iz, t.dir, a.buildMat, now);
  if (!p) return false;
  a.inventory.mats[a.buildMat] -= K.BUILD.cost;
  a.lastBuildT = now;
  spawnPieceMesh(W, p);
  W.events.emit("buildPlaced", a, p);
  return true;
}

function tryEdit(W, a) {
  // aim at a wall within 4m → toggle door
  const eye = { x: a.pos.x, y: a.pos.y + K.PLAYERK.eyeY, z: a.pos.z };
  const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw), sp = Math.sin(a.pitch), cp = Math.cos(a.pitch);
  const dir = { x: -sy * cp, y: sp, z: -cy * cp };
  const hit = segHit(W, eye.x, eye.y, eye.z, eye.x + dir.x * 5, eye.y + dir.y * 5, eye.z + dir.z * 5);
  if (!hit) return false;
  const entry = state.meshes.get(hit.slotKey);
  if (!entry || entry.piece.type !== "wall") return false;
  entry.piece.edit = entry.piece.edit === "door" ? null : "door";
  respawnPieceMesh(W, entry.piece);
  W.events.emit("buildEdited", a, entry.piece);
  return true;
}

function spawnPieceMesh(W, p) {
  const g = pieceGroup(p.type, p.mat, p.edit);
  placeGroup(g, p);
  W.group("builds").add(g);
  const entry = { group: g, piece: p, colliders: pieceColliders(p) };
  state.meshes.set(p.slotKey, entry);
  addColliders(entry);
  // build-up pop
  g.scale.y = 0.12;
  W.kernel.tween({ target: g.scale, to: { y: 1 }, duration: 0.22 });
}

function respawnPieceMesh(W, p) {
  const old = state.meshes.get(p.slotKey);
  if (old) { W.group("builds").remove(old.group); removeColliders(old); }
  spawnPieceMesh(W, p);
}

// ── damage / destroy ─────────────────────────────────────────────────────────
function damage(W, slotKey, dmg, byId) {
  if (!W.grid) return;
  const res = W.grid.damagePiece(slotKey, dmg, W.t);
  if (res.hit && !res.destroyed.length) {
    const entry = state.meshes.get(slotKey);
    if (entry) flashDamage(entry);
    W.events.emit("buildDamaged", res.hit, dmg);
  }
  for (const p of res.destroyed) removeVisual(W, p);
  if (res.destroyed.length) W.events.emit("buildDestroyed", res.destroyed, byId);
}
function destroy(W, slotKey) {
  if (!W.grid) return;
  const gone = W.grid.removePiece(slotKey);
  for (const p of gone) removeVisual(W, p);
  if (gone.length) W.events.emit("buildDestroyed", gone, null);
}
function removeVisual(W, p) {
  const entry = state.meshes.get(p.slotKey);
  if (!entry) return;
  W.group("builds").remove(entry.group);
  removeColliders(entry);
  state.meshes.delete(p.slotKey);
}
function flashDamage(entry) {
  entry.group.traverse((o) => {
    if (o.isMesh && !o.__flashed) {
      o.__flashed = true;
      const orig = o.material;
      o.material = orig.clone();
      o.material.emissive = new THREE.Color(0xff5533);
      o.material.emissiveIntensity = 0.5;
      setTimeout(() => { o.material = orig; o.__flashed = false; }, 90);
    }
  });
}

// ── bullet/melee segment test ────────────────────────────────────────────────
function segHit(W, ax, ay, az, bx, by, bz) {
  const len = Math.hypot(bx - ax, by - ay, bz - az);
  const steps = Math.max(2, Math.ceil(len / 0.5));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
    const cols = queryC(x, z, 0.4);
    for (const c of cols) {
      if (c.kind === "ramp") {
        // treat ramp as slab: y within 0.35 of surface
        let f;
        if (c.dir === 0) f = (x - c.minX) / (c.maxX - c.minX);
        else if (c.dir === 1) f = (c.maxX - x) / (c.maxX - c.minX);
        else if (c.dir === 2) f = (z - c.minZ) / (c.maxZ - c.minZ);
        else f = (c.maxZ - z) / (c.maxZ - c.minZ);
        const sy = c.minY + (c.maxY - c.minY) * Math.max(0, Math.min(1, f));
        if (x > c.minX && x < c.maxX && z > c.minZ && z < c.maxZ && Math.abs(y - sy) < 0.35) {
          return { slotKey: c.slotKey, x, y, z };
        }
      } else if (x > c.minX && x < c.maxX && y > c.minY && y < c.maxY && z > c.minZ && z < c.maxZ) {
        return { slotKey: c.slotKey, x, y, z };
      }
    }
  }
  return null;
}

function inRadius(x, y, z, r) {
  const out = new Set();
  const cols = queryC(x, z, r);
  for (const c of cols) {
    const nx = Math.max(c.minX, Math.min(x, c.maxX));
    const ny = Math.max(c.minY, Math.min(y, c.maxY));
    const nz = Math.max(c.minZ, Math.min(z, c.maxZ));
    if (Math.hypot(nx - x, ny - y, nz - z) <= r) out.add(c.slotKey);
  }
  return [...out];
}

// ── frame update: human ghost + placement input ──────────────────────────────
export function update(W, dt) {
  const a = W.player;
  if (!a || !a.alive || !W.grid) { hideGhost(W); return; }
  const piece = a.input.buildPiece;
  if (!piece) { hideGhost(W); }
  else {
    const t = targetFor(W, a, piece);
    showGhost(W, a, t);
    // held fire = turbo build (weapons.js skips firing while in build mode;
    // rate is throttled by lastBuildT inside tryBuild)
    if (a.input.fire) tryBuild(W, a, piece);
  }
}

function showGhost(W, a, t) {
  if (!state.ghost || state.ghost.__type !== t.type) {
    hideGhost(W);
    const g = pieceGroup(t.type, "wood", null);
    g.__type = t.type;
    state.ghost = g;
    W.group("builds").add(g);
  }
  const ok = canPlace(W, a, t);
  const mat = state.mats[ok ? "wood_ghost_ok" : "wood_ghost_no"];
  state.ghost.traverse((o) => { if (o.isMesh) o.material = mat; });
  const fake = { type: t.type, ix: t.ix, iy: t.iy, iz: t.iz, dir: t.dir };
  placeGroup(state.ghost, fake);
  state.ghost.visible = true;
  state.ghostOk = ok;
}
function hideGhost(W) {
  if (state.ghost) { W.group("builds").remove(state.ghost); state.ghost = null; }
}
