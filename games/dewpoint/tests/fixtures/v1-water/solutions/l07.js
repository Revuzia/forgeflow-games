// Scripted solutions for l07 "Crazing".

const landed = (s, p) => p.grounded;
const pane = (s, id) => s.level.panes.find((q) => q.id === id);
const ember = (s, id) => s.level.embers.find((e) => e.id === id);

/** Hall A -> hall B: through the first gale as ice, which the wind does not touch. */
function firstGale(r) {
  r.walkTo(9.6, 0).form('ice')
    .waitUntil((s, p) => p.x > 23.5, { mx: 1, timeout: 8, label: 'through the gale as ice' })
    .expect((s, p) => p.form === 'ice' && p.vx > 4, 'still moving at speed: the wind did not slow the ice')
    .walkTo(27, 0).stop();
}

/** Hall B -> hall C: second gale, ice with a run-up through the cracked glass. */
function secondGale(r) {
  r.walkTo(25.4, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit')
    .walkTo(33, 0, { slow: false }).stop()
    .expect((s, p) => p.form === 'ice' && p.x > 31, 'lined up for the second gale')
    .waitUntil((s) => pane(s, 'paneA').broken, { mx: 1, timeout: 8, label: 'glass smashed at the end of the gale' })
    .stop()
    .form('liquid')
    .expect((s, p) => p.x > 44.3, 'through the glass');
}

/** Hall C: water the bud and climb its five leaves to the platform. */
function theCliff(r) {
  r.walkTo(55.1, 0)
    .waitUntil((s) => s.level.sprouts[0].state === 2, { timeout: 3, label: 'bud grown' })
    .walkTo(55.8, 0, { tol: 0.1 });
  for (let i = 0; i < 5; i++) r.jumpTo(55.8, 0, { tol: 0.15 });
  r.expect((s, p) => Math.abs(p.y - 6) < 1e-6, 'on the top leaf')
    .walkTo(58.6, 0, { y: 6 });
}

/** The glass run: douse the crest, freeze, let go. */
function glassRun(r) {
  r.walkTo(65.2, 0)
    .expect((s) => !ember(s, 'crestEmbers').doused, 'the crest is stuffed with embers')
    .walkTo(66.4, 0, { stuck: 0, timeout: 1.5, tol: 0.5 })
    .waitUntil((s) => ember(s, 'crestEmbers').doused, { mx: 1, timeout: 2, label: 'crest embers out' })
    .form('ice')
    .waitUntil((s) => pane(s, 'paneB').broken, { mx: 1, timeout: 14, label: 'wall of glass smashed at the foot of the slide' })
    .expect((s, p) => p.vx > 11, 'went through at speed')
    .form('liquid')
    .walkTo(90.2, 0).expectExit();
}

export function solve(r) {
  firstGale(r);
  secondGale(r);
  theCliff(r);
  glassRun(r);
}

export function solveAll(r) {
  // shard 1 (easy): on the boards beside the start
  r.walkTo(7.2, 3.0).jumpTo(9.0, 3.0).expectShards(1)
    .walkTo(7.4, 2.8).waitUntil(landed, { timeout: 2 });
  firstGale(r);
  // shard 2: the dead-end draught is too strong for a drop or a cloud; ice walks straight in and out
  r.walkTo(29.5, 2.0, { tol: 0.3 }).stop()
    .walkTo(29.5, 8.4, { tol: 0.3 }).expectShards(2)
    .walkTo(29.5, 2.0, { tol: 0.3 }).stop();
  secondGale(r);
  // shard 3: jump as a drop on the glass floor, freeze at the top, land hard, jump out of the pit
  r.walkTo(46.4, 0).walkTo(49.5, 0)
    .tick(0, 0, true);
  r.waitUntil((s, p) => p.vy < 0, { jump: true, timeout: 1, label: 'top of the jump' })
    .form('ice')
    .waitUntil((s) => pane(s, 'floorGlass').broken, { timeout: 1.5, label: 'glass floor smashed by the fall' })
    .waitUntil(landed, { timeout: 2 })
    .form('liquid')
    .expect((s, p) => p.y < -1, 'down in the pit')
    .walkTo(49.5, 0).expectShards(3);
  r.jumpTo(52.5, 0, { tol: 0.4 })
    .expect((s, p) => Math.abs(p.y) < 1e-6, 'out of the pit');
  theCliff(r);
  glassRun(r);
}
