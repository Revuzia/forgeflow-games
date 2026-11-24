// Scripted solutions for l07 "Crazing". Coordinates are local to each area (the level is written the
// same way); `o` holds where each area starts in world x.

import level from '../../src/levels/l07.js';

const o = level.areas.map((a) => a.box[0]);
o[0] = 0;
const [A1, A2, A3, A4, A5] = o;

const landed = (s, p) => p.grounded;
const pane = (s, id) => s.level.panes.find((q) => q.id === id);
const ember = (s, id) => s.level.embers.find((e) => e.id === id);
const sprout = (s, id) => s.level.sprouts.find((q) => q.id === id);
const crate = (s) => s.level.crates[0].body;
const crate2 = (s) => s.level.crates[1].body;

/** Water a bud (stand beside it) and hop up its leaves. */
function climb(r, id, x, hops, top) {
  r.walkTo(x - 0.7, 0)
    .waitUntil((s) => sprout(s, id).state === 2, { timeout: 3, label: `${id} grown` })
    .walkTo(x, 0, { tol: 0.1 });
  for (let i = 0; i < hops; i++) r.jumpTo(x, 0, { tol: 0.15 });
  r.expect((s, p) => Math.abs(p.y - top) < 1e-6, `on the top leaf of ${id}`);
}

/** Area 1: the tail wind carries a drop over the pit, ice through the gale, film through the tunnel. */
function draughtHall(r) {
  r.walkTo(A1 + 2.4, -0.9)
    .walkTo(A1 + 8.4, 0)
    .waitUntil((s, p) => p.x >= A1 + 11.8, { mx: 1, timeout: 3, label: 'carried to the edge of the pit' })
    .jump(0.5, 1, 0)
    .waitUntil((s, p) => p.grounded && p.x > A1 + 17.6, { mx: 1, timeout: 3, label: 'carried across the pit' })
    .walkTo(A1 + 21, -0.9)
    .walkTo(A1 + 24.6, 0).form('ice')
    .waitUntil((s, p) => p.x > A1 + 37.5, { mx: 1, timeout: 8, label: 'through the gale as ice' })
    .expect((s, p) => p.form === 'ice' && p.vx > 4, 'still moving at speed: the wind did not slow the ice')
    .stop()
    .form('film')
    .walkTo(A1 + 56.6, 0, { timeout: 20 })
    .form('liquid')
    .walkTo(A1 + 59.6, 0);
}

/** Area 2: ice sprints the walkway and breaks the glass on the run; film crawls the tunnel beyond. */
function louvreWalk(r) {
  r.walkTo(A2 + 2.2, -0.9).walkTo(A2 + 3.4, 0).form('ice')
    .waitUntil((s) => pane(s, 'louvrePane').broken, { toward: [A2 + 70, 0], timeout: 12, label: 'sprint along the walkway and smash the glass on the pad' })
    .form('film')
    .walkTo(A2 + 55.2, 0, { timeout: 30 })
    .form('liquid')
    .walkTo(A2 + 59.6, 0);
}

/** Area 3: a hard fall breaks the glass floor; ice shoves the crate onto the plate that wakes the shaft; steam up it. */
function culletCellar(r) {
  r.walkTo(A3 + 2.2, -0.9).walkTo(A3 + 18, 0)
    .tick(0, 0, true);
  r.waitUntil((s, p) => p.vy < 0, { jump: true, timeout: 1, label: 'top of the jump' })
    .form('ice')
    .waitUntil((s) => pane(s, 'floorGlass').broken, { timeout: 1.5, label: 'glass floor smashed by the fall' })
    .waitUntil(landed, { timeout: 3 })
    .expect((s, p) => p.y < -6, 'down in the cellar')
    .expectSignal('shaftPlate', false)
    .walkTo(A3 + 17.6, -3.2, { tol: 0.3 }).walkTo(A3 + 19.4, -3.2, { tol: 0.25 }).stop()
    .waitUntil((s) => crate(s).z >= -0.15, { mz: 1, timeout: 6, label: 'crate pushed into the lane' })
    .stop()
    .walkTo(A3 + 17.8, crate(r.sim).z, { tol: 0.3 }).stop()
    .waitUntil((s) => crate(s).x >= A3 + 26.1, { mx: 1, timeout: 10, label: 'crate pushed onto the heavy plate' })
    .stop()
    .expectSignal('shaftPlate', true)
    .path([[A3 + 21, 1.0], [A3 + 18.1, 2.9]], { tol: 0.4 }).stop()
    .waitUntil((s) => crate2(s).x >= A3 + 26.1, { mx: 1, timeout: 10, label: 'second crate pushed onto the second plate' })
    .stop()
    .expectSignal('shaftB', true)
    .form('liquid')
    .path([[A3 + 25, 1.1], [A3 + 28, 1.1], [A3 + 30.2, 0]])
    .waitUntil((s, p) => p.gauge >= 3.99, { timeout: 3 }).form('steam')
    .waitUntil((s, p) => p.y > 0.6, { toward: [A3 + 32.6, 0], timeout: 6, label: 'up the shaft' })
    .waitUntil((s, p) => p.x > A3 + 34.6, { mx: 1, timeout: 3, label: 'out over the hall' })
    .form('liquid').waitUntil(landed, { timeout: 4 })
    .expect((s, p) => Math.abs(p.y) < 1e-6 && p.x > A3 + 33, 'on the floor above');
}

/** Area 4: film under the beam, ice through the rest of the gale and the glass at its end, then the cliff. */
function crazedGlass(r) {
  r.walkTo(A4 + 1.2, -0.9).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(A4 + 10.5, 0).form('film')
    .walkTo(A4 + 18.7, 0, { timeout: 10 })
    .form('ice')
    .waitUntil((s) => pane(s, 'paneA').broken, { mx: 1, timeout: 8, label: 'glass smashed at the end of the gale' })
    .stop()
    .form('liquid')
    .expect((s, p) => p.x > A4 + 22.3, 'through the glass');
  r.walkTo(A4 + 29.4, 0)
    .expect((s) => !ember(s, 'bayEmbers').doused, 'the way to the bud is stuffed with embers')
    .walkTo(A4 + 32.4, 0, { timeout: 3 })
    .expect((s) => ember(s, 'bayEmbers').doused, 'doused by touch');
  climb(r, 'bud', A4 + 33.8, 5, 6);
}

/** Area 5: a second cliff, douse the crest, freeze, let go: four walls of glass, and the kiln door. */
function glassRun(r) {
  r.walkTo(A5 + 2.0, -0.9, { y: 6 }).expect((s) => s.checkpoint !== null, 'checkpoint lit');
  climb(r, 'bud2', A5 + 12.0, 6, 12.6);
  r.walkTo(A5 + 15.0, -0.9, { y: 12.6 }).expect((s) => s.checkpoint.pos[1] === 12.6, 'checkpoint lit on the high crest')
    .walkTo(A5 + 22.2, 0)
    .expect((s) => !ember(s, 'crestEmbers').doused, 'the crest is stuffed with embers')
    .walkTo(A5 + 23.4, 0, { stuck: 0, timeout: 1.5, tol: 0.5 })
    .waitUntil((s) => ember(s, 'crestEmbers').doused, { mx: 1, timeout: 2, label: 'crest embers out' })
    .form('ice')
    .waitUntil((s) => pane(s, 'paneB').broken, { mx: 1, timeout: 20, label: 'the last wall of glass smashed at the foot of the slide' })
    .expect((s, p) => p.vx > 8, 'went through at speed')
    .expect((s) => ['paneS1', 'paneS2', 'paneS3'].every((id) => pane(s, id).broken), 'and the three before it')
    .stop()
    .walkTo(A5 + 122.4, 0, { tol: 0.6 }).stop()
    .form('film')
    .walkTo(A5 + 128.2, 0).expectExit();
}

export function solve(r) {
  draughtHall(r);
  louvreWalk(r);
  culletCellar(r);
  crazedGlass(r);
  glassRun(r);
}

export function solveAll(r) {
  // shard 0 (easy): on the boards beside the start
  r.walkTo(A1 + 4.4, 3.0).jumpTo(A1 + 6.2, 3.0).expectShards(1)
    .walkTo(A1 + 4.6, 2.8).waitUntil(landed, { timeout: 2 });
  draughtHall(r);
  louvreWalk(r);
  culletCellar(r);
  // shard 1: the dead-end draught is too strong for a drop or a cloud; ice walks straight in and out
  r.walkTo(A4 + 1.2, -0.9).walkTo(A4 + 5.5, 2.0, { tol: 0.3 }).form('ice').walkTo(A4 + 5.5, 2.0, { tol: 0.3 }).stop()
    .walkTo(A4 + 5.5, 8.4, { tol: 0.3 }).expectShards(2)
    .walkTo(A4 + 5.5, 2.0, { tol: 0.3 }).stop().form('liquid');
  r.walkTo(A4 + 10.5, 0).form('film')
    .walkTo(A4 + 18.7, 0, { timeout: 10 })
    .form('ice')
    .waitUntil((s) => pane(s, 'paneA').broken, { mx: 1, timeout: 8, label: 'glass smashed at the end of the gale' })
    .stop().form('liquid');
  // shard 2: jump as a drop on the glass floor, freeze at the top, land hard, jump out of the pit
  r.walkTo(A4 + 24.4, 0).walkTo(A4 + 27.5, 0)
    .tick(0, 0, true);
  r.waitUntil((s, p) => p.vy < 0, { jump: true, timeout: 1, label: 'top of the jump' })
    .form('ice')
    .waitUntil((s) => pane(s, 'floorGlassB').broken, { timeout: 1.5, label: 'glass floor smashed by the fall' })
    .waitUntil(landed, { timeout: 2 })
    .form('liquid')
    .expect((s, p) => p.y < -1, 'down in the pit')
    .walkTo(A4 + 27.5, 0).expectShards(3);
  r.jumpTo(A4 + 30.5, 0, { tol: 0.4 })
    .expect((s, p) => Math.abs(p.y) < 1e-6, 'out of the pit');
  r.walkTo(A4 + 29.4, 0).walkTo(A4 + 32.4, 0, { timeout: 3 });
  climb(r, 'bud', A4 + 33.8, 5, 6);
  glassRun(r);
}
