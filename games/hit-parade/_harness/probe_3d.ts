// probe_3d (G2, lane SIM3D): the 3D ring (CONTRACT §35.10 + §35.1-35.4, 35.8).
//   fx3d unit tests (sine table pinned, trig / atan / isqrt / rot exactness, no libm trig in core/sim),
//   spawn axis + camera side + P1 screen-left, auto-face, STEP_IN / STEP_OUT directions, SIDESTEP (15 f, 0.85 m arc,
//   step-attack from f11, block from f12), SIDEWALK (distance +-2 cm over 2 s, 1.8 m/s, back cancels into block, 4 f
//   settle), camN continuity over a full circle, sidestep evades a LINEAR attack but not a HOMING one, tracking
//   until / rate as authored, lateral hit depth, ring collision + wall splat on a circle and an octagon (sector / side
//   index + inward normal), projectile dodged by a step, aimed projectiles, Gazza's ball reflection off the ring,
//   throw front arc +-70 deg, throw carry along the thrower's yaw, back throw lands behind, BRAWL goons + heckle arcs
//   from all sides, soft lock, determinism + save/load re-step with random STEP streams, snapshot fields.
//   CHANGED(STEPTUNE) (CONTRACT §35.15): section 3b = the front-loaded step curve + the measured STEPPABLE TABLE (move
//   classes x 1.2 / 2.0 m, step-start windows relative to the attack's frame 1) + a roster sweep of all 12 kits.
//   CHANGED(fix_core) (CONTRACT §35.20): 3b by-DEFENDER rows gate the per-fighter step (D1: every body evades a straight
//   5M / 5H at 1.2 m from >= 2 start frames, small bodies keep larger windows, homing never even for the longest steps);
//   section 10 = D9 (a press on any sidestep frame comes out on frame 11, newest wins), D7 BACK HIT, D4 grab hold (FINAL
//   DELIVERY follows grab.path; every other grab pulls its victim to the hold point). D8 (teleport facing): probe_uniques.
import { readFileSync, readdirSync } from 'node:fs';
import { I, ROOT, dirBits, evs, fixtureData, newMatch, place, place3, run, sb, stepInputs, tester } from './fixtures/simkit.ts';
import { buildGameData, loadGameData, STEP_CLIPS } from '../runtime/src/core/data.ts';
import type { GameData } from '../runtime/src/core/types.ts';
import { checksum, load, readFighter, readMatch, save, step } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { ACT, BALL, BR, BRAWL_BASE, F, G, GOON_CAP, P, PROJ_CAP, ST, STATE_INTS, W, goonBase, projBase } from '../runtime/src/core/sim/layout.ts';
import { BALL_EV, EV, EVX, EV3D } from '../runtime/src/core/sim/events.ts';
import {
  Q, SIN_Q, cosQ, dirToYaw, divRound, isqrt, mulQ, rot, sinQ, sinTableHash, yawDelta, degToYaw,
} from '../runtime/src/core/sim/fx3d.ts';
import { canBlock } from '../runtime/src/core/sim/hits.ts';
import { inFrontArc } from '../runtime/src/core/sim/throws.ts';
import { holdDist, victimPose } from '../runtime/src/core/sim/throwpose.ts'; // CHANGED(fix_core) D4
import { boxCyl, pushCircle } from '../runtime/src/core/sim/boxes.ts';

const t = tester('probe_3d');
const U = 100000;
const RAW = (rel: string): unknown => JSON.parse(readFileSync(ROOT + rel, 'utf8'));

// ================================================================= 0. fx3d unit tests
{
  t.eq(sinTableHash(), 0xc92b373b, 'sine table hash pinned (Taylor polynomial in doubles = identical on every engine)');
  let mono = true;
  for (let k = 1; k <= 4096; k++) if (SIN_Q[k] < SIN_Q[k - 1]) mono = false;
  t.ok(SIN_Q[0] === 0 && SIN_Q[4096] === Q && mono, 'quarter-wave table: 0 .. 16384, monotonic');
  let maxErr = 0;
  let maxYawErr = 0;
  let neg0 = false;
  for (let y = 0; y < 65536; y++) {
    const e = Math.abs(sinQ(y) - Math.round(Math.sin((y * 2 * Math.PI) / 65536) * Q));
    if (e > maxErr) maxErr = e;
    const back = dirToYaw(sinQ(y) * 37, cosQ(y) * 37);
    const d = Math.abs(yawDelta(y, back));
    if (d > maxYawErr) maxYawErr = d;
    if (Object.is(sinQ(y), -0) || Object.is(cosQ(y), -0)) neg0 = true;
  }
  t.ok(maxErr <= 1, `sinQ within 1 LSB of libm for all 65536 yaws (max ${maxErr})`);
  t.ok(maxYawErr <= 1, `dirToYaw(yawToDir(y)) round trip within 1 unit for all yaws (max ${maxYawErr})`);
  t.ok(!neg0, 'no negative zero from sinQ / cosQ');
  t.ok(dirToYaw(1, 0) === 16384 && dirToYaw(0, -5) === 32768 && dirToYaw(-3, 0) === 49152 && dirToYaw(0, 9) === 0 && dirToYaw(7, 7) === 8192,
    'dirToYaw axes / diagonal: +X 16384, -Z 32768, -X 49152, +Z 0, 45 deg 8192');
  // big vectors (|d| up to 2^30)
  let bigErr = 0;
  for (let k = 0; k < 2000; k++) {
    const y = (k * 7919) & 65535;
    const r = (1 << 30) - k * 1000;
    const got = dirToYaw(mulQ(r, sinQ(y)), mulQ(r, cosQ(y)));
    bigErr = Math.max(bigErr, Math.abs(yawDelta(y, got)));
  }
  t.ok(bigErr <= 1, `dirToYaw exact on 2^30 U vectors (max ${bigErr})`);
  let bad = 0;
  let seed = 12345;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) | 0;
    return (seed >>> 0) / 4294967296;
  };
  for (let k = 0; k < 100000; k++) {
    const n = Math.floor(rnd() * 2 ** 52) + Math.floor(rnd() * 1024);
    const x = isqrt(n);
    if (!(x * x <= n && (x + 1) * (x + 1) > n)) bad++;
  }
  for (const n of [0, 1, 2, 3, 4, 15, 16, 17, 2 ** 32, 2 ** 32 - 1, 2 ** 52, (2 ** 26 - 1) ** 2, (2 ** 26 - 1) ** 2 - 1]) {
    const x = isqrt(n);
    if (!(x * x <= n && (x + 1) * (x + 1) > n)) bad++;
  }
  t.eq(bad, 0, 'isqrt exact (floor) on 100k random n < 2^52 + edge values');
  const R2 = [0, 0];
  let rotErr = 0;
  for (let k = 0; k < 5000; k++) {
    const x = Math.floor((rnd() - 0.5) * 2e6);
    const z = Math.floor((rnd() - 0.5) * 2e6);
    const y = Math.floor(rnd() * 65536);
    rot(x, z, y, R2);
    rotErr = Math.max(rotErr, Math.abs(Math.hypot(R2[0], R2[1]) - Math.hypot(x, z)));
  }
  rot(0, 1000, 16384, R2);
  t.ok(rotErr <= 200 && R2[0] === 1000 && R2[1] === 0, `rot keeps the length (max err ${rotErr.toFixed(1)} U on 10 m vectors) and turns +Z toward +X`);
  t.ok(divRound(5, 2) === 3 && divRound(-5, 2) === -3 && mulQ(-1, Q / 2) === -1 && mulQ(1, Q / 2) === 1, 'divRound / mulQ round half away from zero (symmetric)');
  // no libm trig anywhere in core/sim
  const dir = ROOT + 'runtime/src/core/sim/';
  const offenders: string[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.ts')) continue;
    const src = readFileSync(dir + f, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    if (/Math\.(sin|cos|tan|atan2?|asin|acos|sqrt|hypot|cbrt|exp|log|pow|random)\s*\(/.test(src)) offenders.push(f);
  }
  t.ok(offenders.length === 0, `no Math.sin / cos / atan2 / sqrt / hypot / random in core/sim code (${offenders.join(', ') || 'none'})`);
}

// ================================================================= test data (fixtures + variants + stages)
const STAGES = {
  version: 1,
  stages: [
    { id: 'circ', status: 'built', ring: { shape: 'circle', radiusM: 5.5, sides: 16, rotDeg: 0 }, spawnAxisDeg: 90, cameraSideDeg: 0 },
    { id: 'rot45', status: 'built', ring: { shape: 'circle', radiusM: 5.2, sides: 16, rotDeg: 0 }, spawnAxisDeg: 45, cameraSideDeg: 315 },
    { id: 'swap', status: 'built', spawnAxisDeg: 90, cameraSideDeg: 180 },
    { id: 'oct', status: 'built', ring: { shape: 'poly', radiusM: 5.0, sides: 8, rotDeg: 22.5 }, spawnAxisDeg: 90, cameraSideDeg: 0 },
  ],
};
type AnyRec = Record<string, unknown>;
function variant(mod: (a: AnyRec, b: AnyRec) => void): GameData {
  const a = RAW('_harness/fixtures/kit_a.json') as AnyRec;
  const b = RAW('_harness/fixtures/kit_b.json') as AnyRec;
  mod(a, b);
  return buildGameData({
    system: RAW('data/system.json'),
    fighters: { kit_a: a, kit_b: b },
    clips: { kit_a: RAW('_harness/fixtures/kit_a.clips.json'), kit_b: RAW('_harness/fixtures/kit_b.clips.json') },
    stages: STAGES,
  });
}
const mv = (k: AnyRec, id: string): AnyRec => (k.moves as Record<string, AnyRec>)[id];
const D0 = variant(() => {});
const DLIN = variant((a) => { mv(a, '5H').linear = true; });
const DHOM = variant((a) => { mv(a, '5H').homing = true; });
const DTRK = variant((a) => { mv(a, '5H').track = { until: 6, rate: 3 }; });
const DAIM = variant((a) => { (mv(a, 'brickbat_m').projectile as AnyRec).aimed = true; });

const pos = (m: Match, i: number): [number, number] => [m.s[sb(i) + F.x] / U, m.s[sb(i) + F.z] / U];
const dist = (m: Match): number => {
  const a = pos(m, 0);
  const b = pos(m, 1);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
};
const yaw = (m: Match, i: number): number => m.s[sb(i) + F.yaw];
const camN = (m: Match): [number, number] => [m.s[W.camNX] / Q, m.s[W.camNZ] / Q];
const count = (m: Match, from: number, type: number, a = -1): number => evs(m, from).filter((e) => e.type === type && (a < 0 || e.a === a)).length;
const st = (m: Match, i: number): number => m.s[sb(i) + F.st];

// ================================================================= 1. spawn axis, camera side, P1 screen-left
{
  const m = newMatch({ data: D0, stage: 'circ' });
  const a = pos(m, 0);
  const b = pos(m, 1);
  t.ok(Math.abs(a[0] + 1.2) < 1e-4 && Math.abs(b[0] - 1.2) < 1e-4 && a[1] === 0 && b[1] === 0, `default layout: P1 (${a}) P2 (${b}) on x at +-1.2 m`);
  t.ok(yaw(m, 0) === 16384 && yaw(m, 1) === 49152 && camN(m)[0] === 0 && camN(m)[1] === 1, 'yaws 90 / 270 deg, camN = +Z');
  t.ok(m.s[sb(0) + F.facing] === 1 && m.s[sb(1) + F.facing] === -1, 'facing (screen side) +1 / -1');
  const ms = readMatch(m);
  t.ok(ms.ring?.shape === 'circle' && Math.abs((ms.ring?.radius ?? 0) - 5.5) < 1e-9 && Math.abs(Math.hypot(ms.camN![0], ms.camN![1]) - 1) < 1e-4, 'MatchSnap.ring + unit camN');
}
{
  const m = newMatch({ data: D0, stage: 'rot45' });
  const a = pos(m, 0);
  const b = pos(m, 1);
  const n = camN(m);
  const R: [number, number] = [n[1], -n[0]];
  const onAxis = Math.abs(a[0] - -1.2 * Math.SQRT1_2) < 1e-3 && Math.abs(a[1] - -1.2 * Math.SQRT1_2) < 1e-3;
  t.ok(onAxis && Math.abs(n[0] + Math.SQRT1_2) < 1e-3 && Math.abs(n[1] - Math.SQRT1_2) < 1e-3, `spawnAxisDeg 45 / cameraSideDeg 315: P1 (${a.map((v) => v.toFixed(3))}) camN (${n.map((v) => v.toFixed(3))})`);
  t.ok((b[0] - a[0]) * R[0] + (b[1] - a[1]) * R[1] > 0, 'P1 is screen-left');
  const x0 = dist(m);
  run(m, 20, dirBits(m, 0, 6), 0);
  t.ok(dist(m) < x0 - 0.3, `RIGHT (= forward for the screen-left P1) walks toward P2 on the rotated axis (${x0.toFixed(2)} -> ${dist(m).toFixed(2)} m)`);
}
{
  const m = newMatch({ data: D0, stage: 'swap' });
  const a = pos(m, 0);
  const n = camN(m);
  t.ok(a[0] > 1.1 && n[1] === -1 && m.s[sb(0) + F.facing] === 1, `cameraSideDeg 180 swaps the spawn ends so P1 stays screen-left (P1 x ${a[0].toFixed(2)}, camN z ${n[1]}, facing ${m.s[sb(0) + F.facing]})`);
}

// ================================================================= 2. STEP_IN / STEP_OUT, sidestep, auto-face
{
  const m = newMatch({ data: D0, stage: 'circ' });
  const n0 = camN(m);
  const d0 = dist(m);
  const p0 = pos(m, 0);
  step(m, I.STEP_IN, 0);
  t.ok(st(m, 0) === ST.SIDESTEP, 'STEP_IN tap starts SIDESTEP');
  const snap = readFighter(m, 0);
  const clip = m.tab.anims[0][snap.animId]?.clip;
  let frames = 1;
  let maxFaceErr = 0;
  while (st(m, 0) === ST.SIDESTEP && frames < 40) {
    // P2 idles and auto-faces P1 every frame (toward P1's START-of-frame position: slot order never matters)
    const px = m.s[sb(0) + F.x];
    const pz = m.s[sb(0) + F.z];
    step(m, 0, 0);
    frames++;
    const want = dirToYaw(px - m.s[sb(1) + F.x], pz - m.s[sb(1) + F.z]);
    maxFaceErr = Math.max(maxFaceErr, Math.abs(yawDelta(yaw(m, 1), want)));
  }
  const p1 = pos(m, 0);
  const moved: [number, number] = [p1[0] - p0[0], p1[1] - p0[1]];
  const c = pos(m, 1);
  const a0 = Math.atan2(p0[1] - c[1], p0[0] - c[0]);
  const a1 = Math.atan2(p1[1] - c[1], p1[0] - c[0]);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  const arc = Math.abs(da) * d0;
  t.ok(moved[0] * n0[0] + moved[1] * n0[1] < -0.5, `STEP_IN moves away from the camera (-camN): dz ${moved[1].toFixed(3)} m`);
  t.eq(frames - 1, 15, 'SIDESTEP lasts 15 frames (actionable on frame 16)');
  t.near(dist(m), d0, 0.01, 'sidestep keeps the distance to the opponent (arc, not a straight line)');
  t.near(arc, 0.85, 0.02, `sidestep arc ${arc.toFixed(3)} m`);
  t.ok(maxFaceErr <= 1, `the idle opponent auto-faces the stepper every frame (max err ${maxFaceErr} yaw units)`);
  t.ok(clip === 'sidestep_l', `P1 STEP_IN = its own left -> anim clip "${clip}" (sidestep_l)`);
  t.ok(readFighter(m, 0).stateName === 'idle', 'tap only: back to idle after the sidestep');
}
{
  const m = newMatch({ data: D0, stage: 'circ' });
  step(m, I.STEP_OUT, 0);
  const clip = m.tab.anims[0][readFighter(m, 0).animId]?.clip;
  run(m, 20, 0, 0);
  t.ok(pos(m, 0)[1] > 0.5 && clip === 'sidestep_r', `STEP_OUT moves toward the camera (+camN): z ${pos(m, 0)[1].toFixed(3)} m, clip ${clip}`);
  const m2 = newMatch({ data: D0, stage: 'circ' });
  run(m2, 10, I.STEP_IN | I.STEP_OUT, 0);
  t.ok(st(m2, 0) !== ST.SIDESTEP && pos(m2, 0)[1] === 0, 'STEP_IN + STEP_OUT together = neutral (SOCD)');
}
{
  // step-attack: tap, L pressed on step frame 9 -> the attack starts on step frame 11
  const m = newMatch({ data: D0, stage: 'circ' });
  step(m, I.STEP_IN, 0);
  let startF = -1;
  for (let k = 2; k <= 16; k++) {
    step(m, k === 9 ? I.L : 0, 0);
    if (startF < 0 && st(m, 0) === ST.ATTACK) startF = k;
  }
  t.eq(startF, 11, 'a button buffered on step frame 9 comes out on step frame 11 (step-attack)');
  // block from step frame 12 (canBlock accepts SIDESTEP from step.blockF)
  const m2 = newMatch({ data: D0, stage: 'circ' });
  step(m2, 0, I.STEP_IN); // step frame 1
  const atk = m2.cf[0].moves[m2.cf[0].gTable[5 * 3 + 2]];
  for (let k = 2; k <= 10; k++) step(m2, 0, 0);
  step(m2, 0, dirBits(m2, 1, 4)); // step frame 11, back held
  const at11 = st(m2, 1) === ST.SIDESTEP && canBlock(m2, 1, atk, m2.s[sb(0) + F.x], m2.s[sb(0) + F.z]);
  step(m2, 0, dirBits(m2, 1, 4)); // step frame 12
  const at12 = st(m2, 1) === ST.SIDESTEP && canBlock(m2, 1, atk, m2.s[sb(0) + F.x], m2.s[sb(0) + F.z]);
  t.ok(!at11 && at12, `sidestep can block from step frame 12 (frame 11 ${at11}, frame 12 ${at12})`);
}
{
  // SIDEWALK: distance within +-2 cm over 2 s, ~1.8 m/s tangential, settle 4 f, back cancels into block
  const m = newMatch({ data: D0, stage: 'circ' });
  const d0 = dist(m);
  let dmax = 0;
  let prev = pos(m, 0);
  let path = 0;
  let walkClip = '';
  for (let k = 0; k < 135; k++) {
    step(m, I.STEP_OUT, 0);
    const p = pos(m, 0);
    if (k >= 15) path += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
    dmax = Math.max(dmax, Math.abs(dist(m) - d0));
    if (k === 60) walkClip = m.tab.anims[0][readFighter(m, 0).animId]?.clip ?? '';
  }
  t.ok(st(m, 0) === ST.SIDEWALK, 'held STEP past the sidestep = SIDEWALK');
  t.ok(dmax <= 0.02, `sidewalk keeps the distance within 2 cm over 2.25 s (max dev ${(dmax * 100).toFixed(2)} cm)`);
  const speed = (path / 120) * 60;
  t.near(speed, 1.8, 0.03, `sidewalk tangential speed ${speed.toFixed(3)} m/s`);
  t.ok(walkClip === 'sidewalk_r', `P1 circling toward the camera = its own right -> ${walkClip}`);
  let settle = 0;
  step(m, 0, 0);
  while (st(m, 0) === ST.STEP_END && settle < 20) {
    settle++;
    step(m, 0, 0);
  }
  t.eq(settle, 4, 'release = a 4-frame settle (STEP_END), then free');
  const m2 = newMatch({ data: D0, stage: 'circ' });
  run(m2, 40, I.STEP_IN, 0);
  step(m2, I.STEP_IN | dirBits(m2, 0, 4), 0);
  const s2 = st(m2, 0);
  t.ok(s2 === ST.WALK_B || s2 === ST.IDLE, `holding BACK cancels circling into the block states at once (state ${readFighter(m2, 0).stateName})`);
  const atk = m2.cf[1].moves[m2.cf[1].gTable[5 * 3]];
  t.ok(canBlock(m2, 0, atk, m2.s[sb(1) + F.x], m2.s[sb(1) + F.z]), 'and blocks from that frame');
}
{
  // camN continuity over a full circle: never flips, turns 360 deg, P1 stays screen-left
  const m = newMatch({ data: D0, stage: 'circ' });
  let prev = camN(m);
  let minDot = 1;
  let turned = 0;
  let facingFlips = 0;
  for (let k = 0; k < 560; k++) {
    step(m, I.STEP_IN, 0);
    const n = camN(m);
    minDot = Math.min(minDot, n[0] * prev[0] + n[1] * prev[1]);
    turned += Math.atan2(prev[0] * n[1] - prev[1] * n[0], prev[0] * n[0] + prev[1] * n[1]);
    prev = n;
    if (m.s[sb(0) + F.facing] !== 1) facingFlips++;
  }
  const deg = Math.abs((turned * 180) / Math.PI);
  t.ok(minDot > 0.99 && deg >= 360, `camN continuous while circling (min frame-to-frame dot ${minDot.toFixed(5)}, turned ${deg.toFixed(0)} deg)`);
  t.eq(facingFlips, 0, 'the circling P1 stays screen-left (facing +1) the whole way round');
}

{
  // step-attacks "SS.<btn>" (real data: patch / spin SS.H): routed only out of SIDESTEP / SIDEWALK, winning over 5H there
  try {
    const real = loadGameData();
    const who = Object.keys(real.fighters).filter((id) => Object.keys(real.fighters[id].moves).some((k) => real.fighters[id].moves[k].input === 'SS.H'));
    let ok = who.length > 0;
    const notes: string[] = [];
    for (const id of who) {
      // CHANGED(fix_core) D9 (CONTRACT §35.20): a press on ANY sidestep frame (2 on) is held and comes out on step frame 11
      const tryStep = (pressAt: number): string => {
        const m = newMatch({ data: real, p1: id, p2: 'johnny', stage: 'rust_theater' });
        step(m, I.STEP_IN, 0);
        let name = '';
        for (let k = 2; k <= 13 && !name; k++) {
          step(m, k === pressAt ? I.H : 0, 0);
          if (st(m, 0) === ST.ATTACK) name = `${readFighter(m, 0).moveName}@${k}`;
        }
        return name;
      };
      const at9 = tryStep(9);
      const at5 = tryStep(5);
      const at2 = tryStep(2);
      const mw = newMatch({ data: real, p1: id, p2: 'johnny', stage: 'rust_theater' });
      run(mw, 30, I.STEP_OUT, 0);
      step(mw, I.STEP_OUT | I.H, 0);
      const walkName = readFighter(mw, 0).moveName;
      const mi = newMatch({ data: real, p1: id, p2: 'johnny', stage: 'rust_theater' });
      step(mi, I.H, 0);
      const idleName = readFighter(mi, 0).moveName;
      notes.push(`${id}: step f2 H -> ${at2 || 'none'}, f5 H -> ${at5 || 'none'}, f9 H -> ${at9 || 'none'}, sidewalk H -> ${walkName}, idle H -> ${idleName}`);
      if (!(at2 === 'SS.H@11' && at5 === 'SS.H@11' && at9 === 'SS.H@11' && walkName === 'SS.H' && idleName === '5H')) ok = false;
    }
    t.ok(ok, `step-attacks: SS.H out of a sidestep (pressed on step frame 2 / 5 / 9 -> out on frame 11) and a sidewalk; idle H stays 5H (${notes.join('; ')})`);
  } catch (e) {
    t.ok(false, `step-attack case crashed: ${String((e as Error).message).split(String.fromCharCode(10))[0]}`);
  }
}

// ================================================================= 3. evasion + tracking
function stepVs5H(data: GameData): { hit: number; whiff: number } {
  const m = newMatch({ data, stage: 'circ' });
  place(m, -0.65, 0.65);
  run(m, 2, 0, 0);
  const from = m.frame();
  step(m, I.H, I.STEP_IN);
  run(m, 30, 0, 0);
  return { hit: count(m, from, EV.HIT, 0) + count(m, from, EV.BLOCK, 0), whiff: count(m, from, EV.WHIFF, 0) };
}
{
  const lin = stepVs5H(DLIN);
  const hom = stepVs5H(DHOM);
  const m = newMatch({ data: DLIN, stage: 'circ' });
  place(m, -0.65, 0.65);
  run(m, 2, 0, 0);
  const from = m.frame();
  step(m, I.H, 0);
  run(m, 30, 0, 0);
  const ctrl = count(m, from, EV.HIT, 0);
  t.ok(ctrl === 1, 'control: the linear 5H hits a standing opponent');
  t.ok(lin.hit === 0 && lin.whiff === 1, `a sidestep on the same frame evades the LINEAR 5H (hits ${lin.hit}, whiff ${lin.whiff})`);
  t.ok(hom.hit === 1, `but not the HOMING 5H (hits ${hom.hit})`);
}
{
  // tracking as authored: 5H track {until 6, rate 3 deg}
  const m = newMatch({ data: DTRK, stage: 'circ' });
  place(m, -0.65, 0.65);
  run(m, 2, 0, 0);
  step(m, I.H, I.STEP_IN);
  const rate = degToYaw(3);
  let prevY = yaw(m, 0);
  let maxEarly = 0;
  let late = 0;
  let turnedEarly = 0;
  for (let f = 2; f <= 14; f++) {
    step(m, 0, 0);
    const y = yaw(m, 0);
    const dY = Math.abs(yawDelta(prevY, y));
    if (f <= 6) {
      maxEarly = Math.max(maxEarly, dY);
      turnedEarly += dY;
    } else late += dY;
    prevY = y;
  }
  t.ok(maxEarly <= rate && turnedEarly > 0, `tracking frames 2..6 turn <= 3 deg / frame (max ${(maxEarly * 360 / 65536).toFixed(2)} deg, total ${(turnedEarly * 360 / 65536).toFixed(2)} deg)`);
  t.eq(late, 0, 'no tracking after track.until (frames 7..14 keep the yaw)');
  const cm = m.cf[0].moves[m.cf[0].gTable[5 * 3 + 2]];
  const d = m.cf[0].moves.find((x) => x.id === '5M')!;
  // CHANGED(STEPTUNE) (CONTRACT §35.15): the default normal lead is 6 (was 4); throws keep until 1 (startup 5)
  const thr = m.cf[0].moves[m.cf[0].throwF];
  t.ok(cm.trackUntil === 6 && cm.trackRate === rate && d.trackUntil === Math.max(1, d.startup - 6) && thr.trackUntil === Math.max(1, thr.startup - 6),
    `compiled: 5H until 6 rate ${cm.trackRate}; default normal 5M until startup - 6 = ${d.trackUntil} (startup ${d.startup}); throw until ${thr.trackUntil}`);
  const sp = m.cf[0].moves.find((x) => x.id === 'hook_m')!;
  const hm = DHOM.fighters.kit_a.moves['5H'];
  t.ok(sp.trackUntil === Math.max(1, sp.startup - 6), `default special until startup - 6 = ${sp.trackUntil}`);
  const hmc = newMatch({ data: DHOM }).cf[0].moves.find((x) => x.id === '5H')!;
  t.ok(hmc.homing && hmc.trackUntil === hmc.lastActive && Math.abs(hmc.lateral - 0.6 * U) < 2 && hm.homing === true, `homing tracks through the active frames (until ${hmc.trackUntil}) with lateral 0.60 m`);
  const lm = newMatch({ data: DLIN }).cf[0].moves.find((x) => x.id === '5H')!;
  t.ok(lm.linear && lm.trackUntil === 1 && Math.abs(lm.lateral - 0.22 * U) < 2, 'linear tracks frame 1 only; H lateral default 0.22 m');
}
{
  // lateral depth: box vs circle in the attacker's frame (lateral 0.18, hurt r 0.3): just inside hits, just outside misses
  const inside = boxCyl(0, 0, sinQ(16384), cosQ(16384), 100000, 20000, 18000, 100000, 130000, 100000, 47999, 30000, 0, 180000);
  const outside = boxCyl(0, 0, sinQ(16384), cosQ(16384), 100000, 20000, 18000, 100000, 130000, 100000, 48001, 30000, 0, 180000);
  t.ok(inside && !outside, 'hit box lateral half-depth + hurt radius: 0.47999 m off the line hits, 0.48001 m misses');
}

// ================================================================= 3b. STEPPABLE TABLE (CHANGED(STEPTUNE), CONTRACT §35.15)
// The designer's step tuning: (1) a FRONT-LOADED sidestep (60-65 % of the 0.85 m arc in the first 6 frames, ease-out to
// frame 15); (2) normals / command normals track to startup - 6 like the specials. Goal: a READ step (started a few frames
// before the attack's active frames) evades straight normals, linear moves and straight projectiles, never a HOMING move,
// and a late step (reaction) is still hit. Measured here in the real sim with the real kits: the attacker's move is started
// by a clean buffer poke on frame 0 (its mvF 1), the defender (johnny, idle, no guard) taps STEP_IN on frame `off`
// (negative = before the attack starts); evaded = no HIT / BLOCK / PROJ_HIT / THROW from the attacker for the whole move.
{
  // --- the step curve itself
  const sys0 = newMatch({ data: D0 }).sys;
  const cv = Array.from(sys0.stepCurve);
  const D = cv[cv.length - 1];
  let easing = true;
  for (let f = 1; f < cv.length; f++) {
    const d = cv[f] - cv[f - 1];
    if (d <= 0 || (f > 1 && d > cv[f - 1] - cv[f - 2])) easing = false;
  }
  const pct6 = (cv[6] / D) * 100;
  t.ok(cv.length === 16 && D === 85000, `sidestep curve: 15 frames, ${(D / U).toFixed(3)} m in total`);
  t.ok(pct6 >= 60 && pct6 <= 65, `front-loaded: ${pct6.toFixed(1)} % of the arc in the first 6 frames (designer target 60-65 %)`);
  t.ok(easing, `ease-out: it moves on every frame 1..15 and never speeds up (per-frame cm ${cv.slice(1).map((v, k) => ((v - cv[k]) / 1000).toFixed(1)).join(' ')})`);

  // --- steppable windows (real data)
  let real: GameData | null = null;
  try {
    real = loadGameData();
  } catch (e) {
    t.ok(false, `steppable table: real data/ not loadable: ${String((e as Error).message).split('\n')[0]}`);
  }
  if (real) {
    const R = real;
    const DEF = 'johnny';
    const trial = (att: string, mid: string, dM: number, off: number | null, bit: number): { hits: number; started: boolean } => {
      const m = newMatch({ data: R, p1: att, p2: DEF, stage: 'rust_theater' });
      place(m, -dM / 2, dM / 2);
      run(m, 2, 0, 0);
      const idx = m.cf[0].moves.findIndex((x) => x.id === mid);
      if (idx < 0) return { hits: -1, started: false };
      const mvc = m.cf[0].moves[idx];
      const b0 = sb(0);
      m.s[b0 + F.showtime] = 30000; // meter for EX / supers / IMPACT (the table is about geometry)
      m.s[b0 + F.nerve] = 60000;
      const from = m.frame();
      let started = false;
      for (let k = off === null ? 0 : Math.min(0, off); k <= mvc.total + 40; k++) {
        if (k === 0) {
          m.s[b0 + F.bufA] = ACT.MOVE;
          m.s[b0 + F.bufM] = idx;
          m.s[b0 + F.bufAge] = 0;
          m.s[b0 + F.bufWin] = 8;
          m.s[b0 + F.bufF] = 0;
        }
        step(m, 0, off !== null && k === off ? bit : 0);
        if (k === 0) started = m.s[b0 + F.st] === ST.ATTACK && m.s[b0 + F.mv] === idx && m.s[b0 + F.mvF] === 1;
      }
      const hits = evs(m, from).filter((e) => e.a === 0 && (e.type === EV.HIT || e.type === EV.BLOCK || e.type === EV.PROJ_HIT || e.type === EV.THROW)).length;
      return { hits, started };
    };
    interface Win { reach: boolean; started: boolean; offs: number[]; startup: number; until: number; label: string }
    const windowOf = (att: string, mid: string, dM: number, bit: number = I.STEP_IN): Win => {
      const mvc = newMatch({ data: R, p1: att, p2: DEF }).cf[0].moves.find((x) => x.id === mid);
      const w: Win = { reach: false, started: false, offs: [], startup: mvc?.startup ?? 0, until: mvc?.trackUntil ?? 0, label: `${att} ${mid}` };
      if (!mvc) return w;
      const ctrl = trial(att, mid, dM, null, 0);
      w.started = ctrl.started;
      w.reach = ctrl.started && ctrl.hits > 0;
      if (!w.reach) return w;
      for (let o = -26; o <= mvc.startup + 1; o++) if (trial(att, mid, dM, o, bit).hits === 0) w.offs.push(o);
      return w;
    };
    /** latest evading start, in frames before the first active frame (frame startup - 1 of the attack) */
    const latest = (w: Win): number => w.startup - 1 - w.offs[w.offs.length - 1];
    const fmt = (w: Win): string => {
      if (!w.started) return 'NOT STARTED';
      if (!w.reach) return 'out of reach';
      if (w.offs.length === 0) return 'never';
      const rs: string[] = [];
      for (let q = 0; q < w.offs.length; ) {
        let e = q;
        while (e + 1 < w.offs.length && w.offs[e + 1] === w.offs[e] + 1) e++;
        rs.push(q === e ? `${w.offs[q]}` : `${w.offs[q]}..${w.offs[e]}`);
        q = e + 1;
      }
      return `${rs.join(',')} (${w.offs.length} f; ${w.startup - 1 - w.offs[0]}..${latest(w)} f before active)`;
    };
    // class -> candidate moves (the first that reaches at a distance is measured there)
    const ROWS: { cls: string; c: [string, string][]; kind: 'read' | 'never' | 'info' }[] = [
      { cls: '5L straight', c: [['krane', '5L']], kind: 'read' },
      { cls: '5M straight', c: [['krane', '5M']], kind: 'read' },
      { cls: '5H straight', c: [['zambini', '5H'], ['freak', '5H']], kind: 'read' },
      { cls: '6H overhead', c: [['krane', '6H']], kind: 'read' },
      { cls: 'homing 5H', c: [['krane', '5H'], ['bruno', 'lariat_h']], kind: 'never' },
      { cls: 'sweep (homing)', c: [['johnny', '3H'], ['ricky', '3H']], kind: 'never' },
      { cls: 'sweep (linear)', c: [['gazza', '2H']], kind: 'read' },
      { cls: 'linear special', c: [['johnny', 'hook_m']], kind: 'read' },
      { cls: 'projectile straight', c: [['johnny', 'brickbat_m']], kind: 'read' },
      { cls: 'projectile aimed', c: [['zambini', 'card_fan_m']], kind: 'info' },
      { cls: 'IMPACT (system)', c: [['johnny', '__impact']], kind: 'info' },
    ];
    const table: string[] = [];
    const byCls: Record<string, Record<string, Win>> = {};
    for (const row of ROWS) {
      const cells: string[] = [];
      byCls[row.cls] = {};
      for (const dM of [1.2, 2.0]) {
        let w: Win | null = null;
        for (const [att, mid] of row.c) {
          w = windowOf(att, mid, dM);
          if (w.reach) break;
        }
        byCls[row.cls][dM.toFixed(1)] = w!;
        cells.push(`${dM.toFixed(1)} m ${w!.label} s${w!.startup} until ${w!.until}: ${fmt(w!)}`);
      }
      table.push(`${row.cls.padEnd(20)} | ${cells.join(' | ')}`);
    }
    // symmetry: STEP_OUT gives the same window as STEP_IN (5M / 5H / linear special at 1.2 m)
    const symm = [['krane', '5M'], ['zambini', '5H'], ['johnny', 'hook_m']].every(([a, mm]) => fmt(windowOf(a, mm, 1.2, I.STEP_OUT)) === fmt(windowOf(a, mm, 1.2)));
    console.log('  STEPPABLE TABLE (step start frame relative to the attack\'s frame 1; defender johnny, STEP_IN; "f before active" = frames');
    console.log('  from the step start to the first active frame):');
    for (const l of table) console.log(`    ${l}`);
    const W12 = (c: string): Win => byCls[c]['1.2'];
    const W20 = (c: string): Win => byCls[c]['2.0'];
    const readOk = (w: Win): boolean => w.reach && w.offs.length > 0 && latest(w) >= 3;
    for (const c of ['5L straight', '5M straight', '5H straight', '6H overhead']) {
      t.ok(readOk(W12(c)), `${c} at 1.2 m: a READ step evades it and a late one (< 3 f before active) is hit -> ${fmt(W12(c))}`);
    }
    t.ok(readOk(W20('5H straight')), `5H straight at 2.0 m (the one that reaches: ${W20('5H straight').label}) -> ${fmt(W20('5H straight'))}`);
    for (const c of ['homing 5H', 'sweep (homing)']) {
      const ok = [W12(c), W20(c)].every((w) => w.reach && w.offs.length === 0);
      t.ok(ok, `${c}: never evaded (1.2 m ${W12(c).label} ${fmt(W12(c))}; 2.0 m ${W20(c).label} ${fmt(W20(c))})`);
    }
    for (const c of ['linear special', 'projectile straight']) {
      t.ok(W12(c).offs.length > 0 && W20(c).offs.length > 0, `${c}: steppable at 1.2 m (${fmt(W12(c))}) and 2.0 m (${fmt(W20(c))})`);
    }
    t.ok(W12('sweep (linear)').offs.length > 0, `sweep (linear) at 1.2 m: steppable (${fmt(W12('sweep (linear)'))})`);
    t.ok(W12('projectile aimed').reach && W12('projectile aimed').offs.length === 0, `aimed projectile at 1.2 m: never (aimed at the spawn frame; 2.0 m ${fmt(W20('projectile aimed'))})`);
    t.ok(symm, 'STEP_OUT evades exactly like STEP_IN (5M / 5H / linear special windows identical)');

    // --- the whole roster at 1.2 m: every ground strike / projectile move of the 12 kits
    interface Agg { n: number; ev: number; oor: number; sizes: number[]; minLatest: number; fastMiss: string[] }
    const agg: Record<string, Agg> = {};
    for (const id of Object.keys(R.fighters).sort()) {
      const cf = newMatch({ data: R, p1: id, p2: DEF }).cf[0];
      for (const mvc of cf.moves) {
        const o = R.fighters[id].moves[mvc.id];
        if (!o || mvc.inAir || mvc.stepAtk || mvc.chainOnly || o.kind === 'system') continue;
        if (!(mvc.isStrike || o.projectile)) continue;
        const cls = o.projectile ? (o.projectile.aimed ? 'projectile aimed' : 'projectile straight') : mvc.homing ? 'homing' : mvc.linear ? 'linear' : o.kind === 'normal' || o.kind === 'command' ? 'normal (default track)' : 'special (default track)';
        const a = (agg[cls] ??= { n: 0, ev: 0, oor: 0, sizes: [], minLatest: 99, fastMiss: [] });
        const w = windowOf(id, mvc.id, 1.2);
        if (!w.reach) {
          a.oor++;
          continue;
        }
        a.n++;
        if (w.offs.length > 0) {
          a.ev++;
          a.sizes.push(w.offs.length);
          a.minLatest = Math.min(a.minLatest, latest(w));
        } else if (cls !== 'homing' && cls !== 'projectile aimed') a.fastMiss.push(`${id} ${mvc.id} s${mvc.startup}`);
      }
    }
    const aggLines = Object.entries(agg).map(([c, a]) => {
      a.sizes.sort((x, y) => x - y);
      const med = a.sizes.length ? a.sizes[Math.floor(a.sizes.length / 2)] : 0;
      return `${c}: ${a.ev}/${a.n} steppable (median window ${med} f, latest start ${a.minLatest === 99 ? '-' : a.minLatest} f before active; ${a.oor} out of reach)${a.fastMiss.length ? ' never: ' + a.fastMiss.join(', ') : ''}`;
    });
    console.log('  roster at 1.2 m (12 kits, ground strikes + projectiles):');
    for (const l of aggLines) console.log(`    ${l}`);
    const h = agg['homing'];
    t.ok(!!h && h.n >= 40 && h.ev === 0, `roster: 0 of ${h?.n} reachable HOMING moves is ever evaded by a sidestep`);
    const pa = agg['projectile aimed'];
    t.ok(!pa || pa.ev === 0, `roster: 0 of ${pa?.n ?? 0} aimed projectiles is evaded at 1.2 m`);
    // every non-homing strike / straight projectile that is not a 4-6 frame move is steppable on a read, and none is steppable
    // once the step starts within 2 frames of the first active frame (the late / reaction step)
    const slowMiss = ['normal (default track)', 'special (default track)', 'linear', 'projectile straight'].flatMap((c) => (agg[c]?.fastMiss ?? []).filter((s) => Number(/ s(\d+)$/.exec(s)![1]) >= 7));
    t.ok(slowMiss.length === 0, `roster: every non-homing move with startup >= 7 is steppable on a read (exceptions: ${slowMiss.join(', ') || 'none'})`);
    // (default-tracking SPECIALS are report-only here: the EX rushes - hook_ex, shield_rush_ex, claw_rush_ex - carry past a
    // stepper like the linear L / M / H versions, so a step 2 f before their first active frame still whiffs them)
    const minLate = agg['normal (default track)']?.minLatest ?? 99;
    t.ok(minLate >= 3, `roster: a default-tracking normal is never evaded by a step started < 3 f before its active frames (min ${minLate})`);
    // --- the DEFENDER's body decides too: the hurt cylinder radius = (front + back) / 2 of the measured body (boxes.ts
    // hurtCyls), so long / lurching bodies are wide across the attack line and need more lateral travel.
    // CHANGED(fix_core) D1 (CONTRACT §35.20): each fighter steps its OWN arc (fighters/<id>.json step.distM, kitlib
    // step_dist_m from the measured body) - GATED here: at 1.2 m EVERY body evades a straight 5M (krane, s8) and a straight
    // 5H (zambini, s12) on a read from >= 2 consecutive start frames (all straight 5M / 5H of the roster give the same
    // window per defender: scratch d1_sweep2, progress_fix_core.md), small bodies keep larger windows than big ones (the
    // heavyweights step worse, never "never"), homing is never evaded (the krane 5H vs all 12; every reachable homing ground
    // strike of the roster vs the two LONGEST steps, rerun / freak).
    const defLines: string[] = [];
    let homingAny = 0;
    const evadeOffs = (att: string, mid: string, def: string, dM = 1.2, bit: number = I.STEP_IN, lo = -26, hi = 20): number[] | null => {
      const tr = (off: number | null): number => {
        const m = newMatch({ data: R, p1: att, p2: def, stage: 'rust_theater' });
        place(m, -dM / 2, dM / 2);
        run(m, 2, 0, 0);
        const idx = m.cf[0].moves.findIndex((x) => x.id === mid);
        const total = m.cf[0].moves[idx].total;
        const b0 = sb(0);
        m.s[b0 + F.showtime] = 30000;
        m.s[b0 + F.nerve] = 60000;
        const from = m.frame();
        for (let k = off === null ? 0 : Math.min(0, off); k <= total + 40; k++) {
          if (k === 0) {
            m.s[b0 + F.bufA] = ACT.MOVE;
            m.s[b0 + F.bufM] = idx;
            m.s[b0 + F.bufAge] = 0;
            m.s[b0 + F.bufWin] = 8;
            m.s[b0 + F.bufF] = 0;
          }
          step(m, 0, off !== null && k === off ? bit : 0);
        }
        return evs(m, from).filter((e) => e.a === 0 && (e.type === EV.HIT || e.type === EV.BLOCK || e.type === EV.PROJ_HIT)).length;
      };
      if (tr(null) === 0) return null;
      const ev: number[] = [];
      for (let o = lo; o <= hi; o++) if (tr(o) === 0) ev.push(o);
      return ev;
    };
    const runOf = (ev: number[] | null): number => {
      if (!ev) return -1;
      let best = 0;
      let cur = 0;
      for (let q = 0; q < ev.length; q++) {
        cur = q > 0 && ev[q] === ev[q - 1] + 1 ? cur + 1 : 1;
        best = Math.max(best, cur);
      }
      return best;
    };
    const fmtW = (ev: number[] | null): string => (!ev ? 'out of reach' : ev.length ? `${ev[0]}..${ev[ev.length - 1]} (${ev.length} f)` : 'never');
    const winVs = (att: string, mid: string, def: string, dM = 1.2): string => fmtW(evadeOffs(att, mid, def, dM));
    interface DefRow { def: string; r: number; dist: number; w5M: number; w5H: number }
    const rows: DefRow[] = [];
    for (const def of Object.keys(R.fighters).sort()) {
      const cf = newMatch({ data: R, p1: def, p2: def }).cf[0];
      const r = (cf.hurtFS + cf.hurtBS) / 2 / U;
      const hm = winVs('krane', '5H', def);
      if (hm !== 'never') homingAny++;
      const e5M = evadeOffs('krane', '5M', def);
      const e5H = evadeOffs('zambini', '5H', def);
      rows.push({ def, r, dist: cf.stepDist / U, w5M: runOf(e5M), w5H: runOf(e5H) });
      // equal gap: the defender's hurt FRONT 0.84 m from the attacker's root (= johnny at 1.2 m), so big bodies are not
      // simply measured at point-blank range
      const dg = Math.round((0.84 + cf.hurtFS / U) * 100) / 100;
      defLines.push(`${def} (hurt r ${r.toFixed(2)} m, front ${(cf.hurtFS / U).toFixed(2)} m, step ${(cf.stepDist / U).toFixed(3)} m): 1.2 m: krane 5L ${winVs('krane', '5L', def)}, krane 5M ${fmtW(e5M)}, zambini 5H ${fmtW(e5H)}, johnny hook_m ${winVs('johnny', 'hook_m', def)}, homing krane 5H ${hm} | equal gap (${dg.toFixed(2)} m): 5L ${winVs('krane', '5L', def, dg)}, 5M ${winVs('krane', '5M', def, dg)}, 5H ${winVs('zambini', '5H', def, dg)}`);
    }
    console.log('  by DEFENDER (STEP_IN; each body steps its own step.distM arc; the body decides the lateral clearance: hurt cylinder');
    console.log('  radius + how far its front reaches toward the attacker, i.e. toward the pivot of the circling step):');
    for (const l of defLines) console.log(`    ${l}`);
    t.ok(homingAny === 0, `the homing krane 5H is never evaded by any of the 12 defender bodies (${homingAny} evaded)`);
    const sum = (q: DefRow): string => `${q.def} ${q.w5M}/${q.w5H}`;
    const low = rows.filter((q) => q.w5M < 2 || q.w5H < 2);
    t.ok(rows.length === 12 && low.length === 0, `every body evades a straight 5M AND a straight 5H at 1.2 m on a read from >= 2 consecutive start frames (5M/5H frames: ${rows.map(sum).join(', ')})${low.length ? ' - TOO FEW: ' + low.map(sum).join(', ') : ''}`);
    const small = rows.filter((q) => q.r <= 0.27);
    const big = rows.filter((q) => q.r >= 0.37);
    const maxBig = (k: 'w5M' | 'w5H'): number => Math.max(...big.map((q) => q[k]));
    const minSmall = (k: 'w5M' | 'w5H'): number => Math.min(...small.map((q) => q[k]));
    const sumOk = small.every((a) => big.every((b) => a.w5M + a.w5H > b.w5M + b.w5H));
    t.ok(small.length === 4 && big.length === 6 && minSmall('w5M') >= maxBig('w5M') && minSmall('w5H') >= maxBig('w5H') && sumOk,
      `small bodies keep larger windows than big ones: small (r <= 0.27: ${small.map(sum).join(', ')}) >= big (r >= 0.37: ${big.map(sum).join(', ')}) per move, and every small body's 5M + 5H > every big body's`);
    t.ok(small.every((q) => Math.abs(q.dist - 0.85) < 1e-9) && big.every((q) => q.dist > 1.0), `the small bodies keep the 0.85 m default step; the big ones step longer (${rows.map((q) => `${q.def} ${q.dist.toFixed(3)}`).join(', ')})`);
    // every fighter's own curve keeps the §35.15 shape: 15 frames, 60-65 % in the first 6, moving and easing every frame
    const shapeBad: string[] = [];
    for (const def of Object.keys(R.fighters).sort()) {
      const cv = Array.from(newMatch({ data: R, p1: def, p2: def }).cf[0].stepCurve);
      const Dd = cv[cv.length - 1];
      let ease = cv.length === 16;
      for (let f = 1; f < cv.length; f++) {
        const d = cv[f] - cv[f - 1];
        if (d <= 0 || (f > 1 && d > cv[f - 1] - cv[f - 2] + 1)) ease = false;
      }
      const p6 = (cv[6] / Dd) * 100;
      if (!ease || p6 < 60 || p6 > 65) shapeBad.push(`${def} ${cv.length - 1} f ${p6.toFixed(1)} %`);
    }
    t.ok(shapeBad.length === 0, `every fighter's step keeps 15 frames and the front-loaded ease-out (60-65 % in 6 frames)${shapeBad.length ? ': ' + shapeBad.join(', ') : ''}`);
    // STEP_OUT = STEP_IN for the long steps too
    const symBig = [['rerun', 'krane', '5M'], ['freak', 'zambini', '5H'], ['krane', 'zambini', '5H']].every(([d, a, mm]) => fmtW(evadeOffs(a, mm, d, 1.2, I.STEP_OUT)) === fmtW(evadeOffs(a, mm, d)));
    t.ok(symBig, 'STEP_OUT evades exactly like STEP_IN for the long steps (rerun vs krane 5M, freak / krane vs zambini 5H)');
    // homing stays unsteppable even for the longest steps: every reachable homing ground strike of the roster
    let homN = 0;
    const homEv: string[] = [];
    for (const def of ['rerun', 'freak']) {
      for (const id of Object.keys(R.fighters).sort()) {
        const cfA = newMatch({ data: R, p1: id, p2: def }).cf[0];
        for (const mvc of cfA.moves) {
          const o = R.fighters[id].moves[mvc.id];
          if (!o || !mvc.homing || !mvc.isStrike || mvc.inAir || mvc.stepAtk || mvc.chainOnly || o.kind === 'system') continue;
          const ev = evadeOffs(id, mvc.id, def, 1.2, I.STEP_IN, -26, mvc.startup + 1);
          if (!ev) continue;
          homN++;
          if (ev.length) homEv.push(`${def} vs ${id} ${mvc.id}: ${fmtW(ev)}`);
        }
      }
    }
    t.ok(homN >= 80 && homEv.length === 0, `homing is never evaded by the two LONGEST steps (rerun / freak) over ${homN} reachable homing ground strikes at 1.2 m${homEv.length ? ': ' + homEv.join('; ') : ''}`);
    t.note(`steppable table: ${table.join(' || ')} || roster: ${aggLines.join(' || ')} || by defender: ${defLines.join(' || ')}`);
  }
}

// ================================================================= 4. ring collision + wall splat (circle + octagon)
{
  const m = newMatch({ data: D0, stage: 'circ' });
  place(m, -3.5, -2.0); // (the separation cap stops a walk-back 6 m from the opponent)
  run(m, 200, dirBits(m, 0, 4), 0);
  const pc = pos(m, 0);
  const r0 = Math.hypot(pc[0], pc[1]);
  t.ok(r0 < 5.5 && r0 > 5.0, `walking back into the circle ring stops inside it (root radius ${r0.toFixed(3)} m, ring 5.5 m)`);
  const m2 = newMatch({ data: D0, stage: 'oct' });
  place3(m2, -2.5, 2.5, -1.2, 1.2);
  run(m2, 300, dirBits(m2, 0, 4), 0);
  const p2 = pos(m2, 0);
  let maxSide = -1;
  for (let k = 0; k < 8; k++) {
    const a = ((22.5 + k * 45) * Math.PI) / 180;
    maxSide = Math.max(maxSide, p2[0] * Math.sin(a) + p2[1] * Math.cos(a));
  }
  t.ok(maxSide <= 5.0 && maxSide > 4.5, `backing into the octagon stops at a side (max side distance ${maxSide.toFixed(3)} m, apothem 5.0 m)`);
}
function impactSplat(stage: string, x0: number, z0: number, x1: number, z1: number): { n: number; b: number; c: number; d: number } {
  const m = newMatch({ data: D0, stage });
  place3(m, x0, z0, x1, z1);
  run(m, 2, 0, 0);
  const from = m.frame();
  for (let k = 0; k < 45; k++) step(m, k === 0 ? I.IMPACT : 0, 0);
  const e = evs(m, from).filter((q) => q.type === EV.WALL_SPLAT);
  return e.length ? { n: e.length, b: e[0].b, c: e[0].c, d: e[0].d } : { n: 0, b: -1, c: 0, d: 0 };
}
{
  // circle: defender near the wall at bearing 90 deg (+X) -> sector 4, inward normal 270 deg
  const c = impactSplat('circ', 4.2, 0, 5.2, 0);
  t.ok(c.n === 1 && (c.b & 255) === 4 && c.b >> 8 === 270 && Math.abs(c.c - 550) <= 1 && Math.abs(c.d) <= 1, `circle: IMPACT against the wall = WALL_SPLAT sector ${c.b & 255} normal ${c.b >> 8} deg at (${c.c}, ${c.d}) cm`);
  // circle at bearing 45 deg
  const q = Math.SQRT1_2;
  const c2 = impactSplat('circ', 4.2 * q, 4.2 * q, 5.2 * q, 5.2 * q);
  t.ok(c2.n === 1 && (c2.b & 255) === 2 && c2.b >> 8 === 225, `circle at 45 deg: sector ${c2.b & 255}, normal ${c2.b >> 8} deg`);
  // octagon (rot 22.5): side 1 faces 67.5 deg; defender on that normal
  const a = (67.5 * Math.PI) / 180;
  const o = impactSplat('oct', 3.65 * Math.sin(a), 3.65 * Math.cos(a), 4.65 * Math.sin(a), 4.65 * Math.cos(a));
  t.ok(o.n === 1 && (o.b & 255) === 1 && o.b >> 8 === 247, `octagon: WALL_SPLAT side ${o.b & 255} normal ${o.b >> 8} deg`);
  // 1.2 m off the wall = no splat
  const far = impactSplat('circ', 3.2, 0, 4.2, 0);
  t.eq(far.n, 0, 'IMPACT 1 m off the ring wall: no splat');
}
{
  // a launched body flying into the boundary = WALL_SPLAT (once per combo)
  const m = newMatch({ data: D0, stage: 'circ' });
  place(m, 3.5, 4.8);
  run(m, 2, 0, 0);
  const b1 = sb(1);
  m.s[b1 + F.st] = ST.JUGGLE;
  m.s[b1 + F.stF] = 0;
  m.s[b1 + F.flags] |= 1;
  m.s[b1 + F.y] = 60000;
  m.s[b1 + F.vx] = 4000;
  m.s[b1 + F.vz] = 0;
  m.s[b1 + F.vy] = 3000;
  m.s[b1 + F.cCount] = 1;
  const from = m.frame();
  run(m, 20, 0, 0);
  t.ok(count(m, from, EV.WALL_SPLAT) === 1 && readFighter(m, 1).stateName !== 'juggle', 'a juggled body reaching the ring = WALL_SPLAT');
}

// ================================================================= 5. projectiles
{
  const shoot = (stepIt: boolean): { hit: number; flew: boolean } => {
    const m = newMatch({ data: D0, stage: 'circ' });
    place(m, -2.2, 2.2);
    run(m, 2, 0, 0);
    const from = m.frame();
    let flew = false;
    let stepped = false;
    for (let k = 0; k < 70; k++) {
      const w1 = k < 3 ? dirBits(m, 0, [2, 3, 6][k]) | (k === 2 ? I.M : 0) : 0;
      let live = false;
      for (let q = 0; q < PROJ_CAP; q++) if (m.s[projBase(q) + P.act] !== 0 && m.s[projBase(q) + P.kind] === 0) live = true;
      if (live) flew = true;
      const w2 = stepIt && live && !stepped ? I.STEP_OUT : 0;
      if (w2) stepped = true;
      step(m, w1, w2);
    }
    return { hit: count(m, from, EV.PROJ_HIT, 0), flew };
  };
  const hit = shoot(false);
  const dodge = shoot(true);
  t.ok(hit.flew && hit.hit === 1, 'control: the straight brick hits a standing opponent');
  t.ok(dodge.flew && dodge.hit === 0, `a sidestep after the release dodges it (PROJ_HIT ${dodge.hit})`);
}
{
  // aimed: launched toward the opponent's position at spawn, not along the thrower's (locked) yaw
  const probe = (data: GameData): number => {
    const m = newMatch({ data, stage: 'circ' });
    place(m, -1.5, 1.5);
    run(m, 2, 0, 0);
    for (let k = 0; k < 3; k++) step(m, dirBits(m, 0, [2, 3, 6][k]) | (k === 2 ? I.M : 0), 0);
    run(m, 8, 0, 0); // the thrower's tracking is over (startup - 6)
    // the opponent drifts sideways before the spawn frame
    for (let k = 0; k < 4; k++) {
      m.s[sb(1) + F.z] += 15000;
      step(m, 0, 0);
    }
    for (let k = 0; k < 10; k++) {
      for (let q = 0; q < PROJ_CAP; q++) {
        const pb = projBase(q);
        if (m.s[pb + P.act] !== 0 && m.s[pb + P.kind] === 0) return Math.abs(yawDelta(m.s[pb + P.yaw], dirToYaw(m.s[sb(1) + F.x] - m.s[sb(0) + F.x], m.s[sb(1) + F.z] - m.s[sb(0) + F.z])));
      }
      step(m, 0, 0);
    }
    return -1;
  };
  const straight = probe(D0);
  const aimed = probe(DAIM);
  t.ok(aimed >= 0 && aimed < 300 && straight > 1000, `projectile.aimed launches at the opponent (off by ${aimed} yaw units; straight one ${straight})`);
}
{
  // Gazza's ball rebounds off the ring by vector reflection (real data)
  let note = 'skipped (real data/ not loadable)';
  try {
    const real = loadGameData();
    if (real.fighters.gazza) {
      const m = newMatch({ data: real, p1: 'gazza', p2: 'johnny', stage: 'rust_theater' });
      const shoot = Object.keys(real.fighters.gazza.moves).find((k) => (real.fighters.gazza.moves[k].ball as { act?: string } | undefined)?.act === 'shoot' && real.fighters.gazza.moves[k].kind !== 'ex');
      const idx = m.cf[0].moves.findIndex((x) => x.id === shoot);
      place3(m, -2.0, -2.0, 1.0, -2.0);
      run(m, 2, 0, 0);
      // start the shot directly (the routing is probe_uniques' job): state poke = a clean move start
      m.s[sb(0) + F.bufA] = 1;
      m.s[sb(0) + F.bufM] = idx;
      m.s[sb(0) + F.bufAge] = 0;
      m.s[sb(0) + F.bufWin] = 8;
      m.s[sb(0) + F.bufF] = 0;
      const from = m.frame();
      let vIn: [number, number] | null = null;
      let vOut: [number, number] | null = null;
      let posAt: [number, number] = [0, 0];
      let moved = false;
      for (let k = 0; k < 240 && !vOut; k++) {
        step(m, 0, 0);
        let flying = false;
        for (let q = 0; q < PROJ_CAP; q++) if (m.s[projBase(q) + P.act] !== 0 && m.s[projBase(q) + P.kind] === 1 && m.s[projBase(q) + P.mode] === BALL.FLYING) flying = true;
        if (flying && !moved) {
          // once the ball flies, johnny steps well off its line (test setup) so it reaches the ring wall
          moved = true;
          m.s[sb(1) + F.x] = -250000;
          m.s[sb(1) + F.z] = 250000;
        }
        for (let q = 0; q < PROJ_CAP; q++) {
          const pb = projBase(q);
          if (m.s[pb + P.act] === 0 || m.s[pb + P.kind] !== 1) continue;
          const reb = evs(m, from).some((e) => e.type === EVX.BALL && e.b === BALL_EV.REBOUND);
          if (!reb && m.s[pb + P.mode] === BALL.FLYING) vIn = [m.s[pb + P.vx], m.s[pb + P.vz]];
          if (reb && vIn && !vOut) {
            vOut = [m.s[pb + P.vx], m.s[pb + P.vz]];
            posAt = [m.s[pb + P.x], m.s[pb + P.z]];
          }
        }
      }
      if (vIn && vOut) {
        const nx = -posAt[0] / Math.hypot(posAt[0], posAt[1]);
        const nz = -posAt[1] / Math.hypot(posAt[0], posAt[1]);
        const vn0 = vIn[0] * nx + vIn[1] * nz;
        const vn1 = vOut[0] * nx + vOut[1] * nz;
        const vt0 = vIn[0] * -nz + vIn[1] * nx;
        const vt1 = vOut[0] * -nz + vOut[1] * nx;
        const pct = m.cf[0].u.wallRest / 100;
        const ok = vn0 < 0 && vn1 > 0 && Math.abs(vn1 + vn0 * pct) <= Math.abs(vn0) * 0.05 + 3 && Math.abs(vt1 - vt0 * pct) <= Math.abs(vt0) * 0.05 + 3;
        note = `v in (${vIn}) -> out (${vOut}) U/f, normal component ${vn0.toFixed(0)} -> ${vn1.toFixed(0)}, tangential ${vt0.toFixed(0)} -> ${vt1.toFixed(0)} (x ${pct})`;
        t.ok(ok, `Gazza's ball reflects off the ring boundary: ${note}`);
      } else t.ok(false, `Gazza's ball never rebounded (vIn ${vIn}, vOut ${vOut}, move ${shoot})`);
    } else t.note(note);
  } catch (e) {
    t.ok(false, `ball rebound case crashed: ${String((e as Error).message).split('\n')[0]}`);
  }
}

// ================================================================= 6. throws: front arc, carry, back throw
function throwAt(yawOff: number): number {
  const m = newMatch({ data: D0, stage: 'circ' });
  place(m, -0.45, 0.45);
  run(m, 2, 0, 0);
  const cf = m.cf[0];
  const tm = cf.moves[cf.throwF];
  // state poke: P1 in its throw's first active frame with a yaw turned yawOff away from the opponent (no tracking there)
  const b0 = sb(0);
  m.s[b0 + F.st] = ST.ATTACK;
  m.s[b0 + F.mv] = cf.throwF;
  m.s[b0 + F.mvF] = tm.startup - 1;
  m.s[b0 + F.contact] = 0;
  m.s[b0 + F.yaw] = (16384 + yawOff) & 65535;
  const from = m.frame();
  step(m, 0, 0);
  return count(m, from, EV.THROW, 0);
}
{
  t.ok(throwAt(0) === 1 && throwAt(degToYaw(60)) === 1, 'a defender straight ahead / 60 deg off the forward is thrown');
  t.ok(throwAt(degToYaw(80)) === 0 && throwAt(degToYaw(-90)) === 0, 'a defender 80 / -90 deg off the forward is not (front arc +-70 deg)');
  const m = newMatch({ data: D0, stage: 'circ' });
  place(m, -0.45, 0.45);
  m.s[sb(0) + F.yaw] = (16384 + degToYaw(69)) & 65535;
  const in69 = inFrontArc(m, 0, 1);
  m.s[sb(0) + F.yaw] = (16384 + degToYaw(71)) & 65535;
  const in71 = inFrontArc(m, 0, 1);
  t.ok(in69 && !in71, 'front arc boundary: 69 deg in, 71 deg out');
}
{
  // throw carry along the thrower's yaw on a rotated axis; the back throw lands behind along -forward
  const run2 = (back: boolean): { cross: number; along: number } => {
    const m = newMatch({ data: D0, p1: 'kit_b', p2: 'kit_a', stage: 'rot45' });
    const a0 = pos(m, 0);
    const b0 = pos(m, 1);
    const ux = b0[0] - a0[0];
    const uz = b0[1] - a0[1];
    const L = Math.hypot(ux, uz);
    // walk in, then throw
    for (let k = 0; k < 60 && dist(m) > 0.95; k++) step(m, dirBits(m, 0, 6), 0);
    const from = m.frame();
    step(m, (back ? dirBits(m, 0, 4) : 0) | I.L | I.M, 0);
    run(m, 90, 0, 0);
    const thrown = count(m, from, EV.THROW, 0);
    const a = pos(m, 0);
    const b = pos(m, 1);
    const vx = b[0] - a[0];
    const vz = b[1] - a[1];
    return { cross: thrown ? Math.abs((vx * uz - vz * ux) / L) : 99, along: thrown ? (vx * ux + vz * uz) / L : 0 };
  };
  const f = run2(false);
  const bk = run2(true);
  t.ok(f.cross < 0.02 && f.along > 0.5, `forward throw on a 45 deg axis: the victim lands along the thrower's yaw (off-line ${f.cross.toFixed(3)} m, ahead ${f.along.toFixed(2)} m)`);
  t.ok(bk.cross < 0.02 && bk.along < -0.3, `back throw lands BEHIND along -forward (off-line ${bk.cross.toFixed(3)} m, along ${bk.along.toFixed(2)} m)`);
}

// ================================================================= 7. BRAWL / HECKLER in 3D
{
  let note = '';
  try {
    const real = loadGameData();
    // spawn bearings over several seeds (each first wave)
    const octs = new Set<number>();
    let spawns = 0;
    for (let sd = 1; sd <= 6; sd++) {
      const mm = newMatch({ data: real, p1: 'johnny', p2: 'johnny', mode: 'brawl', seed: sd });
      for (let f = 0; f < 400; f++) {
        const from = mm.frame() + 1;
        step(mm, 0, 0);
        for (const e of evs(mm, from)) if (e.type === EV.GOON_SPAWN) {
          spawns++;
          const k = e.a - 8;
          const gx = mm.s[goonBase(k) + G.x] - mm.s[sb(0) + F.x];
          const gz = mm.s[goonBase(k) + G.z] - mm.s[sb(0) + F.z];
          octs.add(Math.floor(((dirToYaw(gx, gz) + 4096) & 65535) / 8192));
        }
      }
    }
    const m = newMatch({ data: real, p1: 'johnny', p2: 'johnny', mode: 'brawl', seed: 7 });
    let lockSwitch = false;
    for (let f = 0; f < 1800; f++) {
      const px = m.s[sb(0) + F.x];
      const pz = m.s[sb(0) + F.z];
      const before = m.s[BRAWL_BASE + BR.target];
      const tgt = before >= 0 ? goonBase(before) : -1;
      // press toward the screen side opposite the current target now and then (soft lock)
      let w = 0;
      if (tgt >= 0 && f % 45 === 0) {
        const tx = m.s[tgt + G.x] - px;
        const tz = m.s[tgt + G.z] - pz;
        const onRight = tx * m.s[W.camNZ] - tz * m.s[W.camNX] > 0;
        w = (onRight ? I.L_ : I.R_) | I.L;
      }
      step(m, w, 0);
      const after = m.s[BRAWL_BASE + BR.target];
      if (w && before >= 0 && after >= 0 && after !== before) lockSwitch = true;
    }
    note = `spawns ${spawns}, octants ${[...octs].sort().join(',')}`;
    t.ok(spawns >= 12 && octs.size >= 6, `BRAWL BREAK goons come from all directions (${note}; 6 seeds x the first wave)`);
    t.ok(lockSwitch, 'soft lock: an attack toward the other screen side switches the target goon');
    let goonZ = false;
    for (let k = 0; k < GOON_CAP; k++) if (m.s[goonBase(k) + G.act] !== 0 && m.s[goonBase(k) + G.z] !== 0) goonZ = true;
    const bs = readMatch(m).brawl!;
    t.ok(goonZ && bs.goons.every((g) => typeof g.z === 'number' && typeof g.yaw === 'number') && typeof bs.target === 'number', 'goons live in the plane (z != 0) and the snapshot carries z / yaw / target');
    const h = newMatch({ data: real, p1: 'johnny', p2: 'johnny', mode: 'heckler', seed: 9 });
    const hocts = new Set<number>();
    for (let f = 0; f < 1500; f++) {
      const from = h.frame() + 1;
      step(h, 0, 0);
      for (const e of evs(h, from)) if (e.type === EV.HECKLE_THROW) {
        const pb = projBase(e.a);
        const dx = h.s[pb + P.x] - h.s[sb(0) + F.x];
        const dz = h.s[pb + P.z] - h.s[sb(0) + F.z];
        hocts.add(Math.floor(((dirToYaw(dx, dz) + 4096) & 65535) / 8192));
      }
    }
    t.ok(hocts.size >= 4, `HECKLER TOSS objects arc in from all sides (octants ${[...hocts].sort().join(',')})`);
  } catch (e) {
    t.ok(false, `bonus-round 3D case crashed: ${String((e as Error).message).split('\n')[0]} ${note}`);
  }
}

// ================================================================= 8. determinism with random STEP streams
{
  const FR = 4000;
  let twin = 0;
  let mism = 0;
  for (const [p1, p2, seed] of [['kit_a', 'kit_b', 3], ['kit_b', 'kit_a', 4], ['kit_a', 'kit_a', 5]] as [string, string, number][]) {
    const ia = stepInputs(seed, 8, FR);
    const ib = stepInputs(seed + 100, 4, FR);
    const a = newMatch({ data: D0, p1, p2, seed, skipIntro: false, stage: seed === 4 ? 'oct' : 'rot45' });
    const b = newMatch({ data: D0, p1, p2, seed, skipIntro: false, stage: seed === 4 ? 'oct' : 'rot45' });
    const c = newMatch({ data: D0, p1, p2, seed, skipIntro: false, stage: seed === 4 ? 'oct' : 'rot45' });
    const slot = new Int32Array(c.s.length);
    for (let f = 0; f < FR; f++) {
      step(a, ia[f], ib[f]);
      step(b, ia[f], ib[f]);
      if (checksum(a) !== checksum(b)) twin++;
      save(c, slot);
      step(c, ia[f], ib[f]);
      const c1 = checksum(c);
      load(c, slot);
      step(c, ia[f], ib[f]);
      if (checksum(c) !== c1 || c1 !== checksum(a)) mism++;
    }
  }
  t.eq(twin, 0, 'random STEP streams (taps, circling, back-cancels, step-attacks): twin runs identical every frame (3 x 4000 f)');
  t.eq(mism, 0, 'save / step / load / re-step every frame reproduces the straight run (3 x 4000 f)');
}

// ================================================================= 10. CHANGED(fix_core) (CONTRACT §35.20): D9 step buffer,
// D7 BACK HIT, D4 grab hold (the D1 per-fighter step is gated in section 3b; the D8 teleport facing in probe_uniques)
{
  // --- D9: an attack pressed on ANY sidestep frame (2 on) is held and comes out on step frame 11; the newest press wins
  const stepPress = (presses: [number, number][]): string => {
    const m = newMatch({ data: D0, stage: 'circ' });
    step(m, I.STEP_IN, 0); // step frame 1
    for (let k = 2; k <= 20; k++) {
      let w = 0;
      for (const [f, b] of presses) if (f === k) w |= b;
      step(m, w, 0);
      if (st(m, 0) === ST.ATTACK) return `${readFighter(m, 0).moveName}@${k}`;
    }
    return 'none';
  };
  const outs: string[] = [];
  let allEleven = true;
  for (let k = 2; k <= 10; k++) {
    const o = stepPress([[k, I.L]]);
    outs.push(`f${k} -> ${o}`);
    if (o !== '5L@11') allEleven = false;
  }
  t.ok(allEleven, `D9: L pressed on sidestep frame 2..10 comes out on step frame 11 every time (${outs.join(', ')})`);
  const late = stepPress([[12, I.L]]);
  const newest = stepPress([[3, I.L], [7, I.H]]);
  const newest2 = stepPress([[3, I.H], [10, I.L]]);
  t.ok(late === '5L@12' && newest === '5H@11' && newest2 === '5L@11', `D9: a press from frame 11 on acts at once (f12 -> ${late}); the newest press wins (L@3 then H@7 -> ${newest}, H@3 then L@10 -> ${newest2})`);
}
{
  // --- D7 BACK HIT: P2 held in hitstun (its yaw kept) turned `turnDeg` off facing P1; P1 lands a 5M / a straight brick
  const backTrial = (turnDeg: number, proj: boolean, air = false): { dmg: number; stun: number; off: number; back: number; hit: number; facing: number } => {
    const m = newMatch({ data: D0, stage: 'circ' });
    place(m, proj ? -2.2 : -0.55, proj ? 2.2 : 0.55);
    run(m, 2, 0, 0);
    const b1 = sb(1);
    m.s[b1 + F.st] = air ? ST.JUGGLE : ST.HITSTUN;
    m.s[b1 + F.stF] = 0;
    m.s[b1 + F.stun] = 90;
    if (air) {
      m.s[b1 + F.flags] |= 1;
      m.s[b1 + F.y] = 40000;
      m.s[b1 + F.vy] = 0;
      m.s[b1 + F.vx] = 0;
      m.s[b1 + F.vz] = 0;
    }
    const face = dirToYaw(m.s[sb(0) + F.x] - m.s[b1 + F.x], m.s[sb(0) + F.z] - m.s[b1 + F.z]);
    m.s[b1 + F.yaw] = (face + degToYaw(turnDeg)) & 65535;
    const hp0 = m.s[b1 + F.hp];
    const from = m.frame();
    let stun = -1;
    let yawAt = 0;
    let facing = 0;
    for (let k = 0; k < 70 && stun < 0; k++) {
      const w = proj ? (k < 3 ? dirBits(m, 0, [2, 3, 6][k]) | (k === 2 ? I.M : 0) : 0) : k === 0 ? I.M : 0;
      if (air && m.s[b1 + F.y] < 30000) m.s[b1 + F.y] = 40000; // keep it airborne until the hit (test setup)
      step(m, w, 0);
      if (m.s[b1 + F.hp] < hp0) {
        stun = m.s[b1 + F.stun];
        yawAt = m.s[b1 + F.yaw];
        facing = m.s[b1 + F.facing];
      }
    }
    const want = dirToYaw(m.s[sb(0) + F.x] - m.s[b1 + F.x], m.s[sb(0) + F.z] - m.s[b1 + F.z]);
    return {
      dmg: hp0 - m.s[b1 + F.hp], stun, off: (Math.abs(yawDelta(yawAt, want)) * 360) / 65536,
      back: count(m, from, EV3D.BACK_HIT, 0), hit: count(m, from, EV.HIT, 0), facing,
    };
  };
  const f0 = backTrial(0, false);
  const f119 = backTrial(119, false);
  const b121 = backTrial(121, false);
  const b180 = backTrial(180, false);
  const bm150 = backTrial(-150, false);
  const fmtB = (q: { dmg: number; stun: number; off: number; back: number }): string => `dmg ${q.dmg} stun ${q.stun} yaw off ${q.off.toFixed(1)} deg BACK_HIT ${q.back}`;
  t.ok(f0.hit === 1 && f0.back === 0 && f119.back === 0 && f119.dmg === f0.dmg && f119.stun === f0.stun,
    `D7: a hit from the front / 119 deg off the defender's facing is a normal hit (front ${fmtB(f0)}; 119 deg ${fmtB(f119)})`);
  const want = Math.trunc((f0.dmg * 120) / 100);
  const backOk = [b121, b180, bm150].every((q) => q.back === 1 && q.dmg === want && q.stun === f0.stun + 4 && q.off <= 0.1);
  t.ok(backOk, `D7: from > 120 deg off (121 / 180 / -150) = BACK HIT: x1.2 damage (${want}), +4 hitstun (${f0.stun + 4}), the victim turned to face the attacker, EV3D.BACK_HIT once (121: ${fmtB(b121)}; 180: ${fmtB(b180)}; -150: ${fmtB(bm150)})`);
  const pf = backTrial(0, true);
  const pb = backTrial(180, true);
  t.ok(pf.hit === 1 && pf.back === 0 && pb.back === 1 && pb.dmg === Math.trunc((pf.dmg * 120) / 100) && pb.off <= 0.5,
    `D7: a straight projectile into the defender's back is a BACK HIT too (front ${fmtB(pf)}; back ${fmtB(pb)})`);
  const air = backTrial(180, false, true);
  t.ok(air.hit === 1 && air.back === 0, `D7: an airborne (juggled) defender hit from behind is not a back hit (${fmtB(air)})`);
}
{
  // --- D4 grab hold (real data): bruno FINAL DELIVERY carries its victim along grab.path (= the cinematic gapD); every
  // other grab pulls its victim into contact on the thrower's forward line within throw.pullF frames
  let real4: GameData | null = null;
  try {
    real4 = loadGameData();
  } catch (e) {
    t.ok(false, `D4: real data/ not loadable: ${String((e as Error).message).split('\n')[0]}`);
  }
  if (real4) {
    const R4 = real4;
    const PA = new Int32Array(3);
    const PV = new Int32Array(3);
    const VPZ = new Int32Array(6);
    interface Lock { thrown: boolean; lf: number[]; along: number[]; lat: number[]; y: number[]; gap: number[]; disp: number[]; hold: number; end: number; endState: string; dmg: number }
    const lockRun = (att: string, mid: string, def: string, dM: number): Lock => {
      const m = newMatch({ data: R4, p1: att, p2: def, stage: 'rust_theater' });
      place(m, -dM / 2, dM / 2);
      run(m, 2, 0, 0);
      const idx = m.cf[0].moves.findIndex((x) => x.id === mid);
      const b0 = sb(0);
      const b1 = sb(1);
      m.s[b0 + F.showtime] = 30000;
      m.s[b0 + F.nerve] = 60000;
      m.s[b0 + F.bufA] = ACT.MOVE;
      m.s[b0 + F.bufM] = idx;
      m.s[b0 + F.bufAge] = 0;
      m.s[b0 + F.bufWin] = 8;
      m.s[b0 + F.bufF] = 0;
      const hp0 = m.s[b1 + F.hp];
      const L: Lock = { thrown: false, lf: [], along: [], lat: [], y: [], gap: [], disp: [], hold: 0, end: 0, endState: '', dmg: 0 };
      let started = false;
      for (let k = 0; k < 420; k++) {
        step(m, 0, 0);
        if (m.s[b0 + F.st] === ST.ATTACK || m.s[b0 + F.st] === ST.GRAB) started = true;
        if (m.s[b1 + F.st] === ST.THROWN) {
          L.thrown = true;
          const tot = m.s[b1 + F.tot];
          const yw = (m.s[b0 + F.yaw] * 2 * Math.PI) / 65536;
          const dx = (m.s[b1 + F.x] - m.s[b0 + F.x]) / U;
          const dz = (m.s[b1 + F.z] - m.s[b0 + F.z]) / U;
          pushCircle(m, 0, PA);
          pushCircle(m, 1, PV);
          L.lf.push(tot - m.s[b1 + F.stun]);
          L.along.push(dx * Math.sin(yw) + dz * Math.cos(yw));
          L.lat.push(Math.abs(dx * Math.cos(yw) - dz * Math.sin(yw)));
          L.y.push(m.s[b1 + F.y] / U);
          L.gap.push((Math.hypot(PV[0] - PA[0], PV[1] - PA[1]) - PA[2] - PV[2]) / U);
          L.disp.push(victimPose(m, 1, VPZ) ? VPZ[3] / U : 0);
          L.hold = holdDist(m, 1) / U;
        } else if (L.thrown) {
          const yw = (m.s[b0 + F.yaw] * 2 * Math.PI) / 65536;
          L.end = ((m.s[b1 + F.x] - m.s[b0 + F.x]) * Math.sin(yw) + (m.s[b1 + F.z] - m.s[b0 + F.z]) * Math.cos(yw)) / U;
          L.endState = readFighter(m, 1).stateName;
          L.dmg = hp0 - m.s[b1 + F.hp];
          break;
        } else if (started && (m.s[b0 + F.st] === ST.IDLE || m.s[b0 + F.st] === ST.WALK_F)) break; // whiffed
      }
      return L;
    };
    const at = (L: Lock, f: number): number => L.lf.indexOf(f);
    // FINAL DELIVERY from 1.6 m (the verifier's case: johnny stood 0.5-2 m away the whole lock)
    const fd = lockRun('bruno', 'final_delivery', 'johnny', 1.6);
    const fronts = (R4.fighters.bruno.push!.front + R4.fighters.johnny.push!.front);
    const i20 = at(fd, 20);
    const i30 = at(fd, 30);
    const i100 = at(fd, 100);
    const i128 = at(fd, 128);
    const i145 = at(fd, 145);
    const latMax = Math.max(...fd.lat);
    const yMax = Math.max(...fd.y);
    // CHANGED(wf6_fixer_core) V2: the expectations come from the data's grab.path (the carousel retune moved the keys and added
    // turnDeg; the along / lat read-back is taken along the thrower's CURRENT yaw, which turns with the path): piecewise linear
    // from the implicit connect key, the §26.5 floor (push fronts) at full weight for lift <= 0.15 m, ramped out by 0.30 m
    const fdPath = (R4.fighters.bruno.moves.final_delivery.grab?.path ?? []) as number[][];
    const want = (lf: number): [number, number] => {
      let f0 = 0, g0 = 1.6, l0 = 0;
      let gp = fdPath.length ? fdPath[fdPath.length - 1][1] : 0, lt = fdPath.length ? fdPath[fdPath.length - 1][2] : 0;
      for (const k of fdPath) {
        if (lf <= k[0]) { const u = (lf - f0) / Math.max(1, k[0] - f0); gp = g0 + (k[1] - g0) * u; lt = l0 + (k[2] - l0) * u; break; }
        f0 = k[0]; g0 = k[1]; l0 = k[2];
      }
      if (gp < fronts && lt < 0.3) gp += (fronts - gp) * Math.min(0.15, 0.3 - lt) / 0.15;
      return [gp, lt];
    };
    const near = (i: number, lf: number): boolean => i >= 0 && Math.abs(fd.along[i] - want(lf)[0]) <= 0.01 && Math.abs(fd.y[i] - want(lf)[1]) <= 0.01;
    // f20: lift 0.10 (< 0.15) -> the full §26.5 floor (the push fronts); f30: lift 0.28 -> the floor ramping out
    const ok30 = i20 >= 0 && Math.abs(fd.along[i20] - fronts) <= 0.01 && near(i20, 20) && near(i30, 30);
    const ok100 = near(i100, 100);
    const ok128 = near(i128, 128);
    const okEnd = i145 >= 0 && Math.abs(fd.along[i145] - 3.0) <= 0.01 && fd.y[i145] === 0 && Math.abs(fd.end - 3.0) <= 0.01 && fd.endState === 'knockdown';
    t.ok(fd.thrown && ok30 && ok100 && ok128 && okEnd && latMax <= 0.005 && fd.dmg === R4.fighters.bruno.moves.final_delivery.damage,
      `D4: FINAL DELIVERY holds its victim along grab.path: lock f20 hug ${i20 >= 0 ? fd.along[i20].toFixed(3) : '-'} m (= push fronts ${fronts.toFixed(3)}: the §26.5 floor while grounded) y ${i20 >= 0 ? fd.y[i20].toFixed(2) : '-'}, f30 ${i30 >= 0 ? fd.along[i30].toFixed(3) : '-'} m y ${i30 >= 0 ? fd.y[i30].toFixed(2) : '-'} (floor ramping out), f100 overhead ${i100 >= 0 ? fd.along[i100].toFixed(2) : '-'} m y ${i100 >= 0 ? fd.y[i100].toFixed(2) : '-'}, f128 ${i128 >= 0 ? fd.along[i128].toFixed(2) : '-'} m y ${i128 >= 0 ? fd.y[i128].toFixed(2) : '-'}, f145 ${i145 >= 0 ? fd.along[i145].toFixed(2) : '-'} m y ${i145 >= 0 ? fd.y[i145] : '-'}; released at ${fd.end.toFixed(2)} m (${fd.endState}); max lift ${yMax.toFixed(2)} m, off the forward line <= ${latMax.toFixed(3)} m, damage ${fd.dmg}`);
    // every other grab of the 12 kits, connected from its farthest start: its carry ANCHOR (root + the victim clips' own carry
    // taken back out) sits on the thrower's forward line at the hold distance (push fronts touching) from lock frame pullF
    const pullF = newMatch({ data: R4, p1: 'johnny', p2: 'johnny' }).sys.throwPullF;
    const bad: string[] = [];
    let nG = 0;
    let worst = 0;
    let maxConn = 0;
    for (const id of Object.keys(R4.fighters).sort()) {
      for (const mid of Object.keys(R4.fighters[id].moves)) {
        const o = R4.fighters[id].moves[mid];
        if (!o.grab || o.grab.path || mid === 'dead_air_bite') continue; // dead_air_bite = a counter follow-up (started by a catch)
        let L: Lock | null = null;
        for (let dM = 4.0; dM >= 0.6 && !L; dM -= 0.05) {
          const q = lockRun(id, mid, 'johnny', dM);
          if (q.thrown) L = q;
        }
        if (!L) {
          bad.push(`${id} ${mid}: never connects`);
          continue;
        }
        maxConn = Math.max(maxConn, L.gap[0]);
        nG++;
        const i = at(L, pullF);
        const anchor = i >= 0 ? L.along[i] + L.disp[i] : 99;
        const err = Math.abs(anchor - L.hold);
        worst = Math.max(worst, err);
        if (!(err <= 0.002 && L.lat[i] <= 0.005)) bad.push(`${id} ${mid}: anchor ${anchor.toFixed(3)} m vs hold ${L.hold.toFixed(3)} m, off-line ${i >= 0 ? L.lat[i].toFixed(3) : '-'} m at lock f${pullF} (connect gap ${L.gap[0].toFixed(3)})`);
      }
    }
    t.ok(nG >= 40 && bad.length === 0, `D4: every other grab (${nG} throws / command grabs / grab super cold_storage), connected from its farthest start, pulls the victim onto its forward line at the hold distance (push fronts touching) by lock frame ${pullF} (max anchor error ${worst.toFixed(4)} m; connect gaps were up to ${maxConn.toFixed(2)} m)${bad.length ? ': ' + bad.join('; ') : ''}`);
    // the landing no longer depends on where the grab caught: johnny throw_f / bruno walk_in_m from far vs touching; a side swap still lands behind
    // CHANGED(fix_bruno): "far" = just inside the move's CURRENT max range from the data, never a hard-coded distance (walk_in_m
    // was caught at a fixed 1.95 m, inside its old 1.10 m gap; CONTRACT 35.21 item 8 / fix_bruno set it to 0.92 m = 1.795 m root
    // to root, so 1.95 m whiffed). On the fight line a grab connects while the push-front gap <= grab.rangeM (a plain throw
    // without boxes: the thrower's throwRangeM; sim throws.ts grabCandidate), i.e. root to root <= gap + both standing push fronts.
    const farM = (att: string, mid: string, def: string): number => {
      const fa = R4.fighters[att];
      const gap = fa.moves[mid].grab?.rangeM ?? fa.throwRangeM;
      return gap + fa.push!.front + R4.fighters[def].push!.front - 0.03;
    };
    const farTF = farM('johnny', 'throw_f', 'johnny');
    const farWI = farM('bruno', 'walk_in_m', 'johnny');
    const farTB = farM('johnny', 'throw_b', 'johnny');
    const tf = [lockRun('johnny', 'throw_f', 'johnny', farTF).end, lockRun('johnny', 'throw_f', 'johnny', 0.5).end];
    const wi = [lockRun('bruno', 'walk_in_m', 'johnny', farWI).end, lockRun('bruno', 'walk_in_m', 'johnny', 0.5).end];
    const tb = lockRun('johnny', 'throw_b', 'johnny', farTB).end;
    t.ok(Math.abs(tf[0] - tf[1]) <= 0.02 && Math.abs(wi[0] - wi[1]) <= 0.02 && tb < -0.5,
      `D4: a grab caught at range releases where a touching one does (johnny throw_f from ${farTF.toFixed(2)} / 0.50 m -> ${tf[0].toFixed(2)} / ${tf[1].toFixed(2)} m, bruno walk_in_m from ${farWI.toFixed(2)} / 0.50 m -> ${wi[0].toFixed(2)} / ${wi[1].toFixed(2)} m; "far" = max range from the data - 0.03 m); johnny throw_b from ${farTB.toFixed(2)} m still lands behind (${tb.toFixed(2)} m)`);
  }
}

// ================================================================= 9. snapshots + budget
{
  const m = newMatch({ data: D0, stage: 'rot45' });
  run(m, 30, I.STEP_OUT, 0);
  const f = readFighter(m, 0);
  const yawRad = (m.s[sb(0) + F.yaw] * 2 * Math.PI) / 65536;
  t.ok(Math.abs(f.z! - m.s[sb(0) + F.z] / U) < 1e-9 && Math.abs(f.yaw! - yawRad) < 1e-9 && f.step?.kind === 'sidewalk' && f.step.dir === 'out' && f.step.side === 1,
    `FighterSnap z / yaw (radians) / step {kind ${f.step?.kind}, dir ${f.step?.dir}, side ${f.step?.side}}`);
  t.ok(STEP_CLIPS.length === 4 && m.cf[0].animStep.every((a, k) => m.tab.anims[0][a]?.clip === STEP_CLIPS[k]), 'anim table carries sidestep_l / sidestep_r / sidewalk_l / sidewalk_r');
  t.ok(STATE_INTS <= 1024, `versus state ${STATE_INTS} ints <= 1024`);
}

t.done(`state ${STATE_INTS} ints; sine hash ${sinTableHash().toString(16)}`);
void fixtureData;
