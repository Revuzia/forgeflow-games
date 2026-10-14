// VALE UI — the sound seam. The UI never makes sound itself: it calls an injected AudioPort that the
// AUDIO lane implements (src/audio/engine.ts). Cue ids follow _design/VOCAB.md: every UI cue is
// `ui_<kind>`; the kinds below are this lane's code vocabulary, the ids are assembled at runtime.
// Bible: UI sounds are glass and wood; sound fires on POINTERDOWN (not click); hover is a quiet glass
// tink rate-limited to one per tokens.audio.ui.hover.minIntervalMs.

import { TOKENS } from './tokens.ts';

export interface AudioPort {
  /** play a cue by id (ui_ + a UiCueKind, see uiCueId); unknown ids are ignored by the engine */
  play(cueId: string): void;
  /** OPTIONAL (requested from AUDIO): crossfade the music bed to a MusicDef id, or fade it out (null).
   *  The UI calls it on every route change; the engine ignores a repeat of the current bed. */
  music?(musicId: string | null): void;
  /** OPTIONAL: duck the bed under a moment (the ready check) and restore it */
  duck?(on: boolean): void;
  /** OPTIONAL: the live match (its SimEvents become spatial cues), or null after it */
  attach?(client: import('../contracts/session.ts').MatchClient | null): void;
  /** OPTIONAL: Settings.audio volumes changed */
  settings?(s: import('../contracts/session.ts').Settings['audio']): void;
}

/** music bed kinds for the client's own screens; match beds come from MapDef.art.music (data) */
export type MusicKind = 'menu' | 'draft' | 'postgame';
export const musicId = (kind: MusicKind): string => `mus_${kind}`;

export type UiCueKind =
  | 'hover' | 'click' | 'confirm' | 'back' | 'error' | 'tab' | 'toggle' | 'slider'
  | 'queue_search' | 'queue_pop' | 'accept' | 'lockin' | 'ban' | 'hover_fighter'
  | 'currency_tick' | 'equip' | 'purchase' | 'reward_reveal' | 'level_account' | 'notify'
  | 'shop_buy' | 'shop_sell' | 'shop_undo';

export const uiCueId = (kind: UiCueKind): string => `ui_${kind}`;

const HOVER_MIN_MS = TOKENS.audioUi.hover.minIntervalMs;

/** wraps a port with the UI's own rules (hover rate limit, slider/tick throttles, never throws) */
export class UiSound {
  private port: AudioPort | null;
  private last = new Map<UiCueKind, number>();
  constructor(port: AudioPort | null | undefined) { this.port = port ?? null; }

  music(id: string | null): void {
    if (id === this.bed) return;
    this.bed = id;
    try { this.port?.music?.(id); } catch { /* never breaks the UI */ }
  }
  duck(on: boolean): void { try { this.port?.duck?.(on); } catch { /* never breaks the UI */ } }
  private bed: string | null | undefined = undefined;

  /** a non-UI cue the client itself owns (the post-game sting): `m_<kind>_sting` assembled at runtime */
  sting(kind: 'victory' | 'defeat' | 'placement'): void {
    try { this.port?.play(`m_${kind}_sting`); } catch { /* never breaks the UI */ }
  }

  play(kind: UiCueKind, minIntervalMs = 0): void {
    if (!this.port) return;
    const now = performance.now();
    const gap = kind === 'hover' || kind === 'hover_fighter' ? HOVER_MIN_MS : minIntervalMs;
    const prev = this.last.get(kind) ?? -1e9;
    if (now - prev < gap) return;
    this.last.set(kind, now);
    try { this.port.play(uiCueId(kind)); } catch { /* a sound never breaks the UI */ }
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
  };
}
