/**
 * royale/weapons.js — the 6-gun BR arsenal: pistol, SMG, AR, shotgun, sniper,
 * grenade launcher. Firing, projectiles, recoil, reload, splash.
 *
 * Projectiles are REAL (position + velocity + optional gravity), stepped in
 * segments each frame and tested against static world boxes → terrain → actor
 * capsules — nearest hit wins. "Hitscan-fast" weapons are just very fast
 * projectiles, so travel time and drop come free for sniper; the grenade
 * launcher lobs arcing shells that burst on a body hit or after a short fuse.
 *
 * No firing while swimming (industry standard). No melee, no throwables, no
 * building — this is a pure BR shooter.
 *
 * View models: pistol/shotgun are real GLBs; AR/SMG/sniper/grenade launcher
 * are multi-part composed low-poly builds (distinct silhouettes per class).
 */
import * as THREE from "three";

let K = null;
const projectiles = [];
const POOL = [];
let protosPromise = null;

export function init(W) {
  K = W.SIM;
  W.equipSlot = (a, idx) => equipSlot(W, a, idx);
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
  protos.glauncher = mk([
    { cyl: [0.075, 0.55], p: [0, 0, 0.2], c: 0x4d5a3a },        // barrel tube
    { cyl: [0.11, 0.22], p: [0, -0.02, -0.08], c: ACC },        // revolver drum
    { s: [0.06, 0.16, 0.12], p: [0, -0.16, -0.18], c: DARK },   // grip
    { s: [0.07, 0.1, 0.24], p: [0, -0.04, -0.34], c: 0x3d4a30 },// stock
    { s: [0.05, 0.08, 0.06], p: [0, 0.12, 0.05], c: ACC },      // sight
  ]);
  // GLB models
  const base = W.assetBase + "assets/props/";
  for (const [id, file, len] of [["pistol", "wpn-pistol.glb", 0.34], ["shotgun", "wpn-shotgun.glb", 0.8]]) {
    try {
      const m = await W.kernel.loadGLTF(base + file);
      const bbox = new THREE.Box3().setFromObject(m);
      const size = bbox.getSize(new THREE.Vector3());
      const s = len / Math.max(size.x, size.y, size.z, 0.001);
      m.scale.setScalar(s);
      const c = bbox.getCenter(new THREE.Vector3()).multiplyScalar(s);
      m.position.sub(c);
      const g = new THREE.Group(); g.add(m);
      m.rotation.y = Math.PI / 2; // barrels forward
      protos[id] = g;
    } catch (e) { console.warn("[weapons] GLB fail", id, e); protos[id] = protos.smg.clone(); }
  }

  // MESHY AI weapons override everything above when present (owner direction:
  // all assets generated). Prompted as "horizontal side view" → longest axis
  // = barrel axis; rotate barrel to +Z, sights up.
  const WPN_LEN = { pistol: 0.34, smg: 0.5, ar: 0.62, shotgun: 0.8, sniper: 0.95, glauncher: 0.7 };
  for (const id of Object.keys(WPN_LEN)) {
    try {
      const m = await W.kernel.loadGLTF(base + "meshy_wpn/wpn_" + id + ".glb");
      // Meshy sometimes renders the "side view" at a 3/4 angle → barrel sits
      // diagonal in XZ. Search the yaw that minimizes cross-width so the
      // barrel lands exactly on +Z (sights stay up: rotate around Y only).
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
      // If the front (+Z) third holds more verts than the back, flip.
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
      const size = bb.setFromObject(m).getSize(new THREE.Vector3());
      const s = WPN_LEN[id] / Math.max(size.x, size.y, size.z, 0.001);
      m.scale.setScalar(s);
      m.updateMatrixWorld(true);
      // GRIP ANCHOR (data-driven, like the Claudecraft "grip y" metadata):
      // the handle is the dense cluster in the bottom third — attach THAT to
      // the hand, not the geometric center, so the fist wraps the grip and the
      // barrel sticks out forward (centering made guns float mid-body).
      bb.setFromObject(m);
      const yLo = bb.min.y, yHi = bb.max.y, yBand = yLo + (yHi - yLo) * 0.34;
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
      if (gN) grip.multiplyScalar(1 / gN); else grip.copy(bb.getCenter(new THREE.Vector3()));
      // pistols/SMG: hand wraps at the grip cluster. Long guns: trigger hand
      // sits a touch forward of the rearmost grip so the stock clears the arm.
      grip.z += (WPN_LEN[id] > 0.55 ? 0.06 : 0.0);
      m.position.sub(grip);                 // grip → hand origin
      const g = new THREE.Group();
      g.add(m);
      protos[id] = g;
    } catch (e) { /* not generated yet — composed/GLB fallback stays */ }
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
  return { x: a.pos.x, y: a.pos.y + (a.swimming ? 0.7 : K.PLAYERK.eyeY), z: a.pos.z };
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
    // recoil recovery: re-center what the kicks added (~0.3s), leaving the
    // player's own mouse aim untouched
    if (a.recoilPitch > 0.0001) {
      const r = Math.min(a.recoilPitch, dt * 0.12);
      a.input.pitch = K.clamp(a.input.pitch - r, -1.35, 1.35);
      a.recoilPitch -= r;
    }
    if (a.recoilYaw && Math.abs(a.recoilYaw) > 0.0001) {
      const r = Math.sign(a.recoilYaw) * Math.min(Math.abs(a.recoilYaw), dt * 0.08);
      a.input.yaw -= r;
      a.recoilYaw -= r;
    }
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

  // firing — no shooting while gliding, healing, or swimming (weapon's wet)
  if (inp.fire && wpn.cd <= 0 && !a.gliding && !a.healing && !a.swimming) {
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

// ── firing ───────────────────────────────────────────────────────────────────
const _d = new THREE.Vector3(), _right = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const _camDir = new THREE.Vector3(), _camPt = new THREE.Vector3();

/** What is the crosshair actually ON? March the camera-forward ray against
 * actor capsules, terrain, and static colliders; return the first hit point
 * (or the 300m far point). The projectile then flies muzzle→this point, so
 * shots land EXACTLY where the reticle points — slopes, shoulders, parallax
 * all accounted for. (The old fixed-120m convergence missed uphill targets.) */
function crosshairPoint(W, shooter, out) {
  // aim ray: through the OS cursor when pointer lock is off (the reticle IS
  // the cursor), through screen center when locked
  if (W.mouseNDC && !(W.pointerLocked && W.pointerLocked())) {
    _camDir.set(W.mouseNDC.x, W.mouseNDC.y, 0.5).unproject(W.camera).sub(W.camera.position).normalize();
  } else {
    W.camera.getWorldDirection(_camDir);
  }
  const o = W.camera.position;
  const FAR = 300;
  let bestT = FAR;
  // actor capsules (closest approach of ray to vertical axis)
  for (const t of W.actors) {
    if (!t.alive || t === shooter) continue;
    const dx = t.pos.x - o.x, dz = t.pos.z - o.z;
    const denom = _camDir.x * _camDir.x + _camDir.z * _camDir.z;
    if (denom < 1e-6) continue;
    const u = (dx * _camDir.x + dz * _camDir.z) / denom;   // ray param of closest XZ approach
    if (u < 1 || u > bestT) continue;
    const px = o.x + _camDir.x * u, pz = o.z + _camDir.z * u, py = o.y + _camDir.y * u;
    const r = W.SIM.PLAYERK.radius + 0.15;
    if ((px - t.pos.x) ** 2 + (pz - t.pos.z) ** 2 > r * r) continue;
    if (py < t.pos.y - 0.1 || py > t.pos.y + W.SIM.PLAYERK.height + 0.15) continue;
    bestT = u;
  }
  // terrain + static boxes: coarse march (0.75m steps up to bestT)
  const step = 0.75;
  for (let d = 3; d < bestT; d += step) {
    const x = o.x + _camDir.x * d, y = o.y + _camDir.y * d, z = o.z + _camDir.z * d;
    if (W.map.heightAt(x, z) > y) { bestT = d; break; }
    let solid = false;
    for (const c of W.map.queryColliders(x, z, 0.3)) {
      if (c.kind === "box" && x > c.minX && x < c.maxX && y > c.minY && y < c.maxY && z > c.minZ && z < c.maxZ) { solid = true; break; }
    }
    if (solid) { bestT = d; break; }
  }
  return out.copy(o).addScaledVector(_camDir, bestT);
}

function fire(W, a, def) {
  const eye = eyePos(a);
  aimDir(a, _d);
  // HUMAN aim = wherever the crosshair visually points
  if (a === W.player) {
    crosshairPoint(W, a, _camPt);
    _d.set(_camPt.x - eye.x, _camPt.y - eye.y, _camPt.z - eye.z).normalize();
  }
  const pellets = def.pellets || 1;
  // spread: base × rarity × stance modifiers
  let spread = (def.spreadDeg || 1) * (K.RARITY_SPREAD_MULT[a.weapon.rarity] || 1);
  if (a.input.ads) spread *= 0.5;
  const movePen = Math.hypot(a.vel.x, a.vel.z) > 1 ? 1.4 : 1;
  const airPen = a.onGround ? 1 : 2;
  spread *= movePen * airPen;
  // FIRST-SHOT ACCURACY (industry standard): a deliberate single shot while
  // standing goes exactly where the crosshair points — no bloom lottery
  if (def.cls !== "shotgun" && a.onGround && movePen === 1 && W.t - a.lastShotT > 0.5) spread *= 0.15;

  for (let p = 0; p < pellets; p++) {
    const sr = (spread * Math.PI / 180);
    const ox = (Math.random() - 0.5) * 2 * sr, oy = (Math.random() - 0.5) * 2 * sr;
    _right.crossVectors(_d, _up).normalize();
    const dir = _d.clone().addScaledVector(_right, ox).addScaledVector(_up, oy).normalize();
    spawnProjectile(W, {
      x: eye.x + dir.x * 0.6, y: eye.y + dir.y * 0.6 - 0.05, z: eye.z + dir.z * 0.6,
      vx: dir.x * def.speed, vy: dir.y * def.speed + (def.arc ? 3 : 0), vz: dir.z * def.speed,
      weaponId: a.weapon.id,
      rarity: a.weapon.rarity, ownerId: a.id,
      gravity: def.arc ? -18 : def.gravity ? -9.8 : 0,
      tLeft: def.arc ? def.fuseS : 3.5,
      splash: def.splashR || 0, bounce: !!def.arc, mesh: !!def.arc,
      origin: { x: eye.x, y: eye.y, z: eye.z },
    });
  }
  // recoil kick (human only — bots model error separately). The kick is
  // tracked in recover-accumulators and re-centers over ~0.3s — permanent
  // kick made the crosshair CLIMB forever (aim drifted ~2m high after a few
  // shots: "my pistol doesn't work").
  if (!a.isBot) {
    const kick = { pistol: 0.008, smg: 0.006, ar: 0.011, shotgun: 0.03, sniper: 0.05, glauncher: 0.035 }[a.weapon.id] || 0.01;
    const yawKick = (Math.random() - 0.5) * kick * 0.6;
    a.input.pitch = K.clamp(a.input.pitch + kick, -1.35, 1.35);
    a.input.yaw += yawKick;
    a.recoilPitch = (a.recoilPitch || 0) + kick;
    a.recoilYaw = (a.recoilYaw || 0) + yawKick;
    W.stats.shotsFired += pellets;
  }
  a.lastShotT = W.t;
  W.events.emit("shotFired", a, a.weapon.id, eye, _d.clone());
}

// ── projectiles ──────────────────────────────────────────────────────────────
function spawnProjectile(W, o) {
  const p = POOL.pop() || {};
  Object.assign(p, o);
  p.dead = false;
  if (o.mesh && !p.m) {
    // grenade-launcher shell: visible arcing round with a hot tracer tint
    p.m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 6), new THREE.MeshStandardMaterial({ color: 0x3d5a3a, emissive: 0xff6622, emissiveIntensity: 0.4 }));
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
      if (p.splash) explode(W, p.x, p.y, p.z, p.weaponId, p.rarity, p.ownerId); // fused shells burst
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
  // 1) actors (capsule vs segment, coarse: sample closest point)
  for (const t of W.actors) {
    if (!t.alive || t.id === p.ownerId) continue;
    const feetY = t.pos.y, headY = t.pos.y + (t.swimming ? 0.9 : K.PLAYERK.height);
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
  // 2) static world boxes
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
  // 3) terrain
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
  const def = K.WEAPONS[weaponId] || K.WEAPONS.glauncher;
  const R = def.splashR || 3.5;
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
  W.events.emit("explosion", { x, y, z }, R);
}
