// Scripted solutions for f12 "The Great Chimney" (Fire, chapter 3). The finale: every form, every idea.

import { O } from '../../src/levels/f12.js';

const by = (list, id) => list.find((q) => q.id === id);
const door = (s, id) => by(s.level.doors, id);
const gas = (s, id) => by(s.level.gases, id);
const drip = (s, id) => by(s.level.drips, id);
const wood = (s, id) => by(s.level.woods, id);
const form = (r, f) => { if (r.p.form !== f) r.form(f); return r; };
const W = (x) => O.wire + x, F = (x) => O.flue + x, C = (x) => O.cold + x, G = (x) => O.gas + x, K = (x) => O.chim + x;

/** Hold the stick toward (x, z) through the whole flight: wait to leave the ground, then to land. */
function flyTo(r, x, z, label, timeout = 5) {
  return r.waitUntil((s, p) => !p.grounded, { toward: [x, z], timeout: 3, label: `${label}: thrown` })
    .waitUntil((s, p) => p.grounded, { toward: [x, z], timeout, label });
}
function ride(r, x, z, label) {
  return r.waitUntil((s, p) => p.ride, { toward: [x, z], timeout: 4, label: `${label}: onto the wire` })
    .waitUntil((s, p) => !p.ride, { timeout: 6, label: `${label}: arrives` });
}
function afterDrop(r, id) {
  return r.waitUntil((s) => drip(s, id).live, { timeout: 4, label: `${id} lets go a drop` })
    .waitUntil((s) => !drip(s, id).live, { timeout: 4, label: `${id} drop lands` });
}

// ------------------------------------------------------------------ 1. the Stokehole
export function stokehole(r, all) {
  r.walkTo(3, 0).expect((s) => s.checkpoint.id === 'b1', 'first brazier');
  if (all) r.walkTo(7, 2.6).expectShards(1);
  form(r, 'blaze').walkTo(11.6, 0)
    .waitUntil((s) => wood(s, 'planks').state === 2, { toward: [12, 0], timeout: 4, label: 'the planks are gone' })
    .walkTo(17, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier before the beam')
    .walkTo(22, 0);
  form(r, 'ember').walkTo(28, 0).expect((s, p) => p.x > 26.5, 'under the beam');
  r.walkTo(32, 0).expect((s) => s.checkpoint.id === 'b1c', 'brazier before the ice');
  form(r, 'blaze').walkTo(39.6, 0)
    .waitUntil((s) => by(s.level.iceblocks, 'ice').gone, { toward: [40.3, 0], timeout: 4, label: 'the ice is gone' })
    .walkTo(46, 0).expect((s) => s.checkpoint.id === 'b1d', 'brazier before the pool')
    .walkTo(53.4, 0)
    .waitUntil((s) => by(s.level.pools, 'pool').steamT > 0, { mx: 1, timeout: 2, label: 'the pool boils' })
    .walkTo(61.2, 0, { slow: false }).jumpTo(63.6, 0, { tol: 0.5 })
    .expect((s, p) => p.x > 62 && s.deaths === 0, 'across the boiled pool');
  form(r, 'ember').walkTo(66, 0).expect((s) => s.checkpoint.id === 'b1e', 'brazier past the pool');
  form(r, 'ember').walkTo(72, 0).walkTo(78, 0).expect((s, p) => p.x > 76.8, 'under the second beam');
  r.walkTo(80, 0).expect((s) => s.checkpoint.id === 'b1f', 'brazier before the second ice');
  form(r, 'blaze').walkTo(85.6, 0)
    .waitUntil((s) => by(s.level.iceblocks, 'ice2').gone, { toward: [86.3, 0], timeout: 4, label: 'the second ice is gone' })
    .walkTo(92, 0).expect((s) => s.checkpoint.id === 'b1g', 'brazier before the lantern');
  form(r, 'ember').walkTo(99.6, 0).expectSignal('lampA', true);
  r
    .waitUntil((s) => door(s, 'doorA').open >= 1, { toward: [107.6, 0], timeout: 6, label: 'the first burner is lit and the door opens' })
    .walkTo(O.wire + 0.5, 0);
}

// ------------------------------------------------------------------ 2. the Wire Gallery
export function wireGallery(r, all) {
  r.walkTo(W(2), 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier')
    .walkTo(W(3.3), -0.9).expect((s) => by(s.level.fuses, 'fuseW').state === 1, 'the boiler fuse is lit: its payoff is two areas on')
    .walkTo(W(5.5), 0);
  afterDrop(r, 'd1').walkTo(W(7.75), 0);
  afterDrop(r, 'd2').walkTo(W(10.25), 0);
  afterDrop(r, 'd3').walkTo(W(12.75), 0);
  afterDrop(r, 'd4').walkTo(W(15.25), 0);
  afterDrop(r, 'd5').walkTo(W(20.6), 0)
    .expect((s) => s.deaths === 0, 'across the causeway, dry')
    .walkTo(W(22), -1.6).expect((s) => s.checkpoint.id === 'b2b', 'brazier on the landing');
  // the valve: light the fuse far from the tunnel, walk to its mouth, go in when the spray stops
  r.walkTo(W(30), -3.0)
    .expect((s) => by(s.level.fuses, 'fuseV').state === 1, 'the valve fuse is lit')
    .walkTo(W(20.8), -0.4).walkTo(W(20.8), 3.0, { slow: false })
    .waitUntil((s) => !by(s.level.sprinklers, 'tunnel').wet, { timeout: 8, label: 'the spray stops' })
    .walkTo(W(25.8), 3.0, { slow: false }).expectSignal('lampG', true)
    .walkTo(W(20.6), 3.0, { slow: false }).walkTo(W(20.6), 0.6)
    .expect((s) => s.deaths === 0, 'out of the tunnel before the spray came back');
  form(r, 'spark').walkTo(W(32), -2.8)
    .expect((s) => by(s.level.fuses, 'fuseS').state === 1, 'the shutter fuse is lit');
  r.walkTo(W(33), 0, { stuck: 0 });
  ride(r, W(33), 0, 'first wire')
    .walkTo(W(45), 0, { stuck: 0 });
  ride(r, W(45), 0, 'second wire')
    .walkTo(W(55), 0)
    .waitUntil((s) => door(s, 'shutter').open >= 1, { toward: [W(55.6), 0], timeout: 6, label: 'the shutter opens' })
    .walkTo(W(59), 2.0);
  r.walkTo(W(63), 0).waitUntil((s) => s.signals.get('sockB'), { timeout: 1, label: 'the socket' })
    .wait(0.2).expectSignal('burnB', true);
  form(r, 'ember')
    .waitUntil((s) => door(s, 'doorB').open >= 1, { toward: [W(70.2), 0], timeout: 6, label: 'the second door' })
    .walkTo(O.flue + 0.5, 0);
}

// ------------------------------------------------------------------ 3. the Flue
export function flue(r, all) {
  r.walkTo(F(3), 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier')
    .walkTo(F(12.6), 0);
  form(r, 'smoke');
  if (!all) r.walkTo(F(17), 0, { slow: false });
  if (all) {
    // into the closet: while the smoke is still low, turn north through the closet grate
    r.waitUntil((s, p) => p.x > F(15.4), { toward: [F(17), 0], timeout: 3, label: 'in through the foot grate' })
      .waitUntil((s, p) => p.z > 4.6, { toward: [F(17), 5.8], timeout: 6, label: 'inside the closet' })
      .walkTo(F(17), 5.8, { tol: 0.5, stuck: 0 }).expectShards(2)
      .waitUntil((s, p) => p.z < 3.4, { toward: [F(17), 0], timeout: 3, label: 'back in the flue' });
  }
  r.waitUntil((s, p) => p.y > 8.6, { toward: [F(17), 0], timeout: 6, label: 'up the flue' })
    .waitUntil((s, p) => p.x > F(20.6), { toward: [F(24), 0], timeout: 3, label: 'through the top grate' });
  form(r, 'ember')
    .waitUntil((s, p) => p.grounded, { timeout: 4, label: 'down on the loft floor' })
    .walkTo(F(24), 0).expect((s) => s.checkpoint.id === 'b3b', 'brazier in the loft')
    .walkTo(F(22.8), -2.9).expect((s) => by(s.level.fuses, 'fuseL').state === 1, 'the loft fuse is lit')
    .walkTo(F(28.4), 0)
    .waitUntil((s) => !by(s.level.sprinklers, 'curtain').wet, { toward: [F(29), 0], timeout: 8, label: 'the valve shuts' })
    .walkTo(F(32.6), 0, { slow: false }).expectSignal('lampC', true)
    .waitUntil((s) => door(s, 'doorC').open >= 1, { toward: [F(35.8), 0], timeout: 4, label: 'the loft door' })
    .walkTo(O.cold + 0.5, 0);
}

// ------------------------------------------------------------------ 4. the Cold Store
/**
 * The stretch with no brazier: ember between everything, blaze only for the two seconds a pool wants to boil and for the
 * two thick walls of ice, with the coal after the first wall. With `coal: false` the same route skips the coal - and runs dry.
 */
export function coldStretch(r, { coal = true } = {}) {
  const across = (from, to, steam, label) => {
    r.walkTo(C(from - 0.4), 0);
    form(r, 'blaze').walkTo(C(from), 0)
      .waitUntil((s) => by(s.level.pools, steam).steamT > 0, { mx: 1, timeout: 2, label: `${label} boils` });
    form(r, 'ember').walkTo(C(to - 1), 0, { slow: false }).jumpTo(C(to + 1), 0, { tol: 0.5 })
      .expect((s, p) => p.x > C(to + 0.2) && s.deaths === 0, `across ${label}`);
  };
  const melt = (x, id, label) => {
    r.walkTo(C(x - 0.8), 0);
    form(r, 'blaze').walkTo(C(x - 0.4), 0)
      .waitUntil((s) => by(s.level.iceblocks, id).gone, { toward: [C(x + 0.3), 0], timeout: 6, label: `${label} is gone` });
    form(r, 'ember');
  };
  across(39.6, 46.4, 'poolC1', 'the first pool');
  melt(52, 'iceC2', 'the second wall of ice');
  if (coal) form(r, 'ember').walkTo(C(55.4), 2.3).expect((s, p) => p.gauge > 8, 'the coal went in while the gauge was low');
  across(57.6, 64.4, 'poolC2', 'the second pool');
  melt(68, 'iceC3', 'the last wall of ice');
}

export function coldStore(r, all) {
  r.walkTo(C(2), 0).expect((s) => s.checkpoint.id === 'bC', 'the cold store brazier')
    .walkTo(C(29), 0).expect((s) => s.signals.get('warm'), 'the boiler fuse has burned out: the room has thawed');
  form(r, 'blaze').walkTo(C(30.6), 0)
    .waitUntil((s) => by(s.level.iceblocks, 'iceC1').gone, { toward: [C(31.3), 0], timeout: 4, label: 'the first wall of ice is gone' });
  form(r, 'ember').walkTo(C(35), 0).expect((s) => s.checkpoint.id === 'bC2', 'brazier past the frozen room');
  coldStretch(r);
  form(r, 'ember').walkTo(C(71), 0).walkTo(C(74.2), 0).expect((s, p) => p.x > C(73.8), 'under the low beam');
  form(r, 'ember').walkTo(O.gas + 0.5, 0);
}

// ------------------------------------------------------------------ 5. the Gas Gallery
export function gasGallery(r, all) {
  r.walkTo(G(3), 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier')
    .walkTo(G(10), 0, { stuck: 0 });
  r.waitUntil((s) => gas(s, 'gasL').blasts > 0, { timeout: 3, label: 'gasL goes off' });
  flyTo(r, G(18), 0, 'onto rung one')
    .expect((s, p) => Math.abs(p.y - 12.2) < 0.05, 'standing on rung one')
    .walkTo(G(16), 0).expect((s) => s.checkpoint.id === 'b4a', 'brazier on rung one');
  form(r, 'spark').walkTo(G(19.4), 0, { stuck: 0 });
  r.waitUntil((s) => gas(s, 'gasS').blasts > 0, { timeout: 3, label: 'gasS goes off' });
  flyTo(r, G(34), 0, 'onto rung two', 6)
    .expect((s, p) => Math.abs(p.y - 16) < 0.05, 'standing on rung two')
    .walkTo(G(32), 0).expect((s) => s.checkpoint.id === 'b4b', 'brazier on rung two');
  form(r, 'blaze').walkTo(G(42), 0, { stuck: 0 });
  r.waitUntil((s) => gas(s, 'gasV').blasts > 0, { timeout: 4, label: 'gasV goes off' });
  flyTo(r, G(58), 0, 'onto the top rung', 8)
    .expect((s, p) => Math.abs(p.y - 19.8) < 0.05, 'standing on the top rung')
    .walkTo(G(55), 0).expect((s) => s.checkpoint.id === 'b4c', 'brazier on the top rung');
  form(r, 'ember').walkTo(G(58.6), -2.4)
    .waitUntil((s) => s.signals.get('liftPlate'), { timeout: 2, label: 'the lift plate' })
    .walkTo(G(63.5), 0, { tol: 0.4 })
    .waitUntil((s, p) => p.y > 30.8, { timeout: 14, label: 'the lift reaches the top' })
    .walkTo(O.chim + 0.6, 0);
}

// ------------------------------------------------------------------ 6. the Chimney
export function chimney(r, all) {
  r.walkTo(K(2.4), 3.0).expect((s) => s.checkpoint.id === 'b5', 'the base brazier');
  form(r, 'blaze').walkTo(K(10), 0)
    .waitUntil((s) => s.signals.get('lit'), { timeout: 3, label: 'the chimney lights' });
  if (all) {
    // keep to the wall as the draught lifts you: the stone is against it
    r.waitUntil((s) => s.shardsTaken.length === 3, { toward: [K(7.2), 3.0], timeout: 12, label: 'the stone in the throat' });
  }
  // the lower draught stops at the ledge: rise up the open (south) half of the throat, then steer north over the ledge and land on it
  r.waitUntil((s, p) => p.y > 58, { toward: [K(9), 1.8], timeout: 12, label: 'up to the ledge' })
    .waitUntil((s, p) => p.grounded && p.y > 59, { toward: [K(9), -2.4], timeout: 12, label: 'on the ledge' })
    .walkTo(K(11.6), -2.6).expect((s) => s.checkpoint.id === 'b5c', 'the ledge brazier (beside the sensor)')
    .waitUntil((s) => s.signals.get('burnD'), { timeout: 3, label: 'the second sensor trips' })
    .waitUntil((s, p) => p.y > 96, { toward: [K(10), 0], timeout: 25, label: 'carried up the throat' })
    .waitUntil((s, p) => p.x > K(15), { mx: 1, timeout: 4, label: 'out onto the rim' })
    .walkTo(K(24.4), 0).expectExit();
}

export const parts = [stokehole, wireGallery, flue, coldStore, gasGallery, chimney];
export function solve(r) { for (const f of parts) f(r, false); }
export function solveAll(r) { for (const f of parts) f(r, true); }
