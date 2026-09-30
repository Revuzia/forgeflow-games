// probe_meters (G2, lane SIM): SHOWTIME + NERVE + STAGE FRIGHT (CONTRACT §4.3.7, FIGHTING_DESIGN
// §2d/§2f). SHOWTIME: gain on hit / block, defender 70% / 25%, none on whiff, METER_BAR, super cost
// gate, carry between rounds. NERVE: regen 40 / 20 (air, hitstun) / +20 walking forward, block drain
// + 90 f regen stop, 120 f cooldown after spending, parry 5000 + 50/f, whiffed parry 240 f, EX 2 bars,
// IMPACT 1 bar, sliver rule, STAGE FRIGHT at 0 (regen 50/f, ends only when completely refilled).
import { fixtureData, newMatch, place, run, fs, evs, I, tester, dirBits, sb } from './fixtures/simkit.ts';
import { step, devSet } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { EV } from '../runtime/src/core/sim/events.ts';
import { F, W, PH } from '../runtime/src/core/sim/layout.ts';

const t = tester('probe_meters');
const data = fixtureData();
const sys = data.system;
const A = data.fighters.kit_a.moves;
const MAXN = sys.nerve.bar * sys.nerve.bars;

function script(m: Match, n: number, f: (k: number) => [number, number]): number {
  const first = m.frame() + 1;
  for (let k = 0; k < n; k++) {
    const [a, b] = f(k);
    step(m, a, b);
  }
  return first;
}
function at(x0: number, x1: number, o = {}): Match {
  const m = newMatch(o);
  place(m, x0, x1);
  run(m, 2, 0, 0);
  return m;
}

// ------------------------------------------------------------------ SHOWTIME
{
  const m = at(-0.4, 0.4);
  script(m, 30, (k) => [k === 0 ? I.L : 0, 0]);
  t.eq(fs(m, 0).showtime, A['5L'].gain!.showtime!, 'hit: attacker gains the move value (300)');
  t.eq(fs(m, 1).showtime, Math.trunc((A['5L'].gain!.showtime! * sys.showtime.defHitPct) / 100), 'hit: defender gains 70% (210)');
}
{
  const m = at(-0.4, 0.4);
  const hold = dirBits(m, 1, 4);
  run(m, 2, 0, hold);
  script(m, 30, (k) => [k === 0 ? I.L : 0, hold]);
  t.eq(fs(m, 0).showtime, Math.trunc((A['5L'].gain!.showtime! * sys.showtime.blockPct) / 100), 'block: attacker gains 50% (150)');
  t.eq(fs(m, 1).showtime, Math.trunc((A['5L'].gain!.showtime! * sys.showtime.defBlockPct) / 100), 'block: defender gains 25% (75)');
}
{
  const m = at(-3, 3);
  script(m, 30, (k) => [k === 0 ? I.H : 0, 0]);
  t.eq(fs(m, 0).showtime, 0, 'whiff: no SHOWTIME');
}
{
  const m = at(-0.4, 0.4);
  devSet(m, 0, 'showtime', 9900);
  const from = script(m, 30, (k) => [k === 0 ? I.L : 0, 0]);
  const bar = evs(m, from).find((e) => e.type === EV.METER_BAR && e.a === 0);
  t.ok(bar !== undefined && bar.b === 1, 'crossing 10000 emits METER_BAR (bars = 1)');
}
{
  // SIMPLE S+H without a bar falls back to the 5S special
  const m = at(-3, 3, { s1: 0 });
  script(m, 3, (k) => [k === 0 ? I.S | I.H : 0, 0]);
  t.ok(fs(m, 0).moveName === 'brickbat_m', 'S+H with 0 SHOWTIME = no super (5S special instead)', fs(m, 0).moveName);
  const m2 = at(-3, 3, { s1: 0 });
  devSet(m2, 0, 'showtime', 10000);
  script(m2, 3, (k) => [k === 0 ? I.S | I.H : 0, 0]);
  t.ok(fs(m2, 0).moveName === 'sold_out' && fs(m2, 0).showtime === 0, 'S+H with 1 bar = Lv1 super, bar spent');
}
{
  // SHOWTIME carries to the next round
  const m = at(-0.4, 0.4);
  devSet(m, 0, 'showtime', 12345);
  devSet(m, 1, 'hp', 1);
  script(m, 10, (k) => [k === 0 ? I.L : 0, 0]);
  const keep = fs(m, 0).showtime;
  let n = 0;
  while (m.s[W.round] === 1 && n++ < 2000) step(m, 0, 0);
  t.ok(m.s[W.round] === 2 && fs(m, 0).showtime === keep, 'SHOWTIME carries between rounds', `round ${m.s[W.round]} showtime ${fs(m, 0).showtime} (was ${keep})`);
  t.ok(fs(m, 0).nerve === MAXN && fs(m, 1).hp === 11000, 'new round: NERVE full, HP full');
}

// ------------------------------------------------------------------ NERVE regen
{
  const m = at(-3, 3);
  devSet(m, 0, 'nerve', 30000);
  run(m, 10, 0, 0);
  t.eq(fs(m, 0).nerve, 30000 + 10 * sys.nerve.regen, 'idle regen 40/frame');
  devSet(m, 0, 'nerve', 30000);
  run(m, 10, dirBits(m, 0, 6), 0);
  t.eq(fs(m, 0).nerve, 30000 + 10 * (sys.nerve.regen + sys.nerve.walkFwdBonus), 'walking forward regen 60/frame');
  place(m, -3, 3);
  run(m, 5, 0, 0);
  devSet(m, 0, 'nerve', 30000);
  run(m, 1, dirBits(m, 0, 8), 0);
  run(m, 3, 0, 0); // prejump
  const n0 = fs(m, 0).nerve;
  run(m, 10, 0, 0);
  t.eq(fs(m, 0).nerve - n0, 10 * sys.nerve.regenStunAir, 'airborne regen 20/frame');
}
{
  // spend cooldown 120 frames after IMPACT
  const m = at(-3, 3);
  script(m, 1, () => [I.IMPACT, 0]);
  const n0 = fs(m, 0).nerve;
  t.eq(n0, MAXN - sys.nerve.impactCost, 'IMPACT costs 10000');
  run(m, sys.nerve.spendCooldown - 1, 0, 0);
  t.eq(fs(m, 0).nerve, n0, 'no regen during the 120-frame spend cooldown');
  run(m, 11, 0, 0);
  t.ok(fs(m, 0).nerve > n0, 'regen resumes after the cooldown');
}
{
  // block drain + 90-frame stop
  const m = at(-0.4, 0.4);
  const hold = dirBits(m, 1, 4);
  devSet(m, 1, 'nerve', 40000);
  run(m, 2, 0, hold);
  script(m, 1, () => [I.L, hold]);
  run(m, 3, 0, hold);
  const after = fs(m, 1).nerve;
  t.ok(after <= 40000 + 3 * 40 - (A['5L'].gain?.nerveCost ?? sys.nerve.blockDrain.L) + 40 * 3, 'blocking drains NERVE (light 500)', `nerve ${after}`);
  run(m, sys.nerve.blockRegenStop - 10, 0, hold);
  t.eq(fs(m, 1).nerve, after, 'no regen for 90 frames after blocking');
  run(m, 20, 0, 0);
  t.ok(fs(m, 1).nerve > after, 'regen resumes after the block stop');
}
{
  // parry costs: 5000 on frame 2 + 50/frame from frame 4 (tap = 12 active frames)
  const m = at(-3, 3);
  script(m, 20, (k) => [0, k === 0 ? I.PARRY : 0]);
  const spent = MAXN - fs(m, 1).nerve;
  const want = sys.parry.costStart + (sys.parry.active - sys.parry.drainFromFrame + 1) * sys.parry.drainPerFrame;
  t.eq(spent, want, 'tapped parry costs 5000 + 50 x 9');
  run(m, sys.nerve.spendCooldown + 20, 0, 0);
  t.eq(MAXN - fs(m, 1).nerve, want, 'whiffed parry: regen cooldown longer than 120 frames');
  run(m, sys.nerve.whiffParryCooldown, 0, 0);
  t.ok(fs(m, 1).nerve > MAXN - want, 'whiffed parry: regen after 240 frames');
}
{
  // EX costs 2 bars (CLASSIC 236 + S)
  const m = at(-3, 3);
  const seq = [2, 3, 6].map((d) => dirBits(m, 0, d));
  seq[2] |= I.S;
  script(m, 3, (k) => [seq[k], 0]);
  t.ok(fs(m, 0).moveName === 'brickbat_ex' && fs(m, 0).nerve === MAXN - sys.nerve.exCost, '236+S = EX special, 2 NERVE bars', `${fs(m, 0).moveName} ${fs(m, 0).nerve}`);
}
{
  // sliver rule + STAGE FRIGHT on / regen 50 / off only when full
  const m = at(-3, 3);
  devSet(m, 0, 'nerve', 100);
  const from = script(m, 1, () => [I.IMPACT, 0]);
  const on = evs(m, from).some((e) => e.type === EV.STAGE_FRIGHT_ON && e.a === 0);
  t.ok(fs(m, 0).moveName === 'impact' && on && fs(m, 0).stageFright, 'IMPACT with a sliver left is allowed and burns out (STAGE_FRIGHT_ON)');
  run(m, 80, 0, 0);
  const n1 = fs(m, 0).nerve;
  run(m, sys.nerve.spendCooldown, 0, 0);
  const n2 = fs(m, 0).nerve;
  run(m, 20, 0, 0);
  t.eq(fs(m, 0).nerve - n2, 20 * sys.stageFright.regen, 'STAGE FRIGHT regen 50/frame');
  void n1;
  let offAt = -1;
  let offFrame = -1;
  const start = m.frame();
  for (let k = 0; k < 1400 && offFrame < 0; k++) {
    step(m, 0, 0);
    const e = evs(m, m.frame()).find((q) => q.type === EV.STAGE_FRIGHT_OFF && q.a === 0);
    if (e) {
      offFrame = e.frame;
      offAt = fs(m, 0).nerve;
    }
  }
  t.ok(offFrame > 0 && offAt === MAXN, 'STAGE FRIGHT ends only when NERVE is completely refilled', `off at nerve ${offAt} after ${offFrame - start} frames`);
  t.ok(m.s[W.phase] === PH.FIGHT, 'still fighting (timer running)');
}
{
  // hit gain: landing a hit restores NERVE (+500)
  const m = at(-0.4, 0.4);
  devSet(m, 0, 'nerve', 30000);
  script(m, 1, () => [I.L, 0]);
  const n0 = fs(m, 0).nerve;
  run(m, 3, 0, 0);
  t.ok(fs(m, 0).nerve - n0 >= sys.nerve.hitGain, 'landing a hit restores NERVE', `+${fs(m, 0).nerve - n0}`);
}
{
  // punish counter drains the defender's NERVE
  const m = at(-0.7, 0.7);
  script(m, 30, (k) => [k === 1 ? I.M : 0, k === 0 ? I.L : 0]);
  t.ok(fs(m, 1).nerve < MAXN, 'punish counter drains the defender NERVE', `${fs(m, 1).nerve}`);
}

void sb;
t.done();
