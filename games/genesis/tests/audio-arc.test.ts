// ARC §6.3 / §8.0: every arc event has a cue the SFX catalog plays, or an explicit null; none is an authored stinger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ARC_CUES, cueFor } from '../src/audio/eventmap.ts';
import { stingerFor } from '../src/audio/authored.ts';
import { SFX } from '../src/audio/sfx.ts';

const ARC_EVENTS = [
  'heart', 'heart.proud', 'tower.begun', 'tower.tier', 'tower.omen', 'tower.choice', 'tower.warned', 'tower.heeded',
  'tower.refused', 'tower.confused', 'tower.struck', 'tower.finished', 'tower.abandoned', 'tower.rebuilt', 'defy',
  'defy.answered', 'covenant.offered', 'covenant.bow', 'covenant.made', 'covenant.kept', 'covenant.refused',
  'covenant.broken', 'chronicle.age', 'legend.retold',
];
const STINGER_CUES = ['answered', 'wrath', 'sign', 'fulfilled'];

test('every §6.3 event is in the arc table (a cue or an explicit null), and nothing else is', () => {
  for (const t of ARC_EVENTS) assert.ok(t in ARC_CUES, `${t} is not mapped`);
  assert.deepEqual(Object.keys(ARC_CUES).sort(), [...ARC_EVENTS].sort());
});

test('each mapped cue has a recipe, and no arc event plays or triggers an authored stinger', () => {
  const datas = [{}, { to: 'defiant' }, { to: 'devoted' }, { to: 'fearful' }, { kind: 'hurl' }, { kind: 'flood' }, { kind: 'plenty' }];
  for (const t of ARC_EVENTS) {
    for (const data of datas) {
      const e = { t, tick: 0, planet: 0, data };
      const c = cueFor(e);
      if (c) {
        assert.ok(SFX[c.cue], `${t} -> ${c.cue} has no recipe`);
        assert.ok(!STINGER_CUES.includes(c.cue), `${t} -> stinger ${c.cue}`);
      }
      assert.equal(stingerFor(e), null, `${t} triggers a stinger`);
    }
  }
});

test('the cues the spec names (§1.6, §2.6, §3.4, §4.5, §5.5)', () => {
  const c = (t: string, data: Record<string, unknown> = {}) => cueFor({ t, tick: 0, data });
  assert.equal(c('heart', { to: 'defiant' })?.cue, 'crowd.jeer');
  assert.equal(c('heart', { to: 'defiant' })?.gain, 0.45);
  assert.equal(c('heart', { to: 'devoted' })?.cue, 'crowd.hymn');
  assert.equal(c('heart', { to: 'fearful' }), null);
  assert.equal(c('heart.proud', { proud: true }), null);
  assert.equal(c('tower.begun')?.cue, 'toil.drums');
  assert.equal(c('tower.begun')?.gap, 30);
  assert.equal(c('tower.tier')?.cue, 'toil.chant');
  assert.equal(c('tower.choice')?.cue, 'ui.great');
  assert.equal(c('tower.confused')?.cue, 'babel.babble');
  assert.equal(c('tower.confused')?.cls, 'god');
  assert.equal(c('tower.struck')?.cue, 'masonry.collapse');
  assert.equal(c('tower.finished')?.cue, 'crowd.cheer');
  assert.equal(c('tower.warned'), null);
  assert.equal(c('defy', { kind: 'curse' })?.cue, 'crowd.shout');
  assert.equal(c('defy.answered'), null);
  assert.equal(c('covenant.bow')?.cue, 'covenant.chime');
  assert.equal(c('covenant.broken')?.cue, 'covenant.chime.broken');
  assert.equal(c('covenant.kept')?.cue, 'ui.great');
  assert.equal(c('covenant.offered'), null);
  assert.equal(c('chronicle.age', { kind: 'flood' })?.cue, 'age.dark');
  assert.equal(c('chronicle.age', { kind: 'plenty' })?.cue, 'age.golden');
});

test('the new arc recipes lay down layers without error (a recording builder)', () => {
  const NEW = ['crowd.jeer', 'crowd.hymn', 'toil.drums', 'toil.chant', 'ui.great', 'babel.babble', 'masonry.collapse',
    'crowd.cheer', 'crowd.shout', 'stone.knock', 'covenant.chime', 'covenant.chime.broken', 'ui.deny'];
  for (const name of NEW) {
    let calls = 0, seed = 1;
    const rec = new Proxy({ variant: '', size: 1, count: 1 } as Record<string, unknown>, {
      get(o, k) {
        if (k in o) return o[k as string];
        if (k === 'r') return () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        if (k === 'rr') return (a: number, b: number) => a + (b - a) * 0.5;
        return () => { calls++; return 0; };
      },
    });
    (SFX[name] as unknown as (s: unknown) => void)(rec);
    assert.ok(calls >= 2, `${name} laid ${calls} layers`);
  }
});
