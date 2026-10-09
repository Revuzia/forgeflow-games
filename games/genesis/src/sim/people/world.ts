// GENESIS — how a people reads the world: daylight and sleep times from the planet's own sun, walking speed over
// terrain / water / roads / weather, places around a cell, and small geometry helpers (offset points inside a cell,
// great-circle distances in metres). Pure functions of the planet state at the asked tick.

import type { Universe } from '../world/universe.ts';
import type { Planet } from '../world/planet.ts';
import { hashFloat } from '../core/rng.ts';
import { BASE_WALK, dayTicks } from './defs.ts';

/** unit vector of a cell centre */
export function cellPos(p: Planet, c: number, out: number[] = [0, 0, 0]): number[] {
  const P = p.grid.pos;
  out[0] = P[c * 3]; out[1] = P[c * 3 + 1]; out[2] = P[c * 3 + 2];
  return out;
}

/** metres between two unit vectors on planet p */
export function distM(p: Planet, a: ArrayLike<number>, b: ArrayLike<number>): number {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return Math.acos(d > 1 ? 1 : d < -1 ? -1 : d) * p.st.radius;
}

/** a point `metres` from unit vector `c` at bearing `ang` (rad, from local east), normalised, into out */
export function offsetPoint(c: ArrayLike<number>, metres: number, ang: number, radius: number, out: number[] = [0, 0, 0]): number[] {
  let ex = c[2], ez = -c[0];
  let el = Math.hypot(ex, ez);
  if (el < 1e-9) { ex = 1; ez = 0; el = 1; }
  ex /= el; ez /= el;
  // north = c × east
  const nx = c[1] * ez, ny = c[2] * ex - c[0] * ez, nz = -c[1] * ex;
  const a = metres / radius;
  const dx = Math.cos(ang) * ex + Math.sin(ang) * nx;
  const dy = Math.sin(ang) * ny;
  const dz = Math.cos(ang) * ez + Math.sin(ang) * nz;
  const cs = Math.cos(a), sn = Math.sin(a);
  let x = c[0] * cs + dx * sn, y = c[1] * cs + dy * sn, z = c[2] * cs + dz * sn;
  const l = Math.hypot(x, y, z) || 1;
  x /= l; y /= l; z /= l;
  out[0] = x; out[1] = y; out[2] = z;
  return out;
}

/** a deterministic spot inside cell c for agent `id` (so a crowd does not stand on one point) */
export function spotInCell(p: Planet, c: number, id: number, salt: number, out: number[] = [0, 0, 0]): number[] {
  const P = p.grid.pos;
  const ctr = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]];
  const r = 3 + 16 * Math.sqrt(hashFloat(id, c, salt, 0x5907));
  const a = hashFloat(c, id, salt, 0xa16) * Math.PI * 2;
  return offsetPoint(ctr, r, a, p.st.radius, out);
}

const _sun = { dir: [0, 1, 0] as [number, number, number], lon: 0, rate: 0 };

/**
 * The planet's sun at tick, as the people feel it, plus its body-frame longitude rate per tick. The true sun is sampled
 * at the canonical ticks that bound the hour (its start and end) and a tick between them interpolates (normalised
 * lerp: under a thousandth of a radian off on a day of 24 hours) — a pure function of the tick, so a loaded game gets
 * the very same light, and the orbital solve runs twice an hour instead of every tick.
 */
export function sunAt(u: Universe, p: Planet, tick: number): { dir: [number, number, number]; lon: number; rate: number } {
  const ps = p.people;
  if (ps.sunTick !== tick) {
    const hour = Math.floor(tick / 60);
    if (hour !== ps.sunRateHour) {
      const a = u.sun(p, hour * 60).dir;
      ps.sunA[0] = a[0]; ps.sunA[1] = a[1]; ps.sunA[2] = a[2];
      const b = u.sun(p, hour * 60 + 60).dir;
      ps.sunB[0] = b[0]; ps.sunB[1] = b[1]; ps.sunB[2] = b[2];
      let d = Math.atan2(b[0], b[2]) - Math.atan2(ps.sunA[0], ps.sunA[2]);
      d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
      ps.sunRate = d / 60;
      ps.sunRateHour = hour;
    }
    let x: number, y: number, z: number;
    if (Math.abs(ps.sunRate) * 60 > 1.2) {
      // a world spinning faster than ~70 degrees an hour: no interpolation, the true sun
      const d = u.sun(p, tick).dir;
      x = d[0]; y = d[1]; z = d[2];
    } else {
      const f = (tick - hour * 60) / 60;
      const A = ps.sunA, B = ps.sunB;
      x = A[0] + (B[0] - A[0]) * f; y = A[1] + (B[1] - A[1]) * f; z = A[2] + (B[2] - A[2]) * f;
      const l = Math.hypot(x, y, z);
      if (l > 1e-9) { x /= l; y /= l; z /= l; } else { x = A[0]; y = A[1]; z = A[2]; }
    }
    ps.sunDir[0] = x; ps.sunDir[1] = y; ps.sunDir[2] = z;
    ps.sunLon = Math.atan2(x, z);
    ps.sunTick = tick;
  }
  _sun.dir = ps.sunDir; _sun.lon = ps.sunLon; _sun.rate = ps.sunRate;
  return _sun;
}

/** sine of the sun's elevation at unit vector pos */
export function sunElevation(u: Universe, p: Planet, tick: number, pos: ArrayLike<number>): number {
  const s = sunAt(u, p, tick).dir;
  return s[0] * pos[0] + s[1] * pos[1] + s[2] * pos[2];
}

/**
 * Ticks until the sun next rises (want = 'rise') or sets ('set') at pos. Analytic from the sun's declination and its
 * longitude drift; a frozen sun or a polar day / night returns `fallback` (people then keep an 8-hour rhythm).
 */
export function ticksUntilSun(u: Universe, p: Planet, tick: number, pos: ArrayLike<number>, want: 'rise' | 'set', fallback: number): number {
  const s = sunAt(u, p, tick);
  const rate = s.rate;
  if (Math.abs(rate) < 1e-7) return fallback;
  const sinD = Math.max(-1, Math.min(1, s.dir[1]));
  const cosD = Math.sqrt(1 - sinD * sinD);
  const sinL = Math.max(-1, Math.min(1, pos[1]));
  const cosL = Math.sqrt(1 - sinL * sinL);
  if (cosL < 1e-6 || cosD < 1e-6) return fallback;
  const cosH0 = -(sinL * sinD) / (cosL * cosD);
  if (cosH0 >= 1 || cosH0 <= -1) return fallback; // polar night / day
  const H0 = Math.acos(cosH0);
  const lonP = Math.atan2(pos[0], pos[2]);
  // hour angle H = lonP − lonSun grows at −rate per tick; sunrise at H = −H0, sunset at H = +H0
  const H = wrap(lonP - s.lon);
  const target = want === 'rise' ? -H0 : H0;
  const dH = -rate; // rad per tick the hour angle advances
  let delta = wrap(target - H);
  if (dH > 0) { if (delta <= 0) delta += 2 * Math.PI; }
  else { if (delta >= 0) delta -= 2 * Math.PI; }
  const t = delta / dH;
  const day = dayTicks(p.st.dayHours);
  return Math.max(10, Math.min(day * 2, Math.round(t)));
}

function wrap(a: number): number {
  a %= 2 * Math.PI;
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** air temperature (°C) a body feels at cell c (weather overlay included) */
export function airTemp(p: Planet, c: number): number {
  return p.f.temperature[c];
}

/**
 * Walking cost multiplier entering cell `to` from `from` (1 = flat dry ground; Infinity = impassable):
 * slope, water depth (wading / swimming), snow, sand, roads.
 */
export function stepFactor(p: Planet, from: number, to: number, swim: number, fly: boolean): number {
  const f = p.f;
  if (fly) return 1 / (1 + f.road[to] * 0.2);
  const w = f.water[to];
  let k = 1;
  if (w > 0.6) {
    if (swim <= 0) return Infinity;
    k = 1 / Math.max(0.05, swim) * (w > 3 ? 1.4 : 1);
  } else if (w > 0.12) k = 1.8;
  const rise = f.surface[to] - f.surface[from];
  const grade = Math.abs(rise) / p.edgeM;
  if (grade > 0.9) return Infinity;
  k *= 1 + grade * (rise > 0 ? 3.2 : 1.6);
  if (f.snow[to] > 0.15) k *= 1.4;
  if (f.sand[to] > 0.6) k *= 1.2;
  if (f.lava[to] > 0.01 || f.fire[to] > 0.3) k *= 6;
  k /= 1 + f.road[to] * 0.9;
  return k;
}

/** metres per tick for an agent of given species speed / age factor on this planet now (weather, gravity) */
/** a well draws water while the ground beneath it holds some (a drought that empties the aquifer dries it) */
export function wellFlows(p: Planet, c: number): boolean {
  return p.f.aquifer[c] > 0.02 || p.f.moisture[c] > 0.3;
}

export function walkSpeed(p: Planet, c: number, speed: number, ageF: number): number {
  const f = p.f;
  let v = BASE_WALK * speed * ageF;
  if (f.precip[c] > 2) v *= 0.85;
  if (f.snow[c] > 0.3) v *= 0.8;
  const g = p.st.gravity;
  if (g > 14) v *= Math.max(0.3, 14 / g);
  return v;
}

/** fresh water to drink at cell c (lake, river, rain pool) */
export function freshWater(p: Planet, c: number): boolean {
  const f = p.f;
  return f.water[c] > 0.04 && f.salinity[c] < 0.35 && !p.s.ocean[c] && f.temperature[c] > p.st.liquid.freeze - 2;
}

/**
 * Water a person can drink at cell c: fresh surface water, or — below the grid's 50 m resolution — the creeks, seeps
 * and pools of wet ground over a full aquifer, rain pools, and the rain itself. Deserts have none of these.
 */
export function drinkable(p: Planet, c: number): boolean {
  if (freshWater(p, c)) return true;
  const f = p.f;
  if (p.s.ocean[c] || f.water[c] > 0.6 || f.salinity[c] > 0.35) return false;
  if (f.temperature[c] < p.st.liquid.freeze - 2) return false;
  if (f.moisture[c] > 0.55 || (f.moisture[c] > 0.42 && f.aquifer[c] > 0.3)) return true;
  if (f.wetness[c] > 0.6) return true;
  return f.precip[c] > 1 && f.precipType[c] === 1;
}

/** snow or ice to melt: water for peoples of the cold (they melt it by the mouthful, or over a fire) */
export function snowWater(p: Planet, c: number): boolean {
  const f = p.f;
  return f.snow[c] > 0.1 || f.ice[c] > 0.1 || (p.s.seaIce[c] > 0.05 && f.salinity[c] < 0.5);
}

/** the cell is walkable land (not under water deeper than wading) */
export function isLand(p: Planet, c: number): boolean {
  return p.f.water[c] < 0.6 && !p.s.ocean[c];
}

const _heapC: number[] = [];
const _heapH: number[] = [];
const _seen = new Map<number, number>();

/**
 * How deep cell c lies in a closed hollow (m): the water level a basin around it would fill to before it spills, less
 * its ground. Grown outward from c lowest-rim-first (a priority flood from one cell) until the water would run out
 * downhill or `maxCells` are in the basin (a big lake bed: the level reached so far). 0 on a slope or a rise. A people
 * settled at the bottom of such a hollow drowned when springs and rain filled it (fix pass).
 */
export function hollowDepth(p: Planet, c: number, maxCells = 160): number {
  const f = p.f, g = p.grid;
  const surf = f.surface;
  _heapC.length = 0; _heapH.length = 0; _seen.clear();
  const push = (o: number) => {
    if (_seen.has(o)) return;
    _seen.set(o, 1);
    const h = surf[o] + (p.s.ocean[o] ? -1e6 : 0);
    let i = _heapC.length;
    _heapC.push(o); _heapH.push(h);
    while (i > 0) {
      const pa = (i - 1) >> 1;
      if (_heapH[pa] < h || (_heapH[pa] === h && _heapC[pa] < o)) break;
      _heapC[i] = _heapC[pa]; _heapH[i] = _heapH[pa];
      i = pa;
    }
    _heapC[i] = o; _heapH[i] = h;
  };
  const pop = (): number => {
    const top = _heapC[0];
    const lc = _heapC.pop()!, lh = _heapH.pop()!;
    const n = _heapC.length;
    if (n) {
      let i = 0;
      for (;;) {
        const a = 2 * i + 1, b = a + 1;
        let m = i, mh = lh, mc = lc;
        if (a < n && (_heapH[a] < mh || (_heapH[a] === mh && _heapC[a] < mc))) { m = a; mh = _heapH[a]; mc = _heapC[a]; }
        if (b < n && (_heapH[b] < mh || (_heapH[b] === mh && _heapC[b] < mc))) { m = b; mh = _heapH[b]; mc = _heapC[b]; }
        if (m === i) break;
        _heapC[i] = _heapC[m]; _heapH[i] = _heapH[m];
        i = m;
      }
      _heapC[i] = lc; _heapH[i] = lh;
    }
    return top;
  };
  push(c);
  let level = surf[c];
  let filled = 0;
  while (_heapC.length) {
    const h = _heapH[0];
    const o = pop();
    // the next lowest rim cell is below the water already raised: it spills there
    if (h < level - 1e-3) break;
    if (h > level) level = h;
    if (++filled > maxCells) break;
    for (let e = g.nbrStart[o]; e < g.nbrStart[o + 1]; e++) push(g.nbr[e]);
  }
  return Math.max(0, level - surf[c]);
}
