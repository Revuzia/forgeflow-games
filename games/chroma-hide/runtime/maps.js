/**
 * CHROMA HIDE — runtime/maps.js
 * PURE map data (no three) so the sim + selftest can consume it headlessly. Each
 * map lists perimeter walls, interior props (paintable cover), lights, spawn
 * zones, and authored hiding spots. game.js builds the three.js meshes from this;
 * the sim derives 2D collision/occlusion AABBs via toSimMap().
 *
 * v1 ships one map (The Manor). Understage + The Hollow are added at M5 as more
 * entries here — a map is data (+ a GLB later), not code.
 */

export const MAPS = {
  manor: {
    id: "manor",
    name: "The Manor",
    blurb: "A warm mansion hall — wood, brass and damask. The flagship stage.",
    bounds: { minX: -11, maxX: 11, minZ: -9, maxZ: 9 },
    wallHeight: 6,
    ground: { color: 0x6b5d4f, roughness: 0.95, metalness: 0.0 },
    ambient: { sky: 0xe9dcc4, ground: 0x2a241d, intensity: 0.7 },
    perimeter: { color: 0x8a5a44, roughness: 0.85, thickness: 0.5 },
    // interior cover — paintable props (also collision + LOS blockers)
    props: [
      { id: "crate_a", x: -6, z: -4, w: 2.0, d: 2.0, h: 2.0, color: 0x3f7d6e, rough: 0.6, metal: 0.1 },
      { id: "plinth", x: 5, z: -5, w: 1.4, d: 1.4, h: 2.6, color: 0xb0a48c, rough: 0.9, metal: 0.0 },
      { id: "chest", x: 4, z: 4, w: 2.4, d: 1.4, h: 1.1, color: 0x9c3b34, rough: 0.4, metal: 0.05 },
      { id: "pillar", x: -5, z: 4, w: 1.1, d: 1.1, h: 4.2, color: 0xc9c9cf, rough: 0.15, metal: 0.9 },
      { id: "shelf", x: 0, z: -1, w: 5.5, d: 1.0, h: 2.4, color: 0x6f4a33, rough: 0.8, metal: 0.0 }, // central divider
      { id: "barrel_a", x: 8, z: 2, w: 1.2, d: 1.2, h: 1.5, color: 0x4a5a6a, rough: 0.7, metal: 0.2 },
      { id: "crate_b", x: -8.5, z: 5.5, w: 1.6, d: 1.6, h: 1.6, color: 0x7a6a4a, rough: 0.75, metal: 0.0 },
      { id: "table", x: 2, z: 6.5, w: 3.0, d: 1.3, h: 1.0, color: 0x8a6b46, rough: 0.6, metal: 0.05 },
    ],
    lights: [
      { type: "point", x: -3, y: 5, z: 3, color: 0xffe9c8, intensity: 30, dist: 40 },
      { type: "point", x: 6, y: 5, z: -4, color: 0xcfe0ff, intensity: 22, dist: 34 },
    ],
    spawn: {
      seeker: { x: 0, z: -7.5 },  // seekers held here during prep (a railed alcove in 3D)
      hider: { x: 0, z: 3.0 },
    },
    // authored hiding spots near cover (faceYaw = which way the body should face)
    spots: [
      { x: -6, z: -2.7, faceYaw: 0.0 }, { x: -4.8, z: -4, faceYaw: 1.57 },
      { x: 5, z: -3.6, faceYaw: 0.0 }, { x: 4, z: 5.0, faceYaw: 3.14 },
      { x: -5, z: 5.3, faceYaw: 3.14 }, { x: 8, z: 3.3, faceYaw: 3.14 },
      { x: -8.5, z: 4.2, faceYaw: 3.14 }, { x: 2, z: 7.4, faceYaw: 3.14 },
      { x: 2.9, z: -1, faceYaw: 1.57 }, { x: -2.9, z: -1, faceYaw: -1.57 },
    ],
  },

  understage: {
    id: "understage",
    name: "Understage",
    blurb: "Dark maintenance tunnels — pipes, barrels and graffiti. Control your gloss and brightness.",
    bounds: { minX: -9, maxX: 9, minZ: -7, maxZ: 7 },
    wallHeight: 5,
    ground: { color: 0x2c2f2c, roughness: 0.98, metalness: 0.0 },
    ambient: { sky: 0x39424a, ground: 0x141613, intensity: 0.45 },
    perimeter: { color: 0x453b33, roughness: 0.9, thickness: 0.5 },
    props: [
      { id: "pipe_a", x: -5, z: -3, w: 6.0, d: 0.9, h: 0.9, color: 0x6a6f74, rough: 0.35, metal: 0.85 }, // steel pipe run
      { id: "pipe_b", x: 4, z: 3, w: 0.9, d: 5.0, h: 0.9, color: 0x6a6f74, rough: 0.35, metal: 0.85 },
      { id: "barrel_a", x: -6, z: 4, w: 1.3, d: 1.3, h: 1.6, color: 0x5a3b2a, rough: 0.6, metal: 0.3 }, // rust barrel
      { id: "barrel_b", x: -4.5, z: 4.2, w: 1.3, d: 1.3, h: 1.6, color: 0x2f4a55, rough: 0.5, metal: 0.35 },
      { id: "crate", x: 5.5, z: -4, w: 1.7, d: 1.7, h: 1.7, color: 0x4a4436, rough: 0.8, metal: 0.05 },
      { id: "valve_box", x: 0.5, z: -0.5, w: 2.2, d: 1.4, h: 2.0, color: 0x3a4048, rough: 0.55, metal: 0.4 },
      { id: "grate_stack", x: 6.5, z: 3.5, w: 1.5, d: 1.2, h: 1.2, color: 0x55504a, rough: 0.7, metal: 0.5 },
    ],
    lights: [
      { type: "point", x: -3, y: 4, z: 2, color: 0xbfd4e0, intensity: 16, dist: 24 },
      { type: "point", x: 5, y: 4, z: -2, color: 0xffcaa0, intensity: 12, dist: 20 },
    ],
    spawn: { seeker: { x: 0, z: -6 }, hider: { x: 0, z: 2.5 } },
    spots: [
      { x: -5, z: -2.2, faceYaw: 0.0 }, { x: 4, z: 3, faceYaw: 1.57 },
      { x: -5.5, z: 3.2, faceYaw: 0.0 }, { x: 5.5, z: -2.9, faceYaw: 3.14 },
      { x: 0.5, z: 0.7, faceYaw: 3.14 }, { x: 6.5, z: 2.3, faceYaw: 3.14 },
      { x: -1.5, z: -0.5, faceYaw: -1.57 }, { x: 2, z: 5.5, faceYaw: 3.14 },
    ],
  },

  hollow: {
    id: "hollow",
    name: "The Hollow",
    blurb: "A liminal mono-yellow space with long sightlines and sparse cover. The hard map.",
    bounds: { minX: -12, maxX: 12, minZ: -10, maxZ: 10 },
    wallHeight: 5,
    ground: { color: 0xb0a24a, roughness: 0.9, metalness: 0.0 },
    ambient: { sky: 0xe8dc84, ground: 0x87803a, intensity: 1.05 },  // flat, bright, low-contrast
    perimeter: { color: 0xc9ba52, roughness: 0.85, thickness: 0.5 },
    props: [
      { id: "chairs", x: -6, z: -5, w: 1.8, d: 1.8, h: 1.6, color: 0xbcae54, rough: 0.85, metal: 0.0 },
      { id: "vending", x: 6, z: -6, w: 1.4, d: 1.2, h: 2.6, color: 0xa89646, rough: 0.6, metal: 0.15 },
      { id: "pillar_a", x: -4, z: 4, w: 1.0, d: 1.0, h: 4.4, color: 0xc4b657, rough: 0.8, metal: 0.0 },
      { id: "pillar_b", x: 5, z: 5, w: 1.0, d: 1.0, h: 4.4, color: 0xc4b657, rough: 0.8, metal: 0.0 },
      { id: "cart", x: 0, z: -2, w: 2.0, d: 1.1, h: 1.1, color: 0xb2a44e, rough: 0.7, metal: 0.1 },
      { id: "crate_pile", x: 8, z: 2, w: 1.6, d: 1.6, h: 1.9, color: 0xbaac52, rough: 0.85, metal: 0.0 },
    ],
    lights: [
      { type: "point", x: 0, y: 5, z: 0, color: 0xfff4c0, intensity: 24, dist: 44 },
    ],
    spawn: { seeker: { x: 0, z: -8.5 }, hider: { x: 0, z: 3.5 } },
    spots: [
      { x: -6, z: -3.8, faceYaw: 0.0 }, { x: 6, z: -4.8, faceYaw: 0.0 },
      { x: -4, z: 5.3, faceYaw: 3.14 }, { x: 5, z: 6.3, faceYaw: 3.14 },
      { x: 0, z: -0.9, faceYaw: 3.14 }, { x: 8, z: 3.4, faceYaw: 3.14 },
      { x: -8, z: 0, faceYaw: -1.57 }, { x: 9, z: -2, faceYaw: 1.57 },
    ],
  },
};

/** Interior props -> 2D collision/occlusion AABBs {x,z,hw,hd}. */
export function mapObstacles(map) {
  return map.props.map((p) => ({ id: p.id, x: p.x, z: p.z, hw: p.w / 2, hd: p.d / 2 }));
}

/** The subset the pure sim needs. */
export function toSimMap(map) {
  return {
    bounds: map.bounds,
    obstacles: mapObstacles(map),
    spawn: { seeker: { ...map.spawn.seeker }, hider: { ...map.spawn.hider } },
    // fresh copies of spots (sim mutates _claimed)
    spots: (map.spots || []).map((s) => ({ ...s })),
  };
}

export function getMap(id) { return MAPS[id] || MAPS.manor; }
export function mapList() { return Object.values(MAPS).map((m) => ({ id: m.id, name: m.name, blurb: m.blurb })); }
