/**
 * CRESTBOUND — runtime/entities/creatures.js
 * ---------------------------------------------------------------------------
 * THE SIGNATURE ROSTER (stage 1, creatures lane). Eight course enemies, two per
 * realm, each with a distinct silhouette, a readable telegraph, a defeat the
 * hero already has (stomp / pound — and `onStrike` for the punch/kick verbs the
 * hero lane is adding), a coin drop and a personality: an idle, a NOTICE beat
 * (a "!" pops over its head, a sound, a reaction pose) and a defeat animation.
 *
 *   VERDANT  burrower    BURROWER      tunnels under you, telegraphs, pops up, is dazed
 *            podspitter  PODSPITTER    rooted pod that lobs seeds at a marked spot
 *   EMBER    slagcrab    SLAG CRAB     scuttler that shells up against stomps; pound flips it
 *            emberimp    EMBER IMP     hopping fire sprite, flares before every hop
 *   RIME     skater      FLOE SKATER   waddler that belly-slides at you, then spins out
 *            snowcub     SNOWBALL CUB  rolls a growing snowball down a lane
 *   AZURE    sentry      RAIL SENTRY   clockwork turret on a rail: aim beam, then a cog bolt
 *            puffer      SKY PUFFER    drifts; inflates into a bounce platform; pound pops it
 *
 * WHY A FACTORY. The roster extends `Critter` from critters.js, and critters.js
 * registers the roster — an ESM import cycle would evaluate one of the two
 * class bodies before its base exists. So this module imports nothing from
 * critters.js: critters.js hands it the base class and its private helpers
 * (`defineCreatures(kit)`) at the bottom of its own body, after `Critter` is
 * defined. Nothing in the five original creatures changes (loopcheck's
 * hazard-determinism rows and the Warden fights are untouched).
 *
 * RULES KEPT
 *  - Articulated multi-part bodies (doctrine: no single-primitive creature),
 *    folded to ONE skinned draw by `Critter._mergeGroup`; hot emissive parts
 *    (flames, magma seams, lenses) keep their own small draw so they can glow.
 *  - Fair: every contact is a knockback + short stun through `Critter._hurt`,
 *    never a death. Kill volumes are not used by the roster.
 *  - Deterministic: anything that does not read the player is a function of the
 *    creature clock / its own integrated state; `reset()` restores the exact
 *    frame. Randomness only from `this.rng` (re-seeded by `reset`).
 *  - Zero per-frame allocation: module scratch only.
 *  - Reward: `events.emit('coins', n, pos)` — course.js turns that into ONE
 *    `dropCoins(pos, n)`. (The bumbler also calls `ctx.awardCoins`, which
 *    reaches the same `dropCoins`, so it pays twice; the roster pays once.)
 *
 * THE VERBS THE HERO LANE CAN WIRE (duck-typed, nothing calls them yet):
 *   creature.onStrike(player, kind, pos, dir) -> bool   kind 'punch'|'kick'|'slidekick'|'throw'|'dive'
 *   creature.onPound(player, pos)                      (course.onPoundLand already fans this out)
 *   creature.onStand(player)                           (course._detectStand already calls this)
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  clamp, damp, dampAngle, smoothstep, easeOutBack, TAU, wrapAngle,
} from '../core/util.js';
import { TUNE } from '../core/tuning.js';
import {
  bevelBoxGeometry, prismGeometry, tubeGeometry, ringProfileGeometry, discGeometry,
  getEmissive, getPulse,
} from '../world/builders.js';
import { Collider } from '../world/collider.js';

/* ===========================================================================
 * 0. The roster card — names, realms, tuning a course may override per def
 * ======================================================================== */

/**
 * notice  metres at which it notices Nim (def.notice overrides)
 * coins   the drop (def.coins overrides)
 * respawn seconds after defeat before it comes back (0 = stays down until the
 *         course resets; def.respawn overrides)
 * emoteY  where the "!" pops, metres above its feet
 * defeatT seconds of defeat animation before it vanishes
 */
export const CREATURE_INFO = Object.freeze({
  burrower:   { realm: 'verdant', name: 'BURROWER',     notice: 9,  coins: 3, respawn: 0,  emoteY: 1.25, defeatT: 0.95 },
  podspitter: { realm: 'verdant', name: 'PODSPITTER',   notice: 13, coins: 3, respawn: 0,  emoteY: 2.05, defeatT: 1.10 },
  slagcrab:   { realm: 'ember',   name: 'SLAG CRAB',    notice: 8,  coins: 3, respawn: 0,  emoteY: 1.30, defeatT: 1.00 },
  emberimp:   { realm: 'ember',   name: 'EMBER IMP',    notice: 10, coins: 2, respawn: 0,  emoteY: 1.35, defeatT: 0.90 },
  skater:     { realm: 'rime',    name: 'FLOE SKATER',  notice: 11, coins: 3, respawn: 0,  emoteY: 1.45, defeatT: 1.00 },
  snowcub:    { realm: 'rime',    name: 'SNOWBALL CUB', notice: 12, coins: 3, respawn: 0,  emoteY: 1.35, defeatT: 1.00 },
  sentry:     { realm: 'azure',   name: 'RAIL SENTRY',  notice: 11, coins: 3, respawn: 0,  emoteY: 1.75, defeatT: 1.10 },
  puffer:     { realm: 'azure',   name: 'SKY PUFFER',   notice: 5,  coins: 3, respawn: 10, emoteY: 1.10, defeatT: 0.70 },
});

/* ===========================================================================
 * 1. Module scratch — update paths never allocate
 * ======================================================================== */

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler();
const _rw = new THREE.Vector3();
const _rewardPos = new THREE.Vector3();
const _ray = { t: 0, normal: new THREE.Vector3(), collider: null };
const UPV = new THREE.Vector3(0, 1, 0);
const DOWNV = new THREE.Vector3(0, -1, 0);

const RESPAWN_POP = 0.4;
const LOST_AFTER = 2.5;

/* ===========================================================================
 * 2. The factory
 * ======================================================================== */

/**
 * @param {object} K  the kit critters.js passes: { Critter, fin, readV3, capsuleOf,
 *   capsuleHitsSphere, skinMat, eyeWhiteMat, pupilMat, worldMat, sphereGeo,
 *   capsuleGeo, coneGeo, bbox, place, mergeParts, makeEyes, polylineLengths,
 *   polylineAt, tri, cached, normalizeAttrs }
 * @returns {{ Creature, ShotSet, MarkerSet, StarRing, factories, classes }}
 */
export function defineCreatures(K) {
  const {
    Critter, fin, readV3, capsuleOf, capsuleHitsSphere, skinMat, eyeWhiteMat,
    worldMat, sphereGeo, capsuleGeo, coneGeo, bbox, place, mergeParts, makeEyes,
    polylineLengths, polylineAt, tri, cached, normalizeAttrs,
  } = K;

  /* ---------------------------------------------------------------- shapes */

  /** An ellipsoid part: radius r scaled (sx, sy, sz), placed at (x, y, z). */
  function ell(r, sx, sy, sz, x, y, z, ws, hs) {
    return place(sphereGeo(r, ws || 16, hs || 12), x || 0, y || 0, z || 0, 0, 0, 0, sx, sy, sz);
  }
  /** A cone standing on its base at the origin, tip +Y, then placed. */
  function spike(rb, h, sides, x, y, z, rx, ry, rz) {
    const g = coneGeo(rb, h, sides || 6);
    place(g, 0, h * 0.5, 0);
    return place(g, x || 0, y || 0, z || 0, rx || 0, ry || 0, rz || 0);
  }
  /** A capsule lying along +Z from its origin (limbs), then placed. */
  function limbZ(r, len, x, y, z, rx, ry, rz) {
    const g = capsuleGeo(r, len, 8);
    place(g, 0, 0, len * 0.5 + r * 0.3, Math.PI / 2, 0, 0);
    return place(g, x || 0, y || 0, z || 0, rx || 0, ry || 0, rz || 0);
  }
  /** A capsule hanging down -Y from its origin, then placed. */
  function limbY(r, len, x, y, z, rx, ry, rz) {
    const g = capsuleGeo(r, len, 8);
    place(g, 0, -(len * 0.5 + r * 0.3), 0);
    return place(g, x || 0, y || 0, z || 0, rx || 0, ry || 0, rz || 0);
  }

  function pivot(name, parent, x, y, z) {
    const p = new THREE.Group();
    p.name = name;
    p.position.set(x || 0, y || 0, z || 0);
    if (parent) parent.add(p);
    return p;
  }

  /** Owned emissive material — a creature that animates its glow owns a copy. */
  function glowMat(owner, color, intensity, base) {
    const m = new THREE.MeshStandardMaterial({
      color: base === undefined ? 0x140804 : base, emissive: color, emissiveIntensity: intensity,
      roughness: 0.45, metalness: 0.0,
    });
    m.name = 'cb.creature.glow.' + owner.kind;
    return owner.own(m);
  }

  /* -------------------------------------------------- the "!" notice emote */

  const EMOTE_COLOR = 0xffd54a;
  function emoteGeo() {
    return cached('cr:emote', () => {
      const bar = normalizeAttrs(bevelBoxGeometry(0.12, 0.36, 0.12, 0.045, 1));
      bar.translate(0, 0.33, 0);
      const bar2 = normalizeAttrs(bevelBoxGeometry(0.16, 0.10, 0.14, 0.03, 1));
      bar2.translate(0, 0.5, 0);
      const dot = normalizeAttrs(sphereGeo(0.075, 10, 8));
      const g = mergeGeometries([bar, bar2, dot], false);
      bar.dispose(); bar2.dispose(); dot.dispose();
      g.computeBoundingSphere();
      return g;
    });
  }

  /* ------------------------------------------------ dizzy stars (a ring) */

  const STAR_N = 4;
  class StarRing {
    constructor(parent) {
      const g = cached('cr:star', () => { const s = prismGeometry(0.09, 0.035, 5, 1); s.rotateX(Math.PI / 2); s.computeBoundingSphere(); return s; });
      this.mesh = new THREE.InstancedMesh(g, getEmissive(0xffe066, 3.0), STAR_N);
      this.mesh.name = 'dizzyStars';
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      this.mesh.castShadow = false;
      this.mesh.visible = false;
      parent.add(this.mesh);
    }
    show(on) { this.mesh.visible = !!on; }
    update(t, x, y, z, r) {
      if (!this.mesh.visible) return;
      for (let i = 0; i < STAR_N; i++) {
        const a = t * 5.5 + (i / STAR_N) * TAU;
        _a.set(x + Math.cos(a) * r, y + 0.06 * Math.sin(a * 2), z + Math.sin(a) * r);
        _q.setFromAxisAngle(UPV, -a);
        _s.set(1, 1, 1);
        _m.compose(_a, _q, _s);
        this.mesh.setMatrixAt(i, _m);
      }
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* ------------------------------------------- telegraph ground markers */

  class MarkerSet {
    constructor(parent, n, color) {
      const g = cached('cr:marker', () => { const r = ringProfileGeometry(1, [0.07, 0.025, 0.012], 36, 1); r.computeBoundingSphere(); return r; });
      this.n = n;
      this.mesh = new THREE.InstancedMesh(g, getPulse(color === undefined ? 0xff5a2a : color, 2.2, 1.6, 11), n);
      this.mesh.name = 'markers';
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      this.mesh.castShadow = false;
      this.on = new Uint8Array(n);
      for (let i = 0; i < n; i++) this.off(i);
      this.mesh.visible = false;
      parent.add(this.mesh);
    }
    set(i, x, y, z, r) {
      _a.set(x, y + 0.05, z);
      _q.identity();
      _s.set(r, 1, r);
      _m.compose(_a, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.on[i] = 1;
      this.mesh.visible = true;
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    off(i) {
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
      this.on[i] = 0;
      let any = false;
      for (let k = 0; k < this.n; k++) if (this.on[k]) { any = true; break; }
      this.mesh.visible = any;
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    clear() { for (let i = 0; i < this.n; i++) this.off(i); }
  }

  /* ------------------------------------------------------- projectiles */

  /**
   * A fixed pool of projectiles drawn as ONE instanced mesh. Positions and
   * velocities are plain Float32Arrays; nothing allocates after construction.
   */
  class ShotSet {
    constructor(parent, n, geo, mat, name) {
      this.n = n;
      this.mesh = new THREE.InstancedMesh(geo, mat, n);
      this.mesh.name = name || 'shots';
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      this.mesh.castShadow = true;
      this.p = new Float32Array(n * 3);
      this.v = new Float32Array(n * 3);
      this.t = new Float32Array(n);
      this.life = new Float32Array(n);
      this.tx = new Float32Array(n * 3);      // aimed landing point (markers)
      this.scale = new Float32Array(n);
      this.on = new Uint8Array(n);
      this.hit = new Uint8Array(n);
      for (let i = 0; i < n; i++) this.scale[i] = 1;
      parent.add(this.mesh);
      this.clear();
    }
    free() { for (let i = 0; i < this.n; i++) if (!this.on[i]) return i; return -1; }
    fire(i, px, py, pz, vx, vy, vz, life) {
      const k = i * 3;
      this.p[k] = px; this.p[k + 1] = py; this.p[k + 2] = pz;
      this.v[k] = vx; this.v[k + 1] = vy; this.v[k + 2] = vz;
      this.t[i] = 0; this.life[i] = life; this.on[i] = 1; this.hit[i] = 0; this.scale[i] = 1;
      this.mesh.visible = true;
    }
    kill(i) {
      this.on[i] = 0;
      _m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
    clear() { for (let i = 0; i < this.n; i++) this.kill(i); this.mesh.visible = false; }
    /** Ballistic step for every live shot (gravity g, m/s²). */
    step(dt, g) {
      for (let i = 0; i < this.n; i++) {
        if (!this.on[i]) continue;
        const k = i * 3;
        this.v[k + 1] -= g * dt;
        this.p[k] += this.v[k] * dt; this.p[k + 1] += this.v[k + 1] * dt; this.p[k + 2] += this.v[k + 2] * dt;
        this.t[i] += dt;
      }
    }
    /** Write every live shot's matrix, spinning about its velocity's side axis. */
    write(spin) {
      let any = false;
      for (let i = 0; i < this.n; i++) {
        if (!this.on[i]) continue;
        any = true;
        const k = i * 3;
        _a.set(this.p[k], this.p[k + 1], this.p[k + 2]);
        _b.set(this.v[k + 2], 0, -this.v[k]);
        if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0); else _b.normalize();
        _q.setFromAxisAngle(_b, this.t[i] * spin);
        const sc = this.scale[i];
        _s.set(sc, sc, sc);
        _m.compose(_a, _q, _s);
        this.mesh.setMatrixAt(i, _m);
      }
      this.mesh.visible = any;
      if (any) this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* =========================================================================
   * 3. Creature — the shared base of the roster (and of the realm bosses)
   * ====================================================================== */

  class Creature extends Critter {
    constructor(def, ctx, kind, info) {
      super(def, ctx, kind);
      this.info = info || CREATURE_INFO[kind] || { notice: 8, coins: 3, respawn: 0, emoteY: 1.4, defeatT: 1.0, name: kind.toUpperCase() };
      const d = this.def;
      this.displayName = String(d.name || this.info.name || kind.toUpperCase());
      this.home = new THREE.Vector3();
      const first = Array.isArray(d.path) && d.path.length ? d.path[0] : null;
      readV3(d.p || first, this.home);
      /* Authored yaw is CONTRACT yaw (0 faces -Z); the body faces +Z at yaw 0,
         so the body yaw is the authored one turned half a circle. */
      this.homeYaw = d.yaw !== undefined ? fin(d.yaw, 0) + Math.PI : 0;
      this.yaw = this.homeYaw;
      this.groundY = this._groundY(this.home.x, this.home.y + 0.5, this.home.z, this.home.y);
      this.home.y = this.groundY;
      this.pos.copy(this.home);
      this.state = 'idle';
      this.startState = 'idle';
      this.stateT = 0;
      this.noticeR = Math.max(1, fin(d.notice, this.info.notice));
      this.reward = Math.max(0, Math.round(fin(d.coins, this.info.coins)));
      this.respawnDelay = Math.max(0, fin(d.respawn, this.info.respawn || 0));
      this.range = Math.max(2, fin(d.range, 9));
      this.defeated = false;
      this.defeatHow = null;
      this.defeats = 0;
      this.hitCd = 0;
      this.aware = false;
      this.lostT = 0;
      this.notices = 0;
      this.emoteT = -1;
      this.emote = null;
      this.isEnemy = true;
      /* the player, sensed once per frame (see _sense) */
      this._alive = false; this._px = 0; this._py = 0; this._pz = 0;
      this._pdx = 0; this._pdz = 0; this._pd = 1e9; this._pvy = 0; this._pgr = false;
      /* last frame's player snapshot, for the stomp test */
      this._pValid = false; this._pY = 0; this._pVy = 0;
      this.stompCount = 0;
    }

    /* ---- construction helpers ------------------------------------------ */

    _initEmote() {
      const m = new THREE.Mesh(emoteGeo(), getEmissive(EMOTE_COLOR, 2.6));
      m.name = 'noticeEmote';
      m.castShadow = false;
      m.visible = false;
      m.frustumCulled = false;
      this.rig.add(m);
      this.emote = m;
    }

    _bounceBox(hx, hy, hz, power) {
      return this._solidBox(this.pos.x, this.pos.y + hy, this.pos.z, hx, hy, hz, 'bounce', { power: power || 2.4 });
    }

    _setColliders(on) {
      for (let i = 0; i < this.colliders.length; i++) this.colliders[i].active = !!on;
    }

    /* ---- per-frame senses ------------------------------------------------ */

    _sense(player) {
      this._alive = !!player && !player.dead;
      if (player) {
        const pp = player.pos || player.position;
        this._px = pp.x; this._py = pp.y; this._pz = pp.z;
        this._pdx = pp.x - this.pos.x; this._pdz = pp.z - this.pos.z;
        this._pd = Math.sqrt(this._pdx * this._pdx + this._pdz * this._pdz);
        this._pvy = player.vel ? player.vel.y : 0;
        this._pgr = player.grounded === true;
      } else {
        this._pd = 1e9;
      }
    }

    /** Returns true on the frame it NOTICES the hero. */
    _updateAware(dt) {
      const near = this._alive && this._pd < this.noticeR && Math.abs(this._py - this.pos.y) < 4.5;
      if (near) {
        this.lostT = 0;
        if (!this.aware) { this.aware = true; this._notice(); return true; }
      } else if (this.aware) {
        this.lostT += dt;
        if (this.lostT > LOST_AFTER) { this.aware = false; this.events.emit('lost', this); }
      }
      return false;
    }

    _notice() {
      this.notices++;
      this.emoteT = 0;
      if (this.emote) this.emote.visible = true;
      this._sfx('ui_move', this.pos, 1.7, 0.55);
      this.events.emit('notice', this);
    }

    _tickEmote(dt) {
      const m = this.emote;
      if (!m || this.emoteT < 0) return;
      this.emoteT += dt;
      const t = this.emoteT;
      const k = t < 0.22 ? easeOutBack(t / 0.22, 2.2) : (t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.15) : 1);
      m.scale.setScalar(Math.max(0.001, k));
      m.position.set(this.pos.x, this.pos.y + this.info.emoteY + 0.08 * Math.sin(t * 9), this.pos.z);
      m.rotation.y = this.yaw + 0.25 * Math.sin(t * 12);
      if (t >= 0.9) { this.emoteT = -1; m.visible = false; }
    }

    _faceHero(rate, dt) {
      if (this._alive) this.yaw = dampAngle(this.yaw, Math.atan2(this._pdx, this._pdz), rate, dt);
    }

    /** Point a pair of googly eyes at the hero. */
    _lookEyes(eyes, eyeY) {
      if (!eyes) return;
      if (!this._alive) { eyes.look(0, 0); return; }
      const rel = wrapAngle(Math.atan2(this._pdx, this._pdz) - this.yaw);
      eyes.look(clamp(rel / 1.25, -1, 1), clamp((this._py + 1.0 - (this.pos.y + eyeY)) / 3, -1, 1));
    }

    /**
     * STOMP: the hero came DOWN onto a top at `topY` inside radius r. Uses last
     * frame's snapshot (falling, above the top) against this frame (landed,
     * bounced off it, or at it), so a bounce surface that launched him in the
     * same step still counts. A hero who walks under or beside never does.
     */
    _stompedOn(cx, cz, r, topY) {
      if (!this._alive || !this._pValid) return false;
      if (this._pVy > -0.5 || this._pY < topY - 0.25) return false;
      const dx = this._px - cx, dz = this._pz - cz;
      if (dx * dx + dz * dz > r * r) return false;
      const landed = this._pgr || this._pvy > 1.0 || this._py <= topY + 0.12;
      return landed && this._py <= topY + 0.9 && this._py >= topY - 0.45;
    }

    /** Side contact: capsule vs sphere, with the hit cooldown. */
    _bump(player, cx, cy, cz, r, kb, stun, cd) {
      if (!this._alive || this.hitCd > 0) return false;
      if (!capsuleHitsSphere(capsuleOf(player), cx, cy, cz, r)) return false;
      this.hitCd = cd === undefined ? 0.8 : cd;
      this._hurt(player, this._px - cx, this._pz - cz, kb, stun);
      this.events.emit('bump', this);
      return true;
    }

    /** Pound in range of a point (pos may be a Collider from the controller). */
    _poundNear(player, pos, cx, cy, cz, r) {
      const p = (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) ? pos : (player && (player.pos || player.position));
      if (!p) return false;
      const dx = p.x - cx, dz = p.z - cz;
      return dx * dx + dz * dz <= r * r && Math.abs(p.y - cy) < 2.4;
    }

    _groundAt(x, z, y) {
      return this._groundY(x, y, z, NaN);
    }

    /** Is a straight path from here toward (dx, dz) walkable for `ahead` metres? */
    _clearAhead(dx, dz, ahead, maxDrop) {
      const w = this.world;
      if (!w || typeof w.raycast !== 'function') return true;
      const l = Math.hypot(dx, dz);
      if (l < 1e-6) return true;
      _a.set(this.pos.x, this.pos.y + 0.45, this.pos.z);
      _b.set(dx / l, 0, dz / l);
      _ray.t = 0; _ray.collider = null;
      let hit = false;
      try { hit = w.raycast(_a, _b, ahead, _ray); } catch (e) { hit = false; }
      if (hit && !(_ray.collider && _ray.collider.ref === this)) return false;
      const gx = this.pos.x + _b.x * ahead, gz = this.pos.z + _b.z * ahead;
      const gy = this._groundY(gx, this.pos.y + 0.6, gz, NaN);
      if (!Number.isFinite(gy)) return false;
      return gy > this.pos.y - (maxDrop === undefined ? 0.8 : maxDrop);
    }

    /* ---- defeat / reward / respawn -------------------------------------- */

    _defeat(how) {
      if (this.defeated || this.state === 'gone') return false;
      this.defeated = true;
      this.defeatHow = how || 'stomp';
      this.defeats++;
      this._enter('defeat');
      this._setColliders(false);
      for (let i = 0; i < this.kills.length; i++) this.kills[i].active = false;
      this.linVel.set(0, 0, 0);
      this._sfx('bumbler_squish', this.pos, 1.15, 1.0);
      this._burst('squish', this.pos, this.accentColor, 0.9);
      this._shake(0.06, 120);
      this._reward();
      this._onDefeat(this.defeatHow);
      this.events.emit('defeated', this, this.defeatHow);
      return true;
    }

    _reward() {
      if (this.reward <= 0) return;
      _rewardPos.set(this.pos.x, this.pos.y + 0.6, this.pos.z);
      for (let i = 0; i < Math.min(3, this.reward); i++) {
        _rw.set(_rewardPos.x + Math.cos(i * 2.09) * 0.3, _rewardPos.y, _rewardPos.z + Math.sin(i * 2.09) * 0.3);
        this._burst('coin', _rw, this.coinColor, 0.8);
      }
      this._sfx('coin', _rewardPos, 1.2, 0.8);
      this.events.emit('coins', this.reward, _rewardPos);
    }

    _vanish() {
      this._enter('gone');
      this.body.visible = false;
      this._burst('dust', this.pos, 0xd8cfc0, 0.7);
      this._onVanish();
    }

    _respawn() {
      this.defeated = false;
      this.defeatHow = null;
      this.aware = false;
      this.lostT = 0;
      this._resetKind();
      this.body.visible = true;
      this._setColliders(true);
      this._enter('respawn');
      this._burst('dust', this.pos, 0xd8cfc0, 0.6);
      this._sfx('bounce', this.pos, 1.5, 0.5);
    }

    _enter(s) {
      this.state = s;
      this.stateT = 0;
      this._onEnter(s);
      this.events.emit('state', s, this);
    }

    /* ---- the frame ------------------------------------------------------- */

    update(dt, player) {
      super.update(dt, player);
      if (!this.enabled) return;
      this.stateT += dt;
      if (this.hitCd > 0) this.hitCd -= dt;
      this._sense(player);
      const ox = this.pos.x, oy = this.pos.y, oz = this.pos.z;
      const st = this.state;
      if (st === 'defeat') {
        if (this.stateT >= this.info.defeatT) this._vanish();
      } else if (st === 'gone') {
        if (this.respawnDelay > 0 && this.stateT >= this.respawnDelay) this._respawn();
      } else if (st === 'respawn') {
        if (this.stateT >= RESPAWN_POP) this._enter(this.startState);
      } else {
        this._think(dt, player);
      }
      this._always(dt, player);
      this._tickEmote(dt);
      if (this.state !== 'gone') this._pose(dt);
      this._syncColliders();
      const inv = 1 / Math.max(dt, 1e-4);
      if (this.state === 'defeat' || this.state === 'gone') this.linVel.set(0, 0, 0);
      else this.linVel.set((this.pos.x - ox) * inv, (this.pos.y - oy) * inv, (this.pos.z - oz) * inv);
      this._pY = this._py; this._pVy = this._pvy; this._pValid = this._alive;
    }

    /** Respawn pop: 0 -> 1 with overshoot, for subclasses' `_pose`. */
    get popK() {
      if (this.state !== 'respawn') return 1;
      return Math.max(0.01, easeOutBack(clamp(this.stateT / RESPAWN_POP, 0, 1), 1.8));
    }

    get defeatU() { return this.state === 'defeat' ? clamp(this.stateT / this.info.defeatT, 0, 1) : 0; }

    /* ---- hooks the roster overrides --------------------------------------- */

    _think(/* dt, player */) {}
    /** Runs every frame in every state, defeat and gone included (arena machinery). */
    _always(/* dt, player */) {}
    _pose(/* dt */) {}
    _syncColliders() {}
    _onEnter(/* state */) {}
    _onDefeat(/* how */) {}
    _onVanish() {}
    _resetKind() {}
    _strikeable() { return true; }

    /** Punch / kick / slide-kick / thrown object / dive (the hero lane's verbs). */
    onStrike(player, kind /* , pos, dir */) {
      if (this.defeated || this.state === 'gone' || this.state === 'respawn') return false;
      if (!this._strikeable(kind)) return false;
      return this._defeat(kind || 'strike');
    }

    onDive(player) { return this.onStrike(player, 'dive'); }

    onStand(player) {
      /* the course's stand-transition hook: a hero who ends up standing on the
         creature's top is a stomp (the controller already bounced him off) */
      if (this.defeated || !this._stompable()) return;
      this.stompCount++;
      this._onStomp(player);
    }

    _stompable() { return true; }
    _onStomp(/* player */) { this._defeat('stomp'); }

    /* ---- lifecycle -------------------------------------------------------- */

    _reset() {
      this.defeated = false; this.defeatHow = null;
      this.aware = false; this.lostT = 0; this.hitCd = 0;
      this.emoteT = -1; if (this.emote) this.emote.visible = false;
      this.pos.copy(this.home); this.yaw = this.homeYaw;
      this._pValid = false;
      this.body.visible = true;
      this._setColliders(true);
      this._resetKind();
      this.state = this.startState; this.stateT = 0;
      this._pose(0);
      this._syncColliders();
    }
  }

  /* =========================================================================
   * 4. VERDANT — BURROWER
   *    A star-nosed digger. Lurks with its nose out of a dirt mound; on notice
   *    it dives and a mound runs at you, stops and TREMBLES under your feet
   *    (0.65 s, a pulsing ring on the ground), then it bursts up — a fair toss —
   *    and stands DAZED for 2 s: stomp it. Pound the ground near a running mound
   *    to flush it out early (dazed longer, no toss).
   * ====================================================================== */

  const BR_TELE = 0.65, BR_POP = 0.32, BR_DAZE = 2.0, BR_FLUSH_DAZE = 2.8, BR_DIG = 0.45, BR_SPEED = 3.3;
  const BR_TOP = 0.95;

  class Burrower extends Creature {
    constructor(def, ctx) {
      super(def, ctx, 'burrower');
      this.naturalHeight = 1.0;
      this.startState = 'lurk';
      this.state = 'lurk';
      this.rise = -0.62;          // torso height: -0.62 nose out, -1.1 buried, 0 standing
      this.moundK = 1;            // mound scale
      this.sniffT = 0;
      this.tunnelT = 0;
      this.trailT = 0;
      this.dazeFor = BR_DAZE;
      this.flushed = false;
      this.target = new THREE.Vector3();
      this._build();
      this._initEmote();
      this.stars = new StarRing(this.rig);
      this.marks = new MarkerSet(this.rig, 1, 0xffb23a);
      this._mergeGroup(this.body, 'burrower_body');
      this.col = this._bounceBox(0.42, BR_TOP * 0.5, 0.42, 2.4);
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const fur = skinMat(fin(this.def.color, 0x5b4636), 0.9, 0.0);
      const belly = skinMat(0x8a6f58, 0.9, 0.0);
      const pink = skinMat(0xf08aa0, 0.55, 0.0);
      const ivory = skinMat(0xefe4c8, 0.4, 0.0);
      const dirt = skinMat(0x6b4a2e, 0.97, 0.0);
      const pebble = skinMat(0x8d8378, 0.8, 0.0);
      const body = pivot('body', null);
      // the mound (stays at ground level; is the hole rim when it stands)
      this.mound = pivot('mound', body, 0, 0, 0);
      const mParts = [{ g: ell(0.62, 1, 0.42, 1, 0, 0.0, 0, 18, 10), m: dirt }];
      for (let i = 0; i < 7; i++) {
        const a = i * 0.9 + 0.3, rr = 0.46 + (i % 3) * 0.08;
        mParts.push({ g: ell(0.07 + (i % 2) * 0.03, 1, 0.7, 1, Math.cos(a) * rr, 0.1, Math.sin(a) * rr, 8, 6), m: pebble });
      }
      this.mound.add(mergeParts(mParts, 'mound'));
      // the torso rises out of the mound
      this.torso = pivot('torso', body, 0, this.rise, 0);
      this.torso.add(mergeParts([
        { g: ell(0.42, 1.0, 1.08, 1.12, 0, 0.46, 0), m: fur },
        { g: ell(0.3, 1, 1.1, 0.6, 0, 0.36, 0.22), m: belly },
        { g: spike(0.05, 0.16, 5, -0.05, 0.9, -0.02, 0.2, 0, 0.25), m: fur },
        { g: spike(0.05, 0.19, 5, 0.03, 0.9, 0.0, -0.1, 0, -0.15), m: fur },
        { g: spike(0.04, 0.13, 5, 0.1, 0.88, -0.04, 0.15, 0, -0.5), m: fur },
        { g: limbZ(0.05, 0.12, 0, 0.3, -0.42, Math.PI * 0.85, 0, 0), m: pink },
      ], 'torso'));
      // snout + the star nose on its own pivot so it can wiggle
      this.snout = pivot('snout', this.torso, 0, 0.56, 0.36);
      const nParts = [{ g: limbZ(0.1, 0.12, 0, 0, 0, 0.1, 0, 0), m: fur }];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        nParts.push({ g: spike(0.028, 0.13, 5, Math.cos(a) * 0.05, Math.sin(a) * 0.05, 0.3, Math.PI / 2 + Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9), m: pink });
      }
      nParts.push({ g: ell(0.05, 1, 1, 0.7, 0, 0, 0.3), m: pink });
      this.snout.add(mergeParts(nParts, 'starNose'));
      this.eyes = makeEyes(0.055, 0.2, 0, 0.72, 0.3, -0.2);
      this.torso.add(this.eyes.group);
      // spade claws
      const mkArm = (side) => {
        const arm = pivot(side < 0 ? 'armL' : 'armR', this.torso, side * 0.36, 0.42, 0.18);
        const parts = [
          { g: limbZ(0.07, 0.14, 0, 0, 0, 0.5, side * 0.3, 0), m: fur },
          { g: place(bbox(0.26, 0.05, 0.2, 0.02), side * 0.03, -0.12, 0.26, 0.6, 0, 0), m: pink },
        ];
        for (let k = 0; k < 4; k++) parts.push({ g: spike(0.025, 0.14, 4, side * 0.03 + (k - 1.5) * 0.06, -0.17, 0.35, 1.9, 0, 0), m: ivory });
        arm.add(mergeParts(parts, 'claw'));
        return arm;
      };
      this.armL = mkArm(-1);
      this.armR = mkArm(1);
      this.body = body;
      this.rig.add(body);
    }

    _resetKind() {
      this.rise = -0.62; this.moundK = 1; this.sniffT = 0; this.tunnelT = 0; this.trailT = 0;
      this.dazeFor = BR_DAZE; this.flushed = false;
      this.stars.show(false);
      this.marks.clear();
      this.target.copy(this.home);
      this.col.active = false;
    }

    _stompable() { return this.state === 'dazed' || this.state === 'pop' || this.state === 'dig'; }
    _strikeable() { return this._stompable(); }

    _onEnter(s) {
      if (s === 'dive') { this._burst('dust', this.pos, 0x6b4a2e, 0.8); this._sfx('step_sand', this.pos, 0.7, 0.8); }
      else if (s === 'tele') { this.marks.set(0, this.pos.x, this.pos.y, this.pos.z, 0.95); this._sfx('vanish_warn', this.pos, 0.55, 0.9); }
      else if (s === 'pop') {
        this.marks.off(0);
        this._burst('dust', this.pos, 0x6b4a2e, 1.2);
        this._sfx('bounce', this.pos, 0.7, 1.0);
        this._shake(0.08, 140);
      } else if (s === 'dazed') { this.stars.show(true); this._sfx('skitter', this.pos, 0.6, 0.4); }
      else if (s === 'dig') { this.stars.show(false); this._burst('dust', this.pos, 0x6b4a2e, 0.9); this._sfx('step_sand', this.pos, 0.8, 0.8); }
      else if (s === 'defeat') { this.stars.show(false); this.marks.clear(); }
    }

    _think(dt, player) {
      const seen = this._updateAware(dt);
      switch (this.state) {
        case 'lurk': {
          // nose out, sniffing; turns toward the hero when near
          this.rise = damp(this.rise, -0.62, 6, dt);
          this.moundK = damp(this.moundK, 1, 6, dt);
          if (this._pd < this.noticeR + 3) this._faceHero(2.5, dt);
          if (seen) this._enter('dive');
          break;
        }
        case 'dive': {
          this.rise = damp(this.rise, -1.15, 14, dt);
          if (this.stateT >= 0.35) { this.tunnelT = 0; this._enter('tunnel'); }
          break;
        }
        case 'tunnel': {
          this.tunnelT += dt;
          this.rise = -1.15;
          // head for the hero, but never beyond its range from home
          let tx = this._px, tz = this._pz;
          const hx = tx - this.home.x, hz = tz - this.home.z;
          const hd = Math.hypot(hx, hz);
          if (hd > this.range) { tx = this.home.x + hx / hd * this.range; tz = this.home.z + hz / hd * this.range; }
          if (!this.aware) { tx = this.home.x; tz = this.home.z; }
          const dx = tx - this.pos.x, dz = tz - this.pos.z;
          const d = Math.hypot(dx, dz);
          if (d > 0.05) {
            const step = Math.min(d, BR_SPEED * dt);
            const nx = this.pos.x + dx / d * step, nz = this.pos.z + dz / d * step;
            const gy = this._groundY(nx, this.pos.y + 0.8, nz, NaN);
            if (Number.isFinite(gy) && Math.abs(gy - this.pos.y) < 0.8) {
              this.pos.x = nx; this.pos.z = nz; this.pos.y = gy;
            }
            this.yaw = Math.atan2(dx, dz);
          }
          this.trailT -= dt;
          if (this.trailT <= 0) { this.trailT = 0.28; this._burst('dust', this.pos, 0x6b4a2e, 0.45); this._sfx('step_sand', this.pos, 0.55, 0.35); }
          if (!this.aware && d < 0.2) { this._enter('lurk'); break; }
          const onHero = this._alive && this._pd < 0.45 && Math.abs(this._py - this.pos.y) < 1.3;
          if (this.aware && (onHero || this.tunnelT > 3.2 || d < 0.1)) this._enter('tele');
          break;
        }
        case 'tele': {
          this.rise = -1.15;
          this.moundK = 1 + 0.12 * Math.abs(Math.sin(this.stateT * 38));
          if (this.stateT >= BR_TELE) { this.dazeFor = BR_DAZE; this.flushed = false; this._enter('pop'); }
          break;
        }
        case 'pop': {
          const u = clamp(this.stateT / BR_POP, 0, 1);
          this.rise = -1.15 + 1.25 * easeOutBack(u, 2.4);
          this.moundK = damp(this.moundK, 0.75, 10, dt);
          if (!this.flushed && this.stateT < 0.2 && this._alive && this._pd < 0.95 &&
              this._py > this.pos.y - 0.3 && this._py < this.pos.y + 1.3 && player) {
            if (this._bump(player, this.pos.x, this.pos.y + 0.5, this.pos.z, 0.9, 4.5, 0.35, 1.0) && player.vel) {
              if (player.vel.y < 7.5) player.vel.y = 7.5;
            }
          }
          if (u >= 1) this._enter('dazed');
          break;
        }
        case 'dazed': {
          this.rise = damp(this.rise, 0, 10, dt);
          if (this.stateT >= this.dazeFor) this._enter('dig');
          break;
        }
        case 'dig': {
          this.rise = damp(this.rise, -1.15, 9, dt);
          this.moundK = damp(this.moundK, 1, 8, dt);
          if (this.stateT >= BR_DIG) { this.tunnelT = 0; this._enter('tunnel'); }
          break;
        }
      }
      if (this.state === 'dazed' || this.state === 'pop' || this.state === 'dig') {
        if (this._stompedOn(this.pos.x, this.pos.z, 0.75, this.pos.y + BR_TOP)) { this.stompCount++; this._defeat('stomp'); }
      }
    }

    onPound(player, pos) {
      if (this.defeated || this.state === 'gone') return;
      if (!this._poundNear(player, pos, this.pos.x, this.pos.y, this.pos.z, 2.3)) return;
      if (this._stompable()) { this._defeat('pound'); return; }
      /* flush it out: pounding the ground over a running mound brings it up dazed, no toss */
      if (this.state === 'tunnel' || this.state === 'tele' || this.state === 'dive' || this.state === 'lurk') {
        this.aware = true;
        this.flushed = true;
        this.dazeFor = BR_FLUSH_DAZE;
        this.marks.clear();
        this._enter('pop');
      }
    }

    _pose(dt) {
      const t = this.time;
      const k = this.popK;
      const b = this.body;
      b.position.copy(this.pos);
      b.rotation.set(0, this.yaw, 0);
      b.scale.set(k, k, k);
      let rise = this.rise;
      let sq = 1, spread = 1, spin = 0;
      if (this.state === 'defeat') {
        const u = this.defeatU;
        sq = 1 - 0.7 * smoothstep(0, 0.25, u);
        spread = 1 + 0.4 * smoothstep(0, 0.25, u);
        rise = -1.2 * smoothstep(0.35, 1, u);
        spin = u * 9;
      }
      this.torso.position.y = rise;
      this.torso.scale.set(spread, sq, spread);
      this.torso.rotation.y = spin;
      const dazed = this.state === 'dazed';
      this.torso.rotation.z = dazed ? 0.18 * Math.sin(t * 4.1) : 0;
      this.torso.rotation.x = dazed ? 0.1 * Math.sin(t * 3.3) : (this.state === 'lurk' ? 0.12 * Math.sin(t * 1.7) : 0);
      this.mound.scale.set(this.moundK, this.state === 'lurk' || this.state === 'tunnel' || this.state === 'tele' || this.state === 'dive' ? this.moundK : 0.55, this.moundK);
      // the nose never stops: a sniff in the lurk, a frantic wiggle in the telegraph
      const wig = this.state === 'tele' ? 0.35 : 0.12;
      this.snout.rotation.set(wig * Math.sin(t * (this.state === 'lurk' ? 9 : 17)), wig * Math.sin(t * 6.3), 0);
      const armUp = this.state === 'pop' ? -1.4 : (dazed ? -0.3 + 0.3 * Math.sin(t * 5) : 0.35);
      this.armL.rotation.set(armUp, 0, dazed ? 0.4 : 0.1);
      this.armR.rotation.set(dazed ? -0.3 - 0.3 * Math.sin(t * 5) : armUp, 0, dazed ? -0.4 : -0.1);
      this._lookEyes(this.eyes, 0.72 + rise);
      if (dazed) this.eyes.look(0.6 * Math.sin(t * 7), 0.4 * Math.cos(t * 7));
      this.stars.update(t, this.pos.x, this.pos.y + rise + 1.05, this.pos.z, 0.34);
    }

    _syncColliders() {
      this.col.setCenter(this.pos.x, this.pos.y + BR_TOP * 0.5, this.pos.z);
      this.col.active = !this.defeated && (this.state === 'dazed' || this.state === 'dig' || (this.state === 'pop' && this.stateT > 0.15));
    }
  }

  /* =========================================================================
   * 5. VERDANT — PODSPITTER
   *    A rooted pod on a three-bone stalk. Sways and breathes; on notice the
   *    stalk snaps upright and the pod turns to you. Telegraph: the pod SWELLS
   *    and its lips glow for 0.75 s while a ring marks where the seed will
   *    land (where you stood). The seed arcs in ~0.8 s. Stomp the pod (it hangs
   *    at single-jump height) or pound its root.
   * ====================================================================== */

  const PS_TELE = 0.75, PS_RECOVER = 1.35, PS_G = 16, PS_SEG = 0.34;

  class Podspitter extends Creature {
    constructor(def, ctx) {
      super(def, ctx, 'podspitter');
      this.naturalHeight = 1.5;
      this.lean = 0; this.leanZ = 0; this.swell = 1; this.glow = 0; this.snap = 0; this.upright = 0;
      this.aimX = 0; this.aimZ = 0;
      this.cool = 0;
      this.podW = new THREE.Vector3();
      this._build();
      this._initEmote();
      this.marks = new MarkerSet(this.rig, 2, 0xff7a2a);
      const seedGeo = cached('ps:seed', () => {
        const g = mergeGeometries([normalizeAttrs(ell(0.13, 1, 0.8, 1.25, 0, 0, 0, 12, 8)),
          normalizeAttrs(spike(0.04, 0.1, 5, 0, 0.08, -0.12, -0.6, 0, 0))], false);
        g.computeBoundingSphere();
        return g;
      });
      this.seeds = new ShotSet(this.rig, 2, seedGeo, skinMat(0x7a5a2a, 0.6, 0.0), 'seeds');
      this._mergeGroup(this.body, 'podspitter_body');
      this.col = this._solidBox(this.pos.x, this.pos.y + 1.2, this.pos.z, 0.32, 0.22, 0.32, 'bounce', { power: 2.4 });
      this.stemCol = this._solidBox(this.pos.x, this.pos.y + 0.45, this.pos.z, 0.14, 0.45, 0.14, 'normal', null);
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const leaf = skinMat(fin(this.def.color, 0x3f8f3a), 0.6, 0.0);
      const leafDark = skinMat(0x2d6a2c, 0.65, 0.0);
      const stalk = skinMat(0x5d8a34, 0.7, 0.0);
      const podC = skinMat(0xb54a3a, 0.5, 0.0);
      const spot = skinMat(0xf2d49a, 0.55, 0.0);
      const root = skinMat(0x4a3322, 0.9, 0.0);
      const body = pivot('body', null);
      const base = [{ g: ell(0.22, 1, 0.55, 1, 0, 0.06, 0, 12, 8), m: root }];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + 0.3;
        const g = ell(0.3, 0.45, 0.07, 1.0, 0, 0, 0.3, 12, 6);
        place(g, 0, 0.06, 0, -0.35, a, 0);
        base.push({ g, m: i & 1 ? leafDark : leaf });
      }
      body.add(mergeParts(base, 'leaves'));
      this.s1 = pivot('stalk1', body, 0, 0.1, 0);
      this.s2 = pivot('stalk2', this.s1, 0, PS_SEG, 0);
      this.s3 = pivot('stalk3', this.s2, 0, PS_SEG, 0);
      for (const s of [this.s1, this.s2, this.s3]) {
        s.add(mergeParts([{ g: place(capsuleGeo(0.065, PS_SEG * 0.8, 8), 0, PS_SEG * 0.5, 0), m: stalk },
          { g: place(ringProfileGeometry(0.07, [0.02, 0.02, 0.006], 10, 1), 0, PS_SEG, 0), m: leafDark }], 'stalk'));
      }
      this.pod = pivot('pod', this.s3, 0, PS_SEG + 0.18, 0);
      const pParts = [
        { g: ell(0.3, 1.0, 0.92, 1.12, 0, 0, 0), m: podC },
        { g: place(ringProfileGeometry(0.12, [0.035, 0.05, 0.015], 16, 1), 0, -0.02, 0.33, Math.PI / 2, 0, 0), m: podC },
        { g: place(ringProfileGeometry(0.09, [0.025, 0.04, 0.012], 14, 1), 0, -0.02, 0.38, Math.PI / 2, 0, 0), m: leafDark },
      ];
      for (let i = 0; i < 7; i++) {
        const a = i * 1.7, h = -0.1 + (i % 3) * 0.1;
        pParts.push({ g: ell(0.045, 1, 1, 0.5, Math.cos(a) * 0.26, h + 0.08, Math.sin(a) * 0.22 - 0.05, 8, 6), m: spot });
      }
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        const g = ell(0.18, 0.4, 0.06, 1, 0, 0, 0.16, 10, 6);
        place(g, 0, -0.22, 0, 0.55, a, 0);
        pParts.push({ g, m: leaf });
      }
      this.pod.add(mergeParts(pParts, 'pod'));
      this.eyes = makeEyes(0.075, 0.22, 0, 0.13, 0.22, -0.15);
      this.pod.add(this.eyes.group);
      // lips glow (own emissive: ramps in the telegraph)
      this.lipMat = glowMat(this, 0xffa040, 0.6, 0x301208);   // hot at build so the merge leaves it its own draw
      const lips = new THREE.Mesh(place(ringProfileGeometry(0.105, [0.02, 0.03, 0.01], 16, 1), 0, -0.02, 0.36, Math.PI / 2, 0, 0), this.lipMat);
      lips.castShadow = false;
      lips.name = 'lipsGlow';
      this.pod.add(lips);
      this.body = body;
      this.rig.add(body);
    }

    _resetKind() {
      this.lean = 0; this.leanZ = 0; this.swell = 1; this.glow = 0; this.snap = 0; this.upright = 0; this.cool = 0.4;
      this.seeds.clear();
      this.marks.clear();
      this.lipMat.emissiveIntensity = 0;
    }

    _onEnter(s) {
      if (s === 'tele') {
        this.aimX = this._px; this.aimZ = this._pz;
        const gy = this._groundY(this.aimX, this._py + 0.6, this.aimZ, this._py);
        this.aimY = gy;
        this.marks.set(0, this.aimX, gy, this.aimZ, 0.85);
        this._sfx('gnasher_bite', this.pos, 1.7, 0.45);
      } else if (s === 'spit') {
        this._spit();
      } else if (s === 'defeat') {
        this.marks.clear();
        this._burst('leafKick', this.pos, 0x5aa84a, 1.0);
        this.lipMat.emissiveIntensity = 0;
      }
    }

    _spit() {
      const i = this.seeds.free();
      if (i < 0) return;
      this.pod.getWorldPosition(this.podW);
      headingFrom(this.yaw, _c);
      const sx = this.podW.x + _c.x * 0.4, sy = this.podW.y, sz = this.podW.z + _c.z * 0.4;
      const dx = this.aimX - sx, dz = this.aimZ - sz;
      const dist = Math.hypot(dx, dz);
      const T = clamp(dist / 9, 0.55, 1.2);
      const dy = this.aimY - sy;
      const vy = (dy + 0.5 * PS_G * T * T) / T;
      this.seeds.fire(i, sx, sy, sz, dx / T, vy, dz / T, T + 0.4);
      this.seeds.tx[i * 3] = this.aimX; this.seeds.tx[i * 3 + 1] = this.aimY; this.seeds.tx[i * 3 + 2] = this.aimZ;
      this.snap = 1;
      this.swell = 0.8;
      this.glow = 0;
      this._sfx('cannon_fire', _b.set(sx, sy, sz), 1.9, 0.45);
      this._burst('leafKick', _b, 0x8ac04a, 0.4);
      this.events.emit('spit', this);
    }

    _think(dt, player) {
      const seen = this._updateAware(dt);
      if (this.cool > 0) this.cool -= dt;
      switch (this.state) {
        case 'idle':
          this.upright = damp(this.upright, 0, 3, dt);
          this.swell = damp(this.swell, 1, 5, dt);
          if (seen) { this.upright = 1; this.snap = 0.6; }
          if (this.aware) this._enter('aim');
          break;
        case 'aim':
          this.upright = damp(this.upright, 1, 8, dt);
          this._faceHero(6, dt);
          if (!this.aware) { this._enter('idle'); break; }
          if (this.stateT > 0.4 && this.cool <= 0 && this._pd > 1.2) this._enter('tele');
          break;
        case 'tele': {
          const u = clamp(this.stateT / PS_TELE, 0, 1);
          this._faceHero(4, dt);
          this.swell = 1 + 0.38 * smoothstep(0, 1, u) + 0.04 * Math.sin(this.stateT * 40);
          this.glow = u;
          if (u >= 1) this._enter('spit');
          break;
        }
        case 'spit':
          this.swell = damp(this.swell, 1, 10, dt);
          if (this.stateT >= 0.25) { this.cool = PS_RECOVER; this._enter('aim'); }
          break;
      }
      this.glow = this.state === 'tele' ? this.glow : damp(this.glow, 0, 8, dt);
      this.snap = damp(this.snap, 0, 7, dt);
      this._stepSeeds(dt, player);
      this.pod.getWorldPosition(this.podW);
      if (this._stompedOn(this.podW.x, this.podW.z, 0.55, this.podW.y + 0.24)) { this.stompCount++; this._defeat('stomp'); }
    }

    _stepSeeds(dt, player) {
      const S = this.seeds;
      S.step(dt, PS_G);
      for (let i = 0; i < S.n; i++) {
        if (!S.on[i]) continue;
        const k = i * 3;
        const x = S.p[k], y = S.p[k + 1], z = S.p[k + 2];
        // in flight: a seed that meets the hero knocks him
        if (!S.hit[i] && this._alive && player && capsuleHitsSphere(capsuleOf(player), x, y, z, 0.2)) {
          S.hit[i] = 1;
          this._hurt(player, this._px - x + S.v[k] * 0.1, this._pz - z + S.v[k + 2] * 0.1, 5, 0.3);
          this._burst('leafKick', _a.set(x, y, z), 0x8ac04a, 0.7);
          this._sfx('bumbler_squish', _a, 1.6, 0.6);
        }
        const land = S.v[k + 1] < 0 && y <= S.tx[k + 1] + 0.1;
        if (land || S.t[i] >= S.life[i]) {
          _a.set(x, Math.max(y, S.tx[k + 1]), z);
          this._burst('dust', _a, 0x7a5a2a, 0.6);
          this._sfx('step_grass', _a, 1.3, 0.6);
          if (!S.hit[i] && this._alive && player) {
            const dx = this._px - x, dz = this._pz - z;
            if (dx * dx + dz * dz < 0.9 * 0.9 && this._py > _a.y - 0.4 && this._py < _a.y + 1.4) {
              this._hurt(player, dx, dz, 5, 0.3);
            }
          }
          S.kill(i);
          this.marks.off(0);
        }
      }
      S.write(9);
    }

    onPound(player, pos) {
      if (this.defeated || this.state === 'gone') return;
      if (this._poundNear(player, pos, this.pos.x, this.pos.y, this.pos.z, 1.8)) this._defeat('pound');
    }

    _pose(dt) {
      const t = this.time;
      const k = this.popK;
      const b = this.body;
      b.position.copy(this.pos);
      b.rotation.set(0, this.yaw, 0);
      b.scale.set(k, k, k);
      const wind = (1 - this.upright) * 0.12;
      let bend = wind * Math.sin(t * 1.3), side = wind * Math.sin(t * 0.9 + 1);
      // lean the pod toward you in the telegraph, whip forward on the spit
      bend += this.state === 'tele' ? -0.18 * this.glow : 0;
      bend += this.snap * 0.55;
      let droop = 0;
      if (this.state === 'defeat') droop = smoothstep(0, 1, this.defeatU);
      this.s1.rotation.set(bend * 0.6 + droop * 0.5, 0, side);
      this.s2.rotation.set(bend * 0.8 + droop * 0.6, 0, side * 0.7);
      this.s3.rotation.set(bend + droop * 0.7, 0, side * 0.5);
      const breathe = 1 + 0.03 * Math.sin(t * 2.2);
      const sw = this.swell * breathe * (1 - 0.6 * droop);
      this.pod.scale.set(sw, sw * (this.state === 'spit' ? 0.85 : 1), sw);
      this.lipMat.emissiveIntensity = 3.2 * this.glow * (0.7 + 0.3 * Math.sin(t * 30));
      this._lookEyes(this.eyes, 1.2);
      if (this.state === 'defeat') this.eyes.look(0, -1);
    }

    _syncColliders() {
      this.pod.getWorldPosition(this.podW);
      this.col.setCenter(this.podW.x, this.podW.y + 0.02, this.podW.z);
      this.stemCol.setCenter(this.pos.x, this.pos.y + 0.45, this.pos.z);
      const on = !this.defeated && this.state !== 'gone';
      this.col.active = on; this.stemCol.active = on;
    }
  }

  /* =========================================================================
   * 6. EMBER — SLAG CRAB
   *    A basalt-shelled crab with glowing seams. Scuttles sideways along its
   *    path; on notice its eye stalks shoot up and it sidles at you. Close in:
   *    the big claw rises and opens, the seams flare (0.6 s), then it SNAPS.
   *    Jump at it and it hunkers into its hot shell — a stomp just bounces off
   *    (clonk). Answers: bait the snap and stomp it while it recovers, or POUND
   *    beside it to flip it on its back, then stomp.
   * ====================================================================== */

  const SC_TELE = 0.6, SC_SNAP = 0.25, SC_RECOVER = 0.95, SC_FLIP = 2.6, SC_TOP = 0.72;

  class SlagCrab extends Creature {
    constructor(def, ctx) {
      super(def, ctx, 'slagcrab');
      this.naturalHeight = 0.8;
      this.startState = 'scuttle';
      this.state = 'scuttle';
      const d = this.def;
      const src = Array.isArray(d.path) && d.path.length >= 2 ? d.path : null;
      this.n = src ? src.length : 0;
      if (src) {
        this.pts = new Float32Array(this.n * 3);
        this.cum = new Float32Array(this.n);
        for (let i = 0; i < this.n; i++) {
          readV3(src[i], _a);
          const gy = this._groundY(_a.x, _a.y + 0.5, _a.z, _a.y);
          this.pts[i * 3] = _a.x; this.pts[i * 3 + 1] = gy; this.pts[i * 3 + 2] = _a.z;
        }
        this.loop = this.n >= 3 && d.loop !== false;
        this.L = polylineLengths(this.pts, this.n, this.loop, this.cum);
      }
      this.speed = Math.max(0.3, fin(d.speed, 1.2));
      this.s = 0;
      this.hunker = 0; this.claw = 0; this.pinch = 0; this.flip = 0; this.heat = 0.35; this.stalkUp = 0;
      this.shellT = 0;
      this.lungeDir = new THREE.Vector3();
      this._build();
      this._initEmote();
      this._mergeGroup(this.body, 'slagcrab_body');
      this.col = this._solidBox(this.pos.x, this.pos.y + SC_TOP * 0.5, this.pos.z, 0.52, SC_TOP * 0.5, 0.42, 'bounce', { power: 2.4 });
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const rock = skinMat(fin(this.def.color, 0x2e2622), 0.92, 0.0);
      const rock2 = skinMat(0x453831, 0.85, 0.0);
      const belly = skinMat(0xc2562e, 0.6, 0.0);
      const claw = skinMat(0xa8452a, 0.55, 0.05);
      const dark = skinMat(0x1b1412, 0.7, 0.0);
      const body = pivot('body', null);
      this.hull = pivot('hull', body, 0, 0.36, 0);
      const parts = [
        { g: ell(0.5, 1.12, 0.62, 0.95, 0, 0.1, 0, 20, 12), m: rock },
        { g: ell(0.42, 1.05, 0.35, 0.85, 0, -0.08, 0.02, 16, 8), m: belly },
      ];
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, rr = 0.18 + (i % 3) * 0.1;
        parts.push({ g: ell(0.08 + (i % 2) * 0.03, 1, 0.8, 1, Math.cos(a) * rr * 1.1, 0.36 - rr * 0.35, Math.sin(a) * rr * 0.9, 8, 6), m: rock2 });
      }
      parts.push({ g: ell(0.14, 1.4, 0.5, 0.6, 0, 0.0, 0.42, 10, 6), m: dark });   // mouth plate
      this.hull.add(mergeParts(parts, 'shell'));
      // magma seams: own emissive so the shell visibly heats
      this.seamMat = glowMat(this, 0xff5a1a, 1.2, 0x1a0804);
      const seams = [];
      for (let i = 0; i < 3; i++) {
        const g = ringProfileGeometry(0.5 - i * 0.1, [0.018, 0.012, 0.004], 20, 1);
        place(g, 0, 0.16 + i * 0.12, 0, 0, 0, 0, 1.12, 1, 0.95);
        seams.push({ g, m: this.seamMat });
      }
      const seamMesh = mergeParts(seams, 'seams');
      seamMesh.castShadow = false;
      this.hull.add(seamMesh);
      // eye stalks
      const mkStalk = (side) => {
        const st = pivot(side < 0 ? 'stalkL' : 'stalkR', this.hull, side * 0.14, 0.18, 0.36);
        st.add(mergeParts([
          { g: place(tubeGeometry(0.025, 0.035, 0.3, 6, 1), 0, 0.15, 0), m: claw },
          { g: ell(0.075, 1, 1, 1, 0, 0.32, 0, 10, 8), m: eyeWhiteMat() },
          { g: ell(0.035, 1, 1, 0.6, 0, 0.33, 0.06, 8, 6), m: dark },
        ], 'stalk'));
        return st;
      };
      this.stalkL = mkStalk(-1);
      this.stalkR = mkStalk(1);
      // the big claw (right) with a hinged upper jaw; the small claw (left)
      this.armR = pivot('armR', this.hull, 0.42, 0.0, 0.3);
      this.armR.add(mergeParts([{ g: limbZ(0.07, 0.22, 0, 0, 0, 0, 0.5, 0), m: claw },
        { g: ell(0.17, 1.1, 0.75, 1.3, 0.14, 0, 0.36), m: claw },
        { g: spike(0.07, 0.22, 5, 0.14, -0.05, 0.52, Math.PI / 2, 0, 0), m: claw }], 'bigClaw'));
      this.pinchR = pivot('pinchR', this.armR, 0.14, 0.06, 0.4);
      this.pinchR.add(mergeParts([{ g: spike(0.06, 0.26, 5, 0, 0, 0, Math.PI / 2 - 0.15, 0, 0), m: claw }], 'pinch'));
      this.armL = pivot('armL', this.hull, -0.4, -0.02, 0.28);
      this.armL.add(mergeParts([{ g: limbZ(0.05, 0.16, 0, 0, 0, 0, -0.5, 0), m: claw },
        { g: ell(0.1, 1, 0.7, 1.3, -0.08, 0, 0.26), m: claw },
        { g: spike(0.045, 0.14, 5, -0.08, 0.02, 0.37, Math.PI / 2, 0, 0), m: claw }], 'smallClaw'));
      // six legs
      this.legs = [];
      for (let i = 0; i < 3; i++) {
        for (let s = -1; s <= 1; s += 2) {
          const lg = pivot('leg', this.hull, s * 0.38, -0.08, 0.12 - i * 0.2);
          lg.add(mergeParts([{ g: place(tubeGeometry(0.03, 0.04, 0.34, 5, 1), s * 0.14, 0.06, 0, 0, 0, s * -1.1), m: claw },
            { g: place(tubeGeometry(0.012, 0.03, 0.34, 5, 1), s * 0.33, -0.12, 0, 0, 0, s * -0.25), m: claw }], 'leg'));
          this.legs.push(lg);
        }
      }
      this.body = body;
      this.rig.add(body);
    }

    _resetKind() {
      this.s = 0; this.hunker = 0; this.claw = 0; this.pinch = 0; this.flip = 0; this.heat = 0.35; this.stalkUp = 0; this.shellT = 0;
      if (this.n >= 2) this._placeOnPath();
    }

    _placeOnPath() {
      let ss = this.s;
      if (!this.loop) ss = tri(this.s / (2 * Math.max(this.L, 1e-6))) * this.L;
      polylineAt(this.pts, this.n, this.cum, this.L, this.loop, ss, _a, _b);
      this.pos.set(_a.x, _a.y, _a.z);
      // a crab walks SIDEWAYS: its face is square to the path
      if (_b.lengthSq() > 1e-6) this.yaw = Math.atan2(-_b.z, _b.x);
    }

    _stompable() { return this.state === 'recover' || this.state === 'snap' || this.state === 'flipped' || (this.state !== 'shell' && this.hunker < 0.5); }

    _strikeable() { return this.state !== 'shell'; }

    _onStomp(player) {
      if (this.state === 'shell') { this._clonk(); return; }
      this._defeat('stomp');
    }

    _clonk() {
      this._sfx('step_metal', this.pos, 0.7, 1.0);
      this._burst('spark', _a.set(this.pos.x, this.pos.y + SC_TOP, this.pos.z), 0xffb04a, 0.7);
      this.events.emit('clonk', this);
    }

    _onEnter(s) {
      if (s === 'tele') { this._sfx('gnasher_bite', this.pos, 1.5, 0.6); }
      else if (s === 'snap') {
        this.lungeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this._sfx('gnasher_bite', this.pos, 1.1, 1.0);
      } else if (s === 'shell') { this._sfx('step_stone', this.pos, 0.6, 0.8); }
      else if (s === 'flipped') {
        this._burst('dust', this.pos, 0x6a5a50, 0.9);
        this._sfx('crusher_slam', this.pos, 1.6, 0.6);
        this._shake(0.06, 120);
      } else if (s === 'defeat') { this._burst('spark', this.pos, 0xffa040, 1); this._burst('lavaPop', this.pos, 0xff6a2a, 0.6); }
    }

    _think(dt, player) {
      const seen = this._updateAware(dt);
      if (seen) this.stalkUp = 1;
      // is the hero coming down on it? -> hunker (unless committed to a snap)
      const above = this._alive && !this._pgr && this._pd < 2.3 && this._py > this.pos.y + SC_TOP * 0.6;
      const committed = this.state === 'tele' || this.state === 'snap' || this.state === 'recover' || this.state === 'flipped';
      if (above && !committed && this.state !== 'shell') this._enter('shell');
      switch (this.state) {
        case 'scuttle': {
          if (this.n >= 2) { this.s += this.speed * dt; this._placeOnPath(); }
          else this.yaw += dt * 0.4;
          if (this.aware) this._enter('stalk');
          break;
        }
        case 'stalk': {
          this._faceHero(5, dt);
          if (!this.aware) { this._enter('scuttle'); break; }
          if (this._pd > 1.3) {
            const hx = this.pos.x - this.home.x, hz = this.pos.z - this.home.z;
            const inRange = hx * hx + hz * hz < this.range * this.range;
            const dx = this._pdx / this._pd, dz = this._pdz / this._pd;
            if (inRange || (hx * dx + hz * dz) < 0) {
              if (this._clearAhead(dx, dz, 0.7, 0.8)) {
                this.pos.x += dx * 1.7 * dt; this.pos.z += dz * 1.7 * dt;
                const gy = this._groundY(this.pos.x, this.pos.y + 0.6, this.pos.z, this.pos.y);
                if (Math.abs(gy - this.pos.y) < 0.6) this.pos.y = gy;
              }
            }
          }
          if (this._pd < 2.7 && Math.abs(this._py - this.pos.y) < 1.2) this._enter('tele');
          break;
        }
        case 'tele': {
          this._faceHero(7, dt);
          this.claw = damp(this.claw, 1, 12, dt);
          this.heat = damp(this.heat, 1.4, 8, dt);
          if (this.stateT >= SC_TELE) this._enter('snap');
          break;
        }
        case 'snap': {
          const u = clamp(this.stateT / SC_SNAP, 0, 1);
          const v = 5.2 * (1 - u);
          if (this._clearAhead(this.lungeDir.x, this.lungeDir.z, 0.6, 0.8)) {
            this.pos.x += this.lungeDir.x * v * dt; this.pos.z += this.lungeDir.z * v * dt;
          }
          this.claw = damp(this.claw, -0.3, 30, dt);
          this.pinch = 1;
          headingFrom(this.yaw, _c);
          if (player) this._bump(player, this.pos.x + _c.x * 0.75, this.pos.y + 0.35, this.pos.z + _c.z * 0.75, 0.5, 6, 0.4, 0.9);
          if (u >= 1) { this._burst('dust', this.pos, 0x6a5a50, 0.5); this._enter('recover'); }
          break;
        }
        case 'recover':
          this.claw = damp(this.claw, -0.2, 6, dt);
          this.pinch = damp(this.pinch, 0, 5, dt);
          this.heat = damp(this.heat, 0.25, 4, dt);
          if (this.stateT >= SC_RECOVER) this._enter(this.aware ? 'stalk' : 'scuttle');
          break;
        case 'shell':
          this.hunker = damp(this.hunker, 1, 16, dt);
          this.heat = damp(this.heat, 2.2, 10, dt);
          if (above) this.shellT = 0; else this.shellT += dt;
          if (this.stateT > 0.5 && this.shellT > 0.45) { this._enter(this.aware ? 'stalk' : 'scuttle'); }
          break;
        case 'flipped':
          this.flip = damp(this.flip, 1, 12, dt);
          this.heat = damp(this.heat, 0.1, 3, dt);
          if (this.stateT >= SC_FLIP) { this._burst('dust', this.pos, 0x6a5a50, 0.6); this._enter('stalk'); }
          break;
      }
      if (this.state !== 'shell') this.hunker = damp(this.hunker, 0, 8, dt);
      if (this.state !== 'flipped') this.flip = damp(this.flip, 0, 10, dt);
      if (this.state !== 'tele' && this.state !== 'snap') this.claw = damp(this.claw, 0, 6, dt);
      if (this.state === 'scuttle' || this.state === 'stalk') this.heat = damp(this.heat, 0.35, 3, dt);
      this.stalkUp = damp(this.stalkUp, this.aware ? 0.4 : 0, 3, dt);
      // stomps: the shell bounces the hero off (clonk); anything else defeats
      if (this._stompedOn(this.pos.x, this.pos.z, 0.8, this.pos.y + SC_TOP)) {
        this.stompCount++;
        if (this.state === 'shell') {
          this._clonk();
        } else this._defeat('stomp');
      } else if (this.state !== 'shell' && this.state !== 'flipped' && player) {
        this._bump(player, this.pos.x, this.pos.y + 0.35, this.pos.z, 0.62, 4.5, 0.3, 0.9);
      }
    }

    onPound(player, pos) {
      if (this.defeated || this.state === 'gone') return;
      if (!this._poundNear(player, pos, this.pos.x, this.pos.y, this.pos.z, 2.2)) return;
      if (this.state === 'flipped') { this._defeat('pound'); return; }
      this.aware = true;
      this._enter('flipped');
    }

    _pose(dt) {
      const t = this.time;
      const k = this.popK;
      const b = this.body;
      b.position.copy(this.pos);
      b.rotation.set(0, this.yaw, 0);
      const du = this.defeatU;
      b.scale.set(k * (1 + 0.3 * du), k * (1 - 0.6 * du), k * (1 + 0.3 * du));
      const moving = this.state === 'scuttle' || this.state === 'stalk';
      const ph = t * (moving ? 16 : 4);
      this.hull.position.y = 0.36 - 0.2 * this.hunker + (moving ? 0.02 * Math.abs(Math.sin(ph)) : 0) + 0.25 * this.flip;
      this.hull.rotation.set(0, 0, this.flip * Math.PI + (this.flip > 0.5 ? 0.12 * Math.sin(t * 9) : 0));
      for (let i = 0; i < this.legs.length; i++) {
        const lg = this.legs[i];
        const s = (i & 1) ? 1 : -1;
        const w = this.flip > 0.5 ? 0.6 * Math.sin(t * 22 + i) : (moving ? 0.45 * Math.sin(ph + i * 1.3) : 0.05 * Math.sin(t * 2 + i));
        lg.rotation.set(w, 0, s * (0.2 + 0.9 * this.hunker));
        lg.scale.setScalar(1 - 0.35 * this.hunker);
      }
      const clack = this.state === 'scuttle' ? 0.2 * Math.max(0, Math.sin(t * 3.1)) : 0;
      this.armR.rotation.set(-1.1 * this.claw + 0.3 * this.hunker, 0.2 * this.hunker, 0);
      this.pinchR.rotation.x = -0.7 * (this.state === 'tele' ? 1 : this.pinch) - clack;
      this.armL.rotation.set(-0.3 * this.claw + 0.4 * this.hunker + 0.15 * Math.sin(t * 2.3), -0.2 * this.hunker, 0);
      const up = this.stalkUp + (this.state === 'tele' ? 0.3 : 0);
      this.stalkL.scale.set(1, 1 + up * 0.8 - this.hunker * 0.7, 1);
      this.stalkR.scale.set(1, 1 + up * 0.8 - this.hunker * 0.7, 1);
      this.stalkL.rotation.z = 0.25 + 0.1 * Math.sin(t * 2.7);
      this.stalkR.rotation.z = -0.25 - 0.1 * Math.sin(t * 2.3);
      const flick = 0.85 + 0.15 * Math.sin(t * 13) * Math.sin(t * 5.1);
      this.seamMat.emissiveIntensity = (this.state === 'defeat' ? 3 * (1 - du) : this.heat * 1.4) * flick;
    }

    _syncColliders() {
      this.col.setCenter(this.pos.x, this.pos.y + SC_TOP * 0.5 - 0.1 * this.hunker, this.pos.z);
      this.col.active = !this.defeated && this.state !== 'gone';
    }
  }

  /* =========================================================================
   * 7. EMBER — EMBER IMP
   *    A charcoal ball with a flame crown and a grin. Bounces on the spot and
   *    giggles; on notice it spins, cackles and hops at you — every hop is
   *    preceded by a 0.4 s squat in which its flame FLARES. Touching it burns
   *    (a shove). Stomp it and the flame snuffs out.
   * ====================================================================== */

  const EI_CROUCH = 0.4, EI_HOP = 0.55, EI_HOP_LEN = 2.4, EI_R = 0.34;

  class EmberImp extends Creature {
    constructor(def, ctx) {
      super(def, ctx, 'emberimp');
      this.naturalHeight = 0.9;
      this.hopFrom = new THREE.Vector3();
      this.hopTo = new THREE.Vector3();
      this.lift = 0; this.squash = 1; this.flare = 0; this.spin = 0; this.giggleT = 1.2; this.bob = 0;
      this._build();
      this._initEmote();
      this._mergeGroup(this.body, 'emberimp_body');
      this.col = this._bounceBox(0.3, 0.38, 0.3, 2.4);
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const coal = skinMat(fin(this.def.color, 0x2a1d19), 0.92, 0.0);
      const ash = skinMat(0x6d5b53, 0.9, 0.0);
      const horn = skinMat(0x1a1210, 0.6, 0.0);
      const mouth = skinMat(0x140806, 0.8, 0.0);
      const tooth = skinMat(0xf2e6c8, 0.45, 0.0);
      const body = pivot('body', null);
      this.core = pivot('core', body, 0, 0.42, 0);
      const parts = [
        { g: ell(EI_R, 1, 0.96, 1, 0, 0, 0, 18, 12), m: coal },
        { g: ell(0.22, 1, 0.9, 0.55, 0, -0.08, 0.17), m: ash },
        { g: ell(0.13, 1.5, 0.5, 0.5, 0, -0.07, 0.29, 12, 8), m: mouth },
        { g: spike(0.05, 0.15, 5, -0.14, 0.26, 0.05, -0.2, 0, 0.5), m: horn },
        { g: spike(0.05, 0.15, 5, 0.14, 0.26, 0.05, -0.2, 0, -0.5), m: horn },
        { g: place(tubeGeometry(0.012, 0.03, 0.34, 5, 1), 0, -0.1, -0.38, -1.1, 0, 0), m: coal },
      ];
      for (let i = 0; i < 4; i++) parts.push({ g: spike(0.022, 0.05, 4, -0.075 + i * 0.05, -0.04, 0.325, Math.PI, 0, 0), m: tooth });
      this.core.add(mergeParts(parts, 'coalBody'));
      this.eyes = makeEyes(0.08, 0.2, 0, 0.1, 0.27, -0.1);
      this.core.add(this.eyes.group);
      this.armL = pivot('armL', this.core, -0.32, -0.02, 0.02);
      this.armL.add(mergeParts([{ g: limbY(0.05, 0.12, 0, 0, 0, 0, 0, 0.5), m: coal }], 'arm'));
      this.armR = pivot('armR', this.core, 0.32, -0.02, 0.02);
      this.armR.add(mergeParts([{ g: limbY(0.05, 0.12, 0, 0, 0, 0, 0, -0.5), m: coal }], 'arm'));
      this.feet = pivot('feet', body, 0, 0.08, 0.02);
      this.feet.add(mergeParts([{ g: ell(0.09, 1, 0.55, 1.4, -0.13, 0, 0.04), m: horn }, { g: ell(0.09, 1, 0.55, 1.4, 0.13, 0, 0.04), m: horn }], 'feet'));
      // glowing cracks + the flame crown: own emissive, flare on the telegraph
      this.crackMat = glowMat(this, 0xff6a1a, 1.8, 0x1a0804);
      const cr = [];
      for (let i = 0; i < 4; i++) {
        const g = ringProfileGeometry(EI_R * 1.005, [0.012, 0.012, 0.004], 18, 1);
        place(g, 0, 0, 0, 0.6 + i * 0.9, i * 1.3, 0.3, 1, 1, 1);
        cr.push({ g, m: this.crackMat });
      }
      const cracks = mergeParts(cr, 'cracks');
      cracks.castShadow = false;
      this.core.add(cracks);
      this.flameMat = glowMat(this, 0xffa02a, 2.6, 0x3a1004);
      this.flame = pivot('flame', this.core, 0, EI_R * 0.82, 0);
      const fl = [];
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        fl.push({ g: spike(0.07 + (i === 0 ? 0.03 : 0), 0.34 + (i % 2) * 0.1, 6, Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08, Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25), m: this.flameMat });
      }
      fl.push({ g: spike(0.1, 0.46, 6, 0, 0, 0, 0, 0, 0), m: this.flameMat });
      const flameMesh = mergeParts(fl, 'flameCrown');
      flameMesh.castShadow = false;
      this.flame.add(flameMesh);
      this.body = body;
      this.rig.add(body);
    }

    _resetKind() {
      this.lift = 0; this.squash = 1; this.flare = 0; this.spin = 0; this.giggleT = 1.2 + this.rng() * 0.8; this.bob = 0;
      this.hopFrom.copy(this.home); this.hopTo.copy(this.home);
    }

    _onEnter(s) {
      if (s === 'crouch') {
        this.hopFrom.copy(this.pos);
        let dx = this._pdx, dz = this._pdz;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        let len = Math.min(EI_HOP_LEN, Math.max(0.6, this._pd - 0.3));
        // stay within range of home
        let tx = this.pos.x + dx * len, tz = this.pos.z + dz * len;
        const hx = tx - this.home.x, hz = tz - this.home.z, hd = Math.hypot(hx, hz);
        if (hd > this.range) { tx = this.home.x + hx / hd * this.range; tz = this.home.z + hz / hd * this.range; }
        const gy = this._groundY(tx, this.pos.y + 1.2, tz, NaN);
        if (!Number.isFinite(gy) || Math.abs(gy - this.pos.y) > 1.2 || !this._clearAhead(tx - this.pos.x, tz - this.pos.z, Math.min(len, 1.2), 1.2)) {
          tx = this.pos.x; tz = this.pos.z; len = 0;
          this.hopTo.set(tx, this.pos.y, tz);
        } else this.hopTo.set(tx, gy, tz);
        this.yaw = Math.atan2(dx, dz);
        this._sfx('lava_bubble', this.pos, 1.6, 0.6);
      } else if (s === 'hop') {
        this._sfx('jump1', this.pos, 1.8, 0.35);
      } else if (s === 'defeat') {
        this._burst('dust', this.pos, 0x3a3a3a, 1.2);
        this._sfx('lava_bubble', this.pos, 0.6, 1.0);
      }
    }

    _think(dt, player) {
      const seen = this._updateAware(dt);
      switch (this.state) {
        case 'idle': {
          this.bob += dt;
          const hopPh = (this.bob % 0.6) / 0.6;
          this.lift = 0.18 * Math.sin(hopPh * Math.PI);
          this.squash = hopPh < 0.1 || hopPh > 0.9 ? 0.85 : 1.0;
          this.giggleT -= dt;
          if (this.giggleT <= 0) { this.giggleT = 1.6 + this.rng() * 1.4; this._sfx('skitter', this.pos, 1.9, 0.3); }
          if (this._pd < this.noticeR + 3) this._faceHero(2, dt);
          if (seen) this._enter('cackle');
          break;
        }
        case 'cackle':
          this.lift = damp(this.lift, 0.25, 10, dt);
          this.spin = clamp(this.stateT / 0.55, 0, 1) * TAU;
          if (this.stateT >= 0.55) { this.spin = 0; this._faceHero(20, 1); this._enter('crouch'); }
          break;
        case 'crouch':
          this.lift = damp(this.lift, 0, 20, dt);
          this.squash = damp(this.squash, 0.62, 14, dt);
          this.flare = clamp(this.stateT / EI_CROUCH, 0, 1);
          if (this.stateT >= EI_CROUCH) this._enter('hop');
          break;
        case 'hop': {
          const u = clamp(this.stateT / EI_HOP, 0, 1);
          this.pos.x = this.hopFrom.x + (this.hopTo.x - this.hopFrom.x) * u;
          this.pos.z = this.hopFrom.z + (this.hopTo.z - this.hopFrom.z) * u;
          this.pos.y = this.hopFrom.y + (this.hopTo.y - this.hopFrom.y) * u;
          this.lift = 1.2 * Math.sin(u * Math.PI);
          this.squash = damp(this.squash, 1.15, 16, dt);
          this.flare = damp(this.flare, 0.3, 6, dt);
          if (u >= 1) {
            this.lift = 0; this.squash = 0.7;
            this._burst('lavaPop', this.pos, 0xff7a2a, 0.5);
            this._sfx('step_stone', this.pos, 1.4, 0.5);
            this._enter(this.aware ? 'crouch' : 'idle');
          }
          break;
        }
      }
      if (this.state !== 'crouch' && this.state !== 'hop') this.flare = damp(this.flare, 0, 5, dt);
      const topY = this.pos.y + this.lift + 0.76;
      if (this._stompedOn(this.pos.x, this.pos.z, 0.6, topY)) { this.stompCount++; this._defeat('stomp'); }
      else if (player) this._bump(player, this.pos.x, this.pos.y + this.lift + 0.42, this.pos.z, 0.4, 5, 0.3, 0.9);
    }

    onPound(player, pos) {
      if (this.defeated || this.state === 'gone') return;
      if (this._poundNear(player, pos, this.pos.x, this.pos.y, this.pos.z, 1.9)) this._defeat('pound');
    }

    _pose(dt) {
      const t = this.time;
      const k = this.popK;
      const b = this.body;
      b.position.set(this.pos.x, this.pos.y + this.lift, this.pos.z);
      b.rotation.set(0, this.yaw + this.spin, 0);
      const du = this.defeatU;
      const sq = this.squash * (1 - 0.5 * du);
      b.scale.set(k * (2 - sq) * 0.5 + k * 0.5, k * sq, k * (2 - sq) * 0.5 + k * 0.5);
      this.core.rotation.z = 0.12 * Math.sin(t * 6);
      const wave = this.state === 'cackle' ? 1.2 : 0.35;
      this.armL.rotation.set(0, 0, -0.4 - wave * Math.abs(Math.sin(t * 9)));
      this.armR.rotation.set(0, 0, 0.4 + wave * Math.abs(Math.sin(t * 9 + 1)));
      const flick = 0.8 + 0.2 * Math.sin(t * 19) * Math.sin(t * 7.7);
      const f = (1 + 0.9 * this.flare) * (1 - du);
      this.flame.scale.set(f * (0.9 + 0.1 * Math.sin(t * 23)), f * (0.85 + 0.25 * flick), f * (0.9 + 0.1 * Math.cos(t * 21)));
      this.flameMat.emissiveIntensity = (2.4 + 2.2 * this.flare) * flick * (1 - du);
      this.crackMat.emissiveIntensity = (1.6 + 1.2 * this.flare) * (1 - du) * (0.85 + 0.15 * flick);
      this._lookEyes(this.eyes, 0.5);
    }

    _syncColliders() {
      this.col.setCenter(this.pos.x, this.pos.y + this.lift + 0.38, this.pos.z);
      this.col.active = !this.defeated && this.state !== 'gone';
    }
  }

  /* =========================================================================
   * 8. RIME — FLOE SKATER
   *    A round waddler in a knitted scarf. Patrols; on notice it flaps, then
   *    crouches and scrabbles (0.7 s) and BELLY-SLIDES at you along a locked
   *    line. At the end of the slide it spins out and sits dizzy — stomp it.
   *    A wall stops the slide short and dizzies it longer.
   * ====================================================================== */

  const SK_TELE = 0.7, SK_SLIDE_V = 10.5, SK_DECEL = 4.2, SK_SLIDE_MAX = 2.2, SK_DIZZY = 1.6, SK_WALL_DIZZY = 2.4;

  class Skater extends Creature {
    constructor(def, ctx) {
      super(def, ctx, 'skater');
      this.naturalHeight = 1.1;
      this.startState = 'waddle';
      this.state = 'waddle';
      const d = this.def;
      const src = Array.isArray(d.path) && d.path.length >= 2 ? d.path : null;
      this.n = src ? src.length : 0;
      if (src) {
        this.pts = new Float32Array(this.n * 3);
        this.cum = new Float32Array(this.n);
        for (let i = 0; i < this.n; i++) {
          readV3(src[i], _a);
          const gy = this._groundY(_a.x, _a.y + 0.5, _a.z, _a.y);
          this.pts[i * 3] = _a.x; this.pts[i * 3 + 1] = gy; this.pts[i * 3 + 2] = _a.z;
        }
        this.loop = this.n >= 3 && d.loop !== false;
        this.L = polylineLengths(this.pts, this.n, this.loop, this.cum);
      }
      this.speed = Math.max(0.3, fin(d.speed, 1.1));
      this.s = 0;
      this.slideV = 0;
      this.slideDir = new THREE.Vector3();
      this.back = new THREE.Vector3();
      this.belly = 0; this.flapA = 0; this.crouch = 0; this.spin = 0; this.dizzyFor = SK_DIZZY;
      this.dustT = 0;
      this._build();
      this._initEmote();
      this.stars = new StarRing(this.rig);
      this._mergeGroup(this.body, 'skater_body');
      this.col = this._bounceBox(0.36, 0.5, 0.36, 2.4);
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const black = skinMat(0x1e2230, 0.55, 0.05);
      const white = skinMat(0xf1f3f6, 0.6, 0.0);
      const orange = skinMat(0xf29a2e, 0.5, 0.0);
      const scarf = skinMat(fin(this.def.color, 0xd8353a), 0.85, 0.0);
      const scarf2 = skinMat(0xf2e2c8, 0.85, 0.0);
      const body = pivot('body', null);
      this.torso = pivot('torso', body, 0, 0.1, 0);
      this.torso.add(mergeParts([
        { g: ell(0.4, 1, 1.25, 0.95, 0, 0.5, 0, 20, 14), m: black },
        { g: ell(0.33, 0.95, 1.12, 0.6, 0, 0.44, 0.17), m: white },
        { g: spike(0.07, 0.16, 6, 0, 0.8, 0.34, Math.PI / 2 - 0.1, 0, 0), m: orange },
        { g: place(ringProfileGeometry(0.27, [0.06, 0.05, 0.02], 16, 1), 0, 0.72, 0.02, 0.12, 0, 0), m: scarf },
        { g: place(ringProfileGeometry(0.27, [0.02, 0.012, 0.004], 16, 1), 0, 0.69, 0.02, 0.12, 0, 0), m: scarf2 },
        { g: place(bbox(0.12, 0.34, 0.04, 0.015), 0.14, 0.52, -0.3, 0.35, 0, 0.2), m: scarf },
        { g: place(bbox(0.12, 0.05, 0.045, 0.012), 0.16, 0.4, -0.35, 0.35, 0, 0.2), m: scarf2 },
      ], 'torso'));
      this.eyes = makeEyes(0.075, 0.2, 0, 0.9, 0.28, -0.15);
      this.torso.add(this.eyes.group);
      const mkFlipper = (side) => {
        const f = pivot(side < 0 ? 'flipL' : 'flipR', this.torso, side * 0.38, 0.62, 0);
        f.add(mergeParts([{ g: ell(0.24, 0.22, 1, 0.5, side * 0.03, -0.2, 0, 12, 8), m: black }], 'flipper'));
        return f;
      };
      this.flipL = mkFlipper(-1);
      this.flipR = mkFlipper(1);
      const mkFoot = (side) => {
        const f = pivot(side < 0 ? 'footL' : 'footR', body, side * 0.15, 0.06, 0.08);
        f.add(mergeParts([{ g: place(bbox(0.16, 0.05, 0.24, 0.02), 0, 0, 0.06), m: orange }], 'foot'));
        return f;
      };
      this.footL = mkFoot(-1);
      this.footR = mkFoot(1);
      this.body = body;
      this.rig.add(body);
    }

    _resetKind() {
      this.s = 0; this.slideV = 0; this.belly = 0; this.flapA = 0; this.crouch = 0; this.spin = 0; this.dizzyFor = SK_DIZZY; this.dustT = 0;
      this.stars.show(false);
      if (this.n >= 2) this._placeOnPath();
    }

    _placeOnPath() {
      let ss = this.s;
      if (!this.loop) ss = tri(this.s / (2 * Math.max(this.L, 1e-6))) * this.L;
      polylineAt(this.pts, this.n, this.cum, this.L, this.loop, ss, _a, _b);
      if (!this.loop && Math.floor(this.s / Math.max(this.L, 1e-6)) % 2 === 1) _b.negate();
      this.pos.set(_a.x, _a.y, _a.z);
      if (_b.lengthSq() > 1e-6) this.yaw = Math.atan2(_b.x, _b.z);
    }

    _onEnter(s) {
      if (s === 'tele') { this._sfx('skitter', this.pos, 0.7, 0.6); }
      else if (s === 'slide') {
        this.slideDir.set(this._pdx, 0, this._pdz);
        if (this.slideDir.lengthSq() < 1e-6) this.slideDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.slideDir.normalize();
        this.yaw = Math.atan2(this.slideDir.x, this.slideDir.z);
        this.slideV = SK_SLIDE_V;
        this._sfx('slide', this.pos, 1.3, 0.8);
        this._burst('snowPuff', this.pos, 0xeaf4ff, 0.8);
      } else if (s === 'spin') { this._sfx('skitter', this.pos, 1.4, 0.5); }
      else if (s === 'dizzy') { this.stars.show(true); }
      else if (s === 'return') { this.stars.show(false); this.back.set(this.pos.x, this.pos.y, this.pos.z); }
      else if (s === 'defeat') { this.stars.show(false); this._burst('snowPuff', this.pos, 0xeaf4ff, 1.1); }
    }

    _think(dt, player) {
      const seen = this._updateAware(dt);
      switch (this.state) {
        case 'waddle':
          if (this.n >= 2) { this.s += this.speed * dt; this._placeOnPath(); }
          if (seen) this.flapA = 1;
          if (this.aware) this._enter('tele');
          break;
        case 'tele':
          this._faceHero(9, dt);
          this.crouch = damp(this.crouch, 1, 10, dt);
          this.dustT -= dt;
          if (this.dustT <= 0) { this.dustT = 0.12; this._burst('snowPuff', this.pos, 0xeaf4ff, 0.3); }
          if (this.stateT >= SK_TELE) this._enter('slide');
          break;
        case 'slide': {
          this.belly = damp(this.belly, 1, 18, dt);
          this.slideV = Math.max(0, this.slideV - SK_DECEL * dt);
          const step = this.slideV * dt;
          if (!this._clearAhead(this.slideDir.x, this.slideDir.z, 0.55 + step, 1.2)) {
            // a wall (or a drop) stops it dead, and it pays for it
            this._burst('snowPuff', this.pos, 0xeaf4ff, 1.0);
            this._sfx('land_hard', this.pos, 1.4, 0.7);
            this._shake(0.05, 100);
            this.dizzyFor = SK_WALL_DIZZY;
            this._enter('dizzy');
            break;
          }
          this.pos.x += this.slideDir.x * step; this.pos.z += this.slideDir.z * step;
          const gy = this._groundY(this.pos.x, this.pos.y + 0.6, this.pos.z, this.pos.y);
          if (Math.abs(gy - this.pos.y) < 0.6) this.pos.y = gy;
          this.dustT -= dt;
          if (this.dustT <= 0) { this.dustT = 0.1; this._burst('iceShard', this.pos, 0xcfe8ff, 0.3); }
          if (player) this._bump(player, this.pos.x, this.pos.y + 0.3, this.pos.z, 0.55, 7, 0.4, 1.0);
          if (this.slideV < 1.2 || this.stateT > SK_SLIDE_MAX) { this.dizzyFor = SK_DIZZY; this._enter('spin'); }
          break;
        }
        case 'spin':
          this.belly = damp(this.belly, 0, 8, dt);
          this.spin += dt * 14 * (1 - clamp(this.stateT / 1.0, 0, 1));
          if (this.stateT >= 1.0) this._enter('dizzy');
          break;
        case 'dizzy':
          this.belly = damp(this.belly, 0, 8, dt);
          this.crouch = damp(this.crouch, 0, 6, dt);
          if (this.stateT >= this.dizzyFor) this._enter(this.aware ? 'tele' : 'return');
          break;
        case 'return': {
          // waddle back onto the patrol line (to where the clock put it last)
          let tx = this.home.x, tz = this.home.z;
          if (this.n >= 2) { polylineAt(this.pts, this.n, this.cum, this.L, this.loop, this.loop ? this.s : tri(this.s / (2 * Math.max(this.L, 1e-6))) * this.L, _a, _b); tx = _a.x; tz = _a.z; }
          const dx = tx - this.pos.x, dz = tz - this.pos.z, d = Math.hypot(dx, dz);
          if (d > 0.15) {
            this.yaw = dampAngle(this.yaw, Math.atan2(dx, dz), 6, dt);
            this.pos.x += dx / d * Math.min(d, 1.6 * dt); this.pos.z += dz / d * Math.min(d, 1.6 * dt);
            const gy = this._groundY(this.pos.x, this.pos.y + 0.6, this.pos.z, this.pos.y);
            if (Math.abs(gy - this.pos.y) < 0.6) this.pos.y = gy;
          } else this._enter('waddle');
          if (this.aware && this.stateT > 0.6) this._enter('tele');
          break;
        }
      }
      if (this.state !== 'tele') this.crouch = damp(this.crouch, 0, 6, dt);
      if (this.state !== 'slide' && this.state !== 'spin') this.belly = damp(this.belly, 0, 8, dt);
      this.flapA = damp(this.flapA, this.state === 'tele' ? 0.6 : 0, 3, dt);
      const topY = this.pos.y + 1.0 - 0.55 * this.belly;
      if (this._stompedOn(this.pos.x, this.pos.z, 0.7, topY)) { this.stompCount++; this._defeat('stomp'); }
      else if (player && this.state !== 'slide' && this.state !== 'dizzy' && this.state !== 'spin') {
        this._bump(player, this.pos.x, this.pos.y + 0.5, this.pos.z, 0.46, 4, 0.25, 0.9);
      }
    }

    onPound(player, pos) {
      if (this.defeated || this.state === 'gone') return;
      if (this._poundNear(player, pos, this.pos.x, this.pos.y, this.pos.z, 1.9)) this._defeat('pound');
    }

    _pose(dt) {
      const t = this.time;
      const k = this.popK;
      const b = this.body;
      b.position.copy(this.pos);
      const du = this.defeatU;
      b.rotation.set(0, this.yaw + this.spin + du * 12, 0);
      b.scale.set(k * (1 + 0.3 * du), k * (1 - 0.65 * du), k * (1 + 0.3 * du));
      const walking = this.state === 'waddle' || this.state === 'return';
      const ph = t * 7.5;
      this.torso.rotation.set(this.belly * 1.45 + this.crouch * 0.35, 0, walking ? 0.16 * Math.sin(ph) : (this.state === 'dizzy' ? 0.2 * Math.sin(t * 4) : 0));
      this.torso.position.set(0, 0.1 - 0.12 * this.crouch + this.belly * 0.3, 0);
      const flap = this.flapA * Math.sin(t * 24) * 0.8;
      const wing = this.belly > 0.5 ? -1.4 : 0.25;
      this.flipL.rotation.set(0, 0, -wing - flap - (walking ? 0.15 * Math.sin(ph) : 0));
      this.flipR.rotation.set(0, 0, wing + flap + (walking ? 0.15 * Math.sin(ph) : 0));
      const step = walking ? 0.5 * Math.sin(ph) : (this.state === 'tele' ? 0.6 * Math.sin(t * 30) : 0);
      this.footL.rotation.x = step; this.footR.rotation.x = -step;
      this._lookEyes(this.eyes, 0.95);
      if (this.state === 'dizzy' || this.state === 'spin') this.eyes.look(0.7 * Math.sin(t * 8), 0.5 * Math.cos(t * 8));
      this.stars.update(t, this.pos.x, this.pos.y + 1.25, this.pos.z, 0.32);
    }

    _syncColliders() {
      const h = 0.5 - 0.27 * this.belly;
      this.col.half.y = h;
      this.col.setCenter(this.pos.x, this.pos.y + h, this.pos.z);
      this.col.active = !this.defeated && this.state !== 'gone';
    }
  }

  /* =========================================================================
   * 9. RIME — SNOWBALL CUB
   *    A yeti cub with a snowball. Sits patting it; on notice it claps, winds
   *    up (0.8 s — leans back, the ball wobbles) and SHOVES: the ball rolls a
   *    locked line at you, growing as it goes, and bursts on a hit, a wall or a
   *    drop. The cub cheers a hit and sulks a miss, then scoops a new ball.
   *    Stomp the cub (any time) or pound beside it.
   * ====================================================================== */

  const CB_WIND = 0.8, CB_BALL_V = 6.2, CB_BALL_MAX = 14, CB_SCOOP = 1.0, CB_REACT = 1.1;

  class SnowCub extends Creature {
    constructor(def, ctx) {
      super(def, ctx, 'snowcub');
      this.naturalHeight = 1.0;
      this.startState = 'play';
      this.state = 'play';
      this.ball = new THREE.Vector3();
      this.ballDir = new THREE.Vector3();
      this.ballR = 0.45; this.ballOn = true; this.ballRolling = false; this.ballDist = 0; this.ballAng = 0; this.ballK = 1;
      this.lean = 0; this.hop = 0; this.clap = 0; this.pat = 0; this.cheered = false;
      this._build();
      this._initEmote();
      this._mergeGroup(this.body, 'snowcub_body');
      this.col = this._bounceBox(0.36, 0.45, 0.36, 2.4);
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const fur = skinMat(fin(this.def.color, 0xf4f7fb), 0.95, 0.0);
      const face = skinMat(0x7f97b8, 0.7, 0.0);
      const horn = skinMat(0xbfe0f5, 0.35, 0.0);
      const nose = skinMat(0x2a2f3c, 0.5, 0.0);
      const pad = skinMat(0x6d86a6, 0.8, 0.0);
      const body = pivot('body', null);
      this.torso = pivot('torso', body, 0, 0.12, 0);
      const parts = [
        { g: ell(0.42, 1, 1.05, 0.95, 0, 0.42, 0, 18, 12), m: fur },
        { g: ell(0.27, 1, 0.9, 0.5, 0, 0.58, 0.28), m: face },
        { g: ell(0.07, 1.2, 0.8, 0.8, 0, 0.56, 0.42, 10, 8), m: nose },
        { g: spike(0.06, 0.2, 6, -0.2, 0.82, 0.02, -0.2, 0, 0.45), m: horn },
        { g: spike(0.06, 0.2, 6, 0.2, 0.82, 0.02, -0.2, 0, -0.45), m: horn },
        { g: ell(0.09, 1, 1, 0.5, -0.36, 0.72, -0.02, 10, 8), m: fur },
        { g: ell(0.09, 1, 1, 0.5, 0.36, 0.72, -0.02, 10, 8), m: fur },
      ];
      for (let i = 0; i < 8; i++) {
        const a = i * 0.785;
        parts.push({ g: spike(0.07, 0.12, 5, Math.cos(a) * 0.38, 0.28 + (i % 2) * 0.12, Math.sin(a) * 0.36, Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8), m: fur });
      }
      this.torso.add(mergeParts(parts, 'cub'));
      this.eyes = makeEyes(0.06, 0.2, 0, 0.7, 0.34, -0.1);
      this.torso.add(this.eyes.group);
      const mkArm = (side) => {
        const a = pivot(side < 0 ? 'armL' : 'armR', this.torso, side * 0.38, 0.52, 0.08);
        a.add(mergeParts([{ g: limbY(0.09, 0.22, 0, 0, 0, 0, 0, side * 0.3), m: fur },
          { g: ell(0.08, 1, 0.7, 1, side * 0.1, -0.34, 0.03, 10, 8), m: pad }], 'arm'));
        return a;
      };
      this.armL = mkArm(-1);
      this.armR = mkArm(1);
      this.feet = pivot('feet', body, 0, 0.07, 0.05);
      this.feet.add(mergeParts([{ g: ell(0.13, 1, 0.5, 1.4, -0.17, 0, 0.05), m: pad }, { g: ell(0.13, 1, 0.5, 1.4, 0.17, 0, 0.05), m: pad }], 'feet'));
      this.body = body;
      this.rig.add(body);
      // the snowball (world-space, not part of the body)
      const snow = skinMat(0xf6f9fd, 0.85, 0.0);
      const snow2 = skinMat(0xdce8f4, 0.9, 0.0);
      const bp = [{ g: sphereGeo(1, 20, 14), m: snow }];
      for (let i = 0; i < 9; i++) {
        const a = i * 2.2, e = (i % 3 - 1) * 0.6;
        bp.push({ g: ell(0.22, 1, 0.5, 1, Math.cos(a) * Math.cos(e) * 0.92, Math.sin(e) * 0.92, Math.sin(a) * Math.cos(e) * 0.92, 8, 6), m: snow2 });
      }
      this.ballMesh = mergeParts(bp, 'snowball');
      this.rig.add(this.ballMesh);
    }

    _ballHome(out) {
      headingFrom(this.yaw, _c);
      return out.set(this.pos.x + _c.x * 0.85, this.pos.y, this.pos.z + _c.z * 0.85);
    }

    _resetKind() {
      this.lean = 0; this.hop = 0; this.clap = 0; this.pat = 0; this.cheered = false;
      this.ballR = 0.45; this.ballOn = true; this.ballRolling = false; this.ballDist = 0; this.ballAng = 0; this.ballK = 1;
      this._ballHome(this.ball);
    }

    _burstBall() {
      _a.set(this.ball.x, this.ball.y + this.ballR, this.ball.z);
      this._burst('snowPuff', _a, 0xf2f6ff, 1.3);
      this._sfx('land_soft', _a, 0.6, 0.9);
      this.ballRolling = false;
      this.ballOn = false;
    }

    _onEnter(s) {
      if (s === 'clap') { this._sfx('skitter', this.pos, 1.5, 0.5); }
      else if (s === 'windup') { this._sfx('step_snow', this.pos, 0.6, 0.8); }
      else if (s === 'shove') {
        this.ballDir.set(this._px - this.ball.x, 0, this._pz - this.ball.z);
        if (this.ballDir.lengthSq() < 1e-4) this.ballDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.ballDir.normalize();
        this.ballRolling = true; this.ballDist = 0; this.cheered = false;
        this._sfx('slide', this.ball, 0.8, 0.8);
      } else if (s === 'scoop') { this.ballOn = true; this.ballK = 0; this.ballR = 0.45; this._ballHome(this.ball); }
      else if (s === 'defeat') { this._burst('snowPuff', this.pos, 0xf2f6ff, 1.2); if (this.ballOn && !this.ballRolling) this._burstBall(); }
    }

    _think(dt, player) {
      const seen = this._updateAware(dt);
      switch (this.state) {
        case 'play':
          this.pat = Math.max(0, Math.sin(this.time * 3.2));
          if (this._pd < this.noticeR + 3) this._faceHero(2, dt);
          this._ballHome(this.ball);
          if (seen) this._enter('clap');
          break;
        case 'clap':
          this.clap = Math.abs(Math.sin(this.stateT * 14));
          this.hop = 0.12 * Math.abs(Math.sin(this.stateT * 7));
          this._faceHero(8, dt);
          this._ballHome(this.ball);
          if (this.stateT >= 0.6) { this.clap = 0; this.hop = 0; this._enter('windup'); }
          break;
        case 'windup':
          this._faceHero(6, dt);
          this.lean = smoothstep(0, 1, this.stateT / CB_WIND);
          this._ballHome(this.ball);
          if (this.stateT >= CB_WIND) this._enter('shove');
          break;
        case 'shove':
          this.lean = damp(this.lean, -0.7, 20, dt);
          if (this.stateT >= 0.3) this._enter('watch');
          break;
        case 'watch':
          this.lean = damp(this.lean, 0, 6, dt);
          if (!this.ballRolling) this._enter(this.cheered ? 'cheer' : 'sulk');
          break;
        case 'cheer':
          this.hop = 0.25 * Math.abs(Math.sin(this.stateT * 11));
          this.clap = Math.abs(Math.sin(this.stateT * 11));
          if (this.stateT >= CB_REACT) { this.hop = 0; this.clap = 0; this._enter('scoop'); }
          break;
        case 'sulk':
          if (this.stateT >= CB_REACT) this._enter('scoop');
          break;
        case 'scoop':
          this.ballK = smoothstep(0, 1, this.stateT / CB_SCOOP);
          this._faceHero(3, dt);
          this._ballHome(this.ball);
          if (this.stateT >= CB_SCOOP) { this.ballK = 1; this._enter(this.aware ? 'windup' : 'play'); }
          break;
      }
      if (this.ballRolling) this._rollBall(dt, player);
      if (this._stompedOn(this.pos.x, this.pos.z, 0.7, this.pos.y + 0.9)) { this.stompCount++; this._defeat('stomp'); }
      else if (player) this._bump(player, this.pos.x, this.pos.y + 0.45, this.pos.z, 0.46, 3.5, 0.2, 0.9);
    }

    _rollBall(dt, player) {
      const step = CB_BALL_V * dt;
      // a wall or a drop ends the roll
      _a.set(this.ball.x, this.ball.y + this.ballR, this.ball.z);
      const w = this.world;
      let blocked = false;
      if (w && typeof w.raycast === 'function') {
        _ray.t = 0; _ray.collider = null;
        try { blocked = w.raycast(_a, this.ballDir, this.ballR + step, _ray) && !(_ray.collider && _ray.collider.ref === this); } catch (e) { blocked = false; }
      }
      const nx = this.ball.x + this.ballDir.x * step, nz = this.ball.z + this.ballDir.z * step;
      const gy = this._groundY(nx, this.ball.y + 0.8, nz, NaN);
      if (blocked || !Number.isFinite(gy) || gy < this.ball.y - 1.0 || gy > this.ball.y + 0.7 || this.ballDist >= CB_BALL_MAX) { this._burstBall(); return; }
      this.ball.set(nx, gy, nz);
      this.ballDist += step;
      this.ballR = 0.45 + 0.5 * clamp(this.ballDist / CB_BALL_MAX, 0, 1);
      this.ballAng += step / this.ballR;
      if (this._alive && player && capsuleHitsSphere(capsuleOf(player), this.ball.x, this.ball.y + this.ballR, this.ball.z, this.ballR * 0.95)) {
        this._hurt(player, this._px - this.ball.x + this.ballDir.x, this._pz - this.ball.z + this.ballDir.z, 7, 0.45);
        this.cheered = true;
        this.events.emit('ballHit', this);
        this._burstBall();
      }
    }

    onPound(player, pos) {
      if (this.defeated || this.state === 'gone') return;
      if (this._poundNear(player, pos, this.pos.x, this.pos.y, this.pos.z, 1.9)) this._defeat('pound');
    }

    _pose(dt) {
      const t = this.time;
      const k = this.popK;
      const b = this.body;
      b.position.set(this.pos.x, this.pos.y + this.hop, this.pos.z);
      const du = this.defeatU;
      b.rotation.set(-du * 1.3, this.yaw, du * 0.4);
      b.scale.setScalar(k * (1 - 0.5 * smoothstep(0.5, 1, du)));
      const sulk = this.state === 'sulk' ? 1 : 0;
      this.torso.rotation.set(-this.lean * 0.5 + sulk * 0.35 + 0.05 * Math.sin(t * 2), 0, 0);
      const patA = this.state === 'play' ? -0.9 - 0.4 * this.pat : 0;
      const clapA = this.clap * 0.9;
      const push = this.state === 'shove' ? -1.5 : (this.state === 'windup' ? -1.2 + this.lean * 0.4 : 0);
      this.armL.rotation.set(push + patA + (this.state === 'cheer' ? -2.4 : 0), 0, -0.2 + clapA);
      this.armR.rotation.set(push + (this.state === 'play' ? -0.6 : 0) + (this.state === 'cheer' ? -2.4 : 0), 0, 0.2 - clapA);
      this.feet.rotation.x = this.state === 'windup' ? 0.2 * Math.sin(t * 18) : 0;
      this._lookEyes(this.eyes, 0.8);
      if (sulk) this.eyes.look(0, -0.8);
      // the ball
      const bm = this.ballMesh;
      bm.visible = this.ballOn && this.state !== 'gone';
      if (bm.visible) {
        const r = this.ballR * (this.state === 'scoop' ? Math.max(0.05, this.ballK) : 1) * (this.state === 'defeat' ? 1 - du : 1);
        bm.position.set(this.ball.x, this.ball.y + r, this.ball.z);
        _b.set(this.ballDir.z, 0, -this.ballDir.x);
        if (_b.lengthSq() < 1e-6) _b.set(1, 0, 0);
        bm.quaternion.setFromAxisAngle(_b.normalize(), this.ballAng);
        if (this.state === 'windup') bm.position.x += 0.04 * Math.sin(t * 25);
        bm.scale.setScalar(Math.max(0.001, r));
      }
    }

    _syncColliders() {
      this.col.setCenter(this.pos.x, this.pos.y + this.hop + 0.45, this.pos.z);
      this.col.active = !this.defeated && this.state !== 'gone';
    }
  }

  /* =========================================================================
   * 10. AZURE — RAIL SENTRY
   *    A brass clockwork turret on a bogie that rides its own rail. Patrols,
   *    head scanning; when it SEES you (range, a 75 deg cone, line of sight) it
   *    stops, the lens flashes, the winding key spins up and a red AIM BEAM
   *    grows toward you (0.85 s; it stops tracking for the last 0.25 s), then a
   *    cog bolt flies down the beam. Stomp its dome or pound beside it.
   * ====================================================================== */

  const SN_TELE = 0.85, SN_LOCK = 0.25, SN_COOL = 1.5, SN_BOLT_V = 10, SN_BOLT_RANGE = 15, SN_TOP = 1.3, SN_CONE = Math.cos(75 * Math.PI / 180);

  class Sentry extends Creature {
    constructor(def, ctx) {
      super(def, ctx, 'sentry');
      this.naturalHeight = 1.4;
      this.startState = 'patrol';
      this.state = 'patrol';
      const d = this.def;
      const src = Array.isArray(d.path) && d.path.length >= 2 ? d.path : null;
      this.n = src ? src.length : 0;
      if (src) {
        this.pts = new Float32Array(this.n * 3);
        this.cum = new Float32Array(this.n);
        for (let i = 0; i < this.n; i++) {
          readV3(src[i], _a);
          const gy = this._groundY(_a.x, _a.y + 0.5, _a.z, _a.y);
          this.pts[i * 3] = _a.x; this.pts[i * 3 + 1] = gy; this.pts[i * 3 + 2] = _a.z;
        }
        this.loop = this.n >= 3 && d.loop === true;
        this.L = polylineLengths(this.pts, this.n, this.loop, this.cum);
      }
      this.speed = Math.max(0.3, fin(d.speed, 1.4));
      this.s = 0;
      this.headYaw = 0; this.lens = 0.4; this.keyA = 0; this.keySpin = 1; this.beamLen = 0;
      this.aim = new THREE.Vector3(0, 0, 1);
      this.muzzle = new THREE.Vector3();
      this.popHead = 0;
      this._build();
      this._initEmote();
      const cog = cached('sn:cog', () => {
        const parts = [normalizeAttrs(prismGeometry(0.14, 0.06, 10, 1))];
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          const t = normalizeAttrs(bevelBoxGeometry(0.05, 0.05, 0.06, 0.01, 1));
          t.translate(Math.cos(a) * 0.16, 0, Math.sin(a) * 0.16);
          parts.push(t);
        }
        const g = mergeGeometries(parts, false);
        for (const p of parts) p.dispose();
        g.rotateX(Math.PI / 2);
        g.computeBoundingSphere();
        return g;
      });
      this.bolts = new ShotSet(this.rig, 2, cog, getEmissive(0x7fe8ff, 1.6), 'cogBolts');
      this._mergeGroup(this.body, 'sentry_body');
      this.col = this._solidBox(this.pos.x, this.pos.y + SN_TOP * 0.5, this.pos.z, 0.36, SN_TOP * 0.5, 0.36, 'bounce', { power: 2.6 });
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const brass = worldMat('copper', this.ctx);
      const iron = skinMat(0x3a3f4a, 0.45, 0.7);
      const paint = skinMat(fin(this.def.color, 0x2f6fa8), 0.45, 0.2);
      const dark = skinMat(0x15171c, 0.6, 0.3);
      const flag = skinMat(0xf2c14a, 0.7, 0.0);
      // the rail (static, world space): a pair of bars + sleepers along the path
      if (this.n >= 2) {
        const rp = [];
        const segs = this.loop ? this.n : this.n - 1;
        for (let i = 0; i < segs; i++) {
          const a = i * 3, b = ((i + 1) % this.n) * 3;
          const ax = this.pts[a], ay = this.pts[a + 1], az = this.pts[a + 2];
          const bx = this.pts[b], by = this.pts[b + 1], bz = this.pts[b + 2];
          const len = Math.hypot(bx - ax, by - ay, bz - az);
          const yaw = Math.atan2(bx - ax, bz - az);
          const pitch = -Math.atan2(by - ay, Math.hypot(bx - ax, bz - az));
          for (let s = -1; s <= 1; s += 2) {
            const g = bbox(0.06, 0.08, len + 0.06, 0.015);
            place(g, 0, 0, 0, pitch, yaw, 0);
            g.translate((ax + bx) * 0.5 + Math.cos(yaw) * 0.2 * s, (ay + by) * 0.5 + 0.1, (az + bz) * 0.5 - Math.sin(yaw) * 0.2 * s);
            rp.push({ g, m: iron });
          }
          const nS = Math.max(1, Math.floor(len / 0.9));
          for (let k = 0; k <= nS; k++) {
            const u = k / nS;
            const g = bbox(0.62, 0.06, 0.14, 0.015);
            place(g, 0, 0, 0, 0, yaw, 0);
            g.translate(ax + (bx - ax) * u, ay + (by - ay) * u + 0.03, az + (bz - az) * u);
            rp.push({ g, m: dark });
          }
        }
        this.rail = mergeParts(rp, 'rail');
        this.rail.castShadow = false;
        this.rail.receiveShadow = true;
        this.rig.add(this.rail);
      }
      const body = pivot('body', null);
      // bogie
      const bogie = [{ g: place(bbox(0.56, 0.16, 0.66, 0.04), 0, 0.2, 0), m: iron }];
      for (let i = 0; i < 4; i++) {
        const sx = (i & 1) ? 0.3 : -0.3, sz = (i & 2) ? 0.22 : -0.22;
        bogie.push({ g: place(tubeGeometry(0.1, 0.1, 0.06, 12, 1), sx, 0.13, sz, 0, 0, Math.PI / 2), m: brass });
      }
      body.add(mergeParts(bogie, 'bogie'));
      this.barrel = pivot('barrel', body, 0, 0.28, 0);
      this.barrel.add(mergeParts([
        { g: place(tubeGeometry(0.3, 0.34, 0.66, 16, 1), 0, 0.33, 0), m: paint },
        { g: place(ringProfileGeometry(0.34, [0.03, 0.035, 0.01], 16, 1), 0, 0.08, 0), m: brass },
        { g: place(ringProfileGeometry(0.31, [0.03, 0.035, 0.01], 16, 1), 0, 0.6, 0), m: brass },
        { g: place(bbox(0.18, 0.1, 0.06, 0.02), 0, 0.36, 0.33), m: brass },
      ], 'barrel'));
      this.key = pivot('key', this.barrel, 0, 0.36, -0.36);
      this.key.add(mergeParts([
        { g: place(tubeGeometry(0.03, 0.03, 0.16, 8, 1), 0, 0, -0.08, Math.PI / 2, 0, 0), m: brass },
        { g: place(bbox(0.36, 0.14, 0.04, 0.02), 0, 0, -0.18), m: brass },
      ], 'key'));
      this.head = pivot('head', this.barrel, 0, 0.66, 0);
      this.head.add(mergeParts([
        { g: sphereGeo(0.3, 16, 10, 0, TAU, 0, Math.PI * 0.55), m: paint },
        { g: place(ringProfileGeometry(0.29, [0.025, 0.03, 0.01], 16, 1), 0, 0.02, 0), m: brass },
        { g: place(ringProfileGeometry(0.12, [0.03, 0.03, 0.01], 14, 1), 0, 0.14, 0.26, Math.PI / 2 - 0.3, 0, 0), m: brass },
        { g: place(tubeGeometry(0.012, 0.012, 0.42, 5, 1), 0.12, 0.44, -0.08), m: iron },
        { g: place(bbox(0.02, 0.1, 0.16, 0.005), 0.12, 0.6, -0.16), m: flag },
      ], 'dome'));
      this.lensMat = glowMat(this, 0x6fe0ff, 1.2, 0x06121a);
      const lens = new THREE.Mesh(place(discGeometry(0.1, 16), 0, 0.145, 0.275, Math.PI / 2 - 0.3, 0, 0), this.lensMat);
      lens.castShadow = false;
      lens.name = 'lens';
      this.head.add(lens);
      // the aim beam: a thin emissive bar we stretch toward the target
      this.beamMat = glowMat(this, 0xff3a2a, 2.5, 0x200404);
      this.beam = new THREE.Mesh(cached('sn:beam', () => { const g = normalizeAttrs(bevelBoxGeometry(0.035, 0.035, 1, 0.01, 1)); g.translate(0, 0, 0.5); g.computeBoundingSphere(); return g; }), this.beamMat);
      this.beam.castShadow = false;
      this.beam.visible = false;
      this.beam.frustumCulled = false;
      this.beam.name = 'aimBeam';
      this.rig.add(this.beam);
      this.body = body;
      this.rig.add(body);
    }

    _resetKind() {
      this.s = 0; this.headYaw = 0; this.lens = 0.4; this.keyA = 0; this.keySpin = 1; this.beamLen = 0; this.popHead = 0;
      this.bolts.clear();
      this.beam.visible = false;
      if (this.n >= 2) this._placeOnPath();
      this.head.position.set(0, 0.66, 0);
    }

    _placeOnPath() {
      let ss = this.s;
      if (!this.loop) ss = tri(this.s / (2 * Math.max(this.L, 1e-6))) * this.L;
      polylineAt(this.pts, this.n, this.cum, this.L, this.loop, ss, _a, _b);
      if (!this.loop && Math.floor(this.s / Math.max(this.L, 1e-6)) % 2 === 1) _b.negate();
      this.pos.set(_a.x, _a.y + 0.08, _a.z);
      if (_b.lengthSq() > 1e-6) this.yaw = Math.atan2(_b.x, _b.z);
    }

    /** Can the lens see the hero? range + cone + a clear line. */
    _sees() {
      if (!this._alive) return false;
      const dy = this._py - this.pos.y;
      if (this._pd > this.noticeR || Math.abs(dy) > 5) return false;
      const fy = this.yaw + this.headYaw;
      const fx = Math.sin(fy), fz = Math.cos(fy);
      const dot = (this._pdx * fx + this._pdz * fz) / Math.max(this._pd, 1e-4);
      if (this._pd > 4 && dot < SN_CONE) return false;
      const w = this.world;
      if (!w || typeof w.raycast !== 'function') return true;
      _a.set(this.pos.x, this.pos.y + 1.05, this.pos.z);
      _b.set(this._px - _a.x, this._py + 0.9 - _a.y, this._pz - _a.z);
      const d = _b.length();
      if (d < 0.5) return true;
      _b.multiplyScalar(1 / d);
      _ray.t = 0; _ray.collider = null;
      let hit = false;
      try { hit = w.raycast(_a, _b, d - 0.4, _ray); } catch (e) { return true; }
      return !hit || !!(_ray.collider && _ray.collider.ref === this);
    }

    _onEnter(s) {
      if (s === 'track') { this.lens = 2.5; this._sfx('ui_move', this.pos, 1.9, 0.5); }
      else if (s === 'tele') { this._sfx('vanish_warn', this.pos, 1.4, 0.6); this.beam.visible = true; }
      else if (s === 'fire') { this._fire(); }
      else if (s === 'cool') { this._burst('dust', _a.set(this.pos.x, this.pos.y + 1.1, this.pos.z), 0xe8f2ff, 0.6); }
      else if (s === 'defeat') {
        this.beam.visible = false;
        this._burst('spark', _a.set(this.pos.x, this.pos.y + 1.0, this.pos.z), 0xffd27a, 1.2);
        this._sfx('crusher_slam', this.pos, 1.7, 0.6);
      }
    }

    _fire() {
      this.beam.visible = false;
      const i = this.bolts.free();
      if (i < 0) return;
      this.bolts.fire(i, this.muzzle.x, this.muzzle.y, this.muzzle.z, this.aim.x * SN_BOLT_V, this.aim.y * SN_BOLT_V, this.aim.z * SN_BOLT_V, SN_BOLT_RANGE / SN_BOLT_V);
      this._sfx('cannon_fire', this.muzzle, 1.8, 0.45);
      this._burst('spark', this.muzzle, 0x7fe8ff, 0.5);
      this.events.emit('fire', this);
    }

    _think(dt, player) {
      const sees = this.state === 'patrol' || this.state === 'cool' ? this._sees() : false;
      switch (this.state) {
        case 'patrol':
          if (this.n >= 2) { this.s += this.speed * dt; this._placeOnPath(); }
          else this.yaw += dt * 0.3;
          this.headYaw = 0.7 * Math.sin(this.time * 0.9);
          this.keySpin = 1;
          if (sees) { this.aware = true; this._notice(); this._enter('track'); }
          break;
        case 'track': {
          const want = wrapAngle(Math.atan2(this._pdx, this._pdz) - this.yaw);
          this.headYaw = dampAngle(this.headYaw, want, 12, dt);
          if (this.stateT >= 0.3) this._enter('tele');
          break;
        }
        case 'tele': {
          this.keySpin = 9;
          const lockAt = SN_TELE - SN_LOCK;
          if (this.stateT < lockAt) {
            const want = wrapAngle(Math.atan2(this._pdx, this._pdz) - this.yaw);
            this.headYaw = dampAngle(this.headYaw, want, 10, dt);
            this._aimAtHero();
          }
          this.lens = 1.5 + 3.5 * clamp(this.stateT / SN_TELE, 0, 1);
          this.beamLen = Math.min(SN_BOLT_RANGE, this.beamLen + dt * 30);
          if (this.stateT >= SN_TELE) this._enter('fire');
          break;
        }
        case 'fire':
          if (this.stateT >= 0.15) this._enter('cool');
          break;
        case 'cool':
          this.keySpin = 3;
          this.lens = damp(this.lens, 0.6, 4, dt);
          if (this.stateT >= SN_COOL) {
            if (sees) this._enter('track');
            else { this.aware = false; this._enter('patrol'); }
          }
          break;
      }
      this._stepBolts(dt, player);
      if (this._stompedOn(this.pos.x, this.pos.z, 0.6, this.pos.y + SN_TOP)) { this.stompCount++; this._defeat('stomp'); }
    }

    _aimAtHero() {
      this.head.getWorldPosition(this.muzzle);
      const fy = this.yaw + this.headYaw;
      this.muzzle.x += Math.sin(fy) * 0.3; this.muzzle.z += Math.cos(fy) * 0.3; this.muzzle.y += 0.14;
      this.aim.set(this._px - this.muzzle.x, this._py + 0.85 - this.muzzle.y, this._pz - this.muzzle.z);
      if (this.aim.lengthSq() < 1e-6) this.aim.set(Math.sin(fy), 0, Math.cos(fy));
      this.aim.normalize();
    }

    _stepBolts(dt, player) {
      const S = this.bolts;
      S.step(dt, 0);
      const w = this.world;
      for (let i = 0; i < S.n; i++) {
        if (!S.on[i]) continue;
        const k = i * 3;
        _a.set(S.p[k], S.p[k + 1], S.p[k + 2]);
        let end = S.t[i] >= S.life[i];
        if (!end && this._alive && player && capsuleHitsSphere(capsuleOf(player), _a.x, _a.y, _a.z, 0.22)) {
          this._hurt(player, S.v[k], S.v[k + 2], 6, 0.35);
          this._sfx('step_metal', _a, 1.6, 0.8);
          end = true;
        }
        if (!end && w && typeof w.raycast === 'function') {
          _b.set(S.v[k], S.v[k + 1], S.v[k + 2]).normalize();
          _c.copy(_a).addScaledVector(_b, -SN_BOLT_V * dt);
          _ray.t = 0; _ray.collider = null;
          let hit = false;
          try { hit = w.raycast(_c, _b, SN_BOLT_V * dt + 0.1, _ray); } catch (e) { hit = false; }
          if (hit && !(_ray.collider && _ray.collider.ref === this)) end = true;
        }
        if (end) { this._burst('spark', _a, 0x7fe8ff, 0.7); S.kill(i); }
      }
      S.write(14);
    }

    onPound(player, pos) {
      if (this.defeated || this.state === 'gone') return;
      if (this._poundNear(player, pos, this.pos.x, this.pos.y, this.pos.z, 1.9)) this._defeat('pound');
    }

    _pose(dt) {
      const t = this.time;
      const k = this.popK;
      const b = this.body;
      b.position.copy(this.pos);
      b.rotation.set(0, this.yaw, 0);
      b.scale.setScalar(k);
      const du = this.defeatU;
      this.barrel.rotation.set(0.5 * smoothstep(0.3, 1, du), 0, 0.12 * Math.sin(t * 20) * du);
      this.head.rotation.set(0, this.headYaw + du * 6, 0);
      this.head.position.set(0, 0.66 + 1.4 * Math.sin(Math.min(1, du * 1.4) * Math.PI) * (du > 0 ? 1 : 0), 0);
      this.keyA += dt * this.keySpin * (1 - du);
      this.key.rotation.z = this.keyA;
      this.lensMat.emissiveIntensity = this.lens * (1 - du);
      this.lensMat.emissive.setHex(this.state === 'tele' || this.state === 'fire' ? 0xff3a2a : 0x6fe0ff);
      if (this.beam.visible) {
        this._aimMuzzleOnly();
        this.beam.position.copy(this.muzzle);
        _b.set(0, 0, 1);
        _q.setFromUnitVectors(_b, this.aim);
        this.beam.quaternion.copy(_q);
        const locked = this.stateT >= SN_TELE - SN_LOCK;
        const w = locked ? 1.8 + 0.8 * Math.sin(t * 60) : 1;
        this.beam.scale.set(w, w, Math.max(0.01, this.beamLen));
        this.beamMat.emissiveIntensity = locked ? 5 : 2.5;
      } else this.beamLen = 0;
    }

    _aimMuzzleOnly() {
      this.head.getWorldPosition(this.muzzle);
      const fy = this.yaw + this.headYaw;
      this.muzzle.x += Math.sin(fy) * 0.3; this.muzzle.z += Math.cos(fy) * 0.3; this.muzzle.y += 0.14;
    }

    _syncColliders() {
      this.col.setCenter(this.pos.x, this.pos.y + SN_TOP * 0.5, this.pos.z);
      this.col.active = !this.defeated && this.state !== 'gone';
    }
  }

  /* =========================================================================
   * 11. AZURE — SKY PUFFER
   *    A round sky fish. Drifts its lane blowing bubbles; within 5 m it puffs
   *    its cheeks ("!") and INFLATES into a big springy ball that holds still —
   *    a bounce platform (bounces you higher than a triple jump). It blinks
   *    and hisses for 0.8 s before it deflates. Deflated it is prickly (a
   *    shove); a stomp then defeats it. Pound it while it is puffed and it
   *    POPS. It floats back after 10 s — the platform is not lost for good.
   * ====================================================================== */

  const PF_INFLATE = 0.45, PF_HOLD = 4.2, PF_WARN = 0.8, PF_DEFLATE = 0.5, PF_COOL = 1.4, PF_BIG = 2.2, PF_R = 0.45;
  /* Puffed, the ball SETTLES so its bottom kisses the ground: its top is then
     groundY + 1.87 * R_big * 0.92... = ~1.7 m, under a single jump's 1.91 m apex,
     so it is a platform you can get onto from the floor. */
  const PF_SIT = PF_R * PF_BIG * 0.92;

  class Puffer extends Creature {
    constructor(def, ctx) {
      super(def, ctx, 'puffer');
      this.naturalHeight = 0.9;
      this.startState = 'drift';
      this.state = 'drift';
      const d = this.def;
      this.hover = Math.max(0.6, fin(d.hover, 1.2));
      readV3(d.p || (Array.isArray(d.path) && d.path.length ? d.path[0] : null), this.home);
      this.groundY = this._groundY(this.home.x, this.home.y + 0.5, this.home.z, this.home.y - this.hover);
      if (d.hover === undefined && this.home.y - this.groundY > 0.6) this.hover = this.home.y - this.groundY;
      this.home.y = this.groundY + this.hover;
      this.pos.copy(this.home);
      const src = Array.isArray(d.path) && d.path.length >= 2 ? d.path : null;
      this.n = src ? src.length : 0;
      if (src) {
        this.pts = new Float32Array(this.n * 3);
        this.cum = new Float32Array(this.n);
        for (let i = 0; i < this.n; i++) { readV3(src[i], _a); this.pts[i * 3] = _a.x; this.pts[i * 3 + 1] = this.home.y; this.pts[i * 3 + 2] = _a.z; }
        this.loop = this.n >= 3 && d.loop !== false;
        this.L = polylineLengths(this.pts, this.n, this.loop, this.cum);
      }
      this.speed = Math.max(0.2, fin(d.speed, 0.9));
      this.bouncePower = Math.max(2, fin(d.power, 5.5));
      this.s = 0; this.puff = 0; this.cool = 0; this.blink = 0; this.bubbleT = 1.5; this.hold = new THREE.Vector3();
      this._build();
      this._initEmote();
      this._mergeGroup(this.body, 'puffer_body');
      this.col = this._solidBox(this.pos.x, this.pos.y, this.pos.z, PF_R * 0.8, PF_R * 0.8, PF_R * 0.8, 'bounce', { power: this.bouncePower });
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const skin = skinMat(fin(this.def.color, 0xf2b84a), 0.5, 0.0);
      const belly = skinMat(0xfff0cc, 0.55, 0.0);
      const spot = skinMat(0xd9722e, 0.55, 0.0);
      const lip = skinMat(0xe86a86, 0.4, 0.0);
      const fin2 = skinMat(0x6fc6e8, 0.35, 0.0);
      const nub = skinMat(0xf7d68a, 0.5, 0.0);
      const body = pivot('body', null);
      this.ball = pivot('ball', body, 0, 0, 0);
      const parts = [
        { g: ell(PF_R, 1, 0.95, 1.05, 0, 0, 0, 20, 14), m: skin },
        { g: ell(PF_R * 0.82, 0.95, 0.7, 0.9, 0, -0.14, 0.06), m: belly },
        { g: place(ringProfileGeometry(0.09, [0.04, 0.05, 0.015], 14, 1), 0, -0.04, PF_R * 1.0, Math.PI / 2, 0, 0), m: lip },
      ];
      for (let i = 0; i < 8; i++) {
        const a = i * 0.9 + 0.4, e = 0.3 + (i % 3) * 0.3;
        parts.push({ g: ell(0.05, 1, 1, 0.4, Math.cos(a) * Math.cos(e) * PF_R * 0.98, Math.sin(e) * PF_R * 0.9, -Math.abs(Math.sin(a)) * PF_R * 0.6, 8, 6), m: spot });
      }
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * TAU, e = ((i % 4) - 1.5) * 0.45;
        parts.push({ g: spike(0.035, 0.07, 5, Math.cos(a) * Math.cos(e) * PF_R, Math.sin(e) * PF_R, Math.sin(a) * Math.cos(e) * PF_R,
          Math.sin(a) * Math.cos(e) * 1.5, 0, -Math.cos(a) * Math.cos(e) * 1.5 + Math.sin(e)), m: nub });
      }
      this.ball.add(mergeParts(parts, 'puffer'));
      this.eyes = makeEyes(0.1, 0.34, 0, 0.14, PF_R * 0.78, -0.05);
      this.ball.add(this.eyes.group);
      this.tail = pivot('tail', this.ball, 0, 0, -PF_R * 0.9);
      this.tail.add(mergeParts([{ g: place(ell(0.2, 0.2, 1, 0.9, 0, 0, -0.16), 0, 0, 0), m: fin2 }], 'tail'));
      this.finL = pivot('finL', this.ball, -PF_R * 0.9, -0.02, 0.05);
      this.finL.add(mergeParts([{ g: ell(0.13, 1, 0.12, 0.7, -0.1, 0, 0), m: fin2 }], 'fin'));
      this.finR = pivot('finR', this.ball, PF_R * 0.9, -0.02, 0.05);
      this.finR.add(mergeParts([{ g: ell(0.13, 1, 0.12, 0.7, 0.1, 0, 0), m: fin2 }], 'fin'));
      this.body = body;
      this.rig.add(body);
    }

    get radius() { return PF_R * (1 + (PF_BIG - 1) * this.puff); }

    _resetKind() {
      this.s = 0; this.puff = 0; this.cool = 0; this.blink = 0; this.bubbleT = 1.5;
      if (this.n >= 2) this._placeOnPath(); else this.pos.copy(this.home);
    }

    _placeOnPath() {
      let ss = this.s;
      if (!this.loop) ss = tri(this.s / (2 * Math.max(this.L, 1e-6))) * this.L;
      polylineAt(this.pts, this.n, this.cum, this.L, this.loop, ss, _a, _b);
      if (!this.loop && Math.floor(this.s / Math.max(this.L, 1e-6)) % 2 === 1) _b.negate();
      this.pos.set(_a.x, this.home.y + 0.15 * Math.sin(this.time * 1.7), _a.z);
      if (_b.lengthSq() > 1e-6) this.yaw = dampAngle(this.yaw, Math.atan2(_b.x, _b.z), 3, 1 / 60);
    }

    _stompable() { return this.state === 'drift' || this.state === 'deflate'; }
    _strikeable() { return this.state !== 'puffed' && this.state !== 'inflate' && this.state !== 'warn'; }

    _onEnter(s) {
      if (s === 'inflate') { this.hold.copy(this.pos); this._sfx('bounce', this.pos, 0.55, 0.9); this._burst('bubbles', this.pos, 0xbfefff, 0.8); }
      else if (s === 'warn') { this._sfx('vanish_warn', this.pos, 1.2, 0.5); }
      else if (s === 'deflate') { this._sfx('wind', this.pos, 1.6, 0.4); this._burst('bubbles', this.pos, 0xbfefff, 0.6); }
      else if (s === 'defeat') {
        this._burst('bubbles', this.pos, 0xbfefff, 1.6);
        this._burst('squish', this.pos, 0xf2b84a, 1.0);
        this._sfx('bounce', this.pos, 0.5, 1.0);
        this._sfx('crusher_slam', this.pos, 1.9, 0.5);
      }
    }

    _think(dt, player) {
      const seen = this._updateAware(dt);
      if (this.cool > 0) this.cool -= dt;
      this.bubbleT -= dt;
      if (this.bubbleT <= 0) { this.bubbleT = 1.8 + this.rng() * 1.2; if (this.state === 'drift') this._burst('bubbles', this.pos, 0xbfefff, 0.25); }
      const R = this.radius;
      switch (this.state) {
        case 'drift':
          if (this.n >= 2) { this.s += this.speed * dt; this._placeOnPath(); }
          else this.pos.set(this.home.x, this.home.y + 0.15 * Math.sin(this.time * 1.7), this.home.z);
          if (this._pd < this.noticeR + 3) this._faceHero(2.5, dt);
          this.puff = damp(this.puff, 0, 8, dt);
          if (seen && this.cool > 0) { /* noticed, but still recovering */ }
          if (this.aware && this.cool <= 0 && this._pd < this.noticeR) this._enter('inflate');
          if (player) this._bump(player, this.pos.x, this.pos.y, this.pos.z, PF_R + 0.08, 4, 0.2, 0.9);
          break;
        case 'inflate': {
          const u = clamp(this.stateT / PF_INFLATE, 0, 1);
          this.puff = easeOutBack(u, 2.0);
          this.hold.y = damp(this.hold.y, this.groundY + PF_SIT, 10, dt);
          this.pos.copy(this.hold);
          if (u >= 1) this._enter('puffed');
          break;
        }
        case 'puffed':
          this.puff = 1;
          this.hold.y = damp(this.hold.y, this.groundY + PF_SIT, 10, dt);
          this.pos.copy(this.hold);
          if (this.stateT >= PF_HOLD - PF_WARN) this._enter('warn');
          this._sidePush(player, R);
          break;
        case 'warn':
          this.puff = 1 + 0.04 * Math.sin(this.stateT * 45);
          this.blink = Math.sin(this.stateT * 30) > 0 ? 1 : 0;
          this.pos.copy(this.hold);
          if (this.stateT >= PF_WARN) this._enter('deflate');
          this._sidePush(player, R);
          break;
        case 'deflate': {
          const u = clamp(this.stateT / PF_DEFLATE, 0, 1);
          this.puff = 1 - smoothstep(0, 1, u);
          this.blink = 0;
          this.hold.y = damp(this.hold.y, this.home.y, 8, dt);
          this.pos.copy(this.hold);
          if (u >= 1) { this.cool = PF_COOL; this._enter('drift'); }
          break;
        }
      }
      if (this._stompable() && this._stompedOn(this.pos.x, this.pos.z, R * 0.9, this.pos.y + R * 0.8)) { this.stompCount++; this._defeat('stomp'); }
    }

    /** A puffed ball shoves you off its side, gently. */
    _sidePush(player, R) {
      if (!player || !this._alive || this.hitCd > 0) return;
      if (this._py > this.pos.y + R * 0.5) return;
      if (capsuleHitsSphere(capsuleOf(player), this.pos.x, this.pos.y, this.pos.z, R * 0.95)) {
        this.hitCd = 0.5;
        this._hurt(player, this._pdx, this._pdz, 4.5, 0.0);
        this._sfx('bounce', this.pos, 1.3, 0.5);
      }
    }

    onStand(player) {
      if (this.defeated) return;
      if (this._stompable()) { this.stompCount++; this._defeat('stomp'); return; }
      this.events.emit('bounced', this, player);
    }

    onPound(player, pos) {
      if (this.defeated || this.state === 'gone') return;
      const R = this.radius;
      const p = (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) ? pos : (player && (player.pos || player.position));
      if (!p) return;
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      const puffed = this.state === 'puffed' || this.state === 'warn' || this.state === 'inflate';
      /* a pound LANDING on the puffed ball (its top) pops it; a pound on the
         ground beside a deflated one is a plain defeat */
      if (puffed) {
        if (dx * dx + dz * dz <= (R + 0.4) * (R + 0.4) && p.y >= this.pos.y + R * 0.3 && p.y <= this.pos.y + R + 1.2) this._defeat('pop');
      } else if (dx * dx + dz * dz <= 1.8 * 1.8 && Math.abs(p.y - this.pos.y) < 2.2) this._defeat('pound');
    }

    onStrike(player, kind, pos, dir) {
      if (this.defeated || this.state === 'gone') return false;
      if (this.state === 'puffed' || this.state === 'warn') {
        /* a kicked puffer is a ball: it rolls away a little and is fine */
        if (dir) { this.hold.x += (dir.x || 0) * 1.5; this.hold.z += (dir.z || 0) * 1.5; }
        this._sfx('bounce', this.pos, 1.1, 0.7);
        return true;
      }
      return this._defeat(kind || 'strike');
    }

    _pose(dt) {
      const t = this.time;
      const k = this.popK;
      const b = this.body;
      b.position.copy(this.pos);
      b.rotation.set(0.1 * Math.sin(t * 1.3), this.yaw, 0.08 * Math.sin(t * 1.1));
      const du = this.defeatU;
      const s = (1 + (PF_BIG - 1) * this.puff) * k * (1 + 0.6 * du);
      b.scale.set(s, s * (1 - 0.1 * this.blink), s);
      const flutter = Math.sin(t * (this.state === 'drift' ? 14 : 30));
      this.finL.rotation.set(0, 0.5 * flutter, 0.3);
      this.finR.rotation.set(0, -0.5 * flutter, -0.3);
      this.tail.rotation.y = 0.5 * Math.sin(t * 6);
      this._lookEyes(this.eyes, 0.14);
      if (this.state === 'warn') this.eyes.look(0.8 * Math.sin(t * 20), 0);
      b.visible = this.state !== 'gone' && !(du > 0.35);
    }

    _syncColliders() {
      const R = this.radius;
      const h = R * 0.8;
      this.col.half.set(h, h, h);
      this.col.setCenter(this.pos.x, this.pos.y, this.pos.z);
      this.col.active = !this.defeated && this.state !== 'gone';
    }
  }

  /* ---------------------------------------------------------------- utils */

  /** Body-convention heading (+Z forward at yaw 0). */
  function headingFrom(yaw, out) { return out.set(Math.sin(yaw), 0, Math.cos(yaw)); }

  const classes = { Burrower, Podspitter, SlagCrab, EmberImp, Skater, SnowCub, Sentry, Puffer };
  const factories = {
    burrower: (def, ctx) => new Burrower(def, ctx),
    podspitter: (def, ctx) => new Podspitter(def, ctx),
    slagcrab: (def, ctx) => new SlagCrab(def, ctx),
    emberimp: (def, ctx) => new EmberImp(def, ctx),
    skater: (def, ctx) => new Skater(def, ctx),
    snowcub: (def, ctx) => new SnowCub(def, ctx),
    sentry: (def, ctx) => new Sentry(def, ctx),
    puffer: (def, ctx) => new Puffer(def, ctx),
  };
  return { Creature, ShotSet, MarkerSet, StarRing, factories, classes, helpers: { ell, spike, limbZ, limbY, pivot, glowMat, headingFrom } };
}
