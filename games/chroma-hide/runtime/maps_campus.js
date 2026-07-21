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
    { model: "suburb/tree-small.glb", w: 0.9, d: 0.9, h: 1.8, colors: [0x2f7d3a, 0x3f6e46, 0x4a7c3f], rough: 0.9, metal: 0 },
    { w: 1.6, d: 1.0, h: 0.45, colors: [0x7d8899, 0xa8845c], rough: 0.5, metal: 0.1 },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0xc9b98a, 0x566173], rough: 0.45, metal: 0.4 },
    { w: 0.7, d: 0.5, h: 0.6, colors: [0xb5623f, 0xe07b39], rough: 0.6, metal: 0.1 },
    { model: "loungeSofaLong.glb", w: 1.92, d: 1.60, h: 0.90, colors: [0x35406b, 0x3f6a6a, 0x7a4a5a, 0x4a5058], rough: 0.85, metal: 0, rots: [0, 1.57, 3.14, -1.57] },
    { model: "tableCoffee.glb", w: 1.29, d: 0.78, h: 0.45, colors: [0xa8845c, 0x5c4a36, 0x2a2c30], rough: 0.5, metal: 0.05, rots: [0, 1.57] },
    { model: "pottedPlant.glb", w: 0.44, d: 0.50, h: 1.35, colors: [0x2f7d3a, 0x3f6e46, 0x4a7c3f], rough: 0.9, metal: 0 },
    { model: "bookcaseClosedWide.glb", w: 1.92, d: 0.60, h: 1.90, colors: [0x5a3f2a, 0x8a9099], rough: 0.55, metal: 0.2, rots: [0, 1.57] },
  ],
  bullpen: [
    { model: "desk.glb", w: 1.6, d: 0.8, h: 0.75, colors: [0x6b7688, 0x5f6a78], rough: 0.6, metal: 0.1, rots: [0, 3.14] },
    { w: 0.6, d: 0.6, h: 1.05, colors: [0xe07b39, 0xc0453a, 0x2f9e8f, 0x3b6fb0], rough: 0.6, metal: 0.1 },
    { w: 0.5, d: 0.4, h: 0.5, colors: [0x14161a, 0x24262b], rough: 0.3, metal: 0.3 },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0xc9b98a, 0x5a6473], rough: 0.45, metal: 0.5 },
    { w: 0.22, d: 2.0, h: 1.95, colors: [0x7d8899, 0x8a94a6], rough: 0.8, metal: 0, rots: [0, 1.57] },
    { model: "chairDesk.glb", w: 0.63, d: 0.59, h: 1.15, colors: [0x2a2c30, 0x3b6fb0, 0xc0453a, 0x4a5058], rough: 0.55, metal: 0.25, rots: [0, 1.57, 3.14, -1.57] },
    { model: "deskCorner.glb", w: 1.90, d: 1.90, h: 0.75, colors: [0x6b7688, 0x8a7048, 0x5f6a78], rough: 0.6, metal: 0.1, rots: [0, 1.57, 3.14, -1.57] },
    { model: "bookcaseClosedDoors.glb", w: 0.94, d: 0.59, h: 2.00, colors: [0x8a9099, 0x5a6473, 0x7a828a], rough: 0.5, metal: 0.35, rots: [0, 1.57] },
  ],
  offices: [
    { model: "desk.glb", w: 1.6, d: 0.8, h: 0.75, colors: [0x6b4a30, 0x5c4a36], rough: 0.6, metal: 0.05, rots: [0, 1.57, 3.14] },
    { w: 0.6, d: 0.6, h: 1.05, colors: [0x2f9e8f, 0xc0453a, 0x3b6fb0], rough: 0.6, metal: 0.1 },
    { model: "bookcaseClosed.glb", w: 0.8, d: 2.0, h: 2.4, colors: [0x5a3f2a, 0x8a9099], rough: 0.6, metal: 0.2, rots: [0, 1.57] },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0xc9b98a, 0x566173], rough: 0.45, metal: 0.5 },
    { model: "bookcaseOpen.glb", w: 0.95, d: 0.60, h: 2.10, colors: [0x5a3f2a, 0x8a9099, 0xa8845c], rough: 0.6, metal: 0.15, rots: [0, 1.57] },
    { model: "coatRackStanding.glb", w: 0.62, d: 0.62, h: 1.75, colors: [0x5c4a36, 0x2a2c30], rough: 0.7, metal: 0.2 },
    { model: "sideTableDrawers.glb", w: 0.97, d: 0.40, h: 0.70, colors: [0xc9b98a, 0x6b4a30], rough: 0.55, metal: 0.1, rots: [0, 1.57] },
  ],
  brk: [
    { model: "table.glb", w: 1.8, d: 1.0, h: 0.75, colors: [0xa8845c, 0x5c4a36], rough: 0.5, metal: 0.1 },
    { w: 0.6, d: 0.6, h: 1.05, colors: [0xe07b39, 0x2f9e8f, 0xc0453a], rough: 0.6, metal: 0.1 },
    { model: "ac-unit-quaternius.glb", w: 1.0, d: 1.0, h: 2.0, colors: [0xd8dce0, 0xc8ccd2], rough: 0.4, metal: 0.5 },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0x566173, 0xc9b98a], rough: 0.45, metal: 0.4 },
    { w: 0.5, d: 0.5, h: 1.35, colors: [0x3f8fc0, 0x8fd0e0], rough: 0.4, metal: 0.2 },
    { model: "kitchenFridgeLarge.glb", w: 1.10, d: 0.86, h: 1.95, colors: [0xd8dce0, 0xc8ccd2, 0x8a9099], rough: 0.35, metal: 0.6, rots: [0, 3.14] },
    { model: "kitchenSink.glb", w: 0.83, d: 0.87, h: 0.95, colors: [0xe8e4dc, 0x566173], rough: 0.4, metal: 0.35, rots: [0, 1.57, 3.14] },
    { model: "kitchenStove.glb", w: 0.91, d: 0.95, h: 0.95, colors: [0x2a2c30, 0xd8dce0], rough: 0.35, metal: 0.55, rots: [0, 3.14] },
    { model: "tableRound.glb", w: 1.42, d: 1.63, h: 0.75, colors: [0xa8845c, 0xe8e4dc, 0x5c4a36], rough: 0.5, metal: 0.1 },
    { model: "stoolBar.glb", w: 0.52, d: 0.45, h: 0.85, colors: [0xc0453a, 0x2f9e8f, 0x2a2c30], rough: 0.6, metal: 0.2 },
  ],
  lot: [
    { model: "car/sedan.glb", w: 3.2, d: 1.5, h: 1.3, colors: [0x2f5db0, 0x883333, 0x333a44, 0x2a6a4a], rough: 0.35, metal: 0.5, rots: [1.57] },
    { model: "barrier-traffic-quaternius.glb", w: 1.8, d: 0.5, h: 1.0, colors: [0xd0a020, 0xd06020], rough: 0.7, metal: 0.1, rots: [0, 1.57] },
    { model: "dumpster-quaternius.glb", w: 1.2, d: 1.2, h: 1.75, colors: [0x2f6a3a, 0x3a5a8a], rough: 0.6, metal: 0.5 },
    { model: "hydrant-quaternius.glb", w: 0.5, d: 0.5, h: 0.9, colors: [0xc23020], rough: 0.5, metal: 0.3 },
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xb79a68, 0xc8a066], rough: 0.85, metal: 0 },
    { model: "roads/light-square.glb", w: 0.35, d: 0.35, h: 4.00, colors: [0x55555a, 0x7a7a80], rough: 0.6, metal: 0.55 },
    { model: "roads/construction-cone.glb", w: 0.42, d: 0.42, h: 0.70, colors: [0xd06020, 0xe07b39], rough: 0.7, metal: 0.05 },
  ],
  breez: [
    { model: "suburb/tree-small.glb", w: 0.9, d: 0.9, h: 1.8, colors: [0x2f7d3a, 0x3f8d4a], rough: 0.9, metal: 0 },
    { model: "loungeSofa.glb", w: 2.4, d: 1.0, h: 0.9, colors: [0x3f6a6a, 0x35406b], rough: 0.85, metal: 0, rots: [1.57] },
  ],
  alley: [
    { model: "ac-unit-quaternius.glb", w: 1.0, d: 1.0, h: 2.0, colors: [0x8a8a90, 0x7a7a80], rough: 0.5, metal: 0.6 },
    { model: "shipping-container-quaternius.glb", w: 6, d: 2.4, h: 2.6, colors: [0xb5622a, 0x2f6a8a], rough: 0.6, metal: 0.4, rots: [0] },
    { model: "dumpster-quaternius.glb", w: 1.2, d: 1.2, h: 1.75, colors: [0x3a6a3a, 0x5a5a3a], rough: 0.6, metal: 0.5 },
    { model: "roads/construction-light.glb", w: 0.42, d: 0.42, h: 1.60, colors: [0xd0a020, 0x55555a], rough: 0.6, metal: 0.45 },
    { model: "roads/construction-barrier.glb", w: 0.88, d: 1.90, h: 1.00, colors: [0xd0a020, 0xc0453a], rough: 0.7, metal: 0.2, rots: [0, 1.57] },
  ],
  // street block
  grocer: [
    { model: "market-stalls-quaternius.glb", w: 2.5, d: 1.5, h: 2.2, colors: [0xc23b3b, 0x5f9a3a, 0xc96b3a], rough: 0.75, metal: 0.05, rots: [0, 1.57] },
    { w: 1.4, d: 1.1, h: 0.7, colors: [0xd83a3a, 0xe0951f, 0x7a3aa0, 0x3f9f57], rough: 0.6, metal: 0 },
    { model: "table.glb", w: 1.8, d: 1.0, h: 0.75, colors: [0x7a4a2a, 0x8a5a3a], rough: 0.7, metal: 0 },
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xc8a066, 0xbf9a55], rough: 0.9, metal: 0 },
    { model: "crate-quaternius.glb", w: 1.00, d: 1.00, h: 1.00, colors: [0xb79a68, 0x8a5a2a], rough: 0.85, metal: 0 },
    { model: "bookcaseOpenLow.glb", w: 1.10, d: 0.69, h: 1.10, colors: [0xe0b83a, 0x2fa36b, 0xc23b3b], rough: 0.6, metal: 0.25, rots: [0, 1.57] },
  ],
  cafe: [
    { model: "table.glb", w: 1.8, d: 1.0, h: 0.75, colors: [0x6b4a30, 0xa8845c], rough: 0.55, metal: 0.05 },
    { model: "loungeSofa.glb", w: 2.4, d: 1.0, h: 0.9, colors: [0x7a4a5a, 0x3f6a6a, 0x8a5a3a], rough: 0.85, metal: 0, rots: [0, 1.57] },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0xe8e4dc, 0x566173], rough: 0.45, metal: 0.3 },
    { w: 0.6, d: 0.6, h: 1.0, colors: [0x2a2c30, 0xc0453a], rough: 0.6, metal: 0.1 },
    { model: "washerDryerStacked.glb", w: 0.79, d: 0.79, h: 1.90, colors: [0xd8dce0, 0x8a94a6, 0xb8523a], rough: 0.4, metal: 0.5, rots: [0, 3.14] },
    { model: "kitchenFridge.glb", w: 0.86, d: 0.59, h: 1.85, colors: [0xd8dce0, 0x566173], rough: 0.35, metal: 0.6, rots: [0, 3.14] },
    { model: "chairCushion.glb", w: 0.39, d: 0.39, h: 0.90, colors: [0xc0453a, 0x3f6a6a, 0xa8845c], rough: 0.7, metal: 0.05, rots: [0, 1.57, 3.14, -1.57] },
    { model: "tableRound.glb", w: 1.42, d: 1.63, h: 0.75, colors: [0xa8845c, 0x6b4a30], rough: 0.5, metal: 0.1 },
  ],
  hardware: [
    { model: "bookcaseClosed.glb", w: 0.8, d: 3.0, h: 2.6, colors: [0x8a9099, 0x5a3f2a, 0x3d5a7a], rough: 0.55, metal: 0.4, rots: [0, 1.57] },
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xb79a68, 0xc9a24a], rough: 0.9, metal: 0 },
    { w: 1.2, d: 0.8, h: 1.9, colors: [0xc23020, 0xd0a020], rough: 0.5, metal: 0.3 },
    { model: "table.glb", w: 1.8, d: 1.0, h: 0.75, colors: [0x6a5030], rough: 0.8, metal: 0.1 },
    { model: "bookcaseOpen.glb", w: 0.95, d: 0.60, h: 2.10, colors: [0x8a9099, 0x3d5a7a, 0xc9a24a], rough: 0.55, metal: 0.4, rots: [0, 1.57] },
    { model: "crate-quaternius.glb", w: 1.00, d: 1.00, h: 1.00, colors: [0xb79a68, 0x8a5a2a, 0xc9a24a], rough: 0.85, metal: 0 },
    { model: "cardboardBoxOpen.glb", w: 0.93, d: 0.53, h: 0.70, colors: [0xb79a68, 0xc8a066], rough: 0.9, metal: 0, rots: [0, 1.57] },
  ],
  street: [
    { model: "car/sedan.glb", w: 3.2, d: 1.5, h: 1.3, colors: [0x2f5db0, 0x883333, 0x333a44], rough: 0.35, metal: 0.5, rots: [0, 1.57] },
    { model: "hydrant-quaternius.glb", w: 0.5, d: 0.5, h: 0.9, colors: [0xc0342a], rough: 0.5, metal: 0.3 },
    { model: "suburb/tree-small.glb", w: 0.9, d: 0.9, h: 1.8, colors: [0x4f8a3f, 0x6a9a3a], rough: 0.9, metal: 0 },
    { model: "barrier-traffic-quaternius.glb", w: 1.8, d: 0.5, h: 1.0, colors: [0xd0a020, 0xd06020], rough: 0.7, metal: 0.1, rots: [0, 1.57] },
    { model: "suburb/planter.glb", w: 1.24, d: 0.93, h: 0.55, colors: [0x8a6a44, 0x6a8a4a, 0x9aa0a6], rough: 0.8, metal: 0.05, rots: [0, 1.57] },
    { model: "commercial/detail-parasol-a.glb", w: 1.85, d: 1.90, h: 2.40, colors: [0xc23b3b, 0x5f9a3a, 0xe0951f], rough: 0.8, metal: 0 },
    { model: "roads/bridge-pillar.glb", w: 0.52, d: 0.52, h: 2.60, colors: [0x8a8a90, 0x6a6a70], rough: 0.9, metal: 0.05 },
    { model: "roads/light-curved.glb", w: 0.35, d: 0.35, h: 4.20, colors: [0x55555a, 0x3d4048], rough: 0.6, metal: 0.55 },
  ],
  yard: [
    { model: "shipping-container-quaternius.glb", w: 6, d: 2.4, h: 2.6, colors: [0xb5622a, 0x2f6a8a, 0x6b7a52], rough: 0.6, metal: 0.45, rots: [0, 1.57] },
    { model: "barrier-traffic-quaternius.glb", w: 1.8, d: 0.5, h: 1.0, colors: [0xd0a020], rough: 0.7, metal: 0.1, rots: [0, 1.57] },
    { model: "dumpster-quaternius.glb", w: 1.2, d: 1.2, h: 1.75, colors: [0x2f6a3a, 0x5a5a3a], rough: 0.6, metal: 0.5 },
    { w: 1.4, d: 1.0, h: 0.35, colors: [0x8a5a2a], rough: 0.9, metal: 0 },
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xc0a060, 0xb07a3a], rough: 0.9, metal: 0 },
    { model: "crate-quaternius.glb", w: 1.00, d: 1.00, h: 1.00, colors: [0xb79a68, 0x8a5a2a], rough: 0.85, metal: 0 },
    { model: "roads/construction-barrier.glb", w: 0.88, d: 1.90, h: 1.00, colors: [0xd0a020, 0xc0453a], rough: 0.7, metal: 0.2, rots: [0, 1.57] },
    { model: "roads/construction-cone.glb", w: 0.36, d: 0.36, h: 0.45, colors: [0xd06020, 0xe07b39], rough: 0.7, metal: 0.05 },
  ],
  // supermarket
  aisles: [
    { model: "bookcaseClosed.glb", w: 0.8, d: 3.0, h: 2.6, colors: [0xb8523a, 0x3a6ea5, 0xe0b83a, 0x2fa36b], rough: 0.6, metal: 0.3, rots: [1.57] },
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xe0b83a, 0xd94f8a, 0x2fa36b, 0x3a6ea5], rough: 0.9, metal: 0 },
    { model: "bookcaseOpen.glb", w: 0.95, d: 0.60, h: 2.10, colors: [0x3a6ea5, 0xb8523a, 0x8a9099], rough: 0.6, metal: 0.3, rots: [1.57] },
    { model: "bookcaseOpenLow.glb", w: 1.10, d: 0.69, h: 1.10, colors: [0xe0b83a, 0xd94f8a, 0x2fa36b], rough: 0.6, metal: 0.25, rots: [0, 1.57] },
  ],
  produce: [
    { model: "market-stalls-quaternius.glb", w: 2.5, d: 1.5, h: 2.2, colors: [0xc96b3a, 0x5f9a3a], rough: 0.75, metal: 0.05, rots: [0, 1.57] },
    { w: 1.4, d: 1.2, h: 0.7, colors: [0xd83a3a, 0xe0951f, 0x7a3aa0, 0x3f9f57], rough: 0.6, metal: 0 },
    { model: "ac-unit-quaternius.glb", w: 1.0, d: 1.0, h: 2.0, colors: [0xbcd4e0, 0xa7c4d4], rough: 0.35, metal: 0.5 },
    { w: 1.6, d: 1.0, h: 1.1, colors: [0xcfd6da, 0x46525a], rough: 0.3, metal: 0.2 },
    { model: "kitchenFridgeLarge.glb", w: 1.10, d: 0.86, h: 1.95, colors: [0xbcd4e0, 0xa7c4d4, 0xd8dce0], rough: 0.3, metal: 0.6, rots: [0, 3.14] },
    { model: "crate-quaternius.glb", w: 1.00, d: 1.00, h: 1.00, colors: [0xe0951f, 0x5f9a3a, 0xa8845c], rough: 0.8, metal: 0 },
  ],
  stock: [
    { model: "cardboardBoxClosed.glb", w: 1.3, d: 1.3, h: 1.3, colors: [0xb07a3a, 0xc9a24a, 0x7a5228], rough: 0.9, metal: 0 },
    { model: "bookcaseClosed.glb", w: 0.8, d: 3.0, h: 2.6, colors: [0x3d5a7a, 0x7a828a], rough: 0.5, metal: 0.5, rots: [1.57] },
    { model: "kitchenCabinet.glb", w: 0.9, d: 0.9, h: 1.9, colors: [0x7a828a, 0x8a6a44], rough: 0.5, metal: 0.4 },
    { model: "cardboardBoxOpen.glb", w: 0.93, d: 0.53, h: 0.70, colors: [0xb07a3a, 0xc9a24a, 0x7a5228], rough: 0.9, metal: 0, rots: [0, 1.57] },
    { model: "bookcaseOpen.glb", w: 0.95, d: 0.60, h: 2.10, colors: [0x7a828a, 0x3d5a7a], rough: 0.5, metal: 0.5, rots: [1.57] },
  ],
  garden: [
    { model: "suburb/tree-small.glb", w: 0.9, d: 0.9, h: 1.8, colors: [0x3b7a3b, 0x4f8a3f, 0x2f7d3a], rough: 0.9, metal: 0 },
    { model: "market-stalls-quaternius.glb", w: 2.5, d: 1.5, h: 2.2, colors: [0x5f9a3a], rough: 0.8, metal: 0, rots: [0, 1.57] },
    { w: 1.2, d: 1.2, h: 0.6, colors: [0x6a8a4a, 0x8a6a44], rough: 0.85, metal: 0 },
    { model: "suburb/tree-large.glb", w: 0.66, d: 0.76, h: 2.40, colors: [0x3b7a3b, 0x4f8a3f, 0x2f7d3a], rough: 0.9, metal: 0 },
    { model: "suburb/planter.glb", w: 1.24, d: 0.93, h: 0.55, colors: [0x6a8a4a, 0x8a6a44], rough: 0.85, metal: 0, rots: [0, 1.57] },
    { model: "pottedPlant.glb", w: 0.44, d: 0.50, h: 1.35, colors: [0x2f7d3a, 0x4a7c3f], rough: 0.9, metal: 0 },
  ],
};

// Visual-only DRESSING (noCollide): small clutter riding on furniture. Never nav/LOS
// obstacles, so detail is unbounded — this is where the prop-count budget actually goes.
const DRESS = {
  office: [
    { w: 0.36, d: 0.28, h: 0.32, colors: [0x14161a, 0xc0453a, 0x2f9e8f, 0xe07b39], rough: 0.5, metal: 0.2 },
    { w: 0.22, d: 0.22, h: 0.26, colors: [0xd8dce0, 0x8a94a6, 0x3f8fc0], rough: 0.6, metal: 0.1 },
    { w: 0.5, d: 0.34, h: 0.12, colors: [0xeef0f2, 0xc9b98a], rough: 0.7, metal: 0 },
    { model: "computerScreen.glb", w: 0.67, d: 0.18, h: 0.50, colors: [0x14161a, 0x24262b], rough: 0.3, metal: 0.3, rots: [0, 3.14] },
    { model: "trashcan.glb", w: 0.32, d: 0.36, h: 0.65, colors: [0x2a2c30, 0x3b6fb0, 0x8a9099], rough: 0.6, metal: 0.25 },
    { model: "plantSmall1.glb", w: 0.14, d: 0.14, h: 0.20, colors: [0x2f7d3a, 0x4a7c3f], rough: 0.9, metal: 0 },
  ],
  retail: [
    { w: 0.32, d: 0.3, h: 0.34, colors: [0xe0b83a, 0xd94f8a, 0x2fa36b, 0x3a6ea5, 0xd83a3a], rough: 0.8, metal: 0 },
    { w: 0.24, d: 0.24, h: 0.26, colors: [0xe0951f, 0x7a3aa0, 0x3f9f57, 0xc23b3b], rough: 0.6, metal: 0 },
    { w: 0.45, d: 0.3, h: 0.16, colors: [0xc8a066, 0xb07a3a], rough: 0.85, metal: 0 },
    { model: "books.glb", w: 0.29, d: 0.18, h: 0.20, colors: [0xc0453a, 0x3b6fb0, 0x2f9e8f], rough: 0.8, metal: 0 },
  ],
  yard: [
    { w: 0.42, d: 0.42, h: 0.45, colors: [0xb07a3a, 0x8a5a2a, 0x5a5a3a], rough: 0.9, metal: 0 },
    { w: 0.3, d: 0.3, h: 0.5, colors: [0xc0342a, 0xd0a020, 0x2f6a3a], rough: 0.6, metal: 0.3 },
    { w: 0.5, d: 0.36, h: 0.2, colors: [0x55555a, 0x7a7a80], rough: 0.8, metal: 0.2 },
  ],
};


// Wall decor (noCollide, hung at height). Bare walls were the loudest visual gap —
// and a framed picture is exactly the kind of flat surface this game asks you to
// impersonate.  `w` = width along the wall, `thick` = how far it stands proud.
const DECOR = {
  office: [
    { w: 1.10, h: 0.72, thick: 0.10, colors: [0x2a2c30, 0x14161a], rough: 0.35, metal: 0.25 },   // wall screen / TV
    { w: 0.82, h: 0.58, thick: 0.08, colors: [0x8a6038, 0xc9b98a, 0x5c4a36], rough: 0.7 },       // framed picture
    { w: 0.46, h: 0.46, thick: 0.09, colors: [0xe8e4dc, 0x8a94a6], rough: 0.5 },                 // wall clock
    { w: 1.70, h: 1.05, thick: 0.09, colors: [0xeef0f2, 0xdfe6ef], rough: 0.4 },                 // whiteboard
  ],
  retail: [
    { w: 1.30, h: 0.50, thick: 0.09, colors: [0xc23b3b, 0x2fa36b, 0x3a6ea5, 0xe0b83a], rough: 0.6 }, // aisle sign
    { w: 0.70, h: 0.52, thick: 0.08, colors: [0x8a6038, 0xb07a3a], rough: 0.7 },                      // framed print
    { w: 0.44, h: 0.24, thick: 0.07, colors: [0x2fa36b, 0xd83a3a], rough: 0.45, metal: 0.2 },         // EXIT sign
  ],
  street: [
    { w: 1.05, h: 0.62, thick: 0.10, colors: [0xc23b3b, 0xd0a020, 0x3a6ea5], rough: 0.65 },      // shop sign
    { w: 0.52, h: 0.72, thick: 0.08, colors: [0x8a8a90, 0x6a6a70], rough: 0.8 },                  // meter box
    { w: 0.44, h: 0.24, thick: 0.07, colors: [0x2fa36b], rough: 0.45, metal: 0.2 },               // EXIT sign
  ],
};


// Outdoor occluders as real objects. GLBs scale by HEIGHT, so w/d below are the measured
// bounding box scaled by (target h / base h) -- measured in-browser, not guessed.
const YARD_VEHICLES = [
  { model: "car/van.glb",      w: 1.78, d: 3.26, h: 1.60, rots: [0, Math.PI, 1.5708] },
  { model: "car/sedan.glb",    w: 1.73, d: 2.94, h: 1.50, rots: [0, Math.PI, 1.5708] },
  { model: "car/truck.glb",    w: 1.85, d: 3.63, h: 1.60, rots: [0, Math.PI] },
  { model: "car/delivery.glb", w: 2.00, d: 4.33, h: 2.20, rots: [0, Math.PI] },
];
const YARD_BARRIERS = [
  { model: "barrier-large-quaternius.glb", w: 3.36, d: 0.59, h: 2.80, rots: [0, 1.5708] },
  { model: "ac-unit-quaternius.glb",       w: 1.51, d: 1.12, h: 1.00 },
];
const GARDEN_GREEN = [
  { model: "suburb/tree-large.glb", w: 0.87, d: 1.00, h: 3.20 },
  { model: "suburb/tree-small.glb", w: 0.94, d: 1.08, h: 2.55 },
];

export const CAMPUS_MAPS = {
  office: buildCampus({
    id: "office", name: "The Firm",
    blurb: "A corporate campus — two multi-room office buildings around a parking lot, a wide breezeway and a rear service alley. Ten rooms of cover, each with its own palette.",
    seed: 0x0ff1ce,
    bounds: { minX: -38, maxX: 38, minZ: -32, maxZ: 32 }, wallHeight: 5,
    ground: { color: 0x3f4348, roughness: 0.95, tex: "concrete" },
    ambient: { sky: 0xc6d2e0, ground: 0x40454c, intensity: 1.35 },
    perimeter: { color: 0x8a94a6, roughness: 0.9, thickness: 0.5, tex: "plaster" },
    autoLight: { spacing: 12, intensity: 15, dist: 16, color: 0xfff2e0 },
    buildings: [
      {
        id: "A", name: "Main Office", x: -20, z: -8, w: 32, d: 30, floor: 0x6a7280,
        doors: [{ side: "S", at: -8, width: 3.4 }, { side: "S", at: 8, width: 3.4 }, { side: "N", at: 0, width: 3.0 }],
        dividers: [
          { x: -20, z: -8, w: 0.4, d: 30, doorWidth: 3.2, doorAts: [-10, 10] },
          { x: -20, z: -3, w: 32, d: 0.4, doorWidth: 3.2, doorAts: [-8, 8] },
          { x: -20, z: -13, w: 32, d: 0.4, doorWidth: 3.2, doorAts: [-8, 8] },
        ],
        rooms: [
          { id: "reception", wallTex: "wallpaper", wallColor: 0xb9c6d6, wallTrim: 0x2f3a46, name: "Reception", x: -28, z: 2, w: 16, d: 10, floor: 0x8a5a34, tex: "wood", decor: { count: 6, palette: DECOR.office }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0x8791a1, 0x5a6473] }, scatter: { palette: PAL.recep, count: 16, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "lounge", wallTex: "wallpaper", wallColor: 0xc8b49a, wallTrim: 0x4a3a2c, name: "Lounge", x: -12, z: 2, w: 16, d: 10, floor: 0x7a5230, tex: "wood", decor: { count: 6, palette: DECOR.office }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.09, d: 0.69, h: 2.4, colors: [0x9c8f79, 0x566173] }, scatter: { palette: PAL.recep, count: 15, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "bullpenW", wallTex: "plaster", wallColor: 0xd7dbe0, wallTrim: 0x36404a, name: "Bullpen West", x: -28, z: -8, w: 16, d: 10, floor: 0x5b6470, tex: "carpet", decor: { count: 6, palette: DECOR.office }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.09, d: 0.69, h: 2.4, colors: [0x7d8899, 0x5f6a78] }, scatter: { palette: PAL.bullpen, count: 18, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "bullpenE", wallTex: "plaster", wallColor: 0xcfd8dd, wallTrim: 0x36404a, name: "Bullpen East", x: -12, z: -8, w: 16, d: 10, floor: 0x59626e, tex: "carpet", decor: { count: 6, palette: DECOR.office }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.09, d: 0.69, h: 2.4, colors: [0x8a94a6, 0x5f6a78] }, scatter: { palette: PAL.bullpen, count: 18, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "officeW", wallTex: "panel", wallColor: 0x8a6038, wallTrim: 0x5c4028, name: "Offices West", x: -28, z: -18, w: 16, d: 10, floor: 0x6a7280, tex: "carpet", decor: { count: 6, palette: DECOR.office }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0x5a3f2a, 0x8a9099] }, scatter: { palette: PAL.offices, count: 16, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "officeE", wallTex: "plaster", wallColor: 0xb4c4a8, wallTrim: 0x3d4a36, name: "Offices East", x: -12, z: -18, w: 16, d: 10, floor: 0x66707d, tex: "carpet", decor: { count: 6, palette: DECOR.office }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0x8a9099, 0x5a6473] }, scatter: { palette: PAL.offices, count: 16, dressing: { palette: DRESS.office, max: 3 } } },
        ],
      },
      {
        id: "B", name: "Annex", x: 20, z: -8, w: 28, d: 30, floor: 0x6a7280,
        doors: [{ side: "S", at: 0, width: 3.4 }, { side: "W", at: 0, width: 3.2 }, { side: "N", at: 0, width: 3.0 }],
        dividers: [
          { x: 20, z: -8, w: 0.4, d: 30, doorWidth: 3.2, doorAts: [-10, 10] },
          { x: 20, z: -8, w: 28, d: 0.4, doorWidth: 3.2, doorAts: [-7, 7] },
        ],
        rooms: [
          { id: "breakroom", wallTex: "tile", wallColor: 0xdfe7ea, wallTrim: 0x6a7278, name: "Break Room", x: 13, z: -0.5, w: 14, d: 15, floor: 0x9098a0, tex: "checker", decor: { count: 6, palette: DECOR.office }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.09, d: 0.69, h: 2.4, colors: [0x9c8f79, 0x566173] }, scatter: { palette: PAL.brk, count: 17, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "meeting", wallTex: "panel", wallColor: 0x7a5a3c, wallTrim: 0x50381f, name: "Meeting Room", x: 27, z: -0.5, w: 14, d: 15, floor: 0x7a5230, tex: "wood", decor: { count: 6, palette: DECOR.office }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.09, d: 0.69, h: 2.4, colors: [0x6a7280, 0xa8845c] }, scatter: { palette: PAL.brk, count: 15, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "copyit", wallTex: "plaster", wallColor: 0xc2c6cc, wallTrim: 0x3a3f45, name: "Copy / IT", x: 13, z: -15.5, w: 14, d: 15, floor: 0x5f6a78, tex: "carpet", decor: { count: 6, palette: DECOR.office }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.09, d: 0.69, h: 2.4, colors: [0x5f6a78, 0xc9b98a] }, scatter: { palette: PAL.offices, count: 17, dressing: { palette: DRESS.office, max: 3 } } },
          { id: "server", wallTex: "block", wallColor: 0x8f979e, wallTrim: 0x333940, name: "Server Room", x: 27, z: -15.5, w: 14, d: 15, floor: 0x4e565f, tex: "concrete", decor: { count: 6, palette: DECOR.office }, breakers: { count: 3, model: "bookcaseOpen.glb", w: 1.18, d: 0.74, h: 2.6, colors: [0x3d5a7a, 0x7a828a] }, scatter: { palette: PAL.offices, count: 15, dressing: { palette: DRESS.office, max: 3 } } },
        ],
      },
    ],
    zones: [
      { id: "lot", name: "Parking Lot", x: 0, z: 20, w: 76, d: 24, floor: 0x55555a, tex: "concrete", breakers: { pick: YARD_VEHICLES, count: 5, w: 1.6, d: 1.6, h: 2.8, colors: [0x6a7280, 0x55555a, 0x8a94a6] }, scatter: { palette: PAL.lot, count: 34, margin: 2.6, dressing: { palette: DRESS.yard, max: 3 } } },
      { id: "breezeway", name: "Breezeway", x: 1, z: -8, w: 10, d: 30, floor: 0x606068, tex: "concrete", breakers: { count: 3, w: 1.4, d: 1.4, h: 2.6, colors: [0x2f7d3a, 0x606068] }, scatter: { palette: PAL.breez, count: 10, margin: 2.2, dressing: { palette: DRESS.yard, max: 2 } } },
      { id: "alley", wallTex: "brick", wallColor: 0x6f6a63, wallTrim: 0x2e2b28, name: "Rear Alley", x: 0, z: -27.5, w: 76, d: 9, floor: 0x3d4048, tex: "concrete", decor: { count: 8, palette: DECOR.street }, breakers: { pick: YARD_BARRIERS, count: 4, w: 2.2, d: 2.2, h: 2.7, colors: [0x8a8a90, 0xb5622a] }, scatter: { palette: PAL.alley, count: 20, margin: 2.2, dressing: { palette: DRESS.yard, max: 3 } } },
    ],
    spawn: { seeker: { x: 0, z: 28 }, hider: { x: 1, z: -8 } },
    spotCount: 56,
  }),

  street: buildCampus({
    id: "street", name: "The Backlot",
    blurb: "A city back-street block - a grocer, a cafe, a hardware store and a laundromat you can walk into, an asphalt spine, a loading yard of containers and a dead-end service alley.",
    seed: 0xbacc10,
    bounds: { minX: -38, maxX: 38, minZ: -32, maxZ: 32 }, wallHeight: 5,
    ground: { color: 0x4a4a50, roughness: 0.95, tex: "concrete" },
    ambient: { sky: 0xc0987a, ground: 0x3a3844, intensity: 1.34 },
    perimeter: { color: 0x7a4636, roughness: 0.9, thickness: 0.5, tex: "brick" },
    autoLight: { spacing: 13, intensity: 15, dist: 16, color: 0xffe4be },
    buildings: [
      {
        id: "G", name: "Grocer", x: -24, z: -24, w: 16, d: 15, floor: 0x8a6038,
        doors: [{ side: "E", at: 0, width: 3.2 }, { side: "W", at: 0, width: 2.6 }],
        dividers: [{ x: -24, z: -26.5, w: 16, d: 0.4, doorWidth: 2.8, doorAts: [0] }],
        rooms: [
          { id: "grocer", wallTex: "brick", wallColor: 0x9c6350, wallTrim: 0x3d2a22, name: "Grocer", x: -24, z: -21.5, w: 16, d: 10, floor: 0x8a6038, tex: "wood", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0xc23b3b, 0x8f897a] }, scatter: { palette: PAL.grocer, count: 15, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "grocer_back", wallTex: "block", wallColor: 0x9aa0a4, wallTrim: 0x333940, name: "Grocer Store", x: -24, z: -29.0, w: 16, d: 5, floor: 0x6b5236, tex: "concrete", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0x7a828a, 0xb07a3a] }, scatter: { palette: PAL.stock, count: 9, margin: 1.6, dressing: { palette: DRESS.retail, max: 3 } } },
        ],
      },
      {
        id: "C", name: "Cafe", x: -24, z: -8, w: 16, d: 15, floor: 0x8f887c,
        doors: [{ side: "E", at: 0, width: 3.2 }, { side: "W", at: 0, width: 2.6 }],
        dividers: [{ x: -24, z: -10.5, w: 16, d: 0.4, doorWidth: 2.8, doorAts: [0] }],
        rooms: [
          { id: "cafe", wallTex: "plaster", wallColor: 0xd4c0a2, wallTrim: 0x4a3c2a, name: "Cafe", x: -24, z: -5.5, w: 16, d: 10, floor: 0x8f887c, tex: "checker", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0xc23b3b, 0x8f897a] }, scatter: { palette: PAL.cafe, count: 15, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "cafe_back", wallTex: "tile", wallColor: 0xcfd8d4, wallTrim: 0x5a6260, name: "Cafe Kitchen", x: -24, z: -13.0, w: 16, d: 5, floor: 0x6f6a62, tex: "concrete", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0x7a828a, 0xb07a3a] }, scatter: { palette: PAL.stock, count: 9, margin: 1.6, dressing: { palette: DRESS.retail, max: 3 } } },
        ],
      },
      {
        id: "H", name: "Hardware", x: -24, z: 8, w: 16, d: 15, floor: 0x6f6a62,
        doors: [{ side: "E", at: 0, width: 3.2 }, { side: "W", at: 0, width: 2.6 }],
        dividers: [{ x: -24, z: 5.5, w: 16, d: 0.4, doorWidth: 2.8, doorAts: [0] }],
        rooms: [
          { id: "hardware", wallTex: "brick", wallColor: 0x7a6a58, wallTrim: 0x322c24, name: "Hardware", x: -24, z: 10.5, w: 16, d: 10, floor: 0x6f6a62, tex: "concrete", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0xc23b3b, 0x8f897a] }, scatter: { palette: PAL.hardware, count: 15, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "hardware_back", wallTex: "block", wallColor: 0x93999e, wallTrim: 0x333940, name: "Hardware Back", x: -24, z: 3.0, w: 16, d: 5, floor: 0x5f5a54, tex: "concrete", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0x7a828a, 0xb07a3a] }, scatter: { palette: PAL.stock, count: 9, margin: 1.6, dressing: { palette: DRESS.retail, max: 3 } } },
        ],
      },
      {
        id: "L", name: "Laundromat", x: -24, z: 24, w: 16, d: 15, floor: 0x8f8a80,
        doors: [{ side: "E", at: 0, width: 3.2 }, { side: "W", at: 0, width: 2.6 }],
        dividers: [{ x: -24, z: 21.5, w: 16, d: 0.4, doorWidth: 2.8, doorAts: [0] }],
        rooms: [
          { id: "laundry", wallTex: "tile", wallColor: 0xd8e2e6, wallTrim: 0x5e6a70, name: "Laundry", x: -24, z: 26.5, w: 16, d: 10, floor: 0x8f8a80, tex: "checker", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0xc23b3b, 0x8f897a] }, scatter: { palette: PAL.cafe, count: 15, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "laundry_back", wallTex: "block", wallColor: 0x9aa0a4, wallTrim: 0x333940, name: "Laundry Back", x: -24, z: 19.0, w: 16, d: 5, floor: 0x6a655e, tex: "concrete", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0x7a828a, 0xb07a3a] }, scatter: { palette: PAL.stock, count: 9, margin: 1.6, dressing: { palette: DRESS.retail, max: 3 } } },
        ],
      },
    ],
    zones: [
      { id: "alley", name: "Service Alley", x: -35, z: 0, w: 6, d: 64, floor: 0x3a3844, tex: "concrete", breakers: { pick: YARD_BARRIERS, count: 4, w: 1.3, d: 1.3, h: 2.5, colors: [0x8a8a90, 0x3a6a3a] } },
      { id: "mainst", wallTex: "brick", wallColor: 0x8a5a4a, wallTrim: 0x3a2a24, name: "Main Street", x: -4, z: 0, w: 24, d: 64, floor: 0x50505a, tex: "concrete", decor: { count: 8, palette: DECOR.street }, breakers: { pick: YARD_VEHICLES, count: 6, w: 2.0, d: 2.0, h: 2.8, colors: [0x7a4636, 0xc23b3b, 0x5f9a3a] }, scatter: { palette: PAL.street, count: 30, margin: 2.6, dressing: { palette: DRESS.yard, max: 3 } } },
      { id: "yard", wallTex: "concrete", wallColor: 0x8b8e92, wallTrim: 0x33363a, name: "Loading Yard", x: 23, z: 0, w: 30, d: 64, floor: 0x5a5a62, tex: "concrete", decor: { count: 8, palette: DECOR.street }, breakers: { pick: [...YARD_VEHICLES, ...YARD_BARRIERS], count: 6, w: 2.4, d: 2.4, h: 2.8, colors: [0xb5622a, 0x2f6a8a, 0x6b7a52] }, scatter: { palette: PAL.yard, count: 40, margin: 2.8, dressing: { palette: DRESS.yard, max: 3 } } },
    ],
    spawn: { seeker: { x: 23, z: 27 }, hider: { x: -4, z: 0 } },
    spotCount: 56,
  }),

  supermarket: buildCampus({
    id: "supermarket", name: "Nightshift Mart",
    blurb: "A midnight grocery - shelf aisles, a produce and deli hall, a chilled section and a stockroom under one big roof, with a parking apron, a loading yard and a garden centre outside.",
    seed: 0x5ca7ed,
    bounds: { minX: -38, maxX: 38, minZ: -32, maxZ: 32 }, wallHeight: 5,
    ground: { color: 0x4a4e52, roughness: 0.95, tex: "concrete" },
    ambient: { sky: 0xf0f5ff, ground: 0x7a8088, intensity: 1.32 },
    perimeter: { color: 0xbfc4c9, roughness: 0.9, thickness: 0.5, tex: "plaster" },
    autoLight: { spacing: 13, intensity: 16, dist: 17, color: 0xf2f7ff },
    buildings: [
      {
        id: "S", name: "The Store", x: -12, z: -6, w: 44, d: 36, floor: 0x9aa0a6,
        doors: [{ side: "S", at: -10, width: 3.6 }, { side: "S", at: 10, width: 3.6 }, { side: "E", at: -12, width: 3.4 }],
        dividers: [
          { x: -12, z: -6, w: 0.4, d: 36, doorWidth: 3.4, doorAts: [-12, 0, 12] },
          { x: -12, z: 0, w: 44, d: 0.4, doorWidth: 3.4, doorAts: [-14, 0, 14] },
          { x: -12, z: -12, w: 44, d: 0.4, doorWidth: 3.4, doorAts: [-14, 0, 14] },
        ],
        rooms: [
          { id: "vestibule", wallTex: "tile", wallColor: 0xe2e8ec, wallTrim: 0x5e666c, name: "Vestibule", x: -23, z: 6, w: 22, d: 12, floor: 0x9aa0a6, tex: "checker", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.09, d: 0.69, h: 2.4, colors: [0x8a8375, 0x2fa36b] }, scatter: { palette: PAL.produce, count: 16, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "aisles", wallTex: "plaster", wallColor: 0xe6e9ec, wallTrim: 0x3f4750, name: "Aisles", x: -1, z: 6, w: 22, d: 12, floor: 0xa8aeb4, tex: "checker", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 3, model: "bookcaseOpen.glb", w: 1.18, d: 0.74, h: 2.6, colors: [0xb8523a, 0x3a6ea5] }, scatter: { palette: PAL.aisles, count: 20, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "produce", wallTex: "tile", wallColor: 0xc9e0cf, wallTrim: 0x46604f, name: "Produce & Deli", x: -23, z: -6, w: 22, d: 12, floor: 0x8fa07a, tex: "checker", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 2, model: "bookcaseOpen.glb", w: 1.13, d: 0.71, h: 2.5, colors: [0xc96b3a, 0x5f9a3a] }, scatter: { palette: PAL.produce, count: 19, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "chilled", wallTex: "tile", wallColor: 0xcfdde8, wallTrim: 0x455663, name: "Chilled", x: -1, z: -6, w: 22, d: 12, floor: 0x9fb0bc, tex: "checker", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 3, model: "bookcaseOpen.glb", w: 1.18, d: 0.74, h: 2.6, colors: [0xbcd4e0, 0x46525a] }, scatter: { palette: PAL.produce, count: 18, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "stockroom", wallTex: "block", wallColor: 0x969ca1, wallTrim: 0x333940, name: "Stockroom", x: -23, z: -18, w: 22, d: 12, floor: 0x55575a, tex: "concrete", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 3, model: "bookcaseOpen.glb", w: 1.18, d: 0.74, h: 2.6, colors: [0x55575a, 0x7a828a] }, scatter: { palette: PAL.stock, count: 19, dressing: { palette: DRESS.retail, max: 3 } } },
          { id: "backdock", wallTex: "concrete", wallColor: 0x82868b, wallTrim: 0x2f3236, name: "Back Dock", x: -1, z: -18, w: 22, d: 12, floor: 0x5d6064, tex: "concrete", decor: { count: 6, palette: DECOR.retail }, breakers: { count: 3, model: "bookcaseOpen.glb", w: 1.18, d: 0.74, h: 2.6, colors: [0x6b7a52, 0xb5622a] }, scatter: { palette: PAL.stock, count: 17, dressing: { palette: DRESS.retail, max: 3 } } },
        ],
      },
    ],
    zones: [
      { id: "parking", name: "Parking", x: -12, z: 22, w: 52, d: 20, floor: 0x55555a, tex: "concrete", breakers: { pick: YARD_VEHICLES, count: 5, w: 1.6, d: 1.6, h: 2.8, colors: [0xbfc4c9, 0x55555a] }, scatter: { palette: PAL.lot, count: 30, margin: 2.6, dressing: { palette: DRESS.yard, max: 3 } } },
      { id: "dock", name: "Loading Yard", x: 25, z: -2, w: 26, d: 60, floor: 0x5a5a62, tex: "concrete", breakers: { pick: [...YARD_VEHICLES, ...YARD_BARRIERS], count: 5, w: 2.4, d: 2.4, h: 2.8, colors: [0x6b7a52, 0xb5622a] }, scatter: { palette: PAL.yard, count: 34, margin: 2.8, dressing: { palette: DRESS.yard, max: 3 } } },
      { id: "gardenctr", name: "Garden Centre", x: -12, z: -28, w: 52, d: 8, floor: 0x3f5a3a, tex: "carpet", breakers: { pick: GARDEN_GREEN, count: 4, w: 1.4, d: 1.4, h: 2.4, colors: [0x3b7a3b, 0x5f9a3a] }, scatter: { palette: PAL.garden, count: 18, margin: 2.2, dressing: { palette: DRESS.retail, max: 3 } } },
    ],
    spawn: { seeker: { x: -12, z: 28 }, hider: { x: -12, z: 6 } },
    spotCount: 56,
  }),
};
