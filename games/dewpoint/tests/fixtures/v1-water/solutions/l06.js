// Scripted solutions for l06 "Greenware".

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;
const ember = (s, id) => s.level.embers.find((e) => e.id === id);
const sprout = (s, id) => s.level.sprouts.find((q) => q.id === id);
const door = (s, id) => s.level.doors.find((d) => d.id === id);

/** Hall A: run into the embers as a drop. */
function doorway(r) {
  r.walkTo(12.6, 0)
    .expect((s) => !ember(s, 'doorEmbers').doused, 'the doorway is stuffed with embers')
    .walkTo(15.4, 0)
    .expect((s) => ember(s, 'doorEmbers').doused, 'doused by touch');
}

/** Hall B: water the bud, hop up its leaves onto the gallery. */
function firstBud(r) {
  r.walkTo(20.7, 0)
    .waitUntil((s) => sprout(s, 'bud1').state === 2, { timeout: 3, label: 'bud grown' })
    .walkTo(21.2, 0, { tol: 0.1 })
    .jumpTo(21.2, 0, { tol: 0.15 }).jumpTo(21.2, 0, { tol: 0.15 }).jumpTo(21.2, 0, { tol: 0.15 })
    .expect((s, p) => Math.abs(p.y - 3) < 1e-6, 'on the top leaf')
    .walkTo(24.2, 0, { y: 3 })
    .expect((s) => s.checkpoint !== null, 'checkpoint lit');
}

/** Gallery: steam up over the pillar, condense onto the ember, walk through the door it unlocks. */
function rainOnThePillar(r) {
  r.expect((s) => !door(s, 'gate').open, 'the gate is shut')
    .walkTo(27.5, 0).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s, p) => p.y > 6.9 && Math.hypot(p.x - 31, p.z + 2) < 0.4, { toward: [31, -2], timeout: 5, label: 'hovering above the ember' })
    .form('liquid')
    .waitUntil((s) => ember(s, 'pillarEmbers').doused, { timeout: 3, label: 'rain put the ember out' })
    .waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - 6.2) < 1e-6, 'standing on the pillar')
    .walkTo(33, -3).waitUntil(landed, { timeout: 3, label: 'down off the pillar' })
    .walkTo(38.8, 0)
    .waitUntil((s) => door(s, 'gate').open >= 1, { toward: [38.8, 0], timeout: 3, label: 'gate open' })
    .walkTo(42.2, 0)
    .expect((s) => s.checkpoint && s.checkpoint.pos[0] > 41, 'checkpoint beyond the gate');
}

/** Tower: steam up to the ledge, condense beside the bud, climb to the kiln door. */
function theBudOnTheLedge(r) {
  r.walkTo(49, 0).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s, p) => p.y > 6.8 && p.x > 54.6, { toward: [55.2, 0], timeout: 6, label: 'over the ledge' })
    .form('liquid').waitUntil(landed, { timeout: 2 })
    .expect((s, p) => Math.abs(p.y - 6.4) < 1e-6, 'on the ledge')
    .waitUntil((s) => sprout(s, 'bud2').state === 2, { timeout: 3, label: 'bud grown' })
    .walkTo(55.5, 0, { tol: 0.1 });
  for (let i = 0; i < 6; i++) r.jumpTo(55.5, 0, { tol: 0.15 });
  r.expect((s, p) => Math.abs(p.y - 13) < 1e-6, 'on the top leaf')
    .walkTo(68.4, 0).expectExit();
}

export function solve(r) {
  doorway(r);
  firstBud(r);
  rainOnThePillar(r);
  theBudOnTheLedge(r);
}

export function solveAll(r) {
  // shard 1 (easy): on the stack of moulds
  r.walkTo(9.8, 3.2).jumpTo(11.2, 3.2).expectShards(1)
    .walkTo(9.6, 3.0).waitUntil(landed, { timeout: 2 });
  doorway(r);
  // shard 2: the ember-stuffed nook
  r.walkTo(18, -2.6).walkTo(18, -6, { tol: 0.25 }).expectShards(2)
    .expect((s) => ember(s, 'nookEmbers').doused, 'nook embers doused')
    .walkTo(18, -2.6);
  firstBud(r);
  rainOnThePillar(r);
  // shard 3: steam in through the bars, rain beside the bud, climb to the top leaf, come back out
  r.walkTo(45.5, 1.4).waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s, p) => Math.hypot(p.x - 45.5, p.z - 6) < 0.5 && p.z > 5, { toward: [45.5, 6], timeout: 4, label: 'in through the bars, over the bud' })
    .form('liquid')
    .waitUntil((s) => sprout(s, 'budCage').state === 2, { timeout: 3, label: 'greenhouse bud grown' })
    .waitUntil(landed, { timeout: 3 })
    .walkTo(45.5, 6, { tol: 0.1 });
  for (let i = 0; i < 3; i++) r.jumpTo(45.5, 6, { tol: 0.15 });
  r.expectShards(3)
    .walkTo(43.9, 5.0, { stuck: 0, timeout: 2 })
    .waitUntil((s, p) => p.grounded && p.y < 3.01, { toward: [43.9, 5.0], timeout: 4, label: 'down the leaves' })
    .waitUntil(full, { timeout: 3 }).form('steam')
    .waitUntil((s, p) => p.z < 3.4, { toward: [45.5, 2.0], timeout: 4, label: 'out through the bars' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 3) < 1e-6 && p.z < 4, 'back on the gallery');
  theBudOnTheLedge(r);
}
