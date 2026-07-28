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
  // The TUTOR band exists for exactly one bout: t1, Wooden Swords. The
  // paegniarius is a teacher, not an opponent — long pauses between slow
  // bursts leave room to practise offence, a healthy blockChance DEMONSTRATES
  // the guard verb the bout is named for, and near-zero punish means honest
  // mistakes are survivable. Persona playtest before this band existed: 0/21
  // novice t1 wins (including a masher and a turtle control), with the bout
  // swinging near-continuously (46% of novice swings clashed) — a hard wall
  // in front of the entire progression, which gates on winning it.
  // (latency 0.60->0.70, punish 0.05->0.03 after the verification replay put
  // the novice win rate at exactly the 25% acceptance floor — margin bought
  // with a slower, even less punishing teacher, not a weaker lesson.)
  tutor:     { latency: 0.70, noise: 0.60, punish: 0.03, blockChance: 0.50, dodgeChance: 0.04, spacing: 0.35 },
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
    // Retuned after the persona playtest proved the v3 matchup unwinnable by
    // timed defence: 153/153 successful dodges still lost 0/6 across five
    // timing settings, because the cadence outlasted the dodge stamina
    // economy and evasion paid nothing. Slower windup (readable), longer
    // recover (which the new dodge->recover penalty stretches further into a
    // real counter-window), softer paw. Still the heaviest thing on the card.
    hp: 205, damage: 34, reach: 1.95, speedMult: 1.10,
    windup: 0.62, active: 0.18, recover: 1.18,
    chargeRange: 6.0, stalkRange: 8.5, retreatHp: 0.18,
    style: "beast",
    desc: "Heavier and less patient than a tiger. Comes straight down the middle.",
  },
  // The AUROCHS (bestiary id "bison" — _makeBeast keys profiles by beast id).
  // Not a cat: half a tonne of charging bull. Slow to wind, brutal to catch,
  // nearly impossible to make retreat, with the longest commit range in the
  // game — the fight is matador work: bait the charge, punish the long
  // recover the dodge-grace mechanic stretches even further. Previously this
  // bout quietly spawned lion stats inside a tiger body, which is exactly the
  // advertised-but-not-shipped credibility hit the AAA audit ranked #5.
  bison: {
    id: "bison", name: "Aurochs",
    hp: 260, damage: 41, reach: 1.7, speedMult: 1.02,
    windup: 0.72, active: 0.20, recover: 1.35,
    chargeRange: 9.5, stalkRange: 12.0, retreatHp: 0.08,
    style: "beast",
    desc: "Half a tonne of Germanic aurochs. It does not stalk — it charges.",
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
    // The tutor teaches at a spacer's tempo regardless of the armatura's
    // native style — patience 1.4 stretches the between-burst breaks to
    // ~2.9 s, which is the room a first-time player learns in.
    if (skill === "tutor") style = "spacer";
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
    // Never react while mid-own-swing: the sim's attack-cancel now lets a
    // raised shield ABANDON a windup, and the reactive layer issuing block
    // during the AI's own attacks turned every committed swing into a cancel —
    // measured immediately by probe_combat, where the murmillo went 0-for-20
    // against the tiger because it cancelled everything it started. Committing
    // to the blow is the AI's character; the cancel is a tool for human hands.
    const threatened = t.phase === PHASE.WINDUP && dist <= t.weapon.reach * 1.15 &&
                       s.phase !== PHASE.WINDUP && s.phase !== PHASE.ACTIVE;
    // ONE REACTION, DECIDED ONCE PER INCOMING SWING, THEN HELD.
    //
    // This layer sits outside the `think <= 0` latency gate, so it re-rolled
    // EVERY TICK of the windup. One roll per tick against a fixed threshold
    // turns a per-tick probability p into 1-(1-p)^12 over a 12-tick windup,
    // which saturates every band above tiro at ~100% block and ~97% dodge: the
    // SKILL table became decorative and the player's swing was answered on
    // essentially every commitment, at every difficulty.
    //
    // Rolling once and LATCHING is what makes the table mean what it says. The
    // choice has to persist for the rest of the swing, not fire for a single
    // tick — a block is a held stance, and issuing it on one tick would leave
    // the guard down when the blow actually lands.
    if (!threatened) {
      this._reaction = null;
    } else {
      const key = t.id + ":" + t.swingSeq;
      if (!this._reaction || this._reaction.key !== key) {
        const roll = this.rng();
        // The weapon guard exists now (combat.js): a shieldless human can
        // block a matched direction — so the paegniarius DEMONSTRATES the
        // guard t1 teaches, and the retiarius stops being pure dodge-bait.
        const canBlock = !s.isBeast && !s.shieldBroken && !s.guardBroken;
        let kind = "none";
        if (canBlock && roll < this.skill.blockChance) {
          kind = "block";
        } else if (roll >= this.skill.blockChance &&
                   roll < this.skill.blockChance + this.skill.dodgeChance &&
                   s.stamina > FEEL.dodgeStamina) {
          // Dodge occupies its OWN band, [blockChance, +dodgeChance).
          //
          // Without the lower bound a SHIELDLESS fighter skips the block branch
          // and then dodges on every roll below blockChance+dodgeChance — 0.80
          // for a veteranus against the 0.25 the table declares. The block band
          // silently became extra dodging for exactly the fighters who cannot
          // block: paegniarius ("blunt stick, no shield, no armour", the
          // TUTORIAL opponent) and retiarius among them. Measured over 4,402
          // fight frames it left the enemy dodging 24.2% of the bout and
          // committing to an attack 0.6% of it, which stalemated the fight.
          kind = "dodge";
        }
        this._reaction = { key, kind, fired: false };
      }
      const r = this._reaction;
      if (r.kind === "block") {
        cmd.block = true;                       // HELD for the whole swing
        cmd.blockDir = t.attackDir || DIR.HIGH;
        return cmd;
      }
      if (r.kind === "dodge" && !r.fired && s.stamina > FEEL.dodgeStamina) {
        r.fired = true;                         // one-shot: a roll, not a stance
        cmd.dodge = true;
        // Sidestep rather than backpedal — retreating just invites the follow-up.
        cmd.moveX = Math.cos(face) * this.circleDir;
        cmd.moveZ = -Math.sin(face) * this.circleDir;
        return cmd;
      }
    }

    // --- act on the latched decision --------------------------------------
    const reach = s.isBeast && s.beast ? s.beast.reach : s.weapon.reach;

    // RIPOSTE — the guaranteed answer to a stopped blow. combat.js arms
    // _riposteT on every successful block and parry; inside that window the
    // AI counters IMMEDIATELY (bypassing the exchange break — this swing IS
    // the exchange) and with poise, so the spammer cannot interrupt the
    // punishment they earned. This is what makes a standing guard beat
    // button-mashing: measured before, 44 blocks + 5 parries produced zero
    // consecutive return hits and blockers beat the masher 2 bouts in 24.
    if (!s.isBeast && (s._riposteT || 0) > 0 && dist <= reach * 0.98 && s.canAttack()) {
      s._riposteT = 0;
      s._poiseT = 0.9;                       // covers the counter's windup
      if (this._exchange) this._exchange.breakT = 0;
      cmd.attack = true;
      cmd.attackDir = this._pickAttackDir(t);
      return cmd;
    }

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
    // Count BLOWS, not decision ticks.
    //
    // `swings++` used to run inside the attack case every tick the latched
    // decision was live, and _claimAttackToken returns true immediately for an
    // existing holder — so maxBurst 2-3 was reached in 33-50 ms and the
    // "burst" broke off after ~0.4 actual swings: an exchange rhythm that
    // never completed an exchange. A blow is a transition INTO windup, tracked
    // here EVERY tick (not just while the attack decision is latched, or a
    // stale previous-phase would double-count on re-entry). Gating on
    // `swinging && canAttack()` instead over-corrects to 8-10 swings per
    // burst, because RECOVER ticks also satisfy canAttack.
    const enteredWindup = s.phase === PHASE.WINDUP && this._prevSelfPhase !== PHASE.WINDUP;
    this._prevSelfPhase = s.phase;
    if (enteredWindup) {
      this._exchange.swings++;
      const maxBurst = this.style.patience < 0.6 ? 3 : 2;
      if (this._exchange.swings >= maxBurst) {
        this._exchange.swings = 0;
        // Rest between exchanges, scaled by style. Time-motion analysis of
        // real striking sports puts one committed attack every ~2.9-3.4 s
        // (elite boxing punch rate; Muay Thai high-intensity phases of
        // 2.2 +/- 1.2 s alternating with longer lulls). With 1.5-2.25 s swing
        // cycles, a 2-3 blow burst plus this 0.9-2.3 s break lands the overall
        // rhythm in that measured band — circling, guard up, resetting the
        // spacing, then pressing again.
        this._exchange.breakT = 0.9 + this.style.patience * 1.4;
      }
    }
    if (this._exchange.breakT > 0) {
      this._exchange.breakT -= dt;
      // Hold the guard and keep distance while recovering the initiative.
      // (Weapon guard counts — a shieldless fighter still covers a line.)
      cmd.moveX = -dz / dist * this.circleDir;
      cmd.moveZ = dx / dist * this.circleDir;
      if (!s.isBeast && !s.shieldBroken && !s.guardBroken) { cmd.block = true; cmd.blockDir = DIR.HIGH; }
      return cmd;
    }

    switch (d.kind) {
      case "attack": {
        const swinging = dist <= reach * 0.95 && this._claimAttackToken(t);
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
        if (!s.isBeast && !s.shieldBroken && !s.guardBroken) cmd.block = true;
        break;
      }
      case "net": {
        // One command; the sim's own cooldown makes repeats harmless.
        cmd.net = true;
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

    // OPPORTUNITY: the enemy is in recovery, stagger — or wrapped in a net —
    // and cannot answer. A skilled AI punishes this almost every time; a poor
    // one rarely notices. (netT: verification measured the netman converting
    // only 4/15 of his own catches because nothing told him the window was
    // open — the spacer sometimes RETREATED off his own successful cast.)
    const openWindow = t.phase === PHASE.RECOVER || t.phase === PHASE.STAGGER ||
      (t.netT || 0) > 0;
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
        (!s.isBeast && !s.shieldBroken ? (s.shieldId !== "none" ? 1 : 0.7) : 0.05) *
        st.patience + noise() * 0.5,

      // THE NET. Only a trident kit off cooldown scores it at all. The band
      // is the netman's dance distance — outside his own trident poke,
      // inside the cast's reach — and an enemy stuck in recovery is exactly
      // when the mesh flies. Scored through the same noisy table as
      // everything else so low ranks throw it clumsily and champions throw
      // it like a verdict.
      net:
        (!s.isBeast && s.weaponId === "trident" && (s.netCd || 0) <= 0 &&
         (s.netT || 0) <= 0 ? 1 : 0) *
        (dist >= 1.6 && dist <= 3.1 ? 1.25 : 0.1) *
        (1 + opportunity * 2.0) + noise() * 0.6,
    };

    // TUTOR MERCY — a lanista's man drilling a tiro does not finish a
    // struggling student. Below 45% student hp the tutor eases right off,
    // giving the novice room to recover and land the winning stretch.
    // Measured need: cadence tuning alone left the strict novice persona at
    // 17.5-30% t1 wins (tutor out-landing them 6.8 to 3.6 per bout) against
    // a >=30% acceptance floor; the early-bout lesson keeps its teeth because
    // mercy only starts once the lesson has visibly landed.
    if (this.skillName === "tutor" && t.hp / t.maxHp < 0.45) {
      scores.attack *= 0.18;
      scores.circle += 0.5;
      scores.retreat += 0.4;
    }

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
