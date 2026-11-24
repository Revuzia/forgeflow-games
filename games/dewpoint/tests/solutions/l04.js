// Scripted solutions for l04 "Slip Casting".

const landed = (s, p) => p.grounded;
const full = (s, p) => p.gauge >= 3.99;
const door = (id) => (s) => s.level.doors.find((d) => d.id === id);

/** 1. The Mould Shelf: two arches, film under the shelf to press the plate, the shutter, a hurdle, a third arch, (the stack of moulds). */
function mouldShelf(r, shard) {
  r.walkTo(-52, -0.8).walkTo(-45.2, 0).form('film').walkTo(-41.5, 0).form('liquid');
  if (shard) r.walkTo(-39.4, -3.2).jumpTo(-37.2, -3.2).expectShards(1).walkTo(-35.2, -2).waitUntil(landed, { timeout: 2 });
  r.walkTo(-34.4, 0).form('film').walkTo(-28.6, 0).form('liquid')
    .expect((s) => !door('doorO')(s).open, 'the first shutter starts shut')
    .walkTo(-24, -0.8).form('film').walkTo(-24, -3.0)
    .expectSignal('pl0', true)
    .walkTo(-24, -1.0).form('liquid')
    .walkTo(-20, 0)
    .waitUntil((s) => door('doorO')(s).open >= 1, { toward: [-20, 0], timeout: 3, label: 'first shutter open' })
    .walkTo(-16.6, 0).jumpTo(-12.4, 0)
    .walkTo(-12.2, 0).form('film').walkTo(-8.4, 0).form('liquid')
    .walkTo(-5.5, 0);
}

/** 2. The Sieve Floor: film through the slats, stand up in the basin, under the wall and up the ramp. */
function sieveFloor(r) {
  r.walkTo(-2, 0.8).walkTo(9, 0).form('film')
    .waitUntil((s, p) => p.grounded && p.y < -1, { timeout: 3, label: 'dropped through the slats into the basin' })
    .form('liquid')
    .walkTo(14, 0).walkTo(21.5, 0, { y: 0 })
    .expect((s, p) => Math.abs(p.y) < 1e-6, 'up the ramp, back on the floor')
    .walkTo(22.4, 0)
    .expect((s) => s.checkpoint !== null, 'checkpoint lit');
}

/** The optional casting pen: drop in, close its posts, collect the shard, walk out through its door into the basin. */
function castingPen(r) {
  r.walkTo(3.6, -2.0).form('film')
    .waitUntil((s, p) => p.grounded && p.y < -1, { timeout: 3, label: 'dropped into the pen' })
    .expect((s) => !door('penDoor')(s).open, 'pen is sealed')
    .waitUntil((s) => s.signals.get('e3'), { timeout: 1, label: 'posts live' })
    .walkTo(3.0, -3.35).expectShards(2)
    .walkTo(4.5, -2.5)
    .waitUntil((s) => door('penDoor')(s).open >= 1, { timeout: 2, label: 'pen door open' })
    .form('liquid').walkTo(6.4, -2.5)
    .expect((s, p) => p.y < -1, 'out of the pen, still in the basin')
    .walkTo(14, 0).walkTo(21.5, 0, { y: 0 }).walkTo(22.4, 0);
}

/** 3a. Hall B: crawl under the low wall, lie across the posts, walk through the door they open. */
function firstPosts(r) {
  r.walkTo(26.2, 0).form('film').walkTo(31.1, 0)
    .expectSignal('e1', true)
    .form('liquid')
    .walkTo(34.4, 0)
    .waitUntil((s) => door('doorA')(s).open >= 1, { toward: [34.4, 0], timeout: 2, label: 'door A open' })
    .walkTo(37.2, -0.4)
    .expect((s) => s.signals.get('e1') === false, 'the door stays open after the film leaves (latched)');
}

/** 3b. The nooks: a pair of posts in each, both circuits close the shutter. */
function twoNooks(r) {
  r.walkTo(42, -0.6).form('film').walkTo(42, -3.5)
    .expectSignal('e5', true)
    .walkTo(42, -0.8).form('liquid')
    .expect((s) => !door('doorN')(s).open, 'one circuit is not enough')
    .walkTo(50, 0.6).form('film').walkTo(50, 3.5)
    .expectSignal('e6', true)
    .walkTo(50, 0.8).form('liquid')
    .walkTo(55.4, 0)
    .waitUntil((s) => door('doorN')(s).open >= 1, { toward: [55.4, 0], timeout: 2, label: 'shutter open' })
    .walkTo(60.6, 0);
}

/** 4. The Glaze Tanks: dive as film, under the first wall, close the posts in the middle tank, shutter, ramp. */
function glazeTanks(r) {
  r.walkTo(66, 0).form('film')
    .waitUntil((s, p) => p.grounded && p.y < -1, { timeout: 3, label: 'dropped into the first tank' })
    .form('liquid')
    .walkTo(72.6, 0)
    .expect((s, p) => p.y < -1 && p.x > 71.2, 'under the first wall')
    .walkTo(75.6, 0).form('film').walkTo(75.6, 0)
    .expectSignal('e4', true)
    .form('liquid')
    .walkTo(79, 0)
    .waitUntil((s) => door('doorT')(s).open >= 1, { toward: [79, 0], timeout: 3, label: 'tank shutter open' })
    .walkTo(84, 0).walkTo(97, 0, { y: 0 })
    .expect((s, p) => Math.abs(p.y) < 1e-6, 'up the ramp, back on the floor');
}

/** 5a. The Casting Hall: ice shoves the crate south, then east onto the heavy plate; film closes the last posts. */
function castingHall(r) {
  r.expectSignal('exitOpen', false)
    .walkTo(99, 0.8).form('ice')
    .walkTo(100.9, -3.3, { tol: 0.25 }).stop()
    .waitUntil((s) => s.level.crates[0].body.z >= 1.95, { mz: 1, timeout: 8, label: 'crate pushed south' })
    .stop()
    .walkTo(99, 0.7, { tol: 0.3 }).walkTo(99, 2.0, { tol: 0.25 }).stop()
    .waitUntil((s) => s.level.crates[0].body.x >= 107.8, { mx: 1, timeout: 10, label: 'crate pushed onto the heavy plate' })
    .stop()
    .expectSignal('hp', true)
    .form('liquid')
    .walkTo(112.6, 0).form('film').walkTo(117.5, 0)
    .expectSignal('e2', true)
    .form('liquid')
    .expect((s) => s.signals.get('exitOpen'), 'shutter unsealed: crate on the plate and the posts closed once')
    .walkTo(121.4, 0)
    .waitUntil((s) => door('doorK')(s).open >= 1, { toward: [121.4, 0], timeout: 3, label: 'kiln shutter open' })
    .walkTo(125.4, 0.8);
}

/** 5b. The kiln chamber: steam up to the first ledge, rest, steam up to the second, rain down on it, walk into the kiln door. */
function kilnLedge(r) {
  r.walkTo(126.6, 0).waitUntil(full, { timeout: 3, label: 'gauge full' })
    .form('steam')
    .waitUntil((s, p) => p.x > 128.4 && p.y > 3, { mx: 1, timeout: 4.2, label: 'over the edge of the first ledge' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 3) < 1e-6, 'on the first ledge')
    .walkTo(131.6, 0).waitUntil(full, { timeout: 3, label: 'gauge refilled on the ledge' })
    .form('steam')
    .waitUntil((s, p) => p.x > 133.6 && p.y > 6.4, { mx: 1, timeout: 4.2, label: 'over the edge of the second ledge' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 6.4) < 1e-6, 'on the second ledge')
    .walkTo(136.2, 0).waitUntil(full, { timeout: 3, label: 'gauge refilled on the ledge' })
    .form('steam')
    .waitUntil((s, p) => p.x > 138.6 && p.y > 9.8, { mx: 1, timeout: 4.2, label: 'over the edge of the third ledge' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - 9.8) < 1e-6, 'on the top ledge')
    .walkTo(147.4, 0).expectExit();
}

export function solve(r) {
  mouldShelf(r, false);
  sieveFloor(r);
  firstPosts(r);
  twoNooks(r);
  glazeTanks(r);
  castingHall(r);
  kilnLedge(r);
}

export function solveAll(r) {
  mouldShelf(r, true);
  // the casting pen, then the rest of the level (the basin leads under the wall)
  r.walkTo(-2, 0.8);
  castingPen(r);
  firstPosts(r);
  twoNooks(r);
  glazeTanks(r);
  r.walkTo(99, 0.8).walkTo(102.6, 0.9).walkTo(105.1, -1.9).form('film').walkTo(105.1, -3.3).expectShards(3)
    .walkTo(105.1, -1.9).form('liquid');
  castingHall(r);
  kilnLedge(r);
}
