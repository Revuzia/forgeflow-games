// navigator.vibrate wrapper. A no-op when unsupported (iOS Safari, desktop) or switched off in Settings.
// Pulses: poke 8 ms tick, squeeze = low-rate pulse scaled by how fast it is being squeezed, release 18 ms thump, pop 6 ms; the DESIGN 6.7
// patterns (meter full, capsule landing, tier reveals, merge rumble) go through pattern().

export interface Haptics {
  /** navigator.vibrate exists */
  readonly supported: boolean;
  setEnabled(on: boolean): void;
  poke(): void;
  /** Call every frame while squeezing/pulling. Emits a throttled pulse whose length scales with |rate| (1/s). */
  squeeze(rate: number): void;
  release(): void;
  pop(): void;
  /** Stop any running vibration (tab hidden, press cancelled). */
  cancel(): void;
  /** A raw vibrate pattern (ms on, off, on, ...): the DESIGN 6.7 tier patterns and the merge rumble. Optional so older mocks compile. */
  pattern?(p: readonly number[]): void;
}

/** DESIGN 6.7 haptic patterns (milliseconds, on/off alternating). */
export const TIER_HAPTICS: Readonly<Record<'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic', readonly number[]>> = {
  common: [12],
  uncommon: [12, 60, 8],
  rare: [10, 50, 14, 50, 18],
  epic: [14, 40, 18, 40, 22, 40, 26, 80, 30],
  legendary: [10, 20, 14, 20, 18, 20, 22, 20, 26, 20, 30, 120, 45],
  mythic: [10, 25, 12, 25, 14, 25, 16, 25, 18, 25, 20, 25, 22, 250, 60, 60, 60],
};
export const METER_FULL_HAPTIC: readonly number[] = [10];
export const CAPSULE_LAND_HAPTIC: readonly number[] = [18];

/** Merge T0..T2 rumble (DESIGN 6.7): [8, 52] repeating, tightening to [14, 20] over `seconds`. One vibrate() call. */
export function mergeRumble(seconds: number): number[] {
  const out: number[] = [];
  let t = 0;
  const total = Math.max(0, Math.min(6, seconds)) * 1000;
  while (t < total) {
    const k = total > 0 ? t / total : 1;
    const on = Math.round(8 + 6 * k), off = Math.round(52 - 32 * k);
    out.push(on, off);
    t += on + off;
  }
  if (out.length) out.pop();
  return out;
}

export interface HapticsOptions {
  vibrate?: ((pattern: number | number[]) => boolean) | null;
  enabled?: boolean;
  now?: () => number;
}

export const HAPTIC_MS = { poke: 8, release: 18, pop: 6, squeezeMin: 3, squeezeMax: 14 } as const;

function defaultVibrate(): ((p: number | number[]) => boolean) | null {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') return (p) => navigator.vibrate(p);
  } catch { /* ignore */ }
  return null;
}

export function createHaptics(opts: HapticsOptions = {}): Haptics {
  const vibrate = opts.vibrate === undefined ? defaultVibrate() : opts.vibrate;
  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  let enabled = opts.enabled ?? true;
  let lastSqueeze = -1e9;

  const buzz = (ms: number): void => {
    if (!vibrate || !enabled) return;
    try { vibrate(ms); } catch { /* some browsers throw when the page lacks user activation */ }
  };

  const cancel = (): void => {
    if (!vibrate) return;
    try { vibrate(0); } catch { /* ignore */ }
  };

  return {
    supported: !!vibrate,
    setEnabled(on) { enabled = !!on; if (!enabled) cancel(); },
    poke() { buzz(HAPTIC_MS.poke); },
    squeeze(rate) {
      if (!vibrate || !enabled) return;
      const r = Math.abs(rate);
      if (!(r > 0.35)) return;
      const t = now();
      const interval = 150 - Math.min(r, 6) * 12; // faster squeeze = quicker pulses (150 .. 78 ms)
      if (t - lastSqueeze < interval) return;
      lastSqueeze = t;
      const ms = Math.round(Math.min(HAPTIC_MS.squeezeMax, HAPTIC_MS.squeezeMin + r * 3));
      buzz(ms);
    },
    release() { buzz(HAPTIC_MS.release); },
    pop() { buzz(HAPTIC_MS.pop); },
    cancel,
    pattern(p) {
      if (!vibrate || !enabled || !p.length) return;
      try { vibrate(p.map((v) => Math.max(0, Math.min(1000, Math.round(v))))); } catch { /* ignore */ }
    },
  };
}
