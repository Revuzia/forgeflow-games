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
//   renderFx     — over the composited image after the atmosphere: particles, funnels, plumes, bolts, domes, curtains,
//                  glows, fog and sky tints, soft-tested against the scene's linear depth
// Everything lives in the PRIMARY planet's body frame: the group is re-parented to that planet's group. Planet uniforms
// (sun, sky LUTs, shadows, moon) are proxied, so materials compiled once keep working when the primary world changes.
//
// The FX clock runs with the sim (it stops while the sim is paused, never runs faster than real time, like the life
// layer's animation clock): an explosion photographed while paused stays frozen mid-burst. `advance(s)` moves it for
// scripted captures.

import { Group, Quaternion, Vector2, Vector3, type IUniform, type PerspectiveCamera, type Scene, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import type { PlanetView, WorldView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import type { PlanetVisual } from '../planet/planetview.ts';
import type { PostPipeline } from '../post/pipeline.ts';
import type { Quality } from '../quality.ts';
import type { SimEvent } from '../../sim/types.ts';
import { AnimState } from '../../sim/types.ts';
import { HandVisual, type HandCursor, type UiHandPose } from '../hand.ts';
import { CreatureLayer } from '../life/creature.ts';
import { DECAL, DecalPass, decal } from './decals.ts';
import { FX_EXPOSURE, FX_LAYER, clamp01 } from './fxcommon.ts';

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

/** the categories' brush colours (src/ui/tools.ts CAT_COLOR) — a reticle for the destructive ones */
const DISASTER_TINT: [number, number, number] = [1.5, 0.35, 0.25];

const _q = new Quaternion();
const _qe = new Quaternion();
const _ax = new Vector3();
const _fwd = new Vector3();
const _up = new Vector3();

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
  brush: BrushIn | null = null;
  quality: Quality | null = null;
  private vis: PlanetVisual | null = null;
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

  constructor() {
    this.group.name = 'godfx';
    this.group.matrixAutoUpdate = false;
    this.fx = {
      uFxTime: { value: 0 }, tSceneDepth: { value: null }, uResolution: { value: new Vector2(1, 1) },
      tExposure: FX_EXPOSURE, uHasExposure: { value: 0 },
    };
    this.hand.bindFx(this.fx);
    this.creatures = new CreatureLayer(this.shared);
    this.group.add(this.hand.group, this.creatures.group);
    this.group.add(this.decals.group);
    // scripted captures: move the FX clock (window.__GENESIS_FX__.advance(2.5))
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
    if (!vis) { this.group.visible = false; return; }
    this.bindPrimary(vis);
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
    // ── events ──
    for (const e of view.pendingEvents) {
      if (this.seen.has(e)) continue;
      this.seen.add(e);
      if (e.planet !== undefined && e.planet !== pv.id) continue;
      this.onEvent(e, view);
    }
    // ── the hand ──
    this.hand.update({
      pv, hand: view.hand, camBody: vis.camBody, camFwd: this.camFwd, camUp: this.camUp, dt, fxTime: time, fxDt,
      cursor: this.cursor, uiPose: this.uiPose, aiming: this.aiming, decals: this.decals, shared: this.shared,
    });
    // ── the creatures (a creature in the hand dangles from its grip) ──
    this.creatures.update(view.creatures, pv, dt, this.clock, this.hand.visible && this.hand.heldKind === 'creature' ? this.hand.heldId : -1, this.hand.grip);
    // a person in the hand hangs between thumb and forefinger, swinging as the hand moves
    const crowds = vis.life.crowds;
    crowds.pinned.clear();
    if (this.hand.visible && this.hand.heldKind === 'agent' && this.hand.heldId >= 0) {
      const sw = this.hand.swing;
      crowds.pinned.set(this.hand.heldId, { x: this.hand.pinch.x, y: this.hand.pinch.y, z: this.hand.pinch.z, tumble: sw, anim: AnimState.held });
    }
    // ── the brush ──
    this.brushDecal(pv.id, pv.params.radius);
    // nothing tints the sun yet this frame
    this.sunTint.set(1, 1, 1);
  }

  private onEvent(e: SimEvent, _view: WorldView): void {
    const vis = this.vis!;
    const R = vis.pv.params.radius;
    const p = e.pos ? new Vector3(e.pos[0], e.pos[1], e.pos[2]).normalize().multiplyScalar(R) : null;
    switch (e.t) {
      case 'quake': this.addShake(p, Math.min(1.4, 0.15 * Math.max(0, (e.a ?? 5) - 3)), (e.b ?? 400) * 6 + 1500); break;
      case 'impact': this.addShake(p, Math.min(1.5, 0.004 * (e.a ?? 50)), (e.a ?? 50) * 30 + 1200); break;
      case 'eruption': this.addShake(p, 0.5, 4000); break;
      case 'miracle': {
        // the hand casts it when it is near
        const hp = this.hand.pos;
        if (p && this.hand.visible && hp.distanceTo(p) < Math.max(200, (e.a ?? 100) * 2)) this.hand.pulse('cast', this.lastReal);
        break;
      }
    }
  }

  private brushDecal(planet: number, _R: number): void {
    const b = this.brush;
    if (!b || b.planet !== planet) return;
    const vis = this.vis!;
    const pv = vis.pv;
    const u = b.dir;
    const l = Math.hypot(u[0], u[1], u[2]) || 1;
    const g = vis.pv.ground ? pvGround(pv, u[0] / l, u[1] / l, u[2] / l) : pv.params.radius;
    const c: [number, number, number] = [(u[0] / l) * g, (u[1] / l) * g, (u[2] / l) * g];
    const col = b.color ?? [1.2, 0.95, 0.55];
    const destructive = b.category === 'Disasters' || (Math.abs(col[0] - DISASTER_TINT[0]) < 0.05 && Math.abs(col[1] - DISASTER_TINT[1]) < 0.05);
    const weather = b.category === 'Sky' || b.mode === 'front';
    const d = decal(destructive ? DECAL.reticle : weather ? DECAL.paint : DECAL.brush, c, b.radius * 1.15 + 2);
    d.cr = col[0]; d.cg = col[1]; d.cb = col[2]; d.ca = 1;
    d.p0 = b.radius;
    if (destructive) { d.p1 = 0.55 + 0.35 * Math.sin(this.lastReal * 2); d.p2 = 0.8; d.p3 = 0.6; }
    else if (weather) { d.p1 = 1; }
    else { d.p1 = b.falloff ?? 0.5; d.p2 = b.strength ?? 0.5; }
    d.q0 = Math.max(4, b.radius * 0.5);
    // the brush's axis: toward the camera, so tick marks and hatching keep still on screen
    _fwd.copy(this.camFwd);
    d.ax = _fwd.x; d.ay = _fwd.y; d.az = _fwd.z;
    this.decals.add(d);
    void _up;
  }

  swapDepth(depth: boolean): void {
    this.hand.swapDepth(depth);
    this.creatures.swapDepth(depth);
  }

  /** ground decals and FX lights, into the HDR scene (after the opaque pass, before the water and the atmosphere) */
  renderDecals(r: WebGLRenderer, scene: Scene, cam: PerspectiveCamera, post: PostPipeline): void {
    const vis = this.vis;
    if (!vis || !this.group.visible) return;
    this.decals.draw(r, scene, cam, post.hdr, post.linDepth.texture, post.w, post.h, vis.uniforms.uBodyToView.value as never, vis.camBody, this.lastReal);
  }

  /** the FX over the composited image (after the atmosphere) */
  renderFx(r: WebGLRenderer, scene: Scene, cam: PerspectiveCamera, target: WebGLRenderTarget | null, post: PostPipeline): void {
    if (!this.vis || !this.group.visible) return;
    this.fx.tSceneDepth.value = post.linDepth.texture;
    (this.fx.uResolution.value as Vector2).set(post.w, post.h);
    this.fx.uHasExposure.value = FX_EXPOSURE.value ? 1 : 0;
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
  }
}

function pvGround(pv: PlanetView, x: number, y: number, z: number): number { return groundHeight(pv.ground, x, y, z); }
