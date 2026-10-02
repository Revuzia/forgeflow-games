// Mock SoftBodyLike / StageLike / SquishAudio that record every call, for the node probes (no DOM, no WebGL, no audio).
// The mock body follows the CONTRACT's event rules closely enough to catch the bugs that matter to the shell:
//   poke on first contact, press once held >= 0.18 s, release ONLY when compression > 0.08 at lift (so a press voice
//   can not rely on a release event to end), grab/snap for pulls, land on request.
import * as THREE from 'three';
import type {
  FxKind, QualityTier, RayHit, SoftBodyLike, SoftEvent, SoftMetrics, SquishAudio, SquishVoiceHandle, StageFrameInput, StageLike, V3,
  FingerDownArgs,
} from '../src/contracts.ts';
import type { Genome } from '../src/core/genome.ts';
import type { AppDeps } from '../src/app.ts';
import type { Haptics } from '../src/input/haptics.ts';

export interface Call { name: string; args: unknown[]; /** wall order across the whole mock set */ seq: number }
let SEQ = 0;

export function recorder(): { calls: Call[]; rec(name: string, ...args: unknown[]): void; count(name: string): number; of(name: string): Call[]; clear(): void } {
  const calls: Call[] = [];
  return {
    calls,
    rec(name, ...args) { calls.push({ name, args, seq: SEQ++ }); },
    count: (name) => calls.filter((c) => c.name === name).length,
    of: (name) => calls.filter((c) => c.name === name),
    clear() { calls.length = 0; },
  };
}

const V = (x: number, y: number, z: number): V3 => ({ x, y, z });

export interface MockBody extends SoftBodyLike {
  readonly rec: ReturnType<typeof recorder>;
  /** inject an event as if the physics had produced it */
  queue(ev: Partial<SoftEvent> & { kind: SoftEvent['kind'] }): void;
  simTime: number;
  stepCalls: number;
  /** disable the built-in contract-faithful event simulation */
  auto: boolean;
  fingerIsDown(id: 0 | 1): boolean;
  grabIsActive(id: 0 | 1): boolean;
}

export function createMockBody(genome?: Genome, o: { auto?: boolean } = {}): MockBody {
  const rec = recorder();
  const N = 642;
  const positions = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N, r = Math.sqrt(1 - y * y), th = i * 2.399963;
    positions[i * 3] = Math.cos(th) * r * 0.5; positions[i * 3 + 1] = 0.4 + y * 0.45; positions[i * 3 + 2] = Math.sin(th) * r * 0.5;
  }
  const metrics: SoftMetrics = { compression: 0, compressionRate: 0, stretch: 0, volume: 1, kinetic: 0, grounded: true, fingers: 0, grabbed: false };
  const events: SoftEvent[] = [];
  const centre = V(0, 0.4, 0);
  const fing = [0, 1].map(() => ({ down: false, target: 0, depth: 0, held: 0, poked: false, pressed: false, at: V(0, 0, 0), normal: V(0, 0, 1), up: false, upDepth: 0, upHeld: 0 }));
  const grabs = [0, 1].map(() => ({ active: false, announced: false, target: V(0, 0, 0), release: false, relStretch: 0 }));

  const body: MockBody = {
    rec,
    vertexCount: N,
    positions,
    restLocal: new Float32Array(N * 3),
    indices: new Uint32Array(0),
    strain: new Float32Array(N).fill(1),
    center: centre,
    frame: { x: 0, y: 0, z: 0, w: 1 },
    metrics,
    restRadius: 0.5,
    gravity: true,
    simTime: 0,
    stepCalls: 0,
    auto: o.auto !== false,
    fingerIsDown: (id) => fing[id].down,
    grabIsActive: (id) => grabs[id].active,
    queue(ev) {
      events.push({ at: V(0, 0.5, 0.5), normal: V(0, 0, 1), intensity: 0.5, heldFor: 0, finger: 0, ...ev });
    },
    step(dt) {
      rec.rec('step', dt);
      body.stepCalls++;
      const d = Math.min(Math.max(dt, 0), 1 / 20);
      body.simTime += d;
      if (!body.auto) return;
      let comp = 0, prev = metrics.compression;
      for (let i = 0; i < 2; i++) {
        const f = fing[i];
        if (f.down) {
          f.held += d;
          f.depth += (f.target - f.depth) * (1 - Math.exp(-d / 0.08));
          if (!f.poked) { f.poked = true; events.push({ kind: 'poke', at: f.at, normal: f.normal, intensity: 0.6, heldFor: 0, finger: i }); }
          if (!f.pressed && f.held >= 0.18) { f.pressed = true; events.push({ kind: 'press', at: f.at, normal: f.normal, intensity: f.depth, heldFor: f.held, finger: i }); }
          comp = Math.max(comp, f.depth * 0.9);
        } else if (f.up) {
          f.up = false;
          if (f.upDepth * 0.9 > 0.08) events.push({ kind: 'release', at: f.at, normal: f.normal, intensity: f.upDepth * 0.9, heldFor: f.upHeld, finger: i });
          f.depth = 0; f.held = 0;
        }
        const g = grabs[i];
        if (g.active && !g.announced) { g.announced = true; events.push({ kind: 'grab', at: g.target, normal: V(0, 1, 0), intensity: 0.3, heldFor: 0, finger: i }); }
        if (g.release) {
          g.release = false;
          if (g.relStretch > 0.05) events.push({ kind: 'snap', at: g.target, normal: V(0, 1, 0), intensity: g.relStretch, heldFor: 0.5, finger: i });
        }
      }
      let stretch = 0;
      for (const g of grabs) if (g.active) stretch = Math.max(stretch, 0.8);
      metrics.stretch += (stretch - metrics.stretch) * (1 - Math.exp(-d / 0.1));
      metrics.compression = comp;
      metrics.compressionRate = d > 0 ? (comp - prev) / d : 0;
      metrics.fingers = (fing[0].down ? 1 : 0) + (fing[1].down ? 1 : 0);
      metrics.grabbed = grabs[0].active || grabs[1].active;
    },
    raycast(origin, dir): RayHit | null {
      rec.rec('raycast');
      const ox = origin.x - centre.x, oy = origin.y - centre.y, oz = origin.z - centre.z;
      const R = 0.5;
      const b = ox * dir.x + oy * dir.y + oz * dir.z;
      const c = ox * ox + oy * oy + oz * oz - R * R;
      const disc = b * b - c;
      if (disc < 0) return null;
      const t = -b - Math.sqrt(disc);
      if (t < 0) return null;
      const p = V(origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t);
      const n = V((p.x - centre.x) / R, (p.y - centre.y) / R, (p.z - centre.z) / R);
      const vertex = Math.abs(Math.floor((n.x * 31 + n.y * 17 + n.z * 7) * 1000)) % N;
      return { point: p, normal: n, vertex, t };
    },
    fingerDown(id, a: FingerDownArgs) {
      rec.rec('fingerDown', id, a);
      const f = fing[id];
      Object.assign(f, { down: true, target: 0, depth: 0, held: 0, poked: false, pressed: false, at: a.point, normal: a.normal, up: false });
    },
    fingerPressure(id, target) { rec.rec('fingerPressure', id, target); fing[id].target = target; },
    fingerMove(id, point) { rec.rec('fingerMove', id, point); fing[id].at = point; },
    fingerUp(id) {
      rec.rec('fingerUp', id);
      const f = fing[id];
      if (!f.down) return;
      f.down = false; f.up = true; f.upDepth = f.depth; f.upHeld = f.held;
    },
    grab(id, vertex, target) { rec.rec('grab', id, vertex, target); Object.assign(grabs[id], { active: true, announced: false, target, release: false }); },
    grabMove(id, target) { rec.rec('grabMove', id, target); grabs[id].target = target; },
    grabRelease(id) { rec.rec('grabRelease', id); const g = grabs[id]; if (g.active) { g.active = false; g.release = true; g.relStretch = metrics.stretch; } },
    nudge(imp) { rec.rec('nudge', imp); },
    reset() { rec.rec('reset'); },
    drainEvents(out) { for (const e of events) out.push(e); events.length = 0; },
    stateHash() { return (body.stepCalls * 2654435761) >>> 0; },
  };
  void genome;
  return body;
}

export interface MockStage extends StageLike {
  readonly rec: ReturnType<typeof recorder>;
  readonly camera: THREE.PerspectiveCamera;
  size: { w: number; h: number; dpr: number };
}

export function createMockStage(): MockStage {
  const rec = recorder();
  const camera = new THREE.PerspectiveCamera(40, 800 / 600, 0.05, 50);
  camera.position.set(0, 0.9, 3.2);
  camera.lookAt(0, 0.35, 0);
  camera.updateMatrixWorld(true);
  const canvas = { toDataURL: () => 'data:image/png;base64,iVBORw0KGgo=' } as unknown as HTMLCanvasElement;
  const st: MockStage = {
    rec, camera, canvas, size: { w: 800, h: 600, dpr: 1 },
    setBody(b, g) { rec.rec('setBody', b, g); },
    update(dt: number, input: StageFrameInput) { rec.rec('update', dt, input); },
    render() { rec.rec('render'); },
    resize(w, h, dpr) { rec.rec('resize', w, h, dpr); st.size = { w, h, dpr }; camera.aspect = w / h; camera.updateProjectionMatrix(); },
    orbit(dy, dp) { rec.rec('orbit', dy, dp); },
    zoom(d) { rec.rec('zoom', d); },
    shake(a) { rec.rec('shake', a); },
    setShakeScale(s) { rec.rec('setShakeScale', s); },
    setQuality(q: QualityTier | 'auto') { rec.rec('setQuality', q); },
    setFloatMode(on) { rec.rec('setFloatMode', on); },
    spawnFx(kind: FxKind, at: V3, intensity: number) { rec.rec('spawnFx', kind, at, intensity); },
    dispose() { rec.rec('dispose'); },
    stats() { return { drawCalls: 0, triangles: 0, tier: 'med' as QualityTier, frameMsEma: 0 }; },
  };
  return st;
}

export interface MockAudio extends SquishAudio {
  readonly rec: ReturnType<typeof recorder>;
  /** squish voices currently open (started and not ended) */
  readonly live: Set<MockVoice>;
  readonly allVoices: MockVoice[];
  unlocked: boolean;
  state: string;
}
export interface MockVoice extends SquishVoiceHandle { id: number; ended: boolean; updates: Array<{ compression: number; rate: number; pan?: number }>; opts: unknown }

export function createMockAudio(): MockAudio {
  const rec = recorder();
  const started: Record<string, number> = {};
  const live = new Set<MockVoice>();
  const allVoices: MockVoice[] = [];
  let nextId = 1;
  const a: MockAudio = {
    rec, live, allVoices, unlocked: false, state: 'suspended',
    get ready() { return a.unlocked; },
    unlock() { rec.rec('unlock'); a.unlocked = true; a.state = 'running'; return Promise.resolve(); },
    setSettings(s) { rec.rec('setSettings', s); },
    poke(p) { rec.rec('poke', p); started.poke = (started.poke ?? 0) + 1; },
    squishStart(p) {
      rec.rec('squishStart', p);
      started.squish = (started.squish ?? 0) + 1;
      const v: MockVoice = {
        id: nextId++, ended: false, updates: [], opts: p,
        update(u) { if (v.ended) throw new Error('update() after end()'); v.updates.push(u); },
        end() { if (v.ended) return; v.ended = true; live.delete(v); rec.rec('squishEnd', v.id); },
      };
      live.add(v); allVoices.push(v);
      return v;
    },
    release(p) { rec.rec('release', p); started.release = (started.release ?? 0) + 1; },
    land(p) { rec.rec('land', p); started.land = (started.land ?? 0) + 1; },
    pop(p) { rec.rec('pop', p); started.pop = (started.pop ?? 0) + 1; },
    blend(p) { rec.rec('blend', p); started.blend = (started.blend ?? 0) + 1; return { stop() { rec.rec('blendStop'); } }; },
    stats() { return { started: { ...started }, state: a.state, sampleRate: 48000, peak: 0 }; },
  };
  return a;
}

export interface MockHaptics extends Haptics { readonly rec: ReturnType<typeof recorder>; enabled: boolean }
export function createMockHaptics(): MockHaptics {
  const rec = recorder();
  const h: MockHaptics = {
    rec, enabled: true, supported: true,
    setEnabled(on) { h.enabled = on; rec.rec('setEnabled', on); },
    poke() { if (h.enabled) rec.rec('poke'); },
    squeeze(rate) { if (h.enabled) rec.rec('squeeze', rate); },
    release() { if (h.enabled) rec.rec('release'); },
    pop() { if (h.enabled) rec.rec('pop'); },
    cancel() { rec.rec('cancel'); },
  };
  return h;
}

export interface MockWorld {
  deps: AppDeps;
  bodies: MockBody[];
  readonly body: MockBody;
  stage: MockStage;
  audio: MockAudio;
  haptics: MockHaptics;
  clock: { t: number };
  /** advance the fake clock by `ms` in frames of `frameMs`, calling app.frame each time */
  run(app: { frame(ts: number): void }, ms: number, frameMs?: number): void;
}

export function createMockWorld(o: { auto?: boolean; storage?: AppDeps['storage'] } = {}): MockWorld {
  const bodies: MockBody[] = [];
  const stage = createMockStage();
  const audio = createMockAudio();
  const haptics = createMockHaptics();
  const clock = { t: 1000 };
  const world: MockWorld = {
    bodies, stage, audio, haptics, clock,
    get body() { return bodies[bodies.length - 1]; },
    deps: {
      createBody: (g) => { const b = createMockBody(g, { auto: o.auto }); bodies.push(b); return b; },
      createStage: () => stage,
      createAudio: () => audio,
      haptics,
      storage: o.storage === undefined ? null : o.storage,
      env: { vibrate: true, reducedMotion: false },
      now: () => clock.t,
      raf: () => 0,
      caf: () => {},
    },
    run(app, ms, frameMs = 1000 / 60) {
      let left = ms;
      while (left > 1e-9) { const d = Math.min(frameMs, left); clock.t += d; app.frame(clock.t); left -= d; }
    },
  };
  return world;
}
