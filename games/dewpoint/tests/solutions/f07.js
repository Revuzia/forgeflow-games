// Scripted solutions for f07 "Chimney Sweep" (Fire). Each area is scripted in its own local
// coordinates; the origins are the starts of the level areas (area 1 starts at its spawn, x = 0).
import f07 from '../../src/levels/f07.js';

export const ORIGINS = f07.areas.map((a, i) => (i === 0 ? 0 : a.box[0]));
const [O1, O2, O3, O4, O5] = ORIGINS;

const by = (list, id) => list.find((q) => q.id === id);
const wood = (s, id) => by(s.level.woods, id);
const door = (s, id) => by(s.level.doors, id);

/** Become smoke here and drift along +x (and toward `mz`) until x reaches `x`, then settle back to a coal. */
function glide(r, x, mz = 0, opts = {}) {
  r.form('smoke');
  if (opts.rise) r.waitUntil((s, p) => p.y >= opts.rise, { timeout: 5, label: 'rise to the roof first' });
  r.waitUntil((s, p) => p.x >= x, { mx: 1, mz, timeout: opts.timeout || 8, label: `slide to x=${x}` });
  return r.form('ember');
}

function sootHall(r, stone) {
  const o = O1;
  r.walkTo(o + 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  r.walkTo(o + 10.4, 0.3);
  if (stone) {
    r.form('smoke').waitUntil((s, p) => p.x >= o + 12.5, { mx: 1, mz: 0.05, timeout: 3, label: 'through the grate' })
      .waitUntil((s) => s.shardsTaken.length === 1, { mx: 1, timeout: 2, label: 'the stone behind the grate' })
      .waitUntil((s, p) => p.x >= o + 15, { mx: 1, timeout: 3 }).form('ember');
  } else glide(r, o + 15);
  r.waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands past the grate' })
    .walkTo(o + 19, 0).expect((s) => s.checkpoint.id === 'b1a', 'brazier before the pool').wait(0.4)
    .walkTo(o + 20.4, 0)
    .expect((s, p) => p.gauge > 9.9, 'a full gauge for the crossing');
  glide(r, o + 43.4);
  r.waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands on the far bank' })
    .expect((s, p) => s.deaths === 0 && p.x > o + 42, 'across the pool on the roof')
    .walkTo(o + 46, 0).expect((s) => s.checkpoint.id === 'b1b', 'brazier on the far bank');
}

function sprinklerRun(r, stone) {
  const o = O2;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b2', 'brazier at the sprinklers').walkTo(o + 5, 0);
  // rise to the roof first, then slide over the spray
  glide(r, o + 25, 0, { rise: 3.4 });
  r.waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands on the platform' })
    .expect((s) => s.deaths === 0, 'over the first two curtains')
    .walkTo(o + 28, 0).expect((s) => s.checkpoint.id === 'b3', 'platform brazier').wait(0.4);
  if (stone) {
    r.form('smoke')
      .waitUntil((s) => s.shardsTaken.length === 2, { timeout: 4, label: 'up through the hole to the stone' });
    r.waitUntil((s, p) => p.y >= 5.8, { timeout: 2 });
    r.form('ember').waitUntil((s, p) => p.grounded && p.y < 0.1, { timeout: 4, label: 'drops back down the hole' });
    r.walkTo(o + 28, 0).wait(0.4);
  }
  r.walkTo(o + 31.5, 0);
  glide(r, o + 53, 0, { rise: 3.4 });
  r.waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands past the last curtain' })
    .expect((s) => s.deaths === 0, 'over the last two curtains')
    .walkTo(o + 55, 0).expect((s) => s.checkpoint.id === 'b3b', 'brazier past the spray')
    .walkTo(o + 64, 0);
}

function smokehouse(r, stone) {
  const o = O3;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b4', 'brazier at the smokehouse').walkTo(o + 5, 0);
  if (stone) {
    r.form('smoke')
      .waitUntil((s, p) => p.x >= o + 9, { mx: 1, timeout: 4, label: 'in at the window' })
      .waitUntil((s) => s.shardsTaken.length === 3, { toward: [o + 15.9, -3.1], timeout: 6, label: 'slide over the shelf along the roof' })
      .waitUntil((s, p) => p.x <= o + 13, { toward: [o + 12.5, 0], timeout: 4 })
      .form('ember');
  } else glide(r, o + 10.5);
  r.waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands in the first chamber' })
    .walkTo(o + 12, 0).expect((s) => s.checkpoint.id === 'b5', 'brazier in the first chamber').wait(0.4)
    .walkTo(o + 20.5, 0);
  glide(r, o + 26);
  r.waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands in the second chamber' })
    .walkTo(o + 28, 0).expect((s) => s.checkpoint.id === 'b6', 'brazier in the second chamber').wait(0.4)
    .walkTo(o + 36.5, 0);
  glide(r, o + 42);
  r.waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands in the third chamber' })
    .walkTo(o + 44, 0).expect((s) => s.checkpoint.id === 'b6b', 'brazier in the third chamber').wait(0.4)
    .walkTo(o + 45, 0);
  // rise to the roof first, then slide over the spray
  glide(r, o + 52.5, 0, { rise: 3.2 });
  r.waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands past the curtain' })
    .expect((s) => s.deaths === 0, 'over the curtain inside the third chamber')
    .walkTo(o + 54, 0).expect((s) => s.checkpoint.id === 'b6c', 'brazier past the curtain').wait(0.4)
    .form('blaze').walkTo(o + 57.3, 0)
    .waitUntil((s) => wood(s, 'smokeWall').state > 0, { toward: [o + 58.2, 0], timeout: 4, label: 'the wall catches' })
    .waitUntil((s) => wood(s, 'smokeWall').state === 2, { timeout: 3, label: 'the wall is gone' })
    .walkTo(o + 63, 0);
}

function lanternDuct(r) {
  const o = O4;
  if (r.p.form !== 'ember') r.form('ember');
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b7', 'brazier at the duct')
    .expect((s) => !s.signals.get('draught'), 'the draught is off')
    .walkTo(o + 6.2, 2.2).wait(0.05).expect((s) => !s.signals.get('draught'), 'one lantern is not a draught')
    .walkTo(o + 1.8, -3.0).jumpTo(o + 3.3, -3.0).wait(0.05).expectSignal('draught', true)
    .walkTo(o + 5, -1).walkTo(o + 8.2, 0);
  glide(r, o + 45.4);
  r.waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands on the far bank' })
    .expect((s, p) => s.deaths === 0 && p.x > o + 44, 'carried over the whole pool by the draught')
    .walkTo(o + 48, 0).expect((s) => s.checkpoint.id === 'b7b', 'brazier past the duct')
    .walkTo(o + 64, 0);
}

function kilnStack(r) {
  const o = O5;
  r.walkTo(o + 1.5, 0).expect((s) => s.checkpoint.id === 'b8', 'brazier at the stack').walkTo(o + 11.5, 0);
  r.form('smoke')
    .waitUntil((s, p) => p.y >= 9.6, { timeout: 5, label: 'up the stack on the updraft' })
    .waitUntil((s, p) => p.x >= o + 15, { mx: 1, timeout: 3 }).form('ember')
    .waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands in the first gallery' })
    .expect((s, p) => Math.abs(p.y - 7.8) < 1e-6, 'standing in the first gallery')
    .walkTo(o + 16, 0).expect((s) => s.checkpoint.id === 'b9', 'gallery brazier').wait(0.4)
    .walkTo(o + 17.5, 0);
  glide(r, o + 28.5, 0, { rise: 10.4 });
  r.waitUntil((s, p) => p.grounded, { timeout: 3, label: 'lands past the curtain' })
    .walkTo(o + 30, 0).expect((s) => s.checkpoint.id === 'b9b', 'brazier past the curtain').wait(0.4)
    .expect((s) => door(s, 'topHatch').open === 0, 'the roof hatch is shut')
    .walkTo(o + 33.5, 2.0).wait(0.05).expectSignal('lampTop', true)
    .waitUntil((s) => door(s, 'topHatch').open >= 1, { toward: [o + 36, 0], timeout: 3, label: 'the lantern opens the roof hatch' })
    .walkTo(o + 39.5, 0).form('smoke')
    .waitUntil((s, p) => p.y >= 14, { timeout: 6, label: 'up through the hatch to the top gallery' })
    .waitUntil((s, p) => p.x >= o + 43.5, { mx: 1, timeout: 4 }).form('ember')
    .waitUntil((s, p) => p.grounded, { timeout: 4, label: 'lands in the top gallery' })
    .expect((s, p) => Math.abs(p.y - 11.6) < 1e-6, 'standing in the top gallery')
    .walkTo(o + 45, 0).expect((s) => s.checkpoint.id === 'b10', 'top gallery brazier').wait(0.4)
    .form('blaze').walkTo(o + 48.5, 0)
    .waitUntil((s) => s.signals.get('kilnLit'), { timeout: 2, label: 'the sensor sees a flame' })
    .walkTo(o + 53.2, 0, { stuck: 0 }).expectExit();
}

export function solve(r) {
  sootHall(r, false);
  sprinklerRun(r, false);
  smokehouse(r, false);
  lanternDuct(r);
  kilnStack(r);
}

export function solveAll(r) {
  sootHall(r, true);
  sprinklerRun(r, true);
  smokehouse(r, true);
  lanternDuct(r);
  kilnStack(r);
}
