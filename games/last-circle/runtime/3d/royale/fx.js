/**
 * royale/fx.js — particles, tracers, damage numbers, camera shake.
 *
 * One InstancedMesh pool of chunky low-poly cubes (single draw call) drives
 * every burst: muzzle flash, impacts, explosions, build debris, harvest chips,
 * storm sparkles. Tracers are elongated instances of the same pool. Damage
 * numbers are DOM elements projected from world space (crisp text, no canvas
 * blur — the shroud-font lesson).
 */
import * as THREE from "three";

const N = 1024;
const parts = [];         // {alive, pos, vel, life, life0, size, gravity, drag, stretch(dir)}
let inst = null;
const dummy = new THREE.Object3D();
const noRot = new THREE.Quaternion();
// tracer stretch axis — hoisted because the update loop used to build a fresh
// Vector3(0,0,1) for EVERY live tracer EVERY frame, straight into the GC
const _Z = new THREE.Vector3(0, 0, 1);
let dmgLayer = null;

export function init(W) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ toneMapped: false });
  inst = new THREE.InstancedMesh(geo, mat, N);
  inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3);
  inst.count = N;
  inst.frustumCulled = false;
  for (let i = 0; i < N; i++) {
    parts.push({ alive: false, pos: new THREE.Vector3(), vel: new THREE.Vector3(), life: 0, life0: 1, size: 0.1, gravity: 0, drag: 0, dir: null });
    dummy.position.set(0, -9999, 0); dummy.scale.setScalar(0.0001); dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  W.group("fx").add(inst);
  W.camShake = 0;

  // DOM damage-number layer
  dmgLayer = document.createElement("div");
  Object.assign(dmgLayer.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden", zIndex: 30 });
  W.kernel.parent.appendChild(dmgLayer);

  wireEvents(W);
}

let cursor = 0;
function spawn(o) {
  // The slot index IS the pre-bump cursor. This used to be `parts.indexOf(p)`,
  // a 1024-entry linear scan to recover an index we were already holding — a
  // 26-particle explosion paid 26 of them. Capture BEFORE the bump: reading
  // cursor after it would colour the next slot instead of this one.
  const i = cursor;
  const p = parts[cursor];
  cursor = (cursor + 1) % N;
  p.alive = true;
  p.pos.set(o.x, o.y, o.z);
  p.vel.set(o.vx || 0, o.vy || 0, o.vz || 0);
  p.life = p.life0 = o.life || 0.6;
  p.size = o.size || 0.12;
  p.gravity = o.gravity != null ? o.gravity : -9;
  p.drag = o.drag != null ? o.drag : 0.5;
  p.dir = o.dir || null;      // stretch along dir (tracers)
  p.stretch = o.stretch || 0;
  p.idx = i;
  const c = new THREE.Color(o.color != null ? o.color : 0xffcc66);
  inst.instanceColor.setXYZ(i, c.r, c.g, c.b);
  inst.instanceColor.needsUpdate = true;
}

function burst(o) {
  const n = o.n || 8;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * Math.PI;
    const s = (o.speed || 5) * (0.4 + Math.random() * 0.8);
    spawn({
      x: o.x, y: o.y, z: o.z,
      vx: Math.cos(a) * Math.cos(e) * s, vy: Math.sin(e) * s + (o.up || 2), vz: Math.sin(a) * Math.cos(e) * s,
      color: Array.isArray(o.color) ? o.color[i % o.color.length] : o.color,
      size: (o.size || 0.12) * (0.6 + Math.random() * 0.9),
      life: (o.life || 0.7) * (0.6 + Math.random() * 0.8),
      gravity: o.gravity, drag: o.drag,
    });
  }
}

// ── event wiring ─────────────────────────────────────────────────────────────
// Per-weapon firing kick. Firing had NO physical feedback at all: `camShake =`
// existed in exactly two places in this file (explosion, player-hurt) and neither
// is your own gun, so at the SMG's 720 rpm you pulled a trigger every 83 ms and
// nothing on screen moved. Magnitudes track the audio gains, and the 1.8/s decay
// keeps every one of them SHORTER than that weapon's own fire interval (smg 25 ms
// vs 83 ms, ar 39 ms vs 182 ms, sniper 144 ms vs 1714 ms), so sustained fire
// punches instead of accumulating into a permanent wobble.
const SHOT_SHAKE = { pistol: 0.06, smg: 0.045, ar: 0.07, shotgun: 0.20, sniper: 0.26, glauncher: 0.18 };
const SHOT_FOV   = { pistol: 2, smg: 2, ar: 2.5, shotgun: 5, sniper: 5, glauncher: 4.5 };

// Explosion flash. A 95-damage launcher round with a 3.5 m splash resolved as 40
// cubes and a low-passed thump. A real PointLight would force a shader recompile
// across every material in the scene on the first blast (a visible hitch on a
// browser GPU) — at the match bloom of 0.14 an additive sprite reads as a flash
// for free. loot.js builds its chest glow the same way.
let flashTex = null, blastCursor = 0;
const blasts = [];
function ensureBlasts(W) {
  if (blasts.length) return;
  const cv = document.createElement("canvas"); cv.width = cv.height = 128;
  const c2 = cv.getContext("2d");
  const gr = c2.createRadialGradient(64, 64, 2, 64, 64, 62);
  gr.addColorStop(0, "rgba(255,255,235,1)");
  gr.addColorStop(0.35, "rgba(255,190,90,0.55)");
  gr.addColorStop(1, "rgba(255,120,30,0)");
  c2.fillStyle = gr; c2.fillRect(0, 0, 128, 128);
  flashTex = new THREE.CanvasTexture(cv); flashTex.colorSpace = THREE.SRGBColorSpace;
  // RingGeometry lies in XY, so rotation.x = -PI/2 is what lays the shockwave
  // flat on the ground; its outer radius is 1, so the scale IS the world radius.
  const rg = new THREE.RingGeometry(0.82, 1, 28);
  for (let i = 0; i < 4; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false }));
    const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color: 0xffb060, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    sp.visible = false; ring.visible = false;
    blasts.push({ sp, ring, t: 99, R: 3.5 });
  }
}

// Enemies never reacted to being hit: 4 cubes at size 0.08 and a floating number,
// nothing on the body itself. Two traps here, both already paid for in player.js.
//   * NOT emissive — player.js records that Meshy's emissiveMap was
//     deliberately stripped (it re-added albedo through an unlit path and made
//     every actor fullbright in shade); raising it back is that bug renamed.
//   * NOT a lerp toward white — player.js multiplies each actor's base
//     colour by BODY_GAIN 3.2, so channels sit around 1.6-2.9 and blending toward
//     (1,1,1) would DARKEN the model. Scale the saved colour UP instead.
// Safe per-actor because player.js clones every source material into a
// per-actor Map, so writing .color on one actor cannot tint another wearing the
// same skin. Colour split (shield blue / health red) is the one the particles use.
const FLASH_S = 0.07;
const flashing = [];
function flashActor(a, toShield) {
  if (!a || !a.rig || !a.rig.scene) return;
  if (!a._flashMats) {
    const seen = new Set(); a._flashMats = [];
    a.rig.scene.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh) || !o.material || !o.material.color || seen.has(o.material)) return;
      seen.add(o.material);
      // player.js's zone-tint shader divides material.color back out, so writing
      // .color here changed nothing at all — the flash shipped invisible on 100%
      // of actors. Tinted materials expose userData.zFlash; drive that uniform
      // and keep the .color path only for meshes that have no zone tint.
      a._flashMats.push({ m: o.material, c: o.material.color.clone(),
                          u: (o.material.userData && o.material.userData.zFlash) || null });
    });
  }
  if (!a._flashMats.length) return;
  a._flashT = FLASH_S; a._flashShield = !!toShield;
  if (flashing.indexOf(a) < 0) flashing.push(a);
}

function wireEvents(W) {
  W.events.on("shotFired", (a, weaponId, muzzle, dir) => {
    // muzzle flash at the BARREL (weapons.js now passes the weapon muzzle world
    // position, not the eye) — bright and chunky enough to register at gameplay FOV
    const mx = muzzle.x + dir.x * 0.12, my = muzzle.y + dir.y * 0.12, mz = muzzle.z + dir.z * 0.12;
    burst({ x: mx, y: my, z: mz, n: 6, color: [0xffffff, 0xfff2b0, 0xffb84d], speed: 3, up: 0.5, size: 0.17, life: 0.1, gravity: 0, drag: 5 });
    // Gating on `a === W.player` is mandatory: shotFired is the GLOBAL event and
    // all 49 bots fire through it (audio.js gates its own gunshot the same way), so an
    // ungated kick would shake the camera on every gunshot on the island.
    // fovPunch is the camera's kick channel — inert until updateCamera consumes it.
    if (a === W.player) {
      W.camShake = Math.max(W.camShake, SHOT_SHAKE[weaponId] || 0.05);
      W.fovPunch = Math.max(W.fovPunch || 0, SHOT_FOV[weaponId] || 2);
    }
    // One brass casing per shot — the only thing this game leaves behind after a
    // firefight. Ejected right-and-back: right = dir x up(0,1,0) = (-dz, 0, dx).
    // Fires once per trigger pull, not per pellet, because weapons.js emits
    // shotFired once per fire() — so a shotgun throws one shell, correctly.
    if (weaponId !== "glauncher") {
      spawn({
        x: mx, y: my - 0.05, z: mz,
        vx: -dir.z * 1.6 - dir.x * 0.8, vy: 1.7, vz: dir.x * 1.6 - dir.z * 0.8,
        color: 0xc9a227, size: 0.045, life: 1.5, gravity: -9, drag: 0.2,
      });
    }
  });

  // one bright bolt PER PROJECTILE that FLIES with the round (owner: "when
  // shooting i dont see bullets") — a hot stretched streak sweeping downrange
  // beats the old static muzzle blink; bots' shots use the same global event
  const TRACER_COLOR = { sniper: 0x9fe0ff, glauncher: 0xffb060, shotgun: 0xffc46a };
  W.events.on("tracer", (pr) => {
    const speed = Math.hypot(pr.vx, pr.vy, pr.vz) || 1;
    const dx = pr.vx / speed, dy = pr.vy / speed, dz = pr.vz / speed;
    // short punchy bolt (owner: streaks were "too long") — a compact dash,
    // not a laser beam
    const len = pr.weaponId === "sniper" ? 7 : pr.weaponId === "glauncher" ? 3 : 4;
    // COSMETIC speed cap: hitscan rounds (999 m/s) cross the screen in one
    // frame — the eye never sees them. The damage ray is already resolved;
    // the bolt flies at a readable pace instead.
    const vs = Math.min(speed, 200);
    spawn({
      x: pr.x + dx * 1.4, y: pr.y + dy * 1.4, z: pr.z + dz * 1.4,
      vx: dx * vs, vy: dy * vs, vz: dz * vs,
      color: TRACER_COLOR[pr.weaponId] || 0xffd24a,
      size: 0.13, life: 0.22, gravity: 0, drag: 0,
      dir: new THREE.Vector3(dx, dy, dz), stretch: len,
    });
  });

  // weapons.js emits exactly four surfaces: flesh, wood, stone, dirt. The old
  // ternary chain tested "build" — dead residue of the removed building system —
  // and had no "wood" arm at all, so tree hits fell through to the dirt default
  // and threw brown chips while audio.js played the wood tick. The pale 0xd7c08a
  // the dead branch was sitting on is the right wood tone, so it just moves over.
  const IMPACT_COLOR = { flesh: 0xc23b3b, wood: 0xd7c08a, stone: 0xa9a9a9, dirt: 0x9a7f4f };
  W.events.on("impact", (pos, surface) => {
    const c = IMPACT_COLOR[surface] || 0x9a7f4f;
    burst({ x: pos.x, y: pos.y, z: pos.z, n: 5, color: c, speed: 3.5, size: 0.08, life: 0.4 });
  });

  W.events.on("explosion", (pos, R) => {
    burst({ x: pos.x, y: pos.y, z: pos.z, n: 26, color: [0xffd28a, 0xff8a3c, 0xff5522], speed: 11, up: 5, size: 0.28, life: 0.8, drag: 1.5 });
    burst({ x: pos.x, y: pos.y + 0.5, z: pos.z, n: 14, color: [0x555555, 0x333333], speed: 4, up: 4, size: 0.4, life: 1.4, gravity: -1.5, drag: 1.2 });
    ensureBlasts(W);
    const b = blasts[(blastCursor++) % blasts.length];
    b.t = 0; b.R = R || 3.5;
    b.sp.position.set(pos.x, pos.y + 0.4, pos.z);
    b.ring.position.set(pos.x, pos.y + 0.12, pos.z);
    b.sp.visible = true; b.ring.visible = true;
    // startMatch clears every scene group — re-adopt, the
    // same reason the particle InstancedMesh is re-parented in update()
    if (!b.sp.parent) W.group("fx").add(b.sp, b.ring);
    const d = W.player ? Math.hypot(W.player.pos.x - pos.x, W.player.pos.z - pos.z) : 999;
    if (d < 40) W.camShake = Math.max(W.camShake, (1 - d / 40) * 0.5);
    if (d < 8) W.hitstopT = Math.max(W.hitstopT || 0, 0.07);
  });

  W.events.on("swimState", (a, swimming) => {
    if (!swimming) return;
    burst({ x: a.pos.x, y: W.map.waterY + 0.1, z: a.pos.z, n: 8, color: [0xbfe8f5, 0x7fc9e0], speed: 3, up: 2.5, size: 0.1, life: 0.6, gravity: -6 });
  });
  W.events.on("swimStroke", (a) => {
    burst({ x: a.pos.x, y: W.map.waterY + 0.05, z: a.pos.z, n: 4, color: 0xbfe8f5, speed: 2, up: 1.5, size: 0.08, life: 0.4, gravity: -5 });
  });

  W.events.on("actorHurt", (victim, info) => {
    burst({ x: victim.pos.x, y: victim.pos.y + 1.2, z: victim.pos.z, n: 4, color: info.toShield > 0 ? 0x4aa8ff : 0xc23b3b, speed: 2.4, size: 0.08, life: 0.35 });
    flashActor(victim, info.toShield > 0);
    if (info.attackerId === (W.player && W.player.id)) {
      if (info.isHead) W.hitstopT = Math.max(W.hitstopT || 0, 0.03);
      // Coalesce: one shotgun blast fires this nine times in a single frame at
      // identical world coords, so it printed nine overlapping "10"s instead of
      // one readable "90". Summed and flushed once per frame in update().
      const b = hurtBuf.get(victim);
      if (b) {
        b.dmg += info.dmg;
        b.isHead = b.isHead || !!info.isHead;
        b.toShield = b.toShield || info.toShield || 0;
      } else {
        hurtBuf.set(victim, { dmg: info.dmg, isHead: !!info.isHead, toShield: info.toShield || 0 });
      }
      // fastForward skips fx update entirely — never let the buffer run away
      if (hurtBuf.size > 64) hurtBuf.clear();
    }
    if (victim === W.player) W.camShake = Math.max(W.camShake, 0.12);
  });

  // player.js emits actorDied as (victim, killerId, weaponId); this listener only ever
  // declared (victim), so the kill's owner was thrown away here.
  W.events.on("actorDied", (victim, killerId) => {
    burst({ x: victim.pos.x, y: victim.pos.y + 1, z: victim.pos.z, n: 12, color: [0xffffff, 0x9fd7ff], speed: 5, up: 4, size: 0.14, life: 0.8 });
    // your own kill gets the longest beat — 50 ms at 0.12x is ~6 ms of world time
    if (W.player && killerId === W.player.id && victim !== W.player) W.hitstopT = Math.max(W.hitstopT || 0, 0.05);
  });

  // propBreak had NO fx listener — this file wires nine events and it was not
  // among them, so a felled tree vanished with only audio.js's two-blip break
  // to mark it. Only TREE kinds can reach here: maps.js gives hp to
  // barrel/tree/pine/palm/birch and nothing else, and barrels take the explosion
  // path in weapons.js, so the palette is trunk + foliage, never stone.
  const nearCam = (x, z, max) => !W.player || Math.hypot(W.player.pos.x - x, W.player.pos.z - z) < max;
  W.events.on("propBreak", (p2) => {
    if (!nearCam(p2.x, p2.z, 120)) return;
    burst({ x: p2.x, y: p2.y + 1.4, z: p2.z, n: 14, color: [0x9a7f4f, 0x6b5335, 0x4e7a3a], speed: 4.5, up: 3, size: 0.18, life: 1.1, drag: 1.2 });
  });
  // hardLand and landed (both emitted from player.js) already had audio
  // and no visual at all. Distance-gated because "landed" fires once for every
  // one of 50 actors at the end of the drop.
  W.events.on("hardLand", (a, speed) => {
    // the impact speed was already being passed and used for particle count, but
    // nothing ever moved the CAMERA — so a 20 m drop and a 2 m hop felt identical
    // from behind the eyes. Player-only: a bot's landing must not shake your view.
    if (a === W.player) W.camShake = Math.max(W.camShake, Math.min(0.22, 0.05 + speed * 0.006));
    if (!nearCam(a.pos.x, a.pos.z, 60)) return;
    burst({ x: a.pos.x, y: a.pos.y + 0.06, z: a.pos.z, n: Math.min(12, 4 + Math.round(speed * 0.3)), color: [0xa08b63, 0x8a7550], speed: 2.2, up: 0.8, size: 0.1, life: 0.5, gravity: -5, drag: 2 });
  });
  // ordinary touchdown — every jump, every step off a roof. Scales with impact so
  // a hop kicks up almost nothing and a two-storey drop actually puffs.
  W.events.on("touchdown", (a, speed) => {
    if (!nearCam(a.pos.x, a.pos.z, 40)) return;
    const k = Math.min(1, speed / 14);
    burst({ x: a.pos.x, y: a.pos.y + 0.05, z: a.pos.z, n: 2 + Math.round(k * 5), color: [0x9a8562, 0xb0a184],
            speed: 1.1 + k * 1.2, up: 0.35 + k * 0.5, size: 0.07 + k * 0.03, life: 0.3 + k * 0.2, gravity: -5, drag: 2.6 });
  });
  // takeoff — nothing was drawn here at all
  W.events.on("jump", (a) => {
    if (!nearCam(a.pos.x, a.pos.z, 34)) return;
    burst({ x: a.pos.x, y: a.pos.y + 0.04, z: a.pos.z, n: 3, color: 0x9a8562, speed: 1.0, up: 0.5, size: 0.06, life: 0.26, gravity: -5, drag: 3 });
  });
  W.events.on("landed", (a) => {
    if (!nearCam(a.pos.x, a.pos.z, 45)) return;
    burst({ x: a.pos.x, y: a.pos.y + 0.05, z: a.pos.z, n: 6, color: 0x9a8562, speed: 1.6, up: 0.6, size: 0.09, life: 0.45, gravity: -5, drag: 2.5 });
  });

  W.events.on("chestOpened", (a, c) => {
    burst({ x: c.pos.x, y: c.pos.y + 0.8, z: c.pos.z, n: 12, color: [0xffd700, 0xfff2b0], speed: 3.5, up: 4, size: 0.1, life: 0.9, gravity: -3 });
  });
}

/** floating damage number (world → screen projection each frame until dead) */
const dmgNums = [];
// victim -> accumulated damage for THIS frame (see the actorHurt handler)
const hurtBuf = new Map();
function dmgNumber(W, x, y, z, text, color, scale) {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, {
    position: "absolute", left: "0", top: "0", color, fontWeight: "900",
    fontFamily: "system-ui, sans-serif", fontSize: Math.round(26 * (scale || 1)) + "px",
    textShadow: "0 2px 6px rgba(0,0,0,0.9), 0 0 12px rgba(0,0,0,0.5)", willChange: "transform, opacity",
    WebkitTextStroke: "1px rgba(0,0,0,0.55)",
  });
  dmgLayer.appendChild(el);
  // per-number rise speed: with a shared constant 0.9 every number climbed the
  // same 0.945 m at the same rate, so a 720 RPM SMG's ~12 concurrent numbers
  // stayed welded in one column no matter how far apart they spawned
  dmgNums.push({ el, pos: new THREE.Vector3(x, y, z), t: 0, life: 1.05, riseV: 0.7 + Math.random() * 0.5 });
}

// ── frame update ─────────────────────────────────────────────────────────────
const proj = new THREE.Vector3();
// last frame's camShake, so the decay below can tell "still ringing" from
// "raised by an event that the camera has not read yet" (see update())
let shakePrev = 0;

/** World-space celebration burst for the victory hold — same particle pool, no
 *  new subsystem. Exported because burst() is module-private and the orchestrator
 *  owns the victory beat. */
let fwCursor = 0;
const FW_COLORS = [[0xffd54a, 0xfff2b0], [0x7ad0ff, 0xbfe8f5], [0x4ade80, 0xbdf5cf], [0xff7ab8, 0xffd0e6]];
export function fireworks(W, x, y, z) {
  burst({ x, y, z, n: 30, color: FW_COLORS[(fwCursor++) % FW_COLORS.length], speed: 9, up: 1.5, size: 0.16, life: 1.6, gravity: -4, drag: 0.6 });
}

/** Remove any damage numbers still floating when a match ends — they are DOM
 *  nodes, so they otherwise hang over the menu until their life expires. */
export function reset() {
  for (const d of dmgNums) { if (d.el) d.el.remove(); }
  dmgNums.length = 0;
  hurtBuf.clear();
  // actors are rebuilt every match, so a live entry would pin a discarded roster
  flashing.length = 0;
  for (const b of blasts) { b.t = 99; b.sp.visible = false; b.ring.visible = false; }
  shakePrev = 0;
}

export function update(W, dt) {
  // flush this frame's coalesced damage numbers (colour precedence: head > shield > body)
  if (hurtBuf.size) {
    for (const [victim, b] of hurtBuf) {
      // Jitter the spawn point. The coalescing above merges one shotgun blast
      // but the Map is cleared every frame, so sustained fire still stacks a
      // number per frame at the SAME world point — 12/s from an SMG piled into
      // one illegible column. +/-0.35 m of spread is enough to read them apart.
      dmgNumber(W, victim.pos.x + (Math.random() - 0.5) * 0.7, victim.pos.y + 2.1 + Math.random() * 0.35, victim.pos.z + (Math.random() - 0.5) * 0.7,
        String(Math.round(b.dmg)), b.isHead ? "#ffd54a" : b.toShield > 0 ? "#6db9ff" : "#ffffff", 1);
    }
    hurtBuf.clear();
  }
  // startMatch clears every scene group — re-adopt the particle mesh or NO
  // particle (muzzle flash / tracer / impact / explosion) ever renders
  // in a match (root cause of "when shooting i dont see bullets")
  if (inst && !inst.parent) W.group("fx").add(inst);
  // particles
  let nLive = 0;
  for (let i = 0; i < N; i++) {
    const p = parts[i];
    if (!p.alive) continue;
    p.life -= dt;
    if (p.life <= 0) {
      p.alive = false;
      dummy.position.set(0, -9999, 0); dummy.scale.setScalar(0.0001); dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      continue;
    }
    nLive++;
    p.vel.y += p.gravity * dt;
    p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
    p.pos.addScaledVector(p.vel, dt);
    const k = p.life / p.life0;
    dummy.position.copy(p.pos);
    if (p.dir) {
      dummy.quaternion.setFromUnitVectors(_Z, p.dir);
      dummy.scale.set(p.size, p.size, p.stretch);
    } else {
      dummy.quaternion.copy(noRot);
      dummy.rotation.set(p.pos.x * 3 + p.life * 5, p.pos.y * 2, p.life * 7);
      dummy.scale.setScalar(p.size * (0.3 + 0.7 * k));
    }
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  // The pool used to submit all 1024 boxes (12,288 tris) and re-upload the full
  // 64 KB instance matrix EVERY frame — ~3.9 MB/s at 60 fps sitting on the menu
  // with not one particle alive. count 0 makes three.js skip the draw call
  // outright, and the upload now only costs anything on a frame that actually
  // wrote a matrix. Parked matrices written on a skipped frame are still in the
  // CPU-side array, so the next needsUpdate ships them. It has to be all-or-
  // nothing (N, not a live high-water mark): spawn() wraps around the ring, so
  // live particles are scattered across the whole index range, not packed low.
  if (nLive === 0) {
    inst.count = 0;
  } else {
    inst.count = N;
    inst.instanceMatrix.needsUpdate = true;
  }

  // explosion flash + ground shockwave (pooled, 4 concurrent)
  for (const b of blasts) {
    if (b.t > 0.45) continue;
    b.t += dt;
    const k = Math.min(1, b.t / 0.09);
    const s = b.R * 2.2 * (0.25 + 0.75 * k);
    b.sp.scale.set(s, s, 1);
    b.sp.material.opacity = b.t < 0.09 ? 1 : Math.max(0, 1 - (b.t - 0.09) / 0.16);
    const rk = Math.min(1, b.t / 0.25);
    const rs = b.R * (0.2 + 1.4 * rk);
    b.ring.scale.set(rs, rs, rs);
    b.ring.material.opacity = 0.55 * (1 - rk);
    if (b.t > 0.45) { b.sp.visible = false; b.ring.visible = false; }
  }

  // hit flash — scale the SAVED colour up (never lerp to white: BODY_GAIN 3.2
  // already puts these channels above 1, so blending toward white darkens them)
  for (let i = flashing.length - 1; i >= 0; i--) {
    const a = flashing[i];
    a._flashT -= dt;
    const k = Math.max(0, a._flashT / FLASH_S);
    for (const e of a._flashMats) {
      const g  = k > 0 ? 1 + 1.1 * k : 1;
      const mb = k > 0 && a._flashShield ? 1 + 0.5 * k : 1;
      const mr = k > 0 && !a._flashShield ? 1 + 0.6 * k : 1;
      if (e.u) { e.u.value.set(g * mr, g, g * mb); }        // zone-tinted: uniform
      else {                                                 // untinted: legacy path
        e.m.color.copy(e.c);
        if (k > 0) { e.m.color.multiplyScalar(g); e.m.color.r *= mr; e.m.color.b *= mb; }
      }
    }
    if (k <= 0) flashing.splice(i, 1);
  }

  // damage numbers
  const cam = W.camera, rect = W.kernel.renderer.domElement;
  const w2 = rect.clientWidth, h2 = rect.clientHeight;
  for (let i = dmgNums.length - 1; i >= 0; i--) {
    const d = dmgNums[i];
    d.t += dt;
    if (d.t > d.life) { d.el.remove(); dmgNums.splice(i, 1); continue; }
    proj.copy(d.pos); proj.y += d.t * d.riseV;
    proj.project(cam);
    if (proj.z > 1) { d.el.style.opacity = "0"; continue; }
    const sx = (proj.x * 0.5 + 0.5) * w2, sy = (-proj.y * 0.5 + 0.5) * h2;
    d.el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px)`;
    d.el.style.opacity = String(1 - (d.t / d.life) * 0.9);
  }

  // Camera shake is CONSUMED by player.js's updateCamera and decayed here, and the frame
  // order in ffg_royale3d.js is player(camera) → weapons(emits shotFired,
  // which raises camShake) → fx. So a kick raised this frame is not read by the
  // camera until the NEXT frame, and the decay used to run unconditionally in
  // between: at 60 fps an SMG kick of 0.045 reached the camera as 0.015 (67%
  // eaten), and at 20 fps the decay term is 0.09 — every pistol/SMG/AR kick was
  // erased to zero before it ever rendered. Skipping the decay on the frame the
  // value ROSE gives the camera one full-strength read. Explosion and hurt shake
  // lost the same frame before; they were just large enough to hide it.
  // Decay lives in player.js updateCamera, which runs BEFORE fx in the frame
  // order, so a kick raised this frame reaches the camera undecayed. Decaying
  // here as well ran it twice per frame and halved every shake's DURATION —
  // measured: sniper 150ms -> 83ms, explosion 283ms -> 150ms. Peak was correct;
  // only the tail was being eaten.
}
