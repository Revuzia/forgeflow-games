// probe_moves (G2, lane SIM): moves from data (CONTRACT §4.3.2) measured through input words.
//  - startup (first active frame), whiff total, on-hit and on-block advantage for every kit_a
//    normal / command normal / rush / super, against the FIGHTING_DESIGN §1b arithmetic
//    (advantage = stun - (active + recovery); KD moves: hitstun = frames to act, §19.3);
//  - authored forward movement (`move` curve), cancel windows (chain / special / super),
//    target combos (chain-only), SIMPLE assist route.
import { fixtureData, newMatch, place, run, fs, evs, I, tester, dirBits, motion, sb } from './fixtures/simkit.ts';
import { step, devSet } from '../runtime/src/core/sim/match.ts';
import type { Match } from '../runtime/src/core/sim/match.ts';
import { EV } from '../runtime/src/core/sim/events.ts';
import { F, ST } from '../runtime/src/core/sim/layout.ts';

const t = tester('probe_moves');
const data = fixtureData();
const A = data.fighters.kit_a.moves;

function isFree(m: Match, i: number): boolean {
  const st = m.s[sb(i) + F.st];
  return st === ST.IDLE || st === ST.CROUCH || st === ST.WALK_F || st === ST.WALK_B;
}

interface Meas {
  start: number;
  contact: number; // frame of first HIT/BLOCK (a = 0), -1 none
  kind: number;
  atkFree: number;
  defFree: number;
  spawn: number;
}

/**
 * P1 performs `press` (a list of input words, the last one is the press frame), P2 holds `hold`.
 * Returns frame numbers. `pre` frames of hold are fed before the press sequence.
 */
function measure(m: Match, press: number[], hold: number, frames = 400): Meas {
  for (let k = 0; k < press.length - 1; k++) step(m, press[k], hold);
  const start = m.frame() + 1;
  step(m, press[press.length - 1], hold);
  const r: Meas = { start, contact: -1, kind: 0, atkFree: -1, defFree: -1, spawn: -1 };
  for (let k = 0; k < frames; k++) {
    if (r.atkFree < 0 && isFree(m, 0)) r.atkFree = m.frame();
    if (r.contact >= 0 && r.defFree < 0 && isFree(m, 1)) r.defFree = m.frame();
    if (r.atkFree >= 0 && (r.contact < 0 || r.defFree >= 0) && k > 250) break;
    step(m, 0, hold);
    if (r.contact < 0 || r.spawn < 0) {
      for (const e of evs(m, m.frame())) {
        if (r.contact < 0 && e.a === 0 && (e.type === EV.HIT || e.type === EV.BLOCK)) {
          r.contact = e.frame;
          r.kind = e.type;
        }
        if (r.spawn < 0 && e.type === EV.PROJ_SPAWN && e.a === 0) r.spawn = e.frame;
      }
    }
  }
  // contact on the press frame itself (startup 1) is impossible for these kits
  return r;
}

/** Frame of the move's last hit id (blockstun restarts on each hit of a multi-hit move). */
function lastHitFrame(mv: { startup: number; boxes?: { f: [number, number] }[] }): number {
  let f = mv.startup;
  for (const b of mv.boxes ?? []) f = Math.max(f, b.f[0]);
  return f;
}

function freshAt(dist: number): Match {
  const m = newMatch();
  place(m, -dist / 2, dist / 2);
  run(m, 2, 0, 0);
  return m;
}

// ------------------------------------------------------------------ normals: startup / whiff / hit / block
interface Case {
  id: string;
  dir: number; // numpad for the press
  btn: number;
  low?: boolean;
  dist?: number;
}
const normals: Case[] = [
  { id: '5L', dir: 5, btn: I.L },
  { id: '5M', dir: 5, btn: I.M },
  { id: '5H', dir: 5, btn: I.H },
  { id: '2L', dir: 2, btn: I.L, low: true },
  { id: '2M', dir: 2, btn: I.M, low: true },
  { id: '2H', dir: 2, btn: I.H },
  { id: '3H', dir: 3, btn: I.H, low: true },
  { id: '6H', dir: 6, btn: I.H },
  { id: '4H', dir: 4, btn: I.H },
];

for (const c of normals) {
  const mv = A[c.id];
  const total = mv.startup + mv.active + mv.recovery - 1;
  // whiff
  {
    const m = freshAt(5.0);
    const r = measure(m, [dirBits(m, 0, c.dir) | c.btn], 0);
    t.eq(r.atkFree - r.start, total, `${c.id} whiff: frames in move = startup+active+recovery-1`);
    t.eq(r.contact, -1, `${c.id} whiff: no contact at 5 m`);
  }
  // hit on a standing dummy
  {
    const m = freshAt(c.dist ?? 0.8);
    const r = measure(m, [dirBits(m, 0, c.dir) | c.btn], 0);
    t.eq(r.contact - r.start + 1, mv.startup, `${c.id} hit: startup (first active frame)`);
    t.eq(r.kind, EV.HIT, `${c.id} hit: HIT event`);
    const want = (mv.hitstun ?? 0) - (mv.active + mv.recovery);
    if (!mv.onHit?.groundBounce) t.eq(r.defFree - r.atkFree, want, `${c.id} on-hit advantage = hitstun - (active + recovery)`);
  }
  // block (stand for HL/H, crouch for L)
  {
    const m = freshAt(c.dist ?? 0.8);
    const hold = dirBits(m, 1, c.low ? 1 : 4);
    run(m, 2, 0, hold);
    const r = measure(m, [dirBits(m, 0, c.dir) | c.btn], hold);
    t.eq(r.kind, EV.BLOCK, `${c.id} ${c.low ? 'crouch' : 'stand'}-blocked`);
    const want = (mv.blockstun ?? 0) - (mv.startup + mv.active + mv.recovery - lastHitFrame(mv));
    t.eq(r.defFree - r.atkFree, want, `${c.id} on-block advantage = blockstun - (active + recovery)`);
  }
}

// ------------------------------------------------------------------ rush specials (motion + button), KD advantage
for (const [id, btn] of [['hook_l', I.L], ['hook_m', I.M], ['hook_h', I.H]] as const) {
  const mv = A[id];
  {
    const m = freshAt(1.2);
    const seq = ['2', '1', '4'].map((d) => dirBits(m, 0, Number(d)));
    seq[seq.length - 1] |= btn;
    const r = measure(m, seq, 0);
    t.eq(r.contact - r.start + 1, mv.startup, `${id} startup via 214+btn`);
    t.eq(r.defFree - r.atkFree, (mv.hitstun ?? 0) - (mv.active + mv.recovery), `${id} KD on-hit advantage (hitstun = frames to act)`);
  }
  {
    const m = freshAt(1.2);
    const hold = dirBits(m, 1, 4);
    run(m, 2, 0, hold);
    const seq = ['2', '1', '4'].map((d) => dirBits(m, 0, Number(d)));
    seq[seq.length - 1] |= btn;
    const r = measure(m, seq, hold);
    t.eq(r.defFree - r.atkFree, (mv.blockstun ?? 0) - (mv.active + mv.recovery), `${id} on-block advantage`);
  }
  {
    const m = freshAt(6.0);
    const x0 = fs(m, 0).x;
    const seq = ['2', '1', '4'].map((d) => dirBits(m, 0, Number(d)));
    seq[seq.length - 1] |= btn;
    measure(m, seq, 0);
    const travel = mv.move ? mv.move[mv.move.length - 1][1] : 0;
    t.near(fs(m, 0).x - x0, travel, 0.0001, `${id} authored travel ${travel} m`);
  }
}

// ------------------------------------------------------------------ supers
{
  const mv = A['sold_out'];
  const freeze = data.system.super.freeze1;
  const m = freshAt(0.9);
  devSet(m, 0, 'showtime', 10000);
  const seq = '236236'.split('').map((d) => dirBits(m, 0, Number(d)));
  seq[seq.length - 1] |= I.L;
  const r = measure(m, seq, 0);
  t.eq(r.contact - r.start + 1 - freeze, mv.startup, 'sold_out (Lv1) startup after the fixed super freeze');
  t.eq(r.defFree - r.atkFree, (mv.hitstun ?? 0) - (mv.startup + mv.active + mv.recovery - lastHitFrame(mv)), 'sold_out (hits: f8 800, f10 1200) KD from the final hit = hitstun - frames after it (+25)');
  t.eq(fs(m, 0).showtime, 0, 'sold_out spent 1 bar (10000)');
}
{
  const mv = A['sold_out'];
  const m = freshAt(0.9);
  devSet(m, 0, 'showtime', 10000);
  const hold = dirBits(m, 1, 4);
  run(m, 2, 0, hold);
  const seq = '236236'.split('').map((d) => dirBits(m, 0, Number(d)));
  seq[seq.length - 1] |= I.L;
  const r = measure(m, seq, hold);
  t.eq(r.defFree - r.atkFree, (mv.blockstun ?? 0) - (mv.startup + mv.active + mv.recovery - lastHitFrame(mv)), 'sold_out (2 hits, last on f10) on-block advantage = blockstun - frames after the last hit (-28)');
}
{
  const m = freshAt(0.9);
  devSet(m, 0, 'showtime', 30000);
  const seq = '214214'.split('').map((d) => dirBits(m, 0, Number(d)));
  seq[seq.length - 1] |= I.L;
  const r = measure(m, seq, 0, 600);
  const sys = data.system.cinematic;
  t.eq(r.defFree - r.atkFree, sys.victimKd - sys.attackerRecover, 'main_event (Lv3) advantage after the cinematic (+19)');
  t.eq(fs(m, 1).hp, 11000 - 4500, 'main_event authored cinematic damage 600+600+3300 unscaled');
}

// ------------------------------------------------------------------ projectile startup = spawn frame
for (const [id, btn] of [['brickbat_l', I.L], ['brickbat_m', I.M], ['brickbat_h', I.H]] as const) {
  const m = freshAt(5.0);
  const seq = ['2', '3', '6'].map((d) => dirBits(m, 0, Number(d)));
  seq[seq.length - 1] |= btn;
  const r = measure(m, seq, 0);
  t.eq(r.spawn - r.start + 1, A[id].startup, `${id} spawns on its startup frame`);
  t.eq(r.atkFree - r.start, A[id].startup + A[id].active + A[id].recovery - 1, `${id} total (47)`);
}

// ------------------------------------------------------------------ cancels
function moveName(m: Match, i: number): string {
  return fs(m, i).moveName;
}
// chain 5L -> 5L on hit, pressed during hitstop
{
  const m = freshAt(0.7);
  step(m, I.L, 0);
  const start = m.frame();
  run(m, A['5L'].startup - 1, 0, 0); // up to the hit frame
  run(m, 3, 0, 0); // inside hitstop
  step(m, I.L, 0);
  let secondStart = -1;
  let hits = 0;
  for (let k = 0; k < 60; k++) {
    const b = sb(0);
    if (secondStart < 0 && m.s[b + F.st] === ST.ATTACK && m.s[b + F.mvF] === 1 && m.frame() > start + 2) secondStart = m.frame();
    step(m, 0, 0);
  }
  for (const e of evs(m, start)) if (e.type === EV.HIT && e.a === 0) hits++;
  const naturalEnd = start + A['5L'].startup + A['5L'].active + A['5L'].recovery - 1 + (A['5L'].hitstop ?? 9);
  t.ok(secondStart > 0 && secondStart < naturalEnd, '5L chains into 5L on hit (cancel inside the recovery)', `second start ${secondStart - start}, natural end ${naturalEnd - start}`);
  t.eq(hits, 2, 'chained 5L,5L: two hits');
}
// whiffed 5L: pressing 5L early does NOT chain (only after recovery via the 4-frame buffer)
{
  const m = freshAt(5.0);
  step(m, I.L, 0);
  const start = m.frame();
  run(m, 4, 0, 0);
  step(m, I.L, 0); // mid-move press, no contact
  let restart = -1;
  for (let k = 0; k < 40; k++) {
    const b = sb(0);
    if (restart < 0 && k > 0 && m.s[b + F.st] === ST.ATTACK && m.s[b + F.mvF] === 1) restart = m.frame();
    step(m, 0, 0);
  }
  t.ok(restart === -1, 'whiffed 5L: a mid-move press outside the buffer never chains', `restart ${restart < 0 ? 'none' : restart - start}`);
}
// special cancel 5M -> 236M on hit
{
  const m = freshAt(0.9);
  step(m, I.M, 0);
  const start = m.frame();
  run(m, A['5M'].startup - 1, 0, 0);
  motion(m, 0, '236', I.M);
  run(m, 40, 0, 0);
  const spawn = evs(m, start).find((e) => e.type === EV.PROJ_SPAWN);
  const total5M = A['5M'].startup + A['5M'].active + A['5M'].recovery - 1 + (A['5M'].hitstop ?? 11);
  t.ok(spawn !== undefined && spawn.frame - start < total5M + A['brickbat_m'].startup - 1, '5M special-cancels into 236M on hit', spawn ? `spawn at +${spawn.frame - start}` : 'no spawn');
}
// target combo 5M > 5H (chain-only): on hit H becomes tc_5h
{
  const m = freshAt(0.9);
  step(m, I.M, 0);
  run(m, A['5M'].startup + 1, 0, 0);
  step(m, I.H, 0);
  let saw = false;
  for (let k = 0; k < 30; k++) {
    if (moveName(m, 0) === 'tc_5h') saw = true;
    step(m, 0, 0);
  }
  t.ok(saw, '5M (hit) then H -> target combo tc_5h');
}
{
  const m = freshAt(5.0);
  step(m, I.M, 0);
  run(m, 40, 0, 0);
  step(m, I.H, 0);
  run(m, 2, 0, 0);
  t.eq(fs(m, 0).moveName === '5H' ? 1 : 0, 1, 'H from neutral is 5H, never the chain-only tc_5h');
}
// special -> super cancel (upper has cancel "super")
{
  const m = freshAt(0.8);
  devSet(m, 0, 'showtime', 10000);
  motion(m, 0, '623', I.L);
  run(m, A['upper_l'].startup + 2, 0, 0);
  motion(m, 0, '236236', I.L);
  let saw = false;
  for (let k = 0; k < 60; k++) {
    if (moveName(m, 0) === 'sold_out') saw = true;
    step(m, 0, 0);
  }
  t.ok(saw, 'upper_l (hit) cancels into the Lv1 super');
}
// SIMPLE assist route: hold ASSIST + tap L -> 2L, 5M, hook_m
{
  const m = newMatch({ s1: 0 });
  place(m, -0.35, 0.35);
  run(m, 2, 0, 0);
  const seen: string[] = [];
  let last = '';
  for (let k = 0; k < 90; k++) {
    const tap = k % 4 === 0 ? I.L : 0;
    step(m, I.A | tap, 0);
    const n = moveName(m, 0);
    if (n && n !== last) seen.push(n);
    last = n;
  }
  t.ok(seen.slice(0, 3).join(',') === '2L,5M,hook_m', 'SIMPLE assist route (hold ASSIST + tap L) = 2L, 5M, hook_m', seen.join(','));
}
// facing auto-flip only when free: cross under/over flips after landing
{
  const m = freshAt(1.0);
  run(m, 1, dirBits(m, 0, 9), 0);
  run(m, 60, 0, 0);
  t.ok(fs(m, 0).facing === -1 || fs(m, 0).x < fs(m, 1).x, 'after a forward jump over the opponent P1 faces them again');
}

// ------------------------------------------------------------------ CONTRACT 20.2 extensions
// per-hit damage (hits): sold_out 800 + 1200
{
  const m = freshAt(0.9);
  devSet(m, 0, 'showtime', 10000);
  const seq = '236236'.split('').map((d) => dirBits(m, 0, Number(d)));
  seq[5] |= I.L;
  for (const w of seq) step(m, w, 0);
  run(m, 80, 0, 0);
  t.eq(11000 - fs(m, 1).hp, A['sold_out'].hits!.reduce((a, h) => a + h.damage, 0), 'hits[]: per-hit damage 800 + 1200 (one attack for scaling)');
}
// airVel dive: jump, 214L in the air -> the air version (same motion as the ground rush)
{
  const m = freshAt(4.0);
  step(m, dirBits(m, 0, 8), 0);
  run(m, 10, 0, 0);
  const seq = [2, 1, 4].map((d) => dirBits(m, 0, d));
  seq[2] |= I.L;
  for (const w of seq) step(m, w, 0);
  const name = fs(m, 0).moveName;
  let vxAfter = 0;
  let landF = -1;
  let landStun = -1;
  for (let k = 0; k < 80; k++) {
    step(m, 0, 0);
    if (fs(m, 0).moveFrame === A['dive_l'].startup + 1) vxAfter = m.s[sb(0) + F.vx];
    if (landF < 0 && m.s[sb(0) + F.st] === ST.LAND) {
      landF = k;
      landStun = m.s[sb(0) + F.stun];
    }
  }
  t.ok(name === 'dive_l', 'airborne 214L picks the air: true move (dive_l), not the ground rush', name);
  t.eq(vxAfter, Math.round((A['dive_l'].airVel![0] * 100000) / 60), 'airVel applied from startup (3.0 m/s)');
  t.eq(landStun, A['dive_l'].recovery, 'dive ends on landing with `recovery` landing frames');
  const m2 = freshAt(4.0);
  step(m2, dirBits(m2, 0, 5) | I.L, 0);
  run(m2, 20, 0, 0);
  const seq2 = [2, 1, 4].map((d) => dirBits(m2, 0, d));
  seq2[2] |= I.L;
  for (const w of seq2) step(m2, w, 0);
  t.ok(fs(m2, 0).moveName === 'hook_l', 'grounded 214L is still the ground rush', fs(m2, 0).moveName);
}
// SIMPLE jS
{
  const m = newMatch({ s1: 0 });
  place(m, -2, 2);
  run(m, 2, 0, 0);
  step(m, dirBits(m, 0, 8), 0);
  run(m, 10, 0, 0);
  step(m, I.S, 0);
  t.ok(fs(m, 0).moveName === 'dive_m', 'SIMPLE: S while airborne = simple.jS', fs(m, 0).moveName);
}
// trigger rekka: duck (22L) then any L/M/H inside its window -> duck_counter (chain-only, tc)
{
  const m = freshAt(3.0);
  motion(m, 0, '252', I.L);
  const n0 = fs(m, 0).moveName;
  run(m, 3, 0, 0);
  step(m, I.M, 0);
  run(m, 2, 0, 0);
  t.ok(n0 === 'duck' && fs(m, 0).moveName === 'duck_counter', 'trigger: 22L then M = duck_counter', `${n0} -> ${fs(m, 0).moveName}`);
  const m2 = freshAt(3.0);
  step(m2, I.M, 0);
  t.ok(fs(m2, 0).moveName === '5M', 'tc move is never reachable from neutral', fs(m2, 0).moveName);
}
// cinematic endAdv / endGapM (kit_b cold_storage: +25, 1.5 m)
{
  const m = newMatch({ p1: 'kit_b', p2: 'kit_a' });
  place(m, -0.5, 0.5);
  run(m, 2, 0, 0);
  devSet(m, 0, 'showtime', 30000);
  const seq = '214214'.split('').map((d) => dirBits(m, 0, Number(d)));
  seq[5] |= I.L;
  const r = measure(m, seq, 0, 700);
  const cin = data.fighters.kit_b.moves['cold_storage'].cinematic!;
  t.eq(r.defFree - r.atkFree, cin.endAdv!, 'cinematic.endAdv: attacker +25 after the cinematic');
  t.near(Math.abs(fs(m, 1).x - fs(m, 0).x), cin.endGapM!, 0.25, 'cinematic.endGapM: separation 1.5 m at the end (+-wakeup drift)');
}
// phase-2-only moves are not routable (uniques lane enables them)
{
  const m = newMatch({ p1: 'kit_b', p2: 'kit_a' });
  place(m, -3, 3);
  run(m, 2, 0, 0);
  motion(m, 0, '252', I.M);
  t.ok(fs(m, 0).moveName !== 'finale', 'phase: 2 move is never selected (phase logic is lane uniques)', fs(m, 0).moveName);
}

t.done(`${normals.length} normals + 3 rush + 2 supers + 3 projectiles measured`);
