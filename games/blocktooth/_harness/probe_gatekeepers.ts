// BLOCKTOOTH — GATEKEEPERS probe (GATEKEEPERS.md §5.4; lane K1a). Node, THREE-free. Exit 0 = every assertion
// holds · 1 = failures (listed) · 2 = the sim could not be loaded.
//
//   node _harness/probe_gatekeepers.ts                  # every case
//   node _harness/probe_gatekeepers.ts --only 1,2,6b    # a subset (case ids as in §5.4: 1 2 3 4 5 6 6b 6c 7 7b 7c 8 9 10 11 12 13 14 15 16)
//   node _harness/probe_gatekeepers.ts --calibrate      # case 4 + the per-titan fight medians K1b tunes GATE_HP_MUL with
//   node _harness/probe_gatekeepers.ts --quick          # seed 1337 only in the matrix / scenario sweeps (dev loop)
//
// THE MATRIX (cases 1, 2, 3, 4, 5-share, 9, 10, 13, 14, 16-lock): 4 titans × 3 cities × seeds 1337 / 7 / 99, fresh
// meta, the gate bot (bot.ts + bot_gate.ts), no god, every draft bot-picked — exactly how GATE 2 plays.
//   1  Summon: gatekeeper s locks on the tick LV RANK_LEVELS[s] is reached (or on the kill tick of a chained lock)
//      and spawns at dueT = max(lockT + summonDelayS, lastBreachT + chainGapS[, mainEarliestS]) ± 1 tick; spawn
//      bands per §5.3 (GATE2_V3.spawnBand / mainSpawn).
//   2  Never breach without the kill: every tick titan.rank ≤ gates.unlocked; every rankUp r ≥ 1 is on a tick with
//      gateDefeated slot r (r ≤ 3) or the city boss's bossDefeated (r = 4).
//   3  The breach is on the kill tick; the height lands at titanHeightAt(rank, level) GROW_TWEEN_S + 1 tick later.
//   4  Beatable: ≥ 34 of 36 runs kill STENCIL-1; each gatekeeper killed in ≥ 80 % of the runs that reach it; every
//      fight 15–90 s; per-gatekeeper median 25–55 s; each titan's median per gatekeeper 18–75 s.
//   9  Finale (natural clears): rankUp 4 + finale on on the kill tick; 0 titan damage, no enemy fire and no hostile
//      tell in the finale; runEnd clear exactly GATES.finaleS later with run.endT === gates.mainKillT and rank 4.
//   10 City boss at Size IV: bossH === titanHeightAt(3, 35); never before mainEarliestS; ≤ 6 levels in the fight;
//      matrix median fight 60–150 s; bossFrameNeed(w).d never saturates at the per-rank cap bossFrameMaxMul(rank) × curve D (§4.2: rank 3 has its own).
//   13 Determinism: config 1 run twice → identical hashes at every 60 s checkpoint.
//   14 RAMROD: the first eliteSpawn is on the first tick ≥ killT[3] + 30 s with no fight alive and no slot 1–3 lock
//      pending; none before killT[3]; never while such a lock is pending or a fight is alive.
// SCENARIOS
//   5  Weak points: open weak point ≥ 30 % of the titan's damage to the rig while open (MOLO, VOLT-KITE; policy duels);
//      findTarget at the keep-out / push-out distance behind the open drum / the pack / facing a dish returns that
//      part; CORDON-2's pack is the nearest part over ≥ ±40° behind it.
//   6  Fair tells (the boss_threat policy port of probe_boss3, god, 5 seeds, phases forced every 30 s): tells landed
//      on VOLT-KITE and MOLO 4–20 %; windup ≥ 0.9 s (0.8 s in P3); no hit > GATES.hitCap; never inside a hard
//      keep-out. At the home Size AND against the Size V rematch (KEEP GOING, rotation forced to that gatekeeper).
//   6c Walkers (fx2): the same port with NO dash and a fixed 0.35 s reaction, 4 titans, each gatekeeper at home and each
//      city boss at Size IV: tells landed ≤ 20 % per titan × boss.
//   6b Volley geometry (pure): volleyPoints from a titan on the lead point, 100 rng.boss seeds, every phase, the four
//      walk speeds, home H / 60 / 67 (+ slowed 0.65 for STENCIL-1): a straight escape exists; gateWindup ≥ fair;
//      DOUBLE LINE median ≥ 0.3 H; SAWHORSE gaps ≥ 1.04 H; STRIPE RUN lane width = 2 × parts[0].r (live tells).
//   7  Avoider (flees the rig along open streets like a runner — fx2: was a straight line into the first building
//      it could not crush; never attacks, god): pressure 3 by 75 s of fight time; ≥ 1 gateReposition; no
//      pending lock overdue; engagedS 0 and the fatigue clock exactly 0.5 × liveFightS; dead to fatigue by 210 s.
//   7c Out-run on open road (fx2): every building flattened, the case-7 runner: 0 gateRam and ≥ 1 gateReposition within
//      60 s of fight time, each gatekeeper × 4 titans × 3 cities.
//   7b Soaked fighter (VOLT-KITE, HEARTHBACK, no god, gate bot, SWITCHBOARD-5 with its adds held at the 14 cap by
//      the probe): a kill (or a titan death, reported) within 90 s; pressure never rises within band max + 0.5 H;
//      never reaches 3.
//   8  Time caps (a starved run: every pickup deleted each tick, god): locks at max(capS[s], lastBreach + chainGap)
//      with capped; each capped kill tops the level up to RANK_LEVELS[s] and pendingDrafts rises by exactly that.
//   11 Interactions: UPROAR 6 % + 0.30 meter exactly; DEMOLITION 2 %; RED LIGHT freezes the adds, not the rig; the
//      tumbling dps cap (50 % burst → 6 %; two bursts across a window boundary → 12 %); an open weak point takes
//      a whole AoE hit; findTarget prefers an open weak point in reach over 5 nearer enemies, else the nearest enemy.
//   12 EXTENDED COVERAGE: alternation (probe_endless covers the full rotation), rematch HP, bossH ≥ 60, no breach,
//      gate deaths never increment E.rematches, rematchN++, endlessBossDmgMul = 1 + 0.1 n, crush tier 4, moves
//      > 5 H in its first 10 s after the intro, director budget × BOSS_SPAWN_MUL.
//   15 Stuck rule: titan standing still behind the densest block of each city (the building above the crush tier
//      nearest the densest 3 × 3-block window's centre), each gatekeeper at home: no hunting interval > 6 s without
//      0.5 H of progress; in its band within 20 s; RAMMING THROUGH reported.
//   16 Tick-end breach: the kill tick's rankUp comes after every titan hit event of that tick; a titan already at
//      the next gate level gets gateLocked on the kill tick.
// Harness code: performance.now() times the wall clock only.

import type { BiomeId, BossState, GateId, RunMeta, SimEvent, TitanId, TitanInput, World, Shape } from '../src/core/types.ts';
import { BIOME_IDS, EMPTY_RUN_META, GATE_IDS, TITAN_IDS } from '../src/core/types.ts';
import {
  ENDLESS, GATE2_V3, GATES, GROW_TWEEN_S, LEVEL_GROW_S, RANKS, RANK_LEVELS, SIM_HZ, SMASH_SLOW, ULT, bossFrameMaxMul, bossFrameNeed,
  cameraDistance, titanHeightAt, titanSpeed,
} from '../src/core/config.ts';

type Mods = {
  world: typeof import('../src/core/world.ts');
  draft: typeof import('../src/upgrades/draft.ts');
  bot: typeof import('./bot.ts');
  botGate: typeof import('./bot_gate.ts');
  gates: typeof import('../src/meta/gates.ts');
  endless: typeof import('../src/meta/endless.ts');
  bosses: typeof import('../src/ai/bosses/index.ts');
  titansim: typeof import('../src/titans/titansim.ts');
  targeting: typeof import('../src/combat/targeting.ts');
  damage: typeof import('../src/combat/damage.ts');
  enemies: typeof import('../src/ai/enemies.ts');
  director: typeof import('../src/ai/director.ts');
  powerups: typeof import('../src/meta/powerups.ts');
  citysim: typeof import('../src/city/citysim.ts');
  kits: typeof import('../src/titans/kits/index.ts');
};
let M: Mods;
async function load(): Promise<string | null> {
  try {
    M = {
      world: await import('../src/core/world.ts'),
      draft: await import('../src/upgrades/draft.ts'),
      bot: await import('./bot.ts'),
      botGate: await import('./bot_gate.ts'),
      gates: await import('../src/meta/gates.ts'),
      endless: await import('../src/meta/endless.ts'),
      bosses: await import('../src/ai/bosses/index.ts'),
      titansim: await import('../src/titans/titansim.ts'),
      targeting: await import('../src/combat/targeting.ts'),
      damage: await import('../src/combat/damage.ts'),
      enemies: await import('../src/ai/enemies.ts'),
      director: await import('../src/ai/director.ts'),
      powerups: await import('../src/meta/powerups.ts'),
      citysim: await import('../src/city/citysim.ts'),
      kits: await import('../src/titans/kits/index.ts'),
    };
    return null;
  } catch (e) { return (e as Error)?.stack ?? String(e); }
}

// ─────────────────────────────── harness ───────────────────────────────
const argv = process.argv.slice(2);
const flag = (k: string) => argv.includes(k);
const optv = (k: string): string | null => { const i = argv.indexOf(k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const ONLY = (() => { const s = optv('--only'); return s ? new Set(s.split(',').map((x) => x.trim())) : null; })();
const CALIBRATE = flag('--calibrate');
const QUICK = flag('--quick');
const TRACE7 = process.env.AVOID_TRACE ?? '';   // e.g. switchboard5/voltkite/grideast: a per-0.5 s case-7 trace
/** fx2 diagnostics: DUEL_TRACE=1 prints every landed boss tell of a duel (cast state vs fire state). */
const DUEL_TRACE = process.env.DUEL_TRACE ?? '';
const want = (id: string) => (CALIBRATE ? id === '4' : !ONLY || ONLY.has(id));
const SEEDS = QUICK ? [1337] : [1337, 7, 99];
const TICK = 1 / SIM_HZ;
const NL = String.fromCharCode(10);
const NO: TitanInput = { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
const fails: string[] = [];
let nChecks = 0;
function check(ok: boolean, what: string, detail = ''): boolean {
  nChecks++;
  if (!ok) { fails.push(what + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${what}${detail ? ` — ${detail}` : ''}`); }
  else console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`);
  return ok;
}
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : String(x));
const f2 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : String(x));
function median(xs: number[]): number {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const GATE_NAME: Record<GateId, string> = { stencil1: 'STENCIL-1', cordon2: 'CORDON-2', switchboard5: 'SWITCHBOARD-5' };
const WEAK_PARTS: Record<GateId, string[]> = { stencil1: ['drum'], cordon2: ['pack'], switchboard5: ['dishA', 'dishB', 'dishC'] };
/** hard keep-out (m) by §3.1–§3.3: STENCIL-1 has none (the eased body push-out), CORDON-2 1.2 H + R, SWITCHBOARD-5 1.25 H + R */
function keepOutM(w: World, b: BossState): number {
  const H = M.bosses.bossH(w, b), R = w.titan.radius;
  if (b.id === 'cordon2') return 1.2 * H + R;
  if (b.id === 'switchboard5') return 1.25 * H + R;
  return 0;
}
function bandMaxH(b: BossState): number {
  return Number.isFinite(b.data.bandMaxH) && b.data.bandMaxH > 0 ? b.data.bandMaxH : M.gates.GATE_BAND_MAX[b.id as GateId];
}

function mkWorld(titan: TitanId, biome: BiomeId, seed: number, meta: RunMeta = { ...EMPTY_RUN_META, unlocked: [] }): World {
  return M.world.createWorld({ titan, biome, seed, meta: { ...meta, unlocked: meta.unlocked.slice() } });
}
function drafts(w: World): number {
  let n = 0, g = 0;
  while (M.draft.hasPendingDraft(w) && g++ < 200) {
    const o = w.upgrades.offer && w.upgrades.offer.length ? w.upgrades.offer : M.draft.rollOffer(w, w.upgrades.chestDrafts > 0);
    if (!o || !o.length) break;
    M.draft.pickUpgrade(w, M.bot.botPickUpgrade(w, o));
    n++;
  }
  return n;
}
function botStep(w: World): void { drafts(w); M.world.stepWorld(w, M.bot.botInput(w)); }

const F64 = new Float64Array(1), U32 = new Uint32Array(F64.buffer);
function hashWorld(w: World): string {
  let h = 0x811c9dc5 >>> 0;
  const u = (x: number) => { for (let s = 0; s < 32; s += 8) { h ^= (x >>> s) & 0xff; h = Math.imul(h, 0x01000193) >>> 0; } };
  const n = (x: number) => { F64[0] = x; u(U32[0]); u(U32[1]); };
  const T = w.titan, G = w.gates;
  for (const v of [w.tick, w.t, w.nextId, T.x, T.z, T.hp, T.xp, T.level, T.rank, T.kills, G.unlocked, G.pending, G.active, G.pressure, G.engagedS, G.fightS]) n(v);
  for (const e of w.enemies) if (e.alive) { n(e.x); n(e.z); n(e.hp); }
  if (w.boss) { n(w.boss.hp); n(w.boss.x); n(w.boss.z); n(w.boss.meter); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * A titan held at the ceiling of Size s − 1 with a bot-drafted kit, one level short of gate s (gates up to s − 1
 * opened by the documented dev bypass), settled with spawns off; `lock` then takes the last level → the real lock.
 * s = 4 is the city boss lock. Enemies cleared.
 */
function atGate(titan: TitanId, biome: BiomeId, seed: number, s: 1 | 2 | 3 | 4, god: boolean): World {
  const w = mkWorld(titan, biome, seed);
  w.cheats.god = god; w.cheats.noSpawns = true;
  w.gates.unlocked = (s - 1) as 0 | 1 | 2 | 3;
  for (let g = 0; g < 200 && w.titan.level < RANK_LEVELS[s] - 1; g++) { M.titansim.gainGrowth(w, 1); drafts(w); }
  for (let i = 0; i < 150; i++) { drafts(w); M.world.stepWorld(w, NO); }
  for (const e of w.enemies) e.alive = false;
  w.enemies.length = 0;
  return w;
}
/** take the last level of atGate → gateLocked; then step (NO input) until the gatekeeper / city boss is fielded */
function lockAndSpawn(w: World, s: number): BossState | null {
  if (s === 4) w.gates.mainEarliestT = Math.min(w.gates.mainEarliestT, w.t);   // a probe fixture: no 7:20 wait
  M.titansim.gainGrowth(w, 1); drafts(w);
  // fx2: a titan whose drafts overshot LV 35 during atGate's warm-up locked slot 4 BEFORE the override above, so its
  // due time still carries the 7:20 wait (briarwick/grideast seed 1: dueT 440 → "could not field it") — same fixture intent
  if (s === 4 && w.gates.pending === 4 && w.gates.dueT > w.t) w.gates.dueT = w.t;
  // the noSpawns cheat also holds a pending gate (stepGates, like the director's boss block): lift it until the fight is fielded
  const ns = w.cheats.noSpawns;
  w.cheats.noSpawns = false;
  for (let i = 0; i < 10 * SIM_HZ && !(w.boss && w.boss.alive); i++) {
    M.world.stepWorld(w, NO);
    if (ns) { for (const e of w.enemies) e.alive = false; }
  }
  w.cheats.noSpawns = ns;
  return w.boss && w.boss.alive ? w.boss : null;
}
/** KEEP GOING at LV ≥ 36 Size V with the rotation forced to gatekeeper `id`: the rematch is fielded next tick */
function atRematch(titan: TitanId, biome: BiomeId, seed: number, id: GateId, god: boolean): World | null {
  const w = mkWorld(titan, biome, seed);
  w.cheats.god = god; w.cheats.noSpawns = true;
  w.gates.unlocked = 4;
  for (let g = 0; g < 200 && w.titan.level < 36; g++) { M.titansim.gainGrowth(w, 1); drafts(w); }
  for (let i = 0; i < 150; i++) { drafts(w); M.world.stepWorld(w, NO); }
  for (const e of w.enemies) e.alive = false;
  w.enemies.length = 0;
  w.gates.finaleDone = true; w.gates.mainKillT = w.t;
  w.run.result = 'clear';
  if (!M.endless.continueEndless(w)) return null;
  const ix = GATE_IDS.indexOf(id);
  w.gates.rematchSeq = 2 * ix;
  w.endless!.nextBossT = w.t;
  for (let i = 0; i < 5 && !(w.boss && w.boss.alive); i++) M.world.stepWorld(w, NO);
  return w.boss && w.boss.alive && w.boss.id === id ? w : null;
}

// ─────────────────────────────── the matrix ───────────────────────────────
interface GateFight { slot: number; gate: string; spawnT: number; killT: number; fightS: number; titan: TitanId }
interface MatrixRun {
  titan: TitanId; biome: BiomeId; seed: number; result: string; endT: number;
  fights: GateFight[]; reached: boolean[]; killed: boolean[];
  cityFightS: number; cityLevels: number; hashes: string[]; finalHash: string;
  bad: Record<string, string[]>;
  weakDmg: number; weakAll: number; frameMax: number; frameIntroSat: number; elite: string;
}
function matrixRun(titan: TitanId, biome: BiomeId, seed: number): MatrixRun {
  const w = mkWorld(titan, biome, seed);
  const r: MatrixRun = {
    titan, biome, seed, result: '', endT: NaN, fights: [], reached: [false, false, false, false, false], killed: [false, false, false, false, false],
    cityFightS: NaN, cityLevels: NaN, hashes: [], finalHash: '', bad: {}, weakDmg: 0, weakAll: 0, frameMax: 0, frameIntroSat: 0, elite: '—',
  };
  const bad = (k: string, s: string) => { const a = r.bad[k] ?? (r.bad[k] = []); if (a.length < 4) a.push(`${titan}/${biome}/${seed}: ${s}`); };
  const G = w.gates, T = w.titan;
  const lockInfo: { t: number; due: number; tick: number }[] = [];
  const spawnT = [NaN, NaN, NaN, NaN, NaN];
  let levelAtCitySpawn = NaN;
  let prevLevel = T.level, prevLastBreach = -1;
  let heightCheckAt: { tick: number; kill: number }[] = [];
  let finaleKillTick = -1, finaleHurt = 0, finaleFires = 0, finaleTells = 0;
  const seenTell = new Set<number>();
  // RAMROD bookkeeping (case 14): state at the END of the previous tick (what stepDirector sees)
  let prevEligibleBase = true;   // !fightAlive && !(pending 1..3) && !bossSpawned
  let firstEliteT = NaN, firstEligibleT = NaN;
  const maxT = 13 * 60;
  let prevMask = 0;
  while (!w.run.result && w.t < maxT) {
    drafts(w);
    const tick0 = w.tick;
    M.world.stepWorld(w, M.bot.botInput(w));
    const ev: readonly SimEvent[] = w.events;
    // indices / flags of this tick
    let gateDef = -1, bossDef = false, finaleOn = false, runClear = false, elite = false;
    const rankUps: number[] = [];
    let levelReached = -1;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      switch (e.type) {
        case 'gateDefeated': if (!e.rematch) gateDef = e.slot; break;
        case 'bossDefeated': bossDef = true; break;
        case 'rankUp': rankUps.push(e.rank); break;
        case 'levelUp': levelReached = Math.max(levelReached, e.level); break;
        case 'finale': if (e.on) finaleOn = true; break;
        case 'runEnd': if (e.result === 'clear') runClear = true; break;
        case 'eliteSpawn': elite = true; break;
        case 'gateLocked': {
          const s = e.slot;
          r.reached[s] = true;
          lockInfo[s] = { t: w.t, due: G.dueT, tick: w.tick };
          if (!e.capped) {
            // case 1: on the level-reach tick, or a chained lock on the previous gate's kill tick
            const chained = gateDef === s - 1 || ev.some((x) => x.type === 'gateDefeated' && !x.rematch && x.slot === s - 1);
            if (!(levelReached >= RANK_LEVELS[s] && prevLevel < RANK_LEVELS[s]) && !chained) bad('1', `slot ${s} locked @${f2(w.t)} s not on the LV ${RANK_LEVELS[s]} tick (level ${T.level}, was ${prevLevel})`);
          } else bad('cap', `slot ${s} time cap fired @${f1(w.t)} s`);
          const wantDue = Math.max(w.t + GATES.summonDelayS, G.lastBreachT >= 0 ? G.lastBreachT + GATES.chainGapS : -Infinity, s === 4 ? GATES.mainEarliestS : -Infinity);
          if (Math.abs(G.dueT - wantDue) > 1e-6) bad('1', `slot ${s} dueT ${f2(G.dueT)} ≠ ${f2(wantDue)}`);
          break;
        }
        case 'gateSpawn': if (!e.rematch) {
          spawnT[e.slot] = w.t;
          const L = lockInfo[e.slot];
          if (!L) bad('1', `slot ${e.slot} spawned without a lock`);
          else if (w.t < L.due - 1e-9 || w.t > L.due + TICK + 1e-9) bad('1', `slot ${e.slot} spawned @${f2(w.t)} s, due ${f2(L.due)} s`);
          const [lo, hi] = GATE2_V3.spawnBand[e.slot];
          if (w.t < lo || w.t > hi) bad('1', `gatekeeper ${e.slot} spawned @${f1(w.t)} s outside ${lo}–${hi} s`);
        }
          break;
        case 'bossSpawn': {
          spawnT[4] = w.t; levelAtCitySpawn = T.level;
          const L = lockInfo[4];
          if (!L) bad('1', 'the city boss spawned without a slot 4 lock');
          else if (w.t < L.due - 1e-9 || w.t > L.due + TICK + 1e-9) bad('1', `city boss spawned @${f2(w.t)} s, due ${f2(L.due)} s`);
          const [lo, hi] = GATE2_V3.mainSpawn;
          if (w.t < lo || w.t > hi) bad('1', `city boss spawned @${f1(w.t)} s outside ${lo}–${hi} s`);
          // case 10
          const b = w.boss!;
          if (Math.abs(b.data.H - titanHeightAt(3, 35)) > 1e-6) bad('10', `city boss bossH ${f2(b.data.H)} ≠ titanHeightAt(3, 35) ${f2(titanHeightAt(3, 35))}`);
          if (w.t < GATES.mainEarliestS - 1e-9) bad('10', `city boss spawned @${f2(w.t)} s < mainEarliestS`);
          break;
        }
        default: break;
      }
    }
    // case 2: rank ≤ unlocked; rankUp only on a kill tick
    if (T.rank > G.unlocked) bad('2', `rank ${T.rank} > unlocked ${G.unlocked} @${f2(w.t)}`);
    for (const rk of rankUps) {
      if (rk >= 1 && rk <= 3 && gateDef !== rk) bad('2', `rankUp ${rk} @${f2(w.t)} without gateDefeated slot ${rk} on the tick`);
      if (rk === 4 && !bossDef) bad('2', `rankUp 4 @${f2(w.t)} without the city boss's bossDefeated`);
    }
    // case 3
    if (gateDef >= 1) {
      if (!rankUps.includes(gateDef)) bad('3', `gate ${gateDef} kill @${f2(w.t)} without rankUp ${gateDef} on the tick`);
      heightCheckAt.push({ tick: w.tick + Math.round(GROW_TWEEN_S * SIM_HZ) + 1, kill: w.t });
      const sp = spawnT[gateDef];
      r.fights.push({ slot: gateDef, gate: GATE_IDS[gateDef - 1], spawnT: sp, killT: w.t, fightS: w.t - sp, titan });
      r.killed[gateDef] = true;
    }
    // a level step DURING the breach tween re-aims it (titansim grow(): dur = max(LEVEL_GROW_S, growT), never cut
    // short): the landing check then moves to that step's own end + 1 tick
    if (levelReached > 0) for (const hc of heightCheckAt) if (hc.tick >= w.tick) hc.tick = Math.max(hc.tick, w.tick + Math.round(LEVEL_GROW_S * SIM_HZ) + 1);
    for (const hc of heightCheckAt) if (hc.tick === w.tick) {
      const want = titanHeightAt(T.rank, T.level);
      if (T.growT > 1e-9 || Math.abs(T.height - want) > 1e-3) bad('3', `breach @${f2(hc.kill)}: at tick +${w.tick - Math.round(hc.kill * SIM_HZ)} the tween ${T.growT > 1e-9 ? 'is still running' : 'ended'} (H ${f2(T.height)} vs titanHeightAt(${T.rank}, ${T.level}) ${f2(want)})`);
    }
    heightCheckAt = heightCheckAt.filter((hc) => hc.tick > w.tick);
    // case 9 / 10: the city kill
    if (bossDef && !w.endless) {
      r.killed[4] = true;
      r.cityFightS = w.t - spawnT[4];
      r.cityLevels = T.level - levelAtCitySpawn;
      if (!rankUps.includes(4) || !finaleOn) bad('9', `city kill @${f2(w.t)}: rankUp 4 ${rankUps.includes(4)} · finale on ${finaleOn} on the kill tick`);
      finaleKillTick = w.tick;
      if (r.cityLevels > GATE2_V3.mainFightLevels.max) bad('10', `${r.cityLevels} levels in the city fight (> ${GATE2_V3.mainFightLevels.max})`);
    }
    if (finaleKillTick >= 0 && w.tick > finaleKillTick && !runClear) {
      for (const e of ev) { if (e.type === 'titanHurt') finaleHurt++; if (e.type === 'enemyFire') finaleFires++; }
      for (const tg of w.telegraphs) if (tg.alive && tg.owner !== 'titan' && !seenTell.has(tg.id)) { seenTell.add(tg.id); finaleTells++; }
    } else for (const tg of w.telegraphs) if (tg.owner !== 'titan') seenTell.add(tg.id);
    if (runClear) {
      const dt = w.tick - finaleKillTick;
      if (finaleKillTick < 0 || dt !== Math.round(GATES.finaleS * SIM_HZ)) bad('9', `runEnd clear ${dt} ticks after the kill (want ${Math.round(GATES.finaleS * SIM_HZ)})`);
      if (w.run.endT !== G.mainKillT || T.rank !== 4) bad('9', `endT ${f2(w.run.endT)} vs mainKillT ${f2(G.mainKillT)} · rank ${T.rank}`);
      if (finaleHurt || finaleFires || finaleTells) bad('9', `during the finale: titanHurt ${finaleHurt}, enemyFire ${finaleFires}, hostile tells ${finaleTells}`);
    }
    // case 10: framing on every tick of the city fight
    const b = w.boss;
    if (b && b.alive && b.role === 'main' && !w.endless && b.introT > 0) {
      if (bossFrameNeed(w).d >= bossFrameMaxMul(T.rank) * cameraDistance(T.height) * 0.999) r.frameIntroSat++;
    }
    if (process.env.FRAME_TRACE && b && b.alive && b.role === 'main' && !w.endless && w.tick % 30 === 0) {
      const Hh = M.bosses.bossH(w, b);
      console.log(`    [city] t=${w.t.toFixed(1)} P${b.phase} att=${b.attack ?? '-'} d=${(Math.hypot(T.x - b.x, T.z - b.z) / Hh).toFixed(2)}H hp=${(T.hp / T.maxHp).toFixed(2)} dash=${T.dashCharges} leash=${T.leash ? 1 : 0} frame=${(bossFrameNeed(w).d / Math.max(1e-6, cameraDistance(T.height))).toFixed(2)}`);
    }
    if (b && b.alive && b.role === 'main' && !w.endless && b.introT <= 0) {
      const need = bossFrameNeed(w).d, cap = bossFrameMaxMul(T.rank) * cameraDistance(T.height);
      r.frameMax = Math.max(r.frameMax, need / Math.max(1e-6, cameraDistance(T.height)));
      if (need >= cap * 0.999) bad('10', `bossFrameNeed saturated at maxMul × curve @${f1(w.t)} s (P${b.phase}, ${f1(w.t - spawnT[4])} s after the spawn)`);
      if (need >= cap * 0.999 && process.env.FRAME_TRACE) {
        const Hh = M.bosses.bossH(w, b);
        console.log(`    [frame] t=${w.t.toFixed(2)} T=(${(T.x / Hh).toFixed(2)},${(T.z / Hh).toFixed(2)})H boss=(${(b.x / Hh).toFixed(2)},${(b.z / Hh).toFixed(2)})H d=${(Math.hypot(T.x - b.x, T.z - b.z) / Hh).toFixed(2)}H leash=${T.leash ? T.leash.t.toFixed(2) : '-'} tells: ${w.telegraphs.filter((q) => q.alive && q.owner === 'boss').map((q) => `${q.tag}@${q.t.toFixed(2)}/${q.windup.toFixed(2)}+${q.active.toFixed(1)} ${JSON.stringify(q.shape, (k, v) => typeof v === 'number' ? Math.round((v / Hh) * 100) / 100 : v)}`).join(' | ')}`);
      }
    }
    // case 5 (matrix share): titan damage to the rig while a weak point is open
    if (b && b.role === 'gate' && b.slot >= 1) {
      const mask = (b.data.weakMask ?? 0) | 0;
      if (mask !== 0 && prevMask !== 0) {
        const weak = WEAK_PARTS[b.id as GateId];
        for (const e of ev) if (e.type === 'bossHit') { r.weakAll += e.dmg; if (weak.includes(e.part)) r.weakDmg += e.dmg; }
      }
      prevMask = b.alive ? mask : 0;
    } else prevMask = 0;
    // case 14
    const k3 = G.killT[3];
    if (Number.isFinite(k3) && Number.isNaN(firstEligibleT) && w.t >= k3 + 30 - 1e-9 && prevEligibleBase) firstEligibleT = w.t;
    if (elite) {
      const pend = G.pending >= 1 && G.pending <= 3;
      if (Number.isNaN(firstEliteT)) firstEliteT = w.t;
      if (!Number.isFinite(k3)) bad('14', `RAMROD @${f1(w.t)} s before SWITCHBOARD-5's kill`);
      if (!prevEligibleBase || pend) bad('14', `RAMROD @${f1(w.t)} s while a slot 1–3 lock is pending or a fight is alive`);
    }
    prevEligibleBase = !M.gates.fightAlive(w) && !(G.pending >= 1 && G.pending <= 3) && !w.director.bossSpawned;
    if (G.lastBreachT !== prevLastBreach) prevLastBreach = G.lastBreachT;
    prevLevel = T.level;
    if ((w.tick) % (60 * SIM_HZ) === 0) r.hashes.push(hashWorld(w));
    void tick0;
  }
  if (!Number.isNaN(firstEliteT)) {
    r.elite = `RAMROD @${f1(firstEliteT)} (k3+30 = ${f1(G.killT[3] + 30)}, first eligible ${f1(firstEligibleT)})`;
    if (!(Math.abs(firstEliteT - firstEligibleT) < 1e-6)) bad('14', `first RAMROD @${f2(firstEliteT)} s, first eligible tick @${f2(firstEligibleT)} s`);
  } else r.elite = Number.isFinite(G.killT[3]) ? `no RAMROD (city boss @${f1(spawnT[4])} before k3+30 ${f1(G.killT[3] + 30)} or eligible never)` : 'no RAMROD (G3 not killed)';
  r.result = w.run.result ?? 'timeout';
  r.endT = w.run.result ? w.run.endT : w.t;
  r.finalHash = hashWorld(w);
  return r;
}

function runMatrix(): void {
  console.log('\nTHE MATRIX — 4 titans × 3 cities × seeds ' + SEEDS.join('/') + ' (gate bot, no god, fresh meta)');
  const runs: MatrixRun[] = [];
  const wall0 = performance.now();
  const mOnly = process.env.MATRIX_ONLY ?? '';   // fx2 diagnostics: e.g. "lockwater/voltkite/99" runs that one config
  for (const biome of BIOME_IDS) for (const titan of TITAN_IDS) for (const seed of SEEDS) {
    if (mOnly && mOnly !== `${biome}/${titan}/${seed}`) continue;
    const t0 = performance.now();
    const r = matrixRun(titan, biome, seed);
    runs.push(r);
    const fs = r.fights.map((f) => `G${f.slot} ${f1(f.fightS)}`).join(' ');
    const nb = Object.values(r.bad).reduce((a, x) => a + x.length, 0);
    console.log(`  ${biome.padEnd(11)} ${titan.padEnd(10)} ${String(seed).padEnd(5)} ${r.result.padEnd(7)} @${f1(r.endT).padStart(6)} s · fights ${fs || '—'} · city ${f1(r.cityFightS)} s (+${Number.isNaN(r.cityLevels) ? '—' : r.cityLevels} LV) · frame ≤ ${f2(r.frameMax)}×${r.frameIntroSat ? ` (intro walk-in saturated ${r.frameIntroSat} ticks)` : ''} · ${r.elite}${nb ? ` · ${nb} issue(s)` : ''} · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
  console.log(`  (${runs.length} runs, ${((performance.now() - wall0) / 1000).toFixed(0)} s wall)`);
  const allBad = (k: string) => runs.flatMap((r) => r.bad[k] ?? []);
  if (!CALIBRATE) {
    console.log('\n1. Summon');
    check(allBad('1').length === 0, 'every lock on its level-reach (or chained-kill) tick; every spawn at dueT ± 1 tick; spawn bands §5.3', allBad('1').slice(0, 6).join(' | '));
    check(allBad('cap').length === 0, 'no time cap fired in the matrix (§2.7: a cap firing is a GATE 2 failure)', allBad('cap').slice(0, 6).join(' | '));
    console.log('\n2. Never breach without the kill');
    check(allBad('2').length === 0, 'rank ≤ gates.unlocked on every tick; every rankUp on a kill tick', allBad('2').slice(0, 6).join(' | '));
    console.log('\n3. The breach is on the kill tick');
    check(allBad('3').length === 0, 'rankUp on the kill tick; H lands at titanHeightAt(rank, level) GROW_TWEEN_S + 1 tick later', allBad('3').slice(0, 6).join(' | '));
  }
  console.log('\n4. Beatable');
  const reach = (s: number) => runs.filter((r) => r.reached[s]).length;
  const kills = (s: number) => runs.filter((r) => r.killed[s]).length;
  check(kills(1) >= Math.ceil(runs.length * 34 / 36), `STENCIL-1 killed in ${kills(1)} of ${runs.length} runs (need ≥ ${Math.ceil(runs.length * 34 / 36)})`);
  for (let s = 1; s <= 3; s++) {
    const n = reach(s), k = kills(s);
    check(n === 0 || k >= 0.8 * n, `${GATE_NAME[GATE_IDS[s - 1]]}: killed in ${k} of the ${n} runs that reached it (need ≥ 80 %)`);
    const fs = runs.flatMap((r) => r.fights.filter((f) => f.slot === s));
    const outB = fs.filter((f) => f.fightS < GATE2_V3.gateFightS[0] || f.fightS > GATE2_V3.gateFightS[1]);
    check(outB.length === 0, `${GATE_NAME[GATE_IDS[s - 1]]}: every fight ${GATE2_V3.gateFightS[0]}–${GATE2_V3.gateFightS[1]} s`, outB.slice(0, 6).map((f) => `${f.titan} ${f1(f.fightS)}`).join(' '));
    const m = median(fs.map((f) => f.fightS));
    check(!fs.length || (m >= GATE2_V3.gateFightMedianS[0] && m <= GATE2_V3.gateFightMedianS[1]), `${GATE_NAME[GATE_IDS[s - 1]]}: median fight ${f1(m)} s over ${fs.length} (band ${GATE2_V3.gateFightMedianS[0]}–${GATE2_V3.gateFightMedianS[1]})`);
    const per: string[] = [];
    for (const t of TITAN_IDS) {
      const mt = median(fs.filter((f) => f.titan === t).map((f) => f.fightS));
      per.push(`${t} ${f1(mt)}`);
      check(Number.isNaN(mt) || (mt >= 18 && mt <= 75), `${GATE_NAME[GATE_IDS[s - 1]]} × ${t}: median ${f1(mt)} s in 18–75 s`);
    }
    if (CALIBRATE) console.log(`  CALIBRATE ${GATE_IDS[s - 1]}: per-titan medians ${per.join(' · ')} · all ${f1(m)} s · GATE_HP_MUL[${GATE_IDS[s - 1]}] now ${JSON.stringify((M.gates as unknown as { GATE_HP_MUL?: unknown }).GATE_HP_MUL ?? 'config')}`);
  }
  if (CALIBRATE) return;
  console.log('\n5. Weak points (matrix share, all titans)');
  {
    const wd = runs.reduce((a, r) => a + r.weakDmg, 0), wa = runs.reduce((a, r) => a + r.weakAll, 0);
    console.log(`  info: over the matrix, ${wa > 0 ? ((100 * wd) / wa).toFixed(0) : '—'} % of the titans' rig damage while a weak point was open landed on it`);
  }
  console.log('\n9. Finale');
  check(allBad('9').length === 0, `finale on + rankUp 4 on the kill tick; no damage / fire / tells in it; runEnd clear ${GATES.finaleS} s later with endT = the kill (${runs.filter((r) => r.result === 'clear').length} clears)`, allBad('9').slice(0, 6).join(' | '));
  console.log('\n10. City boss at Size IV (matrix)');
  check(allBad('10').length === 0, 'bossH = titanHeightAt(3, 35); never before mainEarliestS; ≤ 6 levels in the fight; framing never saturates', allBad('10').slice(0, 6).join(' | '));
  const cf = runs.map((r) => r.cityFightS).filter((x) => Number.isFinite(x));
  const mcf = median(cf);
  check(!cf.length || (mcf >= GATE2_V3.mainFightMedianS[0] && mcf <= GATE2_V3.mainFightMedianS[1]), `city fight median ${f1(mcf)} s over ${cf.length} kills (band ${GATE2_V3.mainFightMedianS.join('–')})`);
  console.log('\n14. RAMROD');
  check(allBad('14').length === 0, 'the first RAMROD on the first eligible tick ≥ killT[3] + 30 s; never before, never during a lock or fight', allBad('14').slice(0, 6).join(' | '));
  console.log('\n13. Determinism');
  if (want('13')) {
    const a = runs[0];
    const b = matrixRun(a.titan, a.biome, a.seed);
    const same = a.hashes.length === b.hashes.length && a.hashes.every((h, i) => h === b.hashes[i]) && a.finalHash === b.finalHash;
    check(same, `${a.titan}/${a.biome}/${a.seed} run twice: ${a.hashes.length} checkpoints + final ${a.finalHash} / ${b.finalHash}`);
  }
}

// ─────────────────────────────── policy duels (cases 5, 6) ───────────────────────────────
const C = Math.SQRT1_2;
function hash01(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function inside(s: Shape, x: number, z: number, r: number): boolean {
  switch (s.k) {
    case 'circle': return Math.hypot(x - s.x, z - s.z) <= s.r + r;
    case 'ring': { const d = Math.hypot(x - s.x, z - s.z); return d + r >= s.r0 && d - r <= s.r1; }
    case 'cone': {
      const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
      if (d - r > s.r) return false; if (d <= r) return true;
      let a = Math.atan2(dx, dz) - s.dir; a = Math.atan2(Math.sin(a), Math.cos(a));
      return Math.abs(a) <= s.half + Math.asin(Math.min(1, r / d));
    }
    case 'lane': {
      const fx = Math.sin(s.dir), fz = Math.cos(s.dir), dx = x - s.x, dz = z - s.z;
      const al = dx * fx + dz * fz, sd = dx * fz - dz * fx;
      return al >= -r && al <= s.len + r && Math.abs(sd) <= s.w / 2 + r;
    }
    case 'oval': {
      const fx = Math.sin(s.rot), fz = Math.cos(s.rot), dx = x - s.x, dz = z - s.z;
      const lz = dx * fx + dz * fz, lx = dx * fz - dz * fx, ex = lx / (s.rx + r), ez = lz / (s.rz + r);
      return ex * ex + ez * ez <= 1;
    }
    case 'capsule': {
      const vx = s.x1 - s.x0, vz = s.z1 - s.z0, L2 = vx * vx + vz * vz;
      let t = L2 > 1e-9 ? ((x - s.x0) * vx + (z - s.z0) * vz) / L2 : 0; t = Math.max(0, Math.min(1, t));
      return Math.hypot(x - (s.x0 + vx * t), z - (s.z0 + vz * t)) <= s.r + r;
    }
  }
  return false;
}
function esc(s: Shape, x: number, z: number, cheap = false): [number, number] {
  // 6c's walker (cheap): out of a cone by the SHORTER exit, like a player — past the reach when that is nearer than
  // the side edge (the boss_threat port always steps sideways)
  if (cheap && s.k === 'cone') {
    const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz);
    let a = Math.atan2(dx, dz) - s.dir; a = Math.atan2(Math.sin(a), Math.cos(a));
    const side = d * Math.sin(Math.max(0, s.half - Math.abs(a))), out = s.r - d;
    if (d > 1e-6 && out < side) return [dx / d, dz / d];
  }
  if (s.k === 'lane') { const fx = Math.sin(s.dir), fz = Math.cos(s.dir); const sd = (x - s.x) * fz - (z - s.z) * fx; const g = sd >= 0 ? 1 : -1; return [fz * g, -fx * g]; }
  if (s.k === 'cone') { const th = Math.atan2(x - s.x, z - s.z); let a = th - s.dir; a = Math.atan2(Math.sin(a), Math.cos(a)); const g = a >= 0 ? 1 : -1; return [Math.cos(th) * g, -Math.sin(th) * g]; }
  if (s.k === 'capsule') {
    const vx = s.x1 - s.x0, vz = s.z1 - s.z0, L = Math.hypot(vx, vz) || 1;
    const sd = ((x - s.x0) * vz - (z - s.z0) * vx) / L, g = sd >= 0 ? 1 : -1;
    return [(vz / L) * g, (-vx / L) * g];
  }
  const sx = (s as { x: number }).x, sz = (s as { z: number }).z;
  const dx = x - sx, dz = z - sz, d = Math.hypot(dx, dz);
  if (d < 1e-6) return [1, 0];
  if (s.k === 'ring' && s.r0 > 0 && d - s.r0 < s.r1 - d) return [-dx / d, -dz / d];
  return [dx / d, dz / d];
}
function keys(dx: number, dz: number): [number, number] {
  const m = Math.hypot(dx, dz); if (m < 1e-9) return [0, 0];
  dx /= m; dz /= m;
  const ix0 = C * dx - C * dz, iy0 = -C * dx - C * dz;
  const ix = ix0 > 0.38 ? 1 : ix0 < -0.38 ? -1 : 0, iy = iy0 > 0.38 ? 1 : iy0 < -0.38 ? -1 : 0;
  if (!ix && !iy) return [-C, -C];
  const mx = C * ix - C * iy, mz = -C * ix - C * iy, l = Math.hypot(mx, mz);
  return [mx / l, mz / l];
}
const PINQ = { x: 0, z: 0, bumpTier: -1 };
const REACH_H: Record<string, number> = { molo: 0.75, voltkite: 0.9, hearthback: 1.2, briarwick: 1.5 };

interface Duel {
  titan: TitanId; gate: GateId; seed: number; fired: number; landed: number; minWindup: number; minWindupP3: number;
  maxHit: number; keepViol: number; keepPinned: number; openDmg: number; openWeak: number; fightS: number; stagger: number; nan: boolean;
  laneW: number[]; parts0R: number; geom: string[];
  /** fired / landed per telegraph tag (fx2 diagnostics) */
  byTag: Map<string, [number, number]>;
  /** 0-damage control tells (damagingOnly duels): fired / landed, kept out of fired / landed */
  ctrlFired: number; ctrlLanded: number;
}
/** The boss_threat policy port (probe_boss3 §D) against a live gatekeeper, god, no adds; phases forced every phaseS. */
/** Duel options (fx2): `react` = a fixed reaction to a new tell (s; default 0.25 + 0.1 × hash, the boss_threat port);
 *  `noDash` = the policy never dashes (case 6c's walker). */
interface DuelOpts { react?: number; noDash?: boolean; damagingOnly?: boolean; humanEsc?: boolean }
function duel(w: World, seed: number, phaseS: number, geo: boolean, opt: DuelOpts = {}): Duel {
  const b = w.boss!;
  const T = w.titan;
  const D: Duel = {
    titan: T.id, gate: b.id as GateId, seed, fired: 0, landed: 0, minWindup: Infinity, minWindupP3: Infinity, maxHit: 0, keepViol: 0, keepPinned: 0,
    openDmg: 0, openWeak: 0, fightS: 0, stagger: 0, nan: false, laneW: [], parts0R: 0, geom: [], byTag: new Map(), ctrlFired: 0, ctrlLanded: 0,
  };
  const seen = new Map<number, number>(), tagSeen = new Set<number>(), seenP = new Set<number>(), idTag = new Map<number, string>();
  const castInfo = new Map<number, string>(), ctrlIds = new Set<number>();
  let lastDash = -9, lastSpace = -9, mx = 0, mz = -1, phaseT = 0, lastPhase = 1, prevMask = 0;
  const OUT = { x: 0, z: 0 };
  const geoDone = new Set<string>();
  for (let i = 0; i < SIM_HZ * (phaseS * 3 + 20) && b.alive; i++) {
    const t = w.t;
    let dash = false, ability = false;
    if (i % 3 === 0) {
      let sx = 0, sz = 0, tMin = Infinity, n = 0, wSum = 0;
      const circ: { x: number; z: number; w: number }[] = [];
      const rr = T.radius * 1.3 + 0.1 * T.height;
      for (const tg of w.telegraphs) {
        if (!tg.alive || tg.owner === 'titan') continue;
        if (!seen.has(tg.id)) seen.set(tg.id, t + (opt.react !== undefined ? opt.react : 0.25 + 0.1 * hash01(tg.id, seed)));
        if (t < seen.get(tg.id)!) continue;
        let tl: number;
        if (!tg.fired) tl = tg.windup - tg.t; else if (tg.active > 0 && tg.t < tg.windup + tg.active) tl = 0; else continue;
        if (tl > 3 || !inside(tg.shape, T.x, T.z, rr)) continue;
        const [ex, ez] = esc(tg.shape, T.x, T.z, !!opt.humanEsc); const wt = 1 / (0.2 + tl);
        sx += ex * wt; sz += ez * wt; n++; tMin = Math.min(tMin, tl); wSum += wt;
        if (tg.shape.k === 'circle') circ.push({ x: tg.shape.x, z: tg.shape.z, w: wt });
      }
      let dx = 0, dz = 0;
      if (n) { dx = sx; dz = sz; }
      else if (b.introT <= 0) {
        const H = M.bosses.bossH(w, b);
        const g = M.botGate.botGate(w, OUT);
        const bx = b.x - T.x, bz = b.z - T.z, d = Math.hypot(bx, bz) || 1;
        const hold = Math.max((REACH_H[T.id] ?? 1) * T.height * 0.8 + (b.parts[0]?.r ?? 0), keepOutM(w, b) + 0.3 * H);
        if (g) { const gx = g.x - T.x, gz = g.z - T.z, gm = Math.hypot(gx, gz); if (gm > 0.2 * T.height) { dx = gx / gm; dz = gz / gm; } else { dx = -bz / d * 0.3; dz = bx / d * 0.3; } }
        else if (d > hold * 1.15) { dx = bx / d; dz = bz / d; }
        else if (d < hold * 0.8) { dx = -bx / d + 0.6 * (-bz / d); dz = -bz / d + 0.6 * (bx / d); }
        else { dx = -bz / d + 0.25 * bx / d; dz = bx / d + 0.25 * bz / d; }
      } else { dx = b.x - T.x; dz = b.z - T.z; }
      // 6c's walker reads a ROW of circles (a trolley run, a volley line) the way a player does: when the per-circle
      // escapes cancel (the titan stands on the row), it steps SIDEWAYS off the row (the side it already leans to,
      // else away from the rig) instead of freezing on a fixed key — the boss_threat port (case 6) is unchanged
      if (opt.humanEsc && n >= 2 && circ.length >= 2 && Math.hypot(sx, sz) < 0.35 * wSum) {
        circ.sort((p, q) => q.w - p.w);
        let ax = circ[1].x - circ[0].x, az = circ[1].z - circ[0].z;
        const am = Math.hypot(ax, az);
        if (am > 1e-6) {
          ax /= am; az /= am;
          let px = -az, pz = ax;
          const side = (T.x - circ[0].x) * px + (T.z - circ[0].z) * pz;
          const away = (T.x - b.x) * px + (T.z - b.z) * pz;
          if ((Math.abs(side) > 0.5 * T.radius ? side : away) < 0) { px = -px; pz = -pz; }
          dx = px; dz = pz;
          if (process.env.ESC_DBG) console.log(`      [escdbg] t=${t.toFixed(2)} n=${n} circ=${circ.length} sum=${Math.hypot(sx, sz).toFixed(2)} wSum=${wSum.toFixed(2)} p=(${px.toFixed(2)},${pz.toFixed(2)})`);
        }
      }
      // …and it does not walk INTO the rig's hard keep-out wall or its body (it cannot pass them):
      // pressed against the wall, the inward part of the escape is dropped and it slides along the wall instead
      if (opt.humanEsc && n > 0) {
        // the wall: the rig's hard keep-out, or its body (parts[0] + the titan's radius) where it has none
        const kw = Math.max(M.bosses.bossKeepOutM(w, b), (b.parts[0]?.r ?? 0) + T.radius);
        const bx = T.x - b.x, bz = T.z - b.z, bd = Math.hypot(bx, bz);
        if (kw > 0 && bd > 1e-6 && bd < kw + 0.25 * T.height) {
          const ox = bx / bd, oz = bz / bd, inward = -(dx * ox + dz * oz);
          if (inward > 0) {
            dx += inward * ox; dz += inward * oz;
            if (Math.hypot(dx, dz) < 0.2 * Math.hypot(sx, sz) + 1e-6) { dx = ox; dz = oz; }
          }
        }
      }
      const B = w.city.bounds, edge = Math.max(4, 2 * T.height);
      if (T.x < B.minX + edge) dx = Math.abs(dx) + 0.5;
      if (T.x > B.maxX - edge) dx = -Math.abs(dx) - 0.5;
      if (T.z < B.minZ + edge) dz = Math.abs(dz) + 0.5;
      if (T.z > B.maxZ - edge) dz = -Math.abs(dz) - 0.5;
      [mx, mz] = keys(dx, dz);
      if (T.abilityCd <= 0 && t - lastSpace > 1) { ability = true; lastSpace = t; }
      const urgent = n > 0 && tMin < 0.45;
      const periodic = t - lastDash > (T.id === 'voltkite' ? 2.5 : 6);
      if (!opt.noDash && (urgent || periodic) && T.dashCharges >= 1 && t - lastDash > 0.35) { dash = true; lastDash = t; }
    }
    // case 5 geometry: the first tick a weak point is open, MOLO at the keep-out / push-out distance behind it
    const mask0 = (b.data.weakMask ?? 0) | 0;
    if (geo && mask0 !== 0 && b.introT <= 0 && !geoDone.has(b.id)) {
      geoDone.add(b.id);
      const weak = WEAK_PARTS[b.id as GateId];
      let wi = -1;
      for (let k = 0; k < b.parts.length; k++) if (((mask0 >>> k) & 1) && weak.includes(b.parts[k].name)) { wi = k; break; }
      if (wi >= 0) {
        const p = b.parts[wi];
        let ux = p.x - b.x, uz = p.z - b.z; const um = Math.hypot(ux, uz) || 1; ux /= um; uz /= um;
        const H = M.bosses.bossH(w, b);
        const wall = b.id === 'stencil1' ? Math.max(b.parts[0].r + 0.7 * T.radius, um + p.r + T.radius * 0.5) : keepOutM(w, b);
        const x0 = T.x, z0 = T.z;
        T.x = b.x + ux * Math.max(wall, um + p.r * 0.5); T.z = b.z + uz * Math.max(wall, um + p.r * 0.5);
        const range = M.kits.kitReach(w) || 0.9 * H;
        const tg = M.targeting.findTarget(w, T.x, T.z, range, true);
        D.geom.push(`${b.id} ${p.name}: findTarget → ${tg ? (tg.kind === 'boss' ? b.parts[tg.part].name : tg.kind) : 'null'} (range ${f2(range / H)} H, at ${f2(Math.hypot(T.x - b.x, T.z - b.z) / H)} H)`);
        check(!!tg && tg.kind === 'boss' && tg.part === wi, `5. ${T.id} at the ${b.id === 'stencil1' ? 'push-out' : 'keep-out'} distance behind ${GATE_NAME[b.id as GateId]}'s open ${p.name} → findTarget returns it`, D.geom[D.geom.length - 1]);
        T.x = x0; T.z = z0;
      }
    }
    M.world.stepWorld(w, { mx, mz, ability, abilityHeld: false, dash });
    for (const ev of w.events) {
      if (ev.type === 'bossStagger') D.stagger++;
      if (ev.type === 'telegraphFire' && ev.owner === 'boss') {
        if (opt.damagingOnly && ctrlIds.has(ev.id)) { D.ctrlFired++; if (ev.hit) D.ctrlLanded++; continue; }
        D.fired++; if (ev.hit) D.landed++;
        if (DUEL_TRACE && ev.hit) {
          const tgf = w.telegraphs.find((q) => q.id === ev.id);
          const Hh = M.bosses.bossH(w, b);
          console.log(`    [trace ${T.id}/${b.id} s${seed}] HIT ${idTag.get(ev.id)} ${castInfo.get(ev.id) ?? '?'} | fire t=${w.t.toFixed(2)} T=(${(T.x / Hh).toFixed(2)},${(T.z / Hh).toFixed(2)})H boss=(${(b.x / Hh).toFixed(2)},${(b.z / Hh).toFixed(2)})H d=${(Math.hypot(T.x - b.x, T.z - b.z) / Hh).toFixed(2)}H v=${(Math.hypot(T.vx, T.vz) / Hh).toFixed(2)} in=(${mx.toFixed(2)},${mz.toFixed(2)}) dashT=${T.dashT.toFixed(2)} ${tgf ? '' : ''}`);
        }
        const tag = idTag.get(ev.id) ?? '?', row = D.byTag.get(tag) ?? [0, 0];
        row[0]++; if (ev.hit) row[1]++; D.byTag.set(tag, row);
      }
    }
    for (const tg of w.telegraphs) if (tg.owner === 'boss' && !tagSeen.has(tg.id)) {
      tagSeen.add(tg.id); idTag.set(tg.id, tg.tag || tg.kind || '?');
      // a CONTROL tell deals no damage of its own (CAISSON-4's winch leash, IRON GULLY's charge lane — the charge body
      // hits separately): lob paint (tag 'lob:…') is excluded, its projectile carries the damage
      if (!(tg.dmg > 0) && !String(tg.tag || '').startsWith('lob:')) ctrlIds.add(tg.id);
      if (DUEL_TRACE) castInfo.set(tg.id, `cast t=${w.t.toFixed(2)} ph${b.phase} wu=${tg.windup.toFixed(2)} dmg=${(tg.dmg / Math.max(1, T.maxHp)).toFixed(3)} d=${(Math.hypot(T.x - b.x, T.z - b.z) / M.bosses.bossH(w, b)).toFixed(2)}H v=${(Math.hypot(T.vx, T.vz) / M.bosses.bossH(w, b)).toFixed(2)}H/s vrad=${(((T.vx * (T.x - b.x) + T.vz * (T.z - b.z)) / (Math.hypot(T.x - b.x, T.z - b.z) || 1)) / M.bosses.bossH(w, b)).toFixed(2)} walk=${(M.bosses.titanWalk(w) / M.bosses.bossH(w, b)).toFixed(2)} slowT=${T.slowT.toFixed(2)} leash=${T.leash ? T.leash.t.toFixed(2) : '-'} shape=${JSON.stringify(tg.shape, (k, v) => typeof v === 'number' ? Math.round(v * 10) / 10 : v)}`);
      if (b.phase === 3) D.minWindupP3 = Math.min(D.minWindupP3, tg.windup); else D.minWindup = Math.min(D.minWindup, tg.windup);
      D.maxHit = Math.max(D.maxHit, tg.dmg / Math.max(1, T.maxHp));
      if (b.id === 'stencil1' && tg.shape.k === 'lane' && /stripe|run|uTurn/i.test(tg.tag)) D.laneW.push(tg.shape.w / Math.max(1e-6, 2 * b.parts[0].r));
    }
    for (const p of w.projectiles) if (p.owner === 'boss' && !seenP.has(p.id)) { seenP.add(p.id); D.maxHit = Math.max(D.maxHit, p.dmg / Math.max(1, T.maxHp)); }
    // case 5 share
    const mask = (b.data.weakMask ?? 0) | 0;
    if (mask && prevMask) {
      const weak = WEAK_PARTS[b.id as GateId];
      for (const ev of w.events) if (ev.type === 'bossHit') { D.openDmg += ev.dmg; if (weak.includes(ev.part)) D.openWeak += ev.dmg; }
    }
    prevMask = mask;
    if (b.alive && T.alive) {
      const k = keepOutM(w, b);
      const dd = Math.hypot(T.x - b.x, T.z - b.z);
      if (k > 0 && dd < k - 0.05 * M.bosses.bossH(w, b)) {
        // probe_boss3's classification: pinned = the wall point itself is inside a building the titan cannot flatten
        const wx = b.x + ((T.x - b.x) / (dd || 1)) * k, wz = b.z + ((T.z - b.z) / (dd || 1)) * k;
        const pinned = M.citysim.resolveCircleVsCity(w.city, wx, wz, T.radius, T.rank as 0 | 1 | 2 | 3 | 4, PINQ);
        if (pinned) D.keepPinned++; else D.keepViol++;
      }
    }
    if (![b.x, b.z, b.hp, T.x, T.z].every(Number.isFinite)) D.nan = true;
    if (b.phase !== lastPhase) { lastPhase = b.phase; phaseT = 0; }
    if (b.introT <= 0) { phaseT += w.dt; D.fightS += w.dt; }
    if (phaseT > phaseS && b.introT <= 0) {
      if (b.phase === 1) b.hp = Math.min(b.hp, b.maxHp * 0.6);
      else if (b.phase === 2) b.hp = Math.min(b.hp, b.maxHp * 0.3);
      else break;
    }
  }
  return D;
}

/** Landed share per telegraph tag across duels, worst first ("tag landed/fired"). */
function tagRows(ds: Duel[], n = 4): string {
  const m = new Map<string, [number, number]>();
  for (const d of ds) for (const [k, v] of d.byTag) { const r = m.get(k) ?? [0, 0]; r[0] += v[0]; r[1] += v[1]; m.set(k, r); }
  return [...m.entries()].filter(([, v]) => v[1] > 0).sort((a, b) => b[1][1] / b[1][0] - a[1][1] / a[1][0]).slice(0, n).map(([k, v]) => `${k} ${v[1]}/${v[0]}`).join(', ') || '—';
}
/**
 * 6c (fx2, critic r2/r3: walk-only players died where dashers were never hit). The boss_threat port as a WALKER: never
 * dashes, reacts to every new tell after exactly 0.35 s (REACT_S). All four titans; each gatekeeper at its home Size and
 * each city boss at Size IV (LV 35; the boss follows the city: GRID EAST / WHITE STACKS / LOCKWATER); god, no adds,
 * phases forced every 30 s, 5 seeds. Tells landed ≤ 20 % in every titan × boss cell.
 */
function runWalkers(): void {
  const seeds = QUICK ? [1, 2] : [1, 2, 3, 4, 5];
  console.log(`
6c. Fair tells for WALKERS (no dash, 0.35 s reaction, god, no adds, phases forced every 30 s, seeds ${seeds.join('/')})`);
  const fixtures: { name: string; s: 1 | 2 | 3 | 4; biome: BiomeId }[] = [
    ...GATE_IDS.map((g) => ({ name: GATE_NAME[g], s: (GATE_IDS.indexOf(g) + 1) as 1 | 2 | 3, biome: 'grideast' as BiomeId })),
    ...BIOME_IDS.map((bi) => ({ name: `city boss (${bi}, Size IV)`, s: 4 as const, biome: bi })),
  ];
  const only = process.env.WALK_ONLY ?? '';   // fx2 diagnostics: e.g. "4/grideast/molo" runs that one cell
  for (const fx of fixtures) for (const titan of TITAN_IDS) {
    if (only && only !== `${fx.s}/${fx.biome}/${titan}`) continue;
    const ds: Duel[] = [];
    let bossId = '?';
    for (const seed of seeds) {
      const w = atGate(titan, fx.biome, seed, fx.s, true);
      if (!lockAndSpawn(w, fx.s) || !w.boss) { check(false, `6c. ${fx.name} × ${titan} seed ${seed}: could not field it`, `LV ${w.titan.level} rank ${w.titan.rank} t ${w.t.toFixed(1)} gates ${JSON.stringify(w.gates, (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v).slice(0, 400)}`); continue; }
      bossId = w.boss.id;
      ds.push(duel(w, seed, 30, false, { react: 0.35, noDash: true, damagingOnly: true, humanEsc: !process.env.NO_HUMAN_ESC }));
    }
    if (!ds.length) continue;
    const fired = ds.reduce((a, d) => a + d.fired, 0), landed = ds.reduce((a, d) => a + d.landed, 0);
    const rate = fired ? landed / fired : 0;
    const tag = `${fx.name} [${bossId}] × ${titan}`;
    const cf = ds.reduce((a, d) => a + d.ctrlFired, 0), cl = ds.reduce((a, d) => a + d.ctrlLanded, 0);
    console.log(`  ${tag}: tells ${landed}/${fired} landed (${(100 * rate).toFixed(1)} %) · worst tags ${tagRows(ds)}${cf ? ` · 0-damage control tells (not counted) ${cl}/${cf} caught` : ''}`);
    check(fired > 0 && rate <= 0.20, `6c. ${tag}: a walker (no dash, 0.35 s) is landed on ≤ 20 %: ${(100 * rate).toFixed(1)} %`, `${landed}/${fired}`);
  }
}

function runDuels(): void {
  const doHome = want('6') || want('5');
  const doV = want('6');
  const seeds = QUICK ? [1, 2] : [1, 2, 3, 4, 5];
  for (const where of ['home', 'Size V'] as const) {
    if (where === 'home' && !doHome) continue;
    if (where === 'Size V' && !doV) continue;
    console.log(`\n6. Fair tells — ${where} (boss_threat policy port, god, no adds, phases forced every 30 s, seeds ${seeds.join('/')})`);
    for (const gate of GATE_IDS) {
      for (const titan of ['voltkite', 'molo'] as TitanId[]) {
        const ds: Duel[] = [];
        for (const seed of seeds) {
          let w: World | null;
          if (where === 'home') {
            const s = (GATE_IDS.indexOf(gate) + 1) as 1 | 2 | 3;
            w = atGate(titan, 'grideast', seed, s, true);
            if (!lockAndSpawn(w, s)) w = null;
          } else w = atRematch(titan, 'grideast', seed, gate, true);
          if (!w || !w.boss) { check(false, `${where} ${gate} × ${titan} seed ${seed}: could not field the gatekeeper`); continue; }
          // DUEL_REACT (diagnostics only, never in a gate run): force the policy's reaction to test how tight the tells are
          ds.push(duel(w, seed, 30, where === 'home' && seed === seeds[0], process.env.DUEL_REACT ? { react: Number(process.env.DUEL_REACT) } : {}));
        }
        if (!ds.length) continue;
        const fired = ds.reduce((a, d) => a + d.fired, 0), landed = ds.reduce((a, d) => a + d.landed, 0);
        const rate = fired ? landed / fired : 0;
        const minW = Math.min(...ds.map((d) => d.minWindup)), minW3 = Math.min(...ds.map((d) => d.minWindupP3));
        const maxHit = Math.max(...ds.map((d) => d.maxHit)), keep = ds.reduce((a, d) => a + d.keepViol, 0);
        const oD = ds.reduce((a, d) => a + d.openDmg, 0), oW = ds.reduce((a, d) => a + d.openWeak, 0);
        const tag = `${where} ${GATE_NAME[gate]} × ${titan}`;
        console.log(`  ${tag}: tells ${landed}/${fired} landed (${(100 * rate).toFixed(1)} %) · min windup ${f2(minW)} s (P3 ${f2(minW3)}) · max hit ${(100 * maxHit).toFixed(1)} % · keep-out ticks ${keep} (+${ds.reduce((a, d) => a + d.keepPinned, 0)} pinned against a building, reported separately as probe_boss3 does) · staggers ${ds.map((d) => d.stagger).join('/')} · open-weak share ${oD > 0 ? ((100 * oW) / oD).toFixed(0) : '—'} % · landed by tag ${tagRows(ds)}`);
        if (want('6')) {
          check(fired > 0 && rate >= 0.04 && rate <= 0.20, `6. ${tag}: tells landed ${(100 * rate).toFixed(1)} % in 4–20 %`, `${landed}/${fired}`);
          check(minW >= 0.9 - 1e-9 && minW3 >= 0.8 - 1e-9, `6. ${tag}: every windup ≥ 0.9 s (0.8 s in P3)`, `${f2(minW)} / P3 ${f2(minW3)}`);
          check(maxHit <= GATES.hitCap + 1e-9, `6. ${tag}: no hit > GATES.hitCap ${GATES.hitCap}`, `${(100 * maxHit).toFixed(1)} %`);
          check(keep === 0, `6. ${tag}: never inside the hard keep-out on open ground`, `${keep} ticks`);
          check(!ds.some((d) => d.nan), `6. ${tag}: no NaN`);
        }
        if (where === 'home' && want('5')) check(oD > 0 && oW / oD >= 0.3, `5. ${tag}: ≥ 30 % of the titan's damage to the rig lands on the open weak point while it is open`, oD > 0 ? `${((100 * oW) / oD).toFixed(0)} % of ${oD.toFixed(0)}` : 'no damage while open (no window reached)');
        if (gate === 'stencil1' && want('6b')) {
          const lw = ds.flatMap((d) => d.laneW);
          check(lw.length > 0 && lw.every((x) => Math.abs(x - 1) < 1e-6), `6b. STRIPE RUN lane width = 2 × parts[0].r on every live tell (${where}, ${titan})`, lw.length ? `ratios ${[...new Set(lw.map((x) => x.toFixed(3)))].join(',')}` : 'no stripe lane seen');
        }
      }
    }
  }
  if (want('5')) {
    // CORDON-2's pack: nearest part over ≥ ±40° behind (pure geometry on the live parts)
    const w = atGate('molo', 'grideast', 1337, 2, true);
    const b = lockAndSpawn(w, 2);
    if (check(!!b && b.id === 'cordon2', '5. CORDON-2 fielded for the rear-arc geometry')) {
      const T = w.titan, H = M.bosses.bossH(w, b!);
      const pk = b!.parts.findIndex((p) => p.name === 'pack');
      const k = keepOutM(w, b!);
      let arc = 0;
      for (let a = 0; a <= 90; a += 1) {
        let okA = true;
        for (const sgn of [1, -1]) {
          const ang = b!.heading + Math.PI + sgn * (a * Math.PI) / 180;
          const x = b!.x + Math.sin(ang) * k, z = b!.z + Math.cos(ang) * k;
          let best = -1, bd = Infinity;
          for (let i = 0; i < b!.parts.length; i++) { const p = b!.parts[i]; const d = Math.hypot(p.x - x, p.z - z) - p.r; if (d < bd) { bd = d; best = i; } }
          if (best !== pk) okA = false;
        }
        if (!okA) break;
        arc = a;
      }
      check(pk >= 0 && arc >= 40, `5. CORDON-2's pack is the nearest part over ±${arc}° behind it at the keep-out (need ≥ ±40°)`, `keep-out ${f2(k / H)} H`);
      void T;
    }
  }
}

// ─────────────────────────────── 6b. volley geometry (pure) ───────────────────────────────
function runVolleyGeometry(): void {
  console.log('\n6b. Volley and windup geometry (pure: volleyPoints + gateWindup on the real toolkit)');
  const titans: [TitanId, number][] = [['molo', 0.95], ['voltkite', 1.15], ['hearthback', 0.85], ['briarwick', 1.0]];
  // (gate, attack, count by phase, circle r in H, escape in H beyond r + R, min, max)
  const VOLLEYS: { gate: GateId; name: string; count: number[]; rH: number; min: number; max: number }[] = [
    { gate: 'stencil1', name: 'PAINT BUCKETS', count: [0, 3, 4, 5], rH: 0.45, min: 1.0, max: 1.8 },
    { gate: 'switchboard5', name: 'CALL-IN', count: [0, 3, 4, 5], rH: 0.5, min: 1.1, max: 2.0 },
  ];
  const LEADS: { gate: GateId; name: string; escH: number; min: number; max: number }[] = [
    { gate: 'stencil1', name: 'STRIPE RUN', escH: 0.85, min: 1.1, max: 1.9 },
    { gate: 'stencil1', name: 'PAINT BUCKETS', escH: 0.45, min: 1.0, max: 1.8 },
    { gate: 'stencil1', name: 'DOUBLE LINE', escH: 0.25, min: 1.0, max: 1.8 },
    { gate: 'cordon2', name: 'SHIELD SHOVE', escH: 1.2, min: 1.2, max: 2.2 },
    { gate: 'cordon2', name: 'SAWHORSE TOSS', escH: 0.25, min: 1.1, max: 2.0 },
    { gate: 'switchboard5', name: 'CALL-IN', escH: 0.5, min: 1.1, max: 2.0 },
  ];
  let volleyCases = 0, volleyBad: string[] = [], fairCases = 0, fairBad: string[] = [];
  // TITAN PASS D2 (GATEKEEPERS §3.6): the SPACE-DENIAL rings (bosses/index.ts denialRing) — the lead circle of these volleys and every
  // dash answer carries a ring r0..r1 around it that fires WITH it. Walk-fair combo: the straight exit that clears the
  // lead (r + R) and the secondaries must also END in the dry moat (+ the titan's braking distance) — never in the ring;
  // and a straight dash from the lead's centre must end in the ring band (what the combo reads).
  const RINGED = new Set(['PAINT BUCKETS', 'CALL-IN']);
  // CORDON-2's answer is a sawhorse capsule (half 0.6 H, r 0.25 H) whose sideways walk-out ends within hypot(0.6 H, r + R):
  // its ring is built on the circle of that radius − R (cordon2.ts), checked here as that circle
  const DASH_ANS: { gate: GateId; rH: number; cap?: boolean }[] = [{ gate: 'stencil1', rH: 0.4 }, { gate: 'switchboard5', rH: 0.45 }, { gate: 'cordon2', rH: 0.25, cap: true }];
  let ringCases = 0; const ringBad: string[] = [];
  for (const [titan, ms] of titans) {
    for (const gate of GATE_IDS) {
      const s = (GATE_IDS.indexOf(gate) + 1) as 1 | 2 | 3;
      const w = atGate(titan, 'grideast', 1337, s, true);
      const b = lockAndSpawn(w, s);
      if (!b) { volleyBad.push(`${titan}/${gate}: not fielded`); continue; }
      b.introT = 0;
      const T = w.titan;
      const homeH = titanHeightAt((s - 1) as 0 | 1 | 2, RANK_LEVELS[s]);
      const Hs = [homeH, 60, 67];
      const slows = gate === 'stencil1' ? [1, 0.65] : [1];
      for (const H of Hs) for (const slow of slows) for (let phase = 1; phase <= 3; phase++) {
        // pose the titan: height H, walk from titanSpeed(H) × moveSpeed, slowed or not
        T.height = H; T.radius = 0.42 * H; T.stats.moveSpeed = ms;
        T.slowT = slow < 1 ? 5 : 0; T.slowMul = slow;
        b.data.H = H; b.phase = phase as 1 | 2 | 3;
        const R = T.radius;
        const walk = M.bosses.titanWalk(w) * (slow < 1 ? slow : 1);
        const k = M.bosses.ESCAPE_K[phase] ?? 1;
        // fairness: gateWindup ≥ 0.5 + escape / walk × k for every lead
        for (const L of LEADS) if (L.gate === gate) {
          fairCases++;
          const esc = L.escH * H + R;
          const wu = M.bosses.gateWindup(w, b, esc / H, L.min, L.max);
          const fair = 0.5 + (esc / walk) * k;
          if (wu < fair - 1e-6) fairBad.push(`${gate} ${L.name} ${titan} H ${f1(H)} slow ${slow} P${phase}: windup ${f2(wu)} < fair ${f2(fair)}`);
        }
        for (const V of VOLLEYS) if (V.gate === gate) {
          const r = V.rH * H, n = V.count[phase];
          const out = new Float32Array(2 * 9);
          const wuLead = M.bosses.gateWindup(w, b, (r + R) / H, V.min, V.max);
          const ring = RINGED.has(V.name) ? { ...M.bosses.denialRadii(w, b, r) } : null;
          const brake = walk * M.titansim.ACCEL_REACH_S[T.rank] / (2 * M.titansim.DECEL_MUL);
          if (ring) {
            ringCases++;
            const dashM = Math.max(0, T.stats.dashDistance || 2.2) * T.height;
            if (r + 2 * R + brake > ring.r0 - 1e-6) ringBad.push(`${gate} ${V.name} ${titan} H ${f1(H)} P${phase}: the exit + braking ${f2((r + 2 * R + brake) / H)} H reaches the ring (r0 ${f2(ring.r0 / H)} H)`);
            if (!(dashM >= ring.r0 - R - 1e-6 && dashM <= ring.r1 + R + 1e-6)) ringBad.push(`${gate} ${V.name} ${titan} H ${f1(H)} P${phase}: a dash from the centre (${f2(dashM / H)} H) misses the ring band [${f2((ring.r0 - R) / H)}, ${f2((ring.r1 + R) / H)}] H`);
          }
          for (let sd = 0; sd < (QUICK ? 20 : 100); sd++) {
            volleyCases++;
            // rig at a band distance from the titan (who stands on the lead point), in a seeded direction
            const a = hash01(sd, 17 + phase) * Math.PI * 2;
            const keep = keepOutM(w, b) || (b.parts[0].r + 0.7 * R);
            const dist = keep + (r + R) + (0.2 + 3 * hash01(sd, 91)) * H;
            b.x = T.x + Math.sin(a) * dist; b.z = T.z + Math.cos(a) * dist;
            M.bosses.refreshParts(b);
            const np = M.bosses.volleyPoints(w, b, T.x, T.z, n, r, out);
            // fire times: lead at wuLead, secondary i at wuLead + 0.15 i
            let found = false;
            for (let dI = 0; dI < 72 && !found; dI++) {
              const th = (dI * Math.PI * 2) / 72;
              const ex = Math.sin(th), ez = Math.cos(th);
              const need = r + R;
              const tNeed = (need / walk) * k;
              if (tNeed > wuLead - 0.5 + 1e-6) continue;
              const px = T.x + ex * need, pz = T.z + ez * need;
              if (ring && need + R + brake > ring.r0 + 1e-6) continue;   // the exit must stop in the dry moat
              if (keep > 0 && Math.hypot(px - b.x, pz - b.z) < keep) continue;
              let clear = true;
              for (let i = 1; i < np && clear; i++) if (Math.hypot(px - out[2 * i], pz - out[2 * i + 1]) < r + R - 1e-6) clear = false;
              if (clear) found = true;
            }
            if (!found) { if (volleyBad.length < 8) volleyBad.push(`${gate} ${V.name} ${titan} H ${f1(H)} slow ${slow} P${phase} seed ${sd}: no straight exit (n ${np}, lead windup ${f2(wuLead)})`); }
          }
        }
      }
    }
  }
  check(volleyBad.length === 0, `volleys: a straight exit within gateWindup − 0.5 s exists in all ${volleyCases} cases (buckets, flares; home / 60 / 67 H; slowed STENCIL-1; P1–P3; 4 walk speeds)`, volleyBad.slice(0, 4).join(' | '));
  check(fairBad.length === 0, `gateWindup ≥ the fair value in all ${fairCases} lead cases`, fairBad.slice(0, 4).join(' | '));
  // the dash answers' rings: stepping out of the answer (r + R, any direction) and braking stays in the moat
  for (const [titan, ms] of titans) for (const A of DASH_ANS) {
    const s = (GATE_IDS.indexOf(A.gate) + 1) as 1 | 2 | 3;
    const w = atGate(titan, 'grideast', 1337, s, true);
    const b = lockAndSpawn(w, s);
    if (!b) { ringBad.push(`${titan}/${A.gate}: not fielded`); continue; }
    const T = w.titan;
    for (const H of [titanHeightAt((s - 1) as 0 | 1 | 2, RANK_LEVELS[s]), 60, 67]) {
      T.height = H; T.radius = 0.42 * H; T.stats.moveSpeed = ms; T.slowT = 0; b.data.H = H;
      const R = T.radius, r = A.cap ? Math.hypot(0.6 * H, A.rH * H + R) - R : A.rH * H, ring = { ...M.bosses.denialRadii(w, b, r) };
      const brake = M.bosses.titanWalk(w) * M.titansim.ACCEL_REACH_S[T.rank] / (2 * M.titansim.DECEL_MUL);
      ringCases++;
      if (r + 2 * R + brake > ring.r0 - 1e-6) ringBad.push(`${A.gate} dash answer ${titan} H ${f1(H)}: exit + braking reaches the ring`);
    }
  }
  check(ringBad.length === 0, `SPACE-DENIAL rings: the walk-out of the lead / dash answer (+ braking) ends in the dry moat and a straight dash from the centre ends in the ring band, in all ${ringCases} cases (buckets, flares, dash answers; home / 60 / 67 H; 4 walk speeds)`, ringBad.slice(0, 4).join(' | '));
  // DOUBLE LINE and SAWHORSE TOSS by their §3.1 / §3.2 geometry (spacing, widths) vs the titan body R = 0.42 H
  const dlMedian = 2.0 - 0.5 - 2 * 0.42;
  check(dlMedian >= 0.3 - 1e-9, `DOUBLE LINE: median band for the titan's centre ${dlMedian.toFixed(2)} H ≥ 0.3 H (spacing 2.0 H, lines 0.5 H)`);
  const shGap = 1.6 - 2 * 0.25;
  check(shGap >= 0.84 + 0.2 - 1e-9, `SAWHORSE TOSS: gaps ${shGap.toFixed(2)} H ≥ 0.84 H + 0.2 H (spacing 1.6 H, r 0.25 H)`);
}

// ─────────────────────────────── 7. avoider ───────────────────────────────
/**
 * "Always walks directly away from the gatekeeper" — as a RUNNER does it on a street grid (fx2 lane A harness
 * change, made to be MORE like a real player: the K3/K4 avoider walked a straight line into the first building above
 * its crush tier and stood there pinned at 0.07–0.17 × walk, so the rig planted in its band and the titan was — by
 * §2.4 rule a, correctly — engaged; k4/avoid_diag.txt). Every AVOID_REPLAN_S it scores 16 headings: the straight
 * run it can make along each within AVOID_LOOK_S of walking (stopped by a building above its crush tier or by the
 * map edge, ray-marched like laneClearLen; buildings it flattens cost SMASH_SLOW), and the heading whose end point
 * is FARTHEST from the rig wins (a small bonus keeps the current heading: no dithering). So it flees along open
 * streets and turns at corners / around blocks it cannot crush. A heading it is commanding but not moving on
 * (< 0.25 × walk for 0.5 s while facing it) is barred for 2 s. It DASHES along its heading when the rig closes to within band max +
 * 0.5 H + AVOID_DASH_H (a runner spends its dash to get away; dashing is movement, not an attack). Never attacks (the titan's damage is zeroed: auto-attacks are
 * kit-driven, not input-driven, so "never attacks" is enforced on the stats). No RNG: deterministic.
 */
interface AvoidState { hx: number; hz: number; nextT: number; slowT: number; barX: number; barZ: number; barT: number; dashT: number }
function newAvoid(): AvoidState { return { hx: 0, hz: 0, nextT: -1, slowT: 0, barX: 0, barZ: 0, barT: -1, dashT: -9 }; }
const AVOID_REPLAN_S = 0.25, AVOID_LOOK_S = 3, AVOID_HEADINGS = 16, AVOID_ROOM_H = 8, AVOID_DASH_H = 1, AVOID_KEEP_H = 1;
const avBuf: number[] = [];
/** Free straight run (m) from the titan along (fx, fz) up to len, and the extra seconds lost plowing on it. */
function titanRun(w: World, fx: number, fz: number, len: number, walk: number): [number, number] {
  const T = w.titan, c = w.city, Bd = c.bounds;
  const R = 0.85 * Math.max(0.5, T.radius || 0.42 * T.height);
  const canFlat = RANKS[Math.max(0, Math.min(4, T.rank))].canFlatten;
  const step = Math.max(0.5, 0.5 * R);
  let plow = 0;
  for (let s = step; s <= len + 1e-9; s += step) {
    const px = T.x + fx * s, pz = T.z + fz * s;
    // the titan's centre is clamped to the bounds: a step that leaves them ends the run (sliding along an edge is fine)
    if (px < Bd.minX || px > Bd.maxX || pz < Bd.minZ || pz > Bd.maxZ) return [Math.max(0, s - step), plow];
    avBuf.length = 0;
    M.citysim.buildingsInRect(c, px - R, pz - R, px + R, pz + R, avBuf);
    let hitPlow = false;
    for (let i = 0; i < avBuf.length; i++) {
      const bd = c.buildings[avBuf[i]];
      if (!bd || bd.collapsed || !(bd.alive > 0)) continue;
      const qx = Math.max(bd.x - bd.w / 2, Math.min(px, bd.x + bd.w / 2)), qz = Math.max(bd.z - bd.d / 2, Math.min(pz, bd.z + bd.d / 2));
      if (Math.hypot(px - qx, pz - qz) > R) continue;
      if (bd.tier > canFlat) return [Math.max(0, s - step), plow];
      hitPlow = true;
    }
    if (hitPlow) plow += (step / walk) * (1 / SMASH_SLOW - 1);
  }
  return [len, plow];
}
function avoidInput(w: World, b: BossState, st: AvoidState): TitanInput {
  const T = w.titan;
  T.stats.damage = 0; T.stats.smashDamage = 0;
  const walk = Math.max(0.1, M.bosses.titanWalk(w));
  // blocked on the commanded heading: bar it for 2 s
  const sp = Math.hypot(T.vx, T.vz);
  if (st.hx !== 0 || st.hz !== 0) {
    // only while it FACES the heading (a titan turning round is slow, not blocked)
    const facing = Math.sin(T.heading) * st.hx + Math.cos(T.heading) * st.hz > 0.87;
    st.slowT = sp < 0.25 * walk && facing ? st.slowT + w.dt : 0;
    if (st.slowT >= 0.5) { st.barX = st.hx; st.barZ = st.hz; st.barT = w.t + 2; st.slowT = 0; st.nextT = -1; }
  }
  if (w.t >= st.nextT) {
    st.nextT = w.t + AVOID_REPLAN_S;
    const d0 = Math.hypot(T.x - b.x, T.z - b.z);
    let best = -Infinity, bx = 0, bz = 0;
    for (let k = 0; k < AVOID_HEADINGS; k++) {
      const a = (k * 2 * Math.PI) / AVOID_HEADINGS, fx = Math.sin(a), fz = Math.cos(a);
      if (w.t < st.barT && fx * st.barX + fz * st.barZ > 0.92) continue;
      const [run, plow] = titanRun(w, fx, fz, AVOID_LOOK_S * walk, walk);
      // time left after the plow slowdown → the distance actually covered in AVOID_LOOK_S
      const cover = Math.min(run, Math.max(0, AVOID_LOOK_S - plow) * walk);
      const ex = T.x + fx * cover, ez = T.z + fz * cover;
      // a runner keeps ROOM: an end point near a map edge (inside AVOID_ROOM_H × H, per axis) scores down, so it
      // leaves an edge road for an inward street and turns before a corner instead of running into it with the rig behind
      const Bd = w.city.bounds, C = AVOID_ROOM_H * T.height;
      const roomX = Math.min(ex - Bd.minX, Bd.maxX - ex), roomZ = Math.min(ez - Bd.minZ, Bd.maxZ - ez);
      let sc = Math.hypot(ex - b.x, ez - b.z) - d0 - 0.7 * (Math.max(0, C - roomX) + Math.max(0, C - roomZ));
      if (fx * st.hx + fz * st.hz > 0.98) sc += AVOID_KEEP_H * T.height;
      if (sc > best) { best = sc; bx = fx; bz = fz; }
    }
    if (best === -Infinity) { bx = T.x - b.x; bz = T.z - b.z; const m = Math.hypot(bx, bz) || 1; bx /= m; bz /= m; }
    st.hx = bx; st.hz = bz;
  }
  // a runner DASHES when the rig closes to within band max + 0.5 H (engagement) + AVOID_DASH_H — movement, not an attack
  const H = M.bosses.bossH(w, b), bandMax = (b.data.bandMaxH > 0 ? b.data.bandMaxH : 4) * H;
  const dNow = Math.hypot(T.x - b.x, T.z - b.z);
  const dash = T.dashCharges >= 1 && dNow < bandMax + (GATES.engageMarginH + AVOID_DASH_H) * H && w.t - st.dashT > 0.5 && (st.hx !== 0 || st.hz !== 0);
  if (dash) st.dashT = w.t;
  return { mx: st.hx, mz: st.hz, ability: false, abilityHeld: false, dash };
}
function runAvoider(): void {
  console.log('\n7. No soft-lock, avoider (flees along open streets, never attacks, god)');
  for (const gate of GATE_IDS) {
    const s = (GATE_IDS.indexOf(gate) + 1) as 1 | 2 | 3;
    const rows: string[] = [];
    let okP = 0, okRep = 0, okDue = 0, okEng = 0, okDie = 0, n = 0;
    const badL: string[] = [];
    for (const biome of BIOME_IDS) for (const titan of TITAN_IDS) for (const seed of (QUICK ? [1337] : [1337])) {
      const w = atGate(titan, biome, seed, s, true);
      w.cheats.noSpawns = false;
      const b = lockAndSpawn(w, s);
      if (!b) { badL.push(`${titan}/${biome}: not fielded`); continue; }
      n++;
      // fx2: "never attacks" from the fight's first tick — lockAndSpawn steps the titan with its full kit (NO input) while
      // the rig walks in, and a HEARTHBACK magma pool laid then keeps its spawn-time dps on the rig's entry path (it
      // engaged SWITCHBOARD-5 by rule b for 8.8 s at ~200 m, k-fx2 trace): drop titan-owned damage left from before
      for (const hz of w.hazards) if (hz.owner === 'titan') hz.dps = 0;
      for (const tg of w.telegraphs) if (tg.owner === 'titan') tg.dmg = 0;
      for (const pr of w.projectiles) if (pr.owner === 'titan') pr.dmg = 0;
      const G = w.gates;
      let p3T = NaN, reps = 0, overdue = 0, clockBad = 0, deadT = NaN;
      const st = newAvoid();
      for (let i = 0; i < 260 * SIM_HZ && b.alive; i++) {
        M.world.stepWorld(w, avoidInput(w, b, st));
        for (const e of w.events) if (e.type === 'gateReposition') reps++;
        if (TRACE7 === `${gate}/${titan}/${biome}` && G.liveFightS < 12) for (const e of w.events) if (/hit|Hit|dmg|damage/.test(e.type)) console.log(`    t ev ${f2(G.liveFightS)} ${JSON.stringify(e)}`);
        if (TRACE7 === `${gate}/${titan}/${biome}` && i % (SIM_HZ / 2) === 0) {
          const H = M.bosses.bossH(w, b), wk = M.bosses.titanWalk(w);
          console.log(`    t ${f1(G.liveFightS)} d ${f2(Math.hypot(w.titan.x - b.x, w.titan.z - b.z) / H)} H · titan ${f2(w.titan.speed / wk)}×walk hd (${f2(st.hx)},${f2(st.hz)}) · rig ${f2((b.data.speed ?? 0) / wk)}×walk ${b.attack ?? '-'} hunt ${b.data.hunting ?? '-'} · eng ${f1(G.engagedS)} p ${G.pressure} reps ${reps} ram ${f2(b.data.ramT ?? 0)} out ${f1(b.data.outrunS ?? 0)} pos (${f1(w.titan.x)},${f1(w.titan.z)})`);
        }
        if (G.pressure >= 3 && Number.isNaN(p3T)) p3T = G.liveFightS;
        if (G.pending > 0 && !M.gates.fightAlive(w) && w.t > G.dueT + TICK + 1e-9) overdue++;
        const clock = Math.max(G.engagedS, 0.5 * G.liveFightS);
        if (Math.abs(clock - 0.5 * G.liveFightS) > 1e-9) clockBad++;
      }
      if (!b.alive) deadT = G.liveFightS;
      if (p3T <= 75 + 1e-9) okP++; else badL.push(`${titan}/${biome}: pressure 3 at ${f1(p3T)} s of fight`);
      if (reps >= 1) okRep++; else badL.push(`${titan}/${biome}: no gateReposition`);
      if (overdue === 0) okDue++;
      if (G.engagedS === 0 && clockBad === 0) okEng++; else badL.push(`${titan}/${biome}: engagedS ${f2(G.engagedS)} (clock off on ${clockBad} ticks)`);
      if (deadT <= 210 + 1e-9) okDie++; else badL.push(`${titan}/${biome}: alive after ${f1(G.liveFightS)} s (hp ${(100 * b.hp / b.maxHp).toFixed(0)} %)`);
      rows.push(`${titan}/${biome} p3@${f1(p3T)} reps ${reps} engaged ${f1(G.engagedS)} dead@${f1(deadT)}`);
    }
    console.log(`  ${GATE_NAME[gate]}: ${rows.join(' · ')}`);
    check(okP === n, `7. ${GATE_NAME[gate]}: pressure reaches 3 by 75 s of fight time (${okP}/${n})`, badL.filter((x) => x.includes('pressure')).slice(0, 3).join(' | '));
    check(okRep === n, `7. ${GATE_NAME[gate]}: gateReposition fires at least once when out-run (${okRep}/${n})`, badL.filter((x) => x.includes('Reposition')).slice(0, 3).join(' | '));
    check(okDue === n, `7. ${GATE_NAME[gate]}: no tick with a pending lock overdue and no fight alive (${okDue}/${n})`);
    check(okEng === n, `7. ${GATE_NAME[gate]}: engagedS stays 0 and the fatigue clock is exactly 0.5 × liveFightS (${okEng}/${n})`, badL.filter((x) => x.includes('engaged')).slice(0, 3).join(' | '));
    check(okDie === n, `7. ${GATE_NAME[gate]}: dies to fatigue alone by 210 s of fight time (${okDie}/${n})`, badL.filter((x) => x.includes('alive')).slice(0, 3).join(' | '));
  }
}

// ─────────────────────────────── 7c. out-run on open road ───────────────────────────────
/**
 * fx2 (critic t_avoid: STENCIL-1 fired gateRam 33× in a row every 2 s at a titan that simply out-walked it, and CUTTING
 * YOU OFF only came at +125 s): every building flattened (collapsed — the whole city is open road), the titan flees with
 * the case-7 runner, never attacks, god. Within 60 s of fight time: 0 `gateRam` (a rig that moves freely is being
 * out-run, not stuck) and ≥ 1 `gateReposition` (the out-run cut-off fires for a fleeing titan). 4 titans × 3 cities.
 */
function runOutrun(): void {
  console.log('\n7c. Out-run on open road (every building flattened; the case-7 runner; never attacks, god; 60 s of fight)');
  for (const gate of GATE_IDS) {
    const s = (GATE_IDS.indexOf(gate) + 1) as 1 | 2 | 3;
    const rows: string[] = [], bad: string[] = [];
    let n = 0, okRam = 0, okRep = 0;
    for (const biome of BIOME_IDS) for (const titan of TITAN_IDS) {
      const w = atGate(titan, biome, 1337, s, true);
      for (const bd of w.city.buildings) { bd.collapsed = true; bd.alive = 0; }
      w.cheats.noSpawns = false;
      const b = lockAndSpawn(w, s);
      if (!b) { bad.push(`${titan}/${biome}: not fielded`); continue; }
      n++;
      for (const hz of w.hazards) if (hz.owner === 'titan') hz.dps = 0;
      for (const tg of w.telegraphs) if (tg.owner === 'titan') tg.dmg = 0;
      for (const pr of w.projectiles) if (pr.owner === 'titan') pr.dmg = 0;
      const G = w.gates, st = newAvoid();
      let rams = 0, reps = 0, firstRep = NaN;
      for (let i = 0; i < 90 * SIM_HZ && b.alive && G.liveFightS < 60; i++) {
        M.world.stepWorld(w, avoidInput(w, b, st));
        for (const e of w.events) {
          if (e.type === 'gateRam') rams++;
          if (e.type === 'gateReposition') { reps++; if (Number.isNaN(firstRep)) firstRep = G.liveFightS; }
        }
      }
      if (rams === 0) okRam++; else bad.push(`${titan}/${biome}: ${rams} gateRam`);
      if (reps >= 1) okRep++; else bad.push(`${titan}/${biome}: no gateReposition in ${f1(G.liveFightS)} s`);
      rows.push(`${titan}/${biome} ram ${rams} rep ${reps} (1st @${f1(firstRep)} s)`);
    }
    console.log(`  ${GATE_NAME[gate]}: ${rows.join(' · ')}`);
    check(okRam === n && n > 0, `7c. ${GATE_NAME[gate]}: 0 gateRam while out-run on open road (${okRam}/${n})`, bad.filter((x) => x.includes('Ram')).slice(0, 3).join(' | '));
    check(okRep === n && n > 0, `7c. ${GATE_NAME[gate]}: ≥ 1 gateReposition within 60 s of fight (${okRep}/${n})`, bad.filter((x) => x.includes('Reposition')).slice(0, 3).join(' | '));
  }
}

// ─────────────────────────────── 7b. soaked fighter ───────────────────────────────
function runSoaked(): void {
  console.log('\n7b. No soft-lock, soaked fighter (SWITCHBOARD-5, adds held at the 14 cap, gate bot, no god)');
  const P = { x: 0, z: 0 };
  const kinds = ['squad', 'android', 'android', 'android'] as const;
  for (const titan of ['voltkite', 'hearthback'] as TitanId[]) {
    for (const biome of BIOME_IDS) for (const seed of SEEDS) {
      const w = atGate(titan, biome, seed, 3, false);
      w.cheats.noSpawns = false;
      const b = lockAndSpawn(w, 3);
      if (!check(!!b && b.id === 'switchboard5', `7b. ${titan}/${biome}/${seed}: SWITCHBOARD-5 fielded`)) continue;
      const G = w.gates;
      let rose = 0, maxP = 0, k = 0, died = false;
      const t0 = w.t;
      let prevP = G.pressure;
      while (b!.alive && w.titan.alive && w.t - t0 < 120) {
        // hold its adds at 14
        let alive = 0;
        const ids = M.bosses.gateAddIds(w);
        for (const id of ids) for (const e of w.enemies) if (e.id === id) { if (e.alive) alive++; break; }
        for (let g = 0; alive < 14 && g < 14; g++) {
          const kind = kinds[k++ % kinds.length];
          M.enemies.ringPoint(w, kind, P);
          const e = M.enemies.spawnEnemy(w, kind, P.x, P.z);
          M.bosses.registerGateAdd(b!, e.id);
          alive++;
        }
        botStep(w);
        const H = M.bosses.bossH(w, b!);
        const inBand = Math.hypot(w.titan.x - b!.x, w.titan.z - b!.z) <= (bandMaxH(b!) + GATES.engageMarginH) * H;
        if (G.pressure > prevP && inBand) rose++;
        prevP = G.pressure; maxP = Math.max(maxP, G.pressure);
      }
      if (!w.titan.alive) died = true;
      const fight = w.t - t0;
      const killed = !b!.alive;
      console.log(`    ${titan}/${biome}/${seed}: ${killed ? `killed in ${f1(fight)} s` : died ? `titan died after ${f1(fight)} s (legal, reported)` : `ALIVE after ${f1(fight)} s`} · max pressure ${maxP} · rises in band ${rose}`);
      check(killed ? fight <= GATE2_V3.gateFightS[1] + 1e-9 : died, `7b. ${titan}/${biome}/${seed}: a kill within ${GATE2_V3.gateFightS[1]} s (or a titan death)`, `${f1(fight)} s`);
      check(rose === 0 && maxP < 3, `7b. ${titan}/${biome}/${seed}: pressure never rises within band max + 0.5 H and never reaches 3`, `rises ${rose}, max ${maxP}`);
    }
  }
}

// ─────────────────────────────── 8. time caps ───────────────────────────────
function runCaps(): void {
  console.log('\n8. Time caps (starved: every pickup deleted each tick; god; drafts left unpicked)');
  for (const biome of BIOME_IDS) for (const titan of TITAN_IDS) {
    const w = mkWorld(titan, biome, 1337);
    w.cheats.god = true;
    const G = w.gates, T = w.titan;
    const locks: string[] = [];
    let bad: string[] = [];
    let lastBreach = -1;
    while (!w.run.result && w.t < 760 && !(G.lockT >= 0 && G.pending === 4)) {
      for (const p of w.pickups) p.alive = false;
      const lv0 = T.level, pd0 = w.upgrades.pendingDrafts, top0 = G.topUpLevels, unl0 = G.unlocked;
      M.world.stepWorld(w, M.bot.botInput(w));
      for (const e of w.events) {
        if (e.type === 'gateLocked') {
          const s = e.slot;
          const wantT = Math.max(GATES.capS[s], lastBreach >= 0 ? lastBreach + GATES.chainGapS : -Infinity);
          locks.push(`${s}@${f1(w.t)}${e.capped ? ' CAP' : ''}`);
          if (!e.capped) bad.push(`slot ${s} locked uncapped @${f1(w.t)} (level ${T.level})`);
          if (w.t < wantT - 1e-9 || w.t > wantT + TICK + 1e-9) bad.push(`slot ${s} locked @${f2(w.t)} s, want max(capS, lastBreach + chainGap) = ${f2(wantT)}`);
        }
        if (e.type === 'gateDefeated' && !e.rematch) {
          const s = e.slot;
          const granted = G.topUpLevels - top0;
          const wantG = Math.max(0, RANK_LEVELS[s] - lv0);
          if (T.level < RANK_LEVELS[s]) bad.push(`slot ${s}: level ${T.level} < ${RANK_LEVELS[s]} after the capped kill`);
          if (granted !== wantG) bad.push(`slot ${s}: top-up ${granted} levels, want ${wantG}`);
          if (w.upgrades.pendingDrafts - pd0 !== T.level - lv0) bad.push(`slot ${s}: pendingDrafts +${w.upgrades.pendingDrafts - pd0} vs levels +${T.level - lv0}`);
          if (G.unlocked !== s || unl0 !== s - 1) bad.push(`slot ${s}: unlocked ${unl0} → ${G.unlocked}`);
          lastBreach = w.t;
        }
      }
    }
    console.log(`    ${biome}/${titan}: locks ${locks.join(' · ')} · top-up ${G.topUpLevels} LV · level ${T.level} · rank ${T.rank}`);
    const cityLock = G.pending === 4 || G.active === 4 || Number.isFinite(G.spawnT[4]);
    check(bad.length === 0 && cityLock, `8. ${biome}/${titan}: capped locks at max(capS, lastBreach + 20 s), top-ups exact, drafts owed; the city boss locks (${locks.length} locks)`, bad.slice(0, 4).join(' | ') || (cityLock ? '' : 'no city lock by 760 s'));
  }
}

// ─────────────────────────────── 9b. finale skip ───────────────────────────────
function runFinaleSkip(): void {
  console.log('\n9. Finale skip (endFinale after finaleSkipS)');
  const w = atGate('molo', 'grideast', 1337, 4, true);
  const b = lockAndSpawn(w, 4);
  if (!check(!!b && b.role === 'main', '9. the city boss fielded at Size IV (slot 4 lock)')) return;
  b!.introT = 0;
  M.bosses.bossUltHit(w, 1, 0);
  M.world.stepWorld(w, NO);
  const kT = w.gates.mainKillT;
  check(w.gates.finaleT > 0 && w.titan.rank === 4, `9. the finale runs after the kill (finaleT ${f2(w.gates.finaleT)}, rank ${w.titan.rank})`);
  for (let i = 0; i < GATES.finaleSkipS * SIM_HZ; i++) M.world.stepWorld(w, NO);
  M.gates.endFinale(w);
  M.world.stepWorld(w, NO);
  check(w.run.result === 'clear' && w.run.endT === kT, `9. skip: runEnd clear on the next tick with endT = the kill (${f2(w.run.endT)} vs ${f2(kT)})`);
}

// ─────────────────────────────── 11. interactions ───────────────────────────────
function runInteractions(): void {
  console.log('\n11. Interactions');
  const w = atGate('molo', 'grideast', 1337, 1, true);
  const b = lockAndSpawn(w, 1);
  if (!check(!!b, '11. STENCIL-1 fielded')) return;
  b!.introT = 0;
  const T = w.titan;
  // keep the titan away so its own attacks do not land
  const far = () => { T.x = b!.x + 12 * M.bosses.bossH(w, b!); T.z = b!.z; };
  // UPROAR: fire a real one
  far();
  w.ult.charge = ULT.max; w.ult.ready = true; w.ult.lockT = 0;
  const hp0 = b!.hp, m0 = b!.meter, u0 = b!.data.by_ult ?? 0;
  let fired = false;
  for (let i = 0; i < 20 * SIM_HZ; i++) {
    const inp: TitanInput = { ...NO, ultimate: !fired };
    M.world.stepWorld(w, inp);
    for (const e of w.events) if (e.type === 'ultFire') fired = true;
    if (fired && w.ult.phase === 'idle') break;
    far();
  }
  const uHp = (b!.data.by_ult ?? 0) - u0;
  check(fired && Math.abs(uHp - GATES.dpsCapFrac * b!.maxHp) < 1e-6 * b!.maxHp, `UPROAR removes exactly 6 % (${f2((100 * uHp) / b!.maxHp)} %)`, `fired ${fired}`);
  const dMeter = b!.meter - m0;
  check(Math.abs(dMeter - ULT.bossMeter) < 1e-6 || b!.staggerT > 0, `UPROAR adds exactly +${ULT.bossMeter} meter (${dMeter.toFixed(4)})`);
  void hp0;
  // DEMOLITION NOTICE
  const d0 = b!.data.by_ult ?? 0;
  M.powerups.spawnPowerup(w, 'demolition', T.x, T.z, true);
  for (let i = 0; i < 10; i++) { M.world.stepWorld(w, NO); far(); }
  const dHp = (b!.data.by_ult ?? 0) - d0;
  check(Math.abs(dHp - 0.02 * b!.maxHp) < 1e-6 * b!.maxHp, `DEMOLITION NOTICE removes 2 % (${f2((100 * dHp) / b!.maxHp)} %)`);
  // RED LIGHT: adds frozen, the rig not
  {
    const P = { x: 0, z: 0 };
    M.enemies.ringPoint(w, 'android', P);
    const e = M.enemies.spawnEnemy(w, 'android', P.x, P.z);
    M.bosses.registerGateAdd(b!, e.id);
    for (let i = 0; i < 5; i++) M.world.stepWorld(w, NO);
    T.x = b!.x + 20 * M.bosses.bossH(w, b!); T.z = b!.z;   // past its band: it must hunt
    w.map.redLightT = 3;
    const ex = e.x, ez = e.z, bx = b!.x, bz = b!.z, bt = b!.data.t;
    for (let i = 0; i < 2 * SIM_HZ; i++) M.world.stepWorld(w, NO);
    const eMoved = Math.hypot(e.x - ex, e.z - ez), bMoved = Math.hypot(b!.x - bx, b!.z - bz);
    check(e.alive && eMoved < 1e-6, `RED LIGHT freezes the gatekeeper's adds (moved ${f2(eMoved)} m)`);
    check(bMoved > 0.5 * M.bosses.bossH(w, b!) && b!.data.t > bt, `RED LIGHT does not freeze the gatekeeper (moved ${f2(bMoved)} m in 2 s)`);
    w.map.redLightT = 0;
  }
  // per-second cap (tumbling)
  {
    const opts = { src: 'titan', kind: 'melee' } as unknown as Parameters<typeof M.bosses.damageBoss>[3];
    for (let i = 0; i < 2 * SIM_HZ; i++) M.world.stepWorld(w, NO);
    b!.staggerT = 0;
    const h0 = b!.hp;
    M.bosses.damageBoss(w, 0, 1e9, opts);
    const one = h0 - b!.hp;
    check(Math.abs(one - GATES.dpsCapFrac * b!.maxHp) < 1e-6 * b!.maxHp, `a 50 % cheat burst in one tick lands as 6 % (${f2((100 * one) / b!.maxHp)} %)`);
    for (let i = 0; i < 2 * SIM_HZ; i++) M.world.stepWorld(w, NO);
    // a tiny hit opens a window; bursts on its last tick and on the first tick of the next
    b!.staggerT = 0;
    M.bosses.damageBoss(w, 0, 1e-6, opts);
    const wStart = w.gates.dpsWinT;
    while (w.t + w.dt < wStart + 1 - 1e-9) M.world.stepWorld(w, NO);
    const h1 = b!.hp;
    b!.staggerT = 0; M.bosses.damageBoss(w, 0, 1e9, opts);
    // the next tick the sim itself counts as the new window (damageBoss: a hit at w.t >= dpsWinT + 1; the
    // accumulated w.t can sit 1 ulp short of the boundary, which then takes one more tick)
    let extra = 0;
    do { M.world.stepWorld(w, NO); extra++; } while (w.t < wStart + 1 && extra < 3);
    if (extra > 1) console.log(`  note: w.t reached dpsWinT + 1 only ${extra} ticks after the window's last tick (float accumulation in w.t; damageBoss compares without an epsilon)`);
    b!.staggerT = 0; M.bosses.damageBoss(w, 0, 1e9, opts);
    const two = h1 - b!.hp;
    check(Math.abs(two - 2 * GATES.dpsCapFrac * b!.maxHp) < 0.002 * b!.maxHp, `two bursts across a window boundary land as 12 % (${f2((100 * two) / b!.maxHp)} %)`);
  }
  // an open weak point takes a whole AoE hit
  {
    const drum = b!.parts.findIndex((p) => p.name === 'drum');
    const body = 0;
    if (check(drum >= 0, 'STENCIL-1 has a drum part')) {
      b!.data.weakMask = 1 << drum;
      const pd = b!.parts[drum], pb = b!.parts[body];
      const cx = (pd.x + pb.x) / 2, cz = (pd.z + pb.z) / 2;
      const r = Math.hypot(pd.x - pb.x, pd.z - pb.z) / 2 + Math.max(pd.r, pb.r) + 0.2 * M.bosses.bossH(w, b!);
      let overl = 0; for (const p of b!.parts) if (Math.hypot(p.x - cx, p.z - cz) <= r + p.r) overl++;
      for (let i = 0; i < 2 * SIM_HZ; i++) M.world.stepWorld(w, NO);
      b!.data.weakMask = 1 << drum; b!.staggerT = 0;
      const n0 = w.events.length;
      M.damage.damageArea(w, { k: 'circle', x: cx, z: cz, r } as Shape, 5, { src: 'titan', kind: 'melee' } as unknown as Parameters<typeof M.damage.damageArea>[3]);
      const hits = w.events.slice(n0).filter((e) => e.type === 'bossHit') as { part: string; dmg: number }[];
      const onDrum = hits.filter((h) => h.part === 'drum').reduce((a, h) => a + h.dmg, 0), other = hits.filter((h) => h.part !== 'drum').reduce((a, h) => a + h.dmg, 0);
      check(overl >= 3 && onDrum > 0 && other === 0, `an AoE over the open drum + ${overl - 1} other parts: the drum takes it all (drum ${f2(onDrum)}, others ${f2(other)})`);
    }
  }
  // findTarget: open weak point in reach beats 5 nearer enemies; closed → the nearest enemy
  {
    const drum = b!.parts.findIndex((p) => p.name === 'drum');
    const pd = b!.parts[drum];
    const H = M.bosses.bossH(w, b!);
    let ux = pd.x - b!.x, uz = pd.z - b!.z; const um = Math.hypot(ux, uz) || 1; ux /= um; uz /= um;
    T.x = pd.x + ux * (pd.r + 0.3 * H); T.z = pd.z + uz * (pd.r + 0.3 * H);
    for (let i = 0; i < 5; i++) { const e = M.enemies.spawnEnemy(w, 'android', T.x + (i - 2) * 0.1 * H, T.z + ux * 0.15 * H); e.hp = e.maxHp = 1e9; }
    M.world.stepWorld(w, NO);
    T.x = pd.x + ux * (pd.r + 0.3 * H); T.z = pd.z + uz * (pd.r + 0.3 * H);
    const range = 0.9 * H;
    b!.data.weakMask = 1 << drum;
    const tOpen = M.targeting.findTarget(w, T.x, T.z, range, true);
    b!.data.weakMask = 0;
    const tShut = M.targeting.findTarget(w, T.x, T.z, range, true);
    check(!!tOpen && tOpen.kind === 'boss' && tOpen.part === drum, `findTarget(…, true) returns the open weak point over 5 nearer enemies (${tOpen ? tOpen.kind : 'null'})`);
    check(!!tShut && tShut.kind === 'enemy', `with it closed, the nearest enemy (${tShut ? tShut.kind : 'null'})`);
  }
}

// ─────────────────────────────── 12. EXTENDED COVERAGE ───────────────────────────────
function runRematch(): void {
  console.log('\n12. EXTENDED COVERAGE rematches (gate bot, god)');
  for (const gate of GATE_IDS) {
    const w = atRematch('molo', 'grideast', 1337, gate, true);
    if (!check(!!w, `12. ${GATE_NAME[gate]} rematch fielded by the rotation`)) continue;
    const b = w!.boss!;
    const G = w!.gates, E = w!.endless!;
    const ix = GATE_IDS.indexOf(gate);
    check(b.role === 'gate' && b.slot === 0, `12. ${GATE_NAME[gate]}: role gate, slot 0 (${b.role}, ${b.slot})`);
    check(Math.abs(b.maxHp - M.gates.gateHpFor(gate, 4, G.rematchN[ix])) < 1e-6 && b.maxHp >= 100000 - 1e-6, `12. HP ${b.maxHp.toFixed(0)} = GATE_HP_AT_RANK[4] × GATE_HP_MUL × (1 + 0.5 × ${G.rematchN[ix]})`);
    check(M.bosses.bossH(w!, b) >= 60 - 1e-6, `12. bossH ${f1(M.bosses.bossH(w!, b))} ≥ 60 m`);
    check(M.bosses.gateCrushTier(b) === 4, `12. crush tier ${M.bosses.gateCrushTier(b)} = 4`);
    // director budget × BOSS_SPAWN_MUL: budgetRate with the rematch alive vs momentarily without it
    const withB = M.director.budgetRate(w!);
    w!.boss = null; const without = M.director.budgetRate(w!); w!.boss = b;
    check(Math.abs(withB / without - 0.5) < 1e-9, `12. director budget × ${f2(withB / without)} = BOSS_SPAWN_MUL 0.5`);
    // damage multiplier with 2 rematches of this gatekeeper won
    const n0 = G.rematchN[ix];
    G.rematchN[ix] = 2;
    check(Math.abs(M.endless.endlessBossDmgMul(w!) - (1 + ENDLESS.rematchDmgStep * 2)) < 1e-12, `12. endlessBossDmgMul = 1 + 0.1 × rematchN[${gate}] (${M.endless.endlessBossDmgMul(w!)})`);
    G.rematchN[ix] = n0;
    // movement in the first 10 s after the intro: the titan walks straight away (the avoider), so the rig must hunt;
    // a rematch pinned by the city (a crush tier below 4) would not get > 5 H
    w!.cheats.noSpawns = false;
    const ast = newAvoid();
    while (b.introT > 0 && b.alive) M.world.stepWorld(w!, avoidInput(w!, b, ast));
    const H = M.bosses.bossH(w!, b);
    let x0 = b.x, z0 = b.z, segD = 0, walked = 0;
    const reps: string[] = [];
    // fx2: a CUTTING YOU OFF re-entry is a teleport, not movement: the walk is split at each one and only the
    // distance WALKED counts (each segment's max displacement from its own start, summed)
    for (let i = 0; i < 10 * SIM_HZ && b.alive; i++) {
      M.world.stepWorld(w!, avoidInput(w!, b, ast));
      if (w!.events.some((e) => e.type === 'gateReposition')) { walked += segD; segD = 0; x0 = b.x; z0 = b.z; reps.push(`+${f1(i / SIM_HZ)} s`); continue; }
      segD = Math.max(segD, Math.hypot(b.x - x0, b.z - z0));
    }
    walked += segD;
    check(walked > 5 * H, `12. the rematch rig walks ${f2(walked / H)} H (> 5 H) in its first 10 s after the intro (titan fleeing${reps.length ? `; split at its cut-off${reps.length > 1 ? 's' : ''} ${reps.join(', ')}` : ''})`);
    // kill it: no breach, rematchN++, E.rematches untouched
    const rk0 = w!.titan.rank, er0 = E.rematches, rn0 = G.rematchN[ix], rg0 = G.rematchGates;
    let rankUp = false;
    b.introT = 0; M.bosses.bossUltHit(w!, 1, 0);
    for (let i = 0; i < 3; i++) { M.world.stepWorld(w!, NO); for (const e of w!.events) if (e.type === 'rankUp') rankUp = true; }
    check(!b.alive && !rankUp && w!.titan.rank === rk0, `12. ${GATE_NAME[gate]} rematch kill: no breach (rank ${w!.titan.rank})`);
    check(E.rematches === er0 && G.rematchN[ix] === rn0 + 1 && G.rematchGates === rg0 + 1, `12. the death: E.rematches ${er0} → ${E.rematches} (unchanged), rematchN[${gate}] ${rn0} → ${G.rematchN[ix]}, rematchGates ${rg0} → ${G.rematchGates}`);
  }
}

// ─────────────────────────────── 15. stuck rule ───────────────────────────────
function runStuck(): void {
  console.log('\n15. Stuck rule (titan standing still behind the densest block; god; spawns off)');
  let worstGap = 0, ramTotal = 0, bandLate: string[] = [], gapBad: string[] = [], n = 0;
  const rows: string[] = [];
  const PIN = { x: 0, z: 0, bumpTier: -1 };
  for (const gate of GATE_IDS) {
    const s = (GATE_IDS.indexOf(gate) + 1) as 1 | 2 | 3;
    const tier = GATES.crushTier[gate];
    for (const biome of BIOME_IDS) for (const titan of TITAN_IDS) for (const seed of SEEDS) {
      const w = atGate(titan, biome, seed, s, true);
      const T = w.titan;
      // densest 3 × 3-block window (72 m pitch cells) of buildings above the crush tier
      const cell = 72, Bd = w.city.bounds;
      const cnt = new Map<string, number>();
      const bs = w.city.buildings.filter((q) => !q.collapsed && q.tier > tier);
      for (const q of bs) { const k = `${Math.floor((q.x - Bd.minX) / cell)},${Math.floor((q.z - Bd.minZ) / cell)}`; cnt.set(k, (cnt.get(k) ?? 0) + 1); }
      let best = -1, bi = 0, bj = 0;
      for (const k of cnt.keys()) {
        const [i, j] = k.split(',').map(Number);
        let c = 0; for (let a = -1; a <= 1; a++) for (let d = -1; d <= 1; d++) c += cnt.get(`${i + a},${j + d}`) ?? 0;
        if (c > best) { best = c; bi = i; bj = j; }
      }
      const cx = Bd.minX + (bi + 0.5) * cell, cz = Bd.minZ + (bj + 0.5) * cell;
      let bld = bs[0]; let bd = Infinity;
      for (const q of bs) { const d = Math.hypot(q.x - cx, q.z - cz); if (d < bd) { bd = d; bld = q; } }
      if (!bld) continue;
      // the titan just outside the building, facing through it (the gatekeeper enters on the heading side)
      let placed = false;
      for (let a = 0; a < 8 && !placed; a++) {
        const ang = (a * Math.PI) / 4;
        const off = Math.max(bld.w, bld.d) / 2 + T.radius + 1;
        const x = bld.x - Math.sin(ang) * off, z = bld.z - Math.cos(ang) * off;
        if (x < Bd.minX + 5 || x > Bd.maxX - 5 || z < Bd.minZ + 5 || z > Bd.maxZ - 5) continue;
        if (M.citysim.resolveCircleVsCity(w.city, x, z, T.radius, T.rank as 0 | 1 | 2 | 3 | 4, PIN)) continue;
        T.x = x; T.z = z; T.px = x; T.pz = z; T.heading = ang; T.vx = 0; T.vz = 0;
        placed = true;
      }
      if (!placed) continue;
      const b = lockAndSpawn(w, s);
      if (!b) continue;
      n++;
      const H = M.bosses.bossH(w, b);
      let rams = 0, inBandT = NaN, dRef = Infinity, tRef = w.t, hunting = false, maxGap = 0;
      const t0 = w.t;
      for (let i = 0; i < 25 * SIM_HZ; i++) {
        M.world.stepWorld(w, NO);
        for (const e of w.events) if (e.type === 'gateRam') rams++;
        const d = Math.hypot(T.x - b.x, T.z - b.z);
        const hunt = b.introT <= 0 && d > bandMaxH(b) * H;
        if (hunt && !hunting) { dRef = d; tRef = w.t; }
        hunting = hunt;
        if (hunt) {
          if (d <= dRef - GATES.stuck.progressH * H) { dRef = d; tRef = w.t; }
          maxGap = Math.max(maxGap, w.t - tRef);
        } else if (b.introT <= 0 && Number.isNaN(inBandT)) inBandT = w.t - t0;
        if (!Number.isNaN(inBandT) && i > 5 * SIM_HZ && !hunt) break;
      }
      ramTotal += rams; worstGap = Math.max(worstGap, maxGap);
      if (maxGap > 6 + 1e-9) gapBad.push(`${gate}/${biome}/${titan}/${seed}: ${f1(maxGap)} s without 0.5 H of progress`);
      if (!(inBandT <= 20 + 1e-9)) bandLate.push(`${gate}/${biome}/${titan}/${seed}: band ${Number.isNaN(inBandT) ? 'never' : f1(inBandT) + ' s'}`);
      if (seed === SEEDS[0] && titan === 'molo') rows.push(`${gate}/${biome}: band @${f1(inBandT)} s · worst no-progress ${f1(maxGap)} s · rams ${rams}`);
    }
  }
  for (const r of rows) console.log('    ' + r);
  check(n > 0 && gapBad.length === 0, `15. no hunting interval > 6 s without 0.5 H of progress over ${n} runs (worst ${f1(worstGap)} s)`, gapBad.slice(0, 4).join(' | '));
  check(n > 0 && bandLate.length === 0, `15. every gatekeeper in its band within 20 s (${n} runs)`, bandLate.slice(0, 4).join(' | '));
  console.log(`  RAMMING THROUGH over the ${n} runs: ${ramTotal}`);
}

// ─────────────────────────────── 16. tick-end breach ───────────────────────────────
function runTickEnd(): void {
  console.log('\n16. Tick-end breach (VOLT-KITE fork chain; the level already at the next gate)');
  let done = 0;
  for (const seed of [1337, 7, 99, 5, 11]) {
    const w = atGate('voltkite', 'grideast', seed, 1, true);
    w.cheats.noSpawns = false;
    const b = lockAndSpawn(w, 1);
    if (!b) continue;
    const T = w.titan;
    // the level is already past gate 2 (no drafts owed by this cheat) and the gatekeeper nearly dead
    T.level = RANK_LEVELS[2] + 1; T.xp = 0; T.xpToNext = 1e9;
    for (let i = 0; i < 20 * SIM_HZ && b.alive; i++) {
      if (b.introT <= 0 && b.hp > 0.001 * b.maxHp) b.hp = 0.001 * b.maxHp;
      drafts(w);
      M.world.stepWorld(w, M.bot.botInput(w));
      const ev = w.events;
      const kill = ev.findIndex((e) => e.type === 'gateDefeated');
      if (kill < 0) continue;
      const rk = ev.findIndex((e) => e.type === 'rankUp' && e.rank === 1);
      let lastHit = -1;
      for (let k = 0; k < ev.length; k++) { const e = ev[k]; if (e.type === 'enemyHit' || e.type === 'bossHit') lastHit = k; }
      const lock = ev.some((e) => e.type === 'gateLocked' && e.slot === 2);
      check(rk > kill && rk > lastHit, `16. seed ${seed}: rankUp 1 at event ${rk}, after the kill (${kill}) and after every hit event of the tick (last ${lastHit})`);
      check(lock, `16. seed ${seed}: LV ${T.level} ≥ ${RANK_LEVELS[2]} → gateLocked slot 2 on the kill tick`);
      done++;
      break;
    }
    if (done >= 2) break;
  }
  check(done > 0, `16. a kill tick observed (${done})`);
}

// ─────────────────────────────── main ───────────────────────────────
async function main(): Promise<number> {
  const err = await load();
  if (err) { console.log('probe_gatekeepers: FAIL — could not load the sim:'); for (const l of err.split(/\r?\n/).slice(0, 8)) console.log('  ' + l); return 2; }
  console.log(`BLOCKTOOTH probe_gatekeepers — ${CALIBRATE ? 'CALIBRATE (case 4)' : ONLY ? 'cases ' + [...ONLY].join(',') : 'every case'}${QUICK ? ' (quick)' : ''}`);
  const wall0 = performance.now();
  const guard = (id: string, fn: () => void) => {
    if (!want(id)) return;
    try { fn(); } catch (e) { check(false, `case ${id} threw: ${String((e as Error)?.stack ?? e).split('\n').slice(0, 4).join(' | ')}`); }
  };
  if (['1', '2', '3', '4', '9', '10', '13', '14'].some(want)) {
    try { runMatrix(); } catch (e) { check(false, `the matrix threw: ${String((e as Error)?.stack ?? e).split(NL).slice(0, 4).join(' | ')}`); }
  }
  guard('9', runFinaleSkip);
  guard('6b', runVolleyGeometry);
  if (want('5') || want('6') || want('6b')) {
    try { runDuels(); } catch (e) { check(false, `the duels threw: ${String((e as Error)?.stack ?? e).split(NL).slice(0, 4).join(' | ')}`); }
  }
  guard('6c', runWalkers);
  guard('7', runAvoider);
  guard('7c', runOutrun);
  guard('7b', runSoaked);
  guard('8', runCaps);
  guard('11', runInteractions);
  guard('12', runRematch);
  guard('15', runStuck);
  guard('16', runTickEnd);
  console.log(`\n${nChecks} checks · ${fails.length} failed · ${((performance.now() - wall0) / 1000).toFixed(0)} s wall`);
  if (fails.length) {
    console.log('probe_gatekeepers: FAIL');
    for (const f of fails.slice(0, 60)) console.log('  - ' + f);
    return 1;
  }
  console.log('probe_gatekeepers: PASS');
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
