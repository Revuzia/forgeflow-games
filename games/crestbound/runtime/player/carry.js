/**
 * CRESTBOUND — runtime/player/carry.js
 * ---------------------------------------------------------------------------
 * PICK UP / CARRY / THROW — the contract, the registry, and one built-in
 * carryable (the CRATE) that proves it.
 *
 * ===========================================================================
 * THE CARRY CONTRACT (stage 2 and the creatures lane adopt THIS)
 * ===========================================================================
 * Any object can be carried by Nim if it exposes:
 *
 *   carryable   : true            (flip to false to refuse a pick-up for now)
 *   pos         : THREE.Vector3   world CENTRE of the object; the hero reads it,
 *                                 the carrier writes it while held
 *   onPickup(player)  -> bool     return false to refuse. Stop your own AI /
 *                                 physics here; from now on the CARRIER owns `pos`.
 *   onThrow(player, vel)          released with a world velocity (m/s, a SHARED
 *                                 vector — copy it). The object owns its flight.
 *
 * and optionally:
 *
 *   carryRadius : number          pick-up reach added to the hand's (default 0.45)
 *   carryHeavy  : 0..1            how much it slows the carrier (default 0.2)
 *   carryHoldY  : number          centre height above the feet while held (default 1.95)
 *   onCarry(player, holdPos, yaw, dt)   every frame while held; default = `pos.copy(holdPos)`
 *                                 (+ `mesh.position/rotation` if the object has a `mesh`)
 *   onDrop(player, pos)           set down gently (crouch while carrying); if absent the
 *                                 carrier calls onThrow with a zero velocity instead
 *   onStrike(player, kind, pos, dir) -> bool   a punch / kick / thrown object hit it
 *                                 (return true if it counted — e.g. the crate breaks)
 *
 * HOW THE CONTROLLER FINDS CARRYABLES (duck-typed, allocation-free):
 *   1. this module's registry — `registerCarryable(obj)` / `unregisterCarryable(obj)`;
 *   2. `world.critters[i]` whose `carryable === true` (a stunned creature, a bomb-bug …);
 *   3. `world.carryables` if a Course ever publishes an array.
 * A Course (stage 2) that wants crates in its data calls `spawnCrate(player|world, p, opts)`
 * for each `{kind:'crate', p}` it reads; `clearCarryables(course)` on dispose (the crate
 * also retires itself when the course it was spawned for is no longer the live one).
 *
 * ATTACKS use the same duck typing (see controller.js `strikeAt`): a critter that
 * defines `onAttack(player, pos, kind, dir)` gets that; otherwise the EXISTING
 * entry points are used — `onDive(player)` for body blows (slide kick, dive) and
 * `onPound(player, pos)` at the fist / boot / crate position (never for the
 * gnasher, whose `onPound` is its POST pound). Carryables get `onStrike`.
 *
 * PERF: every update path below is allocation-free (module scratch only).
 * ---------------------------------------------------------------------------
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bevelBoxGeometry, getMaterial } from '../world/builders.js';

/* ============================== tunables ============================== */

/** Hand reach from the capsule axis, horizontally (metres). */
export const PICK_REACH = 0.72;
/** Default centre height of a held object above the carrier's feet. */
export const HOLD_Y = 1.95;
/** Crate gravity (m/s^2) — a crate is not the hero; it falls like a thrown thing. */
const CRATE_G = 30;
/** Impact speed above which a thrown crate breaks instead of settling. */
const CRATE_BREAK_SPEED = 6.0;
/** A broken crate comes back at home after this long (when `respawn`). */
const CRATE_RESPAWN_T = 3.0;
/** Seconds a respawning crate takes to pop back in. */
const CRATE_POP_T = 0.35;
/** How far a crate may fall before it is lost (below the course kill plane anyway). */
const CRATE_KILL_BELOW = 40;
/** Horizontal radius (m) a flying crate hits a creature at, on top of its own half size. */
const CRATE_HIT_R = 0.55;

/* ============================== scratch ============================== */

const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _dir = new THREE.Vector3();
const _hit = { t: 0, normal: new THREE.Vector3(0, 1, 0), collider: null, heightfield: null };
const _zero = new THREE.Vector3();

function fin(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }

/* ============================== registry ============================== */

const REGISTRY = [];

/** Make `obj` discoverable by every carrier. Idempotent. */
export function registerCarryable(obj) {
  if (obj && REGISTRY.indexOf(obj) < 0) REGISTRY.push(obj);
  return obj;
}

/** Forget `obj` (it keeps working if something still holds it). */
export function unregisterCarryable(obj) {
  const i = REGISTRY.indexOf(obj);
  if (i >= 0) REGISTRY.splice(i, 1);
}

/** The live registry (read-only by convention). */
export function carryables() { return REGISTRY; }

/**
 * Dispose every registered object that belongs to `course` (or every one, when
 * `course` is omitted). Objects without `dispose()` are just unregistered.
 */
export function clearCarryables(course) {
  for (let i = REGISTRY.length - 1; i >= 0; i--) {
    const o = REGISTRY[i];
    if (course !== undefined && o && o.course !== course) continue;
    REGISTRY.splice(i, 1);
    if (o && typeof o.dispose === 'function') { try { o.dispose(); } catch (e) { /* noop */ } }
  }
}

/* ============================== discovery ============================== */

/** Score one candidate against the hand; returns the score or Infinity. */
function scoreCandidate(o, px, py, pz, fx, fz, carrier) {
  if (!o || o.carryable !== true || o === carrier.carrying || o.held === true) return Infinity;
  const p = o.pos;
  if (!p || typeof p.x !== 'number') return Infinity;
  const dy = p.y - py;
  if (dy < -0.7 || dy > 1.5) return Infinity;              // below the boots / over the head
  const dx = p.x - px, dz = p.z - pz;
  const d = Math.sqrt(dx * dx + dz * dz);
  const r = fin(o.carryRadius, 0.45);
  if (d > PICK_REACH + r) return Infinity;
  const along = dx * fx + dz * fz;
  /* In FRONT of the hands, unless it is so close the boots are touching it. */
  if (d > r + 0.2 && along < d * 0.35) return Infinity;
  return d - along * 0.35;
}

/**
 * The best carryable in reach of `player` (feet `pos`, heading `facing`), or null.
 * Allocation-free.
 */
export function findCarryable(player) {
  if (!player || !player.pos) return null;
  const p = player.pos;
  const fx = -Math.sin(player.facing || 0), fz = -Math.cos(player.facing || 0);
  let best = null, bestS = Infinity, s = 0;
  for (let i = 0; i < REGISTRY.length; i++) {
    s = scoreCandidate(REGISTRY[i], p.x, p.y, p.z, fx, fz, player);
    if (s < bestS) { bestS = s; best = REGISTRY[i]; }
  }
  const w = player.world;
  const cr = w && w.critters;
  if (cr && cr.length) {
    for (let i = 0; i < cr.length; i++) {
      const c = cr[i];
      if (!c || c.carryable !== true || c.enabled === false) continue;
      s = scoreCandidate(c, p.x, p.y, p.z, fx, fz, player);
      if (s < bestS) { bestS = s; best = c; }
    }
  }
  const extra = w && w.carryables;
  if (extra && extra.length) {
    for (let i = 0; i < extra.length; i++) {
      s = scoreCandidate(extra[i], p.x, p.y, p.z, fx, fz, player);
      if (s < bestS) { bestS = s; best = extra[i]; }
    }
  }
  return best;
}

/**
 * Tell a carried object where the hands are this frame (the HERO calls this after
 * posing, so the object sits in the mittens with zero lag). Allocation-free.
 */
export function holdCarried(obj, player, holdPos, yaw, dt) {
  if (!obj || !holdPos) return;
  if (typeof obj.onCarry === 'function') {
    try { obj.onCarry(player, holdPos, yaw, dt || 0); } catch (e) { /* the object owns its errors */ }
    return;
  }
  if (obj.pos && typeof obj.pos.copy === 'function') obj.pos.copy(holdPos);
  const m = obj.mesh;
  if (m && m.position) { m.position.copy(holdPos); if (m.rotation) m.rotation.y = yaw || 0; }
}

/* ============================== the crate ============================== */

let _crateGeo = null;           // { wood, trim } shared geometry
let _crateSerial = 0;

/**
 * Crate art: a chamfered wooden body, a frame of darker planks on every face,
 * a diagonal brace on four sides and iron corner caps — two merged draws, ~0.9k
 * triangles, no naked primitive (doctrine). Built once, shared.
 */
function crateGeometry(size) {
  if (_crateGeo && _crateGeo.size === size) return _crateGeo;
  const h = size * 0.5;
  const plank = size * 0.14, th = size * 0.05;
  const wood = [];
  const trim = [];
  const add = (list, g, x, y, z, rx, ry, rz) => {
    if (rx || ry || rz) g.rotateX(rx || 0).rotateY(ry || 0).rotateZ(rz || 0);
    g.translate(x, y, z);
    list.push(g);
  };
  /* body, inset so the frame planks stand proud of it */
  add(wood, bevelBoxGeometry(size * 0.94, size * 0.94, size * 0.94, size * 0.035), 0, 0, 0);
  /* frame: 12 edge planks (4 per axis) */
  const o = h - plank * 0.5 + th * 0.2;
  for (const sy of [-1, 1]) {
    for (const sz of [-1, 1]) add(wood, bevelBoxGeometry(size + th, plank, plank, 0.012), 0, sy * o, sz * o);
    for (const sx of [-1, 1]) add(wood, bevelBoxGeometry(plank, plank, size + th, 0.012), sx * o, sy * o, 0);
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(wood, bevelBoxGeometry(plank, size - plank, plank, 0.012), sx * o, 0, sz * o);
  /* diagonal braces on the four vertical faces */
  const diag = Math.SQRT2 * (size - plank * 2) * 0.98;
  for (let k = 0; k < 4; k++) {
    const g = bevelBoxGeometry(diag, plank * 0.8, th * 1.2, 0.01);
    g.rotateZ((k & 1) ? Math.PI / 4 : -Math.PI / 4);
    g.translate(0, 0, h + th * 0.1);
    g.rotateY(k * Math.PI / 2);
    wood.push(g);
  }
  /* iron corner caps */
  const cap = size * 0.2;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    add(trim, bevelBoxGeometry(cap, cap, cap, 0.02), sx * (h - cap * 0.38), sy * (h - cap * 0.38), sz * (h - cap * 0.38));
  }
  const strip = (list) => list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
    return n;
  });
  _crateGeo = {
    size,
    wood: mergeGeometries(strip(wood), false),
    trim: mergeGeometries(strip(trim), false),
  };
  return _crateGeo;
}

function crateMaterials(theme) {
  let wood = null, trim = null;
  /* mats = null on purpose: the Mats service projects textures in WORLD space,
     which would swim across a crate in flight. The builder bank maps by UV. */
  try { wood = getMaterial('wood', theme || null, null); } catch (e) { wood = null; }
  try { trim = getMaterial('metal', theme || null, null); } catch (e) { trim = null; }
  if (!wood || !wood.isMaterial) wood = new THREE.MeshStandardMaterial({ color: 0x9a6a3c, roughness: 0.8 });
  if (!trim || !trim.isMaterial) trim = new THREE.MeshStandardMaterial({ color: 0x5b5f66, roughness: 0.45, metalness: 0.8 });
  return { wood, trim };
}

/**
 * THE CRATE — a built-in carryable. Rests on whatever is under it, can be nudged
 * by walking into it, picked up, carried overhead, thrown in an arc, set down,
 * breaks on a hard impact (debris burst) and hits any creature it flies into
 * through the critter hooks. Respawns at home after it breaks (`respawn`, default on).
 */
export class CarryCrate {
  /**
   * @param {object} opts {pos:[x,y,z]|Vector3, scene, world?, size?, respawn?, theme?, fx?, audio?, course?}
   */
  constructor(opts) {
    const o = opts || {};
    this.kind = 'crate';
    this.id = 'crate-' + (++_crateSerial);
    this.carryable = true;
    this.size = fin(o.size, 0.56);
    this.carryRadius = this.size * 0.5 + 0.1;
    this.carryHeavy = 0.2;
    this.carryHoldY = HOLD_Y;
    this.respawn = o.respawn !== false;
    this.world = o.world || null;
    this.course = o.course !== undefined ? o.course : (this.world && this.world.course) || null;
    this.fx = o.fx || null;
    this.audio = o.audio || null;
    this.pos = new THREE.Vector3();
    this.home = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = fin(o.yaw, 0);
    this.spinX = 0; this.spinZ = 0;
    this.rotX = 0; this.rotZ = 0;
    /** 'rest' | 'held' | 'flying' | 'broken' | 'pop' */
    this.state = 'rest';
    this.stateT = 0;
    this.held = false;
    this.thrower = null;
    this.breaks = 0;
    this.throws = 0;
    this.hits = 0;
    this.lastImpact = 0;
    this._hitCd = 0;

    const g = crateGeometry(this.size);
    const m = crateMaterials(o.theme);
    this.mesh = new THREE.Group();
    this.mesh.name = 'carry.crate';
    const a = new THREE.Mesh(g.wood, m.wood);
    const b = new THREE.Mesh(g.trim, m.trim);
    a.castShadow = true; a.receiveShadow = true;
    b.castShadow = true; b.receiveShadow = true;
    this.mesh.add(a, b);
    this.scene = o.scene || (this.world && this.world.scene) || null;
    if (this.scene) this.scene.add(this.mesh);

    const p = o.pos || o.p;
    if (Array.isArray(p)) this.home.set(fin(p[0], 0), fin(p[1], 0), fin(p[2], 0));
    else if (p && typeof p.x === 'number') this.home.set(p.x, p.y, p.z);
    this.pos.copy(this.home);
    this._sync();
  }

  /* ---- carry contract ---------------------------------------------------- */

  onPickup(player) {
    if (this.state === 'broken' || this.state === 'pop' || this.held) return false;
    this.state = 'held'; this.stateT = 0;
    this.held = true;
    this.vel.set(0, 0, 0);
    this.rotX = 0; this.rotZ = 0;
    this.thrower = player || null;
    return true;
  }

  onCarry(player, holdPos, yaw) {
    this.pos.copy(holdPos);
    this.yaw = yaw || 0;
    this._sync();
  }

  onThrow(player, vel) {
    this.held = false;
    this.thrower = player || null;
    this.vel.copy(vel || _zero);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp < 0.5 && Math.abs(this.vel.y) < 0.5) { this.state = 'rest'; this.stateT = 0; return; }
    this.state = 'flying'; this.stateT = 0;
    this.throws++;
    /* a thrown crate tumbles end over end, the way it was flung */
    this.spinX = -7.5; this.spinZ = (Math.random() - 0.5) * 3;
    this._hitCd = 0;
  }

  onDrop(player, p) {
    this.held = false;
    this.thrower = player || null;
    if (p) this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.state = 'rest'; this.stateT = 0;
    this._sync();
  }

  /** A punch / kick / another crate hit it: it breaks (and pays for it in splinters). */
  onStrike(player, kind) {
    if (this.state === 'broken' || this.state === 'pop' || this.held) return false;
    this.breakApart(kind || 'strike');
    return true;
  }

  /* ---- life ---------------------------------------------------------------- */

  breakApart(reason) {
    if (this.state === 'broken') return;
    this.state = 'broken'; this.stateT = 0;
    this.held = false;
    this.breaks++;
    this.lastBreak = reason || 'impact';
    this.mesh.visible = false;
    this._burst('dust', this.pos, 1);
    this._burst('spark', this.pos, 0.6);
    this._burst('leafKick', this.pos, 0.8);
    this._sfx('crusher_slam', 0.55);
  }

  reset() {
    this.pos.copy(this.home);
    this.vel.set(0, 0, 0);
    this.rotX = 0; this.rotZ = 0;
    this.state = 'rest'; this.stateT = 0;
    this.held = false;
    this.mesh.visible = true;
    this.mesh.scale.set(1, 1, 1);
    this._sync();
  }

  /**
   * Per frame (called by the Player through `updateCarryables`). Allocation-free.
   * @param {number} dt
   * @param {object} world physWorld ({broadphase, critters, killY, course})
   * @param {object} player the Player (to be nudged by, and to credit a throw to)
   */
  update(dt, world, player) {
    if (!(dt > 0)) return;
    this.stateT += dt;
    if (this._hitCd > 0) this._hitCd -= dt;
    const w = world || this.world;
    if (w) this.world = w;

    switch (this.state) {
      case 'held': return;                      // the carrier owns pos
      case 'broken':
        if (this.respawn && this.stateT >= CRATE_RESPAWN_T) {
          this.reset();
          this.state = 'pop'; this.stateT = 0;
          this.mesh.scale.set(0.01, 0.01, 0.01);
          this._burst('dust', this.pos, 0.5);
        }
        return;
      case 'pop': {
        const u = Math.min(1, this.stateT / CRATE_POP_T);
        const k = 1 + 0.18 * Math.sin(u * Math.PI);
        const s = Math.max(0.01, u * k);
        this.mesh.scale.set(s, s, s);
        if (u >= 1) { this.mesh.scale.set(1, 1, 1); this.state = 'rest'; this.stateT = 0; }
        return;
      }
      case 'flying': this._fly(dt, w, player); break;
      default: this._rest(dt, w, player); break;
    }
    this._sync();
  }

  _rest(dt, w, player) {
    const half = this.size * 0.5;
    /* nudged by the hero: a walked-into crate slides, it never lets him pass through */
    if (player && player.pos && !player.dead && player.carrying !== this) {
      const pp = player.pos;
      const dy = this.pos.y - pp.y;
      if (dy > -half && dy < (player.height || 1.5) + half) {
        const dx = this.pos.x - pp.x, dz = this.pos.z - pp.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const minD = (player.radius || 0.38) + half * 0.92;
        const bp0 = w && w.broadphase;
        if (d < minD && d > 1e-4) {
          let push = minD - d;
          /* never shove it into a wall: stop at the first solid face */
          if (bp0 && typeof bp0.raycast === 'function') {
            _dir.set(dx / d, 0, dz / d);
            _v1.set(this.pos.x, this.pos.y, this.pos.z);
            try {
              if (bp0.raycast(_v1, _dir, push + half, _hit)) push = Math.max(0, Math.min(push, _hit.t - half));
            } catch (e) { /* noop */ }
          }
          this.pos.x += dx / d * push;
          this.pos.z += dz / d * push;
        }
      }
    }
    /* settle on whatever is under it */
    const bp = w && w.broadphase;
    if (!bp || typeof bp.raycast !== 'function') return;
    _v0.set(this.pos.x, this.pos.y + 0.2, this.pos.z);
    let supported = false;
    try { supported = bp.raycast(_v0, _down, half + 0.2 + 0.06, _hit); } catch (e) { supported = true; }
    if (supported) {
      /* t ~ 0: the probe started inside something (wedged against a wall) —
         hold still rather than sink through it */
      if (_hit.t > 0.01) this.pos.y = _v0.y - _hit.t + half;
      this.vel.set(0, 0, 0);
      return;
    }
    /* unsupported: fall */
    this.vel.y -= CRATE_G * dt;
    const step = -this.vel.y * dt;
    _v0.set(this.pos.x, this.pos.y, this.pos.z);
    let hit = false;
    try { hit = bp.raycast(_v0, _down, half + step + 0.02, _hit); } catch (e) { hit = false; }
    if (hit && _hit.t > 0.001) {
      this.pos.y = _v0.y - _hit.t + half;
      const impact = -this.vel.y;
      this.vel.y = 0;
      if (impact > 3) { this._burst('dust', this.pos, Math.min(1, impact / 12)); this._sfx('land_soft', 0.35); }
    } else {
      this.pos.y -= step;
    }
    this._killCheck(w);
  }

  _fly(dt, w, player) {
    const half = this.size * 0.5;
    this.vel.y -= CRATE_G * dt;
    this.rotX += this.spinX * dt;
    this.rotZ += this.spinZ * dt;
    const bp = w && w.broadphase;
    const sp = this.vel.length();
    const step = sp * dt;
    let hitWorld = false;
    if (bp && typeof bp.raycast === 'function' && step > 1e-6) {
      _dir.copy(this.vel).multiplyScalar(1 / sp);
      _v0.copy(this.pos);
      try { hitWorld = bp.raycast(_v0, _dir, step + half * 0.9, _hit); } catch (e) { hitWorld = false; }
      /* ignore a hit we START inside (thrown out of an overlap) — move on through */
      if (hitWorld && _hit.t < 1e-3) hitWorld = false;
    }
    /* creatures in the arc */
    if (this._hitCd <= 0 && player && typeof player.strikeAt === 'function') {
      const n = player.strikeAt(this.pos.x, this.pos.y - 0.2, this.pos.z, half + CRATE_HIT_R, 'throw',
        this.vel.x, this.vel.z, this);
      if (n > 0) { this.hits += n; this._hitCd = 0.2; this.breakApart('creature'); return; }
    }
    if (hitWorld) {
      const t = Math.max(0, _hit.t - half * 0.9);
      this.pos.addScaledVector(_dir, t);
      this.lastImpact = sp;
      const floorish = _hit.normal.y > 0.6;
      if (sp >= CRATE_BREAK_SPEED || !floorish) { this.breakApart('impact'); return; }
      /* soft landing: settle */
      this.vel.set(0, 0, 0);
      this.rotX = 0; this.rotZ = 0;
      this.state = 'rest'; this.stateT = 0;
      this._burst('dust', this.pos, 0.5);
      this._sfx('land_soft', 0.4);
      return;
    }
    this.pos.addScaledVector(this.vel, dt);
    this._killCheck(w);
  }

  _killCheck(w) {
    const ky = w && typeof w.killY === 'number' && isFinite(w.killY) ? w.killY : -1e4;
    if (this.pos.y < Math.min(ky, this.home.y - CRATE_KILL_BELOW)) {
      if (this.respawn) { this.reset(); this.state = 'pop'; this.stateT = 0; this.mesh.scale.set(0.01, 0.01, 0.01); }
      else this.breakApart('void');
    }
  }

  _sync() {
    const m = this.mesh;
    m.position.copy(this.pos);
    m.rotation.set(this.rotX, this.yaw, this.rotZ);
  }

  _burst(preset, pos, strength) {
    const f = this.fx || (this.thrower && this.thrower.fx) || null;
    if (!f) return;
    try {
      if (typeof f.burst === 'function') f.burst(preset, pos, _burstOpt(strength));
      else if (f.ps && typeof f.ps.burst === 'function') f.ps.burst(preset, pos, _burstOpt(strength));
    } catch (e) { /* fx never breaks a crate */ }
  }

  _sfx(name, gain) {
    const a = this.audio || (this.thrower && this.thrower.audio) || null;
    if (!a || typeof a.sfx !== 'function') return;
    _sfxOpt.gain = gain === undefined ? 1 : gain;
    try { a.sfx(name, _sfxOpt); } catch (e) { /* audio never breaks a crate */ }
  }

  dispose() {
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.carryable = false;
    this.state = 'broken';
  }
}

const _burstO = { strength: 1, color: 0x9a6a3c, count: 0 };
function _burstOpt(s) { _burstO.strength = s === undefined ? 1 : s; return _burstO; }
const _sfxOpt = { gain: 1, rate: 1, impact: 0, power: 0 };

/**
 * Build a crate for the live course and register it.
 * @param {object} src   the Player (preferred — gives world, fx, audio) or a physWorld
 * @param {number[]|THREE.Vector3} pos   crate CENTRE; put it `size/2` above the floor
 * @param {object} [opts] CarryCrate options (size, respawn, yaw, theme)
 */
export function spawnCrate(src, pos, opts) {
  const o = Object.assign({}, opts || {});
  const isPlayer = !!(src && src.world !== undefined && src.pos);
  const world = isPlayer ? src.world : (src || null);
  o.world = world;
  o.pos = pos;
  if (!o.scene) o.scene = world && world.scene ? world.scene : null;
  if (!o.fx && isPlayer) o.fx = src.fx || null;
  if (!o.audio && isPlayer) o.audio = src.audio || null;
  if (!o.theme && world && world.game) o.theme = world.game.theme || null;
  const c = new CarryCrate(o);
  registerCarryable(c);
  return c;
}

/**
 * Advance every registered object that has an `update(dt, world, player)` and
 * retire the ones whose course is gone. The Player calls this once per frame.
 * Allocation-free.
 */
export function updateCarryables(dt, player) {
  const w = player ? player.world : null;
  const live = w ? w.course : undefined;
  for (let i = REGISTRY.length - 1; i >= 0; i--) {
    const o = REGISTRY[i];
    if (!o) { REGISTRY.splice(i, 1); continue; }
    /* a crate spawned for a course that is no longer loaded is retired */
    if (live !== undefined && o.course && live && o.course !== live && o.held !== true) {
      REGISTRY.splice(i, 1);
      if (typeof o.dispose === 'function') { try { o.dispose(); } catch (e) { /* noop */ } }
      continue;
    }
    if (typeof o.update === 'function') {
      try { o.update(dt, w, player); } catch (e) { /* one bad object never stops the rest */ }
    }
  }
}

export default {
  PICK_REACH, HOLD_Y, registerCarryable, unregisterCarryable, carryables, clearCarryables,
  findCarryable, holdCarried, spawnCrate, updateCarryables, CarryCrate,
};
