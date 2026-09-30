// probe_uniques (G2, lane SIM, CHANGED(SIM) P2 - CONTRACT §4.3.13, §5.3, §20.3, §28): every fighter unique of every kit in
// data/fighters, with the numbers read from the data (never restated here), plus the P1 sim fixes of §28.5:
//   stance (lotus) - charge (krane) - ball (gazza) - counter (rerun, ricky) - armorStep (bruno, boneyard, freak) -
//   teleport (zambini) - phases (ricky) - installs (fixture) - motion priority 360 > HC > DP > QC - derive v2 reach order
//   vs FIGHTING_DESIGN 2h - measured asymmetric hurtboxes - throw knockdowns play the whole wake - KO HP clamp -
//   CINEMATIC_END lays the victim down without a second fall.
// Every assertion drives the sim with input words (except test setup: place() / devSet-like HP writes) and reads state /
// snapshots / events. Usage: node _harness/probe_uniques.ts [-v]
import { readFileSync, writeFileSync } from 'node:fs';
import { I, ROOT, dirBits, evs, fs, motion, newMatch, place, run, sb, tester, lxU, plx } from './fixtures/simkit.ts';
import { readFighter, readMatch, step } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { buildGameData, loadGameData } from '../runtime/src/core/data.ts';
import { hurtRects } from '../runtime/src/core/sim/boxes.ts';
import { EV, EVX, BALL_EV } from '../runtime/src/core/sim/events.ts';
import { BALL, F, P, PH, PROJ_CAP, ST, W, projBase } from '../runtime/src/core/sim/layout.ts';
import { UK } from '../runtime/src/core/sim/compile.ts';
import type { FighterDef, GameData, Move } from '../runtime/src/core/types.ts';

const t = tester('probe_uniques');
const data = loadGameData();
const U = 100000;
const VERBOSE = process.argv.includes('-v');

function mk(p1: string, p2: string, s1: 0 | 1 = 1, s2: 0 | 1 = 1, d: GameData = data): Match {
  const m = newMatch({ p1, p2, data: d, s1, s2, timer: 0 });
  return m;
}
const def = (id: string): FighterDef => data.fighters[id] as FighterDef;
const uq = (id: string): Record<string, unknown> => (def(id).unique ?? { kind: 'none' }) as Record<string, unknown>;
const st = (m: Match, i: number): number => m.s[sb(i) + F.st];
const mvName = (m: Match, i: number): string => readFighter(m, i).moveName;
const x = (m: Match, i: number): number => lxU(m, i) / U; // CHANGED(SIM3D): line coordinate
function idle(m: Match, n: number): void {
  run(m, n, 0, 0);
}
/** Steps until pred or max frames; returns frames stepped (-1 = never). */
function until(m: Match, pred: () => boolean, max: number, in1 = 0, in2 = 0): number {
  for (let k = 0; k < max; k++) {
    if (pred()) return k;
    step(m, in1, in2);
  }
  return pred() ? max : -1;
}
function isFree(m: Match, i: number): boolean {
  const s = st(m, i);
  return s === ST.IDLE || s === ST.CROUCH || s === ST.WALK_F || s === ST.WALK_B;
}
function freeBoth(m: Match): void {
  until(m, () => isFree(m, 0) && isFree(m, 1), 400);
}
function setHp(m: Match, i: number, hp: number): void {
  m.s[sb(i) + F.hp] = hp;
}
function fullMeters(m: Match, i: number): void {
  m.s[sb(i) + F.showtime] = 30000;
  m.s[sb(i) + F.nerve] = 60000;
}

// ================================================================= 0. every kit's unique block is live in the sim
{
  const kinds: Record<string, string> = {};
  for (const id of Object.keys(data.fighters).sort()) {
    const k = String(uq(id).kind ?? 'none');
    kinds[id] = k;
    const m = mk(id, 'johnny');
    const want = ({ none: UK.NONE, stance: UK.STANCE, charge: UK.CHARGE, ball: UK.BALL, counter: UK.COUNTER, armorStep: UK.ARMOR_STEP, teleport: UK.TELEPORT, phases: UK.PHASES } as Record<string, number>)[k];
    t.eq(m.cf[0].uk, want, `${id}: unique.kind "${k}" compiled`);
  }
  t.note(`kinds: ${JSON.stringify(kinds)}`);
}

// ================================================================= 1. STANCE (lotus)
{
  const L = uq('lotus');
  const enter = (L.enter as string[])[1] ?? (L.enter as string[])[0]; // the M version
  const fu = L.followups as Record<string, string>;
  const ex = L.exit as Record<string, string>;
  const maxF = L.maxF as number;
  const blockExitF = L.blockExitF as number;
  const walk = L.walk as { fwd: number; back: number };
  const enterMv = def('lotus').moves[enter];
  const total = enterMv.startup + enterMv.active + enterMv.recovery;
  // enter via 214M
  const m = mk('lotus', 'johnny');
  place(m, -1.5, 1.5);
  motion(m, 0, '214', I.M);
  t.eq(mvName(m, 0) === enter ? 1 : 0, 1, `lotus 214M starts ${enter}`);
  const took = until(m, () => st(m, 0) === ST.STANCE, total + 5);
  t.ok(took >= 0 && took <= total, `lotus ${enter} puts her in STANCE after its ${total} frames (took ${took})`);
  const fsn = readFighter(m, 0);
  t.ok(fsn.flags.stance === 1 && fsn.unique[0] === 1 && fsn.unique[2] === maxF, 'stance snapshot: flags.stance 1, unique [1, frames, maxF, anim]', JSON.stringify(fsn.unique));
  const stanceIdleAnim = m.tab.anims[0].findIndex((a) => a.clip === (L.clips as Record<string, string>).idle);
  t.ok(stanceIdleAnim > 0 && fsn.animId === stanceIdleAnim, `stance idle anim = the anim-table entry of "${(L.clips as Record<string, string>).idle}" (${stanceIdleAnim})`, `animId ${fsn.animId}`);
  t.ok(!!data.clips.lotus.clips[(L.clips as Record<string, string>).idle], 'the stance idle clip exists in clips.json');
  // lean hurtbox: a high box above the lean height misses her in stance
  const ho = (enterMv.hurtOverride ?? [])[0];
  t.ok(!!ho && m.cf[0].u.stHurtH === Math.round(ho!.h * U), `stance hurtbox height = the enter move's hurtOverride (${ho?.h} m)`);
  // follow-ups
  for (const [btn, bit] of [['L', I.L], ['M', I.M], ['H', I.H]] as [string, number][]) {
    const m2 = mk('lotus', 'johnny');
    place(m2, -1.5, 1.5);
    motion(m2, 0, '214', I.M);
    until(m2, () => st(m2, 0) === ST.STANCE, 60);
    step(m2, bit, 0);
    t.eq(mvName(m2, 0) === fu[btn] ? 1 : 0, 1, `stance + ${btn} fires ${fu[btn]} at once (got "${mvName(m2, 0)}")`);
  }
  // a press during the enter move buffers into the stance
  {
    const m2 = mk('lotus', 'johnny');
    place(m2, -1.5, 1.5);
    motion(m2, 0, '214', I.M);
    run(m2, total - 3, 0, 0);
    step(m2, I.L, 0);
    const k = until(m2, () => mvName(m2, 0) === fu.L, 10);
    t.ok(k >= 0, `L pressed ${3} frames before the stance starts buffers ${fu.L}`, `k ${k}`);
  }
  // exits
  {
    const m2 = mk('lotus', 'johnny');
    place(m2, -1.5, 1.5);
    motion(m2, 0, '214', I.M);
    until(m2, () => st(m2, 0) === ST.STANCE, 60);
    const hold = data.system.uniques?.stance?.exitHoldF ?? 4;
    run(m2, hold - 1, dirBits(m2, 0, 2), 0);
    t.ok(st(m2, 0) === ST.STANCE, `down held ${hold - 1} frames keeps the stance (motions roll through down)`);
    step(m2, dirBits(m2, 0, 2), 0);
    t.eq(mvName(m2, 0) === ex['2'] ? 1 : 0, 1, `down held ${hold} frames starts ${ex['2']}`);
    const m3 = mk('lotus', 'johnny');
    place(m3, -1.5, 1.5);
    motion(m3, 0, '214', I.M);
    until(m3, () => st(m3, 0) === ST.STANCE, 60);
    const k = until(m3, () => mvName(m3, 0) === ex.timeout, maxF + 5);
    t.ok(k >= maxF - 2 && k <= maxF + 1, `stance times out into ${ex.timeout} after maxF ${maxF} frames (took ${k})`);
  }
  // walk speeds + back-hold exit, then blocking works
  {
    const m2 = mk('lotus', 'johnny');
    place(m2, -2.0, 2.0);
    motion(m2, 0, '214', I.M);
    until(m2, () => st(m2, 0) === ST.STANCE, 60);
    const x0 = x(m2, 0);
    run(m2, 10, dirBits(m2, 0, 6), 0);
    t.near(x(m2, 0) - x0, (Math.round((walk.fwd * U) / 60) * 10) / U, 0.0001, `stance forward walk = unique.walk.fwd ${walk.fwd} m/s`);
    const x1 = x(m2, 0);
    let frames = 0;
    while (st(m2, 0) === ST.STANCE && frames < 30) {
      step(m2, dirBits(m2, 0, 4), 0);
      frames++;
    }
    t.eq(frames, blockExitF, `holding back leaves the stance after blockExitF ${blockExitF} frames`);
    // blockExitF - 1 stance back-walk frames, then the free frame walks back at the normal first-frame quarter speed
    const wb = Math.round((def('lotus').walk.back * U) / 60);
    const exp = Math.round((walk.back * U) / 60) * (blockExitF - 1) + Math.trunc((wb * data.system.movement.walkFirstFramePct) / 100);
    t.near(x1 - x(m2, 0), exp / U, 0.0001, `stance back walk = unique.walk.back ${walk.back} m/s (then the normal walk)`);
    // johnny 5M into her: blocked
    place(m2, -1.0, 0.0);
    step(m2, dirBits(m2, 0, 4), I.M);
    const e0 = m2.frame();
    run(m2, 20, dirBits(m2, 0, 4), 0);
    t.ok(evs(m2, e0).some((e) => e.type === EV.BLOCK && e.b === 0), 'after leaving the stance by holding back she blocks');
  }
  // cannot block in stance; can be thrown in stance; a special starts from it
  {
    const m2 = mk('lotus', 'johnny');
    place(m2, -1.2, -0.3);
    motion(m2, 0, '214', I.M);
    until(m2, () => st(m2, 0) === ST.STANCE, 60);
    const e0 = m2.frame();
    step(m2, 0, I.THROW);
    run(m2, 12, 0, 0);
    t.ok(evs(m2, e0).some((e) => e.type === EV.THROW && e.b === 0), 'a throw connects on her in STANCE');
    const m3 = mk('lotus', 'johnny');
    place(m3, -1.5, 1.5);
    motion(m3, 0, '214', I.M);
    until(m3, () => st(m3, 0) === ST.STANCE, 60);
    motion(m3, 0, '236', I.L);
    t.ok(mvName(m3, 0).startsWith('dragon_breath'), 'a CLASSIC special (236L) starts from the stance', mvName(m3, 0));
  }
  // SIMPLE 4S enters too
  {
    const m2 = mk('lotus', 'johnny', 0, 0);
    place(m2, -1.5, 1.5);
    step(m2, dirBits(m2, 0, 4) | I.S, 0);
    t.eq(mvName(m2, 0) === def('lotus').simple['4S'] ? 1 : 0, 1, `SIMPLE 4S = ${def('lotus').simple['4S']} (stance enter)`);
  }
}

// ================================================================= 2. CHARGE (krane)
{
  const K = uq('krane');
  const chargeF = K.chargeF as number;
  const keepF = K.keepF as number;
  const pct = K.standBlockNervePct as number;
  const tryCharge = (holdF: number, gap: number, dirHold: number, dirRel: number): string => {
    const m = mk('krane', 'johnny');
    place(m, -2.5, 2.5);
    run(m, holdF, dirBits(m, 0, dirHold), 0);
    run(m, gap, 0, 0);
    step(m, dirBits(m, 0, dirRel) | I.L, 0);
    return mvName(m, 0);
  };
  t.eq(tryCharge(chargeF, 0, 4, 6) === 'taser_l' ? 1 : 0, 1, `[4]6L after ${chargeF} f of back = taser_l`);
  t.ok(tryCharge(chargeF - 1, 0, 4, 6) !== 'taser_l', `[4]6L after ${chargeF - 1} f is not a taser (${tryCharge(chargeF - 1, 0, 4, 6) || 'none'})`);
  t.eq(tryCharge(chargeF, keepF - 1, 4, 6) === 'taser_l' ? 1 : 0, 1, `keep: released ${keepF - 1} f of neutral then 6L = taser_l`);
  t.ok(tryCharge(chargeF, keepF + 1, 4, 6) !== 'taser_l', `keep: ${keepF + 1} f of neutral loses the charge`);
  t.eq(tryCharge(chargeF, 0, 2, 8) === 'baton_flip_l' ? 1 : 0, 1, `[2]8L after ${chargeF} f of down = baton_flip_l`);
  // charge kept through blockstun: charge back, block johnny's 5H, press 6 during blockstun for > keepF, 6L on the first free frame
  {
    const m = mk('krane', 'johnny');
    place(m, -1.0, 0.0);
    run(m, chargeF + 5, dirBits(m, 0, 1), 0); // down-back charges back without walking away
    step(m, dirBits(m, 0, 1), I.M);
    until(m, () => st(m, 0) === ST.BLOCKSTUN, 30, dirBits(m, 0, 1), 0);
    let bs = 0;
    while (st(m, 0) === ST.BLOCKSTUN && bs < 60) {
      step(m, dirBits(m, 0, 6), 0);
      bs++;
    }
    step(m, dirBits(m, 0, 6) | I.L, 0);
    t.ok(bs > keepF, `blockstun lasted ${bs} f (> keepF ${keepF}) while holding forward`);
    t.eq(mvName(m, 0) === 'taser_l' ? 1 : 0, 1, `the charge is kept through blockstun: 6L after it = taser_l (got "${mvName(m, 0)}")`);
  }
  // kept through dashes: a forward dash (66) and a back dash (44) in between keep the charge
  {
    const m = mk('krane', 'johnny');
    place(m, -4.0, 2.5);
    run(m, chargeF + 2, dirBits(m, 0, 4), 0);
    step(m, dirBits(m, 0, 6), 0);
    step(m, 0, 0);
    step(m, dirBits(m, 0, 6), 0);
    const k = until(m, () => st(m, 0) === ST.DASH_F, 3, dirBits(m, 0, 6), 0);
    until(m, () => st(m, 0) !== ST.DASH_F, 40, dirBits(m, 0, 6), 0);
    step(m, dirBits(m, 0, 6) | I.L, 0);
    t.ok(k >= 0 && mvName(m, 0) === 'taser_l', `charge kept through a forward dash (66): 6L after it = taser_l (got "${mvName(m, 0)}")`);
    const m2 = mk('krane', 'johnny');
    place(m2, -2.0, 2.5);
    run(m2, chargeF + 2, dirBits(m2, 0, 1), 0); // charge in down-back (no walking), then tap 4, 5, 4 = back dash
    step(m2, 0, 0);
    step(m2, dirBits(m2, 0, 4), 0);
    step(m2, 0, 0);
    step(m2, dirBits(m2, 0, 4), 0);
    const k2 = until(m2, () => st(m2, 0) === ST.DASH_B, 3, dirBits(m2, 0, 4), 0);
    until(m2, () => st(m2, 0) !== ST.DASH_B, 40, dirBits(m2, 0, 4), 0);
    step(m2, dirBits(m2, 0, 6) | I.L, 0);
    t.ok(k2 >= 0 && mvName(m2, 0) === 'taser_l', `charge kept through a back dash (44): 6L after it = taser_l (got "${mvName(m2, 0)}")`);
    // SIMPLE: S + direction
    const m3 = mk('krane', 'johnny', 0, 0);
    place(m3, -2.5, 2.5);
    step(m3, I.S, 0);
    t.ok(mvName(m3, 0) === def('krane').simple['5S'], `SIMPLE 5S = ${def('krane').simple['5S']} (no charge)`, mvName(m3, 0));
    const m4 = mk('krane', 'johnny', 0, 0);
    place(m4, -2.5, 2.5);
    step(m4, dirBits(m4, 0, 2) | I.S, 0);
    t.ok(mvName(m4, 0) === def('krane').simple['2S'], `SIMPLE 2S = ${def('krane').simple['2S']} (no charge)`, mvName(m4, 0));
  }
  // riot shield: standing block drains pct %
  {
    const drain = (crouch: boolean): number => {
      const m = mk('krane', 'johnny');
      place(m, -1.0, 0.0);
      const hold = crouch ? dirBits(m, 0, 1) : dirBits(m, 0, 4);
      run(m, 10, hold, 0);
      const n0 = m.s[sb(0) + F.nerve];
      step(m, hold, I.M);
      until(m, () => st(m, 0) === ST.BLOCKSTUN, 20, hold, 0);
      return n0 - m.s[sb(0) + F.nerve];
    };
    const dS = drain(false);
    const dC = drain(true);
    const jm = data.fighters.johnny.moves['5M'] as Move;
    const full = jm.gain?.nerveCost ?? 3000;
    t.eq(dC, full, `crouch block drains the full NERVE (${full})`);
    t.eq(dS, Math.trunc((full * pct) / 100), `standing block drains standBlockNervePct ${pct}% (${Math.trunc((full * pct) / 100)})`);
  }
  // snapshot
  {
    const m = mk('krane', 'johnny');
    place(m, -2.5, 2.5);
    run(m, chargeF + 3, dirBits(m, 0, 4), 0);
    const u = readFighter(m, 0).unique;
    t.ok(u[0] === chargeF && u[2] === 1, 'charge snapshot: unique[0] back charge (capped), unique[2] [4]6 ready', JSON.stringify(u));
  }
}

// ================================================================= 3. BALL (gazza)
function ballSlotOf(m: Match, i: number): number {
  for (let k = 0; k < PROJ_CAP; k++) {
    const pb = projBase(k);
    if (m.s[pb + P.act] !== 0 && m.s[pb + P.kind] === 1 && m.s[pb + P.owner] === i) return k;
  }
  return -1;
}
{
  const G = uq('gazza');
  const restF = G.restF as number;
  const respawnF = G.respawnF as number;
  const pickupM = G.pickupM as number;
  const bounces = G.bounces as number;
  const pm = def('gazza').moves.power_shot_m;
  const km = def('gazza').moves.keepy_m;
  // kick, hit, loose, rest
  {
    const m = mk('gazza', 'johnny');
    place(m, -2.0, 1.0);
    t.ok(readFighter(m, 0).unique[0] === BALL.FEET && readFighter(m, 0).unique[2] === -1, 'round start: the ball is at his feet (unique [0, 0, -1, 0])', JSON.stringify(readFighter(m, 0).unique));
    const e0 = m.frame();
    motion(m, 0, '236', I.M);
    t.eq(mvName(m, 0) === 'power_shot_m' ? 1 : 0, 1, 'gazza 236M starts power_shot_m');
    until(m, () => ballSlotOf(m, 0) >= 0, pm.startup + 2);
    const k = ballSlotOf(m, 0);
    t.ok(k >= 0 && readFighter(m, 0).unique[0] === BALL.FLYING && readFighter(m, 0).unique[2] === k, `the kick puts the ONE ball (kind 1, slot ${k}) in flight (unique[0] 1)`);
    const pb = projBase(k);
    t.near(m.s[pb + P.y] / U, pm.projectile!.y, 0.001, `kicked at projectile.y ${pm.projectile!.y} m`);
    t.near(Math.abs(m.s[pb + P.vx]) * 60 / U, pm.projectile!.speed, 0.01, `kicked at projectile.speed ${pm.projectile!.speed} m/s`);
    // a second shot is not available while it flies
    run(m, pm.active + pm.recovery + 2, 0, 0);
    if (ballSlotOf(m, 0) >= 0 && m.s[projBase(ballSlotOf(m, 0)) + P.mode] === BALL.FLYING) {
      motion(m, 0, '236', I.M);
      t.ok(mvName(m, 0) !== 'power_shot_m', 'no second power shot while the ball is in flight (the input falls through)', mvName(m, 0));
    }
    const hitK = until(m, () => evs(m, e0).some((e) => e.type === EV.PROJ_HIT && e.a === 0), 90);
    t.ok(hitK >= 0, 'the ball hits the opponent (PROJ_HIT)');
    const restK = until(m, () => readFighter(m, 0).unique[0] === BALL.REST, 120);
    t.ok(restK >= 0 && evs(m, e0).some((e) => e.type === EVX.BALL && e.b === BALL_EV.LOOSE), 'after the hit it bounces off loose (BALL loose) and comes to rest (unique[0] 3)');
    t.ok(readFighter(m, 0).unique[1] > 0 && readFighter(m, 0).unique[1] <= restF, `resting timer <= restF ${restF}`, `${readFighter(m, 0).unique[1]}`);
    // rest timeout -> respawn at his feet
    const k2 = until(m, () => readFighter(m, 0).unique[0] === BALL.FEET, restF + 5);
    t.ok(k2 >= 0 && ballSlotOf(m, 0) < 0 && evs(m, e0).some((e) => e.type === EVX.BALL && e.b === BALL_EV.RESPAWN), `after restF (${restF}) the ball respawns at his feet`);
  }
  // wall rebound (the opponent is invulnerable so the ball reaches the wall)
  {
    const m = mk('gazza', 'johnny');
    place(m, 2.0, 5.5);
    m.s[sb(1) + F.invS] = 500; // test setup: projectiles pass through
    const e0 = m.frame();
    motion(m, 0, '236', I.M);
    const k = until(m, () => evs(m, e0).some((e) => e.type === EVX.BALL && e.b === BALL_EV.REBOUND), 120);
    t.ok(k >= 0, 'the flying ball rebounds off the stage wall (BALL rebound)');
    const sl = ballSlotOf(m, 0);
    t.ok(sl >= 0 && m.s[projBase(sl) + P.vx] < 0 && readFighter(m, 0).unique[3] === bounces - 1, `after the rebound it flies back (vx < 0), rebounds left ${bounces - 1}`);
    const vIn = Math.round((pm.projectile!.speed * U) / 60);
    t.near(Math.abs(m.s[projBase(sl) + P.vx]), Math.trunc((vIn * (data.system.uniques?.ball?.wallRestitutionPct ?? 70)) / 100), 1, 'rebound speed = wallRestitutionPct of the kick');
  }
  // keepy-uppy hover, then re-kick from the hover spot
  {
    const m = mk('gazza', 'johnny');
    place(m, -2.0, 2.0);
    motion(m, 0, '214', I.M);
    t.eq(mvName(m, 0) === 'keepy_m' ? 1 : 0, 1, 'gazza 214M starts keepy_m');
    until(m, () => readFighter(m, 0).unique[0] === BALL.HOVER, km.startup + 2);
    const sl = ballSlotOf(m, 0);
    t.ok(sl >= 0 && readFighter(m, 0).unique[0] === BALL.HOVER, 'keepy-uppy parks the ball in the air (unique[0] 2)');
    t.near(m.s[projBase(sl) + P.y] / U, km.projectile!.y, 0.001, `hover height = projectile.y ${km.projectile!.y} m`);
    const hx = plx(m, sl);
    run(m, 20, 0, 0);
    t.eq(plx(m, sl), hx, 'the hover ball stays put');
    freeBoth(m);
    motion(m, 0, '236', I.M);
    t.eq(mvName(m, 0) === 'power_shot_m' ? 1 : 0, 1, 're-kick: power_shot_m is available with the hover ball in front');
    until(m, () => readFighter(m, 0).unique[0] === BALL.FLYING, pm.startup + 2);
    const sl2 = ballSlotOf(m, 0);
    t.ok(sl2 === sl && m.s[projBase(sl2) + P.y] >= Math.round(km.projectile!.y * U) - 1000, 'the SAME ball is volleyed from its hover height', `y ${m.s[projBase(sl2) + P.y] / U}`);
  }
  // hover expires -> drops -> rests; walking onto it traps it
  {
    const m = mk('gazza', 'johnny');
    place(m, -2.0, 3.0);
    motion(m, 0, '214', I.M);
    until(m, () => readFighter(m, 0).unique[0] === BALL.HOVER, km.startup + 2);
    const hoverAt = m.frame();
    freeBoth(m);
    run(m, 30, dirBits(m, 0, 4), 0); // step back: a ball that lands within pickupM of a free Gazza is trapped at once
    const looseK = until(m, () => readFighter(m, 0).unique[0] === BALL.LOOSE, km.projectile!.life + 5);
    const hoverLen = m.frame() - hoverAt;
    const k = until(m, () => readFighter(m, 0).unique[0] === BALL.REST, 90);
    t.ok(looseK >= 0 && Math.abs(hoverLen - km.projectile!.life) <= 1 && k >= 0, `the hover lasts projectile.life ${km.projectile!.life} f (${hoverLen}), then the ball drops and rests`);
    const sl = ballSlotOf(m, 0);
    const bx = plx(m, sl);
    const e0 = m.frame();
    // walk onto it
    const kk = until(m, () => readFighter(m, 0).unique[0] === BALL.FEET, 120, dirBits(m, 0, 6), 0);
    t.ok(kk >= 0 && evs(m, e0).some((e) => e.type === EVX.BALL && e.b === BALL_EV.PICKUP), 'walking onto the resting ball traps it back at his feet (BALL pickup)');
    t.ok(Math.abs(bx - lxU(m, 0)) <= Math.round(pickupM * U) + Math.round((def('gazza').walk.fwd * U) / 60), `picked up within pickupM ${pickupM} m`);
  }
  // an opponent strike knocks a resting ball away; respawn after respawnF
  {
    // (1) a hover ball (keepy_l height) struck by johnny 5M
    {
      const mh = mk('gazza', 'johnny');
      place(mh, -2.0, 2.5);
      motion(mh, 0, '214', I.L);
      until(mh, () => readFighter(mh, 0).unique[0] === BALL.HOVER, 20);
      const hs = ballSlotOf(mh, 0);
      const hx = plx(mh, hs) / U;
      place(mh, -3.0, hx + 0.8);
      const eh = mh.frame();
      step(mh, 0, I.M);
      const kh = until(mh, () => readFighter(mh, 0).unique[0] === BALL.GONE, 20);
      t.ok(kh >= 0 && evs(mh, eh).some((e) => e.type === EVX.BALL && e.b === BALL_EV.KNOCKED), 'an opponent strike knocks a hovering ball away (unique[0] 4)');
    }
    // (2) a resting ball struck by patch's floor-level 2L
    const m = mk('gazza', 'patch');
    place(m, -2.0, 1.2);
    motion(m, 0, '214', I.M);
    freeBoth(m);
    run(m, 30, dirBits(m, 0, 4), 0);
    until(m, () => readFighter(m, 0).unique[0] === BALL.REST, 250);
    const sl = ballSlotOf(m, 0);
    const bx = plx(m, sl) / U;
    place(m, -3.5, bx + 0.6); // patch stands right next to the ball, facing it
    m.s[sb(1) + F.facing] = -1;
    const e0 = m.frame();
    step(m, 0, dirBits(m, 1, 2) | I.L);
    const k = until(m, () => readFighter(m, 0).unique[0] === BALL.GONE, 25, 0, dirBits(m, 1, 2));
    t.ok(k >= 0 && evs(m, e0).some((e) => e.type === EVX.BALL && e.b === BALL_EV.KNOCKED), 'an opponent strike on the resting ball knocks it away (unique[0] 4, BALL knocked)');
    const r1 = readFighter(m, 0).unique[1];
    t.ok(r1 >= respawnF - 2 && r1 <= respawnF, `respawn timer starts at respawnF (${r1})`);
    const kk = until(m, () => readFighter(m, 0).unique[0] === BALL.FEET, respawnF + 5);
    t.ok(kk >= respawnF - 2 && kk <= respawnF + 1, `it respawns at his feet after respawnF ${respawnF} f (took ${kk})`);
  }
  // summon moves ignore the ball (top_bins works while the ball is out)
  {
    const m = mk('gazza', 'johnny');
    place(m, -2.0, 3.0);
    fullMeters(m, 0);
    motion(m, 0, '214', I.M);
    freeBoth(m);
    motion(m, 0, '236236', I.L);
    t.ok(mvName(m, 0) === def('gazza').simple['S+H'], `a summon super (${def('gazza').simple['S+H']}) starts while the ball is out`, mvName(m, 0));
  }
  // round reset
  {
    const m = mk('gazza', 'johnny');
    place(m, -2.0, 3.0);
    motion(m, 0, '214', I.M);
    freeBoth(m);
    run(m, 30, dirBits(m, 0, 4), 0);
    until(m, () => readFighter(m, 0).unique[0] === BALL.REST, 250);
    setHp(m, 1, 1);
    place(m, -1.0, -0.2);
    step(m, I.M, 0);
    until(m, () => m.s[W.round] === 2 && m.s[W.phase] === PH.FIGHT, 600);
    t.ok(m.s[W.round] === 2 && readFighter(m, 0).unique[0] === BALL.FEET && ballSlotOf(m, 0) < 0, 'a new round starts with the ball at his feet');
  }
}

// ================================================================= 4. COUNTER (rerun PLAY DEAD / DEAD AIR, ricky COMMERCIAL BREAK)
function counterCase(who: string, motionIn: string, btn: number, moveId: string): void {
  const mv = def(who).moves[moveId];
  const c = mv.counter!;
  const m = mk(who, 'johnny');
  place(m, -1.0, 0.1);
  motion(m, 0, motionIn, btn);
  t.eq(mvName(m, 0) === moveId ? 1 : 0, 1, `${who} ${motionIn}${btn === I.L ? 'L' : btn === I.M ? 'M' : 'H'} starts ${moveId}`);
  const jm = def('johnny').moves['5M'];
  // johnny 5M lands inside the catch window
  run(m, Math.max(0, c.catch[0] + 1 - jm.startup), 0, 0);
  const e0 = m.frame();
  step(m, 0, I.M);
  const k = until(m, () => evs(m, e0).some((e) => e.type === EVX.CATCH), jm.startup + 4);
  t.ok(k >= 0, `${moveId}: johnny 5M on catch frames ${JSON.stringify(c.catch)} is caught (CATCH)`);
  const catchEv = evs(m, e0).find((e) => e.type === EVX.CATCH);
  t.ok(!!catchEv && catchEv.a === 0 && catchEv.b === 1 && catchEv.d === 0, 'CATCH payload a catcher, b attacker, d 0 strike', JSON.stringify(catchEv));
  const hs = m.s[sb(1) + F.hitstop];
  t.ok(hs >= (data.system.uniques?.counter?.catchHitstop ?? 12) - 1, `the caught attacker gets catchHitstop (${hs})`);
  t.ok(mvName(m, 0) === c.follow, `the follow-up ${c.follow} starts at once (got "${mvName(m, 0)}")`);
  t.ok(readFighter(m, 1).moveFrame >= jm.startup + jm.active - 1, 'the attacker jumped to its last active frame (recovery next)', `mvF ${readFighter(m, 1).moveFrame}`);
  t.eq(m.s[sb(1) + F.hp], def('johnny').hp, 'the caught hit did no damage');
  const fu = def(who).moves[c.follow];
  if (fu.grab) {
    const kk = until(m, () => evs(m, e0).some((e) => e.type === EV.THROW && e.a === 0), fu.startup + 6);
    t.ok(kk >= 0, `${c.follow} (a grab) connects after the catch`);
  } else {
    const kk = until(m, () => evs(m, e0).some((e) => (e.type === EV.PUNISH) && e.a === 0), fu.startup + 12);
    t.ok(kk >= 0, `${c.follow} hits the caught attacker as a PUNISH counter`);
  }
}
counterCase('rerun', '214', I.M, 'play_dead_m');
counterCase('ricky', '214', I.M, 'commercial_break_m');
{
  // throws beat counters
  const m = mk('rerun', 'johnny');
  place(m, -0.9, -0.1);
  motion(m, 0, '214', I.M);
  run(m, 3, 0, 0);
  const e0 = m.frame();
  step(m, 0, I.THROW);
  run(m, 8, 0, 0);
  t.ok(evs(m, e0).some((e) => e.type === EV.THROW && e.a === 1 && e.b === 0) && !evs(m, e0).some((e) => e.type === EVX.CATCH), 'a throw beats PLAY DEAD (THROW, no CATCH)');
}
{
  // a projectile is not caught by the strike-only counter; EX catches and destroys it
  const pd = def('rerun').moves.play_dead_ex.counter!;
  t.ok(pd.vs.includes('proj') && !def('rerun').moves.play_dead_m.counter!.vs.includes('proj'), 'data: EX lists proj, the M version strikes only');
  const m = mk('rerun', 'johnny');
  place(m, -1.5, 1.5);
  fullMeters(m, 0);
  motion(m, 1, '236', I.L);
  const e0 = m.frame();
  const bm = def('johnny').moves.brickbat_l;
  // time the EX so the brick arrives on its catch frames
  until(m, () => { for (let k = 0; k < PROJ_CAP; k++) if (m.s[projBase(k) + P.act] !== 0 && m.s[projBase(k) + P.owner] === 1) return true; return false; }, bm.startup + 2);
  let slot = -1;
  for (let k = 0; k < PROJ_CAP; k++) if (m.s[projBase(k) + P.act] !== 0 && m.s[projBase(k) + P.owner] === 1) slot = k;
  const dist = Math.abs(plx(m, slot) - lxU(m, 0)) / U;
  const vx = (bm.projectile!.speed);
  const framesToArrive = Math.floor((dist - 0.6) / (vx / 60));
  run(m, Math.max(0, framesToArrive - 8), 0, 0);
  motion(m, 0, '214', I.S);
  const k = until(m, () => evs(m, e0).some((e) => e.type === EVX.CATCH && e.d === 1), 40);
  t.ok(k >= 0, 'PLAY DEAD EX catches a projectile (CATCH d 1)');
  t.ok(m.s[projBase(slot) + P.act] === 0, 'the caught projectile is destroyed');
}
{
  // DEAD AIR (super): catch -> the bite grab connects
  const m = mk('rerun', 'johnny');
  place(m, -1.0, 0.1);
  fullMeters(m, 0);
  motion(m, 0, '236236', I.L);
  t.eq(mvName(m, 0) === 'dead_air' ? 1 : 0, 1, 'rerun 236236L = DEAD AIR');
  until(m, () => m.s[W.freeze] === 0, 80);
  const e0 = m.frame();
  step(m, 0, I.M);
  const k = until(m, () => evs(m, e0).some((e) => e.type === EV.THROW && e.a === 0), 30);
  t.ok(k >= 0 && evs(m, e0).some((e) => e.type === EVX.CATCH), 'DEAD AIR catches johnny 5M and DEAD AIR BITE grabs him');
}

// ================================================================= 5. ARMOR STEP (bruno, boneyard, freak)
for (const id of ['bruno', 'boneyard', 'freak']) {
  const u = uq(id);
  const armored = u.armored as string[];
  const steps = u.steps as string[];
  const bad = armored.filter((n) => !(def(id).moves[n]?.armor && def(id).moves[n].armor!.hits > 0));
  t.eq(bad.length, 0, `${id}: every unique.armored move carries armor (${bad.join(',') || 'ok'})`);
  t.ok(steps.every((n) => armored.includes(n)), `${id}: every step is armored`);
}
function armorCase(id: string, moveId: string, mo: string, btn: number): void {
  const mv = def(id).moves[moveId];
  const hits = mv.armor!.hits;
  const m = mk(id, 'johnny');
  place(m, -1.3, 0.0);
  motion(m, 0, mo, btn);
  t.eq(mvName(m, 0) === moveId ? 1 : 0, 1, `${id} ${mo} starts ${moveId}`);
  run(m, Math.max(0, mv.armor!.f[0] - 1), 0, 0);
  const e0 = m.frame();
  const hp0 = m.s[sb(0) + F.hp];
  // johnny jabs repeatedly (5L links) inside the armor window
  let absorbed = 0;
  for (let k = 0; k < 40 && mvName(m, 0) === moveId; k++) {
    step(m, 0, k % 6 === 0 ? I.L : 0);
    absorbed = evs(m, e0).filter((e) => e.type === EV.IMPACT_ARMOR && e.a === 0).length;
    if (absorbed >= hits) break;
  }
  t.ok(absorbed >= 1, `${id} ${moveId}: armor absorbs a hit (IMPACT_ARMOR x${absorbed}, armor hits ${hits})`);
  const u = readFighter(m, 0).unique;
  t.ok(u[1] === absorbed || st(m, 0) !== ST.ATTACK, `armorStep snapshot unique[1] = hits absorbed (${u[1]})`);
  t.ok(readFighter(m, 0).greyHp > 0 && m.s[sb(0) + F.hp] < hp0, 'an absorbed hit is grey (recoverable) damage');
}
armorCase('bruno', 'brace_m', '252', I.M);
armorCase('boneyard', 'butcher_block_m', '421', I.M);
armorCase('freak', 'claw_rush_m', '236', I.M);
{
  // a step cancels into the 2L tick and into a special (whiff window)
  const tickName = Object.keys(def('bruno').moves).find((k) => def('bruno').moves[k].input === '2L')!;
  const m = mk('bruno', 'johnny');
  place(m, -2.5, 2.5);
  motion(m, 0, '252', I.M);
  run(m, 12, 0, 0); // let the 22 motion age out of its window
  step(m, dirBits(m, 0, 2) | I.L, 0);
  t.eq(mvName(m, 0) === tickName ? 1 : 0, 1, `bruno brace_m cancels into the ${tickName} tick (got "${mvName(m, 0)}")`);
  const m2 = mk('bruno', 'johnny');
  place(m2, -2.5, 2.5);
  motion(m2, 0, '252', I.M);
  run(m2, 3, 0, 0);
  motion(m2, 0, '63214789', I.L);
  t.ok(mvName(m2, 0).startsWith('walk_in'), `bruno brace_m cancels into WALK-IN FREEZER (360) (got "${mvName(m2, 0)}")`);
}

// ================================================================= 6. TELEPORT (zambini)
for (const [moveId, btn] of [['vanish_l', I.L], ['vanish_m', I.M], ['vanish_h', I.H]] as [string, number][]) {
  const mv = def('zambini').moves[moveId];
  const tp = mv.teleport!;
  const m = mk('zambini', 'johnny');
  place(m, -2.0, 1.0);
  const e0 = m.frame();
  motion(m, 0, '214', btn);
  t.eq(mvName(m, 0) === moveId ? 1 : 0, 1, `zambini 214 starts ${moveId}`);
  const k = until(m, () => evs(m, e0).some((e) => e.type === EVX.TELEPORT), tp.f + 2);
  t.ok(k >= 0 && readFighter(m, 0).moveFrame === tp.f, `${moveId}: TELEPORT on move frame ${tp.f}`, `mvF ${readFighter(m, 0).moveFrame}`);
  // CHANGED(SIM3D): home = the ring boundary behind him seen from the opponent (on the x axis: -ring radius), gap inward;
  // then the ring clamp (his push circle inside) and the separation cap
  const wall = m.ring.r / U;
  let want = 0;
  if (tp.to === 'behind') want = 1.0 + tp.gapM;
  else if (tp.to === 'front') want = 1.0 - tp.gapM;
  else want = Math.max(-wall + tp.gapM, -wall + m.cf[0].pushBS / U, 1.0 - data.system.stage.separationCapM);
  t.near(x(m, 0), want, 0.0015, `${moveId} (${tp.to}, gap ${tp.gapM} m) lands at x ${want.toFixed(3)}`);
  if (tp.to === 'behind') {
    t.eq(m.s[sb(0) + F.facing], 1, 'behind: he still faces his old way during the move (facing re-resolves when free)');
    until(m, () => isFree(m, 0), 60);
    step(m, 0, 0);
    t.eq(m.s[sb(0) + F.facing], -1, 'behind: facing re-resolves toward the opponent on the next free frame');
  }
}
{
  // EX vanish (behind) cancelled into a special after the jump fires it at the opponent
  const ex = def('zambini').moves.vanish_ex;
  const m = mk('zambini', 'johnny');
  place(m, -2.0, 1.0);
  fullMeters(m, 0);
  motion(m, 0, '214', I.S);
  t.eq(mvName(m, 0) === 'vanish_ex' ? 1 : 0, 1, 'zambini 214S = vanish_ex');
  until(m, () => readFighter(m, 0).moveFrame >= ex.teleport!.f + 1, 30);
  const fBefore = m.s[sb(0) + F.facing];
  motion(m, 0, '236', I.L);
  t.ok(mvName(m, 0).startsWith('card_fan') && m.s[sb(0) + F.facing] === -fBefore, `vanish_ex cancels into ${mvName(m, 0)} facing the opponent (facing ${fBefore} -> ${m.s[sb(0) + F.facing]})`);
}
{
  // invulnerable through the vanish, punishable recovery
  const mv = def('zambini').moves.vanish_m;
  const inv = mv.invuln!.strike!;
  const m = mk('zambini', 'johnny');
  place(m, -1.4, -0.2);
  motion(m, 0, '214', I.M);
  run(m, inv[0] + 1, 0, 0);
  const e0 = m.frame();
  step(m, 0, I.L);
  run(m, 6, 0, 0);
  t.ok(!evs(m, e0).some((e) => (e.type === EV.HIT || e.type === EV.COUNTER) && e.b === 0), `vanish strike-invulnerable frames ${JSON.stringify(inv)}: johnny 5L whiffs`);
  const mv2 = def('zambini').moves.vanish_h;
  const m2 = mk('zambini', 'johnny');
  place(m2, -1.0, 0.2);
  motion(m2, 0, '214', I.L);
  const mvL = def('zambini').moves.vanish_l;
  until(m2, () => readFighter(m2, 0).moveFrame > mvL.invuln!.strike![1] + 1, 60);
  // johnny turns and pokes the recovering magician
  const e1 = m2.frame();
  step(m2, 0, I.M);
  const k = until(m2, () => evs(m2, e1).some((e) => e.type === EV.PUNISH && e.a === 1), 20);
  t.ok(k >= 0, 'a hit in the recovery after the teleport is a PUNISH counter');
  void mv2;
}

// ================================================================= 7. PHASES (ricky)
{
  const R = uq('ricky');
  const thr = R.thresholdPct as number;
  const lockF = R.lockF as number;
  const hpMax = def('ricky').hp;
  const m = newMatch({ p1: 'johnny', p2: 'ricky', data, s1: 1, s2: 1, timer: 99 });
  place(m, -1.0, 0.0);
  t.eq(readFighter(m, 1).unique[0], 1, 'ricky starts the bout in phase 1');
  // phase 1: 22 is not routed (pyro is a phase-2 move)
  motion(m, 1, '252', I.L);
  t.ok(!mvName(m, 1).startsWith('pyro'), `phase 1: 22L does not reach pyro (got "${mvName(m, 1) || 'none'}")`);
  freeBoth(m);
  place(m, -1.0, 0.0);
  setHp(m, 1, Math.trunc((hpMax * thr) / 100) + 100);
  const e0 = m.frame();
  step(m, I.M, 0);
  const k = until(m, () => evs(m, e0).some((e) => e.type === EVX.PHASE), 20);
  t.ok(k >= 0 && readFighter(m, 1).unique[0] === 2, `dropping below ${thr}% HP flips ricky to phase 2 (PHASE event)`);
  const mm = readMatch(m);
  t.ok(mm.freeze > 0 && mm.freeze <= lockF && m.s[W.freezeKind] === 3, `both fighters lock ${lockF} f (world freeze kind 3; freeze now ${mm.freeze})`);
  t.ok(evs(m, e0).some((e) => e.type === EV.CAMERA_CUE && e.b === 6), 'CAMERA_CUE PHASE (6) emitted');
  const tm = m.s[W.timer];
  const u1a = readFighter(m, 1).unique[1];
  run(m, 10, 0, 0);
  t.eq(m.s[W.timer], tm, 'the round timer is frozen during the lock');
  t.eq(readFighter(m, 1).unique[1], u1a - 10, `unique[1] counts the lock down (${u1a} -> ${readFighter(m, 1).unique[1]})`);
  until(m, () => m.s[W.freeze] === 0, lockF + 5);
  freeBoth(m);
  place(m, -2.0, 2.0);
  motion(m, 1, '252', I.L);
  t.eq(mvName(m, 1) === 'pyro_l' ? 1 : 0, 1, `phase 2: 22L = pyro_l (got "${mvName(m, 1)}")`);
  freeBoth(m);
  fullMeters(m, 1);
  motion(m, 1, '214214', I.L);
  t.eq(mvName(m, 1) === R.lv3 ? 1 : 0, 1, `phase 2: CLASSIC 214214 = lv3 ${String(R.lv3)} (got "${mvName(m, 1)}")`);
  // SIMPLE overrides
  const m2 = newMatch({ p1: 'johnny', p2: 'ricky', data, s1: 0, s2: 0, timer: 0 });
  place(m2, -2.0, 2.0);
  step(m2, 0, dirBits(m2, 1, 6) | I.S);
  t.eq(mvName(m2, 1) === def('ricky').simple['6S'] ? 1 : 0, 1, `phase 1 SIMPLE 6S = ${def('ricky').simple['6S']}`);
  freeBoth(m2);
  m2.s[sb(1) + F.uniq] = 2; // test setup: phase 2 without the lock
  step(m2, 0, dirBits(m2, 1, 6) | I.S);
  t.eq(mvName(m2, 1) === (R.simple as Record<string, string>)['6S'] ? 1 : 0, 1, `phase 2 SIMPLE 6S = ${(R.simple as Record<string, string>)['6S']}`);
  freeBoth(m2);
  fullMeters(m2, 1);
  step(m2, 0, dirBits(m2, 1, 2) | I.S | I.H);
  t.eq(mvName(m2, 1) === R.lv3 ? 1 : 0, 1, `phase 2 SIMPLE S+H+2 = ${String(R.lv3)} (got "${mvName(m2, 1)}")`);
  // persists into the next round
  const m3 = newMatch({ p1: 'johnny', p2: 'ricky', data, s1: 1, s2: 1, timer: 99 });
  m3.s[sb(1) + F.uniq] = 2;
  setHp(m3, 1, 1);
  place(m3, -1.0, 0.0);
  step(m3, I.M, 0);
  until(m3, () => m3.s[W.round] === 2 && m3.s[W.phase] === PH.FIGHT, 700);
  t.ok(m3.s[W.round] === 2 && readFighter(m3, 1).unique[0] === 2, 'phase 2 persists into the next round');
  // a KO below the threshold does not lock
  const m4 = newMatch({ p1: 'johnny', p2: 'ricky', data, s1: 1, s2: 1, timer: 99 });
  place(m4, -1.0, 0.0);
  const e4 = m4.frame();
  step(m4, I.M, 0);
  run(m4, def('johnny').moves['5M'].startup - 2, 0, 0);
  setHp(m4, 1, 50); // the hit lands next frame: it crosses the threshold AND KOs
  run(m4, 20, 0, 0);
  t.ok(!evs(m4, e4).some((e) => e.type === EVX.PHASE) && m4.s[W.phase] === PH.KO, 'a KO below the threshold is a KO, not a phase change');
}

// ================================================================= 8. INSTALLS (fixture move with an install block)
{
  const kitA = JSON.parse(readFileSync(ROOT + '_harness/fixtures/kit_a.json', 'utf8'));
  const kitB = JSON.parse(readFileSync(ROOT + '_harness/fixtures/kit_b.json', 'utf8'));
  kitA.moves.duck.install = { frames: 120, damagePct: 150, walkPct: 150 };
  const fx = buildGameData({
    system: JSON.parse(readFileSync(ROOT + 'data/system.json', 'utf8')),
    fighters: { kit_a: kitA, kit_b: kitB },
    clips: { kit_a: JSON.parse(readFileSync(ROOT + '_harness/fixtures/kit_a.clips.json', 'utf8')), kit_b: JSON.parse(readFileSync(ROOT + '_harness/fixtures/kit_b.clips.json', 'utf8')) },
  });
  const base = newMatch({ p1: 'kit_a', p2: 'kit_b', data: fx, timer: 0 });
  place(base, -1.0, 0.0);
  step(base, I.M, 0);
  run(base, 12, 0, 0);
  const d0 = def('johnny') && (readFighter(base, 1).hpMax - readFighter(base, 1).hp);
  const m = newMatch({ p1: 'kit_a', p2: 'kit_b', data: fx, timer: 0 });
  place(m, -2.5, 2.5);
  const e0 = m.frame();
  motion(m, 0, '252', I.L);
  t.ok(evs(m, e0).some((e) => e.type === EVX.INSTALL && e.a === 0 && e.b === 120) && readFighter(m, 0).install === 120 - 0, `an install move grants its frames (INSTALL, FighterSnap.install ${readFighter(m, 0).install})`);
  freeBoth(m);
  const left = readFighter(m, 0).install ?? 0;
  t.ok(left > 0 && left < 120, `the install counts down (${left} left)`);
  const x0 = x(m, 0);
  run(m, 5, dirBits(m, 0, 6), 0);
  const wf = Math.round((fx.fighters.kit_a.walk.fwd * U) / 60);
  const wI = Math.trunc((wf * 150) / 100);
  t.near(x(m, 0) - x0, (Math.trunc((wI * fx.system.movement.walkFirstFramePct) / 100) + 4 * wI) / U, 0.0001, 'walkPct 150: walks 1.5x');
  place(m, -1.0, 0.0);
  step(m, I.M, 0);
  run(m, 12, 0, 0);
  const d1 = readFighter(m, 1).hpMax - readFighter(m, 1).hp;
  t.eq(d1, Math.trunc((d0 * 150) / 100), `damagePct 150: 5M deals ${d1} (plain ${d0})`);
  run(m, 130, 0, 0);
  t.eq(readFighter(m, 0).install ?? -1, 0, 'the install runs out');
}

// ================================================================= 9. P1 fixes (CONTRACT §28.5)
// (a) motion priority: HC over QC, 360 over the rest, DP over QC
{
  const cases: [string, string, number, string][] = [
    ['ricky', '41236', I.H, 'the_hook_h'],
    ['rerun', '63214', I.L, 'last_meal_l'],
    ['zambini', '63214', I.L, 'flash_paper_l'],
    ['bruno', '63214789', I.L, 'walk_in_l'],
    ['johnny', '6236', I.L, 'encore_l'],
  ];
  for (const [id, mo, btn, want] of cases) {
    const m = mk(id, 'johnny');
    place(m, -1.0, 0.5);
    motion(m, 0, mo, btn);
    t.eq(mvName(m, 0) === want ? 1 : 0, 1, `motion priority: ${id} ${mo} = ${want} (got "${mvName(m, 0)}")`);
  }
}
// (b) derive v2: ground-normal reach follows the class and meets FIGHTING_DESIGN 2h
{
  const floors = (data.system.boxes as unknown as { reachFloorM: Record<string, number> }).reachFloorM;
  const rows: string[] = [];
  let order = 0;
  let floorMiss = 0;
  for (const id of Object.keys(data.fighters).sort()) {
    const fd = def(id);
    const cf = mk(id, 'johnny').cf[0];
    const reach = (k: string): number => {
      const mv = cf.moves.find((q) => q.id === k);
      if (!mv || mv.nBox === 0) return NaN;
      let r = 0;
      for (let j = 0; j < mv.nBox; j++) r = Math.max(r, (mv.boxes[j * 7 + 2] + (mv.boxes[j * 7 + 4] >> 1)) / U);
      return r;
    };
    const r5l = reach('5L');
    const r5m = reach('5M');
    const r5h = reach('5H');
    const sweepId = Object.keys(fd.moves).find((k) => (fd.moves[k].role ?? []).includes('sweep'));
    const rsw = sweepId ? reach(sweepId) : NaN;
    const scale = fd.heightM / floors.refHeightM;
    // hand-set = boxes in the RAW kit file without boxSrc (the loaded def carries derived boxes too)
    const rawMv = (JSON.parse(readFileSync(ROOT + `data/fighters/${id}.json`, 'utf8')) as { moves: Record<string, Move> }).moves;
    const hand = (k: string): boolean => !!rawMv[k] && !!rawMv[k].boxes && rawMv[k].boxSrc !== 'hitVolume';
    if (!(r5l < r5m && r5m < r5h)) order++;
    for (const [k, r, fk] of [['5L', r5l, '5L'], ['5M', r5m, '5M'], ['5H', r5h, '5H']] as [string, number, string][]) {
      if (!hand(k) && r + 0.0005 < floors[fk] * scale) floorMiss++;
    }
    rows.push(`${id.padEnd(9)} 5L ${r5l.toFixed(2)}  5M ${r5m.toFixed(2)}  5H ${r5h.toFixed(2)}  sweep ${Number.isNaN(rsw) ? '  - ' : rsw.toFixed(2)}  (2h x${scale.toFixed(2)}: ${(floors['5L'] * scale).toFixed(2)} / ${(floors['5M'] * scale).toFixed(2)} / ${(floors['5H'] * scale).toFixed(2)} / ${(floors.sweep * scale).toFixed(2)})${hand('5L') || hand('5M') || hand('5H') ? ' [hand-set boxes kept]' : ''}`);
  }
  t.eq(order, 0, 'every kit: standing reach 5L < 5M < 5H (derive v2)');
  t.eq(floorMiss, 0, 'every derived standing normal reaches its FIGHTING_DESIGN 2h class reach x height');
  const jl = rows.find((r) => r.startsWith('johnny'))!;
  t.note(`reach table (m, far edge of the hitbox from the root):\n    ${rows.join('\n    ')}`);
  try {
    writeFileSync(ROOT + '_harness/_reports/sim_p2_reach_table.txt', `derive v2 reach table (probe_uniques)\n${rows.join('\n')}\n`, 'utf8');
  } catch {
    /* report only */
  }
  if (VERBOSE) console.log(rows.join('\n'));
  t.ok(/5L 1\.\d\d|5L 0\.\d\d/.test(jl), `johnny row: ${jl}`);
}
// (c) measured asymmetric hurtboxes
{
  const b = data.bodies.johnny;
  t.ok(!!b, 'data/bodies.json has johnny');
  const m = mk('johnny', 'bruno');
  place(m, -1.0, 1.0);
  t.eq(m.cf[0].hurtFS, Math.round(b.stand[0] * U), `johnny stand hurt front = bodies.json ${b.stand[0]} m`);
  t.eq(m.cf[0].hurtBS, Math.round(b.stand[1] * U), `johnny stand hurt back = bodies.json ${b.stand[1]} m`);
  // a projectile-free check through a strike: bruno's 5L far edge exactly at johnny's front edge +/- 1 cm
  const out = new Int32Array(24);
  const n = hurtRects(m, 0, out);
  t.ok(n >= 1 && out[1] - m.s[sb(0) + F.x] === m.cf[0].hurtFS && m.s[sb(0) + F.x] - out[0] === m.cf[0].hurtBS, 'facing +x: box = x - back .. x + front');
  m.s[sb(0) + F.facing] = -1;
  hurtRects(m, 0, out);
  t.ok(out[1] - m.s[sb(0) + F.x] === m.cf[0].hurtBS && m.s[sb(0) + F.x] - out[0] === m.cf[0].hurtFS, 'facing -x: mirrored');
  let miss = 0;
  for (const id of Object.keys(data.fighters)) if (!data.bodies[id]) miss++;
  t.eq(miss, 0, 'every fighter has measured hurt extents');
}
// (d) throw knockdowns play the whole wake; the advantage is the data's
{
  let bad = 0;
  const rows: string[] = [];
  for (const id of Object.keys(data.fighters).sort()) {
    for (const tid of ['throw_f', 'throw_b']) {
      const mv = def(id).moves[tid];
      if (!mv || !mv.grab) continue;
      const m = mk(id, 'johnny');
      const gapM = (m.cf[0].pushFS + m.cf[1].pushFS) / U + Math.min(0.3, mv.grab.rangeM ?? def(id).throwRangeM) - 0.05;
      place(m, -gapM / 2, gapM / 2);
      step(m, tid === 'throw_b' ? I.THROW | dirBits(m, 0, 4) : I.THROW, 0);
      const k = until(m, () => st(m, 1) === ST.THROWN, 12);
      if (k < 0) {
        rows.push(`${id} ${tid}: did not connect`);
        bad++;
        continue;
      }
      let tFree = -1;
      let vFree = -1;
      let kdLen = 0;
      for (let f = 0; f < 400 && (tFree < 0 || vFree < 0); f++) {
        step(m, 0, 0);
        if (st(m, 1) === ST.KNOCKDOWN) kdLen = Math.max(kdLen, m.s[sb(1) + F.tot]);
        if (tFree < 0 && isFree(m, 0)) tFree = f;
        if (vFree < 0 && isFree(m, 1)) vFree = f;
      }
      const wakeDur = data.clips.johnny.clips[kdLen > 0 && m.s[sb(1) + F.kdFace] & 1 ? 'wake_f' : 'wake_b']?.dur ?? 1.2333;
      const needMin = Math.ceil(Math.trunc(wakeDur * 60) / (data.system.anim.wakeMaxRate ?? 2));
      const adv = vFree - tFree;
      const okAdv = adv === mv.grab.adv;
      const okWake = kdLen >= needMin;
      if (!okAdv || !okWake) bad++;
      rows.push(`${id} ${tid}: KD ${kdLen} f (wake needs >= ${needMin}) adv ${adv} (data ${mv.grab.adv})${okAdv && okWake ? '' : '  <-- BAD'}`);
    }
  }
  t.eq(bad, 0, 'every throw_f / throw_b: the knockdown fits the whole wake and the advantage = grab.adv');
  t.note(`throw knockdowns:\n    ${rows.join('\n    ')}`);
}
// (e) KO clamps the snapshot HP at 0
{
  const m = mk('johnny', 'bruno');
  place(m, -1.0, 0.0);
  setHp(m, 1, 50);
  step(m, I.H, 0);
  run(m, 14, 0, 0);
  t.ok(m.s[sb(1) + F.hp] < 0 && readFighter(m, 1).hp === 0 && m.s[W.phase] === PH.KO, `KO overkill: state hp ${m.s[sb(1) + F.hp]}, snapshot hp ${readFighter(m, 1).hp}`);
}
// (f) CINEMATIC_END: the victim lies down without a second fall
{
  const m = mk('johnny', 'bruno', 0, 0);
  place(m, -0.9, 0.0);
  fullMeters(m, 0);
  step(m, dirBits(m, 0, 2) | I.S | I.H, 0);
  const k = until(m, () => m.s[W.cinActive] !== 0, 120);
  const e0 = m.frame();
  const k2 = until(m, () => evs(m, e0).some((e) => e.type === EV.CINEMATIC_END), 400);
  t.ok(k >= 0 && k2 >= 0, 'johnny Lv3 plays its cinematic');
  t.ok(st(m, 1) === ST.KNOCKDOWN && (m.s[sb(1) + F.kdFace] & 2) !== 0, 'at CINEMATIC_END the victim knockdown starts with NOFALL (no pop up, no second fall)');
  t.eq(readFighter(m, 1).animId === m.tab.anims[1].findIndex((a) => a.clip === 'kd_fall_b') ? 1 : 0, 0, 'the victim does not replay kd_fall_b from standing');
}

t.done();
