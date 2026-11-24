// Scripted solutions for l12 "The Great Kiln". Each area is a function so the level tests can replay a prefix.
// Coordinates are the area's own (see X and Y in src/levels/l12.js) plus the area's start.

import { X, Y } from '../../src/levels/l12.js';

export const landed = (s, p) => p.grounded;
export const full = (s, p) => p.gauge >= 3.99;
const pane = (s, id) => s.level.panes.find((q) => q.id === id);
const fire = (s, id) => s.level.fires.find((q) => q.id === id);
const mover = (s, id) => s.level.movers.find((q) => q.id === id);
const crate = (s) => s.level.crates[0].body;
const plateOf = (s, id) => s.level.plates.find((q) => q.id === id);

/** 1. The Stokehole: the crate crosses the pit on the ferry (ice shoves it on and off), holds the heavy plate; liquid douses the bar, film closes the circuit. */
export function stokehole(r, shard) {
  r.walkTo(3, 0).expect((s) => s.checkpoint !== null, 'checkpoint lit');
  if (shard) {
    // the perch: a cloud from the floor, over the ledge, condense on it, drop back down while the gauge refills
    r.walkTo(3.8, 1.6, { tol: 0.3 }).stop().waitUntil(full, { timeout: 3 })
      .form('steam')
      .waitUntil((s) => s.shardsTaken.length === 1, { toward: [6.2, 3.0], timeout: 6, label: 'the shard on the perch' })
      .form('liquid').waitUntil(landed, { timeout: 4 })
      .expect((s, p) => Math.abs(p.y - 4.2) < 1e-6, 'on the perch')
      .walkTo(4.0, 1.0, { stuck: 0 }).waitUntil(landed, { timeout: 3 });
  }
  r.walkTo(5.7, 0, { tol: 0.2 }).stop().form('ice')
    .waitUntil((s) => crate(s).x >= 10.0, { toward: [14, 0], timeout: 4, label: 'crate pushed onto the ferry' })
    .stop()
    .waitUntil((s) => mover(s, 'ferry1').t >= 1, { timeout: 12, label: 'the ferry is across' })
    .waitUntil((s) => s.signals.get('wp'), { toward: [30, 0], timeout: 12, label: 'crate pushed onto the heavy plate' })
    .stop()
    .expect((s) => s.level.plates[0].by === 'crate', 'the crate holds the plate')
    .form('liquid')
    .path([[20.6, 1.3], [24.6, 0.6]], { stuck: 0 })
    .waitUntil((s) => s.level.doors[0].open >= 1, { timeout: 2, label: 'the first door is held open' })
    .walkTo(30, 0).expect((s) => s.checkpoint.pos[0] === 30, 'stokehole checkpoint lit')
    .walkTo(34.6, 0)
    .waitUntil((s) => s.level.embers[0].doused, { mx: 1, timeout: 3, label: 'the ember bar is out' })
    .form('film').walkTo(37.6, 0).walkTo(40, 0)
    .expectSignal('arc', true)
    .walkTo(41.8, 0).form('liquid')
    .walkTo(42.6, 0)
    .waitUntil((s) => s.level.embers[1].doused, { mx: 1, timeout: 3, label: 'the second ember bar is out' })
    .form('film').walkTo(46, 0).walkTo(48, 0)
    .expectSignal('arc2', true)
    .wait(0.1).expect((s) => s.signals.get('burnA') && fire(s, 'burnerA').active, 'burner A is alight')
    .walkTo(49.4, 0).form('liquid')
    .walkTo(49.9, 0).waitUntil((s) => s.level.doors[1].open >= 1, { timeout: 2, label: 'the second door opens' })
    .walkTo(X.culvert + 1.5, 0);
}

/** 2. The Culvert: film through the grille, ride the covered channel, surface in the pool, then as ice under the curtains of flame; then steam up the shaft and up the bud. */
export function culvert(r, shard) {
  const x = X.culvert;
  r.walkTo(x + 3, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 3, 'checkpoint lit');
  if (shard) {
    // the shelf with the film-high gap: a long crawl in and out
    r.walkTo(x + 3.0, 2.8, { tol: 0.3 }).form('film').walkTo(x + 9.6, 2.8, { tol: 0.3 }).expectShards(2)
      .walkTo(x + 3.0, 2.8, { tol: 0.3 }).form('liquid');
  }
  r.walkTo(x + 15.4, 0).form('film')
    .waitUntil((s, p) => p.floating, { timeout: 3, label: 'dropped through the grille into the water' })
    .waitUntil((s, p) => p.x > x + 32.6, { toward: [x + 38, 0], timeout: 14, label: 'carried under the wall' })
    .expect((s, p) => p.form === 'film', 'still film in the channel')
    .form('liquid')
    .waitUntil((s) => s.signals.get('burnB'), { toward: [x + 37, 0], timeout: 6, label: 'afloat in the pool: burner B catches' })
    .wait(0.1).expect((s) => fire(s, 'burnerB').active, 'burner B is alight')
    .form('ice')
    .waitUntil((s, p) => p.grounded && p.y < -3.2, { toward: [x + 40, 0], timeout: 5, label: 'sunk to the floor of the pool' })
    .waitUntil((s, p) => p.x > x + 56.4, { toward: [x + 59, 0], timeout: 24, label: 'beneath the curtains of flame' })
    .form('liquid')
    .waitUntil((s, p) => p.floating, { timeout: 3, label: 'floated up in the second pool' })
    .waitUntil((s, p) => p.x > x + 61.2, { toward: [x + 63, 0], timeout: 6, label: 'at the far bank' })
    .jumpTo(x + 64.4, 0)
    .expect((s, p) => Math.abs(p.y) < 1e-6, 'out of the water')
    .walkTo(x + 64.4, 0).expect((s) => s.checkpoint.pos[0] === x + 64.4, 'bank checkpoint lit')
    .walkTo(x + 69.4, 0, { tol: 0.3 }).stop().waitUntil(full, { timeout: 3 })
    .form('steam')
    .waitUntil((s, p) => p.x > x + 71.2, { toward: [x + 73, 0], timeout: 3, label: 'into the shaft' })
    .waitUntil((s, p) => p.y > Y.lid + 0.3, { toward: [x + 73, 0], timeout: 6, label: 'up through the lid' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - Y.lid) < 1e-6, 'on the lid')
    .walkTo(x + 76.2, 0, { stuck: 0 })
    .waitUntil((s) => s.level.sprouts[0].state === 2, { timeout: 3, label: 'bud grown' })
    .walkTo(x + 76.9, 0, { tol: 0.1 });
  for (let i = 0; i < 6; i++) r.jumpTo(x + 76.9, 0, { tol: 0.15 });
  r.expect((s, p) => Math.abs(p.y - Y.well) < 1e-6, 'on the top leaf')
    .walkTo(X.well + 1.5, 0, { y: Y.well, stuck: 0 });
}

/** 3. The Cold Well: the ferry; the frost lets Mote shove a crate onto the door plate; then the well freezes Mote, ice sinks onto the heavy plate, a drop floats up. */
export function coldWell(r) {
  const x = X.well, y = Y.well;
  const cV = () => r.sim.level.crates[1].body;
  r.walkTo(x + 2.4, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 2.4, 'checkpoint lit')
    .walkTo(x + 7.4, 0, { tol: 0.3 })
    .waitUntil((s) => mover(s, 'ferry2').t >= 1, { timeout: 14, label: 'the ferry is across' })
    .walkTo(x + 23.4, 0).expect((s) => s.checkpoint.pos[0] === x + 23.4, 'far-side checkpoint lit')
    .expect((s, p) => p.form === 'ice', 'the frost keeps Mote ice on the landing')
    .walkTo(x + 24.4, -2.2, { tol: 0.25 }).stop()
    .waitUntil((s) => s.signals.get('pV'), { toward: [x + 40, -2.2], timeout: 12, label: 'crate pushed onto the first door plate' })
    .stop()
    .expect((s) => plateOf(s, 'pV').by === 'crate', 'the first crate holds its plate')
    .path([[x + 30, 0], [x + 25, 0.4], [x + 24.4, 2.2]], { tol: 0.3 }).stop()
    .waitUntil((s) => s.signals.get('pV2'), { toward: [x + 40, 2.2], timeout: 12, label: 'second crate pushed onto the second plate' })
    .stop()
    .expect((s) => plateOf(s, 'pV2').by === 'crate', 'the second crate holds the second plate')
    .path([[x + 30, 0.2], [x + 36.2, 0.2]], { tol: 0.3 })
    .waitUntil((s) => s.level.doors[0].open >= 1, { timeout: 2, label: 'the landing door is held open' })
    .walkTo(x + 40.4, 0).expect((s) => s.checkpoint.pos[0] === x + 40.4, 'well checkpoint lit')
    .walkTo(x + 43.6, 0)
    .waitUntil((s, p) => p.x > x + 45.2, { toward: [x + 47.75, 0], timeout: 3, label: 'at the edge of the well' })
    .form('liquid', { expect: false })
    .expect((s, p) => p.form === 'ice', 'the frost refuses every other form')
    .waitUntil((s, p) => p.grounded && p.y < y - 4, { toward: [x + 47.75, 0], timeout: 5, label: 'sunk to the bottom' })
    .waitUntil((s) => s.signals.get('plateC'), { toward: [x + 47.75, 0], timeout: 4, label: 'ice on the heavy plate' })
    .stop()
    .expectSignal('burnC', true)
    .expect((s) => !s.level.zones.find((q) => q.id === 'cold').active, 'the frost is off')
    .form('liquid')
    .waitUntil((s, p) => p.floating && p.y > y - 1, { timeout: 4, label: 'floated to the top' })
    .waitUntil((s, p) => p.x > x + 49.8, { toward: [x + 51.4, 0], timeout: 4, label: 'across' })
    .waitUntil((s, p) => p.floating, { toward: [x + 51.4, 0], timeout: 2, label: 'afloat at the far bank' })
    .jumpTo(x + 52.4, 0)
    .expect((s, p) => Math.abs(p.y - y) < 1e-6, 'out of the well')
    .expect((s) => fire(s, 'burnerC').active, 'burner C is alight')
    .walkTo(x + 54, 0).walkTo(x + 67, 0).walkTo(X.gale + 1.5, 0);
}

/** 4. The Gale Gallery: ice shoves the crate through the first gale onto the plate in the nook, then walks through the second and smashes the glass. */
export function galeGallery(r) {
  const x = X.gale;
  const c = () => r.sim.level.crates[3].body;
  r.walkTo(x + 2.4, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 2.4, 'checkpoint lit')
    .walkTo(x + 3.2, 0).form('ice').walkTo(x + 4.5, 0, { tol: 0.2 }).stop()
    .waitUntil((s) => s.signals.get('hpN'), { toward: [x + 30, 0], timeout: 14, label: 'crate pushed through the gale onto the plate' })
    .stop()
    .expect((s) => s.level.plates.find((q) => q.id === 'hpN').by === 'crate', 'the crate holds the nook plate')
    .expect((s) => s.level.fans[0].active, 'the gale is blowing')
    .path([[c().x - 1.6, 1.3], [c().x + 1.6, 1.3], [x + 24.6, 0.3]], { tol: 0.3 })
    .waitUntil((s) => s.level.doors[0].open >= 1, { timeout: 2, label: 'the nook shutter is held open' })
    .waitUntil((s) => pane(s, 'paneG').broken, { mx: 1, timeout: 12, label: 'the glass at the end of the second gale is smashed' })
    .expect((s, p) => p.form === 'ice' && p.vx > 5, 'went through the glass at speed')
    .stop({ timeout: 8 })
    .form('liquid')
    .walkTo(x + 41, 0).walkTo(X.throat + 1.5, 0);
}

/** 5. The Throat: the chimney lifts Mote as steam; a tray stops a cloud on the wrong side, so go to the open lane each time. */
export function throat(r, shard) {
  const x = X.throat, y = Y.throat;
  r.walkTo(x + 6, 0).wait(0.1).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 6, 'checkpoint lit')
    .walkTo(x + 7.6, 0).walkTo(x + 10.4, 2.4, { stuck: 0 })
    .expect((s, p) => p.form === 'steam', 'the chimney boiled Mote')
    .waitUntil((s, p) => p.y > y + 4.9, { toward: [x + 12.4, 2.4], timeout: 6, label: 'past jet 1, in the open lane' });
  if (shard) r.waitUntil((s) => s.shardsTaken.length === 3, { toward: [x + 12.4, -3.9], timeout: 4, label: 'the shard out wide above jet 1' });
  r.waitUntil((s, p) => p.y > y + 9.7, { toward: [x + 12.4, -2.4], timeout: 8, label: 'past jet 2, in the open lane' })
    .waitUntil((s, p) => p.y > y + 14.5, { toward: [x + 12.4, 2.4], timeout: 8, label: 'past jet 3, in the open lane' })
    .waitUntil((s, p) => p.y > y + 19.4, { toward: [x + 12.4, -2.4], timeout: 8, label: 'past jet 4, in the open lane' })
    .waitUntil((s, p) => p.y > y + 24.9, { toward: [x + 12.4, 2.4], timeout: 8, label: 'past jet 5, in the open lane' })
    .waitUntil((s, p) => p.y > y + 28.1, { toward: [x + 12.4, 0], timeout: 6, label: 'above the crown' })
    .waitUntil((s, p) => p.x > x + 16.2, { mx: 1, timeout: 3, label: 'over the crown' })
    .form('liquid').waitUntil(landed, { timeout: 3 })
    .expect((s, p) => Math.abs(p.y - Y.crown) < 1e-6 && p.x > X.crown, 'on the crown');
}

/** 6a. The Pilot Light: a drop douses the embers, film closes the posts, a cloud trips the sensor, ice presses the plate. */
export function pilotLight(r) {
  const x = X.crown;
  const embers = () => r.sim.level.embers.find((e) => e.id === 'pilotEmbers');
  r.walkTo(x + 1.8, 0).expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] === x + 1.8, 'checkpoint lit')
    .walkTo(x + 6.2, 0)
    .waitUntil((s) => embers().doused, { mx: 1, timeout: 3, label: 'the doorway of embers is out' })
    .walkTo(x + 11.0, 0).form('film').walkTo(x + 14.4, 0).walkTo(x + 15.7, 0)
    .expectSignal('arcP', true)
    .walkTo(x + 17.2, 0).form('liquid')
    .walkTo(x + 18.8, -2.8, { tol: 0.3 }).stop().waitUntil(full, { timeout: 3 })
    .form('steam')
    .waitUntil((s) => s.signals.get('steamP'), { toward: [x + 22, -2.8], timeout: 6, label: 'the cloud trips the sensor above the ledge' })
    .form('liquid').waitUntil(landed, { timeout: 4 })
    .walkTo(x + 25.6, -2.8, { stuck: 0 }).waitUntil(landed, { timeout: 4 })
    .walkTo(x + 26.4, 0).form('ice').walkTo(x + 28.6, 0, { tol: 0.3 }).stop()
    .expectSignal('hpP', true)
    .waitUntil((s) => s.signals.get('ignite'), { timeout: 1, label: 'the pilot light catches' })
    .wait(0.1)
    .expect((s) => s.level.doors[1].open > 0, 'the shutter lifts');
}

/** 6b. The Plunge: the frost keeps Mote ice, the slope does the rest: two walls of glass and into the lit kiln. */
export function plunge(r) {
  const x = X.crown;
  r.waitUntil((s) => s.level.doors[1].open >= 1, { timeout: 2, label: 'the shutter is open' })
    .waitUntil((s) => pane(s, 'glass1').broken, { mx: 1, timeout: 14, label: 'first wall of glass smashed by the slide' })
    .waitUntil((s) => pane(s, 'glass2').broken, { mx: 1, timeout: 3, label: 'second wall of glass smashed' })
    .expectExit({ timeout: 4, toward: [x + 86.4, 0] });
}

export function solve(r) {
  stokehole(r, false);
  culvert(r, false);
  coldWell(r);
  galeGallery(r);
  throat(r, false);
  pilotLight(r);
  plunge(r);
}

export function solveAll(r) {
  stokehole(r, true);
  culvert(r, true);
  coldWell(r);
  galeGallery(r);
  throat(r, true);
  pilotLight(r);
  plunge(r);
}
