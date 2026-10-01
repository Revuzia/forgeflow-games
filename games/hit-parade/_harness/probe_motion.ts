// probe_motion (G2, lane SIM): input parsing from the history ring stored IN the state
// (CONTRACT §4.3.9, §4.4, §19.1-2). Unit tests of every motion (window edges, DP shortcuts, 360
// cardinals, 236236 leniency, charge 45/keep 10, 22, 66/44), SOCD neutral, facing-relative motions,
// priority (super > DP > QC, EX via S, meter fall-through), negative edge, buffers (4 CLASSIC /
// 7 SIMPLE early), SIMPLE routing (5S/6S/2S/4S, S+H, S+H+down, ASSIST+S = EX, x0.8), chords
// (L+M throw, M+H parry), hitstop frames do not age a motion.
// CHANGED(fix_input) (CONTRACT §35.24): rekka / follow-up trigger ranking (SIMPLE exact > class > the neutral "5S"; a fresh
// motion beats a leftover one; overlapping motions by priority; target-combo exact direction), the negative-edge rules (a
// release never overwrites a pressed chain / follow-up, never re-reads the running move's special) - parser level on a
// fixture kit with a synthetic rekka, end to end on the REAL kits (Patch CUE 1 > 2 > 3 in SIMPLE and CLASSIC, typed in the
// parents' hitstop and after; Johnny's WEAVE counter; every kit's trigger sets; no special restarts itself on a release;
// the stance follow-ups).
import { readFileSync } from 'node:fs';
import { fixtureData, newMatch, place, run, fs, I, tester, dirBits, motion, sb, ROOT, PROBE_AXIS_DEG } from './fixtures/simkit.ts';
import { step, devSet, readFighter } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { MO, STK, UK } from '../runtime/src/core/sim/compile.ts';
import type { CMove } from '../runtime/src/core/sim/compile.ts';
import { motionDone, motionSpan, dashDone, H_FROZEN } from '../runtime/src/core/sim/motion.ts';
import { dirOf, parseAction, recordInput } from '../runtime/src/core/sim/inputs.ts';
import { ACT, BUF, F, HIST, ST } from '../runtime/src/core/sim/layout.ts';
import { buildGameData, loadGameData } from '../runtime/src/core/data.ts';
import type { GameData } from '../runtime/src/core/types.ts';

const t = tester('probe_motion');
const data = fixtureData();
const W8 = data.system.motion;

// ------------------------------------------------------------------ unit: motion parser on a written ring
const mu = newMatch();
const b0 = sb(0);
function feed(seq: (number | [number, boolean])[]): void {
  for (let h = 0; h < HIST; h++) mu.s[b0 + F.hist + h] = 0;
  let head = 0;
  for (const e of seq) {
    const [d, frz] = typeof e === 'number' ? [e, false] : e;
    head = (head + 1) % HIST;
    mu.s[b0 + F.hist + head] = d | (frz ? H_FROZEN : 0);
  }
  mu.s[b0 + F.hHead] = head;
}
function rep(d: number, n: number): number[] {
  return Array.from({ length: n }, () => d);
}
function md(seq: (number | [number, boolean])[], code: number): boolean {
  feed(seq);
  return motionDone(mu.s, b0, code, W8);
}
t.ok(md([5, 2, 3, 6], MO.QCF), '236 = QCF');
t.ok(!md([5, 2, 6], MO.QCF), '26 (no diagonal) is not QCF');
t.ok(md([...rep(2, 5), ...rep(3, 3), ...rep(6, 3)], MO.QCF), 'QCF spread over 11 frames');
t.ok(!md([2, ...rep(3, 8), ...rep(6, 3)], MO.QCF), 'QCF whose 2 is 12 frames old fails (window 11)');
t.ok(md([2, 1, 4], MO.QCB), '214 = QCB');
t.ok(md([6, 2, 3], MO.DP), '623 = DP');
t.ok(md([3, 2, 3], MO.DP), '323 shortcut = DP');
t.ok(md([6, 2, 3, 6], MO.DP), '6236 shortcut = DP');
t.ok(!md([6, 3], MO.DP), '63 is not DP');
t.ok(md([4, 2, 1], MO.RDP), '421 = reverse DP');
t.ok(md([4, 1, 2, 3, 6], MO.HCF), '41236 = HCF');
t.ok(md([...rep(4, 4), 1, 2, 3, ...rep(6, 5)], MO.HCF), 'HCF within 12 frames');
t.ok(!md([4, ...rep(1, 6), 2, 3, ...rep(6, 5)], MO.HCF), 'HCF whose 4 is 14 frames old fails (window 12)');
t.ok(md([6, 3, 2, 1, 4], MO.HCB), '63214 = HCB');
t.ok(md([6, 3, 2, 1, 4], MO.SPD), '63214 has 3 cardinals = 360');
t.ok(md([4, 7, 8, 9, 6], MO.SPD), '47896 (4, 8, 6) = 360');
t.ok(!md([6, 3, 2], MO.SPD), 'two cardinals is not 360');
t.ok(md([4, ...rep(5, 28), 2, 6], MO.SPD), '360 inside 32 frames');
t.ok(!md([4, ...rep(5, 30), 2, 6], MO.SPD), '360 whose first cardinal is 33 frames old fails');
t.ok(md([2, 3, 6, 2, 3, 6], MO.DQCF), '236236 = double QCF');
t.ok(md([2, 6, 2, 6], MO.DQCF), '2626 leniency = double QCF');
t.ok(!md([2, 3, 6], MO.DQCF), 'single QCF is not double');
t.ok(!md([2, ...rep(3, 13), 6, 2, 3, ...rep(6, 4)], MO.DQCF), 'double QCF over 21 frames fails (window 20)');
t.ok(md([2, 1, 4, 2, 1, 4], MO.DQCB), '214214 = double QCB');
t.ok(md([2, 5, 2], MO.DD), '22 (2, neutral, 2)');
t.ok(!md([2, 2, 2], MO.DD), 'held 2 is not 22');
t.ok(md([[2, false], ...rep(5, 0), [2, true], [3, true], ...Array.from({ length: 12 }, (): [number, boolean] => [3, true]), 6], MO.QCF), 'hitstop (frozen) frames do not age a motion');
t.ok(!md([2, 3, ...rep(3, 12), 6], MO.QCF), 'the same timing without hitstop is too slow');
// dashes
function dd(seq: number[], want: number): boolean {
  feed(seq);
  return dashDone(mu.s, b0, want, data.system.movement.dashTapMax, data.system.movement.dashGapMax);
}
t.ok(dd([5, 6, 5, 6], 6), '6 5 6 = forward dash');
t.ok(dd([5, ...rep(6, 8), ...rep(5, 8), 6], 6), 'dash with an 8-frame tap and an 8-frame gap');
t.ok(!dd([5, ...rep(6, 9), 5, 6], 6), 'tap held 9 frames is not a dash');
t.ok(!dd([5, 6, ...rep(5, 9), 6], 6), 'gap of 9 frames is not a dash');
t.ok(!dd([5, 6, 6, 6], 6), 'holding forward is not a dash');
t.ok(dd([5, 4, 5, 4], 4), '4 5 4 = back dash');
// SOCD + facing
t.eq(dirOf(I.L_ | I.R_, 1), 5, 'SOCD: left + right = neutral');
t.eq(dirOf(I.U | I.D, 1), 5, 'SOCD: up + down = neutral');
t.eq(dirOf(I.R_, 1), 6, 'right = forward when facing +X');
t.eq(dirOf(I.R_, -1), 4, 'right = back when facing -X');
t.eq(dirOf(I.D | I.L_, -1), 3, 'down-left = down-forward when facing -X');

// ------------------------------------------------------------------ end-to-end routing
function at(x0: number, x1: number, o = {}): Match {
  const m = newMatch(o);
  place(m, x0, x1);
  run(m, 2, 0, 0);
  return m;
}
function nameAfter(m: Match, i: number, seq: string, btn: number): string {
  motion(m, i, seq, btn);
  return fs(m, i).moveName;
}
{
  const m = at(-3, 3, { p2: 'kit_a' });
  t.eq(nameAfter(m, 1, '236', I.M) === 'brickbat_m' ? 1 : 0, 1, 'P2 (facing -X): 236 is read facing-relative');
}
{
  const m = at(-3, 3);
  t.ok(nameAfter(m, 0, '6236', I.L) === 'upper_l', '6236+L: DP beats QCF');
  const m2 = at(-3, 3);
  devSet(m2, 0, 'showtime', 10000);
  t.ok(nameAfter(m2, 0, '236236', I.L) === 'sold_out', '236236+L with a bar: super beats QCF');
  const m3 = at(-3, 3);
  t.ok(nameAfter(m3, 0, '236236', I.L) === 'upper_l', '236236+L without a bar: falls through by priority (it contains 623 -> DP before QC)');
  const m4 = at(-3, 3);
  t.ok(nameAfter(m4, 0, '236', I.S) === 'brickbat_ex', 'CLASSIC 236+S = EX');
}
{
  // negative edge: hold L (5L), motion, release L -> special
  const m = at(-3, 3);
  step(m, I.L, 0);
  run(m, 18, I.L, 0);
  for (const d of [2, 3, 6]) step(m, dirBits(m, 0, d) | I.L, 0);
  step(m, dirBits(m, 0, 6), 0);
  t.ok(fs(m, 0).moveName === 'brickbat_l', 'negative edge: releasing L after 236 = 236L', fs(m, 0).moveName);
  const m2 = at(-3, 3);
  step(m2, I.L, 0);
  run(m2, 18, I.L, 0);
  step(m2, 0, 0);
  t.ok(fs(m2, 0).moveName === '', 'negative edge never triggers normals');
}
{
  // charge [4]6 and [2]8 (kit_b as P1)
  const mk = (): Match => at(-3, 3, { p1: 'kit_b', p2: 'kit_a' });
  const m = mk();
  run(m, W8.chargeFrames, dirBits(m, 0, 4), 0);
  step(m, dirBits(m, 0, 6) | I.M, 0);
  t.ok(fs(m, 0).moveName === 'charge_bash', '[4] 45 frames then 6+M = charge move', fs(m, 0).moveName);
  const m2 = mk();
  run(m2, W8.chargeFrames - 1, dirBits(m2, 0, 4), 0);
  step(m2, dirBits(m2, 0, 6) | I.M, 0);
  t.ok(fs(m2, 0).moveName !== 'charge_bash', '44 frames of charge is not enough', fs(m2, 0).moveName);
  const m3 = mk();
  run(m3, W8.chargeFrames, dirBits(m3, 0, 4), 0);
  run(m3, W8.chargeKeep - 1, 0, 0);
  step(m3, dirBits(m3, 0, 6) | I.M, 0);
  t.ok(fs(m3, 0).moveName === 'charge_bash', 'charge kept 10 frames after release', fs(m3, 0).moveName);
  const m4 = mk();
  run(m4, W8.chargeFrames, dirBits(m4, 0, 4), 0);
  run(m4, W8.chargeKeep + 1, 0, 0);
  step(m4, dirBits(m4, 0, 6) | I.M, 0);
  t.ok(fs(m4, 0).moveName !== 'charge_bash', 'charge lost after 11 frames', fs(m4, 0).moveName);
  const m5 = mk();
  run(m5, W8.chargeFrames, dirBits(m5, 0, 2), 0);
  step(m5, dirBits(m5, 0, 8) | I.M, 0);
  t.ok(fs(m5, 0).moveName === 'charge_up', '[2] 45 frames then 8+M = charge up move', fs(m5, 0).moveName);
  const m6 = mk();
  const seq = [6, 3, 2, 1, 4].map((d) => dirBits(m6, 0, d));
  seq[4] |= I.H;
  for (const w of seq) step(m6, w, 0);
  t.ok(fs(m6, 0).moveName === 'slam_h', 'kit_b 63214+H = 360 command grab (priority over nothing else)', fs(m6, 0).moveName);
}
{
  // dashes through the real input path
  const m = at(-3, 3);
  for (const d of [6, 5, 6]) step(m, dirBits(m, 0, d), 0);
  t.eq(m.s[sb(0) + F.st], ST.DASH_F, '6 5 6 input = DASH_F state');
  const m2 = at(-3, 3);
  for (const d of [4, 5, 4]) step(m2, dirBits(m2, 0, d), 0);
  t.eq(m2.s[sb(0) + F.st], ST.DASH_B, '4 5 4 input = DASH_B state');
}

// ------------------------------------------------------------------ buffers
function bufferCase(scheme: 0 | 1, early: number): boolean {
  const m = at(-3, 3, { s1: scheme });
  step(m, I.H, 0); // 5H whiff: 34 frames
  const total = data.fighters.kit_a.moves['5H'].startup + data.fighters.kit_a.moves['5H'].active + data.fighters.kit_a.moves['5H'].recovery - 1;
  // frames 2..total are in the move; the first free frame is total + 1
  for (let f = 2; f <= total + 3; f++) {
    const press = f === total + 1 - early;
    step(m, press ? I.L : 0, 0);
    if (f === total + 1) return fs(m, 0).moveName === '5L';
  }
  return false;
}
t.ok(bufferCase(1, 4), 'CLASSIC: 5L pressed 4 frames early comes out on the first free frame');
t.ok(!bufferCase(1, 5), 'CLASSIC: 5 frames early is dropped');
t.ok(bufferCase(0, 7), 'SIMPLE: 7 frames early comes out');
t.ok(!bufferCase(0, 8), 'SIMPLE: 8 frames early is dropped');

// ------------------------------------------------------------------ SIMPLE routing
{
  const simple = (w: (m: Match) => number, show = 0): string => {
    const m = at(-3, 3, { s1: 0 });
    if (show) devSet(m, 0, 'showtime', show);
    step(m, w(m), 0);
    return fs(m, 0).moveName;
  };
  const w = (d: number, b: number) => (m: Match) => dirBits(m, 0, d) | b;
  t.eq(simple(w(5, I.S)) === 'brickbat_m' ? 1 : 0, 1, 'SIMPLE 5S = main special');
  t.eq(simple(w(6, I.S)) === 'hook_m' ? 1 : 0, 1, 'SIMPLE 6S = approach special');
  t.eq(simple(w(2, I.S)) === 'upper_m' ? 1 : 0, 1, 'SIMPLE 2S = anti-air special');
  t.eq(simple(w(3, I.S)) === 'upper_m' ? 1 : 0, 1, 'SIMPLE 3S -> 2S');
  t.eq(simple(w(4, I.S)) === 'weave' ? 1 : 0, 1, 'SIMPLE 4S = trick special');
  t.eq(simple(w(5, I.S | I.H), 10000) === 'sold_out' ? 1 : 0, 1, 'SIMPLE S+H = Lv1');
  t.eq(simple(w(2, I.S | I.H), 30000) === 'main_event' ? 1 : 0, 1, 'SIMPLE S+H+down = Lv3');
  t.eq(simple(w(5, I.S | I.A)) === 'brickbat_ex' ? 1 : 0, 1, 'SIMPLE ASSIST+5S = EX (_m -> _ex)');
  t.eq(simple(w(2, I.S | I.A)) === 'upper_ex' ? 1 : 0, 1, 'SIMPLE ASSIST+2S = EX anti-air');
  t.eq(simple(w(2, I.H)) === '2H' ? 1 : 0, 1, 'SIMPLE normals unchanged (2H)');
  const m = at(-1.5, 1.5, { s1: 0 });
  step(m, I.S, 0);
  run(m, 40, 0, 0);
  const m2 = at(-1.5, 1.5, { s1: 1 });
  motion(m2, 0, '236', I.M);
  run(m2, 40, 0, 0);
  t.eq(11000 - fs(m, 1).hp, Math.trunc((600 * data.system.simple.damagePct) / 100), 'one-button special deals x0.8 (480)');
  t.eq(11000 - fs(m2, 1).hp, 600, 'the same special by motion deals 100% (600)');
  const m3 = at(-1.5, 1.5, { s1: 0 });
  motion(m3, 0, '236', I.M);
  run(m3, 40, 0, 0);
  t.eq(11000 - fs(m3, 1).hp, 600, 'SIMPLE: motion + M still works at full damage');
}
// ------------------------------------------------------------------ chords
{
  const m = at(-3, 3);
  step(m, I.M | I.H, 0);
  t.eq(m.s[sb(0) + F.st], ST.PARRY, 'M+H on the same frame = PARRY');
  const m2 = at(-3, 3);
  step(m2, I.M, 0);
  step(m2, I.M | I.H, 0);
  t.eq(m2.s[sb(0) + F.st], ST.PARRY, 'M then H one frame later = PARRY (replaces the 5M)');
  const m3 = at(-3, 3);
  step(m3, I.L | I.M, 0);
  t.ok(fs(m3, 0).moveName === 'throw_f', 'L+M on the same frame = throw', fs(m3, 0).moveName);
}

// ================================================================== CHANGED(fix_input) (CONTRACT §35.24)
// (a) rekka / follow-up trigger ranking, (b) the negative-edge rules. Parser-level checks run recordInput + parseAction
// exactly as match.ts fightStep does each frame (the running move is test setup); end-to-end checks play the REAL kits
// through step() with input words. Frame tokens: "<numpad><buttons held>", e.g. "2 3 6M 5" = 236 with M pressed on the 6,
// released on the 5.

// ------------------------------------------------------------------ motionSpan: [end, start] ages of the latest match
function span(seq: (number | [number, boolean])[], code: number): string {
  feed(seq);
  const o = new Int32Array(2);
  return motionSpan(mu.s, b0, code, W8, o) ? `${o[0]},${o[1]}` : 'none';
}
{
  const sp = (seq: (number | [number, boolean])[], code: number, want: string, label: string): void => {
    const got = span(seq, code);
    t.ok(got === want, `motionSpan: ${label} = [${want}]`, got);
  };
  sp([5, 2, 3, 6], MO.QCF, '0,2', '236 completed this frame');
  sp([2, 3, 6, 5, 5], MO.QCF, '2,4', '236 then two neutral frames');
  sp([2, 3, 6, 2, 1, 4], MO.QCF, '3,5', 'the leftover 236 before a 214');
  sp([2, 3, 6, 2, 1, 4], MO.QCB, '0,2', 'the fresh 214 after a 236');
  sp([6, 2, 3, 6], MO.DP, '1,3', '6236 as DP (623 inside it)');
  sp([6, 2, 3, 6], MO.QCF, '0,2', '6236 as QCF (overlaps the DP)');
  sp([2, 5, 2], MO.DD, '0,2', '22');
  sp([[2, false], [3, true], [3, true], [6, false]], MO.QCF, '0,3', 'frozen entries count as entries (ages compare across motions)');
  sp([4, 7, 8, 9, 6], MO.SPD, '0,4', '360 (4, 8, 6) ends on its newest cardinal');
  sp([2, 6], MO.QCF, 'none', 'a motion that is not done');
}

// ------------------------------------------------------------------ fixture kit with a synthetic rekka (parser level)
// kit_a hook_{s} (214) chains rk2 (trigger 236 / "5S"); rk2 chains, in this authored order, rk3_oh (236 / "5S"), rk3_dp
// (623 / "6S"), rk3_lo (214 / "2S") and rk3_b (button-only H) and cancels into supers; rk2n chains rk3_oh / rk3_lo with NO
// super cancel; 5M chains tc_5h ("5M>5H") then tc_6h ("5M>6H").
type Json = Record<string, any>;
function rekkaData(): GameData {
  const raw = (rel: string): Json => JSON.parse(readFileSync(ROOT + rel, 'utf8')) as Json;
  const ka = raw('_harness/fixtures/kit_a.json');
  const part = (input: string, motionStr: string, btn: string, simple: string, cancel: string[] = []): Json => ({
    kind: 'special', input, startup: 9, active: 3, recovery: 20, damage: 500, hitstop: 13, hitstun: 40, blockstun: 16, guard: 'HL',
    boxes: [{ f: [9, 11], x: 0.6, y: 1.2, w: 0.5, h: 0.4 }], tc: true, anim: { clip: 'a_hook' },
    trigger: { classic: { motion: motionStr, btn }, simple }, cancel,
  });
  ka.moves.rk2 = part('214>236', '236', 'LMH', '5S', ['chain:rk3_oh', 'chain:rk3_dp', 'chain:rk3_lo', 'chain:rk3_b', 'super']);
  ka.moves.rk3_oh = part('214>236>236', '236', 'LMH', '5S');
  ka.moves.rk3_dp = part('214>236>623', '623', 'LMH', '6S');
  ka.moves.rk3_lo = part('214>236>214', '214', 'LMH', '2S');
  ka.moves.rk3_b = part('214>236>H', '', 'H', 'H');
  // rk2n = rk2's follow-ups WITHOUT a super cancel (S+H must stay the follow-up press there)
  ka.moves.rk2n = part('214>236', '236', 'LMH', '5S', ['chain:rk3_oh', 'chain:rk3_lo']);
  for (const k of ['hook_l', 'hook_m', 'hook_h']) ka.moves[k].cancel = ['chain:rk2', 'super'];
  ka.moves.tc_6h = { ...ka.moves.tc_5h, input: '5M>6H' };
  ka.moves['5M'].cancel = ['chain:tc_5h', 'chain:tc_6h', 'special', 'super'];
  return buildGameData({
    system: raw('data/system.json'),
    fighters: { kit_a: ka, kit_b: raw('_harness/fixtures/kit_b.json') },
    clips: { kit_a: raw('_harness/fixtures/kit_a.clips.json'), kit_b: raw('_harness/fixtures/kit_b.clips.json') },
    stages: { version: 1, stages: ['rust_theater', 'butcher_block'].map((id) => ({ id, status: 'built', spawnAxisDeg: PROBE_AXIS_DEG })) },
  });
}
const BTN: Record<string, number> = { L: I.L, M: I.M, H: I.H, S: I.S, A: I.A };
function tokWord(m: Match, i: number, tok: string): number {
  let w = dirBits(m, i, Number(tok[0]));
  for (const c of tok.slice(1)) w |= BTN[c] ?? 0;
  return w;
}
function moveIdx(m: Match, id: string): number {
  return m.cf[0].moves.findIndex((q) => q.id === id);
}
/** test setup: fighter 0 runs move `id` (null = none) with an empty buffer and an empty input history */
function setIn(m: Match, id: string | null): void {
  const s = m.s;
  const b = sb(0);
  s[b + F.mv] = id === null ? -1 : moveIdx(m, id);
  s[b + F.bufA] = ACT.NONE;
  s[b + F.bufM] = -1;
  s[b + F.bufF] = 0;
  s[b + F.bufAge] = 0;
  for (let h = 0; h < HIST; h++) s[b + F.hist + h] = 0;
  s[b + F.raw] = 0;
  s[b + F.prevRaw] = 0;
}
/** the per-frame parse of fightStep (recordInput + parseAction) over frame tokens; frozen = hitstop frames */
function parse(m: Match, spec: string, frozen = false): void {
  for (const tok of spec.trim().split(/\s+/)) {
    recordInput(m, 0, tokWord(m, 0, tok), frozen);
    parseAction(m, 0);
  }
}
function bufOf(m: Match): string {
  const s = m.s;
  const b = sb(0);
  const a = s[b + F.bufA];
  if (a === ACT.NONE) return '-';
  if (a !== ACT.MOVE) return `act${a}`;
  return m.cf[0].moves[s[b + F.bufM]].id + ((s[b + F.bufF] & BUF.NEG) !== 0 ? '(neg)' : '') + ((s[b + F.bufF] & BUF.CHAIN) !== 0 ? '(chain)' : '');
}
const RKD = rekkaData();
const PM: Match[] = [0, 1].map((sc) => {
  const m = newMatch({ data: RKD, s1: sc as 0 | 1 });
  place(m, -3, 3);
  run(m, 2, 0, 0);
  return m;
});
function parsed(scheme: 0 | 1, inMove: string | null, spec: string, frozen = false): string {
  const m = PM[scheme];
  setIn(m, inMove);
  parse(m, spec, frozen);
  return bufOf(m);
}
{
  // (a) SIMPLE one-button: exact direction > its SIMPLE class > the neutral "5S" fallback (before: the first sibling, rk3_oh,
  // took every S press - Patch CUE 2 -> 2S was CUE 3 OVERHEAD)
  const simpleCases: [string, string, string][] = [
    ['5S', 'rk3_oh', 'exact 5S'], ['8S', 'rk3_oh', '8 = the 5S class'], ['6S', 'rk3_dp', 'exact 6S'], ['9S', 'rk3_dp', '9 = the 6S class'],
    ['2S', 'rk3_lo', 'exact 2S'], ['1S', 'rk3_lo', '1 = the 2S class'], ['3S', 'rk3_lo', '3 = the 2S class'],
    ['4S', 'rk3_oh', 'no 4S sibling: the 5S fallback'], ['7S', 'rk3_oh', 'no 4S sibling: the 5S fallback'],
  ];
  for (const [tok, want, why] of simpleCases) {
    const got = parsed(0, 'rk2', tok);
    t.ok(got === `${want}(chain)`, `SIMPLE rekka trigger ${tok} -> ${want} (${why})`, got);
  }
  // (a) CLASSIC motion form: the fresh motion beats a leftover one, overlapping motions go by priority, a motion beats a
  // button-only sibling
  const classicCases: [string, string, string][] = [
    ['2 3 6M', 'rk3_oh', '236M'], ['6 2 3M', 'rk3_dp', '623M'], ['2 1 4M', 'rk3_lo', '214M'],
    ['6 2 3 6M', 'rk3_dp', '6236M = DP and QCF overlapping: the longer motion first (MOTION_PRIO), as the special routing'],
    ['2 3 6 5 2 1 4M', 'rk3_lo', 'a leftover 236 still inside the window loses to the fresh 214'],
    ['2 1 4 5 2 3 6M', 'rk3_oh', 'a leftover 214 loses to the fresh 236'],
    ['6 2 3 2 1 4M', 'rk3_lo', 'a leftover 623 loses to the fresh 214'],
    ['2 3 6H', 'rk3_oh', '236H: the motion beats the button-only H sibling'], ['5H', 'rk3_b', 'plain H = the button-only sibling'],
  ];
  for (const [spec, want, why] of classicCases) {
    const got = parsed(1, 'rk2', spec);
    t.ok(got === `${want}(chain)`, `CLASSIC rekka trigger: ${why} -> ${want}`, got);
  }
  const hsLeft = parsed(1, 'rk2', '2 3 6 5 5 5 5 5 5 5 5 5 5 5 5 2 1 4M', true);
  t.ok(hsLeft === 'rk3_lo(chain)', 'CLASSIC: in hitstop the leftover 236 never ages out - the fresh 214 still wins (rk3_lo)', hsLeft);
  for (const [spec, want] of [['2 3 6 5 2 1 4M', 'rk3_lo'], ['2 1 4 5 2 3 6M', 'rk3_oh']] as [string, string][]) {
    const got = parsed(0, 'rk2', spec);
    t.ok(got === `${want}(chain)`, `SIMPLE motion form (L/M/H, §1): ${spec} -> ${want}`, got);
  }
  // target combos: an exact direction beats the 5X class (before: tc_5h, the first 5X sibling, took 6H)
  for (const [tok, want] of [['6H', 'tc_6h'], ['5H', 'tc_5h'], ['4H', 'tc_5h']] as [string, string][]) {
    const got = parsed(1, '5M', tok);
    t.ok(got === `${want}(chain)`, `target combo in 5M: ${tok} -> ${want} (exact direction > the 5H class)`, got);
  }
}
{
  // (b) a negative-edge read never overwrites a pressed chain: the chain's button released in the parent's hitstop (before:
  // the release re-read the motion as a special - brickbat_m(neg) / hook_m(neg) - and replaced the chain)
  const negCases: [0 | 1, string, string, string][] = [
    [1, 'hook_m', '2 3 6M 6 5', 'rk2'], [1, 'hook_m', '2 3 6L 5 5', 'rk2'], [1, 'rk2', '2 1 4M 5', 'rk3_lo'], [1, 'rk2', '2 3 6M 5', 'rk3_oh'],
    [0, 'hook_m', '2 3 6M 5', 'rk2'], [0, 'rk2', '2 1 4M 4 5', 'rk3_lo'],
  ];
  for (const [sc, inMv, spec, want] of negCases) {
    const got = parsed(sc, inMv, spec, true);
    t.ok(got === `${want}(chain)`, `${sc === 0 ? 'SIMPLE' : 'CLASSIC'} in ${inMv} (hitstop): ${spec} - the release keeps ${want}`, got);
  }
  // (b) the release never re-reads the running move's own special row (before: hook_m(neg))
  const m = PM[1];
  setIn(m, 'hook_m');
  m.s[sb(0) + F.raw] = I.M; // M held since before the motion
  parse(m, '2M 1M 4M 4');
  t.ok(bufOf(m) === '-', 'CLASSIC in hook_m: hold M, 214, release - no negative-edge re-read of hook (the running move)', bufOf(m));
  setIn(m, null);
  m.s[sb(0) + F.raw] = I.M;
  parse(m, '2M 1M 4M 4');
  t.ok(bufOf(m) === 'hook_m(neg)', 'CLASSIC from neutral: hold M, 214, release = hook_m by negative edge (unchanged)', bufOf(m));
  // a NEW press still replaces the buffer (the newest press wins)
  setIn(m, 'hook_m');
  parse(m, '2 3 6M 5');
  const chained = bufOf(m);
  parse(m, '5 5 5 5 5 5 5 5 5 5 5 5 5M');
  t.ok(chained === 'rk2(chain)' && bufOf(m) === '5M', 'a later press (5M) still replaces a buffered chain (newest press wins)', `${chained} -> ${bufOf(m)}`);
}
{
  // (c) SIMPLE S+H = the super while the running move's cancel list allows one (orchestrator decision, §35.24 item 2b);
  // without a super cancel, or without the meter, S+H stays the follow-up press; CLASSIC has no S+H super (unchanged)
  const cfa = PM[0].cf[0];
  const sup1 = cfa.moves[cfa.route1.sup1].id;
  const sup3 = cfa.moves[cfa.route1.sup3].id;
  const metered = (scheme: 0 | 1, show: number, inMove: string, spec: string): string => {
    const m = PM[scheme];
    setIn(m, inMove);
    devSet(m, 0, 'showtime', show);
    parse(m, spec);
    const got = bufOf(m);
    devSet(m, 0, 'showtime', 0);
    return got;
  };
  const chordCases: [0 | 1, number, string, string, string, string][] = [
    [0, 10000, 'rk2', '5SH', sup1, 'S+H on one frame (1 bar) = Lv1, not the 5S follow-up'],
    [0, 10000, 'rk2', '5H 5SH', sup1, 'H then S (chord, H first) = Lv1'],
    [0, 10000, 'rk2', '5S 5SH', sup1, 'S then H one frame later (parent frozen) = Lv1 replaces the buffered follow-up'],
    [0, 30000, 'rk2', '2SH', sup3, '2S+H with 3 bars = Lv3'],
    [0, 10000, 'rk2', '2SH', 'rk3_lo(chain)', '2S+H with 1 bar (Lv3 unaffordable) = the 2S follow-up'],
    [0, 0, 'rk2', '5SH', 'rk3_oh(chain)', 'S+H without meter = the 5S follow-up'],
    [0, 30000, 'rk2', '5S', 'rk3_oh(chain)', 'S alone with full meter = the follow-up'],
    [0, 30000, 'rk2n', '5SH', 'rk3_oh(chain)', 'a parent whose cancel list has NO super: S+H stays the 5S follow-up'],
    [0, 30000, 'rk2n', '2SH', 'rk3_lo(chain)', 'a parent whose cancel list has NO super: 2S+H stays the 2S follow-up'],
    [1, 30000, 'rk2', '5SH', 'rk3_b(chain)', 'CLASSIC (no S+H super): S+H = the H follow-up, as before'],
  ];
  for (const [sc, show, inMv, spec, want, why] of chordCases) {
    const got = metered(sc, show, inMv, spec);
    t.ok(got === want, `${sc === 0 ? 'SIMPLE' : 'CLASSIC'} in ${inMv}: ${why} (${want})`, got);
  }
}

// ------------------------------------------------------------------ the REAL kits (data/fighters), end to end
const RD = loadGameData();
const MOTION_STR: Record<number, string> = {
  [MO.QCF]: '236', [MO.QCB]: '214', [MO.DP]: '623', [MO.RDP]: '421', [MO.HCF]: '41236', [MO.HCB]: '63214', [MO.DD]: '252',
};
const lowBtn = (mask: number): string => (mask & 1 ? 'L' : mask & 2 ? 'M' : mask & 4 ? 'H' : mask & 8 ? 'S' : '');
/** frame tokens of a motion string with `btn` held on its last direction */
const motionToks = (dirs: string, btn: string): string => dirs.split('').map((d, k, a) => (k === a.length - 1 ? d + btn : d)).join(' ');
function realM(p1: string, scheme: 0 | 1, x0 = -0.6, x1 = 0.6): Match {
  const m = newMatch({ p1, p2: 'johnny', data: RD, s1: scheme, s2: 1, timer: 0 });
  place(m, x0, x1);
  run(m, 2, 0, 0);
  return m;
}
const nameOf = (m: Match): string => readFighter(m, 0).moveName || '-';
/** plays frame tokens through step(); appends every new move name to `log` */
function play(m: Match, spec: string, log: string[]): void {
  for (const tok of spec.trim().split(/\s+/)) {
    step(m, tokWord(m, 0, tok), 0);
    if (log[log.length - 1] !== nameOf(m)) log.push(nameOf(m));
  }
}
function idleLog(m: Match, n: number, log: string[]): void {
  for (let k = 0; k < n; k++) play(m, '5', log);
}

// ---- Patch: CUE 1 > CUE 2 > CUE 3 (each CUE 3 by its own trigger), typed in the parents' hitstop and after it
{
  const pm0 = realM('patch', 0);
  const cf = pm0.cf[0];
  const cueM = cf.route1.s5;
  const p1 = cueM >= 0 ? cf.moves[cueM] : null;
  const cue2 = p1 ? p1.chains.map((k) => cf.moves[k]).find((q) => q.trigger !== null) : undefined;
  const enders = cue2 ? cue2.chains.map((k) => cf.moves[k]).filter((q) => q.trigger !== null) : [];
  t.ok(!!p1 && !!cue2 && enders.length >= 2, `patch: SIMPLE 5S (${p1?.id}) chains a triggered part (${cue2?.id}) with >= 2 triggered enders (${enders.map((q) => q.id).join(', ')})`);
  if (p1 && cue2 && enders.length >= 2) {
    const row = cf.route1.specials.find((sp) => sp.idx[1] === cueM);
    const starterC = row && MOTION_STR[row.motion] ? motionToks(MOTION_STR[row.motion], 'M') : '';
    const simpleTok = (q: CMove): string => (q.trigger && q.trigger.simpleDir >= 0 ? `${q.trigger.simpleDir}S` : '');
    const motionTok = (q: CMove): string => (q.trigger && q.trigger.motion > 0 && MOTION_STR[q.trigger.motion] ? motionToks(MOTION_STR[q.trigger.motion], lowBtn(q.trigger.btnMask & 7)) : '');
    /** plays starter; on the parent's contact (in its hitstop / right after it) feeds t2, then t3 on cue2's contact */
    const walk = (scheme: 0 | 1, starter: string, t2: string, t3: string, inHitstop: boolean): string => {
      const m = realM('patch', scheme);
      const log: string[] = ['-'];
      play(m, starter, log);
      let phase = 0;
      const b = sb(0);
      for (let f = 0; f < 150; f++) {
        const ready = m.s[b + F.contact] !== 0 && (inHitstop ? m.s[b + F.hitstop] > 0 : m.s[b + F.hitstop] === 0);
        if (phase === 0 && m.s[b + F.mv] === cueM && ready) {
          phase = 1;
          play(m, t2, log);
          continue;
        }
        if (phase === 1 && nameOf(m) === cue2.id && ready) {
          phase = 2;
          play(m, t3, log);
          continue;
        }
        idleLog(m, 1, log);
      }
      return log.filter((x) => x !== '-').join(' > ');
    };
    const forms: [string, 0 | 1, string, string, (q: CMove) => string][] = [
      ['SIMPLE one-button', 0, '5S', simpleTok(cue2), simpleTok],
      ['CLASSIC motions', 1, starterC, motionTok(cue2), motionTok],
      ['SIMPLE motion form', 0, '5S', motionTok(cue2), motionTok],
    ];
    for (const [label, scheme, starter, t2, tokOf] of forms) {
      for (const inHs of [true, false]) {
        for (const q of enders) {
          const t3 = tokOf(q);
          if (!starter || !t2 || !t3) {
            t.ok(false, `patch ${label}: inputs derivable from the data`, `starter "${starter}" cue2 "${t2}" ${q.id} "${t3}"`);
            continue;
          }
          const want = `${p1.id} > ${cue2.id} > ${q.id}`;
          const got = walk(scheme, starter, t2, t3, inHs);
          t.ok(got === want, `patch ${label}, typed ${inHs ? 'IN the parents\' hitstop' : 'after the hitstop'}: ${t2.replace(/ /g, '')} then ${t3.replace(/ /g, '')} = ${want}`, got);
        }
      }
    }
    // a held chain button (released 1..8 frames later, inside the hitstop) keeps CUE 2
    for (const hold of [2, 4, 8]) {
      const t2 = `${motionTok(cue2).split(' ').slice(0, -1).join(' ')} ${Array.from({ length: hold }, () => motionTok(cue2).split(' ').pop()).join(' ')}`;
      const got = walk(1, starterC, t2, motionTok(enders[enders.length - 1]), true);
      t.ok(got.startsWith(`${p1.id} > ${cue2.id} > `), `patch CLASSIC: CUE 2's button held ${hold} frames in CUE 1's hitstop, then released - CUE 2 comes out`, got);
    }
    // (c) SIMPLE S+H super-cancels CUE 1 / CUE 2 (both authored with a "super" cancel); S alone with meter is still CUE 2;
    // CLASSIC as is: a fast "236M, 236M" rekka with full meter stays the rekka (it contains 236236)
    const supName = (k: number): string => (k >= 0 ? cf.moves[k].id : '?');
    const sup1 = supName(cf.route1.sup1);
    const sup3 = supName(cf.route1.sup3);
    /** starter; on CUE 1's contact (in its hitstop / after) `mid` (optional, -> CUE 2), then `toks` on the next parent's contact */
    const cancelRun = (scheme: 0 | 1, starter: string, mid: string, toks: string, inHitstop: boolean, show: number): string => {
      const m = realM('patch', scheme);
      devSet(m, 0, 'showtime', show);
      const log: string[] = ['-'];
      play(m, starter, log);
      let phase = mid ? 0 : 1;
      const b = sb(0);
      for (let f = 0; f < 200; f++) {
        const ready = m.s[b + F.contact] !== 0 && (inHitstop ? m.s[b + F.hitstop] > 0 : m.s[b + F.hitstop] === 0);
        const parent = phase === 0 || !mid ? m.s[b + F.mv] === cueM : nameOf(m) === cue2.id;
        if (phase < 2 && ready && parent) {
          play(m, phase === 0 ? mid : toks, log);
          phase++;
          if (!mid) phase = 2;
          continue;
        }
        idleLog(m, 1, log);
      }
      return log.filter((x) => x !== '-').join(' > ');
    };
    const cancels: [0 | 1, string, string, boolean, number, string, string][] = [
      [0, '', '5SH', true, 10000, `${p1.id} > ${sup1}`, 'CUE 1 -> S+H in its hitstop (1 bar) = Lv1'],
      [0, '', '5SH', false, 10000, `${p1.id} > ${sup1}`, 'CUE 1 -> S+H after the hitstop (1 bar) = Lv1'],
      [0, '', '5H 5SH', true, 10000, `${p1.id} > ${sup1}`, 'CUE 1 -> H then S (chord, H first) = Lv1'],
      [0, '', '5S', true, 30000, `${p1.id} > ${cue2.id}`, 'CUE 1 -> S alone (full meter) = CUE 2'],
      [0, '', '5SH', true, 0, `${p1.id} > ${cue2.id}`, 'CUE 1 -> S+H without meter = CUE 2'],
      [0, '5S', '2SH', true, 30000, `${p1.id} > ${cue2.id} > ${sup3}`, 'CUE 1 > CUE 2 -> 2S+H in its hitstop (3 bars) = Lv3'],
      [1, motionTok(cue2), motionTok(cue2), true, 30000, `${p1.id} > ${cue2.id} > `, 'CLASSIC (as is): CUE 2\'s 236 then CUE 3\'s 236 with full meter stay the rekka'],
    ];
    for (const [scheme, mid, toks, inHs, show, want, why] of cancels) {
      const starter = scheme === 0 ? '5S' : starterC;
      const got = cancelRun(scheme, starter, mid, toks, inHs, show);
      const ok = want.endsWith(' > ') ? got.startsWith(want) && !got.includes(sup1) && !got.includes(sup3) : got === want;
      t.ok(ok, `patch ${scheme === 0 ? 'SIMPLE' : 'CLASSIC'}: ${why}`, got);
    }
  }
}

// ---- Johnny: WEAVE -> counter hook pressed on every weave frame before / at its window (the release used to re-read 22
// as WEAVE and overwrite the buffered hook when the press came before the window opened)
{
  const m0 = realM('johnny', 1, -2, 2);
  const cf = m0.cf[0];
  const row = cf.route1.specials.find((sp) => sp.idx[0] >= 0 && cf.moves[sp.idx[0]].chains.some((k) => cf.moves[k].trigger !== null));
  const wv = row ? cf.moves[row.idx[0]] : null;
  const hook = wv ? wv.chains.map((k) => cf.moves[k]).find((q) => q.trigger !== null) : undefined;
  t.ok(!!wv && !!hook && row !== undefined && MOTION_STR[row.motion] !== undefined, `johnny: an L special with a triggered follow-up (${wv?.id} -> ${hook?.id})`);
  if (wv && hook && row && MOTION_STR[row.motion]) {
    const bad: string[] = [];
    const tmask = hook.trigger ? hook.trigger.btnMask & 7 : 0;
    const hb = tmask & 2 ? 'M' : lowBtn(tmask); // a button of the trigger other than the L that started the weave
    for (const scheme of [1, 0] as (0 | 1)[]) {
      for (let k = 1; k <= wv.startup + 1; k++) {
        const m = realM('johnny', scheme, -2, 2);
        const log: string[] = ['-'];
        play(m, motionToks(MOTION_STR[row.motion], 'L'), log);
        idleLog(m, k - 1, log);
        play(m, `5${hb}`, log);
        idleLog(m, 40, log);
        if (!log.includes(hook.id)) bad.push(`${scheme === 0 ? 'SIMPLE' : 'CLASSIC'} frame ${k}: ${log.filter((x) => x !== '-').join(' > ')}`);
      }
    }
    t.ok(bad.length === 0, `johnny ${wv.id}: the follow-up button pressed (1 frame) on weave frames 1..${wv.startup + 1} always fires ${hook.id} (both schemes)`, bad.join('; '));
    // (c) S+H in WEAVE - whose cancel list has no super - stays the follow-up press, even with full meter
    const sup1j = cf.route1.sup1 >= 0 ? cf.moves[cf.route1.sup1].id : '?';
    const mj = realM('johnny', 0, -2, 2);
    devSet(mj, 0, 'showtime', 30000);
    const lj: string[] = ['-'];
    play(mj, motionToks(MOTION_STR[row.motion], 'L'), lj);
    idleLog(mj, wv.startup - 1, lj);
    play(mj, '5SH', lj);
    idleLog(mj, 60, lj);
    t.ok(!wv.cSuper && lj.includes(hook.id) && !lj.includes(sup1j), `johnny SIMPLE: S+H in ${wv.id} (no super in its cancel list, full meter) = ${hook.id}, never ${sup1j}`, lj.filter((x) => x !== '-').join(' > '));
  }
}

// ---- every kit: no special restarts itself on the button's release (a "special" cancel used to let the negative edge
// re-trigger it: bruno BRACE, gazza DIVE, boneyard BUTCHER'S BLOCK, zambini EX VANISH paying 2 more NERVE bars)
{
  let tested = 0;
  for (const fid of Object.keys(RD.fighters).sort()) {
    const probeM = realM(fid, 1, -2.5, 2.5);
    const cf = probeM.cf[0];
    const bad: string[] = [];
    for (const sp of cf.route1.specials) {
      const ms = MOTION_STR[sp.motion];
      if (!ms) continue;
      for (let bt = 0; bt < 4; bt++) {
        const idx = sp.idx[bt];
        if (idx < 0 || (bt < 3 && (sp.btnMask & (1 << bt)) === 0)) continue;
        const mv = cf.moves[idx];
        if (!mv.cSpecial || mv.airOnly) continue;
        for (const hold of [1, 3, 6]) {
          const m = realM(fid, 1, -2.5, 2.5);
          devSet(m, 0, 'nerve', 60000);
          devSet(m, 0, 'showtime', 30000);
          const b = sb(0);
          const btn = 'LMHS'[bt];
          const toks = motionToks(ms, btn).split(' ');
          const last = toks.pop() as string;
          const log: string[] = ['-'];
          play(m, toks.join(' ') || '5', log);
          let pn = m.s[b + F.nerve];
          let paid = 0; // NERVE drops summed per frame (it regenerates in between)
          let starts = 0;
          let prevMv = m.s[b + F.mv];
          let prevF = m.s[b + F.mvF];
          for (let f = 0; f < 90; f++) {
            play(m, f < hold ? last : '5', log);
            const cur = m.s[b + F.mv];
            // a start = entering the move, or its frame counter going back / standing still with nothing frozen (no hit here)
            const still = m.s[b + F.mvF] === prevF && m.s[b + F.hitstop] === 0 && m.s[b + F.contact] === 0;
            if (cur === idx && (prevMv !== idx || m.s[b + F.mvF] < prevF || still)) starts++;
            prevMv = cur;
            prevF = m.s[b + F.mvF];
            const nv = m.s[b + F.nerve];
            if (nv < pn) paid += pn - nv;
            pn = nv;
          }
          if (starts !== 1 || paid !== mv.costNerve) bad.push(`${mv.id} held ${hold}: ${starts} starts, NERVE paid ${paid} (cost ${mv.costNerve})`);
          tested++;
        }
      }
    }
    if (bad.length > 0 || cf.route1.specials.some((sp) => [0, 1, 2, 3].some((k) => sp.idx[k] >= 0 && cf.moves[sp.idx[k]].cSpecial))) {
      t.ok(bad.length === 0, `${fid}: specials with a "special" cancel start ONCE per press (no negative-edge self re-trigger)`, bad.join('; '));
    }
  }
  t.ok(tested >= 12, `self re-trigger cases tested: ${tested} (every kit's ground specials with a "special" cancel x hold 1 / 3 / 6)`);
}

// ---- every kit's rekka / follow-up trigger sets (parser level): each part is reached by its OWN trigger, in SIMPLE (its
// one-button form on the exact and class directions a sibling does not claim) and CLASSIC (its motion typed AFTER every
// sibling's motion, which stays inside the window), never shadowed by a sibling
{
  let sets = 0;
  for (const fid of Object.keys(RD.fighters).sort()) {
    const ms = [realM(fid, 0, -3, 3), realM(fid, 1, -3, 3)];
    const cf = ms[0].cf[0];
    for (const par of cf.moves) {
      const parts = par.chains.map((k) => cf.moves[k]).filter((q) => q.trigger !== null);
      if (parts.length === 0) continue;
      sets++;
      const bad: string[] = [];
      for (const q of parts) {
        const tr = q.trigger;
        if (!tr) continue;
        const run1 = (scheme: 0 | 1, spec: string): void => {
          const m = ms[scheme];
          setIn(m, par.id);
          parse(m, spec);
          const got = bufOf(m);
          if (got !== `${q.id}(chain)`) bad.push(`${scheme === 0 ? 'SIMPLE' : 'CLASSIC'} ${spec} -> ${got}`);
        };
        if (tr.simpleDir >= 0) {
          const cls: Record<number, number[]> = { 5: [5, 8], 2: [2, 1, 3], 6: [6, 9], 4: [4, 7] };
          for (const d of cls[tr.simpleDir] ?? [tr.simpleDir]) {
            if (d !== tr.simpleDir && parts.some((o) => o !== q && o.trigger !== null && o.trigger.simpleDir === d)) continue;
            run1(0, `${d}S`);
          }
        } else if ((tr.simpleBtn & 7) !== 0) run1(0, `5${lowBtn(tr.simpleBtn & 7)}`);
        const btn = lowBtn(tr.btnMask & 7) || lowBtn(tr.btnMask);
        if (tr.motion > 0 && MOTION_STR[tr.motion] && btn) {
          const left = parts
            .filter((o) => o !== q && o.trigger !== null && o.trigger.motion > 0 && o.trigger.motion !== tr.motion && MOTION_STR[o.trigger.motion])
            .map((o) => (o.trigger ? MOTION_STR[o.trigger.motion].split('').join(' ') : ''))
            .join(' 5 ');
          const spec = `${left ? left + ' 5 ' : ''}${motionToks(MOTION_STR[tr.motion], btn)}`;
          run1(1, spec);
          if (btn !== 'S') run1(0, spec);
        } else if (tr.motion === 0 && btn) run1(1, `5${btn}`);
      }
      t.ok(bad.length === 0, `${fid} ${par.id}: every triggered part (${parts.map((q) => q.id).join(', ')}) comes from its own trigger`, bad.join('; '));
    }
  }
  t.ok(sets >= 2, `trigger sets checked across the roster: ${sets}`);
}

// ---- stance kits: every follow-up button, pressed from the enter move's start to 3 frames into the stance, fires the
// follow-up (or, too early, nothing) - never a re-read of the enter motion
{
  for (const fid of Object.keys(RD.fighters).sort()) {
    const m0 = realM(fid, 1, -2, 2);
    const cf = m0.cf[0];
    if (cf.uk !== UK.STANCE) continue;
    const fu = cf.u.stFollow;
    const enterRows = cf.route1.specials.filter((sp) => MOTION_STR[sp.motion] && [0, 1, 2, 3].some((k) => sp.idx[k] >= 0 && cf.moves[sp.idx[k]].stanceKind === STK.ENTER));
    const bad: string[] = [];
    let n = 0;
    for (const scheme of [1, 0] as (0 | 1)[]) {
      for (const sp of enterRows) {
        // SIMPLE: the motion enters on L / M / H (§1); its S press is the one-button route, not the EX
        for (let bt = 0; bt < (scheme === 1 ? 4 : 3); bt++) {
          const ent = sp.idx[bt];
          if (ent < 0 || cf.moves[ent].stanceKind !== STK.ENTER) continue;
          const total = cf.moves[ent].total;
          for (let fb2 = 0; fb2 < 3; fb2++) {
            if (fu[fb2] < 0) continue;
            for (let k = 1; k <= total + 3; k++) {
              const m = realM(fid, scheme, -2, 2);
              devSet(m, 0, 'nerve', 60000);
              const log: string[] = ['-'];
              play(m, motionToks(MOTION_STR[sp.motion], 'LMHS'[bt]), log);
              idleLog(m, k - 1, log);
              play(m, `5${'LMH'[fb2]}`, log);
              idleLog(m, 30, log);
              const seen = log.filter((x) => x !== '-');
              const reEnter = seen.slice(1).some((x) => cf.moves.some((q) => q.id === x && q.stanceKind === STK.ENTER));
              const lateOk = k < total - 1 || seen.includes(cf.moves[fu[fb2]].id);
              if (seen[0] !== cf.moves[ent].id || reEnter || !lateOk) bad.push(`${scheme === 0 ? 'SIMPLE' : 'CLASSIC'} ${cf.moves[ent].id} + ${'LMH'[fb2]} on frame ${k}: ${seen.join(' > ')}`);
              n++;
            }
          }
        }
      }
    }
    t.ok(bad.length === 0 && n > 0, `${fid}: stance follow-ups pressed through the enter move (${n} cases) never re-read the enter motion`, bad.slice(0, 4).join('; '));
  }
}

t.done();
