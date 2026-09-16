// tools/probe_arena.mjs [W4] — PVP arena acceptance gates G-A…G-K
// (PVP_BUILD_PLAN Part 4.1 row W4; arena.md Part 6). THREE-free, Node.
//
// Promotion of _design/pvp/arena_probe.mjs: measures the BUILT arena
// (core/level/maps/<mapId>.js via buildCollidersFor) instead of an inline
// edit list, gates every measurement, and exits non-zero on any FAIL.
//
//   node tools/probe_arena.mjs                      → lanternwalk, gates, 0/1
//   node tools/probe_arena.mjs --map=switchyard     → any registered arena
//   node tools/probe_arena.mjs --map=<id> --gen=2   → the GEN-2 threshold set
//     (doubled-density arenas — see THRESHOLD TABLE below). GEN-1 is the
//     DEFAULT and stays the certification gate until every map is migrated.
//     --emit must be run under the SAME --gen the map is certified at: the
//     spawn search itself reads gen-scoped numbers (spawnLongestM), so the
//     emitted spawn table is gen-specific.
//   node tools/probe_arena.mjs --map=<id> --emit    → gates green ⇒ write the
//     MEASURED spawnPoints / clusters / flags / arena blocks into
//     content.json, under content.arenas[<id>] AND (when <id> is the arena
//     the flat keys currently hold, or the only arena in the registry) the
//     flat content.arena/clusters/spawnPoints/flags the match layer reads
//     (Part 4.2: spawn data is PROBE-EMITTED, never hand-copied — C7b
//     happened once already). Emit is refused while any gate fails.
//
// [multi-arena amendment] The probe used to hardcode LANTERNWALK three ways:
// buildCollidersFor("lanternwalk"), a static lane-graph import, and three
// top-level data constants (CLUSTER_META, the ~50 spawn seeds, FLAG_WEST/
// FLAG_EAST). All three are now map-driven: the geometry and lane graph come
// from <mapId>, and the data constants come from the ARENA_SPEC export the
// map module owns (core/level/maps/lanternwalk.js, bottom of file). Every
// gate's logic and thresholds are unchanged — only their INPUTS moved.
//
// Also validates the lane graph (core/level/lanes/<mapId>.js) against the
// five Part 3.9 contract properties — the graph is W4 data, so its gate lives
// with W4's probe.

import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { spawnSync } from "node:child_process";
import { buildCollidersFor } from "../core/level/colliders.js";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const ARGV = process.argv.slice(2);
const EMIT = ARGV.includes("--emit");
const numArg = (name, dflt) => {
  const a = ARGV.find((v) => v.startsWith(`--${name}=`));
  return a ? Number(a.split("=")[1]) : dflt;
};
const LOS_TRIALS = numArg("losTrials", 24000);
const LOS_SEED = numArg("losSeed", 12345);
// --map=<id> (default lanternwalk, so every existing invocation is unchanged)
const MAP_ID = (ARGV.find((a) => a.startsWith("--map=")) || "--map=lanternwalk").slice(6);
if (!MAP_ID) { console.error("usage: node tools/probe_arena.mjs [--map=<id>] [--gen=1|2] [--emit]"); process.exit(2); }
// --gen=<1|2> selects the threshold set. Default 1 — the shipped arenas are
// certified against it and it must stay the default until every map migrates.
const GEN = Number((ARGV.find((a) => a.startsWith("--gen=")) || "--gen=1").slice(6));
if (GEN !== 1 && GEN !== 2) { console.error(`probe_arena: --gen=${GEN} unknown (1 or 2)`); process.exit(2); }

// Map module + lane graph are dynamic: which arena runs is an argument now.
// A missing module is a HARD stop with the reason named — the probe measures
// a real build or it measures nothing (arch 1.6 rule: fail loudly, not empty).
let MAPMOD, LANES;
try {
  MAPMOD = await import(`../core/level/maps/${MAP_ID}.js`);
} catch (e) {
  console.error(`probe_arena: cannot load core/level/maps/${MAP_ID}.js — ${(e && e.message) || e}`);
  process.exit(2);
}
try {
  LANES = (await import(`../core/level/lanes/${MAP_ID}.js`)).default;
} catch (e) {
  console.error(`probe_arena: cannot load core/level/lanes/${MAP_ID}.js — ${(e && e.message) || e}`);
  process.exit(2);
}
const SPEC = MAPMOD.ARENA_SPEC;
if (!SPEC || !SPEC.clusterMeta || !SPEC.spawnSeeds || !SPEC.flagWest || !SPEC.flagEast) {
  console.error(`probe_arena: core/level/maps/${MAP_ID}.js exports no usable ARENA_SPEC ` +
    `{id, clusterMeta, spawnSeeds, flagWest, flagEast, vetoOverrides} — see lanternwalk.js for the shape`);
  process.exit(2);
}

const C = buildCollidersFor(MAP_ID, 1);
const boxes = C.boxes;
const AB = { x0: C.bounds.min[0], x1: C.bounds.max[0], z0: C.bounds.min[2], z1: C.bounds.max[2] };

// ===========================================================================
// MAP-SPECIFIC INPUTS — everything below this block is generic measurement.
// The four required fields come straight off ARENA_SPEC; the optional `gates`
// / `flagMeta` fields carry the handful of constants that used to be written
// into the gate bodies as LANTERNWALK literals. Each has a generic fallback so
// a new arena's spec can omit it, but an arena whose gate numbers were tuned
// against a specific value should state it (lanternwalk does).
// ===========================================================================
const ALL = ["tdm", "ctf", "ffa"];
const CLUSTER_META = SPEC.clusterMeta;
const SP = SPEC.spawnSeeds;              // [id, x, z, clusterId, modes|null]
const FLAG_WEST = SPEC.flagWest, FLAG_EAST = SPEC.flagEast;
const VETO = SPEC.vetoOverrides || { v1M: 12.0, v2LosM: 25.0, v3ConeM: 20.0 };
const G = SPEC.gates || {};
// bounds centre — the fallback "somewhere in the middle" for maps that do not
// pin their own. Never used by lanternwalk (its spec pins both).
const CENTRE = [(AB.x0 + AB.x1) / 2, (AB.z0 + AB.z1) / 2];
// flood-fill origin: the traversal ORDER of the walkable component seeds
// G-C/G-D's `sample()` and G-E's PRNG walk, so it is pinned per map, not
// derived — moving it re-orders `reach` and moves every downstream number.
const NAV_SEED = G.navSeed || G.mid || CENTRE;
// "middle of the arena": G-I P3's path origin and the inward-yaw target for
// side:"mid" clusters (which have inward:null).
const MID = G.mid || CENTRE;
// surface the 0.5 m GROUND grid cannot see (arena.md §4.1 — lanternwalk's
// arcade balcony ring ≈250 m²). Added to G-B's per-actor surface.
const BALCONY_M2 = G.balconyAreaM2 != null ? G.balconyAreaM2 : 0;
// CTF halves, derived from each cluster's own `side` — no map-specific list.
const WSIDE = Object.keys(CLUSTER_META).filter((k) => CLUSTER_META[k].side === "west");
const ESIDE = Object.keys(CLUSTER_META).filter((k) => CLUSTER_META[k].side === "east");
// TDM home clusters (G-J parity). Fallback = each side's whole cluster set.
const TDM_HOME_W = G.tdmHomeWest || WSIDE;
const TDM_HOME_E = G.tdmHomeEast || ESIDE;
// flag identity half; the home position always comes from flagWest/flagEast.
const FLAG_META = SPEC.flagMeta || [
  { id: "flag_amber", team: 0, node: (CLUSTER_META[WSIDE[0]] || {}).node || null, standR: 1.2, standH: 2.5 },
  { id: "flag_slate", team: 1, node: (CLUSTER_META[ESIDE[0]] || {}).node || null, standR: 1.2, standH: 2.5 },
];

// ===========================================================================
// ACTOR COUNT — read from the ROSTER, never a literal.
// ===========================================================================
// G-B used to divide by a hardcoded 10, which made it "G-A ÷ 10" and therefore
// structurally incapable of failing anything G-A already passed. The divisor
// is the match's actual actor count: every bot in content.botRoster plus the
// human (core/match/roster.js — "The human is always actorId 0"), and
// core/match/contract.js:54 hard-fails any content whose botRoster.length !==
// 9, so a repo where this read fails is a repo whose match content is already
// invalid. Hard stop with the reason named rather than a silent fallback to
// 10 — the silent 10 IS the defect being removed here.
let ACTORS;
{
  let roster = null;
  try {
    roster = JSON.parse(fs.readFileSync(path.join(ROOT, "content.json"), "utf8")).botRoster;
  } catch (e) {
    console.error(`probe_arena: cannot read content.json for the bot roster — ${(e && e.message) || e}`);
    process.exit(2);
  }
  if (!Array.isArray(roster) || roster.length === 0) {
    console.error("probe_arena: content.botRoster missing or empty — G-B's per-actor divisor has no source " +
      "(core/match/contract.js requires botRoster.length === 9)");
    process.exit(2);
  }
  ACTORS = roster.length + 1; // + the human (roster.js: actorId 0 is always the player)
}

// ===========================================================================
// THRESHOLD TABLE — GEN-1 (shipped, DEFAULT) and GEN-2 (doubled density).
// ===========================================================================
// Both sets live here so the old numbers stay auditable next to the new ones.
// GEN-1 is byte-for-byte the set the three shipped arenas were certified
// against; nothing in it moved. GEN-2 is the doubled-density set — it is NOT
// yet the default and no map passes it today (that is the point: its failures
// are the work order).
//
// MEASURED GEN-1 BASELINE (this probe, 2026-09-16, all three arenas PASS every
// GEN-1 gate — the numbers every threshold below is argued from):
//
//                           lanternwalk  switchyard   saltmarket
//   walkable ground            2570        2730        2488   m²
//   per-actor (incl. balcony)   282         273         283   m²
//   AABB                     73.0×49.1    74×50       66×50
//   <6 m rays                  48.2%       46.9%       48.4%
//   <15 m rays                 80.0%       82.1%       77.0%
//   15–40 m rays               19.2%       17.5%       21.7%
//   ≥40 m rays                 0.77%       0.45%       1.24%
//   ≥55 m rays                0.028%      0.020%      0.020%
//   longest sampled ray        65.8 m      72.0 m      61.3 m
//   nearest-of-9 p10            3.54 m      3.61 m      3.20 m
//   nearest-of-9 med/p90    9.7/18.6 m  9.5/19.9 m  8.9/17.1 m
//   P(≥1 of 9 in LOS)          75.9%       72.6%       74.1%
//   largest open region        42.2%       45.7%       53.4%  of floor
//   spawn points                 50          50          50   (gen-1 CEILING)
//
// THE SHAPE OF THE GEN-1 SET, AND WHY IT CANNOT BE SCALED NAIVELY
// Every gen-1 distance clause is ONE-SIDED, and the two sides point the same
// way: G-C is floors only (≥40% of rays under 6 m, ≥70% under 15 m) and G-E is
// ceilings only (nearest-of-9 median ≤12, p90 ≤22) plus a FLOOR on being seen
// (P(≥1 in LOS) ≥70%). A phone booth satisfies all five by construction, and
// nothing in gen-1 can fail a map for being too cramped or too exposed. GEN-2
// turns each of those one-sided clauses into a BAND.
//
// THE LINEAR SCALE. GEN-2 targets 5500–6300 m² of ground against gen-1's
// 2400–2800: the area ratio is ~2.3× at the midpoints, and √2 ≈ 1.414 is the
// LINEAR scale of a doubled area. Distances that are properties of the MAP's
// size (sightline tails, nearest-enemy spreads) are scaled by it and say so.
// Distances that are properties of a WEAPON's range (the 6 m / 15 m / 40 m
// engagement bands in G-C) are NOT scaled — a rifle does not know how big the
// map is — so those band edges are identical in both sets and only their
// required SHARES move.
const THRESHOLDS = {
  1: {
    label: "GEN-1 (shipped arenas — certification default)",
    // G-A — unchanged: the three shipped arenas measure 2488–2730 m².
    groundMin: 2400, groundMax: 2800,
    // scale-free, and the only clause that catches a walled-off region.
    strayMax: 60,
    // G-B — unchanged band; the divisor is now the roster (10), same value.
    perActorMin: 250, perActorMax: 320,
    // G-C — floors only. Shipped: 46.9–48.4% under 6 m, 77.0–82.1% under 15 m.
    u6Min: 40, u6Max: null, u15Min: 70, u15Max: null, midMin: null,
    // G-D — ray cap 90 m clears switchyard's 89.3 m AABB diagonal by 0.6 m.
    rayCapM: 90,
    // tails, longest-first. `note` reproduces arena.md's R3 convention.
    dTails: [
      { m: 55, max: 0.05, cmp: "<", dp: 3, note: ", R3 keyholes accepted" },
      { m: 40, max: 1.5, cmp: "≤", dp: 2 },
    ],
    longestMaxM: null,          // no clause — and the 90 m ray cap could not measure one
    spawnLongestM: 40,          // placePoint rejects any candidate with a ≥40 m ray
    spawnLongMax: 0,            // …and G-D requires zero survivors
    spawnRelaxFallback: false,  // no candidate ⇒ unplaced (G-G fails)
    // G-E — ceilings on distance, FLOOR on being seen. Shipped: 72.6–75.9%.
    eP10Min: null, eMedMin: null, eMedMax: 12, eP90Max: 22,
    ePlMin: 70, ePlMax: null,
    // G-G — shipped arenas all sit AT the 50 ceiling.
    spawnMin: 40, spawnMax: 50, clusterBboxMin: 110, clusterPairMin: 14,
    // G-HUB — not gated in gen-1 (measured: 42.2 / 45.7 / 53.4%).
    hubShareMin: null, hubOpenR: 1.5, hubDominance: null,
  },
  2: {
    label: "GEN-2 (doubled density — not yet the default)",
    // ---- G-A ---------------------------------------------------------
    // Owner target. 5500–6300 m² is >2× the largest shipped arena (2730) and
    // lands per-actor in CS2-Dust2 territory rather than CoD-Shipment's.
    groundMin: 5500, groundMax: 6300,
    // UNCHANGED ON PURPOSE: stray area is scale-free (it is an absolute m² of
    // unreachable floor, not a share), and it is the only clause that catches
    // a walled-off region — precisely the failure an expansion invents.
    strayMax: 60,
    // ---- G-B ---------------------------------------------------------
    // Owner target. This is NOT G-A ÷ ACTORS: the two bands bite at different
    // corners, because G-B adds the off-grid elevated surface and divides by
    // the real roster. Worked corners at ACTORS=10: ground 6300 + 700 m² of
    // balcony passes G-A and fails G-B at 700; ground 5500 with no balcony
    // passes G-A and fails G-B at 550. A roster change (11 actors) moves G-B
    // and leaves G-A untouched — that is the independence gen-1 lacked.
    perActorMin: 560, perActorMax: 700,
    // ---- G-C ---------------------------------------------------------
    // Band edges NOT scaled (weapon ranges, not map sizes); shares rebalanced.
    // <6 m becomes a BAND: the gen-1 ≥40% floor with no ceiling literally
    // reads "make it bigger and equally cramped". 25% floor keeps room-fighting
    // real; the 45% ceiling sits below all three shipped maps (46.9/48.4) so a
    // doubled map that kept today's mix fails it.
    u6Min: 25, u6Max: 45,
    // <15 m flips from a ≥70% floor to a 50–70% band — 70 is now the CEILING
    // it used to be the floor of. Shipped maps run 77.0–82.1%, i.e. four rays
    // in five die inside 15 m; that is the shooting gallery in raw form.
    u15Min: 50, u15Max: 70,
    // the layer all three maps lack: 15–40 m measures 17.5–21.7% today.
    // 28% floor is arithmetically reachable with the two bands above (e.g.
    // u6 30 + 6–15 m 32 + mid 34 + tail 4 = 100), and ~+7 pts on the best
    // shipped map — a real mid-range layer, not a rounding of today's.
    midMin: 28, midLoM: 15, midHiM: 40,
    // ---- G-D ---------------------------------------------------------
    // 140 m ray cap. NON-OPTIONAL: gen-1's cap is 90 m, a 2× map's AABB
    // diagonal is ~124 m (e.g. 103×69), so under the old cap every long
    // diagonal would SATURATE at 90 and both the 78 m tail clause and the
    // 95 m ceiling below would be unfalsifiable. 140 > any 2× diagonal.
    rayCapM: 140,
    // The two tail distances are map-size properties ⇒ ×1.414: 40→55, 55→78.
    // Their ALLOWANCES are unchanged because they are tail FRACTIONS, not
    // areas. Third clause is new: ≥40 m ≤8% is the explicit ceiling on the
    // long-lane layer that the scaled tails no longer supply (a doubled map
    // may legitimately run ~1 ray in 12 out to 40–55 m; 1 in 5 is a field).
    dTails: [
      { m: 78, max: 0.05, cmp: "<", dp: 3, note: ", R3 keyholes accepted" },
      { m: 55, max: 1.5, cmp: "≤", dp: 2 },
      { m: 40, max: 8.0, cmp: "≤", dp: 2 },
    ],
    // hard ceiling on the LONGEST ray anywhere (owner: "around 95"). Shipped
    // maps measure 61.3–72.0 m; a 2× map whose diagonal is ~124 m must break
    // every line before 95 m or it is a sniper alley regardless of the tails.
    longestMaxM: 95,
    // ---- spawn exposure: the clause that fights the expansion -----------
    // placePoint (see below) REJECTS any spawn candidate whose longest ray
    // reaches spawnLongestM. At 40 m on a doubled map that rejects most of the
    // map and drives every spawn back into the cramped pockets the expansion
    // exists to escape — the gate would manufacture the defect it grades. Two
    // changes: the limit scales with everything else (40→55), and a candidate
    // that fails ONLY this test is no longer discarded — the least-exposed one
    // is kept (spawnRelaxFallback) so the failure surfaces as a NAMED spawn in
    // G-D instead of an "unplaced" in G-G, which is a usable work order.
    spawnLongestM: 55,
    // ≤2 of a 70–100 point set (≈3%) is the same "keyholes are exceptional,
    // not forbidden" convention G-D's ≥78 m clause already runs on. A hard
    // zero plus a 4 m nudge budget is what forces spawns into caves.
    spawnLongMax: 2,
    spawnRelaxFallback: true,
    // ---- G-E — the central fix -----------------------------------------
    // P(≥1 of 9 in LOS) becomes a BAND. The gen-1 ≥70% floor certifies that
    // 70%+ of the time you stand anywhere, someone can see you — the owner
    // complaint written as a requirement. Where the band comes from: with 9
    // opponents, P(≥1 seen) = 1−(1−p)⁹ for pairwise visibility p. The shipped
    // maps average 74.2% ⇒ p ≈ 0.140. Pairwise visibility falls roughly with
    // the area you are NOT in, so doubling the floor halves p ⇒ p ≈ 0.070 ⇒
    // P ≈ 48%. So a FAITHFUL 2× expansion of today's geometry measures ~48%:
    // the 35–60 band brackets that with ±13 points of authoring room, ten
    // times the gate's own ±1.2-point Monte-Carlo SE (saltmarket.js:38-42).
    // 35 is the ghost-town floor (someone in LOS every ~3 respawns), 60 is
    // 12+ points under every shipped map, so all three fail the ceiling.
    ePlMin: 35, ePlMax: 60,
    // FLOOR on nearest-enemy distance — gen-1 has none, so nothing can fail
    // the 3.2–3.6 m p10 the shipped maps measure (1 respawn in 10 puts the
    // nearest enemy inside 3.5 m). Derivation: for 10 uniform actors on area
    // A, P(nearest-of-9 > r) = (1 − πr²/A)⁹, giving p10 = 4.7 m / med = 11.8 m
    // / p90 = 20.6 m at A = 5900 m². The shipped maps run 1.15× / 1.25× /
    // 1.37× their own uniform prediction (walls and elongation), so a 2× map
    // of the same style lands at p10 ≈ 5.4, med ≈ 14.7, p90 ≈ 28.2 m.
    // Thresholds are set just outside those: a 5.0 m p10 floor fails only a
    // map that re-created today's pockets, and it is ~1 s of sprint — the
    // shortest distance at which a respawn is survivable.
    eP10Min: 5.0,
    // median becomes a BAND: the ≤12 ceiling is kept in spirit at 18 (12 ×
    // 1.414 ≈ 17), and the new floor of 10 fails a map whose actors are
    // jammed into a fraction of the floor it claims to have.
    eMedMin: 10, eMedMax: 18,
    // p90 ceiling scaled: 22 × 1.414 ≈ 31, rounded to 32 over the 28.2 m
    // prediction. Still a real ceiling — it is what keeps the map from going
    // dead now that the LOS floor no longer does that job.
    eP90Max: 32,
    // ---- G-G ---------------------------------------------------------
    // All three arenas sit AT gen-1's ceiling of 50 with zero headroom, so
    // gen-1 literally cannot accept a map with more territory to spawn in.
    // 70 floor = ~7 per cluster across a 7+ cluster map (gen-1's 40 was ~6);
    // 100 ceiling = 2× gen-1's, and the ceiling now sits 43% above the floor
    // instead of gen-1's 25%, which is where the headroom for new territory
    // comes from. The per-mode ≥6-per-cluster rule is deliberately NOT
    // scaled — it is a mode-eligibility minimum (the C7b regression stopper),
    // not a density number.
    spawnMin: 70, spawnMax: 100,
    // cluster spread scales with the map: 110 m² → 220 m² (area ×2), 14 m →
    // 20 m (14 × 1.414). A cluster that stays 14 m wide on a doubled map is a
    // pocket, and a pocket is exactly what spawn-camping wants.
    clusterBboxMin: 220, clusterPairMin: 20,
    // ---- G-HUB (new) --------------------------------------------------
    // core/level/maps/saltmarket.js:24-31 states the mechanism: "the
    // mutual-visibility probability between two random points scales with the
    // SQUARE of the largest open region's share of the floor", and records
    // that the first (warren) build of that map measured P(≥1 in LOS) 36.1%
    // until a dominant 53.8% hall was put in. Doubling the floor is the single
    // most likely way to turn a map back into a warren — twice the corridors,
    // no bigger room — and because the relationship is SQUARED, a share that
    // slips from 45% to 30% costs more than half the mutual visibility.
    // MEASURE: cells whose distance to the nearest blocker is ≥1.5 m (the same
    // clearance the spawn placer demands), 4-connected, largest component as a
    // share of walkable floor. Validation that this measures what the author
    // meant: it returns 1328 m² / 53.4% on saltmarket against that file's own
    // "1339 of 2488 m², 53.8%" — the same hall, independently measured.
    hubOpenR: 1.5,
    // 40% floor = the WEAKEST shipped map (lanternwalk 42.2%, and it is the
    // one that clears G-E most comfortably at 75.9%). Asking a doubled map for
    // no less than the weakest proven map catches warren-ification without
    // demanding more than a shipped map delivers; at a 5500–6300 m² floor it
    // also means ≥2200 m² of genuinely open room, ≈ today's ENTIRE arena.
    hubShareMin: 40,
    // "DOMINANT", not merely "large": two equal halls of share s/2 deliver
    // 2·(s/2)² = s²/2 — half the mutual visibility of one hall of share s.
    // Shipped maps clear this by 8.7× / 39× / 64×, so it only ever bites the
    // split-the-map-in-two expansion, which is the expansion under discussion.
    hubDominance: 2.0,
  },
};
const T = THRESHOLDS[GEN];
// band text: renders one-sided bands exactly as the gen-1 gate lines did.
const band = (lo, hi) => (lo == null ? `≤${hi}` : hi == null ? `≥${lo}` : `${lo}–${hi}`);
const inBand = (v, lo, hi) => (lo == null || v >= lo) && (hi == null || v <= hi);

// ------------------------------------------------------------ gate ledger
let anyFail = false;
function gate(id, ok, detail) {
  const tag = ok ? "PASS" : "FAIL";
  if (!ok) anyFail = true;
  console.log(`[${tag}] ${id}  ${detail}`);
}
function note(s) { console.log(`       ${s}`); }

// ---------------------------------------------------------- spatial bucket
const BK = 6;
const bx = Math.ceil((AB.x1 - AB.x0) / BK) + 2, bz = Math.ceil((AB.z1 - AB.z0) / BK) + 2;
const buckets = Array.from({ length: bx * bz }, () => []);
function bidx(x, z) {
  const i = Math.max(0, Math.min(bx - 1, Math.floor((x - AB.x0) / BK)));
  const j = Math.max(0, Math.min(bz - 1, Math.floor((z - AB.z0) / BK)));
  return j * bx + i;
}
for (const b of boxes) {
  const i0 = Math.max(0, Math.floor((b.min[0] - AB.x0) / BK)), i1 = Math.min(bx - 1, Math.floor((b.max[0] - AB.x0) / BK));
  const j0 = Math.max(0, Math.floor((b.min[2] - AB.z0) / BK)), j1 = Math.min(bz - 1, Math.floor((b.max[2] - AB.z0) / BK));
  if (i1 < 0 || j1 < 0 || i0 > bx - 1 || j0 > bz - 1) continue;
  for (let j = Math.max(0, j0); j <= j1; j++) for (let i = Math.max(0, i0); i <= i1; i++) buckets[j * bx + i].push(b);
}
function blockedAt(x, z, y) {
  for (const b of buckets[bidx(x, z)]) {
    if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] &&
        b.min[1] <= y && b.max[1] >= y) return true;
  }
  return false;
}
function walkable(x, z) {
  if (x < AB.x0 || x > AB.x1 || z < AB.z0 || z > AB.z1) return false;
  for (const b of buckets[bidx(x, z)]) {
    if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] &&
        b.min[1] < 1.7 && b.max[1] > 0.42) return false;
  }
  return true;
}

// ------------------------------------------------------------ walkable grid
const CELL = 0.5;
const pts = [];
for (let x = AB.x0 + CELL / 2; x < AB.x1; x += CELL)
  for (let z = AB.z0 + CELL / 2; z < AB.z1; z += CELL)
    if (walkable(x, z)) pts.push([x, z]);
const key = (x, z) => `${Math.round((x - AB.x0) / CELL)},${Math.round((z - AB.z0) / CELL)}`;
const set = new Map(); for (const p of pts) set.set(key(p[0], p[1]), p);
const seedPt = pts.reduce((a, p) =>
  (Math.hypot(p[0] - NAV_SEED[0], p[1] - NAV_SEED[1]) < Math.hypot(a[0] - NAV_SEED[0], a[1] - NAV_SEED[1]) ? p : a), pts[0]);
const seen = new Set([key(seedPt[0], seedPt[1])]); const q = [seedPt];
while (q.length) {
  const [x, z] = q.pop();
  for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]]) {
    const k = key(x + dx, z + dz);
    if (set.has(k) && !seen.has(k)) { seen.add(k); q.push(set.get(k)); }
  }
}
const reach = [...seen].map((k) => set.get(k));
const reachKeys = seen;
const groundArea = reach.length * CELL * CELL;
const strayArea = (pts.length - reach.length) * CELL * CELL;

// -------------------------------------------------------------- raycasting
// cap comes from the threshold table: gen-1's 90 m clears switchyard's 89.3 m
// AABB diagonal, but a 2× map's diagonal is ~124 m and would silently SATURATE
// at 90, hiding every long ray behind the instrument (gen-2 uses 140).
function ray(x, z, dx, dz, y, cap = T.rayCapM) {
  const step = 0.25;
  for (let t = step; t <= cap; t += step) {
    const px = x + dx * t, pz = z + dz * t;
    if (px < AB.x0 || px > AB.x1 || pz < AB.z0 || pz > AB.z1) return t;
    if (blockedAt(px, pz, y)) return t;
  }
  return cap;
}
function profile(points, y = 1.6, nDir = 72) {
  const all = [], maxes = [];
  for (const [x, z] of points) {
    let m = 0;
    for (let i = 0; i < nDir; i++) {
      const a = (i / nDir) * Math.PI * 2;
      const d = ray(x, z, Math.cos(a), Math.sin(a), y);
      all.push(d); if (d > m) m = d;
    }
    maxes.push(m);
  }
  return { all: all.sort((a, b) => a - b), maxes: maxes.sort((a, b) => a - b) };
}
const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
function sample(arr, n) {
  const out = []; const st = Math.max(1, Math.floor(arr.length / n));
  for (let i = 0; i < arr.length; i += st) out.push(arr[i]);
  return out;
}
function los(a, b, y = 1.6) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 0.01) return true;
  const s = 0.25, n = Math.ceil(L / s);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (blockedAt(a[0] + dx * t, a[1] + dz * t, y)) return false;
  }
  return true;
}

// grid BFS distances (the nav-path proxy at 0.5 m cells)
const idxOf = new Map(); reach.forEach((p, i) => idxOf.set(key(p[0], p[1]), i));
function snap(p) {
  let best = reach[0], bd = 1e9;
  for (const r of reach) { const d = Math.hypot(r[0] - p[0], r[1] - p[1]); if (d < bd) { bd = d; best = r; } }
  return best;
}
// 8-neighbour Dijkstra (octile) — a 4-neighbour BFS reports Manhattan
// lengths, which inflates diagonal routes ~30% and corrupts the parity
// ratios. Bucketed by 0.1 m cost for near-linear time.
const DIAG = CELL * Math.SQRT2;
function bfs(from) {
  const dist = new Float32Array(reach.length).fill(1e9);
  const s = idxOf.get(key(from[0], from[1])); if (s == null) return null;
  dist[s] = 0;
  const bucketsQ = []; const push = (i, d) => {
    const b = Math.floor(d * 10);
    (bucketsQ[b] = bucketsQ[b] || []).push(i);
  };
  push(s, 0);
  const NB = [[CELL, 0, CELL], [-CELL, 0, CELL], [0, CELL, CELL], [0, -CELL, CELL],
    [CELL, CELL, DIAG], [CELL, -CELL, DIAG], [-CELL, CELL, DIAG], [-CELL, -CELL, DIAG]];
  for (let b = 0; b < 4000; b++) {
    const bucket = bucketsQ[b]; if (!bucket) continue;
    for (let h = 0; h < bucket.length; h++) {
      const i = bucket[h];
      if (Math.floor(dist[i] * 10) !== b) continue; // stale entry
      const [x, z] = reach[i];
      for (const [dx, dz, c] of NB) {
        const j = idxOf.get(key(x + dx, z + dz));
        if (j != null && dist[j] > dist[i] + c) { dist[j] = dist[i] + c; push(j, dist[j]); }
      }
    }
  }
  return dist;
}
function pathLen(distField, to) {
  const s = snap(to);
  const d = distField[idxOf.get(key(s[0], s[1]))];
  return d > 1e8 ? NaN : d;
}

// ===========================================================================
// SPAWN SET — the seeds live on the map module's ARENA_SPEC (see the
// MAP-SPECIFIC INPUTS block above). The probe REPAIRS each seed (≤4 m
// nudge), re-takes yaw inside the cluster's ±60° inward cone, and EMITS —
// hand transcription is how C7b happened.
// ===========================================================================
function clearance(x, z) {
  let best = 99;
  for (let a = 0; a < 32; a++) {
    const th = (a / 32) * Math.PI * 2;
    for (let r = 0.25; r <= 3.0; r += 0.25) {
      if (blockedAt(x + Math.cos(th) * r, z + Math.sin(th) * r, 1.0)) { if (r < best) best = r; break; }
    }
  }
  return best;
}
function inwardYawFor(cluster, x, z) {
  const meta = CLUSTER_META[cluster];
  if (meta.inward != null) return meta.inward;
  // side:"mid" cluster (lanternwalk SC_PLAZA): inward = toward the arena
  // middle from the point (gates.mid; bounds centre when a spec omits it)
  const dx = MID[0] - x, dz = MID[1] - z;
  return Math.atan2(-dx, -dz);
}
function normAng(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
// best-view yaw within ±60° of the cluster's inward normal (C6)
function coneYaw(x, z, cluster) {
  const c0 = inwardYawFor(cluster, x, z);
  let by = c0, bv = 0;
  for (let k = -12; k <= 12; k++) {
    const yaw = normAng(c0 + (k / 12) * (Math.PI / 3));
    const v = ray(x, z, -Math.sin(yaw), -Math.cos(yaw), 1.6);
    if (v > bv) { bv = v; by = yaw; }
  }
  return [by, bv];
}
// repair: nudge ≤4 m to a walkable spot with clearance ≥1.5 and coned view ≥8,
// and (G-D clause 3) no ray ≥ T.spawnLongestM from the point.
//
// The exposure limit is a TABLE value, read by this search and by G-D's clause
// from the same field, so the two can no longer drift (they were two separate
// literal 40s that merely happened to agree).
//
// GEN-2 also relaxes the FAILURE MODE. Rejecting outright is safe while 40 m
// is long relative to the map; on a doubled map most of the floor can see
// 40 m+, so an outright reject drives every spawn into the cramped pockets the
// expansion exists to remove — the gate would manufacture the defect it grades.
// With spawnRelaxFallback the least-exposed otherwise-valid candidate is kept
// and reported, so the result is a NAMED over-exposed spawn in G-D rather than
// a vanished one in G-G. Gen-1 leaves the flag false and behaves identically.
function placePoint(id, x0, z0, cluster) {
  let fallback = null;
  for (let r = 0; r <= 4.01; r += 0.5) {
    for (let a = 0; a < (r === 0 ? 1 : 24); a++) {
      const th = (a / 24) * Math.PI * 2;
      const x = Math.round((x0 + Math.cos(th) * r) * 2) / 2;
      const z = Math.round((z0 + Math.sin(th) * r) * 2) / 2;
      if (!walkable(x, z)) continue;
      const cr = clearance(x, z); if (cr < 1.5) continue;
      const [yaw, view] = coneYaw(x, z, cluster);
      if (view < 8.0) continue;
      const pr = profile([[x, z]]);
      if (pr.maxes[0] >= T.spawnLongestM) { // G-D: no keyhole originates at a spawn
        if (T.spawnRelaxFallback && (fallback === null || pr.maxes[0] < fallback.longest)) {
          fallback = { x, z, yaw, clear: cr, view, longest: pr.maxes[0], relaxed: true };
        }
        continue;
      }
      return { x, z, yaw, clear: cr, view, longest: pr.maxes[0] };
    }
  }
  return fallback; // always null in gen-1 (spawnRelaxFallback === false)
}

const points = [];
const unplaced = [];
for (const [id, x0, z0, cluster, modes] of SP) {
  const got = placePoint(id, x0, z0, cluster);
  if (!got) { unplaced.push(id); continue; }
  // dedupe: ≥3 m from every already-accepted point
  const clash = points.find((p) => Math.hypot(p.x - got.x, p.z - got.z) < 3.0);
  if (clash) { unplaced.push(`${id} (spacing vs ${clash.id}@${clash.x},${clash.z} got ${got.x},${got.z})`); continue; }
  const cov = Math.round((1 - profile([[got.x, got.z]], 1.0, 16).all.filter((d) => d > 4).length / 16) * 10) / 10;
  points.push({ id, cluster, modes: modes || ALL.slice(), x: got.x, z: got.z, yaw: Math.round(got.yaw * 100) / 100, clear: got.clear, view: got.view, longest: got.longest, relaxed: !!got.relaxed, cover: Math.min(0.9, Math.max(0.1, cov)) });   // `longest` carried so G-D's spawn clause MEASURES (it was dropped here, making that clause structurally vacuous); `relaxed` names a gen-2 fallback placement
}

// ===========================================================================
console.log(GEN === 1
  ? `=== ${MAP_ID.toUpperCase()} ARENA GATES (G-A…G-K) ===`
  : `=== ${MAP_ID.toUpperCase()} ARENA GATES (G-A…G-K, G-HUB) — ${T.label} ===`);
console.log(`bounds X[${AB.x0},${AB.x1}] Z[${AB.z0},${AB.z1}]  boxes ${boxes.length}  walkable cells ${pts.length} (reach ${reach.length})`);

// ---- G-A walkable area + connectivity
gate("G-A", inBand(groundArea, T.groundMin, T.groundMax) && strayArea <= T.strayMax,
  `walkable ground ${groundArea.toFixed(0)} m² (target ${band(T.groundMin, T.groundMax)}), disconnected stray ${strayArea.toFixed(0)} m² (≤${T.strayMax})`);

// ---- G-B per-actor surface
// divisor = the real roster (botRoster + the human), never a literal 10.
const perActor = (groundArea + BALCONY_M2) / ACTORS; // + measured off-grid surface (gates.balconyAreaM2)
gate("G-B", inBand(perActor, T.perActorMin, T.perActorMax),
  `per-actor surface ${perActor.toFixed(0)} m² (target ${band(T.perActorMin, T.perActorMax)}, incl. ~${BALCONY_M2} m² balcony)` +
  (GEN === 1 ? "" : `, ÷${ACTORS} actors from content.botRoster`));

// ---- sightline profile (G-C, G-D)
const S = sample(reach, 900);
const P = profile(S);
const bandPct = (lo, hi) => (P.all.filter((d) => d >= lo && d < hi).length / P.all.length) * 100;
const under6 = bandPct(0, 6), under15 = bandPct(0, 15);
// gen-2 adds the mid-range clause: a floor on the 15–40 m layer all three
// shipped maps lack (17.5–21.7%), so "bigger" cannot mean "bigger and equally
// cramped". The 6/15/40 m edges are weapon ranges and never scale.
const mid = T.midMin == null ? null : bandPct(T.midLoM, T.midHiM);
gate("G-C", inBand(under6, T.u6Min, T.u6Max) && inBand(under15, T.u15Min, T.u15Max) &&
  (mid == null || mid >= T.midMin),
  `band mix <6 m ${under6.toFixed(1)}% (${band(T.u6Min, T.u6Max)}), <15 m ${under15.toFixed(1)}% (${band(T.u15Min, T.u15Max)})` +
  (mid == null ? "" : `, ${T.midLoM}–${T.midHiM} m ${mid.toFixed(1)}% (≥${T.midMin})`));

// ---- --bandMap: WHERE G-C's short rays come from.
// G-C reports one band mix for the arena; this bins the SAME rays by 8 m tile
// so de-cluttering targets the ground that is actually short-sighted, rather
// than whichever corner looks busy. Diagnostic only.
if (ARGV.includes("--bandMap")) {
  const TILE = 8, tiles = new Map();
  for (const [x, z] of S) {
    let u15 = 0, m = 0;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const d = ray(x, z, Math.cos(a), Math.sin(a), 1.6);
      if (d < 15) u15++; else if (d < 40) m++;
    }
    const k = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
    const t = tiles.get(k) || { tx: Math.floor(x / TILE), tz: Math.floor(z / TILE), n: 0, u: 0, m: 0 };
    t.n++; t.u += u15 / 72; t.m += m / 72;
    tiles.set(k, t);
  }
  const rows = [...tiles.values()].filter((t) => t.n >= 3)
    .map((t) => ({ ...t, u15: t.u / t.n * 100, mid: t.m / t.n * 100 }))
    .sort((a, b) => b.u15 - a.u15);
  console.log(`
--bandMap  ${S.length} cells, TILE ${TILE} m — arena <15 m ${under15.toFixed(1)}%, 15-40 m ${(mid || 0).toFixed(1)}%`);
  console.log("  tile x,z (m)        cells    <15 m    15-40 m");
  for (const r of rows.slice(0, 16))
    console.log(`  [${String(r.tx * TILE).padStart(4)},${String(r.tz * TILE).padStart(4)}]`.padEnd(22) +
      `${String(r.n).padStart(4)}   ${r.u15.toFixed(1).padStart(6)}%   ${r.mid.toFixed(1).padStart(6)}%`);
}
// tail clauses, longest-first, straight off the table (gen-1: 55/40 m;
// gen-2: 78/55/40 m — the two size-driven distances scaled by √2, allowances
// unchanged because they are tail FRACTIONS, not areas).
const tails = T.dTails.map((t) => Object.assign({}, t, { pctv: bandPct(t.m, 99999) }));
const tailsOk = tails.every((t) => (t.cmp === "<" ? t.pctv < t.max : t.pctv <= t.max));
const longestRay = P.all[P.all.length - 1];
const longestOk = T.longestMaxM == null || longestRay <= T.longestMaxM;
const spawnLong = points.filter((p) => p.longest >= T.spawnLongestM);
// "0.0% ≥ 55 m" is arena.md's own measurement convention: its twelve accepted
// 55–67 m keyholes (§4.4, residual R3) existed while it reported 0.0%, so the
// gate is <0.05% (rounds to 0.0), not literal zero.
gate("G-D", tailsOk && longestOk && spawnLong.length <= T.spawnLongMax,
  `rays ${tails.map((t) => `≥${t.m} m ${t.pctv.toFixed(t.dp)}% (${t.cmp}${t.max}${t.note || ""})`).join(", ")}` +
  (T.longestMaxM == null ? "" : `, longest sampled ray ${longestRay.toFixed(1)} m (≤${T.longestMaxM})`) +
  `, spawns with a ≥${T.spawnLongestM} m ray: ${spawnLong.length}` +
  (T.spawnLongMax > 0 ? ` (≤${T.spawnLongMax})` : ""));
if (GEN !== 1) for (const p of spawnLong) note(`G-D: ${p.id} @(${p.x},${p.z}) longest ray ${p.longest.toFixed(1)} m${p.relaxed ? " [relaxed placement — no candidate under the limit within 4 m]" : ""}`);

// ---- G-E 10-actor occupancy
{
  // G-E is a Monte Carlo, so its own sampling noise is part of the reading.
  // At p ~= 0.6, TR = 1500 gives a standard error of +-1.26 pp — wider than
  // the gate band itself, so a map could pass or fail on the draw rather than
  // on its geometry. TR = 24000 puts the s.e. at +-0.32 pp. Both are
  // overridable so the reading can be audited across seeds.
  let rs = LOS_SEED; const rnd = () => (rs = (rs * 1664525 + 1013904223) >>> 0) / 4294967296;
  const TR = LOS_TRIALS; const nearest = []; let anyLos = 0;
  for (let t = 0; t < TR; t++) {
    const me = reach[Math.floor(rnd() * reach.length)];
    let nd = 1e9, seenN = 0;
    for (let k = 0; k < 9; k++) {
      const o = reach[Math.floor(rnd() * reach.length)];
      const d = Math.hypot(me[0] - o[0], me[1] - o[1]);
      if (d < nd) nd = d;
      if (seenN === 0 && los(me, o)) seenN++;
    }
    nearest.push(nd); if (seenN > 0) anyLos++;
  }
  nearest.sort((a, b) => a - b);
  const p10 = pct(nearest, 0.1), med = pct(nearest, 0.5), p90 = pct(nearest, 0.9), pl = (anyLos / TR) * 100;
  // gen-1: ceilings on distance + a FLOOR on being seen — a phone booth passes.
  // gen-2: a BAND on P(≥1 in LOS) (neither shooting gallery nor ghost town),
  // plus the p10 FLOOR gen-1 never had. See the threshold table for both
  // derivations (1−(1−p)⁹ for the band, (1−πr²/A)⁹ for the distances).
  gate("G-E", inBand(p10, T.eP10Min, null) && inBand(med, T.eMedMin, T.eMedMax) &&
    p90 <= T.eP90Max && inBand(pl, T.ePlMin, T.ePlMax),
    (T.eP10Min == null ? "nearest-of-9" : `nearest-of-9 p10 ${p10.toFixed(1)} m (≥${T.eP10Min}),`) +
    ` median ${med.toFixed(1)} m (${band(T.eMedMin, T.eMedMax)}), p90 ${p90.toFixed(1)} m (≤${T.eP90Max}), ` +
    `P(≥1 in LOS) ${pl.toFixed(1)}% (${band(T.ePlMin, T.ePlMax)})`);
}

// ---- --losMap: WHERE the mutual visibility lives.
// G-E reports one number for the whole arena, which tells you a map is too
// open but not which square metres are doing it. This buckets each sampled
// reachable cell by the fraction of other cells it can see and prints the
// worst tiles, so occluders go where they actually buy G-E instead of where
// they look right. Diagnostic only — prints nothing unless asked.
if (ARGV.includes("--losMap")) {
  const TILE = 8;
  const NS = numArg("losMapSamples", 700);
  const S = sample(reach, NS);
  const vis = new Array(S.length).fill(0);
  for (let i = 0; i < S.length; i++)
    for (let j = i + 1; j < S.length; j++)
      if (los(S[i], S[j])) { vis[i]++; vis[j]++; }
  const tiles = new Map();
  for (let i = 0; i < S.length; i++) {
    const tx = Math.floor(S[i][0] / TILE), tz = Math.floor(S[i][1] / TILE);
    const k = `${tx},${tz}`;
    const t = tiles.get(k) || { tx, tz, n: 0, v: 0 };
    t.n++; t.v += vis[i] / (S.length - 1);
    tiles.set(k, t);
  }
  const rows = [...tiles.values()].filter((t) => t.n >= 3)
    .map((t) => ({ ...t, mean: t.v / t.n, load: t.v }))
    .sort((a, b) => b.load - a.load);
  const overall = vis.reduce((a, b) => a + b, 0) / (S.length * (S.length - 1));
  console.log(`
--losMap  ${S.length} cells, TILE ${TILE} m — mean pairwise LOS ${(overall * 100).toFixed(2)}%`);
  console.log("  tile x,z (m)        cells   mean LOS   share of total");
  const total = rows.reduce((a, r) => a + r.load, 0);
  for (const r of rows.slice(0, 14))
    console.log(`  [${String(r.tx * TILE).padStart(4)},${String(r.tz * TILE).padStart(4)}]`.padEnd(22) +
      `${String(r.n).padStart(4)}   ${(r.mean * 100).toFixed(1).padStart(6)}%   ${(r.load / total * 100).toFixed(1).padStart(5)}%`);
}

// ---- G-HUB dominant open region (GEN-2 only — the anti-warren clause)
// WHY THIS GATE EXISTS: core/level/maps/saltmarket.js:24-31 records the
// mechanism from that map's own build — "the mutual-visibility probability
// between two random points scales with the SQUARE of the largest open
// region's share of the floor". Its first build was a pure lattice of aisles
// and measured P(≥1 of 9 in LOS) 36.1%; the fix was not more cover but ONE
// dominant open room. Doubling a map's floor is the most likely way to
// re-create that lattice (twice the corridors, no bigger room), and because
// the relation is squared, a share sliding 45%→30% costs more than half the
// mutual visibility. G-E measures the symptom; this measures the cause, and
// unlike G-E it is not a 1500-trial Monte Carlo — it is exact on the grid.
//
// MEASURE: 0.5 m cells whose distance to the nearest blocker is ≥ hubOpenR
// (1.5 m — the same clearance the spawn placer demands), 4-connected, largest
// component ÷ walkable floor. Cross-check that this measures the room a map
// author would point at: it returns 53.4% on saltmarket against that file's
// own "1339 of 2488 m², 53.8%" measurement of its hall.
if (T.hubShareMin != null) {
  const ki = (p) => Math.round((p[0] - AB.x0) / CELL), kj = (p) => Math.round((p[1] - AB.z0) / CELL);
  let W = 0, H = 0;
  for (const p of pts) { if (ki(p) + 2 > W) W = ki(p) + 2; if (kj(p) + 2 > H) H = kj(p) + 2; }
  const gi = (i, j) => j * W + i;
  const D = new Float32Array(W * H); // 0 everywhere = "blocked"; walkable set below
  for (const p of pts) D[gi(ki(p), kj(p))] = 1e9;
  const O = CELL, Q = CELL * Math.SQRT2;   // octile chamfer costs, in metres
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    let v = D[gi(i, j)]; if (v === 0) continue;
    if (i > 0) v = Math.min(v, D[gi(i - 1, j)] + O);
    if (j > 0) v = Math.min(v, D[gi(i, j - 1)] + O);
    if (i > 0 && j > 0) v = Math.min(v, D[gi(i - 1, j - 1)] + Q);
    if (i < W - 1 && j > 0) v = Math.min(v, D[gi(i + 1, j - 1)] + Q);
    D[gi(i, j)] = v;
  }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    let v = D[gi(i, j)]; if (v === 0) continue;
    if (i < W - 1) v = Math.min(v, D[gi(i + 1, j)] + O);
    if (j < H - 1) v = Math.min(v, D[gi(i, j + 1)] + O);
    if (i < W - 1 && j < H - 1) v = Math.min(v, D[gi(i + 1, j + 1)] + Q);
    if (i > 0 && j < H - 1) v = Math.min(v, D[gi(i - 1, j + 1)] + Q);
    D[gi(i, j)] = v;
  }
  const open = new Uint8Array(W * H);
  for (const p of reach) if (D[gi(ki(p), kj(p))] >= T.hubOpenR) open[gi(ki(p), kj(p))] = 1;
  const lab = new Uint8Array(W * H);
  const sizes = [];
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!open[s0] || lab[s0]) continue;
    let n = 0; const st = [s0]; lab[s0] = 1;
    while (st.length) {
      const c = st.pop(); n++;
      const i = c % W, j = (c - i) / W;
      for (const [a, b] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (a < 0 || b < 0 || a >= W || b >= H) continue;
        const k2 = gi(a, b);
        if (open[k2] && !lab[k2]) { lab[k2] = 1; st.push(k2); }
      }
    }
    sizes.push(n);
  }
  sizes.sort((a, b) => b - a);
  const hubCells = sizes[0] || 0, secondCells = sizes[1] || 0;
  const hubArea = hubCells * CELL * CELL, secondArea = secondCells * CELL * CELL;
  const hubShare = (hubCells / reach.length) * 100;
  const dom = secondCells ? hubCells / secondCells : Infinity;
  gate("G-HUB", hubShare >= T.hubShareMin && dom >= T.hubDominance,
    `largest open region (≥${T.hubOpenR} m clearance) ${hubArea.toFixed(0)} m² = ${hubShare.toFixed(1)}% of floor (≥${T.hubShareMin}), ` +
    `dominance vs 2nd (${secondArea.toFixed(0)} m²) ${dom === Infinity ? "∞" : dom.toFixed(1)}× (≥${T.hubDominance})`);
}

// ---- G-F loop probe: every spawn ↔ every spawn + both flags; no dead-end rects
{
  const fields = new Map();
  const d0 = bfs(snap([points[0].x, points[0].z]));
  let unreachable = 0;
  for (const p of points.slice(1)) {
    const d = pathLen(d0, [p.x, 0, p.z].filter((_, i) => i !== 1).map(Number) && [p.x, p.z]);
    if (isNaN(d)) { unreachable++; note(`G-F: ${p.id} unreachable from ${points[0].id}`); }
  }
  const dW = pathLen(d0, [FLAG_WEST[0], FLAG_WEST[2]]);
  const dE = pathLen(d0, [FLAG_EAST[0], FLAG_EAST[2]]);
  // dead-end rect check: every ground walkRect must connect to ≥2 others
  const L = C.walkRects.filter((r) => !r.y);
  const rectCells = (r) => reach.filter(([x, z]) => x >= r.min[0] && x <= r.max[0] && z >= r.min[1] && z <= r.max[1]);
  const overlaps = (a, b, pad = 0.6) =>
    a.min[0] <= b.max[0] + pad && a.max[0] >= b.min[0] - pad &&
    a.min[1] <= b.max[1] + pad && a.max[1] >= b.min[1] - pad;
  const deadEnds = [];
  for (const r of L) {
    let conn = 0;
    for (const o of L) if (o !== r && overlaps(r, o)) conn++;
    if (conn < 2) deadEnds.push(`${r.id}(${conn})`);
  }
  gate("G-F", unreachable === 0 && !isNaN(dW) && !isNaN(dE) && deadEnds.length === 0,
    `spawn connectivity ${points.length - 1 - unreachable}/${points.length - 1}, flags reachable ${!isNaN(dW) && !isNaN(dE)}, dead-end rects: ${deadEnds.length ? deadEnds.join(",") : "none"}`);
}

// ---- G-G spawn validity (incl. the C7b per-mode cluster counts)
{
  let fails = [];
  if (!inBand(points.length, T.spawnMin, T.spawnMax)) fails.push(`count ${points.length} outside ${band(T.spawnMin, T.spawnMax)}`);
  if (unplaced.length) fails.push(`unplaced: ${unplaced.join(",")}`);
  for (const p of points) {
    if (!walkable(p.x, p.z)) fails.push(`${p.id} not walkable`);
    if (p.clear < 1.5) fails.push(`${p.id} clearance ${p.clear}`);
    if (p.view < 8) fails.push(`${p.id} view ${p.view.toFixed(1)}`);
    const dCone = Math.abs(normAng(p.yaw - inwardYawFor(p.cluster, p.x, p.z)));
    if (dCone > Math.PI / 3 + 0.02) fails.push(`${p.id} yaw outside ±60° cone`); // 0.02 = 2-dp yaw rounding
  }
  const byCluster = {};
  for (const p of points) (byCluster[p.cluster] = byCluster[p.cluster] || []).push(p);
  for (const [cid, ps] of Object.entries(byCluster)) {
    const xs = ps.map((p) => p.x), zs = ps.map((p) => p.z);
    const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...zs) - Math.min(...zs));
    let maxPair = 0;
    for (const a of ps) for (const b of ps) maxPair = Math.max(maxPair, Math.hypot(a.x - b.x, a.z - b.z));
    if (area < T.clusterBboxMin) fails.push(`${cid} bbox ${area.toFixed(0)} m² < ${T.clusterBboxMin}`);
    if (maxPair < T.clusterPairMin) fails.push(`${cid} max pair separation ${maxPair.toFixed(1)} m < ${T.clusterPairMin}`);
  }
  // per-mode counts — the C7b regression stopper
  for (const mode of ALL) {
    for (const [cid, meta] of Object.entries(CLUSTER_META)) {
      if (meta.modes && !meta.modes.includes(mode)) continue;
      const n = (byCluster[cid] || []).filter((p) => p.modes.includes(mode)).length;
      if (n < 6) fails.push(`mode ${mode}: cluster ${cid} has ${n} eligible (<6)`);
    }
  }
  // C7b V8/V9 for CTF-eligible points: ≥6 m from own flag; no LOS to own
  // stand from under 10 m
  for (const p of points) {
    if (!p.modes.includes("ctf")) continue;
    const side = CLUSTER_META[p.cluster].side;
    if (side === "mid") continue;
    const own = side === "west" ? FLAG_WEST : FLAG_EAST;
    const d = Math.hypot(p.x - own[0], p.z - own[2]);
    if (d < 6) fails.push(`${p.id} V8: ${d.toFixed(1)} m from own flag`);
    if (d < 10 && los([p.x, p.z], [own[0], own[2]])) fails.push(`${p.id} V9: LOS to own stand at ${d.toFixed(1)} m`);
  }
  // cluster count is MEASURED, not the literal 7 this line used to print —
  // every shipped map has 7, so gen-1's text is unchanged, but a gen-2 map
  // with more clusters would have been misreported as 7.
  gate("G-G", fails.length === 0, fails.length ? fails.join(" | ") : `${points.length} points, ${Object.keys(byCluster).length} clusters, per-mode counts ≥6, yaw cones ok`);
}

// ---- G-H boundary probe — no invisible walls
{
  const samples = [];
  for (let x = AB.x0; x <= AB.x1; x += 2) { samples.push([x, AB.z0, 0, 1]); samples.push([x, AB.z1, 0, -1]); }
  for (let z = AB.z0; z <= AB.z1; z += 2) { samples.push([AB.x0, z, 1, 0]); samples.push([AB.x1, z, -1, 0]); }
  const solidNear = (x, z) => {
    for (const b of buckets[bidx(x, z)]) {
      if (x >= b.min[0] - 0.5 && x <= b.max[0] + 0.5 && z >= b.min[2] - 0.5 && z <= b.max[2] + 0.5 &&
          b.min[1] <= 1.0 && b.max[1] >= 1.0) return true;
    }
    return false;
  };
  const bad = [];
  for (const [x, z, nx, nz] of samples) {
    if (solidNear(x, z)) continue;
    // geometry may sit just beyond the AABB (base-room rims): scan outward 3 m
    let found = false;
    for (let t = 0.5; t <= 3.0; t += 0.5) {
      const px = x - nx * t, pz = z - nz * t; // outward = −inward normal
      for (const b of boxes) {
        if (px >= b.min[0] - 0.3 && px <= b.max[0] + 0.3 && pz >= b.min[2] - 0.3 && pz <= b.max[2] + 0.3 &&
            b.min[1] <= 1.0 && b.max[1] >= 1.0) { found = true; break; }
      }
      if (found) break;
    }
    if (!found) bad.push(`(${x.toFixed(0)},${z.toFixed(0)})`);
  }
  gate("G-H", bad.length === 0, bad.length ? `open boundary at ${bad.slice(0, 8).join(" ")}${bad.length > 8 ? ` +${bad.length - 8}` : ""}` : `all ${samples.length} perimeter samples backed by geometry`);
}

// ---- G-I CTF parity
{
  const dPlaza = bfs(snap(MID));
  const p3w = pathLen(dPlaza, [FLAG_WEST[0], FLAG_WEST[2]]);
  const p3e = pathLen(dPlaza, [FLAG_EAST[0], FLAG_EAST[2]]);
  const p3d = (Math.abs(p3w - p3e) / ((p3w + p3e) / 2)) * 100;
  // P4 semantics: attacker spawn → enemy flag, as the MEAN path length over
  // each side's whole CTF spawn distribution (WSIDE/ESIDE — every cluster
  // whose clusterMeta.side names that half) — the expected respawn-to-attack
  // distance, not a centroid proxy.
  const dFromE = bfs(snap([FLAG_EAST[0], FLAG_EAST[2]]));
  const dFromW = bfs(snap([FLAG_WEST[0], FLAG_WEST[2]]));
  const wPts = points.filter((p) => WSIDE.includes(p.cluster) && p.modes.includes("ctf"));
  const ePts = points.filter((p) => ESIDE.includes(p.cluster) && p.modes.includes("ctf"));
  const p4w = mean(wPts.map((p) => pathLen(dFromE, [p.x, p.z])));
  const p4e = mean(ePts.map((p) => pathLen(dFromW, [p.x, p.z])));
  const p4d = (Math.abs(p4w - p4e) / ((p4w + p4e) / 2)) * 100;
  const lw = profile([[FLAG_WEST[0], FLAG_WEST[2]]]).maxes[0];
  const le = profile([[FLAG_EAST[0], FLAG_EAST[2]]]).maxes[0];
  const p5d = Math.abs(lw - le);
  const covW = C.cover.filter((cv) => Math.hypot(cv.pos[0] - FLAG_WEST[0], cv.pos[2] - FLAG_WEST[2]) <= 5.5).length;
  const covE = C.cover.filter((cv) => Math.hypot(cv.pos[0] - FLAG_EAST[0], cv.pos[2] - FLAG_EAST[2]) <= 5.5).length;
  gate("G-I", p3d <= 8 && p4d <= 8 && p5d <= 10 && covW === covE && covW >= 4,
    `P3 mid→flag ${p3w.toFixed(1)}/${p3e.toFixed(1)} m (${p3d.toFixed(1)}% ≤8) | P4 atk→enemy ${p4w.toFixed(1)}/${p4e.toFixed(1)} m (${p4d.toFixed(1)}% ≤8) | P5 longest-into-site ${lw.toFixed(1)}/${le.toFixed(1)} m (Δ${p5d.toFixed(1)} ≤10) | P2 cover ${covW}/${covE}`);
  note(`flag separation ${pathLen(bfs(snap([FLAG_WEST[0], FLAG_WEST[2]])), [FLAG_EAST[0], FLAG_EAST[2]]).toFixed(1)} m of path`);
}

// ---- G-J TDM parity (home centroid → walkable centroid ±8%)
{
  // TDM parity measures the TDM spawn distribution — tdm-eligible points only
  const homeW = points.filter((p) => TDM_HOME_W.includes(p.cluster) && p.modes.includes("tdm"));
  const homeE = points.filter((p) => TDM_HOME_E.includes(p.cluster) && p.modes.includes("tdm"));
  const cw = [mean(homeW.map((p) => p.x)), mean(homeW.map((p) => p.z))];
  const ce = [mean(homeE.map((p) => p.x)), mean(homeE.map((p) => p.z))];
  const centroid = snap([mean(reach.map((p) => p[0])), mean(reach.map((p) => p[1]))]);
  const dw = pathLen(bfs(snap(cw)), centroid);
  const de = pathLen(bfs(snap(ce)), centroid);
  const dd = (Math.abs(dw - de) / ((dw + de) / 2)) * 100;
  gate("G-J", dd <= 8,
    `home(${cw[0].toFixed(1)},${cw[1].toFixed(1)})/(${ce[0].toFixed(1)},${ce[1].toFixed(1)}) → centroid(${centroid[0].toFixed(1)},${centroid[1].toFixed(1)}) ${dw.toFixed(1)}/${de.toFixed(1)} m (${dd.toFixed(1)}% ≤8)`);
}

// ---- lane graph contract (Part 3.9 — five properties, W4 data)
{
  const fails = [];
  const J = LANES.junctions;
  const adj = new Map(Object.keys(J).map((k) => [k, []]));
  for (const ln of LANES.lanes) {
    if (!J[ln.a]) fails.push(`${ln.id}: endpoint ${ln.a} not a junction`);
    if (!J[ln.b]) fails.push(`${ln.id}: endpoint ${ln.b} not a junction`);
    if (J[ln.a] && J[ln.b] && ln.a !== ln.b) { adj.get(ln.a).push(ln.b); adj.get(ln.b).push(ln.a); }
    const chain = [J[ln.a], ...ln.wp, J[ln.b]].filter(Boolean);
    for (let i = 0; i < chain.length; i++) {
      const w = chain[i];
      if (w[1] > 0.5) continue; // balcony waypoint — ground grid cannot judge it
      if (!walkable(w[0], w[2]) || !reachKeys.has(key(snap([w[0], w[2]])[0], snap([w[0], w[2]])[1]))) {
        const s = snap([w[0], w[2]]);
        if (Math.hypot(s[0] - w[0], s[1] - w[2]) > 0.75) fails.push(`${ln.id} wp[${i}] (${w[0]},${w[2]}) off nav`);
      }
      if (i > 0 && Math.abs(chain[i - 1][1] - w[1]) < 0.5) {
        const d = Math.hypot(chain[i - 1][0] - w[0], chain[i - 1][2] - w[2]);
        if (d > 12.001) fails.push(`${ln.id} wp[${i - 1}]→wp[${i}] gap ${d.toFixed(1)} m > 12`);
      }
    }
    if (ln.a === ln.b && ln.throughGoing !== false) fails.push(`${ln.id}: self-loop must be throughGoing:false`);
  }
  // Named-lane rule, generic by construction: a map with no L_BALCONY has
  // nothing to find, so this is a no-op there rather than a false FAIL.
  if (LANES.lanes.find((l) => l.id === "L_BALCONY" && l.throughGoing !== false)) fails.push("L_BALCONY must be throughGoing:false (V8)");
  // cycle: |edges| ≥ |nodes| on the connected component ⇒ at least one cycle
  const nEdges = LANES.lanes.filter((l) => l.a !== l.b).length;
  if (nEdges < Object.keys(J).length) fails.push("graph has no cycle");
  for (const k of Object.keys(LANES.approaches || {})) {
    for (const id of LANES.approaches[k]) if (!LANES.lanes.find((l) => l.id === id)) fails.push(`approaches.${k}: unknown lane ${id}`);
  }
  gate("G-LANES", fails.length === 0, fails.length ? fails.join(" | ") : `${Object.keys(J).length} junctions, ${LANES.lanes.length} lanes, cycle ok, waypoints on nav`);
}

// ---- G-K prop placement gate (probe_props against the ACTIVE map)
{
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "probe_props.mjs")], {
    cwd: ROOT, env: Object.assign({}, process.env, { BLACKRIDGE_MAP: MAP_ID }),
    encoding: "utf8", timeout: 120000,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  const tail = out.trim().split(/\r?\n/).slice(-3).join(" · ");
  gate("G-K", r.status === 0, `probe_props.mjs exit ${r.status} — ${tail}`);
}

// ===========================================================================
// ---- --payers: which OCCLUDER earns its keep, and which does not.
// G-C and G-E move in opposite directions for almost any single edit, so the
// only way to satisfy both is to make the SWAP asymmetric: drop occluders that
// cost many short rays per pair of sightlines they break, and add ones that
// cost few. This credits every blocked pair and every sub-15 m ray to the box
// that actually stopped it, and ranks by pairs-per-short-ray. (The same
// attribution the switchyard notes quote as "34 pairs per m² vs 233".)
if (ARGV.includes("--payers")) {
  const boxAt = (x, z, y) => {
    for (const b of buckets[bidx(x, z)])
      if (x >= b.min[0] && x <= b.max[0] && z >= b.min[2] && z <= b.max[2] &&
          b.min[1] <= y && b.max[1] >= y) return b;
    return null;
  };
  const firstHit = (a, b, y = 1.6) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    const st = 0.25, n = Math.ceil(L / st);
    for (let i = 1; i < n; i++) {
      const t = i / n, hb = boxAt(a[0] + dx * t, a[1] + dz * t, y);
      if (hb) return hb;
    }
    return null;
  };
  const stat = new Map();
  const bump = (b, k) => {
    if (!b) return;
    const id = b.id || `${b.kind || "?"}@${b.min[0].toFixed(0)},${b.min[2].toFixed(0)}`;
    const e = stat.get(id) || { id, kind: b.kind || "", pairs: 0, short: 0 };
    e[k]++; stat.set(id, e);
  };
  const SP = sample(reach, numArg("payerSamples", 420));
  for (let i = 0; i < SP.length; i++)
    for (let j = i + 1; j < SP.length; j++) bump(firstHit(SP[i], SP[j]), "pairs");
  for (const [x, z] of SP)
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
      const d = ray(x, z, c, sn, 1.6);
      if (d < 15) bump(boxAt(x + c * (d + 0.13), z + sn * (d + 0.13), 1.6), "short");
    }
  const rows = [...stat.values()].filter((e) => e.short + e.pairs >= 12)
    .map((e) => ({ ...e, r: e.pairs / Math.max(1, e.short) }))
    .sort((a, b) => a.r - b.r);
  console.log(`
--payers  ${SP.length} cells — pairs blocked per sub-15 m ray cost (low = bad payer)`);
  console.log("  WORST payers (candidates to remove/lower)");
  for (const e of rows.slice(0, 12))
    console.log(`    ${e.id.padEnd(16)}${e.kind.padEnd(14)} pairs ${String(e.pairs).padStart(5)}  short ${String(e.short).padStart(4)}  ratio ${e.r.toFixed(2)}`);
  console.log("  BEST payers (the device to copy)");
  for (const e of rows.slice(-8).reverse())
    console.log(`    ${e.id.padEnd(16)}${e.kind.padEnd(14)} pairs ${String(e.pairs).padStart(5)}  short ${String(e.short).padStart(4)}  ratio ${e.r.toFixed(2)}`);
}


if (anyFail) {
  console.log("\nRESULT: FAIL");
  process.exit(1);
}
console.log("\nRESULT: PASS");

// --------------------------------------------------------------- --emit
if (EMIT) {
  const file = path.join(ROOT, "content.json");
  const content = JSON.parse(fs.readFileSync(file, "utf8"));

  const byCluster = {};
  for (const p of points) (byCluster[p.cluster] = byCluster[p.cluster] || []).push(p);
  const clusters = {};
  for (const [cid, meta] of Object.entries(CLUSTER_META)) {
    const ps = byCluster[cid] || [];
    const anchor = snap([mean(ps.map((p) => p.x)), mean(ps.map((p) => p.z))]);
    clusters[cid] = {
      anchor: [Math.round(anchor[0] * 2) / 2, 0, Math.round(anchor[1] * 2) / 2],
      node: meta.node,
      inwardYaw: meta.inward != null ? Math.round(meta.inward * 100) / 100 : null,
      side: meta.side,
    };
    if (meta.modes) clusters[cid].modes = meta.modes.slice();
  }

  const arena = {
    id: MAP_ID,
    bounds: { min: C.bounds.min.slice(), max: C.bounds.max.slice() },
    vetoOverrides: { v1M: VETO.v1M, v2LosM: VETO.v2LosM, v3ConeM: VETO.v3ConeM },
    _comment: "PROBE-EMITTED by tools/probe_arena.mjs --emit (measured geometry; PVP_BUILD_PLAN Part 4.2). Do not hand-edit spawnPoints/clusters/flags." +
      (GEN === 1 ? "" : ` Certified under ${T.label}.`),
  };
  const spawnPoints = points.map((p) => ({
    id: p.id, pos: [p.x, 0, p.z], yaw: p.yaw, cluster: p.cluster,
    cover: p.cover, modes: p.modes, zoneHint: CLUSTER_META[p.cluster].node,
  }));
  const flags = [FLAG_WEST, FLAG_EAST].map((home, i) => {
    const m = FLAG_META[i] || {};
    return {
      id: m.id, team: m.team != null ? m.team : i, home: home.slice(),
      node: m.node, standR: m.standR != null ? m.standR : 1.2,
      standH: m.standH != null ? m.standH : 2.5,
    };
  });

  // [multi-arena amendment] content.json carries BOTH shapes:
  //   content.arenas[<id>]  the REGISTRY — one measured block per arena, and
  //                         the only thing this emit is allowed to overwrite
  //                         for <id>. Another map's block is never touched.
  //   content.arena / .clusters / .spawnPoints / .flags
  //                         the FLAT "currently selected arena" view. It stays
  //                         the live surface core/match/{contract,match}.js and
  //                         modes/ctf.js read (unchanged consumers — C19/R9);
  //                         boot.js's startMatch re-points it at the chosen
  //                         arena before createSim.
  // The flat view is refreshed only when it already holds THIS map (or the
  // registry has nothing else) — emitting switchyard must not silently move a
  // lanternwalk session onto switchyard geometry.
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const arenas = content.arenas || (content.arenas = {});
  arenas[MAP_ID] = { arena, spawnPoints, clusters, flags };
  const flatId = content.arena && content.arena.id;
  const only = Object.keys(arenas).length === 1;
  const refreshFlat = !flatId || flatId === MAP_ID || only;
  if (refreshFlat) {
    content.arena = clone(arena);
    content.clusters = clone(clusters);
    content.spawnPoints = clone(spawnPoints);
    content.flags = clone(flags);
  }

  fs.writeFileSync(file, JSON.stringify(content, null, 2) + "\n");
  console.log(`emitted spawnPoints[${points.length}] / clusters[${Object.keys(clusters).length}] / flags[${flags.length}] / arena ` +
    `→ content.arenas.${MAP_ID}${refreshFlat ? " + the flat keys" : ` (flat keys left on '${flatId}')`} in content.json`);
}
