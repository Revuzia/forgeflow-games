// GENESIS — the Renderer (CONTRACT.md §15): WebGL2 + logarithmic depth, floating origin, every planet / sky / post
// pass per frame in the order of §15.2:
//   shadows (primary planet, near the surface) → opaque scene into HDR (starfield, star, terrain, orbit lines)
//   → scene copies → water → clouds (reduced res) → atmosphere composite per planet (far → near)
//   → god rays → bloom → exposure → lens flare + AgX + grade → FXAA + grain → canvas.
// It reads the WorldView and a CameraPose; it never writes the world.

import {
  Frustum, Matrix3, Matrix4, NoToneMapping, PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer, type IUniform,
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
import { QUALITY, type Quality, type QualityName } from './quality.ts';
import { nearestPlanet, sunIlluminance, type CameraPose } from './frame.ts';
import { blackbody } from '../client/orbits.ts';

export interface RenderStats {
  drawCalls: number;
  triangles: number;
  frameMs: number;
  gpuPatches: number;
  waterPatches: number;
  primary: string;
  altitude: number;
  renderW: number;
  renderH: number;
}

export interface BrushPreview { planet: number; dir: [number, number, number]; radius: number; color?: [number, number, number] }

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
const WEATHER_LOOK = new Map<string, { cloud: number; eye: boolean }>(
  (BASE_PACK.weather ?? []).map((w) => [w.id, { cloud: Math.max(0, Number(w.render?.cloud ?? 0)), eye: !!w.render?.eye }]),
);
const _w2b = new Matrix3();
const _m4 = new Matrix4();
const _up = new Vector3();
const _atmoList: PlanetVisual[] = [];

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
  readonly star = new StarVisual();
  readonly starfield = new Starfield();
  readonly orbits = new OrbitLines();
  readonly planets = new Map<number, PlanetVisual>();
  readonly waterScene: Record<string, IUniform> = makeWaterSceneUniforms();
  readonly settings: PostSettings = { bloom: 0.045, godRays: true, fxaa: true, grain: 0.02, vignette: 0.22, flare: 1, exposureBias: 0, manualExposure: 0 };
  readonly stats: RenderStats = { drawCalls: 0, triangles: 0, frameMs: 0, gpuPatches: 0, waterPatches: 0, primary: '', altitude: 0, renderW: 0, renderH: 0 };
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
    this.clouds.setSize(Math.max(2, Math.round(w * this.quality.cloudScale)), Math.max(2, Math.round(h * this.quality.cloudScale)));
    this.orbits.setResolution(w, h);
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
      vis.frameUpdate({
        camWorldInverse, frustum: this.frustum, camRel: _rel, sunDirWorld: _sun,
        sunE: _sunE.set(starCol[0] * E, starCol[1] * E, starCol[2] * E), time, K, frame: this.frameNo,
        budget: this.cutFrames > 0 ? Math.max(q.patchBudget, 320) : q.patchBudget, primary: isPrimary, shadows: q.shadowCascades > 0, yearFrac: view.calendar(pv).yearFrac,
        vegRange: 380 * q.vegetationRange, vegDensity: q.vegetationDensity, proj: cam.projectionMatrix, grass: q.grass,
      });
      // brush preview
      const u = vis.uniforms;
      u.uDebug.value = this.debugView;
      if (this.brush && this.brush.planet === pv.id) {
        u.uBrushOn.value = 1;
        u.uBrush.value.set(this.brush.dir[0], this.brush.dir[1], this.brush.dir[2], this.brush.radius / pv.params.radius);
        if (this.brush.color) u.uBrushColor.value.set(...this.brush.color);
      } else u.uBrushOn.value = 0;
      vis.atmo.update(r, this.fsq);
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

    // ── shadows near the surface of the primary planet ──
    const alt = primaryVis ? primaryVis.altitude : 1e9;
    this.stats.altitude = alt;
    this.stats.primary = primaryPv?.name ?? '';
    const wantShadows = !!primaryVis && q.shadowCascades > 0 && alt < 3500;
    if (primaryVis) primaryVis.uniforms.uShadowOn.value = wantShadows ? 1 : 0;
    if (wantShadows && primaryVis) {
      const pv = primaryVis.pv;
      _sun.set(pv.sunDir[0], pv.sunDir[1], pv.sunDir[2]);
      const far = Math.min(q.shadowDistance, Math.max(300, alt * 14 + 600));
      const near = Math.max(0.5, Math.min(alt * 0.2, 50));
      this.shadows.fit(cam, _sun, q.shadowCascades, near, far, Math.min(4000, pv.params.radius));
      const vis = primaryVis;
      this.shadows.render(r, this.scene, (depth) => vis.swapDepth(depth));
    } else {
      this.shadows.uniforms.uShadowOn.value = 0;
    }

    // ── opaque scene → HDR ──
    const post = this.post;
    cam.layers.set(0);
    r.setRenderTarget(post.hdr);
    r.setClearColor(0x000000, 1);
    r.render(this.scene, cam);
    // ── water (reads copies of colour and linear depth) ──
    post.copyForWater(r, this.fsq, cam.far);
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

    // ── clouds + atmosphere composites ──
    _invProj.copy(cam.projectionMatrixInverse);
    _camRot.setFromMatrix4(cam.matrixWorld);
    let input = post.hdr.texture;
    let outIdx = 0;
    const atmoVis = _atmoList;
    atmoVis.length = 0;
    for (const v of this.planets.values()) if (v.atmo.has && this.shellVisible(v, pose)) atmoVis.push(v);
    atmoVis.sort((a, b) => this.distOf(b, pose) - this.distOf(a, pose));
    for (const vis of atmoVis) {
      const pv = vis.pv;
      const withClouds = vis === primaryVis && vis.hasClouds && !!vis.cloudCube;
      const planetPos = _planetPos.set(pv.center[0] - pose.pos[0], pv.center[1] - pose.pos[1], pv.center[2] - pose.pos[2]);
      const sunDir = _sunDir.set(pv.sunDir[0], pv.sunDir[1], pv.sunDir[2]);
      if (withClouds) {
        this.clouds.bind(vis.atmo, vis.cloudCube!.texture);
        const w2b = _w2b.setFromMatrix4(_m4.makeRotationFromQuaternion(vis.group.quaternion).invert());
        // the sim's weather systems organise the cloud cover (spiral arms, cores, eyes); a planet-wide override
        // organises into storm tracks
        _storms.length = 0;
        for (const w of pv.weather) {
          const def = WEATHER_LOOK.get(w.kind);
          if (!def || def.cloud <= 0.3) continue;
          _storms.push({ pos: w.pos, radius: w.radius, intensity: w.intensity * Math.min(1, def.cloud), eye: def.eye });
        }
        const g = pv.params.globalWeather ? WEATHER_LOOK.get(pv.params.globalWeather) : undefined;
        this.clouds.setWeather(_storms, pv.params.radius, g && g.cloud > 0.5 ? 1 : 0);
        _bodyToClip.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse).multiply(vis.group.matrixWorld);
        this.clouds.render(r, this.fsq, {
          depth: post.depthTexture, invProj: _invProj, camRot: _camRot, worldToBody: w2b, far: cam.far, planetPos, sunDir,
          innerR: vis.cloudInner, outerR: vis.cloudOuter, frame: this.frameNo, altitude: vis.camBody.length() - pv.params.radius, radius: pv.params.radius,
          bodyToClip: _bodyToClip, planetId: pv.id,
        }, q.cloudSteps, q.cloudLightSteps);
      }
      const m = this.atmoPass.material;
      this.atmoPass.bind(vis.atmo);
      const u = m.uniforms;
      u.tScene.value = input;
      u.tDepth.value = post.depthTexture;
      u.tCloud.value = this.clouds.target.texture;
      u.uHasCloud.value = withClouds ? 1 : 0;
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
      u.uApScale.value = 0.12 + 0.14 * orbitK;
      u.uApRamp.value.set(0.03 + (0.12 + 0.14 * orbitK - 0.03) * orbitK, 300, 2000);
      const target = outIdx === 0 ? post.atmoA : post.atmoB;
      this.fsq.render(r, m, target);
      input = target.texture;
      outIdx ^= 1;
    }

    // ── white balance: like a camera set to "daylight here", neutralise the sun's colour at ~50° elevation on the
    // world we are at, so noon light reads white while sunsets (much redder than that) stay warm
    const cutNow = this.wbSnap;
    this.whiteBalance(primaryVis, starCol);
    // ── post ──
    post.keepPrevious(r, this.fsq, input);
    const sun = this.sunScreen(pose, primaryVis);
    post.setKey(this.sunElevation > -2 ? 0.075 + 0.085 * Math.min(1, Math.max(0, this.sunElevation / 0.3)) : 0.16);
    // golden-hour grade: strongest with the sun a few degrees up, gone by mid-morning and in full night
    {
      const el = this.sunElevation;
      const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
      const want = (1 - ss(0.04, 0.36, el)) * ss(-0.14, -0.02, el);
      const g = this.post.tonemapMat.uniforms.uGolden;
      g.value += (want - g.value) * (cutNow ? 1 : Math.min(1, dt * 3));
    }
    post.finish(r, this.fsq, input, this.settings, sun, dt, time, null);
    if (this.cutFrames > 0) this.cutFrames--;
    this.updateStats();
    this.stats.frameMs = performance.now() - t0;
  }

  /** sine of the sun's elevation at the camera (1 when not near a planet with air) */
  sunElevation = 1;
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
    let p = 0, w = 0;
    for (const v of this.planets.values()) { p += v.lod.stats.patches; w += v.lod.stats.waterPatches; }
    this.stats.gpuPatches = p;
    this.stats.waterPatches = w;
  }

  /** read the canvas as a PNG data URL right after a render (no preserveDrawingBuffer needed in the same task) */
  snapshotDataURL(): string {
    return this.canvas.toDataURL('image/png');
  }

  dispose(): void {
    for (const v of this.planets.values()) v.dispose();
    this.planets.clear();
    this.post.dispose();
    this.shadows.dispose();
    this.three.dispose();
  }
}
