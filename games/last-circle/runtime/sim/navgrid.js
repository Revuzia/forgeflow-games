/**
 * FFG runtime - sim/navgrid.js  (Last Circle, Wave 6 lane 6D; Wave 7 lane 7B1: the hairline fixes, the cheap bake, the small tile, bakeTown)
 * A baked, LAYERED navigation grid for towns: a list of floors per cell (no layer cap), typed edges WALK / DROP / RAMP in CSR
 * typed arrays (DYEFIELD's layout), lazy synchronous tiles, A* plus a string-pull funnel. Pure and deterministic, NO three.js,
 * NO DOM: it reads a list of colliders (the maps.js mkCollider records: kind "box" | "ramp", minX..maxZ, dir) and a height
 * function. WIRED in Wave 7 stage B (lane 7B2): ffg_royale3d.js loads it as a classic script, bots.js (royale/bots.js, "THE TOWN NAVIGATION GRID")
 * plans the Savanna's towns and compounds with it - as a LAZY world baked on a fixed tick schedule, see "LAZY WORLDS" below.
 *
 * API (contract C-NAV, VERSION 2)
 *   NavGrid.createWorld({ colliders, heightFn, waterY, portals, tileSize: 32, cellOutdoor: 1.5, cellIndoor: 0.75,
 *                         cover: (tx, tz) => bool | zones: [{ x, z, r }] | rects: [{ minX, maxX, minZ, maxZ }], margin: 6, fineRects })   -> world
 *   NavGrid.findPath(world, sx, sy, sz, tx, ty, tz [, { pad, maxExpand, noPull, maxDrop }])  -> [{ x, y, z, k }, ...] | null
 *       (P2-E) opts.maxDrop (m): drop edges taller than this are left out (default: all, up to DROP_MAX 6 m). For C-FALL (a 4 m drop is safe, a
 *       taller one hurts) and C-DBNO crawlers. A downed actor (0.6 m capsule, same radius) needs no grid of its own: every standing edge fits it.
 *       maxDrop is a HEIGHT; C-FALL gives the safe landing as a SPEED (K.FALL_SAFE_V, m/s): convert it with h = v^2 / (2 g) at THIS game's gravity,
 *       g = 22 m/s^2 (sim MOVE.gravity; not 9.8): NavGrid.dropHeight(K.FALL_SAFE_V) = 4.0 m (= K.FALL_SAFE_H; a fall-damage budget of b hp: the height
 *       whose fallDamage is b). A NULL route is a valid answer, not an error: with a budget it is "no-path" whenever every way needs a taller drop
 *       (a downed crawler on a deck whose only exits are drops, a walled yard only a drop leads into) - the caller keeps its own plan (stays, or
 *       uses its fallback planner) and may ask again; world.lastFail says why.
 *       k = the kind of the leg that ARRIVES at the waypoint (0 walk, 1 drop, 2 ramp); the array also carries .cost .expanded
 *       .nodes; world.lastFail names why a query returned null: "no-goal" (no floor near the goal), "no-start", "start-blocked"
 *       (the walker cannot walk to any node near it), "no-path", "limit" (maxExpand reached, or the search table is full)
 *   NavGrid.walkSegment(world, ax, ay, az, bx, bz [, { pad }])                               -> { y, ramp } | null
 *       the mover's own answer for a straight walk. It holds for a walker at speed AND one that starts from a standstill, and for a
 *       walker that stops anywhere in the last 6 cm before b (the floor there is the floor at b); the floor holds 5 cm past the end.
 *   NavGrid.bakeTile(colliders, heightFn, rect, cell [, { holes, waterY, seeds, blockers, noPrune, seam }])  -> tile   (pure)
 *   NavGrid.bakeTown(colliders, heightFn, rects [, { waterY, portals, margin, maxMs, world, ... }])  -> town { world, step(maxMs), done, remaining, stats() }
 *       THE WAY STAGE B COMPOSES bakeTile OVER A TOWNGEN LAYOUT: rects = layoutMap().towns[i] / .compounds[i] (or plain rects / discs); only the coarse tiles
 *       that touch them (+ margin) ever bake, every building inside becomes fine tiles, one world serves the whole map (pass opts.world for the next town).
 *   NavGrid.rectOfLayout(layout [, margin])   the ground a towngen layout covers
 *   NavGrid.prewarm(world, { x, z, r } | rect, maxMs)  -> { baked, remaining }   bake AND stitch ahead of the first query, a few ms a frame
 *   NavGrid.tileFor / tiles / edgesOf / worldStats / worldHash / makeColSet / findBuildingRects / snapNodes / linkTile   (inspection)
 *   (Wave 8, lane I2) opts.noFloor (createWorld / bakeTown / bakeTile): a Set of collider objects that are TALL FURNITURE - never a floor, a wall from TALL_LIFT
 *       over the feet (see TALL_LIFT). NavGrid.tallFurniture(map) -> that Set for a map with furnished houses (map.houses), null otherwise (the old world exactly).
 *   (Wave 8, lane I2) GARBAGE: the replay's hot calls pass their numbers through module Float64Arrays (hopQ / supportTQ / rampBlocksTQ / clearTierQ / evalEdgeQ /
 *       hopListQ / quietFlatQ / floorFragileQ / tileForQ / segRectD2Q) and coerce received numbers (x = +x): a call that is not inlined boxes every double argument,
 *       and a parameter used as received stays a boxed number in TurboFan's phis. The bake made ~350 B of garbage per replayed step (~2 MB a frame at
 *       NAV_STEPS_TICK 6000), now ~50; every tile and route is bit for bit what it was (world hash + 900 routes compared on 3 housed maps). A tile no longer copies
 *       its colliders: it reads the world's collider set (T.lx0 === cs.minX ...) and its cell lists hold collider-set indices, in the same order.
 *
 * LAZY WORLDS (Wave 7, lane 7B2; the way bots.js uses the grid in play)
 *   NavGrid.createWorld({ ..., lazy: true }) / bakeTown(..., { lazy: true })   a world whose queries NEVER bake a tile: a tile that is not baked reads as
 *       missing (a hop into it is blocked, a start or goal inside it finds no node) and the request is listed in world.wanted (reset by every findPath; the
 *       tiles THAT query needed: a start's or a goal's building, whole when it is cut into chunks). The caller decides when tiles are baked.
 *   NavGrid.collectJobs(world, area) -> [{ kind 0 outdoor | 1 building, key, tx, tz, rect }]   the unbaked tiles of a circle {x, z, r} or rect, sorted by key
 *   NavGrid.takeWanted(world) -> jobs   the unbaked tiles the last query asked for (first-asked order); NavGrid.runJob(world, job) bakes + stitches one at once
 *   NavGrid.beginJob(world, job) / stepJob(world, jobState) -> done   the same job a SLICE at a time (~1 ms of replay work per slice: the bake yields every
 *       YIELD_STEPS replayed steps, the stitch every YIELD_STEPS, so a 190 ms building is ~100 slices); NavGrid.work() = the replay counter (10 cm steps) to
 *       budget a tick by. A tile that is mid-bake is not in the world; one whose stitch is running is skipped by resolveGroup until it is done.
 *   Every tile is a pure function of the colliders and the height function and the stitched graph does not depend on the ORDER tiles were baked, stitched or
 *   queried in: fully baked, a lazy world hashes like an eager one (the selftest and the Savanna check: equal worldHash, equal routes).
 *
 * TILE LAYOUT (what 7B2 may read): T.n nodes in cell order with T.x / T.y / T.z (Float32), T.flag (Uint8: F_OPEN 1, F_WET 2, F_RAMP 4, F_TERR 8,
 * robustness bits 4-5, F_PROV 128), T.cellStart (nodes of cell c = cellStart[c] .. cellStart[c + 1]), T.nx / T.nz / T.cell / T.minX / T.minZ / T.inv, and
 * THREE sources of out-edges per node, all typed arrays:
 *   CSR      edgeStart[n] .. edgeStart[n + 1] -> edgeTo (local id), edgeCost (metres, Float32), edgeKind (0 walk, 1 drop, 2 ramp)   ramps, drops, floor<->terrain steps
 *   PLAIN    T.adj[n]: one bit per neighbour direction (the order of the arrays NB8X / NB8Z: +x -x +z -z then the four diagonals) for the walks between
 *            two terrain nodes or two nodes of one flat floor; the node it leads to is the cell's terrain node / its node on the same level
 *   OPEN     a node flagged F_OPEN (no collider within the capsule + pad: terrain, nothing to replay) is joined to every F_OPEN node in its 8 neighbour
 *            cells, never stored
 *   LINK     extStart / extTo (global id = slot * STRIDE + local) / extCost / extKind: the stitched edges to the neighbouring tiles
 * edgesOf(world, T, n) lists all four. A global node id is slot * STRIDE (131072) + local id. The old per-node search scratch is gone from the tiles: it lives
 * in one 0.43 MB table of the module (a query clears it with one fill).
 *
 * THE MOVER IS COPIED, NOT GUESSED. The capsule is player.js's: radius 0.45 (sim PLAYERK), headroom 1.8, STEP_UP 0.55, supportIn's
 * 0.3 m footprint margin, blockedIn's circle-vs-box test at the destination floor, the C-RAMP rule (sim rampBlocks: a ramp is a
 * 0.3 m sloped slab, walkable from its low edge, sides and underside block), gravity -22 at 60 Hz, X then Z axis moves. Every edge,
 * every pulled leg and every start/goal snap is REPLAYED through that model in 10 cm steps (the Blackridge "moverHopOk" pattern).
 * navgrid.selftest.cjs pins the constants to royale.js / player.js / bots.js and checks the ramp rule against the sim.
 *
 * THE MODEL ERRS TOWARD "BLOCKED". The real mover has hairlines (a step 1 cm under 0.55, a slab 1 cm over the head, the 0.3 m margin
 * that lifts a walker onto a ramp from its side) that a follower 5 cm off its line does not reproduce. So the grid decides with a
 * step 1 cm short (STEP_G) and 15 cm of spare headroom (HEIGHT_G); a ramp or drop edge must land on the same floor with and without
 * the ramp's margin and from starts 0.4 m off its node; a floor steps onto a ramp's run only level; a pulled leg never crosses a drop
 * or a floor-type boundary; nodes carry a robustness (clearance, floor continuity 0.3 m round) that prices a path along an edge.
 * Wave 7 closed the last holes that a 360,000-segment comparison against the real mover found (13 segments the grid walked and the mover did not):
 *   - SPEED: the mover accelerates (MOVE.accelT), so a walker that starts from REST spends more ticks over a ledge, a stair side or a steep slope than
 *     the full-speed replay does. A walk (walkSegment, a pulled leg, an edge on which the feet leave the ground) must hold for both.
 *   - GROUNDED REACH: the mover lifts a step of at most 0.55 minus the 6 mm its gravity sinks in the tick, and BLOCKS nothing between that and 0.55 (a ghost
 *     step it walks into). The grid measures a grounded walker's reach from where it stood, so every step is a lift or a wall (a 0.538 m step between two
 *     flush slabs used to be neither).
 *   - ARRIVAL: a bot is "there" a few centimetres early (the harness arrives within 6 cm); the floor 6 cm short of the end must be the floor at the end.
 *   - WATER: the open-cell jump of the replay checked the swim line at its two ends only; it now walks the steps wherever the ground is near it, and the
 *     swim line carries a 2 cm skin (the ground is sampled every 10 cm; a trough 0.4 mm under the line between two samples is where the mover swam).
 *   - NO GROUND: a terrain function that returns NaN (it did: maps.js TerrainField on 3 of 90 map seeds) gives no node and blocks every hop through it.
 *   - AIR: a walker whose feet are in the air is judged 7 cm lower (one tick of fall) by every support, blocking and swim test. At the tick a falling walker
 *     enters a deck's support margin, 6 mm decide whether it is still high enough to be caught (11 of 15 residual disagreements in 9 million segments).
 *   - STEEP GROUND: the replay used to glue the feet to open terrain at any slope. Ground that drops more than 2.6 cm a tick is left by the feet (they fall,
 *     and arrive at the next feature higher than the ground and with a downward speed): it is simulated tick by tick. An open-cell jump needs a slope < 0.2.
 *   - END STRETCH: the walker stops anywhere in the last 6 cm, not where the replay's ticks fall: the support there is checked every centimetre (two support
 *     margins leave a notch at the corner of a stairwell hole).
 *   - ORDER: equal tops (a stair flush with its landing) are won by the ramp, so the order of the colliders never decides what an edge is.
 * Measured against the real mover (stepActor on the real maps, 20,000 random segments from node positions per run): 29.4 million segments in 1,470 runs
 * (the 6 Wave-6 seeds, 480 fresh seeds x 3 maps of which 150 x 3 found the rules above and 330 x 3 did not, and 30 Savanna seeds): 0 segments the grid walks and
 * the mover does not beyond a 5 cm skin (4 inside it). The price: of the segments the mover walks, 1.5 % are called blocked by the grid (the grid errs toward
 * blocked; median 1.51 %, p99 1.83 %, 2 of 1,440 runs above 2 % - both Isla Viva, 2.01 and 2.08 %).
 *
 * LAYOUT
 *   world  = 32 m coarse tiles (1.5 m cells outdoors, with a hole where a building stands) + fine tiles per BUILDING (0.75 m cells; 0.5 m cost twice the
 *            bake and the memory for no room the real mover could reach (11,418 room walks on 24 map-seeds: the same ones planned); 1.0 m lost 124 of them; found from the roof / ceiling slabs and the
 *            ramps that touch them; a building over 16 m a side is cut into chunks of at most 16 m, stitched like any tiles, so one atomic bake stays
 *            small). Tiles bake LAZILY, synchronously, on first query (a pure function of the seeded colliders and the height function, so replays
 *            match; the result of a query never depends on the order tiles were baked in).
 *            A bake does NOT stitch: stitching replays hops that can step into a tile nobody has baked, and baking that one and stitching it in turn used to
 *            cascade across the whole covered area (one query baked 16,342 tiles). linkTile() stitches a tile to the baked tiles round it, by replayed
 *            border hops; the search asks for it before it expands a border node, prewarm / bakeTown / resolveGroup ask for it too.
 *   tile   = cells (row-major), nodes in cell order: ONE PER FLOOR PER CELL (terrain, every box top, every ramp), anchored at the
 *            passing sample (9 per cell) with the most clearance; an OPEN cell (no collider within capsule + pad) is one terrain node
 *            and needs no replay. Floors: the capsule fits, and the mover would not be lifted onto something higher within a step.
 *   edges  = WALK (flat or terrain), RAMP (the hop climbs or descends a ramp slab), DROP (down only, 0.55..6 m, costs extra); both
 *            directions of a pair are replayed separately, so a ramp is entered from its low edge or from above, never through its
 *            side. A directed flood fill from the open ground prunes islands (car roofs, house roofs, sealed rooms, a slab nothing
 *            leads to): replays are only run OUT OF reachable floors. A chunk cannot know alone whether what touches its seam is led to
 *            by the sibling (the far half of a house whose door is on the other side), so it keeps those nodes provisionally (F_PROV)
 *            and the first query that snaps onto one bakes the siblings and settles the building (resolveGroup: a flood across the
 *            stitched seams; what stays unreached is an island, refused at once as "no-goal" / "no-start", as an unsplit tile would).
 *            Two stair nodes diagonal to each other get no edge of their own (the orthogonal edges carry the route, the string pull cuts the corner).
 *            A flat walk next to a wall is replayed; a flat walk NOTHING touches (no wall, no step, no ramp within the capsule + 7 cm, the line on top of
 *            floor boxes at that very height) is accepted without the replay (quietFlat: 130,000 accepts cross-checked against the replay, 0 differ).
 *   search = A* over the baked floors (tiles bake and stitch as the search reaches them), then a greedy string pull (gallop + bisect
 *            over the farthest node a padded straight walk reaches). Launch portals and deep water are obstacles.
 *   FOLLOWING (for 7B2; measured in the stage-A report): a follower that consumes a waypoint early (a bot does, within 0.6-1.6 m) walks off a stair and
 *            through a thin wall. Consume a waypoint of kind k > 0 (and the one before it) only within 0.55 m, and an ordinary one early only while
 *            walkSegment(world, bot -> next waypoint) is not null: 11,548 of 11,548 planned room walks arrived (24 maps, waypoints taken within 1.5 m);
 *            without the rules about 6 in 10 upper-floor walks arrived.
 *
 * Dual export: Node require() (CJS) and browser window.FFG.sim.NavGrid.
 */
(function navgridFactory(root) {
  "use strict";

  var VERSION = 2;               // C-NAV: 1 = Wave 6 (per-tile search scratch, every edge stored, 0.5 m cells); 2 = Wave 7 (implicit / plain edges, the search table, 0.75 m cells, deferred stitching)
  var perf = (typeof performance !== "undefined" && performance && performance.now) ? performance : null;
  function now() { return perf ? perf.now() : Date.now(); }

  // ── the mover (sim/royale.js PLAYERK + MOVE, player.js STEP_UP / supportIn / blockedIn) ──────────────────────────
  var STEP_UP = 0.55;            // player.js:1400
  var STEP_G = STEP_UP - 0.01;   // every step decision in the grid (lift, blocker, dominance, edge window) uses a step 1 cm SHORT of the mover's: a ledge 1 cm under the limit is a wall, so a hairline case can only resolve toward "blocked"
  var RADIUS = 0.45;             // PLAYERK.radius
  var HEIGHT = 1.8;              // PLAYERK.height (standing)
  var HEIGHT_G = HEIGHT + 0.15;  // headroom the grid's blocking tests demand: a slab 1 cm over the head is a wall as soon as the walker climbs 5 cm (sloped terrain), so 15 cm are held back
  var SUP_MARGIN = 0.3;          // supportIn: a collider supports within this margin of its footprint
  var GRAVITY = -22;             // MOVE.gravity
  var TICK = 1 / 60;             // the fixed sim tick
  var HOP_SPEED = 6;             // MOVE.walk: a replayed hop takes one tick per 0.1 m
  var HOP_STEP = HOP_SPEED * TICK;
  // The mover accelerates toward its walk speed with a time constant (sim MOVE.accelT 0.13: vel += (target - vel) * dt / accelT), so a walker
  // that starts from REST covers the first metre slower than HOP_STEP per tick and spends more ticks (gravity) over a ledge or a stair side.
  // REST_D[s] = metres covered after s ticks from a standstill. A hop in rest mode (_rest = 1) samples the line at REST_D, not at s * HOP_STEP.
  var ACCEL_T = 0.13;            // sim MOVE.accelT
  var ACCEL_K = Math.min(1, TICK / ACCEL_T);
  var REST_N = 150;
  var REST_D = (function () { var d = new Float64Array(REST_N + 1), v = 0; for (var s = 1; s <= REST_N; s++) { v += (HOP_SPEED - v) * ACCEL_K; d[s] = d[s - 1] + v * TICK; } return d; })();
  function restDist(s) { return s <= REST_N ? REST_D[s] : REST_D[REST_N] + (s - REST_N) * HOP_STEP; }
  /** the smallest tick count that has covered `dist` metres from a standstill */
  function restTicks(dist) {
    if (dist > REST_D[REST_N]) return REST_N + Math.ceil((dist - REST_D[REST_N]) / HOP_STEP);
    var lo = 0, hi = REST_N;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (REST_D[m] >= dist) hi = m; else lo = m; }
    return REST_D[lo] >= dist ? lo : hi;
  }
  var _rest = 0;                 // 1 while a hop starts from a standstill (see REST_D)
  var RAMP_THICK = 0.3;          // sim RAMP_THICK
  // (Wave 8, lane I2) TALL FURNITURE: a box the world was told is furniture standing more than a step over its own floor (opts.noFloor: a Set of the
  // maps.js collider objects) is collider kind 3 - NEVER a floor (no node on a table, a bed, a shelf, a counter: bots never route over the furniture, the
  // 'furniture staircase' of the stage-A check) and it BLOCKS the capsule whenever its top is more than TALL_LIFT over the feet (a step up onto it is a
  // wall, never a lift). Both err toward 'blocked', the grid's rule: the real mover may still climb furniture, the grid never plans it.
  var TALL_LIFT = 0.02;
  // ── the grid ──────────────────────────────────────────────────────────────────────────────────────────────────────
  var BAKE_SKIN = 0.005;         // baked clearance is the capsule + 5 mm, so float32 rounding can never put a node on the boundary
  var GLUE_DROP = 0.026;         // terrain that drops more than this in one 60 Hz step is left by the feet (gravity sinks them 6 mm and they land within 2 cm)
  var JUMP_SLOPE = 0.2;          // an open-cell jump is taken only over ground that falls less than this (m per m)
  var AIR_PAD = 0.07;            // a walker whose feet are in the air is judged this far LOWER by every support / blocking test (see hop)
  var WATER_GUARD = 1.2;         // an open-cell jump is taken only where the terrain is this far over the swim line at both ends
  var PAD_MAX = 0.3;             // the most extra clearance a query may ask for (cell lists are cut to RADIUS + PAD_MAX)
  var E1 = RADIUS + PAD_MAX + 0.01;
  var DROP_MAX = 6.0;            // bots.js NAV_DROP_MAX
  var DROP_COST = 2.0;           // bots.js NAV_DROP_COST: stairs win when both exist
  var FLOOR_TOL = 0.31;          // a replayed hop must end this close to the node it was planned for (< half the 0.55 step)
  var JITTER = 0.06;             // ramp edges and pulled ramp legs must also pass with the line shifted this far sideways (a walker is never exactly on it)
  var PERTURB = 0.4;             // ramp and drop edges must also work from this far off the node (a follower is never exactly on it)
  var HW = 1.0;                  // A* heuristic weight (1 = optimal)
  var ARRIVE = 0.06;             // walkSegment: a walker may stop this far short of the end (the harness arrives within 6 cm); the floor there must be the end floor
  var FLOOR_AGREE = 0.15;        // walkSegment: replays of one walk (at speed / from rest / stopping early) must end this close in height
  var OVERSHOOT = 0.05;          // walkSegment: the floor must hold this far past the end of the segment
  var BIG_GAP = 2.0;             // feet this far above the highest support under them are falling, not walking (a 45 degree stair descent is airborne up to ~2 m)
  var MAX_WALK_GAP = 6;          // ... and a walk may spend at most this many ticks that high (one tick over a 0.4 m void is a crossing, 15 ticks off a ledge is a fall)
  var MAX_FLOOR_ABOVE = 24;      // floors higher than this above the terrain are not baked (sky islands)
  var MIN_FLOOR_DIM = 0.7;       // a box top narrower than this is a wall top, not a floor
  var RAMP_SLOPE_MAX = 1.1;      // 45 degrees (C-RAMP) plus slack for anchors that sit off the cell centre
  var OFFS = [-0.375, -0.125, 0.125, 0.375];   // sample offsets (fractions of a cell), Blackridge's pattern
  var LINK_BAND = 3.0;           // nodes this close to a tile edge or hole are border nodes (stitched across tiles)
  var SEAM_BAND = 1.0;           // nodes this close to a side shared with a sibling chunk are kept as reachable seeds (see bakeTile opts.seam)
  var BRIDGE_DY = 0.9;           // a stair-end bridge (see the floor-edge block of bakeTile) climbs or falls at most this much ...
  var BRIDGE_D = 1.75;           // ... over at most this horizontal distance (two cells of 0.75 m, a node may sit off its cell centre)
  var FINE_MAX = 16;             // a building tile is at most this many metres a side: a bigger building is baked as several, stitched like any tiles (one bake is atomic, so this bounds the hitch)
  var BUILDING_ROOF_MAX = 14;    // a slab higher than this above the ground is a deck or a bridge, not part of a building
  var MAX_SLOTS = 12000;         // tiles per world: the global node id (slot * STRIDE + local) must stay an int32
  var STRIDE = 1 << 17;          // global node id = slot * STRIDE + local id
  var WET_MULT = 1.8;            // wading is slow (player.js 0.55 x speed)
  var DEEP = 1.08;               // PLAYERK.swimDepth 1.1 less a 2 cm skin: terrain this far under the water is swimming, not walking (the replay samples the ground every 10 cm; a trough 0.4 mm under the line between two samples is where the mover swam; a 5 cm skin cost Isla Viva 0.07 % of its agreement)
  var EDGE_WALK = 0, EDGE_DROP = 1, EDGE_RAMP = 2;
  var F_OPEN = 1, F_WET = 2, F_RAMP = 4, F_TERR = 8, F_RAMPEND = 64, F_PROV = 128;      // node flags; bits 4-5 = robustness 0..3; F_RAMPEND = a ramp node within 0.6 m of height of the ramp's foot or top;
  // F_PROV = kept only because it touches a seam to a sibling chunk (reachable only if the sibling leads to it: resolveGroup decides)
  var ROB_MULT = [2.5, 1.5, 1.15, 1.0];    // edge cost multiplier by the robustness of the node it arrives at: a path pays to hug an edge

  // ── collider sets ─────────────────────────────────────────────────────────────────────────────────────────────────
  /** Copy the geometry of a collider list into typed arrays (dead colliders are left out AT THIS MOMENT: the set is a
   *  snapshot, so a prop destroyed later changes nothing and every client's tiles stay identical). `blockers` = extra
   *  boxes {minX..maxZ} that stop the capsule like a wall but are never a floor (kind 2): the launch portals. */
  function makeColSet(list, blockers, noFloor) {
    if (list && list.isColSet) return list;
    var n = 0, i, c, nb = blockers ? blockers.length : 0;
    for (i = 0; i < list.length; i++) if (!list[i].dead) n++;
    var tot = n + nb;
    var cs = {
      isColSet: true, n: tot,
      minX: new Float64Array(tot), maxX: new Float64Array(tot), minY: new Float64Array(tot), maxY: new Float64Array(tot),
      minZ: new Float64Array(tot), maxZ: new Float64Array(tot), kind: new Uint8Array(tot), dir: new Int8Array(tot),
    };
    var j = 0;
    for (i = 0; i < list.length; i++) {
      c = list[i];
      if (c.dead) continue;
      cs.minX[j] = c.minX; cs.maxX[j] = c.maxX; cs.minY[j] = c.minY; cs.maxY[j] = c.maxY;
      cs.minZ[j] = c.minZ; cs.maxZ[j] = c.maxZ; cs.kind[j] = c.kind === "ramp" ? 1 : (noFloor && noFloor.has(c) ? 3 : 0); cs.dir[j] = c.dir | 0;
      j++;
    }
    for (i = 0; i < nb; i++) {
      c = blockers[i];
      cs.minX[j] = c.minX; cs.maxX[j] = c.maxX; cs.minY[j] = c.minY; cs.maxY[j] = c.maxY;
      cs.minZ[j] = c.minZ; cs.maxZ[j] = c.maxZ; cs.kind[j] = 2; cs.dir[j] = 0;
      j++;
    }
    return cs;
  }

  /** A launch portal (player.js portalCheck: feet within 1.7 m of its axis and between 1 m under and 3.4 m over its centre
   *  fling the actor into the sky) as a blocker box: half-size 1.25 + the capsule 0.45 covers the 1.7 m disc, and the band
   *  [y + 0.8, y + 3.95] is exactly the feet window (a blocker stops feet from y - 1 up to y + 3.4). */
  function portalBlocker(p) {
    var h = 1.7 - RADIUS + 0.05;
    return { minX: p.x - h, maxX: p.x + h, minZ: p.z - h, maxZ: p.z + h, minY: p.y + 0.8, maxY: p.y + 3.95 };
  }

  // ── the mover model over a tile's local colliders ────────────────────────────────────────────────────────────────
  var _supRamp = 0;              // set by supportT: the winning top came from a ramp
  var _marginUse = 0;            // set by supportT: a ramp won through its side MARGIN (the walker stood outside its footprint)
  var _strictRamp = 0;           // 1 while a graph edge is validated: ramps give no side-margin support

  function rampTopT(T, i, x, z) {
    x = +x; z = +z;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var dir = T.ld[i], f;
    if (dir === 0) f = (x - T.lx0[i]) / Math.max(0.01, T.lx1[i] - T.lx0[i]);
    else if (dir === 1) f = (T.lx1[i] - x) / Math.max(0.01, T.lx1[i] - T.lx0[i]);
    else if (dir === 2) f = (z - T.lz0[i]) / Math.max(0.01, T.lz1[i] - T.lz0[i]);
    else f = (T.lz1[i] - z) / Math.max(0.01, T.lz1[i] - T.lz0[i]);
    return T.ly0[i] + (T.ly1[i] - T.ly0[i]) * (f < 0 ? 0 : f > 1 ? 1 : f);
  }

  /** player.js supportIn: the highest walkable top at or below y + STEP_G (terrain always counts). H = the terrain height at (x, z). */
  function supportT(T, items, a, b, x, z, y, H) {
    x = +x; z = +z; y = +y; H = +H;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var s = H;
    for (var k = a; k < b; k++) {
      var i = items[k], kd = T.lk[i];
      if (kd >= 2) continue;                            // a blocker (2) / tall furniture (3) is never a floor
      // strict mode (graph edges): a ramp holds a walker up only inside its footprint. The real mover also holds one up for 0.3 m
      // past it, which lets a walker be lifted onto a ramp from its SIDE; that works at exact positions only, so edges never rely on it.
      var m = (kd === 1 && _strictRamp === 1) ? 0 : SUP_MARGIN;
      if (x < T.lx0[i] - m || x > T.lx1[i] + m || z < T.lz0[i] - m || z > T.lz1[i] + m) continue;
      var isRamp = kd === 1, top;
      if (isRamp) { var x0r = T.lx0[i], x1r = T.lx1[i], z0r = T.lz0[i], z1r = T.lz1[i], dr = T.ld[i], fr; if (dr === 0) fr = (x - x0r) / Math.max(0.01, x1r - x0r); else if (dr === 1) fr = (x1r - x) / Math.max(0.01, x1r - x0r); else if (dr === 2) fr = (z - z0r) / Math.max(0.01, z1r - z0r); else fr = (z1r - z) / Math.max(0.01, z1r - z0r);
        top = T.ly0[i] + (T.ly1[i] - T.ly0[i]) * (fr < 0 ? 0 : fr > 1 ? 1 : fr); } else top = T.ly1[i];
      // equal tops (a stair that ends flush with its landing) are won by the RAMP, never by whichever collider happens to come first: the order of the colliders
      // must not decide whether a walk "used a ramp" (the edge kind, the strict and the margin replays)
      if (top <= y + STEP_G && (top > s + 1e-7 || (isRamp && _supRamp === 0 && top > s - 1e-7))) {
        s = top > s ? top : s; _supRamp = isRamp ? 1 : 0;
        if (isRamp && (x < T.lx0[i] || x > T.lx1[i] || z < T.lz0[i] || z > T.lz1[i])) _marginUse = 1;
      }
    }
    return s;
  }

  /** supportT with its numbers in _tq ([0] x, [1] z, [2] y, [3] H) and the answer in _tq[4]: the same expressions, term for term (hop's per-step calls: a call
   *  that is not inlined boxes its double arguments and its result) */
  var _tq = new Float64Array(5);
  function supportTQ(T, items, a, b) {
    var x = _tq[0], z = _tq[1], y = _tq[2], s = _tq[3];
    for (var k = a; k < b; k++) {
      var i = items[k], kd = T.lk[i];
      if (kd >= 2) continue;
      var m = (kd === 1 && _strictRamp === 1) ? 0 : SUP_MARGIN;
      var x0 = T.lx0[i], x1 = T.lx1[i], z0 = T.lz0[i], z1 = T.lz1[i];
      if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) continue;
      var isRamp = kd === 1, top;
      if (isRamp) { var dr = T.ld[i], fr; if (dr === 0) fr = (x - x0) / Math.max(0.01, x1 - x0); else if (dr === 1) fr = (x1 - x) / Math.max(0.01, x1 - x0); else if (dr === 2) fr = (z - z0) / Math.max(0.01, z1 - z0); else fr = (z1 - z) / Math.max(0.01, z1 - z0);
        top = T.ly0[i] + (T.ly1[i] - T.ly0[i]) * (fr < 0 ? 0 : fr > 1 ? 1 : fr); } else top = T.ly1[i];
      if (top <= y + STEP_G && (top > s + 1e-7 || (isRamp && _supRamp === 0 && top > s - 1e-7))) {
        s = top > s ? top : s; _supRamp = isRamp ? 1 : 0;
        if (isRamp && (x < x0 || x > x1 || z < z0 || z > z1)) _marginUse = 1;
      }
    }
    _tq[4] = s;
  }

  /** rampBlocksT with its numbers in _rbq ([0] x, [1] z, [2] yd, [3] rad): the same expressions (the per-step callers: no boxed call) */
  var _rbq = new Float64Array(4);
  function rampBlocksTQ(T, i) {
    var x = _rbq[0], z = _rbq[1], yd = _rbq[2], rad = _rbq[3];
    var x0 = T.lx0[i], x1 = T.lx1[i], z0 = T.lz0[i], z1 = T.lz1[i];
    var qx = x < x0 ? x0 : x > x1 ? x1 : x;
    var qz = z < z0 ? z0 : z > z1 ? z1 : z;
    var ex = x - qx, ez = z - qz;
    if (ex * ex + ez * ez >= rad * rad) return false;
    var dir = T.ld[i], along, uc, ev;
    if (dir === 0) { along = x1 - x0; uc = x - x0; ev = ez; }
    else if (dir === 1) { along = x1 - x0; uc = x1 - x; ev = ez; }
    else if (dir === 2) { along = z1 - z0; uc = z - z0; ev = ex; }
    else { along = z1 - z0; uc = z1 - z; ev = ex; }
    var al = along > 0.01 ? along : 0.01;
    var k = (T.ly1[i] - T.ly0[i]) / al;
    var uN = uc < 0 ? 0 : uc > al ? al : uc;
    if (T.ly0[i] + k * uN <= yd + STEP_G) return false;
    var reach = rad * rad - ev * ev;
    reach = reach > 0 ? Math.sqrt(reach) : 0;
    var uLow = uc - reach;
    if (uLow < 0) uLow = 0; else if (uLow > al) uLow = al;
    return T.ly0[i] + k * uLow - RAMP_THICK * 0.5 * Math.sqrt(1 + k * k) < yd + HEIGHT_G;
  }

  /** sim rampBlocks (C-RAMP), over a tile's local arrays. */
  function rampBlocksT(T, i, x, z, yd, rad) {
    x = +x; z = +z; yd = +yd; rad = +rad;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var x0 = T.lx0[i], x1 = T.lx1[i], z0 = T.lz0[i], z1 = T.lz1[i];
    var qx = x < x0 ? x0 : x > x1 ? x1 : x;
    var qz = z < z0 ? z0 : z > z1 ? z1 : z;
    var ex = x - qx, ez = z - qz;
    if (ex * ex + ez * ez >= rad * rad) return false;
    var dir = T.ld[i], along, uc, ev;
    if (dir === 0) { along = x1 - x0; uc = x - x0; ev = ez; }
    else if (dir === 1) { along = x1 - x0; uc = x1 - x; ev = ez; }
    else if (dir === 2) { along = z1 - z0; uc = z - z0; ev = ex; }
    else { along = z1 - z0; uc = z1 - z; ev = ex; }
    var al = along > 0.01 ? along : 0.01;
    var k = (T.ly1[i] - T.ly0[i]) / al;
    var uN = uc < 0 ? 0 : uc > al ? al : uc;
    if (T.ly0[i] + k * uN <= yd + STEP_G) return false;
    var reach = rad * rad - ev * ev;
    reach = reach > 0 ? Math.sqrt(reach) : 0;
    var uLow = uc - reach;
    if (uLow < 0) uLow = 0; else if (uLow > al) uLow = al;
    return T.ly0[i] + k * uLow - RAMP_THICK * 0.5 * Math.sqrt(1 + k * k) < yd + HEIGHT_G;
  }

  /** player.js blockedIn without the "already inside" leniency (conservative): does a capsule of radius rad, standing
   *  on yd, overlap a collider that is above step reach and below the head? */
  function blockedT(T, items, a, b, x, z, yd, rad) {
    x = +x; z = +z; yd = +yd; rad = +rad;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var r2 = rad * rad;
    for (var k = a; k < b; k++) {
      var i = items[k];
      if (T.lk[i] === 1) { _rbq[0] = x; _rbq[1] = z; _rbq[2] = yd; _rbq[3] = rad; if (rampBlocksTQ(T, i)) return true; continue; }
      if (T.ly1[i] <= yd + (T.lk[i] === 3 ? TALL_LIFT : STEP_G) || T.ly0[i] >= yd + HEIGHT_G) continue;
      var x0 = T.lx0[i], x1 = T.lx1[i], z0 = T.lz0[i], z1 = T.lz1[i];
      var ex = x - (x < x0 ? x0 : x > x1 ? x1 : x), ez = z - (z < z0 ? z0 : z > z1 ? z1 : z);
      if (ex * ex + ez * ez < r2) return true;
    }
    return false;
  }

  // supportT + blockedT in ONE pass over a cell's colliders (Wave 7 round 2, lane D4): the bake's replay asks for the support under the walker and then whether
  // the capsule fits, at the same point, twice a step; the two passes read the same rectangles. An item that is farther than the capsule radius from the point
  // (horizontally) neither holds anybody up (the support margin 0.3 is inside the radius 0.45) nor blocks: it is dropped by one test. The items that survive are
  // judged by the SAME expressions supportT / blockedT use (so the answer, and the _supRamp / _marginUse side effects, are bit for bit what the two calls gave); the
  // block test runs after the support is known (it needs the feet height yd = max(yq, support)). Result: the support; _sbBlk = 1 when the capsule is blocked.
  var _sbBlk = 0;
  var _sbN = new Int32Array(48);
  // ── ZERO-GARBAGE CALLS (Wave 7b, lane S1) ──────────────────────────────────────────────────────────────────────────
  // A call V8 did not inline boxes every double argument and the returned double; hop() replays the mover in 10 cm steps and asked the map's
  // heightAt and supBlock with numbers at every step (framecheck: hop + supBlock + maps.js heightAt 6-10 KB of garbage a frame while bots
  // plan through towns). hop passes them through these Float64Arrays instead: the SAME expressions on the same numbers, bit for bit.
  //   _hq: [0] x, [1] z -> hfQ -> [2] the terrain height (T.hf(x, z))
  //   _sq: [0] x, [1] z, [2] yq, [3] H, [4] rad -> supBlockQ -> [5] the support (supBlock's result; _sbBlk as before)
  var _hq = new Float64Array(3), _sq = new Float64Array(6);
  /** The terrain read of a tile's height function without a call: when the function carries the map's baked lattice (fn.ground =
   *  { lattice, latN } and fn.size, set by bots.js on the function it hands the world) the read is maps.js TerrainField.at itself, term for
   *  term; it is used only after 600 points of the function agreed with it exactly (===), else hfQ calls the function as before. */
  function latFor(fn) {
    if (typeof fn !== "function") return null;
    if (fn._ngLat !== undefined) return fn._ngLat;
    var g = fn.ground, size = fn.size, out = null;
    if (g && g.lattice && g.latN > 1 && size > 0) {
      out = { L: g.lattice, n: g.latN, c: g.latN - 1, k: (g.latN - 1) / size, h: size / 2 };
      var sd = 12345;
      for (var i = 0; i < 600 && out; i++) {
        sd = (Math.imul(sd, 1103515245) + 12345) >>> 0; var u = sd / 4294967296;
        sd = (Math.imul(sd, 1103515245) + 12345) >>> 0; var v = sd / 4294967296;
        var x = (u - 0.5) * size * 1.1, z = (v - 0.5) * size * 1.1;
        if (i % 3 === 0) x = Math.round(x / (size / out.c)) * (size / out.c);
        if (i % 5 === 0) z = Math.round(z / (size / out.c)) * (size / out.c);
        _hq[0] = x; _hq[1] = z; latRead(out);
        if (_hq[2] !== fn(x, z)) out = null;
      }
    }
    try { fn._ngLat = out; } catch (e) { /* a frozen function: no cache */ }
    return out;
  }
  /** maps.js TerrainField.at over a bound lattice: _hq[0], _hq[1] -> _hq[2] */
  function latRead(G) {
    var L = G.L, C = G.c, N = G.n;
    var fx = (_hq[0] + G.h) * G.k, fz = (_hq[1] + G.h) * G.k;
    fx = Math.min(Math.max(fx, 0), C); fz = Math.min(Math.max(fz, 0), C);      // (final/nav) not the nested ?: (boxed by Maglev, see supBlockQ); equal up to the sign of a zero
    var ix = fx | 0, iz = fz | 0;
    if (ix >= C) ix = C - 1;
    if (iz >= C) iz = C - 1;
    var u = fx - ix, v = fz - iz, i = iz * N + ix;
    if (u + v <= 1) { _hq[2] = L[i] + u * (L[i + 1] - L[i]) + v * (L[i + N] - L[i]); return; }
    var h11 = L[i + N + 1];
    _hq[2] = h11 + (1 - u) * (L[i + N] - h11) + (1 - v) * (L[i + 1] - h11);
  }
  /** T.hf(_hq[0], _hq[1]) -> _hq[2] */
  function hfQ(T) {
    var G = T.hl;
    if (G) latRead(G);
    else _hq[2] = T.hf(_hq[0], _hq[1]);
  }
  function supBlock(T, items, a, b, x, z, yq, H, rad) {
    _sq[0] = x; _sq[1] = z; _sq[2] = yq; _sq[3] = H; _sq[4] = rad;
    supBlockQ(T, items, a, b);
    return _sq[5];
  }
  function supBlockQ(T, items, a, b) {
    var x = _sq[0], z = _sq[1], yq = _sq[2], H = _sq[3], rad = _sq[4];
    var lx0 = T.lx0, lx1 = T.lx1, lz0 = T.lz0, lz1 = T.lz1, lk = T.lk;
    var r2 = rad * rad, s = H, nn = 0, over = false, strict = _strictRamp === 1;
    for (var k = a; k < b; k++) {
      var i = items[k];
      var x0 = lx0[i], x1 = lx1[i], z0 = lz0[i], z1 = lz1[i];
      // (final/nav) the clamp as Math.min / Math.max: the nested ?: form is a phi of a phi, which V8 14's mid tier (Maglev) keeps boxed - a fresh heap number
      // per collider per step while the replay runs there (V8 14.8 under --no-turbofan: supBlockQ 29.9 -> 3.9 B a step; Chrome 156's V8 boxes elsewhere in
      // this function either way). Equal for every box with minX <= maxX (every collider of 15 builds, 3 maps x 5 seeds) up to the sign of a zero (ex is squared).
      var ex = x - Math.min(Math.max(x, x0), x1), ez = z - Math.min(Math.max(z, z0), z1);
      if (!(ex * ex + ez * ez < r2)) continue;
      if (nn < 48) _sbN[nn++] = i; else over = true;
      var kd = lk[i];
      if (kd >= 2) continue;                            // a blocker (2) / tall furniture (3) is never a floor
      var m = (kd === 1 && strict) ? 0 : SUP_MARGIN;
      if (x < x0 - m || x > x1 + m || z < z0 - m || z > z1 + m) continue;
      var isRamp = kd === 1;
      var top;
      if (isRamp) { var dr = T.ld[i], fr; if (dr === 0) fr = (x - x0) / Math.max(0.01, x1 - x0); else if (dr === 1) fr = (x1 - x) / Math.max(0.01, x1 - x0); else if (dr === 2) fr = (z - z0) / Math.max(0.01, z1 - z0); else fr = (z1 - z) / Math.max(0.01, z1 - z0);
        top = T.ly0[i] + (T.ly1[i] - T.ly0[i]) * (fr < 0 ? 0 : fr > 1 ? 1 : fr); } else top = T.ly1[i];
      if (top <= yq + STEP_G && (top > s + 1e-7 || (isRamp && _supRamp === 0 && top > s - 1e-7))) {
        s = top > s ? top : s; _supRamp = isRamp ? 1 : 0;
        if (isRamp && (x < x0 || x > x1 || z < z0 || z > z1)) _marginUse = 1;
      }
    }
    var yd = yq > s ? yq : s;
    if (over) _sbBlk = blockedT(T, items, a, b, x, z, yd, rad) ? 1 : 0;
    else {
      var blk = 0;
      for (var q = 0; q < nn && blk === 0; q++) {
        var j = _sbN[q];
        if (lk[j] === 1) { _rbq[0] = x; _rbq[1] = z; _rbq[2] = yd; _rbq[3] = rad; if (rampBlocksTQ(T, j)) blk = 1; continue; }
        if (T.ly1[j] <= yd + (lk[j] === 3 ? TALL_LIFT : STEP_G) || T.ly0[j] >= yd + HEIGHT_G) continue;
        blk = 1;                                         // within the radius horizontally (the test above) and in the vertical band
      }
      _sbBlk = blk;
    }
    _sq[5] = s;
  }

  /** The clearance tier of a standing capsule (radius `rad`, feet on yd) at (x, z): -1 = it does not fit; else how many of the fatter capsules (RADIUS + 0.1 / 0.2 / 0.3) fit as well
   *  (0..3). The bake used to ask blockedT four times in a row, each a full pass over the cell's colliders. blocked(r) only grows with r (a box blocks when its distance is under r; a
   *  ramp's reach grows with r), so one pass finds the nearest box (squared horizontal distance) and sets the ramps aside, and each radius is then a comparison and, for the ramps, the
   *  same rampBlocksT call blockedT makes. Same expressions as blockedT: the answers are the same. */
  var _ctR = new Int32Array(32);
  var _ctq = new Float64Array(4);
  function clearTier(T, items, a, b, x, z, yd, rad) { _ctq[0] = x; _ctq[1] = z; _ctq[2] = yd; _ctq[3] = rad; return clearTierQ(T, items, a, b); }
  function clearTierQ(T, items, a, b) {
    var x = _ctq[0], z = _ctq[1], yd = _ctq[2], rad = _ctq[3];      // (Wave 8, I2: the numbers come through _ctq - a call boxes double arguments)
    x = +x; z = +z; yd = +yd; rad = +rad;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var lx0 = T.lx0, lx1 = T.lx1, lz0 = T.lz0, lz1 = T.lz1, ly0 = T.ly0, ly1 = T.ly1, lk = T.lk;
    var d2min = 1e30, nr = 0, over = false;
    for (var k = a; k < b; k++) {
      var i = items[k];
      if (lk[i] === 1) { if (nr < 32) _ctR[nr++] = i; else over = true; continue; }
      if (ly1[i] <= yd + (lk[i] === 3 ? TALL_LIFT : STEP_G) || ly0[i] >= yd + HEIGHT_G) continue;
      var x0 = lx0[i], x1 = lx1[i], z0 = lz0[i], z1 = lz1[i];
      var ex = x - (x < x0 ? x0 : x > x1 ? x1 : x), ez = z - (z < z0 ? z0 : z > z1 ? z1 : z);
      var d2 = ex * ex + ez * ez;
      if (d2 < d2min) d2min = d2;
    }
    if (over) {                                                 // more ramps than the scratch holds (never seen): the long way
      if (blockedT(T, items, a, b, x, z, yd, rad)) return -1;
      if (blockedT(T, items, a, b, x, z, yd, RADIUS + 0.1)) return 0;
      if (blockedT(T, items, a, b, x, z, yd, RADIUS + 0.2)) return 1;
      return blockedT(T, items, a, b, x, z, yd, RADIUS + 0.3) ? 2 : 3;
    }
    var r, q, blk;
    for (var step = 0; step < 4; step++) {
      r = step === 0 ? rad : RADIUS + 0.1 * step;
      blk = d2min < r * r;
      _rbq[0] = x; _rbq[1] = z; _rbq[2] = yd; _rbq[3] = r;
      for (q = 0; q < nr && !blk; q++) if (rampBlocksTQ(T, _ctR[q])) blk = true;
      if (blk) return step === 0 ? -1 : step - 1;
    }
    return 3;
  }

  function cellOf(T, x, z) {
    x = +x; z = +z;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var ix = ((x - T.minX) * T.inv) | 0, iz = ((z - T.minZ) * T.inv) | 0;
    if (ix >= T.nx) ix = T.nx - 1; if (iz >= T.nz) iz = T.nz - 1;
    return iz * T.nx + ix;
  }

  var _hr = new Float64Array(6);   // hop result: [0] end y, [1] ticks spent more than BIG_GAP above any support, [2] a ramp carried the feet, [3] the lowest feet height on the way, [4] ticks the feet were in the air (more than 2 cm over the support after landing), [5] 1 when a ramp's 0.3 m side margin held or lifted the walker at any point
  var _cnt = new Float64Array(4);  // diagnostics: [0] hops run, [1] 10 cm steps replayed, [2] terrain reads

  /** Replay the mover along the straight horizontal line (ax,az) -> (bx,bz), feet starting at ay, one 60 Hz tick per
   *  0.1 m (a walking bot), X then Z, support after each tick, gravity. Then let the feet settle. true = never blocked;
   *  the result is in _hr. W is the world (tiles are looked up as the line leaves T0) or null (stay inside T0).
   *  fN >= 0: T0's colliders `fItems[0..fN)` are the ONLY ones that can touch this hop (the bake builds that list
   *  once per hop: the vertical band and the corridor it can reach); fN < 0: read each cell's own list as the line goes. */
  /** hop with its numbers in _hp ([0] ax, [1] ay, [2] az, [3] bx, [4] bz, [5] rad): the hot callers pass them through the array (a call boxes double
   *  arguments: the bake's garbage). The numbers are read at entry, so a nested replay that refills _hp changes nothing here. */
  var _hp = new Float64Array(6);
  function hop(W, T0, ax, ay, az, bx, bz, rad, fItems, fN) { _hp[0] = ax; _hp[1] = ay; _hp[2] = az; _hp[3] = bx; _hp[4] = bz; _hp[5] = rad; return hopQ(W, T0, fItems, fN); }
  function hopQ(W, T0, fItems, fN) {
    var ax = _hp[0], ay = _hp[1], az = _hp[2], bx = _hp[3], bz = _hp[4], rad = _hp[5];
    var dx = bx - ax, dz = bz - az;
    var L = Math.sqrt(dx * dx + dz * dz), rest = _rest === 1 && L > 1e-9;
    var n = rest ? restTicks(L) : Math.ceil(L / HOP_STEP);
    if (n < 1) n = 1;
    _cnt[0]++; _cnt[1] += n;
    var T = T0, x = ax, y = ay, z = az, vy = 0, bigTicks = 0, airTicks = 0, usedRamp = 0, sup = ay, Hz = ay, ci, a = 0, b = 0, yd, items = fItems;
    var fixed = fN >= 0;
    if (fixed) { a = 0; b = fN; }
    var gT = false;                       // feet ride the terrain across OPEN ground and y is not evaluated until the line leaves it
    var yMin = ay, air = false, yq;
    // AIR: the replay and the mover agree to a few millimetres on where the feet are, and a walker that is FALLING (down a steep slope, off a lip, past a stair
    // side) loses a lift within a tick or two: at the tick the line enters a support margin, 6 mm either way decides whether the mover is still high enough to be
    // caught by a deck 0.5 m above it (11 of 15 residual disagreements in 9 million segments were this). So an airborne walker is judged AIR_PAD lower by the
    // support and the blocking tests (one tick of fall); a grounded one is not.
    _marginUse = 0;
    var water = T0.deepY > -1e8;
    // (final/nav) the fields of the tile the line is in, as locals: read once per tile, not twice a step (each read of a tile field was a property load; see tileShell)
    var tMinX = T.minX, tMaxX = T.maxX, tMinZ = T.minZ, tMaxZ = T.maxZ, tInv = T.inv, tCell = T.cell, tNx = T.nx, tNz = T.nz, tNS = T.nearStart, tNI = T.nearItems, tDeep = T.deepY, tWet = T.wetY;
    for (var s = 1; s <= n; s++) {
      var f = rest ? (s >= n ? 1 : (s <= REST_N ? REST_D[s] : REST_D[REST_N] + (s - REST_N) * HOP_STEP) / L) : s / n, px = ax + dx * f, pz = az + dz * f;      // (restDist, inlined)
      // X move (the destination floor decides the band, player.js blockedIn)
      if (!fixed) {
        if (px < tMinX || px >= tMaxX || z < tMinZ || z >= tMaxZ) { T = W ? (_tf[0] = px, _tf[1] = z, tileForQ(W, true)) : null; if (T === null) return false; tMinX = T.minX; tMaxX = T.maxX; tMinZ = T.minZ; tMaxZ = T.maxZ; tInv = T.inv; tCell = T.cell; tNx = T.nx; tNz = T.nz; tNS = T.nearStart; tNI = T.nearItems; tDeep = T.deepY; tWet = T.wetY; }
        { var cix0 = ((px - tMinX) * tInv) | 0, ciz0 = ((z - tMinZ) * tInv) | 0; if (cix0 >= tNx) cix0 = tNx - 1; if (ciz0 >= tNz) ciz0 = tNz - 1; ci = ciz0 * tNx + cix0; }      // (cellOf, inlined: no boxed call per step)
        a = tNS[ci]; b = tNS[ci + 1]; items = tNI;
      }
      if (b > a) {
        if (gT) { _hq[0] = x; _hq[1] = z; hfQ(T); y = _hq[2]; gT = false; vy = 0; air = false; }
        yq = air ? y - AIR_PAD : y;
        _hq[0] = px; _hq[1] = z; hfQ(T);
        _sq[0] = px; _sq[1] = z; _sq[2] = yq; _sq[3] = _hq[2]; _sq[4] = rad; supBlockQ(T, items, a, b);
        sup = _sq[5];
        if (_sbBlk === 1) return false;
      }
      x = px;
      // Z move
      if (!fixed) {
        if (x < tMinX || x >= tMaxX || pz < tMinZ || pz >= tMaxZ) { T = W ? (_tf[0] = x, _tf[1] = pz, tileForQ(W, true)) : null; if (T === null) return false; tMinX = T.minX; tMaxX = T.maxX; tMinZ = T.minZ; tMaxZ = T.maxZ; tInv = T.inv; tCell = T.cell; tNx = T.nx; tNz = T.nz; tNS = T.nearStart; tNI = T.nearItems; tDeep = T.deepY; tWet = T.wetY; }
        { var cix1 = ((x - tMinX) * tInv) | 0, ciz1 = ((pz - tMinZ) * tInv) | 0; if (cix1 >= tNx) cix1 = tNx - 1; if (ciz1 >= tNz) ciz1 = tNz - 1; ci = ciz1 * tNx + cix1; }
        a = tNS[ci]; b = tNS[ci + 1]; items = tNI;
      }
      if (b === a && !fixed) {
        // OPEN cell: nothing within reach of the capsule, so nothing blocks, nothing lifts, the floor is the terrain. Over GENTLE ground the feet ride it
        // (glued: the mover lands every tick), and then the replay jumps to the last step inside this cell (the terrain is read again where the line leaves
        // open ground). Over ground that drops faster than the mover can follow (more than GLUE_DROP a tick: a 0.26 slope at full speed, any slope once the
        // mover has speed) the feet LEAVE it and fall, and arrive at the next feature higher than the terrain and with a downward speed: simulated tick by tick.
        _hq[0] = x; _hq[1] = z; hfQ(T);
        var hS = _hq[2];
        if (gT) {
          var cix = ci % tNx, ciz = (ci - cix) / tNx;
          var tx1 = dx > 1e-12 ? (tMinX + (cix + 1) * tCell - ax) / dx : dx < -1e-12 ? (tMinX + cix * tCell - ax) / dx : 1e30;
          var tz1 = dz > 1e-12 ? (tMinZ + (ciz + 1) * tCell - az) / dz : dz < -1e-12 ? (tMinZ + ciz * tCell - az) / dz : 1e30;
          var tEx = tx1 < tz1 ? tx1 : tz1;
          var sLast = rest ? restTicks(tEx * L) - 1 : Math.ceil(tEx * n) - 1;
          if (sLast > n) sLast = n;
          if (sLast > s) {
            var jf = rest ? (sLast <= REST_N ? REST_D[sLast] : REST_D[REST_N] + (sLast - REST_N) * HOP_STEP) / L : sLast / n, jx = ax + dx * jf, jz = az + dz * jf;
            // the terrain can dip under the swim line between two checked points: jump only where it is clear of the line at both ends,
            // else walk the steps one by one with the swim test (the mover swims the moment the ground under it is DEEP)
            _hq[0] = jx; _hq[1] = jz; hfQ(T);
            var hJ = _hq[2];
            if (!(hS - hS === 0) || !(hJ - hJ === 0)) return false;                      // no ground height at either end of the jump (NaN, infinite): nobody walks there
            var jl = Math.sqrt((jx - x) * (jx - x) + (jz - z) * (jz - z));
            if ((hS - hJ) <= JUMP_SLOPE * jl && (!water || (hS >= tDeep + WATER_GUARD && hJ >= tDeep + WATER_GUARD))) { s = sLast; x = jx; z = jz; continue; }
          }
          _hq[0] = x; _hq[1] = pz; hfQ(T);
          var hN = _hq[2];
          if (!(hN - hN === 0)) return false;
          if (hS - hN <= GLUE_DROP) {                       // still glued to the ground: one more step on it
            if (water && hN < tDeep) return false;
            z = pz;
            continue;
          }
          y = hS; vy = 0; gT = false; air = false;          // the ground falls away faster than the feet can follow
        }
        _hq[0] = x; _hq[1] = pz; hfQ(T);
        Hz = _hq[2];
        if (!(Hz - Hz === 0)) return false;
        vy += GRAVITY * TICK; y += vy * TICK;
        if (water && Hz < tDeep && (air ? y - AIR_PAD : y) <= tWet) return false;
        sup = Hz;
        if (y <= Hz + 0.02) { y = Hz; vy = 0; air = false; gT = (hS - Hz) <= GLUE_DROP; } else { air = true; airTicks++; if (y - Hz > BIG_GAP) bigTicks++; }
        z = pz;
        continue;
      }
      if (gT) { _hq[0] = x; _hq[1] = z; hfQ(T); y = _hq[2]; gT = false; vy = 0; air = false; }
      _hq[0] = x; _hq[1] = pz; hfQ(T);
      Hz = _hq[2];
      if (water && Hz < tDeep && (air ? y - AIR_PAD : y) <= tWet) return false;          // swimming (player.js: deep terrain under feet at the surface)
      var sr0 = _supRamp;                  // the ramp flag this support call starts from (see the gravity step below)
      if (b > a) {
        yq = air ? y - AIR_PAD : y;
        _sq[0] = x; _sq[1] = pz; _sq[2] = yq; _sq[3] = Hz; _sq[4] = rad; supBlockQ(T, items, a, b);
        sup = _sq[5];
        if (_sbBlk === 1) return false;
      }
      z = pz;
      // gravity, integrate, land on the support (player.js stepActor)
      // A walker that stood on the floor a tick ago sinks 6 mm in this tick's gravity before the support test, so the mover lifts a step of at
      // most 0.55 - 0.006 and BLOCKS nothing between that and 0.55 (a ghost step: the capsule just walks into it). The grid has no such
      // band: a grounded walker's reach is measured from where it stood, the same STEP_G the blocking test uses, so a step is either
      // a lift or a wall (a 0.538 m step between two flush slabs used to be neither, and the mover climbed what the grid walked through).
      var yStood = y;
      vy += GRAVITY * TICK; y += vy * TICK;
      if (b > a) {
        // the support under the feet after the move: the SAME question the Z-move just asked (same point, same feet height, same ground) when the walker is not in the air
        // (yStood = the height that call used), and its answer is the same too - when that call started from a clear ramp flag, which is what this one forces: then it
        // IS this call, side effects included, and is not run twice. (From a set flag the tie rule differs, so the full call runs.)
        if (!air && sr0 === 0) { if (_supRamp === 1 && sup >= y - 0.02) usedRamp = 1; }
        else { _supRamp = 0; _tq[0] = x; _tq[1] = z; _tq[2] = air ? y - AIR_PAD : yStood; _tq[3] = Hz; supportTQ(T, items, a, b); sup = _tq[4]; if (_supRamp === 1 && sup >= y - 0.02) usedRamp = 1; }
      }
      else sup = Hz;
      if (y <= sup + 0.02) { y = sup; vy = 0; air = false; } else { air = true; airTicks++; if (y - sup > BIG_GAP) bigTicks++; }
      if (y < yMin) yMin = y;
    }
    if (gT) { _hq[0] = x; _hq[1] = z; hfQ(T); y = _hq[2]; }
    else if (y > sup + 0.02) {      // the horizontal run is over and the feet are in the air (a drop): they fall straight down onto the highest top under them
      var land = Hz;
      if (b > a) { _tq[0] = x; _tq[1] = z; _tq[2] = y; _tq[3] = Hz; supportTQ(T, items, a, b); land = _tq[4]; }
      if (y - land > BIG_GAP) bigTicks += 30;                  // it left the walk and fell to something far below
      airTicks++;
      y = land;
    }
    if (y < yMin) yMin = y;
    if (y !== y) return false;                                      // the ground under the line has no height: nobody walks there
    _hr[0] = y; _hr[1] = bigTicks; _hr[2] = usedRamp; _hr[3] = yMin; _hr[4] = airTicks; _hr[5] = _marginUse;
    return true;
  }

  /** hop() three times: on the line and shifted JITTER to either side (both ends). The ramp margin lift (supportIn holds a walker
   *  up 0.3 m past a footprint) and the 0.55 step are hairline conditions; an edge that works only on the exact line fails in a
   *  walker that is 5 cm off it (measured: a mall stair entered from a node sitting exactly on the margin boundary). */
  function hopJ(W, T0, ax, ay, az, bx, bz, rad, fItems, fN, by) {
    ax = +ax; ay = +ay; az = +az; bx = +bx; bz = +bz; rad = +rad; by = +by;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    if (!(_hp[0] = ax, _hp[1] = ay, _hp[2] = az, _hp[3] = bx, _hp[4] = bz, _hp[5] = rad, hopQ(W, T0, fItems, fN))) return false;
    if (Math.abs(_hr[0] - by) > FLOOR_TOL) return false;
    var y0 = _hr[0], g0 = _hr[1], r0 = _hr[2], m0 = _hr[3], a0 = _hr[4], u0 = _hr[5];
    var dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz);
    if (L > 1e-6) {
      var ux = -dz / L * JITTER, uz = dx / L * JITTER;
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        if (!(_hp[0] = ax + sgn * ux, _hp[1] = ay, _hp[2] = az + sgn * uz, _hp[3] = bx + sgn * ux, _hp[4] = bz + sgn * uz, _hp[5] = rad, hopQ(W, T0, fItems, fN))) return false;
        if (Math.abs(_hr[0] - by) > FLOOR_TOL) return false;
      }
    }
    _hr[0] = y0; _hr[1] = g0; _hr[2] = r0; _hr[3] = m0; _hr[4] = a0; _hr[5] = u0;
    return true;
  }

  /** The hop just run (result in _hr) used the real mover's 0.3 m support margin around ramps. Run it again WITHOUT that margin: the
   *  edge stands only if it still lands on the same floor. A walker lifted onto a ramp from its side, or caught by a ramp's margin
   *  while falling past it, is a result that exists at exact positions only. */
  function sameWithoutRampMargin(W, T0, ax, ay, az, bx, bz, rad, items, n) {
    ax = +ax; ay = +ay; az = +az; bx = +bx; bz = +bz; rad = +rad;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var y0 = _hr[0], g0 = _hr[1], r0 = _hr[2], m0 = _hr[3], a0 = _hr[4], u0 = _hr[5];
    _strictRamp = 1;
    var ok = (_hp[0] = ax, _hp[1] = ay, _hp[2] = az, _hp[3] = bx, _hp[4] = bz, _hp[5] = rad, hopQ(W, T0, items, n));
    _strictRamp = 0;
    var agree = ok && Math.abs(_hr[0] - y0) <= 0.1;
    _hr[0] = y0; _hr[1] = g0; _hr[2] = r0; _hr[3] = m0; _hr[4] = a0; _hr[5] = u0;
    return agree;
  }

  /** The hop just run (result in _hr) left the ground or rode a ramp. The mover accelerates, so a walker that starts from REST spends other ticks in
   *  the air over a ledge, a stair side or a steep slope. Run the same walk from a standstill: the edge / leg stands only if it ends on the same
   *  floor. (An edge that works at speed only is the one a bot gets stuck on at a waypoint: it stops at the lip, lifts too little, walks into the deck.) */
  function restAgrees(W, T0, ax, ay, az, bx, bz, rad, items, n) {
    ax = +ax; ay = +ay; az = +az; bx = +bx; bz = +bz; rad = +rad;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var y0 = _hr[0], g0 = _hr[1], r0 = _hr[2], m0 = _hr[3], a0 = _hr[4], u0 = _hr[5];
    _rest = 1;
    var ok = (_hp[0] = ax, _hp[1] = ay, _hp[2] = az, _hp[3] = bx, _hp[4] = bz, _hp[5] = rad, hopQ(W, T0, items, n));
    _rest = 0;
    var agree = ok && _hr[1] <= MAX_WALK_GAP && Math.abs(_hr[0] - y0) <= FLOOR_AGREE;
    _hr[0] = y0; _hr[1] = g0; _hr[2] = r0; _hr[3] = m0; _hr[4] = a0; _hr[5] = u0;
    return agree;
  }

  /** The follower is never exactly on a node (a bot consumes a waypoint within 0.6 to 1.6 m of it): the leg to b must also work from
   *  the places a walker can stand within 0.4 m of a, along the leg and across it. A start that is itself blocked, or is a different
   *  floor (past a lip), is not a place this walker stands and is skipped. Used for ramp and drop edges, where the margin is thin. */
  function perturbOK(W, T0, ax, ay, az, bx, by, bz, rad, items, n) {
    ax = +ax; ay = +ay; az = +az; bx = +bx; by = +by; bz = +bz; rad = +rad;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz);
    if (L < 1e-6) return true;
    var ux = dx / L * PERTURB, uz = dz / L * PERTURB;
    var fixed = n >= 0;
    for (var k = 0; k < 4; k++) {
      var sx = ax + (k === 0 ? ux : k === 1 ? -ux : k === 2 ? -uz : uz), sz = az + (k === 0 ? uz : k === 1 ? -uz : k === 2 ? ux : -ux);
      var T = T0, its = items, a = 0, b = n;
      if (!fixed || sx < T0.minX || sx >= T0.maxX || sz < T0.minZ || sz >= T0.maxZ) {
        if (fixed && !W) continue;
        if (sx < T0.minX || sx >= T0.maxX || sz < T0.minZ || sz >= T0.maxZ) { T = (_tf[0] = sx, _tf[1] = sz, tileForQ(W, true)); if (T === null) continue; }
        var ci = cellOf(T, sx, sz); its = T.nearItems; a = T.nearStart[ci]; b = T.nearStart[ci + 1];
        fixed = false;
      }
      _hq[0] = sx; _hq[1] = sz; hfQ(T); var Hs = _hq[2], sup = Hs;
      if (b > a) { _tq[0] = sx; _tq[1] = sz; _tq[2] = ay; _tq[3] = Hs; supportTQ(T, its, a, b); sup = _tq[4]; }
      if (Math.abs(sup - ay) > 0.45) continue;                           // another floor: not a place this walker stands
      if (b > a && blockedT(T, its, a, b, sx, sz, sup, rad)) continue;   // inside something: not a place it stands either
      if (!(_hp[0] = sx, _hp[1] = sup, _hp[2] = sz, _hp[3] = bx, _hp[4] = bz, _hp[5] = rad, hopQ(W, T, fixed ? items : null, fixed ? n : -1))) return false;
      if (Math.abs(_hr[0] - by) > FLOOR_TOL) return false;
      fixed = n >= 0;
    }
    return true;
  }

  // the colliders that can touch one hop inside a tile: the union of the lists of the cells its bounding box covers, cut to
  // the vertical band the feet can occupy and to the corridor of the hop. A slab a storey above or a wall a storey below
  // never matters, which is most of what a multi-storey cell lists.
  var _bl = new Int32Array(512), _bn = 0, _mk = new Int32Array(0), _mkStamp = 0;
  var _hlq = new Float64Array(7);
  function hopList(T, ay, by, ax, az, bx, bz, rad, big) { _hlq[0] = ay; _hlq[1] = by; _hlq[2] = ax; _hlq[3] = az; _hlq[4] = bx; _hlq[5] = bz; _hlq[6] = rad; return hopListQ(T, big); }
  function hopListQ(T, big) {
    var ay = _hlq[0], by = _hlq[1], ax = _hlq[2], az = _hlq[3], bx = _hlq[4], bz = _hlq[5], rad = _hlq[6];      // (Wave 8, I2: the numbers come through _hlq - a call boxes double arguments)
    ay = +ay; by = +by; ax = +ax; az = +az; bx = +bx; bz = +bz; rad = +rad;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    if (_mk.length < T.m) _mk = new Int32Array(T.m + 64);
    var stamp = ++_mkStamp;
    if (stamp > 2000000000) { _mk.fill(0); _mkStamp = stamp = 1; }
    var ylo = (ay < by ? ay : by) - 0.05, yhi = (ay > by ? ay : by) + HEIGHT_G + STEP_G;
    var M = rad + 0.02 + (big ? SUP_MARGIN + PERTURB : 0);          // the capsule reaches rad, the support margin 0.3 < rad; a follower 0.4 m off the node (perturbOK) needs the wide corridor
    var sx0 = ax < bx ? ax : bx, sx1 = ax > bx ? ax : bx, sz0 = az < bz ? az : bz, sz1 = az > bz ? az : bz;
    var x0 = sx0 - M, x1 = sx1 + M, z0 = sz0 - M, z1 = sz1 + M;
    var i0 = ((sx0 - T.minX) * T.inv) | 0, i1 = ((sx1 - T.minX) * T.inv) | 0, k0 = ((sz0 - T.minZ) * T.inv) | 0, k1 = ((sz1 - T.minZ) * T.inv) | 0;
    if (i1 >= T.nx) i1 = T.nx - 1; if (k1 >= T.nz) k1 = T.nz - 1;
    _bn = 0;
    for (var iz = k0; iz <= k1; iz++) for (var ix = i0; ix <= i1; ix++) {
      var c = iz * T.nx + ix;
      for (var k = T.nearStart[c]; k < T.nearStart[c + 1]; k++) {
        var i = T.nearItems[k];
        if (_mk[i] === stamp) continue;
        _mk[i] = stamp;
        if (T.ly1[i] < ylo || T.ly0[i] >= yhi) continue;
        if (T.lx1[i] < x0 || T.lx0[i] > x1 || T.lz1[i] < z0 || T.lz0[i] > z1) continue;
        if (_bn < 512) _bl[_bn++] = i;
      }
    }
    return _bn;
  }

  // ── plain edges ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  // 91 % of the stored edges of a town's building tiles joined two terrain nodes (the yards and sidewalks beside the walls) or two nodes of one flat floor.
  // Those are PLAIN: one byte per node (T.adj, a bit per neighbour direction, the order of NB8X / NB8Z) says which of the 8 neighbour cells holds a walkable
  // neighbour, and the node it leads to is derived: the cell's terrain node (terrain -> terrain) or its node on the same level (floor -> floor within 2 cm).
  // The cost is derived too. Everything else (a ramp, a drop, a step between floor types) stays in the typed CSR (edgeStart / edgeTo / edgeCost / edgeKind).
  /** may the pair (a flagged fa at height ya, b flagged fb at height yb) be a PLAIN edge: what would a cell's destination be? */
  function plainRule(fa, fb, dy) {
    if (((fa | fb) & F_RAMP) !== 0) return false;
    var ta = (fa & F_TERR) !== 0, tb = (fb & F_TERR) !== 0;
    if (ta && tb) return true;
    return !ta && !tb && dy < 0.02 && dy > -0.02;
  }
  /** the node of cell cj that a plain edge from a node (flag fa, height ya) leads to, or -1 */
  function plainDest(T, fa, ya, cj) {
    var e = T.cellStart[cj + 1];
    for (var m = T.cellStart[cj]; m < e; m++) if (plainRule(fa, T.flag[m], T.y[m] - ya)) return m;
    return -1;
  }
  /** the cost of the plain edge n -> m of tile T (evalEdge's formula for a walk: terrain follows the slope, a floor is flat) */
  function plainCost(T, n, m) {
    var dx = T.x[m] - T.x[n], dz = T.z[m] - T.z[n], dy = T.y[m] - T.y[n], dxz = Math.sqrt(dx * dx + dz * dz), fa = T.flag[n], fb = T.flag[m];
    var c = Math.sqrt(dxz * dxz + dy * dy);
    if ((fa & F_TERR) !== 0) c *= 1 + 0.4 * Math.min(1, Math.abs(dy) / dxz);
    if (((fa | fb) & F_WET) !== 0) c *= WET_MULT;
    return c * ROB_MULT[(fb >> 4) & 3];
  }

  // ── the quiet corridor ───────────────────────────────────────────────────────────────────────────────────────────
  /** squared distance from the segment (ax,az)-(bx,bz) to the rectangle [x0,x1] x [z0,z1] (0 when they touch) */
  function segRectD2(ax, az, bx, bz, x0, x1, z0, z1) {
    ax = +ax; az = +az; bx = +bx; bz = +bz; x0 = +x0; x1 = +x1; z0 = +z0; z1 = +z1;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    // clip the segment against the rectangle (Liang-Barsky): any part inside = touching
    var dx = bx - ax, dz = bz - az, t0 = 0, t1 = 1, p, q, r;
    for (var e = 0; e < 4; e++) {
      if (e === 0) { p = -dx; q = ax - x0; } else if (e === 1) { p = dx; q = x1 - ax; } else if (e === 2) { p = -dz; q = az - z0; } else { p = dz; q = z1 - az; }
      if (p === 0) { if (q < 0) { t0 = 2; break; } }
      else { r = q / p; if (p < 0) { if (r > t1) { t0 = 2; break; } if (r > t0) t0 = r; } else { if (r < t0) { t0 = 2; break; } if (r < t1) t1 = r; } }
    }
    if (t0 <= t1) return 0;
    // otherwise the nearest points are an endpoint to the rectangle or a corner to the segment
    var best = 1e18, ex, ez, d2, i, cx, cz, L2 = dx * dx + dz * dz, t;
    ex = ax < x0 ? x0 - ax : ax > x1 ? ax - x1 : 0; ez = az < z0 ? z0 - az : az > z1 ? az - z1 : 0; d2 = ex * ex + ez * ez; if (d2 < best) best = d2;
    ex = bx < x0 ? x0 - bx : bx > x1 ? bx - x1 : 0; ez = bz < z0 ? z0 - bz : bz > z1 ? bz - z1 : 0; d2 = ex * ex + ez * ez; if (d2 < best) best = d2;
    for (i = 0; i < 4; i++) {
      cx = (i & 1) ? x1 : x0; cz = (i & 2) ? z1 : z0;
      t = L2 > 0 ? ((cx - ax) * dx + (cz - az) * dz) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      ex = cx - (ax + dx * t); ez = cz - (az + dz * t); d2 = ex * ex + ez * ez; if (d2 < best) best = d2;
    }
    return best;
  }
  /** segRectD2 over _sr ([0..3] the segment ax az bx bz, [4..7] the rectangle x0 x1 z0 z1): quietFlat's per-collider call without 8 boxed numbers */
  var _sr = new Float64Array(8);
  function segRectD2Q() { var ax = _sr[0], az = _sr[1], bx = _sr[2], bz = _sr[3], x0 = _sr[4], x1 = _sr[5], z0 = _sr[6], z1 = _sr[7];
    var dx = bx - ax, dz = bz - az, t0 = 0, t1 = 1, p, q, r;
    for (var e = 0; e < 4; e++) {
      if (e === 0) { p = -dx; q = ax - x0; } else if (e === 1) { p = dx; q = x1 - ax; } else if (e === 2) { p = -dz; q = az - z0; } else { p = dz; q = z1 - az; }
      if (p === 0) { if (q < 0) { t0 = 2; break; } }
      else { r = q / p; if (p < 0) { if (r > t1) { t0 = 2; break; } if (r > t0) t0 = r; } else { if (r < t0) { t0 = 2; break; } if (r < t1) t1 = r; } }
    }
    if (t0 <= t1) return 0;
    var best = 1e18, ex, ez, d2, i, cx, cz, L2 = dx * dx + dz * dz, t;
    ex = ax < x0 ? x0 - ax : ax > x1 ? ax - x1 : 0; ez = az < z0 ? z0 - az : az > z1 ? az - z1 : 0; d2 = ex * ex + ez * ez; if (d2 < best) best = d2;
    ex = bx < x0 ? x0 - bx : bx > x1 ? bx - x1 : 0; ez = bz < z0 ? z0 - bz : bz > z1 ? bz - z1 : 0; d2 = ex * ex + ez * ez; if (d2 < best) best = d2;
    for (i = 0; i < 4; i++) {
      cx = (i & 1) ? x1 : x0; cz = (i & 2) ? z1 : z0;
      t = L2 > 0 ? ((cx - ax) * dx + (cz - az) * dz) / L2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
      ex = cx - (ax + dx * t); ez = cz - (az + dz * t); d2 = ex * ex + ez * ez; if (d2 < best) best = d2;
    }
    return best;
  }
  var QUIET_SKIN = 0.07;         // the replay moves X then Z: its corner points leave the straight line by up to 5 cm
  var _qf = new Int32Array(64);
  /** Is the flat walk a -> b over the floor at height y a walk NOTHING can disturb? True only when the full replay is certain to succeed with the feet
   *  glued to the floor all the way: no ramp, no wall or head-height slab within the capsule (+ skin) of the line, no step within the support margin
   *  (it would lift the walker), the line lies on top of floor boxes at this very height, and the terrain stays under it. It decides nothing else:
   *  false means "run the replay". items = _bl[0..n), the colliders of the hop corridor (hopList). */
  var _qfq = new Float64Array(5);
  function quietFlat(T, y, ax, az, bx, bz, n) { _qfq[0] = y; _qfq[1] = ax; _qfq[2] = az; _qfq[3] = bx; _qfq[4] = bz; return quietFlatQ(T, n); }
  function quietFlatQ(T, n) {
    var y = _qfq[0], ax = _qfq[1], az = _qfq[2], bx = _qfq[3], bz = _qfq[4];      // (Wave 8, I2: the numbers come through _qfq - a call boxes double arguments)
    y = +y; ax = +ax; az = +az; bx = +bx; bz = +bz;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var nf = 0, k, i;
    var wallR2 = (RADIUS + BAKE_SKIN + QUIET_SKIN) * (RADIUS + BAKE_SKIN + QUIET_SKIN), liftR2 = (SUP_MARGIN + QUIET_SKIN) * (SUP_MARGIN + QUIET_SKIN);
    for (k = 0; k < n; k++) {
      i = _bl[k];
      var kd = T.lk[i];
      if (kd === 1) return false;                                   // a ramp near the line: run the replay
      var top = T.ly1[i], bot = T.ly0[i];
      if (bot >= y + HEIGHT_G) continue;                            // above the head: blocks nothing, holds nothing up
      if (kd === 3) { if (top > y + TALL_LIFT && (_sr[0] = ax, _sr[1] = az, _sr[2] = bx, _sr[3] = bz, _sr[4] = T.lx0[i], _sr[5] = T.lx1[i], _sr[6] = T.lz0[i], _sr[7] = T.lz1[i], segRectD2Q()) < wallR2) return false; continue; }     // tall furniture: a wall once over the feet, never a floor
      if (top <= y + STEP_G) {                                      // a step or the floor itself: never blocks
        if (kd === 2) continue;
        if (top >= y - 0.02 && top <= y + 0.02) { if (nf < 64) _qf[nf++] = i; else return false; }
        else if (top > y + 0.02 && (_sr[0] = ax, _sr[1] = az, _sr[2] = bx, _sr[3] = bz, _sr[4] = T.lx0[i] - 0, _sr[5] = T.lx1[i], _sr[6] = T.lz0[i], _sr[7] = T.lz1[i], segRectD2Q()) < liftR2) return false;     // would lift the walker
        continue;
      }
      if ((_sr[0] = ax, _sr[1] = az, _sr[2] = bx, _sr[3] = bz, _sr[4] = T.lx0[i], _sr[5] = T.lx1[i], _sr[6] = T.lz0[i], _sr[7] = T.lz1[i], segRectD2Q()) < wallR2) return false;                             // a wall within the capsule
    }
    if (nf === 0) return false;
    // the line stays on the floor boxes: every 8 cm sample lies inside one of them
    var dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz), ns = Math.ceil(L / 0.08) + 1;
    for (var s2 = 0; s2 <= ns; s2++) {
      var f = s2 / ns, px = ax + dx * f, pz = az + dz * f, inside = false;
      for (k = 0; k < nf; k++) { i = _qf[k]; if (px >= T.lx0[i] && px <= T.lx1[i] && pz >= T.lz0[i] && pz <= T.lz1[i]) { inside = true; break; } }
      if (!inside) return false;
    }
    // the ground under the floor does not rise to it (it would hold the walker up), nor reach the swim line below a dock
    var water = T.deepY > -1e8;
    for (s2 = 0; s2 <= 2; s2++) {
      var hx = ax + dx * 0.5 * s2, hz = az + dz * 0.5 * s2;
      _hq[0] = hx; _hq[1] = hz; hfQ(T); var Hh = _hq[2];
      if (!(Hh <= y + 0.02)) return false;
      if (water && Hh < T.deepY && y <= T.wetY) return false;
    }
    return true;
  }

  // ── edge classification (one place, used by the bake and by the tile stitching) ──────────────────────────────────
  var _ec = new Float64Array(2);   // [0] cost of the edge classified last

  /** The kind of the edge a -> b (EDGE_*), or -1 when the mover cannot make it (cost in _ec[0]). fa / fb = node flags.
   *  ca >= 0: both nodes are in tile T0 and the bake may cut the colliders to this hop; ca < 0: read each cell as the line goes. */
  var _eq = new Float64Array(6);
  function evalEdge(W, T0, ax, ay, az, fa, bx, by, bz, fb, ca, cb) { _eq[0] = ax; _eq[1] = ay; _eq[2] = az; _eq[3] = bx; _eq[4] = by; _eq[5] = bz; return evalEdgeQ(W, T0, fa, fb, ca, cb); }
  function evalEdgeQ(W, T0, fa, fb, ca, cb) {
    var ax = _eq[0], ay = _eq[1], az = _eq[2], bx = _eq[3], by = _eq[4], bz = _eq[5];      // (Wave 8, I2: the numbers come through _eq - a call boxes double arguments)
    ax = +ax; ay = +ay; az = +az; bx = +bx; by = +by; bz = +bz;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    var dx = bx - ax, dz = bz - az, dy = by - ay;
    var dxz = Math.sqrt(dx * dx + dz * dz);
    if (dxz < 1e-6) return -1;
    var len3 = Math.sqrt(dxz * dxz + dy * dy);
    var terr = (fa & F_TERR) !== 0 && (fb & F_TERR) !== 0;
    var rampInv = ((fa | fb) & F_RAMP) !== 0;
    var kind = EDGE_WALK, cost, rad = RADIUS + BAKE_SKIN;
    if (!terr) {
      // the cheap rejections come first: a floor a storey away is no neighbour, a climb needs a ramp, a fall needs a landing
      var rampDy = RAMP_SLOPE_MAX * dxz + 0.15;
      // a floor steps onto a ramp's RUN only level (a landing beside the stair); a higher step is the ramp's foot or top, its real entrances
      if (dy > 0.3 && (fb & F_RAMP) !== 0 && (fa & F_RAMP) === 0 && (fb & F_RAMPEND) === 0) return -1;
      if (dy > STEP_G + 1e-6) {
        if (!rampInv || dy > rampDy) return -1;            // no jump edges: climbing is a ramp or a step
      } else if (dy < -STEP_G - 1e-6) {
        if (!rampInv || -dy > rampDy) {
          if (-dy > DROP_MAX) return -1;
          kind = EDGE_DROP;
          // what a faller meets at b's column is the highest top at or below its feet: it must be b's floor
          var Tb = T0;
          if (bx < Tb.minX || bx >= Tb.maxX || bz < Tb.minZ || bz >= Tb.maxZ) { Tb = W ? (_tf[0] = bx, _tf[1] = bz, tileForQ(W, true)) : null; if (Tb === null) return -1; }
          var cbb = cellOf(Tb, bx, bz), sb = Tb.nearStart[cbb], eb = Tb.nearStart[cbb + 1];
          _hq[0] = bx; _hq[1] = bz; hfQ(Tb); var hb = _hq[2], land = hb;
          if (eb > sb) { _tq[0] = bx; _tq[1] = bz; _tq[2] = ay; _tq[3] = hb; supportTQ(Tb, Tb.nearItems, sb, eb); land = _tq[4]; }
          if (Math.abs(land - by) > FLOOR_TOL) return -1;
        }
      }
    }
    var ln = -1;
    // bake: only what can touch this hop (the capsule and the support margin reach 0.455 m). The follower checks (perturbOK starts a walker
    // 0.4 m off the node) need the wide corridor: it is built only where they run.
    if (ca >= 0) ln = (_hlq[0] = ay, _hlq[1] = by, _hlq[2] = ax, _hlq[3] = az, _hlq[4] = bx, _hlq[5] = bz, _hlq[6] = rad, hopListQ(T0, false));
    if (terr) {
      // terrain is followed at any slope (supportIn: terrain always counts); only a collider can refuse the hop
      if (ln !== 0) {
        if (!(_hp[0] = ax, _hp[1] = ay, _hp[2] = az, _hp[3] = bx, _hp[4] = bz, _hp[5] = rad, hopQ(W, T0, _bl, ln))) return -1;
        if (Math.abs(_hr[0] - by) > FLOOR_TOL) return -1;
        if (_hr[4] > 0 && !restAgrees(W, T0, ax, ay, az, bx, bz, rad, _bl, ln)) return -1;
      }
      cost = len3 * (1 + 0.4 * Math.min(1, Math.abs(dy) / dxz));
    } else {
      if (ln === 0) return -1;                             // a non-terrain floor with nothing under it: no such edge
      if (ln > 0 && kind === EDGE_WALK && !rampInv && dy < 0.02 && dy > -0.02 && (_qfq[0] = ay, _qfq[1] = ax, _qfq[2] = az, _qfq[3] = bx, _qfq[4] = bz, quietFlatQ(T0, ln))) {
        _hr[0] = by; _hr[1] = 0; _hr[2] = 0; _hr[3] = ay < by ? ay : by; _hr[4] = 0; _hr[5] = 0;        // the replay would walk it flat: skip it
      } else if (!(_hp[0] = ax, _hp[1] = ay, _hp[2] = az, _hp[3] = bx, _hp[4] = bz, _hp[5] = rad, hopQ(W, T0, _bl, ln))) return -1;
      if (Math.abs(_hr[0] - by) > FLOOR_TOL) return -1;    // the feet must land on the floor this edge claims
      if (kind !== EDGE_DROP && _hr[4] > 0 && !restAgrees(W, T0, ax, ay, az, bx, bz, rad, _bl, ln)) return -1;
      if (kind === EDGE_DROP) {
        if (_hr[5] === 1 && !sameWithoutRampMargin(W, T0, ax, ay, az, bx, bz, rad, _bl, ln)) return -1;
        if (ln >= 0) { ln = (_hlq[0] = ay, _hlq[1] = by, _hlq[2] = ax, _hlq[3] = az, _hlq[4] = bx, _hlq[5] = bz, _hlq[6] = rad, hopListQ(T0, true)); if (!perturbOK(W, T0, ax, ay, az, bx, by, bz, rad, _bl, ln)) return -1; }        // a drop is optional: only the robust ones
        cost = len3 + DROP_COST + 0.3 * -dy;
      } else {
        if (_hr[1] > MAX_WALK_GAP) return -1;              // it fell: not a walk
        if (dy < 0.3 && dy > -0.3 && _hr[3] < (ay < by ? ay : by) - 0.2) return -1;       // a flat edge over a floor that dips under the feet (a stairwell corner, a gap): a near miss
        if (rampInv || _hr[2] === 1) {
          kind = EDGE_RAMP;
          if (_hr[5] === 1 && !sameWithoutRampMargin(W, T0, ax, ay, az, bx, bz, rad, _bl, ln)) return -1;         // not a margin trick (a lift from a ramp's side); no margin used = the replay would be the same walk
          if (ln >= 0) { ln = (_hlq[0] = ay, _hlq[1] = by, _hlq[2] = ax, _hlq[3] = az, _hlq[4] = bx, _hlq[5] = bz, _hlq[6] = rad, hopListQ(T0, true)); if (!perturbOK(W, T0, ax, ay, az, bx, by, bz, rad, _bl, ln)) return -1; }      // thin margins: must survive a follower's error
        }
        else if (((fa ^ fb) & F_TERR) !== 0 || dy > 0.2 || dy < -0.2) {
          // a step between floor types (terrain to a deck, a raft, a porch): a lift that works from exact positions only is no edge
          if (ln >= 0) { ln = (_hlq[0] = ay, _hlq[1] = by, _hlq[2] = ax, _hlq[3] = az, _hlq[4] = bx, _hlq[5] = bz, _hlq[6] = rad, hopListQ(T0, true)); if (!perturbOK(W, T0, ax, ay, az, bx, by, bz, rad, _bl, ln)) return -1; }
        }
        cost = len3 * (kind === EDGE_RAMP ? 1.05 : 1);
      }
    }
    if (((fa | fb) & F_WET) !== 0) cost *= WET_MULT;
    cost *= ROB_MULT[(fb >> 4) & 3];
    _ec[0] = cost;
    return kind;
  }

  /** Is the floor under (x, z) at height y fragile: does the SAME floor fail to hold 0.3 m away in some direction? A node on a lip, on
   *  the side strip of a ramp, or beside a step that would lift the walker is a place the mover permits only at exact positions; a walker
   *  that is 5 cm off falls, is lifted onto the wrong thing, or is stopped. own = the collider the floor is (-1 terrain). */
  function robOf(tier, fragile) { var r = tier - (fragile ? 2 : 0); return r < 0 ? 0 : r; }
  var _ff = new Int32Array(256);
  var _ffq = new Float64Array(3);
  function floorFragile(T, items, a, b, x, z, y, own) { _ffq[0] = x; _ffq[1] = z; _ffq[2] = y; return floorFragileQ(T, items, a, b, own); }
  function floorFragileQ(T, items, a, b, own) {
    var x = _ffq[0], z = _ffq[1], y = _ffq[2];      // (Wave 8, I2: the numbers come through _ffq - a call boxes double arguments)
    x = +x; z = +z; y = +y;      // (Wave 8, I2: numbers in float registers - a parameter used as received stays a boxed number in TurboFan's phis)
    // the eight probes lie within 0.3 m of the node, and a collider holds up (supportT) only within 0.3 m of its footprint: the ones farther than 0.6 m (0.61 for rounding)
    // from the node hold nobody up at any probe. The probes are asked of this short list, in the same order.
    var nf = 0, ffl = items, fa = a, fb = b;
    if (b - a <= 256) {
      var lx0 = T.lx0, lx1 = T.lx1, lz0 = T.lz0, lz1 = T.lz1;
      for (var q = a; q < b; q++) {
        var iq = items[q];
        if (x < lx0[iq] - 0.61 || x > lx1[iq] + 0.61 || z < lz0[iq] - 0.61 || z > lz1[iq] + 0.61) continue;
        _ff[nf++] = iq;
      }
      ffl = _ff; fa = 0; fb = nf;
    }
    for (var k = 0; k < 8; k++) {
      var ang = k * 0.7853981633974483, px = x + 0.3 * Math.cos(ang), pz = z + 0.3 * Math.sin(ang);
      _hq[0] = px; _hq[1] = pz; hfQ(T); var Hp = _hq[2];
      _tq[0] = px; _tq[1] = pz; _tq[2] = y; _tq[3] = Hp; supportTQ(T, ffl, fa, fb); var sup = _tq[4];
      if (own < 0) { if (sup > Hp + 0.05) return true; }                              // terrain: nothing may lift the walker
      else if (T.lk[own] === 1) {
        // a ramp: the strip within 0.3 m of its sides is held up by the support margin only
        var lat = (T.ld[own] === 0 || T.ld[own] === 1) ? Math.min(pz - T.lz0[own], T.lz1[own] - pz) : Math.min(px - T.lx0[own], T.lx1[own] - px);
        if (lat < -0.05) return true;
      } else if (Math.abs(sup - y) > 0.1) return true;                                // a deck or slab: the floor must continue
    }
    return false;
  }

  // ── growable typed arrays ────────────────────────────────────────────────────────────────────────────────────────
  function grow(arr, n, Ctor) { var o = new Ctor(n); o.set(arr); return o; }

  // ── bakeTile ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Bake one rect into a tile. Pure: the same colliders, height function, rect, cell and opts give the same arrays.
   *   colliders  an array of maps.js colliders, or a makeColSet() result
   *   heightFn   (x, z) -> terrain height (the map's own heightAt)
   *   rect       { minX, minZ, maxX, maxZ }; maxX / maxZ are extended to whole cells
   *   cell       the nominal cell size (m); the lattice uses rect width / round(width / cell)
   *   opts       { holes: [rect] cells whose centre is inside are skipped, waterY, seeds: [[x, z]], noPrune,
   *                  seam: { minX, maxX, minZ, maxZ } sides shared with a sibling chunk of the same building: nodes within SEAM_BAND (1 m)
   *                  of such a side count as reachable (the sibling may be what leads to them) }
   */
  function bakeTile(colliders, heightFn, rect, cell, opts) {
    // a bake can run INSIDE a replay (a hop that steps into a tile nobody has baked yet): the replay's module-level scratch must survive it
    var sv0 = _hr[0], sv1 = _hr[1], sv2 = _hr[2], sv3 = _hr[3], sv4 = _hr[4], sv5 = _hr[5], svU = _marginUse, svE = _ec[0], svS = _strictRamp, svR = _supRamp, svM = _rest, svW = _wsRamp;
    _rest = 0;
    var tile = bakeTile0(colliders, heightFn, rect, cell, opts);
    _hr[0] = sv0; _hr[1] = sv1; _hr[2] = sv2; _hr[3] = sv3; _hr[4] = sv4; _hr[5] = sv5; _marginUse = svU; _ec[0] = svE; _strictRamp = svS; _supRamp = svR; _rest = svM; _wsRamp = svW;
    return tile;
  }
  var YIELD_STEPS = 200;         // an incremental bake yields every this many replayed 10 cm steps (the module counter _cnt[1]: a work clock, not a time one)
  /** The synchronous bake: runs the generator to the end (bakeTileGen yields every ~1-3 ms of work so a caller that wants to spread a bake over frames can). */
  function bakeTile0(colliders, heightFn, rect, cell, opts) {
    var g = bakeTileGen(colliders, heightFn, rect, cell, opts), r;
    do { r = g.next(); } while (!r.done);
    return r.value;
  }
  /** (final/nav) EVERY TILE HAS ONE HIDDEN CLASS, from birth to the end of the match. A tile used to start with 30 properties and grow the rest in
   *  stages (the bake's graph, the install's kind / tx / tz / rectRef, the stitch's linking / linkedAt, the settle's rch), so the tiles of a match wore
   *  5+ hidden classes (5 in a fully baked Deepwood, more while tiles are mid-bake or mid-stitch). Every read of a tile field in the replay was then a
   *  megamorphic load, and a megamorphic load of a double field (minX, inv, cell, deepY ...) hands back a FRESH heap number: hopQ made 49 B of garbage
   *  per replayed 10 cm step in TurboFan (Node probe, Deepwood seed 7: 5,842 B a 12 m hop; ~465 B a step before it is optimized), and each new class
   *  a hot function met deoptimized it ("wrong map", Chrome's V8 log of a framecheck run). Now: one literal with every field, in one order, with a value
   *  of the field's final kind; the later stages assign in place. The integer fields are stored as small integers (| 0): a payload's numbers come out of a
   *  double array (pbAssemble's s[]) as heap numbers, and ONE heap number in a small-integer field re-classes every tile (Chrome's log: tileShell 'not a
   *  Smi', then 'wrong map' in hopQ / supBlockQ / supportTQ / hfQ, right before the drop). Same values, read the same way: no tile, edge or route
   *  changes (world hash). */
  function tileShell(key, minX, minZ, maxX, maxZ, cell, nx, nz, inv, hf, deepY, wetY, cs) {
    // the literal holds CONSTANTS of each field's kind (0.5 = a double field, 0 = a small-integer one, null = an object), so its boilerplate is born with
    // the final representations; a computed integral double (a coarse tile's minX -544) would otherwise make minX a small-integer field (V8 log: 'not a Smi')
    var T = {
      isTile: true, grp: null, island: null, key: 0, minX: 0.5, minZ: 0.5, maxX: 0.5, maxZ: 0.5, cell: 0.5, nx: 0, nz: 0, inv: 0.5, hf: null, hl: null,
      deepY: 0.5, wetY: 0.5,
      m: 0, lx0: null, lx1: null, ly0: null, ly1: null,
      lz0: null, lz1: null, lk: null, ld: null,
      nearStart: null, nearItems: null, slot: -1, base: 0, linkedAll: false,
      // set by the bake (bakeTileGen) / the payload (pbAssemble)
      dOrth: 0.5, dDiag: 0.5, n: 0, x: null, y: null, z: null, flag: null, bord: null, adj: null, cellStart: null,
      edgeStart: null, edgeTo: null, edgeCost: null, edgeKind: null, bordCount: 0, holes: null,
      extStart: null, extTo: null, extCost: null, extKind: null, pend: null, linked: null, stats: null, hash: "",
      // set by the install (bakeCoarse / bakeFine / stepJob / pbHostAdd), the stitch (stepJob, linkTileGen) and the settle (resolveGroup)
      kind: "", tx: 0, tz: 0, rectRef: null, linking: false, linkedAt: -1, rch: null,
    };
    T.key = key | 0; T.minX = minX; T.minZ = minZ; T.maxX = maxX; T.maxZ = maxZ; T.cell = cell; T.nx = nx | 0; T.nz = nz | 0; T.inv = inv; T.hf = hf; T.hl = latFor(hf);
    T.deepY = deepY; T.wetY = wetY;
    T.m = cs.n; T.lx0 = cs.minX; T.lx1 = cs.maxX; T.ly0 = cs.minY; T.ly1 = cs.maxY; T.lz0 = cs.minZ; T.lz1 = cs.maxZ; T.lk = cs.kind; T.ld = cs.dir;
    T.dOrth = cell; T.dDiag = cell * Math.SQRT2;
    return T;
  }
  /** Drive every field of the tile class through the kinds of value it will ever hold, once, when the module loads: a field's representation (small
   *  integer -> double), its type (null -> an array) and its constness (written once -> written again) only ever GENERALIZE, and each generalization
   *  deoptimizes the code that relied on the old one. Done here, before any code is optimized, no tile ever changes the class mid-match. */
  (function primeTileShape() {
    var f0 = function () { return 0; }, cs = makeColSet([], null, null);
    var A = tileShell(1, 0, 0, 32, 32, 2, 16, 16, 1, f0, -Infinity, -Infinity, cs), B = tileShell(100000001, 0.25, 0.5, 16.25, 16.5, 0.75, 21, 21, 4 / 3, f0, -1.08, 0.3, cs);
    var P = [A, B], i, T;
    for (i = 0; i < 2; i++) {
      T = P[i];
      T.grp = { rects: [] }; T.island = new Uint8Array(1); T.island = null; T.key = 2 + i; T.minX = 0.5; T.minZ = 0.5; T.maxX = 1.5; T.maxZ = 1.5; T.cell = 1.5; T.inv = 0.6;
      T.nx = 3; T.nz = 3; T.hf = function () { return 1; }; T.hl = { L: null, n: 0, c: 0, k: 0.5, h: 0.5 }; T.hl = null; T.deepY = -0.5; T.wetY = 0.5; T.m = 1;
      T.nearStart = new Int32Array(1); T.nearItems = new Int32Array(1); T.nearStart = new Uint16Array(1); T.nearItems = new Uint16Array(1);
      T.slot = 1; T.base = STRIDE; T.linkedAll = true; T.linkedAll = false;
      T.dOrth = 0.75; T.dDiag = 1.06; T.n = 1; T.n = 2;
      T.x = new Float32Array(1); T.y = new Float32Array(1); T.z = new Float32Array(1); T.flag = new Uint8Array(1); T.bord = new Uint8Array(1); T.adj = new Uint8Array(1);
      T.cellStart = new Int32Array(1); T.cellStart = new Uint16Array(1); T.edgeStart = new Int32Array(1); T.edgeStart = new Uint16Array(1);
      T.edgeTo = new Int32Array(1); T.edgeTo = new Uint16Array(1); T.edgeCost = new Float32Array(1); T.edgeKind = new Uint8Array(1);
      T.bordCount = 1; T.bordCount = 2; T.holes = []; T.holes = [];
      T.extStart = new Int32Array(1); T.extStart = new Uint16Array(1); T.extTo = new Int32Array(1); T.extCost = new Float32Array(1); T.extKind = new Uint8Array(1);
      T.extStart = null; T.extTo = null; T.extCost = null; T.extKind = null;
      T.pend = []; T.pend = null; T.linked = []; T.linked = [];
      T.stats = { ms: 0.5 }; T.stats = { ms: 1.5 }; T.hash = (0x811c9dc5 + i).toString(16); T.hash = "1";
      T.kind = "coarse"; T.kind = "fine"; T.tx = 1; T.tx = -1; T.tz = 1; T.tz = -1; T.rectRef = { tile: null }; T.rectRef = null;
      T.linking = true; T.linking = false; T.linkedAt = 0; T.linkedAt = 1; T.rch = new Uint8Array(1); T.rch = null;
    }
  })();
  /** bakeTile as a GENERATOR (Wave 7, lane 7B2): the same code, with a `yield` every 4 flagged cells of the node pass and every YIELD_STEPS replayed
   *  steps of the edge pass, so one 10-190 ms tile can be baked a slice at a time (stepJob). The yields carry no data and change no state: driven
   *  to the end the result is byte for byte the tile the single call gave (world hash pinned by the selftest). The work counters are the only clock. */
  function* bakeTileGen(colliders, heightFn, rect, cell, opts) {
    var t0 = now();
    opts = opts || {};
    var cs = makeColSet(colliders, opts.blockers, opts.noFloor), hf = heightFn;
    var minX = rect.minX, minZ = rect.minZ;
    var nx = Math.max(1, Math.round((rect.maxX - minX) / cell));
    cell = (rect.maxX - minX) / nx;
    var nz = Math.max(1, Math.round((rect.maxZ - minZ) / cell));
    var maxX = minX + nx * cell, maxZ = minZ + nz * cell;
    var inv = 1 / cell, ncell = nx * nz;
    var rad = RADIUS + BAKE_SKIN;
    var waterY = opts.waterY != null ? opts.waterY : -Infinity;
    var i, j, k, q;

    // 1. the colliders that can matter (3 m beyond the rect), copied local
    var GM = 3.0, sel = [];
    for (i = 0; i < cs.n; i++) {
      if (cs.maxX[i] < minX - GM || cs.minX[i] > maxX + GM || cs.maxZ[i] < minZ - GM || cs.minZ[i] > maxZ + GM) continue;
      sel.push(i);
    }
    var m = sel.length;
    // (Wave 8, lane I2) the tile reads the collider set's own arrays and its lists hold collider-set indices: it used to copy its colliders (6 Float64 + 2 bytes
    // each, ~50 B a collider a tile: 3.1 MB in a furnished downtown, the biggest part of its tiles). Same numbers, same order in every list (the selection runs
    // in collider-set order and the lists are built in that order), so every replay reads exactly what it read before. T.m = the index space (_mk's size).
    var T = tileShell(opts.key != null ? opts.key : 0, minX, minZ, maxX, maxZ, cell, nx, nz, inv, hf, waterY - DEEP, waterY + 0.3, cs);
    var lx0 = T.lx0, lx1 = T.lx1, ly0 = T.ly0, ly1 = T.ly1, lz0 = T.lz0, lz1 = T.lz1, lk = T.lk;

    // 2. per-cell collider lists: every collider within E1 (capsule + pad) of the cell's rectangle. An empty list = an
    //    OPEN cell: terrain floor, nothing can block or lift anyone there.
    var nearStart = new Int32Array(ncell + 1), nearItems;
    var i0, i1, k0, k1, ix, iz, ci;
    for (var pass = 0; pass < 2; pass++) {
      var cur = pass === 1 ? nearStart.slice(0, ncell) : null;
      for (j = 0; j < m; j++) {
        q = sel[j];
        i0 = Math.floor((lx0[q] - E1 - minX) * inv); i1 = Math.floor((lx1[q] + E1 - minX) * inv);
        k0 = Math.floor((lz0[q] - E1 - minZ) * inv); k1 = Math.floor((lz1[q] + E1 - minZ) * inv);
        if (i1 < 0 || k1 < 0 || i0 >= nx || k0 >= nz) continue;
        if (i0 < 0) i0 = 0; if (k0 < 0) k0 = 0; if (i1 >= nx) i1 = nx - 1; if (k1 >= nz) k1 = nz - 1;
        for (iz = k0; iz <= k1; iz++) for (ix = i0; ix <= i1; ix++) {
          ci = iz * nx + ix;
          if (pass === 0) nearStart[ci + 1]++; else nearItems[cur[ci]++] = q;
        }
      }
      if (pass === 0) { for (ci = 0; ci < ncell; ci++) nearStart[ci + 1] += nearStart[ci]; nearItems = new Int32Array(nearStart[ncell]); }
    }
    T.nearStart = nearStart; T.nearItems = nearItems;

    // 3. holes (a fine tile stands there)
    var skip = null, holes = opts.holes;
    if (holes && holes.length) {
      skip = new Uint8Array(ncell);
      for (var hI = 0; hI < holes.length; hI++) {
        var ho = holes[hI];
        i0 = Math.max(0, Math.floor((ho.minX - minX) * inv - 0.5)); i1 = Math.min(nx - 1, Math.ceil((ho.maxX - minX) * inv));
        k0 = Math.max(0, Math.floor((ho.minZ - minZ) * inv - 0.5)); k1 = Math.min(nz - 1, Math.ceil((ho.maxZ - minZ) * inv));
        for (iz = k0; iz <= k1; iz++) for (ix = i0; ix <= i1; ix++) {
          var hx = minX + (ix + 0.5) * cell, hz = minZ + (iz + 0.5) * cell;
          if (hx >= ho.minX && hx < ho.maxX && hz >= ho.minZ && hz < ho.maxZ) skip[iz * nx + ix] = 1;
        }
      }
    }
    var tMark1 = now();

    // 4. nodes: one per floor per cell
    var cap = Math.max(256, ncell + (ncell >> 1));
    var nX = new Float64Array(cap), nY = new Float64Array(cap), nZ = new Float64Array(cap);
    var nCell = new Int32Array(cap), nOwn = new Int32Array(cap), nFlag = new Uint8Array(cap);
    var nN = 0;
    function pushNode(x, y, z, c2, own, flag) {
      if (nN === cap) {
        cap *= 2;
        nX = grow(nX, cap, Float64Array); nY = grow(nY, cap, Float64Array); nZ = grow(nZ, cap, Float64Array);
        nCell = grow(nCell, cap, Int32Array); nOwn = grow(nOwn, cap, Int32Array); nFlag = grow(nFlag, cap, Uint8Array);
      }
      nX[nN] = x; nY[nN] = y; nZ[nN] = z; nCell[nN] = c2; nOwn[nN] = own; nFlag[nN] = flag; nN++;
    }
    var cellFirst = new Int32Array(ncell + 1);
    var cY = new Float64Array(256), cO = new Int32Array(256), mT = new Float64Array(256);       // candidates and margin tops at a sample
    var eY = new Float64Array(2048), eX = new Float64Array(2048), eZ = new Float64Array(2048), eD = new Float64Array(2048), eO = new Int32Array(2048);
    var ord = new Int32Array(2048), taken = new Uint8Array(2048), eR = new Int8Array(2048);
    var flaggedCells = 0, openCells = 0;
    for (iz = 0; iz < nz; iz++) for (ix = 0; ix < nx; ix++) {
      ci = iz * nx + ix;
      cellFirst[ci] = nN;
      if (skip !== null && skip[ci] === 1) continue;
      var cxm = minX + (ix + 0.5) * cell, czm = minZ + (iz + 0.5) * cell;
      var a = nearStart[ci], b = nearStart[ci + 1];
      if (a === b) {                                       // OPEN: the terrain at the centre
        _hq[0] = cxm; _hq[1] = czm; hfQ(T); var h0 = _hq[2];      // (the lattice read when the height function carries it: no boxed call)
        if (!(h0 >= waterY - DEEP) || h0 === Infinity) continue;           // swimming, or no ground at all (a non-finite height: NaN poisons every cost it touches)
        pushNode(cxm, h0, czm, ci, -1, F_OPEN | F_TERR | (3 << 4) | (h0 < waterY ? F_WET : 0));
        openCells++;
        continue;
      }
      flaggedCells++;
      if ((flaggedCells & 3) === 0) { if (_rec !== null) recEv(1); yield 0; }      // (P2-E: _rec = the prebake recorder, null in play: see PREBAKE)
      var nE = 0;
      for (var si = 0; si < 9; si++) {
        var sx, sz;
        if (si === 0) { sx = cxm; sz = czm; }
        else if (si <= 4) { sx = cxm + OFFS[si - 1] * cell; sz = czm; }
        else { sx = cxm; sz = czm + OFFS[si - 5] * cell; }
        var dd = Math.abs(sx - cxm) + Math.abs(sz - czm);
        _hq[0] = sx; _hq[1] = sz; hfQ(T); var H = _hq[2], nC = 1, nM = 0;
        if (!(H > -1e9 && H < 1e9)) continue;                                           // the terrain function gave no height here
        cY[0] = H; cO[0] = -1;
        for (k = a; k < b; k++) {
          q = nearItems[k];
          if (lk[q] >= 2) continue;                                                    // a blocker / tall furniture is never a floor and never lifts
          if (sx < lx0[q] - SUP_MARGIN || sx > lx1[q] + SUP_MARGIN || sz < lz0[q] - SUP_MARGIN || sz > lz1[q] + SUP_MARGIN) continue;
          var top = lk[q] === 1 ? rampTopT(T, q, sx, sz) : ly1[q];
          if (top <= H + 1e-6) continue;
          if (nM < 255) mT[nM++] = top;
          if (sx < lx0[q] || sx > lx1[q] || sz < lz0[q] || sz > lz1[q]) continue;     // within the support margin only: lifts, is no floor
          if (top - H > MAX_FLOOR_ABOVE) continue;
          if (lk[q] === 0 && (lx1[q] - lx0[q] < MIN_FLOOR_DIM || lz1[q] - lz0[q] < MIN_FLOOR_DIM)) continue;
          if (nC < 255) { cY[nC] = top; cO[nC] = q; nC++; }
        }
        for (var cj = 0; cj < nC; cj++) {
          var cy = cY[cj], dom = false;
          for (var mi = 0; mi < nM; mi++) if (mT[mi] > cy + 1e-9 && mT[mi] <= cy + STEP_G) { dom = true; break; }
          if (dom) continue;                                                           // the mover would be lifted onto something higher
          if (cO[cj] < 0 && H < waterY - DEEP) continue;                               // swimming, not walking
          // a standing capsule must fit; clearance tier 0..3 (a capsule 0.1 / 0.2 / 0.3 m fatter still fits): nodes sit in the middle of a doorway, not on
          // whichever lattice point happens to be nearest the cell centre (clearTier: one pass for the four questions)
          var tier = (_ctq[0] = sx, _ctq[1] = sz, _ctq[2] = cy, _ctq[3] = rad, clearTierQ(T, nearItems, a, b));
          if (tier < 0) continue;
          if (nE < 2040) { eY[nE] = cy; eX[nE] = sx; eZ[nE] = sz; eD[nE] = dd - 10 * tier; eO[nE] = cO[cj]; eR[nE] = tier; nE++; }
        }
      }
      if (nE === 0) continue;
      // floors: ramp entries group by their ramp; everything else chains by height (flush slabs are one floor)
      for (j = 0; j < nE; j++) ord[j] = j;
      for (j = 1; j < nE; j++) { var oj = ord[j], p = j - 1; while (p >= 0 && eY[ord[p]] > eY[oj]) { ord[p + 1] = ord[p]; p--; } ord[p + 1] = oj; }
      var jj;
      // a ramp is ONE floor however steep (a 1.5 m cell on a 45 degree stair spans 1.5 m of height): all entries of one
      // ramp collapse to the sample nearest the cell centre
      for (j = 0; j < nE; j++) taken[j] = 0;
      for (jj = 0; jj < nE; jj++) {
        var e0 = ord[jj], ow0 = eO[e0];
        if (ow0 < 0 || lk[ow0] !== 1 || taken[e0] === 1) continue;
        var bestR = e0;
        for (q = jj; q < nE; q++) {
          var eq = ord[q];
          if (eO[eq] !== ow0) continue;
          taken[eq] = 1;
          if (eD[eq] < eD[bestR]) bestR = eq;
        }
        pushNode(eX[bestR], eY[bestR], eZ[bestR], ci, ow0, F_RAMP | ((eY[bestR] - ly0[ow0] <= 0.6 || ly1[ow0] - eY[bestR] <= 0.6) ? F_RAMPEND : 0) | (robOf(eR[bestR], (_ffq[0] = eX[bestR], _ffq[1] = eZ[bestR], _ffq[2] = eY[bestR], floorFragileQ(T, nearItems, a, b, ow0))) << 4));
      }
      // everything else: chains of heights closer than 0.15 m are one floor (a floor slab laid as several flush boxes)
      jj = 0;
      while (jj < nE) {
        if (taken[ord[jj]] === 1) { jj++; continue; }
        var kk = jj, best = ord[jj], prev = ord[jj];
        while (kk + 1 < nE) {
          var nxt = ord[kk + 1];
          if (taken[nxt] === 1) { kk++; continue; }
          if (eY[nxt] - eY[prev] >= 0.15) break;
          prev = nxt; kk++;
        }
        for (q = jj; q <= kk; q++) { var eq2 = ord[q]; if (taken[eq2] === 0 && eD[eq2] < eD[best]) best = eq2; }
        var ow = eO[best], fl = ow < 0 ? F_TERR : 0;
        if (ow < 0 && eY[best] < waterY) fl |= F_WET;
        pushNode(eX[best], eY[best], eZ[best], ci, ow, fl | (robOf(eR[best], (_ffq[0] = eX[best], _ffq[1] = eZ[best], _ffq[2] = eY[best], floorFragileQ(T, nearItems, a, b, ow))) << 4));
        jj = kk + 1;
      }
    }
    cellFirst[ncell] = nN;
    var tMark2 = now();

    // 5. edges, driven by the directed flood fill from the open ground: a hop is replayed only OUT OF a floor something can walk
    //    to, so a roof, a sealed room or a floating slab costs a node and nothing else, and is dropped (an island). a -> b and
    //    b -> a are replayed separately: a ramp is entered from its low edge or from above, never through its side.
    var ecap = Math.max(1024, nN * 6);
    var eF = new Int32Array(ecap), eT = new Int32Array(ecap), eC = new Float32Array(ecap), eK = new Uint8Array(ecap);
    var nEd = 0, replays = 0, dropTests = 0;
    function addEdge(f, t, c2, kd) {
      if (nEd === ecap) { ecap *= 2; eF = grow(eF, ecap, Int32Array); eT = grow(eT, ecap, Int32Array); eC = grow(eC, ecap, Float32Array); eK = grow(eK, ecap, Uint8Array); }
      eF[nEd] = f; eT[nEd] = t; eC[nEd] = c2; eK[nEd] = kd; nEd++;
    }
    var keep = new Uint8Array(nN), queue = new Int32Array(nN), qh = 0, qt = 0, n2, nAdj = new Uint8Array(nN), plainN = 0;
    var seeds = opts.seeds || null, seam = opts.seam || null, seedCount = 0;
    var prov = seam && !opts.noPrune ? new Uint8Array(nN) : null, phase = 0, provN = 0;
    for (n2 = 0; n2 < nN; n2++) {
      var isSeed = (nFlag[n2] & (F_OPEN | F_WET)) === F_OPEN;
      if (!isSeed && seeds) for (k = 0; k < seeds.length; k++) {
        var sdx = nX[n2] - seeds[k][0], sdz = nZ[n2] - seeds[k][1];
        if (sdx * sdx + sdz * sdz < 2.25 && (seeds[k][2] == null || Math.abs(nY[n2] - seeds[k][2]) < 1.2)) { isSeed = true; break; }
      }
      if (isSeed) { keep[n2] = 1; queue[qt++] = n2; seedCount++; }
    }
    if (seedCount === 0) {                                  // no open ground at all (a tile inside one big building): terrain floors seed it
      for (n2 = 0; n2 < nN; n2++) if ((nFlag[n2] & F_TERR) !== 0) { keep[n2] = 1; queue[qt++] = n2; seedCount++; }
    }
    if (opts.noPrune || seedCount === 0) { for (n2 = 0; n2 < nN; n2++) if (!keep[n2]) { keep[n2] = 1; queue[qt++] = n2; } }
    var yAt = _cnt[1];
    if (_rec !== null) recEv(2);
    for (;;) {
    while (qh < qt) {
      if (_rec !== null) recEv(3);
      if (_cnt[1] - yAt >= YIELD_STEPS) { yAt = _cnt[1]; yield 0; }
      var na = queue[qh++];
      ci = nCell[na]; ix = ci % nx; iz = (ci - ix) / nx;
      var aOpen = nearStart[ci] === nearStart[ci + 1] && (nFlag[na] & F_OPEN) !== 0;
      var sameLvl = 0;
      for (var nb = 0; nb < 8; nb++) {
        var jx = ix + NB8X[nb], jz = iz + NB8Z[nb];
        if (jx < 0 || jx >= nx || jz < 0 || jz >= nz) continue;
        var cj2 = jz * nx + jx, fb0 = cellFirst[cj2], fb1 = cellFirst[cj2 + 1];
        if (fb0 === fb1) continue;
        var bOpen = nearStart[cj2] === nearStart[cj2 + 1];
        for (var nbn = fb0; nbn < fb1; nbn++) {
          var kd, cst;
          if (aOpen && bOpen && (nFlag[nbn] & F_OPEN) !== 0) {              // open ground to open ground: terrain, nothing to replay, and nothing to STORE:
            // the pair is an IMPLICIT edge (neighbours() / the search derive it from the two nodes), 77 % of all edges of a town were these
            if (!keep[nbn]) { keep[nbn] = 1; queue[qt++] = nbn; if (phase === 1) prov[nbn] = 1; }
            continue;
          }
          // two stair nodes diagonal to each other need no edge of their own: the orthogonal edges beside them carry the same route (the string
          // pull cuts the corner when the mover can), and a stair holds most of the replays of a tower. The ledge test below still counts the
          // direction as level.
          if (nb >= 4 && (nFlag[na] & nFlag[nbn] & F_RAMP) !== 0) {
            var ddy2 = nY[nbn] - nY[na];
            if (ddy2 <= 0.9 && ddy2 >= -0.9) sameLvl |= 1 << nb;
            continue;
          }
          if (_rec !== null) recEv(3);
          if (_cnt[1] - yAt >= YIELD_STEPS) { yAt = _cnt[1]; yield 0; }       // (never between an evalEdge and the read of its result in _ec / _hr: a slice boundary restores that scratch)
          kd = (_eq[0] = nX[na], _eq[1] = nY[na], _eq[2] = nZ[na], _eq[3] = nX[nbn], _eq[4] = nY[nbn], _eq[5] = nZ[nbn], evalEdgeQ(null, T, nFlag[na], nFlag[nbn], ci, cj2));
          cst = _ec[0];
          replays++;
          if (kd < 0) continue;
          // a plain walk (terrain to terrain, or one flat floor) is a bit of the node's mask when its destination is the ONLY node of the cell that the rule picks
          var plain = false;
          if (kd === EDGE_WALK && plainRule(nFlag[na], nFlag[nbn], Math.fround(nY[nbn]) - Math.fround(nY[na]))) {
            plain = true;
            for (var pm = fb0; pm < fb1; pm++) if (pm !== nbn && plainRule(nFlag[na], nFlag[pm], Math.fround(nY[pm]) - Math.fround(nY[na]))) { plain = false; break; }
          }
          if (plain) { nAdj[na] |= 1 << nb; plainN++; } else addEdge(na, nbn, cst, kd);
          if (!keep[nbn]) { keep[nbn] = 1; queue[qt++] = nbn; if (phase === 1) prov[nbn] = 1; }
          var sdy = nY[nbn] - nY[na], sTol = ((nFlag[na] | nFlag[nbn]) & F_RAMP) !== 0 ? 0.9 : 0.31;
          if (sdy <= sTol && sdy >= -sTol) sameLvl |= 1 << nb;
        }
      }
      // a floor EDGE (a neighbour direction with no node on the same level): a ledge, a balcony, a stairwell hole. The mover
      // is still held up 0.3 m past the lip (supportIn's margin) and then falls, so the ground it drops onto can be two cells away.
      if (!aOpen && (nFlag[na] & F_TERR) === 0 && sameLvl !== 255) {
        for (var rz = -2; rz <= 2; rz++) for (var rx = -2; rx <= 2; rx++) {
          if (rx > -2 && rx < 2 && rz > -2 && rz < 2) continue;              // the inner ring was done above
          var qx2 = ix + rx, qz2 = iz + rz;
          if (qx2 < 0 || qx2 >= nx || qz2 < 0 || qz2 >= nz) continue;
          var cj3 = qz2 * nx + qx2, gb0 = cellFirst[cj3], gb1 = cellFirst[cj3 + 1];
          for (var nbn2 = gb0; nbn2 < gb1; nbn2++) {
            var ddy = nY[nbn2] - nY[na];
            var ddx = nX[nbn2] - nX[na], ddz = nZ[nbn2] - nZ[na], dd2 = ddx * ddx + ddz * ddz;
            // a DROP: down off a ledge to a floor up to two cells away. A BRIDGE (Wave 7 round 2): a stair's end and the floor it meets two cells away with no node
            // in the cell between (a stairwell's landing slab starts 0.6 m past the top of its stair: the 0.75 m lattice has no cell centre in the gap, so the
            // neighbour edges never joined them and the whole storey above a tower's stair was an island); the replay below decides, as for every edge.
            var isDrop = ddy <= -STEP_G - 1e-6 && ddy >= -DROP_MAX && dd2 <= 1.45 * 1.45;
            var isBridge = !isDrop && ((nFlag[na] | nFlag[nbn2]) & F_RAMPEND) !== 0 && ((nFlag[na] ^ nFlag[nbn2]) & F_RAMP) !== 0 && ddy <= BRIDGE_DY && ddy >= -BRIDGE_DY && dd2 <= BRIDGE_D * BRIDGE_D;
            if (!isDrop && !isBridge) continue;
            if (_rec !== null) recEv(3);
            if (_cnt[1] - yAt >= YIELD_STEPS) { yAt = _cnt[1]; yield 0; }
            var kd2 = (_eq[0] = nX[na], _eq[1] = nY[na], _eq[2] = nZ[na], _eq[3] = nX[nbn2], _eq[4] = nY[nbn2], _eq[5] = nZ[nbn2], evalEdgeQ(null, T, nFlag[na], nFlag[nbn2], ci, cj3));
            dropTests++;
            if (isDrop ? kd2 !== EDGE_DROP : kd2 < 0) continue;
            addEdge(na, nbn2, _ec[0], kd2);
            if (!keep[nbn2]) { keep[nbn2] = 1; queue[qt++] = nbn2; if (phase === 1) prov[nbn2] = 1; }
          }
        }
      }
    }
    // the genuine flood is done. What touches a seam to a sibling chunk may be reachable only THROUGH the sibling (a door, a stair on
    // its side): keep it provisionally (F_PROV), flood on from it; resolveGroup settles it once the siblings are baked.
    if (prov === null || phase === 1) break;
    phase = 1;
    for (n2 = 0; n2 < nN; n2++) {
      if (keep[n2] === 1) continue;
      if ((seam.minX && nX[n2] < minX + SEAM_BAND) || (seam.maxX && nX[n2] > maxX - SEAM_BAND) ||
          (seam.minZ && nZ[n2] < minZ + SEAM_BAND) || (seam.maxZ && nZ[n2] > maxZ - SEAM_BAND)) { keep[n2] = 1; prov[n2] = 1; queue[qt++] = n2; }
    }
    if (qh === qt) break;
    }
    var tMark3 = now();

    // 6. compact: kept nodes in cell order, edges in CSR (insertion order within a source: deterministic)
    var remap = new Int32Array(nN).fill(-1), nK = 0, e2;
    for (n2 = 0; n2 < nN; n2++) if (keep[n2]) remap[n2] = nK++;
    var nodeX = new Float32Array(nK), nodeY = new Float32Array(nK), nodeZ = new Float32Array(nK);
    var nodeFlag = new Uint8Array(nK), nodeBord = new Uint8Array(nK), nodeAdj = new Uint8Array(nK);
    var I16 = nK < 65535 ? Uint16Array : Int32Array;                                   // local ids and offsets fit 16 bits in every real tile
    var cellStart = new I16(ncell + 1);
    var holeList = holes || [];
    var bordCount = 0;
    for (n2 = 0; n2 < nN; n2++) {
      var r2i = remap[n2];
      if (r2i < 0) continue;
      nodeX[r2i] = nX[n2]; nodeY[r2i] = nY[n2]; nodeZ[r2i] = nZ[n2]; nodeFlag[r2i] = nFlag[n2]; nodeAdj[r2i] = nAdj[n2];
      if (prov !== null && prov[n2] === 1) { nodeFlag[r2i] |= F_PROV; provN++; }
      cellStart[nCell[n2] + 1]++;
      var bd = 0, bxv = nX[n2], bzv = nZ[n2];
      if (bxv - minX < LINK_BAND) bd |= 1; if (maxX - bxv < LINK_BAND) bd |= 2;
      if (bzv - minZ < LINK_BAND) bd |= 4; if (maxZ - bzv < LINK_BAND) bd |= 8;
      for (k = 0; k < holeList.length && !(bd & 16); k++) {
        var hh = holeList[k];
        if (bxv > hh.minX - LINK_BAND && bxv < hh.maxX + LINK_BAND && bzv > hh.minZ - LINK_BAND && bzv < hh.maxZ + LINK_BAND) bd |= 16;
      }
      nodeBord[r2i] = bd; if (bd) bordCount++;
    }
    for (ci = 0; ci < ncell; ci++) cellStart[ci + 1] += cellStart[ci];
    var edgeKinds = [0, 0, 0];
    var EI = nEd < 65535 ? Uint16Array : Int32Array;
    var edgeStart = new EI(nK + 1), edgeTo = new I16(nEd), edgeCost = new Float32Array(nEd), edgeKind = new Uint8Array(nEd);
    for (e2 = 0; e2 < nEd; e2++) edgeStart[remap[eF[e2]] + 1]++;
    for (n2 = 0; n2 < nK; n2++) edgeStart[n2 + 1] += edgeStart[n2];
    var ecur = Int32Array.from(edgeStart.subarray(0, nK));
    for (e2 = 0; e2 < nEd; e2++) {
      var slot = ecur[remap[eF[e2]]]++;
      edgeTo[slot] = remap[eT[e2]]; edgeCost[slot] = eC[e2]; edgeKind[slot] = eK[e2]; edgeKinds[eK[e2]]++;
    }
    var kept = nEd;
    T.dOrth = cell; T.dDiag = cell * Math.SQRT2;

    T.n = nK; T.x = nodeX; T.y = nodeY; T.z = nodeZ; T.flag = nodeFlag; T.bord = nodeBord; T.adj = nodeAdj; T.cellStart = cellStart;
    T.edgeStart = edgeStart; T.edgeTo = edgeTo; T.edgeCost = edgeCost; T.edgeKind = edgeKind;
    T.bordCount = bordCount; T.holes = holeList;
    T.extStart = null; T.extTo = null; T.extCost = null; T.extKind = null; T.pend = null; T.linked = [];
    // the lookup lists were built wide for the bake; keep them narrow (they are read by every replay of this tile for the rest of the match)
    if (nearItems.length < 65535 && cs.n < 65535) {
      T.nearStart = Uint16Array.from(nearStart); T.nearItems = Uint16Array.from(nearItems);
    }
    if (nK >= STRIDE) throw new Error("navgrid: a tile may hold at most " + (STRIDE - 1) + " nodes");
    var tEnd = now();
    T.stats = {
      cells: ncell, openCells: openCells, flaggedCells: flaggedCells, nodesRaw: nN, nodes: nK, pruned: nN - nK, edges: kept,
      walk: edgeKinds[0], drop: edgeKinds[1], ramp: edgeKinds[2], plain: plainN, prov: provN, replays: replays, dropTests: dropTests, colliders: m, seeds: seedCount,
      ms: tEnd - t0, msGather: tMark1 - t0, msNodes: tMark2 - tMark1, msEdges: tMark3 - tMark2, msPrune: tEnd - tMark3, bytes: 0,
    };
    T.stats.bytes = tileBytes(T);
    T.hash = tileHash(T);
    if (_rec !== null) recEv(4);
    return T;
  }

  function tileBytes(T) {
    var s = 0, names = ["nearStart", "nearItems", "x", "y", "z", "flag", "bord", "adj",
      "cellStart", "edgeStart", "edgeTo", "edgeCost", "edgeKind", "extStart", "extTo", "extCost", "extKind"];
    for (var i = 0; i < names.length; i++) if (T[names[i]]) s += T[names[i]].byteLength;
    return s;
  }

  /** FNV-1a over the tile's graph (rounded to the millimetre / centimetre): the determinism fingerprint. */
  // (Wave 8, lane I2) the running hash in an Int32Array: a closure's captured int that leaves the small-integer range is a fresh heap number at every write
  // (tileHash was 10 MB of garbage in a 600-frame window of the housed Savanna's bake). Same arithmetic, same hash.
  var _th = new Int32Array(1);
  function mix(v) { var h = _th[0]; h ^= v & 0xff; h = Math.imul(h, 16777619); h ^= (v >>> 8) & 0xff; h = Math.imul(h, 16777619); h ^= (v >>> 16) & 0xff; h = Math.imul(h, 16777619); h ^= (v >>> 24) & 0xff; h = Math.imul(h, 16777619); _th[0] = h; }
  function tileHash(T) {
    _th[0] = 0x811c9dc5 | 0;
    mix(T.n); mix(T.nx); mix(T.nz);
    var i;
    for (i = 0; i < T.n; i++) { mix(Math.round(T.x[i] * 1000)); mix(Math.round(T.y[i] * 1000)); mix(Math.round(T.z[i] * 1000)); mix(T.flag[i]); mix(T.adj[i]); }
    mix(T.edgeTo.length);
    for (i = 0; i < T.edgeTo.length; i++) { mix(T.edgeTo[i]); mix(Math.round(T.edgeCost[i] * 100)); mix(T.edgeKind[i]); }
    return (_th[0] >>> 0).toString(16);
  }

  // ── the world: lazy coarse tiles + one fine tile per building ───────────────────────────────────────────────────
  function coarseKey(tx, tz) { return (tx + 4096) * 8192 + (tz + 4096); }

  /** Rects of the buildings: roof / ceiling slabs (thin, wide, a standing capsule under them) grouped by touching
   *  footprints, ramps that meet a group joined to it, 2 m of margin, snapped to the fine lattice, overlaps merged. */
  function findBuildingRects(cs, hf, fineCell) {
    var roof = [], i, j;
    for (i = 0; i < cs.n; i++) {
      if (cs.kind[i] === 1) continue;
      var w = cs.maxX[i] - cs.minX[i], d = cs.maxZ[i] - cs.minZ[i], t = cs.maxY[i] - cs.minY[i];
      if (w < 1 || d < 1 || w * d < 2 || t > 1.6) continue;
      var H = hf((cs.minX[i] + cs.maxX[i]) / 2, (cs.minZ[i] + cs.maxZ[i]) / 2);
      if (cs.minY[i] - H < HEIGHT || cs.minY[i] - H > BUILDING_ROOF_MAX) continue;
      roof.push(i);
    }
    var par = new Int32Array(roof.length);
    for (i = 0; i < roof.length; i++) par[i] = i;
    function find(a) { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; }
    var buck = new Map(), BK = 8;
    for (i = 0; i < roof.length; i++) {
      var c = roof[i];
      for (var bx = Math.floor((cs.minX[c] - 0.5) / BK); bx <= Math.floor((cs.maxX[c] + 0.5) / BK); bx++)
        for (var bz = Math.floor((cs.minZ[c] - 0.5) / BK); bz <= Math.floor((cs.maxZ[c] + 0.5) / BK); bz++) {
          var kk = bx * 100003 + bz; var l = buck.get(kk); if (l === undefined) { l = []; buck.set(kk, l); } l.push(i);
        }
    }
    buck.forEach(function (l) {
      for (var u = 0; u < l.length; u++) for (var v = u + 1; v < l.length; v++) {
        var A = roof[l[u]], B = roof[l[v]];
        if (cs.maxX[A] + 0.5 < cs.minX[B] || cs.maxX[B] + 0.5 < cs.minX[A] || cs.maxZ[A] + 0.5 < cs.minZ[B] || cs.maxZ[B] + 0.5 < cs.minZ[A]) continue;
        var ra = find(l[u]), rb = find(l[v]); if (ra !== rb) par[ra] = rb;
      }
    });
    var groups = new Map();
    for (i = 0; i < roof.length; i++) {
      var r = find(i), c2 = roof[i], g = groups.get(r);
      if (g === undefined) { g = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }; groups.set(r, g); }
      if (cs.minX[c2] < g.minX) g.minX = cs.minX[c2]; if (cs.maxX[c2] > g.maxX) g.maxX = cs.maxX[c2];
      if (cs.minZ[c2] < g.minZ) g.minZ = cs.minZ[c2]; if (cs.maxZ[c2] > g.maxZ) g.maxZ = cs.maxZ[c2];
    }
    var list = [];
    groups.forEach(function (g) { list.push(g); });
    list.sort(function (p, q2) { return p.minX - q2.minX || p.minZ - q2.minZ; });
    // ramps (stairs up to a deck) that touch a building belong to it
    for (i = 0; i < cs.n; i++) {
      if (cs.kind[i] !== 1) continue;
      for (j = 0; j < list.length; j++) {
        var g2 = list[j];
        if (cs.maxX[i] + 0.5 < g2.minX || cs.minX[i] - 0.5 > g2.maxX || cs.maxZ[i] + 0.5 < g2.minZ || cs.minZ[i] - 0.5 > g2.maxZ) continue;
        if (cs.minX[i] < g2.minX) g2.minX = cs.minX[i]; if (cs.maxX[i] > g2.maxX) g2.maxX = cs.maxX[i];
        if (cs.minZ[i] < g2.minZ) g2.minZ = cs.minZ[i]; if (cs.maxZ[i] > g2.maxZ) g2.maxZ = cs.maxZ[i];
        break;
      }
    }
    var M = 2.0;
    for (j = 0; j < list.length; j++) {
      var gj = list[j];
      gj.minX = Math.floor((gj.minX - M) / fineCell) * fineCell; gj.maxX = Math.ceil((gj.maxX + M) / fineCell) * fineCell;
      gj.minZ = Math.floor((gj.minZ - M) / fineCell) * fineCell; gj.maxZ = Math.ceil((gj.maxZ + M) / fineCell) * fineCell;
    }
    var changed = true;
    while (changed) {
      changed = false;
      for (i = 0; i < list.length && !changed; i++) for (j = i + 1; j < list.length && !changed; j++) {
        var P = list[i], Q = list[j];
        if (P.maxX <= Q.minX || Q.maxX <= P.minX || P.maxZ <= Q.minZ || Q.maxZ <= P.minZ) continue;
        P.minX = Math.min(P.minX, Q.minX); P.maxX = Math.max(P.maxX, Q.maxX); P.minZ = Math.min(P.minZ, Q.minZ); P.maxZ = Math.max(P.maxZ, Q.maxZ);
        list.splice(j, 1); changed = true;
      }
    }
    list.sort(function (p, q2) { return p.minX - q2.minX || p.minZ - q2.minZ; });
    return list;
  }

  /** Cut rects larger than `max` metres into near-equal chunks on the fine lattice (so every chunk is a whole number of cells). A chunk's `seam`
   *  says which of its sides face a sibling chunk of the same building (its rooms may only be reachable through the sibling). */
  function splitRects(list, max, cell) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var r = list[i], w = r.maxX - r.minX, d = r.maxZ - r.minZ;
      var nx = Math.max(1, Math.ceil(w / max - 1e-9)), nz = Math.max(1, Math.ceil(d / max - 1e-9));
      for (var a = 0; a < nx; a++) for (var b = 0; b < nz; b++) {
        var x0 = r.minX + Math.round(w * a / nx / cell) * cell, x1 = a === nx - 1 ? r.maxX : r.minX + Math.round(w * (a + 1) / nx / cell) * cell;
        var z0 = r.minZ + Math.round(d * b / nz / cell) * cell, z1 = b === nz - 1 ? r.maxZ : r.minZ + Math.round(d * (b + 1) / nz / cell) * cell;
        if (x1 > x0 && z1 > z0) out.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, gi: i, seam: (nx > 1 || nz > 1) ? { minX: a > 0, maxX: a < nx - 1, minZ: b > 0, maxZ: b < nz - 1 } : null });
      }
    }
    return out;
  }

  /**
   * A navigation world over one map.
   *   opts.colliders   maps.js colliders (snapshotted: dead ones are left out at this moment)
   *   opts.heightFn    (x, z) -> terrain height
   *   opts.tileSize    coarse tile edge, default 32 m
   *   opts.cellOutdoor 1.5, opts.cellIndoor 0.75 (nominal; the lattice divides the rect into whole cells)
   *   opts.cover       (tx, tz) -> bool: which coarse tiles may be baked (default: all). opts.zones [{x, z, r}] and opts.rects [{minX, maxX, minZ, maxZ}]
   *                    (grown by opts.margin, default 6 m) are shortcuts: only the coarse tiles that touch them bake. bakeTown() adds rects later.
   *   opts.fineRects   override the building rects found from the colliders ([] = none); opts.maxFine = the largest building tile side (default 16 m)
   *   opts.waterY      terrain this far under the water is not walkable
   *   opts.portals     [{x, y, z}] the map's launch portals: walking into one flings the actor, so they are obstacles
   */
  function createWorld(opts) {
    if (_primeMs < 0) { _primeMs = 0; primeReplay(); }      // (final/nav) once per module, before its first world: see FEEDBACK PRIMING
    var t0 = now();
    var blockers = [];
    if (opts.portals) for (var pi = 0; pi < opts.portals.length; pi++) blockers.push(portalBlocker(opts.portals[pi]));
    var cs = makeColSet(opts.colliders, blockers, opts.noFloor);
    var W = {
      isWorld: true, cs: cs, hf: opts.heightFn, tileSize: opts.tileSize || 32,
      cellOutdoor: opts.cellOutdoor || 1.5, cellIndoor: opts.cellIndoor || 0.75, waterY: opts.waterY != null ? opts.waterY : -Infinity,
      coarse: new Map(), fineByCoarse: new Map(), fine: [], groups: [], slots: [], stamp: 0, cover: null,
      stats: { bakes: 0, bakeMs: 0, islands: 0, resolved: 0, links: 0, linkMs: 0, queries: 0, queryMs: 0, expanded: 0 },
      // LAZY (Wave 7, lane 7B2): a world with noBake set never bakes a tile as a side effect of a query. A tile the search or a replay
      // asked for is NOT built: it reads as missing (a hop into it is blocked, a start or goal in it finds no node), and the request is
      // listed in W.wanted for the caller to schedule (runJob). The caller decides WHEN a tile is baked (a fixed tick schedule), so a query
      // that needs a building which is not baked yet fails fast instead of stalling a frame for 10-140 ms, and the answer is a function of
      // which tiles the schedule has baked - not of the clock. Every edge that exists is still certified by the mover replay.
      noBake: !!opts.lazy, wanted: [], wantSeen: new Set(),
    };
    var zones = opts.zones || null;
    W.zoneRects = [];
    if (opts.rects) addCoverRects(W, opts.rects, opts.margin);
    if (typeof opts.cover === "function") W.cover = opts.cover;
    else if (opts.rects) {
      W.cover = function (tx, tz) {
        var x0 = tx * W.tileSize, z0 = tz * W.tileSize, x1 = x0 + W.tileSize, z1 = z0 + W.tileSize, R = W.zoneRects;
        for (var i = 0; i < R.length; i++) if (x1 > R[i].minX && x0 < R[i].maxX && z1 > R[i].minZ && z0 < R[i].maxZ) return true;
        return false;
      };
    } else if (zones) {
      W.cover = function (tx, tz) {
        var x0 = tx * W.tileSize, z0 = tz * W.tileSize, x1 = x0 + W.tileSize, z1 = z0 + W.tileSize;
        for (var i = 0; i < zones.length; i++) {
          var z = zones[i], qx = z.x < x0 ? x0 : z.x > x1 ? x1 : z.x, qz = z.z < z0 ? z0 : z.z > z1 ? z1 : z.z;
          if ((z.x - qx) * (z.x - qx) + (z.z - qz) * (z.z - qz) <= z.r * z.r) return true;
        }
        return false;
      };
    } else W.cover = function () { return true; };
    var rects = splitRects(opts.fineRects || findBuildingRects(cs, W.hf, W.cellIndoor), opts.maxFine || FINE_MAX, W.cellIndoor);
    for (var i = 0; i < rects.length; i++) {
      var r = { minX: rects[i].minX, minZ: rects[i].minZ, maxX: rects[i].maxX, maxZ: rects[i].maxZ, seam: rects[i].seam || null, grp: null, tile: null, idx: i };
      W.fine.push(r);
      if (r.seam !== null) {
        var gj = rects[i].gi, gp = null;
        for (var gq = 0; gq < W.groups.length && gp === null; gq++) if (W.groups[gq].id === gj) gp = W.groups[gq];
        if (gp === null) { gp = { id: gj, rects: [], done: false }; W.groups.push(gp); }
        gp.rects.push(r); r.grp = gp;
      }
      var tx0 = Math.floor(r.minX / W.tileSize), tx1 = Math.floor((r.maxX - 1e-9) / W.tileSize);
      var tz0 = Math.floor(r.minZ / W.tileSize), tz1 = Math.floor((r.maxZ - 1e-9) / W.tileSize);
      for (var tx = tx0; tx <= tx1; tx++) for (var tz = tz0; tz <= tz1; tz++) {
        var key = coarseKey(tx, tz), l = W.fineByCoarse.get(key);
        if (l === undefined) { l = []; W.fineByCoarse.set(key, l); }
        l.push(r);
      }
    }
    W.stats.createMs = now() - t0;
    W.pb = null;                                          // (P2-E) the prebake of a lazy world (see PREBAKE): workers bake its tiles ahead
    if (W.noBake && opts.prebake !== false) pbStart(W);
    return W;
  }

  // A bake does NOT stitch. Stitching a tile replays hops that can step into a tile nobody has baked (a diagonal hop across a corner passes through
  // one of the two other tiles there); baking that tile and stitching it in turn used to cascade across the whole covered area (ashgrid seed 14:
  // one query baked 16,342 tiles and overflowed the global node id). Tiles are baked bare; linkTile() stitches a tile to the baked tiles around
  // it, and only ensureLinked / resolveGroup / prewarm ask for that.
  function register(W, T) {
    T.slot = W.slots.length; T.base = T.slot * STRIDE; W.slots.push(T);
    if (W.pb !== null && W.pb !== undefined) {           // (P2-E) in: a worker's copy arriving later is dropped; one no worker had goes to the stitch worker
      W.pb.done.add(T.key); W.pb.cache.delete(T.key);
      if (W.pb.on && W.pb.sw !== null) pbForward(W.pb, T);
    }
    W.stats.bakes++; W.stats.bakeMs += T.stats.ms;
  }

  function bakeCoarse(W, tx, tz) {
    if (W.slots.length >= MAX_SLOTS) return null;
    var size = W.tileSize, rect = { minX: tx * size, minZ: tz * size, maxX: (tx + 1) * size, maxZ: (tz + 1) * size };
    var holes = W.fineByCoarse.get(coarseKey(tx, tz)) || null;
    var P = W.pb !== null && W.pb !== undefined ? pbTake(W, coarseKey(tx, tz)) : null;      // (P2-E) a worker baked it: the same tile, the same work counted
    var T = P !== null ? pbInstallSync(W, P) : bakeTile(W.cs, W.hf, rect, W.cellOutdoor, { holes: holes, waterY: W.waterY, key: coarseKey(tx, tz) });
    T.kind = "coarse"; T.tx = tx; T.tz = tz;
    W.coarse.set(coarseKey(tx, tz), T);
    register(W, T);
    return T;
  }

  function bakeFine(W, r) {
    if (W.slots.length >= MAX_SLOTS) return null;
    var P = W.pb !== null && W.pb !== undefined ? pbTake(W, 100000000 + r.idx) : null;      // (P2-E)
    var T = P !== null ? pbInstallSync(W, P) : bakeTile(W.cs, W.hf, r, W.cellIndoor, { waterY: W.waterY, key: 100000000 + r.idx, seam: r.seam });
    T.kind = "fine"; T.rectRef = r; T.grp = r.grp;
    r.tile = T;
    register(W, T);
    return T;
  }

  /** The module scratch a replay uses (bakeTile saves and restores it around a whole bake; an incremental bake does the same around every slice). */
  var _scr = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];       // (reused: stepJob is not re-entrant, and a fresh array per slice was 10 MB of garbage per city)
  function saveScratch() { var s = _scr; s[0] = _hr[0]; s[1] = _hr[1]; s[2] = _hr[2]; s[3] = _hr[3]; s[4] = _hr[4]; s[5] = _hr[5]; s[6] = _marginUse; s[7] = _ec[0]; s[8] = _strictRamp; s[9] = _supRamp; s[10] = _rest; s[11] = _wsRamp; return s; }
  // (final/nav) the flags come back as small integers (| 0, they are 0 / 1; _wsRamp is a boolean): _scr holds doubles too (_hr), so its reads are heap numbers, and a heap number in
  // _supRamp / _rest / ... deoptimized every function that compares them ('not a Smi' in hopQ, Chrome's V8 log, at the first stepJob of the match)
  function loadScratch(s) { _hr[0] = s[0]; _hr[1] = s[1]; _hr[2] = s[2]; _hr[3] = s[3]; _hr[4] = s[4]; _hr[5] = s[5]; _marginUse = s[6] | 0; _ec[0] = s[7]; _strictRamp = s[8] | 0; _supRamp = s[9] | 0; _rest = s[10] | 0; _wsRamp = s[11] === true; }

  /**
   * AN INCREMENTAL JOB (lane 7B2): bake one tile of a lazy world (a { kind, key, tx, tz, rect } from collectJobs / takeWanted), stitch it to the baked
   * tiles round it and settle its building - a SLICE at a time. beginJob() starts it; each stepJob() call runs one slice of ~1-3 ms of replay work
   * (a count of flagged cells, replays and stitched pairs, never a clock) and returns true when the job is over. Driven to the end the world is the
   * one runJob() builds (same code, same order). A tile that is mid-bake is invisible to queries (it is registered when its bake ends).
   */
  function beginJob(W, j) {
    var job = { j: j, phase: 0, gen: null, tile: null, slices: 0, ms: 0, done: false, pre: false };
    if (j.kind === 0 ? W.coarse.has(j.key) : j.rect.tile !== null) { job.phase = 3; job.done = true; return job; }
    if (W.slots.length >= MAX_SLOTS) { job.phase = 3; job.done = true; return job; }
    if (W.pb !== null && W.pb !== undefined) {           // (P2-E) a worker baked this tile: the slices replay its recorded work and yields (see PREBAKE)
      pbSeed(W.pb, j);
      var P = pbTake(W, j.key);
      if (P !== null) { job.gen = pbReplayGen(W, P); job.pre = true; return job; }
    }
    if (j.kind === 0) {
      var size = W.tileSize, rect = { minX: j.tx * size, minZ: j.tz * size, maxX: (j.tx + 1) * size, maxZ: (j.tz + 1) * size };
      job.gen = bakeTileGen(W.cs, W.hf, rect, W.cellOutdoor, { holes: W.fineByCoarse.get(coarseKey(j.tx, j.tz)) || null, waterY: W.waterY, key: coarseKey(j.tx, j.tz) });
    } else {
      job.gen = bakeTileGen(W.cs, W.hf, j.rect, W.cellIndoor, { waterY: W.waterY, key: 100000000 + j.rect.idx, seam: j.rect.seam });
    }
    return job;
  }
  function stepJob(W, job) {
    if (job.done) return true;
    var t0 = now(), sv = saveScratch(), r;
    job.slices++;
    if (job.phase === 0) {
      _rest = 0;
      r = job.gen.next();
      loadScratch(sv);
      if (r.done) {
        var T = r.value, j = job.j;
        if (j.kind === 0) { T.kind = "coarse"; T.tx = j.tx; T.tz = j.tz; W.coarse.set(coarseKey(j.tx, j.tz), T); }
        else { T.kind = "fine"; T.rectRef = j.rect; T.grp = j.rect.grp; j.rect.tile = T; }
        register(W, T);
        T.linking = true;
        job.tile = T; job.gen = linkTileGen(W, T); job.phase = 1;
      }
    } else if (job.phase === 1) {
      _rest = 0;
      r = job.gen.next();
      loadScratch(sv);
      if (r.done) { job.gen = null; job.phase = 2; job.tile.linking = false; }
    } else {
      var g = job.j.kind === 1 ? job.j.rect.grp : null;
      if (g && !g.done && g.rects.every(function (q) { return q.tile !== null; })) resolveGroup(W, g);
      job.phase = 3; job.done = true;
    }
    job.ms += now() - t0;
    return job.done;
  }

  // ── PREBAKE (Wave P2, lane P2-E, LC-88): the bake of a lazy world's tiles, done AHEAD in Web Workers, replayed for free ──────────────────
  // A lazy world's tiles are baked on the bots' fixed tick schedule (bots.js navTick: NAV_STEPS_TICK replayed steps a tick, counted by work()), so WHEN
  // a tile enters the world is sim state. The bake itself (bakeTileGen) is a pure function of the collider set, the terrain lattice, the rect, the cell
  // and its opts - so it can be computed anywhere, any time, and only its RESULT and its WORK TRACE matter to the sim. A prebake worker bakes a tile with
  // the recorder on (_rec): every place where the generator yields or may yield is logged with the hop / step counters at that point (kinds: 1 the node
  // pass's unconditional yield, 2 the edge pass's yAt mark, 3 a conditional checkpoint "work since yAt >= YIELD_STEPS", 4 the end). When the schedule
  // then begins that job, beginJob replays the TRACE instead of the bake (pbReplayGen): the counters advance by exactly the bake's own work, the yields
  // fall exactly where the bake's would (the conditional ones are evaluated live, so work done between slices - queries - moves them the same way), and
  // the tile handed to the stitch is the one the bake builds (same arrays, same hash). The stitch, the settling of a building and every query stay on the
  // main thread as they were (a stitch depends on which tiles are in: order-dependent state). So the sim is the same tick for tick whether a worker's
  // tile arrived in time or not - a missing one is simply baked as before - and a replay of a seed is identical with or without workers.
  // Only the wall clock differs: the drop's bots section loses the bake (89 % of its nav cost, split.mjs). Workers start when a lazy world is created
  // (bots.js startNav, right after buildMap: the model loading and the lobby are their time) and stop when every tile of the world's rects is done.
  // (P23 fix round) THAT IS MAP-BUILD TIME: the world needs the map's final collider set, which exists when buildMap resolves, and startNav runs from the
  // first attachBrain right after it (measured: bakeTown 0.08-0.13 s, before the first idle moment after W.map is set). The window to Enter is then only the
  // actor-model load, the shader warm-up and the lobby - 6-14 s on the shared box when Enter is pressed at once (the default flow). So the queue puts the
  // BUILDINGS first (the only tiles the drop's schedule bakes: the outdoor ones are bots.js's own loading pump + barrier) and a desktop runs up to 6 bake
  // workers. Measured (ashgrid seed 7, Enter at once): at Enter 525 of 711 buildings in (was ~30), drop bots section p95 2.3 ms real rAF (base 4.6) and
  // 1.9 ms per paced tick (base 3.8), first 5 s p95 1.1 ms (base 15.9), every state hash equal to the base build's.
  // The schedule itself is NOT paced by the wall clock while results are pending: which tile is in at which tick is sim state, so a wall-clock pace would
  // make a seed play differently with and without workers (and on a fast and a slow machine). A deterministic pace (a smaller NAV_STEPS_TICK_DROP while
  // nobody has landed) would be bots.js's schedule, as is prebakeHint(world, landing spots) - the exact drop order - which assignDrops could pass.
  // Off when: no Worker / Blob (Node, old browsers), the height function carries no validated lattice (a worker could not read the same ground), the
  // page URL has ngworker=0 (A/B), opts.prebake === false, or anything throws (the bake then runs on the main thread exactly as before).
  var _rec = null, _recB0 = 0, _recB1 = 0;
  function recEv(k) { _rec.push(k, _cnt[0] - _recB0, _cnt[1] - _recB1); }
  // (P23 fix round) PB_MAX_WORKERS 3 -> 6 on a desktop (half the hardware threads, at most 6): the default flow (Enter straight from the lobby) leaves the
  // workers only the actor-model load + the shader warm-up after buildMap (6-13 s on the shared box) to bake ~750 building tiles; 3 workers had 40 % of them
  // in at Enter. A touch device keeps the 3 workers it had (PB_TOUCH_WORKERS: phones untouched).
  var PB_MAX_WORKERS = 6, PB_TOUCH_WORKERS = 3, PB_INFLIGHT = 2, PB_SEEDS = 64;
  var PB_ARRS = ["nearStart", "nearItems", "x", "y", "z", "flag", "bord", "adj", "cellStart", "edgeStart", "edgeTo", "edgeCost", "edgeKind"];
  var _pbLive = null;                // the world whose workers run (a new lazy world retires the old one's)

  /** Bake one job with the recorder on, driven slice by slice exactly as stepJob drives it. Returns the payload { key, kind, s, a, stats, hash, ev }. */
  function pbBakeRecorded(cs, hf, d) {
    var opts = d.kind === 0 ? { holes: d.holes, waterY: d.waterY, key: d.key } : { waterY: d.waterY, key: d.key, seam: d.seam };
    var rec = [], g, r, sv;
    _rec = rec; _recB0 = _cnt[0]; _recB1 = _cnt[1];
    try {
      g = bakeTileGen(cs, hf, d.rect, d.cell, opts);
      do { sv = saveScratch(); _rest = 0; r = g.next(); loadScratch(sv); } while (!r.done);
    } finally { _rec = null; }
    var T = r.value, a = {};
    for (var i = 0; i < PB_ARRS.length; i++) a[PB_ARRS[i]] = T[PB_ARRS[i]];
    var big = false;
    for (i = 0; i < rec.length; i++) if (rec[i] > 2147483647) { big = true; break; }
    return {
      key: d.key, kind: d.kind, a: a, stats: T.stats, hash: T.hash, ev: big ? Float64Array.from(rec) : Int32Array.from(rec),
      s: [T.minX, T.minZ, T.maxX, T.maxZ, T.cell, T.nx, T.nz, T.inv, T.deepY, T.wetY, T.n, T.dOrth, T.dDiag, T.bordCount],
    };
  }
  /** The tile a payload describes, in the world's terms (its collider set, its height function, its hole list): the object bakeTileGen returns,
   *  field for field and in the same property order (one hidden class for every tile). */
  function pbAssemble(W, P) {
    var s = P.s, a = P.a, cs = W.cs, hf = W.hf;
    var holes = P.kind === 0 ? (W.fineByCoarse.get(P.key) || null) : null;
    var T = tileShell(P.key, s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], hf, s[8], s[9], cs);      // (final/nav) the one tile class, see tileShell
    T.nearStart = a.nearStart; T.nearItems = a.nearItems;
    T.dOrth = s[11]; T.dDiag = s[12];
    T.n = s[10] | 0; T.x = a.x; T.y = a.y; T.z = a.z; T.flag = a.flag; T.bord = a.bord; T.adj = a.adj; T.cellStart = a.cellStart;
    T.edgeStart = a.edgeStart; T.edgeTo = a.edgeTo; T.edgeCost = a.edgeCost; T.edgeKind = a.edgeKind;
    T.bordCount = s[13] | 0; T.holes = holes || [];
    T.extStart = null; T.extTo = null; T.extCost = null; T.extKind = null; T.pend = null; T.linked = [];
    T.stats = P.stats;
    T.hash = P.hash;
    return T;
  }
  /** The bake of a payload as the generator the schedule drives: the recorded counters, the recorded yields (the conditional ones evaluated
   *  against the live counter, as the bake does), then the tile. No replay, no allocation beyond the tile object. */
  function* pbReplayGen(W, P) {
    var ev = P.ev, p0 = 0, p1 = 0, yAt = 0, k, c0, c1;
    for (var i = 0; i < ev.length; i += 3) {
      k = ev[i]; c0 = ev[i + 1]; c1 = ev[i + 2];
      _cnt[0] += c0 - p0; _cnt[1] += c1 - p1; p0 = c0; p1 = c1;
      if (k === 3) { if (_cnt[1] - yAt >= YIELD_STEPS) { yAt = _cnt[1]; yield 0; } }
      else if (k === 1) yield 0;
      else if (k === 2) yAt = _cnt[1];
    }
    return pbAssemble(W, P);
  }
  /** The synchronous form (runJob / bakeCoarse / bakeFine): the whole trace's counters at once, then the tile. */
  function pbInstallSync(W, P) {
    var ev = P.ev, n = ev.length;
    if (n >= 3) { _cnt[0] += ev[n - 2]; _cnt[1] += ev[n - 1]; }
    return pbAssemble(W, P);
  }
  /** The payload for this key, if a worker delivered it (it leaves the cache: a tile is installed once). */
  function pbTake(W, key) {
    var pb = W.pb;
    if (pb === undefined || pb === null) return null;
    var P = pb.cache.get(key);
    pb.done.add(key);
    if (P === undefined) { pb.misses++; return null; }
    pb.cache.delete(key); pb.hits++;
    return P;
  }
  /** Every job of the world's rects (coarse first, in collectJobs order - the order bots.js bakes them in - then the buildings), as worker messages. */
  function pbJobs(W) {
    var out = [], seen = new Set(), i, k, js, j, size = W.tileSize, fine = [];
    for (i = 0; i < W.zoneRects.length; i++) {
      js = collectJobs(W, W.zoneRects[i]);
      for (k = 0; k < js.length; k++) {
        j = js[k];
        if (seen.has(j.key)) continue;
        seen.add(j.key);
        if (j.kind === 0) {
          var hl = W.fineByCoarse.get(j.key) || null, hs = null;
          if (hl !== null) { hs = []; for (var h = 0; h < hl.length; h++) hs.push({ minX: hl[h].minX, minZ: hl[h].minZ, maxX: hl[h].maxX, maxZ: hl[h].maxZ }); }
          out.push({ t: "job", kind: 0, key: j.key, rect: { minX: j.tx * size, minZ: j.tz * size, maxX: (j.tx + 1) * size, maxZ: (j.tz + 1) * size }, cell: W.cellOutdoor, holes: hs, waterY: W.waterY, seam: null, sent: false });
        } else {
          var r = j.rect;
          fine.push({ t: "job", kind: 1, key: j.key, rect: { minX: r.minX, minZ: r.minZ, maxX: r.maxX, maxZ: r.maxZ }, cell: W.cellIndoor, holes: null, waterY: W.waterY, seam: r.seam,
                      cx: (r.minX + r.maxX) * 0.5, cz: (r.minZ + r.maxZ) * 0.5, sent: false });
        }
      }
    }
    return { coarse: out, fine: fine };
  }
  function pbInit(W, on) {
    var J = pbJobs(W);
    W.pb = { on: on, cache: new Map(), done: new Set(), coarse: J.coarse, ci: J.coarse.length, fine: J.fine, front: [], seeds: [], hinted: false, jobs: J.coarse.length + J.fine.length,
             byKey: null, list: null, workers: [], sw: null, swIdle: false, bakeOver: false, url: null, sent: 0, baked: 0, dropped: 0, hits: 0, misses: 0, workerMs: 0,
             t0: now(), tDone: -1, tSeams: -1, tFine: -1, fineSent: 0, fineBaked: 0, fineMs: 0, err: null,
             seams: new Map(), seamsIn: 0, seamsUsed: 0, seamsLate: 0, recMemo: 0, recLive: 0, fwd: 0, swMs: 0 };
    var bk = new Map(), i, list = [];
    for (i = 0; i < J.coarse.length; i++) { bk.set(J.coarse[i].key, J.coarse[i]); list.push({ key: J.coarse[i].key, rect: J.coarse[i].rect }); }
    for (i = 0; i < J.fine.length; i++) { bk.set(J.fine[i].key, J.fine[i]); list.push({ key: J.fine[i].key, rect: J.fine[i].rect }); }
    W.pb.byKey = bk; W.pb.list = list; W.pb.fine0 = J.fine.length;
    return W.pb;
  }
  /** The next job to hand a worker: a tile a query asked for (takeWanted) first, then the building nearest to the buildings the schedule has started (its
   *  first jobs are the ones round the bots' landing spots, bots.js navPrefetch) - or prebakeHint's points - and the OUTDOOR tiles last, from the far end
   *  of their list. (P23 fix round) The outdoor tiles came first: bots.js bakes every one of them itself in the loading screen's idle time (startNav's
   *  background pump, collectJobs order, then the barrier), so the workers spent half their load-time window racing it for the same tiles (225 of 1205 jobs
   *  "dropped" at Enter) while the drop's BUILDINGS - the only tiles the drop's schedule bakes - waited. From the far end, a worker never takes the tile the
   *  pump takes next. */
  function pbNext(pb) {
    var j = pbNextFine(pb);
    if (j !== null) return j;
    while (pb.ci > 0) { j = pb.coarse[--pb.ci]; if (!pb.done.has(j.key) && !j.sent) return j; }
    return null;
  }
  function pbNextFine(pb) {
    var j, i;
    while (pb.front.length) { j = pb.front.shift(); if (!pb.done.has(j.key) && !j.sent) return j; }
    var F = pb.fine, best = -1, bd = Infinity, S = pb.seeds;
    for (i = 0; i < F.length; i++) {
      j = F[i];
      if (j.sent || pb.done.has(j.key)) continue;
      if (S.length === 0) { best = i; break; }
      var d = Infinity;
      for (var k = 0; k < S.length; k += 2) { var dx = j.cx - S[k], dz = j.cz - S[k + 1], dd = dx * dx + dz * dz; if (dd < d) d = dd; }
      if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return null;
    j = F[best]; F.splice(best, 1);
    return j;
  }
  function pbFeed(W, pb, wk) {
    while (pb.on && wk.out < PB_INFLIGHT) {
      var j = pbNext(pb);
      if (j === null) break;
      j.sent = true; wk.out++; pb.sent++;
      if (j.kind === 1) pb.fineSent++;
      wk.w.postMessage(j);
    }
    if (pb.on && !pb.bakeOver) {
      var busy = false;
      for (var i = 0; i < pb.workers.length; i++) if (pb.workers[i].out > 0) busy = true;
      if (!busy) { pb.bakeOver = true; pb.tDone = now() - pb.t0; if (pb.sw === null || pb.swIdle) pbStop(W); }      // the stitch worker may still be busy: it stops the lot when idle
    }
  }
  function pbStop(W) {
    var pb = W && W.pb;
    if (!pb) return;
    pb.on = false;
    for (var i = 0; i < pb.workers.length; i++) { try { pb.workers[i].w.terminate(); } catch (e) { /* gone */ } }
    pb.workers.length = 0;
    if (pb.sw !== null) { try { pb.sw.terminate(); } catch (e) { /* gone */ } pb.sw = null; }
    if (pb.url !== null) { try { URL.revokeObjectURL(pb.url); } catch (e) { /* gone */ } pb.url = null; }
    if (_pbLive === W) _pbLive = null;
  }
  function pbAvailable() {
    if (typeof Worker !== "function" || typeof Blob !== "function" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
    if (root.__ngPrebake === 1) return false;
    try { if (typeof location !== "undefined" && /[?&]ngworker=0(&|$)/.test(String(location.search))) return false; } catch (e) { /* no location */ }
    return true;
  }
  function pbWorldDesc(W) {
    var f = [];
    for (var i = 0; i < W.fine.length; i++) { var r = W.fine[i]; f.push({ minX: r.minX, minZ: r.minZ, maxX: r.maxX, maxZ: r.maxZ, idx: r.idx }); }
    return { tileSize: W.tileSize, cellOutdoor: W.cellOutdoor, cellIndoor: W.cellIndoor, waterY: W.waterY, fine: f };
  }
  /** Start the workers of a lazy world (createWorld calls it; a no-op where workers or the lattice are missing): PB_MAX_WORKERS bake workers and
   *  one stitch worker (SEAMS); every bake worker hands its tiles to the stitch worker through its own MessageChannel. */
  function pbStart(W) {
    if (!pbAvailable() || W.zoneRects.length === 0) return;
    var hf = W.hf, hl = latFor(hf);
    if (hl === null || !hf.ground || !(hf.size > 0)) return;      // the bake would call heightAt itself: a worker cannot read that ground
    if (_pbLive !== null) pbStop(_pbLive);
    var pb = pbInit(W, true);
    if (pb.jobs === 0) { pb.on = false; return; }
    try {
      var hc = typeof navigator !== "undefined" && navigator.hardwareConcurrency > 0 ? navigator.hardwareConcurrency : 2;
      var nW = pbWorkerCount(hc, typeof navigator !== "undefined" && navigator.maxTouchPoints > 0, pb.jobs);
      var src = "self.__ngPrebake = 1;\n(" + navgridFactory.toString() + ")(self);\n";
      pb.url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      var cs = W.cs, csd = { n: cs.n, minX: cs.minX, maxX: cs.maxX, minY: cs.minY, maxY: cs.maxY, minZ: cs.minZ, maxZ: cs.maxZ, kind: cs.kind, dir: cs.dir };
      var init = { t: "init", cs: csd, L: hf.ground.lattice, latN: hf.ground.latN, size: hf.size };
      _pbLive = W;
      var sw = typeof MessageChannel === "function" ? new Worker(pb.url) : null;
      if (sw !== null) {
        sw.onmessage = pbOnSeam(W, pb); sw.onerror = pbOnError(W, pb);
        sw.postMessage({ t: "sinit", cs: csd, L: hf.ground.lattice, latN: hf.ground.latN, size: hf.size, world: pbWorldDesc(W), jobs: pb.list });
        pb.sw = sw;
      }
      for (var i = 0; i < nW; i++) {
        var wk = { w: new Worker(pb.url), out: 0 };
        wk.w.onmessage = pbOnMessage(W, pb, wk);
        wk.w.onerror = pbOnError(W, pb);
        wk.w.postMessage(init);
        if (sw !== null) { var ch = new MessageChannel(); wk.w.postMessage({ t: "port" }, [ch.port1]); sw.postMessage({ t: "port" }, [ch.port2]); }
        pb.workers.push(wk);
      }
      for (i = 0; i < pb.workers.length; i++) pbFeed(W, pb, pb.workers[i]);
    } catch (e) { pb.err = String(e && e.message || e); pbStop(W); }
  }
  /** How many bake workers: half the hardware threads (the main thread, the GPU process and the stitch worker keep the rest), at most PB_MAX_WORKERS
   *  (PB_TOUCH_WORKERS on a touch device: the phones' count of before), at most one per 8 jobs, at least one. */
  function pbWorkerCount(hc, touch, jobs) {
    var cap = touch ? Math.min(PB_TOUCH_WORKERS, hc - 2) : Math.min(PB_MAX_WORKERS, Math.floor(hc / 2));
    return Math.max(1, Math.min(cap, Math.ceil(jobs / 8)));
  }
  function pbOnMessage(W, pb, wk) {
    return function (e) {
      var d = e.data;
      if (!pb.on) return;
      if (d.t === "err") { pb.err = d.msg; pbStop(W); return; }
      wk.out--;
      if (d.t === "tile") {
        var P = d.P;
        pb.workerMs += P.stats.ms; pb.baked++;
        if (P.kind === 1) { pb.fineBaked++; pb.fineMs += P.stats.ms; if (pb.fineBaked === pb.fine0 && pb.tFine < 0) pb.tFine = now() - pb.t0; }
        if (pb.done.has(P.key)) pb.dropped++;          // the schedule got there first: it baked the tile itself
        else pb.cache.set(P.key, P);
      }
      pbFeed(W, pb, wk);
    };
  }
  function pbOnSeam(W, pb) {
    return function (e) {
      var d = e.data;
      if (!pb.on) return;
      if (d.t === "err") { pb.err = d.msg; pbStop(W); return; }
      pb.swMs = d.ms;
      if (d.t === "sidle") { pb.swIdle = true; pb.tSeams = now() - pb.t0; if (pb.bakeOver) pbStop(W); return; }
      if (d.t !== "seam") return;
      var s = d.s, A = pbTile(W, s.a), B = pbTile(W, s.b);
      pb.seamsIn++;
      if (A !== null && B !== null && A.linked.indexOf(B.key) >= 0) { pb.seamsLate++; return; }      // the schedule stitched this pair already
      pb.seams.set(s.a + "," + s.b, s);
    };
  }
  function pbOnError(W, pb) {
    return function (ev) { try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e) { /* */ } pb.err = "worker error: " + (ev && ev.message || "?"); pbStop(W); };
  }
  function pbTile(W, key) {
    if (key >= 100000000) { var r = W.fine[key - 100000000]; return r !== undefined && r.tile !== null ? r.tile : null; }
    var t = W.coarse.get(key);
    return t === undefined ? null : t;
  }
  /** A tile the main thread baked itself (no worker had it): the stitch worker gets a copy (its arrays cloned), so the seams round it are answered too. */
  function pbForward(pb, T) {
    var d = pb.byKey.get(T.key);
    if (d !== undefined && d.sent) return;               // a bake worker has it: it hands its copy over itself
    var a = {};
    for (var i = 0; i < PB_ARRS.length; i++) a[PB_ARRS[i]] = T[PB_ARRS[i]];
    try {
      pb.sw.postMessage({ t: "tile", P: { key: T.key, kind: T.kind === "coarse" ? 0 : 1, a: a, stats: T.stats, hash: T.hash,
        s: [T.minX, T.minZ, T.maxX, T.maxZ, T.cell, T.nx, T.nz, T.inv, T.deepY, T.wetY, T.n, T.dOrth, T.dDiag, T.bordCount] } });
      pb.fwd++;
    } catch (e) { /* the copy is a nicety */ }
  }
  /** Inside a prebake worker: the collider set and the lattice come once, then jobs; every tile goes back with its arrays transferred (and a copy
   *  to the stitch worker first). The stitch worker ("sinit") builds the mirror world instead and answers seams (see SEAMS). */
  function pbWorkerMain(G) {
    var cs = null, hf = null, port = null, H = null, idleSent = false;
    function ground(d) {
      var c = d.cs;
      cs = { isColSet: true, n: c.n, minX: c.minX, maxX: c.maxX, minY: c.minY, maxY: c.maxY, minZ: c.minZ, maxZ: c.maxZ, kind: c.kind, dir: c.dir };
      var Lq = { L: d.L, n: d.latN, c: d.latN - 1, k: (d.latN - 1) / d.size, h: d.size / 2 };
      hf = function (x, z) { _hq[0] = x; _hq[1] = z; latRead(Lq); return _hq[2]; };
      hf.ground = { lattice: d.L, latN: d.latN }; hf.size = d.size;
    }
    function hostAdd(P) {
      pbHostAdd(H, P);
      if (!idleSent && H.arrived >= H.njobs && H.waiting === 0) { idleSent = true; G.postMessage({ t: "sidle", ms: H.ms }); }
    }
    function fail(err) { G.postMessage({ t: "err", msg: String(err && err.stack || err) }); }
    G.onmessage = function (e) {
      var d = e.data;
      try {
        if (d.t === "init") { ground(d); return; }
        if (d.t === "sinit") {
          ground(d);
          H = pbHost(cs, hf, d.world, d.jobs, function (s) {
            G.postMessage({ t: "seam", s: s, ms: H.ms }, [s.L0.buffer, s.L1.buffer, s.K.buffer, s.C.buffer, s.S.buffer, s.H.buffer, s.F.buffer, s.X.buffer, s.TL.buffer]);
          });
          return;
        }
        if (d.t === "port") {
          var p = e.ports[0];
          if (H !== null) p.onmessage = function (ev) { try { hostAdd(ev.data.P); } catch (err) { fail(err); } };
          else port = p;
          return;
        }
        if (d.t === "tile") { if (H !== null) hostAdd(d.P); return; }      // a tile the main thread baked itself
        if (d.t !== "job") return;
        var P = pbBakeRecorded(cs, hf, d), tr = [], seen = new Set();
        if (port !== null) port.postMessage({ t: "tile", P: { key: P.key, kind: P.kind, s: P.s, a: P.a, stats: P.stats, hash: P.hash } });      // a copy (cloned), before the transfer below
        for (var i = 0; i < PB_ARRS.length; i++) { var b = P.a[PB_ARRS[i]].buffer; if (!seen.has(b)) { seen.add(b); tr.push(b); } }
        if (!seen.has(P.ev.buffer)) tr.push(P.ev.buffer);
        G.postMessage({ t: "tile", P: P }, tr);
      } catch (err) { fail(err); }
    };
  }

  // ── SEAMS (Wave P2, lane P2-E): the stitch's replays, answered ahead by the stitch worker ─────────────────────────────────────────────────
  // With the bakes prebaked, what is left of a tile job on the main thread is the STITCH (linkTileGen): every border node pair across a seam is
  // classified by evalEdgeQ in both directions - the mover replayed again - ~17 % of the schedule's steps and nearly all of what a drop-frame tick
  // still costs. A pair's answer is a pure function of: the two nodes (tile data), the colliders and the ground, the tiles its replays LOOK UP as the
  // line goes (tileForQ: which tiles are in) and the mover's carried state on entry (the ramp flag _supRamp: player.js keeps it from tick to tick,
  // and so does the replay - a pair evaluated after another can answer differently; _strictRamp / _rest are 0 in a stitch). So the stitch worker
  // keeps a MIRROR world of every tile the bake workers (and the main thread) made, and when a seam's tiles are in it, it evaluates every pair
  // linkTileGen could ask about (in the order it asks them, for either tile being the newcomer) from BOTH entry ramp flags, recording per answer:
  // the kind, the cost (float32, as mergeExt stores it), the hop / step counts it added, the ramp flag and the margin flag it leaves, and the tiles
  // it looked up beside the two (a lookup that found nothing marks the record unusable). linkTileGen takes a record only when it is the very pair
  // it is at, the entry flag picks the variant, _strictRamp / _rest are 0 and every looked-up tile is in on the main thread - then the live call
  // would take the identical path (same tiles, no want() side effect) and the record IS its result, counters and carried state included; any other
  // case replays it live as before. The stitched graph, the work counter and so every yield of the schedule are the same with or without seams.
  var _tfRec = null;
  /** The mirror world of the stitch worker: the main world's geometry (tile size, cells, the building rects in the same order), no tiles yet. */
  function pbMirror(cs, hf, wd) {
    var W = {
      isWorld: true, cs: cs, hf: hf, tileSize: wd.tileSize, cellOutdoor: wd.cellOutdoor, cellIndoor: wd.cellIndoor, waterY: wd.waterY,
      coarse: new Map(), fineByCoarse: new Map(), fine: [], groups: [], slots: [], stamp: 0, cover: function () { return true; },
      stats: { bakes: 0, bakeMs: 0, islands: 0, resolved: 0, links: 0, linkMs: 0, queries: 0, queryMs: 0, expanded: 0 },
      noBake: true, wanted: [], wantSeen: new Set(), noWant: true, zoneRects: [], pb: null,
    };
    for (var i = 0; i < wd.fine.length; i++) {
      var q = wd.fine[i], r = { minX: q.minX, minZ: q.minZ, maxX: q.maxX, maxZ: q.maxZ, seam: null, grp: null, tile: null, idx: q.idx };
      W.fine.push(r);
      var tx0 = Math.floor(r.minX / W.tileSize), tx1 = Math.floor((r.maxX - 1e-9) / W.tileSize);
      var tz0 = Math.floor(r.minZ / W.tileSize), tz1 = Math.floor((r.maxZ - 1e-9) / W.tileSize);
      for (var tx = tx0; tx <= tx1; tx++) for (var tz = tz0; tz <= tz1; tz++) {
        var key = coarseKey(tx, tz), l = W.fineByCoarse.get(key);
        if (l === undefined) { l = []; W.fineByCoarse.set(key, l); }
        l.push(r);
      }
    }
    return W;
  }
  function pbHost(cs, hf, wd, jobs, emit) {
    var H = { M: pbMirror(cs, hf, wd), jobs: new Map(), wait: new Map(), pend: new Set(), arrived: 0, njobs: jobs.length, waiting: 0, emit: emit, ms: 0, seams: 0 };
    for (var i = 0; i < jobs.length; i++) H.jobs.set(jobs[i].key, jobs[i].rect);
    return H;
  }
  function pbHas(W, key) {
    if (key >= 100000000) { var r = W.fine[key - 100000000]; return r !== undefined && r.tile !== null; }
    return W.coarse.has(key);
  }
  /** A tile arrives in the mirror: register it, open a seam with every tile within the stitch's reach, run the seams that were waiting for it. */
  function pbHostAdd(H, P) {
    var M = H.M;
    if (pbHas(M, P.key)) return;
    var T = pbAssemble(M, P);
    if (P.kind === 0) { T.kind = "coarse"; T.tx = (Math.floor(P.key / 8192) - 4096) | 0; T.tz = (P.key % 8192 - 4096) | 0; M.coarse.set(P.key, T); }
    else { var r = M.fine[P.key - 100000000]; T.kind = "fine"; T.rectRef = r; r.tile = T; }
    T.slot = M.slots.length; T.base = T.slot * STRIDE; M.slots.push(T);
    if (H.jobs.has(P.key)) H.arrived++;
    var near = tilesAround(M, { minX: T.minX, maxX: T.maxX, minZ: T.minZ, maxZ: T.maxZ }, 3.2, false);
    for (var i = 0; i < near.length; i++) if (near[i] !== T) pbHostSeam(H, T, near[i]);
    var wl = H.wait.get(P.key);
    if (wl !== undefined) {
      H.wait.delete(P.key);
      for (i = 0; i < wl.length; i++) if (--wl[i].miss === 0) { H.waiting--; pbHostRun(H, wl[i]); }
    }
  }
  /** Open the seam X-Y: it runs once every job tile that its replays may look up (2 m round the two rects' overlap) is in the mirror. (A lookup
   *  outside that, or of a tile that is never baked, only makes that record unusable: the main thread replays it.) */
  function pbHostSeam(H, X, Y) {
    // (P23 fix round) only a seam with a BUILDING tile on one side: the outdoor tiles are all baked AND stitched to each other before the first tick (bots.js
    // startNav's loading-screen pump + the barrier), so an outdoor-outdoor record could only arrive late (1020 of 3376 seams "late" at Enter, the stitch
    // worker's time and a core of the box spent on them while the drop's building seams waited). The main thread stitches those pairs live, as it always did.
    if (X.kind === "coarse" && Y.kind === "coarse") return;
    var A = X.key < Y.key ? X : Y, B = A === X ? Y : X, sk = A.key + "," + B.key, M = H.M;
    if (H.pend.has(sk)) return;
    H.pend.add(sk);
    var s = { A: A, B: B, miss: 0 }, E = 2.0;
    var x0 = Math.max(A.minX, B.minX) - E, x1 = Math.min(A.maxX, B.maxX) + E, z0 = Math.max(A.minZ, B.minZ) - E, z1 = Math.min(A.maxZ, B.maxZ) + E;
    var size = M.tileSize, need = [];
    for (var tx = Math.floor(x0 / size); tx <= Math.floor(x1 / size); tx++) for (var tz = Math.floor(z0 / size); tz <= Math.floor(z1 / size); tz++) {
      var key = coarseKey(tx, tz);
      if (key !== A.key && key !== B.key && H.jobs.has(key) && !M.coarse.has(key) && need.indexOf(key) < 0) need.push(key);
      var fl = M.fineByCoarse.get(key);
      if (fl !== undefined) for (var i = 0; i < fl.length; i++) {
        var r = fl[i], k = 100000000 + r.idx;
        if (r.maxX < x0 || r.minX > x1 || r.maxZ < z0 || r.minZ > z1) continue;
        if (k !== A.key && k !== B.key && H.jobs.has(k) && r.tile === null && need.indexOf(k) < 0) need.push(k);
      }
    }
    if (need.length === 0) { pbHostRun(H, s); return; }
    s.miss = need.length; H.waiting++;
    for (var n = 0; n < need.length; n++) { var wl = H.wait.get(need[n]); if (wl === undefined) { wl = []; H.wait.set(need[n], wl); } wl.push(s); }
  }
  function pbHostRun(H, s) {
    var t0 = now(), out = pbSeamCompute(H.M, s.A, s.B);
    H.ms += now() - t0; H.seams++;
    H.emit(out);
  }
  /** Every pair linkTileGen would classify across the seam A-B (A.key < B.key), in its order, with A as the newcomer (L0) and with B (L1):
   *  [newcomer node, other node, pair] triples; per pair four records (A->B, B->A) x (entry ramp flag 0, 1) at pair * 4 + direction * 2 + flag. */
  function pbSeamCompute(M, A, B) {
    var sv = saveScratch().slice(), c0 = _cnt[0], c1 = _cnt[1], c2 = _cnt[2];
    var pairs = new Map(), np = 0, L = [[], []];
    var out = { K: [], C: [], S: [], H: [], F: [], X: [], TL: [] };
    try {
      for (var o = 0; o < 2; o++) {
        var N = o === 0 ? A : B, O = o === 0 ? B : A, Lo = L[o];
        var reach = 0.875 * (N.cell + O.cell) + 0.1;
        for (var n = 0; n < N.n; n++) {
          if (N.bord[n] === 0) continue;
          var ax = N.x[n], az = N.z[n];
          if (ax + reach < O.minX || ax - reach >= O.maxX || az + reach < O.minZ || az - reach >= O.maxZ) continue;
          var i0 = Math.max(0, Math.floor((ax - reach - O.minX) * O.inv)), i1 = Math.min(O.nx - 1, Math.floor((ax + reach - O.minX) * O.inv));
          var k0 = Math.max(0, Math.floor((az - reach - O.minZ) * O.inv)), k1 = Math.min(O.nz - 1, Math.floor((az + reach - O.minZ) * O.inv));
          for (var iz = k0; iz <= k1; iz++) for (var ix = i0; ix <= i1; ix++) {
            var ci = iz * O.nx + ix;
            for (var m = O.cellStart[ci]; m < O.cellStart[ci + 1]; m++) {
              var dx = O.x[m] - ax, dz = O.z[m] - az;
              if (dx * dx + dz * dz > reach * reach) continue;
              var an = o === 0 ? n : m, bn = o === 0 ? m : n, pk = an * STRIDE + bn, p = pairs.get(pk);
              if (p === undefined) {
                p = np++; pairs.set(pk, p);
                pbRecord(M, A, an, B, bn, 0, out); pbRecord(M, A, an, B, bn, 1, out);
                pbRecord(M, B, bn, A, an, 0, out); pbRecord(M, B, bn, A, an, 1, out);
              }
              Lo.push(n, m, p);
            }
          }
        }
      }
    } finally {
      _tfRec = null;
      loadScratch(sv); _cnt[0] = c0; _cnt[1] = c1; _cnt[2] = c2;
    }
    return { a: A.key, b: B.key, n: np, L0: Int32Array.from(L[0]), L1: Int32Array.from(L[1]), K: Int8Array.from(out.K), C: Float32Array.from(out.C),
             S: Int32Array.from(out.S), H: Int32Array.from(out.H), F: Uint8Array.from(out.F), X: Int32Array.from(out.X), TL: Int32Array.from(out.TL) };
  }
  /** One record: evalEdgeQ(S node sn -> D node dn) from entry ramp flag v, as the stitch calls it. F bits: 1 the ramp flag it leaves, 2 / 4 the margin
   *  flag it leaves from an entry margin flag of 0 / 1 (a hop clears it first; with no hop it is only ever set), 8 unusable. */
  function pbRecord(M, S, sn, D, dn, v, out) {
    _supRamp = v; _marginUse = 0; _strictRamp = 0; _rest = 0;
    var h0 = _cnt[0], s0 = _cnt[1];
    var rec = [];
    _tfRec = rec;
    _eq[0] = S.x[sn]; _eq[1] = S.y[sn]; _eq[2] = S.z[sn]; _eq[3] = D.x[dn]; _eq[4] = D.y[dn]; _eq[5] = D.z[dn];
    var kd = evalEdgeQ(M, S, S.flag[sn], D.flag[dn], -1, -1);
    _tfRec = null;
    if (M.wanted.length) { M.wanted.length = 0; M.wantSeen.clear(); }
    var dh = _cnt[0] - h0, ds = _cnt[1] - s0, m0 = _marginUse === 1 ? 1 : 0, m1 = dh === 0 ? 1 : m0;
    var bad = 0, xs = -1, tk = null;
    for (var i = 0; i < rec.length; i++) {
      var k = rec[i];
      if (k === -1) { bad = 1; break; }
      if (k === S.key || k === D.key) continue;
      if (tk === null) tk = [];
      if (tk.indexOf(k) < 0) tk.push(k);
    }
    if (_supRamp !== 0 && _supRamp !== 1) bad = 1;
    if (!bad && tk !== null) { xs = out.TL.length; out.TL.push(tk.length); for (i = 0; i < tk.length; i++) out.TL.push(tk[i]); }
    out.K.push(kd); out.C.push(kd >= 0 ? _ec[0] : 0); out.S.push(ds); out.H.push(dh);
    out.F.push((_supRamp === 1 ? 1 : 0) | (m0 << 1) | (m1 << 2) | (bad << 3)); out.X.push(xs);
  }
  /** linkTileGen's cursors: per fresh tile U, the seam record list for T as the newcomer (null when the stitch worker has no answer for that seam). */
  function pbCursors(pb, T, fresh) {
    var sm = null, keys = null;
    for (var u = 0; u < fresh.length; u++) {
      var U = fresh[u], a = T.key < U.key ? T.key : U.key, b = a === T.key ? U.key : T.key, k = a + "," + b, s = pb.seams.get(k);
      if (s === undefined) continue;
      if (sm === null) { sm = []; for (var q = 0; q < fresh.length; q++) sm.push(null); keys = []; }
      sm[u] = { s: s, L: a === T.key ? s.L0 : s.L1, i: 0, d: a === T.key ? 0 : 1 };
      keys.push(k);
    }
    if (sm !== null) sm.keys = keys;
    return sm;
  }
  /** The pair linkTileGen is at must be the next one of the cursor's list (it always is: same tiles, same loops); else the seam is given up. */
  function pbPair(cu, n, m) {
    var L = cu.L, i = cu.i;
    if (i + 2 >= L.length || L[i] !== n || L[i + 1] !== m) return -1;
    cu.i = i + 3;
    return L[i + 2];
  }
  /** The record r0 + entry ramp flag, applied as the live evalEdgeQ would have run: its counters, its carried flags, its cost. -2 = unusable. */
  function pbSeamRec(W, s, r0) {
    var pb = W.pb;
    if (_strictRamp !== 0 || _rest !== 0 || (_supRamp !== 0 && _supRamp !== 1)) { pb.recLive++; return -2; }
    var r = r0 + _supRamp, f = s.F[r];
    if ((f & 8) !== 0) { pb.recLive++; return -2; }
    var x = s.X[r];
    if (x >= 0) { var TL = s.TL, nk = TL[x]; for (var k = 1; k <= nk; k++) if (!pbHas(W, TL[x + k])) { pb.recLive++; return -2; } }
    _cnt[0] += s.H[r]; _cnt[1] += s.S[r];
    _supRamp = f & 1;
    _marginUse = _marginUse === 0 ? (f >> 1) & 1 : (f >> 2) & 1;
    var kd = s.K[r];
    if (kd >= 0) _ec[0] = s.C[r];
    pb.recMemo++;
    return kd;
  }
  function pbSeamsDone(pb, sm) {
    for (var i = 0; i < sm.keys.length; i++) if (pb.seams.delete(sm.keys[i])) pb.seamsUsed++;
  }

  /** For tests and probes (Node: no workers): prebake jobs IN PROCESS - the worker's code on this thread, the counters put back afterwards, so the
   *  world sees only the cache. `filter(job) -> bool` picks the jobs (default all). opts.seams: answer the seams too, as the stitch worker would,
   *  from the tiles prebaked here (a mirror world in this process). Returns how many tiles were baked. */
  function prebakeInline(W, filter, opts) {
    var pb = W.pb || pbInit(W, false), c0 = _cnt[0], c1 = _cnt[1], list = pb.coarse.concat(pb.fine), n = 0, baked = [];
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (pb.done.has(d.key) || pb.cache.has(d.key) || (filter && !filter(d))) continue;
      var P = pbBakeRecorded(W.cs, W.hf, d);
      pb.cache.set(d.key, P); pb.baked++; n++; pb.workerMs += P.stats.ms; baked.push(P);
    }
    _cnt[0] = c0; _cnt[1] = c1;
    if (opts && opts.seams) {
      var t0 = now();
      var H = pbHost(W.cs, W.hf, pbWorldDesc(W), pb.list, function (s) { pb.seamsIn++; pb.seams.set(s.a + "," + s.b, s); });
      for (i = 0; i < baked.length; i++) {
        var Q = baked[i], a = {};
        for (var k = 0; k < PB_ARRS.length; k++) a[PB_ARRS[k]] = Q.a[PB_ARRS[k]].slice();      // the mirror's own copy, as a worker's would be
        pbHostAdd(H, { key: Q.key, kind: Q.kind, s: Q.s, a: a, stats: Q.stats, hash: Q.hash });
      }
      pb.swMs = H.ms; pb.tSeams = now() - t0;
    }
    return n;
  }
  /** Where the schedule will bake next (bots.js may pass its landing spots, e.g. from navPrefetch): the workers take the buildings nearest these points first. */
  function prebakeHint(W, pts) {
    var pb = W && W.pb;
    if (!pb || !pts) return;
    pb.seeds.length = 0;
    for (var i = 0; i < pts.length && i < PB_SEEDS; i++) pb.seeds.push(+pts[i].x, +pts[i].z);
    pb.hinted = true;
  }
  /** The schedule began job j: its building is where the next ones will be (until a hint says otherwise). */
  function pbSeed(pb, j) {
    if (pb.hinted || pb.seeds.length >= 2 * PB_SEEDS || j.kind !== 1 || !j.rect) return;
    pb.seeds.push((j.rect.minX + j.rect.maxX) * 0.5, (j.rect.minZ + j.rect.maxZ) * 0.5);
  }
  /** A query asked for these tiles (takeWanted): the workers take them next. */
  function pbFront(pb, jobs) {
    for (var i = 0; i < jobs.length; i++) { var d = pb.byKey.get(jobs[i].key); if (d !== undefined && !d.sent && !pb.done.has(d.key)) pb.front.push(d); }
  }
  function prebakeStats(W) {
    var pb = W && W.pb;
    if (!pb) return { on: false, jobs: 0 };
    return { on: pb.on, workers: pb.workers.length, stitchWorker: pb.sw !== null, jobs: pb.jobs, sent: pb.sent, baked: pb.baked, cached: pb.cache.size, hits: pb.hits, misses: pb.misses,
             dropped: pb.dropped, fwd: pb.fwd, workerMs: Math.round(pb.workerMs), doneMs: pb.tDone >= 0 ? Math.round(pb.tDone) : null,
             seamsIn: pb.seamsIn, seamsHeld: pb.seams.size, seamsUsed: pb.seamsUsed, seamsLate: pb.seamsLate, recMemo: pb.recMemo, recLive: pb.recLive,
             stitchMs: Math.round(pb.swMs), seamsDoneMs: pb.tSeams >= 0 ? Math.round(pb.tSeams) : null, err: pb.err,
             fineJobs: pb.fine0, fineSent: pb.fineSent, fineBaked: pb.fineBaked, fineMs: Math.round(pb.fineMs), fineDoneMs: pb.tFine >= 0 ? Math.round(pb.tFine) : null,
             fineCached: pbCountFine(pb), ageMs: Math.round(now() - pb.t0) };
  }
  function pbCountFine(pb) {
    var n = 0;
    pb.cache.forEach(function (v, k) { if (k >= 100000000) n++; });
    return n;
  }

  /** A lazy world (W.noBake) refused to bake a tile: remember it, once, as a job for runJob. A building cut into chunks is wanted whole
   *  (its chunks settle together, see resolveGroup). Jobs are listed in the order they were first asked for: a function of the queries. */
  function want(W, kind, tx, tz, r) {
    if (W.noWant) return;                 // ensureLinked is looking at the neighbours of a border node: a nicety, not a need (see there)
    var rs = kind === 1 ? (r.grp !== null ? r.grp.rects : [r]) : null, i;
    if (kind === 0) {
      var k0 = coarseKey(tx, tz);
      if (!W.wantSeen.has(k0)) { W.wantSeen.add(k0); W.wanted.push({ kind: 0, key: k0, tx: tx, tz: tz, rect: null }); }
      return;
    }
    for (i = 0; i < rs.length; i++) {
      var k1 = 100000000 + rs[i].idx;
      if (rs[i].tile === null && !W.wantSeen.has(k1)) { W.wantSeen.add(k1); W.wanted.push({ kind: 1, key: k1, tx: 0, tz: 0, rect: rs[i] }); }
    }
  }

  /** The tile that owns (x, z): the building tile if one stands there, else the coarse tile (baked on demand when `bake`; never in a lazy world). */
  var _tf = new Float64Array(2);
  function tileFor(W, x, z, bake) { _tf[0] = x; _tf[1] = z; return tileForQ(W, bake); }
  // (P2-E) _tfRec: the stitch worker's lookup recorder (the tiles a seam pair's replays looked up, see SEAMS); null on the main thread
  function tileForQ(W, bake) {
    if (_tfRec === null) return tileForQ0(W, bake);
    var t = tileForQ0(W, bake);
    _tfRec.push(t === null ? -1 : t.key);
    return t;
  }
  function tileForQ0(W, bake) {
    var x = _tf[0], z = _tf[1];      // (Wave 8, I2: the numbers come through _tf - a call boxes double arguments)
    var tx = Math.floor(x / W.tileSize), tz = Math.floor(z / W.tileSize), key = coarseKey(tx, tz);
    var fl = W.fineByCoarse.get(key);
    if (fl !== undefined) {
      for (var i = 0; i < fl.length; i++) {
        var r = fl[i];
        if (x >= r.minX && x < r.maxX && z >= r.minZ && z < r.maxZ) {
          if (r.tile !== null) return r.tile;
          if (!bake) return null;
          if (W.noBake) { want(W, 1, 0, 0, r); return null; }
          return bakeFine(W, r);
        }
      }
    }
    var t = W.coarse.get(key);
    if (t !== undefined) return t;
    if (!bake || !W.cover(tx, tz)) return null;
    if (W.noBake) { want(W, 0, tx, tz, null); return null; }
    return bakeCoarse(W, tx, tz);
  }

  /** Every tile that may hold nodes within `reach` of the rect (the baked ones, or all when `bake`). Sorted by key. */
  function tilesAround(W, rect, reach, bake) {
    var out = [], size = W.tileSize;
    var tx0 = Math.floor((rect.minX - reach) / size), tx1 = Math.floor((rect.maxX + reach) / size);
    var tz0 = Math.floor((rect.minZ - reach) / size), tz1 = Math.floor((rect.maxZ + reach) / size);
    var seen = [];
    for (var tx = tx0; tx <= tx1; tx++) for (var tz = tz0; tz <= tz1; tz++) {
      var key = coarseKey(tx, tz), t = W.coarse.get(key);
      if (t === undefined && bake && W.cover(tx, tz)) {
        if (W.noBake) want(W, 0, tx, tz, null);
        else { t = bakeCoarse(W, tx, tz); if (t === null) t = undefined; }
      }
      if (t !== undefined && seen.indexOf(t) < 0) { seen.push(t); out.push(t); }
      var fl = W.fineByCoarse.get(key);
      if (fl !== undefined) for (var i = 0; i < fl.length; i++) {
        var r = fl[i];
        if (r.maxX < rect.minX - reach || r.minX > rect.maxX + reach || r.maxZ < rect.minZ - reach || r.minZ > rect.maxZ + reach) continue;
        var ft = r.tile !== null ? r.tile : (bake ? (W.noBake ? (want(W, 1, 0, 0, r), null) : bakeFine(W, r)) : null);      // null: not baked (or the slot space is full, or a lazy world)
        if (ft !== null && seen.indexOf(ft) < 0) { seen.push(ft); out.push(ft); }
      }
    }
    out.sort(function (p, q) { return p.key - q.key; });
    return out;
  }

  /** Fold the links found since the last call (T.pend: src, global dst id, cost, kind per edge) into T's sorted ext CSR. The order within a source is
   *  by the destination tile's KEY then its local id, never by bake order, so the stitched graph is the same however the tiles were baked. */
  function mergeExt(W, T) {
    var pend = T.pend;
    if (pend === null || pend.length === 0) return;
    T.pend = null;
    var old = T.extTo !== null ? T.extTo.length : 0, add = pend.length / 4 | 0, tot = old + add, i, l, e;
    var src = new Int32Array(tot), to = new Int32Array(tot), cost = new Float32Array(tot), kind = new Uint8Array(tot), key = new Float64Array(tot);
    var k = 0;
    if (old > 0) for (l = 0; l < T.n; l++) for (e = T.extStart[l]; e < T.extStart[l + 1]; e++) { src[k] = l; to[k] = T.extTo[e]; cost[k] = T.extCost[e]; kind[k] = T.extKind[e]; k++; }
    for (i = 0; i < add; i++) { src[k] = pend[i * 4]; to[k] = pend[i * 4 + 1]; cost[k] = pend[i * 4 + 2]; kind[k] = pend[i * 4 + 3]; k++; }
    for (i = 0; i < tot; i++) key[i] = W.slots[to[i] >> SHIFT].key * STRIDE + (to[i] & (STRIDE - 1));
    // order by (source, destination key); equal pairs keep their insertion order (old links first). The old links are ALREADY in that order (this function wrote them),
    // so only the new ones are sorted and the two runs are merged - the same permutation the full stable sort gave, without sorting the whole list every stitch.
    var order = new Array(tot), pn = tot - old, pidx = new Array(pn);
    for (i = 0; i < pn; i++) pidx[i] = old + i;
    pidx.sort(function (p, q) { return (src[p] - src[q]) || (key[p] - key[q]); });
    var ia = 0, ib = 0, io = 0;
    while (ia < old && ib < pn) {
      var pb = pidx[ib], cmp = (src[ia] - src[pb]) || (key[ia] - key[pb]);
      if (cmp <= 0) order[io++] = ia++; else order[io++] = pb, ib++;
    }
    while (ia < old) order[io++] = ia++;
    while (ib < pn) order[io++] = pidx[ib++];
    var EI = tot < 65535 ? Uint16Array : Int32Array;
    var xs = new EI(T.n + 1), xt = new Int32Array(tot), xc = new Float32Array(tot), xk = new Uint8Array(tot);
    for (i = 0; i < tot; i++) xs[src[i] + 1]++;
    for (i = 0; i < T.n; i++) xs[i + 1] += xs[i];
    for (i = 0; i < tot; i++) { var o = order[i]; xt[i] = to[o]; xc[i] = cost[o]; xk[i] = kind[o]; }
    T.extStart = xs; T.extTo = xt; T.extCost = xc; T.extKind = xk;
  }

  /** Stitch tile T to every baked tile whose nodes lie within reach of its border nodes (and has not been stitched to T yet): each candidate
   *  pair is classified (replayed) in BOTH directions, so a ramp or a drop across a seam stays one way. A pair is a pure function of the two
   *  tiles (and of the colliders a hop crosses on the way), so the stitched graph does not depend on the order tiles were baked or linked in. */
  function linkTile(W, T) {
    var g = linkTileGen(W, T), r;
    do { r = g.next(); } while (!r.done);
  }
  /** linkTile as a generator: a `yield` every YIELD_STEPS replayed steps (stepJob spreads a stitch over frames; driven to the end it is linkTile). */
  function* linkTileGen(W, T) {
    if (T.linkedAt === W.slots.length) return;                  // nothing has been baked since T was last stitched to every baked tile round it (a search asks once per border node)
    var near = tilesAround(W, { minX: T.minX, maxX: T.maxX, minZ: T.minZ, maxZ: T.maxZ }, 3.2, false), fresh = [], i, yL = _cnt[1];
    for (i = 0; i < near.length; i++) if (near[i] !== T && T.linked.indexOf(near[i].key) < 0) fresh.push(near[i]);
    if (fresh.length === 0) { T.linkedAt = W.slots.length; return; }
    var t0 = now(), touched = [T];
    for (i = 0; i < fresh.length; i++) { T.linked.push(fresh[i].key); fresh[i].linked.push(T.key); touched.push(fresh[i]); }
    var sm = W.pb !== null && W.pb !== undefined && W.pb.seams.size > 0 ? pbCursors(W.pb, T, fresh) : null;      // (P2-E) the stitch worker's answers for these seams (see SEAMS)
    for (var n = 0; n < T.n; n++) {
      if (T.bord[n] === 0) continue;
      var ax = T.x[n], ay = T.y[n], az = T.z[n], fa = T.flag[n];
      for (var u = 0; u < fresh.length; u++) {
        var U = fresh[u], cu = sm !== null ? sm[u] : null, pr = -1;
        var reach = 0.875 * (T.cell + U.cell) + 0.1;
        if (ax + reach < U.minX || ax - reach >= U.maxX || az + reach < U.minZ || az - reach >= U.maxZ) continue;
        var i0 = Math.max(0, Math.floor((ax - reach - U.minX) * U.inv)), i1 = Math.min(U.nx - 1, Math.floor((ax + reach - U.minX) * U.inv));
        var k0 = Math.max(0, Math.floor((az - reach - U.minZ) * U.inv)), k1 = Math.min(U.nz - 1, Math.floor((az + reach - U.minZ) * U.inv));
        for (var iz = k0; iz <= k1; iz++) for (var ix = i0; ix <= i1; ix++) {
          var ci = iz * U.nx + ix;
          for (var m = U.cellStart[ci]; m < U.cellStart[ci + 1]; m++) {
            var bx = U.x[m], by = U.y[m], bz = U.z[m], dx = bx - ax, dz = bz - az;
            if (dx * dx + dz * dz > reach * reach) continue;
            var fb = U.flag[m], kd = -2;
            if (cu !== null) { pr = pbPair(cu, n, m); if (pr < 0) { sm[u] = cu = null; } else kd = pbSeamRec(W, cu.s, pr * 4 + cu.d * 2); }      // (P2-E) -2: no usable answer, replay it here
            if (kd === -2) kd = (_eq[0] = ax, _eq[1] = ay, _eq[2] = az, _eq[3] = bx, _eq[4] = by, _eq[5] = bz, evalEdgeQ(W, T, fa, fb, -1, -1));
            if (kd >= 0) { (T.pend || (T.pend = [])).push(n, U.base + m, _ec[0], kd); }
            kd = cu !== null ? pbSeamRec(W, cu.s, pr * 4 + (1 - cu.d) * 2) : -2;
            if (kd === -2) kd = (_eq[0] = bx, _eq[1] = by, _eq[2] = bz, _eq[3] = ax, _eq[4] = ay, _eq[5] = az, evalEdgeQ(W, U, fb, fa, -1, -1));
            if (kd >= 0) { (U.pend || (U.pend = [])).push(m, T.base + n, _ec[0], kd); }
            if (_cnt[1] - yL >= YIELD_STEPS) { yL = _cnt[1]; yield 0; }
          }
        }
      }
    }
    if (sm !== null) pbSeamsDone(W.pb, sm);
    for (var t = 0; t < touched.length; t++) mergeExt(W, touched[t]);
    T.linkedAt = W.slots.length;
    W.stats.links++; W.stats.linkMs += now() - t0;
  }

  /** Before a border node is expanded: bake (and stitch) the tiles on the side(s) it faces, so its outgoing edges are complete
   *  whatever the order of earlier queries. A node near the west edge needs the west neighbour, near a hole its building. */
  function ensureLinked(W, T, n) {
    var m = T.bord[n];
    if (m === 0 || (m & 32) !== 0) return;
    T.bord[n] = m | 32;                                     // bit 32: this node's neighbours are baked and stitched
    // A lazy world asks for NOTHING here: a search that walks along a street would otherwise want every building it passes (377 jobs for 120
    // queries, 310 of them in the first round). Only a start or a goal needs its tile (snapNodes / findPath ask for those). What is not baked
    // reads as a wall, so a route may miss a short cut through a building that is not in yet; every edge it does use is certified.
    W.noWant = true;
    var x = T.x[n], z = T.z[n], D = LINK_BAND + 0.2;
    var dx = (m & 1) ? -D : (m & 2) ? D : 0, dz = (m & 4) ? -D : (m & 8) ? D : 0;
    if (dx !== 0) (_tf[0] = x + dx, _tf[1] = z, tileForQ(W, true));
    if (dz !== 0) (_tf[0] = x, _tf[1] = z + dz, tileForQ(W, true));
    if (dx !== 0 && dz !== 0) (_tf[0] = x + dx, _tf[1] = z + dz, tileForQ(W, true));
    if ((m & 16) !== 0) {
      for (var k = 0; k < T.holes.length; k++) {
        var h = T.holes[k];
        if (x > h.minX - LINK_BAND && x < h.maxX + LINK_BAND && z > h.minZ - LINK_BAND && z < h.maxZ + LINK_BAND && h.tile === null && !W.noBake) bakeFine(W, h);
      }
    }
    linkTile(W, T);
    W.noWant = false;
  }

  /** A split building's chunks are pruned one at a time, so a node kept only because it touches a seam (F_PROV) may be an island (a roof,
   *  a sealed room) or may be the far half of a house whose door is in the sibling. Bake every sibling, flood the directed graph across
   *  the stitched seams from the nodes that were reachable on their own, and mark what is left (T.island): snapping refuses those,
   *  exactly as an unsplit building would have pruned them. A* never enters an island (nothing reachable has an edge into it). */
  function resolveGroup(W, grp) {
    if (grp.done) return true;
    if (W.noBake) {                                     // lazy: the siblings are scheduled, not baked here; runJob settles the building when the last one is in
      for (var gi = 0; gi < grp.rects.length; gi++) {
        if (grp.rects[gi].tile === null) { want(W, 1, 0, 0, grp.rects[gi]); return false; }
        if (grp.rects[gi].tile.linking === true) return false;      // a sibling is baked but its stitch is still running (stepJob): the flood must not run on half the seam
      }
    }
    grp.done = true;
    var ts = [], i, l, T, e, queue = [];
    for (i = 0; i < grp.rects.length; i++) { var r = grp.rects[i]; ts.push(r.tile !== null ? r.tile : bakeFine(W, r)); }
    for (i = 0; i < ts.length; i++) linkTile(W, ts[i]);
    for (i = 0; i < ts.length; i++) {
      T = ts[i]; T.rch = new Uint8Array(T.n);
      for (l = 0; l < T.n; l++) if ((T.flag[l] & F_PROV) === 0) { T.rch[l] = 1; queue.push(T.base + l); }
    }
    for (var qh = 0; qh < queue.length; qh++) {
      var id = queue[qh], A = W.slots[id / STRIDE | 0], la = id % STRIDE;
      for (e = A.edgeStart[la]; e < A.edgeStart[la + 1]; e++) { var lb = A.edgeTo[e]; if (A.rch[lb] === 0) { A.rch[lb] = 1; queue.push(A.base + lb); } }
      if (A.adj[la] !== 0) {
        var aix = ((A.x[la] - A.minX) * A.inv) | 0, aiz = ((A.z[la] - A.minZ) * A.inv) | 0;
        for (var ab = 0; ab < 8; ab++) {
          if ((A.adj[la] & (1 << ab)) === 0) continue;
          var ld2 = plainDest(A, A.flag[la], A.y[la], (aiz + NB8Z[ab]) * A.nx + aix + NB8X[ab]);
          if (ld2 >= 0 && A.rch[ld2] === 0) { A.rch[ld2] = 1; queue.push(A.base + ld2); }
        }
      }
      if (A.extStart !== null) for (e = A.extStart[la]; e < A.extStart[la + 1]; e++) {
        var gid = A.extTo[e], B = W.slots[gid / STRIDE | 0], lc = gid % STRIDE;
        if (B.grp === grp && B.rch[lc] === 0) { B.rch[lc] = 1; queue.push(gid); }
      }
    }
    for (i = 0; i < ts.length; i++) {
      T = ts[i];
      var isl = null;
      for (l = 0; l < T.n; l++) if ((T.flag[l] & F_PROV) !== 0 && T.rch[l] === 0) { if (isl === null) isl = new Uint8Array(T.n); isl[l] = 1; W.stats.islands++; }
      T.island = isl; T.rch = null;
    }
    W.stats.resolved++;
    return true;
  }

  // ── start / goal snapping ────────────────────────────────────────────────────────────────────────────────────────
  var SNAP_K = 6;
  var snapGid = new Int32Array(SNAP_K), snapSc = new Float64Array(SNAP_K), snapKey = new Int32Array(SNAP_K);
  var snapN = 0;
  var snapTie = new Float64Array(SNAP_K);   // tile key * STRIDE + local id: the tie-break never depends on the order tiles were baked in
  function snapInsert(sc, gid, key) {
    var tie = key * STRIDE + (gid % STRIDE);
    var p = snapN < SNAP_K ? snapN : SNAP_K - 1;
    if (snapN === SNAP_K && !(sc < snapSc[p] || (sc === snapSc[p] && tie < snapTie[p]))) return;
    if (snapN < SNAP_K) snapN++;
    while (p > 0 && (snapSc[p - 1] > sc || (snapSc[p - 1] === sc && snapTie[p - 1] > tie))) { snapGid[p] = snapGid[p - 1]; snapSc[p] = snapSc[p - 1]; snapKey[p] = snapKey[p - 1]; snapTie[p] = snapTie[p - 1]; p--; }
    snapGid[p] = gid; snapSc[p] = sc; snapKey[p] = key; snapTie[p] = tie;
  }

  /** The nodes nearest (x, y, z): same-floor first (3 x the height gap + the taxi distance). Fills snapGid / snapN. */
  function snapNodes(W, x, y, z, maxDy, R) {
    for (var attempt = 0; attempt < 8; attempt++) {
      snapScan(W, x, y, z, maxDy, R);
      var pend = null;
      for (var g = 0; g < snapN && pend === null; g++) {
        var Tq = W.slots[snapGid[g] / STRIDE | 0];
        if (Tq.grp !== null && !Tq.grp.done && (Tq.flag[snapGid[g] % STRIDE] & F_PROV) !== 0) pend = Tq.grp;
      }
      if (pend === null) break;
      if (!resolveGroup(W, pend)) break;           // bakes the siblings, then the scan runs again without the islands (a lazy world: they are only scheduled)
    }
    return snapN;
  }
  function snapScan(W, x, y, z, maxDy, R) {
    snapN = 0;
    var tiles = tilesAround(W, { minX: x, maxX: x, minZ: z, maxZ: z }, R, true);
    for (var u = 0; u < tiles.length; u++) {
      var U = tiles[u];
      var i0 = Math.max(0, Math.floor((x - R - U.minX) * U.inv)), i1 = Math.min(U.nx - 1, Math.floor((x + R - U.minX) * U.inv));
      var k0 = Math.max(0, Math.floor((z - R - U.minZ) * U.inv)), k1 = Math.min(U.nz - 1, Math.floor((z + R - U.minZ) * U.inv));
      if (x + R < U.minX || x - R >= U.maxX || z + R < U.minZ || z - R >= U.maxZ) continue;
      for (var iz = k0; iz <= k1; iz++) for (var ix = i0; ix <= i1; ix++) {
        var ci = iz * U.nx + ix;
        for (var m = U.cellStart[ci]; m < U.cellStart[ci + 1]; m++) {
          var dy = Math.abs(U.y[m] - y);
          if (dy > maxDy) continue;
          if (U.island !== null && U.island[m] === 1) continue;
          snapInsert(3 * dy + Math.abs(U.x[m] - x) + Math.abs(U.z[m] - z), U.base + m, U.key);
        }
      }
    }
    return snapN;
  }

  // ── A* + string pull ─────────────────────────────────────────────────────────────────────────────────────────────
  // The search keeps its per-node state (g, parent, kind, closed) in ONE world-wide open-addressing table keyed by the global node id, not in
  // 17 bytes per node of every baked tile: a town of 50,000 nodes held 0.85 MB of search scratch that is idle between queries. The table is a
  // fixed 0.43 MB (ARENA_CAP slots) that a query clears with one fill; a query that needs more than ARENA_MAX nodes ends as "limit".
  var SHIFT = 17;                // log2(STRIDE)
  var ARENA_CAP = 1 << 15, ARENA_MAX = 22000, AR_SEEN = 4, AR_CLOSED = 128;
  var arK = null, arG = null, arP = null, arF = null, arUsed = 0;
  var NB8X = [1, -1, 0, 0, 1, 1, -1, -1], NB8Z = [0, 0, 1, -1, 1, -1, 1, -1];     // the first four are the orthogonal neighbours (cost d), the rest diagonal (cost d * sqrt 2)
  function arenaReset() {
    if (arK === null) { arK = new Int32Array(ARENA_CAP); arG = new Float32Array(ARENA_CAP); arP = new Int32Array(ARENA_CAP); arF = new Uint8Array(ARENA_CAP); }
    arK.fill(-1); arUsed = 0;
  }
  /** the slot of node id `gid` (inserted when new); -1 when the table is full */
  function arSlot(gid) {
    var h = Math.imul(gid, -1640531535) >>> 17;
    for (;;) {
      var k = arK[h];
      if (k === gid) return h;
      if (k === -1) {
        if (arUsed >= ARENA_MAX) return -1;
        arK[h] = gid; arUsed++; arF[h] = 0;
        return h;
      }
      h = (h + 1) & (ARENA_CAP - 1);
    }
  }
  var heapId = new Int32Array(4096), heapF = new Float64Array(4096), heapN = 0;
  function hpush(id, f) {
    if (heapN === heapId.length) { heapId = grow(heapId, heapN * 2, Int32Array); heapF = grow(heapF, heapN * 2, Float64Array); }
    var c = heapN++;
    while (c > 0) { var p = (c - 1) >> 1; if (heapF[p] <= f) break; heapId[c] = heapId[p]; heapF[c] = heapF[p]; c = p; }
    heapId[c] = id; heapF[c] = f;
  }
  function hpop() {
    var top = heapId[0];
    heapN--;
    if (heapN > 0) {
      var id = heapId[heapN], f = heapF[heapN], c = 0;
      for (;;) {
        var l = 2 * c + 1;
        if (l >= heapN) break;
        var r = l + 1, mm = (r < heapN && heapF[r] < heapF[l]) ? r : l;
        if (heapF[mm] >= f) break;
        heapId[c] = heapId[mm]; heapF[c] = heapF[mm]; c = mm;
      }
      heapId[c] = id; heapF[c] = f;
    }
    return top;
  }

  /**
   * Path from (sx, sy, sz) to (tx, ty, tz): A* over the baked floors (tiles bake and stitch as the search reaches
   * them), then a string pull with the mover replay. Returns the waypoints AFTER the start, each { x, y, z, k } with k
   * the kind of the leg that arrives there (0 walk, 1 drop, 2 ramp), or null when there is no route. A drop is never
   * pulled across: both its ends stay waypoints. opts: { pad (extra clearance for pulled legs, default 0.15, max 0.3),
   * maxExpand (default 12000), noPull, hw (heuristic weight, default 1 = optimal) }.
   * hw 1.3 (measured on 2,500 random routes of 5-140 m through three Savanna towns): 2.25 x fewer nodes expanded, routes 1.1 % longer on average, and 29 of the 36
   * routes that ran out of the 12,000-node budget at 100-140 m (the default weight needs more than that to find a way round a block) are found.
   * world.lastFail names why a query returned null.
   */
  function findPath(W, sx, sy, sz, tx, ty, tz, opts) {
    var t0 = now();
    opts = opts || {};
    W.stats.queries++;
    W.lastFail = null;
    if (W.noBake) { W.wanted.length = 0; W.wantSeen.clear(); }      // a lazy world: W.wanted afterwards = the tiles THIS query asked for (see want)
    if (ty == null) ty = W.hf(tx, tz);
    var maxExpand = opts.maxExpand || 12000;
    var HWq = opts.hw != null ? +opts.hw : HW;                       // the weight this query uses
    var pad = opts.pad != null ? opts.pad : 0.15;
    if (pad > PAD_MAX) pad = PAD_MAX; if (pad < 0) pad = 0;
    var mdq = opts.maxDrop != null && +opts.maxDrop >= 0 ? +opts.maxDrop : Infinity;      // (P2-E) the tallest drop edge this query may take (a downed crawler, a fall-damage budget); default: every drop the grid has
    // goal candidates first (the snap scratch is shared): nodes the mover can walk straight to the goal point from, else the nearest
    var nG = snapNodes(W, tx, ty, tz, 1.5, 2.6);
    if (nG === 0) { W.lastFail = "no-goal"; W.stats.queryMs += now() - t0; return null; }
    var goals = [], g, gc = [];
    for (g = 0; g < nG; g++) gc.push(snapGid[g]);
    for (g = 0; g < gc.length && goals.length < 3; g++) {
      var Tq = W.slots[gc[g] / STRIDE | 0], lq = gc[g] % STRIDE;
      if ((_hp[0] = Tq.x[lq], _hp[1] = Tq.y[lq], _hp[2] = Tq.z[lq], _hp[3] = tx, _hp[4] = tz, _hp[5] = RADIUS, hopQ(W, Tq, null, -1)) && _hr[1] <= MAX_WALK_GAP && Math.abs(_hr[0] - ty) <= 0.6) goals.push(gc[g]);
    }
    var goalVerified = goals.length > 0;
    if (!goalVerified) goals.push(gc[0]);
    // start candidates: nodes the mover can walk to from where the bot stands (it may be in a doorway the nearest node is behind)
    var nS = snapNodes(W, sx, sy, sz, 1.5, 2.6);
    if (nS === 0) { W.lastFail = "no-start"; W.stats.queryMs += now() - t0; return null; }
    var starts = [], sc0 = [], scc = [], ssc = [];
    for (g = 0; g < nS; g++) { scc.push(snapGid[g]); ssc.push(snapSc[g]); }
    var Ts0 = (_tf[0] = sx, _tf[1] = sz, tileForQ(W, true));
    for (g = 0; g < scc.length && starts.length < 3; g++) {
      var Tr = W.slots[scc[g] / STRIDE | 0], lr = scc[g] % STRIDE;
      if (Ts0 !== null && (_hp[0] = sx, _hp[1] = sy, _hp[2] = sz, _hp[3] = Tr.x[lr], _hp[4] = Tr.z[lr], _hp[5] = RADIUS, hopQ(W, Ts0, null, -1)) && _hr[1] <= MAX_WALK_GAP && Math.abs(_hr[0] - Tr.y[lr]) <= 0.6) { starts.push(scc[g]); sc0.push(ssc[g]); }
    }
    if (starts.length === 0) { W.lastFail = "start-blocked"; W.stats.queryMs += now() - t0; return null; }
    var Tg = W.slots[goals[0] / STRIDE | 0], lg = goals[0] % STRIDE, gx = Tg.x[lg], gy = Tg.y[lg], gz = Tg.z[lg];
    arenaReset();
    heapN = 0;
    var best = -1, expanded = 0, full = false;
    var slotQ;
    for (g = 0; g < starts.length; g++) {
      var id0 = starts[g], T0 = W.slots[id0 >> SHIFT], l0 = id0 & (STRIDE - 1);
      slotQ = arSlot(id0);
      arG[slotQ] = sc0[g]; arP[slotQ] = -1; arF[slotQ] = AR_SEEN;
      var h0x = T0.x[l0] - gx, h0y = T0.y[l0] - gy, h0z = T0.z[l0] - gz;
      hpush(id0, sc0[g] + HWq * Math.sqrt(h0x * h0x + h0y * h0y + h0z * h0z));
    }
    while (heapN > 0) {
      var cur = hpop();
      var T1 = W.slots[cur >> SHIFT], l1 = cur & (STRIDE - 1);
      var s1 = arSlot(cur);
      if ((arF[s1] & AR_CLOSED) !== 0) continue;
      arF[s1] |= AR_CLOSED;
      if (goals.indexOf(cur) >= 0) { best = cur; break; }
      if (++expanded > maxExpand) { W.lastFail = "limit"; break; }
      if (T1.bord[l1] !== 0 && (T1.bord[l1] & 32) === 0) ensureLinked(W, T1, l1);
      var g1 = arG[s1], e, kEdge;
      // explicit edges (everything but open ground to open ground)
      for (e = T1.edgeStart[l1]; e < T1.edgeStart[l1 + 1]; e++) {
        var l2 = T1.edgeTo[e], gidA = T1.base + l2;
        slotQ = arSlot(gidA);
        if (slotQ < 0) { full = true; break; }
        var fl = arF[slotQ];
        if ((fl & AR_CLOSED) !== 0) continue;
        if (mdq !== Infinity && T1.edgeKind[e] === EDGE_DROP && T1.y[l1] - T1.y[l2] > mdq) continue;      // (P2-E) opts.maxDrop
        var g2 = g1 + T1.edgeCost[e];
        if ((fl & AR_SEEN) !== 0 && g2 >= arG[slotQ]) continue;
        arG[slotQ] = g2; arP[slotQ] = cur; arF[slotQ] = AR_SEEN | T1.edgeKind[e];
        var qx = T1.x[l2] - gx, qy = T1.y[l2] - gy, qz = T1.z[l2] - gz;
        hpush(gidA, g2 + HWq * Math.sqrt(qx * qx + qy * qy + qz * qz));
      }
      // plain edges: the mask byte of the node, each bit a neighbour direction
      var am = T1.adj[l1];
      if (!full && am !== 0) {
        var pix = ((T1.x[l1] - T1.minX) * T1.inv) | 0, piz = ((T1.z[l1] - T1.minZ) * T1.inv) | 0, pfa = T1.flag[l1], pya = T1.y[l1];
        for (var pb = 0; pb < 8 && !full; pb++) {
          if ((am & (1 << pb)) === 0) continue;
          var pcj = (piz + NB8Z[pb]) * T1.nx + pix + NB8X[pb], pm2 = plainDest(T1, pfa, pya, pcj);
          if (pm2 < 0) continue;
          var gidP = T1.base + pm2;
          slotQ = arSlot(gidP);
          if (slotQ < 0) { full = true; break; }
          var flP = arF[slotQ];
          if ((flP & AR_CLOSED) !== 0) continue;
          var g5 = g1 + plainCost(T1, l1, pm2);
          if ((flP & AR_SEEN) !== 0 && g5 >= arG[slotQ]) continue;
          arG[slotQ] = g5; arP[slotQ] = cur; arF[slotQ] = AR_SEEN | EDGE_WALK;
          var ppx = T1.x[pm2] - gx, ppy = T1.y[pm2] - gy, ppz = T1.z[pm2] - gz;
          hpush(gidP, g5 + HWq * Math.sqrt(ppx * ppx + ppy * ppy + ppz * ppz));
        }
      }
      // implicit edges: an open cell to its open neighbours (terrain, nothing to replay; cost from the two nodes)
      if (!full && (T1.flag[l1] & F_OPEN) !== 0) {
        var cix = ((T1.x[l1] - T1.minX) * T1.inv) | 0, ciz = ((T1.z[l1] - T1.minZ) * T1.inv) | 0, fo = T1.flag[l1];
        for (var nb = 0; nb < 8 && !full; nb++) {
          var jx = cix + NB8X[nb], jz = ciz + NB8Z[nb];
          if (jx < 0 || jx >= T1.nx || jz < 0 || jz >= T1.nz) continue;
          var cj = jz * T1.nx + jx, mEnd = T1.cellStart[cj + 1];
          for (var m2 = T1.cellStart[cj]; m2 < mEnd; m2++) {
            var fm = T1.flag[m2];
            if ((fm & F_OPEN) === 0) continue;
            var gidB = T1.base + m2;
            slotQ = arSlot(gidB);
            if (slotQ < 0) { full = true; break; }
            var fl2 = arF[slotQ];
            if ((fl2 & AR_CLOSED) !== 0) continue;
            var oy = T1.y[m2] - T1.y[l1], od = nb < 4 ? T1.dOrth : T1.dDiag;
            var oc = Math.sqrt(od * od + oy * oy) * (1 + 0.4 * Math.min(1, Math.abs(oy) / od));
            if (((fo | fm) & F_WET) !== 0) oc *= WET_MULT;
            var g4 = g1 + oc;
            if ((fl2 & AR_SEEN) !== 0 && g4 >= arG[slotQ]) continue;
            arG[slotQ] = g4; arP[slotQ] = cur; arF[slotQ] = AR_SEEN | EDGE_WALK;
            var ox = T1.x[m2] - gx, oy2 = T1.y[m2] - gy, oz = T1.z[m2] - gz;
            hpush(gidB, g4 + HWq * Math.sqrt(ox * ox + oy2 * oy2 + oz * oz));
          }
        }
      }
      // links to the neighbouring tiles
      if (!full && T1.extStart !== null) {
        for (e = T1.extStart[l1]; e < T1.extStart[l1 + 1]; e++) {
          var gid2 = T1.extTo[e], T2 = W.slots[gid2 >> SHIFT], l3 = gid2 & (STRIDE - 1);
          slotQ = arSlot(gid2);
          if (slotQ < 0) { full = true; break; }
          var fl3 = arF[slotQ];
          if ((fl3 & AR_CLOSED) !== 0) continue;
          if (mdq !== Infinity && T1.extKind[e] === EDGE_DROP && T1.y[l1] - T2.y[l3] > mdq) continue;      // (P2-E) opts.maxDrop
          var g3 = g1 + T1.extCost[e];
          if ((fl3 & AR_SEEN) !== 0 && g3 >= arG[slotQ]) continue;
          arG[slotQ] = g3; arP[slotQ] = cur; arF[slotQ] = AR_SEEN | T1.extKind[e];
          var rx = T2.x[l3] - gx, ry = T2.y[l3] - gy, rz = T2.z[l3] - gz;
          hpush(gid2, g3 + HWq * Math.sqrt(rx * rx + ry * ry + rz * rz));
        }
      }
      if (full) { W.lastFail = "limit"; break; }
    }
    W.stats.expanded += expanded;
    if (best < 0) { if (!W.lastFail) W.lastFail = "no-path"; W.stats.queryMs += now() - t0; return null; }
    // reconstruct
    var chain = [], kinds = [];
    for (var id = best; id >= 0; ) {
      var sq = arSlot(id);
      chain.push(id); kinds.push(arF[sq] & 3);
      id = arP[sq];
    }
    chain.reverse(); kinds.reverse();
    var bestCost = arG[arSlot(best)];
    var n = chain.length, px = new Float64Array(n + 2), py = new Float64Array(n + 2), pz = new Float64Array(n + 2), pk = new Uint8Array(n + 2), pf = new Uint8Array(n + 2);
    px[0] = sx; py[0] = sy; pz[0] = sz; pk[0] = 0;
    var cnt = 1;
    for (g = 0; g < n; g++) {
      var Tc = W.slots[chain[g] >> SHIFT], lc = chain[g] & (STRIDE - 1);
      px[cnt] = Tc.x[lc]; py[cnt] = Tc.y[lc]; pz[cnt] = Tc.z[lc]; pk[cnt] = g === 0 ? 0 : kinds[g]; pf[cnt] = Tc.flag[lc]; cnt++;
    }
    // the exact goal, when the walk from the last node reaches it on the same floor
    var ldx = tx - px[cnt - 1], ldz = tz - pz[cnt - 1];
    if (goalVerified && ldx * ldx + ldz * ldz > 0.16) {
      var Tl = (_tf[0] = px[cnt - 1], _tf[1] = pz[cnt - 1], tileForQ(W, true));
      if (Tl !== null && (_hp[0] = px[cnt - 1], _hp[1] = py[cnt - 1], _hp[2] = pz[cnt - 1], _hp[3] = tx, _hp[4] = tz, _hp[5] = RADIUS, hopQ(W, Tl, null, -1)) && Math.abs(_hr[0] - ty) <= 0.6 && _hr[1] <= MAX_WALK_GAP) {
        px[cnt] = tx; py[cnt] = _hr[0]; pz[cnt] = tz; pk[cnt] = _hr[2] === 1 ? EDGE_RAMP : EDGE_WALK; cnt++;
      }
    }
    // string pull: the farthest node each node can walk straight to, never across a drop
    var keepIdx = [0];
    if (opts.noPull) { for (g = 1; g < cnt; g++) keepIdx.push(g); }
    else {
      var i = 0, JMAX = 48;
      while (i < cnt - 1) {
        var jmax = Math.min(cnt - 1, i + JMAX);
        // a pull never crosses a drop (the lip is a waypoint) and never crosses a floor-type boundary: the chain edges onto and off a
        // ramp were validated with a 0.4 m error at the start, a shortcut cut across that boundary has not been
        var k1 = i + 1 < cnt ? pk[i + 1] : 0;
        for (var dj = i + 1; dj <= jmax; dj++) {
          if (pk[dj] === EDGE_DROP || pk[dj] !== k1 || ((pf[i] ^ pf[dj]) & F_RAMP) !== 0) { jmax = dj - 1; break; }
        }
        var lo = i + 1;
        if (jmax > lo) {
          // gallop up while the leg stays walkable, then bisect the failing gap
          var step = 1, okJ = lo, failJ = -1;
          while (okJ < jmax) {
            var tj = Math.min(jmax, i + step * 2);
            if (tj <= okJ) break;
            if (legOk(W, px, py, pz, pf, i, tj, pad)) { okJ = tj; step *= 2; } else { failJ = tj; break; }
          }
          if (failJ > 0) {
            var a2 = okJ, b2 = failJ;
            while (b2 - a2 > 1) { var mid = (a2 + b2) >> 1; if (legOk(W, px, py, pz, pf, i, mid, pad)) a2 = mid; else b2 = mid; }
            okJ = a2;
          }
          lo = okJ;
        }
        keepIdx.push(lo);
        i = lo;
      }
    }
    var out = [];
    for (g = 1; g < keepIdx.length; g++) { var kx = keepIdx[g]; out.push({ x: px[kx], y: py[kx], z: pz[kx], k: pk[kx] }); }
    // the kind of a pulled leg is the strongest kind it swallowed (a ramp is not a walk)
    for (g = 1; g < keepIdx.length; g++) { var ka = 0; for (var kq = keepIdx[g - 1] + 1; kq <= keepIdx[g]; kq++) if (pk[kq] > ka) ka = pk[kq]; out[g - 1].k = ka; }
    out.cost = bestCost;
    out.expanded = expanded; out.nodes = n; out.partial = false;
    W.stats.queryMs += now() - t0;
    return out;
  }

  /** Can the mover walk the straight leg from waypoint i to waypoint j (padded), ending on j's floor? */
  function legOk(W, px, py, pz, pf, i, j, pad) {
    var T = (_tf[0] = px[i], _tf[1] = pz[i], tileForQ(W, true));
    if (T === null) return false;
    var dx = px[j] - px[i], dz = pz[j] - pz[i];
    if (dx * dx + dz * dz > 1600) return false;
    if (!(_hp[0] = px[i], _hp[1] = py[i], _hp[2] = pz[i], _hp[3] = px[j], _hp[4] = pz[j], _hp[5] = RADIUS + pad, hopQ(W, T, null, -1))) return false;
    if (!(_hr[1] <= MAX_WALK_GAP && Math.abs(_hr[0] - py[j]) <= FLOOR_TOL)) return false;
    if (_hr[4] > 0 && !restAgrees(W, T, px[i], py[i], pz[i], px[j], pz[j], RADIUS + pad, null, -1)) return false;     // a leg that works at speed only
    if (Math.abs(py[j] - py[i]) < 0.3 && ((pf[i] | pf[j]) & F_TERR) === 0 && _hr[3] < (py[i] < py[j] ? py[i] : py[j]) - 0.2) return false;     // a flat deck leg whose floor dips under the feet
    if (_hr[2] === 1 || Math.abs(py[j] - py[i]) > 0.3) {                      // a leg over a ramp or a climb: no margin trick, and a sideways error
      if (!sameWithoutRampMargin(W, T, px[i], py[i], pz[i], px[j], pz[j], RADIUS + pad, null, -1)) return false;
      if (!hopJ(W, T, px[i], py[i], pz[i], px[j], pz[j], RADIUS + pad, null, -1, py[j])) return false;
      return perturbOK(W, T, px[i], py[i], pz[i], px[j], py[j], pz[j], RADIUS + pad, null, -1);
    }
    return true;
  }

  /** One replay of the straight walk a -> b with every end check; mode 0 = a walker already at speed, 1 = one that starts from a standstill.
   *  Returns the floor it ends on (NaN when blocked, fell, or the floor ends right at the end); the ramp flag is left in _wsRamp. */
  var _wsRamp = false;
  function walkOnce(W, T, ax, ay, az, bx, bz, rad, mode) {
    _rest = mode;
    var ok = (_hp[0] = ax, _hp[1] = ay, _hp[2] = az, _hp[3] = bx, _hp[4] = bz, _hp[5] = rad, hopQ(W, T, null, -1));
    _rest = 0;
    if (!ok || _hr[1] > MAX_WALK_GAP) return NaN;
    var yB = _hr[0], yLow = _hr[3];
    _wsRamp = _hr[2] === 1;
    // a flat leg over a floor that dips under the feet (a stairwell corner, a gap in a deck): the replay catches the far lip on the way
    // down, a walker that starts from rest falls through. legOk and evalEdge refuse the same leg; terrain legs dip with the ground, so
    // only a leg with neither end on the terrain counts.
    var dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz);
    var Tb = L > 1e-6 ? (_tf[0] = bx, _tf[1] = bz, tileForQ(W, true)) : T;
    if (Tb === null) return NaN;
    if (Math.abs(yB - ay) < 0.3 && yLow < (ay < yB ? ay : yB) - 0.2 && Math.abs(ay - T.hf(ax, az)) > 0.05 && Math.abs(yB - Tb.hf(bx, bz)) > 0.05) return NaN;
    // a walker arrives a few centimetres past its waypoint: the floor must hold OVERSHOOT m beyond the end of the segment
    if (L > 1e-6) {
      if (!(_hp[0] = bx, _hp[1] = yB, _hp[2] = bz, _hp[3] = bx + dx / L * OVERSHOOT, _hp[4] = bz + dz / L * OVERSHOOT, _hp[5] = rad, hopQ(W, Tb, null, -1))) return NaN;
      if (_hr[1] > 0 || Math.abs(_hr[0] - yB) > 0.3) return NaN;           // the floor ends right there: the walker would step off
    }
    return yB;
  }

  /** The walker stops anywhere in the last ARRIVE m of the walk, not only where the replay's ticks happen to fall. The feet stand at height yEnd (the floor the walk
   *  ends on); at every centimetre of the stretch the support there must be that floor (within FLOOR_AGREE) and the capsule must fit. This catches the notch that
   *  two support margins leave at the corner of a stairwell hole: the ticks land inside one margin or the other, the walker's stopping point can land in neither. */
  function endStretchOK(W, bx, bz, ux, uz, yEnd, rad) {
    for (var k = 1; k <= 6; k++) {
      var px = bx - ux * 0.01 * k, pz = bz - uz * 0.01 * k;
      var T = (_tf[0] = px, _tf[1] = pz, tileForQ(W, true));
      if (T === null) return false;
      var ci = cellOf(T, px, pz), a = T.nearStart[ci], b = T.nearStart[ci + 1];
      _hq[0] = px; _hq[1] = pz; hfQ(T); var H = _hq[2];
      var sup = b > a ? supportT(T, T.nearItems, a, b, px, pz, yEnd, H) : H;
      if (!(Math.abs(sup - yEnd) <= FLOOR_AGREE)) return false;
      if (b > a && blockedT(T, T.nearItems, a, b, px, pz, yEnd > sup ? yEnd : sup, rad)) return false;
    }
    return true;
  }

  /** The mover's own answer for a straight walk: { y: the floor it ends on, ramp } or null when blocked or when the feet
   *  leave the ground by more than a metre. opts.pad = extra clearance (<= 0.3).
   *  The answer must hold for a walker at speed AND one that starts from a standstill (the mover accelerates, so over a ledge, a stair
   *  side or a steep slope the two spend different ticks in the air), and for a walker that stops anywhere in the last ARRIVE m before
   *  b (a bot is "there" a few centimetres early): the floor under the early stop must be the floor at b. Anything that holds in
   *  one case only is a hairline the real mover does not reproduce, and the grid errs toward blocked. */
  function walkSegment(W, ax, ay, az, bx, bz, opts) {
    var pad = opts && opts.pad ? Math.max(-0.1, Math.min(PAD_MAX, opts.pad)) : 0;     // a negative pad is for tests: a thinner capsule
    var T = (_tf[0] = ax, _tf[1] = az, tileForQ(W, true));
    if (T === null) return null;
    var rad = RADIUS + pad;
    var y0 = walkOnce(W, T, ax, ay, az, bx, bz, rad, 0);
    if (y0 !== y0) return null;
    var ramp0 = _wsRamp;
    var y1 = walkOnce(W, T, ax, ay, az, bx, bz, rad, 1);
    if (y1 !== y1 || Math.abs(y1 - y0) > FLOOR_AGREE) return null;
    var dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz);
    if (L > ARRIVE + 0.02) {
      if (!endStretchOK(W, bx, bz, dx / L, dz / L, y1, rad)) return null;
      var ex = bx - dx / L * ARRIVE, ez = bz - dz / L * ARRIVE;
      for (var m = 0; m < 2; m++) {
        _rest = m;
        var okE = (_hp[0] = ax, _hp[1] = ay, _hp[2] = az, _hp[3] = ex, _hp[4] = ez, _hp[5] = rad, hopQ(W, T, null, -1));
        _rest = 0;
        if (!okE || _hr[1] > MAX_WALK_GAP || Math.abs(_hr[0] - (m === 0 ? y0 : y1)) > FLOOR_AGREE) return null;
      }
    }
    return { y: y1, ramp: ramp0 };
  }

  /** Bake the tiles that cover the circle (x, z, r) or the rect {minX, minZ, maxX, maxZ}, in a fixed order, until `maxMs` of wall time is
   *  spent (a tile is atomic: the budget is checked between tiles). Returns { baked, remaining }; call again next frame while remaining > 0. */
  /** The tiles of an area (a circle {x, z, r} or a rect) that are not baked yet, as jobs sorted by tile key: { kind: 0, tx, tz, key } (an outdoor
   *  tile) or { kind: 1, rect, key } (a building). Only the tiles the cover reaches. */
  function collectJobs(W, area) {
    var rect = area.r != null ? { minX: area.x - area.r, maxX: area.x + area.r, minZ: area.z - area.r, maxZ: area.z + area.r } : area;
    var size = W.tileSize, jobs = [], tx, tz, i;
    var tx0 = Math.floor(rect.minX / size), tx1 = Math.floor(rect.maxX / size), tz0 = Math.floor(rect.minZ / size), tz1 = Math.floor(rect.maxZ / size);
    for (tx = tx0; tx <= tx1; tx++) for (tz = tz0; tz <= tz1; tz++) {
      var key = coarseKey(tx, tz);
      if (area.r != null) {
        var cx = Math.min(Math.max(area.x, tx * size), (tx + 1) * size), cz = Math.min(Math.max(area.z, tz * size), (tz + 1) * size);
        if ((area.x - cx) * (area.x - cx) + (area.z - cz) * (area.z - cz) > area.r * area.r) continue;
      }
      if (!W.coarse.has(key) && W.cover(tx, tz)) jobs.push({ kind: 0, tx: tx, tz: tz, key: key, rect: null });
      var fl = W.fineByCoarse.get(key);
      if (fl !== undefined) for (i = 0; i < fl.length; i++) if (fl[i].tile === null && jobs.every(function (j) { return j.rect !== fl[i]; })) jobs.push({ kind: 1, rect: fl[i], key: 100000000 + fl[i].idx, tx: 0, tz: 0 });
    }
    jobs.sort(function (a, b) { return a.key - b.key; });
    return jobs;
  }
  /** Bake ONE job (collectJobs / W.wanted) and stitch the new tile to the baked tiles round it; when it was the last chunk of a building,
   *  settle the building. Returns the tile (null when it was already baked, or the slot space is full). The only way a lazy world grows. */
  function runJob(W, j) {
    var tj = null;
    if (j.kind === 0) { if (!W.coarse.has(j.key)) tj = bakeCoarse(W, j.tx, j.tz); }
    else if (j.rect.tile === null) tj = bakeFine(W, j.rect);
    if (tj !== null) linkTile(W, tj);
    var g = j.kind === 1 ? j.rect.grp : null;
    if (g && !g.done && g.rects.every(function (q) { return q.tile !== null; })) resolveGroup(W, g);
    return tj;
  }
  /** Take the tiles a lazy world was asked for since the last call (first-asked order), oldest first. */
  function takeWanted(W) {
    var out = [];
    for (var i = 0; i < W.wanted.length; i++) {
      var j = W.wanted[i];
      if (j.kind === 0 ? !W.coarse.has(j.key) : j.rect.tile === null) out.push(j);
    }
    W.wanted.length = 0;
    if (W.pb !== null && W.pb !== undefined && W.pb.on && out.length) pbFront(W.pb, out);      // (P2-E) the workers take what a bot is waiting for next
    return out;
  }
  function prewarm(W, area, maxMs) {
    var t0 = now(), baked = 0, remaining = 0, i;
    var jobs = collectJobs(W, area);
    // stitching a tile can bake a neighbour as a side effect (a replayed hop into a tile nobody has baked): count what is really baked
    var slots0 = W.slots.length;
    var pending = function (jb) { return jb.kind === 0 ? !W.coarse.has(jb.key) : jb.rect.tile === null; };
    for (i = 0; i < jobs.length; i++) {
      if (!pending(jobs[i])) continue;
      if (W.slots.length > slots0 && now() - t0 >= maxMs) { for (var q = i; q < jobs.length; q++) if (pending(jobs[q])) remaining++; break; }
      var j = jobs[i];
      var tj = j.kind === 0 ? bakeCoarse(W, j.tx, j.tz) : bakeFine(W, j.rect);
      if (tj !== null) linkTile(W, tj);                       // a prewarmed tile is also stitched: the first query pays nothing
    }
    baked = W.slots.length - slots0;
    for (i = 0; i < W.groups.length; i++) {
      var gp2 = W.groups[i];
      if (!gp2.done && gp2.rects.every(function (q) { return q.tile !== null; })) resolveGroup(W, gp2);   // a fully baked building: settle its islands now (a flood, no bake)
    }
    return { baked: baked, remaining: remaining };
  }

  /** (Wave 8, lane I2) The tall furniture of a map built with furnished houses (maps.js map.houses: housegen records, each with cols = [first collider,
   *  structure colliders, all colliders] into map.colliders - collidersOf's order: structure boxes, ramps, then the furniture): the furniture boxes whose top
   *  stands more than a step (0.55 m) over the storey floor they stand on. Pass the Set as opts.noFloor to bakeTown / createWorld / bakeTile (collider kind 3,
   *  see TALL_LIFT). null when the map has no houses (every older build): the world is then exactly what it was. */
  function tallFurniture(map, minRise) {
    var rise = minRise != null ? +minRise : STEP_UP;
    var HS = map && map.houses, cols = map && map.colliders;
    if (!HS || !HS.length || !cols) return null;
    var set = new Set();
    for (var h = 0; h < HS.length; h++) {
      var H = HS[h];
      if (!H || !H.cols || H.cols.length < 3 || !H.floors) continue;
      var c0 = H.cols[0], end = c0 + H.cols[2];
      for (var i = c0 + H.cols[1]; i < end; i++) {
        var c = cols[i];
        if (!c || c.kind === "ramp") continue;
        var fy = -Infinity;
        for (var f = 0; f < H.floors.length; f++) { var Fy = H.floors[f].y; if (Fy <= c.minY + 0.05 && Fy > fy) fy = Fy; }
        if (fy === -Infinity) fy = H.y0 != null ? H.y0 : c.minY;
        if (c.maxY > fy + rise) set.add(c);
      }
    }
    return set.size ? set : null;
  }

  // ── towns ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** A rect from any of the shapes a caller holds: {minX, maxX, minZ, maxZ}, [x0, z0, x1, z1], a disc {x, z, r}, or a towngen layout (rectOfLayout). */
  function normRect(r, margin) {
    var m = margin || 0, o;
    if (Array.isArray(r)) o = { minX: r[0], minZ: r[1], maxX: r[2], maxZ: r[3] };
    else if (r.minX != null) o = { minX: r.minX, minZ: r.minZ, maxX: r.maxX, maxZ: r.maxZ };
    else if (r.r != null && r.x != null && !r.blocks && !r.parcels) o = { minX: r.x - r.r, minZ: r.z - r.r, maxX: r.x + r.r, maxZ: r.z + r.r };
    else o = rectOfLayout(r, 0);
    return { minX: o.minX - m, minZ: o.minZ - m, maxX: o.maxX + m, maxZ: o.maxZ + m };
  }
  /** The ground a towngen layout (C-LAYOUT) covers: its blocks, the buildings of its parcels, a compound's yard / bounds, grown by margin m
   *  (default 10: the roads around the outer blocks). A layout with none of those falls back to its poi disc. */
  function rectOfLayout(L, margin) {
    var x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, i;
    function add(a, b, c, d) { if (a < x0) x0 = a; if (b < z0) z0 = b; if (c > x1) x1 = c; if (d > z1) z1 = d; }
    if (L.blocks) for (i = 0; i < L.blocks.length; i++) add(L.blocks[i].x0, L.blocks[i].z0, L.blocks[i].x1, L.blocks[i].z1);
    if (L.parcels) for (i = 0; i < L.parcels.length; i++) { var bd = L.parcels[i].building; if (bd && bd.aabb) add(bd.aabb[0], bd.aabb[1], bd.aabb[2], bd.aabb[3]); }
    var cp = L.compound;
    if (cp) {
      if (cp.bounds) add(cp.bounds[0], cp.bounds[1], cp.bounds[2], cp.bounds[3]);
      if (cp.yard) add(cp.yard[0], cp.yard[1], cp.yard[2], cp.yard[3]);
    }
    if (x0 === Infinity && L.poi) add(L.poi.x - L.poi.r, L.poi.z - L.poi.r, L.poi.x + L.poi.r, L.poi.z + L.poi.r);
    var m = margin != null ? margin : 10;
    return { minX: x0 - m, minZ: z0 - m, maxX: x1 + m, maxZ: z1 + m };
  }
  function addCoverRects(W, rects, margin) {
    var m = margin != null ? margin : 6;
    for (var i = 0; i < rects.length; i++) W.zoneRects.push(normRect(rects[i], m));
  }

  /**
   * navgrid.bakeTown(colliders, heightFn, rects, opts) -> town   (contract C-NAV: how stage B composes bakeTile over a layout)
   *   rects  the town / compound footprints: towngen layouts (layoutMap().towns[i], .compounds[i]), {minX, maxX, minZ, maxZ}, [x0, z0, x1, z1] or discs {x, z, r}
   *   opts   { waterY, portals, cellOutdoor (1.5), cellIndoor (0.75), tileSize (32), margin (6 m of street round each rect), maxMs (the budget of ONE
   *            step; default no limit), world (add these rects to an existing world instead of creating one) }
   * It makes (or extends) a world that bakes ONLY the coarse tiles touching the rects, bakes and stitches every tile of the rects (the open ground as
   * 32 m coarse tiles, every building as 0.75 m fine tiles) and settles the buildings that were cut into chunks. It returns
   *   { world, rects, done, remaining, baked, ms, step(maxMs), stats() }
   * town.step(maxMs) continues a bake that ran out of budget (a frame at a time: a tile is atomic); findPath(town.world, ...) works at any moment,
   * tiles missing from a budgeted bake are baked by the first query that needs them (lazy and synchronous, as always).
   */
  function bakeTown(colliders, heightFn, rects, opts) {
    opts = opts || {};
    var t0 = now(), margin = opts.margin != null ? opts.margin : 6, W = opts.world || null, i;
    if (W === null) {
      W = createWorld({ colliders: colliders, heightFn: heightFn, waterY: opts.waterY, portals: opts.portals, tileSize: opts.tileSize, cellOutdoor: opts.cellOutdoor,
        cellIndoor: opts.cellIndoor, maxFine: opts.maxFine, fineRects: opts.fineRects, rects: rects, margin: margin, lazy: opts.lazy, noFloor: opts.noFloor });
    } else addCoverRects(W, rects, margin);
    var areas = [];
    for (i = 0; i < rects.length; i++) areas.push(normRect(rects[i], margin));
    var town = { world: W, rects: areas, done: false, remaining: 0, baked: 0, ms: 0 };
    town.step = function (maxMs) {
      var ts = now(), budget = maxMs == null ? Infinity : maxMs, rem = 0, baked = 0;
      for (var q = 0; q < areas.length; q++) {
        var left = budget - (now() - ts);
        if (left <= 0 && q > 0) { rem += 1; continue; }
        var pr = prewarm(W, areas[q], left > 0 ? left : 0);
        baked += pr.baked; rem += pr.remaining;
      }
      town.baked += baked; town.remaining = rem; town.done = rem === 0; town.ms += now() - ts;
      return { baked: baked, remaining: rem };
    };
    town.stats = function () { return worldStats(W); };
    town.step(opts.maxMs);
    town.ms = now() - t0;
    return town;
  }

  /** Every edge out of node n of tile T as [{ to (global node id), cost, kind, via }]: the stored ones (via "csr"), the implicit open-ground ones ("open") and the
   *  links to the neighbouring tiles ("link"). For inspection and tests; the search reads the same three sources inline. */
  function edgesOf(W, T, n) {
    var out = [], e, nb;
    if (T.edgeTo) for (e = T.edgeStart[n]; e < T.edgeStart[n + 1]; e++) out.push({ to: T.base + T.edgeTo[e], cost: T.edgeCost[e], kind: T.edgeKind[e], via: "csr" });
    if (T.adj[n] !== 0) {
      var qix = ((T.x[n] - T.minX) * T.inv) | 0, qiz = ((T.z[n] - T.minZ) * T.inv) | 0;
      for (nb = 0; nb < 8; nb++) {
        if ((T.adj[n] & (1 << nb)) === 0) continue;
        var pdm = plainDest(T, T.flag[n], T.y[n], (qiz + NB8Z[nb]) * T.nx + qix + NB8X[nb]);
        if (pdm >= 0) out.push({ to: T.base + pdm, cost: plainCost(T, n, pdm), kind: EDGE_WALK, via: "plain" });
      }
    }
    if ((T.flag[n] & F_OPEN) !== 0) {
      var cix = ((T.x[n] - T.minX) * T.inv) | 0, ciz = ((T.z[n] - T.minZ) * T.inv) | 0;
      for (nb = 0; nb < 8; nb++) {
        var jx = cix + NB8X[nb], jz = ciz + NB8Z[nb];
        if (jx < 0 || jx >= T.nx || jz < 0 || jz >= T.nz) continue;
        var cj = jz * T.nx + jx;
        for (var m2 = T.cellStart[cj]; m2 < T.cellStart[cj + 1]; m2++) {
          if ((T.flag[m2] & F_OPEN) === 0) continue;
          var oy = T.y[m2] - T.y[n], od = nb < 4 ? T.dOrth : T.dDiag, oc = Math.sqrt(od * od + oy * oy) * (1 + 0.4 * Math.min(1, Math.abs(oy) / od));
          if (((T.flag[n] | T.flag[m2]) & F_WET) !== 0) oc *= WET_MULT;
          out.push({ to: T.base + m2, cost: oc, kind: EDGE_WALK, via: "open" });
        }
      }
    }
    if (T.extStart) for (e = T.extStart[n]; e < T.extStart[n + 1]; e++) out.push({ to: T.extTo[e], cost: T.extCost[e], kind: T.extKind[e], via: "link" });
    return out;
  }

  /** Every baked tile, in slot order (the harness reads their typed arrays). */
  function tiles(W) { return W.slots.slice(); }

  /** A fingerprint of everything baked, ordered by tile key (independent of the order the tiles were baked in). */
  function worldHash(W) {
    var l = W.slots.slice().sort(function (p, q) { return p.key - q.key; }), s = "";
    for (var i = 0; i < l.length; i++) s += l[i].key + ":" + l[i].hash + ";";
    var h = 0x811c9dc5 | 0;
    for (var c = 0; c < s.length; c++) { h ^= s.charCodeAt(c); h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }

  /** the implicit open-ground edges of one tile (ordered pairs of open nodes in neighbouring cells) */
  function openEdgeCount(T) {
    var c = 0;
    for (var n = 0; n < T.n; n++) {
      if ((T.flag[n] & F_OPEN) === 0) continue;
      var cix = ((T.x[n] - T.minX) * T.inv) | 0, ciz = ((T.z[n] - T.minZ) * T.inv) | 0;
      for (var nb = 0; nb < 8; nb++) {
        var jx = cix + NB8X[nb], jz = ciz + NB8Z[nb];
        if (jx < 0 || jx >= T.nx || jz < 0 || jz >= T.nz) continue;
        var cj = jz * T.nx + jx;
        for (var m2 = T.cellStart[cj]; m2 < T.cellStart[cj + 1]; m2++) if ((T.flag[m2] & F_OPEN) !== 0) c++;
      }
    }
    return c;
  }

  /** Totals over the baked tiles. */
  function worldStats(W) {
    var o = { tiles: W.slots.length, nodes: 0, edges: 0, openEdges: 0, plainEdges: 0, walk: 0, drop: 0, ramp: 0, ext: 0, bytes: 0, arenaBytes: arK === null ? 0 : arK.byteLength + arG.byteLength + arP.byteLength + arF.byteLength, pruned: 0, bakeMs: W.stats.bakeMs, linkMs: W.stats.linkMs };
    for (var i = 0; i < W.slots.length; i++) {
      var T = W.slots[i];
      // edges = the stored CSR edges; openEdges = the implicit open-ground ones (8 neighbours per open node, derived by the search, never stored)
      o.nodes += T.n; o.edges += T.edgeTo.length; o.walk += T.stats.walk; o.drop += T.stats.drop; o.ramp += T.stats.ramp; o.pruned += T.stats.pruned;
      o.ext += T.extTo ? T.extTo.length : 0; o.bytes += tileBytes(T);
      o.openEdges += openEdgeCount(T); o.plainEdges += T.stats.plain;
    }
    return o;
  }

  /** The height (m) of a free fall that lands at vertical speed v (m/s): h = v^2 / (2 g), g = |GRAVITY| (22 m/s^2, the sim's MOVE.gravity, the value player.js
   *  integrates). C-FALL states its safe landing as a SPEED (K.FALL_SAFE_V, 13.3 m/s here); findPath's opts.maxDrop wants the HEIGHT: dropHeight(K.FALL_SAFE_V)
   *  = 4.0 m = K.FALL_SAFE_H. 0 for v <= 0. */
  function dropHeight(v) { v = +v; return v > 0 ? v * v / (2 * Math.abs(GRAVITY)) : 0; }

  // ── FEEDBACK PRIMING (final/nav) ─────────────────────────────────────────────────────────────────────────────────────
  // V8 compiles the replay (hopQ and the functions it calls) from the type feedback the calls so far left behind. A branch no call has taken yet (deep
  // water under the line, a jump over open ground from a standstill, a ramp side, a drop) has none, so the optimized code exits at it: the FIRST bot whose
  // route takes such a branch, mid-match, throws the code away, and until V8 has compiled it again the replay runs in a tier that boxes every double
  // (~465 B a 10 cm step, Node probe; Chrome's log of a Deepwood framecheck: hopQ out of TurboFan for ~3 s of the first match seconds). The module
  // therefore walks every branch once, before the first world is made (createWorld), on a 32 m world of its own (terrain dipping under a water line,
  // a roofed hut, a ramp of each direction, tall furniture, a portal): bake, stitch, settle, search, walk, straight replays (~85 ms on this box's
  // desktop Chrome; skipped in a prebake worker and on a touch device). Nothing of it stays: its world is dropped and the work counter and the replay
  // scratch are put back, so no tile, edge, route or work count of any later world can differ (the selftest's hashes and routes, the world hashes).
  function primeReplay() {
    if (root.__ngPrebake === 1) return;                                                  // a prebake worker only bakes: its replays cost nothing on the main thread
    if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0) return;     // phones: as they were (load time untouched)
    if (root.__ngNoPrime === 1) return;                                                // the selftest's control: a module that never primes
    var t0 = now(), c0 = _cnt[0], c1 = _cnt[1], c2 = _cnt[2], c3 = _cnt[3], sv = saveScratch().slice(), sb = _sbBlk;
    var N = 33, size = 128, L = new Float32Array(N * N), i, j;      // a 4 m lattice; the world below is ONE 32 m tile (0..32 m) with buildings in it
    for (j = 0; j < N; j++) for (i = 0; i < N; i++) { var lx = i * 4 - 64, lz = j * 4 - 64; L[j * N + i] = 0.12 * (lx - 10) + 0.3 * Math.sin(lz * 0.33) - (lx < 4 ? 1.5 : 0); }
    var C = N - 1, kk = C / size, hh = size / 2;
    var hf = function (x, z) {
      var fx = (x + hh) * kk, fz = (z + hh) * kk;
      fx = fx < 0 ? 0 : fx > C ? C : fx; fz = fz < 0 ? 0 : fz > C ? C : fz;
      var ix = fx | 0, iz = fz | 0; if (ix >= C) ix = C - 1; if (iz >= C) iz = C - 1;
      var u = fx - ix, v = fz - iz, q = iz * N + ix;
      if (u + v <= 1) return L[q] + u * (L[q + 1] - L[q]) + v * (L[q + N] - L[q]);
      var h11 = L[q + N + 1]; return h11 + (1 - u) * (L[q + N] - h11) + (1 - v) * (L[q + 1] - h11);
    };
    hf.ground = { lattice: L, latN: N }; hf.size = size;
    var cols = [];
    var box = function (x0, z0, x1, z1, y0, y1) { var c = { kind: "box", minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: y0, maxY: y1, dir: 0 }; cols.push(c); return c; };
    var bx = 18.25, bz = 3.75, g = hf(bx + 3, bz + 3);
    box(bx, bz, bx + 6.5, bz + 0.2, g - 0.6, g + 3.1); box(bx, bz + 5.3, bx + 6.5, bz + 5.5, g - 0.6, g + 3.1);         // a hut: walls, a door, a roof
    box(bx, bz, bx + 0.2, bz + 5.5, g - 0.6, g + 3.1); box(bx + 6.3, bz, bx + 6.5, bz + 2.0, g - 0.6, g + 3.1); box(bx + 6.3, bz + 3.2, bx + 6.5, bz + 5.5, g - 0.6, g + 3.1);
    box(bx - 0.3, bz - 0.3, bx + 6.8, bz + 5.8, g + 3.1, g + 3.35);
    var tall = box(bx + 1.0, bz + 1.0, bx + 2.2, bz + 1.8, g, g + 0.85);                                              // tall furniture, a low crate
    box(bx + 3.5, bz + 3.0, bx + 4.3, bz + 3.6, g, g + 0.45);
    for (i = 0; i < 4; i++) {                                                                                         // a ramp of each direction up to a deck
      var rx = 14.5 + i * 4.2, rz = 21.0 + (i & 1) * 2.0, rg = hf(rx, rz), lo = i < 2;
      cols.push({ kind: "ramp", minX: rx, maxX: rx + (lo ? 3.0 : 1.3), minZ: rz, maxZ: rz + (lo ? 1.3 : 3.0), minY: rg - 0.2, maxY: rg + 1.4, dir: i });
      if (i === 0) box(rx + 3.0, rz - 0.4, rx + 4.0, rz + 1.7, rg + 1.1, rg + 1.4); else if (i === 1) box(rx - 1.0, rz - 0.4, rx, rz + 1.7, rg + 1.1, rg + 1.4);
      else if (i === 2) box(rx - 0.4, rz + 3.0, rx + 1.7, rz + 4.0, rg + 1.1, rg + 1.4); else box(rx - 0.4, rz - 1.0, rx + 1.7, rz, rg + 1.1, rg + 1.4);
    }
    for (i = 0; i < 8; i++) { var px = 0.8 + i * 1.6, pz = 13.0 + (i & 1) * 1.9, pg = hf(px, pz); box(px, pz, px + 0.6, pz + 0.6, pg - 0.3, pg + 0.2 + i * 0.3); }   // posts and steps, deep water to dry
    var nf = new Set(); nf.add(tall);
    var area = { minX: 0.5, minZ: 0.5, maxX: 31.5, maxZ: 31.5 };
    var pts = [[2.0, 10.0], [21.5, 6.5], [8.0, 15.5], [26.5, 12.0], [15.0, 27.5], [29.0, 29.0], [12.0, 2.0], [5.0, 26.0], [17.0, 21.6], [24.0, 18.5]];
    var run = function (W) {
      var k, a, b, ya, yb;
      for (k = 0; k < pts.length; k++) {
        a = pts[k]; b = pts[(k + 3) % pts.length]; ya = hf(a[0], a[1]); yb = hf(b[0], b[1]);
        findPath(W, a[0], ya, a[1], b[0], yb, b[1], { hw: 1.6, maxExpand: 4000 });
        findPath(W, a[0], ya, a[1], b[0], null, b[1], { hw: 1.6, maxExpand: 4000, noPull: true, maxDrop: 1.5 });
        walkSegment(W, a[0], ya, a[1], a[0] + 3.3, a[1] - 2.1);
        walkSegment(W, a[0], ya, a[1], b[0], b[1], { pad: 0.1 });
      }
      findPath(W, bx + 0.1, g, bz + 2.5, 26.5, null, 12.0);                                                           // starts inside a wall
      findPath(W, 26.5, hf(26.5, 12.0), 12.0, 1.0, null, 20.0);                                                        // a goal under deep water
    };
    try {
      var W = createWorld({ colliders: cols, heightFn: hf, waterY: -1.0, portals: [{ x: 28.0, y: hf(28.0, 14.0), z: 14.0 }], noFloor: nf, lazy: true, prebake: false, cover: function () { return true; } });
      var js = collectJobs(W, area), jb, guard = 0;
      for (i = 0; i < js.length; i++) { jb = beginJob(W, js[i]); while (!stepJob(W, jb) && guard++ < 100000) { /* slices */ } }
      run(W); js = takeWanted(W); for (i = 0; i < js.length; i++) runJob(W, js[i]);
      // straight replays through the posts (deep water to dry), the hut's door and a ramp: on foot and falling, at speed and from rest, loose and strict
      var lines = [[0.2, 13.3, 13.5, 13.3], [13.5, 15.2, 0.2, 15.2], [0.4, 14.0, 13.0, 16.0], [bx - 2.0, bz + 2.6, bx + 8.0, bz + 2.6], [14.0, 21.6, 30.5, 21.6], [16.0, 19.5, 16.0, 30.0], [24.9, 30.0, 24.9, 19.0]];
      for (var li = 0; li < lines.length; li++) for (var md = 0; md < 8; md++) {
        var l0 = lines[li], T0 = tileFor(W, l0[0], l0[1], false);
        if (T0 === null) continue;
        _rest = md & 1; _strictRamp = (md >> 1) & 1;
        _hp[0] = l0[0]; _hp[1] = hf(l0[0], l0[1]) + ((md & 4) ? 1.3 : 0); _hp[2] = l0[1]; _hp[3] = l0[2]; _hp[4] = l0[3]; _hp[5] = RADIUS;
        hopQ(W, T0, null, -1);
      }
      _rest = 0; _strictRamp = 0;
    } catch (e) { /* priming is an optimization only: whatever it hit, the module works as before */ }
    _cnt[0] = c0; _cnt[1] = c1; _cnt[2] = c2; _cnt[3] = c3;      // the work clock (sim state: bots.js budgets its bake schedule by it) as it was
    loadScratch(sv); _sbBlk = sb;                               // the replay's result and flags as they were (the inputs are written before every use)
    _primeMs = now() - t0;
  }
  var _primeMs = -1;            // -1 = not primed yet (createWorld primes once, before its first world); else the priming's wall time in ms

  var api = {
    bakeTile: bakeTile, createWorld: createWorld, findPath: findPath, walkSegment: walkSegment, tileFor: tileFor, prewarm: prewarm,
    VERSION: VERSION, bakeTown: bakeTown, rectOfLayout: rectOfLayout, edgesOf: edgesOf, linkTile: linkTile,
    makeColSet: makeColSet, findBuildingRects: findBuildingRects, tiles: tiles, worldHash: worldHash, worldStats: worldStats, tileHash: tileHash,
    collectJobs: collectJobs, runJob: runJob, tallFurniture: tallFurniture, TALL_LIFT: TALL_LIFT, takeWanted: takeWanted, beginJob: beginJob, stepJob: stepJob, work: function () { return _cnt[1]; },
    tilesAround: tilesAround, snapNodes: function (W, x, y, z, maxDy, R) { var n = snapNodes(W, x, y, z, maxDy, R), o = []; for (var i = 0; i < n; i++) o.push(snapGid[i]); return o; },
    // the mover model, exposed for the selftest and the harness (pure given a tile)
    // (Wave 7 round 2) the one-pass forms the bake uses, exposed so the selftest can hold them to the two-call reference (supportT + blockedT, four blockedT)
    supBlock: function (T, items, a, b, x, z, yq, H, rad) { var sup = supBlock(T, items, a, b, x, z, yq, H, rad); return { sup: sup, blocked: _sbBlk === 1, ramp: _supRamp, margin: _marginUse }; },
    clearTier: clearTier, supRampState: function () { return { ramp: _supRamp, margin: _marginUse }; }, resetMover: function (ramp, margin, strict) { _supRamp = ramp; _marginUse = margin; _strictRamp = strict ? 1 : 0; },
    rampBlocksT: rampBlocksT, supportT: supportT, blockedT: blockedT, hop: function (W, T0, ax, ay, az, bx, bz, rad, strict) {
      _strictRamp = strict ? 1 : 0;
      var ok = (_hp[0] = ax, _hp[1] = ay, _hp[2] = az, _hp[3] = bx, _hp[4] = bz, _hp[5] = rad, hopQ(W, T0, null, -1));
      _strictRamp = 0;
      return ok ? { y: _hr[0], gap: _hr[1], ramp: _hr[2] === 1, yMin: _hr[3] } : null;
    },
    primeMs: function () { return _primeMs; },      // (final/nav) the feedback priming's wall time (ms; 0 = skipped: a worker or a touch device; -1 = no world made yet)
    counters: function () { return { hops: _cnt[0], steps: _cnt[1] }; }, resetCounters: function () { _cnt[0] = 0; _cnt[1] = 0; },
    // (P23 fix round) the drop height a landing speed stands for, at this grid's gravity (= sim MOVE.gravity): findPath's opts.maxDrop is a HEIGHT
    dropHeight: dropHeight,
    // (P2-E, LC-88) the prebake: workers bake a lazy world's tiles ahead (see PREBAKE); the sim is the same with or without them
    prebakeStats: prebakeStats, prebakeHint: prebakeHint, prebakeStop: pbStop, prebakeInline: prebakeInline,
    EDGE_WALK: EDGE_WALK, EDGE_DROP: EDGE_DROP, EDGE_RAMP: EDGE_RAMP,
    ACCEL_T: ACCEL_T, HOP_SPEED: HOP_SPEED, ARRIVE: ARRIVE, STEP_UP: STEP_UP, STEP_G: STEP_G, RADIUS: RADIUS, HEIGHT: HEIGHT, HEIGHT_G: HEIGHT_G, SUP_MARGIN: SUP_MARGIN, GRAVITY: GRAVITY, TICK: TICK, RAMP_THICK: RAMP_THICK,
    DROP_MAX: DROP_MAX, STRIDE: STRIDE, FLOOR_TOL: FLOOR_TOL, LINK_BAND: LINK_BAND, F_OPEN: F_OPEN, F_WET: F_WET, F_RAMP: F_RAMP, F_TERR: F_TERR, F_PROV: F_PROV,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.NavGrid = api;
  // (P2-E) loaded as a prebake worker (pbStart's Blob: this very source after "self.__ngPrebake = 1"): serve bake jobs
  if (root && root.__ngPrebake === 1 && typeof root.postMessage === "function" && typeof root.document === "undefined") pbWorkerMain(root);
})(typeof window !== "undefined" ? window : globalThis);
