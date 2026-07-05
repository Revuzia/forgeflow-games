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
let nextId = 1;
let supplyState = null;

export function init(W) {
  K = W.SIM;
  W.nearbyLoot = (pos, r) => nearby(pos, r);
  W.pickupItem = (a, id) => pickup(W, a, id);
  W.openChest = (a, id) => openChest(W, a, id);
  W.giveItem = (a, data) => give(W, a, data);
  W.events.on("actorDied", (victim) => deathDrop(W, victim));

  // network mirrors + join-sync
  W.netTakeItem = (id) => {
    const it = items.get(id);
    if (it) { it.taken = true; if (it.group.parent) it.group.parent.remove(it.group); items.delete(id); takenIds.push(id); }
  };
  W.netOpenChest = (id) => openChest(W, null, id);
  W.netSpawnItem = (d) => spawnItem(W, d.data, d.x, d.y, d.z, d.id);
  W.lootSyncState = () => ({ taken: takenIds.slice(), opened: [...chests.values()].filter((c) => c.opened).map((c) => c.id) });
}
const takenIds = [];

export function resetSync() { takenIds.length = 0; }

export function populate(W) {
  items.clear(); chests.clear();
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
  mats: new THREE.BoxGeometry(0.4, 0.4, 0.4),
  consumable: new THREE.CylinderGeometry(0.14, 0.14, 0.4, 8),
};
const kindMats = {
  ammo: new THREE.MeshStandardMaterial({ color: 0x8a7d3a, metalness: 0.4, roughness: 0.5 }),
  wood: new THREE.MeshStandardMaterial({ color: 0xb08850 }),
  brick: new THREE.MeshStandardMaterial({ color: 0xb06a55 }),
  metal: new THREE.MeshStandardMaterial({ color: 0x8b98a5, metalness: 0.5 }),
  heal: new THREE.MeshStandardMaterial({ color: 0x59d68a, emissive: 0x1a4, emissiveIntensity: 0.4 }),
  shieldC: new THREE.MeshStandardMaterial({ color: 0x4aa8ff, emissive: 0x123a66, emissiveIntensity: 0.5 }),
  grenade: new THREE.MeshStandardMaterial({ color: 0x3d5a3a }),
};

function itemMesh(W, data) {
  const grp = new THREE.Group();
  grp.add(rarityRing(data.kind === "weapon" ? data.rarity : 0));
  if (data.kind === "weapon" && data.id !== "grenade") {
    // weapon proto (async — attach when protos ready)
    if (W.weaponProto) {
      W.weaponProto(data.id).then((proto) => {
        if (proto && grp.parent) { const m = proto.clone(); m.position.y = 0.45; m.rotation.z = 0.5; grp.add(m); }
      });
    }
  } else if (data.kind === "weapon" && data.id === "grenade") {
    const m = new THREE.Mesh(kindGeos.consumable, kindMats.grenade); m.position.y = 0.4; grp.add(m);
  } else if (data.kind === "ammo") {
    const m = new THREE.Mesh(kindGeos.ammo, kindMats.ammo); m.position.y = 0.35; grp.add(m);
  } else if (data.kind === "mats") {
    const m = new THREE.Mesh(kindGeos.mats, kindMats[data.id] || kindMats.wood); m.position.y = 0.4; grp.add(m);
  } else if (data.kind === "consumable") {
    const isShield = data.id.includes("shield");
    const m = new THREE.Mesh(kindGeos.consumable, isShield ? kindMats.shieldC : kindMats.heal); m.position.y = 0.4; grp.add(m);
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
  return id;
}

let chestProto = null;
async function ensureChestProto(W) {
  if (chestProto) return chestProto;
  try {
    const m = await W.kernel.loadGLTF(W.assetBase + "assets/props/chest.glb");
    const bbox = new THREE.Box3().setFromObject(m);
    const size = bbox.getSize(new THREE.Vector3());
    const s = 1.1 / Math.max(size.x, size.z, 0.01);
    m.scale.setScalar(s);
    m.position.y = -bbox.min.y * s;
    chestProto = m;
  } catch (e) {
    chestProto = new THREE.Mesh(new THREE.BoxGeometry(1, 0.7, 0.7), new THREE.MeshStandardMaterial({ color: 0x8a6420 }));
  }
  return chestProto;
}

function spawnChest(W, x, y, z) {
  const id = "c" + (nextId++);
  const group = new THREE.Group();
  const gy = Math.max(y - 0.4, W.map.heightAt(x, z));
  group.position.set(x, gy, z);
  const ring = rarityRing(4);
  ring.scale.setScalar(1.3);
  ring.position.y = 0.1;
  group.add(ring);
  ensureChestProto(W).then((proto) => { if (group.parent) group.add(proto.clone()); });
  W.group("loot").add(group);
  chests.set(id, { id, pos: { x, y: gy, z }, group, opened: false });
  return id;
}

// ── supply drops ─────────────────────────────────────────────────────────────
function maybeSupplyDrop(W, dt) {
  if (W.mode === "practice" || !W.stormCtl) return;
  const st = W.stormCtl.storm.stateAt(W.t);
  if (st.phase >= 2 && supplyState.dropped < 2 && !supplyState.falling && supplyState.dropped < st.phase - 1) {
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
  for (const [, it] of items) {
    if (it.taken) continue;
    const d = Math.hypot(it.pos.x - pos.x, it.pos.z - pos.z);
    if (d < r && Math.abs(it.pos.y - pos.y) < 4) out.push({ type: "item", id: it.id, data: it.data, pos: it.pos, d });
  }
  for (const [, c] of chests) {
    if (c.opened) continue;
    const d = Math.hypot(c.pos.x - pos.x, c.pos.z - pos.z);
    if (d < r && Math.abs(c.pos.y - pos.y) < 4) out.push({ type: "chest", id: c.id, pos: c.pos, d });
  }
  out.sort((a, b) => a.d - b.d);
  return out;
}

function openChest(W, a, id) {
  const c = chests.get(id);
  if (!c || c.opened) return false;
  c.opened = true;
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

function pickup(W, a, id) {
  const it = items.get(id);
  if (!it || it.taken) return false;
  if (!give(W, a, it.data)) return false;
  it.taken = true;
  if (it.group.parent) it.group.parent.remove(it.group);
  items.delete(id);
  takenIds.push(id);
  W.events.emit("pickedUp", a, it.data, id);
  return true;
}

/** Add item data to an actor's inventory. Returns false if no room. */
function give(W, a, data) {
  const inv = a.inventory;
  if (data.kind === "ammo") {
    const cap = K.AMMO[data.id].max;
    inv.ammo[data.id] = Math.min(cap, (inv.ammo[data.id] || 0) + (data.count || K.AMMO[data.id].box));
    return true;
  }
  if (data.kind === "mats") {
    inv.mats[data.id] = Math.min(K.BUILD.matCap, (inv.mats[data.id] || 0) + (data.count || 30));
    return true;
  }
  if (data.kind === "weapon" && data.id === "grenade") {
    inv.grenades = Math.min(K.WEAPONS.grenade.stack, (inv.grenades || 0) + (data.count || 1));
    // grenades also occupy a pseudo-slot for selection if there's room
    if (!inv.slots.some((s) => s && s.id === "grenade")) {
      const empty = inv.slots.findIndex((s, i) => i > 0 && !s);
      if (empty > 0) inv.slots[empty] = { kind: "weapon", id: "grenade", rarity: 0, mag: 0 };
    }
    return true;
  }
  if (data.kind === "weapon") {
    const empty = inv.slots.findIndex((s, i) => i > 0 && !s);
    const slot = { kind: "weapon", id: data.id, rarity: data.rarity || 0, mag: K.WEAPONS[data.id].mag };
    if (empty > 0) { inv.slots[empty] = slot; if (inv.active === 0) { W.equipSlot(a, empty); } return true; }
    // no room: swap with active (drop current) if active isn't pickaxe
    if (inv.active > 0) {
      const old = inv.slots[inv.active];
      dropItem(W, a, { kind: "weapon", id: old.id, rarity: old.rarity });
      inv.slots[inv.active] = slot;
      W.equipSlot(a, inv.active);
      return true;
    }
    return false;
  }
  if (data.kind === "consumable") {
    const st = inv.slots.find((s) => s && s.kind === "consumable" && s.id === data.id);
    const cs = K.CONSUMABLES[data.id];
    if (st) { st.count = Math.min(cs.stack, st.count + (data.count || 1)); return true; }
    const empty = inv.slots.findIndex((s, i) => i > 0 && !s);
    if (empty > 0) { inv.slots[empty] = { kind: "consumable", id: data.id, count: Math.min(cs.stack, data.count || 1) }; return true; }
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
    spawnItem(W, data, victim.pos.x + Math.cos(ang) * r, victim.pos.y + 0.2, victim.pos.z + Math.sin(ang) * r, "dd:" + victim.id + ":" + (k++));
  };
  for (let i = 1; i < inv.slots.length; i++) {
    const s = inv.slots[i];
    if (!s) continue;
    if (s.kind === "weapon" && s.id !== "grenade") drop({ kind: "weapon", id: s.id, rarity: s.rarity });
    if (s.kind === "consumable" && s.count > 0) drop({ kind: "consumable", id: s.id, count: s.count });
    inv.slots[i] = null;
  }
  for (const am in inv.ammo) if (inv.ammo[am] > 8) drop({ kind: "ammo", id: am, count: Math.min(inv.ammo[am], K.AMMO[am].box * 2) });
  for (const mt of K.MAT_IDS) if (inv.mats[mt] >= 20) drop({ kind: "mats", id: mt, count: Math.min(inv.mats[mt], 120) });
  if (inv.grenades > 0) drop({ kind: "weapon", id: "grenade", count: inv.grenades });
}

// ── frame update ─────────────────────────────────────────────────────────────
let bobT = 0;
export function update(W, dt) {
  bobT += dt;
  // bob + spin (only items near the camera to save time)
  const cp = W.camera.position;
  for (const [, it] of items) {
    if (it.taken) continue;
    const dx = it.pos.x - cp.x, dz = it.pos.z - cp.z;
    if (dx * dx + dz * dz > 90 * 90) continue;
    it.group.rotation.y = bobT * 1.4;
    it.group.position.y = it.pos.y + Math.sin(bobT * 2 + it.pos.x) * 0.08 + 0.08;
  }
  maybeSupplyDrop(W, dt);

  // human interact: E on nearest item/chest; ammo+mats auto-pickup on walkover
  const a = W.player;
  if (a && a.alive) {
    const near = nearby(a.pos, 2.4);
    W.interactHint = near.length ? near[0] : null;
    // auto-pickup ammo/mats within 1.3m
    for (const n of near) {
      if (n.type === "item" && n.d < 1.3 && (n.data.kind === "ammo" || n.data.kind === "mats")) pickup(W, a, n.id);
    }
    if (a.input.interact) {
      a.input.interact = false;
      const t = near[0];
      if (t) { if (t.type === "chest") openChest(W, a, t.id); else pickup(W, a, t.id); }
    }
  }
}
