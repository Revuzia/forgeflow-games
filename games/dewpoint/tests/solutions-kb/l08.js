// Keyboard solution for l08 "Bone Dry". Headings (camYaw -90): +x = W, -x = S, -z = A, +z = D.

import level from '../../src/levels/l08.js';

const o = level.areas.map((a) => a.box[0]);
o[0] = 0;
const [A1, A2, A3, A4, A5] = o;

const full = (s, p) => p.gauge >= 3.99;
const ember = (s, id) => s.level.embers.find((e) => e.id === id);
const sprout = (s, id) => s.level.sprouts.find((q) => q.id === id);
const mover = (s, id) => s.level.movers.find((m) => m.id === id);
const crate = (s) => s.level.crates[0].body;
const crate2 = (s) => s.level.crates[1].body;
const pane = (s, id) => s.level.panes.find((q) => q.id === id);
const docked = (id) => (s) => mover(s, id).t < 0.01 && mover(s, id).wait > 0.9;
const atB = (id) => (s) => mover(s, id).t >= 0.999;

function douse(k, id, from, into) {
  return k.goTo(from, 0)
    .hold('+x', { until: (s) => ember(s, id).doused, timeout: 4, label: `${id} doused by touch` })
    .release().settle();
}

/** Water a bud (stand beside it) and hop straight up its leaves. */
function climb(k, id, x, z, hops, top) {
  k.goTo(x - 0.3, z, { tol: 0.5 })
    .until((s) => sprout(s, id).state === 2, { timeout: 4, label: `${id} grown` });
  for (let i = 0; i < hops; i++) k.jump({ hold: 0.45 }).land().settle();
  return k.expect((s, p) => Math.abs(p.y - top) < 1e-6, `on the top leaf of ${id}`);
}

const AREAS = [
  // 1. The Planter Hall: two doorways of embers, the bud, up onto deck one
  (k) => {
    k.goTo(A1 + 2.4, -0.9);
    douse(k, 'embersA', A1 + 15.0, A1 + 17.6);
    k.goTo(A1 + 29.0, 0);
    douse(k, 'embersB', A1 + 29.0, A1 + 31.6);
    k.goTo(A1 + 42.4, 0);
    climb(k, 'seedA', A1 + 43.0, 0, 3, 3.6);
    k.goTo(A1 + 45.2, 0);
  },
  // 2. The Electrode Deck: film closes the first posts, crawls under the wall to the second pair; the tall door opens
  (k) => {
    k.goTo(A2 + 2.0, -0.9).goTo(A2 + 6.4, -0.3).form('film')
      .goTo(A2 + 8.1, -0.8).goTo(A2 + 8.1, -3.0)
      .expectSignal('arc1', true)
      .goTo(A2 + 8.1, -0.3)
      .runTo('+x', A2 + 16.6, { label: 'crawl under the wall' })
      .expect((s, p) => p.x > A2 + 14.6, 'under the wall')
      .goTo(A2 + 28.1, 1.0).goTo(A2 + 28.1, 2.7)
      .expectSignal('arc2', true)
      .goTo(A2 + 28.1, 0.2).form('liquid')
      .expect((s) => s.signals.get('doorA'), 'both circuits latched: the door is open')
      .goTo(A2 + 39.0, 0)
      .until((s) => s.level.doors[0].open >= 1, { timeout: 4, label: 'door open' })
      .goTo(A2 + 42.4, 0.9)
      .expect((s) => s.checkpoint !== null && s.checkpoint.pos[0] > A2 + 36, 'checkpoint beyond the door');
  },
  // 3. The Ferry Gallery: film (the crosswind does not move it) over the first pit, ice through the glass, film over the second
  (k) => {
    k.goTo(A3 + 2.0, -0.9).goTo(A3 + 7.6, 0).form('film')
      .goTo(A3 + 9.4, 0)
      .until(docked('ferryA'), { timeout: 16, label: 'first ferry docks on our side' })
      .runTo('+x', A3 + 12.4)
      .until(atB('ferryA'), { timeout: 10, label: 'carried across the first pit' })
      .goTo(A3 + 18.8, -0.9, { tol: 0.4 })
      .form('ice')
      .hold('+x', { until: (s) => pane(s, 'islandPane').broken, timeout: 8, label: 'glass across the island smashed' })
      .form('film', { release: true })                       // film stops on a sixpence: ice would slide on over the island's edge
      .settle()
      .goTo(A3 + 25.0, 0)
      .until(docked('ferryB'), { timeout: 16, label: 'second ferry docks at the island' })
      .runTo('+x', A3 + 28.4)
      .until(atB('ferryB'), { timeout: 10, label: 'carried across the second pit' })
      .goTo(A3 + 36, 0).form('liquid')
      .goTo(A3 + 43.4, 0);
  },
  // 4. The Hatch Deck: steam up through the hatch in the loft floor
  (k) => {
    k.goTo(A4 + 2.0, -0.9).goTo(A4 + 24.4, 0)
      .until(full, { timeout: 4 })
      .form('steam')
      .until((s, p) => p.y > 7.9, { timeout: 6, label: 'through the hatch' })
      .form('liquid').land().settle()
      .expect((s, p) => Math.abs(p.y - 7.8) < 1e-6, 'standing on the loft');
  },
  // 5. The Loft: ice shoves the crate south into the lane, then east along the loft and over the edge onto the heavy plate;
  //    back up as steam in the warm draught, the second crate the same way, then the kiln door
  (k) => {
    k.goTo(A5 + 1.6, 0.9)
      .goTo(A5 + 1.2, -3.0, { order: 'xz' })
      .hold('-z', { for: 0.5 }).release().settle()                   // against the north kerb: the rail
      .goTo(A5 + 4.2, -3.6, { tol: 0.6 })
      .form('ice')
      .hold('+z', { until: (s) => crate(s).z >= -0.9, timeout: 8, label: 'crate pushed south into the lane' })
      .stopNow()
      .form('liquid')
      .goTo(A5 + 2.0, crate(k.sim).z, { order: 'xz' }).form('ice')
      .hold('+x', { until: (s) => crate(s).y < 7.0, timeout: 24, label: 'crate pushed off the edge' })
      .until((s) => s.level.plates[0].pressed, { timeout: 4, label: 'the crate lands on the heavy plate' })
      .stopNow()
      .form('liquid')
      .expect((s) => s.level.plates[0].by === 'crate', 'the first crate (not Mote) holds the first plate')
      .goTo(A5 + 43.5, -2.8)
      .until(full, { timeout: 4 })
      .form('steam')
      .until((s, p) => p.y > 7.9, { timeout: 5, label: 'up the warm draught' })
      .hold('-x', { until: (s, p) => p.x < A5 + 41.0, timeout: 4, label: 'over the loft edge' })
      .form('liquid', { release: true }).land().settle()
      .expect((s, p) => Math.abs(p.y - 7.8) < 1e-6, 'back on the loft')
      .goTo(A5 + 38, 0.4, { order: 'zx' })
      .goTo(A5 + 28.4, 0.4)
      .goTo(A5 + 28.4, crate2(k.sim).z, { tol: 0.6 }).form('ice')
      .hold('+x', { until: (s) => crate2(s).y < 7.0, timeout: 14, label: 'second crate pushed off the edge' })
      .until((s) => s.level.plates[1].pressed, { timeout: 4, label: 'the second crate lands on the second plate' })
      .stopNow()
      .form('liquid')
      .expect((s) => s.level.plates[1].by === 'crate', 'the second crate holds the second plate')
      .goTo(A5 + 44.6, 0.8).goTo(A5 + 48, 1.0).goTo(A5 + 62, 0).goTo(A5 + 67.4, 0).expectExit();
  },
];

export const areas = AREAS;
export function solve(k) { for (const a of AREAS) a(k); }
