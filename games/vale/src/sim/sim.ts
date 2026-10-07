// VALE sim — the facade (CONTRACT §5.1): createSim(catalog, setup, opts?) → SimApi.
//
// One World per match, every system registered here in the CONTRACT §5.1 order (the list below is
// the authority; a system appended to a phase runs after the ones before it):
//
//   commands    phase gate (pre-game / ended)          modes/match.ts
//               core commands; other types → hooks.command: buy sell undo swapItems (shop.ts),
//               recall (units/fighters.ts), surrenderVote (modes/match.ts), practice
//               (modes/practice.ts), ping (here: rate-limited 'ping' event)
//   statuses    core
//   regen       core regen · fountain                   units/fighters.ts
//   casts       core casts/channels · recall channel    units/fighters.ts
//   attacks · projectiles · zones · movement            core
//   ai          waves · minions · towers · camps · summons · pickups      units/*
//   bots        BotController.think per bot seat → commands for the next tick
//   deaths      core expiry · fighter respawns · gate respawns · camp spawns · passive gold ·
//               practice upkeep
//   vision      core (10 Hz)
//   modes       sudden death · views (canShop, team gold) · gold graph · ModeRules.check → end
//
// hooks.death order (one kill → all of these, in this order): economy (gold, xp, streaks,
// takedown) → fighters (respawn timer, recall) → structures (structure event, protection,
// team buff) → monsters (camp timer, objective) → mode rules (score, lives, elimination).
//
// Bots: createSim(catalog, setup, { bots: (seat, host) => BotController }) registers a controller
// for every seat whose controller is 'bot' (the BOTS lane, src/sim/bots/, provides them). Each
// tick in the 'bots' phase think(view, player) returns Commands queued exactly like a human's
// (applied next tick). A controller that throws is disabled for the rest of the match and the
// error is recorded in Sim.faults — a bad bot never takes the match down.
// Commands from an eliminated seat (Fray) are dropped, except pings.

import type { CatalogT } from '../contracts/catalog.ts';
import type {
  Command, MatchSetup, PlayerId, PlayerView, SeatSetup, SimApi, SimEvent, WorldView,
} from '../contracts/sim.ts';
import { indexCatalog, type CatalogIndex } from './catalog_index.ts';
import { damageLogFor } from './combat.ts';
import { installCore } from './core.ts';
import { initEconomyViews, installEconomy, passiveGoldSystem } from './economy.ts';
import { finalizeStates } from './movement.ts';
import { modeRulesFor, isFfa } from './modes/index.ts';
import {
  DEFAULT_PREGAME, endMatch, goldGraphSystem, initMatch, matchOf, phaseGateSystem, suddenDeathSystem, surrenderCommand,
  teamViewSystem,
} from './modes/match.ts';
import { initPractice, installPractice, practiceSystem } from './modes/practice.ts';
import { stream, type Rng } from './rng.ts';
import { installShop, shopViewSystem } from './shop.ts';
import { damageMultHook, noteAttack, unitAcquireScore } from './units/common.ts';
import {
  fountainSystem, installFighters, recallSystem, respawnSystem, seatState, spawnSeatFighters,
} from './units/fighters.ts';
import { minionSystem, initWaves, waveSystem } from './units/minions.ts';
import { campSystem, initCamps, installMonsters, monsterSystem } from './units/monsters.ts';
import { initPickups, pickupSystem } from './units/pickups.ts';
import { installStructures, spawnStructures, structureRespawnSystem, towerSystem } from './units/structures.ts';
import { summonSystem, wardSpawnHook } from './units/summons.ts';
import { validCommand, World } from './world.ts';

export { DEFAULT_PREGAME } from './modes/match.ts';

/** a bot seat's brain (lane BOTS). Reads the same view a player would; returns this tick's commands. */
export interface BotController {
  think(world: WorldView, player: PlayerView): readonly Command[];
}
/** what a bot factory gets besides its seat: the catalog and a seeded stream of its own */
export interface BotHost {
  readonly catalog: CatalogT;
  readonly setup: MatchSetup;
  /** deterministic per-seat stream ('bots:<player>' of the match seed) */
  readonly rng: Rng;
}
export interface SimOptions {
  /** controller for each bot seat; return null to leave a seat idle */
  bots?: (seat: SeatSetup, host: BotHost) => BotController | null | undefined;
  /** pre-game countdown in seconds (default DEFAULT_PREGAME; 0 starts live) */
  pregameSeconds?: number;
}

/** SimApi plus harness/tooling access (the presentation only ever sees SimApi) */
export interface Sim extends SimApi {
  /** the current World (replaced by a practice resetMatch) */
  readonly world: World;
  /** bot controllers that threw and were disabled */
  readonly faults: readonly string[];
}

/** pings per seat allowed within PING_WINDOW seconds */
export const PING_LIMIT = 5;
export const PING_WINDOW = 4;

// ── setup validation ────────────────────────────────────────────────────────────────────────────
function validate(idx: CatalogIndex, setup: MatchSetup): void {
  const n = setup.seats.length;
  if (n === 0) throw new Error('createSim: no seats');
  const seen = new Set<number>();
  for (const s of setup.seats) {
    if (!Number.isInteger(s.player) || s.player < 0 || s.player >= n || seen.has(s.player)) {
      throw new Error(`createSim: seat players must be 0..${n - 1}, each once (got ${s.player})`);
    }
    seen.add(s.player);
    if (!Number.isInteger(s.team) || s.team < 0) throw new Error(`createSim: seat ${s.player} has team ${s.team}`);
    if (!idx.fighters.has(s.fighter)) throw new Error(`createSim: seat ${s.player} fighter '${s.fighter}' is not in the catalog`);
    const skin = idx.skins.get(s.skin);
    if (!skin || skin.fighter !== s.fighter) throw new Error(`createSim: seat ${s.player} skin '${s.skin}' is not a skin of '${s.fighter}'`);
  }
}

// ── building one match world ────────────────────────────────────────────────────────────────────
interface BotSlot { player: PlayerId; ctrl: BotController | null }

function buildWorld(catalog: CatalogT, setup: MatchSetup, opts: SimOptions, idx: CatalogIndex, faults: string[]): World {
  validate(idx, setup);
  const w = new World(catalog, setup, idx);
  const ffa = isFfa(w);
  const rules = modeRulesFor(w.rules.end.kind);
  initMatch(w, opts.pregameSeconds ?? DEFAULT_PREGAME, ffa);

  // hooks (death order matters: see header)
  installEconomy(w, ffa);
  installFighters(w);
  installStructures(w);
  installMonsters(w);
  installShop(w);
  installPractice(w);
  w.hooks.death.push((ww, victim, killer) => rules.onDeath(ww, victim, killer));
  w.hooks.damage.push((ww, src, dst) => noteAttack(ww, src, dst));
  w.hooks.modifyDamage.push((ww, src, dst, raw) => damageMultHook(ww, src, dst, raw));
  w.hooks.acquireScore = unitAcquireScore;
  w.hooks.spawn.push(wardSpawnHook);
  const pings: number[][] = setup.seats.map(() => []);
  w.hooks.command.ping = (ww, p, cmd) => {
    if (cmd.type !== 'ping') return;
    const recent = pings[p.player].filter((t) => ww.time - t < PING_WINDOW);
    if (recent.length >= PING_LIMIT) { pings[p.player] = recent; return; }
    recent.push(ww.time);
    pings[p.player] = recent;
    ww.emit({ e: 'ping', t: ww.time, player: p.player, kind: cmd.kind, x: cmd.x, y: cmd.y, target: cmd.target });
  };
  w.hooks.command.surrenderVote = (ww, p, cmd) => { if (cmd.type === 'surrenderVote') surrenderCommand(ww, p, cmd.yes); };

  // systems, phase by phase (CONTRACT §5.1)
  w.addSystem('commands', phaseGateSystem);   // must precede the core command system
  installCore(w);
  w.addSystem('regen', fountainSystem);
  w.addSystem('casts', recallSystem);
  w.addSystem('ai', waveSystem);
  w.addSystem('ai', minionSystem);
  w.addSystem('ai', towerSystem);
  w.addSystem('ai', monsterSystem);
  w.addSystem('ai', summonSystem);
  w.addSystem('ai', pickupSystem);
  const bots: BotSlot[] = [];
  w.addSystem('bots', (ww) => {
    if (ww.phase === 'ended') return;
    for (const b of bots) {
      if (!b.ctrl) continue;
      const p = ww.players[b.player];
      let cmds: readonly Command[];
      try {
        cmds = b.ctrl.think(ww, p);
        if (!Array.isArray(cmds)) throw new Error(`think() returned ${cmds === null ? 'null' : typeof cmds}, not an array of commands`);
      } catch (err) { faults.push(`bot ${b.player} @${ww.tick}: ${(err as Error)?.stack ?? String(err)}`); b.ctrl = null; continue; }
      for (const c of cmds) submit(ww, b.player, c);   // malformed entries are dropped by submit
    }
  });
  w.addSystem('deaths', respawnSystem);
  w.addSystem('deaths', structureRespawnSystem);
  w.addSystem('deaths', campSystem);
  w.addSystem('deaths', passiveGoldSystem);
  w.addSystem('deaths', practiceSystem);
  w.addSystem('modes', suddenDeathSystem);
  w.addSystem('modes', shopViewSystem);
  w.addSystem('modes', teamViewSystem);
  w.addSystem('modes', goldGraphSystem);
  w.addSystem('modes', (ww) => {
    if (ww.phase !== 'live') return;
    const o = rules.check(ww);
    if (o) endMatch(ww, o);
  });

  // the match as it stands at time −pregame
  spawnSeatFighters(w);
  rules.init(w);
  initEconomyViews(w);
  spawnStructures(w);
  initWaves(w);
  initCamps(w);
  initPickups(w);
  initPractice(w);
  shopViewSystem(w);
  teamViewSystem(w);
  if (opts.bots) {
    for (const seat of [...setup.seats].sort((a, b) => a.player - b.player)) {
      if (seat.controller !== 'bot') continue;
      const ctrl = opts.bots(seat, { catalog, setup, rng: stream(setup.seed, `bots:${seat.player}`) }) ?? null;
      bots.push({ player: seat.player, ctrl });
    }
  }
  // nav's corner graph and connectivity labels build lazily on first use; build them now so the
  // cost lands in match loading instead of a mid-match hitch
  w.nav.graphNodeCount();
  w.nav.componentAt(0, 0);
  finalizeStates(w);
  w.vision.update(w.entities, w.tick);
  return w;
}

/** queue a command for a seat (malformed commands, bad seats and eliminated seats' non-ping commands are dropped) */
function submit(w: World, player: PlayerId, cmd: Command): void {
  if (!validCommand(cmd) || !w.players[player] || w.phase === 'ended') return;
  if (cmd.type !== 'ping' && seatState(w, player)?.eliminated) return;
  w.command(player, cmd);
}

class SimHost implements Sim {
  world: World;
  readonly faults: string[] = [];
  private readonly catalog: CatalogT;
  private readonly setup: MatchSetup;
  private readonly opts: SimOptions;
  private readonly idx: CatalogIndex;

  constructor(catalog: CatalogT, setup: MatchSetup, opts: SimOptions) {
    this.catalog = catalog; this.setup = setup; this.opts = opts;
    this.idx = indexCatalog(catalog);
    this.world = buildWorld(catalog, setup, opts, this.idx, this.faults);
  }
  get view(): WorldView { return this.world; }
  command(player: PlayerId, cmd: Command): void { submit(this.world, player, cmd); }
  step(): SimEvent[] {
    const w = this.world;
    if (w.phase === 'ended') return [];
    const ev = w.step();
    if (matchOf(w).resetRequested) {
      this.world = buildWorld(this.catalog, this.setup, this.opts, this.idx, this.faults);
      ev.push({ e: 'announce', t: this.world.time, key: 'practice_reset' });
    }
    return ev;
  }
  damageLog(player: PlayerId): ReturnType<SimApi['damageLog']> { return damageLogFor(this.world, player); }
}

/** the match simulation for a setup (CONTRACT §5.1); deterministic for (catalog, setup, commands) */
export function createSim(catalog: CatalogT, setup: MatchSetup, opts: SimOptions = {}): Sim {
  return new SimHost(catalog, setup, opts);
}

/** harness/tooling: the live World behind a SimApi created by createSim */
export function worldOf(sim: SimApi): World {
  const w = (sim as Partial<Sim>).world;
  if (!w) throw new Error('worldOf: not a sim created by createSim');
  return w;
}
