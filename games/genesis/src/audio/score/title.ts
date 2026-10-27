// GENESIS — "First Light", the title / orbit theme (authored; rendered by offline.ts, shipped as assets/title.ogg).
//
// D dorian, 4/4, ♩ = 70, 40 bars (2:17), loops without a seam (the coda's drone and bells fold into the intro).
//   Intro   1–4   the void and a star: a drone, glass bells tease the motif's head high up, a cymbal breath.
//   A       5–12  first light: the motif on a lone horn over a string pad and a slow harp; an antecedent that stops on
//                 the flat seventh (C) and a consequent that climbs to the high D and closes modally (Am → Dm).
//   A′     13–20  the people wake: violins take the tune an octave up, the horn turns counter-line, hummed voices,
//                 the harp moves in quavers, a first timpani stroke.
//   B      21–28  the age of wonders: the relative major (F C G Am), the motif's rhythm with a new contour, voices
//                 join, low drums and a timpani roll build to an A-major dominant — the only note outside the mode (C♯).
//   A″     29–36  the world sings: the tune in violins and horns, a full choir, harp, celesta sparks, timpani.
//   Coda   37–40  return to the stars: celesta and bells recall the head; a flute asks it once more, unresolved;
//                 the drone carries round into bar 1.
// Harmony (A sections): i – IV – ♭III… in dorian terms Dm | G | F | C | Dm | G | Am | Dm — G major's B♮ is the
// dorian colour the whole game's music is built on.

import { arp, bar, chords, line, motif, ramp, type BeatNote, type Piece, type ScorePart } from './motif.ts';

const A_PROG = ['Dm', 'G', 'F', 'C', 'Dm', 'G', 'Am', 'Dm'];
const B_PROG = ['F', 'C', 'G', 'Am', 'F', 'C', 'G', 'A'];

/** the A tune (horn register; violins play it +12) */
const A_TUNE =
  'D4:1.5 A4:.5 G4:.5 A4:.5 C5:1 | B4:2 A4:2 | A4:1.5 G4:.5 F4:.5 G4:.5 A4:1 | G4:3 r:1 | ' +
  'D4:1.5 A4:.5 G4:.5 A4:.5 C5:1 | D5:2 C5:1 B4:1 | A4:1.5 G4:.5 E4:1 G4:1 | D4:3 r:1';

/** the B tune (the motif's rhythm, a new contour, rising to the dominant) */
const B_TUNE =
  'A4:1.5 C5:.5 D5:.5 C5:.5 A4:1 | G4:2 E4:2 | D5:1.5 B4:.5 A4:.5 B4:.5 D5:1 | E5:2 C5:2 | ' +
  'F5:1.5 E5:.5 D5:.5 C5:.5 A4:1 | G4:1 C5:1 E5:2 | D5:1.5 C5:.5 B4:1 G4:1 | A4:2 C#5:1 E5:1';

const PAD_A = ['D3 F3 A3', 'D3 G3 B3', 'C3 F3 A3', 'C3 E3 G3', 'D3 F3 A3', 'D3 G3 B3', 'C3 E3 A3', 'D3 F3 A3'];
const PAD_B = ['C3 F3 A3', 'C3 E3 G3', 'B2 D3 G3', 'C3 E3 A3', 'C3 F3 A3', 'C3 E3 G3', 'B2 D3 G3', 'C#3 E3 A3'];
const ROOT_A = ['D2', 'G2', 'F2', 'C2', 'D2', 'G2', 'A2', 'D2'];
const ROOT_B = ['F2', 'C2', 'B1', 'A2', 'F2', 'C2', 'B1', 'A2'];
const CHOIR_A = ['A3 D4 F4', 'B3 D4 G4', 'A3 C4 F4', 'G3 C4 E4', 'A3 D4 F4', 'B3 D4 G4', 'A3 C4 E4', 'A3 D4 F4'];

function bassLine(start: number, roots: string[], vel: number | ((b: number) => number)): BeatNote[] {
  return chords(start, 4, roots, vel);
}

/** every beat a timpani stroke on the downbeat (and beat 3 where `three`) — tonic or dominant drum */
function timp(bars: number[], vel: number | ((b: number) => number), three = false): BeatNote[] {
  const out: BeatNote[] = [];
  for (const b of bars) {
    const t = bar(b);
    const v = typeof vel === 'number' ? vel : vel(t);
    out.push({ b: t, d: 1, midi: 38, v });
    if (three) out.push({ b: t + 2, d: 1, midi: 33, v: v * 0.7 });
  }
  return out;
}

function roll(fromBar: number, bars: number, v0: number, v1: number): BeatNote[] {
  const out: BeatNote[] = [];
  const t0 = bar(fromBar), n = bars * 4 * 4;
  for (let i = 0; i < n; i++) out.push({ b: t0 + i * 0.25, d: 0.25, midi: i % 2 ? 33 : 33.1, v: v0 + (v1 - v0) * Math.pow(i / n, 1.6) });
  return out;
}

function sparkle(fromBar: number, progs: string[], vel: number): BeatNote[] {
  // celesta on the off-beats, chord tones two octaves up, turning
  const out: BeatNote[] = [];
  const shape = [4, 3, 5, 3];
  progs.forEach((sym, i) => {
    const c = { Dm: [50, 3], G: [55, 4], F: [53, 4], C: [48, 4], Am: [57, 3], A: [57, 4] }[sym] as number[];
    const tones = [c[0] + 12, c[0] + 19, c[0] + 24, c[0] + 24 + c[1], c[0] + 31, c[0] + 36];
    for (let k = 0; k < 4; k++) out.push({ b: bar(fromBar + i) + k + 0.5, d: 0.5, midi: tones[shape[k]], v: vel * (k === 0 ? 1 : 0.8) });
  });
  return out;
}

function piece(): Piece {
  const parts: ScorePart[] = [];
  const add = (p: ScorePart): void => { parts.push(p); };

  // ── the drone: intro and coda (its release folds into bar 1) ──
  add({ inst: 'drone', notes: [{ b: bar(1), d: 16, midi: 38, v: 0.55 }, { b: bar(37), d: 16, midi: 38, v: 0.55 }], gain: 0.7, send: 0.5, pan: 0, role: 'harmony' });

  // ── the pad: intro and coda colours ──
  add({ inst: 'pad', notes: [
    ...chords(bar(1), 8, ['D3 A3 E4 F4'], 0.45),
    ...chords(bar(3), 4, ['G2 D3 B3 A4', 'C3 G3 D4 E4'], 0.45),
    ...chords(bar(37), 4, ['D3 A3 F4', 'D3 G3 B3', 'C3 G3 E4', 'D3 A3 E4'], 0.45),
  ], gain: 0.55, send: 0.55, pan: 0, role: 'harmony' });

  // ── glass bells: the head, high and far, in the intro; celesta and bells recall it in the coda ──
  add({ inst: 'glass', notes: [
    ...motif(bar(1), 0.5, { octave: 2, take: 5 }),
    { b: bar(2), d: 4, midi: 95, v: 0.42 },
    ...line(bar(3), 'r:1 D6:1 E6:1 A6:1 | G6:2 r:2', 0.32),
    { b: bar(38), d: 4, midi: 95, v: 0.38 },
  ].map((n, i) => ({ ...n, pan: [-0.5, 0.3, -0.2, 0.5, 0, 0.2][i % 6] })), gain: 0.55, send: 0.75, pan: 0, role: 'colour' });
  add({ inst: 'celesta', notes: [...motif(bar(37), 0.42, { octave: 2, take: 5 }), ...sparkle(29, A_PROG, 0.34)], gain: 0.45, send: 0.5, pan: 0.4, role: 'colour' });

  // ── the cymbal breaths into A and into A″ ──
  add({ inst: 'swell', notes: [{ b: bar(4), d: 4, midi: 60, v: 0.35 }, { b: bar(28), d: 4, midi: 60, v: 0.75 }], gain: 0.5, send: 0.4, pan: 0, role: 'colour' });

  // ── the strings: pad from A to A″ ──
  add({ inst: 'strings', notes: [
    ...chords(bar(5), 4, PAD_A, 0.42),
    ...chords(bar(13), 4, PAD_A, 0.5),
    ...chords(bar(21), 4, PAD_B, ramp(bar(21), 0.58, bar(28), 0.78)),
    ...chords(bar(29), 4, PAD_A, 0.8),
    ...chords(bar(29), 4, PAD_A, 0.55, 12),
  ], gain: 0.5, send: 0.45, pan: 0, role: 'harmony' });

  // ── basses ──
  add({ inst: 'bass', notes: [
    ...bassLine(bar(5), ROOT_A, 0.45),
    ...bassLine(bar(13), ROOT_A, 0.55),
    ...bassLine(bar(21), ROOT_B, ramp(bar(21), 0.55, bar(28), 0.8)),
    ...bassLine(bar(29), ROOT_A, 0.85),
  ], gain: 0.6, send: 0.3, pan: 0.3, role: 'harmony' });

  // ── the tune: horn (A), violins (A′, B, A″), the horn doubling below in A″ ──
  add({ inst: 'horn', notes: [
    ...line(bar(5), A_TUNE, 0.6),
    // A′: the horn's counter-line, guide tones
    ...line(bar(13), 'A3:4 | B3:4 | A3:4 | G3:4 | A3:2 F3:2 | G3:2 B3:2 | C4:2 E4:2 | D4:4', 0.42),
    // B: the horn section's sustained thirds from bar 25
    ...line(bar(25), 'A3:4 | G3:4 | B3:4 | C#4:4', ramp(bar(25), 0.5, bar(28), 0.75)),
    ...line(bar(29), A_TUNE, 0.82),
  ], gain: 0.75, send: 0.4, pan: 0.15, role: 'melody' });
  add({ inst: 'violins', notes: [
    ...line(bar(13), A_TUNE, 0.6, 12),
    ...line(bar(21), B_TUNE, ramp(bar(21), 0.72, bar(28), 0.88)),
    ...line(bar(29), A_TUNE, 0.9, 12),
  ], gain: 0.62, send: 0.42, pan: -0.3, role: 'melody' });

  // ── voices: hummed in A′, the tune's shadow in B, a full choir in A″ ──
  add({ inst: 'oohs', notes: chords(bar(13), 4, CHOIR_A, 0.38), gain: 0.5, send: 0.55, pan: 0, role: 'harmony' });
  add({ inst: 'choir', notes: [
    ...line(bar(21), B_TUNE, ramp(bar(21), 0.5, bar(28), 0.65), -12),
    ...chords(bar(29), 4, CHOIR_A, 0.62),
  ], gain: 0.45, send: 0.6, pan: 0, role: 'harmony' });

  // ── the harp: quarters in A, quavers from A′ ──
  add({ inst: 'harp', notes: [
    ...arp(bar(5), 4, A_PROG, [0, 2, 3, 2], 1, 0.4),
    ...arp(bar(13), 4, A_PROG, [0, 1, 2, 3, 4, 3, 2, 1], 0.5, 0.42),
    ...arp(bar(21), 4, B_PROG, [0, 1, 2, 3, 4, 3, 2, 1], 0.5, ramp(bar(21), 0.48, bar(28), 0.58)),
    ...arp(bar(29), 4, A_PROG, [0, 1, 2, 3, 4, 5, 4, 2], 0.5, 0.55),
  ], gain: 0.5, send: 0.45, pan: -0.45, role: 'rhythm' });

  // ── drums: a first stroke in A′, low drums and a roll in B, the climax ──
  add({ inst: 'timpani', notes: [
    ...timp([16, 20], 0.45),
    ...timp([25, 26], ramp(bar(25), 0.5, bar(26), 0.6), true),
    ...roll(27, 2, 0.12, 0.75),
    ...timp([29, 30, 31, 32, 33, 34, 35], 0.7),
    ...timp([32, 36], 0.6, true),
    ...timp([37], 0.3),
  ], gain: 0.6, send: 0.35, pan: 0.1, role: 'rhythm' });
  add({ inst: 'lowdrum', notes: [25, 26, 27, 28].flatMap((b) => [{ b: bar(b), d: 1, midi: 31, v: 0.35 + (b - 25) * 0.1 }, { b: bar(b) + 2, d: 1, midi: 31, v: 0.28 + (b - 25) * 0.08 }]), gain: 0.55, send: 0.3, pan: 0, role: 'rhythm' });

  // ── coda: the flute asks the head once more, unresolved ──
  add({ inst: 'flute', notes: line(bar(39), 'D5:1.5 A5:.5 G5:2 | A5:4', 0.42), gain: 0.55, send: 0.55, pan: -0.15, role: 'melody' });

  return {
    id: 'title',
    bpm: 70,
    beatsPerBar: 4,
    bars: 40,
    room: { rt60: 2.8, damp: 0.35, pre: 0.025, size: 1.15 },
    wet: 0.3,
    parts,
  };
}

export const TITLE: Piece = piece();
