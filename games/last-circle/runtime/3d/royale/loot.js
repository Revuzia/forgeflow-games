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
 *
 * Wave 7 (lane 7C): an item or chest is SETTLED at spawn - out of any wall it was authored or piled into, off a stairwell hole onto the slab beside it,
 * down onto a hillside - from the static colliders only (same result on every squad client; see SETTLE below). A pickup (walkover / E / chest) reaches
 * 2.2 m up or down (REACH_DY), so a player standing on an upper floor or a roof does not take the loot of the room under it. W.nearbyLoot(pos, r, maxDy)
 * takes the same reach as an optional third argument (the default 4 m is the bots' planning query).
 *
 * Parity wave P2-H / P3 (lane loot, 2026-10):
 *  - DEATH PILE (LC-27): a death drop is ONE tidy pile (best item in the middle, the rest on a 0.55 m ring, sorted by value) with ONE marker (ring +
 *    beam + glow) in the RARITY_COLOR of its best gun, and ALL the victim's ammo (no 2-box cap). W.lootLabels(pos, r) is nearbyLoot with every pile
 *    folded into one entry carrying a sorted label (for the HUD's pills). An ammo pickup that does not fit leaves the remainder on the floor.
 *  - SUPPLY DROPS (LC-28): 4 per standard match, 3 per quick one, one at the start of each storm phase from 2; the crate lands on clear dry ground and
 *    is a "chest" record (id sd<N>): HOLD E to open (the chest channel, the bots' chest path, the net 'chest' message and the join-sync 'opened' list
 *    all carry it), with a red beacon beam + glow until it is opened. W.supplyDrops lists them (x, z, landed, opened) for the HUD.
 *  - LOOT TIERS + HOT ZONE (LC-29): POIs ranked by loot density into high / mid / basic, plus one seeded hot zone per match; a gun spawned inside a
 *    tiered POI gets a rarity uplift drawn from its OWN stream (seed x item id), so the shared streams and every item's kind and spot are unchanged.
 *    W.lootTiers / W.lootHotZone describe them (the big map marks the hot zone).
 *  - AMMO TINTS (LC-76): one colour per ammo type on the box (per-instance colour: no extra draw call) and on its ring.
 *  - CHEST BURST (LC-77): a chest bursts IN FRONT of itself, the gun and its own ammo on the same spot (one walk-over takes both).
 *  - W.nearbyChests(pos, r, out): allocation-free list of unopened chests / supply crates near a point (the audio lane's chest shimmer).
 *  - C-DBNO: a downed actor (a.downed) cannot pick up, open, walk over or drop loot; the player's E yields to a revive when a downed teammate is near.
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
const piles = new Map();      // death piles: pileId -> {id, pos, members:Set<itemId>, best, hex, ring, beam, glow, ringOn}

/** Match pacing (quick / standard / practice). C-MODE moves it to W.match.pace (W.match.mode becomes solo/duo/trio/squad); W.mode is the old field. */
function paceOf(W) {
  const p = W.match && W.match.pace;
  return p && K.MODE[p] ? p : W.mode;
}

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
  W.nearbyLoot = (pos, r, maxDy, los) => nearby(pos, r, maxDy, !!los);   // maxDy: vertical reach (default NEAR_DY); bots' walkover and the player's pickup pass REACH_DY;
                                                                           // los: a house item / chest only with a clear line to it (the player's own pickup always; see PICK_LOS_R)
  W.pickupItem = (a, id) => pickup(W, a, id);
  W.openChest = (a, id) => openChest(W, a, id);
  W.giveItem = (a, data) => give(W, a, data);
  W.wouldAcceptItem = (a, data) => wouldAccept(W, a, data);
  W.events.on("actorDied", (victim) => deathDrop(W, victim));

  // network mirrors + join-sync
  W.netTakeItem = (id) => {
    const it = items.get(id);
    if (it) { it.taken = true; releaseItem(it, W); items.delete(id); takenIds.push(id); }
  };
  // (a supply crate that has not landed on THIS client yet - the host's clock runs a little ahead, or a late joiner - is opened the moment it lands)
  W.netOpenChest = (id) => { if (!chests.has(id) && supplyState && /^sd\d+$/.test(id)) { supplyState.pendingOpen.add(id); return false; } return openChest(W, null, id); };
  W.netSpawnItem = (d) => {
    // (a partial ammo take's remainder carries its pile and surface, so it rejoins the same pile on every client)
    const P = d.pile ? piles.get(d.pile) : null;
    const id = spawnItem(W, d.data, d.x, d.y, d.z, d.id, d.surf != null || P ? { surf: d.surf != null ? d.surf : undefined, pile: P ? d.pile : undefined } : undefined);
    if (P && items.has(id)) { P.members.add(id); pileMarkers(W, P); }
    return id;
  };
  W.lootLabels = (pos, r) => lootLabels(pos, r);
  W.nearbyChests = (pos, r, out) => nearbyChests(pos, r, out);
  W.debugSupply = () => (supplyState ? { dropped: supplyState.dropped, max: supplyState.max, list: supplyState.list.map((s) => Object.assign({}, s)) } : null);
  W.debugPiles = () => [...piles.values()].map((p) => ({ id: p.id, x: p.pos.x, y: p.pos.y, z: p.pos.z, members: [...p.members], best: p.best, ring: p.ring, beam: p.beam, glow: p.glow, color: p.hex }));
  // [Q] — drop the active weapon for a squadmate (Final Drop parity, owner
  // screenshots). Refuses the LAST weapon: there is no melee in this game, so
  // an armed player must stay armed. Mag rides the drop (data.mag) and the
  // next weapon slot auto-equips.
  W.dropActive = (a) => {
    if (a.downed) return false;                    // C-DBNO: a downed actor cannot loot (nor throw its guns away)
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
  W.debugHouseLoot = debugHouseLoot;           // test hook (Wave 8 per-room loot: houses, points used / skipped, chests, per room kind)
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
  for (const P of VIS.values()) if (P.parts) for (const m of P.parts) { keep(m.geometry); keep(m.material); }   // the model pools (page-lifetime)
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
  items.clear(); chests.clear(); lootGrid.clear(); piles.clear();
  takenIds.length = 0;
  nextId = 1;
  swapN = 0;                      // swap-drop ids restart, so a replayed seed names drops identically
  remN = 0;
  supplyState = newSupplyState(W);
  W.supplyDrops = supplyState.list;
  chestChannel.id = null; chestChannel.t = 0;
  // Per-system stream for swap-drop scatter (was Math.random, which broke replay).
  W._scatterRng = K.mulberry32((((W.seed >>> 0) ^ 0x5ca77e) >>> 0));
  const rng = K.mulberry32(W.seed ^ 0x100f);
  const modeK = K.MODE[paceOf(W)] || K.MODE.standard;
  computeTiers(W);                 // LC-29: POI tiers + the hot zone (before any item spawns: the uplift reads them)
  const g = W.group("loot");
  g.clear();
  g.userData.disposed = false;
  blobReset();
  g.add(blobInit());
  fxResetPools();
  fxAttach(g);                     // the three marker pools (rings, beams, glows) ride in the loot group
  visAttach(W, g);                 // ...and the instanced models (every pool built so far; empty lists)

  let fi = 0;
  const floorPts = [];
  let light = 0;
  for (const lp of W.map.lootPoints) {
    if (lp.house != null && Array.isArray(W.map.houses)) continue;   // a furnished house's point (lane I1 lists them for the bots' landing spots): spawned by the per-room pass below
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
        const fid = k ? "f" + k + ":" + fi : "f:" + fi;
        uplift(W, data, lp.x, lp.z, fid);
        spawnItem(W, data, lp.x + o[0], lp.y, lp.z + o[1], fid);
        if (data.kind === "ammo" && data.id === "light") light++;
        k++;
      }
    }
  }
  // WAVE 8 (lane I3): the furnished houses' own loot, room by room (see PER-ROOM LOOT). Each house draws from its OWN stream (seed x house id), so
  // the shared `rng` above and below sees exactly the draws it saw before on a map without houses.
  const houseFloor = [];
  houseStatsReset();
  houseSpots.length = 0;
  W.houseLootSpots = houseSpots;     // (the bots' landing-spot list: the spots the per-room pass USED - a chest or a floor / top point with its items)
  losMap = W.map;
  const HS = W.map.houses;
  if (Array.isArray(HS)) for (let hi = 0; hi < HS.length; hi++) light += houseLoot(W, HS[hi], modeK, houseFloor);
  // Light-ammo floor guarantee (deterministic: same rng, fixed order). (A map whose loot is all indoors draws its pick from the house floor points.)
  const need = Math.ceil(LIGHT_MIN_PER_50 * (modeK.players || 50) / 50) - light;
  const gPool = floorPts.length ? floorPts : houseFloor;
  for (let i = 0; i < need && gPool.length; i++) {
    const lp = gPool[Math.floor(rng() * gPool.length)];
    const data = { kind: "ammo", id: "light", count: K.AMMO.light.box };
    if (lp.H) houseItem(W, data, lp, lp.k++, "fl:" + i);
    else spawnItem(W, data, lp.x - 0.6, lp.y, lp.z + 1.0, "fl:" + i);
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
 *  draws nothing it should not. The fourth object is the supply-crate proxy (see below). */
export function warmObjects(W) {
  const P = fxInit();
  const g = W.group("loot");
  for (const k of ["rings", "beams", "glows"]) if (!P[k].mesh.parent) g.add(P[k].mesh);
  // The supply crate is born at storm phase 2 (about 4.5 minutes in), so its two programs used to link on the frame it first came into view: the
  // opaque box shares the plain standard program, but the BALLOON is a transparent MeshStandardMaterial and three keys `opaque`, so it is a
  // program of its own (measured on all three maps, 270-290 s into the match). A page-lifetime proxy built by the SAME factory the live drop uses
  // gives the warm frame both materials; it holds the programs for the session, and no live crate shares an instance with it.
  if (!_warmCrate) _warmCrate = makeSupplyCrate().crate;
  const out = [P.rings.mesh, P.beams.mesh, P.glows.mesh, _warmCrate];
  // The model pools (INSTANCED LOOT MODELS): every kind a match can show is built here when its model is loaded - every weapon proto, the
  // pickups, ammo and the chest pools - so the warm frame links each instanced program (and the near chests' instanced depth variant);
  // a kind that first appears mid-match would otherwise link its program on the frame it comes into view.
  if (W._weaponProtos) for (const id in W._weaponProtos) itemPool(W, { kind: "weapon", id });
  itemPool(W, { kind: "ammo", id: "light" });
  for (const id in ITEM_FILES) if (itemProtoCache[id] !== undefined) itemPool(W, { kind: "consumable", id });
  if (chestProto) chestPools(W);
  for (const Q of VIS.values()) if (Q.parts) for (const m of Q.parts) { if (!m.parent) g.add(m); out.push(m); }
  return out;
}
let _warmCrate = null;

/** ONE builder for the supply crate (box + balloon), used by the live drop and by warmObjects, so the materials the warm-up links can never drift
 *  from the ones the drop draws. */
// The crate (LC-28 look pass): a plain 1.6 m blue cube read as a placeholder next to PUBG's red-and-white care package and Apex's banded pod. Now a
// steel-framed military crate: a dark body, a light metal frame on all 12 edges with corner feet, a red band round it and a red lamp on the lid (the
// beacon's colour; it goes dark when the crate is opened). Four meshes, each ONE merged geometry, all plain opaque MeshStandardMaterial (the program
// every untextured prop already uses) - and the same factory builds the warm proxy, so nothing links mid-match.
const CRATE_W = 1.6, CRATE_H = 1.4, CRATE_E = 0.11;
function mergeBoxes(list) {
  // list: [w, h, d, x, y, z] ... -> one indexed BufferGeometry (position / normal / uv)
  const pos = [], nor = [], uv = [], idx = [];
  for (const [w, h, d, x, y, z] of list) {
    const b = new THREE.BoxGeometry(w, h, d);
    b.translate(x, y, z);
    const o = pos.length / 3;
    pos.push(...b.attributes.position.array); nor.push(...b.attributes.normal.array); uv.push(...b.attributes.uv.array);
    for (const i of b.index.array) idx.push(i + o);
    b.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}
function makeSupplyCrate() {
  const crate = new THREE.Group();
  const W2 = CRATE_W / 2, H = CRATE_H, e = CRATE_E, y0 = 0.08;     // y0: the feet lift the body off the ground
  const body = new THREE.Mesh(mergeBoxes([[CRATE_W - 0.06, H - 0.06, CRATE_W - 0.06, 0, y0 + H / 2, 0]]),
    new THREE.MeshStandardMaterial({ color: 0x34495e, metalness: 0.35, roughness: 0.62 }));
  const bars = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bars.push([e, H, e, sx * (W2 - e / 2), y0 + H / 2, sz * (W2 - e / 2)]);   // 4 uprights
  for (const yy of [y0 + e / 2, y0 + H - e / 2]) for (const s of [-1, 1]) {
    bars.push([CRATE_W, e, e, 0, yy, s * (W2 - e / 2)]);
    bars.push([e, e, CRATE_W, s * (W2 - e / 2), yy, 0]);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) bars.push([0.2, y0 + 0.02, 0.2, sx * (W2 - 0.1), (y0 + 0.02) / 2, sz * (W2 - 0.1)]);   // feet
  bars.push([0.08, 0.06, CRATE_W - 0.2, 0, y0 + H + 0.01, 0], [CRATE_W - 0.2, 0.06, 0.08, 0, y0 + H + 0.01, 0]);   // lid cross straps
  const frame = new THREE.Mesh(mergeBoxes(bars), new THREE.MeshStandardMaterial({ color: 0xc3c9cf, metalness: 0.7, roughness: 0.38 }));
  const bandY = y0 + H * 0.62, bh = 0.2;
  const band = new THREE.Mesh(mergeBoxes([[CRATE_W - 0.03, bh, CRATE_W - 0.03, 0, bandY, 0]]),
    new THREE.MeshStandardMaterial({ color: 0xc8322a, metalness: 0.2, roughness: 0.55 }));
  const lamp = new THREE.Mesh(mergeBoxes([[0.34, 0.14, 0.34, 0, y0 + H + 0.08, 0], [0.2, 0.08, 0.2, 0, y0 + H + 0.19, 0]]),
    new THREE.MeshStandardMaterial({ color: 0x3a0d0a, emissive: 0xff4a38, emissiveIntensity: 2.2, metalness: 0.1, roughness: 0.4 }));
  body.castShadow = frame.castShadow = true;
  crate.add(body, frame, band, lamp);
  const balloon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 10), new THREE.MeshStandardMaterial({ color: 0xf2a33c, transparent: true, opacity: 0.85 }));
  balloon.position.y = 5;
  crate.add(balloon);
  return { crate, box: body, lamp, balloon };
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
  items.clear(); chests.clear(); lootGrid.clear(); piles.clear();
  blobReset();
  fxResetPools();                  // every marker slot back to the free list; the pools themselves are page-lifetime
  visReset();                      // the model pools' lists (the pools, their geometry and buffers are page-lifetime)
  takenIds.length = 0;
  supplyState = null;
  chestChannel.id = null; chestChannel.t = 0;
  losMap = null;                   // (the per-room pickup's line-of-sight map: never keep a finished match's colliders alive)
  return r;
}

// ── visuals ──────────────────────────────────────────────────────────────────
const kindGeos = {
  ammo: new THREE.BoxGeometry(0.34, 0.24, 0.24),
  consumable: new THREE.CylinderGeometry(0.14, 0.14, 0.4, 8),
};
const kindMats = {
  ammo: new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.35, roughness: 0.5 }),   // x the per-instance AMMO_TINT (LC-76)
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
  if (it.surf != null) { _surf.floor = it.surf; _surf.onBox = true; _surf.q.identity(); }   // a house loot point: its surface AS GIVEN (PER-ROOM LOOT)
  else if (!surfaceUnder(W, x, y, z)) return -1;
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
// LC-76: one colour per ammo type (all five shared one olive box and one ring colour). Hues far apart and away from the heal green / shield blue rings:
// light amber, medium teal, shells red, heavy (sniper) violet, grenades steel. The box takes it as its instance colour (the ammo pool is ONE draw).
const AMMO_TINT = { light: "#e8a636", medium: "#2fc4a4", shells: "#e0453a", heavy: "#8a7cf4", grenades: "#a9b3bf" };
const AMMO_BOX_K = 0.8;                // the box's albedo = tint x this (painted metal, not a lamp)
const _tintC = new THREE.Color();
function ammoTint(id) { _tintC.set(AMMO_TINT[id] || AMMO_HEX); return [_tintC.r * AMMO_BOX_K, _tintC.g * AMMO_BOX_K, _tintC.b * AMMO_BOX_K]; }

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
function markerSurface(W, x, y, z, surf) {
  if (surf != null) { _surf.floor = surf; _surf.onBox = true; _surf.q.identity(); return true; }   // a house loot point / chest slot: the surface AS GIVEN
  if (surfaceUnder(W, x, y, z)) return true;
  _surf.floor = y - 0.15; _surf.onBox = true; _surf.q.identity();
  return true;
}
/** Ring slot for something lying at (x, y, z); -1 only when the pool is full. */
function ringAlloc(W, x, y, z, hex, small, diameter, id, surf) {
  const P = FX.pools && FX.pools.rings;
  if (!P || !markerSurface(W, x, y, z, surf)) return -1;
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
  if (it.pile) return;                 // a death-pile member: the pile carries ONE marker (see DEATH PILE)
  if (d.kind === "weapon") {
    const rar = d.rarity || 0, hex = K.RARITY_COLOR[K.RARITY[rar]] || K.RARITY_COLOR.common;
    it.ring = ringAlloc(W, x, y, z, hex, false, it.ringD || RING_D_WEAPON, it.id, it.surf);
    if (it.ring >= 0) {
      it.ceil = ceilingAbove(W, x, z, _surf.floor, BEAM_R[rar] + 0.12);
      it.beam = beamAlloc(x, _surf.floor, z, hex, BEAM_H[rar], BEAM_R[rar], BEAM_GAIN[rar], BEAM_FAR[rar], it.ceil);
    }
  } else {
    const hex = d.kind === "ammo" ? (AMMO_TINT[d.id] || AMMO_HEX) : (d.id && d.id.indexOf("shield") >= 0 ? SHIELD_HEX : HEAL_HEX);
    it.ring = ringAlloc(W, x, y, z, hex, true, Math.min(RING_D_SMALL, it.ringD || RING_D_SMALL), it.id, it.surf);
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

// ── INSTANCED LOOT MODELS (Wave 7b, lane S2) ─────────────────────────────────────────────────────────────────────────────────────────
// Every floor item and every chest used to be a CLONE of its model: a gun = 1-3 draw calls, an ammo box 1, a chest FIVE (two meshes of
// lid and three of base), each per item in the 150 m model cull. Measured (perfbreak, Savanna s31337 endgame view, 2026-10-19): chests
// 39 + 10 shadow calls and floor items 59 calls of the view's 238, against 9 + 5 at the Wave-6 build - the whole of the +119 the
// cumulative perf bar sees. Now every model is ONE InstancedMesh per (kind, material): the parts of a model are baked into one geometry
// per material at its pose inside the old item group (a gun 0.45 m up, tilted 0.5 rad; an ammo box 0.35 m; a pickup 0.42 m), and the
// instance matrix is the old group's transform (the item's spot + the shared bob, the shared spin; a chest's fixed heading). A kind's parts
// share ONE matrix attribute (one upload). Only the items inside the cull are written, compacted to the front, so a hidden item costs no
// vertex work and the triangle count is exactly the drawn models'; the bounding sphere is refitted to what is drawn, so three's frustum
// test still drops a kind behind the camera. Chests: an opened chest is dimmed through the instance colour (it used to clone its
// materials), and the chests within the shadow radius are drawn by a second "near" pool that casts (with the per-material depth
// materials below) while the rest do not - the old per-chest shadow hand-back, two pools instead of one flag per clone.
// Render-only: no random draw, no position, no id changes (replay and the squad worlds are untouched).
const VIS_MAX = 512;                                   // models of ONE kind drawn at once (the 150 m cull holds far fewer)
const VIS = new Map();                                 // key -> pool (page-lifetime, like the marker pools; re-parented each match)
const VIS_ARR = [];                                    // the same pools as an array: the per-render loop walks it by index (no iterator per frame)
const _vS = new THREE.Sphere(), _vM = new THREE.Matrix4(), _vM2 = new THREE.Matrix4(), _vQ = new THREE.Quaternion(), _vE = new THREE.Euler(), _vP = new THREE.Vector3(), _vSc = new THREE.Vector3();
/** Merge same-layout geometries (one material's parts) into one indexed geometry; null when the attribute layouts differ. */
function mergeParts(geos) {
  if (geos.length === 1) return geos[0];
  const names = Object.keys(geos[0].attributes).sort();
  for (const g of geos) { const n = Object.keys(g.attributes).sort(); if (n.join() !== names.join()) return null; for (const k of names) if (g.attributes[k].itemSize !== geos[0].attributes[k].itemSize) return null; }
  let nv = 0, ni = 0;
  for (const g of geos) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const out = new THREE.BufferGeometry(), idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  for (const k of names) {
    const sz = geos[0].attributes[k].itemSize, arr = new Float32Array(nv * sz);
    let o = 0;
    for (const g of geos) { const a = g.attributes[k]; for (let i = 0; i < a.count; i++) for (let c = 0; c < sz; c++) arr[o++] = a.getComponent(i, c); }
    out.setAttribute(k, new THREE.BufferAttribute(arr, sz));
  }
  let vo = 0, io = 0;
  for (const g of geos) {
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < g.attributes.position.count; i++) idx[io++] = i + vo;
    vo += g.attributes.position.count;
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}
/** The parts of a model: its meshes baked at `rootXf` (the old clone's root transform, replacing the proto root's own), grouped and merged per material. */
function bakeModel(proto, rootXf) {
  proto.updateMatrixWorld(true);
  const inv = _vM2.copy(proto.matrixWorld).invert();
  const byMat = new Map();
  proto.traverse((n) => {
    if (!n.isMesh || !n.geometry || n.isSkinnedMesh) return;
    const geo = n.geometry.clone();
    geo.applyMatrix4(_vM.multiplyMatrices(rootXf, _vM.multiplyMatrices(inv, n.matrixWorld)));
    for (const k of Object.keys(geo.attributes)) if (k !== "position" && k !== "normal" && k !== "uv" && k !== "color" && k !== "uv1") geo.deleteAttribute(k);   // (tangents etc.: not used by these materials, and they block a merge)
    const key = n.material;
    if (!byMat.has(key)) byMat.set(key, []);
    byMat.get(key).push(geo);
  });
  const parts = [];
  for (const [mat, geos] of byMat) {
    const multi = Array.isArray(mat) || geos.some((g) => g.groups && g.groups.length);
    const merged = multi ? null : mergeParts(geos);
    if (merged) { if (merged !== geos[0]) for (const g of geos) g.dispose(); parts.push([merged, mat]); }
    else for (const g of geos) parts.push([g, mat]);
  }
  return parts;
}
/** A pool for one model kind. `src` resolves to [proto, rootXf] (or null = nothing to draw). opts: { color: per-instance colour (chests), cast, depthFor } */
function visPool(key, src, opts) {
  let P = VIS.get(key);
  if (P) return P;
  P = { key, items: [], parts: null, mat: new THREE.InstancedBufferAttribute(new Float32Array(VIS_MAX * 16), 16), col: null, n: 0, dirty: true, cast: !!(opts && opts.cast), opts: opts || {}, pending: null };
  P.mat.setUsage(THREE.DynamicDrawUsage);
  if (P.opts.color) { P.col = new THREE.InstancedBufferAttribute(new Float32Array(VIS_MAX * 3).fill(1), 3); P.col.setUsage(THREE.DynamicDrawUsage); }
  VIS.set(key, P); VIS_ARR.push(P);
  const build = (r) => {
    if (!r || !r[0]) { P.parts = []; return; }
    const parts = bakeModel(r[0], r[1]);
    P.parts = parts.map(([geo, mat]) => {
      const m = new THREE.InstancedMesh(geo, mat, VIS_MAX);
      m.instanceMatrix = P.mat;                        // one matrix buffer for every part of the kind
      if (P.col) m.instanceColor = P.col;
      m.name = "loot-model:" + key;
      m.count = 0; m.visible = false;
      m.castShadow = P.cast; m.receiveShadow = false;
      if (P.cast && P.opts.depthFor && !Array.isArray(mat)) m.customDepthMaterial = P.opts.depthFor(mat);
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      m.boundingSphere = new THREE.Sphere();
      m.userData.geoR = geo.boundingSphere.radius + geo.boundingSphere.center.length();
      return m;
    });
    if (visGroup) for (const m of P.parts) visGroup.add(m);
    P.dirty = true;
  };
  try {
    const r = src();
    if (r && typeof r.then === "function") P.pending = r.then(build, () => build(null));
    else build(r);
  } catch (e) { build(null); }
  return P;
}
let visGroup = null;
/** the loot group of the match: every built pool's meshes ride in it (re-parented by populate, like the marker pools) */
function visAttach(W, g) {
  visGroup = g;
  // the per-render hook (see visFrame): chained in front of whatever the scene already runs; installed once per scene
  const sc = W.scene || (W.kernel && W.kernel.scene);
  if (sc && sc.isScene && !sc.__lootVisHook) {                     // (a Node probe's stand-in W has no scene: nothing renders there)
    const prev = typeof sc.onBeforeRender === "function" ? sc.onBeforeRender : function () {};
    sc.onBeforeRender = function (renderer, scene, camera, rt) { visFrame(camera); return prev.call(this, renderer, scene, camera, rt); };
    sc.__lootVisHook = true;
  }
  for (const P of VIS.values()) { P.items.length = 0; P.n = 0; P.dirty = true; if (P.parts) for (const m of P.parts) { m.count = 0; m.visible = false; g.add(m); } }
}
function visReset() { for (const P of VIS.values()) { P.items.length = 0; P.n = 0; P.dirty = true; if (P.parts) for (const m of P.parts) { m.count = 0; m.visible = false; } } }
function visAdd(P, o) { o.vp = P; o.vi = P.items.length; P.items.push(o); P.dirty = true; }
function visRemove(o) {
  const P = o.vp;
  if (!P) return;
  const last = P.items.pop();
  if (last !== o) { P.items[o.vi] = last; last.vi = o.vi; }
  o.vp = null; o.vi = -1; P.dirty = true;
}
const _rootXf = (y, rz, root) => {
  const m = new THREE.Matrix4();
  _vE.set(root ? root.rotation.x : 0, root ? root.rotation.y : 0, rz);
  return m.compose(_vP.set(root ? root.position.x : 0, y, root ? root.position.z : 0), _vQ.setFromEuler(_vE), root ? _vSc.copy(root.scale) : _vSc.set(1, 1, 1));
};
const ITEM_POOL_KEY = (d) => (d.kind === "weapon" ? "w:" + d.id : d.kind === "ammo" ? "ammo" : d.kind === "consumable" ? "c:" + d.id : null);
/** The pool an item's model is drawn by (created on first use; null = the item has no model, e.g. a gun before weapons.js exists). */
function itemPool(W, data) {
  const key = ITEM_POOL_KEY(data);
  if (!key) return null;
  if (VIS.has(key)) return VIS.get(key);
  if (data.kind === "weapon") {
    if (!W.weaponProto) return null;
    return visPool(key, () => W.weaponProto(data.id).then((proto) => (proto ? [proto, _rootXf(0.45, 0.5, proto)] : null)));
  }
  if (data.kind === "ammo") return visPool(key, () => { const g = new THREE.Group(); g.add(new THREE.Mesh(kindGeos.ammo, kindMats.ammo)); return [g, _rootXf(0.35, 0, null)]; }, { color: true, tinted: true });
  // consumable: the Meshy model when there is one, the glowing capsule when not
  const fallback = () => { const g = new THREE.Group(); g.add(new THREE.Mesh(kindGeos.consumable, data.id.includes("shield") ? kindMats.shieldC : kindMats.heal)); return [g, _rootXf(0.4, 0, null)]; };
  if (!W.itemProto) return visPool(key, fallback);
  return visPool(key, () => W.itemProto(data.id).then((proto) => (proto ? [proto, _rootXf(0.42, 0, proto)] : fallback()), fallback));
}
/** The chest pools: "far" (no shadow) and "near" (casts, inside CHEST_SHADOW_R). */
function chestPools(W) {
  if (CHEST_P) return CHEST_P;
  const src = () => ensureChestProto(W).then((proto) => { proto.updateMatrix(); return [proto, proto.matrix.clone()]; });   // (the clone kept the proto root's own scale + lift)
  return (CHEST_P = [visPool("chest:far", src, { color: true, chest: true }), visPool("chest:near", src, { color: true, chest: true, cast: true, depthFor: chestDepthFor })]);
}
let CHEST_P = null;
/** Write the drawn instances of every pool: the items / chests whose `vis` is set (update(): inside the 150 m model cull) and whose model is
 *  in THIS render's view, compacted; the kind's bounding sphere refitted. Runs from the scene's onBeforeRender (installed by populate), i.e.
 *  with the camera of the very render that draws them, before three uploads the instance buffers: one kind's sphere spans every model of it
 *  within the cull, so without the per-model view test a pool would draw the models behind the camera too (the clones were frustum-tested one
 *  by one). The casting "near" chests are not view-tested: a chest behind you still throws its shadow into the view. */
const _vF = new THREE.Frustum(), _vPM = new THREE.Matrix4(), _vT = new THREE.Sphere();
function visFrame(cam) {
  const ang = bobT * 1.4, cs = Math.cos(ang), sn = Math.sin(ang);
  const useF = !!(cam && cam.isCamera && cam.projectionMatrix && cam.matrixWorldInverse);
  if (useF) _vF.setFromProjectionMatrix(_vPM.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
  for (let pi = 0; pi < VIS_ARR.length; pi++) {
    const P = VIS_ARR[pi];
    if (!P.parts || !P.parts.length) continue;
    const chest = !!P.opts.chest, tinted = !!P.opts.tinted, viewTest = useF && !P.cast;
    if (chest && !P.dirty && !viewTest) continue;      // the near chests never move: rewritten only when their set changes
    const a = P.mat.array, ca = P.col ? P.col.array : null, rr = P.parts[0].userData.geoR + 0.5;
    let n = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < P.items.length && n < VIS_MAX; i++) {
      const o = P.items[i];
      if (!o.vis) continue;
      if (viewTest) { _vT.center.set(o.pos.x, o.pos.y, o.pos.z); _vT.radius = rr; if (!_vF.intersectsSphere(_vT)) continue; }
      const x = o.pos.x, z = o.pos.z, y = chest ? o.pos.y : o.pos.y + Math.sin(bobT * 2 + x) * 0.08 + 0.08 - o.drop;   // (drop: a house item on a furniture top is drawn lower, see PER-ROOM LOOT)
      const q = chest ? o.sc : 1, c = (chest ? o.rc : cs) * q, s = (chest ? o.rs : sn) * q, k = n * 16;   // (q: a house chest is drawn to fit its slot)
      a[k] = c; a[k + 1] = 0; a[k + 2] = -s; a[k + 3] = 0; a[k + 4] = 0; a[k + 5] = q; a[k + 6] = 0; a[k + 7] = 0;
      a[k + 8] = s; a[k + 9] = 0; a[k + 10] = c; a[k + 11] = 0; a[k + 12] = x; a[k + 13] = y; a[k + 14] = z; a[k + 15] = 1;
      if (ca) {
        if (tinted && o.tint) { ca[n * 3] = o.tint[0]; ca[n * 3 + 1] = o.tint[1]; ca[n * 3 + 2] = o.tint[2]; }
        else { const v = o.opened ? 0.45 : 1; ca[n * 3] = v; ca[n * 3 + 1] = v; ca[n * 3 + 2] = v; }
      }
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
      n++;
    }
    P.n = n; P.dirty = false;
    if (n) {
      queueRange(P.mat, 0, n * 16);
      if (ca) queueRange(P.col, 0, n * 3);
      _vS.center.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      _vS.radius = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0)) / 2;
    }
    for (let i = 0; i < P.parts.length; i++) {
      const m = P.parts[i];
      m.count = n; m.visible = n > 0;
      if (n) { m.boundingSphere.center.copy(_vS.center); m.boundingSphere.radius = _vS.radius + m.userData.geoR; }
    }
  }
}

// ── SETTLE (Wave 7, lane 7C): never leave loot inside a wall or hovering over a hole ─────────────────────────────────────────────────
// A pile offset or a chest burst lands on a thin wall, a fence post or a container (live 60b854d0: 20 of 1,977 Savanna items inside a box); loot
// authored at an upper floor can sit over the stairwell hole, 4 m above the slab it should lie on (36 of 1,977: no contact blob, a ring floating
// in the air, a beam that goes through the roof). Both are pure functions of the STATIC colliders and the ground - no random draw, so every squad
// client puts the item in the same place - and both are fixed the same way: take the nearest spot (rings of 0.4 m up to 2 m, 16 headings, a fixed
// order) where the body is clear of every solid box AND there is a floor within 0.9 m under it (a box top, a ramp surface or the ground). Nothing
// valid within reach (a chest on a hull over the sea, an item still in the air) keeps the authored spot, as before.
const _stCols = [];
const SETTLE_RINGS = [0.4, 0.8, 1.2, 1.6, 2.0], SETTLE_STEPS = 16;
const SETTLE_DIR = [];
for (let i = 0; i < SETTLE_STEPS; i++) SETTLE_DIR.push([Math.cos(i * Math.PI * 2 / SETTLE_STEPS), Math.sin(i * Math.PI * 2 / SETTLE_STEPS)]);
/** the sloped slab of a ramp collider at (x, z) (maps.js C-RAMP: dir 0 rises toward +x, 1 toward -x, 2 toward +z, 3 toward -z) */
function rampTopAt(c, x, z) {
  const w = Math.max(0.01, c.dir < 2 ? c.maxX - c.minX : c.maxZ - c.minZ);
  const f = c.dir === 0 ? (x - c.minX) / w : c.dir === 1 ? (c.maxX - x) / w : c.dir === 2 ? (z - c.minZ) / w : (c.maxZ - z) / w;
  return c.minY + (c.maxY - c.minY) * Math.min(1, Math.max(0, f));
}
/** What is within 0.9 m under a body whose base is at y: 2 = a box top or the ground (what surfaceUnder - the contact blob and the floor ring - can
 *  sit on), 1 = only a ramp surface (an item on a stair: no blob, the ring floats flat at the item), 0 = nothing (over a hole, in the air). */
function floorUnder(M, x, z, y) {
  let floor = M.heightAt(x, z), ramp = -Infinity;
  const cs = M.queryColliders(x, z, 0.05, _stCols);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
    if (c.kind === "box") { if (c.maxY <= y + 0.05 && c.maxY > floor) floor = c.maxY; }
    else if (c.kind === "ramp") { const t = rampTopAt(c, x, z); if (t <= y + 0.05 && t > ramp) ramp = t; }
  }
  if (y - floor <= 0.9) return 2;
  return y - ramp <= 0.9 ? 1 : 0;
}
/** does a body (radius rad, from y + 0.05 up to y + hi) overlap the interior of a solid box? A box whose top is at or under the body's base is
 *  the floor it rests on, not a solid it is inside. */
function bodyInSolid(M, x, z, y, rad, hi) {
  const cs = M.queryColliders(x, z, rad + 0.05, _stCols);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.kind !== "box") continue;
    if (x < c.minX - rad || x > c.maxX + rad || z < c.minZ - rad || z > c.maxZ + rad) continue;
    if (c.maxY <= y + 0.12) continue;
    if (y + hi > c.minY + 0.05 && y + 0.05 < c.maxY - 0.05) return true;
  }
  return false;
}
const _settled = { x: 0, z: 0, moved: false };
/** Fills and returns `_settled` (shared scratch). The authored spot stays when it is clear of every solid and a box top or the ground is under
 *  it; else the nearest spot within 2 m that is (a spot only a RAMP supports is a last resort: an item lying on a stair stays on the stair unless a
 *  slab or the ground is within reach, and so does a death drop); else the authored spot again. */
function settle(W, x, y, z, rad, hi) {
  const M = W.map;
  _settled.x = x; _settled.z = z; _settled.moved = false;
  if (!M || !M.queryColliders) return _settled;
  const k0 = bodyInSolid(M, x, z, y, rad, hi) ? 0 : floorUnder(M, x, z, y);
  if (k0 === 2) return _settled;
  for (let pass = 2; pass >= 1; pass--) {                    // pass 1 takes a box top / the ground, pass 2 settles for a ramp surface
    if (pass === 1 && k0 === 1) return _settled;             // already on a stair and nothing better in reach
    for (let ri = 0; ri < SETTLE_RINGS.length; ri++) {
      const r = SETTLE_RINGS[ri];
      for (let k = 0; k < SETTLE_STEPS; k++) {
        const nx = x + SETTLE_DIR[k][0] * r, nz = z + SETTLE_DIR[k][1] * r;
        if (bodyInSolid(M, nx, nz, y, rad, hi) || floorUnder(M, nx, nz, y) < pass) continue;
        _settled.x = nx; _settled.z = nz; _settled.moved = true;
        return _settled;
      }
    }
  }
  return _settled;
}

/** A pile offset on a hillside (or a drop beside a ledge) keeps the AUTHORED height, so on a 45 degree slope an item 1 m uphill of its point hangs
 *  1-2 m over the ground it lies on (live 60b854d0, Isla Viva's volcano: 23 of 1,804 items; no blob, a ring in the air). With NOTHING under it (no
 *  box top, no ramp surface) and the ground 0.9-3 m below, it lies on the ground at the usual 0.5 m hover instead - unless that is inside a solid
 *  or under the waterline (maps.js loot() drops points below waterY + 0.4). Anything within 0.9 m of a box top or a stair is left alone. */
function lowerOnSlope(W, x, z, gy) {
  const M = W.map;
  const ground = M.heightAt(x, z);
  if (gy - ground <= 0.9 || gy - ground > 3 || floorUnder(M, x, z, gy) !== 0) return gy;
  const ly = ground + 0.5;
  if (ly < (M.waterY == null ? -Infinity : M.waterY + 0.4) || bodyInSolid(M, x, z, ly, 0.15, 0.7)) return gy;
  return ly;
}

/** id must be DETERMINISTIC across clients (derived from source, not spawn
 * order) so multiplayer "take" mirroring removes the right item everywhere. */
export function spawnItem(W, data, x, y, z, id, opt) {
  id = id || "i" + (nextId++);
  if (items.has(id)) return id;
  let gy;
  if (opt && opt.surf != null) gy = y;                 // a house loot point (PER-ROOM LOOT): the spot and the surface AS GIVEN - never settled, never snapped
  else {
    gy = Math.max(y, W.map.heightAt(x, z) + 0.15);
    const st = settle(W, x, gy, z, 0.15, 0.7);          // out of walls, off the stairwell hole (see SETTLE above)
    if (st.moved) { x = st.x; z = st.z; gy = Math.max(y, W.map.heightAt(x, z) + 0.15); }
    gy = lowerOnSlope(W, x, z, gy);
  }
  // the model is an instance of its kind's pool (see INSTANCED LOOT MODELS); vis = inside the model cull (set by update)
  const it = { id, data, pos: { x, y: gy, z }, taken: false, vis: true, vp: null, vi: -1, blob: -1, ring: -1, beam: -1, glow: -1, ceil: Infinity,
    surf: opt && opt.surf != null ? opt.surf : null, ringD: opt && opt.ringD ? opt.ringD : 0, house: opt && opt.house ? opt.house : null, drop: opt && opt.drop ? opt.drop : 0, rr: opt && opt.rr ? opt.rr : null,   // rr: a house item's room rects (K2)
    pile: opt && opt.pile ? opt.pile : null, tint: data.kind === "ammo" ? ammoTint(data.id) : null };   // pile: a death pile member (no marker of its own); tint: LC-76
  const P = itemPool(W, data);
  if (P) visAdd(P, it);
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

function spawnChest(W, x, y, z, opt) {
  const id = "c" + (nextId++);
  // The chest rests ON the surface under it (the highest floor at or just below its authored height, else the terrain). Every authoring
  // site passes surface + 0.6, so the old `y - 0.4` hung it 0.20 m over the grass (all 193-245 terrain chests per 5 seeds) and sank it
  // 0.10 m into a roof slab. Nothing within 0.9 m under it (a chest on a hull over the sea, a sky island) keeps the old formula.
  const restY = (px, pz) => (surfaceUnder(W, px, y, pz) ? _surf.floor : Math.max(y - 0.4, W.map.heightAt(px, pz)));
  let gy, ry;
  if (opt) { gy = opt.surf; ry = opt.ry; }                  // a house chest (PER-ROOM LOOT): its slot, floor and heading AS GIVEN - never settled
  else {
    // SETTLE (see above): a 1.6 m chest clear of every wall (its body is judged from the floor it rests on) and standing on a floor, not over a hole
    const st = settle(W, x, restY(x, z), z, 0.55, 0.9);
    if (st.moved) { x = st.x; z = st.z; }
    gy = restY(x, z);
    ry = (x * 13.7 + z * 7.3) % (Math.PI * 2);              // varied facing (the census probes re-derive it from the position)
  }
  // gold ring, light beam and glow so chests read from far away: three slots in the
  // shared instanced pools (no per-chest meshes, sprites or materials)
  fxInit();
  const ring = ringAlloc(W, x, gy + 0.15, z, K.RARITY_COLOR.legendary, false, opt ? HOUSE_CHEST_RING : RING_D_CHEST, id, opt ? gy : null);
  let beam = -1, glow = -1, ceil = Infinity;
  if (ring >= 0) {
    ceil = ceilingAbove(W, x, z, _surf.floor, CHEST_BEAM.r + 0.12);
    beam = beamAlloc(x, _surf.floor, z, GOLD_HEX, CHEST_BEAM.h, CHEST_BEAM.r, CHEST_BEAM.gain, CHEST_BEAM.far, ceil);
    glow = opt ? glowAlloc(x, _surf.floor + 0.9 * opt.sc, z, 3.2 * opt.sc, GOLD_HEX, GLOW_GAIN) : glowAlloc(x, _surf.floor + 0.9, z, 3.2, GOLD_HEX, GLOW_GAIN);
  }
  // the model: an instance of the chest pools (see INSTANCED LOOT MODELS). It starts in the casting "near" pool, so the match warm-up
  // frame links the instanced depth variant; update() moves it by distance (on inside 45 m, off past 50 m) and culls it past the model cull.
  const rec = { id, pos: { x, y: gy, z }, opened: false, glow, beam, ring, ringOn: true, ceil, rc: Math.cos(ry), rs: Math.sin(ry), vis: true, cast: true, vp: null, vi: -1,
    sc: opt ? opt.sc : 1, R: opt ? opt.R : null, house: opt ? opt.house : null, room: opt ? opt.room : null, half: opt ? opt.half : null };
  visAdd(chestPools(W)[1], rec);
  chests.set(id, rec);
  gridAdd("chest", id, { x, z });
  return id;
}

// ── PER-ROOM LOOT (Wave 8, lane I3) ─────────────────────────────────────────────────────────────────────────────────────────────────
// W.map.houses (maps.js, lane I1) holds the furnished houses as housegen.js generated them (its header: rooms[{ id, floor, kind, walk, rects }],
// furniture[{ id, cat, room, floor, min, max }], loot[{ id, room, floor, x, y, z, on 'floor' | <catalog id> }], chests[{ id, room, floor, x, y, z }]).
// housegen has already put every point where the real mover reaches it, never under or inside a piece, out of door and stair zones; so here:
//  - the point and its y are used AS GIVEN: y is the visible surface the item lies on (a floor, a counter, a shelf). It can sit UNDER that piece's
//    collider top (a sink's top 0.95 under its backsplash's 1.08, a gondola's mid shelf 1.13 under its 1.35 top): settle() / surfaceUnder() would
//    lift the ring to the collider top or move the item, so a house item carries `surf` and its contact blob, ring and beam stand on it;
//  - the extra items of a pile stay in the room (its walk rects, clear of every piece) or on the same top (inside that piece's footprint);
//  - an item never hangs inside what is over it (a wall cabinet over a counter): its hover shrinks under it, and a point with no room left is skipped;
//  - density (PUBG-like: most rooms none or one spot, kitchens / bedrooms / shops first, a corridor or a bath rarely): a per-house budget of spots
//    (HOUSE_SPOTS_*) handed to rooms by a draw weighted on the room kind (ROOM_W); in a room its points in housegen's order (furniture tops first,
//    so a shop loots its shelves), each with the usual floor roll;
//  - chests: housegen offers at most one slot per floor; a house keeps at most HOUSE_CHESTS (1, 2 from 3 storeys), never in a bath or a corridor,
//    drawn at HOUSE_CHEST_SC so it fits the 1.0 x 0.75 m slot (the 1.6 m outdoor chest does not), its back to the nearest wall;
//  - every draw comes from the house's own stream (seed x house id, record order): the shared populate() stream is untouched.
// A house's loot spots: HOUSE_SPOTS_BASE + HOUSE_SPOTS_PER_ROOM x (rooms with a usable point), at most HOUSE_SPOTS_MAX (the fraction is a draw), given room
// by room with these weights (a room gets a second spot only when every room with points has one). Today's maps lay ~0.7 floor points and ~0.17 chests per
// town building; the per-room pass keeps the census in the same band (see the lane report), so a small cabin has its one or two spots, a big villa three.
const ROOM_W = { kitchen: 3, bedroom: 3, shop: 3.5, warehouse: 2.5, storage: 2, barn: 2, living: 1.6, office: 1.6, ruin: 1.6, lobby: 1.2, meeting: 1, bath: 0.5, hall: 0.2 };
const HOUSE_SPOTS_BASE = 0.85, HOUSE_SPOTS_PER_ROOM = 0.07, HOUSE_SPOTS_MAX = 2.5;
const HOUSE_CHEST_P = 0.4;                  // a house keeps an offered chest slot with this chance (at most HOUSE_CHESTS)
const REACH_IN_ROOM = 1.25;                 // m: a point is used only this close to its OWN room's walk rects (housegen's reach also counts samples through a wall)
const NO_CHEST_ROOM = new Set(["bath", "hall"]);
const HOUSE_HOVER = 0.5;                    // m over the surface: the same hover as every authored floor point (surface + 0.5)
const TOP_SINK = 0.3;                       // a model on a furniture top is DRAWN (hover + TOP_SINK) lower than its spot (pos.y keeps surface + hover for the
                                            // pickup and the gates): the models float ~0.5 m over their spot (+ the bob), so a gun on a box hung a metre over it;
                                            // drawn lower it lies ~0.2 m over the top, bobbing
const HOUSE_HOVER_MIN = 0.15;               // under something lower than this (item body 0.7 m) the point is not used
const HOUSE_CHEST_SC = 0.625;               // 1.6 m x 1.18 m outdoor chest -> 1.0 x 0.74 m: the slot housegen keeps free is 1.0 x 0.75
const HOUSE_CHEST_HALF = [0.8 * HOUSE_CHEST_SC, 0.59 * HOUSE_CHEST_SC];   // half length (local x), half depth (local z, the lid opens to +z)
const HOUSE_RING_FLOOR = 1.4;               // m: a gun's floor ring indoors (2.0 outdoors ran under the door jambs and the furniture of a 2.5 m room)
const HOUSE_CHEST_RING = 1.8;               // m: the outdoor 3.4 m ring would run under the furniture and the walls round a slot
const houseSpots = [];                      // [{ x, y (the item's spot), z, kind 'floor' | 'top' | 'chest', house, room, gun (a non-pistol gun lies there) }]
const houseStats = { houses: 0, points: 0, used: 0, skippedKind: 0, skippedLow: 0, items: 0, chestsOffered: 0, chests: 0, chestsKind: 0, chestsCap: 0, chestsTight: 0, chestsDice: 0, skippedReach: 0, byKind: {} };
function houseStatsReset() { for (const k in houseStats) houseStats[k] = 0; houseStats.byKind = {}; }
function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const _hCols = [];
/** horizontal distance from (x, z) to the room's walk rects */
function walkDist(R, x, z) {
  let best = Infinity;
  for (const r of R.walk) { const dx = Math.max(r[0] - x, 0, x - r[2]), dz = Math.max(r[1] - z, 0, z - r[3]); const d = dx * dx + dz * dz; if (d < best) best = d; }
  return Math.sqrt(best);
}
/** (K2) (x, z) within `m` of one of a room's rects */
function inRects(rr, x, z, m) {
  for (let i = 0; i < rr.length; i++) { const r = rr[i]; if (x >= r[0] - m && x <= r[2] + m && z >= r[1] - m && z <= r[3] + m) return true; }
  return false;
}
/** is (x, z) inside the room's walkable rects (housegen rooms[].walk; else its cell rects less a wall and a body) */
function inRoom(R, x, z) {
  if (!R) return false;
  const W2 = R.walk && R.walk.length ? R.walk : null;
  if (W2) { for (const r of W2) if (x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]) return true; return false; }
  for (const r of R.rects || []) if (x >= r[0] + 0.45 && x <= r[2] - 0.45 && z >= r[1] + 0.45 && z <= r[3] - 0.45) return true;
  return false;
}
/** no solid box over a disc of radius rad round (x, z) from just above the surface up to 1.0 m (the slab it lies on is not a solid) */
function spotClear(M, x, z, surf, rad) {
  const cs = M.queryColliders(x, z, rad + 0.05, _hCols);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.kind !== "box" || c.dead) continue;
    if (x < c.minX - rad || x > c.maxX + rad || z < c.minZ - rad || z > c.maxZ + rad) continue;
    if (c.maxY > surf + 0.05 && c.minY < surf + 1.0) return false;
  }
  return true;
}
/** the highest top of the host piece's own colliders within 0.12 m of (x, z) (-Infinity: none there) */
function hostTop(M, x, z, p) {
  const cs = M.queryColliders(x, z, 0.15, _hCols);
  let t = -Infinity;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.kind !== "box" || c.dead || x < c.minX - 0.12 || x > c.maxX + 0.12 || z < c.minZ - 0.12 || z > c.maxZ + 0.12) continue;
    if (c.minX >= p.min[0] - 0.01 && c.maxX <= p.max[0] + 0.01 && c.minZ >= p.min[2] - 0.01 && c.maxZ <= p.max[2] + 0.01 && c.maxY <= p.max[1] + 0.01 && c.maxY > t) t = c.maxY;
  }
  return t;
}
/** nothing but the host piece itself over a 0.12 m disc round (x, z) from just above its top surface up to 0.9 m (a lamp, a TV, a box standing on it) */
function topClear(M, x, z, surf, p) {
  const cs = M.queryColliders(x, z, 0.17, _hCols);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.kind !== "box" || c.dead) continue;
    if (x < c.minX - 0.12 || x > c.maxX + 0.12 || z < c.minZ - 0.12 || z > c.maxZ + 0.12) continue;
    if (c.maxY <= surf + 0.05 || c.minY >= surf + 0.9) continue;
    if (c.minX >= p.min[0] - 0.01 && c.maxX <= p.max[0] + 0.01 && c.minZ >= p.min[2] - 0.01 && c.maxZ <= p.max[2] + 0.01 && c.maxY <= p.max[1] + 0.01) continue;   // (the host's own box)
    return false;
  }
  return true;
}
/** the hover an item at (x, z) on `surf` can have under whatever starts above it (a wall cabinet, a shelf board, the ceiling); -1 = no room */
function hoverAt(M, x, z, surf) {
  const cs = M.queryColliders(x, z, 0.2, _hCols);
  let ceil = Infinity;
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.kind !== "box" || c.dead) continue;
    if (x < c.minX - 0.15 || x > c.maxX + 0.15 || z < c.minZ - 0.15 || z > c.maxZ + 0.15) continue;
    if (c.minY > surf + 0.05 && c.minY < ceil) ceil = c.minY;
  }
  const h = Math.min(HOUSE_HOVER, ceil - surf - 0.72);
  return h >= HOUSE_HOVER_MIN ? h : -1;
}
const TOP_OFFS = [[0, 0], [0.3, 0], [-0.3, 0], [0, 0.22], [0, -0.22], [0.55, 0], [-0.55, 0], [0.3, 0.22], [-0.3, -0.22]];
const RING8 = []; for (let i = 0; i < 8; i++) RING8.push([Math.cos(i * Math.PI / 4) * 0.4, Math.sin(i * Math.PI / 4) * 0.4]);
const _hs = { x: 0, z: 0, hover: 0 };
/** where the k-th item of a house loot point lies (fills `_hs`); false = nowhere (the point is not used) */
function houseSpot(M, e, k) {
  const l = e.l, surf = l.y, p = e.top;
  if (p) {                                                   // on a furniture top: inside its footprint (inset 0.12 m), along its long side first
    const long = p.max[0] - p.min[0] >= p.max[2] - p.min[2];
    for (let j = 0; j < TOP_OFFS.length; j++) {
      const o = TOP_OFFS[(k + j) % TOP_OFFS.length];
      const x = l.x + (long ? o[0] : o[1]), z = l.z + (long ? o[1] : o[0]);
      if (x < p.min[0] + 0.12 || x > p.max[0] - 0.12 || z < p.min[2] + 0.12 || z > p.max[2] - 0.12) { if (k === 0 && j === 0) { /* the given point itself */ } else continue; }
      if ((k || j) && e.R && e.R.walk && e.R.walk.length && walkDist(e.R, x, z) > 1.4) continue;   // (the pile's other items stay within the walk-over of the room)
      if ((k || j) && (!topClear(M, x, z, surf, p) || Math.abs(hostTop(M, x, z, p) - hostTop(M, l.x, l.z, p)) > 0.02)) continue;   // (nor inside what else stands on
      // that top - a lamp, a TV, a register - nor over a taller part of the piece itself: a counter run's sink block, a gondola's upper shelf)
      const h = hoverAt(M, x, z, surf);
      if (h < 0) { if (k === 0 && j === 0) return false; continue; }   // nothing fits over the given point: the point is not used
      _hs.x = x; _hs.z = z; _hs.hover = h;
      return true;
    }
    return false;
  }
  for (let j = 0; j < PILE.length + RING8.length; j++) {     // on the floor: the pile offsets (0.75 x), then a 0.4 m ring, in the room and clear
    const o = j < PILE.length ? PILE[(k + j) % PILE.length] : RING8[(k + j) % RING8.length];
    const sc = j < PILE.length ? 0.75 : 1;
    const x = l.x + o[0] * sc, z = l.z + o[1] * sc;
    const given = k === 0 && j === 0;
    if (!given && (!inRoom(e.R, x, z) || !spotClear(M, x, z, surf, 0.2))) continue;
    const h = hoverAt(M, x, z, surf);
    if (h < 0) { if (given) return false; continue; }
    _hs.x = x; _hs.z = z; _hs.hover = h;
    return true;
  }
  return false;
}
function houseItem(W, data, e, k, id) {
  if (!houseSpot(W.map, e, k)) { if (k === 0 || !houseSpot(W.map, e, 0)) return null; }   // (a later item of the pile with no free spot shares the first one's)
  houseStats.items++;
  const iid = spawnItem(W, data, _hs.x, e.l.y + _hs.hover, _hs.z, id, { surf: e.l.y, ringD: e.ringD, house: e.H.id, drop: e.top ? _hs.hover + TOP_SINK : 0, rr: e.R ? e.R.rects : null });
  const it = items.get(iid);
  if (it) { it.room = e.R ? e.R.id : null; it.stand = standFor(e.R, it.pos.x, it.pos.z); }
  return iid;
}
/** where a body stands to take a house thing at (x, z): the nearest point of its room's walk rects (where housegen's 0.6 m capsule stood), at the room's
 *  floor - W.nearbyLoot hands it out as `stand` (a bot outside the wall 1.2 m from a shelf cannot take its gun: the pickup needs a clear line) */
function standFor(R, x, z) {
  if (!R || !R.walk || !R.walk.length) return null;
  let best = Infinity, bx = x, bz = z;
  for (const r of R.walk) {
    const px = Math.min(r[2], Math.max(r[0], x)), pz = Math.min(r[3], Math.max(r[1], z)), d = (px - x) * (px - x) + (pz - z) * (pz - z);
    if (d < best) { best = d; bx = px; bz = pz; }
  }
  return { x: bx, y: R.y, z: bz };
}
/** the heading (front = local +z away from the nearest wall behind it) and the spot of a house chest in its slot */
function chestPlace(M, c) {
  const surf = c.y, cs = M.queryColliders(c.x, c.z, 1.3, _hCols);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let best = -1, bestD = Infinity;
  for (let d = 0; d < 4; d++) {                              // the nearest solid face (body height) in each axis direction, within 1.2 m
    for (let t = 0; t <= 1.2; t += 0.05) {
      const x = c.x + DIRS[d][0] * t, z = c.z + DIRS[d][1] * t;
      let hit = false;
      for (let i = 0; i < cs.length && !hit; i++) { const q = cs[i]; if (q.kind === "box" && !q.dead && q.maxY > surf + 0.3 && q.minY < surf + 1.0 && x > q.minX && x < q.maxX && z > q.minZ && z < q.maxZ) hit = true; }
      if (hit) { if (t < bestD) { bestD = t; best = d; } break; }
    }
  }
  const back = best >= 0 ? DIRS[best] : [0, -1];
  const fx = -back[0], fz = -back[1];
  const ry = Math.atan2(fx, fz);
  // stand the chest's back 3 cm off that face (the slot is 0.75 m deep; its centre is 0.375 m from the wall)
  let x = c.x, z = c.z;
  if (best >= 0) { const push = HOUSE_CHEST_HALF[1] + 0.03 - bestD; x += fx * push; z += fz * push; }
  return { x, z, ry, half: back[0] ? [HOUSE_CHEST_HALF[1], HOUSE_CHEST_HALF[0]] : [HOUSE_CHEST_HALF[0], HOUSE_CHEST_HALF[1]] };
}
/** a box-shaped chest body (half extents hx, hz from surf + 0.05 to surf + top) clear of every solid but the floor it stands on */
function chestClear(M, x, z, surf, hx, hz, top) {
  const cs = M.queryColliders(x, z, Math.max(hx, hz) + 0.05, _hCols);
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (c.kind !== "box" || c.dead) continue;
    if (x + hx <= c.minX || x - hx >= c.maxX || z + hz <= c.minZ || z - hz >= c.maxZ) continue;
    if (c.maxY > surf + 0.05 && c.minY < surf + top) return false;
  }
  return true;
}
/** a chest's burst spot in its room: 1.1 m out at `ang`, else nearer, else on the chest's front edge */
function chestBurstSpot(W, c, ang) {
  const M = W.map, R = c.R;
  for (const r of [1.1, 0.8, 1.4, 0.6]) {
    const x = c.pos.x + Math.cos(ang) * r, z = c.pos.z + Math.sin(ang) * r;
    if (inRoom(R, x, z) && spotClear(M, x, z, c.pos.y, 0.2) && hoverAt(M, x, z, c.pos.y) >= 0) return { x, z };
  }
  for (let j = 0; j < 8; j++) {                              // any heading at 1.0 m
    const a2 = ang + j * Math.PI / 4, x = c.pos.x + Math.cos(a2), z = c.pos.z + Math.sin(a2);
    if (inRoom(R, x, z) && spotClear(M, x, z, c.pos.y, 0.2)) return { x, z };
  }
  return { x: c.pos.x + c.rs * 0.7, z: c.pos.z + c.rc * 0.7 };   // in front of it
}
/** spawn one house's loot (records order, its own stream). Returns the light-ammo boxes it laid (populate's guarantee counts them). */
function houseLoot(W, H, modeK, floorOut) {
  if (!H || !Array.isArray(H.loot)) return 0;
  houseStats.houses++;
  const rng = K.mulberry32((((W.seed >>> 0) ^ 0x4005e1) ^ strHash(String(H.id))) >>> 0);
  const rooms = new Map();
  for (const r of H.rooms || []) rooms.set(r.id, r);
  const byRoom = new Map();
  for (const l of H.loot) { let a = byRoom.get(l.room); if (!a) byRoom.set(l.room, (a = [])); a.push(l); houseStats.points++; }
  const furn = H.furniture || [];
  let light = 0;
  // the usable points per room (within the walk-over of the room's own walk rects), then the house's spot BUDGET: HOUSE_SPOTS(rooms that have one)
  // spots, given room by room by a weighted draw on the room kind (a room is drawn again only when every other is used)
  const cand = [];
  for (const [rid, pts] of byRoom) {
    const R = rooms.get(rid) || null, kind = R ? R.kind : "hall";
    const ok = [];
    for (const l of pts) { if (R && R.walk && R.walk.length && walkDist(R, l.x, l.z) > REACH_IN_ROOM) { houseStats.skippedReach++; continue; } ok.push(l); }
    const bk = houseStats.byKind[kind] || (houseStats.byKind[kind] = { rooms: 0, points: 0, spots: 0, rolls: 0, items: 0 });
    bk.rooms++; bk.points += ok.length;
    if (ok.length) cand.push({ rid, R, kind, pts: ok, used: 0, w: ROOM_W[kind] != null ? ROOM_W[kind] : 1, bk });
  }
  const E = Math.min(HOUSE_SPOTS_MAX, HOUSE_SPOTS_BASE + HOUSE_SPOTS_PER_ROOM * cand.length);
  let budget = Math.floor(E) + (rng() < E - Math.floor(E) ? 1 : 0);
  while (budget > 0) {
    let tot = 0;
    const minUsed = cand.reduce((m, c) => (c.used < c.pts.length ? Math.min(m, c.used) : m), Infinity);
    if (minUsed === Infinity) break;
    for (const c of cand) if (c.used === minUsed && c.used < c.pts.length) tot += c.w;
    let u = rng() * tot, C = null;
    for (const c of cand) { if (c.used !== minUsed || c.used >= c.pts.length) continue; C = c; u -= c.w; if (u < 0) break; }
    const l = C.pts[C.used++];
    budget--;
    let top = null;
    if (l.on && l.on !== "floor") {
      for (const p of furn) if (p.room === C.rid && p.floor === l.floor && !p.deco && (p.cat === l.on || p.type === l.on) && l.x >= p.min[0] - 0.01 && l.x <= p.max[0] + 0.01 && l.z >= p.min[2] - 0.01 && l.z <= p.max[2] + 0.01) { top = p; break; }
    }
    const e = { H, R: C.R, l, top, k: 0, x: l.x, y: l.y, z: l.z, ringD: top ? Math.max(0.45, Math.min(RING_D_WEAPON, top.max[0] - top.min[0], top.max[2] - top.min[2])) : HOUSE_RING_FLOOR };
    const rolls = K.floorRollCount ? K.floorRollCount(rng, modeK.lootMult || 1) : (rng() < 0.55 * Math.min(1.6, modeK.lootMult || 1) ? 1 : 0);
    C.bk.spots++; C.bk.rolls += rolls;
    if (!houseSpot(W.map, e, 0)) { houseStats.skippedLow++; for (let r = 0; r < rolls; r++) K.rollFloorSpawn ? K.rollFloorSpawn(rng) : K.rollFloorItem(rng); continue; }   // (same draws either way)
    houseStats.used++;
    for (let r = 0; r < rolls; r++) {
      const spawn = K.rollFloorSpawn ? K.rollFloorSpawn(rng) : [K.rollFloorItem(rng)];
      for (const data of spawn) {
        const hid = e.k ? "h" + e.k + ":" + l.id : "h:" + l.id;
        uplift(W, data, l.x, l.z, hid);
        if (houseItem(W, data, e, e.k, hid)) { C.bk.items++; if (data.kind === "ammo" && data.id === "light") light++; if (data.kind === "weapon" && data.id !== "pistol") e.gun = true; }
        e.k++;
      }
    }
    if (!top) floorOut.push(e);
    houseSpots.push({ x: l.x, y: l.y + HOUSE_HOVER, z: l.z, kind: top ? "top" : "floor", house: H.id, room: C.rid, gun: !!e.gun, poi: H.town != null ? H.town : null, stand: standFor(C.R, l.x, l.z) });   // (K2) stand: where a bot takes it (its room's walk area); poi: its town
  }
  // chests: the slots in record order, never in a bath or a corridor, at most HOUSE_CHESTS per house
  const cap = (H.storeys || 1) >= 3 ? 2 : 1;
  let n = 0;
  for (const c of H.chests || []) {
    houseStats.chestsOffered++;
    const R = rooms.get(c.room) || null;
    if (!R || NO_CHEST_ROOM.has(R.kind)) { houseStats.chestsKind++; continue; }
    if (n >= cap) { houseStats.chestsCap++; continue; }
    if (rng() >= HOUSE_CHEST_P) { houseStats.chestsDice++; continue; }
    const pl = chestPlace(W.map, c);
    if (!chestClear(W.map, pl.x, pl.z, c.y, pl.half[0] - 0.02, pl.half[1] - 0.02, 0.62)) { houseStats.chestsTight++; pl.x = c.x; pl.z = c.z; }   // (pushed into something: back to the slot's middle)
    const cid = spawnChest(W, pl.x, c.y, pl.z, { surf: c.y, ry: pl.ry, sc: HOUSE_CHEST_SC, R: { walk: R.walk, rects: R.rects }, house: H.id, room: c.room, half: pl.half });
    const cr = chests.get(cid); if (cr) cr.stand = standFor(R, pl.x + Math.sin(pl.ry) * 0.9, pl.z + Math.cos(pl.ry) * 0.9);   // (in front of it)
    houseStats.chests++;
    houseSpots.push({ x: pl.x, y: c.y + 0.6, z: pl.z, kind: "chest", house: H.id, room: c.room, gun: true, poi: H.town != null ? H.town : null, stand: cr ? cr.stand : null });
    n++;
  }
  return light;
}
/** Test hook: what the per-room pass did this match (houses, points used / skipped, chests, per room kind). */
export function debugHouseLoot() { return JSON.parse(JSON.stringify(houseStats)); }

// ── LOOT TIERS + HOT ZONE (parity P2-H, LC-29) ───────────────────────────────────────────────────────────────────────────────────────
// Apex splits its map into basic / mid / high tier loot zones and marks ONE random hot zone per match (apexlegends.wiki.gg/wiki/Loot); ours had one
// floor table for every point, so a POI's rare+ share was noise around it (audit: isla 15-50 %, ashgrid 0-50 %). Here every named POI is ranked by its
// loot DENSITY (floor + chest points inside its circle - the towns and the big signature POIs rank high, a lone lighthouse low): the top third is HIGH,
// the next third MID, the rest BASIC (and loot outside every POI is basic). One POI with at least the median loot is the HOT ZONE (seeded per match).
// A gun spawned inside a tiered POI is UPLIFTED: +1 rarity with chance p1, and a further +1 with chance p2 (capped at legendary). The uplift composes
// with whatever base table sim/royale.js rolls (P2-D owns the tables: a chest table without commons stays without them), and it draws from the item's
// OWN stream (seed x item id): the shared populate / house / chest streams see exactly the draws they saw before, so every item keeps its kind, count and
// spot - only some guns' rarity (and with it their beam and ring) changes. Changes the seeded loot output: MAP_GEN_VERSION (integrator).
const TIER_UPLIFT = { basic: [0, 0], mid: [0.35, 0], high: [0.7, 0.12], hot: [1.0, 0.3] };
const tierState = { pois: [], hot: null };
function computeTiers(W) {
  tierState.pois = []; tierState.hot = null;
  const M = W.map;
  const P = M && Array.isArray(M.pois) ? M.pois : [];
  const pts = (M && M.lootPoints) || [];
  const recs = [];
  for (let i = 0; i < P.length; i++) {
    const p = P[i];
    if (!p || !(p.r > 0)) continue;
    let n = 0;
    for (let j = 0; j < pts.length; j++) { const q = pts[j], dx = q.x - p.x, dz = q.z - p.z; if (dx * dx + dz * dz < p.r * p.r) n += q.kind === "chest" ? 2 : 1; }
    recs.push({ id: p.id, name: p.name || p.id, x: p.x, z: p.z, r: p.r, points: n, tier: "basic", i });
  }
  const ranked = recs.filter((r) => r.points > 0).sort((a, b) => b.points - a.points || a.i - b.i);
  const third = Math.ceil(ranked.length / 3);
  for (let k = 0; k < ranked.length; k++) ranked[k].tier = k < third ? "high" : k < 2 * third ? "mid" : "basic";
  if (ranked.length) {
    const med = ranked[Math.floor((ranked.length - 1) / 2)].points;
    const cand = ranked.filter((r) => r.points >= med).sort((a, b) => a.i - b.i);
    const rng = K.mulberry32((((W.seed >>> 0) ^ 0x407e2a) >>> 0));
    const h = cand[Math.floor(rng() * cand.length) % cand.length];
    h.hot = true;
    tierState.hot = { id: h.id, name: h.name, x: h.x, z: h.z, r: h.r, tier: h.tier };
  }
  tierState.pois = recs;
  W.lootTiers = tierState;
  W.lootHotZone = tierState.hot;
}
/** the tier of the loot at (x, z): the POI whose circle holds it (the nearest centre, relative to its radius, when circles overlap) */
function tierAt(x, z) {
  let best = null, bk = Infinity;
  for (let i = 0; i < tierState.pois.length; i++) {
    const p = tierState.pois[i], dx = x - p.x, dz = z - p.z, k = (dx * dx + dz * dz) / (p.r * p.r);
    if (k < 1 && k < bk) { bk = k; best = p; }
  }
  return best ? (best.hot ? "hot" : best.tier) : "basic";
}
/** the rarity uplift of a gun lying at (x, z) (mutates data.rarity; ammo / consumables untouched). Returns the tier. */
function uplift(W, data, x, z, id) {
  if (!data || data.kind !== "weapon") return null;
  const tier = tierAt(x, z), u = TIER_UPLIFT[tier];
  if (!u || !u[0]) return tier;
  const r = K.mulberry32((((W.seed >>> 0) ^ 0x71e5a3) ^ strHash(id)) >>> 0);
  let rar = data.rarity || 0;
  if (r() < u[0]) rar++;
  if (r() < u[1]) rar++;
  data.rarity = Math.min(4, rar);
  return tier;
}

// ── supply drops (parity P2-H, LC-28) ────────────────────────────────────────────────────────────────────────────────────────────────
// Was: at most 2 a match (measured: one in 604 s), burst into loot the instant it touched the terrain (often inside a ruin or on a roof: maps'
// heightAt only), and nothing marked it once it was down. Now (Apex: 4 a match, a beam until opened - apexlegends.wiki.gg/wiki/Care_Package; PUBG:
// red smoke - pubg.wiki.gg/wiki/Care_Package):
//  - SUPPLY_MAX[pace] crates, one at the start of each storm phase from SUPPLY_FIRST_PHASE (standard phases 2-5: ~269 / 437 / 566 / 673 s; quick
//    phases 2-4), each into the NEXT circle; several may be in the air at once;
//  - the landing spot is searched (seeded, so every client agrees): dry ground, nothing solid over a 1.4 m disc from the ground to 6 m up (no roof,
//    no wall, no tree trunk), and a gentle slope - else the least bad candidate;
//  - it descends at SUPPLY_FALL m/s from SUPPLY_H over the ground (~30 s to be seen and contested), and on landing becomes a "chest" record (id
//    sd<N>): HOLD E opens it through the chest channel; bots open it through their chest path; the net 'chest' message and the join-sync 'opened'
//    list carry it like any chest (an open that arrives before the crate landed here waits in pendingOpen);
//  - until it is opened it stands under a tall red beacon (the shared beam pool: a far beacon keeps its white core at every range, SUPPLY_BEAM.h m
//    so it clears every roof and crater rim round it) with a red glow and ring; opened, the markers go and the crate stays, dimmed.
// Contents: K.rollSupplyDrop from the same per-drop stream as before ((seed ^ 0xdead) + n); item ids sd:<n>:<i> as before.
const SUPPLY_MAX = { standard: 4, quick: 3 };
const SUPPLY_FIRST_PHASE = 2;
const SUPPLY_H = 180, SUPPLY_FALL = 6.0;
const SUPPLY_HEX = "#ff4a38";
const SUPPLY_BEAM = { h: 110, r: 0.2, gain: 0.95, far: 1800 };
const SUPPLY_CLEAR_R = 1.4, SUPPLY_CLEAR_H = 6.0;
function newSupplyState(W) {
  const pace = paceOf(W);
  return { dropped: 0, landed: 0, max: SUPPLY_MAX[pace] || 0, falling: [], list: [], pendingOpen: new Set() };
}
const _spCols = [];
/** how bad a crate landing spot is (0 = good; Infinity = never): water, a solid over the crate's disc up to 6 m, the slope under it */
function supplySpotCost(M, x, z) {
  const g = M.heightAt(x, z);
  if (M.waterY != null && g < M.waterY + 0.5) return Infinity;
  if (M.half && (Math.abs(x) > M.half - 8 || Math.abs(z) > M.half - 8)) return Infinity;
  let cost = 0;
  if (M.queryColliders) {
    const cs = M.queryColliders(x, z, SUPPLY_CLEAR_R + 0.1, _spCols);
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (c.dead) continue;
      if (c.maxX < x - SUPPLY_CLEAR_R || c.minX > x + SUPPLY_CLEAR_R || c.maxZ < z - SUPPLY_CLEAR_R || c.minZ > z + SUPPLY_CLEAR_R) continue;
      if (c.maxY > g + 0.25 && c.minY < g + SUPPLY_CLEAR_H) cost += 100;
    }
  }
  const e = 1.5;
  const sl = Math.max(Math.abs(M.heightAt(x + e, z) - M.heightAt(x - e, z)), Math.abs(M.heightAt(x, z + e) - M.heightAt(x, z - e))) / (2 * e);
  if (sl > 0.45) cost += 50;
  return cost + sl;
}
function supplySpawn(W, st) {
  const n = supplyState.dropped;
  const rng = K.mulberry32((W.seed ^ 0xd209) + n * 77);
  const cx0 = st.nextCenter ? st.nextCenter.x : st.center.x, cz0 = st.nextCenter ? st.nextCenter.z : st.center.z;
  const R = (st.nextRadius || st.radius) * 0.6;
  let bx = cx0, bz = cz0, bc = Infinity;
  for (let k = 0; k < 28 && bc > 0.3; k++) {
    const ang = rng() * Math.PI * 2, rr = R * Math.sqrt(rng());
    const x = cx0 + Math.cos(ang) * rr, z = cz0 + Math.sin(ang) * rr;
    const c = W.map ? supplySpotCost(W.map, x, z) : 0;
    if (c < bc) { bc = c; bx = x; bz = z; }
  }
  const gy = W.map.heightAt(bx, bz);
  const { crate, box, balloon } = makeSupplyCrate();
  crate.position.set(bx, gy + SUPPLY_H, bz);
  crate.rotation.y = rng() * Math.PI * 2;
  W.group("loot").add(crate);
  const rec = { id: "sd" + n, n, x: bx, z: bz, y: gy, landed: false, opened: false, tSpawn: W.t, tLand: null, tOpen: null };
  supplyState.list.push(rec);
  supplyState.falling.push({ crate, box, balloon, x: bx, z: bz, gy, n, rec });
  supplyState.dropped++;
  W.events.emit("supplyDropSpawned", { x: bx, z: bz, id: rec.id, n });
}
function supplyLand(W, f) {
  f.crate.position.y = f.gy;
  f.crate.remove(f.balloon);
  // detached = unreachable by the match teardown: free it now
  f.balloon.geometry.dispose(); f.balloon.material.dispose();
  const id = "sd" + f.n, x = f.x, z = f.z, gy = f.gy;
  const ry = f.crate.rotation.y;
  fxInit();
  const ring = ringAlloc(W, x, gy + 0.15, z, SUPPLY_HEX, false, RING_D_CHEST, id, null);
  let beam = -1, glow = -1, ceil = Infinity;
  if (ring >= 0) {
    ceil = ceilingAbove(W, x, z, _surf.floor, SUPPLY_BEAM.r + 0.12);
    beam = beamAlloc(x, _surf.floor, z, SUPPLY_HEX, SUPPLY_BEAM.h, SUPPLY_BEAM.r, SUPPLY_BEAM.gain, SUPPLY_BEAM.far, ceil);
    glow = glowAlloc(x, _surf.floor + 2.0, z, 3.6, SUPPLY_HEX, GLOW_GAIN);
  }
  const c = { id, supply: true, n: f.n, pos: { x, y: gy, z }, opened: false, glow, beam, ring, ringOn: true, ceil, rc: Math.cos(ry), rs: Math.sin(ry), vis: true, cast: false,
    vp: null, vi: -1, sc: 1, R: null, house: null, crate: f.crate, box: f.box, rec: f.rec };
  chests.set(id, c);
  gridAdd("chest", id, { x, z });
  f.rec.landed = true; f.rec.tLand = W.t; f.rec.y = gy;
  supplyState.landed++;
  W.events.emit("supplyDropLanded", { x, z, id, n: f.n });
  if (supplyState.pendingOpen.has(id)) { supplyState.pendingOpen.delete(id); openChest(W, null, id); }
}
function maybeSupplyDrop(W, dt) {
  if (!supplyState || !supplyState.max || !W.stormCtl || !W.stormCtl.storm) return;   // practice / no storm; null between disposeMatch and populate
  const st = W.stormCtl.storm.stateAt(W.t);
  while (supplyState.dropped < supplyState.max && st.phase >= SUPPLY_FIRST_PHASE + supplyState.dropped) supplySpawn(W, st);
  const F = supplyState.falling;
  for (let i = F.length - 1; i >= 0; i--) {
    const f = F[i];
    f.crate.position.y -= SUPPLY_FALL * dt;
    if (f.crate.position.y <= f.gy) { F.splice(i, 1); supplyLand(W, f); }
  }
}

// ── queries / interaction ────────────────────────────────────────────────────
// Vertical reach. nearby() is also the bots' PLANNING query (90 m, |dy| < 4: loot on their own level or a flight of stairs away), so its default
// stays 4. A pickup is a different question: a 4 m storey puts the floor loot of the room below 3.8 m under a player's feet and the floor above
// 4.2 m over them, so |dy| < 4 let a player standing on an upper floor (or a roof a ramp reaches) take the ground floor's loot THROUGH the slab -
// 16-17 % of the items on every seed (probe_loot: items within 1.5 m of a ramp-reached slab 2.2-4 m above them, live 60b854d0 and the Wave-7 tree).
// The player's walkover / E / chest reach and the bots' walkover (WALK_DY) use this one number.
const NEAR_DY = 4, REACH_DY = 2.2;
// A house item or chest is taken from INSIDE its room: a pickup-range query (r <= PICK_LOS_R) asked WITH los - the player's walk-over and E always; a bot when
// bots.js passes the 4th argument, which it should once it walks to the `stand` point nearbyLoot hands out (without that a bot parked outside the wall loops on
// a gun it cannot take: probe_match ashgrid 12/13 worst bot 9 / 8 stuck episodes with it, 1 / 4 without) - needs a clear
// line from the taker's chest (feet + 1.5) to the thing (its spot + lift) - an exterior or interior wall is 0.24 m, and the 1.5 m walk-over used to
// reach through it from the street or the next room. One cached answer per thing (the taker's 0.25 m cell): a bot standing at a shelf asks every tick.
const PICK_LOS_R = 3;
let losMap = null;
function pickLos(pos, o, lift) {
  if (!losMap || !losMap.losBlocked) return true;
  const k = Math.round(pos.x * 4) * 73856093 ^ Math.round(pos.z * 4) * 19349663 ^ Math.round(pos.y * 4) * 83492791;
  if (o._losK === k) return o._losV;
  const v = !losMap.losBlocked(pos.x, pos.y + 1.5, pos.z, o.pos.x, o.pos.y + lift, o.pos.z);
  o._losK = k; o._losV = v;
  return v;
}
function nearby(pos, r, maxDy, los) {
  const out = [];
  const r2 = r * r;
  const dyMax = maxDy == null ? NEAR_DY : maxDy;
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
          if (d2 < r2 && Math.abs(it.pos.y - pos.y) < dyMax && (!los || !it.house || r > PICK_LOS_R || pickLos(pos, it, 0.1))) {
            out.push({ type: "item", id: it.id, data: it.data, pos: it.pos, d: Math.sqrt(d2), stand: it.stand || null, pile: it.pile });
          }
        } else {
          const c = chests.get(e.id);
          if (!c || c.opened) continue;
          const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < r2 && Math.abs(c.pos.y - pos.y) < dyMax && (!los || !c.house || r > PICK_LOS_R || pickLos(pos, c, 0.45))) {
            out.push({ type: "chest", id: c.id, pos: c.pos, d: Math.sqrt(d2), stand: c.stand || null, supply: !!c.supply });
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
  if (a && a.downed) return false;                   // C-DBNO: a downed actor cannot loot
  c.opened = true;
  if (FX.pools) { poolRelease(FX.pools.glows, c.glow); poolRelease(FX.pools.beams, c.beam); poolRelease(FX.pools.rings, c.ring); }
  c.glow = c.beam = c.ring = -1;
  if (c.vp) c.vp.dirty = true;                       // the opened chest is drawn dimmed (instance colour 0.45: what the cloned material's colour x 0.45 was)
  let drops;
  if (c.supply) {
    drops = K.rollSupplyDrop(K.mulberry32((W.seed ^ 0xdead) + c.n));   // the stream the instant burst used (same contents per seed)
    if (c.crate) c.crate.traverse((m) => {                                // the crate stays, dimmed, its lamp dark (same program)
      if (!m.isMesh || !m.material || !m.material.color) return;
      m.material.color.multiplyScalar(0.45);
      if (m.material.emissive) m.material.emissive.setRGB(0, 0, 0);
    });
    if (c.rec) { c.rec.opened = true; c.rec.tOpen = W.t; }
  } else {
    drops = K.rollChest(K.mulberry32((W.seed ^ 0xc4e57) + parseInt(id.slice(1), 10)));
    for (let i = 0; i < drops.length; i++) uplift(W, drops[i], c.pos.x, c.pos.z, "cb:" + id + ":" + i);   // LC-29 (the chest's POI tier; own stream per item)
  }
  // LC-77: the burst lands IN FRONT of the chest (local +z, the side the lid opens to), the gun and the ammo that feeds it on ONE spot and the rest
  // beside it - one walk-over takes the gun with its ammo. It used to fan out round the chest at 1.1 m, so the walk-over that took the gun left its
  // ammo on the far side ("MEDI" on the lid, live shots). A supply crate bursts the same way from its (seeded) heading.
  const fx = c.rs, fz = c.rc, lx = fz, lz = -fx;     // front and lateral (world)
  const gun = drops.find((d) => d.kind === "weapon");
  const feed = gun && K.WEAPONS[gun.id] ? K.WEAPONS[gun.id].ammo : null;
  const SLOTS = [-1, 2, -2, 3, -3];
  let feedDone = false, si = 0;
  for (let i = 0; i < drops.length; i++) {
    const d = drops[i];
    // slot: 0 = the gun's spot, 1 = beside it (the gun's own ammo), then -1, 2, -2 ... (the rest, alternating sides)
    let s;
    if (d === gun) s = 0;
    else if (!feedDone && d.kind === "ammo" && d.id === feed) { s = 1; feedDone = true; }
    else s = SLOTS[Math.min(si++, SLOTS.length - 1)];
    const lat = s * 0.42;
    const iid = c.supply ? "sd:" + c.n + ":" + i : "cb:" + id + ":" + i;   // (a supply crate keeps the ids its instant burst used)
    if (c.R) {
      const ang = Math.atan2(fz, fx) + s * 0.38;
      const sp = chestBurstSpot(W, c, ang);
      spawnItem(W, d, sp.x, c.pos.y + HOUSE_HOVER, sp.z, iid, { surf: c.pos.y, house: c.house, rr: c.R.rects || null });   // a house chest: the room's floor, never through its wall
    } else {
      const fd = c.supply ? 1.9 : 1.35;
      spawnItem(W, d, c.pos.x + fx * fd + lx * lat, c.pos.y + 0.2, c.pos.z + fz * fd + lz * lat, iid);
    }
  }
  W.events.emit("chestOpened", a, c);
  if (c.supply) W.events.emit("supplyDropOpened", a, { id: c.id, x: c.pos.x, z: c.pos.z, n: c.n });
  return true;
}

/** Detach a taken item and park its pooled markers (contact blob, floor ring, beam,
 *  death-drop glow). It owns no GPU object of its own any more - everything per-item
 *  is a slot in a shared instanced pool - so nothing here needs disposing. */
function releaseItem(it, W) {
  visRemove(it);
  blobRelease(it);
  itemFxRelease(it);
  if (it.pile && W) pileTaken(W, it);   // the pile's one marker follows its best remaining member
}

let remN = 0;
function pickup(W, a, id, opts) {
  const it = items.get(id);
  if (!it || it.taken) return false;
  if (a && a.downed) return false;                   // C-DBNO: a downed actor cannot loot
  // An ammo item bigger than the room left in the reserve is taken IN PART: the rest stays on the floor as a new item (deterministic id, mirrored
  // online like a swap drop). With a death pile now holding ALL the victim's ammo (up to 240 medium), taking it all would burn the remainder.
  let rem = 0;
  const d0 = it.data;
  if (d0.kind === "ammo" && a && a.inventory && K.AMMO[d0.id]) {
    const cnt = d0.count || K.AMMO[d0.id].box, room = K.AMMO[d0.id].max - (a.inventory.ammo[d0.id] || 0);
    if (room > 0 && cnt > room) rem = cnt - room;
  }
  const data = rem ? { kind: "ammo", id: d0.id, count: (d0.count || K.AMMO[d0.id].box) - rem } : d0;
  if (opts && opts.swap) data.swap = true;
  const ok = give(W, a, data);
  delete data.swap;
  if (!ok) return false;
  it.taken = true;
  const pileId = it.pile;
  if (rem) it.pile = null;                           // (the remainder takes its place in the pile: one re-mark below, not two)
  releaseItem(it, W);
  items.delete(id);
  takenIds.push(id);
  W.events.emit("pickedUp", a, data, id);
  if (rem) {
    const rid = "r" + (remN++) + ":" + id, rd = { kind: "ammo", id: d0.id, count: rem }, p = it.pos;
    const nid = spawnItem(W, rd, p.x, p.y, p.z, rid, it.surf != null ? { surf: it.surf, house: it.house, rr: it.rr, drop: it.drop, pile: pileId } : { pile: pileId });
    const P = pileId ? piles.get(pileId) : null;
    if (P) { P.members.delete(id); if (items.has(nid)) P.members.add(nid); pileMarkers(W, P); }
    if (W.net && a && !a.netRemote) W.events.emit("netDropItem", { data: rd, x: p.x, y: p.y, z: p.z, id: rid, pile: pileId || undefined, surf: it.surf != null ? it.surf : undefined });
  }
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

/** DEATH PILE (parity P2-H, LC-27). Fully deterministic (seeded by victim id): every client that runs the kill spawns identical death loot with
 *  identical ids; no mirroring needed.
 *  Was: every item thrown to a random spot 0.5-1.6 m out, each with its own ring, beam and gold glow (8 items over 2.44 m, 5 overlapping pills:
 *  unreadable), and the ammo cut to 2 boxes a type (a bot holding 240 medium dropped 40). Now (Apex's death box: everything, one marker in the
 *  colour of the best item - apexlegends.wiki.gg/wiki/Death_Box):
 *  - EVERYTHING is dropped: every gun, every stack, ALL the ammo of each type (one item a type, any count > 0);
 *  - laid out as one tidy pile, sorted by value: the best gun in the middle, the rest on a 0.55 m ring round it (a second ring at 1.0 m only
 *    past 7 items), turned by one seeded draw; every member is inside the 1.5 m walk-over of the middle;
 *  - the members carry NO marker of their own; the pile has ONE ring, ONE beam and ONE glow in the RARITY_COLOR of its best gun (common grey when
 *    it holds no gun), re-coloured when the best is taken and parked when the last member goes;
 *  - W.lootLabels folds the pile into one label entry (best first). */
const PILE_RING1 = 0.55, PILE_RING2 = 1.0, PILE_N1 = 6;
const CON_VALUE = { big_shield: 40, medkit: 38, frag: 30, mini_shield: 26, bandage: 20 };
function lootValue(d) {
  if (d.kind === "weapon") return 1000 + (d.rarity || 0) * 100 + Math.min(99, K.gunScore ? K.gunScore(d.id, d.rarity || 0) / 4 : 0);
  if (d.kind === "consumable") return 100 + (CON_VALUE[d.id] || 10);
  return 10 + Math.min(9, (d.count || 0) / 40);
}
function deathDrop(W, victim) {
  const inv = victim.inventory;
  if (!inv) return;
  const rng = K.mulberry32(W.seed ^ hashId(victim.id));
  const list = [];
  // EVERY carried weapon (including the equipped one) + consumables + ALL ammo
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (!s) continue;
    if (s.kind === "weapon") list.push({ kind: "weapon", id: s.id, rarity: s.rarity, mag: s.mag });
    if (s.kind === "consumable" && s.count > 0) list.push({ kind: "consumable", id: s.id, count: s.count });
    inv.slots[i] = null;
  }
  for (const am in inv.ammo) if (inv.ammo[am] > 0 && K.AMMO[am]) list.push({ kind: "ammo", id: am, count: inv.ammo[am] });
  if (!list.length) return;
  // stable sort by value (ties keep the slot order: the same on every client)
  const ord = list.map((d, i) => ({ d, i, v: lootValue(d) })).sort((a, b) => b.v - a.v || a.i - b.i);
  const pid = "pile:" + victim.id;
  const rot = rng() * Math.PI * 2;
  const P = { id: pid, pos: { x: victim.pos.x, y: victim.pos.y, z: victim.pos.z }, members: new Set(), best: -1, hex: null, ring: -1, beam: -1, glow: -1, ringOn: true, vis: true };
  piles.set(pid, P);
  const n1 = Math.min(PILE_N1, ord.length - 1), n2 = ord.length - 1 - n1;
  let centre = null;
  for (let k = 0; k < ord.length; k++) {
    let x = victim.pos.x, z = victim.pos.z;
    if (k > 0) {
      const inner = k <= n1, j = inner ? k - 1 : k - 1 - n1, n = inner ? n1 : n2;
      const a = rot + (j / Math.max(1, n)) * Math.PI * 2 + (inner ? 0 : Math.PI / Math.max(1, n));
      const r = inner ? PILE_RING1 : PILE_RING2;
      x += Math.cos(a) * r; z += Math.sin(a) * r;
    }
    const iid = spawnItem(W, ord[k].d, x, victim.pos.y + 0.2, z, "dd:" + victim.id + ":" + k, { pile: pid });
    const it = items.get(iid);
    if (it) { P.members.add(iid); if (!centre) centre = it.pos; }
  }
  if (centre) { P.pos.x = centre.x; P.pos.y = centre.y; P.pos.z = centre.z; }
  pileMarkers(W, P);
}
/** (re)build a pile's one marker for its current best member; parks it when the pile is empty */
function pileMarkers(W, P) {
  const FP = FX.pools;
  if (FP) { poolRelease(FP.rings, P.ring); poolRelease(FP.beams, P.beam); poolRelease(FP.glows, P.glow); }
  P.ring = P.beam = P.glow = -1;
  let best = null, bv = -Infinity;
  for (const id of P.members) { const it = items.get(id); if (!it || it.taken) continue; const v = lootValue(it.data); if (v > bv) { bv = v; best = it; } }
  if (!best) { piles.delete(P.id); return; }
  P.best = best.data.kind === "weapon" ? (best.data.rarity || 0) : -1;
  const rar = Math.max(0, P.best);
  const hex = K.RARITY_COLOR[K.RARITY[rar]] || K.RARITY_COLOR.common;
  P.hex = hex;
  fxInit();
  const x = P.pos.x, y = P.pos.y, z = P.pos.z;
  P.ring = ringAlloc(W, x, y, z, hex, false, 2.9, P.id, null);
  if (P.ring >= 0) {
    const floor = _surf.floor;
    const ceil = ceilingAbove(W, x, z, floor, BEAM_R[rar] + 0.12);
    // a pile reads a step above a floor gun of the same rarity: the next height up, never below the uncommon beam
    const hk = Math.min(4, Math.max(1, rar + 1));
    P.beam = beamAlloc(x, floor, z, hex, BEAM_H[hk], BEAM_R[rar], BEAM_GAIN[rar], BEAM_FAR[hk], ceil);
    P.glow = glowAlloc(x, floor + 0.75, z, 1.5, hex, GLOW_GAIN);
    if (!P.vis && FP) poolShow(FP.rings, P.ring, false);
  }
}
/** a pile member left the floor: re-mark the pile (its best may have gone) */
function pileTaken(W, it) {
  const P = it.pile ? piles.get(it.pile) : null;
  if (!P) return;
  P.members.delete(it.id);
  pileMarkers(W, P);
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
    if (it.vis !== vis) { it.vis = vis; blobShow(it, vis); itemFxShow(it, vis); }   // (the model, bob and spin: visFrame below)
  }
  maybeSupplyDrop(W, dt);

  // chests: cull the model + ring by distance and hand the shadow back up close
  const CP = CHEST_P;
  for (const c of chests.values()) {
    const cdx = c.pos.x - cp.x, cdy = c.pos.y - cp.y, cdz = c.pos.z - cp.z;
    const d2 = cdx * cdx + cdy * cdy + cdz * cdz;
    if (c.supply) {                                  // a landed supply crate: its own mesh (always drawn), only its ring follows the cull
      if (c.ring >= 0) { const ringOn = d2 < cull2; if (c.ringOn !== ringOn) { c.ringOn = ringOn; if (FX.pools) poolShow(FX.pools.rings, c.ring, ringOn); } }
      continue;
    }
    // Cull the chest MODEL and its ring only. The glow billboard and the light
    // beam stay lit at any range (the shader fades them) — they are the beacon you
    // steer the glider toward, and hiding them would make chests unfindable on
    // descent. Their pulse is in the shader: nothing to animate here any more.
    const vis = d2 < cull2;
    if (c.vis !== vis) { c.vis = vis; if (c.vp) c.vp.dirty = true; }
    if (c.ring >= 0) {
      const ringOn = d2 < cull2;
      if (c.ringOn !== ringOn) { c.ringOn = ringOn; if (FX.pools) poolShow(FX.pools.rings, c.ring, ringOn); }
    }
    const cast = d2 < (c.cast ? CHEST_SHADOW_OFF2 : CHEST_SHADOW_R2);
    if (c.cast !== cast && CP) { c.cast = cast; visRemove(c); visAdd(CP[cast ? 1 : 0], c); }
  }
  // death piles: their one ring follows the cull like an item's (the beam and the glow fade in their shaders)
  if (piles.size && FX.pools) for (const P of piles.values()) {
    const pdx = P.pos.x - cp.x, pdy = P.pos.y - cp.y, pdz = P.pos.z - cp.z;
    const vis = pdx * pdx + pdy * pdy + pdz * pdz < cull2;
    if (P.vis !== vis) { P.vis = vis; poolShow(FX.pools.rings, P.ring, vis); }
  }
  fxFrame(W, dt, cull);

  // human interact:
  //  - walk over items → auto-pickup whenever there's room
  //  - tap E on an item with a full inventory → SWAP with the active slot
  //  - HOLD E for 2 s on a chest → open (progress surfaces on the HUD)
  const a = W.player;
  if (a && a.alive && !a.downed) {                   // C-DBNO: a downed player loots nothing (and keeps no loot hint: the HUD shows BLEEDING OUT)
    const near = nearby(a.pos, 2.4, REACH_DY, true);
    const yieldE = reviveYield(W, a);                  // a downed teammate within reach: E is the revive's (player.js), not a chest's or a swap's
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
    const target = yieldE ? null : ((a._eHoldT || 0) > 0.18 && chestNear) ? chestNear : (itemNear || chestNear);
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
      a.input.interact = false;                       // (consumed while yielding too: a tap that started a revive must not swap a gun after it)
      if (!yieldE && target && target.type === "item") pickup(W, a, target.id, { swap: true });
    }
    // _loot marks the hints this module wrote: with no loot target only OUR stale hint is cleared (a revive prompt another module wrote stays)
    if (target) W.interactHint = Object.assign({}, target, { progress: target.type === "chest" ? chestChannel.t / CHEST_OPEN_S : 0, _loot: true });
    else if (W.interactHint && W.interactHint._loot) W.interactHint = null;
  } else if (a) {
    if (chestChannel.id) { chestChannel.id = null; chestChannel.t = 0; }
    a._eHoldT = 0;
    if (W.interactHint && W.interactHint._loot) W.interactHint = null;
  }

  // BOT WALKOVER (audit M6/gap 9). Bots only ever picked things up inside actLoot,
  // so a bot fighting, fleeing or rotating walked straight over a better gun. The
  // human's walkover rule now applies to every bot in every state, through the
  // same wouldAccept() predicate give() enforces (gun cap, bot trade-up, reserve
  // and stack caps) and the same [Q]-drop grace. Allocation-free grid walk.
  for (let i = 0; i < W.actors.length; i++) {
    const b = W.actors[i];
    if (!b.isBot || !b.alive || b.downed || b.gliding || b.netRemote || !b.inventory) continue;
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
        // (Wave 8 fix round, lane K2) a HOUSE item is walked over from inside its room only: the same clear line the player's walk-over needs (pickLos);
        // a bot on the street 1.2 m from a shelf behind the wall used to take its gun through the wall (verify_b). Non-house items: unchanged.
        // (the room test first: no sight line is cast for a bot outside the item's room - the street side of the wall, the next room)
        if (it.house && ((it.rr && !inRects(it.rr, px, pz, 0.3)) || !pickLos(a.pos, it, 0.1))) continue;
        pickup(W, a, it.id);
      }
    }
  }
}
const CHEST_OPEN_S = 2.0;
const chestChannel = { id: null, t: 0 };

/** C-DBNO: does the player's E belong to a revive right now? (player.js owns the revive channel: a teammate holds E within K.REVIVE_R / 2 m of a downed
 *  team member.) True while the player is reviving (a.reviving, if player.js sets it) or a downed, living teammate is within reach - then a chest
 *  channel or a tap-E swap would fight the revive for the same key. Solo / FFA: no teammates, never true. */
function reviveYield(W, a) {
  if (a.reviving) return true;
  if (a.teamId == null || !W.actors) return false;
  const R = (K && K.REVIVE_R) || 2.0, R2 = (R + 0.3) * (R + 0.3);
  for (let i = 0; i < W.actors.length; i++) {
    const b = W.actors[i];
    if (b === a || !b.downed || !b.alive || b.teamId !== a.teamId) continue;
    const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z;
    if (dx * dx + dz * dz < R2 && Math.abs(b.pos.y - a.pos.y) < REACH_DY) return true;
  }
  return false;
}

/** W.lootLabels(pos, r): nearbyLoot(pos, r) for the HUD's world pills, with every DEATH PILE folded into ONE entry at the pile's centre:
 *  { type: "pile", id, pos, d, data (the best member's data), count, label ("AR · EPIC  +6"), lines (every member's short label, best first),
 *    color (the pile's RARITY_COLOR), members (item ids) }. Other entries are nearbyLoot's own (chests carry `supply`). Allocates (a HUD 4-10 Hz call). */
const AMMO_SHORT = { light: "LIGHT", medium: "MEDIUM", shells: "SHELLS", heavy: "HEAVY", grenades: "GRENADES" };
const CON_SHORT = { bandage: "BANDAGE", medkit: "MEDKIT", mini_shield: "MINI SHIELD", big_shield: "BIG SHIELD", frag: "FRAG" };
function shortLabel(d) {
  if (d.kind === "weapon") return String(d.id).toUpperCase() + " · " + String(K.RARITY[d.rarity || 0] || "").toUpperCase();
  if (d.kind === "ammo") return (d.count || 0) + " " + (AMMO_SHORT[d.id] || String(d.id).toUpperCase());
  return (CON_SHORT[d.id] || String(d.id).toUpperCase()) + ((d.count || 1) > 1 ? " x" + d.count : "");
}
function lootLabels(pos, r) {
  const near = nearby(pos, r);
  const out = [], seen = new Map();
  for (const n of near) {
    if (n.type !== "item" || !n.pile || !piles.has(n.pile)) { out.push(n); continue; }
    let e = seen.get(n.pile);
    if (!e) {
      const P = piles.get(n.pile);
      const dx = P.pos.x - pos.x, dz = P.pos.z - pos.z;
      e = { type: "pile", id: P.id, pos: P.pos, d: Math.hypot(dx, dz), data: null, count: 0, label: "", lines: [], color: P.hex, members: [], _m: [] };
      seen.set(n.pile, e);
      out.push(e);
    }
    e._m.push(n);
  }
  for (const e of seen.values()) {
    // the WHOLE pile (members outside r too), best first
    const P = piles.get(e.id), all = [];
    for (const id of P.members) { const it = items.get(id); if (it && !it.taken) all.push(it); }
    all.sort((x, y) => lootValue(y.data) - lootValue(x.data));
    e.members = all.map((it) => it.id);
    e.lines = all.map((it) => shortLabel(it.data));
    e.count = all.length;
    e.data = all.length ? all[0].data : null;
    e.label = (e.lines[0] || "") + (all.length > 1 ? "  +" + (all.length - 1) : "");
    delete e._m;
  }
  out.sort((x, y) => x.d - y.d);
  return out;
}

/** W.nearbyChests(pos, r, out): the unopened chests and landed, unopened supply crates within r (horizontal) of pos, written into the first N
 *  records of `out` (an array the caller keeps; its records are reused, so nothing is allocated once it has grown), nearest first. Returns N (the
 *  records past N are stale, kept for reuse). For the audio lane's chest shimmer (P2-J): { id, x, y, z, d, supply, house }. */
function nearbyChests(pos, r, out) {
  out = out || [];
  let n = 0;
  const r2 = r * r;
  const x0 = Math.floor((pos.x - r) / LOOT_CELL), x1 = Math.floor((pos.x + r) / LOOT_CELL);
  const z0 = Math.floor((pos.z - r) / LOOT_CELL), z1 = Math.floor((pos.z + r) / LOOT_CELL);
  for (let cx = x0; cx <= x1; cx++) for (let cz = z0; cz <= z1; cz++) {
    const l = lootGrid.get(lkey(cx, cz));
    if (!l) continue;
    for (let i = 0; i < l.length; i++) {
      const e = l[i];
      if (e.kind !== "chest") continue;
      const c = chests.get(e.id);
      if (!c || c.opened) continue;
      const dx = c.pos.x - pos.x, dz = c.pos.z - pos.z, d2 = dx * dx + dz * dz;
      if (d2 >= r2) continue;
      let o = out[n];
      if (!o) { o = { id: null, x: 0, y: 0, z: 0, d: 0, supply: false, house: null }; out[n] = o; }
      o.id = c.id; o.x = c.pos.x; o.y = c.pos.y; o.z = c.pos.z; o.d = Math.sqrt(d2); o.supply = !!c.supply; o.house = c.house || null;
      n++;
    }
  }
  // insertion sort by distance (a handful of entries; no comparator closure)
  for (let i = 1; i < n; i++) { const o = out[i]; let j = i - 1; while (j >= 0 && out[j].d > o.d) { out[j + 1] = out[j]; j--; } out[j + 1] = o; }
  return n;
}
