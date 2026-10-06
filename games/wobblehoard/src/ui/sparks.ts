// Gain sparks (visible XP, FUN.md 2.3): a paying touch sends a few small sparks from the touch point into the meter ring.
//   * A fixed pool of SPARK_POOL spans, made once, in one layer above the stage (aria-hidden, no pointer events). Nothing is created per
//     frame: each spark is ONE Web Animations call (compositor transform + opacity along a curved path), so the flight costs no script
//     per frame at all. The keyframes of one launch are a few small objects, made at the launch only.
//   * The path: a quadratic curve from the touch to the ring that bows up and to the side, with a little deterministic spread per spark;
//     each spark is a short comet (a white-hot head, an amber tail) turned along the curve and stretched with its speed, so it reads on
//     the jelly as well as on the dark mat. Sparks leave 28 ms apart and land in about 0.4 s. burst() returns when the FIRST lands (the
//     ring's fill starts then).
//   * Calm effects and reduced motion never call this (the ring glows instead: hudBinding.ts).
import { h } from './dom.ts';

export const SPARK_POOL = 24;
const FLIGHT_MS = 380;
const STAGGER_MS = 28;

export interface Sparks {
  readonly el: HTMLElement;
  /** sparks launched since boot (the harness counts them) */
  readonly launched: number;
  /** fly `n` sparks from (x0, y0) to (x1, y1), page CSS px; returns ms until the first lands (0 = none flew) */
  burst(x0: number, y0: number, x1: number, y1: number, n: number): number;
  destroy(): void;
}

export function createSparks(root: HTMLElement): Sparks {
  const el = h('div', { class: 'sparks', attrs: { 'aria-hidden': 'true', 'data-launched': '0' } });
  const pool: HTMLElement[] = [];
  for (let i = 0; i < SPARK_POOL; i++) { const s = h('span', { class: 'spark' }); pool.push(s); el.append(s); }
  root.append(el);
  let next = 0, launched = 0, seq = 0;
  const canAnimate = typeof (pool[0] as HTMLElement & { animate?: unknown }).animate === 'function';
  return {
    el,
    get launched() { return launched; },
    burst(x0, y0, x1, y1, n) {
      if (!canAnimate || !Number.isFinite(x0 + y0 + x1 + y1)) return 0;
      const k = Math.max(1, Math.min(6, Math.round(n)));
      const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
      // the bow: perpendicular to the flight, toward the top of the screen
      let px = -dy / len, py = dx / len;
      if (py > 0) { px = -px; py = -py; }
      for (let i = 0; i < k; i++) {
        const s = pool[next];
        next = (next + 1) % SPARK_POOL;
        seq++;
        const j = ((seq * 0.618034) % 1) - 0.5;   // a deterministic spread, -0.5..0.5
        const bow = len * (0.22 + 0.12 * j) + 24;
        const cx = x0 + dx * 0.45 + px * bow + j * 26, cy = y0 + dy * 0.45 + py * bow;
        const sx = x0 + j * 14, sy = y0 + ((seq * 0.414214) % 1 - 0.5) * 14;
        // each key: the point on the curve, the streak turned along the flight (the curve's tangent) and stretched with its speed
        let prevDeg = NaN;
        const at = (t: number, stretch: number, sc: number, op: number): Keyframe => {
          const u = 1 - t;
          const x = u * u * sx + 2 * u * t * cx + t * t * x1, y = u * u * sy + 2 * u * t * cy + t * t * y1;
          const tx = 2 * u * (cx - sx) + 2 * t * (x1 - cx), ty = 2 * u * (cy - sy) + 2 * t * (y1 - cy);
          let deg = (Math.atan2(ty, tx) * 180) / Math.PI;
          if (Number.isFinite(prevDeg)) { while (deg - prevDeg > 180) deg -= 360; while (deg - prevDeg < -180) deg += 360; }   // turn the short way
          prevDeg = deg;
          return { transform: `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotate(${deg.toFixed(1)}deg) scale(${(stretch * sc).toFixed(2)}, ${sc})`, opacity: op, offset: t };
        };
        try {
          s.getAnimations().forEach((a) => a.cancel());
          s.animate([at(0, 0.6, 0.6, 0), at(0.1, 1.1, 1.15, 1), at(0.5, 1.6, 1, 1), at(0.85, 1.3, 0.85, 0.95), at(1, 0.7, 0.45, 0)],
            { duration: FLIGHT_MS + i * 12, delay: i * STAGGER_MS, easing: 'cubic-bezier(.45,.05,.55,.95)', fill: 'none' });
          launched++;
        } catch { /* an old engine: no sparks, the ring still fills */ }
      }
      el.dataset.launched = String(launched);
      return Math.round(FLIGHT_MS * 0.86);
    },
    destroy() { for (const s of pool) { try { s.getAnimations().forEach((a) => a.cancel()); } catch { /* ignore */ } } el.remove(); },
  };
}
