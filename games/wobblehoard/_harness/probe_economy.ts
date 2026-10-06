// Economy probe: the pure logic (meter, drops, merge) against DESIGN 5.4 / 5.6 / 5.1, with real numbers and stated tolerances.
// Plain node:  node _harness/probe_economy.ts      (exit 1 on any failure; nothing is loosened to pass)
//
// Statistical checks use Z = 5 standard errors: with seeded (hence fixed) streams a pass is reproducible, and a real bug that moves a probability by
// even a few percent relative fails by a wide margin at the sample sizes below.
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mulberry32 } from '../src/core/rng.ts';
import {
  createMeter, addInteraction, previewInteraction, sanitizeMeter, capsuleThreshold, dailyRateFor, dailyStatus, meterFill, PAY, POKE_MIN_GAP_MS, FRESHNESS_FLOOR,
  FRESHNESS_FLOORS, FRESHNESS_TAU_SECONDS,
  VALVE_SP_PER_MINUTE, CAPSULE_RAMP, CAPSULE_COST, DAILY_FULL_RATE_CAPSULES, DAILY_REDUCED_RATE, DAILY_HARD_STOP_CAPSULES, DAY_MS, MEDLEY_COOLDOWN_MS, MAX_T_MS,
} from '../src/core/meter.ts';
import type { MeterState, TouchKind, Interaction } from '../src/core/meter.ts';
import {
  rollCapsule, capsuleGenome, restockOffer, restockDisplayOrder, isValidRestockPick, dailyTasks, claimTask, createTaskState, weekKeyOf, daySeed, makeRng, draw,
  RESTOCK_POOL, TASKS_MAX_PER_WEEK, TASKS_OFFERED_PER_DAY, TASK_DEFS, RESTOCK_OFFER_COUNT,
} from '../src/core/drops.ts';
import {
  MERGE_COST, MERGE_RULES, MERGE_TIER_UP, MERGE_PITY_AFTER, previewMerge, rollMerge, createMergePity, lineageGenome, mergeOddsCore, mergeDrawCore, keepsSpeciesColour,
  LINEAGE_MAX_SHIFT, LINEAGE_JITTER, LINEAGE_MAX_DISTANCE,
} from '../src/core/merge.ts';
import type { MergeState, MergeRollOk, MergePreviewOk, MergeRoll, MergeInput, MergeRules, MergePreview } from '../src/core/merge.ts';
import { TIERS, TIER_ODDS, TIER_COUNT, TOP_TIER_INDEX, TIER_SPECIES_COUNTS, tierIndex } from '../src/core/rarity.ts';
import { CATALOG, SPECIES_BY_TIER, PATTERN_SPECKLE_FLOOR, speciesBaseGenome, speciesTemplateGenome, getSpecies } from '../src/data/catalog.ts';
import type { SpeciesId } from '../src/data/catalog.ts';
import { encodeGenome, decodeGenome, genomeEquals } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { bodyLab, labDistance } from '../src/data/palette.ts';
import { BEHAV, BEHAV_EXTRA, measureStyle, playStream, buildCatalog, bitsetWords, bitsetHas, setMasks, swapCountCore } from './sim_economy.ts';

let bad = 0;
const check = (name: string, ok: boolean, extra = ''): void => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? '  ' + extra : ''}`); };
const header = (t: string): void => console.log(`\n== ${t} ==`);
const Z = 5;
const f1 = (x: number): string => x.toFixed(1);
const f2 = (x: number): string => x.toFixed(2);
const pct = (x: number, d = 2): string => (100 * x).toFixed(d) + '%';
const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
/** Observed proportion within Z standard errors of p? */
const zOk = (obs: number, p: number, n: number, z = Z): boolean => Math.abs(obs - p) <= z * Math.sqrt(Math.max(p * (1 - p), 1e-12) / n) + 1e-12;
const se = (p: number, n: number): number => Math.sqrt(p * (1 - p) / n);

/* ═══════════════════════════════════ 1. the meter: pay table, thresholds ═══════════════════════════════════ */
header('1. Squish meter: pay table, freshness, medley, thresholds (DESIGN 5.4)');
const T0 = 1_000_000;
const one = (kind: TouchKind, amount: number, state: MeterState = createMeter(), t = T0): ReturnType<typeof addInteraction> => addInteraction(state, { kind, amount, tMs: t });
const near = (a: number, b: number, e = 1e-9): boolean => Math.abs(a - b) <= e;
check('a first poke pays 0.8 SP', near(one('poke', 0).spGained, 0.8));
check('squeeze held 1 s pays 0.7 + 0.45 = 1.15 SP', near(one('squeeze', 1).spGained, 1.15));
check('squeeze hold is counted up to 3 s (held 2.5 s pays 0.7 + 1.125 + soft pop 0.5 = 2.325; held 9 s pays 0.7 + 1.35 + 0.5 = 2.55)', near(one('squeeze', 2.5).spGained, 2.325) && near(one('squeeze', 9).spGained, 2.55));
check('soft pop: held 1.8 s earns +0.5 SP, held 1.79 s does not', near(one('squeeze', 1.8).spGained - one('squeeze', 1.79).spGained, 0.45 * 0.01 + 0.5));
check('a squeeze held under 0.4 s is paid as a poke', near(one('squeeze', 0.2).spGained, 0.8) && one('squeeze', 0.2).detail.paidAs === 'poke');
// RE-SPECIFIED 2026-10-06 (owner, FUN.md 2.2: "dragging out to stretch and holding it should slowly give XP"): a stretched pull no longer
// pays a flat 1.8 SP; it pays 1.0 + 0.55 per second held (Interaction.heldS = the snap's heldFor), hold counted up to 3 s.
const pullH = (level: number, heldS: unknown): number => addInteraction(createMeter(), { kind: 'pull', amount: level, heldS: heldS as number, tMs: T0 }).spGained;
check('stretch-and-hold pays per second held: a stretched pull (level >= 0.35) pays 1.0 + 0.55 x hold (held 0 / 1 / 2 s: 1.0 / 1.55 / 2.1 SP)',
  near(pullH(0.35, 0), 1.0) && near(pullH(1, 1), 1.55) && near(pullH(0.6, 2), 2.1) && PAY.pullBase === 1.0 && PAY.pullPerSecond === 0.55);
check('the pull hold is counted up to 3 s, like a squeeze (held 3 s and 9 s both pay 2.65 SP)', near(pullH(0.8, 3), 2.65) && near(pullH(0.8, 9), 2.65) && PAY.pullHoldCapSeconds === PAY.squeezeHoldCapSeconds);
check('a pull that never stretched (level under 0.35) pays the flat 0.5 SP whatever the hold (0 s, 3 s, 10 s)', [0, 3, 10].every((h) => near(pullH(0.34, h), 0.5)) && near(pullH(0.1, 2), 0.5));
check('a pull without a hold, or with a NaN / negative / infinite one, pays the base only (never more)', near(addInteraction(createMeter(), { kind: 'pull', amount: 1, tMs: T0 }).spGained, 1.0) && [NaN, -2, Infinity, -Infinity, 'x', null].every((h) => near(pullH(1, h), 1.0)) && near(pullH(1, 1e300), 2.65));
check('heldS is a pull field only: a poke and a squeeze ignore it (the squeeze hold is its amount)', near(addInteraction(createMeter(), { kind: 'poke', amount: 0, heldS: 3, tMs: T0 }).spGained, 0.8) && near(addInteraction(createMeter(), { kind: 'squeeze', amount: 1, heldS: 3, tMs: T0 }).spGained, 1.15));
// freshness
{
  const s1 = one('poke', 0).state;
  const at = (dtMs: number): number => addInteraction(s1, { kind: 'poke', amount: 0, tMs: T0 + dtMs }).spGained;
  check('freshness: a second poke 0.9 s later pays in full', near(at(900), 0.8));
  // RE-SPECIFIED 2026-10-06 (owner, FUN.md 2.1: "a quick poke should give a little bit of XP"): the poke freshness is tau 0.75 s with a
  // floor of 0.25 (was tau 0.9 s, floor 0.03, which paid 0.07 to 0.11 SP a tap at 3 to 4 taps a second).
  check('poke freshness tau 0.75 s: 0.75 s later pays in full, 0.45 s later x(0.6)^2 = 0.288 SP, 0.5 s later (2 taps a second) x(2/3)^2 = 0.356 SP', near(at(750), 0.8) && near(at(450), 0.8 * 0.36) && near(at(500), 0.8 * 4 / 9) && FRESHNESS_TAU_SECONDS[0] === 0.75);
  check('ordinary tapping always pays a little: a poke 0.25 to 0.375 s after the last (3 to 4 taps a second) pays the floor, a quarter of a fresh poke (0.2 SP)', [250, 300, 333, 375].every((ms) => near(at(ms), 0.2)) && FRESHNESS_FLOORS[0] === 0.25);
  check('every paid poke (0.25 s or more after the last) pays at least 0.2 SP; between 2 and 4 taps a second 0.2 to 0.36 SP', [250, 260, 280, 400, 450, 499].every((ms) => at(ms) >= 0.2 - 1e-12 && at(ms) <= 0.8 * 4 / 9 + 1e-12) && at(249) === 0);
  check(`double-tap gate: a poke under ${POKE_MIN_GAP_MS} ms after the last poke pays nothing`, at(100) === 0 && addInteraction(s1, { kind: 'poke', amount: 0, tMs: T0 + 100 }).detail.doubleTap);
  check('freshness floors: poke 0.25, squeeze and pull 0.03 (FRESHNESS_FLOOR is the squeeze and pull floor)', FRESHNESS_FLOORS.join() === '0.25,0.03,0.03' && near(FRESHNESS_FLOOR, 0.03));
  {
    const sq0 = one('squeeze', 1).state, pl0 = addInteraction(createMeter(), { kind: 'pull', amount: 1, heldS: 1, tMs: T0 }).state;
    check('squeezes and pulls keep the 0.03 floor: one 0.3 s after the last of its kind pays 3% (mashing them stays worthless)',
      near(addInteraction(sq0, { kind: 'squeeze', amount: 1, tMs: T0 + 300 }).spGained, 1.15 * 0.03) && near(addInteraction(pl0, { kind: 'pull', amount: 1, heldS: 1, tMs: T0 + 300 }).spGained, 1.55 * 0.03));
  }
  const sq = one('squeeze', 1).state;
  check('freshness tau is per kind: a squeeze 1.2 s after a squeeze pays x(0.5)^2 of 1.15', near(addInteraction(sq, { kind: 'squeeze', amount: 1, tMs: T0 + 1200 }).spGained, 1.15 * 0.25));
  check('freshness is per kind: a poke right after a squeeze is not penalised', near(addInteraction(sq, { kind: 'poke', amount: 0, tMs: T0 + 50 }).spGained, 0.8));
}
// medley
{
  let s = createMeter(), t = T0, got: number[] = [];
  const seq: Array<[TouchKind, number, number]> = [['poke', 0, 0], ['squeeze', 1, 3000], ['pull', 1, 3000]];
  for (const [k, a, dt] of seq) { t += dt; const r = addInteraction(s, { kind: k, amount: a, tMs: t }); s = r.state; got.push(r.detail.medley); }
  check('medley: poke, squeeze, pull within 12 s pays +2 SP on the third touch', got.join() === '0,0,2');
  // immediately again within the cooldown: no bonus
  let more = 0;
  for (const [k, a, dt] of [['poke', 0, 3000], ['squeeze', 1, 3000], ['pull', 1, 3000]] as Array<[TouchKind, number, number]>) { t += dt; const r = addInteraction(s, { kind: k, amount: a, tMs: t }); s = r.state; more += r.detail.medley; }
  check('medley: a 25 s cooldown follows (no second bonus 3-9 s later)', more === 0);
  t += MEDLEY_COOLDOWN_MS;
  let again = 0;
  for (const [k, a, dt] of [['poke', 0, 3000], ['squeeze', 1, 3000], ['pull', 1, 3000]] as Array<[TouchKind, number, number]>) { t += dt; const r = addInteraction(s, { kind: k, amount: a, tMs: t }); s = r.state; again += r.detail.medley; }
  check('medley: pays again once the cooldown is over', again === 2);
  let s2 = createMeter(), t2 = T0, none = 0;
  for (const [k, a] of [['poke', 0], ['squeeze', 1], ['pull', 1]] as Array<[TouchKind, number]>) { t2 += 7000; const r = addInteraction(s2, { kind: k, amount: a, tMs: t2 }); s2 = r.state; none += r.detail.medley; }
  check('medley: three kinds spread over more than 12 s do not pay', none === 0);
}
// thresholds
{
  let s = createMeter(), t = T0, total = 0;
  const marks: number[] = [];
  let n = 0;
  while (marks.length < 6 && n++ < 100000) {
    t += 1500; const r = addInteraction(s, { kind: 'poke', amount: 0, tMs: t, dayKey: 100 + marks.length * 2 }); // a fresh "day" each capsule keeps the daily cap out of the way
    s = r.state; total += r.spGained;
    for (let c = 0; c < r.capsulesEarned; c++) marks.push(total - s.sp);
  }
  const want = [30, 50, 75, 100, 100, 100].reduce<number[]>((a, x) => (a.push((a.length ? a[a.length - 1] : 0) + x), a), []);
  check('capsule thresholds 30 / 50 / 75 SP, then 100 each (SP banked at each capsule = 30, 80, 155, 255, 355, 455)', marks.length === 6 && marks.every((m, i) => near(m, want[i], 1e-6)), marks.map(f1).join(' '));
  check('capsuleThreshold(earned) = 30, 50, 75, 100, 100 ...', [0, 1, 2, 3, 4, 99].map(capsuleThreshold).join() === '30,50,75,100,100,100' && CAPSULE_RAMP.join() === '30,50,75' && CAPSULE_COST === 100);
  check('the meter never banks a full capsule (sp < threshold) and carries the remainder', s.sp >= 0 && s.sp < capsuleThreshold(s.earned) && meterFill(s) >= 0 && meterFill(s) < 1);
}

/* ═══════════════════════════════════ 2. meter statistics: humans, mashing, bots, valve, daily cap ═══════════════════════════════════ */
header('2. meter statistics: variety pays, mashing does not, the valve and the daily cap hold');
const archSp: number[] = [];
{
  console.log('archetype | SP per minute (400 five-minute streams through the real meter) | active min per capsule at 100 SP');
  BEHAV.forEach((b, i) => {
    const rng = mulberry32(0x1234 + i * 77);
    let sp = 0, sec = 0;
    for (let k = 0; k < 400; k++) { const st = playStream(b, rng, 300, ''); sp += st.sp; sec += st.seconds; }
    archSp.push(sp / (sec / 60));
    console.log(`${b.name.padEnd(9)} | ${f1(sp / (sec / 60)).padStart(5)} | ${f1(100 / (sp / (sec / 60)))}`);
  });
}
const varied = archSp[3], styles = archSp.slice(0, 3);
check('every single-style player earns within 15% of the others (DESIGN 5.4: about 15%)', Math.max(...styles) / Math.min(...styles) <= 1.15, `${f1(Math.min(...styles))}..${f1(Math.max(...styles))} SP/min`);
check('variety pays: the varied (medley) player out-earns every single style, by about 15%', styles.every((x) => varied > x) && varied / mean(styles) >= 1.08 && varied / mean(styles) <= 1.3, `varied ${f1(varied)} vs mean ${f1(mean(styles))} = x${f2(varied / mean(styles))}`);
check('minutes per capsule at 100 SP are in the owner band (3.0 to 4.0 for single styles, DESIGN 5.4: 3.6-3.8; mixed 3.2)', styles.every((x) => 100 / x >= 3.3 && 100 / x <= 4.0) && 100 / varied >= 3.0 && 100 / varied <= 3.5, styles.map((x) => f1(100 / x)).join('/') + ' / ' + f1(100 / varied));
{
  // the owner's 2026-10-06 styles (FUN.md 2): a fast tapper (bursts of 2-3 taps a second) and a stretch-and-hold player (every stretch
  // held 2-4 s), measured the same way (sim section A); they are not in the macro population
  const extra = BEHAV_EXTRA.map((b, i) => ({ name: b.name, sp: measureStyle(b, BEHAV.length + i).spPerMin }));
  for (const e of extra) console.log(`${e.name.padEnd(9)} | ${f1(e.sp).padStart(5)} | ${f1(100 / e.sp)}`);
  const all = [...archSp, ...extra.map((e) => e.sp)];
  check('every style, the tapper and the stretch-and-holder included, needs 3.0 to 3.8 active minutes a capsule, and none is more than 20% faster than another', all.every((x) => 100 / x >= 3.0 && 100 / x <= 3.8) && Math.max(...all) / Math.min(...all) <= 1.2,
    `${all.map((x) => f1(100 / x)).join('/')} min (poker/squeezer/puller/mixed/tapper/holder), fastest/slowest x${f2(Math.max(...all) / Math.min(...all))}`);
  check('a puller is not faster than a poker by more than 10% (and the stretch-and-holder not by more than 10% over the poker either)', archSp[2] / archSp[0] <= 1.1 && extra[1].sp / archSp[0] <= 1.1, `puller/poker x${f2(archSp[2] / archSp[0])}, holder/poker x${f2(extra[1].sp / archSp[0])}`);
}
/** SP per minute of a fixed-interval single-kind stream for 60 s through the real meter. A pull is held 80% of the interval (at most 3 s). */
function metronome(kind: TouchKind, intervalMs: number, seconds = 60, amount = kind === 'squeeze' ? 1 : kind === 'pull' ? 1 : 0): { perMin: number; maxWindow: number } {
  let s = createMeter(), t = T0, total = 0;
  const log: Array<[number, number]> = [];
  const heldS = kind === 'pull' ? Math.min(3, (0.8 * intervalMs) / 1000) : undefined;
  for (; t < T0 + seconds * 1000; t += intervalMs) { const r = addInteraction(s, { kind, amount, heldS, tMs: t, dayKey: 0 }); s = r.state; total += r.spGained; if (r.spGained > 0) log.push([t, r.spGained]); }
  let mx = 0, lo = 0, acc = 0;
  for (let i = 0; i < log.length; i++) { acc += log[i][1]; while (log[i][0] - log[lo][0] > 60000) acc -= log[lo++][1]; mx = Math.max(mx, acc); }
  return { perMin: total / (seconds / 60), maxWindow: mx };
}
console.log('single-kind pokes at a fixed rate (SP/min, share of the varied human):');
const rates = [12, 10, 8, 6, 5, 4, 3, 2.5, 2, 1.1];
const mashRows = rates.map((hz) => { const m = metronome('poke', 1000 / hz); return { hz, ...m }; });
for (const r of mashRows) console.log(`   ${String(r.hz).padStart(4)} pokes/s: ${f2(r.perMin).padStart(6)} SP/min = ${pct(r.perMin / varied, 0).padStart(4)} of varied play${r.hz >= 5 ? '   (double taps: only the first poke pays)' : r.hz >= 2 ? `   (ordinary fast tapping, ${f2(r.perMin / (60 * r.hz))} SP a tap; a steady minute of it is held by the valve)` : '   (a paced clicker is just playing; the valve and the daily cap bound it)'}`);
check('ordinary fast tapping (2, 2.5, 3 and 4 taps a second, steady) pays at least 0.2 SP a tap, and the valve holds a steady minute of it to 40 SP', mashRows.filter((r) => r.hz >= 2 && r.hz <= 4).every((r) => r.perMin / (60 * r.hz) >= 0.2 - 1e-9 || near(r.perMin, VALVE_SP_PER_MINUTE, 1e-6)) && mashRows.every((r) => r.perMin <= VALVE_SP_PER_MINUTE + 1e-6 && r.maxWindow <= VALVE_SP_PER_MINUTE + 1e-6),
  mashRows.filter((r) => r.hz >= 2 && r.hz <= 4).map((r) => `${r.hz}/s ${f2(r.perMin)} SP/min`).join(', '));
{
  // the first few taps of a burst, before the valve has anything to say: the per-tap pay the owner sees
  let st = addInteraction(createMeter(), { kind: 'poke', amount: 0, tMs: T0 }).state;
  const per: number[] = [];
  for (let i = 1, tb = T0; i <= 6; i++) { tb += i % 2 ? 333 : 500; const r = addInteraction(st, { kind: 'poke', amount: 0, tMs: tb }); per.push(r.spGained); st = r.state; }
  check('a burst of taps at 2 to 3 a second pays every tap 0.2 to 0.36 SP (was 0.11 to 0.25)', per.every((x) => x >= 0.2 - 1e-12 && x <= 0.36), per.map(f2).join(' '));
}
check('MASHING earns at most 45% of varied play per minute (any rate of 5 to 12 pokes a second)', mashRows.filter((r) => r.hz >= 5).every((r) => r.perMin <= 0.45 * varied), `worst ${f2(Math.max(...mashRows.filter((r) => r.hz >= 5).map((r) => r.perMin)))} SP/min = ${pct(Math.max(...mashRows.filter((r) => r.hz >= 5).map((r) => r.perMin)) / varied, 1)}`);
check('mashing squeezes (every 0.3 s) or pulls (every 0.3 s) is also worthless (<= 45%)', ['squeeze', 'pull'].every((k) => metronome(k as TouchKind, 300).perMin <= 0.45 * varied), `squeeze ${f2(metronome('squeeze', 300).perMin)}, pull ${f2(metronome('pull', 300).perMin)} SP/min`);
check('no single-kind stream, at any pace, is paid more than the valve (40 SP/min), and no 60 s window ever exceeds 40 SP', [250, 300, 500, 900, 1000, 1500, 2400, 3000].every((ms) => (['poke', 'squeeze', 'pull'] as TouchKind[]).every((k) => { const m = metronome(k, ms, 300); return m.perMin <= VALVE_SP_PER_MINUTE + 1e-6 && m.maxWindow <= VALVE_SP_PER_MINUTE + 1e-6; })));
{
  // poke-squeeze-pull cycler at the physical limit (the sim's 'cycle' bot): should ride the valve
  const rng = mulberry32(99);
  const cyc = playStream(BEHAV[0], rng, 600, 'cycle');
  check('a poke-squeeze-pull cycler at the physical limit reaches the valve and no more (about 40 SP/min)', cyc.sp / 10 >= 38 && cyc.sp / 10 <= 40.0001, `${f2(cyc.sp / 10)} SP/min`);
  const tap4 = playStream(BEHAV[0], rng, 600, 'tap4'), hold = playStream(BEHAV[0], rng, 600, 'holdbot'), mash = playStream(BEHAV[0], rng, 600, 'mash');
  check('bots: a poke every 250 ms (the fastest paid rate) and full stretches held 3 s back to back are held to the valve (<= 40 SP/min); 8 pokes a second earn ~0',
    tap4.sp / 10 <= 40.0001 && hold.sp / 10 <= 40.0001 && mash.sp / 10 < 0.2, `tap4 ${f2(tap4.sp / 10)}, held stretches ${f2(hold.sp / 10)}, mash ${f2(mash.sp / 10)} SP/min`);
}
// daily cap
{
  // an automation hammering the meter for 80 hours at the valve rate: at most 12 capsules per UTC day from play
  let s = createMeter(); const perDay: Record<number, { caps: number; credited: number; atFull: number }> = {};
  const kinds: TouchKind[] = ['poke', 'squeeze', 'pull'];
  let k = 0;
  for (let t = T0; t < T0 + 80 * 3600 * 1000; t += 1200) {
    const kind = kinds[k++ % 3];
    const r = addInteraction(s, { kind, amount: kind === 'squeeze' ? 1.2 : kind === 'pull' ? 1 : 0, tMs: t });
    s = r.state;
    const day = Math.floor(t / DAY_MS);
    const d = (perDay[day] ??= { caps: 0, credited: 0, atFull: 0 });
    d.caps += r.capsulesEarned; d.credited += r.spGained;
  }
  const days = Object.keys(perDay).map(Number).sort((a, b) => a - b);
  const full = days.filter((d) => d > days[0] && d < days[days.length - 1]);
  check(`daily cap: no UTC day pays more than ${DAILY_HARD_STOP_CAPSULES} capsules from play, even for a bot that never stops`, days.every((d) => perDay[d].caps <= DAILY_HARD_STOP_CAPSULES), days.map((d) => perDay[d].caps).join('/'));
  check('daily cap: a full bot day reaches exactly 12 capsules, then the meter stops until the next day', full.every((d) => perDay[d].caps === DAILY_HARD_STOP_CAPSULES) && full.length >= 1);
  check('daily cap: the next day starts again at full rate (rate 1 after midnight)', dailyRateFor(0) === 1 && dailyStatus({ ...s, day: 5, dayCapsules: 9 }, 6).rate === 1);
  check('daily rate table: 1 up to 7 capsules, 0.25 for capsules 9 to 12, 0 after the 12th', [0, 7].every((n) => dailyRateFor(n) === 1) && [8, 11].every((n) => dailyRateFor(n) === DAILY_REDUCED_RATE) && dailyRateFor(12) === 0 && DAILY_FULL_RATE_CAPSULES === 8);
  // explicit curve of one day
  let s2 = createMeter(), t = T0, caps = 0, spAtCap: number[] = [], credited = 0;
  while (caps < 12 && t < T0 + 20 * 3600 * 1000) { t += 1500; const kind = kinds[Math.floor(t / 1500) % 3]; const r = addInteraction(s2, { kind, amount: kind === 'squeeze' ? 1.2 : kind === 'pull' ? 1 : 0, tMs: t, dayKey: 7 }); s2 = r.state; credited += r.spGained; for (let c = 0; c < r.capsulesEarned; c++) { caps++; spAtCap.push(credited); } }
  const costs = spAtCap.map((x, i) => x - (i ? spAtCap[i - 1] : 0));
  check('the first 8 capsules of a day cost their full 30/50/75/100 SP; capsules 9-12 cost 4x the real SP (25% rate): about 400 credited SP each at 25% = 1600 touch SP for the last four', costs.slice(0, 8).every((c, i) => near(c, i < 3 ? CAPSULE_RAMP[i] : 100, 6)) && costs.slice(8).every((c) => near(c, 100, 8)), costs.map((c) => c.toFixed(0)).join('/'));
  const after = addInteraction(s2, { kind: 'pull', amount: 1, tMs: t + 5000, dayKey: 7 });
  check('after the 12th capsule the day pays nothing (hard stop) and the meter keeps what it had', after.spGained === 0 && near(after.state.sp, s2.sp) && dailyStatus(after.state, 7).hardStopped);
}

/* ═══════════════════════════════════ 2b. INFORMATIVE: the pull threshold against the live body ═══════════════════════════════════ */
header('2b. informative (not a gate): does the live body\'s snap intensity reach the full-pay pull threshold?');
{
  // DESIGN 5.4 pays a pull in full at snap intensity >= PAY.pullFullIntensity. The slice body was measured to top out near 0.3 on a hard
  // pull (src/app.ts), which would pay every pull the "never stretched" rate. The physics lane is being rewritten, so this only REPORTS
  // what the current body gives on scripted pulls; set the threshold from measured gestures once the rewrite lands (src/core/meter.ts).
  type Body = { restRadius: number; positions: Float32Array; step(dt: number): void; grab(id: 0 | 1, v: number, t: { x: number; y: number; z: number }): void; grabMove(id: 0 | 1, t: { x: number; y: number; z: number }): void; grabRelease(id: 0 | 1): void; drainEvents(out: Array<{ kind: string; intensity: number }>): void };
  let line = '';
  try {
    const { SoftBody } = (await import('../src/physics/softbody.ts')) as unknown as { SoftBody: new (g: Genome) => Body };
    const { makeStarterGenome } = await import('../src/core/genome.ts');
    const res: string[] = [];
    for (const pull of [0.5, 1.0, 1.5, 2.2]) {
      const b = new SoftBody(makeStarterGenome());
      for (let i = 0; i < 60; i++) b.step(1 / 60);
      let top = 0; for (let v = 1; v < b.positions.length / 3; v++) if (b.positions[v * 3 + 1] > b.positions[top * 3 + 1]) top = v;
      const p = { x: b.positions[top * 3], y: b.positions[top * 3 + 1], z: b.positions[top * 3 + 2] };
      b.grab(0, top, p);
      for (let i = 1; i <= 40; i++) { b.grabMove(0, { x: p.x, y: p.y + (pull * b.restRadius * i) / 40, z: p.z }); b.step(1 / 60); }
      for (let i = 0; i < 20; i++) b.step(1 / 60);
      b.grabRelease(0); b.step(1 / 60);
      const ev: Array<{ kind: string; intensity: number }> = []; b.drainEvents(ev);
      const snap = ev.filter((e) => e.kind === 'snap').map((e) => e.intensity);
      res.push(`pull ${pull.toFixed(1)} R -> snap ${snap.length ? snap.map((x) => x.toFixed(2)).join('/') : 'none'}`);
    }
    line = res.join(', ');
  } catch (e) { line = `could not run the physics body (${String(e).slice(0, 100)})`; }
  console.log(`INFO pull threshold ${PAY.pullFullIntensity}: ${line}`);
}

/* ═══════════════════════════════════ 3. meter: JSON, hostile input ═══════════════════════════════════ */
header('3. meter: JSON round trip, hostile inputs, invariants');
{
  const rng = mulberry32(2024);
  const kinds: TouchKind[] = ['poke', 'squeeze', 'pull'];
  const evs: Interaction[] = []; let t = T0;
  for (let i = 0; i < 3000; i++) { t += Math.floor(100 + rng() * 2500); const k = kinds[Math.floor(rng() * 3)]; evs.push({ kind: k, amount: k === 'squeeze' ? rng() * 4 : k === 'pull' ? rng() : 0, heldS: k === 'pull' ? rng() * 4 : undefined, tMs: t }); }
  let a = createMeter(), b = createMeter(), same = true, caps = 0;
  for (let i = 0; i < evs.length; i++) {
    const ra = addInteraction(a, evs[i]);
    b = JSON.parse(JSON.stringify(b)) as MeterState;           // the second machine round-trips its state through JSON before every call
    const rb = addInteraction(b, evs[i]);
    if (ra.spGained !== rb.spGained || ra.capsulesEarned !== rb.capsulesEarned || JSON.stringify(ra.state) !== JSON.stringify(rb.state)) { same = false; break; }
    a = ra.state; b = rb.state; caps += ra.capsulesEarned;
  }
  check('state survives JSON round-trip before every call (bit-identical results over 3000 touches)', same, `${caps} capsules`);
  {
    // previewInteraction is the pending arc: it must equal what addInteraction then pays, for every touch, including the medley, the
    // valve, the daily rate and refusals, and it must not touch the state
    const pr = mulberry32(31);
    let st = createMeter(), tt = T0, diff = 0, worst = 0, n = 0, medleys = 0, valved = 0, rested = 0;
    for (let i = 0; i < 20000; i++) {
      tt += pr() < 0.6 ? Math.floor(150 + pr() * 900) : Math.floor(pr() * 4000);
      const k = kinds[Math.floor(pr() * 3)];
      const ev: Interaction = { kind: k, amount: k === 'squeeze' ? pr() * 4 : k === 'pull' ? pr() : 0, heldS: k === 'pull' ? pr() * 4 : undefined, tMs: pr() < 0.01 ? tt - 5000 : tt };
      const before = JSON.stringify(st);
      const p = previewInteraction(st, ev);
      if (JSON.stringify(st) !== before) { diff++; break; }
      const r = addInteraction(st, ev);
      if (p !== r.spGained) { diff++; worst = Math.max(worst, Math.abs(p - r.spGained)); }
      if (r.detail.medley > 0) medleys++; if (r.detail.valveClamped) valved++; if (r.detail.dailyRate < 1) rested++;
      st = r.state; n++;
    }
    check('previewInteraction(state, ev) === addInteraction(state, ev).spGained on 20 000 random touches (medleys, valve cuts, the 25% and 0% daily rate, out-of-order refusals), and never changes the state',
      diff === 0 && medleys > 100 && valved > 100 && rested > 100, `${n} touches, ${medleys} medleys, ${valved} valve cuts, ${rested} at a reduced rate, ${diff} mismatches (worst ${worst})`);
    const garbage = [null, undefined, {}, { kind: 'tap', amount: 1, tMs: T0 }, { kind: 'pull', amount: NaN, heldS: NaN, tMs: NaN }, { kind: 'pull', amount: 1, heldS: 1e300, tMs: T0 }];
    check('previewInteraction never throws on garbage and answers 0 for a refused touch', garbage.every((g) => { try { const v = previewInteraction(createMeter(), g as unknown as Interaction); return Number.isFinite(v) && v >= 0; } catch { return false; } }) && previewInteraction(createMeter(), garbage[4] as unknown as Interaction) === 0);
    // allocation: exact new-space growth of 20 000 preview calls on a busy meter (the HUD calls it once a frame per held finger), measured
    // in a worker thread: a fresh isolate whose type feedback has seen only well-formed touches, as in the game (this probe's own hostile
    // calls make V8 fall back to generic code that boxes numbers, which would measure the probe, not the meter)
    const alloc = await new Promise<{ best: number; recent: number; valve: number; sum: number }>((res, rej) => {
      const code = `
        const { parentPort, workerData } = require('node:worker_threads');
        const v8 = require('node:v8');
        import(workerData.url).then((m) => {
          const newUsed = () => { for (const sp of v8.getHeapSpaceStatistics()) if (sp.space_name === 'new_space') return sp.space_used_size; return NaN; };
          let st = m.createMeter(), t = 1.7e12;
          for (let i = 0; i < 300; i++) { t += 4000; st = m.addInteraction(st, { kind: ['poke', 'squeeze', 'pull'][i % 3], amount: i % 3 === 1 ? 2.2 : 0.8, heldS: 1.3, tMs: t }).state; }
          const qs = [];
          for (let i = 0; i < 64; i++) qs.push({ kind: ['squeeze', 'pull', 'poke'][i % 3], amount: i % 3 === 0 ? 0.5 + i / 30 : 0.8, heldS: i / 20, tMs: t + 400 });
          const acc = new Float64Array(1);
          const loop = (n) => { let a = 0; for (let i = 0; i < n; i++) a += m.previewInteraction(st, qs[i & 63]); acc[0] += a; };
          for (let k = 0; k < 200; k++) loop(2000);
          const b = []; for (let k = 0; k < 6; k++) { const u = newUsed(); b.push(newUsed() - u); }
          let best = Infinity;
          for (let w = 0; w < 8; w++) { const u = newUsed(); loop(20000); const d = newUsed() - u - b[5]; if (d >= 0 && d < best) best = d; }
          parentPort.postMessage({ best, recent: st.recent.length, valve: st.valve.length, sum: acc[0] });
        });`;
      const w = new Worker(code, { eval: true, workerData: { url: new URL('../src/core/meter.ts', import.meta.url).href } });
      w.once('message', (m) => { res(m); void w.terminate(); });
      w.once('error', rej);
    });
    const best = alloc.best, sink = alloc.sum;
    check('previewInteraction allocates nothing: exact new-space growth over 20 000 calls on a busy meter (fresh worker isolate)', best <= 64 && sink > 0, `${best} B per 20 000 calls (state: ${alloc.recent} recent, ${alloc.valve} valve buckets; previews summed ${f1(sink)} SP)`);
  }
  check('sanitizeMeter(state) is the identity on a valid state, and tolerates garbage', JSON.stringify(sanitizeMeter(JSON.parse(JSON.stringify(a)))) === JSON.stringify(a) && [null, undefined, 5, 'x', {}, [], { v: 1, sp: 'x', earned: -4 }, { v: 2 }].every((g) => { const s = sanitizeMeter(g); return s.v === 1 && Number.isFinite(s.sp) && s.sp >= 0; }));
  // a state saved under a clock that ran ahead must not freeze the meter: sanitizeMeter(saved, now) pulls every stored time back to now
  {
    const ahead = addInteraction(createMeter(), { kind: 'squeeze', amount: 2, tMs: T0 + 3_600_000 }).state; // saved one hour "in the future"
    const now = T0 + 1000;
    const stuck = addInteraction(JSON.parse(JSON.stringify(ahead)), { kind: 'poke', amount: 0, tMs: now });
    const fixedState = sanitizeMeter(JSON.parse(JSON.stringify(ahead)), now);
    const freed = addInteraction(fixedState, { kind: 'poke', amount: 0, tMs: now });
    const later = sanitizeMeter(JSON.parse(JSON.stringify(a)), t + 1);
    check('sanitizeMeter(saved, now): a state from a clock that ran ahead no longer refuses every touch (no stored time is later than now); with a now after every stored time it changes nothing',
      stuck.detail.refused === 'out-of-order' && freed.detail.refused === undefined && freed.spGained > 0 && fixedState.lastEventMs === now && fixedState.sp === ahead.sp && fixedState.earned === ahead.earned
      && JSON.stringify(later) === JSON.stringify(a));
  }
  const before = JSON.stringify(a);
  addInteraction(a, { kind: 'poke', amount: 0, tMs: t + 99999 });
  check('addInteraction never mutates the state it is given', JSON.stringify(a) === before);
  check('the state is small and bounded (JSON under 4 KB after 3000 touches)', JSON.stringify(a).length < 4096, `${JSON.stringify(a).length} bytes`);
}
{
  // hostile and random input: never throws, never corrupts
  const rng = mulberry32(777);
  const wild = [NaN, Infinity, -Infinity, -1, 0, 0.5, 1, 3, 1e9, 1e300, -1e300, Number.MAX_VALUE, Number.MIN_VALUE, 8.64e15, 8.64e15 + 1, -0];
  const kindsAll: unknown[] = ['poke', 'squeeze', 'pull', 'POKE', '', null, undefined, 3, {}, 'tap', '__proto__'];
  let s = createMeter(), threw = 0, refused = 0, okInv = true, why = '', lastEarned = 0, tNow = 5000;
  const windowLog: Array<[number, number]> = [];
  for (let i = 0; i < 40000; i++) {
    const pick = <T>(a: T[]): T => a[Math.floor(rng() * a.length)];
    const hostile = rng() < 0.5;
    const ev = (hostile ? { kind: pick(kindsAll), amount: pick(wild), heldS: rng() < 0.5 ? pick(wild) : undefined, tMs: rng() < 0.3 ? pick(wild) : tNow, dayKey: rng() < 0.2 ? pick(wild) : undefined } : { kind: pick(['poke', 'squeeze', 'pull']), amount: rng() * 4, heldS: rng() * 4, tMs: tNow }) as unknown as Interaction;
    tNow += Math.floor(rng() * 1500);
    let r;
    try { r = addInteraction(s, ev); } catch { threw++; continue; }
    if (r.detail.refused) { refused++; if (r.state !== s) { okInv = false; why = 'refused call changed state'; } }
    if (!(Number.isFinite(r.spGained) && r.spGained >= 0 && Number.isInteger(r.capsulesEarned) && r.capsulesEarned >= 0)) { okInv = false; why = 'bad result ' + JSON.stringify(r); }
    const st = r.state;
    if (!(Number.isFinite(st.sp) && st.sp >= 0 && st.sp < capsuleThreshold(st.earned) + 1e-9 && st.earned >= lastEarned && Number.isInteger(st.earned) && st.valve.length <= 121 && st.recent.length < 200 && st.dayCapsules >= 0)) { okInv = false; why = 'bad state ' + JSON.stringify(st).slice(0, 200); }
    if (JSON.stringify(st).includes('null,null,null') === false && !st.lastMs.every((x) => x === null || Number.isFinite(x))) { okInv = false; why = 'lastMs'; }
    lastEarned = st.earned; s = st;
    if (r.spGained > 0 && typeof ev.tMs === 'number') windowLog.push([ev.tMs, r.spGained]);
  }
  check('40000 random and hostile calls (NaN, Infinity, negative, 1e300 amounts, holds and times, unknown kinds, null) never throw', threw === 0);
  check('every call leaves a valid state; refused calls return the very same state; spGained is finite and >= 0', okInv, why);
  check('hostile calls are refused rather than paid (some were refused)', refused > 1000, `${refused} refused`);
  let mx = 0, lo = 0, acc = 0;
  for (let i = 0; i < windowLog.length; i++) { acc += windowLog[i][1]; while (windowLog[i][0] - windowLog[lo][0] > 60000) acc -= windowLog[lo++][1]; mx = Math.max(mx, acc); }
  check('even under fuzzing no 60 s window credited more than 40 SP', mx <= VALVE_SP_PER_MINUTE + 1e-6, `${f2(mx)} SP`);
  const a = addInteraction(createMeter(), { kind: 'poke', amount: 0, tMs: 5000 }), o = addInteraction(a.state, { kind: 'poke', amount: 0, tMs: 4000 });
  check('out-of-order time is refused (the clock cannot go backwards) and a huge or negative time is refused', o.detail.refused === 'out-of-order' && o.state === a.state && addInteraction(createMeter(), { kind: 'poke', amount: 0, tMs: -5 }).detail.refused === 'bad-time' && addInteraction(createMeter(), { kind: 'poke', amount: 0, tMs: MAX_T_MS + 1 }).detail.refused === 'bad-time');
  check('NaN / negative / huge amounts are clamped, never paid extra (squeeze 1e300 = the 3 s cap, negative = 0 hold = a poke)', near(addInteraction(createMeter(), { kind: 'squeeze', amount: 1e300, tMs: 5000 }).spGained, 2.55) && near(addInteraction(createMeter(), { kind: 'squeeze', amount: -5, tMs: 5000 }).spGained, 0.8) && near(addInteraction(createMeter(), { kind: 'pull', amount: NaN, tMs: 5000 }).spGained, 0.5));
  check('equal times are allowed (two touches in the same millisecond)', addInteraction(a.state, { kind: 'squeeze', amount: 1, tMs: 5000 }).detail.refused === undefined);
}

/* ═══════════════════════════════════ 4. drops ═══════════════════════════════════ */
header('4. capsules: tier frequencies over 1,000,000 seeded rolls');
const N = 1_000_000;
const tierCount = new Array(TIER_COUNT).fill(0) as number[];
const speciesCount: Record<string, number> = {};
{
  const rng = mulberry32(0xcafe);
  for (let i = 0; i < N; i++) { const c = rollCapsule(rng); tierCount[c.tierIndex]++; speciesCount[c.species] = (speciesCount[c.species] ?? 0) + 1; }
  console.log('tier       | public odds | observed  | diff in std errors | tolerance (5 s.e.)');
  TIERS.forEach((t, i) => console.log(`${t.padEnd(10)} | ${pct(TIER_ODDS[i], 2).padStart(10)} | ${pct(tierCount[i] / N, 3).padStart(8)} | ${f2((tierCount[i] / N - TIER_ODDS[i]) / se(TIER_ODDS[i], N)).padStart(18)} | +-${pct(Z * se(TIER_ODDS[i], N), 3)}`));
  check(`capsule tier frequencies match the public odds within ${Z} standard errors (n = ${N})`, TIERS.every((_, i) => zOk(tierCount[i] / N, TIER_ODDS[i], N)));
  let worst = 0, worstId = '';
  for (const d of CATALOG) { const p = TIER_ODDS[tierIndex(d.tier)] / TIER_SPECIES_COUNTS[tierIndex(d.tier)]; const z = Math.abs((speciesCount[d.id] ?? 0) / N - p) / se(p, N); if (z > worst) { worst = z; worstId = d.id; } }
  check('every species drops with probability tier odds / species in tier (uniform inside a tier), within 5 standard errors', worst <= Z, `worst ${worstId} at ${f2(worst)} s.e.`);
  check('every one of the 50 species can drop', CATALOG.every((d) => (speciesCount[d.id] ?? 0) > 0));
}
{
  const a = rollCapsule(42), b = rollCapsule(42), c = rollCapsule('seed-x'), d = rollCapsule('seed-x'), e = rollCapsule(mulberry32(42));
  check('rollCapsule is deterministic: same seed => same result (number, string and function sources)', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(c) === JSON.stringify(d) && JSON.stringify(a) === JSON.stringify(e));
  // scripted sources: the three draws are (tier, species inside the tier, genome seed), in that order, and nothing else is drawn
  const scripted = (xs: number[]): (() => number) => { let i = 0; return () => xs[i++ % xs.length]; };
  const c1 = rollCapsule(scripted([0, 0, 0.5])), c2 = rollCapsule(scripted([0.9999, 0.99, 0.25])), c3 = rollCapsule(scripted([0.763 + 1e-9, 0.5, 0]));
  check('draw order is fixed: draw 1 picks the tier, draw 2 the species inside it, draw 3 the genome seed; exactly 3 draws per capsule',
    c1.tier === 'common' && c1.species === SPECIES_BY_TIER[0][0].id && c1.genomeSeed === 2 ** 31
    && c2.tier === 'mythic' && c2.species === SPECIES_BY_TIER[5][SPECIES_BY_TIER[5].length - 1].id && c2.genomeSeed === 2 ** 30
    && c3.tier === 'uncommon' && c3.species === SPECIES_BY_TIER[1][Math.floor(0.5 * SPECIES_BY_TIER[1].length)].id && c3.genomeSeed === 0
    && (() => { const x = mulberry32(9), y = mulberry32(9); rollCapsule(x); y(); y(); y(); return x() === y(); })(),
    `${c1.species}/${c1.genomeSeed} ${c2.species}/${c2.genomeSeed} ${c3.species}`);
  const g = capsuleGenome(a);
  check('the capsule genome is the species template for the genome seed and round-trips', g.species === a.species && g.seed === a.genomeSeed && genomeEquals(decodeGenome(encodeGenome(g)) as never, g));
  check('hostile random sources never produce an invalid roll (NaN, 1, negative, huge)', [() => NaN, () => 1, () => -5, () => 7, () => Infinity].every((src) => { const r = rollCapsule(src); return CATALOG.some((x) => x.id === r.species) && Number.isInteger(r.genomeSeed) && r.genomeSeed >= 0 && r.genomeSeed < 2 ** 32; }) && draw(() => NaN) === 0);
  check('different seeds give different capsules', new Set(Array.from({ length: 300 }, (_, i) => JSON.stringify(rollCapsule(i)))).size > 250);
}
header('4b. Daily Restock and tasks');
{
  const pool = RESTOCK_POOL.map((d) => d.id);
  check('the restock pool is the 25 Common and Uncommon species', pool.length === 25 && RESTOCK_POOL.every((d) => tierIndex(d.tier) <= 1));
  const hits: Record<string, number> = {}; let distinct = true, inPool = true, det = true;
  const NS = 20000;
  for (let i = 0; i < NS; i++) {
    const o = restockOffer(daySeed('player-1', i, 'restock'));
    if (o.length !== RESTOCK_OFFER_COUNT || new Set(o).size !== o.length) distinct = false;
    for (const id of o) { hits[id] = (hits[id] ?? 0) + 1; if (!pool.includes(id)) inPool = false; }
    if (i < 200 && JSON.stringify(o) !== JSON.stringify(restockOffer(daySeed('player-1', i, 'restock')))) det = false;
  }
  check('a restock offers 3 distinct Common or Uncommon species, deterministic for a day seed', distinct && inPool && det);
  const p = RESTOCK_OFFER_COUNT / pool.length;
  check('every pool species is offered with probability 3 / 25 (within 5 standard errors)', pool.every((id) => zOk((hits[id] ?? 0) / NS, p, NS)), `expected ${pct(p, 1)}, range ${pct(Math.min(...pool.map((id) => (hits[id] ?? 0) / NS)), 1)}..${pct(Math.max(...pool.map((id) => (hits[id] ?? 0) / NS)), 1)}`);
  const o = restockOffer('day-seed');
  check('a pick is valid only if it was offered', isValidRestockPick('day-seed', o[1]) && !isValidRestockPick('day-seed', 'skeinara') && !isValidRestockPick('day-seed', 7 as never));
  const order = restockDisplayOrder(o, (id) => (id === o[0] ? 2 : 0));
  check('new species are shown first (owned ones last), same three species', order[order.length - 1] === o[0] && order.length === 3 && new Set(order).size === 3);
  check('the same player and day always get the same seed; other players and days get other offers', daySeed('a', 5, 'restock') === daySeed('a', 5, 'restock') && daySeed('a', 5, 'restock') !== daySeed('b', 5, 'restock') && daySeed('a', 5, 'restock') !== daySeed('a', 6, 'restock'));
  // tasks
  const tasks = dailyTasks(daySeed('player-1', 100, 'tasks'));
  check(`${TASKS_OFFERED_PER_DAY} distinct tasks are offered a day, deterministic`, tasks.length === TASKS_OFFERED_PER_DAY && new Set(tasks.map((t) => t.id)).size === tasks.length && JSON.stringify(tasks) === JSON.stringify(dailyTasks(daySeed('player-1', 100, 'tasks'))) && TASK_DEFS.length >= 6);
  check('task texts are plain, short and kind-neutral (<= 60 chars, no timers or threats)', TASK_DEFS.every((t) => t.text.length <= 60 && !/\b(hurry|lose|lost|expire|timer|limited|last chance)\b/i.test(t.text)));
  let st = createTaskState(); const day = 20000; const week = weekKeyOf(day);
  const offered = TASK_DEFS.slice(0, 2);
  let r = claimTask(st, offered, offered[0].id, day);
  check('a task pays once a day: first claim ok, second refused', r.ok && (st = (r as { state: typeof st }).state) !== undefined && !claimTask(st, offered, offered[0].id, day).ok && (claimTask(st, offered, offered[0].id, day) as { reason: string }).reason === 'already-claimed');
  check('a task that was not offered is refused', (claimTask(createTaskState(), offered, TASK_DEFS[5].id, day) as { reason: string }).reason === 'not-offered');
  // fill the week: 5 claims across days of one week, the 6th refused
  let ws = createTaskState(); let paid = 0, refusedWeekly = false;
  const monday = (Math.floor((day + 3) / 7) * 7) - 3;
  for (let d = 0; d < 7 && !refusedWeekly; d++) for (const t of offered) { const c = claimTask(ws, offered, t.id, monday + d); if (c.ok) { ws = c.state; paid++; } else if (c.reason === 'weekly-limit') { refusedWeekly = true; break; } }
  check(`at most ${TASKS_MAX_PER_WEEK} tasks pay in a week; the sixth is refused ('weekly-limit')`, paid === TASKS_MAX_PER_WEEK && refusedWeekly && weekKeyOf(monday) === weekKeyOf(monday + 6) && weekKeyOf(monday + 7) === weekKeyOf(monday) + 1);
  check('the weekly counter resets on Monday and the state is JSON-safe', (claimTask(JSON.parse(JSON.stringify(ws)), offered, offered[0].id, monday + 7) as { ok: boolean }).ok && week === weekKeyOf(day) && !claimTask(createTaskState(), offered, offered[0].id, NaN).ok);
}

/* ═══════════════════════════════════ 5. merge ═══════════════════════════════════ */
header('5. merge (DESIGN 5.6): the one constant');
const src = (rel: string): string => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
{
  const defs = ['../src/core/merge.ts', '../src/core/meter.ts', '../src/core/drops.ts', '../src/data/catalog.ts', './sim_economy.ts'].map((f) => (src(f).match(/\bconst MERGE_COST\b\s*(?::\s*\w+\s*)?=/g) ?? []).length);
  check('MERGE_COST is defined exactly once, in src/core/merge.ts, as a single literal', defs.join() === '1,0,0,0,0' && /export const MERGE_COST: number = \d+;/.test(src('../src/core/merge.ts')), `value ${MERGE_COST}`);
  check('MERGE_COST is one of the two costs the design allows (owner\'s rule: 2 for the measured 3.1-3.8 active minutes per capsule, 3 if capsules become easy)', MERGE_COST === 2 || MERGE_COST === 3, `value ${MERGE_COST}`);
  check('tier-up table 30 / 25 / 20 / 15 / 10 percent, Mythic cannot merge; unowned weight 1.5; pity after 4', MERGE_TIER_UP.join() === '0.3,0.25,0.2,0.15,0.1,0' && MERGE_RULES.unownedWeight === 1.5 && MERGE_PITY_AFTER === 4 && MERGE_RULES.pityAfter === 4);
}
const ids = (t: number): SpeciesId[] => SPECIES_BY_TIER[t].map((d) => d.id);
const ownedAll = (n: number): Record<string, number> => Object.fromEntries(CATALOG.map((d) => [d.id, n]));

/**
 * The whole merge section, for an explicit cost. It runs once at MERGE_COST (full sample sizes) and once at the OTHER legal cost (a quarter of
 * the samples): the flip of the constant is rehearsed on every run, every selection is built from `COST`, and every roll is checked for ok
 * before its outcome is read (a refused roll is a failure, never a TypeError).
 */
function mergeSection(COST: number, scale: number): void {
  const tag = COST === MERGE_COST ? `cost ${COST} (MERGE_COST)` : `cost ${COST} (flip rehearsal)`;
  header(`5. merge at ${tag}: rules, odds, determinism, lineage`);
  const N = (n: number): number => Math.max(2000, Math.round(n * scale));
  const inputsOf = (id: SpeciesId | null | string, n = COST): MergeInput[] => new Array(n).fill(id) as MergeInput[];
  const pv = (inp: readonly unknown[], st: MergeState, rules: MergeRules = MERGE_RULES): MergePreview => previewMerge(inp as MergeInput[], st, rules, COST);
  const roll = (inp: readonly unknown[], rs: Parameters<typeof rollMerge>[1], st: MergeState, rules: MergeRules = MERGE_RULES): MergeRoll => rollMerge(inp as MergeInput[], rs, st, rules, COST);
  const okRoll = (r: MergeRoll): r is MergeRollOk => r.ok === true;
  const okPv = (r: MergePreview): r is MergePreviewOk => r.ok === true;
  {
    // validation
    const st: MergeState = { owned: ownedAll(COST + 1), pity: createMergePity() };
    const err = (inp: unknown, s: MergeState = st): string => { const r = pv(inp as unknown[], s); return r.ok ? 'ok' : r.error; };
    const a = ids(0)[0], b = ids(0)[1];
    check(`invalid selections are refused with a reason: wrong count (${COST - 1} or ${COST + 1}), mixed species, unknown species, Mythic, not enough copies`,
      err(inputsOf(a, COST - 1)) === 'wrong-count' && err(inputsOf(a, COST + 1)) === 'wrong-count' && err([a, ...inputsOf(b, COST - 1)]) === 'mixed-species' && err([a, ...inputsOf('nope', COST - 1)]) === 'unknown-species'
      && err(inputsOf(ids(5)[0])) === 'mythic-cannot-merge' && err(inputsOf(a), { owned: { [a]: COST - 1 } }) === 'not-enough-copies' && err(null) === 'wrong-count' && err(inputsOf(null)) === 'unknown-species');
    check('a refused roll consumes no randomness and returns { ok: false }', (() => { const r = mulberry32(1), q = mulberry32(1); const out = roll(inputsOf(ids(5)[0]), r, st); const first = q(); return !out.ok && r() === first; })());
    check('a Mythic cannot merge: refused for all three Mythic species', ids(5).every((id) => { const r = roll(inputsOf(id), 1, st); return !r.ok && r.error === 'mythic-cannot-merge'; }));
    check('inputs may be species ids, {species}, {genome} or {species, genome}', pv(Array.from({ length: COST }, () => ({ species: 'dollop' })), st).ok && pv(Array.from({ length: COST }, (_, i) => ({ genome: speciesBaseGenome('dollop', i + 1) })), st).ok
      && pv(Array.from({ length: COST }, (_, i) => ({ species: 'dollop', genome: speciesBaseGenome('dollop', i + 1) })), st).ok);
    const good = speciesBaseGenome('dollop', 5);
    const bads: unknown[] = [{ ...good, hue: NaN }, { ...good, pattern: 'zigzag' }, { ...good, species: 'plumpet' }, 'g1.x', 7];
    const refusedGenomes = bads.map((g) => { const inp = [{ species: 'dollop', genome: g }, ...Array.from({ length: COST - 1 }, () => ({ species: 'dollop' }))]; const r = roll(inp, 1, st); return r.ok ? 'ok' : r.error; });
    check('a parent genome that is not a valid genome of its species is refused (invalid-genome) before it can reach the lineage', refusedGenomes.every((e) => e === 'invalid-genome'), refusedGenomes.join(' '));
  }
  // invariants over random states
  {
    const rng = mulberry32(31337 + COST);
    let lower = 0, same = 0, total = 0, bad3 = 0, refused = 0, finishedUp = 0, finishedTotal = 0, pityOk = true;
    for (let i = 0; i < N(300000); i++) {
      const t = Math.floor(rng() * TOP_TIER_INDEX), list = SPECIES_BY_TIER[t];
      const input = list[Math.floor(rng() * list.length)].id;
      // random ownership: each species owned with probability q, the input at least COST copies
      const q = rng() < 0.2 ? 1 : rng(); const owned: Record<string, number> = {};
      for (const d of CATALOG) if (rng() < q) owned[d.id] = 1 + Math.floor(rng() * 3);
      owned[input] = COST + Math.floor(rng() * 2);
      const pity = createMergePity(); for (let k = 0; k < TIER_COUNT; k++) pity[k] = Math.floor(rng() * 7);
      const r = roll(inputsOf(input), rng, { owned, pity });
      total++;
      if (!okRoll(r)) { refused++; continue; }
      const outT = tierIndex(r.outcome.tier);
      if (outT < t) lower++;
      if (r.outcome.species === input) same++;
      if (outT !== t && outT !== t + 1) bad3++;
      if (r.outcome.tierUp !== (outT === t + 1)) bad3++;
      if (r.outcome.isNew !== !(owned[r.outcome.species] > 0)) bad3++;
      if (r.inputs.length !== COST) bad3++;
      if (r.odds.finishedRow) { finishedTotal++; if (r.outcome.tierUp) finishedUp++; }
      if (pity[t] >= MERGE_PITY_AFTER && !r.outcome.tierUp) pityOk = false;
      for (let k = 0; k < TIER_COUNT; k++) { const expect = k === t ? (r.outcome.tierUp ? 0 : pity[k] + 1) : pity[k]; if (r.pityAfter[k] !== expect) pityOk = false; }
    }
    check(`every valid random merge is accepted (${total} merges with random ownership and pity; none refused)`, refused === 0, `${refused} refused`);
    check('merge never returns a lower tier', lower === 0);
    check('merge never returns the input species', same === 0);
    check(`merge returns the input tier or exactly one above, tierUp flag is consistent, isNew is exact, ${COST} inputs consumed`, bad3 === 0);
    check('FINISHED ROW: when you own every other species of the input tier the merge ALWAYS tiers up', finishedTotal > 100 && finishedUp === finishedTotal, `${finishedUp}/${finishedTotal}`);
    check(`PITY: a pity counter of ${MERGE_PITY_AFTER} or more always tiers up; counters reset on a tier-up, grow by one on a dud, and only the input tier's counter changes`, pityOk);
  }
  // finished row, tier by tier, explicitly (the row owned, including the input)
  {
    const ok: boolean[] = [];
    for (let t = 0; t < TOP_TIER_INDEX; t++) {
      let up = 0; const n = N(4000);
      const owned: Record<string, number> = {}; for (const id of ids(t)) owned[id] = COST; owned[ids(t)[0]] = COST + 3;
      for (let i = 0; i < n; i++) { const r = roll(inputsOf(ids(t)[i % ids(t).length]), 100000 + i, { owned, pity: createMergePity() }); if (okRoll(r) && r.outcome.tierUp && r.reason === 'finished-row') up++; }
      ok.push(up === n);
    }
    check('finished row, every merge tier Common..Legendary: 100% tier-up with reason "finished-row"', ok.every(Boolean));
  }
  // tier-up frequencies vs DESIGN
  {
    const NN = N(400000);
    console.log('merge tier-up frequency, unfinished row (a player who owns only the input species):');
    console.log('tier       | table | pity off: observed | real rules (pity on): observed | analytic (pity on) | tolerance');
    const rowsOk: boolean[] = [], rowsOk2: boolean[] = [];
    for (let t = 0; t < TOP_TIER_INDEX; t++) {
      const input = ids(t)[0];
      const owned = { [input]: COST + 1 };
      const p = MERGE_TIER_UP[t];
      const rng = mulberry32(1000 + t);
      let up = 0, refusedHere = 0;
      const noPity = { ...MERGE_RULES, pityAfter: 0 };
      for (let i = 0; i < NN; i++) { const r = roll(inputsOf(input), rng, { owned, pity: createMergePity() }, noPity); if (!okRoll(r)) refusedHere++; else if (r.outcome.tierUp) up++; }
      let pity = createMergePity(), up2 = 0, run = 0, maxRun = 0;
      const rng2 = mulberry32(2000 + t);
      for (let i = 0; i < NN; i++) { const r = roll(inputsOf(input), rng2, { owned, pity }); if (!okRoll(r)) { refusedHere++; continue; } pity = r.pityAfter; if (r.outcome.tierUp) { up2++; run = 0; } else { run++; if (run > maxRun) maxRun = run; } }
      let E = 0; for (let k = 0; k <= MERGE_PITY_AFTER; k++) E += (1 - p) ** k;
      const analytic = 1 / E;
      console.log(`${TIERS[t].padEnd(10)} | ${pct(p, 0).padStart(5)} | ${pct(up / NN, 2).padStart(18)} | ${pct(up2 / NN, 2).padStart(30)} | ${pct(analytic, 2).padStart(18)} | +-${pct(Z * se(p, NN), 2)} (max dud run ${maxRun})`);
      rowsOk.push(refusedHere === 0 && zOk(up / NN, p, NN));
      rowsOk2.push(refusedHere === 0 && zOk(up2 / NN, analytic, NN) && maxRun <= MERGE_PITY_AFTER);
    }
    check('tier-up chance per input tier matches DESIGN 5.6 (Common 30, Uncommon 25, Rare 20, Epic 15, Legendary 10 percent) within 5 standard errors', rowsOk.every(Boolean));
    check(`with pity on, the long-run tier-up rate is 1 / (1 + q + ... + q^${MERGE_PITY_AFTER}) as the Markov chain says, and a run of duds is never longer than ${MERGE_PITY_AFTER}`, rowsOk2.every(Boolean));
  }
  // outcome distribution vs the preview odds (several states)
  {
    const cases: Array<[string, MergeState, SpeciesId]> = [];
    const half: Record<string, number> = {}; ids(2).forEach((id, i) => { if (i % 2 === 0) half[id] = COST; }); ids(3).forEach((id, i) => { if (i < 2) half[id] = 1; }); half[ids(2)[1]] = COST + 2;
    cases.push(['Rare, half of Rare and 2 of 7 Epic owned', { owned: half, pity: createMergePity() }, ids(2)[1]]);
    const none: Record<string, number> = { [ids(0)[0]]: COST + 1 };
    cases.push(['Common, nothing else owned', { owned: none, pity: createMergePity() }, ids(0)[0]]);
    const fin: Record<string, number> = {}; ids(3).forEach((id) => { fin[id] = 1; }); fin[ids(3)[2]] = COST + 1; ids(4).forEach((id, i) => { if (i < 3) fin[id] = 1; });
    cases.push(['Epic row finished, 3 of 5 Legendary owned', { owned: fin, pity: createMergePity() }, ids(3)[2]]);
    const pit: Record<string, number> = { [ids(1)[3]]: COST };
    cases.push(['Uncommon with pity due', { owned: pit, pity: [0, 4, 0, 0, 0, 0] }, ids(1)[3]]);
    const NN = N(300000);
    let allOk = true, worst = 0, worstWhere = '';
    for (const [name, st, input] of cases) {
      const p0 = pv(inputsOf(input), st);
      if (!okPv(p0)) { allOk = false; worstWhere = `${name}: preview refused (${p0.error})`; continue; }
      const sum = p0.outcomes.reduce((a, o) => a + o.probability, 0);
      if (Math.abs(sum - 1) > 1e-12) { allOk = false; worstWhere = name + ' sum'; }
      const counts: Record<string, number> = {};
      const rng = mulberry32(555);
      for (let i = 0; i < NN; i++) { const r = roll(inputsOf(input), rng, st); if (!okRoll(r)) { allOk = false; break; } counts[r.outcome.species] = (counts[r.outcome.species] ?? 0) + 1; }
      for (const o of p0.outcomes) { const z = Math.abs((counts[o.species] ?? 0) / NN - o.probability) / se(Math.max(o.probability, 1e-9), NN); if (z > worst) { worst = z; worstWhere = `${name}: ${o.species}`; } if (z > Z) allOk = false; }
      if (Object.keys(counts).some((k) => !p0.outcomes.some((o) => o.species === k))) allOk = false;
      console.log(`   ${name}: tier-up ${pct(p0.tierUpChance, 1)} (${p0.basis}), lacking ${p0.lackingInTier} in tier / ${p0.lackingInNextTier} in next, ${p0.outcomes.length} possible results`);
    }
    check('the preview odds are exact: every possible result is observed at its previewed probability (5 s.e.), nothing else ever appears, probabilities sum to 1', allOk, `worst ${f2(worst)} s.e. (${worstWhere})`);
    const p1 = pv(inputsOf(cases[0][2]), cases[0][1]);
    const stay = okPv(p1) ? p1.outcomes.filter((o) => o.tier === p1.stayTier) : [], own = stay.find((o) => !o.isNew), nw = stay.find((o) => o.isNew);
    check('species you do not own are weighted x1.5 against owned ones (previewed probability ratio 1.5)', !!own && !!nw && near(nw.probability / own.probability, 1.5, 1e-9));
    check('the preview names how many species you still lack in the output tier and the next tier', okPv(p1) && p1.lackingInTier === stay.filter((o) => o.isNew).length && p1.lackingInNextTier === p1.outcomes.filter((o) => o.tier === p1.upTier && o.isNew).length && p1.lackingInNextTier === 5);
    const last = pv(inputsOf(ids(0)[0]), { owned: { [ids(0)[0]]: COST } }), more = pv(inputsOf(ids(0)[0]), { owned: { [ids(0)[0]]: COST + 1 } });
    check('the preview warns when the merge uses your last copy', okPv(last) && okPv(more) && last.usesLastCopy && !more.usesLastCopy && last.copiesOwned === COST && last.cost === COST);
    const q0 = pv(inputsOf(ids(0)[0]), { owned: none, pity: [0, 0, 0, 0, 0, 0] }), q3 = pv(inputsOf(ids(0)[0]), { owned: none, pity: [3, 0, 0, 0, 0, 0] }), q4 = pv(inputsOf(ids(0)[0]), { owned: none, pity: [4, 0, 0, 0, 0, 0] });
    check('the preview counts down to pity: duds until pity 4, 1, then due (tier-up chance shown as 100%)', okPv(q0) && okPv(q3) && okPv(q4) && q0.dudsUntilPity === 4 && q3.dudsUntilPity === 1 && q4.pityDue && q4.tierUpChance === 1 && q4.basis === 'pity' && q0.basis === 'table' && q0.tierUpChance === 0.3);
  }
  // determinism, audit fields, immutability
  {
    const st: MergeState = { owned: { [ids(1)[0]]: COST + 1, [ids(1)[1]]: 1 }, pity: createMergePity() };
    const a = roll(inputsOf(ids(1)[0]), 7, st), b = roll(inputsOf(ids(1)[0]), 7, st), c = roll(inputsOf(ids(1)[0]), 'seed-7', st), d = roll(inputsOf(ids(1)[0]), 'seed-7', st);
    check('rollMerge is deterministic: same seed (number, string or rng function) and state => identical result', a.ok && JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(c) === JSON.stringify(d) && JSON.stringify(roll(inputsOf(ids(1)[0]), mulberry32(7), st)) === JSON.stringify(a));
    if (!okRoll(a)) check('rollMerge accepts a valid selection', false, a.error);
    else {
      const m = mulberry32(7); const u = [m(), m(), m()];
      check('the result carries the draws used (tier-up roll, species roll, genome seed) in order, for audit and replay', a.draws.join() === u.join() && a.outcome.genomeSeed === Math.floor(u[2] * 4294967296) >>> 0);
      check('the result carries everything to animate and audit: outcome, tier-up flag, the odds used, the pity counter after, the consumed species', a.inputs.length === COST && a.odds.cost === COST && typeof a.odds.tierUpChance === 'number' && Array.isArray(a.pityAfter) && a.pityAfter.length === TIER_COUNT && typeof a.pityCounterAfter === 'number' && ['roll', 'finished-row', 'pity', 'stay'].includes(a.reason) && a.odds.outcomes.length > 0);
      check('the core is the same function the simulation calls: mergeOddsCore + mergeDrawCore reproduce rollMerge', (() => {
        const roster = SPECIES_BY_TIER.map((l) => l.map((x) => x.idx)); const input = CATALOG.find((x) => x.id === ids(1)[0])!.idx;
        const odds = mergeOddsCore({ tier: 1, self: input, roster, copies: (h) => (st.owned as Record<string, number>)[CATALOG[h].id] ?? 0, pity: 0, rules: MERGE_RULES });
        const r = mergeDrawCore(odds, a.draws[0], a.draws[1]);
        return CATALOG[r.out].id === a.outcome.species && r.tierUp === a.outcome.tierUp;
      })());
    }
    const keys = new Set<string>(); for (let i = 0; i < 200; i++) { const r = roll(inputsOf(ids(1)[0]), i, st); if (okRoll(r)) keys.add(r.outcome.species + r.outcome.genomeSeed); }
    check('different seeds give different merges', keys.size > 150, `${keys.size}/200`);
    const frozen: MergeState = Object.freeze({ owned: Object.freeze({ [ids(1)[0]]: COST + 1 }), pity: Object.freeze([0, 1, 2, 3, 0, 0]) as readonly number[] });
    let threw = false, okFrozen = false; try { okFrozen = roll(inputsOf(ids(1)[0]), 3, frozen).ok && pv(inputsOf(ids(1)[0]), frozen).ok; } catch { threw = true; }
    check('rollMerge / previewMerge never mutate their arguments (frozen state works)', !threw && okFrozen);
  }
  // lineage: every look invariant a normal instance of the result species has must also hold for a merge result made from real parents
  {
    const rng = mulberry32(4711 + COST);
    let n = 0, refusedL = 0, tierUps = 0, patternRule = 0, tierUpOwnPattern = 0, sameTierPattern = 0, foreignColour = 0, otherFields = 0, hueTooFar = 0, roundTrip = 0, tooFarColour = 0;
    const shifts: number[] = [], drift: number[] = [];
    const KEEP = ['chroma', 'lightness', 'coreHue', 'coreGlow', 'translucency', 'gloss', 'firmness', 'bounce', 'stretch', 'size', 'glitter', 'speckle', 'eyeStyle', 'eyeSpacing', 'eyeSize', 'eyeHeight', 'seed', 'species', 'v'] as const;
    for (let i = 0; i < N(12000); i++) {
      const t = Math.floor(rng() * TOP_TIER_INDEX), list = SPECIES_BY_TIER[t];
      const input = list[Math.floor(rng() * list.length)].id;
      const parents: Genome[] = Array.from({ length: COST }, () => speciesBaseGenome(input, Math.floor(rng() * 4294967296) >>> 0));
      // half of the merges own the whole input row (finished row: always a tier-up), half own a random part of the catalog
      const owned: Record<string, number> = {};
      if (rng() < 0.5) for (const d of list) owned[d.id] = 1; else for (const d of CATALOG) if (rng() < 0.4) owned[d.id] = 1;
      owned[input] = COST;
      const r = roll(parents.map((g) => ({ species: input, genome: g })), rng, { owned, pity: createMergePity() });
      if (!okRoll(r)) { refusedL++; continue; }
      n++;
      const g = r.outcome.genome, def = getSpecies(g.species)!, tpl = speciesBaseGenome(r.outcome.species, r.outcome.genomeSeed);
      const outT = tierIndex(def.tier);
      if (r.outcome.tierUp) tierUps++;
      if ((outT <= 1) !== (g.pattern === 'plain')) patternRule++;                                        // Common/Uncommon plain, Rare+ patterned
      if (outT >= 2 && g.speckle < PATTERN_SPECKLE_FLOOR - 1e-9) patternRule++;                         // ... with a visible layer
      if (r.outcome.tierUp && g.pattern !== def.look.pattern) tierUpOwnPattern++;                       // a tier-up keeps the species' own pattern
      if (!r.outcome.tierUp && g.pattern !== def.look.pattern && !parents.some((p) => p.pattern === g.pattern)) sameTierPattern++;
      if (!keepsSpeciesColour(g, 0)) foreignColour++;                                                   // nearer another same-tier species' colour
      const dc = labDistance(bodyLab(g), bodyLab(speciesTemplateGenome(g.species))), dt = labDistance(bodyLab(tpl), bodyLab(speciesTemplateGenome(g.species)));
      if (dc > Math.max(LINEAGE_MAX_DISTANCE, dt) + 1e-9) tooFarColour++;                              // a tint never leaves the colour budget (unless the instance itself sits further out)
      drift.push(dc);
      if (KEEP.some((k) => g[k] !== tpl[k])) otherFields++;
      const dh = Math.abs(((g.hue - tpl.hue + 540) % 360) - 180);
      if (dh > LINEAGE_MAX_SHIFT + LINEAGE_JITTER + 0.5) hueTooFar++;
      shifts.push(dh);
      if (!genomeEquals(decodeGenome(encodeGenome(g)) as Genome, g)) roundTrip++;
    }
    const sorted = shifts.slice().sort((x, y) => x - y), visible = shifts.filter((x) => x >= 3).length / Math.max(1, shifts.length), ds = drift.slice().sort((x, y) => x - y);
    console.log(`   ${n} merges with real parent genomes (${tierUps} tier-ups): lineage hue tint median ${sorted[Math.floor(sorted.length / 2)] ?? 0} deg, p90 ${sorted[Math.floor(sorted.length * 0.9)] ?? 0} deg, max ${sorted[sorted.length - 1] ?? 0} deg; ${pct(visible, 0)} tinted >= 3 deg; colour distance from the species centre median ${f2(ds[Math.floor(ds.length / 2)] ?? 0)}, max ${(ds[ds.length - 1] ?? 0).toFixed(3)} OKLab`);
    check('lineage: every merge with real parent genomes is accepted and the result round-trips its share string', refusedL === 0 && roundTrip === 0 && n > 1000, `${refusedL} refused, ${roundTrip} round-trip failures`);
    check(`lineage keeps the rarity layer: Common/Uncommon results are plain, Rare-and-up results are patterned with speckle >= ${PATTERN_SPECKLE_FLOOR} (no tier-up ever comes out plain or washed out)`, patternRule === 0, `${patternRule} violations`);
    check('lineage: a tier-up keeps the result species\' own pattern; a same-tier result has its own pattern or a parent\'s', tierUpOwnPattern === 0 && sameTierPattern === 0 && tierUps > 500, `${tierUpOwnPattern} / ${sameTierPattern} violations, ${tierUps} tier-ups`);
    check('lineage never makes a result look like another species: its body colour stays nearer its own species\' centre than any other same-tier centre', foreignColour === 0, `${foreignColour} of ${n}`);
    check(`lineage tint stays inside the colour budget: the body is at most ${LINEAGE_MAX_DISTANCE} OKLab from its species' centre colour`, tooFarColour === 0, `${tooFarColour} of ${n}`);
    check(`lineage changes only the hue (by at most ${LINEAGE_MAX_SHIFT} + ${LINEAGE_JITTER} degrees) and, inside one tier, the pattern; every other field is the species instance's own`, otherFields === 0 && hueTooFar === 0, `${otherFields} field / ${hueTooFar} hue violations`);
    check('lineage stays visible where there is room: at least a third of merges with real parents carry a hue tint of 3 degrees or more', visible >= 1 / 3, pct(visible, 0));
    const tpl = speciesBaseGenome(ids(1)[0], 11);
    check('lineageGenome is deterministic, and with no parents returns the template untouched', JSON.stringify(lineageGenome(tpl, [tpl], 5)) === JSON.stringify(lineageGenome(tpl, [tpl], 5)) && lineageGenome(tpl, [], 5) === tpl);
  }
  // hostile merge input
  {
    const weird: unknown[] = [[], [null], inputsOf(null), Array.from({ length: COST }, () => ({})), Array.from({ length: COST }, () => ({ species: 'x' })), 'abc', 5, undefined, [1, 2, 3].slice(0, COST),
      Array.from({ length: COST }, () => ['dollop']), Array.from({ length: COST }, () => ({ species: '__proto__' })), Array.from({ length: COST }, () => ({ genome: { species: 'dollop', hue: 'x' } }))];
    let threw = 0; for (const w of weird) { try { pv(w as unknown[], { owned: {} }); roll(w as unknown[], 1, { owned: {} }); } catch { threw++; } }
    const badPity = [[NaN, -5, 1e9, Infinity, undefined, null, 'x', {}] as unknown as number[], undefined as unknown as number[], [] as number[]];
    let ok = true; for (const p of badPity) { try { const r = roll(inputsOf(ids(0)[0]), 1, { owned: { [ids(0)[0]]: COST + 3 }, pity: p }); if (!okRoll(r) || !r.pityAfter.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) ok = false; } catch { ok = false; } }
    const ownedWeird: unknown[] = [{ dollop: NaN }, { dollop: -3 }, { dollop: 1e300 }, new Set(['dollop']), () => COST + 1, () => NaN, {}];
    let ok2 = true; for (const o of ownedWeird) { try { pv(inputsOf('dollop'), { owned: o as never }); roll(inputsOf('dollop'), 1, { owned: o as never }); } catch { ok2 = false; } }
    let ok3 = true; for (const stt of [undefined, null, {}, { owned: undefined }, { owned: null }, { pity: 'x' }] as unknown[]) { try { pv(inputsOf('dollop'), stt as never); roll(inputsOf('dollop'), 1, stt as never); } catch { ok3 = false; } }
    check('hostile merge inputs never throw (null, junk, __proto__, broken genomes, NaN or negative pity, NaN ownership, a Set of owned ids, a missing or broken state)', threw === 0 && ok && ok2 && ok3);
  }
}
mergeSection(MERGE_COST, 1);
mergeSection(MERGE_COST === 2 ? 3 : 2, 0.25);

/* ═══════════════════════════════════ 6. the economy sim's species sets scale past 64 species ═══════════════════════════════════ */
header('6. sim_economy bitsets: any roster size (the catalog may grow to idx 255)');
{
  const cat = buildCatalog([60, 40, 20, 10, 6, 4]); // 140 species: five 32-bit words
  const tierSizesOk = cat.tierMask.every((m, t) => { let c = 0; for (let s = 0; s < cat.n; s++) if (bitsetHas(m, s)) { c++; if (cat.tierOf[s] !== t) return false; } return c === [60, 40, 20, 10, 6, 4][t]; });
  // tiers are 0-59 / 60-99 / 100-119 / 120-129 / 130-135 / 136-139. Two players who each need what the other spares in tier 2 (species 102 and 104),
  // plus spares at 70 and 134 nobody needs: with the old two-word masks species 102 aliased species 38 (1 << 70 wraps to 1 << 6 of the high word)
  const mk = (): { count: Uint16Array; lockUntil: Int16Array; lockedCopies: Uint16Array; need: Int32Array; spare: Int32Array } => ({ count: new Uint16Array(cat.n).fill(1), lockUntil: new Int16Array(cat.n), lockedCopies: new Uint16Array(cat.n), need: new Int32Array(cat.words), spare: new Int32Array(cat.words) });
  const A = mk(), B = mk();
  A.count[70] = 3; A.count[134] = 3; A.count[104] = 3; B.count[104] = 0;   // A spares 70, 104 and 134; B needs 104
  B.count[102] = 3; A.count[102] = 0;                                         // B spares 102, A needs it
  setMasks(cat, A, 0); setMasks(cat, B, 0);
  const r = swapCountCore(cat, A, B, 10, false);
  const aliasFree = !bitsetHas(A.need, 6) && !bitsetHas(A.need, 38) && bitsetHas(A.need, 102) && bitsetHas(A.spare, 70) && bitsetHas(A.spare, 104) && bitsetHas(A.spare, 134) && !bitsetHas(A.spare, 6) && !bitsetHas(A.spare, 38) && !bitsetHas(B.need, 8);
  check(`a 140-species roster uses ${cat.words} words (= ceil(140 / 32)) and every tier mask holds exactly its species`, cat.words === bitsetWords(140) && cat.words === 5 && tierSizesOk);
  check('needs and spares past index 63 never alias a lower species, and a trade is matched across the high words (A gets species 102 for species 104)', aliasFree && r.total === 1 && r.mutual === 1, `total ${r.total}, mutual ${r.mutual}`);
}

console.log(`\n${bad ? bad + ' check(s) FAILED' : 'all economy checks passed'}`);
process.exit(bad ? 1 : 0);
