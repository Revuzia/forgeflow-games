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
 *   NavGrid.findPath(world, sx, sy, sz, tx, ty, tz [, { pad, maxExpand, noPull }])          -> [{ x, y, z, k }, ...] | null
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
(function (root) {
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
  function makeColSet(list, blockers) {
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
      cs.minZ[j] = c.minZ; cs.maxZ[j] = c.maxZ; cs.kind[j] = c.kind === "ramp" ? 1 : 0; cs.dir[j] = c.dir | 0;
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
    var dir = T.ld[i], f;
    if (dir === 0) f = (x - T.lx0[i]) / Math.max(0.01, T.lx1[i] - T.lx0[i]);
    else if (dir === 1) f = (T.lx1[i] - x) / Math.max(0.01, T.lx1[i] - T.lx0[i]);
    else if (dir === 2) f = (z - T.lz0[i]) / Math.max(0.01, T.lz1[i] - T.lz0[i]);
    else f = (T.lz1[i] - z) / Math.max(0.01, T.lz1[i] - T.lz0[i]);
    return T.ly0[i] + (T.ly1[i] - T.ly0[i]) * (f < 0 ? 0 : f > 1 ? 1 : f);
  }

  /** player.js supportIn: the highest walkable top at or below y + STEP_G (terrain always counts). H = the terrain height at (x, z). */
  function supportT(T, items, a, b, x, z, y, H) {
    var s = H;
    for (var k = a; k < b; k++) {
      var i = items[k], kd = T.lk[i];
      if (kd === 2) continue;                           // a blocker is never a floor
      // strict mode (graph edges): a ramp holds a walker up only inside its footprint. The real mover also holds one up for 0.3 m
      // past it, which lets a walker be lifted onto a ramp from its SIDE; that works at exact positions only, so edges never rely on it.
      var m = (kd === 1 && _strictRamp === 1) ? 0 : SUP_MARGIN;
      if (x < T.lx0[i] - m || x > T.lx1[i] + m || z < T.lz0[i] - m || z > T.lz1[i] + m) continue;
      var isRamp = kd === 1;
      var top = isRamp ? rampTopT(T, i, x, z) : T.ly1[i];
      // equal tops (a stair that ends flush with its landing) are won by the RAMP, never by whichever collider happens to come first: the order of the colliders
      // must not decide whether a walk "used a ramp" (the edge kind, the strict and the margin replays)
      if (top <= y + STEP_G && (top > s + 1e-7 || (isRamp && _supRamp === 0 && top > s - 1e-7))) {
        s = top > s ? top : s; _supRamp = isRamp ? 1 : 0;
        if (isRamp && (x < T.lx0[i] || x > T.lx1[i] || z < T.lz0[i] || z > T.lz1[i])) _marginUse = 1;
      }
    }
    return s;
  }

  /** sim rampBlocks (C-RAMP), over a tile's local arrays. */
  function rampBlocksT(T, i, x, z, yd, rad) {
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
    var r2 = rad * rad;
    for (var k = a; k < b; k++) {
      var i = items[k];
      if (T.lk[i] === 1) { if (rampBlocksT(T, i, x, z, yd, rad)) return true; continue; }
      if (T.ly1[i] <= yd + STEP_G || T.ly0[i] >= yd + HEIGHT_G) continue;
      var x0 = T.lx0[i], x1 = T.lx1[i], z0 = T.lz0[i], z1 = T.lz1[i];
      var ex = x - (x < x0 ? x0 : x > x1 ? x1 : x), ez = z - (z < z0 ? z0 : z > z1 ? z1 : z);
      if (ex * ex + ez * ez < r2) return true;
    }
    return false;
  }

  function cellOf(T, x, z) {
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
  function hop(W, T0, ax, ay, az, bx, bz, rad, fItems, fN) {
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
    for (var s = 1; s <= n; s++) {
      var f = rest ? (s >= n ? 1 : restDist(s) / L) : s / n, px = ax + dx * f, pz = az + dz * f;
      // X move (the destination floor decides the band, player.js blockedIn)
      if (!fixed) {
        if (px < T.minX || px >= T.maxX || z < T.minZ || z >= T.maxZ) { T = W ? tileFor(W, px, z, true) : null; if (T === null) return false; }
        ci = cellOf(T, px, z); a = T.nearStart[ci]; b = T.nearStart[ci + 1]; items = T.nearItems;
      }
      if (b > a) {
        if (gT) { y = T.hf(x, z); gT = false; vy = 0; air = false; }
        yq = air ? y - AIR_PAD : y;
        sup = supportT(T, items, a, b, px, z, yq, T.hf(px, z)); yd = yq > sup ? yq : sup;
        if (blockedT(T, items, a, b, px, z, yd, rad)) return false;
      }
      x = px;
      // Z move
      if (!fixed) {
        if (x < T.minX || x >= T.maxX || pz < T.minZ || pz >= T.maxZ) { T = W ? tileFor(W, x, pz, true) : null; if (T === null) return false; }
        ci = cellOf(T, x, pz); a = T.nearStart[ci]; b = T.nearStart[ci + 1]; items = T.nearItems;
      }
      if (b === a && !fixed) {
        // OPEN cell: nothing within reach of the capsule, so nothing blocks, nothing lifts, the floor is the terrain. Over GENTLE ground the feet ride it
        // (glued: the mover lands every tick), and then the replay jumps to the last step inside this cell (the terrain is read again where the line leaves
        // open ground). Over ground that drops faster than the mover can follow (more than GLUE_DROP a tick: a 0.26 slope at full speed, any slope once the
        // mover has speed) the feet LEAVE it and fall, and arrive at the next feature higher than the terrain and with a downward speed: simulated tick by tick.
        var hS = T.hf(x, z);
        if (gT) {
          var cix = ci % T.nx, ciz = (ci - cix) / T.nx;
          var tx1 = dx > 1e-12 ? (T.minX + (cix + 1) * T.cell - ax) / dx : dx < -1e-12 ? (T.minX + cix * T.cell - ax) / dx : 1e30;
          var tz1 = dz > 1e-12 ? (T.minZ + (ciz + 1) * T.cell - az) / dz : dz < -1e-12 ? (T.minZ + ciz * T.cell - az) / dz : 1e30;
          var tEx = tx1 < tz1 ? tx1 : tz1;
          var sLast = rest ? restTicks(tEx * L) - 1 : Math.ceil(tEx * n) - 1;
          if (sLast > n) sLast = n;
          if (sLast > s) {
            var jf = rest ? restDist(sLast) / L : sLast / n, jx = ax + dx * jf, jz = az + dz * jf;
            // the terrain can dip under the swim line between two checked points: jump only where it is clear of the line at both ends,
            // else walk the steps one by one with the swim test (the mover swims the moment the ground under it is DEEP)
            var hJ = T.hf(jx, jz);
            if (!(hS - hS === 0) || !(hJ - hJ === 0)) return false;                      // no ground height at either end of the jump (NaN, infinite): nobody walks there
            var jl = Math.sqrt((jx - x) * (jx - x) + (jz - z) * (jz - z));
            if ((hS - hJ) <= JUMP_SLOPE * jl && (!water || (hS >= T.deepY + WATER_GUARD && hJ >= T.deepY + WATER_GUARD))) { s = sLast; x = jx; z = jz; continue; }
          }
          var hN = T.hf(x, pz);
          if (!(hN - hN === 0)) return false;
          if (hS - hN <= GLUE_DROP) {                       // still glued to the ground: one more step on it
            if (water && hN < T.deepY) return false;
            z = pz;
            continue;
          }
          y = hS; vy = 0; gT = false; air = false;          // the ground falls away faster than the feet can follow
        }
        Hz = T.hf(x, pz);
        if (!(Hz - Hz === 0)) return false;
        vy += GRAVITY * TICK; y += vy * TICK;
        if (water && Hz < T.deepY && (air ? y - AIR_PAD : y) <= T.wetY) return false;
        sup = Hz;
        if (y <= Hz + 0.02) { y = Hz; vy = 0; air = false; gT = (hS - Hz) <= GLUE_DROP; } else { air = true; airTicks++; if (y - Hz > BIG_GAP) bigTicks++; }
        z = pz;
        continue;
      }
      if (gT) { y = T.hf(x, z); gT = false; vy = 0; air = false; }
      Hz = T.hf(x, pz);
      if (water && Hz < T.deepY && (air ? y - AIR_PAD : y) <= T.wetY) return false;          // swimming (player.js: deep terrain under feet at the surface)
      if (b > a) {
        yq = air ? y - AIR_PAD : y;
        sup = supportT(T, items, a, b, x, pz, yq, Hz); yd = yq > sup ? yq : sup;
        if (blockedT(T, items, a, b, x, pz, yd, rad)) return false;
      }
      z = pz;
      // gravity, integrate, land on the support (player.js stepActor)
      // A walker that stood on the floor a tick ago sinks 6 mm in this tick's gravity before the support test, so the mover lifts a step of at
      // most 0.55 - 0.006 and BLOCKS nothing between that and 0.55 (a ghost step: the capsule just walks into it). The grid has no such
      // band: a grounded walker's reach is measured from where it stood, the same STEP_G the blocking test uses, so a step is either
      // a lift or a wall (a 0.538 m step between two flush slabs used to be neither, and the mover climbed what the grid walked through).
      var yStood = y;
      vy += GRAVITY * TICK; y += vy * TICK;
      if (b > a) { _supRamp = 0; sup = supportT(T, items, a, b, x, z, air ? y - AIR_PAD : yStood, Hz); if (_supRamp === 1 && sup >= y - 0.02) usedRamp = 1; }
      else sup = Hz;
      if (y <= sup + 0.02) { y = sup; vy = 0; air = false; } else { air = true; airTicks++; if (y - sup > BIG_GAP) bigTicks++; }
      if (y < yMin) yMin = y;
    }
    if (gT) { y = T.hf(x, z); }
    else if (y > sup + 0.02) {      // the horizontal run is over and the feet are in the air (a drop): they fall straight down onto the highest top under them
      var land = b > a ? supportT(T, items, a, b, x, z, y, Hz) : Hz;
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
    if (!hop(W, T0, ax, ay, az, bx, bz, rad, fItems, fN)) return false;
    if (Math.abs(_hr[0] - by) > FLOOR_TOL) return false;
    var y0 = _hr[0], g0 = _hr[1], r0 = _hr[2], m0 = _hr[3], a0 = _hr[4], u0 = _hr[5];
    var dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz);
    if (L > 1e-6) {
      var ux = -dz / L * JITTER, uz = dx / L * JITTER;
      for (var sgn = -1; sgn <= 1; sgn += 2) {
        if (!hop(W, T0, ax + sgn * ux, ay, az + sgn * uz, bx + sgn * ux, bz + sgn * uz, rad, fItems, fN)) return false;
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
    var y0 = _hr[0], g0 = _hr[1], r0 = _hr[2], m0 = _hr[3], a0 = _hr[4], u0 = _hr[5];
    _strictRamp = 1;
    var ok = hop(W, T0, ax, ay, az, bx, bz, rad, items, n);
    _strictRamp = 0;
    var agree = ok && Math.abs(_hr[0] - y0) <= 0.1;
    _hr[0] = y0; _hr[1] = g0; _hr[2] = r0; _hr[3] = m0; _hr[4] = a0; _hr[5] = u0;
    return agree;
  }

  /** The hop just run (result in _hr) left the ground or rode a ramp. The mover accelerates, so a walker that starts from REST spends other ticks in
   *  the air over a ledge, a stair side or a steep slope. Run the same walk from a standstill: the edge / leg stands only if it ends on the same
   *  floor. (An edge that works at speed only is the one a bot gets stuck on at a waypoint: it stops at the lip, lifts too little, walks into the deck.) */
  function restAgrees(W, T0, ax, ay, az, bx, bz, rad, items, n) {
    var y0 = _hr[0], g0 = _hr[1], r0 = _hr[2], m0 = _hr[3], a0 = _hr[4], u0 = _hr[5];
    _rest = 1;
    var ok = hop(W, T0, ax, ay, az, bx, bz, rad, items, n);
    _rest = 0;
    var agree = ok && _hr[1] <= MAX_WALK_GAP && Math.abs(_hr[0] - y0) <= FLOOR_AGREE;
    _hr[0] = y0; _hr[1] = g0; _hr[2] = r0; _hr[3] = m0; _hr[4] = a0; _hr[5] = u0;
    return agree;
  }

  /** The follower is never exactly on a node (a bot consumes a waypoint within 0.6 to 1.6 m of it): the leg to b must also work from
   *  the places a walker can stand within 0.4 m of a, along the leg and across it. A start that is itself blocked, or is a different
   *  floor (past a lip), is not a place this walker stands and is skipped. Used for ramp and drop edges, where the margin is thin. */
  function perturbOK(W, T0, ax, ay, az, bx, by, bz, rad, items, n) {
    var dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz);
    if (L < 1e-6) return true;
    var ux = dx / L * PERTURB, uz = dz / L * PERTURB;
    var fixed = n >= 0;
    for (var k = 0; k < 4; k++) {
      var sx = ax + (k === 0 ? ux : k === 1 ? -ux : k === 2 ? -uz : uz), sz = az + (k === 0 ? uz : k === 1 ? -uz : k === 2 ? ux : -ux);
      var T = T0, its = items, a = 0, b = n;
      if (!fixed || sx < T0.minX || sx >= T0.maxX || sz < T0.minZ || sz >= T0.maxZ) {
        if (fixed && !W) continue;
        if (sx < T0.minX || sx >= T0.maxX || sz < T0.minZ || sz >= T0.maxZ) { T = tileFor(W, sx, sz, true); if (T === null) continue; }
        var ci = cellOf(T, sx, sz); its = T.nearItems; a = T.nearStart[ci]; b = T.nearStart[ci + 1];
        fixed = false;
      }
      var Hs = T.hf(sx, sz), sup = b > a ? supportT(T, its, a, b, sx, sz, ay, Hs) : Hs;
      if (Math.abs(sup - ay) > 0.45) continue;                           // another floor: not a place this walker stands
      if (b > a && blockedT(T, its, a, b, sx, sz, sup, rad)) continue;   // inside something: not a place it stands either
      if (!hop(W, T, sx, sup, sz, bx, bz, rad, fixed ? items : null, fixed ? n : -1)) return false;
      if (Math.abs(_hr[0] - by) > FLOOR_TOL) return false;
      fixed = n >= 0;
    }
    return true;
  }

  // the colliders that can touch one hop inside a tile: the union of the lists of the cells its bounding box covers, cut to
  // the vertical band the feet can occupy and to the corridor of the hop. A slab a storey above or a wall a storey below
  // never matters, which is most of what a multi-storey cell lists.
  var _bl = new Int32Array(512), _bn = 0, _mk = new Int32Array(0), _mkStamp = 0;
  function hopList(T, ay, by, ax, az, bx, bz, rad, big) {
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
  var QUIET_SKIN = 0.07;         // the replay moves X then Z: its corner points leave the straight line by up to 5 cm
  var _qf = new Int32Array(64);
  /** Is the flat walk a -> b over the floor at height y a walk NOTHING can disturb? True only when the full replay is certain to succeed with the feet
   *  glued to the floor all the way: no ramp, no wall or head-height slab within the capsule (+ skin) of the line, no step within the support margin
   *  (it would lift the walker), the line lies on top of floor boxes at this very height, and the terrain stays under it. It decides nothing else:
   *  false means "run the replay". items = _bl[0..n), the colliders of the hop corridor (hopList). */
  function quietFlat(T, y, ax, az, bx, bz, n) {
    var nf = 0, k, i;
    var wallR2 = (RADIUS + BAKE_SKIN + QUIET_SKIN) * (RADIUS + BAKE_SKIN + QUIET_SKIN), liftR2 = (SUP_MARGIN + QUIET_SKIN) * (SUP_MARGIN + QUIET_SKIN);
    for (k = 0; k < n; k++) {
      i = _bl[k];
      var kd = T.lk[i];
      if (kd === 1) return false;                                   // a ramp near the line: run the replay
      var top = T.ly1[i], bot = T.ly0[i];
      if (bot >= y + HEIGHT_G) continue;                            // above the head: blocks nothing, holds nothing up
      if (top <= y + STEP_G) {                                      // a step or the floor itself: never blocks
        if (kd === 2) continue;
        if (top >= y - 0.02 && top <= y + 0.02) { if (nf < 64) _qf[nf++] = i; else return false; }
        else if (top > y + 0.02 && segRectD2(ax, az, bx, bz, T.lx0[i] - 0, T.lx1[i], T.lz0[i], T.lz1[i]) < liftR2) return false;     // would lift the walker
        continue;
      }
      if (segRectD2(ax, az, bx, bz, T.lx0[i], T.lx1[i], T.lz0[i], T.lz1[i]) < wallR2) return false;                             // a wall within the capsule
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
      var hx = ax + dx * 0.5 * s2, hz = az + dz * 0.5 * s2, Hh = T.hf(hx, hz);
      if (!(Hh <= y + 0.02)) return false;
      if (water && Hh < T.deepY && y <= T.wetY) return false;
    }
    return true;
  }

  // ── edge classification (one place, used by the bake and by the tile stitching) ──────────────────────────────────
  var _ec = new Float64Array(2);   // [0] cost of the edge classified last

  /** The kind of the edge a -> b (EDGE_*), or -1 when the mover cannot make it (cost in _ec[0]). fa / fb = node flags.
   *  ca >= 0: both nodes are in tile T0 and the bake may cut the colliders to this hop; ca < 0: read each cell as the line goes. */
  function evalEdge(W, T0, ax, ay, az, fa, bx, by, bz, fb, ca, cb) {
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
          if (bx < Tb.minX || bx >= Tb.maxX || bz < Tb.minZ || bz >= Tb.maxZ) { Tb = W ? tileFor(W, bx, bz, true) : null; if (Tb === null) return -1; }
          var cbb = cellOf(Tb, bx, bz), sb = Tb.nearStart[cbb], eb = Tb.nearStart[cbb + 1];
          var hb = Tb.hf(bx, bz), land = eb > sb ? supportT(Tb, Tb.nearItems, sb, eb, bx, bz, ay, hb) : hb;
          if (Math.abs(land - by) > FLOOR_TOL) return -1;
        }
      }
    }
    var ln = -1;
    // bake: only what can touch this hop (the capsule and the support margin reach 0.455 m). The follower checks (perturbOK starts a walker
    // 0.4 m off the node) need the wide corridor: it is built only where they run.
    if (ca >= 0) ln = hopList(T0, ay, by, ax, az, bx, bz, rad, false);
    if (terr) {
      // terrain is followed at any slope (supportIn: terrain always counts); only a collider can refuse the hop
      if (ln !== 0) {
        if (!hop(W, T0, ax, ay, az, bx, bz, rad, _bl, ln)) return -1;
        if (Math.abs(_hr[0] - by) > FLOOR_TOL) return -1;
        if (_hr[4] > 0 && !restAgrees(W, T0, ax, ay, az, bx, bz, rad, _bl, ln)) return -1;
      }
      cost = len3 * (1 + 0.4 * Math.min(1, Math.abs(dy) / dxz));
    } else {
      if (ln === 0) return -1;                             // a non-terrain floor with nothing under it: no such edge
      if (ln > 0 && kind === EDGE_WALK && !rampInv && dy < 0.02 && dy > -0.02 && quietFlat(T0, ay, ax, az, bx, bz, ln)) {
        _hr[0] = by; _hr[1] = 0; _hr[2] = 0; _hr[3] = ay < by ? ay : by; _hr[4] = 0; _hr[5] = 0;        // the replay would walk it flat: skip it
      } else if (!hop(W, T0, ax, ay, az, bx, bz, rad, _bl, ln)) return -1;
      if (Math.abs(_hr[0] - by) > FLOOR_TOL) return -1;    // the feet must land on the floor this edge claims
      if (kind !== EDGE_DROP && _hr[4] > 0 && !restAgrees(W, T0, ax, ay, az, bx, bz, rad, _bl, ln)) return -1;
      if (kind === EDGE_DROP) {
        if (_hr[5] === 1 && !sameWithoutRampMargin(W, T0, ax, ay, az, bx, bz, rad, _bl, ln)) return -1;
        if (ln >= 0) { ln = hopList(T0, ay, by, ax, az, bx, bz, rad, true); if (!perturbOK(W, T0, ax, ay, az, bx, by, bz, rad, _bl, ln)) return -1; }        // a drop is optional: only the robust ones
        cost = len3 + DROP_COST + 0.3 * -dy;
      } else {
        if (_hr[1] > MAX_WALK_GAP) return -1;              // it fell: not a walk
        if (dy < 0.3 && dy > -0.3 && _hr[3] < (ay < by ? ay : by) - 0.2) return -1;       // a flat edge over a floor that dips under the feet (a stairwell corner, a gap): a near miss
        if (rampInv || _hr[2] === 1) {
          kind = EDGE_RAMP;
          if (_hr[5] === 1 && !sameWithoutRampMargin(W, T0, ax, ay, az, bx, bz, rad, _bl, ln)) return -1;         // not a margin trick (a lift from a ramp's side); no margin used = the replay would be the same walk
          if (ln >= 0) { ln = hopList(T0, ay, by, ax, az, bx, bz, rad, true); if (!perturbOK(W, T0, ax, ay, az, bx, by, bz, rad, _bl, ln)) return -1; }      // thin margins: must survive a follower's error
        }
        else if (((fa ^ fb) & F_TERR) !== 0 || dy > 0.2 || dy < -0.2) {
          // a step between floor types (terrain to a deck, a raft, a porch): a lift that works from exact positions only is no edge
          if (ln >= 0) { ln = hopList(T0, ay, by, ax, az, bx, bz, rad, true); if (!perturbOK(W, T0, ax, ay, az, bx, by, bz, rad, _bl, ln)) return -1; }
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
  function floorFragile(T, items, a, b, x, z, y, own) {
    for (var k = 0; k < 8; k++) {
      var ang = k * 0.7853981633974483, px = x + 0.3 * Math.cos(ang), pz = z + 0.3 * Math.sin(ang);
      var Hp = T.hf(px, pz), sup = supportT(T, items, a, b, px, pz, y, Hp);
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
  /** bakeTile as a GENERATOR (Wave 7, lane 7B2): the same code, with a `yield` every 4 flagged cells of the node pass and every YIELD_STEPS replayed
   *  steps of the edge pass, so one 10-190 ms tile can be baked a slice at a time (stepJob). The yields carry no data and change no state: driven
   *  to the end the result is byte for byte the tile the single call gave (world hash pinned by the selftest). The work counters are the only clock. */
  function* bakeTileGen(colliders, heightFn, rect, cell, opts) {
    var t0 = now();
    opts = opts || {};
    var cs = makeColSet(colliders, opts.blockers), hf = heightFn;
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
    var T = {
      isTile: true, grp: null, island: null, key: opts.key != null ? opts.key : 0, minX: minX, minZ: minZ, maxX: maxX, maxZ: maxZ, cell: cell, nx: nx, nz: nz, inv: inv, hf: hf,
      deepY: waterY - DEEP, wetY: waterY + 0.3,
      m: m, lx0: new Float64Array(m), lx1: new Float64Array(m), ly0: new Float64Array(m), ly1: new Float64Array(m),
      lz0: new Float64Array(m), lz1: new Float64Array(m), lk: new Uint8Array(m), ld: new Int8Array(m),
      nearStart: null, nearItems: null, slot: -1, base: 0, linkedAll: false,
    };
    for (j = 0; j < m; j++) {
      q = sel[j];
      T.lx0[j] = cs.minX[q]; T.lx1[j] = cs.maxX[q]; T.ly0[j] = cs.minY[q]; T.ly1[j] = cs.maxY[q];
      T.lz0[j] = cs.minZ[q]; T.lz1[j] = cs.maxZ[q]; T.lk[j] = cs.kind[q]; T.ld[j] = cs.dir[q];
    }
    var lx0 = T.lx0, lx1 = T.lx1, ly0 = T.ly0, ly1 = T.ly1, lz0 = T.lz0, lz1 = T.lz1, lk = T.lk;

    // 2. per-cell collider lists: every collider within E1 (capsule + pad) of the cell's rectangle. An empty list = an
    //    OPEN cell: terrain floor, nothing can block or lift anyone there.
    var nearStart = new Int32Array(ncell + 1), nearItems;
    var i0, i1, k0, k1, ix, iz, ci;
    for (var pass = 0; pass < 2; pass++) {
      var cur = pass === 1 ? nearStart.slice(0, ncell) : null;
      for (j = 0; j < m; j++) {
        i0 = Math.floor((lx0[j] - E1 - minX) * inv); i1 = Math.floor((lx1[j] + E1 - minX) * inv);
        k0 = Math.floor((lz0[j] - E1 - minZ) * inv); k1 = Math.floor((lz1[j] + E1 - minZ) * inv);
        if (i1 < 0 || k1 < 0 || i0 >= nx || k0 >= nz) continue;
        if (i0 < 0) i0 = 0; if (k0 < 0) k0 = 0; if (i1 >= nx) i1 = nx - 1; if (k1 >= nz) k1 = nz - 1;
        for (iz = k0; iz <= k1; iz++) for (ix = i0; ix <= i1; ix++) {
          ci = iz * nx + ix;
          if (pass === 0) nearStart[ci + 1]++; else nearItems[cur[ci]++] = j;
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
        var h0 = hf(cxm, czm);
        if (!(h0 >= waterY - DEEP) || h0 === Infinity) continue;           // swimming, or no ground at all (a non-finite height: NaN poisons every cost it touches)
        pushNode(cxm, h0, czm, ci, -1, F_OPEN | F_TERR | (3 << 4) | (h0 < waterY ? F_WET : 0));
        openCells++;
        continue;
      }
      flaggedCells++;
      if ((flaggedCells & 3) === 0) yield 0;
      var nE = 0;
      for (var si = 0; si < 9; si++) {
        var sx, sz;
        if (si === 0) { sx = cxm; sz = czm; }
        else if (si <= 4) { sx = cxm + OFFS[si - 1] * cell; sz = czm; }
        else { sx = cxm; sz = czm + OFFS[si - 5] * cell; }
        var dd = Math.abs(sx - cxm) + Math.abs(sz - czm);
        var H = hf(sx, sz), nC = 1, nM = 0;
        if (!(H > -1e9 && H < 1e9)) continue;                                           // the terrain function gave no height here
        cY[0] = H; cO[0] = -1;
        for (k = a; k < b; k++) {
          q = nearItems[k];
          if (lk[q] === 2) continue;                                                   // a blocker is never a floor and never lifts
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
          if (blockedT(T, nearItems, a, b, sx, sz, cy, rad)) continue;                 // a standing capsule does not fit
          // clearance tier 0..3 (a capsule 0.1 / 0.2 / 0.3 m fatter still fits): nodes sit in the middle of a doorway, not on
          // whichever lattice point happens to be nearest the cell centre
          var tier = 0;
          if (!blockedT(T, nearItems, a, b, sx, sz, cy, RADIUS + 0.1)) {
            tier = 1;
            if (!blockedT(T, nearItems, a, b, sx, sz, cy, RADIUS + 0.2)) { tier = 2; if (!blockedT(T, nearItems, a, b, sx, sz, cy, RADIUS + 0.3)) tier = 3; }
          }
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
        pushNode(eX[bestR], eY[bestR], eZ[bestR], ci, ow0, F_RAMP | ((eY[bestR] - ly0[ow0] <= 0.6 || ly1[ow0] - eY[bestR] <= 0.6) ? F_RAMPEND : 0) | (robOf(eR[bestR], floorFragile(T, nearItems, a, b, eX[bestR], eZ[bestR], eY[bestR], ow0)) << 4));
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
        pushNode(eX[best], eY[best], eZ[best], ci, ow, fl | (robOf(eR[best], floorFragile(T, nearItems, a, b, eX[best], eZ[best], eY[best], ow)) << 4));
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
    for (;;) {
    while (qh < qt) {
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
          if (_cnt[1] - yAt >= YIELD_STEPS) { yAt = _cnt[1]; yield 0; }       // (never between an evalEdge and the read of its result in _ec / _hr: a slice boundary restores that scratch)
          kd = evalEdge(null, T, nX[na], nY[na], nZ[na], nFlag[na], nX[nbn], nY[nbn], nZ[nbn], nFlag[nbn], ci, cj2);
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
            if (ddy > -STEP_G - 1e-6 || ddy < -DROP_MAX) continue;
            var ddx = nX[nbn2] - nX[na], ddz = nZ[nbn2] - nZ[na];
            if (ddx * ddx + ddz * ddz > 1.45 * 1.45) continue;
            if (_cnt[1] - yAt >= YIELD_STEPS) { yAt = _cnt[1]; yield 0; }
            var kd2 = evalEdge(null, T, nX[na], nY[na], nZ[na], nFlag[na], nX[nbn2], nY[nbn2], nZ[nbn2], nFlag[nbn2], ci, cj3);
            dropTests++;
            if (kd2 !== EDGE_DROP) continue;
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
    if (nearItems.length < 65535 && m < 65535) {
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
    return T;
  }

  function tileBytes(T) {
    var s = 0, names = ["lx0", "lx1", "ly0", "ly1", "lz0", "lz1", "lk", "ld", "nearStart", "nearItems", "x", "y", "z", "flag", "bord", "adj",
      "cellStart", "edgeStart", "edgeTo", "edgeCost", "edgeKind", "extStart", "extTo", "extCost", "extKind"];
    for (var i = 0; i < names.length; i++) if (T[names[i]]) s += T[names[i]].byteLength;
    return s;
  }

  /** FNV-1a over the tile's graph (rounded to the millimetre / centimetre): the determinism fingerprint. */
  function tileHash(T) {
    var h = 0x811c9dc5 | 0;
    function mix(v) { h ^= v & 0xff; h = Math.imul(h, 16777619); h ^= (v >>> 8) & 0xff; h = Math.imul(h, 16777619); h ^= (v >>> 16) & 0xff; h = Math.imul(h, 16777619); h ^= (v >>> 24) & 0xff; h = Math.imul(h, 16777619); }
    mix(T.n); mix(T.nx); mix(T.nz);
    var i;
    for (i = 0; i < T.n; i++) { mix(Math.round(T.x[i] * 1000)); mix(Math.round(T.y[i] * 1000)); mix(Math.round(T.z[i] * 1000)); mix(T.flag[i]); mix(T.adj[i]); }
    mix(T.edgeTo.length);
    for (i = 0; i < T.edgeTo.length; i++) { mix(T.edgeTo[i]); mix(Math.round(T.edgeCost[i] * 100)); mix(T.edgeKind[i]); }
    return (h >>> 0).toString(16);
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
    var t0 = now();
    var blockers = [];
    if (opts.portals) for (var pi = 0; pi < opts.portals.length; pi++) blockers.push(portalBlocker(opts.portals[pi]));
    var cs = makeColSet(opts.colliders, blockers);
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
    return W;
  }

  // A bake does NOT stitch. Stitching a tile replays hops that can step into a tile nobody has baked (a diagonal hop across a corner passes through
  // one of the two other tiles there); baking that tile and stitching it in turn used to cascade across the whole covered area (ashgrid seed 14:
  // one query baked 16,342 tiles and overflowed the global node id). Tiles are baked bare; linkTile() stitches a tile to the baked tiles around
  // it, and only ensureLinked / resolveGroup / prewarm ask for that.
  function register(W, T) {
    T.slot = W.slots.length; T.base = T.slot * STRIDE; W.slots.push(T);
    W.stats.bakes++; W.stats.bakeMs += T.stats.ms;
  }

  function bakeCoarse(W, tx, tz) {
    if (W.slots.length >= MAX_SLOTS) return null;
    var size = W.tileSize, rect = { minX: tx * size, minZ: tz * size, maxX: (tx + 1) * size, maxZ: (tz + 1) * size };
    var holes = W.fineByCoarse.get(coarseKey(tx, tz)) || null;
    var T = bakeTile(W.cs, W.hf, rect, W.cellOutdoor, { holes: holes, waterY: W.waterY, key: coarseKey(tx, tz) });
    T.kind = "coarse"; T.tx = tx; T.tz = tz;
    W.coarse.set(coarseKey(tx, tz), T);
    register(W, T);
    return T;
  }

  function bakeFine(W, r) {
    if (W.slots.length >= MAX_SLOTS) return null;
    var T = bakeTile(W.cs, W.hf, r, W.cellIndoor, { waterY: W.waterY, key: 100000000 + r.idx, seam: r.seam });
    T.kind = "fine"; T.rectRef = r; T.grp = r.grp;
    r.tile = T;
    register(W, T);
    return T;
  }

  /** The module scratch a replay uses (bakeTile saves and restores it around a whole bake; an incremental bake does the same around every slice). */
  var _scr = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];       // (reused: stepJob is not re-entrant, and a fresh array per slice was 10 MB of garbage per city)
  function saveScratch() { var s = _scr; s[0] = _hr[0]; s[1] = _hr[1]; s[2] = _hr[2]; s[3] = _hr[3]; s[4] = _hr[4]; s[5] = _hr[5]; s[6] = _marginUse; s[7] = _ec[0]; s[8] = _strictRamp; s[9] = _supRamp; s[10] = _rest; s[11] = _wsRamp; return s; }
  function loadScratch(s) { _hr[0] = s[0]; _hr[1] = s[1]; _hr[2] = s[2]; _hr[3] = s[3]; _hr[4] = s[4]; _hr[5] = s[5]; _marginUse = s[6]; _ec[0] = s[7]; _strictRamp = s[8]; _supRamp = s[9]; _rest = s[10]; _wsRamp = s[11]; }

  /**
   * AN INCREMENTAL JOB (lane 7B2): bake one tile of a lazy world (a { kind, key, tx, tz, rect } from collectJobs / takeWanted), stitch it to the baked
   * tiles round it and settle its building - a SLICE at a time. beginJob() starts it; each stepJob() call runs one slice of ~1-3 ms of replay work
   * (a count of flagged cells, replays and stitched pairs, never a clock) and returns true when the job is over. Driven to the end the world is the
   * one runJob() builds (same code, same order). A tile that is mid-bake is invisible to queries (it is registered when its bake ends).
   */
  function beginJob(W, j) {
    var job = { j: j, phase: 0, gen: null, tile: null, slices: 0, ms: 0, done: false };
    if (j.kind === 0 ? W.coarse.has(j.key) : j.rect.tile !== null) { job.phase = 3; job.done = true; return job; }
    if (W.slots.length >= MAX_SLOTS) { job.phase = 3; job.done = true; return job; }
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
  function tileFor(W, x, z, bake) {
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
    var order = new Array(tot);
    for (i = 0; i < tot; i++) order[i] = i;
    order.sort(function (p, q) { return (src[p] - src[q]) || (key[p] - key[q]); });
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
    for (var n = 0; n < T.n; n++) {
      if (T.bord[n] === 0) continue;
      var ax = T.x[n], ay = T.y[n], az = T.z[n], fa = T.flag[n];
      for (var u = 0; u < fresh.length; u++) {
        var U = fresh[u];
        var reach = 0.875 * (T.cell + U.cell) + 0.1;
        if (ax + reach < U.minX || ax - reach >= U.maxX || az + reach < U.minZ || az - reach >= U.maxZ) continue;
        var i0 = Math.max(0, Math.floor((ax - reach - U.minX) * U.inv)), i1 = Math.min(U.nx - 1, Math.floor((ax + reach - U.minX) * U.inv));
        var k0 = Math.max(0, Math.floor((az - reach - U.minZ) * U.inv)), k1 = Math.min(U.nz - 1, Math.floor((az + reach - U.minZ) * U.inv));
        for (var iz = k0; iz <= k1; iz++) for (var ix = i0; ix <= i1; ix++) {
          var ci = iz * U.nx + ix;
          for (var m = U.cellStart[ci]; m < U.cellStart[ci + 1]; m++) {
            var bx = U.x[m], by = U.y[m], bz = U.z[m], dx = bx - ax, dz = bz - az;
            if (dx * dx + dz * dz > reach * reach) continue;
            var fb = U.flag[m];
            var kd = evalEdge(W, T, ax, ay, az, fa, bx, by, bz, fb, -1, -1);
            if (kd >= 0) { (T.pend || (T.pend = [])).push(n, U.base + m, _ec[0], kd); }
            kd = evalEdge(W, U, bx, by, bz, fb, ax, ay, az, fa, -1, -1);
            if (kd >= 0) { (U.pend || (U.pend = [])).push(m, T.base + n, _ec[0], kd); }
            if (_cnt[1] - yL >= YIELD_STEPS) { yL = _cnt[1]; yield 0; }
          }
        }
      }
    }
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
    if (dx !== 0) tileFor(W, x + dx, z, true);
    if (dz !== 0) tileFor(W, x, z + dz, true);
    if (dx !== 0 && dz !== 0) tileFor(W, x + dx, z + dz, true);
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
    // goal candidates first (the snap scratch is shared): nodes the mover can walk straight to the goal point from, else the nearest
    var nG = snapNodes(W, tx, ty, tz, 1.5, 2.6);
    if (nG === 0) { W.lastFail = "no-goal"; W.stats.queryMs += now() - t0; return null; }
    var goals = [], g, gc = [];
    for (g = 0; g < nG; g++) gc.push(snapGid[g]);
    for (g = 0; g < gc.length && goals.length < 3; g++) {
      var Tq = W.slots[gc[g] / STRIDE | 0], lq = gc[g] % STRIDE;
      if (hop(W, Tq, Tq.x[lq], Tq.y[lq], Tq.z[lq], tx, tz, RADIUS, null, -1) && _hr[1] <= MAX_WALK_GAP && Math.abs(_hr[0] - ty) <= 0.6) goals.push(gc[g]);
    }
    var goalVerified = goals.length > 0;
    if (!goalVerified) goals.push(gc[0]);
    // start candidates: nodes the mover can walk to from where the bot stands (it may be in a doorway the nearest node is behind)
    var nS = snapNodes(W, sx, sy, sz, 1.5, 2.6);
    if (nS === 0) { W.lastFail = "no-start"; W.stats.queryMs += now() - t0; return null; }
    var starts = [], sc0 = [], scc = [], ssc = [];
    for (g = 0; g < nS; g++) { scc.push(snapGid[g]); ssc.push(snapSc[g]); }
    var Ts0 = tileFor(W, sx, sz, true);
    for (g = 0; g < scc.length && starts.length < 3; g++) {
      var Tr = W.slots[scc[g] / STRIDE | 0], lr = scc[g] % STRIDE;
      if (Ts0 !== null && hop(W, Ts0, sx, sy, sz, Tr.x[lr], Tr.z[lr], RADIUS, null, -1) && _hr[1] <= MAX_WALK_GAP && Math.abs(_hr[0] - Tr.y[lr]) <= 0.6) { starts.push(scc[g]); sc0.push(ssc[g]); }
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
      var Tl = tileFor(W, px[cnt - 1], pz[cnt - 1], true);
      if (Tl !== null && hop(W, Tl, px[cnt - 1], py[cnt - 1], pz[cnt - 1], tx, tz, RADIUS, null, -1) && Math.abs(_hr[0] - ty) <= 0.6 && _hr[1] <= MAX_WALK_GAP) {
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
    var T = tileFor(W, px[i], pz[i], true);
    if (T === null) return false;
    var dx = px[j] - px[i], dz = pz[j] - pz[i];
    if (dx * dx + dz * dz > 1600) return false;
    if (!hop(W, T, px[i], py[i], pz[i], px[j], pz[j], RADIUS + pad, null, -1)) return false;
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
    var ok = hop(W, T, ax, ay, az, bx, bz, rad, null, -1);
    _rest = 0;
    if (!ok || _hr[1] > MAX_WALK_GAP) return NaN;
    var yB = _hr[0], yLow = _hr[3];
    _wsRamp = _hr[2] === 1;
    // a flat leg over a floor that dips under the feet (a stairwell corner, a gap in a deck): the replay catches the far lip on the way
    // down, a walker that starts from rest falls through. legOk and evalEdge refuse the same leg; terrain legs dip with the ground, so
    // only a leg with neither end on the terrain counts.
    var dx = bx - ax, dz = bz - az, L = Math.sqrt(dx * dx + dz * dz);
    var Tb = L > 1e-6 ? tileFor(W, bx, bz, true) : T;
    if (Tb === null) return NaN;
    if (Math.abs(yB - ay) < 0.3 && yLow < (ay < yB ? ay : yB) - 0.2 && Math.abs(ay - T.hf(ax, az)) > 0.05 && Math.abs(yB - Tb.hf(bx, bz)) > 0.05) return NaN;
    // a walker arrives a few centimetres past its waypoint: the floor must hold OVERSHOOT m beyond the end of the segment
    if (L > 1e-6) {
      if (!hop(W, Tb, bx, yB, bz, bx + dx / L * OVERSHOOT, bz + dz / L * OVERSHOOT, rad, null, -1)) return NaN;
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
      var T = tileFor(W, px, pz, true);
      if (T === null) return false;
      var ci = cellOf(T, px, pz), a = T.nearStart[ci], b = T.nearStart[ci + 1], H = T.hf(px, pz);
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
    var T = tileFor(W, ax, az, true);
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
        var okE = hop(W, T, ax, ay, az, ex, ez, rad, null, -1);
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
        cellIndoor: opts.cellIndoor, maxFine: opts.maxFine, fineRects: opts.fineRects, rects: rects, margin: margin, lazy: opts.lazy });
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

  var api = {
    bakeTile: bakeTile, createWorld: createWorld, findPath: findPath, walkSegment: walkSegment, tileFor: tileFor, prewarm: prewarm,
    VERSION: VERSION, bakeTown: bakeTown, rectOfLayout: rectOfLayout, edgesOf: edgesOf, linkTile: linkTile,
    makeColSet: makeColSet, findBuildingRects: findBuildingRects, tiles: tiles, worldHash: worldHash, worldStats: worldStats, tileHash: tileHash,
    collectJobs: collectJobs, runJob: runJob, takeWanted: takeWanted, beginJob: beginJob, stepJob: stepJob, work: function () { return _cnt[1]; },
    tilesAround: tilesAround, snapNodes: function (W, x, y, z, maxDy, R) { var n = snapNodes(W, x, y, z, maxDy, R), o = []; for (var i = 0; i < n; i++) o.push(snapGid[i]); return o; },
    // the mover model, exposed for the selftest and the harness (pure given a tile)
    rampBlocksT: rampBlocksT, supportT: supportT, blockedT: blockedT, hop: function (W, T0, ax, ay, az, bx, bz, rad, strict) {
      _strictRamp = strict ? 1 : 0;
      var ok = hop(W, T0, ax, ay, az, bx, bz, rad, null, -1);
      _strictRamp = 0;
      return ok ? { y: _hr[0], gap: _hr[1], ramp: _hr[2] === 1, yMin: _hr[3] } : null;
    },
    counters: function () { return { hops: _cnt[0], steps: _cnt[1] }; }, resetCounters: function () { _cnt[0] = 0; _cnt[1] = 0; },
    EDGE_WALK: EDGE_WALK, EDGE_DROP: EDGE_DROP, EDGE_RAMP: EDGE_RAMP,
    ACCEL_T: ACCEL_T, HOP_SPEED: HOP_SPEED, ARRIVE: ARRIVE, STEP_UP: STEP_UP, STEP_G: STEP_G, RADIUS: RADIUS, HEIGHT: HEIGHT, HEIGHT_G: HEIGHT_G, SUP_MARGIN: SUP_MARGIN, GRAVITY: GRAVITY, TICK: TICK, RAMP_THICK: RAMP_THICK,
    DROP_MAX: DROP_MAX, STRIDE: STRIDE, FLOOR_TOL: FLOOR_TOL, LINK_BAND: LINK_BAND, F_OPEN: F_OPEN, F_WET: F_WET, F_RAMP: F_RAMP, F_TERR: F_TERR, F_PROV: F_PROV,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.FFG = root.FFG || {};
  root.FFG.sim = root.FFG.sim || {};
  root.FFG.sim.NavGrid = api;
})(typeof window !== "undefined" ? window : globalThis);
