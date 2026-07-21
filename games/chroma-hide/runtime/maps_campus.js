/**
 * CHROMA HIDE — runtime/maps_campus.js  (PURE JS)
 * The FULL-SCALE maps: campuses of multiple multi-room BUILDINGS joined by outdoor
 * courtyards/streets/yards, built from compact specs via mapgen.buildCampus. Bounds
 * 64x52 (72x56 for the estate) per the map-design brief. Single-floor (the sim is 2D
 * — no verticality), open sightlines broken under ~20m by themed cover, doorways >=2.5m.
 */
import { buildCampus } from "./mapgen.js";

// ── shared prop palettes (model? + size + color choices + optional rotations) ───────
const PAL = {
  // office
  recep: [
    { model: "loungeSofa.glb", w: 2.4, d: 1.0, h: 0.9, colors: [0x35406b, 0x3f6a6a, 0x7a4a5a], rough: 0.85, metal: 0, rots: [0, 1.57, 3.14] },
    { model: "tree-small.glb", w: 0.9, d: 0.9, h: 1.8, colors: [0x2f7d3a, 0x3f6e46, 0x4a7c3f], rough: 0.9, metal: 0 },
    { w: 1.6, d: 1.0, h: 0.45, colors: [0x7d8899, 0xa8845c], rough: 0.5, metal: 0.1 },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0xc9b98a, 0x566173], rough: 0.45, metal: 0.4 },
    { w: 0.7, d: 0.5, h: 0.6, colors: [0xb5623f, 0xe07b39], rough: 0.6, metal: 0.1 },
  ],
  bullpen: [
    { model: "desk.glb", w: 1.6, d: 0.8, h: 0.75, colors: [0x6b7688, 0x5f6a78], rough: 0.6, metal: 0.1, rots: [0, 3.14] },
    { w: 0.6, d: 0.6, h: 1.05, colors: [0xe07b39, 0xc0453a, 0x2f9e8f, 0x3b6fb0], rough: 0.6, metal: 0.1 },
    { w: 0.5, d: 0.4, h: 0.5, colors: [0x14161a, 0x24262b], rough: 0.3, metal: 0.3 },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0xc9b98a, 0x5a6473], rough: 0.45, metal: 0.5 },
    { w: 0.22, d: 2.0, h: 1.95, colors: [0x7d8899, 0x8a94a6], rough: 0.8, metal: 0, rots: [0, 1.57] },
  ],
  offices: [
    { model: "desk.glb", w: 1.6, d: 0.8, h: 0.75, colors: [0x6b4a30, 0x5c4a36], rough: 0.6, metal: 0.05, rots: [0, 1.57, 3.14] },
    { w: 0.6, d: 0.6, h: 1.05, colors: [0x2f9e8f, 0xc0453a, 0x3b6fb0], rough: 0.6, metal: 0.1 },
    { model: "bookcaseClosed.glb", w: 0.8, d: 2.0, h: 2.4, colors: [0x5a3f2a, 0x8a9099], rough: 0.6, metal: 0.2, rots: [0, 1.57] },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0xc9b98a, 0x566173], rough: 0.45, metal: 0.5 },
  ],
  brk: [
    { model: "table.glb", w: 1.8, d: 1.0, h: 0.75, colors: [0xa8845c, 0x5c4a36], rough: 0.5, metal: 0.1 },
    { w: 0.6, d: 0.6, h: 1.05, colors: [0xe07b39, 0x2f9e8f, 0xc0453a], rough: 0.6, metal: 0.1 },
    { model: "ac-unit-quaternius.glb", w: 1.0, d: 1.0, h: 2.0, colors: [0xd8dce0, 0xc8ccd2], rough: 0.4, metal: 0.5 },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0x566173, 0xc9b98a], rough: 0.45, metal: 0.4 },
    { w: 0.5, d: 0.5, h: 1.35, colors: [0x3f8fc0, 0x8fd0e0], rough: 0.4, metal: 0.2 },
  ],
  lot: [
    { model: "sedan.glb", w: 3.2, d: 1.5, h: 1.3, colors: [0x2f5db0, 0x883333, 0x333a44, 0x2a6a4a], rough: 0.35, metal: 0.5, rots: [1.57] },
    { model: "barrier-traffic-quaternius.glb", w: 1.8, d: 0.5, h: 1.0, colors: [0xd0a020, 0xd06020], rough: 0.7, metal: 0.1, rots: [0, 1.57] },
    { model: "dumpster-quaternius.glb", w: 1.2, d: 1.2, h: 1.75, colors: [0x2f6a3a, 0x3a5a8a], rough: 0.6, metal: 0.5 },
    { model: "hydrant-quaternius.glb", w: 0.5, d: 0.5, h: 0.9, colors: [0xc23020], rough: 0.5, metal: 0.3 },
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xb79a68, 0xc8a066], rough: 0.85, metal: 0 },
  ],
  breez: [
    { model: "tree-small.glb", w: 0.9, d: 0.9, h: 1.8, colors: [0x2f7d3a, 0x3f8d4a], rough: 0.9, metal: 0 },
    { model: "loungeSofa.glb", w: 2.4, d: 1.0, h: 0.9, colors: [0x3f6a6a, 0x35406b], rough: 0.85, metal: 0, rots: [1.57] },
  ],
  alley: [
    { model: "ac-unit-quaternius.glb", w: 1.0, d: 1.0, h: 2.0, colors: [0x8a8a90, 0x7a7a80], rough: 0.5, metal: 0.6 },
    { model: "shipping-container-quaternius.glb", w: 6, d: 2.4, h: 2.6, colors: [0xb5622a, 0x2f6a8a], rough: 0.6, metal: 0.4, rots: [0] },
    { model: "dumpster-quaternius.glb", w: 1.2, d: 1.2, h: 1.75, colors: [0x3a6a3a, 0x5a5a3a], rough: 0.6, metal: 0.5 },
  ],
  // street block
  grocer: [
    { model: "market-stalls-quaternius.glb", w: 2.5, d: 1.5, h: 2.2, colors: [0xc23b3b, 0x5f9a3a, 0xc96b3a], rough: 0.75, metal: 0.05, rots: [0, 1.57] },
    { w: 1.4, d: 1.1, h: 0.7, colors: [0xd83a3a, 0xe0951f, 0x7a3aa0, 0x3f9f57], rough: 0.6, metal: 0 },
    { model: "table.glb", w: 1.8, d: 1.0, h: 0.75, colors: [0x7a4a2a, 0x8a5a3a], rough: 0.7, metal: 0 },
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xc8a066, 0xbf9a55], rough: 0.9, metal: 0 },
  ],
  cafe: [
    { model: "table.glb", w: 1.8, d: 1.0, h: 0.75, colors: [0x6b4a30, 0xa8845c], rough: 0.55, metal: 0.05 },
    { model: "loungeSofa.glb", w: 2.4, d: 1.0, h: 0.9, colors: [0x7a4a5a, 0x3f6a6a, 0x8a5a3a], rough: 0.85, metal: 0, rots: [0, 1.57] },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0xe8e4dc, 0x566173], rough: 0.45, metal: 0.3 },
    { w: 0.6, d: 0.6, h: 1.0, colors: [0x2a2c30, 0xc0453a], rough: 0.6, metal: 0.1 },
  ],
  hardware: [
    { model: "bookcaseClosed.glb", w: 0.8, d: 3.0, h: 2.6, colors: [0x8a9099, 0x5a3f2a, 0x3d5a7a], rough: 0.55, metal: 0.4, rots: [0, 1.57] },
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xb79a68, 0xc9a24a], rough: 0.9, metal: 0 },
    { w: 1.2, d: 0.8, h: 1.9, colors: [0xc23020, 0xd0a020], rough: 0.5, metal: 0.3 },
    { model: "table.glb", w: 1.8, d: 1.0, h: 0.75, colors: [0x6a5030], rough: 0.8, metal: 0.1 },
  ],
  street: [
    { model: "sedan.glb", w: 3.2, d: 1.5, h: 1.3, colors: [0x2f5db0, 0x883333, 0x333a44], rough: 0.35, metal: 0.5, rots: [0, 1.57] },
    { model: "hydrant-quaternius.glb", w: 0.5, d: 0.5, h: 0.9, colors: [0xc0342a], rough: 0.5, metal: 0.3 },
    { model: "tree-small.glb", w: 0.9, d: 0.9, h: 1.8, colors: [0x4f8a3f, 0x6a9a3a], rough: 0.9, metal: 0 },
    { model: "barrier-traffic-quaternius.glb", w: 1.8, d: 0.5, h: 1.0, colors: [0xd0a020, 0xd06020], rough: 0.7, metal: 0.1, rots: [0, 1.57] },
  ],
  yard: [
    { model: "shipping-container-quaternius.glb", w: 6, d: 2.4, h: 2.6, colors: [0xb5622a, 0x2f6a8a, 0x6b7a52], rough: 0.6, metal: 0.45, rots: [0, 1.57] },
    { model: "barrier-traffic-quaternius.glb", w: 1.8, d: 0.5, h: 1.0, colors: [0xd0a020], rough: 0.7, metal: 0.1, rots: [0, 1.57] },
    { model: "dumpster-quaternius.glb", w: 1.2, d: 1.2, h: 1.75, colors: [0x2f6a3a, 0x5a5a3a], rough: 0.6, metal: 0.5 },
    { w: 1.4, d: 1.0, h: 0.35, colors: [0x8a5a2a], rough: 0.9, metal: 0 },
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xc0a060, 0xb07a3a], rough: 0.9, metal: 0 },
  ],
  // supermarket
  aisles: [
    { model: "bookcaseClosed.glb", w: 0.8, d: 3.0, h: 2.6, colors: [0xb8523a, 0x3a6ea5, 0xe0b83a, 0x2fa36b], rough: 0.6, metal: 0.3, rots: [1.57] },
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xe0b83a, 0xd94f8a, 0x2fa36b, 0x3a6ea5], rough: 0.9, metal: 0 },
  ],
  produce: [
    { model: "market-stalls-quaternius.glb", w: 2.5, d: 1.5, h: 2.2, colors: [0xc96b3a, 0x5f9a3a], rough: 0.75, metal: 0.05, rots: [0, 1.57] },
    { w: 1.4, d: 1.2, h: 0.7, colors: [0xd83a3a, 0xe0951f, 0x7a3aa0, 0x3f9f57], rough: 0.6, metal: 0 },
    { model: "ac-unit-quaternius.glb", w: 1.0, d: 1.0, h: 2.0, colors: [0xbcd4e0, 0xa7c4d4], rough: 0.35, metal: 0.5 },
    { w: 1.6, d: 1.0, h: 1.1, colors: [0xcfd6da, 0x46525a], rough: 0.3, metal: 0.2 },
  ],
  stock: [
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xb07a3a, 0xc9a24a, 0x7a5228], rough: 0.9, metal: 0 },
    { model: "bookcaseClosed.glb", w: 0.8, d: 3.0, h: 2.6, colors: [0x3d5a7a, 0x7a828a], rough: 0.5, metal: 0.5, rots: [1.57] },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0x7a828a, 0x8a6a44], rough: 0.5, metal: 0.4 },
  ],
  garden: [
    { model: "tree-small.glb", w: 0.9, d: 0.9, h: 1.8, colors: [0x3b7a3b, 0x4f8a3f, 0x2f7d3a], rough: 0.9, metal: 0 },
    { model: "market-stalls-quaternius.glb", w: 2.5, d: 1.5, h: 2.2, colors: [0x5f9a3a], rough: 0.8, metal: 0, rots: [0, 1.57] },
    { w: 1.2, d: 1.2, h: 0.6, colors: [0x6a8a4a, 0x8a6a44], rough: 0.85, metal: 0 },
  ],
};

// Visual-only DRESSING (noCollide): small clutter riding on furniture. Never nav/LOS
// obstacles, so detail is unbounded — this is where the prop-count budget actually goes.
const DRESS = {
  office: [
    { w: 0.36, d: 0.28, h: 0.32, colors: [0x14161a, 0xc0453a, 0x2f9e8f, 0xe07b39], rough: 0.5, metal: 0.2 },
    { w: 0.22, d: 0.22, h: 0.26, colors: [0xd8dce0, 0x8a94a6, 0x3f8fc0], rough: 0.6, metal: 0.1 },
    { w: 0.5, d: 0.34, h: 0.12, colors: [0xeef0f2, 0xc9b98a], rough: 0.7, metal: 0 },
  ],
  retail: [
    { w: 0.32, d: 0.3, h: 0.34, colors: [0xe0b83a, 0xd94f8a, 0x2fa36b, 0x3a6ea5, 0xd83a3a], rough: 0.8, metal: 0 },
    { w: 0.24, d: 0.24, h: 0.26, colors: [0xe0951f, 0x7a3aa0, 0x3f9f57, 0xc23b3b], rough: 0.6, metal: 0 },
    { w: 0.45, d: 0.3, h: 0.16, colors: [0xc8a066, 0xb07a3a], rough: 0.85, metal: 0 },
  ],
  yard: [
    { w: 0.42, d: 0.42, h: 0.45, colors: [0xb07a3a, 0x8a5a2a, 0x5a5a3a], rough: 0.9, metal: 0 },
    { w: 0.3, d: 0.3, h: 0.5, colors: [0xc0342a, 0xd0a020, 0x2f6a3a], rough: 0.6, metal: 0.3 },
    { w: 0.5, d: 0.36, h: 0.2, colors: [0x55555a, 0x7a7a80], rough: 0.8, metal: 0.2 },
  ],
};

export const CAMPUS_MAPS = {
  office: buildCampus({
    id: "office", name: "The Firm",
    blurb: "A corporate campus — two multi-room office buildings around a parking lot, a breezeway and a rear service alley. Blend into a dozen niches across seven rooms.",
    seed: 0x0ff1ce,
    bounds: { minX: -32, maxX: 32, minZ: -26, maxZ: 26 }, wallHeight: 5,
    ground: { color: 0x3f4348, roughness: 0.95, tex: "concrete" },
    ambient: { sky: 0xc6d2e0, ground: 0x40454c, intensity: 1.35 },
    perimeter: { color: 0x8a94a6, roughness: 0.9, thickness: 0.5, tex: "plaster" },
    autoLight: { spacing: 12, intensity: 15, dist: 16, color: 0xfff2e0 },
    buildings: [
      {
        id: "A", name: "Main Office", x: -16, z: -6, w: 28, d: 24, floor: 0x6a7280,
        doors: [{ side: "S", at: -1, width: 3.2 }, { side: "N", at: 6, width: 2.6 }],
        dividers: [
          { x: -16, z: -2, w: 28, d: 0.4, doorWidth: 3.0, doorAts: [-8, 7] },
          { x: -16, z: -10, w: 28, d: 0.4, doorWidth: 3.0, doorAts: [-8, 7] },
        ],
        rooms: [
          { id: "reception", name: "Reception", x: -16, z: 2, w: 28, d: 8, floor: 0x8a5a34, tex: "wood", breakers: { count: 2, w: 1.2, d: 2.4, h: 2.5, colors: [0x8791a1, 0x5a6473] }, scatter: { palette: PAL.recep, count: 19, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "bullpen", name: "Bullpen", x: -16, z: -6, w: 28, d: 8, floor: 0x5b6470, tex: "carpet", breakers: { count: 3, w: 1.2, d: 2.4, h: 2.4, colors: [0x7d8899, 0x5f6a78] }, scatter: { palette: PAL.bullpen, count: 21, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "offices", name: "Offices", x: -16, z: -14, w: 28, d: 8, floor: 0x6a7280, tex: "carpet", breakers: { count: 2, w: 1.2, d: 2.4, h: 2.5, colors: [0x5a3f2a, 0x8a9099] }, scatter: { palette: PAL.offices, count: 19, dressing: { palette: DRESS.office, max: 3 } } },
        ],
      },
      {
        id: "B", name: "Annex", x: 16, z: -6, w: 28, d: 24, floor: 0x6a7280,
        doors: [{ side: "S", at: 1, width: 3.2 }, { side: "W", at: 6, width: 2.6 }, { side: "N", at: 1, width: 2.6 }],
        dividers: [
          { x: 16, z: -2, w: 28, d: 0.4, doorWidth: 3.0, doorAts: [-7, 8] },
          { x: 16, z: -10, w: 28, d: 0.4, doorWidth: 3.0, doorAts: [-7, 8] },
        ],
        rooms: [
          { id: "breakroom", name: "Break Room", x: 16, z: 2, w: 28, d: 8, floor: 0x9098a0, tex: "checker", breakers: { count: 2, w: 1.2, d: 2.2, h: 2.4, colors: [0x9c8f79, 0x566173] }, scatter: { palette: PAL.brk, count: 17, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "copyit", name: "Copy / IT", x: 16, z: -6, w: 28, d: 8, floor: 0x5f6a78, tex: "carpet", breakers: { count: 3, w: 1.2, d: 2.4, h: 2.4, colors: [0x5f6a78, 0xc9b98a] }, scatter: { palette: PAL.offices, count: 19, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "annexconf", name: "Conference", x: 16, z: -14, w: 28, d: 8, floor: 0x7a5230, tex: "wood", breakers: { count: 2, w: 1.2, d: 2.2, h: 2.4, colors: [0x6a7280, 0xa8845c] }, scatter: { palette: PAL.brk, count: 14, dressing: { palette: DRESS.office, max: 3 } } },
        ],
      },
    ],
    zones: [
      { id: "lot", name: "Parking Lot", x: 0, z: 17, w: 64, d: 18, floor: 0x55555a, tex: "concrete", breakers: { count: 4, w: 1.6, d: 1.6, h: 2.8, colors: [0x6a7280, 0x55555a, 0x8a94a6] }, scatter: { palette: PAL.lot, count: 29, dressing: { palette: DRESS.yard, max: 3 }, margin: 2.5 } },
      { id: "breezeway", name: "Breezeway", x: 0, z: -5, w: 4, d: 26, floor: 0x606068, tex: "concrete" },
      { id: "alley", name: "Rear Alley", x: 0, z: -22, w: 64, d: 8, floor: 0x3d4048, tex: "concrete", breakers: { count: 3, w: 2.2, d: 2.2, h: 2.7, colors: [0x8a8a90, 0xb5622a] }, scatter: { palette: PAL.alley, count: 17, dressing: { palette: DRESS.yard, max: 3 }, margin: 2 } },
    ],
    spawn: { seeker: { x: 0, z: 23 }, hider: { x: 0, z: 7 } },
  }),

  street: buildCampus({
    id: "street", name: "The Backlot",
    blurb: "A city back-street block — a grocer, a cafe and a hardware store you can walk into, an asphalt spine, a loading yard of containers and a dead-end service alley.",
    seed: 0xbacc10,
    bounds: { minX: -32, maxX: 32, minZ: -26, maxZ: 26 }, wallHeight: 5,
    ground: { color: 0x4a4a50, roughness: 0.95, tex: "concrete" },
    ambient: { sky: 0xc0987a, ground: 0x3a3844, intensity: 1.34 },
    perimeter: { color: 0x7a4636, roughness: 0.9, thickness: 0.5, tex: "brick" },
    autoLight: { spacing: 13, intensity: 15, dist: 16, color: 0xffe4be },
    buildings: [
      {
        id: "G", name: "Grocer", x: -20, z: -16, w: 12, d: 16, floor: 0x8f897a,
        doors: [{ side: "E", at: 0, width: 3.2 }, { side: "W", at: 0, width: 2.6 }],
        rooms: [{ id: "grocer", name: "Grocer", x: -20, z: -16, w: 12, d: 16, floor: 0x8a6038, tex: "wood", breakers: { count: 2, w: 1.2, d: 2.0, h: 2.4, colors: [0xc23b3b, 0x8f897a] }, scatter: { palette: PAL.grocer, count: 14, dressing: { palette: DRESS.retail, max: 3 } } }],
      },
      {
        id: "C", name: "Cafe", x: -20, z: 0, w: 12, d: 14, floor: 0x9c8f79,
        doors: [{ side: "E", at: 0, width: 3.2 }, { side: "W", at: 0, width: 2.6 }],
        rooms: [{ id: "cafe", name: "Cafe", x: -20, z: 0, w: 12, d: 14, floor: 0x8f887c, tex: "checker", breakers: { count: 2, w: 1.2, d: 2.0, h: 2.4, colors: [0x9c8f79, 0x7a4a5a] }, scatter: { palette: PAL.cafe, count: 13, dressing: { palette: DRESS.retail, max: 3 } } }],
      },
      {
        id: "H", name: "Hardware", x: -20, z: 16, w: 12, d: 14, floor: 0x6f6a62,
        doors: [{ side: "E", at: 0, width: 3.2 }, { side: "W", at: 0, width: 2.6 }],
        rooms: [{ id: "hardware", name: "Hardware", x: -20, z: 16, w: 12, d: 14, floor: 0x6f6a62, tex: "concrete", breakers: { count: 2, w: 1.2, d: 2.4, h: 2.6, colors: [0x8a9099, 0x3d5a7a] }, scatter: { palette: PAL.hardware, count: 14, dressing: { palette: DRESS.retail, max: 3 } } }],
      },
    ],
    zones: [
      { id: "alley", name: "Service Alley", x: -29, z: 0, w: 6, d: 52, floor: 0x3a3844 },
      { id: "mainst", name: "Main Street", x: -3, z: 0, w: 22, d: 52, floor: 0x50505a, tex: "concrete", breakers: { count: 4, w: 2.0, d: 2.0, h: 2.8, colors: [0x7a4636, 0xc23b3b, 0x5f9a3a] }, scatter: { palette: PAL.street, count: 24, dressing: { palette: DRESS.yard, max: 3 }, margin: 2.4 } },
      { id: "yard", name: "Loading Yard", x: 20, z: 0, w: 24, d: 52, floor: 0x5a5a62, tex: "concrete", breakers: { count: 4, w: 2.4, d: 2.4, h: 2.8, colors: [0xb5622a, 0x2f6a8a, 0x6b7a52] }, scatter: { palette: PAL.yard, count: 29, dressing: { palette: DRESS.yard, max: 3 }, margin: 2.6 } },
    ],
    spawn: { seeker: { x: 20, z: 21 }, hider: { x: -3, z: 0 } },
  }),

  supermarket: buildCampus({
    id: "supermarket", name: "Nightshift Mart",
    blurb: "A midnight grocery — shelf aisles, a produce and deli hall and a stockroom under one big roof, with a parking apron, a loading yard and a garden centre outside.",
    seed: 0x5ca7ed,
    bounds: { minX: -32, maxX: 32, minZ: -26, maxZ: 26 }, wallHeight: 5,
    ground: { color: 0x4a4e52, roughness: 0.95, tex: "concrete" },
    ambient: { sky: 0xf0f5ff, ground: 0x7a8088, intensity: 1.32 },
    perimeter: { color: 0xbfc4c9, roughness: 0.9, thickness: 0.5, tex: "plaster" },
    autoLight: { spacing: 13, intensity: 16, dist: 17, color: 0xf2f7ff },
    buildings: [
      {
        id: "S", name: "The Store", x: -10, z: -4, w: 42, d: 28, floor: 0x8a8375,
        doors: [{ side: "S", at: 0, width: 3.6 }, { side: "E", at: -11, width: 3.2 }],
        dividers: [
          { x: -10, z: 4, w: 42, d: 0.4, doorWidth: 3.6, doorAts: [-14, 0, 13] },
          { x: -10, z: -12, w: 42, d: 0.4, doorWidth: 3.6, doorAts: [-14, 0, 13] },
        ],
        rooms: [
          { id: "vestibule", name: "Vestibule", x: -10, z: 7, w: 42, d: 6, floor: 0x9aa0a6, tex: "checker", breakers: { count: 3, w: 1.2, d: 2.0, h: 2.4, colors: [0x8a8375, 0x2fa36b] }, scatter: { palette: PAL.produce, count: 9, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "aisles", name: "Aisles", x: -21, z: -4, w: 20, d: 16, floor: 0xa8aeb4, tex: "checker", breakers: { count: 2, w: 1.2, d: 2.6, h: 2.6, colors: [0xb8523a, 0x3a6ea5] }, scatter: { palette: PAL.aisles, count: 13, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "produce", name: "Produce & Deli", x: 1, z: -4, w: 20, d: 16, floor: 0x8fa07a, tex: "checker", breakers: { count: 2, w: 1.2, d: 2.4, h: 2.5, colors: [0xc96b3a, 0x5f9a3a] }, scatter: { palette: PAL.produce, count: 14, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "stockroom", name: "Stockroom", x: -10, z: -15, w: 42, d: 6, floor: 0x55575a, tex: "concrete", breakers: { count: 3, w: 1.4, d: 2.2, h: 2.6, colors: [0x55575a, 0x7a828a] }, scatter: { palette: PAL.stock, count: 12, dressing: { palette: DRESS.retail, max: 3 } } },
        ],
      },
    ],
    zones: [
      { id: "parking", name: "Parking", x: -11, z: 18, w: 42, d: 16, floor: 0x55555a, tex: "concrete", breakers: { count: 4, w: 1.6, d: 1.6, h: 2.8, colors: [0xbfc4c9, 0x55555a] }, scatter: { palette: PAL.lot, count: 24, dressing: { palette: DRESS.yard, max: 3 }, margin: 2.6 } },
      { id: "dock", name: "Loading Yard", x: 21, z: 4, w: 21, d: 44, floor: 0x5a5a62, tex: "concrete", breakers: { count: 4, w: 2.4, d: 2.4, h: 2.8, colors: [0x6b7a52, 0xb5622a] }, scatter: { palette: PAL.yard, count: 21, dressing: { palette: DRESS.yard, max: 3 }, margin: 2.6 } },
      { id: "gardenctr", name: "Garden Centre", x: 21, z: -22, w: 21, d: 8, floor: 0x3f5a3a, tex: "carpet", scatter: { palette: PAL.garden, count: 9, dressing: { palette: DRESS.retail, max: 3 }, margin: 2 } },
    ],
    spawn: { seeker: { x: -11, z: 23 }, hider: { x: -10, z: 7 } },
  }),
};
