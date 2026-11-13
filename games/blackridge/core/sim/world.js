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
  if (box.obb) return rayObb(o, d, box);
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

// ---------------------------------------------------------------- oriented boxes
// A prop rotated off-axis used to be a conservative world AABB — a car turned
// 38° owned ~2 m of invisible solid air at each corner: bullets stopped in the
// air (decals "in mid air"), and the player bumped into nothing. Boxes that are
// rotated now also carry `obb` = {cx, cz, c, s, hx, hz} — footprint centre,
// cos/sin of the prop's yaw, half extents in the box's LOCAL frame — and the
// SAME min/max stay as the conservative world bound (broad phase, nav bake,
// spawn checks, mantle tops: all unchanged). Exact queries (ray, capsule,
// ground support) use the oriented footprint. Rotation convention matches
// colliders.js / props.js:  world = (c·lx + s·lz,  −s·lx + c·lz).
function rayObb(o, d, box) {
  const ob = box.obb;
  const dx = o[0] - ob.cx, dz = o[2] - ob.cz;
  const lo = [ob.c * dx - ob.s * dz, o[1], ob.s * dx + ob.c * dz];
  const ld = [ob.c * d[0] - ob.s * d[2], d[1], ob.s * d[0] + ob.c * d[2]];
  const mn = [-ob.hx, box.min[1], -ob.hz], mx = [ob.hx, box.max[1], ob.hz];
  let tIn = 0, tOut = Infinity, axis = -1;
  for (let i = 0; i < 3; i++) {
    const oi = lo[i], di = ld[i];
    if (Math.abs(di) < EPS) {
      if (oi < mn[i] || oi > mx[i]) return null;
      continue;
    }
    let t1 = (mn[i] - oi) / di, t2 = (mx[i] - oi) / di;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tIn) { tIn = t1; axis = i; }
    if (t2 < tOut) tOut = t2;
    if (tIn > tOut) return null;
  }
  // world-space face normal of the entry face
  let nx = 0, ny = 0, nz = 0;
  if (axis === 0) { const sg = ld[0] > 0 ? -1 : 1; nx = ob.c * sg; nz = -ob.s * sg; }
  else if (axis === 2) { const sg = ld[2] > 0 ? -1 : 1; nx = ob.s * sg; nz = ob.c * sg; }
  else if (axis === 1) ny = ld[1] > 0 ? -1 : 1;
  return { tIn, tOut, axis, obbNormal: [nx, ny, nz] };
}

// Circle (x,z,r) vs a box footprint — exact for oriented boxes, AABB otherwise.
function overlapXZ(b, x, z, r) {
  if (x + r <= b.min[0] || x - r >= b.max[0] || z + r <= b.min[2] || z - r >= b.max[2]) return false;
  const ob = b.obb;
  if (!ob) return true;
  const dx = x - ob.cx, dz = z - ob.cz;
  const lx = ob.c * dx - ob.s * dz, lz = ob.s * dx + ob.c * dz;
  const qx = lx < -ob.hx ? -ob.hx : lx > ob.hx ? ob.hx : lx;
  const qz = lz < -ob.hz ? -ob.hz : lz > ob.hz ? ob.hz : lz;
  const ex = lx - qx, ez = lz - qz;
  if (r <= 0) return ex === 0 && ez === 0;
  return ex * ex + ez * ez < r * r;
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
  // Boxes tagged moveOnly (colliders.js collision-layer split: the coarse
  // movement hull kept over open-lattice props) are invisible to bullets
  // and LOS — only their compound sub-boxes stop rays.
  function raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.moveOnly) continue;
      const h = rayBox(origin, dir, b);
      if (!h || h.tIn > bestT || h.tOut < 0) continue;
      const t = Math.max(0, h.tIn);
      if (t <= bestT) { bestT = t; best = { box: b, axis: h.axis, tOut: h.tOut, obbNormal: h.obbNormal }; }
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
    if (best.obbNormal && best.axis >= 0) { normal[0] = best.obbNormal[0]; normal[1] = best.obbNormal[1]; normal[2] = best.obbNormal[2]; }
    else if (best.axis >= 0) normal[best.axis] = dir[best.axis] > 0 ? -1 : 1;
    else normal[1] = 1; // started inside — degenerate, face up
    return { pos, normal, dist: t, surface: best.box.surface || "concrete", box: best.box };
  }

  // Standing height at (x,z): terrain ∨ box tops (colliders.js contract —
  // elevated walk surfaces are solid boxes).
  function sphereGround(x, z) {
    let y = groundYFn(x, z);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.rayOnly) continue; // ballistic-layer sub-box (colliders.js split)
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2]) {
        if (b.obb && !overlapXZ(b, x, z, 0)) continue;
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
      if (b.rayOnly) continue; // ballistic layer — never a walk support
      if (x + r < b.min[0] || x - r > b.max[0] || z + r < b.min[2] || z - r > b.max[2]) continue;
      if (b.obb && !overlapXZ(b, x, z, r)) continue;
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
      if (b.rayOnly) continue; // ballistic layer — movement uses the hull
      if (x + radius <= b.min[0] || x - radius >= b.max[0]) continue;
      if (z + radius <= b.min[2] || z - radius >= b.max[2]) continue;
      if (b.obb && !overlapXZ(b, x, z, radius)) continue; // rotated prop: the real footprint, not its AABB
      if (b.max[1] <= y + STEP_UP) continue;      // step/kerb — walkable
      if (b.min[1] >= y + height) continue;       // overhead clearance
      return b;
    }
    return null;
  }

  // ---- SLIDING COLLISION (movement-smoothness pass) ---------------------------
  // The old mover tested the X move and the Z move separately and, on a block,
  // ZEROED that velocity component. On a wall aligned to the world axes that reads
  // as "slide along the wall"; against anything else — a rotated car, a crate off
  // the grid, a convex corner taken diagonally — both axes block and the player
  // simply stops dead, then re-accelerates: the stuck, sticky feel on every prop.
  // Now the capsule's circle is PUSHED OUT of whatever it overlaps along the contact
  // normal (exact for oriented boxes too), and only the velocity going INTO the
  // surface is removed, so you glide around corners and along angled faces at full
  // tangential speed. Same boxes (not rayOnly, not step-able, not overhead), same
  // radius — the walkable/blocked decision is unchanged, only the response is.
  function pushFromBox(b, x, z, r, out) {
    const ob = b.obb;
    let lx, lz, hx, hz;
    if (ob) {
      const dx = x - ob.cx, dz = z - ob.cz;
      lx = ob.c * dx - ob.s * dz; lz = ob.s * dx + ob.c * dz; hx = ob.hx; hz = ob.hz;
    } else {
      hx = (b.max[0] - b.min[0]) / 2; hz = (b.max[2] - b.min[2]) / 2;
      lx = x - (b.min[0] + b.max[0]) / 2; lz = z - (b.min[2] + b.max[2]) / 2;
    }
    // The blocked region is the footprint INFLATED by r with square corners — exactly
    // what capsuleBlocked / the nav bake treat as blocked, so walkability is unchanged.
    // Leave through the face with the SHALLOWER penetration: along a wall that is the
    // wall's normal, and at a convex corner taken diagonally it picks one face, so the
    // player slides on along the other (a radial push would stall dead head-on).
    const px = hx + r - Math.abs(lx), pz = hz + r - Math.abs(lz);
    if (px <= 0 || pz <= 0) return false;
    let nxl, nzl, depth;
    if (px < pz) { nxl = lx < 0 ? -1 : 1; nzl = 0; depth = px; }
    else { nxl = 0; nzl = lz < 0 ? -1 : 1; depth = pz; }
    if (ob) { out.nx = ob.c * nxl + ob.s * nzl; out.nz = -ob.s * nxl + ob.c * nzl; }
    else { out.nx = nxl; out.nz = nzl; }
    out.depth = depth;
    return true;
  }

  const _push = { nx: 0, nz: 0, depth: 0 };
  // deepest overlap among the boxes a capsule at (x,y,z) cannot step over
  function deepestPush(x, y, z, r, h, out) {
    let best = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.rayOnly) continue;
      if (x + r <= b.min[0] || x - r >= b.max[0] || z + r <= b.min[2] || z - r >= b.max[2]) continue;
      if (b.max[1] <= y + STEP_UP) continue;   // step / kerb — walkable
      if (b.min[1] >= y + h) continue;         // overhead clearance
      if (!pushFromBox(b, x, z, r, _push)) continue;
      if (_push.depth > best) { best = _push.depth; out.nx = _push.nx; out.nz = _push.nz; out.depth = _push.depth; }
    }
    return best > 0;
  }

  const _contact = { nx: 0, nz: 0, depth: 0 };

  function moveCapsule(pos, vel, dt, radius, height) {
    let x = pos[0], y = pos[1], z = pos[2];
    let vx = vel[0], vy = vel[1], vz = vel[2];
    let hitWall = false;

    // horizontal: move, then slide out of anything we now overlap (≤ 4 contacts —
    // a corner is two, a narrow gap can be three)
    x += vx * dt; z += vz * dt;
    for (let it = 0; it < 4; it++) {
      if (!deepestPush(x, y, z, radius, height, _contact)) break;
      x += _contact.nx * (_contact.depth + 1e-4);
      z += _contact.nz * (_contact.depth + 1e-4);
      const vn = vx * _contact.nx + vz * _contact.nz;
      if (vn < 0) { vx -= vn * _contact.nx; vz -= vn * _contact.nz; }
      hitWall = true;
    }

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
      if (box.moveOnly) continue; // movement hull — transparent to sight
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
