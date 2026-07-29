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
import { PHASE, FEEL } from "../sim/combat.js";
import { Actor, attachWeapon, makeGladius, makeScutum, makeTrident, makeLance } from "./actors.js";
import { makeWeapon } from "./props.js";
import { Equipment, findBone } from "./equipment.js";
import { ARMATURA_ROSTER } from "../data/roster.js";
import { damp, clamp } from "../core/util.js";

/**
 * Where in each attack clip the blade actually connects, as a fraction of the
 * clip's own duration.
 *
 * Measured by sampling the blade axis through each clip and testing it against
 * the sim's own hit cone — NOT off "peak hand extension", which is what the
 * first version of this comment claimed while shipping numbers that did not
 * match it. Every archetype ships byte-identical clips (one MD5 each across all
 * eight), so one table covers the roster.
 *
 * This is the number the view needs and never had — `grep` for
 * strikeframe|strike_frame|contactframe|impactframe|hitframe across the whole
 * game returned zero hits before this. Without it there is no way to line a
 * 3.2-second animation up with a 0.2-second windup, and the old code did not
 * try: it stretched the clip across the window and saturated its own clamp.
 */
const STRIKE_FRAC = {
  // RE-MEASURED against the clips themselves, by sampling the blade axis and
  // testing it against the sim's OWN hit cone (combat.js halfAngle 0.62 rad).
  //
  // The previous values were attributed to "peak hand extension" and were not
  // that. slash1 shipped at 0.365: a 200-sample sweep puts peak extension at
  // 0.41-0.44 by all four metrics (from hips, spine, shoulder, and forward of
  // hips), and 0.365 fell in the one narrow gap, 0.280-0.410, where the blade
  // is OUTSIDE the cone — so the sim resolved damage with the sword still
  // cocked back at bearing -143 deg, behind the fighter. At 0.42 it reads
  // bearing -12.1, elevation +3.5: forward and level.
  //
  // slash2 shipped at 0.435, which put the blade past the cone before ACTIVE
  // even opened; its true pass is 0.249.
  slash1: 0.414,
  slash2: 0.249,
  // Authored clips: the strike frame is DESIGNED, not excavated — thrust
  // punches level at f14/36, cleave passes the centreline at f22/43.
  thrust: 0.39,
  cleave: 0.51,
  attack: 0.400,   // beast lunge
  finisher: 0.500,
};

// Per-species beast clip vocabularies. The tiger map on a panther played
// NOTHING (its clips are lowercase and differently named). The panther ships
// no attack or death clip; its pounce ("jump regular") is the attack and
// "sits" stands in for the death — flagged, not hidden: a real death clip is
// an asset gap, and a seated collapse reads better than a T-posed statue.
const BEAST_CLIPS = {
  tiger: { idle: "Idle_Lie Prone", walk: "Walk", run: "Run", attack: "Attack", hit: "Howl", death: "Eat" },
  panther: { idle: "idle", walk: "walk regular", run: "run", attack: "jump regular", hit: "idle", death: "sits" },
  // The aurochs — same animal pack as the warhorse, so the clip names match
  // that convention. Headbutt IS the charge strike.
  bison: { idle: "Idle", walk: "Walk", run: "Gallop", attack: "Attack_Headbutt", hit: "Idle_HitReact_Left", death: "Death" },
};

// Quadrupeds are sized by BODY LENGTH (nose to tail-base), per species. One
// hardcoded 2.05 m made every animal tiger-sized — an aurochs at house-cat
// scale is the opposite of the bout's promise.
const BEAST_LENGTH = { tiger: 2.05, panther: 1.8, bison: 2.7 };

// ---------------------------------------------------------------------------
// WOUNDS ON THE BODY. The sim has tracked four-zone wounds all along and the
// fighter stayed pristine while a blood pool spread under him — the audit's
// "clean bodies" gap, and the RTF feature veterans still cite. Each wound
// level attaches one dark clotted patch to the zone's bone (the same
// bone-attachment idea the armour uses), so damage accumulates VISIBLY and
// reads at gameplay distance. Cleared with the actor at bout end.
// ---------------------------------------------------------------------------
const WOUND_ANCHORS = {
  head: { bone: /^Head$/i, offsets: [[0.07, 0.02, 0.05], [-0.06, 0.05, 0.03], [0.02, 0.09, -0.05]] },
  torso: { bone: /^Spine01$/i, offsets: [[0.09, 0.05, 0.1], [-0.1, -0.02, 0.09], [0.03, 0.1, -0.11]] },
  arms: { bone: /^RightForeArm$/i, offsets: [[0.03, 0.1, 0.03], [-0.02, 0.18, -0.02], [0.03, 0.05, -0.03]] },
  legs: { bone: /^RightUpLeg$/i, offsets: [[0.05, 0.15, 0.04], [-0.04, 0.28, 0.03], [0.04, 0.08, -0.05]] },
};
const WOUND_MAT = new THREE.MeshStandardMaterial({
  color: 0x4a0d08, roughness: 0.55, metalness: 0.05, name: "wound",
});

function makeWoundPatch(scale = 1) {
  const geo = new THREE.SphereGeometry(0.045 * scale, 7, 5);
  geo.scale(1, 0.45, 1);
  const m = new THREE.Mesh(geo, WOUND_MAT);
  m.name = "wound_patch";
  return m;
}

/** The rope dome an entangled fighter wears — one wireframe mesh, no cost. */
function makeNetDome() {
  const geo = new THREE.SphereGeometry(0.95, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x6b5636, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.name = "net_dome";
  m.scale.set(1, 1.75, 1);
  m.position.y = 0.12;
  return m;
}

// Scratch for the exhaustion lean — per-frame, never allocated in the loop.
const _leanQ = new THREE.Quaternion();
const _leanRight = new THREE.Vector3();

// Scratch for _seatRider — per-frame, never allocated in the loop.
const _tmpRight = new THREE.Vector3();
const _tmpFwd = new THREE.Vector3();
const _tmpQ = new THREE.Quaternion();
const _tmpPQ = new THREE.Quaternion();

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
      // per-species clip vocabularies — staged files name their clips
      // differently, and the tiger map on a panther plays nothing.
      fighter._clipMap = BEAST_CLIPS[fighter.beast && fighter.beast.id] || BEAST_CLIPS.tiger;
    }
    if (fighter.mounted && fighter.mountId) {
      // A RIDER IS A COMPOSITE: the horse is the Actor the sim drives (pos,
      // facing, gallop), and the rider's body sits in the saddle as a child of
      // the horse's root, animated by its own mixer. The joust sim owns both
      // riders; Combat never runs while they are mounted.
      const mlib = this.libs.mounts && this.libs.mounts[fighter.mountId];
      const rlib = (fighter.armaturaId && this.libs.armaturae && this.libs.armaturae[fighter.armaturaId])
        || (this.libs.armaturae && this.libs.armaturae.eques) || this.libs.fighter;
      if (!mlib || !rlib) return null;
      actor = new Actor(mlib, {
        length: 2.35, name: fighter.id + "_mount", restClip: "idle",
        clipMap: { idle: "Idle", walk: "Walk", run: "Gallop", death: "Death", hit: "Idle_HitReact_Left" },
      });
      const rider = new Actor(rlib, { height: 1.82, name: fighter.id });
      // Saddle: MEASURED off the live rig, not guessed. The warhorse's Back
      // bone sits at local (0, 1.25, -0.58) with the neck base at (0, 1.16,
      // +0.60), so the seat is the top of that line just behind the withers.
      // The rider actor's origin is at his FEET and no seated clip exists, so
      // he is sunk to put his hips at saddle height — legs clip the barrel at
      // close range, which is the honest price of no riding pose yet (flagged),
      // and reads correctly at gameplay distance. The first guess (height*0.72
      // = y 1.43) floated him a forearm above the horse.
      // Seated: _seatRider folds the legs, so the root (at the feet-frame)
      // sinks until the pelvis meets the saddle line at ~1.25.
      rider.root.position.set(0, 0.34, 0.10);
      actor.root.add(rider.root);
      rider.play("idle");
      // The couched lance. A fixed pitch is tolerable here because the joust
      // uses ONE rider body; the per-bone-roll solves stay off (the guard
      // po se memos are nulled so _swordGuard/_guardPose skip these arms).
      attachWeapon(rider, makeLance(), { palm: 0.05, rotation: [Math.PI / 2 - 0.10, 0, 0.10] });
      attachWeapon(rider, makeScutum({ w: 0.46, h: 0.48, curve: 0.11 }), {
        bone: /LeftHand|Hand_L/i, palm: 0.04, align: "shield",
      });
      rider._swordMount = null;
      rider._shieldArm = null;
      actor.pos.set(fighter.x, 0, fighter.z);
      actor.facing = fighter.facing;
      actor.visualFacing = fighter.facing;
      actor.play("idle");
      this.scene.add(actor.root);
      const rec = { actor, rider, fighter, role, mounted: true };
      this.actors.set(fighter.id, rec);
      this._buildTilt();
      return rec;
    }
    if (fighter.isBeast) {
      const lib = this.libs.beasts && (this.libs.beasts[fighter.beast?.id] || this.libs.beasts.tiger);
      if (!lib) return null;
      actor = new Actor(lib, {
        length: BEAST_LENGTH[fighter.beast?.id] || 2.05, name: fighter.id, restClip: "Idle",
        clipMap: fighter._clipMap || BEAST_CLIPS.tiger,
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
      // Prop-backed blade when its GLB is streamed in, procedural otherwise.
      attachWeapon(actor, makeWeapon(fighter.weaponId, maker), { palm: 0.055 });
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
    if (this._tilt) { this._tilt.removeFromParent(); this._tilt = null; }
    if (this._ground) { for (const m of this._ground.values()) m.removeFromParent(); this._ground.clear(); }
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
    if (this._pools && this._pools.length && this.deps.sand) {
      const STAMPS = [[0.6, 0.55, 0.6], [1.4, 0.85, 0.5], [2.6, 1.15, 0.45]];
      for (let i = this._pools.length - 1; i >= 0; i--) {
        const p = this._pools[i];
        p.t += dt;
        if (p.next < STAMPS.length && p.t >= STAMPS[p.next][0]) {
          const [, r, str] = STAMPS[p.next++];
          this.deps.sand.splat(p.x, p.z, r, "blood", str);
        }
        if (p.next >= STAMPS.length) this._pools.splice(i, 1);
      }
    }
    for (const rec of this.actors.values()) {
      const f = rec.fighter;
      const a = rec.actor;

      // CEREMONY BEATS ARE CHOREOGRAPHED, NOT IDLED THROUGH. The AAA audit's
      // finding: 4.4 s of ENTRY, the salute, and the verdict were text
      // banners over motionless bodies. boot feeds the match state in via
      // `this.ceremony`; during those beats the view drives the bodies
      // itself (walk-in from the gates, salute to the box, the victor's
      // raised weapon) and hands back to the sim untouched at FIGHT.
      if (this.ceremony && this._ceremonyDrive(rec, dt)) continue;

      // Position and facing come straight from the sim.
      a.pos.set(f.x, 0, f.z);
      a.facing = f.facing;
      a.speed = f.speed;
      // The guard pose reads this: which line the shield actually covers.
      a.blockDir = f.blocking ? f.blockDir : null;

      if (rec.mounted) { this._driveMounted(rec, dt); continue; }
      this._driveAnimation(rec, dt);
      // (pool stamps are advanced once per update(), outside this loop)
      // Telegraphs ride their attacker (the lunge moves him during windup)
      // and die the moment the swing does.
      if (this.deps.vfx) {
        if (f.phase === PHASE.WINDUP) this.deps.vfx.moveTelegraph(f.id, f.x, f.z, f.facing);
        else if (f.phase === PHASE.ACTIVE) this.deps.vfx.resolveTelegraph(f.id);
        else if (f.phase === PHASE.STAGGER || f.phase === PHASE.IDLE) this.deps.vfx.killTelegraph(f.id);
        // The net cast's cone rides its caster the same way a swing's does.
        if (f.netWindupT > 0) this.deps.vfx.moveTelegraph(`net_${f.id}`, f.x, f.z, f.facing);
      }
      // ENTANGLED: a rope dome hangs on the body for the duration — the
      // sim's netT is the truth (survives event loss), the slow spin sells
      // the mesh settling.
      if (f.netT > 0) {
        if (!rec._netMesh) {
          rec._netMesh = makeNetDome();
          a.root.add(rec._netMesh);
        }
        rec._netMesh.rotation.y += dt * 0.5;
      } else if (rec._netMesh) {
        rec._netMesh.removeFromParent();
        rec._netMesh = null;
      }
      // A fighter in hit-stop is FROZEN in the sim (combat.js:218 returns
      // early with speed 0). Freezing the mixer too is what turns a hit from
      // a number into a felt impact — 0.04 rather than 0 so the pose still
      // settles a hair instead of hard-locking, which reads as a dropped frame.
      const ts = (f.hitStop > 0 ? 0.04 : 1) * timeScale;
      a.update(dt * ts, f.speed);

      // Wounds accumulate on the body; exhaustion bends it. Both run AFTER
      // the mixer has written this frame's pose.
      this._syncWounds(rec);
      this._exhaustLean(rec, dt);
    }
  }

  /** Attach a clotted patch per wound level per zone — see WOUND_ANCHORS. */
  _syncWounds(rec) {
    const f = rec.fighter;
    if (f.isBeast || !f.wounds) return;
    rec._wounds = rec._wounds || { head: 0, torso: 0, arms: 0, legs: 0 };
    for (const zone in WOUND_ANCHORS) {
      const lvl = Math.min(3, f.wounds[zone] | 0);
      while (rec._wounds[zone] < lvl) {
        const n = rec._wounds[zone]++;
        const spec = WOUND_ANCHORS[zone];
        const bone = findBone(rec.actor.model, spec.bone);
        if (!bone) { rec._wounds[zone] = lvl; break; }
        bone.updateWorldMatrix(true, false);
        _tmpQ.identity();
        const s = new THREE.Vector3();
        bone.matrixWorld.decompose(new THREE.Vector3(), _tmpQ, s);
        const counter = s.x > 1e-4 ? 1 / s.x : 1;
        const m = makeWoundPatch(1 + n * 0.35);
        const o = spec.offsets[Math.min(n, spec.offsets.length - 1)];
        m.position.set(o[0] * counter, o[1] * counter, o[2] * counter);
        m.scale.setScalar(counter);
        bone.add(m);
      }
    }
  }

  /**
   * The gassed fighter BENDS — a small forward pitch plus a breathing sway,
   * applied additively after the mixer so every rig keeps its own pose. The
   * axis is the actor's world RIGHT expressed in the bone's frame (Meshy
   * bone rolls are arbitrary, so a bone-local X pitch would tip a different
   * way on every body). Suppressed mid-swing; eases in and out.
   */
  _exhaustLean(rec, dt) {
    const f = rec.fighter;
    if (f.isBeast || !f.alive || rec.mounted) return;
    if (rec._spine === undefined) rec._spine = findBone(rec.actor.model, /^Spine02$/i) || null;
    if (!rec._spine) return;
    const gassed = f.stamina < FEEL.exhaustedThreshold &&
      f.phase !== PHASE.WINDUP && f.phase !== PHASE.ACTIVE;
    const target = gassed ? 0.12 : 0;
    rec._lean = (rec._lean || 0) + (target - (rec._lean || 0)) * Math.min(1, dt * 2.5);
    if (rec._lean > 0.004) {
      const breathe = Math.sin(performance.now() * 0.005) * 0.025 * (rec._lean / 0.12);
      _leanRight.set(Math.cos(rec.actor.facing), 0, -Math.sin(rec.actor.facing));
      rec._spine.getWorldQuaternion(_tmpQ).invert();
      _leanRight.applyQuaternion(_tmpQ).normalize();
      _leanQ.setFromAxisAngle(_leanRight, rec._lean + breathe);
      rec._spine.quaternion.multiply(_leanQ);
    }
  }

  /**
   * Drive one actor through a ceremony beat. Returns true if this actor was
   * handled (the caller skips the sim-mirror path for this frame).
   *
   * ENTRY: walk in from the gate — the player's side through the Porta
   * Triumphalis, the opposition through the far mouth — arriving settled on
   * the sim's own marks a beat before the horn. SALUTE: face the editor's
   * box and raise the guard once. VERDICT: the survivor turns to the box and
   * raises the blade overhead (the slow cleave windup reads as triumph at
   * every camera distance). Beasts and mounts keep their own language; the
   * dead keep dying.
   */
  _ceremonyDrive(rec, dt) {
    const c = this.ceremony;
    const f = rec.fighter, a = rec.actor;
    if (!c || rec.mounted || f.isBeast || !f.alive) return false;

    // A virtual editor's box on the north rim — the salute's audience.
    const boxFacing = Math.atan2(0 - f.x, 24 - f.z);

    if (c.state === "entry") {
      if (!rec._entry) {
        const gate = f.team === 0 ? "triumphalis" : "libitinaria";
        const gp = this.deps.gates ? this.deps.gates.entryPoint(gate, 2.2) : null;
        rec._entry = { sx: gp ? gp.x : f.x, sz: gp ? gp.z : f.z };
      }
      const p = Math.min(1, Math.max(0, (c.t - 0.35) / 3.4));   // settle before the horn
      const e = p * p * (3 - 2 * p);
      const dx = f.x - rec._entry.sx, dz = f.z - rec._entry.sz;
      a.pos.set(rec._entry.sx + dx * e, 0, rec._entry.sz + dz * e);
      const walking = p > 0.01 && p < 0.99 && Math.hypot(dx, dz) > 0.5;
      a.facing = walking ? Math.atan2(dx, dz) : f.facing;
      a.locoDir = 1;
      a.play(walking ? "walk" : "idle");
      a.update(dt, walking ? 1.5 : 0);
      return true;
    }
    if (c.state === "salute") {
      a.pos.set(f.x, 0, f.z);
      a.facing = boxFacing;
      if (!rec._saluted) {
        rec._saluted = true;
        if (a.hasClip("parry")) a.playOnce("parry", { timeScale: 0.55 });
      }
      a.update(dt, 0);
      return true;
    }
    if (c.state === "verdict") {
      a.pos.set(f.x, 0, f.z);
      a.facing = boxFacing;
      if (!rec._triumphed) {
        rec._triumphed = true;
        if (a.hasClip("cleave")) a.playOnce("cleave", { timeScale: 0.42 });
      }
      a.update(dt, 0);
      return true;
    }
    return false;
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
        // A man killed mid-windup keeps that phase forever, so his telegraph
        // would be re-anchored every frame and never resolve — a fan left
        // burning on the sand for the rest of the bout.
        if (this.deps.vfx) {
          this.deps.vfx.dropTelegraph(f.id);
          this.deps.vfx.dropTelegraph(`net_${f.id}`);
        }
      }
      return;
    }

    switch (f.phase) {
      case PHASE.WINDUP:
        if (changed) {
          // CLIP CHOICE READS THE WEAPON AND THE DIRECTION.
          //
          // This line used to be `flip ? "slash2" : "slash1"` — f.weaponId and
          // f.attackDir were never consulted, so a trident thrust, a spatha
          // cleave, a sica hook and a gladius jab all rendered the identical
          // alternating one-hand slash: the sim's whole directional layer had
          // zero visual output. Only two authored attack clips exist, so the
          // mapping spends them where they read strongest:
          //   THRUST (and every polearm blow) -> slash1, whose motion is the
          //     tighter, more linear of the pair — with the lunge underneath it
          //     reads as a jab, not an arc. (No speed bias: the strike frame
          //     must stay aligned with the sim's damage tick.)
          //   HIGH heavies and cleaving weapons  -> slash2, the big arc.
          //   LEFT/RIGHT cuts -> the matching-side clip of the pair.
          // Authored per-weapon sets remain the real fix (audit rank 3); this
          // makes the input visibly matter with the art that exists today.
          const kind = f.weapon ? f.weapon.kind : "sword";
          const dirName = f.attackDir;
          let clip;
          if (f.isBeast) clip = "attack";
          // The AUTHORED verbs land first; the slash pair is the fallback for
          // any archetype dir that lacks the new files.
          else if ((kind === "polearm" || dirName === "thrust") && a.hasClip("thrust")) clip = "thrust";
          else if ((dirName === "high" || (f.weapon && f.weapon.cleave > 1)) && a.hasClip("cleave")) clip = "cleave";
          else if (kind === "polearm" || dirName === "thrust") clip = "slash1";
          else if (dirName === "high" || (f.weapon && f.weapon.cleave > 1)) clip = "slash2";
          else if (dirName === "left") clip = "slash1";
          else if (dirName === "right") clip = "slash2";
          else {
            // No direction (AI default): alternate so a flurry does not loop.
            const flip = (this._attackFlip.get(f.id) || 0) ^ 1;
            this._attackFlip.set(f.id, flip);
            clip = flip ? "slash2" : "slash1";
          }
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
          // ALIGN TO THE WINDUP THE SIM ACTUALLY USES, NOT THE TABLE VALUE.
          //
          // This divided by the RAW f.weapon.windup, but combat.js _windup()
          // returns weapon.windup * mods.windup * (1 + clamp(wounds.arms*0.18,
          // 0, 0.6)), and the hit resolves ceil(windup/dt)+1 ticks after the
          // phase edge. Neither the attribute/training modifier nor the tick lag
          // was here, so the view and the sim disagreed by -150 ms to +33 ms
          // across the game's own modifier range — and NO STRIKE_FRAC table can
          // be right for more than one fighter state while that is true. Fixing
          // the denominator is what makes the table mean something.
          const strikeAt = dur * (STRIKE_FRAC[clip] ?? 0.4);
          const simWind = f.weapon.windup * (f.mods ? f.mods.windup : 1) *
                          (1 + clamp((f.wounds ? f.wounds.arms : 0) * 0.18, 0, 0.6));
          const ts = clamp(strikeAt / Math.max(0.05, simWind + 2 / 60), 0.5, 14);
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
        //
        // DIRECTION matters, not just magnitude: the sim's spacer/flanker AI
        // backpedals and circles by design, and selecting on speed alone
        // played the FORWARD walk while the body slid backwards — a fighter
        // giving ground moonwalked, every bout. Until authored strafe clips
        // exist, a backward mover plays the walk cycle REVERSED (the clip
        // carries a Hips.position track, so timeScale -1 reverses the whole
        // gait, feet planting in the direction of travel).
        const s = f.speed;
        a.locoDir = (s > 0.25 &&
          (f.vx * Math.sin(f.facing) + f.vz * Math.cos(f.facing)) < -0.1) ? -1 : 1;
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

  /**
   * The tilt barrier — the long list fence the riders pass on opposite sides
   * of. Real tilts were timber with a cloth drape; this one is posts, two
   * rails and a hanging skirt, running the length of the lanes at z = 0.
   * Built once when the first rider spawns, removed with the bout.
   */
  _buildTilt() {
    if (this._tilt) return;
    const g = new THREE.Group();
    g.name = "tilt_barrier";
    const wood = new THREE.MeshStandardMaterial({ color: 0x6d5236, roughness: 0.9 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0x8e2f22, roughness: 0.95, side: THREE.DoubleSide });
    const len = 60;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.14), wood);
    rail.position.y = 1.15; g.add(rail);
    const rail2 = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.12), wood);
    rail2.position.y = 0.55; g.add(rail2);
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.62), cloth);
    skirt.rotation.y = Math.PI / 2 * 0; skirt.position.y = 0.84; g.add(skirt);
    for (let x = -len / 2; x <= len / 2; x += 6) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 1.25, 8), wood);
      post.position.set(x, 0.62, 0);
      g.add(post);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(g);
    this._tilt = g;
  }

  /**
   * SEAT the rider — a procedural riding pose, since no seated clip exists.
   *
   * The shared idle clip leaves the legs straight, which read as a man
   * standing on (or through) his horse. Each frame, AFTER the rider's mixer
   * has written the clip pose, the thighs are folded forward ~78 deg about the
   * horse's right axis, splayed ~16 deg outward so they straddle the barrel,
   * and the shins folded back ~74 deg — the classic deep seat. World-axis
   * rotations, same technique as _spineFlex, because these Meshy bones carry
   * arbitrary local roll that per-bone Euler guesses cannot survive.
   */
  _seatRider(rec) {
    const rider = rec.rider, horse = rec.actor;
    let B = rec._seatBones;
    if (B === undefined) {
      const find = (n) => { let b = null; rider.model.traverse((o) => { if (!b && o.isBone && o.name === n) b = o; }); return b; };
      B = rec._seatBones = {
        lu: find("LeftUpLeg"), ru: find("RightUpLeg"),
        ll: find("LeftLeg"), rl: find("RightLeg"),
      };
    }
    if (!B.lu || !B.ru) return;
    const yaw = horse.visualFacing;
    _tmpRight.set(Math.cos(yaw), 0, -Math.sin(yaw));         // horse's right
    _tmpFwd.set(Math.sin(yaw), 0, Math.cos(yaw));            // horse's forward
    const rot = (bone, axis, rad) => {
      if (!bone) return;
      _tmpQ.setFromAxisAngle(axis, rad);
      bone.parent.getWorldQuaternion(_tmpPQ);
      bone.quaternion.premultiply(_tmpPQ.clone().invert().multiply(_tmpQ).multiply(_tmpPQ));
      bone.updateMatrixWorld(true);
    };
    rider.model.updateMatrixWorld(true);
    rot(B.lu, _tmpRight, -1.36); rot(B.lu, _tmpFwd, -0.28);
    rot(B.ru, _tmpRight, -1.36); rot(B.ru, _tmpFwd, 0.28);
    rot(B.ll, _tmpRight, 1.30);
    rot(B.rl, _tmpRight, 1.30);
  }

  /**
   * Drive a horse-and-rider composite. The horse carries the locomotion —
   * Gallop when the sim says run, Idle at the marks — and the rider's mixer
   * ticks so he breathes in the saddle. On an unhorse the rider leaves the
   * saddle for the sand and plays his death there; the horse runs on, which
   * is what loose horses do.
   */
  _driveMounted(rec, dt) {
    const f = rec.fighter, a = rec.actor;
    a.pos.set(f.x, 0, f.z);
    a.facing = f.facing;
    if (!f.mounted && !rec.dismounted) {
      // unhorsed THIS frame: rider to the ground, horse keeps going
      rec.dismounted = true;
      const w = new THREE.Vector3();
      rec.rider.root.getWorldPosition(w);
      a.root.remove(rec.rider.root);
      this.scene.add(rec.rider.root);
      rec.rider.root.position.set(f.x, 0, f.z);
      rec.rider.playOnce("death", { then: null, fade: 0.1 });
    }
    if (f.alive || rec.dismounted) {
      a.play(f.speed > 2 ? "run" : "idle");
    }
    a.update(dt, f.speed);
    if (rec.rider && rec.rider.mixer) {
      rec.rider.mixer.update(dt);
      if (!rec.dismounted) this._seatRider(rec);
    }
  }

  /**
   * The blade STOPS on impact instead of sweeping through.
   *
   * The sim already halts the exchange (stagger/hit-stop), but the view kept
   * playing the swing clip to completion, so a blocked sword visibly passed
   * through the shield and out the far side — the single clearest "no contact"
   * tell in the whole fight. On any block, parry or blade-clash the attacker's
   * swing is cut at the moment of contact and replaced with a short recoil
   * (the hit clip driven fast), which reads as the weapon rebounding off what
   * it struck.
   */
  _reboundSwing(rec) {
    const a = rec.actor, f = rec.fighter;
    if (!f.alive || !a.hasClip("hit")) return;
    const dur = a.clipDuration("hit") || 1;
    a.playOnce("hit", { timeScale: dur / 0.26, then: null, fade: 0.03 });
    this._swing.delete(f.id);
  }

  onEvent(e) {
    const { sand, crowd, vfx } = this.deps;
    const rec = e.target ? this.actors.get(e.target) : null;
    const at = rec ? rec.actor : null;

    switch (e.type) {
      case "swing": {
        // GROUND TELEGRAPH: every committed attack draws its landing zone on
        // the sand at the moment of commit — border first, fill sweeping out
        // across the REAL windup, flash on the active frames. Built from the
        // sim's own reach and half-angle, so a cleave shows its whole 132-deg
        // fan, a thrust its narrow lane, and the player (and the enemy's
        // victim) can read exactly where the blow will land and when.
        if (vfx) {
          vfx.telegraph(e.id, {
            x: e.x, z: e.z, facing: e.facing,
            reach: e.reach, arc: e.arc,
            windupT: e.windupT, activeT: e.activeT,
            mine: e.team === 0,
          });
        }
        // The sweeping blade-path flourish stays for cleaving weapons.
        if (vfx && e.cleave > 1) {
          vfx.cleaveArc(new THREE.Vector3(e.x, 1.15, e.z), e.facing, e.reach, e.arc);
        }
        break;
      }
      case "net_throw": {
        // The cast telegraphs exactly like a blow: its cone on the sand, red
        // for a hostile netman, sweeping over the real windup. The telegraph
        // rides the caster via the per-frame block below.
        if (vfx) {
          vfx.telegraph(`net_${e.id}`, {
            x: e.x, z: e.z, facing: e.facing,
            reach: e.reach, arc: e.arc,
            windupT: e.windupT, activeT: 0.12,
            mine: e.team === 0,
          });
        }
        break;
      }
      case "net_hit": {
        if (vfx) {
          vfx.resolveTelegraph(`net_${e.attacker}`);
          vfx.net(new THREE.Vector3(e.x, 1.0, e.z));
        }
        if (crowd) crowd.react(0.5);
        break;
      }
      case "net_miss": {
        if (vfx) vfx.killTelegraph(`net_${e.id}`);
        break;
      }
      case "weapon_drop": {
        // The blade lies where it fell. The held mesh vanishes from the hand
        // (the fighter is visibly empty-handed until he stands over it).
        const mesh = makeWeapon(e.weaponId, WEAPON_MESH[e.weaponId] || makeGladius);
        mesh.rotation.set(Math.PI / 2, 0, Math.random() * Math.PI * 2);
        mesh.position.set(e.x, 0.06, e.z);
        mesh.name = `ground_${e.id}`;
        this.scene.add(mesh);
        this._ground = this._ground || new Map();
        this._ground.set(e.id, mesh);
        const drec = this.actors.get(e.id);
        if (drec) drec.actor.model.traverse((o) => {
          if (o.name === "weapon_mount" && o.parent && /^RightHand$/i.test(o.parent.name)) o.visible = false;
        });
        if (sand) sand.splat(e.x, e.z, 0.5, "scuff", 0.5);
        break;
      }
      case "weapon_pickup": {
        const g = this._ground && this._ground.get(e.id);
        if (g) { g.removeFromParent(); this._ground.delete(e.id); }
        const prec = this.actors.get(e.id);
        if (prec) prec.actor.model.traverse((o) => {
          if (o.name === "weapon_mount" && o.parent && /^RightHand$/i.test(o.parent.name)) o.visible = true;
        });
        break;
      }
      case "hit": {
        // Blood goes into the persistent damage layer, so the arena keeps a
        // record of the fight rather than a puff that vanishes.
        if (sand) {
          sand.splat(e.x, e.z, e.heavy ? 0.55 : 0.32, "blood", e.heavy ? 0.9 : 0.55, e.castDir ?? null);
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
        // Spark at the CONTACT, not at the defender's centre: midway between
        // the two fighters at shield height is where the blade actually met
        // the board.
        const atkRec = e.attacker ? this.actors.get(e.attacker) : null;
        if (at && vfx) {
          const p = at.root.position.clone();
          if (atkRec) p.lerp(atkRec.actor.root.position, 0.5);
          p.y = 1.15;
          vfx.sparks(p, e.type === "parry" ? 1.3 : 0.8);
        }
        // The attacker's blade rebounds off the shield instead of passing
        // through it.
        if (atkRec) this._reboundSwing(atkRec);
        if (crowd && e.type === "parry") crowd.react(0.4);
        break;
      }
      case "joust_shield":
      case "joust_body": {
        if (vfx) vfx.sparks(new THREE.Vector3(e.x, 1.7, e.z), e.type === "joust_body" ? 1.6 : 1.0);
        if (crowd) crowd.react(e.type === "joust_body" ? 0.5 : 0.3);
        break;
      }
      case "joust_unhorse": {
        if (vfx) { vfx.sparks(new THREE.Vector3(e.x, 1.5, e.z), 2.0); vfx.dust(new THREE.Vector3(e.x, 0.4, e.z), 1.6); }
        if (sand) sand.splat(e.x, e.z, 1.1, "scuff", 0.8);
        if (crowd) { crowd.react(1.0); crowd.startWave({ laps: 1, speed: 3.0, strength: 1 }); }
        break;
      }
      case "clash": {
        // Steel on steel: both blades stop, both fighters recoil, sparks at
        // the bind point. This is the sword-on-sword contact the sim now
        // detects in _resolveSwing.
        const ra = this.actors.get(e.a), rb = this.actors.get(e.b);
        if (vfx) vfx.sparks(new THREE.Vector3(e.x, 1.25, e.z), 1.5);
        if (ra) this._reboundSwing(ra);
        if (rb) this._reboundSwing(rb);
        if (crowd) crowd.react(0.35);
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
        // THE EXECUTION. anim_finisher.glb shipped in every character, sat in
        // the clip tables and the strike-timing map, and was triggered by
        // NOTHING — every kill in a 32-bout career was the same slow-mo over
        // a generic swing (the AAA audit's best impact-per-lift finding).
        // The killer, if standing over the kill, sells the blow the sim just
        // resolved: playOnce falls back to idle when the clip is absent, and
        // beasts keep their own kill language.
        const killer = e.by && this.actors.get(e.by);
        if (killer && !killer.mounted && killer.actor && !killer.fighter.isBeast &&
            killer.fighter.alive && killer.actor.hasClip && killer.actor.hasClip("finisher")) {
          const kd = Math.hypot(killer.fighter.x - e.x, killer.fighter.z - e.z);
          if (kd < 2.6) killer.actor.playOnce("finisher", { fade: 0.06 });
        }
        if (sand) {
          sand.splat(e.x, e.z, 1.05, "blood", 1.0);
          sand.splat(e.x, e.z, 1.5, "scuff", 0.5);
        }
        // The pool: a body keeps bleeding. Three staged stamps of growing
        // radius deepen additively into one dark spreading stain.
        this._pools = this._pools || [];
        this._pools.push({ x: e.x, z: e.z, t: 0, next: 0 });
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
