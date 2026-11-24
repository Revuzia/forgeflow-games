// Scripted solutions for f09 "Brass Rail" (Fire, chapter 3). Spark, wires, sockets and timers.
// Areas are written in local coordinates and shifted by the origins the level exports.

import { O } from '../../src/levels/f09.js';

const by = (list, id) => list.find((q) => q.id === id);
const door = (s, id) => by(s.level.doors, id);
const drip = (s, id) => by(s.level.drips, id);
const spark = (r) => { if (r.p.form !== 'spark') r.form('spark'); return r; };
const ember = (r) => { if (r.p.form !== 'ember') r.form('ember'); return r; };
const R = (x) => O.rail + x, C = (x) => O.cellar + x, G = (x) => O.gallery + x, K = (x) => O.kiln + x;

/** Walk a spark onto a terminal that has a wire and wait for the ride to start and finish. */
function ride(r, x, z, label) {
  return r.waitUntil((s, p) => p.ride, { toward: [x, z], timeout: 4, label: `${label}: onto the wire` })
    .waitUntil((s, p) => !p.ride, { timeout: 6, label: `${label}: arrives` });
}

/** Wait until the drop of drip `id` has just landed, so the column is clear for most of a period. */
function afterDrop(r, id) {
  return r.waitUntil((s) => drip(s, id).live, { timeout: 4, label: `${id} lets go a drop` })
    .waitUntil((s) => !drip(s, id).live, { timeout: 4, label: `${id} drop lands` });
}

// ------------------------------------------------------------------ 1. the Switchroom
export function switchroom(r) {
  r.walkTo(3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier')
    .walkTo(9.6, -2.9).jumpTo(12.1, -2.9).expectSignal('lamp0', true)        // up onto the ledge, light it
    .walkTo(10, -2.4).walkTo(14, 0.4).walkTo(23.5, 1.3);
  spark(r)
    .walkTo(23.5, 3.0)                                                       // through the pinhole
    .walkTo(25.3, 3.0).expectSignal('lamp1', true)                           // the second lantern
    .walkTo(23.5, 3.0).walkTo(23.5, 1.0).walkTo(30.2, -1.0);
  ride(r, 30.2, -2.2, 'the climb')                                           // up the cabinet
    .walkTo(34.7, -2.3).expectSignal('lamp2', true)                          // the third lantern
    .walkTo(33.4, -2.3, { stuck: 0 });
  r.waitUntil((s, p) => p.ride, { toward: [33.4, -2.3], timeout: 3, label: 'rides down' })
    .waitUntil((s, p) => !p.ride, { timeout: 6, label: 'down' });
  // the fourth lantern: climb the first tower as an ember, ride the wire to the second as a spark
  ember(r).walkTo(31, 0.4).walkTo(38.6, 0.4).walkTo(38.6, -2.3).jumpTo(41.4, -2.3, { tol: 0.4 });
  spark(r).walkTo(41.4, -2.3, { stuck: 0 });
  r.waitUntil((s, p) => p.ride, { toward: [41.4, -2.3], timeout: 3, label: 'the tower wire' })
    .waitUntil((s, p) => !p.ride, { timeout: 8, label: 'on the second tower' })
    .walkTo(47.8, -2.3).expectSignal('lamp3', true)
    .walkTo(48.4, -1.4);
  ember(r).walkTo(50, 0)
    .waitUntil((s) => door(s, 'door1').open >= 1, { toward: [50.6, 0], timeout: 5, label: 'the big door is open' })
    .walkTo(O.rail + 0.4, 0);
}

// ------------------------------------------------------------------ 2. the Rail
export function rail(r, pier) {
  r.walkTo(R(3), 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier')
    .walkTo(R(5.6), pier ? -2.7 : 0);
  spark(r);
  if (pier) {
    ride(r, R(7.2), -2.7, 'pier wire')
      .walkTo(R(12.3), -2.7).expectShards(2)
      .walkTo(R(11.2), -2.7, { stuck: 0 });                    // the far post sends it home
    r.waitUntil((s, p) => p.ride, { toward: [R(11.2), -2.7], timeout: 3, label: 'rides home' })
      .waitUntil((s, p) => !p.ride, { timeout: 6, label: 'home' })
      .walkTo(R(5.8), 0);
  }
  ride(r, R(7.2), 0, 'rail');
  r.expect((s, p) => p.x > R(18.5) && s.deaths === 0, 'across the first chasm');
  // the landing: sit on the socket, step on the lift, ride it up as an ember
  r.walkTo(R(20.2), -2.2).waitUntil((s) => s.signals.get('sockL'), { timeout: 1, label: 'lift socket powered' })
    .walkTo(R(22), 0.0).walkTo(R(22.7), 2.0);
  ember(r)
    .waitUntil((s, p) => p.y > 5.9, { timeout: 8, label: 'lift reaches the gantry' })
    .walkTo(R(27), 2).expect((s) => s.checkpoint.id === 'b2g', 'gantry brazier')
    .wait(0.15);
  spark(r).walkTo(R(37), 2, { stuck: 0 });
  r.waitUntil((s, p) => p.ride, { toward: [R(37), 2], timeout: 3, label: 'gantry wire' })
    .waitUntil((s, p) => !p.ride, { timeout: 6, label: 'lands' })
    .expect((s, p) => p.x > R(41) && Math.abs(p.y) < 0.05 && s.deaths === 0, 'across the second chasm');
  // the third chasm: its rail is dull until the ledge lantern is lit (an ember jumps to it)
  ember(r).walkTo(R(43), 0).expect((s) => s.checkpoint.id === 'b2h', 'brazier before the dull rail')
    .walkTo(R(42), -2.9).jumpTo(R(45.1), -2.9).expectSignal('lampR', true)
    .walkTo(R(46.8), -2.4).walkTo(R(49.6), 0);
  spark(r).walkTo(R(50.4), 0, { stuck: 0 });
  ride(r, R(50.4), 0, 'the third rail');
  r.expect((s, p) => p.x > R(62) && s.deaths === 0, 'across the third chasm');
  ember(r).walkTo(O.cellar + 1, 0);
}

// ------------------------------------------------------------------ 3. the Cellar
export function cellar(r, cage) {
  r.walkTo(C(2.6), 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier');
  spark(r).walkTo(C(8.6), 0, { stuck: 0, tol: 0.3 })
    .waitUntil((s, p) => p.y < -3, { timeout: 3, label: 'drops through the grating' })
    .waitUntil((s, p) => p.grounded, { timeout: 2 })
    .expect((s) => s.checkpoint.id === 'b3c', 'the cellar brazier')
    .wait(0.15);
  // the long window first (the south socket), then the short one (the north socket)
  const sockets = () => {
    r.walkTo(C(6.4), 2.6)
      .waitUntil((s) => s.signals.get('sockW'), { timeout: 1, label: 'first socket powered' });
    r.walkTo(C(12.4), -2.0).walkTo(C(18.6), -2.0)
      .waitUntil((s) => s.signals.get('sockS'), { timeout: 1, label: 'second socket powered' });
    r.walkTo(C(12.4), -2.0).walkTo(C(12.4), 2.0).walkTo(C(15.2), 2.0).walkTo(C(16.6), 2.6)
      .waitUntil((s) => s.signals.get('sockN'), { timeout: 1, label: 'third socket powered' })
      .expect((s) => s.signals.get('cellarOpen'), 'all three windows are open');
  };
  sockets();
  if (cage) {
    // the stone first: run for the cage while the short window is open, then back to the brazier for heat
    r.walkTo(C(21), 2.0)
      .waitUntil((s) => door(s, 'cage').open >= 1, { toward: [C(23), 2.0], timeout: 2, label: 'cage open' })
      .walkTo(C(24.4), 2.0).expectShards(3)
      .walkTo(C(23.6), 2.8)                                    // a lump of coal in the cage
      .walkTo(C(21), 2.0).walkTo(C(12.4), 2.0).walkTo(C(9.6), 0.6).walkTo(C(8.6), 0.2)
      .wait(0.25);
    spark(r);
    sockets();                                                 // and the real run
  }
  r.walkTo(C(19.6), 1.0, { stuck: 0 });
  r.waitUntil((s, p) => p.ride, { toward: [C(19.6), 1.0], timeout: 3, label: 'up the wire' })
    .waitUntil((s, p) => !p.ride, { timeout: 4, label: 'out of the floor' })
    .walkTo(C(23), 0.4).walkTo(C(28.6), 0, { slow: false })
    .expect((s, p) => p.x > C(28.1) && s.deaths === 0, 'through the hall door before it shut');
  ember(r);
}

// ------------------------------------------------------------------ 4. the Gallery
export function gallery(r) {
  r.walkTo(G(2), 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier')
    .walkTo(G(5.5), 0);
  afterDrop(r, 'd1').walkTo(G(7.75), 0);
  afterDrop(r, 'd2').walkTo(G(10.25), 0);
  afterDrop(r, 'd3').walkTo(G(12.75), 0);
  afterDrop(r, 'd4').walkTo(G(15.25), 0);
  afterDrop(r, 'd5').walkTo(G(20), 0)
    .expect((s) => s.deaths === 0, 'across the causeway, dry');
  // light the fuse far from the tunnel, walk to the tunnel mouth, go in when the valve shuts
  r.walkTo(G(27.2), -3.0)
    .expect((s) => by(s.level.fuses, 'fuseV').state === 1, 'valve fuse burning')
    .walkTo(G(20.3), -0.4).walkTo(G(20.3), 3.0, { slow: false })
    .waitUntil((s) => !by(s.level.sprinklers, 'tunnel').wet, { timeout: 6, label: 'valve shut' })
    .walkTo(G(25.4), 3.0, { slow: false }).expectSignal('lampG', true)
    .walkTo(G(20.2), 3.0, { slow: false }).walkTo(G(20.2), 1.0)
    .expect((s) => s.deaths === 0, 'out of the tunnel before the spray came back');
  // the crawlspace: wait for the spray as an ember, turn spark just before it lets up, dash in, light it, dash out
  const crawl = (s) => by(s.level.sprinklers, 'crawlSpray');
  r.walkTo(G(28.4), -3.0)
    .waitUntil((s) => crawl(s).wet, { timeout: 8, label: 'the crawl spray is on' })
    .waitUntil((s) => crawl(s).clock > crawl(s).period * crawl(s).duty - 0.3, { timeout: 5, label: 'nearly dry' });
  spark(r)
    .waitUntil((s) => !crawl(s).wet, { timeout: 2, label: 'the crawl spray lets up' })
    .walkTo(G(38.6), -3.0, { slow: false }).expectSignal('lampH', true)
    .walkTo(G(28.6), -3.0, { slow: false }).expect((s) => s.deaths === 0, 'out of the crawlspace before the spray came back');
  // the dull post does nothing; the live one rides to the island
  r.walkTo(G(31.2), 2.9).walkTo(G(27), 0.6);                    // (the coal on the way refuels a spark that has dashed)
  r.walkTo(G(22.4), -0.6);
  ride(r, G(21.4), -1.6, 'wire A')
    .walkTo(G(50.4), 0).waitUntil((s) => s.signals.get('sockM'), { timeout: 1, label: 'island socket' })
    .wait(0.1)
    .waitUntil((s, p) => p.ride, { toward: [G(48), 0], timeout: 3, label: 'rides home' })
    .waitUntil((s, p) => !p.ride, { timeout: 6, label: 'home' })
    .walkTo(G(22.6), -0.6);
  ride(r, G(21.4), 0.2, 'wire B');
  r.expect((s, p) => p.x > G(56) && s.deaths === 0, 'across the pool');
}

// ------------------------------------------------------------------ 5. the Kiln Door
export function kilnDoor(r) {
  r.walkTo(K(0.6), 0.2).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier')
    .wait(0.2);
  spark(r)
    .walkTo(K(3.5), -2.5).waitUntil((s) => s.signals.get('sock1'), { timeout: 1, label: 'first socket' });
  // wait for the spray as an ember (a spark burns heat while it waits), turn spark just before it lets up
  const gauntlet = (s) => by(s.level.sprinklers, 'gauntlet');
  ember(r).walkTo(K(11.6), 0)
    .waitUntil((s) => gauntlet(s).wet, { timeout: 6, label: 'the spray is on' })
    .waitUntil((s) => gauntlet(s).clock > gauntlet(s).period * gauntlet(s).duty - 0.3, { timeout: 4, label: 'nearly dry' });
  spark(r)
    .waitUntil((s) => !gauntlet(s).wet, { timeout: 2, label: 'the spray lets up' })
    .walkTo(K(29.6), 0, { slow: false, stuck: 0 }).expect((s) => s.deaths === 0, 'through the pulsing spray, dry');
  r.waitUntil((s, p) => p.ride, { toward: [K(29.6), 0], timeout: 3, label: 'over the first pool' })
    .waitUntil((s) => s.signals.get('sock2'), { timeout: 8, label: 'second socket powered' });
  // the second gauntlet is on its own beat: wait as an ember (picking up the coal on the way), spark just before it lets up
  const gauntlet2 = (s) => by(s.level.sprinklers, 'gauntlet2');
  ember(r).walkTo(K(47.4), 2.3).walkTo(K(49.6), 0)
    .waitUntil((s) => gauntlet2(s).wet, { timeout: 7, label: 'the second spray is on' })
    .waitUntil((s) => gauntlet2(s).clock > gauntlet2(s).period * gauntlet2(s).duty - 0.3, { timeout: 5, label: 'nearly dry' });
  spark(r)
    .waitUntil((s) => !gauntlet2(s).wet, { timeout: 2, label: 'the second spray lets up' })
    .walkTo(K(66.6), 0, { slow: false, stuck: 0 }).expect((s) => s.deaths === 0, 'through the second spray, dry');
  r.waitUntil((s, p) => p.ride, { toward: [K(66.6), 0], timeout: 3, label: 'over the second pool' })
    .waitUntil((s) => s.signals.get('sock3'), { timeout: 8, label: 'third socket powered' })
    .expect((s) => s.signals.get('h1') && s.signals.get('h2') && s.signals.get('h3'), 'all three windows are open')
    .walkTo(K(100.4), 0, { slow: false, stuck: 0 }).expectExit();
}

export function solve(r) {
  switchroom(r);
  rail(r, false);
  cellar(r, false);
  gallery(r);
  kilnDoor(r);
}

export function solveAll(r) {
  r.walkTo(3, 0).walkTo(6.6, 2.4).expectShards(1).walkTo(5, 0);
  switchroom(r);
  rail(r, true);
  cellar(r, true);
  gallery(r);
  kilnDoor(r);
}
