// navigator.vibrate wrapper. A no-op when unsupported (iOS Safari, desktop) or switched off in Settings.
// Pulses: poke 8 ms tick, squeeze = low-rate pulse scaled by how fast it is being squeezed, release 18 ms thump, pop 6 ms.

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
  };
}
