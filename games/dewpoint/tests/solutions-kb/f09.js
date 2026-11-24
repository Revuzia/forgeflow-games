// Keyboard solution for f09 "Brass Rail": W/A/S/D, Space, 1 (ember) and 4 (spark) and human timing only (tests/lib/keyboard.js).
// Camera never turns (camYaw -90: W is +x, D is +z). A spark is fast (9.5 m/s) and a key cannot slow it down: lining one up
// is done with taps that move it about 1.4 m each, and with walls to run along.
import { O } from '../../src/levels/f09.js';
import { by, leap, go, touch, hop, hopTap, hopFrom, attempt, afterDrop, form, section, sitOn } from './fire-moves.js';

const door = (s, id) => by(s.level.doors, id);
const drip = (s, id) => by(s.level.drips, id);
const lamp = (s, id) => by(s.level.lanterns, id);
const R = (x) => O.rail + x, C = (x) => O.cellar + x, G = (x) => O.gallery + x, K = (x) => O.kiln + x;
const spark = (k) => form(k, 'spark');
const ember = (k) => form(k, 'ember');

/** Walk a spark onto a terminal that has a wire and wait for the ride to start and finish. */
function ride(k, x, z, label) {
  touch(k, x, z, (s, p) => p || true, { label: 'at the post', tries: 1 });
  k.until((s, p) => p.ride || p.x > x + 3, { timeout: 4, label: `${label}: onto the wire` });
  return k.until((s, p) => !p.ride, { timeout: 8, label: `${label}: arrives` });
}

/** Stand on a terminal (a socket) with a spark: line up on it and wait a moment. */
function sit(k, x, z, sig) {
  return sitOn(k, x, z, (s) => s.signals.get(sig), { label: `${sig} powered` });
}

/** Walk onto a lump of coal at (x, z) and look whether it was taken; step closer if not. */
function grab(k, x, z, tol = 0.45) {
  const taken = (s) => { const c = s.level.coals.find((q) => Math.hypot(q.pos[0] - x, q.pos[2] - z) < 0.3); return !c || c.taken || k.p.gauge >= 9.9; };
  return touch(k, x, z, taken, { tol, tries: 4, label: `the coal at ${x}` });
}

/** Through a cellar pinhole: stand in the middle of the room by the partition, slide to the stop beside the hole (key `side`), then go through. */
function throughPinhole(k, x, side, zStop, label) {
  go(k, x, 0, 0.6);
  k.hold(side, { until: (s, p) => (zStop < 0 ? p.z < zStop : p.z > zStop), timeout: 3, label: `${label} pinhole: along the partition to the stop` });
  k.hold('W', { until: (s, p) => p.x > x + 3, timeout: 3, label: `${label} pinhole: through` }).release();
}

function switchroom(k) {
  go(k, 3, 0).expect((s) => s.checkpoint && s.checkpoint.id === 'b1', 'first brazier');
  go(k, 9.6, -2.9, 1.0, { order: 'zx' });
  hop(k, 'W', { run: 0.15, hold: 0.3 });                                   // up onto the ledge
  touch(k, 12.1, -2.9, (s) => lamp(s, 'lamp0').lit, { label: 'lantern 0' });
  go(k, 14, 0.4, 1.0, { order: 'zx' });
  go(k, 22.0, 1.3, 1.0);
  spark(k);
  // the pinhole in the partition at x 23.5 is 0.45 m wide (a spark is 0.28 m across): a stop beside it lines the spark up
  k.hold('D', { until: (s, p) => p.z > 1.6, timeout: 3, label: 'up to the partition' });
  k.hold('W D', { until: (s, p) => p.x > 23.4, timeout: 3, label: 'along the partition to the stop' });
  k.hold('D', { until: (s, p) => p.z > 2.6, timeout: 3, label: 'through the pinhole' }).release();
  k.expect((s, p) => p.z > 2.4, 'through the pinhole');
  k.hold('D', { until: (s, p) => p.z > 3.4, timeout: 3, label: 'along the far wall of the alcove' });
  k.hold('W', { until: (s, p) => p.x > 25.2, timeout: 3, label: 'to the lantern, over a lump of coal' });
  k.expectSignal('lamp1', true);
  k.hold('A', { until: (s, p) => p.z < 2.6, timeout: 3, label: 'up to the partition, east of the stop' });
  k.hold('S', { until: (s, p) => p.x < 23.5, timeout: 3, label: 'along the inside of the partition to the stop' });
  k.hold('A', { until: (s, p) => p.z < 1.1, timeout: 3, label: 'back out through the pinhole' }).release();
  ember(k);                                                                // a spark burns heat while it walks: walk as a coal
  grab(k, 28.9, -1.4);                                                    // a lump of coal at the foot of the climb
  spark(k);
  sitOn(k, 30.2, -2.2, (s, p) => p.ride || p.y > 1.5, { label: 'the climb' });          // up the cabinet
  k.until((s, p) => !p.ride, { timeout: 8 });
  go(k, 34.7, -2.3, 1.0, { fine: 0 });
  k.expectSignal('lamp2', true);
  sitOn(k, 33.4, -2.3, (s, p) => p.ride || p.y < 1.5, { label: 'rides down' });
  k.until((s, p) => !p.ride, { timeout: 8, label: 'down' });
  // the fourth lantern: climb the first tower as an ember, ride the wire to the second as a spark
  ember(k);
  go(k, 31, 0.4, 1.0);
  go(k, 38.6, 0.4, 1.0);
  go(k, 38.6, -2.3, 1.0, { order: 'zx' });
  hop(k, 'W', { run: 0.15, hold: 0.3 });
  spark(k);
  sitOn(k, 41.4, -2.3, (s, p) => p.ride || p.x > 44, { label: 'the tower wire' });
  k.until((s, p) => !p.ride, { timeout: 10, label: 'on the second tower' });
  go(k, 47.8, -2.3, 1.0, { fine: 0 });
  k.expectSignal('lamp3', true);
  ember(k);
  go(k, 50, 0, 1.0, { order: 'zx' });
  k.until((s) => door(s, 'door1').open >= 1, { timeout: 8, label: 'the big door is open' });
  go(k, O.rail + 0.4, 0, 1.0);
}

function rail(k) {
  go(k, R(3), 0).expect((s) => s.checkpoint.id === 'b2', 'second brazier');
  go(k, R(5.6), 0, 1.0);
  spark(k);
  sitOn(k, R(7.2), 0, (s, p) => p.ride || p.x > R(18), { label: 'the rail' });
  k.until((s, p) => !p.ride, { timeout: 10, label: 'across the first chasm' });
  k.expect((s, p) => p.x > R(18.5) && s.deaths === (k.retries || 0), 'across the first chasm');
  grab(k, R(20.4), -0.8);                                                  // the lump of coal on the way to the socket
  sitOn(k, R(20.2), -2.2, (s) => s.signals.get('lifting'), { label: 'lift socket powered' });
  // the lift starts a second after the socket is powered: straight across to it, then stop on it
  go(k, R(22.7), 2.0, 0.6, { fine: 0.45 });
  ember(k);
  k.until((s, p) => p.y > 5.9, { timeout: 8, label: 'lift reaches the gantry' });
  go(k, R(27), 2, 1.0).expect((s) => s.checkpoint.id === 'b2g', 'gantry brazier');
  k.wait(0.15);
  spark(k);
  sitOn(k, R(37), 2, (s, p) => p.ride || p.x > R(41), { label: 'gantry wire' });
  k.until((s, p) => !p.ride, { timeout: 8, label: 'lands' });
  k.expect((s, p) => p.x > R(41) && Math.abs(p.y) < 0.1 && s.deaths === (k.retries || 0), 'across the second chasm');
  ember(k);
  go(k, R(43), 0).expect((s) => s.checkpoint.id === 'b2h', 'brazier before the dull rail');
  go(k, R(42), -2.9, 1.0, { order: 'zx' });
  hop(k, 'W', { run: 0.15, hold: 0.3 });
  k.expectSignal('lampR', true);
  go(k, R(46.8), -2.4, 1.0);
  go(k, R(49.6), 0, 1.0, { order: 'zx' });
  spark(k);
  sitOn(k, R(50.4), 0, (s, p) => p.ride || p.x > R(62), { label: 'the third rail' });
  k.until((s, p) => !p.ride, { timeout: 10, label: 'across the third chasm' });
  k.expect((s, p) => p.x > R(62) && s.deaths === (k.retries || 0), 'across the third chasm');
  ember(k);
  go(k, O.cellar + 1, 0, 1.0);
}

function cellar(k) {
  go(k, C(2.6), 0).expect((s) => s.checkpoint.id === 'b3', 'third brazier');
  spark(k);
  go(k, C(8.6), 0, 1.0, { fine: 0 });
  k.until((s, p) => p.y < -3, { timeout: 4, label: 'drops through the grating' }).until((s, p) => p.grounded, { timeout: 3 });
  k.expect((s) => s.checkpoint.id === 'b3c', 'the cellar brazier');
  k.wait(0.15);
  // the long window first, then the south one, then the short one (north)
  sit(k, C(6.4), 2.6, 'win0');
  go(k, C(9.0), 0, 0.6);                                                   // the brazier: a full gauge again, for free
  throughPinhole(k, C(13.0), 'A', -1.95, 'south');
  sit(k, C(18.6), -2.0, 'win1');
  k.hold('S', { until: (s, p) => p.x < C(12.2), timeout: 3, label: 'back through the south pinhole' }).release();
  go(k, C(9.0), 0, 0.6);
  throughPinhole(k, C(13.0), 'D', 1.95, 'north');
  sit(k, C(16.6), 2.6, 'win2');
  k.expect((s) => s.signals.get('cellarOpen'), 'all three windows are open');
  sitOn(k, C(19.6), 1.0, (s, p) => p.ride || p.y > -1, { label: 'up the wire' });
  k.until((s, p) => !p.ride, { timeout: 6, label: 'out of the floor' });
  go(k, C(23), 0.4, 1.0);
  k.hold('W', { until: (s, p) => p.x > C(28.6), timeout: 4, label: 'through the hall door before it shut' }).release();
  k.expect((s, p) => p.x > C(28.1) && s.deaths === (k.retries || 0), 'through the hall door before it shut');
  ember(k);
}

function gallery(k) {
  go(k, G(2), 0).expect((s) => s.checkpoint.id === 'b4', 'fourth brazier');
  go(k, G(5.5), 0, 1.0, { order: 'zx' });
  afterDrop(k, 'd1'); go(k, G(7.75), 0, 1.0, { fine: 0 });
  afterDrop(k, 'd2'); go(k, G(10.25), 0, 1.0, { fine: 0 });
  afterDrop(k, 'd3'); go(k, G(12.75), 0, 1.0, { fine: 0 });
  afterDrop(k, 'd4'); go(k, G(15.25), 0, 1.0, { fine: 0 });
  afterDrop(k, 'd5'); go(k, G(20), 0, 1.0, { fine: 0 });
  k.expect((s) => s.deaths === (k.retries || 0), 'across the causeway, dry');
  // light the valve fuse far from the tunnel, walk to the tunnel mouth, go in when the valve shuts
  touch(k, G(27.4), -3.1, (s) => by(s.level.fuses, 'fuseV').state >= 1, { label: 'valve fuse burning', order: 'xz', tol: 0.45, tries: 4 });
  go(k, G(19.4), -0.4, 0.6, { order: 'zx' });
  go(k, G(19.4), 3.1, 0.6, { order: 'zx', fine: 0 });                      // beside the tunnel mouth (the wall over it starts at x 20.6)
  k.until((s) => !by(s.level.sprinklers, 'tunnel').wet, { timeout: 8, label: 'valve shut' });
  k.hold('W', { until: (s) => s.signals.get('lampG'), timeout: 3, label: 'in to the lantern' }).release();
  go(k, G(19.9), 3.1, 0.5, { order: 'xz' });                               // out of the tunnel, and not off the end of the landing (a tank lies west of x 19)
  k.hold('A', { until: (s, p) => p.z < 1.4, timeout: 3 }).release();
  k.expect((s) => s.deaths === (k.retries || 0), 'out of the tunnel before the spray came back');
  // the crawlspace: wait for the spray as an ember, turn spark just before it lets up, dash in, light it, dash out
  const crawl = (s) => by(s.level.sprinklers, 'crawlSpray');
  go(k, G(28.4), -3.0, 1.0, { order: 'xz' });
  k.until((s) => crawl(s).wet, { timeout: 10, label: 'the crawl spray is on' })
    .until((s) => crawl(s).clock > crawl(s).period * crawl(s).duty - 0.3, { timeout: 6, label: 'nearly dry' });
  spark(k);
  k.until((s) => !crawl(s).wet, { timeout: 3, label: 'the crawl spray lets up' });
  k.hold('W', { until: (s) => s.signals.get('lampH'), timeout: 4, label: 'dash in to the lantern' }).release();
  k.hold('S', { until: (s, p) => p.x < G(28.6), timeout: 4, label: 'dash out' }).release();
  k.expect((s) => s.deaths === (k.retries || 0), 'out of the crawlspace before the spray came back');
  // an ember needs room: if there is none where the dash ended (by the pipe), step a little east and look again
  for (let i = 0; i < 4 && k.p.form === 'spark'; i++) {
    try { ember(k); } catch (e) { if (i === 3 || k.sim.deaths) throw e; k.tap('W', 0.15); k.wait(0.1); }
  }
  // the dull post does nothing; the live one rides to the island
  go(k, G(28.6), -1.2, 0.6, { order: 'xz' });                              // out from under the crawlspace's side, then across to the coal
  go(k, G(31.0), 2.3, 0.6, { order: 'xz' });
  grab(k, G(31.2), 2.8);                                                  // the coal
  go(k, G(22.4), -0.6, 1.0, { order: 'zx' });
  spark(k);
  sitOn(k, G(21.4), -1.6, (s, p) => p.ride || p.x > G(26), { label: 'wire A' });
  k.until((s, p) => !p.ride, { timeout: 10 });
  go(k, G(50.4), 0, 0.8, { fine: 0 });
  k.until((s) => s.signals.get('sockM'), { timeout: 2, label: 'island socket' });
  k.wait(0.1);
  sitOn(k, G(48), 0, (s, p) => p.ride || p.x < G(46), { label: 'rides home' });
  k.until((s, p) => !p.ride, { timeout: 10 });
  ember(k);
  go(k, G(22.6), -0.6, 1.0);
  spark(k);
  sitOn(k, G(21.4), 0.2, (s, p) => p.ride || p.x > G(26), { label: 'wire B' });
  k.until((s, p) => !p.ride, { timeout: 10 });
  k.expect((s, p) => p.x > G(56) && s.deaths === (k.retries || 0), 'across the pool');
}

function kilnDoor(k) {
  go(k, K(0.6), 0.2).expect((s) => s.checkpoint.id === 'b5', 'fifth brazier');
  k.wait(0.2);
  spark(k);
  go(k, K(3.5), -2.5, 0.8, { fine: 0 });
  sitOn(k, K(3.5), -2.5, (s) => s.signals.get('h1'), { label: 'first socket' });
  const gauntlet = (s) => by(s.level.sprinklers, 'gauntlet');
  ember(k);
  go(k, K(11.4), 0, 0.6, { order: 'zx' });
  k.until((s) => gauntlet(s).wet, { timeout: 7, label: 'the spray is on' })
    .until((s) => gauntlet(s).clock > gauntlet(s).period * gauntlet(s).duty - 0.3, { timeout: 5, label: 'nearly dry' });
  spark(k);
  k.until((s) => !gauntlet(s).wet, { timeout: 3, label: 'the spray lets up' });
  k.hold('W', { until: (s, p) => p.x > K(29.0) || p.ride, timeout: 4, label: 'through the pulsing spray' });
  k.release();
  sitOn(k, K(29.6), 0, (s, p) => p.ride || p.x > K(33), { label: 'over the first pool' });
  k.until((s, p) => !p.ride, { timeout: 10 }).until((s) => s.signals.get('sock2'), { timeout: 8, label: 'second socket powered' });
  const gauntlet2 = (s) => by(s.level.sprinklers, 'gauntlet2');
  ember(k);
  go(k, K(47.4), 2.3, 1.0);
  go(k, K(49.6), 0, 0.6, { order: 'zx' });
  k.until((s) => gauntlet2(s).wet, { timeout: 8, label: 'the second spray is on' })
    .until((s) => gauntlet2(s).clock > gauntlet2(s).period * gauntlet2(s).duty - 0.3, { timeout: 6, label: 'nearly dry' });
  spark(k);
  k.until((s) => !gauntlet2(s).wet, { timeout: 3, label: 'the second spray lets up' });
  k.hold('W', { until: (s, p) => p.x > K(66.0) || p.ride, timeout: 4, label: 'through the second spray' });
  k.release();
  sitOn(k, K(66.6), 0, (s, p) => p.ride || p.x > K(70), { label: 'over the second pool' });
  k.until((s, p) => !p.ride, { timeout: 10 }).until((s) => s.signals.get('sock3'), { timeout: 8, label: 'third socket powered' });
  k.expect((s) => s.signals.get('h1') && s.signals.get('h2') && s.signals.get('h3'), 'all three windows are open');
  go(k, K(100.4), 0, 0.8, { fine: 0 });
  k.expectExit();
}

export function solve(k) {
  switchroom(k);
  rail(k);
  cellar(k);
  gallery(k);
  kilnDoor(k);
}
