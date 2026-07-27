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
  blockStaminaCost: 0.55,
  guardBreakStagger: 0.85,       // seconds
  // Landing a hit inside the enemy's WINDUP interrupts it — this is what makes
  // trading feel like fencing rather than two people mashing.
  interruptOnWindup: true,
  hitStopSeconds: 0.085,         // frozen frames on a solid connect
  hitStopHeavy: 0.14,
  // A perfectly timed block (within this window of the hit) costs no stamina
  // and staggers the attacker instead.
  parryWindow: 0.16,
  parryStagger: 0.7,
  dodgeIFrames: 0.28,
  dodgeDuration: 0.42,
  dodgeStamina: 22,
  backstabMultiplier: 1.7,       // hit from behind
  flankMultiplier: 1.25,
  // Beasts vs shields — see _applyHit. A charge sometimes goes straight over
  // the rim, and blocking one drains far more than blocking a sword.
  beastBypass: 0.30,
  beastBlockCost: 2.6,
  // Stamina gates: you cannot attack with nothing left.
  minAttackStamina: 6,
  exhaustedThreshold: 15,
  exhaustedSpeedMult: 0.62,
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
    this.shieldBroken = false;

    this.iframes = 0;
    this.hitStop = 0;
    this.staggerT = 0;
    this.comboCount = 0;
    this.comboWindow = 0;
    this.lastHitBy = null;
    this.wounds = { head: 0, torso: 0, arms: 0, legs: 0 };
    this.alive = true;
    this.speed = 0;         // scalar ground speed, for animation
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
    return s;
  }

  canAct() {
    return this.alive && this.hitStop <= 0 &&
      (this.phase === PHASE.IDLE || this.phase === PHASE.RECOVER);
  }

  canAttack() {
    return this.canAct() && this.stamina >= FEEL.minAttackStamina;
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

    // --- timers ----------------------------------------------------------
    f.iframes = Math.max(0, f.iframes - dt);
    f.comboWindow = Math.max(0, f.comboWindow - dt);
    if (f.comboWindow <= 0) f.comboCount = 0;
    if (f.blocking) f.blockHeldT += dt; else f.blockHeldT = 0;

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
      case PHASE.RECOVER:
        if (f.phaseT >= w.recover * (f.comboCount > 0 ? 1 - (w.comboBonus || 0) : 1)) {
          f.phase = PHASE.IDLE; f.phaseT = 0; f.attackDir = null;
        }
        break;
      case PHASE.STAGGER:
        if (f.phaseT >= f.staggerT) { f.phase = PHASE.IDLE; f.phaseT = 0; }
        break;
      case PHASE.DODGE:
        if (f.phaseT >= FEEL.dodgeDuration) { f.phase = PHASE.IDLE; f.phaseT = 0; }
        break;
      default: break;
    }

    // --- intent ----------------------------------------------------------
    f.blocking = !!cmd.block && f.shieldId !== "none" && !f.shieldBroken &&
                 (f.phase === PHASE.IDLE || f.phase === PHASE.RECOVER);
    if (cmd.blockDir) f.blockDir = cmd.blockDir;

    if (cmd.dodge && f.canAct() && f.stamina >= FEEL.dodgeStamina) {
      f.phase = PHASE.DODGE; f.phaseT = 0;
      f.iframes = FEEL.dodgeIFrames;
      f.stamina -= FEEL.dodgeStamina;
      const dx = cmd.moveX || -Math.sin(f.facing);
      const dz = cmd.moveZ || -Math.cos(f.facing);
      const len = Math.hypot(dx, dz) || 1;
      f._dodgeVX = (dx / len) * (f.mob.dodgeDistance / FEEL.dodgeDuration);
      f._dodgeVZ = (dz / len) * (f.mob.dodgeDistance / FEEL.dodgeDuration);
      this.emit("dodge", { id: f.id });
    }

    if (cmd.attack && f.canAttack()) {
      const dir = cmd.attackDir && w.dirs.includes(cmd.attackDir) ? cmd.attackDir : w.dirs[0];
      f.phase = PHASE.WINDUP; f.phaseT = 0;
      f.attackDir = dir;
      f.stamina -= w.stamina;
      this.emit("swing", { id: f.id, dir, weapon: f.weaponId });
    }

    // --- movement --------------------------------------------------------
    let vx = 0, vz = 0;
    if (f.phase === PHASE.DODGE) {
      vx = f._dodgeVX; vz = f._dodgeVZ;
    } else if (f.phase === PHASE.IDLE || f.phase === PHASE.RECOVER) {
      const mx = cmd.moveX || 0, mz = cmd.moveZ || 0;
      const len = Math.hypot(mx, mz);
      if (len > 0.01) {
        let sp = f.currentSpeed();
        if (f.blocking) sp *= 0.45;                      // shield walk
        if (f.phase === PHASE.RECOVER) sp *= 0.6;
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
      const maxTurn = f.mob.turnRate * dt * (f.phase === PHASE.WINDUP ? 0.35 : 1);
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
    if (target.iframes > 0) {
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

    if (target.blocking && covers && facingIt && !target.shieldBroken) {
      // A block begun within the parry window is a PARRY: free, and it
      // staggers the attacker. Holding block forever gets you a plain block.
      const parryWin = FEEL.parryWindow * (target.mods ? target.mods.parryWindow : 1);
      if (target.blockHeldT <= parryWin) {
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
      this.emit("parry", { attacker: attacker.id, target: target.id, dir });
      return;
    }

    if (blocked) {
      // Blocking a beast's charge costs far more than blocking a swing — the
      // shield holds, but your arms do not hold forever.
      const impact = attacker.isBeast ? FEEL.beastBlockCost : 1;
      const cost = w.damage * FEEL.blockStaminaCost * impact * (1 - sh.stability * 0.35);
      target.stamina -= cost;
      target.shieldHp -= w.damage * (1 - sh.block);
      attacker.hitStop = FEEL.hitStopSeconds * 0.7;

      if (target.shieldHp <= 0 && !target.shieldBroken) {
        target.shieldBroken = true;
        target.blocking = false;
        target.phase = PHASE.STAGGER;
        target.phaseT = 0;
        target.staggerT = FEEL.guardBreakStagger;
        this.emit("shield_break", { id: target.id });
      } else if (target.stamina <= 0) {
        target.stamina = 0;
        target.phase = PHASE.STAGGER;
        target.phaseT = 0;
        target.staggerT = FEEL.guardBreakStagger;
        this.emit("guard_break", { id: target.id });
      } else {
        this.emit("block", { attacker: attacker.id, target: target.id, dir, shieldHp: Math.max(0, Math.round(target.shieldHp)) });
      }
      return;
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

    // Interrupting a windup is what rewards reading an opponent.
    if (FEEL.interruptOnWindup && target.phase === PHASE.WINDUP) {
      target.phase = PHASE.STAGGER;
      target.phaseT = 0;
      target.staggerT = 0.45;
      this.emit("interrupt", { attacker: attacker.id, target: target.id });
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
