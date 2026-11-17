// PLAYGROUND (places, PLACES.md P7 / P8, D-68, RD-17): the camera framing of a place's play bounds (StageLike.setPlayBounds). Pure (no three):
// node checks it and reports the on-screen size of a 1 m squishy per layout.
// FRAMING MODEL (round 2, the orchestrator's RD-17 decision of 2026-11-16): bodies are framed by their CENTRES plus their radius: for a body whose
// centre stands anywhere inside the bounds, the centre's column from the ground under it (centre less a radius) to its top (centre plus a radius;
// the largest body, R 0.625) lies inside the HUD safe insets; laterally the centre does (a body at a side edge of the bounds may sit up to half
// its width past the side inset). A bubble is NOT part of the fit: the bubble layer clamps every bubble on screen into the safe frame, where it
// slides along the frame's edge with its tail still pointing at its squishy (emotes.ts). Why: framing whole bodies plus a back body's bubble
// made a 1 m squishy 80 / 69 px on the tall layout (bars 100 / 80) and 118 px on the wide one (bar 150): the front row's width is bound by the
// body's own width in the 314 px between a phone's side insets (an upper bound of 314 / (2.5 + 2 R) = 89.7 px at R 0.5), so the bars could not
// be met with whole bodies (_handoff/reports/PG_RENDER.md, spec conflict).
// THE LENS: on the wide layout at 1280 x 800 even this model tops out at a 1 m squishy of about 136 px at mid-depth with the stage's 35 degree
// lens (the front row is 2.4 m nearer than the middle: perspective, not the fit, binds), so a place camera takes the WIDEST lens of PLACE_FOVS
// whose best framing meets RD-17's bars (a longer lens flattens the depth so the middle row is nearly as large as the front one), and the
// stage's own 35 degrees when none does. Home never changes its lens.
// The camera looks along -z at yaw 0 (the place's front), pitch searched inside the allowed range (0.15 to 0.9 rad, P8), its aim searched across
// and along the bounds (the insets are not symmetric: on a phone the right column is wider) and in height; for each pitch and aim the distance
// that fits is found, and the framing whose smaller of (front px / 100, mid px / 80) is largest wins (RD-17's two bars; on a wide frame the
// mid-depth size alone, bar 150). Autonomy never moves the camera: these numbers depend on the bounds, the frame and the insets only.

import { bandRows, FRAME_TUNING } from './framing.ts';

/** PLAYGROUND (round 3, MERGE_PC doubt 4: "a place respects the HUD band exactly as Home does"): the CSS px a place's framing keeps clear,
 *  [top, right, bottom, left]: Home's band (bandRows) plus Home's margin (max(marginMin, marginFrac x the frame's size)) on the rows that
 *  bound it (top and bottom; the sides when side rows were reported). No rows reported = no band: the frame's own edges, as Home. */
export function placeBand(ins: { top: number; right: number; bottom: number; left: number }, W: number, H: number, out: Float64Array): Float64Array {
  if (!FRAME_TUNING.enabled || !(ins.top + ins.right + ins.bottom + ins.left > 0)) { out.fill(0); return out; }
  bandRows(ins, W, H, out);
  const my = Math.max(FRAME_TUNING.marginMin, FRAME_TUNING.marginFrac * H), mx = Math.max(FRAME_TUNING.marginMin, FRAME_TUNING.marginFrac * W);
  out[0] += my; out[2] += my;
  if (ins.left + ins.right > 0) { out[1] += mx; out[3] += mx; }
  return out;
}

/** The largest body's rest radius (shape.ts 68): a body's centre stands at this height, its top at twice it. */
const R_MAX = 0.625;
/** A framing "meets" the bars with a 1% margin (the live camera eases onto the fit and the browser measures it). */
const MEET = 1.01;
/** The lenses a place may use, widest first (vertical fov, degrees); 35 is the stage's own. Round 3: 17 and 15 added, because a place now
 *  keeps Home's band margin (max(3 px, 2% of the frame) inside the HUD rows, placeBand above: "a place respects the HUD band exactly as
 *  Home does"), and with it the wide layout on 1280 x 800 meets RD-17's 150 px at mid-depth first at 15 degrees (19: 147.1, 17: 149.5). */
export const PLACE_FOVS = [35, 30, 26, 23, 21, 19, 17, 15] as const;

export interface PlayFrame {
  pitch: number; aimX: number; aimY: number; aimZ: number; dist: number;
  /** The lens (vertical fov, degrees) the place camera uses for this framing. */
  fov: number;
  /** CSS px of a 1 m squishy (1 m across) at the front edge of the bounds and at their middle depth. */
  frontPx: number; midPx: number;
  /** RD-17's bars met (tall: 100 front and 80 mid; wide: 150 mid). */
  meets: boolean;
}

/** Project world (x, y, z) for a camera at yaw 0: aim A, distance d, pitch p; returns screen px (or NaN behind the camera). */
function proj(x: number, y: number, z: number, ax: number, ay: number, az: number, d: number, p: number, ty: number, tx: number, W: number, H: number, out: number[]): void {
  const s = Math.sin(p), c = Math.cos(p);
  const cx = ax, cy = ay + d * s, cz = az + d * c;           // the camera position
  const rx = x - cx, ry = y - cy, rz = z - cz;
  const depth = ry * -s + rz * -c;                           // along the forward (0, -s, -c)
  if (depth <= 1e-6) { out[0] = NaN; out[1] = NaN; return; }
  const u = rx / (depth * tx), v = (ry * c + rz * -s) / (depth * ty);   // right (1, 0, 0), up (0, c, -s)
  out[0] = (u * 0.5 + 0.5) * W; out[1] = (1 - (v * 0.5 + 0.5)) * H;
}

/**
 * The best framing of bounds centred (cx, cz) with half sizes (hx, hz) on a cssW x cssH frame with ONE lens (fov in degrees, insets in CSS
 * px). Returns null when nothing fits (a frame smaller than its insets).
 */
export function fitPlayBounds(cx: number, cz: number, hx: number, hz: number, fovDeg: number, cssW: number, cssH: number,
  top: number, right: number, bottom: number, left: number, pitchMin = 0.15, pitchMax = 0.9, bodyR = R_MAX): PlayFrame | null {
  if (!(cssW > 1 && cssH > 1 && hx > 0 && hz > 0)) return null;
  const ty = Math.tan((fovDeg * Math.PI) / 360), tx = ty * (cssW / cssH);
  const L = left, R = cssW - right, T = top, B = cssH - bottom;
  if (!(R - L > 4 && B - T > 4)) return null;
  const tall = cssW / cssH < 0.9;
  // a body centre at each corner of the bounds: the ground under it and its top
  const pts: number[] = [];
  for (const x of [cx - hx, cx + hx]) for (const z of [cz - hz, cz + hz]) pts.push(x, 0, z, x, 2 * bodyR, z);
  const o = [0, 0];
  const fits = (ax: number, ay: number, az: number, d: number, p: number): boolean => {
    for (let i = 0; i < pts.length; i += 3) {
      proj(pts[i], pts[i + 1], pts[i + 2], ax, ay, az, d, p, ty, tx, cssW, cssH, o);
      if (!(o[0] >= L && o[0] <= R && o[1] >= T && o[1] <= B)) return false;
    }
    return true;
  };
  // a 1 m squishy's width on screen at depth z (centred on the bounds' centre line, at its centre's height)
  const sizePx = (z: number, ax: number, ay: number, az: number, d: number, p: number): number => {
    proj(cx - 0.5, 0.5, z, ax, ay, az, d, p, ty, tx, cssW, cssH, o); const a = o[0];
    proj(cx + 0.5, 0.5, z, ax, ay, az, d, p, ty, tx, cssW, cssH, o); return o[0] - a;
  };
  let best: PlayFrame | null = null, bestScore = -Infinity;
  const sx = Math.max(0.05, hx / 8), sz = Math.max(0.05, hz / 10);
  for (let p = pitchMin; p <= pitchMax + 1e-9; p += 0.05) {
    for (let ay = 0.2; ay <= 1.0 + 1e-9; ay += 0.4) {
      for (let az = cz - hz; az <= cz + hz + 1e-9; az += sz) {
        for (let ax = cx - hx * 0.5; ax <= cx + hx * 0.5 + 1e-9; ax += sx) {
          // the smallest distance that fits (fitting is monotonic in the distance for a fixed aim and pitch, once far enough)
          let lo = 0.5, hi = 120;
          if (!fits(ax, ay, az, hi, p)) continue;
          for (let it = 0; it < 24; it++) { const mid = 0.5 * (lo + hi); if (fits(ax, ay, az, mid, p)) hi = mid; else lo = mid; }
          const d = hi, front = sizePx(cz + hz, ax, ay, az, d, p), mid = sizePx(cz, ax, ay, az, d, p);
          const score = tall ? Math.min(front / 100, mid / 80) : mid / 150;
          if (score > bestScore + 1e-9) { bestScore = score; best = { pitch: p, aimX: ax, aimY: ay, aimZ: az, dist: d, fov: fovDeg, frontPx: front, midPx: mid, meets: score >= MEET }; }
        }
      }
    }
  }
  return best;
}

/** setPlayBounds' framing: the widest lens of PLACE_FOVS whose best framing meets RD-17's bars, else the stage's own 35 degree lens. The last
 *  few answers are kept (a resize or a rotation back asks again; the search takes tens of ms per lens). */
const memo: [string, PlayFrame | null][] = [];
/** Round 3: the index of the lens picked last (a refit after the HUD rows changed, e.g. the Cut bar in a place, starts its walk there). */
let lastPick = 0;
export function fitPlace(cx: number, cz: number, hx: number, hz: number, cssW: number, cssH: number,
  top: number, right: number, bottom: number, left: number): PlayFrame | null {
  const key = [cx, cz, hx, hz, cssW, cssH, top, right, bottom, left].join();
  for (const m of memo) if (m[0] === key) return m[1];
  // the widest lens that meets the bars, else the stage's own (index 0). A narrower lens never frames smaller (the size grows as the depth
  // flattens), so the walk from the last pick (wider while the wider one meets, narrower while this one misses) lands where a scan from 35
  // degrees would, in two or three fits instead of up to eight (about 30 ms each).
  const n = PLACE_FOVS.length, got: (PlayFrame | null | undefined)[] = new Array(n);
  const at = (i: number): PlayFrame | null => (got[i] === undefined ? (got[i] = fitPlayBounds(cx, cz, hx, hz, PLACE_FOVS[i], cssW, cssH, top, right, bottom, left)) : got[i]!);
  let i = Math.max(0, Math.min(n - 1, lastPick)), pick: PlayFrame | null = null;
  const fi = at(i);
  if (fi) {
    if (fi.meets) { while (i > 0 && at(i - 1)?.meets) i--; pick = at(i); }
    else { while (i < n - 1 && !at(i)?.meets) i++; if (at(i)?.meets) pick = at(i); else { i = 0; pick = at(0); } }
    lastPick = i;
  }
  memo.unshift([key, pick]); if (memo.length > 4) memo.pop();
  return pick;
}
