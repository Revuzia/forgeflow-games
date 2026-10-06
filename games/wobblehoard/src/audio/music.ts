// WOBBLEHOARD music bed (round 3): an original, generative, gentle ambient score. Nothing here is sampled, copied or
// modelled on any existing piece; the composition rules below are our own. Two halves:
//
//  * Composer: a pure, seeded state machine. It walks four related harmonic fields of one diatonic collection (D major /
//    G lydian), each held 8, 12 or 16 bars, and writes sparse 2-bar call/answer phrases for a felt mallet on an eighth grid
//    (66 BPM, light swing), plus rare bubble grace notes and bubble trails that echo the game's own bubble voice. Same seed
//    => same piece; the RNG never repeats, so the piece never loops.
//  * MusicBed: one playing "session" of that score. A lookahead scheduler turns the composer's bars into WebAudio notes:
//    the engine calls advance(now + LOOKAHEAD_S) from a 100 ms timer, offline renders call it once for the whole span.
//    Each session owns a small bus (a smooth duck, a fast "room" dip for the effects, a one-shot fade-in, a one-shot fade-out
//    and a one-shot pause fade) and caps itself at MAX_LIVE_NOTES sounding note groups.
//
// The same code runs live and in an OfflineAudioContext (the probe renders it), like every other voice.
import { clamp } from '../core/rng.ts';
import { Bag, bubble, dbToGain, fin, harmonicWave, makeRng, rr, type Rng } from './dsp.ts';

type Ctx = BaseAudioContext;

/* ───────────────────────────── constants (the probe and SOUND.md quote these) ───────────────────────────── */

export const MUSIC_BPM = 66;
export const BEAT_S = 60 / MUSIC_BPM;
export const BAR_S = 4 * BEAT_S;
/** An eighth note: the rhythmic grid of the mallet. */
export const SLOT_S = BEAT_S / 2;
/** Off-beat eighths are late by this fraction of a beat (a light, lazy swing). */
export const SWING = 0.045;
/** Sounding note groups per session (pads + mallets + bubbles, by their node lifetime). Two slots are kept for the pads
 *  (at most two overlap, during a field crossfade), so mallets + bubbles get the other four. */
export const MAX_LIVE_NOTES = 6;
const PAD_SLOTS = 2;
/** Live: the engine schedules this far ahead of the audio clock, from a TICK_MS timer. */
export const LOOKAHEAD_S = 0.4;
export const TICK_MS = 100;
export const FADE_IN_S = 2.5;
export const FADE_OUT_S = 1.4;
/** Fade used when the tab is hidden (setPaused): short, because the context is suspended right after it. */
export const PAUSE_FADE_S = 0.15;
/** No mallet note in the first moments of a session: the pad blooms first. */
export const FIRST_NOTE_S = 1.2;
export const DUCK_DB = -9;
export const DUCK_ATTACK_TC = 0.12;
export const DUCK_RELEASE_TC = 0.5;
/**
 * Room for the effects: a sidechain-style dip keyed by EVERY effect voice (round-3 fix; re-shaped by the audio-4 fix). Each
 * one-shot asks the music to step back from the moment it is called until ROOM_TAIL_S after its own end; the held squish
 * and strand ask frame by frame, by a depth that follows their own level. Why the dip: with only the slow ceremony/squish
 * duck, 25 of 330 effect placements over 6 minutes of music stood less than 8 dB above the music in their own bands (a soft
 * toss 5 dB UNDER the pads, a poke 3.4 dB and a pop 0.6 dB over a coinciding mallet), and over each effect's loudest 20 ms
 * frames most soft and medium effects were within 0-7 LU (K-weighted) of the music.
 * Why the long hold and the slow, dB-linear return (audio-4 fix): with a 0.8 s tail and a 0.6 / 0.9 s exponential release,
 * casual play (a gesture every 1-4 s) dipped and swelled the music ~23 times a minute by ~19 dB (measured on the music stem
 * against the music alone: gain std 7.6 dB, 1 s loudness change p90 20 LU against 9.8 for the music alone): it pumped. Now
 * the music stays down while the player is active (an activity hold of ROOM_TAIL_S after every effect) and fades back once
 * they rest. Holding only the pad (the melody keeping a short hold) was measured too and still swung (std 3.2 / 4.8 dB in
 * sparse / burst play, 1 s loudness change p90 12-14 LU): the melody's notes popped back between effects.
 * The dip is fast (melody attack time constant 1.5 ms, pad 6 ms, starting ROOM_LEAD_S before the effect, which the engine
 * schedules that far ahead of the call) so even a 45 ms pop gets it. It runs on its own gain nodes and never fights the slow
 * ceremony duck (they multiply).
 */
export const ROOM_DB = -24;
/** The dip is split: the melody (mallets, their echoes, the bubbles: tonal transients in the effects' own 0.4-2.4 kHz band,
 *  the part that most often covers a soft effect) takes the full ROOM_DB; the dark breathing pad this share of it in dB
 *  (-17.3 dB), so a soft carpet stays under the play instead of the music vanishing altogether. (At a music volume above
 *  the default the pad's share grows: roomPadShare.) */
export const ROOM_PAD_SHARE = 0.72;
/**
 * The pad's share of a dip (dB per dB of the melody's dip) when the music volume is `musicGainDb` above its default (CUT
 * round fix). The melody's dip deepens by the whole volume boost (roomDb: ROOM_DB - boost); the pad's must too, or the pad
 * under an effect is louder than at the default level: with a fixed 0.72 share it deepened by only 0.72 x the boost (at
 * music 1: -21.6 dB for a +6 dB boost, 1.7 dB louder than at the default), and two large, low-pitched pops sat under the pad
 * (the independent audio-3 verifier's music-1 placements). Now the pad's full dip is ROOM_PAD_SHARE * ROOM_DB - boost
 * (-23.3 dB at music 1: exactly its default level under an effect), and a partial dip (a held squish or strand between its
 * thresholds) keeps the same proportion. 0.72 at the default volume, unchanged there.
 */
export function roomPadShare(musicGainDb = 0): number {
  const g = Math.max(0, fin(musicGainDb, 0));
  return (ROOM_PAD_SHARE * -ROOM_DB + g) / (-ROOM_DB + g);
}
/** The melody's dip is fast (a mallet note already ringing is the masker to remove)... */
export const ROOM_ATTACK_TC = 0.0015;
/** ... the pad's is gentle: a sustained chord cut in a few ms would itself be heard as a gate (seen as a vertical splatter
 *  stripe at every dip onset in the music stem's spectrogram). */
export const ROOM_PAD_ATTACK_TC = 0.006;
/** = the engine's effect LOOKAHEAD: an effect called at t starts at t + ROOM_LEAD_S, the dip starts at t. */
export const ROOM_LEAD_S = 0.004;
/** The activity hold (audio-4 fix; was a 0.8 s tail): every effect keeps the music down until this long after its own end.
 *  Casual play (rests of 1-4 s) and play in bursts (5 s on, 5 s off) then keep it steadily under instead of pumping it, and
 *  it starts to come back once the player has rested this long. */
export const ROOM_TAIL_S = 4.5;
/** The return after the last hold: dB-linear (a fade, not a rebound: an exponential release from -17 dB gained ~6 dB in its
 *  first 0.25 s), a full return from ROOM_DB taking this long; the pad, dipped ROOM_PAD_SHARE as deep, moves in step. The
 *  music is back within 1 dB about ROOM_TAIL_S + 2.1 s after the last effect ends. */
export const ROOM_RETURN_S = 2.0;
/** The return is built from short setTargetAtTime steps toward the dB-linear schedule (setTarget only, so a later re-plan
 *  can take over anywhere without a jump): one every ROOM_STEP_S, time constant ROOM_STEP_TC. */
export const ROOM_STEP_S = 0.2;
const ROOM_STEP_TC = 0.12;
const ROOM_RETURN_DB_PER_S = -ROOM_DB / ROOM_RETURN_S;
/** Safety cap of one hold (an 8 s blend + its flourish + the tail fit). */
export const ROOM_MAX_HOLD_S = 15;
/** Slow-onset voices (audio-4 fix): a lift's suction "thwop" comes 50-80 ms after its peel ticks (which stay > 20 dB under
 *  it), a blend's motor needs ~90 ms to spool up into earshot. A dip at the call left the music already gone 60-80 ms
 *  (lift) and 100+ ms (blend) before the effect was there. Such a voice declares `onset` (VoiceGroup: when it starts to be
 *  heard, within ~20 dB of its loudest) and the dip starts ROOM_RISE_LEAD_S before that instead of at the call. The toss
 *  declares none: its whoosh is audible (within 20 dB) from 30-60 ms but loud only from 70-115 ms, and a soft toss is
 *  barely louder than the undipped pad in its own band, so any later dip broke the in-band gate (measured 4-7 dB). */
export const ROOM_RISE_LEAD_S = 0.005;
/** A fast effect that arrives while the music is up (its room level above ROOM_CLEAR_ABOVE_DB) starts ROOM_CLEAR_S later
 *  than the engine's usual lookahead (audio-4 fix), so the dip has already cleared a mallet note that was ringing when the
 *  effect was called: before, a soft pop landing 25 ms after a note began measured 8.4 LU over its loudest 20 ms frames
 *  (the frames that straddle its onset still held the undipped note; no causal dip can remove what was heard before the
 *  call). While the music is already stepped back (any play in the last ROOM_TAIL_S) effects keep the usual lookahead, and
 *  slow-onset voices never wait. The cost: the first fast effect after a rest sounds 12 ms later. */
export const ROOM_CLEAR_S = 0.012;
export const ROOM_CLEAR_ABOVE_DB = -6;
export const ROOM_CLEAR_KINDS: ReadonlySet<string> = new Set(['poke', 'release', 'land', 'pop', 'bump', 'strandSnap', 'meterFull', 'capsule', 'cutPop', 'rejoin']);
/** The extra start delay (s) of an effect of `kind` when the music's room level is `roomLevelDb` (MusicBed.roomLevelAt) and
 *  the music volume is `musicGainDb` above its default. CUT round fix: the delay grows with the volume boost (x2 at +6 dB,
 *  music 1): at the slider's top two large, low-pitched pops onto a pad that was up still measured 4.8 / 6.2 dB in-band in
 *  the independent verifier's music-1 placements after the pad's dip was corrected (roomPadShare); what covered them was the
 *  undipped pad of the moments before the call. 24 ms of clearing removes it (in-band >= 8 dB on that set). The cost: at
 *  music 1 the first fast effect after a rest sounds 24 ms late (12 ms at the default volume, as before). */
export function roomClearDelay(kind: string, roomLevelDb: number, musicGainDb = 0): number {
  return ROOM_CLEAR_KINDS.has(kind) && fin(roomLevelDb, 0) > ROOM_CLEAR_ABOVE_DB ? ROOM_CLEAR_S * (1 + Math.max(0, fin(musicGainDb, 0)) / 6) : 0;
}
/** Which one-shots make room, and how deep (dB). The engine and the offline mix renders both read this table (and
 *  roomDb() / oneShotRoom() below). The ceremony voices (reveal, merge) keep the slow duck; capsule beats get both. */
export const ROOM_KINDS: Readonly<Record<string, number>> = {
  poke: ROOM_DB, pop: ROOM_DB, blend: ROOM_DB, meterFull: ROOM_DB, capsule: ROOM_DB, strandSnap: ROOM_DB,
  release: ROOM_DB, land: ROOM_DB, bump: ROOM_DB, lift: ROOM_DB, toss: ROOM_DB,
  // CUT (cut.ts): the slice (a slow onset: it declares one), the separation pop and the rejoin blorp (fast: they clear the way)
  cut: ROOM_DB, cutPop: ROOM_DB, rejoin: ROOM_DB,
};
/** Held voices: each update holds its depth this long plus the activity tail ROOM_TAIL_S (so a rubbing squish that dips
 *  and swells frame by frame keeps the deepest dip instead of tremoloing the music). Held requests are rounded (depth down
 *  to 0.5 dB, end up to HELD_ROOM_GRID_S) so a voice updated every frame re-plans the dip a few times a second, not 60. */
export const HELD_ROOM_HOLD_S = 0.25;
const HELD_ROOM_GRID_S = 0.25;
/** The held squish dips fully from this |rate| (1/s) on, not at all below SQUISH_ROOM_MIN_RATE (the squelch is then 40 dB
 *  under its max: inaudible), in proportion (dB) between, with the melody's fast attack (its in-band margin on isolated
 *  squeezes is the thinnest of all, 10-19 dB depending on the placement set: a later dip would cost it). */
export const SQUISH_ROOM_RATE = 0.7;
export const SQUISH_ROOM_MIN_RATE = 0.15;
/** The held strand dips fully from STRAND_ROOM_T on, not at all below STRAND_ROOM_MIN_T, in proportion (dB) between, going
 *  down with STRAND_ROOM_TC (audio-4 fix; was 0..0.35 with the fast attack: the music was gone 100-300 ms before a strand
 *  pulled out slowly was loud; its own band, 1.1-3.2 kHz, is far above the music's, so the later dip costs little). */
export const STRAND_ROOM_T = 0.5;
export const STRAND_ROOM_MIN_T = 0.15;
export const STRAND_ROOM_TC = 0.04;
/**
 * The dip (dB) an effect asks for. `musicGainDb` is the music volume's gain above its default (chain.ts musicGain at the
 * player's setting; 0 at the default, +6 dB at 1): the dip deepens by it, so with the slider up the music under an effect
 * is never louder than at the default level (the effects stay in front whatever the slider says).
 */
export function roomDb(kind: string, musicGainDb = 0): number | null {
  const d = ROOM_KINDS[kind];
  return d === undefined ? null : d - Math.max(0, fin(musicGainDb, 0));
}
export function squishRoomDb(rate: number, musicGainDb = 0): number {
  const a = clamp((Math.abs(fin(rate, 0)) - SQUISH_ROOM_MIN_RATE) / (SQUISH_ROOM_RATE - SQUISH_ROOM_MIN_RATE), 0, 1);
  return a * (ROOM_DB - Math.max(0, fin(musicGainDb, 0)));
}
export function strandRoomDb(tension: number, musicGainDb = 0): number {
  const a = clamp((fin(tension, 0) - STRAND_ROOM_MIN_T) / (STRAND_ROOM_T - STRAND_ROOM_MIN_T), 0, 1);
  return a * (ROOM_DB - Math.max(0, fin(musicGainDb, 0)));
}
/** One request for room (MusicBed.makeRoom): planned at the call time `from`, the dip itself from `at` (>= from) until
 *  `until`, `db` deep, going down with time constant `atk` (melody; the pad never faster than ROOM_PAD_ATTACK_TC).
 *  `gainDb`: the music volume's gain above its default that `db` already includes (the pad's share follows it:
 *  roomPadShare). */
export interface RoomRequest { from: number; at: number; until: number; db: number; atk: number; gainDb?: number }
/**
 * What a one-shot of `kind` asks for (the engine and the offline mix renders both use this): called at `callT`, sounding
 * from `startT` to `endT`; `onset` (s, 0 for a fast onset) is when the voice starts to be heard (VoiceGroup.onset). Empty
 * for kinds that do not make room.
 */
export function oneShotRoom(kind: string, callT: number, startT: number, endT: number, onset = 0, musicGainDb = 0): RoomRequest[] {
  const db = roomDb(kind, musicGainDb);
  if (db === null) return [];
  const o = Math.max(0, fin(onset, 0));
  const at = o > 0 ? Math.max(callT, fin(startT, callT) + o - ROOM_RISE_LEAD_S) : callT;
  return [{ from: callT, at, until: fin(endT, callT) + ROOM_TAIL_S, db, atk: ROOM_ATTACK_TC, gainDb: Math.max(0, fin(musicGainDb, 0)) }];
}
function heldRoom(t: number, db: number, atk: number, musicGainDb: number): RoomRequest | null {
  const d = fin(db, 0);
  if (!(d < -0.05)) return null;
  return { from: t, at: t, until: Math.ceil((t + HELD_ROOM_HOLD_S + ROOM_TAIL_S) / HELD_ROOM_GRID_S) * HELD_ROOM_GRID_S, db: Math.floor(d * 2) / 2, atk, gainDb: Math.max(0, fin(musicGainDb, 0)) };
}
/** What one update of the held squish at `t` asks for (by its |rate|), or null for none. */
export function squishRoom(t: number, rate: number, musicGainDb = 0): RoomRequest | null {
  return heldRoom(t, squishRoomDb(rate, musicGainDb), ROOM_ATTACK_TC, musicGainDb);
}
/** What one update of the held strand at `t` asks for (by its tension), or null for none. */
export function strandRoom(t: number, tension: number, musicGainDb = 0): RoomRequest | null {
  return heldRoom(t, strandRoomDb(tension, musicGainDb), STRAND_ROOM_TC, musicGainDb);
}
/** At most this many bars in a row without a mallet note (a long rest reads as the music having stopped). */
export const MAX_REST_BARS = 2;
/** Music volume 0..1 relative to master; 0.45 is the designed level (see chain.ts musicGain). */
export const MUSIC_DEFAULT = 0.45;
/** Mallet register (MIDI): A4 .. D6, 440 .. 1175 Hz. Nothing in the score goes below D4 (294 Hz): the 60-290 Hz region
 *  belongs to the squishies' bodies (poke, land, bump, lift, release), which must stand >= 8 dB above the music. */
export const MEL_LO = 69;
export const MEL_HI = 86;
/** Where the melody likes to sit (F5); it is pulled back toward here near the edges of the register. */
const MEL_HOME = 77;

/* Session levels (linear, before the chain's music gain), calibrated with the probe for a long-term RMS of about -29 dBFS
 * at music 0.45 / master 1 (the -30..-24 band, near its quiet end). Round-3 fix: the pad was the strongest and the only
 * continuous component, sitting where the ear is most sensitive (the first version: pad RMS 3-5 dB above the mallets, a
 * steady three-line chord in every spectrogram). Now the pad is darker (sines, no triangles), each of its tones breathes
 * on its own (so the full chord is rare) and it sits about 6 dB under the sparse mallet, which carries the level. */
const PAD_LEVEL = dbToGain(-28.8);
const MALLET_LEVEL = dbToGain(-12.5);
const BUBBLE_LEVEL = dbToGain(-21.5);
/** The pad answers the melody: it swells this much in a bar with no mallet note (half of it in a one-note bar) and sits
 *  back under busier bars (time constant PAD_FILL_TC, moving ahead of the bar line by PAD_FILL_LEAD_S). Without it, a
 *  sparse melody carrying the level made the 10 s level swing by +/-3.5 dB with the phrasing (rests = pad alone). */
export const PAD_FILL_DB = 5;
const PAD_FILL_TC = 1.0;
const PAD_FILL_LEAD_S = 0.5;
/** The music's bubbles settle upward by only 1% (17 cents; the game's bubbles chirp ~30%: a tuned note cannot) ... */
const BUBBLE_RISE = 0.01;
/** ... and start this fraction of the rise below the note, so the pitch lands on the scored note. Measured (A5..D7,
 *  probe check): energy-weighted pitch -4 cents, spectral peak +4 cents. The first version glided +5% from the note and
 *  sounded +33..+38 cents sharp (energy-weighted) / +59..+80 cents at the spectral peak. */
const BUBBLE_AIM = 0.6;
const BUBBLE_SOFT = 2.2;
/** Each mallet note repeats once, 3/4 beat later, this loud (-11 dB), darker (no x3.98 partial) and on the other side. */
const ECHO_LEVEL = 0.28;
/** 3/4 of a beat: the echo lands on a dotted-eighth, off the grid, so it reads as space rather than as extra notes. */
export const ECHO_S = 0.75 * BEAT_S;

export const midiHz = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);
export const pcOf = (m: number): number => ((Math.round(m) % 12) + 12) % 12;

/* ───────────────────────────── harmonic fields ───────────────────────────── */

export interface Field {
  readonly name: string;
  /** Pad chord, MIDI notes (low, mid, high). */
  readonly pad: readonly number[];
  /** Pitch classes the mallet and the bubbles may use (0 = C). */
  readonly mel: readonly number[];
  /** Resting tones: phrase endings land on one of these pitch classes. */
  readonly rest: readonly number[];
}

/**
 * Four fields of ONE diatonic collection (D E F# G A B C#), so no transition can clash. Our own voicings, all between D4
 * and F#5 (294-740 Hz) so the squishies' bodies keep 60-290 Hz to themselves:
 *   home  D add9, open (D4 A4 E5)           melody D major pentatonic        D E F# A B
 *   lift  G maj7 shell, lydian (G4 B4 F#5)  melody G lydian, no 4th          G A B C# D F#   (C# is the lydian colour)
 *   dusk  B minor over F# (F#4 B4 D5)       melody B minor pentatonic        B D E F# A
 *   glow  A sus2 over E (E4 A4 B4)          melody A major pentatonic        A B C# E F#
 */
export const FIELDS: readonly Field[] = [
  { name: 'home', pad: [62, 69, 76], mel: [2, 4, 6, 9, 11], rest: [2, 6, 9] },
  { name: 'lift', pad: [67, 71, 78], mel: [7, 9, 11, 1, 2, 6], rest: [7, 11, 2] },
  { name: 'dusk', pad: [66, 71, 74], mel: [11, 2, 4, 6, 9], rest: [11, 2, 6] },
  { name: 'glow', pad: [64, 69, 71], mel: [9, 11, 1, 4, 6], rest: [9, 1, 4] },
];
/** Allowed drifts and their weights. Glow mostly resolves home; nothing returns to the field it just left. */
export const FIELD_NEXT: readonly (readonly (readonly [number, number])[])[] = [
  [[1, 0.4], [2, 0.35], [3, 0.25]],
  [[0, 0.5], [2, 0.3], [3, 0.2]],
  [[1, 0.35], [3, 0.35], [0, 0.3]],
  [[0, 0.6], [2, 0.4]],
];
/** How many bars a field lasts (8 bars = 29 s at 66 BPM). */
export const FIELD_BARS: readonly (readonly [number, number])[] = [[8, 0.35], [12, 0.4], [16, 0.25]];

/** Rhythm cells: eighth-note slots (0..7) inside a bar. About two thirds start on the downbeat; the rest are lazy
 *  off-beat figures and pickups, so the line does not lock to the bar line. */
const CELLS: readonly (readonly [readonly number[], number])[] = [
  [[0], 0.1], [[0, 3], 0.13], [[0, 3, 6], 0.1], [[0, 4], 0.11], [[0, 2, 4], 0.07], [[2, 4, 7], 0.08],
  [[0, 6, 7], 0.06], [[0, 1, 4], 0.05], [[3, 6], 0.08], [[0, 2, 3, 6], 0.05], [[1, 4], 0.06], [[2, 5], 0.06], [[4, 6, 7], 0.05],
];
/** Melodic steps in scale degrees: mostly neighbours, some skips, a rare playful leap. */
const STEPS: readonly (readonly [number, number])[] = [
  [-1, 0.26], [1, 0.26], [-2, 0.12], [2, 0.13], [0, 0.05], [-3, 0.06], [3, 0.07], [4, 0.03], [-4, 0.02],
];
type Role = 'call' | 'answer' | 'rest';
/** Two-bar phrases. About 1.4 sounding bars per two: sparse. */
const PHRASES: readonly (readonly [readonly Role[], number])[] = [
  [['call', 'answer'], 0.5], [['call', 'rest'], 0.27], [['rest', 'call'], 0.14], [['rest', 'rest'], 0.09],
];

export function pick<T>(r: Rng, items: readonly (readonly [T, number])[]): T {
  let tot = 0;
  for (const [, w] of items) tot += w;
  let u = r() * tot;
  for (const [v, w] of items) { u -= w; if (u < 0) return v; }
  return items[items.length - 1][0];
}

/* ───────────────────────────── composer (pure, seeded) ───────────────────────────── */

export interface PlannedNote {
  kind: 'mallet' | 'bubble';
  /** Seconds from the start of the bar (a grace bubble may be slightly negative). */
  at: number;
  midi: number;
  /** 0..1 */
  vel: number;
  pan: number;
  /** Seed of the note's own synthesis stream (noise offsets etc.), drawn at planning time: chunked and one-go scheduling sound identical. */
  seed: number;
}

export interface PlannedBar {
  bar: number;
  field: number;
  /** The first bar of a field (a new pad starts here). */
  fieldStart: boolean;
  /** Bars left in this field, this one included. */
  barsLeft: number;
  /** Seed for a pad that starts on this bar. */
  seed: number;
  notes: PlannedNote[];
}

export class Composer {
  private readonly r: Rng;
  field = 0;
  bar = 0;
  private barsLeft: number;
  private cur = MEL_HOME;
  private queue: Role[] = [];
  private lastCall: { cell: readonly number[]; steps: number[] } | null = null;
  private restRun = 0;
  /** History of field changes (bar index, field, length in bars): the probe checks the drift rules from it. */
  readonly fieldLog: { bar: number; field: number; bars: number }[] = [];

  constructor(seed: number) {
    this.r = makeRng((fin(seed, 1) ^ 0x6d757369) >>> 0);
    this.barsLeft = pick(this.r, FIELD_BARS);
    this.fieldLog.push({ bar: 0, field: 0, bars: this.barsLeft });
    // the piece always opens with a resting bar: the pad blooms before the first note
    this.queue = ['rest', this.r() < 0.5 ? 'call' : 'rest'];
  }

  private scale(): number[] {
    const f = FIELDS[this.field];
    const out: number[] = [];
    for (let m = MEL_LO; m <= MEL_HI; m++) if (f.mel.includes(pcOf(m))) out.push(m);
    return out;
  }

  private nearest(sc: number[], m: number): number {
    let best = 0;
    for (let i = 1; i < sc.length; i++) if (Math.abs(sc[i] - m) < Math.abs(sc[best] - m)) best = i;
    return best;
  }

  private stepFrom(sc: number[], d: number): number {
    let i = this.nearest(sc, this.cur);
    let step = d;
    // gravity toward the middle of the register: the line breathes around F5 instead of wandering off an edge
    if (sc[i] >= MEL_HOME + 5 && step > 0 && this.r() < 0.6) step = -step;
    if (sc[i] <= MEL_HOME - 5 && step < 0 && this.r() < 0.6) step = -step;
    i = clamp(i + step, 0, sc.length - 1);
    this.cur = sc[i];
    return this.cur;
  }

  /** Land on the closest resting tone of the field (ties go down: endings settle). */
  private resolve(sc: number[]): number {
    const rest = FIELDS[this.field].rest;
    let best = -1;
    for (let i = 0; i < sc.length; i++) {
      if (!rest.includes(pcOf(sc[i]))) continue;
      if (best < 0 || Math.abs(sc[i] - this.cur) < Math.abs(sc[best] - this.cur) || (Math.abs(sc[i] - this.cur) === Math.abs(sc[best] - this.cur) && sc[i] < sc[best])) best = i;
    }
    if (best >= 0) this.cur = sc[best];
    return this.cur;
  }

  private slotTime(s: number): number {
    // +/-8 ms of human looseness, but never ahead of the bar line (a new field's pad starts exactly there)
    return Math.max(0, s * SLOT_S + (s % 2 ? SWING * BEAT_S : 0) + rr(this.r, -0.008, 0.008));
  }

  private seed(): number { return (this.r() * 4294967296) >>> 0; }

  private melodyBar(role: Role, ends: boolean): PlannedNote[] {
    const sc = this.scale();
    const out: PlannedNote[] = [];
    let cell: readonly number[];
    let steps: number[];
    const shifted = this.lastCall ? [1, -1].map((d) => this.lastCall!.cell.map((x) => x + d)).filter((c) => c.every((x) => x >= 0 && x <= 7)) : [];
    if (role === 'answer' && this.lastCall && shifted.length && this.r() < 0.3) {
      // answer in kind: the call's rhythm nudged by an eighth (a playful displacement) with its contour mirrored, so the two
      // bars rhyme without either repeating the other
      cell = shifted[Math.floor(this.r() * shifted.length)];
      steps = this.lastCall.steps.map((d) => -d);
    } else {
      cell = pick(this.r, CELLS);
      steps = cell.map(() => pick(this.r, STEPS));
    }
    if (role === 'call') this.lastCall = { cell, steps: steps.slice() };
    for (let k = 0; k < cell.length; k++) {
      const s = cell[k];
      const last = k === cell.length - 1;
      const midi = last && ends ? (this.stepFrom(sc, steps[k]), this.resolve(sc)) : this.stepFrom(sc, steps[k]);
      let vel = 0.62 + (s === 0 ? 0.1 : 0) + rr(this.r, -0.06, 0.06);
      if (last && ends) vel *= 0.86;
      const at = this.slotTime(s);
      const pan = clamp((midi - MEL_HOME) / 30 + rr(this.r, -0.12, 0.12), -0.35, 0.35);
      out.push({ kind: 'mallet', at, midi, vel: clamp(vel, 0.3, 1), pan, seed: this.seed() });
      // grace: a tiny bubble an octave above, just ahead of the note (the game's bubble, tuned); never across the bar line
      if (this.r() < 0.16 && at > 0.08) out.push({ kind: 'bubble', at: at - rr(this.r, 0.05, 0.075), midi: midi + 12, vel: 0.6, pan, seed: this.seed() });
    }
    // trail: after a phrase ends, sometimes 2-3 bubbles rise through the field's scale, an octave up
    const lastN = out.filter((n) => n.kind === 'mallet').pop();
    if (ends && lastN && this.r() < 0.3 && lastN.at + 0.62 < BAR_S) {
      // (the whole trail stays inside this bar, so it always sounds over its own field's pad)
      let i = this.nearest(sc, lastN.midi);
      const n = this.r() < 0.5 ? 2 : 3;
      for (let k = 0; k < n; k++) {
        i = Math.min(i + 1, sc.length - 1);
        out.push({ kind: 'bubble', at: lastN.at + 0.3 + k * rr(this.r, 0.075, 0.1), midi: sc[i] + 12, vel: 0.5 - 0.08 * k, pan: lastN.pan, seed: this.seed() });
      }
    }
    return out;
  }

  nextBar(): PlannedBar {
    let fieldStart = this.bar === 0;
    if (this.barsLeft <= 0) {
      this.field = pick(this.r, FIELD_NEXT[this.field]);
      this.barsLeft = pick(this.r, FIELD_BARS);
      this.fieldLog.push({ bar: this.bar, field: this.field, bars: this.barsLeft });
      fieldStart = true;
      // half the time the new field opens with a resting bar (its pad blooms alone)
      if (this.queue.length === 0 && this.r() < 0.5) this.queue = ['rest', 'call'];
    }
    if (this.queue.length === 0) this.queue = pick(this.r, PHRASES).slice();
    let role = this.queue.shift() as Role;
    // never more than MAX_REST_BARS empty bars in a row (a phrase rest, a field's opening rest and a rest+rest phrase could
    // add up to 5 bars = 18 s of pad alone)
    if (role === 'rest' && this.restRun >= MAX_REST_BARS) role = 'call';
    this.restRun = role === 'rest' ? this.restRun + 1 : 0;
    const ends = role === 'answer' || (role === 'call' && (this.queue.length === 0 || this.queue[0] === 'rest'));
    const notes = role === 'rest' ? [] : this.melodyBar(role, ends);
    const out: PlannedBar = { bar: this.bar, field: this.field, fieldStart, barsLeft: this.barsLeft, seed: this.seed(), notes };
    this.bar++;
    this.barsLeft--;
    return out;
  }
}

/* ───────────────────────────── instruments ───────────────────────────── */

/**
 * Pad: the field's three tones, each a soft sine (a whisper of 2nd and 3rd harmonic for warmth) with a quieter sine partner
 * (0.4) detuned so the pair beats SLOWLY (0.12-0.3 Hz, a different rate per tone), all drifting a few cents on a slow LFO,
 * through one gentle low-pass (900 Hz). Each tone BREATHES on its own seeded schedule: it swells to its peak (rise 1.8-3.5
 * s, hold 1-4.5 s), sinks back to a floor (fall 2.5-4.5 s; the root keeps -9 dB, the middle -13, the top -16) and rests
 * there 0.5-5 s, so at any moment one, two or three tones are up and the chord's colour keeps moving. The whole chord fades
 * in with a time constant of 1.2 s from `t`, starts fading out (tc 1.3 s) 0.6 s before `endT`, and its sources stop 8 s
 * later.
 */
const PAD_FLOOR = [dbToGain(-9), dbToGain(-13), dbToGain(-16)];
function padChord(ctx: Ctx, dest: AudioNode, t: number, endT: number, field: Field, seed: number, pr: number): { bag: Bag; end: number } {
  const r = makeRng(seed);
  const bag = new Bag(ctx, dest, 'pad', 0);
  const relT = Math.max(t + 1, endT - 0.6);
  const stopT = relT + 8;
  const lp = bag.biquad('lowpass', 900, 0.5);
  const amp = bag.gain(0);
  lp.connect(amp); amp.connect(bag.head);
  const drift = bag.osc('sine', rr(r, 0.08, 0.14), t, stopT);
  const driftD = bag.gain(3.5);           // cents
  drift.connect(driftD);
  const wave = harmonicWave(ctx, 'pad', [1, 0.06, 0.02]);
  // the top tone carries the pad; the lower ones (which reach down toward the squishies' 2nd harmonics) are softer
  const lv = [0.5, 0.7, 1];
  for (let k = 0; k < field.pad.length; k++) {
    const f = midiHz(field.pad[k]) * pr;
    const g = bag.gain(0.62 * lv[k]);
    const beatHz = rr(r, 0.12, 0.3);
    const cents = 1200 * Math.log2(1 + beatHz / f);
    for (const [det, lvl] of [[0, 1], [cents, 0.4]] as const) {
      const o = bag.osc('sine', f, t, stopT);
      o.setPeriodicWave(wave);
      o.detune.value = det;
      driftD.connect(o.detune);
      const og = bag.gain(lvl);
      o.connect(og); og.connect(g);
    }
    // this tone's breaths
    const fl = PAD_FLOOR[k] ?? PAD_FLOOR[2];
    g.gain.setValueAtTime(0.62 * lv[k] * fl, t);
    let u = t + rr(r, 0, 1.2) + 0.9 * k;
    for (let guard = 0; guard < 40 && u < relT; guard++) {
      const rise = rr(r, 1.8, 3.5), hold = rr(r, 1, 4.5), fall = rr(r, 2.5, 4.5), gap = rr(r, 0.5, 5);
      g.gain.setTargetAtTime(0.62 * lv[k] * rr(r, 0.75, 1), u, rise / 3);
      g.gain.setTargetAtTime(0.62 * lv[k] * fl, u + rise + hold, fall / 3);
      u += rise + hold + fall + gap;
    }
    g.connect(lp);
  }
  amp.gain.setValueAtTime(0, t);
  amp.gain.setTargetAtTime(PAD_LEVEL, t, 1.2);
  amp.gain.setTargetAtTime(0, relT, 1.3);
  bag.endTime = stopT + 0.02;
  return { bag, end: stopT };
}

/**
 * Felt mallet: a sine fundamental with a soft octave and a marimba-like x3.98 partial that die faster, plus a 6 ms
 * low-passed noise "felt" contact. Decay tc 0.3 s at 600 Hz (lower notes ring a little longer); every partial ends with an
 * exponential glide to -44 dB at 5 time constants and a 20 ms ramp to zero. Its echo is part of the note: the fundamental
 * and the octave again ECHO_S later at ECHO_LEVEL, panned to the other side (scheduled, not a DelayNode: see MusicBed).
 * Node lifetime ~2.2 s at 600 Hz.
 */
function mallet(ctx: Ctx, dest: AudioNode, t: number, f: number, vel: number, pan: number, seed: number): { bag: Bag; end: number } {
  const r = makeRng(seed);
  const bag = new Bag(ctx, dest, 'mallet', pan);
  const A = MALLET_LEVEL * Math.pow(clamp(vel, 0, 1), 1.3);
  const tau = 0.39 * Math.pow(600 / f, 0.35);
  let end = t;
  const canPan = typeof ctx.createStereoPanner === 'function';
  const ep = canPan ? bag.add(ctx.createStereoPanner()) : bag.gain(1);
  const side = Math.abs(pan) > 0.05 ? -Math.sign(pan) * 0.5 : (r() < 0.5 ? -0.5 : 0.5);
  if (canPan) (ep as StereoPannerNode).pan.value = side;
  ep.connect(dest);
  const te = t + ECHO_S;
  const parts: readonly (readonly [number, number, number, number])[] = [[1, 1, 1, 1], [2, 0.16, 0.45, 1], [3.98, 0.07, 0.18, 0]];
  for (const [ratio, lvl, tm, echoes] of parts) {
    const fq = f * ratio * (1 + 0.002 * (r() - 0.5));
    const T = tau * tm;
    for (let k = 0; k <= echoes; k++) {
      const u = k ? te : t;
      const a = A * lvl * (k ? ECHO_LEVEL : 1);
      const e = u + 0.004 + 5 * T;
      const o = bag.osc('sine', fq, u, e + 0.03);
      const g = bag.gain(0);
      o.connect(g); g.connect(k ? ep : bag.head);
      g.gain.setValueAtTime(0, u);
      g.gain.linearRampToValueAtTime(a, u + (k ? 0.008 : 0.004));
      g.gain.exponentialRampToValueAtTime(a * 0.0067, e);
      g.gain.linearRampToValueAtTime(0, e + 0.02);
      end = Math.max(end, e + 0.03);
    }
  }
  const n = bag.noise(r, t, t + 0.03);
  const lp = bag.biquad('lowpass', 1300, 0.7);
  const ng = bag.gain(0);
  n.connect(lp); lp.connect(ng); ng.connect(bag.head);
  ng.gain.setValueAtTime(0, t);
  ng.gain.linearRampToValueAtTime(A * 0.35, t + 0.0015);
  ng.gain.linearRampToValueAtTime(0, t + 0.007);
  bag.endTime = end + 0.02;
  return { bag, end };
}

/**
 * The music's bubble grace/trail note: the game's Minnaert bubble (dsp.ts) tuned to `f`. Its radius is chosen so that the
 * small upward settle (BUBBLE_RISE) is centred on the note instead of starting there. Returns the time it is silent.
 */
export function musicBubble(ctx: Ctx, dest: AudioNode, t: number, f: number, amp: number): number {
  return bubble(ctx, dest, t, 3.26 / (f / (1 + BUBBLE_AIM * BUBBLE_RISE)), amp, BUBBLE_RISE, BUBBLE_SOFT);
}

/* ───────────────────────────── the scheduler / one playing session ───────────────────────────── */

export interface MusicLogEntry {
  t: number;
  end: number;
  kind: 'pad' | 'mallet' | 'bubble';
  midi: readonly number[];
  field: number;
  vel: number;
  /** Not played: the live-note cap was full, or the note was already late. */
  dropped?: 'cap' | 'late';
}

/** A room hold (makeRoom): the dip `db` (melody scale) from `at` until `until`, going down with time constant `atk`. */
interface RoomHold { at: number; until: number; db: number; atk: number }
/** One piece of the planned room level: from `t` the level is `db` (rate 0: a step, time constant `tc`), or it returns
 *  dB-linearly from `db` toward `to` at `rate` dB/s. */
interface RoomSeg { t: number; db: number; to: number; rate: number; tc: number }

interface Pending { t: number; kind: 'pad' | 'mallet' | 'bubble'; midi: number; field: number; vel: number; pan: number; seed: number; end: number }

const curve = (from: number, to: number, n = 33): Float32Array<ArrayBuffer> => {
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) c[i] = from + (to - from) * (0.5 - 0.5 * Math.cos((Math.PI * i) / (n - 1)));
  return c;
};

export interface MusicBedOptions {
  /** Keep a log of every note (the probe's pitch-set, onset and cap checks). */
  log?: boolean;
  /** Pitch ratio of the whole score (default 1). */
  pitch?: number;
  fadeInS?: number;
  /** Diagnostics only (stem renders): level multipliers for the pad and for the mallets + bubbles (default 1). */
  layers?: { pad?: number; mallet?: number };
}

export class MusicBed {
  readonly ctx: Ctx;
  readonly t0: number;
  readonly log: MusicLogEntry[] | null;
  readonly stats = { notes: 0, bubbles: 0, pads: 0, dropped: 0, late: 0, maxLive: 0 };
  private readonly composer: Composer;
  private readonly bus: Bag;
  private readonly melBus: GainNode;
  private readonly duckG: GainNode;
  private readonly roomMel: GainNode;
  private readonly roomPad: GainNode;
  private readonly fadeOut: GainNode;
  private readonly pauseG: GainNode;
  private readonly padIn: GainNode;
  private readonly padFill: GainNode;
  private fillAt = -Infinity;
  private readonly pr: number;
  private nextBarT: number;
  private pending: Pending[] = [];
  /** Start/end of every scheduled note (pads included) for the live-note cap; trimmed as time passes. */
  private spans: { t: number; end: number; pad: boolean }[] = [];
  private groups: Bag[] = [];
  private first = true;
  private ducked = false;
  private duckUntil = -Infinity;
  private roomFrom = 0;
  /** Active room holds (dB, melody scale) and the planned level schedule (see makeRoom). */
  private holds: RoomHold[] = [];
  private roomSegs: RoomSeg[] = [];
  private fastUsed = false;
  /** The pad's share of the current dips (roomPadShare at the music volume the latest request was made for). */
  private padShare = ROOM_PAD_SHARE;
  private stoppedAt = Infinity;
  private endT = Infinity;
  private freed = false;

  constructor(ctx: Ctx, out: AudioNode, composer: Composer, t0: number, opts: MusicBedOptions = {}) {
    this.ctx = ctx;
    this.composer = composer;
    this.t0 = Math.max(0, fin(t0, 0));
    this.nextBarT = this.t0;
    this.log = opts.log ? [] : null;
    this.pr = clamp(fin(opts.pitch, 1), 0.5, 2);
    // session bus: ([pads] -> pad room dip) + ([mallets, each with its own scheduled echo, + bubbles] -> melody room dip)
    //   -> duck -> fadeIn -> fadeOut -> pause -> head -> out
    // There is deliberately no DelayNode here: with one, an offline render scheduled in live-like slices differed from the
    // same score scheduled in one go (Chromium delayed the echo copy by a render-quantum-sized amount depending on when the
    // notes were connected). Each note now schedules its own echo, so live and offline renders are identical.
    const bag = new Bag(ctx, out, 'musicBus', 0);
    this.bus = bag;
    this.fadeOut = bag.gain(1);
    this.pauseG = bag.gain(1);
    const fadeIn = bag.gain(0);
    this.duckG = bag.gain(1);
    this.roomMel = bag.gain(1);
    this.roomPad = bag.gain(1);
    const lay = opts.layers ?? {};
    this.melBus = bag.gain(clamp(fin(lay.mallet, 1), 0, 4));
    this.padIn = bag.gain(clamp(fin(lay.pad, 1), 0, 4));
    this.padFill = bag.gain(1);
    this.duckG.connect(fadeIn); fadeIn.connect(this.fadeOut); this.fadeOut.connect(this.pauseG); this.pauseG.connect(bag.head);
    this.melBus.connect(this.roomMel); this.roomMel.connect(this.duckG);
    this.padIn.connect(this.padFill); this.padFill.connect(this.roomPad); this.roomPad.connect(this.duckG);
    // The session bus is stereo for its whole life. Otherwise the first panned note connected mid-session switches the bus
    // and the master chain from mono to stereo processing, and the new channel's filter/limiter state starts from zero (a
    // small transient; measured as a live-vs-offline difference before this was fixed).
    for (const n of [this.melBus, this.padIn, this.padFill, this.roomMel, this.roomPad, this.duckG, fadeIn, this.fadeOut, this.pauseG, bag.head]) {
      n.channelCount = 2; n.channelCountMode = 'explicit'; n.channelInterpretation = 'speakers';
    }
    const fi = clamp(fin(opts.fadeInS, FADE_IN_S), 0.05, 10);
    fadeIn.gain.setValueCurveAtTime(curve(0, 1), this.t0, fi);
  }

  get alive(): boolean { return !this.freed && this.ctx.currentTime < this.endT + 0.05; }
  get stopped(): boolean { return this.stoppedAt < Infinity; }
  /** Context time at which a stopped session is silent (Infinity while playing). */
  get endTime(): number { return this.endT; }
  /** True while the slow (ceremony) duck holds or an effect's room dip of more than 1 dB is requested right now. */
  get isDucked(): boolean { return this.ducked || this.roomTargetAt(this.ctx.currentTime) < 0.891; }
  /** The gain an effect's room hold asks for at time t (1 = none; the return after the last hold counts as none). */
  roomTargetAt(t: number): number {
    let d = 0;
    for (const h of this.holds) if (h.at <= t && h.until > t) d = Math.min(d, h.db);
    return dbToGain(d);
  }
  /** The planned room level (dB, melody scale) at time t: the schedule the gain nodes follow (they lag it by a few ms on
   *  the way down and by about one ROOM_STEP_S on the way back). */
  roomLevelAt(t: number): number {
    let s: RoomSeg | null = null;
    for (const q of this.roomSegs) { if (q.t <= t) s = q; else break; }
    if (!s) return 0;
    return s.rate > 0 ? Math.min(s.to, s.db + s.rate * (t - s.t)) : s.db;
  }

  /** Sounding note groups at time t (pads, mallets and bubbles whose span covers t). */
  liveAt(t: number): number {
    let n = 0;
    for (const s of this.spans) if (s.t <= t && s.end > t) n++;
    return n;
  }

  /** Same, without the pads. */
  private liveNotesAt(t: number): number {
    let n = 0;
    for (const s of this.spans) if (!s.pad && s.t <= t && s.end > t) n++;
    return n;
  }

  /** Plan bars up to one bar past `until` and build the audio of every note that starts before `until`. */
  advance(until: number): void {
    if (this.freed) return;
    const horizon = Math.min(fin(until, 0), this.stoppedAt);
    while (this.nextBarT < horizon + BAR_S) {
      const b = this.composer.nextBar();
      const bt = this.nextBarT;
      if (b.fieldStart || this.first) {
        this.pending.push({ t: bt, kind: 'pad', midi: 0, field: b.field, vel: 1, pan: 0, seed: b.seed, end: bt + b.barsLeft * BAR_S });
      }
      this.first = false;
      let busy = 0;
      for (const n of b.notes) {
        const t = bt + n.at;
        if (t < this.t0 + FIRST_NOTE_S) continue;
        if (n.kind === 'mallet') busy++;
        this.pending.push({ t, kind: n.kind, midi: n.midi, field: b.field, vel: n.vel, pan: n.pan, seed: n.seed, end: 0 });
      }
      // the pad fills the melody's rests (planned with the bar, so live and offline schedule the same automation)
      const fdb = busy === 0 ? PAD_FILL_DB : busy === 1 ? PAD_FILL_DB / 2 : 0;
      const ft = Math.max(this.t0, bt - PAD_FILL_LEAD_S, this.fillAt);
      try { this.padFill.gain.setTargetAtTime(dbToGain(fdb), ft, PAD_FILL_TC); } catch { /* closed */ }
      this.fillAt = ft;
      this.nextBarT += BAR_S;
    }
    this.pending.sort((a, b) => a.t - b.t);
    while (this.pending.length && this.pending[0].t < horizon) this.play(this.pending.shift() as Pending);
    // trim spans long gone (keeps liveAt() O(live))
    if (this.spans.length > 24) { const now = this.ctx.currentTime; this.spans = this.spans.filter((s) => s.end > now - 1); }
  }

  private play(e: Pending): void {
    const now = this.ctx.currentTime;
    let t = e.t;
    if (t < now) {
      // a stalled main thread: stale notes are dropped instead of piling up late; a pad starts now, however late, as long as
      // its field has more than a second left (a field lasts 29-58 s: dropping its pad would leave the mallets over nothing)
      if (e.kind !== 'pad' || now > e.end - 1) { this.stats.late++; this.logIt(e, t, t, 'late'); return; }
      t = now + 0.005;
    }
    if (e.kind !== 'pad' && this.liveNotesAt(t) >= MAX_LIVE_NOTES - PAD_SLOTS) { this.stats.dropped++; this.logIt(e, t, t, 'cap'); return; }
    let end: number;
    if (e.kind === 'pad') {
      const p = padChord(this.ctx, this.padIn, t, e.end, FIELDS[e.field], e.seed, this.pr);
      this.groups.push(p.bag); end = p.end; this.stats.pads++;
    } else if (e.kind === 'mallet') {
      const m = mallet(this.ctx, this.melBus, t, midiHz(e.midi) * this.pr, e.vel, e.pan, e.seed);
      this.groups.push(m.bag); end = m.end; this.stats.notes++;
    } else {
      // the game's Minnaert bubble, tuned (musicBubble): a small upward settle centred on the note, a slightly longer ring
      end = musicBubble(this.ctx, this.melBus, t, midiHz(e.midi) * this.pr, BUBBLE_LEVEL * e.vel);
      this.stats.bubbles++;
    }
    this.spans.push({ t, end, pad: e.kind === 'pad' });
    this.stats.maxLive = Math.max(this.stats.maxLive, this.liveAt(t));
    this.logIt(e, t, end);
    if (this.groups.length > 16) this.groups = this.groups.filter((g) => g.alive);
  }

  private logIt(e: Pending, t: number, end: number, dropped?: 'cap' | 'late'): void {
    if (!this.log) return;
    const midi = e.kind === 'pad' ? FIELDS[e.field].pad.slice() : [e.midi];
    this.log.push({ t, end, kind: e.kind, midi, field: e.field, vel: e.vel, ...(dropped ? { dropped } : {}) });
  }

  /** Duck the session by DUCK_DB from `from` until at least `until` (repeated calls extend it). Smooth: setTarget only. */
  duckSpan(from: number, until: number): void {
    if (this.freed) return;
    const a = Math.max(0, fin(from, 0)), b = fin(until, a);
    if (!this.ducked) {
      this.duckG.gain.setTargetAtTime(dbToGain(DUCK_DB), a, DUCK_ATTACK_TC);
      this.ducked = true;
      this.duckUntil = b;
    } else this.duckUntil = Math.max(this.duckUntil, b);
  }

  /** Release the duck once `now` has passed the last hold (the engine calls this every tick; offline renders script it). */
  pollDuck(now: number): void {
    if (this.freed || !this.ducked || !(now >= this.duckUntil)) return;
    this.duckG.gain.setTargetAtTime(1, Math.max(this.duckUntil, this.ctx.currentTime), DUCK_RELEASE_TC);
    this.ducked = false;
  }

  /**
   * Make room for an effect (a sidechain-style dip keyed by the effect voices): dip by `db` (<= 0, melody scale; the pad
   * takes ROOM_PAD_SHARE of it in dB) from `opts.at` (default `from`) until `until`, going down with time constant
   * `opts.atk` (default ROOM_ATTACK_TC). `from` is when the request is made (the plan is re-built from there); calls must
   * come in that order (live: currentTime; offline: scripted). Every call is a "hold"; the session keeps the active holds
   * and plans the level as a staircase: at every moment the deepest active hold wins (a soft call never cuts a deeper one
   * short); going down follows the hold's attack, going back up is a dB-linear return (ROOM_RETURN_S for the full depth)
   * built from short setTargetAtTime steps. Only this node's own future plan (from `from`) is ever cancelled and
   * setTargetAtTime always starts from the current value, so the gain never jumps. `opts.gainDb` (the music volume's gain
   * above its default, already included in `db`) sets the pad's share (roomPadShare: its dip deepens by the whole boost).
   */
  makeRoom(from: number, until: number, db: number = ROOM_DB, opts: { at?: number; atk?: number; gainDb?: number } = {}): void {
    if (this.freed) return;
    const a = Math.max(0, fin(from, 0), this.roomFrom);
    const d = clamp(fin(db, ROOM_DB), -30, 0);
    if (!(d < -0.05)) return;
    if (opts.gainDb !== undefined) this.padShare = roomPadShare(opts.gainDb);
    const at = Math.max(a, fin(opts.at, a));
    const b = Math.min(Math.max(at + 0.02, fin(until, at)), at + ROOM_MAX_HOLD_S);
    const atk = clamp(fin(opts.atk, ROOM_ATTACK_TC), 0.0005, 0.25);
    // drop expired holds and holds the new one covers; a call an existing hold already covers changes nothing
    this.holds = this.holds.filter((h) => h.until > a && !(h.db >= d && h.at >= at && h.until <= b));
    if (this.holds.some((h) => h.db <= d && h.at <= at && h.until >= b)) return;
    this.holds.push({ at, until: b, db: d, atk });
    this.roomFrom = a;
    this.planRoom(a);
  }

  /** Re-plan the room level from `a` on, from the active holds and the level the previous plan had reached at `a`. */
  private planRoom(a: number): void {
    const pts = [a];
    for (const h of this.holds) { if (h.at > a) pts.push(h.at); if (h.until > a) pts.push(h.until); }
    pts.sort((p, q) => p - q);
    const ts = pts.filter((t, i) => i === 0 || t - pts[i - 1] > 1e-6);
    const want = (t: number): { db: number; atk: number } => {
      let db = 0, atk = ROOM_ATTACK_TC;
      for (const h of this.holds) if (h.at <= t + 1e-9 && h.until > t + 1e-9 && (h.db < db || (h.db === db && h.atk < atk))) { db = h.db; atk = h.atk; }
      return { db, atk };
    };
    // the state at `a` comes from the plan strictly before it: cancelScheduledValues(a) also removes events AT `a` (a second
    // request in the same call, e.g. a slow-onset voice's soft first stage), so whatever holds at `a` is emitted again
    let prev: RoomSeg | null = null;
    for (const q of this.roomSegs) { if (q.t < a) prev = q; else break; }
    let lvl = !prev ? 0 : prev.rate > 0 ? Math.min(prev.to, prev.db + prev.rate * (a - prev.t)) : prev.db;
    const returning = !!prev && prev.rate > 0 && lvl < prev.to - 0.01;
    const out: RoomSeg[] = [];
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i], next = i + 1 < ts.length ? ts[i + 1] : Infinity;
      const w = want(t);
      if (w.db < lvl - 0.01) { out.push({ t, db: w.db, to: w.db, rate: 0, tc: w.atk }); lvl = w.db; }
      else if (w.db > lvl + 0.01) { out.push({ t, db: lvl, to: w.db, rate: ROOM_RETURN_DB_PER_S, tc: ROOM_STEP_TC }); lvl = Math.min(w.db, lvl + ROOM_RETURN_DB_PER_S * (next - t)); }
      else if (i === 0 && returning) out.push({ t, db: lvl, to: lvl, rate: 0, tc: ROOM_STEP_TC });   // a return in progress stops here
      else if (i === 0 && prev && lvl < -0.01) out.push({ t, db: lvl, to: lvl, rate: 0, tc: prev.tc });  // re-state the level held at `a`
    }
    try {
      const pm = this.roomMel.gain, pp = this.roomPad.gain;
      pm.cancelScheduledValues(a); pp.cancelScheduledValues(a);
      for (let i = 0; i < out.length; i++) {
        const s = out[i], end = i + 1 < out.length ? out[i + 1].t : Infinity;
        if (s.rate === 0) {
          pm.setTargetAtTime(dbToGain(s.db), s.t, s.tc);
          pp.setTargetAtTime(dbToGain(s.db * this.padShare), s.t, Math.max(s.tc, ROOM_PAD_ATTACK_TC));
          continue;
        }
        for (let k = 0; k < 400; k++) {
          const tk = s.t + k * ROOM_STEP_S;
          if (tk >= end - 1e-9) break;
          const d = Math.min(s.to, s.db + s.rate * (k + 1) * ROOM_STEP_S);
          pm.setTargetAtTime(dbToGain(d), tk, s.tc);
          pp.setTargetAtTime(dbToGain(d * this.padShare), tk, s.tc);
          if (d >= s.to) break;
        }
      }
    } catch { /* closed context */ }
    this.roomSegs = [...(prev ? [prev] : []), ...out];
  }

  /** Raised-cosine fade to exact silence over `fadeS` from `at`, then nothing more is scheduled. Returns the silent time. */
  stop(at: number, fadeS = FADE_OUT_S): number {
    if (this.stoppedAt < Infinity || this.freed) return this.endT;
    const t = Math.max(this.ctx.currentTime, fin(at, this.ctx.currentTime));
    const f = clamp(fin(fadeS, FADE_OUT_S), 0.02, 6);
    this.stoppedAt = t;
    this.fadeOut.gain.setValueCurveAtTime(curve(1, 0), t, f);
    this.pending.length = 0;
    this.endT = t + f + 0.01;
    return this.endT;
  }

  /**
   * Silent within `fadeS` from `at`, even if a slower fade-out is already running (setPaused(true) during the 1.4 s fade of
   * a music-off or a mute): a second, one-shot raised-cosine on its own gain node. Returns the silent time.
   */
  fastStop(at: number, fadeS = PAUSE_FADE_S): number {
    if (this.freed) return this.endT;
    if (!this.stopped) return this.stop(at, fadeS);
    const t = Math.max(this.ctx.currentTime, fin(at, this.ctx.currentTime));
    const f = clamp(fin(fadeS, PAUSE_FADE_S), 0.02, 6);
    if (this.fastUsed || t + f + 0.01 >= this.endT) return this.endT;
    this.fastUsed = true;
    try { this.pauseG.gain.setValueCurveAtTime(curve(1, 0), t, f); } catch { return this.endT; }
    this.endT = t + f + 0.01;
    return this.endT;
  }

  /** Disconnect every node now (after the fade, on pause-suspend, on dispose). Sources are stopped first: a disconnected
   *  oscillator still runs until its stop time, and a pad's stop time can be up to a minute away. */
  free(): void {
    if (this.freed) return;
    this.freed = true;
    this.pending.length = 0;
    const now = this.ctx.currentTime;
    for (const g of this.groups) { g.stopAll(now); g.free(); }
    this.groups.length = 0;
    this.bus.free();
  }
}
