// Named areas of a level (LEVELS.md, the optional `areas` field):
//   areas: [{ name: 'The Drip Tray', box: [x0, z0, x1, z1] }, ...]      world-space rectangles on the floor plane
// A level is a journey through four or five of them. They are used for three things, all optional
// and all safe when the field is missing or badly written (level data is authored by hand):
//   - the HUD shows an area's name in a banner the first time the hero enters it, and the pause
//     menu and level select list them;
//   - the renderer merges static geometry per area and stops drawing areas that are out of sight
//     (levels are ~3x longer than they were; a view must not cost 3x);
//   - levels without the field are cut into slices along their long axis for the same economy.
// Pure data and arithmetic - no DOM, no three.js - so Node tests can check it.

/** Longest side of a render chunk, metres: an area longer than this is split so culling has something to cull. */
export const CHUNK_MAX_M = 56;
/** Slice length used for a level that names no areas. */
export const CHUNK_SLICE_M = 40;

/**
 * The areas of a level, cleaned up: [{ name, index, x0, z0, x1, z1 }]. Accepts raw level data or
 * the sim's runtime level (which keeps the raw data in `.source`). Entries that are not
 * { name: string, box: four finite numbers } are dropped; corners may be given in either order.
 */
export function levelAreas(level) {
  const src = level && typeof level === 'object' ? (Array.isArray(level.areas) ? level.areas : level.source && Array.isArray(level.source.areas) ? level.source.areas : null) : null;
  if (!src) return [];
  const out = [];
  for (const a of src) {
    if (!a || typeof a !== 'object' || typeof a.name !== 'string' || !a.name.trim()) continue;
    const b = a.box;
    if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => Number.isFinite(v))) continue;
    out.push({ name: a.name.trim(), index: out.length, x0: Math.min(b[0], b[2]), z0: Math.min(b[1], b[3]), x1: Math.max(b[0], b[2]), z1: Math.max(b[1], b[3]) });
  }
  return out;
}

/** Index of the area that contains (x, z): the first listed wins where two overlap; -1 when none does. */
export function areaAt(areas, x, z) {
  for (let i = 0; i < areas.length; i++) {
    const a = areas[i];
    if (x >= a.x0 && x <= a.x1 && z >= a.z0 && z <= a.z1) return i;
  }
  return -1;
}

/** Distance on the floor plane from (x, z) to a rectangle { x0, z0, x1, z1 } (0 inside it). */
export function distToRect(r, x, z) {
  return Math.hypot(Math.max(r.x0 - x, 0, x - r.x1), Math.max(r.z0 - z, 0, z - r.z1));
}

/**
 * The rectangles static geometry is merged by: every area (split in two or more along its long side
 * when longer than CHUNK_MAX_M), or - for a level with no areas - slices of the level's bounds along
 * its long axis. Always at least one. Each: { x0, z0, x1, z1, area (index or -1) }.
 */
export function chunkPlan(bounds, areas) {
  const out = [];
  const split = (r, area, max) => {
    const lx = r.x1 - r.x0, lz = r.z1 - r.z0, alongX = lx >= lz, len = alongX ? lx : lz;
    const n = Math.max(1, Math.ceil(len / max - 1e-6));
    for (let i = 0; i < n; i++) {
      const a = i / n, b = (i + 1) / n;
      out.push(alongX
        ? { x0: r.x0 + lx * a, z0: r.z0, x1: r.x0 + lx * b, z1: r.z1, area }
        : { x0: r.x0, z0: r.z0 + lz * a, x1: r.x1, z1: r.z0 + lz * b, area });
    }
  };
  if (areas && areas.length) for (const a of areas) split(a, a.index, CHUNK_MAX_M);
  else if (bounds && Number.isFinite(bounds.x0 + bounds.x1 + bounds.z0 + bounds.z1)) split({ x0: bounds.x0, z0: bounds.z0, x1: bounds.x1, z1: bounds.z1 }, -1, CHUNK_SLICE_M);
  if (!out.length) out.push({ x0: -1e6, z0: -1e6, x1: 1e6, z1: 1e6, area: -1 });
  return out;
}

/** The chunk a point belongs to: the one containing it, else the nearest. */
export function chunkOf(chunks, x, z) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < chunks.length; i++) {
    const d = distToRect(chunks[i], x, z);
    if (d <= 0) return i;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/**
 * Tracks which area the hero is in and which have been seen. `step(x, z)` returns the index of an
 * area entered for the FIRST time (so its name can be announced), else -1. Leaving every area (a
 * jump across a gap between two boxes) keeps the last one current.
 */
export class AreaTracker {
  constructor(level) { this.areas = levelAreas(level); this.current = -1; this.seen = new Set(); }
  step(x, z) {
    const i = areaAt(this.areas, x, z);
    if (i < 0 || i === this.current) return -1;
    this.current = i;
    if (this.seen.has(i)) return -1;
    this.seen.add(i);
    return i;
  }
}
