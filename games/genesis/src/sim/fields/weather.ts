// GENESIS — weather systems (CONTRACT.md §7.3): entities { kind, pos, vel, radius, intensity, life, pinned } with kinds
// from weather.json. Every WEATHER_CADENCE ticks they drift with the prevailing wind, age (ramping up, then dying away),
// spawn from local conditions (warm + humid → storms, cold + humid → snow, dry + windy + sand → sandstorms, lava →
// ashfall, strong fields near the poles → aurora storms), and paint an OVERLAY onto the cells under them: precipitation
// and its type, cloud, temperature, swirling / gusting wind, deposits (snow, ash, sand) and effects (acid, smothering
// ash, drying heat, crushing hail). Thunderstorms throw lightning: an event the renderer draws, and a fire if it lands
// in dry fuel.
//
// The player paints systems onto regions (optionally pinned: no drift, no decay), sets one planet-wide (globalWeather:
// the climate pass applies it everywhere) and clears regions or everything.

import type { WeatherView } from '../types.ts';
import type { Universe } from '../world/universe.ts';
import type { Planet, WeatherSystem } from '../world/planet.ts';
import type { WeatherDef } from '../content.ts';
import { PRECIP_TYPES } from '../content.ts';
import { composeSky, markRainDirty } from './climate.ts';
import { igniteCell } from './fire.ts';
import { hashFloat } from '../core/rng.ts';
import { capCells } from '../perf/cap.ts';
import { lapseLevel } from '../perf/lapse.ts';

export const WEATHER_CADENCE = 10;
/** the overlay is redrawn every this many weather steps, per time-lapse level */
const OVERLAY_EVERY = [2, 2, 4] as const;
/** stylised drift: metres per tick per (m/s) of wind (a storm crosses a 3 km world in about two days) */
const DRIFT = 0.6;
const MAX_NATURAL = 9;

function envelope(w: WeatherSystem): number {
  if (w.pinned || w.life < 0) return 1;
  const t = w.maxLife > 0 ? w.age / w.maxLife : 0;
  if (t < 0.15) return 0.25 + 0.75 * (t / 0.15);
  if (t > 0.75) return Math.max(0, (1 - t) / 0.25);
  return 1;
}

/** effective intensity right now */
export function systemIntensity(w: WeatherSystem): number {
  return w.intensity * envelope(w);
}

function precipCode(def: WeatherDef): number {
  return Math.max(0, PRECIP_TYPES.indexOf(def.precipType));
}

/** Create a weather system. Returns it. */
export function paintWeather(
  u: Universe, p: Planet, kind: string, pos: ArrayLike<number>, radiusM: number, duration: number, intensity: number, pinned: boolean,
): WeatherSystem | null {
  const k = u.content.weather.idx(kind);
  if (k < 0) return null;
  const l = Math.sqrt(pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]) || 1;
  const w: WeatherSystem = {
    id: u.ids.alloc('weather'),
    kind: k,
    pos: [pos[0] / l, pos[1] / l, pos[2] / l],
    vel: [0, 0, 0],
    radius: radiusM,
    intensity: Math.max(0, Math.min(3, intensity)),
    life: duration > 0 ? Math.round(duration) : -1,
    age: 0,
    maxLife: duration > 0 ? Math.round(duration) : -1,
    pinned,
  };
  p.weather.push(w);
  u.emit({ t: 'weather.start', planet: p.id, pos: [...w.pos], a: w.intensity, text: u.content.weather.list[k].name, data: { id: w.id, kind } });
  return w;
}

/**
 * Planet-wide weather override (null clears). The hourly climate pass bakes the override into the climate sky
 * (cPrecip floor, cCloud lift); swapping it here re-bakes those two at once, so "clear the skies everywhere" stops the
 * rain now rather than up to an hour later. Humidity and temperature deltas follow at the next climate pass.
 */
export function setGlobalWeather(u: Universe, p: Planet, kind: string | null): boolean {
  if (kind !== null && !u.content.weather.has(kind)) return false;
  const before = p.st.globalWeather;
  p.st.globalWeather = kind;
  if (before === kind || !p.airy) return true;
  const s = p.s;
  const oldDef = before != null ? u.content.weather.find(before) : undefined;
  const newDef = kind != null ? u.content.weather.find(kind) : undefined;
  const oldFloor = oldDef && oldDef.precip > 0 ? Math.fround(oldDef.precip * 0.7) : -1;
  const dCloud = (newDef ? newDef.cloud * 0.8 : 0) - (oldDef ? oldDef.cloud * 0.8 : 0);
  const newFloor = newDef && newDef.precip > 0 ? newDef.precip * 0.7 : 0;
  for (let c = 0; c < p.count; c++) {
    let pr = s.cPrecip[c];
    if (pr === oldFloor) pr = 0; // the rain was the old override's floor, not the climate's own
    if (pr < newFloor) pr = newFloor;
    s.cPrecip[c] = pr;
    const cl = s.cCloud[c] + dCloud;
    s.cCloud[c] = cl < 0 ? 0 : cl > 1 ? 1 : cl;
    composeSky(p, c);
  }
  markRainDirty(p);
  p.bump('precip'); p.bump('precipType'); p.bump('cloud');
  return true;
}

/** remove systems whose centre lies within the disc (or all when pos is null); returns how many */
export function clearWeather(u: Universe, p: Planet, pos: ArrayLike<number> | null, radiusM: number): number {
  const before = p.weather.length;
  if (!pos) p.weather.length = 0;
  else {
    const cosA = Math.cos(Math.min(Math.PI, radiusM / p.st.radius));
    p.weather = p.weather.filter((w) => w.pos[0] * pos[0] + w.pos[1] * pos[1] + w.pos[2] * pos[2] < cosA);
  }
  const n = before - p.weather.length;
  if (n) refreshOverlay(u, p);
  return n;
}

/** One weather step: drift, age, spawn, overlay, deposits, lightning. `dt` = ticks since the last step (the cadence;
 * longer in time-lapse, perf/lapse.ts: everything below scales with it). */
export function weatherStep(u: Universe, p: Planet, dt = WEATHER_CADENCE): void {
  const content = u.content;
  const R = p.st.radius;
  const s = p.s;
  // 1. drift + age
  for (const w of p.weather) {
    const def = content.weather.list[w.kind];
    if (!w.pinned) {
      const c = p.cellAt(w.pos);
      const sp = DRIFT * def.speed / R; // unit-vector delta per tick per m/s
      w.vel[0] = s.baseWindX[c] * sp;
      w.vel[1] = s.baseWindY[c] * sp;
      w.vel[2] = s.baseWindZ[c] * sp;
      let x = w.pos[0] + w.vel[0] * dt;
      let y = w.pos[1] + w.vel[1] * dt;
      let z = w.pos[2] + w.vel[2] * dt;
      const l = Math.sqrt(x * x + y * y + z * z) || 1;
      x /= l; y /= l; z /= l;
      w.pos[0] = x; w.pos[1] = y; w.pos[2] = z;
    } else {
      w.vel[0] = 0; w.vel[1] = 0; w.vel[2] = 0;
    }
    w.age += dt;
    if (w.life > 0 && !w.pinned) w.life = Math.max(0, w.life - dt);
  }
  const ended = p.weather.filter((w) => w.life === 0);
  if (ended.length) {
    for (const w of ended) u.emit({ t: 'weather.end', planet: p.id, pos: [...w.pos], data: { id: w.id, kind: content.weather.list[w.kind].id } });
    p.weather = p.weather.filter((w) => !ended.includes(w));
  }
  // airless worlds have no weather at all
  const before = p.weather.length;
  if (!p.airy) {
    if (p.weather.length) p.weather.length = 0;
  } else spawn(u, p, dt);
  // systems drift about one cell per step: the overlay is rebuilt every other step (every 4th at 1000x, where a step is
  // 30 ticks: perf/lapse.ts), or at once when systems appear or end
  const even = Math.floor(u.tick / dt) % OVERLAY_EVERY[lapseLevel(u)] === 0;
  if (even || ended.length || p.weather.length !== before || p.weather.some((w) => w.age <= dt)) refreshOverlay(u, p);
  applyEffects(u, p, dt);
  lightning(u, p, dt);
}

/** natural spawning from local conditions */
function spawn(u: Universe, p: Planet, dt: number): void {
  const rate = p.cfg.weatherSpawn;
  if (rate <= 0) return;
  let natural = 0;
  for (const w of p.weather) if (!w.pinned && w.maxLife > 0) natural++;
  const cap = MAX_NATURAL + Math.floor(p.count / 12000);
  if (natural >= cap) return;
  const rng = p.rng.weather;
  const f = p.f, s = p.s, st = p.st;
  const list = u.content.weather.list;
  for (let tries = 0; tries < 3; tries++) {
    const c = rng.int(0, p.count - 1);
    const k = rng.int(0, list.length - 1);
    const def = list[k];
    const sp = def.spawn;
    if (!sp) continue;
    if (sp.needsAir && !p.airy) continue;
    const T = f.temperature[c], q = f.humidity[c];
    if (sp.humidity && (q < sp.humidity[0] || q > sp.humidity[1])) continue;
    if (sp.temp && (T < sp.temp[0] || T > sp.temp[1])) continue;
    if (sp.latitude) {
      const la = Math.abs(p.grid.lat[c]) * 180 / Math.PI;
      if (la < sp.latitude[0] || la > sp.latitude[1]) continue;
    }
    if (sp.ocean !== undefined && !!s.ocean[c] !== sp.ocean) continue;
    if (sp.sand !== undefined && f.sand[c] < sp.sand) continue;
    if (sp.lava !== undefined && !(f.lava[c] > 0.01 || p.vents.length > 0)) continue;
    if (sp.toxicity !== undefined && st.atmosphere.toxicity < sp.toxicity) continue;
    if (sp.magnetism !== undefined && st.magnetism < sp.magnetism) continue;
    if (sp.calm && Math.sqrt(f.windX[c] * f.windX[c] + f.windY[c] * f.windY[c] + f.windZ[c] * f.windZ[c]) > 3) continue;
    if (!rng.chance(sp.rate * 0.35 * rate * (dt / WEATHER_CADENCE))) continue;
    // ashfall rises from the vents, not from a random cell
    let cell = c;
    if (sp.lava !== undefined && p.vents.length) cell = p.vents[rng.int(0, p.vents.length - 1)].cell;
    const P = p.grid.pos;
    const radius = def.radius[0] + (def.radius[1] - def.radius[0]) * rng.float();
    const life = Math.round(def.life[0] + (def.life[1] - def.life[0]) * rng.float());
    const w = paintWeather(u, p, def.id, [P[cell * 3], P[cell * 3 + 1], P[cell * 3 + 2]], radius * (p.st.radius / 3000), life, 0.6 + 0.4 * rng.float(), false);
    if (w) natural++;
    if (natural >= cap) return;
  }
}

/** per-planet cap buffer (a cache; never saved) */
const capBuf = new WeakMap<Planet, Int32Array>();
function capOut(p: Planet): Int32Array {
  let b = capBuf.get(p);
  if (!b) { b = new Int32Array(p.count); capBuf.set(p, b); }
  return b;
}

/** rebuild the per-cell overlay from the live systems and re-compose sky + wind on every touched cell */
export function refreshOverlay(u: Universe, p: Planet): void {
  const f = p.f, s = p.s, g = p.grid;
  const R = p.st.radius;
  const P = g.pos;
  const content = u.content;
  const wMask = s.wMask, wPrecip = s.wPrecip, wType = s.wType, wCloud = s.wCloud, wTemp = s.wTemp;
  const windX = f.windX, windY = f.windY, windZ = f.windZ, bx = s.baseWindX, by = s.baseWindY, bz = s.baseWindZ;
  // reset cells covered last time (precip / cloud / wind return to the climate values). The covered cells are kept
  // as a list (a cache: rebuilt by one scan after a load; per-cell resets do not depend on order).
  const touched = p.scratch.list2;
  let nt = 0;
  const prev = maskList(p);
  const prevList = prev.list;
  for (let i = 0; i < prev.n; i++) {
    const c = prevList[i];
    if (!wMask[c]) continue;
    wMask[c] = 0;
    wPrecip[c] = 0;
    wType[c] = 0;
    wCloud[c] = 0;
    wTemp[c] = 0;
    windX[c] = bx[c];
    windY[c] = by[c];
    windZ[c] = bz[c];
    touched[nt++] = c;
  }
  const cells = capOut(p);
  for (const w of p.weather) {
    const def = content.weather.list[w.kind];
    const I = systemIntensity(w);
    if (I <= 0) continue;
    const ang = w.radius / R;
    const nc = capCells(g, w.pos[0], w.pos[1], w.pos[2], ang * 1.15, cells);
    const code = precipCode(def);
    const wx0 = w.pos[0], wy0 = w.pos[1], wz0 = w.pos[2];
    const vx = w.vel[0], vy = w.vel[1], vz = w.vel[2];
    const sgn = wy0 >= 0 ? 1 : -1;
    const gustDirLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
    const hasEye = !!def.render.eye;
    const dPrecip = def.precip, dCloud = def.cloud, dTemp = def.tempDelta, dWind = def.wind, dSpin = def.spin;
    // chord length ≈ angle at these sizes (and monotonic): no acos per cell
    const chordScale = 1 / (2 * Math.sin(ang / 2));
    for (let i = 0; i < nc; i++) {
      const c = cells[i];
      const px = P[c * 3], py = P[c * 3 + 1], pz = P[c * 3 + 2];
      const dx = px - wx0, dy = py - wy0, dz = pz - wz0;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) * chordScale;
      if (d > 1.15) continue;
      let k = d < 0.6 ? 1 : Math.max(0, 1 - (d - 0.6) / 0.55);
      k *= k * (3 - 2 * k);
      // hurricane eye: calm, clear centre
      const eye = hasEye ? Math.min(1, d / 0.12) : 1;
      const kI = k * I;
      if (!wMask[c]) { wMask[c] = 1; touched[nt++] = c; }
      const pr = dPrecip * kI * eye;
      if (pr > wPrecip[c]) { wPrecip[c] = pr; wType[c] = code; }
      wCloud[c] += dCloud * kI * (dCloud > 0 ? eye : 1);
      wTemp[c] += dTemp * kI;
      // wind: cyclonic swirl (counter-clockwise in the north) + gust along the drift, or calming (negative wind)
      if (dWind >= 0) {
        let tx = wy0 * pz - wz0 * py;
        let ty = wz0 * px - wx0 * pz;
        let tz = wx0 * py - wy0 * px;
        const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
        const swirl = dWind * dSpin * kI * Math.min(1, d * 3) * eye * sgn;
        if (tl > 1e-9) { tx /= tl; ty /= tl; tz /= tl; windX[c] += tx * swirl; windY[c] += ty * swirl; windZ[c] += tz * swirl; }
        if (gustDirLen > 1e-12) {
          const gust = dWind * (1 - dSpin) * kI / gustDirLen;
          windX[c] += vx * gust; windY[c] += vy * gust; windZ[c] += vz * gust;
        }
      } else {
        const damp = Math.max(0, 1 + (dWind / 10) * kI);
        windX[c] *= damp; windY[c] *= damp; windZ[c] *= damp;
      }
    }
  }
  // temperature deltas are folded in by the hourly climate pass
  const nm = composeTouched(touched, nt, p.st.liquid.freeze, s.cPrecip, s.cCloud, f.temperature, wMask, wPrecip, wType, wCloud, f.precip, f.precipType, f.cloud, prevList);
  prev.n = nm;
  if (nt) {
    markRainDirty(p);
    p.bump('precip'); p.bump('precipType'); p.bump('cloud'); p.bump('windX'); p.bump('windY'); p.bump('windZ');
  }
}

/** composeSky (climate.ts) over the touched cells; the still-covered ones become the next reset list. Returns their
 * count. */
function composeTouched(
  touched: Int32Array, nt: number, freeze: number, cPrecip: Float32Array, cCloud: Float32Array, temperature: Float32Array,
  wMask: Uint8Array, wPrecip: Float32Array, wType: Uint8Array, wCloud: Float32Array, precip: Float32Array,
  precipType: Float32Array, cloud: Float32Array, next: Int32Array,
): number {
  const snowBelow = freeze + 0.5;
  let nm = 0;
  for (let i = 0; i < nt; i++) {
    const c = touched[i];
    let pr = cPrecip[c];
    const t = temperature[c];
    let ty = pr > 0 ? (t < snowBelow ? 2 : 1) : 0;
    let cl = cCloud[c];
    if (wMask[c]) {
      const wp = wPrecip[c];
      if (wp > pr || (wType[c] > 0 && wp > 0)) {
        pr = Math.max(pr, wp);
        ty = wType[c];
        // a rain system in freezing air falls as snow
        if (ty === 1 && t < freeze) ty = 2;
      }
      cl = Math.min(1, Math.max(0, cl + wCloud[c]));
      next[nm++] = c;
    }
    precip[c] = pr;
    precipType[c] = pr > 0 ? ty : 0;
    cloud[c] = cl;
  }
  return nm;
}

interface MaskList { list: Int32Array; n: number }
const maskCache = new WeakMap<Planet, MaskList>();
function maskList(p: Planet): MaskList {
  let m = maskCache.get(p);
  if (!m) {
    m = { list: new Int32Array(p.count), n: 0 };
    for (let c = 0; c < p.count; c++) if (p.s.wMask[c]) m.list[m.n++] = c;
    maskCache.set(p, m);
  }
  return m;
}

/** deposits (snow / ash / sand) and effects (acid, smother, dry, crush) under the systems */
function applyEffects(u: Universe, p: Planet, dt: number): void {
  const f = p.f, s = p.s;
  const dtH = dt / 60;
  const content = u.content;
  let surf = false, veg = false;
  if (!p.weather.length) return;
  for (const w of p.weather) {
    const def = content.weather.list[w.kind];
    if (!def.deposit && !def.effects) continue;
    const I = systemIntensity(w);
    const ang = w.radius / p.st.radius;
    const cells = capOut(p);
    const nc = capCells(p.grid, w.pos[0], w.pos[1], w.pos[2], ang, cells);
    const P = p.grid.pos;
    for (let i = 0; i < nc; i++) {
      const c = cells[i];
      const d = Math.acos(Math.min(1, P[c * 3] * w.pos[0] + P[c * 3 + 1] * w.pos[1] + P[c * 3 + 2] * w.pos[2])) / ang;
      const k = Math.max(0, 1 - d * d) * I * dtH;
      if (k <= 0) continue;
      const wet = s.ocean[c] && f.water[c] > 0.5;
      if (def.deposit) {
        if (def.deposit.snow && !wet && f.temperature[c] < p.st.liquid.freeze + 1) { f.snow[c] += def.deposit.snow * k; surf = true; p.updSurface(c); }
        if (def.deposit.ash && !wet) { f.ash[c] += def.deposit.ash * k; surf = true; p.updSurface(c); }
        if (def.deposit.sand && !wet) { f.sand[c] += def.deposit.sand * k; f.road[c] *= 0.98; surf = true; p.updSurface(c); }
      }
      if (def.effects) {
        const e = def.effects;
        if (e.acid) { const m = 1 - e.acid * k; f.grass[c] *= m; f.shrub[c] *= m; f.tree[c] *= 1 - e.acid * k * 0.5; f.crop[c] *= m; f.pollution[c] = Math.min(1, f.pollution[c] + e.acid * k); veg = true; }
        if (e.smother) { const m = 1 - e.smother * k; f.grass[c] *= m; f.crop[c] *= m; f.shrub[c] *= 1 - e.smother * k * 0.5; veg = true; }
        if (e.dry) { f.moisture[c] = Math.max(0, f.moisture[c] - e.dry * k); }
        if (e.crush) { f.crop[c] *= 1 - e.crush * k * 3; f.grass[c] *= 1 - e.crush * k; veg = true; }
      }
    }
  }
  if (surf) { p.bump('surface'); p.bump('snow'); p.bump('ash'); p.bump('sand'); }
  if (veg) { p.bump('grass'); p.bump('shrub'); p.bump('tree'); p.bump('crop'); }
}

/** called for every strike (peoples: accidents of lightning in a dune, fire taken from a lightning fire) */
export const strikeHooks: ((u: Universe, p: Planet, cell: number, ignited: boolean) => void)[] = [];

/** lightning strikes from stormy systems (and a planet-wide stormy override): events + fires in dry fuel */
function lightning(u: Universe, p: Planet, dt: number): void {
  const rng = p.rng.weather;
  const content = u.content;
  const P = p.grid.pos;
  const strike = (cx: number, cy: number, cz: number, intensity: number) => {
    const c = p.grid.nearestCell(cx, cy, cz);
    u.emit({ t: 'lightning', planet: p.id, pos: [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], a: intensity, data: { cell: c } });
    // dry fuel catches
    const f = p.f;
    const fuel = f.grass[c] * 0.3 + f.shrub[c] * 0.6 + f.tree[c] + f.crop[c] * 0.4;
    const dry = 1 - Math.min(1, f.moisture[c] * 1.3 + f.wetness[c] * 0.6 + (f.precip[c] > 0 ? 0.5 : 0));
    let ignited = false;
    if (fuel > 0.1 && dry > 0.15 && hashFloat(c, u.tick, 0x11e7) < 0.35 * dry * Math.min(1, fuel)) ignited = igniteCell(u, p, c, 0.5 + 0.4 * intensity, 'lightning');
    for (const h of strikeHooks) h(u, p, c, ignited);
  };
  for (const w of p.weather) {
    const def = content.weather.list[w.kind];
    if (def.lightning <= 0) continue;
    const I = systemIntensity(w);
    const expected = def.lightning * I * (dt / 60);
    let n = Math.floor(expected);
    if (rng.chance(expected - n)) n++;
    for (let i = 0; i < n; i++) {
      // a random point in the disc (uniform by area)
      const r = Math.sqrt(rng.float()) * (w.radius / p.st.radius) * 0.9;
      const th = rng.float() * Math.PI * 2;
      let ex = w.pos[2], ez = -w.pos[0];
      let el = Math.hypot(ex, ez);
      if (el < 1e-9) { ex = 1; ez = 0; el = 1; }
      ex /= el; ez /= el;
      const nx = w.pos[1] * ez, ny = w.pos[2] * ex - w.pos[0] * ez, nz = -w.pos[1] * ex;
      const cs = Math.cos(r), sn = Math.sin(r);
      const dx = Math.cos(th) * ex + Math.sin(th) * nx, dy = Math.sin(th) * ny, dz = Math.cos(th) * ez + Math.sin(th) * nz;
      strike(w.pos[0] * cs + dx * sn, w.pos[1] * cs + dy * sn, w.pos[2] * cs + dz * sn, I);
    }
  }
  const gk = p.st.globalWeather ? content.weather.find(p.st.globalWeather) : undefined;
  if (gk && gk.lightning > 0 && p.airy) {
    const expected = gk.lightning * 0.6 * (dt / 60);
    let n = Math.floor(expected);
    if (rng.chance(expected - n)) n++;
    for (let i = 0; i < n; i++) {
      const c = rng.int(0, p.count - 1);
      strike(P[c * 3], P[c * 3 + 1], P[c * 3 + 2], 0.8);
    }
  }
}

/** snapshot views */
export function weatherViews(u: Universe, p: Planet): WeatherView[] {
  return p.weather.map((w) => ({
    id: w.id,
    kind: u.content.weather.list[w.kind].id,
    planet: p.id,
    pos: [w.pos[0], w.pos[1], w.pos[2]],
    radius: w.radius,
    intensity: systemIntensity(w),
    pinned: w.pinned,
    vel: [w.vel[0], w.vel[1], w.vel[2]],
  }));
}
