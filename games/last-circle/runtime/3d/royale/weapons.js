/**
 * royale/weapons.js — firing, projectiles, recoil, reload, melee/harvest,
 * grenades + rockets with splash, and weapon view models.
 *
 * Projectiles are REAL (position + velocity + optional gravity), stepped in
 * segments each frame and tested against: build pieces → static world boxes →
 * terrain → actor capsules — nearest hit wins. "Hitscan-fast" weapons are just
 * very fast projectiles, so travel time and bullet drop come free for sniper
 * and rockets.
 *
 * View models: pistol/shotgun/pickaxe are real GLBs; AR/SMG/sniper/rocket are
 * multi-part composed low-poly builds (distinct silhouettes per class).
 */
import * as THREE from "three";

let K = null;
const projectiles = [];
const POOL = [];
let protosPromise = null;

export function init(W) {
  K = W.SIM;
  W.equipSlot = (a, idx) => equipSlot(W, a, idx);
  W.throwGrenade = (a) => throwGrenade(W, a);
  W.explode = (x, y, z, weaponId, rarity, ownerId) => explode(W, x, y, z, weaponId, rarity, ownerId);
  protosPromise = null;
  W.weaponProto = (id) => protos(W).then((p) => p[id]);
}

function protos(W) {
  if (!protosPromise) protosPromise = buildProtos(W);
  return protosPromise;
}

// ── view models ──────────────────────────────────────────────────────────────
async function buildProtos(W) {
  const protos = {};
  const mk = (parts) => {
    const g = new THREE.Group();
    for (const p of parts) {
      const mesh = new THREE.Mesh(
        p.cyl ? new THREE.CylinderGeometry(p.cyl[0], p.cyl[0], p.cyl[1], 8) : new THREE.BoxGeometry(p.s[0], p.s[1], p.s[2]),
        new THREE.MeshStandardMaterial({ color: p.c, roughness: 0.6, metalness: 0.3 })
      );
      if (p.cyl) mesh.rotation.x = Math.PI / 2;
      mesh.position.set(p.p[0], p.p[1], p.p[2]);
      g.add(mesh);
    }
    return g;
  };
  const DARK = 0x2b2f33, MID = 0x4a5258, WOOD = 0x7a5233, ACC = 0x1c1f22;
  // composed silhouettes (z+ = barrel forward)
  protos.ar = mk([
    { s: [0.09, 0.14, 0.62], p: [0, 0, 0.05], c: DARK },        // receiver
    { cyl: [0.028, 0.5], p: [0, 0.02, 0.52], c: MID },          // barrel
    { s: [0.06, 0.22, 0.09], p: [0, -0.16, 0.12], c: ACC },     // mag
    { s: [0.07, 0.12, 0.3], p: [0, -0.03, -0.38], c: WOOD },    // stock
    { s: [0.05, 0.06, 0.18], p: [0, 0.11, 0.1], c: ACC },       // sight rail
  ]);
  protos.smg = mk([
    { s: [0.09, 0.12, 0.4], p: [0, 0, 0], c: MID },
    { cyl: [0.025, 0.22], p: [0, 0.01, 0.3], c: DARK },
    { s: [0.05, 0.26, 0.07], p: [0, -0.17, 0.02], c: ACC },
    { s: [0.06, 0.05, 0.16], p: [0, -0.04, -0.26], c: DARK },
  ]);
  protos.sniper = mk([
    { s: [0.08, 0.12, 0.7], p: [0, 0, 0.1], c: WOOD },
    { cyl: [0.024, 0.72], p: [0, 0.02, 0.68], c: DARK },
    { cyl: [0.045, 0.3], p: [0, 0.13, 0.12], c: ACC },          // scope
    { s: [0.06, 0.14, 0.26], p: [0, -0.05, -0.36], c: WOOD },
    { s: [0.04, 0.05, 0.1], p: [0, -0.14, 0.3], c: DARK },
  ]);
  protos.rocket = mk([
    { cyl: [0.09, 0.9], p: [0, 0, 0.1], c: 0x4d5a3a },          // tube
    { cyl: [0.1, 0.16], p: [0, 0, 0.62], c: ACC },
    { s: [0.06, 0.16, 0.12], p: [0, -0.16, -0.1], c: DARK },
    { s: [0.05, 0.1, 0.06], p: [0, 0.14, -0.05], c: ACC },      // sight
  ]);
  protos.grenade = mk([
    { cyl: [0.07, 0.16], p: [0, 0, 0], c: 0x3d5a3a },
    { s: [0.04, 0.06, 0.04], p: [0, 0.11, 0], c: MID },
  ]);
  // GLB models
  const base = W.assetBase + "assets/props/";
  for (const [id, file, len] of [["pistol", "wpn-pistol.glb", 0.34], ["shotgun", "wpn-shotgun.glb", 0.8], ["pickaxe", "wpn-pickaxe.glb", 0.9]]) {
    try {
      const m = await W.kernel.loadGLTF(base + file);
      const bbox = new THREE.Box3().setFromObject(m);
      const size = bbox.getSize(new THREE.Vector3());
      const s = len / Math.max(size.x, size.y, size.z, 0.001);
      m.scale.setScalar(s);
      const c = bbox.getCenter(new THREE.Vector3()).multiplyScalar(s);
      m.position.sub(c);
      const g = new THREE.Group(); g.add(m);
      if (id !== "pickaxe") m.rotation.y = Math.PI / 2; // barrels forward
      protos[id] = g;
    } catch (e) { console.warn("[weapons] GLB fail", id, e); protos[id] = protos.smg.clone(); }
  }
  return protos;
}

function equipSlot(W, a, idx) {
  const inv = a.inventory;
  const slot = inv.slots[idx];
  if (!slot) return;
  inv.active = idx;
  if (slot.kind === "weapon") {
    a.weapon = { id: slot.id, rarity: slot.rarity || 0, magAmmo: slot.mag != null ? slot.mag : 0, state: "ready", cd: 0, reloadT: 0, slotRef: slot };
  } else {
    a.weapon = { id: "consumable:" + slot.id, rarity: 0, magAmmo: 0, state: "ready", cd: 0, reloadT: 0, slotRef: slot };
  }
  refreshWeaponMesh(W, a);
  W.events.emit("weaponEquipped", a, a.weapon);
}

async function refreshWeaponMesh(W, a) {
  const P = await protos(W);
  if (a.weaponMesh) { a.hand && a.hand.remove(a.weaponMesh); a.weaponMesh = null; }
  const id = a.weapon && a.weapon.id;
  const proto = P[id];
  if (!proto || !a.hand) return;
  a.weaponMesh = proto.clone();
  a.hand.add(a.weaponMesh);
}

// ── aim helpers ──────────────────────────────────────────────────────────────
const _dir = new THREE.Vector3();
export function eyePos(a) {
  return { x: a.pos.x, y: a.pos.y + (a.crouching ? 1.15 : K.PLAYERK.eyeY), z: a.pos.z };
}
export function aimDir(a, out) {
  const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
  const sp = Math.sin(a.pitch), cp = Math.cos(a.pitch);
  out = out || _dir;
  out.set(-sy * cp, sp, -cy * cp);
  return out;
}

// ── update loop ──────────────────────────────────────────────────────────────
export function update(W, dt) {
  for (const a of W.actors) {
    if (!a.alive || a.netRemote) continue;
    stepWeapon(W, a, dt);
  }
  stepProjectiles(W, dt);
}

function stepWeapon(W, a, dt) {
  const wpn = a.weapon;
  if (!wpn) return;
  const inp = a.input;

  // slot switching
  if (inp.slot >= 0) { equipSlot(W, a, inp.slot); inp.slot = -1; }

  // consumable "weapon" — fire = use
  if (wpn.id.startsWith("consumable:")) {
    if (inp.fire && !a.healing) {
      const cid = wpn.id.slice("consumable:".length);
      W.events.emit("useConsumable", a, cid);
      if (!a.isBot) inp.fire = false;
    }
    return;
  }

  const def = K.WEAPONS[wpn.id];
  if (!def) return;
  wpn.cd -= dt;

  // quick heal hotkey
  if (inp.useHeal) { autoHeal(W, a); inp.useHeal = null; }

  // reload
  if (inp.reload && wpn.state === "ready" && def.mag > 0 && wpn.magAmmo < def.mag && a.inventory.ammo[def.ammo] > 0) {
    wpn.state = "reloading"; wpn.reloadT = def.reloadS;
    W.events.emit("reloadStart", a, wpn);
  }
  inp.reload = false;
  if (wpn.state === "reloading") {
    wpn.reloadT -= dt;
    if (wpn.reloadT <= 0) {
      const need = def.mag - wpn.magAmmo;
      const take = Math.min(need, a.inventory.ammo[def.ammo]);
      a.inventory.ammo[def.ammo] -= take;
      wpn.magAmmo += take;
      if (wpn.slotRef) wpn.slotRef.mag = wpn.magAmmo;
      wpn.state = "ready";
      W.events.emit("reloadDone", a, wpn);
    }
    return;
  }

  // firing (build mode swallows fire clicks — building.js places instead)
  if (inp.fire && wpn.cd <= 0 && !a.gliding && !a.healing && !inp.buildPiece) {
    if (def.harvest) { swingMelee(W, a, def); wpn.cd = 60 / def.rpm; return; }
    if (wpn.id === "grenade") { throwGrenade(W, a); wpn.cd = 60 / def.rpm; return; }
    if (def.mag > 0 && wpn.magAmmo <= 0) {
      // auto reload attempt
      if (a.inventory.ammo[def.ammo] > 0) { inp.reload = true; }
      else W.events.emit("dryFire", a);
      wpn.cd = 0.25;
      return;
    }
    fire(W, a, def);
    wpn.magAmmo--;
    if (wpn.slotRef) wpn.slotRef.mag = wpn.magAmmo;
    wpn.cd = 60 / def.rpm;
    if (!a.isBot && def.cls !== "shotgun" && def.cls !== "sniper" && def.cls !== "launcher") {
      // semi/auto: keep firing while held (auto weapons); pistol/sniper need re-click
      if (def.cls === "pistol") inp.fire = false;
    } else if (!a.isBot) {
      inp.fire = false;
    }
  }
}

function autoHeal(W, a) {
  // priority: shield if low, else hp
  const order = a.shield < 50 ? ["big_shield", "mini_shield", "medkit", "bandage"] : ["medkit", "bandage", "big_shield", "mini_shield"];
  for (const id of order) {
    const has = a.inventory.slots.find((s) => s && s.kind === "consumable" && s.id === id && s.count > 0);
    if (has) { W.events.emit("useConsumable", a, id); return; }
  }
}

// ── firing ───────────────────────────────────────────────────────────────────
const _d = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function fire(W, a, def) {
  const eye = eyePos(a);
  aimDir(a, _d);
  const pellets = def.pellets || 1;
  // spread: base × rarity × stance modifiers
  let spread = (def.spreadDeg || 1) * (K.RARITY_SPREAD_MULT[a.weapon.rarity] || 1);
  if (a.input.ads) spread *= 0.5;
  if (a.crouching) spread *= 0.75;
  const movePen = Math.hypot(a.vel.x, a.vel.z) > 1 ? 1.4 : 1;
  const airPen = a.onGround ? 1 : 2;
  spread *= movePen * airPen;

  for (let p = 0; p < pellets; p++) {
    const sr = (spread * Math.PI / 180);
    const ox = (Math.random() - 0.5) * 2 * sr, oy = (Math.random() - 0.5) * 2 * sr;
    _right.crossVectors(_d, _up).normalize();
    const dir = _d.clone().addScaledVector(_right, ox).addScaledVector(_up, oy).normalize();
    spawnProjectile(W, {
      x: eye.x + dir.x * 0.6, y: eye.y + dir.y * 0.6 - 0.05, z: eye.z + dir.z * 0.6,
      vx: dir.x * def.speed, vy: dir.y * def.speed, vz: dir.z * def.speed,
      weaponId: a.weapon.id === "grenade" ? "grenade" : Object.keys(K.WEAPONS).find((k) => K.WEAPONS[k] === def),
      rarity: a.weapon.rarity, ownerId: a.id,
      gravity: def.gravity ? -9.8 : 0, tLeft: 3.5,
      splash: def.splashR || 0, breaksAll: !!def.breaksAll,
      origin: { x: eye.x, y: eye.y, z: eye.z },
    });
  }
  // recoil kick (human only — bots model error separately)
  if (!a.isBot) {
    const kick = { pistol: 0.008, smg: 0.006, ar: 0.011, shotgun: 0.03, sniper: 0.05, rocket: 0.04 }[a.weapon.id] || 0.01;
    a.input.pitch = K.clamp(a.input.pitch + kick, -1.35, 1.35);
    a.input.yaw += (Math.random() - 0.5) * kick * 0.6;
    W.stats.shotsFired += pellets;
  }
  a.lastShotT = W.t;
  W.events.emit("shotFired", a, a.weapon.id, eye, _d.clone());
}

function throwGrenade(W, a) {
  if (a.inventory.grenades <= 0) return;
  a.inventory.grenades--;
  const eye = eyePos(a);
  aimDir(a, _d);
  const def = K.WEAPONS.grenade;
  spawnProjectile(W, {
    x: eye.x + _d.x, y: eye.y + _d.y + 0.1, z: eye.z + _d.z,
    vx: _d.x * def.speed, vy: _d.y * def.speed + 5, vz: _d.z * def.speed,
    weaponId: "grenade", rarity: 0, ownerId: a.id,
    gravity: -18, tLeft: def.fuseS, splash: def.splashR, bounce: true, mesh: true,
    origin: eye,
  });
  W.events.emit("shotFired", a, "grenade", eye, _d.clone());
}

function swingMelee(W, a, def) {
  const eye = eyePos(a);
  aimDir(a, _d);
  W.events.emit("melee", a);
  // actors first
  for (const t of W.actors) {
    if (t === a || !t.alive) continue;
    const dx = t.pos.x - a.pos.x, dz = t.pos.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < def.rangeM + 0.4 && Math.abs(t.pos.y - a.pos.y) < 2.2) {
      const dot = (dx / (d || 1)) * -Math.sin(a.yaw) + (dz / (d || 1)) * -Math.cos(a.yaw);
      if (dot > 0.5) { W.hurtActor(t, def.damage, a.id, "pickaxe", false); W.events.emit("hitMarker", a, t, def.damage, false); return; }
    }
  }
  // build pieces
  const bHit = W.buildRayHit && W.buildRayHit(eye, _d, def.rangeM + 1.2);
  if (bHit) { W.damageBuild(bHit.slotKey, def.damage * 2, a.id); W.events.emit("impact", bHit.point, "build"); return; }
  // harvestables
  const hx = eye.x + _d.x * 1.8, hz = eye.z + _d.z * 1.8;
  let best = null, bd = 9;
  for (const h of W.map.harvestables) {
    if (!h.alive) continue;
    const d = Math.hypot(h.pos.x - hx, h.pos.z - hz);
    if (d < 2.6 && d < bd) { best = h; bd = d; }
  }
  if (best) {
    const res = W.map.hitHarvestable(best.id, def.damage);
    if (best.mat && res.mats) {
      const inv = a.inventory;
      inv.mats[best.mat] = Math.min(K.BUILD.matCap, (inv.mats[best.mat] || 0) + res.mats);
      W.events.emit("harvested", a, best, res.mats, res.destroyed);
    }
  }
}

// ── projectiles ──────────────────────────────────────────────────────────────
function spawnProjectile(W, o) {
  const p = POOL.pop() || {};
  Object.assign(p, o);
  p.dead = false;
  if (o.mesh && !p.m) {
    p.m = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), new THREE.MeshStandardMaterial({ color: 0x3d5a3a }));
  }
  if (o.weaponId === "rocket" && !p.m) {
    p.m = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.4, 6), new THREE.MeshStandardMaterial({ color: 0x666666, emissive: 0xff4400, emissiveIntensity: 0.6 }));
  }
  if (p.m) { p.m.visible = true; W.group("projectiles").add(p.m); }
  projectiles.push(p);
  W.events.emit("tracer", p);
}

function stepProjectiles(W, dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.tLeft -= dt;
    if (p.tLeft <= 0) {
      if (p.weaponId === "grenade") explode(W, p.x, p.y, p.z, "grenade", p.rarity, p.ownerId);
      kill(W, i, p);
      continue;
    }
    // sub-steps so fast bullets don't tunnel
    const speed = Math.hypot(p.vx, p.vy, p.vz);
    const steps = Math.max(1, Math.min(8, Math.ceil((speed * dt) / 2.5)));
    let hit = false;
    for (let s = 0; s < steps && !hit; s++) {
      const h = dt / steps;
      p.vy += (p.gravity || 0) * h;
      const nx = p.x + p.vx * h, ny = p.y + p.vy * h, nz = p.z + p.vz * h;
      hit = testSegment(W, p, p.x, p.y, p.z, nx, ny, nz);
      if (!hit) { p.x = nx; p.y = ny; p.z = nz; }
    }
    if (p.m && !p.dead) p.m.position.set(p.x, p.y, p.z);
    if (hit || p.dead) kill(W, i, p);
  }
}

function kill(W, i, p) {
  if (p.m) { W.group("projectiles").remove(p.m); }
  projectiles.splice(i, 1);
  POOL.push(p);
}

function testSegment(W, p, ax, ay, az, bx, by, bz) {
  // 1) build pieces
  if (W.buildSegmentHit) {
    const bh = W.buildSegmentHit(ax, ay, az, bx, by, bz);
    if (bh) {
      if (p.splash) { explode(W, bh.x, bh.y, bh.z, p.weaponId, p.rarity, p.ownerId); p.dead = true; return true; }
      if (p.bounce) { bounceOff(p, bh.nx || 0, bh.ny || 1, bh.nz || 0); return false; }
      const def = K.WEAPONS[p.weaponId];
      const dmg = K.hitDamage(p.weaponId, p.rarity, 0, false) * (def && def.structMult || 1);
      W.damageBuild(bh.slotKey, dmg, p.ownerId);
      W.events.emit("impact", { x: bh.x, y: bh.y, z: bh.z }, "build");
      p.dead = true; return true;
    }
  }
  // 2) actors (capsule vs segment, coarse: sample closest point)
  for (const t of W.actors) {
    if (!t.alive || t.id === p.ownerId) continue;
    const feetY = t.pos.y, headY = t.pos.y + (t.crouching ? K.PLAYERK.crouchHeight : K.PLAYERK.height);
    // closest point of segment to vertical axis of capsule
    const cx = t.pos.x, cz = t.pos.z;
    const dx = bx - ax, dz = bz - az;
    const len2 = dx * dx + dz * dz;
    let u = len2 > 0 ? (((cx - ax) * dx) + ((cz - az) * dz)) / len2 : 0;
    u = K.clamp(u, 0, 1);
    const px = ax + dx * u, pz = az + dz * u, py = ay + (by - ay) * u;
    const dh = Math.hypot(px - cx, pz - cz);
    if (dh < K.PLAYERK.radius + 0.12 && py > feetY - 0.05 && py < headY + 0.12) {
      if (p.splash) { explode(W, px, py, pz, p.weaponId, p.rarity, p.ownerId); p.dead = true; return true; }
      const distFromOrigin = Math.hypot(px - p.origin.x, py - p.origin.y, pz - p.origin.z);
      const isHead = py > feetY + (headY - feetY) * 0.8;
      const dmg = K.hitDamage(p.weaponId, p.rarity, distFromOrigin, isHead);
      if (t.netRemote) {
        // remote-owned actor: its client (or the host, for bots) applies damage
        if (W.reportRemoteHit) W.reportRemoteHit(t, dmg, p.weaponId, isHead);
      } else {
        W.hurtActor(t, dmg, p.ownerId, p.weaponId, isHead);
      }
      const owner = W.actorById.get(p.ownerId);
      if (owner && !owner.isBot) W.stats.shotsHit++;
      if (owner) W.events.emit("hitMarker", owner, t, dmg, isHead);
      W.events.emit("impact", { x: px, y: py, z: pz }, "flesh");
      p.dead = true; return true;
    }
  }
  // 3) static world boxes
  const cols = W.map.queryColliders(bx, bz, 0.4);
  for (const c of cols) {
    if (c.kind !== "box") continue;
    if (bx > c.minX && bx < c.maxX && by > c.minY && by < c.maxY && bz > c.minZ && bz < c.maxZ) {
      if (p.splash) { explode(W, bx, by, bz, p.weaponId, p.rarity, p.ownerId); p.dead = true; return true; }
      if (p.bounce) { bounceOff(p, 0, 1, 0); return false; }
      W.events.emit("impact", { x: bx, y: by, z: bz }, "stone");
      p.dead = true; return true;
    }
  }
  // 4) terrain
  const th = W.map.heightAt(bx, bz);
  if (by <= th) {
    if (p.splash && !p.bounce) { explode(W, bx, th + 0.1, bz, p.weaponId, p.rarity, p.ownerId); p.dead = true; return true; }
    if (p.bounce) {
      // approximate normal from height gradient
      const e = 0.6;
      const nx2 = W.map.heightAt(bx - e, bz) - W.map.heightAt(bx + e, bz);
      const nz2 = W.map.heightAt(bx, bz - e) - W.map.heightAt(bx, bz + e);
      const n = new THREE.Vector3(nx2, 2 * e, nz2).normalize();
      bounceOff(p, n.x, n.y, n.z);
      p.y = th + 0.12;
      return false;
    }
    W.events.emit("impact", { x: bx, y: th, z: bz }, "dirt");
    p.dead = true; return true;
  }
  return false;
}

function bounceOff(p, nx, ny, nz) {
  const dot = p.vx * nx + p.vy * ny + p.vz * nz;
  p.vx = (p.vx - 2 * dot * nx) * 0.45;
  p.vy = (p.vy - 2 * dot * ny) * 0.45;
  p.vz = (p.vz - 2 * dot * nz) * 0.45;
}

// ── explosions ───────────────────────────────────────────────────────────────
function explode(W, x, y, z, weaponId, rarity, ownerId) {
  const def = K.WEAPONS[weaponId] || K.WEAPONS.grenade;
  const R = def.splashR || 4;
  for (const t of W.actors) {
    if (!t.alive) continue;
    const d = Math.hypot(t.pos.x - x, (t.pos.y + 0.9) - y, t.pos.z - z);
    const k = K.splashScale(d, R + 0.8);
    if (k > 0) {
      const dmg = Math.round(K.hitDamage(weaponId, rarity, 0, false) * k);
      W.hurtActor(t, dmg, ownerId === t.id ? null : ownerId, weaponId, false);
      // knockback
      const kb = 7 * k;
      const dl = Math.max(0.1, d);
      t.vel.x += ((t.pos.x - x) / dl) * kb;
      t.vel.y += 4 * k;
      t.vel.z += ((t.pos.z - z) / dl) * kb;
      t.onGround = false;
    }
  }
  // structures in radius
  if (W.buildInRadius) {
    for (const sk of W.buildInRadius(x, y, z, R)) {
      if (def.breaksAll) W.destroyBuild(sk);
      else W.damageBuild(sk, K.hitDamage(weaponId, rarity, 0, false), ownerId);
    }
  }
  W.events.emit("explosion", { x, y, z }, R);
}
