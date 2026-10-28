// GENESIS — the AUTHORED music (LIVING §0 "authored music"): the score modules (motif, title theme, the four era pieces)
// and the shipped Opus assets they were rendered to, and the director logic that weaves them with the procedural score
// (authored.ts). Node only: the scores are data, the assets are read as Ogg pages, the weave is pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUTHORED, ERA_PIECE, STINGERS, StingerGate, TOWN_NEAR, idleWeave, pickStinger, stingerFor, pieceFor, sceneTension, stemLevels, weave, weaveLevel, FADE_IN, OVERRUN } from '../src/audio/authored.ts';
import { MOTIF_HEAD, hasMotifHead, loopSeconds, melodiesOf, partsOf, stemsOf, STEMS, type Piece } from '../src/audio/score/motif.ts';
import { TITLE } from '../src/audio/score/title.ts';
import { ERAS } from '../src/audio/score/eras.ts';
import { STINGERS as STING_SCORES, STINGER_IDS } from '../src/audio/score/stingers.ts';
import type { SimEvent } from '../src/sim/types.ts';
import type { AudioScene } from '../src/audio/scene.ts';

const ASSETS = fileURLToPath(new URL('../src/audio/assets/', import.meta.url));
const SCORES: Piece[] = [TITLE, ...ERAS];

/** an Ogg Opus file's playable length in seconds (last page's granule position minus the pre-skip, at 48 kHz) */
function opusSeconds(file: string): number {
  const b = readFileSync(file);
  assert.equal(b.toString('latin1', 0, 4), 'OggS', `${file}: not an Ogg stream`);
  const head = b.indexOf('OpusHead');
  assert.ok(head > 0, `${file}: not Opus`);
  const preskip = b.readUInt16LE(head + 10);
  const last = b.lastIndexOf('OggS');
  const granule = Number(b.readBigUInt64LE(last + 6));
  return (granule - preskip) / 48000;
}

function scene(o: { orbital?: number; town?: number; era?: string; day?: number; war?: boolean; fire?: number }): AudioScene {
  const music = o.town ? [{ key: 'st:1', weight: o.town, pan: 0, culture: { id: 1, era: o.era ?? 'stone', war: !!o.war } }] : [];
  return {
    orbital: o.orbital ?? 0, day: o.day ?? 1, music,
    layers: { fire: o.fire ?? 0, lava: 0, quake: 0, thunderRate: 0, heartbeat: 0, ash: 0 },
  } as unknown as AudioScene;
}

test('every authored piece states the GENESIS motif head (D A G A C: +7 −2 +2 +3) in a melody part', () => {
  assert.deepEqual(MOTIF_HEAD, [7, -2, 2, 3]);
  for (const p of SCORES) assert.ok(melodiesOf(p).some(hasMotifHead), `${p.id} never states the motif`);
});

test('the era pieces: four stems each, the tune always in main, every bar of the loop written', () => {
  assert.equal(ERAS.length, 4);
  for (const p of ERAS) {
    assert.deepEqual(stemsOf(p), STEMS, `${p.id} stems`);
    // main carries the motif on its own, so any mix of stems is complete music
    assert.ok(p.parts.filter((sp) => (sp.stem ?? 'main') === 'main').some((sp) => sp.role === 'melody' && hasMotifHead([...sp.notes].sort((a, b) => a.b - b.b).map((n) => n.midi))), `${p.id} main lacks the motif`);
    const beats = p.bars * p.beatsPerBar;
    for (const s of STEMS) {
      const parts = partsOf(p, s);
      assert.ok(parts.length > 0 && parts.every((x) => x.notes.length > 0), `${p.id}/${s} is empty`);
      // nothing starts past the loop (a release may run over: renderLoop folds it into bar 1)
      for (const sp of p.parts) for (const n of sp.notes) assert.ok(n.b >= 0 && n.b < beats, `${p.id}: a note at beat ${n.b} outside ${beats}`);
    }
    const sec = loopSeconds(p);
    assert.ok(sec >= 45 && sec <= 75, `${p.id}: loop ${sec.toFixed(1)} s`);
  }
  const title = loopSeconds(TITLE);
  assert.ok(title >= 120 && title <= 180, `title theme ${title.toFixed(1)} s (brief: 2–3 min)`);
});

test('AUTHORED matches the scores: same loop length, every era has its stems, every sim era has a piece', () => {
  for (const p of SCORES) {
    const a = AUTHORED[p.id];
    assert.ok(a, `${p.id} not shipped`);
    assert.ok(Math.abs(a.loop - loopSeconds(p)) < 1e-6, `${p.id}: AUTHORED loop ${a.loop} vs score ${loopSeconds(p)}`);
    const want = p.id === 'title' ? ['main'] : STEMS;
    assert.deepEqual(Object.keys(a.stems).sort(), [...want].sort(), `${p.id} stems`);
  }
  for (const era of ['stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space']) {
    assert.ok(AUTHORED[ERA_PIECE[era]], `no piece for era ${era}`);
  }
});

test('the shipped assets: Ogg Opus, each as long as its loop, all together within the 3 MB budget', () => {
  let total = 0;
  for (const f of readdirSync(ASSETS)) total += statSync(ASSETS + f).size;
  assert.ok(total <= 3 * 1024 * 1024, `authored audio is ${(total / 1048576).toFixed(2)} MB`);
  for (const a of Object.values(AUTHORED)) {
    for (const [role, href] of Object.entries(a.stems)) {
      const file = fileURLToPath(href as string);
      assert.ok(existsSync(file), `${a.id}/${role}: ${file} missing`);
      const s = opusSeconds(file);
      assert.ok(s >= a.loop - 0.005 && s <= a.loop + 0.1, `${a.id}/${role}: ${s.toFixed(3)} s for a ${a.loop.toFixed(3)} s loop`);
    }
  }
});

test('pieceFor: the title theme in orbit, a town\'s era piece near it, hysteresis at the edges', () => {
  assert.equal(pieceFor(null), null);
  assert.equal(pieceFor(scene({ orbital: 1 })), 'title');
  assert.equal(pieceFor(scene({ orbital: 0 })), null, 'the wilds: the procedural score and the ambience');
  assert.equal(pieceFor(scene({ town: 0.5, era: 'stone' })), 'era-stone');
  assert.equal(pieceFor(scene({ town: 0.5, era: 'iron' })), 'era-bronze');
  assert.equal(pieceFor(scene({ town: 0.5, era: 'gunpowder' })), 'era-medieval');
  assert.equal(pieceFor(scene({ town: 0.5, era: 'space' })), 'era-engines');
  assert.equal(pieceFor(scene({ town: 0.5, era: 'unknown-era' })), null);
  // hysteresis: a town just under the threshold keeps its piece once it plays, but does not start it
  const edge = scene({ town: TOWN_NEAR * 0.8, era: 'medieval' });
  assert.equal(pieceFor(edge), null);
  assert.equal(pieceFor(edge, 'era-medieval'), 'era-medieval');
  assert.equal(pieceFor(scene({ orbital: 0.3 })), null);
  assert.equal(pieceFor(scene({ orbital: 0.3 }), 'title'), 'title');
});

test('the weave: plays its passes, rests while the procedural score sings, returns; fades at the edges', () => {
  const p = AUTHORED['era-stone'];
  let w = weave(idleWeave(), 'era-stone', 10, false);
  assert.equal(w.phase, 'idle', 'not ready: the procedural score plays on');
  w = weave(w, 'era-stone', 11, true);
  assert.equal(w.phase, 'play');
  assert.equal(weaveLevel(w, 11), 0);
  assert.ok(Math.abs(weaveLevel(w, 11 + FADE_IN / 2) - 0.5) < 1e-9);
  assert.equal(weaveLevel(w, 11 + 30), 1);
  const end = 11 + p.passes * p.loop + OVERRUN;
  assert.ok(Math.abs(w.until - end) < 1e-9);
  w = weave(w, 'era-stone', end + 0.01, true);
  assert.equal(w.phase, 'rest');
  assert.equal(weaveLevel(w, end + 1), 0);
  w = weave(w, 'era-stone', end + p.rest + 0.02, true);
  assert.equal(w.phase, 'play', 'returns after its rest');
  assert.equal(weave(w, null, end + p.rest + 1, true).phase, 'idle');
});

test('stems follow the scene: daylight cross-fades day and night (equal power), danger raises tension', () => {
  const noon = stemLevels(scene({ day: 1 }), 0), midnight = stemLevels(scene({ day: 0 }), 0);
  assert.equal(noon.main, 1); assert.equal(noon.day, 1); assert.equal(noon.night, 0);
  assert.equal(midnight.day, 0); assert.equal(midnight.night, 1);
  const dusk = stemLevels(scene({ day: 0.4 }), 0);
  assert.ok(Math.abs(dusk.day ** 2 + dusk.night ** 2 - 1) < 1e-9, 'equal-power cross-fade');
  assert.equal(stemLevels(scene({}), 0.7).tension, 0.7);
  assert.equal(sceneTension(scene({})), 0);
  assert.ok(sceneTension(scene({ town: 0.5, war: true })) > 0.5, 'war near the listener');
  assert.ok(sceneTension(scene({ fire: 1 })) >= 0.8, 'fire');
});

test('the stingers: each states the motif head, matches its score\'s phrase, ships as a short Opus file', () => {
  assert.deepEqual(Object.keys(STINGERS).sort(), [...STINGER_IDS].sort());
  for (const id of STINGER_IDS) {
    const p = STING_SCORES[id];
    assert.ok(melodiesOf(p).some(hasMotifHead), `${id}: no melody states the motif head`);
    assert.ok(Math.abs(STINGERS[id].phrase - loopSeconds(p)) < 1e-9, `${id}: phrase ${STINGERS[id].phrase} vs score ${loopSeconds(p)}`);
    const file = fileURLToPath(STINGERS[id].url);
    assert.ok(existsSync(file), `${id}: ${file} missing`);
    const s = opusSeconds(file);
    // the phrase plus its reverb tail, never a long cue
    assert.ok(s >= loopSeconds(p) && s <= loopSeconds(p) + 6, `${id}: ${s.toFixed(2)} s`);
    assert.ok(statSync(file).size < 80_000, `${id}: ${statSync(file).size} bytes`);
  }
});

test('stingers answer the god\'s moments only: its prayers, prophecies, signs and wrath — not nature\'s or a rival\'s', () => {
  const ev = (t: string, data: Record<string, unknown> = {}): SimEvent => ({ t, data } as unknown as SimEvent);
  assert.equal(stingerFor(ev('prayer.answered', { settlement: 3, kind: 'rain' })), 'answered');
  assert.equal(stingerFor(ev('prophet.fulfilled', { prophecy: 1 })), 'fulfilled');
  assert.equal(stingerFor(ev('omen', { kind: 'rainbow', god: 0 })), 'sign');
  assert.equal(stingerFor(ev('omen', { kind: 'comet', god: -1 })), null, 'a natural omen');
  assert.equal(stingerFor(ev('omen', { kind: 'comet', god: 2 })), null, 'a rival god\'s omen');
  assert.equal(stingerFor(ev('disaster', { kind: 'quake', god: 0, cause: 'god' })), 'wrath');
  assert.equal(stingerFor(ev('disaster', { kind: 'quake', god: -1, cause: 'nature' })), null);
  assert.equal(stingerFor(ev('disaster', { kind: 'flood', god: 1, cause: 'god' })), null, 'a rival\'s flood');
  assert.equal(stingerFor(ev('prayer.raised')), null);
  assert.equal(stingerFor(ev('command', { k: 'god.omen' })), 'sign', 'the sign itself, even unseen');
  assert.equal(stingerFor(ev('command', { k: 'miracle.water' })), null);
  // an unseen sign by comet: the command and the god-sent comet arrive together — a sign
  assert.equal(pickStinger([ev('command', { k: 'god.omen' }), ev('disaster', { kind: 'comet', god: 0, cause: 'god' })]), 'sign');
  // a sign by eclipse spawns a god-sent eclipse in the same tick: the batch is a sign, not wrath
  assert.equal(pickStinger([ev('disaster', { kind: 'eclipse', god: 0, cause: 'god' }), ev('omen', { kind: 'eclipse', god: 0 })]), 'sign');
  assert.equal(pickStinger([ev('prayer.answered'), ev('prophet.fulfilled')]), 'fulfilled');
  assert.equal(pickStinger([ev('birth'), ev('death')]), null);
});

test('stinger pacing: one gap per stinger, a phrase is cut only by a higher one', () => {
  const g = new StingerGate();
  assert.ok(g.admit('answered', 0));
  assert.ok(!g.admit('answered', 5), 'within its gap');
  assert.ok(!g.admit('answered', STINGERS.answered.gap - 0.1));
  assert.ok(g.admit('fulfilled', 1), 'a prophecy kept outranks an answered prayer');
  assert.ok(!g.admit('wrath', 2), 'wrath does not cut the prophecy\'s phrase');
  assert.ok(g.admit('wrath', 1 + STINGERS.fulfilled.phrase + 0.01), 'after the phrase it may play');
});
