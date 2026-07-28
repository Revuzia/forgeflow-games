// Colosseum — the match director.
//
// Owns one bout end to end: the ceremony, the fight, the verdict, the purse.
// It is the layer that binds the pure combat sim to the visible world — actors,
// gates, lifts, crowd — while keeping the sim itself free of any of them.
//
// The structure follows a real munus rather than "spawn two men and go":
//
//   ENTRY     the Porta Triumphalis grinds open, the fighter walks out,
//             the crowd quiets and then breaks
//   SALUTE    a beat to read the opponent before anything can hurt you
//   FIGHT     the sim runs
//   VERDICT   ad digitum — a beaten fighter raises a finger and the editor
//             decides. Missio is the norm; death is the exception.
//   EXIT      the dead leave through the Porta Libitinaria, dragged, and the
//             sand keeps the mark
//
// Those beats are what make it feel like an event instead of a skirmish, and
// they cost almost nothing because the gate and lift systems already exist.

import { Combat, Fighter, PHASE } from "./combat.js";
import { Brain, BEAST_PROFILES } from "./ai.js";
import { WEAPONS, ARMATURAE } from "../data/weapons.js";
import { ARMATURA_ROSTER, CHAMPIONS, MUNUS, makeOpponent } from "../data/roster.js";
import { mulberry32, clamp } from "../core/util.js";
import { Joust } from "./joust.js";

export const STATE = {
  IDLE: "idle",
  ENTRY: "entry",
  SALUTE: "salute",
  FIGHT: "fight",
  VERDICT: "verdict",
  EXIT: "exit",
  DONE: "done",
};

/** Beat lengths in seconds. */
const BEAT = { entry: 4.4, salute: 2.2, verdict: 3.2, exit: 3.0 };

export class Match {
  /**
   * @param {object} opts
   *   def       one entry from roster LADDER
   *   inventory the player's Inventory (loadout + purse settlement)
   *   seed      deterministic bout seed
   *   hooks     { onState, onEvent, onSpawn, onDespawn, onCue }
   */
  constructor({ def, inventory, seed = 1, hooks = {} } = {}) {
    this.def = def;
    this.inv = inventory;
    this.seed = seed;
    this.hooks = hooks;
    this.rng = mulberry32(seed);

    this.combat = new Combat({ seed, onEvent: (e) => this._onCombatEvent(e) });
    this.brains = new Map();          // fighterId -> Brain
    this.state = STATE.IDLE;
    this.stateT = 0;
    this.time = 0;
    this.result = null;
    this.crowdFavour = 0.5;
    this.playerKills = 0;
    this.tookDamage = false;
    this.wave = 0;
    this.log = [];

    this.player = null;
    this.spawned = [];                // every combatant, for the view layer
  }

  // -- setup ---------------------------------------------------------------

  /**
   * The opponents this card fields, as a flat spec list.
   *
   * A ladder entry can name its enemy two ways: `opponents: [{armatura}]`, or a
   * top-level `champion: "flamma"` shorthand. Every consumer MUST read them
   * through here. Spawning and body-preloading each used to derive the list
   * themselves and disagreed — `start()` read only `opponents`, so all six
   * champion bouts spawned an empty arena and auto-won.
   */
  _opponentSpecs() {
    const d = this.def;
    const specs = (d.opponents || []).slice();
    if (d.champion) specs.unshift({ champion: d.champion });
    return specs;
  }

  /**
   * Which armatura bodies this card needs. The view preloads exactly these
   * rather than all eight — a 1v1 should not pay for six unused bodies.
   */
  requiredBodies() {
    const d = this.def;
    const ids = new Set();
    const arm = this.inv && this.inv.matchedArmatura();
    ids.add(arm ? arm.id : "murmillo");
    if (d.type === "joust") ids.add("eques");
    for (const s of this._opponentSpecs()) {
      if (s.armatura) ids.add(s.armatura);
      if (s.champion) {
        const c = CHAMPIONS.find((x) => x.id === s.champion);
        if (c) ids.add(c.armatura);
      }
    }
    for (const s of d.allies || (d.ally ? [d.ally] : [])) if (s.armatura) ids.add(s.armatura);
    if (d.tertiarius && d.tertiarius.armatura) ids.add(d.tertiarius.armatura);
    // Survival waves draw from a fixed pool.
    if (d.type === "survival") ["thraex", "murmillo", "hoplomachus", "dimachaerus"].forEach((x) => ids.add(x));
    return [...ids];
  }

  /** Build the player fighter from the live inventory loadout. */
  _makePlayer() {
    const lw = this.inv.loadout();
    const arm = this.inv.matchedArmatura();
    // The paegniarius interval is a TRAINING bout — "Wooden Swords", blunted
    // weapons, nobody dies. Both sides are issued a rudis, which is what the
    // bout's own name and description have always said. Carrying your steel
    // into it made the tutorial a 2:1 damage mismatch in the player's favour
    // and taught nothing; before that it fielded a fully-armoured murmillo and
    // taught despair. Neither is a first fight.
    const training = this.def.type === "paegniarius";
    const weapon = training ? "rudis" : lw.weapon;
    const shield = training ? "none" : lw.shield;
    const f = new Fighter({
      id: "player", name: this.inv.name || "You", team: 0,
      weapon, shield, armour: training ? [] : lw.armour,
      hp: arm ? arm.hp : 105,
      x: -14, z: 0, facing: Math.PI / 2,
      // THE ATTRIBUTES AND THE ENTIRE TRAINING GROUND WERE DOING NOTHING.
      //
      // Fighter takes a `mods` option and combat.js:95 reads it as
      // `this.mods = mods || null`, feeding every derived number — damage,
      // max hp, stamina pool and regen, move speed, dodge distance, attack
      // windup, parry window. This call never passed it. Not once, for the
      // whole life of the file.
      //
      // So Strength, Endurance, Agility and Skill were inert; the nine
      // training regimens, the fatigue that follows you onto the sand, the
      // rank-gated ceilings and the 2,535-XP cost of the last point all
      // resolved to a multiplier of exactly 1.0. attributes.js:5 states the
      // rule the system was built around — "no attribute may be cosmetic" —
      // and every one of them was.
      //
      // inventory.mods() already returns exactly the struct Fighter wants,
      // fatigue applied. It simply was never handed over.
      mods: this.inv.mods ? this.inv.mods() : null,
      // Reinforcement + wear. See inventory.gearMods().
      gear: this.inv.gearMods ? this.inv.gearMods() : null,
    });
    f.isPlayer = true;
    // The player's BODY follows the kit they are wearing: assemble a murmillo's
    // loadout and you look like a murmillo on the sand.
    f.armaturaId = arm ? arm.id : "murmillo";
    return f;
  }

  /** Build one opponent from a ladder spec. */
  _makeOpponent(spec, index, team = 1) {
    // A named champion overrides everything else.
    if (spec.champion) {
      const c = CHAMPIONS.find((x) => x.id === spec.champion);
      if (c) {
        const a = ARMATURA_ROSTER[c.armatura];
        const base = ARMATURAE[c.armatura] || ARMATURAE.murmillo;
        const f = new Fighter({
          id: `champ_${c.id}`, name: c.name, team,
          weapon: a.loadout.weapon, shield: a.loadout.shield, armour: a.loadout.armour,
          hp: Math.round((base.hp || 110) * (c.hpMult || 1)),
          bulk: base.bulk || 0,
          x: 14, z: 0, facing: -Math.PI / 2,
        });
        f.champion = c;
        f.armaturaId = c.armatura;
        f.displayTitle = c.title;
        return { fighter: f, skill: c.skill, style: a.style };
      }
    }

    // Names must be unique on the sand — see makeOpponent's `taken`.
    this._names = this._names || new Set([this.inv?.name].filter(Boolean));
    const o = makeOpponent(spec.armatura, { skill: spec.skill, rng: this.rng, taken: this._names });
    const base = ARMATURAE[spec.armatura] || ARMATURAE.thraex;
    const ang = (index / 3) * Math.PI - Math.PI / 2;
    // The id carries a monotonic sequence, NOT the spawn index.
    //
    // _spawnWave() restarts its loop index at 0 for every wave and draws from a
    // 4-armatura pool, so wave 2's `opp0_thraex` collided with wave 1's DEAD
    // `opp0_thraex`. combat.get() is a linear `.find()` (combat.js:171), so it
    // returned the corpse, and `brains.set(f.id, ...)` overwrote the live
    // fighter's brain with the same key.
    //
    // The result: a fresh enemy that receives no commands, is given no body by
    // bout.js, and is still counted alive by combat.living() — so the wave can
    // never clear. Measured on 39 of 40 seeds for p3 "Sine Missione" and 40 of
    // 40 for l1 "Thirty-Four Fights", which is two of the six bouts that read
    // as unwinnable. Those two were never a balance problem.
    this._spawnSeq = (this._spawnSeq || 0) + 1;
    const f = new Fighter({
      id: `opp${this._spawnSeq}_${o.armatura}`, name: o.name, team,
      weapon: o.loadout.weapon, shield: o.loadout.shield, armour: o.loadout.armour,
      hp: base.hp || 100,
      bulk: base.bulk || 0,
      x: 13 + index * 1.6, z: Math.sin(ang) * 4.5, facing: -Math.PI / 2,
    });
    f.origin = o;
    f.armaturaId = o.armatura;
    f.displayTitle = `${o.originName} · ${o.armaturaName}`;
    return { fighter: f, skill: o.skill, style: o.style };
  }

  /** Build a beast from its profile. */
  _makeBeast(beastId, index) {
    const p = BEAST_PROFILES[beastId] || BEAST_PROFILES.tiger;
    const f = new Fighter({
      id: `beast${index}_${beastId}`, name: p.name, team: 1,
      weapon: "gladius", shield: "none", armour: [],
      hp: p.hp, x: 8 + index * 3, z: 2, facing: -Math.PI / 2,
      isBeast: true, beastProfile: p, height: 0.95,
    });
    // The view keys mount/species lookups off beast.id; the profile never
    // carried it, so every species fell into the tiger fallback.
    f.beast = { ...p, id: beastId };
    // A beast swings with its own numbers, not a sword's.
    Object.defineProperty(f, "weapon", {
      value: {
        ...WEAPONS.gladius, reach: p.reach, damage: p.damage,
        windup: p.windup, active: p.active, recover: p.recover,
        dirs: ["high"], armourPierce: { high: 0.35 },
      },
    });
    f.displayTitle = p.desc;
    return { fighter: f, skill: "veteranus", style: "beast" };
  }

  /** Spawn everything the ladder entry calls for and begin the ceremony. */
  start() {
    const d = this.def;

    // THE JOUST IS ITS OWN SIM. Combat never runs during the mounted phase;
    // sim/joust.js owns both riders with its own deterministic rng stream.
    // The riders are fighter-shaped records, so the view spawns and drives
    // them through the same pipeline as everyone else.
    if (d.type === "joust") {
      this.joust = new Joust({
        seed: this.seed,
        player: { name: this.inv ? this.inv.name : "You" },
        opponent: { name: d.joust && d.joust.name, skill: d.joust ? d.joust.skill : 0.5 },
        hooks: { onEvent: (e) => { if (this.hooks.onEvent) this.hooks.onEvent(e); } },
      });
      this.player = this.joust.riders.player;
      this.spawned.push({ fighter: this.joust.riders.player, role: "player" });
      this.spawned.push({ fighter: this.joust.riders.opponent, role: "opponent" });
      this._setState(STATE.ENTRY);
      if (this.hooks.onSpawn) this.hooks.onSpawn(this.spawned);
      return this;
    }

    this.player = this.combat.add(this._makePlayer());
    this.spawned.push({ fighter: this.player, role: "player" });

    const enroll = (made, role) => {
      const f = this.combat.add(made.fighter);
      this.brains.set(f.id, new Brain(f, {
        skill: made.skill, style: made.style,
        seed: Math.floor(this.rng() * 1e9), combat: this.combat,
      }));
      this.spawned.push({ fighter: f, role });
      return f;
    };

    // CATERVARII — the free-for-all.
    //
    // A ladder entry may declare `factions: [[spec,...],[spec,...],...]`.
    // Faction n becomes team n+1 (the player is always team 0) and every team
    // is hostile to every other, because Brain.target() already picks the
    // nearest fighter of ANY other team and combat.js already refuses to let a
    // swing land on your own team. The sim was N-faction all along; only the
    // resolution and the HUD ever assumed two sides.
    //
    // Roman name and Roman format: gladiators normally fought paired as
    // ORDINARII, but were sometimes sent in as CATERVARII — "in tumultuous
    // bodies", without science. That is also the licence for fielding more
    // opponents at lower skill, which is the difficulty lever an outnumbered
    // fight actually needs.
    //
    // Placement is RADIAL rather than two facing lines, or three factions all
    // spawn on top of each other on the same axis.
    if (d.factions && d.factions.length) {
      const teams = d.factions.length + 1;                 // +1 for the player
      d.factions.forEach((group, gi) => {
        const team = gi + 1;
        group.forEach((spec, i) => {
          const made = this._makeOpponent(spec, i, team);
          // Player sits at angle 0 (x = -14); spread the rest evenly around.
          const ang = ((gi + 1) / teams) * Math.PI * 2;
          const rad = 15 + i * 1.7;
          made.fighter.x = -Math.cos(ang) * rad;
          made.fighter.z = Math.sin(ang) * rad + (i - (group.length - 1) / 2) * 2.0;
          made.fighter.facing = Math.atan2(-made.fighter.x, -made.fighter.z);
          enroll(made, "opponent");
        });
      });
    } else {
      this._opponentSpecs().forEach((spec, i) => enroll(this._makeOpponent(spec, i, 1), "opponent"));
    }
    (d.beasts || []).forEach((b, i) => enroll(this._makeBeast(b, i), "beast"));

    // Allies fight on the player's side (2v2 and team munera).
    const allies = d.allies || (d.ally ? [d.ally] : []);
    allies.forEach((spec, i) => {
      const made = this._makeOpponent(spec, i, 0);
      made.fighter.x = -13 - i * 1.6;
      made.fighter.z = (i - 0.5) * 3.2;
      made.fighter.facing = Math.PI / 2;
      enroll(made, "ally");
    });

    this._setState(STATE.ENTRY);
    if (this.hooks.onSpawn) this.hooks.onSpawn(this.spawned);
    return this;
  }

  // -- state machine --------------------------------------------------------

  _setState(s) {
    this.state = s;
    this.stateT = 0;
    this.log.push({ t: +this.time.toFixed(2), state: s });
    if (this.hooks.onState) this.hooks.onState(s, this);
  }

  _cue(name, data = {}) {
    if (this.hooks.onCue) this.hooks.onCue(name, data);
  }

  /**
   * @param {number} dt
   * @param {object} playerCmd the command struct from Input (or a Brain, for a demo)
   */
  update(dt, playerCmd = {}) {
    this.time += dt;
    this.stateT += dt;

    switch (this.state) {
      case STATE.ENTRY:
        if (this.stateT === dt) this._cue("gate_open", { gate: "triumphalis" });
        if (this.stateT >= BEAT.entry) { this._cue("horn", { kind: "fanfare" }); this._setState(STATE.SALUTE); }
        break;

      case STATE.SALUTE:
        // Nothing can hurt anyone yet — a beat to read the opponent.
        if (this.stateT >= BEAT.salute) { this._cue("horn", { kind: "begin" }); this._setState(STATE.FIGHT); }
        break;

      case STATE.FIGHT:
        this._runFight(dt, playerCmd);
        break;

      case STATE.VERDICT:
        if (this.stateT >= BEAT.verdict) {
          this._cue("gate_open", { gate: "libitinaria" });
          this._setState(STATE.EXIT);
        }
        break;

      case STATE.EXIT:
        if (this.stateT >= BEAT.exit) this._finish();
        break;

      default: break;
    }
    return this.state;
  }

  _runFight(dt, playerCmd) {
    if (this.joust) {
      // Translate the standard command shape into lance intent: holding
      // attack couches; heavy aims high, pushing forward aims mid (the
      // default), pulling back aims low.
      const cmd = playerCmd || {};
      const aim = cmd.heavy ? "high" : (cmd.moveZ < -0.35 ? "low" : "mid");
      this.joust.update(dt, { aim, couch: !!cmd.attack || !!cmd.block });
      if (this.joust.result && !this.result) {
        this.crowdFavour = clamp(this.crowdFavour +
          (this.joust.result.by === "unhorse" ? 0.25 : 0.1), 0, 1);
        this._decide(this.joust.result.playerWon);
      }
      return;
    }
    // Player
    if (this.player.alive) this.combat.command(this.player, playerCmd || {});
    // Everyone else
    for (const [id, brain] of this.brains) {
      const f = this.combat.get(id);
      if (f && f.alive) this.combat.command(f, brain.update(dt));
    }
    this.combat.update(dt);

    // Crowd favour drifts toward how well the player is doing, and spikes on
    // spectacle. It is real money at settlement, so it must move on things the
    // player can influence.
    const hpFrac = this.player.alive ? this.player.hp / this.player.maxHp : 0;
    const target = clamp(0.25 + hpFrac * 0.4 + this.playerKills * 0.12, 0, 1);
    this.crowdFavour += (target - this.crowdFavour) * Math.min(1, 0.5 * dt);

    // --- resolution -------------------------------------------------------
    // Faction-agnostic. `living(1)` assumed exactly two sides, which is wrong
    // the moment a catervarii free-for-all fields three or four mutually
    // hostile factions: it counted only faction 1 and let the bout resolve as
    // a win while two other factions were still on their feet.
    const foesLeft = this.combat.hostilesTo(this.player.team).length;
    const alliesLeft = this.combat.living(this.player.team).length;

    if (!this.player.alive) { this._decide(false); return; }

    // Stalemate clock, for catervarii only.
    //
    // With three or more mutually hostile factions two AI parties can grind
    // each other indefinitely while the player circles the edge, and nothing
    // in the two-sided resolution ever fires. Measured: 1 stall in 20 seeds of
    // k2 before this existed. The summa rudis could and did stop a bout; the
    // fighter still standing with the most kills takes it.
    if (this.def.factions && this.stateT > 180) {
      const mine = this.playerKills;
      let best = 0;
      for (const f of this.combat.fighters) if (f.team !== this.player.team) best = Math.max(best, f.kills || 0);
      this._cue("summa_rudis", { reason: "time" });
      this._decide(mine >= best);
      return;
    }

    // THE SUMMA RUDIS STOPS EVERY BOUT, not only catervarii.
    //
    // No other match type had ANY time limit, so a fight that reached
    // equilibrium — two guards neither could break, or an exchange rhythm that
    // never produced a kill — simply ran forever. probe_match caught p3 and
    // then p1 stalled at its 240 s harness ceiling on specific seeds, and a
    // player in that bout would be equally stuck. Historically a munus that
    // dragged went to the editor's decision on the fighters' condition
    // (stantes missi — both sent home standing); here the referee calls it on
    // remaining condition: the side in better shape takes the verdict.
    if (this.stateT - (this._engagementT || 0) > 150) {
      const side = (team) => {
        let hp = 0, max = 0;
        for (const f of this.combat.fighters) {
          if (f.team !== team || !f.alive) continue;
          hp += f.hp; max += f.maxHp;
        }
        return max > 0 ? hp / max : 0;
      };
      let foesBest = 0;
      const seen = new Set();
      for (const f of this.combat.fighters) {
        if (f.team === this.player.team || !f.alive || seen.has(f.team)) continue;
        seen.add(f.team);
        foesBest = Math.max(foesBest, side(f.team));
      }
      this._cue("summa_rudis", { reason: "time" });
      this._decide(side(this.player.team) >= foesBest);
      return;
    }

    if (foesLeft === 0) {
      // Survival waves and the tertiarius surprise both reuse this hook.
      if (this.def.type === "survival" && this.wave + 1 < (this.def.waves || 1)) {
        this.wave++;
        // Fresh opponents restart the summa rudis clock — the verdict rule
        // bounds each ENGAGEMENT, not the whole gauntlet, or a multi-stage
        // bout could be called before its later stages ever walked out.
        this._engagementT = this.stateT;
        this._spawnWave();
        return;
      }
      if (this.def.tertiarius && !this._tertiariusSent) {
        this._tertiariusSent = true;
        this._engagementT = this.stateT;   // same rule as waves
        this._cue("horn", { kind: "tertiarius" });
        const made = this._makeOpponent(this.def.tertiarius, 9, 1);
        made.fighter.x = 16; made.fighter.z = 0;
        const f = this.combat.add(made.fighter);
        this.brains.set(f.id, new Brain(f, { skill: made.skill, style: made.style, seed: Math.floor(this.rng() * 1e9), combat: this.combat }));
        this.spawned.push({ fighter: f, role: "tertiarius" });
        if (this.hooks.onSpawn) this.hooks.onSpawn([{ fighter: f, role: "tertiarius" }]);
        return;
      }
      this._decide(true);
      return;
    }

    if (alliesLeft === 0) { this._decide(false); return; }
  }

  _spawnWave() {
    // THE BREATHER BETWEEN WAVES.
    //
    // Survival ran continuously: no stamina back, no wound relief, waves
    // growing from 1 to 4 opponents. With the id collision fixed the bout
    // stopped hanging and started simply killing the player at wave 2 of 5 —
    // still 0% across 20 seeds, because there is no way to out-fight an
    // escalating queue while your own resources only ever go down.
    //
    // Real munera had intervals. Water, sponges, the sand raked, sometimes the
    // hydraulis playing — a fighter was a valuable animal and was not run to
    // death without pause. Stamina fully returns and a little health with it;
    // wounds stay, so the fight still accumulates and a long survival still
    // ends you.
    if (this.player && this.player.alive && this.wave > 0) {
      this.player.stamina = this.player.maxStamina;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + this.player.maxHp * 0.18);
      this._cue("interval", { wave: this.wave + 1 });
    }
    const pool = ["thraex", "murmillo", "hoplomachus", "dimachaerus"];
    const n = 1 + Math.floor(this.wave / 2);
    const fresh = [];
    for (let i = 0; i < n; i++) {
      const made = this._makeOpponent(
        { armatura: pool[Math.floor(this.rng() * pool.length)], skill: this.def.opponents?.[0]?.skill || "gregarius" },
        i, 1
      );
      const f = this.combat.add(made.fighter);
      this.brains.set(f.id, new Brain(f, { skill: made.skill, style: made.style, seed: Math.floor(this.rng() * 1e9), combat: this.combat }));
      const rec = { fighter: f, role: "opponent" };
      this.spawned.push(rec);
      fresh.push(rec);
    }
    this._cue("horn", { kind: "wave" });
    this._cue("wave", { wave: this.wave + 1, of: this.def.waves });
    if (this.hooks.onSpawn) this.hooks.onSpawn(fresh);
  }

  /**
   * Ad digitum. The loser raises a finger; the editor decides. Missio is the
   * norm — trained gladiators were expensive, and roughly 1 bout in 10 ended
   * in a death.
   */
  _decide(playerWon) {
    const lethal = this.def.lethal !== false;
    let spared = true;
    if (lethal) {
      // A well-fought bout is far more likely to earn the reprieve.
      const base = MUNUS.surrender.missioChance;
      const favour = playerWon ? this.crowdFavour : this.crowdFavour * 0.75;
      spared = this.rng() < clamp(base * (0.55 + favour * 0.7), 0, 0.98);
    }
    this.verdict = { playerWon, spared, crowdFavour: +this.crowdFavour.toFixed(2) };
    this._cue("verdict", this.verdict);
    this._setState(STATE.VERDICT);
  }

  _finish() {
    const v = this.verdict || { playerWon: false, spared: true };
    const flawless = v.playerWon && !this.tookDamage;
    const settled = this.inv.settle({
      won: v.playerWon,
      kills: this.playerKills,
      flawless,
      crowdFavour: this.crowdFavour,
      matchId: this.def.id,
      bonus: this.def.purse ? Math.round(this.def.purse * 0.35) : 0,
      // Wear inputs. Tallied from the bout's own hit events so a long, bloody
      // fight costs more at the smith than a quick clean one.
      damageDealt: this._dmgDealt || 0,
      damageTaken: this._dmgTaken || 0,
      blocks: this._blocks || 0,
    });
    this.result = {
      ...v, flawless, kills: this.playerKills,
      purse: settled.purse, gold: settled.gold,
      rankUp: settled.rankUp ? settled.rankUp.name : null,
      rank: settled.rank.name,
      duration: +this.time.toFixed(1),
    };
    this.inv.save();
    this._setState(STATE.DONE);
    if (this.hooks.onResult) this.hooks.onResult(this.result);
  }

  // -- combat event routing --------------------------------------------------

  _onCombatEvent(e) {
    if (e.type === "hit") {
      // Tally what the smith will charge for. A shield that stopped a lot and
      // a blade that did a lot of work both come home needing attention.
      if (e.target === "player") { this.tookDamage = true; this._dmgTaken = (this._dmgTaken || 0) + (e.damage || 0); }
      if (e.attacker === "player") {
        this._dmgDealt = (this._dmgDealt || 0) + (e.damage || 0);
        this.crowdFavour = clamp(this.crowdFavour + (e.heavy ? 0.05 : 0.02), 0, 1);
      }
    } else if ((e.type === "block" || e.type === "parry") && e.target === "player") {
      this._blocks = (this._blocks || 0) + 1;
      if (e.type === "parry") this.crowdFavour = clamp(this.crowdFavour + 0.06, 0, 1);
    } else if (e.type === "death") {
      if (e.by === "player") { this.playerKills++; this.crowdFavour = clamp(this.crowdFavour + 0.16, 0, 1); }
    }
    // (the old standalone parry branch lived here and is now unreachable — the
    // block/parry case above catches it and awards the same favour)
    if (this.hooks.onEvent) this.hooks.onEvent(e);
  }

  // -- readouts -------------------------------------------------------------

  snapshot() {
    return {
      state: this.state, stateT: +this.stateT.toFixed(2), time: +this.time.toFixed(2),
      crowdFavour: +this.crowdFavour.toFixed(3),
      wave: this.wave, kills: this.playerKills,
      combat: this.combat.snapshot(),
      result: this.result,
    };
  }

  /** HUD-facing view of the player and the current primary threat. */
  hudState() {
    const p = this.player;
    const foes = this.combat.hostilesTo(p ? p.team : 0);
    const foe = foes.length
      ? foes.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b))
      : null;
    if (this.joust) {
      const o = this.joust.riders.opponent;
      return {
        state: this.state,
        player: p ? { name: p.name, hp: Math.max(0, p.hp), maxHp: p.maxHp,
          stamina: p.stamina, maxStamina: p.maxStamina,
          shieldHp: 0, shieldBroken: false, phase: p.phase, combo: 0, alive: p.alive } : null,
        foe: { name: o.name, title: "Eques", hp: Math.max(0, o.hp), maxHp: o.maxHp,
          phase: o.phase, alive: o.alive, isBeast: false },
        foesLeft: o.alive ? 1 : 0,
        crowdFavour: this.crowdFavour,
        wave: 1, waves: 1,
        joust: this.joust.snapshot(),
      };
    }
    return {
      state: this.state,
      player: p ? {
        name: p.name, hp: Math.max(0, p.hp), maxHp: p.maxHp,
        stamina: Math.max(0, p.stamina), maxStamina: p.maxStamina,
        shieldHp: p.shieldHp, shieldBroken: p.shieldBroken,
        phase: p.phase, combo: p.comboCount, alive: p.alive,
        // the guard compass reads these
        blocking: p.blocking, blockDir: p.blockDir || null,
        attackDir: (p.phase === PHASE.WINDUP || p.phase === PHASE.ACTIVE) ? p.attackDir : null,
      } : null,
      foe: foe ? {
        name: foe.name, title: foe.displayTitle || "",
        hp: Math.max(0, foe.hp), maxHp: foe.maxHp,
        phase: foe.phase, alive: foe.alive, isBeast: foe.isBeast,
        // the guard-break economy, finally visible
        stamina: Math.max(0, foe.stamina), maxStamina: foe.maxStamina,
        shieldFrac: (foe.shieldId && foe.shieldId !== "none" && foe.shieldHpMax)
          ? Math.max(0, foe.shieldHp) / foe.shieldHpMax
          : (foe.shieldId && foe.shieldId !== "none" && foe.shieldHp > 0 ? Math.min(1, foe.shieldHp / 100) : null),
      } : null,
      // Every hostile mid-attack: the HUD draws a direction telegraph over
      // their head and clamps it to the screen edge when off-frustum.
      threats: foes.filter((f) => f.alive && (f.phase === PHASE.WINDUP || f.phase === PHASE.ACTIVE))
        .map((f) => ({
          x: f.x, z: f.z, dir: f.attackDir || "high", phase: f.phase,
          frac: f.phase === PHASE.ACTIVE ? 1 :
            Math.min(1, f.phaseT / Math.max(0.05, f.weapon ? f.weapon.windup : 0.4)),
        })),
      foesLeft: foes.length,
      crowdFavour: this.crowdFavour,
      wave: this.wave + 1, waves: this.def.waves || 1,
    };
  }
}
