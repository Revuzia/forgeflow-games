// VALE UI — the sound seam. The UI never makes sound itself: it calls an injected AudioPort that the
// AUDIO lane implements (src/audio/engine.ts). Cue ids follow _design/VOCAB.md: every UI cue is
// `ui_<kind>`; the kinds below are this lane's code vocabulary, the ids are assembled at runtime.
// Bible: UI sounds are glass and wood; sound fires on POINTERDOWN (not click); hover is a quiet glass
// tink rate-limited to one per tokens.audio.ui.hover.minIntervalMs.

import { TOKENS } from './tokens.ts';

export interface AudioPort {
  /** play a cue by id (ui_ + a UiCueKind, see uiCueId); unknown ids are ignored by the engine */
  play(cueId: string): void;
}

export type UiCueKind =
  | 'hover' | 'click' | 'confirm' | 'back' | 'error' | 'tab' | 'toggle' | 'slider'
  | 'queue_search' | 'queue_pop' | 'accept' | 'lockin' | 'ban' | 'hover_fighter'
  | 'currency_tick' | 'equip' | 'purchase' | 'reward_reveal' | 'level_account' | 'notify';

export const uiCueId = (kind: UiCueKind): string => `ui_${kind}`;

const HOVER_MIN_MS = TOKENS.audioUi.hover.minIntervalMs;

/** wraps a port with the UI's own rules (hover rate limit, slider/tick throttles, never throws) */
export class UiSound {
  private port: AudioPort | null;
  private last = new Map<UiCueKind, number>();
  constructor(port: AudioPort | null | undefined) { this.port = port ?? null; }

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
  return {
    log,
    play(id: string): void {
      log.push({ id, t: Math.round(performance.now()) });
      if (log.length > 200) log.shift();
      inner?.play(id);
    },
  };
}
