// GENESIS — the Renderer (CONTRACT.md §15): WebGL2 + logarithmic depth, floating origin, every planet / sky / post
// pass per frame in the order of §15.2:
//   cloud weather + cloud-shadow bake (primary planet, only when its weather changed) → shadows (primary planet, near
//   the surface) → opaque scene into HDR (starfield, star, terrain, orbit lines) → scene copies → water → GTAO →
//   clouds (interleaved march + full-res resolve) → atmosphere composite per planet (far → near; the first one folds
//   in the AO) → god rays → bloom → exposure → lens flare + AgX + grade → FXAA + grain → canvas.
// Night: the brightest moon in the sky lights the primary planet (terrain direct light, clouds, a moonlit sky, the
// ambient of every other material) and the exposure meters down to moonlit ground.
// It reads the WorldView and a CameraPose; it never writes the world.

import {
  Frustum, Matrix3, Matrix4, NoToneMapping, PerspectiveCamera, Quaternion, Scene, Vector2, Vector3, Vector4, WebGLRenderer, type IUniform,
} from 'three';
import type { WorldView, PlanetView } from '../client/worldview.ts';
import { PlanetVisual } from './planet/planetview.ts';
import { SunShadows } from './planet/lights.ts';
import { makeWaterSceneUniforms } from './planet/ocean.ts';
import { PATCH_RES } from './planet/chunks.ts';
import { AtmospherePass } from './sky/atmosphere.ts';
import { CloudPass, type CloudStorm } from './sky/clouds.ts';
import { BASE_PACK } from '../data/index.ts';
import { StarVisual } from './sky/star.ts';
import { Starfield } from './sky/starfield.ts';
import { OrbitLines } from './orbitlines.ts';
import { FullscreenQuad } from './post/fsquad.ts';
import { PostPipeline, type PostSettings, type SunScreen } from './post/pipeline.ts';
import { GtaoPass, aoFor } from './post/gtao.ts';
import { FX_EXPOSURE } from './fx/particles.ts';
import { QUALITY, type Quality, type QualityName } from './quality.ts';
import { nearestPlanet, sunIlluminance, type CameraPose } from './frame.ts';
import { blackbody } from '../client/orbits.ts';
import { GodFx } from './fx/godfx.ts';
import { ShipLayer, type ShipPlanetRef } from './life/ships.ts';
import { applyLaunchShake } from './fx/launch.ts';

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  frameMs: number;
  gpuPatches: number;
  waterPatches: number;
  /** draw calls / triangles per pass this frame (shadow cascades, opaque scene, water) and patches the local horizon culled */
  shadowCalls: number;
  shadowTris: number;
  sceneCalls: number;
  sceneTris: number;
  waterCalls: number;
  horizonCulled: number;
  primary: string;
  altitude: number;
  renderW: number;
  renderH: number;
}

export interface BrushPreview {
  planet: number; dir: [number, number, number]; radius: number; color?: [number, number, number];
  /** additive (god layer): the power's category / command, falloff 0..1, strength 0..1 and tool mode shape the decal */
  category?: string; command?: string; falloff?: number; strength?: number; mode?: string;
}

const _sun = new Vector3();
const _rel = new Vector3();
const _star = new Vector3();
const _proj = new Matrix4();
const _invProj = new Matrix4();
const _camRot = new Matrix3();
// per-frame scratch (no allocation in the frame loop)
const _sunE = new Vector3();
const _planetPos = new Vector3();
const _sunDir = new Vector3();
const _storms: CloudStorm[] = [];
const smoothstepN = (a: number, b: number, x: number): number => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const _bodyToClip = new Matrix4();
/** weather kinds → how much cloud they make and whether they have an eye (weather.json, the sim's own data) */
const WEATHER_LOOK = new Map<string, { cloud: number; eye: boolean; style: number }>(
  (BASE_PACK.weather ?? []).map((w) => [w.id, {
    cloud: Math.max(0, Number(w.render?.cloud ?? 0)), eye: !!w.render?.eye,
    // cloud organisation style: tropical cyclone (eye), convective (lightning-bearing towers), else a front
    style: w.render?.eye ? 2 : Number(w.render?.lightning ?? 0) >= 0.2 ? 1 : 0,
  }]),
);
const _w2b = new Matrix3();
const _q4 = new Quaternion();
const _m4 = new Matrix4();
const _up = new Vector3();
const _atmoList: PlanetVisual[] = [];
const _moonDir = new Vector3();
const _moonE = new Vector3();
const _moonB = new Vector3();
const _moonK = new Vector3();
const _moonEc = new Vector3();
const _v3 = new Vector3();
const _sunView = new Vector3();
/** weather / shadow cube face size per preset (cloud steps → resolution) */
const WX_RES = (steps: number): number => (steps <= 24 ? 96 : steps <= 32 ? 128 : steps <= 48 ? 192 : 256);
/**
 * Moonlight, art-directed: the brightest other body in the sky (albedo × Lambert-sphere phase × apparent size²) at a
 * fixed boost (a full moon of the Moon's apparent size gives ~1.4 % of the sun), capped at 2.8 % of the sun. Real
 * moonlight is ~10⁻⁶ of the sun; a game night must stay readable.
 */
const MOON_BOOST = 6000;
const MOON_CAP = 0.028;
/** the moonlit SKY and the clouds keep the earlier, dimmer level (0.012 of the sun): a night sky as bright as the
 * ground's moonlight read as twilight, and moonlit cloud decks crowded the night side seen from orbit. The ground,
 * buildings, trees and people take the full moonlight: with the orange town spill gone, at 0.012 a moonlit village
 * sank to black under the night exposure ceiling and only its windows showed. */
const MOON_SKY_SHARE = 0.43;
const MOON_CLOUD_SHARE = 0.19;

export class Renderer {
  readonly three: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  quality: Quality = QUALITY.high;
  readonly post = new PostPipeline();
  readonly fsq = new FullscreenQuad();
  readonly shadows: SunShadows;
  readonly clouds = new CloudPass();
  readonly atmoPass = new AtmospherePass();
  readonly gtao = new GtaoPass();
  readonly star = new StarVisual();
  readonly starfield = new Starfield();
  readonly orbits = new OrbitLines();
  /** the god layer's visuals: hand, creatures, disasters, weather, miracles, previews (render/fx/godfx.ts) */
  readonly godfx = new GodFx();
  /** ships in every phase, their launch VFX and the system view's ship glints and trails (render/life/ships.ts) */
  readonly ships = new ShipLayer();
  private readonly shipRefs = new Map<number, ShipPlanetRef>();
  readonly planets = new Map<number, PlanetVisual>();
  readonly waterScene: Record<string, IUniform> = makeWaterSceneUniforms();
  readonly settings: PostSettings = { bloom: 0.045, godRays: true, fxaa: true, grain: 0.02, vignette: 0.22, flare: 1, exposureBias: 0, manualExposure: 0 };
  readonly stats: RenderStats = {
    drawCalls: 0, triangles: 0, frameMs: 0, gpuPatches: 0, waterPatches: 0, shadowCalls: 0, shadowTris: 0, sceneCalls: 0, sceneTris: 0, waterCalls: 0,
    horizonCulled: 0, primary: '', altitude: 0, renderW: 0, renderH: 0,
  };
  /** cloud / atmosphere / UI switches for photo mode and tests */
  showOrbits = true;
  /** terrain debug view: 0 off, 1 normals, 2 albedo, 3 no bump, 4 macro normals */
  debugView = 0;
  private frustum = new Frustum();
  private frameNo = 0;
  private cssW = 1;
  private cssH = 1;
  private dpr = 1;
  private brush: BrushPreview | null = null;
  primaryId = -1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.three = new WebGLRenderer({
      canvas, antialias: false, alpha: false, depth: true, stencil: false, logarithmicDepthBuffer: true,
      powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    this.three.toneMapping = NoToneMapping;
    this.three.autoClear = true;
    this.three.setClearColor(0x000000, 1);
    this.three.shadowMap.enabled = false;
    // stats cover the whole frame (every pass), reset manually at the start of render()
    this.three.info.autoReset = false;
    this.camera = new PerspectiveCamera(50, 16 / 9, 0.05, 2e7);
    this.camera.matrixAutoUpdate = true;
    this.shadows = new SunShadows(this.quality.shadowMapSize);
    this.shadows.init(this.three);
    // the AO's sun-share estimate reads the cascaded sun shadow
    this.gtao.bindShadows(this.shadows.uniforms as unknown as Record<string, IUniform>);
    this.clouds.setWeatherRes(WX_RES(this.quality.cloudSteps));
    this.scene.add(this.starfield.group, this.star.group, this.orbits.group);
    this.scene.matrixWorldAutoUpdate = true;
  }

  setQuality(name: QualityName): void {
    this.quality = QUALITY[name];
    this.settings.bloom = this.quality.bloom;
    this.settings.godRays = this.quality.godRays;
    this.settings.flare = this.quality.flare;
    this.settings.fxaa = this.quality.fxaa;
    this.settings.grain = this.quality.grain;
    this.shadows.setSize(this.quality.shadowMapSize);
    this.shadows.init(this.three);
    this.clouds.setWeatherRes(WX_RES(this.quality.cloudSteps));
    this.ships.fx.setBudget(this.quality.particleBudget);
    this.resize(this.cssW, this.cssH, this.dpr);
  }

  resize(cssW: number, cssH: number, dpr: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.dpr = dpr;
    const pr = Math.min(dpr, this.quality.maxDpr);
    this.three.setPixelRatio(pr);
    this.three.setSize(this.cssW, this.cssH, false);
    const w = Math.max(2, Math.round(this.cssW * pr * this.quality.renderScale));
    const h = Math.max(2, Math.round(this.cssH * pr * this.quality.renderScale));
    this.post.setSize(w, h, this.quality.msaa);
    this.clouds.setSize(w, h, this.quality.cloudScale);
    this.orbits.setResolution(w, h);
    this.ships.setResolution(w, h, pr * this.quality.renderScale);
    this.starfield.setPixelRatio(pr * this.quality.renderScale);
    this.camera.aspect = this.cssW / this.cssH;
    this.camera.updateProjectionMatrix();
    this.stats.renderW = w;
    this.stats.renderH = h;
  }

  setBrush(b: BrushPreview | null): void { this.brush = b; }

  /**
   * A camera cut (teleport, preset, test camera): snap exposure and white balance, and let the terrain LOD build many
   * more patches for a few frames, so the new view converges at once instead of showing 50–100 m coarse facets for
   * the dozens of frames the steady per-frame budget would take (a hitch at a cut is fine; streaming in view is not).
   */
  // a cut also invalidates last frame's image: the water's reflections must not read a view from another place
  cut(): void { this.post.cutExposure(); this.post.prevValid = false; this.clouds.resetHistory(); this.wbSnap = true; this.cutFrames = 4; }
  private cutFrames = 0;

  private syncPlanets(view: WorldView): void {
    const seen = new Set<number>();
    for (const pv of view.planets) {
      seen.add(pv.id);
      let vis = this.planets.get(pv.id);
      if (!vis) {
        vis = new PlanetVisual(pv, { clouds: this.clouds, shadows: this.shadows, waterScene: this.waterScene });
        this.planets.set(pv.id, vis);
        this.scene.add(vis.group);
      }
      vis.sync(pv);
    }
    for (const [id, vis] of this.planets) {
      if (seen.has(id)) continue;
      this.scene.remove(vis.group);
      vis.dispose();
      this.planets.delete(id);
    }
  }

  /** project a system-frame point to CSS pixels (null if behind the camera) */
  projectToScreen(sys: ArrayLike<number>, pose: CameraPose, out: Vector2): Vector2 | null {
    _rel.set(sys[0] - pose.pos[0], sys[1] - pose.pos[1], sys[2] - pose.pos[2]);
    _rel.applyMatrix4(this.camera.matrixWorldInverse);
    if (_rel.z > -1e-3) return null;
    _rel.applyMatrix4(this.camera.projectionMatrix);
    out.set((_rel.x * 0.5 + 0.5) * this.cssW, (0.5 - _rel.y * 0.5) * this.cssH);
    return out;
  }

  render(view: WorldView, pose: CameraPose, dt: number, time: number): void {
    const t0 = performance.now();
    const r = this.three;
    r.info.reset();
    const q = this.quality;
    this.frameNo++;
    // ── camera at the origin ──
    const cam = this.camera;
    cam.position.set(0, 0, 0);
    cam.quaternion.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
    if (Math.abs(cam.fov - pose.fov) > 1e-6) { cam.fov = pose.fov; cam.updateProjectionMatrix(); }
    // quakes and impacts shake the view (god layer)
    this.godfx.shakeCamera(cam, dt);
    // a launch or a ship's failure near the camera shakes it too (render/fx/launch.ts SHAKE)
    applyLaunchShake(cam, time);
    // near 0.05 m / far 2·10⁷ m for every view: the logarithmic depth buffer keeps precision across the whole range
    cam.updateMatrixWorld(true);
    _proj.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(_proj);

    this.syncPlanets(view);
    const primaryPv: PlanetView | null = (pose.planet >= 0 ? view.planet(pose.planet) : null) ?? nearestPlanet(view.planets, pose.pos);
    this.primaryId = primaryPv ? primaryPv.id : -1;
    const starCol = blackbody(view.star.temperature || 5800);
    // LOD error → split distance factor (render pixels)
    const hPx = this.stats.renderH;
    const K = Math.max(3, hPx / (2 * Math.tan((cam.fov * Math.PI) / 360) * q.terrainPixelError * PATCH_RES));
    const camWorldInverse = cam.matrixWorldInverse;
    let primaryVis: PlanetVisual | null = null;
    for (const vis of this.planets.values()) {
      const pv = vis.pv;
      _rel.set(pose.pos[0] - pv.center[0], pose.pos[1] - pv.center[1], pose.pos[2] - pv.center[2]);
      const d = Math.hypot(pv.center[0], pv.center[1], pv.center[2]) || 1;
      _sun.set(pv.sunDir[0], pv.sunDir[1], pv.sunDir[2]);
      const E = sunIlluminance(view.star.luminosity, d);
      const isPrimary = pv.id === this.primaryId;
      if (isPrimary) primaryVis = vis;
      // clouds (and their shadows) are drawn for the primary planet only: the others cast none either
      else vis.uniforms.uCloudOn.value = 0;
      // night lights from afar (planet/citylights.ts, built by the field textures once the life layer lights anything)
      if (vis.uniforms.uCityTex) vis.uniforms.uCityTex.value = vis.fields.cityLights ? vis.fields.cityLights.texture : null;
      vis.frameUpdate({
        camWorldInverse, frustum: this.frustum, camRel: _rel, sunDirWorld: _sun,
        sunE: this.godfx.tintSun(_sunE.set(starCol[0] * E, starCol[1] * E, starCol[2] * E), isPrimary), time, K, frame: this.frameNo,
        budget: this.cutFrames > 0 ? Math.max(q.patchBudget, 320) : q.patchBudget, primary: isPrimary, shadows: q.shadowCascades > 0, yearFrac: view.calendar(pv).yearFrac,
        vegRange: 380 * q.vegetationRange, vegDensity: q.vegetationDensity, proj: cam.projectionMatrix, grass: q.grass,
        lightBudget: q.lightBudget, particleBudget: q.particleBudget,
      });
      // brush preview: a ground decal of the god layer (fx/decals.ts), not the terrain's own ring
      const u = vis.uniforms;
      u.uDebug.value = this.debugView;
      u.uBrushOn.value = 0;
      vis.atmo.update(r, this.fsq);
    }
    // ── the sun's elevation at the camera (exposure, grade, AO) and the moon over the primary planet ──
    const camSunEl = this.camSunElevation(primaryVis);
    this.forestAtCamera(view, primaryVis);
    const moonOn = primaryVis ? this.moonLight(view, primaryVis, starCol) : false;
    // ── the god layer: hand, creatures, disasters, weather, miracles (placed before the shadows and the scene) ──
    this.godfx.brush = this.brush;
    this.godfx.update(view, primaryVis, cam, dt, time, q);
    // ── ships: placed, animated and their engines reported before the shadows and the scene ──
    this.shipRefs.clear();
    for (const v of this.planets.values()) {
      if (!v.group.visible) continue;
      this.shipRefs.set(v.id, { group: v.group, uniforms: v.uniforms as unknown as Record<string, IUniform>, camBody: v.camBody, pv: v.pv, hasAir: v.atmo.has, airTop: v.atmo.thickness, shadows: v === primaryVis });
    }
    this.ships.update(view, pose, this.shipRefs, this.scene, time, dt, this.primaryId, q.shadowCascades > 0);
    // ── cloud weather of the primary planet: organised and baked (weather + shadow cubes) BEFORE the scene, whose
    // materials read the cloud-shadow cube ──
    const cloudVis = primaryVis && primaryVis.atmo.has && primaryVis.hasClouds && primaryVis.cloudCube ? primaryVis : null;
    if (cloudVis) {
      const pv = cloudVis.pv;
      this.clouds.bind(cloudVis.atmo, cloudVis.cloudCube!.texture);
      // the sim's weather systems organise the cloud cover (spiral arms, cores, eyes); a planet-wide override
      // organises into storm tracks
      _storms.length = 0;
      for (const w of pv.weather) {
        const def = WEATHER_LOOK.get(w.kind);
        if (!def || def.cloud <= 0.3) continue;
        _storms.push({ pos: w.pos, radius: w.radius, intensity: w.intensity * Math.min(1, def.cloud), eye: def.eye, style: def.style, vel: w.vel });
      }
      const g = pv.params.globalWeather ? WEATHER_LOOK.get(pv.params.globalWeather) : undefined;
      this.clouds.setWeather(_storms, pv.params.radius, g && g.cloud > 0.5 ? 1 : 0, 0.15 + 0.6 * Math.min(1, Math.max(0, pv.params.cloudiness)));
      this.clouds.bake(r, this.fsq, cloudVis.cloudCube!.texture, cloudVis.cloudInner, cloudVis.cloudOuter, this.cutFrames > 0);
    }
    // ── star, sky, orbit lines ──
    _star.set(-pose.pos[0], -pose.pos[1], -pose.pos[2]);
    // how much of the view the star's disc fills: past ~1 % the exposure comes from the disc itself (AgX keeps its
    // limb darkening and granulation in range), bloom drops away and the corona shrinks
    const starDist = Math.max(1, Math.hypot(pose.pos[0], pose.pos[1], pose.pos[2]));
    const starR = Math.max(100, view.star.radius);
    const angR = Math.asin(Math.min(1, starR / starDist));
    const tanH = Math.tan((cam.fov * Math.PI) / 360);
    const screenFrac = (Math.PI * Math.tan(Math.min(angR, 1.4)) ** 2) / (4 * tanH * tanH * Math.max(0.2, cam.aspect));
    const close = smoothstepN(0.01, 0.05, screenFrac);
    this.star.update(view.star, _star, time, close);
    this.post.starMix = close;
    // the disc centre lands around 1.3 before the AgX curve: near-white gold at the centre, while the limb (a quarter
    // of the centre's radiance) falls to deep orange and granulation keeps its gradation (0.18 / radiance made it a
    // mid-grey moon)
    this.post.starExposure = 1.2 / this.star.radiance;
    const minAlt = primaryVis ? primaryVis.altitude / Math.max(1, primaryVis.pv.params.radius) : 100;
    // (orbit lines vanish near the star: they would cross its disc as stray lines)
    const orbitVis = (this.showOrbits ? Math.min(1, Math.max(0, (minAlt - 8) / 30)) : 0) * smoothstepN(20 * starR, 30 * starR, starDist);
    this.orbits.update(view, pose, orbitVis);
    this.ships.overlayVis = orbitVis;

    // ── shadows near the surface of the primary planet ──
    const alt = primaryVis ? primaryVis.altitude : 1e9;
    this.stats.altitude = alt;
    this.stats.primary = primaryPv?.name ?? '';
    const wantShadows = !!primaryVis && q.shadowCascades > 0 && alt < 3500;
    const callsPre = r.info.render.calls, trisPre = r.info.render.triangles;
    if (primaryVis) primaryVis.uniforms.uShadowOn.value = wantShadows ? 1 : 0;
    if (wantShadows && primaryVis) {
      const pv = primaryVis.pv;
      _sun.set(pv.sunDir[0], pv.sunDir[1], pv.sunDir[2]);
      const far = Math.min(q.shadowDistance, Math.max(300, alt * 14 + 600));
      const near = Math.max(0.5, Math.min(alt * 0.2, 50));
      this.shadows.fit(cam, _sun, q.shadowCascades, near, far, Math.min(4000, pv.params.radius));
      const vis = primaryVis;
      this.shadowCull(vis, camSunEl);
      this.shadows.render(r, this.scene, (depth) => { vis.swapDepth(depth); this.godfx.swapDepth(depth); this.ships.swapDepth(depth); }, this.perCascade);
    } else {
      this.shadows.uniforms.uShadowOn.value = 0;
    }
    const callsShadow = r.info.render.calls, trisShadow = r.info.render.triangles;

    // ── opaque scene → HDR ──
    const post = this.post;
    cam.layers.set(0);
    r.setRenderTarget(post.hdr);
    r.setClearColor(0x000000, 1);
    r.render(this.scene, cam);
    const callsScene = r.info.render.calls, trisScene = r.info.render.triangles;
    // contact shadows (GTAO, Medium+) from the OPAQUE depth, before the water is drawn: computed after the water, the
    // sheet's edge against the beach was a crease it darkened — a dashed black line along every waterline — and the
    // water surface itself took AO. (aoFactor weighs each AO sample by depth, so water pixels, whose depth is the
    // sheet's, keep their light.)
    const aoS = q.ssao ? aoFor(q.name) : null;
    if (aoS) {
      if (primaryVis) _sunView.copy(primaryVis.uniforms.uSunDirView.value as Vector3); else _sunView.set(0, 0, -1);
      const ss = (a: number, b: number, x: number) => smoothstepN(a, b, x);
      // sky / direct-sun irradiance: ~0.13 under a high sun (the sky fill is art-directed down, atmosphere.ts
      // SKY_FILL), the sky wins as the sun sets
      const skyRatio = 0.13 + 0.87 * (1 - ss(0.0, 0.45, camSunEl));
      this.gtao.compute(r, this.fsq, aoS, post.depthTexture, cam.projectionMatrixInverse, cam.projectionMatrix, cam.far, post.w, post.h, this.frameNo, _sunView, skyRatio, ss(-0.02, 0.06, camSunEl));
    }
    // ── water (reads copies of colour and linear depth) ──
    post.copyForWater(r, this.fsq, cam.far);
    // ground decals and FX lights (brush, reticles, the hand's shadow, crater glow, cracks…) under the water and haze
    this.godfx.renderDecals(r, this.scene, cam, post);
    this.waterScene.tSceneColor.value = post.sceneCopy.texture;
    this.waterScene.tSceneDepth.value = post.linDepth.texture;
    (this.waterScene.uResolution.value as Vector2).set(post.w, post.h);
    this.waterScene.tPrevColor.value = post.prevColor.texture;
    this.waterScene.uPrevValid.value = post.prevValid ? 1 : 0;
    (this.waterScene.uProj.value as Matrix4).copy(cam.projectionMatrix);
    this.waterScene.uFrame.value = this.frameNo % 64;
    let anyWater = false;
    for (const vis of this.planets.values()) if (vis.lod.stats.waterPatches > 0) anyWater = true;
    if (anyWater) {
      cam.layers.set(2);
      r.autoClear = false;
      r.setRenderTarget(post.hdr);
      r.render(this.scene, cam);
      r.autoClear = true;
      cam.layers.set(0);
    }
    this.stats.shadowCalls = callsShadow - callsPre;
    this.stats.shadowTris = trisShadow - trisPre;
    this.stats.sceneCalls = callsScene - callsShadow;
    this.stats.sceneTris = trisScene - trisShadow;
    // (the scene copies between are two full-screen draws)
    this.stats.waterCalls = Math.max(0, r.info.render.calls - callsScene - 2);

    // ── clouds + atmosphere composites ──
    _invProj.copy(cam.projectionMatrixInverse);
    _camRot.setFromMatrix4(cam.matrixWorld);
    let input = post.hdr.texture;
    // contact shadows (GTAO, Medium+) on the ambient share of the lit scene, before aerial perspective and clouds:
    // folded into the first atmosphere composite; without air applied here and written back into post.hdr (via atmoB),
    // so passes that draw into post.hdr when no atmosphere runs still start from it
    const atmoVis = _atmoList;
    atmoVis.length = 0;
    for (const v of this.planets.values()) if (v.atmo.has && this.shellVisible(v, pose)) atmoVis.push(v);
    atmoVis.sort((a, b) => this.distOf(b, pose) - this.distOf(a, pose));
    if (aoS && atmoVis.length === 0) this.gtao.apply(r, this.fsq, aoS, post.depthTexture, cam.projectionMatrixInverse, cam.far, post.w, post.h, post.hdr.texture, post.atmoB, post.hdr);
    let outIdx = 0;
    let firstComposite = true;
    for (const vis of atmoVis) {
      const pv = vis.pv;
      const withClouds = vis === cloudVis;
      const planetPos = _planetPos.set(pv.center[0] - pose.pos[0], pv.center[1] - pose.pos[1], pv.center[2] - pose.pos[2]);
      const sunDir = _sunDir.set(pv.sunDir[0], pv.sunDir[1], pv.sunDir[2]);
      if (withClouds) {
        const w2b = _w2b.setFromMatrix4(_m4.makeRotationFromQuaternion(vis.group.quaternion).invert());
        _bodyToClip.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(vis.group.matrixWorld);
        this.clouds.render(r, this.fsq, {
          depth: post.depthTexture, invProj: _invProj, camRot: _camRot, worldToBody: w2b, far: cam.far, planetPos, sunDir,
          innerR: vis.cloudInner, outerR: vis.cloudOuter, frame: this.frameNo, altitude: vis.camBody.length() - pv.params.radius, radius: pv.params.radius,
          // (clouds take a fifth of the art-directed moonlight: at full strength the night side from orbit was a field
          // of bright grey cloud blocks around the cities, which should be what the night shows)
          bodyToClip: _bodyToClip, planetId: pv.id, moonDir: moonOn ? _moonDir : undefined, moonE: moonOn ? _moonEc.copy(_moonE).multiplyScalar(MOON_CLOUD_SHARE) : undefined,
        }, q.cloudSteps, q.cloudLightSteps);
      }
      const m = this.atmoPass.material;
      this.atmoPass.bind(vis.atmo);
      const u = m.uniforms;
      u.tScene.value = input;
      u.tDepth.value = post.depthTexture;
      u.tCloud.value = this.clouds.target.texture;
      u.tCloudAux.value = this.clouds.aux;
      u.uHasCloud.value = withClouds ? 1 : 0;
      // the AO multiplies the scene once: in the first composite (which reads post.hdr)
      u.uAoOn.value = aoS && firstComposite ? 1 : 0;
      if (aoS && firstComposite) {
        u.tAO.value = this.gtao.result;
        const [aw, ah] = this.gtao.resultSize;
        (u.uAoRes.value as Vector2).set(aw, ah);
        u.uAoStrength.value = aoS.strength;
      }
      firstComposite = false;
      // the moonlit sky of the planet the camera is on
      (u.uMoonDir.value as Vector3).copy(_moonDir);
      if (moonOn && vis === primaryVis) {
        const se = vis.atmo.uniforms.uSunE.value;
        (u.uMoonK.value as Vector3).set(_moonE.x / Math.max(se.x, 1e-6), _moonE.y / Math.max(se.y, 1e-6), _moonE.z / Math.max(se.z, 1e-6)).multiplyScalar(MOON_SKY_SHARE);
      } else (u.uMoonK.value as Vector3).set(0, 0, 0);
      u.uCloudRes.value.set(this.clouds.target.width, this.clouds.target.height);
      u.uCloudShell.value.set(vis.cloudInner, vis.cloudOuter);
      u.uInvProj.value.copy(_invProj);
      u.uCamRot.value.copy(_camRot);
      u.uFar.value = cam.far;
      u.uPlanetPos.value.copy(planetPos);
      u.uSunDir.value.copy(sunDir);
      u.uSteps.value = q.atmoSteps;
      // aerial perspective on geometry: thin inside the air, physical from space
      const thick = vis.atmo.thickness;
      const altP = vis.altitude;
      // (denser-than-Earth air for real sunsets would wash the ground out from orbit at full strength). Inside the air
      // the haze ramps with distance: ground 50–300 m away stays crisp (0.03), the far hills fade in by ~2 km (0.12)
      const orbitK = Math.min(1, Math.max(0, (altP - thick) / (thick * 4)));
      u.uApScale.value = 0.1 + 0.08 * orbitK;
      // (a camera near the ground: the first ~450 m stay nearly clear — at 0.025 from 0 m a veil of blue lay over
      // every settlement view at 60–150 m and flattened it)
      u.uApRamp.value.set(0.012 + (0.1 + 0.08 * orbitK - 0.012) * orbitK, 450 - 150 * orbitK, 2400);
      u.uCloudHaze.value = 0.3 + 0.7 * orbitK;
      // inside a wood (the primary planet, the camera under its canopy height): the haze between the trunks
      (u.uForest.value as Vector4).set(vis === primaryVis ? this.forestK : 0, this.forestCamH, 18, 0);
      const target = outIdx === 0 ? post.atmoA : post.atmoB;
      this.fsq.render(r, m, target);
      input = target.texture;
      outIdx ^= 1;
    }
    // ── fire, smoke and embers over the composited image (render/fx/particles.ts via the life layer): after the
    // atmosphere, so smoke against the sky is never taken for stars, with soft depth from the linear depth copy ──
    FX_EXPOSURE.value = post.exposureTexture();
    if (primaryVis) primaryVis.renderFx(r, this.scene, cam, atmoVis.length ? (outIdx === 1 ? post.atmoA : post.atmoB) : post.hdr, post.linDepth.texture, post.w, post.h);
    // the god layer's FX over the composited image (plumes, funnels, bolts, domes, auroras, the hand's glow…)
    this.godfx.renderFx(r, this.scene, cam, atmoVis.length ? (outIdx === 1 ? post.atmoA : post.atmoB) : post.hdr, post);
    // launch plumes, exhaust smoke, pad clouds, landing dust, explosions and the exhaust's light (render/fx/launch.ts)
    this.ships.fx.render(r, this.scene, cam, atmoVis.length ? (outIdx === 1 ? post.atmoA : post.atmoB) : post.hdr, post.linDepth.texture, post.w, post.h);

    // ── white balance: like a camera set to "daylight here", neutralise the sun's colour at ~50° elevation on the
    // world we are at, so noon light reads white while sunsets (much redder than that) stay warm
    const cutNow = this.wbSnap;
    this.whiteBalance(primaryVis, starCol);
    // ── post ──
    post.keepPrevious(r, this.fsq, input);
    const sun = this.sunScreen(pose, primaryVis);
    // exposure key (mid-grey target, the scene's log-average): 0.133 by day (→ ~122/255 on the curve), dusky at
    // twilight (0.095), dark at night (0.013: moonlit ground ~12–25/255). The metering floor opens up at night so moonlit
    // ground (radiance ~10⁻³) is what the exposure meters, not a fixed fallback; the exposure ceiling does NOT rise at
    // night (it was 14: the auto-exposure lifted a moonless village to dusk and its hearths, windows and lamps — the
    // brightest things a night should have — sank into a grey, lit-looking scene). Night stays night, lights read.
    // (sunElevation is a sine.)
    {
      const el = this.sunElevation;
      const night = 1 - smoothstepN(-0.15, -0.02, el);
      let key = el >= 0 ? 0.095 + 0.038 * smoothstepN(0.0, 0.25, el) : 0.095 + (0.013 - 0.095) * night;
      // from orbit over the night side (the sun's elevation at the camera reads 1 there): a darker key, or the auto
      // exposure meters the few lit pixels — the cities — up to mid-grey and their cores clip to a white blob
      if (primaryVis && primaryVis.atmo.has && primaryVis.altitude >= primaryVis.atmo.thickness * 1.5) {
        const sub = _up.copy(primaryVis.camBody).normalize().dot(primaryVis.uniforms.uSunDirBody.value as Vector3);
        const orbitNight = (1 - smoothstepN(-0.35, 0.05, sub)) * smoothstepN(primaryVis.atmo.thickness * 1.5, primaryVis.atmo.thickness * 3, primaryVis.altitude);
        // (0.05 still metered a lamp-lit city up into AgX's cream: its streets and houses read white, not lamplight)
        key += (0.022 - key) * orbitNight;
      }
      post.setKey(key);
      post.setMetering(0.02, Math.exp(Math.log(6) + (Math.log(5) - Math.log(6)) * night), Math.exp(Math.log(0.004) + (Math.log(0.0002) - Math.log(0.004)) * night));
    }
    // bloom: half by day (a veil), full at dusk and night where lamps, windows and fire should glow
    post.bloomScale = 0.5 + 0.5 * (1 - smoothstepN(-0.02, 0.15, this.sunElevation));
    // golden-hour grade: strongest with the sun a few degrees up, gone by mid-morning and in full night
    {
      const el = this.sunElevation;
      const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const want = (1 - ss(0.04, 0.36, el)) * ss(-0.14, -0.02, el);
      const g = this.post.tonemapMat.uniforms.uGolden;
      g.value += (want - g.value) * (cutNow ? 1 : Math.min(1, dt * 3));
      // night grade (moonlit blue shadows) once the sun is well down at the camera
      const n = this.post.tonemapMat.uniforms.uNight;
      n.value += (ss(0.02, -0.16, el) - n.value) * (cutNow ? 1 : Math.min(1, dt * 3));
    }
    // after a cut the exposure snaps to its target on every frame of the cut window (terrain patches and the clouds'
    // history are still converging on the first frame: one snap left the view wrongly exposed for a second)
    if (this.cutFrames > 0) post.cutExposure();
    post.finish(r, this.fsq, input, this.settings, sun, dt, time, null);
    if (this.cutFrames > 0) this.cutFrames--;
    this.updateStats();
    this.stats.frameMs = performance.now() - t0;
  }

  /** sine of the sun's elevation at the camera (1 when not near a planet with air) */
  sunElevation = 1;
  /** moonlight on the primary planet as a fraction of its sunlight (dev HUD / probes) */
  moonRatio = 0;

  // ── shadow cascades: what each cascade draws ──
  private cullVis: PlanetVisual | null = null;
  private cullMargin = 50;
  private readonly cullView = new Vector3();
  private readonly hiddenSmall: { visible: boolean }[] = [];
  private readonly cascadeF = new Frustum();
  private shadowCull(vis: PlanetVisual, sunEl: number): void {
    this.cullVis = vis;
    // terrain throws its shadows over about (relief ÷ tan elevation) — for ~40 m of relief, ~50 m at mid-morning, a few
    // hundred at sunset
    const el = Math.max(0.05, Math.min(1, sunEl));
    this.cullMargin = Math.min(450, Math.max(40, (40 * Math.sqrt(1 - el * el)) / el));
    // the view direction in the body frame
    this.cullView.set(0, 0, -1).applyQuaternion(this.camera.quaternion).applyQuaternion(_q4.copy(vis.group.quaternion).invert());
  }
  /** before cascade k: the ground nearer than the previous split (less the shadow reach) stays out; people and animals
   * only in the first two cascades (a texel of the last is metres wide); k < 0 restores everything */
  private readonly perCascade = (k: number): void => {
    const vis = this.cullVis;
    if (!vis) return;
    const sh = this.shadows;
    const near = k >= 1 ? sh.splits[k - 1] - this.cullMargin : 0;
    vis.lod.shadowCascade(k, vis.camBody, this.cullView, near, k >= 0 ? sh.cascadeFrustum(k, this.cascadeF) : undefined, vis.group.matrixWorld);
    if (k === 2 || (k < 0 && this.hiddenSmall.length)) {
      if (k === 2) {
        for (const name of ['crowds', 'animals']) {
          const o = vis.group.getObjectByName(name);
          if (o && o.visible) { o.visible = false; this.hiddenSmall.push(o); }
        }
      } else {
        for (const o of this.hiddenSmall) o.visible = true;
        this.hiddenSmall.length = 0;
      }
    }
  };

  /** canopy density around the camera (0 above the treetops or out of the woods) and the camera's height above ground */
  private forestK = 0;
  private forestCamH = 0;
  private forestAtCamera(view: WorldView, vis: PlanetVisual | null): void {
    this.forestK = 0;
    if (!vis || !vis.atmo.has || vis.altitude > 400) return;
    const pv = vis.pv;
    const tree = pv.fields.get('tree');
    if (!tree) return;
    const c = vis.camBody;
    const rc = c.length() || 1;
    const ux = c.x / rc, uy = c.y / rc, uz = c.z / rc;
    const h = rc - view.groundRadius(pv, ux, uy, uz);
    this.forestCamH = Math.max(0, h);
    const t = pv.grid.sample(tree, ux, uy, uz);
    this.forestK = smoothstepN(0.35, 0.8, t) * (1 - smoothstepN(14, 30, h));
  }

  /** the same sine, available before the post section (the AO's sun share needs it) */
  private camSunElevation(primary: PlanetVisual | null): number {
    if (!primary || !primary.atmo.has) return 1;
    if (primary.altitude >= primary.atmo.thickness * 2) return 1;
    const up = _up.copy(primary.camBody).normalize();
    return up.dot(primary.uniforms.uSunDirBody.value as Vector3);
  }

  /**
   * Moonlight on the primary planet: direction (world frame, from its centre to the moon's) and illuminance (see
   * MOON_BOOST). Sets the terrain's moon light, a moonlit share of every material's night ambient and _moonDir /
   * _moonE for the clouds and the sky. Returns whether a moon lights the planet.
   */
  private moonLight(view: WorldView, vis: PlanetVisual, starCol: [number, number, number]): boolean {
    const pv = vis.pv;
    const u = vis.uniforms;
    let best = 0;
    for (const m of view.planets) {
      if (m.id === pv.id) continue;
      const dx = m.center[0] - pv.center[0], dy = m.center[1] - pv.center[1], dz = m.center[2] - pv.center[2];
      const d = Math.hypot(dx, dy, dz);
      const R = m.params.radius;
      if (!(d > R * 2)) continue;
      const dm = Math.hypot(m.center[0], m.center[1], m.center[2]) || 1;
      // phase angle at the moon between the star (at the origin) and the planet; Lambert-sphere phase function
      // (star → moon is −centre, moon → planet is −(dx, dy, dz): their angle is that between centre and (dx, dy, dz))
      const cosA = Math.max(-1, Math.min(1, (m.center[0] * dx + m.center[1] * dy + m.center[2] * dz) / (dm * d)));
      const a = Math.acos(cosA);
      const phase = (Math.sin(a) + (Math.PI - a) * Math.cos(a)) / Math.PI;
      const albedo = m.params.atmosphere && m.params.atmosphere.pressure > 0.05 ? 0.3 : 0.12;
      const I = albedo * phase * (R / d) * (R / d) * (sunIlluminance(view.star.luminosity, dm) / Math.max(1e-6, sunIlluminance(view.star.luminosity, Math.hypot(pv.center[0], pv.center[1], pv.center[2]) || 1)));
      if (I > best) { best = I; _moonDir.set(dx / d, dy / d, dz / d); }
    }
    // (art-directed for the ground: from orbit the night side is the cities' — at full strength moonlit snow and ice
    // glowed blue-white beside them once the exposure metered on the few lit pixels)
    const orbitDim = 1 - 0.7 * smoothstepN(vis.atmo.thickness * 2, vis.atmo.thickness * 6, vis.altitude);
    const ratio = Math.min(MOON_CAP, best * MOON_BOOST) * orbitDim;
    this.moonRatio = ratio;
    const dist = Math.hypot(pv.center[0], pv.center[1], pv.center[2]) || 1;
    const E = sunIlluminance(view.star.luminosity, dist);
    _moonE.set(starCol[0] * E * ratio, starCol[1] * E * ratio, starCol[2] * E * ratio);
    const on = ratio > 1e-6;
    // body frame and view space (the planet's uniforms were updated this frame)
    _moonB.copy(_moonDir).applyQuaternion(_q4.copy(vis.group.quaternion).invert());
    const elev = _v3.copy(vis.camBody).normalize().dot(_moonB);
    if (u.uMoonE) {
      (u.uMoonE.value as Vector3).copy(on ? _moonE : _v3.set(0, 0, 0));
      (u.uMoonDirBody.value as Vector3).copy(_moonB);
      (u.uMoonDirView.value as Vector3).copy(_moonB).applyMatrix3(u.uBodyToView.value as Matrix3).normalize();
    }
    // every material also gets a moonlit sky's share of its night ambient while the moon is up at the camera (the
    // direct moonlight itself is the uMoonE term in terrain, buildings, roads, trees, bodies — shaders/moon.glsl.ts)
    if (on) (u.uNightAmbient.value as Vector3).addScaledVector(_moonE, 0.22 * smoothstepN(-0.05, 0.25, elev));
    // starlight and airglow (with air): a moonless night keeps buildings, trees, people and roads faintly readable in a
    // cool grey-blue instead of black against the lit windows (planetview's base airglow is ~5× weaker)
    // (at 0.014 / 0.019 / 0.04 a moonless street at eye height was black past the reach of the lamps)
    if (vis.atmo.has) (u.uNightAmbient.value as Vector3).add(_v3.set(0.021, 0.028, 0.058).multiplyScalar(orbitDim));
    return on;
  }
  private wb = new Vector3(1, 1, 1);
  private sun: SunScreen = { uv: new Vector2(-10, -10), onScreen: false, color: new Vector3(1, 1, 1), strength: 0 };
  private wbSnap = true;
  private whiteBalance(primary: PlanetVisual | null, starCol: [number, number, number]): void {
    let r = starCol[0], g = starCol[1], b = starCol[2];
    if (primary && primary.atmo.has) {
      const u = primary.atmo.uniforms;
      const air = 1 / Math.sin((50 * Math.PI) / 180);
      const tau = (i: 'x' | 'y' | 'z') => (u.uBetaR.value[i] * u.uHR.value + u.uBetaMe.value[i] * u.uHM.value + u.uBetaO.value[i] * u.uOzone.value.y) * air;
      r *= Math.exp(-tau('x')); g *= Math.exp(-tau('y')); b *= Math.exp(-tau('z'));
    }
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b || 1;
    const k = 0.5; // partial: keep part of the world's own warmth (sunsets stay golden)
    const tr = (l / Math.max(r, 1e-3)) * k + (1 - k), tg = (l / Math.max(g, 1e-3)) * k + (1 - k), tb = (l / Math.max(b, 1e-3)) * k + (1 - k);
    // ease so flying between worlds does not snap the grade
    const a = this.wbSnap ? 1 : 0.1;
    this.wbSnap = false;
    this.wb.x += (tr - this.wb.x) * a; this.wb.y += (tg - this.wb.y) * a; this.wb.z += (tb - this.wb.z) * a;
    (this.post.tonemapMat.uniforms.uWhite.value as Vector3).copy(this.wb);
  }

  private distOf(v: PlanetVisual, pose: CameraPose): number {
    const c = v.pv.center;
    return Math.hypot(c[0] - pose.pos[0], c[1] - pose.pos[1], c[2] - pose.pos[2]);
  }

  /** skip atmosphere passes for shells behind the camera or smaller than a pixel */
  private shellVisible(v: PlanetVisual, pose: CameraPose): boolean {
    const c = v.pv.center;
    _rel.set(c[0] - pose.pos[0], c[1] - pose.pos[1], c[2] - pose.pos[2]);
    const d = _rel.length();
    const Rt = v.atmo.uniforms.uRt.value;
    if (d < Rt * 1.02) return true;
    const px = (Rt / d) * this.stats.renderH / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    if (px < 0.75) return false;
    _rel.applyMatrix4(this.camera.matrixWorldInverse);
    // behind the camera beyond the shell's radius
    return _rel.z < Rt;
  }

  private sunScreen(pose: CameraPose, primary: PlanetVisual | null): SunScreen {
    const s = this.sun;
    s.uv.set(-10, -10); s.onScreen = false; s.color.set(1, 1, 1); s.strength = 0;
    this.sunElevation = 1;
    _rel.set(-pose.pos[0], -pose.pos[1], -pose.pos[2]).applyMatrix4(this.camera.matrixWorldInverse);
    if (_rel.z < 0) {
      _rel.applyMatrix4(this.camera.projectionMatrix);
      s.uv.set(_rel.x * 0.5 + 0.5, _rel.y * 0.5 + 0.5);
      s.onScreen = s.uv.x > -0.25 && s.uv.x < 1.25 && s.uv.y > -0.25 && s.uv.y < 1.25;
    }
    const bb = blackbody(5800);
    s.color.set(bb[0], bb[1], bb[2]);
    if (primary && primary.atmo.has) {
      const thick = primary.atmo.thickness;
      const inside = 1 - Math.min(1, Math.max(0, (primary.altitude - thick) / (thick * 2)));
      // sun elevation at the camera: low suns give warm, strong shafts
      const up = _up.copy(primary.camBody).normalize();
      const sb = primary.uniforms.uSunDirBody.value as Vector3;
      const el = up.dot(sb);
      this.sunElevation = primary.altitude < thick * 2 ? el : 1;
      const warm = 1 - Math.min(1, Math.max(0, (el - 0.02) / 0.35));
      s.color.set(1, 1 - 0.35 * warm, 1 - 0.65 * warm);
      s.strength = inside * Math.min(1, Math.max(0, (el + 0.03) / 0.08)) * (0.6 + 0.4 * warm);
    }
    return s;
  }

  private updateStats(): void {
    const info = this.three.info;
    this.stats.drawCalls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    let p = 0, w = 0, hc = 0;
    for (const v of this.planets.values()) { p += v.lod.stats.patches; w += v.lod.stats.waterPatches; hc += v.lod.stats.horizonCulled; }
    this.stats.gpuPatches = p;
    this.stats.waterPatches = w;
    this.stats.horizonCulled = hc;
  }

  /** read the canvas as a PNG data URL right after a render (no preserveDrawingBuffer needed in the same task) */
  snapshotDataURL(): string {
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.godfx.dispose();
    this.ships.dispose();
    for (const v of this.planets.values()) v.dispose();
    this.planets.clear();
    this.post.dispose();
    this.gtao.dispose();
    this.shadows.dispose();
    this.three.dispose();
  }
}
