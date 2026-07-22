/**
 * royale/loot.js — ground loot, chests, supply drops, pickups, inventory ops,
 * and death drops. Loot placement is SEEDED (same seed → same loot) so
 * multiplayer clients agree without item sync.
 *
 * Item visuals: rarity-colored ring + kind mesh (weapon protos from
 * weapons.js when ready), gentle bob+spin. Chests use the treasure chest GLB
 * with a gold shimmer light-ring.
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
const lkey = (cx, cz) => cx + "," + cz;
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
    if (it) { it.taken = true; if (it.group.parent) it.group.parent.remove(it.group); items.delete(id); takenIds.push(id); }
  };
  W.netOpenChest = (id) => openChest(W, null, id);
  W.netSpawnItem = (d) => spawnItem(W, d.data, d.x, d.y, d.z, d.id);
  W.lootSyncState = () => ({ taken: takenIds.slice(), opened: [...chests.values()].filter((c) => c.opened).map((c) => c.id) });
  W.debugChests = () => [...chests.values()]; // test hook (preview verification)
}
const takenIds = [];

export function resetSync() { takenIds.length = 0; }

/** Release the GPU resources the LAST match's loot allocated.
 *  disposeMapResources is deliberately scoped to W._groups.map, and match
 *  teardown only .clear()s the other groups — so every chest's glow SpriteMaterial
 *  (a fresh one per chest, chestGlow()), every beam CylinderGeometry +
 *  MeshBasicMaterial, and every death-drop glow was orphaned on the GPU each
 *  match. With ~130 chests a map and PLAY AGAIN as the expected flow, that
 *  compounds without ever passing through a reload.
 *
 *  The prototypes are shared across matches ON PURPOSE (itemProtoCache holds the
 *  loaded GLBs; ringGeo/kindGeos/kindMats/ringMats/glowTex are built once, and
 *  THREE's clone() shares geometry and material by reference) — so anything
 *  reachable from them is excluded BY IDENTITY. Disposing those would leave the
 *  next match drawing with dead handles. */
export function disposeLootResources(W) {
  const g = W._groups && W._groups.loot;
  if (!g) return { geometries: 0, materials: 0, textures: 0 };
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
  keep(ringGeo); keep(glowTex); keep(chestProto);
  for (const k in ringMats) keep(ringMats[k]);
  for (const k in kindGeos) keep(kindGeos[k]);
  for (const k in kindMats) keep(kindMats[k]);
  for (const k in itemProtoCache) keep(itemProtoCache[k]);

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

export function populate(W) {
  items.clear(); chests.clear(); lootGrid.clear();
  takenIds.length = 0;
  nextId = 1;
  supplyState = { dropped: 0, next: null };
  const rng = K.mulberry32(W.seed ^ 0x100f);
  const modeK = K.MODE[W.mode] || K.MODE.standard;
  const g = W.group("loot");
  g.clear();

  let fi = 0;
  for (const lp of W.map.lootPoints) {
    fi++;
    if (lp.kind === "chest") {
      spawnChest(W, lp.x, lp.y, lp.z);
    } else {
      if (rng() < 0.55 * Math.min(1.6, modeK.lootMult)) spawnItem(W, K.rollFloorItem(rng), lp.x, lp.y, lp.z, "f:" + fi);
      if (modeK.lootMult > 1.2 && rng() < 0.4) {
        spawnItem(W, K.rollFloorItem(rng), lp.x + 1.2, lp.y, lp.z + 0.8, "f2:" + fi);
      }
    }
  }
}

// ── visuals ──────────────────────────────────────────────────────────────────
const ringGeo = new THREE.TorusGeometry(0.55, 0.05, 6, 24);
const ringMats = {};
function rarityRing(rarity) {
  const c = K.RARITY_COLOR[K.RARITY[rarity || 0]] || "#9da5b4";
  if (!ringMats[c]) ringMats[c] = new THREE.MeshBasicMaterial({ color: c });
  const m = new THREE.Mesh(ringGeo, ringMats[c]);
  m.rotation.x = -Math.PI / 2;
  return m;
}
const kindGeos = {
  ammo: new THREE.BoxGeometry(0.34, 0.24, 0.24),
  consumable: new THREE.CylinderGeometry(0.14, 0.14, 0.4, 8),
};
const kindMats = {
  ammo: new THREE.MeshStandardMaterial({ color: 0x8a7d3a, metalness: 0.4, roughness: 0.5 }),
  heal: new THREE.MeshStandardMaterial({ color: 0x59d68a, emissive: 0x1a4, emissiveIntensity: 0.4 }),
  shieldC: new THREE.MeshStandardMaterial({ color: 0x4aa8ff, emissive: 0x123a66, emissiveIntensity: 0.5 }),
};

function itemMesh(W, data) {
  const grp = new THREE.Group();
  grp.add(rarityRing(data.kind === "weapon" ? data.rarity : 0));
  if (data.kind === "weapon") {
    // weapon proto (async — attach when protos ready)
    if (W.weaponProto) {
      W.weaponProto(data.id).then((proto) => {
        if (proto && grp.parent) { const m = proto.clone(); m.position.y = 0.45; m.rotation.z = 0.5; grp.add(m); }
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
        if (proto && grp.parent) { const m = proto.clone(); m.position.y = 0.42; grp.add(m); }
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
  items.set(id, { id, data, pos: { x, y: gy, z }, group, taken: false });
  gridAdd("item", id, { x, z });
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

// golden glow sprite (radial canvas) + light beam so chests read from far away
let glowTex = null;
function chestGlow() {
  if (!glowTex) {
    const cv = document.createElement("canvas");
    cv.width = cv.height = 128;
    const ctx = cv.getContext("2d");
    const gr = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    gr.addColorStop(0, "rgba(255,214,84,0.9)");
    gr.addColorStop(0.4, "rgba(255,190,50,0.35)");
    gr.addColorStop(1, "rgba(255,180,40,0)");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 128, 128);
    glowTex = new THREE.CanvasTexture(cv); glowTex.colorSpace = THREE.SRGBColorSpace;
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  sp.scale.set(3.2, 3.2, 1);
  sp.position.y = 0.9;
  return sp;
}

function spawnChest(W, x, y, z) {
  const id = "c" + (nextId++);
  const group = new THREE.Group();
  const gy = Math.max(y - 0.4, W.map.heightAt(x, z));
  group.position.set(x, gy, z);
  group.rotation.y = (x * 13.7 + z * 7.3) % (Math.PI * 2); // varied facing
  const ring = rarityRing(4);
  ring.scale.setScalar(1.6);
  ring.position.y = 0.06;
  group.add(ring);
  const glow = chestGlow();
  group.add(glow);
  // vertical light beam (additive open-ended cylinder)
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.28, 0.5, 7, 8, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffd254, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })
  );
  beam.position.y = 3.6;
  group.add(beam);
  // keep a handle on the loaded model so update() can cull it by distance —
  // chests.set below runs synchronously, long before this promise resolves.
  ensureChestProto(W).then((proto) => {
    if (!group.parent) return;
    const m = proto.clone();
    group.add(m);
    const rec = chests.get(id);
    if (rec) rec.model = m;
  });
  W.group("loot").add(group);
  chests.set(id, { id, pos: { x, y: gy, z }, group, opened: false, glow, beam, ring });
  gridAdd("chest", id, { x, z });
  return id;
}

// ── supply drops ─────────────────────────────────────────────────────────────
function maybeSupplyDrop(W, dt) {
  if (W.mode === "practice" || !W.stormCtl) return;
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
  if (c.glow) c.group.remove(c.glow);
  if (c.beam) c.group.remove(c.beam);
  if (c.ring) c.group.remove(c.ring);
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

function pickup(W, a, id, opts) {
  const it = items.get(id);
  if (!it || it.taken) return false;
  if (opts && opts.swap) it.data.swap = true;
  const ok = give(W, a, it.data);
  delete it.data.swap;
  if (!ok) return false;
  it.taken = true;
  if (it.group.parent) it.group.parent.remove(it.group);
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
    const slot = { kind: "weapon", id: data.id, rarity: data.rarity || 0, mag: K.WEAPONS[data.id].mag };
    // The 3-gun cap used to live ONLY in the human's walkover branch, so bots
    // filled all five slots with guns and could then never pick up a shield or
    // a heal for the rest of the match. An explicit E-swap still works below:
    // it REPLACES the active weapon, so it never raises the count.
    if (empty >= 0 && guns < GUN_CAP) {
      inv.slots[empty] = slot;
      // auto-upgrade: if still on the starter common pistol, switch to the pickup
      const cur = inv.slots[inv.active];
      if (cur && cur.id === "pistol" && cur.rarity === 0 && data.id !== "pistol") W.equipSlot(a, empty);
      return true;
    }
    // bot trade-up at the cap: drop its worst gun, take the better one
    const tradeIdx = botWouldTradeUp(W, a, data);
    if (tradeIdx >= 0) {
      const old2 = inv.slots[tradeIdx];
      dropItem(W, a, { kind: "weapon", id: old2.id, rarity: old2.rarity });
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
        dropItem(W, a, { kind: "weapon", id: old.id, rarity: old.rarity });
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
      if (old && old.kind === "weapon") dropItem(W, a, { kind: "weapon", id: old.id, rarity: old.rarity });
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
function dropItem(W, a, data) {
  // weapon-swap drops are local-only events → mirror them explicitly online
  const id = "sw:" + a.id + ":" + (swapN++);
  const x = a.pos.x + (Math.random() - 0.5) * 1.4, y = a.pos.y + 0.2, z = a.pos.z + (Math.random() - 0.5) * 1.4;
  spawnItem(W, data, x, y, z, id);
  if (W.net && !a.netRemote) W.events.emit("netDropItem", { data, x, y, z, id });
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
    // Scaled to 1.3 (chests use 3.2): a marker, not a beacon.
    const it = items.get(iid);
    if (it) { const g2 = chestGlow(); g2.scale.set(1.3, 1.3, 1); g2.position.y = 0.55; it.group.add(g2); }
  };
  // EVERY carried weapon (including the equipped one) + consumables + ammo
  for (let i = 0; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (!s) continue;
    if (s.kind === "weapon") drop({ kind: "weapon", id: s.id, rarity: s.rarity });
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
  for (const [, it] of items) {
    if (it.taken) continue;
    const dx = it.pos.x - cp.x, dy = it.pos.y - cp.y, dz = it.pos.z - cp.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const vis = d2 < cull2;
    if (it.group.visible !== vis) it.group.visible = vis;
    if (!vis || d2 > 90 * 90) continue;
    it.group.rotation.y = bobT * 1.4;
    it.group.position.y = it.pos.y + Math.sin(bobT * 2 + it.pos.x) * 0.08 + 0.08;
  }
  maybeSupplyDrop(W, dt);

  // chest glow pulse (only near camera)
  for (const [, c] of chests) {
    const cdx = c.pos.x - cp.x, cdy = c.pos.y - cp.y, cdz = c.pos.z - cp.z;
    const d2 = cdx * cdx + cdy * cdy + cdz * cdz;
    // Cull the chest MODEL and its rarity ring only. The glow sprite and the
    // light beam stay lit at any range — they are the beacon you steer the
    // glider toward, and hiding them would make chests unfindable on descent.
    if (c.model) c.model.visible = d2 < cull2;
    if (c.ring) c.ring.visible = d2 < cull2;
    if (c.opened || !c.glow) continue;
    if (d2 > 160 * 160) continue;
    const k = 0.85 + Math.sin(bobT * 2.4 + c.pos.x) * 0.15;
    c.glow.scale.set(3.2 * k, 3.2 * k, 1);
  }

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
}
const CHEST_OPEN_S = 2.0;
const chestChannel = { id: null, t: 0 };
