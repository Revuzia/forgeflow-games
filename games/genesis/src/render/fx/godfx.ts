// GENESIS — the god layer's visuals, orchestrated (CONTRACT.md §15.6–15.8): the hand, the creatures, disasters,
// weather, lightning, miracles, auroras, projectiles in flight, brush and targeting previews.
//
// The Renderer owns one GodFx and calls it at four points of its frame (renderer.ts):
//   shakeCamera  — right after the camera pose is set (quakes, impacts shake the view)
//   update       — after the planets' frame update, before the shadows: places the hand and the creatures (opaque,
//                  lit, shadow-casting meshes in the scene), reads the sim's events (impacts, quakes, eruptions,
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
// scripted captures (window.__GENESIS_FX__.advance). The hand animates in real time (it is the player's, paused or not).

import { Group, Matrix3, Quaternion, Vector2, Vector3, type IUniform, type PerspectiveCamera, type Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import type { PlanetView, WorldView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import type { PlanetVisual } from '../planet/planetview.ts';
import type { PostPipeline } from '../post/pipeline.ts';
import type { FullscreenQuad } from '../post/fsquad.ts';
import type { Quality } from '../quality.ts';
import type { SimEvent } from '../../sim/types.ts';
import { AnimState } from '../../sim/types.ts';
import { BASE_PACK } from '../../data/index.ts';
import { HandVisual, type HandCursor, type UiHandPose } from '../hand.ts';
import { handMesh } from '../gen/handgen.ts';
import { CreatureLayer } from '../life/creature.ts';
import { Aurora } from '../sky/aurora.ts';
import { DECAL, DecalPass, decal } from './decals.ts';
import { FX_EXPOSURE, FX_LAYER, clamp01, smooth } from './fxcommon.ts';
import { SYS, Vfx } from './vfx.ts';
import { Debris } from './meshfx.ts';
import { Lightning } from './lightning.ts';
import { DisasterFx, type FxCtx } from './disasters.ts';
import { WeatherFx } from './weatherfx.ts';
import { MiracleFx } from './miracles.ts';
import { Flights } from './flights.ts';
import { ScreenFx, newScreenState } from './screenfx.ts';
import { swapPropDepth } from './propmat.ts';

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

/** weather kinds that light up the aurora (weather.json render.aurora) */
const AURORA_WEATHER = new Map<string, number>(
  ((BASE_PACK as unknown as { weather?: { id: string; render?: { aurora?: number } }[] }).weather ?? []).filter((w) => w.render?.aurora).map((w) => [w.id, Number(w.render!.aurora)]),
);

const _q = new Quaternion();
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
  aurora: Aurora;
}

export class GodFx {
  readonly group = new Group();
  readonly hand = new HandVisual();
  readonly decals = new DecalPass();
  readonly creatures: CreatureLayer;
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
    this.creatures = new CreatureLayer(this.shared);
    this.group.add(this.hand.group, this.creatures.group, this.decals.group);
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
      // the hand's surface takes most of a second to polygonise: build it while the player is still looking around,
      // not on the first hover over the world
      const warm = (): void => { handMesh(); };
      const ric = (globalThis as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
      if (ric) setTimeout(() => ric(warm, { timeout: 6000 }), 3000); else setTimeout(warm, 4000);
      const vfx = new Vfx(this.shared, this.fx, 98304);
      const debris = new Debris(this.shared, this.fx);
      const bolts = new Lightning(this.fx);
      const disasters = new DisasterFx(this.fx, this.shared);
      const miracles = new MiracleFx(this.fx);
      const flights = new Flights(this.shared);
      const aurora = new Aurora(this.fx, this.shared);
      this.m = { vfx, debris, bolts, disasters, weather: new WeatherFx(), miracles, flights, aurora };
      this.group.add(vfx.group, debris.mesh, bolts.mesh, disasters.group, miracles.group, flights.group, aurora.group);
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
      if (dTick > 1e-6) fxDt = Math.min(realDt, dTick / 10 + 1e-3);
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
    S.tintSky.set(1, 1, 1); S.tintGround.set(1, 1, 1); S.fogDensity = 0; S.eclipse = 0;
    this.flashDecay.multiplyScalar(Math.exp(-dt * 10));
    S.flash.copy(this.flashDecay);
    this.sunWant.set(1, 1, 1);
    this.auroraBoost.boost = 0;
    const qk = Math.max(0.25, Math.min(2, (q.particleBudget || 20000) / 20000));
    const ctx: FxCtx = this.ctx ?? (this.ctx = {
      pv, now: 0, dt: 0, camBody: vis.camBody, vfx: M.vfx, decals: this.decals, debris: M.debris, bolts: M.bolts, screen: S,
      sunTint: this.sunWant, aurora: this.auroraBoost, q: 1, thunder: (p, k) => this.thunder(p, k), sunDirBody: new Vector3(), sunE: new Vector3(), ease: 0,
      landed: (e) => M.disasters.onEvent(e, this.ctx!),
    });
    ctx.pv = pv; ctx.now = this.clock; ctx.dt = Math.max(fxDt, 1e-4); ctx.camBody = vis.camBody; ctx.q = qk; ctx.camFwd = this.camFwd;
    ctx.ease = Math.max(ctx.dt, Math.min(0.1, Math.max(0, dt)));
    ctx.cloudBase = vis.hasClouds ? vis.cloudInner : pv.params.radius + 260;
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
    // ── the hand (real time) ──
    this.hand.update({
      pv, hand: view.hand, camBody: vis.camBody, camFwd: this.camFwd, camUp: this.camUp, dt, fxTime: time, fxDt,
      cursor: this.cursor, uiPose: this.uiPose, aiming: this.aiming, decals: this.decals, shared: this.shared,
    });
    // ── things in flight, creatures, disasters, weather, miracles ──
    M.flights.update(ctx, pv.projectiles ?? []);
    const pins = M.flights.creaturePins;
    this.creatures.update(view.creatures, pv, dt, this.clock, this.hand.visible && this.hand.heldKind === 'creature' ? this.hand.heldId : -1, this.hand.grip, pins);
    for (const f of this.creatures.falls) {
      M.vfx.emit({ sys: SYS.dust, x: f.x, y: f.y, z: f.z, size: f.size * 0.7, life: 2.6, count: 24, p0: f.size, p1: f.size * 0.7, burst: true, r: 0.44, g: 0.38, b: 0.3, power: 0.8 }, this.clock);
    }
    M.disasters.update(pv.disasters, ctx);
    M.weather.update(ctx);
    M.miracles.update(ctx);
    // people in the hand and in the air are drawn where the god layer says
    const crowds = vis.life.crowds;
    crowds.pinned.clear();
    if (this.hand.visible && this.hand.heldKind === 'agent' && this.hand.heldId >= 0) {
      crowds.pinned.set(this.hand.heldId, { x: this.hand.pinch.x, y: this.hand.pinch.y, z: this.hand.pinch.z, tumble: this.hand.swing, anim: AnimState.held });
    }
    for (const [id, p] of M.flights.agentPins) crowds.pinned.set(id, p);
    // ── lightning: ribbons, the light they throw on the ground ──
    M.bolts.update(this.clock, vis.camBody);
    M.bolts.forEachLive(this.clock, (gp, top, k, power) => {
      const d = decal(DECAL.light, [gp.x, gp.y, gp.z], 900);
      d.cr = 0.75; d.cg = 0.8; d.cb = 1; d.p0 = 900; d.p1 = 6e5 * k * power; d.p2 = Math.min(200, top.distanceTo(gp) * 0.4); d.p3 = 40;
      this.decals.add(d);
      const near = 1 - smooth(200, 2500, gp.distanceTo(vis.camBody));
      this.flashDecay.addScalar(0.002 * k * near);
    });
    // ── the aurora ──
    let wAur = 0;
    for (const w of pv.weather) { const a = AURORA_WEATHER.get(w.kind); if (a) wAur = Math.max(wAur, a * w.intensity); }
    if (pv.params.globalWeather && AURORA_WEATHER.has(pv.params.globalWeather)) wAur = Math.max(wAur, AURORA_WEATHER.get(pv.params.globalWeather)!);
    M.aurora.update(pv.params.radius, vis.atmo.thickness, pv.params.magnetism ?? 0, view.star.activity ?? 0, this.auroraBoost.boost + wAur * 2.5, vis.atmo.has, ctx.ease);
    // ── the eclipse darkens the land (the sun dims, and the exposure is held down so it reads as darkness); the
    // sun's tint eases ──
    if (S.eclipse > 0) this.sunWant.multiplyScalar(1 - 0.94 * Math.pow(S.eclipse, 1.6));
    const evWant = -2.6 * Math.pow(S.eclipse, 2);
    this.exposureEV += (evWant - this.exposureEV) * Math.min(1, ctx.ease * 1.5 + 0.02);
    this.sunTint.lerp(this.sunWant, Math.min(1, ctx.ease * 2 + 0.02));
    // ── the brush ──
    this.brushDecal(pv);
    M.vfx.update(this.clock, viewToBody(vis), cam.projectionMatrixInverse, vis.uniforms.uSunDirView.value as Vector3);
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
      case 'quake': this.addShake(p, Math.min(1.4, 0.15 * Math.max(0, (e.a ?? 5) - 3)), (e.b ?? 400) * 6 + 1500); break;
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
      case 'thrown': case 'landed': case 'splash':
        if (!M.flights.onEvent(e, ctx)) M.disasters.onEvent(e, ctx);
        break;
      case 'lightning': {
        if ((e.data as { ambient?: boolean } | undefined)?.ambient || !e.pos) break;
        const u = _v.set(e.pos[0], e.pos[1], e.pos[2]).normalize();
        const g = u.clone().multiplyScalar(groundHeight(pv.ground, u.x, u.y, u.z));
        const top = u.clone().multiplyScalar(vis.hasClouds ? vis.cloudInner : R + 260).addScaledVector(_w.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), 60);
        M.bolts.strike(top, g, this.clock, Math.min(1.5, Math.max(0.6, e.a ?? 1)), 7);
        M.vfx.emit({ sys: SYS.flash, x: top.x, y: top.y, z: top.z, size: 160, life: 0.5, count: 1, p1: 40, burst: true, r: 0.8, g: 0.85, b: 1 }, this.clock);
        this.decals.add(Object.assign(decal(DECAL.scorch, [g.x, g.y, g.z], 6), { p0: 4, p1: 0.6, p2: 2 }));
        break;
      }
      case 'miracle': {
        M.miracles.onEvent(e, ctx);
        // the hand casts it when it is near
        if (p && this.hand.visible && this.hand.pos.distanceTo(p) < Math.max(250, (e.a ?? 100) * 2.5)) this.hand.pulse('cast', this.lastReal);
        break;
      }
      case 'shield': M.miracles.onEvent(e, ctx); break;
    }
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
    this.creatures.swapDepth(depth);
    // every prop that casts (debris, things in the hand or in flight, a serpent's back) to its depth twin
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
    this.creatures.dispose();
    this.decals.dispose();
    this.screen.dispose();
    if (this.m) {
      this.m.vfx.dispose(); this.m.debris.dispose(); this.m.bolts.dispose(); this.m.disasters.dispose(); this.m.miracles.dispose();
      this.m.flights.dispose(); this.m.aurora.dispose();
    }
  }
}

/** the view → body rotation of the primary planet (one shared matrix, recomputed when asked) */
const _m3 = new Matrix3();
function viewToBody(vis: PlanetVisual): Matrix3 {
  return _m3.copy(vis.uniforms.uBodyToView.value as Matrix3).transpose();
}
