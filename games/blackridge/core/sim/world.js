// core/sim/world.js [A1] — THREE-free collision queries over collider data.
// Frozen signature: makeWorld(colliders) → { raycast, sphereGround,
// moveCapsule, losBlocked } (architecture §3.6). Private extras allowed.
//
// Conventions: positions [x,y,z] metres, +Y up, −Z north (layout.js).
// pos for capsules = FEET position. Step-up budget 0.35 m (layout stairs use
// 0.30 m risers — A3's stated contract for A1's moveCapsule).

const STEP_UP = 0.35;
const EPS = 1e-9;

// Ray vs AABB (slab). o origin, d direction (need not be normalized when
// used with t in [0,len] semantics — callers pass normalized d + maxDist).
// Returns {tIn, tOut, axis} or null. axis = the slab axis of entry (−1 when
// the origin starts inside the box).
export function rayBox(o, d, box) {
  let tIn = 0, tOut = Infinity, axis = -1;
  for (let i = 0; i < 3; i++) {
    const oi = o[i], di = d[i], mn = box.min[i], mx = box.max[i];
    if (Math.abs(di) < EPS) {
      if (oi < mn || oi > mx) return null;
      continue;
    }
    let t1 = (mn - oi) / di, t2 = (mx - oi) / di;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tIn) { tIn = t1; axis = i; }
    if (t2 < tOut) tOut = t2;
    if (tIn > tOut) return null;
  }
  return { tIn, tOut, axis };
}

export function makeWorld(colliders) {
  const boxes = colliders.boxes || [];
  const groundYFn = colliders.groundY || (() => 0);
  const bounds = colliders.bounds || { min: [-999, -10, -999], max: [999, 50, 999] };

  function groundSurface(x, z) {
    // base terrain = urban concrete/asphalt; canal water reads as 'dirt'
    // (fx/audio vocabulary has no water surface v1).
    return groundYFn(x, z) < -0.5 ? "dirt" : "concrete";
  }

  // Nearest hit along origin + dir*t, t ∈ (0, maxDist]. dir normalized.
  function raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const h = rayBox(origin, dir, b);
      if (!h || h.tIn > bestT || h.tOut < 0) continue;
      const t = Math.max(0, h.tIn);
      if (t <= bestT) { bestT = t; best = { box: b, axis: h.axis, tOut: h.tOut }; }
    }
    // ground planes (base 0 / canal −1.5) — only downward rays can hit
    let groundT = Infinity;
    if (dir[1] < -EPS) {
      for (const gy of [0, -1.5]) {
        const t = (gy - origin[1]) / dir[1];
        if (t > 0 && t < bestT && t < groundT) {
          const gx = origin[0] + dir[0] * t, gz = origin[2] + dir[2] * t;
          if (Math.abs(groundYFn(gx, gz) - gy) < 0.01) groundT = t;
        }
      }
    }
    if (groundT < bestT && groundT <= maxDist) {
      const t = groundT;
      const pos = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
      return { pos, normal: [0, 1, 0], dist: t, surface: groundSurface(pos[0], pos[2]), box: null };
    }
    if (!best) return null;
    const t = bestT;
    const pos = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t];
    const normal = [0, 0, 0];
    if (best.axis >= 0) normal[best.axis] = dir[best.axis] > 0 ? -1 : 1;
    else normal[1] = 1; // started inside — degenerate, face up
    return { pos, normal, dist: t, surface: best.box.surface || "concrete", box: best.box };
  }

  // Standing height at (x,z): terrain ∨ box tops (colliders.js contract —
  // elevated walk surfaces are solid boxes).
  function sphereGround(x, z) {
    let y = groundYFn(x, z);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) {
        if (b.max[1] > y) y = b.max[1];
      }
    }
    return y;
  }

  // Support height for a capsule at (x,z) whose feet are at y: highest
  // walkable top not more than STEP_UP above the feet (so walls are not
  // "support" but stairs/kerbs/decks are), sampled on a small footprint.
  function supportAt(x, z, y, radius) {
    let sup = groundYFn(x, z);
    const r = radius * 0.6;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x + r < b.min[0] || x - r > b.max[0] || z + r < b.min[2] || z - r > b.max[2]) continue;
      const top = b.max[1];
      if (top <= y + STEP_UP && top > sup) sup = top;
    }
    return sup;
  }

  // Would a capsule (feet y, given height) overlap any box it cannot step
  // over? Boxes whose top is ≤ y+STEP_UP are stepped onto, not walls.
  function capsuleBlocked(x, y, z, radius, height) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (x + radius <= b.min[0] || x - radius >= b.max[0]) continue;
      if (z + radius <= b.min[2] || z - radius >= b.max[2]) continue;
      if (b.max[1] <= y + STEP_UP) continue;      // step/kerb — walkable
      if (b.min[1] >= y + height) continue;       // overhead clearance
      return b;
    }
    return null;
  }

  function moveCapsule(pos, vel, dt, radius, height) {
    let x = pos[0], y = pos[1], z = pos[2];
    let vx = vel[0], vy = vel[1], vz = vel[2];
    let hitWall = false;

    const nx = x + vx * dt;
    if (capsuleBlocked(nx, y, z, radius, height)) { vx = 0; hitWall = true; }
    else x = nx;

    const nz = z + vz * dt;
    if (capsuleBlocked(x, y, nz, radius, height)) { vz = 0; hitWall = true; }
    else z = nz;

    let ny = y + vy * dt;
    let grounded = false;
    const sup = supportAt(x, z, y, radius);
    if (ny <= sup + 1e-6 && vy <= 0) { ny = sup; vy = 0; grounded = true; }
    // head bump
    if (vy > 0) {
      const blocked = capsuleBlocked(x, ny, z, radius, height);
      if (blocked && blocked.min[1] > y + height * 0.5) { ny = y; vy = 0; }
    }
    // hard bounds clamp (never leave the map)
    x = Math.min(bounds.max[0] - 0.3, Math.max(bounds.min[0] + 0.3, x));
    z = Math.min(bounds.max[2] - 0.3, Math.max(bounds.min[2] + 0.3, z));
    return { pos: [x, ny, z], vel: [vx, vy, vz], grounded, hitWall };
  }

  // Segment a→b blocked by any collider box? Optional filter(box)→bool
  // restricts the occluder set (AI muzzle-block passes matClass==='hard').
  function losBlocked(a, b, filter) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (filter && !filter(box)) continue;
      const h = rayBox(a, d, box);
      if (h && h.tOut > 0.001 && h.tIn < 0.999) return true;
    }
    return false;
  }

  return {
    raycast, sphereGround, moveCapsule, losBlocked,
    // private extras:
    supportAt, capsuleBlocked, rayBox, boxes, groundY: groundYFn, bounds,
    STEP_UP,
  };
}
