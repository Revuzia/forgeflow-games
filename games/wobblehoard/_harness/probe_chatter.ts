// PG_AUDIO node probe (light; picked up by run_probes.ts): AU-10 (the ChatterLimiter, pure, with synthetic time), AU-14 (a scripted
// 10-minute cabin visit with no input through TuneGate and the shell's kettle rule), and the pure parts of the creature voices: the id
// tables audio mirrors from src/data (audio must not import the life chunk), the pitch snap of LIFE 8.2 and the re-voicing of sung notes
// onto the sounding field's rest tones (LIFE 8.4, D-66).   node _harness/probe_chatter.ts
import { ChatterLimiter, CHATTER_SALT, FIELD_REST, SYL, SYL_S, baseNote, degNote, sungNote, sylStarts, WHOLE_LO, WHOLE_HI, PIECE_LO, PIECE_HI } from '../src/audio/creature.ts';
import { Composer, MUSIC_STYLES as STYLES } from '../src/audio/music.ts';
import { PROP, TUNE, TUNE_BARS, TuneGate } from '../src/audio/props.ts';
import { BAR_S, FIELDS, MUSIC_STYLES, FIELD_NEXT, ROOM_KINDS, pcOf } from '../src/audio/music.ts';
import { popSize } from '../src/audio/cut.ts';
import { SYL as DATA_SYL, SALTS } from '../src/data/life.ts';
import { PROP_SOUND } from '../src/data/places.ts';
import { SYL_LEN } from '../src/life/voice.ts';
import { mulberry32 } from '../src/core/rng.ts';
import { STRIKE, snapPenta } from '../src/audio/things.ts';
import { AMB_ALIAS, WeatherClock, ambKey, patterCurve } from '../src/audio/ambience.ts';
import { PLACE as P_HOME } from '../src/data/place_home.ts';
import { PLACE as P_HEARTH } from '../src/data/place_hearthlog.ts';
import { PLACE as P_RIPPLE } from '../src/data/place_ripple.ts';
import { PLACE as P_FROST } from '../src/data/place_frostbell.ts';
import { PLACE as P_RAIN } from '../src/data/place_rainleaf.ts';
import { PLACE as P_ROOF } from '../src/data/place_lanternroof.ts';
import { PLACE as P_CLOUD } from '../src/data/place_cloudloft.ts';

const rows: { id: string; name: string; ok: boolean; v: string }[] = [];
const row = (id: string, name: string, ok: boolean, v: unknown): void => { rows.push({ id, name, ok, v: String(v) }); };
const PENTA = [2, 4, 6, 9, 11];

/* ── the mirrors of src/data ── */
row('IDS', 'audio SYL == data SYL', JSON.stringify(SYL) === JSON.stringify(DATA_SYL), JSON.stringify(SYL));
row('IDS', 'audio PROP == data PROP_SOUND', JSON.stringify(PROP) === JSON.stringify(PROP_SOUND), JSON.stringify(PROP));
row('IDS', 'CHATTER_SALT == data SALTS.chatter', CHATTER_SALT === SALTS.chatter, CHATTER_SALT.toString(16));
row('IDS', 'audio syllable lengths == LIFE voice.ts SYL_LEN', SYL_S.every((v, i) => Math.abs(v - SYL_LEN[i]) < 1e-9), SYL_S.join(','));
row('IDS', "'creature' never in ROOM_KINDS (the music never dips for chatter)", !('creature' in ROOM_KINDS), Object.keys(ROOM_KINDS).length);
row('IDS', "MusicStyle 'home' is today's FIELD_NEXT, no mallet filter (AU-07)", MUSIC_STYLES.home.next === FIELD_NEXT && MUSIC_STYLES.home.lp === 0, 'home');
// every field's rest tones (root, fifth, ninth) are in that field's collection (D major), and the root is the field's pad root's pc
{
  let ok = true;
  const D_MAJOR = [2, 4, 6, 7, 9, 11, 1];
  for (let f = 0; f < 4; f++) for (const pc of FIELD_REST[f]) if (!D_MAJOR.includes(pc)) ok = false;
  const roots = FIELDS.map((f) => pcOf(Math.min(...f.pad)));
  // home D4 A4 E5 -> D; lift G4.. -> G; dusk F#4 B4 D5 (B minor over F#: the root is B); glow E4 A4 B4 (A sus2 over E: the root is A)
  const want = [2, 7, 11, 9];
  row('PITCH', 'rest tones in the D major collection, roots D G B A (music.ts FIELDS)', ok && FIELD_REST.every((r, i) => r[0] === want[i]), `${FIELD_REST.map((r) => r.join('/')).join(' ')} pads ${roots.join(',')}`);
}

/* ── pitch (LIFE 8.2) ── */
{
  let ok = true, lo = 99, hi = 0;
  for (let k = 0; k <= 200; k++) {
    const r = 0.7 * Math.pow(1.43 / 0.7, k / 200);
    const m = baseNote(r, 0);
    if (!PENTA.includes(m % 12) || m < WHOLE_LO || m > WHOLE_HI) ok = false;
    // nearest: no pentatonic note in range is closer to the unsnapped pitch
    const raw = 74 + 12 * Math.log2(r);
    for (let q = WHOLE_LO; q <= WHOLE_HI; q++) if (PENTA.includes(q % 12) && Math.abs(q - raw) < Math.abs(m - raw) - 1e-9) ok = false;
    lo = Math.min(lo, m); hi = Math.max(hi, m);
  }
  row('PITCH', 'whole base: D5 x pitchRatio snapped to the nearest D pentatonic note in A4..D6 (ratios 0.70..1.43)', ok, `MIDI ${lo}..${hi}`);
}
{
  let ok = true, lo = 99, hi = 0;
  for (const frac of [0.5, 0.35, 0.25, 0.18, 0.125]) for (const r of [0.7, 1, 1.43]) {
    const m = baseNote(r * popSize(frac), 1);
    if (!PENTA.includes(m % 12) || m < PIECE_LO || m > PIECE_HI) ok = false;
    lo = Math.min(lo, m); hi = Math.max(hi, m);
  }
  row('PITCH', 'piece base: D6 x pitchRatio x popSize(frac) snapped in D6..D7 (1175..2349 Hz)', ok, `MIDI ${lo}..${hi}`);
}
{
  // a cold place one semitone lower before the snap: never higher than the warm note, and at most one pentatonic step lower
  let ok = true;
  for (let k = 0; k <= 100; k++) { const r = 0.7 * Math.pow(1.43 / 0.7, k / 100); const w = baseNote(r, 0), c = baseNote(r * Math.pow(2, -1 / 12), 0); if (c > w || w - c > 3) ok = false; }
  row('PITCH', 'cold (pitch x 2^(-1/12)) never raises the note, lowers it at most one step', ok, 'ok');
}
{
  let ok = true;
  for (const b of [69, 71, 74, 76, 78, 81, 83, 86]) for (let d = -4; d <= 4; d++) { const m = degNote(b, d); if (!PENTA.includes(m % 12)) ok = false; if (d > 0 && m <= b) ok = false; if (d < 0 && m >= b) ok = false; }
  row('PITCH', 'a spoken degree is pentatonic steps from the voice note (every result on D pentatonic, in the right direction)', ok, 'ok');
}
{
  // sung notes: on the sounding field's rest tones, in the voice's octave; with the home field LIFE's own REST_TONES come back unchanged
  let ok = true, homeSame = true;
  for (const b of [69, 74, 78, 81, 86]) for (let f = 0; f < 4; f++) for (let d = -4; d <= 4; d++) {
    const m = sungNote(b, d, f);
    if (!FIELD_REST[f].includes(m % 12) || Math.abs(m - b) > 14) ok = false;
  }
  for (const [d, pc] of [[0, 2], [3, 9], [1, 4]] as const) if (sungNote(74, d, 0) % 12 !== pc) homeSame = false;
  row('PITCH', 'sung notes re-voiced onto the sounding field rest tones (4 fields, degrees -4..4), near the voice', ok, 'ok');
  row('PITCH', "home field: LIFE's rest tones D 0, A 3, E 1 sound as planned (D5, A5, E5)", homeSame, [0, 3, 1].map((d) => sungNote(74, d, 0)).join(','));
}

/* ── AU-10: ChatterLimiter, pure, synthetic time ── */
{
  const L = new ChatterLimiter();
  // burst: 6 syllable starts at once, then 4 a second
  let n = 0;
  for (let i = 0; i < 10; i++) if (L.admit(i * 0.011, 1, 0.01)) n++;
  row('AU-10', 'desktop burst: 6 one-syllable phrases in 0.1 s (each 10 ms long, so the voice cap is not the limit)', n === 6, n);
  let m = 0;
  for (let t = 0.15; t < 10.15; t += 0.05) if (L.admit(t, 1, 0.01)) m++;
  row('AU-10', 'refill 4 starts a second: 10 s of requests every 50 ms after the burst admit about 40', m >= 39 && m <= 42, m);
}
{
  const L = new ChatterLimiter();
  let ok = L.admit(0, 1, 2) && L.admit(0.01, 1, 2) && L.admit(0.02, 1, 2);
  const fourth = L.admit(0.03, 1, 2);
  ok = ok && !fourth;
  const later = L.admit(2.5, 1, 1);
  row('AU-10', '3 voices at once at most; a 4th waits until one ends', ok && later, `4th ${fourth}, after the end ${later}`);
}
{
  const L = new ChatterLimiter();
  const a = L.admit(0, 1, 2, 1.5), b = L.admit(0.1, 1, 2, 1.5), c = L.admit(0.2, 1, 2, 1);
  row('AU-10', 'an echo counts half a voice: two voices with echoes fill the cap of 3', a && b && !c, `${a} ${b} ${c}`);
}
{
  const L = new ChatterLimiter();
  const a = L.admit(0, 4, 0.8);
  const b = L.admit(0.1, 3, 0.5);
  row('AU-10', 'a phrase takes one start per syllable: 4 + 3 > burst 6 is refused', a && !b, `${a} ${b}`);
}
{
  const L = new ChatterLimiter();
  const a = L.admit(0, 2, 0.3, 1, true), b = L.admit(1.0, 1, 0.1, 1, true), c = L.admit(2.0, 1, 0.1, 1, true), d = L.admit(2.5, 1, 0.1, 1, true), e = L.admit(2.6, 1, 0.1, 1, false);
  row('AU-10', 'touching: at most 1 syllable a second (2 syllables then 2 s of quiet); not touching, no such wait', a && !b && c && !d && e, `${a} ${b} ${c} ${d} ${e}`);
}
{
  const L = new ChatterLimiter();
  const bad = [L.admit(NaN, 1, 0.1), L.admit(Infinity, 1, 0.1), L.admit(0, 1, NaN), L.admit(0, 1, -1)];
  const after = L.admit(0, 1, 0.1);
  row('AU-10', 'a non-finite clock or length is refused and never poisons the bucket', bad.every((x) => !x) && after, `${bad.join(',')} then ${after}`);
}
{
  // a storm of 50 requests a second for 30 s at the PHONE caps: never more than 2 live, never more than 4 syllables in any 1 s after the burst
  const L = new ChatterLimiter(ChatterLimiter.PHONE);
  const r = mulberry32(7);
  let maxLive = 0, admits = 0;
  const starts: number[] = [];
  for (let t = 0; t < 30; t += 0.02) {
    const n = 1 + Math.floor(r() * 4), d = 0.1 + r() * 0.9;
    if (L.admit(t, n, d)) { admits++; for (let k = 0; k < n; k++) starts.push(t); }
    maxLive = Math.max(maxLive, L.live(t + 1e-6));
  }
  let worst = 0;
  for (let t = 2; t < 29; t += 0.1) worst = Math.max(worst, starts.filter((u) => u >= t && u < t + 1).length);
  row('AU-10', 'storm, phone caps (50 requests a second, 30 s): live voices <= 2, syllable starts in any 1 s window <= refill + 1', maxLive <= 2 && worst <= 4, `max live ${maxLive}, worst 1 s ${worst}, admitted ${admits}`);
}
{
  // pure: the same calls give the same answers
  const run = (): string => { const L = new ChatterLimiter(); const r = mulberry32(3); let s = ''; for (let t = 0; t < 5; t += 0.03) s += L.admit(t, 1 + Math.floor(r() * 4), r(), r() < 0.3 ? 1.5 : 1, r() < 0.2) ? '1' : '0'; return s; };
  row('AU-10', 'pure and deterministic (two runs identical)', run() === run(), run().length);
}

{
  // Sing together / a finale: three singers' 4-note phrases over one bar (LIFE voice.ts SING layout) at the same bar line all fit the
  // desktop backstop (each spends its densest second, 2 starts); a fourth singer is refused (3 voices at once)
  const E = 60 / 66 / 2;
  const sing = new Float32Array([0, 0, 0, 1.4, 1, 1, 2 * E, 1.4, 0, 0, 4 * E, 1.4, 3, 1, 6 * E, 2]);
  const speak = new Float32Array([0, 0, 0, 1, 1, 1, 0.14, 1, 3, 2, 0.35, 1]);
  const L = new ChatterLimiter();
  const r = [0, 1, 2, 3].map((k) => L.admit(10 + k * 0.001, sylStarts(sing, 4), 8 * E, 1));
  row('AU-10', 'Sing together: 3 singers at one bar line all admitted (a sung phrase spends 2 starts), a 4th refused; a spoken 3-syllable phrase spends 3', r[0] && r[1] && r[2] && !r[3] && sylStarts(sing, 4) === 2 && sylStarts(speak, 3) === 3, `${r.join(' ')}; sung ${sylStarts(sing, 4)}, spoken ${sylStarts(speak, 3)}`);
}
{
  // setMusicStyle('cabin'): more dusk and home fields than the home style, from the same composer seed (and the same number of draws)
  const share = (style: string): number[] => { const c = new Composer(5); c.style = STYLES[style]; const n = [0, 0, 0, 0]; for (let b = 0; b < 4000; b++) n[c.nextBar().field]++; return n.map((v) => v / 4000); };
  const h = share('home'), cb = share('cabin');
  row('STYLE', "cabin: more dusk + home bars than the home style (4000 bars)", cb[0] + cb[2] > h[0] + h[2] + 0.1, `home ${h.map((v) => v.toFixed(2)).join('/')}, cabin ${cb.map((v) => v.toFixed(2)).join('/')}`);
}

/* ── round 2 (S2, S3): the place things, the beds and the styles every place names ── */
{
  const PLACES = [P_HOME, P_HEARTH, P_RIPPLE, P_FROST, P_RAIN, P_ROOF, P_CLOUD];   // (round 6, D-96: the seven; Fizzwell Tub, Cogwhistle Bench and Echo Hollow are dropped)
  const elsewhere = [PROP.ball, PROP.creak, PROP.crackle, PROP.kettle];
  const kinds = Object.values(PROP).filter((k) => !elsewhere.includes(k as never));
  row('IDS', 'every PROP_SOUND kind has a voice: ball, creak, crackle and kettle as before, the other 8 in things.ts STRIKE (and nothing else)', kinds.every((k) => typeof STRIKE[k] === 'function') && Object.keys(STRIKE).length === kinds.length, Object.keys(STRIKE).join(','));
  const used = new Set<number>(); for (const pl of PLACES) for (const th of pl.things) if (th.sound) used.add(th.sound);
  row('IDS', 'every thing sound the place data names has a voice', [...used].every((k) => elsewhere.includes(k as never) || typeof STRIKE[k] === 'function'), [...used].sort((x, y) => x - y).join(','));
  const amb = PLACES.filter((pl) => pl.ambience !== 'none');
  row('IDS', "every place's ambience id and place id resolve to its recipe (AMB_ALIAS); Home has none", amb.every((pl) => ambKey(pl.ambience) === pl.id && ambKey(pl.id) === pl.id) && ambKey('home') === '' && ambKey('none') === '' && Object.keys(AMB_ALIAS).length === 6,   // (round 6, D-96: six aliases, was nine)
    amb.map((pl) => `${pl.ambience}->${ambKey(pl.ambience)}`).join(' '));
  row('IDS', "every place's music style exists in MUSIC_STYLES", PLACES.every((pl) => Object.prototype.hasOwnProperty.call(MUSIC_STYLES, pl.music)), PLACES.map((pl) => pl.music).join(','));
  // the tuned things' notes are D major pentatonic already (snapPenta leaves them), and the snap moves any note at most a semitone
  const notes: number[] = []; for (const pl of PLACES) for (const th of pl.things) if ((th as { notes?: number[] }).notes) notes.push(...((th as { notes?: number[] }).notes as number[]));
  let snapOk = true; for (let m = 48; m <= 100; m++) { const q = snapPenta(m); if (!PENTA.includes(((q % 12) + 12) % 12) || Math.abs(q - m) > 1) snapOk = false; }
  // (re-specified in round 6 for D-96: at least 9 notes, was 15: the Singing Crystals and the Little Bell went with Echo Hollow and Cogwhistle Bench;
  // the kept tuned things are the Shell Chimes' 5 and the Icicle Bells' 4)
  row('PITCH', 'chime / bell / crystal notes in the place data are D pentatonic (unchanged by the snap); any note snaps within a semitone', notes.length >= 9 && notes.every((m) => snapPenta(m) === m) && snapOk, notes.join(','));
  // every style keeps FIELD_NEXT's drifts (weights only move), sums to 1, and a non-home style draws the same number of composer numbers
  let drift = true;
  for (const [k, st] of Object.entries(STYLES)) for (let f = 0; f < 4; f++) {
    const a = st.next[f].map((q) => q[0]).sort().join(), b = FIELD_NEXT[f].map((q) => q[0]).sort().join();
    if (a !== b || Math.abs(st.next[f].reduce((s2, q) => s2 + q[1], 0) - 1) > 1e-9) { drift = false; console.log('style', k, f); }
  }
  row('STYLE', `all ${Object.keys(STYLES).length} styles keep FIELD_NEXT's drifts (never back to the field just left), weights sum to 1`, drift && Object.keys(STYLES).length === 7,   // (round 6, D-96: seven styles, was ten)
    Object.keys(STYLES).join(','));
  const share = (style: string): number[] => { const c = new Composer(5); c.style = STYLES[style]; const n = [0, 0, 0, 0]; for (let b2 = 0; b2 < 4000; b2++) n[c.nextBar().field]++; return n.map((v) => v / 4000); };
  const h = share('home');
  // PLACES' "Music style" lines: which fields each style favours (more bars than home's share of them)
  const want: Record<string, number[]> = { shore: [1, 3], ridge: [3, 0], garden: [0, 1], roof: [2], cloud: [1, 3] };   // (round 6, D-96: bath, bench, hollow went with their places)
  const res: string[] = []; let fav = true;
  for (const [k, fs] of Object.entries(want)) { const sh = share(k); const ok = fs.reduce((s2, f) => s2 + sh[f] - h[f], 0) > 0.08; if (!ok) fav = false; res.push(`${k} ${sh.map((v) => v.toFixed(2)).join('/')}`); }
  row('STYLE', 'each place style favours the fields PLACES names (their share over home\'s by > 0.08; 4000 bars)', fav, `home ${h.map((v) => v.toFixed(2)).join('/')}; ${res.join('; ')}`);
  const optional = Object.entries(STYLES).filter(([k]) => k !== 'home').every(([, st]) => st.lp >= 0 && (st.tau ?? 1) > 0 && (st.echo ?? 1) >= 0 && (st.thin ?? 0) < 0.5);
  row('STYLE', "home keeps no tau / echo / thin (today's note); the place styles' values are in range", optional && STYLES.home.tau === undefined && STYLES.home.echo === undefined && STYLES.home.thin === undefined, 'ok');
  // the ridge's thinning: the note-seed hash leaves out about thin of the notes, and no composer draw is involved
  let drop = 0; for (let sd = 1; sd <= 20000; sd++) if ((Math.imul((sd * 2654435761) ^ 0x2c1b3c6d, 0x297a2d39) >>> 0) / 4294967296 < (STYLES.ridge.thin ?? 0)) drop++;
  row('STYLE', 'ridge: the sparser mallet leaves out about 35% of notes by the note seed hash (20000 seeds)', Math.abs(drop / 20000 - 0.35) < 0.02, (drop / 20000).toFixed(3));
}
{
  // WeatherClock: the own timer spaces events lo..hi; a shell event takes the lead for 30 s
  const r = mulberry32(7), W = new WeatherClock(0, 9, 14, r), ev: number[] = [];
  W.run(0, 100, r, (t) => ev.push(t));
  const gaps = ev.slice(1).map((t, i) => t - ev[i]);
  const W2 = new WeatherClock(0, 9, 14, mulberry32(7)), ev2: number[] = [];
  W2.heard(20); W2.run(0, 100, mulberry32(8), (t) => ev2.push(t));
  row('AMB', 'own gust timer every 9..14 s; after a shell weather event at 20 s nothing of its own until 50 s', gaps.every((g) => g >= 9 && g <= 14) && ev.length >= 6 && ev2.every((t) => t < 20 || t > 50), `${ev.length} gusts, gaps ${Math.min(...gaps).toFixed(1)}..${Math.max(...gaps).toFixed(1)}; with the shell ${ev2.map((t) => t.toFixed(0)).join(',')}`);
  // patterCurve: Poisson micro-ticks at the asked rate, in one curve (no node a tick)
  let curve: Float32Array | null = null, dur = 0;
  const pm = { setValueCurveAtTime: (c: Float32Array, _t: number, d: number) => { curve = c; dur = d; } } as unknown as AudioParam;
  patterCurve(pm, 0, 4, 60, 0.1, 0.6, mulberry32(9));
  let peaks = 0; const c = curve as unknown as Float32Array; for (let i = 1; i < c.length - 1; i++) if (c[i] > c[i - 1] * 1.5 + 1e-6 && c[i] >= c[i + 1]) peaks++;
  row('AMB', 'rain patter: 60 ticks a second for 4 s in one gain curve (240 +- 20%), peak <= 0.1', Math.abs(peaks - 240) <= 48 && Math.max(...c) <= 0.1 + 1e-9 && dur > 3.99, `${peaks} ticks, peak ${Math.max(...c).toFixed(3)}`);
}

/* ── AU-14: a 10-minute cabin visit with no input ── */
{
  // the shell's kettle timer (PG_SHELL step 5): a 1-bar whistle every 45 to 90 s, seeded; the gate refuses any start too close to a tune
  const G = new TuneGate();
  const r = mulberry32(0x6b657474);
  let t = 45 + 45 * r(), sounding = 0, starts = 0;
  const dur = TUNE_BARS[TUNE.kettle] * BAR_S;
  while (t < 600) { if (G.admit(TUNE.kettle, t, dur)) { starts++; sounding += Math.min(dur, 600 - t); } t += 45 + 45 * r(); }
  row('AU-14', 'no input, 10-minute cabin visit: tunes sound at most 20% of it', sounding / 600 <= 0.2, `${(100 * sounding / 600).toFixed(1)}% (${starts} whistles of ${dur.toFixed(2)} s)`);
  row('AU-14', "the kettle's whistle is one bar (3.6 s), never an 8-bar tune", Math.abs(dur - 3.636) < 0.01 && TUNE_BARS[TUNE.box] === 8, `${dur.toFixed(3)} s; box ${(TUNE_BARS[TUNE.box] * BAR_S).toFixed(1)} s`);
}
{
  // the worst case the shell's timer allows (every 45 s exactly): still under 20%
  const G = new TuneGate();
  let sounding = 0;
  const dur = BAR_S;
  for (let t = 45; t < 600; t += 45) if (G.admit(TUNE.kettle, t, dur)) sounding += dur;
  row('AU-14', 'worst-case kettle (every 45 s): under 20%', sounding / 600 <= 0.2, `${(100 * sounding / 600).toFixed(1)}%`);
}
{
  const G = new TuneGate(), D = 8 * BAR_S;
  const a = G.admit(TUNE.box, 0, D), b = G.admit(TUNE.box, 39.9, D), c = G.admit(TUNE.box, 40, D);
  row('AU-14', 'the Music Box starts at most once per 40 s', a && !b && c, `${a} ${b} ${c}`);
}
{
  const G = new TuneGate(), D = 8 * BAR_S;
  G.admit(TUNE.box, 0, D);
  const during = G.admit(TUNE.kettle, 10, BAR_S);
  const after59 = G.admit(TUNE.kettle, D + 59.9, BAR_S);
  const after60 = G.admit(TUNE.kettle, D + 60.01, BAR_S);
  row('AU-14', 'no kettle whistle during a Music Box tune or within 60 s after it', !during && !after59 && after60, `${during} ${after59} ${after60}`);
  const G2 = new TuneGate();
  G2.admit(TUNE.box, 0, D); G2.stop(TUNE.box, 5);
  row('AU-14', 'a second tap stops the tune (the 60 s count starts at the stop)', !G2.playing(TUNE.box, 6) && G2.admit(TUNE.kettle, 65.1, BAR_S) && !new TuneGate().playing(TUNE.box, 0), 'ok');
  const G3 = new TuneGate();
  G3.admit(TUNE.kettle, 0, BAR_S);
  row('AU-14', 'a Music Box tap during a whistle plays (the player wins; the engine cuts the whistle)', G3.admit(TUNE.box, 1, D) && !G3.playing(TUNE.kettle, 1.5), 'ok');
}

let bad = 0;
for (const r of rows) { if (!r.ok) bad++; console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(6)} ${r.name}  =>  ${r.v}`); }
console.log(`\n${rows.length - bad}/${rows.length} rows ok`);
process.exit(bad ? 1 : 0);
