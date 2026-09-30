// HIT PARADE - audio public types (CONTRACT s9, s16). THREE-free, DOM-free: the router and the node probe import these.
// The integration surface is createAudio() in ./index.ts.

import type { FighterSnap, MatchSnap, SimEvent } from '../core/types.ts';

export type { FighterSnap, MatchSnap, SimEvent };

/** music(cue): a looping cue, a stinger, a stage id, or null (= stop). Aliases accepted by the router: 'title' = 'menu',
 *  'charselect' | 'vs' | 'ladder' = 'select', 'stage' = the bout's stage (boss / miniboss for Ricky / THE FREAK),
 *  'results' | 'ending' = win or lose from the bout's local player and the match winner. */
export type MusicCue =
  | 'menu' | 'select' | 'stage' | 'boss' | 'miniboss' | 'win' | 'lose'
  | 'rust_theater' | 'butcher_block' | 'wheel_of_pain' | 'rooftop' | 'control_room'
  | 'brawl' | 'heckler'
  | 'title' | 'charselect' | 'vs' | 'ladder' | 'results' | 'ending';

/** ui(cue): menu sounds. Aliases: hover = move, select | click = confirm, cancel = back, deny = error. P2 online lobby
 *  (CONTRACT s9.2.6): search found join leave ready reveal code rematch disconnect countdown */
export type UiCue =
  | 'move' | 'confirm' | 'back' | 'error' | 'toggle' | 'start' | 'lock' | 'vs' | 'pause' | 'resume'
  | 'tick' | 'cash' | 'unlock' | 'ladder' | 'hover' | 'select' | 'click' | 'cancel' | 'deny'
  | 'search' | 'found' | 'join' | 'leave' | 'ready' | 'reveal' | 'code' | 'rematch' | 'disconnect' | 'countdown';

/** announce(line): lines the flow can call outside the sim (online start sync countdown, bonus-round slates) */
export type AnnounceLine = '3' | '2' | '1' | 'go' | 'ready' | 'fight' | 'bonus' | 'begin' | 'gameover' | 'victory' | 'win' | 'lose';

export type Splatter = 'splatter' | 'sparks' | 'confetti';

/** 0..1 each (settings: audio buses). Defaults when never set: master 0.85, music 0.55, sfx 0.9, crowd 0.8, voice 0.9 */
export interface AudioVolumes { master: number; music: number; sfx: number; crowd: number; voice: number }

/** what the audio needs to know about the bout (game.ts calls bout() when a match mounts, bout(null) when it ends) */
export interface AudioBout {
  /** fighter ids, player 0 and 1 (picks the voice banks and the projectile sounds) */
  fighters: readonly [string, string];
  /** stage id (data/stages.json): picks the stage music for music('stage') */
  stage: string;
  /** MatchCfg.mode */
  mode?: string;
  /** the player on this screen (0 | 1), or -1 for local 2P / spectating (announcer says VICTORY instead of YOU WIN) */
  local?: number;
  /** Match.tab.sfx: SFX_CUE `b` indexes this list of cue names (CONTRACT s19.8) */
  sfxNames?: readonly string[];
  /** CHANGED(AUDIO) P2 (CONTRACT s9.2.3): the game data (move tables, stages, bonus-round objects). Omitted = audio reads
   *  loadGameData() itself (cached; the same object game.ts uses). */
  data?: AudioGameData;
}

/** the slice of GameData the audio reads (structural: core/types.ts GameData satisfies it) */
export interface AudioMoveData {
  kind: string;
  name?: string;
  projectile?: { clip?: string };
  cinematic?: { cue?: string; hits?: ReadonlyArray<ReadonlyArray<number>> };
}
export interface AudioGameData {
  fighters: Record<string, { moves: Record<string, AudioMoveData> }>;
  /** data/stages.json ({ stages: [{ id, music?, ambient? }] }, CONTRACT s21); read defensively */
  stages?: unknown;
  system?: { heckler?: { objects?: ReadonlyArray<{ id: string }> }; brawl?: { kinds?: ReadonlyArray<{ id: string }> } };
}

export interface AudioOptions {
  volumes?: Partial<AudioVolumes>;
  /** max simultaneous one-shot voices (default 28); loops are capped separately (8) */
  voiceLimit?: number;
  /** attach gesture listeners that call unlock() (default true) */
  autoUnlock?: boolean;
  /** suspend the AudioContext while the tab is hidden (default true) */
  suspendWhenHidden?: boolean;
}

export interface AudioStats {
  unlocked: boolean;
  state: string;
  /** the music cue playing (manifest cue id) */
  cue: string | null;
  voices: number;
  peakVoices: number;
  stolen: number;
  rejected: number;
  loops: string[];
  played: number;
  playedBus: { sfx: number; ui: number; voice: number; crowd: number };
  /** the router's plays per sound id (before the engine's voice limit) and loop starts per id */
  counts: Record<string, number>;
  loopStarts: Record<string, number>;
  /** events per EV name the router handled, and deliberate culls per reason */
  events: Record<string, number>;
  culled: Record<string, number>;
  /** sprites / music cues decoded so far */
  decoded: string[];
  errors: string[];
  /** SFX_CUE names / ui / music cues the router did not know (never fatal) */
  unknown: string[];
  /** output meter since the previous stats() read (dBFS; -120 = silence) */
  meter: { peakDb: number; rmsDb: number; rmsMaxDb: number; limiterDb: number; peakAllDb: number };
  volumes: AudioVolumes;
  paused: boolean;
  /** the crowd intensity 0..1 (ratings + excitement) */
  crowd: number;
  preloaded: string[];
  /** per decoded asset: the codec used ('aac' = the .m4a twin), priming samples skipped, decoded duration (s) */
  codecs: Record<string, { codec: 'ogg' | 'aac'; off: number; duration: number }>;
}

/** the ONE integration surface (CONTRACT s16 + the CHANGED(AUDIO) additions in s9) */
export interface GameAudio {
  /** create/resume the AudioContext + fetch/decode the UI sprite and the current cue; call from a user gesture (auto by
   *  default). Never rejects. */
  unlock(): Promise<void>;
  /** start downloads without waiting for them. ids: 'ui' | 'sfx' | 'crowd' | a music cue / stage id. No ids = the bout
   *  set (sfx + crowd sprites); call it once the first stage is up (CONTRACT s9 "lazy preload after first stage"). */
  preload(ids?: readonly string[]): void;
  /** once per rendered frame with the NEW (deduped) events of that frame; f = the fighter snapshots (panning, crowd
   *  intensity from SHOWTIME, combo calls). The router also dedupes by (frame, type, a, b) itself. */
  events(ev: readonly SimEvent[], m: MatchSnap, f?: readonly [FighterSnap, FighterSnap]): void;
  /** switch the music cue (crossfade); null stops it */
  music(cue: MusicCue | string | null): void;
  ui(cue: UiCue | string): void;
  setVolumes(v: Partial<AudioVolumes>): void;
  stats(): AudioStats;
  /** the bout context (voices, stage music, crowd bed); null leaves the bout (stops the crowd) */
  bout(info: AudioBout | null): void;
  /** pause menu: world sounds + crowd muted, music softened; UI sounds stay */
  setPaused(paused: boolean): void;
  /** the gore setting (CONTRACT s0 / s17.1 ViewSettings.splatter) */
  setSplatter(mode: Splatter): void;
  announce(line: AnnounceLine): void;
  readonly unlocked: boolean;
  dispose(): void;
}
