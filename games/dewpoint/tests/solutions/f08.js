// Scripted solutions for f08 "The Great Flue" (Fire). Each area is scripted in its own local
// coordinates; the origins are the starts of the level areas (area 1 starts at its spawn, x = 0).
import f08 from '../../src/levels/f08.js';

export const ORIGINS = f08.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const [O1, O2, O3, O4, O5] = ORIGINS;

const by = (list, id) => list.find((q) => q.id === id);
const wood = (s, id) => by(s.level.woods, id);
const wax = (s, id) => by(s.level.waxes, id);
const door = (s, id) => by(s.level.doors, id);
const ice = (s, id) => by(s.level.iceblocks, id);

function draughtHall(r, stone) {
  const o = O1;
  r.walkTo(o + 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  if (stone) r.walkTo(o + 12, -2.6, { stuck: 3, slow: false, tol: 0.35 }).expectShards(1);
  r.walkTo(o + 9.2, 2.8, { stuck: 3, slow: false, tol: 0.35 })
    .expect((s) => by(s.level.fuses, 'cord1').state === 1, 'the cord in the wind is burning')
    .walkTo(o + 15.4, 0.4, { stuck: 3, slow: false, tol: 0.35 })
    .waitUntil((s) => wood(s, 'draughtWall').state > 0, { toward: [o + 15.8, 0], timeout: 8, label: 'the cord reaches the wall' })
    .waitUntil((s) => wood(s, 'draughtWall').state === 2, { toward: [o + 15.8, 0], timeout: 3, label: 'the wall is gone' })
    .walkTo(o + 25, 0, { stuck: 3, slow: false, tol: 0.35 }).walkTo(o + 28, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier past the wind');
}

function chandlery(r, stone) {
  const o = O2;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b2', 'brazier at the chandlery')
    .walkTo(o + 7, 0).form('blaze')
    .walkTo(o + 16.5, 0).expect((s) => s.deaths === 0, 'across the spray with heat to spare')
    .expect((s) => s.checkpoint.id === 'b2b', 'brazier past the curtain').wait(0.4);
  if (stone) {
    r.walkTo(o + 18.7, 2.2)
      .waitUntil((s) => wax(s, 'waxCube2').t >= 1, { toward: [o + 18.7, 3.2], timeout: 6, label: 'the wax cube sags' })
      .walkTo(o + 18.7, 3.3).expectShards(2).walkTo(o + 18.7, 1.9).wait(0.05);
    if (r.p.gauge < 5) r.walkTo(o + 16.5, 0).wait(0.4);
    if (r.p.form !== 'blaze') r.form('blaze');
  }
  r.walkTo(o + 21.3, 0)
    .waitUntil((s) => wax(s, 'waxD').t > 0, { toward: [o + 22.6, 0], timeout: 3, label: 'the wax warms' })
    .waitUntil((s) => wax(s, 'waxD').t >= 1, { toward: [o + 22.6, 0], timeout: 6, label: 'the wax has sagged' })
    .waitUntil((s) => s.signals.get('pE'), { timeout: 3, label: 'the crate settles on the plate' })
    .walkTo(o + 25, 2.8).walkTo(o + 30.2, 0.4)
    .waitUntil((s) => door(s, 'gateE').open >= 1, { toward: [o + 30.6, 0], timeout: 3, label: 'the gate lifts' })
    .walkTo(o + 35, 0).expect((s) => s.checkpoint.id === 'b2c', 'brazier past the gate').wait(0.4);
  if (r.p.form !== 'blaze') r.form('blaze');
  r.walkTo(o + 43.3, 0);
  r.waitUntil((s, p) => ice(s, 'iceI').gone || p.form !== 'blaze', { toward: [o + 44.4, 0], timeout: 12, label: 'bite one at the ice' });
  if (!ice(r.sim, 'iceI').gone) {
    r.walkTo(o + 41.5, -2.3).wait(0.1).walkTo(o + 43.3, 0);
    r.form('blaze');
    r.waitUntil((s) => ice(s, 'iceI').gone, { toward: [o + 44.4, 0], timeout: 12, label: 'the ice is finished' });
  }
  r.walkTo(o + 48, 0);
}

function valveGallery(r, stone) {
  const o = O3;
  if (r.p.form !== 'ember') r.form('ember');
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b3', 'brazier at the valve gallery').wait(0.4)
    .walkTo(o + 8, 2.0)
    .expect((s) => by(s.level.fuses, 'valve').state === 1, 'the valve cord is burning')
    .form('smoke')
    .waitUntil((s, p) => p.y >= 2.3, { timeout: 4, label: 'rise to the roof' });
  if (stone) {
    r.waitUntil((s) => s.shardsTaken.length === 3, { toward: [o + 20, -3.2], timeout: 8, label: 'slide over the stone in the roof' })
      .waitUntil((s, p) => p.x >= o + 28.4, { mx: 1, mz: 0.3, timeout: 6, label: 'on to the far bank' });
  } else r.waitUntil((s, p) => p.x >= o + 28.4, { mx: 1, timeout: 10, label: 'slide across in the calm' });
  r.form('ember')
    .waitUntil((s, p) => p.grounded, { timeout: 3 })
    .expect((s, p) => s.deaths === 0 && p.x > o + 28, 'across the first flume')
    .walkTo(o + 31, 0).expect((s) => s.checkpoint.id === 'b4', 'island brazier').wait(0.4)
    .walkTo(o + 33.4, 2.0).wait(0.05).expectSignal('calm2', true)
    .walkTo(o + 35, 0).form('smoke')
    .waitUntil((s, p) => p.y >= 2.3, { timeout: 4, label: 'rise to the roof' })
    .waitUntil((s, p) => p.x >= o + 56.4, { mx: 1, timeout: 10, label: 'slide across the second flume' })
    .form('ember')
    .waitUntil((s, p) => p.grounded, { timeout: 3 })
    .expect((s, p) => s.deaths === 0 && p.x > o + 56, 'across the second flume')
    .walkTo(o + 60, 0).expect((s) => s.checkpoint.id === 'b4b', 'brazier past the flumes');
}

function frostGallery(r) {
  const o = O4;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b5', 'brazier at the frost').walkTo(o + 4.6, 0).form('blaze')
    .waitUntil((s) => wood(s, 'row0').state > 0, { toward: [o + 7.6, 0], timeout: 3, label: 'the first board catches' })
    .form('ember')
    .walkTo(o + 17.2, 2.3)
    .expect((s) => by(s.level.fuses, 'valveF').state === 1, 'the valve cord inside the frost is burning')
    .expect((s) => by(s.level.sprinklers, 'frostSpray').wet, 'the curtain is spraying')
    .waitUntil((s) => !by(s.level.sprinklers, 'frostSpray').wet, { timeout: 4, label: 'the valve shuts the spray' })
    .walkTo(o + 25, 0, { slow: false })
    .expect((s) => s.deaths === 0, 'through the curtain while the valve is shut')
    .walkTo(o + 33, 0)
    .waitUntil((s) => door(s, 'gateF').open >= 1, { toward: [o + 33.4, 0], timeout: 10, label: 'the fire reaches the sensor and the gate lifts' })
    .walkTo(o + 40, 0).expect((s) => s.checkpoint.id === 'b6', 'brazier past the frost');
}

function kilnGallery(r) {
  const o = O5;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b7', 'brazier at the kiln gallery').walkTo(o + 5, 0);
  if (r.p.form !== 'blaze') r.form('blaze');
  r.walkTo(o + 11.3, 0);
  r.waitUntil((s, p) => wax(s, 'waxG').t >= 1 || p.form !== 'blaze', { toward: [o + 12.8, 0], timeout: 12, label: 'bite one at the great wax' });
  if (wax(r.sim, 'waxG').t < 1) {
    r.walkTo(o + 9.4, -2.3).wait(0.1).walkTo(o + 11.3, 0);
    r.form('blaze');
    r.waitUntil((s) => wax(s, 'waxG').t >= 1, { toward: [o + 12.8, 0], timeout: 12, label: 'the great wax sags' });
  }
  r.walkTo(o + 16, 0).expect((s) => s.checkpoint.id === 'b7b', 'brazier past the great wax').wait(0.4);
  if (r.p.form !== 'blaze') r.form('blaze');
  r.walkTo(o + 23.4, 0)
    .waitUntil((s, p) => !p.grounded && p.vy < 0.4, { jump: true, timeout: 2, label: 'top of the jump' })
    .special({ jump: true })
    .waitUntil((s, p) => p.grounded, { timeout: 4, label: 'lands' })
    .expectSignal('hiLamp', true)
    .walkTo(o + 28, 0).expect((s) => s.checkpoint.id === 'b7c', 'brazier before the sensor').wait(0.4)
    .walkTo(o + 35.5, 0)
    .waitUntil((s) => s.signals.get('hsK'), { timeout: 2, label: 'the sensor sees a flame' })
    .walkTo(o + 39, 0).expect((s) => s.checkpoint.id === 'b7d', 'brazier before the third lock').wait(0.4)
    .walkTo(o + 40.3, 0)
    .waitUntil((s) => wax(s, 'waxK').t > 0, { toward: [o + 41.5, 0], timeout: 3, label: 'the wax warms' })
    .waitUntil((s) => wax(s, 'waxK').t >= 1, { toward: [o + 41.5, 0], timeout: 6, label: 'the wax has sagged' })
    .waitUntil((s) => s.signals.get('pK'), { timeout: 3, label: 'the crate settles on the plate' })
    .walkTo(o + 43, 2.8).walkTo(o + 47.5, 2.0).form('ember')
    .walkTo(o + 63.8, 0, { stuck: 3, slow: false, tol: 0.35 })
    .waitUntil((s) => s.level.exits[0].open, { timeout: 2 })
    .expectExit({ toward: [o + 63.8, 0] });
}

export function solve(r) {
  draughtHall(r, false);
  chandlery(r, false);
  valveGallery(r, false);
  frostGallery(r);
  kilnGallery(r);
}

export function solveAll(r) {
  draughtHall(r, true);
  chandlery(r, true);
  valveGallery(r, true);
  frostGallery(r);
  kilnGallery(r);
}
