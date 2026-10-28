// GENESIS — the authored score's theory and notation: the GENESIS MOTIF that every authored piece shares, the home key,
// and a small note-name notation the score modules (title.ts, eras.ts, stingers.ts) are written in.
//
// The motif (D dorian, 4/4):   D4 .  A4 G4 A4 C5 | B4 ─  A4 ─
//   a rising fifth (the call), a step back and a climb to the flat seventh, then the dorian sixth sighing down to the
//   fifth. The stone age sings it without the sixth (pentatonic: … C5 A4 — the question left open); later ages complete
//   it; the title theme states it in full and answers it. Its head (D A G A C: +7 −2 +2 +3 semitones) is the
//   fingerprint the tests look for in every piece.

import type { Note, Part, Inst, RoomOpts } from './offline.ts';

export const TONIC = 62; // D4
export const DORIAN = [0, 2, 3, 5, 7, 9, 10];
export const AEOLIAN = [0, 2, 3, 5, 7, 8, 10];
export const PENTATONIC_MINOR = [0, 3, 5, 7, 10];

/** the motif as dorian scale degrees from the tonic, and its rhythm in beats */
export const MOTIF_DEG = [0, 4, 3, 4, 6, 5, 4];
export const MOTIF_DUR = [1.5, 0.5, 0.5, 0.5, 1, 2, 2];
/** the head's semitone steps (D A G A C) — every authored piece states it at least once */
export const MOTIF_HEAD = [7, -2, 2, 3];

/** a scale degree (any integer: 7 = the octave) in a mode, as MIDI */
export function deg(d: number, octave = 0, tonic = TONIC, mode = DORIAN): number {
  const m = mode.length;
  const o = Math.floor(d / m), i = ((d % m) + m) % m;
  return tonic + 12 * (o + octave) + mode[i];
}

/** a note in beats (the score's unit; `toNotes` makes seconds) */
export interface BeatNote { b: number; d: number; midi: number; v: number; pan?: number }

const NAMES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 'D4' / 'C#5' / 'Bb3' → MIDI */
export function midiOf(name: string): number {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name.trim());
  if (!m) throw new Error(`bad note name ${name}`);
  return 12 * (Number(m[3]) + 1) + NAMES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

/**
 * A melodic line from `start` (beats): "D4:1.5 A4:.5 r:1 | C5:2" — name:beats, r = rest, | is only for the eye.
 * `vel` may be a number or a function of the beat (a crescendo); `shift` transposes by semitones.
 */
export function line(start: number, spec: string, vel: number | ((b: number) => number), shift = 0, legato = 1): BeatNote[] {
  const out: BeatNote[] = [];
  let b = start;
  for (const tok of spec.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    const [name, len] = tok.split(':');
    const d = Number(len);
    if (!(d > 0)) throw new Error(`bad duration in ${tok}`);
    if (name !== 'r') out.push({ b, d: d * legato, midi: midiOf(name) + shift, v: typeof vel === 'number' ? vel : vel(b) });
    b += d;
  }
  return out;
}

/** block chords: each entry "D3 F3 A3" held `each` beats from `start` */
export function chords(start: number, each: number, list: string[], vel: number | ((b: number) => number), shift = 0): BeatNote[] {
  const out: BeatNote[] = [];
  list.forEach((c, i) => {
    const b = start + i * each;
    for (const name of c.split(/\s+/)) if (name) out.push({ b, d: each, midi: midiOf(name) + shift, v: typeof vel === 'number' ? vel : vel(b) });
  });
  return out;
}

/** chord symbols the arpeggiators know: root (octave 3) and third quality */
export const CHORD: Record<string, { root: number; third: number }> = {
  Dm: { root: 50, third: 3 }, D: { root: 50, third: 4 }, Em: { root: 52, third: 3 }, F: { root: 53, third: 4 },
  G: { root: 55, third: 4 }, Gm: { root: 55, third: 3 }, Am: { root: 57, third: 3 }, A: { root: 57, third: 4 },
  C: { root: 48, third: 4 }, Bb: { root: 46, third: 4 }, Bdim: { root: 47, third: 3 },
};

/**
 * Broken chords: one chord symbol per bar, `pattern` as offsets into the chord's tones (0 root, 1 fifth, 2 octave,
 * 3 tenth, 4 octave+fifth, 5 two octaves), one tone every `step` beats.
 */
export function arp(start: number, beatsPerBar: number, bars: string[], pattern: number[], step: number, vel: number | ((b: number) => number), shift = 0, hold = 1.5): BeatNote[] {
  const out: BeatNote[] = [];
  bars.forEach((sym, bi) => {
    const c = CHORD[sym];
    if (!c) throw new Error(`unknown chord ${sym}`);
    const tones = [c.root, c.root + 7, c.root + 12, c.root + 12 + c.third, c.root + 19, c.root + 24];
    const n = Math.round(beatsPerBar / step);
    for (let i = 0; i < n; i++) {
      const b = start + bi * beatsPerBar + i * step;
      out.push({ b, d: step * hold, midi: tones[pattern[i % pattern.length]] + shift, v: typeof vel === 'number' ? vel : vel(b) });
    }
  });
  return out;
}

/** the motif from `start` (beats), in a mode and octave, its rhythm scaled by `aug`; `degs` swaps in a variant */
export function motif(start: number, vel: number, o: { octave?: number; mode?: number[]; aug?: number; take?: number; degs?: number[]; durs?: number[] } = {}): BeatNote[] {
  const degs = o.degs ?? MOTIF_DEG, durs = o.durs ?? MOTIF_DUR, aug = o.aug ?? 1;
  const out: BeatNote[] = [];
  let b = start;
  const n = Math.min(o.take ?? degs.length, degs.length);
  for (let i = 0; i < n; i++) {
    out.push({ b, d: durs[i] * aug, midi: deg(degs[i], o.octave ?? 0, TONIC, o.mode ?? DORIAN), v: vel });
    b += durs[i] * aug;
  }
  return out;
}

/** does a melody (in time order) state the motif's head anywhere (any transposition)? */
export function hasMotifHead(midis: number[]): boolean {
  for (let i = 0; i + MOTIF_HEAD.length < midis.length; i++) {
    let ok = true;
    for (let k = 0; k < MOTIF_HEAD.length && ok; k++) ok = midis[i + k + 1] - midis[i + k] === MOTIF_HEAD[k];
    if (ok) return true;
  }
  return false;
}

/** seconds from beats */
export function toNotes(ns: BeatNote[], bpm: number): Note[] {
  const k = 60 / bpm;
  return ns.map((n) => ({ t: n.b * k, d: n.d * k, midi: n.midi, v: n.v, pan: n.pan }));
}

/** the stems an era piece ships as (authored.ts plays them sample-locked: day/night cross-fade, tension rises over) */
export type Stem = 'main' | 'day' | 'night' | 'tension';
export const STEMS: Stem[] = ['main', 'day', 'night', 'tension'];

/** a part of a piece, written in beats; `stem` (default 'main') is the stem it renders into */
export interface ScorePart { inst: Inst; notes: BeatNote[]; gain: number; send: number; pan: number; role?: 'melody' | 'harmony' | 'rhythm' | 'colour'; stem?: Stem }

export interface Piece {
  id: string;
  bpm: number;
  beatsPerBar: number;
  bars: number;
  room: RoomOpts;
  wet: number;
  parts: ScorePart[];
}

export function loopSeconds(p: Piece): number { return p.bars * p.beatsPerBar * 60 / p.bpm; }

/** the piece's parts in seconds; with `stem`, only the parts of that stem */
export function partsOf(p: Piece, stem?: Stem): Part[] {
  return p.parts.filter((sp) => !stem || (sp.stem ?? 'main') === stem)
    .map((sp) => ({ inst: sp.inst, notes: toNotes(sp.notes, p.bpm), gain: sp.gain, send: sp.send, pan: sp.pan }));
}

/** the stems a piece has (a piece with no stem marks is one 'main' stem) */
export function stemsOf(p: Piece): Stem[] {
  return STEMS.filter((s) => p.parts.some((sp) => (sp.stem ?? 'main') === s));
}

/** a repeating rhythm: every bar from `fromBar` for `bars` bars, hits [beat, midi, velocity] scaled by `vel` */
export function pulse(fromBar: number, bars: number, beatsPerBar: number, hits: [number, number, number][], vel: number | ((b: number) => number) = 1, d = 1): BeatNote[] {
  const out: BeatNote[] = [];
  for (let i = 0; i < bars; i++) {
    const t0 = (fromBar - 1 + i) * beatsPerBar;
    for (const [b, midi, v] of hits) out.push({ b: t0 + b, d, midi, v: v * (typeof vel === 'number' ? vel : vel(t0 + b)) });
  }
  return out;
}

/** each melody part's line (time order): what the motif test reads */
export function melodiesOf(p: Piece): number[][] {
  return p.parts.filter((sp) => sp.role === 'melody').map((sp) => [...sp.notes].sort((a, b) => a.b - b.b).map((n) => n.midi));
}

/** a ramp of velocity between two beats */
export function ramp(b0: number, v0: number, b1: number, v1: number): (b: number) => number {
  return (b) => v0 + (v1 - v0) * Math.max(0, Math.min(1, (b - b0) / (b1 - b0)));
}

/** the start beat of a 1-based bar */
export function bar(n: number, beatsPerBar = 4): number { return (n - 1) * beatsPerBar; }
