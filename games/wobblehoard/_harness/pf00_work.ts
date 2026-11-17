// PF-00 (PG_PHYS, PLAYGROUND_BUILD 14.2, T13): the physics workloads measured in BOTH harnesses, unchanged: in node on this container and in Chromium with a 4x
// CPU throttle (_harness/pf00.mjs serves _harness/physview/pf00.html, which imports this module). Each returns the mean physics ms a frame (median of `reps` batches).
//   rest      one awake detail-3 whole on the table
//   press     the same, pressed by a finger (c_whole)
//   piece     six detail-2 pieces (frac 0.2) in contact, the contact planner every frame: the cost per piece
//   pair      two awake wholes touching (the planner every frame): the frame cost (pair extra = pair - 2 x rest)
//   sleeper   one asleep whole (sleepEnabled): the cost of its step
//   props     the pressed whole on and beside 4 props of a PropWorld: the frame cost (props extra = props - press)
import { SLEEP, SoftBody } from '../src/physics/softbody.ts';
import { ContactPlanner } from '../src/physics/broad.ts';
import { buildPropWorld } from '../src/physics/props.ts';
import { makeStarterGenome, quantizeGenome } from '../src/core/genome.ts';
import type { Genome } from '../src/core/genome.ts';
import { PLACE as CABIN } from '../src/data/place_hearthlog.ts';
import type { PlaceDef } from '../src/data/places.ts';

const DT = 1 / 60;
const G: Genome = quantizeGenome({ ...makeStarterGenome(), firmness: 0.5, bounce: 0.5, stretch: 0.5, size: 0.5 });
const sink: unknown[] = [];
const at = (x: number, y: number, z: number): Record<string, unknown> => ({ piece: { frac: 1, chunk: false, at: { x, y, z } } });
function press(b: SoftBody): void {
  const h = b.raycast({ x: b.center.x, y: b.center.y + 3, z: b.center.z + 0.02 }, { x: 0, y: -1, z: 0 });
  if (h) { b.fingerDown(0, { point: h.point, normal: h.normal, dir: { x: 0, y: -1, z: 0 } }); b.fingerPressure(0, 0.6); }
}
function median(a: number[]): number { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function timeIt(frame: () => void, warm: number, reps: number, per: number, now: () => number): number {
  for (let i = 0; i < warm; i++) frame();
  const r: number[] = [];
  for (let k = 0; k < reps; k++) { const t = now(); for (let i = 0; i < per; i++) frame(); r.push((now() - t) / per); }
  return median(r);
}

export interface Pf00Result { rest: number; press: number; piece: number; pair: number; sleeper: number; props: number; sleeperAsleep: boolean; pairTouch: number; piecesAwake: boolean }

export function pf00Run(reps = 7, per = 120, now: () => number = () => performance.now()): Pf00Result {
  const step = (bs: SoftBody[]): void => { for (const b of bs) { b.step(DT); b.drainEvents(sink as never); sink.length = 0; } };
  // rest and press
  const a = new SoftBody(G);
  const rest = timeIt(() => step([a]), 240, reps, per, now);
  press(a);
  const pr = timeIt(() => step([a]), 120, reps, per, now);
  // the AWAKE costs: bodies built `at` a spot are CUT3 pieces that may sleep at rest (a first run measured 0.001 ms a "piece"): sleep is off for them
  const sleepWas = SLEEP.enabled;
  SLEEP.enabled = false;
  // six detail-2 pieces in a row of contacts
  const pieces: SoftBody[] = [];
  for (let k = 0; k < 6; k++) pieces.push(new SoftBody(G, { piece: { frac: 0.2, chunk: false, at: { x: -0.75 + k * 0.3, y: 0, z: (k & 1) * 0.12 } } } as never));
  const plP = new ContactPlanner();
  const piece = timeIt(() => { plP.run(pieces); step(pieces); }, 240, reps, per, now) / 6;
  // two wholes touching
  const p1 = new SoftBody(G, at(-0.5, 0, 0) as never), p2 = new SoftBody(G, at(0.5, 0, 0) as never);
  const plW = new ContactPlanner(), pairB = [p1, p2];
  const pair = timeIt(() => { plW.run(pairB); step(pairB); }, 240, reps, per, now);
  const pairTouch = plW.stats.pairs;
  SLEEP.enabled = sleepWas;
  // a sleeper
  const s = new SoftBody(G); s.sleepEnabled = true;
  for (let i = 0; i < 120; i++) step([s]);
  const sleeper = timeIt(() => step([s]), 60, reps, per * 10, now);
  // the pressed whole with 4 props in reach (a block under it, two bars and a mound at its sides)
  const th = (mech: number, x: number, z: number, size: number[], yaw = 0): unknown => ({ id: 'hearth', place: 'hearthlog', mech, x, z, yaw, size, mu: 0.8, p: {}, ride: false });
  const four = [th(1, 0, 0, [0.8, 0.1, 0.8]), th(2, 0, -0.55, [0.12, 1.4, 0]), th(2, -0.55, 0, [0.12, 1.4, 0], Math.PI / 2), th(3, 0.95, 0, [0.6, 0.25, 0])];
  const place = { ...CABIN, things: four, walls: [], zones: [], patches: [], tall: { ...CABIN.tall, things: four.map(() => ({ x: 0, z: 0, yaw: 0 })), walls: [], zones: [], patches: [] } } as unknown as PlaceDef;
  const w = buildPropWorld(place, 'wide', 1);
  const c = new SoftBody(G, at(0, 0.5, 0) as never); c.setPropWorld(w);
  for (let i = 0; i < 120; i++) { w.beginFrame(); step([c]); w.endFrame(DT); }
  press(c);
  const props = timeIt(() => { w.beginFrame(); step([c]); w.endFrame(DT); }, 120, reps, per, now);
  return { rest, press: pr, piece, pair, sleeper, props, sleeperAsleep: s.sleeping, pairTouch, piecesAwake: pieces.every((b) => !b.sleeping) };
}
