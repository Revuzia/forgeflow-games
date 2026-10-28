// GENESIS — the STINGERS: short authored phrases that mark the moments between the god and the people (LIVING §0:
// "authored music"; §3.4 prayers, prophets and signs; §3.7 wrath). Rendered by offline.ts as one-shots (the tail kept,
// not folded), shipped as assets/sting-<id>.ogg, played by authored.ts over the music, which ducks under them.
//
// Each is built on the game's motif head (D A G A C: up a fifth, down a step, up a step, up a minor third) so it is
// heard as the same voice as the title and the era pieces, and each bends it toward its meaning:
//   answered  "Grace"          — a prayer answered. ♩ = 92, flute and celesta over a rolled harp; the plagal-modal
//                                 cadence D5 | C | G/B | D major (the Picardy third: the only F♯ is the answer).
//   fulfilled "The Word Kept"  — a prophecy fulfilled. ♩ = 80, the head on horns, violins above, then the leap to the
//                                 high D over the aeolian cadence Dm | B♭ C | D major, a timpani roll and a full choir.
//   sign      "A Sign"         — a sign sent. ♩ = 72, glass and celesta in canon a fourth apart high over a D drone and
//                                 a cymbal breath; it hangs on the dorian B over Em7/D — unresolved, a question.
//   wrath     "Wrath"          — the god's disaster. ♩ = 76, the head in low horns and cellos in D aeolian, war drums,
//                                 Dm | C | B♭ | A major: it stops on the dominant (C♯), a threat, not an ending.

import { chords, line, type BeatNote, type Piece, type ScorePart } from './motif.ts';

export type StingerId = 'answered' | 'fulfilled' | 'sign' | 'wrath';
export const STINGER_IDS: StingerId[] = ['answered', 'fulfilled', 'sign', 'wrath'];

/** a harp roll: the notes of a chord one after another, `gap` beats apart, all held to `until` */
function roll(b: number, names: string, gap: number, until: number, v: number): BeatNote[] {
  return names.split(/\s+/).filter(Boolean).map((nm, i) => {
    const n = line(b + i * gap, `${nm}:1`, v)[0];
    return { ...n, d: Math.max(0.25, until - (b + i * gap)) };
  });
}

function answered(): Piece {
  const parts: ScorePart[] = [];
  const add = (p: ScorePart): void => { parts.push(p); };
  // the tune: the whole motif, high and light
  add({ inst: 'flute', notes: line(0, 'D5:1.5 A5:.5 G5:.5 A5:.5 C6:1 | B5:2 A5:3', 0.62), gain: 0.62, send: 0.5, pan: -0.15, role: 'melody' });
  add({ inst: 'celesta', notes: line(0, 'D6:1.5 A6:.5 G6:.5 A6:.5 C7:1 | B6:2 A6:3', 0.3), gain: 0.32, send: 0.55, pan: 0.25, role: 'colour' });
  // the harp rolls the cadence
  add({ inst: 'harp', notes: [
    ...roll(0, 'D3 A3 D4 A4 E5', 0.12, 2, 0.5),
    ...roll(2, 'C3 G3 C4 E4 G4', 0.1, 4, 0.45),
    ...roll(4, 'B2 G3 D4 G4 B4', 0.1, 6, 0.45),
    ...roll(6, 'D3 A3 D4 F#4 A4 D5 F#5', 0.09, 10, 0.55),
  ], gain: 0.55, send: 0.5, pan: -0.4, role: 'rhythm' });
  add({ inst: 'strings', notes: [
    ...chords(0, 2, ['D3 A3 D4', 'C3 G3 C4 E4', 'B2 G3 D4'], (b) => 0.32 + b * 0.03),
    ...chords(6, 4, ['D3 A3 D4 F#4'], 0.55),
  ], gain: 0.5, send: 0.5, pan: 0, role: 'harmony' });
  add({ inst: 'oohs', notes: chords(6, 4, ['A3 D4 F#4'], 0.45), gain: 0.45, send: 0.6, pan: 0, role: 'harmony' });
  add({ inst: 'bass', notes: line(0, 'D2:2 C2:2 B1:2 D2:4', 0.42), gain: 0.5, send: 0.3, pan: 0.25, role: 'harmony' });
  add({ inst: 'bell', notes: [{ b: 6, d: 4, midi: 74, v: 0.35 }, { b: 6.02, d: 4, midi: 81, v: 0.18 }], gain: 0.4, send: 0.6, pan: 0.3, role: 'colour' });
  add({ inst: 'swell', notes: [{ b: 4, d: 2, midi: 60, v: 0.28 }], gain: 0.45, send: 0.5, pan: 0, role: 'colour' });
  return { id: 'sting-answered', bpm: 92, beatsPerBar: 4, bars: 2, room: { rt60: 2.6, damp: 0.35, pre: 0.02, size: 1.1 }, wet: 0.3, parts };
}

function fulfilled(): Piece {
  const parts: ScorePart[] = [];
  const add = (p: ScorePart): void => { parts.push(p); };
  const tune = 'D4:1.5 A4:.5 G4:.5 A4:.5 C5:1 | D5:5';
  add({ inst: 'horn', notes: line(0, tune, (b) => (b < 4 ? 0.66 : 0.85)), gain: 0.78, send: 0.4, pan: 0.15, role: 'melody' });
  add({ inst: 'violins', notes: line(0, tune, (b) => (b < 4 ? 0.5 : 0.8), 12), gain: 0.6, send: 0.45, pan: -0.3, role: 'melody' });
  add({ inst: 'strings', notes: [
    ...chords(0, 2, ['D3 F3 A3 D4'], 0.5),
    ...chords(2, 1, ['Bb2 F3 Bb3 D4', 'C3 G3 C4 E4'], 0.6),
    ...chords(4, 5, ['D3 A3 D4 F#4'], 0.82),
    ...chords(4, 5, ['A4 D5 F#5'], 0.5),
  ], gain: 0.5, send: 0.45, pan: 0, role: 'harmony' });
  add({ inst: 'choir', notes: [
    ...chords(2, 1, ['D4 F4 Bb4', 'E4 G4 C5'], 0.5),
    ...chords(4, 5, ['D4 F#4 A4 D5'], 0.72),
  ], gain: 0.48, send: 0.6, pan: 0, role: 'harmony' });
  add({ inst: 'bass', notes: line(0, 'D2:2 Bb1:1 C2:1 D2:5', (b) => (b < 4 ? 0.55 : 0.8)), gain: 0.6, send: 0.3, pan: 0.3, role: 'harmony' });
  // the timpani roll on A into the arrival, then the tonic stroke
  const rollN: BeatNote[] = [];
  for (let i = 0; i < 8; i++) rollN.push({ b: 2 + i * 0.25, d: 0.25, midi: i % 2 ? 33 : 33.1, v: 0.15 + 0.5 * Math.pow(i / 8, 1.5) });
  add({ inst: 'timpani', notes: [{ b: 0, d: 1, midi: 38, v: 0.45 }, ...rollN, { b: 4, d: 2, midi: 38, v: 0.8 }], gain: 0.6, send: 0.35, pan: 0.1, role: 'rhythm' });
  // the harp's run up the D major scale into the arrival, then a roll
  const run = 'D4 E4 F#4 G4 A4 B4 C#5 D5'.split(' ').map((nm, i) => ({ ...line(3.2 + i * 0.1, `${nm}:.5`, 0.3 + i * 0.03)[0] }));
  add({ inst: 'harp', notes: [...run, ...roll(4, 'D3 A3 D4 F#4 A4 D5', 0.08, 9, 0.55)], gain: 0.5, send: 0.45, pan: -0.45, role: 'rhythm' });
  add({ inst: 'bell', notes: [{ b: 4, d: 4, midi: 74, v: 0.4 }, { b: 4, d: 4, midi: 69, v: 0.25 }], gain: 0.4, send: 0.6, pan: 0.35, role: 'colour' });
  add({ inst: 'swell', notes: [{ b: 1, d: 3, midi: 60, v: 0.55 }], gain: 0.5, send: 0.4, pan: 0, role: 'colour' });
  return { id: 'sting-fulfilled', bpm: 80, beatsPerBar: 4, bars: 2, room: { rt60: 2.9, damp: 0.33, pre: 0.025, size: 1.2 }, wet: 0.32, parts };
}

function sign(): Piece {
  const parts: ScorePart[] = [];
  const add = (p: ScorePart): void => { parts.push(p); };
  // glass states the head on A, the celesta answers it a fourth above two beats later: the canon is the sign
  add({ inst: 'glass', notes: line(0, 'A5:1.5 E6:.5 D6:.5 E6:.5 G6:1 | B5:4', 0.55), gain: 0.55, send: 0.65, pan: -0.3, role: 'melody' });
  add({ inst: 'celesta', notes: line(2, 'D6:1.5 A6:.5 G6:.5 A6:.5 C7:1 | B6:3', 0.38), gain: 0.4, send: 0.65, pan: 0.35, role: 'melody' });
  add({ inst: 'drone', notes: [{ b: 0, d: 8, midi: 38, v: 0.45 }, { b: 0, d: 8, midi: 45, v: 0.25 }], gain: 0.5, send: 0.4, pan: 0, role: 'harmony' });
  add({ inst: 'pad', notes: chords(0, 4, ['D3 A3 E4', 'D3 G3 B3 E4'], 0.4), gain: 0.45, send: 0.6, pan: 0, role: 'harmony' });
  add({ inst: 'oohs', notes: chords(4, 4, ['B3 E4'], 0.3), gain: 0.4, send: 0.7, pan: 0, role: 'harmony' });
  add({ inst: 'swell', notes: [{ b: 0, d: 3.5, midi: 60, v: 0.45 }, { b: 5, d: 3, midi: 60, v: 0.25 }], gain: 0.45, send: 0.6, pan: 0, role: 'colour' });
  add({ inst: 'bell', notes: [{ b: 0, d: 6, midi: 62, v: 0.3 }, { b: 4, d: 6, midi: 69, v: 0.22 }], gain: 0.35, send: 0.7, pan: 0.2, role: 'colour' });
  return { id: 'sting-sign', bpm: 72, beatsPerBar: 4, bars: 2, room: { rt60: 3.6, damp: 0.25, pre: 0.035, size: 1.35 }, wet: 0.4, parts };
}

function wrath(): Piece {
  const parts: ScorePart[] = [];
  const add = (p: ScorePart): void => { parts.push(p); };
  const tune = 'D3:1.5 A3:.5 G3:.5 A3:.5 C4:1 | Bb3:2 A3:3';
  add({ inst: 'horn', notes: line(0, tune, (b) => (b < 6 ? 0.78 : 0.9)), gain: 0.8, send: 0.35, pan: 0.15, role: 'melody' });
  add({ inst: 'cellos', notes: line(0, tune, 0.7, -12), gain: 0.55, send: 0.3, pan: 0.35, role: 'harmony' });
  add({ inst: 'strings', notes: [
    ...chords(0, 3, ['D3 F3 A3'], 0.6),
    ...chords(3, 1, ['C3 E3 G3'], 0.6),
    ...chords(4, 2, ['Bb2 D3 F3'], 0.72),
    ...chords(6, 3, ['A2 C#3 E3 A3'], 0.85),
  ], gain: 0.5, send: 0.4, pan: -0.15, role: 'harmony' });
  add({ inst: 'choir', notes: chords(4, 2, ['D4 F4 Bb4'], 0.6).concat(chords(6, 3, ['C#4 E4 A4'], 0.75)), gain: 0.45, send: 0.55, pan: 0, role: 'harmony' });
  add({ inst: 'bass', notes: line(0, 'D2:3 C2:1 Bb1:2 A1:3', 0.8), gain: 0.6, send: 0.25, pan: 0, role: 'harmony' });
  // the war drums: the head's own rhythm, then the drive into the dominant
  const hit = (b: number, v: number): BeatNote => ({ b, d: 1, midi: 31, v });
  add({ inst: 'lowdrum', notes: [hit(0, 0.9), hit(1.5, 0.6), hit(2, 0.7), hit(3, 0.75), hit(4, 0.85), hit(5.5, 0.6), hit(6, 0.95)], gain: 0.62, send: 0.3, pan: 0, role: 'rhythm' });
  const rollN: BeatNote[] = [];
  for (let i = 0; i < 6; i++) rollN.push({ b: 4.5 + i * 0.25, d: 0.25, midi: i % 2 ? 33 : 33.1, v: 0.2 + 0.45 * Math.pow(i / 6, 1.5) });
  add({ inst: 'timpani', notes: [{ b: 0, d: 2, midi: 38, v: 0.8 }, ...rollN, { b: 6, d: 2, midi: 33, v: 0.9 }], gain: 0.6, send: 0.3, pan: -0.1, role: 'rhythm' });
  add({ inst: 'swell', notes: [{ b: 4, d: 2, midi: 60, v: 0.6 }], gain: 0.5, send: 0.4, pan: 0, role: 'colour' });
  return { id: 'sting-wrath', bpm: 76, beatsPerBar: 4, bars: 2, room: { rt60: 2.6, damp: 0.45, pre: 0.02, size: 1.1 }, wet: 0.28, parts };
}

export const STINGERS: Record<StingerId, Piece> = { answered: answered(), fulfilled: fulfilled(), sign: sign(), wrath: wrath() };
