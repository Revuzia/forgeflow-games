// GENESIS — the pointer's palette and strips (LIVING §0.1.7, §3.6, hook H7; CONTRACT §11.4, §15.6). The god acts
// through the player's own mouse pointer (owner, 2026-11-04: "it can just be a hand, or the mouse pointer"): a clean
// CSS cursor (src/ui/styles.css body[data-hand]) and, in the world, a small soft ring of light on the ground under it
// (render/hand.ts). The vortex, shaft, cloud whorl, wind bands, cradle, crackles and gloom of the old Touch are gone.
// This module keeps the pure, testable parts: the ring's colour by regard and the camera-facing strips the sigil
// glyph, a throw's trail and the landed sigils (fx/sigilfx.ts) are drawn with.

import { BufferAttribute, BufferGeometry } from 'three';

// ───────────────────────────── palette by regard ─────────────────────────────

export interface TouchLook {
  /** the pointer's light (linear RGB): warm gold trusted … pale silver-gold awed … a cold blue-white when feared */
  light: [number, number, number];
  /** a feared god's cold light (a rebuke's flash, a feared god's sigil) */
  rim: [number, number, number];
  /** 0 … 1 how far the sigil's glow leans to the cold light (feared) */
  dark: number;
  /** 0..1 how trusted / how feared (smooth bands round regard ±0.08 … ±0.75) */
  trusted: number;
  feared: number;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** the pointer's look for a regard in −1 (feared) … +1 (trusted): only a tint, never weather */
export function touchLook(regard: number): TouchLook {
  const r = Math.max(-1, Math.min(1, Number.isFinite(regard) ? regard : 0));
  const trusted = smooth(0.08, 0.75, r), feared = smooth(0.08, 0.75, -r);
  let lr = 1.0, lg = 0.93 - 0.37 * trusted, lb = 0.82 - 0.65 * trusted;
  lr += (0.62 - lr) * feared; lg += (0.74 - lg) * feared; lb += (1.0 - lb) * feared;
  return { light: [lr, lg, lb], rim: [0.5, 0.68, 1.0], dark: 0.92 * feared, trusted, feared };
}

// ───────────────────────────── geometry ─────────────────────────────

/** sample counts: the sigil glyph's stroke and a throw's trail */
export const TOUCH_N = { glyph: 96, trail: 48 } as const;

/**
 * `strips` camera-facing strips of `n` samples each: attributes aT (0..1 along), aSide (±1 across) and a placeholder
 * position (the CPU places them).
 */
export function stripGeometry(n: number, strips = 1): BufferGeometry {
  const g = new BufferGeometry();
  const t = new Float32Array(n * 2 * strips), side = new Float32Array(n * 2 * strips), strip = new Float32Array(n * 2 * strips);
  const idx: number[] = [];
  for (let s = 0; s < strips; s++) for (let i = 0; i < n; i++) {
    const k = (s * n + i) * 2;
    t[k] = t[k + 1] = i / (n - 1); side[k] = 1; side[k + 1] = -1; strip[k] = strip[k + 1] = s;
    if (i < n - 1) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
  }
  g.setAttribute('position', new BufferAttribute(new Float32Array(n * 2 * strips * 3), 3));
  g.setAttribute('aT', new BufferAttribute(t, 1));
  g.setAttribute('aSide', new BufferAttribute(side, 1));
  g.setAttribute('aStrip', new BufferAttribute(strip, 1));
  g.setIndex(idx);
  return g;
}
