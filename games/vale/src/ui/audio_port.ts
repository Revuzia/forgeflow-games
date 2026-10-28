// VALE UI — the sound seam. The UI never makes sound itself: it calls an injected AudioPort that the
// AUDIO lane implements (src/audio/engine.ts). The UI plays ROLES (audio_kinds.ts); content/audio.json
// binds each role to a cue id (`ui`, `screens`, `stings`), so no cue id lives in code.
// Bible: UI sounds are glass and wood; sound fires on POINTERDOWN (not click); hover is a quiet glass
// tink rate-limited to one per tokens.audio.ui.hover.minIntervalMs.

import { TOKENS } from './tokens.ts';
import type { MusicKind, StingKind, UiCueKind } from './audio_kinds.ts';

export type { MusicKind, StingKind, UiCueKind } from './audio_kinds.ts';

export interface AudioPort {
  /** play a cue by id (content binds the UI's roles to ids); unknown ids are ignored by the engine */
  play(cueId: string): void;
  /** OPTIONAL (requested from AUDIO): crossfade the music bed to a MusicDef id, or fade it out (null).
   *  The UI calls it on every route change; the engine ignores a repeat of the current bed. */
  music?(musicId: string | null): void;
  /** OPTIONAL: duck the bed under a moment (the ready check) and restore it */
  duck?(on: boolean): void;
  /** OPTIONAL: the live match (its SimEvents become spatial cues), or null after it */
  attach?(client: import('../contracts/session.ts').MatchClient | null): void;
  /** OPTIONAL: Settings.audio volumes changed (plus the AUD-m4 extras mono / softenLoud, session/settings.ts AudioSettings) */
  settings?(s: import('../contracts/session.ts').Settings['audio']): void;
  /** OPTIONAL (requested from AUDIO, AUD-m2): the draft bed follows the draft. Called on every change of the draft's
   *  phase, of whether the local player has to act, and of the urgency window; null when the draft screen closes.
   *  `urgent` is true in the last tokens.audio.beds.draft.localUrgencyLastS seconds of a timer the local player still has
   *  to act on (their ban, their pick, their finalize Lock in). */
  draft?(s: DraftMusicState | null): void;
}

/** the draft's state as the music hears it (audio AUD-m2; tokens.audio.beds.draft.phases: bans drone · picks harp pulse ·
 *  finalise drums) */
export interface DraftMusicState { phase: 'ban' | 'pick' | 'finalize'; mine: boolean; urgent: boolean }

/** content's role → id bindings (CatalogT.audio `ui`, `screens`, `stings`); an unbound role is silent. `cues` is the
 *  catalog's cue table, read only to ask whether a fighter's own cue exists (FIGHTER_CALL) */
export interface UiSoundIds { ui?: Record<string, string>; screens?: Record<string, string>; stings?: Record<string, string>; cues?: Record<string, unknown> }

/** a fighter's lock-in call: the cue `f_<fighter id>_call` (the audio lane's per-fighter cue family, like
 *  `f_<id>_passive`), played when your pick is locked in; a fighter without one falls back to the `lockin` role */
export const FIGHTER_CALL = (fighter: string): string => `f_${fighter}_call`;

const HOVER_MIN_MS = TOKENS.audioUi.hover.minIntervalMs;

/** wraps a port with the UI's own rules (hover rate limit, slider/tick throttles, never throws) */
export class UiSound {
  private port: AudioPort | null;
  private ids: UiSoundIds;
  private last = new Map<UiCueKind, number>();
  constructor(port: AudioPort | null | undefined, ids: UiSoundIds = {}) { this.port = port ?? null; this.ids = ids; }

  /** the music bed bound to a client screen kind (null when content binds none) */
  musicFor(kind: MusicKind): string | null { return this.ids.screens?.[kind] ?? null; }

  music(id: string | null): void {
    if (id === this.bed) return;
    this.bed = id;
    try { this.port?.music?.(id); } catch { /* never breaks the UI */ }
  }
  duck(on: boolean): void { try { this.port?.duck?.(on); } catch { /* never breaks the UI */ } }
  private bed: string | null | undefined = undefined;

  /** the draft bed's state (AudioPort.draft); repeats of the same state are not sent */
  draftMusic(s: DraftMusicState | null): void {
    const k = s ? `${s.phase}:${s.mine ? 1 : 0}:${s.urgent ? 1 : 0}` : '';
    if (k === this.draftKey) return;
    this.draftKey = k;
    try { this.port?.draft?.(s); } catch { /* never breaks the UI */ }
  }
  private draftKey: string | undefined = undefined;

  /** a non-UI cue the client itself owns (the post-game sting) */
  sting(kind: StingKind): void {
    const id = this.ids.stings?.[kind];
    if (!id) return;
    try { this.port?.play(id); } catch { /* never breaks the UI */ }
  }

  /** your pick is locked in: the fighter's call when content has one, else the `lockin` role. Returns the cue played. */
  lockCall(fighter: string | null | undefined): string | null {
    const id = fighter ? FIGHTER_CALL(fighter) : null;
    if (id && this.ids.cues && Object.prototype.hasOwnProperty.call(this.ids.cues, id)) {
      try { this.port?.play(id); } catch { /* never breaks the UI */ }
      return id;
    }
    this.play('lockin');
    return this.ids.ui?.lockin ?? null;
  }

  play(kind: UiCueKind, minIntervalMs = 0): void {
    const id = this.ids.ui?.[kind];
    if (!this.port || !id) return;
    const now = performance.now();
    const gap = kind === 'hover' || kind === 'hover_fighter' ? HOVER_MIN_MS : minIntervalMs;
    const prev = this.last.get(kind) ?? -1e9;
    if (now - prev < gap) return;
    this.last.set(kind, now);
    try { this.port.play(id); } catch { /* a sound never breaks the UI */ }
  }
}

/** a port that remembers what was played (dev + harness: window.__valeUiCues) */
export function recordingPort(inner?: AudioPort | null): AudioPort & { log: { id: string; t: number }[] } {
  const log: { id: string; t: number }[] = [];
  const rec = (id: string): void => { log.push({ id, t: Math.round(performance.now()) }); if (log.length > 200) log.shift(); };
  return {
    log,
    play(id: string): void { rec(id); inner?.play(id); },
    music(id: string | null): void { rec(`music:${id ?? 'off'}`); inner?.music?.(id); },
    duck(on: boolean): void { rec(`duck:${on}`); inner?.duck?.(on); },
    draft(s: DraftMusicState | null): void { rec(s ? `draft:${s.phase}:${s.mine ? 'mine' : 'theirs'}${s.urgent ? ':urgent' : ''}` : 'draft:off'); inner?.draft?.(s); },
  };
}
