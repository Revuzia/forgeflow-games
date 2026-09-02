// runtime/hazards/breakable.js
// CRESTBOUND — the three "the floor answers back" objects (CONTRACT §21):
//
//   breakable — a crate the ground pound shatters. `props.breakable = true` on its Collider is
//               the flag runtime/player/collide.js reports through `CollisionResult.breakable`;
//               `onPound()` blows it into a deterministic shard burst, removes the collider and
//               pays out (`def.drop`: coins, or a `trigger` that spawns a secret crest).
//   sinker    — a platform that sinks while stood on (after `delay`, at `speed`) and rises back
//               when you step off. Announced before it moves: the studs go amber, the deck
//               shivers, and a dust ring blooms at the waterline.
//   seesaw    — a plank on a fulcrum that tilts about `axis` by RIDER POSITION and springs back
//               to level when nobody is on it.
//
// DETERMINISM (CONTRACT §21): `breakable` is closed-form in `t` once broken — the shard cloud is
// a pure function of `t - breakT`, and `breakT` itself lives on the COURSE CLOCK, so a clock
// rewind on respawn restores the crate bit-for-bit. `reset(t)` un-breaks it.
//
// `sinker` and `seesaw` are the two legitimately RIDER-DRIVEN hazards in the package. Their
// state cannot be closed-form because it is a function of where the player is, so instead they
// obey the weaker guarantee the law allows: they hold their state on the course clock and
// `reset(t)` returns them to the pristine pose (deck at rest, plank level) exactly as a freshly
// built one. Nothing else in the course can observe a difference.
//
// CARRY: the sinker deck and the seesaw plank are both solids the hero rides. Each publishes
// `linVel` / `angVel` / `angAxis` / `angCenter` and `velocityAtPoint(p, out)` so
// runtime/player/collide.js carries a standing player with the motion (CONTRACT §10).

import * as THREE from 'three';
import { clamp, lerp, damp, smoothstep } from '../core/util.js';
import { TUNE } from '../core/tuning.js';
import {
  Hazard, num, v3, sizeVec, dirVec, palette, hazMat, additiveMaterial, makeGlowSprite,
  bevelBox, mergeAll, makeCollider, setColliderBox, hazSfx, hazBurst, hazTrigger,
  hazDropCoins, hazRandom, qualityOf, standingOn, resolvePlayer, hazShake, hazStinger,
} from './lasers.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const UPV = new THREE.Vector3(0, 1, 0);

/** A chamfered slab pre-translated into local space. */
function slab(w, h, d, x, y, z, bevel = 0.02, detail = 1) {
  const g = bevelBox(Math.max(0.02, w), Math.max(0.02, h), Math.max(0.02, d), bevel, 1.7, detail);
  g.translate(x, y, z);
  return g;
}

/** Euler from a course `rot` triple (RADIANS). */
function eulerOf(rot) {
  if (!rot) return _e.set(0, 0, 0);
  if (Array.isArray(rot)) return _e.set(num(rot[0], 0), num(rot[1], 0), num(rot[2], 0));
  return _e.set(num(rot.x, 0), num(rot.y, 0), num(rot.z, 0));
}

/* ======================================================================================
   BREAKABLE
   ====================================================================================== */

class BreakableHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'breakable');
    const pal = palette(ctx);
    const q = qualityOf(ctx);

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 1.4, 1.4, 1.4);
    this.quat = new THREE.Quaternion().setFromEuler(eulerOf(def.rot));
    this.matKey = typeof def.mat === 'string' ? def.mat : 'wood';
    this.drop = def.drop === 'crest' ? 'crest' : (def.drop === 'none' ? 'none' : 'coins');
    this.dropCount = Math.max(1, Math.round(num(def.dropCount, 5)));
    // A `secret` crest spawns on a named trigger (CONTRACT §22). Fall back to a stable id
    // derived from the def so a course author can wire one without inventing a name.
    this.triggerId = def.trigger || def.id
      || ('breakable@' + this.center.x.toFixed(2) + ',' + this.center.y.toFixed(2) + ',' + this.center.z.toFixed(2));
    // Seconds after the break before the crate reforms; 0 (default) means "stays broken until
    // the next checkpoint reset", which is what a coin crate wants.
    this.respawn = Math.max(0, num(def.respawn, 0));

    // `openOn` is the INPUT trigger (the opposite direction to `trigger`, which this crate
    // EMITS when it breaks): a cage that a critter/secret elsewhere unlocks. verdant-1's
    // gnasher cage holds the secret crest inside a solid box, so without this the crest is
    // spawned unreachable. Subscribing to the course Emitter is the only channel a hazard
    // has for another object's trigger. Allocation-free after construction.
    this.openOn = typeof def.openOn === 'string' ? def.openOn : null;
    this._openFired = false;
    this._onTrigger = null;
    if (this.openOn && ctx && ctx.events && typeof ctx.events.on === 'function') {
      this._onTrigger = (id) => {
        if (id !== this.openOn || this._openFired) return;
        this._openFired = true;
        this._break(null);
      };
      try { ctx.events.on('trigger', this._onTrigger); } catch (e) { this._onTrigger = null; }
    }

    this.accent = new THREE.Color(pal.accent !== undefined ? pal.accent : 0x5ec8ff);
    this.crackColor = new THREE.Color(pal.crest !== undefined ? pal.crest : 0xffe066);

    /** Course-clock timestamp of the break, or null while intact. */
    this.breakT = null;
    this._paid = false;

    this._buildBody();
    this._buildShards(q);
    this._buildCollider();
    this.reset(0);
  }

  _buildBody() {
    const w = this.size.x, h = this.size.y, d = this.size.z;
    const plankT = clamp(Math.min(w, d) * 0.09, 0.04, 0.14);
    const parts = [];
    const bands = [];
    const cracks = [];

    // Six plank faces rather than one box: real thickness at the silhouette, and the crate
    // still reads as boards when the pound cracks it open.
    /* Plank count is a silhouette read, not a detail level: four boards per
       face already reads as "boards", and each one is a bevelled box. */
    const nPlank = Math.min(4, Math.max(3, Math.round(w / 0.34)));
    for (let s = -1; s <= 1; s += 2) {
      for (let i = 0; i < nPlank; i++) {
        const u = (i + 0.5) / nPlank - 0.5;
        parts.push(slab(w / nPlank * 0.94, h * 0.96, plankT, u * w, 0, s * (d * 0.5 - plankT * 0.5), 0.012, 0.18));
        parts.push(slab(plankT, h * 0.96, d / nPlank * 0.94, s * (w * 0.5 - plankT * 0.5), 0, u * d, 0.012, 0.18));
      }
    }
    // top + bottom decking
    for (const s of [1, -1]) {
      for (let i = 0; i < nPlank; i++) {
        const u = (i + 0.5) / nPlank - 0.5;
        parts.push(slab(w * 0.96, plankT, d / nPlank * 0.94, 0, s * (h * 0.5 - plankT * 0.5), u * d, 0.012, 0.18));
      }
    }
    // corner posts
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
      parts.push(slab(plankT * 1.9, h, plankT * 1.9, sx * (w * 0.5 - plankT), 0, sz * (d * 0.5 - plankT), 0.018));
    }
    // iron banding around the girth, top and bottom
    const bandT = plankT * 0.55;
    for (const y of [h * 0.30, -h * 0.30]) {
      bands.push(slab(w * 1.02, bandT, bandT, 0, y, d * 0.5, 0.008, 0.4));
      bands.push(slab(w * 1.02, bandT, bandT, 0, y, -d * 0.5, 0.008, 0.4));
      bands.push(slab(bandT, bandT, d * 1.02, w * 0.5, y, 0, 0.008, 0.4));
      bands.push(slab(bandT, bandT, d * 1.02, -w * 0.5, y, 0, 0.008, 0.4));
    }

    // Hairline stress cracks in the accent colour: the READ that this crate is poundable,
    // authored as an X across two opposing faces plus a rosette on the lid.
    const cw = plankT * 0.30;
    for (const sz of [1, -1]) {
      for (const rot of [0.72, -0.72]) {
        const g = bevelBox(w * 0.66, cw, cw, cw * 0.3, 1.7, 0.34);
        g.rotateZ(rot);
        g.translate(0, 0, sz * (d * 0.5 + 0.008));
        cracks.push(g);
      }
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const g = bevelBox(Math.min(w, d) * 0.30, cw, cw, cw * 0.3, 1.7, 0.34);
      g.rotateY(a);
      g.translate(Math.cos(a) * w * 0.16, h * 0.5 + 0.008, Math.sin(a) * d * 0.16);
      cracks.push(g);
    }

    this.body = new THREE.Mesh(mergeAll(parts), hazMat(this.ctx, this.matKey));
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.position.copy(this.center);
    this.body.quaternion.copy(this.quat);
    this.add(this.body);

    this.bandMesh = new THREE.Mesh(mergeAll(bands), hazMat(this.ctx, 'metal'));
    this.bandMesh.castShadow = true;
    this.bandMesh.position.copy(this.center);
    this.bandMesh.quaternion.copy(this.quat);
    this.add(this.bandMesh);

    this.crackMat = additiveMaterial(this.crackColor.getHex(), { cached: false, opacity: 0.42 });
    this.own(this.crackMat);
    this.crackMesh = new THREE.Mesh(mergeAll(cracks), this.crackMat);
    this.crackMesh.renderOrder = 5;
    this.crackMesh.position.copy(this.center);
    this.crackMesh.quaternion.copy(this.quat);
    this.add(this.crackMesh);

    // A hint of what is inside, visible only through the cracks.
    this.coreGlow = makeGlowSprite(this.crackColor.getHex(), Math.min(w, d) * 1.5, 0.10, 3.0);
    this.own(this.coreGlow.material);
    this.coreGlow.position.copy(this.center);
    this.add(this.coreGlow);
  }

  _buildShards(q) {
    const w = this.size.x, h = this.size.y, d = this.size.z;
    const n = clamp(Math.round(18 * clamp(q.particles, 0.3, 1)) + 8, 10, 34);
    this.shardCount = n;

    // Splintered plank fragments — a stretched, chamfered sliver, not an octahedron.
    const frag = bevelBox(0.30, 0.09, 0.13, 0.014, 1.7, 0.4);
    this.shardMesh = new THREE.InstancedMesh(mergeAll([frag]), hazMat(this.ctx, this.matKey), n);
    this.shardMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shardMesh.castShadow = false;
    this.shardMesh.frustumCulled = false;
    this.shardMesh.visible = false;
    this.add(this.shardMesh);

    const rnd = hazRandom(this.def, 517);
    this.shards = [];
    for (let i = 0; i < n; i++) {
      // Spawn on the crate's shell, fly outward from the centre with a deterministic spin.
      const ux = (rnd() * 2 - 1), uy = (rnd() * 2 - 1), uz = (rnd() * 2 - 1);
      _v.set(ux * w * 0.5, uy * h * 0.5, uz * d * 0.5);
      const dir = new THREE.Vector3(_v.x, _v.y * 0.6 + h * 0.35, _v.z);
      if (dir.lengthSq() < 1e-6) dir.set(0, 1, 0);
      dir.normalize();
      this.shards.push({
        ox: _v.x, oy: _v.y, oz: _v.z,
        dx: dir.x, dy: dir.y, dz: dir.z,
        speed: lerp(3.0, 7.5, rnd()),
        spinA: lerp(-9, 9, rnd()),
        spinB: lerp(-7, 7, rnd()),
        scale: lerp(0.55, 1.35, rnd()),
        life: lerp(0.85, 1.55, rnd()),
      });
    }
  }

  _buildCollider() {
    // `props.breakable` is the CONTRACT §9 flag the resolver reports; the collider stays SOLID
    // until the crate actually breaks, so a crate is a real platform right up to the pound.
    this.collider = makeCollider({
      center: this.center,
      half: _v.copy(this.size).multiplyScalar(0.5),
      quat: this.quat,
      surface: this.matKey === 'wood' ? 'wood' : 'normal',
      ref: this,
      group: 'hazard',
      props: {
        breakable: true, hazard: this,
        stepSfx: this.matKey === 'wood' ? 'step_wood' : 'step_stone', stepRate: 1.0,
      },
    });
    this.colliders.push(this.collider);
  }

  /** True while the crate is whole at course time `t`. */
  intactAt(t) {
    if (this.breakT === null) return true;
    if (t < this.breakT) return true;                 // clock rewound past the break
    if (this.respawn > 0 && t - this.breakT >= this.respawn) return true;
    return false;
  }

  /** CONTRACT §21: a ground pound landing on / within shockRadius of this crate. */
  onPound(player) {
    this._break(player);
  }

  /**
   * A dive or a slide into the crate breaks it too — the moveset teaches that momentum is a
   * tool, and a crate that only answers to the pound reads as a bug the first time you belly
   * into it at 13 m/s.
   */
  onTouch(info) {
    if (!info) return;
    if (info.type === 'dive' || info.type === 'slide' || info.type === 'break') this._break(null);
  }

  _break(player) {
    if (!this.intactAt(this.time)) return;
    this.breakT = this.time;
    this._paid = false;
    this._payout(player);
  }

  _payout(player) {
    if (this._silent) return;
    _v.copy(this.center);
    hazSfx(this.ctx, 'shatter', { gain: 0.9, rate: this.matKey === 'wood' ? 1.0 : 0.72, pos: _v, ref: 10, max: 44 });
    hazBurst(this.ctx, 'shatter', _v, { count: 22, speed: 6.5, color: this.crackColor.getHex() });
    hazBurst(this.ctx, 'dust', _v, { count: 12, speed: 3.0, spread: Math.max(this.size.x, this.size.z) * 0.5 });
    hazShake(this.ctx, 0.22, 160);
    if (this._paid) return;
    this._paid = true;
    if (this.drop === 'coins') {
      _v2.copy(this.center); _v2.y += this.size.y * 0.25;
      hazDropCoins(this.ctx, _v2, this.dropCount);
    } else if (this.drop === 'crest') {
      hazStinger(this.ctx, 'unlock');
      hazTrigger(this.ctx, this.triggerId, { kind: 'breakable', p: [this.center.x, this.center.y, this.center.z], player: !!player });
    } else {
      hazTrigger(this.ctx, this.triggerId, { kind: 'breakable', p: [this.center.x, this.center.y, this.center.z] });
    }
  }

  update(t) {
    this.time = t;
    const intact = this.intactAt(t);

    this.body.visible = intact;
    this.bandMesh.visible = intact;
    this.crackMesh.visible = intact;
    this.coreGlow.visible = intact;
    this.collider.active = this.enabled && intact;

    if (intact) {
      // Breathe the crack glow so the crate advertises itself from across the room, and pop it
      // brighter for a moment right after a respawn so the reform reads.
      const reform = (this.breakT !== null && this.respawn > 0)
        ? clamp(1 - (t - this.breakT - this.respawn) / 0.5, 0, 1) : 0;
      const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + this.center.x * 0.7);
      this.crackMat.opacity = 0.28 + 0.22 * pulse + reform * 0.6;
      this.coreGlow.material.opacity = 0.07 + 0.06 * pulse + reform * 0.35;
      if (this.shardMesh.visible) this.shardMesh.visible = false;
      return;
    }

    // --- shard cloud: pure in (t - breakT) -------------------------------------------------
    const age = t - this.breakT;
    this.shardMesh.visible = true;
    for (let i = 0; i < this.shardCount; i++) {
      const sh = this.shards[i];
      const u = clamp(age / sh.life, 0, 1);
      if (u >= 1) { _m.makeScale(0, 0, 0); this.shardMesh.setMatrixAt(i, _m); continue; }
      // ballistic under the fall gravity, so the debris obeys the same world the hero does
      const fly = sh.speed * age;
      const drop = 0.5 * TUNE.gravFall * age * age;
      _v.set(
        this.center.x + sh.ox + sh.dx * fly,
        this.center.y + sh.oy + sh.dy * fly - drop,
        this.center.z + sh.oz + sh.dz * fly,
      );
      _q.setFromAxisAngle(UPV, age * sh.spinA);
      _q2.setFromAxisAngle(_v2.set(sh.dz, 0, -sh.dx).normalize(), age * sh.spinB);
      _q.multiply(_q2);
      const sc = sh.scale * (1 - smoothstep(0.55, 1, u));
      _s.setScalar(Math.max(0.0001, sc));
      _m.compose(_v, _q, _s);
      this.shardMesh.setMatrixAt(i, _m);
    }
    this.shardMesh.instanceMatrix.needsUpdate = true;
  }

  reset(t) {
    this.breakT = null;
    this._paid = false;
    this.shardMesh.visible = false;
    super.reset(t);
    // A cage its trigger already opened must NOT reform on a checkpoint reset — the crest
    // it was holding is already out in the world, and a re-solidified cage would swallow it.
    if (this._openFired) { this.breakT = t; this._paid = true; }
  }

  dispose() {
    if (this._onTrigger && this.ctx && this.ctx.events && typeof this.ctx.events.off === 'function') {
      try { this.ctx.events.off('trigger', this._onTrigger); } catch (e) { /* noop */ }
    }
    this._onTrigger = null;
    super.dispose();
  }
}

/**
 * A crate the ground pound shatters.
 * `{kind:'breakable', p, s, mat?:'wood'|'stone'|…, rot?:[rx,ry,rz] RADIANS,
 *   drop?:'coins'|'crest'|'none', dropCount?:int, trigger?:string, respawn?:SECONDS}`
 *
 * `props.breakable = true` on the collider is the flag §10 reports. `drop:'crest'` fires the
 * named `trigger` so a `secret` crest (§22) can spawn on it; `respawn: 0` (default) leaves the
 * crate broken until the next checkpoint reset.
 */
export function breakable(def, ctx) { return new BreakableHazard(def, ctx); }

/* ======================================================================================
   SINKER
   ====================================================================================== */

class SinkerHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'sinker');
    const pal = palette(ctx);

    this.center = v3(def.p, 0, 0, 0);
    this.size = sizeVec(def.s, 4, 0.5, 4);
    this.matKey = typeof def.mat === 'string' ? def.mat : 'wood';
    this.delay = Math.max(0, num(def.delay, 0.45));       // SECONDS of standing before it gives
    this.speed = Math.max(0.2, num(def.speed, 2.2));      // m/s down
    this.riseSpeed = Math.max(0.2, num(def.rise, this.speed * 1.35));
    this.depthMax = Math.max(0.4, num(def.depth, 6));     // metres it can sink before it stops

    this.safeColor = new THREE.Color(pal.safeEdge !== undefined ? pal.safeEdge : 0x7ef0ff);
    this.warnColor = new THREE.Color(pal.kill !== undefined ? pal.kill : 0xff5a3c);

    /** Metres below the rest pose. Rider-driven state (see the file header). */
    this.depth = 0;
    /** Course-clock time the current stand began, or null. */
    this.standT = null;
    this._riding = false;
    this._lastRipple = -99;

    this.linVel = new THREE.Vector3();
    this.angVel = 0;
    this.angAxis = UPV.clone();
    this.angCenter = this.center.clone();

    this._buildDeck();
    this._buildCollider();
    this.reset(0);
  }

  _buildDeck() {
    const w = this.size.x, h = this.size.y, d = this.size.z;
    this.group = new THREE.Group();
    this.group.position.copy(this.center);
    this.add(this.group);

    const parts = [];
    const bands = [];
    const studs = [];
    const plankT = clamp(h * 0.9, 0.06, 0.3);
    const nPlank = Math.max(3, Math.round(w / 0.5));

    // A raft of real planks with a visible gap between them — the gaps are what make the
    // shiver read at distance.
    for (let i = 0; i < nPlank; i++) {
      const u = (i + 0.5) / nPlank - 0.5;
      parts.push(slab(w / nPlank * 0.9, plankT, d * 0.98, u * w, 0, 0, 0.014));
    }
    // cross beams underneath
    for (const s of [1, -1]) {
      parts.push(slab(w * 1.01, plankT * 0.7, d * 0.14, 0, -plankT * 0.75, s * d * 0.32, 0.014));
    }
    // iron banding + corner brackets
    const bandT = plankT * 0.4;
    for (const s of [1, -1]) {
      bands.push(slab(w * 1.02, bandT, bandT, 0, h * 0.5 - bandT * 0.5, s * (d * 0.5 - bandT * 0.5), 0.006, 0.4));
      bands.push(slab(bandT, bandT, d * 1.02, s * (w * 0.5 - bandT * 0.5), h * 0.5 - bandT * 0.5, 0, 0.006, 0.4));
    }
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
      bands.push(slab(w * 0.12, plankT * 1.25, d * 0.12, sx * (w * 0.5 - w * 0.06), 0, sz * (d * 0.5 - d * 0.06), 0.012));
    }
    // corner warning studs — the telegraph (safe cyan -> hard amber -> red as it drops)
    for (let i = 0; i < 4; i++) {
      const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? 1 : -1;
      const g = new THREE.CylinderGeometry(w * 0.035, w * 0.045, h * 0.42, 10);
      g.translate(sx * (w * 0.5 - w * 0.11), h * 0.5 + h * 0.10, sz * (d * 0.5 - d * 0.11));
      studs.push(g);
    }
    // CONTRACT hard rule 2: a landable face carries a leading-edge stripe.
    const stripes = [];
    const st = clamp(Math.min(w, d) * 0.02, 0.03, 0.09);
    for (const s of [1, -1]) {
      stripes.push(slab(w * 0.96, 0.035, st, 0, h * 0.5 + 0.012, s * (d * 0.5 - st * 0.6), 0.008, 0.4));
      stripes.push(slab(st, 0.035, d * 0.96, s * (w * 0.5 - st * 0.6), h * 0.5 + 0.012, 0, 0.008, 0.4));
    }

    this.deck = new THREE.Mesh(mergeAll(parts), hazMat(this.ctx, this.matKey));
    this.deck.castShadow = true;
    this.deck.receiveShadow = true;
    this.group.add(this.deck);

    this.bandMesh = new THREE.Mesh(mergeAll(bands), hazMat(this.ctx, 'metal'));
    this.bandMesh.castShadow = true;
    this.bandMesh.receiveShadow = true;
    this.group.add(this.bandMesh);

    this.studMat = new THREE.MeshStandardMaterial({
      color: 0x0a0d12, emissive: this.safeColor.clone(), emissiveIntensity: 1.8,
      roughness: 0.35, metalness: 0.25,
    });
    this.own(this.studMat);
    this.studMesh = new THREE.Mesh(mergeAll(studs), this.studMat);
    this.group.add(this.studMesh);

    this.stripeMat = additiveMaterial(this.safeColor.getHex(), { cached: false, opacity: 0.7 });
    this.own(this.stripeMat);
    this.stripeMesh = new THREE.Mesh(mergeAll(stripes), this.stripeMat);
    this.stripeMesh.renderOrder = 5;
    this.group.add(this.stripeMesh);

    // A dust/spray ring parked at the REST height: as the deck drops away from it, the ring
    // marks the line the deck used to be at, which is what makes the drop legible from above.
    const ringGeo = new THREE.RingGeometry(Math.min(w, d) * 0.42, Math.min(w, d) * 0.62, 30, 1);
    ringGeo.rotateX(-Math.PI * 0.5);
    this.ringMat = additiveMaterial(this.warnColor.getHex(), { cached: false, opacity: 0, side: THREE.DoubleSide });
    this.own(this.ringMat);
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.renderOrder = 6;
    this.ring.position.copy(this.center);
    this.ring.position.y += this.size.y * 0.5 + 0.02;
    this.add(this.ring);
  }

  _buildCollider() {
    this.collider = makeCollider({
      center: this.center,
      half: _v.copy(this.size).multiplyScalar(0.5),
      surface: this.matKey === 'wood' ? 'wood' : 'normal',
      ref: this,
      group: 'hazard',
      props: { stepSfx: this.matKey === 'wood' ? 'step_wood' : 'step_stone', stepRate: 1.0, sinker: true },
    });
    this.colliders.push(this.collider);
  }

  /** CONTRACT §21: the Course fires this on the stand transition. */
  onStand() {
    if (this.standT === null) this.standT = this.time;
    this._riding = true;
  }

  /** A pound is a stand with attitude: it skips the delay entirely. */
  onPound() {
    this.standT = this.time - this.delay;
    this._riding = true;
    if (!this._silent) {
      _v.copy(this.center); _v.y += this.size.y * 0.5 - this.depth;
      hazBurst(this.ctx, 'poundShock', _v, { count: 14, speed: 5 });
    }
  }

  update(t, dt, player) {
    const step = clamp(num(dt, 0), 0, 0.1);
    this.time = t;
    if (player) this.__player = player;

    // --- rider detection --------------------------------------------------------------------
    // onStand() is the contract path; the self-detect keeps the hazard alive in a harness or a
    // host that does not fire stand transitions, and is what clears `standT` when you leave.
    const riding = !!standingOn(resolvePlayer(this.ctx, player || this.__player), this.colliders, 0.24);
    if (riding && this.standT === null) this.standT = t;
    if (!riding && !this._riding) this.standT = null;
    this._riding = false;                 // consumed; onStand() re-arms it next frame

    const armed = this.standT !== null && (t - this.standT) >= this.delay;
    const prevDepth = this.depth;

    if (armed) this.depth = Math.min(this.depthMax, this.depth + this.speed * step);
    else this.depth = Math.max(0, this.depth - this.riseSpeed * step);

    const dy = this.depth - prevDepth;
    this.linVel.set(0, step > 1e-6 ? -dy / step : 0, 0);
    this.angCenter.copy(this.center);
    this.angCenter.y -= this.depth;

    // --- placement -----------------------------------------------------------------------------
    this.group.position.set(this.center.x, this.center.y - this.depth, this.center.z);

    // Pre-drop shiver: the deck trembles through the delay window so the give is ANNOUNCED.
    const warmup = this.standT === null ? 0 : clamp((t - this.standT) / Math.max(0.001, this.delay), 0, 1);
    if (this.standT !== null && !armed) {
      const k = warmup * warmup;
      this.group.position.x += Math.sin(t * 46.3) * 0.021 * k;
      this.group.position.z += Math.cos(t * 41.7) * 0.021 * k;
      this.group.position.y += Math.sin(t * 57.1) * 0.014 * k;
    }

    _v.set(this.center.x, this.center.y - this.depth, this.center.z);
    _v2.copy(this.size).multiplyScalar(0.5);
    setColliderBox(this.collider, _v, _v2);
    this.collider.active = this.enabled;

    // --- readability ---------------------------------------------------------------------------
    const sunk = this.depth / this.depthMax;
    const heat = Math.max(warmup * (armed ? 1 : 0.85), sunk);
    this.studMat.emissive.copy(this.safeColor).lerp(this.warnColor, clamp(heat * 1.25, 0, 1));
    const strobe = 0.5 + 0.5 * Math.sin(t * (3 + heat * 26));
    this.studMat.emissiveIntensity = 1.4 + heat * (1.6 + strobe * 5.0);
    this.stripeMat.opacity = 0.42 + 0.28 * (0.5 + 0.5 * Math.sin(t * 2.0)) - heat * 0.20;
    this.ringMat.opacity = clamp(sunk * 0.55 + (armed ? 0.12 : 0), 0, 0.7);
    this.ring.scale.setScalar(1 + sunk * 0.35);

    // --- one-shots -------------------------------------------------------------------------------
    if (this._silent) return;
    if (this.edge(this, '_lastArm', armed ? 1 : 0) && armed) {
      _v.set(this.center.x, this.center.y + this.size.y * 0.5, this.center.z);
      hazSfx(this.ctx, 'vanish_warn', { gain: 0.6, rate: 0.62, pos: _v, ref: 9, max: 40 });
      hazBurst(this.ctx, 'dust', _v, { count: 14, speed: 2.4, spread: Math.max(this.size.x, this.size.z) * 0.5 });
    }
    // A creak every half metre of travel — the ear tracks the drop even when the eye is ahead.
    if (armed && this.depth > 0.05 && (this.depth - this._lastRipple) > 0.5) {
      this._lastRipple = this.depth;
      _v.set(this.center.x, this.center.y - this.depth + this.size.y * 0.5, this.center.z);
      hazSfx(this.ctx, 'step_wood', { gain: 0.42, rate: 0.55 - sunk * 0.12, pos: _v, ref: 8, max: 34 });
    }
  }

  reset(t) {
    this.depth = 0;
    this.standT = null;
    this._riding = false;
    this._lastRipple = -99;
    this.linVel.set(0, 0, 0);
    super.reset(t);
  }

  velocityAtPoint(p, out) { return out.copy(this.linVel); }
}

/**
 * A platform that sinks under your weight.
 * `{kind:'sinker', p, s, delay?:SECONDS, speed?:m/s, rise?:m/s, depth?:METRES, mat?}`
 * Sinks after `delay` seconds of being stood on, at `speed`, to at most `depth` metres below
 * its rest pose; rises at `rise` (default 1.35 x speed) the moment you step off. A ground pound
 * skips the delay. `reset(t)` returns it to the rest pose.
 */
export function sinker(def, ctx) { return new SinkerHazard(def, ctx); }

/* ======================================================================================
   SEESAW
   ====================================================================================== */

class SeesawHazard extends Hazard {
  constructor(def, ctx) {
    super(def, ctx, 'seesaw');
    const pal = palette(ctx);

    this.center = v3(def.p, 0, 0, 0);          // the PIVOT (the top of the fulcrum)
    this.size = sizeVec(def.s, 8, 0.45, 2.6);
    this.matKey = typeof def.mat === 'string' ? def.mat : 'wood';

    // `axis` is the TILT AXIS: the plank rocks about it. Default 'z', so the plank runs along X.
    this.axis = dirVec(def.axis, 0, 0, 1);
    // The plank's long direction is perpendicular to the axis, in the ground plane. It MUST be
    // `up x axis`, not `axis x up`: only that order makes (long, up, axis) right-handed
    // (long x up == axis), and `Quaternion.setFromRotationMatrix` on a left-handed basis
    // produces a mirrored orientation — the plank would tip AWAY from the rider.
    this.long = new THREE.Vector3().crossVectors(UPV, this.axis);
    if (this.long.lengthSq() < 1e-8) this.long.set(1, 0, 0);
    this.long.normalize();
    this.halfLen = Math.max(0.6, this.size.x * 0.5);

    this.maxTilt = clamp(
      def.maxDeg !== undefined ? num(def.maxDeg, 22) * Math.PI / 180 : num(def.maxTilt, 0.38),
      0.05, 0.9,
    );
    /** Spring rate toward the rider-implied angle (and back to level). Higher = stiffer. */
    this.spring = clamp(num(def.spring, 5.0), 0.6, 22);

    this.safeColor = new THREE.Color(pal.safeEdge !== undefined ? pal.safeEdge : 0x7ef0ff);
    this.accent = new THREE.Color(pal.accent !== undefined ? pal.accent : 0x5ec8ff);

    /** Current tilt in radians, positive = the +long end goes DOWN. Rider-driven state. */
    this.angle = 0;
    this._prevAngle = 0;

    this.linVel = new THREE.Vector3();
    this.angVel = 0;
    this.angAxis = this.axis.clone();
    this.angCenter = this.center.clone();

    // Plank-local frame: X = long, Y = up, Z = axis — right-handed because long == up x axis.
    _m.makeBasis(this.long, UPV, this.axis.clone().normalize());
    this.baseQuat = new THREE.Quaternion().setFromRotationMatrix(_m);

    this._buildFulcrum();
    this._buildPlank();
    this._buildCollider();
    this.reset(0);
  }

  _buildFulcrum() {
    const w = this.size.z, h = this.size.y;
    const parts = [];
    const fh = Math.max(0.5, this.halfLen * Math.sin(this.maxTilt) + h);
    // A real wedge, not a box: two triangular cheeks joined by a cross member, plus the pin.
    const shape = new THREE.Shape();
    shape.moveTo(-fh * 0.75, -fh);
    shape.lineTo(fh * 0.75, -fh);
    shape.lineTo(fh * 0.18, 0);
    shape.lineTo(-fh * 0.18, 0);
    shape.closePath();
    for (const s of [1, -1]) {
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: w * 0.16, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03,
        bevelSegments: 1, curveSegments: 1, steps: 1,
      });
      g.rotateY(Math.PI * 0.5);
      g.translate(s * (w * 0.30), 0, 0);
      parts.push(g);
    }
    // cross member tying the two cheeks together, and a footing plate
    parts.push(slab(fh * 0.30, fh * 0.16, w * 0.62, 0, -fh * 0.42, 0, 0.02));
    parts.push(slab(fh * 1.5, 0.16, w * 0.9, 0, -fh + 0.08, 0, 0.03));

    const pin = new THREE.CylinderGeometry(h * 0.42, h * 0.42, w * 0.92, 14);
    pin.rotateX(Math.PI * 0.5);
    parts.push(pin);
    for (const s of [1, -1]) {
      const collar = new THREE.TorusGeometry(h * 0.52, h * 0.16, 6, 14);
      collar.translate(0, 0, s * w * 0.40);
      parts.push(collar);
    }

    const geo = mergeAll(parts);
    // Rotate the whole fulcrum so its local Z is the tilt axis.
    this.fulcrum = new THREE.Mesh(geo, hazMat(this.ctx, 'stone'));
    this.fulcrum.castShadow = true;
    this.fulcrum.receiveShadow = true;
    this.fulcrum.position.copy(this.center);
    this.fulcrum.quaternion.copy(this.baseQuat);
    this.add(this.fulcrum);
  }

  _buildPlank() {
    const L = this.halfLen * 2, h = this.size.y, w = this.size.z;
    this.plankGroup = new THREE.Group();
    this.plankGroup.position.copy(this.center);
    this.add(this.plankGroup);

    const parts = [];
    const bands = [];
    const stripes = [];
    const plankT = h;
    const nPlank = Math.max(2, Math.round(w / 0.45));
    for (let i = 0; i < nPlank; i++) {
      const u = (i + 0.5) / nPlank - 0.5;
      parts.push(slab(L * 0.995, plankT, w / nPlank * 0.92, 0, 0, u * w, 0.016));
    }
    // spine beam underneath + end bumpers
    parts.push(slab(L * 0.99, plankT * 0.7, w * 0.22, 0, -plankT * 0.72, 0, 0.016));
    for (const s of [1, -1]) {
      parts.push(slab(L * 0.05, plankT * 1.5, w * 0.99, s * (L * 0.5 - L * 0.025), plankT * 0.2, 0, 0.02));
      // iron shoe on each end — the bit that clangs on the ground
      bands.push(slab(L * 0.055, plankT * 0.4, w * 1.01, s * (L * 0.5 - L * 0.03), -plankT * 0.62, 0, 0.012));
    }
    // banding over the pivot + rider grip ribs
    bands.push(slab(L * 0.10, plankT * 1.14, w * 1.02, 0, 0, 0, 0.018));
    for (let i = -3; i <= 3; i++) {
      if (i === 0) continue;
      bands.push(slab(L * 0.012, plankT * 0.22, w * 0.9, i * L * 0.12, plankT * 0.55, 0, 0.006, 0.4));
    }
    // leading-edge stripes down both long sides (CONTRACT hard rule 2)
    const st = clamp(w * 0.045, 0.03, 0.09);
    for (const s of [1, -1]) {
      stripes.push(slab(L * 0.97, 0.035, st, 0, plankT * 0.5 + 0.012, s * (w * 0.5 - st * 0.6), 0.008, 0.4));
    }
    // end markers so you can read WHICH way it will drop before you commit
    for (const s of [1, -1]) {
      stripes.push(slab(L * 0.035, 0.035, w * 0.92, s * (L * 0.5 - L * 0.04), plankT * 0.5 + 0.012, 0, 0.008, 0.4));
    }

    this.plank = new THREE.Mesh(mergeAll(parts), hazMat(this.ctx, this.matKey));
    this.plank.castShadow = true;
    this.plank.receiveShadow = true;
    this.plankGroup.add(this.plank);

    this.bandMesh = new THREE.Mesh(mergeAll(bands), hazMat(this.ctx, 'metal'));
    this.bandMesh.castShadow = true;
    this.bandMesh.receiveShadow = true;
    this.plankGroup.add(this.bandMesh);

    this.stripeMat = additiveMaterial(this.safeColor.getHex(), { cached: false, opacity: 0.7 });
    this.own(this.stripeMat);
    this.stripeMesh = new THREE.Mesh(mergeAll(stripes), this.stripeMat);
    this.stripeMesh.renderOrder = 5;
    this.plankGroup.add(this.stripeMesh);
  }

  _buildCollider() {
    this.collider = makeCollider({
      center: this.center,
      half: _v.set(this.halfLen, this.size.y * 0.5, this.size.z * 0.5),
      quat: this.baseQuat,
      surface: this.matKey === 'wood' ? 'wood' : 'normal',
      ref: this,
      group: 'hazard',
      props: { stepSfx: this.matKey === 'wood' ? 'step_wood' : 'step_stone', stepRate: 1.0, seesaw: true },
    });
    this.colliders.push(this.collider);
  }

  /**
   * The tilt the current rider position implies. Deterministic from the rider offset alone:
   * feed it the same offset and you get the same angle, every frame, every run.
   * @returns {number} radians, positive = the +long end drops
   */
  targetAngleFor(riderPos) {
    if (!riderPos) return 0;
    _v.subVectors(riderPos, this.center);
    const u = clamp(_v.dot(this.long) / this.halfLen, -1, 1);
    // Squared response: standing near the pivot barely moves it, walking to the end commits.
    return this.maxTilt * Math.sign(u) * Math.min(1, u * u * 1.35);
  }

  update(t, dt, player) {
    const step = clamp(num(dt, 0), 0, 0.1);
    this.time = t;
    if (player) this.__player = player;

    const pl = resolvePlayer(this.ctx, player || this.__player);
    const riding = standingOn(pl, this.colliders, 0.26) ? pl : null;
    const target = riding ? this.targetAngleFor(riding.pos) : 0;

    // Critically-damped approach: `damp` is exp(-lambda*dt), so the rate is frame-rate
    // independent and reset(t) at dt = 0 lands exactly on the target.
    this._prevAngle = this.angle;
    this.angle = step > 0 ? damp(this.angle, target, this.spring, step) : target;
    this.angVel = step > 1e-6 ? (this.angle - this._prevAngle) / step : 0;
    this.angAxis.copy(this.axis);
    this.angCenter.copy(this.center);
    this.linVel.set(0, 0, 0);

    // --- placement ------------------------------------------------------------------------
    // Positive angle drops the +long end, so the rotation about `axis` is -angle when
    // (long, up, axis) is a right-handed basis.
    _q.setFromAxisAngle(this.axis, -this.angle);
    this.plankGroup.quaternion.copy(_q).multiply(this.baseQuat);

    _q2.copy(_q).multiply(this.baseQuat);
    _v.copy(this.center);
    _v2.set(this.halfLen, this.size.y * 0.5, this.size.z * 0.5);
    setColliderBox(this.collider, _v, _v2, _q2);
    this.collider.active = this.enabled;

    // --- readability -----------------------------------------------------------------------
    const lean = Math.abs(this.angle) / this.maxTilt;
    this.stripeMat.opacity = 0.40 + 0.26 * (0.5 + 0.5 * Math.sin(t * 2.1)) + lean * 0.24;

    // --- one-shots ---------------------------------------------------------------------------
    if (this._silent) return;
    // Clang when an end bottoms out, once per bottoming.
    const bottomed = lean > 0.96 ? Math.sign(this.angle) : 0;
    if (this.edge(this, '_lastBottom', bottomed) && bottomed !== 0) {
      _v.copy(this.center).addScaledVector(this.long, bottomed * this.halfLen);
      _v.y -= this.halfLen * Math.sin(this.maxTilt);
      hazSfx(this.ctx, 'crusher_slam', { gain: 0.42, rate: 1.35, pos: _v, ref: 8, max: 34 });
      hazBurst(this.ctx, 'dust', _v, { count: 10, speed: 2.6, spread: this.size.z * 0.5 });
      hazShake(this.ctx, 0.12, 120);
    }
    // Timber creak whenever it is genuinely swinging.
    if (Math.abs(this.angVel) > 0.35 && t - (this._lastCreak || -9) > 0.32) {
      this._lastCreak = t;
      hazSfx(this.ctx, 'step_wood', {
        gain: clamp(0.14 + Math.abs(this.angVel) * 0.18, 0.1, 0.5),
        rate: 0.5 + lean * 0.25, pos: this.center, ref: 8, max: 30,
      });
    }
  }

  /** A pound on one end slams it all the way down — the moveset as a lever. */
  onPound(player) {
    const pl = resolvePlayer(this.ctx, player || this.__player);
    if (!pl || !pl.pos) return;
    this.angle = this.targetAngleFor(pl.pos);
    _v.subVectors(pl.pos, this.center);
    const u = clamp(_v.dot(this.long) / this.halfLen, -1, 1);
    if (Math.abs(u) > 0.35) this.angle = this.maxTilt * Math.sign(u);
  }

  onStand() {}

  reset(t) {
    this.angle = 0;
    this._prevAngle = 0;
    this.angVel = 0;
    this._lastCreak = -9;
    super.reset(t);
  }

  velocityAtPoint(p, out) {
    out.copy(this.linVel);
    _v.subVectors(p, this.angCenter);
    // The plank rotates by -angle about `axis`, so its angular velocity is -angVel * axis.
    _v2.crossVectors(this.angAxis, _v).multiplyScalar(-this.angVel);
    return out.add(_v2);
  }
}

/**
 * A plank on a fulcrum that tilts by where you stand.
 * `{kind:'seesaw', p:[PIVOT], s:[length, thickness, width], axis?:'z'|[x,y,z],
 *   maxDeg?:DEGREES (default 22), spring?:RATE (default 5), mat?}`
 *
 * `p` is the PIVOT, not the deck centre. `axis` is the TILT AXIS — the plank runs perpendicular
 * to it in the ground plane, and `s.x` is its full length. The tilt is a pure function of the
 * rider's offset along the plank (squared response, so the pivot is a safe place to stand),
 * damped toward that target at `spring`; with no rider the target is level. `reset(t)` returns
 * it to level.
 */
export function seesaw(def, ctx) { return new SeesawHazard(def, ctx); }
