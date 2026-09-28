// DYEFIELD — the audio router (CONTRACT_P6_11 §21): SimEvents + the frame context → sound commands.
// THREE-free, DOM-free and deterministic (its own seeded PRNG, its own clock advanced by update(dt)), so
// _harness/probe_audio.ts drives it with a real node match and checks what it asks for. The WebAudio side
// (engine.ts) only executes the commands: one-shots, keyed loops, music cues, ducks.
//
// Mixing model: every sprite sound carries its measured level (manifest ldb); a sound's base gain levels it to
// its category target (CAT_TARGET_DB), then the event scales it. World sounds are positional (the engine's
// PannerNode uses distModel(cat), and the router estimates the same attenuation to cull far sounds and to
// score voices); the human's own sounds are 2D. Priorities (pri) decide who wins when the voice limit bites.
//
// Music is driven from the match itself: countdown → the lobby cue fades; horn 'start' → 'match';
// horn 'minute' → 'final' at the next bar (the final-minute intensification); horn 'final10' → +1.5 dB;
// horn 'end' → fade out. The integrator plays 'lobby' and the 'victory' / 'defeat' stingers.

import type { SimEvent, SimEventType } from '../core/match/events.ts';
import { MATCH } from '../core/config.ts';
import { KIND_CLOUD, PSTATE_HOVER } from '../core/combat/projectiles.ts';
import { mulberry32 } from '../core/rng.ts';
import { SFX, type SfxCategory, type SfxId } from './manifest.ts';
import type { AudioFrame, AudioRunner, HornKind, MusicCue, UiSound } from './types.ts';

/** realtime-synthesised sounds (engine.ts builds them from oscillators; no asset) */
export type ProcId = 'charge';
export type SoundId = SfxId | ProcId;
export type Bus = 'sfx' | 'ui';

export interface Vec3T { x: number; y: number; z: number }

export interface PlayCmd {
  id: SoundId;
  /** linear gain before distance attenuation */
  gain: number;
  rate: number;
  /** world position, or null = 2D (the human's own sounds, UI, horns) */
  pos: Vec3T | null;
  /** voice priority (0 lowest … 10 horn) */
  pri: number;
  /** estimated audible gain at the listener (gain × distance attenuation) — voice score tiebreak */
  est: number;
  bus: Bus;
  /** index into the sound's variants */
  variant: number;
}

export interface LoopCmd {
  id: SoundId;
  gain: number;
  rate: number;
  pos: Vec3T | null;
  bus: Bus;
  /** free parameter for procedural loops (charge: 0..1) */
  param: number;
}

export type MusicCmd =
  | { t: 'play'; cue: MusicCue; at: 'now' | 'bar' }
  | { t: 'stop'; fade: number }
  | { t: 'boost'; db: number }
  /** decode ahead (the countdown asks for the match cues so the start horn is on time) */
  | { t: 'prefetch'; cues: readonly MusicCue[] };

export interface AudioSink {
  play(c: PlayCmd): void;
  /** start / update a keyed loop; null stops it */
  loop(key: string, c: LoopCmd | null): void;
  music(c: MusicCmd): void;
  /** duck to `music` / `sfx` (0..1) for `seconds`, then recover */
  duck(seconds: number, music: number, sfx: number): void;
}

// ── levels ──────────────────────────────────────────────────────────────────────────────────
/**
 * perceived-level targets per category (dBFS RMS of the loudest 400 ms, before the buses). Reference: the music is
 * mastered to −15…−17 LUFS and its bus defaults to 0.45 (≈ −23 LUFS at the master), so the human's own shots sit
 * level with the music, impacts / washes / horns above it, and beds (loops, ambience) below it.
 */
export const CAT_TARGET_DB: { readonly [K in SfxCategory]: number } = {
  ui: -23, flow: -21, horn: -14, weapon: -21, impact: -19, splat: -23, hit: -18, big: -16, move: -25, loop: -26, amb: -33,
};
const PROC_GAIN: { readonly [K in ProcId]: number } = { charge: 0.07 };
const PROC_CAT: { readonly [K in ProcId]: SfxCategory } = { charge: 'loop' };

export function categoryOf(id: SoundId): SfxCategory {
  return id === 'charge' ? PROC_CAT.charge : SFX[id].cat;
}

export function baseGain(id: SoundId): number {
  if (id === 'charge') return PROC_GAIN.charge;
  const e = SFX[id];
  return Math.min(4, Math.pow(10, (CAT_TARGET_DB[e.cat] - e.ldb) / 20));
}

/** PannerNode 'inverse' distance model per category (engine.ts uses the same numbers) */
export function distModel(cat: SfxCategory): { ref: number; roll: number } {
  switch (cat) {
    case 'splat': case 'move': return { ref: 2, roll: 1.5 };
    case 'impact': return { ref: 4, roll: 1.1 };
    case 'big': return { ref: 6, roll: 0.9 };
    case 'loop': return { ref: 3, roll: 1.3 };
    default: return { ref: 3, roll: 1.2 };
  }
}
export const MAX_DISTANCE = 80;

export function attenuation(cat: SfxCategory, d: number): number {
  const { ref, roll } = distModel(cat);
  const dd = Math.min(Math.max(d, ref), MAX_DISTANCE);
  return ref / (ref + roll * (dd - ref));
}

/** sounds quieter than this at the listener are not played at all */
export const MIN_EST = 0.004;

// ── the event map (typecheck forces every SimEvent type to be listed) ───────────────────────
export interface EventSoundSpec { readonly ids: readonly SoundId[]; readonly note: string }
export const EVENT_SOUNDS: { readonly [K in SimEventType]: EventSoundSpec } = {
  shot: { ids: ['shot_mist', 'shot_drum', 'shot_pop'], note: 'per kit (MIST-RASP squirt / SHEET-DRUM flick release / POP-WELL thoomp); NEEDLE-GLINT is voiced by its beam' },
  dry: { ids: ['dry'], note: 'the human only (bots dry-firing are silent)' },
  splat: { ids: ['splat'], note: 'impacts r ≥ 0.75 m, pitch by size ± jitter, nearest first, ≤ 1 per 45 ms and 14/s; drips, rain drops, beam lines and ring points are deliberately silent (their parent sound carries them)' },
  hit: { ids: ['hit_dealt', 'hit_taken', 'splat'], note: 'dealt by the human: hit marker tick; taken by the human: thump; others: a quiet splat at the hit' },
  washed: { ids: ['washed_me', 'washed', 'confirm'], note: 'the human washed: big splash + slate duck; anyone else: splash at the victim (+ a confirm chime when the human washed them)' },
  respawn: { ids: ['respawn'], note: 'the spout at the pad' },
  slick: { ids: ['slick_in', 'slick_out'], note: 'dive in / surface (others within earshot)' },
  jump: { ids: ['jump'], note: 'the human only' },
  land: { ids: ['land', 'land_hard'], note: 'the human; others only on hard landings' },
  tankLow: { ids: ['tank_low'], note: 'the human only (pairs with the HUD line)' },
  special: { ids: ['special_ready', 'cloud_throw', 'leap'], note: "ready: the human only; start: CLOUDBURST throw / WELLSPRING leap; 'end' is deliberately silent (the rain loop / slam carry it)" },
  sub: { ids: ['sub_throw', 'sub_land', 'sub_pop'], note: 'JELLY CHARGE throw / land (squelch + fizz for the fuse) / pop' },
  horn: { ids: ['horn_start', 'beep_go', 'horn_minute', 'horn_final', 'horn_end'], note: 'the score horn (+ ducking); drives the music cues; final10 starts the 9…1 ticks' },
  phase: { ids: ['beep'], note: 'countdown: 3-2-1 beeps (from ctx.countdown); the lobby cue fades' },
  glint: { ids: ['charge'], note: 'NEEDLE-GLINT charge whine loop (procedural, pitch = charge); enemies hear it within 22 m' },
  beam: { ids: ['shot_needle'], note: 'NEEDLE-GLINT release, bigger with charge' },
  burst: { ids: ['burst'], note: 'POP-WELL blast' },
  roll: { ids: ['roll_loop'], note: 'SHEET-DRUM rolling loop while the drum is down' },
  flick: { ids: ['flick'], note: 'SHEET-DRUM flick windup' },
  ring: { ids: ['slam'], note: 'WELLSPRING slam' },
};

/** sounds driven by state rather than an event (update()) or by the API */
export const STATE_SOUNDS: readonly { readonly ids: readonly SoundId[]; readonly note: string }[] = [
  { ids: ['swim_loop'], note: 'the human in slick form (gain/pitch by speed); up to 2 other swimmers within 10 m' },
  { ids: ['refill_loop'], note: 'the refill gurgle while the human drinks (slick + tank rising)' },
  { ids: ['rain_loop', 'thunder'], note: 'one rain loop per hovering CLOUDBURST cell (ctx.projectiles); thunder when a cell starts raining' },
  { ids: ['conveyor_loop'], note: 'belt hum at the nearest point of the nearest conveyor within 18 m (ctx.conveyors)' },
  { ids: ['spring'], note: 'tide-spring launch (runner.launches grew)' },
  { ids: ['tick'], note: 'final-10 ticks at 9…1 s left (last three higher)' },
  { ids: ['amb_harbor', 'amb_works'], note: 'map ambience bed (Pier 18 / Cinder Reef harbour, Lockwell works)' },
  { ids: ['ui_hover', 'ui_click', 'ui_back', 'ui_start'], note: 'GameAudio.ui()' },
];

const UI_IDS: { readonly [K in UiSound]: SfxId } = { hover: 'ui_hover', click: 'ui_click', back: 'ui_back', start: 'ui_start' };
const HORN_IDS: { readonly [K in HornKind]: SfxId } = { start: 'horn_start', minute: 'horn_minute', final10: 'horn_final', end: 'horn_end' };
const MAX_RUNNERS = 64;
const SPLAT_MIN_R = 0.75;
const SPLAT_GAP = 0.045;
const SPLAT_PER_S = 14;

export function ambienceFor(map: string): SfxId {
  return map === 'lockwell' ? 'amb_works' : 'amb_harbor';
}

interface PendingSplat { x: number; y: number; z: number; gain: number; rate: number; est: number }

export class AudioRouter {
  /** router clock (s): advanced by update(dt), frozen while paused */
  t = 0;
  me = 0;
  frame: AudioFrame | null = null;
  paused = false;
  map = 'pier18';
  inMatch = false;
  /** the end horn sounded: world loops stay off until the next countdown */
  matchOver = false;
  cue: MusicCue | null = null;
  /** plays per sound id, culls per reason (the probe reads these) */
  readonly counts: Record<string, number> = {};
  readonly culled: Record<string, number> = {};
  /** loop starts per sound id (a keyed loop counts once each time it (re)starts) — harness read-back */
  readonly loopStarts: Record<string, number> = {};
  private readonly rnd: () => number;
  private readonly lastVariant: Record<string, number> = {};
  private readonly lastShot = new Float64Array(MAX_RUNNERS).fill(-1e9);
  private readonly lastSlick = new Float64Array(MAX_RUNNERS).fill(-1e9);
  private readonly rolling = new Uint8Array(MAX_RUNNERS);
  private readonly launchSeen = new Int32Array(MAX_RUNNERS).fill(-1);
  private readonly charging = new Map<number, { until: number; charge: number; x: number; y: number; z: number }>();
  private readonly bigs: Array<{ x: number; y: number; z: number; t: number }> = [];
  private readonly splatTimes: number[] = [];
  private pending: PendingSplat[] = [];
  private lastSplat = -1e9;
  private lastHitDealt = -1e9;
  private lastHitTaken = -1e9;
  private readonly lastHorn: Record<string, number> = {};
  private lastTank = -1;
  private refillHold = 0;
  private readonly cloudSeen = new Map<string, number>();
  private readonly cloudFallback: Array<{ key: string; x: number; y: number; z: number; until: number }> = [];
  private lastBeep = 0;
  private beepT = -1;
  private lastTick = 0;
  private tickT = -1;
  private ambId: SfxId | null = null;
  private readonly active = new Set<string>();
  private readonly wanted = new Set<string>();

  constructor(seed: number = 0x5eed) {
    this.rnd = mulberry32(seed);
  }

  // ── API-side entry points ─────────────────────────────────────────────────────────────────
  music(cue: MusicCue, map: string | undefined, sink: AudioSink): void {
    if (map) this.map = map;
    if (cue === 'lobby') {
      this.inMatch = false;
      this.resetMatch(sink);
      this.ambId = 'amb_harbor';
    } else if (cue === 'match' || cue === 'final') {
      this.inMatch = true;
      this.ambId = ambienceFor(this.map);
    } else {
      sink.duck(2.0, 1, 0.7);
    }
    if (this.cue === cue && (cue === 'lobby' || cue === 'match' || cue === 'final')) return;
    this.cue = cue;
    sink.music({ t: 'play', cue, at: 'now' });
  }

  stopMusic(fade: number, sink: AudioSink): void {
    this.cue = null;
    sink.music({ t: 'stop', fade });
  }

  ui(kind: UiSound, sink: AudioSink): void {
    this.play(sink, UI_IDS[kind], null, 1, 1 + (kind === 'hover' ? (this.rnd() - 0.5) * 0.06 : 0), 9, 'ui');
  }

  horn(kind: HornKind, sink: AudioSink): void {
    const last = this.lastHorn[kind] ?? -1e9;
    if (this.t - last < 1.0) return;                     // the sim's horn and a manual horn() never double up
    this.lastHorn[kind] = this.t;
    const id = HORN_IDS[kind];
    this.play(sink, id, null, 1, 1, 10, 'ui');
    const len = SFX[id].v[0][1];
    sink.duck(len + 0.15, 0.35, 0.55);
    switch (kind) {
      case 'start':
        this.play(sink, 'beep_go', null, 0.8, 1, 10, 'ui');
        this.lastBeep = 0; this.beepT = -1;
        if (this.cue !== 'match' && this.cue !== 'final') { this.cue = 'match'; this.inMatch = true; this.ambId = ambienceFor(this.map); sink.music({ t: 'play', cue: 'match', at: 'now' }); }
        break;
      case 'minute':
        if (this.cue !== 'final') { this.cue = 'final'; sink.music({ t: 'play', cue: 'final', at: 'bar' }); }
        break;
      case 'final10':
        this.tickT = 10; this.lastTick = 10;
        sink.music({ t: 'boost', db: 1.5 });
        break;
      case 'end':
        this.tickT = -1;
        this.matchOver = true;
        this.cue = null;
        sink.music({ t: 'stop', fade: 0.35 });
        this.stopWorldLoops(sink);
        break;
    }
  }

  setMap(map: string): void {
    this.map = map;
    if (this.inMatch) this.ambId = ambienceFor(map);
  }

  // ── events ─────────────────────────────────────────────────────────────────────────────────
  onEvents(events: readonly SimEvent[], frame: AudioFrame, sink: AudioSink): void {
    this.frame = frame;
    this.me = frame.me ?? 0;
    if (frame.map && frame.map !== this.map) this.setMap(frame.map);
    if (this.paused) return;
    const me = this.me;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      switch (e.t) {
        case 'shot': {
          if (e.kit === 'needle-glint') { this.cull('shot:needle-beam'); break; }
          const id: SfxId = e.kit === 'sheet-drum' ? 'shot_drum' : e.kit === 'pop-well' ? 'shot_pop' : 'shot_mist';
          const gap = id === 'shot_mist' ? 0.07 : 0.05;
          if (this.t - this.lastShot[e.pid & 63] < gap) { this.cull('shot:gap'); break; }
          this.lastShot[e.pid & 63] = this.t;
          const mine = e.pid === me;
          this.play(sink, id, mine ? null : { x: e.x, y: e.y, z: e.z }, mine ? 0.8 : 1, this.jit(id === 'shot_mist' ? 0.06 : 0.04), mine ? 7 : 4);
          break;
        }
        case 'dry':
          if (e.pid === me) this.play(sink, 'dry', null, 1, this.jit(0.04), 8, 'ui');
          else this.cull('dry:other');
          break;
        case 'splat': {
          if (e.r < SPLAT_MIN_R) { this.cull('splat:small'); break; }
          const g = Math.min(1, 0.5 + 0.35 * (e.r - SPLAT_MIN_R) + Math.min(0.15, e.flips / 400));
          const rate = Math.min(1.22, Math.max(0.78, 1.25 - 0.2 * e.r)) * this.jit(0.07);
          this.queueSplat(e.x, e.y, e.z, g, rate);
          break;
        }
        case 'hit':
          if (e.by === me && e.victim !== me) {
            if (this.t - this.lastHitDealt >= 0.05) {
              this.lastHitDealt = this.t;
              this.play(sink, 'hit_dealt', null, 1, (1 + Math.min(0.25, e.dmg / 240)) * this.jit(0.03), 8, 'ui');
            } else this.cull('hit:gap');
          } else if (e.victim === me) {
            if (this.t - this.lastHitTaken >= 0.08) {
              this.lastHitTaken = this.t;
              this.play(sink, 'hit_taken', null, 1, this.jit(0.05), 8);
            } else this.cull('hit:gap');
          } else {
            this.queueSplat(e.x, e.y + 0.6, e.z, 0.45, 1.1 * this.jit(0.06));
          }
          break;
        case 'washed': {
          const v = this.runner(e.victim);
          if (e.victim === me) {
            this.play(sink, 'washed_me', null, 1, 1, 9);
            sink.duck(1.4, 0.55, 0.5);
          } else {
            const p = v ? { x: v.x, y: v.y + 0.6, z: v.z } : null;
            if (p) { this.play(sink, 'washed', p, 1, this.jit(0.05), 6); this.big(p.x, p.y, p.z); }
            if (e.by === me) this.play(sink, 'confirm', null, 0.9, 1, 9, 'ui');
          }
          break;
        }
        case 'respawn':
          this.playAt(sink, 'respawn', e.pid, 0.9, this.jit(0.04), 3);
          break;
        case 'slick': {
          if (this.t - this.lastSlick[e.pid & 63] < 0.12) { this.cull('slick:gap'); break; }
          this.lastSlick[e.pid & 63] = this.t;
          const id: SfxId = e.on ? 'slick_in' : 'slick_out';
          if (e.pid === me) this.play(sink, id, null, 0.85, (e.wall ? 1.08 : 1) * this.jit(0.05), 5);
          else this.playAt(sink, id, e.pid, 0.7, this.jit(0.06), 1);
          break;
        }
        case 'jump':
          if (e.pid === me) this.play(sink, 'jump', null, 0.55, this.jit(0.08), 3);
          else this.cull('jump:other');
          break;
        case 'land':
          if (e.pid === me) this.play(sink, e.hard ? 'land_hard' : 'land', null, 0.8, this.jit(0.06), 3);
          else if (e.hard) this.playAt(sink, 'land_hard', e.pid, 0.6, this.jit(0.06), 1);
          else this.cull('land:other');
          break;
        case 'tankLow':
          if (e.pid === me) this.play(sink, 'tank_low', null, 1, 1, 8, 'ui');
          else this.cull('tankLow:other');
          break;
        case 'special': {
          const mine = e.pid === me;
          if (e.phase === 'ready') {
            if (mine) this.play(sink, 'special_ready', null, 1, 1, 9, 'ui');
            else this.cull('special:ready-other');
          } else if (e.phase === 'start') {
            const id: SfxId = e.id === 'wellspring' ? 'leap' : 'cloud_throw';
            this.play(sink, id, mine ? null : { x: e.x, y: e.y + 1, z: e.z }, 1, 1, 6);
            if (id === 'cloud_throw' && !(frameHasProjectiles(this.frame))) {
              // no ctx.projectiles: rain where it was thrown from (the real cell position is unknown)
              this.cloudFallback.push({ key: `rainfb:${e.pid}:${this.t.toFixed(2)}`, x: e.x, y: e.y + 2.8, z: e.z, until: this.t + 7.2 });
            }
          } else this.cull('special:end');
          break;
        }
        case 'sub': {
          const p = { x: e.x, y: e.y, z: e.z };
          if (e.phase === 'throw') this.play(sink, 'sub_throw', e.pid === me ? null : p, 1, this.jit(0.05), 5);
          else if (e.phase === 'land') this.play(sink, 'sub_land', p, 1, this.jit(0.05), 4);
          else { this.play(sink, 'sub_pop', p, 1, this.jit(0.04), 6); this.big(p.x, p.y, p.z); }
          break;
        }
        case 'horn':
          this.horn(e.kind, sink);
          break;
        case 'phase':
          if (e.phase === 'countdown') {
            this.inMatch = true;
            this.matchOver = false;
            this.ambId = ambienceFor(this.map);
            if (this.cue === 'lobby' || this.cue === 'victory' || this.cue === 'defeat') { this.cue = null; sink.music({ t: 'stop', fade: 0.6 }); }
            sink.music({ t: 'prefetch', cues: ['match', 'final'] });
            this.lastBeep = 0;
            this.beepT = frame.countdown === undefined ? MATCH.countdownS : -1;
            this.lastTick = 0; this.tickT = -1;
          } else if (e.phase === 'live') {
            this.beepT = -1;
          }
          break;
        case 'glint': {
          const c = this.charging.get(e.pid);
          if (c) { c.until = this.t + 0.22; c.charge = e.charge; c.x = e.x; c.y = e.y; c.z = e.z; }
          else this.charging.set(e.pid, { until: this.t + 0.22, charge: e.charge, x: e.x, y: e.y, z: e.z });
          break;
        }
        case 'beam': {
          this.charging.delete(e.pid);
          const mine = e.pid === me;
          this.play(sink, 'shot_needle', mine ? null : { x: e.x0, y: e.y0, z: e.z0 }, 0.7 + 0.35 * e.charge, (1.12 - 0.2 * e.charge) * this.jit(0.03), mine ? 7 : 5);
          break;
        }
        case 'burst':
          this.play(sink, 'burst', { x: e.x, y: e.y, z: e.z }, 1, (e.air ? 1.1 : 1) * this.jit(0.05), 5);
          this.big(e.x, e.y, e.z);
          break;
        case 'roll':
          this.rolling[e.pid & 63] = e.on ? 1 : 0;
          break;
        case 'flick':
          this.playAt(sink, 'flick', e.pid, 0.9, this.jit(0.05), 4);
          break;
        case 'ring':
          this.play(sink, 'slam', { x: e.x, y: e.y, z: e.z }, 1, this.jit(0.03), 7);
          this.big(e.x, e.y, e.z);
          break;
        default: {
          const never: never = e;
          void never;
        }
      }
    }
    this.flushSplats(sink);
  }

  // ── state-driven sounds (every frame) ─────────────────────────────────────────────────────
  update(dt: number, sink: AudioSink): void {
    if (this.paused) return;
    const step = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    this.t += step;
    this.wanted.clear();
    const f = this.frame;
    if (this.ambId) this.want(sink, 'amb', { id: this.ambId, gain: baseGain(this.ambId) * (this.inMatch ? 1 : 0.8), rate: 1, pos: null, bus: 'sfx', param: 0 });
    if (f && this.inMatch && !this.matchOver && f.phase !== 'ended') {
      this.ownLoops(f, sink, step);
      this.otherSwimmers(f, sink);
      this.rolls(f, sink);
      this.charges(f, sink);
      this.clouds(f, sink);
      this.conveyor(f, sink);
      this.springs(f, sink);
      this.flowTimers(f, sink, step);
    }
    for (const k of this.active) if (!this.wanted.has(k)) { sink.loop(k, null); this.active.delete(k); }
    // forget old bigs / splat times
    while (this.bigs.length && this.t - this.bigs[0].t > 0.3) this.bigs.shift();
    while (this.splatTimes.length && this.t - this.splatTimes[0] > 1) this.splatTimes.shift();
  }

  setPaused(p: boolean): void { this.paused = p; }

  /** leaving the match: stop every world loop, forget per-match state */
  resetMatch(sink: AudioSink): void {
    this.stopWorldLoops(sink);
    this.inMatch = false;
    this.matchOver = false;
    this.lastShot.fill(-1e9); this.lastSlick.fill(-1e9); this.launchSeen.fill(-1);
    this.cloudSeen.clear(); this.cloudFallback.length = 0;
    this.lastBeep = 0; this.beepT = -1; this.lastTick = 0; this.tickT = -1;
    this.lastTank = -1; this.refillHold = 0;
    this.pending = [];
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────
  private stopWorldLoops(sink: AudioSink): void {
    this.rolling.fill(0);
    this.charging.clear();
    for (const k of [...this.active]) if (k !== 'amb') { sink.loop(k, null); this.active.delete(k); }
  }

  private ownLoops(f: AudioFrame, sink: AudioSink, dt: number): void {
    const r = this.runner(this.me);
    if (!r) return;
    const slick = r.alive && (r.slickForm ?? (r.state === 'slick' || r.state === 'wallslick'));
    const sp = Math.min(1, Math.max(0, (r.speed ?? 0) / 8.4));
    if (slick) this.want(sink, 'swim', { id: 'swim_loop', gain: baseGain('swim_loop') * (0.35 + 0.65 * sp), rate: 0.92 + 0.16 * sp, pos: null, bus: 'sfx', param: 0 });
    const rising = slick && this.lastTank >= 0 && r.tank > this.lastTank + 1e-4 && r.tank < 99.9;
    this.refillHold = rising ? 0.35 : Math.max(0, this.refillHold - dt);
    if (this.refillHold > 0 && slick) {
      this.want(sink, 'refill', { id: 'refill_loop', gain: baseGain('refill_loop') * 0.9, rate: 0.9 + 0.2 * Math.min(1, r.tank / 100), pos: null, bus: 'sfx', param: 0 });
    }
    this.lastTank = r.tank;
  }

  private otherSwimmers(f: AudioFrame, sink: AudioSink): void {
    const rs = f.runners;
    if (!rs) return;
    let a = -1, ad = 1e9, b = -1, bd = 1e9;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      if (r.id === this.me || !r.alive || !(r.slickForm ?? (r.state === 'slick' || r.state === 'wallslick')) || (r.speed ?? 0) < 2.5) continue;
      const d = this.dist(r.x, r.y, r.z);
      if (d > 10) continue;
      if (d < ad) { b = a; bd = ad; a = i; ad = d; } else if (d < bd) { b = i; bd = d; }
    }
    for (const i of [a, b]) {
      if (i < 0) continue;
      const r = rs[i];
      this.want(sink, `swim:${r.id}`, { id: 'swim_loop', gain: baseGain('swim_loop') * 0.5 * Math.min(1, (r.speed ?? 0) / 8.4), rate: 1.05, pos: { x: r.x, y: r.y + 0.2, z: r.z }, bus: 'sfx', param: 0 });
    }
  }

  private rolls(f: AudioFrame, sink: AudioSink): void {
    for (let pid = 0; pid < MAX_RUNNERS; pid++) {
      if (!this.rolling[pid]) continue;
      const r = this.runner(pid);
      if (!r || !r.alive) { this.rolling[pid] = 0; continue; }
      const sp = Math.min(1, Math.max(0, (r.speed ?? 3) / 4.5));
      const mine = pid === this.me;
      this.want(sink, `roll:${pid}`, {
        id: 'roll_loop', gain: baseGain('roll_loop') * (mine ? 0.9 : 1) * (0.35 + 0.65 * sp), rate: 0.9 + 0.25 * sp,
        pos: mine ? null : { x: r.x, y: r.y + 0.3, z: r.z }, bus: 'sfx', param: sp,
      });
    }
  }

  private charges(f: AudioFrame, sink: AudioSink): void {
    for (const [pid, c] of this.charging) {
      if (this.t > c.until) { this.charging.delete(pid); continue; }
      const mine = pid === this.me;
      if (!mine && this.dist(c.x, c.y, c.z) > 22) continue;
      this.want(sink, `charge:${pid}`, { id: 'charge', gain: baseGain('charge') * (0.45 + 0.55 * c.charge), rate: 1, pos: mine ? null : { x: c.x, y: c.y, z: c.z }, bus: 'sfx', param: c.charge });
    }
  }

  private clouds(f: AudioFrame, sink: AudioSink): void {
    const P = f.projectiles;
    if (P) {
      const n = Math.min(P.count, P.kind.length);
      for (let i = 0; i < n; i++) {
        if (P.kind[i] !== KIND_CLOUD || P.state[i] !== PSTATE_HOVER) continue;
        const x = P.x[i], y = P.y[i], z = P.z[i];
        const key = `rain:${Math.round(x * 2)},${Math.round(z * 2)}`;
        if (!this.cloudSeen.has(key)) this.play(sink, 'thunder', { x, y: y + 2, z }, 1, this.jit(0.05), 5);
        this.cloudSeen.set(key, this.t);
        this.want(sink, key, { id: 'rain_loop', gain: baseGain('rain_loop'), rate: 1, pos: { x, y: y - 1.2, z }, bus: 'sfx', param: 0 });
      }
      for (const [k, t] of this.cloudSeen) if (this.t - t > 1.5) this.cloudSeen.delete(k);
    }
    for (let i = this.cloudFallback.length - 1; i >= 0; i--) {
      const c = this.cloudFallback[i];
      if (this.t > c.until) { this.cloudFallback.splice(i, 1); continue; }
      this.want(sink, c.key, { id: 'rain_loop', gain: baseGain('rain_loop'), rate: 1, pos: { x: c.x, y: c.y, z: c.z }, bus: 'sfx', param: 0 });
    }
  }

  private conveyor(f: AudioFrame, sink: AudioSink): void {
    const cs = f.conveyors;
    if (!cs || !cs.length) return;
    const L = f.listener;
    let best = 1e9, bx = 0, by = 0, bz = 0;
    for (const c of cs) {
      const x = Math.min(Math.max(L.x, c.min[0]), c.max[0]);
      const y = Math.min(Math.max(L.y, c.min[1]), c.max[1]);
      const z = Math.min(Math.max(L.z, c.min[2]), c.max[2]);
      const d = Math.hypot(x - L.x, y - L.y, z - L.z);
      if (d < best) { best = d; bx = x; by = y; bz = z; }
    }
    if (best <= 18) this.want(sink, 'conveyor', { id: 'conveyor_loop', gain: baseGain('conveyor_loop'), rate: 1, pos: { x: bx, y: by, z: bz }, bus: 'sfx', param: 0 });
  }

  private springs(f: AudioFrame, sink: AudioSink): void {
    const rs = f.runners;
    if (!rs) return;
    for (let i = 0; i < rs.length && i < MAX_RUNNERS; i++) {
      const r = rs[i];
      const n = r.launches ?? 0;
      const seen = this.launchSeen[r.id & 63];
      this.launchSeen[r.id & 63] = n;
      if (seen < 0 || n <= seen) continue;
      if (r.id === this.me) this.play(sink, 'spring', null, 1, this.jit(0.04), 6);
      else this.play(sink, 'spring', { x: r.x, y: r.y, z: r.z }, 1, this.jit(0.05), 4);
    }
  }

  private flowTimers(f: AudioFrame, sink: AudioSink, dt: number): void {
    // countdown 3-2-1: only once the countdown runs (a world sits at countdown = 3 behind the CLICK TO PLAY card)
    if (f.phase === 'countdown' && f.countdown !== undefined) {
      const k = f.countdown < MATCH.countdownS - 1e-6 ? Math.ceil(f.countdown - 1e-6) : 0;
      if (k >= 1 && k <= 3 && k !== this.lastBeep) { this.lastBeep = k; this.play(sink, 'beep', null, 1, 1, 10, 'ui'); }
    } else if (this.beepT > 0) {
      const k = Math.ceil(this.beepT - 1e-6);
      if (k >= 1 && k <= 3 && k !== this.lastBeep) { this.lastBeep = k; this.play(sink, 'beep', null, 1, 1, 10, 'ui'); }
      this.beepT -= dt;
    }
    // final 10: ticks at 9 … 1 s left (the final10 horn marks 10)
    let left = -1;
    if (f.phase === 'live' && f.timeLeft !== undefined) left = f.timeLeft;
    else if (this.tickT > 0) { this.tickT -= dt; left = this.tickT; }
    if (left > 0 && left < 10 - 1e-6) {
      const k = Math.ceil(left - 1e-6);
      if (k >= 1 && k <= 9 && k !== this.lastTick) {
        this.lastTick = k;
        this.play(sink, 'tick', null, k <= 3 ? 1.25 : 1, k <= 3 ? 1.26 : 1, 10, 'ui');
      }
    }
  }

  private want(sink: AudioSink, key: string, c: LoopCmd): void {
    if (this.wanted.has(key)) return;
    if (c.pos) {
      const est = c.gain * attenuation(categoryOf(c.id), this.dist(c.pos.x, c.pos.y, c.pos.z));
      if (est < MIN_EST) return;
    }
    this.wanted.add(key);
    if (!this.active.has(key)) this.loopStarts[c.id] = (this.loopStarts[c.id] ?? 0) + 1;
    this.active.add(key);
    sink.loop(key, c);
  }

  private queueSplat(x: number, y: number, z: number, gain: number, rate: number): void {
    const d = this.frame ? this.dist(x, y, z) : 0;
    const est = baseGain('splat') * gain * attenuation('splat', d);
    if (est < MIN_EST) { this.cull('splat:far'); return; }
    this.pending.push({ x, y, z, gain, rate, est });
  }

  private flushSplats(sink: AudioSink): void {
    if (!this.pending.length) return;
    const P = this.pending;
    this.pending = [];
    P.sort((a, b) => b.est - a.est);
    let allow = this.t - this.lastSplat >= SPLAT_GAP ? 2 : 0;
    for (const s of P) {
      if (allow <= 0 || this.splatTimes.length >= SPLAT_PER_S) { this.cull('splat:throttle'); continue; }
      if (this.nearBig(s.x, s.y, s.z)) { this.cull('splat:covered'); continue; }
      if (this.play(sink, 'splat', { x: s.x, y: s.y, z: s.z }, s.gain, s.rate, 2)) {
        allow--;
        this.lastSplat = this.t;
        this.splatTimes.push(this.t);
      }
    }
  }

  private big(x: number, y: number, z: number): void {
    this.bigs.push({ x, y, z, t: this.t });
  }

  private nearBig(x: number, y: number, z: number): boolean {
    for (const b of this.bigs) if (this.t - b.t <= 0.15 && Math.hypot(b.x - x, b.y - y, b.z - z) < 3.5) return true;
    return false;
  }

  private playAt(sink: AudioSink, id: SfxId, pid: number, gain: number, rate: number, pri: number): boolean {
    if (pid === this.me) return this.play(sink, id, null, gain, rate, pri + 2);
    const r = this.runner(pid);
    if (!r) { this.cull(`${id}:no-runner`); return false; }
    return this.play(sink, id, { x: r.x, y: r.y + 0.5, z: r.z }, gain, rate, pri);
  }

  private play(sink: AudioSink, id: SoundId, pos: Vec3T | null, gainMul: number, rate: number, pri: number, bus: Bus = 'sfx'): boolean {
    const g = baseGain(id) * gainMul;
    let est = g;
    if (pos) {
      if (this.frame) est *= attenuation(categoryOf(id), this.dist(pos.x, pos.y, pos.z));
      if (est < MIN_EST) { this.cull(`${id}:far`); return false; }
    }
    const n = id === 'charge' ? 1 : SFX[id].v.length;
    let v = 0;
    if (n > 1) {
      v = Math.floor(this.rnd() * n) % n;
      if (v === this.lastVariant[id]) v = (v + 1) % n;
      this.lastVariant[id] = v;
    }
    sink.play({ id, gain: g, rate, pos, pri, est, bus, variant: v });
    this.counts[id] = (this.counts[id] ?? 0) + 1;
    return true;
  }

  private cull(reason: string): void {
    this.culled[reason] = (this.culled[reason] ?? 0) + 1;
  }

  private jit(j: number): number {
    return 1 + (this.rnd() * 2 - 1) * j;
  }

  private dist(x: number, y: number, z: number): number {
    const L = this.frame?.listener;
    return L ? Math.hypot(x - L.x, y - L.y, z - L.z) : 0;
  }

  private runner(pid: number): AudioRunner | null {
    const rs = this.frame?.runners;
    if (!rs) return null;
    const r = rs[pid];
    if (r && r.id === pid) return r;
    for (const q of rs) if (q.id === pid) return q;
    return null;
  }
}

function frameHasProjectiles(f: AudioFrame | null): boolean {
  return !!(f && f.projectiles);
}
