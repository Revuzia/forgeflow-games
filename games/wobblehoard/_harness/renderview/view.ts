/// <reference types="vite/client" />
// Render viewer (dev harness, RENDER lane). Creates the Stage and a soft body (the REAL one from src/physics/softbody.ts
// when it exists and loads, else the dev stub), then drives deterministic scripted scenarios and exposes window.__RV__.
//   ?genome=<seed|g1.code>  ?quality=low|med|high|auto  ?state=rest|press|stretch|float|bounce  ?body=stub|real  ?loop=1 (live rAF)
import * as THREE from 'three';
import { createStageDev, type StageDev } from '../../src/render/stageDev.ts';
import { StubBody } from '../../src/render/stubBody.ts';
import { genomeFromParam, type Genome } from '../../src/core/genome.ts';
import type { CapsuleHandle, CeremonyHandle, CutPlane, FxKind, QualityTier, SoftBodyCtor, SoftBodyLike, SoftEvent, TierName, V3 } from '../../src/contracts.ts';
import { capsuleDuration, mergeDuration } from '../../src/render/ceremony.ts';
import { getSpecies, speciesBaseGenome } from '../../src/data/catalog.ts';

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
/** The same luminance in each cell of a 3x3 grid, from the last meanLuma() call (local flashes: the frame centre must not be busier than the whole). */
const lastGrid = new Float64Array(9);
function meanLuma(): number {
  if (!lumaCtx) return 0;
  lumaCtx.drawImage(canvas, 0, 0, 64, 48);
  const d = lumaCtx.getImageData(0, 0, 64, 48).data;
  let s = 0;
  lastGrid.fill(0);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const l = 0.2126 * LUMA_LUT[d[i]] + 0.7152 * LUMA_LUT[d[i + 1]] + 0.0722 * LUMA_LUT[d[i + 2]];
    s += l;
    lastGrid[Math.min(2, Math.floor(((p / 64) | 0) / 16)) * 3 + Math.min(2, Math.floor((p % 64) / 21.34))] += l;
  }
  for (let k = 0; k < 9; k++) lastGrid[k] /= (64 * 48) / 9;
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
/** Merge parents as in play: MERGE_COST squishies of ONE species (rollMerge refuses mixed species), here three DOLLOPs of different seeds. */
const parentGenomes = (n: number): Genome[] => [0, 1, 2].slice(0, n).map((k) => speciesBaseGenome('dollop', 101 + k));
function resultGenome(tier: TierName): Genome { return genomeFromParam(String(['', '2', '5', '19', '16', '8'][['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'].indexOf(tier)] ?? '')); }
const hooksFor = { onBeat(beat: string, info: { t: number; tier: TierName }): void { cer.beats.push({ beat, t: info.t, tier: info.tier, frame: frameNo }); } };
function resetCer(kind: string, tier: TierName, duration: number): void {
  cer.kind = kind; cer.tier = tier; cer.beats = []; cer.lumas = []; cer.frames = 0; cer.duration = duration; cer.startFrame = frameNo;
}

/** What the capsule-spot checks measure on stage `s` (a W x H frame): the standing capsule's box and the bodies' union box in CSS px, their overlap area, its size and table z. */
interface CapReport { landed: boolean; hit: boolean; cap: number[] | null; body: number[]; ov: number; size: number; z: number; x: number; W: number; H: number }
function capReport(s: StageDev, hd: CapsuleHandle, W: number, H: number): CapReport {
  const cam = s.camera, P = new THREE.Vector3();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const v of s.views) {
    if (!v.visible) continue;
    const Q = v.proxy.positions;
    for (let i = 0; i < Q.length; i += 3) { P.set(Q[i], Q[i + 1], Q[i + 2]).project(cam); const sx = (P.x * 0.5 + 0.5) * W, sy = (1 - (P.y * 0.5 + 0.5)) * H; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
  }
  const p = hd.screenPoint(), rr = p ? p.r / 1.35 : 0;
  const cap = p ? [p.x - rr * 0.75, p.y - rr * 1.4, p.x + rr * 0.75, p.y + rr * 1.4] : null;
  const ov = cap ? Math.max(0, Math.min(cap[2], x1) - Math.max(cap[0], x0)) * Math.max(0, Math.min(cap[3], y1) - Math.max(cap[1], y0)) : -1;
  return { landed: hd.landed, hit: !!p && hd.hitTest(p.x, p.y), cap: cap && cap.map(Math.round), body: [x0, y0, x1, y1].map(Math.round), ov: Math.round(ov), size: s.info.cap?.size ?? -1, z: s.info.cap?.z ?? 0, x: s.info.cap?.x ?? 0, W, H };
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
    minTopPx: number; minSidePx: number; grids: number[][];
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
    // the bodies' silhouettes on screen (sim-mesh vertices projected): how close any visible body comes to the frame edges
    let minTopPx = Infinity, minSidePx = Infinity;
    const pv = new THREE.Vector3();
    const watch = (): void => {
      for (const v of stage.views) if (v.owned && v.id !== h.resultBodyId) foldMax = Math.max(foldMax, v.proxy.foldAmount);
      const cw = canvas.clientWidth || canvas.width, chh = canvas.clientHeight || canvas.height;
      for (const v of stage.views) {
        if (!v.visible) continue;
        const P = v.proxy.positions;
        for (let i = 0; i < P.length; i += 3) {
          pv.set(P[i], P[i + 1], P[i + 2]).project(stage.camera);
          const sx = (pv.x * 0.5 + 0.5) * cw, sy = (1 - (pv.y * 0.5 + 0.5)) * chh;
          if (sy < minTopPx) minTopPx = sy;
          const side = Math.min(sx, cw - sx);
          if (side < minSidePx) minSidePx = side;
        }
      }
    };
    const lumas: number[] = [], grids: number[][] = [];
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
      lumas.push(meanLuma()); grids.push(Array.from(lastGrid));
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
      stats, drivers: { ...driverSpy }, native, foldMax, resultHiddenFrames, particlesDropped: stage.info.particlesDropped - dropped0, minTopPx, minSidePx, grids,
      finalState: { ceremony: stage.info.ceremony, capsule: stage.info.capsule, screenLight: stage.info.screenLight, cameraFx: { ...stage.info.cameraFx }, primaryIsResult: stage.primaryBodyId() === h.resultBodyId },
    };
  },
  async awaitDone(): Promise<boolean> { if (!cer.handle) return false; await cer.handle.done; return true; },
  /**
   * Ceremonies CHAINED the way a fast-tapping player can chain them (tap-to-skip, Fast-open quick pops, a queue of capsules): each step
   * starts at `startAt` (seconds from the chain start) or `gap` seconds after the previous one ended, and is skipped `skipAt` seconds after
   * its own start. Per-frame mean luminance for the flash probe; the result of each ceremony is adopted as the play body, as the shell does.
   */
  runChain(seq: { kind: 'capsule' | 'merge'; tier: TierName; quick?: boolean; skipAt?: number; startAt?: number; gap?: number }[], dt = 1 / 30): { lumas: number[]; marks: string[]; light: number[] } {
    stage.clearBodies(); stage.setCalmEffects(false);
    setupBody(genomeFromParam(''));
    for (let i = 0; i < 30; i++) frame(dt);
    const lumas: number[] = [], light: number[] = [], marks: string[] = [];
    let f = 0, cur: CeremonyHandle | null = null, curStart = 0, idx = 0, skipped = false, endAt = -1;
    const start = (st: (typeof seq)[number]): void => {
      const hooks = { onBeat: (bt: string): void => { marks.push(`${bt}@${(f * dt).toFixed(2)}`); } };
      cur = st.kind === 'capsule'
        ? stage.playCapsuleReveal({ result: { genome: resultGenome(st.tier), tier: st.tier }, createBody: makeBody, quick: !!st.quick }, hooks)
        : stage.playMergeCeremony({ parents: parentGenomes(2).map((g) => ({ genome: g })), result: { genome: resultGenome(st.tier), tier: st.tier }, createBody: makeBody }, hooks);
      curStart = f * dt; skipped = false; endAt = -1; marks.push(`START ${st.kind}:${st.tier}${st.quick ? ':quick' : ''}@${(f * dt).toFixed(2)}`);
    };
    start(seq[0]); idx = 1;
    for (; f < Math.round(14 / dt); f++) {
      const t = f * dt, s = seq[idx - 1], h = cur as CeremonyHandle | null;
      if (!h) break;
      if (s && s.skipAt !== undefined && !skipped && t - curStart >= s.skipAt) { h.skip(); skipped = true; marks.push(`skip@${t.toFixed(2)}`); }
      if (!h.active && endAt < 0) endAt = t;
      const nx = seq[idx];
      if (nx) {
        const due = nx.startAt !== undefined ? t >= nx.startAt - 1e-9 : endAt >= 0 && t >= endAt + (nx.gap ?? 0) - 1e-9;
        if (due) { if (h.resultBody) body = h.resultBody; start(nx); idx++; }
      } else if (endAt >= 0 && t > endAt + 0.8) break;
      if (!h.active && h.resultBody && body !== h.resultBody) body = h.resultBody;
      frame(dt);
      lumas.push(meanLuma()); light.push(stage.info.screenLight);
    }
    const h = cur as CeremonyHandle | null;
    if (h && h.resultBody) body = h.resultBody;
    return { lumas, marks, light };
  },
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
    const ps = parentGenomes(parents).map((g) => ({ genome: g, tier: 'common' as TierName }));
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
    f.reset(); const first = f.flash(20, 0.2), second = f.flash(20.2, 0.2), third = f.flash(20.6, 0.2), fourth = f.flash(20.9, 0.2), fifth = f.flash(21.0, 0.2);
    out.stack = [first > 0, second > 0, third > 0, fourth > 0, fifth > 0];
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

  /**
   * Stage B5 contact glow at ONE frozen pose: press the body, then render the same frame with the glow as driven and with it forced off;
   * luminance in a small box around the fingertip and over the whole frame.
   */
  contactGlowProbe(): { hasTip: boolean; boxOn: number; boxOff: number; globalOn: number; globalOff: number; amt: number } {
    const v = stage.views.find((w) => w.id === stage.primaryBodyId());
    if (!v) return { hasTip: false, boxOn: 0, boxOff: 0, globalOn: 0, globalOff: 0, amt: 0 };
    RV.press(0.05, 0.12, 0.9, 0.5); RV.frames(40);
    const t = v.proxy.tip(0);
    const u = v.mats.uniforms, w0 = u.uTouch0.value.w;
    const box = (): number => {
      if (!t) return 0;
      const p = new THREE.Vector3(t.x, t.y, t.z).project(stage.camera);
      const cx = Math.round((p.x * 0.5 + 0.5) * canvas.width), cy = Math.round((1 - (p.y * 0.5 + 0.5)) * canvas.height), r = Math.max(4, Math.round(canvas.height * 0.05));
      stage.render();
      const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height;
      const x = c2.getContext('2d', { willReadFrequently: true }); if (!x) return 0;
      x.drawImage(canvas, 0, 0);
      const d = x.getImageData(Math.max(0, cx - r), Math.max(0, cy - r), 2 * r, 2 * r).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.2126 * LUMA_LUT[d[i]] + 0.7152 * LUMA_LUT[d[i + 1]] + 0.0722 * LUMA_LUT[d[i + 2]];
      return s / (d.length / 4);
    };
    const boxOn = box(), globalOn = RV.lumaNow();
    u.uTouch0.value.w = 0; u.uTouch1.value.w = 0;
    const boxOff = box(), globalOff = RV.lumaNow();
    u.uTouch0.value.w = w0;
    RV.release(); RV.frames(30);
    return { hasTip: !!t, boxOn, boxOff, globalOn, globalOff, amt: w0 };
  },
  /** Stage B6 tack strands: press a body for `holdS`, lift, step; what the strand did and what the shell's strand hook received. */
  strandProbe(g: Genome, holdS = 0.6, shotAt = 0.12): { family: string; maxStrands: number; strandFrames: number; tensionEvents: number; snapEvents: number; maxLen: number; png: string | null } {
    setupBody(g); RV.frames(60);
    const v = stage.views.find((w) => w.id === stage.primaryBodyId());
    const fam = v ? v.mats.familyId : '?';
    let tensionEvents = 0, snapEvents = 0;
    stage.onStrand = (_id, e): void => { if (e.snap) snapEvents++; else tensionEvents++; };
    RV.press(0.0, 0.1, 0.8, 0.3); RV.frames(Math.round(holdS * 60));
    RV.release();
    let maxStrands = 0, strandFrames = 0, png: string | null = null;
    for (let i = 0; i < 90; i++) {
      frame(1 / 60, true);
      maxStrands = Math.max(maxStrands, (body.metrics.strands as number | undefined) ?? 0);
      if (v && v.strands.active) strandFrames++;
      if (png === null && i >= Math.round(shotAt * 60) && v && v.strands.active) png = canvas.toDataURL('image/png');
    }
    stage.onStrand = null;
    return { family: fam, maxStrands, strandFrames, tensionEvents, snapEvents, maxLen: 0, png };
  },
  /** Stage B1: n bodies out on the mat at stage.matLayout(n); their silhouettes on screen once the camera has framed them. */
  matProbe(n: number, seeds: string[]): { boxes: number[][]; inFrame: boolean; minGapPx: number; png: string; bodies: number } {
    stage.clearBodies();
    const pos = stage.matLayout(n);
    const all: SoftBodyLike[] = [];
    for (let k = 0; k < pos.length; k++) {
      const g = genomeFromParam(seeds[k % seeds.length] ?? '');
      const b = makeBody(g);
      all.push(b);
      stage.addBody(b, g, { tier: 'common', position: pos[k] });
    }
    if (all.length) body = all[0];
    // every body settles (the viewer's frame() only steps the play body)
    for (let i = 0; i < 150; i++) {
      for (const b of all) { b.step(1 / 60); events.length = 0; b.drainEvents(events); }
      time += 1 / 60; frameNo++;
      stage.update(1 / 60, { time, pointerNdc: null });
    }
    stage.render();
    const cam = stage.camera, pv = new THREE.Vector3(), W = canvas.clientWidth || canvas.width, H = canvas.clientHeight || canvas.height;
    const boxes: number[][] = [];
    let inFrame = true;
    for (const v of stage.views) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      const P = v.proxy.positions;
      for (let i = 0; i < P.length; i += 3) { pv.set(P[i], P[i + 1], P[i + 2]).project(cam); const sx = (pv.x * 0.5 + 0.5) * W, sy = (1 - (pv.y * 0.5 + 0.5)) * H; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
      boxes.push([x0, y0, x1, y1]);
      if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) inFrame = false;
    }
    let minGap = Infinity;
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a], B = boxes[b];
      minGap = Math.min(minGap, Math.hypot((A[0] + A[2]) / 2 - (B[0] + B[2]) / 2, (A[1] + A[3]) / 2 - (B[1] + B[3]) / 2));
    }
    return { boxes, inFrame, minGapPx: minGap, png: RV.snapshot(), bodies: stage.views.length };
  },

  /**
   * CUT faces: the same body added whole and as a chunk (AddBodyOpts.chunk). Dark "ink" pixels in the upper half of its screen box (the
   * eyes) with and without, and the face group's visibility. `kind` 'real' uses makeBody (the real soft body when it loads), 'stub' a
   * stub piece built with PieceOpts (chunk).
   */
  chunkFaceProbe(g: Genome, kind: 'real' | 'stub'): { whole: number; chunk: number; mask: number; faceVisible: boolean[]; pngWhole: string; pngChunk: string } {
    const out = { whole: 0, chunk: 0, mask: 0, faceVisible: [] as boolean[], pngWhole: '', pngChunk: '' };
    const W = canvas.width, H = canvas.height;
    const c2 = document.createElement('canvas'); c2.width = W; c2.height = H;
    const x = c2.getContext('2d', { willReadFrequently: true });
    const grab = (): Uint8ClampedArray => { stage.render(); if (!x) return new Uint8ClampedArray(W * H * 4); x.drawImage(canvas, 0, 0); return x.getImageData(0, 0, W, H).data; };
    let mask: Uint8Array | null = null;
    for (const asChunk of [false, true]) {
      stage.clearBodies();
      // the SAME body both times (only AddBodyOpts.chunk differs): the real soft body, or a stub piece
      const b: SoftBodyLike = kind === 'stub' ? new StubBody(g, { piece: { frac: 0.6, chunk: false } }) : makeBody(g);
      body = b;
      const id = stage.addBody(b, g, { tier: 'common', chunk: asChunk });
      for (let i = 0; i < 90; i++) { b.step(1 / 60); events.length = 0; b.drainEvents(events); time += 1 / 60; frameNo++; stage.update(1 / 60, { time, pointerNdc: null }); }
      const v = stage.views.find((w) => w.id === id);
      out.faceVisible.push(!!v && v.face.group.visible);
      const img = grab();
      if (!asChunk && v) {
        // the eyes' footprint: where hiding the face changes the frame
        v.face.group.visible = false; const noFace = grab(); v.face.group.visible = true;
        mask = new Uint8Array(W * H);
        for (let i = 0, p = 0; i < img.length; i += 4, p++) if (Math.abs(img[i] - noFace[i]) + Math.abs(img[i + 1] - noFace[i + 1]) + Math.abs(img[i + 2] - noFace[i + 2]) > 45) { mask[p] = 1; out.mask++; }
        stage.render();
      }
      // dark eye ink inside that footprint
      let ink = 0;
      if (mask) for (let i = 0, p = 0; i < img.length; i += 4, p++) if (mask[p] && 0.2126 * img[i] + 0.7152 * img[i + 1] + 0.0722 * img[i + 2] < 24) ink++;
      if (asChunk) { out.chunk = ink; out.pngChunk = canvas.toDataURL('image/png'); } else { out.whole = ink; out.pngWhole = canvas.toDataURL('image/png'); }
    }
    stage.clearBodies(); setupBody(genome);
    return out;
  },

  /**
   * CUT (_spec/CUT.md X09 and the render items): cut a squishy again and again, then Reconnect all, the way the shell will drive it:
   * per cut the neck forms over 0.25 s (body.setNeck + stage.setCutSeam), at t = 1 the body is swapped for two pieces (stub pieces built
   * with PieceOpts: the face stays on one, the other is a chunk) and stage.partPieces(a, b); at the piece limit (6) the two smallest
   * reconnect first (stage.setBridge over 0.4 s, the giver shrinks into the receiver). Then Reconnect all: every chunk bridges into the
   * face piece over 1.2 s. Per-frame mean luminance and screen light, the most pieces, shots at the telling moments.
   */
  cutProbe(o: { genome: Genome; cuts?: number; gapS?: number; calm?: boolean; dt?: number; shots?: boolean }): {
    lumas: number[]; light: number[]; maxPieces: number; cutsDone: number; reconnects: number; strandEvents: number; snapEvents: number;
    maxGlow: number; maxStrands: number; maxBridges: number; piecesAtEnd: number; wholeAtEnd: boolean; facesAtEnd: number; marks: string[];
    shots: Record<string, string>; framed: { pieces: number; inFrame: boolean; minPx: number; boxes: number[][] };
  } {
    const dt = o.dt ?? 1 / 30, g = o.genome, cuts = o.cuts ?? 10, gap = o.gapS ?? 0.15;
    stage.clearBodies(); stage.setCalmEffects(!!o.calm);
    type Piece = { id: number; b: StubBody; frac: number; face: boolean };
    const pieces: Piece[] = [];
    const add = (b: StubBody, frac: number, face: boolean): Piece => { const id = stage.addBody(b, g, { tier: 'common', chunk: !face }); const p = { id, b, frac, face }; pieces.push(p); return p; };
    add(new StubBody(g), 1, true);
    body = pieces[0].b;
    const lumas: number[] = [], light: number[] = [], marks: string[] = [], shots: Record<string, string> = {};
    let strandEvents = 0, snapEvents = 0, maxGlow = 0, maxStrands = 0, maxBridges = 0, maxPieces = 1, cutsDone = 0, reconnects = 0, f = 0;
    stage.onStrand = (_id, e): void => { if (e.snap) snapEvents++; else strandEvents++; };
    const step = (record = true): void => {
      for (const p of pieces) { p.b.step(dt); events.length = 0; p.b.drainEvents(events); }
      time += dt; frameNo++; f++;
      stage.update(dt, { time, pointerNdc: null });
      if (record) { stage.render(); lumas.push(meanLuma()); light.push(stage.info.screenLight); }
      const c = stage.info.cut;
      maxGlow = Math.max(maxGlow, c.glow); maxStrands = Math.max(maxStrands, c.strands); maxBridges = Math.max(maxBridges, c.bridges);
      maxPieces = Math.max(maxPieces, pieces.length);
    };
    const shot = (name: string): void => { if (o.shots) { stage.render(); shots[name] = canvas.toDataURL('image/jpeg', 0.9); } };
    for (let i = 0; i < 30; i++) step(false);
    const centreOf = (p: Piece): V3 => ({ x: p.b.center.x, y: p.b.center.y, z: p.b.center.z });
    /** giver -> receiver over `secs`: the bridge rises, the giver shrinks into the receiver and slides to it, then it is removed */
    const reconnect = (pairs: [Piece, Piece][], secs: number, shotName = ''): void => {
      for (const [r, gv] of pairs) { gv.b.setFrac(0.02, secs); r.b.setFrac(r.frac + gv.frac, secs); gv.b.moveTo(centreOf(r), 0.6); }
      const n = Math.round(secs / dt);
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        for (const [r, gv] of pairs) stage.setBridge(r.id, gv.id, Math.min(1, t / 0.5));
        step();
        if (shotName && k === Math.round(n * 0.45)) shot(shotName);
      }
      for (const [r, gv] of pairs) { r.frac += gv.frac; stage.setBridge(r.id, gv.id, 0); stage.removeBody(gv.id); pieces.splice(pieces.indexOf(gv), 1); reconnects++; }
      marks.push(`reconnect x${pairs.length}@${(f * dt).toFixed(2)}`);
    };
    for (let c = 0; c < cuts; c++) {
      if (pieces.length >= 6) {   // the piece limit: the two smallest flow back together first
        const sorted = [...pieces].sort((a, b) => a.frac - b.frac);
        const gv = sorted[0].face ? sorted[1] : sorted[0], r = sorted.find((p) => p !== gv) as Piece;
        reconnect([[r, gv]], 0.4, c === 6 ? 'bridge_mid' : '');
      }
      const src = [...pieces].sort((a, b) => b.frac - a.frac)[0];
      if (src.frac < 0.25) { marks.push(`refused@${(f * dt).toFixed(2)}`); for (let i = 0; i < Math.round(0.4 / dt); i++) step(); continue; }
      const ang = c * 1.9 + 0.4, n = { x: Math.cos(ang), y: 0, z: Math.sin(ang) };
      const plane = { point: centreOf(src), normal: n };
      const nS = Math.round(0.25 / dt);
      for (let k = 1; k <= nS; k++) {
        const t = k / nS;
        src.b.setNeck(plane, t); stage.setCutSeam(src.id, plane, t);
        step();
        if (c === 0 && k === Math.round(nS * 0.7)) shot('seam_neck');
      }
      // the swap at t = 1: two pieces at the lobes, springing apart; the face stays on the side of the eyes (here: the 'a' side)
      const R = src.b.restRadius, half = src.frac / 2, cc = centreOf(src);
      const mk = (sgn: number, chunk: boolean): StubBody => new StubBody(g, { piece: { frac: half, chunk, cutNormal: { x: -sgn * n.x, y: 0, z: -sgn * n.z }, at: { x: cc.x + sgn * n.x * R * 0.42, y: 0, z: cc.z + sgn * n.z * R * 0.42 }, vel: { x: sgn * n.x * 1.8, y: 0, z: sgn * n.z * 1.8 } } });
      stage.removeBody(src.id); pieces.splice(pieces.indexOf(src), 1);
      const a = add(mk(1, !src.face), half, src.face), b = add(mk(-1, true), half, false);
      stage.partPieces(a.id, b.id);
      cutsDone++; marks.push(`cut ${cutsDone}@${(f * dt).toFixed(2)}`);
      for (let i = 0; i < Math.round(gap / dt); i++) { step(); if (c === 0 && i === Math.round(0.1 / dt)) shot('parting_strand'); }
    }
    for (let i = 0; i < Math.round(1.2 / dt); i++) step();
    shot('pieces');
    // a bridge between the face piece and its nearest piece as they stand (the neck reaching across before they touch), then let go
    {
      const fp = pieces.find((p) => p.face) ?? pieces[0];
      let near: Piece | null = null, nd = Infinity;
      // the nearest piece that is not already touching it (the neck reaches across a gap; overlapping bodies are joined already)
      for (const p of pieces) if (p !== fp) {
        const d = Math.hypot(p.b.center.x - fp.b.center.x, p.b.center.z - fp.b.center.z), apart = d > 1.15 * (p.b.restRadius + fp.b.restRadius);
        if ((apart ? d : d + 100) < nd) { nd = apart ? d : d + 100; near = p; }
      }
      if (near) {
        const n = Math.round(0.35 / dt);
        for (let k = 1; k <= n; k++) { stage.setBridge(fp.id, near.id, 0.85 * k / n); step(); }
        shot('bridge');
        for (let k = 1; k <= n; k++) { stage.setBridge(fp.id, near.id, 0.85 * (1 - k / n)); step(); }
        stage.setBridge(fp.id, near.id, 0);
      }
    }
    // every piece inside the frame once the camera has framed them (screen boxes of their skins), and how big the smallest one reads
    const framed = { pieces: pieces.length, inFrame: true, minPx: Infinity, boxes: [] as number[][] };
    {
      const cam = stage.camera, pv = new THREE.Vector3(), W = canvas.clientWidth || canvas.width, H = canvas.clientHeight || canvas.height;
      for (const v of stage.views) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        const P = v.proxy.positions;
        for (let i = 0; i < P.length; i += 3) { pv.set(P[i], P[i + 1], P[i + 2]).project(cam); const sx = (pv.x * 0.5 + 0.5) * W, sy = (1 - (pv.y * 0.5 + 0.5)) * H; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
        framed.boxes.push([x0, y0, x1, y1].map(Math.round));
        if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) framed.inFrame = false;
        framed.minPx = Math.min(framed.minPx, x1 - x0);
      }
    }
    // Reconnect all: every chunk into the face piece at once, 1.2 s
    const facePiece = pieces.find((p) => p.face) ?? pieces[0];
    const others = pieces.filter((p) => p !== facePiece);
    if (others.length) reconnect(others.map((gv) => [facePiece, gv] as [Piece, Piece]), 1.2, 'reconnect_all');
    for (let i = 0; i < Math.round(1.0 / dt); i++) step();
    shot('whole_again');
    stage.onStrand = null;
    const facesAtEnd = stage.views.filter((v) => !v.chunk).length;
    const out = { lumas, light, maxPieces, cutsDone, reconnects, strandEvents, snapEvents, maxGlow, maxStrands, maxBridges, piecesAtEnd: pieces.length, wholeAtEnd: pieces.length === 1 && Math.abs(pieces[0].frac - 1) < 1e-6, facesAtEnd, marks, shots, framed };
    stage.setCalmEffects(false); stage.clearBodies(); setupBody(genome);
    return out;
  },

  /** CUT frame budget (render side): 6 pieces (1 face + 5 chunks, 1/6 each) vs 2 whole bodies, same genome, synchronous ms per frame. */
  cutCost(g: Genome, rounds = 3): { twoWhole: number[]; sixPieces: number[]; drawCalls: { two: number; six: number }; triangles: { two: number; six: number } } {
    const out = { twoWhole: [] as number[], sixPieces: [] as number[], drawCalls: { two: 0, six: 0 }, triangles: { two: 0, six: 0 } };
    const build = (six: boolean): StubBody[] => {
      stage.clearBodies();
      const bs: StubBody[] = [];
      const n = six ? 6 : 2;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2, rr = six ? 0.55 : 0.6;
        const b = six ? new StubBody(g, { piece: { frac: 1 / 6, chunk: k > 0, cutNormal: { x: Math.cos(a), y: 0, z: Math.sin(a) }, at: { x: Math.cos(a) * rr, y: 0, z: Math.sin(a) * rr } } })
          : new StubBody(g, { piece: { frac: 1, chunk: false, at: { x: (k ? 1 : -1) * rr, y: 0, z: 0 } } });
        stage.addBody(b, g, { tier: 'common', chunk: six && k > 0 });
        bs.push(b);
      }
      for (let i = 0; i < 40; i++) { for (const b of bs) b.step(1 / 60); time += 1 / 60; stage.update(1 / 60, { time, pointerNdc: null }); }
      return bs;
    };
    for (let r = 0; r < rounds; r++) for (const six of [false, true]) {
      build(six); stage.render();
      const ms = RV.timeRender(3), st = stage.stats();
      (six ? out.sixPieces : out.twoWhole).push(ms);
      if (six) { out.drawCalls.six = st.drawCalls; out.triangles.six = st.triangles; } else { out.drawCalls.two = st.drawCalls; out.triangles.two = st.triangles; }
    }
    stage.clearBodies(); setupBody(genome);
    return out;
  },

  /**
   * The Hoard's preview with squishies out on the mat (the shell's focusInstance): setBody(another body) and the mat bodies re-added at
   * once, as the shell does. The camera framing (camScale) per frame must ease from where it was, never jump in and back out.
   */
  swapProbe(): { before: number; after: number; series: number[]; maxStep: number; minDuring: number } {
    stage.clearBodies();
    setupBody(genomeFromParam(''));
    const pos = stage.matLayout(3);
    const extras: { b: SoftBodyLike; g: Genome; p: V3 }[] = [];
    for (let k = 1; k < 3; k++) { const g = genomeFromParam(String(k * 3)); const b = makeBody(g); extras.push({ b, g, p: pos[k] }); stage.addBody(b, g, { tier: 'common', position: pos[k] }); }
    const stepAll = (): void => { body.step(1 / 60); for (const x of extras) x.b.step(1 / 60); time += 1 / 60; frameNo++; stage.update(1 / 60, { time, pointerNdc: null }); };
    for (let i = 0; i < 240; i++) stepAll();
    const before = stage.info.camScale;
    // the swap: a new play body (a different species and size), then the mat bodies straight back
    const g2 = speciesBaseGenome('glugbean', 3);
    body = makeBody(g2); genome = g2;
    stage.setBody(body, g2);
    for (const x of extras) stage.addBody(x.b, x.g, { tier: 'common', position: x.p });
    const series: number[] = [];
    for (let i = 0; i < 150; i++) { stepAll(); series.push(stage.info.camScale); }
    let maxStep = Math.abs(series[0] - before), minDuring = Math.min(before, ...series);
    for (let i = 1; i < series.length; i++) maxStep = Math.max(maxStep, Math.abs(series[i] - series[i - 1]));
    stage.render();
    const after = series[series.length - 1];
    stage.clearBodies(); setupBody(genomeFromParam(''));
    return { before, after, series: series.filter((_, i) => i % 10 === 0), maxStep, minDuring };
  },

  /**
   * CUT with the REAL soft body and the shell's own call order (src/shell/cut.ts + bodies.ts): per cut, every frame of the neck
   * body.setNeck(plane, t) + stage.setCutSeam(view, plane, t); at the end the cut body is replaced by two pieces built with
   * new SoftBody(g, { piece }), the FACE piece through stage.setBody (bodies.swapTo: clearBodies + addBody, then every chunk's view straight
   * back) and the chunk through stage.addBody({ chunk: true }), then stage.partPieces; the pieces collide with each other (bodies.step),
   * the new chunk is held at its lobe for 0.8 s (moveTo); Reconnect all = setFrac on every piece + setBridge each frame + moveTo, then the chunks
   * are removed and a fresh WHOLE body replaces the face piece through setBody. Returns what the checks and the filmstrips need.
   * `swipes` = for each cut, where across the biggest piece the swipe goes (in rest radii from its centre: 0 = through the middle).
   */
  realCutProbe(o: { species: string; seed?: number; swipes: number[]; /** each cut splits the biggest piece so that its smaller part is about this share of the WHOLE (0 = use `swipes`) */ autoSmall?: number; calm?: boolean; dt?: number; gapS?: number; reconnect?: boolean; record?: boolean; shots?: boolean }): {
    skipped: boolean; family: string; lumas: number[]; light: number[]; marks: string[]; cutsDone: number; refused: number; maxPieces: number; maxStrands: number; maxBridges: number; maxGlow: number;
    strandEvents: number; snapEvents: number; seamCarry: number[]; minTopPx: number; minTopByPhase: Record<string, number>; framed: { pieces: number; inFrame: boolean; minPx: number }; viewsAtEnd: number; facesAtEnd: number; piecesAtEnd: number;
    shots: Record<string, string>; ms: number;
  } {
    const out = { skipped: false, family: '', lumas: [] as number[], light: [] as number[], marks: [] as string[], cutsDone: 0, refused: 0, maxPieces: 1, maxStrands: 0, maxBridges: 0, maxGlow: 0,
      strandEvents: 0, snapEvents: 0, seamCarry: [] as number[], minTopPx: Infinity, minTopByPhase: {} as Record<string, number>, framed: { pieces: 0, inFrame: true, minPx: Infinity }, viewsAtEnd: 0, facesAtEnd: 0, piecesAtEnd: 0, shots: {} as Record<string, string>, ms: 0 };
    if (!RealBody) { out.skipped = true; return out; }
    const SB = RealBody, t0 = performance.now();
    const dt = o.dt ?? 1 / 30, g = speciesBaseGenome(o.species as Parameters<typeof speciesBaseGenome>[0], o.seed ?? 1), def = getSpecies(g.species), fam = def ? def.family : 'jellygel', tier = (def ? def.tier : 'common') as TierName;
    out.family = fam;
    const NECK_S: Record<string, number> = { firmsilicone: 0.4, popdome: 0.4, putty: 0.34, mochidough: 0.34, slowrise: 0.3, marshmallow: 0.3, stickystretch: 0.3, slimegoo: 0.3 };
    const smooth = (x: number): number => { const t = x < 0 ? 0 : x > 1 ? 1 : x; return t * t * (3 - 2 * t); };
    const unit = (a: V3): V3 | null => { const l = Math.hypot(a.x, a.y, a.z); return l > 1e-9 ? { x: a.x / l, y: a.y / l, z: a.z / l } : null; };
    const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
    const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
    interface Piece { body: SoftBodyLike; chunk: boolean; frac: number; id: number | null; ghost: boolean }
    stage.clearBodies(); stage.setCalmEffects(!!o.calm);
    const whole = new SB(g);
    body = whole; genome = g;
    stage.setBody(whole, g); stage.setBodyTier(stage.primaryBodyId() ?? -1, tier);
    let list: Piece[] = [{ body: whole, chunk: false, frac: 1, id: null, ghost: false }];
    let playBody: SoftBodyLike = whole;
    const viewOf = (p: Piece): number | null => (p.body === playBody ? stage.primaryBodyId() : p.id);
    let settling: { p: Piece; until: number }[] = [];
    let tStart = -1;
    const pv = new THREE.Vector3();
    let phase = 'neck';
    const watchTop = (): void => {
      const chh = canvas.clientHeight || canvas.height;
      let low = out.minTopByPhase[phase] ?? Infinity;
      for (const v of stage.views) { const P = v.proxy.positions; for (let i = 0; i < P.length; i += 3) { pv.set(P[i], P[i + 1], P[i + 2]).project(stage.camera); const sy = (1 - (pv.y * 0.5 + 0.5)) * chh; if (sy < low) low = sy; } }
      out.minTopByPhase[phase] = low;
      if (phase === 'reconnect' && low < out.minTopPx) out.minTopPx = low;
    };
    const step = (record = true): void => {
      const act = list.filter((p) => !p.ghost && typeof p.body.collide === 'function');
      if (act.length >= 2) for (const p of act) p.body.collide!(act.filter((q) => q !== p).map((q) => q.body));
      for (const p of list) { p.body.step(dt); events.length = 0; p.body.drainEvents(events); }
      time += dt; frameNo++;
      for (const s of settling.slice()) if (time >= s.until) { try { s.p.body.moveTo?.(null); } catch { /* optional */ } settling = settling.filter((x) => x !== s); }
      stage.update(dt, { time, pointerNdc: null });
      if (record && (o.record ?? true)) { stage.render(); out.lumas.push(meanLuma()); out.light.push(stage.info.screenLight); }
      const c = stage.info.cut;
      out.maxGlow = Math.max(out.maxGlow, c.glow); out.maxStrands = Math.max(out.maxStrands, c.strands); out.maxBridges = Math.max(out.maxBridges, c.bridges); out.maxPieces = Math.max(out.maxPieces, list.length);
      if (tStart >= 0) watchTop();
    };
    const shot = (name: string): void => { if (o.shots) { stage.render(); out.shots[name] = canvas.toDataURL('image/jpeg', 0.9); } };
    stage.onStrand = (_id, e): void => { if (e.snap) out.snapEvents++; else out.strandEvents++; };
    for (let i = 0; i < 90; i++) step(false);
    const swapTo = (face: Piece): void => {
      stage.setBody(face.body, g); playBody = face.body; body = face.body;
      stage.setBodyTier(stage.primaryBodyId() ?? -1, tier);
      for (const x of list) if (x.body !== playBody) x.id = stage.addBody(x.body, g, { tier, position: { x: 0, y: 0, z: 0 }, chunk: true });
    };
    const planeFor = (p: Piece, dx: number): CutPlane | null => {
      const cam = stage.camera; cam.updateMatrixWorld();
      const c = new THREE.Vector3(p.body.center.x, p.body.center.y, p.body.center.z).project(cam);
      const r = new THREE.Vector3(p.body.center.x + p.body.restRadius * dx, p.body.center.y, p.body.center.z).project(cam);
      const ray = (nx: number, ny: number): V3 => { const v = new THREE.Vector3(nx, ny, 0.5).unproject(cam); v.sub(cam.position).normalize(); return { x: v.x, y: v.y, z: v.z }; };
      const n = unit(cross(ray(r.x, c.y + 0.5), ray(r.x, c.y - 0.5)));
      return n ? { point: { x: cam.position.x, y: cam.position.y, z: cam.position.z }, normal: n } : null;
    };
    const faceAnchor = (b: SoftBodyLike): V3 => {
      const f = b.frame ?? { x: 0, y: 0, z: 0, w: 1 }, v = { x: 0, y: 0.08 * b.restRadius, z: 0.9 * b.restRadius };
      const tx = f.y * v.z - f.z * v.y + f.w * v.x, ty = f.z * v.x - f.x * v.z + f.w * v.y, tz = f.x * v.y - f.y * v.x + f.w * v.z;
      return { x: b.center.x + v.x + 2 * (f.y * tz - f.z * ty), y: b.center.y + v.y + 2 * (f.z * tx - f.x * tz), z: b.center.z + v.z + 2 * (f.x * ty - f.y * tx) };
    };
    const lobes = (b: SoftBodyLike, plane: CutPlane): { a: V3; b: V3 } | null => {
      const P = b.positions, n = b.vertexCount; let ax = 0, ay = 0, az = 0, na = 0, bx = 0, by = 0, bz = 0, nb = 0;
      for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2]; if ((x - plane.point.x) * plane.normal.x + (y - plane.point.y) * plane.normal.y + (z - plane.point.z) * plane.normal.z >= 0) { ax += x; ay += y; az += z; na++; } else { bx += x; by += y; bz += z; nb++; } }
      return na && nb ? { a: { x: ax / na, y: ay / na, z: az / na }, b: { x: bx / nb, y: by / nb, z: bz / nb } } : null;
    };
    const cutOnce = (dx0: number): boolean => {
      const p = [...list].sort((a, b) => b.frac - a.frac)[0];
      let dx = dx0;
      if (o.autoSmall) {   // the swipe whose smaller part is closest to the wanted share (what a player aims for to reach 6 pieces: unequal cuts)
        let best = Infinity;
        for (let k = -26; k <= 26; k++) {
          const d = k * 0.04, pl = planeFor(p, d), f = pl ? p.body.measureCut!(pl) : null;
          if (f === null) continue;
          const err = Math.abs(Math.min(f, 1 - f) * p.frac - o.autoSmall);
          if (err < best) { best = err; dx = d; }
        }
      }
      const plane = planeFor(p, dx);
      const fa = plane ? p.body.measureCut!(plane) : null;
      if (!plane || fa === null || Math.min(fa, 1 - fa) * p.frac < 1 / 8 - 1e-6 || list.length + 1 > 6) { out.refused++; return false; }
      const neckS = NECK_S[fam] ?? 0.25;
      let faceA = false;
      if (!p.chunk) { const sd = dot({ x: faceAnchor(p.body).x - plane.point.x, y: faceAnchor(p.body).y - plane.point.y, z: faceAnchor(p.body).z - plane.point.z }, plane.normal); faceA = Math.abs(sd) < 0.03 * p.body.restRadius ? fa >= 0.5 : sd >= 0; }
      const view = viewOf(p), tc = time;
      if (tStart < 0) tStart = time;
      phase = 'neck';
      while (time - tc < neckS + 0.08) {
        const k = smooth((time - tc) / neckS);
        p.body.setNeck!(plane, k); if (view !== null) stage.setCutSeam!(view, plane, k);
        step();
      }
      const B = p.body;
      B.setNeck!(null, 0); if (view !== null) stage.setCutSeam!(view, null, 0);
      const fA = p.frac * fa, fB = p.frac * (1 - fa), lc = lobes(B, plane) ?? { a: B.center, b: B.center }, n = plane.normal, push = 0.22;
      const faceHere = faceA && !p.chunk, faceThere = !faceA && !p.chunk;
      const pa = new SB(g, { piece: { frac: fA, chunk: !faceHere, cutNormal: { x: -n.x, y: -n.y, z: -n.z }, at: lc.a, vel: { x: n.x * push, y: 0, z: n.z * push } } });
      const pb = new SB(g, { piece: { frac: fB, chunk: !faceThere, cutNormal: { x: n.x, y: n.y, z: n.z }, at: lc.b, vel: { x: -n.x * push, y: 0, z: -n.z * push } } });
      const A: Piece = { body: pa, chunk: !faceHere, frac: fA, id: null, ghost: false }, Bp: Piece = { body: pb, chunk: !faceThere, frac: fB, id: null, ghost: false };
      if (!p.chunk) {
        const face = faceA ? A : Bp;
        list = [face, faceA ? Bp : A, ...list.filter((x) => x !== p)];
        swapTo(face);
      } else {
        if (p.id !== null) stage.removeBody(p.id);
        list = list.flatMap((q) => (q === p ? [A, Bp] : [q]));
        for (const q of [A, Bp]) q.id = stage.addBody(q.body, g, { tier, position: { x: 0, y: 0, z: 0 }, chunk: true });
      }
      for (const [q, c, s] of [[A, lc.a, 1], [Bp, lc.b, -1]] as [Piece, V3, number][]) if (q.chunk) { try { q.body.moveTo?.({ x: c.x + s * n.x * 0.06, y: c.y, z: c.z + s * n.z * 0.06 }, 4); settling.push({ p: q, until: time + 0.8 }); } catch { /* optional */ } }
      const ia = viewOf(A), ib = viewOf(Bp);
      if (ia !== null && ib !== null) stage.partPieces!(ia, ib);
      // the seam must be carried over onto the new pieces by now (one frame later): their views' seam strength
      stage.update(0, { time, pointerNdc: null });
      out.seamCarry.push(Math.max(0, ...stage.views.map((v) => v.seamAmount)));
      phase = 'pieces';
      out.cutsDone++; out.marks.push(`cut ${out.cutsDone}@${(time - tStart).toFixed(2)}`);
      return true;
    };
    for (let c = 0; c < o.swipes.length; c++) {
      if (cutOnce(o.swipes[c])) for (let i = 0, n = Math.round((o.gapS ?? 0.45) / dt); i < n; i++) step();
      if (c === 0) shot('cut1');
    }
    for (let i = 0; i < Math.round(1.0 / dt); i++) step();
    shot('pieces');
    // framed: every piece inside the frame once the camera has framed them
    {
      const cam = stage.camera, W = canvas.clientWidth || canvas.width, H = canvas.clientHeight || canvas.height;
      out.framed.pieces = stage.views.length;
      for (const v of stage.views) {
        let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        const P = v.proxy.positions;
        for (let i = 0; i < P.length; i += 3) { pv.set(P[i], P[i + 1], P[i + 2]).project(cam); const sx = (pv.x * 0.5 + 0.5) * W, sy = (1 - (pv.y * 0.5 + 0.5)) * H; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
        if (x0 < 0 || y0 < 0 || x1 > W || y1 > H) out.framed.inFrame = false;
        out.framed.minPx = Math.min(out.framed.minPx, x1 - x0);
      }
    }
    if (o.reconnect !== false && list.length > 1) {
      phase = 'reconnect';
      const face = list[0], secs = 1.2;
      face.body.setFrac!(1, secs);
      for (const q of list.slice(1)) { q.body.setFrac!(1 / 8, secs); q.ghost = true; }
      const tr = time;
      while (time - tr < secs) {
        const k = smooth((time - tr) / secs);
        for (const q of list.slice(1)) { stage.setBridge!(viewOf(face)!, viewOf(q)!, k); q.body.moveTo?.(face.body.center, 1.6); }
        step();
        if (Math.abs((time - tr) - secs * 0.4) < dt / 2) shot('reconnect');
      }
      for (const q of list.slice(1)) { stage.setBridge!(viewOf(face)!, viewOf(q)!, 0); try { q.body.moveTo?.(null); } catch { /* optional */ } }
      for (const q of list.slice(1)) if (q.id !== null) stage.removeBody(q.id);
      const nb = new SB(g);
      list = [{ body: nb, chunk: false, frac: 1, id: null, ghost: false }];
      swapTo(list[0]);
      out.marks.push(`whole@${(time - tStart).toFixed(2)}`);
    }
    for (let i = 0; i < Math.round(1.0 / dt); i++) step();
    shot('whole');
    stage.onStrand = null;
    out.viewsAtEnd = stage.views.length; out.facesAtEnd = stage.views.filter((v) => !v.chunk).length; out.piecesAtEnd = list.length;
    if (!Number.isFinite(out.minTopPx)) out.minTopPx = 0;
    stage.setCalmEffects(false); stage.clearBodies(); setupBody(genome);
    out.ms = performance.now() - t0;
    return out;
  },

  /**
   * A capsule dropped BEFORE the stage has a size: the shell drops one that is already waiting while it builds the game, before its first resize()
   * (and, before this was fixed, it was placed on a 1 x 1 frame: in FRONT of the squishy, full size, against the frame's edge). A fresh stage on
   * a temporary canvas, the HUD rows set first as the shell's HUD binding does, the capsule dropped, THEN resize(); where does it stand?
   */
  bootDropProbe(o: { genome: Genome; w: number; h: number; insets: { top?: number; bottom?: number; left?: number; right?: number }; steps?: number; /** no capsule at all: the body's own box at this frame (what the capsule's pull-back is measured against) */ baseline?: boolean }): CapReport & { beforeResize: { landed: boolean; point: boolean }; png: string } {
    const c2 = document.createElement('canvas'); c2.width = o.w; c2.height = o.h;
    c2.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(c2);
    const s2 = createStageDev(c2);
    try {
      s2.setSafeInsets(o.insets);
      const b = makeBody(o.genome); s2.setBody(b, o.genome);
      const hd = o.baseline ? ({ landed: false, screenPoint: () => null, hitTest: () => false, id: 0, setSqueeze() {}, wobble() {}, remove() {} } as CapsuleHandle) : s2.dropCapsule!();
      const beforeResize = { landed: hd.landed, point: !!hd.screenPoint() };
      s2.resize(o.w, o.h, 1);
      let tt = 0;
      for (let i = 0; i < (o.steps ?? 240); i++) { b.step(1 / 60); events.length = 0; b.drainEvents(events); tt += 1 / 60; s2.update(1 / 60, { time: tt, pointerNdc: null }); }
      s2.render();
      return { ...capReport(s2, hd, o.w, o.h), beforeResize, png: c2.toDataURL('image/png') };
    } finally { s2.dispose(); c2.remove(); }
  },
  /**
   * A WAITING capsule when the frame, the HUD rows or the bodies change under it (the phone is turned, the HUD grows a row, another squishy is
   * switched in): it glides to a clean spot by itself. Reports after the first landing, after a resize, after the HUD's bottom row grows and
   * after the squishy is swapped for a wide species.
   */
  capLiveProbe(o: { genome: Genome; w1: number; h1: number; ins1: { top?: number; bottom?: number }; w2: number; h2: number; ins2: { top?: number; bottom?: number }; bottom3: number; wide: Genome }): { r0: CapReport; r1: CapReport; r2: CapReport; r3: CapReport; pngs: string[]; moved: number[] } {
    const c2 = document.createElement('canvas'); c2.width = o.w1; c2.height = o.h1;
    c2.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
    document.body.appendChild(c2);
    const s2 = createStageDev(c2);
    try {
      s2.resize(o.w1, o.h1, 1); s2.setSafeInsets(o.ins1);
      let b = makeBody(o.genome); s2.setBody(b, o.genome);
      let tt = 0;
      const run = (n: number): void => { for (let i = 0; i < n; i++) { b.step(1 / 60); events.length = 0; b.drainEvents(events); tt += 1 / 60; s2.update(1 / 60, { time: tt, pointerNdc: null }); } s2.render(); };
      run(60);
      const hd = s2.dropCapsule!();
      run(240);
      const r0 = capReport(s2, hd, o.w1, o.h1), pngs: string[] = [c2.toDataURL('image/png')], moved: number[] = [];
      let pos0 = { x: r0.x, z: r0.z };
      const note = (r: CapReport): void => { moved.push(Math.hypot(r.x - pos0.x, r.z - pos0.z)); pos0 = { x: r.x, z: r.z }; };
      s2.resize(o.w2, o.h2, 1); s2.setSafeInsets(o.ins2);
      run(300);
      const r1 = capReport(s2, hd, o.w2, o.h2); pngs.push(c2.toDataURL('image/png')); note(r1);
      s2.setSafeInsets({ bottom: o.bottom3 });
      run(300);
      const r2 = capReport(s2, hd, o.w2, o.h2); pngs.push(c2.toDataURL('image/png')); note(r2);
      b = makeBody(o.wide); s2.setBody(b, o.wide);
      run(360);
      const r3 = capReport(s2, hd, o.w2, o.h2); pngs.push(c2.toDataURL('image/png')); note(r3);
      return { r0, r1, r2, r3, pngs, moved };
    } finally { s2.dispose(); c2.remove(); }
  },

  /** n frames without rendering; the stage's camera framing (info.camScale) after each. */
  camTrace(n: number, dt = 1 / 60): number[] { const s: number[] = []; for (let i = 0; i < n; i++) { frame(dt, false); s.push(stage.info.camScale); } return s; },

  /** The frame is opaque: how many pixels of the WebGL drawing buffer have alpha < 255 (the page's CSS gradient would show through them). */
  opaqueProbe(): { w: number; h: number; notOpaque: number } {
    stage.render();
    const gl = stage.renderer.getContext() as WebGL2RenderingContext, w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    let n = 0;
    for (let i = 3; i < buf.length; i += 4) if (buf[i] < 255) n++;
    return { w, h, notOpaque: n };
  },

  /** createBody that throws inside playCapsuleReveal / playMergeCeremony: the stage must be exactly as it was (plus the capsule that stood on the table). */
  throwProbe(): { capsule: Record<string, unknown>; merge: Record<string, unknown> } {
    const res = { capsule: {} as Record<string, unknown>, merge: {} as Record<string, unknown> };
    const snap = (): { views: number; visible: number; children: number; ceremony: boolean } => ({ views: stage.views.length, visible: stage.views.filter((v) => v.visible).length, children: stage.scene.children.length, ceremony: stage.info.ceremony });
    for (const kind of ['capsule', 'merge'] as const) {
      stage.clearBodies(); setupBody(genomeFromParam(''));
      RV.frames(10);
      let cap: CapsuleHandle | null = null;
      if (kind === 'capsule') { cap = stage.dropCapsule(); RV.frames(70); }
      const before = snap();
      let n = 0, threw = '';
      const cb = (g2: Genome): SoftBodyLike => { n++; if (kind === 'capsule' || n === 2) throw new Error('createBody boom'); return makeBody(g2); };
      try {
        if (kind === 'capsule') stage.playCapsuleReveal({ result: { genome: resultGenome('legendary'), tier: 'legendary' }, createBody: cb, capsule: cap ?? undefined });
        else stage.playMergeCeremony({ parents: parentGenomes(2).map((g2) => ({ genome: g2 })), result: { genome: resultGenome('mythic'), tier: 'mythic' }, createBody: cb });
      } catch (e) { threw = String(e); }
      RV.frames(20, 1 / 30, true);
      const after = snap();
      const primary = stage.views.find((v) => v.id === stage.primaryBodyId());
      const r = kind === 'capsule' ? res.capsule : res.merge;
      Object.assign(r, { threw, before, after, primaryVisible: !!primary && primary.visible, capsuleStanding: stage.info.capsule, capsuleTappable: cap ? cap.landed && !!cap.screenPoint() : null });
      if (cap) cap.remove();
    }
    stage.clearBodies(); setupBody(genomeFromParam(''));
    return res;
  },

  /** clearBodies / removeBody / setBody while a ceremony runs: no dangling primary, done resolves, nothing is left half-built. */
  async misuseProbe(): Promise<Record<string, { done: boolean; primaryHasView: boolean; bodies: number; resultInViews: boolean }>> {
    const out: Record<string, { done: boolean; primaryHasView: boolean; bodies: number; resultInViews: boolean }> = {};
    for (const act of ['clearBodies', 'removeResult', 'setBody']) {
      stage.clearBodies(); setupBody(genomeFromParam(''));
      const h = stage.playMergeCeremony({ parents: parentGenomes(2).map((g2) => ({ genome: g2 })), result: { genome: resultGenome('epic'), tier: 'epic' }, createBody: makeBody });
      RV.frames(30, 1 / 30);
      if (act === 'clearBodies') stage.clearBodies();
      else if (act === 'removeResult') stage.removeBody(h.resultBodyId ?? -1);
      else { const g2 = genomeFromParam('2'); const b2 = makeBody(g2); body = b2; stage.setBody(b2, g2); }
      for (let k = 0; k < 300 && h.active; k++) frame(1 / 30, k % 10 === 0);
      const done = await Promise.race([h.done.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 500))]);
      const prim = stage.primaryBodyId();
      out[act] = { done, primaryHasView: prim === null ? stage.views.length === 0 : stage.views.some((v) => v.id === prim), bodies: stage.views.length, resultInViews: stage.views.some((v) => v.id === h.resultBodyId) };
    }
    stage.clearBodies(); setupBody(genomeFromParam(''));
    return out;
  },

  /** The tier-up merge's last frames: live particles right before the ceremony ends and one frame after (the sparkles must live out their lives). */
  async particleTail(): Promise<{ before: number; after: number }> {
    stage.clearBodies(); setupBody(genomeFromParam('')); stage.setCalmEffects(false);
    RV.merge('epic', 2, true);
    const h = cer.handle as CeremonyHandle;
    let before = 0;
    for (let k = 0; k < 600 && h.active; k++) { before = stage.info.particles; frame(1 / 30, false); }
    const after = stage.info.particles;
    if (h.resultBody) body = h.resultBody;
    await h.done;
    return { before, after };
  },

  /** The camera framing (stage.info.camScale) through a ceremony: its smallest and largest value relative to the first frame. */
  camThrough(kind: 'merge' | 'capsule', tier: TierName): { min: number; max: number; first: number; last: number } {
    stage.clearBodies(); setupBody(genomeFromParam('')); stage.setCalmEffects(false); RV.frames(120);
    // (parents and result are the SAME squishy, so the framing of their size cannot change by itself: only a tier widening would show)
    if (kind === 'merge') { const g2 = genomeFromParam(''); resetCer('merge', tier, mergeDuration(tier, { tierUp: false, calm: false })); cer.handle = stage.playMergeCeremony({ parents: [{ genome: g2 }, { genome: g2 }], result: { genome: g2, tier, isNew: true }, createBody: makeBody }, hooksFor); } else RV.capsuleReveal(tier);
    const h = cer.handle as CeremonyHandle;
    const first = stage.info.camScale; let lo = first, hi = first;
    for (let k = 0; k < 800 && h.active; k++) { frame(1 / 30, false); lo = Math.min(lo, stage.info.camScale); hi = Math.max(hi, stage.info.camScale); }
    if (h.resultBody) body = h.resultBody;
    return { min: lo, max: hi, first, last: stage.info.camScale };
  },

  /** How close the Mythic prism dome's rim comes to the frame's sides during a whole ceremony (CSS px; negative = it crosses a side). */
  domeMargin(kind: 'merge' | 'capsule', tier: TierName = 'mythic'): { minMarginPx: number; atFrame: number; rx: number } {
    stage.clearBodies(); setupBody(genomeFromParam('')); stage.setCalmEffects(false); RV.frames(40, 1 / 30);
    if (kind === 'merge') RV.merge(tier, 2, false); else RV.capsuleReveal(tier);
    const h = cer.handle as CeremonyHandle, W = canvas.clientWidth || canvas.width, P = new THREE.Vector3();
    let minM = Infinity, at = -1, rx = 0;
    for (let f = 1; f <= 600 && h.active; f++) {
      frame(1 / 30, false);
      stage.scene.traverse((o) => {
        if (o.renderOrder !== 26 || !o.visible || !(o as THREE.Mesh).isMesh) return;
        for (const sx of [-1, 1]) { P.set(o.position.x + sx * o.scale.x, 0, o.position.z).project(stage.camera); const px = (P.x * 0.5 + 0.5) * W, m = sx < 0 ? px : W - px; if (m < minM) { minM = m; at = f; rx = o.scale.x; } }
      });
    }
    if (h.resultBody) body = h.resultBody;
    return { minMarginPx: Number.isFinite(minM) ? minM : 1e9, atFrame: at, rx };
  },

  /**
   * How far a tier's halo reaches on a narrow frame: the mean absolute difference of the frame's two edge columns (6 px) with the tier FX on and
   * hidden, over the rows the body occupies. 0 = the halo never reaches the frame's sides.
   */
  haloEdge(tier: TierName, seedOrGenome: string | number | Genome = ''): { edge: number; w: number; h: number } {
    RV.showTier(tier, seedOrGenome); RV.frames(100);
    const grab = (): Uint8ClampedArray => { stage.render(); const c2 = document.createElement('canvas'); c2.width = canvas.width; c2.height = canvas.height; const x2 = c2.getContext('2d', { willReadFrequently: true }); if (!x2) return new Uint8ClampedArray(0); x2.drawImage(canvas, 0, 0); return x2.getImageData(0, 0, canvas.width, canvas.height).data; };
    const on = grab();
    const v = stage.views[0];
    const was = v.rarity.group.visible; v.rarity.group.visible = false;
    const off = grab();
    v.rarity.group.visible = was;
    const W = canvas.width, H = canvas.height; let s = 0, n = 0;
    for (let y = Math.round(H * 0.25); y < Math.round(H * 0.75); y++) for (const x of [0, 1, 2, 3, 4, 5, W - 6, W - 5, W - 4, W - 3, W - 2, W - 1]) { const i = (y * W + x) * 4; s += (Math.abs(on[i] - off[i]) + Math.abs(on[i + 1] - off[i + 1]) + Math.abs(on[i + 2] - off[i + 2])) / 3; n++; }
    return { edge: n ? s / n : 0, w: W, h: H };
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
