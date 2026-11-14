// BLOCKTOOTH — procedural music (CONTRACT.md §13). Every note is synthesized; nothing is shared
// with any other game (FFG rule: no duplicated music across games).
//
// Tracks
//   title / select — WARD-7 news theme: D dorian, 108 bpm, ticking clock, brass stabs, timpani.
//                    `select` is the same arrangement thinned out; title ⇄ select never restarts.
//   grideast       — city-pop funk, major, 118 bpm (slap bass, e-piano, square lead, brass stabs).
//   whitestacks    — industrial minor, 96 bpm, metallic percussion (FM anvils, pipe clanks), steam.
//   lockwater      — night synthwave, phrygian, 104 bpm, rain bed, rolling bass, echoing arps.
//   boss           — 140 bpm phrygian-dominant, driving grit bass, siren lead, alarm stabs.
//   tabloid        — THE WARD SEVEN WITNESS press theme: swung mixolydian, tuba, typewriter, bell.
//
// Engine
//   * look-ahead scheduler: a 25 ms timer schedules every 16th that starts within the next 100 ms
//     (catch-up skips missed steps instead of bursting them after a throttled/hidden tab);
//   * five layers per track (bed, drums, bass, lead, top); setIntensity(x) fades layers in/out;
//   * play() crossfades (1.5 s) between tracks; stop() fades out;
//   * melodies are generated per track from a seeded PRNG (phrase form A A' B A'') over the
//     track's chord progression, so they are stable run to run;
//   * doctrine: linear ramps only, every AudioParam value finite-clamped (audio.ts helpers),
//     the scheduler tick wrapped in try/catch; safe no-op without an AudioContext / before unlock.

import type { BiomeId } from '../core/types.ts';
import type { AudioEngine, Ctx } from './audio.ts';
import {
  clampf, curveTo, envAHR, envPerc, fin, linTo, mkFM, mkFilter, mkGain, mkGrit, mkNoise, mkOsc, setAt, sweep,
} from './audio.ts';
import { BIOMES } from '../data/biomes.ts';

export type MusicTrack = 'title' | 'select' | BiomeId | 'boss' | 'tabloid';

const LOOKAHEAD_MS = 25;
const HORIZON_S = 0.1;
const XFADE_S = 1.5;
/** Track master trim: leaves the SFX ~8 dB of headroom over the band at equal slider settings. */
const TRACK_GAIN = 0.36;

// ─────────────────────────────── theory ───────────────────────────────

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygDom: [0, 1, 4, 5, 7, 8, 10],
} as const;
type Scale = readonly number[];

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
/** scale degree d (any integer, 7 = octave) → MIDI */
function dm(root: number, sc: Scale, d: number): number {
  const o = Math.floor(d / 7);
  const i = ((d % 7) + 7) % 7;
  return root + 12 * o + sc[i];
}
/** diatonic chord on degree d: n stacked thirds */
function chordOf(root: number, sc: Scale, d: number, n = 4): number[] {
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push(dm(root, sc, d + 2 * k));
  return out;
}

/** small local PRNG (cosmetic; seeded so melodies are stable) */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface MNote { d: number; len: number; }

/** Parse a 2-bar rhythm string: 'x' onset, '-' hold, '.' rest → [{i, len}] */
function parseRhythm(r: string): { i: number; len: number }[] {
  const out: { i: number; len: number }[] = [];
  for (let i = 0; i < r.length; i++) {
    if (r[i] !== 'x') continue;
    let len = 1;
    while (i + len < r.length && r[i + len] === '-') len++;
    out.push({ i, len });
  }
  return out;
}

/**
 * Melody over a progression (degrees per bar, length multiple of 8). Each 8-bar section is four
 * 2-bar phrases A A' B A'': A' repeats A's opening, B takes a contrasting rhythm, A'' cadences on
 * the chord root. Strong beats land on chord tones; weak beats move by step.
 */
function makeMelody(seed: number, prog: readonly number[], rhythms: readonly string[], lo: number, hi: number): (MNote | null)[] {
  const r = prng(seed);
  const steps = prog.length * 16;
  const out: (MNote | null)[] = new Array(steps).fill(null);
  const nearestTone = (bar: number, from: number, spread: number) => {
    const c = prog[bar];
    let best = from, bd = 1e9;
    for (let d = lo; d <= hi; d++) {
      const rel = (((d - c) % 7) + 7) % 7;
      if (rel !== 0 && rel !== 2 && rel !== 4) continue;
      const dist = Math.abs(d - from) + (r() * spread);
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  };
  for (let sec = 0; sec * 8 < prog.length; sec++) {
    const ia = Math.floor(r() * rhythms.length);
    let ib = Math.floor(r() * rhythms.length);
    if (rhythms.length > 1 && ib === ia) ib = (ia + 1) % rhythms.length;
    const roles = [rhythms[ia], rhythms[ia], rhythms[ib], rhythms[ia]];
    let prev = Math.round((lo + hi) / 2);
    let motif: number[] = [];
    for (let ph = 0; ph < 4; ph++) {
      const on = parseRhythm(roles[ph]);
      const bar0 = sec * 8 + ph * 2;
      const cur: number[] = [];
      for (let k = 0; k < on.length; k++) {
        const bar = Math.min(prog.length - 1, bar0 + (on[k].i >= 16 ? 1 : 0));
        let d: number;
        const last = k === on.length - 1;
        if (ph === 3 && last) {
          // cadence: land on the chord root nearest the previous note
          const c = prog[bar];
          d = c; while (d + 7 <= hi && Math.abs(d + 7 - prev) < Math.abs(d - prev)) d += 7;
          while (d - 7 >= lo && Math.abs(d - 7 - prev) < Math.abs(d - prev)) d -= 7;
        } else if ((ph === 1 || ph === 3) && k < Math.ceil(motif.length / 2) && k < motif.length) {
          d = motif[k];
          if (on[k].i % 4 === 0) d = nearestTone(bar, d, 0.5);
        } else if (on[k].i % 4 === 0 || on[k].len >= 3) {
          d = nearestTone(bar, prev + (r() < 0.5 ? -1 : 1) * Math.floor(r() * 3), 1.5);
        } else {
          const dir = prev > hi - 2 ? -1 : prev < lo + 2 ? 1 : (r() < 0.5 ? -1 : 1);
          d = prev + dir * (r() < 0.8 ? 1 : 2);
        }
        d = Math.max(lo, Math.min(hi, d));
        out[bar0 * 16 + on[k].i] = { d, len: on[k].len };
        cur.push(d);
        prev = d;
      }
      if (ph === 0) motif = cur;
    }
  }
  return out;
}

// ─────────────────────────────── player (one running track) ───────────────────────────────

interface Song {
  id: string;
  bpm: number;
  swing: number;           // 0..0.5 of a 16th, applied to odd 16ths
  wet: number;             // reverb send
  echoSends: readonly number[];   // per layer → dotted-8th echo
  levels: readonly number[];      // per layer trim
  /** whole-track loudness trim on top of TRACK_GAIN (tracks are matched in busy play, PC-11) */
  gain?: number;
  start?(p: Player, t: number): void;
  step(p: Player, s: number, t: number): void;
}

class Player {
  readonly ac: Ctx;
  readonly song: Song;
  track: MusicTrack;
  readonly out: GainNode;
  readonly L: GainNode[] = [];
  readonly spb16: number;
  step = 0;
  nextT: number;
  fading = false;
  endT = Infinity;
  readonly beds: AudioScheduledSourceNode[] = [];
  /** layer gain targets last scheduled (so per-frame setIntensity calls don't churn automation) */
  readonly targets: number[] = [-1, -1, -1, -1, -1];
  private nodes: AudioNode[] = [];

  constructor(ac: Ctx, bus: AudioNode, verb: AudioNode | null, song: Song, track: MusicTrack, t0: number) {
    this.ac = ac; this.song = song; this.track = track;
    this.spb16 = 60 / song.bpm / 4;
    this.nextT = t0;
    this.out = mkGain(ac, 0);
    this.out.connect(bus);
    this.nodes.push(this.out);
    // dotted-8th echo, darkened in the loop
    const echoIn = mkGain(ac, 1);
    const dl = ac.createDelay(2);
    dl.delayTime.value = clampf(this.spb16 * 3, 0.05, 1.9);
    const fb = mkGain(ac, 0.34);
    const lp = mkFilter(ac, 'lowpass', 2600, 0.6);
    const echoOut = mkGain(ac, 0.55);
    echoIn.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(echoOut); echoOut.connect(this.out);
    this.nodes.push(echoIn, dl, fb, lp, echoOut);
    for (let i = 0; i < 5; i++) {
      const g = mkGain(ac, 0);
      const trim = mkGain(ac, song.levels[i] ?? 1);
      g.connect(trim); trim.connect(this.out);
      const es = song.echoSends[i] ?? 0;
      if (es > 0) { const e = mkGain(ac, es); trim.connect(e); e.connect(echoIn); this.nodes.push(e); }
      this.L.push(g);
      this.nodes.push(g, trim);
    }
    if (verb && song.wet > 0) {
      const w = mkGain(ac, song.wet);
      this.out.connect(w); w.connect(verb);
      this.nodes.push(w);
    }
  }

  dispose(): void {
    for (const s of this.beds) { try { s.stop(); } catch { /* ignore */ } }
    for (const n of this.nodes) { try { n.disconnect(); } catch { /* ignore */ } }
    this.beds.length = 0;
  }
}

// ─────────────────────────────── instruments ───────────────────────────────
// Every instrument: (p, dst, t, …, vel). They build per-note graphs whose sources stop on their own.

function out(p: Player, dst: AudioNode, t: number, amp: number, att: number, dec: number, shape = 4): GainNode {
  const g = mkGain(p.ac, 0);
  envPerc(g.gain, t, amp, att, dec, shape);
  g.connect(dst);
  return g;
}
function outAHR(p: Player, dst: AudioNode, t: number, amp: number, att: number, hold: number, rel: number): GainNode {
  const g = mkGain(p.ac, 0);
  envAHR(g.gain, t, amp, att, hold, rel, 3);
  g.connect(dst);
  return g;
}

function kick(p: Player, dst: AudioNode, t: number, vel: number, punch = 1): void {
  const o = mkOsc(p.ac, 'sine', 150, t, t + 0.4);
  sweep(o.frequency, t, 160 * punch, 46, 0.09);
  o.connect(out(p, dst, t, 0.95 * vel, 0.002, 0.34, 3.5));
  const n = mkNoise(p.ac, 'white', t, t + 0.02);
  const hp = mkFilter(p.ac, 'highpass', 2500);
  n.connect(hp); hp.connect(out(p, dst, t, 0.25 * vel, 0.001, 0.008));
}

function snare(p: Player, dst: AudioNode, t: number, vel: number, tone = 190, tail = 0.16): void {
  const o = mkOsc(p.ac, 'triangle', tone, t, t + 0.15);
  sweep(o.frequency, t, tone * 1.2, tone, 0.05);
  o.connect(out(p, dst, t, 0.45 * vel, 0.001, 0.09));
  const n = mkNoise(p.ac, 'white', t, t + tail + 0.03);
  const bp = mkFilter(p.ac, 'bandpass', 1900, 0.7);
  n.connect(bp); bp.connect(out(p, dst, t, 0.6 * vel, 0.001, tail, 3.5));
}

function clap(p: Player, dst: AudioNode, t: number, vel: number): void {
  const n = mkNoise(p.ac, 'white', t, t + 0.2);
  const bp = mkFilter(p.ac, 'bandpass', 1250, 1.1);
  const g = mkGain(p.ac, 0);
  setAt(g.gain, 0, t);
  for (const dt of [0, 0.011, 0.022]) { linTo(g.gain, 0, t + dt); linTo(g.gain, 0.7 * vel, t + dt + 0.001); linTo(g.gain, 0.1 * vel, t + dt + 0.009); }
  linTo(g.gain, 0.35 * vel, t + 0.032); linTo(g.gain, 0, t + 0.16);
  n.connect(bp); bp.connect(g); g.connect(dst);
}

function hat(p: Player, dst: AudioNode, t: number, vel: number, open = false): void {
  const dec = open ? 0.24 : 0.035;
  const n = mkNoise(p.ac, 'white', t, t + dec + 0.03);
  const hp = mkFilter(p.ac, 'highpass', 7200, 0.8);
  n.connect(hp); hp.connect(out(p, dst, t, (open ? 0.22 : 0.2) * vel, 0.001, dec, 3));
}

function tick(p: Player, dst: AudioNode, t: number, vel: number): void {
  const o = mkOsc(p.ac, 'square', 2600, t, t + 0.03);
  const bp = mkFilter(p.ac, 'bandpass', 3200, 4);
  o.connect(bp); bp.connect(out(p, dst, t, 0.18 * vel, 0.0005, 0.018));
}

/** FM metal: anvils, pipes, clanks (WHITE STACKS percussion). */
function metal(p: Player, dst: AudioNode, t: number, f: number, ratio: number, index: number, dur: number, vel: number): void {
  const fm = mkFM(p.ac, f, ratio, index, t, t + dur + 0.03);
  const d0 = index * f * ratio;
  setAt(fm.depth.gain, d0, t); linTo(fm.depth.gain, d0 * 0.15, t + dur * 0.6);
  fm.car.connect(out(p, dst, t, 0.4 * vel, 0.001, dur, 4.5));
}

function tom(p: Player, dst: AudioNode, t: number, f: number, vel: number): void {
  const o = mkOsc(p.ac, 'sine', f * 1.6, t, t + 0.4);
  sweep(o.frequency, t, f * 1.6, f, 0.12);
  o.connect(out(p, dst, t, 0.7 * vel, 0.002, 0.32, 3));
  const n = mkNoise(p.ac, 'pink', t, t + 0.08);
  const lp = mkFilter(p.ac, 'lowpass', 1400);
  n.connect(lp); lp.connect(out(p, dst, t, 0.2 * vel, 0.001, 0.05));
}

function timpani(p: Player, dst: AudioNode, t: number, midi: number, vel: number, dur = 1.1): void {
  const f = mtof(midi);
  for (const [type, mul, a] of [['triangle', 1, 0.6], ['sine', 1.5, 0.25]] as const) {
    const o = mkOsc(p.ac, type, f * mul * 1.03, t, t + dur + 0.05);
    sweep(o.frequency, t, f * mul * 1.03, f * mul, 0.15);
    o.connect(out(p, dst, t, a * vel, 0.004, dur, 3.2));
  }
  const n = mkNoise(p.ac, 'brown', t, t + 0.2);
  const lp = mkFilter(p.ac, 'lowpass', 700);
  n.connect(lp); lp.connect(out(p, dst, t, 0.35 * vel, 0.002, 0.15));
}

function typewriter(p: Player, dst: AudioNode, t: number, vel: number): void {
  const n = mkNoise(p.ac, 'white', t, t + 0.02);
  const bp = mkFilter(p.ac, 'bandpass', 3600, 2);
  n.connect(bp); bp.connect(out(p, dst, t, 0.45 * vel, 0.0005, 0.012));
  const o = mkOsc(p.ac, 'sine', 420, t, t + 0.04);
  o.connect(out(p, dst, t, 0.3 * vel, 0.001, 0.025));
}

/** Slap bass: saw+square, snappy filter envelope, a thumb "pop" transient. */
function bassSlap(p: Player, dst: AudioNode, t: number, midi: number, dur: number, vel: number): void {
  const f = mtof(midi);
  const lp = mkFilter(p.ac, 'lowpass', 300, 3);
  curveTo(lp.frequency, t, [[0, 3200], [0.06, 600], [Math.max(0.07, dur), 280]]);
  const g = outAHR(p, dst, t, 0.55 * vel, 0.003, dur * 0.5, dur * 0.5 + 0.05);
  for (const [type, det, a] of [['sawtooth', -5, 0.5], ['square', 5, 0.35]] as const) {
    const o = mkOsc(p.ac, type, f, t, t + dur + 0.1, det); const og = mkGain(p.ac, a);
    o.connect(og); og.connect(lp);
  }
  lp.connect(g);
  const n = mkNoise(p.ac, 'white', t, t + 0.015);
  const bp = mkFilter(p.ac, 'bandpass', 1800, 1.5);
  n.connect(bp); bp.connect(out(p, dst, t, 0.12 * vel, 0.0005, 0.01));
}

/** Gritty industrial bass. */
function bassGrit(p: Player, dst: AudioNode, t: number, midi: number, dur: number, vel: number): void {
  const o = mkOsc(p.ac, 'square', mtof(midi), t, t + dur + 0.1);
  const sub = mkOsc(p.ac, 'sine', mtof(midi - 12), t, t + dur + 0.1);
  const lp = mkFilter(p.ac, 'lowpass', 650, 1.5);
  curveTo(lp.frequency, t, [[0, 1400], [0.1, 520]]);
  const grit = mkGrit(p.ac, 0.5);
  const g = outAHR(p, dst, t, 0.4 * vel, 0.005, dur * 0.6, dur * 0.4 + 0.04);
  o.connect(grit); grit.connect(lp); lp.connect(g);
  const sg = mkGain(p.ac, 0.6); sub.connect(sg); sg.connect(g);
}

/** Warm synthwave sub bass: detuned saws + a sine sub, soft filter blip. */
function bassSub(p: Player, dst: AudioNode, t: number, midi: number, dur: number, vel: number): void {
  const lp = mkFilter(p.ac, 'lowpass', 400, 2);
  curveTo(lp.frequency, t, [[0, 380], [0.03, 1100], [0.2, 420]]);
  const g = outAHR(p, dst, t, 0.42 * vel, 0.004, dur * 0.55, dur * 0.45 + 0.03);
  for (const det of [-7, 7]) { const o = mkOsc(p.ac, 'sawtooth', mtof(midi), t, t + dur + 0.08, det); const og = mkGain(p.ac, 0.35); o.connect(og); og.connect(lp); }
  const s = mkOsc(p.ac, 'sine', mtof(midi - 12), t, t + dur + 0.08); const sg = mkGain(p.ac, 0.55); s.connect(sg); sg.connect(g);
  lp.connect(g);
}

/** Boss drive bass: saw + octave saw through grit. */
function bassDrive(p: Player, dst: AudioNode, t: number, midi: number, dur: number, vel: number): void {
  const lp = mkFilter(p.ac, 'lowpass', 1000, 2.5);
  curveTo(lp.frequency, t, [[0, 2200], [0.05, 800]]);
  const grit = mkGrit(p.ac, 0.35);
  const g = outAHR(p, dst, t, 0.38 * vel, 0.003, dur * 0.5, dur * 0.5 + 0.03);
  for (const [m, det] of [[0, 0], [12, 9]] as const) { const o = mkOsc(p.ac, 'sawtooth', mtof(midi + m), t, t + dur + 0.08, det); const og = mkGain(p.ac, 0.4); o.connect(og); og.connect(grit); }
  grit.connect(lp); lp.connect(g);
}

/** Tuba (tabloid oom-pah). */
function tuba(p: Player, dst: AudioNode, t: number, midi: number, dur: number, vel: number): void {
  const o = mkOsc(p.ac, 'square', mtof(midi), t, t + dur + 0.1);
  const s = mkOsc(p.ac, 'sine', mtof(midi), t, t + dur + 0.1);
  const lp = mkFilter(p.ac, 'lowpass', 520, 1);
  curveTo(lp.frequency, t, [[0, 300], [0.05, 700], [0.2, 480]]);
  const g = outAHR(p, dst, t, 0.45 * vel, 0.025, dur * 0.5, dur * 0.4 + 0.05);
  const og = mkGain(p.ac, 0.4); o.connect(og); og.connect(lp); lp.connect(g);
  const sg = mkGain(p.ac, 0.5); s.connect(sg); sg.connect(g);
}

/** Pad chord: detuned saws or triangles through a lowpass, slow swell. */
function pad(p: Player, dst: AudioNode, t: number, notes: readonly number[], dur: number, vel: number, bright = 1000, type: OscillatorType = 'sawtooth'): void {
  const lp = mkFilter(p.ac, 'lowpass', bright, 0.8);
  const g = outAHR(p, dst, t, 0.3 * vel, Math.min(0.5, dur * 0.25), dur * 0.5, dur * 0.35);
  lp.connect(g);
  const per = 1 / (notes.length * 2);
  for (const m of notes) for (const det of [-9, 9]) {
    const o = mkOsc(p.ac, type, mtof(m), t, t + dur + 0.05, det);
    const og = mkGain(p.ac, per); o.connect(og); og.connect(lp);
  }
}

/** FM e-piano chord (city-pop comping). */
function ep(p: Player, dst: AudioNode, t: number, notes: readonly number[], dur: number, vel: number): void {
  const g = outAHR(p, dst, t, 0.32 * vel, 0.003, dur * 0.3, dur * 0.7 + 0.1);
  const per = 1 / notes.length;
  for (const m of notes) {
    const f = mtof(m);
    const fm = mkFM(p.ac, f, 1, 1.6, t, t + dur + 0.15);
    const d0 = 1.6 * f;
    setAt(fm.depth.gain, d0, t); linTo(fm.depth.gain, d0 * 0.2, t + 0.25);
    const og = mkGain(p.ac, per); fm.car.connect(og); og.connect(g);
  }
}

/** Synth brass stab / chord. */
function brass(p: Player, dst: AudioNode, t: number, notes: readonly number[], dur: number, vel: number, bright = 1): void {
  const lp = mkFilter(p.ac, 'lowpass', 300, 2);
  curveTo(lp.frequency, t, [[0, 300], [0.04, 600 + 3000 * bright], [0.2, 900 + 1300 * bright], [Math.max(0.21, dur), 500]]);
  const g = outAHR(p, dst, t, 0.4 * vel, 0.015, dur * 0.55, dur * 0.45 + 0.04);
  lp.connect(g);
  const per = 1 / (notes.length * 2);
  for (const m of notes) for (const det of [-8, 8]) {
    const o = mkOsc(p.ac, 'sawtooth', mtof(m), t, t + dur + 0.1, det);
    curveTo(o.detune, t, [[0, det - 35], [0.045, det]]);
    const og = mkGain(p.ac, per); o.connect(og); og.connect(lp);
  }
}

type LeadKind = 'square' | 'saw' | 'siren' | 'whistle' | 'brass' | 'cold';

/** Monophonic lead with delayed vibrato. */
function lead(p: Player, dst: AudioNode, t: number, midi: number, dur: number, vel: number, kind: LeadKind, glideFrom = 0): void {
  const f = mtof(midi);
  const end = t + dur + 0.25;
  const type: OscillatorType = kind === 'square' ? 'square' : kind === 'whistle' || kind === 'cold' ? 'triangle' : 'sawtooth';
  const o = mkOsc(p.ac, type, f, t, end);
  const o2 = kind === 'saw' || kind === 'siren' || kind === 'brass' ? mkOsc(p.ac, 'sawtooth', f, t, end, 11) : null;
  if (glideFrom > 0) {
    curveTo(o.frequency, t, [[0, mtof(glideFrom)], [Math.min(0.12, dur * 0.4), f]]);
    if (o2) curveTo(o2.frequency, t, [[0, mtof(glideFrom)], [Math.min(0.12, dur * 0.4), f]]);
  }
  const vib = mkOsc(p.ac, 'sine', kind === 'whistle' ? 6.2 : 5.3, t, end);
  const vd = mkGain(p.ac, 0);
  setAt(vd.gain, 0, t); linTo(vd.gain, 0, t + Math.min(0.2, dur * 0.4)); linTo(vd.gain, f * (kind === 'whistle' ? 0.012 : 0.008), t + Math.min(0.45, dur * 0.8));
  vib.connect(vd); vd.connect(o.frequency); if (o2) vd.connect(o2.frequency);
  const cut = kind === 'square' ? 2400 : kind === 'saw' ? 2000 : kind === 'siren' ? 2600 : kind === 'brass' ? 1800 : kind === 'cold' ? 1500 : 5000;
  const lp = mkFilter(p.ac, 'lowpass', cut, kind === 'brass' ? 2 : 0.9);
  if (kind === 'brass') curveTo(lp.frequency, t, [[0, 500], [0.05, 2600], [0.25, 1500]]);
  const amp = (kind === 'whistle' ? 0.32 : kind === 'cold' ? 0.3 : 0.2) * vel;
  const g = outAHR(p, dst, t, amp, kind === 'brass' ? 0.03 : 0.012, Math.max(0.02, dur * 0.7), dur * 0.3 + 0.12);
  o.connect(lp); if (o2) { const g2 = mkGain(p.ac, 0.7); o2.connect(g2); g2.connect(lp); }
  lp.connect(g);
}

/** Saw pluck (arpeggio). */
function pluck(p: Player, dst: AudioNode, t: number, midi: number, vel: number, cut = 2400, dec = 0.2): void {
  const o = mkOsc(p.ac, 'sawtooth', mtof(midi), t, t + dec + 0.05);
  const lp = mkFilter(p.ac, 'lowpass', cut, 3);
  curveTo(lp.frequency, t, [[0, cut], [dec * 0.6, cut * 0.25]]);
  o.connect(lp); lp.connect(out(p, dst, t, 0.2 * vel, 0.002, dec, 3.5));
}

function bell(p: Player, dst: AudioNode, t: number, midi: number, vel: number, dur = 1.2, ratio = 3.5): void {
  const f = mtof(midi);
  const fm = mkFM(p.ac, f, ratio, 1.3, t, t + dur + 0.05);
  const d0 = 1.3 * f * ratio;
  setAt(fm.depth.gain, d0, t); linTo(fm.depth.gain, d0 * 0.25, t + dur * 0.5);
  fm.car.connect(out(p, dst, t, 0.28 * vel, 0.002, dur, 4.5));
}

/** Honky ragtime piano chord: two slightly detuned FM voices per note. */
function piano(p: Player, dst: AudioNode, t: number, notes: readonly number[], dur: number, vel: number): void {
  const g = out(p, dst, t, 0.26 * vel, 0.002, dur, 3.2);
  const per = 1 / (notes.length * 2);
  for (const m of notes) for (const det of [-0.004, 0.004]) {
    const f = mtof(m) * (1 + det);
    const fm = mkFM(p.ac, f, 2, 1.1, t, t + dur + 0.05);
    const d0 = 2.2 * f;
    setAt(fm.depth.gain, d0, t); linTo(fm.depth.gain, d0 * 0.15, t + 0.2);
    const og = mkGain(p.ac, per); fm.car.connect(og); og.connect(g);
  }
}

function hiss(p: Player, dst: AudioNode, t: number, dur: number, vel: number): void {
  const n = mkNoise(p.ac, 'white', t, t + dur + 0.05);
  const hp = mkFilter(p.ac, 'highpass', 3000, 0.7);
  sweep(hp.frequency, t, 5000, 2200, dur);
  n.connect(hp); hp.connect(outAHR(p, dst, t, 0.12 * vel, dur * 0.3, dur * 0.2, dur * 0.5));
}

// ─────────────────────────────── the songs ───────────────────────────────

const lvl = (s: string, i: number) => { const c = s[i]; return c === 'X' ? 1 : c === 'x' ? 0.78 : c === 'g' ? 0.35 : 0; };
const hum = (v: number) => v * (0.92 + Math.random() * 0.16);

function biomeMusic(id: BiomeId, fb: { bpm: number; root: number }): { bpm: number; root: number } {
  try {
    const m = BIOMES[id]?.music;
    if (m && Number.isFinite(m.bpm) && m.bpm > 40 && Number.isFinite(m.root)) return { bpm: m.bpm, root: m.root };
  } catch { /* data not available: fall back */ }
  return fb;
}

/** GRID-EAST — city-pop funk, major, 118 bpm. */
function songGridEast(): Song {
  const { bpm, root } = biomeMusic('grideast', { bpm: 118, root: 51 });
  const sc = SCALES.major;
  const prog = [3, 2, 5, 4, 3, 2, 1, 4, 0, 5, 3, 4, 0, 5, 1, 4];
  const mel = makeMelody(0x6e1d, prog, [
    'x-.x-.x.x---.x.xx-.x-.x.x-------',
    '..x.x.x-x.x.x---..x.x.x-x-x-x---',
    'x.x-..x.x-..x.x-x---x.x-x-------',
  ], 7, 16);
  const K = 'x.....x...x..x..', S = '....x.......x...', Hh = 'xgxgxgxgxgxgxgxg';
  const bass: ([number, number] | null)[] = [[0, 2], null, [7, 1], null, null, [0, 1], null, [6, 1], [0, 2], null, null, [4, 1], [7, 1], null, [6, 1], [4, 1]];
  const comp = [3, 6, 11, 14];
  return {
    id: 'grideast', bpm, swing: 0.1, wet: 0.16, echoSends: [0, 0, 0, 0.35, 0.2], levels: [1, 1, 1, 1, 1],
    step(p, s, t) {
      const L = p.L, bar = Math.floor(s / 16) % prog.length, i = s % 16, c = prog[bar];
      const bl = p.spb16 * 16;
      if (i === 0) {
        pad(p, L[0], t, chordOf(root + 12, sc, c), bl, 0.5, 1300, 'triangle');
        ep(p, L[0], t, chordOf(root + 12, sc, c), bl * 0.45, 0.55);
      }
      const fill = bar % 4 === 3 && i >= 12;
      if (lvl(K, i)) kick(p, L[1], t, hum(lvl(K, i)));
      if (lvl(S, i)) { snare(p, L[1], t, 0.8); clap(p, L[1], t, 0.45); }
      if (fill && i % 2 === 1) snare(p, L[1], t, 0.35, 220);
      if (lvl(Hh, i)) hat(p, L[1], t, hum(lvl(Hh, i)));
      const bn = bass[i];
      if (bn) bassSlap(p, L[2], t, dm(root - 12, sc, c + bn[0]), p.spb16 * bn[1] * 0.9, hum(0.9));
      const n = mel[(s % (prog.length * 16))];
      if (n) lead(p, L[3], t, dm(root + 12, sc, n.d), p.spb16 * n.len * 0.95, hum(0.9), 'square');
      if (comp.includes(i)) ep(p, L[4], t, chordOf(root + 12, sc, c), p.spb16 * 1.2, hum(0.5));
      if (i === 10 && bar % 2 === 1) hat(p, L[4], t, 0.8, true);
      if (bar % 2 === 1 && (i === 14 || i === 15)) brass(p, L[4], t, chordOf(root + 12, sc, prog[(bar + 1) % prog.length], 3), p.spb16 * 0.8, 0.8);
      if (bar % 4 === 0 && i === 0 && s > 0) brass(p, L[4], t, chordOf(root + 12, sc, c, 3), p.spb16 * 2, 0.9);
    },
  };
}

/** WHITE STACKS — industrial minor, 96 bpm, metallic percussion, steam. */
function songWhiteStacks(): Song {
  const { bpm, root } = biomeMusic('whitestacks', { bpm: 96, root: 45 });
  const sc = SCALES.minor;
  const prog = [0, 0, 5, 6, 0, 0, 3, 4, 5, 3, 0, 6, 5, 3, 4, 4];
  const mel = makeMelody(0x5a7c, prog, [
    'x---x---x-------x---x-.x--------',
    'x-----x-x---x---x-------x-------',
    '....x---x---x-x-x---------------',
  ], 3, 11);
  const K = 'X.......x.x.....', S = '....X.......X...';
  const M = 'x.gxx.gxx.gxx.gx';     // metallic 16ths
  return {
    id: 'whitestacks', bpm, swing: 0, wet: 0.3, echoSends: [0, 0.08, 0, 0.3, 0.25], levels: [0.9, 0.85, 0.85, 1, 0.9],
    start(p, t) {
      // steam-room air: a quiet filtered-noise bed that never stops
      const n = mkNoise(p.ac, 'pink', t, t + 86400);
      const bp = mkFilter(p.ac, 'bandpass', 900, 0.4);
      const g = mkGain(p.ac, 0); setAt(g.gain, 0, t); linTo(g.gain, 0.05, t + 2);
      n.connect(bp); bp.connect(g); g.connect(p.L[0]);
      p.beds.push(n);
    },
    step(p, s, t) {
      const L = p.L, bar = Math.floor(s / 16) % prog.length, i = s % 16, c = prog[bar];
      const bl = p.spb16 * 16;
      if (i === 0) pad(p, L[0], t, chordOf(root + 12, sc, c, 3), bl, 0.55, 700, 'triangle');
      if (i === 0 && bar % 4 === 0) hiss(p, L[0], t + p.spb16 * 2, bl * 0.5, 0.8);
      if (i === 8 && bar % 2 === 1) metal(p, L[0], t, mtof(root + 36), 2.76, 1.5, 1.4, 0.35);   // distant anvil ring
      if (lvl(K, i)) kick(p, L[1], t, hum(lvl(K, i)), 0.9);
      if (lvl(S, i)) { snare(p, L[1], t, 0.85, 170, 0.22); metal(p, L[1], t, 330, 1.41, 3, 0.25, 0.4); }
      if (lvl(M, i)) metal(p, L[1], t, 1400, 1.73, 2.2, 0.05, hum(lvl(M, i) * 0.45));
      if (i % 2 === 0) {
        const oct = (i === 6 || i === 14) ? 12 : 0;
        bassGrit(p, L[2], t, dm(root - 12, sc, c) + oct, p.spb16 * 1.7, hum(0.85));
      }
      const n = mel[s % (prog.length * 16)];
      if (n) lead(p, L[3], t, dm(root + 12, sc, n.d), p.spb16 * n.len * 0.95, hum(0.85), 'cold');
      if (i === 3 || i === 11) metal(p, L[4], t, 190, 2.76, 5, 0.5, 0.55);                     // anvil
      if (i === 7 || i === 13) metal(p, L[4], t, 520, 1.41, 3.5, 0.18, 0.4);                   // pipe clank
      if (i === 15 && bar % 4 === 3) { for (let k = 0; k < 4; k++) metal(p, L[4], t + k * p.spb16 * 0.25, 900 - k * 120, 1.73, 3, 0.06, 0.35); }
    },
  };
}

/** LOCKWATER — night synthwave, phrygian, 104 bpm, rain bed. */
function songLockwater(): Song {
  const { bpm, root } = biomeMusic('lockwater', { bpm: 104, root: 50 });
  const sc = SCALES.phrygian;
  const prog = [0, 1, 0, 6, 0, 1, 5, 6, 5, 6, 1, 0, 5, 6, 1, 1];
  const mel = makeMelody(0x10c3, prog, [
    'x-------x---x---x-----------....',
    '....x---x---x-------x---x-------',
    'x---x---x-x-x-------x-----------',
  ], 4, 12);
  const K = 'x...x...x...x...', S = '....x.......x...', Hh = '..x...x...x...x.';
  const arpShape = [0, 2, 4, 7, 4, 2, 0, 2];
  return {
    id: 'lockwater', bpm, swing: 0, wet: 0.34, echoSends: [0, 0, 0, 0.45, 0.4], levels: [1, 1, 1, 1, 1],
    // sparse night synthwave measured ~2 dB under GRID-EAST / WHITE STACKS in busy Size III play
    // (music energy RMS 0.045 vs 0.056–0.059 at the same SFX load): lifted to match
    gain: 1.25,
    start(p, t) {
      // rain bed: pink noise through a wide band, slowly breathing
      const n = mkNoise(p.ac, 'pink', t, t + 86400);
      const bp = mkFilter(p.ac, 'bandpass', 2600, 0.45);
      const lp = mkFilter(p.ac, 'lowpass', 7000, 0.5);
      const g = mkGain(p.ac, 0); setAt(g.gain, 0, t); linTo(g.gain, 0.16, t + 1.5);
      n.connect(bp); bp.connect(lp); lp.connect(g); g.connect(p.L[0]);
      p.beds.push(n);
    },
    step(p, s, t) {
      const L = p.L, bar = Math.floor(s / 16) % prog.length, i = s % 16, c = prog[bar];
      const bl = p.spb16 * 16;
      if (i === 0) pad(p, L[0], t, chordOf(root, sc, c), bl * 1.02, 0.6, 900);
      if (Math.random() < 0.18) {   // droplets on the flooded street
        const o = mkOsc(p.ac, 'sine', 1500 + Math.random() * 2500, t, t + 0.06);
        o.connect(out(p, L[0], t, 0.05, 0.001, 0.04));
      }
      if (lvl(K, i)) kick(p, L[1], t, 0.85);
      if (lvl(S, i)) { snare(p, L[1], t, 0.8, 180, 0.3); clap(p, L[1], t, 0.35); }
      if (lvl(Hh, i)) hat(p, L[1], t, hum(0.6));
      if (i % 2 === 0 || i % 4 === 3) bassSub(p, L[2], t, dm(root - 12, sc, c) + (i % 8 === 6 ? 12 : 0), p.spb16 * 0.9, hum(0.75));
      const n = mel[s % (prog.length * 16)];
      if (n) lead(p, L[3], t, dm(root + 12, sc, n.d), p.spb16 * n.len * 0.95, hum(0.85), 'saw');
      pluck(p, L[4], t, dm(root + 12, sc, c + arpShape[i % 8]), hum(0.7), 2600, 0.16);
      if (i === 0 && bar % 4 === 2) bell(p, L[4], t, dm(root + 24, sc, c + 4), 0.6, 1.6);
    },
  };
}

/** BOSS — 140 bpm, phrygian dominant, grit bass, siren lead, alarm stabs. */
function songBoss(): Song {
  const root = 43;
  const sc = SCALES.phrygDom;
  const prog = [0, 0, 1, 0, 0, 0, 5, 6, 3, 3, 1, 1, 5, 5, 6, 1];
  const mel = makeMelody(0xb055, prog, [
    'x-------x-------x---x---x-------',
    'x---x---x-------x-------x---x---',
  ], 5, 12);
  const K = 'X..x..x.x..x..x.', S = '....X.......X...', Hh = 'xxxxxxxxxxxxxxxx';
  return {
    id: 'boss', bpm: 140, swing: 0, wet: 0.24, echoSends: [0, 0, 0, 0.3, 0.15], levels: [1, 0.85, 0.85, 0.95, 0.9],
    step(p, s, t) {
      const L = p.L, bar = Math.floor(s / 16) % prog.length, i = s % 16, c = prog[bar];
      const bl = p.spb16 * 16;
      if (i === 0) {
        pad(p, L[0], t, chordOf(root, sc, c, 3), bl, 0.6, 650);
        if (bar % 2 === 0) timpani(p, L[0], t, dm(root - 12, sc, c) + 12, 0.8);
      }
      if (lvl(K, i)) kick(p, L[1], t, hum(lvl(K, i)), 1.1);
      if (lvl(S, i)) { snare(p, L[1], t, 0.95, 200, 0.2); clap(p, L[1], t, 0.4); }
      if (lvl(Hh, i)) hat(p, L[1], t, i % 4 === 2 ? 0.7 : 0.35, i % 8 === 6);
      bassDrive(p, L[2], t, dm(root - 12, sc, c) + (i % 4 === 3 ? 12 : 0), p.spb16 * 0.85, i % 4 === 0 ? 1 : 0.75);
      const n = mel[s % (prog.length * 16)];
      if (n) {
        const prevIdx = s - 1;
        lead(p, L[3], t, dm(root + 12, sc, n.d), p.spb16 * n.len * 0.97, 0.9, 'siren', prevIdx >= 0 ? dm(root + 12, sc, n.d) - 2 : 0);
      }
      if ((i === 0 || i === 6) && bar % 2 === 1) brass(p, L[4], t, chordOf(root + 12, sc, c, 3), p.spb16 * 1.5, 0.85, 1.2);
      if (bar % 4 === 3 && i >= 12) tom(p, L[4], t, [180, 150, 120, 95][i - 12], 0.8);
      if (bar % 8 === 7 && i === 0) { for (let k = 0; k < 4; k++) lead(p, L[4], t + k * p.spb16 * 2, k % 2 ? 76 : 79, p.spb16 * 1.6, 0.5, 'square'); }
    },
  };
}

/** WARD-7 news theme (title / select): D dorian, 108 bpm, ticking clock, brass stabs, timpani. */
function songNews(): Song {
  const root = 50;
  const sc = SCALES.dorian;
  const prog = [0, 0, 3, 3, 0, 0, 6, 4, 3, 4, 0, 0, 3, 4, 6, 6];
  const mel = makeMelody(0x7e57, prog, [
    'x-.xx-.x--------x-.xx-.xx-------',
    'x---x.x.x-------x---x.x.x-x-----',
  ], 4, 12);
  const K = 'X.......x.....x.', S = '....x.......x...';
  const stab = [0, 3, 6, 10];
  return {
    id: 'news', bpm: 108, swing: 0, wet: 0.22, echoSends: [0, 0, 0, 0.25, 0.15], levels: [1, 1, 1, 1, 1],
    step(p, s, t) {
      const L = p.L, bar = Math.floor(s / 16) % prog.length, i = s % 16, c = prog[bar];
      const bl = p.spb16 * 16;
      if (i === 0) pad(p, L[0], t, chordOf(root, sc, c, 3), bl, 0.5, 1100);
      tick(p, L[0], t, i % 4 === 0 ? 0.9 : 0.45);                                            // the newsroom clock
      if (i === 0 && bar % 4 === 0) timpani(p, L[1], t, root - 12, 0.9);
      if (lvl(K, i)) kick(p, L[1], t, hum(lvl(K, i)));
      if (lvl(S, i)) snare(p, L[1], t, 0.7, 210, 0.12);
      if (i % 2 === 0) hat(p, L[1], t, 0.35);
      if (i % 2 === 0) bassSub(p, L[2], t, dm(root - 12, sc, c) + (i % 8 === 4 ? 12 : 0), p.spb16 * 0.8, 0.8);
      const n = mel[s % (prog.length * 16)];
      if (n) lead(p, L[3], t, dm(root + 12, sc, n.d), p.spb16 * n.len * 0.95, 0.95, 'brass');
      if (stab.includes(i) && bar % 2 === 0) brass(p, L[4], t, chordOf(root + 12, sc, c, 3), p.spb16 * 0.9, 0.85, 1.1);
      if (i === 12 && bar % 2 === 1) bell(p, L[4], t, dm(root + 24, sc, c + 4), 0.7);
      if (bar % 8 === 7 && i >= 8) timpani(p, L[4], t, root - 12 + (i % 2 ? 7 : 0), 0.35 + (i - 8) * 0.06, 0.4);
    },
  };
}

/** THE WARD SEVEN WITNESS press theme (run-end tabloid): swung C mixolydian, 92 bpm. */
function songTabloid(): Song {
  const root = 48;
  const sc = SCALES.mixolydian;
  const prog = [0, 0, 3, 3, 0, 6, 4, 0, 3, 3, 0, 0, 1, 4, 0, 0];
  const mel = makeMelody(0x7ab1, prog, [
    'x.x.x-x.x---x.x.x.x.x-x.x-------',
    '..x.x.x.x-x.x---x.x.x-x-x-------',
  ], 4, 13);
  return {
    id: 'tabloid', bpm: 92, swing: 0.22, wet: 0.18, echoSends: [0, 0, 0, 0.15, 0], levels: [1, 1, 1, 1, 1],
    step(p, s, t) {
      const L = p.L, bar = Math.floor(s / 16) % prog.length, i = s % 16, c = prog[bar];
      const bl = p.spb16 * 16;
      if (i === 0) ep(p, L[0], t, chordOf(root + 12, sc, c), bl * 0.9, 0.45);
      if (i === 0 || i === 8) kick(p, L[1], t, 0.7, 0.8);
      if (i === 4 || i === 12) snare(p, L[1], t, 0.45, 230, 0.2);
      if (i % 2 === 0) typewriter(p, L[1], t, i % 4 === 0 ? 0.8 : 0.5);                     // the press
      if (i === 0) tuba(p, L[2], t, dm(root - 12, sc, c), p.spb16 * 3, 0.9);
      if (i === 8) tuba(p, L[2], t, dm(root - 12, sc, c + 4), p.spb16 * 3, 0.8);
      const n = mel[s % (prog.length * 16)];
      if (n) lead(p, L[3], t, dm(root + 12, sc, n.d), p.spb16 * n.len * 0.9, hum(0.85), 'whistle');
      if (i === 4 || i === 12) piano(p, L[4], t, chordOf(root + 12, sc, c, 3), p.spb16 * 1.5, hum(0.8));
      if (i === 14 && bar % 2 === 1) bell(p, L[4], t, 93, 0.8, 0.9, 5.4);                  // carriage bell
    },
  };
}

// ─────────────────────────────── Music ───────────────────────────────

/** Layer on-thresholds (bed, drums, bass, lead, top) against the effective intensity. */
const LAYER_ON = [-1, 0.12, 0.32, 0.58, 0.8] as const;

function layerGain(i: number, x: number): number {
  if (i === 0) return 1;
  const th = LAYER_ON[i];
  const u = clampf((x - (th - 0.1)) / 0.2, 0, 1);
  return u * u * (3 - 2 * u);
}

export class Music {
  private engine: AudioEngine;
  private want: MusicTrack | null = null;
  private intensity = 0.55;
  private cur: Player | null = null;
  private players: Player[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private waiting = false;
  private songs = new Map<string, Song>();

  constructor(engine: AudioEngine) { this.engine = engine; }

  /** Start (crossfade to) a track. Before unlock the request is remembered and honoured on unlock. */
  play(track: MusicTrack): void {
    this.want = track;
    if (!this.engine.ready) {
      if (!this.waiting) {
        this.waiting = true;
        this.engine.onReady(() => { this.waiting = false; if (this.want) this.start(this.want); });
      }
      return;
    }
    this.start(track);
  }

  /** Fade the current track out. */
  stop(): void {
    this.want = null;
    const ac = this.engine.ac;
    if (!ac || !this.cur) return;
    this.fadeOut(this.cur, ac.currentTime, 1.0);
    this.cur = null;
  }

  /** 0..1 threat level: bed → +drums → +bass → +lead → +top layer. Smoothed over ~1.5 s. */
  setIntensity(x01: number): void {
    const v = clampf(x01, 0, 1);
    if (Math.abs(v - this.intensity) < 0.005) return;
    this.intensity = v;
    const ac = this.engine.ac;
    if (ac && this.cur) this.applyLayers(this.cur, ac.currentTime, 1.5);
  }

  /** The currently requested track (null when stopped). */
  get track(): MusicTrack | null { return this.want; }

  /**
   * One scheduler tick: schedule every step that starts before now + HORIZON_S. The live timer
   * calls this every 25 ms; offline verification calls it from OfflineAudioContext.suspend().
   */
  pump(): void {
    const ac = this.engine.ac;
    if (!ac) return;
    try {
      const now = ac.currentTime;
      const horizon = now + HORIZON_S;
      for (const p of this.players) {
        if (p.nextT < now - 0.05) {                       // fell behind (throttled tab): skip, don't burst
          const n = Math.ceil((now - p.nextT) / p.spb16);
          p.step += n; p.nextT += n * p.spb16;
        }
        let guard = 64;
        while (p.nextT < horizon && p.nextT < p.endT && guard-- > 0) {
          const sw = (p.step % 2 === 1) ? p.song.swing * p.spb16 : 0;
          try { p.song.step(p, p.step, p.nextT + sw); } catch { /* a bad note never stops the band */ }
          p.step++;
          p.nextT += p.spb16;
        }
      }
      // retire faded players
      let j = 0;
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        if (p.fading && now > p.endT + 0.3) p.dispose(); else this.players[j++] = p;
      }
      this.players.length = j;
      if (!this.players.length) this.stopTimer();
    } catch {
      // never throw out of the timer
    }
  }

  // ───────────── internals ─────────────

  private songFor(track: MusicTrack): Song {
    const key = track === 'title' || track === 'select' ? 'news' : track;
    let s = this.songs.get(key);
    if (!s) {
      s = key === 'news' ? songNews() : key === 'grideast' ? songGridEast() : key === 'whitestacks' ? songWhiteStacks()
        : key === 'lockwater' ? songLockwater() : key === 'boss' ? songBoss() : songTabloid();
      this.songs.set(key, s);
    }
    return s;
  }

  private effIntensity(p: Player): number {
    switch (p.track) {
      case 'title': return 0.95;
      case 'select': return 0.45;
      case 'tabloid': return 0.9;
      case 'boss': return Math.max(0.62, this.intensity);
      default: return this.intensity;
    }
  }

  private applyLayers(p: Player, t: number, ramp: number): void {
    const x = this.effIntensity(p);
    let changed = false;
    for (let i = 0; i < p.L.length; i++) if (Math.abs(layerGain(i, x) - p.targets[i]) > 0.02) changed = true;
    if (!changed) return;
    for (let i = 0; i < p.L.length; i++) {
      p.targets[i] = layerGain(i, x);
      const g = p.L[i].gain;
      try { g.cancelScheduledValues(t); } catch { /* ignore */ }
      setAt(g, g.value, t);
      linTo(g, layerGain(i, x), t + Math.max(0.01, ramp));
    }
  }

  private fadeOut(p: Player, t: number, dur: number): void {
    if (p.fading) return;
    p.fading = true;
    const g = p.out.gain;
    try { g.cancelScheduledValues(t); } catch { /* ignore */ }
    setAt(g, g.value, t);
    linTo(g, 0, t + dur);
    p.endT = t + dur;
    for (const s of p.beds) { try { s.stop(t + dur + 0.05); } catch { /* ignore */ } }
  }

  private start(track: MusicTrack): void {
    const ac = this.engine.ac, bus = this.engine.musicBus;
    if (!ac || !bus) return;
    try {
      const now = ac.currentTime;
      const cur = this.cur;
      const song = this.songFor(track);
      if (cur && !cur.fading) {
        if (cur.track === track) return;
        if (cur.song === song) {                           // title ⇄ select: same band, new mix
          cur.track = track;
          this.applyLayers(cur, now, 1.2);
          return;
        }
        this.fadeOut(cur, now, XFADE_S);
      }
      const p = new Player(ac, bus, this.engine.musicVerb, song, track, now + 0.06);
      const fadeIn = cur ? XFADE_S : 0.4;
      setAt(p.out.gain, 0, now);
      linTo(p.out.gain, TRACK_GAIN * clampf(song.gain ?? 1, 0.25, 2), now + fadeIn);
      this.applyLayers(p, now, 0.05);
      if (song.start) { try { song.start(p, now + 0.06); } catch { /* ignore */ } }
      this.cur = p;
      this.players.push(p);
      this.startTimer();
      this.pump();
    } catch {
      // music is cosmetic
    }
  }

  private startTimer(): void {
    if (this.timer || this.engine.offline) return;
    try { this.timer = setInterval(() => this.pump(), LOOKAHEAD_MS); } catch { this.timer = null; }
  }

  private stopTimer(): void {
    if (this.timer) { try { clearInterval(this.timer); } catch { /* ignore */ } this.timer = null; }
  }
}
