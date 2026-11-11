// PERF s7 — the sim worker answers a snapshot request with 'same' (the clock only) when nothing changed since its last
// snapshot: no tick, no command / step / speed / load message, no field due. The client asked 30x a second for a world
// that changes once a second at 1x: each request rebuilt and cloned the whole view (~230 kB, ~8 ms on a busy world).
// Runs the real worker host (src/sim/worker.ts) in-process with a stub postMessage.
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Msg = { type: string; [k: string]: unknown };
const out: Msg[] = [];
const g = globalThis as unknown as { postMessage: (m: Msg) => void; onmessage: ((ev: { data: unknown }) => void) | null; setTimeout: typeof setTimeout };
g.postMessage = (m) => { out.push(m); };
// (the worker's pacing timers must not keep the test process alive)
const st = globalThis.setTimeout;
g.setTimeout = ((fn: () => void, ms?: number) => { const t = st(fn, ms); (t as { unref?: () => void }).unref?.(); return t; }) as typeof setTimeout;
await import('../src/sim/worker.ts');
const send = (data: unknown) => g.onmessage!({ data });
const ask = (full = false): Msg => { out.length = 0; send({ type: 'snapshot', full }); const m = out.find((x) => x.type === 'snapshot' || x.type === 'same'); assert.ok(m, 'a reply'); return m!; };

test("snapshot requests: 'same' only while nothing changed", async () => {
  send({ type: 'init', scenario: 'sandbox', seed: 7, options: { speed: 0 } });
  assert.ok(out.some((m) => m.type === 'ready'));
  const first = ask(true);
  assert.equal(first.type, 'snapshot');
  const tick0 = (first.snap as { tick: number }).tick;
  // nothing happened: the clock only, at the same tick
  const s1 = ask();
  assert.equal(s1.type, 'same');
  assert.equal(s1.tick, tick0);
  assert.equal(ask().type, 'same');
  // a step changes the world: a full snapshot at the new tick, then 'same' again (fields still due arrive first)
  out.length = 0; send({ type: 'step', id: 1, ticks: 3 });
  const s2 = ask();
  assert.equal(s2.type, 'snapshot');
  assert.equal((s2.snap as { tick: number }).tick, tick0 + 3);
  await new Promise((ok) => st(ok, 600)); // every field's send interval has passed: a held-back field goes now
  let r = ask();
  if (r.type === 'snapshot') r = ask();
  assert.equal(r.type, 'same');
  // a command (any message but snapshot / parse) may change the world: full again
  out.length = 0; send({ type: 'query', id: 2, q: 'nothing', args: {} });
  assert.equal(ask().type, 'snapshot');
  assert.equal(ask().type, 'same');
  out.length = 0; send({ type: 'speed', speed: 0 });
  assert.equal(ask().type, 'snapshot');
  // a full request always builds
  assert.equal(ask(true).type, 'snapshot');
  // parse is a preview: no change
  out.length = 0; send({ type: 'parse', id: 3, text: 'rain' });
  assert.equal(ask().type, 'same');
});
