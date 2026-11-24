// Scripted solutions for f05 "Tinderbox" (Fire). Each area is scripted in its own local
// coordinates; the origins are the starts of the level areas (area 1 starts at its spawn, x = 0).
import f05 from '../../src/levels/f05.js';

export const ORIGINS = f05.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const [O1, O2, O3, O4, O5] = ORIGINS;

const by = (list, id) => list.find((q) => q.id === id);
const wood = (s, id) => by(s.level.woods, id);
const door = (s, id) => by(s.level.doors, id);
const stack2 = (s) => s.level.woods.filter((w) => /^sack/.test(w.id));
const stack = (s) => s.level.woods.filter((w) => /^crate\d/.test(w.id));

function woodStore(r, stone) {
  const o = O1;
  r.walkTo(o + 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  if (stone) r.walkTo(o + 7, -3.0).jumpTo(o + 9, -3.2).expectShards(1).walkTo(o + 6.5, -1.5);
  r.walkTo(o + 4.2, 2.5)
    .expect((s) => by(s.level.fuses, 'cord0').state === 1, 'the cord down the hall is burning')
    .expect((s) => wood(s, 'wall0').state === 0, 'the plank wall is not alight yet')
    .walkTo(o + 11, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier before the crates')
    .walkTo(o + 12.4, 0).form('blaze')
    .waitUntil((s) => by(s.level.woods, 'crate1n').state > 0 || by(s.level.woods, 'crate0n').state > 0, { toward: [o + 14, 0], timeout: 3, label: 'a crate catches' })
    .waitUntil((s) => stack(s).every((w) => w.state > 0), { timeout: 3, label: 'the whole stack is alight' })
    .waitUntil((s) => stack(s).every((w) => w.state === 2), { timeout: 4, label: 'the stack is gone' })
    .walkTo(o + 17.5, -2.4).walkTo(o + 21, 0).form('ember')
    .jumpTo(o + 24.35, -0.75, { run: 0.8, tol: 0.3 })
    .expect((s, p) => Math.abs(p.y - 0.7) < 1e-3, 'on the first wooden stone')
    .jumpTo(o + 28.0, 0.75, { tol: 0.3 })
    .jumpTo(o + 31.65, -0.75, { tol: 0.3 })
    .jumpTo(o + 34.6, 0, { tol: 0.4 })
    .expect((s, p) => s.deaths === 0 && Math.abs(p.y) < 1e-6, 'across the pool on the crates')
    .waitUntil((s) => wood(s, 'wall0').state === 2, { toward: [o + 37, 0], timeout: 8, label: 'the far wall has burnt' })
    .walkTo(o + 42.5, 0);
}

function afterDrop(r, id) {
  return r.waitUntil((s) => by(s.level.drips, id).live, { timeout: 4, label: `${id} lets go a drop` })
    .waitUntil((s) => !by(s.level.drips, id).live, { timeout: 4, label: `${id} drop lands` });
}

function plankWalk(r, stone) {
  const o = O2;
  if (r.p.form !== 'ember') r.form('ember');
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b2', 'brazier at the bridge')
    .walkTo(o + 7.2, 0);
  afterDrop(r, 'dw1').walkTo(o + 11.2, 0);
  if (stone) r.jumpTo(o + 11.8, -2.6, { tol: 0.3 }).expectShards(2).jumpTo(o + 11.4, -0.2, { tol: 0.35 });
  afterDrop(r, 'dw2').walkTo(o + 15.3, 0);
  afterDrop(r, 'dw3');
  r.walkTo(o + 19.9, 0).expect((s) => s.deaths === 0 && wood(s, 'deck5').state === 0, 'across, and the bridge is untouched')
    .form('blaze')
    .waitUntil((s) => wood(s, 'wall').state > 0, { toward: [o + 21.1, 0], timeout: 3, label: 'the wall catches' })
    .waitUntil((s) => wood(s, 'wall').state === 2, { timeout: 3, label: 'the wall is gone' })
    .walkTo(o + 31.9, 0, { slow: false })                       // the walkway beyond the wall is alight too: run
    .expect((s, p) => s.deaths === 0 && p.y === 0, 'across the walkway ahead of the fire')
    .walkTo(o + 34, 0).expect((s) => s.checkpoint.id === 'b3', 'brazier past the wall')
    .expect((s) => wood(s, 'deck11').state > 0, 'the fire is running back along the bridge');
}

function flueMouth(r, stone) {
  const o = O3;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b4', 'brazier at the flue mouth')
    .walkTo(o + 5.5, 0);
  if (r.p.form !== 'blaze') r.form('blaze');
  r.waitUntil((s) => wood(s, 'chain0').state > 0, { toward: [o + 8.4, 0], timeout: 3, label: 'the first board catches' })
    .form('ember');
  if (stone) {
    r.walkTo(o + 12.6, -0.2)
      .waitUntil((s) => wood(s, 'nookWall').state === 2, { timeout: 6, label: 'the fire opens the nook' })
      .walkTo(o + 14, -1.4).walkTo(o + 14, -2.9).expectShards(3).walkTo(o + 14, -0.4);
  }
  r.walkTo(o + 24, 0)
    .waitUntil((s) => door(s, 'flueGate').open >= 1, { toward: [o + 24.2, 0], timeout: 8, label: 'the fire reaches the sensor and the gate lifts' })
    .walkTo(o + 28, 0).expect((s) => s.checkpoint.id === 'b5', 'brazier past the flue');
}

function cooperage(r) {
  const o = O4;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b6', 'brazier at the cooperage')
    .walkTo(o + 3.5, 0).form('blaze')
    .waitUntil((s) => wood(s, 'wall1').state > 0, { toward: [o + 6.2, 0], timeout: 4, label: 'the wall catches' })
    .waitUntil((s) => wood(s, 'wall1').state === 2, { timeout: 3, label: 'the wall is gone' })
    .walkTo(o + 8.2, 0).form('ember')
    .walkTo(o + 14, 0).expect((s, p) => p.x > o + 13.6, 'under the beam')
    .walkTo(o + 15, 0).expect((s) => s.checkpoint.id === 'b7', 'brazier past the beam')
    .walkTo(o + 16.4, 0).form('blaze')
    .waitUntil((s) => wood(s, 'pillar').state > 0, { toward: [o + 18.2, 0], timeout: 3, label: 'the pillar catches' })
    .waitUntil((s) => by(s.level.plates, 'weight').pressed || s.signals.get('weight') || wood(s, 'pillar').state === 2, { timeout: 4, label: 'the crate falls on the first plate' })
    .walkTo(o + 19.6, 1.8).walkTo(o + 23.3, 0.2)
    .waitUntil((s) => wood(s, 'wall2').state > 0, { toward: [o + 24.1, 0], timeout: 3, label: 'the second wall catches' })
    .expect((s) => wood(s, 'pillar2').state === 0 || wood(s, 'pillar2').state === 1, 'and the pillar behind it follows')
    .waitUntil((s) => door(s, 'coopGate').open >= 1, { timeout: 5, label: 'both crates fall on their plates and the gate lifts' })
    .walkTo(o + 25.2, 1.4).walkTo(o + 28.6, 1.4).walkTo(o + 31.3, 0).walkTo(o + 34, 0).expect((s) => s.checkpoint.id === 'b8', 'brazier past the gate');
  slalom(r);
}

/** Light the cord first, burn the wall (blaze), duck the long beam (ember): the cord burns the crates the beam keeps a blaze from. */
function slalom(r) {
  const o = O4;
  r.walkTo(o + 36.2, 2.7)
    .expect((s) => by(s.level.fuses, 'cord3').state === 1, 'the slalom cord is burning')
    .walkTo(o + 39.2, 0)
    .waitUntil((s) => wood(s, 'wall3').state > 0, { toward: [o + 40.2, 0], timeout: 3, label: 'the wall catches' })
    .waitUntil((s) => wood(s, 'wall3').state === 2, { timeout: 3, label: 'the wall is gone' })
    .walkTo(o + 43, 0).form('ember')
    .walkTo(o + 51.5, 0)
    .waitUntil((s) => stack2(s).every((w) => w.state === 2), { toward: [o + 51.6, 0], timeout: 8, label: 'the cord has burnt the crates' })
    .walkTo(o + 55, 0).expect((s) => s.checkpoint.id === 'b8b', 'brazier past the crates').wait(0.4)
    .form('blaze').walkTo(o + 58.4, 0)
    .waitUntil((s) => wood(s, 'wall4').state === 2, { toward: [o + 59.2, 0], timeout: 4, label: 'the last wall burns' })
    .walkTo(o + 62, 0);
}

function longFuse(r) {
  const o = O5;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b9', 'last pool brazier')
    .walkTo(o + 10.6, 0);
  if (r.p.form !== 'blaze') r.form('blaze');
  r.waitUntil((s) => by(s.level.pools, 'lastPool').steamT > 0, { mx: 1, timeout: 4, label: 'the pool boils' })
    .waitUntil((s) => wood(s, 'lastDam').state > 0, { toward: [o + 16.7, 0], timeout: 4, label: 'the dam catches' })
    .waitUntil((s) => wood(s, 'lastDam').state === 2, { toward: [o + 16.7, 0], timeout: 3, label: 'the dam is gone' })
    .walkTo(o + 21.2, 0, { slow: false }).jumpTo(o + 22.6, 0, { tol: 0.4 })
    .expect((s, p) => p.x > o + 22 && s.deaths === 0, 'out of the basin before the water came back')
    .walkTo(o + 24, 0).expect((s) => s.checkpoint.id === 'b10', 'brazier by the long fuse')
    .walkTo(o + 28.4, 1.7)
    .waitUntil((s) => wood(s, 'line0').state > 0, { toward: [o + 28.4, 2.4], timeout: 3, label: 'the first board catches' })
    .walkTo(o + 57.2, -0.6)
    .waitUntil((s) => s.level.exits[0].open, { toward: [o + 58.2, -0.6], timeout: 8, label: 'the flame reaches the rope and the kiln door opens' })
    .expectExit({ toward: [o + 58.2, -0.6] });
}

export function solve(r) {
  woodStore(r, false);
  plankWalk(r, false);
  flueMouth(r, false);
  cooperage(r);
  longFuse(r);
}

export function solveAll(r) {
  woodStore(r, true);
  plankWalk(r, true);
  flueMouth(r, true);
  cooperage(r);
  longFuse(r);
}
