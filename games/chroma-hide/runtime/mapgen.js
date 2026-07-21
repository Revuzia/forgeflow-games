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

// k=2 lane: obstacles inflate by 0.55 each side and nav cells are 1.0, so two boxes
// need (sizeA+sizeB)/2 + 1.10 + 2.0 between centres for a turnable 2-cell lane.
const LANE = 2.2;

/** Scatter themed props into an area (room/zone) as ROW-PACKED CLUSTERS.
 *  Props inside a cluster ABUT — touching boxes merge into one inflated nav blob, so a
 *  cluster costs the same walkable area as a single prop. Lanes (LANE) sit only between
 *  clusters. That is ~3.6x the density of a uniform jittered grid at zero nav cost, and
 *  reads better (clutter clumps; it never spreads evenly).
 *  Optional `dressing` adds small noCollide detail props on/around each cluster — pure
 *  visuals, never nav/LOS obstacles, so detail is unbounded.
 *  Deterministic via rng. Palette: [{model?, w,d,h, colors:[hex], rough, metal, rots?}]. */
function scatterProps(area, palette, count, rng, idp, margin, opts = {}) {
  const props = [];
  const mg = margin ?? 2.0;   // keep props off walls/doorways (was 1.3 — too close)
  const x0 = area.x - area.w / 2 + mg, x1 = area.x + area.w / 2 - mg;
  const z0 = area.z - area.d / 2 + mg, z1 = area.z + area.d / 2 - mg;
  if (x1 <= x0 || z1 <= z0 || count <= 0) return props;

  const per = opts.perCluster || 3;
  const avgW = palette.reduce((a, b) => a + b.w, 0) / palette.length;
  const avgD = palette.reduce((a, b) => a + b.d, 0) / palette.length;
  // cluster runs along x; pitch leaves a k=2 lane between clusters on both axes
  const pitchX = per * avgW + LANE, pitchZ = avgD + LANE;
  const cols = Math.max(1, Math.floor((x1 - x0 + LANE) / pitchX));
  const rows = Math.max(1, Math.floor((z1 - z0 + LANE) / pitchZ));

  let n = 0;
  for (let r = 0; r < rows && n < count; r++) for (let c = 0; c < cols && n < count; c++) {
    const cxc = x0 + (c + 0.5) / cols * (x1 - x0);
    const czc = z0 + (r + 0.5) / rows * (z1 - z0);
    const jx = (rng() - 0.5) * Math.min(0.8, pitchX * 0.12), jz = (rng() - 0.5) * Math.min(0.8, pitchZ * 0.12);
    // one palette item per cluster -> the run reads as a shelf bank / desk row
    const it = palette[Math.floor(rng() * palette.length)];
    const m = Math.min(per, count - n);
    const step = it.w + 0.05;                     // abutting
    const start = -((m - 1) / 2) * step;
    for (let i = 0; i < m; i++) {
      const px = cxc + jx + start + i * step, pz = czc + jz;
      if (px < x0 || px > x1 || pz < z0 || pz > z1) continue;
      const p = {
        id: `${idp}${n}`, x: +px.toFixed(2), z: +pz.toFixed(2),
        w: it.w, d: it.d, h: it.h, color: it.colors[Math.floor(rng() * it.colors.length)],
        rough: it.rough, metal: it.metal,
      };
      if (it.model) p.model = it.model;
      if (it.rots) p.rot = it.rots[Math.floor(rng() * it.rots.length)];
      props.push(p); n++;
      // visual-only dressing riding on this prop (never an obstacle)
      const dr = opts.dressing;
      if (dr && dr.palette && dr.palette.length) {
        const k = Math.floor(rng() * ((dr.max ?? 2) + 1));
        for (let q = 0; q < k; q++) {
          const di = dr.palette[Math.floor(rng() * dr.palette.length)];
          props.push({
            id: `${idp}${n}d${q}`,
            x: +(px + (rng() - 0.5) * it.w * 0.7).toFixed(2),
            z: +(pz + (rng() - 0.5) * it.d * 0.7).toFixed(2),
            w: di.w, d: di.d, h: di.h,
            color: di.colors[Math.floor(rng() * di.colors.length)],
            rough: di.rough, metal: di.metal, noCollide: true,
            ...(di.model ? { model: di.model } : {}),
          });
        }
      }
    }
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

/** Place full-height occluders (h >= 1.7 = tallest body) across a zone's LONG axis so
 *  no unbroken sightline exceeds the seeker's 22m detect cone. Staggered left/right of
 *  centre so the lane still walks. Deterministic. */
function placeBreakers(area, b, rng, idp) {
  const out = [];
  const horiz = area.w >= area.d;
  const L = horiz ? area.w : area.d, S = horiz ? area.d : area.w;
  const n = b.count || Math.max(2, Math.round(L / 18));
  for (let i = 0; i < n; i++) {
    const t = (i + 1) / (n + 1);
    const along = (horiz ? area.x : area.z) - L / 2 + t * L;
    const side = (i % 2 === 0 ? -1 : 1) * Math.min(S * 0.26, 4.5);
    const across = (horiz ? area.z : area.x) + side;
    const p = {
      id: `${idp}bk${i}`,
      x: +(horiz ? along : across).toFixed(2), z: +(horiz ? across : along).toFixed(2),
      w: b.w ?? 1.6, d: b.d ?? 1.6, h: b.h ?? 2.4,
      color: b.colors[Math.floor(rng() * b.colors.length)],
      rough: b.rough ?? 0.7, metal: b.metal ?? 0.2,
    };
    if (b.model) p.model = b.model;
    if (b.rots) p.rot = b.rots[Math.floor(rng() * b.rots.length)];
    out.push(p);
  }
  return out;
}

/** Auto-place hiding spots next to scattered props: a spot sits in open floor just
 *  off a prop, facing it (so the bot poses against the blend surface). Deterministic. */
function autoSpots(bounds, props, walls, count, rng) {
  // dressing (noCollide) neither blocks a body nor makes a hiding anchor
  const solid = props.filter((p) => !p.noCollide);
  const cand = solid.filter((p) => Math.max(p.w, p.d) >= 0.6 && p.h >= 0.4);
  if (!cand.length) return [];
  // body radius (0.55) + half a nav cell (0.5) + slack: guarantees the spot's nav
  // cell centre is walkable, not just the exact point.
  const CLR = 1.3;
  const blocked = (x, z) => {
    for (const p of solid) if (Math.abs(x - p.x) < p.w / 2 + CLR && Math.abs(z - p.z) < p.d / 2 + CLR) return true;
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
      if (spots.some((s) => (s.x - sx) ** 2 + (s.z - sz) ** 2 < 3.0)) continue;
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
    if (a.breakers) props.push(...placeBreakers(a, a.breakers, rng, idp));
    if (a.scatter) props.push(...scatterProps(a, a.scatter.palette, a.scatter.count, rng, idp, a.scatter.margin, a.scatter));
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

  // Edge breakers: scatter margins leave thin empty bands hugging the perimeter and
  // zone seams, and a ray down one of those runs the full 64m — ~3x the seeker's 22m
  // detect cone. Stud those bands with full-height occluders.
  if (spec.edgeBreak) {
    const eb = spec.edgeBreak, b = spec.bounds, inset = eb.inset ?? 1.6;
    const nX = eb.countX ?? 5, nZ = eb.countZ ?? 4;
    const mk = (i, x, z) => ({
      id: `eb${i}`, x: +x.toFixed(2), z: +z.toFixed(2),
      w: eb.w ?? 1.6, d: eb.d ?? 1.6, h: eb.h ?? 2.6,
      color: eb.colors[Math.floor(rng() * eb.colors.length)], rough: eb.rough ?? 0.75, metal: eb.metal ?? 0.15,
    });
    let i = 0;
    for (let k = 0; k < nX; k++) {
      const t = (k + 1) / (nX + 1), x = b.minX + t * (b.maxX - b.minX);
      props.push(mk(i++, x + (k % 2 ? 1.4 : -1.4), b.minZ + inset));
      props.push(mk(i++, x + (k % 2 ? -1.4 : 1.4), b.maxZ - inset));
    }
    for (let k = 0; k < nZ; k++) {
      const t = (k + 1) / (nZ + 1), z = b.minZ + t * (b.maxZ - b.minZ);
      props.push(mk(i++, b.minX + inset, z + (k % 2 ? 1.4 : -1.4)));
      props.push(mk(i++, b.maxX - inset, z + (k % 2 ? -1.4 : 1.4)));
    }
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
    spots: spec.spots || autoSpots(spec.bounds, props, walls, spec.spotCount || 48, rng),
  };
}
