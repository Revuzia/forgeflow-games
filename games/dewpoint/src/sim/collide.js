// Collision for DEWPOINT: kinematic bodies against axis-aligned boxes and ramps (wedges).
//
// Bodies:
//   cylinder  { shape:'cyl', x, y, z, r, h }      x/z = centre, y = FEET (bottom)
//   box       { shape:'box', x, y, z, hx, hz, h } x/z = centre, y = bottom
// Solids:
//   { kind:'box'|'ramp', x0,y0,z0, x1,y1,z1, up, pass, active, owner, dx,dy,dz }
//   A ramp is the wedge under a plane rising from y0 to y1 across the box in direction `up`.
//   `pass` names a CAPABILITY FLAG; a body whose `caps` (its form definition) has that flag set
//   goes straight through ('passesGrate' for grates, 'passesSlot' for slots). Every body has `caps`.
//   `oneWay` solids (sprout leaves) only ever act as a floor: bodies pass up and sideways
//   through them and land on top.
//   dx/dy/dz is how far the solid moved THIS tick (movers, doors) so riders can be carried.
//
// Method: the horizontal and vertical moves are resolved separately in small substeps
// (<= MAX_SUBSTEP), which is what makes thin bodies (film is 0.12 tall) unable to tunnel
// through anything at least MIN_SOLID thick. Horizontal contacts are resolved deepest
// first so the seam between two flush boxes never produces a sideways shove; a body
// standing exactly on a top face is not "inside" it (EPS), so floor seams cannot snag.

import { EPS, MAX_SUBSTEP, GROUND_SNAP } from './constants.js';

export const PASS = 1;   // hook result: the solid stopped being an obstacle, re-test
export const BLOCK = 0;

const PEN = { nx: 0, nz: 0 };

export function blocks(s, b) {
  return s.active && !(s.pass !== null && b.caps[s.pass] === true) && s.owner !== b.owner;
}

function ext(b, alongX) { return b.shape === 'cyl' ? b.r : (alongX ? b.hx : b.hz); }

/** 0..1 position of the body's uphill-most point along a ramp (unclamped). */
export function rampU(s, b) {
  switch (s.up) {
    case '+x': return (b.x + ext(b, true) - s.x0) / (s.x1 - s.x0);
    case '-x': return (s.x1 - (b.x - ext(b, true))) / (s.x1 - s.x0);
    case '+z': return (b.z + ext(b, false) - s.z0) / (s.z1 - s.z0);
    default: return (s.z1 - (b.z - ext(b, false))) / (s.z1 - s.z0); // '-z'
  }
}

/** Height of the solid's top surface under the body's footprint. */
export function topAt(s, b) {
  if (s.kind !== 'ramp') return s.y1;
  let u = rampU(s, b);
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  return s.y0 + (s.y1 - s.y0) * u;
}

/** Rise over run of a ramp. */
export function rampSlope(s) {
  const run = (s.up === '+x' || s.up === '-x') ? (s.x1 - s.x0) : (s.z1 - s.z0);
  return (s.y1 - s.y0) / run;
}

/** Horizontal unit vector pointing uphill. */
export function rampDir(s, out) {
  out.x = s.up === '+x' ? 1 : s.up === '-x' ? -1 : 0;
  out.z = s.up === '+z' ? 1 : s.up === '-z' ? -1 : 0;
  return out;
}

/**
 * Horizontal penetration of body footprint into the solid's rectangle.
 * Returns depth (> 0 when overlapping) and writes the push-out normal to `out`.
 */
export function xzPen(s, b, out) {
  if (b.shape === 'cyl') {
    const r = b.r;
    const qx = b.x < s.x0 ? s.x0 : b.x > s.x1 ? s.x1 : b.x;
    const qz = b.z < s.z0 ? s.z0 : b.z > s.z1 ? s.z1 : b.z;
    const ddx = b.x - qx, ddz = b.z - qz;
    const d2 = ddx * ddx + ddz * ddz;
    if (d2 >= r * r) return 0;
    if (d2 > 1e-14) {
      const d = Math.sqrt(d2);
      out.nx = ddx / d; out.nz = ddz / d;
      return r - d;
    }
    // centre is inside the rectangle: leave through the nearest side
    const l = b.x - s.x0, rr = s.x1 - b.x, n = b.z - s.z0, f = s.z1 - b.z;
    let m = l; out.nx = -1; out.nz = 0;
    if (rr < m) { m = rr; out.nx = 1; out.nz = 0; }
    if (n < m) { m = n; out.nx = 0; out.nz = -1; }
    if (f < m) { m = f; out.nx = 0; out.nz = 1; }
    return m + r;
  }
  const ox = Math.min(b.x + b.hx, s.x1) - Math.max(b.x - b.hx, s.x0);
  if (ox <= 0) return 0;
  const oz = Math.min(b.z + b.hz, s.z1) - Math.max(b.z - b.hz, s.z0);
  if (oz <= 0) return 0;
  if (ox < oz) { out.nx = (b.x < (s.x0 + s.x1) * 0.5) ? -1 : 1; out.nz = 0; return ox; }
  out.nx = 0; out.nz = (b.z < (s.z0 + s.z1) * 0.5) ? -1 : 1; return oz;
}

function farXZ(s, b) {
  const ex = ext(b, true), ez = ext(b, false);
  return b.x + ex <= s.x0 || b.x - ex >= s.x1 || b.z + ez <= s.z0 || b.z - ez >= s.z1;
}

/** True when lifting the body's feet to newY would not push its head into a solid that is currently above it. */
function headroom(world, b, newY) {
  const solids = world.solids;
  const head = b.y + b.h, newHead = newY + b.h;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (!blocks(s, b) || s.oneWay || farXZ(s, b)) continue;
    if (s.y0 < head - EPS || s.y0 >= newHead - EPS) continue;
    if (xzPen(s, b, PEN) > EPS) return false;
  }
  return true;
}

/** Does the body, placed with its feet at y, overlap any blocking solid? (used for form-fit tests) */
export function overlapsAny(world, b, y = b.y, margin = EPS) {
  const solids = world.solids;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (!blocks(s, b) || s.oneWay || farXZ(s, b)) continue;
    if (y + b.h <= s.y0 + margin) continue;
    if (y >= topAt(s, b) - margin) continue;
    if (xzPen(s, b, PEN) > margin) return s;
  }
  return null;
}

/**
 * Horizontal move + resolve.
 * stepMax: how high a ledge the body may be lifted onto instead of being stopped.
 * world.onHitH(b, solid, approachSpeed, nx, nz, depth) may return PASS (solid broke / was pushed).
 */
export function moveH(world, b, dx, dz, stepMax) {
  b.x += dx; b.z += dz;
  const solids = world.solids;
  for (let iter = 0; iter < 6; iter++) {
    let best = null, bestDepth = EPS, bnx = 0, bnz = 0, bestTop = 0;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!blocks(s, b) || s.oneWay || farXZ(s, b)) continue;
      if (b.y + b.h <= s.y0 + EPS) continue;
      const top = topAt(s, b);
      if (b.y >= top - EPS) continue;
      const d = xzPen(s, b, PEN);
      if (d > bestDepth) { best = s; bestDepth = d; bnx = PEN.nx; bnz = PEN.nz; bestTop = top; }
    }
    if (!best) return;
    const lift = bestTop - b.y;
    // A ramp is always climbable in small lifts; a solid that rose into us this tick (lift, door,
    // sprout leaf) carries us up rather than shoving us sideways.
    let maxLift = best.kind === 'ramp' ? Math.max(stepMax, 0.3) : stepMax;
    if (best.dy > 0 && best.dy + 0.02 > maxLift) maxLift = best.dy + 0.02;
    if (lift <= maxLift && headroom(world, b, bestTop)) {
      b.y = bestTop;
      if (b.vy < 0) b.vy = 0;
      b.stepped = true;
      continue;
    }
    const vn = -(b.vx * bnx + b.vz * bnz);
    if (world.onHitH && world.onHitH(b, best, vn, bnx, bnz, bestDepth) === PASS) continue;
    b.x += bnx * bestDepth; b.z += bnz * bestDepth;
    if (vn > 0) {
      b.vx += vn * bnx; b.vz += vn * bnz;
      if (vn > b.wallHit) { b.wallHit = vn; b.wallNx = bnx; b.wallNz = bnz; }
    }
  }
}

/**
 * Vertical move + resolve. Sets b.landed / b.ground on a landing and b.headHit on a ceiling.
 * world.onLand(b, solid, fallSpeed) may return PASS (e.g. ice smashing a floor pane).
 */
export function moveV(world, b, dy) {
  const prevY = b.y;
  b.y += dy;
  const solids = world.solids;
  if (dy <= 0) {
    for (let iter = 0; iter < 3; iter++) {
      let bestTop = -Infinity, bestS = null;
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (!blocks(s, b) || farXZ(s, b)) continue;
        if (b.y + b.h <= s.y0 + EPS) continue;
        const top = topAt(s, b);
        if (b.y >= top - EPS) continue;
        if (prevY < top - 0.1) continue;       // we were beside/inside it, not above: not a landing
        if (top <= bestTop) continue;
        if (xzPen(s, b, PEN) <= EPS) continue;
        bestTop = top; bestS = s;
      }
      if (!bestS) return;
      if (world.onLand && world.onLand(b, bestS, -b.vy) === PASS) continue;
      b.y = bestTop; b.landed = true; b.ground = bestS;
      return;
    }
  } else {
    let bestBottom = Infinity, found = false;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!blocks(s, b) || s.oneWay || farXZ(s, b)) continue;
      if (b.y + b.h <= s.y0 + EPS) continue;
      if (b.y >= topAt(s, b) - EPS) continue;
      if (prevY + b.h > s.y0 + 0.1) continue;  // already beside it
      if (s.y0 >= bestBottom) continue;
      if (xzPen(s, b, PEN) <= EPS) continue;
      bestBottom = s.y0; found = true;
    }
    if (found) { b.y = bestBottom - b.h; b.headHit = true; }
  }
}

/**
 * Full substepped move. opts: { stepGround, stepAir, snap, grounded }
 * Returns nothing; results are on the body: landed, ground, headHit, wallHit.
 */
export function moveBody(world, b, dx, dy, dz, opts) {
  const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  const n = Math.max(1, Math.ceil(m / MAX_SUBSTEP));
  const sx = dx / n, sy = dy / n, sz = dz / n;
  let grounded = opts.grounded;
  b.landed = false; b.headHit = false; b.wallHit = 0; b.stepped = false;
  for (let i = 0; i < n; i++) {
    moveH(world, b, sx, sz, grounded ? opts.stepGround : opts.stepAir);
    b.landed = false;
    moveV(world, b, sy);
    if (!b.landed && opts.snap && grounded && sy <= 0) {
      const y0 = b.y;
      moveV(world, b, -GROUND_SNAP);
      if (!b.landed) b.y = y0;
    }
    grounded = b.landed;
    if (b.headHit && sy > 0) break;
  }
}

/**
 * If the body is embedded in a solid (a form change made something solid, or a mover closed on it),
 * leave through the nearest face. Vertical exits are preferred when they are the shortest way out;
 * horizontal overlaps are left to moveH, which already pushes out sideways.
 * Returns the solid it was embedded in, or null.
 */
export function resolveEmbedded(world, b) {
  const solids = world.solids;
  let hit = null;
  for (let iter = 0; iter < 3; iter++) {
    let found = null, fUp = 0, fDown = 0, fSide = 0;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!blocks(s, b) || s.oneWay || farXZ(s, b)) continue;
      const top = topAt(s, b);
      const up = top - b.y, down = b.y + b.h - s.y0;
      if (up <= 0.01 || down <= 0.01) continue;
      const side = xzPen(s, b, PEN);
      if (side <= 0.01) continue;
      found = s; fUp = up; fDown = down; fSide = side;
      break;
    }
    if (!found) break;
    hit = found;
    if (fUp <= fSide && fUp <= fDown) {
      if (!headroom(world, b, b.y + fUp)) break;
      b.y += fUp; if (b.vy < 0) b.vy = 0;
    } else if (fDown < fSide) {
      b.y -= fDown; if (b.vy > 0) b.vy = 0;
    } else break; // sideways: moveH resolves it this same tick
  }
  return hit;
}

/** Deepest remaining penetration (metres) of the body in any blocking solid; 0 when free. */
export function penetration(world, b) {
  const solids = world.solids;
  let worst = 0;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (!blocks(s, b) || s.oneWay || farXZ(s, b)) continue;
    const up = topAt(s, b) - b.y, down = b.y + b.h - s.y0;
    if (up <= EPS || down <= EPS) continue;
    const side = xzPen(s, b, PEN);
    const d = Math.min(up, down, side);
    if (d > worst) worst = d;
  }
  return worst;
}

/** Ray vs active solids (bounding boxes). Returns hit distance or maxDist. Used by the camera. */
export function raycast(world, ox, oy, oz, dx, dy, dz, maxDist, filter) {
  let best = maxDist;
  const solids = world.solids;
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i];
    if (!s.active || (filter && !filter(s))) continue;
    let t0 = 0, t1 = best;
    // slab test, x
    if (Math.abs(dx) < 1e-9) { if (ox < s.x0 || ox > s.x1) continue; }
    else { let a = (s.x0 - ox) / dx, c = (s.x1 - ox) / dx; if (a > c) { const t = a; a = c; c = t; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue; }
    if (Math.abs(dy) < 1e-9) { if (oy < s.y0 || oy > s.y1) continue; }
    else { let a = (s.y0 - oy) / dy, c = (s.y1 - oy) / dy; if (a > c) { const t = a; a = c; c = t; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue; }
    if (Math.abs(dz) < 1e-9) { if (oz < s.z0 || oz > s.z1) continue; }
    else { let a = (s.z0 - oz) / dz, c = (s.z1 - oz) / dz; if (a > c) { const t = a; a = c; c = t; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) continue; }
    if (s.kind === 'ramp') {
      // refine: accept the box hit only if the entry point is under the slope, else march a few samples
      let hitT = -1;
      const span = t1 - t0;
      for (let k = 0; k <= 6; k++) {
        const t = t0 + span * k / 6;
        const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
        let u;
        switch (s.up) {
          case '+x': u = (px - s.x0) / (s.x1 - s.x0); break;
          case '-x': u = (s.x1 - px) / (s.x1 - s.x0); break;
          case '+z': u = (pz - s.z0) / (s.z1 - s.z0); break;
          default: u = (s.z1 - pz) / (s.z1 - s.z0);
        }
        u = u < 0 ? 0 : u > 1 ? 1 : u;
        if (py <= s.y0 + (s.y1 - s.y0) * u + 1e-6) { hitT = t; break; }
      }
      if (hitT < 0) continue;
      t0 = hitT;
    }
    if (t0 < best) best = t0;
  }
  return best;
}
