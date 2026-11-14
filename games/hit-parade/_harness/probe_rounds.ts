// probe_rounds (G2, lane SIM): rounds (CONTRACT §4.3.11). Intro length + events, timer (1 per 60
// frames; frozen in super freeze and cinematics), KO sequence (KO hitstop 30, slow-mo 45 frames with
// physics every 4th frame, outro, ROUND_END), result decided on the KO frame, time-out verdict
// (strict HP fraction, exact tie = draw, ARCADE last-round tie = CPU), draw rounds, double KO,
// sudden death, max 5 rounds (drawn match), first to 2, MATCH_END, training (no KO, no timer).
import { fixtureData, newMatch, place, run, fs, ms, evs, I, tester, dirBits, sb, lxU } from './fixtures/simkit.ts';
import { step, devSet } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { EV } from '../runtime/src/core/sim/events.ts';
import { F, PH, W } from '../runtime/src/core/sim/layout.ts';

const t = tester('probe_rounds');
const data = fixtureData();
const sys = data.system;

function untilPhase(m: Match, ph: number, max = 20000): number {
  let n = 0;
  while (m.s[W.phase] !== ph && n < max) {
    step(m, 0, 0);
    n++;
  }
  return n;
}
function koP2(m: Match): number {
  place(m, -0.4, 0.4);
  devSet(m, 1, 'hp', 1);
  const from = m.frame() + 1;
  for (let k = 0; k < 10 && m.s[W.phase] === PH.FIGHT; k++) step(m, k === 0 ? I.L : 0, 0);
  return from;
}

// ------------------------------------------------------------------ intro
{
  const m = newMatch({ skipIntro: false });
  const n = untilPhase(m, PH.FIGHT);
  const e = evs(m, 0);
  t.eq(n, sys.round.introFrames, 'round intro lasts introFrames (90)');
  t.ok(e.some((q) => q.type === EV.ROUND_INTRO && q.a === 1) && e.some((q) => q.type === EV.FIGHT), 'ROUND_INTRO then FIGHT events');
  t.eq(ms(m).timer, sys.round.timer, 'timer shows 99 at FIGHT');
  run(m, 60, 0, 0);
  t.eq(ms(m).timer, sys.round.timer - 1, 'timer counts 1 per 60 frames');
}
// ------------------------------------------------------------------ timer frozen in super freeze + cinematic
{
  const m = newMatch();
  place(m, -0.45, 0.45);
  devSet(m, 0, 'showtime', 30000);
  const t0 = m.s[W.timer];
  const seq = '214214'.split('').map((d) => dirBits(m, 0, Number(d)));
  seq[5] |= I.L;
  for (const w of seq) step(m, w, 0);
  let frames = 6;
  let frozenFrames = 0;
  for (let k = 0; k < 260; k++) {
    const before = m.s[W.timer];
    step(m, 0, 0);
    frames++;
    if (m.s[W.timer] === before) frozenFrames++;
  }
  const cin = data.fighters.kit_a.moves['main_event'].cinematic!.frames;
  t.eq(frozenFrames, sys.super.freeze3 + cin, 'timer frozen for the super freeze + the whole cinematic');
  t.eq(t0 - m.s[W.timer], frames - frozenFrames, 'timer runs on every other frame');
}
// ------------------------------------------------------------------ KO sequence
{
  const m = newMatch();
  const from = koP2(m);
  const ko = evs(m, from).find((e) => e.type === EV.KO);
  t.ok(ko !== undefined && ko.a === 0 && ko.b === 1 && ko.c === 0, 'KO event: winner 0, loser 1, not match-deciding');
  t.eq(m.s[W.wins0], 1, 'round result decided on the KO frame');
  const y0 = m.s[sb(1) + F.y];
  const x0 = lxU(m, 1); // CHANGED(SIM3D): line coordinate (+ z below)
  const z0 = m.s[sb(1) + F.z];
  let moved = 0;
  for (let k = 0; k < sys.round.koHitstop; k++) {
    step(m, 0, 0);
    if (m.s[sb(1) + F.y] !== y0 || lxU(m, 1) !== x0 || m.s[sb(1) + F.z] !== z0) moved++;
  }
  t.eq(moved, 0, 'KO hitstop: 30 frames frozen');
  let changes = 0;
  let slowFlag = 0;
  let prevY = m.s[sb(1) + F.y];
  for (let k = 0; k < sys.round.koSlowmoFrames; k++) {
    step(m, 0, 0);
    if (ms(m).slowmo) slowFlag++;
    const y = m.s[sb(1) + F.y];
    if (y !== prevY) changes++;
    prevY = y;
  }
  const expected = Math.floor(sys.round.koSlowmoFrames / sys.round.koSlowmoEvery);
  t.ok(changes <= expected && changes >= expected - 2, 'KO slow-mo: physics only every 4th frame', `${changes} position changes in 45 frames (<= ${expected})`);
  t.ok(slowFlag >= sys.round.koSlowmoFrames - 1, 'MatchSnap.slowmo during the slow-mo');
  const n = untilPhase(m, PH.INTRO);
  const re = evs(m, from).find((e) => e.type === EV.ROUND_END);
  t.ok(re !== undefined && re.a === 0 && m.s[W.round] === 2 && n > 0, 'ROUND_END then round 2 intro');
  t.ok(fs(m, 1).hp === 11000 && fs(m, 0).nerve === sys.nerve.bar * sys.nerve.bars, 'round 2 resets HP and NERVE');
}
// ------------------------------------------------------------------ match end
{
  const m = newMatch();
  koP2(m);
  untilPhase(m, PH.INTRO);
  untilPhase(m, PH.FIGHT);
  const from = koP2(m);
  const ko = evs(m, from).find((e) => e.type === EV.KO);
  t.ok(ko !== undefined && ko.c === 1, 'second KO is match-deciding (KO c = 1)');
  untilPhase(m, PH.MATCH_END);
  const me = evs(m, from).find((e) => e.type === EV.MATCH_END);
  t.ok(me !== undefined && me.a === 0 && ms(m).winner === 0 && ms(m).phase === 'matchEnd', 'MATCH_END: P1 wins 2-0');
  run(m, 200, I.L, I.L);
  t.ok(ms(m).wins[0] === 2 && ms(m).wins[1] === 0 && ms(m).phase === 'matchEnd', 'match stays over');
}
// ------------------------------------------------------------------ time-out verdicts
function timeout(o: { hp0: number; hp1: number; mode?: 'versus' | 'arcade'; cpu2?: number; wins?: [number, number] }): Match {
  const m = newMatch({ timer: 2, mode: o.mode, cpu2: o.cpu2 });
  if (o.wins) {
    m.s[W.wins0] = o.wins[0];
    m.s[W.wins1] = o.wins[1];
  }
  place(m, -2, 2);
  devSet(m, 0, 'hp', o.hp0);
  devSet(m, 1, 'hp', o.hp1);
  untilPhase(m, PH.TIMEOVER, 400);
  return m;
}
{
  const m = timeout({ hp0: 5000, hp1: 5500 });
  t.eq(ms(m).roundWinner, 2, 'time-out: 5000/10000 vs 5500/11000 is an exact fraction tie = draw');
  t.ok(ms(m).wins[0] === 1 && ms(m).wins[1] === 1, 'a draw round counts as a win for both');
  const m2 = timeout({ hp0: 5000, hp1: 5499 });
  t.eq(ms(m2).roundWinner, 0, 'time-out: strict fraction (5000/10000 > 5499/11000) -> P1');
  const m3 = timeout({ hp0: 5000, hp1: 10000 });
  t.eq(ms(m3).roundWinner, 1, 'time-out: more HP fraction wins (P2)');
  const e = evs(m3, 0).find((q) => q.type === EV.TIMEOVER);
  t.ok(e !== undefined && e.a === 1, 'TIMEOVER event carries the round winner');
}
{
  const m = timeout({ hp0: 5000, hp1: 5500, mode: 'arcade', cpu2: 3, wins: [1, 1] });
  t.eq(ms(m).roundWinner, 1, 'ARCADE: an exact tie on the last round goes to the CPU');
  untilPhase(m, PH.MATCH_END, 400);
  t.eq(ms(m).winner, 1, 'ARCADE: CPU wins the match on that tie');
  const m2 = timeout({ hp0: 5000, hp1: 5500, mode: 'versus', wins: [1, 1] });
  t.ok(ms(m2).roundWinner === 2 && ms(m2).wins[0] === 1 && ms(m2).wins[1] === 1, 'VERSUS: a tie at match point = sudden death (nobody scores)');
}
{
  // max 5 rounds: draws all the way -> drawn match
  const m = newMatch({ timer: 1 });
  let n = 0;
  while (m.s[W.phase] !== PH.MATCH_END && n++ < 20000) {
    if (m.s[W.phase] === PH.FIGHT && m.s[W.phaseF] === 0) {
      place(m, -2, 2);
      devSet(m, 0, 'hp', 5000);
      devSet(m, 1, 'hp', 5500);
    }
    step(m, 0, 0);
  }
  t.ok(ms(m).round === sys.round.maxRounds && ms(m).draw && ms(m).winner === -1, 'five drawn rounds = drawn match (max 5 rounds)', `round ${ms(m).round} draw ${ms(m).draw}`);
}
// ------------------------------------------------------------------ double KO
{
  const m = newMatch();
  place(m, -0.4, 0.4);
  devSet(m, 0, 'hp', 1);
  devSet(m, 1, 'hp', 1);
  const from = m.frame() + 1;
  for (let k = 0; k < 10; k++) step(m, k === 1 ? I.L : 0, k === 0 ? I.L : 0);
  const ko = evs(m, from).find((e) => e.type === EV.KO);
  t.ok(ko !== undefined && ko.a === -1 && ko.b === -1 && ms(m).roundWinner === 2, 'trade KO = double KO (draw round)');
}
// ------------------------------------------------------------------ training
{
  const m = newMatch({ mode: 'training' });
  t.eq(ms(m).timer, -1, 'training: infinite timer');
  place(m, -0.4, 0.4);
  devSet(m, 1, 'hp', 1);
  run(m, 20, I.L, 0);
  t.ok(fs(m, 1).hp >= 1 && ms(m).phase === 'fight', 'training: no KO (HP floor 1)');
  run(m, 400, 0, 0);
  t.eq(fs(m, 1).hp, 11000, 'training: HP refills after the combo ends');
}

t.done();
