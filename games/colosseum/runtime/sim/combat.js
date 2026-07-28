// Colosseum — the combat simulation.
//
// DESIGN INTENT: weighty, directional, readable. A swing is not instant — it
// has a windup you can see, an active window that actually reaches, and a
// recovery you get punished during. Everything a player can respond to happens
// over a legible number of frames.
//
// DETERMINISM / MULTIPLAYER: this module touches no THREE.js, no DOM and no
// wall-clock time. It advances on a fixed dt from an explicit command struct
// and derives all randomness from a seeded generator carried in state. Two
// machines fed the same commands produce the same fight, which is what makes
// an authoritative server possible later without a rewrite.

import { WEAPONS, SHIELDS, ZONES, DIR, mobility, zoneMultiplier } from "../data/weapons.js";
import { clamp, mulberry32, angleDelta, ellipseNorm, clampToEllipse } from "../core/util.js";
import { ARENA } from "../data/arena_spec.js";

/** Attack phases. */
export const PHASE = {
  IDLE: "idle",
  WINDUP: "windup",
  ACTIVE: "active",
  RECOVER: "recover",
  STAGGER: "stagger",
  DODGE: "dodge",
  DEAD: "dead",
};

// Tunables that shape the feel. Grouped so they can be swept in one place.
export const FEEL = {
  // A blocked hit still costs stamina; block enough and your guard breaks.
  //
  // 0.9 (was 0.55): retuned with the measured-motion swing cycles. At 1.5-2.25 s
  // between blows the defender regenerates 6+ stamina per exchange even at the
  // blocking penalty, so at 0.55 a held scutum absorbed ~20 gladius blows
  // (30+ s) before breaking — turtling became sustainable again, which is the
  // stalemate this economy exists to prevent. At 0.9 a held guard fails in ~8
  // committed blows (~12 s of sustained pressure), while a TIMED block inside
  // the parry window still costs nothing — holding is expensive, timing is
  // free, which is the skill curve.
  blockStaminaCost: 0.9,
  guardBreakStagger: 0.85,       // seconds
  // Landing a hit inside the enemy's WINDUP interrupts it — this is what makes
  // trading feel like fencing rather than two people mashing.
  interruptOnWindup: true,
  hitStopSeconds: 0.085,         // frozen frames on a solid connect
  hitStopHeavy: 0.14,
  // A perfectly timed block (within this window of the hit) costs no stamina
  // and staggers the attacker instead.
  //
  // 0.19 (was 0.25, was 0.16): 0.16 was measured UNREACHABLE — blocks timed
  // into the final 0.13 s of windup produced 0 parries in ~25 blocks, because
  // the hit resolves on the first ACTIVE tick while command lag keeps the
  // guard down. 0.25 fixed that and then overshot: the persona playtest
  // measured a deliberately-late guard converting 100% of guarded exchanges
  // (73 parries, 0 plain blocks) and novices with 400 ms reaction delay
  // harvesting 30 accidental parries — parry had become the default outcome
  // of guarding rather than a timing achievement. 0.19 keeps the deliberate
  // read comfortably inside every >=0.43 s telegraph while halving what a
  // random late block scoops up; direction-matching gates the rest.
  parryWindow: 0.19,
  parryStagger: 0.7,
  // Steel meets steel: two committed attacks arriving together bind and both
  // fighters rebound. See the clash block in _resolveSwing.
  clashStagger: 0.32,
  clashStamina: 6,
  clashCooldown: 1.2,   // a pair that just bound resolves its next exchange
  dodgeIFrames: 0.28,
  dodgeDuration: 0.42,
  dodgeStamina: 22,
  backstabMultiplier: 1.7,       // hit from behind
  flankMultiplier: 1.25,
  // Beasts vs shields — see _applyHit. A charge sometimes goes straight over
  // the rim, and blocking one drains far more than blocking a sword.
  beastBypass: 0.30,
  beastBlockCost: 2.6,
  // ATTACK LUNGE — a swing steps into the blow instead of being thrown from a
  // standstill. Without this the defender simply backs out of every windup;
  // measured, 67% of active frames had the target beyond reach and only 6 of 30
  // swings landed. See the lunge block in _stepFighter for the full numbers.
  lungeSpeedMult: 0.95,          // of the fighter's own walk speed
  lungeStopFraction: 0.80,       // stop at 80% of reach — never walk through them
  lungeAcquireReach: 2.1,        // commit cone: how far out a target can be claimed
  lungeAcquireArc: 0.9,          // radians, half-angle
  // Stamina gates: you cannot attack with nothing left.
  minAttackStamina: 6,
  exhaustedThreshold: 15,
  exhaustedSpeedMult: 0.62,
  // --- skill-expression layer (persona-playtest fixes, 2026-07-28) ---------
  // POISE: an interrupt only lands in the EARLY part of a windup, and a
  // fighter who was just interrupted gets brief immunity. Measured without
  // these: swing-spam interrupt-staggered every enemy windup (68 interrupts
  // in 30 bouts) so no AI ever completed a swing against a masher — pure
  // aggression beat timed play at every tier below champion.
  interruptWindow: 0.45,      // fraction of windup during which a hit interrupts
  interruptImmunity: 1.6,     // s of hyper-armour after being interrupted
  // RIPOSTE: a DIRECTION-MATCHED block or a parry hands the defender a short
  // window in which the AI counter-attacks with poise (see ai.js). This is
  // what turns "the enemy blocked your spam" into "the enemy punished your
  // spam" — 44 foe blocks + 5 parries previously produced ZERO consecutive
  // return hits. The cooldown keeps it a THREAT rather than a metronome:
  // granted on every block, a same-skill attacker measured ZERO landed hits
  // in 15 s against one defender — a wall, not a skill curve.
  riposteWindow: 0.9,
  riposteCooldown: 2.2,
  // WEAPON GUARD: blocking without a shield (blade/haft). Direction-matched
  // ONLY — the blade has to actually be there — at a stamina premium, and
  // parry-eligible. This is the verb t1 exists to teach; it was silently
  // inert (~1000 held-block ticks -> 0 blocking ticks in the novice matrix)
  // because blocking was hard-gated on carrying a shield.
  weaponGuardCostMult: 1.6,
  // A dodged beast lunge leaves the animal committed and open: extra recover
  // time = the counter-window that makes timed defence a WIN CONDITION
  // against the cats instead of a slower loss (perfect dodging measured
  // 153/153 evades and still 0/6 vs the lion — evasion paid nothing).
  beastDodgeRecoverPenalty: 0.55,
  // --- THE NET (retiarius verb, AAA audit #5) -------------------------------
  // The one mechanic the roster copy promised and never shipped — the
  // secutor's own blurb describes dodging one. Trident kits carry it: a long,
  // heavily-telegraphed cast; a catch strips the target's verbs (no attack,
  // dodge or guard) and slows them — the netman's opening; a whiff leaves
  // the caster wide open instead. Counterplay is honest on both sides:
  // the cast draws the same ground telegraph as any attack, dodge i-frames
  // evade it, and the cooldown makes every throw a commitment.
  netWindup: 0.9,
  netRange: 3.2,
  netArc: 0.55,            // half-angle, radians
  netDuration: 1.6,        // entangle
  netCooldown: 8.0,
  netMissRecover: 1.4,     // total open time after a whiffed cast
  netHitRecover: 0.35,
};

let _uid = 1;

/**
 * A combatant. Pure data plus behaviour — no rendering.
 */
export class Fighter {
  constructor({
    id = null, name = "fighter", team = 0,
    weapon = "gladius", shield = "none", armour = [],
    hp = 100, x = 0, z = 0, facing = 0, height = 1.82,
    isBeast = false, beastProfile = null, radius = null, mods = null,
    bulk = 0, gear = null,
  } = {}) {
    this.id = id || `f${_uid++}`;
    this.name = name;
    this.team = team;

    this.weaponId = weapon;
    this.shieldId = shield;
    this.armour = armour.slice();
    this.isBeast = isBeast;
    this.beast = beastProfile;

    // Collision radius in metres. This is NOT cosmetic: the separation solver
    // uses it as a hard floor on how close two bodies can get, so a radius
    // larger than an opponent's weapon reach makes that opponent unable to
    // land a single blow, ever.
    //
    // A previous version gave beasts a flat 1.5x multiplier, putting the
    // human-vs-beast floor at 1.375 m against a gladius that reaches 1.35 m —
    // the murmillo spent an entire bout at 0.1% of ticks in range and dealt
    // zero damage. A big cat is LONG, not wide: ~0.35 m across the shoulder.
    this.radius = radius !== null ? radius : (isBeast ? 0.36 : 0.42);

    // Attribute modifiers. A fighter with none behaves exactly as before —
    // every modifier is 1.0 at the baseline, which keeps the existing balance
    // and every existing probe valid.
    this.mods = mods || null;
    // Smith modifiers: reinforcement paths and wear condition, folded into
    // combat multipliers by inventory.gearMods(). Null for anyone without a
    // smith — every AI opponent — so their numbers are unchanged.
    this.gear = gear || null;
    const mob = mobility({ weapon, shield, armour, bulk }, this.mods);
    this.mob = mob;

    this.maxHp = Math.round(hp * (this.mods ? this.mods.maxHp : 1));
    this.hp = this.maxHp;
    this.stamina = mob.staminaMax;
    this.maxStamina = mob.staminaMax;

    this.x = x; this.z = z;
    this.vx = 0; this.vz = 0;
    this.facing = facing;
    this.height = height;

    this.phase = PHASE.IDLE;
    this.phaseT = 0;
    this.attackDir = null;
    this.blocking = false;
    this.blockDir = DIR.HIGH;
    this.blockHeldT = 0;
    this.shieldHp = SHIELDS[shield]
      ? Math.round(SHIELDS[shield].integrity * (this.gear ? this.gear.shieldIntegrity : 1))
      : 0;
    this.shieldHpMax = this.shieldHp;   // for HUD integrity fractions
    this.shieldBroken = false;
    this.guardBroken = false;    // stamina-broken guard; mends at 25% stamina

    this.iframes = 0;
    this.hitStop = 0;
    this.staggerT = 0;
    this.comboCount = 0;
    this.comboWindow = 0;
    this.lastHitBy = null;
    this.wounds = { head: 0, torso: 0, arms: 0, legs: 0 };
    this.alive = true;
    this.speed = 0;         // scalar ground speed, for animation
    this.netT = 0;          // entangled time remaining
    this.netCd = 0;         // net cooldown (trident kits)
    this.netWindupT = 0;    // a cast in flight
  }

  get weapon() { return WEAPONS[this.weaponId]; }
  get shield() { return SHIELDS[this.shieldId] || SHIELDS.none; }

  /** Effective move speed after load, exhaustion and leg wounds. */
  currentSpeed() {
    let s = this.mob.moveSpeed;
    if (this.stamina < FEEL.exhaustedThreshold) s *= FEEL.exhaustedSpeedMult;
    // Leg wounds are the classic gladiatorial crippling blow.
    s *= 1 - clamp(this.wounds.legs * 0.22, 0, 0.55);
    if (this.isBeast && this.beast) s *= this.beast.speedMult || 1;
    if (this.netT > 0) s *= 0.45;              // dragging the mesh
    return s;
  }

  canAct() {
    return this.alive && this.hitStop <= 0 &&
      !(this.netT > 0) && !(this.netWindupT > 0) &&
      (this.phase === PHASE.IDLE || this.phase === PHASE.RECOVER);
  }

  canAttack() {
    // A PENALIZED recover is a verb lockout, not just slow feet: the whiffed
    // net cast promises "total open time" and the dodged beast lunge promises
    // a counter-window — verification measured the netman counter-attacking
    // out of 87% of his own whiffs ~0.3 s after net_miss because RECOVER
    // counts as actionable. Movement stays free; the blade does not.
    return this.canAct() && this.stamina >= FEEL.minAttackStamina &&
      !(this.phase === PHASE.RECOVER && (this._recoverPenalty || 0) > 0);
  }
}

/**
 * The fight. Owns all combatants and resolves everything.
 */
export class Combat {
  /**
   * @param {object} opts { seed, arena, onEvent }
   */
  constructor({ seed = 1, arena = ARENA, onEvent = null } = {}) {
    this.rng = mulberry32(seed);
    this.arena = arena;
    this.fighters = [];
    this.time = 0;
    this.events = [];
    this.onEvent = onEvent;
    this.slowMo = 0;          // seconds of remaining slow-motion
    this.slowMoScale = 0.35;
  }

  add(f) { this.fighters.push(f); return f; }
  get(id) { return this.fighters.find((f) => f.id === id); }
  living(team = null) {
    return this.fighters.filter((f) => f.alive && (team === null || f.team === team));
  }

  /**
   * Everyone alive who is NOT on this team — i.e. everyone who would swing at
   * them. `living(1)` was the old idiom for "the enemy", and it silently
   * assumed there are exactly two sides. In a catervarii free-for-all with
   * three or four mutually hostile factions that reads only faction 1 and
   * misses the rest, so the bout can neither be lost nor won correctly.
   */
  hostilesTo(team) {
    return this.fighters.filter((f) => f.alive && f.team !== team);
  }

  /** Living allies of a team, excluding an optional fighter (usually self). */
  alliesOf(team, exclude = null) {
    return this.fighters.filter((f) => f.alive && f.team === team && f !== exclude);
  }

  emit(type, data) {
    const e = { t: +this.time.toFixed(3), type, ...data };
    this.events.push(e);
    if (this.events.length > 400) this.events.shift();
    if (this.onEvent) this.onEvent(e);
    return e;
  }

  // -- commands ------------------------------------------------------------

  /**
   * Apply one fighter's intent for this tick. Commands are the ONLY way state
   * changes from outside — which is exactly what a network layer would send.
   * @param {Fighter} f
   * @param {object} cmd { moveX, moveZ, face, attack, block, blockDir, dodge }
   */
  command(f, cmd) {
    if (!f.alive) return;
    f._cmd = cmd || {};
  }

  // -- the tick ------------------------------------------------------------

  update(dt) {
    // Slow motion scales the SIMULATION, not the frame rate, so a kill reads
    // cinematic without decoupling animation from physics.
    if (this.slowMo > 0) {
      this.slowMo = Math.max(0, this.slowMo - dt);
      dt *= this.slowMoScale;
    }
    this.time += dt;

    for (const f of this.fighters) this._stepFighter(f, dt);
    this._separate();
    return this.events;
  }

  _stepFighter(f, dt) {
    if (!f.alive) return;

    // Hit-stop freezes a fighter for a few frames on a solid connect. It is the
    // single cheapest thing that makes an impact feel like it has mass.
    if (f.hitStop > 0) { f.hitStop -= dt; f.speed = 0; return; }

    const cmd = f._cmd || {};

    // --- stamina ---------------------------------------------------------
    const regen = f.blocking ? f.mob.staminaRegen * 0.35 : f.mob.staminaRegen;
    if (f.phase === PHASE.IDLE || f.phase === PHASE.RECOVER) {
      f.stamina = Math.min(f.maxStamina, f.stamina + regen * dt);
    }
    // A broken guard mends when the arms do — see the guard-break branch in
    // _applyHit. Blocking is gated on this flag, so until stamina recovers to a
    // quarter of max the shield stays down and the fighter is honestly open.
    if (f.guardBroken && f.stamina >= f.maxStamina * 0.25) f.guardBroken = false;

    // --- timers ----------------------------------------------------------
    f.iframes = Math.max(0, f.iframes - dt);
    f.comboWindow = Math.max(0, f.comboWindow - dt);
    if (f.comboWindow <= 0) f.comboCount = 0;
    if (f.blocking) f.blockHeldT += dt; else f.blockHeldT = 0;
    if (f._riposteT) f._riposteT = Math.max(0, f._riposteT - dt);
    if (f._poiseT) f._poiseT = Math.max(0, f._poiseT - dt);
    if (f.netCd) f.netCd = Math.max(0, f.netCd - dt);
    if (f.netT) {
      f.netT = Math.max(0, f.netT - dt);
      if (f.netT === 0) this.emit("net_free", { id: f.id });
    }

    // --- the net cast resolves on its own clock ---------------------------
    if (f.netWindupT > 0) {
      f.netWindupT -= dt;
      if (f.netWindupT <= 0) {
        f.netWindupT = 0;
        let caught = null, best = Infinity;
        for (const t of this.fighters) {
          if (t === f || !t.alive || t.team === f.team || t.iframes > 0) continue;
          const dx = t.x - f.x, dz = t.z - f.z;
          const d = Math.hypot(dx, dz);
          if (d > FEEL.netRange) continue;
          if (Math.abs(angleDelta(f.facing, Math.atan2(dx, dz))) > FEEL.netArc) continue;
          if (d < best) { best = d; caught = t; }
        }
        if (caught) {
          caught.netT = FEEL.netDuration;
          caught.blocking = false;
          this.emit("net_hit", { attacker: f.id, target: caught.id, x: caught.x, z: caught.z });
          this.emit("netted", { id: caught.id });
          f.phase = PHASE.RECOVER; f.phaseT = 0;
          f._recoverPenalty = FEEL.netHitRecover;
        } else {
          this.emit("net_miss", { id: f.id, x: f.x, z: f.z });
          // A whiffed cast is the retiarius's own opening — the weighted mesh
          // has to be hauled back in.
          f.phase = PHASE.RECOVER; f.phaseT = 0;
          f._recoverPenalty = Math.max(0, FEEL.netMissRecover - f.weapon.recover);
        }
      }
    }

    // --- phase machine ---------------------------------------------------
    f.phaseT += dt;
    const w = f.weapon;
    switch (f.phase) {
      case PHASE.WINDUP:
        if (f.phaseT >= this._windup(f)) { f.phase = PHASE.ACTIVE; f.phaseT = 0; f._hitThisSwing = new Set(); }
        break;
      case PHASE.ACTIVE:
        this._resolveSwing(f, dt);
        if (f.phaseT >= w.active) { f.phase = PHASE.RECOVER; f.phaseT = 0; }
        break;
      case PHASE.RECOVER: {
        // _recoverPenalty: a beast whose lunge was DODGED is over-committed
        // and stays open longer — the evader's counter-window (see _applyHit).
        const rec = w.recover * (f.comboCount > 0 ? 1 - (w.comboBonus || 0) : 1) +
          (f._recoverPenalty || 0);
        if (f.phaseT >= rec) {
          f.phase = PHASE.IDLE; f.phaseT = 0; f.attackDir = null; f._recoverPenalty = 0;
        }
        break;
      }
      case PHASE.STAGGER:
        if (f.phaseT >= f.staggerT) { f.phase = PHASE.IDLE; f.phaseT = 0; }
        break;
      case PHASE.DODGE:
        if (f.phaseT >= FEEL.dodgeDuration) { f.phase = PHASE.IDLE; f.phaseT = 0; }
        break;
      default: break;
    }

    // --- intent ----------------------------------------------------------
    // ATTACK-CANCEL INTO GUARD. Raising the shield during your OWN windup
    // abandons the swing — the stamina is already spent, that is the price —
    // and the guard comes up this same tick. Without this, a fighter who
    // started a swing was locked out of defence for the entire windup+active
    // window, which is the measured reason a reactively-timed block could
    // never parry: the counter-blow resolved while your guard was down and
    // ungateable. Real swordplay abandons cuts into covers constantly.
    if (cmd.block && f.phase === PHASE.WINDUP && !f.isBeast &&
        !f.shieldBroken && !f.guardBroken) {
      f.phase = PHASE.IDLE; f.phaseT = 0; f.attackDir = null; f._lungeTarget = null;
      this.emit("cancel", { id: f.id });
    }

    // Blocking no longer requires a shield: a shieldless fighter raises a
    // WEAPON GUARD (blade/haft), which only stops a blow whose direction it
    // matches — see _applyHit. The t1 training bout issues rudis and no
    // shields to BOTH sides specifically to teach the guard, and the guard
    // verb being dead there locked novices out of the whole game (0/21 t1
    // wins, 70% of their deaths while holding the inert block).
    // !(netT>0): the catch STRIPS the guard — verification caught a netted
    // victim holding block through 94/94 entangled ticks and blocking the
    // netman's follow-up for zero, which made the catch nearly free against
    // exactly the turtling player the retiarius exists to punish.
    f.blocking = !!cmd.block && !f.isBeast && !f.shieldBroken &&
                 !f.guardBroken && !(f.netT > 0) &&
                 (f.phase === PHASE.IDLE || f.phase === PHASE.RECOVER);
    if (cmd.blockDir) f.blockDir = cmd.blockDir;

    // THE NET CAST. Trident kits only — the retiarius's paired verb, and the
    // one mechanic the roster copy always promised. Long telegraphed windup
    // on its own clock (the fighter is two-handing the throw; canAct() gates
    // every other verb off while it winds), 8 s cooldown so each cast is a
    // commitment, resolution in _stepFighter's cast block above.
    if (cmd.net && !f.isBeast && f.weaponId === "trident" && f.canAct() &&
        (f.netCd || 0) <= 0) {
      f.netWindupT = FEEL.netWindup;
      f.netCd = FEEL.netCooldown;
      this.emit("net_throw", {
        id: f.id, x: f.x, z: f.z, facing: f.facing,
        reach: FEEL.netRange, arc: FEEL.netArc,
        windupT: FEEL.netWindup, team: f.team,
      });
    }

    if (cmd.dodge && f.canAct() && f.stamina >= FEEL.dodgeStamina) {
      f.phase = PHASE.DODGE; f.phaseT = 0;
      f.iframes = FEEL.dodgeIFrames;
      f._lastDodgeT = this.time;      // beasts honour the whole sidestep
      f.stamina -= FEEL.dodgeStamina;
      const dx = cmd.moveX || -Math.sin(f.facing);
      const dz = cmd.moveZ || -Math.cos(f.facing);
      const len = Math.hypot(dx, dz) || 1;
      f._dodgeVX = (dx / len) * (f.mob.dodgeDistance / FEEL.dodgeDuration);
      f._dodgeVZ = (dz / len) * (f.mob.dodgeDistance / FEEL.dodgeDuration);
      this.emit("dodge", { id: f.id });
    }

    // REFUSED-ACTION FEEDBACK. A press the stamina gate swallows must not be
    // silent — indistinguishable from a miss, it taught players the controls
    // were broken. One event; the shell pulses the bar and plays a dry click.
    if (cmd.attack && f.isPlayer && f.alive && !f.canAttack() &&
        (f.phase === PHASE.IDLE || f.phase === PHASE.RECOVER) &&
        f.stamina < FEEL.minAttackStamina) {
      if (!f._refusedCd || f._refusedCd <= 0) {
        this.emit("refused", { id: f.id, what: "attack" });
        f._refusedCd = 0.35;
      }
    }
    if (f._refusedCd) f._refusedCd -= dt;

    if (cmd.attack && f.canAttack()) {
      const dir = cmd.attackDir && w.dirs.includes(cmd.attackDir) ? cmd.attackDir : w.dirs[0];
      // Lock the man this swing is aimed at, so the lunge has something to step
      // toward. Nearest hostile inside a generous commit cone — generous because
      // the player is choosing a target with a mouse, not a tracking reticle.
      f._lungeTarget = null;
      let best = Infinity;
      for (const t of this.fighters) {
        if (t === f || !t.alive || t.team === f.team) continue;
        const dx = t.x - f.x, dz = t.z - f.z;
        const d = Math.hypot(dx, dz);
        if (d > w.reach * FEEL.lungeAcquireReach) continue;
        if (Math.abs(angleDelta(f.facing, Math.atan2(dx, dz))) > FEEL.lungeAcquireArc) continue;
        if (d < best) { best = d; f._lungeTarget = t; }
      }
      f.phase = PHASE.WINDUP; f.phaseT = 0;
      // Monotonic per-swing id. Defenders latch their block/dodge decision to
      // this so they react ONCE per incoming attack instead of re-rolling every
      // tick of the windup — see the reactive layer in ai.js.
      f.swingSeq = (f.swingSeq || 0) + 1;
      f.attackDir = dir;
      f.stamina -= w.stamina;
      // Carry the swing's geometry so the view can draw the actual arc this
      // weapon sweeps rather than guessing one — a gladius flick and a spatha
      // cleave look nothing alike and the shape is the tell.
      const sw = f.weapon;
      this.emit("swing", {
        id: f.id, dir, weapon: f.weaponId,
        x: f.x, z: f.z, facing: f.facing,
        reach: sw.reach,
        arc: sw.arc !== undefined ? sw.arc : (sw.kind === "polearm" ? 0.35 : 0.62),
        cleave: sw.cleave || 1,
        // The GROUND TELEGRAPH runs off this event: it needs the real windup
        // (skill/wound-modified) and active window so its fill sweep lands
        // exactly when the blow does. The telegraph IS the hitbox — same
        // reach, same half-angle — so what the player learns is the truth.
        windupT: this._windup(f),
        activeT: sw.active,
        team: f.team,
      });
    }

    // --- movement --------------------------------------------------------
    let vx = 0, vz = 0;
    if (f.phase === PHASE.DODGE) {
      vx = f._dodgeVX; vz = f._dodgeVZ;
    } else if (f.phase === PHASE.WINDUP || f.phase === PHASE.ACTIVE) {
      // ATTACK LUNGE — step INTO the blow.
      //
      // Velocity used to be computed only for IDLE/RECOVER/DODGE, so the moment
      // a fighter committed to a swing they were rooted to the spot for the
      // whole windup and active window while the defender walked freely
      // backwards. Measured over the tutorial bout with a player that always
      // faces, always closes and always swings in range:
      //
      //   gladius reach            1.35 m
      //   distance at commit       1.46 m average
      //   distance at ACTIVE       1.09 m BEYOND reach, average
      //   active frames unreachable  67%   (0% ever fell outside the arc)
      //   swings landing              6 of 30
      //   result                      0 wins in 6, player dead every time,
      //                               opponent losing 32 of 96 hp
      //
      // The arc was never the problem and neither was target selection: the
      // enemy simply opened a metre of gap during a windup the attacker could
      // not answer. A step-and-cut closes it. Capped at 80% of reach so a lunge
      // never walks through the man it is aimed at.
      const t = f._lungeTarget;
      if (t && t.alive) {
        const dx = t.x - f.x, dz = t.z - f.z;
        const d = Math.hypot(dx, dz);
        const stop = f.weapon.reach * FEEL.lungeStopFraction;
        if (d > stop && d > 1e-4) {
          const sp = Math.min(f.currentSpeed() * FEEL.lungeSpeedMult, (d - stop) / Math.max(dt, 1e-3));
          vx = (dx / d) * sp; vz = (dz / d) * sp;
        }
      }
    } else if (f.phase === PHASE.IDLE || f.phase === PHASE.RECOVER) {
      const mx = cmd.moveX || 0, mz = cmd.moveZ || 0;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) {
        let sp = f.currentSpeed();
        if (f.blocking) sp *= 0.45;                      // shield walk
        if (f.phase === PHASE.RECOVER) sp *= 0.6;
        if (f.netWindupT > 0) sp *= 0.5;                 // casting is a commitment
        vx = (mx / len) * sp; vz = (mz / len) * sp;
      }
    }
    f.vx = vx; f.vz = vz;
    f.x += vx * dt; f.z += vz * dt;
    f.speed = Math.hypot(vx, vz);

    // Keep everyone on the sand.
    const c = clampToEllipse(f.x, f.z, this.arena.playable.a, this.arena.playable.b);
    f.x = c.x; f.z = c.z;

    // --- facing ----------------------------------------------------------
    if (cmd.face !== undefined && cmd.face !== null) {
      const d = angleDelta(f.facing, cmd.face);
      // A net cast commits the body like a swing does: the same 0.35x turn
      // damp applies while the mesh is in the air (verification measured a
      // full-rate chasing caster tracking a dodging target through his own
      // windup — radial retreat still beats it, but the cone the telegraph
      // paints must be roughly the cone that resolves).
      const committed = f.phase === PHASE.WINDUP || f.netWindupT > 0;
      const maxTurn = f.mob.turnRate * dt * (committed ? 0.35 : 1);
      f.facing += clamp(d, -maxTurn, maxTurn);
    }
  }

  /** Windup, lengthened by arm wounds — a cut arm is a slower arm. */
  _windup(f) {
    // Skill shortens the wind; a cut arm lengthens it.
    const skill = f.mods ? f.mods.windup : 1;
    return f.weapon.windup * skill * (1 + clamp(f.wounds.arms * 0.18, 0, 0.6));
  }

  /**
   * During the ACTIVE window, test the arc in front of the attacker.
   * Uses a cone (reach + half-angle) rather than a swept capsule: cheap,
   * deterministic, and at these ranges indistinguishable in play.
   */
  _resolveSwing(attacker, dt) {
    const w = attacker.weapon;
    const reach = w.reach * (1 + (attacker.isBeast ? 0 : 0));

    // --- STEEL MEETS STEEL -------------------------------------------------
    //
    // Two committed attacks arriving together CLASH: both blades stop, both
    // fighters rebound, nobody takes a wound. Without this, simultaneous
    // swings passed through each other and both landed — two men occupying
    // the same tempo traded clean hits, which never happens with real weapons:
    // the blades meet first. This is also what puts the sword-on-sword CLANG
    // and spark in the fight, which the game had only for shields.
    //
    // Deterministic — no rng. Conditions: both mid-attack (the other in
    // ACTIVE, or past 60% of windup — a blade already travelling), mutually
    // in range, and mutually facing. Beasts never clash; a lion has no blade
    // to bind. The mutual STAGGER is the latch: both leave ACTIVE, so one
    // clash resolves exactly once per pair of swings.
    if (!attacker.isBeast) {
      for (const other of this.fighters) {
        if (other === attacker || !other.alive || other.isBeast) continue;
        if (other.team === attacker.team) continue;
        // A pair that just clashed does not clash again immediately — the next
        // exchange RESOLVES. Without this cooldown two fighters with identical
        // weapon timing phase-lock: swing together, bind, stagger the same
        // duration, swing together again, forever. probe_match caught p3 Sine
        // Missione stalled at 240 s with nobody able to land a blow.
        if (this.time - (attacker._lastClashT ?? -9) < FEEL.clashCooldown) break;
        if (this.time - (other._lastClashT ?? -9) < FEEL.clashCooldown) continue;
        const mid = other.phase === PHASE.ACTIVE ||
          (other.phase === PHASE.WINDUP && other.phaseT >= this._windup(other) * 0.6);
        if (!mid) continue;
        const dx = other.x - attacker.x, dz = other.z - attacker.z;
        const dist = Math.hypot(dx, dz);
        // The blades occupy the gap between the two — both must be able to
        // reach it.
        if (dist > Math.min(reach, other.weapon.reach) * 1.05) continue;
        const aTo = Math.atan2(dx, dz), bTo = Math.atan2(-dx, -dz);
        const aArc = w.arc !== undefined ? w.arc : (w.kind === "polearm" ? 0.35 : 0.62);
        const ow = other.weapon;
        const bArc = ow.arc !== undefined ? ow.arc : (ow.kind === "polearm" ? 0.35 : 0.62);
        if (Math.abs(angleDelta(attacker.facing, aTo)) > aArc) continue;
        if (Math.abs(angleDelta(other.facing, bTo)) > bArc) continue;

        // Bind: the heavier weapon holds; a much lighter one is beaten aside.
        const ratio = w.poise / Math.max(1, ow.poise);
        const base = FEEL.clashStagger;
        attacker.phase = PHASE.STAGGER; attacker.phaseT = 0;
        other.phase = PHASE.STAGGER; other.phaseT = 0;
        // Different rebound lengths, deterministically jittered from the match
        // seed — identical staggers re-synchronise identical weapons into the
        // same phase-locked bind the cooldown exists to break.
        const jit = this.rng() * 0.12;
        attacker.staggerT = base * (ratio < 0.67 ? 1.6 : 1) + jit;
        other.staggerT = base * (ratio > 1.5 ? 1.6 : 1) + (0.12 - jit);
        attacker._lastClashT = this.time;
        other._lastClashT = this.time;
        attacker.hitStop = FEEL.hitStopSeconds;
        other.hitStop = FEEL.hitStopSeconds;
        attacker.stamina = Math.max(0, attacker.stamina - FEEL.clashStamina);
        other.stamina = Math.max(0, other.stamina - FEEL.clashStamina);
        this.emit("clash", {
          a: attacker.id, b: other.id,
          x: attacker.x + dx * 0.5, z: attacker.z + dz * 0.5,
        });
        return;   // the swing ended on the other blade
      }
    }
    // A weapon may declare its own swing arc. Polearms thrust in a narrow
    // line; a long blade sweeps wide enough to take more than one man.
    const halfAngle = w.arc !== undefined ? w.arc : (w.kind === "polearm" ? 0.35 : 0.62);
    // How many bodies one swing may touch, and how much the blade loses as it
    // passes through each. Undeclared = 1, so every existing weapon behaves
    // exactly as it did.
    const maxTargets = w.cleave || 1;
    const falloff = w.cleaveFalloff !== undefined ? w.cleaveFalloff : 1;

    // Nearest first, so the man you actually aimed at takes the full blow and
    // the cleave carries into whoever else is standing in the arc.
    const inArc = [];
    for (const target of this.fighters) {
      if (target === attacker || !target.alive) continue;
      if (target.team === attacker.team) continue;
      if (attacker._hitThisSwing && attacker._hitThisSwing.has(target.id)) continue;

      const dx = target.x - attacker.x;
      const dz = target.z - attacker.z;
      const dist = Math.hypot(dx, dz);
      if (dist > reach) continue;

      const toTarget = Math.atan2(dx, dz);
      if (Math.abs(angleDelta(attacker.facing, toTarget)) > halfAngle) continue;
      inArc.push({ target, dist });
    }
    inArc.sort((a, b) => a.dist - b.dist);

    let n = 0;
    for (const { target, dist } of inArc) {
      if (n >= maxTargets) break;
      attacker._hitThisSwing.add(target.id);
      this._applyHit(attacker, target, dist, null, null, Math.pow(falloff, n));
      n++;
    }
  }

  /** Resolve one connect: block, parry, armour, zone, wound, death. */
  _applyHit(attacker, target, dist, wOverride = null, dirOverride = null, damageScale = 1) {
    const w = attacker.weapon;
    const dir = attacker.attackDir;

    // --- dodge i-frames ---------------------------------------------------
    // Against a BEAST, a dodge that began any time inside the animal's OWN
    // windup still evades — the sidestep's displacement beats a straight-line
    // charge regardless of i-frame timing. Without this, reacting to the
    // TELL was punished: 0.28 s of i-frames expire 0.43-0.53 s into the
    // lion's 0.62 s windup, so tell-timed dodges won 6/30 while impact-timed
    // ones won 14/20 — the telegraph taught a lie, which is the one thing it
    // must never do. Scaled to each cat's windup so a panther stays a
    // panther; sword blows keep honest i-frame timing.
    const beastGrace = attacker.isBeast && attacker.beast &&
      (this.time - (target._lastDodgeT ?? -99)) < attacker.beast.windup + 0.12;
    if (target.iframes > 0 || beastGrace) {
      // A dodged BEAST lunge leaves the animal over-committed: its recover
      // stretches, and that stretch is the fighter's counter-window. Timed
      // evasion becomes a way to WIN the exchange, not just to not-lose it.
      if (attacker.isBeast) attacker._recoverPenalty = FEEL.beastDodgeRecoverPenalty;
      this.emit("dodged", { attacker: attacker.id, target: target.id });
      return;
    }

    // --- angle of attack --------------------------------------------------
    const dx = attacker.x - target.x;
    const dz = attacker.z - target.z;
    const fromAngle = Math.atan2(dx, dz);
    const rel = Math.abs(angleDelta(target.facing, fromAngle));
    const fromBehind = rel > 2.2;
    const fromFlank = rel > 1.1 && rel <= 2.2;

    // --- block / parry ----------------------------------------------------
    const sh = target.shield;
    const covers = sh.coverage.includes(dir);
    const facingIt = rel < 1.05;
    let blocked = false;
    let parried = false;

    let dirMatched = false;
    // A shieldless fighter can still GUARD — with the blade or haft. Unlike a
    // shield (which has a coverage arc and stops mismatched blows at a
    // premium), a weapon guard works ONLY when it matches the incoming
    // direction: the steel is either in the way or it is not. This is the
    // verb the t1 rudis bout teaches.
    const hasShield = target.shieldId !== "none" && !target.shieldBroken;
    const weaponGuard = target.blocking && !hasShield && !target.isBeast;
    const guardEngages = hasShield ? covers : (weaponGuard && target.blockDir === dir);
    if (target.blocking && guardEngages && facingIt) {
      // DIRECTION FINALLY MATTERS. blockDir was computed by input.js and
      // stored here for months with ZERO reads — the store page's headline
      // "directional weighted combat" was a placebo. Now it is the skill
      // layer: a guard matched to the incoming direction blocks CHEAP and is
      // parry-eligible; a mismatched guard still stops the blow but pays a
      // premium and can never parry — you caught it on the boards, not the
      // boss. (The AI's reactive layer reads the incoming attackDir, so its
      // blocks are matched by construction; its skill table governs whether
      // it blocks at all.)
      dirMatched = target.blockDir === dir;
      // A block begun within the parry window is a PARRY: free, and it
      // staggers the attacker. Holding block forever gets you a plain block.
      const parryWin = FEEL.parryWindow * (target.mods ? target.mods.parryWindow : 1);
      if (dirMatched && target.blockHeldT <= parryWin) {
        parried = true;
      } else {
        blocked = true;
      }
    }

    // A sica reaches around a shield rim some of the time.
    if ((blocked || parried) && w.shieldBypass && this.rng() < w.shieldBypass) {
      blocked = false; parried = false;
      this.emit("bypass", { attacker: attacker.id, target: target.id });
    }

    // A CHARGING ANIMAL IS NOT A SWORD BLOW. A shield is the right answer to a
    // big cat, but it cannot be a free one: a couple of hundred kilos arriving
    // at speed sometimes goes over the rim entirely, and when it doesn't it
    // still drives you backwards and empties your arms.
    //
    // Without this the matchup was decided entirely by the scutum — across a
    // 16-cell sweep of the tiger's hp (110-170) and damage (26-38) it never
    // won more than 21% of bouts, because the murmillo simply blocked its one
    // attack line until it was spent. Stats could not fix that; the mechanic
    // had to.
    if ((blocked || parried) && attacker.isBeast && this.rng() < FEEL.beastBypass) {
      blocked = false; parried = false;
      this.emit("maul", { attacker: attacker.id, target: target.id });
    }

    if (parried) {
      attacker.phase = PHASE.STAGGER;
      attacker.phaseT = 0;
      attacker.staggerT = FEEL.parryStagger;
      attacker.hitStop = FEEL.hitStopSeconds;
      // The defender has earned the initiative — ai.js turns this window
      // into an immediate counter (with poise), so a read is a punish.
      // A parry always earns it (it IS the read); no cooldown gate here.
      target._riposteT = FEEL.riposteWindow;
      target._riposteGrantT = this.time;
      this.emit("parry", { attacker: attacker.id, target: target.id, dir });
      return;
    }

    if (blocked) {
      // Blocking a beast's charge costs far more than blocking a swing — the
      // shield holds, but your arms do not hold forever.
      const impact = attacker.isBeast ? FEEL.beastBlockCost : 1;
      // Matched guard direction blocks cheap; a mismatched catch pays 30% more.
      const dirMult = dirMatched ? 0.7 : 1.3;
      // A weapon guard has no boards behind it: the stop costs more wind and
      // there is no shield to soak — but there is also no shieldHp to lose.
      const guardMult = weaponGuard ? FEEL.weaponGuardCostMult : (1 - sh.stability * 0.35);
      const cost = w.damage * FEEL.blockStaminaCost * impact * dirMult * guardMult;
      target.stamina -= cost;
      if (!weaponGuard) target.shieldHp -= w.damage * (1 - sh.block);
      attacker.hitStop = FEEL.hitStopSeconds * 0.7;
      // A MATCHED stop earns the counter-window a parry does — the spammer
      // who swings into a read guard is the one who gets hit. Mismatched
      // catches (on the boards, not the read) earn nothing, and the cooldown
      // keeps counters from becoming an unanswerable wall.
      if (dirMatched && (this.time - (target._riposteGrantT ?? -99)) > FEEL.riposteCooldown) {
        target._riposteT = FEEL.riposteWindow;
        target._riposteGrantT = this.time;
      }

      if (!weaponGuard && target.shieldHp <= 0 && !target.shieldBroken) {
        target.shieldBroken = true;
        target.blocking = false;
        target.phase = PHASE.STAGGER;
        target.phaseT = 0;
        target.staggerT = FEEL.guardBreakStagger;
        this.emit("shield_break", { id: target.id });
        return;
      } else if (target.stamina <= 0) {
        // GUARD BREAK IS A STATE, NOT A REPEATABLE EVENT.
        //
        // This branch used to pin stamina to exactly 0 and `return` with no
        // damage. Pinned AT the trigger condition, the next blocked hit
        // re-satisfied `stamina <= 0` and broke the guard again, forever —
        // measured, 26% of all player swings resolved as zero-damage
        // guard_breaks, the single most common outcome against a scutum. The
        // defender could never climb out (block regen 0.35x never outpaced the
        // cost) and the attacker's reward for breaking a guard was a wasted
        // swing.
        //
        // Now: the guard STAYS broken until stamina recovers to 25% of max
        // (the blocking gate checks `guardBroken`), and the breaking blow
        // itself falls through to the damage path at half strength — breaking
        // a man's guard is supposed to be the opening, not the anticlimax.
        target.stamina = 0;
        target.guardBroken = true;
        target.blocking = false;
        target.phase = PHASE.STAGGER;
        target.phaseT = 0;
        target.staggerT = FEEL.guardBreakStagger;
        this.emit("guard_break", { id: target.id });
        damageScale *= 0.5;
        // no return — the blow lands, reduced
      } else {
        this.emit("block", { attacker: attacker.id, target: target.id, dir, shieldHp: Math.max(0, Math.round(target.shieldHp)) });
        return;
      }
    }

    // --- zone ------------------------------------------------------------
    const zone = this._pickZone(dir, attacker, target);
    // The smith's work on the TARGET's armour reduces what gets through, and
    // the wear on it gives that protection back. `gear.protection` above 1 is
    // better armour, so it divides the multiplier toward zero.
    const tProt = target.gear ? Math.max(0.2, target.gear.protection) : 1;
    const armourMult = zoneMultiplier(target.armour, zone) / tProt;
    const basePierce = (w.armourPierce && w.armourPierce[dir]) || 0;
    // A honed edge finds the gap a blunt one does not.
    const pierce = clamp(basePierce + (attacker.gear ? attacker.gear.pierce : 0), 0, 0.95);
    // Piercing lifts the effective armour multiplier toward 1.
    const effMult = clamp(armourMult + (1 - armourMult) * pierce, 0, 1);

    let dmg = w.damage * ZONES[zone].crit * effMult;
    if (attacker.mods) dmg *= attacker.mods.damage;   // Strength
    // Reinforcement and condition on the ATTACKER's weapon. A ruined
    // masterwork lands softer than a pristine plain blade, which is the rule
    // blacksmith.js was written around and never got to enforce.
    if (attacker.gear) dmg *= attacker.gear.damage;
    // Cleave falloff — the blade slows as it passes through each body.
    dmg *= damageScale;
    if (fromBehind) dmg *= FEEL.backstabMultiplier;
    else if (fromFlank) dmg *= FEEL.flankMultiplier;
    if (attacker.comboCount > 0) dmg *= 1 + Math.min(0.35, attacker.comboCount * 0.09);
    // Small deterministic spread so identical exchanges are not identical.
    dmg *= 0.9 + this.rng() * 0.2;
    dmg = Math.max(1, dmg);

    target.hp -= dmg;
    target.wounds[zone] = Math.min(3, target.wounds[zone] + (dmg > 18 ? 1 : 0));
    target.lastHitBy = attacker.id;

    // A blow lands mid-cast: the net drops. Reading the long windup and
    // striking through it is the cast's honest counterplay.
    if (target.netWindupT > 0) {
      target.netWindupT = 0;
      this.emit("net_miss", { id: target.id, x: target.x, z: target.z, cancelled: true });
    }

    // Interrupting a windup is what rewards reading an opponent — but only
    // reading it EARLY. Poise rules (persona-playtest fix): past the early
    // part of the windup the blow is committed and carries through the pain;
    // a fighter interrupted moments ago has hyper-armour; and a riposte swing
    // (ai.js sets _poiseT on issue) cannot be interrupted at all. Without
    // these, mashing interrupt-staggered every windup in the game (68 in 30
    // bouts) and no enemy ever finished a swing against a spammer.
    if (FEEL.interruptOnWindup && target.phase === PHASE.WINDUP) {
      const wprog = target.phaseT / Math.max(0.01, this._windup(target));
      const immune = (target._poiseT || 0) > 0 ||
        (this.time - (target._lastInterruptT ?? -99)) < FEEL.interruptImmunity;
      if (wprog < FEEL.interruptWindow && !immune) {
        target.phase = PHASE.STAGGER;
        target.phaseT = 0;
        target.staggerT = 0.45;
        target._lastInterruptT = this.time;
        this.emit("interrupt", { attacker: attacker.id, target: target.id });
      }
    }

    const heavy = dmg > 30;
    attacker.hitStop = heavy ? FEEL.hitStopHeavy : FEEL.hitStopSeconds;
    target.hitStop = attacker.hitStop * 0.8;
    attacker.comboCount++;
    attacker.comboWindow = 1.15;

    this.emit("hit", {
      attacker: attacker.id, target: target.id, dir, zone,
      damage: +dmg.toFixed(1), hp: +Math.max(0, target.hp).toFixed(1),
      fromBehind, fromFlank, heavy,
      x: target.x, z: target.z,
      // World bearing of the blow, attacker -> target: blood is cast AWAY from
      // the blade, and the view stretches its splats along this line.
      castDir: Math.atan2(target.x - attacker.x, target.z - attacker.z),
    });

    if (target.hp <= 0) this._kill(target, attacker);
  }

  /**
   * Which body zone a swing lands on. Direction biases it — a high cut goes for
   * the head, a thrust for the torso, a low sweep for the legs — with a beast
   * always coming in low because it is at hip height.
   */
  _pickZone(dir, attacker, target) {
    const r = this.rng();
    if (attacker.isBeast) return r < 0.55 ? "legs" : r < 0.85 ? "torso" : "arms";
    switch (dir) {
      case DIR.HIGH:   return r < 0.42 ? "head" : r < 0.82 ? "torso" : "arms";
      case DIR.THRUST: return r < 0.12 ? "head" : r < 0.80 ? "torso" : "arms";
      case DIR.LEFT:
      case DIR.RIGHT:  return r < 0.16 ? "head" : r < 0.55 ? "torso" : r < 0.80 ? "arms" : "legs";
      default:         return r < 0.6 ? "torso" : "legs";
    }
  }

  _kill(target, killer) {
    target.hp = 0;
    target.alive = false;
    target.phase = PHASE.DEAD;
    target.phaseT = 0;
    target.speed = 0;
    // A kill is the one moment that earns slow motion.
    this.slowMo = 1.05;
    this.emit("death", { id: target.id, by: killer ? killer.id : null, x: target.x, z: target.z });
  }

  /**
   * Keep bodies from occupying the same point.
   *
   * INVARIANT: the sum of any two fighters' radii must stay below the shorter
   * weapon's reach, or that fighter can never connect. `probe_combat` asserts
   * this directly so the constraint cannot be broken by a future tuning pass.
   */
  _separate() {
    for (let i = 0; i < this.fighters.length; i++) {
      const a = this.fighters[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.fighters.length; j++) {
        const b = this.fighters[j];
        if (!b.alive) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = a.radius + b.radius;
        if (d < min && d > 0.0001) {
          const push = (min - d) * 0.5;
          const nx = dx / d, nz = dz / d;
          a.x -= nx * push; a.z -= nz * push;
          b.x += nx * push; b.z += nz * push;
        }
      }
    }
  }

  /** Snapshot for the HUD / verification / network. */
  snapshot() {
    return {
      t: +this.time.toFixed(2),
      slowMo: +this.slowMo.toFixed(2),
      fighters: this.fighters.map((f) => ({
        id: f.id, name: f.name, team: f.team,
        hp: +Math.max(0, f.hp).toFixed(1), maxHp: f.maxHp,
        stamina: +Math.max(0, f.stamina).toFixed(1), maxStamina: +f.maxStamina.toFixed(1),
        phase: f.phase, dir: f.attackDir, blocking: f.blocking,
        shieldHp: Math.max(0, Math.round(f.shieldHp)), shieldBroken: f.shieldBroken,
        x: +f.x.toFixed(2), z: +f.z.toFixed(2), facing: +f.facing.toFixed(3),
        speed: +f.speed.toFixed(2), alive: f.alive, wounds: { ...f.wounds },
        combo: f.comboCount,
      })),
    };
  }
}
