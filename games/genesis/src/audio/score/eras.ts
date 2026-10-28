// GENESIS — the four ERA pieces (authored; rendered by offline.ts, shipped as Opus stems in assets/era-*-<stem>.ogg).
//
// Each shares the GENESIS motif (motif.ts: D A G A C | B A) and the home key (D), and grows with the age: the stone age
// sings it pentatonic and leaves the question open (no sixth); the bronze road completes it on a reed over a lyre; the
// cathedral age dances it in triple time and chants it; the age of engines turns it into an ostinato under horns.
// Every piece ships as four stems that loop together, sample-locked (authored.ts):
//   main     always: the tune and its harmony
//   day      daylight: the dance — drums, rattles, a second voice
//   night    darkness: the hush — low hummed voices, a far flute, a distant bell
//   tension  war, fire, quakes, storms: low drums, horn calls, a dissonant shadow over either
// A stem never carries the tune alone, so any mix of them is complete music.

import { arp, bar as barOf, chords, line, pulse, type BeatNote, type Piece, type ScorePart } from './motif.ts';

type Vel = number | ((b: number) => number);

function builder(bpb: number): { parts: ScorePart[]; add: (p: ScorePart) => void; bar: (n: number) => number } {
  const parts: ScorePart[] = [];
  return { parts, add: (p) => { parts.push(p); }, bar: (n) => barOf(n, bpb) };
}

/** each note gets a seat in the stereo field from a short cycle (a section breathing across the stage) */
function spread(ns: BeatNote[], seats: number[]): BeatNote[] { return ns.map((n, i) => ({ ...n, pan: seats[i % seats.length] })); }

/** a held drone: `bars`-long notes of `midi` from bar 1 to the end (its release folds into bar 1) */
function drone(total: number, bpb: number, each: number, midi: number, v: Vel): BeatNote[] {
  const out: BeatNote[] = [];
  for (let b = 1; b <= total; b += each) {
    const t = barOf(b, bpb);
    out.push({ b: t, d: each * bpb, midi, v: typeof v === 'number' ? v : v(t) });
  }
  return out;
}

// ═════════════════════════ THE STONE AGE — "Fire Circle" ═════════════════════════
// D minor pentatonic (D F G A C), 4/4, ♩ = 66, 16 bars (58.2 s).
//   1–2   the drone and the hummed fifth; the day's drum starts the circle.
//   3–6   the bone flute: the motif without its sixth — D A G A C | A — and an answer falling to G, left open on A.
//   7–10  the motif again, climbing to the high D and closing on the tonic.
//   11–14 the hummed voices take the tune an octave down; the flute holds a slow descant over them.
//   15–16 the flute asks the head once more, unresolved: the circle closes into bar 1.

function stone(): Piece {
  const B = 4, { parts, add, bar } = builder(B);
  // ── main ──
  add({ inst: 'drone', notes: drone(16, B, 8, 38, 0.6), gain: 0.7, send: 0.45, pan: 0, role: 'harmony' });
  add({ inst: 'oohs', notes: [
    ...chords(bar(1), 8, ['D3 A3'], 0.4),
    ...chords(bar(3), 8, ['D3 A3', 'C3 G3'], 0.36),
    ...chords(bar(7), 8, ['D3 A3'], 0.36),
    ...chords(bar(9), 8, ['C3 G3'], 0.36),
    ...chords(bar(15), 8, ['D3 A3'], 0.38),
  ], gain: 0.5, send: 0.5, pan: 0, role: 'harmony' });
  add({ inst: 'oohs', notes: line(bar(11), 'D3:1.5 A3:.5 G3:.5 A3:.5 C4:1 | A3:4 | G3:1.5 F3:.5 D3:.5 F3:.5 G3:1 | D3:4', 0.5), gain: 0.55, send: 0.5, pan: -0.15, role: 'melody' });
  add({ inst: 'boneflute', notes: [
    ...line(bar(3), 'D4:1.5 A4:.5 G4:.5 A4:.5 C5:1 | A4:4 | G4:1.5 F4:.5 D4:.5 F4:.5 G4:1 | A4:3 r:1', 0.6),
    ...line(bar(7), 'D4:1.5 A4:.5 G4:.5 A4:.5 C5:1 | D5:2 C5:1 A4:1 | G4:1.5 A4:.5 G4:.5 F4:.5 D4:1 | D4:3 r:1', 0.64),
    ...line(bar(11), 'A4:4 | C5:2 A4:2 | G4:4 | F4:2 G4:2', 0.42),
    ...line(bar(15), 'D5:1.5 A4:.5 G4:2 | A4:4', 0.5),
  ], gain: 0.6, send: 0.5, pan: 0.12, role: 'melody', stem: 'main' });
  // ── day: the circle dances ──
  add({ inst: 'framedrum', notes: [
    ...pulse(1, 2, B, [[0, 45, 0.55], [2, 45, 0.4]]),
    ...pulse(3, 12, B, [[0, 45, 0.7], [1.5, 50, 0.4], [2, 45, 0.55], [3, 50, 0.38], [3.5, 50, 0.32]]),
    ...pulse(15, 2, B, [[0, 45, 0.55], [2, 45, 0.4], [3.5, 50, 0.3]]),
  ], gain: 0.5, send: 0.25, pan: -0.2, role: 'rhythm', stem: 'day' });
  add({ inst: 'shaker', notes: pulse(3, 12, B, [[0.5, 60, 0.3], [1.5, 60, 0.22], [2.5, 60, 0.3], [3.5, 60, 0.22]]), gain: 0.4, send: 0.2, pan: 0.35, role: 'rhythm', stem: 'day' });
  add({ inst: 'boneflute', notes: [
    ...line(bar(1), 'r:2 A5:.5 C6:.5 A5:1 | r:1 G5:.5 A5:.5 D5:2', 0.32),
    ...line(bar(15), 'r:2 A5:.5 C6:.5 A5:1 | r:1 G5:.5 A5:.5 D5:2', 0.3),
  ], gain: 0.5, send: 0.6, pan: -0.55, role: 'colour', stem: 'day' });
  // ── night: low voices round the embers, a flute far off ──
  add({ inst: 'oohs', notes: chords(bar(1), 16, ['A2 D3', 'G2 D3', 'A2 D3', 'A2 D3'], 0.34), gain: 0.32, send: 0.6, pan: 0, role: 'harmony', stem: 'night' });
  add({ inst: 'boneflute', notes: [
    ...line(bar(5), 'r:2 D5:1.5 A5:.5 | G5:4', 0.3),
    ...line(bar(13), 'r:2 C6:1.5 A5:.5 | G5:4', 0.28),
  ], gain: 0.5, send: 0.85, pan: 0.6, role: 'colour', stem: 'night' });
  add({ inst: 'lowdrum', notes: pulse(1, 16, B, [[0, 33, 0.3], [0.6, 33, 0.18]]), gain: 0.5, send: 0.4, pan: 0, role: 'rhythm', stem: 'night' });
  // ── tension: the drums of danger and a beating, dissonant hum ──
  add({ inst: 'lowdrum', notes: pulse(1, 16, B, [[0, 31, 0.75], [0.75, 31, 0.5], [2, 31, 0.62], [3.5, 31, 0.45]]), gain: 0.6, send: 0.3, pan: 0, role: 'rhythm', stem: 'tension' });
  add({ inst: 'framedrum', notes: pulse(1, 16, B, [[0, 47, 0.6], [0.5, 47, 0.28], [1, 47, 0.45], [1.5, 47, 0.28], [2, 47, 0.55], [2.5, 47, 0.28], [3, 47, 0.45], [3.5, 47, 0.35]]), gain: 0.6, send: 0.2, pan: 0.25, role: 'rhythm', stem: 'tension' });
  add({ inst: 'oohs', notes: chords(bar(1), 16, ['D3 Eb3 A3', 'C3 Db3 G3', 'D3 Eb3 A3', 'D3 Eb3 Ab3'], 0.36), gain: 0.34, send: 0.5, pan: 0, role: 'harmony', stem: 'tension' });
  add({ inst: 'swell', notes: [4, 8, 12, 16].map((b) => ({ b: bar(b) + 1, d: 3, midi: 60, v: 0.5 })), gain: 0.4, send: 0.4, pan: 0, role: 'colour', stem: 'tension' });
  return { id: 'era-stone', bpm: 66, beatsPerBar: B, bars: 16, room: { rt60: 1.9, damp: 0.5, pre: 0.012, size: 0.8 }, wet: 0.24, parts };
}

// ═════════════════════════ BRONZE AND IRON — "The Bronze Road" ═════════════════════════
// D dorian, 4/4, ♩ = 84, 20 bars (57.1 s). The sixth (B♮) arrives: the motif is whole for the first time.
//   1–4   a lyre ostinato over the drone (Dm Dm C Dm).
//   5–12  the reed sings the full motif, D A G A C | B A, and spins it out to the tonic (Dm G Dm C | Dm G Am Dm).
//   13–16 the road opens: the relative major (F C G Am), the motif's rhythm with a new contour.
//   17–20 the head an octave up, falling to A — the dominant that turns the road back to bar 1.

const BRONZE_PROG = ['Dm', 'Dm', 'C', 'Dm', 'Dm', 'G', 'Dm', 'C', 'Dm', 'G', 'Am', 'Dm', 'F', 'C', 'G', 'Am', 'Dm', 'G', 'C', 'Am'];
const BRONZE_PAD: Record<string, string> = { Dm: 'D3 F3 A3', G: 'D3 G3 B3', C: 'C3 E3 G3', Am: 'C3 E3 A3', F: 'C3 F3 A3' };

function bronze(): Piece {
  const B = 4, { parts, add, bar } = builder(B);
  // ── main ──
  add({ inst: 'drone', notes: drone(20, B, 10, 38, 0.55), gain: 0.4, send: 0.4, pan: 0, role: 'harmony' });
  add({ inst: 'lyre', notes: spread(arp(bar(1), B, BRONZE_PROG, [0, 2, 1, 2, 3, 2, 1, 2], 0.5, (b) => (b < bar(5) ? 0.42 : 0.38)), [-0.35, -0.2, -0.3, -0.15]), gain: 1.0, send: 0.4, pan: -0.15, role: 'rhythm' });
  add({ inst: 'reed', notes: [
    ...line(bar(5), 'D4:1.5 A4:.5 G4:.5 A4:.5 C5:1 | B4:2 A4:2 | G4:1 A4:.5 B4:.5 C5:1 D5:1 | C5:3 r:1 | ' +
      'D5:1.5 C5:.5 B4:.5 A4:.5 G4:1 | B4:1 A4:.5 G4:.5 F4:1 G4:1 | E4:1.5 F4:.5 G4:1 E4:1 | D4:3 r:1', 0.58),
    ...line(bar(13), 'A4:1.5 C5:.5 D5:.5 C5:.5 A4:1 | G4:2 E4:2 | D5:1.5 B4:.5 A4:.5 B4:.5 D5:1 | E5:2 C5:1 A4:1', 0.62),
    ...line(bar(17), 'D5:1.5 A5:.5 G5:.5 A5:.5 C6:1 | B5:2 A5:2 | G5:1.5 E5:.5 C5:1 E5:1 | A4:4', 0.46),
  ], gain: 0.55, send: 0.42, pan: 0.15, role: 'melody' });
  // ── day: the market road — doum and tek, rattles, a harp's answer ──
  add({ inst: 'framedrum', notes: [
    ...pulse(1, 4, B, [[0, 43, 0.5], [2, 43, 0.38]]),
    ...pulse(5, 16, B, [[0, 43, 0.7], [1, 50, 0.36], [1.5, 50, 0.3], [2, 43, 0.55], [3, 50, 0.42], [3.5, 50, 0.26]]),
  ], gain: 0.4, send: 0.25, pan: 0.2, role: 'rhythm', stem: 'day' });
  add({ inst: 'shaker', notes: pulse(5, 16, B, [[0.5, 60, 0.26], [1.5, 60, 0.2], [2.5, 60, 0.26], [3.5, 60, 0.2]]), gain: 0.4, send: 0.2, pan: -0.4, role: 'rhythm', stem: 'day' });
  add({ inst: 'harp', notes: spread(arp(bar(13), B, BRONZE_PROG.slice(12), [2, 3, 4, 3], 1, 0.45), [0.5, 0.35, 0.55, 0.4]), gain: 1.2, send: 0.45, pan: 0.4, role: 'colour', stem: 'day' });
  // ── night: hummed chords and a flute under the stars ──
  add({ inst: 'oohs', notes: chords(bar(1), 4, BRONZE_PROG.map((c) => BRONZE_PAD[c]), 0.32), gain: 0.24, send: 0.6, pan: 0, role: 'harmony', stem: 'night' });
  add({ inst: 'flute', notes: [
    ...line(bar(9), 'A5:4 | G5:4 | E5:4 | F5:4', 0.34),
    ...line(bar(17), 'D5:8 | E5:4 A4:4', 0.32),
  ], gain: 0.28, send: 0.7, pan: -0.45, role: 'colour', stem: 'night' });
  // ── tension: the march — low drums, timpani, the bronze horn's call (the motif's rising fifth) ──
  add({ inst: 'lowdrum', notes: pulse(1, 20, B, [[0, 31, 0.72], [2, 31, 0.6], [3.5, 31, 0.42]]), gain: 0.48, send: 0.3, pan: 0, role: 'rhythm', stem: 'tension' });
  add({ inst: 'timpani', notes: pulse(1, 20, B, [[0, 38, 0.5], [3, 33, 0.36]]), gain: 0.5, send: 0.35, pan: 0.15, role: 'rhythm', stem: 'tension' });
  add({ inst: 'horn', notes: [1, 5, 9, 13, 17].flatMap((b) => line(bar(b), 'D3:1.5 A3:2.5 | r:2 C4:.5 A3:1.5', 0.6)), gain: 0.35, send: 0.4, pan: -0.25, role: 'colour', stem: 'tension' });
  add({ inst: 'choir', notes: chords(bar(13), 16, ['D4 E4 A4'], 0.4), gain: 0.24, send: 0.55, pan: 0, role: 'harmony', stem: 'tension' });
  return { id: 'era-bronze', bpm: 84, beatsPerBar: B, bars: 20, room: { rt60: 2.1, damp: 0.42, pre: 0.016, size: 0.9 }, wet: 0.26, parts };
}

// ═════════════════════════ THE MEDIEVAL AGE — "Bells and Plainsong" ═════════════════════════
// D dorian, 3/4, ♩ = 105, 32 bars (54.9 s): the motif danced (D A G A C | B A in triple time) and chanted.
//   A   1–8   the recorder's tune over a lute and the organ's open fifth (Dm G C Am | G F C Dm).
//   A′  9–16  the shawm takes it; by day a recorder descant rides above.
//   B   17–24 the relative major (F C F Am | F G Am A) — by night the plainsong sings it.
//   A″  25–32 recorder and shawm together, an octave apart; the dorian cadence C → Dm folds into bar 1.

const MED_A = ['Dm', 'G', 'C', 'Am', 'G', 'F', 'C', 'Dm'];
const MED_B = ['F', 'C', 'F', 'Am', 'F', 'G', 'Am', 'A'];
const MED_TUNE_A = 'D4:1 A4:.5 G4:.5 A4:.5 C5:.5 | B4:2 A4:1 | G4:1 A4:.5 B4:.5 C5:1 | A4:3 | D5:1 C5:.5 B4:.5 A4:.5 G4:.5 | A4:2 F4:1 | E4:1 G4:1 F4:.5 E4:.5 | D4:3';
const MED_TUNE_B = 'A4:1 C5:.5 D5:.5 E5:1 | D5:2 C5:1 | A4:1 G4:.5 A4:.5 C5:1 | A4:3 | F4:1 G4:.5 A4:.5 C5:1 | B4:1 A4:1 G4:1 | A4:1 G4:.5 F4:.5 E4:1 | E4:3';

function medieval(): Piece {
  const B = 3, { parts, add, bar } = builder(B);
  const prog = [...MED_A, ...MED_A, ...MED_B, ...MED_A];
  // ── main ──
  add({ inst: 'organ', notes: [
    ...chords(bar(1), 24, ['D3 A3'], 0.4),
    ...chords(bar(9), 24, ['D3 A3'], 0.42),
    ...chords(bar(17), 12, ['F3 C4', 'F3 C4'], 0.42),
    ...chords(bar(25), 24, ['D3 A3'], 0.45),
  ], gain: 0.42, send: 0.45, pan: 0, role: 'harmony' });
  add({ inst: 'lyre', notes: spread(arp(bar(1), B, prog, [0, 1, 2, 1, 3, 1], 0.5, (b) => (b < bar(9) ? 0.36 : 0.4), 0, 1.3), [-0.4, -0.3, -0.45, -0.25]), gain: 1.1, send: 0.4, pan: -0.2, role: 'rhythm' });
  add({ inst: 'bass', notes: chords(bar(1), 3, prog.map((c) => ({ Dm: 'D2', G: 'G2', C: 'C2', Am: 'A2', F: 'F2', A: 'A2' } as Record<string, string>)[c]), 0.38), gain: 0.42, send: 0.25, pan: 0.2, role: 'harmony' });
  add({ inst: 'flute', notes: [
    ...line(bar(1), MED_TUNE_A, 0.56),
    ...line(bar(17), MED_TUNE_B, 0.52, 12),
    ...line(bar(25), MED_TUNE_A, 0.56, 12),
  ], gain: 0.52, send: 0.42, pan: 0.2, role: 'melody' });
  add({ inst: 'reed', notes: [
    ...line(bar(9), MED_TUNE_A, 0.55),
    ...line(bar(25), MED_TUNE_A, 0.5),
  ], gain: 0.5, send: 0.4, pan: -0.1, role: 'melody' });
  // ── day: the fair — tabor and jingles, a bell at each strain, the recorder's descant ──
  add({ inst: 'framedrum', notes: pulse(1, 32, B, [[0, 45, 0.62], [1, 52, 0.3], [1.5, 52, 0.28], [2, 45, 0.45]]), gain: 0.48, send: 0.25, pan: 0.25, role: 'rhythm', stem: 'day' });
  add({ inst: 'shaker', notes: pulse(1, 32, B, [[0.5, 60, 0.22], [1.5, 60, 0.18], [2.5, 60, 0.24]]), gain: 0.38, send: 0.2, pan: -0.35, role: 'rhythm', stem: 'day' });
  add({ inst: 'bell', notes: [1, 9, 17, 25].map((b) => ({ b: bar(b), d: 3, midi: 62, v: 0.32 })), gain: 0.8, send: 0.6, pan: 0.45, role: 'colour', stem: 'day' });
  add({ inst: 'flute', notes: line(bar(9), 'F5:3 | D5:3 | E5:3 | C5:3 | D5:3 | C5:3 | B4:1.5 C5:1.5 | A4:3', 0.36), gain: 0.32, send: 0.55, pan: 0.5, role: 'colour', stem: 'day' });
  // ── night: plainsong in open fifths, a far bell ──
  add({ inst: 'oohs', notes: [
    ...chords(bar(1), 24, ['D3 A3', 'D3 A3'], 0.34),
    ...chords(bar(25), 24, ['D3 A3'], 0.34),
  ], gain: 0.34, send: 0.6, pan: 0, role: 'harmony', stem: 'night' });
  add({ inst: 'choir', notes: [
    ...line(bar(17), MED_TUNE_B, 0.42, -12),
    ...line(bar(17), MED_TUNE_B, 0.32, -19),
  ], gain: 0.65, send: 0.65, pan: 0, role: 'colour', stem: 'night' });
  add({ inst: 'bell', notes: [5, 13, 21, 29].map((b) => ({ b: bar(b), d: 3, midi: 50, v: 0.24 })), gain: 0.85, send: 0.8, pan: -0.5, role: 'colour', stem: 'night' });
  // ── tension: war drums, horn calls in fifths, low viols driving ──
  add({ inst: 'timpani', notes: pulse(1, 32, B, [[0, 38, 0.55], [2, 33, 0.38]]), gain: 0.5, send: 0.35, pan: 0.15, role: 'rhythm', stem: 'tension' });
  add({ inst: 'lowdrum', notes: pulse(1, 32, B, [[0, 31, 0.65], [1.5, 31, 0.42]]), gain: 0.55, send: 0.3, pan: 0, role: 'rhythm', stem: 'tension' });
  add({ inst: 'horn', notes: [1, 5, 9, 13, 17, 21, 25, 29].flatMap((b) => chords(bar(b), 1.5, ['D3 A3'], 0.55).concat(chords(bar(b) + 1.5, 1.5, ['C3 G3'], 0.45))), gain: 0.33, send: 0.4, pan: -0.2, role: 'colour', stem: 'tension' });
  add({ inst: 'cellos', notes: pulse(1, 32, B, [[0, 38, 0.55], [0.5, 38, 0.35], [1, 38, 0.42], [1.5, 38, 0.35], [2, 39, 0.45], [2.5, 38, 0.35]], 1, 0.45), gain: 0.45, send: 0.3, pan: 0.3, role: 'rhythm', stem: 'tension' });
  return { id: 'era-medieval', bpm: 105, beatsPerBar: B, bars: 32, room: { rt60: 2.6, damp: 0.38, pre: 0.022, size: 1.05 }, wet: 0.28, parts };
}

// ═════════════════════════ THE AGE OF ENGINES — "Engines and Stars" ═════════════════════════
// D dorian, 4/4, ♩ = 96, 24 bars (60.0 s): the motif turned machine — an ostinato under horns, then violins.
//   1–4   cellos' ostinato and a pad (Dm Dm C C).
//   5–12  horns: the motif whole and spun out (Dm G F C | Dm G Am Dm).
//   13–20 violins take it an octave up, the horns turn counter-line; it ends on the dominant (… Am A).
//   21–24 the ostinato thins; the celesta recalls the head, unresolved, into bar 1.

const ENG_PROG = ['Dm', 'Dm', 'C', 'C', 'Dm', 'G', 'F', 'C', 'Dm', 'G', 'Am', 'Dm', 'Dm', 'G', 'F', 'C', 'Dm', 'G', 'Am', 'A', 'Dm', 'Dm', 'C', 'Dm'];
const ENG_PAD: Record<string, string> = { Dm: 'D3 A3 E4 F4', G: 'D3 G3 B3 D4', C: 'C3 G3 D4 E4', F: 'C3 F3 A3 E4', Am: 'C3 E3 A3 B3', A: 'C#3 E3 A3 B3' };
const ENG_ROOT: Record<string, string> = { Dm: 'D2', G: 'G1', C: 'C2', F: 'F1', Am: 'A1', A: 'A1' };
const ENG_TUNE = 'D4:1.5 A4:.5 G4:.5 A4:.5 C5:1 | B4:2 A4:2 | F4:1 G4:.5 A4:.5 C5:1 F5:1 | E5:3 r:1 | ' +
  'D5:1.5 C5:.5 B4:.5 A4:.5 G4:1 | B4:2 A4:2 | C5:1 B4:.5 A4:.5 E4:1 A4:1 | D4:4';
const ENG_TUNE_2 = 'D4:1.5 A4:.5 G4:.5 A4:.5 C5:1 | B4:2 A4:2 | F4:1 G4:.5 A4:.5 C5:1 F5:1 | E5:3 r:1 | ' +
  'D5:1.5 C5:.5 B4:.5 A4:.5 G4:1 | B4:2 A4:2 | C5:1 B4:.5 A4:.5 E4:1 G4:1 | A4:4';

function engines(): Piece {
  const B = 4, { parts, add, bar } = builder(B);
  // ── main ──
  add({ inst: 'cellos', notes: spread(arp(bar(1), B, ENG_PROG, [0, 1, 2, 1, 0, 1, 3, 1], 0.5, (b) => (b < bar(5) || b >= bar(21) ? 0.4 : 0.46), -12, 0.85), [-0.3, -0.1]), gain: 0.67, send: 0.3, pan: -0.1, role: 'rhythm' });
  add({ inst: 'pad', notes: chords(bar(1), 4, ENG_PROG.map((c) => ENG_PAD[c]), (b) => (b < bar(5) ? 0.38 : 0.42)), gain: 0.5, send: 0.5, pan: 0, role: 'harmony' });
  add({ inst: 'bass', notes: chords(bar(5), 4, ENG_PROG.slice(4, 20).map((c) => ENG_ROOT[c]), 0.45), gain: 0.45, send: 0.25, pan: 0.15, role: 'harmony' });
  add({ inst: 'horn', notes: [
    ...line(bar(5), ENG_TUNE, 0.62),
    ...line(bar(13), 'A3:4 | B3:4 | A3:4 | G3:4 | A3:2 F3:2 | G3:2 B3:2 | C4:2 E4:2 | C#4:4', 0.45),
  ], gain: 0.72, send: 0.4, pan: 0.15, role: 'melody' });
  add({ inst: 'violins', notes: line(bar(13), ENG_TUNE_2, 0.62, 12), gain: 0.58, send: 0.42, pan: -0.3, role: 'melody' });
  add({ inst: 'celesta', notes: line(bar(21), 'D6:1.5 A6:.5 G6:.5 A6:.5 C7:1 | r:4 | D6:1.5 A6:.5 G6:2 | A6:4', 0.4), gain: 0.8, send: 0.55, pan: 0.35, role: 'melody' });
  // ── day: the works — a ticking pulse, a harp's turning, the violins' long counter-line ──
  add({ inst: 'shaker', notes: pulse(1, 24, B, [[0, 60, 0.24], [0.5, 60, 0.16], [1, 60, 0.2], [1.5, 60, 0.16], [2, 60, 0.24], [2.5, 60, 0.16], [3, 60, 0.2], [3.5, 60, 0.18]]), gain: 0.36, send: 0.15, pan: 0.3, role: 'rhythm', stem: 'day' });
  add({ inst: 'harp', notes: spread(arp(bar(5), B, ENG_PROG.slice(4, 20), [2, 3, 4, 3], 0.5, 0.42), [0.45, 0.3, 0.5, 0.35]), gain: 1.4, send: 0.4, pan: 0.4, role: 'colour', stem: 'day' });
  add({ inst: 'violins', notes: line(bar(5), 'F5:4 | D5:4 | C5:4 | E5:4 | F5:4 | D5:4 | E5:4 | F5:4', 0.4), gain: 0.45, send: 0.5, pan: -0.45, role: 'colour', stem: 'day' });
  // ── night: glass stars, a high pad, a flute ──
  add({ inst: 'glass', notes: spread([3, 11, 19].flatMap((b) => line(bar(b), 'D6:1.5 A6:.5 G6:.5 A6:.5 C7:1', 0.3)), [-0.55, 0.4, -0.2, 0.6, 0]), gain: 0.5, send: 0.8, pan: 0, role: 'colour', stem: 'night' });
  add({ inst: 'pad', notes: chords(bar(1), 16, ['A4 D5', 'A4 D5', 'A4 E5', 'A4 E5', 'A4 E5', 'A4 D5'], 0.24), gain: 0.42, send: 0.7, pan: 0, role: 'harmony', stem: 'night' });
  add({ inst: 'flute', notes: line(bar(13), 'A5:8 | G5:4 F5:4 | E5:8 | A5:8', 0.32), gain: 0.4, send: 0.65, pan: 0.45, role: 'colour', stem: 'night' });
  // ── tension: drums and horn stabs, a swell into every strain ──
  add({ inst: 'timpani', notes: pulse(1, 24, B, [[0, 38, 0.58], [2.5, 38, 0.38], [3, 33, 0.48]]), gain: 0.52, send: 0.35, pan: 0.15, role: 'rhythm', stem: 'tension' });
  add({ inst: 'lowdrum', notes: pulse(1, 24, B, [[0, 31, 0.7], [1.5, 31, 0.42], [2, 31, 0.5]]), gain: 0.55, send: 0.3, pan: 0, role: 'rhythm', stem: 'tension' });
  add({ inst: 'horn', notes: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23].flatMap((b) => chords(bar(b), 0.75, ['D3 A3 D4'], 0.55).concat(chords(bar(b) + 1.5, 0.75, ['Eb3 Bb3 Eb4'], 0.45))), gain: 0.36, send: 0.4, pan: -0.25, role: 'colour', stem: 'tension' });
  add({ inst: 'swell', notes: [4, 12, 20].map((b) => ({ b: bar(b), d: 4, midi: 60, v: 0.6 })), gain: 0.42, send: 0.4, pan: 0, role: 'colour', stem: 'tension' });
  return { id: 'era-engines', bpm: 96, beatsPerBar: B, bars: 24, room: { rt60: 2.4, damp: 0.33, pre: 0.02, size: 1.1 }, wet: 0.26, parts };
}

export const ERA_STONE: Piece = stone();
export const ERA_BRONZE: Piece = bronze();
export const ERA_MEDIEVAL: Piece = medieval();
export const ERA_ENGINES: Piece = engines();
export const ERAS: Piece[] = [ERA_STONE, ERA_BRONZE, ERA_MEDIEVAL, ERA_ENGINES];
