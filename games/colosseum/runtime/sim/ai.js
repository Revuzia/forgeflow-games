// Colosseum — opponent AI.
//
// Utility-based rather than a behaviour tree: each tick every option scores
// itself from the current situation and the highest wins. It suits fighting
// games because the "right" move is always a weighing of distance, stamina,
// threat and opportunity rather than a fixed sequence — and because a scored
// system degrades gracefully when a new option is added.
//
// Difficulty is NOT a stat multiplier. Cheating AI reads as unfair; instead
// rank scales *reaction latency*, *decision noise* and *how often the AI takes
// the correct-but-punishing option*. A Tiro-rank opponent genuinely fights
// worse. A Legend-rank one punishes every recovery frame.
//
// Same determinism contract as combat.js: no THREE, no DOM, no wall clock.

import { PHASE, FEEL } from "./combat.js";
import { DIR } from "../data/weapons.js";
import { clamp, mulberry32, angleDelta } from "../core/util.js";

/**
 * Difficulty bands. `latency` is how long the AI takes to notice a change;
 * `noise` randomises its scoring; `punish` is the chance it takes the optimal
 * aggressive line when one exists.
 */
export const SKILL = {
  tiro:      { latency: 0.42, noise: 0.55, punish: 0.15, blockChance: 0.25, dodgeChance: 0.08, spacing: 0.5 },
  gregarius: { latency: 0.32, noise: 0.42, punish: 0.28, blockChance: 0.40, dodgeChance: 0.15, spacing: 0.65 },
  veteranus: { latency: 0.22, noise: 0.30, punish: 0.45, blockChance: 0.55, dodgeChance: 0.25, spacing: 0.8 },
  primus:    { latency: 0.15, noise: 0.20, punish: 0.62, blockChance: 0.68, dodgeChance: 0.35, spacing: 0.9 },
  champion:  { latency: 0.10, noise: 0.12, punish: 0.78, blockChance: 0.78, dodgeChance: 0.45, spacing: 1.0 },
  legend:    { latency: 0.07, noise: 0.07, punish: 0.90, blockChance: 0.86, dodgeChance: 0.55, spacing: 1.0 },
};

/** Per-style personality weights, applied on top of skill. */
export const STYLE = {
  pressure:  { advance: 1.35, retreat: 0.6, circle: 0.7, patience: 0.5 },
  spacer:    { advance: 0.65, retreat: 1.4, circle: 1.1, patience: 1.4 },
  flanker:   { advance: 0.9,  retreat: 0.9, circle: 1.7, patience: 1.0 },
  aggressor: { advance: 1.6,  retreat: 0.35, circle: 0.8, patience: 0.25 },
  beast:     { advance: 1.5,  retreat: 0.7, circle: 1.2, patience: 0.6 },
};

/**
 * Beast behaviour profiles. A big cat does not fence — it stalks, circles at
 * the edge of its charge range, commits to a lunge, then backs off.
 */
// A beast's edge is REACH and SPEED, not being a damage sponge. Tuned against
// probe_combat's 20-bout beast suite so a veteranus-rank murmillo wins roughly
// half — dangerous, but a fight the player can take. The first pass gave the
// tiger 150 hp / 34 dmg / 1.9 m reach against a murmillo's 115 hp / 26 / 1.35
// and it won 20 out of 20, which is not a fight, it is an execution.
export const BEAST_PROFILES = {
  tiger: {
    id: "tiger", name: "Tiger",
    hp: 172, damage: 33, reach: 1.85, speedMult: 1.28,
    windup: 0.46, active: 0.16, recover: 0.86,
    chargeRange: 6.5, stalkRange: 9.0, retreatHp: 0.24,
    style: "beast",
    desc: "Stalks the edge of your reach, then covers six metres in a blink.",
  },
  lion: {
    id: "lion", name: "Lion",
    hp: 205, damage: 37, reach: 1.95, speedMult: 1.10,
    windup: 0.54, active: 0.18, recover: 0.95,
    chargeRange: 6.0, stalkRange: 8.5, retreatHp: 0.18,
    style: "beast",
    desc: "Heavier and less patient than a tiger. Comes straight down the middle.",
  },
  panther: {
    id: "panther", name: "Panther",
    hp: 140, damage: 28, reach: 1.7, speedMult: 1.45,
    windup: 0.34, active: 0.14, recover: 0.66,
    chargeRange: 7.5, stalkRange: 10.0, retreatHp: 0.32,
    style: "beast",
    desc: "Fast, nervous, hit-and-run. Never stays inside your reach.",
  },
};

/**
 * One AI brain driving one Fighter.
 */
export class Brain {
  /**
   * @param {Fighter} self
   * @param {object} opts { skill, style, seed, combat }
   */
  constructor(self, { skill = "gregarius", style = null, seed = 7, combat = null } = {}) {
    this.self = self;
    this.combat = combat;
    this.skill = SKILL[skill] || SKILL.gregarius;
    this.skillName = skill;
    this.style = STYLE[style || (self.isBeast ? "beast" : "pressure")] || STYLE.pressure;
    this.rng = mulberry32(seed);

    this.think = 0;             // time until the next decision
    this.decision = null;       // the latched decision
    this.circleDir = this.rng() < 0.5 ? 1 : -1;
    this.commitT = 0;           // how long we stay on the current decision
  }

  /** Nearest living enemy. */
  target() {
    if (!this.combat) return null;
    let best = null;
    let bd = Infinity;
    for (const f of this.combat.fighters) {
      if (!f.alive || f.team === this.self.team) continue;
      const d = Math.hypot(f.x - this.self.x, f.z - this.self.z);
      if (d < bd) { bd = d; best = f; }
    }
    this._dist = bd;
    return best;
  }

  /**
   * Produce a command for this tick.
   * @returns {object} command struct for Combat.command()
   */
  update(dt) {
    const s = this.self;
    if (!s.alive) return {};

    const t = this.target();
    if (!t) return {};

    const dx = t.x - s.x, dz = t.z - s.z;
    const dist = Math.hypot(dx, dz);
    const face = Math.atan2(dx, dz);

    // Reaction latency: the AI only re-decides every `latency` seconds. This
    // is what makes low ranks feel slow to punish without nerfing their stats.
    this.think -= dt;
    this.commitT -= dt;

    // Burn/refill the beast's retreat budget so flight is a burst, not a state.
    if (s.isBeast && this._retreatBudget !== undefined) {
      if (this.decision && this.decision.kind === "retreat") {
        this._retreatBudget -= dt;
        if (this._retreatBudget <= 0) this._reengage = 3.0;   // must commit again
      } else if (this._reengage > 0) {
        this._reengage -= dt;
        if (this._reengage <= 0) this._retreatBudget = 2.2;   // may break off again
      }
    }
    if (this.think <= 0) {
      this.think = this.skill.latency * (0.75 + this.rng() * 0.5);
      this.decision = this._decide(t, dist);
    }

    const d = this.decision || { kind: "approach" };
    const cmd = { face };

    // --- reactive layer: block/dodge can fire between decisions -----------
    // A threat is an enemy in an ACTIVE or late-WINDUP attack that can reach.
    const threatened = t.phase === PHASE.WINDUP && dist <= t.weapon.reach * 1.15;
    if (threatened) {
      const roll = this.rng();
      const canBlock = s.shieldId !== "none" && !s.shieldBroken;
      if (canBlock && roll < this.skill.blockChance) {
        cmd.block = true;
        cmd.blockDir = t.attackDir || DIR.HIGH;
        return cmd;
      }
      // Dodge occupies its OWN probability band, [blockChance, +dodgeChance).
      //
      // Without the lower bound a SHIELDLESS fighter skips the block branch and
      // then dodges on every roll below blockChance+dodgeChance — 0.80 for a
      // veteranus instead of the 0.25 the table declares. The block band
      // silently converted into extra dodging for exactly the fighters who
      // cannot block: paegniarius ("blunt stick, no shield, no armour") and
      // retiarius among them.
      //
      // Measured in the tutorial bout before this fix — phase occupancy over
      // 4,402 fight frames:
      //     enemy idle 74.1%  dodge 24.2%  windup 0.6%  active 0.6%
      // An opponent that dodges a quarter of the fight and commits to an attack
      // 0.6% of the time is not fighting, and the bout stalemated: foe stuck at
      // 20 hp and player at 39 hp from t=30s to t=70s with no time limit to end
      // it. That is the "combat seems completely broken" the player reported.
      if (roll >= this.skill.blockChance &&
          roll < this.skill.blockChance + this.skill.dodgeChance &&
          s.stamina > FEEL.dodgeStamina) {
        cmd.dodge = true;
        // Sidestep rather than backpedal — retreating just invites the follow-up.
        cmd.moveX = Math.cos(face) * this.circleDir;
        cmd.moveZ = -Math.sin(face) * this.circleDir;
        return cmd;
      }
    }

    // --- act on the latched decision --------------------------------------
    const reach = s.isBeast && s.beast ? s.beast.reach : s.weapon.reach;

    // THE EXCHANGE RHYTHM.
    //
    // Measured before this: the worst 3-second burst a player took was 64
    // damage against 115 health — 56% of a fighter, gone in three seconds —
    // and weapons cycle a full swing every 0.41 to 0.86 s with nothing ever
    // making anyone stop. A dimachaerus manages 3.1 swings a second, forever.
    //
    // That is a modern action-game tempo, and it is not how these fights went.
    // A munus ran ten to fifteen minutes: fighters closed, traded a few blows,
    // broke off, circled, caught their breath behind the shield, and went again.
    // The summa rudis could and did pause the bout outright. The exchange, not
    // the swing, is the unit of the fight.
    //
    // So a fighter now commits to a burst of a few blows and then MUST break —
    // back off, guard up, reset the spacing — before pressing again. Patience
    // scales it by style, so an aggressor barely pauses and a spacer takes his
    // time, and the fight gets a pulse instead of a flat rate of damage.
    this._exchange = this._exchange || { swings: 0, breakT: 0 };
    if (this._exchange.breakT > 0) {
      this._exchange.breakT -= dt;
      // Hold the guard and keep distance while recovering the initiative.
      cmd.moveX = -dz / dist * this.circleDir;
      cmd.moveZ = dx / dist * this.circleDir;
      if (s.shieldId !== "none" && !s.shieldBroken) { cmd.block = true; cmd.blockDir = DIR.HIGH; }
      return cmd;
    }

    switch (d.kind) {
      case "attack": {
        const swinging = dist <= reach * 0.95 && this._claimAttackToken(t);
        if (swinging) {
          // Count the blow, and break after a burst.
          this._exchange.swings++;
          const maxBurst = this.style.patience < 0.6 ? 3 : 2;
          if (this._exchange.swings >= maxBurst) {
            this._exchange.swings = 0;
            // Patient styles rest longer. ~0.7 s for an aggressor, ~1.5 s for a
            // spacer — long enough to read as a beat, short enough to stay a fight.
            this._exchange.breakT = 0.55 + this.style.patience * 0.7;
          }
        }
        if (swinging) {
          cmd.attack = true;
          cmd.attackDir = d.dir;
          // A BEAST COMMITS. It does not strike from the edge of its reach and
          // drift out again — it drives into contact, which is what puts it
          // inside the fighter's guard where it can be answered.
          //
          // Without this a big cat is unbeatable by construction: the tiger
          // out-reaches a murmillo by 37% and outruns him by 60%, so it simply
          // kited forever. Measured: the murmillo spent 0 of 1362 ticks in
          // range and dealt 0 damage across a full bout.
          if (s.isBeast) { cmd.moveX = dx / dist; cmd.moveZ = dz / dist; }
        } else if (dist <= reach * 0.95) {
          // In range but holding — someone else has the token. Circle and
          // keep the guard up rather than shuffling into the target's back,
          // which is what makes a waiting attacker read as a threat rather
          // than as a queue.
          cmd.moveX = -dz / dist * this.circleDir;
          cmd.moveZ = dx / dist * this.circleDir;
          // Deliberately NOT raising a guard here.
          //
          // The first version did, and it quietly made every enemy in the game
          // tankier: a fighter waiting for the attack token spent that time
          // perfectly blocked, so the player could not punish the gap the
          // token had just created. Measured across the ladder it cost 20-30
          // points of win rate on bouts that had nothing to do with crowds —
          // v1 60% -> 30%, v5 35% -> 5%, g1 35% -> 10%.
          //
          // A waiting attacker should be a waiting attacker: circling, in
          // range, and open. That is the window the token exists to hand the
          // player. The reactive block/dodge layer above still fires normally
          // if this fighter is actually threatened.
        } else {
          cmd.moveX = dx / dist; cmd.moveZ = dz / dist;
        }
        break;
      }
      case "approach": {
        cmd.moveX = dx / dist; cmd.moveZ = dz / dist;
        break;
      }
      case "retreat": {
        cmd.moveX = -dx / dist; cmd.moveZ = -dz / dist;
        break;
      }
      case "circle": {
        // Strafe around the target while closing the gap.
        //
        // The pull threshold used to be `reach * 1.6`, which was catastrophic:
        // two circling fighters settled at almost exactly that distance and
        // then actively pushed each OTHER away, so bouts hovered ~2 m apart
        // and 28/40 timed out. Circling must still close.
        const px = Math.cos(face) * this.circleDir;
        const pz = -Math.sin(face) * this.circleDir;
        const pull = dist > reach * 1.05 ? 0.75 : (dist < reach * 0.65 ? -0.35 : 0.12);
        cmd.moveX = px + (dx / dist) * pull;
        cmd.moveZ = pz + (dz / dist) * pull;
        break;
      }
      case "hold": {
        if (s.shieldId !== "none" && !s.shieldBroken) cmd.block = true;
        break;
      }
      default: break;
    }
    return cmd;
  }

  /** Score the options and latch the best. */
  /**
   * The attack token — how a crowd of enemies stops being a firing squad.
   *
   * Every brain decided independently, so everyone who was in range swung at
   * the same moment. A defender can face and block exactly ONE direction, so
   * the second simultaneous attacker was unblockable by construction and the
   * third and fourth were free damage. Measured across 5 seeds each with a
   * fully-kitted veteranus player:
   *
   *   bout                foes  won   max simultaneous attackers  damage taken
   *   t2  First Sand        1    4/5            1                      35
   *   v2  Two Against One   2    0/5            2                     103
   *   p1  Troupe            3    1/5            3                      90
   *   c3  The Great Munus   4    0/5            3        100, and only 59
   *                                                      player swings — the
   *                                                      player was locked down
   *
   * Six ladder bouts sat at a flat 0% win rate and every one of them was
   * multi-opponent or survival. This is not a tuning problem; a 1-vs-4 where
   * all four commit at once has no counterplay at any skill level.
   *
   * The fix is the one every AAA melee game uses — Arkham, Shadow of Mordor,
   * Assassin's Creed all do it: only a limited number of attackers may commit
   * at a time. The rest circle and posture, which is also what a real group
   * does, because four men with swords do not all step in together either.
   *
   * The token lives on the shared Combat object and is keyed by TARGET, so
   * pressure on the player is capped while two AI allies fighting each other
   * elsewhere are unaffected. Determinism is preserved: the registry is only
   * written from brain updates, which already run in a fixed order.
   */
  _claimAttackToken(target) {
    const c = this.combat;
    if (!c || !target) return true;                 // no arbiter, no limit
    // NEVER throttle the player.
    //
    // In the real game the player is driven by human input and never touches
    // this path, but the headless balance harness drives the player slot with
    // a Brain — so the token was queueing the PLAYER behind their own
    // opponent. It showed up as 1-vs-1 bouts losing 25-30 points of win rate
    // (v1 60% -> 30%, v5 35% -> 5%) from a mechanic that is supposed to only
    // affect crowds, which is what exposed it. Guarding here keeps the harness
    // representative and makes the intent explicit: this is a rule for the
    // AI's manners, not a rule of the world.
    if (this.self.isPlayer) return true;
    const reg = (c._attackTokens || (c._attackTokens = new Map()));
    const key = target.id;
    let slot = reg.get(key);
    // Drop holders who died, disengaged, or finished their swing.
    //
    // The grace window is load-bearing. A brain claims the token and sets
    // cmd.attack on THIS tick, but combat.js does not move the fighter into
    // WINDUP until it processes that command on the NEXT tick. Filtering
    // purely on phase therefore evicted every holder one tick after it
    // claimed, freeing the slot instantly and letting all four enemies swing
    // anyway — the cap measured as no cap at all.
    const now = c.time || 0;
    if (slot) {
      slot.holders = slot.holders.filter((h) => {
        const f = c.fighters.find((x) => x.id === h.id);
        if (!f || !f.alive) return false;
        if (now - h.t < 0.35) return true;                    // just claimed
        return f.phase === PHASE.WINDUP || f.phase === PHASE.ACTIVE;
      });
    } else {
      slot = { holders: [] };
      reg.set(key, slot);
    }
    if (slot.holders.some((h) => h.id === this.self.id)) return true;   // already swinging

    // How many may commit at once, by how many are actually engaged. One
    // attacker for a duel or a pair; two once it is a real melee, so a crowd
    // still feels dangerous without being unanswerable.
    // Count only fighters actually ENGAGED WITH THIS TARGET — alive, hostile
    // to it, and close enough to swing.
    //
    // The first version counted every fighter not on the target's team. In a
    // two-sided bout that is the same thing, but a catervarii free-for-all has
    // three or four mutually hostile factions, so it counted men across the
    // arena who were busy fighting each other, inflated the engaged number,
    // and raised the concurrent-attacker cap everywhere at once — the crowd
    // control silently switching itself off in exactly the fight it exists for.
    const engaged = c.fighters.filter(
      (f) => f.alive && f.team !== target.team &&
        Math.hypot(f.x - target.x, f.z - target.z) <= 4.0
    ).length;
    const cap = engaged >= 3 ? 2 : 1;

    if (slot.holders.length >= cap) return false;   // wait your turn — circle
    slot.holders.push({ id: this.self.id, t: now });
    return true;
  }

  _decide(t, dist) {
    const s = this.self;
    const sk = this.skill;
    const st = this.style;
    const reach = s.isBeast && s.beast ? s.beast.reach : s.weapon.reach;
    const noise = () => (this.rng() - 0.5) * 2 * sk.noise;

    const hpFrac = s.hp / s.maxHp;
    const stamFrac = s.stamina / s.maxStamina;
    const inRange = dist <= reach * 0.95;
    const closeish = dist <= reach * 1.7;

    // OPPORTUNITY: the enemy is in recovery or stagger and cannot answer. A
    // skilled AI punishes this almost every time; a poor one rarely notices.
    const openWindow = t.phase === PHASE.RECOVER || t.phase === PHASE.STAGGER;
    const opportunity = openWindow && closeish ? sk.punish : 0;

    // Weights are tuned so that a bout CONVERGES. Every option that keeps
    // distance is scored against a strong closing drive, because two fighters
    // who both prefer spacing will orbit until the clock runs out.
    const scores = {
      attack:
        (inRange ? 1.6 : 0.12) *
        (stamFrac > 0.25 ? 1 : 0.25) *
        (1 + opportunity * 2.2) *
        (1 / st.patience) + noise(),

      approach:
        // Scales with HOW far out of range we are, so the further apart the
        // fighters drift the harder they are pulled back together.
        (dist > reach ? 0.95 + Math.min(1.2, (dist - reach) * 0.42) : 0.08) *
        st.advance * (stamFrac > 0.3 ? 1 : 0.5) + noise(),

      retreat:
        // Only a real reason retreats — being hurt, being spent, or being
        // uncomfortably inside your own guard. Never noise alone.
        ((hpFrac < 0.3 ? 1.25 : 0) + (stamFrac < 0.2 ? 1.0 : 0) +
         (dist < reach * 0.55 ? 0.45 : 0)) * st.retreat + noise() * 0.4,

      circle:
        (closeish ? 0.75 : 0.2) * st.circle *
        (stamFrac > 0.35 ? 1 : 0.6) *
        // Spacing skill: better fighters circle to find an angle instead of
        // walking straight into a shield.
        (0.6 + sk.spacing * 0.8) + noise(),

      hold:
        (t.phase === PHASE.WINDUP ? 0.8 : 0.1) *
        (s.shieldId !== "none" && !s.shieldBroken ? 1 : 0.05) *
        st.patience + noise() * 0.5,
    };

    if (s.isBeast) {
      // A healthy beast does not fence at range — it presses. Kiting is the
      // one behaviour that makes a fast, long-reach animal unbeatable, so it
      // is suppressed unless the animal is actually hurt.
      const hurt = s.beast && hpFrac < s.beast.retreatHp;

      // A wounded animal breaks off — but only in BURSTS. Left unbounded it
      // simply runs for the rest of the match (measured: 72% of ticks spent
      // retreating, bout timed out at 90 s with the beast alive on 15 hp).
      // Real cornered animals disengage, circle, and come back.
      if (this._retreatBudget === undefined) { this._retreatBudget = 2.2; this._reengage = 0; }

      // Cornered: no room left behind it, so it turns and fights regardless.
      const edge = Math.sqrt((s.x * s.x) / (43.5 * 43.5) + (s.z * s.z) / (27.5 * 27.5));
      const cornered = edge > 0.82;

      if (hurt && this._retreatBudget > 0 && !cornered) {
        scores.retreat += 1.4;
        scores.attack *= 0.4;
      } else {
        scores.retreat *= 0.15;
        scores.circle *= 0.55;
        scores.attack *= hurt ? 1.05 : 1.25;
      }
    }

    let bestKind = "approach";
    let best = -Infinity;
    for (const k in scores) if (scores[k] > best) { best = scores[k]; bestKind = k; }

    // Occasionally flip circling direction so the AI does not orbit predictably.
    if (bestKind === "circle" && this.rng() < 0.12) this.circleDir *= -1;

    return { kind: bestKind, dir: this._pickAttackDir(t), score: +best.toFixed(3) };
  }

  /**
   * Choose an attack direction. Skilled AI aims AROUND the enemy's guard:
   * if they are holding a block that covers high, it goes low or thrusts.
   */
  _pickAttackDir(t) {
    const s = this.self;
    const dirs = s.isBeast ? [DIR.HIGH] : s.weapon.dirs;
    if (!dirs.length) return DIR.HIGH;

    if (this.rng() < this.skill.punish && t.blocking) {
      const covered = (t.shield && t.shield.coverage) || [];
      const uncovered = dirs.filter((d) => !covered.includes(d));
      if (uncovered.length) return uncovered[(this.rng() * uncovered.length) | 0];
    }
    return dirs[(this.rng() * dirs.length) | 0];
  }

  stats() {
    return {
      skill: this.skillName,
      decision: this.decision ? this.decision.kind : null,
      dist: this._dist !== undefined ? +this._dist.toFixed(2) : null,
      think: +this.think.toFixed(2),
    };
  }
}
