// Scripted solutions for f04 "Night Watch" (Fire). Each area is scripted in its own local
// coordinates; the origins are the starts of the level areas (area 1 starts at its spawn, x = 0).
import f04 from '../../src/levels/f04.js';

export const ORIGINS = f04.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const [O1, O2, O3, O4, O5] = ORIGINS;

const by = (list, id) => list.find((q) => q.id === id);
const drip = (s, id) => by(s.level.drips, id);
const wood = (s, id) => by(s.level.woods, id);
const door = (s, id) => by(s.level.doors, id);
const fuse = (s, id) => by(s.level.fuses, id);
const ferry = (s) => by(s.level.movers, 'ferry');
const ferry2 = (s) => by(s.level.movers, 'ferry2');

function afterDrop(r, id) {
  return r.waitUntil((s) => drip(s, id).live, { timeout: 4, label: `${id} lets go a drop` })
    .waitUntil((s) => !drip(s, id).live, { timeout: 4, label: `${id} drop lands` });
}

/** Jump toward +x as a blaze and flare at the top of the arc. */
function flareJump(r, fromX, mz = 0) {
  return r.waitUntil((s, p) => p.x >= fromX, { mx: 1, mz, timeout: 4, label: 'run-up' })
    .waitUntil((s, p) => !p.grounded && p.vy < 0.4, { mx: 1, mz, jump: true, timeout: 2, label: 'top of the jump' })
    .special({ mx: 1, mz, jump: true })
    .waitUntil((s, p) => p.grounded, { mx: 1, mz, timeout: 4, label: 'lands' });
}

function watchHall(r, stone) {
  const o = O1;
  r.walkTo(o + 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier')
    .expect((s) => door(s, 'doorA').open === 0, 'the first door starts shut')
    .walkTo(o + 9, 2.2).wait(0.05).expectSignal('L1', true)
    .waitUntil((s) => door(s, 'doorA').open >= 1, { toward: [o + 12, 0], timeout: 3, label: 'door opens' })
    .walkTo(o + 14, 0);
  if (stone) r.walkTo(o + 14.2, -3.0).jumpTo(o + 16, -3.0).expectShards(1).walkTo(o + 18.2, -2.0);
  r.walkTo(o + 18.6, 2.9)
    .expect((s) => fuse(s, 'cord0').state === 1, 'the cord across the water is burning')
    .walkTo(o + 18.6, -1.5);
  r.jumpTo(o + 22.9, -0.75, { run: 1.2, tol: 0.3 })
    .expect((s, p) => Math.abs(p.y) < 1e-6 && p.x > o + 21.7, 'on the first stone')
    .jumpTo(o + 27.0, 0.75, { tol: 0.3 })
    .jumpTo(o + 31.1, -0.75, { tol: 0.3 })
    .jumpTo(o + 35, 0, { tol: 0.5 }).expect((s, p) => p.y === 0, 'across the pool')
    .walkTo(o + 45.6, 0)
    .waitUntil((s) => door(s, 'doorB').open >= 1, { timeout: 8, label: 'the cord reaches its door' })
    .walkTo(o + 50, 0);
}

function gallery(r) {
  const o = O2;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier').walkTo(o + 4.2, 0);
  afterDrop(r, 'd1').walkTo(o + 7.75, 0);
  afterDrop(r, 'd2').walkTo(o + 10.25, 0);
  afterDrop(r, 'd3').walkTo(o + 12.75, 0);
  afterDrop(r, 'd4').walkTo(o + 17.5, 0)
    .expect((s) => s.checkpoint.id === 'b3' && s.deaths === 0, 'island brazier, dry');
  // the ferry: wait for it at this bank, ride across, step off at the far one
  r.walkTo(o + 18.3, 0)
    .waitUntil((s) => ferry(s).t < 0.01 && ferry(s).wait > 0.5, { timeout: 12, label: 'ferry waits at this bank' })
    .walkTo(o + 20.4, 0)
    .waitUntil((s) => ferry(s).t >= 1, { timeout: 8, label: 'ferry reaches the far bank' })
    .walkTo(o + 30.5, 0).expect((s) => s.checkpoint.id === 'b3b', 'second island brazier')
    .walkTo(o + 31.3, 0)
    .waitUntil((s) => ferry2(s).t < 0.01 && ferry2(s).wait > 0.5, { timeout: 14, label: 'second ferry waits at this bank' })
    .walkTo(o + 33.4, 0)
    .waitUntil((s) => ferry2(s).t >= 1, { timeout: 8, label: 'second ferry reaches the far bank' })
    .walkTo(o + 43.4, 0);
}

function wicks(r, stone) {
  const o = O3;
  r.walkTo(o + 1.6, 0).expect((s) => s.checkpoint.id === 'b4' && s.deaths === 0, 'fourth brazier');
  if (stone) {
    r.walkTo(o + 2.4, -3.0).jumpTo(o + 4.1, -3.0).jumpTo(o + 6.1, -3.2).expectShards(2)
      .walkTo(o + 8, -2.4).walkTo(o + 4.5, 0.5);
  }
  r.walkTo(o + 4, 2.9)
    .expect((s) => fuse(s, 'wickA').state === 1, 'the long cord is burning')
    .walkTo(o + 13.5, -0.3)
    .waitUntil((s) => fuse(s, 'wickA').d >= 6.2, { timeout: 8, label: 'let the long flame get ahead' })
    .jumpTo(o + 13.5, -3.1, { tol: 0.35 })
    .expect((s) => fuse(s, 'wickB').state === 1, 'the short cord is lit while the long one still burns')
    .jumpTo(o + 17, -0.5, { tol: 0.4 })
    .walkTo(o + 19.2, 0)
    .waitUntil((s) => door(s, 'gate').open >= 1, { timeout: 8, label: 'the flames meet and the gate lifts' })
    .walkTo(o + 23.8, 2.5).wait(0.05).expectSignal('L2', true);
}

function boilingHouse(r) {
  const o = O4;
  r.walkTo(o + 1, -0.5).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier')
    .walkTo(o + 3.6, -0.5).form('blaze')
    .waitUntil((s) => by(s.level.pools, 'pool2').steamT > 0, { mx: 1, timeout: 3, label: 'the pool boils' })
    .walkTo(o + 12.2, 0, { slow: false }).jumpTo(o + 13.6, 0, { tol: 0.4 })
    .expect((s, p) => p.x > o + 13 && s.deaths === 0, 'across the boiled pool')
    .walkTo(o + 15, 0).expect((s) => s.checkpoint.id === 'b6', 'sixth brazier')
    .walkTo(o + 17, 0).form('ember')
    .walkTo(o + 22, 0).expect((s, p) => p.x > o + 21.6, 'under the beam')
    .walkTo(o + 24, 0).expect((s) => s.checkpoint.id === 'b7', 'seventh brazier')
    .walkTo(o + 27.6, 0).form('blaze')
    .waitUntil((s) => by(s.level.pools, 'pool3').steamT > 0, { mx: 1, timeout: 3, label: 'the second pool boils' })
    .waitUntil((s) => wood(s, 'dam').state > 0, { toward: [o + 32.6, 0], timeout: 4, label: 'the dam catches' })
    .waitUntil((s) => wood(s, 'dam').state === 2, { toward: [o + 32.6, 0], timeout: 4, label: 'the dam is gone' })
    .walkTo(o + 37.2, 0, { slow: false }).jumpTo(o + 38.6, 0, { tol: 0.4 })
    .expect((s, p) => p.x > o + 38 && s.deaths === 0, 'out of the basin before the water came back');
}

function canalSide(r, shelf) {
  const o = O5;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b8', 'brazier by the canal');
  r.walkTo(o + 3.2, 2.4).walkTo(o + 3.6, 0);
  if (r.p.form !== 'blaze') r.form('blaze');
  r.walkTo(o + 5, 0);
  flareJump(r, o + 5.55);
  r.expect((s, p) => p.x > o + 12 && s.deaths === 0, 'across the canal on a flare')
    .walkTo(o + 14.5, 0).expect((s) => s.checkpoint.id === 'b9', 'brazier on the far bank')
    .walkTo(o + 18.4, 0).jumpTo(o + 20, 0).jumpTo(o + 23, 0, { tol: 0.4 })
    .expect((s, p) => Math.abs(p.y - 2.6) < 1e-6, 'top of the stair')
    .walkTo(o + 22.8, 2.4)
    .walkTo(o + 23.6, 0.6)
    .waitUntil((s, p) => !p.grounded && p.vy < 0.4, { jump: true, timeout: 2, label: 'top of the jump' })
    .special({ jump: true })
    .waitUntil((s, p) => p.grounded, { timeout: 4, label: 'lands' })
    .expectSignal('L3', true);
  if (shelf) {
    r.walkTo(o + 24.4, -2.9)
      .waitUntil((s, p) => !p.grounded && p.vy < 0.4, { mx: 0.4, jump: true, timeout: 2, label: 'top of the jump' })
      .special({ mx: 1, jump: true })
      .waitUntil((s, p) => p.grounded, { toward: [o + 27.2, -2.9], timeout: 4, label: 'on the shelf' })
      .expect((s, p) => Math.abs(p.y - 4.6) < 1e-6, 'standing on the shelf')
      .walkTo(o + 27.8, -2.9)
      .waitUntil((s) => wood(s, 'boards').state === 2, { toward: [o + 28.2, -2.9], timeout: 4, label: 'boards burnt' })
      .walkTo(o + 29.4, -2.7).expectShards(3)
      .walkTo(o + 26.9, -2.7).walkTo(o + 25.5, -1);
  }
  r.waitUntil((s, p) => p.grounded && p.y < 0.01, { toward: [o + 27, 1.2], timeout: 6, label: 'back on the floor' });
}

export function solve(r) {
  watchHall(r, false);
  gallery(r);
  wicks(r, false);
  boilingHouse(r);
  canalSide(r, false);
  r.form('ember').walkTo(O5 + 30.8, 1.2, { stuck: 0 }).expectExit();
}

export function solveAll(r) {
  watchHall(r, true);
  gallery(r);
  wicks(r, true);
  boilingHouse(r);
  canalSide(r, true);
  r.form('ember').walkTo(O5 + 30.8, 1.2, { stuck: 0 }).expectExit();
}
