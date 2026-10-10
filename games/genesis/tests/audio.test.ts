// GENESIS — audio tests (CONTRACT §17, §19). Node only: nothing here needs WebAudio. Covers the music generator
// (modes, scales, Euclidean rhythms, culture styles, determinism of every bar, notes always in the mode, ensembles by
// era), the DSP kernels (seamless loops, plucked-string tuning, bounded soft clipper), the scene probe on a synthetic
// world (airless heartbeat, orbit, day birds / night insects, surf toward the shore, rain, fire, crowds and their
// music), the event → sound map against the content (every disaster kind, every miracle, the hand), the interface
// cues (one action heard once, per-cue gaps, the rate cap) and the one mute shared with the ForgeFlow portal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENSEMBLES, MODE_NAMES, ORBITAL_SET, composeBar, degreeToMidi, euclid, inScale, midiToHz, modeIntervals, modeOfAlignment,
  orbitalStyle, setOfEra, styleFor, type CultureMusic, type MusicStyle,
} from '../src/audio/music.ts';
import { foldLoop, peakOf, renderBell, renderCrickets, renderImpulse, renderNoise, renderPluck, softClipCurve, CHIME, hash32 } from '../src/audio/dsp.ts';
import { SceneProbe, type ScenePlanet, type SceneWorld } from '../src/audio/scene.ts';
import { CueGate, DISASTER_FAMILIES, MIRACLE_KINDS, commandCue, cueFor, disasterFamily } from '../src/audio/eventmap.ts';
import { SFX } from '../src/audio/sfx.ts';
import { disasterBed } from '../src/audio/emitters.ts';
import { UI_CUE, UI_RATE, UI_SHADOW, UiCueMixer, isUiCue, uiRule } from '../src/audio/uicues.ts';
import { MuteSync, type PortalControls } from '../src/audio/mutesync.ts';
import { createAudio } from '../src/audio/engine.ts';
import { getGrid } from '../src/sim/grid/icogrid.ts';
import type { FieldName, PlanetParams, SettlementView, SimEvent } from '../src/sim/types.ts';
import disasterData from '../src/data/disasters.json' with { type: 'json' };
import powerData from '../src/data/powers.json' with { type: 'json' };

// ───────────────────────────── theory ─────────────────────────────

test('modes are rotations of the major scale with the right intervals', () => {
  const expect: Record<string, number[]> = {
    ionian: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
    lydian: [0, 2, 4, 6, 7, 9, 11], mixolydian: [0, 2, 4, 5, 7, 9, 10], aeolian: [0, 2, 3, 5, 7, 8, 10],
    locrian: [0, 1, 3, 5, 6, 8, 10],
  };
  MODE_NAMES.forEach((name, m) => assert.deepEqual(modeIntervals(m), expect[name], name));
  // degrees wrap into octaves both ways
  assert.equal(degreeToMidi(60, 0, 0), 60);
  assert.equal(degreeToMidi(60, 0, 7), 72);
  assert.equal(degreeToMidi(60, 0, -1), 59);
  assert.equal(degreeToMidi(60, 5, -7), 48);
  assert.equal(degreeToMidi(62, 1, 9), 62 + 12 + 3);
  for (let m = 0; m < 7; m++) for (let d = -14; d <= 21; d++) assert.ok(inScale(57, m, degreeToMidi(57, m, d)), `mode ${m} degree ${d}`);
  assert.ok(!inScale(60, 0, 61));
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9 && Math.abs(midiToHz(81) - 880) < 1e-9);
});

test('Euclidean rhythms spread k onsets over n steps', () => {
  const s = (k: number, n: number, r = 0): string => euclid(k, n, r).map((x) => (x ? 'x' : '.')).join('');
  assert.equal(s(3, 8), 'x..x..x.');
  assert.equal(s(4, 8), 'x.x.x.x.');
  assert.equal(s(0, 5), '.....');
  assert.equal(s(5, 5), 'xxxxx');
  for (let n = 1; n <= 16; n++) for (let k = 0; k <= n; k++) assert.equal(euclid(k, n, 3).filter(Boolean).length, k);
});

// ───────────────────────────── styles ─────────────────────────────

const culture = (o: Partial<CultureMusic> = {}): CultureMusic => ({ id: 7, language: 3, species: 0, alignment: 0.1, era: 'bronze', population: 60, ...o });

test('a culture always gets the same style; the sim hint decides mode, tempo and ensemble', () => {
  const a = styleFor(culture({ mode: 1, tempo: 92, instruments: 1 }));
  const b = styleFor(culture({ mode: 1, tempo: 92, instruments: 1 }));
  assert.deepEqual(a, b);
  assert.equal(a.mode, 1);
  assert.equal(a.tempo, 92);
  assert.equal(a.set, 1);
  assert.equal(a.ensemble.melody, 'lyre');
  // the tongue is the tune family: other languages get other tunes
  const keys = new Set<string>();
  for (let lang = 0; lang < 24; lang++) {
    const s = styleFor(culture({ language: lang, mode: 1, tempo: 92, instruments: 1 }));
    keys.add(JSON.stringify([s.tonic, s.beats, s.sub, s.form, s.progressions, s.motifs]));
  }
  assert.ok(keys.size >= 20, `24 languages gave only ${keys.size} distinct tunes`);
});

test('without a hint: era picks the ensemble, alignment the mode', () => {
  assert.equal(setOfEra('stone'), 0);
  assert.equal(setOfEra('clay'), 0);
  assert.equal(setOfEra('bronze'), 1);
  assert.equal(setOfEra('medieval'), 1);
  assert.equal(setOfEra('gunpowder'), 2);
  assert.equal(setOfEra('steam'), 2);
  assert.equal(setOfEra('electric'), 3);
  assert.equal(setOfEra('space'), 3);
  for (let seed = 0; seed < 10; seed++) {
    assert.ok([0, 3].includes(modeOfAlignment(0.8, seed)), 'benevolent: ionian / lydian');
    assert.ok([2, 6].includes(modeOfAlignment(-0.8, seed)), 'fearful: phrygian / locrian');
    assert.ok([1, 4, 5].includes(modeOfAlignment(0, seed)), 'between: dorian / mixolydian / aeolian');
  }
  const kind = styleFor(culture({ alignment: 0.9, era: 'stone' }));
  assert.equal(kind.ensemble.melody, 'flute');
  assert.ok([0, 3].includes(kind.mode));
  const cruel = styleFor(culture({ alignment: -0.9, era: 'electric' }));
  assert.equal(cruel.ensemble.melody, 'lead');
  assert.ok([2, 6].includes(cruel.mode));
  assert.ok(cruel.brightness < kind.brightness);
  // instruments by era: drums/flutes → lyres/strings → brass/organ → synth
  assert.deepEqual(ENSEMBLES.slice(0, 4).map((e) => [e.melody, e.pad]), [['flute', 'drone'], ['lyre', 'strings'], ['horn', 'organ'], ['lead', 'synthpad']]);
  assert.ok(ENSEMBLES[0].perc.includes('framedrum') && ENSEMBLES[0].perc.includes('logdrum'));
});

// ───────────────────────────── composing ─────────────────────────────

function checkBars(s: MusicStyle, bars: number, label: string): number {
  const allowed = new Set<string>([s.ensemble.melody, s.ensemble.counter, s.ensemble.pad, s.ensemble.bass ?? '', ...s.ensemble.perc, 'drone', 'voice', 'wardrum']);
  let notes = 0;
  for (let b = 0; b < bars; b++) {
    const ev = composeBar(s, b);
    for (const e of ev) {
      assert.ok(allowed.has(e.inst), `${label} bar ${b}: ${e.inst} is not in ${s.ensemble.name}`);
      assert.ok(e.t >= 0 && e.t < s.beats + 1e-9, `${label} bar ${b}: onset ${e.t} outside the bar`);
      assert.ok(e.d > 0, `${label}: duration ${e.d}`);
      assert.ok(e.v > 0 && e.v <= 1, `${label}: velocity ${e.v}`);
      if (e.part !== 'perc') {
        notes++;
        assert.ok(inScale(s.tonic, s.mode, e.midi), `${label} bar ${b}: ${e.inst} ${e.midi} is outside ${MODE_NAMES[s.mode]} on ${s.tonic}`);
        assert.ok(e.midi >= 12 && e.midi <= 112, `${label}: pitch ${e.midi}`);
      }
    }
    if (b < 2 && s.set !== ORBITAL_SET) assert.ok(!ev.some((e) => e.part === 'melody'), `${label}: the tune enters after the intro`);
  }
  return notes;
}

test('every bar of every culture stays in its mode, with its ensemble, inside the bar', () => {
  for (let set = 0; set < 4; set++) for (let mode = 0; mode < 7; mode++) for (const lang of [1, 9, 33]) {
    const s = styleFor(culture({ language: lang, mode, instruments: set, tempo: 60 + mode * 12, population: 40 + lang * 5 }));
    const n = checkBars(s, 64, `set ${set} mode ${mode} lang ${lang}`);
    assert.ok(n > 64, 'it plays something');
  }
  const o = orbitalStyle(42);
  assert.equal(o.set, ORBITAL_SET);
  checkBars({ ...o }, 64, 'orbital');
  for (let b = 0; b < 32; b++) assert.ok(!composeBar(o, b).some((e) => e.part === 'perc'), 'the orbital score has no drums');
});

test('composition is deterministic and independent of the order bars are asked for', () => {
  const s = styleFor(culture({ language: 12, mode: 5, tempo: 104, instruments: 2, war: true }));
  const forward = Array.from({ length: 40 }, (_, b) => composeBar(s, b));
  const backward = Array.from({ length: 40 }, (_, i) => composeBar(s, 39 - i)).reverse();
  assert.deepEqual(forward, backward);
  // a fresh style object from the same culture plays the same notes
  const s2 = styleFor(culture({ language: 12, mode: 5, tempo: 104, instruments: 2, war: true }));
  assert.deepEqual(composeBar(s2, 23), forward[23]);
  // eight-bar sections repeat by form: the same letter gives the same chords
  const letterAt = (bar: number): number => s.form[Math.floor(bar / 8) % s.form.length];
  for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
    if (letterAt(a * 8) !== letterAt(b * 8)) continue;
    const pads = (bar: number): number[] => composeBar(s, bar).filter((e) => e.part === 'pad').map((e) => e.midi);
    for (let i = 2; i < 8; i++) assert.deepEqual(pads(a * 8 + i), pads(b * 8 + i));
  }
});

test('war beats the war drum; a dark age plays sparser than a golden one', () => {
  const peace = styleFor(culture({ instruments: 1, tempo: 80 }));
  const war = styleFor(culture({ instruments: 1, tempo: 96, war: true }));
  for (let b = 0; b < 16; b++) {
    assert.ok(composeBar(war, b).some((e) => e.inst === 'wardrum'), `war bar ${b}`);
    assert.ok(!composeBar(peace, b).some((e) => e.inst === 'wardrum'), `peace bar ${b}`);
  }
  const count = (s: MusicStyle): number => { let n = 0; for (let b = 2; b < 66; b++) n += composeBar(s, b).length; return n; };
  const golden = styleFor(culture({ instruments: 0, age: 'golden', population: 120 }));
  const dark = styleFor(culture({ instruments: 0, age: 'dark', population: 120 }));
  assert.ok(count(golden) > count(dark), `golden ${count(golden)} vs dark ${count(dark)}`);
  // a band hums alone; a city plays as an ensemble
  const band = styleFor(culture({ instruments: 1, population: 6 }));
  const city = styleFor(culture({ instruments: 1, population: 900 }));
  const parts = (s: MusicStyle): Set<string> => { const p = new Set<string>(); for (let b = 2; b < 18; b++) for (const e of composeBar(s, b)) p.add(e.part); return p; };
  assert.ok(!parts(band).has('counter'));
  assert.ok(parts(city).has('counter'));
});

// ───────────────────────────── DSP ─────────────────────────────

test('noise loops are seamless and at their nominal level', () => {
  for (const color of ['white', 'pink', 'brown'] as const) {
    const x = renderNoise(color, 8000, 1, 5);
    assert.equal(x.length, 8000);
    let maxStep = 0;
    for (let i = 1; i < x.length; i++) maxStep = Math.max(maxStep, Math.abs(x[i] - x[i - 1]));
    const seam = Math.abs(x[0] - x[x.length - 1]);
    assert.ok(seam <= maxStep * 1.05, `${color}: seam ${seam} vs largest inner step ${maxStep}`);
    let s = 0; for (const v of x) s += v * v;
    const rms = Math.sqrt(s / x.length);
    assert.ok(rms > 0.2 && rms < 0.3, `${color} rms ${rms}`);
  }
  // foldLoop: the sample after the last is the render's next sample
  const src = new Float32Array(120).map((_, i) => i);
  const out = foldLoop(src, 100);
  assert.ok(Math.abs(out[0] - 100) < 15, `fold head ${out[0]}`);
});

test('plucked strings are in tune (Karplus–Strong with allpass tuning)', () => {
  const sr = 32000;
  for (const f of [82.4, 110, 196, 261.6, 440, 659.3]) {
    const x = renderPluck(f, sr, 1, 3, { bright: 0.5, decay: 3 });
    // autocorrelation peak near the expected period, refined by parabolic interpolation
    const N = 6000, from = 2000;
    const period = sr / f;
    let best = 0, bestLag = 0;
    for (let lag = Math.floor(period * 0.8); lag <= Math.ceil(period * 1.25); lag++) {
      let c = 0;
      for (let i = from; i < from + N; i++) c += x[i] * x[i + lag];
      if (c > best) { best = c; bestLag = lag; }
    }
    const ac = (lag: number): number => { let c = 0; for (let i = from; i < from + N; i++) c += x[i] * x[i + lag]; return c; };
    const y0 = ac(bestLag - 1), y1 = ac(bestLag), y2 = ac(bestLag + 1);
    const lag = bestLag + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2);
    const cents = 1200 * Math.log2(period / lag);
    assert.ok(Math.abs(cents) < 6, `${f} Hz is ${cents.toFixed(1)} cents off`);
    assert.ok(peakOf([x]) <= 0.9 + 1e-6);
  }
});

test('bells decay, textures stay below full scale, impulse responses carry unit energy', () => {
  const b = renderBell(1046.5, 22050, 2, CHIME, 9);
  const rms = (a: number, z: number): number => { let s = 0; for (let i = a; i < z; i++) s += b[i] * b[i]; return Math.sqrt(s / (z - a)); };
  assert.ok(rms(0, 4410) > 4 * rms(33075, 44100), 'a struck bar dies away');
  assert.ok(b.every((v) => Number.isFinite(v)));
  const cr = renderCrickets(16000, 2, 4);
  assert.equal(cr.length, 2);
  assert.ok(peakOf(cr) <= 0.8 + 1e-6 && peakOf(cr) > 0.1);
  const ir = renderImpulse(16000, 3, { decay: 1.2 });
  let e = 0; for (const c of ir) for (const v of c) e += v * v;
  assert.ok(Math.abs(e / 2 - 1) < 1e-3, `IR energy ${e / 2}`);
});

test('the master soft clipper is linear below its knee and can never reach full scale', () => {
  const c = softClipCurve(4096, 0.6, 0.97);
  let max = 0;
  for (let i = 0; i < c.length; i++) {
    const x = (i / (c.length - 1)) * 2 - 1;
    max = Math.max(max, Math.abs(c[i]));
    if (Math.abs(x) <= 0.6) assert.ok(Math.abs(c[i] - x) < 1e-6, `not linear at ${x}`);
    if (i) assert.ok(c[i] >= c[i - 1], 'monotonic');
  }
  assert.ok(max < 0.97 && max > 0.85, `curve peak ${max}`);
});

// ───────────────────────────── the scene probe ─────────────────────────────

const R = 3000;
// the home world's resolution (CONTRACT §4.1: n = 64, ~50 m between cells): the probe's hearing disk is tens of metres
const grid = getGrid(64);

function planet(o: { pressure?: number; fields?: Partial<Record<FieldName, (i: number, p: [number, number, number]) => number>>; settlements?: SettlementView[]; sun?: [number, number, number] } = {}): ScenePlanet {
  const fields = new Map<FieldName, Float32Array>();
  const P = grid.pos;
  for (const [k, f] of Object.entries(o.fields ?? {}) as [FieldName, (i: number, p: [number, number, number]) => number][]) {
    const a = new Float32Array(grid.count);
    for (let i = 0; i < grid.count; i++) a[i] = f(i, [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    fields.set(k, a);
  }
  const params = {
    radius: R, gravity: 9.8, dayHours: 24, axialTilt: 0, spin: 0, sunFrozen: false, seasonPinned: null, seaLevel: 0, magnetism: 1,
    atmosphere: { pressure: o.pressure ?? 1, o2: 0.21, co2: 0.0004, n2: 0.78, methane: 0, dust: 0, tint: null, toxicity: 0 },
    orbit: { parent: -1, a: 1e7, e: 0, inc: 0, phase0: 0, period: 17280, node: 0 }, cloudiness: 0.3, globalWeather: null, kind: 'terran',
    year: 1, dayOfYear: 0, yearDays: 12, hourAtLon0: 12,
  } as PlanetParams;
  return {
    id: 0, grid, params, fields, settlements: o.settlements ?? [], weather: [], disasters: [],
    center: [0, 0, 0], quat: [0, 0, 0, 1], sunDir: o.sun ?? [0, 0, 1],
  };
}

/** a camera `alt` metres above body point +z, looking straight down (identity orientation looks down −z) */
function listen(w: SceneWorld, alt: number) {
  return new SceneProbe().probe(w, { pos: [0, 0, R + alt], quat: [0, 0, 0, 1], planet: 0, altitude: alt });
}

const forest = {
  biome: () => 7, tree: () => 0.8, grass: () => 0.5, shrub: () => 0.3, temperature: () => 21,
} satisfies Partial<Record<FieldName, (i: number, p: [number, number, number]) => number>>;

test('an airless rock: no wind, no birds — silence and a heartbeat; in orbit, the hum of space', () => {
  const w: SceneWorld = { planets: [planet({ pressure: 0 })] };
  const s = listen(w, 20);
  assert.ok(s.airless);
  assert.equal(s.layers.wind, 0);
  assert.equal(s.layers.birds, 0);
  assert.ok(s.layers.heartbeat > 0.9, `heartbeat ${s.layers.heartbeat}`);
  const o = listen({ planets: [planet()] }, R * 3);
  assert.ok(o.space > 0.95 && o.layers.space > 0.95, `space ${o.space}`);
  assert.ok(o.orbital > 0.9);
  assert.equal(o.layers.heartbeat, 0);
  assert.ok(o.layers.wind < 0.02);
  // between the worlds
  const deep = new SceneProbe().probe({ planets: [planet()] }, { pos: [9e9, 0, 0], quat: [0, 0, 0, 1], planet: -1, altitude: 1e9 });
  assert.equal(deep.planet, -1);
  assert.equal(deep.layers.space, 1);
});

test('a forest by day has birds; by night, crickets; wind grows with altitude', () => {
  const day = listen({ planets: [planet({ fields: forest, sun: [0, 0, 1] })] }, 4);
  const night = listen({ planets: [planet({ fields: forest, sun: [0, 0, -1] })] }, 4);
  assert.ok(day.layers.birds > 0.3, `day birds ${day.layers.birds}`);
  assert.ok(day.birds.song > 0.5, 'forest songbirds lead the palette');
  assert.ok(day.layers.insects < 0.05);
  assert.ok(night.layers.insects > 0.3, `night insects ${night.layers.insects}`);
  assert.ok(night.layers.birds < 0.05);
  const high = listen({ planets: [planet({ fields: forest })] }, 450);
  assert.ok(high.layers.wind > day.layers.wind + 0.2, `wind ${day.layers.wind} → ${high.layers.wind}`);
  assert.ok(high.layers.birds < day.layers.birds * 0.3, 'small sounds fade with height');
});

test('the shore: surf from the direction of the sea; rain, fire and a town are heard', () => {
  // sea on the +x side of the listener
  const coast = planet({ fields: { ...forest, water: (_i, p) => (p[0] > 0.004 ? 6 : 0), salinity: (_i, p) => (p[0] > 0.004 ? 1 : 0) } });
  const s = listen({ planets: [coast] }, 30);
  assert.ok(s.layers.surf > 0.2, `surf ${s.layers.surf}`);
  assert.ok(s.coast && s.coast[0] > 0.5, `shore direction ${JSON.stringify(s.coast)}`);
  const wet = listen({ planets: [planet({ fields: { ...forest, precip: () => 8, precipType: () => 1 } })] }, 10);
  assert.ok(wet.layers.rain > 0.5, `rain ${wet.layers.rain}`);
  assert.ok(wet.layers.birds < listen({ planets: [planet({ fields: forest })] }, 10).layers.birds, 'birds hush in the rain');
  const snow = listen({ planets: [planet({ fields: { ...forest, precip: () => 8, precipType: () => 2 } })] }, 10);
  assert.ok(snow.layers.snow > 0.5 && snow.layers.rain === 0 && snow.layers.hush > 0.3);
  const burning = listen({ planets: [planet({ fields: { ...forest, fire: (_i, p) => (p[2] > 0.995 ? 0.9 : 0) } })] }, 20);
  assert.ok(burning.layers.fire > 0.3, `fire ${burning.layers.fire}`);
  assert.ok(burning.emitters.some((e) => e.kind === 'fire'), 'a burning cell is a point source');
  const town: SettlementView = {
    id: 4, name: 'Aru', species: 0, pos: [0.01, 0, 1], population: 80, agents: 80, cohort: 0, alignment: 0.6, belief: 0.5, god: 0,
    era: 'bronze', color: 0, polity: 1, language: 2, nightLight: 0, knowledgeCount: 10, flags: 0, music: { mode: 3, tempo: 88, instruments: 1 },
  };
  const t = listen({ planets: [planet({ fields: forest, settlements: [town] })] }, 60);
  const crowd = t.emitters.find((e) => e.kind === 'crowd');
  assert.ok(crowd && crowd.level > 0.2, `crowd ${crowd?.level}`);
  assert.equal(crowd!.sub, 'metal', 'a bronze-age town works metal');
  const m = t.music[0];
  assert.ok(m && m.weight > 0.3, `music weight ${m?.weight}`);
  assert.equal(m.culture.mode, 3);
  assert.equal(m.culture.tempo, 88);
  assert.equal(m.culture.instruments, 1);
  assert.ok(t.orbital < 0.2, 'near a town its own music plays, not the orbital score');
  // far above it, the town's music has faded and the score of space takes over
  const away = listen({ planets: [planet({ fields: forest, settlements: [town] })] }, R * 3);
  assert.ok((away.music[0]?.weight ?? 0) < 0.05 && away.orbital > 0.9);
});

// ───────────────────────────── events → sounds ─────────────────────────────

test('every disaster kind, every miracle and every hand act has a sound', () => {
  const kinds = (disasterData as unknown as { disasters: { id: string }[] }).disasters.map((d) => d.id);
  assert.ok(kinds.length >= 30);
  for (const k of kinds) {
    const fam = disasterFamily(k);
    assert.ok((DISASTER_FAMILIES as readonly string[]).includes(fam), `${k} → ${fam}`);
    const c = cueFor({ t: 'disaster', tick: 0, data: { kind: k } });
    assert.ok(c && SFX[c.cue], `${k}: no stinger`);
    assert.ok(disasterBed(k).length > 0, `${k}: no bed`);
  }
  // invented disasters still sound like something
  for (const k of ['frog-rain', 'volcanic-winter', 'star-quake', 'zzz']) assert.ok(SFX[cueFor({ t: 'disaster', tick: 0, data: { kind: k } })!.cue]);
  for (const m of MIRACLE_KINDS) {
    const c = cueFor({ t: 'miracle', tick: 0, text: m });
    assert.ok(c && SFX[c.cue] && c.cue === `miracle.${m}`, m);
  }
  const powers = (powerData as unknown as { powers: { id: string; command: { k: string } | string }[] }).powers;
  for (const p of powers) {
    const k = typeof p.command === 'string' ? p.command : p.command.k;
    if (k.startsWith('miracle.') && k !== 'miracle.cast') assert.ok(SFX[k], `power ${p.id} → ${k}`);
    const c = commandCue(k);
    if (c) assert.ok(SFX[c.cue], `command ${k} → ${c.cue}`);
  }
  for (const k of ['hand.grab', 'hand.slap', 'hand.stroke', 'hand.place', 'hand.drop']) {
    const c = cueFor({ t: 'command', tick: 0, data: { k } });
    assert.ok(c && SFX[c.cue] && c.cls === 'god', k);
  }
  assert.ok(SFX[cueFor({ t: 'thrown', tick: 0, a: 40 })!.cue], 'a throw whooshes');
});

test('every event the sim emits maps to a sound the catalog has (or deliberately to none)', () => {
  const types = [
    'impact', 'lightning', 'quake', 'eruption', 'landslide', 'steam', 'splash', 'landed', 'thrown', 'lost', 'fireball', 'shield',
    'miracle', 'gift', 'creature.reward', 'creature.punish', 'creature.learned', 'rewind', 'fire.start', 'fire.lit', 'healed',
    'built', 'ship.built', 'trade', 'theft', 'attack', 'launch', 'ship.countdown', 'battle', 'disaster', 'disaster.end',
    'discovery', 'loss', 'refusal', 'birth', 'death', 'settlement.founded', 'settlement.fallen', 'settlement.split', 'war',
    'siege', 'conquest', 'treaty', 'plague', 'blight', 'extinction', 'speciation', 'age', 'milestone', 'orbit.first',
    'contact', 'conversion', 'worship', 'rival.act', 'ship.orbit', 'ship.transfer', 'arrival', 'colony', 'ship.outpost',
    'ship.lost', 'ship.home', 'ship.program', 'ship.refused', 'ship.spoiled', 'ship.recalled', 'ship.stranded',
    'world.cracked', 'world.erased', 'world.abandoned',
  ];
  for (const t of types) {
    const c = cueFor({ t, tick: 0, a: 3, text: t === 'age' ? 'golden' : 'accepted', data: { kind: 'meteor', k: 'hand.grab', how: 'experiment' } });
    assert.ok(c, `${t} is silent`);
    assert.ok(SFX[c!.cue], `${t} → ${c!.cue} has no recipe`);
  }
  assert.equal(cueFor({ t: 'no-such-event', tick: 0 }), null);
  assert.equal(cueFor({ t: 'command', tick: 0, data: { k: 'focus' } }), null);
  assert.equal(cueFor({ t: 'chronicle', tick: 0, a: 1 }), null);
  assert.ok(cueFor({ t: 'chronicle', tick: 0, a: 3 }));
});

test('a thousand deaths at 1000x ring a few tolls that know how many they stand for', () => {
  const g = new CueGate();
  const death: SimEvent = { t: 'death', tick: 0, data: { cause: 'plague' } };
  const spec = cueFor(death)!;
  let played = 0, counted = 0;
  for (let i = 0; i < 1000; i++) {
    const n = g.admit(spec, i * 0.005); // 5 s of real time
    if (n) { played++; counted += n; }
  }
  assert.ok(played >= 2 && played <= 3, `${played} tolls`);
  assert.ok(counted > 400, 'the tolls carry the coalesced count');
  // the news class is capped overall
  const g2 = new CueGate();
  let news = 0;
  for (let i = 0; i < 200; i++) if (g2.admit({ ...cueFor({ t: 'discovery', tick: 0 })!, key: `d${i}`, gap: 0 }, 0.5)) news++;
  assert.ok(news <= 5, `${news} news cues in one second`);
});

test('the hash and the style seed are stable across runs (the same culture sounds the same tomorrow)', () => {
  assert.equal(hash32(1, 2, 3, 4), hash32(1, 2, 3, 4));
  assert.notEqual(hash32(1, 2, 3, 4), hash32(1, 2, 3, 5));
  const s = styleFor({ id: 1, language: 5, species: 2, mode: 1, tempo: 80, instruments: 0 });
  // pinned: a change to the composer that alters every culture's tune should be deliberate
  assert.equal(s.seed, hash32(5, 2, 0x6d75736b));
  assert.equal(composeBar(s, 10).length, composeBar(styleFor({ id: 99, language: 5, species: 2, mode: 1, tempo: 80, instruments: 0 }), 10).length);
});

// ───────────────────────────── the interface and the mute ─────────────────────────────

test('every interface cue has a recipe, a gap and goes through the interface mixer', () => {
  for (const name of Object.values(UI_CUE)) {
    assert.ok(SFX[name], `no recipe for ${name}`);
    assert.ok(isUiCue(name), name);
    const r = uiRule(name);
    assert.ok(r.gap > 0 && r.gap <= 0.25, `${name} gap ${r.gap}`);
    assert.ok(r.pri <= 8, `${name} must not outrank the world's big sounds`);
  }
  // the opening, a whisper and the hand play directly
  for (const name of ['ignition', 'whisper', 'hand.grab', 'miracle.heal']) assert.ok(!isUiCue(name), name);
  // quiet cues never steal a voice from the world
  assert.ok(uiRule('ui.hover').pri < 5 && uiRule('ui.tick').pri < 5);
});

test('one action is heard once, as its most important cue', () => {
  const m = new UiCueMixer<string>();
  // a palette pick: the palette closes, the radial closes, the tool arms — one "arm"
  assert.equal(m.submit('ui.close', 'palette'), true, 'the first cue opens a batch');
  assert.equal(m.submit('ui.close', 'radial'), false, 'later cues join it');
  assert.equal(m.submit('ui.arm', 'tool'), false);
  const w = m.flush(10);
  assert.equal(w?.name, 'ui.arm');
  assert.equal(w?.data, 'tool');
  assert.equal(m.gated, 2);
  assert.equal(m.pending, 0);
  // a dock click that opens a panel: the opening is heard
  m.submit('ui.click', 'dock'); m.submit('ui.open', 'settings');
  assert.equal(m.flush(11)?.name, 'ui.open');
  // equal rank: the later state wins
  m.submit('ui.open', 'a'); m.submit('ui.radial', 'b');
  assert.equal(m.flush(12)?.name, 'ui.radial');
  // a recognised gesture that arms a power: the gesture's chime
  m.submit('gesture.ok', 'g'); m.submit('ui.arm', 't');
  assert.equal(m.flush(13)?.name, 'gesture.ok');
  assert.equal(m.flush(14), null, 'an empty batch plays nothing');
});

test('interface cues are gated per cue in real time (wiring a moment twice is heard once)', () => {
  const m = new UiCueMixer();
  const play = (name: string, t: number): boolean => { m.submit(name, null); return !!m.flush(t); };
  assert.ok(play('ui.open', 0));
  assert.ok(!play('ui.open', 0.03), 'the same cue inside its gap is dropped');
  assert.ok(play('ui.close', 0.03), 'a different cue is not');
  assert.ok(play('ui.open', 0.1), 'after the gap it plays again');
  // a quiet tick right after a louder cue is swallowed (the radial's first hot slot as it opens)
  assert.ok(play('ui.radial', 1));
  assert.ok(!play('ui.tick', 1 + UI_SHADOW * 0.5));
  assert.ok(play('ui.tick', 1 + UI_SHADOW + 0.01));
  assert.ok(!play('ui.tick', 1 + UI_SHADOW + 0.02), 'ticks have their own gap');
  // sweeping the pointer over a list: hovers are capped, an error always gets through
  const m2 = new UiCueMixer();
  let clicks = 0;
  for (let t = 0; t < 1; t += 0.055) { m2.submit('ui.click', null); if (m2.flush(5 + t)) clicks++; }
  assert.ok(clicks <= UI_RATE && clicks >= UI_RATE - 1, `${clicks} clicks in a second`);
  m2.submit('ui.toggle', null);
  assert.equal(m2.flush(5.99), null, 'past the rate cap an ordinary cue is dropped');
  m2.submit('ui.error', null);
  assert.equal(m2.flush(5.995)?.name, 'ui.error', 'an error is never lost to the cap');
  m2.reset();
  assert.equal(m2.gated, 0);
  m2.submit('ui.toggle', null);
  assert.ok(m2.flush(6), 'reset clears the gate');
});

/** a stand-in for public/game_controls.js: toggleMute flips, persists and announces synchronously */
function fakePortal(initial: boolean): PortalControls & { muted: boolean; toggles: number; hear: ((m: boolean) => void) | null } {
  return {
    muted: initial, toggles: 0, hear: null,
    isMuted() { return this.muted; },
    toggleMute() { this.muted = !this.muted; this.toggles++; this.hear?.(this.muted); },
  };
}

test('the game\'s mute and the portal\'s are one switch', () => {
  // both unmuted at boot: nothing to do
  {
    const p = fakePortal(false);
    const s = new MuteSync(false, () => p);
    p.hear = (m) => s.fromPortal(m);
    const told: boolean[] = [];
    s.subscribe((m) => told.push(m));
    assert.equal(s.muted, false);
    assert.equal(p.toggles, 0);
    // the portal's button mutes: the game hears it and tells its prefs
    p.toggleMute();
    assert.equal(s.muted, true);
    assert.deepEqual(told, [true]);
    // a volume slider re-applies the (unmirrored) prefs: that must not undo the portal's mute
    assert.equal(s.request(false), false);
    assert.equal(s.muted, true);
    assert.equal(p.muted, true);
    // the player flips the game's switch on (already muted: nothing heard changes, the portal stays muted) …
    s.request(true);
    assert.equal(s.muted, true);
    assert.equal(p.toggles, 1);
    // … and off: the game unmutes and so does the portal; the game's own change is not echoed back to it
    assert.equal(s.request(false), true);
    assert.equal(s.muted, false);
    assert.equal(p.muted, false);
    assert.equal(p.toggles, 2);
    assert.deepEqual(told, [true]);
    // the game mutes: the portal follows (its icon, its memory)
    s.request(true);
    assert.equal(p.muted, true);
    assert.deepEqual(told, [true]);
    // the portal unmutes again
    p.toggleMute();
    assert.equal(s.muted, false);
    assert.deepEqual(told, [true, false]);
  }
  // the portal was muted at boot (ff_muted): the game starts muted and its prefs are told at once
  {
    const p = fakePortal(true);
    const s = new MuteSync(false, () => p);
    p.hear = (m) => s.fromPortal(m);
    assert.equal(s.muted, true);
    const told: boolean[] = [];
    const off = s.subscribe((m) => told.push(m));
    assert.deepEqual(told, [true]);
    s.request(true); // the App mirrors it
    assert.equal(p.toggles, 0);
    off();
    p.toggleMute();
    assert.deepEqual(told, [true], 'unsubscribed');
    assert.equal(s.muted, false);
  }
  // the game was muted at boot: the portal is muted to match, nobody needs telling
  {
    const p = fakePortal(false);
    const s = new MuteSync(true, () => p);
    assert.equal(s.muted, true);
    assert.equal(p.muted, true);
    assert.equal(p.toggles, 1);
    const told: boolean[] = [];
    s.subscribe((m) => told.push(m));
    assert.deepEqual(told, []);
  }
  // no portal, or a broken one: the game's own switch still works
  {
    const s = new MuteSync(false, () => null);
    assert.equal(s.portalMuted(), null);
    assert.equal(s.request(true), true);
    assert.equal(s.muted, true);
    const bad = new MuteSync(false, () => { throw new Error('portal gone'); });
    assert.equal(bad.request(true), true);
    assert.equal(bad.muted, true);
  }
});

test('the engine mirrors the portal\'s mutechange and pushes its own mute to it (no WebAudio needed)', async () => {
  const g = globalThis as unknown as { window?: unknown };
  const had = 'window' in g;
  const prev = g.window;
  const win = new EventTarget() as EventTarget & { __CONTROLS__?: PortalControls };
  let pm = true;
  let toggles = 0;
  win.__CONTROLS__ = {
    isMuted: () => pm,
    toggleMute: () => { pm = !pm; toggles++; win.dispatchEvent(new CustomEvent('mutechange', { detail: { muted: pm } })); },
  };
  g.window = win;
  try {
    const a = createAudio({ muted: false });
    assert.equal(a.muted, true, 'the portal was muted at boot');
    const told: boolean[] = [];
    a.onMuteChange((m) => told.push(m));
    assert.deepEqual(told, [true]);
    a.mute(true); // the App mirrors it into prefs, which re-applies
    assert.equal(toggles, 0);
    win.__CONTROLS__.toggleMute(); // the portal's button
    assert.equal(a.muted, false);
    assert.equal(a.state().muted, false);
    assert.equal(a.state().portalMuted, false);
    assert.deepEqual(told, [true, false]);
    a.mute(false); // mirrored
    a.mute(true); // Settings → Audio → Mute
    assert.equal(pm, true, 'the portal follows the game');
    assert.equal(toggles, 2);
    assert.deepEqual(told, [true, false], 'the game\'s own change is not echoed');
    a.mute(false);
    assert.equal(pm, false);
    // interface cues of one task are batched: the loser is counted as gated after the microtask
    a.cue('ui.close'); a.cue('ui.close'); a.cue('ui.arm');
    await Promise.resolve();
    assert.equal(a.state().ui.gated, 2);
    a.cue('ui.arm');
    await Promise.resolve();
    assert.equal(a.state().ui.gated, 3, 'a second arm inside its gap is dropped');
    // muted: interface cues are not even queued
    a.mute(true);
    a.cue('ui.open');
    await Promise.resolve();
    assert.equal(a.state().ui.gated, 3);
    a.dispose();
    win.dispatchEvent(new CustomEvent('mutechange', { detail: { muted: false } }));
    assert.equal(a.muted, true, 'a disposed engine no longer listens');
  } finally {
    if (had) g.window = prev; else delete g.window;
  }
});
