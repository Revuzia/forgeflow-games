// GENESIS — climate (CONTRACT.md §7, §7.3): insolation, temperature, humidity, precipitation, clouds, prevailing wind,
// and the slow surface-water exchanges that follow temperature (evaporation, boiling, infiltration, freezing, melting).
//
// Model (hourly, full grid — cadence 60, CONTRACT §6.3):
//   * Insolation from the star's flux at the planet's orbital distance, the body-frame sun direction (latitude, axial
//     tilt, season, hour; frozen sun and pinned seasons come from Universe.sun), aerosols (dust: impact winter) and the
//     planet's light scale (eclipse hook).
//   * A per-cell energy balance on the sea-level potential temperature tPot (semi-implicit, unconditionally stable):
//       C dT/dt = S·μ·(1−albedo)·e^(−dust) − εσT⁴(1−g) + transport
//     with heat capacity C from ground + air column (pressure) + standing water (ocean moderation), greenhouse factor g
//     from pressure / CO₂ / methane / vapour, and transport = mixing toward the latitude-band mean and of the bands
//     toward the global mean (both scale with pressure). Airless worlds therefore swing hundreds of degrees between
//     day and night; air moderates the swing and carries heat poleward.
//   * Reported temperature = tPot − lapse·altitude + climate offset + weather-system deltas (heatwave, cold snap).
//   * Humidity is advected semi-Lagrangian along the wind by walking the cell graph upwind (cheap, deterministic),
//     fed by water, wet soil and plants, and rained out above a critical value (lower where wind climbs slopes and in
//     hot convective air). Rain vs snow by temperature against the liquid's freezing point. Clouds from humidity.
//   * Prevailing winds by latitude band (trades, westerlies, polar easterlies, shifted with the season).
// Water that boils away at low pressure is the "airless" rule: pour a sea on a dead rock and it boils (day side) or
// freezes and sublimates (night side) until there is air.
//
// Time-lapse (SIM perf push 2, perf/lapse.ts): at 100x / 1000x one pass stands for 2 / 6 hours (a dormant dead world's
// for 6 at any speed). On ground and shallow water the energy balance steps through those hours one by one, each under
// its own hour's sun and re-linearised at the current temperature, and feeds every temperature-driven accumulator
// (72-hour and year means, the year's envelopes, light, the degree-hours of melt) hour by hour (round 2: one step of H
// hours linearised at the start overshot radiative equilibrium on low-capacity ground — a dormant moon ~30 °C warm, the
// barren world at 1000x +40 °C — and flattened every day / night cycle); deep water, whose heat capacity makes that
// error negligible, takes one step under the hours' mean sun. Evaporation and infiltration of the land stay hourly:
// soilHour runs them on the hours a coarse schedule skips (round 2: against the water standing at the instant of the
// pass they missed the rain that runs off in between — soils dried, wetlands shrank by a quarter at 1000x). The other
// hourly amounts (transpiration, freezing, snowfall) are scaled and hourly relaxations compounded. The humidity block
// stays the hourly update (see columnKernel): it gives the right rain rate and cloud — and (push 3 round 2) the hours
// before it in the pass are hourly updates of the air alone (humidityHours), so a dry world's air dries at the 1x
// pace instead of H times slower. Measured over 4 seeds × 3 days on
// the home world: mean temperature within 0.06 °C, humidity +1.5 %, cloud ±1.5 %, precipitation within the storms' own
// seed-to-seed scatter (tests/perf-lapse.test.ts); dead moon, barren world, envelopes, soils and wetlands within the
// tolerances of tests/perf-fidelity.test.ts.

import type { Universe, SunInfo } from '../world/universe.ts';
import { CLIM_MEM_FULL, type Planet } from '../world/planet.ts';
import { wakeIfUnlevel } from './hydrology.ts';
import { refreshOverlay } from './weather.ts';

export const CLIMATE_CADENCE = 60;
const SIGMA = 5.670e-8;
const BANDS = 48;
/** stylised lapse rate (K/m at ≥ 1 atm): our mountains are ~400 m, so the real 6.5 K/km would never snow them in */
export const LAPSE = 0.06;
/** semi-Lagrangian humidity transport: cells walked upwind per (m/s) of wind per climate hour */
const ADVECT_CELLS_PER_MS = 0.22;
const DT = 3600;
/**
 * Cloud radiative effects (fix pass, calibrated on Earth's: clouds reflect ~0.15 of the sunlight at two-thirds cover and
 * hold back ~10 % of the outgoing longwave). The phase-1 model had a bright shortwave term (0.75) and no longwave term,
 * so its running balance sat ~8 °C colder than the equilibrium the worlds were built at, and the seas crept there.
 */
const CLOUD_SW = 0.62;
const CLOUD_LW = 0.08;
/** snow albedo at full cover (a weathered mean of fresh 0.85 and old 0.5), the depth of full cover, and how much of it
 * a forest canopy hides (snow under trees barely brightens the land) */
const SNOW_ALBEDO = 0.7;
const SNOW_FULL = 0.25;
const TREE_SNOW_MASK = 0.65;
/** floating ice: thin new ice is dark (nilas), it brightens to 0.5 by this thickness; sea water freezes this much lower */
const ICE_FULL = 0.6;
const SALT_FREEZE = 1.9;
/** poleward heat transport (W/m²K toward the global mean, × √pressure): the band-to-pole gradient of an Earth-like
 * world (the phase-1 0.9 left a 66 °C equator-to-pole drop that snow lines could not settle in) */
const D_GLOB = 1.6;
/**
 * Lateral mixing of the air between neighbouring cells (W/m²K toward the neighbours' mean, × pressure). Cells are ~50 m
 * across: the air over a snowfield is the air over the meadow beside it. Without it a single snowy cell sat ~30 °C below
 * its bare neighbours in summer (its own albedo alone set its temperature), so snow, once lying, never melted and
 * spread cell by cell. Coasts are moderated by the sea beside them as well.
 */
const D_NBR = 14;

/** the lateral mixing coefficient of a grid: a diffusion, so per-neighbour exchange grows as cells shrink (D_NBR is for
 * ~100 m cells; the home world's ~50 m cells exchange four times as much per degree of difference) */
function nbrMixing(p: Planet, P: number): number {
  const k = 100 / Math.max(10, p.edgeM);
  return D_NBR * P * Math.min(6, k * k);
}
/** soil moisture the banks of fresh water seep toward (below 'drinkable' wet ground, above what deserts hold) */
const RIPARIAN = 0.5;
/** rounds of (measure the running sky for a day, solve the balance under it) at scenario build */
const SPINUP_ROUNDS = 2;
/** cloud the weather systems add on a living world, as a factor on the climate's own (measured on terran worlds) */
const WEATHER_CLOUD = 1.07;

/** per-grid caches (pure functions of the grid; not state) */
interface ClimateScratch {
  band: Uint8Array;
  bandArea: Float64Array;
  bandSum: Float64Array;
  bandMean: Float64Array;
  q2: Float32Array;
  up: Int32Array;
  /** drifting weather noise (-1..1) of the current hour: patchy showers and cloud texture */
  wn: Float32Array;
  /** best upwind neighbour of each cell this hour (-1 = calm) */
  up1: Int32Array;
  /** 0.7 q + 0.3 neighbourhood mean of q, per cell, from the previous hour's air */
  qn: Float32Array;
  /** mean tPot of each cell's neighbours, from the previous hour (lateral mixing of the air) */
  tn: Float32Array;
  /** 1 where a neighbour holds fresh standing water (its banks stay moist: riparian strips, oases) */
  rip: Uint8Array;
  /** cells whose snow / ice changed this pass */
  changed: Int32Array;
}
const scratchByN = new Map<number, ClimateScratch>();
function scratch(p: Planet): ClimateScratch {
  let s = scratchByN.get(p.n);
  if (!s) {
    const N = p.count;
    const band = new Uint8Array(N);
    const bandArea = new Float64Array(BANDS);
    for (let c = 0; c < N; c++) {
      // lat is Float32: the poles can land a hair outside ±π/2, so clamp both ends
      const b = Math.max(0, Math.min(BANDS - 1, Math.floor(((p.grid.lat[c] + Math.PI / 2) / Math.PI) * BANDS)));
      band[c] = b;
      bandArea[b] += p.grid.area[c];
    }
    s = { band, bandArea, bandSum: new Float64Array(BANDS), bandMean: new Float64Array(BANDS), q2: new Float32Array(N), up: new Int32Array(N), wn: new Float32Array(N), up1: new Int32Array(N), qn: new Float32Array(N), tn: new Float32Array(N), rip: new Uint8Array(N), changed: new Int32Array(N) };
    scratchByN.set(p.n, s);
  }
  return s;
}

/** greenhouse factor g in 0..1 (fraction of outgoing longwave retained) */
export function greenhouse(p: Planet, meanHumidity = 0.5): number {
  const a = p.st.atmosphere;
  const P = Math.max(0, a.pressure);
  const tau = 0.5 * P + 2.2 * Math.sqrt(Math.max(0, a.co2) * P) + 3.0 * Math.sqrt(Math.max(0, a.methane) * P)
    + 0.18 * meanHumidity * Math.min(P, 2);
  return 1 - 1 / (1 + tau);
}

/** boiling point (°C) of the planet's liquid at its surface pressure (Clausius–Clapeyron) */
export function boilingPoint(p: Planet): number {
  const P = p.st.atmosphere.pressure;
  const liq = p.st.liquid;
  if (P <= 1e-4) return -273;
  const LR = liq.id === 'methane' ? 985 : 4890;
  const inv = 1 / (liq.boil + 273.15) - Math.log(P) / LR;
  return inv > 0 ? 1 / inv - 273.15 : 5000;
}

/** 0 for airless, ~1 at 1 atm, saturating above (scales winds, mixing, lapse) */
export function airFactor(p: Planet): number {
  const P = p.st.atmosphere.pressure;
  return P <= 0.005 ? 0 : Math.min(1.5, Math.sqrt(P));
}

/** surface + cloud albedo of a cell */
function albedo(p: Planet, c: number): number {
  const f = p.f;
  let a: number;
  if (f.water[c] > 0.05) {
    a = 0.07 + 0.43 * Math.min(1, p.s.seaIce[c] * INV_ICE_FULL);
  } else {
    a = f.sand[c] > 0.3 ? 0.24 : 0.16;
    if (f.ash[c] > 0.05) a = a * 0.5 + 0.04;
    const veg = Math.max(f.tree[c], f.grass[c] * 0.85, f.shrub[c] * 0.9, f.crop[c] * 0.85);
    a = a * (1 - veg) + 0.14 * veg;
    if (f.ice[c] > 0.1) a = Math.max(a, 0.55);
    const sn = Math.min(1, f.snow[c] / SNOW_FULL) * (1 - TREE_SNOW_MASK * f.tree[c]);
    a = a * (1 - sn) + SNOW_ALBEDO * sn;
    if (f.lava[c] > 0.05) a = 0.05;
  }
  const cl = f.cloud[c];
  return a + (0.6 - a) * cl * CLOUD_SW;
}

const _sun: SunInfo = { dir: [0, 1, 0], flux: 0, dist: 1, lon: 0, decl: 0, spin: 0 };

/** band + global transport means of tPot (area weighted) */
function bandMeans(p: Planet, sc: ClimateScratch): number {
  const t = p.s.tPot;
  const sum = sc.bandSum, band = sc.band;
  sum.fill(0);
  const area = p.grid.area;
  const N = p.count;
  for (let c = 0; c < N; c++) sum[band[c]] += t[c] * area[c];
  let g = 0, ga = 0;
  for (let b = 0; b < BANDS; b++) {
    sc.bandMean[b] = sc.bandArea[b] > 0 ? sc.bandSum[b] / sc.bandArea[b] : 0;
    g += sc.bandSum[b];
    ga += sc.bandArea[b];
  }
  return ga > 0 ? g / ga : 0;
}

/**
 * Slowly drifting noise for wind meanders (two components) and the weather texture `wn`: simplex noise sampled at a
 * drift offset that moves with time (2.5e-5 noise units per tick). It is a pure function of the planet and the tick,
 * cached per planet (a cache, not state: a loaded game recomputes identical values).
 *
 * SIM perf pass: the noise is evaluated at keyframes every NOISE_KEY ticks (12 h) and interpolated linearly in time
 * in between (it used to be re-evaluated every 3 h and held: three simplex lookups per cell were the most expensive
 * part of the hourly pass). The drift is linear in time, so the interpolation follows it smoothly instead of in 3-hour
 * steps. The keyframe after next is computed a twelfth at a time on the hourly passes, so no pass pays for a whole
 * keyframe except the first one after a load.
 */
interface NoiseKey { mu: Float32Array; mv: Float32Array; wn: Float32Array }
interface DriftNoise {
  /** keyframe index of `a` (b = k + 1, next = k + 2) */
  k: number;
  a: NoiseKey;
  b: NoiseKey;
  next: NoiseKey;
  /** cells of `next` computed so far */
  nextDone: number;
  /** interpolated output of the current hour */
  mu: Float32Array;
  mv: Float32Array;
  wn: Float32Array;
}
const driftCache = new WeakMap<Planet, DriftNoise>();
const NOISE_KEY = 720;
const NOISE_DRIFT_PER_TICK = 2.5e-5;

function newKey(N: number): NoiseKey {
  return { mu: new Float32Array(N), mv: new Float32Array(N), wn: new Float32Array(N) };
}

/** fill cells [from, to) of keyframe k */
function fillKey(p: Planet, key: NoiseKey, k: number, from: number, to: number): void {
  const nz = p.noise;
  const P = p.grid.pos;
  const drift = k * NOISE_KEY * NOISE_DRIFT_PER_TICK;
  const d2 = drift * 6;
  const mu = key.mu, mv = key.mv, wn = key.wn;
  for (let c = from; c < to; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    const m = nz.noise(x * 2.2 + drift, y * 2.2, z * 2.2 - drift);
    mu[c] = m;
    mv[c] = nz.noise(x * 2.2 - 7 + drift, y * 2.2, z * 2.2);
    wn[c] = 0.65 * nz.noise(x * 5.5 + d2, y * 5.5 - d2 * 0.3, z * 5.5 + 3) + 0.35 * m;
  }
}

function driftNoise(p: Planet, tick: number, hours = 1): DriftNoise {
  const N = p.count;
  const k = Math.floor(tick / NOISE_KEY);
  let d = driftCache.get(p);
  if (!d) {
    d = { k: k - 10, a: newKey(N), b: newKey(N), next: newKey(N), nextDone: 0, mu: new Float32Array(N), mv: new Float32Array(N), wn: new Float32Array(N) };
    driftCache.set(p, d);
  }
  if (d.k !== k) {
    if (d.k === k - 1) {
      // the usual hand-over: b becomes a, the (finished) keyframe after next becomes b
      if (d.nextDone < N) fillKey(p, d.next, k + 1, d.nextDone, N);
      const old = d.a;
      d.a = d.b;
      d.b = d.next;
      d.next = old;
    } else {
      // cold (first use, load, rewind, a jump): both ends now
      fillKey(p, d.a, k, 0, N);
      fillKey(p, d.b, k + 1, 0, N);
    }
    d.k = k;
    d.nextDone = 0;
  }
  // a twelfth of the keyframe after next per hourly pass (a time-lapse pass of several hours does their share)
  if (d.nextDone < N) {
    const to = Math.min(N, d.nextDone + Math.ceil(N / (NOISE_KEY / CLIMATE_CADENCE)) * hours);
    fillKey(p, d.next, k + 2, d.nextDone, to);
    d.nextDone = to;
  }
  const t = (tick - k * NOISE_KEY) / NOISE_KEY;
  lerpKey(N, t, d.a, d.b, d.mu, d.mv, d.wn);
  return d;
}

function lerpKey(N: number, t: number, a: NoiseKey, b: NoiseKey, mu: Float32Array, mv: Float32Array, wn: Float32Array): void {
  const s = 1 - t;
  const amu = a.mu, amv = a.mv, awn = a.wn, bmu = b.mu, bmv = b.mv, bwn = b.wn;
  for (let c = 0; c < N; c++) {
    mu[c] = amu[c] * s + bmu[c] * t;
    mv[c] = amv[c] * s + bmv[c] * t;
    wn[c] = awn[c] * s + bwn[c] * t;
  }
}

/** per-grid sin / cos of 6 × latitude (the prevailing-wind cells) */
const lat6ByN = new Map<number, { s6: Float64Array; c6: Float64Array }>();
function lat6(p: Planet): { s6: Float64Array; c6: Float64Array } {
  let r = lat6ByN.get(p.n);
  if (!r) {
    const N = p.count, lat = p.grid.lat;
    r = { s6: new Float64Array(N), c6: new Float64Array(N) };
    for (let c = 0; c < N; c++) { r.s6[c] = Math.sin(6 * lat[c]); r.c6[c] = Math.cos(6 * lat[c]); }
    lat6ByN.set(p.n, r);
  }
  return r;
}

/** prevailing wind (m/s, body-frame vector) for every cell; season shifts the cells' bands with the sun. Also fills
 * the drifting weather-noise field `wn`. */
function prevailingWind(p: Planet, decl: number, tick: number, wn: Float32Array, hours = 1): void {
  const af = airFactor(p);
  const s = p.s;
  const geo = p.geo;
  const U = 7 * af;
  const V = 0.35 * U;
  if (af === 0) {
    s.baseWindX.fill(0); s.baseWindY.fill(0); s.baseWindZ.fill(0); wn.fill(0);
    return;
  }
  const dn = driftNoise(p, tick, hours);
  windKernel(p.count, p.grid.lat, lat6(p), decl, U, V, af, dn.mu, dn.mv, geo.east, geo.north, s.baseWindX, s.baseWindY, s.baseWindZ);
  wn.set(dn.wn);
}

/**
 * The band winds: u = −U sin(6|la|) (+ meander), v = −sign(la) V sin(6|la|) (+ meander), la = lat − decl / 2, clamped
 * at the pole. sin(6 la) comes from the per-cell sin / cos of 6·lat by the angle-sum rule (one hourly sin / cos instead
 * of one sin per cell); sin(6|la|) = sign(la) sin(6 la).
 */
function windKernel(
  N: number, lat: Float32Array, l6: { s6: Float64Array; c6: Float64Array }, decl: number, U: number, V: number, af: number,
  mu: Float32Array, mv: Float32Array, east: Float32Array, north: Float32Array, bx: Float32Array, by: Float32Array, bz: Float32Array,
): void {
  const half = decl * 0.5;
  const lim = Math.PI / 2;
  const cs = Math.cos(3 * decl), sn = Math.sin(3 * decl);
  const atPole = Math.sin(6 * lim);
  const s6 = l6.s6, c6 = l6.c6;
  const mk = 2.2 * af, nk = 1.4 * af;
  for (let c = 0; c < N; c++) {
    const la = lat[c] - half;
    const al = la < 0 ? -la : la;
    const sg = la >= 0 ? 1 : -1;
    const w6 = al < lim ? sg * (s6[c] * cs - c6[c] * sn) : atPole;
    // gentle meanders so streams of humidity do not lock to perfect circles
    const u = -U * w6 + mk * mu[c];
    const v = -sg * V * w6 + nk * mv[c];
    const i3 = c * 3;
    bx[c] = east[i3] * u + north[i3] * v;
    by[c] = east[i3 + 1] * u + north[i3 + 1] * v;
    bz[c] = east[i3 + 2] * u + north[i3 + 2] * v;
  }
}

/** sky composition: climate precip/cloud + weather-system overlay -> published precip / precipType / cloud */
export function composeSky(p: Planet, c: number): void {
  const f = p.f, s = p.s;
  let pr = s.cPrecip[c];
  const t = f.temperature[c];
  let ty = pr > 0 ? (t < p.st.liquid.freeze + 0.5 ? 2 : 1) : 0;
  let cl = s.cCloud[c];
  if (s.wMask[c]) {
    if (s.wPrecip[c] > pr || (s.wType[c] > 0 && s.wPrecip[c] > 0)) {
      pr = Math.max(pr, s.wPrecip[c]);
      ty = s.wType[c];
      // a rain system in freezing air falls as snow
      if (ty === 1 && t < p.st.liquid.freeze) ty = 2;
    }
    cl = Math.min(1, Math.max(0, cl + s.wCloud[c]));
  }
  f.precip[c] = pr;
  f.precipType[c] = pr > 0 ? ty : 0;
  f.cloud[c] = cl;
}

/**
 * One hourly climate pass over the whole grid. Two sweeps: `advectPrep` (each cell's best upwind neighbour and its
 * neighbourhood humidity, from the previous hour's air) and `columnKernel`, which does everything else one cell at a
 * time — energy balance, humidity, sky, surface exchanges — so each cell's data is read once (the separate passes
 * re-streamed the same arrays four times). Per cell the arithmetic and its order are those of the original passes; the
 * only cross-cell reads (upwind humidity, upwind ground) come from data no sweep changes until the end.
 */
export function climateStep(u: Universe, p: Planet, tick = u.tick, hours = 1): void {
  const f = p.f, s = p.s, st = p.st, g = p.grid;
  const N = p.count;
  const sc = scratch(p);
  const sun = u.sun(p, tick, _sun);
  // time-lapse (perf/lapse.ts): a pass of several hours lights each cell with the mean of the hourly suns it stands for
  // (the instants the hourly passes would have used), so day and night still balance
  const H = hours > 1 ? Math.min(HOURS_MAX, Math.round(hours)) : 1;
  if (H > 1) sunSamples(u, p, tick, H);
  const af = airFactor(p);
  const airy = af > 0;
  // mean humidity for the vapour greenhouse (cheap: previous hour)
  let qm = 0;
  const hum = f.humidity;
  for (let c = 0; c < N; c += 7) qm += hum[c];
  qm /= Math.ceil(N / 7);
  const glob = bandMeans(p, sc);

  // 1. prevailing wind, then the weather systems' swirl and gusts on top again: the reset to the base wind would
  // otherwise leave storms windless until the next overlay refresh (up to two weather steps on staggered planets),
  // and sand, fire and the humidity advection below would run on calm air under a sandstorm
  prevailingWind(p, sun.decl, tick, sc.wn, H);
  f.windX.set(s.baseWindX);
  f.windY.set(s.baseWindY);
  f.windZ.set(s.baseWindZ);
  refreshOverlay(u, p);

  // 2. upwind neighbours and neighbourhood humidity (semi-Lagrangian advection, from the previous hour's air)
  if (airy) advectPrep(N, g.nbrStart, g.nbr, p.geo.tx, p.geo.ty, p.geo.tz, f.windX, f.windY, f.windZ, f.humidity, sc.qn, sc.up1, s.tPot, sc.tn, f.water, f.salinity, sc.rip, s.ocean);
  // (time-lapse, push 3 round 2: the air lives the pass's earlier hours too — humidityHours; the kernel's is the last)
  if (airy && H > 1) humidityHours(u, p, sc, H - 1);

  // 3. per cell: energy balance -> temperature, light; humidity, precipitation, clouds; sky; surface water exchanges
  const nChanged = columnKernel(u, p, sc, sun, airy, greenhouse(p, qm), glob, H);
  if (nChanged >= 0) {
    // snow / ice changed: recompute the ground of the cells that changed (every other cell's surface already is the
    // sum of its layers) and publish. INVARIANT: this is no longer a full re-sum, so every writer of a ground layer
    // (rock, soil, sand, ash, snow, ice) anywhere in the sim must call p.updSurface(c) itself — a missed call is now a
    // permanently stale ground height (tests/perf.test.ts checks layer sum == surface after a busy run)
    const list = sc.changed;
    for (let i = 0; i < nChanged; i++) p.updSurface(list[i]);
    p.bump('surface');
    p.bump('snow');
    p.bump('ice');
  }
  markRainDirty(p);
  p.bump('temperature'); p.bump('humidity'); p.bump('precip'); p.bump('precipType'); p.bump('cloud');
  p.bump('windX'); p.bump('windY'); p.bump('windZ'); p.bump('water'); p.bump('moisture'); p.bump('wetness'); p.bump('aquifer');
}

/** time-lapse sun: direction (x, y, z) and flux of each hourly instant a multi-hour pass stands for (the instants the
 * hourly passes would have used, the pass's own last), and the sample each hour of the pass uses (`sunOfHour`: one per
 * hour up to SUN_MAX hours — every schedule of perf/lapse.ts stays below — spread evenly beyond) */
const SUN_MAX = 24;
const HOURS_MAX = 256;
/** per hour of the pass (k = 0 .. H-1): the sun of the sample it uses */
const sunS = new Float64Array(HOURS_MAX * 4);
/** the mean over the samples (deep water's single step) */
let sunN = 0;
const _sunJ: SunInfo = { dir: [0, 1, 0], flux: 0, dist: 1, lon: 0, decl: 0, spin: 0 };
function sunSamples(u: Universe, p: Planet, tick: number, hours: number): void {
  const n = Math.min(SUN_MAX, hours);
  sunN = hours;
  let k = 0;
  for (let j = 0; j < n; j++) {
    const sj = u.sun(p, tick - Math.round(((n - 1 - j) * hours) / n) * CLIMATE_CADENCE, _sunJ);
    // the hours this sample stands for (all of them, one each, up to SUN_MAX hours)
    const kEnd = j === n - 1 ? hours : Math.floor(((j + 1) * hours) / n);
    for (; k < kEnd; k++) { sunS[k * 4] = sj.dir[0]; sunS[k * 4 + 1] = sj.dir[1]; sunS[k * 4 + 2] = sj.dir[2]; sunS[k * 4 + 3] = sj.flux; }
  }
}

/** 1 − (1 − r)^h: an hourly relaxation rate `r` compounded over h hours (h ≥ 1, small integer) */
function relaxH(r: number, h: number): number {
  const k = 1 - r;
  let q = k;
  for (let i = 1; i < h; i++) q *= k;
  return 1 - q;
}

/** semi-Lagrangian humidity advection, preparation: the best upwind neighbour of every cell this hour (`up1`, -1 =
 * calm) and every cell's blend with its neighbourhood (`qn` = 0.7 q + 0.3 mean of the neighbours) */
function advectPrep(
  N: number, nbrStart: Int32Array, nbr: Int32Array, tx: Float32Array, ty: Float32Array, tz: Float32Array,
  windX: Float32Array, windY: Float32Array, windZ: Float32Array, q: Float32Array, qn: Float32Array, up1: Int32Array,
  tPot: Float32Array, tn: Float32Array, water: Float64Array | Float32Array, salinity: Float32Array, rip: Uint8Array,
  ocean: Uint8Array,
): void {
  for (let c = 0; c < N; c++) {
    const wx = -windX[c], wy = -windY[c], wz = -windZ[c];
    let best = -1, bestD = 1e-6;
    let nsum = 0, tsum = 0, nk = 0;
    const e0 = nbrStart[c], e1 = nbrStart[c + 1];
    for (let e = e0; e < e1; e++) {
      const d = tx[e] * wx + ty[e] * wy + tz[e] * wz;
      if (d > bestD) { bestD = d; best = e; }
      const o = nbr[e];
      nsum += q[o];
      tsum += tPot[o];
      nk++;
    }
    up1[c] = best < 0 ? -1 : nbr[best];
    qn[c] = 0.7 * q[c] + 0.3 * (nsum / nk);
    tn[c] = tsum / nk;
    // the riparian flag is read on land only (the column kernel's soil branch): the sea — most of a terran world —
    // skips the neighbours' water and salt (SIM perf push 2)
    if (ocean[c] === 0) {
      let r = 0;
      for (let e = e0; e < e1; e++) {
        const o = nbr[e];
        if (water[o] > 0.05 && salinity[o] < 0.5) { r = 1; break; }
      }
      rip[c] = r;
    }
  }
}

/** per grid size: the pass-constant parts of the hourly humidity update (humidityHours) */
interface HumScratch { upA: Int32Array; upB: Int32Array; k: Float32Array; Q: Float32Array; crit: Float32Array; conv: Uint8Array }
const humByN = new Map<number, HumScratch>();
/** longest step (hours) of the air's semi-Lagrangian walk in humidityHours */
const HUM_STEP = 4;
/** the hours right before the kernel's are stepped one by one (push 3 round 2, resumed): a compounded step wrings the
 * air down to its rain-out threshold (1 − 0.4^g of the excess in one go), so the kernel's hour began from air drier
 * than the hourly balance leaves it and rained ~⅓ less where it rains — the focused home world's precipitation ran
 * 14-22 % short at 1000x. Three hourly steps restore the hourly excess to within ~2 % */
const HUM_TAIL = 3;

/**
 * Time-lapse (SIM perf push 3, round 2): the `n` hours of a multi-hour climate pass before its last, for the air's
 * humidity alone, in semi-Lagrangian steps of up to HUM_STEP hours (the last HUM_TAIL hourly), under the wind, the drifting disturbances and the
 * temperatures at the start of the pass (the column kernel then runs the last hour as before: its rain rate and
 * clouds). Each step takes the air from where it was g hours before — the kernel's hour-upwind walk followed g times,
 * each hour under the wind where the air was; the neighbourhood blend there — and applies g hours of the kernel's
 * humidity block: sources and subsidence compounded, the rain-out, a planet-wide override. One hourly update per pass
 * relaxed the air H times slower in game time: a dry world's air kept its starting humidity for weeks (Murk +81 %,
 * Cinder +64 % over 12 days at 1000x while nobody watched them; +66 / +51 % on 6-hour passes; now within ~2 / 4-7 %).
 * The rain these hours wring out is not delivered (the rain batches carry the last hour's rate, as before) — which is
 * why compounding hours here is safe where it was not for the kernel's hour (push 2: +77 % rain on land). (A closed
 * form for the open sea, without walk or rain-out, left the sea's air too humid: +2-4 % on a terran world.) Never runs
 * at H = 1 (1x is untouched).
 */
function humidityHours(u: Universe, p: Planet, sc: ClimateScratch, n: number): void {
  const f = p.f, s = p.s, st = p.st, g = p.grid;
  const N = p.count;
  let hs = humByN.get(p.n);
  if (!hs) {
    hs = { upA: new Int32Array(N), upB: new Int32Array(N), k: new Float32Array(N), Q: new Float32Array(N), crit: new Float32Array(N), conv: new Uint8Array(N) };
    humByN.set(p.n, hs);
  }
  const { upA, upB, k: kS, Q, crit: crit0, conv } = hs;
  const q = f.humidity, up1 = sc.up1, wn = sc.wn;
  const windX = f.windX, windY = f.windY, windZ = f.windZ, temperature = f.temperature, water = f.water;
  const ocean = s.ocean, seaIce = s.seaIce, moisture = f.moisture, tree = f.tree, grass = f.grass, crop = f.crop;
  const surface = f.surface, freeze = st.liquid.freeze, cloudiness = st.cloudiness;
  const globalKind = st.globalWeather != null ? u.content.weather.find(st.globalWeather) : undefined;
  const gH = (globalKind ? globalKind.humidityDelta : 0) * 0.2;
  // the steps: the last `tail` hours one by one (HUM_TAIL), before them m steps, the first `ext` of gA = gB + 1 hours,
  // the rest of gB
  const tail = n < HUM_TAIL ? n : HUM_TAIL, head = n - tail;
  const m = head > 0 ? Math.ceil(head / HUM_STEP) : 0, gB = m > 0 ? Math.floor(head / m) : 0, ext = head - gB * m, gA = gB + 1;
  // per cell, what holds for the whole pass (the kernel's expressions): the cell an hour upwind (the kernel's walk),
  // the source's hourly pull and target, the rain-out threshold (orographic lift from the hour-upwind cell) without
  // the convective term
  const W1 = sc.up;
  for (let c = 0; c < N; c++) {
    const ws = Math.sqrt(windX[c] * windX[c] + windY[c] * windY[c] + windZ[c] * windZ[c]);
    const steps = Math.min(4, Math.round(ws * ADVECT_CELLS_PER_MS));
    let up = c;
    for (let j = 0; j < steps; j++) {
      const nx = up1[up];
      if (nx < 0) break;
      up = nx;
    }
    W1[c] = up;
    const T = temperature[c];
    const ef = Math.min(1.3, Math.max(0.04, (T + 12) * INV_38));
    if (ocean[c] || water[c] > 0.02) {
      kS[c] = 0.12 * ef * (seaIce[c] > 0.1 ? 0.25 : 1) * (T < freeze ? 0.4 : 1);
      Q[c] = 0.8;
    } else {
      kS[c] = (0.05 * moisture[c] + 0.035 * (tree[c] + 0.5 * grass[c] + 0.6 * crop[c])) * ef;
      Q[c] = 0.85;
    }
    const rise = surface[c] - surface[up];
    crit0[c] = 0.86 - (rise > 0 ? Math.min(0.2, rise * INV_150) : 0) - 0.06 * cloudiness - 0.09 * wn[c];
    conv[c] = T > 24 ? 1 : 0;
  }
  // the gB- and gA-hour trajectories: the hour-upwind cell followed hour by hour
  if (m > 0) {
    for (let c = 0; c < N; c++) {
      let up = c;
      for (let j = 0; j < gB; j++) up = W1[up];
      upB[c] = up;
      upA[c] = W1[up];
    }
  }
  const nbrStart = g.nbrStart, nbr = g.nbr;
  // each step reads the last step's air (src) and writes the next (dst); the neighbourhood blend is taken where it is
  // read, at the cell the air came from
  let src = q, dst = sc.q2;
  for (let i = 0; i < m + tail; i++) {
    const gh = i >= m ? 1 : i < ext ? gA : gB, upW = i >= m ? W1 : i < ext ? upA : upB;
    const sub = 0.99 ** gh, wring = 1 - 0.4 ** gh, gHh = gH * gh;
    for (let c = 0; c < N; c++) {
      const up = upW[c];
      const e0 = nbrStart[up], e1 = nbrStart[up + 1];
      let nsum = 0;
      for (let e = e0; e < e1; e++) nsum += src[nbr[e]];
      let qq = 0.7 * src[up] + 0.3 * (nsum / (e1 - e0));
      // the source's pull compounded over the step's hours: 1 − (1 − k)^g
      const k1 = 1 - kS[c];
      let kp = k1;
      for (let j = 1; j < gh; j++) kp *= k1;
      qq += (Q[c] - qq) * (1 - kp);
      qq *= sub;
      const crit = conv[c] && qq > 0.7 ? crit0[c] - 0.04 : crit0[c];
      if (qq > crit) qq -= (qq - crit) * wring;
      if (globalKind) qq += gHh;
      dst[c] = qq < 0 ? 0 : qq > 1 ? 1 : qq;
    }
    const t = src; src = dst; dst = t;
  }
  if (src !== q) q.set(src);
  // the kernel's hour reads the blend of the air these hours left
  blendQ(N, nbrStart, nbr, q, sc.qn);
}

/** qn = 0.7 q + 0.3 mean of the neighbours (advectPrep's blend, alone) */
function blendQ(N: number, nbrStart: Int32Array, nbr: Int32Array, q: Float32Array, qn: Float32Array): void {
  for (let c = 0; c < N; c++) {
    const e0 = nbrStart[c], e1 = nbrStart[c + 1];
    let nsum = 0;
    for (let e = e0; e < e1; e++) nsum += q[nbr[e]];
    qn[c] = 0.7 * q[c] + 0.3 * (nsum / (e1 - e0));
  }
}

/** the per-cell column pass (see climateStep); returns the number of cells whose snow / ice changed (listed in
 * sc.changed), or -1 when none did */
/** reciprocals of the column kernel's constant divisors (a multiply instead of a divide per cell; SIM perf pass —
 * rounding-level differences only) */
const INV_SNOW_FULL = 1 / SNOW_FULL, INV_ICE_FULL = 1 / ICE_FULL, INV_72 = 1 / 72, INV_24 = 1 / 24, INV_96 = 1 / 96, INV_38 = 1 / 38, INV_150 = 1 / 150;
const INV_024 = 1 / 0.24, INV_12 = 1 / 12, INV_30 = 1 / 30, INV_003 = 1 / 0.03;
const LIGHT_K = 1 / (1361 * 0.318);
/** time-lapse: water deeper than this (m) takes one multi-hour energy-balance step, shallower ground steps hour by hour */
const DEEP_SINGLE = 2;

function columnKernel(u: Universe, p: Planet, sc: ClimateScratch, sun: SunInfo, airy: boolean, gh: number, glob: number, H = 1): number {
  const f = p.f, s = p.s, st = p.st, cfg = p.cfg;
  const N = p.count;
  const P = Math.min(3, st.atmosphere.pressure);
  const trans = Math.exp(-0.35 * st.atmosphere.dust);
  const freeze = st.liquid.freeze;
  const boil = boilingPoint(p);
  const emis = SIGMA * (1 - gh);
  const Dband = 4.0 * P;
  const Dglob = D_GLOB * Math.sqrt(P);
  const Dnbr = airy ? nbrMixing(p, P) : 0;
  const lapse = LAPSE * Math.min(1, st.atmosphere.pressure);
  const offset = st.climateOffset;
  const datum = altitudeDatum(p);
  const capBase = 3.0e4 + 1.1e6 * P;
  const globalKind = st.globalWeather != null ? u.content.weather.find(st.globalWeather) : undefined;
  const hasGlobal = globalKind !== undefined;
  const gD = (globalKind ? globalKind.tempDelta : 0) * 0.8;
  const gFloor = hasGlobal && (globalKind ? globalKind.precip : 0) > 0;
  const gP = (globalKind ? globalKind.precip : 0) * 0.7, gH = (globalKind ? globalKind.humidityDelta : 0) * 0.2;
  const gC = (globalKind ? globalKind.cloud : 0) * 0.8;
  const cloudiness = st.cloudiness;
  const snowBelow = freeze + 0.5;
  const rs3 = cfg.rainScale / 3;
  const doFreeze = cfg.freeze;
  const evaporation = cfg.evaporation;
  const infiltration = cfg.infiltration;
  const sx = sun.dir[0], sy = sun.dir[1], sz = sun.dir[2], flux = sun.flux;
  const pos = p.grid.pos, bandMean = sc.bandMean, band = sc.band, qn = sc.qn, up1 = sc.up1, wn = sc.wn, changed = sc.changed, tn = sc.tn, rip = sc.rip;
  const tPot = s.tPot, tempMean = s.tempMean, lightMean = s.lightMean, precipMean = s.precipMean, tempYear = s.tempYear, lightYear = s.lightYear;
  const tHi = s.tHi, tLo = s.tLo, climMem = s.climMem;
  const invYear = CLIMATE_CADENCE / Math.max(CLIMATE_CADENCE, st.orbit.period);
  const water = f.water, area = p.cellArea, temperature = f.temperature, precip = f.precip, precipType = f.precipType;
  const ocean = s.ocean, snow = f.snow, ice = f.ice, seaIce = s.seaIce, q = f.humidity, cloud = f.cloud;
  const windX = f.windX, windY = f.windY, windZ = f.windZ, soil = f.soil, sand = f.sand, moisture = f.moisture;
  const aquifer = f.aquifer, tree = f.tree, grass = f.grass, shrub = f.shrub, crop = f.crop, wetness = f.wetness;
  const ash = f.ash, lava = f.lava, surface = f.surface, salinity = f.salinity;
  const wMask = s.wMask, wTemp = s.wTemp, wPrecip = s.wPrecip, wType = s.wType, wCloud = s.wCloud;
  const cPrecip = s.cPrecip, cCloud = s.cCloud;
  // time-lapse (perf/lapse.ts): one pass integrates H hours. On ground and shallow water the energy balance and
  // everything temperature drives step through the hours one by one (the H > 1 branches below; deep water takes one
  // step); evaporation and infiltration are this hour's (soilHour did the others); the remaining hourly amounts are
  // scaled by H and hourly relaxations compounded (1 − (1 − r)^H). At H = 1 each expression is the hourly one bit for
  // bit (the H1 branches)
  const H1 = H === 1;
  const kPM = H1 ? INV_96 : relaxH(INV_96, H);
  // (deep water's single multi-hour step: the hourly relaxations compounded)
  const DTH = DT * H, kTM = relaxH(INV_72, H), kLM = relaxH(INV_24, H), invYearH = relaxH(invYear, H), seasH = relaxH(invYear * 0.3, H);
  const airlessP = H1 ? 0.98 : Math.pow(0.98, H), wetKeep = H1 ? 0.8 : Math.pow(0.8, H);
  const kRip = H1 ? 0.04 : relaxH(0.04, H);
  // The humidity block (advection, sources, rain-out, clouds) is the HOURLY update even in a multi-hour pass: the air
  // over a cell is near the steady state of its hour-upwind neighbour's air, so one hourly update gives the right rain
  // RATE and cloud (the rain batches multiply the rate by the ticks). Compounding H hours of sources onto a parcel
  // walked H hours upwind rained what the cells in between should have rained (+77 % on land at 1000x, measured);
  // the hourly update keeps the means. (Push 3 round 2: the pass's earlier hours are hourly updates of the air too —
  // humidityHours, before this kernel — so transients and fronts move through the field at the 1x pace.)
  let sourced = 0;
  let nChanged = 0;
  let anyChanged = false;
  for (let c = 0; c < N; c++) {
    // ── energy balance (semi-implicit) ──
    let ins = 0;
    if (H1) {
      const mu = pos[c * 3] * sx + pos[c * 3 + 1] * sy + pos[c * 3 + 2] * sz;
      ins = mu > 0 ? flux * mu * trans : 0;
    }
    // surface + cloud albedo (albedo(p, c))
    const w0 = water[c];
    let a: number;
    if (w0 > 0.05) {
      a = 0.07 + 0.43 * Math.min(1, seaIce[c] * INV_ICE_FULL);
    } else {
      a = sand[c] > 0.3 ? 0.24 : 0.16;
      if (ash[c] > 0.05) a = a * 0.5 + 0.04;
      const veg = Math.max(tree[c], grass[c] * 0.85, shrub[c] * 0.9, crop[c] * 0.85);
      a = a * (1 - veg) + 0.14 * veg;
      if (ice[c] > 0.1) a = Math.max(a, 0.55);
      const sn = Math.min(1, snow[c] * INV_SNOW_FULL) * (1 - TREE_SNOW_MASK * tree[c]);
      a = a * (1 - sn) + SNOW_ALBEDO * sn;
      if (lava[c] > 0.05) a = 0.05;
    }
    const cl0 = cloud[c];
    a = a + (0.6 - a) * cl0 * CLOUD_SW;
    const Tp = tPot[c];
    // clouds hold back part of the outgoing longwave (cloudy nights stay mild)
    const em = emis * (1 - CLOUD_LW * cl0);
    const bm = bandMean[band[c]];
    // heat capacity: ground skin + air column + standing water
    const C = capBase + (w0 > 0.2 ? 4.2e6 * Math.min(w0, 3) : 0);
    const sea = ocean[c];
    const alt = w0 > 0.5 && sea ? 0 : Math.max(0, surface[c] - datum);
    const lv = lava[c];
    // degree-hours above freezing (and above freezing + 2 °C) and hours at or below it, for the melt / compaction below
    let degH = 0, iceH = 0, coldH = 0;
    if (H1) {
      const TK = Math.max(3, Tp + 273.15);
      const E = em * TK * TK * TK * TK;
      const net = ins * (1 - a) - E + Dband * (bm - Tp) + Dglob * (glob - bm) + Dnbr * (tn[c] - Tp);
      const dEdT = 4 * em * TK * TK * TK + Dband + Dnbr;
      let Tn = Tp + (DT * net) / (C + DT * dEdT);
      if (Tn < -270) Tn = -270;
      tPot[c] = Tn;
      let temp = Tn - lapse * alt + offset + (wMask[c] ? wTemp[c] : 0);
      if (hasGlobal) temp += gD;
      if (lv > 0.05) temp = Math.max(temp, 400 + 600 * Math.min(1, lv));
      temperature[c] = temp;
      const tm = tempMean[c] + (temp - tempMean[c]) * INV_72;
      tempMean[c] = tm;
      // the year-scale memory: an exponential mean over about a year — or, since a reset (resetClimateMemory: a world
      // given air, moved, re-tilted), a growing-window mean that learns the new climate in days, not years
      const nMem = climMem[c];
      // (the window is the most recent quarter of the time since the reset: a world warming for two weeks after its air
      // came is judged by its last few days, then by ever longer stretches until a full year carries the mean)
      const rYear1 = nMem < CLIM_MEM_FULL ? Math.max(invYear, 4 / (nMem + 8)) : invYear;
      if (nMem < CLIM_MEM_FULL) climMem[c] = rYear1 > invYear ? nMem + 1 : CLIM_MEM_FULL;
      const rYear = rYear1, relaxSeas = rYear1 * 0.3;
      const tyr = tempYear[c] + (temp - tempYear[c]) * rYear;
      tempYear[c] = tyr;
      // the year's extremes: envelopes of the hourly temperature, relaxing slowly toward the year's mean
      const hi = tHi[c] + (tyr - tHi[c]) * relaxSeas, lo = tLo[c] + (tyr - tLo[c]) * relaxSeas;
      tHi[c] = hi > temp ? hi : temp;
      tLo[c] = lo < temp ? lo : temp;
      const light = ins * (1 - 0.45 * cl0) * LIGHT_K;
      lightMean[c] += (light - lightMean[c]) * INV_24;
      lightYear[c] += (light - lightYear[c]) * rYear;
    } else if (w0 > DEEP_SINGLE) {
      // deep standing water (the sea, lakes): its heat capacity (≥ ~10 MJ/m²K) keeps one semi-implicit step of H hours
      // under the mean of the hours' suns within a few tenths of a degree of the hourly passes — and the sea is most of
      // a terran world: half the cost of the time-lapse pass. Hourly relaxations compounded.
      const px = pos[c * 3], py = pos[c * 3 + 1], pz = pos[c * 3 + 2];
      let sum = 0;
      for (let k = 0; k < H; k++) {
        const mu = px * sunS[k * 4] + py * sunS[k * 4 + 1] + pz * sunS[k * 4 + 2];
        if (mu > 0) sum += sunS[k * 4 + 3] * mu;
      }
      const insm = (sum / sunN) * trans;
      const TK = Math.max(3, Tp + 273.15);
      const net = insm * (1 - a) - em * TK * TK * TK * TK + Dband * (bm - Tp) + Dglob * (glob - bm) + Dnbr * (tn[c] - Tp);
      let Tn = Tp + (DTH * net) / (C + DTH * (4 * em * TK * TK * TK + Dband + Dnbr));
      if (Tn < -270) Tn = -270;
      tPot[c] = Tn;
      let temp = Tn - lapse * alt + offset + (wMask[c] ? wTemp[c] : 0);
      if (hasGlobal) temp += gD;
      if (lv > 0.05) temp = Math.max(temp, 400 + 600 * Math.min(1, lv));
      temperature[c] = temp;
      tempMean[c] += (temp - tempMean[c]) * kTM;
      const nMem = climMem[c];
      let rYear = invYearH, relaxSeas = seasH;
      if (nMem < CLIM_MEM_FULL) {
        const rYear1 = Math.max(invYear, 4 / (nMem + 8));
        climMem[c] = rYear1 > invYear ? Math.min(CLIM_MEM_FULL, nMem + H) : CLIM_MEM_FULL;
        if (rYear1 > invYear) {
          const k1 = 1 - rYear1, k2 = 1 - rYear1 * 0.3;
          let q1 = k1, q2 = k2;
          for (let i = 1; i < H; i++) { q1 *= k1; q2 *= k2; }
          rYear = 1 - q1; relaxSeas = 1 - q2;
        }
      }
      const tyr = tempYear[c] + (temp - tempYear[c]) * rYear;
      tempYear[c] = tyr;
      const hi = tHi[c] + (tyr - tHi[c]) * relaxSeas, lo = tLo[c] + (tyr - tLo[c]) * relaxSeas;
      tHi[c] = hi > temp ? hi : temp;
      tLo[c] = lo < temp ? lo : temp;
      const light = insm * (1 - 0.45 * cl0) * LIGHT_K;
      lightMean[c] += (light - lightMean[c]) * kLM;
      lightYear[c] += (light - lightYear[c]) * rYear;
      if (temp > freeze) { degH = (temp - freeze) * H; if (temp > freeze + 2) iceH = degH; } else coldH = H;
    } else {
      // time-lapse / dormant pass (push 2 round 2): the H hours it stands for, one by one — the energy balance
      // re-linearised every hour under that hour's own sun (one H-hour step linearised at the starting temperature
      // overshot radiative equilibrium on low-capacity ground: a dead moon ran ~30 °C warm, airless worlds warmer at
      // 1000x, every day/night cycle flattened), and every temperature-driven accumulator — the means, the year's
      // envelopes, light, the degree-hours of melt — fed each hour as the hourly passes would. Band, global and
      // neighbour temperatures (transport) and the albedo hold for the pass.
      const px = pos[c * 3], py = pos[c * 3 + 1], pz = pos[c * 3 + 2];
      const wT = wMask[c] ? wTemp[c] : 0;
      const lavaT = lv > 0.05 ? 400 + 600 * Math.min(1, lv) : -1e9;
      const a1 = 1 - a, shade = (1 - 0.45 * cl0) * LIGHT_K, nbrT = tn[c], gTerm = Dglob * (glob - bm);
      let Tn = Tp, temp = 0;
      let tm = tempMean[c], tyr = tempYear[c], hi = tHi[c], lo = tLo[c], lm = lightMean[c], ly = lightYear[c];
      let nMem = climMem[c];
      for (let k = 0; k < H; k++) {
        const j = k * 4;
        const mu = px * sunS[j] + py * sunS[j + 1] + pz * sunS[j + 2];
        const insk = mu > 0 ? sunS[j + 3] * mu * trans : 0;
        const TK = Tn + 273.15 > 3 ? Tn + 273.15 : 3;
        const TK3 = TK * TK * TK;
        const net = insk * a1 - em * TK3 * TK + Dband * (bm - Tn) + gTerm + Dnbr * (nbrT - Tn);
        Tn = Tn + (DT * net) / (C + DT * (4 * em * TK3 + Dband + Dnbr));
        if (Tn < -270) Tn = -270;
        temp = Tn - lapse * alt + offset + wT;
        if (hasGlobal) temp += gD;
        if (temp < lavaT) temp = lavaT;
        tm += (temp - tm) * INV_72;
        let rY = invYear;
        if (nMem < CLIM_MEM_FULL) {
          const r1 = 4 / (nMem + 8);
          if (r1 > invYear) { rY = r1; nMem++; } else nMem = CLIM_MEM_FULL;
        }
        tyr += (temp - tyr) * rY;
        const rs = rY * 0.3;
        hi += (tyr - hi) * rs; lo += (tyr - lo) * rs;
        if (temp > hi) hi = temp;
        if (temp < lo) lo = temp;
        const light = insk * shade;
        lm += (light - lm) * INV_24;
        ly += (light - ly) * rY;
        if (temp > freeze) { degH += temp - freeze; if (temp > freeze + 2) iceH += temp - freeze; } else coldH++;
      }
      tPot[c] = Tn; temperature[c] = temp; tempMean[c] = tm; tempYear[c] = tyr; tHi[c] = hi; tLo[c] = lo;
      lightMean[c] = lm; lightYear[c] = ly; climMem[c] = nMem;
    }
    const T = temperature[c];
    // (an hourly pass: its own hour, from the stored temperature exactly as before)
    if (H1) { if (T > freeze) { degH = T - freeze; if (T > freeze + 2) iceH = degH; } else coldH = 1; }

    // ── humidity: advection, sources, precipitation, climate clouds ──
    if (airy) {
      const ws = Math.sqrt(windX[c] * windX[c] + windY[c] * windY[c] + windZ[c] * windZ[c]);
      const steps = Math.min(4, Math.round(ws * ADVECT_CELLS_PER_MS));
      let up = c;
      for (let k = 0; k < steps; k++) {
        const nx = up1[up];
        if (nx < 0) break;
        up = nx;
      }
      let qq: number = qn[up];
      const ef = Math.min(1.3, Math.max(0.04, (T + 12) * INV_38));
      const frozen = T < freeze;
      // sources relax the air toward a source humidity (open water ~0.8, wet ground and plants less)
      if (sea || w0 > 0.02) {
        const k = 0.12 * ef * (seaIce[c] > 0.1 ? 0.25 : 1) * (frozen ? 0.4 : 1);
        qq += (0.8 - qq) * k;
      } else {
        const src = 0.05 * moisture[c] + 0.035 * (tree[c] + 0.5 * grass[c] + 0.6 * crop[c]);
        qq += (0.85 - qq) * src * ef;
      }
      // subsidence dries the air slowly
      qq *= 0.99;
      // rain needs lift: orographic (wind climbing from the upwind cell), convective (hot, humid), or the drifting
      // disturbances in `wn` (fronts and shower cells); weather systems add their own rain on top (overlay)
      const rise = surface[c] - surface[up];
      const oro = rise > 0 ? Math.min(0.2, rise * INV_150) : 0;
      const conv = T > 24 && qq > 0.7 ? 0.04 : 0;
      const crit = 0.86 - oro - conv - 0.06 * cloudiness - 0.09 * wn[c];
      let pr = 0;
      if (qq > crit) {
        const ex = qq - crit;
        pr = ex * 22;
        qq -= ex * 0.6;
      }
      if (gFloor) pr = Math.max(pr, gP);
      if (hasGlobal) qq = Math.min(1, Math.max(0, qq + gH));
      q[c] = qq < 0 ? 0 : qq > 1 ? 1 : qq;
      cPrecip[c] = pr;
      // clouds form as the air nears saturation for lift
      let cl = (q[c] - crit + 0.2) * INV_024 + 0.25 * wn[c];
      cl = cl < 0 ? 0 : cl > 1 ? 1 : cl;
      cl = 0.15 * cloudiness + 0.85 * cl + (pr > 0 ? 0.15 : 0);
      if (hasGlobal) cl += gC;
      cCloud[c] = cl < 0 ? 0 : cl > 1 ? 1 : cl;
      precipMean[c] += (pr - precipMean[c]) * kPM;
    } else {
      q[c] = 0;
      cPrecip[c] = 0;
      cCloud[c] = 0;
      precipMean[c] *= airlessP;
    }

    // ── sky: climate precip / cloud + the weather-system overlay (composeSky) ──
    let pr = cPrecip[c];
    let ty = pr > 0 ? (T < snowBelow ? 2 : 1) : 0;
    let cl = cCloud[c];
    if (wMask[c]) {
      const wp = wPrecip[c];
      if (wp > pr || (wType[c] > 0 && wp > 0)) {
        pr = Math.max(pr, wp);
        ty = wType[c];
        // a rain system in freezing air falls as snow
        if (ty === 1 && T < freeze) ty = 2;
      }
      cl = Math.min(1, Math.max(0, cl + wCloud[c]));
    }
    precip[c] = pr;
    precipType[c] = pr > 0 ? ty : 0;
    cloud[c] = cl;
    const prF = precip[c];
    const tyF = precipType[c];

    // ── surface water exchanges: snowfall, melt, freeze, evaporation / boiling, infiltration, wetness ──
    let changedHere = false;
    // snowfall (1 mm water ≈ 1 cm snow)
    if (prF > 0 && tyF === 2 && !(sea && water[c] > 0.5)) {
      snow[c] += prF * 0.01 * rs3 * H;
      changedHere = true;
    }
    if (doFreeze) {
      // snow melt (degree-hour) feeds surface water; deep old snow compacts into glacier ice
      // (by the degree-hours of the hours this pass stands for: an hourly pass's own hour exactly as before)
      if (snow[c] > 0) {
        if (degH > 0) {
          const m = Math.min(snow[c], 0.004 * degH);
          snow[c] -= m;
          if (airy && T < boil) {
            water[c] += m * 0.25;
            sourced += m * 0.25 * area[c];
            if (m > 0.008) wakeIfUnlevel(p, c);
          }
          changedHere = true;
        }
        if (coldH > 0 && snow[c] > 2.5) {
          snow[c] -= 0.002 * coldH;
          ice[c] += 0.0018 * coldH;
          changedHere = true;
        }
        if (!airy && snow[c] > 0) { snow[c] = Math.max(0, snow[c] - 0.002 * H); changedHere = true; }
      }
      if (ice[c] > 0 && iceH > 0) {
        const m = Math.min(ice[c], 0.0012 * iceH);
        ice[c] -= m;
        if (airy && T < boil) { water[c] += m * 0.9; sourced += m * 0.9 * area[c]; if (m > 0.004) wakeIfUnlevel(p, c); }
        changedHere = true;
      }
      // standing water freezes over / thaws
      if (water[c] > 0.02) {
        // salt water freezes ~2 °C lower than fresh
        const fz = salinity[c] > 0.5 ? freeze - SALT_FREEZE : freeze;
        if (T < fz - 0.5) seaIce[c] = Math.min(Math.min(water[c], 3), seaIce[c] + 0.01 * (fz - T) * H);
        else if (seaIce[c] > 0) seaIce[c] = Math.max(0, seaIce[c] - 0.02 * (T - fz + 0.5) * H);
      } else if (seaIce[c] > 0) seaIce[c] = 0;
    }
    if (changedHere) { changed[nChanged++] = c; anyChanged = true; }
    // evaporation and boiling (the open ocean is a reservoir: its level is held by the sea-level relaxation). Evaporation
    // and infiltration are this hour's only, at every level: a time-lapse or dormant schedule runs the hours the pass
    // skips in soilHour (push 2 round 2 — one H-hour exchange against the water standing at the instant of the pass
    // missed most of the rain that ran off in between: soils dried, wetlands shrank by a quarter at 1000x).
    // Transpiration (below) needs no standing water: it stays H hours here (hourly in soilHour measured the same)
    const w = water[c];
    if (w > 0 && !sea && evaporation > 0) {
      let rate: number;
      if (T < freeze) rate = airy ? 0.00005 : 0.002; // frozen: sublimation (fast in vacuum)
      else if (T >= boil) rate = Math.min(1.5, 0.05 + 0.02 * (T - boil)); // boiling (any liquid in vacuum)
      else rate = 0.0006 * Math.min(1.3, Math.max(0.05, (T + 12) * INV_38)) * (1 - q[c] * 0.8) * (1 + Math.sqrt(windX[c] * windX[c] + windY[c] * windY[c] + windZ[c] * windZ[c]) * INV_12);
      const d = Math.min(w, rate * evaporation);
      if (d > 0) {
        water[c] = w - d;
        sourced -= d * area[c];
        if (d > 0.002) wakeIfUnlevel(p, c);
      }
    }
    // infiltration into soil moisture, overflow recharges the aquifer
    const w2 = water[c];
    if (!sea && infiltration > 0 && T > freeze) {
      const so = soil[c], sa = sand[c];
      const depth = so + sa;
      const cap = 0.4 * (depth + 0.08);
      if (w2 > 0) {
        // permeability(p, c) and soak(p, c, inf)
        const inf = Math.min(w2, 0.004 * (0.25 + Math.min(1, so) + 2.5 * Math.min(1, sa)) * infiltration);
        water[c] = w2 - inf;
        sourced -= inf * area[c];
        let m = moisture[c] + inf / cap;
        if (m > 1) {
          aquifer[c] += (m - 1) * cap;
          m = 1;
        }
        moisture[c] = m;
        if (inf > 0.002) wakeIfUnlevel(p, c);
      }
      // evapotranspiration dries the soil
      if (airy) {
        const veg = tree[c] + 0.6 * grass[c] + 0.5 * shrub[c] + 0.6 * crop[c];
        const et = 0.0009 * Math.min(1.3, Math.max(0.03, (T + 5) * INV_30)) * (0.4 + veg) * (1 - 0.7 * q[c]);
        moisture[c] = Math.max(0, moisture[c] - et / cap * 0.25 * H);
        // the banks of fresh water stay moist (seepage): green strips along desert rivers, oases round desert lakes
        // (the riparian flags are this pass's: compounded over the hours it stands for, soilHour leaves them out)
        if (rip[c] && moisture[c] < RIPARIAN) moisture[c] += (RIPARIAN - moisture[c]) * kRip;
      }
    } else if (sea) {
      moisture[c] = 1;
    }
    if (!airy && water[c] <= 0) moisture[c] = Math.max(0, moisture[c] - 0.01 * H);
    // wetness for shading
    const ww = water[c];
    let wet = wetness[c] * wetKeep;
    if (ww > 0.002) wet = Math.max(wet, Math.min(1, 0.35 + ww * INV_003));
    if (prF > 0 && (tyF === 1 || tyF === 5 || tyF === 6)) wet = Math.max(wet, Math.min(1, 0.5 + prF * 0.08));
    wet = Math.max(wet, moisture[c] * 0.35);
    wetness[c] = wet > 1 ? 1 : wet;
  }
  p.hydro.sourced += sourced;
  return anyChanged ? nChanged : -1;
}

/**
 * The soil hour (SIM perf push 2, round 2): the land's hourly exchanges with standing water — evaporation / boiling and
 * infiltration into soil moisture (overflow to the aquifer) — for an hour on which a time-lapse or dormant schedule
 * skips the climate pass (sim.ts runPlanet; the pass then does its own hour). Rain arrives in batches and thin sheets
 * carry it off within the hour, so one multi-hour exchange against the water standing at the instant of the pass missed
 * most of it: soils dried and wetlands shrank by a quarter at 1000x. The same expressions as columnKernel's soil block
 * at H = 1, under the sky of the last pass (temperature, humidity, wind hold between passes). Mass: every m³ taken is
 * accounted in hydro.sourced, as in the pass. Cost: one read of the water per cell, work on wet land only.
 */
export function soilHour(u: Universe, p: Planet): void {
  const cfg = p.cfg, f = p.f;
  if (cfg.evaporation <= 0 && cfg.infiltration <= 0) return;
  const sourced = soilKernel(
    p, p.count, p.airy, cfg.evaporation, cfg.infiltration, p.st.liquid.freeze, boilingPoint(p), f.water, p.cellArea,
    p.s.ocean, f.temperature, f.humidity, f.windX, f.windY, f.windZ, f.soil, f.sand, f.moisture, f.aquifer,
  );
  if (sourced !== 0) { p.hydro.sourced += sourced; p.bump('water'); p.bump('moisture'); p.bump('aquifer'); }
}

function soilKernel(
  p: Planet, N: number, airy: boolean, evaporation: number, infiltration: number, freeze: number, boil: number,
  water: Float64Array, area: Float64Array, ocean: Uint8Array, temperature: Float32Array, q: Float32Array,
  windX: Float32Array, windY: Float32Array, windZ: Float32Array, soil: Float32Array, sand: Float32Array,
  moisture: Float32Array, aquifer: Float32Array,
): number {
  let sourced = 0;
  for (let c = 0; c < N; c++) {
    const w = water[c];
    if (w <= 0 || ocean[c] !== 0) continue;
    const T = temperature[c];
    if (evaporation > 0) {
      let rate: number;
      if (T < freeze) rate = airy ? 0.00005 : 0.002;
      else if (T >= boil) rate = Math.min(1.5, 0.05 + 0.02 * (T - boil));
      else rate = 0.0006 * Math.min(1.3, Math.max(0.05, (T + 12) * INV_38)) * (1 - q[c] * 0.8) * (1 + Math.sqrt(windX[c] * windX[c] + windY[c] * windY[c] + windZ[c] * windZ[c]) * INV_12);
      const d = Math.min(w, rate * evaporation);
      if (d > 0) {
        water[c] = w - d;
        sourced -= d * area[c];
        if (d > 0.002) wakeIfUnlevel(p, c);
      }
    }
    if (infiltration > 0 && T > freeze) {
      const so = soil[c], sa = sand[c];
      const cap = 0.4 * (so + sa + 0.08);
      const w2 = water[c];
      if (w2 > 0) {
        const inf = Math.min(w2, 0.004 * (0.25 + Math.min(1, so) + 2.5 * Math.min(1, sa)) * infiltration);
        water[c] = w2 - inf;
        sourced -= inf * area[c];
        let m = moisture[c] + inf / cap;
        if (m > 1) {
          aquifer[c] += (m - 1) * cap;
          m = 1;
        }
        moisture[c] = m;
        if (inf > 0.002) wakeIfUnlevel(p, c);
      }
    }
  }
  return sourced;
}

const SOLAR = 1361;

/**
 * The altitude datum of the lapse rate (m): fixed at generation — the sea level of a world with seas, the mean ground
 * of a dry one (a dry world is not all highland). It does NOT follow the live sea: the air column does not move with
 * the sea-level slider, so raising the sea 120 m must not warm every mountain by 7 °C (nor draining it chill the land).
 */
export function altitudeDatum(p: Planet): number {
  return p.st.refLevel ?? 0;
}

/** infiltration capacity of a cell (m of water per hour): sand drinks fast, bare rock barely */
export function permeability(p: Planet, c: number): number {
  const f = p.f;
  return 0.004 * (0.25 + Math.min(1, f.soil[c]) + 2.5 * Math.min(1, f.sand[c])) * p.cfg.infiltration;
}

/** water soaking into the ground: soil moisture first, the overflow recharges the aquifer */
export function soak(p: Planet, c: number, amount: number): void {
  const f = p.f;
  const cap = 0.4 * (f.soil[c] + f.sand[c] + 0.08);
  let m = f.moisture[c] + amount / cap;
  if (m > 1) {
    f.aquifer[c] += (m - 1) * cap;
    m = 1;
  }
  f.moisture[c] = m;
}

// ───────────────────────────── raining cells (for the hydrology step) ─────────────────────────────

// A cache, not state: it must be a pure function of SAVED arrays that are always marked dirty when they change, or a
// loaded game / rewind keyframe (which rebuilds it) would diverge from the live sim. It therefore depends ONLY on
// `precip` and `precipType` (written by composeSky, whose callers — the climate pass and refreshOverlay — mark it
// dirty). The ocean mask is deliberately NOT filtered here: the mask changes under a sea-level ramp, a dig-sea or any
// shore brush, and a list filtered by a stale mask starved newly exposed land of rain (and broke save/load identity).
// applySources skips ocean cells itself, against the live mask.

interface RainCache { list: Int32Array; count: number; dirty: boolean }
const rainCache = new WeakMap<Planet, RainCache>();

export function markRainDirty(p: Planet): void {
  const r = rainCache.get(p);
  if (r) r.dirty = true;
}

/** cells currently receiving liquid precipitation, sea included (rebuilt from the saved precip fields when dirty) */
export function rainingCells(p: Planet): { list: Int32Array; count: number } {
  let r = rainCache.get(p);
  if (!r) { r = { list: new Int32Array(p.count), count: 0, dirty: true }; rainCache.set(p, r); }
  if (r.dirty) {
    let k = 0;
    const f = p.f;
    for (let c = 0; c < p.count; c++) {
      if (f.precip[c] <= 0) continue;
      const ty = f.precipType[c];
      if (ty === 1 || ty === 3 || ty === 5 || ty === 6) r.list[k++] = c;
    }
    r.count = k;
    r.dirty = false;
  }
  return r;
}

// ───────────────────────────── initialisation ─────────────────────────────

/**
 * Bring a freshly generated planet to climatic equilibrium: annual-mean insolation, an equilibrium temperature solve,
 * initial humidity / soil moisture / snow / sea ice, then a day of hourly steps so day-night and clouds are live.
 */
export function initClimate(u: Universe, p: Planet): void {
  const f = p.f, s = p.s, g = p.grid, st = p.st;
  const N = p.count;
  const sc = scratch(p);
  const airy = airFactor(p) > 0;
  // annual + daily mean insolation from 8 orbital positions × 12 hours
  const mean = new Float64Array(N);
  const yearT = st.orbit.period;
  const dayT = st.dayHours * 60;
  const pos = g.pos;
  let samples = 0;
  // and the brightest and darkest season of each cell (daily means at the 8 points of the orbit): the year's swing
  const qHi = new Float64Array(N), qLo = new Float64Array(N).fill(Infinity), qk = new Float64Array(N);
  for (let k = 0; k < 8; k++) {
    qk.fill(0);
    for (let h = 0; h < 12; h++) {
      const t = (k / 8) * yearT + (h / 12) * dayT;
      const sun = u.sun(p, t, _sun);
      const sx = sun.dir[0], sy = sun.dir[1], sz = sun.dir[2];
      for (let c = 0; c < N; c++) {
        const mu = pos[c * 3] * sx + pos[c * 3 + 1] * sy + pos[c * 3 + 2] * sz;
        if (mu > 0) { mean[c] += sun.flux * mu; qk[c] += sun.flux * mu; }
      }
      samples++;
    }
    for (let c = 0; c < N; c++) { const q = qk[c] / 12; if (q > qHi[c]) qHi[c] = q; if (q < qLo[c]) qLo[c] = q; }
  }
  const dust = Math.exp(-0.35 * st.atmosphere.dust);
  for (let c = 0; c < N; c++) {
    mean[c] /= samples;
    f.cloud[c] = airy ? 0.35 : 0;
    s.lightMean[c] = (mean[c] * dust) / SOLAR / 0.318;
    s.lightYear[c] = s.lightMean[c];
  }
  // 1. a first equilibrium under a uniform cloud deck and moist air
  for (let c = 0; c < N; c++) s.tPot[c] = 0;
  const firstSky = new Float32Array(N).fill(airy ? 0.35 : 0);
  solveEquilibrium(p, sc, mean, dust, firstSky, greenhouse(p, airy ? 0.6 : 0), false);
  const lapse = LAPSE * Math.min(1, st.atmosphere.pressure);
  const freeze = st.liquid.freeze;
  // ocean distance for an initial moisture climatology
  const dist = new Float32Array(N).fill(64);
  const qd: number[] = [];
  for (let c = 0; c < N; c++) if (s.ocean[c] || f.water[c] > 0.5) { dist[c] = 0; qd.push(c); }
  for (let i = 0; i < qd.length; i++) {
    const c = qd[i];
    if (dist[c] >= 63) continue;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (dist[o] > dist[c] + 1) { dist[o] = dist[c] + 1; qd.push(o); }
    }
  }
  const datum = altitudeDatum(p);
  for (let c = 0; c < N; c++) {
    const alt = s.ocean[c] ? 0 : Math.max(0, f.surface[c] - datum);
    const t = s.tPot[c] - lapse * alt + st.climateOffset;
    f.temperature[c] = t;
    s.tempMean[c] = t;
    s.tempYear[c] = t;
    if (!airy) { f.humidity[c] = 0; f.moisture[c] = 0; continue; }
    const lat = g.lat[c];
    const hadley = 0.5 + 0.35 * Math.cos(6 * lat);
    const coastal = Math.exp(-dist[c] / 10);
    const bias = st.moistureBias ?? 1;
    const m = (0.15 + 0.35 * hadley + 0.45 * coastal + 0.15 * p.noise.fbm(pos[c * 3] * 3 - 4, pos[c * 3 + 1] * 3, pos[c * 3 + 2] * 3 + 2, 3)) * bias;
    f.moisture[c] = s.ocean[c] ? 1 : Math.max(0.02, Math.min(1, m));
    // near what the running model keeps (seas ~0.62, inland ~0.55): the spin-up below measures the sky it makes
    f.humidity[c] = 0.52 + 0.1 * coastal;
    f.aquifer[c] = s.ocean[c] ? 0 : f.moisture[c] * (1 + 2 * Math.min(1, f.soil[c]));
    if (!s.ocean[c] && t < freeze - 2 && f.water[c] < 0.05) {
      f.snow[c] = Math.min(2.2, (freeze - 2 - t) * 0.08);
      p.updSurface(c);
    }
    const fz = f.salinity[c] > 0.5 ? freeze - SALT_FREEZE : freeze;
    if (f.water[c] > 0.02 && t < fz - 1) s.seaIce[c] = Math.min(Math.min(3, f.water[c]), (fz - 1 - t) * 0.12);
  }
  const steps = Math.max(12, Math.round(st.dayHours));
  if (airy) {
    // 2. the running model's own sky. The first solve assumed a uniform 0.35 cloud deck, moist air and no snow or ice
    // albedo; the hourly model then makes its own clouds (thicker over warm seas), its own vapour greenhouse and its own
    // snow and sea ice, and the seas — whose heat capacity gives them a response time of years — crept toward that
    // model's colder balance for a decade (land −3 °C a year, snow and sea ice spreading, plants dying back). Two days
    // of hourly steps measure the sky the model keeps; the balance is solved again under it, with snow and sea ice
    // laid where that balance freezes (their albedo inside the solve).
    const hours = steps;
    const cloudSum = new Float64Array(N);
    const sky = new Float32Array(N);
    for (let round = 0; round < SPINUP_ROUNDS; round++) {
      cloudSum.fill(0);
      let qSum = 0;
      const t0 = (SPINUP_ROUNDS - round) * hours + steps;
      for (let k = t0; k > t0 - hours; k--) {
        climateStep(u, p, -k * CLIMATE_CADENCE);
        for (let c = 0; c < N; c++) cloudSum[c] += f.cloud[c];
        let qm = 0;
        for (let c = 0; c < N; c += 7) qm += f.humidity[c];
        qSum += qm / Math.ceil(N / 7);
      }
      // the weather systems (none yet at build) add ~7 % to the cloud the climate makes on its own
      for (let c = 0; c < N; c++) sky[c] = Math.min(1, (cloudSum[c] / hours) * WEATHER_CLOUD);
      solveEquilibrium(p, sc, mean, dust, sky, greenhouse(p, qSum / hours), true);
      for (let c = 0; c < N; c++) {
        const alt = s.ocean[c] ? 0 : Math.max(0, f.surface[c] - datum);
        const t = s.tPot[c] - lapse * alt + st.climateOffset;
        f.temperature[c] = t;
        s.tempMean[c] = t;
        s.tempYear[c] = t;
        if (s.ocean[c] || f.water[c] >= 0.05) {
          const fz = f.salinity[c] > 0.5 ? freeze - SALT_FREEZE : freeze;
          s.seaIce[c] = f.water[c] > 0.02 && t < fz - 1 ? Math.min(Math.min(3, f.water[c]), (fz - 1 - t) * 0.12) : 0;
          continue;
        }
        const sn = t < freeze - 2 ? Math.min(2.2, (freeze - 2 - t) * 0.08) : 0;
        if (sn !== f.snow[c]) { f.snow[c] = sn; p.updSurface(c); }
      }
    }
  }
  seedSwings(p, sc, qHi, qLo, dust, airy ? greenhouse(p, 0.62) : greenhouse(p, 0));
  // one day of hourly steps so the sky, winds and day-night state are alive at tick 0 (it measures the day's swing)
  for (let k = steps; k >= 1; k--) climateStep(u, p, -k * CLIMATE_CADENCE);
  p.updAllSurface();
}

/**
 * Banks of fresh standing water start moist (scenario build: lakes and rivers are laid after the climate's moisture
 * climatology, and plants are sown after them) — the running climate keeps them so.
 */
export function seedRiparian(p: Planet): void {
  const f = p.f, g = p.grid;
  if (airFactor(p) <= 0) return;
  for (let c = 0; c < p.count; c++) {
    if (p.s.ocean[c] || f.water[c] > 0.05 || f.moisture[c] >= RIPARIAN) continue;
    for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) {
      const o = g.nbr[e];
      if (f.water[o] > 0.05 && f.salinity[o] < 0.5) { f.moisture[c] = RIPARIAN; break; }
    }
  }
}

/**
 * First estimates of the year's extremes (s.tHi / tLo: the hottest and coldest hour; the running model refines them from
 * what it lives through). Both swings are first-order responses of the cell's heat capacity to its sunlight: the
 * seasons from the cell's insolation range over the orbit (tilt, latitude, eccentricity), damped over the year (seas
 * barely follow a short year, land does), and the day from its brightest season's daylight, damped over the day.
 */
function seedSwings(p: Planet, sc: ClimateScratch, qHi: Float64Array, qLo: Float64Array, dust: number, gh: number): void {
  const s = p.s, f = p.f, st = p.st;
  const N = p.count;
  const P = Math.min(3, st.atmosphere.pressure);
  const emis = SIGMA * (1 - gh);
  const Dglob = D_GLOB * Math.sqrt(P);
  const wYear = (2 * Math.PI) / Math.max(3600, st.orbit.period * 60);
  const wDay = (2 * Math.PI) / Math.max(3600, st.dayHours * 3600);
  const capBase = 3.0e4 + 1.1e6 * P;
  for (let c = 0; c < N; c++) {
    const TK = Math.max(3, s.tPot[c] + 273.15);
    const B = 4 * emis * (1 - CLOUD_LW * f.cloud[c]) * TK * TK * TK + Dglob;
    const w = f.water[c];
    const C = capBase + (w > 0.2 ? 4.2e6 * Math.min(w, 3) : 0);
    const absorb = dust * (1 - albedo(p, c));
    const seas = (0.5 * (qHi[c] - qLo[c]) * absorb) / Math.sqrt(B * B + C * wYear * C * wYear);
    // daylight is a half-wave: its daily harmonic is ~π/2 of the daily mean
    const day = (1.5708 * qHi[c] * absorb) / Math.sqrt(B * B + C * wDay * C * wDay);
    const amp = Math.min(150, seas + day);
    const t = s.tempYear[c];
    s.tHi[c] = t + amp;
    s.tLo[c] = t - amp;
  }
  void sc;
}

/**
 * Energy-balance equilibrium of tPot under the annual-mean insolation `ins` (Newton sweeps with the hourly model's band
 * and global transport), the cell albedo of `albedo()` with the cloud cover `sky` in place of the live clouds, and the
 * greenhouse factor `gh`. With `frozen`, snow and sea ice are laid in the solve itself where the balance falls below
 * freezing (their albedo feeds back on the balance as it will in the running model).
 */
function solveEquilibrium(p: Planet, sc: ClimateScratch, ins: Float64Array, dust: number, sky: Float32Array, gh: number, frozen: boolean): void {
  const s = p.s, f = p.f, st = p.st;
  const N = p.count;
  const P = Math.min(3, st.atmosphere.pressure);
  const emis = SIGMA * (1 - gh);
  const Dband = 4.0 * P, Dglob = D_GLOB * Math.sqrt(P);
  const lapse = LAPSE * Math.min(1, st.atmosphere.pressure);
  const datum = altitudeDatum(p);
  const freeze = st.liquid.freeze;
  const live = f.cloud;
  const saved = live.slice();
  live.set(sky);
  const Dnbr = airFactor(p) > 0 ? nbrMixing(p, P) : 0;
  const tn = sc.tn, g = p.grid;
  for (let it = 0; it < 80; it++) {
    const glob = bandMeans(p, sc);
    if (Dnbr > 0) for (let c = 0; c < N; c++) {
      let sum = 0;
      const e1 = g.nbrStart[c + 1];
      for (let e = g.nbrStart[c]; e < e1; e++) sum += s.tPot[g.nbr[e]];
      tn[c] = sum / (e1 - g.nbrStart[c]);
    }
    for (let c = 0; c < N; c++) {
      const T = s.tPot[c];
      const TK = Math.max(3, T + 273.15);
      let a = albedo(p, c);
      if (frozen) {
        // the snow / ice this temperature would lay (a ramp across freezing keeps the Newton sweeps smooth)
        const wet = s.ocean[c] || f.water[c] >= 0.05;
        const t = T - (wet ? 0 : lapse * Math.max(0, f.surface[c] - datum)) + st.climateOffset;
        const fz = wet && f.salinity[c] > 0.5 ? freeze - SALT_FREEZE : freeze;
        const k = Math.max(0, Math.min(1, (fz + (wet ? 0 : 1) - t) / 3));
        if (k > 0) {
          const ice = wet ? 0.5 : SNOW_ALBEDO * (1 - TREE_SNOW_MASK * f.tree[c]) + a * TREE_SNOW_MASK * f.tree[c];
          const aIce = ice + (0.6 - ice) * sky[c] * CLOUD_SW;
          a = Math.max(a, a + (aIce - a) * k);
        }
      }
      const bm = sc.bandMean[sc.band[c]];
      const em = emis * (1 - CLOUD_LW * sky[c]);
      const net = ins[c] * dust * (1 - a) - em * TK ** 4 + Dband * (bm - T) + Dglob * (glob - bm) + Dnbr * (tn[c] - T);
      const d = 4 * em * TK ** 3 + Dband + Dnbr;
      s.tPot[c] = Math.max(-270, T + (0.8 * net) / d);
    }
  }
  live.set(saved);
}

/**
 * Forget a planet's climate memory (the year means and extremes that plants, biomes and settling peoples judge by):
 * after a change of air, orbit or spin the old climate is no guide. The running model relearns it as a growing-window
 * mean, so a terraformed world is judged by its new weather within days.
 */
export function resetClimateMemory(p: Planet): void {
  const s = p.s, t = p.f.temperature;
  for (let c = 0; c < p.count; c++) { s.tempYear[c] = t[c]; s.tHi[c] = t[c]; s.tLo[c] = t[c]; s.climMem[c] = 0; }
}
