// Colosseum — the sim -> view bridge.
//
// The combat simulation knows nothing about THREE, and that is deliberate: it
// is what makes the fight deterministic and networkable. The cost of that
// choice is that SOMETHING has to translate fighter state into things you can
// look at. This is that something, and it is the only file allowed to read the
// sim and write the scene.
//
// It does three jobs:
//   1. gives every combat Fighter a visible Actor, pooled and reused
//   2. drives that Actor's animation from the fighter's PHASE, not from
//      guesswork — a windup plays the attack wind, a stagger plays the hit,
//      death plays once and clamps
//   3. turns combat events into things on the sand: blood into the damage
//      layer, sparks off a parried blade, dust where someone dodges
//
// Keeping this one-directional (sim writes, view reads) is what stops the
// classic bug where a visual effect quietly changes gameplay.

import * as THREE from "three";
import { PHASE } from "../sim/combat.js";
import { Actor, attachWeapon, makeGladius, makeScutum, makeTrident } from "./actors.js";
import { Equipment } from "./equipment.js";
import { ARMATURA_ROSTER } from "../data/roster.js";
import { damp, clamp } from "../core/util.js";

/**
 * Where in each attack clip the blade actually connects, as a fraction of the
 * clip's own duration.
 *
 * Measured in headless Blender off peak hand extension from the body, not
 * guessed. Every archetype ships byte-identical clips (one MD5 each across all
 * eight), so one table covers the roster.
 *
 * This is the number the view needs and never had — `grep` for
 * strikeframe|strike_frame|contactframe|impactframe|hitframe across the whole
 * game returned zero hits before this. Without it there is no way to line a
 * 3.2-second animation up with a 0.2-second windup, and the old code did not
 * try: it stretched the clip across the window and saturated its own clamp.
 */
const STRIKE_FRAC = {
  slash1: 0.365,
  slash2: 0.435,
  attack: 0.400,   // beast lunge
  finisher: 0.500,
};

/** Which procedural weapon mesh a weapon id gets. */
const WEAPON_MESH = {
  gladius: makeGladius, spatha: makeGladius, sica: makeGladius,
  dimachaerus: makeGladius, trident: makeTrident, hasta: makeTrident,
  // The practice sword reuses the gladius mesh — same shape, same length; the
  // difference is that it is oak, which the vertex colours carry.
  rudis: makeGladius,
};

export class BoutView {
  /**
   * @param {THREE.Scene} scene
   * @param {object} libs { fighter, beasts: {id: lib} }
   * @param {object} deps { sand, crowd, gates, hypogeum, vfx }
   */
  constructor(scene, libs, deps = {}) {
    this.scene = scene;
    this.libs = libs;
    this.deps = deps;
    this.actors = new Map();       // fighterId -> { actor, fighter, equipment }
    this.corpses = [];
    this._lastPhase = new Map();
    this._attackFlip = new Map();
    // fighter id -> { clip, until } — how much real time is left in the swing
    // that is currently playing, so RECOVER can hold it to its follow-through.
    this._swing = new Map();
  }

  // -- population -----------------------------------------------------------

  /**
   * Give a combat Fighter a body. Beasts use their own library; humans get the
   * gladiator body plus visible kit derived from their loadout.
   */
  spawn(fighter, role = "opponent") {
    if (this.actors.has(fighter.id)) return this.actors.get(fighter.id);

    let actor;
    if (fighter.isBeast) {
      const lib = this.libs.beasts && (this.libs.beasts[fighter.beast?.id] || this.libs.beasts.tiger);
      if (!lib) return null;
      actor = new Actor(lib, {
        length: 2.05, name: fighter.id, restClip: "Idle",
        clipMap: { idle: "Idle_Lie Prone", walk: "Walk", run: "Run", attack: "Attack", hit: "Howl", death: "Eat" },
      });
    } else {
      // Each armatura has its OWN generated body — a retiarius is bare-chested
      // with a shoulder guard, a crupellarius is encased in iron. Falling back
      // to a shared body only happens if that armatura has not been generated.
      const lib = (fighter.armaturaId && this.libs.armaturae && this.libs.armaturae[fighter.armaturaId])
        || this.libs.fighter;
      if (!lib) return null;
      actor = new Actor(lib, { height: 1.82, name: fighter.id });
      // Visible kit straight from the sim's loadout — what the fight uses is
      // what you see.
      const eq = new Equipment(actor);
      const arm = ARMATURA_ROSTER[fighter.armaturaId] || null;
      eq.applyLoadout({ armour: fighter.armour, crestColor: arm ? arm.helmetCrest : 0x8e2f22 });
      actor.equipment = eq;

      const maker = WEAPON_MESH[fighter.weaponId] || makeGladius;
      attachWeapon(actor, maker(), { palm: 0.055 });
      if (fighter.shieldId && fighter.shieldId !== "none") {
        const small = fighter.shieldId === "parmula";
        attachWeapon(actor, makeScutum(small ? { w: 0.46, h: 0.48, curve: 0.11 } : {}), {
          bone: /LeftHand|Hand_L/i, palm: 0.04, align: "shield",
        });
      }
    }

    actor.pos.set(fighter.x, 0, fighter.z);
    actor.facing = fighter.facing;
    actor.visualFacing = fighter.facing;
    actor.play("idle");
    this.scene.add(actor.root);

    const rec = { actor, fighter, role };
    this.actors.set(fighter.id, rec);
    return rec;
  }

  despawn(id) {
    const rec = this.actors.get(id);
    if (!rec) return;
    rec.actor.dispose();
    this.actors.delete(id);
  }

  clear() {
    for (const id of [...this.actors.keys()]) this.despawn(id);
    this.corpses.length = 0;
  }

  // -- per-frame ------------------------------------------------------------

  /**
   * @param {number} dt        real seconds
   * @param {number} timeScale sim time-scale (kill slow-motion). The sim has
   *   ALREADY scaled its own step by this; the mixer had not, so during the
   *   1.05 s slow-motion the sim ran at 0.35x while every body animated at
   *   1.0x — a 2.9x desync at the exact moment the camera drops to 1.9 m to
   *   watch the kill. Both of the game's impact features were implemented and
   *   invisible.
   */
  update(dt, timeScale = 1) {
    for (const rec of this.actors.values()) {
      const f = rec.fighter;
      const a = rec.actor;

      // Position and facing come straight from the sim.
      a.pos.set(f.x, 0, f.z);
      a.facing = f.facing;
      a.speed = f.speed;

      this._driveAnimation(rec, dt);
      // A fighter in hit-stop is FROZEN in the sim (combat.js:218 returns
      // early with speed 0). Freezing the mixer too is what turns a hit from
      // a number into a felt impact — 0.04 rather than 0 so the pose still
      // settles a hair instead of hard-locking, which reads as a dropped frame.
      const ts = (f.hitStop > 0 ? 0.04 : 1) * timeScale;
      a.update(dt * ts, f.speed);
    }
  }

  /**
   * Map the fighter's PHASE onto a clip. Driving from phase rather than from
   * events means the visual can never drift out of sync with the sim — if the
   * fighter is in RECOVER, the body is recovering, full stop.
   */
  _driveAnimation(rec, dt) {
    const f = rec.fighter;
    const a = rec.actor;
    const prev = this._lastPhase.get(f.id);
    const changed = prev !== f.phase;
    this._lastPhase.set(f.id, f.phase);

    if (!f.alive) {
      if (changed) {
        a.playOnce("death", { then: null, fade: 0.12 });
        this.corpses.push({ id: f.id, x: f.x, z: f.z, t: 0 });
      }
      return;
    }

    switch (f.phase) {
      case PHASE.WINDUP:
        if (changed) {
          // Alternate the two slash clips so a flurry does not look looped.
          const flip = (this._attackFlip.get(f.id) || 0) ^ 1;
          this._attackFlip.set(f.id, flip);
          const clip = f.isBeast ? "attack" : (flip ? "slash2" : "slash1");
          const dur = a.clipDuration(clip) || 1;
          // Align the clip's STRIKE FRAME with the frame the sim resolves
          // damage on — the end of windup.
          //
          // The old line stretched the clip across windup+active with
          // clamp(dur/total, 0.5, 3.0). Measured across all 12 weapon x clip
          // combinations the raw ratio runs 3.48 to 14.55, so EVERY one
          // saturated the 3.0 ceiling and the stretch never adapted to any
          // weapon at all. The result: slash2's blade arrived 157-337 ms after
          // the damage, slash1's arrived up to 252 ms before it, and because
          // the two alternate the same weapon swung 389 ms differently on
          // consecutive attacks.
          const strikeAt = dur * (STRIKE_FRAC[clip] ?? 0.4);
          const ts = clamp(strikeAt / Math.max(0.05, f.weapon.windup), 0.5, 14);
          a.playOnce(clip, { timeScale: ts, then: null, fade: 0.05 });
          // Remember it so RECOVER can let the follow-through finish rather
          // than cutting to idle mid-swing.
          this._swing.set(f.id, { clip, until: (dur / ts) });
        }
        break;

      case PHASE.STAGGER:
        if (changed) a.playOnce("hit", { then: null, fade: 0.05 });
        break;

      case PHASE.DODGE:
        if (changed) a.play("run", { fade: 0.08, timeScale: 1.6 });
        break;

      case PHASE.RECOVER: {
        // Let the swing land and follow through.
        //
        // RECOVER used to fall through to IDLE, which cross-faded the attack
        // out over 0.18 s. Only 20.6-41.3% of slash2 was ever shown, and it sat
        // at roughly 17% blend weight at its own strike frame — the blade
        // genuinely never visibly connected. Holding the clip until it has run
        // past its strike, then blending out, is the whole difference between
        // a swing and a twitch.
        const sw = this._swing.get(f.id);
        if (sw) {
          sw.until -= dt;
          if (sw.until > 0) break;          // still swinging — leave it alone
          this._swing.delete(f.id);
        }
        // fall through to locomotion once the follow-through is done
      }
      // eslint-disable-next-line no-fallthrough
      case PHASE.IDLE: {
        // Locomotion by ground speed. The actor's own foot-slide correction
        // handles the timeScale.
        const s = f.speed;
        if (s > 2.4) a.play("run");
        else if (s > 0.25) a.play("walk");
        else if (f.blocking && a.hasClip("parry")) a.play("parry", { fade: 0.14 });
        else a.play("idle");
        break;
      }
      default: break;
    }
  }

  // -- combat events -> the world -------------------------------------------

  /**
   * Route one combat event into visible/audible consequence. Called from the
   * match's onEvent hook.
   */
  /**
   * A visible flinch, scaled to the blow.
   *
   * anim_hit.glb is 4.700 s in every archetype and was played at timeScale 1
   * against a stagger of 0.45-0.85 s, so the player saw the first ~10% of it —
   * and the clip is back-loaded, with its peak-motion frame at t = 4.700 s,
   * i.e. 100%. Only 4.9% of the clip's total motion falls inside the first
   * 0.45 s. You were being shown the least eventful tenth of a reaction.
   *
   * Compressing it to a real flinch duration means the whole shape of the
   * reaction plays inside the window the sim allows. Harder hits flinch longer
   * and slower; a graze is a twitch.
   */
  _flinch(rec, damage) {
    const a = rec.actor;
    const f = rec.fighter;
    if (!f.alive || !a.hasClip("hit")) return;
    // Never interrupt a death or a full stagger — those own the body.
    if (f.phase === PHASE.STAGGER || f.phase === PHASE.DODGE) return;
    const dur = a.clipDuration("hit") || 1;
    const weight = clamp(damage / 35, 0.35, 1);      // graze .35 -> heavy 1.0
    const window = 0.20 + weight * 0.22;             // 0.20 s .. 0.42 s
    a.playOnce("hit", { timeScale: dur / window, then: null, fade: 0.04 });
    // The swing map must forget this fighter or RECOVER would try to hold a
    // swing that the flinch has already replaced.
    this._swing.delete(f.id);
  }

  onEvent(e) {
    const { sand, crowd, vfx } = this.deps;
    const rec = e.target ? this.actors.get(e.target) : null;
    const at = rec ? rec.actor : null;

    switch (e.type) {
      case "swing": {
        // Draw the blade's path. Only for weapons that actually sweep — a
        // one-target weapon flicking an arc every swing would be visual noise,
        // and the arc's job is to teach the player that THIS weapon reaches
        // more than one man.
        if (vfx && e.cleave > 1) {
          vfx.cleaveArc(new THREE.Vector3(e.x, 1.15, e.z), e.facing, e.reach, e.arc);
        }
        break;
      }
      case "hit": {
        // Blood goes into the persistent damage layer, so the arena keeps a
        // record of the fight rather than a puff that vanishes.
        if (sand) {
          sand.splat(e.x, e.z, e.heavy ? 0.55 : 0.32, "blood", e.heavy ? 0.9 : 0.55);
          sand.splat(e.x, e.z, 0.7, "scuff", 0.3);
        }
        if (vfx) vfx.blood(new THREE.Vector3(e.x, e.heavy ? 1.25 : 1.05, e.z), e.heavy ? 1.4 : 0.8);
        if (crowd) crowd.react(e.heavy ? 0.5 : 0.22);
        // FLINCH ON THE EVENT, not on the phase.
        //
        // combat.js only writes PHASE.STAGGER when a hit interrupts a WINDUP
        // (combat.js:466). The plain-hit path sets hitStop and comboCount and
        // no phase at all, and _driveAnimation plays "hit" solely on STAGGER —
        // so a blow landing on a target who was idle, moving or recovering
        // produced NO body reaction whatsoever. Measured: 188 of 337 landed
        // hits across 40 seeded bouts, 56%. Targets read as training dummies.
        //
        // Reacting here covers every landed hit regardless of phase, and
        // re-triggers on each one so a combo keeps flinching instead of going
        // still after the first (the phase-change guard made repeats invisible).
        if (rec) this._flinch(rec, e.damage || 0);
        break;
      }
      case "block":
      case "parry": {
        if (at && vfx) {
          const p = at.root.position.clone();
          p.y = 1.15;
          vfx.sparks(p, e.type === "parry" ? 1.3 : 0.8);
        }
        if (crowd && e.type === "parry") crowd.react(0.4);
        break;
      }
      case "shield_break":
      case "guard_break": {
        if (at && vfx) vfx.sparks(at.root.position.clone().setY(1.1), 1.8);
        if (crowd) crowd.react(0.65);
        break;
      }
      case "dodge": {
        const r = this.actors.get(e.id);
        if (r && vfx) vfx.dust(r.actor.root.position.clone(), 0.7);
        if (sand) sand.splat(r ? r.actor.pos.x : 0, r ? r.actor.pos.z : 0, 0.55, "scuff", 0.4);
        break;
      }
      case "death": {
        if (sand) {
          sand.splat(e.x, e.z, 1.05, "blood", 1.0);
          sand.splat(e.x, e.z, 1.5, "scuff", 0.5);
        }
        if (vfx) vfx.blood(new THREE.Vector3(e.x, 0.9, e.z), 2.2);
        if (crowd) { crowd.react(1.0); crowd.startWave({ laps: 1, speed: 3.2, strength: 1 }); }
        break;
      }
      default: break;
    }
  }

  /** Drag a corpse toward the Porta Libitinaria, leaving a trail. */
  dragCorpses(dt, exitPoint) {
    const { sand } = this.deps;
    for (const c of this.corpses) {
      const rec = this.actors.get(c.id);
      if (!rec || !exitPoint) continue;
      c.t += dt;
      if (c.t < 1.2) continue;                       // let the body settle first
      const a = rec.actor;
      const dx = exitPoint.x - a.pos.x;
      const dz = exitPoint.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 1.2) continue;
      const step = Math.min(d, 2.4 * dt);
      const nx = a.pos.x + (dx / d) * step;
      const nz = a.pos.z + (dz / d) * step;
      if (sand) sand.splat(nx, nz, 0.3, "blood", 0.42);
      a.pos.set(nx, 0, nz);
      a.root.position.copy(a.pos);
    }
  }

  stats() {
    return {
      actors: this.actors.size,
      corpses: this.corpses.length,
      byRole: [...this.actors.values()].reduce((m, r) => { m[r.role] = (m[r.role] || 0) + 1; return m; }, {}),
    };
  }
}

// ---------------------------------------------------------------------------
// Combat camera
// ---------------------------------------------------------------------------

/**
 * Frames the player and the nearest threat together — the classic arena-fighter
 * camera. It pulls back as they separate so both stay on screen, and it never
 * snaps: every value is damped, because a camera that teleports makes a fight
 * unreadable.
 */
export class CombatCamera {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 3, 8);
    this.look = new THREE.Vector3(0, 1.1, 0);
    this.dist = 7.5;
    this.height = 2.9;
    this.yaw = 0;
    this.shake = 0;
    this.enabled = false;
  }

  /** Add camera shake. Impacts call this; it decays on its own. */
  addShake(amount) { this.shake = Math.min(1.4, this.shake + amount); }

  /**
   * The direction the camera LOOKS — player toward foe. This is the frame that
   * player input must be rotated into, and it is the OPPOSITE of `yaw`.
   *
   * Getting these two confused inverted the game's forward axis: boot.js fed
   * `yaw` (which points from the foe out to the player, i.e. where the rig
   * sits) into `input.command({cameraYaw})`, so W drove the player along
   * foe->player — away from the man trying to kill them — and S walked them in.
   *
   * It also mirrored the attack system, because input.js derives thrust/cut by
   * comparing the movement vector against this same angle: pushing toward the
   * enemy registered as pushing away, so "forward = thrust" resolved backwards.
   */
  get lookYaw() { return this.yaw + Math.PI; }

  /**
   * @param {THREE.Vector3|null} playerPos
   * @param {THREE.Vector3|null} foePos
   */
  update(dt, playerPos, foePos, { slowMo = 0 } = {}) {
    if (!this.enabled || !playerPos) return;

    const mid = playerPos.clone();
    let sep = 0;
    if (foePos) {
      mid.add(foePos).multiplyScalar(0.5);
      sep = playerPos.distanceTo(foePos);
      // `yaw` is where the camera SITS: the direction from the foe out to the
      // player, so the rig lands behind the player's shoulder.
      this.yaw = damp(this.yaw, Math.atan2(playerPos.x - foePos.x, playerPos.z - foePos.z), 3.0, dt);
    }

    // Pull back as the fighters separate so both stay framed.
    const wantDist = clamp(6.2 + sep * 0.55, 6.2, 13.5);
    this.dist = damp(this.dist, wantDist, 2.6, dt);
    // Drop lower and tighter during slow motion — the kill should feel close.
    const wantHeight = slowMo > 0 ? 1.9 : 2.9;
    this.height = damp(this.height, wantHeight, 2.2, dt);

    const target = new THREE.Vector3(
      mid.x + Math.sin(this.yaw) * this.dist,
      this.height,
      mid.z + Math.cos(this.yaw) * this.dist
    );
    this.pos.x = damp(this.pos.x, target.x, 4.5, dt);
    this.pos.y = damp(this.pos.y, target.y, 4.5, dt);
    this.pos.z = damp(this.pos.z, target.z, 4.5, dt);

    this.look.x = damp(this.look.x, mid.x, 6, dt);
    this.look.y = damp(this.look.y, 1.15, 6, dt);
    this.look.z = damp(this.look.z, mid.z, 6, dt);

    // Shake is applied AFTER the smooth solve so it never fights the damping.
    this.shake = Math.max(0, this.shake - dt * 3.2);
    const s = this.shake * this.shake * 0.22;
    this.camera.position.set(
      this.pos.x + (Math.random() - 0.5) * s,
      this.pos.y + (Math.random() - 0.5) * s,
      this.pos.z + (Math.random() - 0.5) * s
    );
    this.camera.lookAt(this.look);
  }
}
