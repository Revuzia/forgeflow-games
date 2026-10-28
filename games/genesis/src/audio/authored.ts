// GENESIS — the AUTHORED music layer (LIVING §0: "authored music"): the title / orbit theme "First Light" and the era
// pieces, composed in src/audio/score/*, rendered offline and shipped as Opus in src/audio/assets/. They share one motif
// and one key (D dorian), so they are woven WITH the procedural score rather than laid over it (a culture's own tune is
// in its own mode and key): an authored piece plays its passes, then rests while the procedural culture or orbital
// music fills in, then returns; the director (musicplayer.ts) fades each under the other.
//
// Era pieces come as stems that loop together, sample-locked: `day` and `night` cross-fade with the daylight, `tension`
// rises over either with war and disaster; `main` always plays. Buffers are decoded on demand (fetch +
// decodeAudioData, off the main thread) and only the playing piece and the one fading out are kept. If a file fails
// to load or decode (an old browser without Opus), the procedural score simply plays on.
//
// The STINGERS (score/stingers.ts) mark the moments between the god and the people: a prayer answered, a prophecy
// fulfilled, a sign sent, the god's wrath. Each is a short phrase on the motif, played once over the music (which the
// engine ducks under it); they are small, so all four are decoded as soon as the music starts.

import type { AudioScene } from './scene.ts';
import type { SimEvent } from '../sim/types.ts';

export type StemRole = 'main' | 'day' | 'night' | 'tension';

export interface AuthoredPiece {
  id: string;
  /** exact loop length, seconds (the encoded file may carry a few ms of codec padding past it) */
  loop: number;
  stems: Partial<Record<StemRole, string>>;
  /** loops per appearance */
  passes: number;
  /** seconds the procedural score plays between appearances */
  rest: number;
  /** linear trim against the procedural score */
  gain: number;
}

/**
 * The shipped pieces. `new URL(literal, import.meta.url)` is resolved by Vite into a hashed asset next to the bundle
 * (works under any base path); in Node (tests) it is a plain file URL that nothing fetches.
 */
export const AUTHORED: Record<string, AuthoredPiece> = {
  title: {
    id: 'title', loop: 40 * 4 * 60 / 70, passes: 1, rest: 75, gain: 0.85,
    stems: { main: new URL('./assets/title.ogg', import.meta.url).href },
  },
  // the era pieces (score/eras.ts): loop = bars × beats per bar × 60 / bpm, exactly as rendered
  'era-stone': {
    id: 'era-stone', loop: 16 * 4 * 60 / 66, passes: 2, rest: 80, gain: 0.85,
    stems: {
      main: new URL('./assets/era-stone-main.ogg', import.meta.url).href,
      day: new URL('./assets/era-stone-day.ogg', import.meta.url).href,
      night: new URL('./assets/era-stone-night.ogg', import.meta.url).href,
      tension: new URL('./assets/era-stone-tension.ogg', import.meta.url).href,
    },
  },
  'era-bronze': {
    id: 'era-bronze', loop: 20 * 4 * 60 / 84, passes: 2, rest: 80, gain: 0.85,
    stems: {
      main: new URL('./assets/era-bronze-main.ogg', import.meta.url).href,
      day: new URL('./assets/era-bronze-day.ogg', import.meta.url).href,
      night: new URL('./assets/era-bronze-night.ogg', import.meta.url).href,
      tension: new URL('./assets/era-bronze-tension.ogg', import.meta.url).href,
    },
  },
  'era-medieval': {
    id: 'era-medieval', loop: 32 * 3 * 60 / 105, passes: 2, rest: 80, gain: 0.85,
    stems: {
      main: new URL('./assets/era-medieval-main.ogg', import.meta.url).href,
      day: new URL('./assets/era-medieval-day.ogg', import.meta.url).href,
      night: new URL('./assets/era-medieval-night.ogg', import.meta.url).href,
      tension: new URL('./assets/era-medieval-tension.ogg', import.meta.url).href,
    },
  },
  'era-engines': {
    id: 'era-engines', loop: 24 * 4 * 60 / 96, passes: 2, rest: 80, gain: 0.85,
    stems: {
      main: new URL('./assets/era-engines-main.ogg', import.meta.url).href,
      day: new URL('./assets/era-engines-day.ogg', import.meta.url).href,
      night: new URL('./assets/era-engines-night.ogg', import.meta.url).href,
      tension: new URL('./assets/era-engines-tension.ogg', import.meta.url).href,
    },
  },
};

export type StingerId = 'answered' | 'fulfilled' | 'sign' | 'wrath';

export interface Stinger {
  id: StingerId;
  url: string;
  /** the phrase's length, seconds (the file runs on with its reverb tail) */
  phrase: number;
  /** linear trim over the music */
  gain: number;
  /** real seconds before the same stinger may play again (a second answered prayer in a minute is not news) */
  gap: number;
  /** which one wins when two arrive together or one would cut another short */
  pri: number;
}

/** the shipped stingers: phrase = 8 beats at the piece's tempo (score/stingers.ts) */
export const STINGERS: Record<StingerId, Stinger> = {
  answered: { id: 'answered', url: new URL('./assets/sting-answered.ogg', import.meta.url).href, phrase: 8 * 60 / 92, gain: 0.8, gap: 30, pri: 1 },
  wrath: { id: 'wrath', url: new URL('./assets/sting-wrath.ogg', import.meta.url).href, phrase: 8 * 60 / 76, gain: 0.85, gap: 20, pri: 2 },
  sign: { id: 'sign', url: new URL('./assets/sting-sign.ogg', import.meta.url).href, phrase: 8 * 60 / 72, gain: 0.8, gap: 20, pri: 3 },
  fulfilled: { id: 'fulfilled', url: new URL('./assets/sting-fulfilled.ogg', import.meta.url).href, phrase: 8 * 60 / 80, gain: 0.85, gap: 20, pri: 4 },
};

/** the player's god (u.god.gods[0]); rival gods and nature send their own disasters and omens unannounced */
const PLAYER_GOD = 0;

/**
 * The stinger a sim event calls for (null: none). Only the god's own acts and what the people make of them:
 * a prayer it answered, a prophecy that came true, a sign it sent (the `omen` the people read: one per town that saw
 * it), a disaster it sent (nature's and rivals' are only news).
 */
export function stingerFor(e: SimEvent): StingerId | null {
  const d = (e.data ?? {}) as Record<string, unknown>;
  switch (e.t) {
    case 'prayer.answered': return 'answered';
    case 'prophet.fulfilled': return 'fulfilled';
    case 'omen': return d.god === PLAYER_GOD ? 'sign' : null;
    // the act itself (only the player sends signs): heard even when no town was there to read it
    case 'command': return d.k === 'god.omen' ? 'sign' : null;
    case 'disaster': return d.god === PLAYER_GOD && d.cause !== 'nature' ? 'wrath' : null;
  }
  return null;
}

/** of a batch of events (one snapshot), the stinger to play: the highest priority (a sign's eclipse is a sign, not wrath) */
export function pickStinger(events: readonly SimEvent[]): StingerId | null {
  let best: StingerId | null = null;
  for (const e of events) {
    const id = stingerFor(e);
    if (id && (!best || STINGERS[id].pri > STINGERS[best].pri)) best = id;
  }
  return best;
}

/** stinger pacing in real time: each its own gap; none cuts a phrase short unless it outranks it */
export class StingerGate {
  private last = new Map<StingerId, number>();
  private playing: { id: StingerId; until: number } | null = null;
  admit(id: StingerId, now: number): boolean {
    const s = STINGERS[id];
    if (now - (this.last.get(id) ?? -Infinity) < s.gap) return false;
    if (this.playing && now < this.playing.until && STINGERS[this.playing.id].pri >= s.pri) return false;
    this.last.set(id, now);
    this.playing = { id, until: now + s.phrase };
    return true;
  }
}

/** the sim's eras (SettlementView.era) → the era piece that sings them */
export const ERA_PIECE: Record<string, string> = {
  stone: 'era-stone', fire: 'era-stone', clay: 'era-stone',
  bronze: 'era-bronze', iron: 'era-bronze', classical: 'era-bronze',
  medieval: 'era-medieval', gunpowder: 'era-medieval',
  steam: 'era-engines', electric: 'era-engines', space: 'era-engines',
};

/** how close a town's music must be (its weight in the scene) before its era's piece is the one that plays */
export const TOWN_NEAR = 0.15;

/** seconds over which a piece fades in / out at the edges of an appearance */
export const FADE_IN = 3;
export const FADE_OUT = 6;
/** an appearance runs this far past its last loop (the folded reverb tail plays out over the quiet intro) */
export const OVERRUN = 4;

/**
 * Which authored piece the scene calls for (null: the procedural score alone). `current` (the piece playing or resting)
 * holds on a little past the thresholds that started it, so a camera hovering at the edge does not restart it.
 */
export function pieceFor(scene: AudioScene | null, current: string | null = null): string | null {
  if (!scene) return null;
  const town = scene.music[0]?.weight ?? 0;
  const hold = (k: string): number => (current === k ? 0.6 : 1);
  if (current === 'title' ? scene.orbital >= 0.25 && town < TOWN_NEAR * 1.6 : scene.orbital >= 0.35 && town < TOWN_NEAR) return AUTHORED.title ? 'title' : null;
  const id = ERA_PIECE[scene.music[0]?.culture.era ?? ''];
  if (id && AUTHORED[id] && town >= TOWN_NEAR * hold(id)) return id;
  return null;
}

export interface Weave {
  piece: string | null;
  phase: 'idle' | 'play' | 'rest';
  /** audio-clock time the current appearance started (play) or the rest began */
  since: number;
  /** when the current phase ends */
  until: number;
}

export function idleWeave(): Weave { return { piece: null, phase: 'idle', since: 0, until: 0 }; }

/**
 * Advance the weave: a newly wanted piece starts at once if its audio is ready (else the procedural score plays until
 * it is); an appearance lasts `passes` loops (+ OVERRUN), then the piece rests for `rest` seconds, then returns.
 */
export function weave(w: Weave, want: string | null, now: number, ready: boolean): Weave {
  const p = want ? AUTHORED[want] : undefined;
  if (!p) return want === w.piece && w.phase === 'idle' ? w : idleWeave();
  if (w.piece !== want || w.phase === 'idle') {
    return ready ? { piece: want, phase: 'play', since: now, until: now + p.passes * p.loop + OVERRUN } : { piece: want, phase: 'idle', since: now, until: now };
  }
  if (now < w.until) return w;
  if (w.phase === 'play') return { piece: want, phase: 'rest', since: now, until: now + p.rest };
  return ready ? { piece: want, phase: 'play', since: now, until: now + p.passes * p.loop + OVERRUN } : { piece: want, phase: 'idle', since: now, until: now };
}

/** 0..1: how much of the authored piece sounds now (the procedural score takes the rest) */
export function weaveLevel(w: Weave, now: number): number {
  if (w.phase !== 'play') return 0;
  const a = Math.min(1, Math.max(0, (now - w.since) / FADE_IN));
  const b = Math.min(1, Math.max(0, (w.until - now) / FADE_OUT));
  return Math.min(a, b);
}

/** the stems' levels from the scene: daylight cross-fades day and night, tension rises over either */
export function stemLevels(scene: AudioScene | null, tension: number): Record<StemRole, number> {
  const day = scene ? Math.max(0, Math.min(1, (scene.day - 0.15) / 0.5)) : 1;
  const t = Math.max(0, Math.min(1, tension));
  return { main: 1, day: Math.sqrt(day), night: Math.sqrt(1 - day), tension: t };
}

/** 0..1 tension the scene carries: war near the listener, fire, quakes, storms, the heartbeat of a dying world */
export function sceneTension(scene: AudioScene | null): number {
  if (!scene) return 0;
  const L = scene.layers;
  const war = scene.music[0]?.culture.war ? 0.8 * Math.min(1, (scene.music[0]?.weight ?? 0) * 3) : 0;
  const danger = Math.max(L.fire * 0.8, L.lava, L.quake, Math.min(1, L.thunderRate * 0.6), L.heartbeat, L.ash * 0.7);
  return Math.max(war, Math.min(1, danger));
}

interface Loaded { buf: AudioBuffer | null; failed: boolean }

/** the playing (or fading) appearance of a piece: its stems, sample-locked, under one fader */
class Voice {
  readonly piece: AuthoredPiece;
  private readonly ctx: BaseAudioContext;
  readonly fader: GainNode;
  private readonly stems = new Map<StemRole, { src: AudioBufferSourceNode; g: GainNode }>();
  constructor(ctx: BaseAudioContext, dest: AudioNode, piece: AuthoredPiece, bufs: Map<StemRole, AudioBuffer>, when: number) {
    this.ctx = ctx; this.piece = piece;
    this.fader = ctx.createGain();
    this.fader.gain.value = 0;
    this.fader.connect(dest);
    for (const [role, buf] of bufs) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = 0;
      src.loopEnd = Math.min(piece.loop, buf.duration);
      const g = ctx.createGain();
      g.gain.value = role === 'main' || role === 'day' ? 1 : 0;
      src.connect(g); g.connect(this.fader);
      src.start(when);
      this.stems.set(role, { src, g });
    }
  }
  set(level: number, stems: Record<StemRole, number>, now: number): void {
    this.fader.gain.setTargetAtTime(level * this.piece.gain, now, 0.25);
    for (const [role, s] of this.stems) s.g.gain.setTargetAtTime(stems[role], now, role === 'tension' ? 1.2 : 2.5);
  }
  stop(now: number): void {
    this.fader.gain.cancelScheduledValues(now);
    this.fader.gain.setTargetAtTime(0, now, 0.8);
    for (const s of this.stems.values()) { try { s.src.stop(now + 4.5); } catch { /* already stopped */ } }
    setTimeout(() => { try { this.fader.disconnect(); } catch { /* gone */ } }, 5000);
  }
}

export interface AuthoredState {
  piece: string | null; phase: Weave['phase']; level: number; ready: string[]; failed: string[];
  /** stingers decoded, and the last one played (with its audio-clock time) */
  stingers: { ready: StingerId[]; last: StingerId | null; at: number; played: number };
}

export class AuthoredMusic {
  private readonly ctx: BaseAudioContext;
  private readonly dest: AudioNode;
  private readonly loads = new Map<string, Loaded>();
  private readonly pending = new Set<string>();
  private w: Weave = idleWeave();
  private voice: Voice | null = null;
  private level = 0;
  private tension = 0;
  private lastNow = 0;
  /** where stingers play (after the engine's music duck, so the duck lowers the music under them, not them) */
  private readonly stingDest: AudioNode;
  private readonly stingBufs = new Map<StingerId, AudioBuffer>();
  private stingLoads = false;
  private readonly gate = new StingerGate();
  private lastSting: { id: StingerId | null; at: number; played: number } = { id: null, at: 0, played: 0 };
  private stingVoice: { src: AudioBufferSourceNode; g: GainNode } | null = null;

  constructor(ctx: BaseAudioContext, dest: AudioNode, stingDest?: AudioNode) { this.ctx = ctx; this.dest = dest; this.stingDest = stingDest ?? dest; }

  /** decode all four stingers (once; ~200 KB of Opus) */
  private loadStingers(): void {
    if (this.stingLoads || typeof fetch !== 'function') return;
    this.stingLoads = true;
    for (const s of Object.values(STINGERS)) {
      fetch(s.url)
        .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
        .then((ab) => this.ctx.decodeAudioData(ab))
        .then((buf) => { this.stingBufs.set(s.id, buf); })
        .catch(() => { /* no stinger: the moment's sound effect still plays */ });
    }
  }

  /**
   * Play a stinger now if it is decoded and its pacing allows; true when it plays (the engine then ducks the music
   * for its phrase). A stinger that outranks the one sounding cuts it off with a short fade.
   */
  sting(id: StingerId, now: number): boolean {
    const s = STINGERS[id];
    const buf = this.stingBufs.get(id);
    if (!s || !buf || !this.gate.admit(id, now)) return false;
    if (this.stingVoice) {
      const v = this.stingVoice;
      v.g.gain.cancelScheduledValues(now);
      v.g.gain.setTargetAtTime(0, now, 0.12);
      try { v.src.stop(now + 0.8); } catch { /* already stopped */ }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = s.gain;
    src.connect(g); g.connect(this.stingDest);
    src.start(now + 0.02);
    const voice = { src, g };
    src.onended = () => { try { g.disconnect(); } catch { /* gone */ } if (this.stingVoice === voice) this.stingVoice = null; };
    this.stingVoice = voice;
    this.lastSting = { id, at: Math.round(now * 100) / 100, played: this.lastSting.played + 1 };
    return true;
  }

  private load(url: string): void {
    if (this.loads.has(url) || this.pending.has(url) || typeof fetch !== 'function') return;
    this.pending.add(url);
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((ab) => this.ctx.decodeAudioData(ab))
      .then((buf) => { this.loads.set(url, { buf, failed: false }); })
      .catch(() => { this.loads.set(url, { buf: null, failed: true }); })
      .finally(() => { this.pending.delete(url); });
  }

  /** every stem of the piece decoded (starts the loads it needs) */
  private ready(id: string): Map<StemRole, AudioBuffer> | null {
    const p = AUTHORED[id];
    if (!p) return null;
    const out = new Map<StemRole, AudioBuffer>();
    for (const [role, url] of Object.entries(p.stems) as [StemRole, string][]) {
      const l = this.loads.get(url);
      if (!l) { this.load(url); return null; }
      if (!l.buf) return null;
      out.set(role, l.buf);
    }
    return out;
  }

  private failed(id: string): boolean {
    const p = AUTHORED[id];
    return !p || Object.values(p.stems).some((u) => this.loads.get(u as string)?.failed);
  }

  /** drop decoded audio no longer needed (keeps memory to the playing piece) */
  private release(keep: string | null): void {
    const urls = new Set<string>(keep && AUTHORED[keep] ? Object.values(AUTHORED[keep].stems) as string[] : []);
    for (const [u, l] of this.loads) if (!urls.has(u) && !l.failed) this.loads.delete(u);
  }

  /**
   * Called every frame by the director with the scene and the director's master (0..1, the opening's hold).
   * Returns how much of the music the authored piece holds now (0..1): the procedural players take the rest.
   */
  update(scene: AudioScene | null, now: number, master: number): number {
    const dt = Math.max(0, Math.min(0.5, now - this.lastNow));
    this.lastNow = now;
    this.loadStingers();
    let want = pieceFor(scene, this.w.piece);
    if (want && this.failed(want)) want = null;
    const bufs = want ? this.ready(want) : null;
    const next = weave(this.w, want, now, !!bufs);
    if (next.phase === 'play' && (this.w.phase !== 'play' || this.w.since !== next.since)) {
      // a new appearance: start the stems together at the loop's top
      this.voice?.stop(now);
      this.voice = bufs ? new Voice(this.ctx, this.dest, AUTHORED[next.piece!], bufs, now + 0.05) : null;
      if (this.voice) this.release(next.piece);
    }
    this.w = next;
    // tension: quick to rise, slow to fall
    const target = sceneTension(scene);
    this.tension += (target - this.tension) * (1 - Math.exp(-dt / (target > this.tension ? 1.5 : 8)));
    this.level = weaveLevel(this.w, now) * Math.max(0, Math.min(1, master));
    if (this.voice) {
      if (this.w.phase !== 'play' && this.level <= 0) { this.voice.stop(now); this.voice = null; }
      else this.voice.set(this.level, stemLevels(scene, this.tension), now);
    }
    return this.voice ? weaveLevel(this.w, now) : 0;
  }

  stop(): void {
    this.voice?.stop(this.ctx.currentTime); this.voice = null; this.w = idleWeave();
    if (this.stingVoice) { try { this.stingVoice.src.stop(); } catch { /* already stopped */ } this.stingVoice = null; }
  }

  state(): AuthoredState {
    const ready: string[] = [], failed: string[] = [];
    for (const id of Object.keys(AUTHORED)) {
      const urls = Object.values(AUTHORED[id].stems) as string[];
      if (urls.every((u) => this.loads.get(u)?.buf)) ready.push(id);
      if (urls.some((u) => this.loads.get(u)?.failed)) failed.push(id);
    }
    return {
      piece: this.w.piece, phase: this.w.phase, level: Math.round(this.level * 1000) / 1000, ready, failed,
      stingers: { ready: [...this.stingBufs.keys()].sort(), last: this.lastSting.id, at: this.lastSting.at, played: this.lastSting.played },
    };
  }
}
