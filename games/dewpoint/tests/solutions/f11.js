// Scripted solutions for f11 "Slow Match" (Fire, chapter 3). Fuses, timers and launches.

import { O } from '../../src/levels/f11.js';

const by = (list, id) => list.find((q) => q.id === id);
const door = (s, id) => by(s.level.doors, id);
const gas = (s, id) => by(s.level.gases, id);
const fuse = (s, id) => by(s.level.fuses, id);
const form = (r, f) => { if (r.p.form !== f) r.form(f); return r; };
const H = (x) => O.shutter + x, Y = (x) => O.sync + x, C = (x) => O.count + x, M = (x) => O.mouth + x;

/** Hold the stick toward (x, z) through the whole flight: wait to leave the ground, then to land. */
function flyTo(r, x, z, label, timeout = 5) {
  return r.waitUntil((s, p) => !p.grounded, { toward: [x, z], timeout: 3, label: `${label}: thrown` })
    .waitUntil((s, p) => p.grounded, { toward: [x, z], timeout, label });
}
function ride(r, x, z, label) {
  return r.waitUntil((s, p) => p.ride, { toward: [x, z], timeout: 4, label: `${label}: onto the wire` })
    .waitUntil((s, p) => !p.ride, { timeout: 6, label: `${label}: arrives` });
}

// ------------------------------------------------------------------ 1. the Match Room
export function matchRoom(r, all) {
  r.walkTo(3, 0).expect((s) => s.checkpoint.id === 'b1', 'first brazier');
  r.walkTo(11.4, 2.0)
    .expect((s) => fuse(s, 'fuseA').state === 1, 'the match is lit')
    .walkTo(22, 0, { stuck: 0 });
  r.waitUntil((s) => gas(s, 'gasA').blasts > 0, { timeout: 6, label: 'the flame arrives' });
  flyTo(r, 40, 0, 'across the chasm', 6)
    .expect((s, p) => p.x > 31 && s.deaths === 0, 'over the chasm')
    .walkTo(34, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier on the far side')
    .walkTo(36.2, -2.4)
    .expect((s) => fuse(s, 'fuseB').state === 1, 'the second match is lit')
    .walkTo(46, 0, { stuck: 0 });
  r.waitUntil((s) => gas(s, 'gasB').blasts > 0, { timeout: 6, label: 'the second flame arrives' });
  flyTo(r, 59, 0, 'across the pool', 6)
    .expect((s, p) => p.x > 55 && s.deaths === 0, 'over the pool')
    .walkTo(O.shutter + 0.5, 0);
}

// ------------------------------------------------------------------ 2. the Shutter Run
export function shutterRun(r, all) {
  r.walkTo(H(3), 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
  form(r, 'spark').walkTo(H(8), -2.4)
    .expect((s) => fuse(s, 'fuseC').state === 1, 'the shutter fuse is lit');
  r.walkTo(H(11), 0, { stuck: 0 });
  r.waitUntil((s, p) => p.ride, { toward: [H(11), 0], timeout: 3, label: 'first wire' })
    .waitUntil((s, p) => !p.ride, { timeout: 4, label: 'first island' })
    .walkTo(H(23), 0, { stuck: 0 });
  r.waitUntil((s, p) => p.ride, { toward: [H(23), 0], timeout: 3, label: 'second wire' })
    .waitUntil((s, p) => !p.ride, { timeout: 4, label: 'second island' })
    .walkTo(H(35), 0, { stuck: 0 });
  r.waitUntil((s, p) => p.ride, { toward: [H(35), 0], timeout: 3, label: 'third wire' })
    .waitUntil((s, p) => !p.ride, { timeout: 4, label: 'the last island' })
    .walkTo(H(48), 0)
    .waitUntil((s) => door(s, 'shutter').open >= 1, { toward: [H(49.4), 0], timeout: 6, label: 'the shutter opens' })
    .walkTo(H(52), 0).expect((s) => s.deaths === 0, 'through the shutter');
  form(r, 'ember').walkTo(O.sync + 0.5, 0);
}

// ------------------------------------------------------------------ 3. the Sync Hall
export function syncHall(r, all) {
  r.walkTo(Y(3), 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier')
    .walkTo(Y(8), -2.8)
    .expect((s) => fuse(s, 'f1').state === 1, 'the long fuse is lit');
  // the middle fuse goes in when the long one has 4.2 s on it, the short one when it has 8.3 s
  r.walkTo(Y(18.6), -0.4)
    .waitUntil((s) => fuse(s, 'f1').d >= 4.2 * 2.4, { timeout: 8, label: 'long fuse: 4.2 s' })
    .walkTo(Y(20), 0.2)
    .expect((s) => fuse(s, 'f2').state === 1, 'the middle fuse is lit')
    .walkTo(Y(30.6), 2.8)
    .waitUntil((s) => fuse(s, 'f1').d >= 8.3 * 2.4, { timeout: 8, label: 'long fuse: 8.3 s' })
    .walkTo(Y(32), 3.0)
    .expect((s) => fuse(s, 'f3').state === 1, 'the short fuse is lit')
    .walkTo(Y(45), 0)
    .waitUntil((s) => door(s, 'furnace').open >= 1, { toward: [Y(47), 0], timeout: 12, label: 'the furnace opens' })
    .walkTo(Y(52), 0).expect((s) => s.checkpoint.id === 'b3b', 'brazier past the furnace');
  if (all) {
    // the niche: light the little match, step back, and walk in when the wall is down
    r.walkTo(Y(56.6), -2.8)
      .expect((s) => fuse(s, 'fuseW').state === 1, 'the niche match is lit')
      .walkTo(Y(54), -1.2)
      .waitUntil((s) => by(s.level.weakwalls, 'nicheWall').broken, { timeout: 4, label: 'the cracked wall is down' })
      .walkTo(Y(67), -2.8).expectShards(1).walkTo(Y(56), 0);
  }
  r.walkTo(O.count + 0.5, 0);
}

// ------------------------------------------------------------------ 4. the Countdown
const B = (x) => C(x + 38);                                     // the stretch after the sensor door is shifted 38 m
export function countdown(r, all) {
  r.walkTo(C(3), 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier')
    ;
  // lantern one: a jump onto the ledge
  r.walkTo(C(16), 1.2).jumpTo(C(19.5), 2.6).expectSignal('lampE', true)
    .walkTo(C(24), 0).walkTo(C(27.4), 0, { slow: false })
    .waitUntil((s) => door(s, 'doorE').open >= 1, { toward: [C(28.2), 0], timeout: 3, label: 'door one' })
    .walkTo(C(33), 0).expect((s) => s.checkpoint.id === 'b4a', 'brazier before the alcove');
  // lantern two: a spark through the pinhole
  form(r, 'spark').walkTo(C(37.2), 0.6, { slow: false }).walkTo(C(38.5), 0.6).walkTo(C(38.5), 2.8, { slow: false })
    .walkTo(C(40.4), 2.8).expectSignal('lampS', true)
    .walkTo(C(38.5), 2.8).walkTo(C(38.5), 0.6, { slow: false });
  form(r, 'ember').walkTo(C(49.4), 0, { slow: false })
    .waitUntil((s) => door(s, 'doorS').open >= 1, { toward: [C(50.2), 0], timeout: 3, label: 'door two' })
    .walkTo(C(56), 0).expect((s) => s.checkpoint.id === 'b4b', 'brazier before the planks')
    .walkTo(C(57.9), -3.1).expect((s) => fuse(s, 'fuseE').state === 1, 'the long match is lit');
  // lantern three: a blaze burns the planks
  form(r, 'blaze').walkTo(C(65.4), 0)
    .waitUntil((s) => by(s.level.woods, 'planks').state === 2, { toward: [C(66), 0], timeout: 4, label: 'planks gone' })
    .walkTo(C(71.6), 1.0).expectSignal('lampB', true);
  form(r, 'ember').walkTo(C(79.4), 0, { slow: false })
    .waitUntil((s) => door(s, 'doorB').open >= 1, { toward: [C(80.2), 0], timeout: 3, label: 'door three' })
    .walkTo(C(86), 0).expect((s) => s.checkpoint.id === 'b4c', 'brazier before the crawlspace');
  // lantern four: a spark crawls under the long shelf
  form(r, 'spark').walkTo(C(94.6), 1.0, { slow: false }).walkTo(C(94.6), 3.0, { slow: false })
    .walkTo(C(106.3), 3.0).expectSignal('lampT', true)
    .walkTo(C(94.6), 3.0, { slow: false }).walkTo(C(94.6), 1.0, { slow: false });
  form(r, 'ember').walkTo(C(111.4), 0, { slow: false })
    .waitUntil((s) => door(s, 'doorT').open >= 1, { toward: [C(112.2), 0], timeout: 3, label: 'door four' })
    .walkTo(C(114), -2.4).expect((s) => s.checkpoint.id === 'b4e', 'brazier before the sensor');
  // the sensor door: a flame on the plate, for good
  form(r, 'blaze').walkTo(C(118.5), 0)
    .waitUntil((s) => s.signals.get('openD'), { timeout: 2, label: 'the sensor latches' })
    .walkTo(C(123.4), 0, { slow: false })
    .waitUntil((s) => door(s, 'doorD').open >= 1, { toward: [C(124.2), 0], timeout: 3, label: 'door five' })
    .walkTo(C(130), 0);
  // the pool: a blaze boils it, wades across and climbs out
  r.walkTo(B(95.4), 0)
    .waitUntil((s) => by(s.level.pools, 'poolB').steamT > 0, { mx: 1, timeout: 2, label: 'the pool boils' })
    .walkTo(B(103), 0, { slow: false }).jumpTo(B(105), 0, { tol: 0.5 })
    .expect((s, p) => p.x > B(104) && s.deaths === 0, 'across the boiled pool');
  form(r, 'ember').walkTo(B(108), 0).expect((s) => s.checkpoint.id === 'b4d', 'brazier before the rail');
  // the rail: a spark rides over the chasm
  form(r, 'spark').walkTo(B(124.4), 0, { stuck: 0 });
  ride(r, B(124.4), 0, 'the long rail');
  r.expect((s, p) => p.x > B(135) && s.deaths === 0, 'across the chasm');
  form(r, 'ember').walkTo(B(137.4), 1.6);
  // the fuse burns for a long time yet: the annex, fifty-five metres out and back, for a glow-stone
  r.walkTo(B(140), 5.0).walkTo(B(140), 56.8, { stuck: 0 }).expectShards(all ? 2 : 1).walkTo(B(140), 5.0).walkTo(B(142.9), 0, { stuck: 0 });
  if (all) {
    // a blaze rides the cannon highest: turn into one with a few seconds of flame left to wait
    r.waitUntil((s) => fuse(s, 'fuseE').len - fuse(s, 'fuseE').d < fuse(s, 'fuseE').rate * 2.2, { timeout: 80, label: 'the flame is two seconds away' });
    form(r, 'blaze');
  }
  r.waitUntil((s) => gas(s, 'cannon').blasts > 0, { timeout: 60, label: 'the flame reaches the cannon' });
  flyTo(r, B(165), 0, 'over the last chasm', 8)
    .expect((s, p) => p.x > O.mouth && s.deaths === 0, 'across the chasm');
  if (all) r.expectShards(3);
  r.walkTo(O.mouth + 0.6, 0);
}

// ------------------------------------------------------------------ 5. the Kiln Mouth
export function kilnMouth(r, all) {
  r.walkTo(M(3), 0).expect((s) => s.checkpoint.id === 'b5', 'the last brazier');
  form(r, 'spark').walkTo(M(6), -2.4)
    .expect((s) => fuse(s, 'fuseF').state === 1, 'the kiln fuse is lit');
  r.walkTo(M(34.4), 0, { stuck: 0 });
  ride(r, M(34.4), 0, 'over the pool')
    .walkTo(M(66), 0, { slow: false, stuck: 0 }).expectExit();
}

export const parts = [matchRoom, shutterRun, syncHall, countdown, kilnMouth];
export function solve(r) { for (const f of parts) f(r, false); }
export function solveAll(r) { for (const f of parts) f(r, true); }
