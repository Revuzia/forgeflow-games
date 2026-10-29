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
  /** OPTIONAL (from AUDIO, AUD-1): play the fighter's own lock-in call on the ui bus. The engine owns the cue naming
   *  (src/audio, its per-fighter kits); false, and nothing played, when content has no call for that fighter */
  fighterCall?(fighter: string): boolean;
}

/** the draft's state as the music hears it (audio AUD-m2; tokens.audio.beds.draft.phases: bans drone · picks harp pulse ·
 *  finalise drums) */
export interface DraftMusicState { phase: 'ban' | 'pick' | 'finalize'; mine: boolean; urgent: boolean }

/** content's role → id bindings (CatalogT.audio `ui`, `screens`, `stings`); an unbound role is silent */
export interface UiSoundIds { ui?: Record<string, string>; screens?: Record<string, string>; stings?: Record<string, string> }

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

  /** the fighter's own lock-in call through the engine (AudioPort.fighterCall); false when the engine or content has
   *  none. The UI never builds the cue id: the f_<fighter>_<slot> convention lives in src/audio only. */
  call(fighter: string | null | undefined): boolean {
    if (!fighter) return false;
    try { return !!this.port?.fighterCall?.(fighter); } catch { return false; /* never breaks the UI */ }
  }

  /** your pick is locked in: the `lockin` role, and the fighter's call riding on it (audio AUD-1: the call is
   *  mastered at -21 LUFS to sit on ui_lockin's -20, so both play). Returns whether the fighter's call played. */
  lockCall(fighter: string | null | undefined): boolean {
    this.play('lockin');
    return this.call(fighter);
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
    fighterCall(fighter: string): boolean { const ok = !!inner?.fighterCall?.(fighter); rec(`call:${fighter}:${ok ? 'played' : 'none'}`); return ok; },
  };
}
