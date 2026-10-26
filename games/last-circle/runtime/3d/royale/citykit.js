/**
 * citykit.js - the Last Circle city kit (world plan 2026-10, Wave 6, lane 6C; contract C-KIT).
 *
 * Places the CC0 town kit (assets/props/city/**, assets/props/cars/**: Kenney City Kit Suburban / Commercial / Roads, Car Kit, Furniture Kit, Graveyard Kit,
 * Quaternius props) as INSTANCED DISTRICTS with colliders that are exact axis-aligned boxes. Wired in Wave 7 (lane 7A): maps.js imports it DYNAMICALLY on
 * Savanna only, with the boot module's own ?v= query (`import("./citykit.js" + new URL(import.meta.url).search)`: a static relative import would drop the
 * query and serve stale JS after an edit), builds one kit per match (`W._cityKit`, disposed by disposeMapResources) and appends `place().colliders` to the map's.
 *
 *   import { createCityKit } from "./citykit.js";
 *   const kit = createCityKit({ THREE, kernel: W.kernel, assetBase: W.assetBase });          // or { W }; one kit per match
 *   const { meshes, colliders } = await kit.place(list, { parent: W.group("map"), districts: { "town:outpost": { theme: "city" } } });
 *   for (const c of colliders) map.colliders.push(c);                                         // already mkCollider-shaped, prop null, hp 0
 *   ...
 *   kit.dispose();                                                                            // from disposeMapResources: frees what a group traverse cannot
 *
 * list = [{ type, x, y, z, rot, scale?, district, palette? }, ...]
 *   type     a manifest id such as "suburban/building-type-a" (typeIds() lists the 136). Unknown types are skipped and reported in `skipped`.
 *            Wave 8 (stage A2, lane H5): the interior kit is merged - 55 furniture / wall types (Kenney Furniture Kit 2.0 + 3 Quaternius pieces, CC0) with exact
 *            colliders in COLLIDER_BOXES below: collider_mode "steps" (stairs: one box per tread, nothing to hide under), "none" (rugs, the pallet: nothing at body
 *            height, so colliderFor gives [] and the far / fallback box drawing skips them). Only the GLBs of the types a place() list DRAWS are fetched
 *            (place -> preload(drawn types)); a type no map places costs nothing but its manifest row.
 *   x y z    world metres of the footprint CENTRE at GROUND (the manifest origin). y is the pad height from lane 6A; the module never samples terrain.
 *   rot      an INTEGER is a quarter-turn index (rot * 90 degrees about +Y, as maps.js `Q.setFromAxisAngle(Y, ry)`; the authored front +Z faces +Z, +X, -Z,
 *            -X for 0, 1, 2, 3; quarterFacing(dx, dz) gives the index that faces a street); a NON-integer is radians; `ry` (radians) overrides `rot`.
 *            Only quarter turns give exact collider boxes. Any other angle still draws at that angle and its colliders become a staircase of <= 1 m
 *            strips (every point of the true box covered, nothing more than ~1 m outside it; counted in `stats().inexactEntries`).
 *   scale    uniform multiplier on the type's suggested_scale (default 1); colliders scale with it.
 *   sy       (Wave 7 completion) a VERTICAL-only stretch on top of scale (default 1): a skyline tower drawn 1.3-1.8x taller than it was modelled, same footprint; the
 *            colliders' y extents scale with it, x and z stay exact. A pure function of the entry like everything else.
 *   district a string id of ONE chunk (a town, a compound, a yard) - the unit of frustum culling, so keep it POI-sized (radius <= ~150 m): a camera inside a
 *            district draws every type of it even when looking away. One InstancedMesh per (type, palette) per district, each with its own COMPUTED
 *            bounding sphere (a map-wide instance never culls, maps.js:2003-2014). A missing id is chunked on a 96 m grid.
 *   palette  optional: a theme name (THEMES) or a variant: "base" | "slate" | "brick" | "sand" (the manifest's recoloured colormaps) or one of the Wave 7b theme colourways (resort: coral, mint,
 *            lagoon, sun, shell, rose; lodge: pine, cedar, walnut, driftwood, forest, barn; palettes[key].variants, VARIANT_ORDER). Entries of one district that
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
  "suburban/building-type-a": [-4.48,0,-2.552,-1.78,4.562,3.448,-1.78,0,-2.552,1.87,6.002,3.448,1.87,0,-2.552,4.52,4.562,3.448,-4.28,0,-3.702,-1.43,4.562,-2.602,1.52,0,-3.702,4.32,4.562,-2.602,1.42,0,-3.402,1.47,6.002,-2.602,-0.33,0,-2.652,-0.08,6.002,-2.602],
  "suburban/building-type-c": [-4.531,0,-2.552,-1.831,3.823,3.448,-1.831,0,-2.552,1.819,7.442,3.448,1.819,0,-2.552,4.469,6.002,3.448,1.469,0,-3.702,4.269,6.002,-2.602,1.369,0,-3.402,1.419,7.442,-2.602,-0.381,0,-2.652,-0.081,7.442,-2.602],
  "suburban/building-type-e": [-4.53,0,-2.551,4.52,8.19,3.449,-4.28,0,-3.701,-1.43,8.19,-2.601,1.52,0,-3.701,4.32,8.19,-2.601,1.42,0,-3.401,1.47,8.19,-2.601,-0.33,0,-2.651,-0.08,8.19,-2.601,-4.63,0,2.849,-4.58,8.19,2.999],
  "suburban/building-type-g": [-5.02,0,-2.041,4.03,5.31,3.959,1.48,0,-3.691,4.73,5.31,-0.441,-4.82,0,-3.141,-1.97,1.8,-2.091,1.08,0,-2.891,5.08,5.31,-1.241,2.23,0,-4.041,3.93,1.8,-3.741,0.88,0,-2.391,5.28,5.31,-1.791,1.28,0,-3.241,4.93,5.31,-0.941,2.78,0,-4.241,3.43,1.8,-4.091,1.93,0,-3.891,4.28,5.31,-0.291],
  "suburban/building-type-h": [-4.48,0,-2.998,4.52,5.31,3.052],
  "suburban/building-type-i": [-4.531,0,-2.551,-1.831,3.823,3.449,-1.831,0,-2.551,4.469,5.31,3.449,-1.431,0,-3.701,1.369,5.31,-2.601,2.519,0,-2.651,2.769,5.31,-2.601],
  "suburban/building-type-m": [-1.291,0,-3.941,4.909,5.31,4.859,-4.141,0,-1.141,-1.341,5.31,4.859,1.909,0,-5.141,4.709,5.31,-3.991,-5.141,0,-0.991,-4.191,1.8,1.859,-1.041,0,-4.091,0.359,5.31,-3.991,0.909,0,-4.041,4.809,5.31,-3.991,-1.341,0,4.859,-1.291,5.31,4.909],
  "suburban/building-type-o": [-4.572,0,-2.551,-1.922,3.096,3.449,-1.922,0,-2.551,4.428,8.19,3.449,-1.472,0,-3.701,1.328,6.365,-2.601,2.878,0,-2.651,3.178,6.365,-2.601],
  "suburban/building-type-p": [-1.564,0,-2.414,4.536,5.76,3.636,-1.364,0,-3.564,1.436,1.8,-2.464,-4.464,0,2.536,-3.414,6.12,3.636,-4.464,0,-2.464,-3.414,6.12,-1.414,2.986,0,-2.514,3.286,1.8,-2.464],
  "suburban/building-type-q": [-1.514,0,-2.988,4.536,5.76,3.012,-2.664,0,-2.838,-1.564,3.24,0.012,-1.214,0,3.062,-0.814,6.019,3.412,-4.314,0,2.512,-4.064,3.24,2.812,-4.314,0,-2.738,-4.064,3.24,-2.488,2.536,0,3.062,2.836,1.8,3.112],
  "commercial/building-a": [-4.802,0,-4.04,5.348,15.36,5.61,-0.802,0,-4.44,1.348,14.4,5.71,3.998,0,-4.44,5.248,15.36,5.71,-4.702,0,-4.44,-3.452,15.36,5.71,-3.402,0,5.66,3.948,15.36,5.71,-5.202,0,-3.79,-4.852,14.4,-3.29,2.298,0,-4.19,3.048,14.4,-4.09,-0.952,0,-4.19,1.498,15.36,-4.09,3.848,0,-4.24,5.348,15.36,-4.09,-4.802,0,-4.19,-3.302,15.36,-4.09],
  "commercial/building-c": [-4.802,0,-3.39,5.348,10.56,6.51,-0.702,0,-6.44,3.948,1.8,-4.74,-0.702,0,-4.74,3.948,9.6,6.61,-0.952,0,-4.24,4.698,10.08,6.61,-4.602,0,-3.54,-2.252,10.56,6.61,-5.302,0,-2.94,-4.852,9.6,-2.34,-0.852,0,-6.04,4.098,2.125,-4.29,-0.252,0,-6.54,3.448,1.8,-6.49,-1.352,0,-3.64,5.248,10.56,6.61,4.748,0,-3.94,4.998,10.56,-3.69,4.148,0,-4.49,4.448,10.56,-4.29,-2.202,0,6.56,-1.402,10.56,6.61],
  "commercial/building-e": [-9.84,0,-4.347,-0.24,5.76,5.503,-0.24,0,-4.347,9.91,10.56,5.503,5.76,0,-5.697,8.71,9.6,5.603,-8.89,0,-4.997,-5.44,5.28,6.103,-4.09,0,-4.997,-0.64,4.8,6.103,5.01,0,-4.997,9.41,9.6,5.603,-9.69,0,-4.597,-0.24,5.76,5.703,-0.24,0,-4.597,1.66,10.56,5.703,3.26,0,-4.597,9.81,10.56,5.603,4.06,0,-5.447,4.51,4.8,-5.047,5.36,0,-5.347,9.06,10.56,-5.047,0.36,0,-5.447,0.76,4.8,-5.047,1.71,0,-4.547,2.21,10.56,-4.397,2.56,0,5.553,3.01,10.56,5.653,-8.99,0,-4.747,-5.34,5.28,5.853,-4.19,0,-4.747,-0.54,4.8,5.853,4.86,0,-4.747,9.56,10.56,-4.647,5.66,0,-5.447,8.81,10.56,-5.397,5.26,0,-5.097,9.16,10.56,-5.047],
  "commercial/building-f": [-5.04,0,-3.98,5.11,20.16,5.67,0.16,0,-6.13,4.71,1.8,-4.88,0.16,0,-4.88,4.71,20.16,5.77,-0.99,0,-4.48,4.96,20.16,5.77,-4.94,0,-4.38,-3.69,20.16,5.77,0.01,0,-5.78,4.86,4.8,-4.53,-3.64,0,5.72,-1.04,20.16,5.77,-2.74,0,-4.13,-1.99,20.16,-4.03,-1.19,0,-4.18,5.11,20.16,-4.03,-5.04,0,-4.18,-3.54,20.16,-4.03],
  "commercial/building-h": [-4.802,0,-4.147,5.348,15.36,5.553,-1.402,0,-4.497,1.948,15.36,-4.197,-4.652,0,-4.547,-2.252,15.36,-4.197,3.398,0,-4.497,5.298,15.36,-4.197,-4.202,0,-5.447,-3.752,4.8,-5.047,4.348,0,-5.447,4.748,4.8,-5.047,-5.202,0,-3.847,-4.852,14.4,-3.347,-4.802,0,-4.297,2.098,15.36,-4.197,3.248,0,-4.247,3.348,15.36,-4.197],
  "commercial/building-i": [-7.44,0,-6.912,7.51,19.68,7.488,-3.44,0,-7.312,-1.29,19.68,7.638,1.36,0,-7.312,3.51,19.68,7.638,-7.34,0,-7.312,-6.09,20.16,7.638,6.16,0,-7.312,7.41,20.16,7.638,0.16,0,7.538,6.11,20.16,7.638,-6.04,0,7.538,-0.79,20.16,7.638,-0.34,0,-7.062,0.41,20.16,-6.962,-3.59,0,-7.062,-1.14,20.16,-6.962,1.21,0,-7.062,3.66,20.16,-6.962,-7.44,0,-7.062,-5.94,20.16,-6.962,6.01,0,-7.062,7.51,20.16,-6.962],
  "commercial/building-m": [-7.44,0,-7.052,7.51,34.2,7.348,-3.44,0,-7.452,-1.29,34.2,7.498,1.36,0,-7.452,3.51,34.2,7.498,-7.34,0,-7.452,-6.09,29.76,7.498,6.16,0,-7.452,7.41,29.76,7.498,-6.04,0,7.398,-0.79,29.76,7.498,0.86,0,7.398,6.11,29.76,7.498,-0.34,0,-7.202,0.41,29.76,-7.102,0.16,0,7.398,0.61,29.76,7.498,-3.59,0,-7.202,-1.14,29.76,-7.102,1.21,0,-7.202,3.66,29.76,-7.102,-7.44,0,-7.252,-5.94,29.76,-7.102,6.01,0,-7.202,7.51,29.76,-7.102],
  "skyscraper/building-skyscraper-a": [-7.46,0,-6.11,7.49,33.6,7.34,2.24,0,-7.46,7.39,34.56,7.49,-7.36,0,-7.46,-2.21,34.56,7.49,-2.16,0,-6.36,-0.71,33.6,7.49,0.84,0,-6.36,2.19,33.6,7.49,-7.46,0,-7.21,-2.11,34.56,-6.16,2.14,0,-7.21,7.49,34.56,-6.16,0.19,0,7.39,0.59,34.56,7.54,-0.66,0,-6.26,-0.21,33.6,-6.16],
  "skyscraper/building-skyscraper-b": [-7.46,0,-6.11,7.49,53.28,7.34,2.24,0,-7.46,7.39,53.76,7.49,-7.36,0,-7.46,-2.21,53.76,7.49,-2.16,0,-6.36,-0.71,52.8,7.49,0.84,0,-6.36,2.19,52.8,7.49,-7.46,0,-7.21,-2.11,53.76,-6.16,2.14,0,-7.21,7.49,53.76,-6.16,0.19,0,7.39,0.59,53.76,7.54,-0.66,0,-6.26,-0.21,52.8,-6.16],
  "skyscraper/building-skyscraper-c": [-7.43,0,-5.227,7.47,44.16,8.023,-7.38,0,-6.427,-2.03,44.16,8.123,2.07,0,-6.427,7.42,44.16,8.123,-3.48,0,-6.777,-2.18,44.16,-6.477,6.12,0,-6.777,7.42,44.16,-6.477,-7.38,0,-6.777,-6.08,44.16,-6.477,2.22,0,-6.777,3.52,44.16,-6.477,-1.98,0,-5.577,-1.28,48,8.123,1.32,0,-5.577,2.02,43.2,8.123,-2.03,0,-7.727,-1.63,4.8,-7.327,1.67,0,-7.727,2.07,4.8,-7.327,0.17,0,8.073,1.27,44.16,8.173,-0.33,0,-5.327,0.42,43.2,-5.277,-1.23,0,8.073,-0.78,44.16,8.123,-7.43,0,-6.527,-5.93,44.16,-6.427,3.57,0,-6.527,3.67,44.16,-6.477,6.02,0,-6.527,7.47,44.16,-6.427,-1.23,0,-5.327,-1.13,43.2,-5.277,-3.58,0,-6.527,-3.53,44.16,-6.477,1.22,0,-5.327,1.27,43.2,-5.277],
  "skyscraper/building-skyscraper-d": [-7.43,0,-5.227,7.47,62.4,8.023,-7.38,0,-6.427,-2.03,62.88,8.123,2.07,0,-6.427,7.42,63.36,8.123,-3.48,0,-6.777,-2.18,63.36,-6.477,6.12,0,-6.777,7.42,63.36,-6.477,-7.38,0,-6.777,-6.08,63.36,-6.477,2.22,0,-6.777,3.52,63.36,-6.477,-1.98,0,-5.577,-1.28,62.4,8.123,1.32,0,-5.577,2.02,62.4,8.123,-2.03,0,-7.727,-1.63,4.8,-7.327,1.67,0,-7.727,2.07,4.8,-7.327,0.17,0,8.073,1.27,63.36,8.173,-0.33,0,-5.327,0.42,62.4,-5.277,-1.23,0,8.073,-0.78,63.36,8.123,-7.43,0,-6.527,-5.93,63.36,-6.427,3.57,0,-6.527,3.67,63.36,-6.477,6.02,0,-6.527,7.47,63.36,-6.427,-1.23,0,-5.327,-1.13,62.4,-5.277,-3.58,0,-6.527,-3.53,63.36,-6.477,1.22,0,-5.327,1.27,62.4,-5.277],
  "skyscraper/building-skyscraper-e": [-7.12,0,-7.052,7.83,48.48,7.348,-3.12,0,-7.452,-0.97,48,7.498,1.68,0,-7.452,3.83,48.48,7.498,-7.02,0,-7.452,-5.77,48.96,7.498,6.48,0,-7.452,7.73,48.96,7.498,-5.72,0,7.398,-0.47,48.96,7.498,1.18,0,7.398,6.43,48.96,7.498,-0.02,0,-7.202,0.73,48.96,-7.102,0.53,0,7.398,0.93,48.96,7.498,-3.27,0,-7.202,-0.82,48.96,-7.102,1.53,0,-7.202,3.98,48.96,-7.102,-7.12,0,-7.202,-5.62,48.96,-7.102,6.33,0,-7.202,7.83,48.96,-7.102],
  "lowdetail/low-detail-building-a": [-3,0,-2.85,3.05,24,2.9,-2.85,0,-3,2.9,24,3.05],
  "lowdetail/low-detail-building-b": [-3,0,-2.9,-1.8,12,2.95,-1.8,0,-2.9,1.85,23.4,2.95,1.85,0,-2.9,3.05,12,2.95,-2.9,0,-3,2.95,12,-1.8,-2.9,0,-1.8,2.95,23.4,1.85,-2.9,0,1.85,2.95,12,3.05],
  "lowdetail/low-detail-building-g": [-2.5,0,-2.5,2.55,24,2.55,0.6,0,-2.95,3.05,24,-0.55,-2.95,0,0.6,-0.55,24,3.05,0.6,0,0.6,3,24,3.05,-2.95,0,-2.95,-0.55,24,-0.55],
  "lowdetail/low-detail-building-h": [-3,0,-2.85,3.05,25.2,2.9,-2.85,0,-3,2.9,25.2,3.05],
  "lowdetail/low-detail-building-wide-a": [-6,0,-2.85,6.05,13.2,2.9,-5.85,0,-3,5.9,13.2,3.05],
  "props/barrier-traffic": [-0.778,0,-0.14,0.822,0.805,0.16,-0.728,0,-0.24,-0.578,0.805,0.26,0.622,0,-0.24,0.772,0.805,0.26],
  "props/box-crate": [-0.465,0,-0.465,0.465,0.93,0.465],
  "props/cone-traffic": [-0.286,0,-0.286,0.286,0.714,0.286],
  "props/construction-barrier": [-0.472,0,-1.012,0.472,1.069,1.012],
  "props/crate-yard": [-0.481,0,-0.481,0.481,0.95,0.481],
  "props/dumpster": [-0.977,0,-0.518,0.977,1.592,0.518],
  "props/fence-suburban": [-1.187,0,-0.187,1.187,1.35,0.187],
  "props/grave-bench": [-0.726,0,-0.41,0.726,0.947,0.41],
  "props/hydrant": [-0.257,0.001,-0.183,0.257,0.773,0.217],
  "props/light-curved": [-0.225,0,-0.225,0.225,6.075,0.225],
  "props/light-curved-double": [-0.225,0,-0.225,0.225,6.075,0.225],
  "props/light-square": [-0.225,0,-0.225,0.225,5.4,0.225],
  "props/planter": [-0.6,0,-0.402,0.65,0.708,0.448,-0.5,0,-0.502,0.55,0.708,0.548],
  "props/shipping-container": [-3.008,0.042,-1.442,3.008,2.983,1.442],
  "cars/delivery": [-1.05,0,-2.64,1.15,1.689,2.56,-1.2,0,1.26,1.25,1.689,1.46],
  "cars/hatchback-sports": [-1.105,0,-2.365,1.145,1.197,2.335,-1.005,0,-2.465,1.045,1.197,2.435],
  "cars/police": [-1.125,0,-2.585,1.175,1.282,2.415,-0.825,0,2.465,0.875,1.282,2.665,-1.275,0,0.965,1.325,1.282,1.265],
  "cars/sedan": [-1.125,0,-2.16,1.175,1.282,2.14,-1.275,0,0.54,1.325,1.282,0.79],
  "cars/suv": [-1.125,0,-1.995,1.175,1.37,2.305,-0.525,0,-2.295,0.575,1.37,-2.045,-1.275,0,0.705,1.325,1.37,0.955],
  "cars/taxi": [-1.125,0,-2.33,1.175,1.377,2.32,-1.275,0,0.72,1.325,1.377,0.92],
  "cars/truck": [-1.125,0,-2.5,1.175,1.326,2.5,-1.275,0,0.9,1.325,1.326,1.1],
  "cars/van": [-1.125,0,-2.33,1.175,1.377,2.32,-1.275,0,0.87,1.325,1.377,1.12],
  "furniture/bathroomCabinet": [-0.253,0,-0.143,0.253,0.858,0.143],
  "furniture/bathroomSinkSquare": [-0.473,0,-0.33,0.473,1.276,0.33],
  "furniture/bathtub": [-1.309,0,-0.616,1.309,0.924,0.616],
  "furniture/bedDouble": [-1.052,0,-1.238,1.052,0.825,1.238],
  "furniture/bedSingle": [-0.628,0,-1.238,0.628,0.825,1.238],
  "furniture/bookcaseClosed": [0,0,-0.55,0.88,1.87,0],
  "furniture/bookcaseClosedDoors": [-0.44,0,-0.275,0.44,1.87,0.275],
  "furniture/bookcaseClosedWide": [-0.88,0,-0.275,0.88,1.738,0.275],
  "furniture/bookcaseOpen": [-0.44,0,-0.275,0.44,1.936,0.275],
  "furniture/bookcaseOpenLow": [-0.44,0,-0.275,0.44,0.88,0.275],
  "furniture/books": [-0.165,0,-0.104,0.165,0.229,0.104],
  "furniture/cabinetBed": [-0.293,0,-0.237,0.293,0.513,0.237],
  "furniture/cabinetBedDrawer": [-0.293,0,-0.239,0.293,0.579,0.239],
  "furniture/cabinetTelevision": [0,0,-0.55,1.76,0.682,0],
  "furniture/cardboardBoxClosed": [0,0,-0.468,0.468,0.618,0],
  "furniture/cardboardBoxOpen": [-0.409,0,-0.234,0.409,0.618,0.234],
  "furniture/chair": [0,0,-0.44,0.44,1.034,0],
  "furniture/chairCushion": [-0.22,0,-0.22,0.22,1.012,0.22],
  "furniture/chairDesk": [0,0,-0.692,0.737,1.337,0],
  "furniture/chairModernCushion": [-0.22,0,-0.22,0.22,1.012,0.22],
  "furniture/coatRackStanding": [-0.25,0,-0.1,0.3,1.694,0.15,-0.1,0,-0.25,0.15,1.694,0.3],
  "furniture/computerScreen": [-0.432,0,-0.114,0.432,0.647,0.114],
  "furniture/desk": [-0.022,0,-0.836,1.594,0.846,0.027],
  "furniture/deskCorner": [0.128,0,-1.072,1.128,0.846,1.128,-1.072,0,-1.072,0.078,0.846,-0.172],
  "furniture/dryer": [-0.429,0,-0.418,0.429,1.034,0.418],
  "furniture/hoodModern": [-0.223,0,-0.313,0.277,0.879,-0.013],
  "furniture/kitchenBar": [-0.473,0,-0.231,0.473,0.924,0.231],
  "furniture/kitchenBarEnd": [-0.112,0,-0.231,0.112,0.924,0.231],
  "furniture/kitchenCabinet": [-0.473,0,-0.495,0.473,0.99,0.495],
  "furniture/kitchenCabinetCornerInner": [-0.506,0,-0.506,0.506,0.99,0.506],
  "furniture/kitchenCabinetDrawer": [-0.473,0,-0.495,0.473,0.99,0.495],
  "furniture/kitchenCabinetUpper": [-0.473,0,-0.242,0.473,0.858,0.242],
  "furniture/kitchenFridge": [0,0,-0.62,0.946,2.024,0.022],
  "furniture/kitchenMicrowave": [-0.319,0,-0.253,0.319,0.396,0.253],
  "furniture/kitchenSink": [0,0,-0.99,0.946,1.078,0],
  "furniture/kitchenStove": [0,0,-0.99,0.946,0.99,0],
  "furniture/kitchenStoveElectric": [-0.473,0,-0.495,0.473,0.99,0.495],
  "furniture/lampRoundFloor": [-0.167,0,-0.193,0.233,1.892,0.257],
  "furniture/lampSquareCeiling": [-0.132,0,-0.132,0.132,0.506,0.132],
  "furniture/lampSquareFloor": [-0.132,0,-0.132,0.168,1.892,0.168],
  "furniture/lampSquareTable": [-0.132,0,-0.132,0.132,0.638,0.132],
  "furniture/lampWall": [-0.249,0,-0.165,0.249,0.204,0.165],
  "furniture/loungeChair": [-0.539,0,-0.451,0.539,1.012,0.451],
  "furniture/loungeDesignSofa": [-1.232,0,-0.451,1.232,0.88,0.451],
  "furniture/loungeSofa": [0,0,-0.902,2.156,1.012,0],
  "furniture/loungeSofaCorner": [0.122,0,-1.078,1.122,1.012,1.122,-1.078,0,-1.078,0.072,1.012,-0.128],
  "furniture/loungeSofaLong": [-1.078,0,-0.902,1.122,1.012,0.098,-0.028,0,0.148,0.972,1.012,0.948],
  "furniture/loungeSofaOttoman": [-0.484,0,-0.495,0.484,0.506,0.495],
  "furniture/pallet": [],
  "furniture/plantSmall1": [-0.104,0,-0.104,0.104,0.308,0.104],
  "furniture/pottedPlant": [-0.233,0,-0.266,0.233,1.439,0.266],
  "furniture/rugRectangle": [],
  "furniture/rugRound": [],
  "furniture/rugSquare": [],
  "furniture/shelfLarge": [-0.061,0,-0.17,0.389,1.997,0.18,-0.761,0,-0.17,-0.661,1.997,0.18,0.739,0,-0.17,0.789,1.997,0.18],
  "furniture/shelfTall": [-0.658,0,-0.259,0.658,1.988,0.259],
  "furniture/sideTable": [-0.022,0,-0.462,1.154,0.846,0.022],
  "furniture/sideTableDrawers": [-0.588,0,-0.245,0.588,0.846,0.245],
  "furniture/stoolBar": [0,0,-0.506,0.584,0.957,0],
  "furniture/table": [0,0,-0.984,1.851,0.719,0],
  "furniture/tableCloth": [-0.926,0,-0.492,0.926,0.719,0.492],
  "furniture/tableCoffee": [-1.014,0,-0.66,0.44,0.506,0.22],
  "furniture/tableCoffeeSquare": [-0.44,0,-0.44,0.44,0.506,0.44],
  "furniture/tableCross": [-0.937,0,-0.492,0.937,0.764,0.492],
  "furniture/tableRound": [-0.762,0,-0.58,0.838,0.807,0.62,-0.312,0,-0.83,0.388,0.807,0.87],
  "furniture/televisionModern": [-0.753,0,-0.141,0.753,1,0.141],
  "furniture/toilet": [-0.344,0,-0.525,0.344,0.992,0.525],
  "furniture/trashcan": [-0.229,0,-0.246,0.229,0.941,0.269],
  "walls/doorway": [0,0,-0.223,1.1,2.25,0.027],
  "walls/doorwayFront": [0,0,-0.223,1.1,2.25,0.027],
  "walls/doorwayOpen": [0,0,-0.196,0.1,2.25,0,1,0,-0.196,1.1,2.25,0,0.1,2.15,-0.196,1,2.25,0],
  "walls/floorCorner": [0,0,-1.21,1.21,0.11,0],
  "walls/floorCornerRound": [0,0,-1.21,1.21,0.11,0],
  "walls/floorFull": [0,0,-2.2,2.2,0.11,0],
  "walls/floorHalf": [0,0,-2.2,1.1,0.11,0],
  "walls/paneling": [0,0,0,1.1,1.308,0.066],
  "walls/stairs": [0,0,-1.738,0.361,0.268,0,0.361,0,-1.738,0.721,0.536,0,0.721,0,-1.738,1.082,0.804,0,1.082,0,-1.738,1.443,1.071,0,1.443,0,-1.738,1.803,1.34,0,1.803,0,-1.738,2.164,1.608,0,2.164,0,-1.738,2.569,1.875,0,2.569,0,-1.738,2.886,2.143,0,2.886,0,-1.738,3.246,2.411,0,3.246,0,-1.738,3.607,2.679,0,3.607,0,-1.738,4.012,2.947,0],
  "walls/stairsCorner": [0.361,0,-1.738,0.721,0.268,0,0.721,0,-1.738,1.082,0.536,0,1.082,0,-1.738,1.443,0.804,0,1.443,0,-1.738,1.803,1.071,0,1.803,0,-1.738,2.164,1.34,0,2.164,0,-1.738,2.525,1.608,0,2.525,0,-1.65,4.263,1.875,0,2.525,0,-2.011,4.263,2.143,-1.65,2.525,0,-2.371,4.263,2.411,-2.011,2.525,0,-2.732,4.263,2.679,-2.371,2.525,0,-3.137,4.263,2.947,-2.732],
  "walls/wall": [0,0,-0.11,2.2,2.837,0],
  "walls/wallCorner": [1,0,-1.21,1.25,2.837,-0.01,0,0,-0.11,1,2.837,0.04],
  "walls/wallCornerRond": [0,0,-0.21,1.25,2.837,0.04,1.1,0,-1.21,1.25,2.837,-0.26],
  "walls/wallDoorway": [0,0,-0.153,0.7,2.9,0.043,1.55,0,-0.153,2.25,2.9,0.043,0.7,2.15,-0.153,1.55,2.9,0.043],
  "walls/wallDoorwayWide": [0,2.15,-0.153,2.25,2.9,0.043,0,0,-0.153,0.2,2.15,0.043,2.05,0,-0.153,2.25,2.15,0.043],
  "walls/wallHalf": [0,0,-0.11,1.1,2.837,0],
  "walls/wallWindow": [0,0,-0.153,2.2,2.837,0.043],
  "walls/wallWindowPort": [0,0,-0.153,2.2,1.2,0.043,0,1.2,-0.153,0.796,2.837,0.043,1.404,1.2,-0.153,2.2,2.837,0.043,0.796,2.3,-0.153,1.404,2.837,0.043],
  "walls/wallWindowSlide": [0,0,-0.153,2.2,2.837,0.043]
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
const VARIANT_ORDER = ["base", "slate", "brick", "sand", "coral", "mint", "lagoon", "sun", "shell", "rose", "pine", "cedar", "walnut", "driftwood", "forest", "barn"];
/** [wall, roof] per type for the theme variants, in VARIANT_ORDER order after the four shipped ones (the far proxy / box fallback; see art_b_city.py proxy_colours) */
const PROXY_COLORS_X = Object.freeze({
  "suburban/building-type-a": [0xc89584, 0xc26b51, 0x84b3ae, 0x3f8c92, 0x80a6bf, 0x4972a9, 0xd3ad85, 0xd87d50, 0xa5bcbf, 0xbac6c9, 0xc3918f, 0xb75f4e, 0x5b573d, 0x43624a, 0x563c2d, 0x5e4535, 0x623f30, 0x874635, 0x5c5b57, 0x565b60, 0x737463, 0x725a47, 0x846c66, 0x616465],
  "suburban/building-type-c": [0xcb9989, 0xc36a51, 0x8db7b1, 0x3d8d94, 0x87acc1, 0x4772ac, 0xd4b38a, 0xdb7d50, 0xa9bcbf, 0xbbc7cc, 0xc69697, 0xb85e4e, 0x63573c, 0x405f48, 0x593a2c, 0x5b4132, 0x613e2e, 0x864333, 0x605c56, 0x53595f, 0x727563, 0x715847, 0x896962, 0x5f6365],
  "suburban/building-type-e": [0xcba598, 0xc27058, 0x9cbdb8, 0x479096, 0x97b5c5, 0x5177ac, 0xd1ba98, 0xd88157, 0x94b3b9, 0xb3c2c7, 0xc7a3a4, 0xb86555, 0x5d5139, 0x425d47, 0x52382c, 0x5a4132, 0x583d2f, 0x824333, 0x5c5851, 0x54585c, 0x818574, 0x765f4d, 0x967d74, 0x666969],
  "suburban/building-type-g": [0xc59e8e, 0xc16e53, 0x8eb7b1, 0x4b8c8e, 0x8aadbf, 0x5474a2, 0xccb28e, 0xd57e52, 0x97b5b8, 0xbac0bf, 0xc09b98, 0xb66350, 0x5a543b, 0x4f664d, 0x523b2d, 0x674c39, 0x5b3f30, 0x8c4d3a, 0x5a5a53, 0x606060, 0x7a7e6d, 0x795f4a, 0x8c786f, 0x696864],
  "suburban/building-type-h": [0xcc9a8b, 0xb36e5a, 0x8eb7b3, 0x4f8c92, 0x8aabc2, 0x5a7ba6, 0xd4b28c, 0xc8805a, 0xa2b9be, 0xbdbdc3, 0xc69797, 0xaa6458, 0x5d533a, 0x415541, 0x55382b, 0x523e30, 0x603b2d, 0x854331, 0x5d5854, 0x525057, 0x797868, 0x755545, 0x8c716a, 0x5b5d60],
  "suburban/building-type-i": [0xc79382, 0xc2654c, 0x84b0ac, 0x368991, 0x81a4bd, 0x416daa, 0xd1ab83, 0xdb794a, 0xa7babd, 0xbfc9cd, 0xc18f8d, 0xb65848, 0x5c563c, 0x3f614a, 0x563a2c, 0x5c4233, 0x643e2e, 0x894333, 0x5d5a55, 0x535a61, 0x747160, 0x6d5342, 0x836b64, 0x5a5f61],
  "suburban/building-type-m": [0xc89e8e, 0xc56c52, 0x92b8b2, 0x419095, 0x8daec0, 0x4975ad, 0xceb48f, 0xdb8151, 0x9db6ba, 0xc2cbce, 0xc29b9a, 0xba5f51, 0x5e543a, 0x4a654c, 0x543a2c, 0x624535, 0x5d3e2f, 0x884635, 0x5d5a53, 0x5a5f64, 0x797c6a, 0x6c5745, 0x8d736b, 0x615e5f],
  "suburban/building-type-o": [0xcaaa9c, 0xc28a77, 0xa5c1ba, 0x6fa0a3, 0x9ebbc6, 0x7590b2, 0xcebf9e, 0xd09676, 0x95b3b7, 0x97b3b9, 0xc6a9ab, 0xbb8377, 0x624f37, 0x455340, 0x50372a, 0x523e31, 0x553c2e, 0x714334, 0x5d584f, 0x535353, 0x7f8574, 0x8a7967, 0x987b71, 0x81827d],
  "suburban/building-type-p": [0xafb4af, 0xc7c2b9, 0xc4bdb6, 0xc5c5c1, 0xc1c9ba, 0xc5c5c2, 0xb0c1b1, 0xc5c2b8, 0x889aa1, 0x528e9b, 0xb0b6b9, 0xc5c2bd, 0x5b3e2d, 0x402d1f, 0x40362c, 0x34261c, 0x564130, 0x403024, 0x584840, 0x443b30, 0x988e7f, 0xb4ae9d, 0x9b877d, 0xbcb6a5],
  "suburban/building-type-q": [0xaeb1aa, 0xd5d1c9, 0xc3bcb2, 0xd3d3cf, 0xbec8b7, 0xd3d3d0, 0xafc0ad, 0xd3d1c9, 0x929da1, 0x599aa8, 0xaeb3b5, 0xd3d1cc, 0x60402d, 0x453122, 0x42372a, 0x38291f, 0x58412e, 0x453527, 0x5b4a40, 0x4a4034, 0x918777, 0xc4beab, 0x967d72, 0xccc5b3],
  "commercial/building-a": [0xb7afaa, 0x79a4a5, 0xc2c2b8, 0xd3a399, 0xbbc7bd, 0xd5c193, 0xbbc3ab, 0x7eaaac, 0x7facb5, 0x559bac, 0xb6b1b9, 0x81aaaa, 0x553e2a, 0x463020, 0x452d22, 0x37241b, 0x433227, 0x3d2d21, 0x554c42, 0x4b4238, 0x868e7f, 0x828a79, 0xa07e73, 0x98786d],
  "commercial/building-c": [0xd3b7ae, 0x82a5a2, 0xbbd0c7, 0xd1a397, 0xb0cacf, 0xd4bf92, 0xd8cfaf, 0x86aaa8, 0x8bb1b7, 0x609ca7, 0xd0b8c0, 0x89aaa6, 0x5a432d, 0x523a28, 0x493024, 0x442f22, 0x463529, 0x493729, 0x575045, 0x564a3d, 0x8d9685, 0x8a8e7a, 0xa7877b, 0x9e7e6f],
  "commercial/building-e": [0xd3b8b0, 0x79a3a4, 0xbdcfc9, 0xcfa198, 0xb4cad0, 0xd3c094, 0xd7ceb1, 0x7ea9aa, 0x86aeb6, 0x5a9fb1, 0xd0b9c1, 0x80a8a7, 0x59412d, 0x483323, 0x492f24, 0x3a261c, 0x473529, 0x412e22, 0x564e45, 0x4d443a, 0x93998a, 0x818978, 0xab8d82, 0x97776c],
  "commercial/building-f": [0xbab0ab, 0xd5d1cb, 0xbdc3bb, 0xd7d8d4, 0xb6c5c0, 0xd5d4d1, 0xbfc3ab, 0xdad6cd, 0x80acb5, 0x5b9caa, 0xb9b1b9, 0xd5d3d2, 0x58422f, 0x463223, 0x483026, 0x392a1f, 0x47362b, 0x483628, 0x565047, 0x4b4135, 0x889182, 0xccc5b1, 0xa18278, 0xcdc6b5],
  "commercial/building-h": [0x9eabab, 0xd1c4bf, 0xc9b5ad, 0xc6cfcf, 0xc7c5ae, 0xc4c9ce, 0xa2b8ac, 0xd9ccc0, 0x6ba4b2, 0x5e9cae, 0xa0aeb3, 0xd0c5c6, 0x4d3827, 0x3f3022, 0x3f2a21, 0x36251c, 0x423126, 0x483024, 0x50483f, 0x453d35, 0x888f80, 0xc2b8a7, 0x9e8076, 0xc0baad],
  "commercial/building-i": [0xbdb2ad, 0x8aaaa8, 0xc2c4bc, 0xd3aca1, 0xbbc7c0, 0xd4c69e, 0xc1c5ae, 0x8db3ae, 0x7ca9b2, 0x61a3b1, 0xbcb4bb, 0x90afaf, 0x59412d, 0x4d3523, 0x483025, 0x3d281c, 0x48362a, 0x413023, 0x584f45, 0x50463b, 0x909787, 0x858d7b, 0xa8887d, 0x9e7c6f],
  "commercial/building-m": [0xc5b3ad, 0x9da7a2, 0xbec8c0, 0xbdaea9, 0xb6c7c6, 0xbebbab, 0xc9c8ae, 0xa5b1a6, 0x82acb5, 0x68a3b2, 0xc3b4bd, 0xa1a9a7, 0x59412c, 0x463625, 0x482e23, 0x3c281e, 0x463429, 0x473023, 0x574e44, 0x4b443c, 0x8d9585, 0x8c8d7c, 0xa7867b, 0x9b847a],
  "skyscraper/building-skyscraper-a": [0xacb0b6, 0xabb5b0, 0xb6bdc1, 0xd0beb4, 0xb1c3c7, 0xcdceb7, 0xafc0b9, 0xaec3b4, 0x84b0c4, 0x72acb8, 0xacb1c1, 0xacb6b8, 0x6a5d57, 0x573d28, 0x5a4c4f, 0x452b1f, 0x575052, 0x463325, 0x66686c, 0x564c41, 0x829493, 0x8b9381, 0x9c8488, 0xa78376],
  "skyscraper/building-skyscraper-b": [0xb1b1ba, 0xbebeb7, 0xb0bfc8, 0xd2c9c0, 0xaac2cf, 0xced3c4, 0xb3c2bd, 0xc0ccba, 0x89b2c8, 0x77afbb, 0xafb2c6, 0xbdbec0, 0x6f6765, 0x593f29, 0x60555d, 0x472c20, 0x5d595f, 0x493426, 0x6b7078, 0x584e43, 0x83979b, 0x959c89, 0x9b8891, 0xb08e81],
  "skyscraper/building-skyscraper-c": [0xc1c2c5, 0xb5bab4, 0xc8ced0, 0xd1c4ba, 0xc3d4d5, 0xced0be, 0xc2d0c6, 0xb8c7b7, 0x93bfcf, 0x72acb9, 0xc1c4cf, 0xb5bbbc, 0x73675f, 0x563d28, 0x665858, 0x452c1f, 0x655d5c, 0x483426, 0x727373, 0x564d42, 0x98a5a1, 0x939987, 0xaf9999, 0xad8c7f],
  "skyscraper/building-skyscraper-d": [0xc7c6ca, 0xc8c3bb, 0xc7d2d6, 0xd3cec6, 0xc3d6dc, 0xcfd6cb, 0xc7d3cc, 0xc9d1bd, 0x95c0d1, 0x77afbc, 0xc6c8d5, 0xc5c2c3, 0x786f6a, 0x593f29, 0x6b6063, 0x472d20, 0x6a6566, 0x4a3527, 0x77797c, 0x584e43, 0x9eacab, 0x9ca18f, 0xb3a1a3, 0xb59688],
  "skyscraper/building-skyscraper-e": [0xceb1a8, 0x84a7a7, 0xb3cac4, 0xd2aa9f, 0xaac8cf, 0xd3c79d, 0xd1cbaa, 0x87b2ae, 0xa0bec5, 0x69aab9, 0xcab1bc, 0x8aacae, 0x785e46, 0x523926, 0x634338, 0x40291e, 0x5b463b, 0x423024, 0x6e6961, 0x534a3f, 0x7d8c7f, 0x7c8876, 0xa47871, 0x9a7266],
  "lowdetail/low-detail-building-a": [0xe7b29f, 0xf3b8a6, 0xb4d9ca, 0xbae2d2, 0xa3cfda, 0xa8dae5, 0xe9d9a4, 0xf5e2a8, 0xbed0cd, 0xcfddd9, 0xe1b2bb, 0xebb7c1, 0x8a653f, 0xa07649, 0x6d3f2c, 0x7f4933, 0x5d412e, 0x684833, 0x786f60, 0x877d6d, 0x6c806d, 0x6e856f, 0xa46357, 0xad6255],
  "lowdetail/low-detail-building-b": [0xe6a68f, 0xf6c0af, 0xa6d3c1, 0xc2e7d8, 0x90c7d5, 0xb2dfe9, 0xe8d494, 0xf7e6b1, 0xd6dad3, 0xc4dad8, 0xdfa5b2, 0xeebfc8, 0x936d43, 0x986f46, 0x77432f, 0x784631, 0x5e422f, 0x654732, 0x7f7566, 0x827868, 0x536d58, 0x7c907a, 0x93473c, 0xb57163],
  "lowdetail/low-detail-building-g": [0xe8a993, 0xe6aa93, 0xa9d6c4, 0xa9d4c3, 0x94cad7, 0x98cdd9, 0xe9d698, 0xe9d699, 0xd5dbd4, 0xd0d7d1, 0xe1a9b5, 0xe1a9b5, 0x89653f, 0x9f7147, 0x6e3f2b, 0x7d4731, 0x583e2c, 0x644531, 0x776d5f, 0x83796a, 0x556d5a, 0x5b755f, 0x924b40, 0x9d4f43],
  "lowdetail/low-detail-building-h": [0xe5ac97, 0xf2ad9a, 0xadd5c5, 0xaddecb, 0x9accd8, 0x98d4e1, 0xe9d79c, 0xf4df9c, 0xc8d3ce, 0xe3e6dd, 0xdfacb6, 0xe8acb9, 0x906a42, 0xb08251, 0x73422e, 0x8c4f37, 0x5e422f, 0x6e4c35, 0x7b7263, 0x918776, 0x617764, 0x57745d, 0x9c564a, 0xa34b40],
  "lowdetail/low-detail-building-wide-a": [0xe8b8a5, 0xefb9a8, 0xb8d9cb, 0xb8decf, 0xa8d0da, 0xa8d6e0, 0xe8d8a8, 0xf0dea8, 0xb5cbcb, 0xc4d6d3, 0xe2b8c0, 0xe7b8c1, 0x835f3c, 0x976f45, 0x683d2b, 0x784531, 0x5a3f2d, 0x644631, 0x73695b, 0x807667, 0x758674, 0x708570, 0xa96e63, 0xac685e]
});
const FALLBACK_COLORS = Object.freeze({           // [wall, roof] by kind when a type has no sampled colours (props, cars, a failed manifest)
  building: [0xb4b8c4, 0x6a6e7a], prop: [0x8a8f99, 0x8a8f99], car: [0x6f7f95, 0x4d596b], furniture: [0x9a8468, 0x9a8468], wall: [0xc8c2b4, 0xc8c2b4],
});

/** O2 themes (city / resort / lodge / farm / ruin / mill): a recoloured colormap per building palette plus a tint multiplied on top (no new texture). */
export const THEMES = Object.freeze({
  // The tint multiplies the colormap in LINEAR light (material.color * texel), so 0x9a948a (sRGB 0.6) darkens to a third of the brightness: keep tints near white.
  city:   Object.freeze({ variant: Object.freeze({ suburban: "brick", commercial: "base" }),  tint: 0xffffff }),
  resort: Object.freeze({ variant: Object.freeze({ suburban: "coral", commercial: "coral" }), tint: 0xffffff }),
  lodge:  Object.freeze({ variant: Object.freeze({ suburban: "pine", commercial: "pine" }), tint: 0xffffff }),
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
    house: ["suburban/building-type-g", "suburban/building-type-h", "suburban/building-type-i", "suburban/building-type-m", "suburban/building-type-p", "suburban/building-type-q"],
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

/** One manifest box -> a world box at an exact quarter turn q about +Y (x' = x cos + z sin, z' = -x sin + z cos), scaled by k (and by sy, the vertical stretch, on Y only), at (x, y, z). */
function pushQuarter(out, T, o, x, y, z, k, q, sy) {
  const x0 = T[o] * k, y0 = T[o + 1] * k * sy, z0 = T[o + 2] * k, x1 = T[o + 3] * k, y1 = T[o + 4] * k * sy, z1 = T[o + 5] * k;
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
function pushStrips(out, T, o, x, y, z, k, ry, seg, sy) {
  const x0 = T[o] * k, y0 = T[o + 1] * k * sy, z0 = T[o + 2] * k, x1 = T[o + 3] * k, y1 = T[o + 4] * k * sy, z1 = T[o + 5] * k;
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
function pushColliders(out, type, x, y, z, k, R, seg, sy) {
  const T = COLLIDER_BOXES[type];
  sy = sy === undefined ? 1 : sy;
  if (R.exact) for (let o = 0; o < T.length; o += 6) pushQuarter(out, T, o, x, y, z, k, R.q, sy);
  else for (let o = 0; o < T.length; o += 6) pushStrips(out, T, o, x, y, z, k, R.ry, seg, sy);
}
/** The colliders of one placed instance (pure; usable in Node without THREE). rot: quarter-turn index or radians (see resolveRotation). */
export function colliderFor(type, x, y, z, rot, scale, sy) {
  if (!hasType(type)) throw new Error("citykit.colliderFor: unknown type " + JSON.stringify(type));
  const k = scale === undefined || scale === null ? 1 : +scale;
  if (!(k > 0) || !isFinite(k)) throw new Error("citykit.colliderFor: bad scale " + scale);
  const ky = sy === undefined || sy === null ? 1 : +sy;                  // (Wave 7 completion: `sy` = a vertical-only stretch, a skyline tower taller than it was modelled; x and z stay exact)
  if (!(ky > 0) || !isFinite(ky)) throw new Error("citykit.colliderFor: bad vertical stretch " + sy);
  if (!isFinite(x) || !isFinite(y) || !isFinite(z)) throw new Error("citykit.colliderFor: non-finite position");
  const out = [];
  pushColliders(out, type, +x, +y, +z, k, resolveRotation(rot), DEFAULTS.chainSegment, ky);
  return out;
}
/** The XZ footprint (and height) the colliders of one instance cover: the union AABB. Lets a town generator fit a lot before placing. */
export function footprintFor(type, x, z, rot, scale, sy) {
  const cs = colliderFor(type, x, 0, z, rot, scale, sy);
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
  const sy = e.sy === undefined || e.sy === null ? 1 : +e.sy;
  if (!(sy > 0) || !isFinite(sy)) return { i, type: e.type, bad: "bad vertical stretch" };
  const R = resolveRotation(e.rot, e.ry);
  if (!isFinite(R.ry)) return { i, type: e.type, bad: "bad rotation" };
  let tint = null;                                     // Wave 7 polish: a car's paint (sRGB 0xrrggbb, or "#rrggbb"); read by the drawing only, never by a collider
  if (e.tint !== undefined && e.tint !== null) { const v = typeof e.tint === "string" ? parseInt(e.tint.replace("#", ""), 16) : +e.tint; if (Number.isFinite(v)) tint = (v >>> 0) & 0xffffff; }
  return { i, type: e.type, x, y, z, k, sy, q: R.q, ry: R.ry, exact: R.exact, district: e.district == null ? null : String(e.district), palette: e.palette == null ? null : String(e.palette), tint };
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
    const bldg = pal.key === "suburban" || pal.key === "commercial";
    const det = tex && bldg ? await detailTexture() : null;
    if (palMats.has(id)) return palMats.get(id);
    const m = new THREE.MeshStandardMaterial({ map: tex || null, roughness: 1, metalness: 0, side: double ? THREE.DoubleSide : THREE.FrontSide });
    m.color.setHex(tex ? pal.tint : 0xb4b8c4);
    m.name = "citykit:" + id;
    if (tex && (bldg || pal.key === "car")) installSurfaceMap(m, tex, pal.key === "car" ? "car" : "building");
    if (pal.key === "car") installCarPaint(m);
    else if (det) installFacadeDetail(m, det);
    palMats.set(id, m);
    return m;
  }
  // -- surfaces (parity P2-I, LC-17) ---------------------------------------------------------------------------------------------------------
  // The audit: every kit surface was roughness 1 / metalness 0 - the windows of a tower as matte as its concrete, a car body as dull as its tyres, so the IBL (maps.js
  // scene.environment) had nothing to show. installSurfaceMap reads the palette's own colormap once (the swatches are flat 64 px cells) and writes a 128 x 128
  // roughness (G) / metalness (B) map beside it, by what each swatch IS:
  //   building  glass (pale blue, saturation 0.12-0.7, value >= 0.5): rough 0.14 | white / pale trim: 0.62 | the darkest greys (frames, rails): 0.5, metal 0.45 | the rest 0.9
  //   car       the saturated body swatches: rough 0.32, metal 0.25 (citykit's car paint recolours them; the paint stays glossy) | glass: 0.08 | light greys (chrome,
  //             rims, lamps): 0.3, metal 0.6 | near-black (tyres, trim): 0.86 | the rest 0.6
  // A map, not a program per swatch: one extra texture fetch, the material's own program (compiled by the warm-up with the kit). Node / no canvas: untouched.
  const surfCache = new Map();
  function surfaceMapFor(tex, kind) {
    const img = tex && tex.image, key = (tex && tex.uuid) + ":" + kind;
    if (surfCache.has(key)) return surfCache.get(key);
    let out = null;
    try {
      if (typeof document !== "undefined" && img && img.width > 0) {
        const N = Math.min(128, img.width), cv = document.createElement("canvas"); cv.width = cv.height = N;
        const g = cv.getContext("2d");
        g.imageSmoothingEnabled = false;
        g.drawImage(img, 0, 0, N, N);
        const src = g.getImageData(0, 0, N, N), d = src.data, o = g.createImageData(N, N), od = o.data;
        let any = 0;
        for (let i = 0; i < N * N; i++) {
          const r = d[i * 4] / 255, gg = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), s = mx > 1e-6 ? (mx - mn) / mx : 0;
          let hue = 0;
          if (mx - mn > 1e-6) hue = mx === r ? 60 * (((gg - b) / (mx - mn)) % 6) : mx === gg ? 60 * ((b - r) / (mx - mn) + 2) : 60 * ((r - gg) / (mx - mn) + 4);
          if (hue < 0) hue += 360;
          const glass = hue >= 195 && hue <= 235 && s >= 0.12 && s <= 0.7 && mx >= 0.5;
          let ro = 0.9, me = 0;
          if (kind === "car") {
            if (glass) ro = 0.08; else if (s > 0.55 && mx > 0.25) { ro = 0.32; me = 0.25; } else if (s < 0.15 && mx > 0.55) { ro = 0.3; me = 0.6; } else if (mx < 0.2) ro = 0.86; else ro = 0.6;
          } else if (glass) ro = 0.14;
          else if (s < 0.1 && mx > 0.88) ro = 0.62;
          else if (s < 0.15 && mx < 0.3 && mx > 0.08) { ro = 0.5; me = 0.45; }
          if (ro !== 0.9 || me) any++;
          od[i * 4] = 255; od[i * 4 + 1] = Math.round(ro * 255); od[i * 4 + 2] = Math.round(me * 255); od[i * 4 + 3] = 255;
        }
        if (any) {
          g.putImageData(o, 0, 0);
          const t = new THREE.CanvasTexture(cv);
          t.flipY = false; t.colorSpace = THREE.NoColorSpace; t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
          t.name = "citykit:surface:" + kind + ":" + (tex.name || ""); t.needsUpdate = true;
          textures.add(t);
          out = t;
        }
      }
    } catch (e) { warn("surface map failed:", e && e.message || e); out = null; }
    surfCache.set(key, out);
    return out;
  }
  function installSurfaceMap(m, tex, kind) {
    const sm = surfaceMapFor(tex, kind);
    if (!sm) return;
    m.roughnessMap = sm; m.metalnessMap = sm; m.roughness = 1; m.metalness = 1;
  }
  // Facade detail (LC-17): the kit's colormaps are flat swatches - a 40 m tower face is one colour. A CC0 photographic plaster (assets/tex/facade_detail.jpg, Poly Haven,
  // greyscale, mean 0.5, low frequencies removed) multiplies the albedo of every building swatch that is not glass or trim (the surface map's roughness >= 0.75), projected
  // in WORLD space on the face's dominant plane at two scales (2.6 m and 9 m), faded out from 40 to 120 m (no shimmer at range). One shared texture and uniform for every
  // building palette: no draw call; the program is the material's own (customProgramCacheKey), compiled in the warm frame. setDetail(0) (the low tier) turns it off
  // without a recompile.
  const DETAIL_PATH = "../../tex/facade_detail.jpg";
  const detailU = { value: env.detail != null ? +env.detail : 0.62 };
  let detailP = null;
  function detailTexture() {
    if (detailP) return detailP;
    const pf = { file: DETAIL_PATH, sampler: "LINEAR/LINEAR_MIPMAP_LINEAR" };
    detailP = loadTexture(pf).then((t) => { if (t) { t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; } return t; });
    return detailP;
  }
  function installFacadeDetail(m, det) {
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tLcDetail = { value: det };
      sh.uniforms.uLcDetail = detailU;
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vLcW;\nvarying vec3 vLcN;")
        .replace("#include <worldpos_vertex>", `#include <worldpos_vertex>
{
  vec4 lcW = vec4(transformed, 1.0);
  vec3 lcN = objectNormal;
#ifdef USE_INSTANCING
  lcW = instanceMatrix * lcW;
  lcN = mat3(instanceMatrix) * lcN;
#endif
  vLcW = (modelMatrix * lcW).xyz;
  vLcN = mat3(modelMatrix) * lcN;
}`);
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", "#include <common>\nuniform sampler2D tLcDetail;\nuniform float uLcDetail;\nvarying vec3 vLcW;\nvarying vec3 vLcN;")
        .replace("#include <map_fragment>", `#include <map_fragment>
{
  vec3 lcN = normalize(vLcN), lcA = abs(lcN);
  vec2 lcUv = lcA.y > 0.6 ? vLcW.xz : (lcA.x > lcA.z ? vLcW.zy : vLcW.xy);
  float lcF = uLcDetail * (1.0 - smoothstep(40.0, 120.0, distance(cameraPosition, vLcW)));
#ifdef USE_ROUGHNESSMAP
  lcF *= smoothstep(0.7, 0.85, texture2D(roughnessMap, vRoughnessMapUv).g);
#endif
  float lcD = texture2D(tLcDetail, lcUv * 0.3846).r * 1.2 + texture2D(tLcDetail, lcUv * 0.1111 + 0.37).r * 0.8;
  diffuseColor.rgb *= mix(1.0, clamp(lcD, 0.5, 1.55), lcF);
}`);
    };
    m.customProgramCacheKey = () => "citykit-facade-detail";
  }
  // Car paint (Wave 7 polish). The Kenney car palette paints every model in ONE saturated swatch (green sedans, red hatchbacks, ...), which in a street of 20 parked cars
  // is a toy shop. Every car InstancedMesh carries an instance colour (white = untouched): where the texel is a saturated body swatch (HSV saturation > ~0.65) it is replaced
  // by that colour scaled by the texel's own luminance (the swatch's light-to-dark gradient survives), while glass, tyres, greys, whites and the lamps' pale tones keep the
  // texture. Same material, same program for every car in the kit: no extra draw call, one extra program variant (instancing colour) compiled in the warm frame.
  function installCarPaint(m) {
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace("#include <color_fragment>", `
#if defined( USE_COLOR ) && !defined( USE_COLOR_ALPHA )
  if (vColor.r + vColor.g + vColor.b < 2.999) {
    float cmx = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)), cmn = min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
    float ksat = smoothstep(0.55, 0.75, (cmx - cmn) / max(cmx, 1e-4));
    float klum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    diffuseColor.rgb = mix(diffuseColor.rgb, vColor * (0.45 + 1.3 * klum), ksat);
  }
#else
  #include <color_fragment>
#endif`);
    };
    m.customProgramCacheKey = () => "citykit-car-paint";
  }
  // Container liveries (P23 / LC-29). The shipping-container GLB is two plain-colour materials (a grey frame, a red body). An entry with a `tint` (sRGB) paints the BODY: the
  // most saturated part draws with a white copy of its material and the instance colour carries the paint (an entry without one keeps the authored red). One InstancedMesh per
  // part as before - no draw call per colour; the copy is kit-owned (disposed with the palettes) and compiled by the warm-up like every kit material.
  function paintPartOf(parts) {
    let best = -1, bs = -1;
    parts.forEach((q, i) => { const c = q.material && q.material.color; if (!c) return; const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b), sat = mx > 1e-6 ? (mx - mn) / mx : 0; if (sat > bs + 1e-9) { bs = sat; best = i; } });
    return bs > 0.3 ? best : -1;
  }
  function paintMaterial(src) {
    const id = "paint:" + src.uuid;
    if (palMats.has(id)) return palMats.get(id);
    const m = src.clone();
    m.color.setRGB(1, 1, 1);
    m.name = (src.name || "kit") + ":paint";
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
    if (e) {
      const vi = Math.max(0, VARIANT_ORDER.indexOf(variant));
      if (vi < 4) return [rgb(e[vi * 2], tint), rgb(e[vi * 2 + 1], tint)];                       // the four shipped colormaps
      const x = PROXY_COLORS_X[type], k = (vi - 4) * 2;                                           // Wave 7b: the resort / lodge colourways
      return x && x[k + 1] !== undefined ? [rgb(x[k], tint), rgb(x[k + 1], tint)] : [rgb(e[0], tint), rgb(e[1], tint)];
    }
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
        const b = [T[o] * it.k, T[o + 1] * it.k * it.sy, T[o + 2] * it.k, T[o + 3] * it.k, T[o + 4] * it.k * it.sy, T[o + 5] * it.k];
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
      pushColliders(colliders, n.type, n.x, n.y, n.z, n.k, { q: n.q, ry: n.ry, exact: n.exact }, opt.chainSegment, n.sy);
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
      pushColliders(tmp, it.type, it.x, it.y, it.z, it.k, { q: it.q, ry: it.ry, exact: it.exact }, opt.chainSegment, it.sy);
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
    const M = new THREE.Matrix4(), _sc3 = new THREE.Vector3(), _carCol = new THREE.Color();
    for (const [key, list] of groups) {
      const type = list[0].type, r = glb.get(type), T = man.types[type], pal = list[0].pal;
      const paintPi = T.role === "container" && list.some((it) => it.tint != null) ? paintPartOf(r.parts) : -1;     // (P23: a container's body wears its entry's livery)
      for (let pi = 0; pi < r.parts.length; pi++) {
        const part = r.parts[pi];
        let mat = part.material;
        if (T.palette) mat = await paletteMaterial(pal, T.double || (part.material && part.material.side === THREE.DoubleSide));
        if (pi === paintPi) mat = paintMaterial(part.material);
        const im = new THREE.InstancedMesh(part.geometry, mat, list.length);
        im.name = "kit:" + id + ":" + type + (r.parts.length > 1 ? "#" + pi : "") + (T.palette && pal.variant !== "base" ? ":" + pal.variant : "");
        if (!part.geometry.boundingSphere) part.geometry.computeBoundingSphere();
        const gs = part.geometry.boundingSphere, sc3 = _sc3;
        let bx0 = Infinity, bx1 = -Infinity, by0 = Infinity, by1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
        const cen = [];                                                        // each instance's own sphere: [x, y, z, r], local to the district
        for (let j = 0; j < list.length; j++) {
          const it = list[j], sc = T.scale * it.k, scy = sc * it.sy;
          const c = it.exact ? _COS[it.q] : Math.cos(it.ry), s = it.exact ? _SIN[it.q] : Math.sin(it.ry);
          M.set(c * sc, 0, s * sc, it.x - c0[0],  0, scy, 0, it.y - c0[1],  -s * sc, 0, c * sc, it.z - c0[2],  0, 0, 0, 1);
          if (!part.identity) M.multiply(part.local);
          im.setMatrixAt(j, M);
          if (T.kind === "car") { _carCol.setHex(it.tint == null ? 0xffffff : it.tint); im.setColorAt(j, _carCol); }
          else if (pi === paintPi) { if (it.tint == null) _carCol.copy(part.material.color); else _carCol.setHex(it.tint); im.setColorAt(j, _carCol); }
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
        if (im.instanceColor) { im.instanceColor.needsUpdate = true; if (im.instanceColor.setUsage) im.instanceColor.setUsage(THREE.StaticDrawUsage); }
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
  /** (P23 / LC-17) the facade detail's strength, 0 = off (the low tier); every building palette shares the uniform: no recompile */
  function setDetail(v) { detailU.value = Math.max(0, +v || 0); }
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

  /** Wave 8 stage B (lane I1): the parsed GLB of ONE type, for a caller that bakes the pieces into merged meshes of its own (maps.js merges the furnished
   *  interiors' kit furniture per 32 m chunk: one draw call for every piece of a chunk, not one per type). Resolves { parts: [{ geometry, material, local
   *  (the mesh's matrix in the GLB), identity, tris }], tris } or { failed }; never rejects. The geometry is the kit's shared parse: read it, never dispose it. */
  async function parts(type) {
    assertAlive();
    await ready();
    if (!hasType(type)) return { failed: "unknown type " + type };
    return loadType(type);
  }

  return {
    api: KIT_API, place, preload, parts, dispose, stats, ready, warmObjects, setShadows, setFarDistance, setDetail,
    colliderFor, footprintFor, typeIds, hasType, resolvePalette,
    get manifest() { return man; },
    get disposed() { return disposed; },
    get options() { return opt; },
  };
}
