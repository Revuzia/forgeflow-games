// probe_motion (G2, lane SIM): input parsing from the history ring stored IN the state
// (CONTRACT §4.3.9, §4.4, §19.1-2). Unit tests of every motion (window edges, DP shortcuts, 360
// cardinals, 236236 leniency, charge 45/keep 10, 22, 66/44), SOCD neutral, facing-relative motions,
// priority (super > DP > QC, EX via S, meter fall-through), negative edge, buffers (4 CLASSIC /
// 7 SIMPLE early), SIMPLE routing (5S/6S/2S/4S, S+H, S+H+down, ASSIST+S = EX, x0.8), chords
// (L+M throw, M+H parry), hitstop frames do not age a motion.
import { fixtureData, newMatch, place, run, fs, I, tester, dirBits, motion, sb } from './fixtures/simkit.ts';
import { step, devSet } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { MO } from '../runtime/src/core/sim/compile.ts';
import { motionDone, dashDone, H_FROZEN } from '../runtime/src/core/sim/motion.ts';
import { dirOf } from '../runtime/src/core/sim/inputs.ts';
import { F, HIST, ST } from '../runtime/src/core/sim/layout.ts';

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

t.done();
