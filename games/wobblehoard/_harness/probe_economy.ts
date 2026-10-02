// Economy probe: the pure logic (meter, drops, merge) against DESIGN 5.4 / 5.6 / 5.1, with real numbers and stated tolerances.
// Plain node:  node _harness/probe_economy.ts      (exit 1 on any failure; nothing is loosened to pass)
//
// Statistical checks use Z = 5 standard errors: with seeded (hence fixed) streams a pass is reproducible, and a real bug that moves a probability by
// even a few percent relative fails by a wide margin at the sample sizes below.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mulberry32 } from '../src/core/rng.ts';
import {
  createMeter, addInteraction, sanitizeMeter, capsuleThreshold, dailyRateFor, dailyStatus, meterFill, PAY, POKE_MIN_GAP_MS, FRESHNESS_FLOOR,
  VALVE_SP_PER_MINUTE, CAPSULE_RAMP, CAPSULE_COST, DAILY_FULL_RATE_CAPSULES, DAILY_REDUCED_RATE, DAILY_HARD_STOP_CAPSULES, DAY_MS, MEDLEY_COOLDOWN_MS, MAX_T_MS,
} from '../src/core/meter.ts';
import type { MeterState, TouchKind, Interaction } from '../src/core/meter.ts';
import {
  rollCapsule, capsuleGenome, restockOffer, restockDisplayOrder, isValidRestockPick, dailyTasks, claimTask, createTaskState, weekKeyOf, daySeed, makeRng, draw,
  RESTOCK_POOL, TASKS_MAX_PER_WEEK, TASKS_OFFERED_PER_DAY, TASK_DEFS, RESTOCK_OFFER_COUNT,
} from '../src/core/drops.ts';
import {
  MERGE_COST, MERGE_RULES, MERGE_TIER_UP, MERGE_PITY_AFTER, previewMerge, rollMerge, createMergePity, lineageGenome, mergeOddsCore, mergeDrawCore,
} from '../src/core/merge.ts';
import type { MergeState, MergeRollOk, MergePreviewOk } from '../src/core/merge.ts';
import { TIERS, TIER_ODDS, TIER_COUNT, TOP_TIER_INDEX, TIER_SPECIES_COUNTS, tierIndex } from '../src/core/rarity.ts';
import { CATALOG, SPECIES_BY_TIER, speciesBaseGenome } from '../src/data/catalog.ts';
import type { SpeciesId } from '../src/data/catalog.ts';
import { encodeGenome, decodeGenome, genomeEquals } from '../src/core/genome.ts';
import { BEHAV, playStream } from './sim_economy.ts';

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
check('a pull that stretched (snap intensity >= 0.35) pays 1.8 SP, one that never stretched 0.5 SP', near(one('pull', 0.35).spGained, 1.8) && near(one('pull', 0.34).spGained, 0.5) && near(one('pull', 1).spGained, 1.8));
// freshness
{
  const s1 = one('poke', 0).state;
  const at = (dtMs: number): number => addInteraction(s1, { kind: 'poke', amount: 0, tMs: T0 + dtMs }).spGained;
  check('freshness: a second poke 0.9 s later pays in full', near(at(900), 0.8));
  check('freshness: 0.45 s later pays x(0.5)^2 = 0.25', near(at(450), 0.2));
  check('freshness: 0.3 s later pays x(1/3)^2', near(at(300), 0.8 / 9));
  check(`double-tap gate: a poke under ${POKE_MIN_GAP_MS} ms after the last poke pays nothing`, at(100) === 0 && addInteraction(s1, { kind: 'poke', amount: 0, tMs: T0 + 100 }).detail.doubleTap);
  check('freshness floor is 0.03', near(FRESHNESS_FLOOR, 0.03));
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
/** SP per minute of a fixed-interval single-kind stream for 60 s through the real meter. */
function metronome(kind: TouchKind, intervalMs: number, seconds = 60, amount = kind === 'squeeze' ? 1 : kind === 'pull' ? 1 : 0): { perMin: number; maxWindow: number } {
  let s = createMeter(), t = T0, total = 0;
  const log: Array<[number, number]> = [];
  for (; t < T0 + seconds * 1000; t += intervalMs) { const r = addInteraction(s, { kind, amount, tMs: t, dayKey: 0 }); s = r.state; total += r.spGained; if (r.spGained > 0) log.push([t, r.spGained]); }
  let mx = 0, lo = 0, acc = 0;
  for (let i = 0; i < log.length; i++) { acc += log[i][1]; while (log[i][0] - log[lo][0] > 60000) acc -= log[lo++][1]; mx = Math.max(mx, acc); }
  return { perMin: total / (seconds / 60), maxWindow: mx };
}
console.log('single-kind pokes at a fixed rate (SP/min, share of the varied human):');
const rates = [12, 10, 8, 6, 5, 4, 3, 2, 1.1];
const mashRows = rates.map((hz) => { const m = metronome('poke', 1000 / hz); return { hz, ...m }; });
for (const r of mashRows) console.log(`   ${String(r.hz).padStart(4)} pokes/s: ${f2(r.perMin).padStart(6)} SP/min = ${pct(r.perMin / varied, 0).padStart(4)} of varied play${r.hz >= 5 ? '' : r.hz > 2 ? '   (informational: a scripted macro, not mashing)' : '   (a paced clicker is just playing; the valve and the daily cap bound it)'}`);
check('MASHING earns at most 45% of varied play per minute (any rate of 5 to 12 pokes a second)', mashRows.filter((r) => r.hz >= 5).every((r) => r.perMin <= 0.45 * varied), `worst ${f2(Math.max(...mashRows.filter((r) => r.hz >= 5).map((r) => r.perMin)))} SP/min = ${pct(Math.max(...mashRows.filter((r) => r.hz >= 5).map((r) => r.perMin)) / varied, 1)}`);
check('mashing squeezes (every 0.3 s) or pulls (every 0.3 s) is also worthless (<= 45%)', ['squeeze', 'pull'].every((k) => metronome(k as TouchKind, 300).perMin <= 0.45 * varied), `squeeze ${f2(metronome('squeeze', 300).perMin)}, pull ${f2(metronome('pull', 300).perMin)} SP/min`);
check('no single-kind stream, at any pace, is paid more than the valve (40 SP/min), and no 60 s window ever exceeds 40 SP', [250, 300, 500, 900, 1000, 1500, 2400, 3000].every((ms) => (['poke', 'squeeze', 'pull'] as TouchKind[]).every((k) => { const m = metronome(k, ms, 300); return m.perMin <= VALVE_SP_PER_MINUTE + 1e-6 && m.maxWindow <= VALVE_SP_PER_MINUTE + 1e-6; })));
{
  // poke-squeeze-pull cycler at the physical limit (the sim's 'cycle' bot): should ride the valve
  const rng = mulberry32(99);
  const cyc = playStream(BEHAV[0], rng, 600, 'cycle');
  check('a poke-squeeze-pull cycler at the physical limit reaches the valve and no more (about 40 SP/min)', cyc.sp / 10 >= 38 && cyc.sp / 10 <= 40.0001, `${f2(cyc.sp / 10)} SP/min`);
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

/* ═══════════════════════════════════ 3. meter: JSON, hostile input ═══════════════════════════════════ */
header('3. meter: JSON round trip, hostile inputs, invariants');
{
  const rng = mulberry32(2024);
  const kinds: TouchKind[] = ['poke', 'squeeze', 'pull'];
  const evs: Interaction[] = []; let t = T0;
  for (let i = 0; i < 3000; i++) { t += Math.floor(100 + rng() * 2500); const k = kinds[Math.floor(rng() * 3)]; evs.push({ kind: k, amount: k === 'squeeze' ? rng() * 4 : k === 'pull' ? rng() : 0, tMs: t }); }
  let a = createMeter(), b = createMeter(), same = true, caps = 0;
  for (let i = 0; i < evs.length; i++) {
    const ra = addInteraction(a, evs[i]);
    b = JSON.parse(JSON.stringify(b)) as MeterState;           // the second machine round-trips its state through JSON before every call
    const rb = addInteraction(b, evs[i]);
    if (ra.spGained !== rb.spGained || ra.capsulesEarned !== rb.capsulesEarned || JSON.stringify(ra.state) !== JSON.stringify(rb.state)) { same = false; break; }
    a = ra.state; b = rb.state; caps += ra.capsulesEarned;
  }
  check('state survives JSON round-trip before every call (bit-identical results over 3000 touches)', same, `${caps} capsules`);
  check('sanitizeMeter(state) is the identity on a valid state, and tolerates garbage', JSON.stringify(sanitizeMeter(JSON.parse(JSON.stringify(a)))) === JSON.stringify(a) && [null, undefined, 5, 'x', {}, [], { v: 1, sp: 'x', earned: -4 }, { v: 2 }].every((g) => { const s = sanitizeMeter(g); return s.v === 1 && Number.isFinite(s.sp) && s.sp >= 0; }));
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
    const ev = (hostile ? { kind: pick(kindsAll), amount: pick(wild), tMs: rng() < 0.3 ? pick(wild) : tNow, dayKey: rng() < 0.2 ? pick(wild) : undefined } : { kind: pick(['poke', 'squeeze', 'pull']), amount: rng() * 4, tMs: tNow }) as unknown as Interaction;
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
  check('40000 random and hostile calls (NaN, Infinity, negative, 1e300, unknown kinds, null) never throw', threw === 0);
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
  const rng = mulberry32(5); const r1 = rollCapsule(rng); const draw1 = [mulberry32(5)()];
  check('draw order is fixed: exactly 3 draws per capsule (tier, species, genome seed)', (() => { const x = mulberry32(9), y = mulberry32(9); rollCapsule(x); y(); y(); y(); return x() === y(); })() && draw1.length === 1 && r1.genomeSeed >= 0);
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
header('5. merge (DESIGN 5.6): rules, odds, determinism');
const src = (rel: string): string => readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), rel), 'utf8');
{
  const defs = ['../src/core/merge.ts', '../src/core/meter.ts', '../src/core/drops.ts', '../src/data/catalog.ts', './sim_economy.ts'].map((f) => (src(f).match(/\bconst MERGE_COST\s*=/g) ?? []).length);
  check('MERGE_COST is defined exactly once, in src/core/merge.ts, as a single literal', defs.join() === '1,0,0,0,0' && /export const MERGE_COST = \d+;/.test(src('../src/core/merge.ts')), `value ${MERGE_COST}`);
  check('MERGE_COST is 2 (the owner\'s rule: 3.1 to 3.8 active minutes per capsule is the decent-effort band)', MERGE_COST === 2);
  check('tier-up table 30 / 25 / 20 / 15 / 10 percent, Mythic cannot merge; unowned weight 1.5; pity after 4', MERGE_TIER_UP.join() === '0.3,0.25,0.2,0.15,0.1,0' && MERGE_RULES.unownedWeight === 1.5 && MERGE_PITY_AFTER === 4 && MERGE_RULES.pityAfter === 4);
}
const ids = (t: number): SpeciesId[] => SPECIES_BY_TIER[t].map((d) => d.id);
const ownedAll = (): Record<string, number> => Object.fromEntries(CATALOG.map((d) => [d.id, 3]));
const inputsOf = (id: SpeciesId, n = MERGE_COST): SpeciesId[] => new Array(n).fill(id);
{
  // validation
  const st: MergeState = { owned: ownedAll(), pity: createMergePity() };
  const err = (inp: unknown[], s: MergeState = st): string => { const r = previewMerge(inp as never, s); return r.ok ? 'ok' : r.error; };
  check('invalid selections are refused with a reason: wrong count, mixed species, unknown species, Mythic, not enough copies',
    err([ids(0)[0]]) === 'wrong-count' && err(new Array(MERGE_COST + 1).fill(ids(0)[0])) === 'wrong-count' && err([ids(0)[0], ids(0)[1]]) === 'mixed-species' && err([ids(0)[0], 'nope']) === 'unknown-species'
    && err(inputsOf(ids(5)[0])) === 'mythic-cannot-merge' && err(inputsOf(ids(0)[0]), { owned: { [ids(0)[0]]: MERGE_COST - 1 } }) === 'not-enough-copies' && err(null as never) === 'wrong-count' && err([null, null]) === 'unknown-species');
  check('a refused roll consumes no randomness and returns { ok: false }', (() => { const r = mulberry32(1), q = mulberry32(1); const out = rollMerge(inputsOf(ids(5)[0]), r, st); const first = q(); return !out.ok && r() === first; })());
  check('a Mythic cannot merge: refused for all three Mythic species', ids(5).every((id) => { const r = rollMerge(inputsOf(id), 1, st); return !r.ok && r.error === 'mythic-cannot-merge'; }));
  check('inputs may be species ids, {species}, or {genome}', previewMerge([{ species: 'dollop' }, { species: 'dollop' }].slice(0, MERGE_COST) as never, st).ok && previewMerge(Array.from({ length: MERGE_COST }, () => ({ genome: speciesBaseGenome('dollop', 1) })) as never, st).ok);
}
// invariants over random states
{
  const rng = mulberry32(31337);
  let lower = 0, same = 0, total = 0, bad3 = 0, finishedUp = 0, finishedTotal = 0, pityOk = true, neverMore4 = true;
  const upByTier = new Array(TOP_TIER_INDEX).fill(0), nByTier = new Array(TOP_TIER_INDEX).fill(0);
  for (let i = 0; i < 300000; i++) {
    const t = Math.floor(rng() * TOP_TIER_INDEX), list = SPECIES_BY_TIER[t];
    const input = list[Math.floor(rng() * list.length)].id;
    // random ownership: each species owned with probability q, the input at least MERGE_COST copies
    const q = rng() < 0.2 ? 1 : rng(); const owned: Record<string, number> = {};
    for (const d of CATALOG) if (rng() < q) owned[d.id] = 1 + Math.floor(rng() * 3);
    owned[input] = MERGE_COST + Math.floor(rng() * 2);
    const pity = createMergePity(); for (let k = 0; k < TIER_COUNT; k++) pity[k] = Math.floor(rng() * 7);
    const r = rollMerge(inputsOf(input), rng, { owned, pity }) as MergeRollOk;
    total++;
    if (!r.ok) { bad3++; continue; }
    const outT = tierIndex(r.outcome.tier);
    if (outT < t) lower++;
    if (r.outcome.species === input) same++;
    if (outT !== t && outT !== t + 1) bad3++;
    if (r.outcome.tierUp !== (outT === t + 1)) bad3++;
    if (r.outcome.isNew !== !(owned[r.outcome.species] > 0)) bad3++;
    if (r.odds.finishedRow) { finishedTotal++; if (r.outcome.tierUp) finishedUp++; }
    if (pity[t] >= MERGE_PITY_AFTER && !r.outcome.tierUp) pityOk = false;
    // pity bookkeeping
    for (let k = 0; k < TIER_COUNT; k++) { const expect = k === t ? (r.outcome.tierUp ? 0 : pity[k] + 1) : pity[k]; if (r.pityAfter[k] !== expect) pityOk = false; }
    if (!r.outcome.tierUp && !r.odds.finishedRow) { upByTier[t] += 0; }
    nByTier[t]++;
  }
  check(`merge never returns a lower tier (${total} random merges, random ownership and pity)`, lower === 0);
  check('merge never returns the input species', same === 0);
  check('merge returns the input tier or exactly one above, tierUp flag is consistent, isNew is exact', bad3 === 0);
  check('FINISHED ROW: when you own every other species of the input tier the merge ALWAYS tiers up', finishedTotal > 1000 && finishedUp === finishedTotal, `${finishedUp}/${finishedTotal}`);
  check(`PITY: a pity counter of ${MERGE_PITY_AFTER} or more always tiers up; counters reset on a tier-up, grow by one on a dud, and only the input tier's counter changes`, pityOk);
}
// finished row, tier by tier, explicitly (the row owned, including the input)
{
  const ok: boolean[] = [];
  for (let t = 0; t < TOP_TIER_INDEX; t++) {
    let up = 0; const n = 4000;
    const owned: Record<string, number> = {}; for (const id of ids(t)) owned[id] = 2; owned[ids(t)[0]] = 5;
    for (let i = 0; i < n; i++) { const r = rollMerge(inputsOf(ids(t)[i % ids(t).length]), 100000 + i, { owned, pity: createMergePity() }) as MergeRollOk; if (r.outcome.tierUp && r.reason === 'finished-row') up++; }
    ok.push(up === n);
  }
  check('finished row, every merge tier Common..Legendary: 100% tier-up with reason "finished-row"', ok.every(Boolean));
}
// tier-up frequencies vs DESIGN
{
  const NN = 400000;
  console.log('merge tier-up frequency, unfinished row (a player who owns only the input species):');
  console.log('tier       | table | pity off: observed | real rules (pity on): observed | analytic (pity on) | tolerance');
  const rowsOk: boolean[] = [], rowsOk2: boolean[] = [];
  for (let t = 0; t < TOP_TIER_INDEX; t++) {
    const input = ids(t)[0];
    const owned = { [input]: MERGE_COST + 1 };
    const p = MERGE_TIER_UP[t];
    // (a) pity off: independent merges at the table chance
    const rng = mulberry32(1000 + t);
    let up = 0;
    const noPity = { ...MERGE_RULES, pityAfter: 0 };
    for (let i = 0; i < NN; i++) { const r = rollMerge(inputsOf(input), rng, { owned, pity: createMergePity() }, noPity) as MergeRollOk; if (r.outcome.tierUp) up++; }
    // (b) real rules: chain of merges carrying the pity counter
    let pity = createMergePity(), up2 = 0, run = 0, maxRun = 0;
    const rng2 = mulberry32(2000 + t);
    for (let i = 0; i < NN; i++) { const r = rollMerge(inputsOf(input), rng2, { owned, pity }) as MergeRollOk; pity = r.pityAfter; if (r.outcome.tierUp) { up2++; run = 0; } else { run++; if (run > maxRun) maxRun = run; } }
    let E = 0; for (let k = 0; k <= MERGE_PITY_AFTER; k++) E += (1 - p) ** k;
    const analytic = 1 / E;
    console.log(`${TIERS[t].padEnd(10)} | ${pct(p, 0).padStart(5)} | ${pct(up / NN, 2).padStart(18)} | ${pct(up2 / NN, 2).padStart(30)} | ${pct(analytic, 2).padStart(18)} | +-${pct(Z * se(p, NN), 2)} (max dud run ${maxRun})`);
    rowsOk.push(zOk(up / NN, p, NN));
    rowsOk2.push(zOk(up2 / NN, analytic, NN) && maxRun <= MERGE_PITY_AFTER);
  }
  check('tier-up chance per input tier matches DESIGN 5.6 (Common 30, Uncommon 25, Rare 20, Epic 15, Legendary 10 percent) within 5 standard errors', rowsOk.every(Boolean));
  check(`with pity on, the long-run tier-up rate is 1 / (1 + q + ... + q^${MERGE_PITY_AFTER}) as the Markov chain says, and a run of duds is never longer than ${MERGE_PITY_AFTER}`, rowsOk2.every(Boolean));
}
// outcome distribution vs the preview odds (several states)
{
  const cases: Array<[string, MergeState, SpeciesId]> = [];
  const half: Record<string, number> = {}; ids(2).forEach((id, i) => { if (i % 2 === 0) half[id] = 2; }); ids(3).forEach((id, i) => { if (i < 2) half[id] = 1; }); half[ids(2)[1]] = 4;
  cases.push(['Rare, half of Rare and 2 of 7 Epic owned', { owned: half, pity: createMergePity() }, ids(2)[1]]);
  const none: Record<string, number> = { [ids(0)[0]]: 3 };
  cases.push(['Common, nothing else owned', { owned: none, pity: createMergePity() }, ids(0)[0]]);
  const fin: Record<string, number> = {}; ids(3).forEach((id) => { fin[id] = 1; }); fin[ids(3)[2]] = 3; ids(4).forEach((id, i) => { if (i < 3) fin[id] = 1; });
  cases.push(['Epic row finished, 3 of 5 Legendary owned', { owned: fin, pity: createMergePity() }, ids(3)[2]]);
  const pit: Record<string, number> = { [ids(1)[3]]: 2 };
  cases.push(['Uncommon with pity due', { owned: pit, pity: [0, 4, 0, 0, 0, 0] }, ids(1)[3]]);
  const NN = 300000;
  let allOk = true, worst = 0, worstWhere = '';
  for (const [name, st, input] of cases) {
    const pv = previewMerge(inputsOf(input), st) as MergePreviewOk;
    const sum = pv.outcomes.reduce((a, o) => a + o.probability, 0);
    if (Math.abs(sum - 1) > 1e-12) { allOk = false; worstWhere = name + ' sum'; }
    const counts: Record<string, number> = {};
    const rng = mulberry32(555);
    for (let i = 0; i < NN; i++) { const r = rollMerge(inputsOf(input), rng, st) as MergeRollOk; counts[r.outcome.species] = (counts[r.outcome.species] ?? 0) + 1; }
    for (const o of pv.outcomes) { const z = Math.abs((counts[o.species] ?? 0) / NN - o.probability) / se(Math.max(o.probability, 1e-9), NN); if (z > worst) { worst = z; worstWhere = `${name}: ${o.species}`; } if (z > Z) allOk = false; }
    if (Object.keys(counts).some((k) => !pv.outcomes.some((o) => o.species === k))) allOk = false;
    console.log(`   ${name}: tier-up ${pct(pv.tierUpChance, 1)} (${pv.basis}), lacking ${pv.lackingInTier} in tier / ${pv.lackingInNextTier} in next, ${pv.outcomes.length} possible results`);
  }
  check('the preview odds are exact: every possible result is observed at its previewed probability (5 s.e.), nothing else ever appears, probabilities sum to 1', allOk, `worst ${f2(worst)} s.e. (${worstWhere})`);
  // species weights: unowned x1.5
  const st = cases[0][1], pv = previewMerge(inputsOf(cases[0][2]), st) as MergePreviewOk;
  const stay = pv.outcomes.filter((o) => o.tier === pv.stayTier), own = stay.find((o) => !o.isNew), nw = stay.find((o) => o.isNew);
  check('species you do not own are weighted x1.5 against owned ones (previewed probability ratio 1.5)', !!own && !!nw && near(nw.probability / own.probability, 1.5, 1e-9));
  check('the preview names how many species you still lack in the output tier and the next tier', pv.lackingInTier === stay.filter((o) => o.isNew).length && pv.lackingInNextTier === pv.outcomes.filter((o) => o.tier === pv.upTier && o.isNew).length && pv.lackingInNextTier === 5);
  const last = previewMerge(inputsOf(ids(0)[0]), { owned: { [ids(0)[0]]: MERGE_COST } }) as MergePreviewOk, more = previewMerge(inputsOf(ids(0)[0]), { owned: { [ids(0)[0]]: MERGE_COST + 1 } }) as MergePreviewOk;
  check('the preview warns when the merge uses your last copy', last.usesLastCopy && !more.usesLastCopy && last.copiesOwned === MERGE_COST);
  const p0 = previewMerge(inputsOf(ids(0)[0]), { owned: none, pity: [0, 0, 0, 0, 0, 0] }) as MergePreviewOk, p3 = previewMerge(inputsOf(ids(0)[0]), { owned: none, pity: [3, 0, 0, 0, 0, 0] }) as MergePreviewOk, p4 = previewMerge(inputsOf(ids(0)[0]), { owned: none, pity: [4, 0, 0, 0, 0, 0] }) as MergePreviewOk;
  check('the preview counts down to pity: duds until pity 4, 1, then due (tier-up chance shown as 100%)', p0.dudsUntilPity === 4 && p3.dudsUntilPity === 1 && p4.pityDue && p4.tierUpChance === 1 && p4.basis === 'pity' && p0.basis === 'table' && p0.tierUpChance === 0.3);
}
// determinism, audit fields, immutability
{
  const st: MergeState = { owned: { [ids(1)[0]]: 3, [ids(1)[1]]: 1 }, pity: createMergePity() };
  const a = rollMerge(inputsOf(ids(1)[0]), 7, st), b = rollMerge(inputsOf(ids(1)[0]), 7, st), c = rollMerge(inputsOf(ids(1)[0]), 'seed-7', st), d = rollMerge(inputsOf(ids(1)[0]), 'seed-7', st);
  check('rollMerge is deterministic: same seed (number, string or rng function) and state => identical result', JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(c) === JSON.stringify(d) && JSON.stringify(rollMerge(inputsOf(ids(1)[0]), mulberry32(7), st)) === JSON.stringify(a));
  const ra = a as MergeRollOk;
  const m = mulberry32(7); const u = [m(), m(), m()];
  check('the result carries the draws used (tier-up roll, species roll, genome seed) in order, for audit and replay', ra.draws.join() === u.join() && ra.outcome.genomeSeed === Math.floor(u[2] * 4294967296) >>> 0);
  check('the result carries everything to animate and audit: outcome, tier-up flag, the odds used, the pity counter after, the consumed species', ra.ok && ra.inputs.length === MERGE_COST && typeof ra.odds.tierUpChance === 'number' && Array.isArray(ra.pityAfter) && ra.pityAfter.length === TIER_COUNT && typeof ra.pityCounterAfter === 'number' && ['roll', 'finished-row', 'pity', 'stay'].includes(ra.reason) && ra.odds.outcomes.length > 0);
  check('different seeds give different merges', new Set(Array.from({ length: 200 }, (_, i) => (rollMerge(inputsOf(ids(1)[0]), i, st) as MergeRollOk).outcome.species + (rollMerge(inputsOf(ids(1)[0]), i, st) as MergeRollOk).outcome.genomeSeed)).size > 150);
  const frozen: MergeState = Object.freeze({ owned: Object.freeze({ [ids(1)[0]]: 3 }), pity: Object.freeze([0, 1, 2, 3, 0, 0]) as readonly number[] });
  let threw = false; try { rollMerge(inputsOf(ids(1)[0]), 3, frozen); previewMerge(inputsOf(ids(1)[0]), frozen); } catch { threw = true; }
  check('rollMerge / previewMerge never mutate their arguments (frozen state works)', !threw);
  check('the core is the same function the simulation calls: mergeOddsCore + mergeDrawCore reproduce rollMerge', (() => {
    const roster = SPECIES_BY_TIER.map((l) => l.map((x) => x.idx)); const input = CATALOG.find((x) => x.id === ids(1)[0])!.idx;
    const odds = mergeOddsCore({ tier: 1, self: input, roster, copies: (h) => (st.owned as Record<string, number>)[CATALOG[h].id] ?? 0, pity: 0, rules: MERGE_RULES });
    const r = mergeDrawCore(odds, ra.draws[0], ra.draws[1]);
    return CATALOG[r.out].id === ra.outcome.species && r.tierUp === ra.outcome.tierUp;
  })());
}
// lineage
{
  const pa = speciesBaseGenome(ids(1)[0], 11), pb = speciesBaseGenome(ids(1)[0], 12);
  const r = rollMerge([{ species: pa.species, genome: pa }, { species: pb.species, genome: pb }].slice(0, MERGE_COST) as never, 99, { owned: { [pa.species]: 2 }, pity: createMergePity() }) as MergeRollOk;
  const tpl = speciesBaseGenome(r.outcome.species, r.outcome.genomeSeed), g = r.outcome.genome;
  const dh = Math.abs(((g.hue - tpl.hue + 540) % 360) - 180);
  check('the merge result keeps its species and quantised genome, with the parents\' hue and pattern mixed in (hue moves at most 38 degrees)', g.species === r.outcome.species && dh <= 38 && genomeEquals(decodeGenome(encodeGenome(g)) as never, g) && g.coreHue === tpl.coreHue && g.eyeStyle === tpl.eyeStyle);
  const lg1 = lineageGenome(tpl, [pa, pb], 5), lg2 = lineageGenome(tpl, [pa, pb], 5);
  check('lineageGenome is deterministic, and with no parents returns the template untouched', JSON.stringify(lg1) === JSON.stringify(lg2) && lineageGenome(tpl, [], 5) === tpl);
  const warm = { ...pa, hue: 20 }, other = speciesBaseGenome('twangle', 3);
  const mix = lineageGenome({ ...other, hue: 200 }, [warm, warm], 8);
  check('lineage colours are visible: a template at hue 200 with two parents at hue 20 shifts 35 degrees toward them (and no further)', Math.abs(((mix.hue - 200 + 540) % 360) - 180) >= 30 && Math.abs(((mix.hue - 200 + 540) % 360) - 180) <= 38);
}
// hostile merge input
{
  const weird: unknown[] = [[], [null], [null, null], [{}, {}], [{ species: 'x' }, { species: 'x' }], 'abc', 5, undefined, [1, 2], [['dollop'], ['dollop']], [{ species: '__proto__' }, { species: '__proto__' }]];
  let threw = 0; for (const w of weird) { try { previewMerge(w as never, { owned: {} }); rollMerge(w as never, 1, { owned: {} }); } catch { threw++; } }
  const badPity = [[NaN, -5, 1e9, Infinity, undefined, null, 'x', {}] as unknown as number[], undefined as unknown as number[], [] as number[]];
  let ok = true; for (const p of badPity) { try { const r = rollMerge(inputsOf(ids(0)[0]), 1, { owned: { [ids(0)[0]]: 5 }, pity: p }) as MergeRollOk; if (!r.ok || !r.pityAfter.every((x) => Number.isInteger(x) && x >= 0 && x <= 255)) ok = false; } catch { ok = false; } }
  const ownedWeird: unknown[] = [{ dollop: NaN }, { dollop: -3 }, { dollop: 1e300 }, new Set(['dollop']), () => 3, () => NaN, {}];
  let ok2 = true; for (const o of ownedWeird) { try { previewMerge(inputsOf('dollop'), { owned: o as never }); rollMerge(inputsOf('dollop'), 1, { owned: o as never }); } catch { ok2 = false; } }
  let ok3 = true; for (const stt of [undefined, null, {}, { owned: undefined }, { owned: null }, { pity: 'x' }] as unknown[]) { try { previewMerge(inputsOf('dollop'), stt as never); rollMerge(inputsOf('dollop'), 1, stt as never); } catch { ok3 = false; } }
  check('hostile merge inputs never throw (null, junk, __proto__, NaN or negative pity, NaN ownership, a Set of owned ids, a missing or broken state)', threw === 0 && ok && ok2 && ok3);
}
// flipping MERGE_COST to 3 keeps everything meaningful: the same logic with an explicit cost of 3
{
  const COST = 3;
  const st: MergeState = { owned: { [ids(2)[0]]: 5 }, pity: createMergePity() };
  const two = previewMerge(inputsOf(ids(2)[0], 2), st, MERGE_RULES, COST), three = previewMerge(inputsOf(ids(2)[0], 3), st, MERGE_RULES, COST);
  check('with a cost of 3 the same rules apply: 3 inputs required, 2 refused, odds unchanged by the cost', !two.ok && two.error === 'wrong-count' && three.ok && (three as MergePreviewOk).tierUpChance === 0.2 && (three as MergePreviewOk).cost === 3);
  const NN = 200000, rng = mulberry32(4242); let up = 0;
  for (let i = 0; i < NN; i++) { const r = rollMerge(inputsOf(ids(2)[0], 3), rng, { owned: { [ids(2)[0]]: 3 }, pity: createMergePity() }, { ...MERGE_RULES, pityAfter: 0 }, COST) as MergeRollOk; if (r.outcome.tierUp) up++; }
  check('cost 3: tier-up chance is still the table chance (20% for Rare) within 5 s.e.', zOk(up / NN, 0.2, NN));
  check('cost 3: not enough copies is judged against the cost (owning 2 of 3 is refused)', (previewMerge(inputsOf(ids(2)[0], 3), { owned: { [ids(2)[0]]: 2 } }, MERGE_RULES, COST) as { error?: string }).error === 'not-enough-copies');
  check('probe_economy derives its inputs from MERGE_COST, so flipping the constant keeps these checks meaningful', inputsOf(ids(0)[0]).length === MERGE_COST);
}

console.log(`\n${bad ? bad + ' check(s) FAILED' : 'all economy checks passed'}`);
process.exit(bad ? 1 : 0);
