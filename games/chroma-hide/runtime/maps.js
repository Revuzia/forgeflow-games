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

  depot: {
    id: "depot",
    name: "The Depot",
    blurb: "Three connected rooms — a garage, an office and a warehouse — each with its own palette. Blend in one, you'll stand out in the next.",
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    wallHeight: 5,
    ground: { color: 0x5a5550, roughness: 0.95, metalness: 0.0 },
    ambient: { sky: 0xdfe6ef, ground: 0x3a3d40, intensity: 1.28 },
    perimeter: { color: 0x6b6660, roughness: 0.9, thickness: 0.5 },
    // themed floor zones (visual — distinct palette per room)
    rooms: [
      { id: "garage", name: "Garage", x: -9.5, z: 0, w: 9, d: 20, floor: 0x4c4f52 },
      { id: "office", name: "Office", x: 0.5, z: 0, w: 9, d: 20, floor: 0x7a6a4e },
      { id: "warehouse", name: "Warehouse", x: 10, z: 0, w: 8, d: 20, floor: 0x66605a },
    ],
    // interior dividing walls with doorway gaps (garage|office door z=-6..-3, office|warehouse door z=3..6)
    walls: [
      { id: "wgo1", x: -4.5, z: -8, w: 0.4, d: 4 }, { id: "wgo2", x: -4.5, z: 3.5, w: 0.4, d: 13 },
      { id: "wow1", x: 5.5, z: -3.5, w: 0.4, d: 13 }, { id: "wow2", x: 5.5, z: 8, w: 0.4, d: 4 },
    ],
    props: [
      // GARAGE — grey concrete, red/steel/black
      { id: "car", x: -11, z: 1, w: 3.2, d: 1.5, h: 1.3, color: 0x2f5db0, rough: 0.35, metal: 0.4, model: "sedan.glb", rot: 1.57 },
      { id: "toolbox", x: -13, z: -3, w: 1.2, d: 0.8, h: 1.4, color: 0xb02a2a, rough: 0.4, metal: 0.3 },
      { id: "workbench", x: -9, z: -8, w: 3.0, d: 1.2, h: 1.0, color: 0x7a5a3a, rough: 0.8, metal: 0.05, model: "table.glb" },
      { id: "tires", x: -12.5, z: 4, w: 1.1, d: 1.1, h: 1.2, color: 0x1c1c1e, rough: 0.85, metal: 0.0 },
      { id: "gshelf", x: -13.6, z: 0, w: 0.7, d: 4.0, h: 3.2, color: 0x8a9099, rough: 0.5, metal: 0.5, model: "bookcaseClosed.glb", rot: 1.57 },
      { id: "gbin", x: -8, z: 3.5, w: 1.2, d: 1.2, h: 1.5, color: 0x2f6fa0, rough: 0.55, metal: 0.35, model: "dumpster-quaternius.glb" },
      { id: "gcrate", x: -7, z: -3, w: 1.4, d: 1.4, h: 1.4, color: 0xb79a68, rough: 0.8, metal: 0.0, model: "cardboardBoxClosed.glb" },
      { id: "ghydrant", x: -11, z: -6, w: 0.7, d: 0.7, h: 1.1, color: 0xc23020, rough: 0.6, metal: 0.2, model: "hydrant-quaternius.glb" },
      // OFFICE — warm wood, beige/green/black
      { id: "desk1", x: -2, z: -4, w: 2.2, d: 1.2, h: 0.9, color: 0x6b4a30, rough: 0.6, metal: 0.05, model: "desk.glb" },
      { id: "desk2", x: 2, z: 4, w: 2.2, d: 1.2, h: 0.9, color: 0x6b4a30, rough: 0.6, metal: 0.05, model: "desk.glb", rot: 3.14 },
      { id: "cabinet", x: -3.6, z: 6.5, w: 0.9, d: 0.9, h: 1.6, color: 0xa9a08c, rough: 0.5, metal: 0.2, model: "kitchenCabinet.glb" },
      { id: "bookshelf", x: 3.6, z: -6.5, w: 0.8, d: 2.0, h: 2.4, color: 0x5a3f2a, rough: 0.75, metal: 0.0, model: "bookcaseClosed.glb", rot: 1.57 },
      { id: "chair1", x: -2, z: -2.4, w: 0.7, d: 0.7, h: 1.2, color: 0x24262b, rough: 0.5, metal: 0.15 },
      { id: "chair2", x: 2, z: 2.4, w: 0.7, d: 0.7, h: 1.2, color: 0x24262b, rough: 0.5, metal: 0.15 },
      { id: "plant", x: 0, z: 6.5, w: 0.9, d: 0.9, h: 1.7, color: 0x2f7d3a, rough: 0.85, metal: 0.0, model: "tree-small.glb" },
      { id: "cooler", x: 4, z: 0, w: 0.8, d: 0.8, h: 1.2, color: 0x8fd0e0, rough: 0.3, metal: 0.1, model: "ac-unit-quaternius.glb" },
      { id: "sofa", x: -3, z: 0, w: 2.4, d: 1.0, h: 0.9, color: 0x3f6a6a, rough: 0.85, metal: 0.0, model: "loungeSofa.glb", rot: 1.57 },
      // WAREHOUSE — concrete, brown/yellow/steel
      { id: "wshelf1", x: 13.4, z: -5, w: 0.8, d: 3.0, h: 3.4, color: 0x7d838b, rough: 0.5, metal: 0.5, model: "bookcaseClosed.glb", rot: -1.57 },
      { id: "wshelf2", x: 13.4, z: 5, w: 0.8, d: 3.0, h: 3.4, color: 0x7d838b, rough: 0.5, metal: 0.5, model: "bookcaseClosed.glb", rot: -1.57 },
      { id: "cratebig1", x: 8, z: -6, w: 1.9, d: 1.9, h: 2.2, color: 0x9c7a48, rough: 0.8, metal: 0.0, model: "cardboardBoxClosed.glb" },
      { id: "cratebig2", x: 10, z: 6, w: 1.9, d: 1.9, h: 2.0, color: 0xb79a68, rough: 0.8, metal: 0.0, model: "cardboardBoxClosed.glb" },
      { id: "pallet", x: 9, z: 0, w: 1.6, d: 1.2, h: 0.4, color: 0x8a6a44, rough: 0.85, metal: 0.0 },
      { id: "hazbarrel", x: 11, z: -2, w: 1.0, d: 1.0, h: 1.5, color: 0xe0b820, rough: 0.5, metal: 0.2 },
      { id: "container", x: 8, z: 3, w: 2.6, d: 2.0, h: 2.4, color: 0x2f6a8a, rough: 0.6, metal: 0.3, model: "shipping-container-quaternius.glb", rot: 1.57 },
      { id: "forklift", x: 11, z: 4, w: 1.4, d: 2.4, h: 1.8, color: 0xe07a20, rough: 0.55, metal: 0.25 },
    ],
    lights: [
      // two lamps down each 20-deep room so the far ends aren't murky (decay=2)
      { type: "point", x: -9.5, y: 4.5, z: -5.5, color: 0xfff0d8, intensity: 21, dist: 26 },
      { type: "point", x: -9.5, y: 4.5, z: 5.5, color: 0xfff0d8, intensity: 21, dist: 26 },
      { type: "point", x: 0.5, y: 4.5, z: -5.5, color: 0xfff4e0, intensity: 20, dist: 26 },
      { type: "point", x: 0.5, y: 4.5, z: 5.5, color: 0xfff4e0, intensity: 20, dist: 26 },
      { type: "point", x: 10, y: 4.5, z: -5.5, color: 0xe4eeff, intensity: 21, dist: 28 },
      { type: "point", x: 10, y: 4.5, z: 5.5, color: 0xe4eeff, intensity: 21, dist: 28 },
    ],
    spawn: { seeker: { x: 0.5, z: -9 }, hider: { x: 0.5, z: 0 } },
    spots: [
      // garage
      { x: -11, z: 2.4, faceYaw: 0.0 }, { x: -13, z: -3.9, faceYaw: 1.57 }, { x: -13.6, z: 1.6, faceYaw: 1.57 }, { x: -8, z: 4.4, faceYaw: 3.14 },
      // office
      { x: -2, z: -3, faceYaw: 3.14 }, { x: 2, z: 3, faceYaw: 0.0 }, { x: 3.6, z: -5.2, faceYaw: 1.57 }, { x: -3, z: 0.9, faceYaw: 3.14 },
      // warehouse
      { x: 13, z: -5, faceYaw: 1.57 }, { x: 8, z: -4.7, faceYaw: 0.0 }, { x: 11, z: -2.9, faceYaw: 3.14 }, { x: 8, z: 4.2, faceYaw: 3.14 },
    ],
  },

  residence: {
    id: "residence",
    name: "The Residence",
    blurb: "A house — garage, kitchen and living room. Cool concrete, warm wood, cosy carpet: three palettes, one home.",
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    wallHeight: 5,
    ground: { color: 0x6a625a, roughness: 0.95, metalness: 0.0 },
    ambient: { sky: 0xf0e6d4, ground: 0x3d3a34, intensity: 1.28 },
    perimeter: { color: 0x8a7d6a, roughness: 0.9, thickness: 0.5 },
    rooms: [
      { id: "garage", name: "Garage", x: -9.5, z: 0, w: 9, d: 20, floor: 0x50545a },
      { id: "kitchen", name: "Kitchen", x: 0.5, z: 0, w: 9, d: 20, floor: 0xcfc9bc },
      { id: "living", name: "Living Room", x: 10, z: 0, w: 8, d: 20, floor: 0x8a5a44 },
    ],
    walls: [
      { id: "wgk1", x: -4.5, z: -8, w: 0.4, d: 4 }, { id: "wgk2", x: -4.5, z: 3.5, w: 0.4, d: 13 },
      { id: "wkl1", x: 5.5, z: -3.5, w: 0.4, d: 13 }, { id: "wkl2", x: 5.5, z: 8, w: 0.4, d: 4 },
    ],
    props: [
      { id: "car", x: -11, z: 1, w: 3.2, d: 1.5, h: 1.3, color: 0x9c2f2f, rough: 0.35, metal: 0.4, model: "sedan.glb", rot: 1.57 },
      { id: "bench", x: -9, z: -8, w: 3.0, d: 1.2, h: 1.0, color: 0x7a5a3a, rough: 0.8, metal: 0.05, model: "table.glb" },
      { id: "gshelf", x: -13.6, z: 0, w: 0.7, d: 4.0, h: 3.2, color: 0x8a9099, rough: 0.5, metal: 0.5, model: "bookcaseClosed.glb", rot: 1.57 },
      { id: "gbin", x: -8, z: 3.5, w: 1.2, d: 1.2, h: 1.5, color: 0x3a6a3a, rough: 0.55, metal: 0.3, model: "dumpster-quaternius.glb" },
      { id: "gcrate", x: -7, z: -3, w: 1.4, d: 1.4, h: 1.4, color: 0xb79a68, rough: 0.8, metal: 0.0, model: "cardboardBoxClosed.glb" },
      { id: "toolbox", x: -13, z: -3.5, w: 1.2, d: 0.8, h: 1.2, color: 0xc23020, rough: 0.4, metal: 0.35 },
      { id: "tires", x: -12.5, z: 4, w: 1.1, d: 1.1, h: 1.0, color: 0x1c1c1e, rough: 0.85, metal: 0.0 },
      { id: "cab1", x: -3.6, z: -6.5, w: 0.9, d: 0.9, h: 1.6, color: 0xe8e4dc, rough: 0.4, metal: 0.1, model: "kitchenCabinet.glb" },
      { id: "cab2", x: -3.6, z: 6.5, w: 0.9, d: 0.9, h: 1.6, color: 0xe8e4dc, rough: 0.4, metal: 0.1, model: "kitchenCabinet.glb" },
      { id: "cab3", x: 4, z: -2, w: 0.9, d: 0.9, h: 1.6, color: 0xd8d2c8, rough: 0.4, metal: 0.1, model: "kitchenCabinet.glb", rot: 3.14 },
      { id: "island", x: 0, z: 0, w: 2.4, d: 1.2, h: 0.95, color: 0x9a8a6a, rough: 0.5, metal: 0.05, model: "table.glb" },
      { id: "fridge", x: 4, z: 5, w: 1.0, d: 1.0, h: 2.0, color: 0xc8ccd2, rough: 0.3, metal: 0.5, model: "ac-unit-quaternius.glb" },
      { id: "pantry", x: 2, z: -6, w: 1.3, d: 1.3, h: 1.3, color: 0xa98858, rough: 0.8, metal: 0.0, model: "cardboardBoxClosed.glb" },
      { id: "kstool", x: -1.5, z: 2, w: 0.6, d: 0.6, h: 1.0, color: 0x2a2c30, rough: 0.5, metal: 0.2 },
      { id: "sofa1", x: 8, z: 3, w: 2.4, d: 1.0, h: 0.9, color: 0x3f5f7a, rough: 0.85, metal: 0.0, model: "loungeSofa.glb", rot: 1.57 },
      { id: "sofa2", x: 12, z: -3, w: 2.4, d: 1.0, h: 0.9, color: 0x7a4a5a, rough: 0.85, metal: 0.0, model: "loungeSofa.glb", rot: -1.57 },
      { id: "shelf", x: 13.5, z: 5, w: 0.8, d: 3.0, h: 2.6, color: 0x5a3f2a, rough: 0.75, metal: 0.0, model: "bookcaseClosed.glb", rot: -1.57 },
      { id: "coffee", x: 9, z: 0, w: 1.6, d: 1.0, h: 0.6, color: 0x6b4a30, rough: 0.6, metal: 0.05, model: "table.glb" },
      { id: "plant1", x: 8, z: -6, w: 0.9, d: 0.9, h: 1.8, color: 0x2f7d3a, rough: 0.85, metal: 0.0, model: "tree-small.glb" },
      { id: "plant2", x: 13, z: -6, w: 0.9, d: 0.9, h: 1.6, color: 0x3f8d4a, rough: 0.85, metal: 0.0, model: "tree-small.glb" },
      { id: "tv", x: 12.5, z: 6.5, w: 1.8, d: 0.4, h: 1.1, color: 0x14161a, rough: 0.3, metal: 0.3 },
    ],
    lights: [
      // two lamps down each 20-deep room so the far ends aren't murky (decay=2)
      { type: "point", x: -9.5, y: 4.5, z: -5.5, color: 0xdfe8ff, intensity: 20, dist: 26 },
      { type: "point", x: -9.5, y: 4.5, z: 5.5, color: 0xdfe8ff, intensity: 20, dist: 26 },
      { type: "point", x: 0.5, y: 4.5, z: -5.5, color: 0xfff6e6, intensity: 22, dist: 26 },
      { type: "point", x: 0.5, y: 4.5, z: 5.5, color: 0xfff6e6, intensity: 22, dist: 26 },
      { type: "point", x: 10, y: 4.5, z: -5.5, color: 0xffe6c8, intensity: 21, dist: 28 },
      { type: "point", x: 10, y: 4.5, z: 5.5, color: 0xffe6c8, intensity: 21, dist: 28 },
    ],
    spawn: { seeker: { x: 0.5, z: -9 }, hider: { x: 0.5, z: 0 } },
    spots: [
      { x: -11, z: 2.4, faceYaw: 0.0 }, { x: -13.6, z: 1.6, faceYaw: 1.57 }, { x: -8, z: 4.4, faceYaw: 3.14 }, { x: -13, z: -4.4, faceYaw: 1.57 },
      { x: -3.6, z: -5.2, faceYaw: 3.14 }, { x: -3.6, z: 5.2, faceYaw: 3.14 }, { x: 0, z: 1.3, faceYaw: 0.0 }, { x: 4, z: 3.8, faceYaw: 3.14 },
      { x: 8, z: 4.2, faceYaw: 0.0 }, { x: 12, z: -4.2, faceYaw: 3.14 }, { x: 13.5, z: 3.4, faceYaw: -1.57 }, { x: 8, z: -4.8, faceYaw: 0.0 },
    ],
  },
  office: {
    id: "office",
    name: "The Firm",
    blurb: "Three cool grey-blue corporate floors \u2014 a plush reception lobby, a dense open-plan bullpen, and a conference-and-break suite \u2014 with accent pops of teal, orange, red, and steel-blue on the chairs, binders, and appliances so a freshly painted body can vanish into a dozen niches.",
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    wallHeight: 5,
    ground: { color: 0x4a4f57, roughness: 0.95, metalness: 0.0 },
    ambient: { sky: 0xb0bac8, ground: 0x3b4048, intensity: 1.25 },
    perimeter: { color: 0x8a94a6, roughness: 0.9, thickness: 0.5 },
    rooms: [
      { id: "r0", name: "Reception", x: -9.5, z: 0, w: 9, d: 20, floor: 0x8791a1 },
      { id: "r1", name: "Open-Plan Bullpen", x: 0.5, z: 0, w: 9, d: 20, floor: 0x5b6470 },
      { id: "r2", name: "Conference & Break", x: 10.0, z: 0, w: 8, d: 20, floor: 0x9c8f79 },
    ],
    walls: [
      { id: "wa1", x: -4.5, z: -8, w: 0.4, d: 4 }, { id: "wa2", x: -4.5, z: 3.5, w: 0.4, d: 13 },
      { id: "wb1", x: 5.5, z: -3.5, w: 0.4, d: 13 }, { id: "wb2", x: 5.5, z: 8, w: 0.4, d: 4 },
    ],
    props: [
      // Reception
      { id: "reception-counter", x: -10.5, z: -6, w: 2.4, d: 1, h: 1.1, color: 0x566173, rough: 0.7, metal: 0.1 },
      { id: "reception-chair", x: -10.5, z: -4.6, w: 0.6, d: 0.6, h: 1, color: 0x2f9e8f, rough: 0.6, metal: 0.1 },
      { id: "lobby-sofa", x: -11.5, z: 6.2, w: 2.4, d: 1, h: 0.9, color: 0x35406b, rough: 0.85, metal: 0, model: "loungeSofa.glb" },
      { id: "coffee-table", x: -9.3, z: 6.2, w: 1.6, d: 1, h: 0.45, color: 0x7d8899, rough: 0.5, metal: 0.1 },
      { id: "magazine-rack", x: -7.8, z: 6.5, w: 0.7, d: 0.5, h: 0.6, color: 0xb5623f, rough: 0.6, metal: 0.1 },
      { id: "lobby-plant-a", x: -12.2, z: 8, w: 0.9, d: 0.9, h: 1.6, color: 0x4a7c3f, rough: 0.9, metal: 0, model: "tree-small.glb" },
      { id: "lobby-plant-b", x: -12.2, z: -7.5, w: 0.9, d: 0.9, h: 1.6, color: 0x3f6e46, rough: 0.9, metal: 0, model: "tree-small.glb" },
      { id: "file-cabinet-lobby", x: -12.2, z: -3.5, w: 0.9, d: 0.9, h: 1.6, color: 0xc9b98a, rough: 0.45, metal: 0.5, model: "kitchenCabinet.glb" },
      { id: "lobby-side-table", x: -8.5, z: -6, w: 1, d: 0.8, h: 0.5, color: 0xa8845c, rough: 0.5, metal: 0.1 },
      // Open-Plan Bullpen
      { id: "desk-l1", x: -1.9, z: 5.5, w: 1.6, d: 0.8, h: 0.75, color: 0x6b7688, rough: 0.6, metal: 0.1, model: "desk.glb" },
      { id: "desk-r1", x: 2.7, z: 5.5, w: 1.6, d: 0.8, h: 0.75, color: 0x6b7688, rough: 0.6, metal: 0.1, model: "desk.glb" },
      { id: "desk-l2", x: -1.9, z: -5.5, w: 1.6, d: 0.8, h: 0.75, color: 0x5f6a78, rough: 0.6, metal: 0.1, model: "desk.glb" },
      { id: "desk-r2", x: 2.7, z: -5.5, w: 1.6, d: 0.8, h: 0.75, color: 0x5f6a78, rough: 0.6, metal: 0.1, model: "desk.glb" },
      { id: "chair-l1", x: -1.9, z: 4.3, w: 0.6, d: 0.6, h: 1.05, color: 0xe07b39, rough: 0.6, metal: 0.1 },
      { id: "chair-r1", x: 2.7, z: 4.3, w: 0.6, d: 0.6, h: 1.05, color: 0xc0453a, rough: 0.6, metal: 0.1 },
      { id: "chair-l2", x: -1.9, z: -4.3, w: 0.6, d: 0.6, h: 1.05, color: 0x2f9e8f, rough: 0.6, metal: 0.1 },
      { id: "cubicle-partition", x: 0.5, z: 7.2, w: 2.2, d: 0.2, h: 1.5, color: 0x7d8899, rough: 0.8, metal: 0 },
      { id: "file-cabinet-a", x: 3.3, z: 2.5, w: 0.9, d: 0.9, h: 1.6, color: 0xc9b98a, rough: 0.45, metal: 0.5, model: "kitchenCabinet.glb" },
      { id: "file-cabinet-b", x: -2.2, z: 2.5, w: 0.9, d: 0.9, h: 1.6, color: 0x5a6473, rough: 0.45, metal: 0.5, model: "kitchenCabinet.glb" },
      // Conference & Break
      { id: "conference-table", x: 10, z: 4.5, w: 1.6, d: 3, h: 0.75, color: 0x5c4a36, rough: 0.5, metal: 0.1 },
      { id: "conf-chair-1", x: 8.7, z: 3.3, w: 0.6, d: 0.6, h: 1.05, color: 0x2f9e8f, rough: 0.6, metal: 0.1 },
      { id: "conf-chair-2", x: 8.7, z: 5.7, w: 0.6, d: 0.6, h: 1.05, color: 0xe07b39, rough: 0.6, metal: 0.1 },
      { id: "conf-chair-3", x: 11.3, z: 3.3, w: 0.6, d: 0.6, h: 1.05, color: 0xc0453a, rough: 0.6, metal: 0.1 },
      { id: "conf-chair-4", x: 11.3, z: 5.7, w: 0.6, d: 0.6, h: 1.05, color: 0x3b6fb0, rough: 0.6, metal: 0.1 },
      { id: "whiteboard", x: 10, z: 8.2, w: 2.2, d: 0.15, h: 1.4, color: 0xeef0f2, rough: 0.4, metal: 0 },
      { id: "water-cooler", x: 12.6, z: -2, w: 0.5, d: 0.5, h: 1.35, color: 0x3f8fc0, rough: 0.4, metal: 0.2 },
      { id: "break-fridge", x: 12.6, z: -4, w: 1, d: 1, h: 2, color: 0xd8dce0, rough: 0.4, metal: 0.5, model: "ac-unit-quaternius.glb" },
      { id: "break-cabinet", x: 12.6, z: -6, w: 0.9, d: 0.9, h: 1.6, color: 0x566173, rough: 0.45, metal: 0.4, model: "kitchenCabinet.glb" },
      { id: "break-table", x: 8.5, z: -4.5, w: 1.8, d: 1, h: 0.75, color: 0xa8845c, rough: 0.5, metal: 0.1, model: "table.glb" },
    ],
    lights: [
      { type: "point", x: -9.5, y: 4.5, z: -5.5, color: 0xe9f0ff, intensity: 22, dist: 27 },
      { type: "point", x: -9.5, y: 4.5, z: 5.5, color: 0xe9f0ff, intensity: 22, dist: 27 },
      { type: "point", x: 0.5, y: 4.5, z: -5.5, color: 0xe9f0ff, intensity: 22, dist: 27 },
      { type: "point", x: 0.5, y: 4.5, z: 5.5, color: 0xe9f0ff, intensity: 22, dist: 27 },
      { type: "point", x: 10, y: 4.5, z: -5.5, color: 0xe9f0ff, intensity: 22, dist: 28 },
      { type: "point", x: 10, y: 4.5, z: 5.5, color: 0xe9f0ff, intensity: 22, dist: 28 },
    ],
    spawn: { seeker: { x: 0.5, z: -9 }, hider: { x: 0.5, z: 0 } },
    spots: [ { x: -11.9, z: -6, faceYaw: 0.0 }, { x: -7.1, z: 1.5, faceYaw: 3.14 }, { x: -9.5, z: 6.5, faceYaw: 1.57 }, { x: -1.9, z: -6, faceYaw: 0.0 }, { x: 2.9, z: 1.5, faceYaw: 3.14 }, { x: 0.5, z: 6.5, faceYaw: 1.57 }, { x: 7.6, z: -6, faceYaw: 0.0 }, { x: 12.4, z: 1.5, faceYaw: 3.14 }, { x: 10.0, z: 6.5, faceYaw: 1.57 } ],
  },
  street: {
    id: "street",
    name: "The Backlot",
    blurb: "A dusk-lit city backlot in three beats: a storefront strip of produce stalls, planters, a bench and a blue mailbox; a grimy back alley of dumpsters, AC units, a fire hydrant and a weed-cracked corner; and a loading lot with a parked sedan, traffic barriers and a rust shipping container \u2014 all asphalt greys, brick reds, market greens and painted-sign pops.",
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    wallHeight: 5,
    ground: { color: 0x55555a, roughness: 0.95, metalness: 0.0 },
    ambient: { sky: 0xc0987a, ground: 0x3a3844, intensity: 1.34 },
    perimeter: { color: 0x7a4636, roughness: 0.9, thickness: 0.5 },
    rooms: [
      { id: "r0", name: "Storefront Strip", x: -9.5, z: 0, w: 9, d: 20, floor: 0x8f897a },
      { id: "r1", name: "Back Alley", x: 0.5, z: 0, w: 9, d: 20, floor: 0x50505a },
      { id: "r2", name: "Loading Lot", x: 10.0, z: 0, w: 8, d: 20, floor: 0x5a5a62 },
    ],
    walls: [
      { id: "wa1", x: -4.5, z: -8, w: 0.4, d: 4 }, { id: "wa2", x: -4.5, z: 3.5, w: 0.4, d: 13 },
      { id: "wb1", x: 5.5, z: -3.5, w: 0.4, d: 13 }, { id: "wb2", x: 5.5, z: 8, w: 0.4, d: 4 },
    ],
    props: [
      // Storefront Strip
      { id: "r0_produce_stall", x: -11.3, z: -6.8, w: 2.5, d: 1.5, h: 2.2, color: 0xc23b3b, rough: 0.8, metal: 0, model: "market-stalls-quaternius.glb" },
      { id: "r0_produce_bins", x: -11.7, z: -3.9, w: 1.6, d: 1, h: 0.7, color: 0x3f9f57, rough: 0.7, metal: 0.1 },
      { id: "r0_planter_tree_a", x: -12.1, z: -0.9, w: 0.9, d: 0.9, h: 1.6, color: 0x4f8a3f, rough: 0.9, metal: 0, model: "tree-small.glb" },
      { id: "r0_bench", x: -11.4, z: 2.3, w: 2.4, d: 1, h: 0.9, color: 0x2f7f9f, rough: 0.8, metal: 0, model: "loungeSofa.glb" },
      { id: "r0_mailbox", x: -12.2, z: 5.2, w: 0.7, d: 0.6, h: 1.1, color: 0x2b5fd0, rough: 0.4, metal: 0.7 },
      { id: "r0_awning_crates", x: -11.8, z: 7.5, w: 1.3, d: 1.3, h: 1.3, color: 0xc8a066, rough: 0.9, metal: 0, model: "cardboardBoxClosed.glb" },
      { id: "r0_planter_tree_b", x: -7, z: -6.6, w: 0.9, d: 0.9, h: 1.6, color: 0x6a9a3a, rough: 0.9, metal: 0, model: "tree-small.glb" },
      { id: "r0_kiosk", x: -7, z: -3.7, w: 1, d: 0.9, h: 1.5, color: 0xd08a2a, rough: 0.6, metal: 0.2 },
      { id: "r0_stall_table", x: -7.3, z: -0.8, w: 1.8, d: 1, h: 0.75, color: 0x7a4a2a, rough: 0.7, metal: 0, model: "table.glb" },
      { id: "r0_checkout_counter", x: -8.6, z: 7.6, w: 1.8, d: 0.8, h: 1, color: 0x8a5a3a, rough: 0.6, metal: 0.2 },
      // Back Alley
      { id: "r1_dumpster_a", x: -2.05, z: -6.6, w: 1.2, d: 1.2, h: 1.5, color: 0x3a6a3a, rough: 0.6, metal: 0.5, model: "dumpster-quaternius.glb" },
      { id: "r1_ac_a", x: -2.15, z: -3.6, w: 1, d: 1, h: 2, color: 0x8a8a90, rough: 0.5, metal: 0.6, model: "ac-unit-quaternius.glb" },
      { id: "r1_boxes_a", x: -2, z: -1, w: 1.3, d: 1.3, h: 1.3, color: 0xbf9a55, rough: 0.9, metal: 0, model: "cardboardBoxClosed.glb" },
      { id: "r1_hydrant", x: -2.3, z: 2.5, w: 0.4, d: 0.4, h: 0.9, color: 0xc0342a, rough: 0.5, metal: 0.4, model: "hydrant-quaternius.glb" },
      { id: "r1_ac_b", x: -2.15, z: 5.2, w: 1, d: 1, h: 2, color: 0x7a7a80, rough: 0.5, metal: 0.6, model: "ac-unit-quaternius.glb" },
      { id: "r1_dumpster_b", x: -2.05, z: 7.7, w: 1.2, d: 1.2, h: 1.5, color: 0x5a5a3a, rough: 0.6, metal: 0.5, model: "dumpster-quaternius.glb" },
      { id: "r1_alley_tree", x: 3.1, z: -6.3, w: 0.9, d: 0.9, h: 1.6, color: 0x6a9a3a, rough: 0.9, metal: 0, model: "tree-small.glb" },
      { id: "r1_boxes_b", x: 3, z: -3.3, w: 1.3, d: 1.3, h: 1.3, color: 0xc8a860, rough: 0.9, metal: 0, model: "cardboardBoxClosed.glb" },
      { id: "r1_pallet", x: 3.05, z: -1, w: 1.2, d: 1, h: 0.3, color: 0x8a5a2a, rough: 0.9, metal: 0 },
      { id: "r1_dumpster_c", x: 3.05, z: 2.9, w: 1.2, d: 1.2, h: 1.5, color: 0x3a6a4a, rough: 0.6, metal: 0.5, model: "dumpster-quaternius.glb" },
      // Loading Lot
      { id: "r2_sedan", x: 8.5, z: -4, w: 3.2, d: 1.5, h: 1.3, color: 0x3a5a8a, rough: 0.3, metal: 0.6, model: "sedan.glb", rot: 1.57 },
      { id: "r2_container", x: 11.7, z: 4.6, w: 6, d: 2.4, h: 2.6, color: 0xb5622a, rough: 0.6, metal: 0.5, model: "shipping-container-quaternius.glb", rot: 1.57 },
      { id: "r2_barrier_a", x: 9.4, z: -8, w: 1.8, d: 0.5, h: 1, color: 0xd0a020, rough: 0.7, metal: 0.1, model: "barrier-traffic-quaternius.glb" },
      { id: "r2_barrier_b", x: 9.4, z: -6.7, w: 1.8, d: 0.5, h: 1, color: 0xd0a020, rough: 0.7, metal: 0.1, model: "barrier-traffic-quaternius.glb" },
      { id: "r2_pallet", x: 11.9, z: -6.6, w: 1.4, d: 1, h: 0.3, color: 0x8a5a2a, rough: 0.9, metal: 0 },
      { id: "r2_dock_crates", x: 11.9, z: -4.1, w: 1.3, d: 1.3, h: 1.3, color: 0xc0a060, rough: 0.9, metal: 0, model: "cardboardBoxClosed.glb" },
      { id: "r2_dock_ac", x: 12.3, z: -1.6, w: 1, d: 1, h: 2, color: 0x8a8a90, rough: 0.5, metal: 0.6, model: "ac-unit-quaternius.glb" },
      { id: "r2_hydrant", x: 7.1, z: 3.2, w: 0.4, d: 0.4, h: 0.9, color: 0xc0342a, rough: 0.5, metal: 0.4, model: "hydrant-quaternius.glb" },
      { id: "r2_barrier_c", x: 7.8, z: 6.4, w: 1.8, d: 0.5, h: 1, color: 0xd06020, rough: 0.7, metal: 0.1, model: "barrier-traffic-quaternius.glb" },
      { id: "r2_dumpster", x: 7.7, z: 7.8, w: 1.2, d: 1.2, h: 1.5, color: 0x3a6a3a, rough: 0.6, metal: 0.5, model: "dumpster-quaternius.glb" },
    ],
    lights: [
      { type: "point", x: -9.5, y: 4.5, z: -5.5, color: 0xffe4be, intensity: 22, dist: 27 },
      { type: "point", x: -9.5, y: 4.5, z: 5.5, color: 0xffe4be, intensity: 22, dist: 27 },
      { type: "point", x: 0.5, y: 4.5, z: -5.5, color: 0xffe4be, intensity: 22, dist: 27 },
      { type: "point", x: 0.5, y: 4.5, z: 5.5, color: 0xffe4be, intensity: 22, dist: 27 },
      { type: "point", x: 10, y: 4.5, z: -5.5, color: 0xffe4be, intensity: 22, dist: 28 },
      { type: "point", x: 10, y: 4.5, z: 5.5, color: 0xffe4be, intensity: 22, dist: 28 },
    ],
    spawn: { seeker: { x: 0.5, z: -9 }, hider: { x: 0.5, z: 0 } },
    spots: [ { x: -11.9, z: -6, faceYaw: 0.0 }, { x: -7.1, z: 1.5, faceYaw: 3.14 }, { x: -9.5, z: 6.5, faceYaw: 1.57 }, { x: -1.9, z: -6, faceYaw: 0.0 }, { x: 2.9, z: 1.5, faceYaw: 3.14 }, { x: 0.5, z: 6.5, faceYaw: 1.57 }, { x: 7.6, z: -6, faceYaw: 0.0 }, { x: 12.4, z: 1.5, faceYaw: 3.14 }, { x: 10.0, z: 6.5, faceYaw: 1.57 } ],
  },
  supermarket: {
    id: "supermarket",
    name: "Nightshift Mart",
    blurb: "A midnight grocery in three acts: canned-goods aisles of red, blue and gold shelving; a produce-and-deli hall of icy freezers and jewel-toned bins; and a concrete stockroom-dock of kraft pallets, steel wire racks and a mossy shipping container.",
    bounds: { minX: -14, maxX: 14, minZ: -10, maxZ: 10 },
    wallHeight: 5,
    ground: { color: 0x4a4e52, roughness: 0.95, metalness: 0.0 },
    ambient: { sky: 0xf4f8ff, ground: 0x8a8f96, intensity: 1.2 },
    perimeter: { color: 0xbfc4c9, roughness: 0.9, thickness: 0.5 },
    rooms: [
      { id: "r0", name: "Aisles", x: -9.5, z: 0, w: 9, d: 20, floor: 0x8a8375 },
      { id: "r1", name: "Produce & Deli", x: 0.5, z: 0, w: 9, d: 20, floor: 0x6f8a5c },
      { id: "r2", name: "Stockroom & Dock", x: 10.0, z: 0, w: 8, d: 20, floor: 0x55575a },
    ],
    walls: [
      { id: "wa1", x: -4.5, z: -8, w: 0.4, d: 4 }, { id: "wa2", x: -4.5, z: 3.5, w: 0.4, d: 13 },
      { id: "wb1", x: 5.5, z: -3.5, w: 0.4, d: 13 }, { id: "wb2", x: 5.5, z: 8, w: 0.4, d: 4 },
    ],
    props: [
      // Aisles
      { id: "aisle-shelf-wood-front", x: -11.1, z: -5.5, w: 3, d: 0.8, h: 2.6, color: 0x8a6a44, rough: 0.8, metal: 0.05, model: "bookcaseClosed.glb", rot: 1.57 },
      { id: "aisle-shelf-metal-front", x: -7.9, z: -5.5, w: 3, d: 0.8, h: 2.6, color: 0x9aa3ab, rough: 0.5, metal: 0.6, model: "bookcaseClosed.glb", rot: 1.57 },
      { id: "aisle-shelf-red-back", x: -11.1, z: 5.5, w: 3, d: 0.8, h: 2.6, color: 0xb8523a, rough: 0.6, metal: 0.3, model: "bookcaseClosed.glb", rot: 1.57 },
      { id: "aisle-shelf-blue-back", x: -7.9, z: 5.5, w: 3, d: 0.8, h: 2.6, color: 0x3a6ea5, rough: 0.6, metal: 0.3, model: "bookcaseClosed.glb", rot: 1.57 },
      { id: "stock-boxes-yellow", x: -12, z: -1.8, w: 1.3, d: 1.3, h: 1.3, color: 0xe0b83a, rough: 0.9, metal: 0, model: "cardboardBoxClosed.glb" },
      { id: "stock-boxes-magenta", x: -12, z: 1.8, w: 1.3, d: 1.3, h: 1.3, color: 0xd94f8a, rough: 0.9, metal: 0, model: "cardboardBoxClosed.glb" },
      { id: "endcap-display-green", x: -7, z: -2.2, w: 1.3, d: 1.3, h: 1.3, color: 0x2fa36b, rough: 0.85, metal: 0, model: "cardboardBoxClosed.glb" },
      { id: "checkout-counter", x: -9.5, z: 7.5, w: 2, d: 0.9, h: 1, color: 0x444b52, rough: 0.5, metal: 0.2 },
      { id: "entry-potted-plant", x: -6.8, z: 7.9, w: 0.9, d: 0.9, h: 1.6, color: 0x3b7a3b, rough: 0.85, metal: 0, model: "tree-small.glb" },
      // Produce & Deli
      { id: "produce-stall-warm", x: -1, z: -5, w: 2.5, d: 1.5, h: 2.2, color: 0xc96b3a, rough: 0.75, metal: 0.05, model: "market-stalls-quaternius.glb" },
      { id: "produce-stall-green", x: 2.2, z: -5, w: 2.5, d: 1.5, h: 2.2, color: 0x5f9a3a, rough: 0.75, metal: 0.05, model: "market-stalls-quaternius.glb" },
      { id: "deli-freezer-a", x: -2, z: 2.5, w: 1, d: 1, h: 2, color: 0xbcd4e0, rough: 0.35, metal: 0.5, model: "ac-unit-quaternius.glb" },
      { id: "deli-freezer-b", x: -2, z: 4, w: 1, d: 1, h: 2, color: 0xa7c4d4, rough: 0.35, metal: 0.5, model: "ac-unit-quaternius.glb" },
      { id: "produce-bin-apples", x: 0.6, z: -7.6, w: 1.4, d: 1.2, h: 0.7, color: 0xd83a3a, rough: 0.6, metal: 0 },
      { id: "produce-bin-oranges", x: 2.6, z: -7.6, w: 1.4, d: 1.2, h: 0.7, color: 0xe0951f, rough: 0.6, metal: 0 },
      { id: "produce-bin-eggplant", x: -1.4, z: -7.6, w: 1.2, d: 1.2, h: 0.7, color: 0x7a3aa0, rough: 0.6, metal: 0 },
      { id: "deli-glass-case", x: 2.6, z: 5, w: 1.6, d: 1, h: 1.1, color: 0xcfd6da, rough: 0.2, metal: 0.15 },
      { id: "deli-counter-base", x: 2.6, z: 7, w: 1.6, d: 1, h: 1.1, color: 0x46525a, rough: 0.5, metal: 0.2 },
      { id: "bakery-bread-crates", x: -1.7, z: 6.5, w: 1.3, d: 1.3, h: 1.3, color: 0xd2a15a, rough: 0.85, metal: 0, model: "cardboardBoxClosed.glb" },
      // Stockroom & Dock
      { id: "dock-shipping-container", x: 10, z: -7, w: 6, d: 2.4, h: 2.6, color: 0x6b7a52, rough: 0.6, metal: 0.55, model: "shipping-container-quaternius.glb" },
      { id: "dock-dumpster", x: 7.6, z: 6.5, w: 1.2, d: 1.2, h: 1.5, color: 0x2f6a3a, rough: 0.55, metal: 0.5, model: "dumpster-quaternius.glb" },
      { id: "stockroom-locker-gray", x: 12.6, z: -2.2, w: 0.9, d: 0.9, h: 1.6, color: 0x7a828a, rough: 0.45, metal: 0.55, model: "kitchenCabinet.glb" },
      { id: "stockroom-cabinet-wood", x: 12.6, z: -1, w: 0.9, d: 0.9, h: 1.6, color: 0x8a6a44, rough: 0.8, metal: 0.05, model: "kitchenCabinet.glb" },
      { id: "pallet-boxes-kraft", x: 7.7, z: -2.5, w: 1.3, d: 1.3, h: 1.3, color: 0xb07a3a, rough: 0.9, metal: 0, model: "cardboardBoxClosed.glb" },
      { id: "pallet-boxes-tan", x: 9.3, z: -2.5, w: 1.3, d: 1.3, h: 1.3, color: 0xc9a24a, rough: 0.9, metal: 0, model: "cardboardBoxClosed.glb" },
      { id: "pallet-boxes-dark", x: 8.5, z: -4, w: 1.3, d: 1.3, h: 1.3, color: 0x7a5228, rough: 0.9, metal: 0, model: "cardboardBoxClosed.glb" },
      { id: "dock-workbench", x: 11.5, z: 5.5, w: 1.8, d: 1, h: 0.75, color: 0x6a5030, rough: 0.8, metal: 0.1, model: "table.glb" },
      { id: "stockroom-shelf-rack", x: 8.5, z: 2.8, w: 3, d: 0.8, h: 2.6, color: 0x3d5a7a, rough: 0.5, metal: 0.5, model: "bookcaseClosed.glb", rot: 1.57 },
      { id: "stacked-shopping-baskets", x: 11.2, z: 7.8, w: 1.1, d: 1.1, h: 0.9, color: 0xc23b34, rough: 0.7, metal: 0.05 },
    ],
    lights: [
      { type: "point", x: -9.5, y: 4.5, z: -5.5, color: 0xf2f7ff, intensity: 22, dist: 27 },
      { type: "point", x: -9.5, y: 4.5, z: 5.5, color: 0xf2f7ff, intensity: 22, dist: 27 },
      { type: "point", x: 0.5, y: 4.5, z: -5.5, color: 0xf2f7ff, intensity: 22, dist: 27 },
      { type: "point", x: 0.5, y: 4.5, z: 5.5, color: 0xf2f7ff, intensity: 22, dist: 27 },
      { type: "point", x: 10, y: 4.5, z: -5.5, color: 0xf2f7ff, intensity: 22, dist: 28 },
      { type: "point", x: 10, y: 4.5, z: 5.5, color: 0xf2f7ff, intensity: 22, dist: 28 },
    ],
    spawn: { seeker: { x: 0.5, z: -9 }, hider: { x: 0.5, z: 0 } },
    spots: [ { x: -11.9, z: -6, faceYaw: 0.0 }, { x: -7.1, z: 1.5, faceYaw: 3.14 }, { x: -9.5, z: 6.5, faceYaw: 1.57 }, { x: -1.9, z: -6, faceYaw: 0.0 }, { x: 2.9, z: 1.5, faceYaw: 3.14 }, { x: 0.5, z: 6.5, faceYaw: 1.57 }, { x: 7.6, z: -6, faceYaw: 0.0 }, { x: 12.4, z: 1.5, faceYaw: 3.14 }, { x: 10.0, z: 6.5, faceYaw: 1.57 } ],
  },
};

/** Interior props -> 2D collision/occlusion AABBs {x,z,hw,hd}. */
export function mapObstacles(map) {
  return map.props.map((p) => ({ id: p.id, x: p.x, z: p.z, hw: p.w / 2, hd: p.d / 2 }));
}

/** The subset the pure sim needs — props AND interior walls become 2D obstacles. */
export function toSimMap(map) {
  const obstacles = mapObstacles(map);
  for (const w of (map.walls || [])) obstacles.push({ id: w.id || "wall", x: w.x, z: w.z, hw: w.w / 2, hd: w.d / 2 });
  return {
    bounds: map.bounds,
    obstacles,
    spawn: { seeker: { ...map.spawn.seeker }, hider: { ...map.spawn.hider } },
    spots: (map.spots || []).map((s) => ({ ...s })),
  };
}

export function getMap(id) { return MAPS[id] || MAPS.depot; }

// Only the fully-overhauled multi-room stages ship in the picker. The older
// single-room maps (manor/understage/hollow) remain defined for compatibility
// but are excluded until they're rebuilt to the multi-room standard.
const SHIPPED = ["depot", "residence", "office", "street", "supermarket"];
export function mapList() { return SHIPPED.filter((id) => MAPS[id]).map((id) => { const m = MAPS[id]; return { id: m.id, name: m.name, blurb: m.blurb }; }); }
