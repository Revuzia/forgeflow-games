// VALE render — createRenderer (CONTRACT §9). The one presentation entry the boot and UI call.
//
//   createRenderer(canvas, catalog, settings, assetUrl, options?) → Renderer
//     setScene('menu' | MatchClient)  menu world, or a live match (the renderer only READS the client:
//                                     whoever owns the loop calls client.pump(dt) before render(dt))
//     resize(w?, h?)                  CSS pixels (default: the canvas' client size)
//     render(dt)                      one frame; dt in seconds (honours fpsCap, menu idle cap, hidden tab)
//     setQuality(video)               §9.4 ladder (Settings.video) + dynamic resolution (on unless the options or
//                                     video.dynamicResolution say false; perf PERF-M2: fed only match frames drawn at
//                                     the display rate, never the menu, its idle cap or an fpsCap below the display;
//                                     every match starts at the player's own scale; GPU readings longer than their
//                                     frame are dropped; a lowered scale probes back up — quality.ts)
//     setSettings(patch)              colourblind palette, camera lock / edge pan / pan speed,
//                                     reduce motion, screen shake, HUD scale, health bar ticks
//     pickGround(x, y)                CSS px → sim (x, y) on the walkable plane, or null
//     pickEntity(x, y)                CSS px → the visible entity under the cursor, or null
//     worldToScreen(x, y, h?)         sim (x, y, height) → CSS px
//     setAim(aim | null)              your own aim indicator (8 % fill, 60 % edge, dashed range ring)
//     setHover(id) · setTarget(id)    hover outline (HARM 2.5 px enemy/neutral, ally 1.5 px); minion bars when targeted
//     camera                          lock mode, scout, pointer (edge pan), key pan, zoom, focus
//     setStation(name) · setMenuView  menu camera moves (720 ms) and the plinth fighter
//     preload(setup, onProgress)      loading screen: every model, the sky and the grade of a match
//     viewState · onViewState(fn)     perf PERF-m4: 'lost' while the GPU context is gone, 'restoring' from its return
//                                     until the scene's programs are rebuilt, then 'ok' (the HUD's 'Restoring the
//                                     view' plate). On loss the GPU timer and dynamic resolution freeze; on restore the
//                                     timer is rebuilt on the new context, the generated textures (VFX atlas, sky
//                                     PMREM) are baked again and every program of the scene, the templates and the VFX
//                                     is compiled again in parallel before the view says 'ok'
//     stats() · dispose()
//
// Frame: sim views → actors (interpolated with MatchClient.alpha) → director (events → VFX,
// telegraphs) → camera → fog of war → sun fit → overlay buffers → EffectComposer (N8AO → bloom →
// Neutral tone map → LUT → vignette → overlay → SMAA).

import {
  Color, Frustum, Matrix4, NoToneMapping, PCFShadowMap, PerspectiveCamera, Plane, Raycaster, Scene, Sphere, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer, WebGLRenderTarget,
} from 'three';
import type { CatalogT, MapDefT } from '../contracts/catalog.ts';
import type { MatchClient, Settings } from '../contracts/session.ts';
import type { EntityId, EntityView, MatchSetup, SimEvent, WorldView } from '../contracts/sim.ts';
import { TICK_DT } from '../contracts/sim.ts';
import { Actor, accentHexFor, ANIM_FAR_M, HitReactions, ModelLibrary, outlineUniforms, UNIT_OUTLINE } from './actors.ts';
import { Assets, type AssetUrlFn } from './assets.ts';
import { CameraRig, type CameraMode } from './camera.ts';
import { Director, type EventVfxMap, type StatusVfxMap } from './director.ts';
import { FogOfWar } from './fog.ts';
import { Sun } from './lighting.ts';
import { MenuWorld } from './menu.ts';
import { BAR_KIND, BarLayer, type BarSpec, CC_PLATE, GLYPH, SHAPE } from './overlay/bars.ts';
import { OverlayContext, overlayUniforms } from './overlay/context.ts';
import { HoverOutline, hoverRimUniforms } from './overlay/hover.ts';
import { inkShadows } from './ink.ts';
import { lodReady, lodSwitch, shadowLods } from './lod.ts';
import { CrowdLayer } from './crowd.ts';
import { RING, RingLayer } from './overlay/rings.ts';
import { FLASH_RING_OVER_M, TELE_SHAPE, TelegraphLayer, type TeleSpec, flashContourDepth } from './overlay/telegraphs.ts';
import { FRAY_SEATS, INK, isFfaMode, Palette, type ColorblindMode } from './palette.ts';
import { PostChain } from './post.ts';
import { DynamicResolution, type FrameBound, GpuTimer, resolveQuality, type ResolvedQuality } from './quality.ts';
import { Sky } from './sky.ts';
import { buildTerrain, landmarkCull, loadTerrainLandmarks, loadTerrainProps, TERRAIN_TEX_ROLES, type TerrainTexRole, type TerrainBuild } from './terrain.ts';
import { SocketResolver } from './vfx/sockets.ts';
import { VfxSystem } from './vfx/system.ts';
import { StructureFx } from './structures.ts';
import { AmbientLayer, type AmbientStats } from './ambient.ts';
import { ATLAS_GRID } from './vfx/atlas.ts';
import { patchWorldMaterial, worldUniforms } from './world_material.ts';
import { FrameProfiler, type ProfileRoot, type RenderProfile } from './profile.ts';
import type { CullView } from './instance_cull.ts';

export interface RendererOptions {
  /** dev-only fallbacks (proof mannequin, debug geometry). Default: dev build AND ?dev=1 */
  dev?: boolean;
  /** URL of the proof mannequin GLB used for fighters without art in dev */
  devModelUrl?: string | null;
  /** world-event → VfxDef id map (events that carry no id); from data */
  eventVfx?: EventVfxMap;
  statusVfx?: StatusVfxMap;
  /** dynamic resolution (default on) */
  dynamicResolution?: boolean;
  /** keep the drawing buffer (screenshots / pixel read-back) */
  preserveDrawingBuffer?: boolean;
  /** silence missing-asset warnings */
  quiet?: boolean;
  /** draw UnitDef.art.instanced units (the Wicks) as the instanced crowd (default on; off = one model each) */
  crowd?: boolean;
  /** match fighters draw their face-locked LOD1 body (perf PERF-m5, lod.ts; default on; off = full bodies, A/B) */
  bodyLod?: boolean;
}

export interface AimSpec {
  shape: 'circle' | 'ring' | 'cone' | 'rect' | 'line';
  /** anchor in sim coordinates (circle centre, cone apex, rect/line origin) */
  x: number; y: number;
  /** aim direction (sim radians) for cone / rect / line */
  dir?: number;
  radius?: number; inner?: number; angleDeg?: number; length?: number; width?: number;
  /** dashed range ring around the caster */
  range?: number; casterX?: number; casterY?: number;
  heal?: boolean;
}

export interface RenderStats {
  fps: number; frameMs: number; calls: number; triangles: number; sceneCalls: number; sceneTriangles: number;
  programs: number; geometries: number; textures: number;
  renderScale: number; pixelRatio: number; tier: string; width: number; height: number;
  particles: number; vfx: number; actors: number; telegraphs: number; mode: 'menu' | 'match' | 'none';
  /** GPU time of the last measured frame (ms; null = no timer query, or dynamic resolution off) and what the
   *  dynamic-resolution controller last found limiting a slow second ('cpu' holds the scale) */
  gpuMs: number | null; bound: FrameBound;
  /** r12 M14 ambient life (ambient.ts): its CPU ms (EMA), particles / critters drawn; null outside a match */
  ambient?: AmbientStats | null;
  /** crowd units drawn this frame (crowd.ts; perf PERF-m5 reports) */
  crowd?: number;
}

/** perf PERF-m4: the 3D view's health (see the header) */
export type ViewState = 'ok' | 'lost' | 'restoring';

export interface CameraControl {
  setMode(m: CameraMode): void;
  readonly mode: CameraMode;
  scout(on: boolean): void;
  setPointer(x: number, y: number, inside: boolean): void;
  setKeyPan(x: number, z: number): void;
  zoomBy(steps: number): void;
  setZoom(distance: number): void;
  focusOn(x: number, y: number): void;
  centerOnSelf(): void;
  setSpectator(on: boolean): void;
}

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly camera: CameraControl;
  setScene(scene: 'menu' | MatchClient): void;
  resize(width?: number, height?: number): void;
  render(dt: number): void;
  setQuality(video: Settings['video']): void;
  setSettings(patch: Partial<Settings>): void;
  pickGround(x: number, y: number): { x: number; y: number } | null;
  pickEntity(x: number, y: number): EntityId | null;
  worldToScreen(x: number, y: number, height?: number): { x: number; y: number; visible: boolean };
  /** the match camera's focus point on the ground, in sim units and axes (x, y = world x, z) — the audio
   *  listener rides it (W3 AUD-9); the last match focus while the menu is up */
  listenerFocus(): { x: number; y: number };
  setAim(aim: AimSpec | null): void;
  setHover(id: EntityId | null): void;
  setTarget(id: EntityId | null): void;
  setStation(name: string): void;
  setMenuView(view: { screen: string; fighter?: string; skin?: string; mode?: string }): void;
  preload(setup: MatchSetup, onProgress?: (p: number) => void): Promise<void>;
  stats(): RenderStats;
  /** perf PERF-m4: 'lost' while the GPU context is gone, 'restoring' until its programs are rebuilt, then 'ok' */
  readonly viewState: ViewState;
  /** call `fn` on every viewState change; returns the unsubscribe */
  onViewState(fn: (s: ViewState) => void): () => void;
  /** harness seam: feed synthetic events (telegraph / VFX tests) */
  injectEvents(events: SimEvent[]): void;
  /** harness seam (VFX gallery): spawn a def at ground (x, y); with `to` a test mover travels there over
   *  `travel` s and path / ribbon layers follow it */
  vfxTest(id: string, x: number, y: number, o?: { to?: [number, number]; travel?: number; tier?: 0 | 1 | 2 | 3 | 4; dir?: number; scale?: number; color?: string; anchor?: 'origin' | 'target' | 'path' | 'ground'; phase?: 'main' | 'windup' }): boolean;
  /** harness seam (r12 B4 perf gate): draw calls and triangles of the next match frame, by group and pass */
  profile?(): Promise<RenderProfile>;
  /** the VFX ids the renderer knows */
  vfxIds(): string[];
  /** a def's duration, span and whether it rides a path (projectiles, dashes) */
  vfxInfo(id: string): { duration: number; span: number; path: boolean; layers: string[] } | null;
  dispose(): void;
}

const HARD_CC = new Set(['stun', 'root', 'airborne', 'taunt', 'fear', 'sleep', 'silence']);
/** perf PERF-m4: dynamic resolution waits this long after a restored view is back (first draws upload every texture) */
const RESTORE_DYN_HOLD_MS = 3000;
/** perf PERF-m4: the longest a restored view waits for its parallel compiles before it says 'ok' */
const RESTORE_MAX_WAIT_MS = 8000;
/** combat F5: which hard CC names itself on the plate when several hold a unit (most control lost first) */
const CC_PLATE_ORDER = ['airborne', 'stun', 'sleep', 'taunt', 'fear', 'root', 'silence'];
const _v = new Vector3();
const _v2 = new Vector3();
const _ndc = new Vector2();
const _frustum = new Frustum();
const _cullFrustum = new Frustum();
const _m4 = new Matrix4();
const _sphere = new Sphere();
const _rest = { self: new Color(), ally: new Color(), enemy: new Color(), neutral: new Color() };
/** a deferred fighter bar's resource colour when it shows none (the loop's temp colour is reused) */
const BLACK = new Color(0, 0, 0);
/** kinds that always carry the thin ink outline (M10); the rest outline on hover only */
const OUTLINED = new Set(['fighter', 'minion', 'monster', 'summon']);

function isDevBuild(): boolean {
  try { return !!import.meta.env?.DEV; } catch { return false; }
}

function devDefault(): boolean {
  let dev = false;
  try { dev = !!import.meta.env?.DEV; } catch { dev = false; }
  if (!dev) return false;
  try { return new URLSearchParams(location.search).get('dev') === '1'; } catch { return false; }
}

/** the body veil a unit's statuses ask for (actors.ts setVeil): 1 invisible, 2 untargetable, 0 none; a permanent
 *  status (a rule of the unit) never veils */
function veilOf(v: EntityView): 0 | 1 | 2 {
  let m: 0 | 1 | 2 = 0;
  for (const s of v.statuses) {
    if (!(s.remaining > 0) || !Number.isFinite(s.remaining)) continue;
    if (s.kind === 'invisible') return 1;
    if (s.kind === 'untargetable') m = 2;
  }
  return m;
}

class ValeRenderer implements Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGLRenderer;
  private readonly catalog: CatalogT;
  private settings: Settings;
  private readonly assets: Assets;
  private readonly lib: ModelLibrary;
  private readonly opts: RendererOptions;
  private q: ResolvedQuality;
  private readonly dyn = new DynamicResolution();
  /** harness seam (perf PERF-m5, _harness/probe_lod.mjs): the shadow LOD switch (lod.ts) */
  readonly lodSwitch = lodSwitch;
  /** harness seam (W5a refix, _harness/probe_landmark_cull.mjs): the landmarks' and casters' box cull (terrain.ts) */
  readonly landmarkCull = landmarkCull;
  /** rebuilt on a restored context (its queries and extension belonged to the lost one) */
  private gpuTimer: GpuTimer;
  // perf PERF-m4: GPU context loss
  private view: ViewState = 'ok';
  private readonly viewFns = new Set<(s: ViewState) => void>();
  /** dynamic resolution samples nothing before this time (performance.now ms): the restore's recompiles are not the GPU's speed */
  private dynHoldUntil = 0;
  private restoreGen = 0;
  // match world
  private readonly scene = new Scene();
  private readonly rig = new CameraRig();
  private readonly sun = new Sun();
  private readonly sky: Sky;
  private readonly fog = new FogOfWar();
  private terrain: TerrainBuild | null = null;
  private mapScene: import('three').Object3D | null = null;
  private readonly vfx: VfxSystem;
  private readonly director: Director;
  private readonly reactions: HitReactions;
  /** r12 M9: structure damage states, collapse + ruin, occlusion fade, protected shell (structures.ts) */
  private readonly structs: StructureFx;
  /** r12 M14: T0 ambient effects, critters and swaying props from map.art.ambient (ambient.ts) */
  private ambient: AmbientLayer | null = null;
  private ambientOn = true;
  private readonly ambientPending: import('three').Object3D[] = [];
  private warmAmbient(o: import('three').Object3D): void {
    this.asIfComposer(() => void this.gl.compileAsync(o, this.rig.camera, this.scene).catch(() => undefined));
  }
  private readonly actors = new Map<number, Actor>();
  private client: MatchClient | null = null;
  private offEvents: (() => void) | null = null;
  private readonly pending: SimEvent[] = [];
  private lastTick = -1;
  private palette: Palette;
  private map: MapDefT | null = null;
  private matchGen = 0;
  // menu
  private readonly menu: MenuWorld;
  private mode: 'menu' | 'match' | 'none' = 'none';
  // overlay
  private readonly overlay = new OverlayContext();
  private readonly bars = new BarLayer();
  private readonly rings = new RingLayer();
  private readonly teles = new TelegraphLayer();
  private readonly hoverRim = new HoverOutline(INK.ink0);
  /** instanced, GPU-skinned units (UnitDef.art.instanced: the Wicks; crowd.ts) */
  private readonly crowd = new CrowdLayer(outlineUniforms.uOutlineRes, { rimUniforms: hoverRimUniforms });
  private aim: AimSpec | null = null;
  private hover: EntityId | null = null;
  private target: EntityId | null = null;
  // post
  private readonly post: PostChain;
  private cssW = 1;
  private cssH = 1;
  private time = 0;
  private lastFrameAt = 0;
  /** the display's frame interval (ms, EMA of render() calls): a cap below it is a cap, not a slow GPU */
  private displayMs = 1000 / 60;
  private fpsEma = 0;
  private frameMs = 0;
  private sceneCalls = 0;
  private sceneTris = 0;
  private skipAcc = 0;
  private readonly resources = new Map<string, { color: Color; model: string }>();
  private readonly tmpColor = new Color();
  /** combat F5: the CC plate each fighter shows and when it appeared (the 70 ms fade-in restarts on a new kind) */
  private readonly ccShown = new Map<number, { kind: string; t: number }>();
  /** ground offset of a shadow per metre of caster height (−sun.xz / sun.y, ≤ 3 m/m); the actor cull reaches over it */
  private readonly shadowDir = new Vector2();
  private readonly raycaster = new Raycaster();
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0);
  private hudScale = 1;
  private ticks = true;
  readonly camera: CameraControl;

  constructor(canvas: HTMLCanvasElement, catalog: CatalogT, settings: Settings, assetUrl: AssetUrlFn, opts: RendererOptions) {
    this.canvas = canvas;
    this.catalog = catalog;
    this.settings = settings;
    this.opts = opts;
    this.gl = new WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, depth: true, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserveDrawingBuffer });
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = NoToneMapping;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFShadowMap;
    this.gl.info.autoReset = false;
    this.gpuTimer = new GpuTimer(this.gl.getContext() as WebGL2RenderingContext);
    // perf PERF-m4: registered after three's own handlers (which keep the context restorable and rebuild its state first)
    canvas.addEventListener('webglcontextlost', this.onContextLost, false);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored, false);
    // production: no synchronous shader-log read on a program's first use (a GPU round trip, 4-40 ms measured
    // under load on the first hover or wave); dev builds keep three's error checks
    this.gl.debug.checkShaderErrors = isDevBuild();
    this.assets = new Assets(this.gl, assetUrl);
    this.assets.quiet = !!opts.quiet;
    const dev = opts.dev ?? devDefault();
    const devModelUrl = opts.devModelUrl ?? (dev ? new URL('art/out/_proof/_proof_mannequin.glb', document.baseURI).href : null);
    this.lib = new ModelLibrary(catalog, this.assets, { dev, devModelUrl, crowd: opts.crowd !== false });
    this.lib.onReady = (root, crowd, again) => {
      this.warmTemplate(root, !crowd, again);
      if (crowd && this.envReady) this.asIfComposer(() => this.crowd.warm(crowd, this.gl, this.rig.camera, this.scene, this.warmScene, again));
    };
    this.sky = new Sky(this.gl);
    this.palette = new Palette(catalog, null, -1, settings.access.colorblind as ColorblindMode);
    for (const r of catalog.resources) this.resources.set(r.id, { color: new Color().setStyle(r.color), model: r.model });
    this.scene.name = 'vale_match';
    this.scene.add(this.sun.light, this.sun.target);
    // VFX sockets (weapon, top, base, ground …) resolve on the animated actors (vfx/sockets.ts)
    const sockets = new SocketResolver(catalog, (id) => this.actors.get(id), () => this.time);
    this.vfx = new VfxSystem(catalog.vfx, { entityPos: (id, out) => this.bodyPos(id, out), socketPos: (id, name, out) => sockets.socketPos(id, name, out) });
    this.vfx.setCamera(this.rig.camera);
    this.scene.add(this.vfx.group);
    this.scene.add(this.crowd.group);
    this.reactions = new HitReactions(catalog);
    this.structs = new StructureFx({
      vfx: this.vfx,
      tint: (v) => this.palette.get(accentHexFor(this.palette, v)).clone(),
      compile: (root) => {
        if (!this.envReady) return false;
        this.asIfComposer(() => void this.gl.compileAsync(root, this.rig.camera, this.scene).catch(() => undefined));
        return true;
      },
    });
    this.vfx.onFeel = (e) => { if (e.shake > 0) this.rig.shake(e.shake * 4, 90 + e.shake * 60); this.reactions.feel(e, this.actors, this.time); };
    this.director = new Director(catalog, this.vfx, {
      view: () => this.client?.view ?? null,
      palette: () => this.palette,
      bodyPos: (id, out) => this.bodyPos(id, out),
      visibleAt: (x, y) => this.visibleAt(x, y),
      entityVisible: (e) => this.entityVisible(e),
      skinTint: (e) => this.skinTint(e),
      now: () => this.time,
      shake: (px, ms) => this.rig.shake(px, ms),
      plateAt: (out) => {
        const m = this.map;
        if (!m) return false;
        const at = ((m.art as { terrain?: { plate?: { at?: unknown } } } | undefined)?.terrain?.plate?.at);
        const ok = Array.isArray(at) && typeof at[0] === 'number' && typeof at[1] === 'number';
        out.set(ok ? (at[0] as number) : m.size[0] / 2, 0.05, ok ? (at[1] as number) : m.size[1] / 2);
        return true;
      },
      viewFocus: (out) => { out.set(this.rig.focus.x, 0.05, this.rig.focus.z); return true; },
    });
    this.director.eventVfx = opts.eventVfx ?? {};
    this.director.statusVfx = opts.statusVfx ?? {};
    this.menu = new MenuWorld(this.gl);
    this.overlay.teleScene.add(this.teles.mesh);
    this.overlay.scene.add(this.rings.mesh, this.bars.mesh, this.bars.labels);
    this.post = new PostChain(this.gl, this.scene, this.rig.camera, (r, target, depth) => this.overlay.draw(r, target, depth, (cam) => this.drawHover(r, cam)),
      (r, target, depth, cam) => { this.vfx.setCamera(cam as import('three').PerspectiveCamera); this.vfx.draw(r, target, depth); });
    this.q = resolveQuality(settings.video);
    const rig = this.rig;
    this.camera = {
      setMode: (m) => rig.setMode(m),
      get mode() { return rig.mode; },
      scout: (on) => rig.scout(on),
      setPointer: (x, y, inside) => rig.setPointer(x, y, inside),
      setKeyPan: (x, z) => rig.setKeyPan(x, z),
      zoomBy: (s) => rig.zoomBy(s),
      setZoom: (d) => rig.setZoom(d),
      focusOn: (x, y) => rig.focusOn(x, y),
      centerOnSelf: () => rig.centerOnSelf(),
      setSpectator: (on) => { rig.spectator = on; },
    };
    this.applySettings(settings);
    this.setQuality(settings.video);
    this.resize();
  }

  // ── settings / quality ─────────────────────────────────────────────────────────────────────────
  setSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch } as Settings;
    this.applySettings(this.settings);
    if (patch.video) this.setQuality(patch.video);
  }

  private applySettings(s: Settings): void {
    this.palette.setColorblind(s.access.colorblind as ColorblindMode);
    for (const a of this.actors.values()) a.setAccentColor('', this.tmpColor.set(0, 0, 0));
    this.rig.edgePan = s.controls.edgePan;
    this.rig.panSpeed = s.controls.panSpeed;
    this.rig.reduceMotion = s.access.reduceMotion;
    this.rig.shakeScale = s.access.reduceMotion ? 0 : s.access.screenShake;
    if (s.controls.cameraLock && this.rig.mode !== 'locked') this.rig.setMode('locked');
    if (!s.controls.cameraLock && this.rig.mode === 'locked') this.rig.setMode('semi');
    this.menu.reduceMotion = s.access.reduceMotion;
    this.reactions.reduceMotion = s.access.reduceMotion;
    // the screen envelopes (vfx/screen.ts): halved exposure peak, no dip or breath, a 120 ms death-grade cut
    this.vfx.reduceMotion = s.access.reduceMotion;
    this.hudScale = Math.max(0.75, Math.min(1.25, s.access.hudScale || 1));
    this.ticks = s.gameplay.healthBarTicks;
  }

  setQuality(video: Settings['video']): void {
    this.q = resolveQuality(video);
    // dynamic resolution: the caller's option (harness benches turn it off) and the player's Settings › Video choice
    // (`video.dynamicResolution`, on unless false)
    this.dyn.enabled = this.opts.dynamicResolution !== false && (video as { dynamicResolution?: boolean }).dynamicResolution !== false;
    this.dyn.configure(this.q.renderScale, this.q.fpsCap);
    this.sun.setQuality(this.gl, this.q.shadows);
    this.menu.sun.setQuality(this.gl, this.q.shadows);
    this.post.setQuality({ ao: this.q.ao, bloom: this.q.bloom, aa: this.q.aa, tier: this.q.tier });
    this.vfx.budget = this.q.particleBudget;
    this.vfx.density = this.q.particleDensity;
    this.vfx.setLightCount(this.q.flashLights);
    this.terrain?.setScatter(this.q.scatter, this.q.ao > 0);
    this.ambientOn = video.ambientEffects !== false;
    this.ambient?.configure(this.ambientOn, this.q.tier);
    this.menu.setScatter(this.q.scatter);
    this.applySize();
  }

  resize(width?: number, height?: number): void {
    const w = Math.max(1, Math.round(width ?? (this.canvas.clientWidth || this.canvas.width || 1)));
    const h = Math.max(1, Math.round(height ?? (this.canvas.clientHeight || this.canvas.height || 1)));
    this.cssW = w; this.cssH = h;
    outlineUniforms.uOutlineRes.value.set(w, h);
    this.rig.setViewport(w, h);
    this.menu.setAspect(w / h);
    this.applySize();
  }

  private aoEased = false;
  private applySize(): void {
    const dpr = Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, this.q.maxDpr);
    const pr = Math.max(0.25, dpr * this.dyn.scale);
    this.gl.setPixelRatio(pr);
    // r12 B4: AO eases off while dynamic resolution holds the scale down, with hysteresis (on at ≤ 0.85, off again at
    // ≥ 0.95: a scale settling on a 0.05 step never flips it every second)
    const sc = this.dyn.scale;
    if (sc < 0.88 - 1e-3) this.aoEased = true; else if (sc > 0.95 - 1e-3) this.aoEased = false;
    this.post.setAoLow(this.aoEased);
    this.post.setSize(this.cssW, this.cssH);
  }

  // ── scenes ─────────────────────────────────────────────────────────────────────────────────────
  setScene(scene: 'menu' | MatchClient): void {
    if (scene === 'menu') {
      this.teardownMatch();
      lodSwitch.outline = lodSwitch.body = false;                          // perf PERF-m5: the showcase keeps its full body and hull
      this.menu.build(this.catalog, this.assets);
      this.mode = 'menu';
      this.post.setScene(this.menu.scene, this.menu.camera);
      this.overlay.camera = this.menu.camera;
      this.assets.lut(this.menu.lut).then((l) => { if (this.mode === 'menu') this.post.setLUT(l); });
      return;
    }
    this.teardownMatch();
    this.setupMatch(scene);
  }

  private setupMatch(client: MatchClient): void {
    const gen = ++this.matchGen;
    this.client = client;
    this.mode = 'match';
    lodSwitch.outline = true;                                              // perf PERF-m5: lod.ts
    lodSwitch.body = this.opts.bodyLod !== false;
    // perf PERF-M2: every match starts at the player's own render scale (nothing a menu or the last match did carries over)
    this.dyn.configure(this.q.renderScale, this.q.fpsCap);
    this.lastFrameAt = 0;
    this.applySize();
    const view = client.view;
    const map = this.catalog.maps.find((m) => m.id === (view.map || client.setup.map)) ?? this.catalog.maps[0];
    this.map = map ?? null;
    this.palette = new Palette(this.catalog, client.setup, client.you, this.settings.access.colorblind as ColorblindMode);
    this.post.setScene(this.scene, this.rig.camera);
    this.overlay.camera = this.rig.camera;
    if (!map) return;
    // camera per the map (the bible's numbers are the map's numbers)
    const cam = map.camera;
    this.rig.camera.fov = cam.fovDeg;
    this.rig.camera.updateProjectionMatrix();
    this.rig.setBounds(map.size[0], map.size[1]);
    worldUniforms.valeBounds.value.set(0, 0, map.size[0], map.size[1]);
    const tr = map.art.terrain as Record<string, unknown>;
    const edge = (tr.edgeFog ?? null) as { color?: string; startOutsideM?: number; fullOutsideM?: number } | null;
    worldUniforms.valeEdgeColor.value.setStyle(edge?.color ?? map.art.lighting.fogColor);
    worldUniforms.valeEdgeRange.value.set(edge?.startOutsideM ?? 4, edge?.fullOutsideM ?? 18);
    // light + sky
    const L = map.art.lighting;
    this.sun.configure({ sunDir: L.sunDir, sunColor: L.sunColor, sunIntensity: L.sunIntensity });
    { const [sx, sy, sz] = L.sunDir; const k = 1 / Math.max(0.05, Math.abs(sy)); this.shadowDir.set(-sx * k, -sz * k); if (this.shadowDir.length() > 3) this.shadowDir.setLength(3); }
    const sc = new Color().setStyle(L.sunColor);
    this.sky.makeFallback(L.sunDir, sc, new Color(0.16, 0.25, 0.42), new Color().setStyle(L.fogColor).multiplyScalar(0.9));
    // r12 B4: the match draws no sky box (never on screen at the lane camera): one program and a full-screen draw less
    this.sky.solid = new Color().setStyle(L.fogColor);
    this.sky.apply(this.scene, null, L.ambient);
    // the environment map is part of every lit program's key: once this match's sky is final, warm every built
    // template against it (and every template built later, as it is built)
    this.envReady = false;
    this.assets.hdr(map.art.sky).then((t) => {
      if (gen !== this.matchGen) return;
      if (t) this.sky.apply(this.scene, t, L.ambient);
      this.envReady = true;
      for (const o of this.ambientPending.splice(0)) this.warmAmbient(o);
      this.lib.warmAll();
      this.structs.warmAll(this.actors.values());
      // perf PERF-m5: the terrain's own programs too (the Fallen Shaft's water was first compiled when the camera first
      // passed it, 14-18 minutes in), and every caster already in the scene gets its shadow LOD now, not over the sweeps
      if (this.terrain) { const tg = this.terrain.group; this.asIfComposer(() => void this.gl.compileAsync(tg, this.rig.camera, this.scene).catch(() => undefined)); }
      shadowLods(this.scene);
    });
    this.assets.lut(map.art.lut).then((l) => { if (gen === this.matchGen) this.post.setLUT(l); });
    // world: procedural terrain now; the Blender scene replaces it when it exists
    this.terrain = buildTerrain(map);
    this.terrain.setScatter(this.q.scatter, this.q.ao > 0);
    this.ambient = new AmbientLayer(map, this.catalog.vfx, this.vfx.textures.atlas, ATLAS_GRID, (r) => this.assets.model(r), this.terrain.groundAt);
    // its programs (skinned critters, swaying cloth, the particle shader) compile as each part lands, not on first sight
    this.ambient.onPart = (o) => { if (gen === this.matchGen) { if (this.envReady) this.warmAmbient(o); else this.ambientPending.push(o); } };
    this.ambient.configure(this.ambientOn, this.q.tier);
    this.scene.add(this.ambient.group);
    this.scene.add(this.terrain.group);
    inkShadows(this.terrain.group);
    this.loadTerrainTextures(map, gen);
    void loadTerrainProps(map, (r) => this.assets.model(r)).catch(() => null).then((p) => { if (gen === this.matchGen && this.terrain) { this.terrain.setProps(p ?? {}); inkShadows(this.terrain.group); shadowLods(this.terrain.group); } });
    void loadTerrainLandmarks(map, (r) => this.assets.model(r), this.terrain.groundAt).then((ls) => { if (gen === this.matchGen && this.terrain) for (const o of ls) { inkShadows(o); shadowLods(o); this.terrain.group.add(o); } });
    this.assets.model(map.art.scene).then((m) => {
      if (gen !== this.matchGen || !m?.renderable) return;
      const root = m.gltf.scene;
      root.traverse((o) => {
        const mesh = o as import('three').Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true; mesh.receiveShadow = true;
        for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) patchWorldMaterial(mat);
      });
      if (this.terrain) { this.scene.remove(this.terrain.group); this.terrain.dispose(); this.terrain = null; }
      this.mapScene = root;
      inkShadows(root);
      this.scene.add(root);
    });
    // fog of war for the local team (spectators: off)
    this.fog.enabled = this.palette.viewer.team >= 0;
    // camera starts on your fighter
    const me = view.players.find((p) => p.player === client.you);
    const e = me ? view.entity(me.entity) : undefined;
    if (e) this.rig.focusOn(e.x, e.y); else this.rig.focusOn(map.size[0] / 2, map.size[1] / 2);
    this.rig.spectator = this.palette.viewer.team < 0;
    this.rig.setZoom(cam.distance);
    this.offEvents = client.onEvents((evs) => { for (const ev of evs) this.pending.push(ev); });
    this.lastTick = -1;
  }

  private teardownMatch(): void {
    this.matchGen++;
    this.offEvents?.();
    this.offEvents = null;
    this.pending.length = 0;
    for (const a of this.actors.values()) a.dispose();
    this.crowd.clear();
    this.actors.clear();
    this.director.clear();
    this.structs.clear();
    this.ccShown.clear();
    if (this.ambient) { this.scene.remove(this.ambient.group); this.ambient.dispose(); this.ambient = null; }
    this.ambientPending.length = 0;
    this.vfx.clear();
    if (this.terrain) { this.scene.remove(this.terrain.group); this.terrain.dispose(); this.terrain = null; }
    if (this.mapScene) { this.scene.remove(this.mapScene); this.mapScene = null; }
    this.fog.dispose();
    this.gpuTimer.clear();
    this.envReady = false;
    this.client = null;
    this.map = null;
    this.mode = 'none';
  }

  /** the map's painted tiling textures (map.art.terrain.textures: role → asset ref) into the terrain */
  private loadTerrainTextures(map: MapDefT, gen: number): void {
    const refs = ((map.art.terrain ?? {}) as { textures?: Record<string, string> }).textures ?? {};
    const roles = TERRAIN_TEX_ROLES.filter((r) => typeof refs[r] === 'string');
    if (!roles.length) return;
    void Promise.all(roles.map((r) => this.assets.texture(refs[r]).then((t) => [r, t] as const))).then((pairs) => {
      if (gen !== this.matchGen || !this.terrain) return;
      const set: Partial<Record<TerrainTexRole, import('three').Texture>> = {};
      for (const [r, t] of pairs) if (t) set[r] = t;
      this.terrain.setTextures(set);
    });
  }

  // ── VFX test movers (gallery): ids <= -1000 travel a straight line ─────────────────────────────
  private readonly movers = new Map<number, { x0: number; y0: number; x1: number; y1: number; t0: number; dur: number }>();
  private moverSeq = -1000;

  vfxTest(id: string, x: number, y: number, o: { to?: [number, number]; travel?: number; tier?: 0 | 1 | 2 | 3 | 4; dir?: number; scale?: number; color?: string; anchor?: 'origin' | 'target' | 'path' | 'ground'; phase?: 'main' | 'windup' } = {}): boolean {
    const team = new Color().setStyle(o.color ?? '#3F9CFF');
    const to = o.to ?? [x + Math.cos(o.dir ?? 0) * 6, y + Math.sin(o.dir ?? 0) * 6];
    let follow: number | undefined;
    if (o.travel && o.travel > 0) {
      follow = this.moverSeq--;
      this.movers.set(follow, { x0: x, y0: y, x1: to[0], y1: to[1], t0: this.time, dur: o.travel });
    }
    return this.vfx.spawn(id, {
      tier: o.tier ?? 3, team, element: team, ally: false, origin: new Vector3(x, 1.1, y), target: new Vector3(to[0], 1.1, to[1]),
      ground: new Vector3(x, 0, y), scale: o.scale ?? 2.5, dir: o.dir ?? Math.atan2(to[1] - y, to[0] - x), follow, anchor: o.anchor ?? (follow !== undefined ? 'path' : 'origin'),
      phase: o.phase,
    });
  }

  vfxIds(): string[] { return this.vfx.ids; }

  vfxInfo(id: string): { duration: number; span: number; path: boolean; layers: string[] } | null {
    const d = this.vfx.def(id);
    return d ? { duration: d.duration, span: d.span, path: d.layers.some((l) => l.at === 'path' || l.type === 'ribbon'), layers: d.layers.map((l) => l.type) } : null;
  }

  // ── helpers ────────────────────────────────────────────────────────────────────────────────────
  private bodyPos(id: number, out: Vector3): boolean {
    if (id <= -1000) {
      const m = this.movers.get(id);
      if (!m) return false;
      const t = (this.time - m.t0) / m.dur;
      if (t > 1) { this.movers.delete(id); return false; }
      out.set(m.x0 + (m.x1 - m.x0) * t, 1.1, m.y0 + (m.y1 - m.y0) * t);
      return true;
    }
    const a = this.actors.get(id);
    if (a && a.leaving < 0) { out.set(a.x, a.h + Math.min(1.3, a.artHeight * 0.55), a.y); return true; }
    const e = this.client?.view.entity(id);
    if (!e || (!e.alive && e.kind !== 'fighter')) return false;
    // projectiles / zones / not-yet-built actors: interpolate along the velocity
    const k = (this.client?.alpha ?? 0) * TICK_DT;
    const h = e.kind === 'projectile' ? 1.05 + e.height : 1 + e.height;
    out.set(e.x - e.vx * (TICK_DT - k), h, e.y - e.vy * (TICK_DT - k));
    return true;
  }

  private visibleAt(x: number, y: number): boolean {
    const team = this.palette.viewer.team;
    if (team < 0 || !this.client) return true;
    try {
      const g = this.client.view.visionGrid(team);
      const i = Math.floor(x / g.cell), j = Math.floor(y / g.cell);
      if (i < 0 || j < 0 || i >= g.width || j >= g.height) return false;
      return g.data[j * g.width + i] > 0;
    } catch { return true; }
  }

  /** r12 M11: the thickets react to the units the VIEWER SEES (a.visible: the sim's visibleMask, so vision, brush
   *  and invisibility already applied): the grass never moves for a unit the viewer could not see. Your fighter
   *  and allied fighters also fade the blades round them (terrain_brush.ts). */
  private feedBrush(d: number): void {
    const b = this.terrain?.brush;
    if (!b) return;
    b.begin();
    for (const a of this.actors.values()) {
      const v = a.view;
      if (!v || !a.visible || !v.alive || a.leaving >= 0) continue;
      if (v.kind !== 'fighter' && v.kind !== 'minion' && v.kind !== 'monster' && v.kind !== 'summon') continue;
      const rel = v.kind === 'fighter' ? this.palette.relation(v.team, v.owner, true) : 'neutral';
      b.push(a.id, a.x, a.y, v.radius, rel === 'self' ? 2 : rel === 'ally' ? 1 : 0);
    }
    b.end(d);
  }

  /** r12 M14: the critters flee only from units the VIEWER SEES (a.visible: the sim's visibleMask), like the brush */
  private readonly threats: { x: number; y: number; r: number }[] = [];
  private feedAmbient(d: number): void {
    const amb = this.ambient;
    if (!amb) return;
    const T = this.threats;
    T.length = 0;
    for (const a of this.actors.values()) {
      const v = a.view;
      if (!v || !a.visible || !v.alive || a.leaving >= 0) continue;
      if (v.kind !== 'fighter' && v.kind !== 'minion' && v.kind !== 'monster' && v.kind !== 'summon') continue;
      T.push({ x: a.x, y: a.y, r: v.radius });
    }
    amb.update(this.time, d, this.rig.camera, T);
  }

  private entityVisible(e: EntityView): boolean {
    const team = this.palette.viewer.team;
    if (team < 0) return true;
    if (e.team === team) return true;
    return ((e.visibleMask >>> team) & 1) === 1;
  }

  private skinTint(e: EntityView): Color | null {
    if (!e.skin) return null;
    const s = this.catalog.skins.find((x) => x.id === e.skin);
    return s?.vfxTint ? new Color().setStyle(s.vfxTint) : null;
  }

  // ── per-frame match update ─────────────────────────────────────────────────────────────────────
  private syncActors(view: WorldView): void {
    const tick = view.tick;
    const newTick = tick !== this.lastTick;
    this.lastTick = tick;
    const seen = new Set<number>();
    for (const e of view.entities) {
      if (e.kind === 'projectile' || e.kind === 'zone') continue;
      seen.add(e.id);
      let a = this.actors.get(e.id);
      if (!a) {
        a = new Actor(e);
        this.actors.set(e.id, a);
        this.scene.add(a.root);
        const actor = a;
        if (e.kind === 'fighter') {
          const def = this.lib.fighter(e.def);
          if (def) {
            a.configureFighter(def);
            this.lib.fighterTemplate(e.def, e.skin).then((t) => { actor.attach(t, def.art.scale, def.art.accentMaterial); });
          }
        } else {
          const def = this.lib.unit(e.def);
          if (def) {
            a.configureUnit(def);
            this.lib.unitTemplate(e.def, this.palette.ffa ? null : e.team).then((t) => {
              actor.attach(t, def.art.scale, 'accent');
              if (def.kind === 'structure' && actor.model) this.structs.attach(actor, def);
            });
          }
        }
        a.pushTick(e, tick);
      } else if (newTick || a.view !== e) a.pushTick(e, tick);
    }
    for (const [id, a] of this.actors) {
      if (seen.has(id)) continue;
      if (a.leaving < 0) a.leaving = 0;
      // r12 M9: a structure never sinks away: its ruin stays until its entity is replaced (a gate's respawn)
      if (a.kind === 'structure') { this.structs.forget(a); a.dispose(); this.actors.delete(id); continue; }
      if (a.leaving > 0.6) { a.dispose(); this.actors.delete(id); }
    }
  }

  private updateActors(dt: number, alpha: number): void {
    const hoverOn = this.hover;
    const p = this.palette;
    // animation LOD (presentation only): clips hold outside the view frustum (+ 2 m), distant wicks tick at 15 Hz
    const cam = this.rig.camera;
    _frustum.setFromProjectionMatrix(_m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
    const fx = this.rig.focus.x, fz = this.rig.focus.z;
    // outline styles (tokens hud.unitOutline): rest = ink at 60 % tinted 18 % (display space) toward the
    // relationship, in the scene; hover = a clean rim in the overlay pass, HARM 2.5 px (enemy, neutral) or ally 1.5 px
    const O = UNIT_OUTLINE;
    const ink = p.get(O.rest.color);
    for (const r of ['self', 'ally', 'enemy', 'neutral'] as const) {
      _rest[r].copy(ink).convertLinearToSRGB().lerp(this.tmpColor.copy(p.relationColor(r)).convertLinearToSRGB(), O.rest.relationTint).convertSRGBToLinear();
    }
    const harm = p.relationColor('enemy'), allyC = p.relationColor('ally');
    const sdx = this.shadowDir.x, sdz = this.shadowDir.y, sdl = Math.hypot(sdx, sdz);
    for (const a of this.actors.values()) {
      const v = a.view;
      if (!v) continue;
      const vis = this.entityVisible(v) && (v.alive || v.kind === 'fighter' || a.leaving >= 0 || v.state === 'dead');
      a.visible = vis;
      // out of the viewer's vision: not drawn, no matrix work, and any reaction ends now (actors.ts hidden())
      if (!vis) { a.root.visible = false; a.culled = true; a.hidden(); continue; }
      const hex = accentHexFor(p, v);
      a.setAccentColor(hex, p.get(hex));
      // the body (+ 2 m for swings and leaps) and the shadow it throws (half its height along the sun's
      // ground offset, covering the whole shadow) must miss the frustum for the actor to be culled
      const H = a.artHeight;
      _sphere.center.set(a.x + sdx * H * 0.5, a.h + H * 0.5, a.y + sdz * H * 0.5);
      _sphere.radius = H * 0.5 + a.radius + 2 + sdl * H * 0.5;
      const lod = !_frustum.intersectsSphere(_sphere) ? 2 : v.kind === 'minion' && Math.hypot(a.x - fx, a.y - fz) > ANIM_FAR_M ? 1 : 0;
      a.culled = lod === 2 && a.leaving < 0;
      a.root.visible = !a.culled;
      a.update(dt, alpha, lod);
      if (a.model) {
        const rel = p.relation(v.team, v.owner, v.kind === 'fighter');
        const live = v.alive && a.leaving < 0 && lod !== 2;      // off-screen hulls cost vertex work for nothing
        const hov = live && hoverOn === a.id && rel !== 'self';
        a.setHover(hov ? (rel === 'ally' ? O.hoverAlly.px : O.hoverEnemy.px) : 0, hov ? (rel === 'ally' ? allyC : harm) : null);
        if (live && OUTLINED.has(v.kind)) a.setOutline(O.rest.px, _rest[rel], O.rest.alpha);
        else a.hideOutline();
        // M2 veils on the body (actors.ts): unseen (its allies, or a reveal, still see it) · untargetable
        a.setVeil(v.alive && v.kind !== 'structure' ? veilOf(v) : 0);
        // env F4: a fighter with cover between it and the camera shows its occluded parts as a silhouette in its
        // readability colour (the cover gate is terrain.coverToward; the depth test picks the pixels)
        if (v.kind === 'fighter') {
          const cp = cam.position;
          a.setXray(live && a.veil !== 1 && !!this.terrain?.coverToward(a.x, a.y, cp.x, cp.z, cp.y - a.h), p.get(hex));
        }
      }
    }
  }

  private buildOverlay(view: WorldView): void {
    const p = this.palette;
    const bars = this.bars, rings = this.rings;
    // 1 reference px (1080p) in BUFFER px: fixed screen size, 720p floor 0.8, × HUD scale
    const bufH = this.gl.getDrawingBufferSize(_ndc).y;
    const pxScale = Math.max(0.8, this.cssH / 1080) * this.hudScale * (bufH / this.cssH);
    bars.begin(pxScale);
    rings.begin();
    const you = p.viewer.you;
    const players = new Map(view.players.map((pl) => [pl.player, pl]));
    const meEntity = you >= 0 ? players.get(you)?.entity : undefined;
    const me = meEntity !== undefined ? view.entity(meEntity) : undefined;
    // r12 M9: fighter bars draw after every structure / unit bar (one instanced draw, in push order), your own last,
    // so a fighter behind a structure keeps its bar on top of the structure's
    const lateBars: BarSpec[] = [];
    let myBar: BarSpec | null = null;
    for (const a of this.actors.values()) {
      const v = a.view;
      if (!v || !a.visible || a.leaving >= 0) continue;
      const isF = v.kind === 'fighter';
      const rel = p.relation(v.team, v.owner, isF);
      const hex = p.unitHex(v.team, v.owner, isF || v.kind === 'summon');
      const col = p.get(hex);
      // damage trail (150 ms hold, 450 ms shrink)
      const total = Math.max(v.maxHp, v.hp + v.shield, 1);
      const hpF = Math.max(0, v.hp) / total;
      if (hpF < a.lastHpFrac - 1e-4) {
        if (a.trail < a.lastHpFrac) a.trail = a.lastHpFrac;
        if (this.time >= a.trailHoldUntil + 0.45 || a.trail <= hpF) a.trailFrom = a.trail;
        a.trailFrom = Math.max(a.trailFrom, a.trail);
        a.trailHoldUntil = this.time + 0.15;
      }
      a.lastHpFrac = hpF;
      if (this.time > a.trailHoldUntil) a.trail = a.trailFrom + (hpF - a.trailFrom) * Math.min(1, (this.time - a.trailHoldUntil) / 0.45);
      if (a.trail < hpF) { a.trail = hpF; a.trailFrom = hpF; }
      const alive = v.alive && v.state !== 'dead';
      // ── rings
      if (alive) {
        if (isF) {
          const code = rel === 'self' ? RING.self : rel === 'ally' ? RING.ally : rel === 'enemy' ? RING.enemy : RING.neutral;
          rings.push(a.x, a.y, v.radius + 0.22, a.facing, code, col, 1, a.id === this.hover ? 1 : 0);
        } else if (v.kind === 'monster') {
          const aggro = v.state !== 'idle' && v.state !== 'move' ? true : v.hp < v.maxHp - 1e-3;
          if (aggro || a.id === this.hover) rings.push(a.x, a.y, v.radius + 0.18, a.facing, RING.neutral, col, 0.9, a.id === this.hover ? 1 : 0);
        } else if (a.id === this.hover || a.id === this.target) {
          const code = rel === 'ally' ? RING.ally : rel === 'enemy' ? RING.enemy : RING.neutral;
          rings.push(a.x, a.y, v.radius + 0.15, a.facing, code, col, 0.9, 1);
        }
        // structures: the attack-range ring while your fighter is within 4 m of it
        if (v.kind === 'structure' && me && me.alive && rel === 'enemy') {
          const ud = this.lib.unit(v.def);
          const range = (ud?.attack?.range ?? 0) + v.radius;
          if (range > 0 && Math.hypot(me.x - v.x, me.y - v.y) < range + me.radius + 4) rings.push(a.x, a.y, range, 0, RING.range, col, 0.85, 0);
        }
      }
      // ── bars
      if (!alive) { this.ccShown.delete(v.id); continue; }
      let kind: number = BAR_KIND.fighter;
      let show = true;
      // r12 M7: enemy Wicks always carry their bar (last-hitting reads at a glance); allies when hurt or targeted
      if (v.kind === 'minion' || v.kind === 'summon') { kind = BAR_KIND.minion; show = rel === 'enemy' || v.hp < v.maxHp - 1e-3 || a.id === this.hover || a.id === this.target; }
      else if (v.kind === 'structure') { kind = BAR_KIND.structure; }
      else if (v.kind === 'monster') { kind = BAR_KIND.monster; show = v.hp < v.maxHp - 1e-3 || v.state !== 'idle' || a.id === this.hover; }
      else if (v.kind === 'ward' || v.kind === 'pickup') show = false;
      if (!show) continue;
      const shape = rel === 'self' ? SHAPE.self : rel === 'ally' ? SHAPE.ally : rel === 'enemy' ? SHAPE.enemy : SHAPE.neutral;
      let resColor = this.tmpColor.set(0, 0, 0), showRes = false, hatch = false;
      let level = 0, nameSlot = -1, seatLine: Color | null = null, keyline: 0 | 1 | 2 = 0;
      if (isF) {
        const fd = this.lib.fighter(v.def);
        const r = fd ? this.resources.get(fd.resource) : undefined;
        if (r && r.model !== 'none' && v.maxRes > 0) { resColor = r.color; showRes = true; hatch = r.model === 'heat'; }
        level = v.level;
        const pl = players.get(v.owner);
        if (pl) nameSlot = bars.nameSlot(pl.name);
        if (p.ffa) {
          if (rel === 'self') seatLine = p.get(p.seatHexOf(v.owner));
          else {
            const seat = FRAY_SEATS.find((s) => s.color.toLowerCase() === hex.toLowerCase());
            keyline = seat?.keyline === 'chalk' ? 1 : seat?.keyline === 'ink' ? 2 : 0;
          }
        }
      }
      let cc = 0;
      let ccKind = '', ccRank = 99, ccLeft = 0;
      for (const s of v.statuses) {
        if (!HARD_CC.has(s.kind) || !(s.duration > 0)) continue;
        cc = Math.max(cc, s.remaining / s.duration);
        const r = CC_PLATE_ORDER.indexOf(s.kind);
        if (r >= 0 && (r < ccRank || (r === ccRank && s.remaining > ccLeft))) { ccRank = r; ccKind = s.kind; ccLeft = s.remaining; }
      }
      // combat F5: the highest-priority hard CC names itself above the bar (fighters), fading in over 70 ms
      let ccPlate = -1, ccAlpha = 0;
      if (isF && ccKind) {
        const was = this.ccShown.get(v.id);
        if (!was || was.kind !== ccKind) this.ccShown.set(v.id, { kind: ccKind, t: this.time });
        const since = this.time - (this.ccShown.get(v.id)?.t ?? this.time);
        ccPlate = bars.ccSlot(ccKind, this.catalog.strings[`status.${ccKind}.name`] ?? ccKind.replace(/_/g, ' '));
        ccAlpha = Math.min(1, Math.max(0, since / (CC_PLATE.fadeInMs / 1000)));
      } else if (isF) this.ccShown.delete(v.id);
      const spec: BarSpec = {
        x: a.x, y: a.h + a.barHeight, z: a.y, kind, shape,
        hp: hpF, trail: a.trail, shieldEnd: Math.min(1, (Math.max(0, v.hp) + v.shield) / total), total: this.ticks ? total : 1e9,
        res: v.maxRes > 0 ? v.res / v.maxRes : 0, showRes, resHatch: hatch, cc,
        color: col, resColor, glyph: kind === BAR_KIND.structure ? (v.team === 0 ? GLYPH.spire : GLYPH.dome) : isF ? GLYPH.chip : GLYPH.none,
        keyline, seatLine, alpha: 1, nameSlot, level,
        // lost HP flashes for ~4 frames before the trail's 150 ms hold (trailHoldUntil = hit + 0.15)
        flash: a.trailHoldUntil > 0 ? Math.max(0, 1 - (this.time - (a.trailHoldUntil - 0.15)) / 0.066) : 0,
        ccPlate, ccAlpha,
      };
      if (!isF) bars.push(spec);
      else {
        if (spec.resColor === this.tmpColor) spec.resColor = BLACK;
        if (rel === 'self') myBar = spec; else lateBars.push(spec);
      }
    }
    for (const b of lateBars) bars.push(b);
    if (myBar) bars.push(myBar);
    bars.end();
    rings.end();
    this.buildTelegraphs();
  }

  private buildTelegraphs(): void {
    const p = this.palette;
    const t = this.teles;
    t.begin();
    const now = this.time;
    const spec: TeleSpec = { x: 0, z: 0, dir: 0, shape: 0, radius: 1, inner: 0, halfAngle: 0.5, length: 1, width: 1, color: this.tmpColor, fill: 0, edge: 0, edgePx: 2, sweep: 1, dashed: false, tick: null, ringFlash: 0, ringDepth: 0 };
    for (const tg of this.director.telegraphs) {
      if (now < tg.start) continue;
      const rel = p.relation(tg.team, tg.owner, true);
      const s = tg.shape;
      spec.x = tg.x; spec.z = tg.y; spec.dir = tg.dir;
      spec.shape = s.kind === 'circle' ? TELE_SHAPE.circle : s.kind === 'ring' ? TELE_SHAPE.ring : s.kind === 'cone' ? TELE_SHAPE.cone : TELE_SHAPE.rect;
      spec.radius = s.radius ?? 1; spec.inner = s.inner ?? 0; spec.halfAngle = (s.angle ?? Math.PI / 3) / 2;
      spec.length = s.length ?? 1; spec.width = s.width ?? 1;
      spec.dashed = false; spec.ringFlash = 0;
      const dur = Math.max(1e-3, tg.land - tg.start);
      const landing = tg.zone < 0 && tg.land > tg.start;
      const prog = landing ? Math.min(1, (now - tg.start) / dur) : 1;
      const flash = now >= tg.land && tg.zone < 0;
      spec.sweep = landing && !flash ? prog : 1;
      spec.tick = p.ffa && tg.owner >= 0 && rel !== 'self' ? p.get(p.seatHexOf(tg.owner)) : null;
      if (rel === 'enemy' || (p.viewer.team < 0)) {
        // spectators see the caster's side colour with the enemy treatment
        spec.color = p.get(p.viewer.team < 0 ? p.unitHex(tg.team, tg.owner, true) : p.relationHex('enemy'));
        spec.fill = flash ? 0.4 : tg.zone >= 0 ? 0.16 : 0.16 + 0.14 * prog;
        spec.edge = 0.9; spec.edgePx = 3;
        // combat m-3: a landing wider than 4 m flashes its edge band and an inner contour; the fill stays ≤ 22 %
        const ext = spec.shape === TELE_SHAPE.rect ? Math.max(spec.length, spec.width) * 0.5 : spec.radius;
        if (flash && ext > FLASH_RING_OVER_M) {
          spec.fill = 0.2; spec.ringFlash = 0.5;
          spec.ringDepth = flashContourDepth(spec.shape, spec.radius, spec.inner, spec.halfAngle, spec.width);
        }
      } else if (rel === 'neutral') {
        spec.color = p.relationColor('neutral'); spec.fill = 0.12; spec.edge = 0.8; spec.edgePx = 2;
      } else {
        spec.color = tg.heal ? p.get('#63D88B') : p.relationColor(rel === 'self' ? 'self' : 'ally');
        spec.fill = rel === 'self' ? 0.08 : 0; spec.edge = tg.heal ? 0.5 : rel === 'self' ? 0.6 : 0.45; spec.edgePx = 2;
        if (flash) spec.fill = Math.max(spec.fill, 0.12);
      }
      t.push(spec);
    }
    // your own aim
    const aim = this.aim;
    if (aim) {
      const self = p.relationColor('self');
      if (aim.range && aim.range > 0) {
        t.push({ ...spec, x: aim.casterX ?? aim.x, z: aim.casterY ?? aim.y, dir: 0, shape: TELE_SHAPE.circle, radius: aim.range, inner: 0, color: self, fill: 0, edge: 0.45, edgePx: 2, sweep: 1, dashed: true, tick: null, key: 0.45, ringFlash: 0 });
      }
      const sh = aim.shape === 'circle' ? TELE_SHAPE.circle : aim.shape === 'ring' ? TELE_SHAPE.ring : aim.shape === 'cone' ? TELE_SHAPE.cone : TELE_SHAPE.rect;
      t.push({
        ...spec, x: aim.x, z: aim.y, dir: aim.dir ?? 0, shape: sh, radius: aim.radius ?? 1, inner: aim.inner ?? 0,
        halfAngle: ((aim.angleDeg ?? 60) * Math.PI) / 360, length: aim.length ?? 6, width: aim.shape === 'line' ? Math.min(aim.width ?? 0.4, 0.6) : aim.width ?? 1.2,
        // tokens hud.telegraph.self: it must read on pale lane stone (Noonwhite edge + a stronger ink keyline)
        color: aim.heal ? p.get('#63D88B') : self, fill: 0.12, edge: 0.9, edgePx: 2.5, sweep: 1, dashed: false, tick: null, key: 0.55, ringFlash: 0,
      });
    }
    t.end();
  }

  // ── frame ──────────────────────────────────────────────────────────────────────────────────────
  render(dt: number): void {
    if (typeof document !== 'undefined' && document.hidden) return;
    const d = Math.max(0, Math.min(0.25, Number.isFinite(dt) ? dt : 0));
    // the display's own frame interval (every call is one display frame, drawn or skipped by a cap)
    if (d > 0.002 && d < 0.1) this.displayMs = this.displayMs > 0 ? this.displayMs * 0.95 + d * 50 : d * 1000;
    // fps cap (and the menu's 30 fps idle cap after 4 s)
    const cap = this.mode === 'menu' && this.menu.idle > 4 ? 30 : this.q.fpsCap;
    if (cap > 0) {
      this.skipAcc += d;
      if (this.skipAcc < 1 / cap - 0.002) return;
      this.skipAcc = 0;
    }
    const t0 = performance.now();
    if (this.lastFrameAt > 0) {
      const iv = t0 - this.lastFrameAt;
      this.fpsEma = this.fpsEma > 0 ? this.fpsEma * 0.9 + (1000 / Math.max(1, iv)) * 0.1 : 1000 / Math.max(1, iv);
      // the previous frame's own CPU time and (when timed) its GPU time tell a CPU-late frame from a GPU-late one.
      // perf PERF-M2: only match frames the renderer wanted at the display rate feed it (never the menu and its idle
      // cap, never an fpsCap below the display rate: those intervals are the cap's, not the GPU's)
      const capped = cap > 0 && 1000 / cap > this.displayMs * 1.1;
      // perf PERF-m4: frozen while the context is gone and while a restored one recompiles (the scale it had stays)
      const held = this.view !== 'ok' || t0 < this.dynHoldUntil;
      if (this.mode === 'match' && this.dyn.enabled && !capped) {
        const gpu = this.gpuTimer.poll();
        if (held) this.dyn.reset();
        else if (this.dyn.sample(iv, this.frameMs, gpu)) this.applySize();
      } else this.dyn.reset();
    }
    this.lastFrameAt = t0;
    this.time += d;
    worldUniforms.valeTime.value = this.time;
    overlayUniforms.uTime.value = this.time;

    if (this.mode === 'match' && this.client) this.frameMatch(d);
    else if (this.mode === 'menu') { this.menu.update(d); this.vfx.update(d); }

    const info = this.gl.info;
    info.reset();
    const timed = this.dyn.enabled && this.mode === 'match' && this.view !== 'lost';
    if (timed) this.gpuTimer.begin();
    const prof = this.profileWaiters.length > 0 && this.mode === 'match';
    if (prof) this.profiler.begin(this.gl, this.profileRoots());
    this.post.render(d);
    if (prof) { const r = this.profiler.end(this.gl)!; for (const w of this.profileWaiters.splice(0)) w(r); }
    if (timed) this.gpuTimer.end();
    this.sceneCalls = info.render.calls;
    this.sceneTris = info.render.triangles;
    this.frameMs = performance.now() - t0;
  }

  private frameMatch(d: number): void {
    const client = this.client!;
    const view = client.view;
    const alpha = client.alpha;
    this.syncActors(view);
    // events → VFX / telegraphs
    if (this.pending.length) { const evs = this.pending.splice(0, this.pending.length); this.reactions.handle(evs, this.actors, this.time); this.director.handle(evs); this.structs.handle(evs); }
    this.director.update(view);
    this.updateActors(d, alpha);
    // the crowd's instances: every live, visible, on-screen crowd unit, after its envelopes ran
    this.crowd.begin();
    for (const a of this.actors.values()) if (a.crowdBake && a.model && a.root.visible) this.crowd.push(a);
    this.crowd.end();
    // camera follows your fighter
    const me = view.players.find((p) => p.player === client.you);
    const a = me ? this.actors.get(me.entity) : undefined;
    if (a && a.view?.alive) this.rig.setSelf(a.x, a.y); else this.rig.setSelf(null, null);
    this.rig.update(d);
    // structures after the camera moved: the occlusion fade looks for your fighter, the hovered and the targeted unit
    this.structs.update(d, this.time, view, this.rig.camera, [me ? me.entity : -1, this.hover ?? -1, this.target ?? -1], this.actors);
    // fog of war
    this.fog.update(view, this.palette.viewer.team, d);
    this.sun.fit(this.rig.camera);
    this.cullScatter();
    this.feedBrush(d);
    this.feedAmbient(d);
    this.terrain?.update(this.time);
    this.vfx.update(d);
    this.buildOverlay(view);
    // r12 B4 programs: every shadow caster draws its depth through the ink programs (ink.ts); the places that add
    // casters assign them, this sweep (two a second) catches any other
    // perf PERF-m5: every new shadow caster also gets its shadow LOD (lod.ts; at most 4 ms of simplifying a sweep)
    if (--this.shadowSweep <= 0) { this.shadowSweep = 30; inkShadows(this.scene); shadowLods(this.scene, 4); }
  }
  private shadowSweep = 0;

  /** r12 B4: the terrain's instanced scatter keeps only the cells this frame's camera can show or shadow into */
  private readonly cullView: CullView = { frustum: _cullFrustum, fx: 0, fz: 0, sdx: 0, sdz: 0, version: 0 };
  /** the view of the last version (view-projection, shadow reach): a still camera keeps the version, and the terrain
   *  skips its cull */
  private readonly cullKey = new Float32Array(18);
  private cullScatter(): void {
    if (!this.terrain) return;
    const cam = this.rig.camera, v = this.cullView;
    _m4.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const sh = this.sun.shadowsOn;
    const sdx = sh ? this.shadowDir.x : 0, sdz = sh ? this.shadowDir.y : 0;
    const K = this.cullKey, e = _m4.elements;
    let same = v.version > 0 && K[16] === Math.fround(sdx) && K[17] === Math.fround(sdz);
    for (let i = 0; same && i < 16; i++) same = K[i] === Math.fround(e[i]);
    if (!same) {
      for (let i = 0; i < 16; i++) K[i] = e[i];
      K[16] = sdx; K[17] = sdz;
      _cullFrustum.setFromProjectionMatrix(_m4);
      v.fx = this.rig.focus.x; v.fz = this.rig.focus.z;
      v.sdx = sdx; v.sdz = sdz;
      v.version++;
    }
    this.terrain.cull(v);
  }

  // ── picking ────────────────────────────────────────────────────────────────────────────────────
  private activeCamera(): PerspectiveCamera { return this.mode === 'menu' ? this.menu.camera : this.rig.camera; }

  pickGround(x: number, y: number): { x: number; y: number } | null {
    const cam = this.activeCamera();
    _ndc.set((x / this.cssW) * 2 - 1, -(y / this.cssH) * 2 + 1);
    this.raycaster.setFromCamera(_ndc, cam);
    const hit = this.raycaster.ray.intersectPlane(this.ground, _v);
    if (!hit) return null;
    return { x: hit.x, y: hit.z };
  }

  pickEntity(x: number, y: number): EntityId | null {
    if (this.mode !== 'match') return null;
    const cam = this.rig.camera;
    let best: EntityId | null = null, bestScore = Infinity;
    for (const a of this.actors.values()) {
      const v = a.view;
      if (!v || !a.visible || !v.alive || !v.targetable || a.leaving >= 0) continue;
      if (v.kind === 'pickup') continue;
      _v.set(a.x, a.h, a.y).project(cam);
      _v2.set(a.x, a.h + a.artHeight, a.y).project(cam);
      if (_v.z > 1) continue;
      const fx = (_v.x * 0.5 + 0.5) * this.cssW, fy = (-_v.y * 0.5 + 0.5) * this.cssH;
      const hy = (-_v2.y * 0.5 + 0.5) * this.cssH;
      const ppm = Math.abs(fy - hy) / Math.max(0.3, a.artHeight);
      const rx = Math.max(16, (v.radius + 0.15) * ppm);
      const top = Math.min(hy, fy - 24) - 6, bottom = fy + rx * 0.6;
      if (y < top || y > bottom) continue;
      const dx = Math.abs(x - fx);
      if (dx > rx) continue;
      // nearest to the cursor wins; fighters before units at equal distance
      const score = dx + Math.abs(y - (fy + hy) / 2) * 0.3 + (v.kind === 'fighter' ? 0 : 8);
      if (score < bestScore) { bestScore = score; best = a.id; }
    }
    return best;
  }

  worldToScreen(x: number, y: number, height = 0): { x: number; y: number; visible: boolean } {
    const cam = this.activeCamera();
    _v.set(x, height, y).project(cam);
    const sx = (_v.x * 0.5 + 0.5) * this.cssW, sy = (-_v.y * 0.5 + 0.5) * this.cssH;
    return { x: sx, y: sy, visible: _v.z < 1 && _v.z > -1 && sx >= 0 && sy >= 0 && sx <= this.cssW && sy <= this.cssH };
  }

  /** the hovered unit's rim (overlay pass, after the grade; overlay/hover.ts) */
  /**
   * A template was built: upload its textures now and compile its programs in parallel
   * (KHR_parallel_shader_compile), so the frame a unit first walks into view does not stall on a 2048²
   * upload (≈ 0.1-0.9 s measured) or a synchronous shader link (r12 B4 hitches).
   */
  private warmed = new WeakSet<import('three').Object3D>();
  private warmTemplate(root: import('three').Object3D, programs = true, again = false): void {
    const gl = this.gl;
    // perf PERF-m5: the template's shadow LODs, built once and shared by every clone (a no-op until lodReady)
    shadowLods(root);
    if (!again) {
      if (this.warmed.has(root)) return;
      this.warmed.add(root);
      this.uploadTextures(root);
    }
    // programs only against the match's final environment (it is part of every lit program's key: a variant
    // compiled before the sky lands would never be drawn); a crowd template never draws as a model of its own
    // (its programs are the crowd's: CrowdLayer.warm)
    if (programs && this.envReady) this.asIfComposer(() => void gl.compileAsync(root, this.rig.camera, this.scene).catch(() => undefined));
  }
  /** the match's sky environment is final (setupMatch): template programs can be warmed against it */
  private envReady = false;

  private uploadTextures(root: import('three').Object3D): void {
    const gl = this.gl;
    root.traverse((o) => {
      const m = o as import('three').Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        for (const v of Object.values(mat)) if (v && (v as import('three').Texture).isTexture) gl.initTexture(v as import('three').Texture);
      }
    });
  }

  /**
   * Run a warm-up compile as if drawing into the composer's buffers: a program's key includes the output colour
   * space, which is the working space for any render target and sRGB for the canvas, so a compile with the canvas
   * bound would build a variant the frame never uses.
   */
  private warmRT: WebGLRenderTarget | null = null;
  private readonly warmScene = new Scene();
  private asIfComposer(fn: () => void): void {
    this.warmRT ??= new WebGLRenderTarget(1, 1);
    const prev = this.gl.getRenderTarget();
    this.gl.setRenderTarget(this.warmRT);
    try { fn(); } finally { this.gl.setRenderTarget(prev); }
  }

  // (neither the hover rim nor the veils need a warm-up of their own: the hover mask and rim, a veil's depth prepass and
  //  every outline, flash and shadow draw with the ink program of the actor's vertex path (ink.ts), which its outline
  //  compiles at attach, and a veiled body draws with its own program: actors.ts setVeil)

  private drawHover(r: WebGLRenderer, cam: import('three').Camera): void {
    if (this.mode !== 'match' || this.hover === null) return;
    const a = this.actors.get(this.hover);
    const t = a?.crowdBake ? (a.root.visible ? this.crowd.hoverTarget(a, a.hoverWidth, a.hoverTint) : null) : a?.hoverTarget();
    if (t) this.hoverRim.draw(r, cam, r.getRenderTarget(), t);
  }

  // ── GPU context loss (perf PERF-m4) ───────────────────────────────────────────────────────────
  get viewState(): ViewState { return this.view; }
  onViewState(fn: (s: ViewState) => void): () => void { this.viewFns.add(fn); return () => { this.viewFns.delete(fn); }; }
  private setView(s: ViewState): void {
    if (this.view === s) return;
    this.view = s;
    for (const fn of [...this.viewFns]) { try { fn(s); } catch { /* a listener's failure is its own */ } }
  }

  private readonly onContextLost = (): void => {
    this.restoreGen++;
    // the timer's queries died with the context: never poll them again (a restored context calls them foreign objects)
    this.gpuTimer.abandon();
    this.dyn.reset();
    this.setView('lost');
  };

  private readonly onContextRestored = (): void => {
    const gen = ++this.restoreGen;
    this.gpuTimer = new GpuTimer(this.gl.getContext() as WebGL2RenderingContext);
    this.dyn.reset();
    this.lastFrameAt = 0;
    this.setView('restoring');
    // three rebuilt its state on the new context (its handler ran first); geometry and image textures upload again
    // on their next use, but what was drawn on the GPU must be drawn again: the VFX atlas and noise here, the sky's
    // PMREM in Sky's own handler
    this.vfx.textures.ready = false;
    this.vfx.textures.generate(this.gl);
    // every program again, compiled in parallel before the first frames need them: the scene (terrain, props, actors,
    // ambient), the unit templates, the structures and the VFX shapes
    this.warmed = new WeakSet();
    const jobs: Promise<unknown>[] = [];
    this.asIfComposer(() => {
      const cam = this.rig.camera;
      if (this.mode === 'match') jobs.push(this.gl.compileAsync(this.scene, cam).catch(() => undefined));
      this.vfx.prewarm(this.gl, cam);
    });
    if (this.mode === 'match' && this.envReady) { this.lib.warmAll(); this.structs.warmAll(this.actors.values()); }
    const done = (): void => {
      if (gen !== this.restoreGen) return;
      this.dynHoldUntil = performance.now() + RESTORE_DYN_HOLD_MS;
      this.setView('ok');
    };
    // a driver that never reports the parallel compile done still gets its view back after the cap
    void Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, RESTORE_MAX_WAIT_MS))]).then(done);
  };

  listenerFocus(): { x: number; y: number } { return { x: this.rig.focus.x, y: this.rig.focus.z }; }

  setAim(aim: AimSpec | null): void { this.aim = aim; }
  setHover(id: EntityId | null): void { this.hover = id; }
  setTarget(id: EntityId | null): void { this.target = id; }

  // ── menu ───────────────────────────────────────────────────────────────────────────────────────
  setStation(name: string): void { this.menu.setStation(name); }
  setMenuView(view: { screen: string; fighter?: string; skin?: string; mode?: string }): void {
    this.menu.build(this.catalog, this.assets);
    this.menu.setStation(view.screen);
    this.menu.setShowcase(view.fighter ? this.lib : null, view.fighter ?? null, view.skin ?? null);
  }

  async preload(setup: MatchSetup, onProgress?: (p: number) => void): Promise<void> {
    const map = this.catalog.maps.find((m) => m.id === setup.map);
    const units = new Set<string>();
    if (map) { for (const s of map.structures) units.add(s.unit); for (const c of map.camps) for (const u of c.units) units.add(u.unit); for (const pk of map.pickups) units.add(pk.unit); }
    const mode = this.catalog.modes.find((m) => m.id === setup.mode);
    for (const w of mode?.rules.minionWaves?.composition ?? []) units.add(w.unit);
    // per-team unit models (art.teamModels): every side on the field, none in FFA modes
    const teams = isFfaMode(mode) ? null : [...setup.seats.map((s) => s.team), ...(map?.structures.map((s) => s.team) ?? [])];
    const refs = this.lib.refsFor(setup.seats.map((s) => ({ fighter: s.fighter, skin: s.skin })), units, teams);
    const jobs: Promise<unknown>[] = refs.map((r) => this.assets.model(r));
    jobs.push(lodReady);                                                   // perf PERF-m5: the simplifier's WASM
    if (map) { jobs.push(this.assets.hdr(map.art.sky), this.assets.lut(map.art.lut), this.assets.model(map.art.scene)); for (const r of AmbientLayer.refs(map)) jobs.push(this.assets.model(r)); }
    for (const s of setup.seats) jobs.push(this.lib.fighterTemplate(s.fighter, s.skin));
    // unit templates too (per side): their textures upload and their programs compile behind the loading screen
    for (const u of units) for (const t of teams ? [...new Set(teams)] : [null]) jobs.push(this.lib.unitTemplate(u, t));
    let done = 0;
    onProgress?.(0);
    await Promise.all(jobs.map((j) => j.then(() => { done++; onProgress?.(done / jobs.length); })));
    // the VFX programs (every mesh shape, ribbons, decals, distortion) compile here, not on the first ultimate
    this.asIfComposer(() => this.vfx.prewarm(this.gl, this.rig.camera));
    onProgress?.(1);
  }

  stats(): RenderStats {
    const info = this.gl.info;
    const size = this.gl.getDrawingBufferSize(new Vector2());
    return {
      fps: Math.round(this.fpsEma * 10) / 10, frameMs: Math.round(this.frameMs * 100) / 100,
      calls: info.render.calls, triangles: info.render.triangles, sceneCalls: this.sceneCalls, sceneTriangles: this.sceneTris,
      programs: info.programs?.length ?? 0, geometries: info.memory.geometries, textures: info.memory.textures,
      renderScale: this.dyn.scale, pixelRatio: this.gl.getPixelRatio(), tier: this.q.tier, width: size.x, height: size.y,
      particles: this.vfx.particleCount, vfx: this.vfx.instanceCount, actors: this.actors.size, telegraphs: this.teles.size, mode: this.mode,
      gpuMs: this.dyn.enabled ? this.gpuTimer.last : null, bound: this.dyn.bound,
      ambient: this.ambient?.stats() ?? null,
      crowd: this.crowd.instances,
    };
  }

  injectEvents(events: SimEvent[]): void { for (const e of events) this.pending.push(e); }

  // ── profile (harness seam, profile.ts) ─────────────────────────────────────────────────────────
  private readonly profiler = new FrameProfiler();
  private readonly profileWaiters: ((p: RenderProfile) => void)[] = [];
  profile(): Promise<RenderProfile> { return new Promise((res) => this.profileWaiters.push(res)); }

  /** the frame's drawables by group; the whole scene first (`other`), every specific root after it (its hooks win) */
  private profileRoots(): ProfileRoot[] {
    const under = (o: import('three').Object3D, top: import('three').Object3D): import('three').Object3D => {
      let c = o;
      while (c.parent && c.parent !== top) c = c.parent;
      return c;
    };
    const SCATTER = 'vale_scatter';
    const scatterOf = (n: string): string => (n.startsWith('vale_trees') || n === 'vale_trunks' || n === 'vale_canopies' ? 'canopy' : n.startsWith('vale_clutter') ? 'clutter' : 'rocks');
    const roots: ProfileRoot[] = [{ root: this.scene, group: 'other' }];
    if (this.terrain) {
      roots.push({
        root: this.terrain.group,
        group: (o, top) => (top.name === 'vale_needlegrass' ? 'grass' : top.name === SCATTER ? scatterOf(under(o, top).name) : top.name.startsWith('vale_') ? 'terrain' : 'landmarks'),
        part: (o, top) => (top.name === SCATTER ? under(o, top).name : top.name || top.type),
      });
    }
    if (this.mapScene) roots.push({ root: this.mapScene, group: 'terrain' });
    if (this.ambient) roots.push({ root: this.ambient.group, group: 'ambient' });
    // an actor's draws by kind and role (body, its ink copies), so a perf report shows which pass grows
    const role = (o: import('three').Object3D): string => {
      const n = o.name;
      return o.userData.valeXray ? '.xray' : n === 'vale_flash' || n === 'crowd_flash' ? '.flash' : n === 'vale_outline' || n === 'crowd_outline' ? '.outline'
        : n === 'vale_veil_depth' ? '.veil' : n === 'crowd_part_accent' ? '.accent' : '';
    };
    roots.push({ root: this.crowd.group, group: 'actors', part: (o) => `crowd${role(o)}` });
    for (const a of this.actors.values()) roots.push({ root: a.root, group: 'actors', part: (o) => `${a.kind}${role(o)}` });
    roots.push({ root: this.vfx.scene, group: 'vfx' });
    roots.push({ root: this.overlay.scene, group: 'overlay' }, { root: this.overlay.teleScene, group: 'overlay' });
    return roots;
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored, false);
    this.viewFns.clear();
    this.teardownMatch();
    this.menu.dispose();
    this.vfx.dispose();
    this.bars.dispose(); this.rings.dispose(); this.teles.dispose(); this.hoverRim.dispose(); this.crowd.dispose();
    this.overlay.dispose();
    this.post.dispose();
    this.sky.dispose();
    this.gpuTimer.dispose();
    this.warmRT?.dispose();
    this.gl.dispose();
  }
}

/** CONTRACT §9 entry point. `assetUrl` resolves catalog AssetRefs (boot: LoadedCatalog.assetUrl). */
export function createRenderer(canvas: HTMLCanvasElement, catalog: CatalogT, settings: Settings, assetUrl: AssetUrlFn, options: RendererOptions = {}): Renderer {
  return new ValeRenderer(canvas, catalog, settings, assetUrl, options);
}
