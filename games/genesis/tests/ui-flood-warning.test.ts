// ARC §10 (UI lane): the river's warning before a flood — the warning toast says what the people see (the river high
// and brown, not "the ground"), and the warning cue sounds rain and a swollen river, not the sea drawing back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warningText } from '../src/ui/toasts.ts';
import { cueFor } from '../src/audio/eventmap.ts';
import { SFX, type Sfx } from '../src/audio/sfx.ts';

function drawCue(cue: string, variant: string): [string, ...unknown[]][] {
  const calls: [string, ...unknown[]][] = [];
  const rec: Record<string | symbol, unknown> = { t: 0, size: 40, count: 1, variant, r: () => 0.5, rr: (a: number, b: number) => (a + b) / 2 };
  const s = new Proxy(rec, { get: (o, k) => (k in o ? o[k] : (...args: unknown[]) => { calls.push([String(k), ...args]); return 0; }) });
  SFX[cue](s as unknown as Sfx);
  return calls;
}

test('a flood warning toast tells of the river, not the ground', () => {
  const t = warningText('flood');
  assert.match(t, /river/);
  assert.match(t, /higher ground/);
  assert.doesNotMatch(t, /ground warns/);
  // the others keep their own sight, and an unknown kind the old words
  assert.match(warningText('tsunami'), /sea draws back/);
  assert.match(warningText('volcano'), /mountain/);
  assert.equal(warningText('star quake'), 'The ground warns of a star quake: the people nearby can see it coming.');
});

test('a flood warning has its own sound: rain and the river, not the sea drawing back', () => {
  const c = cueFor({ t: 'warning', tick: 0, a: 400, data: { kind: 'flood', id: 3 } })!;
  assert.equal(c.cue, 'warning');
  assert.equal(c.variant, 'flood');
  assert.equal(c.key, 'warning:flood');
  const flood = drawCue('warning', 'flood');
  const wave = drawCue('warning', 'tsunami');
  assert.ok(flood.some((x) => x[0] === 'buf' && x[1] === 'babble'), 'running water');
  assert.ok(!wave.some((x) => x[0] === 'buf' && x[1] === 'babble'), 'the sea draws back without the river');
  assert.notDeepEqual(flood.map((x) => x[0]), wave.map((x) => x[0]));
  assert.equal(cueFor({ t: 'warning.end', tick: 0, data: { kind: 'flood' } }), null, 'the all-clear is told by the chronicle, not a cue');
});
