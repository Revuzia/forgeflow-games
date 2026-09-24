// BLOCKTOOTH — procedural sound effects (CONTRACT.md §13).
//
// Every sound is synthesized at trigger time from the toolkit in audio.ts (oscillators, looped
// noise, biquads, FM pairs, the grit shaper, the shared procedural reverb). No samples.
//
// The sim → audio bridge is `onEvents(w, events, camX, camZ)`, called once per rendered frame with
// every SimEvent since the previous frame. Mixing rules:
//   * voice limiter — at most MAX_VOICES (24) live voices; a new voice steals the least important
//     (then oldest) one, and is dropped instead if everything playing matters more;
//   * per-sound cooldowns (GAP) + a per-frame budget for low-priority chatter, so a Size V titan
//     popping 300 floors a second is a textured roar, not a node storm;
//   * distance attenuation from the camera look target, scaled by titan height (a 60 m titan
//     hears a whole block as "near"), and stereo pan along the camera's screen-right axis.
// Everything no-ops before AudioEngine.unlock() and without an AudioContext.

import type {
  AlertKey, BossId, DamageKind, EnemyKind, ProjectileKind, PropKind, SimEvent, TelegraphStyle, TitanId, World,
} from '../core/types.ts';
import type { AudioEngine } from './audio.ts';
import {
  MAX_VOICES, clampf, curveTo, envAHR, envPerc, fin, linTo, mkFM, mkFilter, mkGain, mkGrit, mkNoise, mkOsc,
  mkPan, setAt, sweep,
} from './audio.ts';
import type { Ctx, NoiseColor } from './audio.ts';
import { shapeCenter } from '../core/math.ts';

export type UiSound = 'move' | 'confirm' | 'back' | 'draft' | 'pick' | 'slate' | 'print';

// ─────────────────────────────── build handle + tiny helpers ───────────────────────────────

type Src = AudioScheduledSourceNode;
/** A voice under construction: context, start time, the voice input node, registered sources. */
interface B { ac: Ctx; t: number; o: GainNode; srcs: Src[]; pan: AudioNode; }

interface Voice {
  name: string; prio: number; start: number; end: number;
  out: GainNode; kill: GainNode; pan: AudioNode; wet: GainNode | null; srcs: Src[];
}

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const rnd = (a: number, b: number) => a + (b - a) * Math.random();
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];

function osc(b: B, type: OscillatorType, f: number, t0: number, t1: number, det = 0): OscillatorNode {
  const o = mkOsc(b.ac, type, f, t0, t1, det); b.srcs.push(o); return o;
}
function nz(b: B, color: NoiseColor, t0: number, t1: number, rate = 1): AudioBufferSourceNode {
  const s = mkNoise(b.ac, color, t0, t1, rate); b.srcs.push(s); return s;
}
const gn = (b: B, v = 0) => mkGain(b.ac, v);
const flt = (b: B, type: BiquadFilterType, f: number, q = 0.707) => mkFilter(b.ac, type, f, q);
function wire(...n: AudioNode[]): AudioNode { for (let i = 0; i + 1 < n.length; i++) n[i].connect(n[i + 1]); return n[n.length - 1]; }

// ─────────────────────────────── recipes (building blocks) ───────────────────────────────

/** Pitched body thump (kick / footfall / impact core). */
function thump(b: B, dst: AudioNode, t: number, f0: number, f1: number, dur: number, amp: number, type: OscillatorType = 'sine'): void {
  const o = osc(b, type, f0, t, t + dur + 0.03);
  sweep(o.frequency, t, f0, f1, Math.max(0.01, dur * 0.6));
  const a = gn(b); envPerc(a.gain, t, amp, 0.0025, dur, 3.2);
  wire(o, a, dst);
}

/** Filtered noise burst with optional filter sweep. */
function burst(b: B, dst: AudioNode, t: number, color: NoiseColor, type: BiquadFilterType, f: number, q: number,
  att: number, dec: number, amp: number, fEnd = 0, shape = 4): void {
  const s = nz(b, color, t, t + att + dec + 0.03);
  const fl = flt(b, type, f, q);
  if (fEnd > 0) sweep(fl.frequency, t, f, fEnd, att + dec);
  const a = gn(b); envPerc(a.gain, t, amp, att, dec, shape);
  wire(s, fl, a, dst);
}

/** Tonal blip with optional pitch glide. */
function blip(b: B, dst: AudioNode, t: number, type: OscillatorType, f: number, dur: number, amp: number, fEnd = 0, att = 0.003, lp = 0): void {
  const o = osc(b, type, f, t, t + att + dur + 0.03);
  if (fEnd > 0) sweep(o.frequency, t, f, fEnd, att + dur);
  const a = gn(b); envPerc(a.gain, t, amp, att, dur, 3.5);
  if (lp > 0) wire(o, flt(b, 'lowpass', lp, 0.8), a, dst); else wire(o, a, dst);
}

/** Square/triangle beep with a flat sustain (telegraph + UI beeps). */
function beep(b: B, dst: AudioNode, t: number, type: OscillatorType, f: number, dur: number, amp: number, lp = 4000): void {
  const o = osc(b, type, f, t, t + dur + 0.02);
  const a = gn(b);
  setAt(a.gain, 0, t); linTo(a.gain, amp, t + 0.004); linTo(a.gain, amp * 0.8, t + dur - 0.012); linTo(a.gain, 0, t + dur);
  wire(o, flt(b, 'lowpass', lp, 0.7), a, dst);
}

/** Glass / bolts: n short high pings scattered over `spread` seconds. */
function tinkle(b: B, dst: AudioNode, t: number, n: number, spread: number, fmin: number, fmax: number, amp: number, dec = 0.1): void {
  const bus = gn(b, 1); bus.connect(dst);
  for (let i = 0; i < n; i++) {
    const tt = t + Math.random() * spread;
    const f = fmin * Math.pow(fmax / fmin, Math.random());
    const o = osc(b, i % 3 === 0 ? 'triangle' : 'sine', f, tt, tt + dec + 0.03);
    const a = gn(b); envPerc(a.gain, tt, amp * rnd(0.45, 1), 0.001, dec * rnd(0.6, 1.3), 5);
    wire(o, a, bus);
  }
}

/** FM clang (metal): index decays so the hit starts bright and rings pure. */
function clang(b: B, dst: AudioNode, t: number, f: number, ratio: number, index: number, dur: number, amp: number): void {
  const fm = mkFM(b.ac, f, ratio, index, t, t + dur + 0.04);
  b.srcs.push(fm.car, fm.mod);
  const d0 = index * f * ratio;
  setAt(fm.depth.gain, d0, t); linTo(fm.depth.gain, d0 * 0.12, t + dur * 0.7);
  const a = gn(b); envPerc(a.gain, t, amp, 0.0015, dur, 4);
  wire(fm.car, a, dst);
}

/** FM bell (chimes, jingles): long ring, gentle index. */
function bell(b: B, dst: AudioNode, t: number, f: number, dur: number, amp: number, ratio = 3.5, index = 1.4): void {
  const fm = mkFM(b.ac, f, ratio, index, t, t + dur + 0.05);
  b.srcs.push(fm.car, fm.mod);
  const d0 = index * f * ratio;
  setAt(fm.depth.gain, d0, t); linTo(fm.depth.gain, d0 * 0.25, t + dur * 0.5);
  const a = gn(b); envPerc(a.gain, t, amp, 0.002, dur, 4.5);
  wire(fm.car, a, dst);
}

/** Crackle: one noise source through a bandpass, gated by many random short spikes. */
function crackle(b: B, dst: AudioNode, t: number, dur: number, n: number, f: number, q: number, amp: number, regular = false): void {
  const s = nz(b, 'white', t, t + dur + 0.05);
  const fl = flt(b, 'bandpass', f, q);
  const a = gn(b, 0);
  setAt(a.gain, 0, t);
  const times: number[] = [];
  for (let i = 0; i < n; i++) times.push(regular ? t + (i / Math.max(1, n)) * dur : t + Math.random() * dur);
  times.sort((x, y) => x - y);
  let prev = t;
  for (const tt0 of times) {
    const tt = Math.max(tt0, prev + 0.002);
    const len = 0.003 + Math.random() * 0.012;
    linTo(a.gain, 0, tt);
    linTo(a.gain, amp * rnd(0.35, 1), tt + 0.0012);
    linTo(a.gain, 0, tt + len);
    prev = tt + len;
  }
  wire(s, fl, a, dst);
}

/** Rumble: brown noise through a sweeping lowpass with an attack-hold-release envelope. */
function rumble(b: B, dst: AudioNode, t: number, att: number, hold: number, rel: number, f0: number, f1: number, amp: number): void {
  const end = t + att + hold + rel;
  const s = nz(b, 'brown', t, end + 0.05);
  const fl = flt(b, 'lowpass', f0, 0.9);
  sweep(fl.frequency, t, f0, f1, att + hold + rel);
  const a = gn(b); envAHR(a.gain, t, amp, att, hold, rel, 3);
  wire(s, fl, a, dst);
}

/** Whoosh: bandpassed noise sweeping f0 → f1, swelling then fading. */
function whoosh(b: B, dst: AudioNode, t: number, dur: number, f0: number, f1: number, q: number, amp: number, color: NoiseColor = 'pink'): void {
  const s = nz(b, color, t, t + dur + 0.05);
  const fl = flt(b, 'bandpass', f0, q);
  sweep(fl.frequency, t, f0, f1, dur);
  const a = gn(b); envAHR(a.gain, t, amp, dur * 0.45, 0, dur * 0.55, 2.5);
  wire(s, fl, a, dst);
}

/** Cartoon spring "boing": a sine whose pitch wobbles (decaying LFO) while drifting upward. */
function spring(b: B, dst: AudioNode, t: number, f: number, dur: number, amp: number, rate = 21): void {
  const o = osc(b, 'sine', f, t, t + dur + 0.03);
  sweep(o.frequency, t, f * 0.85, f * 1.35, dur);
  const lfo = osc(b, 'sine', rate, t, t + dur + 0.03);
  const depth = gn(b, 0);
  setAt(depth.gain, f * 0.35, t); linTo(depth.gain, f * 0.02, t + dur);
  wire(lfo, depth); depth.connect(o.frequency);
  const a = gn(b); envPerc(a.gain, t, amp, 0.004, dur, 2.6);
  wire(o, a, dst);
}

/** Air-raid style siren: detuned saws gliding lo → hi → lo. */
function siren(b: B, dst: AudioNode, t: number, dur: number, lo: number, hi: number, amp: number): void {
  const bus = flt(b, 'lowpass', 2200, 0.8);
  const a = gn(b); envAHR(a.gain, t, amp, 0.35, dur * 0.55, dur * 0.35, 2.2);
  wire(bus, a, dst);
  for (const [type, det, lvl] of [['sawtooth', -9, 0.45], ['sawtooth', 8, 0.45], ['square', 0, 0.25]] as const) {
    const o = osc(b, type, lo, t, t + dur + 0.05, det);
    curveTo(o.frequency, t, [[0, lo], [dur * 0.32, hi], [dur * 0.62, hi * 0.97], [dur, lo * 0.8]]);
    const g = gn(b, lvl); wire(o, g, bus);
  }
}

/** Synth brass: detuned saws per note through a lowpass with a brassy filter envelope. */
function brass(b: B, dst: AudioNode, t: number, notes: readonly number[], dur: number, amp: number, bright = 1): void {
  const fl = flt(b, 'lowpass', 300, 2.2);
  curveTo(fl.frequency, t, [[0, 300], [0.045, 500 + 3400 * bright], [0.22, 800 + 1500 * bright], [dur * 0.85, 600 + 800 * bright], [dur, 250]]);
  const a = gn(b); envAHR(a.gain, t, amp, 0.018, dur * 0.55, dur * 0.45, 2.5);
  wire(fl, a, dst);
  const per = 1 / (notes.length * 2);
  for (const m of notes) {
    for (const det of [-8, 7]) {
      const o = osc(b, 'sawtooth', mtof(m), t, t + dur + 0.05, det);
      // tiny "blat" pitch scoop into the note
      curveTo(o.detune, t, [[0, det - 40], [0.05, det]]);
      const g = gn(b, per); wire(o, g, fl);
    }
  }
}

/** Formant sets (F1, F2, F3) for creature vowels. */
const VOWELS = {
  a: [700, 1150, 2500], o: [460, 820, 2350], u: [330, 720, 2250], e: [500, 1650, 2500], r: [560, 980, 2000],
} as const;
type Vowel = keyof typeof VOWELS;

/**
 * Creature voice (roars, grunts, groans): saw + sub through grit, three formant bandpasses,
 * vibrato, growl AM and a breath-noise layer. `pitch` = automation points [t offset, Hz].
 */
function creature(b: B, dst: AudioNode, t: number, dur: number, pitch: readonly (readonly [number, number])[], vowel: Vowel,
  amp: number, opts: { growl?: number; growlHz?: number; breath?: number; fscale?: number; grit?: number; vib?: number } = {}): void {
  const end = t + dur + 0.06;
  const growl = clampf(opts.growl ?? 0.35, 0, 0.9);
  const fscale = clampf(opts.fscale ?? 1, 0.4, 1.6);
  const src = osc(b, 'sawtooth', pitch[0][1], t, end);
  const sub = osc(b, 'square', pitch[0][1] * 0.5, t, end);
  curveTo(src.frequency, t, pitch);
  curveTo(sub.frequency, t, pitch.map(([dt, f]) => [dt, f * 0.5] as const));
  const vib = osc(b, 'sine', rnd(4.5, 6.5), t, end);
  const vd = gn(b, pitch[0][1] * (opts.vib ?? 0.025));
  wire(vib, vd); vd.connect(src.frequency); vd.connect(sub.frequency);
  const mix = gn(b, 1);
  const subG = gn(b, 0.35);
  src.connect(mix); wire(sub, subG, mix);
  const grit = mkGrit(b.ac, opts.grit ?? 0.45);
  // growl: amplitude modulation at a rough, sub-audio-ish rate
  const vca = gn(b, 1 - growl);
  const am = osc(b, 'sine', opts.growlHz ?? rnd(26, 38), t, end);
  const amd = gn(b, growl);
  wire(am, amd); amd.connect(vca.gain);
  wire(mix, grit, vca);
  const env = gn(b);
  envAHR(env.gain, t, amp, Math.min(0.12, dur * 0.18), dur * 0.42, dur * 0.4, 2.4);
  const fm = VOWELS[vowel];
  const lv = [1.0, 0.55, 0.22];
  for (let i = 0; i < 3; i++) {
    const f = flt(b, 'bandpass', fm[i] * fscale, 5 + i * 2);
    const g = gn(b, lv[i] * 2.2);
    wire(vca, f, g, env);
  }
  const breath = opts.breath ?? 0.3;
  if (breath > 0) {
    const n = nz(b, 'pink', t, end);
    const f = flt(b, 'bandpass', fm[1] * fscale, 1.6);
    const g = gn(b, breath);
    wire(n, f, g, env);
  }
  env.connect(dst);
}

/** Explosion: sharp crack + sub body + a darkening blast + debris crackle for big ones. */
function boom(b: B, dst: AudioNode, t: number, size: number, amp: number): void {
  size = clampf(size, 0.2, 2);
  burst(b, dst, t, 'white', 'highpass', 900, 0.7, 0.001, 0.05 + 0.03 * size, amp * 0.45);
  thump(b, dst, t, 95 / Math.pow(size, 0.35), 32, 0.35 + 0.35 * size, amp * 0.9);
  burst(b, dst, t, 'brown', 'lowpass', 2600, 0.8, 0.004, 0.35 + 0.8 * size, amp * 1.1, 140, 3.2);
  if (size > 0.65) crackle(b, dst, t + 0.05, 0.25 + 0.4 * size, Math.round(8 + 10 * size), 1800, 1.2, amp * 0.35);
}

/** Metal crunch (vehicles, containers). */
function metalCrunch(b: B, dst: AudioNode, t: number, f: number, dur: number, amp: number): void {
  clang(b, dst, t, f, 1.41, 7, dur, amp * 0.55);
  clang(b, dst, t + 0.012, f * 1.73, 2.13, 4, dur * 0.7, amp * 0.3);
  burst(b, dst, t, 'white', 'bandpass', 1300, 1.1, 0.002, dur * 0.7, amp * 0.6, 500);
  crackle(b, dst, t + 0.01, dur * 0.8, 7, 2600, 1.4, amp * 0.35);
}

/** Wood crack (trees, benches, boats). */
function woodCrack(b: B, dst: AudioNode, t: number, amp: number): void {
  burst(b, dst, t, 'white', 'bandpass', 950, 3, 0.001, 0.06, amp * 0.9);
  thump(b, dst, t, 150, 70, 0.12, amp * 0.5);
  crackle(b, dst, t + 0.015, 0.18, 9, 1700, 2, amp * 0.45);
}

// ─────────────────────────────── per-sound cooldowns (s) ───────────────────────────────

const GAP: Record<string, number> = {
  step: 0.07, prop: 0.03, floor: 0.045, collapse: 0.1, smash: 0.08, bump: 0.45,
  bite: 0.05, arcAtk: 0.05, stompWind: 0.1, vine: 0.05, zap: 0.06, pulse: 0.1, dash: 0.08,
  hook: 0.25, wires: 0.2, vent: 0.3, sprout: 0.1, spore: 0.35,
  hit: 0.05, crit: 0.06, crush: 0.045, pop: 0.04, kill: 0.06, bigKill: 0.12,
  boom: 0.07, magma: 0.08, pjHit: 0.04, impact: 0.08,
  fire_android: 0.05, fire_squad: 0.04, fire_apc: 0.07, fire_drone: 0.18, fire_buggy: 0.12,
  fire_tank: 0.15, fire_walker: 0.12, fire_elite: 0.6,
  hurt: 0.2, heal: 1.0, tick: 0.05, bonus: 0.12, level: 0.25, rank: 1.5,
  tg_cone: 0.1, tg_oval: 0.12, tg_lane: 0.1, tg_ring: 0.12, tg_circle: 0.08, tg_chain: 0.1,
  alert: 0.6, siren: 6, phase: 1.5, lowHp: 4, elite: 2.5, chest: 0.5,
  bossAtk: 0.4, bossHit: 0.07, stagger: 1.5, bossDown: 5, leash: 0.3, proc: 0.12, end: 5,
  ui_move: 0.03, ui_confirm: 0.05, ui_back: 0.05, ui_draft: 0.2, ui_pick: 0.15, ui_slate: 0.5, ui_print: 0.5,
};

/**
 * Music ducking — ONLY the big stings pull the band down ([depth 0..0.95, hold s, release s]);
 * ordinary combat voices never duck (the busy-play balance is the bus levels, not a pumping
 * side-chain). MASS BREACH adds 0.2 s of hold per rank on top of its base hold.
 */
const STING_DUCK = {
  breach: [0.65, 1.6, 1.2],     // rank-up brass + roar
  siren: [0.45, 2.4, 1.0],      // boss arrives (the music is crossfading to the boss track underneath)
  phase: [0.4, 1.0, 0.8],       // boss phase brass sting
  bossDown: [0.55, 2.2, 1.5],   // boss collapse
} as const;

/** Low-priority (≤ 1) voices allowed per onEvents call. */
const FRAME_BUDGET = 4;
/** Token bucket for low-priority voices: sustained rate (voices/s) and burst. Bounds node churn at Size V. */
const LOW_RATE = 40, LOW_BURST = 10;

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];

/** Per-titan voice colour: pitch multiplier + grunt vowel. */
const TITAN_VOICE: Record<TitanId, { mul: number; vowel: Vowel; growl: number }> = {
  molo: { mul: 0.85, vowel: 'o', growl: 0.35 },
  voltkite: { mul: 1.3, vowel: 'a', growl: 0.2 },
  hearthback: { mul: 0.7, vowel: 'u', growl: 0.55 },
  briarwick: { mul: 1.0, vowel: 'e', growl: 0.3 },
};

// ─────────────────────────────── the Sfx class ───────────────────────────────

export class Sfx {
  private eng: AudioEngine;
  private voices: Voice[] = [];
  private dying: Voice[] = [];
  private last = new Map<string, number>();
  private frameLow = 0;
  private camX = 0; private camZ = 0;
  private H = 1.2;
  private rank = 0;
  private titan: TitanId = 'molo';
  private bossId: BossId | null = null;
  private maxHp = 100;
  private combo = 0; private comboT = -10;
  private healAcc = 0; private healT = 0;
  private stepSide = 1;
  private tokens = LOW_BURST; private tokT = 0;

  constructor(engine: AudioEngine) { this.eng = engine; }

  /** Live voice count (for tests / the debug overlay). */
  get activeVoices(): number { this.prune(this.eng.now); return this.voices.length; }

  // ───────────── public API ─────────────

  onEvents(w: World, ev: readonly SimEvent[], camX: number, camZ: number): void {
    if (!this.eng.ready || !ev || ev.length === 0) return;
    try {
      this.camX = fin(camX, 0); this.camZ = fin(camZ, 0);
      const T = w.titan;
      this.H = Math.max(0.5, fin(T.height, 1.2));
      this.rank = T.rank;
      this.titan = w.titanId;
      this.bossId = w.boss ? w.boss.id : null;
      this.maxHp = Math.max(1, fin(T.maxHp, 100));
      this.frameLow = 0;
      let pickN = 0, pickScrap = 0, pickX = 0, pickZ = 0;
      for (const e of ev) {
        if (e.type === 'pickup' && (e.kind === 'rubble' || e.kind === 'scrap')) {
          pickN++; if (e.kind === 'scrap') pickScrap++;
          pickX += e.x; pickZ += e.z;
          continue;
        }
        this.one(w, e);
      }
      if (pickN > 0) this.pickupTicks(pickN, pickScrap > pickN / 2, pickX / pickN, pickZ / pickN);
    } catch {
      // cosmetic subsystem: never let a synthesis error reach the game loop
    }
  }

  ui(kind: UiSound): void {
    if (!this.eng.ready) return;
    try { this.uiSound(kind); } catch { /* ignore */ }
  }

  // ───────────── voice management ─────────────

  private gate(name: string, now: number): boolean {
    const gap = GAP[name] ?? 0.05;
    const l = this.last.get(name);
    if (l !== undefined && now - l < gap && now >= l) return false;
    this.last.set(name, now);
    return true;
  }

  private prune(now: number): void {
    const vs = this.voices;
    let j = 0;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.end < now) this.release(v); else vs[j++] = v;
    }
    vs.length = j;
    if (this.dying.length) {
      let k = 0;
      for (let i = 0; i < this.dying.length; i++) {
        const v = this.dying[i];
        if (v.end < now) this.release(v); else this.dying[k++] = v;
      }
      this.dying.length = k;
    }
  }

  private release(v: Voice): void {
    try { v.out.disconnect(); } catch { /* ignore */ }
    try { v.kill.disconnect(); } catch { /* ignore */ }
    try { v.pan.disconnect(); } catch { /* ignore */ }
    if (v.wet) { try { v.wet.disconnect(); } catch { /* ignore */ } }
  }

  /**
   * Open a voice. Returns null when the sound should not play (budget, limiter, silence).
   * `gain` already includes distance attenuation; `dur` is the sound's full length.
   */
  private voice(name: string, prio: number, dur: number, gain: number, pan: number, wet: number): B | null {
    const ac = this.eng.ac, bus = this.eng.sfxBus;
    if (!ac || !bus || !(gain > 0.002)) return null;
    const now = ac.currentTime;
    if (prio <= 1) {
      // per-frame cap + a token bucket; prio-0 chatter keeps 3 tokens of headroom for prio-1 sounds
      this.tokens = Math.min(LOW_BURST, this.tokens + Math.max(0, now - this.tokT) * LOW_RATE);
      this.tokT = now;
      if (this.frameLow >= FRAME_BUDGET || this.tokens < (prio === 0 ? 3 : 1)) return null;
      this.frameLow++; this.tokens -= 1;
    }
    this.prune(now);
    if (this.voices.length >= MAX_VOICES) {
      let vi = -1;
      for (let i = 0; i < this.voices.length; i++) {
        const v = this.voices[i];
        if (vi < 0 || v.prio < this.voices[vi].prio || (v.prio === this.voices[vi].prio && v.start < this.voices[vi].start)) vi = i;
      }
      const victim = this.voices[vi];
      if (victim.prio > prio) return null;
      this.voices.splice(vi, 1);
      this.steal(victim, now);
    }
    const t = now + 0.004;
    const out = mkGain(ac, clampf(gain, 0, 2));
    const kill = mkGain(ac, 1);
    const p = mkPan(ac, pan);
    out.connect(kill); kill.connect(p); p.connect(bus);
    let wg: GainNode | null = null;
    const verb = this.eng.sfxVerb;
    if (wet > 0 && verb) { wg = mkGain(ac, clampf(wet, 0, 1)); kill.connect(wg); wg.connect(verb); }
    const srcs: Src[] = [];
    this.voices.push({ name, prio, start: t, end: t + Math.max(0.05, dur) + 0.08, out, kill, pan: p, wet: wg, srcs });
    return { ac, t, o: out, srcs, pan: p };
  }

  private steal(v: Voice, now: number): void {
    setAt(v.kill.gain, 1, now);
    linTo(v.kill.gain, 0, now + 0.025);
    for (const s of v.srcs) { try { s.stop(now + 0.03); } catch { /* ignore */ } }
    v.end = now + 0.05;
    this.dying.push(v);
  }

  /** Distance attenuation + pan for a world point relative to the camera target. */
  private spatial(x: number, z: number): { g: number; pan: number } {
    const dx = fin(x, this.camX) - this.camX, dz = fin(z, this.camZ) - this.camZ;
    const ref = Math.max(6, this.H * 5.5);
    const d = Math.hypot(dx, dz) / ref;
    const g = 1 / (1 + 0.9 * d * d);
    const sx = (dx - dz) * 0.70710678 / ref;
    return { g: g < 0.03 ? 0 : g, pan: clampf(sx * 0.6, -0.85, 0.85) };
  }

  /** Sound size relative to the titan: things far below the titan's league get quieter. */
  private tierScale(tier: number): number {
    const canFlatten = [0, 1, 2, 3, 4][this.rank] ?? 0;
    const below = canFlatten - tier;
    return below > 0 ? Math.pow(0.62, below) : 1;
  }

  // ───────────── event dispatch ─────────────

  private one(w: World, e: SimEvent): void {
    const now = this.eng.now;
    switch (e.type) {
      case 'footstep': if (this.gate('step', now)) this.footstep(e.x, e.z, e.heavy); break;
      case 'propDestroyed': if (this.gate('prop', now)) this.propCrunch(e.kind, e.x, e.z); break;
      case 'floorBreak': if (this.gate('floor', now)) this.floorBreak(e.tier, e.remaining, e.x, e.z); break;
      case 'buildingCollapse': if (this.gate('collapse', now)) this.collapse(e.tier, e.h, e.x, e.z); break;
      case 'smash': if (this.gate('smash', now)) this.smash(e.tier, e.x, e.z); break;
      case 'bump': if (this.gate('bump', now)) this.bump(e.x, e.z); break;
      case 'titanAttack': this.titanAttack(e.attack, e.x, e.z, e.hits, now); break;
      case 'arc': if (e.kind !== 'fork' && e.pts.length >= 2 && this.gate('zap', now)) this.zap(e.pts[0], e.pts[1], e.kind === 'upgrade' ? 0.7 : 0.55); break;
      case 'pulse': if (this.gate('pulse', now)) this.pulse(e.x, e.z); break;
      case 'vine': break;                                  // voiced by titanAttack 'vineLash'
      case 'dash': if (this.gate('dash', now)) this.dash(e.x0, e.z0, e.x1, e.z1); break;
      case 'ability': if (this.gate('hook', now)) this.hook(e.titan, e.x, e.z, e.power); break;
      case 'wireDetonate': if (this.gate('wires', now)) this.wires(e.pts); break;
      case 'vent': if (this.gate('vent', now)) this.ventHiss(e.x, e.z, e.power); break;
      case 'bloomSpawn': if (this.gate('sprout', now)) this.sprout(e.x, e.z); break;
      case 'spore': if (this.gate('spore', now)) this.sporePuff(e.x, e.z); break;
      case 'enemySpawn': break;
      case 'enemyHit':
        if (e.crit) { if (this.gate('crit', now)) this.enemyHit(e.x, e.z, true); }
        else if (this.gate('hit', now)) this.enemyHit(e.x, e.z, false);
        break;
      case 'enemyKilled': this.enemyKilled(e.kind, e.crushed, e.x, e.z, now); break;
      case 'enemyFire': if (this.gate('fire_' + e.kind, now)) this.enemyFire(e.kind, e.x, e.z); break;
      case 'titanHurt': this.titanHurt(e.dmg, e.src, now); break;
      case 'titanHeal': this.titanHeal(e.amount, now); break;
      case 'pickup':
        if (e.kind === 'heal') { if (this.gate('bonus', now)) this.healChime(e.x, e.z); }
        else if (e.kind === 'chest') { if (this.gate('chest', now)) this.sparkle(e.x, e.z, 1); }
        break;
      case 'levelUp': if (this.gate('level', now)) this.levelChime(); break;
      case 'rankUp': if (this.gate('rank', now)) this.massBreach(e.rank); break;
      case 'telegraphStart': if (e.owner !== 'titan' && this.gate('tg_' + e.style, now)) this.warn(w, e.id, e.style, e.owner === 'boss'); break;
      case 'telegraphFire': if (e.owner !== 'titan') this.telegraphImpact(w, e.id, e.x, e.z, e.owner === 'boss', now); break;
      case 'projectileHit': if (this.gate('pjHit', now)) this.projectileHit(e.kind, e.x, e.z); break;
      case 'explosion': this.explosion(e.kind, e.r, e.x, e.z, now); break;
      case 'waveStart': break;
      case 'alert': this.alert(e.key, now); break;
      case 'eliteSpawn': if (this.gate('elite', now)) this.eliteHorn(); break;
      case 'chest': if (this.gate('chest', now)) this.sparkle(e.x, e.z, 0.9); break;
      case 'bossSpawn': if (this.gate('siren', now)) this.bossSiren(); break;
      case 'bossPhase': if (this.gate('phase', now)) this.phaseSting(e.phase); break;
      case 'bossAttack': if (this.gate('bossAtk', now)) this.bossAttack(e.attack, e.x, e.z); break;
      case 'bossHit': if (this.gate('bossHit', now)) this.bossHit(e.part, e.x, e.z); break;
      case 'bossStagger': if (this.gate('stagger', now)) this.stagger(); break;
      case 'bossDefeated': if (this.gate('bossDown', now)) this.bossDown(e.x, e.z); break;
      case 'leash': if (this.gate('leash', now)) this.leash(e.on, e.x, e.z); break;
      case 'upgradeProc': if (this.gate('proc', now)) this.proc(e.x, e.z); break;
      case 'runEnd': if (this.gate('end', now)) this.runEnd(e.result); break;
    }
  }

  // ───────────── the titan's body ─────────────

  /** Footsteps pitched by 1/height: Size I = a little patter, Size V = a seismic thud. */
  private footstep(x: number, z: number, heavy: number): void {
    const H = this.H, hv = clampf(heavy, 0, 1);
    const s = this.spatial(x, z);
    this.stepSide = -this.stepSide;
    const f0 = clampf(170 * Math.pow(1.2 / H, 0.42), 26, 190);
    const tail = 0.08 + 1.15 * Math.pow(hv, 1.4);
    const b = this.voice('step', 2, tail + 0.3, s.g * (H < 3 ? 0.5 : 0.3 + 0.5 * hv), s.pan + this.stepSide * 0.08, 0.05 + 0.2 * hv);
    if (!b) return;
    const t = b.t, o = b.o;
    const v = rnd(0.96, 1.04);
    if (H < 3) {
      // little patter: two soft pads + a toe tick
      burst(b, o, t, 'white', 'bandpass', 2400 * v, 1.4, 0.001, 0.022, 0.9);
      blip(b, o, t, 'sine', 330 * v, 0.05, 0.9, 190);
      burst(b, o, t + 0.055, 'white', 'bandpass', 3000 * v, 1.6, 0.001, 0.016, 0.5);
    } else {
      thump(b, o, t, f0 * 2.2 * v, f0 * v, 0.14 + 0.35 * hv, 0.9);
      thump(b, o, t, f0 * 4 * v, f0 * 2 * v, 0.1 + 0.15 * hv, 0.35);      // audible 2nd harmonic
      burst(b, o, t, 'brown', 'lowpass', 900 - 500 * hv, 0.8, 0.004, 0.12 + 0.3 * hv, 0.7, 150);
      if (hv > 0.2) rumble(b, o, t + 0.02, 0.03, tail * 0.2, tail * 0.8, 380, 90, 0.45 * hv);
      if (hv >= 0.5) crackle(b, o, t + 0.06, 0.25 + 0.5 * hv, Math.round(6 + 10 * hv), clampf(2400 * Math.pow(5 / H, 0.3), 900, 2400), 1.3, 0.09);
    }
    // per-titan foot colour
    switch (this.titan) {
      case 'voltkite':
        burst(b, o, t, 'white', 'highpass', 5500, 0.8, 0.001, 0.006, 0.35);
        if (H >= 3) crackle(b, o, t + 0.01, 0.06, 4, 5200, 1.5, 0.12);
        break;
      case 'hearthback': burst(b, o, t + 0.01, 'white', 'bandpass', 420, 2.5, 0.01, 0.1, 0.35); break;
      case 'briarwick': burst(b, o, t + 0.005, 'pink', 'highpass', 3800, 0.7, 0.02, 0.09, 0.2); break;
      default: burst(b, o, t, 'pink', 'lowpass', 700, 0.7, 0.002, 0.05, 0.3); break;
    }
  }

  private propCrunch(kind: PropKind, x: number, z: number): void {
    const s = this.spatial(x, z);
    const sc = this.tierScale(kind === 'bus' || kind === 'truck' || kind === 'container' ? 1 : 0);
    const g = s.g * sc;
    switch (kind) {
      case 'car': case 'taxi': case 'van': case 'forklift': {
        const b = this.voice('prop', 1, 0.5, g * 0.55, s.pan, 0.12); if (!b) return;
        metalCrunch(b, b.o, b.t, rnd(170, 260), 0.3, 0.9);
        tinkle(b, b.o, b.t + 0.02, 6, 0.25, 2600, 6500, 0.22);
        thump(b, b.o, b.t, 110, 55, 0.12, 0.6);
        break;
      }
      case 'bus': case 'truck': {
        const b = this.voice('prop', 1, 0.8, g * 0.7, s.pan, 0.18); if (!b) return;
        metalCrunch(b, b.o, b.t, rnd(110, 150), 0.5, 1);
        tinkle(b, b.o, b.t + 0.03, 9, 0.4, 2200, 6000, 0.22);
        thump(b, b.o, b.t, 90, 40, 0.25, 0.8);
        break;
      }
      case 'container': {
        const b = this.voice('prop', 1, 1.1, g * 0.7, s.pan, 0.3); if (!b) return;
        clang(b, b.o, b.t, rnd(62, 78), 2.7, 3, 0.9, 0.8);
        clang(b, b.o, b.t + 0.02, rnd(140, 170), 1.41, 5, 0.5, 0.35);
        thump(b, b.o, b.t, 80, 35, 0.3, 0.8);
        burst(b, b.o, b.t, 'brown', 'lowpass', 1500, 0.8, 0.003, 0.4, 0.6, 200);
        break;
      }
      case 'kiosk': case 'vending': {
        const b = this.voice('prop', 1, 0.5, g * 0.5, s.pan, 0.12); if (!b) return;
        clang(b, b.o, b.t, rnd(300, 380), 1.8, 4, 0.25, 0.5);
        burst(b, b.o, b.t, 'white', 'bandpass', 1800, 1, 0.002, 0.12, 0.6);
        if (kind === 'vending') tinkle(b, b.o, b.t + 0.03, 6, 0.3, 700, 1600, 0.35, 0.08);   // cans
        tinkle(b, b.o, b.t + 0.02, 5, 0.2, 3000, 7000, 0.22);
        break;
      }
      case 'hydrant': {
        const b = this.voice('prop', 1, 0.9, g * 0.5, s.pan, 0.1); if (!b) return;
        clang(b, b.o, b.t, 420, 3.5, 3, 0.3, 0.6);
        burst(b, b.o, b.t + 0.03, 'white', 'highpass', 2200, 0.7, 0.05, 0.7, 0.35, 4200, 2);   // water spray
        break;
      }
      case 'lamp': case 'signpost': case 'pylon': case 'bollard': case 'barrier': {
        const b = this.voice('prop', 1, 0.45, g * 0.62, s.pan, 0.1); if (!b) return;
        clang(b, b.o, b.t, rnd(520, 700), 2.4, 3, 0.3, 0.45);
        burst(b, b.o, b.t, 'white', 'highpass', 2500, 0.8, 0.001, 0.04, 0.5);
        if (kind === 'lamp') tinkle(b, b.o, b.t + 0.02, 7, 0.22, 3200, 8000, 0.3);
        break;
      }
      case 'tree': case 'bench': {
        const b = this.voice('prop', 1, 0.45, g * 0.95, s.pan, 0.1); if (!b) return;
        woodCrack(b, b.o, b.t, 0.9);
        if (kind === 'tree') burst(b, b.o, b.t + 0.03, 'pink', 'highpass', 3500, 0.7, 0.03, 0.25, 0.25);   // leaves
        break;
      }
      case 'drum': {
        const b = this.voice('prop', 1, 0.6, g * 0.5, s.pan, 0.15); if (!b) return;
        clang(b, b.o, b.t, rnd(120, 150), 1.0, 2.2, 0.45, 0.8);
        burst(b, b.o, b.t + 0.02, 'pink', 'lowpass', 900, 1, 0.02, 0.2, 0.3);
        break;
      }
      case 'boat': {
        const b = this.voice('prop', 1, 0.9, g * 0.72, s.pan, 0.2); if (!b) return;
        woodCrack(b, b.o, b.t, 0.8);
        burst(b, b.o, b.t + 0.02, 'pink', 'lowpass', 1400, 0.8, 0.06, 0.6, 0.55, 400, 2.5);   // splash
        break;
      }
      case 'snowbank': {
        const b = this.voice('prop', 1, 0.4, g * 0.72, s.pan, 0.05); if (!b) return;
        burst(b, b.o, b.t, 'pink', 'lowpass', 900, 0.8, 0.01, 0.28, 0.9, 300);
        break;
      }
    }
  }

  private floorBreak(tier: number, remaining: number, x: number, z: number): void {
    const s = this.spatial(x, z);
    const tr = clampf(tier, 0, 4);
    const g = s.g * this.tierScale(tr) * (remaining === 0 ? 0.6 : 1);
    const b = this.voice('floor', 1, 0.5 + 0.2 * tr, g * (0.4 + 0.1 * tr), s.pan, 0.15);
    if (!b) return;
    const t = b.t, o = b.o;
    burst(b, o, t, 'white', 'highpass', 1500, 0.7, 0.001, 0.04, 0.7);                     // crack
    burst(b, o, t + 0.022, 'white', 'bandpass', 2600 - 250 * tr, 1.3, 0.001, 0.05, 0.45);  // second crack
    thump(b, o, t, 120 - 15 * tr, (120 - 15 * tr) * 0.45, 0.14 + 0.04 * tr, 0.75);        // chunk
    rumble(b, o, t + 0.01, 0.02, 0.05 + 0.04 * tr, 0.3 + 0.15 * tr, 600, 140, 0.55);       // settle
    crackle(b, o, t + 0.03, 0.2 + 0.08 * tr, 6 + 2 * tr, 1900, 1.3, 0.28);                   // gravel
  }

  /** Collapse avalanche: boom, a long darkening rumble, crunch grains, and a glass shower. */
  private collapse(tier: number, h: number, x: number, z: number): void {
    const s = this.spatial(x, z);
    const tr = clampf(tier, 0, 4);
    const dur = 1.0 + 0.45 * tr + Math.min(1.4, fin(h, 10) / 70);
    const g = s.g * this.tierScale(tr);
    const b = this.voice('collapse', 3, dur + 0.6, g * (0.55 + 0.1 * tr), s.pan, 0.35);
    if (!b) return;
    const t = b.t, o = b.o;
    thump(b, o, t, 75 - 6 * tr, 30, 0.5 + 0.12 * tr, 0.9);
    burst(b, o, t, 'white', 'highpass', 1000, 0.7, 0.001, 0.06, 0.45);
    rumble(b, o, t, 0.06, dur * 0.3, dur * 0.7, 1500, 130, 0.9);
    crackle(b, o, t + 0.05, dur * 0.7, 10 + 4 * tr, 900, 1.1, 0.5);
    crackle(b, o, t + 0.1, dur * 0.6, 8 + 3 * tr, 2200, 1.5, 0.3);
    for (let i = 0; i < 2 + tr; i++) {
      const tt = t + 0.15 + Math.random() * dur * 0.55;
      thump(b, o, tt, rnd(70, 110), 40, 0.18, 0.4);
    }
    if (tr >= 1) tinkle(b, o, t + 0.08, 8 + 2 * tr, 0.9, 2400, 7500, 0.16, 0.14);
  }

  private smash(tier: number, x: number, z: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('smash', 1, 0.2, s.g * 0.4 * this.tierScale(clampf(tier, 0, 4)), s.pan, 0.05);
    if (!b) return;
    thump(b, b.o, b.t, 150, 60, 0.07, 0.9);
    burst(b, b.o, b.t, 'white', 'bandpass', 3200, 1, 0.001, 0.02, 0.5);
  }

  /** "Too big" bonk: dull knock + a little deflating blip. */
  private bump(x: number, z: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('bump', 2, 0.4, s.g * 0.45, s.pan, 0.08);
    if (!b) return;
    thump(b, b.o, b.t, 110, 70, 0.14, 0.9);
    burst(b, b.o, b.t, 'white', 'bandpass', 620, 4, 0.001, 0.08, 0.6);
    blip(b, b.o, b.t + 0.05, 'square', 420, 0.12, 0.12, 280, 0.004, 1500);
  }

  // ───────────── kit attacks ─────────────

  private titanAttack(attack: string, x: number, z: number, hits: number, now: number): void {
    const s = this.spatial(x, z);
    const H = this.H;
    switch (attack) {
      case 'curbBite': {
        if (!this.gate('bite', now)) return;
        const b = this.voice('bite', 2, 0.3, s.g * 0.6, s.pan, 0.06); if (!b) return;
        const f = clampf(260 * Math.pow(1.2 / H, 0.3), 70, 300);
        burst(b, b.o, b.t, 'white', 'bandpass', 3200, 2, 0.001, 0.018, 0.8);                 // jaw clack
        burst(b, b.o, b.t + 0.035, 'white', 'bandpass', 2200, 2, 0.001, 0.02, 0.7);
        blip(b, b.o, b.t + 0.03, 'square', f, 0.08, 0.35, f * 0.5, 0.002, 1400);            // chomp
        thump(b, b.o, b.t + 0.03, f * 0.6, f * 0.3, 0.1, 0.6);
        if (hits > 0) crackle(b, b.o, b.t + 0.04, 0.1, 5, 1600, 1.5, 0.35);
        break;
      }
      case 'forkArc': {
        if (!this.gate('arcAtk', now)) return;
        const b = this.voice('arc', 2, 0.35, s.g * 0.55, s.pan, 0.1); if (!b) return;
        this.zapInto(b, 1);
        break;
      }
      case 'magmaStomp': {
        if (!this.gate('stompWind', now)) return;
        const b = this.voice('stompWind', 1, 0.6, s.g * 0.16, s.pan, 0.08); if (!b) return;
        const o = osc(b, 'sine', 70, b.t, b.t + 0.6);
        const lfo = osc(b, 'sine', 11, b.t, b.t + 0.6); const d = gn(b, 22); wire(lfo, d); d.connect(o.frequency);
        const a = gn(b); envAHR(a.gain, b.t, 0.5, 0.12, 0.15, 0.3); wire(o, a, b.o);
        burst(b, b.o, b.t, 'brown', 'lowpass', 500, 2, 0.15, 0.35, 0.6, 900);                 // gurgle
        break;
      }
      case 'vineLash': {
        if (!this.gate('vine', now)) return;
        const b = this.voice('vine', 2, 0.35, s.g * 0.6, s.pan, 0.08); if (!b) return;
        whoosh(b, b.o, b.t, 0.13, 500, 4800, 2.5, 0.9, 'white');                              // whip
        burst(b, b.o, b.t + 0.12, 'white', 'highpass', 3000, 0.9, 0.001, 0.03, 0.9);        // crack
        burst(b, b.o, b.t + 0.13, 'white', 'bandpass', 700, 6, 0.005, 0.12, 0.35);          // creak
        break;
      }
      default: {
        if (!this.gate('vine', now)) return;
        const b = this.voice('swipe', 1, 0.25, s.g * 0.35, s.pan, 0.05); if (!b) return;
        whoosh(b, b.o, b.t, 0.18, 400, 2200, 1.5, 0.8);
      }
    }
  }

  /** Electric crackle (fork arcs, sparks). */
  private zapInto(b: B, amp: number): void {
    const t = b.t, o = b.o;
    const saw = osc(b, 'sawtooth', 90, t, t + 0.3);
    const sl = gn(b); envPerc(sl.gain, t, 0.25 * amp, 0.002, 0.22, 3);
    const hp = flt(b, 'highpass', 400);
    wire(saw, hp, sl, o);
    crackle(b, o, t, 0.24, 26, 4200, 0.8, 0.8 * amp);
    const fm = mkFM(b.ac, 1300, 0.51, 9, t, t + 0.2, 'square');
    b.srcs.push(fm.car, fm.mod);
    sweep(fm.car.frequency, t, 2400, 500, 0.16);
    const fa = gn(b); envPerc(fa.gain, t, 0.3 * amp, 0.002, 0.15, 3); wire(fm.car, fa, o);
  }

  private zap(x: number, z: number, amp: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('zap', 1, 0.3, s.g * 0.3 * amp, s.pan, 0.08); if (!b) return;
    this.zapInto(b, 0.8);
  }

  /** MOLO foot-pulse: ground whumpf ring. */
  private pulse(x: number, z: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('pulse', 2, 0.5, s.g * 0.45, s.pan, 0.15); if (!b) return;
    thump(b, b.o, b.t, 130, 38, 0.36, 1);
    burst(b, b.o, b.t, 'brown', 'lowpass', 700, 1.2, 0.01, 0.3, 0.8, 120);
    whoosh(b, b.o, b.t, 0.3, 300, 1100, 1.2, 0.25);
  }

  /** Dash whoosh, panned from start to end of the dash. */
  private dash(x0: number, z0: number, x1: number, z1: number): void {
    const s0 = this.spatial(x0, z0), s1 = this.spatial(x1, z1);
    const k = clampf(Math.pow(1.2 / this.H, 0.3), 0.3, 1);
    const b = this.voice('dash', 2, 0.45, Math.max(s0.g, s1.g) * 0.5, s0.pan, 0.12); if (!b) return;
    const p = b.pan as AudioNode & { pan?: AudioParam };
    if (p.pan) { setAt(p.pan, s0.pan, b.t); linTo(p.pan, s1.pan, b.t + 0.3); }
    whoosh(b, b.o, b.t, 0.32, 700 * k, 3600 * k, 1.8, 0.9);
    rumble(b, b.o, b.t, 0.08, 0.05, 0.2, 500 * k + 100, 180, 0.4);
    if (this.titan === 'voltkite') crackle(b, b.o, b.t + 0.02, 0.25, 10, 5000, 1, 0.3);
  }

  // ───────────── hooks ─────────────

  private hook(titan: TitanId, x: number, z: number, power: number): void {
    const s = this.spatial(x, z);
    const pw = clampf(0.85 + 0.15 * fin(power, 1), 0.7, 1.3);
    switch (titan) {
      case 'molo': {   // GULLET VACUUM — suck
        const b = this.voice('hook', 3, 1.7, s.g * 0.55 * pw, s.pan, 0.15); if (!b) return;
        const t = b.t;
        const n = nz(b, 'pink', t, t + 1.5); const bp = flt(b, 'bandpass', 220, 1.6);
        sweep(bp.frequency, t, 220, 2600, 1.2);
        const a = gn(b); envAHR(a.gain, t, 1, 0.9, 0.2, 0.25, 3); wire(n, bp, a, b.o);
        const sl = osc(b, 'sine', 60, t, t + 1.45);
        sweep(sl.frequency, t, 55, 150, 1.2);
        const lfo = osc(b, 'sine', 9, t, t + 1.45); const d = gn(b, 18); wire(lfo, d); d.connect(sl.frequency);
        const sa = gn(b); envAHR(sa.gain, t, 0.45, 0.6, 0.5, 0.25); wire(sl, sa, b.o);
        thump(b, b.o, t + 1.2, 190, 65, 0.22, 0.9);                                          // gulp
        break;
      }
      case 'voltkite': {   // RECAST: DETONATE — thunderclap
        const b = this.voice('hook', 3, 2.0, s.g * 0.75 * pw, s.pan, 0.4); if (!b) return;
        const t = b.t;
        burst(b, b.o, t, 'white', 'highpass', 1100, 0.7, 0.001, 0.07, 1);
        burst(b, b.o, t + 0.004, 'white', 'bandpass', 3000, 0.9, 0.001, 0.12, 0.6);
        rumble(b, b.o, t + 0.03, 0.1, 0.35, 1.3, 900, 110, 0.9);
        this.zapInto(b, 0.9);
        thump(b, b.o, t, 80, 35, 0.4, 0.7);
        break;
      }
      case 'hearthback': {   // SHELL VENT — eruption
        const b = this.voice('hook', 3, 1.9, s.g * 0.8 * pw, s.pan, 0.35); if (!b) return;
        const t = b.t;
        boom(b, b.o, t, 1.3, 0.8);
        rumble(b, b.o, t + 0.05, 0.15, 0.5, 0.9, 1600, 280, 0.8);                              // lava roar
        crackle(b, b.o, t + 0.1, 1.1, 30, 3200, 0.9, 0.3);                                     // sizzle
        crackle(b, b.o, t + 0.2, 0.9, 12, 700, 1.3, 0.35);                                     // rocks
        break;
      }
      case 'briarwick': {   // SOW — bloom chime
        const b = this.voice('hook', 3, 1.8, s.g * 0.5 * pw, s.pan, 0.45); if (!b) return;
        const t = b.t;
        const notes = [79, 83, 86, 91];
        notes.forEach((m, i) => bell(b, b.o, t + i * 0.085, mtof(m), 1.1, 0.4, 3.5, 1.2));
        burst(b, b.o, t, 'pink', 'bandpass', 1300, 0.9, 0.12, 0.6, 0.4);                       // spore puff
        burst(b, b.o, t + 0.02, 'white', 'bandpass', 520, 7, 0.02, 0.25, 0.3);                 // wood creak
        break;
      }
    }
  }

  /** Every live wire pops in sequence (layered under the thunderclap). */
  private wires(pts: readonly number[]): void {
    const n = Math.min(6, Math.floor(pts.length / 4));
    if (n <= 0) return;
    const mx = pts[0], mz = pts[1];
    const s = this.spatial(mx, mz);
    const b = this.voice('wires', 2, 0.35 + n * 0.05, s.g * 0.4, s.pan, 0.2); if (!b) return;
    for (let i = 0; i < n; i++) {
      const tt = b.t + i * 0.045;
      crackle(b, b.o, tt, 0.09, 8, rnd(3000, 5000), 1, 0.7);
      thump(b, b.o, tt, 200, 80, 0.07, 0.5);
    }
  }

  private ventHiss(x: number, z: number, power: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('vent', 2, 1.2, s.g * 0.35 * clampf(0.6 + fin(power, 0.5), 0.6, 1.6), s.pan, 0.2); if (!b) return;
    burst(b, b.o, b.t, 'white', 'highpass', 2500, 0.8, 0.05, 0.9, 0.7, 5000, 2.2);
  }

  private sprout(x: number, z: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('sprout', 1, 0.35, s.g * 0.45, s.pan, 0.2); if (!b) return;
    blip(b, b.o, b.t, 'triangle', 520, 0.12, 0.8, 800);
    blip(b, b.o, b.t + 0.07, 'sine', 1040, 0.15, 0.4, 1300);
    burst(b, b.o, b.t, 'pink', 'bandpass', 1500, 2, 0.002, 0.05, 0.4);
  }

  private sporePuff(x: number, z: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('spore', 1, 0.7, s.g * 0.4, s.pan, 0.3); if (!b) return;
    burst(b, b.o, b.t, 'pink', 'bandpass', 1200, 0.9, 0.08, 0.45, 0.8);
    bell(b, b.o, b.t + 0.05, mtof(98), 0.4, 0.2, 2, 0.6);
    bell(b, b.o, b.t + 0.12, mtof(103), 0.4, 0.15, 2, 0.6);
  }

  // ───────────── enemies ─────────────

  private enemyHit(x: number, z: number, crit: boolean): void {
    const s = this.spatial(x, z);
    const b = this.voice(crit ? 'crit' : 'hit', 0, 0.2, s.g * (crit ? 0.42 : 0.4), s.pan, 0.04); if (!b) return;
    if (crit) {
      clang(b, b.o, b.t, 2100, 3.01, 1.2, 0.16, 0.7);
      burst(b, b.o, b.t, 'white', 'highpass', 4000, 0.7, 0.001, 0.02, 0.5);
    } else {
      blip(b, b.o, b.t, 'triangle', rnd(820, 980), 0.03, 0.6, 600);
      burst(b, b.o, b.t, 'white', 'bandpass', 2500, 1.2, 0.001, 0.015, 0.6);
    }
  }

  private enemyKilled(kind: EnemyKind, crushed: boolean, x: number, z: number, now: number): void {
    const s = this.spatial(x, z);
    if (crushed) {
      if (!this.gate('crush', now)) return;
      // "clank-boing": a stamped tin clank and a sprung coil
      const b = this.voice('crush', 1, 0.5, s.g * 0.42, s.pan, 0.06); if (!b) return;
      clang(b, b.o, b.t, rnd(480, 560), 2.76, 4, 0.12, 0.8);
      burst(b, b.o, b.t, 'white', 'bandpass', 1800, 1.2, 0.001, 0.03, 0.5);
      spring(b, b.o, b.t + 0.05, rnd(360, 420), 0.38, 0.45);
      return;
    }
    switch (kind) {
      case 'android': case 'squad': {
        if (!this.gate('pop', now)) return;
        const b = this.voice('pop', 1, 0.35, s.g * 0.55, s.pan, 0.06); if (!b) return;
        blip(b, b.o, b.t, 'square', 180, 0.04, 0.3, 120, 0.002, 2000);          // bzt
        blip(b, b.o, b.t + 0.02, 'sine', 700, 0.04, 0.7, 180);                  // pop
        burst(b, b.o, b.t + 0.02, 'pink', 'lowpass', 1200, 1, 0.003, 0.08, 0.4); // puff
        tinkle(b, b.o, b.t + 0.04, 3, 0.15, 1800, 3200, 0.25, 0.06);            // bolts
        spring(b, b.o, b.t + 0.05, 600, 0.15, 0.15, 28);
        return;
      }
      case 'drone': {
        if (!this.gate('pop', now)) return;
        const b = this.voice('pop', 1, 0.4, s.g * 0.5, s.pan, 0.06); if (!b) return;
        blip(b, b.o, b.t, 'sawtooth', 260, 0.22, 0.25, 50, 0.002, 1800);         // rotor spin-down
        blip(b, b.o, b.t + 0.05, 'sine', 800, 0.05, 0.6, 200);
        burst(b, b.o, b.t + 0.05, 'pink', 'lowpass', 1500, 1, 0.003, 0.12, 0.4);
        return;
      }
      default: {
        if (!this.gate('bigKill', now)) return;
        const size = kind === 'buggy' ? 0.5 : kind === 'apc' ? 0.8 : kind === 'tank' ? 1.0 : kind === 'walker' ? 1.2 : 1.5;
        const b = this.voice('bigKill', 2, 0.9 + size * 0.6, s.g * (0.4 + 0.25 * size), s.pan, 0.25); if (!b) return;
        boom(b, b.o, b.t, size, 0.85);
        clang(b, b.o, b.t + 0.02, rnd(150, 220) / size, 1.41, 5, 0.4 + 0.2 * size, 0.35);
        if (kind === 'walker') {
          // creaky topple, then the crash
          const o = osc(b, 'sawtooth', 70, b.t + 0.1, b.t + 0.8);
          sweep(o.frequency, b.t + 0.1, 70, 40, 0.6);
          const bp = flt(b, 'bandpass', 380, 5); const a = gn(b); envAHR(a.gain, b.t + 0.1, 0.35, 0.1, 0.35, 0.3);
          wire(o, bp, a, b.o);
          thump(b, b.o, b.t + 0.75, 90, 35, 0.35, 0.8);
          crackle(b, b.o, b.t + 0.75, 0.4, 12, 1500, 1.2, 0.35);
        }
        if (kind === 'elite') spring(b, b.o, b.t + 0.3, 300, 0.5, 0.25, 16);
      }
    }
  }

  /** Enemy weapons, escalating from toy "pew" to tank boom. */
  private enemyFire(kind: EnemyKind, x: number, z: number): void {
    const s = this.spatial(x, z);
    switch (kind) {
      case 'android': {
        const b = this.voice('pew', 1, 0.15, s.g * 0.55, s.pan, 0.05); if (!b) return;
        blip(b, b.o, b.t, 'square', 1500, 0.09, 0.5, 420, 0.002, 3500);
        return;
      }
      case 'squad': {
        const b = this.voice('pew', 1, 0.14, s.g * 0.48, s.pan, 0.05); if (!b) return;
        blip(b, b.o, b.t, 'triangle', rnd(1050, 1180), 0.08, 0.7, 380, 0.002);
        blip(b, b.o, b.t, 'square', 2200, 0.02, 0.15, 900, 0.001, 4000);
        return;
      }
      case 'apc': {
        const b = this.voice('pew', 1, 0.14, s.g * 0.55, s.pan, 0.06); if (!b) return;
        blip(b, b.o, b.t, 'square', 700, 0.06, 0.5, 300, 0.002, 2200);
        burst(b, b.o, b.t, 'white', 'bandpass', 1800, 1.2, 0.001, 0.02, 0.4);
        return;
      }
      case 'drone': {   // dive whine: doppler fall + rotor buzz
        const b = this.voice('dive', 1, 0.7, s.g * 0.28, s.pan, 0.08); if (!b) return;
        blip(b, b.o, b.t, 'sine', 2200, 0.6, 0.35, 700, 0.1);
        const buzz = osc(b, 'sawtooth', 115, b.t, b.t + 0.65);
        const am = osc(b, 'square', 38, b.t, b.t + 0.65); const amg = gn(b, 0.5); wire(am, amg);
        const vca = gn(b, 0.5); amg.connect(vca.gain);
        const a = gn(b); envAHR(a.gain, b.t, 0.25, 0.05, 0.3, 0.25);
        wire(buzz, flt(b, 'lowpass', 1400), vca, a, b.o);
        return;
      }
      case 'buggy': {   // rocket hiss
        const b = this.voice('rocket', 2, 0.7, s.g * 0.35, s.pan, 0.12); if (!b) return;
        thump(b, b.o, b.t, 160, 80, 0.08, 0.5);
        whoosh(b, b.o, b.t, 0.55, 2400, 900, 1.3, 0.8, 'white');
        blip(b, b.o, b.t + 0.02, 'sine', 1500, 0.5, 0.12, 950, 0.05);
        return;
      }
      case 'tank': {   // tank boom
        const b = this.voice('cannon', 2, 1.2, s.g * 0.6, s.pan, 0.35); if (!b) return;
        burst(b, b.o, b.t, 'white', 'highpass', 700, 0.7, 0.001, 0.06, 0.9);
        thump(b, b.o, b.t, 110, 38, 0.45, 1);
        burst(b, b.o, b.t, 'brown', 'lowpass', 2200, 0.8, 0.003, 0.7, 0.9, 150, 3);
        return;
      }
      case 'walker': {   // mortar thunk + rising whistle
        const b = this.voice('mortar', 2, 0.8, s.g * 0.45, s.pan, 0.2); if (!b) return;
        thump(b, b.o, b.t, 190, 110, 0.12, 0.9);
        burst(b, b.o, b.t, 'white', 'bandpass', 420, 5, 0.002, 0.1, 0.8);
        blip(b, b.o, b.t + 0.08, 'sine', 650, 0.55, 0.1, 1450, 0.2);
        return;
      }
      case 'elite': {   // RAMROD charge: diesel rev + warning horn
        const b = this.voice('ram', 3, 1.3, s.g * 0.42, s.pan, 0.15); if (!b) return;
        const o = osc(b, 'sawtooth', 50, b.t, b.t + 1.2);
        sweep(o.frequency, b.t, 48, 105, 0.9);
        const a = gn(b); envAHR(a.gain, b.t, 0.22, 0.1, 0.7, 0.35);
        wire(o, mkGrit(b.ac, 0.6), flt(b, 'lowpass', 900), a, b.o);
        this.horn(b, b.t + 0.05, 0.6, 0.35);
        return;
      }
    }
  }

  /** Dissonant truck horn (RAMROD). */
  private horn(b: B, t: number, dur: number, amp: number): void {
    const bus = flt(b, 'lowpass', 1900, 1.2);
    const a = gn(b); envAHR(a.gain, t, amp, 0.03, dur * 0.8, dur * 0.2); wire(bus, a, b.o);
    for (const f of [147, 185, 220]) { const o = osc(b, 'sawtooth', f, t, t + dur + 0.05); const g = gn(b, 0.3); wire(o, g, bus); }
  }

  // ───────────── titan hurt / heal / pickups / progression ─────────────

  private titanHurt(dmg: number, src: string, now: number): void {
    const frac = clampf(fin(dmg, 0) / this.maxHp, 0, 1);
    const big = frac > 0.08;
    if (!big && !this.gate('hurt', now)) return;
    const tv = TITAN_VOICE[this.titan] ?? TITAN_VOICE.molo;
    const heavyHit = src === 'rocket' || src === 'shell' || src === 'mortar' || src === 'ram' || src === 'slam' || src === 'hook' || src === 'plate';
    if (frac < 0.004) {
      // a DoT nibble: a small impact only, no grunt
      const b = this.voice('hurt', 1, 0.2, 0.4, 0, 0.02); if (!b) return;
      burst(b, b.o, b.t, 'white', 'bandpass', 1500, 1, 0.001, 0.06, 0.8);
      blip(b, b.o, b.t, 'triangle', 240, 0.05, 0.35, 170);
      return;
    }
    const dur = 0.22 + 0.25 * Math.min(1, frac * 8);
    const b = this.voice('hurt', 3, dur + 0.25, 0.35 + 0.4 * Math.min(1, frac * 6), 0, 0.1); if (!b) return;
    const f0 = clampf(230 * Math.pow(1.2 / this.H, 0.28) * tv.mul, 50, 420);
    creature(b, b.o, b.t + 0.02, dur, [[0, f0 * 1.15], [dur * 0.25, f0 * 1.3], [dur, f0 * 0.75]], tv.vowel, 0.55,
      { growl: tv.growl, fscale: clampf(Math.pow(1.2 / this.H, 0.07), 0.7, 1), breath: 0.35, grit: 0.35 });
    if (heavyHit) { thump(b, b.o, b.t, 90, 40, 0.25, 0.8); burst(b, b.o, b.t, 'brown', 'lowpass', 1800, 0.8, 0.002, 0.25, 0.6, 200); }
    else if (src === 'bullet') { blip(b, b.o, b.t, 'sine', 2600, 0.09, 0.25, 1700); }
    else if (src === 'breath') { burst(b, b.o, b.t, 'white', 'highpass', 3000, 0.7, 0.03, 0.3, 0.4); }
    else burst(b, b.o, b.t, 'white', 'bandpass', 1400, 1, 0.001, 0.05, 0.5);
    if (this.titan === 'voltkite') crackle(b, b.o, b.t + 0.03, 0.15, 8, 5000, 1, 0.25);
    if (this.titan === 'briarwick') burst(b, b.o, b.t + 0.02, 'white', 'bandpass', 600, 8, 0.01, 0.15, 0.3);
  }

  private titanHeal(amount: number, now: number): void {
    if (now - this.healT > 2) this.healAcc = 0;
    this.healAcc += Math.max(0, fin(amount, 0));
    this.healT = now;
    if (this.healAcc < this.maxHp * 0.04) return;
    if (!this.gate('heal', now)) return;
    this.healAcc = 0;
    const b = this.voice('heal', 1, 0.7, 0.2, 0, 0.3); if (!b) return;
    [0, 4, 7].forEach((st, i) => blip(b, b.o, b.t + i * 0.06, 'sine', mtof(84 + st), 0.3, 0.45, 0, 0.01));
    burst(b, b.o, b.t, 'white', 'highpass', 7000, 0.7, 0.05, 0.35, 0.15);
  }

  private healChime(x: number, z: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('heal', 2, 0.6, Math.max(0.5, s.g) * 0.3, s.pan, 0.25); if (!b) return;
    bell(b, b.o, b.t, mtof(84), 0.5, 0.5, 2, 0.7);
    bell(b, b.o, b.t + 0.08, mtof(91), 0.5, 0.45, 2, 0.7);
  }

  /** Pickup ticks: rate-limited, pitch climbs a pentatonic ladder with the combo. */
  private pickupTicks(n: number, scrap: boolean, x: number, z: number): void {
    const ac = this.eng.ac; if (!ac) return;
    const now = ac.currentTime;
    if (now - this.comboT > 0.7) this.combo = 0;
    this.combo += n;
    this.comboT = now;
    if (!this.gate('tick', now)) return;
    const s = this.spatial(x, z);
    const idx = Math.min(PENTA.length - 1, Math.floor(Math.log2(1 + this.combo) * 2.2));
    const f = mtof((scrap ? 81 : 76) + PENTA[idx]);
    const b = this.voice('tick', 0, 0.12, Math.max(0.6, s.g) * clampf(0.26 + 0.04 * Math.log2(1 + n), 0.26, 0.42), s.pan * 0.5, 0.05);
    if (!b) return;
    blip(b, b.o, b.t, 'sine', f, 0.05, 0.8, f * 1.02, 0.002);
    blip(b, b.o, b.t, scrap ? 'square' : 'triangle', f * 2, 0.025, 0.18, 0, 0.001, 6000);
  }

  private sparkle(x: number, z: number, amp: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('chest', 3, 1.2, Math.max(0.5, s.g) * 0.4 * amp, s.pan, 0.35); if (!b) return;
    const notes = [72, 76, 79, 84, 88, 91];
    notes.forEach((m, i) => bell(b, b.o, b.t + i * 0.055, mtof(m), 0.6, 0.35, 3.01, 1));
    burst(b, b.o, b.t, 'white', 'highpass', 6500, 0.7, 0.1, 0.5, 0.2);
  }

  private levelChime(): void {
    const b = this.voice('level', 3, 1.3, 0.42, 0, 0.35); if (!b) return;
    const notes = [76, 80, 83, 88];
    notes.forEach((m, i) => bell(b, b.o, b.t + i * 0.07, mtof(m), 0.9, 0.4, 3.5, 1.1));
    blip(b, b.o, b.t + 0.28, 'triangle', mtof(88), 0.5, 0.25, 0, 0.01);
    burst(b, b.o, b.t + 0.05, 'white', 'highpass', 8000, 0.7, 0.2, 0.5, 0.18);
  }

  /** MASS BREACH: brass stab pair + timpani, then the monster roar (pitch drops with rank). */
  private massBreach(rank: number): void {
    const r = clampf(rank, 0, 4);
    const tv = TITAN_VOICE[this.titan] ?? TITAN_VOICE.molo;
    const roarDur = 1.3 + 0.28 * r;
    const b = this.voice('rank', 4, 0.4 + roarDur + 0.6, 0.85, 0, 0.3); if (!b) return;
    this.eng.duck(STING_DUCK.breach[0], STING_DUCK.breach[1] + 0.2 * r, STING_DUCK.breach[2]);
    const t = b.t;
    const root = 50;   // D
    brass(b, b.o, t, [root, root + 7, root + 12, root + 15], 0.14, 0.55, 1);
    brass(b, b.o, t + 0.18, [root + 1, root + 8, root + 13, root + 17], 0.55, 0.6, 1.1);
    thump(b, b.o, t + 0.18, 110, 55, 0.5, 0.7);
    burst(b, b.o, t + 0.18, 'white', 'highpass', 5000, 0.7, 0.3, 0.5, 0.18);
    const f0 = [150, 112, 84, 63, 48][r] * tv.mul;
    const fs = [1, 0.92, 0.84, 0.76, 0.68][r];
    const rt = t + 0.45;
    creature(b, b.o, rt, roarDur, [[0, f0 * 0.8], [0.18, f0 * 1.15], [roarDur * 0.6, f0], [roarDur, f0 * 0.62]], 'a', 0.9,
      { growl: 0.25 + tv.growl * 0.5, growlHz: 30 - 3 * r, breath: 0.55, fscale: fs, grit: 0.55, vib: 0.03 });
    rumble(b, b.o, rt, 0.2, roarDur * 0.4, roarDur * 0.5, 400 - 50 * r, 80, 0.35 + 0.08 * r);
  }

  // ───────────── telegraphs, impacts, explosions ─────────────

  /** Warning beeps by telegraph style (shape-coded, like the paint). Boss tells are lower and longer. */
  private warn(w: World, id: number, style: TelegraphStyle, boss: boolean): void {
    let x = this.camX, z = this.camZ;
    for (const tg of w.telegraphs) if (tg.id === id) { const c = shapeCenter(tg.shape); x = c.x; z = c.z; break; }
    const s = this.spatial(x, z);
    const g = Math.max(0.55, s.g) * (boss ? 0.42 : 0.26);
    const k = boss ? 0.5 : 1;
    const b = this.voice('warn', 2, boss ? 0.8 : 0.45, g, s.pan * 0.6, 0.12); if (!b) return;
    const t = b.t;
    switch (style) {
      case 'circle': beep(b, b.o, t, 'square', 1760 * k, 0.07, 0.35, 5000); beep(b, b.o, t, 'sine', 1760 * k, 0.12, 0.3); break;
      case 'cone': beep(b, b.o, t, 'square', 880 * k, 0.08, 0.35); beep(b, b.o, t + 0.1, 'square', 1175 * k, 0.12, 0.35); break;
      case 'lane': for (let i = 0; i < 3; i++) beep(b, b.o, t + i * 0.075, 'square', 1320 * k, 0.045, 0.35, 5000); break;
      case 'ring': beep(b, b.o, t, 'triangle', 440 * k, 0.11, 0.6); beep(b, b.o, t + 0.16, 'triangle', 440 * k, 0.11, 0.6); break;
      case 'oval': {
        const o = osc(b, 'sine', 700 * k, t, t + 0.32);
        const lfo = osc(b, 'sine', 14, t, t + 0.32); const d = gn(b, 90 * k); wire(lfo, d); d.connect(o.frequency);
        const a = gn(b); envAHR(a.gain, t, 0.6, 0.02, 0.2, 0.08); wire(o, a, b.o);
        break;
      }
      case 'chain': crackle(b, b.o, t, 0.25, 8, 2000 * k, 2, 1, true); beep(b, b.o, t, 'square', 990 * k, 0.06, 0.5); beep(b, b.o, t + 0.2, 'square', 990 * k, 0.06, 0.5); break;
    }
    if (boss) thump(b, b.o, t, 70, 55, 0.5, 0.35);
  }

  /** Hostile telegraph lands (shells, dives, slams, hooks). Lobbed shots are voiced by their explosion. */
  private telegraphImpact(w: World, id: number, x: number, z: number, boss: boolean, now: number): void {
    let kind = 'generic', tag = '', size = 4;
    for (const tg of w.telegraphs) if (tg.id === id) {
      kind = tg.kind; tag = tg.tag;
      const sh = tg.shape;
      size = sh.k === 'circle' ? sh.r : sh.k === 'ring' ? sh.r1 : sh.k === 'cone' ? sh.r * 0.4 : sh.k === 'lane' ? sh.w : sh.k === 'oval' ? sh.rx : sh.r;
      break;
    }
    if (tag.startsWith('lob:')) return;
    if (!this.gate('impact', now)) return;
    const s = this.spatial(x, z);
    const big = boss ? 1.4 : clampf(size / 8, 0.4, 1.2);
    switch (kind) {
      case 'dive': {
        const b = this.voice('impact', 1, 0.4, s.g * 0.35, s.pan, 0.08); if (!b) return;
        boom(b, b.o, b.t, 0.3, 0.7); blip(b, b.o, b.t, 'sawtooth', 300, 0.1, 0.2, 60, 0.002, 1500);
        return;
      }
      case 'breath': {
        const b = this.voice('impact', 3, 1.6, s.g * 0.6, s.pan, 0.3); if (!b) return;
        whoosh(b, b.o, b.t, 1.3, 3500, 1200, 0.8, 0.9, 'white');
        creature(b, b.o, b.t, 1.2, [[0, 70], [0.6, 80], [1.2, 55]], 'a', 0.45, { growl: 0.4, breath: 0.9, fscale: 0.7 });
        return;
      }
      case 'hook': {
        const b = this.voice('impact', 3, 1.0, s.g * 0.65, s.pan, 0.3); if (!b) return;
        boom(b, b.o, b.t, 1.0, 0.7);
        clang(b, b.o, b.t, 95, 1.41, 6, 0.8, 0.5);
        crackle(b, b.o, b.t + 0.05, 0.4, 14, 3000, 2, 0.35, true);            // chain rattle
        return;
      }
      default: {
        const b = this.voice('impact', boss ? 3 : 2, 0.9 + 0.4 * big, s.g * (0.4 + 0.2 * big), s.pan, 0.28); if (!b) return;
        boom(b, b.o, b.t, big, 0.85);
        if (kind === 'slam' || kind === 'ram') crackle(b, b.o, b.t + 0.04, 0.5, 14, 900, 1.2, 0.4);
      }
    }
  }

  private projectileHit(kind: ProjectileKind, x: number, z: number): void {
    const s = this.spatial(x, z);
    switch (kind) {
      case 'pellet': case 'volley': {
        const b = this.voice('pj', 0, 0.12, s.g * 0.42, s.pan, 0.03); if (!b) return;
        burst(b, b.o, b.t, 'white', 'bandpass', 2000, 1.2, 0.001, 0.035, 0.8);
        blip(b, b.o, b.t, 'sine', 900, 0.03, 0.3, 500);
        return;
      }
      case 'seed': {
        const b = this.voice('pj', 0, 0.15, s.g * 0.36, s.pan, 0.05); if (!b) return;
        blip(b, b.o, b.t, 'sine', 500, 0.06, 0.7, 200); burst(b, b.o, b.t, 'pink', 'bandpass', 1200, 1.5, 0.002, 0.05, 0.5);
        return;
      }
      case 'spark': {
        const b = this.voice('pj', 0, 0.15, s.g * 0.36, s.pan, 0.05); if (!b) return;
        crackle(b, b.o, b.t, 0.08, 7, 4500, 1, 0.8);
        return;
      }
      default: {
        const b = this.voice('pj', 1, 0.3, s.g * 0.28, s.pan, 0.08); if (!b) return;
        thump(b, b.o, b.t, 140, 60, 0.12, 0.8); burst(b, b.o, b.t, 'brown', 'lowpass', 1400, 0.8, 0.002, 0.15, 0.6);
      }
    }
  }

  private explosion(kind: DamageKind, r: number, x: number, z: number, now: number): void {
    const s = this.spatial(x, z);
    switch (kind) {
      case 'stomp': {   // HEARTHBACK magma whoomp
        if (!this.gate('magma', now)) return;
        const b = this.voice('magma', 2, 0.9, s.g * 0.55, s.pan, 0.2); if (!b) return;
        thump(b, b.o, b.t, 95, 34, 0.45, 1);
        burst(b, b.o, b.t, 'brown', 'lowpass', 500, 1.2, 0.06, 0.5, 1, 1400, 2.5);            // whoomp swell
        crackle(b, b.o, b.t + 0.05, 0.45, 18, 3300, 0.9, 0.35);                                  // sizzle
        return;
      }
      case 'arc': {
        if (!this.gate('zap', now)) return;
        const b = this.voice('zap', 2, 0.4, s.g * 0.45, s.pan, 0.15); if (!b) return;
        this.zapInto(b, 1);
        thump(b, b.o, b.t, 120, 50, 0.15, 0.5);
        return;
      }
      case 'shockwave': {
        if (!this.gate('pulse', now)) return;
        const b = this.voice('shock', 2, 0.5, s.g * 0.4, s.pan, 0.15); if (!b) return;
        thump(b, b.o, b.t, 110, 40, 0.3, 1);
        burst(b, b.o, b.t, 'brown', 'lowpass', 900, 1, 0.005, 0.3, 0.7, 150);
        return;
      }
      case 'plate': {   // IRON GULLY scrap plate crash
        if (!this.gate('boom', now)) return;
        const b = this.voice('boom', 2, 0.9, s.g * 0.5, s.pan, 0.25); if (!b) return;
        clang(b, b.o, b.t, rnd(90, 130), 1.73, 6, 0.7, 0.6);
        clang(b, b.o, b.t + 0.03, rnd(230, 300), 2.41, 4, 0.4, 0.35);
        boom(b, b.o, b.t, 0.6, 0.6);
        return;
      }
      case 'seed': case 'rubble': case 'spark': {
        if (!this.gate('pjHit', now)) return;
        const b = this.voice('pj', 1, 0.3, s.g * 0.25, s.pan, 0.08); if (!b) return;
        boom(b, b.o, b.t, 0.25, 0.6);
        return;
      }
      default: {   // rocket / mortar / shell / generic
        if (!this.gate('boom', now)) return;
        const size = kind === 'mortar' ? 0.95 : kind === 'shell' ? 1.0 : kind === 'rocket' ? 0.6 : clampf(fin(r, 4) / 8, 0.3, 1.2);
        const b = this.voice('boom', 2, 0.9 + 0.6 * size, s.g * (0.35 + 0.25 * size), s.pan, 0.3); if (!b) return;
        boom(b, b.o, b.t, size, 0.9);
      }
    }
  }

  // ───────────── broadcast / alerts ─────────────

  private alert(key: AlertKey, now: number): void {
    switch (key) {
      case 'boss': if (this.gate('siren', now)) this.bossSiren(); return;
      case 'bossPhase2': if (this.gate('phase', now)) this.phaseSting(2); return;
      case 'bossPhase3': if (this.gate('phase', now)) this.phaseSting(3); return;
      case 'lowHp': if (this.gate('lowHp', now)) this.lowHp(); return;
      case 'chest': if (this.gate('chest', now)) this.sparkle(this.camX, this.camZ, 0.9); return;
      case 'elite': if (this.gate('alert', now)) { this.newsJingle(true); } return;
      default: if (this.gate('alert', now)) this.newsJingle(false);
    }
  }

  /** WARD-7 news-desk alert jingle (original 4-note figure + a low button). */
  private newsJingle(urgent: boolean): void {
    const b = this.voice('alert', 4, 1.4, 0.38, 0, 0.3); if (!b) return;
    const t = b.t;
    const base = urgent ? 74 : 72;
    const fig = urgent ? [0, 6, 0, 6] : [0, 7, 3, 12];
    fig.forEach((st, i) => {
      bell(b, b.o, t + i * 0.12, mtof(base + st), 0.5, 0.4, 2.0, 0.9);
      beep(b, b.o, t + i * 0.12, 'square', mtof(base + st), 0.09, 0.08, 2500);
    });
    thump(b, b.o, t + 0.5, mtof(base - 24), mtof(base - 24) * 0.9, 0.5, 0.45, 'triangle');
    if (urgent) for (let i = 0; i < 3; i++) { beep(b, b.o, t + 0.62 + i * 0.2, 'square', 520, 0.09, 0.14, 1800); beep(b, b.o, t + 0.72 + i * 0.2, 'square', 390, 0.09, 0.14, 1800); }
  }

  private lowHp(): void {
    const b = this.voice('lowHp', 3, 1.1, 0.45, 0, 0.05); if (!b) return;
    thump(b, b.o, b.t, 70, 45, 0.16, 1); thump(b, b.o, b.t + 0.2, 64, 42, 0.2, 0.8);    // heartbeat
    beep(b, b.o, b.t + 0.5, 'square', 880, 0.12, 0.12, 2000); beep(b, b.o, b.t + 0.7, 'square', 880, 0.12, 0.12, 2000);
  }

  private eliteHorn(): void {
    const b = this.voice('elite', 4, 1.6, 0.55, 0, 0.3); if (!b) return;
    this.horn(b, b.t, 0.55, 0.45);
    this.horn(b, b.t + 0.7, 0.75, 0.45);
    rumble(b, b.o, b.t, 0.2, 0.9, 0.4, 250, 120, 0.4);
  }

  private bossSiren(): void {
    const b = this.voice('siren', 4, 3.8, 0.45, 0, 0.35); if (!b) return;
    this.eng.duck(STING_DUCK.siren[0], STING_DUCK.siren[1], STING_DUCK.siren[2]);
    siren(b, b.o, b.t, 3.4, 190, 640, 0.55);
    rumble(b, b.o, b.t, 0.8, 1.6, 1.2, 180, 60, 0.35);
  }

  private phaseSting(phase: number): void {
    const b = this.voice('phase', 4, 1.8, 0.6, 0, 0.35); if (!b) return;
    this.eng.duck(STING_DUCK.phase[0], STING_DUCK.phase[1], STING_DUCK.phase[2]);
    const t = b.t;
    burst(b, b.o, t, 'white', 'highpass', 2500, 0.7, 0.38, 0.02, 0.3, 7000, 1);    // reverse swell
    const root = phase >= 3 ? 48 : 45;
    brass(b, b.o, t + 0.4, [root, root + 3, root + 7, root + 12], 0.9, 0.65, 1.1);
    thump(b, b.o, t + 0.4, 98, 60, 0.7, 0.9);                                           // timpani
    burst(b, b.o, t + 0.4, 'brown', 'lowpass', 900, 0.9, 0.004, 0.5, 0.45, 150);
  }

  // ───────────── boss ─────────────

  private bossAttack(attack: string, x: number, z: number): void {
    const s = this.spatial(x, z);
    const g = Math.max(0.5, s.g);
    switch (attack) {
      case 'hookLane': {   // winch ratchet + cable whine
        const b = this.voice('bossAtk', 3, 1.0, g * 0.75, s.pan, 0.25); if (!b) return;
        crackle(b, b.o, b.t, 0.75, 14, 2500, 2, 1, true);
        const o = osc(b, 'sawtooth', 300, b.t, b.t + 0.9); sweep(o.frequency, b.t, 320, 170, 0.8);
        const a = gn(b); envAHR(a.gain, b.t, 0.5, 0.05, 0.5, 0.3); wire(o, flt(b, 'bandpass', 700, 3), a, b.o);
        return;
      }
      case 'hookDrop': {   // cable release — the falling whistle
        const b = this.voice('bossAtk', 3, 1.4, g * 0.4, s.pan, 0.25); if (!b) return;
        blip(b, b.o, b.t, 'sine', 1800, 1.2, 0.35, 300, 0.1);
        crackle(b, b.o, b.t, 0.5, 10, 3200, 2, 0.5, true);
        return;
      }
      case 'winchLeash': {   // motor whine
        const b = this.voice('bossAtk', 3, 1.7, g * 0.22, s.pan, 0.2); if (!b) return;
        const o = osc(b, 'sawtooth', 90, b.t, b.t + 1.6); sweep(o.frequency, b.t, 90, 250, 1.4);
        const a = gn(b); envAHR(a.gain, b.t, 0.4, 0.2, 0.9, 0.4);
        wire(o, mkGrit(b.ac, 0.5), flt(b, 'lowpass', 1600), a, b.o);
        return;
      }
      case 'boomSweep': {   // hydraulic groan + hiss + whoosh
        const b = this.voice('bossAtk', 3, 1.6, g * 0.75, s.pan, 0.3); if (!b) return;
        this.metalGroan(b, b.t, 1.2, 62, 45, 0.5);
        burst(b, b.o, b.t, 'white', 'highpass', 2800, 0.7, 0.05, 0.5, 0.35);
        whoosh(b, b.o, b.t + 0.6, 0.8, 300, 1200, 1, 0.5);
        return;
      }
      case 'legStomp': {   // hydraulic hiss + servo rising
        const b = this.voice('bossAtk', 3, 1.3, g * 0.65, s.pan, 0.25); if (!b) return;
        burst(b, b.o, b.t, 'white', 'highpass', 3000, 0.7, 0.02, 0.45, 0.6);
        const o = osc(b, 'square', 120, b.t, b.t + 1.1); sweep(o.frequency, b.t, 120, 340, 1.0);
        const a = gn(b); envAHR(a.gain, b.t, 0.15, 0.1, 0.7, 0.2); wire(o, flt(b, 'lowpass', 900), a, b.o);
        return;
      }
      case 'coneBreath': {   // the inhale (the breath itself lands on telegraphFire)
        const b = this.voice('bossAtk', 3, 1.8, g * 0.5, s.pan, 0.3); if (!b) return;
        whoosh(b, b.o, b.t, 1.6, 250, 1600, 1.4, 0.8);
        creature(b, b.o, b.t + 0.2, 1.2, [[0, 55], [1.2, 70]], 'u', 0.3, { growl: 0.3, breath: 1.0, fscale: 0.65 });
        return;
      }
      case 'pawSlam': case 'ridgeCharge': case 'breathSlam': {
        const dur = attack === 'pawSlam' ? 0.9 : 1.3;
        const b = this.voice('bossAtk', 3, dur + 0.4, g * 0.6, s.pan, 0.35); if (!b) return;
        creature(b, b.o, b.t, dur, [[0, 60], [0.15, 82], [dur, 50]], 'a', 0.85, { growl: 0.45, growlHz: 24, breath: 0.6, fscale: 0.62, grit: 0.6 });
        if (attack === 'ridgeCharge') rumble(b, b.o, b.t + 0.2, 0.3, 0.6, 0.5, 300, 100, 0.5);
        return;
      }
      case 'plateVolley': {   // plates tear loose
        const b = this.voice('bossAtk', 3, 1.0, g * 0.45, s.pan, 0.3); if (!b) return;
        for (let i = 0; i < 5; i++) clang(b, b.o, b.t + i * 0.07, rnd(160, 320), rnd(1.3, 2.6), 5, 0.4, 0.4);
        return;
      }
      default: {
        const b = this.voice('bossAtk', 3, 1.2, g * 0.45, s.pan, 0.3); if (!b) return;
        if (this.bossId === 'irongully') creature(b, b.o, b.t, 0.9, [[0, 65], [0.2, 80], [0.9, 50]], 'o', 0.7, { growl: 0.4, fscale: 0.65 });
        else this.horn(b, b.t, 0.6, 0.4);
      }
    }
  }

  /** Straining steel: a low saw with an FM creak through a resonant band + grit. */
  private metalGroan(b: B, t: number, dur: number, f0: number, f1: number, amp: number): void {
    const o = osc(b, 'sawtooth', f0, t, t + dur + 0.05);
    sweep(o.frequency, t, f0, f1, dur);
    const creak = osc(b, 'sine', 7, t, t + dur + 0.05); const cd = gn(b, f0 * 0.25); wire(creak, cd); cd.connect(o.frequency);
    const bp = flt(b, 'bandpass', 320, 4);
    const a = gn(b); envAHR(a.gain, t, amp, dur * 0.15, dur * 0.45, dur * 0.4);
    wire(o, mkGrit(b.ac, 0.5), bp, a, b.o);
  }

  private bossHit(part: string, x: number, z: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('bossHit', 1, 0.5, Math.max(0.4, s.g) * 0.3, s.pan, 0.2); if (!b) return;
    if (this.bossId === 'irongully') {
      thump(b, b.o, b.t, 120, 55, 0.18, 0.8);
      if (part === 'sail') clang(b, b.o, b.t, rnd(200, 280), 2.41, 5, 0.35, 0.5);
      else burst(b, b.o, b.t, 'white', 'bandpass', part === 'head' ? 1400 : 700, 1.5, 0.001, 0.06, 0.6);
    } else {
      const leg = part.startsWith('leg');
      clang(b, b.o, b.t, leg ? rnd(140, 190) : rnd(230, 320), 1.41, 5, 0.35, 0.7);
      burst(b, b.o, b.t, 'white', 'bandpass', 2500, 1, 0.001, 0.03, 0.45);
    }
  }

  private stagger(): void {
    const b = this.voice('stagger', 4, 2.2, 0.6, 0, 0.35); if (!b) return;
    if (this.bossId === 'irongully') {
      creature(b, b.o, b.t, 1.7, [[0, 95], [0.3, 88], [1.7, 52]], 'o', 0.85, { growl: 0.5, growlHz: 18, breath: 0.4, fscale: 0.62 });
    } else {
      this.metalGroan(b, b.t, 1.8, 58, 36, 0.8);
      burst(b, b.o, b.t + 1.2, 'white', 'highpass', 2400, 0.7, 0.05, 0.6, 0.4);   // hydraulic release
    }
  }

  private bossDown(x: number, z: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('bossDown', 4, 4.2, Math.max(0.6, s.g) * 0.8, s.pan, 0.45); if (!b) return;
    this.eng.duck(STING_DUCK.bossDown[0], STING_DUCK.bossDown[1], STING_DUCK.bossDown[2]);
    const t = b.t;
    if (this.bossId === 'irongully') {
      creature(b, b.o, t, 2.2, [[0, 90], [0.3, 110], [2.2, 38]], 'a', 0.8, { growl: 0.45, growlHz: 16, breath: 0.6, fscale: 0.6 });
    } else {
      const fm = mkFM(b.ac, 330, 1.41, 4, t, t + 2.2);
      b.srcs.push(fm.car, fm.mod);
      sweep(fm.car.frequency, t, 330, 60, 2.0);
      const a = gn(b); envAHR(a.gain, t, 0.35, 0.1, 1.0, 1.0); wire(fm.car, a, b.o);
    }
    boom(b, b.o, t + 1.2, 1.8, 0.9);
    rumble(b, b.o, t + 1.25, 0.1, 1.0, 1.6, 1400, 100, 0.8);
    crackle(b, b.o, t + 1.3, 1.6, 30, 1200, 1.1, 0.4);
  }

  private leash(on: boolean, x: number, z: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('leash', 3, 0.7, Math.max(0.5, s.g) * 0.75, s.pan, 0.2); if (!b) return;
    if (on) {
      blip(b, b.o, b.t, 'sawtooth', 1200, 0.2, 0.7, 380, 0.002, 3000);     // taut zing
      crackle(b, b.o, b.t + 0.05, 0.4, 8, 2600, 2.5, 0.6, true);             // ratchet
    } else {
      spring(b, b.o, b.t, 330, 0.45, 0.4, 12);                               // twang
      burst(b, b.o, b.t, 'white', 'highpass', 3000, 0.7, 0.001, 0.05, 0.5);
    }
  }

  private proc(x: number, z: number): void {
    const s = this.spatial(x, z);
    const b = this.voice('proc', 0, 0.3, Math.max(0.5, s.g) * 0.14, s.pan, 0.2); if (!b) return;
    bell(b, b.o, b.t, mtof(pick([88, 91, 93, 95])), 0.25, 0.6, 4, 0.8);
  }

  private runEnd(result: 'clear' | 'dead'): void {
    const b = this.voice('end', 4, 2.6, 0.6, 0, 0.4); if (!b) return;
    const t = b.t;
    if (result === 'clear') {
      brass(b, b.o, t, [55, 59, 62], 0.2, 0.5);
      brass(b, b.o, t + 0.24, [60, 64, 67], 0.2, 0.5);
      brass(b, b.o, t + 0.48, [55, 62, 67, 71], 1.2, 0.6, 1.2);
      thump(b, b.o, t + 0.48, 98, 55, 0.8, 0.8);
    } else {
      // a deflating brass fall + the thud of a very large body
      const bus = flt(b, 'lowpass', 1400, 1.5);
      const a = gn(b); envAHR(a.gain, t, 0.5, 0.05, 1.1, 0.5); wire(bus, a, b.o);
      for (const det of [-8, 8]) {
        const o = osc(b, 'sawtooth', mtof(55), t, t + 1.8, det);
        curveTo(o.frequency, t, [[0, mtof(55)], [0.45, mtof(55)], [0.5, mtof(54)], [0.95, mtof(54)], [1.0, mtof(52)], [1.65, mtof(47)]]);
        const g = gn(b, 0.4); wire(o, g, bus);
      }
      thump(b, b.o, t + 1.65, 70, 30, 0.7, 0.9);
      burst(b, b.o, t + 1.65, 'brown', 'lowpass', 900, 0.8, 0.005, 0.7, 0.6, 120);
    }
  }

  // ───────────── UI ─────────────

  private uiSound(kind: UiSound): void {
    const now = this.eng.now;
    if (!this.gate('ui_' + kind, now)) return;
    switch (kind) {
      case 'move': {
        const b = this.voice('ui', 4, 0.1, 0.34, 0, 0.02); if (!b) return;
        blip(b, b.o, b.t, 'triangle', 880, 0.04, 0.7, 0, 0.002);
        return;
      }
      case 'confirm': {
        const b = this.voice('ui', 4, 0.25, 0.22, 0, 0.08); if (!b) return;
        beep(b, b.o, b.t, 'square', 660, 0.06, 0.4, 2400); beep(b, b.o, b.t + 0.07, 'square', 990, 0.1, 0.4, 2400);
        return;
      }
      case 'back': {
        const b = this.voice('ui', 4, 0.25, 0.2, 0, 0.08); if (!b) return;
        beep(b, b.o, b.t, 'square', 660, 0.06, 0.4, 1800); beep(b, b.o, b.t + 0.07, 'square', 440, 0.1, 0.4, 1800);
        return;
      }
      case 'draft': {   // MUTATION REPORT: dossiers slide out + a curious chime
        const b = this.voice('ui', 4, 1.1, 0.32, 0, 0.3); if (!b) return;
        for (let i = 0; i < 3; i++) whoosh(b, b.o, b.t + i * 0.09, 0.14, 1800, 4200, 1.2, 0.5, 'white');
        bell(b, b.o, b.t + 0.3, mtof(81), 0.7, 0.4, 3.5, 1);
        bell(b, b.o, b.t + 0.4, mtof(84), 0.7, 0.35, 3.5, 1);
        return;
      }
      case 'pick': {   // stamped dossier + a rising chime
        const b = this.voice('ui', 4, 0.8, 0.38, 0, 0.2); if (!b) return;
        thump(b, b.o, b.t, 150, 60, 0.12, 0.9);
        burst(b, b.o, b.t, 'pink', 'lowpass', 1200, 0.8, 0.001, 0.08, 0.7);
        bell(b, b.o, b.t + 0.1, mtof(79), 0.5, 0.35, 3.5, 1);
        bell(b, b.o, b.t + 0.18, mtof(86), 0.6, 0.35, 3.5, 1);
        return;
      }
      case 'slate': {   // freeze-frame: shutter, a TV zap, a low news sting
        const b = this.voice('ui', 4, 1.4, 0.42, 0, 0.3); if (!b) return;
        burst(b, b.o, b.t, 'white', 'bandpass', 3500, 1.2, 0.001, 0.015, 0.8);
        burst(b, b.o, b.t + 0.05, 'white', 'bandpass', 2500, 1.2, 0.001, 0.02, 0.7);
        const fm = mkFM(b.ac, 1800, 0.37, 6, b.t + 0.02, b.t + 0.3);
        b.srcs.push(fm.car, fm.mod);
        sweep(fm.car.frequency, b.t + 0.02, 1800, 120, 0.25);
        const a = gn(b); envPerc(a.gain, b.t + 0.02, 0.25, 0.002, 0.25, 3); wire(fm.car, a, b.o);
        brass(b, b.o, b.t + 0.2, [45, 52, 57, 60], 0.9, 0.35, 0.6);
        thump(b, b.o, b.t + 0.2, 90, 50, 0.6, 0.6);
        return;
      }
      case 'print': {   // THE WARD SEVEN WITNESS rolls off the press
        const b = this.voice('ui', 4, 1.5, 0.36, 0, 0.12); if (!b) return;
        for (let i = 0; i < 4; i++) {
          const tt = b.t + i * 0.18;
          thump(b, b.o, tt, 130, 70, 0.08, 0.7);
          clang(b, b.o, tt + 0.01, 420, 2.2, 2, 0.08, 0.25);
          whoosh(b, b.o, tt + 0.04, 0.12, 2500, 5000, 1, 0.3, 'white');
        }
        bell(b, b.o, b.t + 0.8, mtof(93), 0.6, 0.45, 5.4, 0.6);   // carriage bell
        return;
      }
    }
  }
}
