/**
 * CRESTBOUND — runtime/entities/bosses.js
 * ---------------------------------------------------------------------------
 * THE FOUR REALM BOSSES (stage 1, creatures lane). The Warden stays in the
 * registry as the mini-boss it always was; each realm now has its own boss
 * with its own fight, and each one TALKS (a name card on the intro, a line on
 * every hit, a line on every phase change, a line on defeat).
 *
 *   bramblehide  VERDANT  BRAMBLEHIDE, THE ROOT TYRANT     pound-the-tail fight
 *   slagmaw      EMBER    SLAGMAW, THE CRUCIBLE GLUTTON    send-it-back fight (pound / throw its own slag)
 *   hoarhorn     RIME     HOARHORN, LORD OF THE FLOE       ice-sumo fight (push it off its own floe)
 *   gyrarch      AZURE    GYRARCH, THE CLOCKWORK SUN       ride-the-platform fight (reach its crown)
 *
 * Every boss: an INTRO beat (it wakes when you enter its arena: a scripted
 * entrance, a roar, the name card and a line — invulnerable while it plays),
 * readable TELEGRAPHS (a pose + a glow + a ground marker or aim beam, always
 * ≥ 0.7 s), THREE PHASES (hp 3 -> 2 -> 1; each phase adds an attack or speeds
 * one up), an in-world HP readout (three crest gems over its head) and a
 * DEFEAT animation that ends by firing the `boss` trigger, which is what
 * spawns the course's boss crest (collectibles.js trigger: 'warden-down' |
 * 'boss'). A course places one as `{kind:'bramblehide', p, arena:{c:[x,z], r}}`.
 *
 * Fairness is the Warden's: knockback, never death, and near the arena rim a
 * shove is bent back inward (`_hurt` below) so a boss can corner you but never
 * post you off its own hill. Determinism: a boss reads the player; everything
 * else is its own integrated state, restored exactly by `reset()`.
 *
 * INTEGRATION NOTE (game.js, not this lane): `_findWarden` matches kind
 * 'warden' only, so the HUD hp bar and the 'boss' music mood do not see these
 * yet. Every boss exposes `isBoss`, `hp`, `hpMax`, `engaged` and `hud`, the
 * fields the Warden path reads — one `|| c.isBoss` there lights them up.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, damp, dampAngle, smoothstep, easeOutBack, TAU, wrapAngle } from '../core/util.js';
import { TUNE } from '../core/tuning.js';
import { prismGeometry, tubeGeometry, ringProfileGeometry, discGeometry, bevelBoxGeometry, getEmissive, getGlow } from '../world/builders.js';
import { Collider } from '../world/collider.js';

export const BOSS_INFO = Object.freeze({
  bramblehide: {
    realm: 'verdant', name: 'BRAMBLEHIDE', title: 'THE ROOT TYRANT', arenaR: 11, emoteY: 3.6, defeatT: 3.4,
    notice: 12, coins: 0, respawn: 0,
    lines: {
      intro: 'WHO TRAMPLES MY MEADOW? STAND STILL, I WILL ROOT YOU TO THE SPOT.',
      hurt1: 'MY TAIL! YOU STAMPED ON MY TAIL!',
      phase2: 'THORNS, THEN. A WHOLE HEDGE OF THEM.',
      hurt2: 'GRRR... THE BUD IS TENDER, LITTLE PEST!',
      phase3: 'TWICE! I WILL STRIKE TWICE!',
      defeat: '...THE MEADOW... IT WAS ALWAYS YOURS...',
    },
  },
  slagmaw: {
    realm: 'ember', name: 'SLAGMAW', title: 'THE CRUCIBLE GLUTTON', arenaR: 11, emoteY: 4.2, defeatT: 3.4,
    notice: 12, coins: 0, respawn: 0,
    lines: {
      intro: 'FRESH ORE! HOLD STILL, LITTLE NUGGET, AND INTO THE CRUCIBLE WITH YOU.',
      hurt1: 'HOT! HOT! THAT WAS MY OWN SLAG!',
      phase2: 'THEN I POUR TWO AT ONCE!',
      hurt2: 'GAAH! STOP SENDING BACK MY GIFTS!',
      phase3: 'THE WHOLE FOUNDRY BURNS FOR THIS!',
      defeat: '...THE FIRE... GOES OUT... AT LAST...',
    },
  },
  hoarhorn: {
    realm: 'rime', name: 'HOARHORN', title: 'LORD OF THE FLOE', arenaR: 8, emoteY: 3.6, defeatT: 3.2,
    notice: 12, coins: 0, respawn: 0,
    lines: {
      intro: 'OFF MY FLOE, SPRAT. NOBODY STANDS ON MY ICE.',
      hurt1: 'BLUB! COLD! THAT WATER IS COLD!',
      phase2: 'FEEL THE FROST OF MY BREATH!',
      hurt2: 'AGAIN?! MY WHISKERS ARE ICICLES!',
      phase3: 'NO MORE GAMES. I CHARGE TWICE!',
      defeat: 'BRRR... ALL RIGHT. ALL RIGHT. THE FLOE IS YOURS.',
    },
  },
  gyrarch: {
    realm: 'azure', name: 'GYRARCH', title: 'THE CLOCKWORK SUN', arenaR: 11, emoteY: 3.0, defeatT: 4.0,
    notice: 12, coins: 0, respawn: 0,
    lines: {
      intro: 'TICK. TOCK. YOUR TIME IN MY SANCTUM HAS RUN OUT.',
      hurt1: 'A GEAR SLIPPED?! IMPOSSIBLE!',
      phase2: 'THEN I WIND MYSELF FASTER.',
      hurt2: 'YOU KEEP RIDING MY OWN MACHINERY!',
      phase3: 'FULL SPRING! EVERY COG, TURN!',
      defeat: '...THE... HOUR... IS... YOURS...',
    },
  },
});

/* scratch */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _m = new THREE.Matrix4();
const UPV = new THREE.Vector3(0, 1, 0);
const ZV = new THREE.Vector3(0, 0, 1);

/* The hero lane's carry registry (player/carry.js). Loaded dynamically so this
   module never fails to link if that file is absent; Slagmaw's bombs register
   when it resolves. */
let CARRY = null;
const CARRY_READY = import('../player/carry.js')
  .then((m) => { CARRY = (m && typeof m.registerCarryable === 'function') ? m : null; return CARRY; })
  .catch(() => null);

const SHOVE_KEEP = 2.5;      // rim band where a boss shove may not push outward (the Warden's rule)
const SLEEP_SLACK = 4.0;
const HURT_T = 1.3, ENRAGE_T = 1.5;

/**
 * @param {object} K  the kit from critters.js plus the roster: { Creature, ShotSet, MarkerSet, StarRing, helpers, ... }
 */
export function defineBosses(K) {
  const {
    Creature, ShotSet, MarkerSet, fin, readV3, capsuleOf, capsuleHitsSphere, skinMat, worldMat,
    sphereGeo, capsuleGeo, coneGeo, bbox, place, mergeParts, makeEyes, cached, normalizeAttrs,
  } = K;
  const { ell, spike, limbZ, limbY, pivot, glowMat, headingFrom } = K.helpers;

  /* -------------------------------------------------------------- HP gems */
  const PIP_N = 3;
  function pipGeo() {
    return cached('bs:pip', () => {
      const top = normalizeAttrs(tubeGeometry(0, 0.16, 0.2, 4, 1)); top.translate(0, 0.1, 0);
      const bot = normalizeAttrs(tubeGeometry(0.16, 0, 0.26, 4, 1)); bot.translate(0, -0.13, 0);
      const g = mergeGeometries([top, bot], false);
      top.dispose(); bot.dispose();
      g.computeBoundingSphere();
      return g;
    });
  }

  /* =========================================================================
   * Boss — the shared base
   * ====================================================================== */

  class Boss extends Creature {
    constructor(def, ctx, kind) {
      super(def, ctx, kind, BOSS_INFO[kind]);
      const d = this.def;
      this.isBoss = true;
      this.isEnemy = false;
      this.hpMax = Math.max(1, Math.round(fin(d.hp, 3)));
      this.hp = this.hpMax;
      this.phase = 1;
      this.engaged = false;
      this.title = String(d.title || this.info.title || '');
      this.lines = Object.assign({}, this.info.lines, d.lines || null);
      const ar = d.arena || {};
      this.arenaC = new THREE.Vector3();
      if (Array.isArray(ar.c) && ar.c.length === 2) this.arenaC.set(fin(ar.c[0], this.home.x), 0, fin(ar.c[1], this.home.z));
      else if (ar.c) readV3(ar.c, this.arenaC);
      else this.arenaC.copy(this.home);
      this.arenaR = Math.max(5, fin(ar.r, this.info.arenaR || 10));
      this.arenaC.y = this.groundY;
      this.startState = 'dormant';
      this.state = 'dormant';
      this.flash = 0;
      this.flashMats = [];
      this._flashApplied = false;
      this.awayT = 0;
      this.hits = 0;
      this.introduced = false;
      this.hud = { type: kind, name: this.displayName, hp: this.hp, hpMax: this.hpMax, phase: 'dormant' };
      this.said = [];
    }

    /* ---- shared construction ------------------------------------------- */

    _initPips() {
      const m = new THREE.InstancedMesh(pipGeo(), getEmissive(this.realmColor, 2.4), PIP_N);
      m.name = 'hpGems';
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = false;
      m.visible = false;
      this.rig.add(m);
      this.pips = m;
      this.pipK = new Float32Array(PIP_N);
    }

    _adoptFlash(skin) { if (skin && skin.material && skin.material.emissive) this.flashMats.push(skin.material); }

    /* ---- the voice -------------------------------------------------------- */

    _say(key, big) {
      const line = this.lines[key];
      if (!line) return;
      this.said.push(key);
      this.events.emit('say', key, line, this);
      const c = this.ctx;
      try {
        if (typeof c.say === 'function') { c.say(line, this); return; }
        const hud = c.game && c.game.hud;
        if (hud && typeof hud.toast === 'function') {
          if (big) hud.toast(this.displayName + (this.title ? ' · ' + this.title : ''), line, 'warn');
          else hud.toast(this.displayName, line, 'warn');
        }
      } catch (e) { /* a missing HUD never breaks a boss */ }
    }

    /* ---- arena ------------------------------------------------------------- */

    _heroInArena(slack) {
      if (!this._alive) return false;
      const dx = this._px - this.arenaC.x, dz = this._pz - this.arenaC.z;
      const r = this.arenaR + (slack || 0);
      return dx * dx + dz * dz < r * r && this._py > this.arenaC.y - 3 && this._py < this.arenaC.y + 14;
    }

    _clampToArena(margin) {
      const dx = this.pos.x - this.arenaC.x, dz = this.pos.z - this.arenaC.z;
      const d = Math.hypot(dx, dz), r = Math.max(0.5, this.arenaR - margin);
      if (d > r) { this.pos.x = this.arenaC.x + dx / d * r; this.pos.z = this.arenaC.z + dz / d * r; }
    }

    /**
     * THE SHOVE IS BOUNDED BY THE ARENA (the Warden's rule, same numbers).
     * Near the rim the outward part of a knockback fades to zero, and a purely
     * outward shove is turned inward. Allocation-free.
     */
    _hurt(player, dx, dz, knockback, stun) {
      const pp = player && (player.pos || player.position);
      if (pp) {
        let rx = pp.x - this.arenaC.x, rz = pp.z - this.arenaC.z;
        const rd = Math.hypot(rx, rz);
        if (rd > 1e-4) {
          rx /= rd; rz /= rd;
          const out = dx * rx + dz * rz;
          if (out > 0) {
            const keep = Math.max(1.0, this.arenaR - SHOVE_KEEP);
            const k = clamp((keep - rd) / keep, 0, 1);
            dx -= rx * out * (1 - k);
            dz -= rz * out * (1 - k);
            if (dx * dx + dz * dz < 1e-4) { dx = -rx; dz = -rz; }
          }
        }
      }
      super._hurt(player, dx, dz, knockback, stun);
    }

    /* ---- the fight skeleton --------------------------------------------------- */

    _think(dt, player) {
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 3.5);
      const inA = this._heroInArena(0);
      const holdA = this._heroInArena(SLEEP_SLACK);
      switch (this.state) {
        case 'dormant':
          this._dormant(dt);
          if (inA) this._enter(this.introduced ? 'enrage' : 'intro');
          return;
        case 'intro':
          this._intro(dt);
          if (this.stateT >= this._introT()) { this.introduced = true; this.engaged = true; this._fightStart(); }
          return;
        case 'hurt':
          this._hurtAnim(dt);
          if (this.stateT >= this._hurtT()) {
            if (this.hp <= 0) this._down();
            else this._enter('enrage');
          }
          return;
        case 'enrage':
          this._enrage(dt);
          if (this.stateT >= ENRAGE_T) { this.engaged = true; this._fightStart(); }
          return;
      }
      /* an engaged boss whose challenger left the ring goes back to sleep, hp kept */
      if (!holdA) { this.awayT += dt; if (this.awayT > 3.0) { this.awayT = 0; this.engaged = false; this._rest(); this._enter('dormant'); return; } }
      else this.awayT = 0;
      this._fight(dt, player);
    }

    _introT() { return 2.6; }
    _hurtT() { return HURT_T; }

    _onEnter(s) {
      this.hud.phase = s;
      if (s === 'intro') {
        this._say('intro', true);
        this._sfx('warden_roar', this.pos, 0.75, 1);
        this._shake(0.3, 700);
        this.events.emit('intro', this);
      } else if (s === 'enrage') {
        if (this.hp < this.hpMax && this.hits > 0) this._say('phase' + this.phase);
        this._sfx('warden_roar', this.pos, 0.9 + 0.1 * this.phase, 1);
        this._shake(0.22, 500);
      } else if (s === 'hurt') {
        this._say('hurt' + this.hits);
      } else if (s === 'defeat') {
        this._say('defeat', true);
        this._sfx('warden_hit', this.pos, 0.6, 1);
        this._shake(0.4, 900);
      }
      this._onBossEnter(s);
    }

    /** One hit lands. `how` is the move that did it. Returns true if it counted. */
    _hitBoss(how) {
      if (this.state === 'dormant' || this.state === 'intro' || this.state === 'hurt' || this.state === 'enrage' ||
          this.state === 'defeat' || this.state === 'gone') return false;
      this.hp = Math.max(0, this.hp - 1);
      this.hits++;
      this.phase = Math.min(3, this.hpMax - this.hp + 1);
      this.hud.hp = this.hp;
      this.flash = 1;
      _a.set(this.pos.x, this.pos.y + this.info.emoteY * 0.6, this.pos.z);
      this._sfx('warden_hit', _a, 1.0, 1);
      this._burst('spark', _a, 0xffd27a, 1);
      this._burst('pound', _a, this.realmColor, 0.9);
      this._shake(0.35, 360);
      this.events.emit('hit', this.hp, this, how);
      this._clearAttacks();
      this._enter('hurt');
      return true;
    }

    _down() {
      this.defeated = true;
      this.engaged = false;
      this._clearAttacks();
      this._enter('defeat');
      this.events.emit('defeated', this, 'boss');
    }

    /** Overrides Creature._defeat: a boss only goes down through `_hitBoss`. */
    _defeat() { return false; }
    onStrike() { return false; }

    _onVanish() {
      this._setColliders(false);
      this._burst('death', this.pos, this.realmColor, 1);
      this._sfx('gate_open', this.pos, 0.9, 1);
      this.events.emit('bossDown', this);
      this._trigger(this.def.trigger || 'boss');
      this._afterDown();
    }

    /* ---- per-frame presentation shared by all four ------------------------- */

    _poseCommon(dt, headY) {
      // hit flash on the merged body material(s)
      if (this.flash > 0 || this._flashApplied) {
        const f = this.flash;
        for (let i = 0; i < this.flashMats.length; i++) {
          const m = this.flashMats[i];
          m.emissive.setRGB(f, f * 0.85, f * 0.6);
          m.emissiveIntensity = f * 2.2;
        }
        this._flashApplied = f > 0;
      }
      // hp gems
      const show = this.engaged || this.state === 'hurt' || this.state === 'enrage';
      const pm = this.pips;
      if (!pm) return;
      pm.visible = show;
      if (!show) return;
      const t = this.time;
      for (let i = 0; i < PIP_N; i++) {
        const alive = i < this.hp && i < this.hpMax;
        this.pipK[i] = damp(this.pipK[i], alive ? 1 : 0, 8, dt || 0.016);
        const k = this.pipK[i];
        const off = (i - (Math.min(PIP_N, this.hpMax) - 1) * 0.5) * 0.55;
        _b.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        _a.set(this.pos.x + _b.x * off, headY + 0.12 * Math.sin(t * 2.2 + i), this.pos.z + _b.z * off);
        _q.setFromAxisAngle(UPV, t * 1.6 + i);
        _s.setScalar(Math.max(0.001, k));
        _m.compose(_a, _q, _s);
        pm.setMatrixAt(i, _m);
      }
      pm.instanceMatrix.needsUpdate = true;
    }

    /* ---- hooks each boss fills --------------------------------------------- */
    _dormant(/* dt */) {}
    _intro(/* dt */) {}
    _fightStart() { this._enter('idle'); }
    _fight(/* dt, player */) {}
    _hurtAnim(/* dt */) {}
    _enrage(/* dt */) {}
    _rest() {}
    _clearAttacks() {}
    _onBossEnter(/* s */) {}
    _afterDown() {}
    _bossReset() {}

    _resetKind() {
      this.hp = this.hpMax; this.phase = 1; this.engaged = false; this.flash = 0; this.awayT = 0; this.hits = 0;
      this.introduced = false; this.said.length = 0;
      this.hud.hp = this.hp; this.hud.phase = 'dormant';
      for (let i = 0; i < this.flashMats.length; i++) { this.flashMats[i].emissive.setRGB(0, 0, 0); this.flashMats[i].emissiveIntensity = 0; }
      this._flashApplied = false;
      if (this.pipK) for (let i = 0; i < PIP_N; i++) this.pipK[i] = 1;
      this._clearAttacks();
      this._bossReset();
    }
  }

  /* =========================================================================
   * VERDANT — BRAMBLEHIDE, THE ROOT TYRANT     (pound-the-tail)
   *
   *  A moss-backed thorn lizard, five metres nose to bud. It turns its BACK on
   *  you, rears its club tail high (the glowing bud, and a pulsing ring on the
   *  ground where it will land — 1.0 s / 0.85 / 0.7 by phase) and slams it
   *  down. The bud STICKS in the turf for a moment while it tugs: POUND THE
   *  BUD. Miss the window and it yanks free with a shock ring.
   *  Phase 2 adds a THORN VOLLEY (five seeds at five marked spots).
   *  Phase 3 slams twice — the first one comes free at once, the second sticks.
   * ====================================================================== */

  const BH_TAIL_SEG = 0.62, BH_TAIL_N = 5;
  const BH_HIPS = 1.05;
  /* The slam pose: the first tail joint dips by BH_DIP and the rest of the chain
     (5 segments + club + bud = 4.34 m) lies straight, so the bud rests on the
     turf at BH_REACH behind the hips. Derived, not tuned. */
  const BH_CHAIN = BH_TAIL_SEG * BH_TAIL_N + BH_TAIL_SEG * 2;
  const BH_DIP = Math.asin((BH_HIPS - 0.05 - 0.25) / BH_CHAIN);
  const BH_REACH = 1.3 + BH_CHAIN * Math.cos(BH_DIP);
  const BH_TELE = [1.0, 0.85, 0.7], BH_STUCK = [2.6, 2.1, 1.7], BH_SPRAY_TELE = 0.85, BH_G = 16;

  class Bramblehide extends Boss {
    constructor(def, ctx) {
      super(def, ctx, 'bramblehide');
      this.naturalHeight = 2.8;
      /* strike reach (controller strikeAt pre-filter): the bud lies BH_REACH behind the hips */
      this.hitRadius = 6.6;
      this.target = new THREE.Vector3();
      this.tailPose = 0;     // 0 rest, 1 raised, 2 slammed
      this.tailK = 0;        // blend
      this.lift = 0; this.walkPh = 0; this.jaw = 0; this.bloom = 0; this.bristle = 0; this.slump = 0;
      this.slamsLeft = 1;
      this.seedT = new Float32Array(5 * 3);
      this._build();
      this._initEmote();
      this._initPips();
      this.marks = new MarkerSet(this.rig, 6, 0xffb23a);
      const thorn = cached('bh:thorn', () => {
        const g = mergeGeometries([normalizeAttrs(place(coneGeo(0.09, 0.34, 5), 0, 0, 0, Math.PI / 2, 0, 0)), normalizeAttrs(ell(0.1, 1, 1, 1, 0, 0, -0.08, 8, 6))], false);
        g.computeBoundingSphere();
        return g;
      });
      this.seeds = new ShotSet(this.rig, 5, thorn, skinMat(0xcdb88a, 0.6, 0.0), 'thornSeeds');
      this._adoptFlash(this._mergeGroup(this.body, 'bramblehide_body'));
      this.col = this._solidBox(this.pos.x, this.pos.y + 1.1, this.pos.z, 1.15, 1.0, 1.6, 'normal', null);
      this.budCol = this._solidBox(this.pos.x, this.pos.y + 0.3, this.pos.z, 0.42, 0.3, 0.42, 'normal', null);
      this.budRef = { linVel: new THREE.Vector3(), onPound: (pl, p) => this.onPound(pl, p) };
      this.budCol.ref = this.budRef;
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const hide = skinMat(fin(this.def.color, 0x5f6e3a), 0.8, 0.0);
      const under = skinMat(0xbca56c, 0.8, 0.0);
      const bark = skinMat(0x4a3825, 0.95, 0.0);
      const moss = skinMat(0x5d8f38, 0.9, 0.0);
      const thorn = skinMat(0xd9c692, 0.5, 0.0);
      const claw = skinMat(0x2a241c, 0.5, 0.0);
      const mouth = skinMat(0x6a1e1a, 0.7, 0.0);
      const petal = skinMat(0xf4a6c8, 0.6, 0.0);
      const petal2 = skinMat(0xfff2c4, 0.6, 0.0);
      const body = pivot('body', null);
      this.hips = pivot('hips', body, 0, BH_HIPS, 0);
      const parts = [
        { g: ell(1.1, 1.0, 0.7, 1.35, 0, 0, 0, 22, 14), m: hide },
        { g: ell(0.95, 0.96, 0.52, 1.22, 0, -0.22, 0.06), m: under },
        { g: place(sphereGeo(1.28, 22, 10, 0, TAU, 0, Math.PI * 0.5), 0, 0.12, -0.05, 0, 0, 0, 1.02, 0.72, 1.3), m: bark },
      ];
      for (let i = 0; i < 9; i++) {
        const a = i * 0.7 + 0.2, rr = 0.35 + (i % 3) * 0.28;
        parts.push({ g: ell(0.32, 1, 0.35, 1.1, Math.cos(a) * rr, 0.95 - rr * 0.35, Math.sin(a) * rr * 1.2 - 0.1, 10, 6), m: moss });
      }
      for (let i = 0; i < 7; i++) {
        const z = -1.1 + i * 0.36;
        const y = 0.12 + 0.93 * Math.sqrt(Math.max(0, 1 - (z / 1.66) * (z / 1.66)));
        parts.push({ g: spike(0.13, 0.42 - Math.abs(i - 3) * 0.04, 5, 0, y, z, -0.15, 0, 0), m: thorn });
        if (i % 2 === 0) {
          parts.push({ g: spike(0.09, 0.28, 5, -0.6, y - 0.28, z, 0, 0, 0.55), m: thorn });
          parts.push({ g: spike(0.09, 0.28, 5, 0.6, y - 0.28, z, 0, 0, -0.55), m: thorn });
        }
      }
      this.hips.add(mergeParts(parts, 'shell'));
      // blooms: hidden (scale 0) until the defeat, when the meadow takes the shell back
      this.blooms = pivot('blooms', this.hips, 0, 0, 0);
      const bl = [];
      for (let i = 0; i < 8; i++) {
        const a = i * 0.78 + 0.4, rr = 0.25 + (i % 4) * 0.22;
        const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr * 1.25 - 0.1;
        const cy = 0.12 + 0.95 * Math.sqrt(Math.max(0, 1 - (rr / 1.3) * (rr / 1.3))) * 0.72;
        for (let p = 0; p < 5; p++) {
          const pa = (p / 5) * TAU;
          bl.push({ g: ell(0.09, 1, 0.3, 0.55, cx + Math.cos(pa) * 0.08, cy + 0.05, cz + Math.sin(pa) * 0.08, 8, 5), m: i & 1 ? petal : petal2 });
        }
        bl.push({ g: ell(0.05, 1, 0.6, 1, cx, cy + 0.08, cz, 8, 6), m: thorn });
      }
      this.blooms.add(mergeParts(bl, 'blooms'));
      // neck + head + jaw
      this.neck = pivot('neck', this.hips, 0, 0.22, 1.3);
      this.neck.add(mergeParts([{ g: limbZ(0.42, 0.45, 0, 0, 0, -0.2, 0, 0), m: hide }, { g: limbZ(0.32, 0.4, 0, -0.14, 0.05, -0.2, 0, 0), m: under }], 'neck'));
      this.head = pivot('head', this.neck, 0, 0.2, 0.85);
      const hp = [
        { g: ell(0.5, 1.0, 0.78, 1.15, 0, 0.05, 0.05), m: hide },
        { g: place(bbox(0.72, 0.34, 0.62, 0.12), 0, -0.05, 0.55), m: hide },
        { g: ell(0.2, 1.4, 0.55, 1, -0.2, 0.34, 0.25, 10, 6), m: bark },
        { g: ell(0.2, 1.4, 0.55, 1, 0.2, 0.34, 0.25, 10, 6), m: bark },
        { g: spike(0.1, 0.5, 6, -0.28, 0.35, -0.15, -1.0, 0, 0.35), m: thorn },
        { g: spike(0.1, 0.5, 6, 0.28, 0.35, -0.15, -1.0, 0, -0.35), m: thorn },
        { g: ell(0.05, 1, 0.6, 1, -0.16, 0.02, 0.86, 8, 6), m: claw },
        { g: ell(0.05, 1, 0.6, 1, 0.16, 0.02, 0.86, 8, 6), m: claw },
      ];
      for (let i = 0; i < 7; i++) {
        const a = -1.2 + i * 0.4;
        const g = ell(0.3, 0.35, 0.05, 1, 0, 0, 0.3, 10, 6);
        place(g, 0, 0.1, -0.35, -0.6 - Math.abs(a) * 0.1, Math.PI + a, 0);
        hp.push({ g, m: i & 1 ? moss : hide });
      }
      this.head.add(mergeParts(hp, 'head'));
      this.eyes = makeEyes(0.13, 0.5, 0, 0.3, 0.42, -0.1);
      this.head.add(this.eyes.group);
      this.jawP = pivot('jaw', this.head, 0, -0.2, 0.2);
      const jp = [{ g: place(bbox(0.66, 0.18, 0.62, 0.08), 0, -0.05, 0.38), m: hide }, { g: place(bbox(0.5, 0.06, 0.5, 0.03), 0, 0.05, 0.38), m: mouth }];
      for (let i = 0; i < 6; i++) jp.push({ g: spike(0.035, 0.1, 4, -0.25 + i * 0.1, 0.03, 0.62, 0, 0, 0), m: thorn });
      this.jawP.add(mergeParts(jp, 'jaw'));
      // legs
      this.legs = [];
      for (let i = 0; i < 4; i++) {
        const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? -0.75 : 0.75;
        const lg = pivot('leg', this.hips, sx * 0.9, -0.25, sz);
        lg.add(mergeParts([
          { g: limbY(0.24, 0.45, 0, 0, 0, 0, 0, sx * 0.25), m: hide },
          { g: ell(0.3, 1, 0.45, 1.3, sx * 0.18, -0.78, 0.1), m: hide },
          { g: spike(0.05, 0.18, 4, sx * 0.1, -0.84, 0.46, Math.PI / 2, 0, 0), m: claw },
          { g: spike(0.05, 0.18, 4, sx * 0.3, -0.84, 0.42, Math.PI / 2, 0, 0), m: claw },
        ], 'leg'));
        this.legs.push(lg);
      }
      // the tail: five segments, then the club with its bud
      this.tail = [];
      let parent = this.hips;
      for (let i = 0; i < BH_TAIL_N; i++) {
        const r = 0.36 - i * 0.045;
        const seg = pivot('tail' + i, parent, 0, i === 0 ? -0.05 : 0, i === 0 ? -1.3 : -BH_TAIL_SEG);
        const sp = [{ g: place(capsuleGeo(r, BH_TAIL_SEG * 0.7, 10), 0, 0, -BH_TAIL_SEG * 0.5, Math.PI / 2, 0, 0), m: hide }];
        sp.push({ g: spike(0.07, 0.24 - i * 0.02, 5, 0, r * 0.85, -BH_TAIL_SEG * 0.5, -0.3, 0, 0), m: thorn });
        seg.add(mergeParts(sp, 'tailSeg'));
        this.tail.push(seg);
        parent = seg;
      }
      this.club = pivot('club', parent, 0, 0, -BH_TAIL_SEG);
      const cp = [{ g: ell(0.42, 1, 0.9, 1.1, 0, 0, -0.3, 16, 12), m: bark }];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU, e = (i % 2 ? 0.4 : -0.3);
        cp.push({ g: spike(0.07, 0.26, 5, Math.cos(a) * 0.36, Math.sin(a) * 0.34, -0.3 + e * 0.2, Math.sin(a) * 1.4, 0, -Math.cos(a) * 1.4), m: thorn });
      }
      this.club.add(mergeParts(cp, 'club'));
      this.budMat = glowMat(this, 0xfff06a, 2.0, 0x302a08);
      const bud = new THREE.Mesh(place(ell(0.24, 1, 1, 1.1, 0, 0.15, -0.62, 14, 10), 0, 0, 0), this.budMat);
      bud.castShadow = false;
      bud.name = 'bud';
      this.club.add(bud);
      this.body = body;
      this.rig.add(body);
    }

    _bossReset() {
      this.tailPose = 0; this.tailK = 0; this.lift = 0; this.walkPh = 0; this.jaw = 0; this.bloom = 0; this.bristle = 0; this.slump = 0;
      this.slamsLeft = 1; this.lastWasSlam = false; this.ring = 0; this._yankHit = false;
      this.target.copy(this.home);
      if (this.seeds) this.seeds.clear();
      if (this.marks) this.marks.clear();
      this.budMat.emissiveIntensity = 1.2;
      if (this.budCol) this.budCol.active = false;
    }

    _clearAttacks() {
      if (this.seeds) this.seeds.clear();
      if (this.marks) this.marks.clear();
    }

    _dormant(dt) { this.lift = damp(this.lift, -0.35, 3, dt); }
    _intro(dt) {
      const u = clamp(this.stateT / this._introT(), 0, 1);
      this.lift = -0.35 + 0.35 * smoothstep(0.1, 0.5, u);
      this.jaw = u > 0.45 && u < 0.85 ? 1 : 0;
      this._faceHero(3, dt);
      if (this.stateT > 1.1 && this.stateT - dt <= 1.1) { this._burst('leafKick', this.pos, 0x5aa84a, 1.5); this._sfx('warden_roar', this.pos, 0.8, 1); }
    }

    _fightStart() { this._enter('idle'); }

    /** Where the tail will land: straight behind the hips at BH_REACH. */
    _tailTarget(out) {
      headingFrom(this.yaw, _c);
      out.set(this.pos.x - _c.x * BH_REACH, this.pos.y, this.pos.z - _c.z * BH_REACH);
      const gy = this._groundY(out.x, this.pos.y + 1.5, out.z, this.pos.y);
      out.y = Math.abs(gy - this.pos.y) < 1.5 ? gy : this.pos.y;
      return out;
    }

    _onBossEnter(s) {
      const tele = BH_TELE[this.phase - 1];
      if (s === 'slamTele') {
        this._tailTarget(this.target);
        this.marks.set(5, this.target.x, this.target.y, this.target.z, 1.35);
        this._sfx('vanish_warn', this.target, 0.5, 1);
        this.telegraphFor = this.slamsLeft > 1 || this.phase < 3 ? tele : 0.55;
      } else if (s === 'slam') {
        this.marks.off(5);
        this._sfx('crusher_slam', this.target, 0.7, 1);
        this._burst('poundShock', this.target, 0x8a7a66, 1.2);
        this._burst('leafKick', this.target, 0x5aa84a, 1);
        this._shake(0.35, 380);
        // the impact: a fair shove for anyone under the club
        if (this._alive) {
          const dx = this._px - this.target.x, dz = this._pz - this.target.z;
          if (dx * dx + dz * dz < 1.7 * 1.7 && this._py < this.target.y + 1.5) this._hurt(this._player, dx, dz, 7, 0.45);
        }
      } else if (s === 'stuck') {
        this._sfx('warden_hit', this.pos, 0.5, 0.6);
        this.events.emit('stuck', this);
      } else if (s === 'yank') {
        this._burst('dust', this.target, 0x8a7a66, 1);
        this._sfx('step_stone', this.target, 0.6, 1);
        this.ring = 0;
      } else if (s === 'sprayTele') {
        this._aimSpray();
        this._sfx('gnasher_bite', this.pos, 0.6, 0.8);
      } else if (s === 'spray') {
        this._fireSpray();
      } else if (s === 'reposition') {
        this.moveT = 0;
      }
    }

    _aimSpray() {
      const hx = this._px, hz = this._pz;
      let dx = hx - this.pos.x, dz = hz - this.pos.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      for (let i = 0; i < 5; i++) {
        const off = (i - 2) * 1.8;
        let tx = hx - dz * off, tz = hz + dx * off;
        const ax = tx - this.arenaC.x, az = tz - this.arenaC.z, ad = Math.hypot(ax, az);
        if (ad > this.arenaR - 0.8) { tx = this.arenaC.x + ax / ad * (this.arenaR - 0.8); tz = this.arenaC.z + az / ad * (this.arenaR - 0.8); }
        const gy = this._groundY(tx, this.pos.y + 2, tz, this.pos.y);
        this.seedT[i * 3] = tx; this.seedT[i * 3 + 1] = gy; this.seedT[i * 3 + 2] = tz;
        this.marks.set(i, tx, gy, tz, 0.85);
      }
    }

    _fireSpray() {
      _a.set(this.pos.x, this.pos.y + BH_HIPS + 1.1, this.pos.z);
      for (let i = 0; i < 5; i++) {
        const tx = this.seedT[i * 3], ty = this.seedT[i * 3 + 1], tz = this.seedT[i * 3 + 2];
        const T = 0.95;
        const vy = (ty - _a.y + 0.5 * BH_G * T * T) / T;
        this.seeds.fire(i, _a.x, _a.y, _a.z, (tx - _a.x) / T, vy, (tz - _a.z) / T, T + 0.5);
        this.seeds.tx[i * 3 + 1] = ty;
      }
      this._sfx('cannon_fire', _a, 1.3, 0.7);
      this._burst('leafKick', _a, 0x8ac04a, 0.9);
    }

    _fight(dt, player) {
      this._player = player;
      const p = this.phase;
      switch (this.state) {
        case 'idle':
          this._faceHero(3, dt);
          this.lift = damp(this.lift, 0, 4, dt);
          if (this.stateT >= [1.0, 0.75, 0.55][p - 1]) {
            if (p >= 2 && this.lastWasSlam) { this.lastWasSlam = false; this._enter('sprayTele'); }
            else { this.lastWasSlam = true; this.slamsLeft = p >= 3 ? 2 : 1; this._enter('reposition'); }
          }
          break;
        case 'reposition': {
          // turn the tail to the hero and step so the hero stands where the club lands
          const want = Math.atan2(this._pdx, this._pdz) + Math.PI;
          this.yaw = dampAngle(this.yaw, want, 5, dt);
          const err = this._pd - BH_REACH;
          if (Math.abs(err) > 0.4) {
            const s = clamp(err, -1, 1) * 2.4 * dt;
            this.pos.x += (this._pdx / Math.max(this._pd, 1e-3)) * s;
            this.pos.z += (this._pdz / Math.max(this._pd, 1e-3)) * s;
            this._clampToArena(2.0);
            this.walkPh += dt * 6;
          }
          const aligned = Math.abs(wrapAngle(this.yaw - want)) < 0.2;
          if ((aligned && Math.abs(err) <= 0.5) || this.stateT > 1.4) this._enter('slamTele');
          break;
        }
        case 'slamTele':
          this.tailPose = 1;
          this.budMat.emissiveIntensity = 2 + 3 * Math.abs(Math.sin(this.stateT * 14));
          if (this.stateT >= this.telegraphFor) this._enter('slam');
          break;
        case 'slam':
          this.tailPose = 2;
          if (this.stateT >= 0.18) {
            this.slamsLeft--;
            if (this.slamsLeft > 0) this._enter('yank');
            else this._enter('stuck');
          }
          break;
        case 'stuck':
          this.tailPose = 2;
          this.budMat.emissiveIntensity = 3.5 + 1.5 * Math.sin(this.stateT * 9);
          this.lift = 0.05 * Math.sin(this.stateT * 20);
          if (this.stateT >= BH_STUCK[p - 1]) this._enter('yank');
          break;
        case 'yank': {
          this.tailPose = 0;
          // a small shock ring from the bud as it tears free
          this.ring = (this.ring || 0) + dt * 6;
          if (this._alive && !this._yankHit && this._pgr) {
            const dx = this._px - this.target.x, dz = this._pz - this.target.z, d = Math.hypot(dx, dz);
            if (Math.abs(d - this.ring) < 0.5 && this.ring < 2.3) { this._yankHit = true; this._hurt(player, dx, dz, 5, 0.3); }
          }
          if (this.stateT >= 0.45) {
            this._yankHit = false;
            if (this.slamsLeft > 0) this._enter('reposition');
            else this._enter('idle');
          }
          break;
        }
        case 'sprayTele':
          this._faceHero(4, dt);
          this.bristle = Math.abs(Math.sin(this.stateT * 18));
          this.jaw = 0.6;
          if (this.stateT >= BH_SPRAY_TELE) this._enter('spray');
          break;
        case 'spray':
          this.bristle = damp(this.bristle, 0, 8, dt);
          this.jaw = 1;
          if (this.stateT >= 1.2) { this.jaw = 0; this._enter('idle'); }
          break;
      }
      if (this.state !== 'sprayTele' && this.state !== 'spray') this.jaw = damp(this.jaw, 0, 6, dt);
      this._stepSeeds(dt, player);
      // touching the body is a shove
      if (player && this.state !== 'stuck') this._bump(player, this.pos.x, this.pos.y + 1.0, this.pos.z, 1.45, 6, 0.4, 1.0);
    }

    _stepSeeds(dt, player) {
      const S = this.seeds;
      S.step(dt, BH_G);
      for (let i = 0; i < S.n; i++) {
        if (!S.on[i]) continue;
        const k = i * 3;
        if (S.v[k + 1] < 0 && S.p[k + 1] <= S.tx[k + 1] + 0.1) {
          _a.set(S.p[k], S.tx[k + 1], S.p[k + 2]);
          this._burst('leafKick', _a, 0x8ac04a, 0.6);
          this._sfx('step_grass', _a, 0.8, 0.5);
          if (this._alive && player) {
            const dx = this._px - _a.x, dz = this._pz - _a.z;
            if (dx * dx + dz * dz < 0.95 * 0.95 && this._py < _a.y + 1.4) this._hurt(player, dx, dz, 5, 0.3);
          }
          S.kill(i);
          this.marks.off(i);
        } else if (S.t[i] >= S.life[i]) { S.kill(i); this.marks.off(i); }
      }
      S.write(10);
    }

    onPound(player, pos) {
      if (this.state !== 'stuck') return;
      if (!this._poundNear(player, pos, this.target.x, this.target.y, this.target.z, 2.0)) return;
      this._hitBoss('pound');
    }

    onStrike(player, kind, pos) {
      if (this.state !== 'stuck' || !pos) return false;
      const dx = pos.x - this.target.x, dz = pos.z - this.target.z;
      if (dx * dx + dz * dz > 1.6 * 1.6) return false;
      return this._hitBoss(kind || 'strike');
    }

    _onBossEnterHurt() {}

    _hurtAnim(dt) {
      this.tailPose = 0;
      this.jaw = 1;
      this.lift = 0.15 * Math.abs(Math.sin(this.stateT * 12));
    }

    _enrage(dt) {
      this._faceHero(3, dt);
      this.jaw = this.stateT < 1.0 ? 1 : 0;
      this.bristle = Math.abs(Math.sin(this.stateT * 10));
    }

    _rest() { this.tailPose = 0; this._clearAttacks(); }

    _pose(dt) {
      const t = this.time;
      const b = this.body;
      b.position.copy(this.pos);
      b.rotation.set(0, this.yaw, 0);
      const du = this.defeatU;
      if (this.state === 'defeat') {
        this.slump = smoothstep(0, 0.4, du);
        this.bloom = smoothstep(0.25, 0.7, du);
      }
      const sink = this.state === 'defeat' ? smoothstep(0.75, 1, du) : 0;
      b.scale.setScalar(1 - 0.9 * sink);
      const breathe = this.state === 'dormant' ? 0.04 * Math.sin(t * 1.3) : 0.02 * Math.sin(t * 2);
      this.hips.position.y = BH_HIPS + this.lift - 0.5 * this.slump + breathe;
      this.hips.rotation.set(0.05 * Math.sin(t * 1.5) * (1 - this.slump), 0, 0.12 * this.slump);
      const hurt = this.state === 'hurt' ? 1 : 0;
      this.neck.rotation.set(-0.25 * hurt + 0.45 * this.slump + (this.state === 'dormant' ? 0.4 : 0) + (this.state === 'intro' || this.state === 'enrage' ? -0.3 : 0), 0.3 * Math.sin(t * 0.7) * (1 - this.slump), 0);
      this.head.rotation.set(-0.1 * this.jaw, 0, 0.1 * Math.sin(t * 1.1));
      this.jawP.rotation.x = 0.55 * this.jaw * (0.8 + 0.2 * Math.sin(t * 20));
      // legs: walk when repositioning, splay on defeat
      const walking = this.state === 'reposition';
      for (let i = 0; i < 4; i++) {
        const sx = (i & 1) ? 1 : -1;
        const ph = this.walkPh + (i === 0 || i === 3 ? 0 : Math.PI);
        this.legs[i].rotation.set(walking ? 0.45 * Math.sin(ph) : 0, 0, sx * 0.9 * this.slump);
      }
      // tail
      const tp = this.tailPose;
      this.tailK = damp(this.tailK, tp, tp === 2 ? 26 : 7, dt || 0.016);
      const raise = tp === 1 ? 1 : 0;
      for (let i = 0; i < BH_TAIL_N; i++) {
        const sway = (1 - raise) * 0.18 * Math.sin(t * 1.8 - i * 0.6) * (this.state === 'stuck' ? 0.2 : 1);
        let ax;
        if (tp === 2) ax = i === 0 ? -BH_DIP : 0;
        else if (raise) ax = i === 0 ? 0.95 : 0.38 + 0.05 * Math.sin(t * 16 + i);
        else ax = i === 0 ? -0.18 : -0.02;
        const cur = this.tail[i].rotation.x;
        this.tail[i].rotation.set(dt > 0 ? damp(cur, ax, tp === 2 ? 30 : 8, dt) : ax, sway, 0);
      }
      this.club.rotation.set(tp === 1 ? 0.6 : 0, 0, 0);
      this.blooms.scale.setScalar(Math.max(0.001, this.bloom));
      if (this.state !== 'slamTele' && this.state !== 'stuck') this.budMat.emissiveIntensity = damp(this.budMat.emissiveIntensity, this.state === 'defeat' ? 0 : 1.2, 4, dt || 0.016);
      this._lookEyes(this.eyes, 2.1);
      if (this.state === 'dormant') this.eyes.look(0, -1);
      this._poseCommon(dt, this.pos.y + 3.5);
    }

    _syncColliders() {
      headingFrom(this.yaw, _c);
      this.col.setCenter(this.pos.x + _c.x * 0.1, this.pos.y + 1.1 - 0.4 * this.slump, this.pos.z + _c.z * 0.1);
      _q.setFromAxisAngle(UPV, this.yaw);
      this.col.quat.copy(_q);
      this.col.update();
      this.col.active = this.state !== 'gone';
      this.budCol.setCenter(this.target.x, this.target.y + 0.3, this.target.z);
      this.budCol.active = this.state === 'stuck';
    }
  }

  /* =========================================================================
   * EMBER — SLAGMAW, THE CRUCIBLE GLUTTON     (send-it-back)
   *
   *  A walking crucible with ladle hands and a chimney for a head. Its belly
   *  flares while a ring marks where each slag bomb will fall (0.9 s / 0.8 /
   *  0.7). A bomb lands HOT (hurts to touch), cools DARK for a few seconds,
   *  then flashes and blows. While it is dark: POUND BESIDE IT and it flies
   *  straight back into Slagmaw's grate — or, once Nim can carry, pick it up
   *  and throw it. Phase 2 lobs two and adds a fire ring (jump it); phase 3
   *  lobs three and marches on you between volleys.
   * ====================================================================== */

  const SM_BOMBS = 4, SM_G = 16, SM_FLY_T = 1.1, SM_HOT = 0.7, SM_COOL = [3.4, 3.0, 2.6], SM_FUSE = 1.0, SM_KICK_T = 0.75;
  const SM_TELE = [0.9, 0.8, 0.7], SM_CHEST = 1.7;
  const B_OFF = 0, B_FLY = 1, B_HOT = 2, B_COOL = 3, B_FUSE = 4, B_KICK = 5, B_HELD = 6, B_THROWN = 7;

  class Slagmaw extends Boss {
    constructor(def, ctx) {
      super(def, ctx, 'slagmaw');
      this.naturalHeight = 3.4;
      /* strike reach: its dark bombs lie anywhere in the ring; onStrike checks each one */
      this.hitRadius = 2 * (this.arenaR + 1);
      this.bs = new Uint8Array(SM_BOMBS);
      this.bp = new Float32Array(SM_BOMBS * 3);
      this.bv = new Float32Array(SM_BOMBS * 3);
      this.bt = new Float32Array(SM_BOMBS);
      this.btx = new Float32Array(SM_BOMBS * 3);
      this.bombMark = new Int8Array(SM_BOMBS);
      this.bombTY = new Float32Array(SM_BOMBS);
      this.lean = 0; this.scoop = 0; this.swing = 0; this.core = 1; this.lid = 0; this.stomp = 0; this.walkPh = 0; this.topple = 0;
      this.ringR = 0; this.ringOn = false; this.ringHit = false;
      this._build();
      this._initEmote();
      this._initPips();
      this.marks = new MarkerSet(this.rig, 3, 0xff5a1a);
      this._buildBombs();
      this._adoptFlash(this._mergeGroup(this.body, 'slagmaw_body'));
      this.col = this._solidBox(this.pos.x, this.pos.y + 1.4, this.pos.z, 1.05, 1.4, 1.05, 'normal', null);
      this.bombCols = [];
      this.bombRefs = [];
      for (let i = 0; i < SM_BOMBS; i++) {
        const c = new Collider({ center: [this.pos.x, this.pos.y - 50, this.pos.z], half: [0.36, 0.36, 0.36], surface: 'normal', props: null, group: 'critter', active: false });
        const ref = { linVel: new THREE.Vector3(), boss: this, bomb: i, onPound: (pl, p) => this._kickBomb(i, pl) };
        c.ref = ref;
        this.colliders.push(c);
        this.bombCols.push(c);
        this.bombRefs.push(ref);
      }
      /* THE CARRY HOOK (hero lane): each dark bomb is a carryable. */
      this.carryables = [];
      for (let i = 0; i < SM_BOMBS; i++) this.carryables.push(this._carryHandle(i));
      CARRY_READY.then((m) => { if (m && !this._disposedRoster) for (const h of this.carryables) m.registerCarryable(h); });
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const iron = skinMat(fin(this.def.color, 0x3b3331), 0.6, 0.5);
      const iron2 = skinMat(0x57504b, 0.55, 0.6);
      const brass = worldMat('copper', this.ctx);
      const soot = skinMat(0x1a1614, 0.9, 0.0);
      const body = pivot('body', null);
      this.hips = pivot('hips', body, 0, 0.95, 0);
      const parts = [
        { g: place(tubeGeometry(0.98, 1.18, 1.75, 20, 1), 0, 0.85, 0), m: iron },
        { g: place(ringProfileGeometry(1.2, [0.08, 0.1, 0.03], 20, 1), 0, 0.12, 0), m: iron2 },
        { g: place(ringProfileGeometry(1.1, [0.08, 0.1, 0.03], 20, 1), 0, 0.9, 0), m: iron2 },
        { g: place(ringProfileGeometry(1.0, [0.12, 0.08, 0.03], 20, 1), 0, 1.72, 0), m: brass },
        { g: place(tubeGeometry(0.9, 0.98, 0.1, 20, 1), 0, 1.7, 0), m: soot },
      ];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        parts.push({ g: ell(0.05, 1, 1, 1, Math.cos(a) * 1.12, 0.5, Math.sin(a) * 1.12, 6, 5), m: brass });
      }
      // the grate over the belly furnace
      for (let i = 0; i < 5; i++) parts.push({ g: place(bbox(0.08, 0.9, 0.08, 0.02), -0.4 + i * 0.2, 0.75, 1.0, -0.12, 0, 0), m: iron2 });
      parts.push({ g: place(bbox(1.0, 0.1, 0.12, 0.03), 0, 1.22, 0.98, -0.12, 0, 0), m: brass });
      parts.push({ g: place(bbox(1.0, 0.1, 0.12, 0.03), 0, 0.28, 1.08, -0.12, 0, 0), m: brass });
      this.hips.add(mergeParts(parts, 'crucible'));
      this.coreMat = glowMat(this, 0xff6a1a, 3.0, 0x2a0c04);
      const core = new THREE.Mesh(ell(0.5, 1, 0.9, 0.5, 0, 0.75, 0.72, 14, 10), this.coreMat);
      core.castShadow = false;
      core.name = 'furnaceCore';
      this.hips.add(core);
      // chimney head with a lid
      this.headP = pivot('head', this.hips, 0, 1.78, 0);
      this.headP.add(mergeParts([
        { g: place(tubeGeometry(0.36, 0.44, 0.9, 16, 1), 0, 0.45, 0), m: iron },
        { g: place(ringProfileGeometry(0.4, [0.06, 0.05, 0.02], 16, 1), 0, 0.88, 0), m: brass },
        { g: place(bbox(0.7, 0.14, 0.2, 0.05), 0, 0.62, 0.38, -0.25, 0, 0), m: soot },
      ], 'chimney'));
      this.eyes = makeEyes(0.12, 0.34, 0, 0.45, 0.4, 0.05);
      this.headP.add(this.eyes.group);
      this.lidP = pivot('lid', this.headP, 0, 0.92, -0.35);
      this.lidP.add(mergeParts([{ g: place(prismGeometry(0.42, 0.08, 16, 1), 0, 0.04, 0.35), m: iron2 }, { g: place(ell(0.08, 1, 1, 1, 0, 0.12, 0.35, 8, 6), 0, 0, 0), m: brass }], 'lid'));
      // arms with ladle hands
      const mkArm = (side) => {
        const sh = pivot(side < 0 ? 'armL' : 'armR', this.hips, side * 1.2, 1.35, 0);
        sh.add(mergeParts([{ g: ell(0.34, 1, 0.9, 1, side * 0.05, 0.05, 0), m: iron2 }, { g: limbY(0.2, 0.5, 0, -0.1, 0, 0, 0, side * 0.15), m: iron }], 'shoulder'));
        const fo = pivot('fore', sh, side * 0.1, -0.85, 0);
        fo.add(mergeParts([
          { g: limbY(0.18, 0.5, 0, 0, 0, 0, 0, 0), m: iron },
          { g: place(sphereGeo(0.42, 14, 8, 0, TAU, Math.PI * 0.5, Math.PI * 0.5), 0, -0.85, 0.05, 0, 0, 0, 1, 0.6, 1), m: iron2 },
          { g: place(ringProfileGeometry(0.42, [0.04, 0.04, 0.01], 14, 1), 0, -0.86, 0.05), m: brass },
        ], 'ladle'));
        return { sh, fo };
      };
      this.armL = mkArm(-1);
      this.armR = mkArm(1);
      this.legs = [];
      for (let s = -1; s <= 1; s += 2) {
        const lg = pivot('leg', body, s * 0.6, 0.95, 0);
        lg.add(mergeParts([{ g: limbY(0.3, 0.35, 0, 0, 0, 0, 0, 0), m: iron }, { g: place(bbox(0.7, 0.28, 0.9, 0.08), 0, -0.82, 0.12), m: soot }], 'leg'));
        this.legs.push(lg);
      }
      // the fire ring (phase 2+)
      const ringG = cached('sm:firering', () => { const g = ringProfileGeometry(1, [0.18, 0.12, 0.04], 44, 1); g.computeBoundingSphere(); return g; });
      this.fireRing = new THREE.Mesh(ringG, glowMat(this, 0xff7a1a, 3.2, 0x1a0804));
      this.fireRing.castShadow = false;
      this.fireRing.visible = false;
      this.fireRing.frustumCulled = false;
      this.fireRing.name = 'fireRing';
      this.rig.add(this.fireRing);
      this.body = body;
      this.rig.add(body);
    }

    _buildBombs() {
      const lump = cached('sm:bomb', () => {
        const parts = [normalizeAttrs(ell(0.38, 1, 0.9, 1, 0, 0, 0, 14, 10))];
        for (let i = 0; i < 7; i++) {
          const a = i * 0.9, e = (i % 3 - 1) * 0.6;
          parts.push(normalizeAttrs(ell(0.13, 1, 0.8, 1, Math.cos(a) * Math.cos(e) * 0.33, Math.sin(e) * 0.3, Math.sin(a) * Math.cos(e) * 0.33, 7, 5)));
        }
        const g = mergeGeometries(parts, false);
        for (const p of parts) p.dispose();
        g.computeBoundingSphere();
        return g;
      });
      const mk = (mat, name) => {
        const m = new THREE.InstancedMesh(lump, mat, SM_BOMBS);
        m.name = name;
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        m.castShadow = true;
        m.visible = false;
        this.rig.add(m);
        return m;
      };
      this.hotMesh = mk(getEmissive(0xff5a1a, 2.6), 'bombsHot');
      this.coolMesh = mk(skinMat(0x3a3230, 0.85, 0.1), 'bombsCool');
    }

    /**
     * THE CARRY HOOK — each bomb is a carryable under the hero lane's contract
     * (player/carry.js): `carryable` (only while DARK), `pos`, `onPickup`,
     * `onCarry`, `onThrow`, `onDrop`, `onStrike`. A throw roughly toward Slagmaw
     * is steered into its grate (the same assist the pound-kick gets); any other
     * throw flies free and bursts where it lands. A punch on a dark bomb kicks it
     * back like a pound beside it. Registered with carry.js's registry when that
     * module is present (see `CARRY` at the top of this file).
     */
    _carryHandle(i) {
      const self = this;
      const k = i * 3;
      return {
        kind: 'slagbomb', index: i, boss: self, course: self.ctx ? self.ctx.course : undefined,
        pos: new THREE.Vector3(),
        held: false,
        carryRadius: 0.42, carryHeavy: 0.35, carryHoldY: 1.95,
        get carryable() { return !self.defeated && self.state !== 'gone' && (self.bs[i] === B_COOL || self.bs[i] === B_FUSE); },
        onPickup() {
          if (!this.carryable) return false;
          self.bs[i] = B_HELD; self.bt[i] = 0; this.held = true;
          self._sfx('step_stone', this.pos, 1.3, 0.6);
          self.events.emit('bombHeld', i, self);
          return true;
        },
        onCarry(player, holdPos) {
          this.pos.copy(holdPos);
          if (self.bs[i] === B_HELD) { self.bp[k] = holdPos.x; self.bp[k + 1] = holdPos.y; self.bp[k + 2] = holdPos.z; }
        },
        onThrow(player, vel) {
          this.held = false;
          if (self.bs[i] !== B_HELD) return;
          const px = this.pos.x, py = this.pos.y, pz = this.pos.z;
          self.bp[k] = px; self.bp[k + 1] = py; self.bp[k + 2] = pz;
          let vx = vel ? vel.x : 0, vy = vel ? vel.y : 0, vz = vel ? vel.z : 0;
          const hs = Math.hypot(vx, vz);
          if (hs < 0.5) { self.bs[i] = B_COOL; self.bt[i] = 0; self.bp[k + 1] = self.arenaC.y + 0.36; return; }
          // aim assist: a throw within ~40 deg of the grate goes into it
          const tx = self.pos.x - px, tz = self.pos.z - pz, td = Math.hypot(tx, tz);
          if (td > 0.5 && td < 16 && (vx * tx + vz * tz) / (hs * td) > 0.76) {
            const T = clamp(td / 10, 0.45, 1.1), ty = self.pos.y + SM_CHEST - py;
            vx = tx / T; vz = tz / T; vy = (ty + 0.5 * SM_G * T * T) / T;
          }
          self.bv[k] = vx; self.bv[k + 1] = vy; self.bv[k + 2] = vz;
          self.bs[i] = B_THROWN; self.bt[i] = 0;
          self.events.emit('bombThrown', i, self);
        },
        onDrop(player, pos) {
          this.held = false;
          if (self.bs[i] !== B_HELD) return;
          const p = pos || this.pos;
          self.bp[k] = p.x; self.bp[k + 1] = self.arenaC.y + 0.36; self.bp[k + 2] = p.z;
          self.bs[i] = B_COOL; self.bt[i] = 0;
        },
        onStrike(player) { return self._kickBomb(i, player); },
        /** keep `pos` on the bomb while it is not in the hands */
        sync() { if (self.bs[i] !== B_HELD) this.pos.set(self.bp[k], self.bp[k + 1], self.bp[k + 2]); },
      };
    }

    dispose() {
      if (CARRY && this.carryables) for (const h of this.carryables) CARRY.unregisterCarryable(h);
      this._disposedRoster = true;
      super.dispose();
    }

    _bossReset() {
      this.lean = 0; this.scoop = 0; this.swing = 0; this.core = 1; this.lid = 0; this.stomp = 0; this.walkPh = 0; this.topple = 0;
      this.ringR = 0; this.ringOn = false; this.ringHit = false;
      if (this.fireRing) this.fireRing.visible = false;
      this.volley = 0; this.didRing = false; this.didMarch = false; this.nBombs = 0;
    }

    _clearAttacks() {
      if (!this.bs) return;
      for (let i = 0; i < SM_BOMBS; i++) { this.bs[i] = B_OFF; if (this.bombCols) this.bombCols[i].active = false; }
      if (this.carryables) for (let i = 0; i < SM_BOMBS; i++) this.carryables[i].held = false;
      if (this.marks) this.marks.clear();
      this.ringOn = false;
      if (this.fireRing) this.fireRing.visible = false;
      this._writeBombs();
    }

    _dormant(dt) { this.core = damp(this.core, 0.4, 2, dt); this.lean = damp(this.lean, 0.25, 2, dt); }
    _intro(dt) {
      const u = clamp(this.stateT / this._introT(), 0, 1);
      this.core = 0.4 + 2.6 * smoothstep(0, 0.4, u);
      this.lean = 0.25 * (1 - smoothstep(0, 0.35, u));
      this.lid = u > 0.4 && u < 0.8 ? 1 : 0;
      this._faceHero(3, dt);
      if (this.stateT > 1.2 && this.stateT - dt <= 1.2) {
        _a.set(this.pos.x, this.pos.y + 2.6, this.pos.z);
        this._burst('spark', _a, 0xffb04a, 1.5);
        this._sfx('crusher_slam', _a, 0.9, 1);
      }
    }

    _onBossEnter(s) {
      if (s === 'lobTele') {
        const n = this.phase;
        this.nBombs = n;
        let dx = this._pdx, dz = this._pdz;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l; dz /= l;
        for (let i = 0; i < n; i++) {
          const off = n === 1 ? 0 : (i - (n - 1) * 0.5) * 2.4;
          let tx = this._px - dz * off, tz = this._pz + dx * off;
          const ax = tx - this.arenaC.x, az = tz - this.arenaC.z, ad = Math.hypot(ax, az);
          const lim = this.arenaR - 1.0;
          if (ad > lim) { tx = this.arenaC.x + ax / ad * lim; tz = this.arenaC.z + az / ad * lim; }
          // never on top of itself
          const sx = tx - this.pos.x, sz = tz - this.pos.z, sd = Math.hypot(sx, sz);
          if (sd < 2.4) { tx = this.pos.x + (sd > 1e-3 ? sx / sd : dx) * 2.4; tz = this.pos.z + (sd > 1e-3 ? sz / sd : dz) * 2.4; }
          const gy = this._groundY(tx, this.pos.y + 2, tz, this.pos.y);
          this.btx[i * 3] = tx; this.btx[i * 3 + 1] = gy; this.btx[i * 3 + 2] = tz;
          this.marks.set(i, tx, gy, tz, 1.25);
        }
        this._sfx('lava_bubble', this.pos, 0.6, 1);
      } else if (s === 'lob') {
        this._lob();
      } else if (s === 'ringTele') {
        this._sfx('vanish_warn', this.pos, 0.7, 1);
      } else if (s === 'ringFire') {
        this.ringR = 1.2; this.ringOn = true; this.ringHit = false;
        this._sfx('crusher_slam', this.pos, 0.6, 1);
        this._burst('poundShock', this.pos, 0xff7a1a, 1.2);
        this._shake(0.3, 360);
      } else if (s === 'hurt') {
        this.lid = 1;
        _a.set(this.pos.x, this.pos.y + 3.0, this.pos.z);
        this._burst('dust', _a, 0x2a2a2a, 1.6);
        this._sfx('lava_bubble', _a, 0.5, 1);
      }
    }

    _lob() {
      headingFrom(this.yaw, _c);
      _a.set(this.pos.x + _c.x * 0.8 + _c.z * 0.9, this.pos.y + 3.2, this.pos.z + _c.z * 0.8 - _c.x * 0.9);
      for (let i = 0; i < this.nBombs; i++) {
        let slot = -1;
        for (let k = 0; k < SM_BOMBS; k++) if (this.bs[k] === B_OFF) { slot = k; break; }
        if (slot < 0) break;
        const tx = this.btx[i * 3], ty = this.btx[i * 3 + 1], tz = this.btx[i * 3 + 2];
        const T = SM_FLY_T + i * 0.12;
        this.bs[slot] = B_FLY; this.bt[slot] = 0;
        const k = slot * 3;
        this.bp[k] = _a.x; this.bp[k + 1] = _a.y; this.bp[k + 2] = _a.z;
        this.bv[k] = (tx - _a.x) / T; this.bv[k + 1] = (ty + 0.36 - _a.y + 0.5 * SM_G * T * T) / T; this.bv[k + 2] = (tz - _a.z) / T;
        this.bombMark[slot] = i;
        this.bombTY[slot] = ty;
      }
      this._sfx('cannon_fire', _a, 0.8, 0.9);
      this._burst('lavaPop', _a, 0xff7a2a, 1);
      this.volley = (this.volley || 0) + 1;
    }

    _fight(dt, player) {
      this._player = player;
      const p = this.phase;
      switch (this.state) {
        case 'idle':
          this._faceHero(2.5, dt);
          this.scoop = damp(this.scoop, 0, 6, dt); this.swing = damp(this.swing, 0, 6, dt);
          this.core = damp(this.core, 1.5, 3, dt);
          if (this.stateT >= [1.2, 0.9, 0.7][p - 1]) {
            if (p >= 2 && this.volley >= 1 && !this.didRing) { this.didRing = true; this._enter('ringTele'); }
            else if (p >= 3 && this.volley >= 1 && !this.didMarch) { this.didMarch = true; this._enter('march'); }
            else { this.didRing = false; this.didMarch = false; this._enter('lobTele'); }
          }
          break;
        case 'lobTele':
          this._faceHero(4, dt);
          this.scoop = damp(this.scoop, 1, 8, dt);
          this.core = 2 + 3 * Math.abs(Math.sin(this.stateT * 12));
          if (this.stateT >= SM_TELE[p - 1]) this._enter('lob');
          break;
        case 'lob':
          this.scoop = damp(this.scoop, 0, 10, dt);
          this.swing = damp(this.swing, 1, 14, dt);
          if (this.stateT >= 0.5) this._enter('idle');
          break;
        case 'ringTele':
          this.stomp = smoothstep(0, 1, this.stateT / 0.7);
          this.core = 2 + 2 * Math.abs(Math.sin(this.stateT * 16));
          if (this.stateT >= 0.7) this._enter('ringFire');
          break;
        case 'ringFire':
          this.stomp = damp(this.stomp, 0, 20, dt);
          this.ringR += dt * 9.5;
          if (this._alive && !this.ringHit && player) {
            const dx = this._px - this.pos.x, dz = this._pz - this.pos.z, d = Math.hypot(dx, dz);
            const low = this._py - this.pos.y < 0.5;
            if (low && Math.abs(d - this.ringR) < 0.55) { this.ringHit = true; this._hurt(player, dx, dz, 6.5, 0.4); this._sfx('lava_bubble', this.pos, 1.3, 0.8); }
          }
          if (this.ringR >= this.arenaR - 0.5) { this.ringOn = false; this._enter('idle'); }
          break;
        case 'march': {
          this._faceHero(5, dt);
          if (this._pd > 3.2) {
            this.pos.x += (this._pdx / this._pd) * 1.9 * dt;
            this.pos.z += (this._pdz / this._pd) * 1.9 * dt;
            this._clampToArena(2.0);
            this.walkPh += dt * 7;
            if (Math.floor(this.walkPh / Math.PI) !== this._stepIx) { this._stepIx = Math.floor(this.walkPh / Math.PI); this._sfx('step_metal', this.pos, 0.5, 0.9); this._shake(0.05, 80); }
          }
          if (this.stateT >= 1.5) this._enter('lobTele');
          break;
        }
      }
      this._stepBombs(dt, player);
      if (player) this._bump(player, this.pos.x, this.pos.y + 1.4, this.pos.z, 1.3, 6, 0.4, 1.0);
    }

    _stepBombs(dt, player) {
      const cool = SM_COOL[this.phase - 1];
      for (let i = 0; i < SM_BOMBS; i++) {
        const s = this.bs[i];
        if (s === B_OFF) continue;
        const k = i * 3;
        this.bt[i] += dt;
        if (s === B_FLY || s === B_KICK || s === B_THROWN) {
          this.bv[k + 1] -= SM_G * dt;
          this.bp[k] += this.bv[k] * dt; this.bp[k + 1] += this.bv[k + 1] * dt; this.bp[k + 2] += this.bv[k + 2] * dt;
        }
        _a.set(this.bp[k], this.bp[k + 1], this.bp[k + 2]);
        if (s === B_FLY) {
          const ty = this.bombTY[i] + 0.36;
          if (this.bv[k + 1] < 0 && _a.y <= ty) {
            this.bp[k + 1] = ty;
            this.bs[i] = B_HOT; this.bt[i] = 0;
            this.marks.off(this.bombMark[i]);
            this._burst('lavaPop', _a, 0xff6a1a, 1.1);
            this._burst('dust', _a, 0x5a4a40, 0.8);
            this._sfx('crusher_slam', _a, 1.3, 0.6);
            if (this._alive && player) {
              const dx = this._px - _a.x, dz = this._pz - _a.z;
              if (dx * dx + dz * dz < 1.35 * 1.35 && this._py < _a.y + 1.4) this._hurt(player, dx, dz, 6, 0.4);
            }
          }
        } else if (s === B_HOT) {
          if (player) this._bump(player, _a.x, _a.y, _a.z, 0.5, 4, 0.25, 0.7);
          if (this.bt[i] >= SM_HOT) { this.bs[i] = B_COOL; this.bt[i] = 0; this._burst('dust', _a, 0x777777, 0.5); }
        } else if (s === B_COOL) {
          if (this.bt[i] >= cool) { this.bs[i] = B_FUSE; this.bt[i] = 0; this._sfx('vanish_warn', _a, 1.6, 0.6); }
        } else if (s === B_FUSE) {
          if (this.bt[i] >= SM_FUSE) this._blast(i, player);
        } else if (s === B_KICK || s === B_THROWN) {
          _b.set(this.pos.x, this.pos.y + SM_CHEST, this.pos.z);
          const d2 = _a.distanceToSquared(_b);
          if (d2 < 1.7 * 1.7) {
            this.bs[i] = B_OFF;
            this._burst('lavaPop', _a, 0xff6a1a, 1.3);
            this._hitBoss(s === B_KICK ? 'pound' : 'throw');
          } else if (this.bt[i] > 2.5 || _a.y < this.pos.y - 3 || (s === B_THROWN && this.bv[k + 1] < 0 && _a.y <= this.arenaC.y + 0.36)) {
            this._blast(i, player);
          }
        }
      }
      this._writeBombs();
    }

    _blast(i, player) {
      const k = i * 3;
      _a.set(this.bp[k], this.bp[k + 1], this.bp[k + 2]);
      this.bs[i] = B_OFF;
      this._burst('lavaPop', _a, 0xff6a1a, 1.4);
      this._burst('poundShock', _a, 0xff7a1a, 0.9);
      this._sfx('cannon_fire', _a, 0.6, 1);
      this._shake(0.18, 220);
      if (this._alive && player) {
        const dx = this._px - _a.x, dz = this._pz - _a.z;
        if (dx * dx + dz * dz < 2.2 * 2.2 && Math.abs(this._py - _a.y) < 1.8) this._hurt(player, dx, dz, 6.5, 0.4);
      }
    }

    /** A pound beside a DARK bomb sends it back at Slagmaw (auto-aimed). */
    _kickBomb(i, player) {
      const s = this.bs[i];
      if (s !== B_COOL && s !== B_FUSE) return false;
      const k = i * 3;
      const T = SM_KICK_T;
      const tx = this.pos.x, ty = this.pos.y + SM_CHEST, tz = this.pos.z;
      this.bv[k] = (tx - this.bp[k]) / T;
      this.bv[k + 1] = (ty - this.bp[k + 1] + 0.5 * SM_G * T * T) / T;
      this.bv[k + 2] = (tz - this.bp[k + 2]) / T;
      this.bs[i] = B_KICK; this.bt[i] = 0;
      _a.set(this.bp[k], this.bp[k + 1], this.bp[k + 2]);
      this._burst('poundShock', _a, 0xd9c8a6, 0.8);
      this._sfx('bounce', _a, 0.7, 1);
      this.events.emit('bombKicked', i, this);
      return true;
    }

    onPound(player, pos) {
      const p = (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) ? pos : (player && (player.pos || player.position));
      if (!p) return;
      const R = TUNE.pound.shockRadius + 0.3;
      let best = -1, bd = R * R;
      for (let i = 0; i < SM_BOMBS; i++) {
        if (this.bs[i] !== B_COOL && this.bs[i] !== B_FUSE) continue;
        const k = i * 3;
        const dx = this.bp[k] - p.x, dz = this.bp[k + 2] - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bd && Math.abs(this.bp[k + 1] - p.y) < 2.0) { bd = d2; best = i; }
      }
      if (best >= 0) this._kickBomb(best, player);
    }

    onStrike(player, kind, pos) {
      if (!pos) return false;
      for (let i = 0; i < SM_BOMBS; i++) {
        if (this.bs[i] !== B_COOL && this.bs[i] !== B_FUSE) continue;
        const k = i * 3;
        const dx = this.bp[k] - pos.x, dz = this.bp[k + 2] - pos.z;
        if (dx * dx + dz * dz < 1.4 * 1.4) return this._kickBomb(i, player);
      }
      return false;
    }

    _writeBombs() {
      if (!this.hotMesh) return;
      let anyH = false, anyC = false;
      const t = this.time;
      for (let i = 0; i < SM_BOMBS; i++) {
        const s = this.bs[i];
        const k = i * 3;
        const hot = s === B_FLY || s === B_HOT || (s === B_FUSE && Math.sin(this.bt[i] * (18 + this.bt[i] * 30)) > 0);
        const cool = s === B_COOL || s === B_KICK || s === B_HELD || s === B_THROWN || (s === B_FUSE && !hot);
        if (s !== B_OFF) {
          _a.set(this.bp[k], this.bp[k + 1], this.bp[k + 2]);
          _q.setFromAxisAngle(UPV, t * 2 + i + (s === B_KICK || s === B_THROWN ? this.bt[i] * 12 : 0));
          const sc = s === B_FUSE ? 1 + 0.12 * Math.sin(this.bt[i] * 30) : 1;
          _s.setScalar(sc);
          _m.compose(_a, _q, _s);
        } else _m.makeScale(0, 0, 0);
        if (hot) { this.hotMesh.setMatrixAt(i, _m); anyH = true; } else { _c.set(0, 0, 0); this.hotMesh.setMatrixAt(i, _m2zero()); }
        if (cool) { this.coolMesh.setMatrixAt(i, _m); anyC = true; } else this.coolMesh.setMatrixAt(i, _m2zero());
      }
      if (this.carryables) for (let i = 0; i < SM_BOMBS; i++) this.carryables[i].sync();
      this.hotMesh.visible = anyH; this.coolMesh.visible = anyC;
      this.hotMesh.instanceMatrix.needsUpdate = true;
      this.coolMesh.instanceMatrix.needsUpdate = true;
    }

    _hurtAnim(dt) {
      this.lid = 1;
      this.topple = 0.35 * Math.sin(clamp(this.stateT / this._hurtT(), 0, 1) * Math.PI);
      this.core = 4 * Math.abs(Math.sin(this.stateT * 20));
    }

    _enrage(dt) {
      this._faceHero(3, dt);
      this.lid = this.stateT < 1.0 ? 1 : 0;
      this.core = 2.5 + 2.5 * Math.abs(Math.sin(this.stateT * 8));
      this.swing = Math.abs(Math.sin(this.stateT * 6));
    }

    _rest() { this._clearAttacks(); }

    _pose(dt) {
      const t = this.time;
      const b = this.body;
      b.position.copy(this.pos);
      b.rotation.set(0, this.yaw, 0);
      const du = this.defeatU;
      if (this.state === 'defeat') this.topple = smoothstep(0.1, 0.55, du);
      b.scale.setScalar(1 - 0.9 * smoothstep(0.8, 1, du));
      this.hips.rotation.set(-this.topple * (this.state === 'defeat' ? 1.35 : 1) + this.lean, 0, 0.04 * Math.sin(t * 1.2));
      this.hips.position.y = 0.95 - 0.12 * this.stomp;
      this.lidP.rotation.x = -1.3 * this.lid * (0.7 + 0.3 * Math.sin(t * 25));
      // arms: the right scoops into the belly, then swings over the top
      this.armR.sh.rotation.set(-0.9 * this.scoop - 2.6 * this.swing, 0, -0.3 - 0.5 * this.scoop);
      this.armR.fo.rotation.set(-1.2 * this.scoop - 0.4 * this.swing, 0, 0);
      this.armL.sh.rotation.set(0.2 * Math.sin(t * 1.4) - 0.8 * this.stomp, 0, 0.3);
      this.armL.fo.rotation.set(-0.5, 0, 0);
      const walking = this.state === 'march';
      this.legs[0].rotation.set(walking ? 0.4 * Math.sin(this.walkPh) : -0.9 * this.stomp, 0, 0);
      this.legs[1].rotation.set(walking ? -0.4 * Math.sin(this.walkPh) : 0, 0, 0);
      const flick = 0.85 + 0.15 * Math.sin(t * 17) * Math.sin(t * 6.3);
      this.coreMat.emissiveIntensity = (this.state === 'defeat' ? 3 * (1 - smoothstep(0, 0.5, du)) : this.core) * flick;
      if (this.ringOn) {
        this.fireRing.visible = true;
        this.fireRing.position.set(this.pos.x, this.pos.y + 0.1, this.pos.z);
        this.fireRing.scale.set(this.ringR, 1, this.ringR);
      } else this.fireRing.visible = false;
      this._lookEyes(this.eyes, 3.2);
      if (this.state === 'dormant') this.eyes.look(0, -0.7);
      this._poseCommon(dt, this.pos.y + 4.1);
    }

    _syncColliders() {
      this.col.setCenter(this.pos.x, this.pos.y + 1.4, this.pos.z);
      this.col.active = this.state !== 'gone';
      if (!this.bombCols) return;
      for (let i = 0; i < SM_BOMBS; i++) {
        const c = this.bombCols[i];
        const s = this.bs[i];
        const on = s === B_HOT || s === B_COOL || s === B_FUSE;
        c.active = on;
        if (on) c.setCenter(this.bp[i * 3], this.bp[i * 3 + 1], this.bp[i * 3 + 2]);
      }
    }
  }

  const _zeroM = new THREE.Matrix4().makeScale(0, 0, 0);
  function _m2zero() { return _zeroM; }

  /* =========================================================================
   * RIME — HOARHORN, LORD OF THE FLOE     (ice sumo)
   *
   *  A horned, tusked floe-beast on a square slab of sea ice. It shuffles at
   *  you; it rears and snorts (0.8 s) and BELLY-CHARGES along a line. Step
   *  aside near the edge and it slides to the lip and TEETERS, flippers
   *  windmilling: push it now — stomp it, pound beside it — and it goes into
   *  the sea. Three dunks. It is heavy on the flat (a stomp shoves it 1.5 m, a
   *  pound 3.5 m, less in phase 3), so the edge is the fight.
   *  Phase 2 adds a FROST BREATH cone (it inhales for 0.9 s — get behind it);
   *  phase 3 charges twice.
   * ====================================================================== */

  const HH_TELE = 0.8, HH_CHARGE = [9, 10.5, 12], HH_SLIDE_DECEL = 5.0, HH_WALK_DECEL = 12, HH_TEETER = 1.7;
  const HH_PUSH = { stomp: 4.0, pound: 6.0, strike: 5.0, throw: 5.0 }, HH_HEAVY = [1, 0.9, 0.78];

  class Hoarhorn extends Boss {
    constructor(def, ctx) {
      super(def, ctx, 'hoarhorn');
      this.naturalHeight = 2.8;
      this.hitRadius = 1.9;
      const d = this.def;
      const fl = d.floe === false ? null : (d.floe || {});
      readV3(d.p, _a);
      this.floeTop = fl && Number.isFinite(fl.y) ? fl.y : _a.y;
      this.floeHalf = fl ? Math.max(4, fin(fl.half, this.arenaR - 0.5)) : this.arenaR;
      this.floeDepth = fl ? Math.max(0.4, fin(fl.depth, 1.4)) : 0;
      if (fl) {
        this.groundY = this.floeTop;
        this.home.y = this.floeTop;
        this.arenaC.y = this.floeTop;
        this.pos.copy(this.home);
      }
      this.vel = new THREE.Vector3();
      this.retFrom = new THREE.Vector3();
      this.chargeDir = new THREE.Vector3();
      this.edgeN = new THREE.Vector3();
      this.rear = 0; this.walkPh = 0; this.breath = 0; this.wave = 0; this.dunkY = 0; this.teeterSide = 0;
      this.chargesLeft = 0;
      this._build(fl);
      this._initEmote();
      this._initPips();
      this._adoptFlash(this._mergeGroup(this.body, 'hoarhorn_body'));
      this.col = this._solidBox(this.pos.x, this.pos.y + 1.2, this.pos.z, 1.2, 1.2, 1.4, 'bounce', { power: 2.6 });
      if (fl) {
        this.floeCol = new Collider({
          center: [this.arenaC.x, this.floeTop - this.floeDepth * 0.5, this.arenaC.z],
          half: [this.floeHalf, this.floeDepth * 0.5, this.floeHalf], surface: 'ice', props: null, group: 'world',
        });
        this.floeCol.ref = { linVel: new THREE.Vector3() };
        this.colliders.push(this.floeCol);
      }
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build(fl) {
      const fur = skinMat(fin(this.def.color, 0xe8ecf0), 0.95, 0.0);
      const fur2 = skinMat(0xc9d2dc, 0.95, 0.0);
      const face = skinMat(0x5d6a7c, 0.7, 0.0);
      const nose = skinMat(0x222733, 0.5, 0.0);
      const ivory = skinMat(0xf3ead2, 0.35, 0.0);
      const horn = skinMat(0x7b8aa0, 0.4, 0.1);
      const hoof = skinMat(0x2f3440, 0.6, 0.0);
      const body = pivot('body', null);
      this.torso = pivot('torso', body, 0, 1.15, 0);
      const parts = [
        { g: ell(1.25, 1.0, 0.82, 1.2, 0, 0, 0, 22, 14), m: fur },
        { g: ell(0.9, 1, 0.6, 1, 0, 0.62, -0.25, 16, 10), m: fur },
      ];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        parts.push({ g: spike(0.18, 0.5, 5, Math.cos(a) * 1.1, -0.62, Math.sin(a) * 1.3, Math.PI + Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3), m: i & 1 ? fur2 : fur });
      }
      parts.push({ g: spike(0.14, 0.4, 5, 0, 0.1, -1.45, -1.9, 0, 0), m: fur2 });
      this.torso.add(mergeParts(parts, 'hide'));
      this.head = pivot('head', this.torso, 0, 0.25, 1.25);
      const hp = [
        { g: ell(0.62, 1, 0.8, 0.95, 0, 0, 0.1), m: face },
        { g: ell(0.45, 1.25, 0.65, 0.8, 0, -0.18, 0.5), m: face },
        { g: ell(0.14, 1.3, 0.8, 0.9, 0, -0.05, 0.88, 10, 8), m: nose },
        { g: ell(0.34, 1.6, 0.45, 0.7, 0, 0.36, 0.28, 12, 8), m: fur },
        { g: spike(0.09, 0.62, 6, -0.28, -0.4, 0.62, Math.PI - 0.15, 0, -0.12), m: ivory },
        { g: spike(0.09, 0.62, 6, 0.28, -0.4, 0.62, Math.PI - 0.15, 0, 0.12), m: ivory },
        { g: ell(0.32, 1.2, 0.8, 0.8, 0, -0.1, 0.25), m: fur2 },
      ];
      for (let s = -1; s <= 1; s += 2) {
        hp.push({ g: place(tubeGeometry(0.12, 0.2, 0.7, 8, 1), s * 0.55, 0.45, 0.0, 0.2, 0, s * -1.1), m: horn });
        hp.push({ g: place(tubeGeometry(0.06, 0.12, 0.6, 8, 1), s * 0.95, 0.72, 0.2, -0.9, 0, s * -0.3), m: horn });
        hp.push({ g: spike(0.06, 0.32, 6, s * 1.02, 0.78, 0.55, 1.2, 0, s * 0.3), m: horn });
      }
      this.head.add(mergeParts(hp, 'head'));
      this.eyes = makeEyes(0.09, 0.44, 0, 0.26, 0.58, -0.1);
      this.head.add(this.eyes.group);
      this.legs = [];
      for (let i = 0; i < 4; i++) {
        const sx = (i & 1) ? 1 : -1, sz = (i & 2) ? -0.75 : 0.8;
        const lg = pivot('leg', this.torso, sx * 0.75, -0.55, sz);
        lg.add(mergeParts([{ g: limbY(0.3, 0.3, 0, 0, 0, 0, 0, 0), m: fur2 }, { g: ell(0.3, 1, 0.4, 1.2, 0, -0.62, 0.05), m: hoof }], 'leg'));
        this.legs.push(lg);
      }
      this.body = body;
      this.rig.add(body);
      // the floe: an ice slab with a snow crust, crack lines and a lit lip
      if (fl) {
        const ice = skinMat(0xcfeaff, 0.18, 0.0);
        const iceSide = skinMat(0x7fb6dc, 0.3, 0.0);
        const snow = skinMat(0xf6f9fc, 0.9, 0.0);
        const crack = skinMat(0x5d8fb5, 0.4, 0.0);
        const h = this.floeHalf, dd = this.floeDepth;
        const fp = [
          { g: place(bbox(h * 2, dd, h * 2, 0.25), 0, -dd * 0.5, 0), m: iceSide },
          { g: place(bbox(h * 2 - 0.3, 0.06, h * 2 - 0.3, 0.02), 0, -0.03, 0), m: ice },
        ];
        for (let i = 0; i < 10; i++) {
          const a = this.rng() * TAU, l = 1.2 + this.rng() * 2.5;
          fp.push({ g: place(bbox(0.05, 0.01, l, 0.004), (this.rng() - 0.5) * h * 1.4, 0.005, (this.rng() - 0.5) * h * 1.4, 0, a, 0), m: crack });
        }
        for (let s = 0; s < 4; s++) {
          for (let k = 0; k < 6; k++) {
            const u = (k + 0.5) / 6 * 2 - 1;
            const x = s < 2 ? u * (h - 0.6) : (s === 2 ? -1 : 1) * (h - 0.45);
            const z = s < 2 ? (s === 0 ? -1 : 1) * (h - 0.45) : u * (h - 0.6);
            fp.push({ g: ell(0.5, 1.4, 0.3, 0.8, x, 0.02, z, 10, 6), m: snow });
          }
        }
        const slab = mergeParts(fp, 'floe');
        slab.castShadow = false;
        slab.receiveShadow = true;
        slab.position.set(this.arenaC.x, this.floeTop, this.arenaC.z);
        this.rig.add(slab);
        this.floeMesh = slab;
        // the lip stripe (CONTRACT §17: every edge you can fall off is drawn)
        const pal = this.theme && this.theme.palette;
        const stripeC = pal && pal.safeEdge !== undefined ? pal.safeEdge : 0x9fe8ff;
        const sp = [];
        for (let s = 0; s < 4; s++) {
          const g = bbox(s < 2 ? h * 2 : 0.09, 0.04, s < 2 ? 0.09 : h * 2, 0.01);
          g.translate(s < 2 ? 0 : (s === 2 ? -h + 0.05 : h - 0.05), 0.02, s < 2 ? (s === 0 ? -h + 0.05 : h - 0.05) : 0);
          sp.push({ g, m: getEmissive(stripeC, 1.4) });
        }
        const stripe = mergeParts(sp, 'floeLip');
        stripe.castShadow = false;
        stripe.position.copy(slab.position);
        this.rig.add(stripe);
      }
    }

    _bossReset() {
      this.vel.set(0, 0, 0);
      this.rear = 0; this.walkPh = 0; this.breath = 0; this.wave = 0; this.dunkY = 0; this.teeterSide = 0;
      this.chargesLeft = 0; this.breathHit = false; this.lastBreath = false;
    }

    _clearAttacks() { this.vel.set(0, 0, 0); }

    /** Distance from the floe edge along x/z (negative = past it). */
    _edgeDist(x, z) {
      const hx = this.floeHalf - Math.abs(x - this.arenaC.x);
      const hz = this.floeHalf - Math.abs(z - this.arenaC.z);
      return Math.min(hx, hz);
    }

    _dormant(dt) { this.rear = damp(this.rear, -0.25, 2, dt); }
    _intro(dt) {
      const u = clamp(this.stateT / this._introT(), 0, 1);
      this.rear = -0.25 + 0.9 * Math.sin(smoothstep(0.1, 0.8, u) * Math.PI);
      this._faceHero(3, dt);
      if (this.stateT > 1.4 && this.stateT - dt <= 1.4) { this._burst('snowPuff', this.pos, 0xeaf4ff, 1.6); this._sfx('crusher_slam', this.pos, 0.6, 1); this._shake(0.3, 400); }
    }

    _fightStart() { this._enter('shuffle'); }

    _onBossEnter(s) {
      if (s === 'chargeTele') { this._sfx('warden_roar', this.pos, 1.25, 0.7); this.chargeDir.set(this._pdx, 0, this._pdz); }
      else if (s === 'charge') {
        if (this.chargeDir.lengthSq() < 1e-4) this.chargeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.chargeDir.set(this._pdx, 0, this._pdz);
        if (this.chargeDir.lengthSq() < 1e-4) this.chargeDir.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
        this.chargeDir.normalize();
        this.yaw = Math.atan2(this.chargeDir.x, this.chargeDir.z);
        const v = HH_CHARGE[this.phase - 1];
        this.vel.set(this.chargeDir.x * v, 0, this.chargeDir.z * v);
        this._sfx('slide', this.pos, 0.7, 1);
        this._burst('snowPuff', this.pos, 0xeaf4ff, 1.2);
      } else if (s === 'teeter') {
        this.vel.set(0, 0, 0);
        this._sfx('skitter', this.pos, 0.55, 0.9);
        this.events.emit('teeter', this);
      } else if (s === 'fall') {
        this.dunkY = 0;
        this._hitBoss('dunk');
      } else if (s === 'breathTele') { this._sfx('wind', this.pos, 0.6, 0.8); this.breathHit = false; }
      else if (s === 'breath') { this._sfx('wind', this.pos, 1.4, 1); }
      else if (s === 'return') {
        this.retFrom.copy(this.pos);
      } else if (s === 'defeat') {
        // it hauls itself back up onto the nearest lip of its floe
        const lim = this.floeHalf - 1.4;
        this.pos.x = this.arenaC.x + clamp(this.pos.x - this.arenaC.x, -lim, lim);
        this.pos.z = this.arenaC.z + clamp(this.pos.z - this.arenaC.z, -lim, lim);
        this.dunkY = 0;
        this.vel.set(0, 0, 0);
      }
    }

    /* A boss hit is a DUNK: `_hitBoss` from `fall` — so the hurt state is the dunk itself. */
    _hitBoss(how) {
      if (this.state !== 'fall') return false;
      this.hp = Math.max(0, this.hp - 1);
      this.hits++;
      this.phase = Math.min(3, this.hpMax - this.hp + 1);
      this.hud.hp = this.hp;
      this.flash = 1;
      this._say('hurt' + this.hits);
      this.events.emit('hit', this.hp, this, how);
      return true;
    }

    _fight(dt, player) {
      this._player = player;
      const p = this.phase;
      const drive = this.state === 'charge';
      const decel = drive ? HH_SLIDE_DECEL * 0.5 : (this.state === 'stagger' ? HH_SLIDE_DECEL : HH_WALK_DECEL);
      if (this.state !== 'fall' && this.state !== 'return') {
        // integrate the slide
        const sp = Math.hypot(this.vel.x, this.vel.z);
        if (sp > 1e-4) {
          const ns = Math.max(0, sp - decel * dt);
          this.vel.x *= ns / sp; this.vel.z *= ns / sp;
          this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
        }
        // over the edge?
        if (this._edgeDist(this.pos.x, this.pos.z) < -0.2) { this._enter('fall'); return; }
      }
      switch (this.state) {
        case 'shuffle': {
          this._faceHero(3, dt);
          const spd = [1.3, 1.7, 2.1][p - 1];
          if (this._pd > 2.2) {
            const nx = this.pos.x + (this._pdx / this._pd) * spd * dt, nz = this.pos.z + (this._pdz / this._pd) * spd * dt;
            if (this._edgeDist(nx, nz) > 1.2) { this.pos.x = nx; this.pos.z = nz; }
            this.walkPh += dt * 5;
          }
          if (this.stateT >= [1.6, 1.3, 1.0][p - 1]) {
            if (p >= 2 && !this.lastBreath && this._pd < 7) { this.lastBreath = true; this._enter('breathTele'); }
            else { this.lastBreath = false; this.chargesLeft = p >= 3 ? 2 : 1; this._enter('chargeTele'); }
          }
          break;
        }
        case 'chargeTele':
          this._faceHero(6, dt);
          this.rear = Math.sin(clamp(this.stateT / HH_TELE, 0, 1) * Math.PI) * 0.8;
          if (Math.floor(this.stateT * 6) !== this._pawIx) { this._pawIx = Math.floor(this.stateT * 6); this._burst('snowPuff', this.pos, 0xeaf4ff, 0.4); }
          if (this.stateT >= (this.chargesLeft < ([1, 1, 2][p - 1]) ? 0.45 : HH_TELE)) this._enter('charge');
          break;
        case 'charge': {
          this.rear = damp(this.rear, -0.35, 12, dt);
          this.walkPh += dt * 12;
          // the lip: brake and teeter rather than run straight into the sea
          const ahead = this._edgeDist(this.pos.x + this.chargeDir.x * 1.2, this.pos.z + this.chargeDir.z * 1.2);
          if (ahead < 0.1) {
            this.teeterSide = 1;
            this._enter('teeter');
            break;
          }
          if (player) this._bump(player, this.pos.x, this.pos.y + 1.0, this.pos.z, 1.45, 7, 0.45, 1.0);
          if (Math.hypot(this.vel.x, this.vel.z) < 1.5 || this.stateT > 2.0) {
            this.chargesLeft--;
            this._enter(this.chargesLeft > 0 ? 'chargeTele' : 'recover');
          }
          break;
        }
        case 'teeter':
          this.wave = Math.sin(this.stateT * 18);
          if (this.stateT >= HH_TEETER) { this.chargesLeft = 0; this._enter('recover'); }
          break;
        case 'recover': {
          this.rear = damp(this.rear, 0, 6, dt);
          // step back from the edge
          const ed = this._edgeDist(this.pos.x, this.pos.z);
          if (ed < 2.0) {
            _a.set(this.arenaC.x - this.pos.x, 0, this.arenaC.z - this.pos.z).normalize();
            this.pos.x += _a.x * 1.2 * dt; this.pos.z += _a.z * 1.2 * dt;
          }
          if (this.stateT >= 1.0) this._enter('shuffle');
          break;
        }
        case 'stagger':
          if (this.stateT >= 0.6) this._enter('shuffle');
          break;
        case 'breathTele':
          this._faceHero(4, dt);
          this.breath = smoothstep(0, 1, this.stateT / 0.9);
          if (this.stateT >= 0.9) this._enter('breath');
          break;
        case 'breath': {
          this.breath = damp(this.breath, 0, 4, dt);
          headingFrom(this.yaw, _c);
          if (Math.floor(this.stateT * 12) !== this._puffIx) {
            this._puffIx = Math.floor(this.stateT * 12);
            const r = 1.6 + this.stateT * 7;
            _a.set(this.pos.x + _c.x * r, this.pos.y + 1.2, this.pos.z + _c.z * r);
            this._burst('snowPuff', _a, 0xdff3ff, 0.9);
            this._burst('iceShard', _a, 0xcfe8ff, 0.5);
          }
          if (this._alive && !this.breathHit && player) {
            const dot = (this._pdx * _c.x + this._pdz * _c.z) / Math.max(this._pd, 1e-3);
            if (this._pd < 6.5 && dot > 0.82 && Math.abs(this._py - this.pos.y) < 2.2) { this.breathHit = true; this._hurt(player, this._pdx, this._pdz, 6, 0.45); }
          }
          if (this.stateT >= 0.8) this._enter('shuffle');
          break;
        }
        case 'fall': {
          // over the lip and into the sea
          this.dunkY -= dt * (4 + this.stateT * 18);
          this.pos.x += this.vel.x * dt * 0.5; this.pos.z += this.vel.z * dt * 0.5;
          if (this.stateT >= 0.45 && this.stateT - dt < 0.45) {
            _a.set(this.pos.x, this.floeTop - 0.4, this.pos.z);
            this._burst('splash', _a, 0x9fd8ff, 1.6);
            this._burst('iceShard', _a, 0xcfe8ff, 1);
            this._sfx('splash', _a, 0.6, 1);
            this._shake(0.25, 300);
          }
          if (this.stateT >= 1.9) {
            if (this.hp <= 0) this._down();
            else this._enter('return');
          }
          break;
        }
        case 'return': {
          const u = clamp(this.stateT / 1.1, 0, 1);
          this.pos.x = this.retFrom.x + (this.arenaC.x - this.retFrom.x) * u;
          this.pos.z = this.retFrom.z + (this.arenaC.z - this.retFrom.z) * u;
          this.dunkY = (-3.5) * (1 - u) + 4.0 * Math.sin(u * Math.PI);
          if (u >= 1) {
            this.dunkY = 0; this.vel.set(0, 0, 0);
            this._burst('snowPuff', this.pos, 0xeaf4ff, 1.6);
            this._sfx('crusher_slam', this.pos, 0.55, 1);
            this._shake(0.35, 400);
            if (this._alive && this._pgr && this._pd < 3.4) this._hurt(player, this._pdx, this._pdz, 6, 0.4);
            this._enter('enrage');
          }
          break;
        }
      }
      if (this.state === 'shuffle' && player) this._bump(player, this.pos.x, this.pos.y + 1.0, this.pos.z, 1.4, 5, 0.3, 1.0);
      // a stomp on its back shoves it
      if (this.state !== 'fall' && this.state !== 'return' && this._stompedOn(this.pos.x, this.pos.z, 1.3, this.pos.y + 2.4)) {
        this.stompCount++;
        this._push('stomp', this._px, this._pz);
      }
    }

    /** Knock it across the ice, away from (fx, fz). */
    _push(how, fx, fz) {
      if (this.state === 'fall' || this.state === 'return' || this.state === 'dormant' || this.state === 'intro' ||
          this.state === 'enrage' || this.state === 'defeat' || this.state === 'gone') return false;
      let dx = this.pos.x - fx, dz = this.pos.z - fz;
      const l = Math.hypot(dx, dz);
      if (l < 1e-3) { dx = Math.sin(this.yaw); dz = Math.cos(this.yaw); } else { dx /= l; dz /= l; }
      let v = (HH_PUSH[how] || 4) * HH_HEAVY[this.phase - 1];
      if (this.state === 'teeter') {
        // at the lip any push is enough: it goes over the nearest edge
        v = Math.max(v, 5);
        const ex = this.pos.x - this.arenaC.x, ez = this.pos.z - this.arenaC.z;
        if (Math.abs(ex) > Math.abs(ez)) { dx = dx * 0.4 + Math.sign(ex) * 0.9; dz *= 0.4; } else { dz = dz * 0.4 + Math.sign(ez) * 0.9; dx *= 0.4; }
        const n = Math.hypot(dx, dz); dx /= n; dz /= n;
      }
      this.vel.x = dx * v; this.vel.z = dz * v;
      this._sfx('bumbler_squish', this.pos, 0.55, 1);
      this._burst('snowPuff', this.pos, 0xeaf4ff, 0.9);
      this.events.emit('pushed', how, v, this);
      this._enter('stagger');
      return true;
    }

    onPound(player, pos) {
      const p = (pos && Number.isFinite(pos.x) && Number.isFinite(pos.z)) ? pos : (player && (player.pos || player.position));
      if (!p) return;
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      if (dx * dx + dz * dz > 3.2 * 3.2 || Math.abs(p.y - this.pos.y) > 3.0) return;
      this._push('pound', p.x, p.z);
    }

    onStrike(player, kind, pos) {
      const pp = pos || (player && (player.pos || player.position));
      if (!pp) return false;
      return this._push(kind === 'throw' ? 'throw' : 'strike', pp.x, pp.z);
    }

    _hurtAnim() {}
    _enrage(dt) {
      this._faceHero(3, dt);
      this.rear = 0.5 * Math.abs(Math.sin(this.stateT * 5));
    }
    _rest() { this.vel.set(0, 0, 0); }
    _afterDown() {}

    _pose(dt) {
      const t = this.time;
      const b = this.body;
      const du = this.defeatU;
      let y = this.pos.y + this.dunkY;
      if (this.state === 'defeat') {
        // it hauls itself back onto the lip, flops, waves, and melts into snow
        y = this.floeTop - 1.4 * (1 - smoothstep(0, 0.3, du));
      }
      b.position.set(this.pos.x, y, this.pos.z);
      b.rotation.set(0, this.yaw, 0);
      b.scale.setScalar(1 - 0.9 * smoothstep(0.8, 1, du));
      const flop = this.state === 'defeat' ? smoothstep(0.3, 0.5, du) : 0;
      this.torso.rotation.set(-this.rear * 0.5 + (this.state === 'charge' ? 0.3 : 0) + (this.state === 'fall' ? 0.8 : 0), 0,
        this.state === 'teeter' ? 0.12 * this.wave : 0);
      this.torso.position.y = 1.15 - 0.45 * flop + 0.1 * this.breath;
      this.torso.scale.set(1 + 0.08 * this.breath, 1 + 0.08 * this.breath, 1 + 0.05 * this.breath);
      this.head.rotation.set(-0.4 * this.breath + (this.state === 'chargeTele' ? 0.35 : 0) + 0.1 * Math.sin(t * 1.3), 0.15 * Math.sin(t * 0.8), 0);
      const walking = this.state === 'shuffle' || this.state === 'charge';
      for (let i = 0; i < 4; i++) {
        const front = (i & 2) === 0;
        const ph = this.walkPh + (i === 0 || i === 3 ? 0 : Math.PI);
        let rx = walking ? 0.45 * Math.sin(ph) : 0;
        if (this.state === 'chargeTele' && front) rx = -0.6 - 0.5 * Math.abs(Math.sin(t * 14));
        if (this.state === 'teeter' && front) rx = -1.2 + 0.9 * Math.sin(t * 16 + i);
        if (this.state === 'defeat' && i === 1) rx = -1.4 + 0.6 * Math.sin(t * 7) * smoothstep(0.5, 0.6, du);
        this.legs[i].rotation.set(rx, 0, flop * ((i & 1) ? -0.9 : 0.9));
      }
      this._lookEyes(this.eyes, 1.6);
      if (this.state === 'teeter') this.eyes.look(0.8 * Math.sin(t * 12), -0.5);
      if (this.state === 'dormant') this.eyes.look(0, -1);
      this._poseCommon(dt, y + 3.4);
    }

    _syncColliders() {
      const under = this.state === 'fall' || this.state === 'return' || this.state === 'defeat' || this.state === 'gone';
      this.col.setCenter(this.pos.x, this.pos.y + 1.2 + this.dunkY, this.pos.z);
      _q.setFromAxisAngle(UPV, this.yaw);
      this.col.quat.copy(_q);
      this.col.update();
      this.col.active = !under;
      if (this.floeCol) this.floeCol.active = true;
    }
  }

  /* =========================================================================
   * AZURE — GYRARCH, THE CLOCKWORK SUN     (ride the platforms)
   *
   *  A brass orrery-sun hovering six metres over its sanctum, out of reach.
   *  Three GEAR PLATFORMS orbit it, sinking to the floor and spiralling up and
   *  in toward it. It aims (lens red, a beam on you, 0.9 s / 0.8 / 0.7) and
   *  fires cog bolts; then it VENTS — the crown petals open, the core glows,
   *  steam pours: that is the window. Ride a gear up, jump onto its crown and
   *  POUND the core. A closed crown zaps you off.
   *  Phase 2 fires three bolts in a fan and turns faster; phase 3 adds a floor
   *  sweep ring (jump it, or be up on a gear) and shortens the vent.
   * ====================================================================== */

  /* GY_TC[2] was 6.0 s. MEASURED (arena runs 2026-10-01 08:12 and 08:48: two crown
     pounds each by 68 s / 108 s, then ~200 s of phase 3 riding a gear with NO opening)
     and modelled (the bot's gate: vent with > 0.8 s left or late 'fire', gear top within
     1.5 m of the deck): phase 3 alternates a 7.09 s sweep cycle and a 5.0 s plain one,
     12.09 s — two 6.0 s gear periods. Gear and vent RESONATE: a rider on one gear could
     wait the whole fight for his gear's peak to meet a vent (0 windows in 240 s for some
     start phases). At 5.0 s the worst wait is 17.7 s and a window recurs at least every
     20 s (phases 1-2: 14.7-18.7 s first, <= 21.3 s gaps). Faster, too: "EVERY COG, TURN". */
  const GY_PLATS = 3, GY_PLAT_HALF = 1.1, GY_RIN = 2.95, GY_TC = [8.0, 7.0, 5.0], GY_OMEGA = [0.22, 0.3, 0.38];
  const GY_TELE = [0.9, 0.8, 0.7], GY_VENT = [3.8, 3.2, 2.7], GY_BOLT_V = 11, GY_DECK = 1.05, GY_R = 1.2;

  class Gyrarch extends Boss {
    constructor(def, ctx) {
      super(def, ctx, 'gyrarch');
      this.naturalHeight = 2.6;
      this.hitRadius = 1.6;
      const d = this.def;
      this.floorY = this.groundY;
      this.hoverH = Math.max(4.5, fin(d.hover, 6.2));
      this.rout = Math.max(GY_RIN + 2.5, Math.min(this.arenaR - 1.8, 7.8));
      this.pClock = 0;
      this.platPos = new Float32Array(GY_PLATS * 3);
      this.platRefs = [];
      this.hy = 12;               // hover offset from final altitude (intro descent)
      this.ringsK = 0; this.spinA = 0; this.spinB = 0; this.petal = 0; this.core = 0.6; this.lens = 0.6; this.wobble = 0; this.sink = 0;
      this.aim = new THREE.Vector3(0, 0, 1);
      this.muzzle = new THREE.Vector3();
      this.sweepR = 0; this.sweepOn = false; this.sweepHit = false;
      this.pos.set(this.arenaC.x, this.floorY + this.hoverH, this.arenaC.z);
      this.home.copy(this.pos);
      this._build();
      this._initEmote();
      this._initPips();
      const cog = cached('sn:cog2', () => {
        const parts = [normalizeAttrs(prismGeometry(0.18, 0.07, 10, 1))];
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * TAU;
          const t = normalizeAttrs(bevelBoxGeometry(0.06, 0.06, 0.07, 0.01, 1));
          t.translate(Math.cos(a) * 0.2, 0, Math.sin(a) * 0.2);
          parts.push(t);
        }
        const g = mergeGeometries(parts, false);
        for (const p of parts) p.dispose();
        g.rotateX(Math.PI / 2);
        g.computeBoundingSphere();
        return g;
      });
      this.bolts = new ShotSet(this.rig, 3, cog, getEmissive(0xffd27a, 1.8), 'gyrBolts');
      this._adoptFlash(this._mergeGroup(this.body, 'gyrarch_body'));
      const platSkin = this._mergeGroup(this.plats, 'gyrarch_gears');
      if (platSkin) platSkin.frustumCulled = false;
      this.col = this._solidBox(this.pos.x, this.pos.y, this.pos.z, GY_R * 0.95, GY_R * 0.8, GY_R * 0.95, 'normal', null);
      this.deck = this._solidBox(this.pos.x, this.pos.y + GY_DECK - 0.2, this.pos.z, 1.15, 0.2, 1.15, 'bounce', { power: 3.0 });
      this.platCols = [];
      for (let i = 0; i < GY_PLATS; i++) {
        const ref = { linVel: new THREE.Vector3(), boss: this, gear: i };
        const c = new Collider({ center: [this.arenaC.x, this.floorY + 0.35, this.arenaC.z], half: [GY_PLAT_HALF, 0.2, GY_PLAT_HALF], surface: 'normal', group: 'critter' });
        c.ref = ref;
        this.colliders.push(c);
        this.platCols.push(c);
        this.platRefs.push(ref);
      }
      this._resetKind();
      this._pose(0);
      this._syncColliders();
      this._silent = false;
    }

    _build() {
      const brass = worldMat('copper', this.ctx);
      const steel = skinMat(0x6f7c8f, 0.35, 0.8);
      const enamel = skinMat(fin(this.def.color, 0x1f4f8a), 0.3, 0.2);
      const dark = skinMat(0x151a24, 0.5, 0.4);
      const body = pivot('body', null);
      this.orb = pivot('orb', body, 0, 0, 0);
      const op = [
        { g: ell(GY_R, 1, 0.85, 1, 0, 0, 0, 24, 16), m: enamel },
        { g: place(ringProfileGeometry(GY_R * 1.0, [0.06, 0.12, 0.03], 24, 1), 0, 0, 0), m: brass },
        { g: place(sphereGeo(GY_R * 0.55, 16, 8, 0, TAU, Math.PI * 0.55, Math.PI * 0.45), 0, -GY_R * 0.35, 0), m: steel },
        { g: place(ringProfileGeometry(0.36, [0.06, 0.06, 0.02], 16, 1), 0, 0.05, GY_R * 0.95, Math.PI / 2, 0, 0), m: brass },
        { g: place(prismGeometry(1.25, 0.14, 16, 1), 0, GY_DECK - 0.22, 0), m: steel },
      ];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU + Math.PI / 4;
        op.push({ g: place(bbox(0.08, 0.7, 0.5, 0.02), Math.cos(a) * GY_R * 1.02, -0.05, Math.sin(a) * GY_R * 1.02, 0, -a, 0), m: brass });
      }
      this.orb.add(mergeParts(op, 'orb'));
      this.eyes = makeEyes(0.11, 0.62, 0, 0.42, GY_R * 0.8, -0.3);
      this.orb.add(this.eyes.group);
      this.lensMat = glowMat(this, 0x7fe8ff, 1.5, 0x061218);
      const lens = new THREE.Mesh(place(discGeometry(0.3, 20), 0, 0.05, GY_R * 0.97, Math.PI / 2, 0, 0), this.lensMat);
      lens.castShadow = false;
      lens.name = 'lens';
      this.orb.add(lens);
      // gear rings
      const mkRing = (name, r, tilt) => {
        const p = pivot(name, body, 0, 0, 0);
        p.rotation.x = tilt;
        const inner = pivot(name + 'Spin', p, 0, 0, 0);
        const rp = [{ g: ringProfileGeometry(r, [0.09, 0.07, 0.02], 36, 1), m: brass }];
        for (let i = 0; i < 18; i++) {
          const a = (i / 18) * TAU;
          rp.push({ g: place(bbox(0.1, 0.1, 0.16, 0.02), Math.cos(a) * (r + 0.12), 0, Math.sin(a) * (r + 0.12), 0, -a, 0), m: brass });
        }
        inner.add(mergeParts(rp, name));
        return { p, inner };
      };
      this.ringA = mkRing('ringA', 1.75, 0.18);
      this.ringB = mkRing('ringB', 2.05, -0.55);
      // the crown: four petals over a core crystal
      this.petals = [];
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * TAU;
        const pv = pivot('petal' + i, body, Math.cos(a) * 0.32, GY_DECK - 0.1, Math.sin(a) * 0.32);
        pv.rotation.y = -a;
        const pp = pivot('petalHinge' + i, pv, 0, 0, 0);
        pp.add(mergeParts([{ g: place(bbox(0.48, 0.07, 0.36, 0.02), -0.26, 0.22, 0, 0, 0, -0.95), m: brass },
          { g: place(bbox(0.36, 0.05, 0.3, 0.015), -0.3, 0.24, 0, 0, 0, -0.95), m: dark }], 'petal'));
        this.petals.push(pp);
      }
      this.coreMat = glowMat(this, 0xffe08a, 2.0, 0x302408);
      const core = new THREE.Mesh(place(prismGeometry(0.2, 0.55, 6, 1), 0, GY_DECK + 0.05, 0), this.coreMat);
      core.castShadow = false;
      core.name = 'coreCrystal';
      body.add(core);
      // pendulum tail
      this.pend = pivot('pendulum', body, 0, -GY_R * 0.75, 0);
      this.pend.add(mergeParts([{ g: place(tubeGeometry(0.03, 0.03, 1.1, 6, 1), 0, -0.55, 0), m: steel }, { g: ell(0.22, 1, 1, 0.4, 0, -1.15, 0, 14, 8), m: brass }], 'pendulum'));
      this.body = body;
      this.rig.add(body);
      // the three gears (their own root, merged to one draw)
      this.plats = pivot('gears', null, 0, 0, 0);
      this.platP = [];
      const pal = this.theme && this.theme.palette;
      const lipC = pal && pal.safeEdge !== undefined ? pal.safeEdge : 0x9fe8ff;
      this.platLip = [];
      for (let i = 0; i < GY_PLATS; i++) {
        const gp = pivot('gear' + i, this.plats, 0, 0, 0);
        const gparts = [
          { g: place(prismGeometry(1.2, 0.36, 14, 1), 0, 0, 0), m: brass },
          { g: place(prismGeometry(0.38, 0.4, 10, 1), 0, 0.02, 0), m: steel },
        ];
        for (let k = 0; k < 14; k++) {
          const a = (k / 14) * TAU;
          gparts.push({ g: place(bbox(0.26, 0.3, 0.2, 0.03), Math.cos(a) * 1.28, 0, Math.sin(a) * 1.28, 0, -a, 0), m: brass });
        }
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * TAU;
          gparts.push({ g: place(bbox(0.16, 0.06, 0.8, 0.02), Math.cos(a) * 0.72, 0.19, Math.sin(a) * 0.72, 0, -a + Math.PI / 2, 0), m: dark });
        }
        gp.add(mergeParts(gparts, 'gear'));
        this.platP.push(gp);
        // lip stripe ring (own emissive draw; merges refuse hot emissive)
        const lip = new THREE.Mesh(cached('gy:lip', () => { const g = ringProfileGeometry(1.2, [0.045, 0.02, 0.008], 28, 1); g.translate(0, 0.19, 0); g.computeBoundingSphere(); return g; }), getEmissive(lipC, 1.4));
        lip.castShadow = false;
        gp.add(lip);
        this.platLip.push(lip);
      }
      this.rig.add(this.plats);
      // aim beam + floor sweep ring
      this.beamMat = glowMat(this, 0xff3a2a, 2.5, 0x200404);
      this.beam = new THREE.Mesh(cached('sn:beam2', () => { const g = normalizeAttrs(bevelBoxGeometry(0.05, 0.05, 1, 0.012, 1)); g.translate(0, 0, 0.5); g.computeBoundingSphere(); return g; }), this.beamMat);
      this.beam.castShadow = false; this.beam.visible = false; this.beam.frustumCulled = false;
      this.rig.add(this.beam);
      const swG = cached('gy:sweep', () => { const g = ringProfileGeometry(1, [0.14, 0.1, 0.03], 44, 1); g.computeBoundingSphere(); return g; });
      this.sweep = new THREE.Mesh(swG, glowMat(this, 0x7fe8ff, 3.0, 0x061218));
      this.sweep.castShadow = false; this.sweep.visible = false; this.sweep.frustumCulled = false;
      this.rig.add(this.sweep);
    }

    _bossReset() {
      this.pClock = 0; this.hy = 12; this.ringsK = 0; this.spinA = 0; this.spinB = 0; this.petal = 0; this.core = 0.6; this.lens = 0.6; this.wobble = 0; this.sink = 0;
      this.sweepR = 0; this.sweepOn = false; this.sweepHit = false; this.volleys = 0; this.didSweep = false; this.settleK = 0;
      this.pos.set(this.arenaC.x, this.floorY + this.hoverH, this.arenaC.z);
      if (this.bolts) this.bolts.clear();
      if (this.beam) this.beam.visible = false;
      if (this.sweep) this.sweep.visible = false;
      this._layPlats(0);
    }

    _clearAttacks() {
      if (this.bolts) this.bolts.clear();
      if (this.beam) this.beam.visible = false;
      this.sweepOn = false;
      if (this.sweep) this.sweep.visible = false;
    }

    /** Gear i at platform clock tc: orbit + a sink/rise that spirals in toward the crown. */
    _platAt(i, tc, out) {
      const ph = this.phase;
      const Tc = GY_TC[ph - 1];
      const u = 0.5 - 0.5 * Math.cos(TAU * (tc / Tc + i / GY_PLATS));
      const uu = u * (1 - (this.settleK || 0));
      const th = (i / GY_PLATS) * TAU + tc * GY_OMEGA[ph - 1];
      const r = this.rout + (GY_RIN - this.rout) * uu;
      out.set(this.arenaC.x + Math.cos(th) * r, this.floorY + 0.35 + uu * (this.hoverH - 0.55), this.arenaC.z + Math.sin(th) * r);
      return uu;
    }

    _layPlats(dt) {
      for (let i = 0; i < GY_PLATS; i++) {
        const k = i * 3;
        const ox = this.platPos[k], oy = this.platPos[k + 1], oz = this.platPos[k + 2];
        this._platAt(i, this.pClock, _a);
        this.platPos[k] = _a.x; this.platPos[k + 1] = _a.y; this.platPos[k + 2] = _a.z;
        const ref = this.platRefs[i];
        if (ref) {
          if (dt > 0) ref.linVel.set((_a.x - ox) / dt, (_a.y - oy) / dt, (_a.z - oz) / dt);
          else ref.linVel.set(0, 0, 0);
        }
      }
    }

    _dormant(dt) { this.hy = damp(this.hy, 12, 2, dt); this.ringsK = damp(this.ringsK, 0, 2, dt); }
    _intro(dt) {
      const u = clamp(this.stateT / this._introT(), 0, 1);
      this.hy = 12 * (1 - smoothstep(0, 0.7, u));
      this.ringsK = smoothstep(0.35, 0.9, u);
      this.lens = 0.6 + 3 * smoothstep(0.6, 0.9, u);
      if (this.stateT > 1.9 && this.stateT - dt <= 1.9) { this._burst('spark', this.pos, 0xffd27a, 1.6); this._sfx('gate_open', this.pos, 0.6, 1); }
    }
    _introT() { return 3.0; }

    _fightStart() { this._enter('idle'); }

    _onBossEnter(s) {
      if (s === 'aimTele') { this._sfx('vanish_warn', this.pos, 1.3, 0.8); this.beam.visible = true; this.beamLen = 0; }
      else if (s === 'fire') this._fire();
      else if (s === 'vent') { this._sfx('wind', this.pos, 1.2, 1); this.events.emit('vent', this); }
      else if (s === 'close') { this._sfx('crusher_slam', this.pos, 1.5, 0.7); }
      else if (s === 'sweepTele') { this._sfx('vanish_warn', this.pos, 0.6, 1); }
      else if (s === 'sweep') { this.sweepOn = true; this.sweepR = 0.8; this.sweepHit = false; this._sfx('cannon_fire', this.pos, 0.5, 0.9); }
      else if (s === 'hurt') {
        this._sfx('crusher_slam', this.pos, 0.8, 1);
        _a.set(this.pos.x, this.pos.y + GY_DECK, this.pos.z);
        this._burst('spark', _a, 0xffd27a, 1.6);
        // throw the hero off the crown
        const pl = this._player;
        if (pl && this._alive && this._py > this.pos.y + 0.4 && this._pd < 2.2) {
          this._hurt(pl, this._pdx || 1, this._pdz, 8, 0.5);
          if (pl.vel && pl.vel.y < 7) pl.vel.y = 7;
        }
      }
    }

    _fire() {
      this.beam.visible = false;
      const n = this.phase >= 2 ? 3 : 1;
      for (let j = 0; j < n; j++) {
        const i = this.bolts.free();
        if (i < 0) break;
        const spread = n === 1 ? 0 : (j - 1) * 0.28;
        const cs = Math.cos(spread), sn = Math.sin(spread);
        const ax = this.aim.x * cs - this.aim.z * sn, az = this.aim.x * sn + this.aim.z * cs;
        this.bolts.fire(i, this.muzzle.x, this.muzzle.y, this.muzzle.z, ax * GY_BOLT_V, this.aim.y * GY_BOLT_V, az * GY_BOLT_V, 2.0);
      }
      this._sfx('cannon_fire', this.muzzle, 1.5, 0.7);
      this._burst('spark', this.muzzle, 0xffd27a, 0.8);
      this.volleys = (this.volleys || 0) + 1;
    }

    _aim() {
      headingFrom(this.yaw, _c);
      this.muzzle.set(this.pos.x + _c.x * GY_R, this.pos.y + 0.05, this.pos.z + _c.z * GY_R);
      this.aim.set(this._px - this.muzzle.x, this._py + 0.85 - this.muzzle.y, this._pz - this.muzzle.z);
      if (this.aim.lengthSq() < 1e-6) this.aim.set(_c.x, 0, _c.z);
      this.aim.normalize();
    }

    /** The gears are the arena: they turn in every state, and settle to the floor once it is down. */
    _always(dt) {
      if (this.state !== 'dormant' || this.introduced) this.pClock += dt;
      const down = this.state === 'defeat' || this.state === 'gone';
      this.settleK = damp(this.settleK || 0, down ? 1 : 0, 1.5, dt);
      this._layPlats(dt);
    }

    _fight(dt, player) {
      this._player = player;
      const p = this.phase;
      this.pos.y = this.floorY + this.hoverH + 0.18 * Math.sin(this.time * 1.4);
      switch (this.state) {
        case 'idle':
          this._faceHero(2, dt);
          this.petal = damp(this.petal, 0, 8, dt);
          this.lens = damp(this.lens, 1.2, 4, dt);
          if (this.stateT >= 0.8) {
            if (p >= 3 && this.volleys > 0 && !this.didSweep) { this.didSweep = true; this._enter('sweepTele'); }
            else { this.didSweep = false; this._enter('aimTele'); }
          }
          break;
        case 'aimTele':
          this._faceHero(5, dt);
          if (this.stateT < GY_TELE[p - 1] - 0.25) this._aim();
          this.lens = 1.5 + 3.5 * clamp(this.stateT / GY_TELE[p - 1], 0, 1);
          this.beamLen = Math.min(24, (this.beamLen || 0) + dt * 40);
          if (this.stateT >= GY_TELE[p - 1]) this._enter('fire');
          break;
        case 'fire':
          if (this.stateT >= 0.35) this._enter('vent');
          break;
        case 'vent':
          this.petal = damp(this.petal, 1, 7, dt);
          this.core = 3 + 1.5 * Math.sin(this.stateT * 9);
          if (Math.floor(this.stateT * 4) !== this._steamIx) {
            this._steamIx = Math.floor(this.stateT * 4);
            _a.set(this.pos.x, this.pos.y + GY_DECK + 0.4, this.pos.z);
            this._burst('dust', _a, 0xf2f6ff, 0.7);
          }
          if (this.stateT >= GY_VENT[p - 1]) this._enter('close');
          break;
        case 'close':
          this.petal = damp(this.petal, 0, 14, dt);
          this.core = damp(this.core, 0.8, 6, dt);
          if (this.stateT >= 0.45) this._enter('idle');
          break;
        case 'sweepTele':
          this.core = 1 + 2 * Math.abs(Math.sin(this.stateT * 14));
          if (this.stateT >= 0.8) this._enter('sweep');
          break;
        case 'sweep':
          this.sweepR += dt * 8.5;
          if (this._alive && !this.sweepHit && player && this._py < this.floorY + 0.7) {
            const dx = this._px - this.arenaC.x, dz = this._pz - this.arenaC.z, d = Math.hypot(dx, dz);
            if (Math.abs(d - this.sweepR) < 0.5) { this.sweepHit = true; this._hurt(player, dx, dz, 6, 0.4); }
          }
          if (this.sweepR >= this.arenaR) { this.sweepOn = false; this._enter('aimTele'); }
          break;
      }
      if (this.state !== 'vent') this.core = damp(this.core, 0.8, 3, dt);
      this._stepBolts(dt, player);
      // a closed crown zaps a lander
      if (this.state !== 'vent' && this._stompedOn(this.pos.x, this.pos.z, 1.35, this.pos.y + GY_DECK)) {
        this.stompCount++;
        this._sfx('step_metal', this.pos, 1.8, 0.8);
        this._burst('spark', _a.set(this._px, this._py, this._pz), 0x7fe8ff, 0.9);
        if (player && this.hitCd <= 0) { this.hitCd = 0.8; this._hurt(player, this._pdx || 1, this._pdz, 6, 0.3); }
      }
      /* touching its SIDES shoves; a hero standing on (or pounding down onto) the
         crown is above the body, not in it. Measured in the arena 2026-10-01: the
         body sphere (r 1.26 + the capsule's 0.38) reached 0.2 m above the deck
         top, so the shove fired on every landing and the core was unreachable. */
      if (player && this._py < this.pos.y + GY_DECK - 0.45) this._bump(player, this.pos.x, this.pos.y, this.pos.z, GY_R * 1.05, 6, 0.3, 1.0);
    }

    _stepBolts(dt, player) {
      const S = this.bolts;
      S.step(dt, 0);
      for (let i = 0; i < S.n; i++) {
        if (!S.on[i]) continue;
        const k = i * 3;
        _a.set(S.p[k], S.p[k + 1], S.p[k + 2]);
        let end = S.t[i] >= S.life[i] || _a.y < this.floorY - 0.2;
        if (!end && this._alive && player && capsuleHitsSphere(capsuleOf(player), _a.x, _a.y, _a.z, 0.25)) {
          this._hurt(player, S.v[k], S.v[k + 2], 6, 0.35);
          end = true;
        }
        if (end) { this._burst('spark', _a, 0xffd27a, 0.6); S.kill(i); }
      }
      S.write(12);
    }

    onPound(player, pos) {
      if (this.state !== 'vent' && this.state !== 'close') return;
      const pp = player && (player.pos || player.position);
      const p = (pos && Number.isFinite(pos.x)) ? pos : pp;
      if (!p) return;
      const dx = p.x - this.pos.x, dz = p.z - this.pos.z;
      if (dx * dx + dz * dz > 1.5 * 1.5) return;
      if (p.y < this.pos.y + GY_DECK - 0.5 || p.y > this.pos.y + GY_DECK + 1.2) return;
      this._hitBoss('pound');
    }

    onStrike(player, kind, pos) {
      if (this.state !== 'vent' || !pos) return false;
      const dx = pos.x - this.pos.x, dz = pos.z - this.pos.z;
      if (dx * dx + dz * dz > 1.6 * 1.6 || pos.y < this.pos.y + GY_DECK - 0.6) return false;
      return this._hitBoss(kind || 'strike');
    }

    _hurtAnim(dt) {
      this.wobble = 1 - clamp(this.stateT / this._hurtT(), 0, 1);
      this.petal = damp(this.petal, 0, 18, dt);
      this.core = 4 * Math.abs(Math.sin(this.stateT * 25));
      this.pos.y = this.floorY + this.hoverH + 0.6 * Math.sin(this.stateT * 9) * this.wobble;
    }

    _enrage(dt) {
      this.lens = 2 + 2 * Math.abs(Math.sin(this.stateT * 8));
      this.pos.y = damp(this.pos.y, this.floorY + this.hoverH, 4, dt);
    }

    _rest() { this._clearAttacks(); this.petal = 0; }

    _pose(dt) {
      const t = this.time;
      const b = this.body;
      const du = this.defeatU;
      if (this.state === 'defeat') this.sink = smoothstep(0.1, 0.8, du);
      const y = this.pos.y + this.hy - this.sink * (this.hoverH - 1.0);
      b.position.set(this.pos.x, y, this.pos.z);
      b.rotation.set(0.25 * this.wobble * Math.sin(t * 17), this.yaw + (this.state === 'hurt' ? this.stateT * 14 : 0), 0.25 * this.wobble * Math.cos(t * 13) + 0.3 * this.sink);
      b.scale.setScalar(1 - 0.9 * smoothstep(0.85, 1, du));
      const fast = 1 + 0.6 * (this.phase - 1) + (this.state === 'enrage' ? 2 : 0);
      this.spinA += (dt || 0) * 0.9 * fast * (1 - this.sink);
      this.spinB -= (dt || 0) * 0.6 * fast * (1 - this.sink);
      this.ringA.inner.rotation.y = this.spinA;
      this.ringB.inner.rotation.y = this.spinB;
      const rk = Math.max(0.001, this.ringsK * (1 - smoothstep(0.2, 0.6, du)) + (this.state === 'defeat' ? 0.3 * smoothstep(0.2, 0.6, du) * 0 : 0));
      this.ringA.p.scale.setScalar(rk);
      this.ringB.p.scale.setScalar(Math.max(0.001, rk));
      for (let i = 0; i < this.petals.length; i++) this.petals[i].rotation.z = -1.25 * this.petal;
      this.pend.rotation.set(0.35 * Math.sin(t * 2.1), 0, 0.25 * Math.sin(t * 1.7));
      this.coreMat.emissiveIntensity = this.core * (this.state === 'defeat' ? 1 - du : 1);
      this.lensMat.emissiveIntensity = this.lens * (this.state === 'defeat' ? 1 - du : 1);
      this.lensMat.emissive.setHex(this.state === 'aimTele' || this.state === 'fire' ? 0xff3a2a : 0x7fe8ff);
      // gears
      for (let i = 0; i < GY_PLATS; i++) {
        const k = i * 3;
        this.platP[i].position.set(this.platPos[k], this.platPos[k + 1], this.platPos[k + 2]);
        this.platP[i].rotation.y = this.pClock * (i & 1 ? -0.7 : 0.7);
      }
      // aim beam
      if (this.beam.visible) {
        headingFrom(this.yaw, _c);
        this.muzzle.set(this.pos.x + _c.x * GY_R, y + 0.05, this.pos.z + _c.z * GY_R);
        this.beam.position.copy(this.muzzle);
        _q.setFromUnitVectors(ZV, this.aim);
        this.beam.quaternion.copy(_q);
        const locked = this.stateT >= GY_TELE[this.phase - 1] - 0.25;
        const w = locked ? 1.8 + 0.8 * Math.sin(t * 60) : 1;
        this.beam.scale.set(w, w, Math.max(0.01, this.beamLen || 0));
        this.beamMat.emissiveIntensity = locked ? 5 : 2.5;
      }
      if (this.sweepOn) {
        this.sweep.visible = true;
        this.sweep.position.set(this.arenaC.x, this.floorY + 0.12, this.arenaC.z);
        this.sweep.scale.set(this.sweepR, 1, this.sweepR);
      } else this.sweep.visible = false;
      this._lookEyes(this.eyes, 0.4);
      this._poseCommon(dt, y + 2.6);
    }

    _syncColliders() {
      const y = this.pos.y + this.hy - this.sink * (this.hoverH - 1.0);
      const alive = this.state !== 'gone' && this.state !== 'defeat';
      this.col.setCenter(this.pos.x, y, this.pos.z);
      this.col.active = alive && this.state !== 'dormant';
      this.deck.setCenter(this.pos.x, y + GY_DECK - 0.2, this.pos.z);
      this.deck.surface = this.state === 'vent' || this.state === 'close' ? 'normal' : 'bounce';
      this.deck.active = alive && this.state !== 'dormant';
      for (let i = 0; i < GY_PLATS; i++) {
        const k = i * 3;
        this.platCols[i].setCenter(this.platPos[k], this.platPos[k + 1], this.platPos[k + 2]);
        this.platCols[i].active = true;
      }
    }

    _afterDown() {
      // the gears keep turning, settled at the floor, so the crest is reachable
      this._setColliders(false);
      for (let i = 0; i < GY_PLATS; i++) this.platCols[i].active = true;
    }
  }

  const classes = { Boss, Bramblehide, Slagmaw, Hoarhorn, Gyrarch };
  const factories = {
    bramblehide: (def, ctx) => new Bramblehide(def, ctx),
    slagmaw: (def, ctx) => new Slagmaw(def, ctx),
    hoarhorn: (def, ctx) => new Hoarhorn(def, ctx),
    gyrarch: (def, ctx) => new Gyrarch(def, ctx),
  };
  return { factories, classes };
}
