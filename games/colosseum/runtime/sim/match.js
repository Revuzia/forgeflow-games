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
    const f = new Fighter({
      id: "player", name: this.inv.name || "You", team: 0,
      weapon: lw.weapon, shield: lw.shield, armour: lw.armour,
      hp: arm ? arm.hp : 105,
      x: -14, z: 0, facing: Math.PI / 2,
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
    const f = new Fighter({
      id: `opp${index}_${o.armatura}`, name: o.name, team,
      weapon: o.loadout.weapon, shield: o.loadout.shield, armour: o.loadout.armour,
      hp: base.hp || 100,
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

    this._opponentSpecs().forEach((spec, i) => enroll(this._makeOpponent(spec, i, 1), "opponent"));
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
    const foesLeft = this.combat.living(1).length;
    const alliesLeft = this.combat.living(0).length;

    if (!this.player.alive) { this._decide(false); return; }

    if (foesLeft === 0) {
      // Survival waves and the tertiarius surprise both reuse this hook.
      if (this.def.type === "survival" && this.wave + 1 < (this.def.waves || 1)) {
        this.wave++;
        this._spawnWave();
        return;
      }
      if (this.def.tertiarius && !this._tertiariusSent) {
        this._tertiariusSent = true;
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
      if (e.target === "player") this.tookDamage = true;
      if (e.attacker === "player") this.crowdFavour = clamp(this.crowdFavour + (e.heavy ? 0.05 : 0.02), 0, 1);
    } else if (e.type === "death") {
      if (e.by === "player") { this.playerKills++; this.crowdFavour = clamp(this.crowdFavour + 0.16, 0, 1); }
    } else if (e.type === "parry" && e.target === "player") {
      this.crowdFavour = clamp(this.crowdFavour + 0.06, 0, 1);   // the mob loves a parry
    }
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
    const foes = this.combat.living(1);
    const foe = foes.length
      ? foes.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b))
      : null;
    return {
      state: this.state,
      player: p ? {
        name: p.name, hp: Math.max(0, p.hp), maxHp: p.maxHp,
        stamina: Math.max(0, p.stamina), maxStamina: p.maxStamina,
        shieldHp: p.shieldHp, shieldBroken: p.shieldBroken,
        phase: p.phase, combo: p.comboCount, alive: p.alive,
      } : null,
      foe: foe ? {
        name: foe.name, title: foe.displayTitle || "",
        hp: Math.max(0, foe.hp), maxHp: foe.maxHp,
        phase: foe.phase, alive: foe.alive, isBeast: foe.isBeast,
      } : null,
      foesLeft: foes.length,
      crowdFavour: this.crowdFavour,
      wave: this.wave + 1, waves: this.def.waves || 1,
    };
  }
}
