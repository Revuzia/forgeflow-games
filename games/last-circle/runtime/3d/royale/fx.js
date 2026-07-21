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
  p.idx = parts.indexOf(p);
  const i = p.idx;
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
function wireEvents(W) {
  W.events.on("shotFired", (a, weaponId, muzzle, dir) => {
    // muzzle flash at the BARREL (weapons.js now passes the weapon muzzle world
    // position, not the eye) — bright and chunky enough to register at gameplay FOV
    const mx = muzzle.x + dir.x * 0.12, my = muzzle.y + dir.y * 0.12, mz = muzzle.z + dir.z * 0.12;
    burst({ x: mx, y: my, z: mz, n: 6, color: [0xffffff, 0xfff2b0, 0xffb84d], speed: 3, up: 0.5, size: 0.17, life: 0.1, gravity: 0, drag: 5 });
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

  W.events.on("impact", (pos, surface) => {
    const c = surface === "flesh" ? 0xc23b3b : surface === "build" ? 0xd7c08a : surface === "stone" ? 0xa9a9a9 : 0x9a7f4f;
    burst({ x: pos.x, y: pos.y, z: pos.z, n: 5, color: c, speed: 3.5, size: 0.08, life: 0.4 });
  });

  W.events.on("explosion", (pos, R) => {
    burst({ x: pos.x, y: pos.y, z: pos.z, n: 26, color: [0xffd28a, 0xff8a3c, 0xff5522], speed: 11, up: 5, size: 0.28, life: 0.8, drag: 1.5 });
    burst({ x: pos.x, y: pos.y + 0.5, z: pos.z, n: 14, color: [0x555555, 0x333333], speed: 4, up: 4, size: 0.4, life: 1.4, gravity: -1.5, drag: 1.2 });
    const d = W.player ? Math.hypot(W.player.pos.x - pos.x, W.player.pos.z - pos.z) : 999;
    if (d < 40) W.camShake = Math.max(W.camShake, (1 - d / 40) * 0.5);
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
    if (info.attackerId === (W.player && W.player.id)) {
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

  W.events.on("actorDied", (victim) => {
    burst({ x: victim.pos.x, y: victim.pos.y + 1, z: victim.pos.z, n: 12, color: [0xffffff, 0x9fd7ff], speed: 5, up: 4, size: 0.14, life: 0.8 });
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
  dmgNums.push({ el, pos: new THREE.Vector3(x, y, z), t: 0, life: 1.05 });
}

// ── frame update ─────────────────────────────────────────────────────────────
const proj = new THREE.Vector3();
/** Remove any damage numbers still floating when a match ends — they are DOM
 *  nodes, so they otherwise hang over the menu until their life expires. */
export function reset() {
  for (const d of dmgNums) { if (d.el) d.el.remove(); }
  dmgNums.length = 0;
  hurtBuf.clear();
}

export function update(W, dt) {
  // flush this frame's coalesced damage numbers (colour precedence: head > shield > body)
  if (hurtBuf.size) {
    for (const [victim, b] of hurtBuf) {
      dmgNumber(W, victim.pos.x, victim.pos.y + 2.1, victim.pos.z, String(Math.round(b.dmg)),
        b.isHead ? "#ffd54a" : b.toShield > 0 ? "#6db9ff" : "#ffffff", 1);
    }
    hurtBuf.clear();
  }
  // startMatch clears every scene group — re-adopt the particle mesh or NO
  // particle (muzzle flash / tracer / impact / explosion) ever renders
  // in a match (root cause of "when shooting i dont see bullets")
  if (inst && !inst.parent) W.group("fx").add(inst);
  // particles
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
    p.vel.y += p.gravity * dt;
    p.vel.multiplyScalar(Math.max(0, 1 - p.drag * dt));
    p.pos.addScaledVector(p.vel, dt);
    const k = p.life / p.life0;
    dummy.position.copy(p.pos);
    if (p.dir) {
      dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), p.dir);
      dummy.scale.set(p.size, p.size, p.stretch);
    } else {
      dummy.quaternion.copy(noRot);
      dummy.rotation.set(p.pos.x * 3 + p.life * 5, p.pos.y * 2, p.life * 7);
      dummy.scale.setScalar(p.size * (0.3 + 0.7 * k));
    }
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;

  // damage numbers
  const cam = W.camera, rect = W.kernel.renderer.domElement;
  const w2 = rect.clientWidth, h2 = rect.clientHeight;
  for (let i = dmgNums.length - 1; i >= 0; i--) {
    const d = dmgNums[i];
    d.t += dt;
    if (d.t > d.life) { d.el.remove(); dmgNums.splice(i, 1); continue; }
    proj.copy(d.pos); proj.y += d.t * 0.9;
    proj.project(cam);
    if (proj.z > 1) { d.el.style.opacity = "0"; continue; }
    const sx = (proj.x * 0.5 + 0.5) * w2, sy = (-proj.y * 0.5 + 0.5) * h2;
    d.el.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px)`;
    d.el.style.opacity = String(1 - (d.t / d.life) * 0.9);
  }

  // camera shake decay is consumed by player.js camera; just decay here
  if (W.camShake > 0) W.camShake = Math.max(0, W.camShake - dt * 1.8);
}
