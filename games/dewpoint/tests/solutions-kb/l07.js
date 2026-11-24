// Keyboard solution for l07 "Crazing". Headings (camYaw -90): +x = W, -x = S, -z = A, +z = D.
// Ice (key 2) is steered with W alone and braked with S; film (key 4) crawls the tunnels; the tail wind carries a jump over the pit.

import level from '../../src/levels/l07.js';

const o = level.areas.map((a) => a.box[0]);
o[0] = 0;
const [A1, A2, A3, A4, A5] = o;

const pane = (s, id) => s.level.panes.find((q) => q.id === id);
const ember = (s, id) => s.level.embers.find((e) => e.id === id);
const sprout = (s, id) => s.level.sprouts.find((q) => q.id === id);
const crate = (s) => s.level.crates[0].body;
const crate2 = (s) => s.level.crates[1].body;

/** Water a bud (stand beside it) and hop straight up its leaves. */
function climb(k, id, x, hops, top) {
  k.goTo(x - 0.5, 0, { tol: 0.5 })
    .until((s) => sprout(s, id).state === 2, { timeout: 4, label: `${id} grown` });
  for (let i = 0; i < hops; i++) k.jump({ hold: 0.45 }).land().settle();
  return k.expect((s, p) => Math.abs(p.y - top) < 1e-6, `on the top leaf of ${id}`);
}

const AREAS = [
  // 1. The Draught Hall: the tail wind carries a drop over the pit, ice through the gale, film through the tunnel
  (k) => {
    k.goTo(A1 + 2.4, -0.9).goTo(A1 + 4.5, 0)
      .jumpAt('+x', A1 + 10.6, { release: false })
      .until((s, p) => p.grounded && p.x > A1 + 17.6, { timeout: 4, label: 'carried across the pit' })
      .release().settle()
      .goTo(A1 + 21, -0.9).goTo(A1 + 24.6, 0).form('ice')
      .hold('+x', { until: (s, p) => p.x > A1 + 31.0, timeout: 10, label: 'through the gale as ice' })
      .stopNow()
      .form('film')
      .runTo('+x', A1 + 58.0, { label: 'crawl the tunnel' })
      .form('liquid')
      .goTo(A1 + 59.6, 0);
  },
  // 2. The Louvre Walk: ice sprints the walkway and breaks the glass; film crawls the tunnel beyond
  (k) => {
    k.goTo(A2 + 2.2, -0.9).goTo(A2 + 3.4, 0).form('ice')
      .hold('+x', { until: (s) => pane(s, 'louvrePane').broken, timeout: 12, label: 'sprint along the walkway and smash the glass' })
      .stopNow()
      .form('film')
      .runTo('+x', A2 + 55.2, { label: 'crawl the tunnel' })
      .form('liquid')
      .goTo(A2 + 59.6, 0);
  },
  // 3. The Cullet Cellar: a hard fall breaks the glass floor; ice shoves the crates onto the plates; steam up the shaft
  (k) => {
    k.goTo(A3 + 2.2, -0.9).goTo(A3 + 15, 0)
      .macro([[0, 'Space']])                                    // jump (held)
      .form('ice', { after: 0.2 })                              // frozen while still rising: the fall does the rest
      .macro([[0, '']], { after: 0.25 })                        // jump button up
      .until((s) => pane(s, 'floorGlass').broken, { timeout: 2, label: 'glass floor smashed by the fall' })
      .land()
      .expect((s, p) => p.y < -6, 'down in the cellar')
      .expectSignal('shaftPlate', false)
      .settle()
      .form('liquid')
      // line up behind crate 1 against the north wall (it is the rail), freeze, shove it south into the lane
      .goTo(A3 + 18.0, -2.8, { order: 'xz' })
      .hold('-z', { for: 0.5 }).release().settle()
      .goTo(A3 + 19.4, -3.5, { tol: 0.6 })
      .form('ice')
      .hold('+z', { until: (s) => crate(s).z >= -0.9, timeout: 6, label: 'crate pushed into the lane' })
      .stopNow()
      .form('liquid')
      .goTo(A3 + 17.4, crate(k.sim).z, { order: 'xz' }).form('ice')
      .hold('+x', { until: (s) => crate(s).x >= A3 + 25.4, timeout: 12, label: 'crate pushed onto the heavy plate' })
      .stopNow()
      .expectSignal('shaftPlate', true)
      .form('liquid')
      .goTo(A3 + 21, 1.0, { order: 'zx' }).goTo(A3 + 17.4, crate2(k.sim).z, { order: 'xz' }).form('ice')
      .hold('+x', { until: (s) => crate2(s).x >= A3 + 25.4, timeout: 12, label: 'second crate pushed onto the second plate' })
      .stopNow()
      .expectSignal('shaftB', true)
      .form('liquid')
      .goTo(A3 + 25, 1.4, { order: 'zx' }).goTo(A3 + 28, 1.4).goTo(A3 + 30.2, 0)
      .until((s, p) => p.gauge >= 3.99, { timeout: 4 }).form('steam')
      .runTo('+x', A3 + 32.4, { label: 'into the shaft' })
      .until((s, p) => p.y > 0.6, { timeout: 7, label: 'up the shaft' })
      .hold('+x', { until: (s, p) => p.x > A3 + 34.6, timeout: 4, label: 'out over the hall' })
      .form('liquid', { release: true }).land().settle()
      .expect((s, p) => Math.abs(p.y) < 1e-6 && p.x > A3 + 33, 'on the floor above');
  },
  // 4. Crazed Glass: film under the beam, ice through the rest of the gale and the glass at its end, then the cliff
  (k) => {
    k.goTo(A4 + 1.2, -0.9).goTo(A4 + 10.5, 0).form('film')
      .runTo('+x', A4 + 17.8, { label: 'crawl under the beam' })
      .form('ice')
      .hold('+x', { until: (s) => pane(s, 'paneA').broken, timeout: 8, label: 'glass smashed at the end of the gale' })
      .stopNow()
      .form('liquid')
      .expect((s, p) => p.x > A4 + 22.3, 'through the glass')
      .goTo(A4 + 29.4, 0)
      .hold('+x', { until: (s) => ember(s, 'bayEmbers').doused, timeout: 4, label: 'bay embers doused by touch' })
      .release().settle();
    climb(k, 'bud', A4 + 33.8, 5, 6);
  },
  // 5. The Glass Run: a second cliff, douse the crest, freeze, let go: four walls of glass, and the kiln door
  (k) => {
    k.goTo(A5 + 2.0, -0.9);
    climb(k, 'bud2', A5 + 12.0, 6, 12.6);
    k.goTo(A5 + 15.0, -0.9).goTo(A5 + 22.2, 0)
      .hold('+x', { until: (s) => ember(s, 'crestEmbers').doused, timeout: 4, label: 'crest embers out' })
      .release().settle()
      .form('ice')
      .hold('+x', { until: (s) => pane(s, 'paneB').broken, timeout: 25, label: 'the last wall of glass smashed at the foot of the slide' })
      .expect((s) => ['paneS1', 'paneS2', 'paneS3'].every((id) => pane(s, id).broken), 'and the three before it')
      .stopNow()
      .form('film')
      .runTo('+x', A5 + 128.2, { stop: false })
      .expectExit({ timeout: 6 });
  },
];

export const areas = AREAS;
export function solve(k) { for (const a of AREAS) a(k); }
