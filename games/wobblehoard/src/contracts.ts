// WOBBLEHOARD — the seams between lanes. Types only (no runtime code), so every lane can import this without cycles.
// Full prose contract: _spec/CONTRACT.md. If a lane needs to change a signature here, it changes THIS file in the
// smallest backwards-compatible way (add optional fields), never renames or removes, and reports the change.
import type * as THREE from 'three';
import type { Genome } from './core/genome.ts';

export interface V3 { x: number; y: number; z: number }

/** Rarity tier names, lowest to highest (src/core/rarity.ts is the data source; this literal union keeps contracts import-free). */
export type TierName = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

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
  /** Round 2 (PHYS fills these in; consumers must treat undefined as 0). */
  press?: number;           // 0..1 deepest current finger indentation (fraction of restRadius * max safe depth). Unlike `compression` this is non-zero for a single-finger dent, so audio/haptics/FX should drive from max(compression, press)
  reaction?: number;        // 0..1 normalised summed finger-projection correction: how hard the body pushes back (a firmness signal for audio and haptics)
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

  /**
   * Ceremony drivers (round 2, OPTIONAL: PHYS implements them; the renderer feature-detects and falls back to a procedural
   * puppet when absent). Used by the merge ceremony (DESIGN.md section 6.4) and the capsule reveal.
   */
  /** 0..1: morph the shape-matching goal toward an equal-volume sphere ("fold into a glowing ball"); 0 = own rest shape. Eased, never snaps. */
  setFold?(t: number): void;
  /** Kinematic spring of the centre of mass toward a world point (slide to the merge pad); null releases it. stiffness ~1 = default. */
  moveTo?(p: V3 | null, stiffness?: number): void;
  /** 0..1: high-frequency goal jitter (the charge-up tremble). 0 = off. */
  tremble?(amp: number): void;
  /** Spring open: radial impulse + goal overshoot (~1.25x) that settles by itself (the T3 burst). strength 0..1. */
  burstOpen?(strength: number): void;

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
   * since the last call. `live` / `liveNodes` / `dropped` / `liveKinds` (live voice groups by kind, fading ones excluded) are optional extras (voice groups and audio nodes currently
   * alive, voices refused because the context was not running or the call was invalid).
   */
  stats(): { started: Record<string, number>; state: string; sampleRate: number; peak: number; live?: number; liveNodes?: number; dropped?: number; liveKinds?: Record<string, number> };
  /** Optional: tab hidden / visible. `true` suspends the context and frees every live voice; `false` resumes it. */
  setPaused?(paused: boolean): void;
  /** Optional: stop the housekeeping timer and close the context. The instance is unusable afterwards. */
  dispose?(): void;

  /* Round 2 (OPTIONAL members so existing mocks keep compiling; AUDIO implements them, see DESIGN.md sections 6.2-6.5). */
  /** Meter full: two-note rising "plink-plonk" (~180 ms), quieter when `quiet` (player mid-squeeze). */
  meterFull?(p?: { quiet?: boolean; pitch?: number }): void;
  /** Capsule beats: 'grab' = soft rising squeak while squeezing (progress 0..1), 'crack' = shell tick, 'burst' = pop + short tier cue. */
  capsuleBeat?(p: { beat: 'grab' | 'crack' | 'burst'; progress?: number; tier?: TierName; pitch?: number }): void;
  /** The tier motif of the reveal (DESIGN 6.5). `mythicVariant` (0..2) selects the unique 3-note motif of each Mythic. `tierUp` adds the rising ladder. durationS fits the budget in DESIGN 6.1; `calm` shortens and softens. */
  reveal?(p: { tier: TierName; tierUp?: boolean; isNew?: boolean; mythicVariant?: number; durationS?: number; calm?: boolean; pitch?: number }): void;
  /** Merge ceremony T0..T2: hum + squelch + noise-tick density rising for `chargeS`; call burst() at T3 with the result, stop() to abort. */
  mergeStart?(p: { tier: TierName; chargeS?: number; calm?: boolean; pitch?: number }): { burst(p: { tier: TierName; tierUp?: boolean; mythicVariant?: number; durationS?: number }): void; stop(): void };
  /** Duck the master by `db` (negative) for `ms` (the 250 ms Mythic pre-roll duck). */
  duck?(p: { db: number; ms: number }): void;
}

/* ───────────────────────────── render (src/render) ───────────────────────────── */

export type QualityTier = 'low' | 'med' | 'high';
export type FxKind = 'bubbles' | 'glitter' | 'dust' | 'ring';

export interface StageFrameInput {
  time: number;                              // seconds since boot (monotonic)
  pointerNdc: { x: number; y: number } | null; // eyes follow the pointer when present. Standard NDC: x -1..1 left to right, y -1..1 BOTTOM to TOP
}

/* ── round 2: multi-body stage, rarity look, capsule reveal and merge ceremony (implemented by src/render/stage.ts) ── */

export interface AddBodyOpts {
  /** Rarity tier styling (DESIGN 5.3). Default 'common'. */
  tier?: TierName;
  /** Render-space offset of the body (the simulated body itself keeps its own origin; the stage draws it here). */
  position?: V3;
}

/** Beats the ceremonies report, in time order, so the shell can fire audio / haptics in sync. `t` = seconds since the ceremony started. */
/** 'preroll' is capsule-only and fires for Rare and up at 0.65 s (the start of the tier pre-roll, 0.3 / 0.5 / 0.8 / 1.0 s before 'burst'): the audio reveal swell starts there (_spec/SOUND.md). */
export type CeremonyBeat = 'grab' | 'crack' | 'burst' | 'reveal' | 'press' | 'fold' | 'charge' | 'settle' | 'preroll';
export interface CeremonyHooks {
  onBeat?(beat: CeremonyBeat, info: { t: number; tier: TierName }): void;
}
export interface CeremonyHandle {
  /** Resolves when the ceremony ended (or its skip crossfade finished). Never rejects. */
  readonly done: Promise<void>;
  /** Jump to the final reveal frame with a 120 ms crossfade. The result is never hidden. Fires 'reveal' + 'settle' if not yet fired. */
  skip(): void;
  readonly active: boolean;
  /** Planned duration in seconds (DESIGN 6.1 budget, x0.65 in calm mode, +0.4 s for a tier-up merge). */
  readonly duration: number;
  /** The result squishy's body, stage-created through spec.createBody. After `done` it is the primary body: the shell adopts it as its play body (steps it, raycasts it). */
  readonly resultBody: SoftBodyLike | null;
  readonly resultBodyId: number | null;
}
export interface CapsuleHandle {
  readonly id: number;
  /** true once it has touched down (the wobble may still be settling). */
  readonly landed: boolean;
  /** Centre of the capsule in CSS pixels over the canvas, and its on-screen radius; null while it is falling, gone or opening. */
  screenPoint(): { x: number; y: number; r: number } | null;
  /** Is the CSS-pixel point on the capsule (radius + slop)? Use it for the tap / hold test. */
  hitTest(x: number, y: number, slopPx?: number): boolean;
  /** Squeeze progress 0..1: it squashes, rattles and shows stress lines. Reaching 1 (or a tap) is the cue for playCapsuleReveal. */
  setSqueeze(progress: number): void;
  wobble(strength?: number): void;
  remove(): void;
}
export interface CapsuleRevealSpec {
  /** The pulled squishy (decided by the server before the animation starts). */
  result: { genome: Genome; tier: TierName; isNew?: boolean };
  /** Builds the body that drops out (the stage steps and renders it). */
  createBody(genome: Genome): SoftBodyLike;
  /** The capsule from dropCapsule(); omitted = the current one, or a new one standing at the centre. */
  capsule?: CapsuleHandle;
  /** Repeat Common / Uncommon "quick pop" (DESIGN 6.1: 0.8 s). */
  quick?: boolean;
  /** Keep the player's current squishy on the table (default: it slides off and is removed). */
  keepCurrent?: boolean;
}
export interface MergeCeremonySpec {
  /** MERGE_COST parents (2 or 3), each with its own genome and (for the styling) tier. */
  parents: { genome: Genome; tier?: TierName }[];
  result: { genome: Genome; tier: TierName; tierUp?: boolean; isNew?: boolean };
  createBody(genome: Genome): SoftBodyLike;
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

  /* ── round 2 (all optional in the type so mocks keep compiling; src/render/stage.ts implements every one) ── */
  /** Add another body (own jelly view, core, face, FX, light pool; shared environment and shader programs). Returns its id. setBody = clearBodies + addBody. */
  addBody?(body: SoftBodyLike, genome: Genome, opts?: AddBodyOpts): number;
  removeBody?(id: number): void;
  clearBodies?(): void;
  /** Id of the body setBody / the last ceremony made primary (the one the camera follows), or null. */
  primaryBodyId?(): number | null;
  /** Restyle a body for another rarity tier. */
  setBodyTier?(id: number, tier: TierName): void;
  /** Calm effects (DESIGN 6.6): no camera moves, no slow-motion, particles x0.3, rings become fades, durations x0.65, no pulses, no screen flash. */
  setCalmEffects?(on: boolean): void;
  /** The meter-full cue: a neutral translucent capsule drops from above next to the squishy, lands with a wobble and stays tappable. */
  dropCapsule?(opts?: { onLand?: () => void; at?: V3 }): CapsuleHandle;
  playCapsuleReveal?(spec: CapsuleRevealSpec, hooks?: CeremonyHooks): CeremonyHandle;
  playMergeCeremony?(spec: MergeCeremonySpec, hooks?: CeremonyHooks): CeremonyHandle;
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
