// BLOCKTOOTH — headless sim probe (CONTRACT §15 gate 2).
//
//   node _harness/probe_sim.ts                          # all 4 titans × 3 biomes, GATE2_V3.probeMinutes (25) sim-minutes each
//   node _harness/probe_sim.ts --titan molo --biome grideast --seed 7
//   node _harness/probe_sim.ts --titan molo,voltkite --minutes 6 --quiet
//   node _harness/probe_sim.ts --det all                # determinism re-run for every config
//   node _harness/probe_sim.ts --json _harness/_reports/probe_sim.json
//   node _harness/probe_sim.ts --meta full              # v2: everything unlocked, no perk (default: --meta fresh)
//
// For every run: createWorld → the deterministic bot (bot.ts) drives until the run ends or
// the time limit; pending drafts are auto-picked through rollOffer / pickUpgrade (exactly
// the path the draft screen uses). Prints a table (rank-up times, level at boss spawn, drafts,
// boss spawn t, result + end t, floors eaten, kills, damage taken, peak enemies, sim ms/tick
// avg/p99), a determinism check (same seed run twice ⇒ identical state hashes at every
// sim-minute checkpoint and at the end) and asserts the gate-2 bands:
//   * no NaN / no throw
//   * GATEKEEPERS §5.3 (GATE2_V3, lane K1a; re-banded for the 20-minute run, owner decision 11 / PACING_20 §3.10):
//     gatekeeper 1/2/3 spawns 115–290 / 330–620 / 545–915 s; Size II/III/IV (= gate 1/2/3's kill) 135–350 /
//     370–680 / 575–965 s; the city boss spawns 995–1265 s (floor = mainEarliestS, 1e-6 s float slack); Size V ONLY on the
//     city boss's kill tick; each gate fight (spawn → kill) 15–90 s, per-gatekeeper matrix median 25–55 s;
//     the city fight's matrix median 60–150 s; levels gained in the city fight ≤ 6 per run, matrix median
//     ≤ 4; a time cap firing (gateLocked capped) is a violation
//   * drafts every ~16–40 s early (hard 13–48 s; median gap of the drafts in the first 360 s, or until Size III)
//   * full matrix only: a competent bot clears ≥ 8 of 12 runs in 17–24 min (GATE2_V3.clearWindowS), and dies in some
//     (v2 §0.6: "deaths ≥ 1 across the 12-run matrix" is stated explicitly — heals / shields / screen
//     clears must not turn the gate into a walkover)
//   * v2 §0.6 reporting lines per run: the share of all XP granted through the UPROAR bank
//     (w.ult.xpTotal) and through OVERLOAD SITE payouts (w.map.overloadXp), and DEMOLITION kills
// Exit: 0 = every assertion holds · 1 = violations (listed) · 2 = the sim could not be loaded.
//
// Harness code (not sim code): performance.now() is used ONLY to time ticks.

import type { BiomeId, RunMeta, SimEvent, TitanId, World } from '../src/core/types.ts';
import { BIOME_IDS, EMPTY_RUN_META, TITAN_IDS } from '../src/core/types.ts';
import { BUDGET, GATE2_V3, SIM_HZ, cumXpAt } from '../src/core/config.ts';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// The sim + bot are loaded dynamically in main() so a missing or broken lane module is
// reported as "could not load the sim" (exit 2) instead of an uncaught import crash.
type WorldMod = typeof import('../src/core/world.ts');
type DraftMod = typeof import('../src/upgrades/draft.ts');
type BotMod = typeof import('./bot.ts');
type UpgMod = typeof import('../src/data/upgrades.ts');
let createWorld: WorldMod['createWorld'];
let stepWorld: WorldMod['stepWorld'];
let hasPendingDraft: DraftMod['hasPendingDraft'];
let pickUpgrade: DraftMod['pickUpgrade'];
let rollOffer: DraftMod['rollOffer'];
let botInput: BotMod['botInput'];
let botPickUpgrade: BotMod['botPickUpgrade'];
/** v2 --meta: the RunMeta every run starts with (fresh = EMPTY_RUN_META; full = every locked card, no perk) */
let RUN_META: RunMeta = { ...EMPTY_RUN_META, unlocked: [] };
let lockedIds: string[] = [];

async function loadSim(): Promise<string | null> {
  try {
    const wm: WorldMod = await import('../src/core/world.ts');
    const dm: DraftMod = await import('../src/upgrades/draft.ts');
    const bm: BotMod = await import('./bot.ts');
    const um: UpgMod = await import('../src/data/upgrades.ts');
    lockedIds = um.UPGRADES.filter((u) => u.locked).map((u) => u.id).sort();
    createWorld = wm.createWorld; stepWorld = wm.stepWorld;
    hasPendingDraft = dm.hasPendingDraft; pickUpgrade = dm.pickUpgrade; rollOffer = dm.rollOffer;
    botInput = bm.botInput; botPickUpgrade = bm.botPickUpgrade;
    return null;
  } catch (e) {
    return (e as Error)?.stack ?? String(e);
  }
}

// ─────────────────────────────── gate constants (CONTRACT §15 gate 2) ───────────────────────────────
/** [min, max] seconds for reaching rank index 1..4 (Size II..V). */
// GATEKEEPERS §5.3 (lane K1a): the v3 bands replace RANK_BANDS [[60,150],[150,300],[280,450],[400,560]] and
// BOSS_BY_S 560 — Size II..IV now come from the gatekeepers' kills, Size V only from the city boss's kill.
const GATE_SPAWN_BANDS = GATE2_V3.spawnBand;
const BREACH_BANDS = GATE2_V3.breachBand;
const MAIN_SPAWN_BAND = GATE2_V3.mainSpawn;
// The 20-minute run (owner decision 2026-09-30 "go with 20 minutes"; GATEKEEPERS §5.3, PACING_20 §3.10): the clear
// window, the early draft cadence and the default run length are pacing bands, read from config (GATE2_V3) so every
// probe shares one source. Was: clears 480–720 s, cadence ~10–25 s (hard 8–30) over the first 180 s, 13 sim-minutes.
const CLEAR_WINDOW_S: readonly [number, number] = GATE2_V3.clearWindowS;
const CLEARS_REQUIRED = 8;          // of 12
const DRAFT_EARLY_S: number = GATE2_V3.draftEarlyS;
/** The contract's early draft cadence band: the median must sit inside the hard band; outside the soft band but
 *  inside the hard one prints a note. */
const DRAFT_GAP_BAND: readonly [number, number] = GATE2_V3.draftGapS;
const DRAFT_GAP_HARD: readonly [number, number] = GATE2_V3.draftGapHardS;
/** The accumulated w.t (w.t += dt) reads 994.99999999975 at the 995 s tick: a floor test tolerates that drift
 *  (measured, PACING_20 §5 item 5) — a harness float slack, not a widening. */
const FLOOR_SLACK_S = 1e-6;
const PROBE_MINUTES: number = GATE2_V3.probeMinutes;
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

// ─────────────────────────────── args ───────────────────────────────
interface Args {
  titans: TitanId[]; biomes: BiomeId[]; seed: number; minutes: number; quiet: boolean;
  det: 'all' | number; json: string | null;
  meta: 'fresh' | 'full';
}

function parseArgs(argv: string[]): Args {
  const a: Args = { titans: [...TITAN_IDS], biomes: [...BIOME_IDS], seed: 1337, minutes: PROBE_MINUTES, quiet: false, det: 2, json: null, meta: 'fresh' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) { console.error(`missing value for ${k}`); process.exit(2); }
      return x;
    };
    if (k === '--titan') {
      const ids = v().split(',').map((s) => s.trim()).filter(Boolean);
      for (const id of ids) if (!(TITAN_IDS as readonly string[]).includes(id)) { console.error(`unknown titan '${id}' (${TITAN_IDS.join('|')})`); process.exit(2); }
      a.titans = ids as TitanId[];
    } else if (k === '--biome') {
      const ids = v().split(',').map((s) => s.trim()).filter(Boolean);
      for (const id of ids) if (!(BIOME_IDS as readonly string[]).includes(id)) { console.error(`unknown biome '${id}' (${BIOME_IDS.join('|')})`); process.exit(2); }
      a.biomes = ids as BiomeId[];
    } else if (k === '--seed') a.seed = Number(v()) >>> 0;
    else if (k === '--minutes') a.minutes = Math.max(0.05, Number(v()));
    else if (k === '--quiet') a.quiet = true;
    else if (k === '--det') { const x = v(); a.det = x === 'all' ? 'all' : Math.max(0, Math.floor(Number(x))); }
    else if (k === '--json') a.json = v();
    else if (k === '--meta') {
      const x = v().toLowerCase();
      if (x !== 'fresh' && x !== 'full') { console.error(`unknown --meta '${x}' (fresh|full)`); process.exit(2); }
      a.meta = x;
    }
    else if (k === '--help' || k === '-h') {
      console.log('usage: node _harness/probe_sim.ts [--titan id[,id]] [--biome id[,id]] [--seed n] [--minutes m] [--det n|all] [--json path] [--meta fresh|full] [--quiet]');
      process.exit(0);
    } else { console.error(`unknown arg ${k}`); process.exit(2); }
  }
  if (!Number.isFinite(a.seed)) a.seed = 1337;
  if (!Number.isFinite(a.minutes)) a.minutes = PROBE_MINUTES;
  return a;
}

// ─────────────────────────────── hashing (determinism) ───────────────────────────────
const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);

class Hasher {
  h = 0x811c9dc5 >>> 0;
  u32(x: number): void {
    for (let s = 0; s < 32; s += 8) { this.h ^= (x >>> s) & 0xff; this.h = Math.imul(this.h, 0x01000193) >>> 0; }
  }
  num(x: number): void { F64[0] = x; this.u32(U32[0]); this.u32(U32[1]); }
  str(s: string): void { for (let i = 0; i < s.length; i++) { this.h ^= s.charCodeAt(i) & 0xff; this.h = Math.imul(this.h, 0x01000193) >>> 0; } }
  hex(): string { return (this.h >>> 0).toString(16).padStart(8, '0'); }
}

function hashWorld(w: World): string {
  const hs = new Hasher();
  const T = w.titan;
  hs.num(w.tick); hs.num(w.t); hs.num(w.nextId);
  for (const v of [T.x, T.z, T.heading, T.hp, T.maxHp, T.mass, T.xp, T.level, T.rank, T.height,
    T.kills, T.crushed, T.floorsEaten, T.buildingsLeveled, T.propsEaten, T.damageTaken, T.abilityCd, T.dashCharges]) hs.num(v);
  let alive = 0;
  for (const e of w.enemies) {
    if (!e.alive) continue;
    alive++;
    hs.str(e.kind); hs.num(e.x); hs.num(e.z); hs.num(e.hp);
  }
  hs.num(alive);
  let pk = 0;
  for (const p of w.pickups) if (p.alive) { pk++; hs.num(p.x); hs.num(p.z); }
  hs.num(pk);
  if (w.boss) { hs.str(w.boss.id); hs.num(w.boss.x); hs.num(w.boss.z); hs.num(w.boss.hp); hs.num(w.boss.phase); hs.num(w.boss.meter); }
  const owned = Object.keys(w.upgrades.owned).sort();
  for (const k of owned) { hs.str(k); hs.num(w.upgrades.owned[k]); }
  let floors = 0;
  for (const b of w.city.buildings) floors += b.alive;
  hs.num(floors);
  hs.num(w.run.tonnage); hs.num(w.run.blocksLeveled);
  return hs.hex();
}

// ─────────────────────────────── one run ───────────────────────────────
interface RunResult {
  titan: TitanId; biome: BiomeId; seed: number;
  rankT: number[];                 // index = rank; NaN = not reached
  levelAtRank: number[];           // titan level when each rank was reached (pacing diagnosis)
  xpAtRank: number[];              // cumulative titan XP (from LV 1) when each rank was reached (economy diagnosis)
  heightAtRank: number[];          // body height once the MASS BREACH tween settled (observed, m)
  heightAtLevel: number[];         // body height once each level's grow tween settled (index = level; observed, m)
  pickupsByKind: Record<string, number>; // pickups collected per kind
  paintFired: number; paintHit: number;  // hostile telegraphs that fired / landed on the titan (bot dodge rate)
  xpByPickup: Record<string, number>;   // XP collected per pickup kind (from 'pickup' events)
  levelAtBoss: number; bossT: number;
  drafts: number; draftTimes: number[];
  result: 'clear' | 'dead' | 'timeout'; endT: number;
  floors: number; buildings: number; props: number; kills: number; crushed: number;
  dmgTaken: number; peakEnemies: number; level: number; rank: number;
  bossHpFrac: number;
  simAvgMs: number; simP99Ms: number; simMaxMs: number; ticks: number;
  // v2 §0.6 reporting (XP through the UPROAR bank / OVERLOAD SITE payouts, DEMOLITION kills, total XP)
  ultXp: number; overloadXp: number; demolitionKills: number; totalXp: number;
  checkpoints: string[]; hash: string;
  error: string | null; nan: string | null; draftIssues: string[];
  events: Record<string, number>;
  // GATEKEEPERS (§5.3 report lines, lane K0; lane K1a switches the bands to GATE2_V3): per-slot lock / spawn /
  // kill world times (index = slot 1..4, NaN = never), gate fight seconds, levels during the city fight
  gateLockT: number[]; gateCapped: boolean[]; gateSpawnT: number[]; gateKillT: number[]; gateFightS: number[];
  gateUnlocked: number; gateTopUp: number; gateFightTotalS: number; mainKillT: number; finaleOnT: number;
  levelAtMainSpawn: number; levelAtMainKill: number;
  // K1a (§5.3 report lines): levels / drafts per fight (index = slot 1..4), pressure peak per gate, RAMMING
  // THROUGH count, the wait from the city boss's lock to its spawn, the tick of rankUp 4 vs the city kill
  levelAtGateSpawn: number[]; levelAtGateKill: number[]; draftsInFight: number[]; pressurePeak: number[];
  rams: number; mainWaitS: number; rankVOnKillTick: boolean | null; escalations: number; repositions: number;
}

function finite(...xs: number[]): boolean { for (const x of xs) if (!Number.isFinite(x)) return false; return true; }

function nanCheck(w: World): string | null {
  const T = w.titan;
  if (!finite(T.x, T.z, T.heading, T.hp, T.maxHp, T.height, T.radius, T.mass, T.xp, T.vx, T.vz)) {
    return `titan non-finite @t=${w.t.toFixed(2)}: x=${T.x} z=${T.z} hp=${T.hp}/${T.maxHp} H=${T.height} mass=${T.mass} v=(${T.vx},${T.vz})`;
  }
  for (const e of w.enemies) if (e.alive && !finite(e.x, e.z, e.y, e.hp)) return `enemy ${e.id} (${e.kind}) non-finite @t=${w.t.toFixed(2)}: x=${e.x} z=${e.z} hp=${e.hp}`;
  for (const p of w.projectiles) if (p.alive && !finite(p.x, p.z, p.y)) return `projectile ${p.id} (${p.kind}) non-finite @t=${w.t.toFixed(2)}`;
  for (const p of w.pickups) if (p.alive && !finite(p.x, p.z, p.y)) return `pickup ${p.id} non-finite @t=${w.t.toFixed(2)}`;
  if (w.boss && !finite(w.boss.x, w.boss.z, w.boss.hp, w.boss.meter)) return `boss non-finite @t=${w.t.toFixed(2)}: hp=${w.boss.hp}`;
  return null;
}

function pct(sorted: Float64Array, p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[i];
}

function runOne(titan: TitanId, biome: BiomeId, seed: number, maxTicks: number, quiet: boolean, tag: string): RunResult {
  const r: RunResult = {
    titan, biome, seed, rankT: [0, NaN, NaN, NaN, NaN], levelAtRank: [1, NaN, NaN, NaN, NaN], xpAtRank: [0, NaN, NaN, NaN, NaN],
    heightAtRank: [NaN, NaN, NaN, NaN, NaN], heightAtLevel: [],
    pickupsByKind: {}, xpByPickup: {}, paintFired: 0, paintHit: 0,
    levelAtBoss: NaN, bossT: NaN,
    drafts: 0, draftTimes: [], result: 'timeout', endT: NaN, floors: 0, buildings: 0, props: 0,
    kills: 0, crushed: 0, dmgTaken: 0, peakEnemies: 0, level: 1, rank: 0, bossHpFrac: NaN,
    simAvgMs: 0, simP99Ms: 0, simMaxMs: 0, ticks: 0, checkpoints: [], hash: '', error: null, nan: null,
    draftIssues: [], events: {},
    ultXp: 0, overloadXp: 0, demolitionKills: 0, totalXp: 0,
    gateLockT: [NaN, NaN, NaN, NaN, NaN], gateCapped: [false, false, false, false, false], gateSpawnT: [NaN, NaN, NaN, NaN, NaN],
    gateKillT: [NaN, NaN, NaN, NaN, NaN], gateFightS: [NaN, NaN, NaN, NaN, NaN],
    gateUnlocked: 0, gateTopUp: 0, gateFightTotalS: 0, mainKillT: NaN, finaleOnT: NaN, levelAtMainSpawn: NaN, levelAtMainKill: NaN,
    levelAtGateSpawn: [NaN, NaN, NaN, NaN, NaN], levelAtGateKill: [NaN, NaN, NaN, NaN, NaN], draftsInFight: [0, 0, 0, 0, 0],
    pressurePeak: [0, 0, 0, 0, 0], rams: 0, mainWaitS: NaN, rankVOnKillTick: null, escalations: 0, repositions: 0,
  };
  let w: World;
  try {
    w = createWorld({ titan, biome, seed, meta: { ...RUN_META, unlocked: RUN_META.unlocked.slice() } });
  } catch (e) {
    r.error = `createWorld threw: ${(e as Error)?.stack ?? String(e)}`;
    return r;
  }
  const tickMs = new Float64Array(maxTicks);
  const ckEvery = 60 * SIM_HZ;
  let i = 0;
  r.heightAtRank[0] = w.titan.height; r.heightAtLevel[1] = w.titan.height;
  let growLv = 0, growRank = -1;       // level / rank whose grow tween is still settling
  let lastLog = 0;
  try {
    for (; i < maxTicks && !w.run.result; i++) {
      // drafts: exactly the path the draft screen takes (roll → pick), chest drafts first
      let guard = 0;
      while (hasPendingDraft(w)) {
        // loop guard only (a big collapse can bank several levels in one tick; a pick that does not
        // consume a draft is caught below)
        if (++guard > 200) { r.draftIssues.push(`hasPendingDraft still true after 200 picks in one tick @t=${w.t.toFixed(1)}`); break; }
        const chest = w.upgrades.chestDrafts > 0;
        const offer = w.upgrades.offer && w.upgrades.offer.length > 0 ? w.upgrades.offer : rollOffer(w, chest);
        if (!offer || offer.length === 0) { r.draftIssues.push(`empty offer @t=${w.t.toFixed(1)} (chest=${chest})`); break; }
        if (new Set(offer).size !== offer.length) r.draftIssues.push(`duplicate ids in offer @t=${w.t.toFixed(1)}: ${offer.join(',')}`);
        const pick = botPickUpgrade(w, offer);
        const before = w.upgrades.pendingDrafts + w.upgrades.chestDrafts;
        pickUpgrade(w, pick);
        const after = w.upgrades.pendingDrafts + w.upgrades.chestDrafts;
        if (after >= before) { r.draftIssues.push(`pickUpgrade did not consume a draft @t=${w.t.toFixed(1)} (${before}→${after})`); break; }
        r.drafts++; r.draftTimes.push(w.t);
        if (w.gates && w.gates.active > 0 && !w.endless) r.draftsInFight[w.gates.active]++;
      }
      const inp = botInput(w);
      const t0 = performance.now();
      stepWorld(w, inp);
      tickMs[i] = performance.now() - t0;

      const evs: readonly SimEvent[] = w.events;
      for (let k = 0; k < evs.length; k++) {
        const ev = evs[k];
        r.events[ev.type] = (r.events[ev.type] ?? 0) + 1;
        if (ev.type === 'rankUp') { if (Number.isNaN(r.rankT[ev.rank])) { r.rankT[ev.rank] = w.t; r.levelAtRank[ev.rank] = w.titan.level; r.xpAtRank[ev.rank] = cumXpAt(w.titan.level) + w.titan.xp; growRank = ev.rank; } }
        else if (ev.type === 'levelUp') growLv = Math.max(growLv, ev.level);
        else if (ev.type === 'pickup') {
          r.xpByPickup[ev.kind] = (r.xpByPickup[ev.kind] ?? 0) + ev.xp;
          r.pickupsByKind[ev.kind] = (r.pickupsByKind[ev.kind] ?? 0) + 1;
        }
        else if (ev.type === 'telegraphFire' && ev.owner !== 'titan') { r.paintFired++; if (ev.hit) r.paintHit++; }
        else if (ev.type === 'bossSpawn') {
          if (Number.isNaN(r.bossT)) { r.bossT = w.t; r.levelAtBoss = w.titan.level; }
          if (Number.isNaN(r.gateSpawnT[4]) && !w.endless) { r.gateSpawnT[4] = w.t; r.levelAtMainSpawn = w.titan.level; }
        }
        // GATEKEEPERS report lines (§5.3)
        else if (ev.type === 'gateLocked') { if (Number.isNaN(r.gateLockT[ev.slot])) { r.gateLockT[ev.slot] = w.t; r.gateCapped[ev.slot] = ev.capped; } }
        else if (ev.type === 'gateSpawn') { if (!ev.rematch && Number.isNaN(r.gateSpawnT[ev.slot])) { r.gateSpawnT[ev.slot] = w.t; r.levelAtGateSpawn[ev.slot] = w.titan.level; } }
        else if (ev.type === 'gateDefeated') { if (!ev.rematch && Number.isNaN(r.gateKillT[ev.slot])) { r.gateKillT[ev.slot] = w.t; r.gateFightS[ev.slot] = w.t - r.gateSpawnT[ev.slot]; r.levelAtGateKill[ev.slot] = w.titan.level; } }
        else if (ev.type === 'bossDefeated') {
          if (Number.isNaN(r.mainKillT) && !w.endless) {
            r.mainKillT = w.t; r.levelAtMainKill = w.titan.level;
            let rk4 = false; for (let q = 0; q < evs.length; q++) { const e2 = evs[q]; if (e2.type === 'rankUp' && e2.rank === 4) rk4 = true; }
            r.rankVOnKillTick = rk4;
          }
        }
        else if (ev.type === 'gateRam') r.rams++;
        else if (ev.type === 'gateEscalate') r.escalations++;
        else if (ev.type === 'gateReposition') r.repositions++;
        else if (ev.type === 'finale') { if (ev.on && Number.isNaN(r.finaleOnT)) r.finaleOnT = w.t; }
      }
      if (w.gates && w.gates.active >= 1 && w.gates.active <= 3 && w.gates.pressure > r.pressurePeak[w.gates.active]) r.pressurePeak[w.gates.active] = w.gates.pressure;
      if ((growLv > 0 || growRank >= 0) && !(w.titan.growT > 0)) {
        if (growLv > 0) { r.heightAtLevel[growLv] = w.titan.height; growLv = 0; }
        if (growRank >= 0) { r.heightAtRank[growRank] = w.titan.height; growRank = -1; }
      }
      let alive = 0;
      for (let k = 0; k < w.enemies.length; k++) if (w.enemies[k].alive) alive++;
      if (alive > r.peakEnemies) r.peakEnemies = alive;
      if (i % 15 === 0 || w.run.result) {
        const bad = nanCheck(w);
        if (bad) { r.nan = bad; i++; break; }
      }
      if ((i + 1) % ckEvery === 0) r.checkpoints.push(hashWorld(w));
      if (!quiet && w.t - lastLog >= 60) {
        lastLog = w.t;
        const T = w.titan;
        let pk = 0; for (const p of w.pickups) if (p.alive) pk++;
        console.log(`  ${tag} t=${w.t.toFixed(0).padStart(4)}s  Size ${ROMAN[T.rank]}  LV ${T.level}  H ${T.height.toFixed(1)}  hp ${T.hp.toFixed(0)}/${T.maxHp.toFixed(0)}  enemies ${alive}  pickups ${pk}  floors ${T.floorsEaten}  kills ${T.kills}  ${w.boss ? `boss ${w.boss.id} p${w.boss.phase} ${(100 * w.boss.hp / w.boss.maxHp).toFixed(0)}%` : ''}`);
      }
    }
  } catch (e) {
    r.error = `threw @t=${w.t.toFixed(2)} tick=${w.tick}: ${(e as Error)?.stack ?? String(e)}`;
  }
  r.ticks = i;
  const T = w.titan;
  r.result = (w.run.result as 'clear' | 'dead' | null) ?? 'timeout';   // solo probe: 'vs' cannot occur
  r.endT = w.run.result ? w.run.endT : w.t;
  r.floors = T.floorsEaten; r.buildings = T.buildingsLeveled; r.props = T.propsEaten;
  r.kills = T.kills; r.crushed = T.crushed; r.dmgTaken = T.damageTaken;
  r.level = T.level; r.rank = T.rank;
  r.bossHpFrac = w.boss ? w.boss.hp / Math.max(1, w.boss.maxHp) : NaN;
  const sorted = tickMs.slice(0, i).sort();
  let sum = 0; for (let k = 0; k < sorted.length; k++) sum += sorted[k];
  r.simAvgMs = sorted.length ? sum / sorted.length : 0;
  r.simP99Ms = pct(sorted, 0.99);
  r.simMaxMs = sorted.length ? sorted[sorted.length - 1] : 0;
  r.hash = hashWorld(w);
  r.ultXp = w.ult ? w.ult.xpTotal : 0;
  r.overloadXp = w.map ? w.map.overloadXp : 0;
  r.demolitionKills = w.map ? w.map.demolitionKills : 0;
  r.totalXp = cumXpAt(T.level) + T.xp;
  if (w.gates) { r.gateUnlocked = w.gates.unlocked; r.gateTopUp = w.gates.topUpLevels; r.gateFightTotalS = w.gates.fightS; }
  if (!Number.isNaN(r.gateLockT[4]) && !Number.isNaN(r.gateSpawnT[4])) r.mainWaitS = r.gateSpawnT[4] - r.gateLockT[4];
  return r;
}

// ─────────────────────────────── checks ───────────────────────────────
function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Draft cadence over the EARLY game = the first DRAFT_EARLY_S seconds, cut short at Size III when a
 *  run gets there sooner — so a pacing blow-out at Size III+ is reported by the rank bands, not
 *  double-counted here. */
function earlyWindow(r: RunResult): number {
  const t3 = r.rankT[2];
  return Number.isNaN(t3) ? DRAFT_EARLY_S : Math.min(DRAFT_EARLY_S, t3);
}
function earlyDraftGap(r: RunResult): { median: number; n: number; window: number } {
  const win = earlyWindow(r);
  const ts = r.draftTimes.filter((t) => t <= win);
  const gaps: number[] = [];
  let prev = 0;
  for (const t of ts) { gaps.push(t - prev); prev = t; }
  return { median: median(gaps), n: gaps.length, window: win };
}

function runViolations(r: RunResult): string[] {
  const v: string[] = [];
  const id = `${r.titan}/${r.biome}/seed ${r.seed}`;
  if (r.error) v.push(`${id}: ${r.error.split('\n').slice(0, 4).join(' | ')}`);
  if (r.nan) v.push(`${id}: NaN — ${r.nan}`);
  for (const d of r.draftIssues) v.push(`${id}: draft — ${d}`);
  const endT = r.endT;
  const dead = r.result === 'dead';
  const died = dead ? `; died at ${endT.toFixed(0)} s` : '';
  // GATEKEEPERS §5.3 (GATE2_V3): gatekeeper spawns, the breaches (= the kills), the fights
  for (let k = 1; k <= 3; k++) {
    const [slo, shi] = GATE_SPAWN_BANDS[k];
    const st = r.gateSpawnT[k];
    if (Number.isNaN(st)) { if (endT > shi) v.push(`${id}: gatekeeper ${k} never spawned by ${shi} s (band ${slo}–${shi} s${died})`); }
    else if (st < slo || st > shi) v.push(`${id}: gatekeeper ${k} spawned at ${st.toFixed(0)} s, outside ${slo}–${shi} s`);
    const [blo, bhi] = BREACH_BANDS[k];
    const t = r.rankT[k];
    if (Number.isNaN(t)) {
      if (endT > bhi) v.push(`${id}: Size ${ROMAN[k]} not reached by ${bhi} s (band ${blo}–${bhi} s${died})`);
    } else {
      if (t < blo || t > bhi) v.push(`${id}: Size ${ROMAN[k]} at ${t.toFixed(0)} s, outside ${blo}–${bhi} s`);
      if (Number.isNaN(r.gateKillT[k]) || Math.abs(r.gateKillT[k] - t) > 1e-6) v.push(`${id}: Size ${ROMAN[k]} at ${t.toFixed(0)} s is not gatekeeper ${k}'s kill tick (kill ${Number.isNaN(r.gateKillT[k]) ? '—' : r.gateKillT[k].toFixed(2)})`);
    }
    const f = r.gateFightS[k];
    if (!Number.isNaN(f) && (f < GATE2_V3.gateFightS[0] || f > GATE2_V3.gateFightS[1])) v.push(`${id}: gatekeeper ${k} fight ${f.toFixed(0)} s, outside ${GATE2_V3.gateFightS[0]}–${GATE2_V3.gateFightS[1]} s`);
    if (!Number.isNaN(st) && Number.isNaN(r.gateKillT[k]) && !dead && endT - st > GATE2_V3.gateFightS[1]) v.push(`${id}: gatekeeper ${k} alive ${(endT - st).toFixed(0)} s after its spawn (> ${GATE2_V3.gateFightS[1]} s)`);
  }
  for (let k = 1; k <= 4; k++) if (r.gateCapped[k]) v.push(`${id}: the slot ${k} time cap fired (gateLocked capped @${r.gateLockT[k].toFixed(0)} s) — the XP economy did not deliver the level (§2.7)`);
  const [mlo, mhi] = MAIN_SPAWN_BAND;
  if (Number.isNaN(r.bossT)) { if (endT > mhi) v.push(`${id}: the city boss never spawned by ${mhi} s${died}`); }
  else if (r.bossT < mlo - FLOOR_SLACK_S || r.bossT > mhi) v.push(`${id}: the city boss spawned at ${r.bossT.toFixed(0)} s, outside ${mlo}–${mhi} s`);
  if (!Number.isNaN(r.rankT[4]) && !(r.rankVOnKillTick === true && Math.abs(r.rankT[4] - r.mainKillT) < 1e-6)) v.push(`${id}: Size V at ${r.rankT[4].toFixed(0)} s is not on the city boss's kill tick (kill ${Number.isNaN(r.mainKillT) ? '—' : r.mainKillT.toFixed(2)})`);
  if (!Number.isNaN(r.levelAtMainSpawn) && !Number.isNaN(r.levelAtMainKill) && r.levelAtMainKill - r.levelAtMainSpawn > GATE2_V3.mainFightLevels.max) v.push(`${id}: ${r.levelAtMainKill - r.levelAtMainSpawn} levels gained in the city fight (> ${GATE2_V3.mainFightLevels.max})`);
  const g = earlyDraftGap(r);
  if (g.n === 0) { if (endT >= g.window) v.push(`${id}: no drafts in the first ${g.window.toFixed(0)} s`); }
  else if (g.median < DRAFT_GAP_HARD[0] || g.median > DRAFT_GAP_HARD[1]) {
    v.push(`${id}: early draft cadence median ${g.median.toFixed(1)} s over ${g.n} drafts in the first ${g.window.toFixed(0)} s (want ~${DRAFT_GAP_BAND[0]}–${DRAFT_GAP_BAND[1]} s, hard ${DRAFT_GAP_HARD[0]}–${DRAFT_GAP_HARD[1]} s)`);
  }
  return v;
}

// ─────────────────────────────── table ───────────────────────────────
function fmtT(t: number): string { return Number.isNaN(t) ? '   —' : t.toFixed(0).padStart(4); }
function pad(s: string, n: number): string { return s.length >= n ? s : s + ' '.repeat(n - s.length); }
function lpad(s: string, n: number): string { return s.length >= n ? s : ' '.repeat(n - s.length) + s; }

function printTable(rs: RunResult[]): void {
  const head = `${pad('titan', 11)}${pad('biome', 12)}  II  III   IV    V  LVboss bossT drafts result   endT floors bldgs props kills crush dmgTaken peakE  ms avg/p99`;
  console.log(head);
  console.log('-'.repeat(head.length));
  for (const r of rs) {
    const res = r.error ? 'THROW' : r.nan ? 'NaN' : r.result;
    console.log(
      `${pad(r.titan, 11)}${pad(r.biome, 12)}${fmtT(r.rankT[1])} ${fmtT(r.rankT[2])} ${fmtT(r.rankT[3])} ${fmtT(r.rankT[4])}` +
      `  ${lpad(Number.isNaN(r.levelAtBoss) ? '—' : String(r.levelAtBoss), 6)} ${fmtT(r.bossT)}  ${lpad(String(r.drafts), 5)} ${pad(res, 7)}${lpad(r.endT.toFixed(0), 5)}` +
      ` ${lpad(String(r.floors), 6)} ${lpad(String(r.buildings), 5)} ${lpad(String(r.props), 5)} ${lpad(String(r.kills), 5)} ${lpad(String(r.crushed), 5)}` +
      ` ${lpad(r.dmgTaken.toFixed(0), 8)} ${lpad(String(r.peakEnemies), 5)}  ${r.simAvgMs.toFixed(2)}/${r.simP99Ms.toFixed(2)}`,
    );
  }
}

// ─────────────────────────────── main ───────────────────────────────
async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const loadErr = await loadSim();
  if (loadErr) {
    console.log('GATE 2: FAIL — could not load the sim/bot modules:');
    for (const l of loadErr.split(/\r?\n/).slice(0, 8)) console.log('  ' + l);
    return 2;
  }
  const maxTicks = Math.round(args.minutes * 60 * SIM_HZ);
  const configs: { titan: TitanId; biome: BiomeId }[] = [];
  for (const t of args.titans) for (const b of args.biomes) configs.push({ titan: t, biome: b });
  const fullMatrix = configs.length === TITAN_IDS.length * BIOME_IDS.length;
  RUN_META = args.meta === 'full'
    ? { unlocked: lockedIds.slice(), perk: null, palette: 0, reviveUsed: false }
    : { ...EMPTY_RUN_META, unlocked: [] };
  console.log(`BLOCKTOOTH probe_sim — ${configs.length} run(s) × ${args.minutes} sim-min, seed ${args.seed}, ${SIM_HZ} Hz, --meta ${args.meta} (${RUN_META.unlocked.length} locked card(s) unlocked)`);

  const results: RunResult[] = [];
  const wall0 = performance.now();
  for (let c = 0; c < configs.length; c++) {
    const { titan, biome } = configs[c];
    const tag = `[${c + 1}/${configs.length} ${titan}/${biome}]`;
    const t0 = performance.now();
    const r = runOne(titan, biome, args.seed, maxTicks, args.quiet, tag);
    results.push(r);
    const res = r.error ? 'THREW' : r.nan ? 'NaN' : r.result;
    console.log(`${tag} ${res} @ ${r.endT.toFixed(0)} s · Size ${ROMAN[r.rank]} LV ${r.level} · drafts ${r.drafts} · ${((performance.now() - t0) / 1000).toFixed(1)} s wall`);
  }

  // determinism: re-run chosen configs with the same seed, compare every checkpoint + final hash
  const detIdx: number[] = [];
  if (args.det === 'all') for (let c = 0; c < configs.length; c++) detIdx.push(c);
  else if (args.det > 0) {
    detIdx.push(0);
    if (args.det > 1 && configs.length > 1) detIdx.push(configs.length - 1);
    for (let c = 1; detIdx.length < Math.min(args.det, configs.length); c++) if (!detIdx.includes(c)) detIdx.push(c);
  }
  const detLines: string[] = [];
  const violations: string[] = [];
  for (const c of detIdx) {
    const a = results[c];
    if (a.error) { detLines.push(`${a.titan}/${a.biome}: skipped (first run threw)`); continue; }
    const b = runOne(a.titan, a.biome, a.seed, a.ticks, true, 'det');
    let diverged = -1;
    const n = Math.min(a.checkpoints.length, b.checkpoints.length);
    for (let k = 0; k < n; k++) if (a.checkpoints[k] !== b.checkpoints[k]) { diverged = k; break; }
    const same = diverged < 0 && a.hash === b.hash && a.ticks === b.ticks && a.checkpoints.length === b.checkpoints.length;
    if (same) detLines.push(`${a.titan}/${a.biome}: DETERMINISTIC over ${a.ticks} ticks (${a.checkpoints.length} checkpoints, final ${a.hash})`);
    else {
      const where = diverged >= 0 ? `first divergence at sim-minute ${diverged + 1}` : `final hash ${a.hash} vs ${b.hash}, ticks ${a.ticks} vs ${b.ticks}`;
      detLines.push(`${a.titan}/${a.biome}: NON-DETERMINISTIC — ${where}`);
      violations.push(`${a.titan}/${a.biome}: non-deterministic (${where})`);
    }
  }

  console.log('');
  printTable(results);
  console.log('');
  for (const r of results) {
    const g = earlyDraftGap(r);
    const ev = r.events;
    const soft = !Number.isNaN(g.median) && (g.median < DRAFT_GAP_BAND[0] || g.median > DRAFT_GAP_BAND[1]) ? ` [outside ${DRAFT_GAP_BAND[0]}–${DRAFT_GAP_BAND[1]}, within tolerance]` : '';
    console.log(`  ${pad(`${r.titan}/${r.biome}`, 24)} early draft gap median ${Number.isNaN(g.median) ? '—' : g.median.toFixed(1) + ' s'} (${g.n} in ${g.window.toFixed(0)} s)${soft}` +
      `  hooks ${ev.ability ?? 0}  dashes ${ev.dash ?? 0}  hurt ${ev.titanHurt ?? 0}  collapses ${ev.buildingCollapse ?? 0}` +
      `  paint dodged ${r.paintFired - r.paintHit}/${r.paintFired}` +
      `${Number.isNaN(r.bossHpFrac) ? '' : `  boss hp left ${(100 * r.bossHpFrac).toFixed(0)}%`}  sim max ${r.simMaxMs.toFixed(1)} ms`);
    const xp = Object.keys(r.xpByPickup).sort().map((k) => `${k} ${r.xpByPickup[k].toFixed(0)}`).join(' · ');
    console.log(`  ${pad('', 24)} LV at Size II/III/IV/V ${r.levelAtRank.slice(1).map((l) => (Number.isNaN(l) ? '—' : String(l))).join('/')}` +
      `  xp by pickup: ${xp || '—'}  kills ${r.kills} (crushed ${r.crushed})`);
    // economy: growth XP banked per second inside each rank (SIZE is level-driven: this is what the
    // rank bands are really measuring)
    const rate: string[] = [];
    for (let k = 1; k <= 4; k++) {
      const t0 = r.rankT[k - 1], t1 = r.rankT[k], m0 = r.xpAtRank[k - 1], m1 = r.xpAtRank[k];
      rate.push(Number.isNaN(t1) || Number.isNaN(t0) || t1 <= t0 ? '—' : `${((m1 - m0) / (t1 - t0)).toFixed(1)}`);
    }
    const pk = Object.keys(r.pickupsByKind).sort().map((k) => `${k} ${r.pickupsByKind[k]}`).join(' · ');
    console.log(`  ${pad('', 24)} XP/s in Size I/II/III/IV ${rate.join('/')}  pickups ${pk || '—'}`);
    const hr = [1, 2, 3, 4].map((k) => (Number.isNaN(r.rankT[k]) ? `${ROMAN[k]} —` : `${ROMAN[k]} LV ${r.levelAtRank[k]} H ${Number.isNaN(r.heightAtRank[k]) ? '?' : r.heightAtRank[k].toFixed(2)}`));
    console.log(`  ${pad('', 24)} size-ups: ${hr.join(' · ')}`);
    const hl: string[] = [];
    for (let L = 1; L <= 11; L++) hl.push(`${L}:${r.heightAtLevel[L] === undefined ? '·' : r.heightAtLevel[L].toFixed(2)}`);
    console.log(`  ${pad('', 24)} settled H by level (m): ${hl.join(' ')}`);
    const share = (x: number) => (r.totalXp > 0 ? `${((100 * x) / r.totalXp).toFixed(1)} %` : '—');
    {
      // GATEKEEPERS (§5.3; K0 prints, K1a asserts GATE2_V3): per slot lock / spawn / kill (s), gate fight (s)
      const tt = (t: number) => (Number.isNaN(t) ? '—' : t.toFixed(0));
      const slots = [1, 2, 3].map((k) => `G${k} lock ${tt(r.gateLockT[k])}${r.gateCapped[k] ? ' CAP' : ''} spawn ${tt(r.gateSpawnT[k])} kill ${tt(r.gateKillT[k])}${Number.isNaN(r.gateFightS[k]) ? '' : ` (${r.gateFightS[k].toFixed(0)} s)`}`);
      const lv = Number.isNaN(r.levelAtMainSpawn) || Number.isNaN(r.levelAtMainKill) ? '—' : String(r.levelAtMainKill - r.levelAtMainSpawn);
      console.log(`  ${pad('', 24)} gates: unlocked ${r.gateUnlocked} · ${slots.join(' · ')} · city lock ${tt(r.gateLockT[4])} spawn ${tt(r.gateSpawnT[4])} kill ${tt(r.mainKillT)} (+${lv} LV) · finale ${tt(r.finaleOnT)} · top-up ${r.gateTopUp} LV`);
      const fl = [1, 2, 3, 4].map((k) => {
        const a = k === 4 ? r.levelAtMainSpawn : r.levelAtGateSpawn[k], b = k === 4 ? r.levelAtMainKill : r.levelAtGateKill[k];
        return `${k === 4 ? 'city' : 'G' + k} +${Number.isNaN(a) || Number.isNaN(b) ? '—' : b - a} LV / ${r.draftsInFight[k]} drafts${k === 4 ? '' : ` p≤${r.pressurePeak[k]}`}`;
      });
      console.log(`  ${pad('', 24)} gate fights: ${fl.join(' · ')} · held (fight time) ${r.gateFightTotalS.toFixed(0)} s · wait for mainEarliestS ${Number.isNaN(r.mainWaitS) ? '—' : r.mainWaitS.toFixed(0) + ' s'} · RAMMING THROUGH ${r.rams} · escalations ${r.escalations} · cut-offs ${r.repositions}`);
    }
    console.log(`  ${pad('', 24)} v2: XP via UPROAR bank ${r.ultXp.toFixed(0)} (${share(r.ultXp)}) · via OVERLOAD SITE ${r.overloadXp.toFixed(0)} (${share(r.overloadXp)}) · DEMOLITION kills ${r.demolitionKills} · total XP ${r.totalXp.toFixed(0)}`);
  }
  console.log('');
  console.log('determinism:');
  if (detLines.length === 0) console.log('  (skipped: --det 0)');
  for (const l of detLines) console.log('  ' + l);

  for (const r of results) violations.push(...runViolations(r));

  // aggregate gates (only meaningful over the full 12-run matrix)
  const clears = results.filter((r) => r.result === 'clear');
  const inWindow = clears.filter((r) => r.endT >= CLEAR_WINDOW_S[0] && r.endT <= CLEAR_WINDOW_S[1]);
  const deaths = results.filter((r) => r.result === 'dead');
  console.log('');
  console.log(`clears ${clears.length}/${results.length} (in ${CLEAR_WINDOW_S[0] / 60}–${CLEAR_WINDOW_S[1] / 60} min: ${inWindow.length}) · deaths ${deaths.length} · timeouts ${results.filter((r) => r.result === 'timeout').length}`);
  {
    const sum = (f: (r: RunResult) => number) => results.reduce((a, r) => a + f(r), 0);
    const tot = sum((r) => r.totalXp);
    const pc = (x: number) => (tot > 0 ? `${((100 * x) / tot).toFixed(1)} %` : '—');
    console.log(`v2 (§0.6): XP share via UPROAR bank ${pc(sum((r) => r.ultXp))} · via OVERLOAD SITE ${pc(sum((r) => r.overloadXp))} · DEMOLITION kills ${sum((r) => r.demolitionKills)} · deaths ${deaths.length} (need ≥ 1 over the 12-run matrix) · --meta ${args.meta}`);
  }
  if (fullMatrix) {
    if (inWindow.length < CLEARS_REQUIRED) violations.push(`clear rate: ${inWindow.length}/12 runs cleared inside ${CLEAR_WINDOW_S[0] / 60}–${CLEAR_WINDOW_S[1] / 60} min (need ≥ ${CLEARS_REQUIRED})`);
    if (deaths.length === 0) violations.push('difficulty: the bot died in 0 of 12 runs (v2 §0.6: deaths ≥ 1 — the gate wants some deaths, not a walkover)');
    for (const r of clears) if (r.endT < CLEAR_WINDOW_S[0]) violations.push(`${r.titan}/${r.biome}: cleared at ${r.endT.toFixed(0)} s (< ${CLEAR_WINDOW_S[0]} s — too fast)`);
    // GATEKEEPERS §5.3 matrix medians
    for (let k = 1; k <= 3; k++) {
      const fs = results.map((r) => r.gateFightS[k]).filter((x) => !Number.isNaN(x));
      const m = median(fs);
      if (fs.length && (m < GATE2_V3.gateFightMedianS[0] || m > GATE2_V3.gateFightMedianS[1])) violations.push(`gatekeeper ${k}: matrix median fight ${m.toFixed(1)} s over ${fs.length} kills, outside ${GATE2_V3.gateFightMedianS[0]}–${GATE2_V3.gateFightMedianS[1]} s`);
    }
    const mf = results.filter((r) => !Number.isNaN(r.mainKillT) && !Number.isNaN(r.bossT)).map((r) => r.mainKillT - r.bossT);
    const mm = median(mf);
    if (mf.length && (mm < GATE2_V3.mainFightMedianS[0] || mm > GATE2_V3.mainFightMedianS[1])) violations.push(`city boss: matrix median fight ${mm.toFixed(1)} s over ${mf.length} kills, outside ${GATE2_V3.mainFightMedianS[0]}–${GATE2_V3.mainFightMedianS[1]} s`);
    const ml = results.filter((r) => !Number.isNaN(r.levelAtMainSpawn) && !Number.isNaN(r.levelAtMainKill)).map((r) => r.levelAtMainKill - r.levelAtMainSpawn);
    const mlm = median(ml);
    if (ml.length && mlm > GATE2_V3.mainFightLevels.median) violations.push(`city fight: matrix median ${mlm} levels gained (> ${GATE2_V3.mainFightLevels.median})`);
  } else {
    console.log(`aggregate gates (≥ ${CLEARS_REQUIRED}/12 clears in ${CLEAR_WINDOW_S[0] / 60}–${CLEAR_WINDOW_S[1] / 60} min, some deaths) skipped: not the full 4×3 matrix`);
  }
  {
    const md = (xs: number[]) => { const f = xs.filter((x) => !Number.isNaN(x)); return f.length ? `${median(f).toFixed(1)} (${f.length})` : '—'; };
    const g = [1, 2, 3].map((k) => `G${k} ${md(results.map((r) => r.gateFightS[k]))} s`).join(' · ');
    console.log(`GATE2_V3 medians: fights ${g} · city fight ${md(results.map((r) => r.mainKillT - r.bossT))} s · levels in the city fight ${md(results.map((r) => r.levelAtMainKill - r.levelAtMainSpawn))} · caps fired ${results.filter((r) => r.gateCapped.some(Boolean)).length}`);
  }
  const slow = results.filter((r) => r.simP99Ms > BUDGET.simTickMsMax);
  for (const r of slow) console.log(`  note: ${r.titan}/${r.biome} sim p99 ${r.simP99Ms.toFixed(2)} ms/tick > budget ${BUDGET.simTickMsMax} ms (informational)`);

  if (args.json) {
    try {
      mkdirSync(dirname(args.json), { recursive: true });
      writeFileSync(args.json, JSON.stringify({ args, results, determinism: detLines, violations }, (_k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v), 2), 'utf8');
      console.log(`report → ${args.json}`);
    } catch (e) { console.log(`could not write ${args.json}: ${String(e)}`); }
  }

  console.log(`wall ${((performance.now() - wall0) / 1000).toFixed(1)} s`);
  if (violations.length) {
    console.log(`\nGATE 2: FAIL — ${violations.length} violation(s):`);
    for (const v of violations) console.log('  X ' + v);
    return 1;
  }
  console.log('\nGATE 2: PASS');
  return 0;
}

process.exitCode = await main();
