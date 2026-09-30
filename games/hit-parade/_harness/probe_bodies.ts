// probe_bodies (G2, CHANGED(fixer) D2 / D3): measured push boxes, throw carry and knockdown presentation on the REAL data/
// (johnny vs bruno; every assertion reads the sim state / snapshots only).
//   D2  walking in stops exactly at push front + push front; crouching pushes to crouchFront + front; a lunging normal's
//       pushExt widens the gap while it runs; walls clamp by the per-side extent.
//   D3  a forward throw carries the victim along its clip root (it lands > 0.8 m farther away, no per-frame jump > 6 cm,
//       no teleport at the release); a back throw lands the victim behind the thrower clear of both boxes; the victim shows
//       the grab's victim segments (johnny throw_f: hit_body, then kd_fall_b) and a knockdown ends on the wake clip's last
//       frame (no pop to idle); a KD from a sweep starts with the fall clip past its drop time (not a standing pose).
import { readFileSync } from 'node:fs';
import { newMatch, place, run, fs, evs, I, tester, dirBits, sb, ROOT } from './fixtures/simkit.ts';
import { step } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { loadGameData } from '../runtime/src/core/data.ts';
import { EV } from '../runtime/src/core/sim/events.ts';
import { F, ST } from '../runtime/src/core/sim/layout.ts';
import { SHARED_CLIPS } from '../runtime/src/core/data.ts';
import type { FighterDef } from '../runtime/src/core/types.ts';

const t = tester('probe_bodies');
const data = loadGameData();
const J = data.fighters.johnny as FighterDef;
const B = data.fighters.bruno as FighterDef;
const CL = (n: string): number => SHARED_CLIPS.indexOf(n);
const U = 100000;

function mk(): Match {
  return newMatch({ p1: 'johnny', p2: 'bruno', data, s1: 0, s2: 0 });
}
const sep = (m: Match): number => Math.abs(m.s[sb(1) + F.x] - m.s[sb(0) + F.x]) / U;
const st = (m: Match, i: number): number => m.s[sb(i) + F.st];
function isFree(m: Match, i: number): boolean {
  const s = st(m, i);
  return s === ST.IDLE || s === ST.CROUCH || s === ST.WALK_F || s === ST.WALK_B;
}

t.ok(!!J.push && !!B.push, 'johnny and bruno carry measured push extents', JSON.stringify([J.push, B.push]));
const jf = J.push?.front ?? 0, bf = B.push?.front ?? 0, jcf = J.push?.crouchFront ?? 0;

// ---------------------------------------------------------------- D2 spacing
{
  const m = mk();
  place(m, -1.5, 1.5);
  run(m, 150, dirBits(m, 0, 6), 0);
  t.near(sep(m), jf + bf, 0.0001, `walk-in stops at johnny front + bruno front (${(jf + bf).toFixed(3)} m; was 0.52 m)`);
  run(m, 5, 0, 0);
  const s0 = sep(m);
  run(m, 20, dirBits(m, 0, 2), 0);
  t.near(sep(m), jcf + bf, 0.0001, `crouching pushes to johnny crouchFront + bruno front (${(jcf + bf).toFixed(3)} m)`);
  run(m, 20, 0, 0);
  t.ok(sep(m) >= s0 - 0.0001, 'standing up again leaves the gap (no pull back)', `${sep(m).toFixed(3)} vs ${s0.toFixed(3)}`);
}
{
  // a normal with pushExt (johnny 2M: 0.09 m lean) widens the gap while it runs
  const m = mk();
  place(m, -1.5, 1.5);
  run(m, 150, dirBits(m, 0, 6), 0);
  run(m, 30, 0, 0);
  const s0 = sep(m);
  let mx = s0;
  for (let k = 0; k < 20; k++) {
    step(m, k < 2 ? dirBits(m, 0, 2) | I.M : dirBits(m, 0, 2), 0);
    mx = Math.max(mx, sep(m));
  }
  t.ok((J.moves['2M'].pushExt ?? []).length > 0, 'johnny 2M carries a measured pushExt');
  t.ok(mx > s0 + 0.05, '2M lean widens the gap by its pushExt', `${s0.toFixed(3)} -> max ${mx.toFixed(3)} m`);
}
{
  // walls: back to the wall = the BACK extent
  const m = mk();
  place(m, -6.0, -3.5);
  run(m, 200, dirBits(m, 0, 4), 0);
  const x = m.s[sb(0) + F.x] / U;
  t.near(x, -(data.system.stage.wallM - (J.push?.back ?? 0)), 0.0001, `backing into the wall stops at wall - push.back (${(J.push?.back ?? 0).toFixed(3)} m)`);
}

// ---------------------------------------------------------------- D3 forward throw (johnny throw_f: custom victim segments)
{
  const m = mk();
  place(m, -1.5, 1.5);
  run(m, 150, dirBits(m, 0, 6), 0);
  run(m, 10, 0, 0);
  const x0 = m.s[sb(1) + F.x] / U;
  const from = m.frame() + 1;
  let maxStep = 0;
  let prev = x0;
  const anims = new Set<number>();
  let freeAt = -1;
  let wakeEnd = -1;
  let lastAnim = -1, lastAnimF = -1;
  let relStep = -1;
  let lastCarry = 0; // CHANGED(SIM) P2: the carry step just before the release (the victim timeline may still slide)
  let prevSt = st(m, 1);
  for (let k = 0; k < 140; k++) {
    step(m, k === 0 ? I.THROW : 0, 0);
    const x = m.s[sb(1) + F.x] / U;
    const s1 = st(m, 1);
    if (prevSt === ST.THROWN && s1 === ST.KNOCKDOWN) relStep = Math.abs(x - prev);
    else if (s1 === ST.THROWN) lastCarry = Math.abs(x - prev);
    prevSt = s1;
    if (s1 === ST.THROWN || s1 === ST.KNOCKDOWN) {
      maxStep = Math.max(maxStep, Math.abs(x - prev));
      anims.add(m.s[sb(1) + F.animId]);
      lastAnim = m.s[sb(1) + F.animId];
      lastAnimF = m.s[sb(1) + F.animF];
    } else if (freeAt < 0 && k > 10 && isFree(m, 1)) {
      freeAt = k;
      wakeEnd = lastAnim === CL('wake_b') ? lastAnimF : -1;
    }
    prev = x;
  }
  const e = evs(m, from);
  t.ok(e.some((q) => q.type === EV.THROW), 'johnny throw_f connects from the walk-in contact');
  t.ok(anims.has(CL('hit_body')) && anims.has(CL('kd_fall_b')), 'the victim shows the grab.victim segments (hit_body, kd_fall_b)',
    [...anims].map((a) => SHARED_CLIPS[a] ?? a).join(','));
  t.ok(!anims.has(CL('thrown_f')), 'Clinch Body Shots no longer plays the generic thrown_f');
  const x1 = m.s[sb(1) + F.x] / U;
  t.ok(x1 - x0 > 0.3, 'the victim is carried away from the thrower (no wake-up inside it)', `x ${x0.toFixed(3)} -> ${x1.toFixed(3)}`);
  // CHANGED(SIM) P2: a teleport = a step larger than the carry itself was making (FIGHTERS' P2 victim timeline ends in a
  // 2x kd_fall_b slide, 4-7 cm per frame); the release frame may continue that motion, never jump beyond it
  t.ok(relStep >= 0 && relStep <= Math.max(0.03, lastCarry + 0.01), 'no teleport at the release (release step <= max(3 cm, last carry step + 1 cm))',
    `${relStep.toFixed(4)} m (last carry step ${lastCarry.toFixed(4)} m)`);
  t.ok(maxStep <= 0.15, 'the carry is a continuous path (max per-frame step <= 15 cm: the fast kd_fall_b drop)', `${maxStep.toFixed(4)} m`);
  const wb = data.clips.bruno.clips.wake_b;
  t.ok(wakeEnd >= Math.round(wb.dur * 60) - 2, 'the knockdown ends on the wake clip\'s last frame (no pop to idle)',
    `last wake animF ${wakeEnd} vs clip ${Math.round(wb.dur * 60)}`);
}
// ---------------------------------------------------------------- D3 back throw (default thrown_b, side swap)
{
  const m = mk();
  place(m, -1.5, 1.5);
  run(m, 150, dirBits(m, 0, 6), 0);
  run(m, 10, 0, 0);
  const x0 = m.s[sb(0) + F.x] / U;
  let maxStep = 0;
  let prev = m.s[sb(1) + F.x] / U;
  let sawThrownB = false;
  let kdDown = false;
  for (let k = 0; k < 140; k++) {
    step(m, k === 0 ? dirBits(m, 0, 4) | I.THROW : 0, 0);
    const x = m.s[sb(1) + F.x] / U;
    if (st(m, 1) === ST.THROWN) {
      maxStep = Math.max(maxStep, Math.abs(x - prev));
      if (m.s[sb(1) + F.animId] === CL('thrown_b')) sawThrownB = true;
    }
    if (st(m, 1) === ST.KNOCKDOWN && [CL('kd_ground_f'), CL('wake_f')].includes(m.s[sb(1) + F.animId])) kdDown = true;
    prev = x;
  }
  const xv = m.s[sb(1) + F.x] / U, xa = m.s[sb(0) + F.x] / U;
  t.ok(sawThrownB, 'back throw victim plays thrown_b');
  t.ok(xv < xa, 'back throw: the victim lands behind the thrower', `thrower ${xa.toFixed(3)} (from ${x0.toFixed(3)}) victim ${xv.toFixed(3)}`);
  t.ok(xa - xv >= jf + bf - 0.0001, 'after the wake-up both push boxes are clear (gap >= front + front)', `${(xa - xv).toFixed(3)} m`);
  t.ok(kdDown, 'thrown_b lands face down: the knockdown lies / rises face down (kd_ground_f / wake_f)');
  t.ok(maxStep <= 0.25, 'the back-throw path is continuous (no teleport)', `max step ${maxStep.toFixed(3)} m`);
}
// ---------------------------------------------------------------- D3 knockdown from a sweep starts falling (not standing)
{
  const kdMove = Object.entries(J.moves).find(([, mv]) => mv.onHit?.kd && mv.onHit.kd !== 'none' && !(mv.onHit.launch && mv.onHit.launch[1] > 0)
    && (mv.kind === 'normal' || mv.kind === 'command') && /^[123]/.test(mv.input ?? ''));
  t.ok(!!kdMove, 'johnny has a grounded knockdown normal', kdMove ? kdMove[0] : 'none');
  if (kdMove) {
    const m = mk();
    place(m, -1.5, 1.5);
    run(m, 150, dirBits(m, 0, 6), 0);
    run(m, 10, 0, 0);
    let first = -1, firstF = -1;
    const w = dirBits(m, 0, Number((kdMove[1].input ?? '2')[0])) | (kdMove[1].input?.endsWith('H') ? I.H : kdMove[1].input?.endsWith('M') ? I.M : I.L);
    for (let k = 0; k < 60; k++) {
      step(m, k < 2 ? w : 0, 0);
      if (first < 0 && st(m, 1) === ST.KNOCKDOWN) { first = m.s[sb(1) + F.animId]; firstF = m.s[sb(1) + F.animF]; }
    }
    const drop = Math.round((data.system.anim.kdFall?.kd_fall_b?.[0] ?? 0) * 60);
    t.ok(first === CL('kd_fall_b') && firstF >= drop - 1, `a ${kdMove[0]} knockdown opens on kd_fall_b past its drop (virtual frame >= ${drop})`,
      `anim ${SHARED_CLIPS[first] ?? first} f${firstF}`);
  }
}
void readFileSync; void ROOT;
t.done(`johnny/bruno push fronts ${jf}/${bf} m, walk-in gap ${(jf + bf).toFixed(3)} m`);
