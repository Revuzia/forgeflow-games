// BLOCKTOOTH — city-sim lane probe. Run: node _harness/probe_city.ts   (Node 22 strips types)
//
// 1. GENERATION — every biome × 3 seeds through generateCity with the same rng stream the world uses
//    (makeStreams(seed).city): building counts per tier, total floors, props by kind, lanes,
//    crosswalks, bounds, timing. Asserts: determinism (same seed → identical JSON hash), dense ids,
//    block index coverage, every tier 1–4 present, no building overlapping a road / its parcel edge /
//    another building, no prop centre inside a building, traffic props lying on their lane, crosswalk
//    count = every leg of every intersection, spawn ON a zebra facing along the crossing with ≥ 2 parked
//    vehicles + a kiosk within 8 m, LOCKWATER harbour (flooded, quay row gantries/containers only,
//    boats on the water, nothing built in the water), generateCity < 150 ms.
// 2. TRAFFIC — stepTraffic on a minimal world: cars move at 8–12 m/s, headings follow the lane
//    tangent, same-lane cars never overlap, the block-cell listing stays exact, a titan parked in
//    front of a car makes it brake/reverse (`scared`), destroyed cars leave the lane, determinism.
// 3. CITY SIM — buildingsInRect / propsInRect vs brute force, blockOf, buildingById, damageBuilding
//    (no break below floorHp, ≤ 4 floors per hit, floorBreak + rubble pickups, collapse + bonus +
//    counters + tonnage + blocksLeveled), damageProp (crushed flag, 1–3 pickups, propsEaten),
//    resolveCircleVsCity (push-out, bumpTier, flatten pass-through, collapsed never blocks, tier-0
//    props never block, tier-1 props block enemies), nearestRubble, stepCity re-derivation.
// 4. REPAIR CREWS — healthy city gets none; a depleted city (Size IV titan parked at the centre) gets crews only
//    beyond rebuildStartR, storeys only beyond rebuildNearR, never under the titan, never above REBUILD_MAX_CREWS,
//    never on a lot younger than REBUILD_MIN_DOWN_S, never dispatched at/above REBUILD_TARGET; first storey
//    un-collapses (alive 1, full floor HP), topped-out buildings stand full; blocksLeveled never decreases;
//    deterministic (identical runs -> identical event sequence); a rebuilt building drops normal rubble XP; the crew
//    downs tools near the titan and next to a live boss; a hit abandons the construction; a heal pickup holds a lot.
//    SLOW construction (owner 2026-10-01): no storey faster than rebuildFloorS, no first storey before site prep +
//    one storey, no site topping out before prep + floors x storey time or under 24 s, no building popping in
//    (several storeys in a tick / topped out without every storey), >= 3 sites mid-construction after 120 s.
//    Uses the REAL combat/pickups.ts when its import chain loads; otherwise a recording stub is
//    swapped in through node:module registerHooks and the output says so.
// Exit code: 0 all assertions passed, 1 any failure.

import type {
  BiomeDef, BiomeId, CityLayout, Lane, Prop, PropKind, SimEvent, Tier, World,
} from '../src/core/types.ts';
import { BIOMES } from '../src/data/biomes.ts';
import { generateCity, PROP_INFO, laneCum, cellOf } from '../src/city/citygen.ts';
import { stepTraffic } from '../src/city/traffic.ts';
import { hashStr, makeStreams, mulberry32 } from '../src/core/rng.ts';
import { CITY, PARCEL_HALF, SIM_DT, TIERS, lootXp } from '../src/core/config.ts';
import { segDist } from '../src/core/math.ts';
import { createMapState } from '../src/meta/objectives.ts';
import { createTally } from '../src/meta/tally.ts';

const BIOME_LIST: BiomeId[] = ['grideast', 'whitestacks', 'lockwater'];
const SEEDS = [1, 7, 90210];
let failures = 0;
let checks = 0;
const fail = (msg: string) => { failures++; console.log('  FAIL ' + msg); };
const check = (ok: boolean, msg: string) => { checks++; if (!ok) fail(msg); };
const fmt = (n: number, d = 1) => n.toFixed(d);

function gen(b: BiomeDef, seed: number): CityLayout {
  return generateCity(b, seed, makeStreams(seed).city);
}
function cityHash(c: CityLayout): string {
  return hashStr(JSON.stringify(c)).toString(16);
}
const isVehicle = (k: PropKind) => PROP_INFO[k].vehicle;

// ═════════════════════════════ 1. generation ═════════════════════════════
console.log('== 1. GENERATION');
const cities: Record<string, CityLayout> = {};
for (const bid of BIOME_LIST) {
  const biome = BIOMES[bid];
  // biome data sanity
  check(biome.id === bid, `${bid}: BiomeDef.id mismatch`);
  for (let t = 1; t <= 4; t++) check(biome.archetypes.some((a) => a.tier === t), `${bid}: no archetype of tier ${t}`);
  check(biome.lore.length >= 2 && biome.lore.length <= 4, `${bid}: lore must be 2–4 lines`);
  const sd = biome.sunDir, sl = Math.hypot(sd[0], sd[1], sd[2]);
  const elev = Math.asin(sd[1] / sl) * 180 / Math.PI;
  check(elev >= 25 && elev <= 36, `${bid}: sun elevation ${fmt(elev)}° outside the long-shadow band`);
  // the camera sits at +X+Z: at least one visible facade (+X or +Z) must face the key light
  check(sd[0] > 0.2 || sd[2] > 0.2, `${bid}: sunDir backlights both camera-facing facades`);
  for (const [k, v] of Object.entries(biome.palette)) check(/^#[0-9a-f]{6}$/i.test(v), `${bid}: palette.${k} = ${v} not #rrggbb`);
  for (const a of biome.archetypes) {
    check(a.footprint[0] <= a.footprint[1] && a.floors[0] <= a.floors[1] && a.floorH > 0, `${bid}/${a.id}: bad ranges`);
    check(a.footprint[0] <= 2 * PARCEL_HALF - 4, `${bid}/${a.id}: footprint min cannot fit a whole block`);
  }

  for (const seed of SEEDS) {
    // timing: first call (cold) + best of 3 warm calls
    let t0 = performance.now();
    const c = gen(biome, seed);
    const cold = performance.now() - t0;
    let warm = Infinity;
    for (let i = 0; i < 3; i++) { t0 = performance.now(); gen(biome, seed); warm = Math.min(warm, performance.now() - t0); }
    cities[`${bid}:${seed}`] = c;
    const label = `${bid} seed ${seed}`;

    // determinism
    const h1 = cityHash(c), h2 = cityHash(gen(biome, seed));
    check(h1 === h2, `${label}: not deterministic (${h1} vs ${h2})`);

    // counts
    const perTier = [0, 0, 0, 0, 0];
    let floors = 0;
    const perArch: Record<string, number> = {};
    for (const b of c.buildings) { perTier[b.tier]++; floors += b.floors; perArch[b.arch] = (perArch[b.arch] ?? 0) + 1; }
    const byKind: Record<string, number> = {};
    let traffic = 0, parked = 0;
    for (const p of c.props) {
      byKind[p.kind] = (byKind[p.kind] ?? 0) + 1;
      if (p.lane >= 0) traffic++; else if (isVehicle(p.kind)) parked++;
    }
    const closed = c.lanes.filter((l) => l.closed).length;
    const tallest = c.buildings.reduce((m, b) => Math.max(m, b.floors * b.floorH), 0);
    console.log(`-- ${label}: gen ${fmt(cold)} ms cold / ${fmt(warm)} ms warm · hash ${h1}`);
    console.log(`   buildings ${c.buildings.length} by tier [1..4] ${perTier.slice(1).join('/')} · floors ${floors} · tallest ${fmt(tallest)} m`);
    console.log(`   archetypes ${Object.entries(perArch).map(([k, v]) => `${k}:${v}`).join(' ')}`);
    console.log(`   props ${c.props.length} (traffic ${traffic}, parked ${parked}) · ${Object.entries(byKind).sort().map(([k, v]) => `${k}:${v}`).join(' ')}`);
    console.log(`   lanes ${c.lanes.length} (closed ${closed}, open ${c.lanes.length - closed}) · crosswalks ${c.crosswalks.length}`);
    console.log(`   bounds x[${fmt(c.bounds.minX)}, ${fmt(c.bounds.maxX)}] z[${fmt(c.bounds.minZ)}, ${fmt(c.bounds.maxZ)}] · flooded ${c.flooded}`);
    console.log(`   spawn (${fmt(c.spawn.x)}, ${fmt(c.spawn.z)}) heading ${fmt(c.spawn.heading, 3)}`);

    check(cold < 150 && warm < 150, `${label}: generateCity too slow (${fmt(cold)} / ${fmt(warm)} ms)`);
    for (let t = 1; t <= 4; t++) check(perTier[t] > 0, `${label}: no tier-${t} building`);
    check(perTier[0] === 0, `${label}: tier-0 buildings exist (tier 0 is props only)`);

    // grid + dense ids + index coverage
    const nB = c.blocksX * c.blocksZ;
    check(c.blocksX === biome.blocks[0] && c.blocksZ === biome.blocks[1], `${label}: block grid ≠ biome.blocks`);
    check(Math.abs(c.originX + c.blocksX * c.pitch / 2) < 1e-9 && Math.abs(c.originZ + c.blocksZ * c.pitch / 2) < 1e-9, `${label}: grid not centred on the origin`);
    check(c.blockBuildings.length === nB && c.blockProps.length === nB, `${label}: block index length`);
    c.buildings.forEach((b, i) => check(b.id === i, `${label}: building id ${b.id} at index ${i}`));
    c.props.forEach((p, i) => check(p.id === i, `${label}: prop id ${p.id} at index ${i}`));
    const seenB = new Int32Array(c.buildings.length), seenP = new Int32Array(c.props.length);
    c.blockBuildings.forEach((list, bi) => list.forEach((id) => { seenB[id]++; check(c.buildings[id].block === bi, `${label}: building ${id} listed under block ${bi} but block=${c.buildings[id].block}`); }));
    c.blockProps.forEach((list, bi) => list.forEach((id) => { seenP[id]++; check(cellOf(c, c.props[id].x, c.props[id].z) === bi, `${label}: prop ${id} listed in the wrong cell`); }));
    check(seenB.every((v) => v === 1), `${label}: some building not listed exactly once`);
    check(seenP.every((v) => v === 1), `${label}: some prop not listed exactly once`);

    // buildings: finite, inside their parcel square, off the roads, no overlaps
    let overlapFails = 0, roadFails = 0;
    for (const b of c.buildings) {
      const fin = [b.x, b.z, b.w, b.d, b.floorH, b.floors, b.floorHp, b.floorHpMax, b.variant].every(Number.isFinite);
      check(fin, `${label}: building ${b.id} has non-finite fields`);
      const arch = biome.archetypes.find((a) => a.id === b.arch);
      check(!!arch, `${label}: building ${b.id} arch ${b.arch} not in biome`);
      if (arch) {
        check(b.shape === arch.shape && b.tier === arch.tier && b.floorH === arch.floorH, `${label}: building ${b.id} disagrees with its archetype`);
        check(b.floors >= arch.floors[0] && b.floors <= arch.floors[1], `${label}: building ${b.id} floors ${b.floors} outside ${arch.floors}`);
        check(b.w >= arch.footprint[0] - 1e-9 && b.w <= arch.footprint[1] + 1e-9 && b.d >= arch.footprint[0] - 1e-9 && b.d <= arch.footprint[1] + 1e-9,
          `${label}: building ${b.id} footprint ${fmt(b.w)}×${fmt(b.d)} outside ${arch.footprint}`);
      }
      check(b.alive === b.floors && !b.collapsed && b.floorHpMax === TIERS[b.tier].floorHp && b.floorHp === b.floorHpMax, `${label}: building ${b.id} bad initial HP state`);
      const bx = b.block % c.blocksX, bz = Math.floor(b.block / c.blocksX);
      const cx = c.originX + (bx + 0.5) * c.pitch, cz = c.originZ + (bz + 0.5) * c.pitch;
      if (Math.abs(b.x - cx) + b.w / 2 > PARCEL_HALF + 1e-6 || Math.abs(b.z - cz) + b.d / 2 > PARCEL_HALF + 1e-6) roadFails++;
      // road strips: |x − (originX + i·pitch)| < roadW/2 + sidewalkW (road + sidewalk ring)
      const clear = CITY.roadW / 2 + CITY.sidewalkW - 1e-6;
      const ix = Math.round((b.x - c.originX) / c.pitch), iz = Math.round((b.z - c.originZ) / c.pitch);
      for (const i of [ix - 1, ix, ix + 1]) { const rx = c.originX + i * c.pitch; if (b.x - b.w / 2 < rx + clear && b.x + b.w / 2 > rx - clear) roadFails++; }
      for (const j of [iz - 1, iz, iz + 1]) { const rz = c.originZ + j * c.pitch; if (b.z - b.d / 2 < rz + clear && b.z + b.d / 2 > rz - clear) roadFails++; }
    }
    for (const list of c.blockBuildings) {
      for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
        const A = c.buildings[list[i]], B = c.buildings[list[j]];
        if (Math.abs(A.x - B.x) < (A.w + B.w) / 2 - 1e-6 && Math.abs(A.z - B.z) < (A.d + B.d) / 2 - 1e-6) overlapFails++;
      }
    }
    check(roadFails === 0, `${label}: ${roadFails} building/road or parcel-edge overlaps`);
    check(overlapFails === 0, `${label}: ${overlapFails} building/building overlaps`);

    // props: finite, not inside buildings, traffic on its lane, correct tier/hp
    let inside = 0, offLane = 0;
    const cums = c.lanes.map((l) => laneCum(l));
    for (const p of c.props) {
      check([p.x, p.z, p.heading, p.hp, p.laneS, p.speed].every(Number.isFinite), `${label}: prop ${p.id} non-finite`);
      check(p.tier === PROP_INFO[p.kind].tier && p.hp === TIERS[p.tier].floorHp && p.alive, `${label}: prop ${p.id} bad tier/hp`);
      check(p.px === p.x && p.pz === p.z && p.pheading === p.heading, `${label}: prop ${p.id} prev pose not initialised`);
      for (const id of c.blockBuildings[cellOf(c, p.x, p.z)]) {
        const b = c.buildings[id];
        if (Math.abs(p.x - b.x) < b.w / 2 - 0.05 && Math.abs(p.z - b.z) < b.d / 2 - 0.05) inside++;
      }
      if (p.lane >= 0) {
        const l = c.lanes[p.lane];
        check(!!l && isVehicle(p.kind), `${label}: traffic prop ${p.id} lane ${p.lane} invalid`);
        if (l) {
          const cum = cums[p.lane];
          check(p.laneS >= 0 && p.laneS <= cum[cum.length - 1] + 1e-6, `${label}: prop ${p.id} laneS out of range`);
          check(p.speed >= 8 - 1e-9 && p.speed <= 12 + 1e-9, `${label}: traffic prop ${p.id} cruise ${fmt(p.speed)} outside 8–12`);
          if (distToLane(l, p.x, p.z) > 0.01) offLane++;
        }
      }
    }
    check(inside === 0, `${label}: ${inside} prop centres inside building footprints`);
    check(offLane === 0, `${label}: ${offLane} traffic props not on their lane`);

    // lanes: one closed loop per block, finite lengths, stored length == polyline length
    check(closed >= nB, `${label}: ${closed} closed loops < ${nB} blocks`);
    c.lanes.forEach((l, i) => {
      const cum = cums[i];
      check(Number.isFinite(l.length) && l.length > 0 && Math.abs(cum[cum.length - 1] - l.length) < 1e-6, `${label}: lane ${i} length`);
    });
    const perLoop = new Map<number, number>();
    for (const p of c.props) if (p.lane >= 0 && c.lanes[p.lane].closed) perLoop.set(p.lane, (perLoop.get(p.lane) ?? 0) + 1);
    const loopCars = [...perLoop.values()];
    const avgLoop = loopCars.reduce((a, v) => a + v, 0) / Math.max(1, closed);
    console.log(`   traffic per loop: avg ${fmt(avgLoop, 2)} (biome.trafficPerLane ${biome.trafficPerLane})`);
    check(avgLoop >= biome.trafficPerLane * 0.9 - 1e-9, `${label}: loops under-populated`);
    if (bid === 'lockwater') check(c.props.every((p) => p.lane < 0 || p.kind === 'boat'), `${label}: LOCKWATER traffic must be boats`);

    // crosswalks: every leg of every intersection = 2·bx·(bz+1) + 2·bz·(bx+1)
    const expCw = 2 * c.blocksX * (c.blocksZ + 1) + 2 * c.blocksZ * (c.blocksX + 1);
    check(c.crosswalks.length === expCw, `${label}: crosswalks ${c.crosswalks.length} ≠ ${expCw}`);
    for (const cw of c.crosswalks) check(cw.len === CITY.roadW && cw.width === CITY.crosswalkW, `${label}: crosswalk size`);

    // spawn
    const s = c.spawn;
    const onCw = c.crosswalks.filter((cw) => {
      const hx = cw.axis === 'x' ? cw.len / 2 : cw.width / 2, hz = cw.axis === 'z' ? cw.len / 2 : cw.width / 2;
      return Math.abs(s.x - cw.x) <= hx + 1e-6 && Math.abs(s.z - cw.z) <= hz + 1e-6;
    });
    check(onCw.length > 0, `${label}: spawn is not on a crosswalk`);
    if (onCw.length) {
      const cw = onCw[0];
      const hx = Math.sin(s.heading), hz = Math.cos(s.heading);
      const alongCross = cw.axis === 'x' ? Math.abs(hx) : Math.abs(hz);
      check(alongCross > 0.999, `${label}: spawn heading not along the crossing (axis ${cw.axis}, dir ${fmt(hx, 2)},${fmt(hz, 2)})`);
      check(Math.hypot(s.x - cw.x, s.z - cw.z) < 0.5, `${label}: spawn not in the middle of the zebra`);
    }
    const near = c.props.filter((p) => Math.hypot(p.x - s.x, p.z - s.z) <= 8);
    const nearCars = near.filter((p) => isVehicle(p.kind) && p.lane < 0 && p.kind !== 'boat');
    const nearKiosk = near.filter((p) => p.kind === 'kiosk');
    console.log(`   spawn food within 8 m: ${near.map((p) => `${p.kind}@${fmt(Math.hypot(p.x - s.x, p.z - s.z))}`).join(' ')}`);
    check(nearCars.length >= 2, `${label}: only ${nearCars.length} parked cars within 8 m of the spawn`);
    check(nearKiosk.length >= 1, `${label}: no kiosk within 8 m of the spawn`);
    // near-but-not-at downtown: tallest-weighted centroid of tier 3–4 buildings
    let wx = 0, wz = 0, ws = 0;
    for (const b of c.buildings) if (b.tier >= 3) { const m = b.floors * b.floorH; wx += b.x * m; wz += b.z * m; ws += m; }
    const dDown = Math.hypot(s.x - wx / ws, s.z - wz / ws);
    const nearestTall = Math.min(...c.buildings.filter((b) => b.tier >= 3).map((b) => Math.hypot(b.x - s.x, b.z - s.z)));
    console.log(`   spawn → skyline centroid ${fmt(dDown)} m · nearest tier≥3 building ${fmt(nearestTall)} m`);
    check(dDown < 5 * c.pitch, `${label}: spawn far from downtown (${fmt(dDown)} m)`);
    check(s.x > c.bounds.minX && s.x < c.bounds.maxX && s.z > c.bounds.minZ && s.z < c.bounds.maxZ, `${label}: spawn outside bounds`);

    // bounds contain the whole grid
    check(c.bounds.minX <= c.originX && c.bounds.maxX >= c.originX + c.blocksX * c.pitch
      && c.bounds.minZ <= c.originZ && c.bounds.maxZ >= c.originZ + c.blocksZ * c.pitch, `${label}: bounds do not contain the grid`);

    // LOCKWATER harbour
    if (biome.flooded) {
      const waterZ = c.originZ - CITY.roadW / 2;
      check(c.flooded, `${label}: flooded flag not set`);
      check(c.buildings.every((b) => b.z - b.d / 2 > waterZ), `${label}: a building stands in the harbour water`);
      const quay = c.buildings.filter((b) => Math.floor(b.block / c.blocksX) === 0);
      check(quay.length > 0 && quay.every((b) => b.shape === 'gantry' || b.shape === 'containers'), `${label}: quay row must be gantries/containers only`);
      check(quay.some((b) => b.shape === 'gantry'), `${label}: no gantry on the quay`);
      const boats = c.props.filter((p) => p.kind === 'boat' && p.z < waterZ);
      check(boats.length >= c.blocksX, `${label}: only ${boats.length} boats on the harbour water`);
      check(c.bounds.minZ < waterZ - 40, `${label}: bounds do not let the titan wade into the harbour`);
      console.log(`   harbour: quay buildings ${quay.length} (gantries ${quay.filter((b) => b.shape === 'gantry').length}) · boats on water ${boats.length}`);
    } else {
      check(!c.flooded, `${label}: flooded flag set on a dry biome`);
    }
  }
  // different seeds → different cities
  check(cityHash(cities[`${bid}:${SEEDS[0]}`]) !== cityHash(cities[`${bid}:${SEEDS[1]}`]), `${bid}: seeds ${SEEDS[0]} and ${SEEDS[1]} produced identical cities`);
}

function distToLane(l: Lane, x: number, z: number): number {
  const n = l.pts.length / 2;
  const segs = l.closed ? n : n - 1;
  let best = Infinity;
  for (let i = 0; i < segs; i++) {
    const a = i, b = (i + 1) % n;
    best = Math.min(best, segDist(x, z, l.pts[a * 2], l.pts[a * 2 + 1], l.pts[b * 2], l.pts[b * 2 + 1]));
  }
  return best;
}

// ═════════════════════════════ minimal hand-built world ═════════════════════════════
function miniWorld(biome: BiomeId, seed: number): World {
  const rng = makeStreams(seed);
  const city = generateCity(BIOMES[biome], seed, rng.city);
  const titan = {
    id: 'molo', x: city.spawn.x, z: city.spawn.z, heading: city.spawn.heading,
    px: city.spawn.x, pz: city.spawn.z, pheading: city.spawn.heading,
    vx: 0, vz: 0, speed: 0, moving: false, hp: 100, maxHp: 100, level: 1, xp: 0, xpToNext: 10,
    mass: 0, rank: 0, height: 1.2, radius: 0.5, growT: 0,
    dashCharges: 1, dashRecharge: 0, dashT: 0, dashDirX: 0, dashDirZ: 0, iframeT: 0, abilityCd: 0, autoCd: 0,
    stepAcc: 0, slowT: 0, slowMul: 1, leash: null, stats: {} as never, kit: {}, alive: true,
    kills: 0, crushed: 0, floorsEaten: 0, buildingsLeveled: 0, propsEaten: 0, damageTaken: 0,
  };
  return {
    seed, titanId: 'molo', biomeId: biome, tick: 0, t: 0, dt: SIM_DT, rng, city,
    titan: titan as unknown as World['titan'],
    enemies: [], projectiles: [], telegraphs: [], hazards: [], pickups: [], boss: null,
    director: { wave: 0, nextWaveT: 0, spawnBudget: 0, eliteT: Infinity, elitesSpawned: 0, bossT: Infinity, bossSpawned: false, squadSeq: 0, data: {} },
    upgrades: { owned: {}, order: [], pendingDrafts: 0, offer: null, rerolls: 0, icd: {}, buffs: [], shield: 0, chestDrafts: 0, banished: [], banishLeft: 2, lockLeft: 2, locked: null },
    run: { phase: 'waves', endT: -1, result: null, tonnage: 0, blocksLeveled: 0, peakRank: 0 },
    events: [], input: { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false },
    cheats: { god: false, noSpawns: false }, nextId: 1,
    // v2 World fields (FEATURES_V2 §2.3; L0 tsc completion — the city probe never reads them;
    // ult is a stand-in so this probe keeps its light import chain)
    meta: { unlocked: [], perk: null, palette: 0, reviveUsed: false },
    ult: {} as unknown as World['ult'], map: createMapState(), tally: createTally(), endless: null,
    gates: {} as unknown as World['gates'],   // GATEKEEPERS (K0): the city probe never reads the gate state
  };
}
function tickPrev(w: World): void {
  w.events.length = 0;
  for (const p of w.city.props) if (p.lane >= 0) { p.px = p.x; p.pz = p.z; p.pheading = p.heading; }
  w.tick++; w.t += w.dt;
}

// ═════════════════════════════ 2. traffic ═════════════════════════════
console.log('== 2. TRAFFIC');
for (const bid of BIOME_LIST) {
  const w = miniWorld(bid, 7);
  const c = w.city;
  w.titan.x = c.bounds.maxX + 500; w.titan.z = c.bounds.maxZ + 500;   // titan far away: free flow
  const cars = c.props.filter((p) => p.lane >= 0);
  const s0 = cars.map((p) => p.laneS);
  const cums = c.lanes.map((l) => laneCum(l));
  let tSum = 0;
  let maxSpeed = 0, minSpeedMoving = Infinity, headingErr = 0, maxTurn = 0, overlaps = 0, listFails = 0, nonFinite = 0;
  const TICKS = 300;
  for (let k = 0; k < TICKS; k++) {
    tickPrev(w);
    const t0 = performance.now();
    stepTraffic(w);
    tSum += performance.now() - t0;
    for (const p of cars) {
      if (![p.x, p.z, p.heading, p.speed, p.laneS].every(Number.isFinite)) nonFinite++;
      maxSpeed = Math.max(maxSpeed, p.speed);
      // step displacement heading vs reported heading on STRAIGHTS (heading unchanged this tick);
      // inside rounded corners the smoothed ±1 m tangent legitimately leads the piecewise chord
      const dx = p.x - p.px, dz = p.z - p.pz, dl = Math.hypot(dx, dz);
      const turn = Math.abs(Math.atan2(Math.sin(p.heading - p.pheading), Math.cos(p.heading - p.pheading)));
      if (dl < 1) maxTurn = Math.max(maxTurn, turn);          // (skip open-lane wrap teleports)
      if (dl > 0.2 && dl < 1 && turn < 1e-6) {
        const e = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - p.heading), Math.cos(Math.atan2(dx, dz) - p.heading)));
        headingErr = Math.max(headingErr, e);
      }
    }
    if (k === TICKS - 1) {
      for (const p of cars) if (p.speed > 1) minSpeedMoving = Math.min(minSpeedMoving, p.speed);
      // same-lane overlap check
      const byLane = new Map<number, Prop[]>();
      for (const p of cars) { const a = byLane.get(p.lane) ?? []; a.push(p); byLane.set(p.lane, a); }
      for (const [li, list] of byLane) {
        list.sort((a, b) => a.laneS - b.laneS);
        const L = c.lanes[li].length;
        for (let i = 0; i < list.length; i++) {
          const a = list[i], b = list[(i + 1) % list.length];
          if (a === b) continue;
          if (i === list.length - 1 && !c.lanes[li].closed) continue;
          let gap = b.laneS - a.laneS; if (gap < 0) gap += L;
          if (gap < (PROP_INFO[a.kind].len + PROP_INFO[b.kind].len) / 2 - 0.05) overlaps++;
        }
      }
      // listing invariant
      for (const p of c.props) if (c.blockProps[cellOf(c, p.x, p.z)].indexOf(p.id) < 0) listFails++;
      let total = 0; for (const l of c.blockProps) total += l.length;
      if (total !== c.props.length) listFails++;
    }
  }
  const moved = cars.filter((p, i) => Math.abs(p.laneS - s0[i]) > 1).length;
  console.log(`-- ${bid}: ${cars.length} cars · moved ${moved} · speed max ${fmt(maxSpeed, 2)} min(moving) ${fmt(minSpeedMoving, 2)} · heading err ${fmt(headingErr, 3)} rad · max turn/tick ${fmt(maxTurn, 3)} rad · ${fmt((tSum / TICKS) * 1000, 0)} µs/tick`);
  check(nonFinite === 0, `${bid}: non-finite traffic state`);
  check(moved >= cars.length * 0.9, `${bid}: only ${moved}/${cars.length} cars moved in ${TICKS} ticks`);
  check(maxSpeed <= 12 + 1e-6, `${bid}: free-flow speed ${fmt(maxSpeed)} > 12 m/s`);
  check(headingErr < 0.02, `${bid}: heading deviates from the travel direction on straights by ${fmt(headingErr, 3)} rad`);
  check(maxTurn < 0.2, `${bid}: heading snaps ${fmt(maxTurn, 3)} rad in one tick (corners must turn smoothly)`);
  check(overlaps === 0, `${bid}: ${overlaps} same-lane car overlaps`);
  check(listFails === 0, `${bid}: blockProps listing broken for moving cars`);
  void cums;

  // scare: park the titan 4 m ahead of a loop car on a straight
  const car = cars.find((p) => c.lanes[p.lane].closed && p.speed > 7)!;
  const T = w.titan;
  T.height = 5; T.radius = 2.1;
  T.x = car.x + Math.sin(car.heading) * 6; T.z = car.z + Math.cos(car.heading) * 6;
  const sBefore = car.laneS;
  let minV = Infinity;
  for (let k = 0; k < 45; k++) { tickPrev(w); stepTraffic(w); minV = Math.min(minV, car.speed); }
  console.log(`   scare test: car ${car.id} scared=${fmt(car.scared, 2)} min speed ${fmt(minV, 2)} Δs ${fmt(car.laneS - sBefore, 2)} m`);
  check(car.scared > 0, `${bid}: car did not get scared by the titan ahead`);
  check(minV <= 0.01, `${bid}: car did not brake/reverse in front of the titan (min speed ${fmt(minV)})`);
  // destroyed car leaves the lane: kill the next car ahead of another car and step
  const dead = cars.find((p) => p !== car && p.alive)!;
  dead.alive = false;
  const deadS = dead.laneS;
  for (let k = 0; k < 10; k++) { tickPrev(w); stepTraffic(w); }
  check(dead.laneS === deadS, `${bid}: destroyed car kept driving`);
  // determinism
  const wa = miniWorld(bid, 11), wb = miniWorld(bid, 11);
  for (const ww of [wa, wb]) { ww.titan.x = 0; ww.titan.z = 0; ww.titan.height = 14; ww.titan.radius = 5.9; for (let k = 0; k < 200; k++) { tickPrev(ww); ww.titan.x += 0.5; stepTraffic(ww); } }
  const ha = hashStr(JSON.stringify(wa.city.props)), hb = hashStr(JSON.stringify(wb.city.props));
  check(ha === hb, `${bid}: traffic not deterministic`);
}

// ═════════════════════════════ 3. city sim ═════════════════════════════
console.log('== 3. CITY SIM');
type CitySim = typeof import('../src/city/citysim.ts');
let CS: CitySim | null = null;
let pickupsMode = 'real combat/pickups.ts';
const stubCalls: { kind: string; x: number; z: number; xp: number; mass: number }[] = [];
try {
  await import('../src/combat/pickups.ts');
  CS = await import('../src/city/citysim.ts');
} catch (err) {
  const why = String((err as Error).message).split('\n')[0];
  pickupsMode = `STUB spawnPickup (real combat/pickups.ts not loadable: ${why})`;
  // swap ONLY combat/pickups.ts for a recording stub so citysim's own logic can be exercised
  const mod = await import('node:module') as unknown as { registerHooks?: (h: unknown) => void };
  if (typeof mod.registerHooks !== 'function') {
    console.log('  SKIP city sim: node:module registerHooks unavailable in this Node version');
  } else {
    (globalThis as Record<string, unknown>).__PROBE_PICKUP__ = (w: World, kind: string, x: number, z: number, xp: number, mass: number) => {
      stubCalls.push({ kind, x, z, xp, mass });
      w.pickups.push({ id: w.nextId++, alive: true, kind: kind as never, x, z, y: 0, px: x, pz: z, py: 0, vx: 0, vz: 0, vy: 0, xp, mass, t: 0, magnet: false });
    };
    const STUB = 'data:text/javascript,' + encodeURIComponent(
      'export function spawnPickup(...a){ globalThis.__PROBE_PICKUP__(...a); }\n' +
      'export function stepPickups(){}\nexport function magnetAll(){ return 0; }\n');
    mod.registerHooks({
      resolve(spec: string, ctx: unknown, next: (s: string, c: unknown) => unknown) {
        if (/combat[\\/]pickups\.ts$/.test(spec)) return { url: STUB, shortCircuit: true };
        return next(spec, ctx);
      },
    });
    const stubbedSpec = '../src/city/citysim.ts?probe-stub';   // fresh module instance that sees the stub
    CS = await import(stubbedSpec) as CitySim;
  }
}
console.log(`   pickups: ${pickupsMode}`);

if (CS) {
  const { buildingsInRect, propsInRect, blockOf, buildingById, damageBuilding, damageProp, resolveCircleVsCity, nearestRubble, stepCity } = CS;
  const w = miniWorld('grideast', 7);
  const c = w.city;
  const r = mulberry32(4242);
  const out: number[] = [];

  // rect queries vs brute force
  let rectFails = 0;
  for (let k = 0; k < 400; k++) {
    const x0 = c.bounds.minX + r() * (c.bounds.maxX - c.bounds.minX), z0 = c.bounds.minZ + r() * (c.bounds.maxZ - c.bounds.minZ);
    const sz = r() < 0.5 ? 2 + r() * 30 : 30 + r() * 200;
    const minX = x0 - sz / 2, maxX = x0 + sz / 2, minZ = z0 - sz * 0.3, maxZ = z0 + sz * 0.7;
    const got = buildingsInRect(c, minX, minZ, maxX, maxZ, out).slice().sort((a, b) => a - b);
    const exp = c.buildings.filter((b) => !b.collapsed && b.x + b.w / 2 >= minX && b.x - b.w / 2 <= maxX && b.z + b.d / 2 >= minZ && b.z - b.d / 2 <= maxZ).map((b) => b.id);
    if (got.join(',') !== exp.join(',')) rectFails++;
    const gotP = propsInRect(c, minX, minZ, maxX, maxZ, out).slice().sort((a, b) => a - b);
    const expP = c.props.filter((p) => { const pr = 0.5 * Math.hypot(PROP_INFO[p.kind].len, PROP_INFO[p.kind].wid); return p.alive && p.x + pr >= minX && p.x - pr <= maxX && p.z + pr >= minZ && p.z - pr <= maxZ; }).map((p) => p.id);
    if (gotP.join(',') !== expP.join(',')) rectFails++;
  }
  check(rectFails === 0, `rect queries disagree with brute force in ${rectFails} cases`);
  console.log(`   rect queries: 400 random rects × 2 vs brute force → ${rectFails} mismatches`);

  // blockOf / buildingById
  check(blockOf(c, c.originX - 1, 0) === -1 && blockOf(c, 0, c.originZ + c.blocksZ * c.pitch + 1) === -1, 'blockOf must be −1 outside the grid');
  const b0 = c.buildings[c.buildings.length >> 1];
  check(blockOf(c, b0.x, b0.z) === b0.block, 'blockOf(building centre) ≠ building.block');
  check(buildingById(c, b0.id) === b0, 'buildingById');

  // damageBuilding: pick a tier-2 building with ≥ 6 floors (else the tallest tier-2)
  const t2 = c.buildings.filter((b) => b.tier === 2).sort((a, b) => b.floors - a.floors)[0];
  w.titan.x = t2.x + t2.w / 2 + 3; w.titan.z = t2.z;         // titan just east of it
  const fhp = t2.floorHpMax;
  const pk0 = w.pickups.length;
  w.events.length = 0;
  let broke = damageBuilding(w, t2.id, fhp * 0.5, { src: 'titan', kind: 'bite' });
  check(broke === 0 && t2.alive === t2.floors && Math.abs(t2.floorHp - fhp * 0.5) < 1e-9, 'half a floor of damage must not break a floor');
  broke = damageBuilding(w, t2.id, fhp * 0.5 + fhp * 10, { src: 'titan', kind: 'smash' });
  const fb = w.events.filter((e) => e.type === 'floorBreak');
  const sm = w.events.filter((e) => e.type === 'smash');
  const pk1 = w.pickups.length - pk0;
  console.log(`   damageBuilding tier-2 ${t2.arch} (${t2.floors} fl): huge hit broke ${broke} floors · floorBreak ${fb.length} · smash ${sm.length} · rubble pickups ${pk1} · alive ${t2.alive}`);
  check(broke === Math.min(4, t2.floors) && fb.length === broke, `a huge hit must break exactly min(4, floors) floors (got ${broke})`);
  check(sm.length === 1, 'contact (smash) hit must emit exactly one smash event');
  check(pk1 >= broke && pk1 <= broke * 3, `rubble pickups per broken floor must be 1–3 (got ${pk1} for ${broke})`);
  check(w.titan.floorsEaten === broke, 'titan.floorsEaten not credited');
  check(w.run.tonnage === broke * TIERS[2].tonsPerFloor, 'run.tonnage not credited per floor');
  // rubble sits at the footprint edge nearest the titan (east face)
  const newPk = w.pickups.slice(pk0);
  check(newPk.every((p) => p.kind === 'rubble' && p.x > t2.x), 'rubble must drop on the titan side of the footprint');
  const xpSum = newPk.reduce((a, p) => a + p.xp, 0), massSum = newPk.reduce((a, p) => a + p.mass, 0);
  check(Math.abs(xpSum - broke * TIERS[2].floorXp) < 1e-6 && Math.abs(massSum - broke * TIERS[2].floorMass) < 1e-6, `rubble worth must equal floors × TIERS[2] (xp ${xpSum}, mass ${massSum})`);

  // collapse every building in t2's block (so the block levels)
  const blockIds = c.blockBuildings[t2.block].slice();
  const lv0 = w.run.blocksLeveled;
  let collapses = 0;
  const allEv: SimEvent[] = [];
  for (const id of blockIds) {
    const b = c.buildings[id];
    for (let guard = 0; guard < 50 && !b.collapsed; guard++) {
      w.events.length = 0;
      damageBuilding(w, id, 1e9, { src: 'titan', kind: 'stomp' });
      allEv.push(...w.events);
    }
    if (b.collapsed) collapses++;
  }
  const ce = allEv.filter((e) => e.type === 'buildingCollapse');
  console.log(`   collapse: block ${t2.block} (${blockIds.length} buildings) → collapses ${collapses} · events ${ce.length} · buildingsLeveled ${w.titan.buildingsLeveled} · blocksLeveled ${lv0}→${w.run.blocksLeveled} · tonnage ${w.run.tonnage}`);
  check(collapses === blockIds.length && ce.length === blockIds.length, 'every building in the block must collapse with one event each');
  check(blockIds.every((id) => c.buildings[id].alive === 0 && c.buildings[id].collapsed), 'collapsed buildings must have alive 0');
  check(w.titan.buildingsLeveled === blockIds.length, 'titan.buildingsLeveled not credited');
  check(w.run.blocksLeveled === lv0 + 1, `run.blocksLeveled must increment once for the fully levelled block (got ${w.run.blocksLeveled})`);
  check(damageBuilding(w, t2.id, 1e9, { src: 'titan', kind: 'bite' }) === 0, 'a collapsed building must not take damage');
  const ev = ce.find((e) => (e as Extract<SimEvent, { type: 'buildingCollapse' }>).id === t2.id) as Extract<SimEvent, { type: 'buildingCollapse' }> | undefined;
  check(!!ev && ev.h === t2.floors * t2.floorH && ev.w === t2.w && ev.d === t2.d && ev.tier === t2.tier, 'buildingCollapse event carries the footprint + original height');
  // stepCity re-derivation keeps the count
  w.tick = 29; w.t = w.tick * w.dt;
  tickPrev(w); stepCity(w);
  check(w.run.blocksLeveled === lv0 + 1, 'stepCity re-derivation changed blocksLeveled');
  // hostile source does not credit the titan
  const other = c.buildings.find((b) => !b.collapsed && b.tier === 1)!;
  const fe = w.titan.floorsEaten;
  damageBuilding(w, other.id, 1e9, { src: 'enemy', kind: 'ram' });
  check(w.titan.floorsEaten === fe, 'enemy damage must not credit titan.floorsEaten');

  // damageProp
  const car = c.props.find((p) => p.kind === 'car' && p.lane < 0 && p.alive)!;
  const kiosk = c.props.find((p) => p.kind === 'kiosk' && p.alive)!;
  const pe0 = w.titan.propsEaten;
  w.events.length = 0;
  const pkA = w.pickups.length;
  check(!damageProp(w, car.id, 1, { src: 'titan', kind: 'bite' }), 'a 1-damage bite must not destroy a 3-hp car');
  check(damageProp(w, car.id, 5, { src: 'titan', kind: 'smash' }), 'a smash must destroy the car');
  const pd = w.events.find((e) => e.type === 'propDestroyed') as Extract<SimEvent, { type: 'propDestroyed' }> | undefined;
  check(!!pd && pd.crushed && pd.id === car.id && pd.kind === 'car', 'propDestroyed (crushed) event');
  const carPk = w.pickups.length - pkA;
  check(carPk >= 1 && carPk <= 3, `car must drop 1–3 pickups (got ${carPk})`);
  check(!damageProp(w, car.id, 5, { src: 'titan', kind: 'smash' }), 'a dead prop cannot be destroyed twice');
  w.events.length = 0;
  check(damageProp(w, kiosk.id, 99, { src: 'titan', kind: 'arc' }), 'kiosk destroyed by an arc');
  const pd2 = w.events.find((e) => e.type === 'propDestroyed') as Extract<SimEvent, { type: 'propDestroyed' }> | undefined;
  check(!!pd2 && !pd2.crushed, 'non-contact kill must not be flagged crushed');
  check(w.titan.propsEaten === pe0 + 2, 'titan.propsEaten not credited');
  check(propsInRect(c, car.x - 1, car.z - 1, car.x + 1, car.z + 1, out).indexOf(car.id) < 0, 'dead props must drop out of propsInRect');

  // resolveCircleVsCity
  const res = { x: 0, z: 0, bumpTier: -1 };
  const NO_FLATTEN = -1 as unknown as Tier;                  // what ai/enemies.ts passes
  const t3 = c.buildings.find((b) => b.tier === 3 && b.shape === 'box' && !b.collapsed)!;
  const cx0 = t3.x + t3.w / 2 + 0.5, cz0 = t3.z;                    // circle r 2 poking 1.5 m into the east face
  check(resolveCircleVsCity(c, cx0, cz0, 2, 1, res), 'tier-3 building must block a Size II circle');
  check(Math.abs(res.x - (t3.x + t3.w / 2 + 2)) < 1e-6 && Math.abs(res.z - cz0) < 1e-6 && res.bumpTier === 3, `push-out wrong: (${fmt(res.x, 3)}, ${fmt(res.z, 3)}) bump ${res.bumpTier}`);
  check(!resolveCircleVsCity(c, cx0, cz0, 2, 3, res) && res.x === cx0 && res.z === cz0 && res.bumpTier === -1, 'a flattenable tier must not block');
  check(resolveCircleVsCity(c, t3.x + 0.3, t3.z, 1, 0, res) && (Math.abs(res.x - t3.x) >= t3.w / 2 + 1 - 1e-6 || Math.abs(res.z - t3.z) >= t3.d / 2 + 1 - 1e-6), 'a centre inside the footprint must exit through a face');
  const t2b = c.buildings.find((b) => b.collapsed)!;
  check(!resolveCircleVsCity(c, t2b.x, t2b.z, 1, 0, res), 'collapsed buildings never block');
  const lamp = c.props.find((p) => p.kind === 'lamp' && p.alive && c.buildings.every((b) => Math.abs(p.x - b.x) > b.w / 2 + 3 || Math.abs(p.z - b.z) > b.d / 2 + 3))!;
  check(!resolveCircleVsCity(c, lamp.x + 0.2, lamp.z, 0.45, NO_FLATTEN, res), 'tier-0 props (lamps) never block, even enemies');
  const big = c.props.find((p) => p.tier === 1 && p.alive);
  if (big) {
    check(resolveCircleVsCity(c, big.x, big.z, 0.45, NO_FLATTEN, res) && res.bumpTier === 1, 'tier-1 props (bus/truck/container) block enemies');
    check(resolveCircleVsCity(c, big.x, big.z, 0.5, 0, res), 'tier-1 props block a Size I titan');
    check(!resolveCircleVsCity(c, big.x, big.z, 2, 1, res) || res.bumpTier > 1, 'tier-1 props do not block Size II');
  } else console.log('   (no tier-1 prop in this city — tier-1 prop blocking not exercised)');
  // circle clear of everything → unchanged
  check(!resolveCircleVsCity(c, c.spawn.x, c.spawn.z, 0.5, 0, res) && res.x === c.spawn.x && res.bumpTier === -1, 'spawn circle must be free');

  // nearestRubble
  const rub = nearestRubble(c, t2.x, t2.z, 200, 3, out).slice();
  check(rub.length > 0 && rub.length <= 3 && rub[0] === t2.id, `nearestRubble must return the collapsed building first (got ${rub.join(',')})`);
  check(rub.every((id) => c.buildings[id].collapsed), 'nearestRubble must return collapsed buildings only');
  const dists = rub.map((id) => { const b = c.buildings[id]; return Math.hypot(t2.x - Math.min(Math.max(t2.x, b.x - b.w / 2), b.x + b.w / 2), t2.z - Math.min(Math.max(t2.z, b.z - b.d / 2), b.z + b.d / 2)); });
  check(dists.every((d, i) => i === 0 || d >= dists[i - 1]), 'nearestRubble not sorted by distance');
  check(nearestRubble(c, t2.x, t2.z, 200, 0, out).length === 0, 'nearestRubble max 0');

  // stepCity: traffic advances, no throw
  const trafficCar = c.props.find((p) => p.lane >= 0 && p.alive)!;
  w.titan.x = c.bounds.maxX + 500;
  const s0 = trafficCar.laneS;
  for (let k = 0; k < 30; k++) { tickPrev(w); stepCity(w); }
  check(trafficCar.laneS !== s0, 'stepCity must step traffic');
  if (stubCalls.length) console.log(`   stub spawnPickup calls: ${stubCalls.length}`);
} else {
  fail('city sim not exercised (citysim.ts could not be loaded)');
}

// ═════════════════════════════ 4. repair crews (rebuild) ═════════════════════════════
// city/citysim.ts REPAIR CREWS: a depleted city is rebuilt AWAY from the titan, gradually (scaffold → storeys),
// deterministically (world.rng.city); rebuilt storeys are ordinary floors (normal smash XP); a building under
// construction that takes a hit is abandoned; nothing is ever added under the titan / a live boss / a heal pickup;
// blocksLeveled never goes down; a healthy city gets no crews.
console.log('== 4. REPAIR CREWS');
/** SLOW construction floor: no rebuilt building tops out faster than this from groundbreak (b3005a22 did in 4.6 s). */
const SLOW_MIN_SITE_S = 24;
/** Timing tolerance for the storey-pace checks: one sim tick (progress accumulates dt in a Float32Array). */
const SLOW_TOL = 1.5 / 30;
if (CS) {
  const RB = CS;
  type RbEv = Extract<SimEvent, { type: 'rebuild' }>;
  const foot = (b: { x: number; z: number; w: number; d: number }, x: number, z: number) =>
    Math.hypot(x - Math.min(Math.max(x, b.x - b.w / 2), b.x + b.w / 2), z - Math.min(Math.max(z, b.z - b.d / 2), b.z + b.d / 2));
  const standing = (w: World) => { let s = 0; for (const b of w.city.buildings) s += b.collapsed ? 0 : b.alive; return s; };
  /** Size IV titan parked at the city centre; every building but id % 7 === 0 levelled at t = 100 s. */
  const depleted = (bid: BiomeId, seed: number): World => {
    const w = miniWorld(bid, seed);
    const T = w.titan;
    T.x = 0; T.z = 0; T.px = 0; T.pz = 0; T.rank = 3; T.height = 32; T.radius = 32 * 0.42;
    w.tick = 3000; w.t = 100;
    for (const b of w.city.buildings) {
      if (b.id % 7 === 0) continue;
      for (let g = 0; g < 80 && !b.collapsed; g++) CS!.damageBuilding(w, b.id, 1e9, { src: 'titan', kind: 'stomp' });
    }
    w.pickups.length = 0;          // the scenario's rubble is not the subject (heal pickups would hold lots)
    w.events.length = 0;
    return w;
  };

  // 4a. a healthy city: no crews, no rebuild events
  {
    const w = miniWorld('grideast', 7);
    w.titan.x = 0; w.titan.z = 0;
    let evs = 0;
    for (let k = 0; k < 30 * 20; k++) { tickPrev(w); CS.stepCity(w); evs += w.events.filter((e) => e.type === 'rebuild').length; }
    const st = RB.rebuildStats(w);
    console.log(`   healthy city (100 % standing, 20 s): crews ${st.started} · rebuild events ${evs}`);
    check(st.started === 0 && evs === 0, `a healthy city must get no repair crews (started ${st.started}, events ${evs})`);
  }

  // 4b. a depleted city over 120 s with the titan parked at the centre
  const runDepleted = (bid: BiomeId, seed: number, secs: number) => {
    const w = depleted(bid, seed);
    const c = w.city;
    const total = c.buildings.reduce((s, b) => s + b.floors, 0);
    const frac0 = standing(w) / total;
    const lv0 = w.run.blocksLeveled;
    const startR = RB.rebuildStartR(w), nearR = RB.rebuildNearR(w);
    let starts = 0, floors = 0, dones = 0, badStart = 0, badFloor = 0, badFirst = 0, badDone = 0, early = 0, overCap = 0, lvDown = 0, badTarget = 0;
    // SLOW construction (owner 2026-10-01: rebuilding is never instant): per site the groundbreak time, the last storey
    // time and the storeys raised; a storey never comes faster than rebuildFloorS, the first never before site prep +
    // one storey, a site never tops out before prep + floors x storey time nor under SLOW_MIN_SITE_S, never two storeys
    // of one building in a tick, and every topped-out site raised all of its storeys one by one
    const t0 = new Map<number, number>(), tl = new Map<number, number>(), nFl = new Map<number, number>();
    let fastFloor = 0, fastFirst = 0, fastSite = 0, shortSite = 0, popped = 0, minSite = Infinity;
    let lvPrev = lv0;
    const seq: number[] = [];
    for (let k = 0; k < 30 * secs; k++) {
      const pre = standing(w) / total;
      tickPrev(w); CS!.stepCity(w);
      const bk = RB.rebuildBook(c);
      if (bk.crews.length > RB.REBUILD_MAX_CREWS) overCap++;
      let fl = 0;
      for (const e of w.events) {
        if (e.type !== 'rebuild') continue;
        const ev = e as RbEv;
        const b = c.buildings[ev.id];
        seq.push(ev.id * 4 + (ev.stage === 'start' ? 0 : ev.stage === 'floor' ? 1 : 2), ev.alive);
        if (ev.stage === 'start') {
          starts++;
          if (foot(b, w.titan.x, w.titan.z) < startR) badStart++;
          if (w.t - bk.downT[b.id] < RB.REBUILD_MIN_DOWN_S - 1e-9) early++;
          t0.set(b.id, w.t); tl.set(b.id, -1); nFl.set(b.id, 0);
        } else if (ev.stage === 'floor') {
          floors++; fl++;
          if (foot(b, w.titan.x, w.titan.z) < nearR) badFloor++;
          if (ev.alive === 1 && (b.collapsed || b.alive !== 1 || b.floorHp !== b.floorHpMax)) badFirst++;
          const s0 = t0.get(b.id);
          if (s0 !== undefined) {
            const last = tl.get(b.id) ?? -1;
            if (last === w.t) popped++;                                                   // two storeys in one tick
            else if (last < 0) { if (w.t - s0 < RB.rebuildScaffoldS(b) + RB.rebuildFloorS(b) - SLOW_TOL) fastFirst++; }
            else if (w.t - last < RB.rebuildFloorS(b) - SLOW_TOL) fastFloor++;
            tl.set(b.id, w.t); nFl.set(b.id, (nFl.get(b.id) ?? 0) + 1);
          }
        } else {
          dones++;
          if (b.collapsed || b.alive !== b.floors || bk.stage[b.id] !== RB.RB_NONE) badDone++;
          const s0 = t0.get(b.id);
          if (s0 !== undefined) {
            const d = w.t - s0;
            minSite = Math.min(minSite, d);
            if (d < RB.rebuildScaffoldS(b) + b.floors * RB.rebuildFloorS(b) - SLOW_TOL * (b.floors + 1)) fastSite++;
            if (d < SLOW_MIN_SITE_S) shortSite++;
            if ((nFl.get(b.id) ?? 0) !== b.floors) popped++;
            t0.delete(b.id);
          }
        }
      }
      // a crew is only dispatched while standing (after this tick's finished storeys) is below the target
      if (w.events.some((e) => e.type === 'rebuild' && (e as RbEv).stage === 'start') && pre + fl / total >= RB.REBUILD_TARGET) badTarget++;
      if (w.run.blocksLeveled < lvPrev) lvDown++;
      lvPrev = w.run.blocksLeveled;
    }
    const st = RB.rebuildStats(w);
    // sites visibly mid-construction at the end: storeys going up, neither rubble nor topped out
    const bk = RB.rebuildBook(c);
    const mid = bk.crews.filter((id) => bk.stage[id] === RB.RB_RISING && !c.buildings[id].collapsed && c.buildings[id].alive < c.buildings[id].floors).length;
    return { w, frac0, frac1: standing(w) / total, starts, floors, dones, badStart, badFloor, badFirst, badDone, early, overCap, lvDown, badTarget, st, seq, lv0, startR, nearR,
      fastFloor, fastFirst, fastSite, shortSite, popped, minSite, mid };
  };
  for (const bid of BIOME_LIST) {
    const a = runDepleted(bid, 7, 120);
    const b2 = runDepleted(bid, 7, 120);
    console.log(`   ${bid} depleted (${(a.frac0 * 100).toFixed(0)} % standing, Size IV titan at the centre, startR ${a.startR.toFixed(0)} m nearR ${a.nearR.toFixed(0)} m), 120 s: `
      + `crews ${a.starts} · storeys ${a.floors} · topped out ${a.dones} · standing → ${(a.frac1 * 100).toFixed(1)} % · active ${a.st.active} · mid-construction ${a.mid} · fastest site ${a.minSite.toFixed(1)} s`);
    check(a.starts > 0 && a.floors > 0 && a.dones > 0, `${bid}: a depleted city must get crews that raise storeys and top out buildings`);
    check(a.st.started === a.starts && a.st.floors === a.floors && a.st.done === a.dones, `${bid}: rebuildStats disagree with the rebuild events`);
    check(a.frac1 > a.frac0, `${bid}: standing floors must grow (${a.frac0} → ${a.frac1})`);
    check(a.badStart === 0, `${bid}: ${a.badStart} crews set up inside rebuildStartR of the titan`);
    check(a.badFloor === 0, `${bid}: ${a.badFloor} storeys added inside rebuildNearR of the titan`);
    check(a.badFirst === 0, `${bid}: ${a.badFirst} first storeys did not un-collapse the building with alive 1 at full floor HP`);
    check(a.badDone === 0, `${bid}: ${a.badDone} 'done' buildings not standing at full height with the crew released`);
    check(a.early === 0, `${bid}: ${a.early} crews took a lot younger than REBUILD_MIN_DOWN_S`);
    check(a.overCap === 0, `${bid}: crews above REBUILD_MAX_CREWS on ${a.overCap} ticks`);
    check(a.lvDown === 0 && a.w.run.blocksLeveled >= a.lv0, `${bid}: run.blocksLeveled went down (${a.lv0} → ${a.w.run.blocksLeveled})`);
    check(a.badTarget === 0, `${bid}: ${a.badTarget} crews dispatched with standing floors at/above REBUILD_TARGET`);
    check(a.fastFirst === 0, `${bid}: ${a.fastFirst} first storeys went up before site prep + one storey (rebuildScaffoldS + rebuildFloorS)`);
    check(a.fastFloor === 0, `${bid}: ${a.fastFloor} storeys went up faster than rebuildFloorS after the previous one`);
    check(a.fastSite === 0, `${bid}: ${a.fastSite} sites topped out before site prep + floors x rebuildFloorS`);
    check(a.shortSite === 0, `${bid}: ${a.shortSite} sites topped out under ${SLOW_MIN_SITE_S} s from groundbreak (fastest ${a.minSite.toFixed(1)} s) -- rebuilding must never look instant`);
    check(a.popped === 0, `${bid}: ${a.popped} buildings popped in (several storeys in one tick, or topped out without raising every storey)`);
    check(a.mid >= 3, `${bid}: only ${a.mid} sites mid-construction after 120 s (a depleted city must show buildings going up)`);
    // nothing rebuilt overlaps the titan
    const T = a.w.titan;
    const under = a.w.city.buildings.filter((bd) => !bd.collapsed && bd.id % 7 !== 0 && foot(bd, T.x, T.z) < T.radius).length;
    check(under === 0, `${bid}: ${under} rebuilt buildings stand under the titan`);
    // determinism: an identical scenario gives the identical event sequence and building state
    const sa = hashStr(a.seq.join(',') + '|' + a.w.city.buildings.map((bd) => `${bd.alive}${bd.collapsed ? 'c' : ''}`).join(','));
    const sb = hashStr(b2.seq.join(',') + '|' + b2.w.city.buildings.map((bd) => `${bd.alive}${bd.collapsed ? 'c' : ''}`).join(','));
    check(sa === sb, `${bid}: repair crews not deterministic (${sa} vs ${sb})`);
  }

  // 4c. mechanics on one depleted city: XP of a rebuilt building, abandonment, titan pause, boss keep-out, heal-pickup lot
  {
    const a = runDepleted('grideast', 7, 60);
    const w = a.w, c = w.city, bk = RB.rebuildBook(c);
    const done = c.buildings.find((bd) => bd.id % 7 !== 0 && !bd.collapsed && bd.alive === bd.floors && bk.stage[bd.id] === RB.RB_NONE);
    check(!!done, 'a fully rebuilt building exists after 60 s');
    if (done) {
      // rebuilt storeys are ordinary floors: a huge smash breaks min(4, floors) with rubble worth floors × lootXp
      w.titan.x = done.x + done.w / 2 + 3; w.titan.z = done.z;
      w.events.length = 0;
      const pk0 = w.pickups.length;
      const broke = CS.damageBuilding(w, done.id, 1e9, { src: 'titan', kind: 'smash' });
      const fbs = w.events.filter((e) => e.type === 'floorBreak').length;
      const xp = w.pickups.slice(pk0).filter((p) => p.kind === 'rubble').reduce((s, p) => s + p.xp, 0);
      const exp = Math.min(4, done.floors) * lootXp(done.tier, w.titan.rank)
        + (done.floors <= 4 ? TIERS[done.tier].collapseBonus * done.floors * lootXp(done.tier, w.titan.rank) : 0);
      console.log(`   rebuilt ${done.arch} (${done.floors} fl, tier ${done.tier}): smash broke ${broke} · floorBreak ${fbs} · rubble XP ${xp.toFixed(2)} (expected ${exp.toFixed(2)})`);
      check(broke === Math.min(4, done.floors) && fbs === broke, 'a rebuilt building must break like any other');
      check(Math.abs(xp - exp) < 1e-6, `a rebuilt building must drop normal rubble XP (${xp} vs ${exp})`);
    }
    // find / make a site that is RISING with storeys up, far from the titan
    w.titan.x = c.bounds.maxX + 2000; w.titan.z = c.bounds.maxZ + 2000;   // off the map: crews work freely
    let rising = -1;
    for (let k = 0; k < 30 * 60 && rising < 0; k++) {
      tickPrev(w); CS.stepCity(w);
      rising = bk.crews.find((id) => bk.stage[id] === RB.RB_RISING && !c.buildings[id].collapsed && c.buildings[id].alive >= 1 && c.buildings[id].alive < c.buildings[id].floors - 1) ?? -1;
    }
    check(rising >= 0, 'a site with storeys going up exists');
    if (rising >= 0) {
      const b = c.buildings[rising];
      // titan walks up to it: the crew downs tools (no storey, no progress) while it is within rebuildNearR
      w.titan.x = b.x + b.w / 2 + 2; w.titan.z = b.z;
      const al = b.alive, pg = bk.prog[rising];
      for (let k = 0; k < 30 * 5; k++) { tickPrev(w); CS.stepCity(w); }
      check(b.alive === al && bk.prog[rising] === pg && bk.paused[rising] === 1, `crews must down tools with the titan close (alive ${al}→${b.alive}, prog ${pg}→${bk.prog[rising]}, paused ${bk.paused[rising]})`);
      // a live boss next to the site keeps it frozen even with the titan gone (the CITY boss: the works keep
      // going during its fight, so only its keep-out freezes this site)
      w.titan.x = c.bounds.maxX + 2000; w.titan.z = c.bounds.maxZ + 2000;
      w.boss = { alive: true, role: 'main', x: b.x, z: b.z, parts: [] } as unknown as World['boss'];
      const st0 = RB.rebuildStats(w).started;
      const near0: number[] = [];
      for (let k = 0; k < 30 * 5; k++) {
        tickPrev(w); CS.stepCity(w);
        for (const e of w.events) if (e.type === 'rebuild' && (e as RbEv).stage === 'start') near0.push((e as RbEv).id);
      }
      const bossR = RB.rebuildStartR(w);
      check(b.alive === al && bk.prog[rising] === pg, 'no storey goes up next to a live boss / gatekeeper');
      check(near0.every((id) => foot(c.buildings[id], b.x, b.z) >= bossR), `crews set up inside the keep-out of a live boss (${near0.length} starts since ${st0})`);
      // ...and a live GATEKEEPER ANYWHERE (far corner of the map) stops the whole works department: no dispatch, no
      // storey on any site, every crew paused (a gatekeeper fight roams — the arena is wherever it goes)
      w.boss = { alive: true, role: 'gate', x: c.bounds.minX - 3000, z: c.bounds.minZ - 3000, parts: [] } as unknown as World['boss'];
      let fightEv = 0;
      for (let k = 0; k < 30 * 5; k++) {
        tickPrev(w); CS.stepCity(w);
        fightEv += w.events.filter((e) => e.type === 'rebuild').length;
      }
      const allPaused = bk.crews.every((id) => bk.paused[id] === 1);
      console.log(`   boss fight anywhere (5 s): rebuild events ${fightEv} · crews ${bk.crews.length} all paused ${allPaused}`);
      check(fightEv === 0 && allPaused, `a live gatekeeper fight must stop every crew (events ${fightEv}, all paused ${allPaused})`);
      // the CITY boss far away: the works department keeps working (storeys go up on sites outside its keep-out).
      // The titan stands at the test site meanwhile, so that site stays paused for the abandonment check below.
      w.titan.x = b.x + b.w / 2 + 2; w.titan.z = b.z;
      w.boss = { alive: true, role: 'main', x: c.bounds.minX - 3000, z: c.bounds.minZ - 3000, parts: [] } as unknown as World['boss'];
      let cityEv = 0;
      for (let k = 0; k < 30 * 5; k++) {
        tickPrev(w); CS.stepCity(w);
        cityEv += w.events.filter((e) => e.type === 'rebuild' && (e as RbEv).stage === 'floor').length;
      }
      console.log(`   city-boss fight far away (5 s): storeys ${cityEv} · crews ${bk.crews.length}`);
      check(cityEv > 0, `crews keep working during the city-boss fight outside its keep-out (storeys ${cityEv})`);
      w.boss = null;
      // a hit on a building under construction sends the crew home: no more storeys
      w.titan.x = b.x + b.w / 2 + 2; w.titan.z = b.z;
      CS.damageBuilding(w, rising, b.floorHpMax * 0.3, { src: 'titan', kind: 'bite' });
      check(bk.stage[rising] === RB.RB_ABANDONED, `a hit must abandon the construction (stage ${bk.stage[rising]})`);
      w.titan.x = c.bounds.maxX + 2000; w.titan.z = c.bounds.maxZ + 2000;
      const al2 = b.alive;
      for (let k = 0; k < 30 * 10; k++) { tickPrev(w); CS.stepCity(w); }
      check(b.alive === al2 && bk.crews.indexOf(rising) < 0, 'an abandoned building never grows again');
    }
    // a heal pickup lying on a rubble lot holds the first storey until it is gone
    let lot = -1;
    for (let k = 0; k < 30 * 30 && lot < 0; k++) {
      tickPrev(w); CS.stepCity(w);
      lot = bk.crews.find((id) => bk.stage[id] === RB.RB_SCAFFOLD) ?? -1;
    }
    check(lot >= 0, 'a scaffold-stage site exists');
    if (lot >= 0) {
      const b = c.buildings[lot];
      w.pickups.push({ id: w.nextId++, alive: true, kind: 'heal', x: b.x, z: b.z, y: 0, px: b.x, pz: b.z, py: 0, vx: 0, vz: 0, vy: 0, xp: 0, mass: 0, t: 0, magnet: false } as unknown as World['pickups'][number]);
      for (let k = 0; k < 30 * (RB.rebuildScaffoldS(b) + RB.rebuildFloorS(b) + 4); k++) { tickPrev(w); CS.stepCity(w); }
      check(b.collapsed && bk.stage[lot] === RB.RB_RISING, `a heal pickup on the lot must hold the first storey (collapsed ${b.collapsed}, stage ${bk.stage[lot]})`);
      w.pickups.length = 0;
      for (let k = 0; k < 30 * 2; k++) { tickPrev(w); CS.stepCity(w); }
      check(!b.collapsed && b.alive >= 1, 'the storey goes up once the lot is clear');
    }
  }
}

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures ? 1 : 0);
