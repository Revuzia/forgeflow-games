/**
 * CHROMA HIDE — runtime/mapgen.js  (PURE JS, no three — sim + selftest safe)
 * Expands a compact CAMPUS spec (multiple BUILDINGS + connecting OUTDOOR ZONES in a
 * large bounds) into the flat map-def the engine + sim consume ({rooms, walls, props,
 * lights, spawn, spots}). This is how CHROMA HIDE ships "full maps" (a block of
 * enterable buildings around streets/courtyards), not 3 side-by-side rooms.
 *
 * A BUILDING = a rectangular footprint of wall segments with DOORWAY GAPS, optionally
 * subdivided by interior dividers (also with door gaps). Walls become collision +
 * occlusion + nav obstacles (via toSimMap), so bots path through doors.
 */

// solid sub-segments of [a,b] once the gaps are removed
function solidSegments(a, b, gaps) {
  const g = gaps.slice().sort((p, q) => p[0] - q[0]);
  const segs = []; let cur = a;
  for (const [g0, g1] of g) { if (g0 > cur) segs.push([cur, Math.min(g0, b)]); cur = Math.max(cur, g1); }
  if (cur < b) segs.push([cur, b]);
  return segs.filter(([s0, s1]) => s1 - s0 > 0.06);
}

// wall segments for a rectangle perimeter (footprint) with door gaps, corners overlapped
function rectWalls(b, t, doors, idp) {
  const out = [];
  const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2, z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
  const gapsFor = (side) => (doors || []).filter((d) => d.side === side).map((d) => {
    const w = d.width || 2.0, at = d.at || 0;
    return (side === "N" || side === "S") ? [b.x + at - w / 2, b.x + at + w / 2] : [b.z + at - w / 2, b.z + at + w / 2];
  });
  for (const [side, z] of [["N", z0], ["S", z1]])
    for (const [s0, s1] of solidSegments(x0 - t / 2, x1 + t / 2, gapsFor(side)))
      out.push({ id: `${idp}${side}${out.length}`, x: +((s0 + s1) / 2).toFixed(2), z, w: +(s1 - s0).toFixed(2), d: t });
  for (const [side, x] of [["W", x0], ["E", x1]])
    for (const [s0, s1] of solidSegments(z0 - t / 2, z1 + t / 2, gapsFor(side)))
      out.push({ id: `${idp}${side}${out.length}`, x, z: +((s0 + s1) / 2).toFixed(2), w: t, d: +(s1 - s0).toFixed(2) });
  return out;
}

// a straight interior divider with an optional centered door gap
function dividerWalls(dv, t, idp, i) {
  const horiz = dv.w >= dv.d;
  const gap = dv.doorWidth || 2.4;
  const ats = dv.doorAts || (dv.door ? [dv.doorAt || 0] : []);
  if (!ats.length) return [{ id: `${idp}d${i}`, x: dv.x, z: dv.z, w: dv.w, d: dv.d }];
  const out = [];
  if (horiz) {
    const a = dv.x - dv.w / 2, b = dv.x + dv.w / 2;
    const gaps = ats.map((at) => [dv.x + at - gap / 2, dv.x + at + gap / 2]);
    for (const [s0, s1] of solidSegments(a, b, gaps))
      out.push({ id: `${idp}d${i}_${out.length}`, x: +((s0 + s1) / 2).toFixed(2), z: dv.z, w: +(s1 - s0).toFixed(2), d: t });
  } else {
    const a = dv.z - dv.d / 2, b = dv.z + dv.d / 2;
    const gaps = ats.map((at) => [dv.z + at - gap / 2, dv.z + at + gap / 2]);
    for (const [s0, s1] of solidSegments(a, b, gaps))
      out.push({ id: `${idp}d${i}_${out.length}`, x: dv.x, z: +((s0 + s1) / 2).toFixed(2), w: t, d: +(s1 - s0).toFixed(2) });
  }
  return out;
}

// deterministic PRNG so host + guest (and every reload) build the IDENTICAL map
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Scatter `count` themed props into an area (room/zone), jittered on a grid, from a
 *  palette [{model?, w,d,h, colors:[hex], rough, metal, rots?}]. Deterministic via rng.
 *  Leaves a margin from the walls so props don't block doorways at the edges. */
function scatterProps(area, palette, count, rng, idp, margin) {
  const props = [];
  const mg = margin ?? 1.3;
  const x0 = area.x - area.w / 2 + mg, x1 = area.x + area.w / 2 - mg;
  const z0 = area.z - area.d / 2 + mg, z1 = area.z + area.d / 2 - mg;
  if (x1 <= x0 || z1 <= z0 || count <= 0) return props;
  const aspect = (x1 - x0) / (z1 - z0);
  const cols = Math.max(1, Math.round(Math.sqrt(count * aspect)));
  const rows = Math.max(1, Math.ceil(count / cols));
  let n = 0;
  for (let r = 0; r < rows && n < count; r++) for (let c = 0; c < cols && n < count; c++) {
    const cxc = x0 + (c + 0.5) / cols * (x1 - x0), czc = z0 + (r + 0.5) / rows * (z1 - z0);
    const jx = (rng() - 0.5) * ((x1 - x0) / cols) * 0.55, jz = (rng() - 0.5) * ((z1 - z0) / rows) * 0.55;
    const it = palette[Math.floor(rng() * palette.length)];
    const p = {
      id: `${idp}${n}`, x: +(cxc + jx).toFixed(2), z: +(czc + jz).toFixed(2),
      w: it.w, d: it.d, h: it.h, color: it.colors[Math.floor(rng() * it.colors.length)],
      rough: it.rough, metal: it.metal,
    };
    if (it.model) p.model = it.model;
    if (it.rots) p.rot = it.rots[Math.floor(rng() * it.rots.length)];
    props.push(p); n++;
  }
  return props;
}

// grid of fill point-lights across the bounds (the sun is the key; these lift interiors)
function autoLights(bounds, o = {}) {
  const spacing = o.spacing || 11, y = o.y || 4.6, color = o.color ?? 0xfff2e0, intensity = o.intensity || 17, dist = o.dist || 15;
  const out = [];
  for (let x = bounds.minX + spacing / 2; x < bounds.maxX; x += spacing)
    for (let z = bounds.minZ + spacing / 2; z < bounds.maxZ; z += spacing)
      out.push({ type: "point", x: +x.toFixed(1), y, z: +z.toFixed(1), color, intensity, dist });
  return out;
}

/** Auto-place hiding spots next to scattered props: a spot sits in open floor just
 *  off a prop, facing it (so the bot poses against the blend surface). Deterministic. */
function autoSpots(bounds, props, walls, count, rng) {
  const cand = props.filter((p) => Math.max(p.w, p.d) >= 0.6 && p.h >= 0.4);
  if (!cand.length) return [];
  // body radius (0.55) + half a nav cell (0.5) + slack: guarantees the spot's nav
  // cell centre is walkable, not just the exact point.
  const CLR = 1.3;
  const blocked = (x, z) => {
    for (const p of props) if (Math.abs(x - p.x) < p.w / 2 + CLR && Math.abs(z - p.z) < p.d / 2 + CLR) return true;
    for (const w of walls) if (Math.abs(x - w.x) < w.w / 2 + CLR && Math.abs(z - w.z) < w.d / 2 + CLR) return true;
    return false;
  };
  const inside = (x, z) => x > bounds.minX + 1.2 && x < bounds.maxX - 1.2 && z > bounds.minZ + 1.2 && z < bounds.maxZ - 1.2;
  const idx = cand.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const spots = [];
  for (let k = 0; k < idx.length && spots.length < count; k++) {
    const p = cand[idx[k]];
    const off = Math.max(p.w, p.d) / 2 + 0.95;
    let tx = cx - p.x, tz = cz - p.z; const L = Math.hypot(tx, tz) || 1;
    // try toward map centre first, then the four cardinals
    const dirs = [[tx / L, tz / L], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      const sx = +(p.x + dx * off).toFixed(2), sz = +(p.z + dz * off).toFixed(2);
      if (!inside(sx, sz) || blocked(sx, sz)) continue;
      if (spots.some((s) => (s.x - sx) ** 2 + (s.z - sz) ** 2 < 9)) continue;
      spots.push({ x: sx, z: sz, faceYaw: +Math.atan2(p.x - sx, p.z - sz).toFixed(2) });
      break;
    }
  }
  return spots;
}

/** Expand a campus spec into a full map-def. */
export function buildCampus(spec) {
  const t = spec.wallThickness || 0.4;
  const rng = mulberry32(spec.seed || 0x9e3779b9);
  const rooms = [];
  const walls = [];
  const props = [];
  const addArea = (a, idp) => {
    for (const p of a.props || []) props.push(p);
    if (a.scatter) props.push(...scatterProps(a, a.scatter.palette, a.scatter.count, rng, idp, a.scatter.margin));
  };

  // outdoor connective zones (floor tiles + props/scatter)
  for (const z of spec.zones || []) {
    rooms.push({ id: z.id, name: z.name, x: z.x, z: z.z, w: z.w, d: z.d, floor: z.floor });
    addArea(z, `${z.id}_s`);
  }

  // buildings: interior room tiles + footprint walls (with doors) + dividers + props/scatter
  for (const b of spec.buildings || []) {
    const idp = (b.id || "b") + "_";
    if (b.rooms) for (const r of b.rooms) {
      rooms.push({ id: r.id || `${b.id}_${r.name}`, name: r.name, x: r.x, z: r.z, w: r.w, d: r.d, floor: r.floor ?? b.floor });
      addArea(r, `${b.id}_${(r.id || r.name)}_s`);
    } else {
      rooms.push({ id: b.id, name: b.name, x: b.x, z: b.z, w: b.w, d: b.d, floor: b.floor });
      addArea(b, `${b.id}_s`);
    }
    walls.push(...rectWalls(b, t, b.doors, idp));
    (b.dividers || []).forEach((dv, i) => walls.push(...dividerWalls(dv, t, idp, i)));
    for (const p of b.props || []) props.push(p);
  }

  return {
    id: spec.id,
    name: spec.name,
    blurb: spec.blurb,
    bounds: spec.bounds,
    wallHeight: spec.wallHeight || 5,
    ground: spec.ground,
    ambient: spec.ambient,
    perimeter: spec.perimeter,
    rooms,
    walls,
    props,
    lights: spec.lights || autoLights(spec.bounds, spec.autoLight || {}),
    spawn: spec.spawn,
    spots: spec.spots || autoSpots(spec.bounds, props, walls, spec.spotCount || 32, rng),
  };
}
