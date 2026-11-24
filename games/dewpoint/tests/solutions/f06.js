// Scripted solutions for f06 "Wax Resist" (Fire). Each area is scripted in its own local
// coordinates; the origins are the starts of the level areas (area 1 starts at its spawn, x = 0).
import f06 from '../../src/levels/f06.js';

export const ORIGINS = f06.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const [O1, O2, O3, O4, O5] = ORIGINS;

const by = (list, id) => list.find((q) => q.id === id);
const ice = (s, id) => by(s.level.iceblocks, id);
const wax = (s, id) => by(s.level.waxes, id);
const door = (s, id) => by(s.level.doors, id);

/** Touch an ice block (stand against it) until it is gone; `toward` is a point inside it. */
function melt(r, id, toward) {
  return r.waitUntil((s) => ice(s, id).gone, { toward, timeout: 12, label: `ice ${id} melts` });
}

/** Keep touching ice `id`; whenever the heat runs out (back to an ember), fetch coal at `coal`, and come back. */
function meltInBites(r, id, toward, stand, coal) {
  r.waitUntil((s, p) => ice(s, id).gone || p.form !== 'blaze', { toward, timeout: 12, label: `ice ${id}: bite one` });
  if (!ice(r.sim, id).gone) {
    r.walkTo(coal[0], coal[1]).wait(0.1).walkTo(stand[0], stand[1]);
    r.form('blaze');
    r.waitUntil((s) => ice(s, id).gone, { toward, timeout: 12, label: `ice ${id}: finished` });
  }
  return r;
}

function coldStore(r, stone) {
  const o = O1;
  r.walkTo(o + 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier')
    .walkTo(o + 9, 0).form('blaze');
  melt(r, 'iceA', [o + 12.4, 0]);
  if (stone) {
    r.walkTo(o + 16.4, -1.5);
    melt(r, 'cube', [o + 17.7, -2.8]);
    r.walkTo(o + 17.7, -2.7).expectShards(1).walkTo(o + 19, 0);
  }
  r.walkTo(o + 20, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier before the great wall').wait(0.4)
    .walkTo(o + 33.3, 0);
  meltInBites(r, 'iceB', [o + 34.4, 0], [o + 33.3, 0], [o + 30.6, -2.3]);
  r.walkTo(o + 38, 0);
}

function candleWalk(r, stone) {
  const o = O2;
  if (r.p.form !== 'ember') r.form('ember');
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier')
    .walkTo(o + 7.4, 0).form('blaze')
    .walkTo(o + 9.3, 0)
    .waitUntil((s) => wax(s, 'waxA').t > 0, { toward: [o + 10.5, 0], timeout: 3, label: 'the wax warms' })
    .waitUntil((s) => wax(s, 'waxA').t >= 1, { toward: [o + 10.5, 0], timeout: 6, label: 'the wax has sagged' })
    .expect((s) => by(s.level.woods, 'candle').state === 0, 'the crate was kept out of the flame')
    .waitUntil((s) => s.signals.get('pA'), { timeout: 3, label: 'the crate settles on the plate' })
    .walkTo(o + 11, 2.7);
  if (stone) {
    r.walkTo(o + 16.3, 2.1);
    r.waitUntil((s) => wax(s, 'waxCube').t >= 1, { toward: [o + 16.3, 3.2], timeout: 6, label: 'the wax cube sags' })
      .walkTo(o + 16.3, 3.3).expectShards(2).walkTo(o + 16.3, 1.9);
  }
  r.walkTo(o + 18.4, 0)
    .waitUntil((s) => door(s, 'gateA').open >= 1, { toward: [o + 18.6, 0], timeout: 3, label: 'the gate lifts' })
    .walkTo(o + 22, 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier').wait(0.3);
  if (r.p.form !== 'blaze') r.form('blaze');
  r.walkTo(o + 29.2, 0)
    .waitUntil((s) => wax(s, 'waxB').t >= 1, { toward: [o + 30.4, 0], timeout: 6, label: 'the wax wall sags to a puddle' })
    .walkTo(o + 33, 0).expect((s, p) => Math.abs(p.y - 0) < 0.15, 'stepped over the puddle');
}

function chillGallery(r, stone) {
  const o = O3;
  if (r.p.form !== 'ember') r.form('ember');
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier')
    .walkTo(o + 4, 0).form('blaze').walkTo(o + 11.3, 0);
  melt(r, 'iceC1', [o + 12.4, 0]);
  r.walkTo(o + 16.4, 2.3).wait(0.05).walkTo(o + 21.3, 0);
  melt(r, 'iceC2', [o + 22.4, 0]);
  r.walkTo(o + 26.4, -2.3).wait(0.05).walkTo(o + 31.3, 0);
  melt(r, 'iceC3', [o + 32.4, 0]);
  r.walkTo(o + 38, 0).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier').wait(0.4);
  if (stone) {
    // jump beside the frozen block, over and over: what is melted stays melted
    r.walkTo(o + 40.7, -3.0);
    for (let i = 0; i < 8 && !ice(r.sim, 'iceTop').gone; i++) {
      r.jump(0.6, 0.15, 0).waitUntil((s, p) => p.grounded, { timeout: 2, label: 'lands' });
      if (r.p.gauge < 3.5) r.walkTo(o + 38, 0).wait(0.4);                // out of heat: back to the brazier, then on
      r.walkTo(o + 40.7, -3.0);
    }
    r.expect((s) => ice(s, 'iceTop').gone, 'the block has melted in bites');
    if (r.p.gauge < 6) r.walkTo(o + 38, 0).wait(0.4).walkTo(o + 40.7, -3.0);
    if (r.p.form !== 'blaze') r.form('blaze');
    r.waitUntil((s, p) => p.x >= o + 40.9, { mx: 1, timeout: 1 })
      .waitUntil((s, p) => !p.grounded && p.vy < 0.4, { mx: 1, mz: 0, jump: true, timeout: 2, label: 'top of the jump' })
      .special({ mx: 1, jump: true })
      .waitUntil((s, p) => p.grounded, { toward: [o + 42.2, -3.0], timeout: 4, label: 'on the pillar' })
      .expectShards(3)
      .walkTo(o + 42.2, -1.5).waitUntil((s, p) => p.grounded && p.y < 0.01, { toward: [o + 43.5, 0], timeout: 4, label: 'back down' });
  }
  r.walkTo(o + 44.5, 0);
}

function mouldingHall(r) {
  const o = O4;
  if (r.p.form !== 'ember') r.form('ember');
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b6', 'sixth brazier')
    .walkTo(o + 5, 0).form('blaze').walkTo(o + 7.3, 0)
    .waitUntil((s) => ice(s, 'icePillar').gone, { toward: [o + 8.6, 0], timeout: 6, label: 'the pillar melts' })
    .waitUntil((s) => s.signals.get('pC'), { timeout: 3, label: 'the crate falls on plate one' })
    .walkTo(o + 7.5, 2.7).walkTo(o + 14.6, 2.0).walkTo(o + 14.6, -2.0).wait(0.05)
    .walkTo(o + 19.3, 0)
    .waitUntil((s) => wax(s, 'waxC').t >= 1, { toward: [o + 20.5, 0], timeout: 6, label: 'the wax sags' })
    .waitUntil((s) => s.signals.get('pD'), { timeout: 3, label: 'the crate settles on plate two' })
    .walkTo(o + 21, 2.7).walkTo(o + 28.4, 0.6)
    .waitUntil((s) => door(s, 'gateM').open >= 1, { toward: [o + 28.8, 0], timeout: 3, label: 'both crates are down: the gate lifts' })
    .walkTo(o + 33, 0).expect((s) => s.checkpoint.id === 'b7', 'seventh brazier');
}

function kilnCellar(r) {
  const o = O5;
  if (r.p.form !== 'ember') r.form('ember');
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b8', 'eighth brazier')
    .walkTo(o + 5, 0).form('blaze').walkTo(o + 12.4, 0);
  meltInBites(r, 'iceG', [o + 15, 0], [o + 12.8, 0], [o + 11.8, -2.4]);
  r.walkTo(o + 22, 0)
    .expect((s, p) => p.form === 'ember', 'the frost has turned the flame back into a coal')
    .walkTo(o + 24.4, 0).jumpTo(o + 29.4, 0, { run: 1, tol: 0.4 })
    .walkTo(o + 39, 0).expect((s) => s.checkpoint.id === 'b9', 'brazier past the frost')
    .form('blaze')
    .walkTo(o + 43, 0)
    .waitUntil((s) => s.signals.get('kilnLit'), { timeout: 2, label: 'the sensor sees a flame' })
    .walkTo(o + 49.8, 0, { stuck: 0 }).expectExit();
}

export function solve(r) {
  coldStore(r, false);
  candleWalk(r, false);
  chillGallery(r, false);
  mouldingHall(r);
  kilnCellar(r);
}

export function solveAll(r) {
  coldStore(r, true);
  candleWalk(r, true);
  chillGallery(r, true);
  mouldingHall(r);
  kilnCellar(r);
}
