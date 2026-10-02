// WOBBLEHOARD — the seams between lanes. Types only (no runtime code), so every lane can import this without cycles.
// Full prose contract: _spec/CONTRACT.md. If a lane needs to change a signature here, it changes THIS file in the
// smallest backwards-compatible way (add optional fields), never renames or removes, and reports the change.
import type * as THREE from 'three';
import type { Genome } from './core/genome.ts';

export interface V3 { x: number; y: number; z: number }

/* ───────────────────────────── physics (src/physics) — pure TypeScript, NO three.js import, deterministic ───────────────────────────── */

/** Discrete things that happened this step. Audio, haptics, FX and screen shake all key off these. */
export type SoftEventKind =
  | 'poke'     // a finger touched the surface (intensity = impact speed, 0..1)
  | 'press'    // a poke turned into a held squeeze (after ~0.18 s); intensity = current depth 0..1
  | 'release'  // a finger lifted while the body was compressed (intensity = compression released, 0..1; heldFor = seconds pressed)
  | 'land'     // body hit the table (intensity = impact speed, 0..1)
  | 'grab'     // a pull started
  | 'snap';    // a pull was let go while stretched (intensity = stretch released, 0..1)

export interface SoftEvent {
  kind: SoftEventKind;
  at: V3;            // world-space point of the event
  normal: V3;        // outward surface normal there (unit)
  intensity: number; // 0..1, see kinds above
  heldFor: number;   // seconds (release / snap), else 0
  finger: number;    // 0 or 1 (-1 for 'land')
}

/** Continuous readouts, valid after step(). Audio drives its squelch from these, the renderer drives the blush and the eyes. */
export interface SoftMetrics {
  compression: number;      // 0..1. 0 = rest height, 1 = flattened to <=25% of rest height (measured along the dominant press axis; table squash counts)
  compressionRate: number;  // 1/s, signed: >0 squeezing, <0 springing back (low-pass filtered, ~60 ms)
  stretch: number;          // 0..1. 0 = rest, 1 = pulled to ~2.2x rest extent
  volume: number;           // current enclosed volume / rest volume (should stay ~1)
  kinetic: number;          // 0..1 normalised internal jiggle energy (0 = settled)
  grounded: boolean;        // resting on the table (always false in float mode unless it touches it)
  fingers: number;          // number of fingers currently down (0..2)
  grabbed: boolean;
}

export interface RayHit { point: V3; normal: V3; vertex: number; t: number }

export interface FingerDownArgs {
  point: V3;     // surface hit (from raycast)
  normal: V3;    // outward normal at the hit
  dir: V3;       // unit direction the finger travels (the camera ray direction)
}

export interface SoftBodyLike {
  /** Simulation mesh (detail-3 icosphere, ~642 verts by default). The renderer may build a finer mesh from it. */
  readonly vertexCount: number;
  readonly positions: Float32Array;  // world space xyz*n, mutated IN PLACE every step() (never reallocated)
  readonly restLocal: Float32Array;  // rest positions in body-local space, centred on the rest centre of mass
  readonly indices: Uint32Array;     // triangles, outward winding
  readonly strain: Float32Array;     // per vertex: mean(edge length / rest edge length). <1 compressed, 1 rest, >1 stretched
  readonly center: V3;               // current centre of mass (world)
  readonly frame: { x: number; y: number; z: number; w: number }; // best-fit rotation quaternion (shape matching)
  readonly metrics: SoftMetrics;
  readonly restRadius: number;       // world units (~0.5 x genome size factor)
  /** true = tabletop gravity; false = floating (hovers, drifts back after a shove). Switching is instant and keeps the shape. */
  gravity: boolean;

  /** Advance by a REAL frame dt (seconds). Clamped to [0, 1/20] and split into fixed substeps internally. */
  step(dt: number): void;
  /** Ray vs the current surface. Origin/dir in world space; dir need not be normalised. */
  raycast(origin: V3, dir: V3): RayHit | null;

  // fingers: ids 0 and 1 (two fingers = pinch). The body owns the depth ramp so squeezing feels the same on every device.
  fingerDown(id: 0 | 1, a: FingerDownArgs): void;
  /** Target press depth 0..1 (fraction of the max safe depth). The body eases toward it; the input layer ramps it with hold time. */
  fingerPressure(id: 0 | 1, target: number): void;
  /** Slide the contact: world-space point on the surface under the pointer (from a fresh raycast). */
  fingerMove(id: 0 | 1, point: V3): void;
  fingerUp(id: 0 | 1): void;

  /** Pull: attach the vertices around `vertex` to a world target; move it; let go (-> springs back, emits 'snap'). */
  grab(id: 0 | 1, vertex: number, target: V3): void;
  grabMove(id: 0 | 1, target: V3): void;
  grabRelease(id: 0 | 1): void;

  /** External shove (screen-bump, drop-in). World-space velocity change applied to every particle. */
  nudge(impulse: V3): void;
  /** Put the body back at rest shape on the table / hover height. */
  reset(): void;
  /** Append pending events to `out` and clear them. */
  drainEvents(out: SoftEvent[]): void;
  /** A cheap 32-bit hash of the particle state (determinism probe). */
  stateHash(): number;
  /**
   * Optional (PHYS addition): the fingertip sphere of finger `id` in world space (centre, radius, eased depth 0..1), or null
   * when that finger has no tip. For a finger ghost / contact FX. Allocates, so call it once per frame at most.
   */
  tip?(id: 0 | 1): { x: number; y: number; z: number; r: number; depth: number } | null;
}

export interface SoftBodyCtor {
  new (genome: Genome, opts?: { detail?: number; seed?: number }): SoftBodyLike;
}

/* ───────────────────────────── audio (src/audio) — procedural WebAudio, zero samples ───────────────────────────── */

export interface AudioSettings {
  master: number;      // 0..1 overall volume
  squishBoost: number; // 0..1: "louder squish" — 0 = baseline, 1 = +9 dB on the squish/release/poke voices (limiter stays on)
  muted: boolean;
}

export interface SquishVoiceHandle {
  /** Per-frame control of the held squelch. `atTime` (AudioContext time) lets offline renders script it; live use omits it. */
  update(p: { compression: number; rate: number; pan?: number }, atTime?: number): void;
  /** Fade out and free the nodes. `atTime` (AudioContext time) lets offline renders script the end; live use omits it. */
  end(fadeS?: number, atTime?: number): void;
}

export interface SquishAudio {
  readonly ready: boolean;
  /** Resume/create the AudioContext. MUST be called from a user gesture. Safe to call repeatedly. */
  unlock(): Promise<void>;
  setSettings(s: Partial<AudioSettings>): void;
  /** `pitch` is a ratio (1 = base; use pitchRatio(genome)). `pan` -1..1. */
  poke(p: { intensity: number; pitch?: number; pan?: number }): void;
  squishStart(p?: { pitch?: number; pan?: number }): SquishVoiceHandle;
  release(p: { compression: number; pitch?: number; pan?: number }): void;
  land(p: { intensity: number; pitch?: number }): void;
  pop(p?: { size?: number; pitch?: number; pan?: number }): void;
  /** Blender: whirr + slosh for `durationS`, then a finishing flourish. Returns a handle to cut it short. */
  blend(p?: { count?: number; durationS?: number }): { stop(): void };
  /** Harness readout: how many voices of each kind were started, context state, sample rate, output peak since last call. */
  /**
   * Harness readout: how many voices of each kind were started, context state, sample rate, output peak (linear, 0..1)
   * since the last call. `live` / `liveNodes` / `dropped` are optional extras (voice groups and audio nodes currently
   * alive, voices refused because the context was not running or the call was invalid).
   */
  stats(): { started: Record<string, number>; state: string; sampleRate: number; peak: number; live?: number; liveNodes?: number; dropped?: number };
  /** Optional: tab hidden / visible. `true` suspends the context and frees every live voice; `false` resumes it. */
  setPaused?(paused: boolean): void;
  /** Optional: stop the housekeeping timer and close the context. The instance is unusable afterwards. */
  dispose?(): void;
}

/* ───────────────────────────── render (src/render) ───────────────────────────── */

export type QualityTier = 'low' | 'med' | 'high';
export type FxKind = 'bubbles' | 'glitter' | 'dust' | 'ring';

export interface StageFrameInput {
  time: number;                              // seconds since boot (monotonic)
  pointerNdc: { x: number; y: number } | null; // eyes follow the pointer when present. Standard NDC: x -1..1 left to right, y -1..1 BOTTOM to TOP
}

export interface StageLike {
  readonly canvas: HTMLCanvasElement;
  readonly camera: THREE.PerspectiveCamera;
  /** Build the jelly view (fine render mesh, material, core, eyes, glitter) for this body. Replaces any previous one. */
  setBody(body: SoftBodyLike, genome: Genome): void;
  /** Sync meshes from the body and animate eyes/FX. Call once per frame after body.step(). */
  update(dt: number, input: StageFrameInput): void;
  render(): void;
  resize(width: number, height: number, dpr: number): void;
  /** Radians, OrbitControls feel: pass (dx * k, dy * k) of a pointer drag and the scene turns with the finger (drag right = scene turns right, drag down = look more from above). Pitch is clamped (never under the table). */
  orbit(dYaw: number, dPitch: number): void;
  /** Positive = camera away. Wheel deltaY pixels (|delta| > 4, x0.0016) or notches (|delta| <= 4, x0.12); for a pinch pass the pixel-like spread change (spread shrinking = positive). Clamped to 0.55x..1.9x of the framing distance. */
  zoom(delta: number): void;
  /** Camera shake impulse 0..1 (scaled by setShakeScale; 0 disables). */
  shake(amount: number): void;
  setShakeScale(scale: number): void;
  /** 'auto' (default) starts at med and drops a tier if the 1 s average frame time exceeds ~24 ms. */
  setQuality(q: QualityTier | 'auto'): void;
  /** Tabletop visuals vs floating visuals (shadow softness/size, light pool). */
  setFloatMode(on: boolean): void;
  spawnFx(kind: FxKind, at: V3, intensity: number): void;
  dispose(): void;
  stats(): { drawCalls: number; triangles: number; tier: QualityTier; frameMsEma: number };
}

/* ───────────────────────────── shell (src/main.ts, input, ui) ───────────────────────────── */

export interface Settings {
  volume: number;       // 0..1
  squishBoost: number;  // 0..1
  haptics: boolean;
  shake: number;        // 0..1 screen-shake strength (0 = off). Defaults to 0 when prefers-reduced-motion.
  gravity: boolean;     // true tabletop, false floating
  quality: QualityTier | 'auto';
}

/** `window.__WH__`, exposed only when the URL has ?dev=1. Deterministic stepping makes screenshots and probes reproducible. */
export interface DebugHook {
  readonly version: 1;
  state(): {
    phase: 'boot' | 'title' | 'play' | 'error';
    metrics: SoftMetrics;
    settings: Settings;
    genome: Genome;
    genomeCode: string;
    fps: number;
    stage: ReturnType<StageLike['stats']>;
    audio: ReturnType<SquishAudio['stats']>;
    events: SoftEvent[];   // the last 32 events, oldest first
    stateHash: number;
  };
  /** Stop the rAF-driven sim; the page keeps rendering the last frame. */
  pause(): void;
  resume(): void;
  /** Advance the sim `n` fixed steps of `dt` seconds (default 1/60 x 1) and render once. Works while paused. */
  step(dt?: number, n?: number): void;
  /** Synthetic input through the SAME code path as real pointer events. x,y are 0..1 over the canvas (0,0 = top-left). */
  pointerDown(x: number, y: number, id?: number): void;
  pointerMove(x: number, y: number, id?: number): void;
  pointerUp(id?: number): void;
  setGenome(seedOrCode: string | number): void;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  /** POST the current canvas to the dev server as _shots/<name>.png. */
  shot(name: string): Promise<{ ok: boolean; path?: string }>;
  /** Play a named audio voice directly (sound lab). */
  playSound(kind: 'poke' | 'squish' | 'release' | 'land' | 'pop' | 'blend'): void;
  /** Optional (SHELL, additive): where the squishy is on screen right now. x,y are 0..1 over the canvas (the same space as pointerDown); rPx is its projected rest radius in CSS px. null before the first frame. */
  bodyScreen?(): { x: number; y: number; rPx: number } | null;
}

declare global {
  interface Window { __WH__?: DebugHook }
}
