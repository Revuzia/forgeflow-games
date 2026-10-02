// WOBBLEHOARD stage: owns the WebGLRenderer, the camera rig, the set, and the per-body view (jelly + core + face + fx).
// `createStage(canvas)` implements StageLike (src/contracts.ts). `createStageDev` returns the same object with a few
// extra dev-only members (renderer access, memory counters, context-loss helpers) for the render harness.
//
// Camera conventions (the SHELL lane reads these):
//   orbit(dYaw, dPitch): radians, OrbitControls feel: pass (dx * k, dy * k) of a pointer drag and the scene turns with the
//     finger (dragging right turns the scene right, dragging down looks more from above).
//   zoom(delta): positive = camera away. Wheel deltaY in pixels (|delta| > 4, x0.0016) or notches (|delta| <= 4, x0.12).
import * as THREE from 'three';
import type { FxKind, QualityTier, SoftBodyLike, StageFrameInput, StageLike, V3 } from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { clamp } from '../core/rng.ts';
import { EnvHub, KEY_DIR, RIM_DIR } from './env.ts';
import { genomePalette } from './oklch.ts';
import { JellyMaterials } from './material.ts';
import { JellyView } from './jelly.ts';
import { Core } from './core.ts';
import { Face } from './face.ts';
import { Fx } from './fx.ts';
import { Table, PALETTE, type Footprint } from './table.ts';
import { QualityGovernor, TIERS } from './quality.ts';

export interface StageDev extends StageLike {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  /** renderer.info snapshot: live geometries / textures / programs and the last frame's calls / triangles. */
  memory(): { geometries: number; textures: number; programs: number; calls: number; triangles: number };
  /** Simulate WebGL context loss / restore (WEBGL_lose_context). Returns false when the extension is missing. */
  loseContext(): boolean;
  restoreContext(): boolean;
  readonly info: { fineVertices: number; tier: QualityTier; mode: QualityTier | 'auto'; fx: { bubbles: number; glitter: number; puffs: number } | null; contextLost: boolean };
}

const TARGET_Y = 0.42;

export function createStageDev(canvas: HTMLCanvasElement): StageDev {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(PALETTE.ink, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 200);

  // ---- lights: sodium-amber key (soft pool on the felt), cold lagoon rim from behind, dim violet hemisphere fill ----
  const key = new THREE.SpotLight(PALETTE.amber, 240, 0, 0.62, 1, 2);
  key.position.copy(KEY_DIR).multiplyScalar(5.6);
  key.target.position.set(0, 0.2, 0);
  const rim = new THREE.DirectionalLight(PALETTE.lagoon, 2.0);
  rim.position.copy(RIM_DIR).multiplyScalar(6);
  const fill = new THREE.HemisphereLight(0x7a5ac8, 0x2a2150, 2.4);
  scene.add(key, key.target, rim, fill);

  const hub = new EnvHub(renderer, 128);
  const table = new Table(hub);
  scene.add(table.group);

  const governor = new QualityGovernor();
  let tier = governor.tier;
  renderer.transmissionResolutionScale = TIERS[tier].transmissionScale;

  // ---- camera rig ----
  let yaw = 0, pitch = 0.27, zoomF = 1;
  let tYaw = yaw, tPitch = pitch, tZoom = zoomF;
  const tgt = new THREE.Vector3(0, TARGET_Y, 0);
  let trauma = 0, shakeScale = 1;
  let cssW = 1, cssH = 1, dpr = 1;
  let bodyScale = 1;
  let floatMode = false;
  let disposed = false, lost = false;
  let lastRenderMs = 0;
  let lastCalls = 0, lastTris = 0;
  const eyeLook = new THREE.Vector3();

  // ---- per-body view ----
  interface View { body: SoftBodyLike; genome: Genome; mats: JellyMaterials; jelly: JellyView; core: Core; face: Face; fx: Fx }
  let view: View | null = null;
  const fp: Footprint = { cx: 0, cz: 0, rx: 0.5, rz: 0.5, lowY: 0, compression: 0, stretch: 0 };
  let smComp = 0, smStretch = 0;

  const fitDistance = (): number => bodyScale * Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect));

  function applySize(): void {
    renderer.setPixelRatio(Math.min(dpr, TIERS[tier].dprCap));
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
  }

  function disposeView(): void {
    if (!view) return;
    scene.remove(view.jelly.mesh, view.core.group, view.face.group, view.fx.group);
    view.jelly.dispose(); view.core.dispose(); view.face.dispose(); view.fx.dispose(); view.mats.dispose();
    view = null;
  }

  function applyTier(t: QualityTier): void {
    tier = t;
    const spec = TIERS[t];
    renderer.transmissionResolutionScale = spec.transmissionScale;
    applySize();
    if (view) {
      view.jelly.mesh.material = view.mats.get(t);
      if (view.jelly.freq !== spec.fineFreq) view.jelly.rebuild(spec.fineFreq);
      view.fx.setTier(spec);
    }
    governor.resetWindow(24);
  }

  function syncView(dt: number, time: number): void {
    const v = view;
    if (!v) return;
    const body = v.body, m = body.metrics;
    v.jelly.update();
    smComp += (m.compression - smComp) * (1 - Math.exp(-dt * 14));
    smStretch += (m.stretch - smStretch) * (1 - Math.exp(-dt * 10));
    v.core.update(body, dt, time);
    const u = v.mats.uniforms;
    u.uTime.value = time;
    u.uCompress.value = smComp;
    u.uStretch.value = smStretch;
    u.uCoreWorld.value.copy(v.core.center);
    u.uCoreAmt.value = 0.3 * v.core.amount;
    const j = v.jelly;
    fp.cx = (j.minX + j.maxX) * 0.5; fp.cz = (j.minZ + j.maxZ) * 0.5;
    fp.rx = (j.maxX - j.minX) * 0.5; fp.rz = (j.maxZ - j.minZ) * 0.5;
    fp.lowY = j.minY; fp.compression = smComp; fp.stretch = smStretch;
  }

  function updateCamera(dt: number, time: number): void {
    const k = 1 - Math.exp(-dt * 12);
    yaw += (tYaw - yaw) * k;
    pitch += (tPitch - pitch) * k;
    zoomF += (tZoom - zoomF) * k;
    // follow the body gently (it can drift when shoved or floating)
    let wx = 0, wy = TARGET_Y * bodyScale, wz = 0;
    if (view) {
      const c = view.body.center;
      wx = c.x * 0.6; wz = c.z * 0.6;
      wy = TARGET_Y * bodyScale + Math.max(0, c.y - TARGET_Y * bodyScale) * 0.7;
    }
    const kt = 1 - Math.exp(-dt * 6);
    tgt.x += (wx - tgt.x) * kt; tgt.y += (wy - tgt.y) * kt; tgt.z += (wz - tgt.z) * kt;
    const d = fitDistance() * zoomF;
    const cp = Math.cos(pitch);
    camera.position.set(tgt.x + d * Math.sin(yaw) * cp, tgt.y + d * Math.sin(pitch), tgt.z + d * Math.cos(yaw) * cp);
    // shake impulse: decaying trauma, smooth multi-sine noise (deterministic, no Math.random)
    trauma = Math.max(0, trauma - dt * 1.7);
    const amt = trauma * trauma * shakeScale;
    if (amt > 1e-4) {
      const s = amt * 0.045 * d / 3;
      eyeLook.set(
        Math.sin(time * 47.1) + 0.6 * Math.sin(time * 71.3 + 1.3),
        Math.sin(time * 53.7 + 2.1) + 0.6 * Math.sin(time * 83.9 + 0.4),
        Math.sin(time * 41.3 + 4.2),
      ).multiplyScalar(s);
      camera.position.add(eyeLook);
    }
    camera.lookAt(tgt);
    camera.updateMatrixWorld();
  }

  const onLost = (e: Event): void => { e.preventDefault(); lost = true; };
  const onRestored = (): void => {
    lost = false;
    try { hub.rebuild(renderer); } catch { /* a second loss mid-restore: the next restore rebuilds it */ }
    governor.resetWindow(30);
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  applySize();

  const stage: StageDev = {
    canvas,
    camera,
    renderer,
    scene,

    setBody(body, genome) {
      if (disposed) return;
      disposeView();
      const palette = genomePalette(genome);
      bodyScale = body.restRadius / 0.5;
      const mats = new JellyMaterials(genome, palette, bodyScale, hub);
      const spec = TIERS[tier];
      const jelly = new JellyView(body, mats.get(tier), spec.fineFreq);
      jelly.mesh.renderOrder = 10;
      const core = new Core(genome, palette, bodyScale);
      const face = new Face(body, genome, jelly, bodyScale, hub);
      const fx = new Fx(genome, palette, jelly.mapper, spec, bodyScale);
      table.setPoolColor(palette.pool);
      scene.add(jelly.mesh, core.group, face.group, fx.group);
      view = { body, genome, mats, jelly, core, face, fx };
      smComp = body.metrics.compression; smStretch = body.metrics.stretch;
      tgt.set(body.center.x * 0.6, TARGET_Y * bodyScale, body.center.z * 0.6);
      syncView(0, 0);
      face.update(0, 0, null, camera);
      fx.update(0, 0, body);
      governor.resetWindow(24);
    },

    update(dt, input: StageFrameInput) {
      if (disposed) return;
      const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      const time = Number.isFinite(input.time) ? input.time : 0;
      updateCamera(d, time);
      syncView(d, time);
      if (view) {
        view.face.update(d, time, input.pointerNdc, camera);
        view.fx.update(d, time, view.body);
      }
      table.update(d, time, camera, view ? fp : null);
    },

    render() {
      if (disposed || lost) return;
      const now = performance.now();
      if (lastRenderMs > 0) {
        const next = governor.sample(now - lastRenderMs);
        if (next) applyTier(next);
      }
      lastRenderMs = now;
      renderer.render(scene, camera);
      lastCalls = renderer.info.render.calls;
      lastTris = renderer.info.render.triangles;
    },

    resize(width, height, devicePixelRatio) {
      cssW = Math.max(1, Math.floor(width)); cssH = Math.max(1, Math.floor(height));
      dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
      applySize();
      governor.resetWindow(10);
    },

    orbit(dYaw, dPitch) {
      if (!Number.isFinite(dYaw) || !Number.isFinite(dPitch)) return;
      tYaw -= dYaw;
      tPitch = clamp(tPitch + dPitch, 0.06, 1.38);   // never under the table, never exactly top-down
    },

    zoom(delta) {
      if (!Number.isFinite(delta)) return;
      const k = Math.abs(delta) > 4 ? 0.0016 : 0.12;
      tZoom = clamp(tZoom * Math.exp(delta * k), 0.55, 1.9);
    },

    shake(amount) {
      if (!Number.isFinite(amount)) return;
      trauma = Math.min(1, trauma + clamp(amount, 0, 1) * 0.85);
    },
    setShakeScale(scale) { shakeScale = Number.isFinite(scale) ? clamp(scale, 0, 2) : 1; if (shakeScale === 0) trauma = 0; },

    setQuality(q) {
      const next = governor.setMode(q);
      if (next) applyTier(next);
    },

    setFloatMode(on) { floatMode = !!on; table.setFloat(floatMode); },

    spawnFx(kind: FxKind, at: V3, intensity: number) { view?.fx.spawn(kind, at, intensity); },

    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      disposeView();
      table.dispose();
      hub.dispose();
      renderer.dispose();
    },

    stats() {
      return { drawCalls: lastCalls, triangles: lastTris, tier: governor.tier, frameMsEma: governor.frameMsEma };
    },

    memory() {
      const i = renderer.info;
      return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : 0, calls: i.render.calls, triangles: i.render.triangles };
    },

    loseContext() {
      const ext = renderer.getContext().getExtension('WEBGL_lose_context');
      if (!ext) return false;
      ext.loseContext();
      return true;
    },
    restoreContext() {
      const ext = renderer.getContext().getExtension('WEBGL_lose_context');
      if (!ext) return false;
      ext.restoreContext();
      return true;
    },
    get info() {
      return { fineVertices: view?.jelly.fineCount ?? 0, tier: governor.tier, mode: governor.mode, fx: view?.fx.counts ?? null, contextLost: lost };
    },
  };
  return stage;
}

export function createStage(canvas: HTMLCanvasElement): StageLike {
  return createStageDev(canvas);
}
