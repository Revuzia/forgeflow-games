/// <reference types="vite/client" />
// WOBBLEHOARD stage: owns the WebGLRenderer, the camera rig, the set, and a LIST of body views (multi-body: the play squishy, or
// two parents plus the result during a ceremony), the capsule, the shared particle system, and the ceremony director.
// `createStage(canvas)` implements StageLike (src/contracts.ts). In a DEV build (Vite dev server: the harness, ?dev=1) the same object also
// carries a few dev-only members (renderer access, memory counters, context-loss helpers, the `info` readout, the ceremony internals);
// they sit behind `import.meta.env.DEV`, so `vite build` drops them. `createStageDev` is the typed accessor the render harness uses.
//
// Camera conventions (the SHELL lane reads these):
//   orbit(dYaw, dPitch): radians, OrbitControls feel: pass (dx * k, dy * k) of a pointer drag and the scene turns with the finger.
//   zoom(delta): positive = camera away. Wheel deltaY in pixels (|delta| > 4, x0.0016) or notches (|delta| <= 4, x0.12).
//
// Round 2, how the shell drives the ceremonies (DESIGN 6.1-6.6; audio sync per _spec/SOUND.md "Time map"):
//   * Bodies: setBody(body, genome) = clearBodies() + addBody(body, genome) at tier 'common'; call setBodyTier(primaryBodyId(), tier) for the
//     squishy's real tier. The SHELL steps every body it added (body.step(dt) before stage.update); the stage steps only the bodies it creates
//     itself through spec.createBody (ceremony parents / results) until they are handed over.
//   * Meter full: h = dropCapsule({ onLand }) (calm: it fades in where it stands, no drop). Tap / hold test with h.hitTest(cssX, cssY);
//     while the finger holds it, h.setSqueeze(holdSeconds / 0.5) (0 on cancel); at 1 (or on a tap) fetch the result, then
//     playCapsuleReveal({ result, createBody, capsule: h }, { onBeat }). The reveal continues the squeeze; the tier tell appears at 'crack'.
//     From then on the reveal OWNS that capsule: h reads as opening (screenPoint() null, hitTest false, setSqueeze / wobble / remove
//     ignored) and the reveal disposes it at its end; a dropCapsule() during a reveal (the next meter-full) makes an independent capsule.
//   * Merge: playMergeCeremony({ parents (MERGE_COST of them, 2 or 3), result, createBody }, { onBeat }). Every visible body is hidden
//     at the start (the parents are new stage-owned bodies) and removed at the end.
//   * Both: beats arrive through hooks.onBeat(beat, { t, tier }) in time order. handle.duration is the planned length; handle.skip() (after
//     350 ms, DESIGN 6.1) jumps to the final reveal frame with a 120 ms crossfade, fires 'reveal' + 'settle' if they had not fired.
//     handle.done always resolves (natural end, skip, a new ceremony started over it, dispose), never rejects. AFTER done:
//     handle.resultBody is the primary body (primaryBodyId() === handle.resultBodyId); the stage has stopped stepping it, so the shell
//     adopts it as its play body: step it, raycast it, send fingers to it (its render offset is 0, its physics origin is the world origin).
//     Do NOT setBody() it (that would rebuild its view and drop its tier styling).
//   * setCalmEffects(on): call before starting a ceremony (a running one keeps its timing, camera and particle choices; the flash governor
//     switches at once, so turning calm ON mid-ceremony also refuses that ceremony's remaining screen ramp and rings: the safe direction).
//   * Framing: a merge frames the pad wider than the play view by result tier (Common 1.0 .. Epic+ 1.12; a cut at its start, eased back
//     during T4) and, on a narrow portrait frame, until both starting parents fit (up to 1.5); calm keeps only the fit and cuts back at
//     the burst. A capsule waiting on the table is put away during a merge and fades back in beside the result (one dropped DURING a
//     merge lands, onLand, when it fades in after it).
//   * Flash safety across ceremonies: granted burst flashes start >= 1 s apart (the FlashGovernor); a burst inside that second is played
//     SOFT (no screen ramp, its tell / pool / particles / dome at a quarter) and a skip inside a burst fades like the burst light. So a
//     chain of skip + Fast-open quick pops stays at <= 2 luminance transitions per second without any help from the shell.
//   * clearBodies() / removeBody() during a ceremony first end it at its final frame (as setBody does): the result is never orphaned.
//     A throwing createBody leaves the stage as it was (capsule back on the table, play body visible) and the error reaches the caller.
//     A disposed stage hands out inert handles (done resolved, resultBody null) instead of throwing.
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
import { safeTier } from './rarity.ts';
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
    bodies: number; primary: number | null; ceremony: boolean; particles: number; calm: boolean; screenLight: number; capsule: boolean; cameraFx: { dist: number; yaw: number; pitch: number };
    particlesDropped: number; camScale: number;
  };
  readonly views: readonly BodyView[];
  readonly flash: FlashGovernor;
}

const TARGET_Y = 0.42;
const NO_LEAK: [number, number, number] = [1, 1, 1];

/** What a disposed stage hands out instead of throwing: a ceremony that is already over (done resolved, no result) / a capsule that is gone. */
const INERT_CEREMONY: CeremonyHandle = Object.freeze({
  done: Promise.resolve(), skip(): void { /* nothing to skip */ }, active: false, duration: 0, resultBody: null, resultBodyId: null,
});
const INERT_CAPSULE: CapsuleHandle = Object.freeze({
  id: 0, landed: false, screenPoint: () => null, hitTest: () => false,
  setSqueeze(): void { /* gone */ }, wobble(): void { /* gone */ }, remove(): void { /* gone */ },
});
const farFirst = (a: BodyView, b: BodyView): number => b.sortDepth - a.sortDepth;

function buildStage(canvas: HTMLCanvasElement): StageLike {
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
  // camera framing scale: eases toward the primary body's size (or the ceremony result's size from its burst on), so a result
  // that is bigger or smaller than the body it replaces never makes the framing jump; skip() snaps it (the crossfade hides that)
  let camScale = 1;
  let framing: number | null = null;
  let floatMode = false, floatT = 0;
  let calm = false;
  let disposed = false, lost = false;
  let lastRenderMs = 0;
  let lastCalls = 0, lastTris = 0;
  let stageTime = 0;
  const shakeVec = new THREE.Vector3();

  // ---- bodies ----
  const views: BodyView[] = [];
  const depthOrder: BodyView[] = [];   // reused every frame (no allocation): visible views, far to near
  let primaryId: number | null = null;
  let nextId = 1;
  let capsule: Capsule | null = null;   // the meter-full capsule out on the table (the shell's CapsuleHandle points at it)
  let revealCap: Capsule | null = null; // the capsule a running reveal took over (opening; owned by the ceremony until it releases it)
  let capsuleParked = false;           // a merge put the waiting capsule away while it runs
  let parkedOnLand: (() => void) | null = null;   // a capsule dropped DURING a merge lands (onLand) when it fades in after it
  let capsuleId = 0;

  const primary = (): BodyView | null => { for (const v of views) if (v.id === primaryId) return v; return null; };
  const fitDistance = (): number => camScale * Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect));

  /**
   * Where the meter-full capsule lands: beside the primary body when the frame is wide enough to show it whole, else in front of it.
   * During a ceremony the primary may be sliding off (capsule reveal) or hidden (merge): the capsule goes beside the PAD, where the result lands.
   */
  function capsuleSpot(p: BodyView | null): { x: number; z: number } {
    const sc = p ? p.scale : 1, cx = p && !director.active ? p.proxy.center.x : 0;
    const R = 0.24, D = fitDistance(), hw = D * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
    for (const zf of [0.15, 0, -0.2]) {
      const z = zf * sc, hwz = hw * Math.max(0.3, (D - z) / D);          // half-width of the frame at that depth
      const x = Math.min(0.95 * sc, hwz * 0.86 - R * 1.3);
      if (x >= 0.7 * sc) return { x: cx + x, z };
    }
    const zf = 1.85 * sc, hwf = hw * Math.max(0.3, (D - zf) / D);
    return { x: cx + Math.max(0, hwf * 0.9 - R * 1.25), z: zf };                         // narrow portrait frame: in front of it, lower in the picture
  }

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
    if (primaryId === null) { primaryId = v.id; bodyScale = v.scale; if (!director.active) camScale = bodyScale; }
    return v;
  }
  function removeView(v: BodyView): void {
    const i = views.indexOf(v);
    if (i >= 0) views.splice(i, 1);
    v.dispose();
    if (primaryId === v.id) { primaryId = views.length ? views[0].id : null; }
  }
  function discardCapsule(): void { if (capsule) { capsule.dispose(); capsule = null; } capsuleParked = false; }
  function discardRevealCapsule(): void { if (revealCap) { revealCap.dispose(); revealCap = null; } }

  function applyTier(t: QualityTier): void {
    tier = t;
    const spec = TIERS[t];
    renderer.transmissionResolutionScale = spec.transmissionScale;
    table.setLite(t === 'low');
    applySize();
    for (const v of views) v.applyQuality(spec);
    capsule?.applyTier(!spec.transmission);
    revealCap?.applyTier(!spec.transmission);
    governor.resetWindow(24);
  }

  function updateCamera(dt: number, time: number): void {
    const k = 1 - Math.exp(-dt * 12);
    yaw += (tYaw - yaw) * k;
    pitch += (tPitch - pitch) * k;
    zoomF += (tZoom - zoomF) * k;
    camScale += ((framing ?? bodyScale) - camScale) * (1 - Math.exp(-dt * 4));
    // follow the primary body gently (it can drift when shoved or floating); a ceremony keeps the pad centred
    let wx = 0, wy = TARGET_Y * camScale, wz = 0;
    const p = primary();
    if (p && !director.active) {
      const c = p.proxy.center;
      wx = c.x * 0.6; wz = c.z * 0.6;
      wy = TARGET_Y * camScale + Math.max(0, c.y - TARGET_Y * camScale) * 0.7;
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
    makePrimary(v) { primaryId = v.id; v.owned = false; bodyScale = v.scale; framing = null; },
    setFraming(scale, snap) { framing = scale; if (snap) camScale = scale ?? bodyScale; },
    takeCapsule() {
      discardRevealCapsule();
      let c = capsule;
      // no capsule out (a reveal without a meter-full drop): one fades in at the pad (popping in, it was a luminance step of its own)
      if (!c) { c = new Capsule(hub, quad, !TIERS[tier].transmission); c.calm = calm; c.appear(0, 0.25, undefined, 0.2); scene.add(c.group); capsuleId++; }
      capsule = null;
      revealCap = c;
      return c;
    },
    releaseCapsule(c) { if (revealCap === c) discardRevealCapsule(); else if (capsule === c) discardCapsule(); },
    returnCapsule(c) {
      if (revealCap !== c) return;
      revealCap = null;
      if (capsule) discardCapsule();     // (a new drop arrived meanwhile: the returned one wins, it was there first)
      capsule = c; c.setCrack(0, 0, NO_LEAK, false); c.setSqueeze(0);
    },
    parkCapsule(on) {
      if (!capsule) return;
      if (on) { capsuleParked = true; capsule.group.visible = false; capsule.touchedDown = false; return; }
      if (!capsuleParked) return;
      capsuleParked = false;
      const p = primary(), spot = capsuleSpot(p), cb = parkedOnLand;
      parkedOnLand = null;
      capsule.appear(spot.x, spot.z, cb ?? undefined);   // fades back in beside the result (onLand only if it was dropped DURING the merge)
    },
    addToScene: (o) => { scene.add(o); },
    removeFromScene: (o) => { scene.remove(o); },
    crossfade(seconds, shape) {
      if (disposed || lost) return;            // nothing to snapshot (dispose / a lost context): the jump is a plain cut
      renderer.render(scene, camera);          // the current state, into the framebuffer we are about to snapshot
      screen.beginCrossfade(renderer, seconds, shape);
    },
    shake(a) { if (!calm) stage.shake(a); },
    viewHalfWidth: (scale?: number) => (scale === undefined ? fitDistance() : fitDistance() * scale / camScale) * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect,
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

  const stage: StageLike & RoundTwo = {
    canvas,
    camera,

    setBody(body, genome) {
      if (disposed) return;
      director.abort();
      stage.clearBodies();
      const v = addView(body, genome, 'common', false);
      primaryId = v.id; bodyScale = v.scale; camScale = bodyScale; framing = null;
      tgt.set(body.center.x * 0.6, TARGET_Y * bodyScale, body.center.z * 0.6);
      governor.resetWindow(24);
    },

    addBody(body, genome, opts?: AddBodyOpts) {
      if (disposed) return -1;
      const v = addView(body, genome, safeTier(opts?.tier), false, opts?.position);
      governor.resetWindow(24);
      return v.id;
    },
    // a running ceremony owns its bodies (and adopts the result at its end): removing bodies under it first ends it at its final frame,
    // exactly as setBody does, so the result is never orphaned (a primary id pointing at a removed view)
    removeBody(id) { const v = views.find((x) => x.id === id); if (!v) return; if (director.active) director.abort(); if (views.includes(v)) removeView(v); },
    clearBodies() { director.abort(); while (views.length) removeView(views[views.length - 1]); primaryId = null; },
    primaryBodyId() { return primaryId; },
    setBodyTier(id, t) { views.find((x) => x.id === id)?.setTier(safeTier(t)); },
    setCalmEffects(on) {
      calm = !!on; flash.calm = calm;
      for (const v of views) v.setCalm(calm);
      particles.setTwinkle(!calm);
      if (capsule) capsule.calm = calm;
      if (revealCap) revealCap.calm = calm;
      if (calm) { cameraFx.dist = 1; cameraFx.yaw = 0; cameraFx.pitch = 0; screen.stopRamp(); }
    },

    dropCapsule(opts) {
      if (disposed) return INERT_CAPSULE;
      discardCapsule();
      capsule = new Capsule(hub, quad, !TIERS[tier].transmission);
      const c = capsule;
      const id = ++capsuleId;
      const p = primary();
      const spot = capsuleSpot(p);
      const x = opts?.at?.x ?? spot.x, z = opts?.at?.z ?? spot.z;
      c.calm = calm;
      if (director.kind === 'merge') {     // the pad is busy: it waits out of sight and fades in beside the result when the merge ends
        c.placeStanding(x, z); c.group.visible = false; c.touchedDown = false; capsuleParked = true; parkedOnLand = opts?.onLand ?? null;
      } else if (calm) c.appear(x, z, opts?.onLand); else c.drop(x, z, opts?.onLand);   // calm / reduced motion: it fades in, no drop
      scene.add(c.group);
      const sp = { x: 0, y: 0, r: 0 };
      const handle: CapsuleHandle = {
        id,
        get landed() { return capsule === c && c.touchedDown; },
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
      if (disposed) return INERT_CEREMONY;
      return director.startCapsule(spec, hooks);
    },
    playMergeCeremony(spec: MergeCeremonySpec, hooks?: CeremonyHooks): CeremonyHandle {
      if (disposed) return INERT_CEREMONY;
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
        v.clock += d;                     // every view ages, hidden ones too (a ceremony result is created hidden at t = 0)
        if (!v.visible) continue;
        v.update(d, v.clock, input.pointerNdc, camera, floatT, v.owned ? d * ts : 0);
      }
      // Back-to-front order of the translucent jellies. Their meshes sit at the origin with world-space vertices, so three's own
      // transparent / transmissive sort sees one depth for all of them and falls back to creation order (a back body painted over a front
      // one: plainly wrong in a 3-parent merge). renderOrder 10.00..10.99, far first; everything else keeps its own order.
      depthOrder.length = 0;
      for (const v of views) if (v.visible) depthOrder.push(v);
      for (const v of depthOrder) { const c = v.proxy.center; v.sortDepth = (camera.position.x - c.x) ** 2 + (camera.position.y - c.y) ** 2 + (camera.position.z - c.z) ** 2; }
      depthOrder.sort(farFirst);
      for (let i = 0; i < depthOrder.length; i++) depthOrder[i].jelly.mesh.renderOrder = 10 + Math.min(0.99, i * 0.01);
      capsule?.update(d * ts, time);
      revealCap?.update(d * ts, time);
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
      discardCapsule(); discardRevealCapsule();
      table.dispose(); quad.dispose(); screen.dispose(); particles.dispose();
      hub.dispose();
      renderer.dispose();
    },

    stats() {
      return { drawCalls: lastCalls, triangles: lastTris, tier: governor.tier, frameMsEma: governor.frameMsEma };
    },
  };
  // DEV ONLY: `vite build` replaces import.meta.env.DEV with false and drops this block (and everything only it references)
  if (import.meta.env.DEV) {
    let loseExt: WEBGL_lose_context | null = null;
    Object.defineProperties(stage, {
      renderer: { value: renderer },
      scene: { value: scene },
      views: { get: () => views },
      flash: { value: flash },
      memory: { value: () => { const i = renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs ? i.programs.length : 0, calls: i.render.calls, triangles: i.render.triangles }; } },
      loseContext: {
        value: () => {
          loseExt ??= renderer.getContext().getExtension('WEBGL_lose_context');   // must be fetched BEFORE the loss: a lost context returns null
          if (!loseExt) return false;
          loseExt.loseContext(); return true;
        },
      },
      restoreContext: { value: () => { if (!loseExt) return false; loseExt.restoreContext(); return true; } },
      info: {
        get: () => {
          const p = primary();
          return {
            fineVertices: p?.jelly.fineCount ?? 0, tier: governor.tier, mode: governor.mode, fx: p?.fx.counts ?? null, contextLost: lost,
            pixelRatio: renderer.getPixelRatio(), drawingBuffer: [canvas.width, canvas.height] as [number, number],
            eyeLook: p ? Array.from(p.face.lookOut) : null,
            bodies: views.length, primary: primaryId, ceremony: director.active, particles: particles.count, calm, screenLight: screen.lightAlpha, capsule: !!capsule || !!revealCap, cameraFx,
            particlesDropped: particles.dropped, camScale,
          };
        },
      },
    });
  }
  return stage;
}

/** The stage (StageLike, every round-2 member). */
export function createStage(canvas: HTMLCanvasElement): StageLike {
  return buildStage(canvas);
}

/** The same stage with its dev members typed (render harness; the members exist only in a DEV build). */
export function createStageDev(canvas: HTMLCanvasElement): StageDev {
  return buildStage(canvas) as StageDev;
}
