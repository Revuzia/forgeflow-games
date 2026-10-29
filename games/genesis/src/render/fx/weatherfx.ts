// GENESIS — the weather where the camera is (CONTRACT.md §15.7, §7.3): what falls, how thick the air is, the sky's
// colour and the storm's lightning, from the sim's fields (precip, precipType, cloud, wind) and its weather systems
// (weather.json: particles, fog, lightning, skyTint, airless) — the nearest systems weighted by distance, a planet-
// wide weather over everything.
//   precipitation  a box of particles round the camera (it wraps as the camera moves, thinning toward its edge):
//                  rain streaks (drizzle → monsoon by rate), snow tumbling and drifting, hail, grey ash flakes,
//                  driven sand, blood-red or sickly acid rain; it leans with the wind. A blizzard drives dense snow
//                  nearly level along the gale, big out-of-focus flakes sweep past the lens and a sheet of blowing snow
//                  streams along the ground
//   splashes       little crowns on whatever surface is under the rain (roofs, streets, the sea), from the depth buffer
//   fog            height fog by the weather's fog (a fog bank, a blizzard's white-out, a sandstorm, ash)
//   tints          the weather's sky tint over the sky (a blood-red sky, a sandstorm's ochre, a no-air black)
//   lightning      strikes inside thunderstorm cells near the camera, with their thunder for the audio
//   lens           rain beading and running on the lens near the ground (ScreenFx draws it)
// Up high (the camera above the cloud deck) nothing falls on the lens: precipitation fades out above ~700 m.

import { Vector3 } from 'three';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { BASE_PACK } from '../../data/index.ts';
import { SYS } from './vfx.ts';
import type { FxCtx } from './disasters.ts';
import { clamp01, smooth } from './fxcommon.ts';
import { CAMERA_NOW } from '../camera/common.ts';

interface WDef { particles: string; fog: number; lightning: number; tint: [number, number, number] | null; airless: boolean; wind: number; cloud: number }
const DEFS = new Map<string, WDef>(
  ((BASE_PACK as unknown as { weather?: { id: string; render?: { particles?: string; fog?: number; lightning?: number; skyTint?: number[] | null; airless?: boolean; wind?: number; cloud?: number } }[] }).weather ?? [])
    .map((w) => [w.id, {
      particles: w.render?.particles ?? 'none', fog: Number(w.render?.fog ?? 0), lightning: Number(w.render?.lightning ?? 0),
      tint: Array.isArray(w.render?.skyTint) ? [w.render!.skyTint![0], w.render!.skyTint![1], w.render!.skyTint![2]] as [number, number, number] : null,
      airless: !!w.render?.airless, wind: Number(w.render?.wind ?? 0), cloud: Number(w.render?.cloud ?? 0),
    }]),
);

/** what falls, by the sim's precipType: 0 none, 1 rain, 2 snow, 3 hail, 4 ash, 5 acid, 6 blood, 7 sand */
const FALL: Record<number, { sys: number; speed: number; size: number; col: [number, number, number]; splash: boolean }> = {
  1: { sys: SYS.precip, speed: 9.5, size: 0.02, col: [0.7, 0.74, 0.8], splash: true },
  2: { sys: SYS.snowfall, speed: 1.2, size: 0.06, col: [0.95, 0.96, 1.0], splash: false },
  3: { sys: SYS.snowfall, speed: 13, size: 0.03, col: [0.9, 0.92, 0.95], splash: true },
  4: { sys: SYS.snowfall, speed: 0.9, size: 0.06, col: [0.32, 0.31, 0.3], splash: false },
  5: { sys: SYS.precip, speed: 9, size: 0.012, col: [0.62, 0.78, 0.32], splash: true },
  // (blood rain thick and red: as fine as acid drizzle, lit by the day, it read as grey drizzle with a few orange flecks)
  6: { sys: SYS.precip, speed: 9, size: 0.024, col: [0.78, 0.045, 0.03], splash: true },
  7: { sys: SYS.precip, speed: 1.5, size: 0.02, col: [0.62, 0.48, 0.32], splash: false },
};

const _u = new Vector3(), _w = new Vector3(), _p = new Vector3();
/** what falls from a deck thick enough to put the sun out */
const WET = new Set(['drizzle', 'rain', 'heavy-rain', 'storm-rain', 'snow', 'blizzard', 'hail', 'blood']);

export class WeatherFx {
  private fall = 0;
  private fallPower = 0;
  /** precipitation that stopped (or changed kind) fading out: the box of drops round the eye has nowhere to fall to,
   *  so it is dimmed away over a moment instead of wrapping round the camera for the rest of its particles' lives */
  private fading: { id: number; p: number; t: number }[] = [];
  private splash = 0;
  private kind = -1;
  private next = 0;
  /** the local weather's strengths, eased */
  private fogK = 0;
  private tint = new Vector3(1, 1, 1);
  /** rain on the lens, eased */
  private lens = 0;
  local = { precip: 0, type: 0, fog: 0, lightning: 0 };
  /** the storm overhead (eased), for the cloud-shadow uniforms (GodFx: uOvercastC/K): its body-frame centre, cos of
   *  its reach, strength over its footprint, and the strength at the camera */
  readonly overcast = { k: 0, c: new Vector3(0, 1, 0), cosR: 1, cam: 0 };
  private ovWant = { k: 0, c: new Vector3(0, 1, 0), cosR: 1 };

  update(ctx: FxCtx): void {
    const pv = ctx.pv;
    const cam = ctx.camBody;
    const R = pv.params.radius;
    const u = _u.copy(cam).normalize();
    const g = groundHeight(pv.ground, u.x, u.y, u.z);
    const alt = cam.length() - g;
    // ── the fields at the camera ──
    const pf = pv.fields.get('precip'), pt = pv.fields.get('precipType');
    let precip = pf ? Math.max(0, pv.grid.sample(pf, u.x, u.y, u.z)) : 0;
    let type = pt ? Math.round(pt[pv.grid.nearestCell(u.x, u.y, u.z)]) : 0;
    // ── the weather systems near the camera (and the planet-wide one) ──
    let fog = 0, light = 0, wsum = 0, gust = 0;
    const tint = _w.set(0, 0, 0);
    let tintW = 0;
    const consider = (kind: string, w: number) => {
      const d = DEFS.get(kind);
      if (!d || w <= 0) return;
      fog = Math.max(fog, d.fog * w);
      light = Math.max(light, d.lightning * w);
      gust = Math.max(gust, d.wind * w);
      if (d.tint) { tint.x += d.tint[0] * w; tint.y += d.tint[1] * w; tint.z += d.tint[2] * w; tintW += w; }
      if (d.airless) { tint.set(0.03, 0.03, 0.04).multiplyScalar(w); tintW = w; }
      wsum += w;
      // a sandstorm or ashfall over a dry field still blows: the system says what falls
      if (precip < 0.2 && w > 0.5) {
        if (d.particles === 'sand') { precip = 6 * w; type = 7; }
        if (d.particles === 'ash') { precip = 3 * w; type = 4; }
      }
    };
    // the wet system the camera is under (rain, snow, hail, a thunderstorm): its deck puts the sun out over its footprint
    const ow = this.ovWant;
    ow.k = 0;
    const wetness = (d: WDef | undefined): number => !d || d.airless ? 0
      : smooth(0.7, 1, d.cloud) * (WET.has(d.particles) ? 0.75 + 0.25 * Math.min(1, d.lightning * 2) : 0.45);
    for (const ws of pv.weather) {
      const d = Math.acos(Math.max(-1, Math.min(1, u.x * ws.pos[0] + u.y * ws.pos[1] + u.z * ws.pos[2]))) * R;
      const w = ws.intensity * (1 - smooth(ws.radius * 0.6, ws.radius * 1.15, d));
      consider(ws.kind, w);
      // (the deck darkens ahead of the rain: a storm the god has just painted starts at a quarter of its strength, and the
      // town under its first rain kept crisp sun shadows for a minute — clouds gather before they pour)
      const ok = Math.min(1, Math.pow(ws.intensity * 0.8, 0.6)) * wetness(DEFS.get(ws.kind)) * (w > 0 ? 1 : 0);
      if (ok > ow.k) {
        const l = Math.hypot(ws.pos[0], ws.pos[1], ws.pos[2]) || 1;
        ow.k = ok; ow.c.set(ws.pos[0] / l, ws.pos[1] / l, ws.pos[2] / l); ow.cosR = Math.cos(Math.min(Math.PI, (ws.radius * 1.1) / R));
      }
    }
    if (pv.params.globalWeather) consider(pv.params.globalWeather, 1);
    void wsum;
    // fog from the cloud deck at the ground in heavy weather
    const low = 1 - smooth(500, 900, alt);
    // a planet-wide storm, or the sim's own deck thick and raining over the camera: the sky round the eye (under it only)
    {
      const cfo = pv.fields.get('cloud');
      const cc = cfo ? pv.grid.sample(cfo, u.x, u.y, u.z) : 0;
      const gk = pv.params.globalWeather ? wetness(DEFS.get(pv.params.globalWeather)) : 0;
      const fk = Math.max(gk, smooth(0.5, 0.95, cc) * (0.35 + 0.65 * smooth(0.5, 6, precip))) * low;
      if (fk > ow.k) { ow.k = fk; ow.c.copy(u); ow.cosR = Math.cos(Math.min(Math.PI, 3500 / R)); }
    }
    this.local = { precip, type, fog, lightning: light };
    // ── precipitation round the camera ──
    const f = FALL[type];
    // (additive, ships lane) no rain out of a clear sky: a trace of precipitation under a cloudless sky is a field's
    // fading tail, not weather — wet weather needs cloud over the camera (blown sand and ash need none)
    const cf = pv.fields.get('cloud');
    const skyK = type === 7 || type === 4 ? 1 : cf ? smooth(0.12, 0.35, pv.grid.sample(cf, u.x, u.y, u.z)) : 1;
    // (a heavy storm overhead rains as a curtain, whatever trace the precipitation field has reached yet)
    const rate = f ? clamp01(Math.max(precip / (type === 2 ? 4 : type === 4 ? 3 : 8), type === 1 ? ow.k * 0.85 : 0)) * low * skyK : 0;
    if (f && rate > 0.04 && pv.params.atmosphere.pressure > 0.02) {
      // a driven snow (a blizzard) streaks along the wind; a quiet one tumbles (a different system: its own emitter)
      // (a blizzard's own system, or snow heavy enough to be one, wherever its cell reaches the camera)
      const driven = type === 2 && (gust > 0.35 || precip > 6);
      const key = driven ? -2 : type;
      if (this.kind !== key) { this.stop(ctx); this.kind = key; }
      const wx = pv.fields.get('windX'), wy = pv.fields.get('windY'), wz = pv.fields.get('windZ');
      const wind = wx && wy && wz ? _p.set(pv.grid.sample(wx, u.x, u.y, u.z), pv.grid.sample(wy, u.x, u.y, u.z), pv.grid.sample(wz, u.x, u.y, u.z)) : _p.set(0, 0, 0);
      // a gale the fields do not carry (a painted blizzard, a sandstorm): the system's own wind, along the field's
      // direction if it has one, else from the west
      const galeV = Math.max(gust * 10, driven ? 13 : 0);
      if (wind.length() < galeV) {
        if (wind.lengthSq() < 1e-6) { const ex = u.z, ez = -u.x, el = Math.hypot(ex, ez) || 1; wind.set(ex / el, 0, ez / el); }
        wind.normalize().multiplyScalar(galeV);
      }
      const windK = type === 7 ? 3.5 : type === 2 ? 1.2 : 0.6;
      // (rain: a box close round the eye, dense — the streaks are only seen within a few tens of metres; beyond them
      // the weather's haze is the rain)
      const B = type === 2 || type === 4 ? 13 : type === 7 ? 30 : 16;
      // (a blizzard drives far more snow past the eye than a quiet snowfall drifts down)
      const count = Math.round((driven ? 20000 : type === 2 ? 4200 : type === 4 ? 3000 : type === 7 ? 2600 : 5200) * ctx.q * (0.35 + 0.65 * rate) * (type === 1 || type === 6 ? 1 + 0.9 * smooth(0.5, 1, rate) : 1));
      const def = {
        sys: driven ? SYS.precip : f.sys, x: cam.x, y: cam.y, z: cam.z, ax: wind.x * windK, ay: wind.y * windK, az: wind.z * windK,
        size: driven ? 0.045 : f.size * (type === 1 && precip > 15 ? 1.4 : 1), life: 10, count, p0: driven ? 9 : B, p1: driven ? 2.2 : f.speed * (type === 1 ? 0.8 + 0.4 * rate : 1), p2: driven ? 1 : 0,
        r: f.col[0], g: f.col[1], b: f.col[2], power: Math.min(1, 0.25 + rate) * smooth(0.04, 0.15, rate),
      };
      // (it was already falling when the camera came: a full box at once)
      if (!this.fall || !ctx.vfx.alive(this.fall)) this.fall = ctx.vfx.emit({ ...def, prewarm: def.life }, ctx.now);
      else ctx.vfx.set(this.fall, def);
      this.fallPower = def.power;
      // a blizzard at the lens: flakes out of focus sweeping past (small and faint: big opaque discs read as placeholder
      // circles, not snow), and a sheet of snow streaming along the ground
      if (driven) {
        const near = { sys: SYS.snowfall, x: cam.x, y: cam.y, z: cam.z, ax: wind.x * 1.1, ay: wind.y * 1.1, az: wind.z * 1.1, size: 0.07, life: 10, count: Math.round(120 * ctx.q), p0: 4, p1: 2.2, p2: 1, r: 0.95, g: 0.96, b: 1, power: Math.min(1, 0.4 + rate) };
        if (!this.nearFlakes || !ctx.vfx.alive(this.nearFlakes)) this.nearFlakes = ctx.vfx.emit({ ...near, prewarm: near.life }, ctx.now); else ctx.vfx.set(this.nearFlakes, near);
        const sheetOn = alt < 40;
        const sheet = { sys: SYS.drift, x: cam.x, y: cam.y, z: cam.z, ax: wind.x * 1.7, ay: wind.y * 1.7, az: wind.z * 1.7, size: 0.24, life: 10, count: Math.round(3200 * ctx.q), p0: 16, p1: Math.max(0.2, alt), r: 0.93, g: 0.95, b: 1, power: sheetOn ? Math.min(1, 0.3 + rate) : 0 };
        if (!this.drift || !ctx.vfx.alive(this.drift)) this.drift = ctx.vfx.emit({ ...sheet, prewarm: sheet.life }, ctx.now); else ctx.vfx.set(this.drift, sheet);
      } else this.stopBlizzard(ctx);
      // (splashes are seen from near the ground only: from the god's height each one, a few centimetres across, drew at
      // the sprites' least size — fuzzy grey balls a metre or two wide standing on the grass)
      const splashK = 1 - smooth(14, 45, alt);
      if (f.splash && splashK > 0.01) {
        const sd = { sys: SYS.splash, x: cam.x, y: cam.y, z: cam.z, size: 0.07 + 0.05 * rate, life: 0.35, count: Math.round(320 * ctx.q * rate), p0: 70, r: f.col[0], g: f.col[1], b: f.col[2], power: rate * splashK };
        if (!this.splash || !ctx.vfx.alive(this.splash)) this.splash = ctx.vfx.emit({ ...sd, prewarm: sd.life }, ctx.now);
        else ctx.vfx.set(this.splash, sd);
      } else if (this.splash) { ctx.vfx.stop(this.splash, ctx.now); this.splash = 0; }
    } else this.stop(ctx);
    if (this.fading.length) {
      for (const f of this.fading) {
        f.t -= ctx.ease / 0.8;
        if (f.t <= 0 || !ctx.vfx.alive(f.id)) { ctx.vfx.stop(f.id, ctx.now, true); f.t = 0; } else ctx.vfx.set(f.id, { power: f.p * f.t * f.t });
      }
      this.fading = this.fading.filter((f) => f.t > 0);
    }
    // ── rain on the lens: near the ground, more when looking up into it; it dries slowly when the rain stops ──
    const rainy = type === 1 || type === 5 || type === 6 ? rate : 0;
    const facing = ctx.camFwd ? clamp01(0.45 + ctx.camFwd.dot(u) * 1.4) : 0.5;
    // (additive, cameras lane) rain beads only on an eye down among things — walking, a photo, a follow camera near
    // the ground (under ~10 m) — never on the god's orbit or fly cameras; and it dries within a few seconds
    const mode = CAMERA_NOW.mode;
    const eye = mode === 'walk' || mode === 'photo' ? 1 - smooth(8, 25, alt) : mode === 'follow' ? 1 - smooth(6, 10, alt) : 0;
    const wantLens = rainy * eye * facing;
    this.lens += (wantLens - this.lens) * Math.min(1, ctx.ease * (wantLens > this.lens ? 0.3 : 0.8));
    if (this.lens < 0.01 && wantLens === 0) this.lens = 0;
    ctx.screen.lens = this.lens;
    // ── fog and tint (eased) ──
    // (the storm the camera is under, eased: its footprint for the cloud shadows, its strength here for the sky and haze)
    const ov = this.overcast, ek = Math.min(1, ctx.ease * 0.6 + 0.01);
    const camK = ow.k * smooth(ow.cosR, ow.cosR + (1 - ow.cosR) * 0.5, u.dot(ow.c));
    if (ow.k > 0.01) { if (ov.k < 0.02) ov.c.copy(ow.c); else ov.c.lerp(ow.c, ek).normalize(); ov.cosR += (ow.cosR - ov.cosR) * ek; }
    ov.k += (ow.k - ov.k) * ek;
    ov.cam += (camK - ov.cam) * ek;
    if (ov.k < 0.004 && ow.k === 0) ov.k = 0;
    const wantFog = Math.max(fog, type === 7 ? 0.6 * clamp01(precip / 6) : 0, type === 2 && precip > 6 ? 0.5 : 0, 0.3 * ov.cam) * low;
    this.fogK += (wantFog - this.fogK) * Math.min(1, ctx.ease * 0.8 + 0.02);
    if (this.fogK > 0.005) {
      const sunEl = u.dot(ctx.sunDirBody);
      const day = smooth(-0.12, 0.3, sunEl);
      // (blood rain hangs a red haze: on the grey-blue rain haze its sky tint was washed out, and the sign read as drizzle)
      const base = type === 7 ? [0.62, 0.5, 0.36] : type === 4 ? [0.4, 0.38, 0.36] : type === 6 ? [0.66, 0.3, 0.25] : [0.62, 0.66, 0.72];
      const lum = (ctx.sunE.y / 8) * (0.55 * day) + 0.004;
      ctx.screen.fogCol.set(base[0] * lum, base[1] * lum, base[2] * lum);
      ctx.screen.fogDensity = Math.max(ctx.screen.fogDensity, this.fogK * 0.011 * (1 + gust * 1.2));
      ctx.screen.fogScale = 140;
    }
    const tw = Math.min(1, tintW) * low * 0.85;
    const tgt = tintW > 0 ? _p.set(tint.x / tintW, tint.y / tintW, tint.z / tintW) : _p.set(1, 1, 1);
    this.tint.lerp(_p.set(1 + (tgt.x - 1) * tw, 1 + (tgt.y - 1) * tw, 1 + (tgt.z - 1) * tw), Math.min(1, ctx.ease * 0.8 + 0.02));
    ctx.screen.tintSky.multiply(this.tint);
    // (under the deck the sky is its grey underside, not the blue beyond it)
    if (ov.cam > 0.01) { const o = ov.cam * low; ctx.screen.tintSky.multiply(_p.set(1 - 0.34 * o, 1 - 0.33 * o, 1 - 0.3 * o)); }
    ctx.screen.tintGround.multiply(_p.set(1 + (this.tint.x - 1) * 0.3, 1 + (this.tint.y - 1) * 0.3, 1 + (this.tint.z - 1) * 0.3));
    // ── lightning in the storm cells round the camera ──
    if (light > 0.05 && pv.params.atmosphere.pressure > 0.05 && ctx.now > this.next) {
      this.next = ctx.now + (2 + Math.random() * 7) / Math.max(0.2, light);
      const a = Math.random() * Math.PI * 2, r = 150 + Math.random() * 1600;
      let ex = u.z, ez = -u.x;
      const el = Math.hypot(ex, ez) || 1;
      ex /= el; ez /= el;
      const nx = u.y * ez, ny = u.z * ex - u.x * ez, nz = -u.y * ex;
      const pu = _p.set(u.x * R + (ex * Math.cos(a) + nx * Math.sin(a)) * r, u.y * R + ny * Math.sin(a) * r, u.z * R + (ez * Math.cos(a) + nz * Math.sin(a)) * r).normalize();
      const gp = pu.clone().multiplyScalar(groundHeight(pv.ground, pu.x, pu.y, pu.z));
      // out of the deck down to the ground (GodFx: the cloud lit from inside, the bolt if near)
      if (ctx.strike) ctx.strike(pu, 0.9 + 0.3 * Math.random());
      else ctx.bolts.strike(pu.clone().multiplyScalar((ctx.cloudBase ?? R + 260) + 60), gp, ctx.now, 0.9 + 0.3 * Math.random(), 6);
      ctx.thunder(gp, 1);
    }
  }

  private nearFlakes = 0;
  private drift = 0;
  private stopBlizzard(ctx: FxCtx): void {
    if (this.nearFlakes) { this.fading.push({ id: this.nearFlakes, p: 0.8, t: 1 }); this.nearFlakes = 0; }
    if (this.drift) { this.fading.push({ id: this.drift, p: 0.8, t: 1 }); this.drift = 0; }
  }

  private stop(ctx: FxCtx): void {
    this.stopBlizzard(ctx);
    if (this.fall) { this.fading.push({ id: this.fall, p: this.fallPower, t: 1 }); this.fall = 0; }
    if (this.splash) { ctx.vfx.stop(this.splash, ctx.now); this.splash = 0; }
    this.kind = -1;
  }
}

export type { PlanetView };
