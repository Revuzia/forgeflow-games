// PLAYGROUND (places, PLACES.md P7 / P8, D-68, RD-17): the camera framing of a place's play bounds (StageLike.setPlayBounds). Pure (no three):
// node checks it and reports the on-screen size of a 1 m squishy per layout. The frame must hold a body anywhere inside the bounds, a back
// body's bubble included, inside the HUD safe insets: the fitted box is the bounds grown by the largest body (R 0.625) on every side, from the
// floor to a back body's top (1.25 m) plus its bubble (BUBBLE_UP), its front at the body's top only. The camera looks along -z at yaw 0 (the
// place's front), pitch searched inside the allowed range (0.15 to 0.9 rad, P8), its aim searched across and along the bounds (the insets are
// not symmetric: on a phone the right column is wider); for each pitch and aim the distance that fits the box is found, and the framing whose smaller of (front px / 100, mid px / 80) is largest wins (RD-17's
// two bars; on a wide frame the mid-depth size alone, bar 150). Autonomy never moves the camera: these numbers depend on the bounds, the frame
// and the insets only, never on where the bodies are.

/** The largest body's rest radius (shape.ts 68) and height. */
const R_MAX = 0.625, BODY_H = 1.25;
/** A back body's bubble above its top (its anchor, 0.3 R, plus about a 40 px bubble at the back body's depth). The bubble layer also clamps
 *  every bubble inside the insets, so this only keeps a back bubble from being pushed down over its body. */
const BUBBLE_UP = 0.45;

export interface PlayFrame {
  pitch: number; aimX: number; aimY: number; aimZ: number; dist: number;
  /** CSS px of a 1 m squishy (1 m across) at the front edge of the bounds and at their middle depth. */
  frontPx: number; midPx: number;
}

/** Project world (x, y, z) for a camera at yaw 0: aim A, distance d, pitch p; returns screen px (or NaN behind the camera). */
function proj(x: number, y: number, z: number, ax: number, ay: number, az: number, d: number, p: number, ty: number, tx: number, W: number, H: number, out: number[]): void {
  const s = Math.sin(p), c = Math.cos(p);
  const cx = ax, cy = ay + d * s, cz = az + d * c;           // the camera position
  const rx = x - cx, ry = y - cy, rz = z - cz;
  const depth = rx * 0 + ry * -s + rz * -c;                  // along the forward (0, -s, -c)
  if (depth <= 1e-6) { out[0] = NaN; out[1] = NaN; return; }
  const u = rx / (depth * tx), v = (ry * c + rz * -s) / (depth * ty);   // right (1, 0, 0), up (0, c, -s)
  out[0] = (u * 0.5 + 0.5) * W; out[1] = (1 - (v * 0.5 + 0.5)) * H;
}

/**
 * The framing of bounds centred (cx, cz) with half sizes (hx, hz) on a cssW x cssH frame (fov in degrees, insets in CSS px). Returns null when
 * nothing fits (a frame smaller than its insets).
 */
export function fitPlayBounds(cx: number, cz: number, hx: number, hz: number, fovDeg: number, cssW: number, cssH: number,
  top: number, right: number, bottom: number, left: number, pitchMin = 0.15, pitchMax = 0.9, bodyR = R_MAX, bodyH = BODY_H, bubbleUp = BUBBLE_UP): PlayFrame | null {
  if (!(cssW > 1 && cssH > 1 && hx > 0 && hz > 0)) return null;
  const ty = Math.tan((fovDeg * Math.PI) / 360), tx = ty * (cssW / cssH);
  const L = left, R = cssW - right, T = top, B = cssH - bottom;
  if (!(R - L > 4 && B - T > 4)) return null;
  const tall = cssW / cssH < 0.9;
  const xs = [cx - hx - bodyR, cx + hx + bodyR];
  const zBack = cz - hz, zFront = cz + hz + bodyR;
  const pts: number[][] = [];
  for (const x of xs) {
    pts.push([x, 0, zFront], [x, bodyH, cz + hz], [x, 0, zBack - bodyR], [x, bodyH + bubbleUp, zBack]);
  }
  const o = [0, 0];
  const fits = (ax: number, ay: number, az: number, d: number, p: number): boolean => {
    for (const q of pts) { proj(q[0], q[1], q[2], ax, ay, az, d, p, ty, tx, cssW, cssH, o); if (!(o[0] >= L && o[0] <= R && o[1] >= T && o[1] <= B)) return false; }
    return true;
  };
  // a 1 m squishy's width on screen at depth z (centred on the bounds' centre line)
  const sizePx = (z: number, ax: number, ay: number, az: number, d: number, p: number): number => {
    proj(cx - 0.5, 0.5, z, ax, ay, az, d, p, ty, tx, cssW, cssH, o); const a = o[0];
    proj(cx + 0.5, 0.5, z, ax, ay, az, d, p, ty, tx, cssW, cssH, o); return o[0] - a;
  };
  let best: PlayFrame | null = null, bestScore = -Infinity;
  const ay = 0.45, sx = Math.max(0.05, (hx + bodyR) / 12);
  for (let p = pitchMin; p <= pitchMax + 1e-9; p += 0.05) {
    for (let az = cz - hz; az <= cz + hz + 1e-9; az += Math.max(0.05, hz / 15)) {
      for (let ax = cx - (hx + bodyR) * 0.5; ax <= cx + (hx + bodyR) * 0.5 + 1e-9; ax += sx) {
        // the smallest distance that fits (fitting is monotonic in the distance for a fixed aim and pitch, once far enough)
        let lo = 0.5, hi = 120;
        if (!fits(ax, ay, az, hi, p)) continue;
        for (let it = 0; it < 30; it++) { const mid = 0.5 * (lo + hi); if (fits(ax, ay, az, mid, p)) hi = mid; else lo = mid; }
        const d = hi, front = sizePx(cz + hz, ax, ay, az, d, p), mid = sizePx(cz, ax, ay, az, d, p);
        const score = tall ? Math.min(front / 100, mid / 80) : mid / 150;
        if (score > bestScore + 1e-9) { bestScore = score; best = { pitch: p, aimX: ax, aimY: ay, aimZ: az, dist: d, frontPx: front, midPx: mid }; }
      }
    }
  }
  return best;
}
