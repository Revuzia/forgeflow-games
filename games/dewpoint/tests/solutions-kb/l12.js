// Keyboard solution for l12 "The Great Kiln". Headings (camYaw -90): +x = W, -x = S, -z = A, +z = D.

import { X, Y } from '../../src/levels/l12.js';

const full = (s, p) => p.gauge >= 3.99;
const pane = (s, id) => s.level.panes.find((q) => q.id === id);
const fire = (s, id) => s.level.fires.find((q) => q.id === id);
const mover = (s, id) => s.level.movers.find((q) => q.id === id);
const crate = (s, i = 0) => s.level.crates[i].body;
const plateOf = (s, id) => s.level.plates.find((q) => q.id === id);

const AREAS = [
  // 1. The Stokehole: the crate crosses the pit on the ferry, holds the heavy plate; liquid douses the bars, film closes the circuits
  (k) => {
    k.goTo(3, 0).goTo(4.8, 0, { tol: 0.45 }).form('ice')
      .hold('+x', { until: (s) => crate(s).x >= 9.6, timeout: 6, label: 'crate pushed onto the ferry' })
      .stopNow()
      .until((s) => mover(s, 'ferry1').t >= 1, { timeout: 14, label: 'the ferry is across' })
      .hold('+x', { until: (s) => s.signals.get('wp'), timeout: 14, label: 'crate pushed onto the heavy plate' })
      .stopNow()
      .expect((s) => Math.abs(crate(s).x - 23) < 1.5, 'the crate is on the heavy plate')
      .form('liquid')
      .goTo(20.6, 1.6, { order: 'zx' }).goTo(24.6, 1.6).goTo(26.0, 0.6)
      .until((s) => s.level.doors[0].open >= 1, { timeout: 4, label: 'the first door is held open' })
      .goTo(30, 0).goTo(34.0, 0)
      .hold('+x', { until: (s) => s.level.embers[0].doused, timeout: 5, label: 'the ember bar is out' })
      .release().settle()
      .form('film').goTo(37.6, 0).goTo(40, 0)
      .expectSignal('arc', true)
      .goTo(41.8, 0).form('liquid')
      .goTo(42.0, 0)
      .hold('+x', { until: (s) => s.level.embers[1].doused, timeout: 5, label: 'the second ember bar is out' })
      .release().settle()
      .form('film').goTo(46, 0).goTo(48, 0)
      .expectSignal('arc2', true)
      .wait(0.1).expect((s) => s.signals.get('burnA') && fire(s, 'burnerA').active, 'burner A is alight')
      .goTo(49.4, 0).form('liquid')
      .goTo(49.9, 0)
      .until((s) => s.level.doors[1].open >= 1, { timeout: 4, label: 'the second door opens' })
      .goTo(X.culvert + 1.5, 0);
  },
  // 2. The Culvert: film through the grille, ride the covered channel, surface in the pool, ice under the curtains of flame; steam up the shaft, up the bud
  (k) => {
    const x = X.culvert;
    k.goTo(x + 3, 0).goTo(x + 15.4, 0).form('film')
      .until((s, p) => p.floating, { timeout: 4, label: 'dropped through the grille into the water' })
      .hold('+x', { until: (s, p) => p.x > x + 32.6, timeout: 16, label: 'carried under the wall' })
      .expect((s, p) => p.form === 'film', 'still film in the channel')
      .form('liquid')
      .hold('+x', { until: (s) => s.signals.get('burnB'), timeout: 8, label: 'afloat in the pool: burner B catches' })
      .release()
      .wait(0.1).expect((s) => fire(s, 'burnerB').active, 'burner B is alight')
      .form('ice')
      .until((s, p) => p.grounded && p.y < -3.2, { timeout: 6, label: 'sunk to the floor of the pool' })
      .hold('+x', { until: (s, p) => p.x > x + 56.4, timeout: 40, label: 'beneath the curtains of flame' })
      .stopNow()
      .form('liquid')
      .until((s, p) => p.floating, { timeout: 4, label: 'floated up in the second pool' })
      .hold('+x', { until: (s, p) => p.x > x + 61.2, timeout: 10, label: 'at the far bank' })
      .hop('+x', { tap: 0.3 }).land().settle()
      .expect((s, p) => Math.abs(p.y) < 1e-6, 'out of the water')
      .goTo(x + 64.4, 0)
      .goTo(x + 69.4, 0)
      .until(full, { timeout: 4 })
      .form('steam')
      .hold('+x', { until: (s, p) => p.x > x + 71.2, timeout: 4, label: 'into the shaft' })
      .release()
      .until((s, p) => p.y > Y.lid + 0.3, { timeout: 8, label: 'up through the lid' })
      .form('liquid').land().settle()
      .expect((s, p) => Math.abs(p.y - Y.lid) < 1e-6, 'on the lid')
      .goTo(x + 76.6, 0, { tol: 0.45 })
      .until((s) => s.level.sprouts[0].state === 2, { timeout: 4, label: 'bud grown' });
    for (let i = 0; i < 6; i++) k.jump({ hold: 0.45 }).land().settle();
    k.expect((s, p) => Math.abs(p.y - Y.well) < 1e-6, 'on the top leaf')
      .goTo(X.well + 1.5, 0);
  },
  // 3. The Cold Well: the ferry; the frost lets Mote shove crates onto the door plates; then the well freezes Mote, ice sinks onto the heavy plate, a drop floats up
  (k) => {
    const x = X.well, y = Y.well;
    const cV = (i) => crate(k.sim, i);
    k.goTo(x + 2.4, 0).goTo(x + 4.9, 0, { tol: 0.42 }).tap('+x', 0.5).settle()      // one measured tap onto the deck
      .until((s) => mover(s, 'ferry2').t >= 1, { timeout: 16, label: 'the ferry is across' })
      .tap('+x', 0.5).settle({ timeout: 14 })
      .goTo(x + 23.4, 0)
      .expect((s, p) => p.form === 'ice', 'the frost keeps Mote ice on the landing')
      .goTo(x + 23.6, 0, { order: 'xz', tol: 0.45 }).goTo(x + 23.6, cV(1).z, { tol: 0.4 })
      .hold('+x', { until: (s) => Math.abs(crate(s, 1).x - (x + 34)) < 0.9 || crate(s, 1).x > x + 34.5, timeout: 16, label: 'crate pushed onto the first door plate' })
      .stopNow()
      .expect((s) => Math.abs(crate(s, 1).x - (x + 34)) < 1.6, 'the first crate is on its plate')
      .goTo(x + 30, 0.4, { order: 'zx' }).goTo(x + 23.6, 0.4, { tol: 0.45, order: 'xz' }).goTo(x + 23.6, cV(2).z - 0.3, { tol: 0.4 })
      .hold('+x', { until: (s) => Math.abs(crate(s, 2).x - (x + 34)) < 0.9 || crate(s, 2).x > x + 34.5, timeout: 16, label: 'second crate pushed onto the second plate' })
      .stopNow()
      .expect((s) => Math.abs(crate(s, 2).x - (x + 34)) < 1.6, 'the second crate is on its plate')
      .goTo(x + 30, 0.2, { order: 'zx' }).goTo(x + 36.2, 0.2)
      .until((s) => s.level.doors[0].open >= 1, { timeout: 4, label: 'the landing door is held open' })
      .goTo(x + 40.4, 0).goTo(x + 43.6, 0);
    // nudge off the edge with short taps so Mote drops in slowly (a run would carry it clean over the plate)
    for (let i = 0; i < 10 && k.p.y > y - 0.5; i++) k.tap('+x', 0.15).settle({ timeout: 14 });
    k.until((s, p) => p.grounded && p.y < y - 4, { timeout: 10, label: 'sunk to the bottom of the well' })
      .settle({ timeout: 14 })
      .goTo(x + 47.75, 0, { tol: 0.5 })
      .expectSignal('plateC', true)
      .expectSignal('burnC', true)
      .expect((s) => !s.level.zones.find((q) => q.id === 'cold').active, 'the frost is off')
      .form('liquid')
      .until((s, p) => p.floating && p.y > y - 1, { timeout: 6, label: 'floated to the top' })
      .hold('+x', { until: (s, p) => p.x > x + 49.8, timeout: 8, label: 'across' })
      .hop('+x', { tap: 0.3 }).land().settle()
      .expect((s, p) => Math.abs(p.y - y) < 1e-6, 'out of the well')
      .expect((s) => fire(s, 'burnerC').active, 'burner C is alight')
      .goTo(x + 54, 0).goTo(x + 67, 0).goTo(X.gale + 1.5, 0);
  },
  // 4. The Gale Gallery: ice shoves the crate through the first gale onto the plate in the nook, then smashes the glass at the end of the second
  (k) => {
    const x = X.gale;
    const c = () => crate(k.sim, 3);
    k.goTo(x + 2.4, 0).goTo(x + 3.2, 0).form('ice').goTo(x + 4.0, 0, { tol: 0.4 })
      .hold('+x', { until: (s) => s.signals.get('hpN') && Math.abs(crate(s, 3).x - c().x) < 9 && crate(s, 3).x > x + 20, timeout: 16, label: 'crate pushed through the gale onto the plate' })
      .stopNow()
      .expect((s) => s.level.fans[0].active, 'the gale is blowing')
      .goTo(c().x - 1.6, 1.3, { order: 'zx' }).goTo(c().x + 1.6, 1.3).goTo(x + 24.6, 0.3)
      .until((s) => s.level.doors[0].open >= 1, { timeout: 4, label: 'the nook shutter is held open' })
      .hold('+x', { until: (s) => pane(s, 'paneG').broken, timeout: 14, label: 'the glass at the end of the second gale is smashed' })
      .stopNow({ timeout: 10 })
      .form('liquid')
      .goTo(x + 41, 0).goTo(X.throat + 1.5, 0);
  },
  // 5. The Throat: the chimney boils Mote and lifts it; each tray stops a cloud on one side, so cross to the open lane between trays
  (k) => {
    const x = X.throat, y = Y.throat;
    // lane i: [side of the open lane, feet y of the tray it must clear, feet y of the jet top below it]
    k.goTo(x + 6, 0).wait(0.1).goTo(x + 8.2, 1.6, { tol: 0.5 })
      .hold('+x', { until: (s, p) => p.form === 'steam', timeout: 4, label: 'the chimney boiled Mote' })
      .until((s, p) => p.x > x + 10.4, { timeout: 2 })
      .release();
    // jets at y + 4.8, 9.6, 14.4, 19.2, 24.0 (tops), trays 4.8 m apart, open lanes alternate: east (+z), west (-z), ...
    const lanes = [+1, -1, +1, -1, +1];
    for (let i = 1; i < lanes.length; i++) {
      const jetTop = y + 4.8 * i, toward = lanes[i] > 0 ? '+z' : '-z', z1 = lanes[i] * 1.0;
      k.until((s, p) => p.y > jetTop + 0.1, { timeout: 10, label: `past jet ${i}` })
        .hold(toward, { until: (s, p) => (lanes[i] > 0 ? p.z >= z1 - 0.5 : p.z <= z1 + 0.5), timeout: 3, label: `across to the open lane for tray ${i + 1}` })
        .release();
    }
    k.until((s, p) => p.y > y + 28.1, { timeout: 12, label: 'above the crown' })
      .hold('+x', { until: (s, p) => p.x > x + 16.2, timeout: 4, label: 'over the crown' })
      .form('liquid', { release: true }).land().settle()
      .expect((s, p) => Math.abs(p.y - Y.crown) < 1e-6 && p.x > X.crown, 'on the crown');
  },
  // 6a. The Pilot Light: a drop douses the embers, film closes the posts, a cloud trips the sensor, ice presses the plate
  (k) => {
    const x = X.crown;
    const embers = (s) => s.level.embers.find((e) => e.id === 'pilotEmbers');
    k.goTo(x + 1.8, 0).goTo(x + 5.6, 0)
      .hold('+x', { until: (s) => embers(s).doused, timeout: 4, label: 'the doorway of embers is out' })
      .release().settle()
      .goTo(x + 11.0, 0).form('film').goTo(x + 14.4, 0).goTo(x + 15.7, 0)
      .expectSignal('arcP', true)
      .goTo(x + 17.2, 0).form('liquid')
      .goTo(x + 18.8, -2.8, { tol: 0.5 })
      .until(full, { timeout: 4 })
      .form('steam')
      .hold('+x', { until: (s) => s.signals.get('steamP'), timeout: 8, label: 'the cloud trips the sensor above the ledge' })
      .release()
      .form('liquid').land().settle()
      .goTo(x + 25.6, -2.8)
      .goTo(x + 26.4, 0).form('ice').goTo(x + 28.6, 0, { tol: 0.45 })
      .expectSignal('hpP', true)
      .until((s) => s.signals.get('ignite'), { timeout: 3, label: 'the pilot light catches' })
      .wait(0.1)
      .expect((s) => s.level.doors[1].open > 0, 'the shutter lifts');
  },
  // 6b. The Plunge: the frost keeps Mote ice, the slope does the rest: two walls of glass and into the lit kiln
  (k) => {
    const x = X.crown;
    k.until((s) => s.level.doors[1].open >= 1, { timeout: 4, label: 'the shutter is open' })
      .hold('+x', { until: (s) => pane(s, 'glass1').broken, timeout: 16, label: 'first wall of glass smashed by the slide' })
      .until((s) => pane(s, 'glass2').broken, { timeout: 5, label: 'second wall of glass smashed' })
      .expectExit({ timeout: 6 });
  },
];

export const areas = AREAS;
export function solve(k) { for (const a of AREAS) a(k); }
