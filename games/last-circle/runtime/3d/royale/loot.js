/**
 * royale/loot.js — ground loot, chests, supply drops, pickups, inventory ops,
 * and death drops. Loot placement is SEEDED (same seed → same loot) so
 * multiplayer clients agree without item sync.
 *
 * Item visuals: kind mesh (weapon protos from weapons.js when ready), gentle
 * bob+spin, over a glowing floor ring; floor WEAPONS also get a thin rarity light
 * beam. Chests use the treasure chest GLB with a gold ring, beam and glow.
 *
 * ALL of the ring / beam / glow markers are instanced draws (plan P1.3): ONE
 * InstancedMesh of beams, ONE of rings, ONE of camera-facing glow billboards - 3
 * draw calls for the whole map, where it used to be an opaque torus per item plus
 * 51 additive beam meshes and 55+ additive sprites per chest/death drop. They are
 * built once per page and re-parented each match (like the contact blobs), a slot
 * is parked by a zero matrix when its item is taken / opened, and everything that
 * animates (pulse, dash rotation, distance + storm fades) is in the shader, so the
 * only per-frame CPU cost is three shared uniforms and a sub-range upload on the
 * frames a slot actually changed. Beams are CLAMPED at spawn to the first collider
 * above them (a ray-cast once per item), so none pokes through a roof.
 */
import * as THREE from "three";

let K = null;
const items = new Map();      // id -> {id, data, pos, group, taken}
const chests = new Map();     // id -> {id, pos, group, opened}
// Spatial hash over loot, same idea maps.js already uses for colliders. nearby()
// used to walk EVERY item and EVERY chest and hypot each one — and bots call it
// once per frame while looting, on top of a 90 m planning query per think, with
// up to 49 bots looting at once early in a match.
const LOOT_CELL = 24;
const lootGrid = new Map();
// numeric key: the string form allocated a key per cell per query, and bots query
// every frame (walkover) — a 16k x 16k cell range is far beyond any map
const lkey = (cx, cz) => (cx + 8192) * 16384 + (cz + 8192);
function gridAdd(kind, id, pos) {
  const k = lkey(Math.floor(pos.x / LOOT_CELL), Math.floor(pos.z / LOOT_CELL));
  let l = lootGrid.get(k);
  if (!l) { l = []; lootGrid.set(k, l); }
  l.push({ kind, id });
}
let nextId = 1;
let supplyState = null;

const ITEM_FILES = { medkit: "item_medkit", bandage: "item_bandage", mini_shield: "item_shield_s", big_shield: "item_shield_l" };
const itemProtoCache = {};

export function init(W) {
  K = W.SIM;
  // Meshy 3D pickup models (medkit / bandage / shield potions) with a cached
  // normalized proto per id; consumers: ground items + HUD slot icons.
  W.itemProto = async (id) => {
    if (itemProtoCache[id] !== undefined) return itemProtoCache[id];
    const file = ITEM_FILES[id];
    if (!file) return (itemProtoCache[id] = null);
    try {
      const m = await W.kernel.loadGLTF(W.assetBase + "assets/props/meshy_items/" + file + ".glb");
      const bb = new THREE.Box3().setFromObject(m);
      const size = bb.getSize(new THREE.Vector3());
      const s = 0.45 / Math.max(size.x, size.y, size.z, 0.001);
      m.scale.setScalar(s);
      const c = bb.getCenter(new THREE.Vector3()).multiplyScalar(s);
      m.position.sub(c);
      const g = new THREE.Group(); g.add(m);
      itemProtoCache[id] = g;
    } catch (e) { itemProtoCache[id] = null; }   // not generated yet — fallback shapes
    return itemProtoCache[id];
  };
  W.nearbyLoot = (pos, r) => nearby(pos, r);
  W.pickupItem = (a, id) => pickup(W, a, id);
  W.openChest = (a, id) => openChest(W, a, id);
  W.giveItem = (a, data) => give(W, a, data);
  W.wouldAcceptItem = (a, data) => wouldAccept(W, a, data);
  W.events.on("actorDied", (victim) => deathDrop(W, victim));

  // network mirrors + join-sync
  W.netTakeItem = (id) => {
    const it = items.get(id);
    if (it) { it.taken = true; releaseItem(it); items.delete(id); takenIds.push(id); }
  };
  W.netOpenChest = (id) => openChest(W, null, id);
  W.netSpawnItem = (d) => spawnItem(W, d.data, d.x, d.y, d.z, d.id);
  // [Q] — drop the active weapon for a squadmate (Final Drop parity, owner
  // screenshots). Refuses the LAST weapon: there is no melee in this game, so
  // an armed player must stay armed. Mag rides the drop (data.mag) and the
  // next weapon slot auto-equips.
  W.dropActive = (a) => {
    const inv = a.inventory;
    const s = inv.slots[inv.active];
    if (!s || s.kind !== "weapon") return false;
    const others = inv.slots.filter((x, i) => x && x.kind === "weapon" && i !== inv.active);
    if (!others.length) return false;
    const data = { kind: "weapon", id: s.id, rarity: s.rarity || 0,
                   mag: a.weapon && a.weapon.id === s.id ? a.weapon.magAmmo : s.mag };
    inv.slots[inv.active] = null;
    const nextIdx = inv.slots.findIndex((x) => x && x.kind === "weapon");
    const did = dropItem(W, a, data, true);   // tossed forward, not at the feet
    // the DROPPER can't walk it back over for 1.5 s (explicit E still works;
    // squadmates unaffected) — without this the walkover radius reclaimed the
    // drop the same frame whenever a slot was free
    const ent = items.get(did);
    if (ent) { ent.noWalkoverBy = a.id; ent.noWalkoverUntil = W.t + 1.5; }
    if (nextIdx >= 0 && W.equipSlot) W.equipSlot(a, nextIdx);
    W.events.emit("weaponDropped", a, data);
    return true;
  };
  W.lootSyncState = () => ({ taken: takenIds.slice(), opened: [...chests.values()].filter((c) => c.opened).map((c) => c.id) });
  W.debugChests = () => [...chests.values()]; // test hook (preview verification)
  W.debugItems = debugItems;                   // test hook (loot census)
  W.debugLootFx = debugLootFx;                 // test hook (marker pools: live slots, beam tops, ceilings)
}
const takenIds = [];

export function resetSync() { takenIds.length = 0; }

/** Release the GPU resources the LAST match's loot allocated.
 *  disposeMapResources is deliberately scoped to W._groups.map, and match
 *  teardown only .clear()s the other groups — so what a match builds inside the
 *  loot group has to be freed here, or it is orphaned on the GPU each match (with
 *  PLAY AGAIN as the expected flow that compounds without ever passing through a
 *  reload). Today that is the cloned chest materials of an opened chest; the old
 *  per-chest glow SpriteMaterials, beam geometries + materials and death-drop glows
 *  are gone - every marker is a slot in the three page-lifetime instanced pools.
 *
 *  The prototypes are shared across matches ON PURPOSE (itemProtoCache holds the
 *  loaded GLBs; kindGeos/kindMats, the marker pools and the blob mesh are built
 *  once, and THREE's clone() shares geometry and material by reference) — so
 *  anything reachable from them is excluded BY IDENTITY. Disposing those would
 *  leave the next match drawing with dead handles. */
export function disposeLootResources(W) {
  const g = W._groups && W._groups.loot;
  if (!g) return { geometries: 0, materials: 0, textures: 0 };
  // Idempotent per match: disposeMatch and the orchestrator's direct call can
  // both run in one teardown; populate() re-arms the flag.
  if (g.userData.disposed) return { geometries: 0, materials: 0, textures: 0 };
  g.userData.disposed = true;
  const keepG = new Set(), keepM = new Set(), keepT = new Set();
  const keep = (o) => {
    if (!o) return;
    if (o.isTexture) { keepT.add(o); return; }
    if (o.isMaterial) {
      keepM.add(o);
      for (const k in o) { const v = o[k]; if (v && v.isTexture) keepT.add(v); }
      return;
    }
    if (o.isBufferGeometry) { keepG.add(o); return; }
    if (o.traverse) o.traverse((n) => {
      if (n.geometry) keepG.add(n.geometry);
      const mm = Array.isArray(n.material) ? n.material : (n.material ? [n.material] : []);
      for (const m of mm) keep(m);
    });
  };
  keep(chestProto);
  if (blobMesh) { keep(blobMesh.geometry); keep(blobMesh.material); }
  // the marker pools are page-lifetime (like the blobs): their geometry, shader
  // material and instance buffers are shared by every match, so teardown leaves them alone
  if (FX.pools) for (const k in FX.pools) { keep(FX.pools[k].mesh.geometry); keep(FX.pools[k].mesh.material); }
  for (const d of chestDepthMats.values()) keep(d);
  for (const k in kindGeos) keep(kindGeos[k]);
  for (const k in kindMats) keep(kindMats[k]);
  for (const k in itemProtoCache) keep(itemProtoCache[k]);
  // Weapon protos are shared across matches too (weapons.js builds them once per
  // page and every floor gun is a clone). Without this, teardown disposed the
  // shared weapon materials and textures, so every later match re-uploaded them
  // and recompiled their programs on the first frame a gun was on screen.
  if (W._weaponProtos) for (const k in W._weaponProtos) keep(W._weaponProtos[k]);

  const seenG = new Set(), seenM = new Set(), seenT = new Set();
  let geometries = 0, materials = 0, textures = 0;
  g.traverse((o) => {
    if (o.geometry && !keepG.has(o.geometry) && !seenG.has(o.geometry)) {
      seenG.add(o.geometry); o.geometry.dispose(); geometries++;
    }
    const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
    for (const m of mats) {
      if (!m || keepM.has(m) || seenM.has(m)) continue;
      seenM.add(m);
      for (const k in m) {
        const t = m[k];
        if (t && t.isTexture && !keepT.has(t) && !seenT.has(t)) { seenT.add(t); t.dispose(); textures++; }
      }
      m.dispose(); materials++;
    }
  });
  return { geometries, materials, textures };
}

// A floor loot point is a small PILE now (sim/royale.js floorRollCount +
// rollFloorSpawn): a gun lies with its own ammo beside it, sometimes with a second
// roll. Offsets stay inside ~1.2 m so a pile reads as one spot and never pokes
// through the walls of the 4.5 m huts most points sit in.
const PILE = [[0, 0], [0.85, 0.45], [-0.8, 0.55], [0.15, -0.9], [1.05, -0.55], [-0.95, -0.5]];
// Guaranteed per 50 players: light ammo feeds BOTH the starter pistol and the SMG,
// and isla_viva used to spawn one light box for the whole lobby (audit M2).
const LIGHT_MIN_PER_50 = 8;

export function populate(W) {
  items.clear(); chests.clear(); lootGrid.clear();
  takenIds.length = 0;
  nextId = 1;
  swapN = 0;                      // swap-drop ids restart, so a replayed seed names drops identically
  supplyState = { dropped: 0, next: null };
  chestChannel.id = null; chestChannel.t = 0;
  // Per-system stream for swap-drop scatter (was Math.random, which broke replay).
  W._scatterRng = K.mulberry32((((W.seed >>> 0) ^ 0x5ca77e) >>> 0));
  const rng = K.mulberry32(W.seed ^ 0x100f);
  const modeK = K.MODE[W.mode] || K.MODE.standard;
  const g = W.group("loot");
  g.clear();
  g.userData.disposed = false;
  blobReset();
  g.add(blobInit());
  fxResetPools();
  fxAttach(g);                     // the three marker pools (rings, beams, glows) ride in the loot group

  let fi = 0;
  const floorPts = [];
  let light = 0;
  for (const lp of W.map.lootPoints) {
    fi++;
    if (lp.kind === "chest") {
      spawnChest(W, lp.x, lp.y, lp.z);
      continue;
    }
    floorPts.push(lp);
    // (feature-detected so a stale cached sim/royale.js can never take the loot out)
    const rolls = K.floorRollCount ? K.floorRollCount(rng, modeK.lootMult) : (rng() < 0.55 * Math.min(1.6, modeK.lootMult) ? 1 : 0);
    let k = 0;
    for (let r = 0; r < rolls; r++) {
      const spawn = K.rollFloorSpawn ? K.rollFloorSpawn(rng) : [K.rollFloorItem(rng)];
      for (const data of spawn) {
        const o = PILE[k % PILE.length];
        spawnItem(W, data, lp.x + o[0], lp.y, lp.z + o[1], k ? "f" + k + ":" + fi : "f:" + fi);
        if (data.kind === "ammo" && data.id === "light") light++;
        k++;
      }
    }
  }
  // Light-ammo floor guarantee (deterministic: same rng, fixed order).
  const need = Math.ceil(LIGHT_MIN_PER_50 * (modeK.players || 50) / 50) - light;
  for (let i = 0; i < need && floorPts.length; i++) {
    const lp = floorPts[Math.floor(rng() * floorPts.length)];
    spawnItem(W, { kind: "ammo", id: "light", count: K.AMMO.light.box }, lp.x - 0.6, lp.y, lp.z + 1.0, "fl:" + i);
  }
  blobFlush();
  fxFlush();
}

/** Test hook (read-only by convention): every live ground item, for the loot
 *  census in the lane probes. Same idea as W.debugChests. */
export function debugItems() { return [...items.values()].filter((it) => !it.taken); }

/** Contract C-WARM: the instanced marker pools (rings, beams, glows), guaranteed to exist
 *  and to sit in the loot group, so the kernel warm-up compiles their three programs under
 *  the loading screen. The warm-up forces each empty pool to count >= 1 for its one real
 *  frame; every vertex shader discards a slot that holds a zero matrix, so that frame
 *  draws nothing it should not. */
export function warmObjects(W) {
  const P = fxInit();
  const g = W.group("loot");
  for (const k of ["rings", "beams", "glows"]) if (!P[k].mesh.parent) g.add(P[k].mesh);
  return [P.rings.mesh, P.beams.mesh, P.glows.mesh];
}

function slotInfo(P, slot) {
  if (!P || slot == null || slot < 0) return null;
  const m = P.mesh.instanceMatrix.array, o = slot * 16;
  const r0 = Math.hypot(m[o], m[o + 1], m[o + 2]);
  const info = { slot, alive: r0 > 1e-4, x: m[o + 12], y: m[o + 13], z: m[o + 14], size: r0 };
  if (P.ex) { info.ex = []; for (let i = 0; i < P.exSize; i++) info.ex.push(P.ex.array[slot * P.exSize + i]); }
  const c = P.mesh.instanceColor.array;
  info.color = [c[slot * 3], c[slot * 3 + 1], c[slot * 3 + 2]];
  return info;
}
/** Test hook: the marker pools - live counts, the shared uniforms and (by item or chest id) one
 *  object's ring / beam / glow slots with the beam's drawn top and the ceiling it was clamped to. */
export function debugLootFx(id) {
  const P = FX.pools;
  if (!P) return null;
  const live = (p) => p.n - p.free.length;
  const out = {
    beams: { live: live(P.beams), high: P.beams.n, count: P.beams.mesh.count, max: P.beams.max },
    rings: { live: live(P.rings), high: P.rings.n, count: P.rings.mesh.count, max: P.rings.max },
    glows: { live: live(P.glows), high: P.glows.n, count: P.glows.mesh.count, max: P.glows.max },
    meshes: [P.rings.mesh, P.beams.mesh, P.glows.mesh],
    uniforms: FX.U,
    free: { beams: P.beams.free, rings: P.rings.free, glows: P.glows.free },   // the free lists themselves (read-only by convention)
  };
  if (id != null) {
    const o = items.get(id) || chests.get(id);
    if (o) {
      const beam = slotInfo(P.beams, o.beam);
      if (beam) { beam.top = beam.y + P.beams.ex.array[o.beam * 4]; beam.nominal = P.beams.ex.array[o.beam * 4 + 1]; }
      out.obj = { id, ring: slotInfo(P.rings, o.ring), beam, glow: slotInfo(P.glows, o.glow), ceil: o.ceil };
    }
  }
  return out;
}

/** C8 teardown contract: free what THIS match's loot allocated and drop the
 *  module's references to it. Idempotent — the orchestrator may also call
 *  disposeLootResources in the same teardown. */
export function disposeMatch(W) {
  const r = disposeLootResources(W);
  items.clear(); chests.clear(); lootGrid.clear();
  blobReset();
  fxResetPools();                  // every marker slot back to the free list; the pools themselves are page-lifetime
  takenIds.length = 0;
  supplyState = null;
  chestChannel.id = null; chestChannel.t = 0;
  return r;
}

// ── visuals ──────────────────────────────────────────────────────────────────
const kindGeos = {
  ammo: new THREE.BoxGeometry(0.34, 0.24, 0.24),
  consumable: new THREE.CylinderGeometry(0.14, 0.14, 0.4, 8),
};
const kindMats = {
  ammo: new THREE.MeshStandardMaterial({ color: 0x8a7d3a, metalness: 0.4, roughness: 0.5 }),
  heal: new THREE.MeshStandardMaterial({ color: 0x59d68a, emissive: 0x1a4, emissiveIntensity: 0.4 }),
  shieldC: new THREE.MeshStandardMaterial({ color: 0x4aa8ff, emissive: 0x123a66, emissiveIntensity: 0.5 }),
};

// ── shadow policy (lane S, 2026-10) ─────────────────────────────────────────
// The kernel's loadGLTF marks every GLB mesh castShadow, and every floor gun,
// pickup and chest is a clone of one: 45 of the drop cluster's 264 draw calls were
// loot in the SHADOW pass (multi-submesh guns up to ~6 k tris each, chest models
// 150 m away) on top of 49 in the colour pass. Small pickups do not cast real-time
// shadows in a BR (they float and spin over their rarity ring, which is their
// ground contact); a chest is a solid object standing on the ground, so it casts
// while the camera is within CHEST_SHADOW_R - beyond that its shadow is a few
// texels of a 2048 map - and its silhouette shadow is handed back the moment you
// walk up to it. From the glider (> 40 m up) no loot casts at all.
const CHEST_SHADOW_R = 45, CHEST_SHADOW_R2 = CHEST_SHADOW_R * CHEST_SHADOW_R;
const CHEST_SHADOW_OFF2 = 50 * 50;   // hysteresis: on inside 45 m, off past 50 m (no flicker at the edge)
function noShadow(o) { o.traverse((n) => { if (n.castShadow) n.castShadow = false; }); return o; }
// Chest casters render the shadow pass through their OWN depth material (one per
// source material, shared by every chest, kept for the page like the protos).
// three's shared shadow depth material copies .map from whichever caster it is
// drawing but only re-selects its program at instancing/skinning boundaries, so
// its variant (map / no map) depends on caster ORDER; switching chests in and out
// by distance changed that order and linked a new depth program mid-drop
// (measured: 1 on drop frame 1). A dedicated material per source material always
// sees the same map, so its one program is linked by the match warm-up frame.
const chestDepthMats = new Map();
function chestDepthFor(mat) {
  let d = chestDepthMats.get(mat);
  if (!d) { d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); chestDepthMats.set(mat, d); }
  return d;
}

// CONTACT BLOBS. With the real shadow gone, a floating gun lost the faint smudge
// it used to leave on the ground (before/after screenshots, lane S 2026-10), so
// every floor item gets a soft dark disc on the surface under it instead - the
// standard pickup contact shadow. All of them are ONE InstancedMesh (one draw
// call for the whole map, built once per page and re-parented each match, so the
// instance buffer is never re-allocated). A slot shows only while its item is
// drawn (the same 3D cull as the item), is parked at zero scale otherwise, and
// changed slots go up as one sub-range a frame.
const BLOB_MAX = 2048, BLOB_D = 0.95;
let blobMesh = null, blobN = 0, blobLo = Infinity, blobHi = -1;
const blobFree = [];
const blobShown = new Float32Array(BLOB_MAX * 16);  // each slot's "visible" matrix (re-shown after a cull)
const blobCols = [];                               // own queryColliders out array (never the shared scratch)
const _bM = new THREE.Matrix4(), _bQ = new THREE.Quaternion(), _bS = new THREE.Vector3(1, 1, 1);
const _bP = new THREE.Vector3(), _bN = new THREE.Vector3(), _bUp = new THREE.Vector3(0, 1, 0);
const _bZero = new THREE.Matrix4().makeScale(0, 0, 0);
function blobInit() {
  if (blobMesh) return blobMesh;
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const ctx = cv.getContext("2d");
  const gr = ctx.createRadialGradient(32, 32, 1, 32, 32, 31);
  gr.addColorStop(0, "rgba(0,0,0,0.42)");
  gr.addColorStop(0.5, "rgba(0,0,0,0.26)");
  gr.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(BLOB_D, BLOB_D); geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  blobMesh = new THREE.InstancedMesh(geo, mat, BLOB_MAX);
  blobMesh.name = "loot-blobs";
  blobMesh.frustumCulled = false;                  // map-wide by design: one call, never culled
  blobMesh.castShadow = false; blobMesh.receiveShadow = false;
  blobMesh.renderOrder = -1;                       // first transparent: water covers, glows add on top
  blobMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blobMesh.count = 0;
  return blobMesh;
}
function blobReset() { blobN = 0; blobFree.length = 0; blobLo = Infinity; blobHi = -1; if (blobMesh) blobMesh.count = 0; }
function blobMark(i) { if (i < blobLo) blobLo = i; if (i > blobHi) blobHi = i; }
/** Queue [start, start + count) of an instance attribute for upload WITHOUT dropping a range an earlier flush queued
 *  that no frame has uploaded yet. update() runs once per SIM tick - two or three per rendered frame at 30-60 fps, and
 *  hundreds in a fastForward - while three uploads (and only then clears) the list once per render. The flushes used
 *  to clearUpdateRanges() first, so a slot parked on tick 1 and a different slot changed on tick 2 of the same frame
 *  uploaded only tick 2's range: the taken item's ring / beam / blob stayed on the GPU as a ghost (measured: a ghost
 *  beam above a hut roof, gate run 3). Keeps ONE merged range, so a long fastForward cannot grow the list, and
 *  merges in place (no allocation once a range is pending). */
function queueRange(a, start, count) {
  const r = a.updateRanges;
  if (r.length) {
    let s = start, e = start + count;
    for (let i = 0; i < r.length; i++) { if (r[i].start < s) s = r[i].start; if (r[i].start + r[i].count > e) e = r[i].start + r[i].count; }
    r.length = 1; r[0].start = s; r[0].count = e - s;
  } else a.addUpdateRange(start, count);
  a.needsUpdate = true;
}
function blobFlush() {
  if (!blobMesh || blobHi < 0) return;
  queueRange(blobMesh.instanceMatrix, blobLo * 16, (blobHi - blobLo + 1) * 16);
  blobLo = Infinity; blobHi = -1;
}
/** The surface under a point, shared by the contact blob and the floor ring: the
 *  highest building floor (box top) at or just below `y`, else the terrain, with
 *  the quaternion that lays a flat quad on it (identity on a box top, the terrain
 *  normal otherwise). Fills `_surf` and returns false when nothing is within reach
 *  under the point (a gun that is still in the air). */
const _surf = { floor: 0, onBox: false, q: new THREE.Quaternion() };
function surfaceUnder(W, x, y, z) {
  const M = W.map;
  if (!M) return false;
  let floor = M.heightAt(x, z), onBox = false;
  if (M.queryColliders) {
    const cs = M.queryColliders(x, z, 0.05, blobCols);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.kind !== "box" || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.maxY <= y + 0.05 && c.maxY > floor) { floor = c.maxY; onBox = true; }
    }
  }
  if (y - floor > 0.9) return false;
  if (onBox) _surf.q.identity();
  else {
    const e = 0.6;
    _bN.set(M.heightAt(x - e, z) - M.heightAt(x + e, z), 2 * e, M.heightAt(x, z - e) - M.heightAt(x, z + e)).normalize();
    _surf.q.setFromUnitVectors(_bUp, _bN);
  }
  _surf.floor = floor; _surf.onBox = onBox;
  return true;
}
/** Slot for a new item at (x, y, z): the matrix sits on the highest surface at or
 *  below the item (a building floor, else the terrain, tilted to its slope).
 *  -1 = no blob (pool full, or nothing within reach under the item). */
function blobAlloc(W, it) {
  if (!blobMesh || !W.map) return -1;
  const x = it.pos.x, y = it.pos.y, z = it.pos.z;
  if (!surfaceUnder(W, x, y, z)) return -1;
  const slot = blobFree.length ? blobFree.pop() : (blobN < BLOB_MAX ? blobN++ : -1);
  if (slot < 0) return -1;
  if (blobN > blobMesh.count) blobMesh.count = blobN;
  // terrain: +5 cm clears the rendered chunk mesh (piecewise-linear between ~2.6 m
  // vertices) where it sits a little above the analytic height; a box top is exact
  _bM.compose(_bP.set(x, _surf.floor + (_surf.onBox ? 0.02 : 0.05), z), _surf.q, _bS).toArray(blobShown, slot * 16);
  return slot;
}
function blobShow(it, on) {
  if (!blobMesh || it.blob == null || it.blob < 0) return;
  if (on) _bM.fromArray(blobShown, it.blob * 16); else _bM.copy(_bZero);
  blobMesh.setMatrixAt(it.blob, _bM);
  blobMark(it.blob);
}
function blobRelease(it) {
  if (it.blob == null || it.blob < 0) return;
  blobShow(it, false);
  blobFree.push(it.blob);
  it.blob = -1;
}

// ── rarity beams + floor rings + glow billboards (plan P1.3) ─────────────────
// THREE instanced draws for every marker on the map, in place of an opaque torus
// per item + a beam mesh and a glow sprite per chest (51 + 55 additive objects the
// glider could never cull). All three are page-lifetime objects built once (like
// the contact blobs), re-parented into the loot group each match, drawn at
// renderOrder >= 6 so they land after the storm wall (renderOrder 5), and they
// read the shared storm circle (W.stormU = {cx, cz, r}, contract C-LOOT-RENDER) to
// fade out beyond it so a beam never glows through the normal-blended
// wall. A slot is a matrix (+ colour + one small attribute); a taken / opened
// item parks its slots at a zero matrix, which every vertex shader below discards.
//
// GLARE BAR (owner doctrine): every number here was started LOW and judged on
// screenshots - beam body/core radiance, ring band luminance and glow alpha are the
// constants right below. Nothing but the core of a rare+ beam crosses the 0.72
// bloom threshold on a typical surface.
const BEAM_MAX = 1024, RING_MAX = 2048, GLOW_MAX = 768;
const RO_RING = 6, RO_BEAM = 7, RO_GLOW = 8;
//                 common  uncommon  rare   epic   legendary
const BEAM_H    = [2.0,    4.0,      7.0,   10.5,  14.0];     // nominal height, m (clamped under a roof)
const BEAM_R    = [0.045,  0.050,    0.060, 0.070, 0.080];    // radius at the base, m (widens with distance, see the shader)
// x ~1.5 = HDR luminance of the beam axis (core + body, near): common 0.60 / uncommon 0.66 stay under the 0.72 bloom
// threshold; rare 1.1 .. legendary 1.7 = 3.8-5.2x lit grass (0.4), 2.9-3.8x sand (0.6): the 3-5x glare bar. Legendary was
// 1.25 (6x grass, a 40 px bloom halo at 7 m) - lowered so it cannot mask what stands behind it.
const BEAM_GAIN = [0.40,   0.42,     0.75,  0.90,  1.05];
const BEAM_FAR  = [60,     90,       130,   180,   240];      // m: faded out by here
const CHEST_BEAM = { h: 9, r: 0.13, gain: 0.85, far: 1800 };   // far: the beacon the glider steers to, visible across the whole map
const RING_Y_WEAPON = 1.1, RING_Y_SMALL = 0.8;                // target HDR luminance of the ring band (sand sits at ~0.64)
const RING_GAIN_MAX = 3.6, RING_WHITE = 0.12;
const RING_D_WEAPON = 2.0, RING_D_SMALL = 1.0, RING_D_CHEST = 3.4;   // quad diameter, m
const GLOW_GAIN = 0.8;
const GOLD_HEX = "#ffd254", AMMO_HEX = "#cfa84a", HEAL_HEX = "#59d68a", SHIELD_HEX = "#4aa8ff";

// 1 inside the storm circle (or when there is none), 0 beyond its edge + 18 m. W.stormU.r is 1e9 when no circle exists
// (practice, before the first circle); in float32 r - 6 and r + 18 both round to 1e9, so smoothstep() would get EQUAL edges, which
// GLSL leaves undefined (NaN on some GPUs): "no circle" is handled explicitly.
const FX_STORM_GLSL = /* glsl */`
float stormK(vec3 st, vec2 p) {
  return st.z > 1.0e6 ? 1.0 : 1.0 - smoothstep(st.z - 6.0, st.z + 18.0, length(p - st.xy));
}`;
const FX_VS_BEAM = /* glsl */`
${FX_STORM_GLSL}
attribute vec4 aBeam;               // x drawn height (clamped), y nominal height, z gain, w fade-out distance
uniform vec3 uStorm;
varying float vH, vNom, vGain, vFade, vPhase;
varying vec3 vCol;
varying vec2 vN, vV;
varying float vFarK;
void main() {
  float r0 = length(instanceMatrix[0].xyz);
  vec3 base = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  vec3 toCam = cameraPosition - base;
  float d = length(toCam);
  float dh = length(toCam.xz);
  float far = aBeam.w;
  float fDist = 1.0 - smoothstep(0.55 * far, far, d);
  float fNear = smoothstep(0.7, 2.6, dh);                                    // never a veil when the camera is beside it
  float fStorm = stormK(uStorm, base.xz);
  float fade = fDist * fNear * fStorm;
  if (r0 < 0.0001 || aBeam.x <= 0.0 || fade < 0.002) { gl_Position = vec4(0.0); return; }
  float rmax = far > 400.0 ? 2.2 : 0.45;
  float r = clamp(d * 0.0028, r0, max(r0, rmax));                            // ~3.5 px wide at any range (1280 px, 57 deg)
  vec3 wp = base + vec3(position.x * r, position.y * aBeam.x, position.z * r);
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  vH = position.y * aBeam.x; vNom = aBeam.y; vGain = aBeam.z; vFade = fade; vCol = instanceColor;
  vN = position.xz;
  vV = dh > 0.001 ? toCam.xz / dh : vec2(1.0, 0.0);
  vPhase = base.x * 0.7 + base.z * 0.3;
  // far (rarity) beams hand the white core's weight to the coloured body past ~20 m; a CHEST beacon (fade-out > 400 m)
  // keeps its white-hot core at every range - it is the gold beacon the glider steers to, not a rarity code
  vFarK = far > 400.0 ? 0.0 : smoothstep(18.0, 80.0, d);
}`;
const FX_FS_BEAM = /* glsl */`
uniform float uTime;
uniform vec3 uK;
varying float vH, vNom, vGain, vFade, vPhase;
varying vec3 vCol;
varying vec2 vN, vV;
varying float vFarK;
void main() {
  float f = abs(dot(normalize(vN), vV));          // 1 on the axis facing the camera, 0 at the silhouette
  float body = pow(f, 1.3);
  float core = pow(f, 6.0);                       // the thin white-hot axis
  float v = pow(1.0 - clamp(vH / vNom, 0.0, 1.0), 1.1) * smoothstep(0.0, 0.12, vH);
  float shimmer = 0.93 + 0.07 * sin(uTime * 2.4 + vH * 0.8 + vPhase);
  vec3 tint = mix(vCol, vec3(1.0), 0.6);
  // far away the beam is only ~3 px wide and its white core used to swallow the rarity colour (every beam read
  // white over the sky at 40-100 m): past ~20 m the core hands its weight to the coloured body
  float far = vFarK;
  vec3 c = (vCol * ((0.8 + 0.5 * far) * body) + tint * (1.6 * (1.0 - 0.8 * far) * core)) * (vGain * uK.x * v * shimmer * vFade);
  // EMISSION (rgb) plus a little OCCLUSION (alpha) of what is behind, blended premultiplied (ONE, ONE_MINUS_SRC_ALPHA):
  // a purely additive beam over the ~0.58 sky or bright sand can only push toward white; dimming 0-38 % of the
  // background under the body keeps the beam's hue there.
  float occ = 0.38 * body * v * vFade * min(1.0, vGain * 1.2);
#ifdef LC_CANVAS
  // LOW tier: drawn straight to the canvas, so the blend happens on ENCODED values and there is no HDR target to tone-map later.
  // Adding encoded emission to an encoded background is far too hot (enc(0.3) + enc(0.4) = 1.25 against enc(0.7) = 0.85), so the
  // linear emission is added scaled by the slope of the composer's output curve at the daylight sky (ORCH's CO_ADD_K, 0.62) -
  // the same rule its wrapper applies to additive materials.
  gl_FragColor = vec4(c * 0.62, occ);
#else
  gl_FragColor = vec4(c, occ);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
#endif
}`;
const FX_VS_RING = /* glsl */`
${FX_STORM_GLSL}
attribute vec2 aRing;               // x style (0 weapon double ring, 1 small single ring), y phase
uniform vec3 uStorm;
uniform float uCull;
varying vec2 vP, vS;
varying vec3 vCol;
varying float vFade;
void main() {
  vec3 ctr = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float d = distance(cameraPosition, ctr);
  float fCull = 1.0 - smoothstep(uCull - 25.0, uCull, d);                    // fades into the item cull, no pop
  float fStorm = mix(0.35, 1.0, stormK(uStorm, ctr.xz));
  vFade = fCull * fStorm;
  if (length(instanceMatrix[0].xyz) < 0.0001 || vFade < 0.003) { gl_Position = vec4(0.0); return; }
  gl_Position = projectionMatrix * viewMatrix * (modelMatrix * instanceMatrix * vec4(position, 1.0));
  vP = position.xz * 2.0; vCol = instanceColor; vS = aRing;
}`;
const FX_FS_RING = /* glsl */`
uniform float uTime;
uniform vec3 uK;
varying vec2 vP, vS;
varying vec3 vCol;
varying float vFade;
void main() {
  float r = length(vP);
  float aa = max(fwidth(r), 0.0005) * 1.25;
  float band, dark;
  if (vS.x < 0.5) {
    // weapon: a solid inner ring and a thinner dashed outer ring that turns slowly
    float bi = 1.0 - smoothstep(0.0, aa, abs(r - 0.50) - 0.065);
    float di = 1.0 - smoothstep(0.0, 0.08, abs(r - 0.50) - 0.065);
    float seg = fract((atan(vP.y, vP.x) / 6.2831853 + uTime * 0.03 + vS.y) * 12.0);
    float dash = smoothstep(0.0, 0.05, seg) * (1.0 - smoothstep(0.70, 0.75, seg));      // 12 long dashes, small gaps
    float bo = (1.0 - smoothstep(0.0, aa, abs(r - 0.86) - 0.035)) * dash;
    float dOut = (1.0 - smoothstep(0.0, 0.05, abs(r - 0.86) - 0.035)) * dash * 0.45;
    band = max(bi, bo);
    dark = max(di, dOut);
  } else {
    band = 1.0 - smoothstep(0.0, aa, abs(r - 0.72) - 0.07);
    dark = 1.0 - smoothstep(0.0, 0.09, abs(r - 0.72) - 0.07);
  }
  // light pooling on the floor (ref t84): a tinted disc that brightens toward the band and a soft glow just
  // outside it - both normal-blended, so the floor under them keeps its colour instead of washing to white
  float rIn = vS.x < 0.5 ? 0.50 : 0.72;
  float fillA = (1.0 - smoothstep(rIn - 0.14, rIn, r)) * mix(0.06, 0.26, smoothstep(0.0, rIn - 0.04, r));
  float glowA = exp(-pow((r - rIn) / 0.16, 2.0)) * 0.30 * step(rIn, r);
  // four layers, bottom to top, composed over each other PREMULTIPLIED: a dark outline (so the band
  // reads on bright sand), the outer glow, the tinted disc, the coloured band
  float aD = dark * 0.5;
  vec3 c = vec3(0.0);
  float a = aD;
  c = c * (1.0 - glowA) + vCol * 0.55 * glowA;  a = glowA + a * (1.0 - glowA);
  c = c * (1.0 - fillA) + vCol * 0.55 * fillA;  a = fillA + a * (1.0 - fillA);
  float m = band * (0.92 + 0.08 * sin(uTime * 2.0 + vS.y * 6.2831853));
  c = c * (1.0 - m) + vCol * m;                 a = m + a * (1.0 - m);
  if (a < 0.004) discard;
  // STRAIGHT colour through tone mapping + colour space (both are no-ops into the composer's linear target,
  // live on the low tier that draws straight to the canvas), premultiplied only after them: tone-mapping an
  // already premultiplied colour brightened every partly transparent pixel ~3x on the low tier
  gl_FragColor = vec4(c / a, a * vFade * uK.y);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <premultiplied_alpha_fragment>
}`;
const FX_VS_GLOW = /* glsl */`
${FX_STORM_GLSL}
uniform float uTime;
uniform vec3 uStorm;
varying vec2 vP;
varying vec3 vCol;
varying float vFade;
void main() {
  vec3 ctr = (modelMatrix * vec4(instanceMatrix[3].xyz, 1.0)).xyz;
  float s = length(instanceMatrix[0].xyz);
  float d = distance(cameraPosition, ctr);
  float fStorm = stormK(uStorm, ctr.xz);
  float far = 720.0 * s;                                                     // chest glow (3.2 m) ~2.3 km: the glider's beacon; a death-drop glow (1.3 m) ~0.9 km
  vFade = smoothstep(1.2, 4.5, d) * (1.0 - smoothstep(0.65 * far, far, d)) * fStorm;
  if (s < 0.0001 || vFade < 0.003) { gl_Position = vec4(0.0); return; }
  vec4 mv = viewMatrix * vec4(ctr, 1.0);
  mv.xy += position.xy * s * (0.85 + 0.15 * sin(uTime * 2.4 + ctr.x));
  gl_Position = projectionMatrix * mv;
  vP = position.xy * 2.0; vCol = instanceColor;
}`;
const FX_FS_GLOW = /* glsl */`
uniform vec3 uK;
varying vec2 vP;
varying vec3 vCol;
varying float vFade;
void main() {
  float r = length(vP);
  if (r >= 1.0) discard;
  float a = 0.9 * pow(1.0 - r, 1.8) * vFade * uK.z;
  gl_FragColor = vec4(vCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const FX = { pools: null, U: null };
/** The ring and beam shaders write STRAIGHT HDR colour and run tone mapping + colour space themselves, so they are correct on both
 *  routes. ORCH's low-tier canvas wrapper (ffg_royale3d.js lcCanvasOutput, case 2) rewrites every premultiplied normal-blended
 *  ShaderMaterial on the direct route as if it wrote vec4(colour * a, a) with colour <= 1: it clamped the ring band (HDR up to ~2.9)
 *  and the beam core to 1 - rare ring cyan, epic pink, legendary yellow (hue error 25 deg) and every beam near-white. That hook
 *  leaves a material with its OWN onBeforeCompile alone (its documented exception), and this one defines LC_CANVAS for the programs
 *  drawn straight to the canvas (output colour space sRGB: the same test ORCH uses; render-target programs are untouched). */
function ownOutput(mat) {
  mat.onBeforeCompile = (p) => {
    if (p.outputColorSpace === THREE.SRGBColorSpace && typeof p.fragmentShader === "string") p.fragmentShader = "#define LC_CANVAS 1\n" + p.fragmentShader;
  };
  return mat;
}
const _fxC = new THREE.Color(), _fxI = new THREE.Quaternion(), _fxS = new THREE.Vector3();
/** hex string -> linear working-space colour (shared scratch: read it before the next call). */
function linCol(hex) { return _fxC.set(hex); }

/** A pool = one InstancedMesh + the slot allocator + the "visible" matrices (so a cull
 *  toggle can re-show a slot) + the per-slot attributes, uploaded as one sub-range. */
function makePool(name, geo, mat, max, order, exName, exSize) {
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.name = name;
  mesh.frustumCulled = false;                       // map-wide by design: one call, never culled
  mesh.castShadow = false; mesh.receiveShadow = false;
  mesh.renderOrder = order;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.count = 0;
  // instanceColor up front: the program variant (USE_INSTANCING_COLOR) must be stable from the warm-up frame on
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
  mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  const attrs = [{ a: mesh.instanceMatrix, s: 16 }, { a: mesh.instanceColor, s: 3 }];
  let ex = null;
  if (exName) {
    ex = new THREE.InstancedBufferAttribute(new Float32Array(max * exSize), exSize);
    ex.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute(exName, ex);
    attrs.push({ a: ex, s: exSize });
  }
  return { mesh, max, n: 0, free: [], lo: Infinity, hi: -1, shown: new Float32Array(max * 16), attrs, ex, exSize: exSize || 0 };
}
function poolMark(P, i) { if (i < P.lo) P.lo = i; if (i > P.hi) P.hi = i; }
function poolReset(P) {
  P.n = 0; P.free.length = 0; P.lo = Infinity; P.hi = -1; P.mesh.count = 0;
}
/** Take a slot and write its matrix / colour / attribute values. -1 = pool full. */
function poolAlloc(P, m4, col, e0, e1, e2, e3) {
  const slot = P.free.length ? P.free.pop() : (P.n < P.max ? P.n++ : -1);
  if (slot < 0) return -1;
  if (P.n > P.mesh.count) P.mesh.count = P.n;
  m4.toArray(P.shown, slot * 16);
  m4.toArray(P.mesh.instanceMatrix.array, slot * 16);
  const ca = P.mesh.instanceColor.array;
  ca[slot * 3] = col.r; ca[slot * 3 + 1] = col.g; ca[slot * 3 + 2] = col.b;
  if (P.ex) {
    const ea = P.ex.array, o = slot * P.exSize;
    ea[o] = e0; ea[o + 1] = e1;
    if (P.exSize > 2) { ea[o + 2] = e2; ea[o + 3] = e3; }
  }
  poolMark(P, slot);
  return slot;
}
function poolShow(P, slot, on) {
  if (!P || slot == null || slot < 0) return;
  const a = P.mesh.instanceMatrix.array, o = slot * 16;
  if (on) { for (let i = 0; i < 16; i++) a[o + i] = P.shown[o + i]; } else a.fill(0, o, o + 16);
  poolMark(P, slot);
}
function poolRelease(P, slot) {
  if (!P || slot == null || slot < 0) return;
  poolShow(P, slot, false);
  P.free.push(slot);
}
function poolFlush(P) {
  if (!P || P.hi < 0) return;
  for (let i = 0; i < P.attrs.length; i++) {
    const t = P.attrs[i];
    queueRange(t.a, P.lo * t.s, (P.hi - P.lo + 1) * t.s);   // merges with a range no frame has uploaded yet (see queueRange)
  }
  P.lo = Infinity; P.hi = -1;
}

function fxInit() {
  if (FX.pools) return FX.pools;
  const U = FX.U = {
    time: new THREE.Uniform(0),
    storm: new THREE.Uniform(new THREE.Vector3(0, 0, 1e9)),   // cx, cz, r (r huge = no circle)
    cull: new THREE.Uniform(150),
    k: new THREE.Uniform(new THREE.Vector3(1, 1, 1)),         // beam / ring / glow master gains (test + tuning hook)
  };
  const uniforms = () => ({ uTime: U.time, uStorm: U.storm, uCull: U.cull, uK: U.k });
  const base = { transparent: true, depthWrite: false, depthTest: true, fog: false };
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true); beamGeo.translate(0, 0.5, 0);
  const beamMat = new THREE.ShaderMaterial(Object.assign({}, base, {
    name: "LootBeam", vertexShader: FX_VS_BEAM, fragmentShader: FX_FS_BEAM, uniforms: uniforms(),
    // front faces only: one surface, so the gains above are the axis radiance. Premultiplied normal blending =
    // emission added + a little of the background occluded (see the fragment shader)
    blending: THREE.NormalBlending, premultipliedAlpha: true }));
  const ringGeo = new THREE.PlaneGeometry(1, 1); ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.ShaderMaterial(Object.assign({}, base, {
    name: "LootRing", vertexShader: FX_VS_RING, fragmentShader: FX_FS_RING, uniforms: uniforms(),
    blending: THREE.NormalBlending, premultipliedAlpha: true,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  ownOutput(beamMat); ownOutput(ringMat);
  const glowGeo = new THREE.PlaneGeometry(1, 1);
  const glowMat = new THREE.ShaderMaterial(Object.assign({}, base, {
    name: "LootGlow", vertexShader: FX_VS_GLOW, fragmentShader: FX_FS_GLOW, uniforms: uniforms(),
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  FX.pools = {
    beams: makePool("loot-beams", beamGeo, beamMat, BEAM_MAX, RO_BEAM, "aBeam", 4),
    rings: makePool("loot-rings", ringGeo, ringMat, RING_MAX, RO_RING, "aRing", 2),
    glows: makePool("loot-glows", glowGeo, glowMat, GLOW_MAX, RO_GLOW, null, 0),
  };
  return FX.pools;
}
function fxAttach(g) {
  const P = fxInit();
  g.add(P.rings.mesh, P.beams.mesh, P.glows.mesh);
}
function fxResetPools() {
  if (!FX.pools) return;
  poolReset(FX.pools.beams); poolReset(FX.pools.rings); poolReset(FX.pools.glows);
}

/** Height of the first collider ABOVE a point (its underside), or Infinity: the roof /
 *  upper floor a beam must stop under. Ray-cast once per item at spawn; own scratch
 *  array (never the shared queryColliders one). A collider counts only when it starts
 *  well above the floor, so walls and furniture standing on it do not. */
const _ceilCols = [];
function ceilingAbove(W, x, z, floor, rad) {
  const M = W.map;
  if (!M || !M.queryColliders) return Infinity;
  const cs = M.queryColliders(x, z, rad, _ceilCols);
  let ceil = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.maxX < x - rad || c.minX > x + rad || c.maxZ < z - rad || c.minZ > z + rad) continue;
    if (c.minY > floor + 0.6 && c.minY < ceil) ceil = c.minY;
  }
  return ceil;
}

function lum(c) { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }
const _fxOut = new THREE.Color();
/** Ring band colour: the rarity colour scaled to a target luminance (so a blue ring is
 *  as visible on sand as an orange one), plus a little white so the scale never has to
 *  push one channel through the roof. Linear HDR. */
function ringColour(hex, yTarget) {
  const c = linCol(hex);
  const g = Math.min(RING_GAIN_MAX, yTarget / Math.max(0.05, lum(c)));
  return _fxOut.setRGB(c.r * g + RING_WHITE, c.g * g + RING_WHITE, c.b * g + RING_WHITE);
}
function phaseOf(id) { let h2 = 0; for (let i = 0; i < id.length; i++) h2 = (h2 * 31 + id.charCodeAt(i)) | 0; return ((h2 >>> 0) % 1000) / 1000; }

/** Where a marker stands: the surface under the point (as the blob), else - a chest or a
 *  gun on a stair ramp, a roof edge, or still in the air, none of which has a box top or the
 *  terrain within 0.9 m below - a flat floor 15 cm under the thing itself. A marker must never
 *  be skipped for want of a floor: the ring is the item's only ground cue and a chest's beam
 *  is the beacon the glider steers to. */
function markerSurface(W, x, y, z) {
  if (surfaceUnder(W, x, y, z)) return true;
  _surf.floor = y - 0.15; _surf.onBox = true; _surf.q.identity();
  return true;
}
/** Ring slot for something lying at (x, y, z); -1 only when the pool is full. */
function ringAlloc(W, x, y, z, hex, small, diameter, id) {
  const P = FX.pools && FX.pools.rings;
  if (!P || !markerSurface(W, x, y, z)) return -1;
  _bM.compose(_bP.set(x, _surf.floor + (_surf.onBox ? 0.035 : 0.065), z), _surf.q, _fxS.set(diameter, 1, diameter));
  return poolAlloc(P, _bM, ringColour(hex, small ? RING_Y_SMALL : RING_Y_WEAPON), small ? 1 : 0, phaseOf(id));
}
/** Beam slot standing on `floor`, clamped under `ceil`; -1 when there is no room for one. */
function beamAlloc(x, floor, z, hex, nomH, r0, gain, far, ceil) {
  const P = FX.pools && FX.pools.beams;
  if (!P) return -1;
  const base = floor + 0.04;
  const h = Math.min(nomH, ceil - base - 0.04);
  if (h < 0.35) return -1;
  _bM.compose(_bP.set(x, base, z), _fxI, _fxS.set(r0, 1, r0));
  return poolAlloc(P, _bM, linCol(hex), h, nomH, gain, far);
}
function glowAlloc(x, y, z, size, hex, gain) {
  const P = FX.pools && FX.pools.glows;
  if (!P) return -1;
  _bM.compose(_bP.set(x, y, z), _fxI, _fxS.set(size, size, size));
  const c = linCol(hex);
  return poolAlloc(P, _bM, _fxOut.setRGB(c.r * gain, c.g * gain, c.b * gain));
}
/** The markers of a floor item: a ring for everything, a beam for weapons. */
function itemFx(W, it) {
  fxInit();
  const d = it.data, x = it.pos.x, y = it.pos.y, z = it.pos.z;
  it.ring = it.beam = it.glow = -1;
  it.ceil = Infinity;
  if (d.kind === "weapon") {
    const rar = d.rarity || 0, hex = K.RARITY_COLOR[K.RARITY[rar]] || K.RARITY_COLOR.common;
    it.ring = ringAlloc(W, x, y, z, hex, false, RING_D_WEAPON, it.id);
    if (it.ring >= 0) {
      it.ceil = ceilingAbove(W, x, z, _surf.floor, BEAM_R[rar] + 0.12);
      it.beam = beamAlloc(x, _surf.floor, z, hex, BEAM_H[rar], BEAM_R[rar], BEAM_GAIN[rar], BEAM_FAR[rar], it.ceil);
    }
  } else {
    const hex = d.kind === "ammo" ? AMMO_HEX : (d.id && d.id.indexOf("shield") >= 0 ? SHIELD_HEX : HEAL_HEX);
    it.ring = ringAlloc(W, x, y, z, hex, true, RING_D_SMALL, it.id);
  }
}
function itemFxShow(it, on) { if (FX.pools) poolShow(FX.pools.rings, it.ring, on); }
function itemFxRelease(it) {
  const P = FX.pools;
  if (!P) return;
  poolRelease(P.rings, it.ring); poolRelease(P.beams, it.beam); poolRelease(P.glows, it.glow);
  it.ring = it.beam = it.glow = -1;
}
function fxFlush() {
  const P = FX.pools;
  if (!P) return;
  poolFlush(P.rings); poolFlush(P.beams); poolFlush(P.glows);
}

// storm circle for the fades: W.stormU = {cx, cz, r} (plain numbers or {value} uniforms) when
// the storm lane provides it, else this module's own 3 Hz read of the sim's circle
const numOf = (v, d) => (v == null ? d : (typeof v === "object" ? (typeof v.value === "number" ? v.value : d) : v));
let fxStormT = 0;
function fxFrame(W, dt, cull) {
  const U = FX.U;
  if (!U) return;
  U.time.value = bobT;
  U.cull.value = cull;
  const s = U.storm.value, su = W.stormU;
  if (su) { s.set(numOf(su.cx, 0), numOf(su.cz, 0), numOf(su.r, 1e9)); return; }
  fxStormT -= dt;
  if (fxStormT > 0) return;
  fxStormT = 0.33;
  const sc = W.stormCtl;
  if (!sc || !sc.storm || !sc.storm.phases || !sc.storm.phases.length) { s.set(0, 0, 1e9); return; }
  const st = sc.storm.stateAt(W.t);
  if (st && st.center && st.radius > 0.5) s.set(st.center.x, st.center.z, st.radius); else s.set(0, 0, 1e9);
}

function itemMesh(W, data) {
  const grp = new THREE.Group();            // the floor ring + beam live in the instanced pools, not here
  if (data.kind === "weapon") {
    // weapon proto (async — attach when protos ready)
    if (W.weaponProto) {
      W.weaponProto(data.id).then((proto) => {
        if (proto && grp.parent) { const m = noShadow(proto.clone()); m.position.y = 0.45; m.rotation.z = 0.5; grp.add(m); }
      });
    }
  } else if (data.kind === "ammo") {
    const m = new THREE.Mesh(kindGeos.ammo, kindMats.ammo); m.position.y = 0.35; grp.add(m);
  } else if (data.kind === "consumable") {
    // Meshy 3D model when available; glowing capsule fallback until then
    const fallback = () => {
      const isShield = data.id.includes("shield");
      const m = new THREE.Mesh(kindGeos.consumable, isShield ? kindMats.shieldC : kindMats.heal); m.position.y = 0.4; grp.add(m);
    };
    if (W.itemProto) {
      W.itemProto(data.id).then((proto) => {
        if (proto && grp.parent) { const m = noShadow(proto.clone()); m.position.y = 0.42; grp.add(m); }
        else if (grp.parent) fallback();
      });
    } else fallback();
  }
  return grp;
}

/** id must be DETERMINISTIC across clients (derived from source, not spawn
 * order) so multiplayer "take" mirroring removes the right item everywhere. */
export function spawnItem(W, data, x, y, z, id) {
  id = id || "i" + (nextId++);
  if (items.has(id)) return id;
  const group = itemMesh(W, data);
  const gy = Math.max(y, W.map.heightAt(x, z) + 0.15);
  group.position.set(x, gy, z);
  W.group("loot").add(group);
  const it = { id, data, pos: { x, y: gy, z }, group, taken: false, blob: -1, ring: -1, beam: -1, glow: -1, ceil: Infinity };
  items.set(id, it);
  gridAdd("item", id, { x, z });
  it.blob = blobAlloc(W, it);
  blobShow(it, true);
  itemFx(W, it);                       // floor ring (+ rarity beam for a weapon), instanced
  return id;
}

let chestProto = null;
async function ensureChestProto(W) {
  if (chestProto) return chestProto;
  try {
    const m = await W.kernel.loadGLTF(W.assetBase + "assets/props/chest.glb");
    const bbox = new THREE.Box3().setFromObject(m);
    const size = bbox.getSize(new THREE.Vector3());
    const s = 1.6 / Math.max(size.x, size.z, 0.01);   // BIG — a chest must read as a chest
    m.scale.setScalar(s);
    m.position.y = -bbox.min.y * s;
    chestProto = m;
  } catch (e) {
    // composed fallback (never a bare cube): body + lid + gold trim
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x7a5233 });
    const gold = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.7, roughness: 0.3, emissive: 0x6b4e00, emissiveIntensity: 0.3 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 0.95), wood); body.position.y = 0.35; g.add(body);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 10, 1, false, 0, Math.PI), wood);
    lid.rotation.z = Math.PI / 2; lid.position.y = 0.7; g.add(lid);
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.15, 1.0), gold); band.position.y = 0.5; g.add(band);
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.1), gold); latch.position.set(0, 0.55, 0.52); g.add(latch);
    chestProto = g;
  }
  return chestProto;
}

function spawnChest(W, x, y, z) {
  const id = "c" + (nextId++);
  const group = new THREE.Group();
  const gy = Math.max(y - 0.4, W.map.heightAt(x, z));
  group.position.set(x, gy, z);
  group.rotation.y = (x * 13.7 + z * 7.3) % (Math.PI * 2); // varied facing
  // gold ring, light beam and glow so chests read from far away: three slots in the
  // shared instanced pools (no per-chest meshes, sprites or materials)
  fxInit();
  const ring = ringAlloc(W, x, gy + 0.15, z, K.RARITY_COLOR.legendary, false, RING_D_CHEST, id);
  let beam = -1, glow = -1, ceil = Infinity;
  if (ring >= 0) {
    ceil = ceilingAbove(W, x, z, _surf.floor, CHEST_BEAM.r + 0.12);
    beam = beamAlloc(x, _surf.floor, z, GOLD_HEX, CHEST_BEAM.h, CHEST_BEAM.r, CHEST_BEAM.gain, CHEST_BEAM.far, ceil);
    glow = glowAlloc(x, _surf.floor + 0.9, z, 3.2, GOLD_HEX, GLOW_GAIN);
  }
  // keep a handle on the loaded model so update() can cull it by distance —
  // chests.set below runs synchronously, long before this promise resolves.
  ensureChestProto(W).then((proto) => {
    if (!group.parent) return;
    const m = proto.clone();
    group.add(m);
    const rec = chests.get(id);
    if (rec) {
      rec.model = m;
      // the model's casters, toggled by distance in update(). They stay ON until
      // the first update so the match warm-up frame links their depth variant.
      const casters = [];
      m.traverse((n) => {
        if (!n.isMesh || !n.castShadow) return;
        if (Array.isArray(n.material)) { n.castShadow = false; return; }   // (none in chest.glb; never via the shared material)
        n.customDepthMaterial = chestDepthFor(n.material);
        casters.push(n);
      });
      rec.casters = casters; rec.cast = true;
    }
  });
  W.group("loot").add(group);
  chests.set(id, { id, pos: { x, y: gy, z }, group, opened: false, glow, beam, ring, ringOn: true, ceil });
  gridAdd("chest", id, { x, z });
  return id;
}

// ── supply drops ─────────────────────────────────────────────────────────────
function maybeSupplyDrop(W, dt) {
  if (W.mode === "practice" || !W.stormCtl || !supplyState) return;   // null between disposeMatch and populate
  const st = W.stormCtl.storm.stateAt(W.t);
  // one drop early (~phase 2), one late (~phase 5+). The old `dropped < phase-1`
  // gate front-loaded BOTH into phases 2-3, leaving the tense endgame with none.
  if (st.phase >= 2 && supplyState.dropped < 2 && !supplyState.falling &&
      st.phase - (supplyState.lastDropPhase == null ? -99 : supplyState.lastDropPhase) >= 3) {
    supplyState.lastDropPhase = st.phase;
    // spawn a crate drifting down inside the next circle
    const rng = K.mulberry32((W.seed ^ 0xd209) + supplyState.dropped * 77);
    const ang = rng() * Math.PI * 2, rr = (st.nextRadius || st.radius) * 0.6 * rng();
    const cx = (st.nextCenter ? st.nextCenter.x : st.center.x) + Math.cos(ang) * rr;
    const cz = (st.nextCenter ? st.nextCenter.z : st.center.z) + Math.sin(ang) * rr;
    const crate = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), new THREE.MeshStandardMaterial({ color: 0x4aa8ff, metalness: 0.3, roughness: 0.5 }));
    box.position.y = 0.8;
    const balloon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 10), new THREE.MeshStandardMaterial({ color: 0xf2a33c, transparent: true, opacity: 0.85 }));
    balloon.position.y = 5;
    crate.add(box, balloon);
    crate.position.set(cx, 200, cz);
    W.group("loot").add(crate);
    supplyState.falling = { crate, x: cx, z: cz, balloon };
    W.events.emit("supplyDropSpawned", { x: cx, z: cz });
  }
  const f = supplyState.falling;
  if (f) {
    f.crate.position.y -= 9 * dt;
    const gy = W.map.heightAt(f.x, f.z);
    if (f.crate.position.y <= gy) {
      f.crate.position.y = gy;
      f.crate.remove(f.balloon);
      // detached = unreachable by the match teardown: free it now
      f.balloon.geometry.dispose(); f.balloon.material.dispose();
      // becomes a "supply chest": burst immediately into legendary loot items
      const rng = K.mulberry32((W.seed ^ 0xdead) + supplyState.dropped);
      const drops = K.rollSupplyDrop(rng);
      let i = 0;
      for (const d of drops) {
        const a = (i / drops.length) * Math.PI * 2;
        spawnItem(W, d, f.x + Math.cos(a) * 1.6, gy + 0.2, f.z + Math.sin(a) * 1.6, "sd:" + supplyState.dropped + ":" + i);
        i++;
      }
      W.events.emit("supplyDropLanded", { x: f.x, z: f.z });
      supplyState.dropped++;
      supplyState.falling = null;
    }
  }
}

// ── queries / interaction ────────────────────────────────────────────────────
function nearby(pos, r) {
  const out = [];
  const r2 = r * r;
  const x0 = Math.floor((pos.x - r) / LOOT_CELL), x1 = Math.floor((pos.x + r) / LOOT_CELL);
  const z0 = Math.floor((pos.z - r) / LOOT_CELL), z1 = Math.floor((pos.z + r) / LOOT_CELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const l = lootGrid.get(lkey(cx, cz));
      if (!l) continue;
      for (let i = 0; i < l.length; i++) {
        const e = l[i];
        if (e.kind === "item") {
          const it = items.get(e.id);
          if (!it || it.taken) continue;
          const dx = it.pos.x - pos.x, dz = it.pos.z - pos.z;
          const d2 = dx * dx + dz * dz;                     // squared compare: no sqrt per candidate
          if (d2 < r2 && Math.abs(it.pos.y - pos.y) < 4) {
            out.push({ type: "item", id: it.id, data: it.data, pos: it.pos, d: Math.sqrt(d2) });
          }
        } else {
          const c = chests.get(e.id);
          if (!c || c.opened) continue;
          const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < r2 && Math.abs(c.pos.y - pos.y) < 4) {
            out.push({ type: "chest", id: c.id, pos: c.pos, d: Math.sqrt(d2) });
          }
        }
      }
    }
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

function openChest(W, a, id) {
  const c = chests.get(id);
  if (!c || c.opened) return false;
  c.opened = true;
  if (FX.pools) { poolRelease(FX.pools.glows, c.glow); poolRelease(FX.pools.beams, c.beam); poolRelease(FX.pools.rings, c.ring); }
  c.glow = c.beam = c.ring = -1;
  c.group.traverse((o) => { if (o.isMesh && o.material && o.material.color) { o.material = o.material.clone(); o.material.color.multiplyScalar(0.45); } });
  const rng = K.mulberry32((W.seed ^ 0xc4e57) + parseInt(id.slice(1), 10));
  const drops = K.rollChest(rng);
  let i = 0;
  for (const d of drops) {
    const ang = (i / drops.length) * Math.PI * 2 + 0.6;
    spawnItem(W, d, c.pos.x + Math.cos(ang) * 1.1, c.pos.y + 0.2, c.pos.z + Math.sin(ang) * 1.1, "cb:" + id + ":" + i);
    i++;
  }
  W.events.emit("chestOpened", a, c);
  return true;
}

/** Detach a taken item and park its pooled markers (contact blob, floor ring, beam,
 *  death-drop glow). It owns no GPU object of its own any more - everything per-item
 *  is a slot in a shared instanced pool - so nothing here needs disposing. */
function releaseItem(it) {
  if (it.group.parent) it.group.parent.remove(it.group);
  blobRelease(it);
  itemFxRelease(it);
}

function pickup(W, a, id, opts) {
  const it = items.get(id);
  if (!it || it.taken) return false;
  if (opts && opts.swap) it.data.swap = true;
  const ok = give(W, a, it.data);
  delete it.data.swap;
  if (!ok) return false;
  it.taken = true;
  releaseItem(it);
  items.delete(id);
  takenIds.push(id);
  W.events.emit("pickedUp", a, it.data, id);
  return true;
}

/** Add item data to an actor's inventory. Returns false if no room. */
/** Max guns any actor may CARRY. Beyond this a weapon pickup is refused so the
 *  remaining slots stay available for shields and heals. */
const GUN_CAP = 3;
/** Would give() accept this item right now? Bots ask before walking to it —
 *  pickLoot used to re-select the exact item give() had just refused, so a
 *  fully-kitted bot twitched in place beside a gun it could not take. */
/** A bot does not take a gun it cannot load: an empty magazine (a death drop fired
 *  dry) and not one round of its ammo on hand. It used to walk over it into a free
 *  slot and carry it, so it fought with the pistol beside a rifle it could not fire
 *  (measured 2026-10-01: 15% of the "better gun carried, pistol held" samples were
 *  a dry better gun) - and dropped the empty rifle next to the pistol when it died.
 *  The human keeps the old rule: walk over anything, E to take anything. */
function botCannotLoad(a, data) {
  if (!a.isBot || data.kind !== "weapon" || data.mag == null || data.mag > 0) return false;
  const def = K.WEAPONS[data.id];
  return !(def && def.ammo && (a.inventory.ammo[def.ammo] || 0) > 0);
}
/** Slot index of the carried pistol, or -1. */
function pistolIdx(a) {
  const sl = a.inventory.slots;
  for (let i = 0; i < sl.length; i++) { const s2 = sl[i]; if (s2 && s2.kind === "weapon" && s2.id === "pistol") return i; }
  return -1;
}
/** Index of the least valuable gun carried, or -1. */
function worstGunIdx(a) {
  // RARITY FIRST, then score: picking purely by sustained DPS nominates a
  // legendary sniper (35 rpm) as "worst" over a common SMG, which would have a
  // bot throwing away the best gun it will ever find.
  let idx = -1, wr = Infinity, ws = Infinity;
  const sl = a.inventory.slots;
  for (let i = 0; i < sl.length; i++) {
    const s2 = sl[i];
    if (!s2 || s2.kind !== "weapon") continue;
    const r = s2.rarity || 0, sc = K.gunScore(s2.id, r);
    if (r < wr || (r === wr && sc < ws)) { wr = r; ws = sc; idx = i; }
  }
  return idx;
}
/** At the cap, a BOT may trade up: it has no E-swap, so without this the ?v=64
 *  carry cap froze every bot's arsenal at "starter pistol + first two guns I
 *  touched" for the rest of the match — chest rolls wasted on 49 of 50 actors
 *  and supply drops, the only legendary source, contested by nobody. The human
 *  keeps explicit E-swap semantics and is never auto-traded by walking over loot. */
function botWouldTradeUp(W, a, data) {
  if (a === W.player || data.kind !== "weapon") return -1;
  const idx = worstGunIdx(a);
  if (idx < 0) return -1;
  const cur = a.inventory.slots[idx];
  const inRar = data.rarity || 0, curRar = cur.rarity || 0;
  if (inRar < curRar) return -1;                    // never trade DOWN in rarity
  const better = K.gunScore(data.id, inRar) > K.gunScore(cur.id, curRar) * 1.1;
  return better ? idx : -1;
}

function wouldAccept(W, a, data) {
  const inv = a.inventory;
  if (!inv || !data) return false;
  if (data.kind === "ammo") {
    const cap = K.AMMO[data.id].max;
    return (inv.ammo[data.id] || 0) < cap;
  }
  if (data.kind === "weapon") {
    if (data.swap) return true;
    if (botCannotLoad(a, data)) return false;
    if (a.isBot && data.id === "pistol") {           // a bot carries ONE sidearm (see give)
      const pi = pistolIdx(a);
      if (pi >= 0) return (data.rarity || 0) > (inv.slots[pi].rarity || 0);
    }
    const empty = inv.slots.findIndex((s) => !s);
    const guns = inv.slots.filter((s) => s && s.kind === "weapon").length;
    if (empty >= 0 && guns < GUN_CAP) return true;
    return botWouldTradeUp(W, a, data) >= 0;
  }
  if (data.kind === "consumable") {
    const cs = K.CONSUMABLES[data.id];
    const st = inv.slots.find((s) => s && s.kind === "consumable" && s.id === data.id);
    if (st) return st.count < cs.stack;
    return inv.slots.findIndex((s) => !s) >= 0;
  }
  return false;
}

function give(W, a, data) {
  const inv = a.inventory;
  if (data.kind === "ammo") {
    const cap = K.AMMO[data.id].max;
    const before = inv.ammo[data.id] || 0;
    // At the reserve cap this returned true anyway, so pickup() marked the box
    // taken and DELETED it while the HUD announced a successful pickup — you
    // watched ammo you could not carry disappear off the floor. wouldAccept()
    // two functions up already had the right predicate; only bots consulted it.
    if (before >= cap) return false;
    inv.ammo[data.id] = Math.min(cap, before + (data.count || K.AMMO[data.id].box));
    return true;
  }
  if (data.kind === "weapon") {
    const empty = inv.slots.findIndex((s) => !s);
    const guns = inv.slots.filter((s) => s && s.kind === "weapon").length;
    // Every pickup used to grant a FULL magazine while dropping discarded the
    // one you had — so with an empty gun and zero reserve you tapped E onto any
    // floor gun and tapped E back for a free reload, indefinitely. Reserve ammo
    // is the scarcest resource in the game; this made it irrelevant. Carry the
    // magazine on the item and honour it coming back in.
    const slot = { kind: "weapon", id: data.id, rarity: data.rarity || 0,
                   mag: data.mag != null ? data.mag : K.WEAPONS[data.id].mag };
    // ONE SIDEARM PER BOT. Bots walked over every floor pistol into a free slot and
    // carried two (measured 2026-10-01: "pistol:0 + pistol:0 + ar", "pistol:0 +
    // pistol:1"), a gun slot the 3-gun cap then denied to a primary. A player keeps
    // the better pistol and leaves the other: a higher-rarity pistol REPLACES the
    // carried one (dropped where it stands), anything else is refused (wouldAccept).
    if (!data.swap && botCannotLoad(a, data)) return false;
    if (a.isBot && !data.swap && data.id === "pistol") {
      const pi = pistolIdx(a);
      if (pi >= 0) {
        const old = inv.slots[pi];
        if ((data.rarity || 0) <= (old.rarity || 0)) return false;
        dropItem(W, a, { kind: "weapon", id: old.id, rarity: old.rarity, mag: old.mag });
        inv.slots[pi] = slot;
        if (inv.active === pi) W.equipSlot(a, pi);
        return true;
      }
    }
    // The 3-gun cap used to live ONLY in the human's walkover branch, so bots
    // filled all five slots with guns and could then never pick up a shield or
    // a heal for the rest of the match. An explicit E-swap still works below:
    // it REPLACES the active weapon, so it never raises the count.
    if (empty >= 0 && guns < GUN_CAP) {
      inv.slots[empty] = slot;
      // auto-upgrade: if still on the starter common pistol, switch to the pickup
      const cur = inv.slots[inv.active];
      // (bots too, mid-fight included: a real gun in hand beats the starter at
      // almost every range, and the brain's range-aware ensureGunOut swaps back
      // only when the pistol is clearly better at THIS range after paying the
      // swap delay — e.g. a shotgun picked up with the enemy at 30 m. The swap is
      // stamped so that check waits its 1.2 s gate instead of dithering.)
      if (cur && cur.id === "pistol" && cur.rarity === 0 && data.id !== "pistol") {
        W.equipSlot(a, empty);
        if (a.isBot && a.brain && a.brain.bb) a.brain.bb.swapT = W.t;
      }
      return true;
    }
    // bot trade-up at the cap: drop its worst gun, take the better one
    const tradeIdx = botWouldTradeUp(W, a, data);
    if (tradeIdx >= 0) {
      const old2 = inv.slots[tradeIdx];
      dropItem(W, a, { kind: "weapon", id: old2.id, rarity: old2.rarity, mag: old2.mag });
      inv.slots[tradeIdx] = slot;
      if (inv.active === tradeIdx) W.equipSlot(a, tradeIdx);
      return true;
    }
    if (data.swap) {
      // Explicit E-swap: drop whatever is in the ACTIVE slot, take the new one.
      // The drop used to be guarded on `old.kind === "weapon"` while the
      // overwrite below it was not — so swapping onto a floor gun while a
      // CONSUMABLE stack was active silently destroyed the whole stack (up to
      // 15 bandages / 6 shields / 3 medkits), with no drop and no warning. The
      // swap branch is reached exactly when you are full, which is the normal
      // mid-match state.
      const old = inv.slots[inv.active];
      // Swapping REPLACES the active slot, which only keeps the gun count level
      // when the outgoing slot was itself a gun. With a consumable active at 3
      // guns it ADDED a fourth, permanently past GUN_CAP — and the cap is what
      // stops you from filling every slot with guns and never being able to pick
      // up a shield again. Refuse instead of quietly breaking the invariant.
      if ((!old || old.kind !== "weapon") && guns >= GUN_CAP) return false;
      if (old && old.kind === "weapon") {
        dropItem(W, a, { kind: "weapon", id: old.id, rarity: old.rarity, mag: old.mag });
      } else if (old && old.kind === "consumable") {
        dropItem(W, a, { kind: "consumable", id: old.id, count: old.count || 1 });
      }
      inv.slots[inv.active] = slot;
      W.equipSlot(a, inv.active);
      return true;
    }
    return false;
  }
  if (data.kind === "consumable") {
    const st = inv.slots.find((s) => s && s.kind === "consumable" && s.id === data.id);
    const cs = K.CONSUMABLES[data.id];
    if (st) {
      // Returning true at a FULL stack told the caller the pickup succeeded, so
      // it deleted the item off the floor and played the pickup line — while the
      // player gained nothing. Walking over your own dropped bandages at 15/15
      // destroyed them. Leave it on the ground instead.
      if (st.count >= cs.stack) return false;
      st.count = Math.min(cs.stack, st.count + (data.count || 1));
      return true;
    }
    const empty = inv.slots.findIndex((s) => !s);
    if (empty >= 0) { inv.slots[empty] = { kind: "consumable", id: data.id, count: Math.min(cs.stack, data.count || 1) }; return true; }
    // The consumable branch never read data.swap, so a player with no free slot
    // could NEVER acquire a new consumable type — no shields for the rest of the
    // match, with the prompt still inviting the swap. Mirror the weapon path.
    if (data.swap) {
      const old = inv.slots[inv.active];
      if (old && old.kind === "weapon") dropItem(W, a, { kind: "weapon", id: old.id, rarity: old.rarity, mag: old.mag });
      else if (old && old.kind === "consumable") dropItem(W, a, { kind: "consumable", id: old.id, count: old.count || 1 });
      inv.slots[inv.active] = { kind: "consumable", id: data.id, count: Math.min(cs.stack, data.count || 1) };
      W.equipSlot(a, inv.active);
      return true;
    }
    return false;
  }
  return false;
}

let swapN = 0;
function dropItem(W, a, data, fwd) {
  // weapon-swap drops are local-only events → mirror them explicitly online.
  // fwd: the [Q] drop TOSSES the gun ~2 m ahead — dropped at the feet it sat
  // inside the 1.5 m walkover radius and was reclaimed the same frame.
  const id = "sw:" + a.id + ":" + (swapN++);
  let x, z;
  if (fwd) { x = a.pos.x - Math.sin(a.yaw) * 2.0; z = a.pos.z - Math.cos(a.yaw) * 2.0; }
  else {
    // seeded per match (populate), never Math.random: a bot's trade-up drop is sim
    // state other bots walk over, so it has to replay with the seed
    if (!W._scatterRng) W._scatterRng = K.mulberry32((((W.seed >>> 0) ^ 0x5ca77e) >>> 0));
    const r = W._scatterRng;
    x = a.pos.x + (r() - 0.5) * 1.4; z = a.pos.z + (r() - 0.5) * 1.4;
  }
  const y = a.pos.y + 0.2;
  spawnItem(W, data, x, y, z, id);
  if (W.net && !a.netRemote) W.events.emit("netDropItem", { data, x, y, z, id });
  return id;
}

function hashId(s) { let h2 = 0; for (let i = 0; i < s.length; i++) h2 = (h2 * 31 + s.charCodeAt(i)) | 0; return h2 >>> 0; }

/** Fully deterministic (seeded by victim id) — every client that runs the
 * kill spawns identical death loot with identical ids; no mirroring needed. */
function deathDrop(W, victim) {
  const inv = victim.inventory;
  const rng = K.mulberry32(W.seed ^ hashId(victim.id));
  let k = 0;
  const drop = (data) => {
    const ang = rng() * Math.PI * 2, r = 0.5 + rng() * 1.1;
    const iid = spawnItem(W, data, victim.pos.x + Math.cos(ang) * r, victim.pos.y + 0.2, victim.pos.z + Math.sin(ang) * r, "dd:" + victim.id + ":" + (k++));
    // Death loot got no burst, no beam and no glow, while an untouched CHEST
    // gets a glow sprite plus a 7 m additive beam (spawnChest, above) — so the
    // gun a kill just dropped was harder to spot than loot nobody had touched.
    // Scaled to 1.3 (chests use 3.2): a marker, not a beacon. Now a slot in the
    // shared glow pool, on top of the ring + (for a weapon) beam every floor item has.
    const it = items.get(iid);
    if (it && it.ring >= 0) it.glow = glowAlloc(it.pos.x, it.pos.y + 0.55, it.pos.z, 1.3, GOLD_HEX, GLOW_GAIN);
  };
  // EVERY carried weapon (including the equipped one) + consumables + ammo
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (!s) continue;
    if (s.kind === "weapon") drop({ kind: "weapon", id: s.id, rarity: s.rarity, mag: s.mag });
    if (s.kind === "consumable" && s.count > 0) drop({ kind: "consumable", id: s.id, count: s.count });
    inv.slots[i] = null;
  }
  for (const am in inv.ammo) if (inv.ammo[am] > 8) drop({ kind: "ammo", id: am, count: Math.min(inv.ammo[am], K.AMMO[am].box * 2) });
}

// ── frame update ─────────────────────────────────────────────────────────────
let bobT = 0;
export function update(W, dt) {
  bobT += dt;
  // bob + spin (only items near the camera to save time)
  const cp = W.camera.position;
  // Loot was DRAWN at unlimited range: on Deepwood that is 134 groups, median
  // 1,132 m from the camera, each a rarity torus plus a ~6,000-tri Meshy clone
  // whose sub-meshes are individual draw calls. three.js only frustum-tests
  // leaf meshes and the far plane is 2,000 m on a 1,600 m map, so nothing
  // upstream rejected them — 505 of the frame's 763 draw calls and ~7.3 of its
  // 12.6 ms were loot. Nothing raycasts or picks against these Object3Ds (bots
  // query the spatial hash via W.nearbyLoot), so visibility is render-only.
  // Distance is 3D on purpose: the old horizontal test called everything under
  // the 240-270 m glider flight path "near".
  const cull = W.lootCull || 150, cull2 = cull * cull;
  // values(), not entries: `for (const [, it] of map)` builds a [key, value]
  // array per entry — ~400 a frame here (framecheck heap sampling, 2026-09-30)
  for (const it of items.values()) {
    if (it.taken) continue;
    const dx = it.pos.x - cp.x, dy = it.pos.y - cp.y, dz = it.pos.z - cp.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const vis = d2 < cull2;
    if (it.group.visible !== vis) { it.group.visible = vis; blobShow(it, vis); itemFxShow(it, vis); }
    if (!vis || d2 > 90 * 90) continue;
    it.group.rotation.y = bobT * 1.4;
    it.group.position.y = it.pos.y + Math.sin(bobT * 2 + it.pos.x) * 0.08 + 0.08;
  }
  maybeSupplyDrop(W, dt);

  // chests: cull the model + ring by distance and hand the shadow back up close
  for (const c of chests.values()) {
    const cdx = c.pos.x - cp.x, cdy = c.pos.y - cp.y, cdz = c.pos.z - cp.z;
    const d2 = cdx * cdx + cdy * cdy + cdz * cdz;
    // Cull the chest MODEL and its ring only. The glow billboard and the light
    // beam stay lit at any range (the shader fades them) — they are the beacon you
    // steer the glider toward, and hiding them would make chests unfindable on
    // descent. Their pulse is in the shader: nothing to animate here any more.
    if (c.model) c.model.visible = d2 < cull2;
    if (c.ring >= 0) {
      const ringOn = d2 < cull2;
      if (c.ringOn !== ringOn) { c.ringOn = ringOn; if (FX.pools) poolShow(FX.pools.rings, c.ring, ringOn); }
    }
    if (c.casters) {
      const cast = d2 < (c.cast ? CHEST_SHADOW_OFF2 : CHEST_SHADOW_R2);
      if (c.cast !== cast) { c.cast = cast; for (let i = 0; i < c.casters.length; i++) c.casters[i].castShadow = cast; }
    }
  }
  fxFrame(W, dt, cull);

  // human interact:
  //  - walk over items → auto-pickup whenever there's room
  //  - tap E on an item with a full inventory → SWAP with the active slot
  //  - HOLD E for 2 s on a chest → open (progress surfaces on the HUD)
  const a = W.player;
  if (a && a.alive) {
    const near = nearby(a.pos, 2.4);
    // walkover auto-pickup: ammo/heals always (if they fit); weapons only up
    // to 3 carried — hoarding 5 guns left NO room for shield potions, which
    // read as "shields don't work". Tap E to take/swap anything explicitly.
    const gunCount = () => a.inventory.slots.filter((s) => s && s.kind === "weapon").length;
    for (const n of near) {
      if (n.type !== "item" || n.d >= 1.5) continue;
      if (n.data.kind === "weapon" && gunCount() >= 3) continue;
      // a [Q]-dropped gun ignores its dropper's walkover for a beat
      const ent0 = items.get(n.id);
      if (ent0 && ent0.noWalkoverBy === a.id && W.t < ent0.noWalkoverUntil) continue;
      pickup(W, a, n.id);
    }
    // nearby() sorts ascending by distance, so picking the nearest thing meant a
    // ground item ALWAYS beat a chest it stood in front of — and the reset below
    // then wiped chestChannel.t every frame, so HOLD-E could never reach the 2 s
    // open. Durable because walkover refuses guns at the 3-gun cap and dropItem
    // scatters your swapped-out gun within 0.7 m of your own feet: swap a weapon
    // beside a chest and that chest becomes unopenable for the rest of the match.
    // While E is HELD the chest wins; otherwise the nearest item still leads.
    //
    // "Held" has to mean held for a WHILE, not merely down. player.js:470 sets
    // interact and interactDown on the SAME keydown, so testing interactDown
    // alone made the chest win on the tap frame too — which meant that standing
    // near an unopened chest silently disabled tap-E item swapping entirely,
    // trading one lockout for another. Anything past ~0.18 s is a deliberate
    // hold; below that it is a tap and the item keeps priority.
    a._eHoldT = a.input.interactDown ? (a._eHoldT || 0) + dt : 0;
    const chestNear = near.find((n) => n.type === "chest") || null;
    const itemNear = near.find((n) => n.type === "item" && items.has(n.id)) || null;
    const target = ((a._eHoldT || 0) > 0.18 && chestNear) ? chestNear : (itemNear || chestNear);
    // chest channel
    if (target && target.type === "chest" && a.input.interactDown) {
      if (chestChannel.id !== target.id) { chestChannel.id = target.id; chestChannel.t = 0; }
      chestChannel.t += dt;
      if (chestChannel.t >= CHEST_OPEN_S) { openChest(W, a, target.id); chestChannel.id = null; chestChannel.t = 0; }
    } else if (chestChannel.id) {
      chestChannel.id = null; chestChannel.t = 0;
    }
    // tap E on an item = swap into active slot
    if (a.input.interact) {
      a.input.interact = false;
      if (target && target.type === "item") pickup(W, a, target.id, { swap: true });
    }
    W.interactHint = target ? Object.assign({}, target, { progress: target.type === "chest" ? chestChannel.t / CHEST_OPEN_S : 0 }) : null;
  }

  // BOT WALKOVER (audit M6/gap 9). Bots only ever picked things up inside actLoot,
  // so a bot fighting, fleeing or rotating walked straight over a better gun. The
  // human's walkover rule now applies to every bot in every state, through the
  // same wouldAccept() predicate give() enforces (gun cap, bot trade-up, reserve
  // and stack caps) and the same [Q]-drop grace. Allocation-free grid walk.
  for (let i = 0; i < W.actors.length; i++) {
    const b = W.actors[i];
    if (!b.isBot || !b.alive || b.gliding || b.netRemote || !b.inventory) continue;
    botWalkover(W, b);
  }
  blobFlush();                    // this frame's blob slot changes, one sub-range upload
  fxFlush();                      // ...and the ring / beam / glow slots, one sub-range each
}

const WALK_R = 1.5, WALK_DY = 2.2;
function botWalkover(W, a) {
  const px = a.pos.x, pz = a.pos.z;
  const x0 = Math.floor((px - WALK_R) / LOOT_CELL), x1 = Math.floor((px + WALK_R) / LOOT_CELL);
  const z0 = Math.floor((pz - WALK_R) / LOOT_CELL), z1 = Math.floor((pz + WALK_R) / LOOT_CELL);
  for (let cx = x0; cx <= x1; cx++) {
    for (let cz = z0; cz <= z1; cz++) {
      const l = lootGrid.get(lkey(cx, cz));
      if (!l) continue;
      for (let j = 0; j < l.length; j++) {
        const e = l[j];
        if (e.kind !== "item") continue;
        const it = items.get(e.id);
        if (!it || it.taken) continue;
        const dx = it.pos.x - px, dz = it.pos.z - pz;
        if (dx * dx + dz * dz >= WALK_R * WALK_R || Math.abs(it.pos.y - a.pos.y) > WALK_DY) continue;
        if (it.noWalkoverBy === a.id && W.t < it.noWalkoverUntil) continue;
        if (!wouldAccept(W, a, it.data)) continue;
        pickup(W, a, it.id);
      }
    }
  }
}
const CHEST_OPEN_S = 2.0;
const chestChannel = { id: null, t: 0 };
