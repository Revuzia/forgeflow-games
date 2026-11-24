// Which walls may fade when they hide Mote from the camera (see Renderer._updateFade). Pure geometry,
// no three.js, so it is unit-tested in Node.

/** A wall counts as "thin" when its smallest dimension is at most this many metres. */
export const THIN_WALL_M = 1.7;

/**
 * A wall or slab thin enough to fade: a plain block, a door or a platform (their boxes follow them as
 * they move), thin on some axis. A floor slot (slatted floor) fades too, so that Mote is not seen
 * through its bars; the camera never collided with it. Not a grate (it stays a wall to the camera, as
 * designed), a crate, a plate, a pane, a ramp or a prop: those keep pulling the camera in, as before.
 */
export function isThinWall(s) {
  const t = s.owner && s.owner.type;
  if (s.kind !== 'box' || s.oneWay) return false;
  if (t === 'slot') return true;
  return !s.pass && (t === 'block' || t === 'door' || t === 'mover') && Math.min(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0) <= THIN_WALL_M;
}

/** Does the segment (ax,ay,az) -> (bx,by,bz) pass through the solid's box? (A segment that starts inside it does.) */
export function segHitsBox(s, ax, ay, az, bx, by, bz) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  if (Math.abs(dx) < 1e-9) { if (ax < s.x0 || ax > s.x1) return false; }
  else { let a = (s.x0 - ax) / dx, c = (s.x1 - ax) / dx; if (a > c) { const t = a; a = c; c = t; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) return false; }
  if (Math.abs(dy) < 1e-9) { if (ay < s.y0 || ay > s.y1) return false; }
  else { let a = (s.y0 - ay) / dy, c = (s.y1 - ay) / dy; if (a > c) { const t = a; a = c; c = t; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) return false; }
  if (Math.abs(dz) < 1e-9) { if (az < s.z0 || az > s.z1) return false; }
  else { let a = (s.z0 - az) / dz, c = (s.z1 - az) / dz; if (a > c) { const t = a; a = c; c = t; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 > t1) return false; }
  return true;
}
