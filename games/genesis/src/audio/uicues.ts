// GENESIS — the interface's sounds (CONTRACT §17): which cue each UI moment plays, how often one may repeat, and which
// one is heard when a single action changes several things at once — a palette pick closes the palette, closes the
// radial and arms a tool: the player hears one "arm", not close + close + arm. Pure and clock-driven (no WebAudio), so
// tests/audio.test.ts drives it with a fake clock; engine.ts feeds it every cue() whose name starts with 'ui.' or
// 'gesture.'.
//
// The interface plays these by name through UiHost.sound(cue) (src/ui/host.ts → App.sound → GenesisAudio.cue). Where
// each belongs:
//
//   ui.open / ui.close        the palette, a panel (settings, saves, help, menu, chronicle), the "do this" field
//   ui.radial                 the radial menu blooms open (its close is ui.close)
//   ui.tick                   a selection steps: the radial's hot slot, the palette's highlighted row, a pad move
//   ui.arm / ui.disarm        a power armed as the tool / the tool put away
//   ui.click                  a dock button, a card's button, a list row pressed
//   ui.hover                  the pointer onto a control (very quiet; heavily gated)
//   ui.toggle                 a switch flips
//   ui.confirm / ui.error     a command went through / was refused
//   gesture.start             a gesture stroke begins
//   gesture.ok / gesture.fail the stroke was recognised (and cast) / was not
//
// Calling a cue at every state change is safe: repeats inside a cue's gap, a quiet tick right after a louder cue and
// floods past the rate cap are dropped here, so wiring a moment twice (an explicit call and a generic one) is heard once.
// A cue given a `delay` (cue(name, { delay })) is a deliberate sequence: it skips the batch but still passes the gate.

/** the interface's cue names, by moment (every one has a recipe in sfx.ts; tests/audio.test.ts checks it) */
export const UI_CUE = {
  click: 'ui.click',
  hover: 'ui.hover',
  tick: 'ui.tick',
  open: 'ui.open',
  close: 'ui.close',
  radial: 'ui.radial',
  arm: 'ui.arm',
  disarm: 'ui.disarm',
  toggle: 'ui.toggle',
  confirm: 'ui.confirm',
  error: 'ui.error',
  gestureStart: 'gesture.start',
  gestureOk: 'gesture.ok',
  gestureFail: 'gesture.fail',
} as const;

export type UiCueName = (typeof UI_CUE)[keyof typeof UI_CUE];

export interface UiCueRule {
  /** minimum real seconds between two plays of this cue */
  gap: number;
  /** which cue is heard when one action fires several (higher wins; equal: the later one) */
  rank: number;
  /** voice priority: an interface sound never steals a world's voice for a hover */
  pri: number;
}

const RULES: Record<string, UiCueRule> = {
  'ui.hover': { gap: 0.07, rank: 1, pri: 2 },
  'ui.tick': { gap: 0.045, rank: 2, pri: 3 },
  'ui.click': { gap: 0.05, rank: 3, pri: 5 },
  'ui.toggle': { gap: 0.06, rank: 4, pri: 6 },
  'ui.close': { gap: 0.08, rank: 4, pri: 6 },
  'ui.open': { gap: 0.08, rank: 5, pri: 6 },
  'ui.radial': { gap: 0.1, rank: 5, pri: 6 },
  'ui.disarm': { gap: 0.1, rank: 6, pri: 7 },
  'gesture.start': { gap: 0.15, rank: 6, pri: 7 },
  'ui.arm': { gap: 0.1, rank: 7, pri: 8 },
  'ui.confirm': { gap: 0.1, rank: 8, pri: 8 },
  'gesture.fail': { gap: 0.2, rank: 8, pri: 8 },
  'gesture.ok': { gap: 0.2, rank: 9, pri: 8 },
  'ui.error': { gap: 0.12, rank: 9, pri: 8 },
};

/** an interface cue this table does not know (a mod's 'ui.something') */
const DEFAULT_RULE: UiCueRule = { gap: 0.06, rank: 3, pri: 6 };

/** quiet cues (rank ≤ QUIET) are swallowed this long after a louder one (a radial's first hot slot after it opens) */
export const UI_SHADOW = 0.09;
const QUIET = 2;
/** at most this many interface sounds a second; cues of rank ≥ ALWAYS pass anyway (an error is never lost) */
export const UI_RATE = 14;
const ALWAYS = 7;

/** names the interface mixer handles (the rest of cue() — 'ignition', 'whisper', a hand act — plays directly) */
export function isUiCue(name: string): boolean {
  return name.startsWith('ui.') || name.startsWith('gesture.');
}

export function uiRule(name: string): UiCueRule {
  return RULES[name] ?? DEFAULT_RULE;
}

/**
 * Batches the interface cues of one action and gates them in real time. The engine `submit`s each cue and, when that
 * opens a batch, schedules one `flush` at the end of the current task (a microtask): everything one click, key or
 * frame changed lands in the same batch, and the batch plays its highest-ranked cue — if the gate admits it.
 */
export class UiCueMixer<T = unknown> {
  private batch: { name: string; data: T }[] = [];
  private last = new Map<string, number>();
  private loudAt = -Infinity;
  private window: number[] = [];
  /** cues dropped by the gate or by losing a batch (state) */
  gated = 0;

  /** queue a cue; true when this opened a new batch (the caller schedules exactly one flush) */
  submit(name: string, data: T): boolean {
    this.batch.push({ name, data });
    return this.batch.length === 1;
  }

  get pending(): number { return this.batch.length; }

  /** close the batch at `now` (seconds, any monotonic clock): the one cue to play, or null */
  flush(now: number): { name: string; data: T; rule: UiCueRule } | null {
    const b = this.batch;
    this.batch = [];
    if (!b.length) return null;
    let w = b[0];
    let wr = uiRule(w.name);
    for (let i = 1; i < b.length; i++) {
      const r = uiRule(b[i].name);
      if (r.rank >= wr.rank) { w = b[i]; wr = r; }
    }
    this.gated += b.length - 1;
    if (!this.admit(w.name, now)) { this.gated++; return null; }
    return { name: w.name, data: w.data, rule: wr };
  }

  /** the gate on its own (the cue's gap, the shadow of a louder cue, the rate cap): true — and recorded — when `name` may sound at `now` */
  admit(name: string, now: number): boolean {
    const r = uiRule(name);
    if (now - (this.last.get(name) ?? -Infinity) < r.gap) return false;
    if (r.rank <= QUIET && now - this.loudAt < UI_SHADOW) return false;
    const w = this.window;
    while (w.length && now - w[0] >= 1) w.shift();
    if (w.length >= UI_RATE && r.rank < ALWAYS) return false;
    w.push(now);
    this.last.set(name, now);
    if (r.rank > QUIET) this.loudAt = now;
    return true;
  }

  reset(): void {
    this.batch = [];
    this.last.clear();
    this.window.length = 0;
    this.loudAt = -Infinity;
    this.gated = 0;
  }
}
