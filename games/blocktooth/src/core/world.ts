// BLOCKTOOTH — the sim hub: world construction + THE fixed-tick step order.
// THREE-FREE. Every import below is a CONTRACT (CONTRACT.md §5): the owning lane must
// export exactly these names with exactly these signatures.
//
// B-CORE (online VS): the World holds 1..4 PlayerStates (core/players.ts bindPlayer = the cursor; _spec/online/
// CORE_CONTRACT.md is the full contract). Solo (mode 'solo', exactly 1 player) runs the SAME step order as before,
// byte for byte; VS adds hook points (src/vs/step.ts) and runs the per-player systems once per seat.

import type { GameMode, PlayerSeat, PlayerState, RunOptions, TitanInput, World } from './types.ts';
import { MAX_PLAYERS } from './types.ts';
import { SIM_DT, VS } from './config.ts';
import { makeStreams } from './rng.ts';
import { bindPlayer, createEventSink, seatActive, unbindPlayer } from './players.ts';

import { TITANS } from '../data/titans.ts';
import { BIOMES } from '../data/biomes.ts';

import { generateCity } from '../city/citygen.ts';
import { stepCity } from '../city/citysim.ts';
import { createTitan, stepTitan } from '../titans/titansim.ts';
import { rebuildEnemyGrid } from '../combat/spatial.ts';
import { stepProjectiles } from '../combat/projectiles.ts';
import { stepTelegraphs } from '../combat/telegraphs.ts';
import { stepHazards } from '../combat/hazards.ts';
import { stepPickups } from '../combat/pickups.ts';
import { createDirector, stepDirector } from '../ai/director.ts';
import { stepEnemies } from '../ai/enemies.ts';
import { stepBoss } from '../ai/bosses/index.ts';
import { createUpgradeState, recomputeStats } from '../upgrades/stats.ts';
import { stepUpgrades, processTriggers, processTriggersFrom } from '../upgrades/engine.ts';
import { stepRail } from '../upgrades/rail.ts';   // VS CARD RAIL (stub: lane B-TITAN fills it)
// v2 (FEATURES_V2 §2.3) — meta systems (L0 stubs; lanes L1/L4/L5 fill them)
import { chargeUltimate, createUltState, stepUltimate } from '../meta/ultimate.ts';
import { createMapState, stepObjectives } from '../meta/objectives.ts';
import { stepPowerups } from '../meta/powerups.ts';
import { createTally, stepTally } from '../meta/tally.ts';
import { stepEndless } from '../meta/endless.ts';
import { applyPerk, sanitizeRunMeta, tryRevive } from '../meta/perks.ts';
// GATEKEEPERS (§7.3) — the size gates (lane K0 skeleton: inert stub; lane K1a fills it)
import { createGates, flushGateBreach, stepGates } from '../meta/gates.ts';
// ONLINE VS (B-CORE) — state factories + the four per-tick hook points (lane B-VS owns both files)
import { createBotMemory, createPlayerVs, createVsWorld, vsSpawnPoints } from '../vs/state.ts';
import { vsAfterTitans, vsBeginTick, vsEndTick, vsStepWorld } from '../vs/step.ts';

export const NO_INPUT: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };

/** Monotonic entity id. Every spawned thing (enemy, projectile, telegraph, hazard, pickup) takes one. */
export function newId(w: World): number { return w.nextId++; }

/** One seat's containers, built exactly like the old single-titan createWorld built them (solo: byte-identical). */
function createPlayer(slot: number, seat: PlayerSeat, mode: GameMode, spawn: { x: number; z: number; heading: number }, soloMeta: RunOptions['meta']): PlayerState {
  const def = TITANS[seat.titan];
  if (!def) throw new Error(`createWorld: unknown titan '${String(seat.titan)}' for seat ${slot}`);
  // VS plays the fresh-profile pool (vs_design.md §7): no unlocked cards, no perk; the cosmetic palette stays
  const meta = mode === 'vs'
    ? sanitizeRunMeta({ unlocked: [], perk: null, palette: seat.meta ? seat.meta.palette : 0, reviveUsed: false })
    : sanitizeRunMeta(seat.meta ?? soloMeta);
  return {
    slot,
    titanId: seat.titan,
    titan: createTitan(def, spawn),
    upgrades: createUpgradeState(),
    ult: createUltState(),
    tally: createTally(),
    meta,
    input: { ...NO_INPUT },
    director: createDirector(),
    rail: { open: false, openedT: -1, expireT: Infinity, chest: false, seq: 0, sinceDraft: 0, openingDone: false, data: {} },
    run: { tonnage: 0, blocksLeveled: 0, peakRank: 0 },
    vs: createPlayerVs(),
    bot: seat.bot ? createBotMemory(seat.bot) : null,
  };
}

export function createWorld(opts: RunOptions): World {
  const mode: GameMode = opts.mode ?? 'solo';
  const seats: PlayerSeat[] = opts.players && opts.players.length > 0
    ? opts.players
    : [{ titan: opts.titan as NonNullable<RunOptions['titan']>, meta: opts.meta }];
  if (mode === 'solo' && seats.length !== 1) throw new Error(`createWorld: solo needs exactly 1 seat (got ${seats.length})`);
  if (seats.length < 1 || seats.length > MAX_PLAYERS) throw new Error(`createWorld: 1..${MAX_PLAYERS} seats (got ${seats.length})`);
  let biome = BIOMES[opts.biome];
  // VS: a bigger arena (VS.cityScale x the biome's block grid; 1 = the solo city). Solo never takes this branch.
  if (mode === 'vs') biome = { ...biome, blocks: [Math.max(4, Math.round(biome.blocks[0] * VS.cityScale)), Math.max(4, Math.round(biome.blocks[1] * VS.cityScale))] };
  const rng = makeStreams(opts.seed);
  const city = generateCity(biome, opts.seed, rng.city);
  const spawns = mode === 'vs' ? vsSpawnPoints(city, seats.length) : [city.spawn];
  const players: PlayerState[] = [];
  for (let i = 0; i < seats.length; i++) players.push(createPlayer(i, seats[i], mode, spawns[i], opts.meta));
  const p0 = players[0];
  const w: World = {
    seed: opts.seed,
    titanId: p0.titanId,
    biomeId: opts.biome,
    tick: 0,
    t: 0,
    dt: SIM_DT,
    rng,
    city,
    titan: p0.titan,
    enemies: [],
    projectiles: [],
    telegraphs: [],
    hazards: [],
    pickups: [],
    boss: null,
    director: p0.director,
    upgrades: p0.upgrades,
    run: { phase: 'intro', endT: -1, result: null, tonnage: 0, blocksLeveled: 0, peakRank: 0 },
    events: [],
    input: p0.input,
    cheats: { god: false, noSpawns: false },
    nextId: 1,
    // v2 (FEATURES_V2 §2.3)
    meta: p0.meta,
    ult: p0.ult,
    map: createMapState(),
    tally: p0.tally,
    endless: null,
    // GATEKEEPERS §7.3
    gates: createGates(),
    // B-CORE (online VS)
    mode,
    players,
    cur: 0,
    pl: p0,
    view: opts.view !== undefined && opts.view >= 0 && opts.view < players.length ? opts.view : 0,
    vs: mode === 'vs' ? createVsWorld(city) : null,
  };
  w.events = createEventSink(w);
  // each seat: stats from its (empty) builds, then its perk, then full HP — the old single-titan sequence per player
  for (let i = 0; i < players.length; i++) {
    bindPlayer(w, i);
    recomputeStats(w);
    applyPerk(w);           // v2: after recomputeStats, before hp = maxHp
    w.titan.hp = w.titan.maxHp;
  }
  if (mode === 'vs') w.gates.unlocked = 4;   // no size locks in VS (vs_design.md §4.1): ranks come from RANK_LEVELS alone
  bindPlayer(w, w.view);
  return w;
}

/** Point the app's view at seat `slot` (spectate / the local seat). The sim never reads it; the cursor is rebound. */
export function setViewSlot(w: World, slot: number): void {
  if (slot < 0 || slot >= w.players.length) return;
  w.view = slot;
  bindPlayer(w, slot);
}

function snapshotPrev(w: World): void {
  for (let i = 0; i < w.players.length; i++) {
    const T = w.players[i].titan;
    T.px = T.x; T.pz = T.z; T.pheading = T.heading;
  }
  for (const e of w.enemies) { e.px = e.x; e.pz = e.z; e.py = e.y; e.pheading = e.heading; }
  for (const p of w.projectiles) { p.px = p.x; p.pz = p.z; p.py = p.y; }
  for (const p of w.pickups) { p.px = p.x; p.pz = p.z; p.py = p.y; }
  for (const p of w.city.props) if (p.lane >= 0) { p.px = p.x; p.pz = p.z; p.pheading = p.heading; }
  if (w.boss) { w.boss.px = w.boss.x; w.boss.pz = w.boss.z; w.boss.pheading = w.boss.heading; }
}

/** Drop dead pooled entities so arrays stay short. Views track entities by id, never by index. */
function compact(w: World): void {
  const keep = <T extends { alive: boolean }>(a: T[]) => { let j = 0; for (let i = 0; i < a.length; i++) if (a[i].alive) a[j++] = a[i]; a.length = j; };
  keep(w.enemies); keep(w.projectiles); keep(w.telegraphs); keep(w.hazards); keep(w.pickups);
  keep(w.map.objectives); keep(w.map.powerups);   // v2
}

/** SOLO run end (the bound player is slot 0). VS decides its end in vsEndTick (src/vs/step.ts). */
function checkRunEnd(w: World): void {
  if (w.run.result) return;
  if (!w.titan.alive) {
    if (tryRevive(w)) return;                             // v2: perk STAY OF DEMOLITION (§8.5)
    w.run.result = 'dead'; w.run.phase = 'dead'; w.run.endT = w.t;
    w.events.push({ type: 'runEnd', result: 'dead' });
  } else if (!w.endless && w.director.bossSpawned && w.boss && !w.boss.alive && w.boss.role === 'main'
             && w.gates.finaleDone) {   // v2: in endless only death ends the run · GATEKEEPERS §4.3 v3: after the finale
    w.run.result = 'clear'; w.run.phase = 'clear';
    w.run.endT = w.gates.mainKillT >= 0 ? w.gates.mainKillT : w.t;   // the clear time is the kill, not the finale's end
    w.events.push({ type: 'runEnd', result: 'clear' });
  }
}

/** One-element input list for the single-seat entry point (no per-tick allocation). */
const ONE_INPUT: TitanInput[] = [NO_INPUT];

/**
 * Advance the simulation exactly one fixed tick (SOLO and single-seat entry point: `input` is slot 0's command; in a
 * multi-seat world the other seats keep their previous input). The app never calls this while a draft,
 * pause, slate or run-end screen owns the game (the sim is frozen, not slowed).
 * ORDER IS CONTRACT — see CONTRACT.md §5.2 and _spec/online/CORE_CONTRACT.md §4.
 */
export function stepWorld(w: World, input: TitanInput): void {
  ONE_INPUT[0] = input;
  stepWorldN(w, ONE_INPUT);
}

/**
 * The multi-seat tick. `inputs[i]` is seat i's command for this tick; null / undefined / a missing entry = keep the
 * seat's previous input (a late guest's input repeats; a bot seat's input is written by the VS bot brain in
 * vsBeginTick). Per-tick player order = slot order 0..n-1, always.
 *
 * Per-player systems run once per active (non-eliminated) seat with that seat BOUND (cursor + event tagging);
 * world-scoped systems run once. In solo there is one seat, always bound, and no VS hook runs: the sequence of
 * system calls is exactly the pre-B-CORE stepWorld.
 */
export function stepWorldN(w: World, inputs: readonly (TitanInput | null | undefined)[]): void {
  if (w.run.result) return;
  const vs = w.mode === 'vs';
  const ps = w.players;
  const n = ps.length;
  w.events.length = 0;
  for (let i = 0; i < n; i++) { const inp = inputs[i]; if (inp) ps[i].input = inp; }
  bindPlayer(w, 0);                 // deterministic baseline binding at the start of every tick (never the view slot)
  snapshotPrev(w);
  w.tick++;
  w.t += w.dt;
  if (w.run.phase === 'intro') w.run.phase = 'waves';

  if (vs) { unbindPlayer(w); vsBeginTick(w); }

  stepCity(w);            // traffic, scared cars, blocks-leveled bookkeeping
  rebuildEnemyGrid(w);    // broadphase for the titan's attacks
  for (let i = 0; i < n; i++) {
    if (!seatActive(w, ps[i])) continue;
    bindPlayer(w, i);
    stepUltimate(w);      // v2: UPROAR fire (input.ultimate) + roar/blast + bank flush — BEFORE stepTitan (invuln + roar move on the fire tick)
    stepTitan(w);         // move, dash, leash, collide, contact smash/crush, footsteps, regen, kit (auto + hook)
    stepDirector(w);      // waves, elite + run.phase transitions (the boss block moved to stepGates, GATEKEEPERS §7.3)
  }
  if (vs) {
    unbindPlayer(w);
    vsAfterTitans(w);     // titan-titan bodies, PvP resolution (VS only)
    vsStepWorld(w);       // tenders, crown, ring crews (VS only; replaces stepGates / stepEndless)
  } else {
    stepGates(w);         // GATEKEEPERS: locks, gatekeeper / city-boss spawns, pressure, finale timer
    stepEndless(w);       // v2: EXTENDED COVERAGE escalation + rematches (no-op unless w.endless)
  }
  stepEnemies(w);         // AI, movement, firing (spawns projectiles/telegraphs)
  stepBoss(w);            // boss AI + part colliders
  rebuildEnemyGrid(w);    // enemies moved — projectiles/hazards/telegraphs test current positions
  stepProjectiles(w);
  stepTelegraphs(w);
  stepHazards(w);
  stepPickups(w);         // magnet + collect → gainXp / gainMass (level/rank ups)
  for (let i = 0; i < n; i++) {
    if (!seatActive(w, ps[i])) continue;
    bindPlayer(w, i);
    if (vs) stepRail(w);  // VS only: CARD RAIL picks / auto-pick / open an owed offer (the sim never pauses for a draft)
    stepUpgrades(w);      // buff timers, trigger icds, 'interval' triggers
  }
  if (vs) unbindPlayer(w);
  else flushGateBreach(w);  // GATEKEEPERS §2.5: a kill landed by any system above breaches HERE (after every attack of the tick),
                          // so processTriggers (rankUp cards), stepObjectives (RECORDS ANNEX owed, Size I prop sites),
                          // chargeUltimate and stepTally see the kill tick's rankUp / levelUp events
  for (let i = 0; i < n; i++) {
    if (!seatActive(w, ps[i])) continue;
    bindPlayer(w, i);
    processTriggers(w);   // upgrade triggers fired by THIS tick's events (this seat's only: ev.p === cur)
  }
  if (vs) unbindPlayer(w);
  else settleGateBreach(w);   // a kill landed by a trigger proc breaches HERE; its rankUp / levelUp fire their cards now
  stepObjectives(w);      // v2: AFTER processTriggers so proc collapses / prop kills are seen (§2.3)
  stepPowerups(w);        // v2: drops from ALL of this tick's kills/collapses, collect, timers
  for (let i = 0; i < n; i++) {
    if (!seatActive(w, ps[i])) continue;
    bindPlayer(w, i);
    chargeUltimate(w);    // v2: UPROAR charge from this tick's events (this seat's only)
    stepTally(w);         // v2: run tally the goals read (this seat's events only)
  }
  if (vs) unbindPlayer(w);
  else flushGateBreach(w);  // a kill landed by an objective / power-up this tick (rare: stepObjectives has run, so its ANNEX is not owed)
  for (let i = 0; i < n; i++) {
    const p = ps[i];
    const r = p.titan.rank;
    if (r > p.run.peakRank) p.run.peakRank = r;
    if (r > w.run.peakRank) w.run.peakRank = r;
  }
  if (vs) vsEndTick(w);   // KO / eviction / elimination / winner (VS only; replaces checkRunEnd)
  else checkRunEnd(w);
  if (w.tick % 30 === 0) compact(w);
  bindPlayer(w, w.view);  // leave the cursor on the local seat: view / HUD / audio code that reads w.titan keeps working
}

/** GATEKEEPERS §2.5 after processTriggers: a trigger proc that landed a gatekeeper / city-boss kill breaches on
 *  this tick, and the breach's own events (rankUp, levelUp, pickups) get their upgrade triggers too, so the
 *  rankUp cards, the RECORDS ANNEX, UPROAR charge and the tally all see it. Bounded: a slot breaches once.
 *  SOLO only (VS has no size locks, so no breaches): the bound player is slot 0. */
function settleGateBreach(w: World): void {
  for (let k = 0; k < 4 && w.gates.breachDue !== 0; k++) {
    const n = w.events.length;
    flushGateBreach(w);
    processTriggersFrom(w, n);
  }
}

/** Convenience for probes/tests: advance n ticks with a constant input. */
export function stepN(w: World, n: number, input: TitanInput = NO_INPUT): void {
  for (let i = 0; i < n && !w.run.result; i++) stepWorld(w, input);
}
