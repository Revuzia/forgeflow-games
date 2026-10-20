// GENESIS — the god layer's visuals, orchestrated (CONTRACT.md §15.6–15.8): the Touch (render/hand.ts), disasters and
// their warnings, weather and the rainbow, lightning, miracles and the sigils they write on the land (a sigil-sent
// disaster's too: the meteor's `fall`, where it will strike; a rival god's in its own cold silver), auroras,
// projectiles in flight, brush and targeting previews, and the signs — prophets, sacred places, sacred animals, omens
// read (render/signs/signs.ts, LIVING §3.4, hook H4). (The giant creature left the game — LIVING §0.1.6, hook H6: there
// is no creature layer.)
//
// The Renderer owns one GodFx and calls it at four points of its frame (renderer.ts):
//   shakeCamera  — right after the camera pose is set (quakes, impacts shake the view)
//   update       — after the planets' frame update, before the shadows: places the Touch (and what it holds: lit,
//                  shadow-casting props in the scene), reads the sim's events (impacts, quakes, eruptions,
//                  lightning, miracles, throws, landings…), turns disasters / weather / projectiles into FX, and
//                  collects this frame's decals and lights
//   renderDecals — into the HDR scene after the opaque pass (ground decals and FX lights, under the haze and water)
//   renderFx     — over the composited image after the atmosphere: fog, tints, the eclipse, then particles, funnels,
//                  plumes, bolts, domes, curtains and glows, soft-tested against the scene's linear depth
// Everything lives in the PRIMARY planet's body frame: the group is re-parented to that planet's group. Planet uniforms
// (sun, sky LUTs, shadows, moon) are proxied, so materials compiled once keep working when the primary world changes.
//
// The FX clock runs with the sim (it stops while the sim is paused, never runs faster than real time, like the life
// layer's animation clock): an explosion photographed while paused stays frozen mid-burst. `advance(s)` moves it for
// scripted captures (window.__GENESIS_FX__.advance). The Touch animates in real time (it is the player's, paused or not).

import { Group, Matrix3, Quaternion, Vector2, Vector3, type IUniform, type PerspectiveCamera, type Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import type { PlanetView, WorldView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import type { PlanetVisual } from '../planet/planetview.ts';
import type { PostPipeline } from '../post/pipeline.ts';
import type { FullscreenQuad } from '../post/fsquad.ts';
import type { Quality } from '../quality.ts';
import type { SimEvent } from '../../sim/types.ts';
import type { CloudStorm } from '../sky/clouds.ts';
import { AnimState, TICKS_PER_SECOND_1X } from '../../sim/types.ts';
import { BASE_PACK } from '../../data/index.ts';
import { HandVisual, type HandCursor, type UiHandPose } from '../hand.ts';
import { Aurora } from '../sky/aurora.ts';
import { DECAL, DecalPass, decal } from './decals.ts';
import { FX_EXPOSURE, FX_LAYER, clamp01, smooth } from './fxcommon.ts';
import { SYS, Vfx } from './vfx.ts';
import { Debris } from './meshfx.ts';
import { Lightning, brightness } from './lightning.ts';
import { DisasterFx, type FxCtx } from './disasters.ts';
import { WeatherFx } from './weatherfx.ts';
import { MiracleFx } from './miracles.ts';
import { Flights } from './flights.ts';
import { ThrowFx } from './throwfx.ts';
import { ScreenFx, newScreenState } from './screenfx.ts';
import { swapPropDepth } from './propmat.ts';
import { Rainbow } from './rainbow.ts';
import { SigilMarks } from './sigilfx.ts';
import { sigilOfDisaster } from './sigils.ts';
import { SignsLayer } from '../signs/signs.ts';

export interface BrushIn {
  planet: number;
  dir: [number, number, number];
  radius: number;
  color?: [number, number, number];
  /** additive (UI may pass): the power's category / command, its falloff 0..1 and strength 0..1, the tool mode */
  category?: string;
  command?: string;
  falloff?: number;
  strength?: number;
  mode?: string;
}

/** the categories' brush colours (src/ui/tools.ts CAT_COLOR) — a reticle for the destructive ones, a painted region for the sky */
const DISASTER_TINT: [number, number, number] = [1.5, 0.35, 0.25];
const SKY_TINT: [number, number, number] = [0.75, 0.9, 1.3];
/** the light a rival god's sigils are written in: a cold silver, never the player's Touch */
const RIVAL_LIGHT = { r: 0.66, g: 0.72, b: 0.95 };

/** weather kinds that light up the aurora (weather.json render.aurora) */
const AURORA_WEATHER = new Map<string, number>(
  ((BASE_PACK as unknown as { weather?: { id: string; render?: { aurora?: number } }[] }).weather ?? []).filter((w) => w.render?.aurora).map((w) => [w.id, Number(w.render!.aurora)]),
);

const _q = new Quaternion();
const _q2 = new Vector3();
const _qe = new Quaternion();
const _ax = new Vector3();
const _v = new Vector3();
const _w = new Vector3();

interface Modules {
  vfx: Vfx;
  debris: Debris;
  bolts: Lightning;
  disasters: DisasterFx;
  weather: WeatherFx;
  miracles: MiracleFx;
  flights: Flights;
  throws: ThrowFx;
  aurora: Aurora;
  rainbow: Rainbow;
  sigils: SigilMarks;
  signs: SignsLayer;
}

export class GodFx {
  readonly group = new Group();
  readonly hand = new HandVisual();
  readonly decals = new DecalPass();
  /** proxies of the primary planet's uniforms (stable objects; values follow the current primary) */
  readonly shared: Record<string, IUniform> = {};
  /** the FX pass's own uniforms (depth, exposure, clock) */
  readonly fx: Record<string, IUniform>;
  /** seconds of FX time (runs with the sim) */
  clock = 0;
  /** multiplier on the primary planet's sunlight (eclipse, impact winter, a flare) — applied by the renderer */
  readonly sunTint = new Vector3(1, 1, 1);
  /** exposure compensation (EV) the god layer asks for (an eclipse's darkness) — added by the renderer */
  exposureEV = 0;
  /**
   * (read by the renderer for sky/clouds.ts) lightning lighting the deck from inside this frame: body-frame point,
   * radiance and reach of up to four flashes — the strike's light in the cloud's own shape, not a sprite
   */
  readonly cloudFlashes: { x: number; y: number; z: number; w: number; r: number }[] = [];
  /** (read by the renderer for sky/clouds.ts) storm cells the god layer adds to the deck: a live tornado's
   *  thunderstorm, a hurricane's spiral — at once, not when the sim's weather and climate cadence catches up */
  readonly cloudStorms: CloudStorm[] = [];
  /** live in-cloud flashes (real time: a flash is a moment of the world's weather, seen at 100x as at 1x) */
  private flashes: { p: Vector3; t0: number; strokes: number[]; power: number; w: number; r: number }[] = [];
  /** a token bucket on bolts per real second (at 100x a world storm sends hundreds of strikes a second) */
  private boltTokens = 4;
  brush: BrushIn | null = null;
  quality: Quality | null = null;
  /** the modules that need the planet's uniforms are made on the first frame with a planet */
  m: Modules | null = null;
  readonly screenState = newScreenState();
  private screen = new ScreenFx();
  private vis: PlanetVisual | null = null;
  private view: WorldView | null = null;
  private seen = new WeakSet<SimEvent>();
  private shake = 0;
  private shakeT = 0;
  private lastTick = -1;
  private lastReal = -1;
  private cursor: HandCursor | null = null;
  private uiPose: UiHandPose = 'none';
  private aiming = false;
  private readonly camFwd = new Vector3();
  private readonly camUp = new Vector3();
  private extraDt = 0;
  private ctx: FxCtx | null = null;
  private readonly sunWant = new Vector3(1, 1, 1);
  private readonly auroraBoost = { boost: 0 };
  private flashDecay = new Vector3();

  constructor() {
    this.group.name = 'godfx';
    this.group.matrixAutoUpdate = false;
    this.fx = {
      uFxTime: { value: 0 }, tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) },
      tExposure: FX_EXPOSURE, uHasExposure: { value: 0 },
    };
    this.hand.bindFx(this.fx);
    this.group.add(this.hand.group, this.decals.group);
    // scripted captures: move the FX clock (window.__GENESIS_FX__.advance(2.5)); reach the layer from a probe
    if (typeof window !== 'undefined') (window as unknown as { __GENESIS_FX__?: unknown }).__GENESIS_FX__ = { advance: (s: number) => { this.extraDt += Math.max(0, s); }, fx: this };
  }

  /** the App's input: the ground under the cursor, the UI hand's state */
  setInput(hit: { planet: number; dir: ArrayLike<number> } | null, uiPose: string, aiming: boolean): void {
    this.cursor = hit ? { planet: hit.planet, dir: hit.dir } : null;
    this.uiPose = (uiPose as UiHandPose) || 'none';
    this.aiming = aiming;
  }

  /** move the FX clock forward (scripted shots) */
  advance(s: number): void { this.extraDt += Math.max(0, s); }

  /** the sun's tint for a planet (renderer.ts, per planet) */
  tintSun(sunE: Vector3, primary: boolean): Vector3 {
    return primary ? sunE.multiply(this.sunTint) : sunE;
  }

  private bindPrimary(vis: PlanetVisual): void {
    if (this.vis === vis) return;
    this.vis = vis;
    const u = vis.uniforms as Record<string, IUniform>;
    const self = this;
    for (const k of Object.keys(u)) {
      if (this.shared[k]) continue;
      const key = k;
      this.shared[k] = {
        get value() { return self.vis?.uniforms[key]?.value; },
        set value(v: unknown) { const t = self.vis?.uniforms[key]; if (t) t.value = v; },
      } as IUniform;
    }
    if (this.group.parent !== vis.group) { this.group.removeFromParent(); vis.group.add(this.group); }
    if (!this.m) {
      const vfx = new Vfx(this.shared, this.fx, 98304);
      const debris = new Debris(this.shared, this.fx);
      const bolts = new Lightning(this.fx);
      const disasters = new DisasterFx(this.fx, this.shared);
      const miracles = new MiracleFx(this.fx, this.shared);
      const flights = new Flights(this.shared);
      const throws = new ThrowFx(this.fx);
      const aurora = new Aurora(this.fx, this.shared);
      const rainbow = new Rainbow(this.fx, this.shared);
      const sigils = new SigilMarks(this.fx);
      const signs = new SignsLayer(this.fx);
      this.m = { vfx, debris, bolts, disasters, weather: new WeatherFx(), miracles, flights, throws, aurora, rainbow, sigils, signs };
      this.group.add(vfx.group, debris.mesh, bolts.mesh, disasters.group, miracles.group, flights.group, throws.group, aurora.group, rainbow.mesh, sigils.group, signs.group);
    }
  }

  /** a little shake of the view (quakes, impacts): applied to the camera before its frustum is taken */
  shakeCamera(cam: PerspectiveCamera, dt: number): void {
    this.shake *= Math.exp(-dt * 1.6);
    if (this.shake < 1e-4) { this.shake = 0; return; }
    this.shakeT += dt;
    const t = this.shakeT, a = this.shake * 0.02;
    const ex = (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7 + 1.3) * 0.4) * a;
    const ey = (Math.sin(t * 43.9 + 2.1) * 0.6 + Math.sin(t * 71.3) * 0.4) * a;
    const ez = Math.sin(t * 29.3 + 0.7) * a * 0.5;
    _qe.setFromAxisAngle(_ax.set(1, 0, 0), ex);
    _q.setFromAxisAngle(_ax.set(0, 1, 0), ey).multiply(_qe);
    _qe.setFromAxisAngle(_ax.set(0, 0, 1), ez);
    cam.quaternion.multiply(_q).multiply(_qe);
  }

  /** add shake from an event at body-frame `pos` (m) of strength `k` felt over `reach` m */
  addShake(pos: Vector3 | null, k: number, reach: number): void {
    const vis = this.vis;
    if (!vis) return;
    const d = pos ? pos.distanceTo(vis.camBody) : 0;
    const fall = clamp01(1 - d / Math.max(1, reach));
    this.shake = Math.min(1.6, this.shake + k * fall * fall);
  }

  update(view: WorldView, vis: PlanetVisual | null, cam: PerspectiveCamera, dt: number, time: number, q: Quality): void {
    this.quality = q;
    this.view = view;
    if (!vis) { this.group.visible = false; this.exposureEV = 0; this.sunTint.set(1, 1, 1); return; }
    this.bindPrimary(vis);
    const M = this.m!;
    this.group.visible = true;
    const pv = vis.pv;
    // ── the FX clock: with the sim, never faster than real time ──
    const tick = pv.renderTick ?? pv.paramsTick;
    let fxDt = 0;
    if (this.lastReal >= 0) {
      const realDt = Math.max(0, Math.min(0.1, time - this.lastReal));
      const dTick = tick - this.lastTick;
      // (1x is TICKS_PER_SECOND_1X ticks per real second — LIVING §1.1: one since the living-world pace, ten before:
      // divided by the old ten, every explosion, bolt and flight played at a sixth of its speed at 1x)
      if (dTick > 1e-6) fxDt = Math.min(realDt, dTick / TICKS_PER_SECOND_1X + 1e-3);
    }
    this.lastReal = time;
    this.lastTick = tick;
    fxDt += this.extraDt;
    this.extraDt = 0;
    this.clock += fxDt;
    this.fx.uFxTime.value = this.clock % 3600;
    // camera axes in the body frame
    _q.copy(vis.group.quaternion).invert();
    this.camFwd.set(0, 0, -1).applyQuaternion(cam.quaternion).applyQuaternion(_q);
    this.camUp.set(0, 1, 0).applyQuaternion(cam.quaternion).applyQuaternion(_q);
    // ── this frame's context ──
    const S = this.screenState;
    S.tintSky.set(1, 1, 1); S.tintGround.set(1, 1, 1); S.fogDensity = 0; S.eclipse = 0; S.totality = 0;
    this.flashDecay.multiplyScalar(Math.exp(-dt * 10));
    S.flash.copy(this.flashDecay);
    this.sunWant.set(1, 1, 1);
    this.auroraBoost.boost = 0;
    const qk = Math.max(0.25, Math.min(2, (q.particleBudget || 20000) / 20000));
    const ctx: FxCtx = this.ctx ?? (this.ctx = {
      pv, now: 0, dt: 0, camBody: vis.camBody, vfx: M.vfx, decals: this.decals, debris: M.debris, bolts: M.bolts, screen: S,
      sunTint: this.sunWant, aurora: this.auroraBoost, q: 1, thunder: (p, k) => this.thunder(p, k), sunDirBody: new Vector3(), sunE: new Vector3(), ease: 0,
      landed: (e) => M.disasters.onEvent(e, this.ctx!),
      strike: (u, power) => this.lightningAt(u, power, this.ctx!),
      storms: this.cloudStorms,
    });
    ctx.pv = pv; ctx.now = this.clock; ctx.dt = Math.max(fxDt, 1e-4); ctx.camBody = vis.camBody; ctx.q = qk; ctx.camFwd = this.camFwd;
    ctx.ease = Math.max(ctx.dt, Math.min(0.1, Math.max(0, dt)));
    ctx.cloudBase = vis.hasClouds ? vis.cloudInner : pv.params.radius + 260;
    ctx.cloudTop = vis.hasClouds ? vis.cloudOuter : pv.params.radius + 420;
    this.cloudStorms.length = 0;
    // (bolts per real second: refill the bucket)
    this.boltTokens = Math.min(4, this.boltTokens + Math.max(0, Math.min(0.1, dt)) * 2.5);
    ctx.sunDirBody.copy(vis.uniforms.uSunDirBody.value as Vector3);
    ctx.sunE.copy((vis.atmo.uniforms as unknown as { uSunE: { value: Vector3 } }).uSunE.value);
    M.debris.gU.value = pv.params.gravity || 9.8;
    // ── events ──
    for (const e of view.pendingEvents) {
      if (this.seen.has(e)) continue;
      this.seen.add(e);
      if (e.planet !== undefined && e.planet !== pv.id) continue;
      this.onEvent(e, ctx);
    }
    // ── the Touch (real time) ──
    this.hand.update({
      pv, hand: view.hand, camBody: vis.camBody, camFwd: this.camFwd, camUp: this.camUp, dt, fxTime: time, fxDt,
      cursor: this.cursor, uiPose: this.uiPose, aiming: this.aiming, decals: this.decals, shared: this.shared,
      cloudBase: ctx.cloudBase, air: vis.atmo.has, fov: cam.fov, viewH: this.viewH, burst: this.touchBurst,
    });
    // ── things in flight, disasters, weather, miracles ──
    M.flights.update(ctx, pv.projectiles ?? []);
    // what the Touch hurls: drawn to read (present.ts), streaked in its light, its landing ringed on the ground
    M.throws.update(M.flights, pv, this.clock, vis.camBody, cam.fov, this.viewH, this.decals, this.hand.light);
    M.disasters.update(pv.disasters, ctx);
    M.weather.update(ctx);
    M.miracles.update(ctx);
    M.sigils.update(this.lastReal, this.decals);
    M.rainbow.update(pv, vis.camBody, cam.projectionMatrixInverse, viewToBody(vis), ctx.cloudBase ?? pv.params.radius + 260, ctx.ease);
    // people in the hand and in the air are drawn where the god layer says
    const crowds = vis.life.crowds;
    crowds.pinned.clear();
    if (this.hand.visible && this.hand.heldKind === 'agent' && this.hand.heldId >= 0) {
      crowds.pinned.set(this.hand.heldId, { x: this.hand.pinch.x, y: this.hand.pinch.y, z: this.hand.pinch.z, tumble: this.hand.swing, anim: AnimState.held });
    }
    for (const [id, p] of M.flights.agentPins) crowds.pinned.set(id, p);
    // ── the signs: prophets, the Called, sacred places and animals, omens read (after the crowds placed the people) ──
    M.signs.update({
      pv, camBody: vis.camBody, now: this.clock, real: time, decals: this.decals, vfx: M.vfx,
      ticksSinceSnap: Math.max(0, (pv.renderTick ?? pv.paramsTick) - pv.paramsTick),
      personAt: (id) => crowds.positionOf(id), query: simQuery(),
    });
    // ── lightning: ribbons, the light they throw on the ground ──
    M.bolts.update(this.clock, vis.camBody, ctx.ease);
    M.bolts.forEachLive(this.clock, (gp, top, k, power) => {
      // the strike lights the ground and everything standing there for an instant (a ground flash), the view a little
      const d = decal(DECAL.light, [gp.x, gp.y, gp.z], 600);
      // (a near strike lit the whole hillside white at its stroke: bright, but the land keeps its shape)
      d.cr = 0.75; d.cg = 0.8; d.cb = 1; d.p0 = 600; d.p1 = 6e4 * k * power; d.p2 = Math.min(120, top.distanceTo(gp) * 0.25); d.p3 = 40;
      this.decals.add(d);
      const near = 1 - smooth(200, 2500, gp.distanceTo(vis.camBody));
      this.flashDecay.addScalar(0.0015 * k * near);
    });
    this.stepFlashes();
    // ── the aurora ──
    let wAur = 0;
    for (const w of pv.weather) { const a = AURORA_WEATHER.get(w.kind); if (a) wAur = Math.max(wAur, a * w.intensity); }
    if (pv.params.globalWeather && AURORA_WEATHER.has(pv.params.globalWeather)) wAur = Math.max(wAur, AURORA_WEATHER.get(pv.params.globalWeather)!);
    M.aurora.update(pv.params.radius, vis.atmo.thickness, pv.params.magnetism ?? 0, view.star.activity ?? 0, this.auroraBoost.boost + wAur * 2.5, vis.atmo.has, ctx.ease);
    // ── the eclipse: the sun dims with the covered share; a partial eclipse only a little darker to the eye (the
    // exposure adapts, as eyes do — held down by half a stop), totality truly dark (held down three stops) with a
    // sunset glow all round the horizon and the stars out; the sun's tint eases ──
    if (S.eclipse > 0) this.sunWant.multiplyScalar(1 - 0.985 * S.eclipse);
    const tot = smooth(0.93, 0.995, S.eclipse);
    const evWant = -0.55 * smooth(0.45, 0.9, S.eclipse) - 2.5 * tot * tot;
    S.totality = tot;
    // (the glow is lit by the undimmed sun: the planet's sun illuminance already carries the eclipse's tint)
    S.horizonCol.set(ctx.sunE.x / Math.max(0.02, this.sunTint.x), ctx.sunE.y / Math.max(0.02, this.sunTint.y), ctx.sunE.z / Math.max(0.02, this.sunTint.z))
      .multiply(_w.set(1.0, 0.48, 0.2)).multiplyScalar(0.03 * tot);
    this.exposureEV += (evWant - this.exposureEV) * Math.min(1, ctx.ease * 1.5 + 0.02);
    this.sunTint.lerp(this.sunWant, Math.min(1, ctx.ease * 2 + 0.02));
    // ── the brush ──
    this.brushDecal(pv);
    M.vfx.update(this.clock, viewToBody(vis), cam.projectionMatrixInverse, vis.uniforms.uSunDirView.value as Vector3);
  }

  /** the view's height in pixels (renderFx keeps it: sizes that must read on screen) */
  private viewH = 720;
  /** weather the Touch throws into the world: a rebuke's gust of dust along the ground, its cold flash */
  private readonly touchBurst = (kind: 'gust' | 'flash', p: Vector3, size: number): void => {
    const M = this.m, vis = this.vis;
    if (!M || !vis) return;
    if (kind === 'gust') {
      M.vfx.emit({ sys: SYS.dust, x: p.x, y: p.y, z: p.z, size: size * 0.35, life: 2.4, count: Math.round(140 * Math.max(0.5, this.ctx?.q ?? 1)), p0: size * 0.6, p1: size * 2.2, burst: true, r: 0.44, g: 0.38, b: 0.3, power: 0.8 }, this.clock);
    } else {
      this.flashDecay.addScalar(0.02 * (1 - smooth(size * 4, size * 40, p.distanceTo(vis.camBody))));
    }
  };

  /**
   * a lightning strike over unit vector `u`: the cloud lights up from inside (always — from orbit a brief pinprick in
   * the deck), and, near enough and not too often in real time, a bolt comes out of the deck to the ground. `scorch`:
   * the sim's own strike (it burns the ground there)
   */
  lightningAt(u: Vector3, power: number, ctx: FxCtx, scorch = false): void {
    const vis = this.vis, M = this.m;
    if (!vis || !M) return;
    const pv = vis.pv;
    const R = pv.params.radius;
    const uu = _w.copy(u).normalize();
    const gR = groundHeight(pv.ground, uu.x, uu.y, uu.z);
    const g = uu.clone().multiplyScalar(gR);
    const base = ctx.cloudBase ?? R + 260, top = ctx.cloudTop ?? base + 200;
    const c = vis.camBody;
    const cl = c.length() || 1;
    const alt = cl - groundHeight(pv.ground, c.x / cl, c.y / cl, c.z / cl);
    const dist = g.distanceTo(c);
    // the storm cell it belongs to: its flash is about the cell's size (a few hundred metres on this world)
    let cell = 280;
    for (const w of pv.weather) {
      const d = Math.acos(Math.max(-1, Math.min(1, uu.x * w.pos[0] + uu.y * w.pos[1] + uu.z * w.pos[2]))) * R;
      if (d < w.radius) { cell = Math.max(160, Math.min(520, w.radius * 0.3)); break; }
    }
    const high = smooth(1500, 9000, alt);
    const inCloud = uu.clone().multiplyScalar(base + (top - base) * (0.3 + 0.25 * Math.random()));
    inCloud.addScaledVector(_q2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), cell * 0.4);
    const n = 1 + Math.floor(Math.random() * 3);
    const strokes = [0];
    for (let i = 0; i < n; i++) strokes.push(0.07 + i * 0.08 + Math.random() * 0.05);
    this.flashes.push({ p: inCloud, t0: this.lastReal, strokes, power, w: 26 * power * (1 - 0.8 * high), r: cell * (1 - 0.55 * high) });
    if (this.flashes.length > 6) this.flashes.shift();
    // the bolt itself: near and not from orbit, at most a few per real second
    const near = alt < 1800 && dist < 6500;
    if (near && this.boltTokens >= 1) {
      this.boltTokens -= 1;
      const from = uu.clone().multiplyScalar(base + (top - base) * 0.32).addScaledVector(_q2.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), 40);
      M.bolts.strike(from, g, this.clock, power, 7, true);
      if (scorch) this.decals.add(Object.assign(decal(DECAL.scorch, [g.x, g.y, g.z], 6), { p0: 4, p1: 0.6, p2: 2 }));
    }
  }

  /** this frame's in-cloud flashes for the cloud pass (real time) */
  private stepFlashes(): void {
    const now = this.lastReal;
    this.flashes = this.flashes.filter((f) => now - f.t0 < 0.9);
    const out = this.cloudFlashes;
    out.length = 0;
    for (const f of this.flashes) {
      const k = brightness({ t0: f.t0, strokes: f.strokes, power: 1 }, now);
      if (k < 0.02) continue;
      out.push({ x: f.p.x, y: f.p.y, z: f.p.z, w: f.w * k, r: f.r });
    }
    out.sort((a, b) => b.w - a.w);
    if (out.length > 4) out.length = 4;
  }

  private thunder(p: Vector3, k: number): void {
    const view = this.view, vis = this.vis;
    if (!view || !vis) return;
    const l = p.length() || 1;
    const e: SimEvent = { t: 'lightning', tick: Math.floor(vis.pv.renderTick ?? vis.pv.paramsTick), planet: vis.pv.id, pos: [p.x / l, p.y / l, p.z / l], a: k, data: { ambient: true } };
    this.seen.add(e);
    view.pendingEvents.push(e);
  }

  private onEvent(e: SimEvent, ctx: FxCtx): void {
    const vis = this.vis!, M = this.m!;
    const pv = vis.pv;
    const R = pv.params.radius;
    const p = e.pos ? new Vector3(e.pos[0], e.pos[1], e.pos[2]).normalize().multiplyScalar(R) : null;
    switch (e.t) {
      case 'quake':
        this.addShake(p, Math.min(1.4, 0.15 * Math.max(0, (e.a ?? 5) - 3)), (e.b ?? 400) * 6 + 1500);
        // (a volcano's warning tremors bring rocks down its slopes)
        M.disasters.onEvent(e, ctx);
        break;
      case 'impact': {
        const sh = p && (e.data as { shielded?: boolean } | undefined)?.shielded ? M.miracles.shieldOver(p) : null;
        if (sh && p) {
          // a shield took it: the body bursts on the dome (the crown of light over the place), nothing reaches the ground
          const up = _w.copy(p).normalize();
          const at = _v.copy(sh.c).addScaledVector(up, sh.r * 0.92);
          const R0 = Math.max(6, e.a ?? 40);
          M.vfx.emit({ sys: SYS.flash, x: at.x, y: at.y, z: at.z, size: R0 * 5, life: 1.4, count: 1, p0: R0 * 0.5, p1: 260, burst: true, r: 1, g: 0.85, b: 0.55 }, this.clock);
          M.vfx.emit({ sys: SYS.sparks, x: at.x, y: at.y, z: at.z, size: Math.max(0.8, R0 * 0.03), life: 3, count: 360, p1: 40 + R0 * 0.5, burst: true, r: 1, g: 0.75, b: 0.4 }, this.clock);
          M.vfx.emit({ sys: SYS.smoke, x: at.x, y: at.y, z: at.z, size: R0 * 0.6, life: 16, count: 160, p0: R0 * 2, p1: 1, duration: 2, r: 0.3, g: 0.27, b: 0.24 }, this.clock);
          this.flashDecay.addScalar(0.05 * (1 - smooth(300, 6000, at.distanceTo(vis.camBody))));
          this.addShake(at, 0.3, R0 * 30 + 800);
          M.miracles.hitShield(p);
          break;
        }
        this.addShake(p, Math.min(1.5, 0.004 * (e.a ?? 50)), (e.a ?? 50) * 30 + 1200);
        M.disasters.onEvent(e, ctx);
        if (p) M.miracles.hitShield(p);
        break;
      }
      case 'eruption': this.addShake(p, 0.5, 4000); M.disasters.onEvent(e, ctx); break;
      case 'collapsed': case 'landslide': case 'steam': case 'fireball': M.disasters.onEvent(e, ctx); break;
      case 'thrown': case 'landed': case 'splash': {
        // (a person hurled from the Touch: it held them until this frame — events run before the Touch updates)
        // (measured over the ground, not through it: the event's point is on the datum sphere, the grip over the land)
        const g = this.hand.grip, gl = g.length() || 1;
        const along = p ? Math.acos(Math.max(-1, Math.min(1, g.dot(p) / (gl * R)))) * R : Infinity;
        const fromTouch = e.t === 'thrown' && this.hand.heldKind === 'agent' && along < Math.max(60, this.hand.scale * 4);
        if (!M.flights.onEvent(e, ctx, fromTouch ? this.hand.heldId : -1)) M.disasters.onEvent(e, ctx);
        break;
      }
      case 'lightning': {
        if ((e.data as { ambient?: boolean } | undefined)?.ambient || !e.pos) break;
        this.lightningAt(_v.set(e.pos[0], e.pos[1], e.pos[2]).normalize(), Math.min(1.5, Math.max(0.6, e.a ?? 1)), ctx, true);
        // a strike made a sign (god/omens.ts: data.omen) leaves the struck place glowing; a god's lightning sigil does when
        // a town reads it as one (the `omen` event after it) — the signs layer remembers it until then
        const ld = e.data as { omen?: number; god?: number } | undefined;
        if (ld?.omen || typeof ld?.god === 'number') M.signs.onEvent(e, R, this.lastReal);
        break;
      }
      case 'sacred.place': case 'sacred.animal': case 'omen': case 'prophet.called': case 'prophet.fulfilled': case 'prophet.died':
        M.signs.onEvent(e, R, this.lastReal);
        break;
      case 'miracle': {
        M.miracles.onEvent(e, ctx);
        const md = e.data as { kind?: string; god?: number } | undefined;
        // (a rival god's miracle is written in a cold silver of its own, and the player's Touch does not cast it)
        const rival = typeof md?.god === 'number' && md.god !== 0;
        this.writeSigil(p, String(md?.kind ?? e.text ?? ''), e.a ?? 100, rival);
        break;
      }
      case 'disaster': {
        // a disaster the god sends with a sigil (the meteor's `fall`): its glyph is written where it will strike — the
        // god's mark on the place, before the warning's first light — and the Touch traces it when near
        const dd = e.data as { kind?: string; god?: number; cause?: string } | undefined;
        if (!dd?.kind || dd.cause === 'nature' || typeof dd.god !== 'number' || !sigilOfDisaster(dd.kind)) break;
        this.writeSigil(p, dd.kind, e.a ?? 100, dd.god !== 0);
        break;
      }
      case 'shield': M.miracles.onEvent(e, ctx); break;
    }
  }

  /**
   * a sigil written on the land where a miracle (or a sigil-sent disaster) of `kind` lands at body point `p` (the
   * power's glyph, at the act's radius), in the Touch's light — and, when the Touch is near, traced by it in the air as
   * it casts. A rival god's is written in its own cold silver, and the player's Touch never casts it.
   */
  private writeSigil(p: Vector3 | null, kind: string, radius: number, rival: boolean): void {
    const vis = this.vis, M = this.m;
    if (!p || !vis || !M) return;
    const pv = vis.pv;
    const u = _w.copy(p).normalize();
    const gp = u.multiplyScalar(groundHeight(pv.ground, u.x, u.y, u.z));
    M.sigils.land(pv, kind, gp, radius, rival ? RIVAL_LIGHT : this.hand.light, vis.camBody, this.camFwd, this.lastReal);
    if (!rival && this.hand.visible && this.hand.pos.distanceTo(p) < Math.max(250, radius * 2.5)) this.hand.pulse('cast', this.hand.hold ?? this.lastReal, kind);
  }

  private brushDecal(pv: PlanetView): void {
    const b = this.brush;
    if (!b || b.planet !== pv.id) return;
    const u = b.dir;
    const l = Math.hypot(u[0], u[1], u[2]) || 1;
    const g = groundHeight(pv.ground, u[0] / l, u[1] / l, u[2] / l);
    const c: [number, number, number] = [(u[0] / l) * g, (u[1] / l) * g, (u[2] / l) * g];
    const col = b.color ?? [1.2, 0.95, 0.55];
    const near = (t: [number, number, number]) => Math.abs(col[0] - t[0]) < 0.05 && Math.abs(col[1] - t[1]) < 0.05 && Math.abs(col[2] - t[2]) < 0.05;
    const destructive = b.category === 'Disasters' || near(DISASTER_TINT);
    const weather = b.category === 'Sky' || b.mode === 'front' || near(SKY_TINT);
    const d = decal(destructive ? DECAL.reticle : weather ? DECAL.paint : DECAL.brush, c, b.radius * 1.15 + 2);
    d.cr = col[0]; d.cg = col[1]; d.cb = col[2]; d.ca = 1;
    d.p0 = b.radius;
    if (destructive) { d.p1 = 0.55 + 0.35 * Math.sin(this.lastReal * 2); d.p2 = 0.8; d.p3 = 0.6; }
    else if (weather) { d.p1 = 1; }
    else { d.p1 = b.falloff ?? 0.5; d.p2 = b.strength ?? 0.5; }
    d.q0 = Math.max(4, b.radius * 0.5);
    // the brush's axis: toward the camera, so tick marks and hatching keep still on screen
    d.ax = this.camFwd.x; d.ay = this.camFwd.y; d.az = this.camFwd.z;
    this.decals.add(d);
  }

  swapDepth(depth: boolean): void {
    this.hand.swapDepth(depth);
    // every prop that casts (debris, things the Touch holds or hurls, a serpent's back) to its depth twin
    swapPropDepth(this.group, depth);
  }

  /** ground decals and FX lights, into the HDR scene (after the opaque pass, before the water and the atmosphere) */
  renderDecals(r: WebGLRenderer, scene: Scene, cam: PerspectiveCamera, post: PostPipeline): void {
    const vis = this.vis;
    if (!vis || !this.group.visible) return;
    this.decals.draw(r, scene, cam, post.hdr, post.linDepth.texture, post.w, post.h, vis.uniforms.uBodyToView.value as never, vis.camBody, this.lastReal);
  }

  /** the FX over the composited image (after the atmosphere): fog, tints, the eclipse, then the FX layer */
  renderFx(r: WebGLRenderer, scene: Scene, cam: PerspectiveCamera, target: WebGLRenderTarget | null, post: PostPipeline, fsq?: FullscreenQuad): void {
    const vis = this.vis;
    if (!vis || !this.group.visible) return;
    this.fx.tSceneDepth.value = post.linDepth.texture;
    (this.fx.uResolution.value as Vector2).set(post.w, post.h);
    this.viewH = post.h;
    this.fx.uHasExposure.value = FX_EXPOSURE.value ? 1 : 0;
    // the eclipse: where the star is on screen and how big
    const S = this.screenState;
    if (S.eclipse > 0 && this.view) {
      const pv = vis.pv;
      const sd = _v.set(pv.sunDir[0], pv.sunDir[1], pv.sunDir[2]).transformDirection(cam.matrixWorldInverse);
      if (sd.z < 0) {
        sd.applyMatrix4(cam.projectionMatrix);
        S.sunUV.set(sd.x * 0.5 + 0.5, sd.y * 0.5 + 0.5);
        const dist = Math.hypot(pv.center[0], pv.center[1], pv.center[2]) || 1;
        const ang = Math.asin(Math.min(1, Math.max(100, this.view.star.radius) / dist));
        S.sunR = Math.tan(ang) / (2 * Math.tan((cam.fov * Math.PI) / 360));
      } else S.sunUV.set(-10, -10);
    }
    if (fsq) {
      const c = vis.camBody;
      const l = c.length() || 1;
      this.screen.render(r, fsq, target, S, post.linDepth.texture, post.w, post.h, cam.projectionMatrixInverse, viewToBody(vis), c, groundHeight(vis.pv.ground, c.x / l, c.y / l, c.z / l), this.clock);
    }
    const prevAuto = r.autoClear;
    const prevMask = cam.layers.mask;
    r.autoClear = false;
    r.setRenderTarget(target);
    cam.layers.set(FX_LAYER);
    r.render(scene, cam);
    cam.layers.mask = prevMask;
    r.autoClear = prevAuto;
  }

  dispose(): void {
    this.hand.dispose();
    this.decals.dispose();
    this.screen.dispose();
    if (this.m) {
      this.m.vfx.dispose(); this.m.debris.dispose(); this.m.bolts.dispose(); this.m.disasters.dispose(); this.m.miracles.dispose();
      this.m.flights.dispose(); this.m.throws.dispose(); this.m.aurora.dispose(); this.m.rainbow.dispose(); this.m.sigils.dispose(); this.m.signs.dispose();
    }
  }
}

/**
 * the sim's queries for the signs (the sacred places the snapshot does not carry): through the app's automation
 * surface (window.__GENESIS__, installed on every page by main.ts) — absent on a bare renderer, where the events alone
 * feed them
 */
function simQuery(): ((q: string) => Promise<unknown>) | undefined {
  const g = (globalThis as unknown as { __GENESIS__?: { query?: (q: string, a?: Record<string, unknown>) => Promise<unknown> } }).__GENESIS__;
  return g?.query ? (q: string) => g.query!(q, {}) : undefined;
}

/** the view → body rotation of the primary planet (one shared matrix, recomputed when asked) */
const _m3 = new Matrix3();
function viewToBody(vis: PlanetVisual): Matrix3 {
  return _m3.copy(vis.uniforms.uBodyToView.value as Matrix3).transpose();
}
