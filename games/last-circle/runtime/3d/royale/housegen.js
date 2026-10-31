/**
 * royale/housegen.js - Last Circle Wave 8 (stage A), lane H1 / plan "Lane 8A": the HOUSE GRAMMAR. Round 2 (stage A2, lane H4): uses and storey heights,
 * small sheds and tall shells, glass / frames / open door leaves, rooms dressed for the view from their doorway, per-room walkable areas for bots.
 * Round 3 (stage A3, lane H6): every towngen theme (city resort lodge + farm ruin mill) in its own look; pitched roofs (gable / gambrel / lean-to:
 * C-RAMP planks drawn exactly as the sim's plank, a sealed attic); exterior relief (belts, cornices, pilasters, sills, porches, canopies, stoops, shop
 * awnings, balconies, chimneys, gutters, a ruin's broken parapet); dense rooms from cheap authored pieces (desk clusters, rack rows, loaded pallets,
 * coolers, wall decor, rugs) + skirting / ceiling lights / curtains; the view model reads rooms from the GAME'S third-person camera too; the interior
 * kit trimmed to 31 GLBs (~245 KB); floor loot never under a piece.
 *
 * Turns ONE parcel into an enterable, furnished house: pure data first (THREE-free, DOM-free, no imports: it loads unchanged in Node and in
 * Chrome), then an optional builder that turns that data into merged draw lists and exact axis-aligned colliders (THREE passed in).
 * Nothing in the live game imports this file in stage A; stage B (lane 8B) wires it into maps.js, 8C into bots.js, 8D into loot.js.
 *
 * API
 *   generate(parcel, opts?) -> house             the pure data (below). Deterministic: same parcel + opts -> byte-identical JSON.stringify(house).
 *                                                opts.kit 'interior' (default: lane H2's Kenney interior pieces, manifest_interior.json) | 'base' (the 16
 *                                                furniture types shipped since Wave 4 + authored boxes): see CATALOGS. Every client must pass the same opts.
 *   buildHouse(THREE, house, opts?) -> built     merged meshes per material (walls group + furniture group), mkCollider-shaped colliders, kit entries.
 *   collidersOf(house, mk?)                      the colliders as mkCollider(kind, minX, maxX, minY, maxY, minZ, maxZ, dir, prop, idx, hp) objects.
 *   kitEntries(house, district?)                 the kit furniture as citykit.place() entries ({ type, x, y, z, rot, district }) - citykit only knows the
 *                                                interior types once stage B merges manifest_interior.json (until then: buildHouse's kitTemplates).
 *   stairHeadroomRun(rise, run), CATALOGS / CATALOG, KIT_BOXES, THEMES, defaultMaterials(THREE) and the constants below.
 *
 * parcel = { id, cx, cz, y (pad height, default 0), w, d (m; snapped to the 2.5 m grid, 2..12 cells: towngen's 5 x 5 m shed is built AT 5 x 5), turn 0..3
 *            (towngen: local +Z = the front, faces FACE[turn]), street? 'front' | 'right' | 'left' | 'back' (the side of that turn the street is on; default
 *            front), theme 'city' | 'resort' | 'lodge' | 'farm' | 'ruin' | 'mill' (towngen's; any other -> city, said in notes), storeys (or floors) 1..30, seed (uint32), use? 'house' | 'shop' | 'hall' | 'shed' | 'barn' | 'midrise' |
 *            'tower' (towngen's ARCH uses; default: house / shop from the theme mix), fh? (or floorH) the storey height 3.0..6.0 m (default USE_FH[use]:
 *            house 3.4, shop 4.0, hall 5.0, shed 3.0, barn 6.0, midrise / tower 4.0), plan? 'auto' | 'rect' | 'L' }
 *   O3: <= 3 WALKABLE storeys. A tower / mid-rise asked for more keeps its height: the storeys over the walkable ones are CLOSED (house.shell of them: one exact
 *   mass from the top walkable storey's ceiling to the roof, blind windows drawn on it, a parapet); other uses are clamped to 3 (sheds, halls and barns to 1;
 *   a storey over 5 m to 1: a 5 m stair is at most 45 degrees).
 *   A towngen building is a parcel: generate({ id: parcel.id, cx: b.cx, cz: b.cz, y: pad, w: b.w, d: b.d, turn: b.turn, theme, storeys: b.floors, seed }).
 *
 * house (every coordinate world metres, rounded to 0.001; y absolute):
 *   v, id, theme, use, seed, turn, cx, cz, y0 (pad), nx, nz, U, W, D (wall-centreline span; the walls stand T/2 outside it), storeys, storeysAsked, notes[],
 *   plan 'rect' | 'L', cut [i0, j0, i1, j1] | null (the removed back corner, local cells), floors[{ f, y (walkable surface), ceil (underside above) }],
 *   v, kit (the profile used), fh (storey height), shell (closed storeys over the walkable ones), tris.shell (their triangles),
 *   rooms[{ id, floor, kind living|kitchen|bedroom|bath|office|shop|storage|hall (a corridor)|lobby|meeting|warehouse|barn, cells [[i, j]...], rects [[x0, z0, x1, z1]
 *           per cell, wall centrelines], x0, z0, x1, z1 (inner AABB of the cell bounds: an L room's bounds cover a neighbour's corner, use rects), cx, cz, y, ceil,
 *           area, doors[], stairs[],
 *           walk [[x0, z0, x1, z1]...]  the room's WALKABLE area: the 0.25 m samples (each its square) where the generator's capsule (r 0.6: 0.15 m fatter than the
 *                     player) stood on its walk from the street, merged into rectangles. A furnished room is rarely convex: bots plan INSIDE it (on these, or on the
 *                     collider grid) instead of steering straight node to node. anchor [x, y, z]: the room's nav node, inside walk.
 *           views [{ door | stair (the entrance's id), x, z, dir [dx, dz], seen }]  where the room is read from: each doorway on its outline (eye 0.6 m inside the
 *                     wall face, 1.62 m up, looking in) and each stair top landing in it (looking at its middle), with the pieces the view model counts in view }],
 *   doors[{ id, floor, kind front|back|interior, rooms [a, b|null], x, z, y, width 2.26, height 2.4, axis 'x'|'z' (the wall's run), nx, nz (a -> b / outward), out [x, z]? }],
 *   windows[{ id, floor, room, x, z, sill, head, width 1.3, axis, nx, nz (outward) }],
 *   stairs[{ id, from, to, x0, z0, x1, z1 (ramp footprint), foot [x, y, z], top [x, y, z], approach [x, z], exit [x, z], rise, run, width, slopeDeg, dir 0..3, hole [x0, z0, x1, z1] }],
 *   rails[{ floor, x0, z0, x1, z1, y0, y1 }],
 *   palette[{ mat, color }]  boxes[{ p (part), min [x, y, z], max [x, y, z], f [6 palette indices: +x -x +y -y +z -z], h (bit k = face k not drawn: covered by
 *           another box), c (1 = collider, 0 = drawn only), fl (floor) }]
 *     parts: wall | slab | roof | rail | step (stair visual; the RAMP is its collider) | fill (collider: the solid under a stair) | trim (round 3: exterior
 *            relief, a collider drawn == collider: belts, cornices, pilasters, sills, porch decks / posts / roofs, canopies, stoops, awnings, balconies, ruin
 *            parapet stubs) | gable (collider, never drawn: a pitched roof's sealed attic, drawn by its planks and end walls) | deco (rugs, pictures, mirrors: <= 2 cm,
 *            no collider) | furn (authored furniture) | shell (collider: a tall building's closed storeys) | leaf (collider: an open door leaf folded flat against
 *            the wall beside its opening, 4 cm) | skin (drawn only: <= 1.5 cm trim lying flat on one collider face - window lintels and sills, shutters on the
 *            street face, the front door's frame, blind windows on a shell; a PLATE: only its outward face is drawn) | glass (drawn only: a 2 cm pane in a
 *            window's aperture; the cover rule - bullets pass, the sill and header stop bodies; the builder puts it in a "glass" group, userData.lcPart "glass")
 *   ramps[{ min, max, dir, floor, roof? }]  the C-RAMP colliders (kind "ramp": walkable from minY at the foot up to maxY at the top, dir = rising direction);
 *                                         ramps[k] is stairs[k]'s for k < stairs.length, the rest (roof: true) are a pitched roof's planks
 *   roofs[{ ramp, freeLow, freeHigh, soffit [[x0, z0, x1, z1]...], top, edge }]   a pitched roof's planks as drawn: EXACTLY the sim's plank of ramps[ramp]
 *                     (walk line +- hv = 0.15 sqrt(1 + k^2), royale.js segmentRamp / rampBlocks), its free ends' faces, its underside only where it hangs
 *                     outside the walls (soffit); top / edge = palette indices. The attic under it is filled by "gable" collider boxes (never drawn).
 *   gables[{ pts [[x, y, z]...], n [nx, 0, nz], pal }]   the drawn end walls of a pitched roof: flat polygons on the attic layers' end faces
 *   roof 'flat' | 'gable' | 'gambrel' | 'lean' | 'hip'   (H.roof) the roof kind
 *   furniture[{ id, type, cat (catalog id), src 'kit'|'box', room, floor, x, z, y (the floor), turn (world quarter turn of its front), min, max (its drawn AABB =
 *               its collider AABB), tris, deco? (drawn only), kit? { type, x, y, z, rot } (manifest origin), parts? [box indices], cols? [{ min, max }] (authored),
 *               mount? 'wall' (hung: min[1] above the floor - wall cabinets, a bathroom cabinet, a wall shelf) | 'top' (stands on piece `on`: a lamp on a nightstand,
 *               a TV on its cabinet, a microwave on a counter, a box on a pallet), on? (that piece's id) }]
 *   loot[{ id, room, floor, x, y, z, on 'floor'|<furniture type> }], chests[{ id, room, floor, x, y, z }]
 *     USE y AS GIVEN: a loot point on furniture sits on its visible top surface, which can lie under that piece's collider top (a kitchen sink's top is 0.95,
 *     its backsplash makes the collider 1.08; a gondola's mid shelf 1.13 under its 1.35 top): stage B must not snap loot to supportAt / the collider top.
 *   nav { nodes [{ id, kind room|door|stair|street, room?, floor, x, y, z }], links [{ type door|stair|exit, a, b, from [x, y, z], to [x, y, z], width, cost, bidir }] }
 *     (Detour off-mesh style: a door link joins the two room nodes through the opening, a stair link joins the approach and exit points.)
 *   tris { floors [per storey: structure + furniture], total }, aabb { min, max }, lod { cx, cy, cz, r, furnitureR }
 *
 * The grammar: a rectangle or an L on a 2.5 m grid; storeys 1..3 (O3); for >= 2 storeys a 1-cell STAIR STRIP runs the full depth along a side wall
 * (two strips, one per stair, for 3 storeys; a back-wall row when the plan is too shallow). In the strip a stair takes 2 cells (5 m run, 34.2 degrees
 * for the 3.4 m storey): the cell before its foot is the APPROACH, the cell beyond its top on the floor above is the EXIT, and the 2 cells above it are a
 * HOLE in the slab (with a 1.0 m half-wall across its far end). The rest of each floor is cut into rooms by guillotine splits (towngen's), the strip's
 * walkable cells are hall rooms (about one room per 4 cells), and every room is joined to the entrance by a spanning tree of doors (a bathroom is a dead
 * end whenever the plan allows; + an occasional second door). Room kinds by size (the front-door room is the living room / shop, the smallest the bath).
 * Windows (1.3 m wide, sill 1.20, header 2.30) go in exterior walls; every room with an outside wall gets at least one (a ground-floor shop keeps its
 * side walls mostly blank for shelving). FURNITURE: pieces stand with their back to a wall (front to the room), as a centred group (dining table +
 * chairs, shop gondolas) or hang on a solid wall stretch (pictures, mirrors); never inside a door zone (opening + 0.1 m, 1.0 m deep both sides), a stair
 * zone (the stair, its approach / exit cells, the hole) or another piece; tall pieces never in front of a window. After every piece the room's PORTS
 * (doorway sides, stair ends) must stay joined through free floor for a fatter capsule (r 0.45 + WALK_MARGIN) or the piece is refused. Each storey's
 * budget is split into room shares (by area, weighted by kind: SHAREW; a reserve held back); a kit piece over its room's share falls back to its authored
 * stand-in; pieces go in round-robin (every room's key pieces - bed, toilet, counter row + dining set, sofa + TV, desk, shop counter - before anybody's
 * extras). READ FROM THE DOOR (round 2): every room keeps a view model of its entrances (see rooms[].views; 80 x 52 degrees, >= 2 of 10 sample points
 * unoccluded by structure: a stricter copy of interiorcheck's furniture-in-view); extras go where the entrance sees them until it sees VIEW_WANT (4);
 * then a phase in view (cheap pieces from VIEWPOOL against the walls it sees, entrance by entrance; a free-standing piece in the open floor it looks at;
 * a lamp / small plant on a free top), then a top-up to >= 3 standing pieces. Rooms get a door on their outline at layout time (an L room whose only door
 * is on its notch wall gets one more), landings merge into the neighbour whose merged outline keeps its middle inside, no back door straight across a
 * room from another door and no window straight across a cell from a door. A bedroom no bed fits in is relabelled storage. A final capsule walk (r 0.6 on the 0.25 m
 * grid, stairs as links) from the street door must reach every room, door, stair end and loot point, else the last piece of that floor is removed.
 *
 * Cover rule (maps.js house(), :2242-2254): a window is a firing port - sill top at floor + 1.20 (standing eye 1.62 clears it, crouched eye 0.97 does
 * not), header from floor + 2.30 (a 1.38 m jump apex still meets it), so it is shot through, never walked or jumped through. Doors: a 2.5 m cell with
 * 0.12 m jambs = 2.26 m clear (towngen DOOR_W, the wallDoorwayWide width; the old 1.4 m doors left bots "an 0.8 m free band", bots.js:1295-1297),
 * 2.40 m high. Stairs (C-RAMP): a ramp collider from the floor (lip 0) to the slab top it lands on, <= 45 degrees, its wedge filled by collider boxes
 * under its underside (nobody hides under a stair), the slab hole at least stairHeadroomRun() long (maps.js:1671-1687: a sprinting descent flies in arcs).
 *
 * Visuals vs colliders: every drawn box of the walls group IS a collider box (same numbers) except the stair steps (drawn; the ramp collides: each
 * step top is within riser/2 <= 0.09 m of the ramp surface at its centre) and 2 cm dressing (rugs, pictures: drawn only). Faces another box covers
 * completely are not drawn (h bits; the selftest proves each one is covered). Furniture colliders are the drawn AABB: kit pieces = the manifest's
 * bbox_min/bbox_max (KIT_BOXES, a literal copy the selftest compares with manifest.json / manifest_interior.json), authored pieces = their boxes'.
 *
 * Budget: TRI_BUDGET triangles per furnished storey (drawn structure faces + furniture; the plan's ~4k), house.tris = exactly what the renderer draws
 * (housegen_demo.py measures it). LOD: the builder returns the furniture as its own group plus updateLod(cameraPos, dist = 60) (stage B hides
 * furniture beyond ~60 m); house.lod gives the centre / radius.
 *
 * DETERMINISM: a pure function of the parcel. RNG = mulberry32(seed ^ hash32(id) ^ hash32('house')) (towngen's generator). Only + - * / floor round min
 * max abs sqrt; quarter turns from exact tables (no sin / cos / atan).
 */

export const VERSION = 5;                  // 5: Wave 8 fix round (lane K1) - phase 5 (every room shows >= 3 of its own pieces to the doorway eye), the outline door keeps off straight-across / thin-opposite edges, P.near + DOOR_OUT (no street / back door onto an alley), a ruin's wreckage (remnants, rubble, scorch, cracks, moss, weeds, broken panes) from its own stream; 4: stage B (lane I1) - meshData / translateY exports, the machine's exact colliders, no clutter staircase, a room reads from its own pieces; 3: round 3 (lane H6) - themes, pitched roofs (house.roofs / gables, roof ramps), relief, dense layouts; 2: round 2 (lane H4) - uses, storey heights, shells, dressing, rooms[].walk / anchor / views, furniture mount / on

// ── constants ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const U = 2.5;                      // grid module (towngen CELL)
export const T = 0.24;                     // wall thickness (walls are centred on the grid lines)
export const JAMB = T / 2;                 // 0.12: a door / window jamb, half a wall
export const DOOR_CLEAR = U - T;           // 2.26 m clear (towngen DOOR_W)
export const DOOR_H = 2.4;                 // m above the floor
export const SILL = 1.2;                   // window sill top above the floor (maps.js house() cover rule)
export const HEAD = 2.3;                   // window header bottom above the floor
export const WIN_MARGIN = 0.6;             // pier each side: opening = U - 1.2 = 1.3 m
export const WIN_W = U - 2 * WIN_MARGIN;   // 1.3
export const FH = 3.4;                     // floor-to-floor of a house (maps.js house H, towngen house fh); parcel.fh overrides it
// towngen's ARCH table (towngen.js:227-236): the uses maps.js hands over in stage B and their storey heights
export const USES = ["house", "shop", "hall", "shed", "barn", "midrise", "tower"];
export const USE_FH = Object.freeze({ house: 3.4, shop: 4.0, hall: 5.0, shed: 3.0, barn: 6.0, midrise: 4.0, tower: 4.0 });
export const FH_MIN = 3.0, FH_MAX = 6.0;   // storey heights accepted (a stair climbs at most STAIR_MAX_RISE: taller storeys stay single-storey)
export const STAIR_MAX_RISE = 5.0;         // a 5 m run at <= 45 degrees
export const MIN_CELLS = 2, MAX_CELLS = 12; // footprint 5 m (towngen's 5 x 5 m shed) .. 30 m per side
export const MAX_SHELL = 27;               // closed storeys over the walkable ones (towers / mid-rises: O3 keeps <= 3 walkable floors)
export const SLAB = 0.3;                 // upper floor / roof slab thickness
export const FLOOR0 = 0.05;                // ground-floor surface above the pad
export const BASE0 = 0.15;                 // ground slab and walls reach this far under the pad
export const RAIL_H = 1.0, RAIL_T = 0.1;   // the half-wall across a stairwell hole
export const PARAPET = 0.6;                // flat roofs: the parapet above the roof surface
export const OVERHANG = 0.35;              // stepped (hip) roofs overhang the walls' outer faces
export const CAPSULE = Object.freeze({ r: 0.45, h: 1.8, step: 0.55 });   // player.js STEP_UP, sim PLAYERK
export const MAX_FLOORS = 3;               // O3
export const TRI_BUDGET = 4000;            // per furnished storey
export const RISER_MAX = 0.18;             // stair visual: steps no taller than this
export const STAIR_RUN = 2 * U;            // 5 m
export const GRID = 0.25;                  // the capsule walk's sample pitch
export const RING = 1.5;                   // ground-floor walk: the street ring around the house
export const REACH_XZ = 1.5, REACH_DY = 2.2;   // a loot point counts as reachable from a free capsule spot this close (loot.js REACH_DY 2.2)
export const DOOR_ZONE = 1.0;              // furniture keeps this depth clear in front of a doorway, both sides (and 0.1 m past each jamb)
// Wave 9 (LC-91, design W2 + contract C1): door leaves - see "DOOR LEAVES" in generate() and H.doorLeaves
export const LEAF_T = 0.04;                // a leaf's thickness
export const SWING_R = 1.18;               // a leaf's swing quarter disc round its hinge (the 1.125 m leaf + its 4 cm thickness + margin): a keep-out
export const DOOR_ZONE_LEAF = 1.2;         // the door zone on a leafed door's SWING side (DOOR_ZONE elsewhere): covers both discs
export const LEAF_SHARE = 0.5;             // interior doors with leafHash(id) under this get leaves (exterior doors always, the clearance test allowing)
export const LEAF_TRIS = 10;               // what housegen's own builder (meshData) draws of a leaf: its OPEN slab, 5 faces (maps.js draws the swinging model instead)
export const LEAF_PIVOT = Object.freeze({ t: -0.05, c: 0.07, x0: 0.05, z0: 0.05 });   // the drawn leaf's hinge pivot (from the jamb face corner: t toward the middle, c into the room) and its model's X / |Z| offsets: rotating ONE model about it lands exactly on the closed and the open slab
/** a door id -> [0, 1): which interior doors get leaves (an FNV hash, finalised: no rng is drawn, the house's stream is untouched) */
export function leafHash(id) {
  let h = hash32(String(id) + "#leaf");
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// The generator's own walk uses a FATTER capsule (r + WALK_MARGIN) and a shorter loot reach (REACH_XZ - 0.25) than the rules it promises: a path or
// a pickup it accepts then holds for the real capsule wherever its samples fall (a 0.25 m grid can miss a gap only ~0.9 m wide), and bots get a
// free band of >= 0.3 m beside furniture (bots.js:1295-1297: narrow bands are where they grind).
export const WALK_MARGIN = 0.15;              // furniture keeps this depth clear in front of a doorway, both sides
const MOVE = { sprint: 8, gravity: -22 };  // runtime/sim/royale.js MOVE (stairHeadroomRun)
const EPS = 1e-6;
// the 0.25 m walk-sample offsets within 1.2 m, nearest first (ties in a fixed order): where a floor loot spot is looked for round a cell's middle
// (cell middles fall on sample corners: the offset (da, db) is the sample whose square has its lower corner da, db away)
const SPOT_OFFS = (() => { const o = []; for (let db = -5; db <= 4; db++) for (let da = -5; da <= 4; da++) { const x = (da + 0.5) * 0.25, z = (db + 0.5) * 0.25; if (x * x + z * z <= 1.44) o.push([da, db, x * x + z * z]); } return o.sort((p, q) => p[2] - q[2] || p[1] - q[1] || p[0] - q[0]).map((q) => [q[0], q[1]]); })();

/** maps.js stairHeadroomRun (:1684): how far back from a stair's TOP the hole above it must begin so a sprinting descent (flying in arcs) keeps its head clear */
export function stairHeadroomRun(rise, run) {
  const m = Math.max(0.05, rise / run), mv = m * MOVE.sprint, arc = mv * mv / (2 * Math.abs(MOVE.gravity));
  return (CAPSULE.h + arc + 0.10) / m + CAPSULE.r;
}
/** the sim's plank half-thickness on the vertical (royale.js rampHalfV: RAMP_THICK 0.3) of a ramp record { min, max, dir } */
export function rampHalfV(r) {
  const along = r.dir < 2 ? r.max[0] - r.min[0] : r.max[2] - r.min[2], k = (r.max[1] - r.min[1]) / Math.max(0.01, along);
  return 0.15 * Math.sqrt(1 + k * k);
}
// slope in degrees of a 5 m stair by rise (towngen STAIR_DEG; Math.atan is not used: engines differ in its last bit). Other rises: atanDeg below
// (argument halving + an odd series: only + - * / sqrt, so every engine gives the same bits).
const STAIR_DEG = { 3: 30.96, 3.4: 34.22, 4: 38.66, 5: 45 };
function atanDeg(x) {
  let k = 1;
  for (let i = 0; i < 3; i++) { x = x / (1 + Math.sqrt(1 + x * x)); k *= 2; }
  const x2 = x * x;
  let s = 0, p = x;
  for (let n = 0; n < 8; n++) { s += (n % 2 ? -p : p) / (2 * n + 1); p *= x2; }
  return Math.round(s * k * 180 / 3.141592653589793 * 100) / 100;
}

// ── rng (towngen's: the sim's mulberry32) ───────────────────────────────────────────────────────────────────────────────────────────────
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash32(s) {
  let h = 0x811c9dc5;
  s = String(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function subRng(seed, id, salt) {
  let s = ((seed | 0) ^ hash32(id)) >>> 0;
  if (salt) s = (s ^ hash32(salt)) >>> 0;
  return mulberry32(s);
}
const rint = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const pick = (r, a) => a[Math.floor(r() * a.length)];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const r3 = (v) => Math.round(v * 1000) / 1000;
function shuffle(r, a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// ── quarter turns (towngen's tables) ────────────────────────────────────────────────────────────────────────────────────────────────────
const COS = [1, 0, -1, 0], SIN = [0, 1, 0, -1];
export const FACE = [[0, 1], [1, 0], [0, -1], [-1, 0]];        // quarter turn q -> world direction of local +Z
const turnOfDir = (dx, dz) => (dz > 0.5 ? 0 : dx > 0.5 ? 1 : dz < -0.5 ? 2 : 3);
/** rotate a local (x, z) by quarter turn q (THREE rotateY: x' = x c + z s, z' = -x s + z c) */
const rotQ = (q, x, z) => [x * COS[q] + z * SIN[q], -x * SIN[q] + z * COS[q]];

// ── kit furniture: a literal copy of assets/props/city/manifest.json types[furniture/*] bbox_min_m / bbox_max_m / tris (metres at suggested_scale) ──
export const KIT_BOXES = {
  "furniture/bookcaseClosed": { min: [0, 0, -0.55], max: [0.88, 1.87, 0], tris: 338 },
  "furniture/cabinetTelevision": { min: [0, 0, -0.55], max: [1.76, 0.682, 0], tris: 148 },
  "furniture/cardboardBoxClosed": { min: [0, 0, -0.468], max: [0.468, 0.618, 0], tris: 60 },
  "furniture/chair": { min: [0, 0, -0.44], max: [0.44, 1.034, 0], tris: 162 },
  "furniture/chairDesk": { min: [0, 0, -0.692], max: [0.737, 1.337, 0], tris: 584 },
  "furniture/desk": { min: [-0.022, 0, -0.836], max: [1.594, 0.846, 0.027], tris: 193 },
  "furniture/kitchenFridge": { min: [0, 0, -0.62], max: [0.946, 2.024, 0.022], tris: 238 },
  "furniture/kitchenSink": { min: [0, 0, -0.99], max: [0.946, 1.078, 0], tris: 316 },
  "furniture/kitchenStove": { min: [0, 0, -0.99], max: [0.946, 0.99, 0], tris: 809 },
  "furniture/loungeSofa": { min: [0, 0, -0.902], max: [2.156, 1.012, 0], tris: 123 },
  "furniture/pottedPlant": { min: [-0.233, 0, -0.266], max: [0.233, 1.439, 0.266], tris: 60 },
  "furniture/sideTable": { min: [-0.022, 0, -0.462], max: [1.154, 0.846, 0.022], tris: 116 },
  "furniture/stoolBar": { min: [0, 0, -0.506], max: [0.584, 0.957, 0], tris: 170 },
  "furniture/table": { min: [0, 0, -0.984], max: [1.851, 0.719, 0], tris: 110 },
  "furniture/tableCoffee": { min: [-1.014, 0, -0.66], max: [0.44, 0.506, 0.22], tris: 116 },
  "furniture/trashcan": { min: [-0.229, 0, -0.246], max: [0.229, 0.941, 0.269], tris: 68 },
  // lane H2's interior kit (Wave 8 stage A: assets/props/city/manifest_interior.json, merged into manifest.json in stage B; Kenney Furniture Kit 2.0, CC0).
  // A literal copy as well (housegen never fetches): the selftest compares every row with whichever manifest holds the type.
  "furniture/bedSingle": { min: [-0.628, 0, -1.238], max: [0.628, 0.825, 1.238], tris: 212, m: "interior" },
  "furniture/bedDouble": { min: [-1.052, 0, -1.238], max: [1.052, 0.825, 1.238], tris: 261, m: "interior" },
  "furniture/cabinetBedDrawer": { min: [-0.293, 0, -0.239], max: [0.293, 0.579, 0.239], tris: 180, m: "interior" },
  "furniture/bookcaseClosedDoors": { min: [-0.44, 0, -0.275], max: [0.44, 1.87, 0.275], tris: 277, m: "interior" },
  "furniture/toilet": { min: [-0.344, 0, -0.525], max: [0.344, 0.992, 0.525], tris: 223, m: "interior" },
  "furniture/bathtub": { min: [-1.309, 0, -0.616], max: [1.309, 0.924, 0.616], tris: 599, m: "interior" },
  "furniture/bathroomSinkSquare": { min: [-0.473, 0, -0.33], max: [0.473, 1.276, 0.33], tris: 232, m: "interior" },
  "furniture/kitchenCabinet": { min: [-0.473, 0, -0.495], max: [0.473, 0.99, 0.495], tris: 114, m: "interior" },
  "furniture/kitchenStoveElectric": { min: [-0.473, 0, -0.495], max: [0.473, 0.99, 0.495], tris: 336, m: "interior" },
  "furniture/shelfTall": { min: [-0.658, 0, -0.259], max: [0.658, 1.988, 0.259], tris: 536, m: "interior" },
  "furniture/rugSquare": { min: [-0.995, 0, -1.012], max: [0.995, 0.022, 1.012], tris: 28, m: "interior", deco: true },
  "furniture/lampRoundFloor": { min: [-0.167, 0, -0.193], max: [0.167, 1.892, 0.193], tris: 76, m: "interior" },
  "furniture/loungeChair": { min: [-0.539, 0, -0.451], max: [0.539, 1.012, 0.451], tris: 124, m: "interior" },
  "furniture/coatRackStanding": { min: [-0.3, 0, -0.3], max: [0.3, 1.694, 0.3], tris: 185, m: "interior" },
  // round 2 (lane H4): the interior types round 1 left unused (kitchen wall cabinets, microwave, a slim TV, sofas, shelving, lamps, laundry, ...).
  // Not taken: hoodModern, deskCorner, loungeSofaCorner / Long, tableRound (their drawn shapes leave > 0.25 m of an AABB collider empty), lampWall /
  // lampSquareCeiling (< 0.25 m, or hung where the camera pulls in), books (decor under 0.25 m).
  "furniture/kitchenCabinetUpper": { min: [-0.473, 0, -0.242], max: [0.473, 0.858, 0.242], tris: 80, m: "interior" },
  "furniture/kitchenMicrowave": { min: [-0.319, 0, -0.253], max: [0.319, 0.396, 0.253], tris: 151, m: "interior" },
  "furniture/televisionModern": { min: [-0.753, 0, -0.141], max: [0.753, 1, 0.141], tris: 72, m: "interior" },
  "furniture/loungeDesignSofa": { min: [-1.232, 0, -0.451], max: [1.232, 0.88, 0.451], tris: 109, m: "interior" },
  "furniture/loungeSofaOttoman": { min: [-0.484, 0, -0.495], max: [0.484, 0.506, 0.495], tris: 82, m: "interior" },
  "furniture/tableCoffeeSquare": { min: [-0.44, 0, -0.44], max: [0.44, 0.506, 0.44], tris: 118, m: "interior" },
  "furniture/bookcaseOpen": { min: [-0.44, 0, -0.275], max: [0.44, 1.936, 0.275], tris: 292, m: "interior" },
  "furniture/bookcaseOpenLow": { min: [-0.44, 0, -0.275], max: [0.44, 0.88, 0.275], tris: 172, m: "interior" },
  "furniture/bookcaseClosedWide": { min: [-0.88, 0, -0.275], max: [0.88, 1.738, 0.275], tris: 338, m: "interior" },
  "furniture/shelfLarge": { min: [-0.761, 0, -0.17], max: [0.761, 1.997, 0.17], tris: 220, m: "interior" },
  "furniture/pallet": { min: [-0.446, 0, -0.608], max: [0.446, 0.14, 0.608], tris: 240, m: "interior" },
  "furniture/rugRectangle": { min: [-1.727, 0, -1.012], max: [1.727, 0.022, 1.012], tris: 28, m: "interior", deco: true },
  "furniture/rugRound": { min: [-1.012, 0, -1.012], max: [1.012, 0.022, 1.012], tris: 188, m: "interior", deco: true },
  "furniture/lampSquareFloor": { min: [-0.132, 0, -0.132], max: [0.132, 1.892, 0.132], tris: 60, m: "interior" },
  "furniture/lampSquareTable": { min: [-0.132, 0, -0.132], max: [0.132, 0.638, 0.132], tris: 60, m: "interior" },
  "furniture/cabinetBed": { min: [-0.293, 0, -0.237], max: [0.293, 0.513, 0.237], tris: 72, m: "interior" },
  "furniture/sideTableDrawers": { min: [-0.588, 0, -0.245], max: [0.588, 0.846, 0.245], tris: 234, m: "interior" },
  "furniture/dryer": { min: [-0.429, 0, -0.418], max: [0.429, 1.034, 0.418], tris: 258, m: "interior" },
  "furniture/bathroomCabinet": { min: [-0.253, 0, -0.143], max: [0.253, 0.858, 0.143], tris: 64, m: "interior" },
  "furniture/kitchenCabinetDrawer": { min: [-0.473, 0, -0.495], max: [0.473, 0.99, 0.495], tris: 174, m: "interior" },
  "furniture/tableCross": { min: [-0.937, 0, -0.492], max: [0.937, 0.764, 0.492], tris: 168, m: "interior" },
  "furniture/tableCloth": { min: [-0.926, 0, -0.492], max: [0.926, 0.719, 0.492], tris: 134, m: "interior" },
  "furniture/chairModernCushion": { min: [-0.22, 0, -0.22], max: [0.22, 1.012, 0.22], tris: 90, m: "interior" },
  "furniture/computerScreen": { min: [-0.432, 0, -0.114], max: [0.432, 0.647, 0.114], tris: 72, m: "interior" },
  "furniture/plantSmall1": { min: [-0.104, 0, -0.104], max: [0.104, 0.308, 0.104], tris: 102, m: "interior" },
  "furniture/cardboardBoxOpen": { min: [-0.409, 0, -0.234], max: [0.409, 0.618, 0.234], tris: 60, m: "interior" },
};

// ── authored furniture (no kit type yet: lane H2 expands the kit; until then exact boxes, original art) ──────────────────────────────────
// Local frame: footprint centred on the origin, front = +Z, floor y = 0. parts: [x0, y0, z0, x1, y1, z1, mat, colour] (colour 0 = the piece's
// tint), cols: the collider boxes as part-index groups (each collider = the AABB of its parts), every part belongs to exactly one group.
const WOOD = 0x9a6b43, WOODD = 0x6e4a2e, WHITE = 0xf2f0ea, CERAM = 0xf4f6f6, STEEL = 0x9aa3a8;
const AUTH = {
  bed: { w: 1.6, d: 2.1, parts: [[-0.8, 0, -0.95, 0.8, 0.32, 1.05, "wood", WOOD], [-0.76, 0.32, -0.93, 0.76, 0.52, 1.03, "fabric", WHITE], [-0.78, 0.5, -0.25, 0.78, 0.57, 1.05, "fabric", 0],
    [-0.7, 0.52, -0.9, -0.08, 0.64, -0.5, "fabric", WHITE], [0.08, 0.52, -0.9, 0.7, 0.64, -0.5, "fabric", WHITE], [-0.8, 0, -1.05, 0.8, 1.05, -0.95, "wood", WOODD]], cols: [[0, 1, 2, 3, 4], [5]], surface: 0.57 },
  bedSingle: { w: 1.0, d: 2.05, parts: [[-0.5, 0, -0.93, 0.5, 0.32, 1.025, "wood", WOOD], [-0.47, 0.32, -0.91, 0.47, 0.52, 1.005, "fabric", WHITE], [-0.49, 0.5, -0.2, 0.49, 0.57, 1.025, "fabric", 0],
    [-0.4, 0.52, -0.88, 0.4, 0.64, -0.5, "fabric", WHITE], [-0.5, 0, -1.025, 0.5, 0.95, -0.93, "wood", WOODD]], cols: [[0, 1, 2, 3], [4]], surface: 0.57 },
  wardrobe: { w: 1.2, d: 0.6, parts: [[-0.6, 0, -0.3, 0.6, 2.0, 0.29, "wood", 0], [-0.58, 0.06, 0.29, -0.015, 1.94, 0.31, "wood", WOOD], [0.015, 0.06, 0.29, 0.58, 1.94, 0.31, "wood", WOOD]], cols: [[0, 1, 2]] },
  nightstand: { w: 0.5, d: 0.42, parts: [[-0.25, 0, -0.21, 0.25, 0.52, 0.2, "wood", 0], [-0.22, 0.28, 0.2, 0.22, 0.48, 0.21, "wood", WOODD], [-0.26, 0.52, -0.21, 0.26, 0.56, 0.21, "wood", WOODD]], cols: [[0, 1, 2]], surface: 0.56 },
  bathtub: { w: 1.7, d: 0.78, parts: [[-0.85, 0, -0.39, 0.85, 0.16, 0.39, "ceramic", CERAM], [-0.85, 0.16, -0.39, 0.85, 0.58, -0.31, "ceramic", CERAM], [-0.85, 0.16, 0.31, 0.85, 0.58, 0.39, "ceramic", CERAM],
    [-0.85, 0.16, -0.31, -0.77, 0.58, 0.31, "ceramic", CERAM], [0.77, 0.16, -0.31, 0.85, 0.58, 0.31, "ceramic", CERAM], [-0.76, 0.16, -0.3, 0.76, 0.3, 0.3, "ceramic", 0x9fd4e3]], cols: [[0, 1, 2, 3, 4, 5]] },
  // (two colliders: the tank hangs on the wall over an empty band, the bowl + seat stand on the floor: one AABB round all three left a 0.34 m empty box)
  toilet: { w: 0.42, d: 0.7, parts: [[-0.21, 0.35, -0.35, 0.21, 0.8, -0.17, "ceramic", CERAM], [-0.17, 0, -0.2, 0.17, 0.42, 0.35, "ceramic", CERAM], [-0.19, 0.42, -0.17, 0.19, 0.46, 0.35, "ceramic", WHITE]], cols: [[0], [1, 2]] },
  basin: { w: 0.7, d: 0.48, parts: [[-0.33, 0, -0.24, 0.33, 0.8, 0.22, "wood", 0], [-0.35, 0.8, -0.24, 0.35, 0.87, 0.24, "ceramic", CERAM], [-0.03, 0.87, -0.22, 0.03, 1.02, -0.16, "metal", STEEL]], cols: [[0, 1, 2]], surface: 0.87 },
  counter: { w: 0.946, d: 0.99, parts: [[-0.473, 0, -0.495, 0.473, 0.86, 0.47, "wood", 0], [-0.473, 0.86, -0.495, 0.473, 0.92, 0.495, "ceramic", 0x4b4f54], [-0.42, 0.62, 0.47, 0.42, 0.7, 0.48, "metal", STEEL]], cols: [[0, 1, 2]], surface: 0.92 },
  // a cooker the size of a counter cabinet (the kit stove is 809 triangles, a fifth of a storey's budget: this one is 84)
  stoveBox: { w: 0.946, d: 0.99, parts: [[-0.473, 0, -0.495, 0.473, 0.86, 0.47, "metal", 0xe4e6e8], [-0.473, 0.86, -0.495, 0.473, 0.92, 0.495, "ceramic", 0x26282c], [-0.4, 0.14, 0.47, 0.4, 0.7, 0.49, "ceramic", 0x1e2024],
    [-0.36, 0.73, 0.47, 0.36, 0.76, 0.5, "metal", STEEL], [-0.36, 0.92, -0.38, -0.08, 0.94, -0.1, "metal", 0x55585c], [0.08, 0.92, -0.38, 0.36, 0.94, -0.1, "metal", 0x55585c], [-0.36, 0.92, 0.08, -0.08, 0.94, 0.36, "metal", 0x55585c]],
    cols: [[0, 1, 2, 3, 4, 5, 6]], surface: 0.94 },
  shelf: { w: 1.8, d: 0.5, parts: [[-0.9, 0, -0.25, 0.9, 1.9, -0.2, "wood", 0], [-0.9, 0, -0.2, -0.85, 1.9, 0.25, "wood", 0], [0.85, 0, -0.2, 0.9, 1.9, 0.25, "wood", 0],
    [-0.85, 0, -0.2, 0.85, 0.12, 0.25, "wood", 0], [-0.85, 0.62, -0.2, 0.85, 0.66, 0.25, "wood", 0], [-0.85, 1.16, -0.2, 0.85, 1.2, 0.25, "wood", 0], [-0.85, 1.7, -0.2, 0.85, 1.74, 0.25, "wood", 0],
    [-0.8, 0.12, -0.15, -0.2, 0.5, 0.18, "fabric", 0xd9534f], [-0.1, 0.12, -0.12, 0.45, 0.42, 0.2, "fabric", 0xf0ad4e], [0.5, 0.12, -0.15, 0.8, 0.55, 0.15, "fabric", 0x5bc0de],
    [-0.8, 0.66, -0.12, -0.35, 1.0, 0.2, "fabric", 0x5cb85c], [-0.25, 0.66, -0.15, 0.3, 0.95, 0.18, "fabric", 0xe8e1c8], [0.38, 0.66, -0.15, 0.8, 1.05, 0.2, "fabric", 0xd9534f],
    [-0.8, 1.2, -0.15, -0.1, 1.5, 0.15, "fabric", 0x428bca], [0.0, 1.2, -0.12, 0.8, 1.45, 0.2, "fabric", 0xf0ad4e]], cols: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]] },
  // a low shelf that fits under a window sill (1.05 < 1.20), and a free-standing double-sided gondola (1.35 m: crouch cover in a shop aisle)
  shelfLow: { w: 1.6, d: 0.45, parts: [[-0.8, 0, -0.225, 0.8, 1.05, -0.185, "wood", 0], [-0.8, 0, -0.185, -0.76, 1.05, 0.225, "wood", 0], [0.76, 0, -0.185, 0.8, 1.05, 0.225, "wood", 0],
    [-0.76, 0, -0.185, 0.76, 0.1, 0.225, "wood", 0], [-0.76, 0.5, -0.185, 0.76, 0.54, 0.225, "wood", 0], [-0.76, 1.0, -0.185, 0.76, 1.05, 0.225, "wood", WOODD],
    [-0.7, 0.1, -0.15, -0.1, 0.42, 0.18, "fabric", 0xf0ad4e], [0.0, 0.1, -0.12, 0.7, 0.38, 0.2, "fabric", 0x5bc0de], [-0.7, 0.54, -0.15, 0.05, 0.86, 0.18, "fabric", 0xd9534f], [0.15, 0.54, -0.12, 0.7, 0.9, 0.2, "fabric", 0x5cb85c]],
    cols: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]], surface: 1.05 },
  gondola: { w: 1.8, d: 0.9, parts: [[-0.9, 0, -0.45, 0.9, 0.12, 0.45, "metal", 0xd8dadc], [-0.88, 0.12, -0.03, 0.88, 1.35, 0.03, "metal", 0xc8cacc], [-0.9, 0.12, -0.45, -0.86, 1.35, 0.45, "metal", 0x9aa1a6], [0.86, 0.12, -0.45, 0.9, 1.35, 0.45, "metal", 0x9aa1a6],
    [-0.86, 0.6, -0.45, 0.86, 0.63, 0.45, "metal", 0xd8dadc], [-0.86, 1.1, -0.45, 0.86, 1.13, 0.45, "metal", 0xd8dadc],
    [-0.8, 0.12, 0.05, -0.15, 0.45, 0.4, "fabric", 0xd9534f], [-0.05, 0.12, 0.05, 0.8, 0.5, 0.42, "fabric", 0x428bca], [-0.8, 0.63, 0.05, 0.1, 0.95, 0.4, "fabric", 0xf0ad4e], [0.2, 0.63, 0.05, 0.8, 1.0, 0.4, "fabric", 0x5cb85c],
    [-0.8, 0.12, -0.42, 0.0, 0.48, -0.05, "fabric", 0x5bc0de], [0.1, 0.12, -0.4, 0.8, 0.42, -0.05, "fabric", 0xe8e1c8], [-0.8, 0.63, -0.4, -0.2, 0.92, -0.05, "fabric", 0xd9534f], [-0.1, 0.63, -0.42, 0.8, 1.02, -0.05, "fabric", 0xf0ad4e]],
    cols: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]], surface: 1.13 },
  shopCounter: { w: 2.0, d: 0.7, parts: [[-1.0, 0, -0.35, 1.0, 1.0, 0.33, "wood", 0], [-1.02, 1.0, -0.36, 1.02, 1.05, 0.35, "wood", WOODD], [-0.95, 0.15, 0.33, 0.95, 0.9, 0.35, "wood", WOOD],
    [0.3, 1.05, -0.25, 0.7, 1.3, 0.05, "metal", 0x3a3f44]], cols: [[0, 1, 2], [3]], surface: 1.05 },
  crate: { w: 0.9, d: 0.9, parts: [[-0.45, 0, -0.45, 0.45, 0.9, 0.45, "wood", 0], [-0.46, 0.38, -0.46, 0.46, 0.52, 0.46, "wood", WOODD]], cols: [[0, 1]], surface: 0.9 },
  crateStack: { w: 0.9, d: 0.9, parts: [[-0.45, 0, -0.45, 0.45, 0.9, 0.45, "wood", 0], [-0.46, 0.38, -0.46, 0.46, 0.52, 0.46, "wood", WOODD], [-0.38, 0.9, -0.38, 0.38, 1.56, 0.38, "wood", WOOD]], cols: [[0, 1], [2]] },
  rug: { w: 2.4, d: 1.6, parts: [[-1.2, 0, -0.8, 1.2, 0.01, 0.8, "fabric", 0], [-1.06, 0.01, -0.66, 1.06, 0.014, 0.66, "fabric", 0xe8dcc0]], cols: [], deco: true, plate: "y" },
  // a wall shelf with books and a box on it, hung at 1.5 m (over a bed, a sofa, a desk, a counter: it keeps the floor free)
  wallShelf: { w: 0.9, d: 0.25, parts: [[-0.45, 0, -0.125, 0.45, 0.03, 0.125, "wood", 0], [-0.4, 0.03, -0.1, -0.31, 0.27, 0.08, "fabric", 0xd9534f], [-0.3, 0.03, -0.1, -0.2, 0.25, 0.08, "fabric", 0x428bca],
    [-0.19, 0.03, -0.1, -0.12, 0.26, 0.08, "fabric", 0x5cb85c], [0.08, 0.03, -0.09, 0.36, 0.2, 0.09, "wood", 0xb2875a]], cols: [[0, 1, 2, 3, 4]], mountY: 1.5 },
  // wall dressing: 2 cm thin, drawn only (inside the 2 cm visual tolerance), hung 1.30-2.00 m above the floor on a SOLID wall stretch
  art: { w: 0.9, d: 0.02, parts: [[-0.45, 1.3, -0.01, 0.45, 2.0, 0.0, "wood", 0x3a2e24], [-0.38, 1.37, 0.0, 0.38, 1.93, 0.01, "fabric", 0]], cols: [], deco: true, wall: true, plate: "z" },
  artWide: { w: 1.4, d: 0.02, parts: [[-0.7, 1.35, -0.01, 0.7, 1.95, 0.0, "wood", 0xc9a45a], [-0.63, 1.42, 0.0, 0.63, 1.88, 0.01, "fabric", 0]], cols: [], deco: true, wall: true, plate: "z" },
  mirror: { w: 0.7, d: 0.02, parts: [[-0.35, 1.25, -0.01, 0.35, 2.0, 0.0, "wood", 0xd8d8d8], [-0.3, 1.3, 0.0, 0.3, 1.95, 0.01, "ceramic", 0xa9c7d6]], cols: [], deco: true, wall: true, plate: "z" },
  // (collider groups: split where a single box would leave a big empty volume - under a desk or a table top - but never into a staircase a planner
  // could climb: a chair's seat, a stack of boxes, a hay stack stay one box; interiorcheck's planner walks every top within 0.5 m of the last)
  // ── round 3 (lane H6): the cheap pieces that make rooms DENSE inside the 4k-per-storey budget. A kit piece costs 60-600 triangles; these cost
  // ~10 per box (a box resting on the floor or a host top does not draw its bottom; a plate draws one face). Original art, CC0 by construction.
  // offices: a desk (top + two side panels + a modesty panel), a swivel chair, a monitor (stands on a desk), filing cabinets, lockers, a whiteboard
  deskA: { w: 1.4, d: 0.7, parts: [[-0.7, 0.72, -0.35, 0.7, 0.76, 0.35, "wood", 0], [-0.68, 0, -0.33, -0.63, 0.72, 0.33, "metal", 0x4a4e54], [0.63, 0, -0.33, 0.68, 0.72, 0.33, "metal", 0x4a4e54],
    [-0.63, 0.32, -0.33, 0.63, 0.7, -0.3, "metal", 0x4a4e54]], cols: [[0], [1], [2], [3]], surface: 0.76 },
  officeChair: { w: 0.56, d: 0.56, parts: [[-0.28, 0, -0.28, 0.28, 0.06, 0.28, "metal", 0x26282c], [-0.04, 0.06, -0.04, 0.04, 0.42, 0.04, "metal", 0x6a6e74],
    [-0.25, 0.42, -0.24, 0.25, 0.5, 0.25, "fabric", 0x2f3a4a], [-0.23, 0.5, -0.28, 0.23, 1.02, -0.2, "fabric", 0x2f3a4a]], cols: [[0, 1, 2, 3]] },
  monitor: { w: 0.56, d: 0.2, parts: [[-0.13, 0, -0.1, 0.13, 0.02, 0.06, "metal", 0x26282c], [-0.03, 0.02, -0.07, 0.03, 0.13, -0.03, "metal", 0x26282c],
    [-0.28, 0.13, -0.1, 0.28, 0.45, -0.07, "metal", 0x1a1c20], [-0.26, 0.15, -0.07, 0.26, 0.43, -0.066, "ceramic", 0x2a4a6a]], cols: [[0, 1], [2, 3]], top: true },
  filingCab: { w: 0.48, d: 0.6, parts: [[-0.24, 0, -0.3, 0.24, 1.32, 0.29, "metal", 0x8a9296], [-0.21, 0.06, 0.29, 0.21, 0.46, 0.3, "metal", 0xb0b6ba], [-0.21, 0.5, 0.29, 0.21, 0.9, 0.3, "metal", 0xb0b6ba],
    [-0.21, 0.94, 0.29, 0.21, 1.28, 0.3, "metal", 0xb0b6ba]], cols: [[0, 1, 2, 3]], surface: 1.32 },
  lockers: { w: 1.2, d: 0.5, parts: [[-0.6, 0, -0.25, 0.6, 1.9, 0.24, "metal", 0x6f8a9a], [-0.57, 0.08, 0.24, -0.21, 1.86, 0.25, "metal", 0x86a2b2], [-0.18, 0.08, 0.24, 0.18, 1.86, 0.25, "metal", 0x86a2b2],
    [0.21, 0.08, 0.24, 0.57, 1.86, 0.25, "metal", 0x86a2b2]], cols: [[0, 1, 2, 3]] },
  whiteboard: { w: 1.8, d: 0.02, parts: [[-0.9, 1.0, -0.01, 0.9, 2.0, 0.0, "metal", 0xb8bcc0], [-0.86, 1.04, 0.0, 0.86, 1.96, 0.008, "ceramic", 0xf6f8f8]], cols: [], deco: true, wall: true, plate: "z" },
  clock: { w: 0.36, d: 0.02, parts: [[-0.18, 1.82, -0.01, 0.18, 2.18, 0.0, "wood", 0x2a2c30], [-0.15, 1.85, 0.0, 0.15, 2.15, 0.006, "ceramic", 0xf4f2ea], [-0.012, 1.99, 0.006, 0.012, 2.11, 0.009, "metal", 0x1a1c20]],
    cols: [], deco: true, wall: true, plate: "z", hang: 1.82 },
  poster: { w: 0.62, d: 0.02, parts: [[-0.31, 1.3, -0.01, 0.31, 2.12, 0.0, "fabric", 0], [-0.26, 1.36, 0.0, 0.26, 1.62, 0.005, "fabric", 0xf2f0ea]], cols: [], deco: true, wall: true, plate: "z" },
  // wall-hung storage (at eye height: what a narrow room shows from its doorway): a shelf of boxes on two brackets, a wall cabinet
  wallRack: { w: 1.2, d: 0.36, parts: [[-0.6, 0, -0.18, 0.6, 0.04, 0.18, "metal", 0x6a6e74], [-0.56, 0.04, -0.15, -0.1, 0.34, 0.15, "fabric", 0xb2875a], [-0.02, 0.04, -0.16, 0.52, 0.28, 0.14, "fabric", 0x5a7a9a]],
    cols: [[0, 1, 2]], mountY: 1.45 },
  wallCab: { w: 0.8, d: 0.34, parts: [[-0.4, 0, -0.17, 0.4, 0.62, 0.15, "wood", 0], [-0.38, 0.03, 0.15, -0.01, 0.59, 0.17, "wood", WOODD], [0.01, 0.03, 0.15, 0.38, 0.59, 0.17, "wood", WOODD]], cols: [[0, 1, 2]], mountY: 1.4 },
  // floors: rugs (a border and a field: two plates) and a runner for halls
  rugLarge: { w: 3.0, d: 2.0, parts: [[-1.5, 0, -1.0, 1.5, 0.01, 1.0, "fabric", 0], [-1.35, 0.01, -0.85, 1.35, 0.014, 0.85, "fabric", 0xe8dcc0]], cols: [], deco: true, plate: "y" },
  rugSmall: { w: 1.4, d: 0.9, parts: [[-0.7, 0, -0.45, 0.7, 0.01, 0.45, "fabric", 0], [-0.6, 0.01, -0.35, 0.6, 0.014, 0.35, "fabric", 0xe8dcc0]], cols: [], deco: true, plate: "y" },
  runner: { w: 0.9, d: 2.6, parts: [[-0.45, 0, -1.3, 0.45, 0.01, 1.3, "fabric", 0], [-0.36, 0.01, -1.21, 0.36, 0.014, 1.21, "fabric", 0xd8c8a0]], cols: [], deco: true, plate: "y" },
  // storage: wall racking and free-standing double-sided racks loaded with goods, cartons, loaded pallets, drums
  rackWall: { w: 1.8, d: 0.6, parts: [[-0.9, 0, -0.3, -0.85, 2.1, 0.3, "metal", 0x2f5a8a], [0.85, 0, -0.3, 0.9, 2.1, 0.3, "metal", 0x2f5a8a], [-0.85, 0.12, -0.3, 0.85, 0.16, 0.3, "metal", 0xc06a2a],
    [-0.85, 0.78, -0.3, 0.85, 0.82, 0.3, "metal", 0xc06a2a], [-0.85, 1.44, -0.3, 0.85, 1.48, 0.3, "metal", 0xc06a2a], [-0.85, 2.04, -0.3, 0.85, 2.08, 0.3, "metal", 0xc06a2a],
    [-0.82, 0.16, -0.27, 0.22, 0.72, 0.26, "fabric", 0xb2875a], [0.26, 0.16, -0.26, 0.82, 0.66, 0.25, "fabric", 0x5a7a9a], [-0.82, 0.82, -0.27, 0.82, 1.38, 0.26, "fabric", 0xc49a62],
    [-0.82, 1.48, -0.26, 0.82, 1.96, 0.26, "fabric", 0x8a6a48]], cols: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]] },
  rackRow: { w: 2.2, d: 0.9, parts: [[-1.1, 0, -0.45, -1.05, 2.1, 0.45, "metal", 0x2f5a8a], [1.05, 0, -0.45, 1.1, 2.1, 0.45, "metal", 0x2f5a8a], [-1.05, 0.12, -0.45, 1.05, 0.16, 0.45, "metal", 0xc06a2a],
    [-1.05, 0.78, -0.45, 1.05, 0.82, 0.45, "metal", 0xc06a2a], [-1.05, 1.44, -0.45, 1.05, 1.48, 0.45, "metal", 0xc06a2a], [-1.05, 2.04, -0.45, 1.05, 2.08, 0.45, "metal", 0xc06a2a],
    [-1.0, 0.16, -0.42, 0.0, 0.66, 0.4, "fabric", 0xb2875a], [0.1, 0.16, -0.4, 1.0, 0.6, 0.42, "fabric", 0x6a8a5a], [-0.95, 0.82, -0.4, 0.9, 1.32, 0.4, "fabric", 0xc49a62],
    [-0.9, 1.48, -0.38, 0.4, 1.86, 0.42, "fabric", 0x8a6a48], [0.5, 1.48, -0.4, 1.0, 1.78, 0.38, "fabric", 0xb03a2e]], cols: [[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]] },
  carton: { w: 0.52, d: 0.44, parts: [[-0.26, 0, -0.22, 0.26, 0.42, 0.22, "fabric", 0xb2875a], [-0.05, 0.42, -0.22, 0.05, 0.424, 0.22, "fabric", 0xd8c8a0]], cols: [[0, 1]], surface: 0.424 },
  cartonOpen: { w: 0.6, d: 0.46, parts: [[-0.3, 0, -0.23, 0.3, 0.36, 0.23, "fabric", 0xc49a62], [-0.3, 0.36, -0.23, 0.3, 0.5, -0.2, "fabric", 0xc49a62], [-0.3, 0.36, 0.2, 0.3, 0.5, 0.23, "fabric", 0xc49a62]],
    cols: [[0], [1], [2]] },
  boxStack: { w: 0.7, d: 0.6, parts: [[-0.35, 0, -0.3, 0.35, 0.46, 0.3, "fabric", 0xb2875a], [-0.3, 0.46, -0.26, 0.24, 0.86, 0.22, "fabric", 0xc49a62], [-0.2, 0.86, -0.2, 0.16, 1.14, 0.14, "fabric", 0xa87a4a]],
    cols: [[0, 1, 2]] },
  palletA: { w: 1.2, d: 1.0, parts: [[-0.6, 0.1, -0.5, 0.6, 0.14, 0.5, "wood", 0xc0a070], [-0.6, 0, -0.5, 0.6, 0.1, -0.4, "wood", 0xa88a5a], [-0.6, 0, -0.05, 0.6, 0.1, 0.05, "wood", 0xa88a5a],
    [-0.6, 0, 0.4, 0.6, 0.1, 0.5, "wood", 0xa88a5a]], cols: [[0, 1, 2, 3]], surface: 0.14 },
  palletLoad: { w: 1.2, d: 1.0, parts: [[-0.6, 0.1, -0.5, 0.6, 0.14, 0.5, "wood", 0xc0a070], [-0.6, 0, -0.5, 0.6, 0.1, -0.4, "wood", 0xa88a5a], [-0.6, 0, -0.05, 0.6, 0.1, 0.05, "wood", 0xa88a5a],
    [-0.6, 0, 0.4, 0.6, 0.1, 0.5, "wood", 0xa88a5a], [-0.56, 0.14, -0.46, 0.56, 0.96, 0.46, "fabric", 0], [-0.4, 0.96, -0.3, 0.3, 1.32, 0.34, "fabric", 0xc49a62]], cols: [[0, 1, 2, 3], [4], [5]] },
  drum: { w: 0.6, d: 0.6, parts: [[-0.28, 0, -0.28, 0.28, 0.9, 0.28, "metal", 0], [-0.3, 0.18, -0.3, 0.3, 0.24, 0.3, "metal", 0x3a3e44], [-0.3, 0.64, -0.3, 0.3, 0.7, 0.3, "metal", 0x3a3e44]], cols: [[0, 1, 2]], surface: 0.9 },
  // shops: a drinks cooler with a glass door
  cooler: { w: 0.9, d: 0.75, parts: [[-0.45, 0, -0.375, 0.45, 2.0, -0.3, "metal", 0xe4e6e8], [-0.45, 0, -0.3, -0.41, 2.0, 0.36, "metal", 0xe4e6e8], [0.41, 0, -0.3, 0.45, 2.0, 0.36, "metal", 0xe4e6e8],
    [-0.41, 1.86, -0.3, 0.41, 2.0, 0.36, "metal", 0x2f6f8a], [-0.41, 0, -0.3, 0.41, 0.16, 0.36, "metal", 0x3a3e44], [-0.4, 0.2, -0.28, 0.4, 0.62, 0.3, "fabric", 0xb03a2e],
    [-0.4, 0.74, -0.28, 0.4, 1.16, 0.3, "fabric", 0x3a7a4a], [-0.4, 1.28, -0.28, 0.4, 1.7, 0.3, "fabric", 0xd8a03a], [-0.41, 0.16, 0.36, 0.41, 1.86, 0.375, "glass", 0x9fc4d6]],
    cols: [[0, 1, 2, 3, 4, 5, 6, 7, 8]] },
  // the rest: a trestle table, a stool, a dresser, a washer, a coat stand, a workbench, hay, sacks, rubble, a machine
  tableA: { w: 1.6, d: 0.9, parts: [[-0.8, 0.7, -0.45, 0.8, 0.76, 0.45, "wood", 0], [-0.7, 0, -0.38, -0.62, 0.7, 0.38, "wood", WOODD], [0.62, 0, -0.38, 0.7, 0.7, 0.38, "wood", WOODD]], cols: [[0], [1], [2]], surface: 0.76 },
  stoolA: { w: 0.4, d: 0.4, parts: [[-0.2, 0.62, -0.2, 0.2, 0.68, 0.2, "wood", 0], [-0.04, 0, -0.04, 0.04, 0.62, 0.04, "metal", 0x55585c], [-0.16, 0, -0.16, 0.16, 0.03, 0.16, "metal", 0x55585c]], cols: [[0, 1, 2]] },
  dresserA: { w: 1.1, d: 0.48, parts: [[-0.55, 0, -0.24, 0.55, 0.84, 0.23, "wood", 0], [-0.5, 0.06, 0.23, 0.5, 0.3, 0.24, "wood", WOODD], [-0.5, 0.33, 0.23, 0.5, 0.57, 0.24, "wood", WOODD],
    [-0.5, 0.6, 0.23, 0.5, 0.8, 0.24, "wood", WOODD]], cols: [[0, 1, 2, 3]], surface: 0.84 },
  washer: { w: 0.62, d: 0.62, parts: [[-0.31, 0, -0.31, 0.31, 0.88, 0.3, "metal", 0xeceeee], [-0.2, 0.3, 0.3, 0.2, 0.7, 0.31, "ceramic", 0x6a8a9a]], cols: [[0, 1]], surface: 0.88 },
  coatRackA: { w: 0.5, d: 0.5, parts: [[-0.22, 0, -0.22, 0.22, 0.04, 0.22, "wood", WOODD], [-0.03, 0.04, -0.03, 0.03, 1.75, 0.03, "wood", WOODD], [-0.2, 1.4, -0.12, 0.2, 1.62, 0.12, "fabric", 0x3a4a6a]], cols: [[0], [1], [2]] },
  workbench: { w: 2.0, d: 0.8, parts: [[-1.0, 0.86, -0.4, 1.0, 0.94, 0.4, "wood", 0x8a6a48], [-0.95, 0, -0.36, -0.88, 0.86, 0.36, "wood", 0x6e5232], [0.88, 0, -0.36, 0.95, 0.86, 0.36, "wood", 0x6e5232],
    [-0.88, 0.16, -0.36, 0.88, 0.2, 0.36, "wood", 0x6e5232], [0.55, 0.94, -0.3, 0.8, 1.1, -0.05, "metal", 0x3a5a3a], [-0.7, 0.2, -0.3, -0.1, 0.5, 0.3, "fabric", 0xb2875a]], cols: [[0], [1], [2], [3], [4], [5]] },
  hayBale: { w: 1.1, d: 0.56, parts: [[-0.55, 0, -0.28, 0.55, 0.46, 0.28, "fabric", 0xd2b45a], [-0.3, 0, -0.282, -0.26, 0.462, 0.282, "fabric", 0x9a7a3a], [0.26, 0, -0.282, 0.3, 0.462, 0.282, "fabric", 0x9a7a3a]],
    cols: [[0, 1, 2]], surface: 0.462 },
  hayStack: { w: 1.12, d: 1.12, parts: [[-0.56, 0, -0.56, 0.56, 0.46, 0.0, "fabric", 0xd2b45a], [-0.56, 0, 0.0, 0.56, 0.46, 0.56, "fabric", 0xc8a850], [-0.55, 0.46, -0.28, 0.55, 0.92, 0.28, "fabric", 0xd8bc62]],
    cols: [[0, 1, 2]] },
  sacks: { w: 1.0, d: 0.7, parts: [[-0.5, 0, -0.35, 0.0, 0.3, 0.35, "fabric", 0xd8cfb4], [0.0, 0, -0.33, 0.48, 0.28, 0.33, "fabric", 0xcfc4a6], [-0.3, 0.3, -0.3, 0.25, 0.56, 0.3, "fabric", 0xd8cfb4]],
    cols: [[0, 1], [2]] },
  rubble: { w: 1.5, d: 1.1, parts: [[-0.75, 0, -0.55, 0.75, 0.22, 0.55, "plaster", 0x8a8478], [-0.5, 0.22, -0.35, 0.25, 0.42, 0.3, "plaster", 0x9a9488], [0.1, 0.22, -0.2, 0.6, 0.32, 0.4, "wood", 0x6e5232]],
    cols: [[0], [1], [2]] },
  // (stage B, lane I1: every part its own exact collider - round 3's [[0, 1], ...] made the plinth + body ONE box, a 0.40 x 0.53 m invisible block beside the motor;
  //  the motor is 0.78 m over the plinth so plinth -> motor -> body is not a staircase of <= 0.55 m steps)
  machine: { w: 1.7, d: 1.0, parts: [[-0.85, 0, -0.5, 0.85, 0.2, 0.5, "metal", 0x3a3e44], [-0.75, 0.2, -0.42, 0.45, 1.25, 0.42, "metal", 0x4f7a5a], [0.48, 0.2, -0.26, 0.8, 0.98, 0.26, "metal", 0x55585c],
    [-0.5, 1.25, -0.3, 0.2, 1.55, 0.3, "metal", 0x6a7a6e], [-0.2, 0.6, 0.42, 0.25, 0.95, 0.44, "ceramic", 0xd8a03a]], cols: [[0], [1], [2], [3], [4]] },
};

// The catalogs: every placeable piece type. src kit = a manifest type (dims from KIT_BOXES); src box = AUTH. surface = the top a loot item can sit on.
// Two kit PROFILES (generate(parcel, { kit })): "base" = the 16 Kenney furniture types shipped since Wave 4 + authored boxes for what they lack (bed,
// bathroom, wardrobe, kitchen cabinets, shelving); "interior" (the default) = the same with lane H2's Kenney pieces in place of the authored bed, nightstand,
// wardrobe, bathroom set, kitchen cabinets, cooker, shelving and rug, plus a floor lamp and an armchair. Same recipes, same rng draws per decision.
// authored pieces: their footprint is the EXACT extent of their parts (recentred on the origin), so a piece placed against a wall touches it and
// never reaches into it (round 1 sized a few by a nominal w / d: shop counters and crates stood 1-2 cm inside the wall)
for (const A of Object.values(AUTH)) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of A.parts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[3]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[5]); }
  A.ox = r3((x0 + x1) / 2); A.oz = r3((z0 + z1) / 2); A.w = r3(x1 - x0); A.d = r3(z1 - z0);
}
// an authored piece's drawn triangles: a plate draws one face; a box standing on the floor (or on its host's top) does not draw its bottom
const authTris = (a) => a.parts.reduce((n, pt) => n + (a.plate ? 2 : pt[1] === 0 && !a.mountY ? 10 : 12), 0);
function buildCatalog(over, remap) {
  const C = {};
  const kit = (id, type, surface, extra) => { const b = KIT_BOXES[type]; C[id] = Object.assign({ id, src: "kit", type, w: r3(b.max[0] - b.min[0]), d: r3(b.max[2] - b.min[2]), h: b.max[1], tris: b.tris, surface: surface || null, deco: !!b.deco, mount: "floor", y0: 0 }, extra || {}); };
  kit("bookcase", "furniture/bookcaseClosed");
  kit("tv", "furniture/cabinetTelevision", 0.682);
  kit("box", "furniture/cardboardBoxClosed", 0.618);
  kit("chair", "furniture/chair");
  kit("chairDesk", "furniture/chairDesk");
  kit("desk", "furniture/desk", 0.846);
  kit("fridge", "furniture/kitchenFridge");
  kit("sink", "furniture/kitchenSink", 0.95);
  kit("stove", "furniture/kitchenStove", 0.99);
  kit("sofa", "furniture/loungeSofa");
  kit("plant", "furniture/pottedPlant");
  kit("sideTable", "furniture/sideTable", 0.846);
  kit("stool", "furniture/stoolBar");
  kit("table", "furniture/table", 0.719);
  kit("coffee", "furniture/tableCoffee", 0.506);
  kit("trash", "furniture/trashcan");
  for (const id of Object.keys(AUTH)) {
    const a = AUTH[id];
    let h = 0;
    for (const p of a.parts) h = Math.max(h, p[4]);
    // lowTop: the lowest top among its colliders (a toilet's bowl, 0.46, under its 0.8 tank): what a planner may step onto
    const lowTop = a.cols.length ? Math.min(...a.cols.map((g) => Math.max(...g.map((k) => a.parts[k][4])))) : r3(h);
    C[id] = { id, auth: id, src: "box", type: "box/" + id, w: a.w, d: a.d, h: r3(h), lowTop: r3(lowTop), tris: authTris(a), surface: a.surface || null, deco: !!a.deco, wall: !!a.wall, mount: a.mountY ? "wall" : a.top ? "top" : "floor", y0: a.mountY || 0 };
  }
  // alt: the piece it replaces (an authored stand-in): the furnisher takes it when the room's / storey's triangle budget cannot take the kit piece
  for (const [id, type, surface, extra] of over || []) { const prev = C[id]; kit(id, type, surface, extra); if (prev) C[id].alt = prev; }
  // remap: a recipe's id served by another catalog piece (round 3: the interior profile places cheap authored pieces where the base kit had
  // expensive or one-off GLBs - the placed kit stays <= ~0.3 MB of downloads); cat.id stays the recipe's id, cat.auth / cat.type say what is drawn
  for (const [id, to] of Object.entries(remap || {})) C[id] = Object.assign({}, C[to], { id });
  return C;
}
export const CATALOGS = {
  base: buildCatalog(),
  // round 3 (lane H6): the interior profile keeps 31 kit GLBs (the pieces whose shape a box cannot fake: beds, the bathroom and kitchen sets, sofas,
  // armchairs, TVs, bookcases, plants, lamps, dining chairs) = ~245 KB of downloads; everything else is an authored piece (remap)
  interior: buildCatalog([["bed", "furniture/bedDouble", 0.825], ["bedSingle", "furniture/bedSingle", 0.825], ["nightstand", "furniture/cabinetBed", 0.513],
    ["wardrobe", "furniture/bookcaseClosedDoors"], ["toilet", "furniture/toilet"], ["basin", "furniture/bathroomSinkSquare"],
    ["counter", "furniture/kitchenCabinet", 0.99], ["stoveBox", "furniture/kitchenStoveElectric", 0.99], ["lamp", "furniture/lampRoundFloor"], ["armchair", "furniture/loungeChair"],
    ["upper", "furniture/kitchenCabinetUpper", null, { mount: "wall", y0: 1.45 }], ["microwave", "furniture/kitchenMicrowave", null, { mount: "top" }],
    ["tvSet", "furniture/televisionModern", null, { mount: "top" }], ["sofaDesign", "furniture/loungeDesignSofa"],
    ["coffeeSq", "furniture/tableCoffeeSquare", 0.506], ["bookcaseOpen", "furniture/bookcaseOpen"], ["lampSq", "furniture/lampSquareFloor"], ["lampTable", "furniture/lampSquareTable", null, { mount: "top" }],
    ["nightLow", "furniture/cabinetBed", 0.513], ["bathCab", "furniture/bathroomCabinet", null, { mount: "wall", y0: 1.35 }],
    ["tableCloth", "furniture/tableCloth", 0.719], ["chairMod", "furniture/chairModernCushion"], ["plantSmall", "furniture/plantSmall1", null, { mount: "top" }]],
  { box: "carton", boxOpen: "cartonOpen", chair: "chairMod", chairDesk: "officeChair", desk: "deskA", stove: "stoveBox", stool: "stoolA", coffee: "coffeeSq", screen: "monitor",
    ottoman: "stoolA", rack: "rackWall", pallet: "palletA", rugRect: "rugLarge", rugRound: "rugLarge", dresser: "dresserA", dryer: "washer", drawerCab: "counter", tableCross: "tableA",
    bookcaseLow: "shelfLow", bookcaseWide: "bookcase", coatRack: "coatRackA" }),
};
// the base profile has no round-2 kit types: a recipe asking for one gets the nearest piece the profile has (or nothing)
const ALIAS = { rack: "shelf", lampSq: "plant", lamp: "plant", bookcaseLow: "shelfLow", bookcaseOpen: "bookcase", bookcaseWide: "bookcase", sofaDesign: "sofa", dresser: "sideTable",
  nightLow: "nightstand", drawerCab: "counter", chairMod: "chair", tableCross: "table", tableCloth: "table", coffeeSq: "coffee", boxOpen: "box", armchair: "chair", coatRack: "plant" };
// a room's share of its storey's triangle budget is weighted by what it must hold (a kitchen's counter row and dining set cost ~1,400 triangles,
// a bathroom's set is mostly authored boxes, a hall holds a lamp and a plant)
const SHAREW = { ruin: 0.8, kitchen: 2.0, living: 1.5, shop: 1.5, lobby: 1.3, bedroom: 1.2, meeting: 1.2, office: 1.0, warehouse: 1.0, barn: 1.0, storage: 0.7, bath: 0.8, hall: 0.5 };
// phase 3's last resort: what may stand free in the open floor a doorway looks at
const FREEPOOL = { living: ["armchair", "ottoman", "lampSq", "plant"], bedroom: ["chairMod", "lampSq", "plant"], kitchen: ["chairMod", "stool", "trash"], bath: ["trash", "plant"],
  office: ["chairMod", "plant", "box"], storage: ["boxStack", "crate", "carton"], ruin: ["rubble", "crate", "carton"], warehouse: ["box", "crate", "crateStack"], barn: ["crate", "box", "crateStack"], shop: ["box", "crate", "boxOpen"],
  lobby: ["armchair", "plant", "lampSq"], meeting: ["chairMod", "plant"], hall: ["plant", "lampSq"] };
// (stage B) the small pieces the rescue pass may add to any room still short of 3 of its own pieces in view
const RESCUE = ["wallShelf", "wallCab", "plant", "lampSq", "trash", "sideTable", "bookcaseLow", "filingCab", "chairMod", "box"];
// (stage B) the low clutter a mover steps onto in passing (lowest top 0.2 .. 0.55 m): never within 0.9 m of a piece one more step up (see stairsOK)
const VIS_PTS = new Float64Array(30);      // (the view model's sample points: one buffer, generate() is synchronous)
const STEP_CLUTTER = new Set(["rubble", "carton", "cartonOpen", "sacks", "hayBale", "boxStack", "box", "boxOpen", "palletLoad"]);
// pieces nothing is stood on (a lamp on a bed, a box on a crate stack): everything else with a flat top may carry a lamp / a small plant / a box
const NOHOST = new Set(["rubble", "hayStack", "sacks", "palletLoad", "boxStack", "cartonOpen", "officeChair", "stoolA", "deskA", "bed", "bedSingle", "sofa", "sofaDesign", "chair", "chairMod", "chairDesk", "stool", "armchair", "ottoman", "crateStack", "bathtub", "toilet", "basin", "sink", "gondola", "shelfLow", "pallet"]);
// phase 3 (in view of the best entrance): the cheap pieces each kind of room may still take, in order
const VIEWPOOL = {
  living: ["lampSq", "plant", "armchair", "sideTable", "wallShelf", "bookcaseLow", "trash", "plant", "wallCab"],
  kitchen: ["trash", "plant", "wallShelf", "wallCab", "bookcaseLow", "lampSq", "stool", "chairMod", "box"],
  bedroom: ["lampSq", "plant", "nightLow", "wallShelf", "sideTable", "bookcaseLow", "trash", "armchair", "wallCab", "box"],
  bath: ["trash", "bathCab", "plant", "wallShelf", "lampSq", "bookcaseLow", "box"],
  office: ["plant", "filingCab", "lampSq", "wallShelf", "box", "bookcaseLow", "trash", "boxStack", "lockers", "wallCab"],
  shop: ["boxStack", "cartonOpen", "crate", "plant", "trash", "bookcaseLow", "stool", "cooler"],
  storage: ["boxStack", "wallRack", "carton", "crate", "drum", "rackWall", "wallShelf", "palletLoad", "carton", "wallCab", "trash", "wallRack"],
  warehouse: ["boxStack", "crate", "crateStack", "drum", "rackWall", "wallRack", "palletLoad", "carton", "trash"],
  barn: ["hayBale", "crate", "sacks", "boxStack", "drum", "carton", "crateStack"],
  ruin: ["crate", "cartonOpen", "carton", "drum", "rubble", "crateStack", "shelfLow", "wallShelf", "wallCab"],
  lobby: ["plant", "lampSq", "armchair", "wallShelf", "bookcaseLow", "trash", "plant", "wallCab"],
  meeting: ["plant", "lampSq", "wallShelf", "bookcaseLow", "trash", "filingCab", "wallCab"],
  hall: ["lampSq", "plant", "trash", "wallShelf", "bookcaseLow", "sideTable", "plant", "wallCab", "lampSq", "box", "chairMod"],
};
export const DEFAULT_KIT = "interior";
export const CATALOG = CATALOGS[DEFAULT_KIT];

// ── themes ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// round 3 (lane H6): every theme towngen emits (city / resort / lodge towns, farm / ruin / mill compounds) has its own look. roofs: weights of
// flat (parapet + cornice) / gable (two C-RAMP planks over a sealed attic) / hip (stepped tiers: L plans); pitch = the gable's slope in degrees
// (<= 45: the sim's ramp rule); base: the ground floor's own facade (two-tone fronts) with its probability; porch / canopy / balcony / belts /
// chimney / sills: the exterior relief each theme wears (every piece an exact collider box, drawn == collider).
export const THEMES = {
  city: { facadeMat: ["brick", "brick", "plaster"], facade: { brick: [0xa4553f, 0x8e4a3a, 0xb86f52, 0x9a5a48, 0x7e3f33, 0xb5644a], plaster: [0xd8cdb8, 0xbfc6c9, 0xc9b79a, 0xd6d0c4, 0xc4b2a0, 0xa9b4b8] },
    trim: [0xede6d6, 0xdcd6c8, 0xc9c2b4], roofs: { flat: 0.7, gable: 0.3 }, pitch: 30, roofC: [0x6b6e70, 0x5f6366, 0x7a4a3a, 0x4f5559], shop: 0.35, L: 0.3, win: 0.62, backDoor: 0.6,
    interiorMat: "plaster", base: { p: 0.55, mat: ["plaster", "stone"], color: [0xcfc6b4, 0xa8a196, 0x8f8a82, 0xd8d2c4] }, porch: 0, canopy: 0.8, balcony: 0.25, belts: 0.85, pilasters: 0.6, chimney: 0.5, shutters: 0, awning: 0.9 },
  resort: { facadeMat: ["stucco"], facade: { stucco: [0xf2a48f, 0xa8dcc8, 0x8ccbd9, 0xf4d27a, 0xf0e4d0, 0xe9a8b8, 0xd9c7f0, 0xf7e9c4] },
    trim: [0xffffff, 0xf7f3ea], roofs: { flat: 0.45, gable: 0.55 }, pitch: 22, roofC: [0xc0623b, 0xb5573a, 0xa94e32, 0xd07a4a], shop: 0.15, L: 0.5, win: 0.72, backDoor: 0.7,
    interiorMat: "plaster", base: { p: 0.3, mat: ["stucco"], color: [0xffffff, 0xf3ece0] }, porch: 0.35, canopy: 0.5, balcony: 0.6, belts: 0.5, pilasters: 0.3, chimney: 0.1, shutters: 0.75, awning: 0.9 },
  lodge: { facadeMat: ["plank"], facade: { plank: [0x7a5234, 0x8e5e3b, 0x6e7b4f, 0x9c8b70, 0x5e6b4a, 0x8b3a2e, 0x6a4a36, 0x857a66] },
    trim: [0xe8e0cc, 0x3a2e24], roofs: { gable: 0.9, flat: 0.1 }, pitch: 38, roofC: [0x4a3f38, 0x3e4a3a, 0x5a3a2c, 0x34383c], shop: 0.1, L: 0.4, win: 0.55, backDoor: 0.5,
    interiorMat: "plank", base: { p: 0.65, mat: ["stone"], color: [0x8a8278, 0x7a7468, 0x9a9186] }, porch: 0.6, canopy: 0.3, balcony: 0.2, belts: 0.4, pilasters: 0.5, chimney: 0.85, shutters: 0.75, awning: 0.4 },
  farm: { facadeMat: ["plank"], facade: { plank: [0x9b2d24, 0xece6d8, 0xe2d3a8, 0x8fa38a, 0x7f93a3, 0xb03a2e, 0xd8cfbf] },
    trim: [0xf4f0e6, 0xe8e0cc], roofs: { gable: 1 }, pitch: 40, roofC: [0x4b4f52, 0x6e3a2e, 0x55606a, 0x3f5a46], shop: 0.05, L: 0.35, win: 0.55, backDoor: 0.8,
    interiorMat: "plank", base: { p: 0.45, mat: ["stone"], color: [0x8a8278, 0x9a9186] }, porch: 0.75, canopy: 0.3, balcony: 0, belts: 0.2, pilasters: 0.3, chimney: 0.8, shutters: 0.6, awning: 0.2 },
  ruin: { facadeMat: ["stone"], facade: { stone: [0xc4b9a2, 0xb6ab95, 0xcdc1a9, 0xa99e8a, 0xbdb095] },      // (K1: sun-bleached limestone - the old 0x7d-0xa8 greys read as dark olive boxes on the volcano)
    trim: [0x6e6a62, 0x7c766a], roofs: { flat: 1 }, pitch: 30, roofC: [0x7c7468, 0x6e675d], shop: 0, L: 0.5, win: 0.6, backDoor: 0.7,
    interiorMat: "plaster", base: { p: 0.5, mat: ["stone"], color: [0x6f6a60, 0x5f5b54] }, porch: 0, canopy: 0, balcony: 0, belts: 0.6, pilasters: 0.7, chimney: 0, shutters: 0, awning: 0, ruined: true },
  mill: { facadeMat: ["brick", "sheet"], facade: { brick: [0x8e4a3a, 0x7e3f33, 0x9a5a48], sheet: [0x8a9296, 0x6f7f74, 0x9a6a4a, 0xb0b4b0] },
    trim: [0xd8d2c4, 0x55606a], roofs: { gable: 0.7, flat: 0.3 }, pitch: 18, roofC: [0x6b6e70, 0x7a8086, 0x8a5a40], shop: 0, L: 0.2, win: 0.5, backDoor: 0.8,
    interiorMat: "plaster", base: { p: 0.5, mat: ["stone", "plaster"], color: [0x8f8a82, 0x9c978e] }, porch: 0, canopy: 0.6, balcony: 0, belts: 0.5, pilasters: 0.6, chimney: 0.5, shutters: 0, awning: 0.3 },
};
const ROOMSTYLE = {
  living: { wall: [0xe9dcc6, 0xe3d3bd, 0xdfe2d5], floor: "floor_wood", fc: [0xb98a5a, 0xa87b50] },
  kitchen: { wall: [0xf1efe6, 0xeae7da], floor: "floor_tile", fc: [0xd8d2c4, 0xc9cfd2] },
  bedroom: { wall: [0xc9d9e6, 0xd9e6cf, 0xebd3d3, 0xe6dfc9], floor: "floor_wood", fc: [0xa87b50, 0x93684a] },
  bath: { wall: [0xcfe7e6, 0xdfeef0], floor: "floor_tile", fc: [0xe6eef0, 0xd6e4e8] },
  office: { wall: [0xd9d6cf, 0xcfd6d9], floor: "floor_wood", fc: [0x8e6e50, 0x7d6450] },
  shop: { wall: [0xf4f2ec, 0xeef0f2], floor: "floor_tile", fc: [0xc9c5bc, 0xd7d2c6] },
  storage: { wall: [0xbdb8ae, 0xb3b0a8], floor: "floor_concrete", fc: [0x9c978e, 0x8f8b84] },
  hall: { wall: [0xe6dccb, 0xdcd6ca], floor: "floor_wood", fc: [0xb08458, 0xa0784e] },
  lobby: { wall: [0xeeeae2, 0xe2e6e8], floor: "floor_tile", fc: [0xd9d4ca, 0xc9ccce] },
  meeting: { wall: [0xdcdfe2, 0xe6e0d4], floor: "floor_wood", fc: [0x8e6e50, 0x9a7a58] },
  warehouse: { wall: [0xc4c0b8, 0xb8bcbf], floor: "floor_concrete", fc: [0xa09b92, 0x8f8f8a] },
  barn: { wall: [0xa8865e, 0x9c7a52], floor: "floor_wood", fc: [0x8a6a48, 0x7a5c3e] },
  ruin: { wall: [0x8a857a, 0x7a766c, 0x9a9282], floor: "floor_concrete", fc: [0x6f6a60, 0x7d776c] },
};
const LODGE_INNER = [0xc79a6a, 0xb98d5f, 0xd2a878];
const RUG = [0x8a3b3b, 0x3b5a8a, 0x6a8a3b, 0xb07a3a, 0x5a3b6a, 0x2f6f6a];
const TINT_WOOD = [0x9a6b43, 0x7d5435, 0xb2875a, 0x5e4430];
const ART = [0x2f5f8a, 0xc0563a, 0x6a8a3b, 0xd9b44a, 0x7a4a8a, 0x3a8a7a, 0xe0d6c0, 0x8a3b3b];
const BLANKET = [0x3b5a8a, 0x8a3b3b, 0x6a8a5a, 0xd0a040, 0x6a4a7a, 0x2f6f6a];

// ── the generator ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function normParcel(p) {
  p = p || {};
  const theme = THEMES[p.theme] ? p.theme : "city";
  let turn = (((Math.round(+p.turn || 0)) % 4) + 4) % 4;
  let w = +p.w > 0 ? +p.w : 10, d = +p.d > 0 ? +p.d : 10;
  const sk = typeof p.street === "string" ? ({ front: 0, right: 1, back: 2, left: 3 }[p.street] || 0) : Number.isInteger(p.street) ? ((p.street % 4) + 4) % 4 : 0;
  if (sk) { turn = (turn + sk) % 4; if (sk % 2) { const t = w; w = d; d = t; } }
  const fhIn = +(p.fh != null ? p.fh : p.floorH);
  return {
    id: String(p.id != null ? p.id : "house"), cx: +p.cx || 0, cz: +p.cz || 0, y: +p.y || 0, turn, theme, themeAsked: p.theme == null ? null : String(p.theme),
    nx: clamp(Math.round(w / U), MIN_CELLS, MAX_CELLS), nz: clamp(Math.round(d / U), MIN_CELLS, MAX_CELLS),
    storeysAsked: clamp(Math.round(+p.storeys || +p.floors || 1), 1, MAX_FLOORS + MAX_SHELL), seed: (+p.seed || 0) >>> 0,
    use: USES.includes(p.use) ? p.use : null, plan: p.plan === "rect" || p.plan === "L" ? p.plan : "auto",
    fh: fhIn > 0 ? clamp(Math.round(fhIn * 100) / 100, FH_MIN, FH_MAX) : null,
    // (stage B, lane I1) a caller's own colours for the facade and the roof (0xRRGGBB): Savanna's towns keep their block palettes (maps.js cityPalette). The theme's
    // dice are still drawn (the rest of the house is the same house), the picked colours are replaced.
    facadeColor: p.facadeColor != null && isFinite(+p.facadeColor) ? (+p.facadeColor >>> 0) & 0xffffff : null,
    roofColor: p.roofColor != null && isFinite(+p.roofColor) ? (+p.roofColor >>> 0) & 0xffffff : null,
    // (Wave 8 fix round, lane K1) the caller's other buildings round this one, world rects [x0, z0, x1, z1]: no street / back door opens onto one of them closer
    // than DOOR_OUT (an alley narrower than a doorway's approach; verify_b: 11 Savanna downtown back doors faced a tower wall 1-3 m away)
    near: Array.isArray(p.near) ? p.near.filter((q) => Array.isArray(q) && q.length === 4 && q.every((v) => isFinite(+v))).map((q) => q.map(Number)) : null,
  };
}
export const DOOR_OUT = 4.0;               // m of open ground in front of a street / back door (the approach a walker starts from 3.5 m out + a capsule)

/** generate(parcel) -> house (see the header) */
export function generate(parcel, opts) {
  const P = normParcel(parcel);
  const kitProfile = opts && CATALOGS[opts.kit] ? opts.kit : DEFAULT_KIT, CATALOG = CATALOGS[kitProfile];
  const rng = subRng(P.seed, P.id, "house");
  const TH = THEMES[P.theme];
  const rr5 = TH.ruined ? subRng(P.seed, P.id, "ruin") : null;          // (K1) a ruin's wreckage: its own stream (the house's rooms and furniture keep theirs)
  const { nx, nz } = P;
  const W = nx * U, D = nz * U;
  const notes = [];
  if (P.themeAsked != null && P.themeAsked !== P.theme) notes.push("theme " + P.themeAsked + " unknown -> city");
  const uL = (i) => -W / 2 + i * U, vL = (j) => -D / 2 + j * U;
  const cIdx = (i, j) => j * nx + i;
  const cellAt = (i, j) => (i >= 0 && j >= 0 && i < nx && j < nz ? cIdx(i, j) : -1);

  // ---- use (it sets the storey height), storeys and stair strips
  const use = P.use || (rng() < TH.shop ? "shop" : "house");
  const FHu = P.fh != null ? P.fh : USE_FH[use];
  const tall = use === "tower" || use === "midrise";      // tall shells: the storeys over the walkable ones (O3) stay CLOSED
  const store = use === "shop" && nx >= 11 && nz >= 8;    // (P23 / LC-29) a DEPARTMENT STORE (towngen's Old Mall, 30 x 22.5 m; no other shop is that wide): big trading floors on every storey, no flat upstairs
  let S = Math.min(P.storeysAsked, MAX_FLOORS);
  if (P.storeysAsked > MAX_FLOORS && !tall) notes.push("storeys " + P.storeysAsked + " -> " + MAX_FLOORS + " (O3: <= 3 walkable floors)");
  if (S >= 2 && FHu > STAIR_MAX_RISE + 1e-9) { notes.push("storeys " + S + " -> 1: a " + FHu + " m storey is too tall for a 5 m stair"); S = 1; }
  if (S >= 2 && (use === "shed" || use === "barn" || use === "hall")) { notes.push("storeys " + S + " -> 1: a " + use + " has one floor (towngen)"); S = 1; }
  const S0 = S;
  const strips = [];                                     // { axis 'col'|'row', at, L }
  if (S >= 2) {
    if (nz >= 4) strips.push({ axis: "col", at: rng() < 0.5 ? 0 : nx - 1, L: nz });
    else if (nx >= 4) { strips.push({ axis: "row", at: 0, L: nx }); if (S > 2) { S = 2; notes.push("storeys 3 -> 2: a back-row stair strip only"); } }
    else { S = 1; notes.push("storeys " + P.storeysAsked + " -> 1: plan too small for a stair (needs 4 cells deep or wide)"); }
  }
  if (S === 3) {
    if (strips[0].axis === "col" && nx >= 4) strips.push({ axis: "col", at: strips[0].at === 0 ? nx - 1 : 0, L: nz });
    else { S = 2; notes.push("storeys 3 -> 2: needs 4 cells wide for the second stair strip"); }
  }
  // closed storeys: a tower / mid-rise keeps its asked height (the walkable floors it could not have become closed shell storeys)
  const shell = tall ? clamp(P.storeysAsked - S, 0, MAX_SHELL) : 0;
  if (tall && S < S0) notes.push("storeys " + S0 + " walkable -> " + S + " (+ " + (S0 - S) + " closed)");
  const stripCell = (s, k) => (s.axis === "col" ? [s.at, k] : [k, s.at]);
  // stairs: stair f climbs floor f -> f + 1 in strip f % strips.length at positions k, k + 1 (rising toward position k)
  const stairs = [];
  for (let f = 0; f < S - 1; f++) {
    const st = strips[f % strips.length];
    const k = rint(rng, 1, st.L - 3);
    stairs.push({ f, strip: f % strips.length, k });
  }

  // ---- footprint (rectangle or L: a back corner removed)
  let cut = null;
  const wantL = P.plan === "L" ? true : P.plan === "rect" ? false : rng() < TH.L;
  if (wantL && !tall && !store && S <= 2 && nx >= 4 && nz >= 4 && (!strips.length || strips[0].axis === "col")) {
    const side = strips.length ? (strips[0].at === 0 ? 1 : 0) : (rng() < 0.5 ? 0 : 1);       // 0 = cut on the -u side, 1 = +u side
    const cw = rint(rng, 1, Math.max(1, Math.min(nx >> 1, nx - 2 - (strips.length ? 1 : 0))));
    const cd = rint(rng, 1, Math.max(1, Math.min(nz >> 1, nz - 2)));
    cut = side ? [nx - cw, 0, nx, cd] : [0, 0, cw, cd];
  } else if (P.plan === "L") notes.push("plan L -> rect (needs >= 4 x 4 cells and <= 2 storeys with a side stair)");
  const inFoot = (i, j) => i >= 0 && j >= 0 && i < nx && j < nz && !(cut && i >= cut[0] && i < cut[2] && j >= cut[1] && j < cut[3]);
  // (lane K1) is the ground in front of an exterior doorway on edge (ori, i, j) free of the caller's other buildings (P.near) for DOOR_OUT? (no rng)
  const qC = COS[P.turn], qS = SIN[P.turn];
  const doorOut = (ori, i, j) => {
    if (!P.near || !P.near.length) return true;
    let u, v, nu, nv;
    if (ori === "H") { u = uL(i) + U / 2; v = vL(j); nu = 0; nv = inFoot(i, j - 1) ? 1 : -1; }
    else { u = uL(i); v = vL(j) + U / 2; nv = 0; nu = inFoot(i - 1, j) ? 1 : -1; }
    for (let k = 0; k <= 9; k++) {
      const dd = T / 2 + 0.2 + (DOOR_OUT - 0.2) * k / 9;
      for (const lat of [-0.9, 0, 0.9]) {
        const pu = u + nu * dd + (ori === "H" ? lat : 0), pv = v + nv * dd + (ori === "H" ? 0 : lat);
        const x = P.cx + pu * qC + pv * qS, z = P.cz - pu * qS + pv * qC;
        for (const q of P.near) if (x > q[0] - 0.2 && x < q[2] + 0.2 && z > q[1] - 0.2 && z < q[3] + 0.2) return false;
      }
    }
    return true;
  };

  // ---- colours
  const fMat = pick(rng, TH.facadeMat), facadeC0 = pick(rng, TH.facade[fMat]), trimC = pick(rng, TH.trim), roofC0 = pick(rng, TH.roofC);
  const facadeC = P.facadeColor != null ? P.facadeColor : facadeC0, roofC = P.roofColor != null ? P.roofColor : roofC0;
  // the roof: flat (parapet), gable (two ramp planks; a barn's is a gambrel, a shed's a lean-to), or stepped hip tiers (an L plan cannot carry one ridge)
  const roofDraw = rng();
  let roofKind = "flat";
  if (!tall) {
    let acc = 0;
    for (const [k, w] of Object.entries(TH.roofs)) { acc += w; if (roofDraw < acc) { roofKind = k; break; } }
    if (roofKind === "gable" && cut) roofKind = "hip";
    if (roofKind === "gable" && use === "barn" && (P.theme === "farm" || P.theme === "lodge")) roofKind = "gambrel";
    else if (roofKind === "gable" && use === "shed" && rng() < 0.6) roofKind = "lean";
  }
  const pitched = roofKind === "gable" || roofKind === "gambrel" || roofKind === "lean";
  const palette = [], palKey = new Map();
  const pal = (mat, color) => { let m = palKey.get(mat); if (!m) { m = new Map(); palKey.set(mat, m); } let i = m.get(color); if (i == null) { i = palette.length; palette.push({ mat, color }); m.set(color, i); } return i; };
  const roofMat = roofKind === "flat" ? "roof_flat" : P.theme === "mill" || (use === "barn" && rng() < 0.5) ? "sheet" : "roof";
  const P_FACADE = pal(fMat, facadeC), P_TRIM = pal("plaster", trimC), P_CEIL = pal("plaster", 0xf4f2ee), P_ROOF = pal(roofMat, roofC);
  // two-tone fronts: the ground floor in its own material (a stone base under planks, a plaster shop floor under brick) on buildings of >= 2 storeys
  const baseOn = TH.base && (S >= 2 || shell > 0) && rng() < TH.base.p;
  const P_BASE = baseOn ? pal(pick(rng, TH.base.mat), pick(rng, TH.base.color)) : P_FACADE;
  // (stage B, lane I1) the stair sides and the stairwell rail are seen from the stair top across the room: a DARK trim colour (a lodge's 0x3a2e24) there was a third of
  // that view near black (interiorcheck light: dark share 0.36); they take a light wood tone when the trim is dark (door / window frames keep the trim colour)
  const trimDark = ((trimC >> 16) & 255) * 0.3 + ((trimC >> 8) & 255) * 0.59 + (trimC & 255) * 0.11 < 100, trimIn = trimDark ? 0xb8a07c : trimC;
  const P_FOUND = pal("plaster", 0x8d8a84), P_STEP = pal("wood", P.theme === "lodge" ? 0x8a5f3c : 0x9c7550), P_STEPSIDE = pal("plaster", trimIn), P_RAIL = pal("plaster", trimIn);
  const innerMat = TH.interiorMat;

  // ---- floor surfaces
  const y0 = P.y, s = []; for (let f = 0; f <= S + shell; f++) s.push(y0 + FLOOR0 + f * FHu);

  // ---- per-floor cells, regions
  const floors = [];
  const rooms = [];
  for (let f = 0; f < S; f++) {
    const type = new Int8Array(nx * nz), stripOf = new Int8Array(nx * nz).fill(-1), region = new Int32Array(nx * nz).fill(-1);
    const approach = new Set(), exit = new Set();
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) type[cIdx(i, j)] = inFoot(i, j) ? 1 : 0;
    const active = new Set();
    for (const st of stairs) {
      const sp = strips[st.strip];
      if (st.f === f) {                                    // the stair itself on its lower floor
        active.add(st.strip);
        for (const k of [st.k, st.k + 1]) { const [i, j] = stripCell(sp, k); type[cIdx(i, j)] = 2; }
        const [ai, aj] = stripCell(sp, st.k + 2); approach.add(cIdx(ai, aj));
      }
      if (st.f + 1 === f) {                                // its hole on the floor above
        active.add(st.strip);
        for (const k of [st.k, st.k + 1]) { const [i, j] = stripCell(sp, k); type[cIdx(i, j)] = 3; }
        const [ei, ej] = stripCell(sp, st.k - 1); exit.add(cIdx(ei, ej));
      }
    }
    for (const si of active) { const sp = strips[si]; for (let k = 0; k < sp.L; k++) { const [i, j] = stripCell(sp, k); stripOf[cIdx(i, j)] = si; } }
    const regs = [];
    // hall segments: runs of walkable cells along each active strip
    for (const si of [...active].sort()) {
      const sp = strips[si];
      let cur = null;
      for (let k = 0; k < sp.L; k++) {
        const [i, j] = stripCell(sp, k), c = cIdx(i, j);
        if (type[c] === 1) { if (!cur) { cur = { hall: true, strip: si, cells: [] }; regs.push(cur); } cur.cells.push(c); }
        else cur = null;
      }
    }
    // the rest: guillotine rooms over the bounding rectangle of the non-strip cells
    let ri0 = 0, ri1 = nx, rj0 = 0, rj1 = nz;
    for (const si of active) { const sp = strips[si]; if (sp.axis === "col") { if (sp.at === 0) ri0 = 1; else ri1 = nx - 1; } else rj0 = 1; }
    let restCells = 0;
    for (let j = rj0; j < rj1; j++) for (let i = ri0; i < ri1; i++) if (type[cIdx(i, j)] === 1) restCells++;
    // about one room per 4 cells (25 m2): PUBG-sized rooms, cleared one by one, not 40 m2 halls
    const target = use === "shed" ? 1 : use === "barn" ? (restCells >= 24 ? 2 : 1) : use === "hall" ? (restCells >= 24 ? 3 : 2)
      : store ? clamp(Math.round(restCells / 14), 2, 4)
        : use === "shop" && f === 0 ? (restCells >= 12 ? 2 : 1) : clamp(Math.round(restCells / 4), 1, 6);
    const rects = guillotine(rng, ri0, rj0, ri1, rj1, target);
    for (const r of rects) {
      const cells = [];
      for (let j = r[1]; j < r[3]; j++) for (let i = r[0]; i < r[2]; i++) { const c = cIdx(i, j); if (type[c] === 1 && stripOf[c] < 0) cells.push(c); }
      if (cells.length) regs.push({ hall: false, strip: -1, cells, rect: r });
    }
    // a stair LANDING (a hall segment of <= 2 cells: the approach or the exit with a cell beside it) opens into the room beside it instead of being a
    // closet of its own: the stair rises out of that room (its flank walls stay, an upper hole keeps its walls and gets half-walls where it opens)
    for (let ri = 0; ri < regs.length; ri++) for (const c of regs[ri].cells) region[c] = ri;
    for (const h of regs) {
      if (!h.hall || h.cells.length > 2) continue;
      const score = new Map();
      for (const c of h.cells) {
        const i = c % nx, j = (c - i) / nx;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = cellAt(i + di, j + dj);
          if (n < 0 || type[n] !== 1 || stripOf[n] >= 0) continue;
          const r = regs[region[n]];
          if (r && !r.hall) score.set(region[n], (score.get(region[n]) || 0) + 1);
        }
      }
      // the neighbour it shares most walls with, preferring one whose merged outline still has its middle INSIDE the room (an L or U whose middle
      // is a neighbour's corner reads from a stair top as a wall: the landing goes to the next neighbour then)
      const order = [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
      if (!order.length) continue;
      const midInside = (cells) => {
        let i0 = 1e9, j0 = 1e9, i1 = -1, j1 = -1;
        for (const c of cells) { const i = c % nx, j = (c - i) / nx; i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i + 1); j1 = Math.max(j1, j + 1); }
        const set = new Set(cells), mi = (i0 + i1) / 2, mj = (j0 + j1) / 2;
        for (const i of Number.isInteger(mi) ? [mi - 1, mi] : [Math.floor(mi)]) for (const j of Number.isInteger(mj) ? [mj - 1, mj] : [Math.floor(mj)]) if (!set.has(cIdx(i, j))) return false;
        return true;
      };
      let best = order[0][0];
      for (const [r] of order) if (midInside(regs[r].cells.concat(h.cells))) { best = r; break; }
      for (const c of h.cells) regs[best].cells.push(c);
      regs[best].landing = true;
      h.cells = [];
    }
    for (let ri = regs.length - 1; ri >= 0; ri--) if (!regs[ri].cells.length) regs.splice(ri, 1);
    region.fill(-1);
    for (let ri = 0; ri < regs.length; ri++) for (const c of regs[ri].cells) region[c] = ri;
    floors.push({ f, type, stripOf, region, approach, exit, regs, active });
  }

  // ---- doors (spanning tree per floor), exterior doors, windows: edge tables
  // H edge (i, j), j in 0..nz: between cell (i, j-1) [-v side] and (i, j) [+v side]; V edge (i, j), i in 0..nx: between (i-1, j) and (i, j).
  // edge value: 0 none, 1 solid, 2 door, 3 window, 4 rail (a hole's far end)
  // wall groups: a stair or hole cell belongs to its strip, a walkable cell to its room (a hall segment is a room; a landing belongs to the room it opens into)
  const groupOf = (F, c) => (F.type[c] === 0 ? -1 : F.type[c] >= 2 ? 1000 + F.stripOf[c] : F.region[c] >= 0 ? F.region[c] : 1000 + F.stripOf[c]);
  const doors = [], windows = [];
  for (const F of floors) {
    const eH = new Int8Array(nx * (nz + 1)), eV = new Int8Array((nx + 1) * nz);
    const extH = new Uint8Array(nx * (nz + 1)), extV = new Uint8Array((nx + 1) * nz);
    const edge = (A, B) => {                               // A, B cell indices or -1
      const ia = A >= 0 && F.type[A] !== 0, ib = B >= 0 && F.type[B] !== 0;
      if (!ia && !ib) return [0, 0];
      if (ia !== ib) return [1, 1];
      const ta = F.type[A], tb = F.type[B];
      if (F.stripOf[A] >= 0 && F.stripOf[A] === F.stripOf[B] && (ta >= 2 || tb >= 2)) {
        // inside one stair strip: a stair cell and the walkable cells in line with it are open (the foot, the solid high end); a hole is open toward the
        // exit and gets a half-wall toward any other walkable cell
        if ((ta === 3 && tb === 1) || (ta === 1 && tb === 3)) return F.exit.has(ta === 1 ? A : B) ? [0, 0] : [4, 0];
        return [0, 0];
      }
      const ga = groupOf(F, A), gb = groupOf(F, B);
      if (ga !== gb) return [1, 0];
      return [0, 0];
    };
    for (let j = 0; j <= nz; j++) for (let i = 0; i < nx; i++) { const [t, x] = edge(cellAt(i, j - 1), cellAt(i, j)); eH[j * nx + i] = t; extH[j * nx + i] = x; }
    for (let i = 0; i <= nx; i++) for (let j = 0; j < nz; j++) { const [t, x] = edge(cellAt(i - 1, j), cellAt(i, j)); eV[i * nz + j] = t; extV[i * nz + j] = x; }
    F.eH = eH; F.eV = eV; F.extH = extH; F.extV = extV;
    F.doorAt = new Map();                                  // "H:i:j" | "V:i:j" -> door record
  }
  const mkDoor = (F, ori, i, j, kind, a, b) => {
    const key = ori + ":" + i + ":" + j;
    if (ori === "H") F.eH[j * nx + i] = 2; else F.eV[i * nz + j] = 2;
    const d = { key, floor: F.f, ori, i, j, kind, a, b };
    F.doorAt.set(key, d);
    doors.push(d);
    return d;
  };
  // the root of each floor's door tree: floor 0 = the region the front door opens into, upper floors = the region holding the stair exit
  for (const F of floors) {
    let root = 0;
    if (F.f === 0) {
      const cols = [];
      for (let i = 0; i < nx; i++) { const c = cIdx(i, nz - 1); if (F.type[c] === 1 && F.stripOf[c] < 0) cols.push(i); }
      const mid = cols[(cols.length - 1) >> 1];
      let fi = cols.length > 2 && rng() < 0.4 ? cols[clamp(cols.indexOf(mid) + (rng() < 0.5 ? -1 : 1), 0, cols.length - 1)] : mid;
      // (the front door's room is the root every other room hangs off: never a <= 2-cell room when a bigger one also fronts the street - a tiny
      // root collects three doorways and has no wall left that a doorway sees)
      const regSize = (i) => { const r = F.region[cIdx(i, nz - 1)]; return r >= 0 ? F.regs[r].cells.length : 0; };
      if (regSize(fi) <= 2) { const big = cols.filter((i) => regSize(i) > 2); if (big.length) fi = big.slice().sort((a, b) => Math.abs(a - fi) - Math.abs(b - fi) || a - b)[0]; }
      F.frontCol = fi;
      root = F.region[cIdx(fi, nz - 1)];
    } else {
      for (const c of F.exit) { root = F.region[c]; break; }
    }
    F.root = root;
  }
  // ---- room kinds
  const kindsFor = (F) => {
    const regs = F.regs.map((r, i) => ({ r, i, n: r.cells.length }));
    const rest = regs.filter((x) => !x.r.hall);
    const order = [];
    if (F.f === 0) {
      const root = rest.find((x) => x.i === F.root) || rest[0];
      if (root) order.push(root);
      const others = rest.filter((x) => x !== root).sort((a, b) => b.n - a.n || a.i - b.i);
      for (const o of others) order.push(o);
      const seq = store ? ["shop", "shop", "storage", "office"] : use === "shop" ? ["shop", "storage", "office", "storage"] : use === "shed" ? ["storage"] : use === "barn" ? ["barn", "storage"]
        : use === "hall" ? ["warehouse", "office", "storage", "bath"] : tall ? ["lobby", "office", "storage", "bath", "office", "storage"]
          : P.theme === "lodge" || P.theme === "farm" ? ["living", "kitchen", "storage", "bedroom", "bath", "office"]
            : P.theme === "mill" ? ["warehouse", "office", "storage", "bath", "office", "storage"]
              : P.theme === "resort" ? ["living", "kitchen", "bedroom", "bath", "bedroom", "office"] : ["living", "kitchen", "bath", "office", "bedroom", "storage"];
      // a barn / hall: the BIGGEST room is the barn / warehouse floor wherever the front door is
      const ord = use === "barn" || use === "hall" ? rest.slice().sort((a, b) => b.n - a.n || a.i - b.i) : order;
      ord.forEach((o, k) => { o.r.kind = seq[Math.min(k, seq.length - 1)]; });
      if (S === 1 && use === "house" && order.length >= 3) {          // a bungalow sleeps on the ground floor: the smallest room is the bath, the next one a bedroom
        const bySize = order.slice(1).sort((a, b) => a.n - b.n || a.i - b.i);
        bySize[0].r.kind = "bath";
        if (bySize.length > 1) bySize[1].r.kind = "bedroom";
      }
    } else {
      const bySize = rest.slice().sort((a, b) => b.n - a.n || a.i - b.i);
      const seq = store ? ["shop", "shop", "storage", "office"] : use === "shop" && F.f === 1 ? ["office", "storage", "bedroom", "bath"] : tall ? ["office", "meeting", "bath", "office", "storage", "office"]
        : ["bedroom", "bath", "bedroom", "office", "bedroom", "storage"];
      bySize.forEach((o, k) => { o.r.kind = seq[Math.min(k, seq.length - 1)]; });
      if (bySize.length >= 3) {                                        // the bath is the SMALLEST room upstairs
        const small = bySize.slice(1).sort((a, b) => a.n - b.n || a.i - b.i)[0];
        const cur = bySize.find((o) => o.r.kind === "bath");
        if (cur && small !== cur) { cur.r.kind = small.r.kind; small.r.kind = "bath"; }
      }
    }
    // a bathroom is the SMALLEST room of its floor (a 37 m2 bathroom reads as an empty hall): swap kinds with whichever room is smaller
    const cur = rest.find((o) => o.r.kind === "bath");
    if (cur && rest.length >= 2) {
      const small = rest.filter((o) => !(F.f === 0 && o.i === F.root)).sort((a, b) => a.n - b.n || a.i - b.i)[0];
      if (small && small !== cur && small.n < cur.n) { const k = small.r.kind; small.r.kind = "bath"; cur.r.kind = k; }
    }
    for (const x of regs) if (x.r.hall) x.r.kind = "hall";
    // a ruin: every room but the bath and the corridors is an abandoned room (rubble, broken crates, an old table, a fallen shelf)
    if (TH.ruined) for (const x of regs) if (x.r.kind !== "bath" && x.r.kind !== "hall") x.r.kind = "ruin";
  };
  for (const F of floors) kindsFor(F);
  // which of the wall cells two rooms share gets the door: the middle one, among those with no stair approach / exit on either side (a doorway
  // that opens onto a stairwell landing shows the stair, not the room: nothing can stand in its view)
  const pickEdge = (F, list) => {
    const clear = list.filter((e) => {
      const A = e.ori === "H" ? cellAt(e.i, e.j - 1) : cellAt(e.i - 1, e.j), B = cellAt(e.i, e.j);
      return !F.approach.has(A) && !F.approach.has(B) && !F.exit.has(A) && !F.exit.has(B);
    });
    const l = clear.length ? clear : list;
    return l[(l.length - 1) >> 1];
  };
  // (stage B, lane I1) a doorway straight across a one-cell-thick room from another doorway (or from the front door): the two door zones fill the room and each
  // doorway looks only at the other one - nothing can stand where either sees it (interiorcheck: a 5 x 2.5 m bath between two doors showed 0-2 of its own
  // pieces). The door trees prefer any other shared wall cell.
  const across = (F, ori, i, j) => {
    if (ori === "V") return (i + 1 <= nx && F.eV[(i + 1) * nz + j] === 2) || (i - 1 >= 0 && F.eV[(i - 1) * nz + j] === 2);
    return (j + 1 <= nz && F.eH[(j + 1) * nx + i] === 2) || (j - 1 >= 0 && F.eH[(j - 1) * nx + i] === 2) || (F.f === 0 && i === F.frontCol && j === nz - 1);
  };
  // ... and in a room one cell thick (a 2.5 m wide strip), never a second doorway in the long wall OPPOSITE its other doorway: each would look across 2.26 m at the
  // other door's zone (the room shows 1-2 pieces from either); on the same wall or on an end wall, a doorway looks along the strip or at its free far wall
  const thinOpp = (F, e, ra, rb) => {
    for (const ri of [ra, rb]) {
      if (ri == null || ri < 0) continue;
      const cs = F.regs[ri].cells, i0 = cs[0] % nx, j0 = (cs[0] - i0) / nx;
      const oneCol = cs.every((c) => c % nx === i0), oneRow = cs.every((c) => (c - c % nx) / nx === j0);
      if (e.ori === "V" ? !oneCol : !oneRow) continue;
      const lo = e.ori === "V" ? i0 : j0, mine = e.ori === "V" ? e.i : e.j;
      if (mine !== lo && mine !== lo + 1) continue;
      const other = mine === lo ? lo + 1 : lo;
      for (const d of doors) if (d.floor === F.f && d.ori === e.ori && (d.a === ri || d.b === ri) && (e.ori === "V" ? d.i : d.j) === other) return true;
    }
    return false;
  };
  const pickEdgeA = (F, list, ra, rb) => {
    const ok = list.filter((e) => !across(F, e.ori, e.i, e.j) && !thinOpp(F, e, ra, rb));
    const ok2 = ok.length ? ok : list.filter((e) => !across(F, e.ori, e.i, e.j));
    return pickEdge(F, ok.length ? ok : ok2.length ? ok2 : list);
  };
  // interior doors (kinds are known: a bathroom is a dead end whenever the plan allows it)
  for (const F of floors) {
    const R = F.regs, nR = R.length;
    const cand = new Map();                                // "a|b" (a < b) -> [{ ori, i, j }]
    const addCand = (A, B, ori, i, j) => {
      if (A < 0 || B < 0 || F.type[A] !== 1 || F.type[B] !== 1) return;
      const ra = F.region[A], rb = F.region[B];
      if (ra < 0 || rb < 0 || ra === rb) return;
      if (groupOf(F, A) === groupOf(F, B)) return;
      const k = ra < rb ? ra + "|" + rb : rb + "|" + ra;
      if (!cand.has(k)) cand.set(k, []);
      cand.get(k).push({ ori, i, j });
    };
    for (let j = 1; j < nz; j++) for (let i = 0; i < nx; i++) if (F.eH[j * nx + i] === 1 && !F.extH[j * nx + i]) addCand(cellAt(i, j - 1), cellAt(i, j), "H", i, j);
    for (let i = 1; i < nx; i++) for (let j = 0; j < nz; j++) if (F.eV[i * nz + j] === 1 && !F.extV[i * nz + j]) addCand(cellAt(i - 1, j), cellAt(i, j), "V", i, j);
    const root = F.root;
    const seen = new Uint8Array(nR); seen[root] = 1;
    const queue = [root], later = [], linked = new Set();
    const leafy = (ri) => R[ri].kind === "bath";
    while (queue.length || later.length) {
      const a = queue.length ? queue.shift() : later.shift();
      const nb = [];
      for (let b = 0; b < nR; b++) {
        if (seen[b]) continue;
        const k = a < b ? a + "|" + b : b + "|" + a;
        if (cand.has(k)) nb.push(b);
      }
      for (const b of nb) {
        if (seen[b]) continue;
        seen[b] = 1;
        const k = a < b ? a + "|" + b : b + "|" + a, list = cand.get(k);
        const e = pickEdgeA(F, list, a, b);
        R[b].entry = mkDoor(F, e.ori, e.i, e.j, "interior", a, b);
        linked.add(k);
        (leafy(b) ? later : queue).push(b);
      }
    }
    F.sealed = [];
    for (let b = 0; b < nR; b++) if (!seen[b]) F.sealed.push(b);
    // a second way round now and then (PUBG houses rarely dead-end): one extra door between two rooms not yet joined directly
    if (rng() < 0.35) {
      // (never into a room of <= 2 cells: a 5 x 2.5 m room with three doorways is all door zone - nothing can stand where a doorway sees it)
      const keys = [...cand.keys()].filter((k) => !linked.has(k) && !k.split("|").some((x) => leafy(+x) || R[+x].cells.length <= 2)).sort();
      if (keys.length) {
        const k = pick(rng, keys), [a, b] = k.split("|").map(Number);
        const list = cand.get(k), e = pickEdgeA(F, list, a, b);
        mkDoor(F, e.ori, e.i, e.j, "interior", a, b);
      }
    }
  }
  // exterior doors (ground floor)
  const F0 = floors[0];
  F0.regs[F0.root].entry = mkDoor(F0, "H", F0.frontCol, nz, "front", F0.region[cIdx(F0.frontCol, nz - 1)], null);
  if (rng() < (use === "shop" ? 0.75 : TH.backDoor)) {
    const cands = [];
    const ok = (c) => c >= 0 && F0.type[c] === 1 && F0.stripOf[c] < 0 && !F0.approach.has(c);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const c = cIdx(i, j);
      if (!ok(c)) continue;
      if (!inFoot(i, j - 1) && F0.eH[j * nx + i] === 1) cands.push(["H", i, j, c]);       // back-facing wall of this cell
      if (!inFoot(i - 1, j) && F0.eV[i * nz + j] === 1 && j < nz - 1) cands.push(["V", i, j, c]);
      if (!inFoot(i + 1, j) && F0.eV[(i + 1) * nz + j] === 1 && j < nz - 1) cands.push(["V", i + 1, j, c]);
    }
    // (never straight across a room from another door: in a one-cell-deep room the two door zones would leave nothing in either doorway's view)
    const opp = (e) => (e[0] === "H" ? F0.eH[(e[2] + 1) * nx + e[1]] : e[1] === e[3] % nx ? F0.eV[(e[1] + 1) * nz + e[2]] : F0.eV[(e[1] - 1) * nz + e[2]]) === 2;
    // (lane K1: and never onto an alley narrower than DOOR_OUT - the caller's neighbours, P.near: the house keeps its street door then)
    const far = cands.filter((e) => !(e[0] === "H" && e[2] === nz) && !opp(e) && doorOut(e[0], e[1], e[2]));
    if (far.length) { const e = pick(rng, far); mkDoor(F0, e[0], e[1], e[2], "back", F0.region[e[3]], null); }
  }
  // READ FROM ITS DOOR: every room gets a door on its OUTLINE (its bounding rectangle: where a player standing in the doorway sees the whole room
  // and where interiorcheck looks from) or a stair arriving inside it. An L room (a stair landing merged into it) whose only door sits on its notch
  // wall gets one more door on its outline: an interior door to a neighbour, or on the ground floor a side door to the street.
  const regBox = (r) => { let i0 = 1e9, j0 = 1e9, i1 = -1, j1 = -1; for (const c of r.cells) { const i = c % nx, j = (c - i) / nx; if (i < i0) i0 = i; if (j < j0) j0 = j; if (i > i1) i1 = i; if (j > j1) j1 = j; } return [i0, j0, i1 + 1, j1 + 1]; };
  const onOutline0 = (B, ori, i, j) => (ori === "H" ? (j === B[1] || j === B[3]) && i >= B[0] && i < B[2] : (i === B[0] || i === B[2]) && j >= B[1] && j < B[3]);
  // ... and, on the side of an L / U room that runs past its notch, not the room's ONLY cell on that side: the wall the doorway sits in is then a
  // short stub beside a neighbour's wall, and the side reads as the neighbour's
  const onOutline = (B, ori, i, j, F, ri) => {
    if (!onOutline0(B, ori, i, j)) return false;
    if (!F) return true;
    let n = 0, other = 0;
    if (ori === "H") { const row = j === B[1] ? j : j - 1; for (let ii = B[0]; ii < B[2]; ii++) { const c = cellAt(ii, row); if (c >= 0 && F.type[c] === 1 && F.region[c] === ri) n++; else other++; } }
    else { const col = i === B[0] ? i : i - 1; for (let jj = B[1]; jj < B[3]; jj++) { const c = cellAt(col, jj); if (c >= 0 && F.type[c] === 1 && F.region[c] === ri) n++; else other++; } }
    return n >= 2 || other === 0;
  };
  for (const F of floors) {
    const exitsHere = stairs.filter((st) => st.f + 1 === F.f).map((st) => stripCell(strips[st.strip], st.k - 1));
    const landingCell = (c) => F.approach.has(c) || F.exit.has(c);
    const sideCell = (d, ri) => { const A = d.ori === "H" ? cellAt(d.i, d.j - 1) : cellAt(d.i - 1, d.j), C = cellAt(d.i, d.j); return C >= 0 && F.region[C] === ri ? C : A; };
    F.regs.forEach((r, ri) => {
      const B = regBox(r);
      // (a door that opens onto a stair landing shows the stair: it does not count as the room's entrance)
      for (const d of F.doorAt.values()) if ((d.a === ri || d.b === ri) && onOutline(B, d.ori, d.i, d.j, F, ri) && !landingCell(sideCell(d, ri))) return;
      for (const [ei, ej] of exitsHere) if (ei >= B[0] && ei < B[2] && ej >= B[1] && ej < B[3]) return;
      const mine = (c) => c >= 0 && F.type[c] === 1 && F.region[c] === ri;
      const cand = [];
      for (let j = B[1]; j <= B[3]; j++) for (let i = B[0]; i < B[2]; i++) {
        if (!onOutline(B, "H", i, j, F, ri) || F.eH[j * nx + i] !== 1) continue;
        const A = cellAt(i, j - 1), C = cellAt(i, j), a = mine(A) ? A : mine(C) ? C : -1, o = a === A ? C : A;
        if (a < 0 || landingCell(a)) continue;
        if (F.extH[j * nx + i]) { if (F.f === 0 && !F0.approach.has(a)) cand.push([1, "H", i, j, null]); }
        else if (o >= 0 && F.type[o] === 1 && F.region[o] >= 0 && F.region[o] !== ri && groupOf(F, o) !== groupOf(F, a)) cand.push([0, "H", i, j, F.region[o]]);
      }
      for (let i = B[0]; i <= B[2]; i++) for (let j = B[1]; j < B[3]; j++) {
        if (!onOutline(B, "V", i, j, F, ri) || F.eV[i * nz + j] !== 1) continue;
        const A = cellAt(i - 1, j), C = cellAt(i, j), a = mine(A) ? A : mine(C) ? C : -1, o = a === A ? C : A;
        if (a < 0 || landingCell(a)) continue;
        if (F.extV[i * nz + j]) { if (F.f === 0 && !F0.approach.has(a)) cand.push([1, "V", i, j, null]); }
        else if (o >= 0 && F.type[o] === 1 && F.region[o] >= 0 && F.region[o] !== ri && groupOf(F, o) !== groupOf(F, a)) cand.push([0, "V", i, j, F.region[o]]);
      }
      if (!cand.length) { notes.push("room f" + F.f + "r" + ri + ": no door on its outline"); return; }
      // (Wave 8 fix round, lane K1) the door trees' rules hold here too: never straight across a one-cell-thick room from another doorway, never a second doorway
      // in the long wall opposite a thin room's other door (verify_b: a hall's outline door made a 2.26 x 4.76 m bath a corridor between two facing doors - each
      // doorway saw 1 of its 5 pieces); a street door is better than such a door, any door better than none
      // (the pick is the old one whenever it is not such a door: only those houses change)
      cand.sort((x, y) => x[0] - y[0]);                                    // an interior door first, a street door if none
      const fair = (q) => !across(F, q[1], q[2], q[3]) && !thinOpp(F, { ori: q[1], i: q[2], j: q[3] }, ri, q[4]);
      const isGood = (q) => fair(q) && (q[0] !== 1 || doorOut(q[1], q[2], q[3]));
      const mid = (l) => l[(l.filter((q) => q[0] === l[0][0]).length - 1) >> 1];
      let e = mid(cand);
      // (no good door: a street door onto a narrow alley beats a doorway straight across a thin room - the alley is walkable, the room would read empty)
      if (!isGood(e)) { const good = cand.filter(isGood), ok2 = good.length ? good : cand.filter(fair); if (ok2.length) e = mid(ok2); }
      mkDoor(F, e[1], e[2], e[3], e[0] ? "back" : "interior", ri, e[4]);
    });
  }
  // windows
  for (const F of floors) {
    const winOK = (c) => c >= 0 && F.type[c] === 1;
    const roomWin = new Map();
    const tryWin = (ori, i, j, c, p) => {
      const idx = ori === "H" ? j * nx + i : i * nz + j, arr = ori === "H" ? F.eH : F.eV;
      if (arr[idx] !== 1 || !winOK(c)) return false;
      // not straight across the cell from a doorway: that stretch of wall is the one the doorway looks at (tall pieces stand there)
      const ci = c % nx, cj = (c - ci) / nx;
      if (ori === "H" ? F.eH[(cj === j ? j + 1 : j - 1) * nx + i] === 2 : F.eV[(ci === i ? i + 1 : i - 1) * nz + j] === 2) return false;
      // (a store room keeps its walls for shelving: a third of the windows a living room would get)
      const rk = F.region[c] >= 0 ? F.regs[F.region[c]].kind : null;
      if (rng() >= (rk === "storage" || rk === "warehouse" || rk === "barn" ? p * 0.35 : p)) return false;
      arr[idx] = 3;
      roomWin.set(F.region[c], (roomWin.get(F.region[c]) || 0) + 1);
      return true;
    };
    const ext = [];                                        // every exterior wall edge with its inner cell
    for (let j = 0; j <= nz; j++) for (let i = 0; i < nx; i++) if (F.extH[j * nx + i] && F.eH[j * nx + i] === 1) {
      const c = inFoot(i, j) && j < nz ? cIdx(i, j) : cIdx(i, j - 1);
      ext.push(["H", i, j, c]);
    }
    for (let i = 0; i <= nx; i++) for (let j = 0; j < nz; j++) if (F.extV[i * nz + j] && F.eV[i * nz + j] === 1) {
      const c = inFoot(i, j) && i < nx ? cIdx(i, j) : cIdx(i - 1, j);
      ext.push(["V", i, j, c]);
    }
    for (const e of ext) {
      const shopFront = use === "shop" && F.f === 0 && e[0] === "H" && e[2] === nz;
      tryWin(e[0], e[1], e[2], e[3], shopFront ? 2 : use === "shop" && F.f === 0 ? 0.25 : TH.win);
    }
    // every room with an outside wall gets at least one window
    for (let ri = 0; ri < F.regs.length; ri++) {
      if (roomWin.get(ri)) continue;
      const mine = ext.filter((e) => F.region[e[3]] === ri && (e[0] === "H" ? F.eH[e[2] * nx + e[1]] : F.eV[e[1] * nz + e[2]]) === 1);
      if (!mine.length) continue;
      const e = mine[(mine.length - 1) >> 1];
      if (e[0] === "H") F.eH[e[2] * nx + e[1]] = 3; else F.eV[e[1] * nz + e[2]] = 3;
      roomWin.set(ri, 1);
    }
  }


  // ---- boxes (local coordinates first; converted to world at the end)
  const boxes = [];                                       // { p, u0, u1, y0, y1, v0, v1, f [6 local faces +u -u +y -y +v -v], c, fl, ref? }
  const addBox = (p, u0, u1, y0b, y1b, v0, v1, faces, c, fl) => {
    if (u1 - u0 < 1e-4 || y1b - y0b < 1e-4 || v1 - v0 < 1e-4) return -1;
    boxes.push({ p, u0, u1, y0: y0b, y1: y1b, v0, v1, f: faces, c: c ? 1 : 0, fl });
    return boxes.length - 1;
  };
  const roomCol = new Map();                              // region object -> { wall palette idx, floor palette idx }
  for (const F of floors) for (const r of F.regs) {
    const st = ROOMSTYLE[r.kind] || ROOMSTYLE.hall;
    const wc = innerMat === "plank" && (r.kind === "living" || r.kind === "bedroom" || r.kind === "hall" || r.kind === "office") ? pick(rng, LODGE_INNER) : pick(rng, st.wall);
    const wm = innerMat === "plank" && (r.kind === "living" || r.kind === "bedroom" || r.kind === "hall" || r.kind === "office") ? "plank_in" : "plaster";
    roomCol.set(r, { wall: pal(wm, wc), floor: pal(st.floor, pick(rng, st.fc)) });
  }
  const sideColor = (F, c) => {                           // the face colour seen from cell c (or outside: the ground floor wears the base)
    if (c < 0 || F.type[c] === 0) return F.f === 0 ? P_BASE : P_FACADE;
    const ri = F.region[c];
    if (ri >= 0) return roomCol.get(F.regs[ri]).wall;
    // a stair / hole cell: the strip's hall colour (the nearest hall segment of that strip)
    for (const r of F.regs) if (r.hall && r.strip === F.stripOf[c]) return roomCol.get(r).wall;
    // (stage B, lane I1: a stairwell with no hall segment of its own - an upper floor's hole beside a room - wore the TRIM colour: a lodge's dark trim was a near-black
    //  wall filling a third of the stair-top view. The first room of that floor lends its wall colour instead: the stairwell reads as part of the house)
    for (const r of F.regs) if (roomCol.has(r)) return roomCol.get(r).wall;
    return P_TRIM;
  };
  const parapetRoof = roofKind === "flat";
  const bandOf = (F, ext) => {
    const f = F.f;
    const yb = ext ? (f === 0 ? y0 - BASE0 : s[f] - SLAB) : s[f];
    const yt = ext ? (f === S - 1 && !shell ? (parapetRoof ? s[S] + PARAPET : s[S] - SLAB) : s[f + 1] - SLAB) : s[f + 1] - SLAB;
    return [yb, yt];
  };
  // wall lines: collect pieces per line and merge the full-band ones into runs
  for (const F of floors) {
    const f = F.f, sf = s[f];
    const lines = [];                                     // { ori, at, segs: [{ t, ext, k (edge index along), cA, cB }] }
    for (let j = 0; j <= nz; j++) {
      const segs = [];
      for (let i = 0; i < nx; i++) segs.push({ t: F.eH[j * nx + i], ext: F.extH[j * nx + i], k: i, cA: cellAt(i, j - 1), cB: cellAt(i, j) });
      lines.push({ ori: "H", at: j, segs });
    }
    for (let i = 0; i <= nx; i++) {
      const segs = [];
      for (let j = 0; j < nz; j++) segs.push({ t: F.eV[i * nz + j], ext: F.extV[i * nz + j], k: j, cA: cellAt(i - 1, j), cB: cellAt(i, j) });
      lines.push({ ori: "V", at: i, segs });
    }
    const hasV = (i, j) => (j - 1 >= 0 && F.eV[i * nz + j - 1] > 0 && F.eV[i * nz + j - 1] !== 4) || (j < nz && F.eV[i * nz + j] > 0 && F.eV[i * nz + j] !== 4);
    const vExtAt = (i, j) => (j - 1 >= 0 && F.eV[i * nz + j - 1] > 0 && F.extV[i * nz + j - 1]) || (j < nz && F.eV[i * nz + j] > 0 && F.extV[i * nz + j]);
    const hAt = (j, i) => { // the H line j at vertex i: [present, exterior]
      let pres = false, ext = false;
      for (const ii of [i - 1, i]) if (ii >= 0 && ii < nx) { const t = F.eH[j * nx + ii]; if (t > 0 && t !== 4) { pres = true; if (F.extH[j * nx + ii]) ext = true; } }
      return [pres, ext];
    };
    for (const L of lines) {
      const H = L.ori === "H", line = H ? vL(L.at) : uL(L.at), tl = (k) => (H ? uL(k) : vL(k));
      // full-band pieces per (ext) kind, then merged
      const pieces = [];                                  // [t0, t1, ext, colA, colB]
      for (const sg of L.segs) {
        if (sg.t === 0 || sg.t === 4) continue;
        const t0 = tl(sg.k), t1 = tl(sg.k + 1), ext = !!sg.ext;
        const colA = sideColor(F, sg.cA), colB = sideColor(F, sg.cB);
        const [yb, yt] = bandOf(F, ext);
        const part = (a, b, y0p, y1p) => {                // a box on this line from t = a to b, y0p..y1p
          if (H) addBox("wall", a, b, y0p, y1p, line - JAMB, line + JAMB, [P_TRIM, P_TRIM, P_TRIM, P_TRIM, colB, colA], 1, f);
          else addBox("wall", line - JAMB, line + JAMB, y0p, y1p, a, b, [colB, colA, P_TRIM, P_TRIM, P_TRIM, P_TRIM], 1, f);
        };
        if (sg.t === 1) pieces.push([t0, t1, ext, colA, colB]);
        else if (sg.t === 2) {
          pieces.push([t0, t0 + JAMB, ext, colA, colB]); pieces.push([t1 - JAMB, t1, ext, colA, colB]);
          part(t0 + JAMB, t1 - JAMB, sf + DOOR_H, yt);
          if (yb < sf - 1e-6) part(t0 + JAMB, t1 - JAMB, yb, sf);
        } else if (sg.t === 3) {
          pieces.push([t0, t0 + WIN_MARGIN, ext, colA, colB]); pieces.push([t1 - WIN_MARGIN, t1, ext, colA, colB]);
          part(t0 + WIN_MARGIN, t1 - WIN_MARGIN, yb, sf + SILL);
          part(t0 + WIN_MARGIN, t1 - WIN_MARGIN, sf + HEAD, yt);
        }
      }
      // merge touching pieces with the same kind and colours
      const runs = [];
      for (const pc of pieces) {
        const last = runs[runs.length - 1];
        if (last && Math.abs(last[1] - pc[0]) < 1e-6 && last[2] === pc[2] && last[3] === pc[3] && last[4] === pc[4]) last[1] = pc[1];
        else runs.push(pc.slice());
      }
      for (const rn of runs) {
        let [a, b] = rn;
        const ext = rn[2], [yb, yt] = bandOf(F, ext);
        // corners: an H run that ends ON a grid vertex where a V wall stands is lengthened through the corner square; a V run ending on a vertex
        // where an H wall of at least its band stands is shortened to that wall's face (no coplanar faces, no gaps)
        const ka = Math.round((a - tl(0)) / U), kb = Math.round((b - tl(0)) / U);
        const onA = Math.abs(tl(ka) - a) < 1e-6, onB = Math.abs(tl(kb) - b) < 1e-6;
        if (H) {
          if (onA && hasV(ka, L.at)) a -= ext || !vExtAt(ka, L.at) ? JAMB : JAMB - 0.01;
          if (onB && hasV(kb, L.at)) b += ext || !vExtAt(kb, L.at) ? JAMB : JAMB - 0.01;
        } else {
          if (onA) { const [pres, hx] = hAt(ka, L.at); if (pres && (hx || !ext)) a += JAMB; }
          if (onB) { const [pres, hx] = hAt(kb, L.at); if (pres && (hx || !ext)) b -= JAMB; }
        }
        if (b - a < 1e-4) continue;
        if (H) addBox("wall", a, b, yb, yt, line - JAMB, line + JAMB, [P_TRIM, P_TRIM, P_TRIM, P_TRIM, rn[4], rn[3]], 1, f);
        else addBox("wall", line - JAMB, line + JAMB, yb, yt, a, b, [rn[4], rn[3], P_TRIM, P_TRIM, P_TRIM, P_TRIM], 1, f);
      }
      // rails (a hole's far end): a 1.0 m half-wall between the strip's walls
      for (const sg of L.segs) {
        if (sg.t !== 4) continue;
        const t0 = tl(sg.k) + JAMB, t1 = tl(sg.k + 1) - JAMB;
        if (H) addBox("rail", t0, t1, sf, sf + RAIL_H, line - RAIL_T / 2, line + RAIL_T / 2, [P_RAIL, P_RAIL, P_STEP, P_RAIL, P_RAIL, P_RAIL], 1, f);
        else addBox("rail", line - RAIL_T / 2, line + RAIL_T / 2, sf, sf + RAIL_H, t0, t1, [P_RAIL, P_RAIL, P_STEP, P_RAIL, P_RAIL, P_RAIL], 1, f);
      }
    }
  }
  // slabs: the ground slab, the upper floors (minus holes), the roof
  const mergeCells = (want) => {                          // greedy rectangles over cells where want(c) returns a key (null = skip)
    const used = new Uint8Array(nx * nz), out = [];
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const c = cIdx(i, j);
      if (used[c]) continue;
      const k = want(c);
      if (k == null) continue;
      let i1 = i + 1;
      while (i1 < nx && !used[cIdx(i1, j)] && want(cIdx(i1, j)) === k) i1++;
      let j1 = j + 1;
      for (;;) {
        if (j1 >= nz) break;
        let okRow = true;
        for (let ii = i; ii < i1; ii++) { const cc = cIdx(ii, j1); if (used[cc] || want(cc) !== k) { okRow = false; break; } }
        if (!okRow) break;
        j1++;
      }
      for (let jj = j; jj < j1; jj++) for (let ii = i; ii < i1; ii++) used[cIdx(ii, jj)] = 1;
      out.push([i, j, i1, j1, k]);
    }
    return out;
  };
  const stairPal = new Map();
  for (const F of floors) {
    const f = F.f;
    const floorKey = (c) => {
      if (F.type[c] === 0 || F.type[c] === 3) return null;
      const ri = F.region[c];
      if (ri >= 0) return roomCol.get(F.regs[ri]).floor;
      for (const r of F.regs) if (r.hall && r.strip === F.stripOf[c]) return roomCol.get(r).floor;   // under a stair
      return P_FOUND;
    };
    const ceilKey = (c) => (F.type[c] === 0 || F.type[c] === 3 ? null : 0);
    if (f === 0) {
      for (const [i, j, i1, j1, k] of mergeCells(floorKey)) addBox("slab", uL(i), uL(i1), y0 - BASE0, s[0], vL(j), vL(j1), [P_FOUND, P_FOUND, k, P_FOUND, P_FOUND, P_FOUND], 1, 0);
    } else {
      // upper slab: floor colour on top, ceiling underneath; split by top colour then by the ceiling (always the same colour)
      for (const [i, j, i1, j1, k] of mergeCells((c) => (ceilKey(c) == null ? null : floorKey(c)))) addBox("slab", uL(i), uL(i1), s[f] - SLAB, s[f], vL(j), vL(j1), [P_TRIM, P_TRIM, k, P_CEIL, P_TRIM, P_TRIM], 1, f);
    }
    for (const r of F.regs) stairPal.set(r, roomCol.get(r));
  }
  // roof
  const roofRamps = [], roofGables = [];                 // pitched roofs: the planks (ramps, appended after the stairs' ones) and the drawn end walls
  const footKey = (c) => (inFoot(c % nx, Math.floor(c / nx)) ? 1 : null);
  const roofRects = mergeCells(footKey);
  const sTop = s[S + shell];                             // the roof surface (over the closed storeys of a tall shell)
  if (shell) {
    // a tall shell (tower / mid-rise): the storeys over the walkable ones are ONE closed mass (an exact box: nobody gets in, a glider lands on its
    // roof), from the top walkable storey's ceiling to the roof, over the walls' outer faces; a parapet round the roof; blind windows drawn on it below
    const a0 = uL(0) - JAMB, a1 = uL(nx) + JAMB, b0 = vL(0) - JAMB, b1 = vL(nz) + JAMB;
    addBox("shell", a0, a1, s[S] - SLAB, sTop, b0, b1, [P_FACADE, P_FACADE, P_ROOF, P_CEIL, P_FACADE, P_FACADE], 1, S);
    addBox("roof", a0, a1, sTop, sTop + PARAPET, b0, b0 + T, [P_FACADE, P_FACADE, P_TRIM, P_TRIM, P_TRIM, P_FACADE], 1, S);
    addBox("roof", a0, a1, sTop, sTop + PARAPET, b1 - T, b1, [P_FACADE, P_FACADE, P_TRIM, P_TRIM, P_FACADE, P_TRIM], 1, S);
    addBox("roof", a0, a0 + T, sTop, sTop + PARAPET, b0 + T, b1 - T, [P_TRIM, P_FACADE, P_TRIM, P_TRIM, P_TRIM, P_TRIM], 1, S);
    addBox("roof", a1 - T, a1, sTop, sTop + PARAPET, b0 + T, b1 - T, [P_FACADE, P_TRIM, P_TRIM, P_TRIM, P_TRIM, P_TRIM], 1, S);
    const pu = pal("metal", 0x9aa1a6), uc = (rng() - 0.5) * Math.max(0, W - 4), vc = (rng() - 0.5) * Math.max(0, D - 4);
    addBox("roof", uc - 0.8, uc + 0.8, sTop, sTop + 1.1, vc - 0.6, vc + 0.6, [pu, pu, pu, pu, pu, pu], 1, S);
  } else if (parapetRoof) {
    for (const [i, j, i1, j1] of roofRects) addBox("roof", uL(i), uL(i1), s[S] - SLAB, s[S], vL(j), vL(j1), [P_TRIM, P_TRIM, P_ROOF, P_CEIL, P_TRIM, P_TRIM], 1, S - 1);
    // a rooftop unit on a city / resort flat roof (exact box: a glider lands on it)
    const rr = roofRects.reduce((a, b) => ((b[2] - b[0]) * (b[3] - b[1]) > (a[2] - a[0]) * (a[3] - a[1]) ? b : a));
    if ((rr[2] - rr[0]) >= 2 && (rr[3] - rr[1]) >= 2 && rng() < 0.7) {
      const uc = (uL(rr[0]) + uL(rr[2])) / 2 + (rng() - 0.5) * 2, vc = (vL(rr[1]) + vL(rr[3])) / 2 + (rng() - 0.5) * 2;
      const pu = pal("metal", 0x9aa1a6);
      addBox("roof", uc - 0.8, uc + 0.8, s[S], s[S] + 1.1, vc - 0.6, vc + 0.6, [pu, pu, pu, pu, pu, pu], 1, S - 1);
    }
  } else if (pitched) {
    // A PITCHED roof (round 3): the slope is the sim's C-RAMP - a 0.3 m plank whose walk line runs minY -> maxY (royale.js rampTopAt /
    // segmentRamp / rampBlocks: bullets, sight and bodies meet the plank +- hv = 0.15 sqrt(1 + k^2) round the walk line, never the wedge under it).
    // The builder draws EXACTLY that plank (house.roofs), so visual == collider; the attic under it is SEALED by horizontal 'gable' layer boxes
    // (colliders, not drawn: each <= 2 hv tall, so the stack covers every point between the slab and the plank's underside and no layer pokes
    // above the plank's top), and the two gable ends (and a lean-to's high wall) are drawn as flat polygons on the layers' end faces (house.gables).
    // profile across the ridge (b), the ridge along a: a gable (two planks), a gambrel (a barn: 44 deg below, 22 above), a lean-to (one plank, high at the back)
    const ridgeU = W > D + 1e-6 ? true : D > W + 1e-6 ? false : rng() < 0.5;
    const A = (ridgeU ? W : D) / 2 + JAMB, F = (ridgeU ? D : W) / 2 + JAMB, OV = 0, OVG = 0.3, yS = s[S];
    const toUV = (a0, a1, b0, b1) => (ridgeU ? [a0, a1, b0, b1] : [b0, b1, a0, a1]);
    const hvOf = (k) => 0.15 * Math.sqrt(1 + k * k);
    const kOf = (deg) => { const t = { 18: 0.3249, 22: 0.4040, 30: 0.5774, 38: 0.7813, 40: 0.8391, 45: 1 }[deg]; return t != null ? t : 0.5774; };
    const segs = [];                                      // [b0, b1, k (dy/db), y at b0 (walk line)]
    if (roofKind === "gable") {
      const k = kOf(TH.pitch), w0 = yS + hvOf(k);           // the walk line at the outer wall face: the plank's underside meets the wall top
      segs.push([-F - OV, 0, k, w0 - k * OV]); segs.push([0, F + OV, -k, w0 + k * F]);
    } else if (roofKind === "gambrel") {
      const k1 = 0.9657, k2 = kOf(22), g = Math.min(F * 0.42, 2.6), w0 = yS + hvOf(k1);
      const yg = w0 + k1 * g, yr = yg + k2 * (F - g);
      segs.push([-F - OV, -F + g, k1, w0 - k1 * OV]); segs.push([-F + g, 0, k2, yg]); segs.push([0, F - g, -k2, yr]); segs.push([F - g, F + OV, -k1, yg]);
    } else {                                              // lean-to: low at the front (+b), high at the back
      const k = kOf(TH.pitch < 25 ? 18 : 22), wF = yS + hvOf(k);
      segs.push([-F - OV, F + OV, -k, wF + k * (2 * F + OV)]);
    }
    // (the planks overlap 1 cm at every joint - the ridge, a gambrel's kink: no point of the roof line lies on the edge of both)
    for (const g of segs) {
      if (g[0] > -F + 1e-6) { g[3] -= g[2] * 0.01; g[0] -= 0.01; }
      if (g[1] < F - 1e-6) g[1] += 0.01;
    }
    const walkAt = (b) => { for (const g of segs) if (b >= g[0] - 1e-9 && b <= g[1] + 1e-9) return g[3] + g[2] * (b - g[0]); return null; };
    const hvMin = Math.min(...segs.map((g) => hvOf(g[2])));
    // the underside of the plank stack at b: the lowest plank underside over that point (at a kink: the lower of the two)
    const bottomAt = (b) => { let y = Infinity; for (const g of segs) if (b >= g[0] - 1e-9 && b <= g[1] + 1e-9) y = Math.min(y, g[3] + g[2] * (b - g[0]) - hvOf(g[2])); return y; };
    let maxWalk = -Infinity; for (const g of segs) maxWalk = Math.max(maxWalk, g[3], g[3] + g[2] * (g[1] - g[0]));
    // the roof slab over the walls' outer faces (the plank does the overhang)
    for (const [i, j, i1, j1] of roofRects) {
      const a0 = uL(i) - (i === 0 ? JAMB : 0), a1 = uL(i1) + (i1 === nx ? JAMB : 0), b0 = vL(j) - (j === 0 ? JAMB : 0), b1 = vL(j1) + (j1 === nz ? JAMB : 0);
      addBox("roof", a0, a1, yS - SLAB, yS, b0, b1, [P_TRIM, P_TRIM, P_ROOF, P_CEIL, P_TRIM, P_TRIM], 1, S - 1);
    }
    // the planks: one ramp per segment (dir = the rising direction), the drawn plank = that ramp
    for (let gi = 0; gi < segs.length; gi++) {
      const [b0, b1, k, y0g] = segs[gi], y1g = y0g + k * (b1 - b0), rising = k > 0 ? 1 : -1;
      const lr = toUV(-A - OVG, A + OVG, b0, b1), dirLoc = ridgeU ? [0, rising] : [rising, 0];
      // the drawn underside: only where the plank hangs outside the walls (the eave and the gable overhangs); its high / low ends drawn where free
      const soff = [];
      const bIn0 = Math.max(b0, -F), bIn1 = Math.min(b1, F);
      if (b0 < -F) soff.push(toUV(-A - OVG, A + OVG, b0, -F));
      if (b1 > F) soff.push(toUV(-A - OVG, A + OVG, F, b1));
      if (bIn1 > bIn0) { soff.push(toUV(-A - OVG, -A, bIn0, bIn1)); soff.push(toUV(A, A + OVG, bIn0, bIn1)); }
      roofRamps.push({ lr, y0: Math.min(y0g, y1g), y1: Math.max(y0g, y1g), rise: dirLoc, floor: S, roof: true,
        free: [gi === 0, gi === segs.length - 1], soff, pTop: P_ROOF, pEdge: P_TRIM });
    }
    // the sealed attic: horizontal layers from the slab top, each spanning the b-range where the plank's underside is above its bottom
    {
      const roots = (y) => {                              // [L, R]: where bottomAt(b) > y inside the walls' outline (the profile has one peak or rises monotonically)
        let L = null, R = null;
        const N = Math.ceil(2 * F / 0.02);
        for (let q = 0; q <= N; q++) { const b = -F + (2 * F) * q / N; if (bottomAt(b) > y + 1e-9) { if (L == null) L = Math.max(-F, b - 2 * F / N); R = Math.min(F, b + 2 * F / N); } }
        return L == null ? null : [L, R];
      };
      let maxBottom = -Infinity; for (let q = 0; q <= 400; q++) maxBottom = Math.max(maxBottom, bottomAt(-F + 2 * F * q / 400));
      let y = yS;
      for (let guard = 0; guard < 40 && y < maxBottom - 1e-6; guard++) {
        const lr = roots(y); if (!lr) break;
        const yTop = Math.min(y + 2 * hvMin - 0.04, maxWalk - 0.005);
        const [u0, u1, v0, v1] = toUV(-A, A, r3(lr[0]), r3(lr[1]));
        addBox("gable", u0, u1, y, yTop, v0, v1, [P_FACADE, P_FACADE, P_FACADE, P_FACADE, P_FACADE, P_FACADE], 1, S - 1);
        y = yTop;
      }
    }
    // the drawn end walls: a polygon on each gable end (a = +-A) from the slab top up to the plank underside; a lean-to's high back wall
    {
      const prof = [[-F, yS]];
      const bps = [-F]; for (const g of segs) for (const b of [g[0], g[1]]) if (b > -F + 1e-6 && b < F - 1e-6) bps.push(b);
      bps.push(F);
      const uniq = [...new Set(bps.map((b) => r3(b)))].sort((p, q) => p - q);
      for (const b of uniq) prof.push([b, Math.max(yS, bottomAt(b))]);
      prof.push([F, yS]);
      const pts = prof.filter((p, i) => i === 0 || Math.abs(p[0] - prof[i - 1][0]) > 1e-4 || Math.abs(p[1] - prof[i - 1][1]) > 1e-4);
      for (const sa of [-1, 1]) roofGables.push({ axisU: ridgeU, at: sa * A, n: sa, pts: pts.map(([b, y]) => [b, y]), pal: P_FACADE });
      if (roofKind === "lean" && bottomAt(-F) > yS + 0.01) roofGables.push({ axisU: !ridgeU, at: -F, n: -1, pts: [[-A, yS], [-A, bottomAt(-F)], [A, bottomAt(-F)], [A, yS]], pal: P_FACADE, back: true });
    }
    // the eaves: a gutter box under each low plank end (the plank stops at the wall's face; the gutter is the overhang a player sees from below)
    {
      const P_GUT = pal("metal", P.theme === "lodge" || P.theme === "farm" ? 0x4a4e52 : shadeInt(trimC, 0.85));
      for (const g of [...new Set([segs[0], segs[segs.length - 1]])]) {
        const lowAtStart = g[2] > 0, b = lowAtStart ? g[0] : g[1];
        if (Math.abs(Math.abs(b) - F) > 1e-6) continue;
        if (!(lowAtStart ? g === segs[0] : g === segs[segs.length - 1])) continue;
        const sgn = b < 0 ? -1 : 1, [u0, u1, v0, v1] = toUV(-A - OVG, A + OVG, sgn < 0 ? -F - 0.34 : F, sgn < 0 ? -F : F + 0.34);
        addBox("roof", u0, u1, yS - 0.22, yS, v0, v1, [P_GUT, P_GUT, P_GUT, P_GUT, P_GUT, P_GUT], 1, S - 1);
      }
    }
    // a ridge cap (gable / gambrel) and a chimney: exact boxes (they stand on / through the planks)
    if (roofKind !== "lean") {
      const top = walkAt(0) + hvOf(segs[Math.floor(segs.length / 2)][2]), pc = pal("roof", shadeInt(roofC, 0.7));
      const [u0, u1, v0, v1] = toUV(-A - OVG, A + OVG, -0.16, 0.16);
      addBox("roof", u0, u1, top - 0.12, top + 0.1, v0, v1, [pc, pc, pc, pc, pc, pc], 1, S - 1);
    }
    if (rng() < TH.chimney && A > 2.2 && F > 2.2) {
      const sa = rng() < 0.5 ? -1 : 1, ac = sa * (A - 1.1), bc = (rng() < 0.5 ? -1 : 1) * Math.min(F * 0.45, 1.6), pc = pal("brick", pick(rng, [0x6e4b3a, 0x8a4a3a, 0x7a7468]));
      const yTop = Math.max(walkAt(bc) + 1.2, maxWalk + 0.5);
      const [u0, u1, v0, v1] = toUV(ac - 0.42, ac + 0.42, bc - 0.32, bc + 0.32), [w0, w1, x0, x1] = toUV(ac - 0.5, ac + 0.5, bc - 0.4, bc + 0.4);
      addBox("roof", u0, u1, yS, yTop, v0, v1, [pc, pc, pc, pc, pc, pc], 1, S - 1);
      const pk = pal("plaster", 0x55585c);
      addBox("roof", w0, w1, yTop, yTop + 0.12, x0, x1, [pk, pk, pk, pk, pk, pk], 1, S - 1);
    }
  } else {
    // hip roof: an overhanging slab over the walls, then stepped tiers (each an exact box)
    const P_ROOFD = pal("roof", shadeInt(roofC, 0.86));
    for (const [i, j, i1, j1] of roofRects) {
      const a0 = uL(i) - (i === 0 || !inFoot(i - 1, j) ? JAMB + OVERHANG : 0), a1 = uL(i1) + (i1 === nx || !inFoot(i1, j) ? JAMB + OVERHANG : 0);
      const b0 = vL(j) - (j === 0 || !inFoot(i, j - 1) ? JAMB + OVERHANG : 0), b1 = vL(j1) + (j1 === nz || !inFoot(i, j1) ? JAMB + OVERHANG : 0);
      addBox("roof", a0, a1, s[S] - SLAB, s[S], b0, b1, [P_ROOF, P_ROOF, P_ROOF, P_CEIL, P_ROOF, P_ROOF], 1, S - 1);
      for (let t = 1; t <= 3; t++) {
        const sh = 0.95 * t, e0 = a0 + sh, e1 = a1 - sh, g0 = b0 + sh, g1 = b1 - sh;
        if (e1 - e0 < 0.9 || g1 - g0 < 0.9) break;
        addBox("roof", e0, e1, s[S] + 0.42 * (t - 1), s[S] + 0.42 * t, g0, g1, [P_ROOFD, P_ROOFD, P_ROOF, P_ROOF, P_ROOFD, P_ROOFD], 1, S - 1);
      }
    }
    // a chimney (lodge) or nothing (resort)
    if (P.theme === "lodge") {
      const rr = roofRects[0], uc = uL(rr[0]) + 1.0, vc = (vL(rr[1]) + vL(rr[3])) / 2;
      const pc = pal("brick", 0x6e4b3a);
      addBox("roof", uc - 0.45, uc + 0.45, s[S], s[S] + 2.2, vc - 0.45, vc + 0.45, [pc, pc, pc, pc, pc, pc], 1, S - 1);
    }
  }

  // ---- stairs: the ramp collider, the fill under it, the drawn steps; the hole record
  const ramps = [], stairRecs = [];
  for (const st of stairs) {
    const sp = strips[st.strip], f = st.f;
    const across0 = (sp.axis === "col" ? uL(sp.at) : vL(sp.at)) + JAMB, across1 = (sp.axis === "col" ? uL(sp.at + 1) : vL(sp.at + 1)) - JAMB;
    const tAt = (k) => (sp.axis === "col" ? vL(k) : uL(k));
    const top = tAt(st.k), foot = tAt(st.k + 2);              // rising toward -t (from the foot at position k+2's line to the top at k's line)
    const run = foot - top, rise = s[f + 1] - s[f];
    const box = (t0, t1, yA, yB, part, faces, c) => (sp.axis === "col" ? addBox(part, across0, across1, yA, yB, t0, t1, faces, c, f) : addBox(part, t0, t1, yA, yB, across0, across1, faces, c, f));
    // ramp collider footprint (local) and its world rising direction
    const lr = sp.axis === "col" ? [across0, across1, top, foot] : [top, foot, across0, across1];
    ramps.push({ lr, y0: s[f], y1: s[f + 1], rise: sp.axis === "col" ? [0, -1] : [-1, 0], floor: f });
    // fill: 5 boxes under the ramp, each topped 0.2 m under the ramp surface at its high-side... at its LOW end (so never above the ramp)
    const m = rise / run, K = 5;
    for (let k = 1; k < K; k++) {
      const ta = foot - (k + 1) * run / K, tb = foot - k * run / K;            // nearer the top = higher
      const yTop = s[f] + m * (k * run / K) - 0.2;
      if (yTop - s[f] > 0.05) box(ta, tb, s[f], yTop, "fill", [P_STEPSIDE, P_STEPSIDE, P_STEPSIDE, P_STEPSIDE, P_STEPSIDE, P_STEPSIDE], 1);
    }
    // steps: N boxes from the floor up to the centre height of each tread (drawn only: the ramp collides)
    const N = Math.ceil(rise / RISER_MAX - 1e-9), tr = run / N, rs = rise / N;
    for (let k = 0; k < N; k++) {
      const tb = foot - k * tr, ta = foot - (k + 1) * tr;
      const fa = sp.axis === "col" ? [P_STEPSIDE, P_STEPSIDE, P_STEP, P_STEPSIDE, P_STEP, P_STEP] : [P_STEP, P_STEP, P_STEP, P_STEPSIDE, P_STEPSIDE, P_STEPSIDE];
      box(ta, tb, s[f], s[f] + (k + 0.5) * rs, "step", fa, 0);
    }
    const [ai, aj] = stripCell(sp, st.k + 2), [ei, ej] = stripCell(sp, st.k - 1);
    const holeR = sp.axis === "col" ? [uL(sp.at), vL(st.k), uL(sp.at + 1), vL(st.k + 2)] : [uL(st.k), vL(sp.at), uL(st.k + 2), vL(sp.at + 1)];
    stairRecs.push({ st, sp, f, lr, top, foot, run, rise, across0, across1, approach: [ai, aj], exit: [ei, ej], holeR, N, rs, tr });
  }
  for (const rr of roofRamps) ramps.push(rr);            // (after the stairs: stairs[k] <-> ramps[k] for k < stairs.length)
  // what the builder draws of the pitched roof: per plank its top, its two side faces, its free ends and its soffits; a polygon per end wall
  const roofTrisN = roofRamps.reduce((a, rr) => a + 2 + 4 + (rr.free[0] ? 2 : 0) + (rr.free[1] ? 2 : 0) + 2 * rr.soff.length, 0) + roofGables.reduce((a, g) => a + g.pts.length - 2, 0);

  // ---- rooms (records) and the per-room geometry used by the furnisher
  const roomRecs = [];
  const roomOfReg = new Map();
  for (const F of floors) {
    F.regs.forEach((r, ri) => {
      const cells = r.cells.map((c) => [c % nx, Math.floor(c / nx)]);
      let i0 = Infinity, j0 = Infinity, i1 = -Infinity, j1 = -Infinity;
      for (const [i, j] of cells) { i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i + 1); j1 = Math.max(j1, j + 1); }
      const rec = { id: P.id + ".f" + F.f + "r" + ri, floor: F.f, kind: r.kind, reg: r, ri, cells, bounds: [i0, j0, i1, j1], doors: [], stairs: [] };
      roomRecs.push(rec);
      roomOfReg.set(F.f + ":" + ri, rec);
    });
  }
  const roomAt = (f, c) => { const F = floors[f]; const ri = F.region[c]; return ri >= 0 ? roomOfReg.get(f + ":" + ri) : null; };

  // door geometry (local): centre, normal (a -> b / outward), opening extents
  const doorGeo = (d) => {
    if (d.ori === "H") {
      const v = vL(d.j), u = uL(d.i) + U / 2;
      return { u, v, nu: 0, nv: 1, along: "u", o0: uL(d.i) + JAMB, o1: uL(d.i + 1) - JAMB, line: v };
    }
    const u = uL(d.i), v = vL(d.j) + U / 2;
    return { u, v, nu: 1, nv: 0, along: "v", o0: vL(d.j) + JAMB, o1: vL(d.j + 1) - JAMB, line: u };
  };
  const winGeo = [];
  for (const F of floors) {
    for (let j = 0; j <= nz; j++) for (let i = 0; i < nx; i++) if (F.eH[j * nx + i] === 3) {
      const inner = inFoot(i, j) && j < nz ? cIdx(i, j) : cIdx(i, j - 1), out = inner === cIdx(i, j) ? -1 : 1;
      winGeo.push({ f: F.f, along: "u", line: vL(j), o0: uL(i) + WIN_MARGIN, o1: uL(i + 1) - WIN_MARGIN, nu: 0, nv: out, cell: inner });
    }
    for (let i = 0; i <= nx; i++) for (let j = 0; j < nz; j++) if (F.eV[i * nz + j] === 3) {
      const inner = inFoot(i, j) && i < nx ? cIdx(i, j) : cIdx(i - 1, j), out = inner === cIdx(i, j) ? -1 : 1;
      winGeo.push({ f: F.f, along: "v", line: uL(i), o0: vL(j) + WIN_MARGIN, o1: vL(j + 1) - WIN_MARGIN, nu: out, nv: 0, cell: inner });
    }
  }

  // ---- DRESSING: windows (a glass pane + a frame), doors (open leaves, a frame round the front door), blind windows on a tall shell's closed storeys.
  // Authored to the 2.5 m grid (H2's kit walls are a 2.2 m module and a 2.947 m storey: they do not fit these openings). Three kinds of box:
  //   glass  a 2 cm pane in a window's aperture, drawn only (the cover rule: bullets pass, nobody walks through: the sill and header do the blocking)
  //   skin   trim <= 1.5 cm proud, drawn only, lying flat on ONE collider face (inside the visual tolerance: nothing to shoot or bump that is not there)
  //   (the door LEAVES are not boxes since Wave 9 / LC-91: see "DOOR LEAVES" below - H.doorLeaves, each with a closed and an open slab collider)
  const SKIN = 0.015, dark = P.theme === "lodge";
  const P_GLASS = pal("glass", TH.ruined ? 0x4a5458 : 0x6f93a6), P_FRAME = pal(dark ? "wood" : "plaster", dark ? 0x3a2e24 : trimC), P_LEAF = pal("wood", dark ? 0x6e4a2e : P.theme === "resort" ? 0xf2efe6 : 0x8a5a3a);
  const P_SHUT = pal("wood", dark ? 0x4f6b3a : P.theme === "resort" ? pick(rng, [0x2f6f8a, 0x3a8a6a, 0x8a5a3a]) : 0x55606a), P_BLIND = pal("ceramic", 0x33475a);
  const shutters = rng() < (TH.shutters || 0);
  const leafRects = [];                                   // per floor: [u0, v0, u1, v1] the furnisher keeps clear (Wave 9: the OPEN slab of every door leaf)
  for (let f = 0; f < S; f++) leafRects.push([]);
  const doorSide = new Map();                             // door -> the side its leaves swing to (+1 / -1 along its wall's normal: the room it opens INTO)
  const skinOn = (along, line, nOut, t0, t1, ya, yb, pi, fl) => {     // a skin on the face at line + nOut * JAMB (nOut = the side it faces)
    const face = line + nOut * JAMB, c0 = nOut > 0 ? face : face - SKIN, c1 = nOut > 0 ? face + SKIN : face;
    const fc = [pi, pi, pi, pi, pi, pi];
    const bi = along === "u" ? addBox("skin", t0, t1, ya, yb, c0, c1, fc, 0, fl) : addBox("skin", c0, c1, ya, yb, t0, t1, fc, 0, fl);
    if (bi >= 0) boxes[bi].hp = along === "u" ? (nOut > 0 ? 63 & ~16 : 63 & ~32) : (nOut > 0 ? 63 & ~1 : 63 & ~2);     // (a plate: its outward face only)
    return bi;
  };
  const P_SILL = pal("plaster", P.theme === "lodge" || P.theme === "farm" ? 0xe8e0cc : shadeInt(trimC, 0.92));
  for (const w of winGeo) {
    const sf = s[w.f], n = w.along === "u" ? w.nv : w.nu, gp = [P_GLASS, P_GLASS, P_GLASS, P_GLASS, P_GLASS, P_GLASS];
    if (!rr5 || rr5() < 0.25) {                                 // (K1: a ruin's panes are mostly gone)
      if (w.along === "u") addBox("glass", w.o0, w.o1, sf + SILL, sf + HEAD, w.line - 0.01, w.line + 0.01, gp, 0, w.f);
      else addBox("glass", w.line - 0.01, w.line + 0.01, sf + SILL, sf + HEAD, w.o0, w.o1, gp, 0, w.f);
    }
    skinOn(w.along, w.line, n, w.o0, w.o1, sf + HEAD, sf + HEAD + 0.12, P_FRAME, w.f);                   // lintel (on the header box)
    // the sill: a real ledge (6 cm proud, 7 cm deep under the opening: an exact collider box, drawn == collider), round 3
    { const face = w.line + n * JAMB, c0 = n > 0 ? face : face - 0.06, c1 = n > 0 ? face + 0.06 : face, fc = [P_SILL, P_SILL, P_SILL, P_SILL, P_SILL, P_SILL];
      if (w.along === "u") addBox("trim", w.o0 - 0.07, w.o1 + 0.07, sf + SILL - 0.07, sf + SILL, c0, c1, fc, 1, w.f); else addBox("trim", c0, c1, sf + SILL - 0.07, sf + SILL, w.o0 - 0.07, w.o1 + 0.07, fc, 1, w.f); }
    // shutters (the theme's share of houses; every face but a shop's glazed front)
    const shopFront = use === "shop" && w.f === 0 && w.along === "u" && n > 0 && w.line === vL(nz);
    if (shutters && !shopFront) {
      skinOn(w.along, w.line, n, w.o0 - 0.47, w.o0 - 0.08, sf + SILL - 0.05, sf + HEAD + 0.05, P_SHUT, w.f);
      skinOn(w.along, w.line, n, w.o1 + 0.08, w.o1 + 0.47, sf + SILL - 0.05, sf + HEAD + 0.05, P_SHUT, w.f);
    }
  }
  for (const d of doors) {
    const F = floors[d.floor], g = doorGeo(d), sf = s[d.floor];
    // which side the leaves fold to: the room the door opens INTO (interior: room b; a street door: inside)
    const cPlus = d.ori === "H" ? cellAt(d.i, d.j) : cellAt(d.i, d.j), cMinus = d.ori === "H" ? cellAt(d.i, d.j - 1) : cellAt(d.i - 1, d.j);
    let side;
    if (d.kind !== "interior") side = cPlus >= 0 && F.type[cPlus] !== 0 ? 1 : -1;
    else side = d.b != null && cPlus >= 0 && F.region[cPlus] === d.b ? 1 : -1;
    const sideCell = side > 0 ? cPlus : cMinus;
    if (sideCell >= 0 && F.type[sideCell] === 1) doorSide.set(d, side);      // (a door opening onto a stair / hole cell gets no leaves)
    if (d.kind === "front") {                             // a frame round the front door, outside
      skinOn(g.along, g.line, -side, g.o0, g.o1, sf + DOOR_H, sf + DOOR_H + 0.15, P_FRAME, d.floor);
      skinOn(g.along, g.line, -side, g.o0 - 0.1, g.o0, sf, sf + DOOR_H + 0.15, P_FRAME, d.floor);
      skinOn(g.along, g.line, -side, g.o1, g.o1 + 0.1, sf, sf + DOOR_H + 0.15, P_FRAME, d.floor);
    }
  }
  // ---- DOOR LEAVES (Wave 9, LC-91: design W2, bound by contract C1). A leafed door is a DOUBLE door: two leaves of LEAF_LEN (each from its jamb's face to 5 mm
  // short of the opening's middle), LEAF_H tall (1 cm under the 2.4 m lintel: the closed door leaves no gap over 1 cm), 4 cm thick, single-acting INTO the room
  // (the side rule above), 90 degrees open: an OPEN leaf stands perpendicular to the wall at its jamb (t from the jamb face to + 4 cm, from the wall face LEAF_LEN
  // into the room - the clear width becomes 2.18 m), a CLOSED leaf lies in the wall line (+- 2 cm). Each leaf is TWO collider slabs (both built; the one of the
  // other state dead at run time: maps.js setDoor) and is drawn by maps.js (one BatchedMesh, the swing animated); housegen's own builder (buildHouse /
  // meshData) draws the START state, open. WHICH doors: every exterior (front / back) door and the interior doors whose id hashes under LEAF_SHARE (no rng drawn:
  // the house's stream is untouched), unless the swing fails the clearance test: the swing quarter discs (radius SWING_R round each hinge - the jamb face's
  // inner corner -, opening toward the room) must be free of structure colliders, stair zones (the stair, its approach and exit cells, the hole), a window's
  // lane (its opening +- 0.1 m, 0.3 m from its face) and another door's zone (opening +- 0.1 m, DOOR_ZONE deep each side), and must not meet another leafed
  // door's discs - exterior doors are decided first, then the interior ones by id: the later door loses. A door that fails keeps an open doorway (no leaf).
  // The discs are keep-outs for furniture (the swing side's door zone grows to DOOR_ZONE_LEAF), floor loot points and chests (selftest row "leaves").
  const LEAF_LEN = r3(DOOR_CLEAR / 2 - 0.005), LEAF_H = r3(DOOR_H - 0.01);
  const leafL = [];                                       // local leaves: { d, k, l, side, along, line, face, sf, f, th (hinge t), td (+1 / -1: toward the middle), closed / open [u0, u1, y0, y1, v0, v1] }
  const leafDiscs = [];                                   // accepted discs: { f, hu, hv, qu, qv } (local hinge; the quadrant's u / v signs)
  {
    const R2 = SWING_R * SWING_R;
    const quad = (hu, hv, qu, qv) => [qu > 0 ? hu : hu - SWING_R, qv > 0 ? hv : hv - SWING_R, qu > 0 ? hu + SWING_R : hu, qv > 0 ? hv + SWING_R : hv];
    const discHits = (D, r) => {                          // does quarter disc D meet rect r [u0, v0, u1, v1] with more than 1 mm of overlap (a face it only touches: no)
      const q = quad(D.hu, D.hv, D.qu, D.qv), x0 = Math.max(q[0], r[0]), x1 = Math.min(q[2], r[2]), y0 = Math.max(q[1], r[1]), y1 = Math.min(q[3], r[3]);
      if (x1 - x0 <= 1e-3 || y1 - y0 <= 1e-3) return false;
      const du = D.hu < x0 ? x0 - D.hu : D.hu > x1 ? D.hu - x1 : 0, dv = D.hv < y0 ? y0 - D.hv : D.hv > y1 ? D.hv - y1 : 0;
      return du * du + dv * dv < R2 - 1e-6;
    };
    const discsMeet = (A, B) => A.f === B.f && discHits(A, quad(B.hu, B.hv, B.qu, B.qv)) && discHits(B, quad(A.hu, A.hv, A.qu, A.qv));
    const cellR = (i, j) => [uL(i), vL(j), uL(i + 1), vL(j + 1)];
    const stairZ = []; for (let f = 0; f < S; f++) stairZ.push([]);
    for (const sr of stairRecs) {
      for (const k of [sr.st.k, sr.st.k + 1, sr.st.k + 2]) stairZ[sr.f].push(cellR(...stripCell(sr.sp, k)));
      for (const k of [sr.st.k - 1, sr.st.k, sr.st.k + 1]) if (sr.f + 1 < S) stairZ[sr.f + 1].push(cellR(...stripCell(sr.sp, k)));
    }
    const zoneOf = (g, Z) => (g.along === "u" ? [g.o0 - 0.1, g.line - Z, g.o1 + 0.1, g.line + Z] : [g.line - Z, g.o0 - 0.1, g.line + Z, g.o1 + 0.1]);
    const order = doors.map((d, k) => [d, k]).filter(([d]) => doorSide.has(d));
    order.sort((a, b) => (a[0].kind === "interior" ? 1 : 0) - (b[0].kind === "interior" ? 1 : 0) || a[1] - b[1]);
    for (const [d, k] of order) {
      if (d.kind === "interior" && leafHash(P.id + ".d" + k) >= LEAF_SHARE) continue;
      const g = doorGeo(d), side = doorSide.get(d), f = d.floor, sf = s[f], face = g.line + side * JAMB;
      // the room runs on SIDEWAYS from the cell in front of the opening (a hall, a corridor-like room, a room round a stair) but not around the leaf's tip: the
      // open leaves (tips 1.25 m out) would leave 1.1 m of the 2.26 m to pass them - narrower than the walk's fat capsule (the bots' free band, WALK_MARGIN):
      // no leaves. Passing is fine when the row beyond the tips is the same room both in front of the opening and beside it (3.5 m beyond the tips);
      // a one-cell room is a dead end (nothing to pass)
      {
        const Fd = floors[f], ci = d.ori === "H" ? d.i : (side > 0 ? d.i : d.i - 1), cj = d.ori === "H" ? (side > 0 ? d.j : d.j - 1) : d.j, rg = Fd.region[cellAt(ci, cj)];
        const same = (c) => c >= 0 && Fd.type[c] === 1 && Fd.region[c] === rg;
        const at = (lat, dep) => (d.ori === "H" ? cellAt(ci + lat, cj + dep * side) : cellAt(ci + dep * side, cj + lat));
        let narrow = false;
        for (const lat of [-1, 1]) if (same(at(lat, 0)) && !(same(at(0, 1)) && same(at(lat, 1)))) narrow = true;
        if (narrow) continue;
      }
      // the two discs (local): hinge at the jamb face's inner corner, the quadrant toward the middle of the opening and into the room
      const mk = (th, td) => (g.along === "u" ? { f, hu: th, hv: face, qu: td, qv: side } : { f, hu: face, hv: th, qu: side, qv: td });
      const D2 = [mk(g.o0, 1), mk(g.o1, -1)];
      let clear = true;
      for (const D of D2) {
        if (!clear) break;
        for (const b of boxes) if (b.c && b.y1 > sf + 0.01 && b.y0 < sf + LEAF_H && discHits(D, [b.u0, b.v0, b.u1, b.v1])) { clear = false; break; }
        if (clear) for (const r of stairZ[f]) if (discHits(D, r)) { clear = false; break; }
        if (clear) for (const w of winGeo) if (w.f === f && discHits(D, zoneOf(w, JAMB + 0.3))) { clear = false; break; }
        if (clear) for (const e of doors) if (e !== d && e.floor === f && discHits(D, zoneOf(doorGeo(e), JAMB + DOOR_ZONE))) { clear = false; break; }
        if (clear) for (const A of leafDiscs) if (discsMeet(A, D)) { clear = false; break; }
      }
      if (!clear) continue;
      for (const D of D2) leafDiscs.push(D);
      for (let l = 0; l < 2; l++) {
        const th = l === 0 ? g.o0 : g.o1, td = l === 0 ? 1 : -1;
        const ct0 = l === 0 ? g.o0 : g.o1 - LEAF_LEN, ct1 = l === 0 ? g.o0 + LEAF_LEN : g.o1;          // closed: along the wall line
        const ot0 = l === 0 ? g.o0 : g.o1 - LEAF_T, ot1 = l === 0 ? g.o0 + LEAF_T : g.o1;              // open: at the jamb, into the room
        const oc0 = side > 0 ? face : face - LEAF_LEN, oc1 = side > 0 ? face + LEAF_LEN : face;
        const closed = g.along === "u" ? [ct0, ct1, sf, sf + LEAF_H, g.line - LEAF_T / 2, g.line + LEAF_T / 2] : [g.line - LEAF_T / 2, g.line + LEAF_T / 2, sf, sf + LEAF_H, ct0, ct1];
        const open = g.along === "u" ? [ot0, ot1, sf, sf + LEAF_H, oc0, oc1] : [oc0, oc1, sf, sf + LEAF_H, ot0, ot1];
        leafL.push({ d, k, l, side, along: g.along, line: g.line, face, sf, f, th, td, closed, open });
        leafRects[f].push([open[0], open[4], open[1], open[5]]);
      }
    }
    leafL.sort((a, b) => a.k - b.k || a.l - b.l);          // (output order: by door id, then leaf)
  }
  const leafBoxes = leafL.map((L) => ({ p: "leaf", u0: L.open[0], u1: L.open[1], y0: L.open[2], y1: L.open[3], v0: L.open[4], v1: L.open[5], c: 1, fl: L.f }));   // the START state (open) as the walk and the view model see it
  if (shell) {                                            // blind windows on every closed storey (dark panels on the mass)
    const a0 = uL(0) - JAMB, a1 = uL(nx) + JAMB, b0 = vL(0) - JAMB, b1 = vL(nz) + JAMB, top = Math.min(FHu - 0.5, 2.9);
    const fc = [P_BLIND, P_BLIND, P_BLIND, P_BLIND, P_BLIND, P_BLIND];
    for (let g = 0; g < shell; g++) {
      const yb = s[S + g] + 0.9, yt = s[S + g] + top;
      const hp = (bi, h) => { if (bi >= 0) boxes[bi].hp = h; };
      for (let i = 0; i < nx; i++) { hp(addBox("skin", uL(i) + WIN_MARGIN, uL(i + 1) - WIN_MARGIN, yb, yt, b0 - SKIN, b0, fc, 0, S), 63 & ~32); hp(addBox("skin", uL(i) + WIN_MARGIN, uL(i + 1) - WIN_MARGIN, yb, yt, b1, b1 + SKIN, fc, 0, S), 63 & ~16); }
      for (let j = 0; j < nz; j++) { hp(addBox("skin", a0 - SKIN, a0, yb, yt, vL(j) + WIN_MARGIN, vL(j + 1) - WIN_MARGIN, fc, 0, S), 63 & ~2); hp(addBox("skin", a1, a1 + SKIN, yb, yt, vL(j) + WIN_MARGIN, vL(j + 1) - WIN_MARGIN, fc, 0, S), 63 & ~1); }
    }
  }

  // ---- EXTERIOR RELIEF (round 3, lane H6): what makes a front read from the street. Every piece a player can touch is an exact collider box
  // (part "trim": drawn == collider): belt courses at the floor lines, a cornice under the parapet, corner pilasters, a porch (deck, two posts,
  // a roof) or a door canopy, a stoop at every street door, a shop awning, balconies outside upper windows, a broken parapet on a ruin. Thin
  // colour (a plinth band) is a skin. Openings stay clear: nothing in a door's 2.26 x 2.4 m opening or its approach, nothing in a window's
  // aperture or the lanes shot through it (belts / cornices sit between the openings, posts on grid lines, roofs >= 2.6 m up).
  {
    const oU0 = uL(0) - JAMB, oU1 = uL(nx) + JAMB, oV0 = vL(0) - JAMB, oV1 = vL(nz) + JAMB, rect = !cut, y0p = y0;
    const trim = (u0, u1, ya, yb, v0, v1, pi, fl) => addBox("trim", u0, u1, ya, yb, v0, v1, Array.isArray(pi) ? pi : [pi, pi, pi, pi, pi, pi], 1, fl);   // (pi: one palette index, or six: +u -u +y -y +v -v)
    // a band round a rectangular plan, P proud: the front / back runs pass the corners, the sides fit between them (no two faces coplanar)
    // a band round the plan's outline, P proud (any rectangle or L): an H run wraps a convex corner (JAMB + P past the vertex) and stops at the
    // neighbouring wall's face at a concave one; a V run fits between: it stops at the H band's inner face (convex) or starts past its outer edge (concave)
    const ring = (ya, yb, P, pi, fl) => {
      for (let j = 0; j <= nz; j++) for (const outPlus of [true, false]) {
        const inRow = outPlus ? j - 1 : j, ext = (q) => inFoot(q, inRow) && !inFoot(q, outPlus ? j : j - 1);
        for (let i = 0; i < nx; i++) {
          if (!ext(i) || (i > 0 && ext(i - 1))) continue;
          let i1 = i; while (i1 + 1 < nx && ext(i1 + 1)) i1++;
          const ca = !inFoot(i - 1, inRow), cb = !inFoot(i1 + 1, inRow), face = vL(j) + (outPlus ? JAMB : -JAMB);
          trim(uL(i) + (ca ? -(JAMB + P) : JAMB), uL(i1 + 1) + (cb ? JAMB + P : -JAMB), ya, yb, outPlus ? face : face - P, outPlus ? face + P : face, pi, fl);
        }
      }
      for (let i = 0; i <= nx; i++) for (const outPlus of [true, false]) {
        const inCol = outPlus ? i - 1 : i, ext = (q) => inFoot(inCol, q) && !inFoot(outPlus ? i : i - 1, q);
        for (let j = 0; j < nz; j++) {
          if (!ext(j) || (j > 0 && ext(j - 1))) continue;
          let j1 = j; while (j1 + 1 < nz && ext(j1 + 1)) j1++;
          const ca = !inFoot(inCol, j - 1), cb = !inFoot(inCol, j1 + 1), face = uL(i) + (outPlus ? JAMB : -JAMB);
          trim(outPlus ? face : face - P, outPlus ? face + P : face, ya, yb, vL(j) + (ca ? -JAMB : JAMB + P), vL(j1 + 1) + (cb ? JAMB : -(JAMB + P)), pi, fl);
        }
      }
    };
    const P_BAND = pal("plaster", shadeInt(trimC, 0.95));
    const top = shell ? sTop + PARAPET : parapetRoof ? s[S] + PARAPET : s[S] - SLAB;
    if (rng() < TH.belts) for (let f = 1; f < S + shell; f++) ring(s[f] - 0.26, s[f] - 0.06, 0.1, P_BAND, f - 1 < S ? f - 1 : S);
    if (parapetRoof || shell) ring(top - 0.26, top - 0.08, 0.18, P_BAND, shell ? S : S - 1);       // the cornice
    if (rng() < TH.pilasters) {
      const yt = parapetRoof || shell ? top - 0.3 : s[S] - SLAB - 0.03, P_PIL = pal(baseOn ? palette[P_BASE].mat : "plaster", baseOn ? palette[P_BASE].color : shadeInt(trimC, 0.9));
      for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {               // every convex corner of the outline (one of its four cells inside)
        const ins = [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]].filter(([a, b]) => inFoot(a, b));
        if (ins.length !== 1) continue;
        const su = ins[0][0] === i - 1 ? 1 : -1, sv = ins[0][1] === j - 1 ? 1 : -1, cu = uL(i) + su * JAMB, cv = vL(j) + sv * JAMB;
        trim(su > 0 ? cu - 0.2 : cu - 0.08, su > 0 ? cu + 0.08 : cu + 0.2, y0p - BASE0, yt, sv > 0 ? cv - 0.2 : cv - 0.08, sv > 0 ? cv + 0.08 : cv + 0.2, P_PIL, 0);
      }
    }
    // the plinth band (a skin on the ground floor's outer faces, doors left open): per exterior run, to the corner at a convex end, short of a concave / door end
    {
      const P_PLINTH = pal(baseOn ? palette[P_BASE].mat : "plaster", shadeInt(baseOn ? palette[P_BASE].color : (fMat === "plank" ? 0x8a8278 : shadeInt(facadeC, 0.72)), 0.85));
      const F = floors[0], ya = y0p, yb = s[0] + 0.45;
      for (let j = 0; j <= nz; j++) for (const outPlus of [true, false]) {          // H lines: outward +v (inside cell j - 1) or -v (inside cell j)
        let i = 0;
        while (i < nx) {
          const ext = (q) => { const t = F.eH[j * nx + q]; return F.extH[j * nx + q] && (t === 1 || t === 3) && (outPlus ? inFoot(q, j - 1) : inFoot(q, j)); };
          if (!ext(i)) { i++; continue; }
          let i1 = i; while (i1 + 1 < nx && ext(i1 + 1)) i1++;
          const inRow = outPlus ? j - 1 : j, convA = !inFoot(i - 1, inRow), convB = !inFoot(i1 + 1, inRow);
          skinOn("u", vL(j), outPlus ? 1 : -1, uL(i) + (convA ? -JAMB : JAMB), uL(i1 + 1) + (convB ? JAMB : -JAMB), ya, yb, P_PLINTH, 0);
          i = i1 + 1;
        }
      }
      for (let i = 0; i <= nx; i++) for (const outPlus of [true, false]) {          // V lines: outward +u (inside cell i - 1) or -u (inside cell i)
        let j = 0;
        while (j < nz) {
          const ext = (q) => { const t = F.eV[i * nz + q]; return F.extV[i * nz + q] && (t === 1 || t === 3) && (outPlus ? inFoot(i - 1, q) : inFoot(i, q)); };
          if (!ext(j)) { j++; continue; }
          let j1 = j; while (j1 + 1 < nz && ext(j1 + 1)) j1++;
          const inCol = outPlus ? i - 1 : i, convA = !inFoot(inCol, j - 1), convB = !inFoot(inCol, j1 + 1);
          skinOn("v", uL(i), outPlus ? 1 : -1, vL(j) + (convA ? -JAMB : JAMB), vL(j1 + 1) + (convB ? JAMB : -JAMB), ya, yb, P_PLINTH, 0);
          j = j1 + 1;
        }
      }
    }
    // street doors: a porch (house fronts), an awning (a shop's front), a canopy, else a stoop
    const P_DECK = pal("wood", P.theme === "resort" ? 0xd8c8a8 : 0x8a6a48), P_POST = pal("wood", P.theme === "resort" ? 0xf4f0e6 : shadeInt(trimC, 0.9)), P_STOOP = pal("plaster", 0x9c978e);
    const P_AWN = pal("fabric", pick(rng, [0xb03a2e, 0x2f6f8a, 0x3a7a4a, 0xd8a03a, 0x6a3a6a, 0xe8e2d6]));
    // (stage B, lane I1) a porch / canopy ceiling is painted light (a porch's beadboard, a canopy's soffit): in the shade under it the roof colour read near black from
    // the doorway (interiorcheck light: a lodge porch's dark roof underside was a third of the entrance view)
    const P_CEIL = pal("wood", P.theme === "lodge" || P.theme === "farm" ? 0xc9b48e : 0xe6dfd0), undersideOf = (pi) => [pi, pi, pi, P_CEIL, pi, pi];
    const porchOn = use === "house" && rng() < TH.porch, awnOn = use === "shop" && rng() < TH.awning, canopyOn = rng() < TH.canopy;
    for (const d of doors) {
      if (d.kind === "interior") continue;
      const g = doorGeo(d), F = floors[0], cPlus = cellAt(d.i, d.j), plusIn = cPlus >= 0 && F.type[cPlus] !== 0, n = plusIn ? -1 : 1;     // n: outward along the door's normal
      const face = g.line + n * JAMB, out = (a, b) => (n > 0 ? [face + a, face + b] : [face - b, face - a]);
      const box = (t0, t1, ya, yb, a, b, pi) => { const [c0, c1] = out(a, b); if (g.along === "u") trim(t0, t1, ya, yb, c0, c1, pi, 0); else trim(c0, c1, ya, yb, t0, t1, pi, 0); };
      const front = d.kind === "front";
      if (front && porchOn) {
        const ti = d.i, t0 = Math.max(oU0, uL(ti - 1)), t1 = Math.min(oU1, uL(ti + 2)), dep = 2.2;
        box(t0, t1, y0p - BASE0, s[0], 0, dep, P_DECK);                                                           // the deck (floor level: one 5 cm step)
        box(t0 + 0.02, t0 + 0.18, s[0], s[0] + 2.62, dep - 0.18, dep - 0.02, P_POST); box(t1 - 0.18, t1 - 0.02, s[0], s[0] + 2.62, dep - 0.18, dep - 0.02, P_POST);
        box(t0 - 0.1, t1 + 0.1, s[0] + 2.62, s[0] + 2.78, 0, dep + 0.15, undersideOf(P_ROOF));                   // its roof (a light ceiling under it)
        continue;
      }
      if (front && awnOn) {
        box(oU0 + 0.05, oU1 - 0.05, s[0] + 2.62, s[0] + 2.76, 0, 1.3, P_AWN);
        box(oU0 + 0.05, oU1 - 0.05, s[0] + 2.4, s[0] + 2.62, 1.25, 1.3, P_AWN);
      } else if (front && canopyOn) box(g.o0 - 0.35, g.o1 + 0.35, s[0] + 2.6, s[0] + 2.72, 0, 1.0, undersideOf(P_TRIM));
      box(g.o0 - 0.15, g.o1 + 0.15, y0p - BASE0, s[0], 0, 0.8, P_STOOP);                                         // the stoop
    }
    // balconies outside the street-face windows of the upper floors (a slab, a balustrade: nobody walks out there - the window is a firing port)
    if (S >= 2 && rng() < TH.balcony) {
      const P_BAL = pal("plaster", trimC);
      for (const w of winGeo) {
        if (w.f < 1 || w.along !== "u" || w.nv <= 0 || w.line !== vL(nz) || rng() > 0.7) continue;
        const sf = s[w.f], face = w.line + JAMB, t0 = w.o0 - 0.45, t1 = w.o1 + 0.45;
        trim(t0, t1, sf - 0.16, sf, face, face + 1.05, P_BAL, w.f);
        trim(t0, t1, sf, sf + 1.0, face + 0.99, face + 1.05, P_BAL, w.f);
        trim(t0, t0 + 0.06, sf, sf + 1.0, face, face + 0.99, P_BAL, w.f); trim(t1 - 0.06, t1, sf, sf + 1.0, face, face + 0.99, P_BAL, w.f);
      }
    }
    // a ruin's broken parapet: uneven stubs of wall on its top
    const stubs = [];                                     // (K1) the ruin's parapet stubs: [along, line, t0, t1, top]
    if (TH.ruined && parapetRoof && rect) {
      const yb = s[S] + PARAPET, P_STUB = P_FACADE;
      for (const [along, line] of [["u", vL(0)], ["u", vL(nz)], ["v", uL(0)], ["v", uL(nx)]]) {
        const L0 = along === "u" ? oU0 : oV0, L1 = along === "u" ? oU1 : oV1;
        let t = L0 + 0.24 + rng() * 0.8;
        while (t < L1 - 0.6) {
          const len = Math.min(0.4 + rng() * 1.1, L1 - 0.24 - t), h = 0.15 + rng() * 0.55;
          if (len > 0.2) { if (along === "u") trim(t, t + len, yb, yb + h, line - JAMB, line + JAMB, P_STUB, S - 1); else trim(line - JAMB, line + JAMB, yb, yb + h, t, t + len, P_STUB, S - 1); stubs.push([along, line, t, t + len, yb + h]); }
          t += len + 0.3 + rng() * 1.0;
        }
      }
    }
    // (Wave 8 fix round, lane K1) A RUIN READS AS A RUIN: the crater-rim village was a hilltop of intact dark boxes (verify_b LOOK). From its own stream (rr5: the
    // house's rng, and so its rooms and furniture, are untouched): the collapsed upper storey's jagged remnants stepped up on the parapet stubs (1.0-2.6 m, a
    // tall corner fragment), charred joists fallen across the roof and poking out of the broken wall tops, masonry rubble heaped on the roof and against the
    // walls outside (exact collider boxes, the lowest step <= 0.4 m: walked over), scorch fans over the windows and doors, cracks, moss streaks, weeds at the
    // foot of the walls and on the roof (drawn only: skins on a collider face, or deco tufts outside every opening's approach), broken panes (no glass in most
    // windows). Openings stay clear: nothing within 0.6 m of a doorway's sides or in front of it, nothing in a window's aperture.
    if (TH.ruined) {
      const nbRuin = boxes.length;                        // (K1 re-run: every box of the wreckage below is flagged ns - drawn, never in the shadow pass; see the end of this block)
      const rr = rr5, P_SOOT = pal(fMat, 0x3a332c), P_SOOT2 = pal(fMat, 0x5e554a), P_MOSS = pal("fabric", 0x5f6c47), P_WEED = pal("fabric", 0x5d7036), P_WEED2 = pal("fabric", 0x7c8546);
      const P_RUB = pal("stone", 0xa39a88), P_RUB2 = pal("stone", 0x857d70), P_BEAM = pal("wood", 0x2f2620), P_CRACK = pal(fMat, 0x3a342e);
      const top = s[S] + (parapetRoof ? PARAPET : 0), rf = s[S];
      // the outline's exterior runs (any rectangle or L): [along, line, n (outward), t0, t1], the outer face to the corner at a convex end, short of a concave one
      const F0 = floors[0], runs = [];
      for (let j = 0; j <= nz; j++) for (const outPlus of [true, false]) {
        const inRow = outPlus ? j - 1 : j, ext = (q) => { const e = F0.eH[j * nx + q]; return F0.extH[j * nx + q] && e > 0 && e !== 4 && inFoot(q, inRow) && !inFoot(q, outPlus ? j : j - 1); };
        for (let i = 0; i < nx; i++) {
          if (!ext(i) || (i > 0 && ext(i - 1))) continue;
          let i1 = i; while (i1 + 1 < nx && ext(i1 + 1)) i1++;
          runs.push(["u", vL(j), outPlus ? 1 : -1, uL(i) + (!inFoot(i - 1, inRow) ? -JAMB : JAMB), uL(i1 + 1) + (!inFoot(i1 + 1, inRow) ? JAMB : -JAMB)]);
        }
      }
      for (let i = 0; i <= nx; i++) for (const outPlus of [true, false]) {
        const inCol = outPlus ? i - 1 : i, ext = (q) => { const e = F0.eV[i * nz + q]; return F0.extV[i * nz + q] && e > 0 && e !== 4 && inFoot(inCol, q) && !inFoot(outPlus ? i : i - 1, q); };
        for (let j = 0; j < nz; j++) {
          if (!ext(j) || (j > 0 && ext(j - 1))) continue;
          let j1 = j; while (j1 + 1 < nz && ext(j1 + 1)) j1++;
          runs.push(["v", uL(i), outPlus ? 1 : -1, vL(j) + (!inFoot(inCol, j - 1) ? -JAMB : JAMB), vL(j1 + 1) + (!inFoot(inCol, j1 + 1) ? JAMB : -JAMB)]);
        }
      }
      // the openings on a line: [t0, t1, y0, y1, door?] (windows of every floor, exterior doors)
      const opens = (along, line) => {
        const o = [];
        for (const w of winGeo) if (w.along === along && Math.abs(w.line - line) < 1e-6) o.push([w.o0, w.o1, s[w.f] + SILL, s[w.f] + HEAD]);
        for (const d of doors) { if (d.kind === "interior") continue; const g = doorGeo(d); if (g.along === along && Math.abs(g.line - line) < 1e-6) o.push([g.o0, g.o1, s[d.floor], s[d.floor] + DOOR_H, 1]); }
        return o;
      };
      const free = (op, t0, t1, ya, yb, m) => op.every((q) => t1 <= q[0] - m || t0 >= q[1] + m || yb <= q[2] - 0.05 || ya >= q[3] + 0.05);
      const doorFree = (op, t0, t1, m) => op.every((q) => !q[4] || t1 <= q[0] - m || t0 >= q[1] + m);
      const deco = (u0, u1, ya, yb, v0, v1, pi) => { const bi = addBox("deco", u0, u1, ya, yb, v0, v1, [pi, pi, pi, pi, pi, pi], 0, 0); if (bi >= 0) boxes[bi].nc = 1; return bi; };
      const span = (q0, q1) => [Math.min(q0, q1), Math.max(q0, q1)];
      // a box against an outer face: t along the line, a0..a1 out from the line (n), ya..yb; kind "deco" = drawn only, never hides a face
      const bx = (along, line, n, t0, t1, a0, a1, ya, yb, pi, kind) => {
        const [c0, c1] = span(line + n * a0, line + n * a1), dc = kind === "deco", fc = [pi, pi, pi, pi, pi, pi];
        const bi = along === "u" ? addBox(kind || "trim", t0, t1, ya, yb, c0, c1, fc, dc ? 0 : 1, dc ? 0 : S - 1) : addBox(kind || "trim", c0, c1, ya, yb, t0, t1, fc, dc ? 0 : 1, dc ? 0 : S - 1);
        if (bi >= 0 && dc) boxes[bi].nc = 1;
        return bi;
      };
      // the convex corners of the outline: [u, v of the outer face corner, su, sv (the outward signs)]
      const convexCorners = () => {
        const corners = [];
        for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
          const ins = [[i - 1, j - 1], [i, j - 1], [i - 1, j], [i, j]].filter(([q, r]) => inFoot(q, r));
          if (ins.length !== 1) continue;
          const su = ins[0][0] === i - 1 ? 1 : -1, sv = ins[0][1] === j - 1 ? 1 : -1;
          corners.push([uL(i) + su * JAMB, vL(j) + sv * JAMB, su, sv]);
        }
        return corners;
      };
      const inFootPt = (u, v) => inFoot(Math.floor((u + W / 2) / U), Math.floor((v + D / 2) / U));
      const onRoof = (u0, u1, v0, v1) => { const m = JAMB + 0.33; return inFootPt(u0 - m, v0 - m) && inFootPt(u1 + m, v0 - m) && inFootPt(u0 - m, v1 + m) && inFootPt(u1 + m, v1 + m) && inFootPt((u0 + u1) / 2, (v0 + v1) / 2); };
      // (1) the remnants of the collapsed upper storey on a flat roof: the parapet stubs (a rectangle's, above; an L's are laid here), half of them stepped up
      // one or two narrower courses (a jagged skyline), one a tall corner fragment; their tops charred
      if (parapetRoof) {
        if (!stubs.length) for (const [along, line, , t0r, t1r] of runs) {
          let tt = t0r + 0.24 + rr() * 0.8;
          while (tt < t1r - 0.6) {
            const len = Math.min(0.4 + rr() * 1.1, t1r - 0.24 - tt), h = 0.15 + rr() * 0.55;
            if (len > 0.2) { if (along === "u") trim(tt, tt + len, top, top + h, line - JAMB, line + JAMB, P_FACADE, S - 1); else trim(line - JAMB, line + JAMB, top, top + h, tt, tt + len, P_FACADE, S - 1); stubs.push([along, line, tt, tt + len, top + h]); }
            tt += len + 0.6 + rr() * 1.4;
          }
        }
        const tall = stubs.length ? Math.floor(rr() * stubs.length) : -1, remn = [];
        stubs.forEach(([along, line, t0, t1, y], k) => {
          if (k !== tall && rr() > 0.25) return;
          let a = t0, b = t1, yy = y;
          const steps = k === tall ? 3 : 1 + (rr() < 0.15 ? 1 : 0);
          for (let q = 0; q < steps; q++) {
            const len = (b - a) * (0.55 + rr() * 0.3);
            if (len < 0.25) break;
            const off = rr() < 0.5 ? 0 : (b - a) - len, h = k === tall ? 0.7 + rr() * 0.5 : 0.3 + rr() * 0.55;
            a += off; b = a + len;
            if (along === "u") trim(a, b, yy, yy + h, line - JAMB, line + JAMB, P_FACADE, S - 1); else trim(line - JAMB, line + JAMB, yy, yy + h, a, b, P_FACADE, S - 1);
            remn.push([along, line, a, b, yy + h]);
            yy += h;
          }
          if (k === tall && yy - y > 0.2) for (const nn of [1, -1]) skinOn(along, line, nn, a + 0.02, b - 0.02, yy - 0.18, yy, P_SOOT2, S - 1);      // (the tall fragment's top is charred)
        });
        // (1b) A STANDING CORNER of the collapsed storey (K1, after the first look: stubs and a pillar read as a crenellated roof, not as a storey that fell):
        // at one or two convex corners of the outline, the two walls that met there still rise 1.4-2.8 m over the parapet and break off in jagged steps
        // 1.1-2.7 m along each run. Wall-thick boxes ON the wall line (no new ledge or pocket: every piece stands on the parapet, a stub or a remnant step
        // and only fills the column above what is already there, so nothing overlaps); the top course charred.
        const cs = convexCorners();
        for (let k = 0, nk = cs.length ? 1 + (rr() < 0.45 ? 1 : 0) : 0; k < nk; k++) {
          const ci = Math.floor(rr() * cs.length), [U0, V0, su, sv] = cs[ci]; cs.splice(ci, 1);
          const Hc = 1.4 + rr() * 1.4;
          for (const along of ["u", "v"]) {
            const line = along === "u" ? V0 - sv * JAMB : U0 - su * JAMB, sgn = along === "u" ? su : sv, T0c = along === "u" ? U0 : V0;   // the wall line; the run goes inward (-sgn) from the outer corner
            const run = runs.find((q) => q[0] === along && Math.abs(q[1] - line) < 1e-6 && Math.min(q[3], q[4]) - 1e-6 <= T0c && Math.max(q[3], q[4]) + 1e-6 >= T0c);
            if (!run) continue;
            const Lmax = (run[4] - run[3]) * 0.6, L = Math.min(Lmax, 1.1 + rr() * 1.6);
            if (L < 0.7) continue;
            const d0 = along === "u" ? 0 : 2 * JAMB;          // (the corner square is the u wall's)
            // the profile: three courses stepping down away from the corner
            const prof = [], nS = 3;
            let dd = 0, hh = Hc;
            for (let q = 0; q < nS; q++) { const w = q === nS - 1 ? L - dd : L * (0.22 + rr() * 0.16); prof.push([dd, Math.min(L, dd + w), hh]); dd += w; hh *= 0.5 + rr() * 0.2; if (dd >= L - 0.05) break; }
            // what already stands on this line (stubs + remnant steps), and the elementary intervals between every boundary
            const occ = stubs.concat(remn).filter((q) => q[0] === along && Math.abs(q[1] - line) < 1e-6);
            for (const [pa, pb, ph] of prof) {
              const da = Math.max(pa, d0);
              if (pb - da < 0.05) continue;
              const ta = Math.min(T0c - sgn * da, T0c - sgn * pb), tb = Math.max(T0c - sgn * da, T0c - sgn * pb);
              const cut2 = [ta, tb]; for (const q of occ) for (const x of [q[2], q[3]]) if (x > ta + 1e-6 && x < tb - 1e-6) cut2.push(x);
              cut2.sort((p, q) => p - q);
              const yTop = top + ph;
              for (let e = 0; e + 1 < cut2.length; e++) {
                const ea = cut2[e], eb = cut2[e + 1]; if (eb - ea < 1e-4) continue;
                let base = top; for (const q of occ) if (q[2] < eb - 1e-6 && q[3] > ea + 1e-6) base = Math.max(base, q[4]);
                if (yTop - base < 0.08) continue;
                if (along === "u") trim(ea, eb, base, yTop, line - JAMB, line + JAMB, P_FACADE, S - 1); else trim(line - JAMB, line + JAMB, base, yTop, ea, eb, P_FACADE, S - 1);
                if (pa === 0 && yTop - base >= 0.3 && eb - ea >= 0.1) for (const nn of [1, -1]) skinOn(along, line, nn, ea + 0.02, eb - 0.02, yTop - 0.2, yTop, P_SOOT2, S - 1);   // (the corner course is charred: a skin per piece, flat on its one face)
              }
            }
          }
        }
      }
      // (2) charred joists: two or three lying across the roof, one poking out of a broken wall top
      const rU0 = uL(0) + JAMB + 0.3, rU1 = uL(nx) - JAMB - 0.3, rV0 = vL(0) + JAMB + 0.3, rV1 = vL(nz) - JAMB - 0.3;
      for (let k = 0, nB = 1; k < nB; k++) {
        const alongU = rr() < 0.5, L = 1.4 + rr() * 2.2, w = 0.16, h = 0.16, fc = [P_BEAM, P_BEAM, P_BEAM, P_BEAM, P_BEAM, P_BEAM];
        if (alongU) { const t0 = rU0 + rr() * Math.max(0, rU1 - rU0 - L), v = rV0 + rr() * Math.max(0, rV1 - rV0 - w), t1 = Math.min(rU1, t0 + L); if (onRoof(t0, t1, v, v + w)) addBox("trim", t0, t1, rf, rf + h, v, v + w, fc, 1, S - 1); }
        else { const t0 = rV0 + rr() * Math.max(0, rV1 - rV0 - L), u = rU0 + rr() * Math.max(0, rU1 - rU0 - w), t1 = Math.min(rV1, t0 + L); if (onRoof(u, u + w, t0, t1)) addBox("trim", u, u + w, rf, rf + h, t0, t1, fc, 1, S - 1); }
      }
      if (parapetRoof && stubs.length) {                  // a joist end through a wall top, 0.6 m out (the roof it carried is gone)
        const [along, line, t0, t1, y] = stubs[Math.floor(rr() * stubs.length)], tm = (t0 + t1) / 2;
        const n = along === "u" ? (inFootPt(tm, line - 0.3) ? 1 : -1) : (inFootPt(line - 0.3, tm) ? 1 : -1);
        bx(along, line, n, tm - 0.09, tm + 0.09, -1.4, JAMB + 0.5, y, y + 0.18, P_BEAM);
      }
      // (3) rubble heaped on the roof: two or three piles of fallen masonry (a block and a smaller one on it, a weed)
      const pileAt = (u, v, size) => {
        const a = 0.35 + size * 0.35, h0 = 0.18 + size * 0.2;
        if (!onRoof(u - a, u + a, v - a, v + a)) return;
        const c = rr() < 0.5 ? P_RUB : P_RUB2;
        addBox("trim", u - a, u + a, rf, rf + h0, v - a * 0.8, v + a * 0.8, [c, c, c, c, c, c], 1, S - 1);
        const a2 = a * (0.45 + rr() * 0.25), du = (rr() - 0.5) * a * 0.6, dv = (rr() - 0.5) * a * 0.5;
        addBox("trim", u + du - a2, u + du + a2, rf + h0, rf + h0 + 0.12 + size * 0.14, v + dv - a2 * 0.9, v + dv + a2 * 0.9, [P_RUB2, P_RUB2, P_RUB2, P_RUB2, P_RUB2, P_RUB2], 1, S - 1);
        if (size > 0.6) { const a3 = a2 * 0.55; deco(u + du - a3 - 0.15, u + du - 0.15, rf + h0, rf + h0 + 0.1, v - a3, v + a3, P_WEED); }
      };
      for (let k = 0, n = 1 + (rr() < 0.5 ? 1 : 0); k < n; k++) pileAt(rU0 + 0.4 + rr() * Math.max(0, rU1 - rU0 - 0.8), rV0 + 0.4 + rr() * Math.max(0, rV1 - rV0 - 0.8), 0.3 + rr() * 0.6);
      // (4) outside, against the walls: rubble piles (the walls shed their stones) and weeds at the foot, never in a door's approach (1.6 m each side) or under a
      // window (shots and looks through it); the lowest course <= 0.4 m (a walker steps onto it), a pile <= 0.8 m
      const yg = y0 - BASE0;
      for (const [along, line, n, t0r, t1r] of runs) {
        const op = opens(along, line);
        for (let t = t0r + 0.6 + rr() * 1.2; t < t1r - 0.9; t += 2.4 + rr() * 2.6) {
          const a = 0.35 + rr() * 0.35;
          if (!doorFree(op, t - a, t + a, 1.6) || !free(op, t - a, t + a, s[0], s[0] + HEAD, 0.3)) continue;
          if (rr() < 0.5) {
            const c = rr() < 0.5 ? P_RUB : P_RUB2, d0 = JAMB, d1 = JAMB + 0.45 + rr() * 0.35, h1 = y0 + 0.22 + rr() * 0.16;
            bx(along, line, n, t - a, t + a, d0, d1, yg, h1, c);
            if (rr() < 0.4) { const a2 = a * 0.6, dd = d0 + (d1 - d0) * 0.6; bx(along, line, n, t - a2, t + a2 * 0.8, d0, dd, h1, h1 + 0.18 + rr() * 0.2, P_RUB2); }
          }
          for (let q = 0, nq = rr() < 0.6 ? 1 : 0; q < nq; q++) {    // weeds: a tuft at the foot of the wall, now and then
            const tq = t + (rr() - 0.5) * 1.4, wq = 0.08 + rr() * 0.1, d0 = JAMB + 0.02 + rr() * 0.5, hq = 0.12 + rr() * 0.22;
            if (tq - wq < t0r || tq + wq > t1r || !doorFree(op, tq - wq, tq + wq, 0.9)) continue;
            bx(along, line, n, tq - wq, tq + wq, d0, d0 + wq * 1.6, y0 - 0.02, y0 + hq, rr() < 0.5 ? P_WEED : P_WEED2, "deco");
          }
        }
      }
      // (4b) a heap at one or two convex corners of the outline (where the upper storey fell): three courses <= 0.4 m each, the biggest ~1.6 m across, a scrub clump
      const corners = convexCorners();
      for (let k = 0, nk = 1; k < nk && corners.length; k++) {
        const [U0, V0, su, sv] = corners[Math.floor(rr() * corners.length)];
        const nearDoor = doors.some((d) => { if (d.kind === "interior") return false; const g = doorGeo(d); return Math.hypot(g.u - U0, g.v - V0) < 3.6; });
        if (nearDoor) continue;                           // (a corner beside a doorway keeps its approach clear)
        let a = 0.75 + rr() * 0.4, yy = yg, hTop = y0;
        for (let q = 0; q < 3 && a > 0.25; q++) {
          const h = 0.24 + rr() * 0.14, c = q % 2 ? P_RUB2 : P_RUB, ins = Math.min(a * 0.35, 0.2);   // (into the wall's 0.24 m thickness, never through it into a room)
          const u0 = su > 0 ? U0 - ins : U0 - a, u1 = su > 0 ? U0 + a : U0 + ins, v0 = sv > 0 ? V0 - ins : V0 - a, v1 = sv > 0 ? V0 + a : V0 + ins;
          addBox("trim", u0, u1, yy, hTop + h, v0, v1, [c, c, c, c, c, c], 1, 0);
          yy = hTop + h; hTop = yy; a *= 0.62;
        }
        const bu = U0 + su * (0.95 + rr() * 0.4), bv = V0 + sv * (0.2 + rr() * 0.5), bw = 0.3 + rr() * 0.2, bh = 0.2 + rr() * 0.15;
        deco(bu - bw, bu + bw * 0.6, y0 - 0.02, y0 + bh, bv - bw * 0.7, bv + bw * 0.5, P_WEED);
        deco(bu - bw * 0.4, bu + bw, y0 - 0.02, y0 + bh * 0.7, bv - bw * 0.3, bv + bw * 0.9, P_WEED2);
      }
      // (5) scorch licks over the openings, cracks and moss on the solid stretches (skins: drawn only, flat on the wall's outer face; two never overlap)
      for (const [along, line, n, t0r, t1r] of runs) {
        const op = opens(along, line), T0 = t0r + 0.25, T1 = t1r - 0.25, used = [];
        const clear = (a, b, ya, yb) => used.every((q) => b <= q[0] || a >= q[1] || yb <= q[2] || ya >= q[3]);
        const skin = (a, b, ya, yb, pi) => { if (a < t0r || b > t1r || !clear(a, b, ya, yb)) return false; used.push([a, b, ya, yb]); skinOn(along, line, n, a, b, ya, yb, pi, S - 1); return true; };
        for (const q of op) {
          if (q[0] < t0r || q[1] > t1r || rr() > 0.45) continue;
          // a flame lick: a band as wide as the opening less 10 cm, then two narrower, lighter ones off-centre (the smoke went up and sideways)
          let a = q[0] + 0.05, b = q[1] - 0.05, y = q[3] + (q[4] ? 0.15 : 0.12);
          for (let k = 0; k < 2 && y < top - 0.08; k++) {
            const h = Math.min(0.24 + rr() * 0.16, top - 0.05 - y);
            if (h > 0.05 && free(op, a, b, y, y + h, 0.02)) skin(a, b, y, y + h, k ? P_SOOT2 : P_SOOT);
            y += h; const w = (b - a) * (0.5 + rr() * 0.2), c = a + (b - a - w) * rr(); a = c; b = c + w;
            if (b - a < 0.16) break;
          }
        }
        for (let c = 0, nc = rr() < 0.55 ? 1 : 0; c < nc; c++) {     // cracks: a zig-zag of short dark slivers down from the wall top (on about half the walls)
          let tt = T0 + rr() * Math.max(0, T1 - T0), y = top - 0.1 - rr() * 0.4;
          for (let k = 0; k < 4; k++) {
            const h = 0.3 + rr() * 0.3, dt = (rr() < 0.5 ? -1 : 1) * (0.06 + rr() * 0.1);
            if (y - h < s[0] + 0.55 || tt < T0 || tt > T1 || !free(op, tt - 0.05, tt + 0.05, y - h, y, 0.25) || !skin(tt - 0.025, tt + 0.025, y - h, y, P_CRACK)) break;
            y -= h * 0.85; tt += dt;
          }
        }
        for (let c = 0, nm = rr() < 0.55 ? 1 : 0; c < nm; c++) {     // moss: a streak down from the wall top (on about half the walls)
          const tt = T0 + rr() * Math.max(0, T1 - T0 - 0.4), w = 0.08 + rr() * 0.12, h = 0.4 + rr() * 0.9;
          if (free(op, tt, tt + w, top - 0.05 - h, top - 0.05, 0.1)) skin(tt, tt + w, top - 0.05 - h, top - 0.05, P_MOSS);
        }
      }
      // (6) weeds on the roof: tufts in its corners and along the parapet
      for (let k = 0, n = 2 + Math.floor(rr() * 3); k < n; k++) {
        const u = rr() < 0.5 ? rU0 + rr() * 0.4 : rU1 - rr() * 0.4, v = rV0 + rr() * Math.max(0, rV1 - rV0), w = 0.1 + rr() * 0.12;
        if (onRoof(u - w, u + w, v - w, v + w)) deco(u - w, u + w, rf, rf + 0.12 + rr() * 0.2, v - w, v + w, rr() < 0.5 ? P_WEED : P_WEED2);
      }
      // (7) (K1 re-run) A BURNT-THROUGH ROOF, as the drop sees it: from the air the rim village still read as whole flat roofs (crater_after7_air0: dusty roofs,
      // jagged parapets, no holes). A real hole would leave a room with no drawn ceiling (interiorcheck ceiling) and open the storey to the sky, so the roof
      // keeps its slab and the hole is PAINTED on it: a charred ring, a near-black core of three overlapping lobes and burnt rafters across it - plates
      // (skins <= 1.5 cm, top face only, each lying on the roof slab's top: drawn with the walls, so the drop sees them - a 'deco' box is furniture, hidden
      // past 60 m), materials the ruin already uses (no new material / program / draw call). Last in this stream (rr5): every earlier ruin draw is unchanged.
      if (parapetRoof) {
        // (a plate lies flat on collider tops only: the roof slab's, the slab boxes whose top is the roof surface - never over a roof opening)
        const tops = boxes.filter((b) => b.c && b.p !== "skin" && Math.abs(b.y1 - rf) < 1e-6);
        const onTops = (u0, u1, v0, v1) => {
          for (let qu = 0; qu <= 12; qu++) for (let qv = 0; qv <= 12; qv++) {
            const u = u0 + (u1 - u0) * (qu === 0 ? 0.001 : qu === 12 ? 0.999 : qu / 12), v = v0 + (v1 - v0) * (qv === 0 ? 0.001 : qv === 12 ? 0.999 : qv / 12);
            if (!tops.some((b) => u >= b.u0 && u <= b.u1 && v >= b.v0 && v <= b.v1)) return false;
          }
          return true;
        };
        const plate = (u0, u1, t, v0, v1, pi) => { if (!onTops(u0, u1, v0, v1)) return -1; const bi = addBox("skin", u0, u1, rf, rf + t, v0, v1, [pi, pi, pi, pi, pi, pi], 0, S - 1); if (bi >= 0) boxes[bi].hp = 63 & ~4; return bi; };
        const P_CHAR = pal(fMat, 0x2e2924), P_HOLE = pal("fabric", 0x16130f), P_RAFT = pal("wood", 0x3b2f25);
        const area = (rU1 - rU0) * (rV1 - rV0);
        for (let k = 0, nh = (rr() < 0.85 ? 1 : 0) + (area > 60 && rr() < 0.4 ? 1 : 0); k < nh; k++) {
          const a = Math.min(1.0 + rr() * 0.8, Math.min(rU1 - rU0, rV1 - rV0) / 2.7), uc = rU0 + a * 1.3 + rr() * Math.max(0, rU1 - rU0 - a * 2.6), vc = rV0 + a * 1.3 + rr() * Math.max(0, rV1 - rV0 - a * 2.6);
          const lob = (fu0, fu1, fv0, fv1) => [uc - a * fu0, uc + a * fu1, vc - a * fv0, vc + a * fv1];
          const ring = [lob(1.25, 1.1, 0.75, 0.9), lob(0.8, 0.95, 1.2, 1.05)];
          const core = [lob(1.0, 0.75, 0.5, 0.6), lob(0.5, 0.6, 0.95, 0.8), lob(0.25, 0.95, 0.3, 0.45)].map((q) => q.map((x, i) => x + (rr() - 0.5) * 0.12 * a));
          if (!ring.concat(core).every((q) => onRoof(q[0], q[1], q[2], q[3]) && onTops(q[0], q[1], q[2], q[3]))) continue;
          for (const q of ring) plate(q[0], q[1], 0.005, q[2], q[3], P_CHAR);
          for (const q of core) plate(q[0], q[1], 0.01, q[2], q[3], P_HOLE);
          const alongU = rr() < 0.5, nR = 2 + (rr() < 0.5 ? 1 : 0);
          for (let r = 0; r < nR; r++) {
            const off = (r - (nR - 1) / 2) * (0.45 + rr() * 0.2) * a, len0 = a * (0.9 + rr() * 0.4), len1 = a * (0.7 + rr() * 0.5), w = 0.1;
            const q = alongU ? [uc - len0, uc + len1, vc + off - w / 2, vc + off + w / 2] : [uc + off - w / 2, uc + off + w / 2, vc - len0, vc + len1];
            if (onRoof(q[0], q[1], q[2], q[3])) plate(q[0], q[1], 0.015, q[2], q[3], P_RAFT);
          }
        }
      }
      // (K1 re-run) THE WRECKAGE CASTS NO SHADOW: a ruin district's mesh is drawn twice whenever it casts (the main pass and the sun's depth pass, the whole merged
      // mesh once its sphere meets the shadow box), and the dressing above is ~375 triangles a house - perf_district Isla Viva s1234's endgame view over the crater
      // read x1.271 of the live build's triangles (x1.191 without the dressing; bar x1.25). meshData(..., { ns: true }) keys these faces "<mat>#ns" and maps.js
      // draws them in the district's no-shadow twin mesh (same material and program, receives shadow). Drawing and colliders are unchanged; 'deco' tufts are furniture.
      for (let q = nbRuin; q < boxes.length; q++) if (boxes[q].p !== "deco") boxes[q].ns = 1;
    }
  }

  // ---- INTERIOR DRESSING (round 3, lane H6): skins (<= 1.5 cm, drawn only, flat on one collider face) that make a room read finished for 2 triangles
  // each - a skirting board round every wall run, ceiling lights (a lit panel on the slab's underside: the "lamp" material), curtains beside the
  // windows of the lived-in rooms
  {
    const LIVED = new Set(["living", "bedroom", "kitchen", "office", "lobby", "meeting"]);
    const P_LAMP = pal("lamp", 0xfff2d6), P_LAMPW = pal("lamp", 0xf4f8ff);
    const skirtC = { plank_in: 0x5e4430, plaster: 0xf2efe6 };
    for (const F of floors) {
      const f = F.f, sf = s[f], ceil = s[f + 1] - SLAB;
      F.regs.forEach((r, ri) => {
        const kind = r.kind, rc = roomCol.get(r), wallMat = palette[rc.wall].mat;
        const P_SK = pal("wood", kind === "storage" || kind === "warehouse" || kind === "ruin" || kind === "barn" ? 0x6a6a66 : skirtC[wallMat] || 0xf2efe6);
        // skirting: this room's wall runs (solid or window edges), merged per line, short of each end by a jamb (corners, door jambs)
        const segs = [];
        for (const c of r.cells) {
          const i = c % nx, j = (c - i) / nx;
          const eB = F.eH[j * nx + i], eF = F.eH[(j + 1) * nx + i], eL = F.eV[i * nz + j], eR = F.eV[(i + 1) * nz + j];
          if (eB === 1 || eB === 3) segs.push(["u", vL(j), 1, uL(i), uL(i + 1)]);
          if (eF === 1 || eF === 3) segs.push(["u", vL(j + 1), -1, uL(i), uL(i + 1)]);
          if (eL === 1 || eL === 3) segs.push(["v", uL(i), 1, vL(j), vL(j + 1)]);
          if (eR === 1 || eR === 3) segs.push(["v", uL(i + 1), -1, vL(j), vL(j + 1)]);
        }
        segs.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]);
        const runs = [];
        for (const g of segs) { const L = runs[runs.length - 1]; if (L && L[0] === g[0] && L[1] === g[1] && L[2] === g[2] && Math.abs(L[4] - g[3]) < 1e-6) L[4] = g[4]; else runs.push(g.slice()); }
        for (const [ax, line, sg, t0, t1] of runs) if (t1 - t0 > 2 * JAMB + 0.1) skinOn(ax, line, sg, t0 + JAMB, t1 - JAMB, sf, sf + 0.1, P_SK, f);
        // ceiling lights: one per ~3 cells (<= 4), spread by farthest-point picking from the cell nearest the room's middle
        const n = clamp(Math.round(r.cells.length / 3), 1, 4), cs = r.cells.map((c) => [uL(c % nx) + U / 2, vL((c - (c % nx)) / nx) + U / 2]);
        const mu = cs.reduce((a, q) => a + q[0], 0) / cs.length, mv = cs.reduce((a, q) => a + q[1], 0) / cs.length;
        const pickL = [cs.slice().sort((a, b) => ((a[0] - mu) ** 2 + (a[1] - mv) ** 2) - ((b[0] - mu) ** 2 + (b[1] - mv) ** 2) || a[0] - b[0] || a[1] - b[1])[0]];
        while (pickL.length < n) {
          let best = null, bd = -1;
          for (const q of cs) { let d = Infinity; for (const p0 of pickL) d = Math.min(d, (q[0] - p0[0]) ** 2 + (q[1] - p0[1]) ** 2); if (d > bd + 1e-9) { bd = d; best = q; } }
          if (!best || bd < 1e-6) break;
          pickL.push(best);
        }
        const strip = kind === "office" || kind === "shop" || kind === "storage" || kind === "warehouse" || kind === "lobby" || kind === "meeting" || kind === "barn";
        for (const [u, v] of pickL) {
          const hw = strip ? 0.6 : 0.28, hd = strip ? 0.12 : 0.28, pl = strip ? P_LAMPW : P_LAMP, fc = [pl, pl, pl, pl, pl, pl];
          const li = addBox("skin", u - hw, u + hw, ceil - SKIN, ceil, v - hd, v + hd, fc, 0, f);
          if (li >= 0) boxes[li].hp = 63 & ~8;                // (it hangs under the slab: only its underside is drawn)
        }
        // curtains beside the windows of the lived-in rooms (on the piers' inner faces)
        if (LIVED.has(kind)) {
          const P_CUR = pal("fabric", pick(rng, [0x8a3b3b, 0x3b5a8a, 0xd8c8a0, 0x6a8a5a, 0xb07a3a, 0xe8e2d6]));
          for (const w of winGeo) {
            if (w.f !== f || F.region[w.cell] !== ri) continue;
            const nIn = -(w.along === "u" ? w.nv : w.nu);
            skinOn(w.along, w.line, nIn, w.o0 - 0.4, w.o0 - 0.05, sf + 1.0, sf + HEAD + 0.1, P_CUR, f);
            skinOn(w.along, w.line, nIn, w.o1 + 0.05, w.o1 + 0.4, sf + 1.0, sf + HEAD + 0.1, P_CUR, f);
          }
        }
      });
    }
  }

  // ---- the capsule walk (local frame): ring + floors on a 0.25 m grid, stairs as links
  const NU = Math.round((W + 2 * RING) / GRID), NV = Math.round((D + 2 * RING) / GRID);
  const su = (a) => -W / 2 - RING + (a + 0.5) * GRID, sv = (b) => -D / 2 - RING + (b + 0.5) * GRID;
  const cellOfS = (a, b) => { const i = Math.floor((su(a) + W / 2) / U), j = Math.floor((sv(b) + D / 2) / U); return i >= 0 && j >= 0 && i < nx && j < nz && inFoot(i, j) ? cIdx(i, j) : -1; };
  const pieceBoxes = (p) => {                             // local collider boxes of a placed piece: [u0, u1, y0, y1, v0, v1]
    if (p.cat.deco) return [];
    const yb = s[p.f] + (p.y0 || 0);
    // (round 3: a piece over 0.2 m - a coffee table, an ottoman, a carton - blocks the walk like a tall one: the capsule could step onto it, but
    // the game's NavGrid does not route bots across furniture tops, and a layout that is only open over a coffee table strands them; a 0.14 m
    // pallet is still walked over)
    const hb = p.cat.h > 0.2 && !p.y0 ? Math.max(p.cat.h, CAPSULE.step + 0.05) : p.cat.h;
    return [[p.rect[0], p.rect[2], yb, yb + hb, p.rect[1], p.rect[3]]];
  };
  const NS = NU * NV;
  const sCell = new Int32Array(NS);
  (() => {
    const colI = new Int32Array(NU), footC = new Int8Array(nx * nz);
    for (let a = 0; a < NU; a++) colI[a] = Math.floor((su(a) + W / 2) / U);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) footC[j * nx + i] = inFoot(i, j) ? 1 : 0;
    for (let b = 0; b < NV; b++) {
      const j = Math.floor((sv(b) + D / 2) / U), o = b * NU;
      if (j < 0 || j >= nz) { sCell.fill(-1, o, o + NU); continue; }
      for (let a = 0; a < NU; a++) { const i = colI[a]; sCell[o + a] = i >= 0 && i < nx && footC[j * nx + i] ? j * nx + i : -1; }
    }
  })();
  const SXA = new Float64Array(NU), SZA = new Float64Array(NV);
  for (let a = 0; a < NU; a++) SXA[a] = su(a);
  for (let b = 0; b < NV; b++) SZA[b] = sv(b);
  const blockInto = (fr, sfl, u0, u1, yA, yB, v0, v1, stampV) => {
    const val = stampV || 0;
    if (!(yB > sfl + CAPSULE.step && yA < sfl + CAPSULE.h)) return;
    const r = CAPSULE.r + WALK_MARGIN, r2 = r * r;
    const a0 = Math.max(0, Math.floor((u0 - r + W / 2 + RING) / GRID - 0.5)), a1 = Math.min(NU - 1, Math.ceil((u1 + r + W / 2 + RING) / GRID - 0.5));
    const b0 = Math.max(0, Math.floor((v0 - r + D / 2 + RING) / GRID - 0.5)), b1 = Math.min(NV - 1, Math.ceil((v1 + r + D / 2 + RING) / GRID - 0.5));
    for (let b = b0; b <= b1; b++) {
      const z = SZA[b], ez = z < v0 ? v0 - z : z > v1 ? z - v1 : 0;
      if (ez >= r) continue;
      const ez2 = ez * ez, o = b * NU;
      for (let a = a0; a <= a1; a++) {
        const x = SXA[a], ex = x < u0 ? u0 - x : x > u1 ? x - u1 : 0;
        if (ex * ex + ez2 < r2) fr[o + a] = val;
      }
    }
  };
  // the structure never changes during the walk loop: its free mask per floor is computed once
  const structFree = [], regS = [];
  (() => {                                                   // (a separate function: generate itself is too big for the optimizing compiler, its own loops run unoptimized)
  for (let f = 0; f < S; f++) {
    const F = floors[f], fr = new Uint8Array(NS), out = f === 0 ? 1 : 0, typ = F.type, rg = new Int16Array(NS), rc = new Int16Array(nx * nz);
    for (let c = 0; c < nx * nz; c++) rc[c] = typ[c] === 1 ? F.region[c] : -1;
    for (let k = 0; k < NS; k++) { const c = sCell[k]; if (c < 0) { fr[k] = out; rg[k] = -1; } else { fr[k] = typ[c] === 1 ? 1 : 0; rg[k] = rc[c]; } }
    regS.push(rg);                                        // (the room - region - of every walk sample of this floor: the furnisher's)
    for (const bx of boxes) if (bx.c) blockInto(fr, s[f], bx.u0, bx.u1, bx.y0, bx.y1, bx.v0, bx.v1);
    for (const bx of leafBoxes) blockInto(fr, s[f], bx.u0, bx.u1, bx.y0, bx.y1, bx.v0, bx.v1);     // (Wave 9: the open door leaves, the start state)
    structFree.push(fr);
  }
  })();

  const roomVis = new Int32Array(NS), roomBlk = new Int32Array(NS), roomStamp = { n: 0, m: 0, b: 0 };
  const structSolids = [];
  for (const bx of boxes) if (bx.c) structSolids.push([bx.u0, bx.u1, bx.y0, bx.y1, bx.v0, bx.v1]);
  for (const bx of leafBoxes) structSolids.push([bx.u0, bx.u1, bx.y0, bx.y1, bx.v0, bx.v1]);
  // ---- furniture
  const furn = [];                                        // { cat, room, f, u, v (centre), fq (local facing turn), rect [u0, v0, u1, v1], parts [box idx], tint, order }
  const tris = new Array(S + 1).fill(0);                  // [storey 0 .. S - 1, the closed shell storeys of a tall building]
  // ---- hidden faces: a structure box face that another structure box covers completely (the slab edge inside a wall, a wall's end in the
  // corner square, the fill under a stair inside its steps, every bottom face below the pad) is never drawn. A face is only culled when ONE box
  // covers all of it from the outside (>= 1 cm deep), so no gap can open. Bit k of b.h = local face k ([+u -u +y -y +v -v]) is hidden.
  {
    const BK = 2.5, bucket = new Map();
    const bkey = (i, j) => i * 100003 + j;
    boxes.forEach((b, bi) => {
      if (b.p === "skin" || b.p === "glass" || b.nc) return;      // (dressing never hides a face: not in the buckets; nc: a ruin's weed tufts, K1)
      for (let i = Math.floor(b.u0 / BK); i <= Math.floor(b.u1 / BK); i++) for (let j = Math.floor(b.v0 / BK); j <= Math.floor(b.v1 / BK); j++) {
        const k = bkey(i, j); let l = bucket.get(k); if (!l) { l = []; bucket.set(k, l); } l.push(bi);
      }
    });
    const E = 1e-4, DEEP = 0.01;
    const covers = (bi, lo, hi) => {                       // is the region lo..hi ([u, y, v]) inside a box other than bi? (such a box holds its centre: one bucket)
      const l = bucket.get(bkey(Math.floor((lo[0] + hi[0]) / 2 / BK), Math.floor((lo[2] + hi[2]) / 2 / BK)));
      if (!l) return false;
      for (const oi of l) {
        if (oi === bi) continue;
        const o = boxes[oi];
        if (o.p === "skin" || o.p === "glass") continue;      // dressing never hides a face (a pane is see-through, a skin is not a wall)
        if (o.u0 <= lo[0] + E && o.u1 >= hi[0] - E && o.y0 <= lo[1] + E && o.y1 >= hi[1] - E && o.v0 <= lo[2] + E && o.v1 >= hi[2] - E) return true;
      }
      return false;
    };
    boxes.forEach((b, bi) => {
      let h = 0;
      if (b.p === "gable") { b.h = 63; return; }          // an attic layer: a collider inside the plank + end-wall polygons that draw it (never drawn itself)
      if (b.hp != null) { b.h = b.hp; return; }           // a plate whose wall side is known where it was made (the selftest's flatOn proves the wall is there)
      if (b.p === "skin") {                                // a skin is a PLATE (below): only which thin face lies on the wall matters
        if (b.y1 - b.y0 <= 0.0151) b.h = covers(bi, [b.u0, b.y1, b.v0], [b.u1, b.y1 + DEEP, b.v1]) ? 63 & ~8 : covers(bi, [b.u0, b.y0 - DEEP, b.v0], [b.u1, b.y0, b.v1]) ? 63 & ~4 : 0;    // a ceiling light
        else if (b.u1 - b.u0 <= 0.0151) b.h = covers(bi, [b.u0 - DEEP, b.y0, b.v0], [b.u0, b.y1, b.v1]) ? 63 & ~1 : covers(bi, [b.u1, b.y0, b.v0], [b.u1 + DEEP, b.y1, b.v1]) ? 63 & ~2 : 0;
        else b.h = covers(bi, [b.u0, b.y0, b.v0 - DEEP], [b.u1, b.y1, b.v0]) ? 63 & ~16 : covers(bi, [b.u0, b.y0, b.v1], [b.u1, b.y1, b.v1 + DEEP]) ? 63 & ~32 : 0;
        return;
      }
      if (covers(bi, [b.u1, b.y0, b.v0], [b.u1 + DEEP, b.y1, b.v1])) h |= 1;
      if (covers(bi, [b.u0 - DEEP, b.y0, b.v0], [b.u0, b.y1, b.v1])) h |= 2;
      if (covers(bi, [b.u0, b.y1, b.v0], [b.u1, b.y1 + DEEP, b.v1])) h |= 4;
      if (b.y0 <= y0 + E || covers(bi, [b.u0, b.y0 - DEEP, b.v0], [b.u1, b.y0, b.v1])) h |= 8;
      if (covers(bi, [b.u0, b.y0, b.v1], [b.u1, b.y1, b.v1 + DEEP])) h |= 16;
      if (covers(bi, [b.u0, b.y0, b.v0 - DEEP], [b.u1, b.y1, b.v0])) h |= 32;
      // (a skin, <= 1.5 cm trim / shutter / blind window, is a PLATE: only its outward face is drawn - its back lies on the wall; its 1.5 cm edges
      // are not worth two triangles each: nothing can be seen through a 1.5 cm edge but the wall it lies on)
      b.h = h;
    });
  }
  const faceTris = (h) => { let n = 12; for (let k = 0; k < 6; k++) if (h & (1 << k)) n -= 2; return n; };
  for (const b of boxes) tris[b.fl] += faceTris(b.h);
  for (const L of leafL) tris[L.f] += LEAF_TRIS;           // (Wave 9: the builder draws each door leaf: inside the storey's budget like the structure)
  tris[S - 1] += roofTrisN;
  const keepOuts = [];                                    // per floor: rects furniture may not overlap
  for (let f = 0; f < S; f++) keepOuts.push(leafRects[f].map((r) => ({ r: [r[0] - 0.05, r[1] - 0.05, r[2] + 0.05, r[3] + 0.05], why: "leaf" })));
  const leafSide = new Map();                             // (Wave 9) a leafed door -> its swing side: that side's door zone is DOOR_ZONE_LEAF deep (it covers both swing discs)
  for (const L of leafL) leafSide.set(L.d, L.side);
  for (const d of doors) {
    const g = doorGeo(d), Z = JAMB + DOOR_ZONE, sw = leafSide.get(d) || 0, Zs = JAMB + DOOR_ZONE_LEAF;
    const lo = g.line - (sw < 0 ? Zs : Z), hi = g.line + (sw > 0 ? Zs : Z);
    const r = g.along === "u" ? [g.o0 - 0.1, lo, g.o1 + 0.1, hi] : [lo, g.o0 - 0.1, hi, g.o1 + 0.1];
    keepOuts[d.floor].push({ r, why: "door" });
  }
  const cellRect = (i, j) => [uL(i), vL(j), uL(i + 1), vL(j + 1)];
  for (const sr of stairRecs) {
    const { sp, st } = sr;
    for (const k of [st.k, st.k + 1, st.k + 2]) { const [i, j] = stripCell(sp, k); keepOuts[sr.f].push({ r: cellRect(i, j), why: "stair" }); }
    for (const k of [st.k - 1, st.k, st.k + 1]) { const [i, j] = stripCell(sp, k); keepOuts[sr.f + 1].push({ r: cellRect(i, j), why: "stair" }); }
  }
  const winZones = [];
  for (let f = 0; f < S; f++) winZones.push([]);
  for (const w of winGeo) {
    const Z = JAMB + 1.25;                                // (1.25 m: the check's shot lanes run 1.2 m inside the window at the standing eye)
    winZones[w.f].push(w.along === "u" ? [w.o0 - 0.1, w.line - Z, w.o1 + 0.1, w.line + Z] : [w.line - Z, w.o0 - 0.1, w.line + Z, w.o1 + 0.1]);
  }
  const ovl = (a, b, g) => a[0] < b[2] - g && b[0] < a[2] - g && a[1] < b[3] - g && b[1] < a[3] - g;
  const chests = [];

  // ======== THE FURNISHER ========
  // READ FROM THE DOOR. A room is judged (by a player, and by interiorcheck) from where it is entered: a doorway on its outline (eye 0.6 m inside
  // the wall face, 1.62 m up, looking in) or the top of a stair that lands in it (looking at the room's middle). Every room keeps a view model of
  // those entrances: a candidate piece counts as SEEN from an entrance when >= 2 of its 10 sample points (centre, top, 8 corners at 40 %) lie in
  // an 80 x 52 degree view and the ray to them meets no drawn structure (walls, slabs, steps, leaves; glass is seen through) - a stricter copy of
  // interiorcheck's furniture-in-view (88 x 57 degrees, one point). Pieces go where the entrant sees them first; a last phase adds cheap pieces in
  // view until every room shows >= VIEW_WANT pieces from its best entrance (or nothing fits: the floor plan, the doors, the budget).
  const TAN_H = 0.9004, TAN_V = 0.5206, EYE_H = 1.62, VIEW_WANT = 4;      // (round 3: 42 x 27.5 deg half-angles, inside interiorcheck's 44 x 28.5; round 2 used 40 x 26)
  // the third-person camera's view (player.js: vertical 57 deg, 16:9 -> 88 deg across; judged a little inside: 84 x 54) and its boom
  const TAN_H3 = 0.9004, TAN_V3 = 0.5095, CAM3 = { dist: 4.2, shoulder: 0.7, lift: 0.25, r: 0.28, minD: 0.12 };
  // camRayHit (player.js) over the structure colliders: the first t in (0, 1] at which the boom o + t d enters a box grown by r
  const camHit = (ox, oy, oz, dx, dy, dz, r) => {
    let best = 1;
    for (const q of structSolids) {
      let rr = r;
      for (let pass = 0; pass < 2; pass++) {
        let t0 = 0, t1 = best, miss = false;
        const slab = (o, d, lo, hi) => { if (miss) return; if (d > -1e-9 && d < 1e-9) { if (o < lo - rr || o > hi + rr) miss = true; return; } let a = (lo - rr - o) / d, b = (hi + rr - o) / d; if (a > b) { const tq = a; a = b; b = tq; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) miss = true; };
        slab(ox, dx, q[0], q[1]); slab(oy, dy, q[2], q[3]); slab(oz, dz, q[4], q[5]);
        if (miss) break;
        if (t0 > 0) { best = t0; break; }
        if (pass === 1) break;
        const ex = ox < q[0] ? q[0] - ox : ox > q[1] ? ox - q[1] : 0, ey2 = oy < q[2] ? q[2] - oy : oy > q[3] ? oy - q[3] : 0, ez = oz < q[4] ? q[4] - oz : oz > q[5] ? oz - q[5] : 0;
        const dd = Math.sqrt(ex * ex + ey2 * ey2 + ez * ez);
        if (dd <= 0.03) break;
        rr = dd - 0.015;
      }
    }
    return best;
  };
  // what a doorway's eye cannot see through: the walls, rails, stairs and door leaves (glass is seen through; a skin lies on a wall face; a ray
  // from 1.62 m to a piece of furniture never reaches the floor slab or the ceiling, so slabs and roofs are left out)
  const occluders = boxes.filter((b) => b.p !== "glass" && b.p !== "skin" && b.p !== "slab" && b.p !== "roof" && b.p !== "shell" && b.p !== "gable" && b.p !== "trim").concat(leafBoxes);
  // (stage B, lane I1: the same boolean, faster - a box wholly outside the segment's bounding box is skipped before the slab divisions, and the view model's
  //  extra lists (the room's tall pieces but the one tested, a body) are walked in place instead of being concatenated per call: no garbage)
  const segBlocked = (ax, ay, az, bx, by, bz, list, tMax, list2, skip, one) => {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const ex = ax + dx * tMax, ey = ay + dy * tMax, ez = az + dz * tMax;
    const x0 = ax < ex ? ax : ex, x1 = ax < ex ? ex : ax, y0 = ay < ey ? ay : ey, y1 = ay < ey ? ey : ay, z0 = az < ez ? az : ez, z1 = az < ez ? ez : az;
    if (segHit(ax, ay, az, dx, dy, dz, tMax, list, x0, x1, y0, y1, z0, z1, null)) return true;
    if (list2 && segHit(ax, ay, az, dx, dy, dz, tMax, list2, x0, x1, y0, y1, z0, z1, skip)) return true;
    if (one && segHit1(ax, ay, az, dx, dy, dz, tMax, one, x0, x1, y0, y1, z0, z1)) return true;
    return false;
  };
  const segHit = (ax, ay, az, dx, dy, dz, tMax, list, x0, x1, y0, y1, z0, z1, skip) => {
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      if (b.u1 <= x0 || b.u0 >= x1 || b.y1 <= y0 || b.y0 >= y1 || b.v1 <= z0 || b.v0 >= z1) continue;
      if (skip && b.u0 === skip[0] && b.v0 === skip[1] && b.u1 === skip[2] && b.v1 === skip[3]) continue;
      if (segHit1(ax, ay, az, dx, dy, dz, tMax, b, x0, x1, y0, y1, z0, z1)) return true;
    }
    return false;
  };
  const segHit1 = (ax, ay, az, dx, dy, dz, tMax, b) => {
    {
      let t0 = 0, t1 = tMax;
      if (Math.abs(dx) < 1e-12) { if (ax <= b.u0 || ax >= b.u1) return false; } else { let a = (b.u0 - ax) / dx, c = (b.u1 - ax) / dx; if (a > c) { const q = a; a = c; c = q; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 >= t1) return false; }
      if (Math.abs(dy) < 1e-12) { if (ay <= b.y0 || ay >= b.y1) return false; } else { let a = (b.y0 - ay) / dy, c = (b.y1 - ay) / dy; if (a > c) { const q = a; a = c; c = q; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 >= t1) return false; }
      if (Math.abs(dz) < 1e-12) { if (az <= b.v0 || az >= b.v1) return false; } else { let a = (b.v0 - az) / dz, c = (b.v1 - az) / dz; if (a > c) { const q = a; a = c; c = q; } if (a > t0) t0 = a; if (c < t1) t1 = c; if (t0 >= t1) return false; }
      return true;
    }
  };
  const roomView = (R) => {
    if (R._view) return R._view;
    const f = R.floor, F = floors[f], [bi0, bj0, bi1, bj1] = R.bounds;
    const inner = [uL(bi0) + JAMB, vL(bj0) + JAMB, uL(bi1) - JAMB, vL(bj1) - JAMB];
    const ents = [];
    for (const d of doors) {
      if (d.floor !== f || (d.a !== R.ri && d.b !== R.ri) || !onOutline(R.bounds, d.ori, d.i, d.j, F, R.ri)) continue;
      const g = doorGeo(d), plus = cellAt(d.i, d.j);
      const sg = plus >= 0 && F.type[plus] === 1 && F.region[plus] === R.ri ? 1 : -1, k = JAMB + 0.6;
      const k9 = JAMB + 0.9;                               // (the player reading the room from the doorway stands 0.9 m inside: interiorcheck's spot)
      ents.push({ door: d, u: g.u + g.nu * sg * k, v: g.v + g.nv * sg * k, fu: g.nu * sg, fv: g.nv * sg, pu: g.u + g.nu * sg * k9, pv: g.v + g.nv * sg * k9 });
    }
    for (const sr of stairRecs) {
      if (sr.f + 1 !== f) continue;
      const cm = (sr.across0 + sr.across1) / 2, col = sr.sp.axis === "col";
      const tu = col ? cm : sr.top - 0.6, tv = col ? sr.top - 0.6 : cm;
      if (!(tu > inner[0] - 0.3 && tu < inner[2] + 0.3 && tv > inner[1] - 0.3 && tv < inner[3] + 0.3)) continue;
      let fu = (inner[0] + inner[2]) / 2 - tu, fv = (inner[1] + inner[3]) / 2 - tv;
      const l = Math.sqrt(fu * fu + fv * fv);
      if (l < 0.5) { fu = col ? 0 : -1; fv = col ? -1 : 0; } else { fu /= l; fv /= l; }
      ents.push({ stair: sr, u: tu, v: tv, fu, fv, pu: tu, pv: tv });
    }
    const yb = s[f], yt = s[f + 1];
    const occ = occluders.filter((b) => b.u1 > inner[0] - 0.3 && b.u0 < inner[2] + 0.3 && b.v1 > inner[1] - 0.3 && b.v0 < inner[3] + 0.3 && b.y1 > yb - 0.05 && b.y0 < yt);
    // THE GAME'S CAMERA (round 3): the player is seen from behind - the boom 4.2 m back along the view, 0.7 m right, 0.25 m up, pulled in where a
    // collider box is in the way (player.js camRayHit: lens 0.28 m, never closer than 0.12 m); the body (0.5 m wide, 1.8 m) stands in the way.
    // A room reads from an entrance only when its pieces show from BOTH that camera and the first-person eye (interiorcheck's Node judge).
    for (const e of ents) {
      const ty = yb + EYE_H, ru = -e.fv, rv = e.fu;
      const dx = -e.fu * CAM3.dist + ru * CAM3.shoulder, dy = CAM3.lift, dz = -e.fv * CAM3.dist + rv * CAM3.shoulder, len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const t = camHit(e.pu, ty, e.pv, dx, dy, dz, CAM3.r);
      const fk = t < 1 ? Math.max(CAM3.minD / len, t - 0.015) : 1;
      e.cu = e.pu + dx * fk; e.cy = ty + dy * fk; e.cv = e.pv + dz * fk;
      e.body = { u0: e.pu - 0.25, u1: e.pu + 0.25, y0: yb, y1: yb + 1.8, v0: e.pv - 0.25, v1: e.pv + 0.25 };
    }
    let o0 = inner[0], o1 = inner[1], o2 = inner[2], o3 = inner[3];
    for (const e of ents) { o0 = Math.min(o0, e.cu); o1 = Math.min(o1, e.cv); o2 = Math.max(o2, e.cu); o3 = Math.max(o3, e.cv); }
    const occ3 = occluders.filter((b) => b.u1 > o0 - 0.3 && b.u0 < o2 + 0.3 && b.v1 > o1 - 0.3 && b.v0 < o3 + 0.3 && b.y1 > yb - 0.05 && b.y0 < yt + 0.5);
    for (const e of ents) e.occ3 = occ3.concat([e.body]);
    let prim = 0;
    if (R.reg.entry) { const i = ents.findIndex((e) => e.door === R.reg.entry); if (i >= 0) prim = i; }
    R._view = { ents, prim, occ, occ3, inner };
    return R._view;
  };
  const visMask = (R, rect, yA, yB, occ, only) => {      // (only: a mask of the entrances to test; default all)              // bit e = entrance e sees the box rect x [yA, yB] (absolute heights)
    if (yB - yA < 0.25) return 0;
    const V = roomView(R), ey = s[R.floor] + EYE_H;
    // (from phase 3 on, the room's TALL pieces - racks, wardrobes, crate stacks - hide what stands behind them, as they do on screen)
    const acc = !!R._acc;
    let tall = null;                                     // (the room's tall pieces, never the piece itself: segBlocked skips the box equal to `rect`)
    if (acc) {
      if (!R._tall) R._tall = (R._ps || []).filter((q) => !q.cat.deco && !q.slot && (q.y0 || 0) + q.cat.h >= 1.0).map((q) => ({ u0: q.rect[0], u1: q.rect[2], y0: s[q.f] + (q.y0 || 0), y1: s[q.f] + (q.y0 || 0) + q.cat.h, v0: q.rect[1], v1: q.rect[3] }));
      if (R._tall.length) tall = R._tall;
    }
    const occX = occ || null;
    occ = occ || V.occ;
    const cu = (rect[0] + rect[2]) / 2, cv = (rect[1] + rect[3]) / 2, cy = (yA + yB) / 2, hu = (rect[2] - rect[0]) * 0.4, hv = (rect[3] - rect[1]) * 0.4, hy = (yB - yA) * 0.4;
    // the 10 sample points (the middle, the top middle, the 8 corners at 0.4 of the box), in a reused buffer (no garbage per call)
    const P = VIS_PTS;
    P[0] = cu; P[1] = cy; P[2] = cv; P[3] = cu; P[4] = yB - 0.01; P[5] = cv;
    let q = 6;
    for (let a = -1; a <= 1; a += 2) for (let b = -1; b <= 1; b += 2) for (let c = -1; c <= 1; c += 2) { P[q++] = cu + a * hu; P[q++] = cy + b * hy; P[q++] = cv + c * hv; }
    let m = 0;
    for (let ei = 0; ei < V.ents.length && ei < 30; ei++) {
      if (only && !(only & (1 << ei))) continue;
      const e = V.ents[ei];
      const o3 = acc ? (occX || e.occ3) : null, one = acc && occX ? e.body : null;
      let n = 0;
      for (let pi = 0; pi < 30; pi += 3) {
        const p0 = P[pi], p1 = P[pi + 1], p2 = P[pi + 2];
        const du = p0 - e.u, dv = p2 - e.v, dy = p1 - ey;
        const fwd = du * e.fu + dv * e.fv;
        if (fwd <= 0.05) continue;
        const lat = -du * e.fv + dv * e.fu;
        if (Math.abs(lat) > fwd * TAN_H) continue;
        const hz = Math.sqrt(fwd * fwd + lat * lat);
        if (Math.abs(dy) > hz * TAN_V) continue;
        const dist = Math.sqrt(hz * hz + dy * dy);
        if (dist < 0.2 || dist > 30) continue;
        if (segBlocked(e.u, ey, e.v, p0, p1, p2, occ, 1 - 0.02 / dist, tall, rect, null)) continue;
        // (the accurate model) and from the third-person camera - through the doorway, past the body
        if (acc) { const du3 = p0 - e.cu, dv3 = p2 - e.cv, dy3 = p1 - e.cy, fwd3 = du3 * e.fu + dv3 * e.fv;
          if (fwd3 <= 0.3) continue;
          const lat3 = -du3 * e.fv + dv3 * e.fu;
          if (Math.abs(lat3) > fwd3 * TAN_H3) continue;
          const hz3 = Math.sqrt(fwd3 * fwd3 + lat3 * lat3);
          if (Math.abs(dy3) > hz3 * TAN_V3) continue;
          const dist3 = Math.sqrt(hz3 * hz3 + dy3 * dy3);
          if (dist3 > 30 || segBlocked(e.cu, e.cy, e.cv, p0, p1, p2, o3, 1 - 0.02 / dist3, tall, rect, one)) continue; }
        if (++n >= 2) break;
      }
      if (n >= 2) m |= 1 << ei;
    }
    return m;
  };
  const counted = (p) => !p.slot && !p.cat.deco && p.cat.h >= 0.25;
  // pieces of OTHER rooms a doorway sees (through the opening across the room, or the next room's door): counted once, when the room's own
  // pieces fall short (phase 3), against every structure box of the storey
  const extCounts = (R) => {
    if (R._ext) return R._ext;
    const V = roomView(R), f = R.floor, n = new Array(V.ents.length).fill(0);
    if (V.ents.length) {
      const occAll = occluders.filter((b) => b.y1 > s[f] - 0.05 && b.y0 < s[f + 1]);
      for (const p of furn) {
        if (p.room === R || p.f !== f || !counted(p)) continue;
        const m = visMask(R, p.rect, s[f] + (p.y0 || 0), s[f] + (p.y0 || 0) + p.cat.h, occAll);
        for (let ei = 0; ei < n.length; ei++) if (m & (1 << ei)) n[ei]++;
      }
    }
    R._ext = n;
    return n;
  };
  const visOf = (p) => { if (p.vis == null) p.vis = counted(p) ? visMask(p.room, p.rect, s[p.f] + (p.y0 || 0), s[p.f] + (p.y0 || 0) + p.cat.h, null, p.room._acc ? p.room._accMask : 0) : 0; return p.vis; };
  const viewCounts = (R) => {                               // pieces seen from each entrance of R (its own, + the other rooms' once measured)
    const V = roomView(R), n = R._ext ? R._ext.slice() : new Array(V.ents.length).fill(0);
    for (const p of R._ps || []) if (counted(p)) { const m = visOf(p); for (let ei = 0; ei < n.length; ei++) if (m & (1 << ei)) n[ei]++; }
    return n;
  };
  const bestView = (R) => { const n = viewCounts(R); let b = -1, bi = -1; n.forEach((x, i) => { if (x > b || (x === b && i === roomView(R).prim)) { b = x; bi = i; } }); return { n: Math.max(0, b), ei: bi }; };

  const roomStatic = (R) => {                             // a room's geometry for the furnisher (once: it does not change while it is furnished)
    if (R._st) return R._st;
    const F = floors[R.floor], f = R.floor;
    const [bi0, bj0, bi1, bj1] = R.bounds;
    const inner = [uL(bi0) + JAMB, vL(bj0) + JAMB, uL(bi1) - JAMB, vL(bj1) - JAMB];
    const holes = [];                                     // cells of the bounding rect that are not this room's
    const mine = new Set(R.reg.cells);
    for (let j = bj0; j < bj1; j++) for (let i = bi0; i < bi1; i++) if (!mine.has(cIdx(i, j))) { const cr = cellRect(i, j); holes.push([cr[0] - JAMB, cr[1] - JAMB, cr[2] + JAMB, cr[3] + JAMB]); }
    // wall runs of this room: [axis, line, sigma (inward), t0, t1]
    const runs = [];
    const addRunSeg = (axis, line, sg, t0, t1) => runs.push({ axis, line, sg, t0, t1 });
    for (const c of R.reg.cells) {
      const i = c % nx, j = Math.floor(c / nx);
      const eB = F.eH[j * nx + i], eF = F.eH[(j + 1) * nx + i], eLt = F.eV[i * nz + j], eR = F.eV[(i + 1) * nz + j];
      if (eB === 1 || eB === 3) addRunSeg("u", vL(j), 1, uL(i), uL(i + 1));
      if (eF === 1 || eF === 3) addRunSeg("u", vL(j + 1), -1, uL(i), uL(i + 1));
      if (eLt === 1 || eLt === 3) addRunSeg("v", uL(i), 1, vL(j), vL(j + 1));
      if (eR === 1 || eR === 3) addRunSeg("v", uL(i + 1), -1, vL(j), vL(j + 1));
    }
    runs.sort((a, b) => (a.axis < b.axis ? -1 : a.axis > b.axis ? 1 : 0) || a.line - b.line || a.sg - b.sg || a.t0 - b.t0);
    const merged = [];
    for (const rn of runs) {
      const last = merged[merged.length - 1];
      if (last && last.axis === rn.axis && last.line === rn.line && last.sg === rn.sg && Math.abs(last.t1 - rn.t0) < 1e-6) last.t1 = rn.t1;
      else merged.push(Object.assign({}, rn));
    }
    // solid wall stretches only (no window, no door): where a picture can hang
    const solidRuns = [];
    for (const c of R.reg.cells) {
      const i = c % nx, j = Math.floor(c / nx);
      if (F.eH[j * nx + i] === 1) solidRuns.push({ axis: "u", line: vL(j), sg: 1, t0: uL(i), t1: uL(i + 1) });
      if (F.eH[(j + 1) * nx + i] === 1) solidRuns.push({ axis: "u", line: vL(j + 1), sg: -1, t0: uL(i), t1: uL(i + 1) });
      if (F.eV[i * nz + j] === 1) solidRuns.push({ axis: "v", line: uL(i), sg: 1, t0: vL(j), t1: vL(j + 1) });
      if (F.eV[(i + 1) * nz + j] === 1) solidRuns.push({ axis: "v", line: uL(i + 1), sg: -1, t0: vL(j), t1: vL(j + 1) });
    }
    const near = (z) => z[0] < inner[2] + 0.5 && z[2] > inner[0] - 0.5 && z[1] < inner[3] + 0.5 && z[3] > inner[1] - 0.5;
    R._st = { inner, holes, merged, solidRuns, keep: keepOuts[f].filter((k) => near(k.r)), wins: winZones[f].filter(near) };
    return R._st;
  };
  // per floor: the room (region) each walk sample lies in (-1: none); per room, once: its samples, its PORTS (each doorway's inner side, the stair
  // approach / exit inside it: they must stay joined through its free floor, for a fat capsule) and the room samples near each port

  const regK = [];
  const roomWalk = (R) => {
    if (R._rw) return R._rw;
    const f = R.floor, Fr = floors[f], regF = regS[f];
    if (!regK[f]) { const m = new Map(); for (let k = 0; k < NS; k++) { const r = regF[k]; if (r < 0) continue; let l = m.get(r); if (!l) { l = []; m.set(r, l); } l.push(k); } regK[f] = m; }
    const mineK = regK[f].get(R.ri) || [];
    let wa0 = NU, wa1 = -1, wb0 = NV, wb1 = -1;
    for (const k of mineK) { const a = k % NU, b = (k - a) / NU; if (a < wa0) wa0 = a; if (a > wa1) wa1 = a; if (b < wb0) wb0 = b; if (b > wb1) wb1 = b; }
    const ports = [];
    for (const d of doors) {
      if (d.floor !== f || (d.a !== R.ri && d.b !== R.ri)) continue;
      const g = doorGeo(d);
      for (const sd of [-1, 1]) {
        const u = g.u + g.nu * sd * 0.6, v = g.v + g.nv * sd * 0.6;
        const i = Math.floor((u + W / 2) / U), j = Math.floor((v + D / 2) / U);
        if (i >= 0 && j >= 0 && i < nx && j < nz && Fr.region[cIdx(i, j)] === R.ri) ports.push([u, v]);
      }
    }
    for (const sr of stairRecs) {
      if (sr.f === f && Fr.region[cIdx(...sr.approach)] === R.ri) { const cr = cellRect(...sr.approach); ports.push([(cr[0] + cr[2]) / 2, (cr[1] + cr[3]) / 2]); }
      if (sr.f + 1 === f && Fr.region[cIdx(...sr.exit)] === R.ri) { const cr = cellRect(...sr.exit); ports.push([(cr[0] + cr[2]) / 2, (cr[1] + cr[3]) / 2]); }
    }
    const portWin = ports.map(([u, v]) => {               // the room samples within 0.7 m of each port, nearest first
      const out = [];
      const a0 = Math.max(0, Math.floor((u - 0.7 + W / 2 + RING) / GRID)), a1 = Math.min(NU - 1, Math.ceil((u + 0.7 + W / 2 + RING) / GRID));
      const b0 = Math.max(0, Math.floor((v - 0.7 + D / 2 + RING) / GRID)), b1 = Math.min(NV - 1, Math.ceil((v + 0.7 + D / 2 + RING) / GRID));
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) { const k = b * NU + a; if (regF[k] !== R.ri) continue; const dx = su(a) - u, dz = sv(b) - v, dd = dx * dx + dz * dz; if (dd < 0.49) out.push([dd, k]); }
      out.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
      return out.map((x) => x[1]);
    });
    R._rw = { mineK, portWin, wa0, wa1, wb0, wb1, roomQ: new Int32Array(Math.max(1, mineK.length)) };
    return R._rw;
  };
  const furnishRoom = (R, phase) => {
    const F = floors[R.floor], f = R.floor;
    const { inner, holes, merged, solidRuns, keep, wins } = roomStatic(R);
    const area = R.cells.length * U * U, iw = inner[2] - inner[0], idp = inner[3] - inner[1];
    const placed = R._ps || (R._ps = []);                 // the room's pieces (a live list: put / unput / the walk keep it)
    // a box rect x [ya, yb] (above this floor) is free: inside the room, out of door / stair / leaf zones, clear of every other piece it shares
    // heights with (4 cm apart; touching for a counter row), and nothing taller than the sill in front of a window
    const valid = (r, ya, yb, touch, host) => {
      if (r[0] < inner[0] - 1e-6 || r[1] < inner[1] - 1e-6 || r[2] > inner[2] + 1e-6 || r[3] > inner[3] + 1e-6) return false;
      for (const hr of holes) if (ovl(r, hr, 0)) return false;
      for (const k of keep) if (ovl(r, k.r, 1e-6)) return false;
      for (const p of placed) {                            // (a piece inside this room's walls can only meet this room's pieces)
        if (p.cat.deco || p === host) continue;
        const pa = p.y0 || 0, pb = pa + p.cat.h;
        if (pb <= ya + 1e-6 || pa >= yb - 1e-6) continue;
        if (ovl(r, p.rect, touch ? 0.001 : -0.04)) return false;
      }
      if (yb > SILL - 0.05) for (const z of wins) if (ovl(r, z, 1e-6)) return false;
      return true;
    };
    // the storey's budget, and (phases 0 and 1) this room's fair share of it: a big kitchen cannot starve the bedrooms; a kit piece over the share falls back
    // to its authored stand-in (catOf). Phases 2 and 3 top rooms up with what is left of the storey's budget.
    const budgetOK = (cat) => tris[f] + cat.tris <= TRI_BUDGET && (phase >= 2 || R.spent + cat.tris <= R.share);
    // the room's PORTS (each doorway's inner side, the stair approach / exit inside it) must stay joined through its free floor (the fat capsule):
    // checked after every piece, so a piece that closes a path is refused on the spot instead of being found by the whole-house walk
    const RW = roomWalk(R), { mineK, portWin, wa0, wa1, wb0, wb1, roomQ } = RW, regF = regS[f], myRi = R.ri, vis = roomVis;
    // (the room's free samples with the pieces it has kept are cached: a check blocks only the new pieces; a piece taken out rebuilds the cache)
    // (stage B, lane I1) NO FURNITURE STAIRCASE: the game's mover steps up <= 0.55 m without a jump, so a low piece of clutter (rubble, a carton, sacks, a hay
    // bale: lowest top 0.2 .. 0.55 m) within 0.9 m (a capsule's width) of a piece whose lowest top is one more step up (a table at 0.76, a crate at 0.9) is a
    // staircase a walker brushing the clutter climbs by accident (check_a3: a ruin hall's rubble -> table -> chair, the walker ended on the chair). Furniture
    // sets (a nightstand by a bed, a coffee table by a sofa, a toilet by a basin) stand against walls and keep their layout: only clutter is refused.
    const stairsOK = () => {
      for (const A of placed) {
        const ca = A.cat;
        if (ca.deco || (A.y0 || 0) > 0 || !STEP_CLUTTER.has(ca.auth || ca.id)) continue;
        const ta = ca.lowTop != null ? ca.lowTop : ca.h;
        if (ta <= 0.2 || ta > CAPSULE.step) continue;
        for (const B of placed) {
          if (B === A || B.cat.deco || (B.y0 || 0) > 0) continue;
          const tb = B.cat.lowTop != null ? B.cat.lowTop : B.cat.h;
          if (tb <= CAPSULE.step || tb - ta > CAPSULE.step) continue;
          const gx = Math.max(0, A.rect[0] - B.rect[2], B.rect[0] - A.rect[2]), gz = Math.max(0, A.rect[1] - B.rect[3], B.rect[1] - A.rect[3]);
          if (gx * gx + gz * gz < 0.81) return false;
        }
      }
      return true;
    };
    const roomOK = () => {
      if (!stairsOK()) return false;
      if (!RW.free || RW.stale) {                          // (stale: a piece of the cache was taken out - set where pieces leave a room; was a scan of the cache per call)
        RW.stale = false;
        RW.free = RW.free || new Uint8Array(NS); RW.inc = new Set();
        const sf0 = structFree[f];
        for (let b = wb0; b <= wb1; b++) { const o = b * NU; for (let a = wa0; a <= wa1; a++) RW.free[o + a] = sf0[o + a]; }
      }
      // the pieces not yet in the cache are stamped (not copied in): a sample is free when the cache says so and no new piece stamps it
      const pend = placed.filter((p) => !RW.inc.has(p)), st = ++roomStamp.b;
      for (const p of pend) for (const pb of pieceBoxes(p)) blockInto(roomBlk, s[f], pb[0], pb[1], pb[2], pb[3], pb[4], pb[5], st);
      const ok = roomOK0(RW.free, st);
      if (ok) for (const p of pend) { for (const pb of pieceBoxes(p)) blockInto(RW.free, s[f], pb[0], pb[1], pb[2], pb[3], pb[4], pb[5]); RW.inc.add(p); }
      return ok;
    };
    const roomOK0 = (fr, bst) => {
      const blk = roomBlk, pk = [];
      for (const list of portWin) { let best = -1; for (const k of list) if (fr[k] && blk[k] !== bst) { best = k; break; } if (best < 0) return false; if (!pk.includes(best)) pk.push(best); }
      if (!pk.length) return true;
      const stamp = ++roomStamp.n, np = pk.length;
      let qn = 0, n = 1, got = 1;
      vis[pk[0]] = stamp; roomQ[qn++] = pk[0];
      const go = (k) => { vis[k] = stamp; roomQ[qn++] = k; n++; if (np > 1) for (let q = 1; q < np; q++) if (pk[q] === k) got++; };
      while (qn) {
        if (got >= np && n >= 16) return true;             // every port joined (and room to stand in): done
        const k = roomQ[--qn];
        const a = k % NU;
        if (a > 0 && vis[k - 1] !== stamp && regF[k - 1] === myRi && fr[k - 1] && blk[k - 1] !== bst) go(k - 1);
        if (a < NU - 1 && vis[k + 1] !== stamp && regF[k + 1] === myRi && fr[k + 1] && blk[k + 1] !== bst) go(k + 1);
        if (k >= NU && vis[k - NU] !== stamp && regF[k - NU] === myRi && fr[k - NU] && blk[k - NU] !== bst) go(k - NU);
        if (k + NU < NS && vis[k + NU] !== stamp && regF[k + NU] === myRi && fr[k + NU] && blk[k + NU] !== bst) go(k + NU);
      }
      return got >= np && n >= 16;
    };
    const unput = (p) => { R._tall = null; if (RW.inc && RW.inc.has(p)) RW.stale = true; const i = furn.indexOf(p); if (i >= 0) furn.splice(i, 1); const j = placed.indexOf(p); if (j >= 0) placed.splice(j, 1); tris[f] -= p.cat.tris; R.spent -= p.cat.tris; if (p.host) p.host.tops = (p.host.tops || 1) - 1; };
    const put = (cat, u, v, fq, tint, extra) => {
      const w = fq % 2 ? cat.d : cat.w, d = fq % 2 ? cat.w : cat.d;
      const rect = [u - w / 2, v - d / 2, u + w / 2, v + d / 2];
      const p = Object.assign({ cat, room: R, f, u, v, fq, rect, tint: tint || 0, order: furn.length, y0: 0 }, extra || {});
      furn.push(p); placed.push(p); R.spent += cat.tris; R._tall = null;
      tris[f] += cat.tris;
      if (p.host) p.host.tops = (p.host.tops || 0) + 1;
      return p;
    };
    // a piece with its back to a wall run at along-position t
    const wallRect = (run, cat, t) => {
      const face = run.line + run.sg * JAMB;
      if (run.axis === "u") { const v0 = run.sg > 0 ? face : face - cat.d, v1 = run.sg > 0 ? face + cat.d : face; return { rect: [t - cat.w / 2, v0, t + cat.w / 2, v1], u: t, v: (v0 + v1) / 2, fq: run.sg > 0 ? 0 : 2 }; }
      const u0 = run.sg > 0 ? face : face - cat.d, u1 = run.sg > 0 ? face + cat.d : face; return { rect: [u0, t - cat.w / 2, u1, t + cat.w / 2], u: (u0 + u1) / 2, v: t, fq: run.sg > 0 ? 1 : 3 };
    };
    const runPositions = (run, wdt, pref) => {
      const lo = run.t0 + wdt / 2, hi = run.t1 - wdt / 2;
      if (hi < lo - 1e-6) return [];
      const out = [];
      const add = (t) => { if (t < lo - 1e-6 || t > hi + 1e-6) return; for (let q = 0; q < out.length; q++) if (Math.abs(out[q] - t) < 1e-3) return; out.push(t); };
      const lo2 = Math.max(lo, run.t0 + JAMB + wdt / 2), hi2 = Math.min(hi, run.t1 - JAMB - wdt / 2);
      if (pref === "corner") { add(lo2); add(hi2); add(lo); add(hi); }
      add((lo + hi) / 2);
      for (let t = lo; t <= hi + 1e-6; t += 0.5) add(Math.round(t * 1000) / 1000);
      if (pref === "center") out.sort((a, b) => Math.abs(a - (lo + hi) / 2) - Math.abs(b - (lo + hi) / 2) || a - b);
      return out;
    };
    // the catalog id -> the piece the budget allows: the kit piece, else its cheaper stand-in(s)
    const catOf = (id) => { let c = CATALOG[id] || CATALOG[ALIAS[id]]; while (c && !budgetOK(c) && c.alt) c = c.alt; return c; };
    // which entrance the room is dressed for: the one that already sees the most (ties: the door the room is reached through)
    const target = () => { const V = roomView(R); if (!V.ents.length) return 0; const b = bestView(R); return 1 << (b.ei >= 0 ? b.ei : V.prim); };
    // READ ON ENTRY: the room's entry is the door its spanning tree came through (the front door for the living room / shop, the stair exit upstairs);
    // the wall facing the entrant is furnished first, then the side walls, the entry wall last (a stable sort of the shuffled runs)
    let view = null;
    if (R.reg.entry) {
      const d = R.reg.entry, g = doorGeo(d);
      const plus = cellAt(d.i, d.j);
      const sgn = plus >= 0 && F.region[plus] === R.ri ? 1 : -1;
      view = [g.nu * sgn, g.nv * sgn];
    } else {
      for (const sr of stairRecs) if (sr.f + 1 === f && F.region[cIdx(...sr.exit)] === R.ri) view = sr.sp.axis === "col" ? [0, -1] : [-1, 0];
    }
    const byView = (rs) => {
      if (!view) return rs;
      const sc = (run) => (run.axis === "u" ? run.sg * view[1] : run.sg * view[0]);      // inward normal . view: -1 = the wall the entrant faces
      return rs.map((r, i) => [r, i]).sort((a, b) => sc(a[0]) - sc(b[0]) || a[1] - b[1]).map((x) => x[0]);
    };
    // a piece against a wall (opts: tint, runFirst (run -> bool), also (run, g) -> bool, sideways, seen (only where the target entrance sees it),
    // y0 (a wall-hung piece: its bottom above the floor), hTop (the height the window rule tests, for a piece that will carry another))
    const tryWall = (id, pref, opts) => {
      opts = opts || {};
      const cat = catOf(id);
      if (!cat || !budgetOK(cat)) return null;
      if (cat.wall) return hang(cat, opts.tint);
      const y0p = opts.y0 != null ? opts.y0 : cat.mount === "wall" ? cat.y0 : 0, yTop = Math.max(y0p + cat.h, opts.hTop || 0);
      const order = byView(shuffle(rng, merged.slice()));
      if (opts.runFirst) order.sort((a, b) => (opts.runFirst(b) ? 1 : 0) - (opts.runFirst(a) ? 1 : 0));
      // (the view model steers a piece only while the room still reads short from its entrance; a room that already shows VIEW_WANT takes the
      // rest where they fit - the expensive sight lines are not drawn for every candidate spot of every extra piece)
      const want = cat.h >= 0.25 && (opts.seen || opts.want || bestView(R).n < VIEW_WANT) ? (opts.want || target()) : 0, spare = [];
      // until the room's best entrance sees VIEW_WANT pieces, its extras (phase 1) go only where it sees them
      const mustSee = opts.seen || (phase === 1 && want && bestView(R).n < VIEW_WANT);
      const attempt = (run, t, g, side, m) => {
        const p = put(cat, g.u, g.v, side ? (g.fq + 1) % 4 : g.fq, opts.tint, { y0: y0p });      // (m tested only the wanted entrance: its full mask is counted lazily)
        if (!roomOK()) { unput(p); return null; }
        return Object.assign(p, { run, t, sideways: !!side });
      };
      const scan = (dims, side) => {
        for (const run of order) for (const t of runPositions(run, dims.w, side ? "corner" : pref)) {
          const g = wallRect(run, dims, t);
          if (!valid(g.rect, y0p, yTop)) continue;
          if (opts.also && !opts.also(run, g)) continue;
          const m = want ? visMask(R, g.rect, s[f] + y0p, s[f] + y0p + cat.h, null, want) : null;
          if (want && !(m & want)) { if (!mustSee && spare.length < 4) spare.push([run, t, g, side, m]); continue; }
          const p = attempt(run, t, g, side, m);
          if (p) return p;
        }
        return null;
      };
      let p = scan(cat, false);
      if (!p && opts.sideways) p = scan({ w: cat.d, d: cat.w }, true);
      if (!p) for (const [run, t, g, side, m] of spare) { p = attempt(run, t, g, side, m); if (p) break; }
      // (phase 3, the accurate model found no spot the game's camera sees: a spot the first-person eye sees still reads to a player who steps in -
      // a narrow room seen from its long side hides its far wall behind the body)
      if (!p && R._acc && opts.seen) { R._acc = false; p = scan(cat, false); R._acc = true; if (p) p.vis = null; }
      return p;
    };
    const tryAt = (id, u, v, fq, tint, touch) => {        // a piece centred at (u, v) facing fq
      const cat = catOf(id);
      if (!cat || !budgetOK(cat)) return null;
      const w = fq % 2 ? cat.d : cat.w, d = fq % 2 ? cat.w : cat.d;
      const rect = [u - w / 2, v - d / 2, u + w / 2, v + d / 2];
      if (cat.deco) { if (rect[0] < inner[0] || rect[1] < inner[1] || rect[2] > inner[2] || rect[3] > inner[3]) return null; for (const hr of holes) if (ovl(rect, hr, 0)) return null; for (const k of keepOuts[f]) if ((k.why === "stair" || k.why === "leaf") && ovl(rect, k.r, 1e-6)) return null; }     // (Wave 9: never behind an open door leaf either)
      else if (!valid(rect, 0, cat.h, touch)) return null;
      const p = put(cat, u, v, fq, tint);
      if (!cat.deco && !roomOK()) { unput(p); return null; }
      return p;
    };
    // a piece standing ON another one's top (a lamp on a nightstand, a TV on its cabinet, a microwave on a counter): back to the host's back edge
    const stackOn = (host, id, opts) => {
      opts = opts || {};
      if (!host || !furn.includes(host) || !host.cat.surface || host.tops || host.cat.h > host.cat.surface + 0.02 || (NOHOST.has(host.cat.id) && !opts.force)) return null;
      const cat = catOf(id);
      if (!cat || cat.deco || !budgetOK(cat)) return null;
      const hw = host.fq % 2 ? host.rect[3] - host.rect[1] : host.rect[2] - host.rect[0], hd = host.fq % 2 ? host.rect[2] - host.rect[0] : host.rect[3] - host.rect[1];
      if (cat.w > hw + 1e-6 || cat.d > hd + 1e-6) return null;
      const along = (opts.along || 0) * (hw - cat.w) / 2, back = (hd - cat.d) / 2 - 0.02;
      const dir = FACE[host.fq], side = [dir[1], -dir[0]];
      const u = host.u - dir[0] * Math.max(0, back) + side[0] * along, v = host.v - dir[1] * Math.max(0, back) + side[1] * along;
      const w = host.fq % 2 ? cat.d : cat.w, d = host.fq % 2 ? cat.w : cat.d, rect = [u - w / 2, v - d / 2, u + w / 2, v + d / 2];
      const ya = (host.y0 || 0) + host.cat.surface;
      if (!valid(rect, ya, ya + cat.h, false, host)) return null;
      const p = put(cat, u, v, host.fq, opts.tint, { y0: ya, host });
      if (!roomOK()) { unput(p); return null; }
      return p;
    };
    const hang = (cat, tint) => {
      const order = byView(shuffle(rng, solidRuns.slice()));
      for (const run of order) {
        const tm = (run.t0 + run.t1) / 2;
        for (const t of [tm, tm - 0.6, tm + 0.6]) {
          if (t - cat.w / 2 < run.t0 + JAMB + 0.05 || t + cat.w / 2 > run.t1 - JAMB - 0.05) continue;
          const g = wallRect(run, cat, t);
          if (g.rect[0] < inner[0] - 1e-6 || g.rect[1] < inner[1] - 1e-6 || g.rect[2] > inner[2] + 1e-6 || g.rect[3] > inner[3] + 1e-6) continue;
          let clash = false;
          for (const k of keep) if ((k.why === "stair" || k.why === "leaf") && ovl(g.rect, k.r, 1e-6)) { clash = true; break; }      // never on a stairwell wall, never behind an open door leaf
          for (const p of placed) if (!clash && ((p.y0 || 0) + p.cat.h > 1.25 || p.cat.wall) && ovl(g.rect, p.rect, -0.1)) { clash = true; break; }     // (the room's own pieces: nothing else stands inside its walls)
          if (clash) continue;
          return put(cat, g.u, g.v, g.fq, tint || pick(rng, ART));
        }
      }
      return null;
    };
    const inFront = (p, gap, cat, side) => {               // the centre of a piece `cat` standing `gap` in front of piece p (side: along offset)
      const dir = FACE[p.fq];
      const off = (p.fq % 2 ? (p.rect[2] - p.rect[0]) : (p.rect[3] - p.rect[1])) / 2 + gap + cat.d / 2;
      const sx = dir[1] !== 0 ? (side || 0) : 0, sz = dir[0] !== 0 ? (side || 0) : 0;
      return [p.u + dir[0] * off + sx, p.v + dir[1] * off + sz];
    };
    // a table with chairs round it, near the room's middle (dining, meeting, a workbench without chairs)
    const tableSet = (tableId, chairId, maxChairs) => {
      const tc = catOf(tableId);
      if (!tc) return null;
      const cu = (inner[0] + inner[2]) / 2, cv = (inner[1] + inner[3]) / 2, tq = iw >= idp ? 0 : 1;
      const pts = [];
      for (let du = -2; du <= 2; du += 0.5) for (let dv = -2; dv <= 2; dv += 0.5) pts.push([cu + du, cv + dv]);
      pts.sort((a, b) => ((a[0] - cu) * (a[0] - cu) + (a[1] - cv) * (a[1] - cv)) - ((b[0] - cu) * (b[0] - cu) + (b[1] - cv) * (b[1] - cv)) || a[0] - b[0] || a[1] - b[1]);
      for (const [pu, pv] of pts) {
        const t = tryAt(tableId, pu, pv, tq);
        if (!t) continue;
        if (!chairId) return t;
        const ch = catOf(chairId);
        if (!ch) return t;
        const off = t.cat.d / 2 + 0.12 + ch.d / 2, sp = t.cat.w >= 1.7 ? [-0.5, 0.5] : [0];
        const sides = tq === 0 ? [[0, off, 2], [0, -off, 0]] : [[off, 0, 3], [-off, 0, 1]];
        let n = 0;
        for (const [ou, ov, q] of sides) for (const s2 of sp) {
          if (n >= (maxChairs || 6)) break;
          const cu2 = pu + ou + (tq === 0 ? s2 : 0), cv2 = pv + ov + (tq === 0 ? 0 : s2);
          if (tryAt(chairId, cu2, cv2, q)) n++;
        }
        if (n === 0) { unput(t); continue; }
        return t;
      }
      return null;
    };
    const nStanding = () => placed.filter(counted).length;
    const kind = R.kind;
    if (R.tintW == null) R.tintW = pick(rng, TINT_WOOD);
    const tintW = R.tintW;
    const X = [], later = (fn) => { X.push(fn); };
    // PHASES (a storey's budget is shared round-robin, every room's KEY pieces first): 0 = what says what the room is (a sofa and a TV, the
    // kitchen counter row, a bed, the bathroom set, a desk, the shop counter and shelves), 1 = the rest of the room, 2 = >= 3 standing pieces,
    // 3 = pieces in VIEW of the best entrance until it sees VIEW_WANT
    if (phase === 0 && R.chest) later(() => {
      // the loot chest's slot: out of the entrance's view when it can be (the view is for the furniture that says what the room is)
      const slot = { id: "chest", src: "slot", w: 1.0, d: 0.75, h: 0.8, tris: 0, surface: null };
      const order = byView(shuffle(rng, merged.slice())).reverse(), want = roomView(R).ents.length ? target() : 0, seenOnes = [];   // (the entry wall first)
      const tryPut = (g) => { const p = put(slot, g.u, g.v, g.fq, 0, { slot: true }); if (!roomOK()) { unput(p); return false; } return true; };
      for (const run of order) for (const t of runPositions(run, slot.w, "corner")) {
        const g = wallRect(run, slot, t);
        if (!valid(g.rect, 0, slot.h)) continue;
        if (want && (visMask(R, g.rect, s[f], s[f] + slot.h) & want)) { if (seenOnes.length < 3) seenOnes.push(g); continue; }
        if (tryPut(g)) return;
      }
      for (const g of seenOnes) if (tryPut(g)) return;
    });
    // (Wave 8 fix round, lane K1) phase 5 = THE GUARANTEE, after every other phase: a room whose best entrance still shows fewer than 3 of its OWN pieces to the
    // first-person eye (interiorcheck's furniture-view: 1.62 m, 0.6 m inside the doorway; this copy is stricter - 2 of 10 points in 84 x 55 degrees) is searched
    // exhaustively for cheap pieces that eye sees: against every wall run (0.1 m steps), then free-standing on a 0.25 m lattice facing the entrance, inside the
    // storey's triangle budget. Every spot still passes valid() (no door / stair / leaf zone or window lane, nothing taller than the sill in front of a window) and
    // roomOK() (the ports stay joined). check_a / verify_b: 14 of 3739 rooms
    // (housegen notes "pieces in view") were short - one-cell rooms with two doors and a window, thin L baths, a living room between two doors. No rng is drawn
    // here: a room that already reads is untouched.
    if (phase === 5) {
      const V5 = roomView(R);
      if (!V5.ents.length) return X;
      later(() => {
        // (the count the earlier phases left - the accurate model, camera AND eye, is never above the eye's own count - decides first: most rooms stop here, untouched)
        if (bestView(R).n >= 3) return;
        R._acc = false; R._ext = null; R._tall = null; for (const q of placed) q.vis = null;
        if (bestView(R).n >= 3) return;
        const FL = s[f], budget5 = (cat) => tris[f] + cat.tris <= TRI_BUDGET;
        const cnt = () => viewCounts(R);
        const entOrder = cnt().map((n, i) => [n, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((q) => q[1]);
        const ids = [];
        for (const id of (VIEWPOOL[kind] || VIEWPOOL.hall).concat(RESCUE, FREEPOOL[kind] || FREEPOOL.hall, ["trash", "plant", "sideTable", "box", "chairMod"])) if (!ids.includes(id)) ids.push(id);
        const cat5 = (id) => { let c = CATALOG[id] || CATALOG[ALIAS[id]]; while (c && !budget5(c) && c.alt) c = c.alt; return c && budget5(c) && !c.deco && !c.wall && c.mount !== "top" && c.h >= 0.3 ? c : null; };
        const tryPiece = (cat, g, y0, want, ei) => {
          if (!valid(g.rect, y0, y0 + cat.h)) return false;
          if (!(visMask(R, g.rect, FL + y0, FL + y0 + cat.h, null, want) & want)) return false;
          const n0 = cnt()[ei];
          const p = put(cat, g.u, g.v, g.fq, tintW, { y0, rescue5: true });
          if (!roomOK() || cnt()[ei] <= n0) { unput(p); return false; }
          return true;
        };
        const search = (ei) => {
          const e = V5.ents[ei], want = 1 << ei;
          const need = () => cnt()[ei] < 3;
          const fqTo = Math.abs(e.fu) > 0.5 ? (e.fu > 0 ? 3 : 1) : (e.fv > 0 ? 2 : 0);   // a free piece's front toward the entrance
          for (const mode of ["wall", "free"]) for (const id of ids) {
            if (!need()) break;
            const cat = cat5(id);
            if (!cat || (mode === "free" && cat.mount === "wall")) continue;
            let done = false;
            if (mode === "wall") {
              const y0 = cat.mount === "wall" ? cat.y0 : 0;
              for (const run of merged) { if (done) break; for (let t = run.t0 + cat.w / 2; t <= run.t1 - cat.w / 2 + 1e-6 && !done; t += 0.1) done = tryPiece(cat, wallRect(run, cat, Math.round(t * 1000) / 1000), y0, want, ei); }
            } else {
              for (const fq of [fqTo, (fqTo + 1) % 4, (fqTo + 3) % 4]) {
                const w = fq % 2 ? cat.d : cat.w, d = fq % 2 ? cat.w : cat.d;
                for (let pu = inner[0] + w / 2; pu <= inner[2] - w / 2 + 1e-6 && !done; pu += 0.25) for (let pv = inner[1] + d / 2; pv <= inner[3] - d / 2 + 1e-6 && !done; pv += 0.25) {
                  const u = Math.round(pu * 1000) / 1000, v = Math.round(pv * 1000) / 1000;
                  done = tryPiece(cat, { rect: [u - w / 2, v - d / 2, u + w / 2, v + d / 2], u, v, fq }, 0, want, ei);
                }
                if (done) break;
              }
            }
          }
          return !need();
        };
        for (const ei of entOrder) if (search(ei)) return;
        // still short (a one-cell room between two doors and a window, its one free corner taken by the loot chest's slot): the slot gives way - the pieces
        // first, then the chest goes back wherever it still fits in the room (else the storey keeps its other loot: the chest is dropped)
        const slot = placed.find((q) => q.slot);
        if (!slot) return;
        const sc = slot.cat;
        unput(slot);
        let ok = false;
        for (const ei of entOrder) if (search(ei)) { ok = true; break; }
        if (!ok) { const b = put(sc, slot.u, slot.v, slot.fq, 0, { slot: true }); b.vis = null; if (!roomOK()) unput(b); return; }
        for (const run of merged) {
          for (let t = run.t0 + sc.w / 2; t <= run.t1 - sc.w / 2 + 1e-6; t += 0.1) {
            const g = wallRect(run, sc, Math.round(t * 1000) / 1000);
            if (!valid(g.rect, 0, sc.h)) continue;
            const b = put(sc, g.u, g.v, g.fq, 0, { slot: true });
            if (roomOK()) return;
            unput(b);
          }
        }
      });
      return X;
    }
    if (phase === 2) {                                   // top-up: every room should hold at least 3 standing pieces
      for (const id of ["plant", "lampSq", "trash", "box", "lamp", "sideTable", "stool", "coatRack", "boxOpen", "plant"]) later(() => { if (nStanding() < 3) tryWall(id, "corner"); });
      return X;
    }
    if (phase === 3 || phase === 4) {                    // in view: cheap pieces where the best entrance sees them
      // phase 4 (round 3: right after the key pieces, before anybody's extras use the storey's budget) = the MINIMUM: 3 pieces in view by the cheap
      // model. Phase 3 (after the extras) = THE ACCURATE COUNT (once per room): what shows from the game's third-person camera AND the first-person
      // eye, the room's tall pieces hiding what stands behind them, up to VIEW_WANT; a room that already reads so is done.
      const GOAL = phase === 4 ? 3 : VIEW_WANT;
      // (a room the cheap model already sees VIEW_WANT + 3 pieces of reads from the camera too: not counted again - the accurate count is the
      // slow part of a house, kept for the rooms where it can change the answer)
      if (phase === 3 && bestView(R).n >= VIEW_WANT + 3 && !(R._ps || []).some((q) => !q.run && !q.host && !q.cat.deco && q.cat.h >= 1.2)) return X;   // (free-standing racks / gondolas: counted)
      if (phase === 3) {
        // (counted again from the two entrances the cheap model rates best: the camera's count is for where a player reads the room)
        const cn = viewCounts(R), top2 = cn.map((n, i) => [n, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, 2);
        R._accMask = top2.reduce((m, q) => m | (1 << q[1]), 0);
        R._acc = true; R._tall = null; R._ext = null; for (const p of R._ps || []) p.vis = null;     // (the next rooms' pieces too: counted again below if needed)
      }
      if (!roomView(R).ents.length || bestView(R).n >= GOAL) { R._acc = false; return X; }
      // (stage B, lane I1: no extCounts(R) here any more - round 3 let the next rooms' pieces seen through the doorway count from phase 3 on, so a room could stop
      //  at 0 of its own pieces in view (check_a3: 6 of 116 looks rooms; interiorcheck counts a room's OWN pieces). Every phase counts the room's own.)
      // entrance by entrance (the one that sees most first): a doorway whose view is all door zone or stairwell gives way to the next one
      const pool = VIEWPOOL[kind] || VIEWPOOL.hall;
      const order = viewCounts(R).map((n, i) => [n, i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1]).slice(0, 2);
      const fails = {};                                   // (three pieces in a row that find no spot in an entrance's view: its view is full - the rest are not tried)
      for (const ei of order) for (const id of pool) later(() => {
        if (bestView(R).n >= GOAL || (phase === 3 && (fails[ei] || 0) >= 3)) return;     // (phase 4, the minimum, tries the whole pool)
        const p = tryWall(id, "view", { seen: true, tint: tintW, want: 1 << ei });
        fails[ei] = p ? 0 : (fails[ei] || 0) + 1;
        if (p && p.cat.surface && !p.tops && bestView(R).n < GOAL) stackOn(p, "lampTable");
      });
      // still short of 3: a free-standing piece in the open floor the doorway looks at (an armchair, a chair, a lamp, a box), facing the doorway
      for (const ei of order) later(() => {
        if (bestView(R).n >= 3) return;
        const e = roomView(R).ents[ei], want = 1 << ei, pts = [];
        for (let pu = inner[0] + 0.45; pu <= inner[2] - 0.45 + 1e-6; pu += 0.5) for (let pv = inner[1] + 0.45; pv <= inner[3] - 0.45 + 1e-6; pv += 0.5) {
          const du = pu - e.u, dv = pv - e.v, fwd = du * e.fu + dv * e.fv, lat = -du * e.fv + dv * e.fu;
          if (fwd > 0.9 && Math.abs(lat) < fwd * 0.7) pts.push([fwd + Math.abs(lat), pu, pv]);
        }
        pts.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);              // the far side of the room first (a piece in the doorway's face is not)
        const fq = Math.abs(e.fu) > 0.5 ? (e.fu > 0 ? 3 : 1) : (e.fv > 0 ? 2 : 0);    // its front toward the doorway
        for (const id of FREEPOOL[kind] || FREEPOOL.hall) {
          if (bestView(R).n >= 3) return;
          for (const [, pu, pv] of pts.slice(0, 16)) {
            const p = tryAt(id, pu, pv, fq, tintW);
            if (!p) continue;
            if (visOf(p) & want) break;
            if (R._acc) { R._acc = false; const m1 = visMask(R, p.rect, s[f], s[f] + p.cat.h, null, want); R._acc = true; if (m1 & want) break; }     // (the first-person eye sees it)
            unput(p);
          }
        }
      });
      // whatever already stands in view and has a free top gets a lamp / a small plant (cheap, and it counts) - in the rooms people live in
      if (!(kind === "storage" || kind === "warehouse" || kind === "barn" || kind === "ruin" || kind === "shop")) later(() => {
        for (const h of placed.slice()) {
          if (bestView(R).n >= GOAL) break;
          if (!h.cat.surface || h.tops || h.y0 || NOHOST.has(h.cat.id) || !(visOf(h) & target())) continue;
          stackOn(h, h.cat.surface > 0.95 ? "plantSmall" : "lampTable");
        }
      });
      // (stage B, lane I1) RESCUE, the accurate phase only, a room still short of 3 of its own pieces in view (a thin room seen from the middle of its long side):
      // (a) a wall piece its best entrance does not see is moved to a wall spot it sees (put back where it was if there is none); (b) the small pieces any
      // room may hold, wall-hung or against a wall, where that entrance sees them
      if (phase === 3) later(() => {
        if (bestView(R).n >= 3) return;
        const want = 1 << Math.max(0, bestView(R).ei);
        for (const q of placed.slice()) {
          if (bestView(R).n >= 3) return;
          if (!counted(q) || q.host || q.tops || q.slot || q.run == null || (visOf(q) & want) || !placed.includes(q)) continue;
          const keep = { y0: q.y0, run: q.run, t: q.t, sideways: q.sideways };
          unput(q);
          const p = tryWall(q.cat.id, "view", { seen: true, tint: q.tint, want });
          if (!p) { const b = put(q.cat, q.u, q.v, q.fq, q.tint, keep); b.vis = null; }
        }
        for (const id of RESCUE) { if (bestView(R).n >= 3) return; tryWall(id, "view", { seen: true, tint: tintW, want }); }
      });
      return X;
    }
    const core = phase === 0;
    // ---- layouts (round 3, lane H6): rooms filled the way the top looters furnish theirs - a sofa SET round a rug, desk CLUSTERS on an office
    // floor, rows of racking and loaded pallets in storage, shop aisles with coolers along a wall - from cheap authored pieces (10-150 triangles)
    // where a kit GLB is not needed, so a big room holds 12-30 pieces inside the storey's 4k triangles.
    const longU = iw >= idp;                               // the room's long axis
    const A2UV = (a, b) => (longU ? [a, b] : [b, a]);       // (along the long axis, across it) -> (u, v)
    const cu0 = (inner[0] + inner[2]) / 2, cv0 = (inner[1] + inner[3]) / 2, LA = longU ? iw : idp, LB = longU ? idp : iw;
    // free-standing ROWS across the open floor (racks, gondolas, loaded pallets): pieces side by side along the long axis, rows `gap` apart, from the
    // middle out; a row keeps 1.1 m clear at both ends (walk round it). Returns how many pieces stood.
    const rows = (id, maxN, gap, opt) => {
      opt = opt || {};
      const cat = catOf(id); if (!cat) return 0;
      // the rows run ALONG the entrant's view (from the door the player looks down the aisles, not at the side of the first rack), else along the long axis
      const alongU = view ? Math.abs(view[0]) > 0.5 : longU, la = alongU ? iw : idp, lb = alongU ? idp : iw;
      const ab2uv = (a, b) => (alongU ? [a, b] : [b, a]);
      const pw = cat.w, pd = cat.d, fqRow = alongU ? 0 : 1, end = opt.end != null ? opt.end : 1.1, sp = opt.space || 0;
      const nAlong = Math.max(0, Math.floor((la - 2 * end + sp + 1e-6) / (pw + sp)));
      if (!nAlong) return 0;
      // the across positions: a pattern whose aisle lies in line with the entrance (the doorway looks down an aisle)
      const step = pd + gap, dc = R.reg.entry ? (alongU ? doorGeo(R.reg.entry).v - cv0 : doorGeo(R.reg.entry).u - cu0) : 0;
      const pat = (o0) => { const o = []; for (let k = 0; k < 6; k++) { o.push(o0 + k * step); o.push(o0 - (k + 1) * step); } return o.filter((x, q, a) => a.indexOf(x) === q); };
      const A = pat(step / 2), Bp = pat(0), aisleA = Math.min(...[0, step, -step, 2 * step, -2 * step].map((x) => Math.abs(x - dc))), aisleB = Math.min(...[step / 2, -step / 2, 1.5 * step, -1.5 * step].map((x) => Math.abs(x - dc)));
      // (and never a row in the doorway's own line of sight: the entrant - and the camera over his shoulder - looks down an aisle)
      const doorsAcross = roomView(R).ents.filter((e) => e.door && Math.abs(alongU ? e.fu : e.fv) > 0.5).map((e) => (alongU ? e.v - cv0 : e.u - cu0));
      const offs = (aisleA <= aisleB ? A : Bp).filter((ob) => doorsAcross.every((d) => Math.abs(ob - d) >= pd / 2 + 0.9)).sort((x, y) => Math.abs(x) - Math.abs(y) || x - y);
      let n = 0;
      for (const ob of offs) {
        if (n >= maxN) break;
        if (Math.abs(ob) + pd / 2 > lb / 2 - (opt.wallGap != null ? opt.wallGap : 1.05)) continue;
        const run = nAlong * pw + (nAlong - 1) * sp;
        for (let k = 0; k < nAlong && n < maxN; k++) {
          const a = -run / 2 + pw / 2 + k * (pw + sp), [du, dv] = ab2uv(a, ob);
          const p = tryAt(id, cu0 + du, cv0 + dv, (fqRow + (k % 2 && opt.flip ? 2 : 0)) % 4, opt.tint, true);
          if (p) { n++; if (opt.top) opt.top(p); }
        }
      }
      return n;
    };
    // an office DESK CLUSTER: two desks back to back (each with its chair and a monitor), twice side by side when it fits; clusters on a grid over
    // the open floor, 1.3 m aisles. A cluster that cannot keep both of a pair's desks is taken out again.
    const clusters = (maxN) => {
      const dk = catOf("deskA"), ch = catOf("officeChair"); if (!dk || !ch) return 0;
      const pairW = dk.w, span = 2 * (dk.d + ch.d + 0.12);            // a pair: along a = desk width, across b = desk, desk, chairs either side
      const stepA = 2 * pairW + 1.3, stepB = span + 1.3;
      const na = Math.max(0, Math.floor((LA - 1.3 + 1e-6) / stepA)), nb = Math.max(0, Math.floor((LB - 1.3 + 1e-6) / stepB));
      let n = 0;
      const pts = [];
      for (let ia = 0; ia < Math.max(1, na); ia++) for (let ib = 0; ib < Math.max(1, nb); ib++) pts.push([(ia - (Math.max(1, na) - 1) / 2) * stepA, (ib - (Math.max(1, nb) - 1) / 2) * stepB]);
      for (const [ca, cb] of pts) {
        if (n >= maxN) break;
        for (const half of [-1, 1]) {                                   // two pairs side by side along a
          const a = ca + half * pairW / 2, got = [];
          for (const sd of [-1, 1]) {                                   // the two desks of a pair, back to back across b
            const [du, dv] = A2UV(a, cb + sd * dk.d / 2), fq = longU ? (sd < 0 ? 2 : 0) : (sd < 0 ? 3 : 1);
            const d = tryAt("deskA", cu0 + du, cv0 + dv, fq, tintW, true);
            if (!d) continue;
            got.push(d);
            const [cuC, cvC] = A2UV(a, cb + sd * (dk.d + 0.08 + ch.d / 2));
            tryAt("officeChair", cu0 + cuC, cv0 + cvC, (fq + 2) % 4);
            stackOn(d, "monitor", { along: half * 0.3 });
          }
          if (got.length) n += got.length;
        }
      }
      return n;
    };
    // the sofa SET: a coffee table in front of the sofa on a big rug, an armchair at its side facing it, a side table + lamp beside the sofa
    const sofaSet = (sofa) => {
      if (!sofa || !furn.includes(sofa)) return;
      const cid = rng() < 0.5 ? "coffee" : "coffeeSq", cc = catOf(cid) || catOf("coffee"); if (!cc) return;
      const [cu, cv] = inFront(sofa, 0.42, cc);
      const cof = tryAt(cid, cu, cv, sofa.fq) || tryAt("coffeeSq", cu, cv, sofa.fq);
      if (!cof) return;
      tryAt(area >= 22 ? "rugLarge" : "rug", cof.u, cof.v, sofa.fq % 2 ? 1 : 0, pick(rng, RUG)) || tryAt("rugSmall", cof.u, cof.v, sofa.fq % 2 ? 1 : 0, pick(rng, RUG));
      if (rng() < 0.6) stackOn(cof, "plantSmall");
      const dir = FACE[sofa.fq], side = [dir[1], -dir[0]], ac = catOf("armchair");
      if (ac) for (const sg of rng() < 0.5 ? [1, -1] : [-1, 1]) {
        const off = (cof.fq % 2 ? cof.rect[3] - cof.rect[1] : cof.rect[2] - cof.rect[0]) / 2 + 0.25 + ac.d / 2;
        const fqA = turnOfDir(-side[0] * sg, -side[1] * sg);           // its front toward the coffee table
        if (tryAt("armchair", cof.u + side[0] * sg * off, cof.v + side[1] * sg * off, fqA)) break;
      }
    };
    const wallDecor = (ids) => { for (const id of ids) later(() => tryWall(id, "center")); };
    if (kind === "living") {
      if (core) {
        later(() => { R.sofa = tryWall(rng() < 0.3 ? "sofaDesign" : "sofa", "center", { tint: 0 }) || tryWall("sofa", "center", { tint: 0 }); });
        later(() => {
          const sofa = R.sofa;
          const tv = tryWall("tv", "center", Object.assign({ hTop: 1.7 }, sofa ? { runFirst: (run) => run.axis === sofa.run.axis && run.sg === -sofa.run.sg } : {}));
          if (tv) stackOn(tv, "tvSet");
        });
      } else {
        later(() => sofaSet(R.sofa));
        later(() => { const st = tryWall("sideTable", "corner"); if (st) stackOn(st, "lampTable"); });
        later(() => tryWall(rng() < 0.5 ? "bookcase" : "bookcaseOpen", "corner"));
        later(() => tryWall("plant", "corner"));
        later(() => tryWall("lampSq", "corner"));
        wallDecor(["artWide", "clock"]);
        later(() => tryWall("shelf", "corner", { tint: tintW }));
        later(() => tryWall("plant", "corner"));
        if (area >= 25) { later(() => tryWall("armchair", "corner")); later(() => tryWall("lamp", "corner")); later(() => tryWall("bookcaseLow", "corner", { tint: tintW })); }
        later(() => tryWall("art", "center"));
        later(() => tryWall("wallShelf", "center"));
      }
    } else if (kind === "kitchen") {
      if (core) later(() => {
        // the counter row: contiguous cabinets along one wall, the tall fridge at an end (it may not stand in front of a window); wall cabinets
        // over the counters, a microwave on one
        const seqs = [["fridge", "counter", "sink", "stoveBox", "counter", "drawerCab"], ["drawerCab", "counter", "sink", "stoveBox", "counter", "fridge"], ["fridge", "counter", "sink", "stoveBox", "counter"],
          ["counter", "sink", "stoveBox", "counter", "fridge"], ["counter", "sink", "stoveBox", "counter"], ["sink", "stoveBox", "counter"], ["sink", "stoveBox"]];
        let done = null;
        const runsBy = merged.slice().sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0) || a.line - b.line || a.sg - b.sg);
        for (const seq of seqs) {
          if (done) break;
          for (const run of runsBy) {
            for (const dir of [1, -1]) {
              const c0 = catOf(seq[0]);
              if (!c0) continue;
              const pos = runPositions(run, c0.w, "corner").filter((t) => (dir > 0 ? t - run.t0 <= run.t1 - t : t - run.t0 >= run.t1 - t));
              for (const t0 of pos.slice(0, 6)) {
                let t = t0;
                const got = [];
                for (const id of seq) {
                  const cat = catOf(id);
                  if (!cat) break;
                  if (got.length) t += dir * (got[got.length - 1].cat.w / 2 + cat.w / 2);
                  const g = wallRect(run, cat, t);
                  if (!budgetOK(cat) || !valid(g.rect, 0, cat.h, got.length > 0)) break;
                  got.push(Object.assign(put(cat, g.u, g.v, g.fq, id === "counter" || id === "drawerCab" ? tintW : 0), { run, t }));
                }
                if (got.length >= Math.min(3, seq.length) && roomOK()) { done = got; break; }
                for (const p of got) unput(p);
              }
              if (done) break;
            }
            if (done) break;
          }
        }
        if (!done) { tryWall("stoveBox", "corner"); tryWall("fridge", "corner"); return; }
        R.row = done;
      });
      if (core && area >= 15) later(() => { const ch = rng() < 0.25 ? "chair" : "chairMod"; tableSet(rng() < 0.5 ? "table" : "tableCloth", ch, 4) || tableSet("table", "chair", 4); R.dining = true; });
      if (!core) {
        later(() => {
          const row = R.row || [];
          const upper = CATALOG.upper;
          if (upper) for (const p of row) {
            if (!furn.includes(p) || !(p.cat.id === "counter" || p.cat.id === "drawerCab" || p.cat.id === "stoveBox" || p.cat === (CATALOG.counter && CATALOG.counter.alt))) continue;
            const cat = catOf("upper");
            if (!cat || !budgetOK(cat)) break;
            const g = wallRect(p.run, cat, p.t);
            if (!valid(g.rect, cat.y0, cat.y0 + cat.h)) continue;
            put(cat, g.u, g.v, g.fq, tintW, { y0: cat.y0 });
          }
          const host = row.find((p) => furn.includes(p) && (p.cat.id === "counter" || p.cat.id === "drawerCab") && !p.tops);
          if (host) stackOn(host, "microwave", { along: rng() < 0.5 ? -0.6 : 0.6 });
        });
        later(() => { if (R.dining) return; const ch = rng() < 0.25 ? "chair" : "chairMod"; tableSet(rng() < 0.5 ? "table" : "tableCloth", ch, 4) || tableSet("table", "chair", 4); });
        later(() => tryWall("trash", "corner"));
        wallDecor(["clock", "art"]);
        later(() => tryWall("plant", "corner"));
        later(() => tryWall("wallShelf", "center"));
        if (area >= 20) later(() => { const b = tryWall("bookcaseLow", "corner", { tint: tintW }); if (b) stackOn(b, "plantSmall"); });
        later(() => tryAt("rugSmall", cu0, cv0, longU ? 0 : 1, pick(rng, RUG)));
      }
    } else if (kind === "bedroom") {
      const big = iw >= 2.4 && idp >= 2.4;
      if (core) {
        later(() => {
          const blanket = pick(rng, BLANKET);
          const bed = tryWall(big ? "bed" : "bedSingle", "center", { tint: blanket }) || tryWall("bedSingle", "center", { tint: blanket, sideways: true });
          R.bed = bed;
          if (bed && !bed.sideways) {
            let n = 0;
            for (const sd of [1, -1]) {
              const ns = catOf("nightstand");
              if (!ns) break;
              const t = bed.t + sd * (bed.cat.w / 2 + 0.05 + ns.w / 2);
              const g = wallRect(bed.run, ns, t);
              if (budgetOK(ns) && valid(g.rect, 0, ns.h)) { const p = put(ns, g.u, g.v, g.fq, tintW); if (!roomOK()) { unput(p); continue; } n++; stackOn(p, n === 1 ? "lampTable" : "plantSmall"); if (n >= (big ? 2 : 1)) break; }
            }
          }
        });
        later(() => tryWall("wardrobe", "corner", { tint: tintW }));
      } else {
        later(() => { const b = R.bed; if (b && furn.includes(b) && big) { const [ru, rv] = inFront(b, -1.1, catOf("rug") || CATALOG.rug); tryAt("rug", ru, rv, b.fq % 2 ? 0 : 1, pick(rng, RUG)); } });
        later(() => { const dr = tryWall("dresser", "corner", { tint: tintW, hTop: 1.0 }); if (dr) stackOn(dr, rng() < 0.6 ? "lampTable" : "plantSmall"); });
        wallDecor(["art", "clock"]);
        later(() => {
          if (rng() < 0.55) {
            const desk = tryWall("desk", "corner", { tint: tintW });
            if (desk) { const [cu, cv] = inFront(desk, 0.02, CATALOG.chair); tryAt("chairMod", cu, cv, (desk.fq + 2) % 4) || tryAt("chair", cu, cv, (desk.fq + 2) % 4); stackOn(desk, "screen"); }
          }
        });
        later(() => tryWall("lampSq", "corner"));
        later(() => tryWall("plant", "corner"));
        later(() => tryWall("wallShelf", "center"));
        if (area >= 20) { later(() => tryWall("armchair", "corner")); later(() => tryWall("bookcaseLow", "corner", { tint: tintW })); }
      }
    } else if (kind === "bath") {
      if (core) { later(() => tryWall("toilet", "corner")); later(() => tryWall("basin", "center", { tint: 0xe9e6dc })); later(() => tryWall("bathtub", "corner", { sideways: true })); }
      else {
        later(() => tryWall("mirror", "center"));
        later(() => tryWall("bathCab", "center"));
        later(() => tryWall("trash", "corner"));
        later(() => tryWall("dryer", "corner"));
        later(() => tryAt("rugSmall", cu0, cv0, longU ? 0 : 1, pick(rng, [0x5a7a9a, 0xd8d2c4, 0x7a9a8a])));
        later(() => { if (rng() < 0.5) tryWall("plant", "corner"); });
        later(() => tryWall("wallShelf", "center"));
      }
    } else if (kind === "office") {
      const roomy = LA >= 5.4 && LB >= 4.6;
      if (core) {
        later(() => {
          if (roomy && clusters(area >= 45 ? 8 : 4) > 0) return;
          const desk = tryWall("desk", "center", { tint: tintW });
          if (desk) { const [cu, cv] = inFront(desk, 0.02, CATALOG.chairDesk || CATALOG.chair); tryAt("chairDesk", cu, cv, (desk.fq + 2) % 4) || tryAt("chairMod", cu, cv, (desk.fq + 2) % 4); stackOn(desk, "screen"); }
        });
        later(() => tryWall("filingCab", "corner"));
        later(() => tryWall("bookcase", "corner"));
      } else {
        wallDecor(["whiteboard", "clock"]);
        later(() => tryWall("filingCab", "corner")); later(() => tryWall("filingCab", "corner"));
        if (!roomy && area >= 15) later(() => { const desk = tryWall("desk", "corner", { tint: tintW }); if (desk) { const [cu, cv] = inFront(desk, 0.02, CATALOG.chairDesk || CATALOG.chair); tryAt("chairDesk", cu, cv, (desk.fq + 2) % 4); stackOn(desk, "screen"); } });
        later(() => tryWall(rng() < 0.5 ? "bookcaseOpen" : "lockers", "corner"));
        later(() => tryWall("plant", "corner"));
        later(() => { const b = tryWall("box", "corner"); if (b && rng() < 0.5) tryWall("boxStack", "corner"); });
        later(() => tryWall("plant", "corner"));
        later(() => tryWall("lampSq", "corner"));
        later(() => tryWall("trash", "corner"));
        wallDecor(["art", "poster"]);
      }
    } else if (kind === "shop") {
      const shelf = () => tryWall(rng() < 0.5 ? "shelf" : "rackWall", "corner", { tint: tintW }) || tryWall("shelfLow", "corner", { tint: tintW });
      if (core) {
        later(() => { tryWall("shopCounter", "corner", { tint: tintW, runFirst: (run) => run.axis === "v" }); });
        later(() => tryWall("cooler", "corner")); later(() => tryWall("cooler", "corner"));
        // aisles: rows of free-standing gondolas down the shop floor
        later(() => { if (LB >= 4.4) rows("gondola", area >= 50 ? 8 : 4, 1.35, { end: 1.2 }); });
      } else {
        later(() => tryWall("cooler", "corner"));
        for (let n = 0; n < 4; n++) later(shelf);
        later(() => tryWall("boxStack", "corner")); later(() => tryWall("cartonOpen", "corner"));
        later(() => tryWall("plant", "corner"));
        wallDecor(["poster", "poster", "clock"]);
        later(() => tryWall("trash", "corner"));
      }
    } else if (kind === "storage" || kind === "warehouse" || kind === "barn") {
      const big = kind !== "storage";
      if (core) {
        if (kind === "barn") {
          later(() => rows(rng() < 0.5 ? "hayStack" : "palletLoad", Math.max(2, Math.round(area / 22)), 1.6, { wallGap: 1.3, tint: 0xb2875a, space: 0.3 }));
          later(() => tryWall("workbench", "center"));
        } else if (big) {
          later(() => rows(rng() < 0.6 ? "rackRow" : "palletLoad", Math.max(3, Math.round(area / 9)), 1.45, { tint: 0xb2875a }));
          if (P.theme === "mill") later(() => tryWall("machine", "center"));
        } else {
          later(() => { if (LB >= 4.4 && LA >= 4.4 && rng() < 0.7) rows("rackRow", 4, 1.4); });
          later(() => tryWall("rackWall", "corner", { tint: tintW }));
        }
        later(() => tryWall("rackWall", "corner", { tint: tintW }));
      } else {
        const n = big ? Math.max(2, Math.round(area / 25)) : 1;
        for (let k = 0; k < n; k++) later(() => tryWall(k % 2 ? "rackWall" : "crateStack", "corner", { tint: tintW }));
        later(() => tryWall("palletLoad", "corner", { tint: 0xb2875a }));
        later(() => tryWall("boxStack", "corner")); later(() => tryWall("carton", "corner")); later(() => tryWall("cartonOpen", "corner"));
        later(() => tryWall(kind === "barn" ? "hayBale" : "drum", "corner", { tint: pick(rng, [0x3a6a8a, 0x8a3a2e, 0x4a6a3a, 0x9a9a3a]) }));
        later(() => tryWall(kind === "barn" ? "sacks" : "crate", "corner", { tint: tintW }));
        later(() => tryWall("carton", "corner"));
        later(() => { const pl = tryWall("pallet", "corner"); if (pl) stackOn(pl, "box", { along: 0.5, force: true }); });
        if (big) { later(() => tryWall("drum", "corner", { tint: 0x3a6a8a })); later(() => tryWall(kind === "barn" ? "sacks" : "lockers", "corner")); later(() => { const d = tryWall("workbench", "corner"); void d; }); }
        later(() => tryWall("trash", "corner"));
        wallDecor(["clock"]);
      }
    } else if (kind === "lobby") {
      if (core) {
        later(() => tryWall("shopCounter", "center", { tint: tintW }));
        later(() => { const so = tryWall("sofaDesign", "center", { tint: 0 }) || tryWall("sofa", "center", { tint: 0 }); R.sofa = so; });
      } else {
        later(() => sofaSet(R.sofa));
        later(() => tryWall("plant", "corner")); later(() => tryWall("plant", "corner"));
        wallDecor(["artWide", "clock"]);
        later(() => tryWall("lampSq", "corner")); later(() => tryWall("bookcaseLow", "corner", { tint: tintW })); later(() => tryWall("armchair", "corner"));
      }
    } else if (kind === "meeting") {
      if (core) { later(() => tableSet(rng() < 0.5 ? "tableA" : "tableCloth", "chairMod", 6) || tableSet("table", "chair", 4)); later(() => tryWall("bookcase", "corner")); }
      else {
        later(() => { const tv = tryWall("tv", "center", { hTop: 1.7 }); if (tv) stackOn(tv, "tvSet"); });
        wallDecor(["whiteboard", "clock"]);
        later(() => tryWall("plant", "corner")); later(() => tryWall("plant", "corner")); later(() => tryWall("filingCab", "corner")); later(() => tryWall("lampSq", "corner"));
      }
    } else if (kind === "ruin") {
      // an abandoned room: rubble, broken crates, an old table and chair, a fallen shelf's remains, cartons, a drum
      if (core) { later(() => tryWall("rubble", "corner")); later(() => tableSet("tableA", "chairMod", 2) || tryWall("tableA", "center", { tint: 0x6e5232 })); }
      else {
        later(() => tryAt("rubble", cu0 + (rng() - 0.5) * Math.max(0, iw - 2.5), cv0 + (rng() - 0.5) * Math.max(0, idp - 2.2), rng() < 0.5 ? 0 : 1));
        later(() => tryWall("crate", "corner", { tint: 0x6e5232 })); later(() => tryWall("shelfLow", "corner", { tint: 0x5e4430 }));
        later(() => tryWall("cartonOpen", "corner")); later(() => tryWall("drum", "corner", { tint: 0x6a4a3a })); later(() => tryWall("crateStack", "corner", { tint: 0x6e5232 }));
        later(() => tryWall("carton", "corner")); wallDecor(["poster"]);
      }
    } else if (kind === "hall" && core) {
      later(() => tryWall("coatRack", "corner")); later(() => tryWall("plant", "corner"));
    } else if (kind === "hall" && !core) {
      later(() => tryAt("runner", cu0, cv0, longU ? 1 : 0, pick(rng, RUG)));
      wallDecor(["art", "clock"]);
      later(() => tryWall("plant", "corner"));
      later(() => { const d = tryWall(rng() < 0.5 ? "dresser" : "sideTable", "center", { hTop: 1.0, tint: tintW }); if (d) stackOn(d, "lampTable"); });
      later(() => tryWall("coatRack", "corner"));
      later(() => tryWall("lampSq", "corner"));
      later(() => tryWall("art", "center"));
    }
    return X;
  };
  // a chest slot on one non-hall room per floor
  for (let f = 0; f < S; f++) {
    const cands = roomRecs.filter((r) => r.floor === f && r.kind !== "hall" && r.kind !== "bath");
    if (cands.length && rng() < 0.6) pick(rng, cands).chest = true;
  }
  const roundRobin = (queues) => { for (let more = true; more;) { more = false; for (const q of queues) if (q.length) { q.shift()(); more = true; } } };
  // the storey's budget: shares by area with a floor (a 6 m2 bathroom still gets its set), a reserve held back for the in-view pieces of phase 3
  for (let f = 0; f < S; f++) {
    const mine = roomRecs.filter((r) => r.floor === f), wt = (r) => (SHAREW[r.kind] || 1) * (r.cells.length + 2), wsum = mine.reduce((a, r) => a + wt(r), 0);
    const avail = Math.max(0, TRI_BUDGET - tris[f] - Math.min(200 * mine.length, 0.3 * Math.max(0, TRI_BUDGET - tris[f])));
    for (const r of mine) { r.share = avail * wt(r) / Math.max(1, wsum); r.spent = 0; }
  }
  for (const ph of [0, 4, 1, 3, 2, 5]) roundRobin(roomRecs.map((R) => furnishRoom(R, ph)));      // (5: the guarantee, lane K1)
  for (const R of roomRecs) { const b = bestView(R); if (b.n < 3) notes.push("room f" + R.floor + "r" + R.ri + " (" + R.kind + "): " + b.n + " pieces in view from " + roomView(R).ents.length + " entrance(s); storey budget left " + (TRI_BUDGET - tris[R.floor]) + ", share " + Math.round(R.share) + " spent " + R.spent); }
  // honest labels: a "bedroom" no bed fits in (door zones, a narrow L) is a box room
  for (const R of roomRecs) if (R.kind === "bedroom" && !furn.some((p) => p.room === R && (p.cat.id === "bed" || p.cat.id === "bedSingle"))) R.kind = "storage";

  // ---- the capsule walk (setup above the furnisher)
  const walk = () => {
    const free = [], seen = [];
    for (let f = 0; f < S; f++) {
      const fr = structFree[f].slice();
      for (const p of furn) if (p.f === f) for (const pb of pieceBoxes(p)) blockInto(fr, s[f], pb[0], pb[1], pb[2], pb[3], pb[4], pb[5]);
      free.push(fr); seen.push(new Uint8Array(NS));
    }
    // stair links: march the centreline at the ramp height against every collider box near the stair
    const stairOK = sr => {
      const cm = (sr.across0 + sr.across1) / 2, r2 = CAPSULE.r * CAPSULE.r;
      const lo0 = Math.min(sr.top, sr.foot) - 1.5, hi0 = Math.max(sr.top, sr.foot) + 1.5;
      const near = (q) => (sr.sp.axis === "col" ? q[1] > cm - 1.5 && q[0] < cm + 1.5 && q[5] > lo0 && q[4] < hi0 : q[5] > cm - 1.5 && q[4] < cm + 1.5 && q[1] > lo0 && q[0] < hi0);
      const solids = structSolids.filter(near);
      for (const p of furn) for (const pb of pieceBoxes(p)) if (near(pb)) solids.push(pb);
      for (let d = -0.5; d <= sr.run + 0.5 + 1e-9; d += 0.1) {
        const t = sr.foot - d, h = s[sr.f] + sr.rise * clamp(d / sr.run, 0, 1);
        const x = sr.sp.axis === "col" ? cm : t, z = sr.sp.axis === "col" ? t : cm;
        for (const q of solids) {
          if (!(q[3] > h + CAPSULE.step && q[2] < h + CAPSULE.h)) continue;
          const ex = x < q[0] ? q[0] - x : x > q[1] ? x - q[1] : 0, ez = z < q[4] ? q[4] - z : z > q[5] ? z - q[5] : 0;
          if (ex * ex + ez * ez < r2) return false;
        }
      }
      return true;
    };
    const inCell = (a, b, i, j) => { const x = su(a), z = sv(b); return x > uL(i) && x < uL(i + 1) && z > vL(j) && z < vL(j + 1); };
    const cellSamples = (i, j) => {
      const out = [];
      const a0 = Math.max(0, Math.floor((uL(i) + W / 2 + RING) / GRID) - 1), a1 = Math.min(NU - 1, Math.ceil((uL(i + 1) + W / 2 + RING) / GRID) + 1);
      const b0 = Math.max(0, Math.floor((vL(j) + D / 2 + RING) / GRID) - 1), b1 = Math.min(NV - 1, Math.ceil((vL(j + 1) + D / 2 + RING) / GRID) + 1);
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) if (inCell(a, b, i, j)) out.push(b * NU + a);
      return out;
    };
    const links = stairRecs.map((sr) => ({ sr, ok: stairOK(sr), lo: cellSamples(sr.approach[0], sr.approach[1]), hi: cellSamples(sr.exit[0], sr.exit[1]), up: false, down: false }));
    // link marks: mark[f][k] = 1 + link index * 2 (+1 for the upper end)
    const mark = [];
    for (let f = 0; f < S; f++) mark.push(new Int16Array(NS));
    links.forEach((L, li) => { if (!L.ok) return; for (const k of L.lo) mark[L.sr.f][k] = 1 + li * 2; for (const k of L.hi) mark[L.sr.f + 1][k] = 2 + li * 2; });
    // start: the street point 1.2 m outside the front door
    const fd = doors.find((d) => d.kind === "front"), g = doorGeo(fd);
    const sa = Math.round((g.u + W / 2 + RING) / GRID - 0.5), sb = Math.round((g.v + 1.2 + D / 2 + RING) / GRID - 0.5);
    const q = new Int32Array(NS * S + 8);
    let qn = 0;
    const push = (f, k) => { const fr = free[f], se = seen[f]; if (fr[k] && !se[k]) { se[k] = 1; q[qn++] = f * NS + k; } };
    push(0, sb * NU + sa);
    const startOK = qn > 0;
    while (qn) {
      const n = q[--qn], f = (n / NS) | 0, k = n - f * NS, a = k % NU, b = (k - a) / NU;
      if (a > 0) push(f, k - 1); if (a < NU - 1) push(f, k + 1); if (b > 0) push(f, k - NU); if (b < NV - 1) push(f, k + NU);
      const mk = mark[f][k];
      if (mk) {
        const L = links[(mk - 1) >> 1];
        if (mk & 1) { if (!L.up) { L.up = true; for (const kk of L.hi) push(L.sr.f + 1, kk); } }
        else if (!L.down) { L.down = true; for (const kk of L.lo) push(L.sr.f, kk); }
      }
    }
    return { free, seen, startOK, links };
  };
  const sampleNear = (wk, f, u, v, maxD, needSeen) => {     // the reachable sample nearest (u, v) within maxD
    let best = -1, bd = maxD * maxD;
    const a0 = Math.max(0, Math.floor((u - maxD + W / 2 + RING) / GRID)), a1 = Math.min(NU - 1, Math.ceil((u + maxD + W / 2 + RING) / GRID));
    const b0 = Math.max(0, Math.floor((v - maxD + D / 2 + RING) / GRID)), b1 = Math.min(NV - 1, Math.ceil((v + maxD + D / 2 + RING) / GRID));
    for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
      const k = b * NU + a;
      if (needSeen ? !wk.seen[f][k] : !wk.free[f][k]) continue;
      const dx = su(a) - u, dz = sv(b) - v, dd = dx * dx + dz * dz;
      if (dd < bd - 1e-12) { bd = dd; best = k; }
    }
    return best;
  };
  const roomReached = (wk, R) => {
    for (const [i, j] of R.cells) {
      const a0 = Math.floor((uL(i) + W / 2 + RING) / GRID), a1 = Math.ceil((uL(i + 1) + W / 2 + RING) / GRID);
      const b0 = Math.floor((vL(j) + D / 2 + RING) / GRID), b1 = Math.ceil((vL(j + 1) + D / 2 + RING) / GRID);
      for (let b = Math.max(0, b0); b < Math.min(NV, b1); b++) for (let a = Math.max(0, a0); a < Math.min(NU, a1); a++) {
        if (!wk.seen[R.floor][b * NU + a]) continue;
        const x = su(a), z = sv(b);
        if (x > uL(i) && x < uL(i + 1) && z > vL(j) && z < vL(j + 1)) return true;
      }
    }
    return false;
  };
  const doorReached = (wk, d) => {
    const g = doorGeo(d);
    for (const sd of [-1, 1]) {
      const u = g.u + g.nu * sd * 0.5, v = g.v + g.nv * sd * 0.5;
      if (sampleNear(wk, d.floor, u, v, 0.2, true) < 0) return false;
    }
    return true;
  };
  // run the walk; while something is unreachable, remove the last piece placed on the failing floor
  let wk = null, removed = 0;
  for (let guard = 0; guard < 80; guard++) {
    wk = walk();
    const bad = new Set();
    for (const R of roomRecs) if (!roomReached(wk, R)) bad.add(R.floor);
    for (const d of doors) if (!doorReached(wk, d)) bad.add(d.floor);
    for (const sr of stairRecs) {
      const ap = cellRect(...sr.approach), ex = cellRect(...sr.exit);
      if (sampleNear(wk, sr.f, (ap[0] + ap[2]) / 2, (ap[1] + ap[3]) / 2, 1.1, true) < 0) bad.add(sr.f);
      if (sampleNear(wk, sr.f + 1, (ex[0] + ex[2]) / 2, (ex[1] + ex[3]) / 2, 1.1, true) < 0) bad.add(sr.f + 1);
    }
    if (!bad.size) break;
    const fl = Math.min(...bad);
    let li = -1;
    for (let k = furn.length - 1; k >= 0; k--) if (furn[k].f === fl && !furn[k].cat.deco && !furn[k].slot) { li = k; break; }
    if (li < 0) { notes.push("floor " + fl + ": unreachable with no furniture left"); break; }
    const p = furn.splice(li, 1)[0];
    { const l = p.room._ps, q = l.indexOf(p); if (q >= 0) l.splice(q, 1); if (p.room._rw) p.room._rw.stale = true; }
    tris[p.f] -= p.cat.tris;
    if (p.host) p.host.tops = (p.host.tops || 1) - 1;
    // a rug left under a removed coffee table is fine; chairs of a removed table are removed with it by the next passes if they block
    removed++;
  }
  // (a piece standing on a removed one goes with it: tops are placed after their hosts, so the walk removes them first; this is the guard)
  for (let k = furn.length - 1; k >= 0; k--) if (furn[k].host && !furn.includes(furn[k].host)) { const p = furn[k], l = p.room._ps, q = l.indexOf(p); if (q >= 0) l.splice(q, 1); if (p.room._rw) p.room._rw.stale = true; tris[p.f] -= p.cat.tris; furn.splice(k, 1); removed++; }
  if (removed) notes.push("walk: removed " + removed + " piece(s) that closed a path");

  // ---- loot points: furniture tops first (front edge, reachable), then free floor spots; chests on their slots
  const loot = [], underM = [];
  // (Wave 9) a door leaf's swing quarter disc (+ 0.15 m: the item's own size) is no place for floor loot: the leaf would sweep it / stand on it
  const inSwing = (f, u, v) => {
    const rr = (SWING_R + 0.15) * (SWING_R + 0.15);
    for (const D of leafDiscs) if (D.f === f && (u - D.hu) * D.qu > -0.15 && (v - D.hv) * D.qv > -0.15 && (u - D.hu) * (u - D.hu) + (v - D.hv) * (v - D.hv) < rr) return true;
    return false;
  };
  const underMask = (f) => {                               // the walk samples within 0.25 m of a piece's footprint, per floor (once)
    if (underM[f]) return underM[f];
    const m = new Uint8Array(NS);
    for (const p of furn) {
      if (p.f !== f || p.cat.deco) continue;
      const a0 = Math.max(0, Math.ceil((p.rect[0] - 0.25 + W / 2 + RING) / GRID - 0.5)), a1 = Math.min(NU - 1, Math.floor((p.rect[2] + 0.25 + W / 2 + RING) / GRID - 0.5));
      const b0 = Math.max(0, Math.ceil((p.rect[1] - 0.25 + D / 2 + RING) / GRID - 0.5)), b1 = Math.min(NV - 1, Math.floor((p.rect[3] + 0.25 + D / 2 + RING) / GRID - 0.5));
      for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) m[b * NU + a] = 1;
    }
    underM[f] = m;
    return m;
  };
  (() => {                                                   // (loot: own function, see above)
  for (const R of roomRecs) {
    const f = R.floor, area = R.cells.length * U * U;
    let want = R.kind === "hall" ? (rng() < 0.3 ? 1 : 0) : 1 + (area >= 15 ? 1 : 0) + (area >= 35 ? 1 : 0);
    // (not on a washbasin, a stool, a bath: NOHOST; nor on a piece carrying another or hung on the wall)
    // (not on a top a planner could "climb" to over a low neighbour - a carton beside a crate makes two 0.45 m steps: the walker is sent up a
    // staircase it cannot climb, interiorcheck's loot-reach planned exactly that)
    // (and not beside any other top a planner could hop across from - two tops within 0.5 m of height: a basin beside a washer)
    const climbable = (p) => furn.some((q) => q !== p && q.f === p.f && !q.cat.deco && !q.slot && (q.y0 || 0) + (q.cat.lowTop != null ? q.cat.lowTop : q.cat.h) > 0.2 && Math.abs(p.cat.surface - ((q.y0 || 0) + (q.cat.lowTop != null ? q.cat.lowTop : q.cat.h))) <= 0.6 &&
      q.rect[0] < p.rect[2] + 0.8 && p.rect[0] < q.rect[2] + 0.8 && q.rect[1] < p.rect[3] + 0.8 && p.rect[1] < q.rect[3] + 0.8);     // (0.8: a top holds a walker 0.3 m past its edge)
    // (nor beside a stair: a ramp passes every height between two floors, a planner steps from it onto the top)
    const nearStair = (p) => stairRecs.some((sr) => (sr.f === p.f || sr.f + 1 === p.f) && sr.lr[0] < p.rect[2] + 1.5 && p.rect[0] < sr.lr[1] + 1.5 && sr.lr[2] < p.rect[3] + 1.5 && p.rect[1] < sr.lr[3] + 1.5) ||
      boxes.some((b) => b.p === "rail" && b.fl === p.f && b.u0 < p.rect[2] + 1.5 && p.rect[0] < b.u1 + 1.5 && b.v0 < p.rect[3] + 1.5 && p.rect[1] < b.v1 + 1.5);      // (a stairwell's 1 m rail: one more step)
    const tops = shuffle(rng, furn.filter((p) => p.room === R && p.cat.surface && !p.slot && !p.tops && !p.y0 && !NOHOST.has(p.cat.id) && !(p.cat.surface > 0.55 && (climbable(p) || nearStair(p)))));
    for (const p of tops) {
      if (want <= 0) break;
      const dir = FACE[p.fq], hd = (p.fq % 2 ? p.rect[2] - p.rect[0] : p.rect[3] - p.rect[1]) / 2;
      const inset = Math.min(0.3, hd);
      const u = p.u + dir[0] * (hd - inset), v = p.v + dir[1] * (hd - inset);
      if (sampleNear(wk, f, u, v, REACH_XZ - 0.25, true) < 0) continue;
      loot.push({ room: R, f, u, v, y: s[f] + p.cat.surface, on: p.cat.id });
      want--;
    }
    // floor spots: reachable samples in the room, spread out
    // (never under or inside a piece: a coffee table, a pallet or a rug's crate is stepped over by the walk - its footprint is not floor to lie on)
    const um = underMask(f);
    const spots = [];
    for (const [i, j] of R.cells) {
      const cu = (uL(i) + uL(i + 1)) / 2, cv = (vL(j) + vL(j + 1)) / 2;
      // the reached sample nearest the cell's middle that is free floor (within 1.2 m): samples visited nearest first (SPOT_OFFS)
      const ac = Math.floor((cu + W / 2 + RING) / GRID), bc = Math.floor((cv + D / 2 + RING) / GRID), se = wk.seen[f], rg = regS[f];
      for (const [da, db] of SPOT_OFFS) {
        const a = ac + da, b = bc + db;
        if (a < 0 || b < 0 || a >= NU || b >= NV) continue;
        const k = b * NU + a;
        if (se[k] && rg[k] === R.ri && !um[k] && !inSwing(f, su(a), sv(b))) { spots.push(k); break; }
      }
    }
    shuffle(rng, spots);
    for (const k of spots) {
      if (want <= 0) break;
      const a = k % NU, b = (k - a) / NU, u = su(a), v = sv(b);
      if (um[k]) continue;
      if (loot.some((l) => l.f === f && (l.u - u) * (l.u - u) + (l.v - v) * (l.v - v) < 1.5 * 1.5)) continue;
      loot.push({ room: R, f, u, v, y: s[f], on: "floor" });
      want--;
    }
  }
  })();
  for (const p of furn) if (p.slot) {
    if (sampleNear(wk, p.f, p.u, p.v, REACH_XZ - 0.25, true) >= 0) chests.push({ room: p.room, f: p.f, u: p.u, v: p.v, y: s[p.f] });
  }

  // ======================================================================== world output
  const c = COS[P.turn], sn = SIN[P.turn];
  const wp = (u, v) => [r3(P.cx + u * c + v * sn), r3(P.cz - u * sn + v * c)];
  const wbox = (u0, u1, y0b, y1b, v0, v1) => {
    const A = wp(u0, v0), B = wp(u1, v1);
    return { min: [Math.min(A[0], B[0]), r3(y0b), Math.min(A[1], B[1])], max: [Math.max(A[0], B[0]), r3(y1b), Math.max(A[1], B[1])] };
  };
  const wdir = (du, dv) => [du * c + dv * sn, -du * sn + dv * c];
  // local face order [+u -u +y -y +v -v] -> world [+x -x +y -y +z -z]
  const faceMap = (() => {
    const m = new Array(6);
    const set = (local, d) => { const [dx, dz] = d; m[dx > 0.5 ? 0 : dx < -0.5 ? 1 : dz > 0.5 ? 4 : 5] = local; };
    set(0, wdir(1, 0)); set(1, wdir(-1, 0)); set(4, wdir(0, 1)); set(5, wdir(0, -1));
    m[2] = 2; m[3] = 3;
    return m;
  })();
  const outBoxes = boxes.map((b) => {
    const wb = wbox(b.u0, b.u1, b.y0, b.y1, b.v0, b.v1);
    let hw = 0; for (let w = 0; w < 6; w++) if (b.h & (1 << faceMap[w])) hw |= 1 << w;
    const ob = { p: b.p, min: wb.min, max: wb.max, f: faceMap.map((li) => b.f[li]), h: hw, c: b.c, fl: b.fl };
    if (b.ns) ob.ns = 1;                                  // (K1 re-run: a ruin's wreckage - drawn without a shadow; absent on every other box)
    return ob;
  });
  // furniture: kit entries and authored boxes
  const furniture = [];
  (() => {                                                   // (furniture records: own function)
  for (const p of furn) {
    if (p.slot) continue;
    const cat = p.cat, wq = (P.turn + p.fq) % 4;
    // a drawn-only kit rug thicker than 2 cm (rugSquare: 2.2 cm) is sunk into its slab so <= 2 cm shows above the floor (the visual tolerance)
    const ys = s[p.f] + (p.y0 || 0) - (cat.deco && cat.src === "kit" && cat.h > 0.02 ? r3(cat.h - 0.02) : 0);
    const wb = wbox(p.rect[0], p.rect[2], ys, ys + cat.h, p.rect[1], p.rect[3]);
    const [wx, wz] = wp(p.u, p.v);
    const rec = { id: P.id + ".p" + furniture.length, type: cat.type, cat: cat.id, src: cat.src, room: p.room.id, floor: p.f, x: wx, z: wz, y: r3(s[p.f]), turn: wq, min: wb.min, max: wb.max, tris: cat.tris };
    p._rid = rec.id;
    if (p.host) { rec.mount = "top"; rec.on = p.host._rid; }                      // stands on that piece's top (rec.min[1] = its surface)
    else if (p.y0) rec.mount = "wall";                                              // hung on the wall, rec.min[1] above the floor (a wall cabinet)
    if (cat.src === "kit") {
      const kb = KIT_BOXES[cat.type], bcx = (kb.min[0] + kb.max[0]) / 2, bcz = (kb.min[2] + kb.max[2]) / 2;
      const [ox, oz] = rotQ(wq, bcx, bcz);                  // the manifest origin = the footprint centre minus the rotated bbox centre
      rec.kit = { type: cat.type, x: r3(wx - ox), y: r3(ys), z: r3(wz - oz), rot: wq };
    } else {
      const A = AUTH[cat.auth || cat.id], parts = [];
      // hidden faces (world bits): a plate draws one face (a rug its top; a picture its face, local +z -> world FACE[wq]); a box resting on the floor or
      // on its host's top does not draw its bottom (the selftest proves each hidden bottom lies at the piece's own base)
      const fz = FACE[wq], frontBit = fz[0] > 0.5 ? 0 : fz[0] < -0.5 ? 1 : fz[1] > 0.5 ? 4 : 5;
      for (const pt of A.parts) {
        // piece frame (x across, z front) -> house local (fq) -> world
        const P0 = rotQ(p.fq, pt[0] - A.ox, pt[2] - A.oz), P1 = rotQ(p.fq, pt[3] - A.ox, pt[5] - A.oz);
        const u0 = p.u + Math.min(P0[0], P1[0]), u1 = p.u + Math.max(P0[0], P1[0]), v0 = p.v + Math.min(P0[1], P1[1]), v1 = p.v + Math.max(P0[1], P1[1]);
        const wb2 = wbox(u0, u1, ys + pt[1], ys + pt[4], v0, v1);
        const col = pt[7] || p.tint || 0x9a6b43;
        const pi = pal(pt[6], col);
        const hb = A.plate === "y" ? 63 & ~4 : A.plate === "z" ? 63 & ~(1 << frontBit) : pt[1] === 0 && !A.mountY ? 8 : 0;
        outBoxes.push({ p: A.deco ? "deco" : "furn", min: wb2.min, max: wb2.max, f: [pi, pi, pi, pi, pi, pi], h: hb, c: 0, fl: p.f });
        parts.push(outBoxes.length - 1);
      }
      rec.parts = parts;
      if (!A.deco) {
        // collider groups: each = the AABB of its parts
        rec.cols = A.cols.map((g) => {
          let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
          for (const k of g) { const bb = outBoxes[parts[k]]; for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], bb.min[a]); mx[a] = Math.max(mx[a], bb.max[a]); } }
          return { min: mn, max: mx };
        });
      } else rec.cols = [];
    }
    if (cat.deco) { rec.deco = true; rec.cols = []; }
    furniture.push(rec);
  }
  })();
  // ramps (world): dir from the local rising direction
  const outRamps = ramps.map((rp) => {
    const wb = wbox(rp.lr[0], rp.lr[1], rp.y0, rp.y1, rp.lr[2], rp.lr[3]);
    const [dx, dz] = wdir(rp.rise[0], rp.rise[1]);
    const o = { min: wb.min, max: wb.max, dir: dx > 0.5 ? 0 : dx < -0.5 ? 1 : dz > 0.5 ? 2 : 3, floor: rp.floor };
    if (rp.roof) o.roof = true;
    return o;
  });
  // pitched roofs (world): the drawn planks (geometry = their ramp's plank: walk line +- hv) and the end-wall polygons
  const roofs2 = [], gables2 = [];
  ramps.forEach((rp, k) => {
    if (!rp.roof) return;
    const rising = rp.rise[0] + rp.rise[1] > 0;           // the local rising direction is +u / +v (the plank's b0 end is its low end)
    const soffit = rp.soff.map((q) => { const w = wbox(q[0], q[1], 0, 0, q[2], q[3]); return [w.min[0], w.min[2], w.max[0], w.max[2]]; });
    roofs2.push({ ramp: k, freeLow: rising ? rp.free[0] : rp.free[1], freeHigh: rising ? rp.free[1] : rp.free[0], soffit, top: rp.pTop, edge: rp.pEdge });
  });
  for (const g of roofGables) {
    const pts = g.pts.map(([t, y]) => { const [x, z] = g.axisU ? wp(g.at, t) : wp(t, g.at); return [x, r3(y), z]; });
    const [nxw, nzw] = g.axisU ? wdir(g.n, 0) : wdir(0, g.n);
    gables2.push({ pts, n: [Math.round(nxw), 0, Math.round(nzw)], pal: g.pal });
  }
  // rooms
  const rooms2 = roomRecs.map((R) => {
    const [i0, j0, i1, j1] = R.bounds;
    const wb = wbox(uL(i0) + JAMB, uL(i1) - JAMB, s[R.floor], s[R.floor + 1] - SLAB, vL(j0) + JAMB, vL(j1) - JAMB);
    const cu = R.cells.reduce((a, q) => a + uL(q[0]) + U / 2, 0) / R.cells.length, cv = R.cells.reduce((a, q) => a + vL(q[1]) + U / 2, 0) / R.cells.length;
    const [wx, wz] = wp(cu, cv);
    const rects = R.cells.map(([i, j]) => { const cb = wbox(uL(i), uL(i + 1), 0, 0, vL(j), vL(j + 1)); return [cb.min[0], cb.min[2], cb.max[0], cb.max[2]]; });
    // the room's entrances as the view model saw them: where a player stands when the room first reads (eye 1.62 m up) and how many pieces it shows
    const V = roomView(R), cnt = viewCounts(R);
    const views = V.ents.map((e, ei) => { const [ex, ez] = wp(e.u, e.v); return { door: e.door ? P.id + ".d" + doors.indexOf(e.door) : null, stair: e.stair ? P.id + ".s" + stairRecs.indexOf(e.stair) : null, x: ex, z: ez, dir: wdir(e.fu, e.fv).map(r3), seen: cnt[ei] }; });
    return { id: R.id, floor: R.floor, kind: R.kind, cells: R.cells, rects, x0: wb.min[0], z0: wb.min[2], x1: wb.max[0], z1: wb.max[2], cx: wx, cz: wz, y: r3(s[R.floor]), ceil: r3(s[R.floor + 1] - SLAB), area: r3(R.cells.length * U * U), doors: [], stairs: [], views };
  });
  const roomById = new Map(rooms2.map((r) => [r.id, r]));
  const roomIdOf = (f, ri) => (ri == null ? null : roomOfReg.get(f + ":" + ri).id);
  const doors2 = doors.map((d, k) => {
    const g = doorGeo(d), [wx, wz] = wp(g.u, g.v);
    // normal: a -> b for interior (a is the -u / -v side region), outward for exterior
    let nu = g.nu, nv = g.nv;
    const ra = roomIdOf(d.floor, d.a), rb = d.b == null ? null : roomIdOf(d.floor, d.b);
    if (d.kind === "interior") {
      const F = floors[d.floor];
      const cMinus = d.ori === "H" ? cellAt(d.i, d.j - 1) : cellAt(d.i - 1, d.j);
      if (F.region[cMinus] !== d.a) { nu = -nu; nv = -nv; }
    } else {
      const cPlus = d.ori === "H" ? cellAt(d.i, d.j) : cellAt(d.i, d.j);
      const plusInside = cPlus >= 0 && floors[0].type[cPlus] !== 0;
      if (plusInside) { nu = -nu; nv = -nv; }
    }
    const [wnx, wnz] = wdir(nu, nv);
    const rec = { id: P.id + ".d" + k, floor: d.floor, kind: d.kind, rooms: [ra, rb], x: wx, z: wz, y: r3(s[d.floor]), width: r3(DOOR_CLEAR), height: DOOR_H,
      axis: (d.ori === "H") === (P.turn % 2 === 0) ? "x" : "z", nx: wnx, nz: wnz };
    if (d.kind !== "interior") rec.out = wp(g.u + nu * 1.2, g.v + nv * 1.2);
    if (ra) roomById.get(ra).doors.push(rec.id);
    if (rb) roomById.get(rb).doors.push(rec.id);
    return rec;
  });
  // (Wave 9, LC-91) the door leaves, world frame. Per leaf: its door's id and kind, leaf 0 | 1, the floor, y (the floor surface), w (LEAF_LEN) x h (LEAF_H) x t
  // (LEAF_T), the hinge (the jamb face's inner corner) [x, z], tdir (from the hinge toward the opening's middle) and n (into the room it swings into: the
  // swing side), r (SWING_R: the quarter disc kept clear), closed / open { min, max } (the two slab colliders, axis-aligned), pal (palette index of its wood),
  // and the DRAWN leaf's swing: one model (X from LEAF_PIVOT.x0 to + w along the leaf, Z from hand * LEAF_PIVOT.z0 to hand * (z0 + t)) rotated about `pivot`
  // [x, z] by yaw q0 * 90 degrees when closed and (q0 + swing) * 90 degrees when open (three's Y rotation: local +X -> (cos, -sin)); hand = swing.
  const doorLeaves2 = leafL.map((L) => {
    const tu = L.along === "u" ? L.td : 0, tv = L.along === "u" ? 0 : L.td, nu = L.along === "u" ? 0 : L.side, nv = L.along === "u" ? L.side : 0;
    const tw = wdir(tu, tv).map((q) => Math.round(q)), nw = wdir(nu, nv).map((q) => Math.round(q));
    const q0 = tw[0] > 0 ? 0 : tw[1] < 0 ? 1 : tw[0] < 0 ? 2 : 3;
    const swing = nw[0] === -tw[1] && nw[1] === tw[0] ? -1 : 1;
    const hu = L.along === "u" ? L.th : L.face, hv = L.along === "u" ? L.face : L.th;
    const pt = L.th + L.td * LEAF_PIVOT.t, pc = L.line + L.side * LEAF_PIVOT.c;
    const pu = L.along === "u" ? pt : pc, pv = L.along === "u" ? pc : pt;
    const C = L.closed, O = L.open;
    return { door: P.id + ".d" + L.k, leaf: L.l, kind: L.d.kind, floor: L.f, y: r3(L.sf), w: LEAF_LEN, h: LEAF_H, t: LEAF_T, hinge: wp(hu, hv), tdir: tw, n: nw, r: SWING_R,
      pivot: wp(pu, pv), q0, swing, closed: wbox(C[0], C[1], C[2], C[3], C[4], C[5]), open: wbox(O[0], O[1], O[2], O[3], O[4], O[5]), pal: P_LEAF };
  });
  { const nl = new Map(); for (const L of doorLeaves2) nl.set(L.door, (nl.get(L.door) || 0) + 1); for (const d of doors2) d.leaves = nl.get(d.id) || 0; }
  const windows2 = winGeo.map((w, k) => {
    const mid = (w.o0 + w.o1) / 2;
    const [wx, wz] = w.along === "u" ? wp(mid, w.line) : wp(w.line, mid);
    const [wnx, wnz] = wdir(w.nu, w.nv);
    const ro = roomAt(w.f, w.cell);
    return { id: P.id + ".w" + k, floor: w.f, room: ro ? ro.id : null, x: wx, z: wz, sill: r3(s[w.f] + SILL), head: r3(s[w.f] + HEAD), width: r3(WIN_W),
      axis: (w.along === "u") === (P.turn % 2 === 0) ? "x" : "z", nx: wnx, nz: wnz };
  });
  const stairs2 = stairRecs.map((sr, k) => {
    const cm = (sr.across0 + sr.across1) / 2;
    const L = (t) => (sr.sp.axis === "col" ? wp(cm, t) : wp(t, cm));
    const ft = L(sr.foot), tp = L(sr.top);
    const ap = cellRect(...sr.approach), ex = cellRect(...sr.exit);
    const rp = outRamps[k];
    const hb = wbox(sr.holeR[0], sr.holeR[2], 0, 0, sr.holeR[1], sr.holeR[3]);
    const rec = { id: P.id + ".s" + k, from: sr.f, to: sr.f + 1, x0: rp.min[0], z0: rp.min[2], x1: rp.max[0], z1: rp.max[2], foot: [ft[0], r3(s[sr.f]), ft[1]], top: [tp[0], r3(s[sr.f + 1]), tp[1]],
      approach: wp((ap[0] + ap[2]) / 2, (ap[1] + ap[3]) / 2), exit: wp((ex[0] + ex[2]) / 2, (ex[1] + ex[3]) / 2), rise: r3(sr.rise), run: r3(sr.run), width: r3(sr.across1 - sr.across0),
      slopeDeg: STAIR_DEG[r3(sr.rise)] || null, dir: rp.dir, hole: [hb.min[0], hb.min[2], hb.max[0], hb.max[2]], steps: sr.N, riser: r3(sr.rs),
      approachRoom: (roomAt(sr.f, cIdx(...sr.approach)) || {}).id || null, exitRoom: (roomAt(sr.f + 1, cIdx(...sr.exit)) || {}).id || null };
    if (rec.approachRoom) roomById.get(rec.approachRoom).stairs.push(rec.id);
    if (rec.exitRoom) roomById.get(rec.exitRoom).stairs.push(rec.id);
    return rec;
  });
  const rails2 = outBoxes.filter((b) => b.p === "rail").map((b) => ({ floor: b.fl, x0: b.min[0], z0: b.min[2], x1: b.max[0], z1: b.max[2], y0: b.min[1], y1: b.max[1] }));
  const loot2 = loot.map((l, k) => { const [wx, wz] = wp(l.u, l.v); return { id: P.id + ".l" + k, room: l.room.id, floor: l.f, x: wx, y: r3(l.y), z: wz, on: l.on }; });
  const chests2 = chests.map((l, k) => { const [wx, wz] = wp(l.u, l.v); return { id: P.id + ".c" + k, room: l.room.id, floor: l.f, x: wx, y: r3(l.y), z: wz }; });
  // the walked samples of each floor as row spans per room (region): [b, a0, a1]
  const spanCache = new Map();
  const walkSpans = (f) => {
    if (spanCache.has(f)) return spanCache.get(f);
    const out = new Map(), seenF = wk.seen[f], reg = floors[f].region;
    for (let b = 0; b < NV; b++) {
      let a = 0;
      while (a < NU) {
        const k = b * NU + a, c = sCell[k], ri = c >= 0 && seenF[k] ? reg[c] : -1;
        if (ri < 0) { a++; continue; }
        let a1 = a; while (a1 + 1 < NU && seenF[k + a1 + 1 - a] && sCell[k + a1 + 1 - a] >= 0 && reg[sCell[k + a1 + 1 - a]] === ri) a1++;
        if (!out.has(ri)) out.set(ri, []);
        out.get(ri).push([b, a, a1]); a = a1 + 1;
      }
    }
    spanCache.set(f, out);
    return out;
  };
  // nav: a node per room (its reachable sample nearest the centroid), per door, per stair end; links through doors and stairs
  const nodes = [], links = [];
  const roomNode = new Map();
  (() => {                                                   // (nav nodes / walk rects: own function)
  for (const R of roomRecs) {
    const cu = R.cells.reduce((a, q) => a + uL(q[0]) + U / 2, 0) / R.cells.length, cv = R.cells.reduce((a, q) => a + vL(q[1]) + U / 2, 0) / R.cells.length;
    // (round 3: the room node is a reached sample near the room's middle with room round it - its 5 x 5 neighbourhood (0.5 m) reached too, else
    // its 3 x 3 - and away from the low pieces a mover steps up onto when it brushes them (a coffee table, an ottoman: tops 0.2-0.55 m): a bot that
    // stops within its arrival radius of it still stands on the room's floor, inside its walkable area)
    let k = -1;
    {
      const se = wk.seen[R.floor], rg = regS[R.floor];
      const lows = furn.filter((p) => p.f === R.floor && !p.cat.deco && !p.y0 && p.cat.h > 0.2 && p.cat.h <= CAPSULE.step + 0.02);
      const ring = (kk, n) => { for (let db = -n; db <= n; db++) for (let da = -n; da <= n; da++) { const q = kk + db * NU + da; if (q < 0 || q >= NS || !se[q] || rg[q] !== R.ri) return false; } return true; };
      let bd = Infinity;
      for (const [i, j] of R.cells) {
        const a0 = Math.max(2, Math.floor((uL(i) + W / 2 + RING) / GRID)), a1 = Math.min(NU - 3, Math.ceil((uL(i + 1) + W / 2 + RING) / GRID));
        const b0 = Math.max(2, Math.floor((vL(j) + D / 2 + RING) / GRID)), b1 = Math.min(NV - 3, Math.ceil((vL(j + 1) + D / 2 + RING) / GRID));
        for (let b = b0; b <= b1; b++) for (let a = a0; a <= a1; a++) {
          const kk = b * NU + a; if (!se[kk] || rg[kk] !== R.ri) continue;
          const x = su(a), z = sv(b), dx = x - cu, dz = z - cv;
          let sc = dx * dx + dz * dz;
          if (sc >= bd) continue;
          if (!ring(kk, 2)) { let c5 = 0; for (let db = -2; db <= 2; db++) for (let da = -2; da <= 2; da++) { const q = kk + db * NU + da; if (q >= 0 && q < NS && se[q] && rg[q] === R.ri) c5++; } sc += (ring(kk, 1) ? 2 : 8) + 0.5 * (25 - c5); }   // (a thin area: its thickest part)
          for (const p of lows) { const ex = Math.max(p.rect[0] - x, 0, x - p.rect[2]), ez = Math.max(p.rect[1] - z, 0, z - p.rect[3]); if (ex * ex + ez * ez < 0.81) { sc += 9; break; } }
          if (sc < bd) { bd = sc; k = kk; }
        }
      }
    }
    if (k < 0) k = sampleNear(wk, R.floor, cu, cv, 0.25, true);
    if (k < 0) for (const [i, j] of R.cells) { k = sampleNear(wk, R.floor, uL(i) + U / 2, vL(j) + U / 2, 1.3, true); if (k >= 0) break; }
    const a = k >= 0 ? k % NU : 0, b = k >= 0 ? (k - a) / NU : 0;
    const [wx, wz] = k >= 0 ? wp(su(a), sv(b)) : wp(cu, cv);
    const nd = { id: R.id, kind: "room", room: R.id, floor: R.floor, x: wx, y: r3(s[R.floor]), z: wz };
    nodes.push(nd); roomNode.set(R.id, nd);
    // the room's WALKABLE area: every 0.25 m sample of its own cells where the generator's (fat, r 0.6) capsule stood on its walk from the street,
    // merged into rectangles (world x0, z0, x1, z1: each sample's 0.25 m square). Bots plan INSIDE a room over these (a room is rarely convex once
    // furnished: a straight line between two of its doors can cross a bed); the room node (nav node x, z) is one of them.
    const spans = walkSpans(R.floor).get(R.ri) || [];
    const rectsL = [];                                     // merge equal spans of consecutive rows
    const open = new Map();
    for (const [b, a0, a1] of spans) {
      const key = a0 + ":" + a1, o = open.get(key);
      if (o && o[3] === b - 1) o[3] = b; else { const r = [a0, b, a1, b]; rectsL.push(r); open.set(key, r); }
    }
    R.walk = rectsL.map(([a0, b0, a1, b1]) => { const q = wbox(su(a0) - GRID / 2, su(a1) + GRID / 2, 0, 0, sv(b0) - GRID / 2, sv(b1) + GRID / 2); return [q.min[0], q.min[2], q.max[0], q.max[2]]; });
    const rr = roomById.get(R.id); rr.walk = R.walk; rr.anchor = [wx, r3(s[R.floor]), wz];
  }
  })();
  nodes.push({ id: P.id + ".street", kind: "street", room: null, floor: 0, x: doors2.find((d) => d.kind === "front").out[0], y: r3(y0), z: doors2.find((d) => d.kind === "front").out[1] });
  const dist3 = (A, B) => Math.sqrt((A[0] - B[0]) * (A[0] - B[0]) + (A[1] - B[1]) * (A[1] - B[1]) + (A[2] - B[2]) * (A[2] - B[2]));
  for (const d of doors2) {
    nodes.push({ id: d.id, kind: "door", room: null, floor: d.floor, x: d.x, y: d.y, z: d.z });
    const A = roomNode.get(d.rooms[0]);
    const from = [r3(d.x - d.nx * 0.6), d.y, r3(d.z - d.nz * 0.6)], to = [r3(d.x + d.nx * 0.6), d.y, r3(d.z + d.nz * 0.6)];
    if (d.kind === "interior") {
      const B = roomNode.get(d.rooms[1]);
      links.push({ type: "door", a: A.id, b: B.id, door: d.id, from, to, width: d.width, cost: r3(dist3([A.x, A.y, A.z], from) + 1.2 + dist3(to, [B.x, B.y, B.z])), bidir: true });
    } else {
      links.push({ type: "exit", a: A.id, b: P.id + ".street", door: d.id, from, to: [d.out[0], r3(y0), d.out[1]], width: d.width, cost: r3(dist3([A.x, A.y, A.z], from) + 1.8), bidir: true });
    }
  }
  for (const st of stairs2) {
    nodes.push({ id: st.id + ".foot", kind: "stair", room: st.approachRoom, floor: st.from, x: st.foot[0], y: st.foot[1], z: st.foot[2] });
    nodes.push({ id: st.id + ".top", kind: "stair", room: st.exitRoom, floor: st.to, x: st.top[0], y: st.top[1], z: st.top[2] });
    links.push({ type: "stair", a: st.approachRoom, b: st.exitRoom, stair: st.id, from: [st.approach[0], st.foot[1], st.approach[1]], to: [st.exit[0], st.top[1], st.exit[1]], width: st.width,
      cost: r3(Math.sqrt(st.run * st.run + st.rise * st.rise) + 2 * U), bidir: true });
  }
  // triangles per storey (structure boxes + furniture) and the house bounds
  const trisF = new Array(S + 1).fill(0);
  for (const b of outBoxes) if (b.p !== "furn" && b.p !== "deco") trisF[b.fl] += faceTris(b.h);
  for (const fr of furniture) trisF[fr.floor] += fr.tris;
  for (const L of doorLeaves2) trisF[L.floor] += LEAF_TRIS;           // (Wave 9: the builder draws each leaf open, 5 faces)
  trisF[S - 1] += roofTrisN;
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  (() => {
  for (const b of outBoxes) { if (b.p === "furn" || b.p === "deco") continue; for (let a = 0; a < 3; a++) { if (b.min[a] < mn[a]) mn[a] = b.min[a]; if (b.max[a] > mx[a]) mx[a] = b.max[a]; } }     // (authored parts: in the furniture loop's bounds)
  for (const rf of roofs2) { const r = outRamps[rf.ramp], hv = rampHalfV(r); for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], r.min[a] - (a === 1 ? hv : 0)); mx[a] = Math.max(mx[a], r.max[a] + (a === 1 ? hv : 0)); } }
  for (const fr of furniture) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], fr.min[a]); mx[a] = Math.max(mx[a], fr.max[a]); }
  })();
  const ctr = [r3((mn[0] + mx[0]) / 2), r3((mn[1] + mx[1]) / 2), r3((mn[2] + mx[2]) / 2)];
  const rad = r3(Math.sqrt((mx[0] - mn[0]) * (mx[0] - mn[0]) + (mx[1] - mn[1]) * (mx[1] - mn[1]) + (mx[2] - mn[2]) * (mx[2] - mn[2])) / 2);
  const sealed = floors.reduce((a, F) => a + F.sealed.length, 0);
  if (sealed) notes.push("sealed rooms: " + sealed);

  for (const r of rooms2) { r.doors.sort(); r.stairs.sort(); }
  return {
    v: VERSION, kit: kitProfile, id: P.id, theme: P.theme, use, seed: P.seed, turn: P.turn, cx: r3(P.cx), cz: r3(P.cz), y0: r3(y0), nx, nz, U, W, D,
    storeys: S, storeysAsked: P.storeysAsked, notes, plan: cut ? "L" : "rect", cut, roof: roofKind, facade: { mat: fMat, color: facadeC }, trim: trimC,
    floors: s.slice(0, S).map((y, f) => ({ f, y: r3(y), ceil: r3(s[f + 1] - SLAB) })),
    rooms: rooms2, doors: doors2, doorLeaves: doorLeaves2, windows: windows2, stairs: stairs2, rails: rails2, palette, boxes: outBoxes, ramps: outRamps, roofs: roofs2, gables: gables2, furniture, loot: loot2, chests: chests2,
    nav: { nodes, links }, tris: { floors: trisF.slice(0, S), shell: trisF[S], total: trisF.reduce((a, b) => a + b, 0) }, fh: FHu, shell,
    aabb: { min: mn.map(r3), max: mx.map(r3) }, lod: { cx: ctr[0], cy: ctr[1], cz: ctr[2], r: rad, furnitureR: 60 },
  };
}

function shadeInt(c, k) {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * k)), g = Math.min(255, Math.round(((c >> 8) & 255) * k)), b = Math.min(255, Math.round((c & 255) * k));
  return (r << 16) | (g << 8) | b;
}

/** towngen's guillotine: split the cell rectangle [i0, j0, i1, j1) into <= k rooms (each >= 2 cells, sides >= 1) */
function guillotine(rng, i0, j0, i1, j1, k) {
  const rooms = [[i0, j0, i1, j1]];
  let guard = 0;
  while (rooms.length < k && guard++ < 24) {
    let best = -1, ba = 0;
    for (let a = 0; a < rooms.length; a++) {
      const r = rooms[a], w = r[2] - r[0], d = r[3] - r[1], area = w * d;
      if (area >= 4 && Math.max(w, d) >= 2 && area > ba) { ba = area; best = a; }
    }
    if (best < 0) break;
    const r = rooms[best], w = r[2] - r[0], d = r[3] - r[1];
    const alongI = w > d ? true : d > w ? false : rng() < 0.5;
    const L = alongI ? w : d;
    const cut = clamp(Math.round(L * (0.38 + 0.24 * rng())), 1, L - 1);
    if (alongI) { rooms[best] = [r[0], r[1], r[0] + cut, r[3]]; rooms.push([r[0] + cut, r[1], r[2], r[3]]); }
    else { rooms[best] = [r[0], r[1], r[2], r[1] + cut]; rooms.push([r[0], r[1] + cut, r[2], r[3]]); }
  }
  return rooms;
}

// ── moving a house up or down (pure) ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** translateY(house, dy) -> house: the same house standing dy higher (a NEW object; the input is not changed). generate() is a pure function of the parcel and
 *  every height in its output is the pad height plus a term that does not depend on it, so generate({ ...parcel, y }) and translateY(generate({ ...parcel, y: 0 }), y)
 *  agree to the rounding (1 mm; the selftest proves it field by field). Stage B (maps.js) generates at y 0 to learn the footprint the pad must cover (porches,
 *  stoops), lays the pad, then moves the house onto it. Every y-valued field is listed here; nothing else is touched. */
export function translateY(H, dy) {
  const q = (v) => r3(v + dy);
  const v3 = (a) => [a[0], q(a[1]), a[2]];
  const mm = (o) => Object.assign({}, o, { min: v3(o.min), max: v3(o.max) });
  const out = Object.assign({}, H);
  out.y0 = q(H.y0);
  out.floors = H.floors.map((f) => Object.assign({}, f, { y: q(f.y), ceil: q(f.ceil) }));
  out.rooms = H.rooms.map((r) => Object.assign({}, r, { y: q(r.y), ceil: q(r.ceil), anchor: v3(r.anchor) }));
  out.doors = H.doors.map((d) => Object.assign({}, d, { y: q(d.y) }));
  out.doorLeaves = (H.doorLeaves || []).map((L) => Object.assign({}, L, { y: q(L.y), closed: mm(L.closed), open: mm(L.open) }));
  out.windows = H.windows.map((w) => Object.assign({}, w, { sill: q(w.sill), head: q(w.head) }));
  out.stairs = H.stairs.map((s) => Object.assign({}, s, { foot: v3(s.foot), top: v3(s.top) }));
  out.rails = H.rails.map((r) => Object.assign({}, r, { y0: q(r.y0), y1: q(r.y1) }));
  out.boxes = H.boxes.map(mm);
  out.ramps = H.ramps.map(mm);
  out.gables = (H.gables || []).map((g) => Object.assign({}, g, { pts: g.pts.map(v3) }));
  out.furniture = H.furniture.map((p) => {
    const o = mm(p);
    o.y = q(p.y);
    if (p.kit) o.kit = Object.assign({}, p.kit, { y: q(p.kit.y) });
    if (p.cols) o.cols = p.cols.map(mm);
    return o;
  });
  out.loot = H.loot.map((l) => Object.assign({}, l, { y: q(l.y) }));
  out.chests = H.chests.map((c) => Object.assign({}, c, { y: q(c.y) }));
  out.nav = { nodes: H.nav.nodes.map((n) => Object.assign({}, n, { y: q(n.y) })), links: H.nav.links.map((l) => Object.assign({}, l, { from: v3(l.from), to: v3(l.to) })) };
  out.aabb = { min: v3(H.aabb.min), max: v3(H.aabb.max) };
  out.lod = Object.assign({}, H.lod, { cy: q(H.lod.cy) });
  return out;
}

// ── colliders and kit entries (pure) ───────────────────────────────────────────────────────────────────────────────────────────────────
function mkColliderDefault(kind, minX, maxX, minY, maxY, minZ, maxZ, dir, prop, idx, hp) {
  return { kind, minX, maxX, minY, maxY, minZ, maxZ, dir, prop, idx, hp, dead: false, _qs: 0, door: -1, dslab: 0 };    // maps.js mkCollider: one hidden class (C1: door / dslab on every collider)
}
/** every collider of the house in a fixed order: structure boxes (c = 1), ramps, furniture collider groups, then (Wave 9, LC-91) the door leaves' slabs - per
 *  H.doorLeaves entry its CLOSED slab (dslab 1) then its OPEN slab (dslab 2), door = the ordinal of its door among the house's leafed doors (maps.js adds the
 *  map's base: the index into map.doors). The start state here is OPEN (contract C1's all-open fallback): every closed slab is dead; maps.js applies the
 *  map's start state (K.DOOR_START). opts.doors false: no leaf slabs (the house as it was before Wave 9 - nothing in the game asks for that). */
export function collidersOf(H, mk, opts) {
  mk = mk || mkColliderDefault;
  const out = [];
  for (const b of H.boxes) if (b.c) out.push(mk("box", b.min[0], b.max[0], b.min[1], b.max[1], b.min[2], b.max[2], -1, null, -1, 0));
  for (const r of H.ramps) out.push(mk("ramp", r.min[0], r.max[0], r.min[1], r.max[1], r.min[2], r.max[2], r.dir, null, -1, 0));
  for (const p of H.furniture) {
    if (p.deco) continue;
    if (p.src === "kit") out.push(mk("box", p.min[0], p.max[0], p.min[1], p.max[1], p.min[2], p.max[2], -1, null, -1, 0));
    else for (const g of p.cols) out.push(mk("box", g.min[0], g.max[0], g.min[1], g.max[1], g.min[2], g.max[2], -1, null, -1, 0));
  }
  if (!(opts && opts.doors === false)) {
    let di = -1, last = null;
    for (const L of H.doorLeaves || []) {
      if (L.door !== last) { di++; last = L.door; }
      for (const [st, bx] of [[1, L.closed], [2, L.open]]) {
        const c = mk("box", bx.min[0], bx.max[0], bx.min[1], bx.max[1], bx.min[2], bx.max[2], -1, null, -1, 0);
        c.door = di; c.dslab = st; c.dead = st === 1;
        out.push(c);
      }
    }
  }
  return out;
}
/** (Wave 9) the number of door-leaf slab colliders collidersOf appends (2 per leaf) */
export function leafColliderCount(H) { return 2 * ((H && H.doorLeaves) || []).length; }
/** the kit furniture as citykit.place() entries (x y z = the manifest origin at the floor, rot = quarter-turn index) */
export function kitEntries(H, district) {
  const out = [];
  for (const p of H.furniture) if (p.src === "kit") out.push({ type: p.kit.type, x: p.kit.x, y: p.kit.y, z: p.kit.z, rot: p.kit.rot, district: district || H.id });
  return out;
}

// ── the builder (view code: THREE is a parameter) ──────────────────────────────────────────────────────────────────────────────────────
const TILE = { lamp: 1.0, stone: 1.4, sheet: 1.2, glass: 1.0, brick: 1.6, plaster: 2.0, stucco: 2.0, plank: 1.6, plank_in: 1.6, floor_wood: 1.6, floor_tile: 1.0, floor_concrete: 2.5, roof: 1.8, roof_flat: 3.0, wood: 0.8, fabric: 0.6, ceramic: 0.5, metal: 1.0 };
const _matCache = new WeakMap();
/** procedural, original textures (canvas, greyscale: the vertex colour tints them). Node (no document) gets untextured materials. */
export function defaultMaterials(THREE) {
  let cache = _matCache.get(THREE);
  if (cache) return cache;
  const mats = new Map();
  const doc = typeof document !== "undefined" ? document : null;
  const tex = (kind) => {
    if (!doc) return null;
    const cv = doc.createElement("canvas"); cv.width = cv.height = 256;
    const g = cv.getContext("2d");
    let seed = hash32(kind);
    const rnd = () => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed / 4294967296; };
    const fill = (v) => { g.fillStyle = "rgb(" + v + "," + v + "," + v + ")"; };
    fill(236); g.fillRect(0, 0, 256, 256);
    const noise = (n, a, b, sz) => { for (let i = 0; i < n; i++) { fill(Math.round(a + (b - a) * rnd())); g.fillRect(rnd() * 256, rnd() * 256, sz, sz); } };
    if (kind === "brick") {
      fill(200); g.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 8; row++) for (let col = -1; col < 4; col++) { fill(Math.round(222 + 30 * rnd())); g.fillRect(col * 64 + (row % 2) * 32 + 2, row * 32 + 2, 60, 28); }
      noise(900, 190, 255, 2);
    } else if (kind === "plank" || kind === "plank_in" || kind === "floor_wood") {
      const n = kind === "floor_wood" ? 6 : 8;
      for (let k = 0; k < n; k++) { fill(Math.round(205 + 40 * rnd())); if (kind === "floor_wood") g.fillRect(k * 256 / n + 1, 0, 256 / n - 2, 256); else g.fillRect(0, k * 256 / n + 1, 256, 256 / n - 2); }
      g.globalAlpha = 0.25; for (let i = 0; i < 160; i++) { fill(Math.round(150 + 60 * rnd())); if (kind === "floor_wood") g.fillRect(rnd() * 256, rnd() * 256, 1, 18 + rnd() * 40); else g.fillRect(rnd() * 256, rnd() * 256, 18 + rnd() * 40, 1); } g.globalAlpha = 1;
      if (kind === "floor_wood") for (let k = 0; k < n; k++) { fill(170); g.fillRect(k * 256 / n + 1, Math.round(rnd() * 256), 256 / n - 2, 2); }
    } else if (kind === "floor_tile") {
      fill(196); g.fillRect(0, 0, 256, 256);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { fill(Math.round(232 + 18 * rnd())); g.fillRect(a * 64 + 2, b * 64 + 2, 60, 60); }
      noise(300, 220, 255, 2);
    } else if (kind === "stone") {
      fill(190); g.fillRect(0, 0, 256, 256);
      for (let row = 0; row < 6; row++) { let x = -Math.floor(rnd() * 40); while (x < 256) { const w = 34 + Math.floor(rnd() * 40); fill(Math.round(205 + 45 * rnd())); g.fillRect(x + 2, row * 43 + 2, w - 3, 39); x += w; } }
      noise(1500, 170, 255, 2);
    } else if (kind === "sheet") {
      for (let x = 0; x < 256; x += 16) { fill(240); g.fillRect(x, 0, 8, 256); fill(200); g.fillRect(x + 8, 0, 3, 256); fill(222); g.fillRect(x + 11, 0, 5, 256); }
      noise(500, 200, 250, 2);
    } else if (kind === "roof") {
      for (let row = 0; row < 10; row++) for (let col = -1; col < 9; col++) { fill(Math.round(170 + 60 * rnd())); g.fillRect(col * 30 + (row % 2) * 15, row * 26, 28, 24); }
    } else if (kind === "fabric") {
      for (let y = 0; y < 256; y += 4) { fill(228 + (y % 8 ? 10 : 0)); g.fillRect(0, y, 256, 2); }
      noise(800, 215, 255, 1);
    } else if (kind === "wood") {
      for (let y = 0; y < 256; y += 2) { fill(Math.round(214 + 26 * Math.abs(Math.sin(y * 0.11 + 2 * Math.sin(y * 0.023))))); g.fillRect(0, y, 256, 2); }
    } else {
      noise(kind === "floor_concrete" || kind === "roof_flat" ? 3000 : 1400, 212, 255, kind === "stucco" ? 3 : 2);
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const get = (key) => {
    let m = mats.get(key);
    if (m) return m;
    const rough = key === "ceramic" ? 0.25 : key === "metal" ? 0.45 : key === "floor_tile" ? 0.5 : 0.85;
    m = key === "glass" ? new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false, roughness: 0.05, metalness: 0 })
      : key === "lamp" ? new THREE.MeshBasicMaterial({ vertexColors: true })                 // a lit ceiling panel: drawn at full brightness
      : new THREE.MeshStandardMaterial({ vertexColors: true, map: tex(key), roughness: rough, metalness: key === "metal" ? 0.5 : 0 });
    m.name = "housegen:" + key;
    mats.set(key, m);
    return m;
  };
  cache = { get, mats };
  _matCache.set(THREE, cache);
  return cache;
}

// ── wear (parity P2-I, LC-17) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// The audit: every house wall was one flat value from the pavement to the eaves - no splash grime at the foot, no shadowed band under the eaves, so a street read as
// clean plastic boxes. wearBands lays two thin overlay strips (WEAR_OFF in front of the face, the face's own material, colour and uv - no new material, program
// or draw call: they join the face's material group) on every OUTSIDE wall face of the house:
//   foot   the ground storey's faces that reach the slab: 0 .. WEAR_FOOT[0] m above the ground floor at WEAR_K[0] .. WEAR_K[1] of the wall colour, then a fade to the
//          wall colour at WEAR_FOOT[1] m (linear working-space colour: the band 0 .. WEAR_FOOT[1] reads 15-25 % darker on screen, the LC-17 gate)
//   eave   the top storey's faces that reach its ceiling: a fade from the wall colour WEAR_EAVE m under the top to WEAR_K[2] at it
// Appended after every box's 24 vertices (boxRanges unchanged); meshData(..., { wear: false | "low" }) leaves them out (WEAR_BY_TIER). 2-4 triangles a face; nothing collides.
const WEAR_MATS = { brick: 1, plaster: 1, stucco: 1, plank: 1, stone: 1, sheet: 1 };
const WEAR_PARTS = { wall: 1, skin: 1, shell: 1, slab: 1, gable: 1 };
export const WEAR_FOOT = [0.5, 1.15], WEAR_EAVE = 0.7, WEAR_K = [0.44, 0.56, 0.8];
// (P23 / LC-17, the Wave-8 stage-B "crater village does not read as a ruin" look) a RUIN's every broken top is charred: on the outside faces of its walls,
// parapet, stubs, remnants and standing corners that reach the roof line (face top >= the top ceiling), a soot fade from the wall colour WEAR_BURN.h0 ..
// WEAR_BURN.h1 m under the face's top to WEAR_BURN.k at it. Its lower edge is a zig-zag: a depth every ~WEAR_BURN.seg m along the face (a hash of the face and the
// point: ragged, no stream drawn), each piece a trapezoid between two depths (looks: one even band per face read as a shadow under the cornice; square tongues read
// as painted panels). Two pieces deep: 1 -> km over the lower 1 - f of the depth, km -> k over the top f (a charred lip). Drawn only; replaces the eave strip there.
export const WEAR_BURN = { k: 0.1, km: 0.4, f: 0.45, h0: 0.5, h1: 2.7, seg: 1.1 };
const BURN_PARTS = { wall: 1, skin: 1, shell: 1, gable: 1, trim: 1 };
// C-GFX / D10, the per-tier rule for the wear strips AND the ruin soot (draw-only geometry: +10.8 % wall triangles, ~+800 a ruin): OFF on low (not built at all -
// no vertex, no triangle), full on medium / high / ultra. meshData / buildHouse take opts.wear = a tier name ("low" | "medium" | "high" | "ultra") or a boolean
// (false = off, true / undefined = on). The geometry is built with the map, so a map BUILT on low keeps its plain walls until the next build (a tier change mid-match
// does not rebuild the houses); nothing collides, so the world (colliders, loot, MAP_GEN_VERSION) is the same at every tier.
export const WEAR_BY_TIER = Object.freeze({ low: false, medium: true, high: true, ultra: true });
/** wearOn(w): the wear option (tier name | boolean | undefined) -> build the strips? (an unknown tier name = medium: on) */
export function wearOn(w) { return typeof w === "string" ? WEAR_BY_TIER[w] !== false : w !== false; }
const WEAR_OFF = 0.012;
function wearBands(H, groups, acc, faceIn, colOf) {
  const yG = H.floors[0].y, top = H.floors[H.floors.length - 1].ceil;
  const ruin = !!(THEMES[H.theme] && THEMES[H.theme].ruined);
  const hash01 = (b, fi, q) => { let h = 0x811c9dc5; for (const v of [b.min[0], b.min[2], b.max[0], b.max[2], b.max[1], fi, q]) { h ^= Math.round(v * 100) | 0; h = Math.imul(h, 0x01000193); h ^= h >>> 13; } return ((h >>> 0) % 10007) / 10007; };
  const quad = (a, n, P, rgbs, uvAx, tile) => {
    const base = a.pos.length / 3;
    for (let k = 0; k < 4; k++) { const p = P[k]; a.pos.push(p[0], p[1], p[2]); a.nor.push(n[0], n[1], n[2]); a.uv.push(p[uvAx[0]] / tile, p[uvAx[1]] / tile); a.col.push(rgbs[k][0], rgbs[k][1], rgbs[k][2]); }
    a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  const VERT = [[0, [1, 0, 0], [2, 1]], [1, [-1, 0, 0], [2, 1]], [4, [0, 0, 1], [0, 1]], [5, [0, 0, -1], [0, 1]]];
  H.boxes.forEach((b) => {
    const wearP = !!WEAR_PARTS[b.p], burnP = ruin && !!BURN_PARTS[b.p] && b.max[1] >= top - 0.05;
    if (!wearP && !burnP) return;
    for (const [fi, n, uvAx] of VERT) {
      if (b.h & (1 << fi)) continue;
      const pe = H.palette[b.f[fi]];
      if (!pe || !WEAR_MATS[pe.mat] || faceIn(b, fi)) continue;
      const y0 = b.min[1], y1 = b.max[1];
      if (y1 - y0 < (burnP ? 0.1 : 0.3)) continue;                       // (a ruin's charred stub tops: >= 0.1 m)
      const ax = fi >> 1, side = fi & 1 ? b.min[ax] - WEAR_OFF : b.max[ax] + WEAR_OFF;         // the face's plane, nudged out
      const ua = ax === 0 ? 2 : 0, u0 = b.min[ua], u1 = b.max[ua];
      if (u1 - u0 < 0.45) continue;                                    // (not the 0.24 m reveal of an opening or a jamb: 2-4 triangles for a sliver)
      const P = (u, y) => { const p = [0, y, 0]; p[ax] = side; p[ua] = u; return p; };
      // corner order of FACES (counter-clockwise seen from outside): +x / -z run u from max to min, -x / +z from min to max
      const fwd = fi === 1 || fi === 4;
      const strip = (ya, yb, ka, kb, sa, sb) => {                     // (sa .. sb: a part of the face's width, default all of it)
        if (yb - ya < 0.02) return;
        const rgb = colOf(pe.color), ca = [rgb[0] * ka, rgb[1] * ka, rgb[2] * ka], cb = [rgb[0] * kb, rgb[1] * kb, rgb[2] * kb];
        const a0 = sa == null ? u0 : sa, a1 = sb == null ? u1 : sb, ul = fwd ? a0 : a1, ur = fwd ? a1 : a0;
        quad(acc("walls", pe.mat, false), n, [P(ul, ya), P(ur, ya), P(ur, yb), P(ul, yb)], [ca, ca, cb, cb], uvAx, TILE[pe.mat] || 2);
      };
      let footTop = -1e9;
      if (wearP && y0 <= yG + 0.25 && y1 > yG) {
        const f0 = yG + WEAR_FOOT[0], f1 = yG + WEAR_FOOT[1];
        const kAt = (y) => (y <= f0 ? WEAR_K[0] + (WEAR_K[1] - WEAR_K[0]) * Math.max(0, (y - (yG - FLOOR0 - BASE0))) / (f0 - (yG - FLOOR0 - BASE0)) : y >= f1 ? 1 : WEAR_K[1] + (1 - WEAR_K[1]) * (y - f0) / (f1 - f0));
        const ya = Math.max(y0, yG - FLOOR0 - BASE0), ym = Math.min(y1, f0), yb = Math.min(y1, f1);
        strip(ya, ym, kAt(ya), kAt(ym));
        if (yb > ym) strip(ym, yb, kAt(ym), kAt(yb));
        footTop = yb;
      }
      if (burnP) {                                                     // (a ruin: soot down from the broken top, never over the foot strip)
        const nSeg = Math.max(1, Math.round((u1 - u0) / WEAR_BURN.seg)), sw = (u1 - u0) / nSeg, floor = Math.max(y0, footTop);
        const depth = (q) => WEAR_BURN.h0 + (WEAR_BURN.h1 - WEAR_BURN.h0) * hash01(b, fi, q);
        // the colour at height y of a column whose soot reaches hb down from the top
        const kAt = (y, hb) => { const ym = y1 - hb * WEAR_BURN.f; return y <= ym ? Math.min(1, 1 - (1 - WEAR_BURN.km) * (y - (y1 - hb)) / (hb * (1 - WEAR_BURN.f))) : WEAR_BURN.km - (WEAR_BURN.km - WEAR_BURN.k) * (y - ym) / (hb * WEAR_BURN.f); };
        const rgb = colOf(pe.color), cK = (k) => [rgb[0] * k, rgb[1] * k, rgb[2] * k], tile = TILE[pe.mat] || 2, a = acc("walls", pe.mat, false);
        // a trapezoid from (ua, ya0 .. ya1) to (ub, yb0 .. yb1), corners in the face's winding (as strip): bottom-left, bottom-right, top-right, top-left
        const trap = (ua, ub, ya0, ya1, yb0, yb1, ka0, ka1, kb0, kb1) => {
          if (ya1 - ya0 < 0.01 && yb1 - yb0 < 0.01) return;
          const L = fwd ? [ua, ya0, ya1, ka0, ka1] : [ub, yb0, yb1, kb0, kb1], R = fwd ? [ub, yb0, yb1, kb0, kb1] : [ua, ya0, ya1, ka0, ka1];
          quad(a, n, [P(L[0], L[1]), P(R[0], R[1]), P(R[0], R[2]), P(L[0], L[2])], [cK(L[3]), cK(R[3]), cK(R[4]), cK(L[4])], uvAx, tile);
        };
        let dA = depth(0);
        for (let q = 0; q < nSeg; q++) {
          const dB = depth(q + 1), ua = u0 + q * sw, ub = u0 + (q + 1) * sw;
          const bA = Math.max(floor, y1 - dA), bB = Math.max(floor, y1 - dB), mA = Math.max(bA, y1 - dA * WEAR_BURN.f), mB = Math.max(bB, y1 - dB * WEAR_BURN.f);
          if (y1 - bA >= 0.05 || y1 - bB >= 0.05) {
            trap(ua, ub, bA, mA, bB, mB, kAt(bA, dA), kAt(mA, dA), kAt(bB, dB), kAt(mB, dB));
            trap(ua, ub, mA, y1, mB, y1, kAt(mA, dA), WEAR_BURN.k, kAt(mB, dB), WEAR_BURN.k);
          }
          dA = dB;
        }
        continue;
      }
      if (wearP && y1 >= top - 0.05 && y1 <= top + 0.3 && y0 < top - WEAR_EAVE && top - yG >= WEAR_FOOT[1] + WEAR_EAVE) {        // (a face that ends at the top ceiling; not a tall shell's)
        const e0 = Math.max(y0, top - WEAR_EAVE);
        strip(e0, Math.min(y1, top), 1, WEAR_K[2]);
      }
    }
  });
}

/** meshData(H, colOf, opts?) -> { groups: { walls, furniture, glass }: Map(key -> { pos, nor, uv, col, idx, boxes }), boxRanges }   (pure: no THREE)
 *  The drawn geometry of a house as flat arrays, the one definition buildHouse and the game's integration (maps.js, stage B) both draw from: every box face
 *  not hidden (h bits), the pitched roofs' planks exactly as their ramps collide, the gables' end polygons. key = the palette material ("brick", "floor_wood",
 *  ...); with opts.interior the faces that face INTO the house (both sides of the face centre inside the walls' outer faces and under the top ceiling) are
 *  keyed "<mat>|in" (maps.js darkens them: the sky light is not occluded indoors). colOf(hex) -> [r, g, b] in the renderer's working colour space. */
export function meshData(H, colOf, opts) {
  opts = opts || {};
  const split = !!opts.interior;
  // inside test in the house's local frame: the walls' OUTER faces (centreline span + T/2) minus the L cut, from the ground slab to the top storey's ceiling
  const cC = COS[H.turn], sC = SIN[H.turn], hw = H.W / 2 + T / 2 - 0.005, hd = H.D / 2 + T / 2 - 0.005;
  const yLo = H.floors[0].y - FLOOR0 - BASE0 - 0.01, yHi = H.floors[H.floors.length - 1].ceil + 0.1;     // (the top ceiling's underside: its point behind lies in the roof slab)
  const cut = H.cut ? [-H.W / 2 + H.cut[0] * U - T / 2, -H.D / 2 + H.cut[1] * U - T / 2, -H.W / 2 + H.cut[2] * U + T / 2, -H.D / 2 + H.cut[3] * U + T / 2] : null;
  const pointIn = (x, y, z) => {
    if (y < yLo || y > yHi) return false;
    const dx = x - H.cx, dz = z - H.cz, u = dx * cC - dz * sC, v = dx * sC + dz * cC;
    if (u < -hw || u > hw || v < -hd || v > hd) return false;
    if (cut && u > cut[0] + 0.01 && u < cut[2] - 0.01 && v > cut[1] + 0.01 && v < cut[3] - 0.01) return false;
    return true;
  };
  const FN = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  // a box face is interior when the points just in front of AND just behind its centre are both inside (an outer wall face has open air in front of it)
  const faceIn = (b, fi) => {
    const n = FN[fi], c = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
    const ax = fi >> 1; c[ax] = fi & 1 ? b.min[ax] : b.max[ax];
    return pointIn(c[0] + n[0] * 0.03, c[1] + n[1] * 0.03, c[2] + n[2] * 0.03) && pointIn(c[0] - n[0] * 0.03, c[1] - n[1] * 0.03, c[2] - n[2] * 0.03);
  };
  const groups = { walls: new Map(), furniture: new Map(), glass: new Map() };      // mat -> { pos, nor, uv, col, idx, boxes }
  const boxRanges = new Array(H.boxes.length);
  // (K1 re-run) opts.ns: an OUTSIDE face of a box flagged ns (a ruin's wreckage) is keyed "<mat>#ns" (maps.js: the no-shadow twin mesh); without opts.ns nothing changes
  const nsSplit = !!opts.ns;
  const acc = (grp, mat, inn, ns) => { const key = inn ? mat + "|in" : ns ? mat + "#ns" : mat; let a = groups[grp].get(key); if (!a) { a = { pos: [], nor: [], uv: [], col: [], idx: [], boxes: [] }; groups[grp].set(key, a); } return a; };
  // a box -> faces grouped by material (one box can span two materials: brick outside, plaster inside)
  const FACES = [                                    // [normal, 4 corners as (x, y, z) picks 0 = min 1 = max], uv axes
    [[1, 0, 0], [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [2, 1]],
    [[-1, 0, 0], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], [2, 1]],
    [[0, 1, 0], [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [0, 2]],
    [[0, -1, 0], [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], [0, 2]],
    [[0, 0, 1], [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [0, 1]],
    [[0, 0, -1], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], [0, 1]],
  ];
  H.boxes.forEach((b, bi) => {
    const grp = b.p === "furn" || b.p === "deco" ? "furniture" : b.p === "glass" ? "glass" : "walls";
    const mm = [b.min, b.max];
    let first = null;
    for (let fi = 0; fi < 6; fi++) {
      if (b.h & (1 << fi)) continue;
      const pe = H.palette[b.f[fi]], a = acc(grp, pe.mat, split && grp !== "glass" && faceIn(b, fi), nsSplit && grp === "walls" && b.ns === 1), base = a.pos.length / 3;
      if (!first) first = [grp, pe.mat, base];
      const [n, cs, ax] = FACES[fi], tile = TILE[pe.mat] || 2, rgb = colOf(pe.color);
      for (const cr of cs) {
        const x = mm[cr[0]][0], y = mm[cr[1]][1], z = mm[cr[2]][2], p = [x, y, z];
        a.pos.push(x, y, z); a.nor.push(n[0], n[1], n[2]); a.uv.push(p[ax[0]] / tile, p[ax[1]] / tile); a.col.push(rgb[0], rgb[1], rgb[2]);
      }
      a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    boxRanges[bi] = first;
  });
  // (Wave 9, LC-91) the door leaves in their START state, open: the open slab's 5 faces (no underside: it stands on the floor), inside faces. maps.js passes
  // opts.leaves false (it draws the swinging leaves in one BatchedMesh); house.tris counts LEAF_TRIS per leaf
  if (opts.leaves !== false) for (const L of H.doorLeaves || []) {
    const pe = H.palette[L.pal], mm = [L.open.min, L.open.max], tile = TILE[pe.mat] || 2, rgb = colOf(pe.color), a = acc("walls", pe.mat, split, false);
    for (const fi of [0, 1, 2, 4, 5]) {
      const base = a.pos.length / 3, [n, cs, ax] = FACES[fi];
      for (const cr of cs) {
        const x = mm[cr[0]][0], y = mm[cr[1]][1], z = mm[cr[2]][2], p = [x, y, z];
        a.pos.push(x, y, z); a.nor.push(n[0], n[1], n[2]); a.uv.push(p[ax[0]] / tile, p[ax[1]] / tile); a.col.push(rgb[0], rgb[1], rgb[2]);
      }
      a.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  // pitched roofs: each plank exactly as its ramp collides (walk line +- hv), the end walls as flat polygons; walls group
  const poly = (mat, color, pts, nrm, uvf) => {          // a convex polygon (fan), each triangle wound to face nrm (three's front face: counter-clockwise)
    const nl = Math.sqrt(nrm[0] * nrm[0] + nrm[1] * nrm[1] + nrm[2] * nrm[2]), nn = nrm.map((v) => v / nl);
    let mx = 0, my = 0, mz = 0; for (const P of pts) { mx += P[0] / pts.length; my += P[1] / pts.length; mz += P[2] / pts.length; }
    const a = acc("walls", mat, split && pointIn(mx - nn[0] * 0.02, my - nn[1] * 0.02, mz - nn[2] * 0.02) && pointIn(mx + nn[0] * 0.02, my + nn[1] * 0.02, mz + nn[2] * 0.02)), rgb = colOf(color), tile = TILE[mat] || 2;
    for (let q = 1; q + 1 < pts.length; q++) {
      const A = pts[0]; let Bq = pts[q], Cq = pts[q + 1];
      const e1 = [Bq[0] - A[0], Bq[1] - A[1], Bq[2] - A[2]], e2 = [Cq[0] - A[0], Cq[1] - A[1], Cq[2] - A[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * cr[0] + cr[1] * cr[1] + cr[2] * cr[2] < 1e-12) continue;
      if (cr[0] * nn[0] + cr[1] * nn[1] + cr[2] * nn[2] < 0) { const t = Bq; Bq = Cq; Cq = t; }
      const base = a.pos.length / 3;
      for (const P of [A, Bq, Cq]) { const uv = uvf(P); a.pos.push(P[0], P[1], P[2]); a.nor.push(nn[0], nn[1], nn[2]); a.uv.push(uv[0] / tile, uv[1] / tile); a.col.push(rgb[0], rgb[1], rgb[2]); }
      a.idx.push(base, base + 1, base + 2);
    }
  };
  const pick0 = (pl, i) => pl[i];
  for (const rf of H.roofs || []) {
    const r = H.ramps[rf.ramp], hv = rampHalfV(r), ax = r.dir < 2 ? 0 : 2, cx = 2 - ax;
    const lo = r.dir === 0 || r.dir === 2 ? r.min[ax] : r.max[ax], hi = r.dir === 0 || r.dir === 2 ? r.max[ax] : r.min[ax], c0 = r.min[cx], c1 = r.max[cx];
    const walk = (t) => r.min[1] + (r.max[1] - r.min[1]) * Math.min(1, Math.max(0, (t - lo) / (hi - lo)));
    const P3 = (t, c, y) => (ax === 0 ? [t, y, c] : [c, y, t]);
    const up = (hi - lo > 0 ? 1 : -1), kk = (r.max[1] - r.min[1]) / Math.abs(hi - lo);
    const nTop = ax === 0 ? [-up * kk, 1, 0] : [0, 1, -up * kk], nUnder = nTop.map((v) => -v);
    const tP = pick0(H.palette, rf.top), eP = pick0(H.palette, rf.edge);
    const slopeUV = (P) => [P[cx], (P[ax] - lo) * up * Math.sqrt(1 + kk * kk)];
    poly(tP.mat, tP.color, [P3(lo, c0, walk(lo) + hv), P3(hi, c0, walk(hi) + hv), P3(hi, c1, walk(hi) + hv), P3(lo, c1, walk(lo) + hv)], nTop, slopeUV);
    for (const [c, sg] of [[c0, -1], [c1, 1]]) poly(eP.mat, eP.color, [P3(lo, c, walk(lo) - hv), P3(hi, c, walk(hi) - hv), P3(hi, c, walk(hi) + hv), P3(lo, c, walk(lo) + hv)], ax === 0 ? [0, 0, sg] : [sg, 0, 0], (P) => [P[ax], P[1]]);
    for (const [t, free, sg] of [[lo, rf.freeLow, -up], [hi, rf.freeHigh, up]]) if (free) poly(eP.mat, eP.color, [P3(t, c0, walk(t) - hv), P3(t, c1, walk(t) - hv), P3(t, c1, walk(t) + hv), P3(t, c0, walk(t) + hv)], ax === 0 ? [sg, 0, 0] : [0, 0, sg], (P) => [P[cx], P[1]]);
    for (const q of rf.soffit) {                          // the underside where the plank hangs outside the walls
      const cs = [[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]].map(([x, z]) => [x, walk(ax === 0 ? x : z) - hv, z]);
      poly(eP.mat, eP.color, cs, nUnder, (P) => [P[0], P[2]]);
    }
  }
  for (const g of H.gables || []) { const pe = pick0(H.palette, g.pal); poly(pe.mat, pe.color, g.pts, g.n, (P) => [g.n[0] ? P[2] : P[0], P[1]]); }
  if (wearOn(opts.wear)) wearBands(H, groups, acc, faceIn, colOf);           // (P23 / LC-17: after every box face and roof polygon; D10: opts.wear "low" / false = none)
  return { groups, boxRanges };
}

/** buildHouse(THREE, house, opts?) -> { group, walls, furniture, colliders, kitList, meshes, stats, boxRanges, setFurnitureVisible, updateLod, dispose }
 *  opts: { materials?: (key) => THREE.Material, mkCollider?, kitTemplates?: Map(type -> [{ geometry, material }]) (instanced kit furniture),
 *          district? (kitList entries), furnitureDistance? (60) }
 *  walls = every structure box + the stair steps, merged per material; furniture = the authored pieces merged per material (+ the kit instances when
 *  kitTemplates are given; otherwise hand kitList to citykit.place()). boxRanges[i] = [mesh index, first vertex] of house.boxes[i] (24 vertices each). */
export function buildHouse(THREE, H, opts) {
  opts = opts || {};
  const M = opts.materials ? { get: opts.materials } : defaultMaterials(THREE);
  const col3 = (c) => { const k = new THREE.Color(c); return [k.r, k.g, k.b]; };     // sRGB hex -> working colour space (three r152+ colour management)
  const colCache = new Map();
  const colOf = (c) => { let v = colCache.get(c); if (!v) { v = col3(c); colCache.set(c, v); } return v; };
  const { groups, boxRanges } = meshData(H, colOf, { wear: opts.wear });                 // (P23: opts.wear false / "low" leaves the wear strips out, see WEAR_BY_TIER)
  const meshOf = (a, mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(a.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(a.nor, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(a.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(a.col, 3));
    g.setIndex(a.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(a.idx, 1) : new THREE.Uint16BufferAttribute(a.idx, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, M.get(mat));
    m.name = "housegen:" + H.id + ":" + mat;
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  const group = new THREE.Group(), walls = new THREE.Group(), furniture = new THREE.Group();
  group.name = "house:" + H.id; walls.name = "walls"; furniture.name = "furniture";
  const glass = new THREE.Group();
  glass.name = "glass"; glass.userData.lcPart = "glass";                       // window panes: seen through, shot through (no collider)
  group.add(walls); group.add(furniture); group.add(glass);
  const meshes = [];
  for (const [mat, a] of [...groups.walls.entries()].sort()) { const m = meshOf(a, mat); walls.add(m); meshes.push(m); }
  for (const [mat, a] of [...groups.furniture.entries()].sort()) { const m = meshOf(a, mat); m.castShadow = false; furniture.add(m); meshes.push(m); }
  for (const [mat, a] of [...groups.glass.entries()].sort()) { const m = meshOf(a, mat); m.castShadow = false; m.receiveShadow = false; m.renderOrder = 2; glass.add(m); meshes.push(m); }
  // kit furniture: instanced from caller-supplied templates (else the caller places kitList with citykit)
  const kitList = kitEntries(H, opts.district);
  const instanced = [];
  if (opts.kitTemplates) {
    const byType = new Map();
    for (const e of kitList) { if (!byType.has(e.type)) byType.set(e.type, []); byType.get(e.type).push(e); }
    const Mx = new THREE.Matrix4();
    for (const [type, list] of byType) {
      const parts = opts.kitTemplates.get(type);
      if (!parts) continue;
      for (const pt of parts) {
        const im = new THREE.InstancedMesh(pt.geometry, pt.material, list.length);
        list.forEach((e, k) => {
          const c = COS[e.rot], s = SIN[e.rot];
          Mx.set(c, 0, s, e.x, 0, 1, 0, e.y, -s, 0, c, e.z, 0, 0, 0, 1);
          if (pt.local) Mx.multiply(pt.local);
          im.setMatrixAt(k, Mx);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.name = "housegen:" + H.id + ":" + type;
        furniture.add(im); instanced.push(im);
      }
    }
  }
  const colliders = collidersOf(H, opts.mkCollider);
  let tris = 0;
  for (const m of meshes) tris += m.geometry.index.count / 3;
  const dist = opts.furnitureDistance || H.lod.furnitureR || 60;
  const setFurnitureVisible = (v) => { furniture.visible = !!v; };
  const updateLod = (cam, dd) => {
    const D2 = (dd || dist) * (dd || dist), dx = cam.x - H.lod.cx, dy = cam.y - H.lod.cy, dz = cam.z - H.lod.cz;
    furniture.visible = dx * dx + dy * dy + dz * dz <= D2 + H.lod.r * H.lod.r + 2 * H.lod.r * (dd || dist);
    return furniture.visible;
  };
  const dispose = () => {
    for (const m of meshes) m.geometry.dispose();
    for (const im of instanced) im.dispose();
    group.removeFromParent();
  };
  return { group, walls, furniture, colliders, kitList, meshes, instanced, boxRanges, stats: { meshes: meshes.length + instanced.length, triangles: tris, colliders: colliders.length },
    setFurnitureVisible, updateLod, dispose };
}
