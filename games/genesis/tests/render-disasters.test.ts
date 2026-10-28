// GENESIS — every disaster the sim can spawn has a picture (render/fx/disasters.ts).
//
// The renderer draws a disaster by its kind (DisasterView.kind = the disasters.json id). When the fantasy 'leviathan'
// became the real 'rogue-wave', the render switch kept only a dead 'leviathan' case (a sea serpent) and the new id fell
// through to `default: break` — the Rogue wave power drew nothing. This guards both: no id goes dark, and no creature
// is drawn for a disaster (real animals only; no creature — LIVING §0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../src/render/fx/disasters.ts', import.meta.url), 'utf8');
const DATA = JSON.parse(readFileSync(new URL('../src/data/disasters.json', import.meta.url), 'utf8')) as unknown;
const defs = (Array.isArray(DATA) ? DATA : (DATA as { disasters?: unknown[] }).disasters ?? []) as { id: string; aliases?: string[] }[];

test('every disasters.json id (and alias) reaches its own case in DisasterFx', () => {
  assert.ok(defs.length > 20, `disasters read (${defs.length})`);
  const cases = new Set([...SRC.matchAll(/case '([a-z0-9-]+)'/g)].map((m) => m[1]));
  const missing = defs.filter((d) => !cases.has(d.id)).map((d) => d.id);
  assert.deepEqual(missing, [], `disaster kinds with no picture: ${missing.join(', ')}`);
  assert.ok(cases.has('rogue-wave'), 'the rogue wave is drawn');
});

test('no creature is drawn for a disaster (the old leviathan serpent is gone)', () => {
  assert.ok(!/serpent|humps|archGeo/.test(SRC), 'no sea-serpent code left in the disaster renderer');
  // the old alias draws the same wave as the real kind
  assert.match(SRC, /case 'rogue-wave':\s*case 'leviathan':/);
});
