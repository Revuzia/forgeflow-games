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

import type { Universe, SunInfo } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { activateCell } from './hydrology.ts';
import { refreshOverlay } from './weather.ts';

export const CLIMATE_CADENCE = 60;
const SIGMA = 5.670e-8;
const BANDS = 48;
/** stylised lapse rate (K/m at ≥ 1 atm): our mountains are ~400 m, so the real 6.5 K/km would never snow them in */
export const LAPSE = 0.06;
/** semi-Lagrangian humidity transport: cells walked upwind per (m/s) of wind per climate hour */
const ADVECT_CELLS_PER_MS = 0.22;
const DT = 3600;

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
    s = { band, bandArea, bandSum: new Float64Array(BANDS), bandMean: new Float64Array(BANDS), q2: new Float32Array(N), up: new Int32Array(N), wn: new Float32Array(N) };
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

function heatCapacity(p: Planet, c: number): number {
  const P = Math.min(3, p.st.atmosphere.pressure);
  const w = p.f.water[c];
  // bare ground has a thin thermal skin (regolith: hours); an air column couples ~2 days of capacity (stylised: a world
  // given air warms within a few game days, not weeks); standing water more (ocean moderation)
  return 3.0e4 + 1.1e6 * P + (w > 0.2 ? 4.2e6 * Math.min(w, 3) : 0);
}

/** surface + cloud albedo of a cell */
function albedo(p: Planet, c: number): number {
  const f = p.f;
  let a: number;
  if (f.water[c] > 0.05) {
    a = p.s.seaIce[c] > 0.05 ? 0.5 : 0.07;
  } else {
    a = f.sand[c] > 0.3 ? 0.24 : 0.16;
    if (f.ash[c] > 0.05) a = a * 0.5 + 0.04;
    const veg = Math.max(f.tree[c], f.grass[c] * 0.85, f.shrub[c] * 0.9, f.crop[c] * 0.85);
    a = a * (1 - veg) + 0.14 * veg;
    if (f.ice[c] > 0.1) a = Math.max(a, 0.55);
    const sn = Math.min(1, f.snow[c] / 0.15);
    a = a * (1 - sn) + 0.75 * sn;
    if (f.lava[c] > 0.05) a = 0.05;
  }
  const cl = f.cloud[c];
  return a + (0.6 - a) * cl * 0.75;
}

const _sun: SunInfo = { dir: [0, 1, 0], flux: 0, dist: 1, lon: 0, decl: 0, spin: 0 };

/** band + global transport means of tPot (area weighted) */
function bandMeans(p: Planet, sc: ClimateScratch): number {
  const t = p.s.tPot;
  sc.bandSum.fill(0);
  const area = p.grid.area;
  for (let c = 0; c < p.count; c++) sc.bandSum[sc.band[c]] += t[c] * area[c];
  let g = 0, ga = 0;
  for (let b = 0; b < BANDS; b++) {
    sc.bandMean[b] = sc.bandArea[b] > 0 ? sc.bandSum[b] / sc.bandArea[b] : 0;
    g += sc.bandSum[b];
    ga += sc.bandArea[b];
  }
  return ga > 0 ? g / ga : 0;
}

/**
 * Slowly drifting noise for wind meanders (two components) and the weather texture `wn`. It is a pure function of the
 * planet and the 3-hour epoch of the tick, cached per planet: three noise lookups per cell are the most expensive part
 * of the hourly pass, and patterns that drift this slowly do not need hourly recomputation. (A cache, not state: a
 * loaded game recomputes the identical values.)
 */
interface DriftNoise { epoch: number; mu: Float32Array; mv: Float32Array; wn: Float32Array }
const driftCache = new WeakMap<Planet, DriftNoise>();
const NOISE_EPOCH = 180;

function driftNoise(p: Planet, tick: number): DriftNoise {
  const epoch = Math.floor(tick / NOISE_EPOCH);
  let d = driftCache.get(p);
  if (d && d.epoch === epoch) return d;
  if (!d) d = { epoch, mu: new Float32Array(p.count), mv: new Float32Array(p.count), wn: new Float32Array(p.count) };
  d.epoch = epoch;
  const nz = p.noise;
  const P = p.grid.pos;
  const drift = epoch * NOISE_EPOCH * 2.5e-5;
  const d2 = drift * 6;
  for (let c = 0; c < p.count; c++) {
    const x = P[c * 3], y = P[c * 3 + 1], z = P[c * 3 + 2];
    const m = nz.noise(x * 2.2 + drift, y * 2.2, z * 2.2 - drift);
    d.mu[c] = m;
    d.mv[c] = nz.noise(x * 2.2 - 7 + drift, y * 2.2, z * 2.2);
    d.wn[c] = 0.65 * nz.noise(x * 5.5 + d2, y * 5.5 - d2 * 0.3, z * 5.5 + 3) + 0.35 * m;
  }
  driftCache.set(p, d);
  return d;
}

/** prevailing wind (m/s, body-frame vector) for every cell; season shifts the cells' bands with the sun. Also fills
 * the drifting weather-noise field `wn`. */
function prevailingWind(p: Planet, decl: number, tick: number, wn: Float32Array): void {
  const af = airFactor(p);
  const s = p.s;
  const geo = p.geo;
  const U = 7 * af;
  const V = 0.35 * U;
  if (af === 0) {
    s.baseWindX.fill(0); s.baseWindY.fill(0); s.baseWindZ.fill(0); wn.fill(0);
    return;
  }
  const dn = driftNoise(p, tick);
  const lat = p.grid.lat;
  const east = geo.east, north = geo.north;
  const bx = s.baseWindX, by = s.baseWindY, bz = s.baseWindZ;
  const mu = dn.mu, mv = dn.mv;
  const half = decl * 0.5;
  const lim = Math.PI / 2;
  for (let c = 0; c < p.count; c++) {
    const la = lat[c] - half;
    const al = la < 0 ? -la : la;
    const sg = la >= 0 ? 1 : -1;
    const w6 = Math.sin(6 * (al < lim ? al : lim));
    // gentle meanders so streams of humidity do not lock to perfect circles
    const u = -U * w6 + 2.2 * af * mu[c];
    const v = -sg * V * w6 + 1.4 * af * mv[c];
    const i3 = c * 3;
    bx[c] = east[i3] * u + north[i3] * v;
    by[c] = east[i3 + 1] * u + north[i3 + 1] * v;
    bz[c] = east[i3 + 2] * u + north[i3 + 2] * v;
  }
  wn.set(dn.wn);
}

/** walk `steps` cells upwind from c along the wind field (deterministic graph walk) */
function upwind(p: Planet, c: number, steps: number): number {
  const g = p.grid, geo = p.geo, f = p.f;
  let cur = c;
  for (let k = 0; k < steps; k++) {
    const wx = -f.windX[cur], wy = -f.windY[cur], wz = -f.windZ[cur];
    let best = -1, bestD = 1e-6;
    for (let e = g.nbrStart[cur]; e < g.nbrStart[cur + 1]; e++) {
      const d = geo.tx[e] * wx + geo.ty[e] * wy + geo.tz[e] * wz;
      if (d > bestD) { bestD = d; best = e; }
    }
    if (best < 0) break;
    cur = g.nbr[best];
  }
  return cur;
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

/** One hourly climate pass over the whole grid. */
export function climateStep(u: Universe, p: Planet, tick = u.tick): void {
  const f = p.f, s = p.s, st = p.st, g = p.grid;
  const N = p.count;
  const sc = scratch(p);
  const sun = u.sun(p, tick, _sun);
  const af = airFactor(p);
  const airy = af > 0;
  const P = Math.min(3, st.atmosphere.pressure);
  const dust = st.atmosphere.dust;
  const trans = Math.exp(-0.35 * dust);
  const freeze = st.liquid.freeze;
  const boil = boilingPoint(p);
  // mean humidity for the vapour greenhouse (cheap: previous hour)
  let qm = 0;
  for (let c = 0; c < N; c += 7) qm += f.humidity[c];
  qm /= Math.ceil(N / 7);
  const gh = greenhouse(p, qm);
  const emis = SIGMA * (1 - gh);
  const Dband = 4.0 * P;
  const Dglob = 0.9 * Math.sqrt(P);
  const lapse = LAPSE * Math.min(1, st.atmosphere.pressure);
  const offset = st.climateOffset;
  const sx = sun.dir[0], sy = sun.dir[1], sz = sun.dir[2];
  const flux = sun.flux;
  const pos = g.pos;
  const glob = bandMeans(p, sc);
  const cfg = p.cfg;
  const globalKind = st.globalWeather != null ? u.content.weather.find(st.globalWeather) : undefined;
  const datum = altitudeDatum(p);

  // 1. prevailing wind, then the weather systems' swirl and gusts on top again: the reset to the base wind would
  // otherwise leave storms windless until the next overlay refresh (up to two weather steps on staggered planets),
  // and sand, fire and the humidity advection below would run on calm air under a sandstorm
  prevailingWind(p, sun.decl, tick, sc.wn);
  for (let c = 0; c < N; c++) {
    f.windX[c] = s.baseWindX[c];
    f.windY[c] = s.baseWindY[c];
    f.windZ[c] = s.baseWindZ[c];
  }
  refreshOverlay(u, p);

  // 2. energy balance -> temperature, light
  let surfaceChanged = false;
  for (let c = 0; c < N; c++) {
    const mu = pos[c * 3] * sx + pos[c * 3 + 1] * sy + pos[c * 3 + 2] * sz;
    const ins = mu > 0 ? flux * mu * trans : 0;
    const a = albedo(p, c);
    const T = s.tPot[c];
    const TK = Math.max(3, T + 273.15);
    const E = emis * TK * TK * TK * TK;
    const bm = sc.bandMean[sc.band[c]];
    const net = ins * (1 - a) - E + Dband * (bm - T) + Dglob * (glob - bm);
    const dEdT = 4 * emis * TK * TK * TK + Dband;
    const C = heatCapacity(p, c);
    let Tn = T + (DT * net) / (C + DT * dEdT);
    if (Tn < -270) Tn = -270;
    s.tPot[c] = Tn;
    const alt = f.water[c] > 0.5 && s.ocean[c] ? 0 : Math.max(0, f.surface[c] - datum);
    let temp = Tn - lapse * alt + offset + (s.wMask[c] ? s.wTemp[c] : 0);
    if (globalKind) temp += globalKind.tempDelta * 0.8;
    if (f.lava[c] > 0.05) temp = Math.max(temp, 400 + 600 * Math.min(1, f.lava[c]));
    f.temperature[c] = temp;
    s.tempMean[c] += (temp - s.tempMean[c]) / 72;
    const light = (ins / SOLAR) * (1 - 0.45 * f.cloud[c]) / 0.318;
    s.lightMean[c] += (light - s.lightMean[c]) / 24;
  }

  // 3. humidity: advection, sources, precipitation, clouds
  const q = f.humidity;
  const q2 = sc.q2;
  if (airy) {
    for (let c = 0; c < N; c++) {
      const ws = Math.sqrt(f.windX[c] * f.windX[c] + f.windY[c] * f.windY[c] + f.windZ[c] * f.windZ[c]);
      const steps = Math.min(4, Math.round(ws * ADVECT_CELLS_PER_MS));
      const up = steps > 0 ? upwind(p, c, steps) : c;
      sc.up[c] = up;
      let nsum = 0, nk = 0;
      for (let e = g.nbrStart[up]; e < g.nbrStart[up + 1]; e++) { nsum += q[g.nbr[e]]; nk++; }
      q2[c] = 0.7 * q[up] + 0.3 * (nsum / nk);
    }
    const wn = sc.wn;
    for (let c = 0; c < N; c++) {
      let qq = q2[c];
      const T = f.temperature[c];
      const ef = Math.min(1.3, Math.max(0.04, (T + 12) / 38));
      const frozen = T < freeze;
      // sources relax the air toward a source humidity (open water ~0.8, wet ground and plants less)
      if (s.ocean[c] || f.water[c] > 0.02) {
        const k = 0.12 * ef * (s.seaIce[c] > 0.1 ? 0.25 : 1) * (frozen ? 0.4 : 1);
        qq += (0.8 - qq) * k;
      } else {
        const src = 0.05 * f.moisture[c] + 0.035 * (f.tree[c] + 0.5 * f.grass[c] + 0.6 * f.crop[c]);
        qq += (0.85 - qq) * src * ef;
      }
      // subsidence dries the air slowly
      qq *= 0.99;
      // rain needs lift: orographic (wind climbing from the upwind cell), convective (hot, humid), or the drifting
      // disturbances in `wn` (fronts and shower cells); weather systems add their own rain on top (overlay)
      const up = sc.up[c];
      const rise = f.surface[c] - f.surface[up];
      const oro = rise > 0 ? Math.min(0.2, rise / 150) : 0;
      const conv = T > 24 && qq > 0.7 ? 0.04 : 0;
      const crit = 0.86 - oro - conv - 0.06 * st.cloudiness - 0.09 * wn[c];
      let pr = 0;
      if (qq > crit) {
        const ex = qq - crit;
        pr = ex * 22;
        qq -= ex * 0.6;
      }
      if (globalKind && globalKind.precip > 0) pr = Math.max(pr, globalKind.precip * 0.7);
      if (globalKind) qq = Math.min(1, Math.max(0, qq + globalKind.humidityDelta * 0.2));
      q[c] = qq < 0 ? 0 : qq > 1 ? 1 : qq;
      s.cPrecip[c] = pr;
      // clouds form as the air nears saturation for lift
      let cl = (q[c] - crit + 0.2) / 0.24 + 0.25 * wn[c];
      cl = cl < 0 ? 0 : cl > 1 ? 1 : cl;
      cl = 0.15 * st.cloudiness + 0.85 * cl + (pr > 0 ? 0.15 : 0);
      if (globalKind) cl += globalKind.cloud * 0.8;
      s.cCloud[c] = cl < 0 ? 0 : cl > 1 ? 1 : cl;
      s.precipMean[c] += (pr - s.precipMean[c]) / 96;
    }
  } else {
    for (let c = 0; c < N; c++) {
      q[c] = 0;
      s.cPrecip[c] = 0;
      s.cCloud[c] = 0;
      s.precipMean[c] *= 0.98;
    }
  }
  for (let c = 0; c < N; c++) composeSky(p, c);

  // 4. surface water exchanges: snowfall, melt, freeze, evaporation / boiling, infiltration, wetness
  const water = f.water;
  const area = p.cellArea;
  let sourced = 0;
  for (let c = 0; c < N; c++) {
    const T = f.temperature[c];
    const pr = f.precip[c];
    const ty = f.precipType[c];
    // snowfall (1 mm water ≈ 1 cm snow)
    if (pr > 0 && ty === 2 && !(s.ocean[c] && water[c] > 0.5)) {
      f.snow[c] += pr * 0.01 * (cfg.rainScale / 3);
      surfaceChanged = true;
    }
    if (cfg.freeze) {
      // snow melt (degree-hour) feeds surface water; deep old snow compacts into glacier ice
      if (f.snow[c] > 0) {
        if (T > freeze) {
          const m = Math.min(f.snow[c], 0.004 * (T - freeze));
          f.snow[c] -= m;
          if (airy && T < boil) {
            water[c] += m * 0.25;
            sourced += m * 0.25 * area[c];
            if (m > 0.008) activateCell(p, c);
          }
          surfaceChanged = true;
        } else if (f.snow[c] > 2.5) {
          f.snow[c] -= 0.002;
          f.ice[c] += 0.0018;
          surfaceChanged = true;
        }
        if (!airy && f.snow[c] > 0) { f.snow[c] = Math.max(0, f.snow[c] - 0.002); surfaceChanged = true; }
      }
      if (f.ice[c] > 0 && T > freeze + 2) {
        const m = Math.min(f.ice[c], 0.0012 * (T - freeze));
        f.ice[c] -= m;
        if (airy && T < boil) { water[c] += m * 0.9; sourced += m * 0.9 * area[c]; if (m > 0.004) activateCell(p, c); }
        surfaceChanged = true;
      }
      // standing water freezes over / thaws
      if (water[c] > 0.02) {
        if (T < freeze - 0.5) s.seaIce[c] = Math.min(Math.min(water[c], 3), s.seaIce[c] + 0.01 * (freeze - T));
        else if (s.seaIce[c] > 0) s.seaIce[c] = Math.max(0, s.seaIce[c] - 0.02 * (T - freeze + 0.5));
      } else if (s.seaIce[c] > 0) s.seaIce[c] = 0;
    }
    // evaporation and boiling (the open ocean is a reservoir: its level is held by the sea-level relaxation)
    const w = water[c];
    if (w > 0 && !s.ocean[c] && cfg.evaporation > 0) {
      let rate: number;
      if (T < freeze) rate = airy ? 0.00005 : 0.002; // frozen: sublimation (fast in vacuum)
      else if (T >= boil) rate = Math.min(1.5, 0.05 + 0.02 * (T - boil)); // boiling (any liquid in vacuum)
      else rate = 0.0006 * Math.min(1.3, Math.max(0.05, (T + 12) / 38)) * (1 - q[c] * 0.8) * (1 + Math.sqrt(f.windX[c] * f.windX[c] + f.windY[c] * f.windY[c] + f.windZ[c] * f.windZ[c]) / 12);
      const d = Math.min(w, rate * cfg.evaporation);
      if (d > 0) {
        water[c] = w - d;
        sourced -= d * area[c];
        if (d > 0.002) activateCell(p, c);
      }
    }
    // infiltration into soil moisture, overflow recharges the aquifer
    const w2 = water[c];
    if (!s.ocean[c] && cfg.infiltration > 0 && T > freeze) {
      const depth = f.soil[c] + f.sand[c];
      const cap = 0.4 * (depth + 0.08);
      if (w2 > 0) {
        const inf = Math.min(w2, permeability(p, c));
        water[c] = w2 - inf;
        sourced -= inf * area[c];
        soak(p, c, inf);
        if (inf > 0.002) activateCell(p, c);
      }
      // evapotranspiration dries the soil
      if (airy) {
        const veg = f.tree[c] + 0.6 * f.grass[c] + 0.5 * f.shrub[c] + 0.6 * f.crop[c];
        const et = 0.0009 * Math.min(1.3, Math.max(0.03, (T + 5) / 30)) * (0.4 + veg) * (1 - 0.7 * q[c]);
        f.moisture[c] = Math.max(0, f.moisture[c] - et / cap * 0.25);
      }
    } else if (s.ocean[c]) {
      f.moisture[c] = 1;
    }
    if (!airy && water[c] <= 0) f.moisture[c] = Math.max(0, f.moisture[c] - 0.01);
    // wetness for shading
    const ww = water[c];
    let wet = f.wetness[c] * 0.8;
    if (ww > 0.002) wet = Math.max(wet, Math.min(1, 0.35 + ww / 0.03));
    if (pr > 0 && (ty === 1 || ty === 5 || ty === 6)) wet = Math.max(wet, Math.min(1, 0.5 + pr * 0.08));
    wet = Math.max(wet, f.moisture[c] * 0.35);
    f.wetness[c] = wet > 1 ? 1 : wet;
  }
  p.hydro.sourced += sourced;
  if (surfaceChanged) {
    for (let c = 0; c < N; c++) p.updSurface(c);
    p.bump('surface');
    p.bump('snow');
    p.bump('ice');
  }
  markRainDirty(p);
  p.bump('temperature'); p.bump('humidity'); p.bump('precip'); p.bump('precipType'); p.bump('cloud');
  p.bump('windX'); p.bump('windY'); p.bump('windZ'); p.bump('water'); p.bump('moisture'); p.bump('wetness'); p.bump('aquifer');
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
  for (let k = 0; k < 8; k++) {
    for (let h = 0; h < 12; h++) {
      const t = (k / 8) * yearT + (h / 12) * dayT;
      const sun = u.sun(p, t, _sun);
      const sx = sun.dir[0], sy = sun.dir[1], sz = sun.dir[2];
      for (let c = 0; c < N; c++) {
        const mu = pos[c * 3] * sx + pos[c * 3 + 1] * sy + pos[c * 3 + 2] * sz;
        if (mu > 0) mean[c] += sun.flux * mu;
      }
      samples++;
    }
  }
  const dust = Math.exp(-0.35 * st.atmosphere.dust);
  for (let c = 0; c < N; c++) {
    mean[c] /= samples;
    f.cloud[c] = airy ? 0.35 : 0;
    s.lightMean[c] = (mean[c] * dust) / SOLAR / 0.318;
  }
  // equilibrium solve (Newton sweeps with transport)
  const P = Math.min(3, st.atmosphere.pressure);
  const gh = greenhouse(p, airy ? 0.6 : 0);
  const emis = SIGMA * (1 - gh);
  const Dband = 4.0 * P, Dglob = 0.9 * Math.sqrt(P);
  for (let c = 0; c < N; c++) s.tPot[c] = 0;
  for (let it = 0; it < 80; it++) {
    const glob = bandMeans(p, sc);
    for (let c = 0; c < N; c++) {
      const T = s.tPot[c];
      const TK = Math.max(3, T + 273.15);
      const a = albedo(p, c);
      const bm = sc.bandMean[sc.band[c]];
      const net = mean[c] * dust * (1 - a) - emis * TK ** 4 + Dband * (bm - T) + Dglob * (glob - bm);
      const d = 4 * emis * TK ** 3 + Dband;
      s.tPot[c] = Math.max(-270, T + (0.8 * net) / d);
    }
  }
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
    if (!airy) { f.humidity[c] = 0; f.moisture[c] = 0; continue; }
    const lat = g.lat[c];
    const hadley = 0.5 + 0.35 * Math.cos(6 * lat);
    const coastal = Math.exp(-dist[c] / 10);
    const bias = st.moistureBias ?? 1;
    const m = (0.15 + 0.35 * hadley + 0.45 * coastal + 0.15 * p.noise.fbm(pos[c * 3] * 3 - 4, pos[c * 3 + 1] * 3, pos[c * 3 + 2] * 3 + 2, 3)) * bias;
    f.moisture[c] = s.ocean[c] ? 1 : Math.max(0.02, Math.min(1, m));
    f.humidity[c] = Math.min(1, 0.45 + 0.4 * coastal);
    f.aquifer[c] = s.ocean[c] ? 0 : f.moisture[c] * (1 + 2 * Math.min(1, f.soil[c]));
    if (!s.ocean[c] && t < freeze - 2 && f.water[c] < 0.05) {
      f.snow[c] = Math.min(2.2, (freeze - 2 - t) * 0.08);
      p.updSurface(c);
    }
    if (f.water[c] > 0.02 && t < freeze - 1) s.seaIce[c] = Math.min(Math.min(3, f.water[c]), (freeze - 1 - t) * 0.12);
  }
  // one day of hourly steps so the sky, winds and day-night state are alive at tick 0
  const steps = Math.max(12, Math.round(st.dayHours));
  for (let k = steps; k >= 1; k--) climateStep(u, p, -k * CLIMATE_CADENCE);
  p.updAllSurface();
}
