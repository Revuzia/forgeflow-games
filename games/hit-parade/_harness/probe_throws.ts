// probe_throws (G2, lane SIM): throws and command grabs (CONTRACT §4.3.8, FIGHTING_DESIGN §3c).
// 5 f startup, 0.60 m range (+ body), whiff total 30, L+M chord within 2 frames, KD +21 fwd,
// back throw side switch, 9-frame tech window (frame 10 fails), throw vs throw = tech, strike beats
// throw (probe_hits), unthrowable: prejump / airborne / back dash 1-15 / +2 f after stun /
// +1 f after wakeup; punish-counter throws +70%, hard KD, 1 NERVE bar, untechable; throws beat
// parry as punish counters; 360 command grab (unblockable, untechable, hard KD).
import { fixtureData, newMatch, place, run, fs, evs, I, tester, dirBits, sb } from './fixtures/simkit.ts';
import { step } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { EV } from '../runtime/src/core/sim/events.ts';
import { F, ST } from '../runtime/src/core/sim/layout.ts';

const t = tester('probe_throws');
const data = fixtureData();
const sys = data.system;
const A = data.fighters.kit_a.moves;
const B = data.fighters.kit_b.moves;

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
function at(x0: number, x1: number): Match {
  const m = newMatch();
  place(m, x0, x1);
  run(m, 2, 0, 0);
  return m;
}
function isFree(m: Match, i: number): boolean {
  const st = m.s[sb(i) + F.st];
  return st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B;
}

// ------------------------------------------------------------------ connect, startup, damage, KD advantage
{
  const m = at(-0.35, 0.35);
  let atkFree = -1;
  let defFree = -1;
  const from = script(m, 120, (k) => {
    if (k > 0 && atkFree < 0 && isFree(m, 0)) atkFree = k;
    if (k > 5 && defFree < 0 && isFree(m, 1)) defFree = k;
    return [k === 0 ? I.THROW : 0, 0];
  });
  const th = evs(m, from).find((e) => e.type === EV.THROW);
  t.eq(th ? th.frame - from + 1 : -1, A['throw_f'].startup, 'throw connects on frame 5');
  t.eq(11000 - fs(m, 1).hp, A['throw_f'].damage!, 'forward throw damage 1200');
  t.eq(defFree - atkFree, A['throw_f'].hitstun! - (A['throw_f'].active + A['throw_f'].recovery), 'forward throw KD advantage +21');
  t.eq(count(m, from, EV.KNOCKDOWN), 1, 'thrown fighter is knocked down');
}
// whiff
{
  const m = at(-0.7, 0.7);
  let atkFree = -1;
  const from = script(m, 60, (k) => {
    if (k > 0 && atkFree < 0 && isFree(m, 0)) atkFree = k;
    return [k === 0 ? I.THROW : 0, 0];
  });
  t.eq(count(m, from, EV.THROW), 0, 'throw at 1.4 m whiffs');
  t.eq(atkFree - 1, A['throw_f'].startup + A['throw_f'].active + A['throw_f'].recovery - 1, 'throw whiff total 30 frames (observed one callback later)');
}
// L+M chord within 2 frames (L then M next frame replaces the jab)
{
  const m = at(-0.35, 0.35);
  const from = script(m, 30, (k) => [k === 0 ? I.L : k === 1 ? I.L | I.M : k < 3 ? I.L | I.M : 0, 0]);
  t.eq(count(m, from, EV.THROW), 1, 'L then M one frame later = THROW (chord within 2 frames)');
  const m2 = at(-0.35, 0.35);
  const from2 = script(m2, 30, (k) => [k === 0 ? I.L : k === 3 ? I.L | I.M : k < 3 ? I.L : 0, 0]);
  t.eq(count(m2, from2, EV.THROW), 0, 'M three frames after L is not a throw chord');
}
// back throw switches sides
{
  const m = at(-0.35, 0.35);
  script(m, 80, (k) => [k === 0 ? dirBits(m, 0, 4) | I.THROW : 0, 0]);
  t.ok(fs(m, 1).x < fs(m, 0).x, 'back throw: the victim ends up behind the thrower', `p1 ${fs(m, 0).x.toFixed(2)} p2 ${fs(m, 1).x.toFixed(2)}`);
}
// tech window
function techAt(delay: number): { tech: number; dmg: number } {
  const m = at(-0.35, 0.35);
  const connect = A['throw_f'].startup - 1; // k of the connect frame
  const from = script(m, 90, (k) => [k === 0 ? I.THROW : 0, k === connect + delay ? I.THROW : 0]);
  return { tech: count(m, from, EV.THROW_TECH), dmg: 11000 - fs(m, 1).hp };
}
{
  const a = techAt(3);
  t.ok(a.tech === 1 && a.dmg === 0, 'tech 3 frames after the grab: THROW_TECH, no damage');
  const b = techAt(sys.throw.techWindow - 1);
  t.ok(b.tech === 1 && b.dmg === 0, `tech on the 9th frame of being thrown succeeds`);
  const c = techAt(sys.throw.techWindow);
  t.ok(c.tech === 0 && c.dmg === A['throw_f'].damage, 'tech on the 10th frame fails (damage lands)', JSON.stringify(c));
}
// throw vs throw same frame
{
  const m = at(-0.35, 0.35);
  const from = script(m, 30, (k) => [k === 0 ? I.THROW : 0, k === 0 ? I.THROW : 0]);
  t.ok(count(m, from, EV.THROW_TECH) === 1 && count(m, from, EV.THROW) === 0, 'simultaneous throws = tech');
}
// unthrowable states
{
  const m = at(-0.35, 0.35);
  const from = script(m, 30, (k) => [k === 0 ? I.THROW : 0, k === 0 ? dirBits(m, 1, 8) : 0]);
  t.eq(count(m, from, EV.THROW), 0, 'prejump frames are unthrowable');
}
{
  const m = at(-0.35, 0.35);
  const back = dirBits(m, 1, 4);
  // P2 back dash (4,5,4), P1 throws into dash frames 1..15
  const from = script(m, 30, (k) => [k === 3 ? I.THROW : 0, k === 0 || k === 2 ? back : 0]);
  t.eq(count(m, from, EV.THROW), 0, 'back dash frames 1-15 are throw-invulnerable');
}
{
  const m = at(-0.35, 0.35);
  const hold = dirBits(m, 1, 4);
  run(m, 2, 0, hold);
  let inv = -1;
  script(m, 40, (k) => {
    if (inv < 0 && k > 3 && isFree(m, 1)) inv = m.s[sb(1) + F.invT];
    return [k === 0 ? I.L : 0, hold];
  });
  t.eq(inv, sys.throw.postStunInvuln, 'leaving blockstun: 2 frames throw-invulnerable');
}
{
  const m = at(-0.35, 0.35);
  let inv = -1;
  script(m, 120, (k) => {
    if (inv < 0 && k > 10 && m.s[sb(1) + F.st] === ST.IDLE) inv = m.s[sb(1) + F.invT];
    return [k === 0 ? I.THROW : 0, 0];
  });
  t.eq(inv, sys.throw.wakeupInvuln, 'after wakeup: 1 frame throw-invulnerable');
}
/** Puts P2 into the recovery of its 5H (setup only: the move data decides everything after). */
function p2InRecovery(m: Match): void {
  const b = sb(1);
  const k = m.cf[1].moves.findIndex((mv) => mv.id === '5H');
  m.s[b + F.st] = ST.ATTACK;
  m.s[b + F.mv] = k;
  m.s[b + F.mvF] = 24;
  m.s[b + F.mvInst] = 7;
}
// punish-counter throw
{
  const m = at(-0.35, 0.35);
  const n0 = 60000;
  p2InRecovery(m);
  const from = script(m, 30, (k) => [k === 0 ? I.THROW : 0, k === 6 ? I.THROW : 0]);
  run(m, 80, 0, 0);
  t.eq(count(m, from, EV.PUNISH, 0), 1, 'throw into 5H recovery = punish counter');
  t.eq(11000 - fs(m, 1).hp, Math.trunc((A['throw_f'].damage! * sys.counter.pcThrowDamagePct) / 100), 'punish-counter throw +70% damage');
  t.eq(count(m, from, EV.THROW_TECH), 0, 'punish-counter throw is untechable');
  t.ok(fs(m, 1).nerve <= n0 - sys.nerve.bar + 5000, 'punish-counter throw drains a NERVE bar', `nerve ${fs(m, 1).nerve}`);
  void B;
}
{
  // hard knockdown after a PC throw: no back rise even when holding 2 buttons
  const m = at(-0.35, 0.35);
  p2InRecovery(m);
  let wake = -1;
  script(m, 140, (k) => {
    for (const e of evs(m, m.frame())) if (e.type === EV.WAKEUP && e.a === 1) wake = e.b;
    return [k === 0 ? I.THROW : 0, k > 20 ? I.L | I.H : 0];
  });
  t.eq(wake, 0, 'punish-counter throw = hard knockdown (back rise refused)');
}
{
  // soft knockdown: holding 2 buttons = back rise
  const m = at(-0.35, 0.35);
  let wake = -1;
  script(m, 120, (k) => {
    for (const e of evs(m, m.frame())) if (e.type === EV.WAKEUP && e.a === 1) wake = e.b;
    return [k === 0 ? I.THROW : 0, k > 10 ? I.L | I.H : 0];
  });
  t.eq(wake, 1, 'soft knockdown + 2 buttons held = back rise');
}
// throw beats parry (punish counter, unbreakable)
{
  const m = at(-0.35, 0.35);
  const from = script(m, 30, (k) => [k === 3 ? I.THROW : 0, k < 20 ? I.PARRY : 0]);
  t.ok(count(m, from, EV.THROW) === 1 && count(m, from, EV.PUNISH, 0) === 1, 'throw beats a held parry as a punish counter');
}
// 360 command grab (kit_b): unblockable, untechable, hard KD
{
  const m = at(-0.6, 0.6);
  const hold = dirBits(m, 0, 4);
  const seq = [6, 2, 4].map((d) => dirBits(m, 1, d));
  seq[2] |= I.L;
  const from = script(m, 140, (k) => [k === 8 ? I.THROW : hold, k < 3 ? seq[k] : 0]);
  const th = evs(m, from).find((e) => e.type === EV.THROW && e.a === 1);
  t.ok(th !== undefined && th.d === 1, '360 + L = command grab through a blocking opponent');
  t.eq(10000 - fs(m, 0).hp, B['slam_l'].damage!, 'command grab damage 2500');
  t.eq(count(m, from, EV.THROW_TECH), 0, 'command grab cannot be teched');
  const kd = evs(m, from).find((e) => e.type === EV.KNOCKDOWN && e.a === 0);
  t.eq(kd ? kd.b : -1, 2, 'command grab = hard knockdown');
}
{
  const m = at(-1.0, 1.0);
  const seq = [6, 2, 4].map((d) => dirBits(m, 1, d));
  seq[2] |= I.L;
  const from = script(m, 20, (k) => [0, k < 3 ? seq[k] : 0]);
  t.eq(count(m, from, EV.THROW), 0, 'command grab whiffs outside its reach (2.0 m)');
}

// ------------------------------------------------------------------ CONTRACT 20.2 grab blocks (kit_b throws)
{
  // forward throw with grab {frames 40, adv 21, hitF 25}: lock, damage frame, release advantage, anim
  const m = newMatch({ p1: 'kit_b', p2: 'kit_a' });
  place(m, -0.45, 0.45);
  run(m, 2, 0, 0);
  const g = B['throw_f'].grab!;
  let connect = -1;
  let dmgAt = -1;
  let atkFree = -1;
  let defFree = -1;
  let grabState = 0;
  let grabAnimOk = false;
  const want = m.tab.anims[0].findIndex((a) => a.clip === g.clip && a.moveId >= 0);
  const hp0 = fs(m, 1).hp;
  const from = script(m, 140, (k) => {
    const e = evs(m, m.frame());
    if (connect < 0 && e.some((q) => q.type === EV.THROW)) connect = k - 1;
    if (dmgAt < 0 && fs(m, 1).hp < hp0) dmgAt = k - 1;
    if (m.s[sb(0) + F.st] === ST.GRAB) {
      grabState++;
      if (fs(m, 0).animId === want) grabAnimOk = true;
    }
    if (connect >= 0 && atkFree < 0 && isFree(m, 0)) atkFree = k;
    if (connect >= 0 && defFree < 0 && isFree(m, 1)) defFree = k;
    return [k === 0 ? I.THROW : 0, 0];
  });
  t.ok(connect >= 0, 'grab-block throw connects');
  t.eq(grabState, g.frames, 'attacker locked in GRAB for grab.frames (40)');
  t.eq(dmgAt - connect + 1, g.hitF, 'grab damage lands on lock frame hitF (25)');
  t.eq(defFree - atkFree, g.adv, 'release leaves the thrower grab.adv ahead (+21)');
  t.ok(grabAnimOk && want >= 0, 'attacker shows the grab clip (anim table entry after taunt)', `anim ${want}`);
  t.eq(10000 - fs(m, 1).hp, B['throw_f'].damage!, 'grab-block throw damage');
  void from;
}
{
  // back throw with swap: sides switch on release
  const m = newMatch({ p1: 'kit_b', p2: 'kit_a' });
  place(m, -0.45, 0.45);
  run(m, 2, 0, 0);
  script(m, 120, (k) => [k === 0 ? dirBits(m, 0, 4) | I.THROW : 0, 0]);
  t.ok(fs(m, 1).x < fs(m, 0).x, 'grab.swap: the victim lands on the other side', `p1 ${fs(m, 0).x.toFixed(2)} p2 ${fs(m, 1).x.toFixed(2)}`);
}
{
  // grab-block reach = pushbox front to pushbox front within throwRangeM (0.77 m for kit_b)
  const reach = (gapM: number): number => {
    const m = newMatch({ p1: 'kit_b', p2: 'kit_a' });
    const halfs = 0.6 / 2 + 0.46 / 2;
    place(m, -(halfs + gapM) / 2, (halfs + gapM) / 2);
    run(m, 2, 0, 0);
    const from = script(m, 20, (k) => [k === 0 ? I.THROW : 0, 0]);
    return count(m, from, EV.THROW);
  };
  t.eq(reach(0.75), 1, 'grab reach: pushbox gap 0.75 m <= throwRangeM 0.77 connects');
  t.eq(reach(0.8), 0, 'grab reach: pushbox gap 0.80 m whiffs');
}
{
  // grab-block throw is techable in the 9-frame window
  const m = newMatch({ p1: 'kit_b', p2: 'kit_a' });
  place(m, -0.45, 0.45);
  run(m, 2, 0, 0);
  const from = script(m, 60, (k) => [k === 0 ? I.THROW : 0, k === 7 ? I.THROW : 0]);
  t.eq(count(m, from, EV.THROW_TECH), 1, 'grab-block throw: techable (grab.techable)');
}

t.done();
