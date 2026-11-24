// Every registered level must (1) load cleanly, (2) follow the house rules, and (3) be proven
// solvable by a scripted input sequence in tests/solutions/<id>.js exporting
//   solve(r)     - reach the exit                      (required)
//   solveAll(r)  - reach the exit with all 3 shards    (required: shards must be obtainable)
// `r` is a Runner from tests/lib/play.js. Scripts use real inputs only.

import { test, assert, eq } from './lib/harness.js';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { levels, getLevel, nextLevelId, chapters } from '../src/levels/index.js';
import { Sim } from '../src/sim/sim.js';
import { play } from './lib/play.js';
import { resolvePrompt, INPUT_MODES, HINT_MAX_CHARS } from '../src/ui/prompts.js';

const here = path.dirname(fileURLToPath(import.meta.url));

test('registry: ids are unique, ordered lNN, and lookups work', () => {
  const ids = levels.map((l) => l.id);
  eq(new Set(ids).size, ids.length, 'duplicate level ids');
  ids.forEach((id, i) => eq(id, `l${String(i + 1).padStart(2, '0')}`, 'level ids must be l01, l02, ... in play order'));
  assert(levels.length >= 3, 'at least the three core levels');
  eq(getLevel('l01'), levels[0]);
  eq(getLevel('nope'), null);
  eq(nextLevelId(ids[0]), ids[1]);
  eq(nextLevelId(ids[ids.length - 1]), null);
  for (const l of levels) assert(chapters.some((c) => c.id === (l.chapter || 1)), `${l.id}: unknown chapter ${l.chapter}`);
});

for (const data of levels) {
  const id = data.id;

  test(`${id}: loads with no warnings and follows the house rules`, () => {
    const sim = new Sim(data);
    const L = sim.level;
    eq(L.warnings, [], 'level warnings');
    eq(L.shards.length, 3, 'every level has exactly 3 glaze shards');
    assert(L.checkpoints.length >= 1, 'every level has at least one checkpoint');
    assert(typeof data.name === 'string' && data.name.length <= 24, 'name must fit the HUD (<= 24 chars)');
    assert(data.hints && typeof data.hints.start === 'string', 'needs a hints.start line');
    for (const [k, v] of Object.entries(data.hints)) {
      assert(typeof v === 'string' && v.length > 0, `hint "${k}" must be a non-empty string`);
      // the budget is for what the player reads: tokens filled in, longest input method
      for (const m of INPUT_MODES) {
        const n = resolvePrompt(v, m).length;
        assert(n <= HINT_MAX_CHARS, `hint "${k}" is ${n} chars on ${m} (max ${HINT_MAX_CHARS}): "${resolvePrompt(v, m)}"`);
      }
    }
    const used = new Set(L.hintZones.map((h) => h.key)); used.add('start');
    for (const k of Object.keys(data.hints)) assert(used.has(k), `hint "${k}" is never shown (no hint piece uses it)`);
    // Mote must spawn on solid ground and stay put
    for (let i = 0; i < 120; i++) sim.step();
    assert(sim.player.grounded, 'spawn point is not on the ground');
    assert(Math.hypot(sim.player.x - data.spawn[0], sim.player.z - data.spawn[2]) < 0.05, 'spawn point pushes Mote sideways');
    assert(Math.abs(sim.player.y - data.spawn[1]) < 0.4, 'spawn point is far above/below the floor');
    eq(sim.deaths, 0);
    assert(!sim.completed, 'spawn must not touch the exit');
  });

  test(`${id}: an idle player neither dies nor wins for 20 s`, () => {
    const sim = new Sim(data);
    for (let i = 0; i < 2400; i++) sim.step();
    eq(sim.deaths, 0); assert(!sim.completed);
  });

  const file = path.join(here, 'solutions', `${id}.js`);
  test(`${id}: has a solvability script (tests/solutions/${id}.js)`, () => {
    assert(existsSync(file), `missing ${file}`);
  });
  if (!existsSync(file)) continue;

  test(`${id}: scripted play reaches the exit`, async () => {
    const mod = await import(pathToFileURL(file).href);
    assert(typeof mod.solve === 'function', 'solution must export solve(r)');
    const r = play(data);
    mod.solve(r);
    assert(r.sim.completed, 'solve(r) returned without completing the level (end with r.expectExit())');
    eq(r.sim.deaths, 0, 'the reference route should not need a death');
    const res = r.result();
    assert(res && res.id === id && res.timeMs > 0, 'complete event carries id and time');
    assert(res.timeMs < 5 * 60 * 1000, `reference route takes ${(res.timeMs / 1000).toFixed(0)} s; levels should be completable in under 5 minutes`);
  });

  test(`${id}: scripted play collects all 3 shards and exits`, async () => {
    const mod = await import(pathToFileURL(file).href);
    assert(typeof mod.solveAll === 'function', 'solution must export solveAll(r)');
    const r = play(data);
    mod.solveAll(r);
    assert(r.sim.completed, 'solveAll(r) returned without completing the level');
    eq(r.result().shards, [0, 1, 2], 'shards collected');
    eq(r.sim.deaths, 0);
  });

  test(`${id}: the solution is deterministic`, async () => {
    const mod = await import(pathToFileURL(file).href);
    const a = play(data); mod.solve(a);
    const b = play(data); mod.solve(b);
    eq(a.sim.fingerprint(), b.sim.fingerprint());
    eq(a.result().timeMs, b.result().timeMs);
  });
}
