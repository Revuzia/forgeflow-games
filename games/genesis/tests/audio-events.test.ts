// Every event the sim can emit is heard (a cue the SFX catalog has) or silent on purpose (an explicit null with a
// reason): a new sim event that nobody mapped fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ARC_CUES, SILENT_EVENTS, cueFor } from '../src/audio/eventmap.ts';
import { SFX } from '../src/audio/sfx.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out); else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

/** every `t: 'name'` literal in src/sim: the event types the sim emits (emit, emitAt, emitSt, tell) */
function simEvents(): string[] {
  const names = new Set<string>();
  for (const f of walk(new URL('../src/sim', import.meta.url).pathname)) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\bt: '([a-z][a-z0-9.-]*)'/g)) names.add(m[1]);
  }
  return [...names].sort();
}

// samples that make the conditional cues speak (a storm, a great chronicle line)
const SAMPLE: Record<string, Partial<{ a: number; text: string; data: Record<string, unknown> }>> = {
  'weather.start': { data: { kind: 'storm' } },
  chronicle: { a: 3 },
  command: { data: { k: 'hand.grab' } },
};

test('the scan finds the sim events (guards the regex itself)', () => {
  const ev = simEvents();
  assert.ok(ev.length > 80, `only ${ev.length} events found`);
  for (const t of ['tower.lost', 'secession', 'collapsed', 'fire.out', 'aid', 'death']) assert.ok(ev.includes(t), t);
});

test('every sim event is mapped to a cue, or explicitly silent', () => {
  const unmapped: string[] = [];
  for (const t of simEvents()) {
    if (t in SILENT_EVENTS || t in ARC_CUES) continue;
    const c = cueFor({ t, tick: 0, planet: 0, ...(SAMPLE[t] ?? {}) });
    if (!c) unmapped.push(t);
  }
  assert.deepEqual(unmapped, [], `sim events with no cue and no entry in SILENT_EVENTS: ${unmapped.join(', ')}`);
});

test('every cue a sim event maps to has an SFX recipe', () => {
  for (const t of simEvents()) {
    const probes = [{}, { data: { kind: 'storm', to: 'defiant', k: 'hand.grab', cause: 'x' } }, { a: 3, text: 'golden' }];
    for (const p of probes) {
      const c = cueFor({ t, tick: 0, planet: 0, ...p });
      if (c) assert.ok(SFX[c.cue], `${t} -> ${c.cue} has no recipe`);
    }
  }
});

test('a silent event is not also mapped, and each has a reason', () => {
  for (const [t, why] of Object.entries(SILENT_EVENTS)) {
    assert.ok(why.length > 10, `${t} needs a reason`);
    assert.equal(cueFor({ t, tick: 0, planet: 0 }), null, `${t} is listed silent but has a cue`);
    assert.ok(!(t in ARC_CUES), `${t} is in both tables`);
  }
});
