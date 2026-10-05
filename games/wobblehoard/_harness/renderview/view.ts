/// <reference types="vite/client" />
// Render viewer (dev harness, RENDER lane). Creates the Stage and a soft body (the REAL one from src/physics/softbody.ts
// when it exists and loads, else the dev stub), then drives deterministic scripted scenarios and exposes window.__RV__.
//   ?genome=<seed|g1.code>  ?quality=low|med|high|auto  ?state=rest|press|stretch|float|bounce  ?body=stub|real  ?loop=1 (live rAF)
import * as THREE from 'three';
import { createStageDev, type StageDev } from '../../src/render/stage.ts';
import { StubBody } from '../../src/render/stubBody.ts';
import { genomeFromParam, type Genome } from '../../src/core/genome.ts';
import type { CapsuleHandle, CeremonyHandle, FxKind, QualityTier, SoftBodyCtor, SoftBodyLike, SoftEvent, TierName, V3 } from '../../src/contracts.ts';
import { capsuleDuration, mergeDuration } from '../../src/render/ceremony.ts';

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

/** Blank-canvas numbers from whatever the canvas holds right now (call in the same task as render()). */
function frameStats(): { w: number; h: number; mean: number; std: number; nonBg: number; distinct: number } {
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
}


// ---- ceremony / multi-body scripting (round 2) ----
const LUMA_LUT = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
const lumaCanvas = document.createElement('canvas');
lumaCanvas.width = 64; lumaCanvas.height = 48;
const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
/** Mean RELATIVE luminance (linear light, 0..1) of the canvas as it is right now (call right after a render). */
function meanLuma(): number {
  if (!lumaCtx) return 0;
  lumaCtx.drawImage(canvas, 0, 0, 64, 48);
  const d = lumaCtx.getImageData(0, 0, 64, 48).data;
  let s = 0;
  for (let i = 0; i < d.length; i += 4) s += 0.2126 * LUMA_LUT[d[i]] + 0.7152 * LUMA_LUT[d[i + 1]] + 0.0722 * LUMA_LUT[d[i + 2]];
  return s / (d.length / 4);
}
interface BeatRec { beat: string; t: number; tier: string; frame: number }
const cer = { handle: null as CeremonyHandle | null, kind: '', tier: '' as TierName | '', beats: [] as BeatRec[], lumas: [] as number[], frames: 0, duration: 0, dt: 1 / 30, startFrame: 0, tierUp: false, quick: false };
let capsuleHandle: CapsuleHandle | null = null;
let capsuleLanded = 0;

// ---- ceremony body factory: 'auto' = makeBody; 'native' = the dev stub (it implements setFold / moveTo / tremble / burstOpen) with call
// spies; 'puppet' = makeBody behind a Proxy that HIDES the optional drivers, so the render lane's procedural puppet must do the work ----
type DriverMode = 'auto' | 'native' | 'puppet';
const DRIVERS = ['setFold', 'moveTo', 'tremble', 'burstOpen'] as const;
const driverSpy = { setFold: 0, setFoldMax: 0, moveTo: 0, tremble: 0, trembleMax: 0, burstOpen: 0 };
let driverMode: DriverMode = 'auto';
function cerBody(g: Genome): SoftBodyLike {
  if (driverMode === 'auto') return makeBody(g);
  if (driverMode === 'native') {
    const b = new StubBody(g);
    const f = b.setFold.bind(b), tr = b.tremble.bind(b), bo = b.burstOpen.bind(b), mt = b.moveTo.bind(b);
    b.setFold = (t: number) => { driverSpy.setFold++; driverSpy.setFoldMax = Math.max(driverSpy.setFoldMax, t); f(t); };
    b.tremble = (a: number) => { driverSpy.tremble++; driverSpy.trembleMax = Math.max(driverSpy.trembleMax, a); tr(a); };
    b.burstOpen = (s: number) => { driverSpy.burstOpen++; bo(s); };
    b.moveTo = (p: V3 | null, k?: number) => { driverSpy.moveTo++; mt(p, k); };
    return b;
  }
  const inner = makeBody(g);
  const hidden = new Set<string | symbol>(DRIVERS);
  return new Proxy(inner, {
    get(t, k) { if (hidden.has(k)) return undefined; const v = Reflect.get(t, k, t) as unknown; return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v; },
    set(t, k, v) { return Reflect.set(t, k, v, t); },
    has(t, k) { return !hidden.has(k) && Reflect.has(t, k); },
  });
}
const PARENT_SEEDS = ['', '3', '8'];
function resultGenome(tier: TierName): Genome { return genomeFromParam(String(['', '2', '5', '19', '16', '8'][['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'].indexOf(tier)] ?? '')); }
const hooksFor = { onBeat(beat: string, info: { t: number; tier: TierName }): void { cer.beats.push({ beat, t: info.t, tier: info.tier, frame: frameNo }); } };
function resetCer(kind: string, tier: TierName, duration: number): void {
  cer.kind = kind; cer.tier = tier; cer.beats = []; cer.lumas = []; cer.frames = 0; cer.duration = duration; cer.startFrame = frameNo;
}

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
  /** snapshot() plus blank-canvas statistics computed from the very same frame. */
  snapshotStats(): { png: string; stats: ReturnType<typeof frameStats> } {
    stage.render();
    const png = canvas.toDataURL('image/png');
    return { png, stats: frameStats() };
  },
  /** N frames paced by requestAnimationFrame with the real dt (so stats().frameMsEma is a real frame time). */
  async rafFrames(n: number): Promise<{ wallMsPerFrame: number; ema: number }> {
    const t0 = performance.now();
    let last = t0;
    for (let i = 0; i < n; i++) {
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const now = performance.now();
      frame(Math.min(0.05, (now - last) / 1000)); last = now;
    }
    return { wallMsPerFrame: (performance.now() - t0) / n, ema: stage.stats().frameMsEma };
  },
  /** Build + tear down a SECOND stage on a throw-away canvas `cycles` times; report renderer.info.memory at each step. */
  lifecycle(cycles = 20): { after: { geometries: number; textures: number; programs: number }[]; endAfterDispose: { geometries: number; textures: number; programs: number }; err: string | null } {
    const c2 = document.createElement('canvas');
    c2.width = 160; c2.height = 120;
    const s2 = createStageDev(c2);
    s2.resize(160, 120, 1);
    const after: { geometries: number; textures: number; programs: number }[] = [];
    let err: string | null = null;
    try {
      for (let i = 0; i < cycles; i++) {
        const g = genomeFromParam(String(200 + (i % 5)));
        const b = makeBody(g);
        s2.setBody(b, g);
        s2.update(1 / 60, { time: i / 60, pointerNdc: null });
        s2.render();
        const m = s2.memory();
        after.push({ geometries: m.geometries, textures: m.textures, programs: m.programs });
      }
    } catch (e) { err = e instanceof Error ? e.message : String(e); }
    s2.dispose();
    const m = s2.memory();
    return { after, endAfterDispose: { geometries: m.geometries, textures: m.textures, programs: m.programs }, err };
  },
  /** Round 2 leak test on a SECOND stage: 3 bodies at three rarity tiers + a 3-parent merge and a capsule reveal (skipped) per cycle, then dispose. */
  async lifecycle3(cycles = 12): Promise<{ after: { geometries: number; textures: number; programs: number }[]; endAfterDispose: { geometries: number; textures: number; programs: number }; err: string | null }> {
    const c2 = document.createElement('canvas');
    c2.width = 160; c2.height = 120;
    const s2 = createStageDev(c2);
    s2.resize(160, 120, 1);
    const after: { geometries: number; textures: number; programs: number }[] = [];
    let err: string | null = null;
    const TI: TierName[] = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    let t2 = 0;
    const tick = (n: number): void => { for (let k = 0; k < n; k++) { t2 += 1 / 30; s2.update(1 / 30, { time: t2, pointerNdc: null }); s2.render(); } };
    try {
      for (let i = 0; i < cycles; i++) {
        const gs = [0, 1, 2].map((k) => genomeFromParam(String(300 + ((i + k) % 6))));
        s2.clearBodies();
        const ids = gs.map((g, k) => s2.addBody(makeBody(g), g, { tier: TI[(i + k * 2) % 6], position: { x: (k - 1) * 1.1, y: 0, z: 0 } }));
        tick(2);
        s2.setBodyTier(ids[0], TI[(i + 3) % 6]);
        s2.removeBody(ids[1]);
        tick(2);
        if (i % 2 === 0) {
          const h = s2.playMergeCeremony({ parents: gs.map((g) => ({ genome: g, tier: 'common' as TierName })), result: { genome: gs[0], tier: TI[i % 6], tierUp: i % 3 === 0, isNew: true }, createBody: makeBody });
          tick(Math.round(h.duration * 0.3 * 30));
          h.skip();
          tick(12);
        } else {
          const h = s2.playCapsuleReveal({ result: { genome: gs[1], tier: TI[i % 6], isNew: true }, createBody: makeBody });
          tick(Math.round(h.duration * 0.5 * 30));
          h.skip();
          tick(12);
        }
        const m = s2.memory();
        after.push({ geometries: m.geometries, textures: m.textures, programs: m.programs });
      }
    } catch (e) { err = e instanceof Error ? e.message : String(e); }
    s2.dispose();
    const m = s2.memory();
    return { after, endAfterDispose: { geometries: m.geometries, textures: m.textures, programs: m.programs }, err };
  },
  /** Run one WHOLE ceremony deterministically (fixed dt), sampling mean luminance and the screen-light alpha every frame. */
  async runCeremony(o: { kind: 'capsule' | 'merge'; tier: TierName; dt?: number; tierUp?: boolean; calm?: boolean; quick?: boolean; parents?: number; skipAt?: number; settle?: number; drivers?: DriverMode }): Promise<{
    duration: number; budget: number; frames: number; seconds: number; skippedAtFrame: number; activeAfterSkip: number; lumas: number[]; maxLight: number; maxParticles: number;
    beats: BeatRec[]; doneResolved: boolean; resultVisibleAtEnd: boolean; fingerprint: number[]; bodiesAtEnd: number; ramps: number; camRange: number; resultClock: number;
    finalState: { ceremony: boolean; capsule: boolean; screenLight: number; cameraFx: { dist: number; yaw: number; pitch: number }; primaryIsResult: boolean };
    stats: Record<string, number>; drivers: typeof driverSpy; native: boolean[]; foldMax: number; resultHiddenFrames: number; particlesDropped: number;
  }> {
    const dt = o.dt ?? 1 / 30;
    driverMode = o.drivers ?? 'auto';
    for (const k of Object.keys(driverSpy) as (keyof typeof driverSpy)[]) driverSpy[k] = 0;
    const dropped0 = stage.info.particlesDropped;
    let foldMax = 0, resultHiddenFrames = 0;
    const native: boolean[] = [];
    stage.clearBodies();
    setupBody(genomeFromParam(''));
    stage.setCalmEffects(!!o.calm);
    for (let i = 0; i < 20; i++) frame(dt);
    const duration = o.kind === 'capsule' ? RV.capsuleReveal(o.tier, { quick: !!o.quick }) : RV.merge(o.tier, o.parents ?? 2, !!o.tierUp);
    const budget = o.kind === 'capsule' ? capsuleDuration(o.tier, { quick: !!o.quick, calm: false }) : mergeDuration(o.tier, { tierUp: !!o.tierUp, calm: false });
    const h = cer.handle as CeremonyHandle;
    for (const v of stage.views) if (v.owned) native.push(v.proxy.native.fold, v.proxy.native.tremble, v.proxy.native.burst);
    const watch = (): void => {
      for (const v of stage.views) if (v.owned && v.id !== h.resultBodyId) foldMax = Math.max(foldMax, v.proxy.foldAmount);
    };
    const lumas: number[] = [];
    let maxLight = 0, maxParticles = 0, frames = 0, skippedAt = -1, activeAfterSkip = -1, activeFrames = 0, ramps = 0, prevLight = 0, camMove = 0;
    while (h.active && frames < 3000) {
      if (o.skipAt !== undefined && skippedAt < 0 && frames * dt >= o.skipAt) {
        h.skip(); skippedAt = frames;
        let k = 0;
        while (h.active && k < 60) {
          frame(dt); lumas.push(meanLuma()); k++; frames++; maxLight = Math.max(maxLight, stage.info.screenLight);
          const rv = stage.views.find((v) => v.id === h.resultBodyId);
          if (!rv || !rv.visible) resultHiddenFrames++;            // skip() must never hide the result, not even mid-crossfade
        }
        activeAfterSkip = k;
        break;
      }
      frame(dt);
      watch();
      lumas.push(meanLuma());
      const L = stage.info.screenLight;
      maxLight = Math.max(maxLight, L); maxParticles = Math.max(maxParticles, stage.info.particles);
      if (L > 0.01 && prevLight <= 0.01) ramps++;
      prevLight = L;
      const cf = stage.info.cameraFx; camMove = Math.max(camMove, Math.abs(cf.dist - 1), Math.abs(cf.yaw), Math.abs(cf.pitch));
      frames++; activeFrames = frames;
    }
    const natural = skippedAt < 0;
    const stats = { ...(h as unknown as { stats: Record<string, number> }).stats };
    driverMode = 'auto';
    if (h.resultBody) body = h.resultBody;   // what the shell does after `done`: adopt the result as the play body (the stage stops stepping it)
    const doneResolved = await Promise.race([h.done.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 500))]);
    for (let i = 0; i < (o.settle ?? 30); i++) { frame(dt); lumas.push(meanLuma()); }
    const fp = RV.fingerprint();
    return {
      duration, budget, frames: natural ? activeFrames : skippedAt, seconds: (natural ? activeFrames : skippedAt) * dt, skippedAtFrame: skippedAt, activeAfterSkip, lumas, maxLight, maxParticles,
      beats: cer.beats.slice(), doneResolved, resultVisibleAtEnd: !!stage.primaryBodyId() && stage.info.bodies === 1, fingerprint: fp, bodiesAtEnd: stage.info.bodies, ramps, camRange: camMove,
      resultClock: stage.views.find((v) => v.id === h.resultBodyId)?.clock ?? -1,
      stats, drivers: { ...driverSpy }, native, foldMax, resultHiddenFrames, particlesDropped: stage.info.particlesDropped - dropped0,
      finalState: { ceremony: stage.info.ceremony, capsule: stage.info.capsule, screenLight: stage.info.screenLight, cameraFx: { ...stage.info.cameraFx }, primaryIsResult: stage.primaryBodyId() === h.resultBodyId },
    };
  },
  async awaitDone(): Promise<boolean> { if (!cer.handle) return false; await cer.handle.done; return true; },
  /** Lose and restore the WebGL context on a SECOND stage; none of it may throw, and it must render again afterwards. */
  async contextLossTest(): Promise<{ ok: boolean; log: string[] }> {
    const log: string[] = [];
    const c2 = document.createElement('canvas');
    c2.width = 160; c2.height = 120;
    document.body.appendChild(c2);
    c2.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    const s2 = createStageDev(c2);
    s2.resize(160, 120, 1);
    try {
      const g = genomeFromParam('');
      const b = makeBody(g);
      s2.setBody(b, g);
      for (let i = 0; i < 3; i++) { b.step(1 / 60); s2.update(1 / 60, { time: i / 60, pointerNdc: null }); s2.render(); }
      log.push('before loss: ok');
      if (!s2.loseContext()) { log.push('WEBGL_lose_context missing'); return { ok: false, log }; }
      await new Promise((r) => setTimeout(r, 120));
      for (let i = 0; i < 3; i++) { b.step(1 / 60); s2.update(1 / 60, { time: 1 + i / 60, pointerNdc: { x: 0.2, y: 0.1 } }); s2.render(); }
      s2.setBody(b, g); // even a setBody while lost must not throw
      s2.resize(180, 130, 1);
      log.push('while lost: update/render/setBody/resize did not throw; contextLost=' + s2.info.contextLost);
      s2.restoreContext();
      for (let i = 0; i < 100 && s2.info.contextLost; i++) await new Promise((r) => setTimeout(r, 50)); // wait for webglcontextrestored
      log.push('restored event after ~' + 0 + 'ms poll; contextLost=' + s2.info.contextLost);
      for (let i = 0; i < 3; i++) { b.step(1 / 60); s2.update(1 / 60, { time: 2 + i / 60, pointerNdc: null }); s2.render(); }
      const ctx2 = document.createElement('canvas'); ctx2.width = 64; ctx2.height = 48;
      const x2 = ctx2.getContext('2d', { willReadFrequently: true });
      let nonBg = 0;
      if (x2) { s2.render(); x2.drawImage(c2, 0, 0, 64, 48); const d = x2.getImageData(0, 0, 64, 48).data; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x14) > 8 || Math.abs(d[i + 1] - 0x10) > 8 || Math.abs(d[i + 2] - 0x2a) > 8) nonBg++; }
      log.push(`after restore: contextLost=${s2.info.contextLost}, non-background pixels ${(nonBg / (64 * 48) * 100).toFixed(0)}%`);
      return { ok: !s2.info.contextLost && nonBg > 64 * 48 * 0.2, log };
    } catch (e) {
      log.push('THREW: ' + (e instanceof Error ? e.message : String(e)));
      return { ok: false, log };
    } finally { s2.dispose(); c2.remove(); }
  },
  setAutoFx(on: boolean): void { autoFx = on; },
  /** Step (no rendering) until the body emits an event of `kind`; returns the number of frames used, or -1 if none came. */
  framesUntilEvent(kind: string, max = 240, dt = 1 / 60): number {
    for (let n = 1; n <= max; n++) {
      frame(dt, false);
      if (events.some((e) => e.kind === kind)) return n;
    }
    return -1;
  },
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
  canvasStats(): ReturnType<typeof frameStats> { stage.render(); return frameStats(); },

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

  // ---- multi-body, rarity, ceremonies ----
  addBody(seedOrGenome: string | number | Genome, tier: TierName = 'common', x = 0, z = 0): number {
    const g = typeof seedOrGenome === 'object' ? seedOrGenome : genomeFromParam(String(seedOrGenome));
    return stage.addBody(makeBody(g), g, { tier, position: { x, y: 0, z } });
  },
  /** Replace everything with one fresh body of this genome at this rarity tier (for the rarity sheet). */
  showTier(tier: TierName, seedOrGenome: string | number | Genome = ''): number {
    const g = typeof seedOrGenome === 'object' ? seedOrGenome : genomeFromParam(String(seedOrGenome));
    genome = g;
    body = makeBody(g);
    stage.setBody(body, g);
    const id = stage.primaryBodyId() ?? -1;
    stage.setBodyTier(id, tier);
    return id;
  },
  setTier(id: number, tier: TierName): void { stage.setBodyTier(id, tier); },
  clearBodies(): void { stage.clearBodies(); },
  setCalm(on: boolean): void { stage.setCalmEffects(on); },
  dropCapsule(): void { capsuleLanded = 0; capsuleHandle = stage.dropCapsule({ onLand: () => { capsuleLanded = frameNo; } }); },
  get capsule() { return capsuleHandle; },
  get capsuleLandedFrame() { return capsuleLanded; },
  capsuleInfo(): { landed: boolean; point: { x: number; y: number; r: number } | null; hit: boolean } {
    const h = capsuleHandle;
    const p = h ? h.screenPoint() : null;
    return { landed: !!h && h.landed, point: p ? { ...p } : null, hit: !!h && !!p && h.hitTest(p.x + p.r * 0.5, p.y) };
  },
  setSqueeze(p: number): void { capsuleHandle?.setSqueeze(p); },
  capsuleReveal(tier: TierName, o: { quick?: boolean; keepCurrent?: boolean } = {}): number {
    const g = resultGenome(tier);
    const D = capsuleDuration(tier, { quick: o.quick, calm: stage.info.calm });
    resetCer('capsule', tier, D);
    cer.quick = !!o.quick; cer.tierUp = false;
    cer.handle = stage.playCapsuleReveal({ result: { genome: g, tier, isNew: true }, createBody: cerBody, capsule: capsuleHandle ?? undefined, quick: o.quick, keepCurrent: o.keepCurrent }, hooksFor);
    return cer.handle.duration;
  },
  merge(tier: TierName, parents = 2, tierUp = false): number {
    const g = resultGenome(tier);
    const D = mergeDuration(tier, { tierUp, calm: stage.info.calm });
    resetCer('merge', tier, D);
    cer.tierUp = tierUp; cer.quick = false;
    const ps = PARENT_SEEDS.slice(0, parents).map((sd) => ({ genome: genomeFromParam(sd), tier: 'common' as TierName }));
    cer.handle = stage.playMergeCeremony({ parents: ps, result: { genome: g, tier, tierUp, isNew: true }, createBody: cerBody }, hooksFor);
    return cer.handle.duration;
  },
  /** Advance the running ceremony by up to n frames of dt (stops when it ends); records luminance per frame if asked. Returns frames done. */
  cerFrames(n: number, dt = 1 / 30, withLuma = false): number {
    let i = 0;
    for (; i < n && cer.handle && cer.handle.active; i++) {
      frame(dt, withLuma || i === n - 1);
      cer.frames++;
      if (withLuma) cer.lumas.push(meanLuma());
    }
    cer.dt = dt;
    return i;
  },
  /** Drive frames until the ceremony's time reaches `seconds` (ceremony clock = frames x dt). Renders only the last frame unless withLuma. */
  cerSeek(seconds: number, dt = 1 / 30, withLuma = false): void {
    const target = Math.round(seconds / dt);
    while (cer.handle && cer.handle.active && cer.frames < target) {
      frame(dt, withLuma);
      cer.frames++;
      if (withLuma) cer.lumas.push(meanLuma());
    }
    cer.dt = dt;
    stage.render();
  },
  skipCer(): void { cer.handle?.skip(); },
  cerState() { return { active: !!cer.handle && cer.handle.active, frames: cer.frames, seconds: cer.frames * cer.dt, duration: cer.duration, beats: cer.beats, lumas: cer.lumas, kind: cer.kind, tier: cer.tier, info: stage.info, resultId: cer.handle?.resultBodyId ?? null }; },
  /** After the ceremony: the result becomes the viewer's play body. */
  adoptResult(): boolean { const b = cer.handle?.resultBody; if (!b) return false; body = b; return true; },
  lumaNow(): number { stage.render(); return meanLuma(); },
  /** Final-frame fingerprint: downscaled canvas pixels (for the skip-equals-natural-end comparison). */
  fingerprint(): number[] {
    stage.render();
    const c = document.createElement('canvas'); c.width = 48; c.height = 36;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return [];
    x.drawImage(canvas, 0, 0, 48, 36);
    return Array.from(x.getImageData(0, 0, 48, 36).data);
  },
  flashProbe() {
    const f = stage.flash;
    f.reset();
    const out: Record<string, unknown> = {};
    // adversarial: 12 flash requests in one second
    let granted = 0, a = 0;
    for (let i = 0; i < 12; i++) { const r = f.flash(10 + i * 0.08, 0.6); if (r > 0) { granted++; a = Math.max(a, r); } }
    out.flashesIn1s = granted; out.maxAlpha = a;
    // stacked within the 480 ms ramp must be refused
    f.reset(); const first = f.flash(20, 0.2), second = f.flash(20.2, 0.2), third = f.flash(20.6, 0.2), fourth = f.flash(20.9, 0.2);
    out.stack = [first > 0, second > 0, third > 0, fourth > 0];
    // rings
    f.reset(); const r1 = f.ring(30), r2 = f.ring(30.2), r3 = f.ring(30.55), r4 = f.ring(30.7);
    out.rings = [r1, r2, r3, r4];
    // tints
    f.reset(); const t1 = f.tint(40, 'coral'), t2 = f.tint(40.1, 'cyan'), t3 = f.tint(40.3, 'coral'), t4 = f.tint(40.7, 'cyan'), t5 = f.tint(41.0, 'cyan');
    out.tints = [t1, t2, t3, t4, t5];
    // calm
    f.reset(); f.calm = true; out.calmFlash = f.flash(50, 0.2); out.calmRing = f.ring(50); f.calm = false; f.reset();
    return out;
  },

  /**
   * Sky / ground gradient smoothness of the CURRENT framing with every body cleared and the felt mat hidden (only the dome shader is left):
   * 8x8-pixel block luminance; the largest step between neighbouring block columns (a vertical seam) and the largest second difference
   * down a column (a band edge or kink: a smooth gradient has a small one even where it is steep). Restores the scene afterwards.
   */
  skyProbe(): { w: number; h: number; maxColStep: number; maxRowCurv: number; maxRowStep: number; at: number[] } {
    const hiddenVis: [THREE.Object3D, boolean][] = [];
    stage.scene.traverse((o) => { if (o.renderOrder === -50) { hiddenVis.push([o, o.visible]); o.visible = false; } });
    for (const v of stage.views) { hiddenVis.push([v.group, v.group.visible]); v.group.visible = false; }
    stage.render();
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    for (const [o, vis] of hiddenVis) o.visible = vis;
    if (!x) return { w: 0, h: 0, maxColStep: -1, maxRowCurv: -1, maxRowStep: -1, at: [] };
    x.drawImage(canvas, 0, 0);
    const W = c.width, H = c.height, d = x.getImageData(0, 0, W, H).data, B = 8, bw = Math.floor(W / B), bh = Math.floor(H / B);
    const L = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      for (let yy = 0; yy < B; yy++) for (let xx = 0; xx < B; xx++) { const i = ((by * B + yy) * W + bx * B + xx) * 4; sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; }
      L[by * bw + bx] = sum / (B * B);
    }
    let maxColStep = 0, maxRowCurv = 0, maxRowStep = 0, at: number[] = [];
    for (let by = 0; by < bh; by++) for (let bx = 1; bx < bw; bx++) maxColStep = Math.max(maxColStep, Math.abs(L[by * bw + bx] - L[by * bw + bx - 1]));
    for (let bx = 0; bx < bw; bx++) for (let by = 1; by < bh - 1; by++) {
      const a = L[(by - 1) * bw + bx], b = L[by * bw + bx], e = L[(by + 1) * bw + bx];
      maxRowStep = Math.max(maxRowStep, Math.abs(b - a));
      const cv = Math.abs(e - 2 * b + a);
      if (cv > maxRowCurv) { maxRowCurv = cv; at = [bx * B, by * B]; }
    }
    return { w: W, h: H, maxColStep, maxRowCurv, maxRowStep, at };
  },
  /** Screen box (canvas pixels) of the primary body's fine mesh. */
  bodyBox(): { x0: number; y0: number; x1: number; y1: number } | null {
    const v = stage.views.find((w) => w.id === stage.primaryBodyId());
    if (!v) return null;
    const j = v.jelly, cam = stage.camera, p = new THREE.Vector3();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const X of [j.minX, j.maxX]) for (const Y of [j.minY, j.maxY]) for (const Z of [j.minZ, j.maxZ]) {
      p.set(X, Y, Z).project(cam);
      const sx = (p.x * 0.5 + 0.5) * canvas.width, sy = (1 - (p.y * 0.5 + 0.5)) * canvas.height;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, y0, x1, y1 };
  },
  /**
   * Straight horizontal seam detector over the LOWER body (rows 45%..85% of its screen box, the middle 70% of its width): for every row,
   * the fraction of columns whose 2x2-averaged luminance steps by more than 4/255 IN THE SAME DIRECTION into the next row. Shading and
   * glitter give scattered steps (a small fraction); a seam (a table edge or a sprite cut showing through) lines them up in one row.
   */
  seamProbe(): { worstRowFraction: number; row: number; box: number[] } {
    const box = RV.bodyBox();
    stage.render();
    if (!box) return { worstRowFraction: -1, row: -1, box: [] };
    const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return { worstRowFraction: -1, row: -1, box: [] };
    x.drawImage(canvas, 0, 0);
    const W = c.width, d = x.getImageData(0, 0, W, c.height).data;
    const lum = (px: number, py: number): number => { let s = 0; for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) { const i = ((py + yy) * W + px + xx) * 4; s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; } return s / 4; };
    const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    const xa = Math.max(0, Math.round(box.x0 + 0.15 * bw)), xb = Math.min(W - 3, Math.round(box.x1 - 0.15 * bw));
    const ya = Math.max(0, Math.round(box.y0 + 0.45 * bh)), yb = Math.min(c.height - 4, Math.round(box.y0 + 0.85 * bh));
    let worst = 0, row = -1;
    for (let y = ya; y < yb; y += 1) {
      let up = 0, dn = 0, n = 0;
      for (let xx = xa; xx < xb; xx += 2) { const dl = lum(xx, y + 2) - lum(xx, y); if (dl > 4) up++; else if (dl < -4) dn++; n++; }
      const f = Math.max(up, dn) / Math.max(1, n);
      if (f > worst) { worst = f; row = y; }
    }
    return { worstRowFraction: worst, row, box: [box.x0, box.y0, box.x1, box.y1] };
  },
  /**
   * The SAME frozen pose (no stepping, dt 0) rendered at two quality tiers: mean |RGB diff| over the body (middle 70% of its screen box,
   * 10%..90% of its height) and the seam detector for each. For "the low tier must still look good": how far low is from med.
   */
  qualityCompare(a: QualityTier = 'low', b: QualityTier = 'med'): { mae: number; seamA: number; seamB: number; maeChannels: number[]; bias: number[] } {
    const grab = (q: QualityTier): { px: Uint8ClampedArray; seam: number; box: { x0: number; y0: number; x1: number; y1: number } | null } => {
      stage.setQuality(q);
      stage.update(0, { time, pointerNdc: pointer });
      const seam = RV.seamProbe().worstRowFraction;
      stage.render();
      const c = document.createElement('canvas'); c.width = canvas.width; c.height = canvas.height;
      const x = c.getContext('2d', { willReadFrequently: true });
      x?.drawImage(canvas, 0, 0);
      return { px: x ? x.getImageData(0, 0, c.width, c.height).data : new Uint8ClampedArray(0), seam, box: RV.bodyBox() };
    };
    const A = grab(a), B = grab(b);
    const box = B.box;
    if (!box || !A.px.length) return { mae: -1, seamA: A.seam, seamB: B.seam, maeChannels: [], bias: [] };
    const W = canvas.width, bw = box.x1 - box.x0, bh = box.y1 - box.y0;
    let s = 0, n = 0; const ch = [0, 0, 0], bias = [0, 0, 0];
    for (let y = Math.round(box.y0 + 0.1 * bh); y < Math.round(box.y0 + 0.9 * bh); y += 2) for (let x = Math.round(box.x0 + 0.15 * bw); x < Math.round(box.x1 - 0.15 * bw); x += 2) {
      const i = (y * W + x) * 4;
      for (let k = 0; k < 3; k++) { const d = Math.abs(A.px[i + k] - B.px[i + k]); s += d; ch[k] += d; bias[k] += A.px[i + k] - B.px[i + k]; }
      n++;
    }
    return { mae: s / (3 * n), seamA: A.seam, seamB: B.seam, maeChannels: ch.map((v) => v / n), bias: bias.map((v) => v / n) };
  },
  /** Leak test: `cycles` x (add 3 bodies at 3 tiers, render, remove all 3). renderer.info after each cycle. */
  addRemove3(cycles = 20): { geometries: number; textures: number; programs: number }[] {
    const out: { geometries: number; textures: number; programs: number }[] = [];
    const TI: TierName[] = ['common', 'rare', 'mythic'];
    for (let i = 0; i < cycles; i++) {
      const ids = [0, 1, 2].map((k) => { const g = genomeFromParam(String(400 + k)); return stage.addBody(makeBody(g), g, { tier: TI[k], position: { x: (k - 1) * 1.1, y: 0, z: 0 } }); });
      for (let f = 0; f < 2; f++) { time += 1 / 30; stage.update(1 / 30, { time, pointerNdc: null }); stage.render(); }
      for (const id of ids) stage.removeBody(id);
      time += 1 / 30; stage.update(1 / 30, { time, pointerNdc: null }); stage.render();
      const m = stage.memory();
      out.push({ geometries: m.geometries, textures: m.textures, programs: m.programs });
    }
    return out;
  },
  /** CeremonyHandle.done must resolve (never reject, never hang) when a ceremony is interrupted by another one or by stage.dispose(). */
  async doneRobustness(): Promise<{ interruptedResolved: boolean; disposedResolved: boolean; secondFinished: boolean; rejected: boolean }> {
    let rejected = false;
    const race = (p: Promise<void>): Promise<boolean> => Promise.race([p.then(() => true, () => { rejected = true; return false; }), new Promise<boolean>((r) => setTimeout(() => r(false), 800))]);
    setupBody(genomeFromParam(''));
    const a = stage.playMergeCeremony({ parents: [{ genome: genomeFromParam('') }, { genome: genomeFromParam('3') }], result: { genome: genomeFromParam('2'), tier: 'rare' }, createBody: makeBody });
    for (let i = 0; i < 10; i++) frame(1 / 30);
    const b = stage.playCapsuleReveal({ result: { genome: genomeFromParam('5'), tier: 'common' }, createBody: makeBody });
    const interruptedResolved = await race(a.done);
    let k = 0; while (b.active && k < 200) { frame(1 / 30); k++; }
    const secondFinished = await race(b.done);
    if (b.resultBody) body = b.resultBody;
    const c2 = document.createElement('canvas'); c2.width = 160; c2.height = 120;
    const s2 = createStageDev(c2); s2.resize(160, 120, 1);
    const g = genomeFromParam('');
    s2.setBody(makeBody(g), g);
    const h = s2.playMergeCeremony({ parents: [{ genome: g }, { genome: g }], result: { genome: genomeFromParam('8'), tier: 'mythic' }, createBody: makeBody });
    for (let i = 0; i < 5; i++) { s2.update(1 / 30, { time: i / 30, pointerNdc: null }); s2.render(); }
    s2.dispose();
    const disposedResolved = await race(h.done);
    return { interruptedResolved, disposedResolved, secondFinished, rejected };
  },

  stats() { return stage.stats(); },
  memory() { return stage.memory(); },
  info() { return stage.info; },

  /** N full setBody cycles (fresh body each time); returns renderer.info.memory after each. */
  memoryCycles(n = 20, variants = false): { geometries: number; textures: number; programs: number }[] {
    const out: { geometries: number; textures: number; programs: number }[] = [];
    const g0 = genome;
    for (let i = 0; i < n; i++) {
      const g = variants ? genomeFromParam(String(100 + (i % 5))) : g0;
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

  /** Camera rig numbers: pitch clamp (never under the table), zoom clamp, damped orbit, shake decay and setShakeScale(0). */
  cameraProbe(): Record<string, number> {
    const cam = stage.camera, out: Record<string, number> = {};
    const tgt = new THREE.Vector3(0, 0.42, 0);
    const settle = (n = 90): void => { for (let i = 0; i < n; i++) { time += 1 / 60; stage.update(1 / 60, { time, pointerNdc: null }); } };
    settle();
    const p0 = cam.position.clone(), d0 = p0.distanceTo(tgt);
    out.baseDistance = d0; out.baseHeight = p0.y;
    stage.orbit(0.5, 0.0); settle(2);
    out.orbitMovesCameraAfter2Frames = cam.position.distanceTo(p0);          // damped: moves, but not all at once
    settle(120);
    out.orbitMovedAfterSettle = cam.position.distanceTo(p0);
    stage.orbit(-0.5, 0.0); settle(120);
    stage.orbit(0, -50); settle(150); out.lowestCameraY = cam.position.y; out.lowestPitchDeg = Math.asin((cam.position.y - 0.42) / cam.position.distanceTo(tgt)) * 57.2958;
    stage.orbit(0, 50); settle(150); out.highestPitchDeg = Math.asin((cam.position.y - 0.42) / cam.position.distanceTo(tgt)) * 57.2958;
    stage.orbit(0, -50); settle(150);
    stage.zoom(1e5); settle(150); out.farthest = cam.position.distanceTo(tgt) / d0;
    stage.zoom(-1e5); settle(150); out.nearest = cam.position.distanceTo(tgt) / d0;
    stage.zoom(1e5); stage.zoom(-1e5); stage.zoom(NaN); stage.orbit(NaN, 0); settle(30);
    out.finite = Number.isFinite(cam.position.x + cam.position.y + cam.position.z) ? 1 : 0;
    stage.zoom(0); stage.orbit(0, 0.4); settle(150);
    // shake
    const base = cam.position.clone();
    stage.setShakeScale(1);
    stage.shake(1); time += 1 / 60; stage.update(1 / 60, { time, pointerNdc: null });
    out.shakeOffsetFrame1 = cam.position.distanceTo(base);
    settle(8); out.shakeOffsetFrame9 = cam.position.distanceTo(base);
    settle(120); out.shakeOffsetAfter2s = cam.position.distanceTo(base);
    stage.setShakeScale(0); stage.shake(1); time += 1 / 60; stage.update(1 / 60, { time, pointerNdc: null });
    out.shakeOffsetWhenScale0 = cam.position.distanceTo(base);
    stage.setShakeScale(1);
    // restore the default framing (pitch 0.27 rad, zoom 1.0) so later screenshots are not affected by this probe
    stage.orbit(0, -50); stage.orbit(0, 0.21);
    stage.zoom(1e5); stage.zoom(Math.log(1 / 1.9) / 0.0016);
    settle(200);
    out.restoredDistance = cam.position.distanceTo(tgt) / d0;
    return out;
  },

  /** Self-test helper for the heap probe: retain n small objects until releaseObjects(). */
  retainObjects(n: number): void {
    const keep: { a: number; b: number }[] = [];
    for (let i = 0; i < n; i++) keep.push({ a: i, b: i * 2 });
    (globalThis as unknown as { __keep?: unknown }).__keep = keep;
  },
  releaseObjects(): void { (globalThis as unknown as { __keep?: unknown }).__keep = undefined; },

  /**
   * Warm up, then run `n` frames of body.step + stage.update (+ render when asked) with some poking, for the harness to
   * measure JS heap growth around it with CDP (HeapProfiler.collectGarbage + Runtime.getHeapUsage).
   */
  churn(n: number, withRender: boolean, warm = true, stepBody = true): void {
    if (warm) for (let i = 0; i < 40; i++) frame(1 / 60, false);
    press.on = false;
    for (let i = 0; i < n; i++) {
      if (stepBody) body.step(1 / 60);
      time += 1 / 60;
      if (stepBody && i % 90 === 0) body.nudge({ x: 0.4, y: 0.6, z: 0.1 });
      stage.update(1 / 60, { time, pointerNdc: { x: Math.sin(time), y: Math.cos(time * 0.7) } });
      if (withRender) stage.render();
    }
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
