// BLOCKTOOTH — city simulation (CONTRACT.md §5.3, §5.4, §7.2). THREE-FREE, deterministic.
// Owner: city-sim lane.
//
// Notes for callers:
//   * damageBuilding / damageProp take the FINAL amount. The caller (combat damageArea /
//     hitTarget, titan contact smash) applies buildingMul × stats.buildingDamage × the
//     oversize rule (OVERSIZE_DAMAGE_MUL) before calling — per CONTRACT §5.4.
//   * Titan counters (floorsEaten / buildingsLeveled / propsEaten) are credited when
//     opts.src is 'titan' or 'hazard'. Pickups, events and tonnage happen for every source.
//   * Loot randomness (pickup split + scatter, heal drops) uses world.rng.loot.
//   * Rect queries CLEAR `out` and return it. Collapsed buildings / dead props are excluded.
//   * resolveCircleVsCity writes the RESOLVED circle centre into out.x/out.z (unchanged
//     position when nothing blocks) and out.bumpTier = highest blocking tier touched (−1 none).

import { cos, hypot, sin } from '../core/detmath.ts';
import type { Building, CityLayout, DamageOpts, PickupKind, SimEvent, Tier, World } from '../core/types.ts';
import { TIERS, VS, cameraDistance, lootMass, lootXp } from '../core/config.ts';
import { clamp } from '../core/math.ts';
import { creditBlock, creditTonnage } from '../core/players.ts';
import { rInt } from '../core/rng.ts';
import { setSharedDrops, spawnPickup } from '../combat/pickups.ts';
import { stepTraffic } from './traffic.ts';
import { PROP_INFO, propRadius } from './citygen.ts';

/** A single hit breaks at most this many floors (a huge hit pancakes several). */
const MAX_FLOORS_PER_HIT = 4;
/** Chance a tier ≥ 2 collapse also drops a heal pickup. */
const COLLAPSE_HEAL_CHANCE = 0.2;

// ─────────────────────────────── per-city bookkeeping ───────────────────────────────
interface CityIndex {
  blockTotal: Int32Array;   // buildings per block
  blockLive: Int32Array;    // non-collapsed buildings per block
  leveled: Uint8Array;      // 1 once every building in the block has collapsed (STICKY: a block the repair crews
                            // rebuild stays counted, so run.blocksLeveled never goes down and a re-leveled block
                            // is not reported twice)
}
const INDEX = new WeakMap<CityLayout, CityIndex>();

function buildIndex(city: CityLayout, prev?: CityIndex): CityIndex {
  const n = city.blocksX * city.blocksZ;
  const blockTotal = new Int32Array(n), blockLive = new Int32Array(n), leveled = new Uint8Array(n);
  for (const b of city.buildings) {
    blockTotal[b.block]++;
    if (!b.collapsed) blockLive[b.block]++;
  }
  for (let i = 0; i < n; i++) {
    leveled[i] = (blockTotal[i] > 0 && blockLive[i] === 0) || (prev !== undefined && prev.leveled[i] === 1) ? 1 : 0;
  }
  return { blockTotal, blockLive, leveled };
}

function cityIndex(city: CityLayout): CityIndex {
  let idx = INDEX.get(city);
  if (!idx) { idx = buildIndex(city); INDEX.set(city, idx); }
  return idx;
}

function countLeveled(idx: CityIndex): number {
  let c = 0;
  for (let i = 0; i < idx.leveled.length; i++) c += idx.leveled[i];
  return c;
}

// ─────────────────────────────── tick ───────────────────────────────
export function stepCity(w: World): void {
  stepTraffic(w);
  stepRebuild(w);
  if (w.mode === 'vs') stepDemolition(w);
  // blocks-leveled: incremented immediately by damageBuilding; every second re-derive it from
  // building state (authoritative + self-healing if anything collapsed a building directly).
  // Sticky per block (see CityIndex.leveled): a rebuilt block keeps its count.
  if (w.tick % 30 === 0) {
    const idx = buildIndex(w.city, INDEX.get(w.city));
    INDEX.set(w.city, idx);
    w.run.blocksLeveled = countLeveled(idx);
  }
}

// ─────────────────────────────── REPAIR CREWS (rebuild) ───────────────────────────────
// WARD-7 Public Works rebuilds smashed buildings so a 20-minute run never runs out of city (owner
// 2026-10-01: "slightly bigger cities but also rebuilding"). Measured before this (bot, 24 runs): the
// titan ate the city down to ~13 % of its floors by the city-boss spawn and rubble XP/min fell
// 851 → 672 → 312 → 171 over minutes 15–18.
//
// The model — a DEMAND-DRIVEN works department:
//   * every second the department compares the city's standing floors with REBUILD_TARGET; below it,
//     it keeps up to REBUILD_MAX_CREWS × deficit/REBUILD_DEFICIT_FULL crews working (more crews the
//     emptier the city). A healthy city (the first ~10 minutes) gets none.
//   * a crew is dispatched to a rubble lot (a building collapsed ≥ REBUILD_MIN_DOWN_S ago) only AWAY
//     from the titan — its footprint farther than rebuildStartR (≈ the edge of the titan's default view,
//     so crews set up off-screen) — and away from any live boss / gatekeeper (bossClear, same radius). The pick is
//     weighted toward taller tiers (they are the meal at Size IV–V) and drawn from world.rng.city
//     (deterministic; the stream is otherwise idle after generation).
//   * SCAFFOLD (REBUILD_SCAFFOLD_S): the lot stays rubble (collapsed: no collision, no XP), the
//     scaffold cage + crane go up. Then RISING: one storey every floorS(tier) seconds; the first one
//     un-collapses the building (alive 1), each one is an ordinary floor (normal smash XP, normal
//     collision — the footprint is the generator's own, so it never blocks more than the city did).
//   * crews only work while the titan is out of rebuildNearR (they down tools when it comes close; the
//     half-built tower just stands there) and NO GATEKEEPER fight is on: while a gatekeeper is alive every
//     crew downs tools and nobody is dispatched (a gatekeeper fight roams; a storey going up on the road the
//     titan is being chased down rammed CORDON-2 into it — probe_gatekeepers 7c). During the CITY-BOSS fight
//     the department keeps working, but only outside the boss's keep-out (bossClear, rebuildStartR from its
//     centre and parts) and the titan's near radius: the fight happens in a city that is still standing
//     around it (Gate 2026-10-01: standing buildings are what lowers city-fight deaths — their collapses drop
//     the street-food heals). A storey is never added under the titan, a boss part or a heal / chest pickup
//     lying on the footprint.
//   * any damage to a building under construction sends its crew home (stage ABANDONED: a normal
//     partial building that keeps its base-up look until it falls).
// All state lives in a per-city side table (like the block index); views read it via rebuildBook().
//
// ONLINE VS (lane B-WORLD, vs_design.md section 5 + 8; every change is behind w.mode === 'vs', solo is byte-identical):
//   * the works department is on from the first minute and works away from EVERY live titan: a lot is only dispatched
//     when it is outside every titan's start radius and the crew downs tools while ANY titan is within its near radius
//     (each titan's own rebuildStartR / rebuildNearR); a gatekeeper (tender) fight no longer stops every crew: the rig's
//     keep-out (bossClear, the widest titan start radius around its centre + parts) does the job;
//   * from FINAL NOTICE (vs.phase final / last) the city outside the CONDEMNATION ring is CONDEMNED: no crew is
//     dispatched there, a crew already there goes home, and DEMOLITION crews bring the standing buildings outside the ring
//     down on a cosmetic schedule (VS_DEMO_PER_S per second, outermost first, ties by id): `buildingCollapse` events
//     tagged noCredit, NO loot, NO tonnage, NO per-player credit (the XP is the contest, vs_design.md section 5).
// Tuning (REBUILD lane 2026-10-01, bot, 4 titans × 3 cities × seeds 1337/7 = 24 runs, HEAD city sizes): floors
// standing at the city-boss spawn median 14 % → 44 % (min 2 → 18 %); rubble XP/min (median) minutes 13–16
// 1019/887/788/676 → 963/1399/1391/1269; rubble XP in the 3 minutes before the city boss 2369 → 4000. The extra
// XP moves LV 35 / the city boss ~50 s earlier (1053 → 1001 s); XP_STRETCH.late 0.05 (was 0.03) puts it back
// (1056 s) — a config.ts / common.py call for the pacing owner, not made here.
// Gate tuning (2026-10-01, bigger cities, P-human player-like policy seeds 1–24 = 288 runs, pooled clears):
// lanes' .65/.3/32 crews/20 s/5 per s 234 · .80/48/8 + city-fight work 243 · .90/64/10 + city-fight work 246
// (seeds 25–48: 245 vs 236) · .90/.15/64/10 s/10 + city-fight work 251 (ADOPTED) · 1.0 239. XP_STRETCH.late .05
// cost clears (239 / 238) and did not move LV 35 (the city boss sits on GATES.mainEarliestS 995 s either way).
/** Standing-floor fraction the works department defends. */
export const REBUILD_TARGET = 0.95;
/** Deficit (target − standing) at which the department fields every crew. */
export const REBUILD_DEFICIT_FULL = 0.1;
// SLOW construction (owner 2026-10-01: "make sure when building rebuild that its not INSTANT, that it slowly builds
// up ... if we leave an area, when we come back we should see some buildings being erected"). Before (b3005a22) a site
// went from groundbreak to topping out in 4.6 s (1-storey shop) / 13.6 s (median tower) / 28 s (skyscraper): it read
// as regrowth. Now a site takes ~25-35 s (small) / ~45-60 s (mid-rise) / ~75-90 s (median tower) / ~90-125 s
// (skyscraper) -- owner priority on slow, visible building (a faster 'dmix' timing let a depleted city regrow
// 14 % -> 86 % in 120 s with nothing left mid-construction, so it was rejected; P-human 227/288 here vs 251 at b3005a22): a long site-preparation stage (heap cleared, foundation poured, crane erected), then storeys at a
// builder's pace. Each site is ~6x longer, so the department fields ~6x the crews (REBUILD_MAX_CREWS) to keep the
// same floors restored per minute -- the city is now dotted with sites mid-construction instead of popping back.
/** Crew cap (b3005a22: 64 crews on ~6x faster sites -- it bound at the minute-14..16 peak). */
export const REBUILD_MAX_CREWS = 384;
/** A lot must have been rubble this long before a crew takes it (the collapse + rubble read first). */
export const REBUILD_MIN_DOWN_S = 10;
/** Site-preparation stage by tier (s): the heap is cleared, the foundation poured, cage + crane go up -- the lot
 *  stays rubble (no collision, no XP) until the first storey. */
export const REBUILD_SCAFFOLD_S: readonly number[] = [10, 12, 12, 14, 16];
/** Seconds per rebuilt storey by tier (a tower goes up storey by storey; skyscraper storeys are repetitive, so a
 *  shorter beat keeps a 35-storey tower near two minutes). */
export const REBUILD_FLOOR_S: readonly number[] = [14, 13, 7.5, 5, 3];
/** New crews per second, handed out as a steady trickle (REBUILD_DISPATCH_HZ slices a second) so sites break ground
 *  at staggered times and a district shows buildings at different stages. */
const REBUILD_DISPATCH_PER_S = 15;
const REBUILD_DISPATCH_HZ = 5;

export const RB_NONE = 0, RB_SCAFFOLD = 1, RB_RISING = 2, RB_ABANDONED = 3;
export interface RebuildBook {
  /** per building: RB_NONE / RB_SCAFFOLD / RB_RISING / RB_ABANDONED */
  stage: Uint8Array;
  /** per building: seconds of work in the current stage (scaffold time, or time toward the next storey) */
  prog: Float32Array;
  /** per building: world.t of its last collapse (−1 never) */
  downT: Float32Array;
  /** per building: 1 while its crew is downing tools (titan / boss too close) — cosmetic for views */
  paused: Uint8Array;
  /** building ids with a crew (stage SCAFFOLD or RISING), dispatch order */
  crews: number[];
  started: number;          // crews dispatched this run
  floors: number;           // storeys rebuilt this run
  done: number;             // buildings fully rebuilt this run
  totalFloors: number;      // Σ building.floors (constant)
}
const BOOKS = new WeakMap<CityLayout, RebuildBook>();
/** The city's rebuild side table (created on first use). Views and probes read it; never write it. */
export function rebuildBook(city: CityLayout): RebuildBook {
  let bk = BOOKS.get(city);
  if (!bk) {
    const n = city.buildings.length;
    let tf = 0;
    for (const b of city.buildings) tf += b.floors;
    bk = {
      stage: new Uint8Array(n), prog: new Float32Array(n), downT: new Float32Array(n).fill(-1), paused: new Uint8Array(n),
      crews: [], started: 0, floors: 0, done: 0, totalFloors: tf,
    };
    BOOKS.set(city, bk);
  }
  return bk;
}
/** Run counters for probes / HUD: crews dispatched, storeys + buildings rebuilt, crews working now. */
export function rebuildStats(w: World): { started: number; floors: number; done: number; active: number } {
  const bk = rebuildBook(w.city);
  return { started: bk.started, floors: bk.floors, done: bk.done, active: bk.crews.length };
}
/** Seconds per rebuilt storey of a building. */
export function rebuildFloorS(b: Building): number {
  return REBUILD_FLOOR_S[b.tier] ?? 6;
}
/** Site-preparation seconds of a building (stage SCAFFOLD). */
export function rebuildScaffoldS(b: Building): number {
  return REBUILD_SCAFFOLD_S[b.tier] ?? 20;
}
/** Distance from (x,z) to a building footprint (0 inside). */
function footDist(b: Building, x: number, z: number): number {
  const qx = clamp(x, b.x - b.w / 2, b.x + b.w / 2), qz = clamp(z, b.z - b.d / 2, b.z + b.d / 2);
  return hypot(x - qx, z - qz);
}
/** Crews only SET UP beyond this footprint distance from the titan: ≈ the edge of its default view. */
export function rebuildStartR(w: World): number {
  const T = w.titan;
  return Math.max(70, 0.55 * cameraDistance(T.height) + 2 * T.radius);
}
/** VS: the same radii for any titan (not just the bound one). */
function startRFor(T: { height: number; radius: number }): number { return VS.director.rebuildRadiusMul * Math.max(70, 0.55 * cameraDistance(T.height) + 2 * T.radius); }
function nearRFor(T: { height: number; radius: number }): number { return VS.director.rebuildRadiusMul * Math.max(30, 0.3 * cameraDistance(T.height) + 3 * T.radius); }
/** VS: a point is condemned once FINAL NOTICE has started and it lies outside the live ring (B-VS src/vs/ring.ts ringOutside). */
function condemned(w: World, x: number, z: number): boolean {
  const v = w.vs;
  if (!v || (v.phase !== 'final' && v.phase !== 'last')) return false;
  return hypot(x - v.ring.cx, z - v.ring.cz) > v.ring.r;
}
const SEAT_NEAR: number[] = [0, 0, 0, 0], SEAT_START: number[] = [0, 0, 0, 0];
let seatMaxStart = 0;
/** VS: refresh every live seat's radii for this tick; 0 for a titan that is not live (it blocks nothing). */
function seatRadii(w: World): void {
  seatMaxStart = 70 * VS.director.rebuildRadiusMul;
  for (let i = 0; i < w.players.length && i < 4; i++) {
    const p = w.players[i];
    const live = p.titan.alive && !p.vs.eliminated;
    SEAT_NEAR[i] = live ? nearRFor(p.titan) : -1;
    SEAT_START[i] = live ? startRFor(p.titan) : -1;
    if (live && SEAT_START[i] > seatMaxStart) seatMaxStart = SEAT_START[i];
  }
}
/** VS: is the building within ANY live titan's near radius (near = true) / start radius (false)? */
function nearSeat(w: World, b: Building, near: boolean): boolean {
  for (let i = 0; i < w.players.length && i < 4; i++) {
    const r = near ? SEAT_NEAR[i] : SEAT_START[i];
    if (r < 0) continue;
    const T = w.players[i].titan;
    if (footDist(b, T.x, T.z) < r) return true;
  }
  return false;
}
/** Crews down tools while the titan is within this footprint distance (the near view): nothing ever
 *  grows under it or in its face. */
export function rebuildNearR(w: World): number {
  const T = w.titan;
  return Math.max(30, 0.3 * cameraDistance(T.height) + 3 * T.radius);
}
/** Keep-out around a live boss / gatekeeper (centre + parts): no set-up, no storey, while it is alive. */
function bossClear(w: World, b: Building, r: number): boolean {
  const boss = w.boss;
  if (!boss || !boss.alive) return true;
  if (footDist(b, boss.x, boss.z) < r) return false;
  for (let i = 0; i < boss.parts.length; i++) {
    const p = boss.parts[i];
    if (footDist(b, p.x, p.z) < r * 0.5 + p.r) return false;
  }
  return true;
}
/** No non-drifting pickup (heal / chest / power-up …) lies on the footprint (+1 m): rubble/scrap drift
 *  to the titan on their own, everything else would be walled in. */
function lotClear(w: World, b: Building): boolean {
  const hw = b.w / 2 + 1, hd = b.d / 2 + 1;
  for (let i = 0; i < w.pickups.length; i++) {
    const p = w.pickups[i];
    if (!p.alive || p.kind === 'rubble' || p.kind === 'scrap') continue;
    if (Math.abs(p.x - b.x) < hw && Math.abs(p.z - b.z) < hd) return false;
  }
  return true;
}
function rebuildEvent(w: World, stage: 'start' | 'floor' | 'done', b: Building, n: number): void {
  w.events.push({ type: 'rebuild', stage, id: b.id, alive: b.collapsed ? 0 : b.alive, x: b.x, z: b.z, n });
}
const RB_CAND: number[] = [];
function stepRebuild(w: World): void {
  const ph = w.run.phase;
  if (ph === 'intro' || ph === 'clear' || ph === 'dead' || ph === 'vsend') return;
  const city = w.city;
  const bk = rebuildBook(city);
  const T = w.titan;
  const vs = w.mode === 'vs';
  const nearR = rebuildNearR(w);
  const startR = rebuildStartR(w);
  if (vs) seatRadii(w);
  const bossR = vs ? seatMaxStart : startR;   // VS: the rig keep-out uses the widest titan start radius
  const dt = w.dt;
  // a GATEKEEPER fight: everyone downs tools, nobody is dispatched (the arena is wherever the fight goes). The
  // city-boss fight keeps the works going outside the boss keep-out (bossClear) and the titan's near radius.
  // (VS: a tender rig stops nobody: its keep-out does the job, and the department is the city's lifeline from minute 1.)
  const fight = !vs && !!(w.boss && w.boss.alive && w.boss.role !== 'main');
  // ── work ──
  let k = 0;
  for (let i = 0; i < bk.crews.length; i++) {
    const id = bk.crews[i];
    const b = city.buildings[id];
    const st = bk.stage[id];
    if (st !== RB_SCAFFOLD && st !== RB_RISING) continue;           // crew went home (damage / collapse)
    if (vs && condemned(w, b.x, b.z)) { bk.stage[id] = RB_ABANDONED; bk.paused[id] = 0; continue; }   // VS: condemned lot, the crew goes home
    bk.crews[k++] = id;
    const pause = fight || (vs ? nearSeat(w, b, true) : footDist(b, T.x, T.z) < nearR) || !bossClear(w, b, bossR);
    bk.paused[id] = pause ? 1 : 0;
    if (pause) continue;
    bk.prog[id] += vs ? dt * VS.director.rebuildPace : dt;   // VS: the works department scales with 4 titans (VS.director.rebuildPace)
    if (st === RB_SCAFFOLD) {
      if (bk.prog[id] < rebuildScaffoldS(b)) continue;
      bk.stage[id] = RB_RISING;
      bk.prog[id] = 0;
      continue;
    }
    const fs = rebuildFloorS(b);
    if (bk.prog[id] < fs) continue;
    if (b.collapsed && !lotClear(w, b)) { bk.prog[id] = fs; continue; }   // wait for the lot to clear
    bk.prog[id] -= fs;
    if (b.collapsed) {
      const idx = cityIndex(city);
      b.collapsed = false;
      b.alive = 1;
      idx.blockLive[b.block]++;
    } else {
      b.alive = Math.min(b.floors, b.alive + 1);
    }
    b.floorHp = b.floorHpMax;
    bk.floors++;
    rebuildEvent(w, 'floor', b, bk.done);
    if (b.alive >= b.floors) {
      bk.stage[id] = RB_NONE;
      bk.prog[id] = 0;
      bk.paused[id] = 0;
      bk.done++;
      rebuildEvent(w, 'done', b, bk.done);
      k--;                                                          // crew released
    }
  }
  bk.crews.length = k;
  // ── dispatch (REBUILD_DISPATCH_HZ slices a second, REBUILD_DISPATCH_PER_S / HZ crews each) ──
  const slice = Math.round(30 / REBUILD_DISPATCH_HZ);
  if (fight || w.tick % slice !== slice >> 1) return;
  let standing = 0;
  for (const b of city.buildings) standing += b.collapsed ? 0 : b.alive;
  const frac = bk.totalFloors > 0 ? standing / bk.totalFloors : 1;
  const deficit = REBUILD_TARGET - frac;
  if (deficit <= 0) return;
  const crewMul = vs ? VS.director.rebuildCrewsMul : 1;   // VS: more crews + a faster dispatch trickle (VS.director.rebuildCrewsMul)
  const maxCrews = Math.round(REBUILD_MAX_CREWS * crewMul);
  const want = Math.min(maxCrews, Math.ceil(maxCrews * Math.min(1, deficit / REBUILD_DEFICIT_FULL)));
  let room = Math.min(Math.round(REBUILD_DISPATCH_PER_S * crewMul / REBUILD_DISPATCH_HZ), want - bk.crews.length);
  if (room <= 0) return;
  RB_CAND.length = 0;
  let wsum = 0;
  for (const b of city.buildings) {
    if (!b.collapsed || bk.stage[b.id] !== RB_NONE) continue;
    if (bk.downT[b.id] >= 0 && w.t - bk.downT[b.id] < REBUILD_MIN_DOWN_S) continue;
    if (vs ? nearSeat(w, b, false) : footDist(b, T.x, T.z) < startR) continue;
    if (vs && condemned(w, b.x, b.z)) continue;                       // VS: nothing is rebuilt outside the ring
    if (!bossClear(w, b, bossR)) continue;
    RB_CAND.push(b.id);
    wsum += 1 + b.tier;
  }
  const rng = w.rng.city;
  while (room > 0 && RB_CAND.length > 0) {
    let x = rng() * wsum, at = RB_CAND.length - 1;
    for (let i = 0; i < RB_CAND.length; i++) { x -= 1 + city.buildings[RB_CAND[i]].tier; if (x <= 0) { at = i; break; } }
    const id = RB_CAND[at];
    const b = city.buildings[id];
    wsum -= 1 + b.tier;
    RB_CAND.splice(at, 1);
    bk.stage[id] = RB_SCAFFOLD;
    bk.prog[id] = 0;
    bk.paused[id] = 0;
    bk.crews.push(id);
    bk.started++;
    rebuildEvent(w, 'start', b, bk.started);
    room--;
  }
}

// ─────────────────────────────── ONLINE VS: DEMOLITION crews ───────────────────────────────
/** Buildings the demolition crews bring down per second outside the ring (cosmetic schedule; [proposal]). */
export const VS_DEMO_PER_S = 10;
const DEMO_HZ = 5;
const DEMO_PICK: number[] = [], DEMO_KEY: number[] = [];

/**
 * FINAL NOTICE / LAST CALL: bring condemned buildings (standing, outside the live ring) down, outermost first. No loot, no
 * tonnage, no per-player credit; the events are tagged noCredit so no titan's smash / collapse triggers fire for them.
 */
function stepDemolition(w: World): void {
  const v = w.vs;
  if (!v || (v.phase !== 'final' && v.phase !== 'last')) return;
  const slice = Math.round(30 / DEMO_HZ);
  if (w.tick % slice !== slice >> 1) return;
  const per = Math.max(1, Math.round(VS_DEMO_PER_S / DEMO_HZ));
  const R = v.ring;
  DEMO_PICK.length = 0; DEMO_KEY.length = 0;
  const bs = w.city.buildings;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (b.collapsed || b.alive <= 0) continue;
    const out = hypot(b.x - R.cx, b.z - R.cz) - R.r;
    if (out <= 0) continue;
    // keep the `per` farthest-outside (ties: lower id), insertion into a tiny sorted list
    let at = DEMO_PICK.length;
    while (at > 0 && DEMO_KEY[at - 1] < out) at--;
    if (at >= per) continue;
    DEMO_PICK.splice(at, 0, b.id); DEMO_KEY.splice(at, 0, out);
    if (DEMO_PICK.length > per) { DEMO_PICK.length = per; DEMO_KEY.length = per; }
  }
  for (let k = 0; k < DEMO_PICK.length; k++) demolishBuilding(w, bs[DEMO_PICK[k]]);
}

/** A cosmetic collapse: the building comes down, nothing drops, nobody is credited. */
function demolishBuilding(w: World, b: Building): void {
  const idx = cityIndex(w.city);
  const bk = rebuildBook(w.city);
  bk.stage[b.id] = RB_NONE; bk.prog[b.id] = 0; bk.paused[b.id] = 0;
  bk.downT[b.id] = w.t;
  b.collapsed = true; b.alive = 0; b.floorHp = 0;
  push(w, { type: 'buildingCollapse', id: b.id, x: b.x, z: b.z, tier: b.tier, w: b.w, d: b.d, h: b.floors * b.floorH }, false);
  idx.blockLive[b.block] = Math.max(0, idx.blockLive[b.block] - 1);
  if (idx.blockLive[b.block] === 0 && idx.blockTotal[b.block] > 0) idx.leveled[b.block] = 1;   // the world total re-derives each second; no player is credited
}

// ─────────────────────────────── spatial queries ───────────────────────────────
const RANGE = [0, 0, 0, 0];
/**
 * How far (m) anything listed under a block cell can reach outside that cell. Buildings never
 * leave their cell (parcels sit inside ±PARCEL_HALF of the centre); props are listed by their
 * CENTRE, so the worst overhang is the largest prop bounding radius (bus ≈ 5.65 m — arterial
 * traffic drives 5.25 m off a cell boundary). Things generated outside the grid (outer-road
 * furniture, harbour boats) are listed under the clamped edge cell, and the query clamps the
 * same way, so they are always found.
 */
const CELL_PAD = 6;
/** Block cells the rect (grown by CELL_PAD) overlaps, clamped to the grid → RANGE. This is the
 *  contract's "cells overlapped by the rect ±1" with the margin expressed in metres: identical
 *  results, but a small rect walks 1–4 cells instead of 9+. */
function cellRange(city: CityLayout, minX: number, minZ: number, maxX: number, maxZ: number): void {
  const p = city.pitch;
  RANGE[0] = clamp(Math.floor((minX - CELL_PAD - city.originX) / p), 0, city.blocksX - 1);
  RANGE[1] = clamp(Math.floor((minZ - CELL_PAD - city.originZ) / p), 0, city.blocksZ - 1);
  RANGE[2] = clamp(Math.floor((maxX + CELL_PAD - city.originX) / p), 0, city.blocksX - 1);
  RANGE[3] = clamp(Math.floor((maxZ + CELL_PAD - city.originZ) / p), 0, city.blocksZ - 1);
}

export function buildingsInRect(city: CityLayout, minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number[] {
  out.length = 0;
  cellRange(city, minX, minZ, maxX, maxZ);
  const bx0 = RANGE[0], bz0 = RANGE[1], bx1 = RANGE[2], bz1 = RANGE[3];
  for (let bz = bz0; bz <= bz1; bz++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const list = city.blockBuildings[bx + bz * city.blocksX];
      for (let i = 0; i < list.length; i++) {
        const b = city.buildings[list[i]];
        if (b.collapsed) continue;
        const hw = b.w / 2, hd = b.d / 2;
        if (b.x + hw < minX || b.x - hw > maxX || b.z + hd < minZ || b.z - hd > maxZ) continue;
        out.push(b.id);
      }
    }
  }
  return out;
}

export function propsInRect(city: CityLayout, minX: number, minZ: number, maxX: number, maxZ: number, out: number[]): number[] {
  out.length = 0;
  cellRange(city, minX, minZ, maxX, maxZ);
  const bx0 = RANGE[0], bz0 = RANGE[1], bx1 = RANGE[2], bz1 = RANGE[3];
  for (let bz = bz0; bz <= bz1; bz++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const list = city.blockProps[bx + bz * city.blocksX];
      for (let i = 0; i < list.length; i++) {
        const p = city.props[list[i]];
        if (!p.alive) continue;
        const r = propRadius(p.kind);
        if (p.x + r < minX || p.x - r > maxX || p.z + r < minZ || p.z - r > maxZ) continue;
        out.push(p.id);
      }
    }
  }
  return out;
}

/** Block index of a point (bx + bz·blocksX), −1 outside the grid. */
export function blockOf(city: CityLayout, x: number, z: number): number {
  const bx = Math.floor((x - city.originX) / city.pitch);
  const bz = Math.floor((z - city.originZ) / city.pitch);
  if (bx < 0 || bz < 0 || bx >= city.blocksX || bz >= city.blocksZ) return -1;
  return bx + bz * city.blocksX;
}

export function buildingById(city: CityLayout, id: number): Building {
  return city.buildings[id];
}

// nearestRubble scratch (sorted top-k by distance)
const RUB_D: number[] = [];
/** Ids of COLLAPSED buildings whose footprint lies within r of (x,z), nearest first, at most `max`. */
export function nearestRubble(city: CityLayout, x: number, z: number, r: number, max: number, out: number[]): number[] {
  out.length = 0;
  RUB_D.length = 0;
  if (max <= 0) return out;
  cellRange(city, x - r, z - r, x + r, z + r);
  const bx0 = RANGE[0], bz0 = RANGE[1], bx1 = RANGE[2], bz1 = RANGE[3];
  for (let bz = bz0; bz <= bz1; bz++) {
    for (let bx = bx0; bx <= bx1; bx++) {
      const list = city.blockBuildings[bx + bz * city.blocksX];
      for (let i = 0; i < list.length; i++) {
        const b = city.buildings[list[i]];
        if (!b.collapsed) continue;
        const qx = clamp(x, b.x - b.w / 2, b.x + b.w / 2), qz = clamp(z, b.z - b.d / 2, b.z + b.d / 2);
        const d = hypot(x - qx, z - qz);
        if (d > r) continue;
        // insertion into the sorted top-k (ties → lower id first, deterministic)
        let at = out.length;
        while (at > 0 && (RUB_D[at - 1] > d || (RUB_D[at - 1] === d && out[at - 1] > b.id))) at--;
        if (at >= max) continue;
        out.splice(at, 0, b.id);
        RUB_D.splice(at, 0, d);
        if (out.length > max) { out.length = max; RUB_D.length = max; }
      }
    }
  }
  return out;
}

// ─────────────────────────────── damage ───────────────────────────────
function creditsTitan(opts: DamageOpts): boolean {
  return opts.src === 'titan' || opts.src === 'hazard';
}
/** Tonnage: the world total always; the bound player's slice only when a TITAN did it (VS: a rig's footsteps / a ram flatten
 *  the city without feeding the seat the rig happens to be hunting). Solo: exactly creditTonnage (credit is always true there
 *  for the player's own damage and the bound player is the only one). */
function tons(w: World, credit: boolean, t: number): void {
  if (w.mode === 'vs' && !credit) w.run.tonnage += t; else creditTonnage(w, t);
}
/** City events caused by a hostile (a boss leg, a RAMROD) carry `noCredit: true` (an extra field
 *  on the event object, outside the SimEvent type) so the upgrade engine does not fire the titan's
 *  smash/floorBreak/collapse triggers for them — before, CAISSON-4's own footsteps detonated the
 *  titan's EMINENT DOMAIN shockwaves under its legs (up to 40 % of a boss fight's damage). */
function push(w: World, ev: SimEvent, credit: boolean): void {
  if (!credit) (ev as SimEvent & { noCredit?: boolean }).noCredit = true;
  w.events.push(ev);
}

/** Rubble for one broken floor: TIERS[tier] floorXp/floorMass split into 1–3 pickups at the
 *  footprint edge point (ex,ez) nearest the titan, nudged outward. */
function dropFloorRubble(w: World, b: Building, ex: number, ez: number): void {
  const loot = w.rng.loot;
  // rank-relative value (snack rule + rank XP scale) — see the economy table in core/config.ts
  const xp = lootXp(b.tier, w.titan.rank), mass = lootMass(b.tier, w.titan.rank);
  const n = b.tier <= 1 ? rInt(loot, 1, 2) : b.tier === 2 ? 2 : 3;
  let nx = ex - b.x, nz = ez - b.z;
  const nl = hypot(nx, nz);
  if (nl > 1e-6) { nx /= nl; nz /= nl; } else { const a = loot() * Math.PI * 2; nx = sin(a); nz = cos(a); }
  const spread = 1 + 0.12 * Math.max(b.w, b.d);
  for (let i = 0; i < n; i++) {
    const t = (loot() - 0.5) * spread;
    // tangent jitter along the edge + a small outward nudge
    const x = ex + (-nz) * t + nx * (0.4 + loot() * 0.8);
    const z = ez + nx * t + nz * (0.4 + loot() * 0.8);
    spawnPickup(w, 'rubble', x, z, xp / n, mass / n);
  }
}

function collapseBuilding(w: World, b: Building, credit: boolean): void {
  const loot = w.rng.loot;
  // fetch (or lazily build) the block index BEFORE flagging the collapse, so a lazily built
  // index never counts this building as already gone (that would double-decrement below)
  const idx = cityIndex(w.city);
  // repair crews: the lot is rubble again (any crew on it went home); the down-time clock restarts
  const bk = rebuildBook(w.city);
  bk.stage[b.id] = RB_NONE;
  bk.prog[b.id] = 0;
  bk.paused[b.id] = 0;
  bk.downT[b.id] = w.t;
  b.collapsed = true;
  b.alive = 0;
  b.floorHp = 0;
  push(w, { type: 'buildingCollapse', id: b.id, x: b.x, z: b.z, tier: b.tier, w: b.w, d: b.d, h: b.floors * b.floorH }, credit);
  // collapse bonus: collapseBonus × floors worth of floor loot, scattered over the footprint
  const td = TIERS[b.tier];
  const bonus = td.collapseBonus * b.floors;
  const bxp = lootXp(b.tier, w.titan.rank) * bonus, bmass = lootMass(b.tier, w.titan.rank) * bonus;
  const n = Math.min(5, 2 + b.tier);
  for (let i = 0; i < n; i++) {
    const x = b.x + (loot() - 0.5) * b.w * 0.8;
    const z = b.z + (loot() - 0.5) * b.d * 0.8;
    spawnPickup(w, 'rubble', x, z, bxp / n, bmass / n);
  }
  // street-food heals only come out of buildings the TITAN brings down (a boss stamping the city
  // flat is not a vending machine for the player fighting it)
  if (b.tier >= 2 && loot() < COLLAPSE_HEAL_CHANCE && credit) spawnPickup(w, 'heal', b.x, b.z, 0, 0);
  if (credit) w.titan.buildingsLeveled++;
  // blocks leveled (incremental; stepCity re-derives it every second)
  idx.blockLive[b.block] = Math.max(0, idx.blockLive[b.block] - 1);
  if (idx.blockLive[b.block] === 0 && idx.blockTotal[b.block] > 0 && !idx.leveled[b.block]) {
    idx.leveled[b.block] = 1;
    if (w.mode === 'vs' && !credit) w.run.blocksLeveled++; else creditBlock(w);   // B-CORE: world total + the bound player's PlayerRun (VS: hostile = world only)
  }
}

/**
 * Damage a building. `amount` goes into the lowest standing floor; overflow carries into the
 * next floor, at most MAX_FLOORS_PER_HIT floors per call. Each broken floor emits `floorBreak`
 * and drops rubble; contact hits (opts.kind === 'smash') also emit one `smash` beat. The last
 * floor collapses the building (`buildingCollapse`, bonus loot, counters, blocks leveled).
 * Returns the number of floors broken.
 */
export function damageBuilding(w: World, id: number, amount: number, opts: DamageOpts): number {
  if (w.mode === 'vs' && !creditsTitan(opts)) {
    // ONLINE VS: what a hostile (a rig's footsteps, a ram) brings down drops SHARED rubble (the nearest titan eats it)
    setSharedDrops(true);
    try { return damageBuildingOne(w, id, amount, opts); } finally { setSharedDrops(false); }
  }
  return damageBuildingOne(w, id, amount, opts);
}
function damageBuildingOne(w: World, id: number, amount: number, opts: DamageOpts): number {
  const b = w.city.buildings[id];
  if (!b || b.collapsed || b.alive <= 0 || !(amount > 0)) return 0;
  const T = w.titan;
  const credit = creditsTitan(opts);
  // a building under construction that takes a hit: the crew goes home (it stays a partial building)
  const bk = BOOKS.get(w.city);
  if (bk && bk.stage[id] === RB_RISING) { bk.stage[id] = RB_ABANDONED; bk.paused[id] = 0; }
  // footprint edge point nearest the titan (where the chewing happens)
  const ex = clamp(T.x, b.x - b.w / 2, b.x + b.w / 2);
  const ez = clamp(T.z, b.z - b.d / 2, b.z + b.d / 2);
  let left = amount;
  // VS (GATE knob, 1 = off): from VS.pacing.surgeFromS the city is sturdier (the HOSTILE TAKEOVER economy pays more XP per floor
  // and the same buildings take longer to bring down, so the floors left standing hold up while the levels climb)
  if (w.mode === 'vs' && VS.pacing.buildingDmgMul !== 1 && w.vs && w.t - w.vs.startT >= VS.pacing.surgeFromS) left *= VS.pacing.buildingDmgMul;
  let broken = 0;
  while (left > 0 && broken < MAX_FLOORS_PER_HIT && b.alive > 0) {
    if (left < b.floorHp) { b.floorHp -= left; left = 0; break; }
    left -= b.floorHp;
    b.alive--;
    broken++;
    push(w, { type: 'floorBreak', id: b.id, remaining: b.alive, x: b.x, z: b.z, tier: b.tier }, credit);
    dropFloorRubble(w, b, ex, ez);
    tons(w, credit, TIERS[b.tier].tonsPerFloor);   // B-CORE: world total + the bound player's PlayerRun
    if (credit) T.floorsEaten++;
    if (b.alive === 0) { collapseBuilding(w, b, credit); break; }
    b.floorHp = b.floorHpMax;
  }
  if (broken > 0 && opts.kind === 'smash') push(w, { type: 'smash', x: ex, z: ez, tier: b.tier }, credit);
  return broken;
}

/**
 * Damage a prop. Returns true if this call destroyed it: `propDestroyed` (crushed when the
 * hit is a contact smash), 1–3 pickups worth TIERS[tier] floorXp/floorMass (kiosks and
 * vending machines sometimes also drop a heal), titan.propsEaten, tonnage. Destroyed traffic
 * leaves its lane (traffic.ts drops dead cars).
 */
export function damageProp(w: World, id: number, amount: number, opts: DamageOpts): boolean {
  if (w.mode === 'vs' && !creditsTitan(opts)) {
    setSharedDrops(true);   // ONLINE VS: see damageBuilding
    try { return damagePropOne(w, id, amount, opts); } finally { setSharedDrops(false); }
  }
  return damagePropOne(w, id, amount, opts);
}
function damagePropOne(w: World, id: number, amount: number, opts: DamageOpts): boolean {
  const p = w.city.props[id];
  if (!p || !p.alive || !(amount > 0)) return false;
  p.hp -= amount;
  if (p.hp > 0) return false;
  p.hp = 0;
  p.alive = false;
  p.speed = 0;
  p.scared = 0;
  const crushed = opts.kind === 'smash';
  push(w, { type: 'propDestroyed', id: p.id, kind: p.kind, x: p.x, z: p.z, crushed }, creditsTitan(opts));
  const info = PROP_INFO[p.kind];
  const td = TIERS[p.tier];
  const loot = w.rng.loot;
  const n = p.tier === 0 ? (loot() < 0.35 ? 2 : 1) : rInt(loot, 2, 3);
  const kind: PickupKind = info.pickup;
  const spread = 0.4 + 0.3 * info.len;
  const pxp = lootXp(p.tier, w.titan.rank), pmass = lootMass(p.tier, w.titan.rank);
  for (let i = 0; i < n; i++) {
    spawnPickup(w, kind, p.x + (loot() - 0.5) * spread, p.z + (loot() - 0.5) * spread, pxp / n, pmass / n);
  }
  if (info.heal > 0 && loot() < info.heal) spawnPickup(w, 'heal', p.x, p.z, 0, 0);
  tons(w, creditsTitan(opts), td.tonsPerFloor);    // B-CORE: world total + the bound player's PlayerRun
  if (creditsTitan(opts)) w.titan.propsEaten++;
  return true;
}

// ─────────────────────────────── collision ───────────────────────────────
/**
 * Push a circle out of every non-collapsed building with tier > canFlatten (AABB; round
 * shapes — tanks, dishes, chimneys — as circles) and every live tier-1 prop with
 * tier > canFlatten (oriented box). Up to 3 relaxation passes for corners/alleys.
 * out.x/out.z = resolved centre; out.bumpTier = highest blocking tier touched (−1 none).
 * Returns true if the circle was pushed.
 */
export function resolveCircleVsCity(
  city: CityLayout, x: number, z: number, r: number, canFlatten: Tier,
  out: { x: number; z: number; bumpTier: number },
): boolean {
  if (!Number.isFinite(x) || !Number.isFinite(z) || !(r > 0)) {
    out.x = x; out.z = z; out.bumpTier = -1;
    return false;
  }
  let px = x, pz = z;
  let pushed = false;
  let bump = -1;
  // only tier-1 props (bus / truck / container) ever block — street furniture and cars never
  // do, even for callers that pass canFlatten −1 (enemies walking the streets)
  const propsBlock = canFlatten < 1;
  for (let iter = 0; iter < 3; iter++) {
    let moved = false;
    cellRange(city, px - r, pz - r, px + r, pz + r);
    const bx0 = RANGE[0], bz0 = RANGE[1], bx1 = RANGE[2], bz1 = RANGE[3];
    for (let bz = bz0; bz <= bz1; bz++) {
      for (let bx = bx0; bx <= bx1; bx++) {
        const cell = bx + bz * city.blocksX;
        const list = city.blockBuildings[cell];
        for (let i = 0; i < list.length; i++) {
          const b = city.buildings[list[i]];
          if (b.collapsed || b.tier <= canFlatten) continue;
          const hw = b.w / 2, hd = b.d / 2;
          if (px + r <= b.x - hw || px - r >= b.x + hw || pz + r <= b.z - hd || pz - r >= b.z + hd) continue;
          if (b.shape === 'cylinder' || b.shape === 'dish' || b.shape === 'chimney') {
            const dx = px - b.x, dz = pz - b.z;
            const d = hypot(dx, dz), R = hw + r;
            if (d >= R) continue;
            if (d > 1e-6) { px = b.x + (dx / d) * R; pz = b.z + (dz / d) * R; } else { pz = b.z + R; }
          } else {
            const qx = clamp(px, b.x - hw, b.x + hw), qz = clamp(pz, b.z - hd, b.z + hd);
            const dx = px - qx, dz = pz - qz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= r * r) continue;
            if (d2 > 1e-12) {
              const d = Math.sqrt(d2), k = (r - d) / d;
              px += dx * k; pz += dz * k;
            } else {
              // centre inside the footprint: exit through the nearest face
              const l = px - (b.x - hw), rr = b.x + hw - px, t = pz - (b.z - hd), bt = b.z + hd - pz;
              const m = Math.min(l, rr, t, bt);
              if (m === l) px = b.x - hw - r; else if (m === rr) px = b.x + hw + r;
              else if (m === t) pz = b.z - hd - r; else pz = b.z + hd + r;
            }
          }
          moved = pushed = true;
          if (b.tier > bump) bump = b.tier;
        }
        if (!propsBlock) continue;
        const plist = city.blockProps[cell];
        for (let i = 0; i < plist.length; i++) {
          const p = city.props[plist[i]];
          if (!p.alive || p.tier < 1 || p.tier <= canFlatten) continue;
          const info = PROP_INFO[p.kind];
          const hl = info.len / 2, hw = info.wid / 2;
          const fx = sin(p.heading), fz = cos(p.heading);   // local +Z (len axis)
          const rx = fz, rz = -fx;                                      // local +X (wid axis)
          const dx0 = px - p.x, dz0 = pz - p.z;
          const lx = dx0 * rx + dz0 * rz, lz = dx0 * fx + dz0 * fz;
          if (Math.abs(lx) >= hw + r || Math.abs(lz) >= hl + r) continue;
          const qx = clamp(lx, -hw, hw), qz = clamp(lz, -hl, hl);
          let ox = lx - qx, oz = lz - qz;
          const d2 = ox * ox + oz * oz;
          let nlx = lx, nlz = lz;
          if (d2 >= r * r) continue;
          if (d2 > 1e-12) {
            const d = Math.sqrt(d2), k = (r - d) / d;
            nlx += ox * k; nlz += oz * k;
          } else {
            const ex = hw - Math.abs(lx), ez = hl - Math.abs(lz);
            if (ex < ez) nlx = (lx >= 0 ? 1 : -1) * (hw + r); else nlz = (lz >= 0 ? 1 : -1) * (hl + r);
          }
          ox = nlx; oz = nlz;
          px = p.x + ox * rx + oz * fx;
          pz = p.z + ox * rz + oz * fz;
          moved = pushed = true;
          if (p.tier > bump) bump = p.tier;
        }
      }
    }
    if (!moved) break;
  }
  out.x = px;
  out.z = pz;
  out.bumpTier = bump;
  return pushed;
}
