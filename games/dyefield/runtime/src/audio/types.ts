// DYEFIELD — audio public types (CONTRACT_P6_11 §21). THREE-free, DOM-free: the router and the node probe import
// these. The integration surface is createAudio() in ./index.ts; see ./README.md for the call sites.

import type { MatchPhase, SimEvent } from '../core/match/events.ts';

export type MusicCue = 'lobby' | 'match' | 'final' | 'victory' | 'defeat';
export type UiSound = 'hover' | 'click' | 'back' | 'start';
export type HornKind = 'start' | 'minute' | 'final10' | 'end';
/** the three built maps (data/maps.json ids); anything else falls back to the harbour ambience */
export type AudioMapId = 'pier18' | 'lockwell' | 'cinder' | string;

/** 0..1 each (settings: master / music / sfx). Defaults when never set: master 0.8, music 0.45, sfx 0.9 */
export interface AudioVolumes { master: number; music: number; sfx: number }

/** the listener = the camera: position + forward (+ up; default +Y) */
export interface ListenerPose {
  x: number; y: number; z: number;
  fx: number; fy: number; fz: number;
  ux?: number; uy?: number; uz?: number;
}

/** the Runner fields audio reads (core/runner.ts Runner satisfies this structurally: pass world.runners) */
export interface AudioRunner {
  readonly id: number;
  readonly team: number;
  readonly kit: string;
  x: number; y: number; z: number;
  alive: boolean;
  state: string;
  tank: number;
  speed?: number;
  slickForm?: boolean;
  /** spring launches so far (a launch has no SimEvent) */
  launches?: number;
  /** the special running ('' none): a SPECIAL 'denied' while one runs gets no deny tick (review fix A-A3) */
  specialActive?: string;
}

/** the ProjectilePool fields audio reads (pass world.projectiles): CLOUDBURST cells are kind 4 in state HOVER */
export interface AudioProjectiles {
  count: number;
  x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number>;
  kind: ArrayLike<number>;
  state: ArrayLike<number>;
}

/** a conveyor belt's world AABB (pass geo.features.conveyors) */
export interface AudioConveyor {
  min: ArrayLike<number>;
  max: ArrayLike<number>;
}

/** what the audio needs from the frame besides the events (all optional except the listener) */
export interface AudioFrame {
  listener: ListenerPose;
  /** world.runners (index = runner id) */
  runners?: readonly AudioRunner[];
  /** the human's runner id (default 0) */
  me?: number;
  /** the map id (data/maps.json): picks the ambience bed (Lockwell = works, else harbour) */
  map?: AudioMapId;
  /** world.phase / world.timeLeft / world.countdown: drive the countdown beeps and the final-10 ticks exactly */
  phase?: MatchPhase;
  timeLeft?: number;
  countdown?: number;
  /** world.projectiles: positions the CLOUDBURST rain loops */
  projectiles?: AudioProjectiles;
  /** geo.features.conveyors: the belt hum near belts */
  conveyors?: readonly AudioConveyor[];
}

export interface AudioOptions {
  volumes?: Partial<AudioVolumes>;
  /** max simultaneous one-shot voices (default 24); loops are capped separately (12) */
  voiceLimit?: number;
  /** attach one-shot pointerdown/keydown/touchstart listeners that call unlock() (default true) */
  autoUnlock?: boolean;
  /** suspend the AudioContext while the tab is hidden (default true) */
  suspendWhenHidden?: boolean;
}

export interface AudioStats {
  unlocked: boolean;
  state: string;
  cue: MusicCue | null;
  voices: number;
  peakVoices: number;
  stolen: number;
  rejected: number;
  loops: string[];
  played: number;
  /** one-shots started per bus: world sfx vs UI / flow (horns, beeps, menu sounds) */
  playedBus: { sfx: number; ui: number };
  /** the router's plays per sound id (before the engine's voice limit / level cull) and its loop starts per id */
  counts: Record<string, number>;
  loopStarts: Record<string, number>;
  decoded: string[];
  errors: string[];
  /** the output meter since the previous stats() read (dBFS; -120 = silence) — see AudioEngine.meterRead */
  meter: { peakDb: number; rmsDb: number; rmsMaxDb: number; limiterDb: number; peakAllDb: number };
  /** the volumes in force (0..1) */
  volumes: { master: number; music: number; sfx: number };
  /** setPaused(true) in force */
  paused: boolean;
  /** mobile review A-A11: the sprite + lobby downloads have been started (preload / unlock) */
  preloaded: boolean;
  /** mobile review A-A3: per decoded asset, the codec it was decoded from ('aac' = the .m4a twin), the priming samples
   *  skipped (an untrimmed AAC decode) and the decoded duration (s) */
  codecs: Record<string, { codec: 'ogg' | 'aac'; off: number; duration: number }>;
}

/** the ONE integration surface (see README.md) */
export interface GameAudio {
  /** create/resume the AudioContext + decode the assets; call from the first user gesture (auto by default). Never rejects. */
  unlock(): Promise<void>;
  /** start the sprite + lobby-music downloads (mobile review A-A11: not at construction — call once the first arena is
   *  up; unlock() also starts them). Idempotent. */
  preload(): void;
  setVolumes(v: Partial<AudioVolumes>): void;
  /** switch the music cue. 'match'/'final' pick the map's ambience from o.map. Victory/defeat are one-shot stingers. */
  playMusic(cue: MusicCue, o?: { map?: AudioMapId }): void;
  stopMusic(fadeS?: number): void;
  /** every frame, with the events drained this frame (an empty array is fine) and the frame context */
  onEvents(events: readonly SimEvent[], ctx: AudioFrame): void;
  ui(kind: UiSound): void;
  /** play a horn outside the sim (the sim's own 'horn' events already sound through onEvents) */
  horn(kind: HornKind): void;
  /** every frame (dt in seconds, 0 while paused) */
  update(dt: number): void;
  /** pause menu: mutes world sfx + loops, softens the music; UI sounds stay */
  setPaused(paused: boolean): void;
  /** duck music/sfx for a slate (0..1 = remaining level) */
  duck(seconds: number, music?: number, sfx?: number): void;
  readonly unlocked: boolean;
  stats(): AudioStats;
  dispose(): void;
}
