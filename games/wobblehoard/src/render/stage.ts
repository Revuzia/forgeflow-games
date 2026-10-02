// WOBBLEHOARD stage: owns the WebGLRenderer, the camera rig, the set, and a LIST of body views (multi-body: the play squishy, or
// two parents plus the result during a ceremony), the capsule, the shared particle system, and the ceremony director.
// `createStage(canvas)` implements StageLike (src/contracts.ts). `createStageDev` returns the same object with a few extra dev-only
// members (renderer access, memory counters, context-loss helpers, the ceremony internals) for the render harness.
//
// Camera conventions (the SHELL lane reads these):
//   orbit(dYaw, dPitch): radians, OrbitControls feel: pass (dx * k, dy * k) of a pointer drag and the scene turns with the finger.
//   zoom(delta): positive = camera away. Wheel deltaY in pixels (|delta| > 4, x0.0016) or notches (|delta| <= 4, x0.12).
import * as THREE from 'three';
import type {
  AddBodyOpts, CapsuleHandle, CapsuleRevealSpec, CeremonyHandle, CeremonyHooks, FxKind, MergeCeremonySpec, QualityTier, SoftBodyLike,
  StageFrameInput, StageLike, TierName, V3,
} from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { clamp } from '../core/rng.ts';
import { BodyView } from './bodyview.ts';
import { Capsule } from './capsule.ts';
import { CeremonyDirector, type CeremonyHost } from './ceremony.ts';
import { createDecalGeometry } from './decals.ts';
import { EnvHub, KEY_DIR, RIM_DIR } from './env.ts';
import { FlashGovernor } from './flash.ts';
import { Particles } from './particles.ts';
import { QualityGovernor, TIERS } from './quality.ts';
import { ScreenFx } from './screenfx.ts';
import { Table, PALETTE } from './table.ts';

type RoundTwo = Required<Pick<StageLike, 'addBody' | 'removeBody' | 'clearBodies' | 'primaryBodyId' | 'setBodyTier' | 'setCalmEffects' | 'dropCapsule' | 'playCapsuleReveal' | 'playMergeCeremony'>>;

export interface StageDev extends Omit<StageLike, keyof RoundTwo>, RoundTwo {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  /** renderer.info snapshot: live geometries / textures / programs and the last frame's calls / triangles. */
  memory(): { geometries: number; textures: number; programs: number; calls: number; triangles: number };
  /** Simulate WebGL context loss / restore (WEBGL_lose_context). Returns false when the extension is missing. */
  loseContext(): boolean;
  restoreContext(): boolean;
  readonly info: {
    fineVertices: number; tier: QualityTier; mode: QualityTier | 'auto'; fx: { bubbles: number; glitter: number; puffs: number } | null;
    contextLost: boolean; pixelRatio: number; drawingBuffer: [number, number]; eyeLook: number[] | null;
    bodies: number; primary: number | null; ceremony: boolean; particles: number; calm: boolean; screenLight: number; capsule: boolean;
  };
  readonly views: readonly BodyView[];
  readonly flash: FlashGovernor;
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
  const quad = createDecalGeometry();
  const screen = new ScreenFx();
  scene.add(screen.light, screen.fade);
  const particles = new Particles(360, 33);
  scene.add(particles.mesh);
  const flash = new FlashGovernor();

  const governor = new QualityGovernor();
  let tier = governor.tier;
  renderer.transmissionResolutionScale = TIERS[tier].transmissionScale;

  // ---- camera rig ----
  let yaw = 0, pitch = 0.27, zoomF = 1;
  let tYaw = yaw, tPitch = pitch, tZoom = zoomF;
  const tgt = new THREE.Vector3(0, TARGET_Y, 0);
  const cameraFx = { dist: 1, yaw: 0, pitch: 0 };   // ceremony push / pull-back / arc, layered on top of the user's orbit (never touches the targets)
  let trauma = 0, shakeScale = 1;
  let cssW = 1, cssH = 1, dpr = 1;
  let bodyScale = 1;
  let floatMode = false, floatT = 0;
  let calm = false;
  let disposed = false, lost = false;
  let loseExt: WEBGL_lose_context | null = null;
  let lastRenderMs = 0;
  let lastCalls = 0, lastTris = 0;
  let stageTime = 0;
  const shakeVec = new THREE.Vector3();

  // ---- bodies ----
  const views: BodyView[] = [];
  let primaryId: number | null = null;
  let nextId = 1;
  let capsule: Capsule | null = null;
  let capsuleId = 0;

  const primary = (): BodyView | null => views.find((v) => v.id === primaryId) ?? null;
  const fitDistance = (): number => bodyScale * Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect));

  function applySize(): void {
    renderer.setPixelRatio(Math.min(dpr, TIERS[tier].dprCap));
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
  }

  function addView(body: SoftBodyLike, genome: Genome, t: TierName, owned: boolean, pos?: V3): BodyView {
    const v = new BodyView(nextId++, body, genome, t, TIERS[tier], hub, quad, owned);
    v.setCalm(calm);
    if (pos) v.proxy.setOffset(pos.x, pos.y, pos.z);
    scene.add(v.group);
    views.push(v);
    if (primaryId === null) { primaryId = v.id; bodyScale = v.scale; }
    return v;
  }
  function removeView(v: BodyView): void {
    const i = views.indexOf(v);
    if (i >= 0) views.splice(i, 1);
    v.dispose();
    if (primaryId === v.id) { primaryId = views.length ? views[0].id : null; }
  }
  function discardCapsule(): void { if (capsule) { capsule.dispose(); capsule = null; } }

  function applyTier(t: QualityTier): void {
    tier = t;
    const spec = TIERS[t];
    renderer.transmissionResolutionScale = spec.transmissionScale;
    table.setLite(t === 'low');
    applySize();
    for (const v of views) v.applyQuality(spec);
    capsule?.applyTier(!spec.transmission);
    governor.resetWindow(24);
  }

  function updateCamera(dt: number, time: number): void {
    const k = 1 - Math.exp(-dt * 12);
    yaw += (tYaw - yaw) * k;
    pitch += (tPitch - pitch) * k;
    zoomF += (tZoom - zoomF) * k;
    // follow the primary body gently (it can drift when shoved or floating); a ceremony keeps the pad centred
    let wx = 0, wy = TARGET_Y * bodyScale, wz = 0;
    const p = primary();
    if (p && !director.active) {
      const c = p.proxy.center;
      wx = c.x * 0.6; wz = c.z * 0.6;
      wy = TARGET_Y * bodyScale + Math.max(0, c.y - TARGET_Y * bodyScale) * 0.7;
    }
    const kt = 1 - Math.exp(-dt * 6);
    tgt.x += (wx - tgt.x) * kt; tgt.y += (wy - tgt.y) * kt; tgt.z += (wz - tgt.z) * kt;
    const d = fitDistance() * zoomF * cameraFx.dist;
    const yw = yaw + cameraFx.yaw, pt = clamp(pitch + cameraFx.pitch, 0.06, 1.38);
    const cp = Math.cos(pt);
    camera.position.set(tgt.x + d * Math.sin(yw) * cp, tgt.y + d * Math.sin(pt), tgt.z + d * Math.cos(yw) * cp);
    // shake impulse: decaying trauma, smooth multi-sine noise (deterministic, no Math.random)
    trauma = Math.max(0, trauma - dt * 1.7);
    const amt = trauma * trauma * shakeScale;
    if (amt > 1e-4) {
      const s = amt * 0.08 * d / 3;
      shakeVec.set(
        Math.sin(time * 47.1) + 0.6 * Math.sin(time * 71.3 + 1.3),
        Math.sin(time * 53.7 + 2.1) + 0.6 * Math.sin(time * 83.9 + 0.4),
        Math.sin(time * 41.3 + 4.2),
      ).multiplyScalar(s);
      camera.position.add(shakeVec);
    }
    camera.lookAt(tgt);
    camera.updateMatrixWorld();
  }

  // ---- ceremony host ----
  const host: CeremonyHost = {
    flash, screen, particles, cameraFx,
    calm: () => calm,
    now: () => stageTime,
    createOwned(genome, createBody, t) { return addView(createBody(genome), genome, t, true); },
    allViews: () => views,
    removeView,
    makePrimary(v) { primaryId = v.id; v.owned = false; bodyScale = v.scale; },
    capsule: () => capsule,
    ensureCapsule() {
      if (!capsule) { capsule = new Capsule(hub, quad, !TIERS[tier].transmission); capsule.placeStanding(0, 0.25); scene.add(capsule.group); capsuleId++; }
      return capsule;
    },
    discardCapsule,
    addToScene: (o) => { scene.add(o); },
    removeFromScene: (o) => { scene.remove(o); },
    crossfade(seconds) {
      renderer.render(scene, camera);          // the current state, into the framebuffer we are about to snapshot
      screen.beginCrossfade(renderer, seconds);
    },
    shake(a) { if (!calm) stage.shake(a); },
  };
  const director = new CeremonyDirector(host);

  const onLost = (e: Event): void => { e.preventDefault(); lost = true; };
  const onRestored = (): void => {
    lost = false;
    // three re-uploads geometry, textures and programs by itself; the baked environment cube is a render target, so bake it again
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
    get views() { return views; },
    flash,

    setBody(body, genome) {
      if (disposed) return;
      director.abort();
      stage.clearBodies();
      const v = addView(body, genome, 'common', false);
      primaryId = v.id; bodyScale = v.scale;
      tgt.set(body.center.x * 0.6, TARGET_Y * bodyScale, body.center.z * 0.6);
      governor.resetWindow(24);
    },

    addBody(body, genome, opts?: AddBodyOpts) {
      if (disposed) return -1;
      const v = addView(body, genome, opts?.tier ?? 'common', false, opts?.position);
      governor.resetWindow(24);
      return v.id;
    },
    removeBody(id) { const v = views.find((x) => x.id === id); if (v) removeView(v); },
    clearBodies() { while (views.length) removeView(views[views.length - 1]); primaryId = null; },
    primaryBodyId() { return primaryId; },
    setBodyTier(id, t) { views.find((x) => x.id === id)?.setTier(t); },
    setCalmEffects(on) {
      calm = !!on; flash.calm = calm;
      for (const v of views) v.setCalm(calm);
      if (calm) { cameraFx.dist = 1; cameraFx.yaw = 0; cameraFx.pitch = 0; screen.setLight(0, 0, 0, 0); }
    },

    dropCapsule(opts) {
      if (disposed) throw new Error('stage disposed');
      discardCapsule();
      capsule = new Capsule(hub, quad, !TIERS[tier].transmission);
      const c = capsule;
      const id = ++capsuleId;
      const p = primary();
      const x = opts?.at?.x ?? (p ? p.proxy.center.x + 0.82 * p.scale : 0.82), z = opts?.at?.z ?? 0.62;
      c.drop(x, z, opts?.onLand);
      scene.add(c.group);
      const sp = { x: 0, y: 0, r: 0 };
      const handle: CapsuleHandle = {
        id,
        get landed() { return capsule === c && c.landed; },
        screenPoint() { return capsule === c ? c.screenPoint(camera, cssW, cssH, sp) : null; },
        hitTest(x2, y2, slop = 14) {
          const s = capsule === c ? c.screenPoint(camera, cssW, cssH, sp) : null;
          return !!s && Math.hypot(x2 - s.x, y2 - s.y) <= s.r + slop;
        },
        setSqueeze(pr) { if (capsule === c) c.setSqueeze(pr); },
        wobble(s = 1) { if (capsule === c) c.wobble(3.5 * s); },
        remove() { if (capsule === c) discardCapsule(); },
      };
      return handle;
    },
    playCapsuleReveal(spec: CapsuleRevealSpec, hooks?: CeremonyHooks): CeremonyHandle {
      if (disposed) throw new Error('stage disposed');
      return director.startCapsule(spec, hooks);
    },
    playMergeCeremony(spec: MergeCeremonySpec, hooks?: CeremonyHooks): CeremonyHandle {
      if (disposed) throw new Error('stage disposed');
      return director.startMerge(spec, hooks);
    },

    update(dt, input: StageFrameInput) {
      if (disposed) return;
      const d = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
      const time = Number.isFinite(input.time) ? input.time : 0;
      stageTime = time;
      // the ceremony runs first: it moves the puppets and returns the time scale (slow-mo dips slow physics and particles only)
      const ts = director.update(d);
      floatT += ((floatMode ? 1 : 0) - floatT) * (1 - Math.exp(-d * 5));
      updateCamera(d, time);
      table.update(camera);
      for (const v of views) {
        if (!v.visible) continue;
        v.update(d, time, input.pointerNdc, camera, floatT, v.owned ? d * ts : 0);
      }
      capsule?.update(d * ts, time);
      particles.update(d * ts, time);
      screen.update(d);
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

    setFloatMode(on) { floatMode = !!on; },

    spawnFx(kind: FxKind, at: V3, intensity: number) { primary()?.spawnFx(kind, at, intensity); },

    dispose() {
      if (disposed) return;
      disposed = true;
      director.abort();
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      while (views.length) removeView(views[views.length - 1]);
      discardCapsule();
      table.dispose(); quad.dispose(); screen.dispose(); particles.dispose();
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
      loseExt ??= renderer.getContext().getExtension('WEBGL_lose_context');   // must be fetched BEFORE the loss: a lost context returns null
      if (!loseExt) return false;
      loseExt.loseContext();
      return true;
    },
    restoreContext() {
      if (!loseExt) return false;
      loseExt.restoreContext();
      return true;
    },
    get info() {
      const p = primary();
      return {
        fineVertices: p?.jelly.fineCount ?? 0, tier: governor.tier, mode: governor.mode, fx: p?.fx.counts ?? null, contextLost: lost,
        pixelRatio: renderer.getPixelRatio(), drawingBuffer: [canvas.width, canvas.height] as [number, number],
        eyeLook: p ? Array.from(p.face.lookOut) : null,
        bodies: views.length, primary: primaryId, ceremony: director.active, particles: particles.count, calm, screenLight: screen.lightAlpha, capsule: !!capsule,
      };
    },
  };
  return stage;
}

export function createStage(canvas: HTMLCanvasElement): StageLike {
  return createStageDev(canvas);
}
