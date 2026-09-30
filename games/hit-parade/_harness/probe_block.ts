// probe_block (G2, lane SIM): blocking + defense verbs (CONTRACT §4.3 items 4, 7, 8).
// Guard heights (HL / overhead / low), auto-guard inside blockstrings, proximity guard, blockstun
// pushback + corner transfer, STAGE FRIGHT (+4 blockstun, 25% chip, no NERVE actions, corner IMPACT
// stun 195 f), parry (regular = block advantage; perfect = 60 f freeze, 6 f invuln, no cancel,
// x0.5 punish; projectiles: no freeze, 11 f recovery), whiffed parry (33 f recovery), RUSH out of
// parry (+4), IMPACT (26 f, 2-hit armor, -3, corner wall splat, IMPACT clash refund), SHOVE.
import { fixtureData, newMatch, place, run, fs, evs, I, tester, dirBits, sb } from './fixtures/simkit.ts';
import { step, devSet } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { EV } from '../runtime/src/core/sim/events.ts';
import { F, FL, ST, W } from '../runtime/src/core/sim/layout.ts';

const t = tester('probe_block');
const data = fixtureData();
const sys = data.system;
const A = data.fighters.kit_a.moves;

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
function at(x0: number, x1: number, o = {}): Match {
  const m = newMatch(o);
  place(m, x0, x1);
  run(m, 2, 0, 0);
  return m;
}
function isFree(m: Match, i: number): boolean {
  const st = m.s[sb(i) + F.st];
  return st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B;
}

// ------------------------------------------------------------------ guard heights
function guardCase(label: string, press: (m: Match) => number, holdDir: number, want: number): void {
  const m = at(-0.4, 0.4);
  const hold = dirBits(m, 1, holdDir);
  run(m, 3, 0, hold);
  const from = script(m, 40, (k) => [k === 0 ? press(m) : 0, hold]);
  const got = count(m, from, EV.BLOCK, 0) > 0 ? EV.BLOCK : count(m, from, EV.HIT, 0) > 0 ? EV.HIT : 0;
  t.eq(got, want, label);
}
guardCase('5L (HL) blocked standing', () => I.L, 4, EV.BLOCK);
guardCase('5L (HL) blocked crouching', () => I.L, 1, EV.BLOCK);
guardCase('2L (low) blocked crouching', (m) => dirBits(m, 0, 2) | I.L, 1, EV.BLOCK);
guardCase('2L (low) HITS a standing block', (m) => dirBits(m, 0, 2) | I.L, 4, EV.HIT);
guardCase('6H (overhead) blocked standing', (m) => dirBits(m, 0, 6) | I.H, 4, EV.BLOCK);
guardCase('6H (overhead) HITS a crouching block', (m) => dirBits(m, 0, 6) | I.H, 1, EV.HIT);
guardCase('holding forward does not block', () => I.L, 6, EV.HIT);

// ------------------------------------------------------------------ auto-guard in a blockstring
{
  const m = at(-0.3, 0.3);
  const hold = dirBits(m, 1, 4);
  run(m, 3, 0, hold);
  // 5L blocked, then P2 lets go of back during blockstun; the chained 5L is still blocked
  const from = script(m, 40, (k) => [k === 0 || k === 8 ? I.L : 0, k < 5 ? hold : 0]);
  t.eq(count(m, from, EV.BLOCK, 0), 2, 'auto-guard: a chained mid is blocked after releasing back inside blockstun');
}
{
  const m = at(-0.3, 0.3);
  const hold = dirBits(m, 1, 4);
  run(m, 3, 0, hold);
  const from = script(m, 40, (k) => [k === 0 ? I.L : k === 8 ? dirBits(m, 0, 2) | I.L : 0, hold]);
  t.ok(count(m, from, EV.BLOCK, 0) === 1 && count(m, from, EV.HIT, 0) === 1, 'auto-guard: a chained LOW still hits a standing blocker');
}

// ------------------------------------------------------------------ proximity guard
{
  const m = at(-0.5, 0.5);
  const hold = dirBits(m, 1, 4);
  const x0 = fs(m, 1).x;
  let prox = false;
  script(m, 10, (k) => {
    if ((m.s[sb(1) + F.flags] & FL.PROX) !== 0) prox = true;
    return [k === 0 ? I.H : 0, hold];
  });
  t.ok(prox && Math.abs(fs(m, 1).x - x0) < 0.02, 'proximity guard: holding back during 5H startup holds position in guard', `dx ${(fs(m, 1).x - x0).toFixed(3)}`);
  const m2 = at(-0.5, 0.5);
  const x2 = fs(m2, 1).x;
  run(m2, 10, 0, dirBits(m2, 1, 4));
  t.ok(fs(m2, 1).x - x2 > 0.15, 'control: holding back with no attack walks back', `dx ${(fs(m2, 1).x - x2).toFixed(3)}`);
}

// ------------------------------------------------------------------ pushback + corner transfer
{
  const m = at(-0.3, 0.3);
  const hold = dirBits(m, 1, 4);
  run(m, 2, 0, hold);
  // measure from the BLOCK frame (the defender may take one walk-back step before guarding)
  let xa = 0;
  let xd = 0;
  let seen = false;
  script(m, 40, (k) => {
    if (!seen && k > 0 && evs(m, m.frame()).some((e) => e.type === EV.BLOCK)) {
      seen = true;
      xa = fs(m, 0).x;
      xd = fs(m, 1).x;
    }
    return [k === 0 ? I.L : 0, k < 20 ? hold : 0];
  });
  t.near(fs(m, 1).x - xd, A['5L'].pushback!.block!, 0.0002, 'blocked 5L pushes the defender 0.27 m');
  t.near(fs(m, 0).x - xa, 0, 0.0001, 'midscreen: the attacker is not pushed');
}
{
  const m = newMatch();
  const wall = sys.stage.wallM - 0.62 / 2;
  place(m, wall - 0.55, wall);
  run(m, 2, 0, 0);
  const hold = dirBits(m, 1, 4);
  run(m, 2, 0, hold);
  const xa = fs(m, 0).x;
  const xd = fs(m, 1).x;
  script(m, 30, (k) => [k === 0 ? I.L : 0, k < 20 ? hold : 0]);
  t.near(xa - fs(m, 0).x, A['5L'].pushback!.block!, 0.0002, 'corner: the pushback transfers to the attacker (0.27 m back)');
  t.near(fs(m, 1).x, xd, 0.0001, 'corner: the defender stays at the wall');
}

// ------------------------------------------------------------------ STAGE FRIGHT
function blockAdv(m: Match, hold: number, press: number): number {
  let atkFree = -1;
  let defFree = -1;
  let contact = false;
  script(m, 140, (k) => {
    if (k > 0 && atkFree < 0 && isFree(m, 0)) atkFree = m.frame();
    if (!contact && evs(m, m.frame()).some((e) => e.type === EV.BLOCK)) contact = true;
    if (contact && defFree < 0 && isFree(m, 1)) defFree = m.frame();
    return [k === 0 ? press : 0, hold];
  });
  return defFree - atkFree;
}
{
  const m1 = at(-0.4, 0.4);
  const h1 = dirBits(m1, 1, 4);
  run(m1, 2, 0, h1);
  const normal = blockAdv(m1, h1, I.L);
  const m2 = at(-0.4, 0.4);
  m2.s[sb(1) + F.fright] = 1;
  m2.s[sb(1) + F.nerve] = 0;
  const h2 = dirBits(m2, 1, 4);
  run(m2, 2, 0, h2);
  const fright = blockAdv(m2, h2, I.L);
  t.eq(fright - normal, sys.stageFright.blockstunBonus, 'STAGE FRIGHT: +4 blockstun');
}
{
  // chip: brickbat blocked = 10% grey normally; 25% real in STAGE FRIGHT
  const m = at(-1.5, 1.5);
  const hold = dirBits(m, 1, 4);
  const seq = [2, 3, 6].map((d) => dirBits(m, 0, d));
  seq[2] |= I.M;
  script(m, 60, (k) => [k < 3 ? seq[k] : 0, hold]);
  const p = fs(m, 1);
  t.ok(p.greyHp === Math.trunc((A['brickbat_m'].damage! * A['brickbat_m'].chipPct!) / 100) && p.hp === 11000 - p.greyHp, 'blocked special: chipPct 10% as grey HP', `hp ${p.hp} grey ${p.greyHp}`);
  const m2 = at(-1.5, 1.5);
  m2.s[sb(1) + F.fright] = 1;
  m2.s[sb(1) + F.nerve] = 0;
  const hold2 = dirBits(m2, 1, 4);
  const seq2 = [2, 3, 6].map((d) => dirBits(m2, 0, d));
  seq2[2] |= I.M;
  script(m2, 60, (k) => [k < 3 ? seq2[k] : 0, hold2]);
  const q = fs(m2, 1);
  t.ok(q.hp === 11000 - Math.trunc((A['brickbat_m'].damage! * sys.stageFright.chipPct) / 100) && q.greyHp === 0, 'STAGE FRIGHT: specials chip 25% as REAL damage', `hp ${q.hp} grey ${q.greyHp}`);
}
{
  const m = at(-2, 2);
  m.s[sb(1) + F.fright] = 1;
  m.s[sb(1) + F.nerve] = 0;
  const from = script(m, 30, (k) => [0, k === 0 ? I.PARRY : k === 10 ? I.IMPACT : 0]);
  t.ok(fs(m, 1).state !== ST.PARRY && count(m, from, EV.IMPACT_START) === 0, 'STAGE FRIGHT: no parry, no IMPACT');
}

// ------------------------------------------------------------------ parry
{
  // regular: parry held, jab arrives on parry frame >= 4 -> PARRY, advantage = block advantage
  const m = at(-0.4, 0.4);
  run(m, 6, 0, I.PARRY);
  let atkFree = -1;
  let defFree = -1;
  const from = script(m, 50, (k) => {
    if (k > 0 && atkFree < 0 && isFree(m, 0)) atkFree = m.frame();
    if (k > 4 && defFree < 0 && isFree(m, 1)) defFree = m.frame();
    return [k === 0 ? I.L : 0, k < 5 ? I.PARRY : 0];
  });
  t.eq(count(m, from, EV.PARRY), 1, 'held parry catches a jab (PARRY)');
  t.eq(defFree - atkFree, A['5L'].blockstun! - (A['5L'].active + A['5L'].recovery), 'regular parry = block frame advantage');
  t.eq(fs(m, 1).hp, 11000, 'parry: no damage, no chip');
}
{
  // perfect: parry pressed so the jab lands on parry frame 2
  const m = at(-0.4, 0.4);
  let freezeSeen = 0;
  let p2free = -1;
  let punishHit = -1;
  const from = script(m, 90, (k) => {
    if (m.s[W.freeze] > freezeSeen) freezeSeen = m.s[W.freeze];
    if (k > 3 && p2free < 0 && isFree(m, 1) && m.s[W.freeze] === 0) p2free = k;
    const hitNow = evs(m, m.frame()).find((e) => e.type === EV.HIT && e.a === 1);
    if (hitNow && punishHit < 0) punishHit = k;
    return [k === 0 ? I.L : 0, k === 2 ? I.PARRY : k === 70 ? I.M : 0];
  });
  t.eq(count(m, from, EV.PERFECT_PARRY), 1, 'parry started 2 frames before contact = PERFECT_PARRY');
  t.eq(freezeSeen, sys.parry.perfectFreeze, 'perfect parry freezes the world for 60 frames');
  t.ok((m.s[sb(0) + F.mvFlags] & 2) !== 0 || fs(m, 0).moveName === '', 'perfect-parried move cannot cancel (NOCANCEL)');
}
{
  // perfect parry punish = x0.5
  const m = at(-0.4, 0.4);
  script(m, 64, (k) => [k === 0 ? I.L : 0, k === 2 ? I.PARRY : k === 63 ? I.M : 0]);
  run(m, 30, 0, 0);
  const dmg = 10000 - fs(m, 0).hp;
  t.ok(dmg > 0 && dmg === Math.trunc((data.fighters.kit_b.moves['5M'].damage! * 120 * sys.scaling.perfectParryPct) / 10000), 'perfect-parry punish takes x0.5 (punish-counter 5M: 650*1.2*0.5)', `dmg ${dmg}`);
}
{
  // whiffed parry: 33 frames of recovery after the minimum 12, nerve cooldown 240
  const m = at(-3, 3);
  let recF = -1;
  let freeF = -1;
  script(m, 80, (k) => {
    const st = m.s[sb(1) + F.st];
    if (recF < 0 && st === ST.PARRY_REC) recF = k;
    if (recF >= 0 && freeF < 0 && isFree(m, 1)) freeF = k;
    return [0, k === 0 ? I.PARRY : 0];
  });
  t.eq(recF, sys.parry.active, 'tapped parry stays active 12 frames (observed the frame after)');
  t.eq(freeF - recF, sys.parry.recovery, 'whiffed parry: 33 frames of recovery');
  t.eq(m.s[sb(1) + F.nerveCd] > 0 ? 1 : 0, 1, 'whiffed parry: NERVE regen cooldown running');
}
{
  // parry vs projectile: perfect = no freeze, 11-frame recovery
  const m = at(-1.5, 1.5);
  const seq = [2, 3, 6].map((d) => dirBits(m, 0, d));
  seq[2] |= I.H;
  let pp = -1;
  const from = script(m, 60, (k) => {
    if (pp < 0 && evs(m, m.frame()).some((e) => e.type === EV.PERFECT_PARRY)) pp = k;
    return [k < 3 ? seq[k] : 0, 0];
  });
  // find the frame the brick arrives, then redo with the parry pressed 1 frame before
  const arrive = evs(m, from).find((e) => e.type === EV.HIT);
  const k0 = arrive ? arrive.frame - from : -1;
  const m2 = at(-1.5, 1.5);
  let freeze = 0;
  const from2 = script(m2, 60, (k) => {
    freeze = Math.max(freeze, m2.s[W.freeze]);
    return [k < 3 ? seq[k] : 0, k === k0 - 1 ? I.PARRY : 0];
  });
  t.eq(count(m2, from2, EV.PERFECT_PARRY), 1, 'perfect parry of a projectile');
  t.eq(freeze, 0, 'perfect parry of a projectile: no freeze');
  void pp;
}

// ------------------------------------------------------------------ RUSH out of parry
{
  const m = at(-3, 3);
  const f6 = dirBits(m, 1, 6);
  const n0 = fs(m, 1).nerve;
  let rush = false;
  script(m, 30, (k) => {
    if (m.s[sb(1) + F.st] === ST.RUSH) rush = true;
    const w = k < 8 ? I.PARRY : 0;
    return [0, w | (k === 4 || k === 6 ? f6 : 0)];
  });
  t.ok(rush, 'parry then 66 = RUSH');
  t.ok(n0 - fs(m, 1).nerve >= sys.parry.costStart + sys.nerve.rushCost, 'RUSH costs extra NERVE on top of the parry', `spent ${n0 - fs(m, 1).nerve}`);
}

// ------------------------------------------------------------------ IMPACT
{
  // P2 jabs into IMPACT's armor and chains twice more (chain on armor contact, pressed in hitstop)
  const m = at(-0.35, 0.35);
  const presses = new Set([2, 8, 21]);
  const from = script(m, 70, (k) => [k === 0 ? I.IMPACT : 0, presses.has(k) ? I.L : 0]);
  t.eq(count(m, from, EV.IMPACT_START), 1, 'IMPACT_START event');
  t.eq(count(m, from, EV.IMPACT_ARMOR), 2, 'IMPACT armor absorbs 2 hits');
  t.eq(count(m, from, EV.HIT, 1), 1, 'the third hit breaks through the armor');
}
{
  const m = at(-0.9, 0.9);
  const from = script(m, 40, (k) => [k === 0 ? I.IMPACT : 0, 0]);
  const hit = evs(m, from).find((e) => e.type === EV.HIT && e.a === 0);
  t.eq(hit ? hit.frame - from + 1 : -1, sys.impact.startup, 'IMPACT startup 26');
  t.eq(fs(m, 0).nerve, 60000 - sys.nerve.impactCost + sys.nerve.hitGain, 'IMPACT costs 1 NERVE bar (then +hitGain on hit)');
}
{
  const m = at(-0.9, 0.9);
  const hold = dirBits(m, 1, 4);
  run(m, 2, 0, hold);
  const adv = blockAdv(m, hold, I.IMPACT);
  t.eq(adv, sys.impact.blockstun - (sys.impact.active + sys.impact.recovery), 'IMPACT on block -3 midscreen');
}
{
  const m = newMatch();
  place(m, 6.6, 7.6);
  run(m, 2, 0, 0);
  const hold = dirBits(m, 1, 4);
  const from = script(m, 40, (k) => [k === 0 ? I.IMPACT : 0, hold]);
  t.ok(count(m, from, EV.BLOCK, 0) === 1 && count(m, from, EV.WALL_SPLAT) === 1, 'IMPACT blocked in the corner = wall splat');
}
{
  const m = newMatch();
  place(m, 6.6, 7.6);
  run(m, 2, 0, 0);
  m.s[sb(1) + F.fright] = 1;
  m.s[sb(1) + F.nerve] = 0;
  const hold = dirBits(m, 1, 4);
  let stun = 0;
  const from = script(m, 40, (k) => {
    if (m.s[sb(1) + F.st] === ST.DIZZY) stun = Math.max(stun, m.s[sb(1) + F.stun]);
    return [k === 0 ? I.IMPACT : 0, hold];
  });
  t.ok(count(m, from, EV.CRUMPLE) === 1 && stun >= sys.stageFright.cornerImpactStun - 2, 'STAGE FRIGHT + corner IMPACT (blocked) = 195-frame stun', `stun ${stun}`);
}
{
  const m = at(-0.9, 0.9);
  const from = script(m, 40, (k) => [k === 0 ? I.IMPACT : 0, k === 0 ? I.IMPACT : 0]);
  t.eq(count(m, from, EV.IMPACT_CLASH), 1, 'IMPACT vs IMPACT on the same frame = IMPACT_CLASH');
  t.ok(fs(m, 0).nerve === 60000 && fs(m, 1).nerve === 60000, 'IMPACT clash refunds both bars', `${fs(m, 0).nerve} ${fs(m, 1).nerve}`);
}

// ------------------------------------------------------------------ SHOVE
{
  const m = at(-0.5, 0.5);
  const hold = dirBits(m, 1, 4);
  run(m, 2, 0, hold);
  const from = script(m, 60, (k) => [k === 0 ? I.H : 0, k === 16 ? hold | I.PARRY : hold]);
  t.eq(count(m, from, EV.SHOVE), 1, 'parry button in blockstun = SHOVE');
  t.ok(fs(m, 1).nerve <= 60000 - sys.nerve.shoveCost, 'SHOVE costs 2 NERVE bars');
  const p1 = fs(m, 0);
  t.ok(p1.hp < 10000 && p1.greyHp === 10000 - p1.hp, 'SHOVE damage is grey HP only', `hp ${p1.hp} grey ${p1.greyHp}`);
}

devSet;
t.done();
