// probe_hits (G2, lane SIM): per-frame hit resolution (CONTRACT §4.3 items 3, 5, 6).
// Counter hit (+2 f, +20%), punish counter (+4 f, +20%), trades (both hit, both counter), strike
// beats throw on the same frame, hitstop per strength (+4 on punish-counter heavies), damage
// scaling (general + light-starter tables), super minimums (30% / 50%), grey HP (armor -> grey,
// 120 f delay, +2/f, lost on a real hit), juggle JL/JC rule, air reset, wall splat (1 per combo),
// ground bounce (1 per combo), IMPACT crumple, hurtbox extensions, strike invulnerability.
import { fixtureData, newMatch, place, run, fs, evs, I, tester, dirBits, sb } from './fixtures/simkit.ts';
import { step, devSet } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { EV } from '../runtime/src/core/sim/events.ts';
import { CF, F, FL, ST } from '../runtime/src/core/sim/layout.ts';

const t = tester('probe_hits');
const data = fixtureData();
const sys = data.system;
const A = data.fighters.kit_a.moves;
const B = data.fighters.kit_b.moves;

/** Runs `n` frames; `f(k)` returns [in1, in2] for frame k. Returns the first frame number. */
function script(m: Match, n: number, f: (k: number) => [number, number]): number {
  const first = m.frame() + 1;
  for (let k = 0; k < n; k++) {
    const [a, b] = f(k);
    step(m, a, b);
  }
  return first;
}
function count(m: Match, from: number, type: number, a = -1): number {
  return evs(m, from).filter((e) => e.type === type && (a < 0 || e.a === a)).length;
}
function at(m: Match, x0: number, x1: number): Match {
  place(m, x0, x1);
  run(m, 2, 0, 0);
  return m;
}

// ------------------------------------------------------------------ counter hit
{
  const m = at(newMatch(), -0.4, 0.4);
  const from = script(m, 40, (k) => [k === 3 ? I.L : 0, k === 0 ? I.H : 0]);
  t.eq(count(m, from, EV.COUNTER, 0), 1, 'jab into the startup of 5H = COUNTER event');
  t.eq(11000 - fs(m, 1).hp, Math.trunc((A['5L'].damage! * sys.counter.chDamagePct) / 100), 'counter hit damage x1.2');
  t.eq(m.s[sb(1) + F.lastStun], A['5L'].hitstun! + sys.counter.chFrames, 'counter hit hitstun +2');
}
// ------------------------------------------------------------------ punish counter
{
  const m = at(newMatch(), -0.7, 0.7);
  const from = script(m, 60, (k) => [k === 1 ? I.M : 0, k === 0 ? I.L : 0]);
  t.eq(count(m, from, EV.PUNISH, 0), 1, '5M into the recovery of a whiffed 5L = PUNISH event');
  const derived5M = A['5M'].damage!;
  t.eq(11000 - fs(m, 1).hp, Math.trunc((derived5M * sys.counter.pcDamagePct) / 100), 'punish counter damage x1.2');
  t.eq(m.s[sb(1) + F.lastStun], A['5M'].hitstun! + sys.counter.pcFrames, 'punish counter hitstun +4');
}
// ------------------------------------------------------------------ trade
{
  const m = at(newMatch(), -0.4, 0.4);
  const from = script(m, 40, (k) => [k === 1 ? I.L : 0, k === 0 ? I.L : 0]);
  const hits = evs(m, from).filter((e) => e.type === EV.HIT);
  t.ok(hits.length === 2 && hits[0].frame === hits[1].frame, 'same-frame jabs trade (two HIT events on one frame)', JSON.stringify(hits.map((h) => [h.frame, h.a])));
  t.eq(count(m, from, EV.COUNTER), 2, 'trade: both sides counter-hit');
  t.eq(10000 - fs(m, 0).hp, Math.trunc((B['5L'].damage! * 120) / 100), 'trade: P1 takes the counter-hit damage');
  t.eq(11000 - fs(m, 1).hp, Math.trunc((A['5L'].damage! * 120) / 100), 'trade: P2 takes the counter-hit damage');
}
// ------------------------------------------------------------------ strike beats throw
{
  const m = at(newMatch(), -0.35, 0.35);
  const from = script(m, 40, (k) => [k === 1 ? I.L : 0, k === 0 ? I.THROW : 0]);
  t.eq(count(m, from, EV.THROW), 0, 'a strike landing on the throw\'s active frame beats the throw');
  t.eq(count(m, from, EV.HIT, 0), 1, 'strike vs throw: the strike hits');
}
// ------------------------------------------------------------------ hitstop per strength
for (const [id, btn, hs] of [['5L', I.L, 9], ['5M', I.M, 11], ['5H', I.H, 13]] as const) {
  const m = at(newMatch(), -0.4, 0.4);
  step(m, btn, 0);
  let hitF = -1;
  let resumed = -1;
  for (let k = 0; k < 40; k++) {
    const before = m.s[sb(0) + F.mvF];
    step(m, 0, 0);
    if (hitF < 0 && evs(m, m.frame()).some((e) => e.type === EV.HIT)) hitF = m.frame();
    else if (hitF > 0 && resumed < 0 && m.s[sb(0) + F.mvF] !== before) resumed = m.frame();
  }
  t.eq(resumed - hitF - 1, hs, `${id} hitstop ${hs} frames (both frozen)`);
  void A[id];
}
{
  // punish counter on a heavy normal: +4 hitstop
  const m = at(newMatch(), -0.7, 0.7);
  let hitF = -1;
  let resumed = -1;
  script(m, 70, (k) => {
    if (k > 0 && hitF < 0 && evs(m, m.frame()).some((e) => e.type === EV.PUNISH)) hitF = m.frame();
    return [k === 1 ? I.H : 0, k === 0 ? I.L : 0];
  });
  // measure with a second run that watches mvF
  const m2 = at(newMatch(), -0.7, 0.7);
  hitF = -1;
  for (let k = 0; k < 70; k++) {
    const before = m2.s[sb(0) + F.mvF];
    step(m2, k === 1 ? I.H : 0, k === 0 ? I.L : 0);
    if (hitF < 0 && evs(m2, m2.frame()).some((e) => e.type === EV.PUNISH)) hitF = m2.frame();
    else if (hitF > 0 && resumed < 0 && m2.s[sb(0) + F.mvF] !== before) resumed = m2.frame();
  }
  t.eq(resumed - hitF - 1, A['5H'].hitstop! + sys.hitstop.pcHeavyBonus, 'punish counter 5H: hitstop 13 + 4');
}
// ------------------------------------------------------------------ damage scaling
{
  // light starter: 5L, 5L, 5L chain -> 100%, 80%, 70%
  const m = at(newMatch(), -0.3, 0.3);
  const hpSeq: number[] = [];
  let last = fs(m, 1).hp;
  for (let k = 0; k < 70; k++) {
    step(m, k % 7 === 0 && k < 21 ? I.L : 0, 0);
    const hp = fs(m, 1).hp;
    if (hp !== last) hpSeq.push(last - hp);
    last = hp;
  }
  const d = A['5L'].damage!;
  const want = [d, Math.trunc((d * sys.scaling.light[1]) / 100), Math.trunc((d * sys.scaling.light[2]) / 100)];
  t.ok(JSON.stringify(hpSeq) === JSON.stringify(want), 'light-starter scaling 5L,5L,5L = 100/80/70%', `${hpSeq} vs ${want}`);
}
{
  // general table: 5M then target combo tc_5h -> 100%, 100%
  const m = at(newMatch(), -0.4, 0.4);
  const hpSeq: number[] = [];
  let last = fs(m, 1).hp;
  for (let k = 0; k < 60; k++) {
    step(m, k === 0 ? I.M : k === 10 ? I.H : 0, 0);
    const hp = fs(m, 1).hp;
    if (hp !== last) hpSeq.push(last - hp);
    last = hp;
  }
  t.ok(JSON.stringify(hpSeq) === JSON.stringify([A['5M'].damage, A['tc_5h'].damage]), 'general scaling 5M > tc_5h = 100/100%', String(hpSeq));
}
{
  // super minimum 30%: a Lv1 landing as attack #9 of a light-starter combo (10%) deals 30%
  const m = at(newMatch(), -0.45, 0.45);
  devSet(m, 0, 'showtime', 10000);
  const bd = sb(1);
  m.s[bd + F.cCount] = 8;
  m.s[bd + F.cStep] = 8;
  m.s[bd + F.cStarter] = 1;
  m.s[bd + F.cLastInst] = -5;
  m.s[bd + F.st] = ST.HITSTUN;
  m.s[bd + F.stun] = 80;
  const hp0 = fs(m, 1).hp;
  const seq = '236236'.split('').map((dd) => dirBits(m, 0, Number(dd)));
  seq[5] |= I.L;
  for (const w of seq) step(m, w, 0);
  run(m, 60, 0, 0);
  t.eq(hp0 - fs(m, 1).hp, Math.trunc((A['sold_out'].damage! * sys.scaling.superMinPct.super1) / 100), 'Lv1 super never below 30% (attack #9 would be 10%)');
}
{
  const m = at(newMatch(), -0.45, 0.45);
  devSet(m, 0, 'showtime', 30000);
  const bd = sb(1);
  m.s[bd + F.cCount] = 8;
  m.s[bd + F.cStep] = 8;
  m.s[bd + F.cStarter] = 1;
  m.s[bd + F.cLastInst] = -5;
  m.s[bd + F.st] = ST.HITSTUN;
  m.s[bd + F.stun] = 80;
  const hp0 = fs(m, 1).hp;
  const seq = '214214'.split('').map((dd) => dirBits(m, 0, Number(dd)));
  seq[5] |= I.L;
  for (const w of seq) step(m, w, 0);
  run(m, 260, 0, 0);
  const want = A['main_event'].cinematic!.hits.reduce((acc, h) => acc + Math.trunc((h[1] * sys.scaling.superMinPct.super3) / 100), 0);
  t.eq(hp0 - fs(m, 1).hp, want, 'Lv3 cinematic hits never below 50%');
}
// ------------------------------------------------------------------ grey HP (armor) + regen + lost on a real hit
{
  const m = at(newMatch(), -0.45, 0.45);
  // P2 armored step (214M); P1 jabs into the armor frames
  const seq2 = [dirBits(m, 1, 2), dirBits(m, 1, 1), dirBits(m, 1, 4) | I.M];
  const from = script(m, 6, (k) => [k === 4 ? I.L : 0, k < 3 ? seq2[k] : 0]);
  run(m, 6, 0, 0);
  t.eq(count(m, from, EV.IMPACT_ARMOR), 1, 'armored step absorbs the jab (IMPACT_ARMOR event)');
  const p2 = fs(m, 1);
  t.eq(p2.greyHp, A['5L'].damage!, 'absorbed damage becomes grey HP');
  t.ok(p2.moveName === 'step', 'armored move keeps going', p2.moveName);
  // let it resolve, then idle far apart and watch grey regenerate
  run(m, 60, 0, 0);
  place(m, -3, 3);
  const g0 = fs(m, 1).greyHp;
  const hp0 = fs(m, 1).hp;
  run(m, sys.grey.delay - 30, 0, 0);
  run(m, 20, 0, 0);
  const g1 = fs(m, 1).greyHp;
  const hp1 = fs(m, 1).hp;
  t.ok(g0 > 0 && hp1 - hp0 === g0 - g1 && g1 < g0, 'grey HP regenerates after the delay (+2/frame)', `grey ${g0}->${g1} hp ${hp0}->${hp1}`);
}
{
  const m = at(newMatch(), -0.45, 0.45);
  const bd = sb(1);
  m.s[bd + F.grey] = 400;
  m.s[bd + F.hp] = 10600;
  step(m, I.L, 0);
  run(m, 20, 0, 0);
  t.eq(fs(m, 1).greyHp, 0, 'a real hit clears grey HP (lost for good)');
}
// ------------------------------------------------------------------ juggles
{
  const mk = (): Match => {
    const m = at(newMatch(), -0.4, 0.4);
    const bd = sb(1);
    m.s[bd + F.st] = ST.JUGGLE;
    m.s[bd + F.flags] |= FL.AIRBORNE;
    m.s[bd + F.y] = 80000;
    m.s[bd + F.vy] = 0;
    m.s[bd + F.jc] = 1;
    m.s[bd + F.kd] = 1;
    m.s[bd + F.cCount] = 1;
    m.s[bd + F.cStep] = 1;
    return m;
  };
  const m1 = mk();
  const f1 = script(m1, 8, (k) => [k === 0 ? I.L : 0, 0]);
  t.eq(count(m1, f1, EV.HIT, 0), 0, 'juggle: 5L (JL 0) cannot hit a JC 1 juggle');
  const m2 = mk();
  const f2 = script(m2, 8, (k) => [k < 2 ? dirBits(m2, 0, k === 0 ? 6 : 2) : k === 2 ? dirBits(m2, 0, 3) | I.L : 0, 0]);
  t.eq(count(m2, f2, EV.HIT, 0), 1, 'juggle: upper_l (JL 5) hits a JC 1 juggle');
  t.eq(m2.s[sb(1) + F.jc], 1 + A['upper_l'].juggle!.ji!, 'juggle count += JI');
}
{
  // air reset: anti-air 2H on a jumping opponent -> juggle, then LAND (no knockdown)
  const m = at(newMatch(), -0.5, 0.5);
  let reset = false;
  let kd = false;
  script(m, 90, (k) => {
    const st = m.s[sb(1) + F.st];
    if (st === ST.KNOCKDOWN) kd = true;
    if (st === ST.LAND && m.s[sb(1) + F.cCount] >= 0 && k > 10) reset = true;
    return [k === 6 ? dirBits(m, 0, 2) | I.H : dirBits(m, 0, 2), k === 0 ? dirBits(m, 1, 8) : 0];
  });
  t.ok(reset && !kd, 'anti-air on a jumping opponent = air reset (lands on its feet, no knockdown)');
}
// ------------------------------------------------------------------ wall splat (1 per combo)
{
  const m = newMatch();
  place(m, 7.4, 6.6);
  run(m, 2, 0, 0);
  const from = script(m, 40, (k) => [0, k === 0 ? I.H : 0]);
  t.eq(count(m, from, EV.WALL_SPLAT), 1, '5H (wallSplat) near the wall = WALL_SPLAT');
  t.ok((m.s[sb(0) + F.cFlags] & CF.SPLAT) !== 0, 'wall splat marked on the combo');
}
{
  const m = newMatch();
  place(m, 7.4, 6.6);
  run(m, 2, 0, 0);
  const b0 = sb(0);
  m.s[b0 + F.cCount] = 2;
  m.s[b0 + F.cStep] = 2;
  m.s[b0 + F.cFlags] = CF.SPLAT;
  m.s[b0 + F.st] = ST.HITSTUN;
  m.s[b0 + F.stun] = 60;
  const from = script(m, 40, (k) => [0, k === 0 ? I.H : 0]);
  t.eq(count(m, from, EV.WALL_SPLAT), 0, 'second wall splat in the same combo is refused');
}
// ------------------------------------------------------------------ ground bounce (1 per combo)
{
  const m = at(newMatch(), -0.5, 0.5);
  const from = script(m, 60, (k) => [k === 0 ? dirBits(m, 0, 4) | I.H : 0, 0]);
  t.eq(count(m, from, EV.GROUND_BOUNCE), 1, '4H (groundBounce) = one GROUND_BOUNCE');
}
{
  const m = at(newMatch(), -0.5, 0.5);
  const bd = sb(1);
  m.s[bd + F.cCount] = 1;
  m.s[bd + F.cStep] = 1;
  m.s[bd + F.cFlags] = CF.BOUNCE;
  m.s[bd + F.st] = ST.HITSTUN;
  m.s[bd + F.stun] = 60;
  const from = script(m, 60, (k) => [k === 0 ? dirBits(m, 0, 4) | I.H : 0, 0]);
  t.eq(count(m, from, EV.GROUND_BOUNCE), 0, 'second ground bounce in the same combo is refused');
}
// ------------------------------------------------------------------ IMPACT punish counter = crumple
{
  const m = at(newMatch(), -0.75, 0.75);
  const s2 = ['6', '3', '2', '1', '4'].map((d) => dirBits(m, 1, Number(d)));
  s2[4] |= I.L; // 360-ish (63214 has 6,2,4 cardinals) -> slam_l whiff at 1.5 m
  const from = script(m, 90, (k) => [k === 5 ? I.IMPACT : 0, k < 5 ? s2[k] : 0]);
  const whiffed = count(m, from, EV.THROW) === 0;
  t.ok(whiffed, 'slam_l whiffs at 1.5 m (reach 1.22 m + body)');
  t.eq(count(m, from, EV.PUNISH, 0), 1, 'IMPACT into slam recovery = punish counter');
  t.eq(count(m, from, EV.CRUMPLE), 1, 'IMPACT punish counter crumples');
}
// ------------------------------------------------------------------ hurtbox extension (2H) + strike invulnerability (weave)
{
  const m = at(newMatch(), -0.6, 0.6);
  const from = script(m, 40, (k) => [k === 0 ? dirBits(m, 0, 2) | I.H : dirBits(m, 0, 2), k === 5 ? I.L : 0]);
  t.eq(count(m, from, EV.HIT, 1), 1, 'jab at 1.2 m reaches the 2H hurtbox extension');
  const m2 = at(newMatch(), -0.6, 0.6);
  const from2 = script(m2, 40, (k) => [0, k === 5 ? I.L : 0]);
  t.eq(count(m2, from2, EV.HIT, 1), 0, 'control: the same jab whiffs an idle body at 1.2 m');
}
{
  const m = at(newMatch({ s1: 0 }), -0.4, 0.4);
  const from = script(m, 30, (k) => [k === 0 ? dirBits(m, 0, 4) | I.S : 0, k === 1 ? I.L : 0]);
  t.eq(count(m, from, EV.HIT, 1), 0, 'weave (strike-invulnerable 1-14) is not hit by a jab');
  t.ok(fs(m, 0).hp === 10000, 'weave: no damage taken');
}

// ------------------------------------------------------------------ CONTRACT 20.2 hurtOverride + moveY
{
  // duck (hurtOverride h 1.0 m): a high jab whiffs over it, a low jab still hits
  const high = at(newMatch(), -0.45, 0.45);
  const seq = [2, 5, 2].map((d) => dirBits(high, 0, d));
  seq[2] |= I.L;
  const f1 = script(high, 20, (k) => [k < 3 ? seq[k] : 0, k === 3 ? I.L : 0]);
  t.eq(count(high, f1, EV.HIT, 1), 0, 'hurtOverride: a high jab whiffs over the duck (h 1.0 m)');
  const low = at(newMatch(), -0.45, 0.45);
  const seq2 = [2, 5, 2].map((d) => dirBits(low, 0, d));
  seq2[2] |= I.L;
  const f2 = script(low, 20, (k) => [k < 3 ? seq2[k] : 0, k === 3 ? dirBits(low, 1, 2) | I.L : 0]);
  t.eq(count(low, f2, EV.HIT, 1), 1, 'hurtOverride: a low jab hits the duck');
}
{
  // 6H hops (moveY 0.5 m on frames 6-16): airborne there, so a low whiffs and a throw whiffs
  const m = at(newMatch(), -0.45, 0.45);
  let air = 0;
  const from = script(m, 40, (k) => {
    if (fs(m, 0).airborne && fs(m, 0).moveName === '6H') air++;
    return [k === 0 ? dirBits(m, 0, 6) | I.H : 0, k === 6 ? dirBits(m, 1, 2) | I.L : 0];
  });
  t.ok(air >= 10, 'moveY: the fighter is airborne while above the floor', `${air} airborne frames`);
  t.eq(count(m, from, EV.HIT, 1), 0, 'moveY: a low jab passes under the hop');
  const m2 = at(newMatch(), -0.35, 0.35);
  const f3 = script(m2, 40, (k) => [k === 0 ? dirBits(m2, 0, 6) | I.H : 0, k === 6 ? I.THROW : 0]);
  t.eq(count(m2, f3, EV.THROW), 0, 'moveY: airborne frames are unthrowable');
  t.eq(fs(m2, 0).y, 0, 'moveY: back on the floor after the move');
}

t.done();
