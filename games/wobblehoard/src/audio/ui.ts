// SQUISH KEEPER (wobblehoard) INTERFACE SOUNDS (_spec/UI.md 7 "UI sound", batch B1). Twelve soft sine / triangle sounds on ONE
// pentatonic scale, for buttons, switches, panels, toasts and trophies. Same rules as voices.ts: synthesised only (oscillators
// and envelopes, no noise, no samples), plain functions of (ctx, out, t0, params) so the live engine and the offline probe run
// identical code. There is no random draw anywhere: an interface sound must be the same every time (the pitch set is exact).
// Nobody has listened to any of it: every number about it is a measurement (probe_audio.mjs, _harness/audioview/ui_checks.mjs).
//
//   scale     D major pentatonic (D E F# A B), the home collection of the music bed (music.ts FIELDS 'home'), so a sound that lands
//             on top of the bed never clashes with it. Every note below is a MIDI number in that scale; a glide starts and ends on
//             scale notes.
//   level     peak <= -18 dBFS at the master chain's output (stats().peak <= 0.126, master 1), worst case over 44.1 / 48 kHz and the
//             start phase (a sine's sampled crest moves by up to 4%): the loudest kinds sit at 0.119 (-18.5 dBFS). Calibrated in the
//             RUNNING engine, not on a voice rendered 10 ms into a fresh context: the master chain's compressor is cold there and
//             under-reports the first 10-20 ms by up to 1.3 dB. Quieter than the toy's own voices.
//   edges     every note rises over >= 5 ms (>= 9 ms in Calm) from silence and falls on an exponential tail that is stopped
//             at -65 dB: no click at either end. One voice at a time (see the engine hook): a new sound crossfades the old one over
//             UI_STEAL_FADE_S, which is never longer than a note's rise, so the sum never exceeds the louder of the two.
//   calm      (DESIGN 6.6 style) 3.5 dB softer, pure sines (no triangle, no 2nd partial), slower edges, a slightly longer tail.
//
//   tick    a tiny high blip (hover on a mouse, a slider detent, a roving step)        D6, 90 ms
//   press   a soft low "dip" as a button goes down (gel press)                          B4 gliding to A4, 160 ms
//   select  a round confirmation ping (a choice picked, a tab, a card)                  A5 + octave, 300 ms
//   on      a rising fifth (a switch turns on)                                          D5 -> A5, 360 ms
//   off     a falling fourth, softer (a switch turns off)                               A5 -> E5, 340 ms
//   open    a rising D major arpeggio (a panel, the Menu, the Hoard opens)              D5 F#5 A5, 480 ms
//   close   the same falling, softer (a panel closes)                                   A5 F#5 D5, 440 ms
//   back    a quick falling third (step back, cancel, Esc)                              F#5 -> D5, 310 ms
//   error   a gentle hollow "not that" (triangle, low, two falling notes; never harsh)  B4 -> F#4, 560 ms
//   toast   a two-note chime (a notice appears)                                         A5 -> D6, 700 ms
//   trophy  a bright rising run and a held ring (a trophy is won)                       D5 F#5 A5 D6, F#6 + A5, 1.1 s
//   sticker a "bloop" up and a tiny stick (a sticker / label is placed)                 E5 gliding to B5, then D6, 400 ms
import { clamp } from '../core/rng.ts';
import type { UiKind } from '../contracts.ts';
import { Bag, dbToGain, fin, type VoiceGroup } from './dsp.ts';
import { pluck, startTime } from './voices.ts';

type Ctx = BaseAudioContext;

export const UI_KINDS: readonly UiKind[] = ['tick', 'press', 'select', 'on', 'off', 'open', 'close', 'back', 'error', 'toast', 'trophy', 'sticker'];
export const isUiKind = (k: unknown): k is UiKind => typeof k === 'string' && (UI_KINDS as readonly string[]).includes(k);

/** D major pentatonic (D E F# A B) as pitch classes: the one scale of every UI sound. */
export const UI_SCALE_PCS: readonly number[] = [2, 4, 6, 9, 11];

/** A note rises over at least this long (s), from silence. The engine's steal fade is never longer (the crossfade bound). */
export const UI_ATT_S = 0.006;
export const UI_CALM_ATT_S = 0.009;
export const UI_STEAL_FADE_S = 0.005;
/** Calm: this much softer (and pure sines, slower edges). */
export const UI_CALM_DB = -3.5;

interface Note {
  /** start (s after the call) and MIDI note (in the scale) */
  at: number; m: number;
  /** relative peak (0..1) and the decay time constant (s) */
  lv: number; tau: number;
  /** triangle instead of sine (error only) */
  tri?: 1;
  /** a 2nd partial (the octave) at this share of the note's level, decaying 0.55x as slowly */
  h2?: number;
  /** a glide: the note starts `from` semitones away (a scale note) and settles on `m` over `gl` seconds */
  from?: number; gl?: number;
}
interface Spec { db: number; notes: readonly Note[] }

/** D5 74, E5 76, F#5 78, A5 81, B5 83, D6 86, F#6 90; A4 69, B4 71, F#4 66. `db` = the loudest note's gain before the chain. */
export const UI_SPEC: Readonly<Record<UiKind, Spec>> = {
  tick: { db: -27, notes: [{ at: 0, m: 86, lv: 1, tau: 0.011 }] },
  press: { db: -21.6, notes: [{ at: 0, m: 69, lv: 1, tau: 0.032, h2: 0.22, from: 2, gl: 0.035 }] },
  select: { db: -21.1, notes: [{ at: 0, m: 81, lv: 1, tau: 0.04, h2: 0.2 }] },
  on: { db: -22.2, notes: [{ at: 0, m: 74, lv: 0.8, tau: 0.04 }, { at: 0.075, m: 81, lv: 1, tau: 0.05, h2: 0.15 }] },
  off: { db: -21.4, notes: [{ at: 0, m: 81, lv: 0.9, tau: 0.04 }, { at: 0.075, m: 76, lv: 0.8, tau: 0.05 }] },
  open: { db: -23.1, notes: [{ at: 0, m: 74, lv: 0.7, tau: 0.04 }, { at: 0.05, m: 78, lv: 0.85, tau: 0.04 }, { at: 0.1, m: 81, lv: 1, tau: 0.055, h2: 0.15 }] },
  close: { db: -22.8, notes: [{ at: 0, m: 81, lv: 0.9, tau: 0.04 }, { at: 0.05, m: 78, lv: 0.8, tau: 0.04 }, { at: 0.1, m: 74, lv: 0.7, tau: 0.055 }] },
  back: { db: -22.3, notes: [{ at: 0, m: 78, lv: 1, tau: 0.03 }, { at: 0.045, m: 74, lv: 0.8, tau: 0.04 }] },
  error: { db: -20.4, notes: [{ at: 0, m: 71, lv: 1, tau: 0.05, tri: 1 }, { at: 0.11, m: 66, lv: 0.9, tau: 0.07, tri: 1 }] },
  toast: { db: -22.2, notes: [{ at: 0, m: 81, lv: 0.8, tau: 0.06, h2: 0.2 }, { at: 0.09, m: 86, lv: 1, tau: 0.075, h2: 0.15 }] },
  trophy: {
    db: -24.2,
    notes: [
      { at: 0, m: 74, lv: 0.6, tau: 0.06 }, { at: 0.08, m: 78, lv: 0.7, tau: 0.06 }, { at: 0.16, m: 81, lv: 0.8, tau: 0.06 }, { at: 0.24, m: 86, lv: 0.9, tau: 0.07, h2: 0.15 },
      { at: 0.34, m: 90, lv: 0.85, tau: 0.1, h2: 0.12 }, { at: 0.34, m: 81, lv: 0.5, tau: 0.12 },
    ],
  },
  sticker: { db: -20.6, notes: [{ at: 0, m: 83, lv: 1, tau: 0.05, from: -7, gl: 0.06 }, { at: 0.1, m: 86, lv: 0.6, tau: 0.02 }] },
};

/** Minimum gap (s) between two sounds of one kind: faster calls are dropped (UI.md 7: gap 40-400 ms per kind). */
export const UI_GAP_S: Readonly<Record<UiKind, number>> = {
  tick: 0.04, press: 0.06, select: 0.08, on: 0.12, off: 0.12, open: 0.2, close: 0.2, back: 0.15, error: 0.4, toast: 0.3, trophy: 0.4, sticker: 0.25,
};
/** The sound of a higher priority is not cut by a lower one while it is in its protected window (UI_PROTECT_S); an equal or
 *  higher one takes over with a 5 ms crossfade. */
export const UI_PRIORITY: Readonly<Record<UiKind, 0 | 1 | 2>> = {
  tick: 0, press: 0, select: 0, on: 0, off: 0, open: 0, close: 0, back: 0, sticker: 0, toast: 1, error: 1, trophy: 2,
};
export const UI_PROTECT_S: Readonly<Record<UiKind, number>> = {
  tick: 0, press: 0, select: 0, on: 0, off: 0, open: 0, close: 0, back: 0, sticker: 0, toast: 0.3, error: 0.35, trophy: 0.7,
};
/** A ceremony voice keeps the interface quiet (except toast and trophy) until this long after its declared end. */
export const UI_CEREMONY_GRACE_S = 0.25;

/** Per-kind rate limit. `t` in seconds (a monotonic clock). Returns false for a call that comes too soon (and counts it). */
export class UiLimiter {
  private last = new Map<string, number>();
  throttled = 0;
  admit(kind: UiKind, t: number): boolean {
    if (!Number.isFinite(t)) { this.throttled++; return false; }
    const l = this.last.get(kind);
    if (l !== undefined && t - l < UI_GAP_S[kind]) { this.throttled++; return false; }
    this.last.set(kind, t);
    return true;
  }
}

/** Hover feedback is for a mouse or a pen: a finger has no hover. The delegated listener (ui/uiSound.ts) asks this before it plays
 *  a 'tick' for a pointerenter. */
export const hoverSoundAllowed = (pointerType: unknown): boolean => pointerType === 'mouse' || pointerType === 'pen';

const hz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** One note: a sine / triangle through a plucked envelope (rise, then an exponential tail stopped at -65 dB). Returns its end. */
function tone(bag: Bag, t: number, n: Note, A: number, calm: boolean): number {
  const f = hz(n.m);
  const att = calm ? UI_CALM_ATT_S : UI_ATT_S;
  const tau = n.tau * (calm ? 1.15 : 1);
  const at = t + n.at;
  const end = at + att + 7.5 * tau + 0.01;
  const o = bag.osc(n.tri && !calm ? 'triangle' : 'sine', f, at, end);
  if (n.from) {
    o.frequency.setValueAtTime(hz(n.m + n.from), at);
    o.frequency.exponentialRampToValueAtTime(f, at + (n.gl ?? 0.04));
  }
  const g = bag.gain(0);
  o.connect(g); g.connect(bag.head);
  pluck(g.gain, at, A * n.lv, att, tau);
  if (n.h2 && !calm) {
    const t2 = tau * 0.55, e2 = at + att + 7.5 * t2 + 0.01;
    const o2 = bag.osc('sine', 2 * f, at, e2);
    const g2 = bag.gain(0);
    o2.connect(g2); g2.connect(bag.head);
    pluck(g2.gain, at, A * n.lv * n.h2, att, t2);
  }
  return end;
}

export interface UiParams {
  kind: UiKind;
  calm?: boolean;
  /** Level multiplier (0..1); default 1. */
  level?: number;
}

/** One interface sound starting at `t0`. An unknown kind is a tick. */
export function uiVoice(ctx: Ctx, out: AudioNode, t0: number, p: UiParams): VoiceGroup {
  const t = startTime(t0);
  const S = UI_SPEC[isUiKind(p.kind) ? p.kind : 'tick'];
  const calm = p.calm === true;
  const bag = new Bag(ctx, out, 'ui', 0);
  const A = dbToGain(S.db + (calm ? UI_CALM_DB : 0)) * clamp(fin(p.level, 1), 0, 1);
  let end = t;
  for (const n of S.notes) end = Math.max(end, tone(bag, t, n, A, calm));
  bag.endTime = end + 0.01;
  return bag;
}
