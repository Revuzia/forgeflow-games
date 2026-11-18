// SOUND SURVEY (round 8, R8_LIFE; the brief: "SOUND has never been heard by anyone. You cannot listen, so MEASURE"). Dev only, no dependency: the REAL
// engine (createAudio(), engine.ts) run offline in Chromium through _harness/audioview/engine_offline.js (an OfflineAudioContext stands in for the live
// context; the engine's clock, timers and lazy imports are the game's), one render per sound, through the game's own master chain at the game's default
// settings (master 0.8, music 0.45, Voices 0.6, Place sounds 0.5; master 1 for the clip test). Per sound: peak, active RMS, clipped samples, DC offset,
// silence, duration, spectral centroid, a click at its start (a sample step over 0.5 of the peak in the first 0.5 ms) or a cut-off (anywhere in the render, the
// 1 ms envelope falling from -20 dB to below -60 dB re its loudest 1 ms in under 2 ms: no fade), the onset delay of a thing strike (Home's first strike waits
// for the away chunk), and any sound over 12 dB above its group's median peak. Then the mix: each place's ambience + its music + three voices + two thing
// sounds together, against three rules: the master never clips, the voices sit above the ambience, no stem more than 12 dB over the median of the others.
//   node _harness/sound_survey.ts [--port=5367] [--json=FILE] [--only=group,...]   (one heavy job: Chromium + vite)
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CATALOG } from '../src/data/catalog.ts';
import { speciesBaseGenome } from '../src/data/catalog.ts';
import { MATERIAL_FAMILY_IDS } from '../src/data/materials.ts';
import { FAMILY_REACT } from '../src/data/life.ts';
import { PROP_SOUND } from '../src/data/places.ts';
import { createLifeWorld, lifeAdd } from '../src/life/step.ts';
import { planPhrase, lifePhrase, PHRASE, SPECIES_FLAVOUR } from '../src/life/voice.ts';
import { UI_KINDS } from '../src/audio/ui.ts';

// (the harness's own .mjs helpers, untyped: loaded by a computed specifier so tsc does not ask for declarations)
type AnyFn = (...a: never[]) => unknown;
const PW = (await import('./pw' + '.mjs')) as { launch: AnyFn; startVite: AnyFn };
const AN = (await import('./audioview/analysis' + '.mjs')) as { metrics: AnyFn; dominant: AnyFn };
const launch = PW.launch as unknown as () => Promise<{ newPage: () => Promise<Pg>; close: () => Promise<void> }>;
const startVite = PW.startVite as unknown as (port: number) => Promise<{ url: string; stop: () => void }>;
const metrics = AN.metrics as unknown as (x: Float32Array, sr: number, o: { thrDb: number }) => unknown;
const dominant = AN.dominant as unknown as (x: Float32Array, sr: number, o: Record<string, number>) => unknown;
interface Pg { on: (ev: string, fn: (e: Error) => void) => void; goto: (u: string) => Promise<unknown>; waitForFunction: (f: () => boolean, a: null, o: { timeout: number }) => Promise<unknown>; evaluate: <T>(f: (s: unknown) => Promise<T>, s: unknown) => Promise<T> }
const arg = (k: string, d: string): string => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const PORT = Number(arg('port', '5367'));
const ONLY = arg('only', '').split(',').filter(Boolean);
const JSON_OUT = arg('json', '');
const SR = 48000;
const DEF = { master: 0.8, music: 0.45, chatter: 0.6, ambience: 0.5 };
const dec = (s: string): Float32Array => { const b = Buffer.from(s, 'base64'); return new Float32Array(b.buffer, b.byteOffset, b.length / 4).slice(); };
const db = (v: number): number => 20 * Math.log10(Math.max(v, 1e-12));

type Ev = { t: number; op: string; a?: unknown; id?: number };
interface Item { group: string; name: string; secs: number; events: Ev[]; stem: string; ambience?: string; musicOn?: boolean; from?: number; master?: number }
const items: Item[] = [];
const setup = (extra: Record<string, unknown> = {}): Ev => ({ t: 0.01, op: 'setSettings', a: { chatter: DEF.chatter, ambience: DEF.ambience, ...extra } });

// ── each place's ambience bed (20 s, the ambience stem: its own bus after Place sounds 0.5) and its music style (32 s, the music stem) ──
const PLACES: Array<[string, string]> = [['home', 'home'], ['hearthlog', 'cabin'], ['ripple', 'shore'], ['frostbell', 'ridge'], ['rainleaf', 'garden'], ['lanternroof', 'roof'], ['cloudloft', 'cloud']];
for (const [id] of PLACES) if (id !== 'home') items.push({ group: 'ambience', name: id, secs: 20, events: [setup()], stem: 'ambience', ambience: id, musicOn: false, from: 2 });
for (const [id, style] of PLACES) items.push({ group: 'music', name: `${id} (${style})`, secs: 32, events: [setup(), { t: 0.05, op: 'setMusicStyle', a: style }], stem: 'music', musicOn: true, from: 2 });
// ── each thing's sound (PROP_SOUND kinds, a strike by the player at intensity 0.7; tuned ones on D5), the Music Box tune and the kettle's whistle, the squirt ──
// (not here: kettle, the tune below; creak, which has no strike voice by design (life_voices.ts: a hinged thing's sound is its held creak while it moves, measured
// below); crackle, which swells the cabin's bed (its own row below))
for (const [k, v] of Object.entries(PROP_SOUND)) {
  if (k === 'kettle' || k === 'creak' || k === 'crackle') continue;
  items.push({ group: 'thing', name: k, secs: 2.5, events: [setup(), { t: 0.3, op: 'prop', a: { kind: v, intensity: 0.7, note: k === 'chime' || k === 'bell' ? 74 : 0, pan: 0, auto: false, size: 0.22 } }], stem: 'mix', musicOn: false });
}
items.push({ group: 'thing', name: 'ball (auto, budgeted)', secs: 2, events: [setup(), { t: 0.3, op: 'prop', a: { kind: PROP_SOUND.ball, intensity: 0.7, pan: 0, auto: true, size: 0.22 } }], stem: 'mix', musicOn: false });
items.push({ group: 'thing', name: 'creak (held 2 s)', secs: 3.5, events: [setup(), ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((q) => ({ t: 0.3 + q * 0.2, op: 'prop', a: { kind: PROP_SOUND.creak, intensity: 0.6, pan: 0, auto: false, key: 3, held: q < 10 ? 0.6 : 0 } }))], stem: 'mix', musicOn: false });
// (the tunes sing on the music's field, so the music plays; measured on the things' stem (ch.plain), without the music)
items.push({ group: 'thing', name: 'Music Box tune (tune 0)', secs: 31, events: [setup(), { t: 0.3, op: 'musicBox', a: { on: true, tune: 0 } }], stem: 'fx', musicOn: true });
items.push({ group: 'thing', name: 'kettle whistle (tune 1)', secs: 8, events: [setup(), { t: 0.3, op: 'musicBox', a: { on: true, tune: 1 } }], stem: 'fx', musicOn: true });
items.push({ group: 'thing', name: 'squirt (splash 0.3, size 0.12)', secs: 2, events: [setup(), { t: 0.3, op: 'prop', a: { kind: PROP_SOUND.splash, intensity: 0.3, note: 0, pan: 0, auto: false, size: 0.12 } }], stem: 'mix', musicOn: false });
items.push({ group: 'thing', name: 'splash (a squishy in water: 1.0)', secs: 2, events: [setup(), { t: 0.3, op: 'prop', a: { kind: PROP_SOUND.splash, intensity: 1, note: 0, pan: 0, auto: false, size: 0.25 } }], stem: 'mix', musicOn: false });
// ── voices: per material family, its first species, four phrases (greet, joy, huff, sleepy) and a piece's peep; through the chatter bus (Voices 0.6) ──
const W = createLifeWorld(3, 16);
const buf = new Float32Array(64);
const famSpecies: Array<[string, string]> = MATERIAL_FAMILY_IDS.map((f) => [f, CATALOG.find((c) => c.family === f)?.id ?? 'dollop']);
famSpecies.forEach(([fam, sp], slot) => {
  lifeAdd(W, slot, speciesBaseGenome(sp as Parameters<typeof speciesBaseGenome>[0], 8), 0, slot, 0, false);
  const evs: Ev[] = [setup()];
  [PHRASE.GREET, PHRASE.JOY, PHRASE.HUFF, PHRASE.SLEEPY].forEach((ph, q) => {
    const h = planPhrase(W, slot, ph, -1, 0), n = lifePhrase(W, h, buf);
    evs.push({ t: 0.3 + q * 1.3, op: 'creature', a: { phrase: Array.from(buf.subarray(0, n * 4)), n, flavour: SPECIES_FLAVOUR[W.species[slot]], register: 0, pitch: W.pi[slot], pan: 0, level: 1, group: 1, at: 0 } });
  });
  const h = planPhrase(W, slot, PHRASE.PEEP, -1, 0), n = lifePhrase(W, h, buf);
  evs.push({ t: 5.6, op: 'creature', a: { phrase: Array.from(buf.subarray(0, n * 4)), n, flavour: SPECIES_FLAVOUR[W.species[slot]], register: 1, pitch: W.pi[slot] * 1.3, pan: 0, level: 1, group: 1, at: 0 } });
  items.push({ group: 'voice', name: `${fam} (${sp}, flavour ${(FAMILY_REACT as Record<string, { flavour: number }>)[fam].flavour})`, secs: 7, events: evs, stem: 'chatter', musicOn: false });
});
// ── the toy's own voices and the ceremonies (published; probe_audio's G2 gate checks their shapes: here their levels beside the rest) ──
const fx = (name: string, op: string, a: unknown, secs = 2): void => { items.push({ group: 'interaction', name, secs, events: [setup(), { t: 0.3, op, a }], stem: 'mix', musicOn: false }); };
fx('poke', 'poke', { intensity: 0.6 }); fx('land', 'land', { intensity: 0.6 }); fx('pop', 'pop', { size: 0.5 }); fx('release', 'release', { compression: 0.7 });
fx('bump', 'bump', { intensity: 0.6 }); fx('lift', 'lift', {}); fx('toss', 'toss', { speed: 3 }); fx('strand', 'strand', { tension: 0.7, snap: true });
fx('autoThud (land)', 'autoThud', { kind: 0, intensity: 0.6 }); fx('meterFull', 'meterFull', {}, 3);
fx('capsule grab', 'capsuleBeat', { beat: 'grab', progress: 0.5, tier: 'rare' }); fx('capsule crack', 'capsuleBeat', { beat: 'crack', tier: 'rare' }); fx('capsule burst', 'capsuleBeat', { beat: 'burst', tier: 'rare' }, 3);
for (const tier of ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic']) fx(`reveal ${tier}`, 'reveal', { tier, isNew: true }, 6);
fx('cut start', 'cut', { phase: 'start', frac: 0.5 }); fx('cut separate', 'cut', { phase: 'separate', frac: 0.5 }); fx('rejoin', 'rejoin', { frac: 0.5 });
items.push({ group: 'interaction', name: 'squish (held 1.2 s)', secs: 2.5, events: [setup(), { t: 0.3, op: 'squishStart', a: {}, id: 1 }, ...[1, 2, 3, 4, 5, 6].map((q) => ({ t: 0.3 + q * 0.15, op: 'squishUpdate', a: { compression: Math.min(1, q * 0.18), rate: 0.6 }, id: 1 })), { t: 1.5, op: 'squishEnd', a: { fade: 0.08 }, id: 1 }], stem: 'mix', musicOn: false });
// ── UI (12 kinds) ──
for (const k of UI_KINDS) fx(`ui ${k}`, 'ui', { kind: k }, 1.5);

// ── the cabin fire's crackle: a swell of Hearthlog's bed (aw.puff, about 5 s); the bed's RMS before (2..4 s) and during (4.5..8 s) ──
const PUFF = { group: 'thing', name: 'crackle (the cabin fire: its bed swells)', secs: 10, events: [setup(), { t: 4, op: 'prop', a: { kind: PROP_SOUND.crackle, intensity: 1, note: 0, pan: 0, auto: false, size: 0.22 } }], stem: 'ambience', ambience: 'hearthlog', musicOn: false };
// ── the mixes: at each place, its ambience + its music + three voices + two thing sounds together (master 0.8 and 1) ──
interface Mix { place: string; style: string; master: number }
const mixes: Mix[] = [];
for (const [id, style] of PLACES) for (const m of [0.8, 1]) mixes.push({ place: id, style, master: m });

/* ───────────────────────── run ───────────────────────── */
const vite = await startVite(PORT);
const browser = await launch();
const page = await browser.newPage();
const errs: string[] = [];
page.on('pageerror', (e: Error) => errs.push(e.message));
await page.goto(`${vite.url}_harness/audioview/index.html`);
await page.waitForFunction(() => (window as unknown as { AV?: { ready: boolean } }).AV?.ready === true, null, { timeout: 120000 });
const run = (spec: Record<string, unknown>): Promise<{ stems: Record<string, string>; errors: number; n: number }> => page.evaluate((s: unknown) => (window as unknown as { AV: { runEngineOffline: (s: unknown) => Promise<{ stems: Record<string, string>; errors: number; n: number }> } }).AV.runEngineOffline(s), spec);

interface Row { group: string; name: string; peakDb: number; rmsDb: number; clipped: number; dc: number; silent: boolean; durS: number; centroidHz: number; startClick: number; fadeMs: number; onsetMs: number; errors: number; note: string }
const rows: Row[] = [];
function analyse(group: string, name: string, x: Float32Array, from: number, errors: number, evT: number): Row {
  const y = x.subarray(Math.round(from * SR));
  const m = metrics(y, SR, { thrDb: group === 'ambience' || group === 'music' ? -70 : -60 }) as { peakDb: number; peak: number; dc: number; activeDurS: number; activeRmsDb: number; activeStartS: number; activeEndS: number; winRms: Float64Array; winS: number };
  let clipped = 0; for (let i = 0; i < y.length; i++) if (Math.abs(y[i]) >= 0.999) clipped++;
  const silent = m.peakDb < -60;
  let centroid = NaN;
  try { const d = dominant(y, SR, { fLo: 40, fHi: 16000, win: 4096 }) as { centroidHz?: number }; centroid = d.centroidHz ?? NaN; } catch { /* too short */ }
  // the click tests: a sample step over 0.5 x the peak in the first 0.5 ms after the onset; a cut-off: the 1 ms RMS envelope falling from >= -20 dB re its
  // loudest 1 ms to < -60 dB in under 2 ms (the shortest such fall anywhere in the render; a fall at the render's end does not count)
  let startClick = 0, fadeMs = Infinity, onsetMs = NaN;
  if (!silent) {
    const i0 = Math.round(m.activeStartS * SR), i1 = Math.min(y.length, i0 + Math.round(0.0005 * SR) + 240);
    let on = i0; for (let i = i0; i < i1; i++) if (Math.abs(y[i]) > m.peak * 0.01) { on = i; break; }
    for (let i = Math.max(1, on); i < Math.min(y.length, on + Math.round(0.0005 * SR)); i++) startClick = Math.max(startClick, Math.abs(y[i] - y[i - 1]) / m.peak);
    onsetMs = Math.round((from + on / SR - evT) * 1000);
    const W1 = Math.round(0.001 * SR), nW = Math.floor(y.length / W1), env = new Float64Array(nW);
    let ePk = 0;
    for (let w = 0; w < nW; w++) { let s2 = 0; for (let i = w * W1; i < (w + 1) * W1; i++) s2 += y[i] * y[i]; env[w] = Math.sqrt(s2 / W1); ePk = Math.max(ePk, env[w]); }
    let lastHi = -1;
    for (let w = 0; w < nW; w++) {
      if (env[w] >= ePk * 0.1) lastHi = w;
      else if (env[w] < ePk * 0.001 && lastHi >= 0 && w > 0 && env[w - 1] >= ePk * 0.001) { fadeMs = Math.min(fadeMs, w - lastHi); lastHi = -1; }
    }
  }
  const notes: string[] = [];
  if (silent) notes.push('SILENT');
  if (clipped) notes.push(`CLIPS ${clipped}`);
  if (Math.abs(m.dc) > 1e-3) notes.push('DC');
  const oneShot = group !== 'ambience' && group !== 'music' && !name.startsWith('Music Box');
  if (oneShot && startClick > 0.5) notes.push('click at start');
  if (fadeMs < 2) notes.push(`cut off (${fadeMs} ms fall)`);
  if (oneShot && m.activeEndS >= y.length / SR - 0.02) notes.push('still sounding at the render end');
  return { group, name, peakDb: +m.peakDb.toFixed(1), rmsDb: +m.activeRmsDb.toFixed(1), clipped, dc: +m.dc.toExponential(1), silent, durS: +m.activeDurS.toFixed(2), centroidHz: Math.round(centroid), startClick: +startClick.toFixed(2), fadeMs: Number.isFinite(fadeMs) ? fadeMs : -1, onsetMs, errors, note: notes.join('; ') };
}
// a warm-up render: one thing strike loads the away chunk into this page (an offline render runs faster than real time, so the FIRST strike of a page waits for
// the module longer than AWAY_LATE_S of render time and is dropped, as a live strike would be on a connection that slow); every later engine finds it cached
await run({ secs: 1, seed: 1, master: DEF.master, music: DEF.music, musicOn: false, taps: false, preload: true, want: ['mix'], events: [setup(), { t: 0.1, op: 'prop', a: { kind: PROP_SOUND.bell, intensity: 0.1, note: 69, pan: 0, auto: false } }] });
await page.evaluate(() => new Promise<void>((r) => { setTimeout(r, 1500); }), null);
const t0 = Date.now();
let worst: Record<string, number> | null = null;
try {
  for (const it of items) {
    if (ONLY.length && !ONLY.includes(it.group)) continue;
    const want = it.stem === 'mix' ? ['mix'] : ['mix', it.stem];
    const r = await run({ secs: it.secs, seed: 0x5eed, master: it.master ?? DEF.master, music: DEF.music, musicOn: it.musicOn ?? false, ambience: it.ambience, taps: it.stem === 'chatter' || it.stem === 'ambience', preload: true, want, events: it.events });
    const x = dec(r.stems[it.stem] ?? r.stems.mix);
    const evT = it.events.length > 1 ? it.events[1].t : 0;
    const row = analyse(it.group, it.name, x, it.from ?? 0, r.errors, evT);
    rows.push(row);
    console.log(`${row.group.padEnd(11)} ${row.name.padEnd(42)} peak ${String(row.peakDb).padStart(6)} rms ${String(row.rmsDb).padStart(6)} dur ${String(row.durS).padStart(5)} centroid ${String(row.centroidHz).padStart(5)} start ${row.startClick} fall ${row.fadeMs} ms onset ${row.onsetMs} ms dc ${row.dc} ${row.note}`);
  }
  // loudness outliers: a sound more than 12 dB over its group's median peak
  for (const g of [...new Set(rows.map((r) => r.group))]) {
    const pk = rows.filter((r) => r.group === g && !r.silent).map((r) => r.peakDb).sort((a, b) => a - b);
    const med = pk.length ? pk[Math.floor(pk.length / 2)] : NaN;
    for (const r of rows) if (r.group === g && !r.silent && r.peakDb > med + 12) { r.note = (r.note ? r.note + '; ' : '') + `${(r.peakDb - med).toFixed(1)} dB over its group's median`; console.log('outlier', g, r.name, r.peakDb, 'median', med); }
  }
  if (!ONLY.length || ONLY.includes('thing')) {
    // against the same bed (the same seed) with no puff: the swell is the difference over the puff's 5 s (4.5..9 s)
    const spec = { secs: PUFF.secs, seed: 0x5eed, master: DEF.master, music: DEF.music, musicOn: false, ambience: PUFF.ambience, taps: true, preload: true, want: ['mix', 'ambience'] };
    const r = await run({ ...spec, events: PUFF.events }), r0 = await run({ ...spec, events: [PUFF.events[0]] });
    const x = dec(r.stems.ambience), x0 = dec(r0.stems.ambience);
    const rms = (y: Float32Array, a: number, b: number): number => { let s2 = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) s2 += y[i] * y[i]; return 10 * Math.log10(s2 / ((b - a) * SR) + 1e-30); };
    const pre = rms(x, 2, 4) - rms(x0, 2, 4), during = rms(x, 4.5, 9) - rms(x0, 4.5, 9);
    const row = analyse(PUFF.group, PUFF.name, x, 2, r.errors + r0.errors, 4);
    row.note = `the bed with the puff against the same bed without: ${during.toFixed(1)} dB over 4.5..9 s (${pre.toFixed(1)} dB before it)` + (during < 2 ? '; NO SWELL' : '');
    rows.push(row); console.log(`${row.group.padEnd(11)} ${row.name.padEnd(42)} ${row.note}`);
  }
  // the worst moment: Home at master 1, the music, three voices, the ball and the shelf's bell, a legendary reveal, a pop and a poke inside 0.3 s
  if (!ONLY.length || ONLY.includes('mix')) {
    const evs: Ev[] = [setup(), { t: 0.05, op: 'setMusicStyle', a: 'home' }];
    [0, 1, 2].forEach((slot, q) => { const h = planPhrase(W, slot, [PHRASE.GREET, PHRASE.JOY, PHRASE.HUFF][q], -1, 0), n = lifePhrase(W, h, buf);
      evs.push({ t: 4.0 + q * 0.1, op: 'creature', a: { phrase: Array.from(buf.subarray(0, n * 4)), n, flavour: SPECIES_FLAVOUR[W.species[slot]], register: 0, pitch: W.pi[slot], pan: (q - 1) * 0.5, level: 1, group: 1, at: 0 } }); });
    evs.push({ t: 1, op: 'prop', a: { kind: PROP_SOUND.bell, intensity: 0.1, note: 69, pan: 0, auto: false } });   // (loads the away chunk first)
    evs.push({ t: 4.0, op: 'reveal', a: { tier: 'legendary', isNew: true } }, { t: 4.05, op: 'pop', a: { size: 0.8 } }, { t: 4.1, op: 'poke', a: { intensity: 1 } });
    evs.push({ t: 4.15, op: 'prop', a: { kind: PROP_SOUND.ball, intensity: 1, pan: 0.3, auto: false, size: 0.22 } }, { t: 4.2, op: 'prop', a: { kind: PROP_SOUND.bell, intensity: 1, note: 74, pan: -0.3, auto: false } });
    const r = await run({ secs: 9, seed: 0x5eed, master: 1, music: DEF.music, musicOn: true, taps: false, preload: true, want: ['mix'], events: evs });
    const x = dec(r.stems.mix); let p = 0, clipped = 0; for (let i = 0; i < x.length; i++) { p = Math.max(p, Math.abs(x[i])); if (Math.abs(x[i]) >= 0.999) clipped++; }
    console.log('worst', JSON.stringify({ masterPeakDb: +db(p).toFixed(1), clipped, errors: r.errors }));
    worst = { masterPeakDb: +db(p).toFixed(1), clipped, errors: r.errors };
  }
  // the mixes
  const mixRows: Array<Record<string, unknown>> = [];
  if (!ONLY.length || ONLY.includes('mix')) for (const mx of mixes) {
    const fam = famSpecies.slice(0, 3).map(([, sp], q) => q);
    const evs: Ev[] = [setup(), { t: 0.05, op: 'setMusicStyle', a: mx.style }];
    // three voices at 4.0, 4.4, 4.8 s (greet, joy, huff of the first three families), two thing sounds at 4.2 and 4.6 s (the ball, a chime on D5)
    fam.forEach((slot, q) => { const h = planPhrase(W, slot, [PHRASE.GREET, PHRASE.JOY, PHRASE.HUFF][q], -1, 0), n = lifePhrase(W, h, buf);
      evs.push({ t: 4.0 + q * 0.4, op: 'creature', a: { phrase: Array.from(buf.subarray(0, n * 4)), n, flavour: SPECIES_FLAVOUR[W.species[slot]], register: 0, pitch: W.pi[slot], pan: (q - 1) * 0.5, level: 1, group: 1, at: 0 } }); });
    evs.push({ t: 4.2, op: 'prop', a: { kind: PROP_SOUND.ball, intensity: 0.8, pan: 0.3, auto: false, size: 0.22 } });
    evs.push({ t: 4.6, op: 'prop', a: { kind: PROP_SOUND.chime, intensity: 0.8, note: 74, pan: -0.3, auto: false } });
    const r = await run({ secs: 9, seed: 0x5eed, master: mx.master, music: DEF.music, musicOn: true, ambience: mx.place === 'home' ? undefined : mx.place, taps: true, preload: true, want: ['mix', 'music', 'fx', 'chatter', 'ambience'], events: evs });
    const S = Object.fromEntries(Object.entries(r.stems).map(([k, v]) => [k, dec(v)])) as Record<string, Float32Array>;
    const seg = (x: Float32Array | undefined, a: number, b: number): Float32Array => (x ? x.subarray(Math.round(a * SR), Math.round(b * SR)) : new Float32Array(0));
    const pk = (x: Float32Array): number => { let p = 0; for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i])); return db(p); };
    const act = (x: Float32Array): number => (metrics(x, SR, { thrDb: -70 }) as { activeRmsDb: number }).activeRmsDb;
    let clipped = 0; for (let i = 0; i < S.mix.length; i++) if (Math.abs(S.mix[i]) >= 0.999) clipped++;
    const amb = S.ambience && pk(seg(S.ambience, 2, 9)) > -90 ? +act(seg(S.ambience, 2, 9)).toFixed(1) : null;
    const row: Record<string, unknown> = { place: mx.place, style: mx.style, master: mx.master, masterPeakDb: +pk(seg(S.mix, 3.8, 9)).toFixed(1), clipped, voicesRmsDb: +act(seg(S.chatter, 3.9, 6.5)).toFixed(1), voicesPeakDb: +pk(seg(S.chatter, 3.9, 6.5)).toFixed(1),
      ambienceRmsDb: amb, musicRmsDb: +act(seg(S.music, 2, 9)).toFixed(1), fxRmsDb: +act(seg(S.fx, 4.1, 5.5)).toFixed(1), fxPeakDb: +pk(seg(S.fx, 4.1, 5.5)).toFixed(1), errors: r.errors };
    // the three rules
    const lv: Array<[string, number]> = [['voices', row.voicesRmsDb as number], ['music', row.musicRmsDb as number], ['things', row.fxRmsDb as number]];
    if (amb !== null) lv.push(['ambience', amb]);
    const over = lv.map(([k, v]) => { const others = lv.filter(([k2]) => k2 !== k).map(([, v2]) => v2).sort((a, b) => a - b); return [k, v - others[Math.floor(others.length / 2)]] as [string, number]; });
    row.noClip = clipped === 0 && (row.masterPeakDb as number) < -0.1;
    row.voicesOverAmbienceDb = amb === null ? null : +((row.voicesRmsDb as number) - amb).toFixed(1);
    row.maxOverPeersDb = +Math.max(...over.map(([, v]) => v)).toFixed(1);
    row.loudest = over.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
    row.ok = row.noClip && (amb === null || (row.voicesOverAmbienceDb as number) > 0) && (row.maxOverPeersDb as number) <= 12;
    mixRows.push(row);
    console.log('mix', JSON.stringify(row));
  }
  console.log(`\n${rows.length} sounds, ${rows.filter((r) => r.note).length} with a note; page errors ${errs.length}; ${Math.round((Date.now() - t0) / 1000)} s`);
  if (JSON_OUT) writeFileSync(resolve(JSON_OUT), JSON.stringify({ rows, mixes: mixRows, worst, errs }, null, 1));
} finally {
  try { await browser.close(); } catch { /* gone */ }
  try { vite.stop(); } catch { /* gone */ }
}
