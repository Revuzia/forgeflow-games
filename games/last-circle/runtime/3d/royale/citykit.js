/**
 * citykit.js - the Last Circle city kit (world plan 2026-10, Wave 6, lane 6C; contract C-KIT).
 *
 * Places the CC0 town kit (assets/props/city/**, assets/props/cars/**: Kenney City Kit Suburban / Commercial / Roads, Car Kit, Furniture Kit, Graveyard Kit,
 * Quaternius props) as INSTANCED DISTRICTS with colliders that are exact axis-aligned boxes. NOT wired into the live game in Wave 6: Wave 7 (maps.js)
 * is the first importer.
 *
 *   import { createCityKit } from "./citykit.js";
 *   const kit = createCityKit({ THREE, kernel: W.kernel, assetBase: W.assetBase });          // or { W }; one kit per match
 *   const { meshes, colliders } = await kit.place(list, { parent: W.group("map"), districts: { "town:outpost": { theme: "city" } } });
 *   for (const c of colliders) map.colliders.push(c);                                         // already mkCollider-shaped, prop null, hp 0
 *   ...
 *   kit.dispose();                                                                            // from disposeMapResources: frees what a group traverse cannot
 *
 * list = [{ type, x, y, z, rot, scale?, district, palette? }, ...]
 *   type     a manifest id such as "suburban/building-type-a" (typeIds() lists the 81). Unknown types are skipped and reported in `skipped`.
 *   x y z    world metres of the footprint CENTRE at GROUND (the manifest origin). y is the pad height from lane 6A; the module never samples terrain.
 *   rot      an INTEGER is a quarter-turn index (rot * 90 degrees about +Y, as maps.js `Q.setFromAxisAngle(Y, ry)`; the authored front +Z faces +Z, +X, -Z,
 *            -X for 0, 1, 2, 3; quarterFacing(dx, dz) gives the index that faces a street); a NON-integer is radians; `ry` (radians) overrides `rot`.
 *            Only quarter turns give exact collider boxes. Any other angle still draws at that angle and its colliders become a staircase of <= 1 m
 *            strips (every point of the true box covered, nothing more than ~1 m outside it; counted in `stats().inexactEntries`).
 *   scale    uniform multiplier on the type's suggested_scale (default 1); colliders scale with it.
 *   district a string id of ONE chunk (a town, a compound, a yard) - the unit of frustum culling, so keep it POI-sized (radius <= ~150 m): a camera inside a
 *            district draws every type of it even when looking away. One InstancedMesh per (type, palette) per district, each with its own COMPUTED
 *            bounding sphere (a map-wide instance never culls, maps.js:2003-2014). A missing id is chunked on a 96 m grid.
 *   palette  optional: a theme name (THEMES) or one of "base" | "slate" | "brick" | "sand" (the manifest's recoloured colormaps). Entries of one district that
 *            ask for different palettes split into one InstancedMesh each.
 *
 * kit.place(list, opts) -> Promise<{ meshes, colliders, ranges, skipped, failed, districts, inexactEntries }>
 *   opts     { parent?, theme?: "city", districts?: { [id]: { theme?, lod? } }, lod?: "auto" | "detail" | "far", farDistance?: 250, draw?: false, autoCell?: 96 }
 *   meshes   one THREE.LOD per district (added to `opts.parent` when given). Level 0 = the detail group (the InstancedMeshes), level 1 = ONE merged box proxy
 *            of the district's buildings, shown beyond farDistance + the district's bounding radius (THREE.LOD, 4 % hysteresis; ffg_warmup already forces
 *            LODs, so the warm frame compiles both). A district with no building shows nothing far. lod "detail" never collapses; lod "far" draws ONLY the
 *            proxy and requests NO GLB at all (a cheap skyline fill). The `low-detail-building-*` GLBs are DIFFERENT buildings (plan skeptic), so they are
 *            ordinary types here, never an LOD of another type.
 *   colliders  boxes in list order, then manifest-box order, built from COLLIDER_BOXES below (a literal copy of manifest.json): a pure function of `list` on every
 *            client - no fetch, no GLB, no THREE. A squad client whose GLB / manifest / palette request failed derives exactly the same colliders (selftest
 *            + probe prove it) and draws the failed types as those boxes. `draw: false` returns just these (a headless or server client).
 *   ranges   Int32Array [start, count] per list index into `colliders` (count 0 for a skipped entry).
 *   failed   [{ type, error }] for every used type whose GLB did not load.
 * kit.preload(types) -> { loaded, failed }   kit.stats()   kit.setShadows(true | false | "auto")   kit.setFarDistance(m)   kit.warmObjects() ([])   kit.dispose()
 * stats() -> { districts: { id: { instances, groups, detailDrawCalls, detailTriangles, proxyDrawCalls, proxyTriangles, lod, radius, centre, ... } }, totals, ... }
 * (draw calls and triangles if nothing were frustum-culled; the probe measures the real ones from renderer.info.)
 *
 * Shadows: buildings and cars cast ("auto"), small props do not; with the sun's shadow box a district costs its whole mesh again in the shadow pass
 * (measured: +56k triangles at a street camera), so Wave 7 may call setShadows(false) on the medium tier.
 * Lifetime: dispose() releases the kit's InstancedMeshes (their matrix buffers are NOT freed by a group traverse + geometry.dispose), proxy / fallback geometry,
 * the GPU copies of the GLB geometry it drew (the kernel's cached parse stays valid: three re-uploads on the next use), its materials and its palette textures.
 *
 * Determinism: no random number is ever drawn here and no shared RNG is touched. Order is the list order. Colliders use exact integer quarter-turn tables
 * (non-quarter yaw uses Math.sin / Math.cos, rounded outward to the millimetre). Wave 7 should pick types and rotations with its own sub-RNG
 * (mulberry32(W.seed ^ hash(poi.id))) and hand the result to place().
 *
 * Pure API (no THREE, runs in Node): colliderFor(type, x, y, z, rot, scale?), footprintFor(type, x, z, rot, scale?), typeIds, hasType, localBoxes, mkCollider,
 * resolveRotation, quarterFacing, normaliseEntry, resolvePalette, tableDrift, emitColliderTable, THEMES, THEME_TYPES, COLLIDER_KEYS.
 *
 * Measured by _harness/citykit_probe.py on this box (300 buildings, 6 districts, 22 types): 32 draw calls and 389,717 triangles with every district at detail;
 * 6 calls and 6,400 triangles with all six collapsed to their proxies; 10 calls and 60,337 triangles at a street camera. 396,612 B of GLB for those 22 types
 * (908,816 B for all 81) plus 37,807 B of palettes. Licence of everything drawn: CC0 (CREDITS.md). No asset is added by this file.
 */

export const KIT_API = 1;
export const MANIFEST_PATH = "assets/props/city/manifest.json";
export const DEFAULTS = Object.freeze({
  farDistance: 250,        // m beyond a district's bounding sphere before it collapses to its one proxy mesh
  hysteresis: 0.04,        // THREE.LOD hysteresis (fraction of the level distance)
  chainSegment: 1.0,       // m, strip width of the non-quarter-turn collider staircase
  autoCell: 96,            // m, the grid used to chunk an entry that carries no district
  maxDistrictRadius: 300,  // m, a district wider than this is reported (stats().oversize): it culls poorly
  loadConcurrency: 4,
});
const HALF_PI = Math.PI / 2;

// ---------------------------------------------------------------------------------------------------------------------------------------------
// data: the colliders of every manifest type. A literal copy of assets/props/city/manifest.json types[*].colliders (metres at the type's
// suggested_scale, local: origin = footprint centre at ground, front +Z), flattened [minX, minY, minZ, maxX, maxY, maxZ] per box. Kept in the
// module so colliders never wait for, or depend on, a request. citykit.selftest.cjs asserts it equals the manifest EXACTLY; if the intake is
// re-run, `node citykit.selftest.cjs --emit-table` prints the new literal.
// ---------------------------------------------------------------------------------------------------------------------------------------------
const COLLIDER_BOXES = Object.freeze({
  "suburban/building-type-a":[-4.53,0,-2.502,-1.83,4.562,3.498,-1.83,0,-2.502,1.92,6.002,3.498,1.92,0,-2.502,4.62,4.562,3.498,-4.08,0,-3.702,-1.53,4.562,-2.502,1.77,0,-3.702,4.32,4.562,-2.502],
  "suburban/building-type-c":[-4.481,0,-2.502,-1.781,3.823,3.498,-1.781,0,-2.502,1.969,7.442,3.498,1.969,0,-2.502,4.519,6.002,3.498,1.669,0,-3.702,4.219,6.002,-2.502],
  "suburban/building-type-e":[-4.53,0,-2.501,4.62,8.19,3.499,-4.08,0,-3.701,-1.53,8.19,-2.501,1.77,0,-3.701,4.32,8.19,-2.501],
  "suburban/building-type-g":[-5.07,0,-1.991,4.08,5.31,4.009,1.53,0,-3.641,4.68,1.7,-1.991,-4.62,0,-3.191,-2.07,2.284,-1.991],
  "suburban/building-type-h":[-4.53,0,-2.848,4.62,5.31,3.002],
  "suburban/building-type-i":[-4.481,0,-2.501,-1.781,3.823,3.499,-1.781,0,-2.501,4.519,5.31,3.499,-1.181,0,-3.701,1.369,5.31,-2.501],
  "suburban/building-type-m":[-1.241,0,-3.941,5.059,5.31,4.909,-4.091,0,-1.091,-1.241,5.31,4.909,2.059,0,-5.141,4.609,2.284,-3.941,-5.141,0,-0.791,-4.091,1.7,1.759],
  "suburban/building-type-o":[-4.572,0,-2.501,-1.872,3.24,3.499,-1.872,0,-2.501,4.578,8.19,3.499,-1.272,0,-3.701,1.278,6.365,-2.501],
  "suburban/building-type-p":[-1.614,0,-2.364,4.686,5.76,3.636,-1.164,0,-3.564,1.386,1.7,-2.364],
  "suburban/building-type-q":[-1.314,0,-2.738,4.686,5.76,2.962,-2.664,0,-2.588,-1.314,3.24,-0.038],
  "commercial/building-a":[-4.702,0,-3.99,5.348,15.36,5.76],
  "commercial/building-c":[-4.702,0,-3.24,5.348,10.56,6.66,-0.652,0,-6.39,3.998,2.125,-4.74,-0.652,0,-4.74,3.998,10.56,-3.24],
  "commercial/building-e":[-9.84,0,-4.247,-0.24,5.76,5.503,-0.24,0,-4.247,9.96,10.56,5.503],
  "commercial/building-f":[-5.04,0,-3.93,5.16,20.16,5.67,0.21,0,-6.03,4.71,15.96,-3.93],
  "commercial/building-h":[-4.702,0,-4.097,5.348,15.36,5.653],
  "commercial/building-i":[-7.44,0,-6.762,7.56,19.68,7.488],
  "commercial/building-m":[-7.44,0,-7.002,7.56,34.2,7.398],
  "skyscraper/building-skyscraper-a":[-7.41,0,-6.06,7.59,33.6,7.29,-7.26,0,-7.41,-2.16,34.56,-6.06,2.34,0,-7.41,7.44,34.56,-6.06],
  "skyscraper/building-skyscraper-b":[-7.41,0,-6.06,7.59,53.28,7.29,-7.26,0,-7.41,-2.16,53.76,-6.06,2.34,0,-7.41,7.44,53.76,-6.06],
  "skyscraper/building-skyscraper-c":[-7.38,0,-5.177,7.62,44.16,8.023],
  "skyscraper/building-skyscraper-d":[-7.38,0,-5.177,7.62,62.88,8.023],
  "skyscraper/building-skyscraper-e":[-7.17,0,-7.002,7.98,48.48,7.398],
  "lowdetail/low-detail-building-a":[-2.85,0,-2.85,3,24,3],
  "lowdetail/low-detail-building-b":[-2.4,0,-2.4,2.55,23.4,2.55],
  "lowdetail/low-detail-building-g":[-2.4,0,-2.4,2.55,24,2.55,-2.85,0,-3,-0.45,24,-2.4,0.6,0,-3,3,24,-2.4,-3,0,0.6,-2.4,24,3],
  "lowdetail/low-detail-building-h":[-3,0,-2.85,3.15,25.2,3],
  "lowdetail/low-detail-building-wide-a":[-5.7,0,-3,5.85,13.2,3.15],
  "props/barrier-traffic":[-0.778,0.003,-0.39,0.778,0.805,0.39],
  "props/box-crate":[-0.465,0,-0.465,0.465,0.93,0.465],
  "props/cone-traffic":[-0.286,0,-0.286,0.286,0.714,0.286],
  "props/construction-barrier":[-0.472,0,-1.012,0.472,1.069,1.012],
  "props/crate-yard":[-0.481,0,-0.481,0.481,0.95,0.481],
  "props/dumpster":[-0.977,0,-0.518,0.977,1.592,0.518],
  "props/fence-suburban":[-1.187,0,-0.187,1.187,1.35,0.187],
  "props/grave-bench":[-0.726,0,-0.41,0.726,0.947,0.41],
  "props/hydrant":[-0.257,0.001,-0.183,0.257,0.773,0.217],
  "props/light-curved":[-0.225,0,-0.225,0.225,6.075,0.225],
  "props/light-curved-double":[-0.225,0,-0.225,0.225,6.075,0.225],
  "props/light-square":[-0.225,0,-0.225,0.225,5.4,0.225],
  "props/planter":[-0.8,0,-0.602,0.8,0.708,0.598],
  "props/shipping-container":[-3.008,0.042,-1.442,3.008,2.983,1.442],
  "cars/delivery":[-1.2,0,-2.64,1.2,1.689,2.56,-1.04,1.689,-2.56,1.04,2.64,1.589],
  "cars/hatchback-sports":[-1.105,0,-2.465,1.105,1.197,2.38,-1.105,1.197,-2.21,1.105,1.87,1.494],
  "cars/police":[-1.262,0,-2.635,1.262,1.282,2.635,-1.275,1.282,-2.523,1.275,2.21,1.538],
  "cars/sedan":[-1.275,0,-2.21,1.275,1.282,2.125,-1.275,1.282,-1.565,1.275,2.21,1.283],
  "cars/suv":[-1.275,0,-2.295,1.275,1.37,2.295,-1.275,1.37,-2.295,1.275,2.21,1.081],
  "cars/taxi":[-1.275,0,-2.38,1.275,1.377,2.295,-0.928,1.377,-1.43,0.928,2.55,1.075],
  "cars/truck":[-1.275,0,-2.55,1.275,1.326,2.465,-1.275,1.326,-2.465,1.275,2.21,1.359],
  "cars/van":[-1.275,0,-2.38,1.275,1.377,2.295,-1.275,1.377,-2.28,1.275,2.295,1.43],
  "furniture/bookcaseClosed":[0,0,-0.55,0.88,1.87,0],
  "furniture/cabinetTelevision":[0,0,-0.55,1.76,0.682,0],
  "furniture/cardboardBoxClosed":[0,0,-0.468,0.468,0.618,0],
  "furniture/chair":[0,0,-0.44,0.44,1.034,0],
  "furniture/chairDesk":[0,0,-0.692,0.737,1.337,0],
  "furniture/desk":[-0.022,0,-0.836,1.594,0.846,0.027],
  "furniture/kitchenFridge":[0,0,-0.62,0.946,2.024,0.022],
  "furniture/kitchenSink":[0,0,-0.99,0.946,1.078,0],
  "furniture/kitchenStove":[0,0,-0.99,0.946,0.99,0],
  "furniture/loungeSofa":[0,0,-0.902,2.156,1.012,0],
  "furniture/pottedPlant":[-0.233,0,-0.266,0.233,1.439,0.266],
  "furniture/sideTable":[-0.022,0,-0.462,1.154,0.846,0.022],
  "furniture/stoolBar":[0,0,-0.506,0.584,0.957,0],
  "furniture/table":[0,0,-0.984,1.851,0.719,0],
  "furniture/tableCoffee":[-1.014,0,-0.66,0.44,0.506,0.22],
  "furniture/trashcan":[-0.229,0,-0.246,0.229,0.941,0.269],
  "walls/doorway":[0,0,-0.223,1.1,2.25,0.027],
  "walls/doorwayFront":[0,0,-0.223,1.1,2.25,0.027],
  "walls/doorwayOpen":[0,0,-0.196,0.1,2.25,0,1,0,-0.196,1.1,2.25,0,0.1,2.15,-0.196,1,2.25,0],
  "walls/floorCorner":[0,0,-1.21,1.21,0.11,0],
  "walls/floorCornerRound":[0,0,-1.21,1.21,0.11,0],
  "walls/floorFull":[0,0,-2.2,2.2,0.11,0],
  "walls/floorHalf":[0,0,-2.2,1.1,0.11,0],
  "walls/paneling":[0,0,0,1.1,1.308,0.066],
  "walls/wall":[0,0,-0.11,2.2,2.837,0],
  "walls/wallCorner":[1.05,0,-1.21,1.35,2.837,-0.01,0,0,-0.16,1.05,2.837,0.14],
  "walls/wallCornerRond":[1.05,0,-1.21,1.35,2.837,0.14,0,0,-0.16,1.05,2.837,0.14],
  "walls/wallDoorway":[0,0,-0.153,0.7,2.9,0.043,1.55,0,-0.153,2.25,2.9,0.043,0.7,2.15,-0.153,1.55,2.9,0.043],
  "walls/wallDoorwayWide":[0,2.15,-0.153,2.25,2.9,0.043,0,0,-0.153,0.2,2.15,0.043,2.05,0,-0.153,2.25,2.15,0.043],
  "walls/wallHalf":[0,0,-0.11,1.1,2.837,0],
  "walls/wallWindow":[0,0,-0.153,2.2,2.837,0.043],
  "walls/wallWindowSlide":[0,0,-0.153,2.2,2.837,0.043]
});

/** Average colours of each building type's walls and roofs per palette variant, sampled offline from the GLB UVs in the shipped colormaps:
 *  [wall, roof] pairs in the order base, slate, brick, sand (sRGB hex). Used only for the far proxy and for the box fallback of a type whose GLB failed. */
const PROXY_COLORS = Object.freeze({
  "suburban/building-type-a": [0xa9bcc1, 0x58af81, 0xa9b0be, 0x57626c, 0xb3aeb8, 0x975443, 0xb8bac1, 0xbca87e],
  "suburban/building-type-c": [0xb2bfc7, 0x56af82, 0xb2b7c5, 0x55606d, 0xb9b5c1, 0x985142, 0xbdbec7, 0xbea87f],
  "suburban/building-type-e": [0xaab3c1, 0x58aa81, 0xaab0c0, 0x57626d, 0xacb0bf, 0x945446, 0xadb2c1, 0xb6a37e],
  "suburban/building-type-g": [0xa7b5bf, 0x61ac7e, 0xa7b1be, 0x60676c, 0xaab1bc, 0x995b47, 0xacb4bf, 0xbaa57b],
  "suburban/building-type-h": [0xb2b8c6, 0x52a47e, 0xb2b5c5, 0x515a6b, 0xb4b5c4, 0x8f4c43, 0xb6b8c6, 0xb29d7b],
  "suburban/building-type-i": [0xaebac3, 0x55b282, 0xaeb3c1, 0x545f6b, 0xb4b2bd, 0x994f3f, 0xb7b9c3, 0xc1aa7e],
  "suburban/building-type-m": [0xacb6c1, 0x60b589, 0xacb3c1, 0x5f6974, 0xaeb2bf, 0x9e5b4c, 0xb0b5c1, 0xc2ae85],
  "suburban/building-type-o": [0xabb3c0, 0x5e9881, 0xabb1c0, 0x5d6774, 0xacb1bf, 0x865e5a, 0xadb2c0, 0x9d947f],
  "suburban/building-type-p": [0x848b9d, 0x62687b, 0x848b9d, 0x62687b, 0x848b9d, 0x62687b, 0x848b9d, 0x62687b],
  "suburban/building-type-q": [0x84899a, 0x6b7183, 0x84899a, 0x6b7183, 0x84899a, 0x6b7183, 0x84899a, 0x6b7183],
  "commercial/building-a": [0x969aaa, 0x575a6b, 0x727a8c, 0x575a6b, 0x7d6063, 0x575a6b, 0x928d89, 0x575a6b],
  "commercial/building-c": [0xacb1c1, 0x61636d, 0x7d879a, 0x61636d, 0x8b6664, 0x61636d, 0xa6a095, 0x61636d],
  "commercial/building-e": [0xa6abbc, 0x575e6d, 0x7c8599, 0x575b6c, 0x896769, 0x5a5b6a, 0xa19b95, 0x5b5e6c],
  "commercial/building-f": [0x989eaf, 0x6c7485, 0x737d90, 0x6c7385, 0x7f6366, 0x6d7384, 0x95918d, 0x6e7485],
  "commercial/building-h": [0x757a8c, 0x657584, 0x646b7e, 0x656b81, 0x6a5e6a, 0x6d697c, 0x74747c, 0x717484],
  "commercial/building-i": [0x989cac, 0x646776, 0x767d8f, 0x5e6272, 0x806568, 0x605e6c, 0x948f8c, 0x636571],
  "commercial/building-m": [0xa3a7b8, 0x5e707a, 0x798194, 0x5c6173, 0x856263, 0x665c69, 0x9e9890, 0x6e6d75],
  "skyscraper/building-skyscraper-a": [0x8e9cba, 0x777a8d, 0x7788a6, 0x676c7e, 0x7e788c, 0x6c616c, 0x8b94a4, 0x75747c],
  "skyscraper/building-skyscraper-b": [0x90a1c2, 0x7e8195, 0x7a8dae, 0x6c7284, 0x817e95, 0x726570, 0x8e99ac, 0x7c7b82],
  "skyscraper/building-skyscraper-c": [0x9eaac2, 0x777c8e, 0x8b98b0, 0x696e80, 0x918a9a, 0x6e646f, 0x9ca3af, 0x77777f],
  "skyscraper/building-skyscraper-d": [0xa0aec6, 0x7f8397, 0x8f9eb7, 0x6e7386, 0x9492a3, 0x746772, 0x9ea7b6, 0x7e7d84],
  "skyscraper/building-skyscraper-e": [0xa4acbe, 0x6d707f, 0x7d879c, 0x616576, 0x8b6a6d, 0x655d68, 0xa29e99, 0x6b6c74],
  "lowdetail/low-detail-building-a": [0xb9bbcb, 0xcbccd9, 0x828a9c, 0x8b94a5, 0x92635d, 0x9e665c, 0xb2a797, 0xc3b59f],
  "lowdetail/low-detail-building-b": [0xd2d3e0, 0xc3c5d2, 0x8992a1, 0x8a92a4, 0x9f5d4d, 0x9a6963, 0xc9b89a, 0xbcb09e],
  "lowdetail/low-detail-building-g": [0xcacbd9, 0xcbccdb, 0x878f9f, 0x87909f, 0x9b5f52, 0x9b5f51, 0xc2b399, 0xc2b399],
  "lowdetail/low-detail-building-h": [0xc0c1d0, 0xdbdbe5, 0x848c9d, 0x8f98a8, 0x966158, 0xa56252, 0xb8ac98, 0xd1c0a1],
  "lowdetail/low-detail-building-wide-a": [0xafb1c2, 0xc2c3d1, 0x7f8799, 0x878fa1, 0x8d6563, 0x98655e, 0xa9a095, 0xbaae9b]
});
const VARIANT_ORDER = ["base", "slate", "brick", "sand"];
const FALLBACK_COLORS = Object.freeze({           // [wall, roof] by kind when a type has no sampled colours (props, cars, a failed manifest)
  building: [0xb4b8c4, 0x6a6e7a], prop: [0x8a8f99, 0x8a8f99], car: [0x6f7f95, 0x4d596b], furniture: [0x9a8468, 0x9a8468], wall: [0xc8c2b4, 0xc8c2b4],
});

/** O2 themes (city / resort / lodge / farm / ruin / mill): a recoloured colormap per building palette plus a tint multiplied on top (no new texture). */
export const THEMES = Object.freeze({
  // The tint multiplies the colormap in LINEAR light (material.color * texel), so 0x9a948a (sRGB 0.6) darkens to a third of the brightness: keep tints near white.
  city:   Object.freeze({ variant: Object.freeze({ suburban: "brick", commercial: "base" }),  tint: 0xffffff }),
  resort: Object.freeze({ variant: Object.freeze({ suburban: "sand",  commercial: "sand" }),  tint: 0xfff6ea }),
  lodge:  Object.freeze({ variant: Object.freeze({ suburban: "brick", commercial: "brick" }), tint: 0xf0e0cc }),
  farm:   Object.freeze({ variant: Object.freeze({ suburban: "brick", commercial: "sand" }),  tint: 0xf6ead4 }),
  ruin:   Object.freeze({ variant: Object.freeze({ suburban: "slate", commercial: "sand" }),  tint: 0xbdb7ad }),
  mill:   Object.freeze({ variant: Object.freeze({ suburban: "slate", commercial: "brick" }), tint: 0xe4dccf }),
});
/** Suggested types per theme and role (data for Wave 7 / 7b; the roles come from the manifest). */
export const THEME_TYPES = Object.freeze({
  // roles are the manifest's `role` field: house (suburban a c e g h i m o p q), shop (commercial c), warehouse (commercial e), midrise (commercial a f h i),
  // tower (commercial m, skyscrapers a-e), skyline (the five low-detail silhouettes). Picked from the contact sheets: p and q are the flat-roofed modern villas,
  // a c e o the steep-gabled houses, g h i the plain bungalows, m the wide hip-roofed house.
  city: Object.freeze({
    house: ["suburban/building-type-a", "suburban/building-type-c", "suburban/building-type-e", "suburban/building-type-g", "suburban/building-type-h", "suburban/building-type-i", "suburban/building-type-m", "suburban/building-type-o", "suburban/building-type-p", "suburban/building-type-q"],
    shop: ["commercial/building-c"],
    midrise: ["commercial/building-a", "commercial/building-f", "commercial/building-h", "commercial/building-i"],
    tower: ["commercial/building-m", "skyscraper/building-skyscraper-a", "skyscraper/building-skyscraper-b", "skyscraper/building-skyscraper-c", "skyscraper/building-skyscraper-d", "skyscraper/building-skyscraper-e"],
    warehouse: ["commercial/building-e"],
    skyline: ["lowdetail/low-detail-building-a", "lowdetail/low-detail-building-b", "lowdetail/low-detail-building-g", "lowdetail/low-detail-building-h", "lowdetail/low-detail-building-wide-a"],
  }),
  resort: Object.freeze({
    house: ["suburban/building-type-g", "suburban/building-type-h", "suburban/building-type-i", "suburban/building-type-m", "suburban/building-type-o", "suburban/building-type-p", "suburban/building-type-q"],
    shop: ["commercial/building-c"],
    midrise: ["commercial/building-a", "commercial/building-h"],
  }),
  lodge: Object.freeze({
    house: ["suburban/building-type-a", "suburban/building-type-c", "suburban/building-type-e", "suburban/building-type-o"],
    shop: ["commercial/building-c"],
    warehouse: ["commercial/building-e"],
  }),
  farm: Object.freeze({
    house: ["suburban/building-type-g", "suburban/building-type-h", "suburban/building-type-i"],
    shop: ["commercial/building-c"],
    warehouse: ["commercial/building-e"],
  }),
  ruin: Object.freeze({
    house: ["suburban/building-type-a", "suburban/building-type-c", "suburban/building-type-e", "suburban/building-type-i", "suburban/building-type-o"],
    shop: ["commercial/building-c"],
    midrise: ["commercial/building-a", "commercial/building-h"],
    warehouse: ["commercial/building-e"],
  }),
  mill: Object.freeze({
    house: ["suburban/building-type-g", "suburban/building-type-h", "suburban/building-type-i"],
    shop: ["commercial/building-c"],
    warehouse: ["commercial/building-e"],
    midrise: ["commercial/building-h"],
  }),

});
const BUILDING_PALETTES = { suburban: 1, commercial: 1 };      // the palettes that have recoloured variants and take a theme tint

// ---------------------------------------------------------------------------------------------------------------------------------------------
// pure part (no THREE)
// ---------------------------------------------------------------------------------------------------------------------------------------------

/** The game's collider constructor, copied from maps.js:228 field for field and in the same ORDER, so every kit collider shares the ONE hidden class
 *  every reader site (queryColliders, bot nav, bullets, mover) is specialised on. The probe asserts the key order against the live game's colliders. */
export function mkCollider(kind, minX, maxX, minY, maxY, minZ, maxZ, dir, prop, idx, hp) {
  return { kind, minX, maxX, minY, maxY, minZ, maxZ, dir, prop, idx, hp, dead: false, _qs: 0 };
}
export const COLLIDER_KEYS = Object.freeze(["kind", "minX", "maxX", "minY", "maxY", "minZ", "maxZ", "dir", "prop", "idx", "hp", "dead", "_qs"]);

export function typeIds() { return Object.keys(COLLIDER_BOXES); }
export function hasType(type) { return Object.prototype.hasOwnProperty.call(COLLIDER_BOXES, type); }
/** The type's local collider boxes as [minX, minY, minZ, maxX, maxY, maxZ] arrays (copies), metres at the suggested scale. */
export function localBoxes(type) {
  const T = COLLIDER_BOXES[type];
  if (!T) throw new Error("citykit.localBoxes: unknown type " + JSON.stringify(type));
  const out = [];
  for (let o = 0; o < T.length; o += 6) out.push(T.slice(o, o + 6));
  return out;
}

const mod4 = (n) => ((n % 4) + 4) % 4;
/** rot (quarter-turn index when an integer, radians otherwise) or ry (radians) -> { q, ry, exact }. q is 0..3 when the turn is a quarter-turn multiple
 *  (within 1e-6 of one), else -1. ry is what the mesh is rotated by (exactly q * PI/2 for a quarter turn). */
export function resolveRotation(rot, ry) {
  if (ry !== undefined && ry !== null) {
    const t = ry / HALF_PI, k = Math.round(t);
    if (Math.abs(t - k) < 1e-6) { const q = mod4(k); return { q, ry: q * HALF_PI, exact: true }; }
    return { q: -1, ry: +ry, exact: false };
  }
  if (rot === undefined || rot === null) return { q: 0, ry: 0, exact: true };
  if (Number.isInteger(rot)) { const q = mod4(rot); return { q, ry: q * HALF_PI, exact: true }; }
  const t = rot / HALF_PI, k = Math.round(t);
  if (Math.abs(t - k) < 1e-6) { const q = mod4(k); return { q, ry: q * HALF_PI, exact: true }; }
  return { q: -1, ry: +rot, exact: false };
}
/** The quarter-turn index whose authored front (+Z at 0) faces the direction (dx, dz): a lot facing its street. */
export function quarterFacing(dx, dz) {
  if (Math.abs(dx) < 1e-12 && Math.abs(dz) < 1e-12) return 0;
  return mod4(Math.round(Math.atan2(dx, dz) / HALF_PI));
}
const _SIN = [0, 1, 0, -1], _COS = [1, 0, -1, 0];       // exact quarter-turn tables (never Math.sin(PI/2))

/** One manifest box -> a world box at an exact quarter turn q about +Y (x' = x cos + z sin, z' = -x sin + z cos), scaled by k, at (x, y, z). */
function pushQuarter(out, T, o, x, y, z, k, q) {
  const x0 = T[o] * k, y0 = T[o + 1] * k, z0 = T[o + 2] * k, x1 = T[o + 3] * k, y1 = T[o + 4] * k, z1 = T[o + 5] * k;
  let a, b, c, d;                                       // X range [a, b], Z range [c, d]
  if (q === 0) { a = x0; b = x1; c = z0; d = z1; }
  else if (q === 1) { a = z0; b = z1; c = -x1; d = -x0; }
  else if (q === 2) { a = -x1; b = -x0; c = -z1; d = -z0; }
  else { a = -z1; b = -z0; c = x0; d = x1; }
  out.push(mkCollider("box", x + a, x + b, y + y0, y + y1, z + c, z + d, -1, null, -1, 0));
}
/** One manifest box at an arbitrary yaw: a staircase of <= `seg` m strips of the rotated rectangle, each strip the AABB of the part of the rectangle inside it
 *  (the strip axis is the one the rectangle's edges are shallow to, so no edge climbs more than 1 m per metre; millimetre rounding is outward, never inward).
 *  Every point of the true rotated box lies inside some strip; no strip reaches more than ~seg beyond it. A fallback for a one-off prop at a slant:
 *  Wave 7 lots are quarter-turned, which is exact. */
function pushStrips(out, T, o, x, y, z, k, ry, seg) {
  const x0 = T[o] * k, y0 = T[o + 1] * k, z0 = T[o + 2] * k, x1 = T[o + 3] * k, y1 = T[o + 4] * k, z1 = T[o + 5] * k;
  const c = Math.cos(ry), s = Math.sin(ry), lx = [x0, x1, x1, x0], lz = [z0, z0, z1, z1], px = [0, 0, 0, 0], pz = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) { px[i] = lx[i] * c + lz[i] * s; pz[i] = -lx[i] * s + lz[i] * c; }
  const alongX = Math.abs(s) <= Math.abs(c), a = alongX ? px : pz, b = alongX ? pz : px;
  const aMin = Math.min(a[0], a[1], a[2], a[3]), aMax = Math.max(a[0], a[1], a[2], a[3]);
  const n = Math.max(1, Math.ceil((aMax - aMin) / seg - 1e-9)), fl = (v) => Math.floor(v * 1000) / 1000, ce = (v) => Math.ceil(v * 1000) / 1000;
  for (let i = 0; i < n; i++) {
    const sa = aMin + ((aMax - aMin) * i) / n, sb = aMin + ((aMax - aMin) * (i + 1)) / n, samples = [sa, sb];
    for (let j = 0; j < 4; j++) if (a[j] > sa && a[j] < sb) samples.push(a[j]);
    let lo = Infinity, hi = -Infinity;
    for (const t of samples) for (let j = 0; j < 4; j++) {
      const j2 = (j + 1) & 3, a1 = a[j], a2 = a[j2];
      if (a1 === a2) { if (t === a1) { lo = Math.min(lo, b[j], b[j2]); hi = Math.max(hi, b[j], b[j2]); } continue; }
      if ((t - a1) * (t - a2) <= 0) { const v = b[j] + ((t - a1) / (a2 - a1)) * (b[j2] - b[j]); if (v < lo) lo = v; if (v > hi) hi = v; }
    }
    const A0 = fl(sa), A1 = ce(sb), B0 = fl(lo), B1 = ce(hi);
    if (alongX) out.push(mkCollider("box", x + A0, x + A1, y + y0, y + y1, z + B0, z + B1, -1, null, -1, 0));
    else out.push(mkCollider("box", x + B0, x + B1, y + y0, y + y1, z + A0, z + A1, -1, null, -1, 0));
  }
}
function pushColliders(out, type, x, y, z, k, R, seg) {
  const T = COLLIDER_BOXES[type];
  if (R.exact) for (let o = 0; o < T.length; o += 6) pushQuarter(out, T, o, x, y, z, k, R.q);
  else for (let o = 0; o < T.length; o += 6) pushStrips(out, T, o, x, y, z, k, R.ry, seg);
}
/** The colliders of one placed instance (pure; usable in Node without THREE). rot: quarter-turn index or radians (see resolveRotation). */
export function colliderFor(type, x, y, z, rot, scale) {
  if (!hasType(type)) throw new Error("citykit.colliderFor: unknown type " + JSON.stringify(type));
  const k = scale === undefined || scale === null ? 1 : +scale;
  if (!(k > 0) || !isFinite(k)) throw new Error("citykit.colliderFor: bad scale " + scale);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) throw new Error("citykit.colliderFor: non-finite position");
  const out = [];
  pushColliders(out, type, +x, +y, +z, k, resolveRotation(rot), DEFAULTS.chainSegment);
  return out;
}
/** The XZ footprint (and height) the colliders of one instance cover: the union AABB. Lets a town generator fit a lot before placing. */
export function footprintFor(type, x, z, rot, scale) {
  const cs = colliderFor(type, x, 0, z, rot, scale);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = -Infinity;
  for (const c of cs) { if (c.minX < minX) minX = c.minX; if (c.maxX > maxX) maxX = c.maxX; if (c.minZ < minZ) minZ = c.minZ; if (c.maxZ > maxZ) maxZ = c.maxZ; if (c.maxY > maxY) maxY = c.maxY; }
  return { minX, maxX, minZ, maxZ, height: maxY, w: maxX - minX, d: maxZ - minZ };
}

/** list entry -> a checked, resolved record, or { bad } with the reason. */
export function normaliseEntry(e, i) {
  if (!e || typeof e !== "object") return { i, bad: "entry is not an object" };
  if (typeof e.type !== "string") return { i, bad: "no type" };
  const x = +e.x, y = +e.y, z = +e.z;
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return { i, type: e.type, bad: "non-finite position" };
  const k = e.scale === undefined || e.scale === null ? 1 : +e.scale;
  if (!(k > 0) || !isFinite(k)) return { i, type: e.type, bad: "bad scale" };
  const R = resolveRotation(e.rot, e.ry);
  if (!isFinite(R.ry)) return { i, type: e.type, bad: "bad rotation" };
  return { i, type: e.type, x, y, z, k, q: R.q, ry: R.ry, exact: R.exact, district: e.district == null ? null : String(e.district), palette: e.palette == null ? null : String(e.palette) };
}

/** Palette choice of one instance: spec = a theme name, a variant name, or nothing (-> the district's theme). Returns { key, variant, tint, id }.
 *  Only suburban and commercial have recoloured variants and take a theme tint; roads / car / graveyard / quaternius_atlas stay as authored. */
export function resolvePalette(paletteKey, spec, districtTheme) {
  if (!paletteKey) return { key: null, variant: "base", tint: 0xffffff, id: "-" };
  let variant = "base", tint = 0xffffff;
  if (BUILDING_PALETTES[paletteKey]) {
    if (spec && VARIANT_ORDER.indexOf(spec) >= 0) variant = spec;
    else {
      const th = THEMES[spec && THEMES[spec] ? spec : (districtTheme && THEMES[districtTheme] ? districtTheme : "city")];
      variant = th.variant[paletteKey] || "base"; tint = th.tint;
    }
  }
  return { key: paletteKey, variant, tint, id: paletteKey + ":" + variant + ":" + tint.toString(16) };
}

/** Prints the COLLIDER_BOXES literal for a parsed manifest (used by `node citykit.selftest.cjs --emit-table` after an intake re-run). */
export function emitColliderTable(manifest) {
  const rows = [];
  for (const id of Object.keys(manifest.types)) {
    const flat = [];
    for (const c of manifest.types[id].colliders) flat.push(...c.min, ...c.max);
    rows.push("  " + JSON.stringify(id) + ": [" + flat.join(",") + "]");
  }
  return rows.join(",\n");
}
/** Does the embedded table equal this parsed manifest exactly? -> the list of differing type ids ([] = identical). */
export function tableDrift(manifest) {
  const bad = [], seen = {};
  for (const id of Object.keys(manifest.types)) {
    seen[id] = 1;
    const T = COLLIDER_BOXES[id];
    if (!T) { bad.push(id); continue; }
    const flat = [];
    for (const c of manifest.types[id].colliders) flat.push(...c.min, ...c.max);
    if (flat.length !== T.length || flat.some((v, j) => v !== T[j])) bad.push(id);
  }
  for (const id of Object.keys(COLLIDER_BOXES)) if (!seen[id]) bad.push(id);
  return bad;
}

// small path helper: textual join + ".." normalisation, safe for absolute URLs and relative paths alike
function joinPath(base, rel) {
  const s = String(base || "") + String(rel || "");
  const m = /^([a-z][a-z0-9+.-]*:\/\/[^/]*)?(.*)$/i.exec(s), head = m[1] || "", out = [];
  for (const p of m[2].split("/")) {
    if (p === "..") { if (out.length && out[out.length - 1] !== ".." && out[out.length - 1] !== "") out.pop(); else out.push(p); }
    else if (p !== ".") out.push(p);
  }
  return head + out.join("/");
}
function kindFromId(id) {
  return id.startsWith("cars/") ? "car" : id.startsWith("props/") ? "prop" : id.startsWith("furniture/") ? "furniture" : id.startsWith("walls/") ? "wall" : "building";
}
function paletteKeyFromId(id) {                      // only used when the manifest did not load (the far proxy / box fallback still wants a variant)
  return id.startsWith("suburban/") ? "suburban" : id.startsWith("commercial/") || id.startsWith("skyscraper/") || id.startsWith("lowdetail/") ? "commercial" : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------
// view part (needs THREE, injected so the pure part imports in Node with no resolve hook)
// ---------------------------------------------------------------------------------------------------------------------------------------------
const SAMPLERS = { NEAREST: "NearestFilter", LINEAR: "LinearFilter", NEAREST_MIPMAP_NEAREST: "NearestMipmapNearestFilter", LINEAR_MIPMAP_LINEAR: "LinearMipmapLinearFilter",
  NEAREST_MIPMAP_LINEAR: "NearestMipmapLinearFilter", LINEAR_MIPMAP_NEAREST: "LinearMipmapNearestFilter" };

/** @param env { THREE, kernel?, assetBase?, W?, manifest?, manifestUrl?, fetch?, options? } THREE and the kernel default to env.W.THREE / env.W.kernel. */
export function createCityKit(env) {
  env = env || {};
  const W = env.W || null;
  const THREE = env.THREE || (W && W.THREE) || null;
  const kernel = env.kernel || (W && W.kernel) || null;
  const assetBase = env.assetBase !== undefined ? env.assetBase : (W && W.assetBase) || "";
  const manifestUrl = env.manifestUrl || joinPath(assetBase, MANIFEST_PATH);
  const manifestDir = manifestUrl.replace(/[^/]*$/, "");
  const opt = Object.assign({}, DEFAULTS, env.options || {});
  const warn = (...a) => { try { console.warn("[citykit]", ...a); } catch (e) { /* no console */ } };

  let disposed = false;
  let man = null, manP = null;                         // indexed manifest (drawing data only; colliders never wait for it)
  const glb = new Map();                               // type -> { parts: [{ geometry, material, local, tris, identity }], tris } | { failed: string }
  const glbP = new Map();                              // type -> in-flight promise
  const texP = new Map();                              // palette file -> Promise<Texture|null>
  const palMats = new Map();                           // palette id -> material (kit-owned)
  const textures = new Set();                          // kit-owned textures
  const placements = [];                               // { id, districts: Map, entries }
  let proxyMat = null;
  const shadowsOpt = { value: env.shadows === undefined ? "auto" : env.shadows };
  let seq = 0;

  function assertAlive() { if (disposed) throw new Error("citykit: the kit was disposed"); }

  // -- manifest (drawing data: file paths, palettes, kinds, scales). A failure leaves the kit drawing collider boxes. --------------------------
  function indexManifest(raw) {
    if (!raw || raw.version !== 1 || !raw.types) throw new Error("not a version-1 city manifest");
    const types = {};
    for (const id of Object.keys(raw.types)) {
      const t = raw.types[id];
      types[id] = { id, file: t.file, kind: t.kind, role: t.role, group: t.group, palette: t.palette || null, scale: t.suggested_scale, tris: t.tris,
        double: !!t.double_sided, mode: t.collider_mode };
    }
    const drift = tableDrift(raw);
    if (drift.length) warn("the embedded collider table differs from manifest.json for " + drift.length + " type(s) (" + drift.slice(0, 4).join(", ") + "): colliders still come from the table; re-run citykit.selftest.cjs --emit-table");
    return { raw, types, palettes: raw.palettes || {}, drift };
  }
  function ready() {
    assertAlive();
    if (man) return Promise.resolve(man);
    if (env.manifest) { man = indexManifest(env.manifest); return Promise.resolve(man); }
    if (!manP) {
      manP = (async () => {
        const f = env.fetch || (typeof fetch === "function" ? fetch : null);
        if (!f) return null;
        for (let attempt = 0; attempt < 2 && !man; attempt++) {
          try {
            const ac = typeof AbortController === "function" ? new AbortController() : null;
            const tm = ac ? setTimeout(() => ac.abort(), kernel && kernel.loadTimeoutMs > 0 ? kernel.loadTimeoutMs : 30000) : 0;
            let r;
            try { r = await f(manifestUrl, ac ? { cache: "no-cache", signal: ac.signal } : { cache: "no-cache" }); } finally { clearTimeout(tm); }
            if (!r || !r.ok) throw new Error("HTTP " + (r ? r.status : "none"));
            man = indexManifest(await r.json());
          } catch (e) { warn("manifest " + (attempt ? "unavailable, drawing collider boxes only:" : "failed, retrying:"), e && e.message || e); }
        }
        return man;
      })();
    }
    return manP;
  }
  const kindOf = (type) => (man && man.types[type] ? man.types[type].kind : kindFromId(type));

  // -- palettes ------------------------------------------------------------------------------------------------------------------------------
  function paletteFile(key, variant) {
    const p = man && man.palettes[key];
    if (!p) return null;
    const v = variant && variant !== "base" && p.variants && p.variants[variant] ? p.variants[variant] : null;
    return { file: (v || p).file, sampler: p.sampler || "LINEAR/LINEAR_MIPMAP_LINEAR" };
  }
  function loadTexture(pf) {
    const url = joinPath(manifestDir, pf.file);
    if (texP.has(url)) return texP.get(url);
    const p = new Promise((res) => {
      const loader = new THREE.TextureLoader(kernel && kernel.loadingManager ? kernel.loadingManager : undefined);
      loader.load(url, (t) => {
        if (disposed) { t.dispose(); res(null); return; }
        const [mag, min] = String(pf.sampler).split("/");
        t.flipY = false;                                  // glTF UVs start at the top-left
        t.colorSpace = THREE.SRGBColorSpace;
        t.magFilter = THREE[SAMPLERS[mag]] || THREE.LinearFilter;
        t.minFilter = THREE[SAMPLERS[min]] || THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        try { const r = kernel && kernel.renderer; if (r && r.capabilities) t.anisotropy = Math.min(4, r.capabilities.getMaxAnisotropy()); } catch (e) { /* default */ }
        t.name = "citykit:" + pf.file;
        t.needsUpdate = true;
        textures.add(t);
        res(t);
      }, undefined, (e) => { warn("palette " + url + " failed:", e && e.message || e); res(null); });
    });
    texP.set(url, p);
    return p;
  }
  async function paletteMaterial(pal, double) {
    const id = pal.id + (double ? ":2" : ":1");
    if (palMats.has(id)) return palMats.get(id);
    const pf = paletteFile(pal.key, pal.variant);
    const tex = pf ? await loadTexture(pf) : null;
    if (palMats.has(id)) return palMats.get(id);
    const m = new THREE.MeshStandardMaterial({ map: tex || null, roughness: 1, metalness: 0, side: double ? THREE.DoubleSide : THREE.FrontSide });
    m.color.setHex(tex ? pal.tint : 0xb4b8c4);
    m.name = "citykit:" + id;
    palMats.set(id, m);
    return m;
  }
  function boxMaterial() {
    if (!proxyMat) { proxyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }); proxyMat.name = "citykit:boxes"; }
    return proxyMat;
  }

  // -- GLBs ----------------------------------------------------------------------------------------------------------------------------------
  async function loadType(type) {
    if (glb.has(type)) return glb.get(type);
    if (glbP.has(type)) return glbP.get(type);
    const p = (async () => {
      let rec;
      try {
        const T = man && man.types[type];
        if (!T) throw new Error(man ? "type not in the manifest" : "no manifest");
        if (!kernel || typeof kernel.loadGLTF !== "function") throw new Error("no kernel.loadGLTF");
        const root = await kernel.loadGLTF(joinPath(manifestDir, T.file));
        root.updateMatrixWorld(true);
        const parts = [];
        root.traverse((o) => {
          if (!o.isMesh) return;
          const g = o.geometry;
          const idm = o.matrixWorld.elements.every((v, i) => v === (i % 5 === 0 ? 1 : 0));
          parts.push({ geometry: g, material: o.material, local: o.matrixWorld.clone(), identity: idm, tris: (g.index ? g.index.count : g.attributes.position.count) / 3 });
        });
        if (!parts.length) throw new Error("the GLB holds no mesh");
        rec = { parts, tris: parts.reduce((a, q) => a + q.tris, 0) };
      } catch (e) { rec = { failed: String(e && e.message || e).slice(0, 200) }; warn("GLB " + type + " failed (colliders unaffected, drawn as boxes):", rec.failed); }
      glb.set(type, rec); glbP.delete(type);
      return rec;
    })();
    glbP.set(type, p);
    return p;
  }
  async function pool(items, fn, n) {
    let i = 0;
    const run = async () => { while (i < items.length) { const it = items[i++]; await fn(it); } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  }
  /** Load the GLBs of `types` (default: none) and the manifest. Resolves { loaded, failed:[{type, error}] }; never rejects. */
  async function preload(types) {
    assertAlive();
    await ready();
    const want = Array.from(new Set(types || [])).filter(hasType);
    await pool(want, loadType, opt.loadConcurrency);
    const loaded = [], failed = [];
    for (const t of want) { const r = glb.get(t); if (r && !r.failed) loaded.push(t); else failed.push({ type: t, error: r ? r.failed : "disposed" }); }
    return { loaded, failed };
  }

  // -- box geometry (proxy + fallback) ----------------------------------------------------------------------------------------------------------
  const _col = { c: null, t: null };
  function rgb(hex, tint) {                                // THREE.Color keeps LINEAR components, which is what a vertex colour attribute holds
    if (!_col.c) { _col.c = new THREE.Color(); _col.t = new THREE.Color(); }
    _col.c.setHex(hex);
    if (tint !== 0xffffff) _col.c.multiply(_col.t.setHex(tint));
    return [_col.c.r, _col.c.g, _col.c.b];
  }
  function colorsFor(type, variant, tint) {
    const e = PROXY_COLORS[type];
    if (e) { const vi = Math.max(0, VARIANT_ORDER.indexOf(variant)); return [rgb(e[vi * 2], tint), rgb(e[vi * 2 + 1], tint)]; }
    const f = FALLBACK_COLORS[kindOf(type)] || FALLBACK_COLORS.building;
    return [rgb(f[0], 0xffffff), rgb(f[1], 0xffffff)];
  }
  /** Merge the collider boxes of `items` (resolved entries) into ONE geometry: five faces per box (no underside), wall / roof vertex colours, local to `c0`. */
  function boxGeometry(items, c0) {
    const pos = [], nor = [], col = [], idx = [];
    let v = 0;
    for (const it of items) {
      const T = COLLIDER_BOXES[it.type], cs = colorsFor(it.type, it.pal.variant, it.pal.tint), cr = it.exact ? _COS[it.q] : Math.cos(it.ry), sr = it.exact ? _SIN[it.q] : Math.sin(it.ry);
      for (let o = 0; o < T.length; o += 6) {
        const b = [T[o] * it.k, T[o + 1] * it.k, T[o + 2] * it.k, T[o + 3] * it.k, T[o + 4] * it.k, T[o + 5] * it.k];
        const P = (lx, ly, lz) => [it.x - c0[0] + lx * cr + lz * sr, it.y - c0[1] + ly, it.z - c0[2] - lx * sr + lz * cr];
        const N = (nx, nz) => [nx * cr + nz * sr, -nx * sr + nz * cr];
        const face = (corners, n, color) => {
          for (const c of corners) { pos.push(c[0], c[1], c[2]); nor.push(n[0], n[1], n[2]); col.push(color[0], color[1], color[2]); }
          idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
        };
        const x0 = b[0], y0 = b[1], z0 = b[2], x1 = b[3], y1 = b[4], z1 = b[5];
        face([P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), P(x0, y1, z0)], [0, 1, 0], cs[1]);                       // roof
        let n = N(0, 1);  face([P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], [n[0], 0, n[1]], cs[0]); // +z
        n = N(0, -1);     face([P(x1, y0, z0), P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0)], [n[0], 0, n[1]], cs[0]); // -z
        n = N(1, 0);      face([P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], [n[0], 0, n[1]], cs[0]); // +x
        n = N(-1, 0);     face([P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0)], [n[0], 0, n[1]], cs[0]); // -x
      }
    }
    if (!v) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  // -- shadows -------------------------------------------------------------------------------------------------------------------------------
  function casts(type) {
    const s = shadowsOpt.value;
    if (s === true || s === false) return s;
    const k = kindOf(type);
    if (k === "building" || k === "car") return true;
    if (k === "prop") { const b = COLLIDER_BOXES[type]; let h = 0; for (let o = 4; o < b.length; o += 6) h = Math.max(h, b[o]); return h >= 1.5; }
    return false;
  }

  // -- place ---------------------------------------------------------------------------------------------------------------------------------
  async function place(list, o) {
    assertAlive();
    o = o || {};
    const entries = [], skipped = [], ranges = new Int32Array(Math.max(0, list.length) * 2);
    const colliders = [];
    let inexact = 0;
    for (let i = 0; i < list.length; i++) {
      const n = normaliseEntry(list[i], i);
      if (n.bad) { skipped.push({ i, type: n.type, reason: n.bad }); continue; }
      if (!hasType(n.type)) { skipped.push({ i, type: n.type, reason: "unknown type" }); continue; }
      ranges[i * 2] = colliders.length;
      pushColliders(colliders, n.type, n.x, n.y, n.z, n.k, { q: n.q, ry: n.ry, exact: n.exact }, opt.chainSegment);
      ranges[i * 2 + 1] = colliders.length - ranges[i * 2];
      if (!n.exact) inexact++;
      entries.push(n);
    }
    if (skipped.length) warn(skipped.length + " list entries skipped, first: " + JSON.stringify(skipped[0]));
    const result = { meshes: [], colliders, ranges, skipped, failed: [], districts: [], inexactEntries: inexact, id: seq++ };
    if (o.draw === false || !entries.length) { placements.push({ id: result.id, districts: new Map(), entries, inexact }); return result; }
    if (!THREE) { result.error = "no THREE: colliders only"; warn(result.error); placements.push({ id: result.id, districts: new Map(), entries, inexact }); return result; }

    // districts (list order = id order of first appearance)
    const dMap = new Map(), cell = o.autoCell > 0 ? o.autoCell : opt.autoCell;
    for (const n of entries) {
      n.district = n.district || ("cell:" + Math.floor(n.x / cell) + "," + Math.floor(n.z / cell));
      if (!dMap.has(n.district)) dMap.set(n.district, []);
      dMap.get(n.district).push(n);
    }
    await ready();
    const themeOf = (id) => (o.districts && o.districts[id] && o.districts[id].theme) || o.theme || "city";
    for (const [id, items] of dMap) for (const n of items) {
      const T = man && man.types[n.type];
      n.pal = resolvePalette(T ? T.palette : paletteKeyFromId(n.type), n.palette, themeOf(id));
    }
    const modeOf = (id) => (o.districts && o.districts[id] && o.districts[id].lod) || o.lod || "auto";       // "auto" | "detail" | "far"
    const drawn = entries.filter((n) => modeOf(n.district) !== "far");                                       // a far-only district loads no GLB at all
    await preload(drawn.map((n) => n.type));
    if (disposed) return result;
    for (const n of drawn) { const r = glb.get(n.type); if (!r || r.failed) { if (!result.failed.some((f) => f.type === n.type)) result.failed.push({ type: n.type, error: r ? r.failed : "not loaded" }); } }

    const far = o.farDistance !== undefined ? o.farDistance : opt.farDistance;
    const rec = { id: result.id, districts: new Map(), entries, inexact };
    for (const [id, items] of dMap) {
      const D = await buildDistrict(id, items, o, far, modeOf(id));
      rec.districts.set(id, D);
      result.meshes.push(D.lod);
      result.districts.push(id);
      if (o.parent) o.parent.add(D.lod);
    }
    placements.push(rec);
    return result;
  }

  async function buildDistrict(id, items, o, far, mode) {
    // bounds from the world collider boxes (a bounding sphere in 3D)
    let nx = Infinity, xx = -Infinity, ny = Infinity, xy = -Infinity, nz = Infinity, xz = -Infinity;
    const tmp = [];
    for (const it of items) {
      tmp.length = 0;
      pushColliders(tmp, it.type, it.x, it.y, it.z, it.k, { q: it.q, ry: it.ry, exact: it.exact }, opt.chainSegment);
      for (const c of tmp) {
        if (c.minX < nx) nx = c.minX; if (c.maxX > xx) xx = c.maxX; if (c.minY < ny) ny = c.minY; if (c.maxY > xy) xy = c.maxY; if (c.minZ < nz) nz = c.minZ; if (c.maxZ > xz) xz = c.maxZ;
      }
    }
    const c0 = [(nx + xx) / 2, (ny + xy) / 2, (nz + xz) / 2];
    const radius = Math.hypot((xx - nx) / 2, (xy - ny) / 2, (xz - nz) / 2);
    const lod = new THREE.LOD();
    lod.name = "kit:" + id;
    lod.position.set(c0[0], c0[1], c0[2]);
    lod.matrixAutoUpdate = false; lod.updateMatrix();
    const detail = new THREE.Group();
    detail.name = "kit:" + id + ":detail";
    const D = { id, lod, detail, far: null, centre: c0, radius, instances: items.length, meshes: [], geometries: new Set(), groups: [], failedTypes: new Set(),
      detailTris: 0, proxyTris: 0, fallbackBoxes: 0, mode, farDistance: far };

    // group by (type, palette) -> parts
    const groups = new Map(), failedItems = [];
    for (const it of mode === "far" ? [] : items) {
      const r = glb.get(it.type);
      if (!r || r.failed) { failedItems.push(it); D.failedTypes.add(it.type); continue; }
      const key = it.type + "|" + it.pal.id;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    }
    const M = new THREE.Matrix4(), _sc3 = new THREE.Vector3();
    for (const [key, list] of groups) {
      const type = list[0].type, r = glb.get(type), T = man.types[type], pal = list[0].pal;
      for (let pi = 0; pi < r.parts.length; pi++) {
        const part = r.parts[pi];
        let mat = part.material;
        if (T.palette) mat = await paletteMaterial(pal, T.double || (part.material && part.material.side === THREE.DoubleSide));
        const im = new THREE.InstancedMesh(part.geometry, mat, list.length);
        im.name = "kit:" + id + ":" + type + (r.parts.length > 1 ? "#" + pi : "") + (T.palette && pal.variant !== "base" ? ":" + pal.variant : "");
        if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
        const gs = part.geometry.boundingSphere, sc3 = _sc3;
        let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
        const cen = [];                                                        // each instance's own sphere: [x, y, z, r], local to the district
        for (let j = 0; j < list.length; j++) {
          const it = list[j], sc = T.scale * it.k;
          const c = it.exact ? _COS[it.q] : Math.cos(it.ry), s = it.exact ? _SIN[it.q] : Math.sin(it.ry);
          M.set(c * sc, 0, s * sc, it.x - c0[0],  0, sc, 0, it.y - c0[1],  -s * sc, 0, c * sc, it.z - c0[2],  0, 0, 0, 1);
          if (!part.identity) M.multiply(part.local);
          im.setMatrixAt(j, M);
          sc3.copy(gs.center).applyMatrix4(M);
          const rr = gs.radius * M.getMaxScaleOnAxis();
          cen.push(sc3.x, sc3.y, sc3.z, rr);
          if (sc3.x < bx0) bx0 = sc3.x; if (sc3.x > bx1) bx1 = sc3.x; if (sc3.y < by0) by0 = sc3.y; if (sc3.y > by1) by1 = sc3.y; if (sc3.z < bz0) bz0 = sc3.z; if (sc3.z > bz1) bz1 = sc3.z;
        }
        // The bounding sphere is COMPUTED here, not left to three's lazy one: three's InstancedMesh sphere is a running union of the instances' spheres
        // and grows loose (measured: 196 m for 18 houses of a 179 m district). This one is centred on the box of the instance centres and reaches the
        // farthest instance sphere, so it can never be wider than the district's own sphere plus one building.
        const bcx = (bx0 + bx1) / 2, bcy = (by0 + by1) / 2, bcz = (bz0 + bz1) / 2;
        let br = 0;
        for (let j = 0; j < cen.length; j += 4) br = Math.max(br, Math.hypot(cen[j] - bcx, cen[j + 1] - bcy, cen[j + 2] - bcz) + cen[j + 3]);
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceMatrix.setUsage) im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
        im.castShadow = casts(type);
        im.receiveShadow = true;
        im.userData.kitDistrict = id; im.userData.kitType = type;
        im.matrixAutoUpdate = false; im.updateMatrix();
        im.boundingSphere = new THREE.Sphere(new THREE.Vector3(bcx, bcy, bcz), br);
        detail.add(im);
        D.meshes.push({ mesh: im, type }); D.geometries.add(part.geometry);
        D.detailTris += part.tris * list.length;
        D.groups.push({ type, palette: pal.id, part: pi, instances: list.length, tris: part.tris * list.length, radius: im.boundingSphere.radius, castShadow: im.castShadow });
      }
    }
    // a type whose GLB failed is drawn as its collider boxes (the same boxes every client derives)
    if (failedItems.length) {
      const g = boxGeometry(failedItems, c0);
      if (g) {
        const m = new THREE.Mesh(g, boxMaterial());
        m.name = "kit:" + id + ":fallback"; m.castShadow = true; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
        detail.add(m); D.meshes.push({ mesh: m, type: null }); D.geometries.add(g);
        D.fallbackBoxes = failedItems.length; D.detailTris += g.index.count / 3;
        D.groups.push({ type: "(boxes)", palette: "-", part: 0, instances: failedItems.length, tris: g.index.count / 3, radius: g.boundingSphere.radius, castShadow: true });
      }
    }
    // far level: one merged proxy of the district's buildings, or nothing
    const bld = items.filter((it) => kindOf(it.type) === "building");
    let farObj = null;
    const wantFar = mode === "far" || (mode !== "detail" && far > 0 && isFinite(far));
    if (bld.length && wantFar) {
      const g = boxGeometry(bld, c0);
      if (g) {
        farObj = new THREE.Mesh(g, boxMaterial());
        farObj.name = "kit:" + id + ":far"; farObj.castShadow = false; farObj.receiveShadow = false; farObj.matrixAutoUpdate = false; farObj.updateMatrix();
        D.geometries.add(g); D.proxyTris = g.index.count / 3; D.far = farObj;
      }
    } else if (wantFar) { farObj = new THREE.Group(); farObj.name = "kit:" + id + ":far-empty"; D.far = farObj; }
    if (mode === "far") { lod.addLevel(farObj || detail, 0); if (farObj) detail.visible = false; }          // the far proxy IS the district: a skyline fill with no GLB
    else { lod.addLevel(detail, 0); if (farObj) { farObj.visible = false; lod.addLevel(farObj, far + radius, opt.hysteresis); } }
    return D;
  }

  // -- stats ---------------------------------------------------------------------------------------------------------------------------------
  function stats() {
    const out = { districts: {}, totals: { districts: 0, instances: 0, detailDrawCalls: 0, detailTriangles: 0, proxyDrawCalls: 0, proxyTriangles: 0, currentDrawCalls: 0, currentTriangles: 0,
      fallbackBoxes: 0, textures: textures.size, materials: palMats.size + (proxyMat ? 1 : 0) }, failedTypes: [], inexactEntries: 0, oversize: [], tableDrift: man ? man.drift.slice() : null };
    const failed = new Set();
    for (const P of placements) {
      out.inexactEntries += P.inexact || 0;
      for (const [id, D] of P.districts) {
        const lv = D.mode === "far" ? 1 : D.lod.levels.length > 1 ? D.lod.getCurrentLevel() : 0;
        const detailCalls = D.meshes.length, proxyCalls = D.far && D.far.isMesh ? 1 : 0;
        out.districts[out.districts[id] ? id + "#" + P.id : id] = { instances: D.instances, groups: D.groups, detailDrawCalls: detailCalls, detailTriangles: D.detailTris,
          proxyDrawCalls: proxyCalls, proxyTriangles: D.proxyTris, lod: lv === 0 ? "detail" : "far", radius: D.radius, centre: D.centre.slice(), fallbackBoxes: D.fallbackBoxes, failedTypes: Array.from(D.failedTypes) };
        const t = out.totals;
        t.districts++; t.instances += D.instances; t.detailDrawCalls += detailCalls; t.detailTriangles += D.detailTris; t.proxyDrawCalls += proxyCalls; t.proxyTriangles += D.proxyTris;
        t.currentDrawCalls += lv === 0 ? detailCalls : proxyCalls; t.currentTriangles += lv === 0 ? D.detailTris : D.proxyTris; t.fallbackBoxes += D.fallbackBoxes;
        for (const f of D.failedTypes) failed.add(f);
        if (D.radius > opt.maxDistrictRadius) out.oversize.push({ id, radius: D.radius });
      }
    }
    out.failedTypes = Array.from(failed);
    return out;
  }

  // -- misc ----------------------------------------------------------------------------------------------------------------------------------
  function setShadows(on) {
    shadowsOpt.value = on;
    for (const P of placements) for (const D of P.districts.values()) for (const it of D.meshes) it.mesh.castShadow = on === "auto" ? (it.type ? casts(it.type) : true) : !!on;
  }
  function setFarDistance(m) {
    opt.farDistance = m;
    for (const P of placements) for (const D of P.districts.values()) if (D.lod.levels.length > 1) D.lod.levels[1].distance = m + D.radius;
  }
  /** C-WARM: every object is in the scene when the warm-up runs (place() adds them), and ffg_warmup already forces LODs; nothing extra to offer. */
  function warmObjects() { return []; }

  function dispose() {
    if (disposed) return { geometries: 0, materials: 0, textures: 0, instancedMeshes: 0 };
    disposed = true;
    let g = 0, m = 0, t = 0, im = 0;
    const seenG = new Set();
    for (const P of placements) for (const D of P.districts.values()) {
      if (D.lod.parent) D.lod.parent.remove(D.lod);
      for (const it of D.meshes) if (it.mesh.isInstancedMesh) { it.mesh.dispose(); im++; }
      for (const geo of D.geometries) if (!seenG.has(geo)) { seenG.add(geo); geo.dispose(); g++; }
    }
    for (const mat of palMats.values()) { mat.dispose(); m++; }
    if (proxyMat) { proxyMat.dispose(); m++; }
    for (const tex of textures) { tex.dispose(); t++; }
    palMats.clear(); textures.clear(); texP.clear(); glb.clear(); glbP.clear(); placements.length = 0; proxyMat = null;
    return { geometries: g, materials: m, textures: t, instancedMeshes: im };
  }

  return {
    api: KIT_API, place, preload, dispose, stats, ready, warmObjects, setShadows, setFarDistance,
    colliderFor, footprintFor, typeIds, hasType, resolvePalette,
    get manifest() { return man; },
    get disposed() { return disposed; },
    get options() { return opt; },
  };
}
