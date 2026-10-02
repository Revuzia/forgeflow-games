/// <reference types="vite/client" />
// Render viewer (dev harness, RENDER lane). Creates the Stage and a soft body (the REAL one from src/physics/softbody.ts
// when it exists and loads, else the dev stub), then drives deterministic scripted scenarios and exposes window.__RV__.
//   ?genome=<seed|g1.code>  ?quality=low|med|high|auto  ?state=rest|press|stretch|float|bounce  ?body=stub|real  ?loop=1 (live rAF)
import * as THREE from 'three';
import { createStageDev, type StageDev } from '../../src/render/stage.ts';
import { StubBody } from '../../src/render/stubBody.ts';
import { genomeFromParam, type Genome } from '../../src/core/genome.ts';
import type { FxKind, QualityTier, SoftBodyCtor, SoftBodyLike, SoftEvent, V3 } from '../../src/contracts.ts';

type BodyKind = 'real' | 'stub';
const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;

const realLoaders = import.meta.glob('/src/physics/softbody.ts');

let bodyKind: BodyKind = 'stub';
let bodyError: string | null = null;
let RealBody: SoftBodyCtor | null = null;

async function loadReal(): Promise<void> {
  const loader = realLoaders['/src/physics/softbody.ts'];
  if (!loader) { bodyError = 'src/physics/softbody.ts does not exist yet'; return; }
  try {
    const mod = (await loader()) as { SoftBody?: SoftBodyCtor };
    if (mod.SoftBody) RealBody = mod.SoftBody; else bodyError = 'softbody.ts has no SoftBody export';
  } catch (e) {
    bodyError = 'softbody.ts failed to load: ' + (e instanceof Error ? e.message : String(e));
  }
}

function makeBody(genome: Genome): SoftBodyLike {
  const want = params.get('body');
  if (RealBody && want !== 'stub') { bodyKind = 'real'; return new RealBody(genome); }
  bodyKind = 'stub';
  return new StubBody(genome);
}

const stage: StageDev = createStageDev(canvas);
let genome: Genome = genomeFromParam(params.get('genome'));
let body: SoftBodyLike;
let time = 0;
let frameNo = 0;
let pointer: { x: number; y: number } | null = null;
let autoFx = true;
const events: SoftEvent[] = [];
const seen: SoftEvent[] = [];

// scripted finger (id 0)
const press = { on: false, holdT: 0, target: 0.8, ramp: 0.9 };
let pulling = false;

const ray = new THREE.Vector3();
function cameraRay(nx: number, ny: number): { origin: V3; dir: V3 } {
  stage.camera.updateMatrixWorld();
  ray.set(nx, ny, 0.5).unproject(stage.camera);
  const o = stage.camera.position;
  ray.sub(o).normalize();
  return { origin: { x: o.x, y: o.y, z: o.z }, dir: { x: ray.x, y: ray.y, z: ray.z } };
}

function setupBody(g: Genome): void {
  genome = g;
  body = makeBody(g);
  stage.setBody(body, g);
  stage.setFloatMode(!body.gravity);
  press.on = false; pulling = false;
}

function frame(dt: number, render = true): void {
  if (press.on) {
    press.holdT += dt;
    body.fingerPressure(0, Math.min(press.target, (press.holdT / press.ramp) * press.target));
  }
  body.step(dt);
  events.length = 0;
  body.drainEvents(events);
  for (const e of events) {
    seen.push(e); if (seen.length > 64) seen.shift();
    if (!autoFx) continue;
    if (e.kind === 'land') { stage.spawnFx('dust', e.at, e.intensity); stage.spawnFx('ring', e.at, e.intensity); }
    else if (e.kind === 'release' && e.intensity > 0.35) stage.spawnFx('bubbles', { x: e.at.x, y: e.at.y + 0.05, z: e.at.z }, e.intensity);
    else if (e.kind === 'snap') stage.spawnFx('glitter', e.at, e.intensity);
  }
  time += dt;
  frameNo++;
  stage.update(dt, { time, pointerNdc: pointer });
  if (render) stage.render();
}

const cstat = document.createElement('canvas');
const cctx = cstat.getContext('2d', { willReadFrequently: true });

const RV = {
  get bodyKind() { return bodyKind; },
  get bodyError() { return bodyError; },
  get genome() { return genome; },
  get frameNo() { return frameNo; },
  get time() { return time; },
  stage,
  get body() { return body; },
  get events() { return seen; },

  /** Advance n fixed steps. Only the LAST frame is rendered unless renderAll (software GL is slow). */
  frames(n = 1, dt = 1 / 60, renderAll = false): void { for (let i = 0; i < n; i++) frame(dt, renderAll || i === n - 1); },
  /** Render the current state n times, waiting for the GPU (gl.finish) after each; returns mean ms per frame. */
  timeRender(n = 5): number {
    const gl = stage.renderer.getContext();
    const px = new Uint8Array(4);
    const sync = (): void => { gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }; // forces the GPU to finish
    stage.render(); sync();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { stage.update(1 / 60, { time: (time += 1 / 60), pointerNdc: pointer }); stage.render(); sync(); }
    return (performance.now() - t0) / n;
  },
  /** Render now and return the canvas as a PNG data URL (same task as the render, so it is never blank). */
  snapshot(): string { stage.render(); return canvas.toDataURL('image/png'); },
  setAutoFx(on: boolean): void { autoFx = on; },
  setGenome(seedOrCode: string | number): void { setupBody(genomeFromParam(String(seedOrCode))); },
  setGenomeObject(g: Genome): void { setupBody(g); },
  setQuality(q: QualityTier | 'auto'): void { stage.setQuality(q); },
  setPointer(x: number | null, y = 0): void { pointer = x === null ? null : { x, y }; },
  resize(w: number, h: number, dpr: number): void { stage.resize(w, h, dpr); },

  /** Finger down at an NDC point on the body, then ramp the pressure over `ramp` seconds (advance with frames()). */
  press(nx: number, ny: number, target = 0.8, ramp = 0.9): boolean {
    const r = cameraRay(nx, ny);
    const hit = body.raycast(r.origin, r.dir);
    if (!hit) return false;
    body.fingerDown(0, { point: hit.point, normal: hit.normal, dir: r.dir });
    press.on = true; press.holdT = 0; press.target = target; press.ramp = ramp;
    return true;
  },
  moveFinger(nx: number, ny: number): void {
    const r = cameraRay(nx, ny);
    const hit = body.raycast(r.origin, r.dir);
    if (hit) body.fingerMove(0, hit.point);
  },
  release(): void { if (press.on) { press.on = false; body.fingerUp(0); } },
  /** Grab the surface under (nx, ny) and pull it by (dx, dy) in the camera plane (world units). */
  pull(nx: number, ny: number, dx: number, dy: number): boolean {
    const r = cameraRay(nx, ny);
    const hit = body.raycast(r.origin, r.dir);
    if (!hit) return false;
    const cam = stage.camera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const target = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z).addScaledVector(right, dx).addScaledVector(up, dy);
    body.grab(0, hit.vertex, { x: hit.point.x, y: hit.point.y, z: hit.point.z });
    body.grabMove(0, { x: target.x, y: target.y, z: target.z });
    pulling = true;
    return true;
  },
  releasePull(): void { if (pulling) { body.grabRelease(0); pulling = false; } },
  setGravity(on: boolean): void { body.gravity = on; stage.setFloatMode(!on); },
  nudge(x: number, y: number, z: number): void { body.nudge({ x, y, z }); },
  spawn(kind: FxKind, x: number, y: number, z: number, k = 0.8): void { stage.spawnFx(kind, { x, y, z }, k); },
  orbit(dYaw: number, dPitch: number): void { stage.orbit(dYaw, dPitch); },
  zoom(d: number): void { stage.zoom(d); },

  /** Canvas sanity numbers from the CURRENT frame (render() then read in the same task). */
  canvasStats(): { w: number; h: number; mean: number; std: number; nonBg: number; distinct: number } {
    stage.render();
    const W = 160, H = Math.max(1, Math.round((160 * canvas.height) / canvas.width));
    cstat.width = W; cstat.height = H;
    if (!cctx) return { w: canvas.width, h: canvas.height, mean: 0, std: 0, nonBg: 0, distinct: 0 };
    cctx.drawImage(canvas, 0, 0, W, H);
    const d = cctx.getImageData(0, 0, W, H).data;
    let s = 0, s2 = 0, n = 0, nonBg = 0;
    const seenCols = new Set<number>();
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      s += l; s2 += l * l; n++;
      if (Math.abs(d[i] - 0x14) > 8 || Math.abs(d[i + 1] - 0x10) > 8 || Math.abs(d[i + 2] - 0x2a) > 8) nonBg++;
      seenCols.add(((d[i] >> 2) << 12) | ((d[i + 1] >> 2) << 6) | (d[i + 2] >> 2));
    }
    const mean = s / n;
    return { w: canvas.width, h: canvas.height, mean, std: Math.sqrt(Math.max(0, s2 / n - mean * mean)), nonBg: nonBg / n, distinct: seenCols.size };
  },

  /** RGB of the current frame at canvas pixel coordinates (renders first). For look-dev numbers. */
  samplePixels(pts: [number, number][]): number[][] {
    stage.render();
    const c2 = document.createElement('canvas');
    c2.width = canvas.width; c2.height = canvas.height;
    const x2 = c2.getContext('2d', { willReadFrequently: true });
    if (!x2) return [];
    x2.drawImage(canvas, 0, 0);
    return pts.map(([x, y]) => Array.from(x2.getImageData(x, y, 1, 1).data.slice(0, 3)));
  },
  stats() { return stage.stats(); },
  memory() { return stage.memory(); },
  info() { return stage.info; },

  /** N full setBody cycles (fresh body each time); returns renderer.info.memory after each. */
  memoryCycles(n = 20, variants = false): { geometries: number; textures: number; programs: number }[] {
    const out: { geometries: number; textures: number; programs: number }[] = [];
    const g0 = genome;
    for (let i = 0; i < n; i++) {
      const g = variants ? genomeFromParam(String(100 + i)) : g0;
      const b = makeBody(g);
      stage.setBody(b, g);
      stage.update(1 / 60, { time: i, pointerNdc: null });
      stage.render();
      const m = stage.memory();
      out.push({ geometries: m.geometries, textures: m.textures, programs: m.programs });
    }
    setupBody(g0);
    return out;
  },

  /** JS heap growth over `n` update (and optionally render) frames. Needs --enable-precise-memory-info --js-flags=--expose-gc. */
  heapProbe(n: number, withRender: boolean): { before: number; after: number; deltaKB: number } | null {
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const gc = (globalThis as unknown as { gc?: () => void }).gc;
    if (!mem || !gc) return null;
    for (let i = 0; i < 60; i++) frame(1 / 60); // warm up (shader compiles, JIT)
    press.on = false;
    gc(); gc();
    const before = mem.usedJSHeapSize;
    for (let i = 0; i < n; i++) {
      body.step(1 / 60);
      time += 1 / 60;
      if (i % 90 === 0) { body.nudge({ x: 0.4, y: 0.6, z: 0.1 }); }
      stage.update(1 / 60, { time, pointerNdc: { x: Math.sin(time), y: Math.cos(time * 0.7) } });
      if (withRender) stage.render();
    }
    gc(); gc();
    const after = mem.usedJSHeapSize;
    return { before, after, deltaKB: (after - before) / 1024 };
  },
};

declare global { interface Window { __RV__?: typeof RV; __RV_READY__?: boolean } }
window.__RV__ = RV;

async function boot(): Promise<void> {
  await loadReal();
  resizeToWindow();
  setupBody(genome);
  const q = params.get('quality');
  if (q === 'low' || q === 'med' || q === 'high' || q === 'auto') stage.setQuality(q);
  else stage.setQuality('high');
  const st = params.get('state') ?? 'rest';
  runState(st);
  window.__RV_READY__ = true;
  if (params.get('loop') === '1') {
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      frame(dt);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

function runState(state: string): void {
  RV.frames(120);
  switch (state) {
    case 'press': RV.press(0.0, 0.1, 0.85, 0.5); RV.frames(40); break;
    case 'stretch': RV.pull(0.0, 0.25, 0.25, 0.55); RV.frames(40); break;
    case 'float': RV.setGravity(false); RV.frames(150); break;
    case 'bounce': RV.nudge(0, 3.2, 0); RV.frames(48); break;
    default: break;
  }
}

function resizeToWindow(): void { stage.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1); }
window.addEventListener('resize', resizeToWindow);

boot().catch((e) => { console.error('renderview boot failed', e); });
