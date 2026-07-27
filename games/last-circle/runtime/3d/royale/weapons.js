/**
 * royale/weapons.js — the 6-gun BR arsenal: pistol, SMG, AR, shotgun, sniper,
 * grenade launcher. Firing, projectiles, recoil, reload, splash.
 *
 * Projectiles are REAL (position + velocity), stepped in
 * segments each frame and tested against static world boxes → terrain → actor
 * capsules — nearest hit wins. "Hitscan-fast" weapons are just very fast
 * projectiles, so travel time comes free for the sniper. Bullets fly FLAT:
 * no weapon definition ever carried a `gravity` field, so the drop this header
 * used to promise was never actually simulated. Only the grenade launcher arcs,
 * lobbing shells that burst on a body hit or after a short fuse.
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
      // Same Meshy export defect the characters had (see player.js): metallicFactor
      // is omitted, and glTF 2.0 defaults an absent metallicFactor to 1.0. A gun at
      // metalness 1 / roughness 1 with no scene.environment has no diffuse term AND
      // nothing to reflect, so it renders as a near-black silhouette in the hand
      // instead of a readable weapon. Verified on the live build: every weapon
      // material under RightHand reported metalness 1, roughness 1, colour #ffffff.
      m.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (mat.metalness === 1) mat.metalness = 0.35;   // gunmetal, not mirror
          if (mat.roughness === 1) mat.roughness = 0.55;
          if (mat.emissiveMap) { mat.emissiveMap = null; if (mat.emissive) mat.emissive.setHex(0x000000); }
          mat.needsUpdate = true;
        }
      });
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
  // Swapping used to hand back a weapon with cd: 0, so tap-2-tap-1 cancelled the
  // fire-rate timer and double-pumped the shotgun. Each slot remembers its own
  // remaining cooldown, and the incoming weapon also inherits whatever the
  // outgoing one still owed — you cannot dodge a timer by swapping off it.
  const prev = a.weapon;
  if (prev && prev.slotRef) prev.slotRef.cd = Math.max(0, prev.cd || 0);
  const carry = prev ? Math.max(0, prev.cd || 0) : 0;
  const startCd = Math.max(carry, Math.max(0, slot.cd || 0));
  inv.active = idx;
  if (slot.kind === "weapon") {
    a.weapon = { id: slot.id, rarity: slot.rarity || 0, magAmmo: slot.mag != null ? slot.mag : 0, state: "ready", cd: startCd, reloadT: 0, slotRef: slot };
  } else {
    a.weapon = { id: "consumable:" + slot.id, rarity: 0, magAmmo: 0, state: "ready", cd: startCd, reloadT: 0, slotRef: slot };
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
  return { x: a.pos.x, y: a.pos.y + (a.swimming ? 0.7 : K.actorEyeY(a)), z: a.pos.z };
}
export function aimDir(a, out) {
  const sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
  const sp = Math.sin(a.pitch), cp = Math.cos(a.pitch);
  out = out || _dir;
  out.set(-sy * cp, sp, -cy * cp);
  return out;
}

// ── update loop ──────────────────────────────────────────────────────────────
/** Drop every live round back into the pool. The projectile list is
 *  module-level, so without this rounds fired in one match kept flying in the
 *  next one — and their meshes stayed parented to a cleared group. */
export function reset(W) {
  for (const p of projectiles) {
    if (p.m && p.m.parent) p.m.parent.remove(p.m);
    p.dead = true;
    POOL.push(p);
  }
  projectiles.length = 0;
}

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
    // VIEW-MODEL punch. refreshWeaponMesh (weapons.js:217) parents a static
    // proto.clone() to the hand and never touches it again, so the gun itself
    // never moved when it fired. Local units under a.hand are metres — the hand
    // group divides out the bone's world scale (player.js:257-259) — so this is
    // a 5 cm slide back down the barrel axis (+Z is barrel-forward, weapons.js:56).
    // A camera-PITCH kick is deliberately not used: crosshairPoint derives the
    // human's aim ray from the camera direction (weapons.js:353-357), so pitching
    // the camera moves the shots — it would be a second aim recoil, not a visual.
    if (a.vmKick > 0) {
      a.vmKick = Math.max(0, a.vmKick - dt * 6);
      if (a.weaponMesh) a.weaponMesh.position.z = -a.vmKick * 0.05;
    }
  }
  stepProjectiles(W, dt);
}

function stepWeapon(W, a, dt) {
  const inp = a.input;
  // Slot switching runs FIRST. It used to run after `const wpn = a.weapon`, so
  // for the rest of that frame every read (def, cd, magAmmo, state) came from
  // the OUTGOING weapon object while fire() stamped the INCOMING id and rarity
  // onto the projectile: swapping shotgun -> sniper on a live trigger spawned
  // 9 pellets each resolving as sniper damage, and the outgoing object's ammo
  // decrement was written to an orphan.
  if (inp.slot >= 0) { equipSlot(W, a, inp.slot); inp.slot = -1; }
  const wpn = a.weapon;
  if (!wpn) return;

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
  // invariant: the definition driving pellets/spread must describe the weapon
  // whose id fire() stamps on the projectile (see the swap bug above)
  if (def !== K.WEAPONS[a.weapon.id]) { console.warn("[weapons] def/weapon mismatch", wpn.id, a.weapon.id); return; }
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

  // firing — no shooting while gliding, healing, or swimming (weapon's wet).
  // AUTO weapons (SMG/AR) fire while the trigger is HELD; SEMI weapons (pistol/
  // shotgun/sniper/launcher) fire once per CLICK. The human input is rebuilt from
  // the live button every frame, so a held-state guard (inp.fire=false) is
  // overwritten next frame → auto-cycle. Gate semi weapons on the mousedown EDGE
  // (W._fireEdge, set on click, cleared on release/consume) so one click = one shot.
  const isAuto = def.cls === "smg" || def.cls === "ar";
  const wantFire = (a.isBot || isAuto) ? inp.fire : !!W._fireEdge;
  if (wantFire && wpn.cd <= 0 && !a.gliding && !a.healing && !a.swimming) {
    if (def.mag > 0 && wpn.magAmmo <= 0) {
      // auto reload attempt
      if (a.inventory.ammo[def.ammo] > 0) { inp.reload = true; }
      else W.events.emit("dryFire", a);
      wpn.cd = 0.25;
      if (!a.isBot && !isAuto) W._fireEdge = false;   // the click is spent even on a dry trigger
      return;
    }
    fire(W, a, def);
    wpn.magAmmo--;
    if (wpn.slotRef) wpn.slotRef.mag = wpn.magAmmo;
    wpn.cd = 60 / def.rpm;
    if (!a.isBot && !isAuto) W._fireEdge = false;      // one shot per click for semi weapons
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
    if (py < t.pos.y - 0.1 || py > t.pos.y + W.SIM.actorHeight(t) + 0.15) continue;
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
  // spread: one shared model (sim.effectiveSpread) so the crosshair can draw the
  // SAME number this fires with — it used to guess with a cruder formula
  const spread = K.effectiveSpread(a.weapon.id, a.weapon.rarity, {
    ads: !!a.input.ads,
    speed: Math.hypot(a.vel.x, a.vel.z),
    airborne: !a.onGround,
    crouching: !!a.crouching,
    sinceLastShotS: W.t - a.lastShotT,
  });

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
      // only the launcher arcs. The old `def.gravity ? -9.8 : 0` fallback was
      // dead code — none of the six WEAPONS entries in sim/royale.js has a
      // gravity key, so it always resolved to 0 and bullets were always flat.
      gravity: def.arc ? -18 : 0,
      tLeft: def.arc ? def.fuseS : 3.5,
      splash: def.splashR || 0, bounce: !!def.arc, mesh: !!def.arc,
      origin: { x: eye.x, y: eye.y, z: eye.z },
    });
  }
  a.vmKick = 1;   // view-model punch, all actors — a bot's gun is on screen too
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
  // muzzle world position from the held weapon (right-hand bone) so the flash
  // erupts at the BARREL, not the eye/body-centre (the third-person "fire from
  // the face" issue). Physics/aim stay eye-based; only the FX origin moves.
  let muzzle = eye;
  if (a.hand) {
    a.hand.updateWorldMatrix(true, false);
    const m = a.hand.matrixWorld.elements;
    const bl = { pistol: 0.5, smg: 0.7, ar: 0.95, shotgun: 0.85, sniper: 1.15, glauncher: 0.8 }[a.weapon.id] || 0.8;
    muzzle = { x: m[12] + _d.x * bl, y: m[13] + _d.y * bl, z: m[14] + _d.z * bl };
  }
  W.events.emit("shotFired", a, a.weapon.id, muzzle, _d.clone());
}

// ── projectiles ──────────────────────────────────────────────────────────────
const _whizPt = { x: 0, y: 0, z: 0 };
/** distance from point c to segment a->b, writing the closest point to out */
function segPointDist(ax, ay, az, bx, by, bz, cx, cy, cz, out) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const l2 = dx * dx + dy * dy + dz * dz;
  let t = l2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = ax + dx * t; out.y = ay + dy * t; out.z = az + dz * t;
  return Math.hypot(out.x - cx, out.y - cy, out.z - cz);
}

function spawnProjectile(W, o) {
  const p = POOL.pop() || {};
  Object.assign(p, o);
  p.dead = false;
  // POOL entries are recycled through the Object.assign above, which does NOT
  // clear fields the new spawn object omits — a stale `true` here would mute
  // the whiz-by on every reused round.
  p.whizzed = false;
  if (o.mesh && !p.m) {
    // grenade-launcher shell: visible arcing round with a hot tracer tint
    p.m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 6, 6), new THREE.MeshStandardMaterial({ color: 0x3d5a3a, emissive: 0xff6622, emissiveIntensity: 0.4 }));
  }
  // Only SHOW the mesh when THIS spawn is a mesh projectile. kill() removes p.m
  // from the scene but keeps it on the pooled object for the next grenade to
  // reuse — so a plain hitscan bullet popping that same pool slot used to re-add
  // the grenade sphere and drag it across the map. Gate on o.mesh, and hide a
  // cached mesh the current spawn does not want.
  if (p.m) {
    if (o.mesh) { p.m.visible = true; W.group("projectiles").add(p.m); }
    else { p.m.visible = false; }
  }
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
    const sx = p.x, sy = p.y, sz = p.z;
    let hit = false;
    for (let s = 0; s < steps && !hit; s++) {
      const h = dt / steps;
      p.vy += (p.gravity || 0) * h;
      const nx = p.x + p.vx * h, ny = p.y + p.vy * h, nz = p.z + p.vz * h;
      hit = testSegment(W, p, p.x, p.y, p.z, nx, ny, nz);
      if (!hit) { p.x = nx; p.y = ny; p.z = nz; }
    }
    // Whiz-by: a round passing close is the ONLY cue that you are under fire —
    // the impact tick tells you where it LANDED (audio.js: dirt 0.06 gain at
    // 45 m, stone/wood 0.07 at 55 m) and a round into open air said nothing at
    // all, so sniper fire read as "I died" rather than "someone is shooting
    // from my left". Tested once per frame against the whole step segment, not
    // per sub-step, so a 999 m/s round costs one distance calc; only for rounds
    // you did not fire.
    if (!p.dead && !p.whizzed && W.player && W.player.alive && p.ownerId !== W.player.id) {
      const c = W.camera.position;
      const miss = segPointDist(sx, sy, sz, p.x, p.y, p.z, c.x, c.y, c.z, _whizPt);
      if (miss < 3.5) { p.whizzed = true; W.events.emit("whizBy", { x: _whizPt.x, y: _whizPt.y, z: _whizPt.z }, miss); }
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
    const feetY = t.pos.y, headY = t.pos.y + (t.swimming ? 0.9 : K.actorHeight(t));
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
      // The 2.5x head zone used to be the ENTIRE body cylinder above 0.8 height:
      // dh was never re-tested, so a 1.14 m wide disc (radius 0.45 + 0.12 slop)
      // paid headshot damage on a rig whose shoulders are ~0.5 m across — a
      // sniper round passing half a metre clear of the model still dealt
      // 105 * 2.5 = 263 and one-shot a full 100 shield + 100 HP bar. Body
      // registration on the line above is deliberately left as forgiving as it
      // was; only the multiplier tightens, to a 0.4 m band in the top 14%.
      const isHead = py > feetY + (headY - feetY) * 0.86 && dh < 0.2;
      const dmg = K.hitDamage(p.weaponId, p.rarity, distFromOrigin, isHead);
      if (t.netRemote && !t.isDummy) {
        // remote-owned actor: its client (or the host, for bots) applies damage.
        // The owner id has to ride along: without it net.js stamped every hit as
        // `attacker: W.player.id`, so a host-simulated BOT's kill showed up on the
        // guest as the host eliminating them (wrong kill-feed name, wrong death-cam
        // spectate target, inflated host kill count on every other screen).
        if (W.reportRemoteHit) W.reportRemoteHit(t, dmg, p.weaponId, isHead, p.ownerId);
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
  // 2) static world: SWEPT segment vs colliders.
  // This used to test only whether the sub-step's END POINT landed inside a box.
  // Sub-steps run up to 2.5 m, so a 0.32 m wall was missed ~87% of the time, and
  // ramps (kind !== "box") were skipped entirely — cover did not stop bullets.
  // Query along the WHOLE segment, not just around the endpoint, or a wall
  // crossed mid-step is never even a candidate.
  const midX = (ax + bx) / 2, midZ = (az + bz) / 2;
  const halfLen = Math.hypot(bx - ax, bz - az) / 2;
  const cols = W.map.queryColliders(midX, midZ, halfLen + 0.6);
  const sh = K.segmentColliders(ax, ay, az, bx, by, bz, cols);
  if (sh) {
    const c = sh.c;
    // impact at the ENTRY point on the face, not the overshot endpoint
    const hx = ax + (bx - ax) * sh.t, hy = ay + (by - ay) * sh.t, hz = az + (bz - az) * sh.t;
    if (p.splash && !p.bounce) { explode(W, hx, hy, hz, p.weaponId, p.rarity, p.ownerId); p.dead = true; return true; }
    if (p.bounce) {
      // reflect off the face we actually entered through (the old code derived
      // the normal from the overshot endpoint's smallest penetration axis)
      let nx = sh.nx, ny = sh.ny, nz = sh.nz;
      if (!nx && !ny && !nz) ny = 1;                 // started inside: shove it up
      p.x = hx + nx * 0.06; p.y = hy + ny * 0.06; p.z = hz + nz * 0.06;
      bounceOff(p, nx, ny, nz);
      return false;
    }
    // destructible prop (barrel/tree): a direct hit chips its hp; barrels detonate
    // on any hit, trees drop once their hp is gone (then the collider is removed).
    if (c.prop && c.hp > 0 && W.map.destroyProp) {
      const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
      c.hp -= K.hitDamage(p.weaponId, p.rarity, 0, false);
      if (c.prop === "barrel") {
        W.map.destroyProp(c);
        explode(W, cx, c.minY + 0.8, cz, "glauncher", 0, p.ownerId);   // barrel blows up (splash + knockback)
      } else if (c.hp <= 0) {
        W.map.destroyProp(c);
        W.events.emit("propBreak", { x: cx, y: c.minY, z: cz, kind: c.prop });
      } else {
        W.events.emit("impact", { x: hx, y: hy, z: hz }, "wood");
      }
      p.dead = true; return true;
    }
    W.events.emit("impact", { x: hx, y: hy, z: hz }, "stone");
    p.dead = true; return true;
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
function explode(W, x, y, z, weaponId, rarity, ownerId, depth) {
  depth = depth || 0;
  const def = K.WEAPONS[weaponId] || K.WEAPONS.glauncher;
  const R = def.splashR || 3.5;
  for (const t of W.actors) {
    if (!t.alive) continue;
    const d = Math.hypot(t.pos.x - x, (t.pos.y + 0.9) - y, t.pos.z - z);
    const k = K.splashScale(d, R + 0.8);
    if (k > 0) {
      const dmg = Math.round(K.hitDamage(weaponId, rarity, 0, false) * k);
      if (t.netRemote && !t.isDummy) {
        // remote-owned actor: its own client is authoritative over its HP — route
        // splash through the same path as direct hits so it isn't double-counted.
        // ownerId travels with it for the same attribution reason as the direct-hit
        // site above (host bots were credited to the host).
        if (W.reportRemoteHit) W.reportRemoteHit(t, dmg, weaponId, false, ownerId);
      } else {
        W.hurtActor(t, dmg, ownerId === t.id ? null : ownerId, weaponId, false);
      }
      // knockback (cosmetic; remote actors are corrected by the next net snapshot)
      const kb = 7 * k;
      const dl = Math.max(0.1, d);
      t.vel.x += ((t.pos.x - x) / dl) * kb;
      t.vel.y += 4 * k;
      t.vel.z += ((t.pos.z - z) / dl) * kb;
      t.onGround = false;
    }
  }
  // environment: level nearby trees, detonate nearby barrels (chain reaction, depth-capped)
  if (W.map.destroyProp && W.map.queryColliders) {
    const near = W.map.queryColliders(x, z, R + 1.5);
    for (const c of near) {
      if (c.dead || !c.prop || !c.hp) continue;
      const cx = (c.minX + c.maxX) / 2, cy = (c.minY + c.maxY) / 2, cz = (c.minZ + c.maxZ) / 2;
      if (Math.hypot(cx - x, cy - y, cz - z) > R + 1.2) continue;
      W.map.destroyProp(c);
      if (c.prop === "barrel" && depth < 3) explode(W, cx, cy, cz, "glauncher", 0, ownerId, depth + 1);
      else W.events.emit("propBreak", { x: cx, y: c.minY, z: cz, kind: c.prop });
    }
  }
  W.events.emit("explosion", { x, y, z }, R);
}
