// core/level/maps/switchyard.js [multi-arena wave — the SWITCHYARD arena]
// SWITCHYARD — Vektor Transit's tram maintenance depot, two streets north of
// the Meridian Ward. Rainy night, sodium over wet asphalt, the running shed
// lit cold fluorescent through its open end doors.
//
// Unlike LANTERNWALK (a carve of the campaign map — maps/lanternwalk.js
// subtracts voids out of meridian_ward's mass), this arena is AUTHORED
// STANDALONE: every wall, every car, every prop below is written here. It
// imports nothing from the ward, so nothing outside this file can drift it.
//
// Coordinate convention unchanged: +X east, +Z south, Y up, metres.
// Arena bounds: X ∈ [−42, +32], Z ∈ [−27, +23]  (74 × 50 m = 3700 m² gross).
//
// ── THE ONE STRUCTURAL IDEA ────────────────────────────────────────────────
// The depot is built as an exact 180° ROTATION about its centre (−5, −2):
// every structural box is emitted twice, once at (x, z) and once at
// (−10 − x, −4 − z). A depot is the rare locale where that reads as fiction
// rather than as symmetry for its own sake — two identical car halls facing
// each other down the same roads is how a running shed is actually built.
//
// It buys three gates outright:
//   • G-I / G-J (flag + TDM parity): path lengths, cover counts and the
//     longest line into each flag site are equal BY CONSTRUCTION, not by
//     iteration, so the probe budget went into G-C/G-D/G-E instead.
//   • G-H: the boundary is one mirrored pair of wall runs — no gaps to find.
// Prop KINDS differ between the halves (west: fuel drums, pallets, sand bins;
// east: crates, shelving, stores racks) so the two ends of the depot read as
// different places while their footprints stay mirror-identical.
//
// ── THE SHAPE, AND WHY ─────────────────────────────────────────────────────
// Five spaces, in a ring around one hub:
//
//        ┌─── north yard, west cell ──┬─┬─ east cell ──┬─ CAR HALL B ──┐
//        │   stabled cars as islands  │H│              │  (FLAG_EAST)  │
//   west ├────────────────────────────┴─┴──────────────┼───────────────┤
//   apron│                                             │  east apron   │
//   (+ W │            THE RUNNING SHED                 │  (+ E platform)
//   plat)│         32 × 20 m covered hub               │               │
//        ├── CAR HALL A ──┬────────────────────────────┴───────────────┤
//        │   (FLAG_WEST)  │  south yard  ┬─┬───────────────────────────┤
//        └────────────────┴──────────────┴H┴───────────────────────────┘
//                        (H = the signals hut that splits each yard)
//
// THE HUB IS THE GATE. G-C wants a tight map (<6 m rays ≥ 40%) and G-E wants
// an open one (P(≥1 of 9 actors in line of sight) ≥ 70%) — the first draft of
// this map was a pure lattice of 4 m aisles and measured 63% / 48%: it passed
// sightlines and FAILED occupancy, i.e. ten players could not find each other.
// The fix was structural, not cosmetic: one large intervisible space (the
// shed, 640 m², with 9 m end doors onto both aprons so shed+apron read as one
// room) plus two open stabling yards, and the lattice reserved for the edges.
//
// Nothing is allowed to run straight for its full length, though. The map is
// 74 m wide and the ≥55 m gate is the unforgiving one, so every east–west
// axis is broken twice and no north–south axis needs breaking at all (the
// arena is only 50 m deep — a north–south ray cannot reach 55 m by
// construction, which is why the shed's yard walls could be opened up to
// three 6 m roller doors a side without paying for it):
//   1. THE SIGNALS HUTS — one 6 × 8.5 m hut per yard, doors OFFSET in Z so
//      the hut is walkable through and no ray is, plus a standing car
//      covering the depth the hut does not, far enough away that a diagonal
//      still crosses. Straight lines die; sightlines across the yard live.
//   2. OFFSET DOORS — neither car hall has two doors on a common axis, and
//      the shed's two end doors overlap only over Z[−8,+4], which is exactly
//      the band the two pit cars cover: no ray crosses apron to apron.
//   3. CARS AS ISLANDS — the yard cars are cover to fight around, not walls
//      to route around; they are the reason the 27 m cells are fightable.
// Platform tops are 1.2 m: a real step, but LOW ENOUGH NOT TO BLOCK A
// STANDING RAY. Everything that occludes on a platform is a shelter or a
// board standing ON it — verticality here is a flanking floor, not a sniper
// deck (_design/pvp/arena.md Part 3.4).

const BOUNDS = { min: [-42, -2, -27], max: [32, 14, 23] };

// 180° rotation about the depot centre (−5, −2): x' = MX − x, z' = MZ − z.
const MX = -10, MZ = -4;
const mx = (x) => MX - x;
const mz = (z) => MZ - z;

// ---------------------------------------------------------------- helpers
// Same constructors as lanternwalk.js / meridian_ward.js (those modules
// export no helpers and must stay byte-identical — PVP_BUILD_PLAN O2).
function wbox(id, kind, x0, x1, y0, y1, z0, z1, surface = "concrete", matClass = "hard") {
  return {
    id, kind,
    min: [Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1)],
    max: [Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1)],
    surface, matClass,
  };
}

function prop(id, kind, x, z, rot, sx, sz, h, surface, matClass, opts = {}) {
  const y0 = opts.y0 || 0;
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  const hx = (c * sx + s * sz) / 2;
  const hz = (s * sx + c * sz) / 2;
  const solid = opts.solid !== false;
  const aabb = solid
    ? { min: [x - hx, y0, z - hz], max: [x + hx, y0 + h, z + hz] }
    : null;
  let cover = null;
  if (opts.cover) {
    const d = opts.cover.dir;
    cover = {
      pos: [x - d[0] * (hx + 0.55), y0, z - d[2] * (hz + 0.55)],
      dir: [d[0], 0, d[2]],
      height: opts.cover.height,
    };
  }
  return {
    id, kind, pos: [x, y0, z], rot, size: [sx, h, sz],
    surface, matClass, solid, aabb, cover, flags: opts.flags || null,
  };
}

// Stair runs. Risers are 0.3 m — the sim capsule's step-up budget (A1's
// moveCapsule contract), so every platform edge here is bot-climbable and no
// lane in lanes/switchyard.js needs botTraversable:false.
function stepsZ(list, idp, x0, x1, zFrom, zTo, n, riser, yBase = 0) {
  const tread = (zTo - zFrom) / n;
  for (let i = 0; i < n; i++) {
    list.push(wbox(`${idp}_${i}`, "step", x0, x1, 0, yBase + riser * (i + 1),
      zFrom + tread * i, zFrom + tread * (i + 1), "concrete", "hard"));
  }
}

// ---- the mirror pair emitters (the structural-parity contract) -----------
// Every call writes the authored piece AND its 180° twin. wbox() sorts its
// own min/max, so handing it mirrored (and therefore reversed) coordinates
// is safe and keeps the call sites readable.
function wPair(out, idA, idB, kind, x0, x1, y0, y1, z0, z1, surface = "concrete", matClass = "hard") {
  out.push(wbox(idA, kind, x0, x1, y0, y1, z0, z1, surface, matClass));
  out.push(wbox(idB, kind, mx(x0), mx(x1), y0, y1, mz(z0), mz(z1), surface, matClass));
}
function stepsPair(out, idA, idB, x0, x1, zFrom, zTo, n, riser) {
  stepsZ(out, idA, x0, x1, zFrom, zTo, n, riser);
  stepsZ(out, idB, mx(x0), mx(x1), mz(zFrom), mz(zTo), n, riser);
}

// A standing tram car. Three boxes — skirt / body / roof — because a single
// prism reads as a freight container, and containers are LANTERNWALK's
// signature (this map is capped at one container pair for exactly that
// reason). Faces touch exactly, never interpenetrate (probe_props gate 3).
// Body top 3.35 m: taller than any sightline, so a car is hard cover from
// every stance; matClass metal_thin keeps it PENETRABLE by the heavier
// weapons (combat_spec §3.2), which is what stops a yard full of cars from
// playing like a yard full of concrete.
function tramCar(out, id, x0, x1, z0, z1) {
  const alongX = (x1 - x0) >= (z1 - z0);
  out.push(wbox(`${id}_skirt`, "wall", x0 + (alongX ? 0.35 : 0.28), x1 - (alongX ? 0.35 : 0.28),
    0, 0.45, z0 + (alongX ? 0.28 : 0.35), z1 - (alongX ? 0.28 : 0.35), "metal", "metal_thin"));
  out.push(wbox(`${id}_body`, "wall", x0, x1, 0.45, 3.35, z0, z1, "metal", "metal_thin"));
  out.push(wbox(`${id}_roof`, "wall", x0 + (alongX ? 0.9 : 0.12), x1 - (alongX ? 0.9 : 0.12),
    3.35, 3.62, z0 + (alongX ? 0.12 : 0.9), z1 - (alongX ? 0.12 : 0.9), "metal", "metal_thin"));
}
function tramPair(out, idA, idB, x0, x1, z0, z1) {
  tramCar(out, idA, x0, x1, z0, z1);
  tramCar(out, idB, Math.min(mx(x0), mx(x1)), Math.max(mx(x0), mx(x1)),
    Math.min(mz(z0), mz(z1)), Math.max(mz(z0), mz(z1)));
}

// ---------------------------------------------------------------- export
export function buildLayout(seed = 1) {
  const W = [];

  // ===================================================== 1. THE BOUNDARY
  // G-H: closed, and closed DIEGETICALLY (arena.md carve rule 1 — no
  // invisible walls anywhere in this project). West/east are the depot's
  // retaining walls under the viaduct embankments; north is the blast wall
  // behind the stabling roads, south the yard hoarding on the street side.
  // 6.5 m: unmantleable, and tall enough that no ray leaves the arena.
  wPair(W, "bnd_w", "bnd_e", "wall", -42, -41, 0, 6.5, -27, 23);
  wPair(W, "bnd_n", "bnd_s", "wall", -41, 31, 0, 6.5, -27, -26);

  // ===================================================== 2. THE CAR HALLS
  // The two flag rooms: 12 × 12 m inspection halls in opposite corners, each
  // with THREE mouths (arena.md §1.5 — a flag room with two doors is a
  // corridor, with four is a field). D1/D2 open onto the apron, D3 onto the
  // yard; D1 and D2 are split on the far side by the hall's own standing car,
  // so they are two approaches and not one 9 m doorway.
  //   WEST "CAR HALL A"  interior X[−41,−29] Z[+10,+22]  — FLAG_WEST
  //   EAST "CAR HALL B"  interior X[+19,+31] Z[−26,−14]  — FLAG_EAST
  wPair(W, "wh_n_a", "eh_s_a", "wall", -41, -38, 0, 5, 9, 10);
  wPair(W, "wh_n_b", "eh_s_b", "wall", -34.5, -32, 0, 5, 9, 10);
  wPair(W, "wh_n_c", "eh_s_c", "wall", -29, -28, 0, 5, 9, 10);
  wPair(W, "wh_e_a", "eh_w_a", "wall", -29, -28, 0, 5, 10, 15);
  wPair(W, "wh_e_b", "eh_w_b", "wall", -29, -28, 0, 5, 18.5, 22);
  // D1 = X[−38,−34.5] · D2 = X[−32,−29] · D3 = Z[+15,+18.5] (and mirrors).
  // Roofs make both halls rain-occlusion volumes and give each interior its
  // own lighting zone; they start at the wall tops, so nothing interpenetrates.
  wPair(W, "wh_roof", "eh_roof", "roof", -41, -28, 5, 5.35, 9, 22);
  // The car under inspection: hard cover inside the room, and the piece that
  // keeps a ray entering D1 from crossing the whole hall.
  tramPair(W, "wh_car", "eh_car", -40, -37.2, 12, 18);

  // ===================================================== 3. THE RUNNING SHED
  // The hub: 32 × 20 m of covered interior centred on (−5, −2), so the shed
  // is its own mirror. EIGHT doors — three roller doors on each yard wall and
  // a 14 m open gable at each end — because a hub has to be enterable from
  // everywhere or it becomes a room nobody crosses. The yard doors were 4 m
  // in the first draft and every metre they gained bought G-E: shed↔yard
  // intervisibility went 3% → 10% on the first widening alone.
  wPair(W, "sh_n_a", "sh_s_a", "wall", -22, -19.5, 0, 6, -13, -12);
  wPair(W, "sh_n_b", "sh_s_b", "wall", -13, -9, 0, 6, -13, -12);
  wPair(W, "sh_n_c", "sh_s_c", "wall", -2, 2, 0, 6, -13, -12);
  wPair(W, "sh_n_d", "sh_s_d", "wall", 9, 12, 0, 6, -13, -12);
  wPair(W, "sh_w_a", "sh_e_a", "wall", -22, -21, 0, 6, -12, -10);
  wPair(W, "sh_w_b", "sh_e_b", "wall", -22, -21, 0, 6, 4, 8);
  W.push(wbox("sh_roof", "roof", -22, 12, 6, 6.45, -13, 9, "concrete", "hard"));
  // N doors X[−19.5,−13.5] X[−8.5,−2.5] X[+2.5,+8.5] (6 m roller doors)
  // S doors X[−18.5,−12] X[−7,−1.5] X[+3.5,+7.5] — the mirror set
  // W end door Z[−10,+4] (14 m) · E end door Z[−8,+6] — the gables are almost
  // all door, which is what makes apron+shed one room for G-E. They are SAFE
  // because the two openings only overlap over Z[−8,+4], and the two pit cars
  // cover exactly that band: no ray crosses the shed from apron to apron.

  // TWO cars stand over the outer inspection pits, and the middle road is
  // deliberately EMPTY. The pair is the minimum that seals the gable band
  // (Z[−8,+4], above) — a third car on the middle road was authored, measured
  // and REMOVED: it bought 0.006 percentage points of keyhole and cost 5.8
  // points of G-E, because the hub's whole job is that players inside it can
  // see each other.
  tramPair(W, "pit_car_w", "pit_car_e", -14.5, -11.7, -9, 0);
  // Gantry: legs to 4.0 m, portal beams 4.0→4.6, travelling hoist between
  // them — all of it above 1.7 m, so it dresses the volume without eating a
  // single walkable cell or blocking a single ray. The shed needs its ceiling
  // read, not more cover.
  wPair(W, "gantry_leg_nw", "gantry_leg_se", "post", -9.6, -8.8, 0, 4.0, -9.4, -8.6, "metal", "hard");
  wPair(W, "gantry_leg_ne", "gantry_leg_sw", "post", -1.2, -0.4, 0, 4.0, -9.4, -8.6, "metal", "hard");
  wPair(W, "gantry_beam_n", "gantry_beam_s", "deck", -9.6, -0.4, 4.0, 4.6, -9.4, -8.6, "metal", "metal_thin");
  W.push(wbox("gantry_hoist", "deck", -6.1, -3.9, 4.05, 4.55, -8.6, 4.6, "metal", "metal_thin"));

  // ===================================================== 4. THE STABLING YARDS
  // Each yard is TWO open cells, ~27 × 13 m, split by a walk-through signals
  // hut. That split is the G-D/G-E compromise, and it is the edit the whole
  // map turns on: the first draft filled these yards with a stabling row and
  // five crossing cars, which measured 63% <6 m rays (G-C, easy) and 48%
  // P(≥1 of 9 in LOS) — a FAIL, i.e. ten players could not find each other.
  // A cell wide enough to fight across (27 m, under the 40 m keyhole gate)
  // and open enough to see across is worth more than a lattice.
  //
  // The hut is what keeps the yard from becoming one 59 m lane: a 6 × 8.5 m
  // building on the north two thirds of the depth, with its two doors OFFSET
  // in Z so it is walkable through and no ray is. Its interior is a 4 × 7.5 m
  // CQB pocket — the yard's only tight space, and the reason crossing the
  // yard has a slow option as well as a fast one.
  wPair(W, "dv_w_a", "dv_w_am", "wall", -14, -13, 0, 4, -26, -24);
  wPair(W, "dv_w_b", "dv_w_bm", "wall", -14, -13, 0, 4, -21.5, -17.5);
  wPair(W, "dv_e_a", "dv_e_am", "wall", -9, -8, 0, 4, -26, -21);
  wPair(W, "dv_e_b", "dv_e_bm", "wall", -9, -8, 0, 4, -18.5, -17.5);
  wPair(W, "dv_s", "dv_sm", "wall", -13, -9, 0, 4, -18.5, -17.5);
  wPair(W, "dv_roof", "dv_roofm", "roof", -14, -8, 4, 4.3, -26, -17.5);
  // west door Z[−24,−21.5] · east door Z[−21,−18.5] — DISJOINT in Z, which is
  // the point: overlap them by even half a metre and the yard has a 59 m
  // keyhole straight through both (the ≥55 m gate is the one that catches it).
  // The standing car covers the depth the hut does not, far enough west that
  // a DIAGONAL west-cell↔east-cell line still exists — that offset is worth
  // ~6 points of G-E and costs nothing anywhere else.
  tramPair(W, "dv_car", "dv_carm", -24, -21.2, -17.8, -13);

  // Four stabled cars, two per cell: cover islands, not walls. Each is
  // anchored on one long edge of its cell so the cell's middle stays open
  // and the fight happens across it, not around a maze.
  tramPair(W, "ya_1", "ya_1m", -37, -34.2, -26, -20.5);
  tramPair(W, "ya_2", "ya_2m", -29, -26.2, -20, -14.5);
  tramPair(W, "ya_3", "ya_3m", -4, -1.2, -26, -20.5);
  tramPair(W, "ya_4", "ya_4m", 7, 9.8, -20, -14.5);

  // ===================================================== 5. THE APRONS
  // The two aprons are the map's flanks: each holds a boarding platform, the
  // wheel-lathe shed and one more standing car, and each opens 19 m wide onto
  // its yard and 14 m wide into the shed. That width is deliberate — apron
  // and shed have to read as one space for G-E — and the apron car is what
  // stops the pair from reading as one 40 m lane. The car also sits clear of
  // the gable doorway: parked IN it, apron↔shed visibility measured 8%.
  wPair(W, "plat_w", "plat_e", "deck", -38, -28, 0, 1.2, -5, 0);
  stepsPair(W, "plat_w_stair_n", "plat_e_stair_s", -32, -29, -7.8, -5, 4, 0.3);
  stepsPair(W, "plat_w_stair_s", "plat_e_stair_n", -35, -32, 2.8, 0, 4, 0.3);
  wPair(W, "wheel_lathe_w", "wheel_lathe_e", "wall", -41, -37, 0, 4.2, 3, 8);
  wPair(W, "throat_block_w", "throat_block_e", "wall", -28, -25, 0, 3.2, 5, 8);
  tramPair(W, "ap_car_w", "ap_car_e", -27, -24, -12, -6);

  // ======================================================== 6. PROPS
  const P = [];
  const E = { dir: [1, 0, 0] }, Wd = { dir: [-1, 0, 0] };
  const N = { dir: [0, 0, -1] }, S = { dir: [0, 0, 1] };
  const neg = (d) => ({ dir: [-d.dir[0], 0, -d.dir[2]], height: d.height });
  // Mirrored prop pair. `kinds` may be one kind or [westKind, eastKind]: the
  // FOOTPRINT is identical on both sides (so cover parity and the sightline
  // profile stay mirror-exact) while the two halves of the depot still read
  // as different rooms.
  function pPair(idA, idB, kinds, x, z, rot, sx, sz, h, surface, matClass, opts = {}) {
    const [kA, kB] = Array.isArray(kinds) ? kinds : [kinds, kinds];
    const oB = Object.assign({}, opts);
    if (opts.cover) oB.cover = neg(opts.cover);
    P.push(prop(idA, kA, x, z, rot, sx, sz, h, surface, matClass, opts));
    P.push(prop(idB, kB, mx(x), mz(z), rot + Math.PI, sx, sz, h, surface, matClass, oB));
  }

  // ---- flag-room cover, mirrored piece for piece (G-I P2: the counts must
  // be EQUAL and ≥4 within 5.5 m of each stand). Five pieces ring each flag
  // at 1.6–3.8 m, one per cardinal plus a diagonal, so no single approach
  // takes the stand without trading.
  pPair("hw_c1", "he_c1", ["fuel_drums", "crate"], -36, 13.5, 0, 1.6, 1.6, 0.95, "metal", "metal_thin",
    { cover: { ...Wd, height: "low" } });
  pPair("hw_c2", "he_c2", ["crate", "crate"], -33, 17, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...S, height: "low" } });
  pPair("hw_c3", "he_c3", ["shelving", "shelving"], -30, 13.5, 0, 0.5, 2.4, 1.9, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  pPair("hw_c4", "he_c4", ["pallet", "pallet"], -33, 10.9, 0, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...N, height: "low" } });
  pPair("hw_c5", "he_c5", ["dumpster", "shelving"], -35.5, 16.5, 0, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...Wd, height: "high" } });

  // ---- shed interior: the tool line down the pit roads. Deliberately LOW
  // (drums, pallets, benches) — the hub's job is intervisibility, so its
  // cover is crouch-height and its standing sightlines stay open.
  pPair("sh_p1", "sh_p2", ["fuel_drums", "shelving"], -19, -6, 0, 1.6, 1.6, 0.95, "metal", "metal_thin",
    { cover: { ...Wd, height: "low" } });
  pPair("sh_p3", "sh_p4", ["shelving", "pallet"], -19.5, 3, 0, 0.5, 2.4, 1.9, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  pPair("sh_p5", "sh_p6", ["crate", "fuel_drums"], -11.5, 3.5, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...S, height: "low" } });
  pPair("sh_p7", "sh_p8", ["pallet", "crate"], -9.5, -7.5, 0, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...N, height: "low" } });
  pPair("sh_p9", "sh_p10", ["bench", "bench"], -0.5, -6.5, 0, 1.8, 0.5, 0.9, "wood", "soft",
    { cover: { ...N, height: "low" } });
  pPair("sh_p11", "sh_p12", ["sandbags", "sandbags"], 8, -10, 0, 2.0, 1.0, 1.05, "dirt", "soft",
    { cover: { ...E, height: "low" } });
  pPair("sh_p13", "sh_p14", ["barrier", "barrier"], 6.5, 5.5, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...S, height: "low" } });

  // ---- apron cover, on the platform approaches
  pPair("ap_p1", "ap_p2", ["dumpster", "dumpster"], -33, -8, 0, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  pPair("ap_p3", "ap_p4", ["guard_hut", "guard_hut"], -36.5, -6.5, 0, 2.4, 2.4, 2.6, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  pPair("ap_p5", "ap_p6", ["fuel_drums", "crate"], -24.5, 0.5, 0, 1.6, 1.6, 0.95, "metal", "metal_thin",
    { cover: { ...N, height: "low" } });
  pPair("ap_p7", "ap_p8", ["sandbags", "sandbags"], -34, 4, 0, 2.0, 1.0, 1.05, "dirt", "soft",
    { cover: { ...E, height: "low" } });
  pPair("ap_p9", "ap_p10", ["transformer_pole", "transformer_pole"], -40.1, -12, 0, 1.5, 0.5, 6.5, "wood", "soft");
  pPair("ap_p11", "ap_p12", ["pallet", "shelving"], -23.6, -2, 0, 1.2, 1.0, 1.1, "wood", "soft",
    { cover: { ...E, height: "low" } });

  // ---- the platform furniture. These are the ONLY things that occlude
  // across a platform (the 1.2 m deck itself does not), so each deck gets a
  // shelter amidships and a board at the far end: that pair is what stops the
  // apron from seeing the hall door in one straight line.
  pPair("pf_shelter_w", "pf_shelter_e", ["tram_shelter", "tram_shelter"], -30, -2.5, 0, 3.4, 2.6, 2.6,
    "metal", "metal_thin", { y0: 1.2, cover: { ...E, height: "high" } });
  pPair("pf_board_w", "pf_board_e", ["route_board", "route_board"], -35, -3.9, 0, 1.8, 0.22, 2.4,
    "metal", "metal_thin", { y0: 1.2 });
  pPair("pf_ticket_w", "pf_ticket_e", ["ticket_machine", "ticket_machine"], -33.5, -1, 0, 0.8, 0.6, 1.6,
    "metal", "metal_thin", { y0: 1.2 });
  pPair("pf_bench_w", "pf_bench_e", ["bench", "bench"], -34.5, -3.4, 0, 1.8, 0.5, 0.9,
    "wood", "soft", { y0: 1.2, cover: { ...S, height: "low" } });
  pPair("pf_bin_w", "pf_bin_e", ["bin", "bin"], -36.8, -1, 0, 0.55, 0.55, 0.95,
    "metal", "metal_thin", { y0: 1.2 });

  // ---- yard cover: the pieces that make the open yard fightable rather
  // than crossable. Spread between the row-A gaps and the crossing cars, so
  // a player breaking cover always has a next piece within a sprint.
  pPair("yd_p1", "yd_p2", ["container", "container"], 2.5, -15.5, 0, 6.0, 2.4, 2.6, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });   // the map's ONLY two containers
  pPair("yd_p3", "yd_p4", ["guard_hut", "guard_hut"], -33, -15, 0, 2.4, 2.4, 2.6, "metal", "metal_thin",
    { cover: { ...E, height: "high" } });
  pPair("yd_p5", "yd_p6", ["dumpster", "crate"], -21, -21.5, 0, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...N, height: "high" } });
  pPair("yd_p7", "yd_p8", ["sandbags", "sandbags"], -11, -16.5, 0, 2.0, 1.0, 1.05, "dirt", "soft",
    { cover: { ...N, height: "low" } });
  pPair("yd_p9", "yd_p10", ["fuel_drums", "pallet"], -35.5, -17.5, 0, 1.6, 1.6, 0.95, "metal", "metal_thin",
    { cover: { ...E, height: "low" } });
  pPair("yd_p11", "yd_p12", ["crate", "fuel_drums"], -6.3, -21.5, 0, 1.4, 1.2, 1.25, "wood", "soft",
    { cover: { ...Wd, height: "low" } });
  pPair("yd_p13", "yd_p14", ["barrier", "barrier"], 5.5, -21.5, 0, 2.0, 0.6, 1.1, "concrete", "hard",
    { cover: { ...E, height: "low" } });
  pPair("yd_p15", "yd_p16", ["scaffold", "scaffold"], 13, -15.5, 0, 0.6, 3.0, 3.4, "metal", "metal_thin",
    { cover: { ...Wd, height: "high" } });
  pPair("yd_p17", "yd_p18", ["dumpster", "dumpster"], -19.5, -14.5, 0, 1.7, 1.1, 1.25, "metal", "metal_thin",
    { cover: { ...S, height: "high" } });
  pPair("yd_p19", "yd_p20", ["fuel_drums", "crate"], -32.8, -21.5, 0, 1.6, 1.6, 0.95, "metal", "metal_thin",
    { cover: { ...S, height: "low" } });
  pPair("yd_p21", "yd_p22", ["shelving", "pallet"], 16, -20, 0, 0.5, 2.4, 1.9, "metal", "metal_thin",
    { cover: { ...Wd, height: "high" } });

  // ---- dressing (no cover nodes; nothing here is load-bearing for a gate)
  pPair("dr_vent_1", "dr_vent_2", ["steam_vent", "steam_vent"], -20, -10.5, 0, 0.6, 0.6, 0.1,
    "metal", "hard", { solid: false, flags: { steam: true } });
  pPair("dr_vent_3", "dr_vent_4", ["steam_vent", "steam_vent"], 0.5, -18, 0, 0.6, 0.6, 0.1,
    "metal", "hard", { solid: false, flags: { steam: true } });
  pPair("dr_bollard_1", "dr_bollard_2", ["bollard", "bollard"], -27.5, -4, 0, 0.35, 0.35, 0.65, "metal", "hard");
  pPair("dr_bollard_3", "dr_bollard_4", ["bollard", "bollard"], -26, -1, 0, 0.35, 0.35, 0.65, "metal", "hard");
  pPair("dr_bin_1", "dr_bin_2", ["bin", "bin"], -40.3, 0.5, 0, 0.55, 0.55, 0.95, "metal", "metal_thin");

  // ======================================================== 7. NODES
  // Named standpoints the AI layer (objective.js / bot_ai) addresses. Every
  // entry is walkable, clear of solids and supported; the two platform keys
  // are the only elevated ones (y 1.2, standing on plat_w / plat_e).
  const NODES = {
    yard_west: [-31, 0, -21],
    yard_east: [21, 0, 17],
    yard_north: [-11, 0, -21.5],
    yard_south: [1, 0, 17.5],
    yard_ne: [-1, 0, -18],
    yard_sw: [-9, 0, 14],
    shed_west: [-19, 0, -2],
    shed_east: [9, 0, -2],
    shed_centre: [-5, 0, -2],
    shed_north: [-10, 0, -10.5],
    shed_south: [0, 0, 6.5],
    apron_west: [-31, 0, -10],
    apron_east: [21, 0, 6],
    platform_west: [-31, 1.2, -4],
    platform_east: [21, 1.2, 0],
    hall_west: [-34, 0, 13.5],
    hall_east: [24, 0, -17.5],
    lane_west: [-38.5, 0, -2],
    lane_east: [28.5, 0, -2],
  };

  // Reference spawn: nav flood seed + boot fallback. The runtime spawn set is
  // PROBE-EMITTED into content.json from ARENA_SPEC below — never hand-copied
  // (PVP_BUILD_PLAN Part 4.2 / the C7b regression).
  const REF_SPAWNS = {
    player: { pos: [-31, 0, -10], yaw: -Math.PI / 2 }, // west apron, faces east
  };

  // ======================================================== 8. WALK RECTS
  // Union semantics (a point is walkable if it is inside ANY rect at that y
  // and not inside a solid). Ground rects are also G-F's dead-end test:
  // every one of them touches at least two others.
  const WALK_RECTS = [
    { id: "w_yard_n", min: [-41, -26], max: [18, -13], y: 0 },
    { id: "w_yard_s", min: [-28, 9], max: [31, 22], y: 0 },
    { id: "w_apron_w", min: [-41, -13], max: [-22, 9], y: 0 },
    { id: "w_apron_e", min: [12, -13], max: [31, 9], y: 0 },
    { id: "w_shed", min: [-21, -12], max: [11, 8], y: 0 },
    { id: "w_hall_w", min: [-41, 10], max: [-29, 22], y: 0 },
    { id: "w_hall_e", min: [19, -26], max: [31, -14], y: 0 },
    // door mouths — each bridges exactly two regions
    { id: "w_shed_dn1", min: [-19.5, -13], max: [-13, -12], y: 0 },
    { id: "w_shed_dn2", min: [-9, -13], max: [-2, -12], y: 0 },
    { id: "w_shed_dn3", min: [2, -13], max: [9, -12], y: 0 },
    { id: "w_shed_ds1", min: [-19, 8], max: [-12, 9], y: 0 },
    { id: "w_shed_ds2", min: [-8, 8], max: [-1, 9], y: 0 },
    { id: "w_shed_ds3", min: [3, 8], max: [9.5, 9], y: 0 },
    { id: "w_shed_dw", min: [-22, -10], max: [-21, 4], y: 0 },
    { id: "w_shed_de", min: [11, -8], max: [12, 6], y: 0 },
    { id: "w_hall_wd1", min: [-38, 9], max: [-34.5, 10], y: 0 },
    { id: "w_hall_wd2", min: [-32, 9], max: [-29, 10], y: 0 },
    { id: "w_hall_wd3", min: [-29, 15], max: [-28, 18.5], y: 0 },
    { id: "w_hall_ed1", min: [24.5, -14], max: [28, -13], y: 0 },
    { id: "w_hall_ed2", min: [19, -14], max: [22, -13], y: 0 },
    { id: "w_hall_ed3", min: [18, -22.5], max: [19, -19], y: 0 },
    // the two platform decks (y 1.2 — excluded from the dead-end test, which
    // judges ground rects only)
    { id: "w_plat_w", min: [-38, -5], max: [-28, 0], y: 1.2 },
    { id: "w_plat_e", min: [18, -4], max: [28, 1], y: 1.2 },
  ];

  // ======================================================== 9. ZONES / ROADS
  const ZONES = {
    poi_yard_north: { min: [-41, -26], max: [18, -13] },
    poi_yard_south: { min: [-28, 9], max: [31, 22] },
    poi_shed: { min: [-22, -13], max: [12, 9] },
    poi_apron_west: { min: [-41, -13], max: [-22, 9] },
    poi_apron_east: { min: [12, -13], max: [31, 9] },
    poi_hall_west: { min: [-41, 9], max: [-28, 22] },
    poi_hall_east: { min: [18, -26], max: [31, -13] },
  };

  // Ground paint (drives the PBR sets). Non-overlapping tiling of the whole
  // arena: tram asphalt over the stabling roads, yard concrete on the aprons,
  // interior concrete under the shed roof and both halls.
  const ROADS = [
    { id: "r_yard_n", kind: "asphalt_tram", min: [-41, -26], max: [18, -13] },
    { id: "r_yard_s", kind: "asphalt_tram", min: [-28, 9], max: [31, 22] },
    { id: "r_apron_w", kind: "concrete_yard", min: [-41, -13], max: [-22, 9] },
    { id: "r_apron_e", kind: "concrete_yard", min: [12, -13], max: [31, 9] },
    { id: "r_shed", kind: "concrete_interior", min: [-22, -13], max: [12, 9] },
    { id: "r_hall_w", kind: "concrete_interior", min: [-41, 9], max: [-28, 22] },
    { id: "r_hall_e", kind: "concrete_interior", min: [18, -26], max: [31, -13] },
  ];

  // ======================================================== 10. PRACTICALS
  // Rainy-night palette, unchanged from LANTERNWALK: sodium over the yards,
  // cold fluorescent inside the shed, floods on the platforms.
  //
  // TWO KINDS ARE DELIBERATELY ABSENT, and this is not an oversight:
  //   • `skylight` — level.js's skylight arm hard-codes the arcade lightwell
  //     (a 6.2 m glow plane at (−32, 8.13, −8)); one here would paint that
  //     plane over this depot's north yard.
  //   • `neon` — the signage pass hard-codes wallFaceX = 15.5 (meridian's
  //     gallery wall), so a neon entry would grow a cabinet stretching to
  //     X = 15.5. Both are level.js limitations, flagged to the renderer lane
  //     rather than worked around with geometry here.
  // Five reals (the spot pool is fixed at 8); everything else is emissive
  // head + cone card + pool decal.
  const LIGHT_POLES = [
    { id: "L_YARD_W", pos: [-38.6, 6.0, -19], color: "#ff9a3c", kind: "sodium", real: true, aim: [-37, 0, -19], cone: 60, godRay: true },
    { id: "L_YARD_E", pos: [28.6, 6.0, 15], color: "#ff9a3c", kind: "sodium", real: true, aim: [27, 0, 15], cone: 60, godRay: true },
    { id: "L_SHED", pos: [-5, 5.6, -2], color: "#cfe0d8", kind: "fluorescent", real: true, aim: [-5, 0, -2], cone: 85 },
    { id: "L_PLAT_W", pos: [-33, 7.2, -2.5], color: "#dce8ff", kind: "flood", real: true, aim: [-33, 0, -2.5], cone: 45, godRay: true },
    { id: "L_PLAT_E", pos: [23, 7.2, -1.5], color: "#dce8ff", kind: "flood", real: true, aim: [23, 0, -1.5], cone: 45, godRay: true },
    // fakes — heads + cone cards + pool decals, zero real lights. Masts stand
    // against a wall face or a car end wherever possible (the sodium arm
    // draws a physical, collisionless pole from the ground up to pos[1]).
    { id: "fake_yard_n1", pos: [-34.8, 5.5, -25], color: "#ff9a3c", kind: "sodium", real: false, aim: [-33, 0, -25] },
    { id: "fake_yard_n2", pos: [-9.2, 5.5, -25], color: "#ff9a3c", kind: "sodium", real: false, aim: [-11, 0, -25] },
    { id: "fake_yard_n3", pos: [3.8, 5.5, -25], color: "#ff9a3c", kind: "sodium", real: false, aim: [5, 0, -25] },
    { id: "fake_yard_s1", pos: [24.8, 5.5, 21], color: "#ff9a3c", kind: "sodium", real: false, aim: [23, 0, 21] },
    { id: "fake_yard_s2", pos: [-0.8, 5.5, 21], color: "#ff9a3c", kind: "sodium", real: false, aim: [1, 0, 21] },
    { id: "fake_yard_s3", pos: [-13.8, 5.5, 21], color: "#ff9a3c", kind: "sodium", real: false, aim: [-15, 0, 21] },
    { id: "fake_shed_w", pos: [-16, 5.6, -2], color: "#cfe0d8", kind: "fluorescent", real: false },
    { id: "fake_shed_e", pos: [6, 5.6, -2], color: "#cfe0d8", kind: "fluorescent", real: false },
    { id: "fake_hall_w", pos: [-34, 4.6, 16], color: "#cfe0d8", kind: "fluorescent", real: false },
    { id: "fake_hall_e", pos: [24, 4.6, -20], color: "#cfe0d8", kind: "fluorescent", real: false },
    { id: "fake_lathe_w", pos: [-35.6, 4.6, 5.5], color: "#dce8ff", kind: "flood", real: false, aim: [-34, 0, 5.5] },
    { id: "fake_lathe_e", pos: [25.6, 4.6, -9.5], color: "#dce8ff", kind: "flood", real: false, aim: [24, 0, -9.5] },
    // the depot's colour accent: the substation transformer wash, west + east
    { id: "fake_sub_w", pos: [-39.4, 4.2, -11], color: "#4adcd6", kind: "neon_bounce", real: false },
    { id: "fake_sub_e", pos: [29.4, 4.2, 7], color: "#4adcd6", kind: "neon_bounce", real: false },
  ];

  // Terrain: flat depot slab. The canal record is kept OUT of the arena at
  // its campaign z (54) so colliders.groundY and computePlacements keep their
  // signatures and behaviour byte-for-byte.
  const TERRAIN = {
    base: 0,
    canal: { zMin: 54, y: -1.5 },
    heroPuddles: [
      { pos: [-26, -8], r: 3.0 }, { pos: [16, 4], r: 3.0 },
      { pos: [-12, -19], r: 2.6 }, { pos: [2, 15], r: 2.6 },
    ],
  };

  return {
    buildings: [],   // standalone map: every mass is an explicit wall box
    walls: W,
    props: P,
    roads: ROADS,
    terrain: TERRAIN,
    zones: ZONES,
    lightPoles: LIGHT_POLES,
    nodes: NODES,
    refSpawns: REF_SPAWNS,
    walkRects: WALK_RECTS,
    bounds: BOUNDS,
    seed,
    mapId: "switchyard",
  };
}

// ===========================================================================
// ARENA_SPEC — the spawn/flag contract tools/probe_arena.mjs measures and
// emits from (content.json is probe-emitted, never hand-written).
//
// Yaw convention (forward = (−sin yaw, −cos yaw)):
//   +X → −π/2 · −X → +π/2 · +Z (south) → π · −Z (north) → 0
// Sides follow the 180° symmetry: the WEST team owns the south-west half
// (car hall A, the south yard, the west apron), the EAST team the north-east
// half. The shed is the neutral middle and is FFA-only.
// ===========================================================================
export const ARENA_SPEC = {
  id: "switchyard",
  clusterMeta: {
    // west team — inward is toward the depot centre (−5, −2)
    SC_HALL_W: { inward: -Math.PI / 4, node: "hall_west", side: "west" },      // (+X,−Z)
    SC_YARD_S: { inward: 0, node: "yard_south", side: "west" },                // −Z
    SC_APRON_W: { inward: -Math.PI / 2, node: "apron_west", side: "west" },    // +X
    // east team
    SC_HALL_E: { inward: (3 * Math.PI) / 4, node: "hall_east", side: "east" }, // (−X,+Z)
    SC_YARD_N: { inward: Math.PI, node: "yard_north", side: "east" },          // +Z
    SC_APRON_E: { inward: Math.PI / 2, node: "apron_east", side: "east" },     // −X
    // neutral middle
    SC_SHED: { inward: null, node: "shed_centre", side: "mid", modes: ["ffa"] },
  },
  // [id, x, z, cluster, modes] — modes null = all three.
  // Points inside a hall (or with a line into their own stand from under
  // 10 m) are ["tdm","ffa"] only: CTF cannot respawn a defender on top of his
  // own flag (V8/V9 — the pattern lanternwalk's sp_l1..l4 established).
  spawnSeeds: [
    // ---- SC_HALL_W (9: 3 in-hall TDM/FFA + 6 CTF-legal on the approaches)
    ["sp_hw1", -38.5, 20.3, "SC_HALL_W", ["tdm", "ffa"]],
    ["sp_hw2", -34, 20.3, "SC_HALL_W", ["tdm", "ffa"]],
    ["sp_hw3", -30.5, 17.5, "SC_HALL_W", ["tdm", "ffa"]],
    ["sp_hw4", -32.5, 2.5, "SC_HALL_W", null],
    ["sp_hw5", -24, 3, "SC_HALL_W", null],
    ["sp_hw6", -22, 10, "SC_HALL_W", null],
    ["sp_hw7", -19, 18, "SC_HALL_W", null],
    ["sp_hw8", -15, 15, "SC_HALL_W", null],
    ["sp_hw9", -12.5, 20, "SC_HALL_W", null],
    // ---- SC_YARD_S (7) — the mirrored stabling yard, the west team's rotation
    ["sp_ys1", -6, 14.5, "SC_YARD_S", null],
    ["sp_ys2", -24, 20, "SC_YARD_S", null],
    ["sp_ys3", 6, 14.5, "SC_YARD_S", null],
    ["sp_ys4", 11, 20, "SC_YARD_S", null],
    ["sp_ys5", 14.5, 15.5, "SC_YARD_S", null],
    ["sp_ys6", 22, 19, "SC_YARD_S", null],
    ["sp_ys7", 28, 13.5, "SC_YARD_S", null],
    // ---- SC_APRON_W (7)
    ["sp_aw1", -39.5, -9.5, "SC_APRON_W", null],
    ["sp_aw2", -34, -10.5, "SC_APRON_W", null],
    ["sp_aw3", -28.5, -10, "SC_APRON_W", null],
    ["sp_aw4", -39.5, 0.5, "SC_APRON_W", null],
    ["sp_aw5", -34.5, 6.5, "SC_APRON_W", null],
    ["sp_aw6", -24, -4, "SC_APRON_W", null],
    // ---- SC_HALL_E (9) — exact mirror of SC_HALL_W
    ["sp_he1", 28.5, -24.3, "SC_HALL_E", ["tdm", "ffa"]],
    ["sp_he2", 24, -24.3, "SC_HALL_E", ["tdm", "ffa"]],
    ["sp_he3", 20.5, -21.5, "SC_HALL_E", ["tdm", "ffa"]],
    ["sp_he4", 22.5, -6.5, "SC_HALL_E", null],
    ["sp_he5", 14, -7, "SC_HALL_E", null],
    ["sp_he6", 12, -14, "SC_HALL_E", null],
    ["sp_he7", 9, -22, "SC_HALL_E", null],
    ["sp_he8", 5, -19, "SC_HALL_E", null],
    ["sp_he9", 2.5, -24, "SC_HALL_E", null],
    // ---- SC_YARD_N (7) — mirror of SC_YARD_S
    ["sp_yn1", -4, -18.5, "SC_YARD_N", null],
    ["sp_yn2", 14, -24, "SC_YARD_N", null],
    ["sp_yn3", -16, -18.5, "SC_YARD_N", null],
    ["sp_yn4", -21, -24, "SC_YARD_N", null],
    ["sp_yn5", -24.5, -19.5, "SC_YARD_N", null],
    ["sp_yn6", -32, -23, "SC_YARD_N", null],
    ["sp_yn7", -38, -17.5, "SC_YARD_N", null],
    // ---- SC_APRON_E (7) — mirror of SC_APRON_W
    ["sp_ae1", 29.5, 5.5, "SC_APRON_E", null],
    ["sp_ae2", 24, 6.5, "SC_APRON_E", null],
    ["sp_ae3", 18.5, 6, "SC_APRON_E", null],
    ["sp_ae4", 29.5, -4.5, "SC_APRON_E", null],
    ["sp_ae5", 24.5, -10.5, "SC_APRON_E", null],
    ["sp_ae6", 14, 0, "SC_APRON_E", null],
    // ---- SC_SHED (6, FFA only) — the neutral middle
    ["sp_sh1", -19, -10, "SC_SHED", ["ffa"]],
    ["sp_sh2", -12, 5.5, "SC_SHED", ["ffa"]],
    ["sp_sh3", -8, -4, "SC_SHED", ["ffa"]],
    ["sp_sh4", 0, -2, "SC_SHED", ["ffa"]],
    ["sp_sh5", 9, 5.5, "SC_SHED", ["ffa"]],
    ["sp_sh6", 0, -10.5, "SC_SHED", ["ffa"]],
  ],
  // The two flag stands, 180° mirrors about (−5, −2).
  flagWest: [-33, 0, 13.5],
  flagEast: [23, 0, -17.5],
  vetoOverrides: { v1M: 12.0, v2LosM: 25.0, v3ConeM: 20.0 },
};

export default { buildLayout, ARENA_SPEC };
