// Which hint is on the card. A hint belongs to the place that raised it; the player keeps moving.
// (Found with a debug teleport, but a player running from one hint zone into the next hit it too:
// the new zone's hint used to wait behind the old card for up to 3 more seconds.)

import { test, assert, eq } from './lib/harness.js';
import { hintArrival, HINT_MIN_READ, hintSeconds } from '../src/ui/prompts.js';
import { Sim } from '../src/sim/sim.js';
import { levels } from '../src/levels/index.js';

test('hint card: nothing showing - the hint is shown; a card that has had its read gives way at once', () => {
  eq(hintArrival(false, 0), 'show'); eq(hintArrival(false, 99), 'show');
  eq(hintArrival(true, HINT_MIN_READ), 'replace'); eq(hintArrival(true, 5), 'replace');
});

test('hint card: a card only just up (two hints in one breath) is read first, then the next follows', () => {
  eq(hintArrival(true, 0), 'queue'); eq(hintArrival(true, HINT_MIN_READ - 0.01), 'queue');
  assert(HINT_MIN_READ >= 1.5 && HINT_MIN_READ <= 3, 'long enough to read a line start, short enough not to be stale');
});

test('hint card: the shortest a hint stays up is longer than the read a newer hint must wait for', () => {
  for (const mode of ['keyboard', 'touch', 'pad']) assert(hintSeconds('x', mode) > HINT_MIN_READ, mode);
});

test('hint zones: the start hint comes at tick 1, each zone hint once, and a teleport or respawn never raises it again', () => {
  // the sim side of the same story: a respawn or a teleport does not raise a zone's hint a second time
  const L = levels[1], sim = new Sim(L);
  sim.step();
  const first = sim.drainEvents().filter((e) => e.type === 'hint');
  eq(first.length, 1); eq(first[0].key, 'start');
  const z = sim.level.hintZones[0], c = [(z.box[0] + z.box[3]) / 2, z.box[1] + 0.5, (z.box[2] + z.box[5]) / 2];
  sim.teleport(...c); sim.step(); sim.step();
  eq(sim.drainEvents().filter((e) => e.type === 'hint').map((e) => e.key), [z.key]);
  sim.teleport(0, 0.5, 0); sim.step(); sim.teleport(...c); sim.step(); sim.step();
  eq(sim.drainEvents().filter((e) => e.type === 'hint').length, 0, 'the zone is spent');
});
