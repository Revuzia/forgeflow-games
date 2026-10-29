// GENESIS — the AUTHORED music (LIVING §0 "authored music"): the score modules (motif, title theme, the four era pieces)
// and the shipped Opus assets they were rendered to, and the director logic that weaves them with the procedural score
// (authored.ts). Node only: the scores are data, the assets are read as Ogg pages, the weave is pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUTHORED, AuthoredMusic, ERA_PIECE, STINGERS, StingerGate, TOWN_NEAR, idleWeave, pickStinger, stingerFor, pieceFor, sceneTension, stemLevels, weave, weaveLevel, weaveGains, FADE_IN, FADE_OUT, OVERRUN, HOLD_MAX } from '../src/audio/authored.ts';
import { MATCH, gatedLoudness, lufsOf, matchTrim, type Trim } from '../src/audio/loudness.ts';
import { MOTIF_HEAD, hasMotifHead, loopSeconds, melodiesOf, partsOf, stemsOf, STEMS, type Piece } from '../src/audio/score/motif.ts';
import { TITLE } from '../src/audio/score/title.ts';
import { ERAS } from '../src/audio/score/eras.ts';
import { STINGERS as STING_SCORES, STINGER_IDS } from '../src/audio/score/stingers.ts';
import type { SimEvent } from '../src/sim/types.ts';
import type { AudioScene } from '../src/audio/scene.ts';
import { DIRECT_LEVEL, SFX, directLevel, type Sfx } from '../src/audio/sfx.ts';

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
  // the people read nature's rainbow as the god's (god 0) — the town's omen cue plays, the stinger does not
  assert.equal(stingerFor(ev('omen', { kind: 'rainbow', god: 0 })), null, 'a reading is not the act');
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
  assert.equal(pickStinger([ev('disaster', { kind: 'eclipse', god: 0, cause: 'god' }), ev('omen', { kind: 'eclipse', god: 0 }), ev('command', { k: 'god.omen' })]), 'sign');
  // nature's eclipse and the towns' reading of it: news, no stinger
  assert.equal(pickStinger([ev('disaster', { kind: 'eclipse', god: -1, cause: 'nature' }), ev('omen', { kind: 'eclipse', god: 0 })]), null);
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

test('a wanted piece loads all its stems at once (never one stem per frame) and the stingers with them', () => {
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((url: string) => { asked.push(String(url)); return new Promise(() => { /* never answers */ }); }) as typeof fetch;
  try {
    const m = new AuthoredMusic({} as BaseAudioContext, {} as AudioNode);
    assert.equal(m.update(scene({ town: 0.5, era: 'bronze' }), 1, 1), 0, 'nothing sounds before the stems decode');
    const stems = Object.values(AUTHORED['era-bronze'].stems) as string[];
    for (const u of stems) assert.ok(asked.includes(u), `stem ${u} requested on the first frame`);
    for (const s of Object.values(STINGERS)) assert.ok(asked.includes(s.url), `stinger ${s.id} requested`);
    const n = asked.length;
    m.update(scene({ town: 0.5, era: 'bronze' }), 1.1, 1);
    assert.equal(asked.length, n, 'loads in flight are not requested again');
    assert.equal(m.state().piece, 'era-bronze');
    assert.equal(m.state().phase, 'idle', 'the procedural score plays until the piece is ready');
  } finally { globalThis.fetch = realFetch; }
});

test('the hand-over between a piece and the procedural score is slow and equal-power (fix r3 #14)', () => {
  assert.ok(FADE_IN >= 6 && FADE_IN <= 10, `fade in ${FADE_IN} s`);
  assert.ok(FADE_OUT >= 6 && FADE_OUT <= 12, `fade out ${FADE_OUT} s`);
  // the fade-out runs mostly over the next pass's quiet intro: the last pass ends nearly whole
  assert.ok(FADE_OUT - OVERRUN <= 2.5 && OVERRUN < FADE_OUT, `fade-out starts ${FADE_OUT - OVERRUN} s before the loop's end`);
  assert.deepEqual(weaveGains(0), { authored: 0, procedural: 1 });
  const top = weaveGains(1);
  assert.ok(top.authored === 1 && Math.abs(top.procedural) < 1e-12);
  for (let x = 0; x <= 1.0001; x += 0.05) {
    const g = weaveGains(x);
    assert.ok(Math.abs(g.authored ** 2 + g.procedural ** 2 - 1) < 1e-9, `power holds at ${x.toFixed(2)}`);
  }
  assert.deepEqual(weaveGains(-1), weaveGains(0));
  assert.deepEqual(weaveGains(2), weaveGains(1));
});

test('loudness gating follows BS.1770: silent and far-quieter blocks do not drag a sparse score down (fix r3 #14)', () => {
  const e = (lufs: number): number => 10 ** ((lufs + 0.691) / 10);
  assert.ok(Math.abs(lufsOf(e(-23)) - -23) < 1e-9);
  assert.equal(gatedLoudness([]), null);
  assert.equal(gatedLoudness([0, 0, e(-80)]), null, 'all under the absolute gate');
  const steady = Array.from({ length: 50 }, () => e(-24));
  assert.ok(Math.abs(gatedLoudness(steady)! - -24) < 1e-9);
  // a score that rests half its bars: the rests (silence, or 20 LU down) are gated out, the playing bars count
  const sparse = [...steady, ...Array.from({ length: 50 }, (_, i) => (i % 2 ? 0 : e(-44)))];
  assert.ok(Math.abs(gatedLoudness(sparse)! - -24) < 1e-9, `sparse ${gatedLoudness(sparse)}`);
  // blocks 4 LU under the mean are within the relative gate and count
  const mixed = [...Array.from({ length: 10 }, () => e(-20)), ...Array.from({ length: 10 }, () => e(-24))];
  const want = lufsOf((e(-20) + e(-24)) / 2);
  assert.ok(Math.abs(gatedLoudness(mixed)! - want) < 1e-9);
});

test('a piece is trimmed to arrive a little over the score it takes over from, within the review\'s 3 LU (fix r3 #14)', () => {
  assert.ok(MATCH.over >= 0 && MATCH.over <= 2, `over ${MATCH.over} LU`);
  // calibrated in the lab (src/audio/loudness.ts MATCH): the dry meter reads the rendered score within ~0.3 LU
  assert.ok(Math.abs(MATCH.wet) <= 0.5, `wet ${MATCH.wet} LU`);
  assert.ok(MATCH.secs >= 10 && MATCH.secs < HOLD_MAX, 'a town\'s score is measured within the first appearance\'s wait');
  assert.deepEqual(matchTrim(null, 0.48), { trim: 0.48, measured: false, proc: null }, 'unmeasured: the fixed trim');
  for (const proc of [-30, -27, -24, -21, -18]) {
    const t = matchTrim(proc, 0.48);
    assert.ok(t.measured);
    const piece = MATCH.authored + 20 * Math.log10(t.trim);
    const gap = piece - (proc + MATCH.wet);
    assert.ok(Math.abs(gap - MATCH.over) < 1e-9, `score ${proc} LUFS: the piece sits ${gap.toFixed(2)} LU over it`);
  }
  // a near-silent score never makes the piece vanish; a loud one never pushes it past its mastered level
  assert.equal(matchTrim(-60, 0.48).trim, MATCH.min);
  assert.equal(matchTrim(-8, 0.48).trim, MATCH.max);
  assert.ok(MATCH.max <= 1 && MATCH.min >= 0.1);
  // the fixed fallbacks (a town not yet measured, the title's first appearance at the opening) stay in range
  for (const p of Object.values(AUTHORED)) assert.ok(p.gain >= MATCH.min && p.gain <= MATCH.max, `${p.id} gain ${p.gain}`);
});

test('arriving at a town, its piece waits for the town\'s score to be measured, then plays at the matched trim; the title never waits', async () => {
  const param = (): AudioParam => ({ value: 0, setTargetAtTime() { return this; }, cancelScheduledValues() { return this; } }) as unknown as AudioParam;
  const node = (): Record<string, unknown> => ({ connect() {}, disconnect() {} });
  const ctx = {
    currentTime: 0,
    createGain: () => ({ ...node(), gain: param() }),
    createBufferSource: () => ({ ...node(), buffer: null, loop: false, loopStart: 0, loopEnd: 0, start() {}, stop() {} }),
    decodeAudioData: () => Promise.resolve({ duration: 999 }),
  } as unknown as BaseAudioContext;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) })) as unknown as typeof fetch;
  const settle = async (): Promise<void> => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); };
  try {
    const town = scene({ town: 0.5, era: 'bronze' });
    // not measured yet: the town's own score plays; after HOLD_MAX the piece comes in at its fixed trim
    let measured = false;
    const asked: string[] = [];
    const trimFor = (piece: string): Trim => { asked.push(piece); return measured ? matchTrim(-26, AUTHORED[piece].gain) : matchTrim(null, AUTHORED[piece].gain); };
    const m = new AuthoredMusic(ctx, node() as unknown as AudioNode);
    m.update(town, 0, 1, trimFor);
    await settle();
    m.update(town, 1, 1, trimFor);
    assert.equal(m.state().phase, 'idle', 'the stems are ready, yet the piece waits for the town\'s score');
    m.update(town, HOLD_MAX - 1, 1, trimFor);
    assert.equal(m.state().phase, 'idle');
    m.update(town, HOLD_MAX + 0.1, 1, trimFor);
    assert.equal(m.state().phase, 'play', 'the wait is bounded');
    assert.deepEqual(m.state().trim, { trim: AUTHORED['era-bronze'].gain, measured: false, proc: null });
    // measured: the piece starts as soon as the measurement is in, at the matched trim, held for the appearance
    const m2 = new AuthoredMusic(ctx, node() as unknown as AudioNode);
    measured = false;
    m2.update(town, 0, 1, trimFor);
    await settle();
    m2.update(town, 5, 1, trimFor);
    assert.equal(m2.state().phase, 'idle');
    measured = true;
    m2.update(town, 14, 1, trimFor);
    assert.equal(m2.state().phase, 'play');
    const t = m2.state().trim!;
    assert.ok(t.measured && Math.abs(t.trim - Math.round(matchTrim(-26, 1).trim * 1000) / 1000) < 1e-9 && t.proc === -26, JSON.stringify(t));
    measured = false;
    m2.update(town, 30, 1, trimFor);
    assert.deepEqual(m2.state().trim, t, 'never re-trimmed mid-appearance');
    // the title opens the game: no wait, whatever the measurement
    const m3 = new AuthoredMusic(ctx, node() as unknown as AudioNode);
    m3.update(scene({ orbital: 1 }), 0, 1, trimFor);
    await settle();
    m3.update(scene({ orbital: 1 }), 0.5, 1, trimFor);
    assert.equal(m3.state().piece, 'title');
    assert.equal(m3.state().phase, 'play');
    assert.equal(m3.state().trim?.trim, AUTHORED.title.gain);
  } finally { globalThis.fetch = realFetch; }
});

// ───────────────────────────── the opening's ignition (fix r4 #12) ─────────────────────────────

/**
 * The ignition through the real engine and mix chain (glue compressor, limiter, soft clipper), music held as in the
 * opening, ambience as at orbit: _harness/scratch/audio/lab.mjs scenes 'ign-levels' and 'ign-repeat' (44.1 kHz), ffmpeg
 * ebur128 over the 12.5 s from the cue. level -> [integrated LUFS, true peak dBFS, short-term max LUFS]; at 0.25 the
 * loudest / highest of five draws (the crack's peak moves with the noise's draw). Measured with the recipe as it is now
 * (its sub-bass 6 dB down); change the recipe or the level outside this table and re-measure.
 */
const IGN_LAB: [number, number, number, number][] = [
  [1, -12.4, -2.0, -11.3], [0.4, -18.7, -4.0, -16.6], [0.28, -20.3, -5.8, -19.1], [0.25, -20.9, -6.7, -19.4], [0.2, -22.0, -7.7, -20.7],
];
/** the lab against the built game (the old recipe at level 1: lab -11.9 / -2.0 / -10.2, game -12.2 / -1.7 / -10.9) */
const LAB_TO_GAME = { lufs: -0.3, peak: 0.3 };
/** the opening's music after the ignition in the built game (r4first.webm: 33-93 s, 100-220 s) */
const GAME_MUSIC = [-22.6, -20.9];

test('the opening\'s ignition lands just over the music that rises out of it and peaks under -6 dBFS (fix r4 #12)', () => {
  const lv = directLevel('ignition');
  assert.equal(lv, DIRECT_LEVEL.ignition);
  assert.equal(directLevel('whisper'), 1, 'other cues play at their own level');
  const at = (level: number, col: 1 | 2 | 3): number => {
    const rows = [...IGN_LAB].sort((p, q) => p[0] - q[0]);
    assert.ok(level >= rows[0][0] && level <= rows.at(-1)![0], `level ${level} is outside the measured range: re-measure (lab.mjs ign-levels)`);
    for (let i = 1; i < rows.length; i++) {
      const [a, b] = [rows[i - 1], rows[i]];
      if (level <= b[0]) { const k = Math.log(level / a[0]) / Math.log(b[0] / a[0]); return a[col] + (b[col] - a[col]) * k; }
    }
    return rows.at(-1)![col];
  };
  const game = (level: number) => ({ lufs: at(level, 1) + LAB_TO_GAME.lufs, peak: at(level, 2) + LAB_TO_GAME.peak, short: at(level, 3) + LAB_TO_GAME.lufs });
  const g = game(lv);
  for (const m of GAME_MUSIC) {
    assert.ok(g.lufs - m <= 3, `the ignition ${g.lufs.toFixed(1)} LUFS is ${(g.lufs - m).toFixed(1)} LU over the music (${m})`);
    assert.ok(g.lufs - m >= -2, `the ignition ${g.lufs.toFixed(1)} LUFS is lost under the music (${m})`);
  }
  assert.ok(g.peak <= -6, `true peak ${g.peak.toFixed(1)} dBFS`);
  assert.ok(g.short <= -18, `short-term max ${g.short.toFixed(1)} LUFS`);
  // the review's finding, as measured: at full level it stood ~10 LU over the game, near clipping
  const old = game(1);
  assert.ok(old.lufs - GAME_MUSIC[0] > 9 && old.peak > -3);
  // the cue is the one measured: the crescendo (a roar that swells for seconds), the crack at 2.5 s (a bright noise
  // burst), the chord's bloom, and the sub-bass (tones under 40 Hz, brown rumble) at the level the table was taken at
  const calls: [string, ...unknown[]][] = [];
  const rec: Record<string | symbol, unknown> = { t: 0, size: 1, count: 1, variant: '', r: () => 0.5, rr: (a: number, b: number) => (a + b) / 2 };
  SFX.ignition(new Proxy(rec, { get: (o, k) => (k in o ? o[k] : (...args: unknown[]) => { calls.push([String(k), ...args]); return 0; }) }) as unknown as Sfx);
  const n = (c: [string, ...unknown[]], i: number): number => c[i] as number;
  assert.ok(calls.some((c) => c[0] === 'tn' && n(c, 6) >= 2), 'the crescendo (a tone whose attack takes 2 s or more)');
  assert.ok(calls.some((c) => c[0] === 'nz' && c[1] === 'white' && n(c, 2) === 2.5 && n(c, 3) < 0.01), 'the crack');
  assert.ok(calls.some((c) => c[0] === 'pad'), 'the bloom');
  const sub = calls.filter((c) => (c[0] === 'tn' && Math.min(n(c, 3), n(c, 4)) < 40) || (c[0] === 'nz' && c[1] === 'brown'));
  const subPeak = sub.reduce((t, c) => t + (c[0] === 'tn' ? n(c, 9) : n(c, 6)), 0);
  assert.equal(sub.length, 3);
  assert.ok(Math.abs(subPeak - 0.715) < 1e-9, `sub-bass peaks ${subPeak} (measured at 0.715): re-measure`);
  // the game plays it at that level: the opening names none, the engine's direct path falls back to DIRECT_LEVEL
  const engine = readFileSync(fileURLToPath(new URL('../src/audio/engine.ts', import.meta.url)), 'utf8');
  assert.match(engine, /gain: o\.level \?\? directLevel\(name\)/);
  assert.match(engine, /if \(name === 'ignition'\) \{\s*this\.musicHoldUntil = now \+ 9;/, 'the music is still held under it');
  const opening = readFileSync(fileURLToPath(new URL('../src/ui/opening.ts', import.meta.url)), 'utf8');
  assert.match(opening, /this\.host\.sound\('ignition'\)/);
});

