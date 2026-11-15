// WOBBLEHOARD — the seams between lanes. Types only (no runtime code), so every lane can import this without cycles.
// Full prose contract: _spec/CONTRACT.md. If a lane needs to change a signature here, it changes THIS file in the
// smallest backwards-compatible way (add optional fields), never renames or removes, and reports the change.
// PLAYGROUND (2026-11-15): the optional members for places, things, LIFE, emotes, voices and the Journal are declared in the
// PLAYGROUND block at the end of this file, by interface merging (SoftEvent, SoftMetrics, SoftBodyLike, AudioSettings, SquishAudio,
// AddBodyOpts, StageLike, Settings, DebugHook), so no member above changed. Spec: _spec/PLAYGROUND_BUILD.md section 7.
import type * as THREE from 'three';
import type { Genome } from './core/genome.ts';

export interface V3 { x: number; y: number; z: number }

/** Rarity tier names, lowest to highest (src/core/rarity.ts is the data source; this literal union keeps contracts import-free). */
export type TierName = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic';

/* ───────────────────────────── physics (src/physics) — pure TypeScript, NO three.js import, deterministic ───────────────────────────── */

/**
 * Discrete things that happened this step. Audio, haptics, FX and screen shake all key off these.
 *
 * PULL INTENSITY (physics round-2 fix round, 2026-10-06). A pull is a grab: it starts with 'grab' and ends with 'snap'. The 'snap'
 * intensity is the PULL LEVEL at the release: the distance the grab's target had been pulled from where the grab started, divided by
 * the body's OWN maximum pull (its material family's maxPull, moved by the genome's stretch, x restRadius: about 1.7 R for jelly gel,
 * 1.1 R firm silicone, 2.9 R sticky stretch at a neutral genome, see src/data/materials.ts; the physics clamps every pull there).
 * So 1.0 means the body reached its own family's maxPull, for every family, and a half pull reads 0.5 whatever the material. (Until this round it was metrics.stretch at the release, the body's
 * geometric extent: a gel pulled to its limit read 0.25, a firm silicone 0.15, a slow-rise foam 0.04, which was under the 0.05 needed
 * for a 'snap' at all.) A 'snap' now fires when the pull level at the release is over 0.05. 'grab' itself carries no pull yet: its
 * intensity is a fixed 0.5. metrics.stretch keeps its own meaning (the body's extent, 1 = ~2.2x its rest extent).
 * MEANING, decided (physics round 3, 2026-10-06, for the shell's node check): the pull level is HOW FAR THE GRAB TARGET WAS PULLED, OVER
 * maxPull, measured from the body's BASE. On the table a grab pins the feet, so the base does not move and nothing is subtracted: a half
 * pull reads 0.50 and a pull to the family's limit 1.00 for EVERY family (measured on each family's first catalog species, template genome,
 * pulled sideways and upward: 0.50 / 1.00 in all 12). With nothing pinned (a floating body) the centre's travel since the grab started is
 * subtracted, so dragging a whole body along is not a stretch. Not "how much the body itself stretched": that is metrics.stretch, which at
 * the limit reads only 0.02 (pop dome) to 0.46 (slime goo), so a meter threshold of 0.35 or a daily "as far as it will go" at 0.95 keyed
 * off it would be unreachable for most families. (Fix round 2 briefly subtracted the centre's travel on the table too; a stretched body's
 * centre moves toward the hand, so that removed the stretch itself: a limit pull read 0.31-0.78, a half pull 0.14-0.41. Withdrawn.)
 * The same pull level is reported LIVE as SoftMetrics.pull while a grab is active. Consumers use the snap intensity and metrics.pull AS IS
 * (0..1, 1 = the family's maxPull): no 1/stretch rescale.
 */
export type SoftEventKind =
  | 'poke'     // a finger touched the surface (intensity = impact speed, 0..1)
  | 'press'    // a poke turned into a held squeeze (after ~0.18 s); intensity = current depth 0..1
  | 'release'  // a finger lifted while the body was squeezed (intensity = max(compression, that finger's press) released, 0..1, fired over
               // 0.08; heldFor = seconds pressed). Since physics fix round 2 a single-finger dent (high press, low compression) releases too
  | 'land'     // body hit the table (intensity = impact speed, 0..1)
  | 'grab'     // a pull started (intensity 0.5, fixed: see PULL INTENSITY above)
  | 'snap'     // a pull was let go (intensity = the pull level released, 0..1: 1 = the family's maxPull; see above)
  | 'bump';    // CUT / B2 (optional): this body hit another body (intensity = relative impact speed 0..1; at = contact point)

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
  strands?: number;         // 0..1 sticky strings while a fingertip pulls off a tacky body (sticky stretch, slime, mochi); the renderer draws thin strands from the tip, audio ticks
  slosh?: number;           // 0..1 how far the liquid / bead core is swinging inside the shell (water fill, bead squeeze); 0 for every other family
  /** Physics fix round 2 (optional; consumers treat undefined as "not reported"). The live PULL LEVEL (see PULL INTENSITY above) of the
   *  deeper active grab: the grab target's distance from where the grab started (minus the body's travel only when nothing pins its feet,
   *  i.e. floating), over the body's own maximum pull; 1 = its family's maxPull, 0.5 = a half pull. 0 when nothing is grabbed. The 'snap'
   *  intensity is this value at the release. */
  pull?: number;
  /** Stage B item B3 (optional): true while a pull past the body's maximum has picked it up off the mat and the hand carries it
   *  (SoftBody: a grab target asked for more than 1.15 x maxPull, by a LONE hand: while two fingers are on the body, a pinch, a press with
   *  a pull, a pull from both sides, it is stretched to its maximum and stays on the mat, and stays so until every finger is up). Letting go
   *  throws it with the hand's velocity and fires a full 'snap' (intensity 1); it then flies, lands ('land') and squashes.
   *  metrics.grounded is false while carried. */
  carried?: boolean;
}

export interface RayHit { point: V3; normal: V3; vertex: number; t: number }

export interface FingerDownArgs {
  point: V3;     // surface hit (from raycast)
  normal: V3;    // outward normal at the hit
  dir: V3;       // unit direction the finger travels (the camera ray direction)
}

/* CUT (_spec/CUT.md, owner request 2026-10-06): slice a squishy into pieces and reconnect them. Every member below is optional. */
/** A cut plane in the body's world space. The 'a' side is where dot(p - point, normal) >= 0. */
export interface CutPlane { point: V3; normal: V3 }
/** Construction options for one piece of a cut squishy (passed as SoftBodyCtor opts.piece). */
export interface PieceOpts {
  /** Volume as a fraction of the whole squishy, 0.125..1; the rest shape is scaled by cbrt(frac). */
  frac: number;
  /** true: an eyeless rounded chunk with a flat cut face toward cutNormal that rounds over by the family's memory (CUT.md 1);
   *  false: the face piece, i.e. the species silhouette scaled to frac. */
  chunk: boolean;
  /** World-space outward normal of the fresh cut face. */
  cutNormal?: V3;
  /** Initial centre of mass (m) and velocity (m/s). SoftBody: the piece is placed with its centre at `at` (never below its own resting
   *  height: it is lifted onto the table), all its particles at `vel` (clamped like nudge); reset() puts it back at (at.x, at.z) on the table.
   *  Its volume is exactly frac x the whole's (detail 3), whatever its mesh (pieces under 0.35 use detail 2); smOmega x 1 / cbrt(frac).
   *  The mat corral (its 0.6 m dead zone and 2.5 m rim) works about (at.x, at.z), the body's home: a whole squishy built at its mat spot
   *  ({ frac: 1, chunk: false, at }, the shell's play mat) stays at its spot instead of being glided into the play body (physics round 3). */
  at?: V3;
  vel?: V3;
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

  /* CUT (optional; _spec/CUT.md section 4). */
  /** Volume fraction of the whole squishy this body holds: 1 for an uncut squishy. */
  readonly frac?: number;
  /** Pure: the volume fraction (of this body) on the plane's 'a' side, or null when the plane misses the body. */
  measureCut?(plane: CutPlane): number | null;
  /** 0..1: morph the goal into a waisted peanut along the plane (eased, volume held; 1 = a thin waist ready to part); null releases.
   *  SoftBody (physics fix round 2): the goal's waist at t = 1 is 0.3 of the cross-section's width over a Gaussian of 0.42 R either side
   *  (CUT.md's 0.15, and a narrower pinch, creased the goal itself); the lobes swell to keep the goal's volume. Measured at the shell's timing
   *  (a 0.25 s pinch, 0.1 s at t = 1) on all 50 species x 2 genomes: waist 0.33 of the body's width on average, no crease past 120 degrees,
   *  volume within 3 % (6 % for the air-bleed families). On the table the waist sits at the bottom of the cross-section (the foot stays down);
   *  the neck band is in the contact fold limit while it forms. Swap in the pieces at t = 1: HELD at t = 1 for a second, 12 of 100 bodies
   *  crease past 120 degrees. */
  setNeck?(plane: CutPlane | null, t: number): void;
  /** Grow or shrink the rest volume smoothly to a new fraction of the whole over `seconds` (reconnect growth, the giver's shrink). */
  setFrac?(frac: number, seconds: number): void;
  /** Soft body-to-body contact (stage B item B2) against `others` this frame: pushes particles apart on both sides and emits 'bump'.
   *  Call once per frame before step(), with every other body on the mat. SoftBody (physics fix round 2): positions pushed apart half each
   *  along the other body's vertex normal, the approaching part of the relative velocity removed (inelastic; per particle and for the two
   *  bodies as wholes, so a stack does not sink), the sliding part damped (friction), a separating part halved (tack). 'bump' fires at the
   *  START of a contact (none with that body in the last 0.2 s) closing faster than 0.35 m/s: intensity = approach speed / 3 m/s, at = the
   *  mean contact point, normal = the mean contact normal (pointing out of the other body), finger = -1. Only SoftBody instances collide. */
  collide?(others: readonly SoftBodyLike[]): void;

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
  /** Optional (PHYS addition): pay the JIT warm-up now (once, at load) so the first touches do not hitch; leaves the body's state bit-identical. */
  warmUp?(): void;
}

export interface SoftBodyCtor {
  new (genome: Genome, opts?: { detail?: number; seed?: number; /** CUT: build one piece of a cut squishy. */ piece?: PieceOpts }): SoftBodyLike;
}

/* ───────────────────────────── audio (src/audio) — procedural WebAudio, zero samples ───────────────────────────── */

export interface AudioSettings {
  master: number;      // 0..1 overall volume
  squishBoost: number; // 0..1: "louder squish" — 0 = baseline, 1 = +9 dB on the squish/release/poke voices (limiter stays on)
  muted: boolean;
  /** Round 3 (optional): music bed volume 0..1, relative to master (it sits under the master gain). 0.45 = the designed level
   *  (about -29 dBFS long-term at master 1), 1 = +6 dB over that, 0 = off (nothing is scheduled). Default 0.45. */
  music?: number;
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
  /** Capsule beats: 'grab' = soft rising squeak while squeezing (progress 0..1), 'crack' = shell tick, 'burst' = pop + short tier cue.
   *  `calm` (round 3, optional, additive; DESIGN 6.6 "Calm effects"): softer, slower-edged beats and a low-passed, 5 dB softer burst pop. */
  capsuleBeat?(p: { beat: 'grab' | 'crack' | 'burst'; progress?: number; tier?: TierName; pitch?: number; calm?: boolean }): void;
  /** The tier motif of the reveal (DESIGN 6.5). `mythicVariant` (0..2) selects the unique 3-note motif of each Mythic. `tierUp` adds the rising ladder. durationS fits the budget in DESIGN 6.1; `calm` shortens and softens. */
  reveal?(p: { tier: TierName; tierUp?: boolean; isNew?: boolean; mythicVariant?: number; durationS?: number; calm?: boolean; pitch?: number }): void;
  /** Merge ceremony T0..T2: hum + squelch + noise-tick density rising for `chargeS`; call burst() at T3 with the result, stop() to abort. */
  mergeStart?(p: { tier: TierName; chargeS?: number; calm?: boolean; pitch?: number }): { burst(p: { tier: TierName; tierUp?: boolean; mythicVariant?: number; durationS?: number }): void; stop(): void };
  /** Duck the master by `db` (negative) for `ms` (the 250 ms Mythic pre-roll duck). */
  duck?(p: { db: number; ms: number }): void;

  /* Round 3 (OPTIONAL members, additive; AUDIO implements them, see _spec/SOUND.md "Round 3"). */
  /** Generative ambient music bed. `on` starts/stops it (2.5 s fade-in, 1.4 s fade-out; never before unlock()); `volume` 0..1 is
   *  the same value as AudioSettings.music. It follows setPaused and mute, ducks itself under the ceremony voices, and makes room
   *  (a fast dip) under every effect voice, the held squish and strand by their own level (see SOUND.md "Room for the effects"). */
  setMusic?(p: { on?: boolean; volume?: number }): void;
  /** Two squishies collided: a soft double thud with a wet slap. intensity 0..1 (relative impact speed). Rate-limited inside: call it per contact event. */
  bump?(p: { intensity: number; pitch?: number; pan?: number }): void;
  /** A squishy pulled past its limit unsticks from the mat and is picked up: a sticky "thwop" unpeel. */
  lift?(p: { pitch?: number; pan?: number }): void;
  /** A squishy was thrown: a short soft whoosh. speed 0..1 (release speed, normalised). */
  toss?(p: { speed: number; pan?: number }): void;
  /** A tacky strand: call EVERY FRAME while it stretches (tension 0..1); the engine keeps one held voice and ends it ~0.15-0.6 s after
   *  the calls stop. `snap: true` = the strand broke (a small wet pop + 1-3 tiny bubbles) and ends the held voice. */
  strand?(p: { tension: number; snap?: boolean; pitch?: number; pan?: number }): void;
  /** CUT (optional): the slice. phase 'start' when the waist begins to form (a wet slice that lasts `neckS` seconds), 'separate'
   *  when the pieces part (a soft pop). frac = the smaller piece's fraction of the whole (smaller sounds higher). */
  cut?(p: { phase: 'start' | 'separate'; frac: number; neckS?: number; family?: string; pan?: number; calm?: boolean; /** the squishy's own pitch ratio (genome size), as for the other voices; default 1 */ pitch?: number }): void;
  /** CUT (optional): two pieces flowed back together (a gloopy "blorp" sized by the merged fraction); all = the Reconnect-all
   *  flourish as the squishy becomes whole again. */
  rejoin?(p: { frac: number; all?: boolean; pan?: number; calm?: boolean; /** the squishy's own pitch ratio (genome size); default 1 */ pitch?: number }): void;
  /** Harness readout for the round-3 parts: music scheduler state and cost, and how many calls the rate limiters swallowed. */
  detailStats?(): {
    music: { on: boolean; playing: boolean; sessions: number; field: number; liveNotes: number; maxLiveNotes: number; notes: number; dropped: number; ticks: number; tickMsMean: number; tickMsMax: number; tickMsRecentP99: number; tickMsRecentMax: number; ducked: boolean; volume: number };
    throttled: Record<string, number>;
  };
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
  /** CUT (optional): a piece without a face (an eyeless chunk of the same jelly). Default false. */
  chunk?: boolean;
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
  /** CUT (optional): a thin warm seam glow along `plane` on body `bodyId` while it necks; t 0..1 (0 or a null plane clears it).
   *  A glow, never a flash: the flash governor applies. */
  setCutSeam?(bodyId: number, plane: CutPlane | null, t: number): void;
  /** CUT (optional): the reconnect bridge, a glowing neck between two bodies; t 0..1 (0 clears). */
  setBridge?(aId: number, bId: number, t: number): void;
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

  /* ── stage B and CUT, render lane (RENDER-3, 2026-10-06; optional and additive; src/render/stage.ts implements every one) ── */
  /** Stage B1: render offsets (`AddBodyOpts.position`) for n (1..5) squishies out on the mat at once, spaced for the current frame (a row
   *  on a wide frame, a chevron with the first body in front on a portrait phone). With 2 or more bodies visible the camera frames them all by itself.
   *  NESTED (render fix round 1): the first n offsets of matLayout(n + 1), relative to its first one, equal matLayout(n)'s, so a mat built one squishy at a time
   *  (a body in shared physics space keeps the spot it was built at) is the same as one laid out at once, and no squishy stands in front of another's face. */
  matLayout?(n: number): V3[];
  /** CSS px at each canvas edge that the shell's HUD covers (default { top: 0, right: 0, bottom: 72, left: 0 }); missing or non-finite
   *  fields keep their value. The meter-full capsule lands clear of them, and of every body, at any aspect. */
  setSafeInsets?(insets: { top?: number; right?: number; bottom?: number; left?: number }): void;
  /** Stage B6: the tack-strand hook for the shell's strand voice. Called every frame a strand stretches (snap false: call
   *  `audio.strand({ tension })`) and once when it snaps (snap true: `audio.strand({ tension: 0, snap: true })`). Also fires for the
   *  CUT parting strand (finger 0). (x, y, z) = where it is, world space. null = no hook. */
  onStrand?: ((bodyId: number, e: { finger: 0 | 1; tension: number; snap: boolean; x: number; y: number; z: number }) => void) | null;
  /** CUT (optional): the two pieces of a cut have just been added (right after the swap at neck t = 1): a strand of the same jelly
   *  stretches between them as they separate and snaps (long for sticky stretch and slime, barely there for gel; shorter in calm),
   *  render-owned from here; `onStrand` reports it with bodyId = aId. Unknown ids are ignored. */
  partPieces?(aId: number, bId: number): void;
}

/* ───────────────────────────── shell (src/main.ts, input, ui) ───────────────────────────── */

export interface Settings {
  volume: number;       // 0..1
  squishBoost: number;  // 0..1
  haptics: boolean;
  shake: number;        // 0..1 screen-shake strength (0 = off). Defaults to 0 when prefers-reduced-motion.
  gravity: boolean;     // true tabletop, false floating
  quality: QualityTier | 'auto';
  /* SHELL-2a (optional, additive; CONTRACT section 8 "planned"). Absent = the player never chose: the shell uses the default
   * (src/core/settings.ts resolveSettings), so an old stored blob keeps working and Calm keeps following prefers-reduced-motion. */
  /** Music bed volume 0..1 (= AudioSettings.music; 0 = off). Default 0.45, the designed level (SOUND.md round 3). */
  music?: number;
  /** Extra squish: a deeper press for the same hold (scales the finger-pressure target toward full depth). Default off (NEXT_STEPS B8). */
  extraSquish?: boolean;
  /** Calm effects (DESIGN 6.6): stage.setCalmEffects + `calm` on the ceremony sounds. Default = prefers-reduced-motion. */
  calm?: boolean;
  /** Skip animations (DESIGN 6.6): ceremonies jump straight to the reveal frame. Default off. */
  skipAnimations?: boolean;
  /** Fast open (DESIGN 6.1): repeat Common and Uncommon capsules play the 0.8 s quick pop. Default off. */
  fastOpen?: boolean;
  /** Single-key shortcuts (G gravity, M mute) on or off (WCAG 2.1.4). Default on. */
  shortcuts?: boolean;
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

/* ═══════════════════════════════════════════════ PLAYGROUND (2026-11-15) ═══════════════════════════════════════════════
 * Places to take squishies to, things in them, a little LIFE in every character, emotes ("squishmoji"), voices, calm pieces and the
 * Journal. Specs: _spec/PLAYGROUND_BUILD.md (architecture; section 7 lists every member below), _spec/PLACES.md, _spec/LIFE.md,
 * _spec/QUESTS.md. EVERY member here is OPTIONAL and ADDITIVE: consumers feature-detect, mocks keep compiling, and the interfaces above
 * are extended by interface merging, so none of their members changed.
 * Contracts carry numbers, strings and typed arrays only. The id tables (places, things, zone kinds, emotes, expressions, syllables,
 * flavours, prop sounds, event kinds, flag bits) are VALUES in src/data/places.ts, src/data/life.ts and src/data/quests.ts, so a new
 * place, thing or icon is a data change, never a contract change. Hot-path members take numbers or caller-owned typed arrays and return
 * numbers or booleans (no object per call), the zero-allocation rule of softbody.ts lines 3-7.
 */

/* ── PLAYGROUND physics (src/physics; PLAYGROUND_BUILD.md 8) ── */

export interface SoftEvent {
  /** PLAYGROUND: true when the player did not cause it: a LIFE hop, a spring-pad bounce, a prop launch, a fall the player did not
   *  throw. Physics sets it on every 'land' and every prop 'bump' UNLESS the body was thrown by the player (a carry released, a toss)
   *  since its last landing. The shell sends auto events to the attention budget, never to feedback.ts and never to collection.feed. */
  auto?: boolean;
  /** PLAYGROUND: this 'bump' was against a prop: the prop's index in the bound PropWorldLike. Absent (or -1) = another body. */
  prop?: number;
}

export interface SoftMetrics {
  /** PLAYGROUND: the body is asleep (frozen, costs about 0.02 ms a frame); every wake cause of PLAYGROUND_BUILD.md 8.6 clears it. */
  asleep?: boolean;
  /** PLAYGROUND: 0..1, the share of the body's bounding sphere under a water zone's surface (0 when no water zone is bound). */
  submerged?: number;
  /** PLAYGROUND: index of the prop whose up-facing face (normal within 35 degrees of world up) supports the body; -1 = none. */
  onProp?: number;
  /** PLAYGROUND: no particle is touching the table or a supporting prop face (a hop, a toss, a bounce, floating). */
  airborne?: boolean;
  /** LOCK.md section 3 (planned for physics round 3; PHYS fills it): locked lobes on this body. Declared here because PLAYGROUND's
   *  touch gate counts a lock as a touch: HELD = fingers > 0 || grabbed || carried || (locked ?? 0) > 0. */
  locked?: number;
}

export interface SoftBodyLike {
  /** PLAYGROUND: 8 eased per-body modifiers written by the shell (on change, at most 10 Hz), eased by physics over 0.3 s:
   *  [0] grip (x tableMu), [1] glue (x tack layer), [2] peel (x peel damping), [3] drag (x the baked air drag; ice needs it low),
   *  [4] density relative to water (water zones only: g_eff = g x (1 - submerged / density); 1 = today's behaviour),
   *  [5] field catch (wind and updraft act ONLY on an airborne or floating body, scaled by this), [6] bounce gain (spring pads),
   *  [7] reserved (0). All 1 except [7] = today's behaviour bit for bit. Never a stiffness or damping change (PLACES.md 1). */
  readonly mods?: Float64Array;
  /** PLAYGROUND: place bounds that replace the home-spot corral for this body (the same brake, glide back and rim bounce, about the
   *  place's area instead of the body's home). shape 0 = disc (a = radius), 1 = rounded rectangle (a, b = half sizes, round = corner
   *  radius); shape -1 clears them (back to the home corral). Called on travel and spawn, not per frame. */
  setBounds?(shape: number, cx: number, cz: number, a: number, b: number, round: number): void;
  /** PLAYGROUND: move the corral's home spot (where a LIFE body last came to rest), so the corral never drags it back to its spawn. */
  setHome?(x: number, z: number): void;
  /** PLAYGROUND: the place's props and zones (null = none, today's table only). The body solves them inside each of its substeps
   *  (a prop contact pass between the fingertip pass and the table pass) and adds its impulses to the world's accumulators. */
  setPropWorld?(w: PropWorldLike | null): void;
  /** PLAYGROUND LIFE driver: a volume-preserving goal squash (y x s, x and z x 1 / sqrt(s)), eased with time constant tauS (>= 0.08 s).
   *  s 0.75..1.12; 1 releases it. Paused and eased out within 0.12 s while the body is HELD (see SoftMetrics.locked); ceremony drivers
   *  are not affected. Refused (no effect) for putty, mochi dough and bead squeeze while their plastic memory has not converged. */
  setSquash?(s: number, tauS: number): void;
  /** PLAYGROUND LIFE driver: a hop: an impulse with the family's glue and peel damping suspended for 10 substeps, so the same impulse
   *  leaves the ground at the same height in every family. Allowed only while supported (by the table or an up-facing prop face); on a
   *  moving prop the horizontal part is relative to the prop's surface velocity. vy is clamped to the slice's hop cap (S1: 0.84 m/s,
   *  apex 3.5 cm). Returns false (and does nothing) when HELD, airborne, inside 0.8 s of its last hop, a ceremony driver is on, or the
   *  family's memory has not converged. Its landing carries SoftEvent.auto. */
  hop?(vx: number, vy: number, vz: number): boolean;
  /** PLAYGROUND (keyboard parity, "Go play with..."): a scripted lift of the whole body along a smooth arc to (x, y, z) over `seconds`,
   *  set down with no velocity. Emits no poke, press, release, grab or snap (it can never pay); its landing is NOT auto (the player asked).
   *  Returns false when HELD, carried, locked, asleep-and-touched or another driver owns the body. */
  carryTo?(x: number, y: number, z: number, seconds: number): boolean;
  /** PLAYGROUND: opt in to sleep (default false, so every existing hash row stays valid). The shell sets it for place and party bodies. */
  sleepEnabled?: boolean;
  /** PLAYGROUND: wake now (a LIFE action is about to drive the body). Waking never moves a particle. */
  wake?(): void;
}

/** PLAYGROUND: one place's props (rigid things built from the mechanism library, PLACES.md 2) and zones (water, wind, updraft, warm,
 *  cold, wet, current, magnet, echo). Built by src/physics/props.ts from a PlaceDef (src/data/places.ts); its packed layouts (stride
 *  per prop and per zone) are physics VALUES documented in that file's header. Bodies see a moving prop at pose(t0) + v x (k x H) in
 *  substep k (as fingertips advance), so a prop never jumps; the world integrates the accumulated impulses ONCE per frame after every
 *  body stepped (a one-frame lag, stable for the damped 1-DOF joints and the one clamped free ball the library allows). */
export interface PropWorldLike {
  /** Props in this world. */
  readonly count: number;
  /** 8 floats per prop, rewritten by endFrame(): x, y, z, qx, qy, qz, qw, state (hinge angle in radians, slider offset in m, or ball
   *  speed in m/s). The stage binds this array once (StageLike.bindProps) and reads it in update(); LIFE reads it through the shell. */
  readonly poses: Float32Array;
  /** Zones in this world, and one on/off byte per zone (a switch thing toggles its zone: the tap, the magnet, the echo stone). */
  readonly zoneCount: number;
  readonly zoneOn: Uint8Array;
  /** Clear the impulse accumulators; call once per frame BEFORE the bodies step. */
  beginFrame(): void;
  /** Integrate hinge, slider and free props from this frame's impulses (body impulses are scaled by bodyMass / particle mass, so a
   *  detail-2 twin and a detail-3 body tip a seesaw alike and a 1/8 piece tips it an eighth as much); clamp speeds (ball and swing
   *  seat at most 2.0 m/s); call once per frame AFTER every body stepped. */
  endFrame(dt: number): void;
  setZoneOn(zone: number, on: boolean): void;
  /** Turn a prop's motor on or off (the wound cog, the tap's swirl ride). */
  setMotor(prop: number, on: boolean): void;
  /** Ray against the props (a tap on a thing). Returns the prop index or -1; writes nothing, allocates nothing. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): number;
  /** A player's tap or flick on a prop: an impulse in m/s at its centre (a ball rolls, a seesaw end dips, a chime swings). */
  poke(prop: number, ix: number, iy: number, iz: number): void;
  /** Struck chimes, bells, crystals and pads since the last call, as triples [prop, intensity 0..1, auto 0 | 1] into `out`; returns the
   *  number of triples written (at most out.length / 3). Drives prop sounds and Use events. */
  drainStrikes(out: Float32Array): number;
  /** For the queued Stamp and Roll tools (FUN.md 1) and the player's own pushes: drive prop `prop` kinematically (a tool shape the player
   *  moves) to this pose and velocity for the coming frame. Only props built with the kinematic flag accept it. */
  setKinematic?(prop: number, x: number, y: number, z: number, vx: number, vy: number, vz: number): void;
  /** A cheap 32-bit hash of the props' state (determinism probes). */
  stateHash(): number;
}

/* ── PLAYGROUND render (src/render; PLAYGROUND_BUILD.md 9) ── */

export interface AddBodyOpts {
  /** PLAYGROUND: draw this body with the low fine mesh (2562 vertices) whatever the tier: chunks of a cut squishy on med and high. */
  lite?: boolean;
}

export interface StageLike {
  /** PLAYGROUND: lazily import a place's look chunk (src/render/places/<id>.ts) and the shared away chunk; resolves true when it is ready,
   *  false on a load failure (the player stays where they were). 'home' is built in and resolves at once. */
  loadPlace?(id: string): Promise<boolean>;
  /** PLAYGROUND: show a loaded place (null or 'home' = Home) under a fadeS ScreenFx crossfade (a snapshot fade, never a flash). Swaps sky,
   *  ground, backdrop, weather, lights (and the jelly light uniforms and white balance), environment panels (the old cube is disposed)
   *  and the prop kit. Returns false when the place is not loaded. */
  setPlace?(id: string | null, fadeS: number): boolean;
  /** PLAYGROUND: bind the PropWorldLike poses array (8 floats per prop, place order) once per travel; the stage reads it in update(). */
  bindProps?(poses: Float32Array | null, count: number): void;
  /** PLAYGROUND: frame the camera on the whole play bounds of the place (or of Home's mat). Autonomy never moves the camera: framing
   *  uses these bounds, never live LIFE positions; the player still orbits and zooms. */
  setPlayBounds?(cx: number, cz: number, hx: number, hz: number): void;
  /** PLAYGROUND: prop footprints (x, z, r triples) the meter-full capsule must land clear of. */
  setObstacles?(xzr: Float32Array | null, n: number): void;
  /** PLAYGROUND: where a body's eyes look (world point) with weight 0..1; weight 0 hands them back to the pointer and the idle wander. The
   *  pointer always wins on a body the player is touching. */
  setBodyGaze?(id: number, x: number, y: number, z: number, weight: number): void;
  /** PLAYGROUND: an eyes-only expression eased in over ~0.2 s; expr ids in src/data/life.ts EXPR (0 none, 1 happy, 2 sleepy, 3 surprised,
   *  4 shy, 5 proud), amount 0..1. No mouth, no blush (REFERENCES.md 3). */
  setBodyExpression?(id: number, expr: number, amount: number): void;
  /** PLAYGROUND: render-side pose, the motion that does not move the body (so a sleeping body can lean, sway and sing at about zero physics
   *  cost): a lean of (leanX, leanZ) in rest radii (length at most 0.1), a side-to-side sway of swayAmp rest radii (at most 0.05; a shiver
   *  is 7 Hz at most 0.015) at swayHz (at most 4, or 7 for a shiver) starting at phase swayPhase (radians, so a sway can sit on the music
   *  beat), and a slow breathing scale while asleep. Applied in the jelly vertex stage AND to the eye anchors on the CPU. All 0 = off. */
  setBodyPose?(id: number, leanX: number, leanZ: number, swayAmp: number, swayHz: number, swayPhase: number): void;
  /** PLAYGROUND: place looks on one body, each 0..1, eased by the stage: frost, wet, sand, toast, snow. All 0 = today's look exactly. */
  setBodyLook?(id: number, frost: number, wet: number, sand: number, toast: number, snow: number): void;
  /** PLAYGROUND: the place's heat point (the hearth, the chimney): toast browns the side of a body facing it. NaN x clears it. */
  setHeatPoint?(x: number, y: number, z: number): void;
  /** PLAYGROUND: the water surface height over this body (the under-the-waterline tint); NaN = not in water. */
  setBodyWater?(id: number, surfaceY: number): void;
  /** PLAYGROUND: the body sleeps: skip its fine-mesh evaluation (its eyes still blink and its pose still sways). */
  setBodyAsleep?(id: number, asleep: boolean): void;
  /** PLAYGROUND: how many emote bubble slots the stage pools (8). */
  readonly emoteSlots?: number;
  /** PLAYGROUND: show a squishmoji bubble in `slot` (0..emoteSlots-1) over body `bodyId`: icon id (src/data/life.ts EMOTE), style 0 say,
   *  1 think (a wish: stays until cleared), 2 group (pieces: double outline and `dots` 1..3), lifeS (say and group), flags bit 0 = a small
   *  sparkle badge (close friends, best friends). One instanced draw for every bubble; never a flash; Calm and reduced motion fade only.
   *  The ATTENTION BUDGET (LIFE.md 10) decides what reaches this call; the stage only draws. */
  emote?(slot: number, bodyId: number, icon: number, style: number, lifeS: number, dots: number, flags: number): void;
  clearEmote?(slot: number): void;
  /** PLAYGROUND: a bubble's centre and radius in CSS px over the canvas into out[0..2] (for its 44 x 44 hit area and its word label,
   *  both DOM); false when the slot is empty or off screen. Zero allocation. */
  emoteScreen?(slot: number, out: Float32Array): boolean;
  /** PLAYGROUND: bubbles appear in Snap photos (default true; the Snap bar's "Bubbles in photo" switch). */
  setEmotesInPhoto?(on: boolean): void;
  /** PLAYGROUND: stamp a ground mark (kind id in src/data/places.ts MARK: print, trail, dust, dent, glow) at (x, z) with angle, size
   *  (m) and life (s) into the place's ring buffer (64 / 48 / 24 by tier). */
  stampMark?(kind: number, x: number, z: number, angle: number, size: number, lifeS: number): void;
  /** PLAYGROUND: a body's centre on screen in CSS px and its projected rest radius into out[0..2]; false when off screen or unknown.
   *  Zero allocation (DebugHook.bodyScreen is the dev-only 0..1 version). */
  bodyScreenPoint?(id: number, out: Float32Array): boolean;
}

/* ── PLAYGROUND audio (src/audio; PLAYGROUND_BUILD.md 10) ── */

export interface AudioSettings {
  /** PLAYGROUND: the "Voices" slider 0..1 (creature voices only; 0 mutes them). Default 0.6. */
  chatter?: number;
  /** PLAYGROUND: the "Place sounds" slider 0..1 (each place's ambience bed). Default 0.5. */
  ambience?: number;
}

export interface SquishAudio {
  /** PLAYGROUND: one creature phrase (no words, no samples). `phrase` holds up to 4 syllables, 4 floats each: [syllable id (src/data/life.ts
   *  SYL), pentatonic degree offset (-4..4), start offset s from the phrase start, length scale 0.5..2]; n = syllables used.
   *  flavour 0..5 = gel, sticky, foam, beads, dough, firm (audio/cut.ts FAMILY_FLAVOUR); register 0 whole, 1 piece (one octave up, 7 dB
   *  quieter); pitch = pitchRatio(genome) (snapped to D major pentatonic inside audio); pan -1..1; level 0..1 (distance from the frame
   *  centre); group 1..3 = one group voice of that many detuned oscillators (pieces, never N voices); echo = one scheduled repeat
   *  (+220 ms, -12 dB, no DelayNode); at = AudioContext time to start (0 = now; the shell passes a bar line from musicClock for harmony).
   *  Never asks the music to make room (not in ROOM_KINDS), priority -1 (stolen before any player sound), its own rng stream, silent
   *  during ceremonies and for 1 s after. Returns false when the backstop ChatterLimiter refuses it. */
  creature?(p: { phrase: Float32Array; n: number; flavour: number; register: number; pitch: number; pan: number; level: number; group?: number; echo?: boolean; at?: number }): boolean;
  /** PLAYGROUND: the music as it SOUNDS now into out: [field index sounding (0 home, 1 lift, 2 dusk, 3 glow), bar start (AudioContext
   *  time), bpm, AudioContext now, eighth-slot length s]. false before unlock or with the music off. */
  musicClock?(out: Float64Array): boolean;
  /** PLAYGROUND: lazily import a place's ambience recipe (src/audio/places/<id>.ts); true when ready. */
  loadAmbience?(place: string): Promise<boolean>;
  /** PLAYGROUND: the place's ambience bed (null = none): crossfades about 2 s on a change; follows mute, pause and setPaused. Never asks
   *  for room; takes its own shallow dip under player effects. */
  setAmbience?(p: { place?: string | null; on?: boolean; volume?: number }): void;
  /** PLAYGROUND: a thing's sound: kind id (src/data/places.ts PROP_SOUND: ball, creak, chime, splash, crunch, crackle, boing, bell, tick,
   *  kettle, rustle, whoosh), intensity 0..1, a D major pentatonic MIDI note for tuned things, pan, auto = moved by itself or by a squishy
   *  (never makes room in the music; budgeted), key = prop index for held voices (a creaking rocker), held = 0..1 for a held voice. */
  prop?(p: { kind: number; intensity: number; note?: number; pan?: number; auto: boolean; key?: number; held?: number }): void;
  /** PLAYGROUND: the Music Box and the Singing Kettle tune: while it plays the music bed mutes its own mallets so two melodies never clash. */
  musicBox?(p: { on: boolean; tune?: number }): void;
  /** PLAYGROUND: a place's music style (field weights and mallet timbre only; the key stays D and the tempo 66 BPM, so ceremonies and the
   *  whole-again run stay in tune). 'home' (the default) is bit-identical to today. */
  setMusicStyle?(style: string): void;
}

/* ── PLAYGROUND shell and the dev hook (src/shell, src/ui; PLAYGROUND_BUILD.md 11) ──
 * The five PLAYGROUND settings (chatter, ambience, autonomy, bubbleWords, bubblesInPhoto) are NOT declared here yet on purpose:
 * src/core/settings.ts resolveSettings() returns Required<Settings>, so a Settings key and its default must land in ONE change. The SHELL
 * lane adds them to `Settings` in this file together with SETTING_KEYS, OPTIONAL_UNITS / OPTIONAL_BOOLS, optionalDefaults and
 * resolveSettings (exact text: PLAYGROUND_BUILD.md 11.9). */

export interface DebugHook {
  /** PLAYGROUND (dev only): brain states, needs, behaviour ids, the attention counters and the awake units, as plain JSON. */
  life?(): unknown;
  /** PLAYGROUND (dev only): the journal state, open quests with their counters, the event ring's last 64 records, as plain JSON. */
  quests?(): unknown;
  /** PLAYGROUND (dev only): travel to a place id at once (the same path as the Travel sheet, without the sheet); true on arrival. */
  travel?(place: string): Promise<boolean>;
}

/* ── PLAYGROUND LIFE seam (src/life is pure: no DOM, no three, no physics, no clock, no Math.random; LIFE.md 12) ──
 * The shell host fills a LifeSnapshot IN PLACE at each think tick (10 Hz on sim time, staggered by character slot), calls lifeStep (a
 * src/life value), applies the LifeIntents, sends the expressions through the attention budget and the LifeEvents into the play-event
 * ring. Every array is allocated once by the host at capacity (16 characters, 64 intents, 32 events, 32 things, 32 bumps) and only its
 * first n entries are meaningful. Flag bits, intent kinds and event kinds are values in src/data/life.ts (LIFE_FLAG, INTENT, LIFE_EV). */
export interface LifeSnapshot {
  /** Characters this tick (wholes, face pieces and chunks), at most 16. */
  n: number;
  /** Sim seconds (the shell's simTime: never a wall clock). */
  t: number;
  /** Place index (src/data/places.ts PLACE_IDS order), quality tier (0 low, 1 med, 2 high). */
  place: number;
  tier: number;
  /** One boolean computed by the shell: coarse pointer OR the short viewport side under 600 CSS px. */
  phone: boolean;
  calm: boolean;
  reducedMotion: boolean;
  /** The "Squishies move on their own" setting. */
  autonomy: boolean;
  /** No new LIFE motion: a ceremony, a cut neck or join, any non-Hand tool in hand, the Travel or Journal sheet open, the desktop Hoard
   *  holding input, a hidden tab. Gaze, expressions and needs keep working. */
  quiet: boolean;
  /** Deterministic awake-cost units right now (LIFE.md 10.3: an awake whole 1.0, a sleeper 0.03, an awake piece 0.35, an awake pair in
   *  contact +0.3). LIFE's motion gate reads this, never a measured frame time. */
  units: number;
  /** Music as it sounds (SquishAudio.musicClock): field index, on, the Music Box or kettle tune playing, beat phase 0..1. */
  musicField: number;
  musicOn: boolean;
  musicBoxOn: boolean;
  beatPhase: number;
  /** Per character: 0 whole, 1 face piece, 2 chunk; the slot of its owning whole (itself for a whole); catalog idx; family idx
   *  (MATERIAL_FAMILY_IDS order); volume fraction; rest radius (m). */
  kind: Uint8Array;
  group: Int8Array;
  species: Uint8Array;
  family: Uint8Array;
  frac: Float32Array;
  r: Float32Array;
  /** Centre (m, place space) and horizontal velocity (m/s). */
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vz: Float32Array;
  /** Screen position 0..1 over the canvas; NaN when off screen. */
  sx: Float32Array;
  sy: Float32Array;
  /** LIFE_FLAG bits (TOUCHED, CARRIED, LOCKED, ASLEEP, GROUNDED, ON_PROP, IN_WATER, AIRBORNE, TOSSED, NEW, VISIBLE, MEMORY_BUSY). */
  flags: Uint16Array;
  /** Zone kinds at the centre as bits (ZONE kind ids), submerged share 0..1, warmth glow dots 0..5 of the instance. */
  zoneMask: Uint16Array;
  submerged: Float32Array;
  warmth: Uint8Array;
  /** Live things: count, centre x and z, a state number (hinge angle, slider offset, ball speed) and a busy byte (someone uses it). */
  nThings: number;
  thingX: Float32Array;
  thingZ: Float32Array;
  thingState: Float32Array;
  thingBusy: Uint8Array;
  /** Body-to-body contacts that STARTED since the last tick (character slots), and how many. */
  nBumps: number;
  bumpA: Int8Array;
  bumpB: Int8Array;
  /** The player's touch kind on each character since the last tick (src/data/life.ts TOUCH ids; -1 none). */
  touchKind: Int8Array;
}

/** What LIFE asks for (filled by lifeStep, applied by the shell host through its one arbiter: finger > cut and ceremony > LIFE). */
export interface LifeIntents {
  n: number;
  /** INTENT ids: GAZE, SCOOT (moveTo), HOP, SQUASH, POSE (render lean and sway), GLIDE (a nudge on a slick patch), SETTLE, EXPRESS,
   *  EMOTE, VOICE, CANCEL, USE (ask the shell to perform a player-asked use). No intent kind can press, grab or lock: autonomy never pays. */
  kind: Uint8Array;
  /** Character slot, start delay (s, the host queues at most 4 per character). */
  who: Uint8Array;
  delayS: Float32Array;
  /** Arguments by kind (target x, y, z, speed or amount, frequency, phase ...). */
  a: Float32Array;
  b: Float32Array;
  c: Float32Array;
  d: Float32Array;
  /** EMOTE: icon (EMOTE id), style (0 say, 1 think, 2 group), priority score (LIFE.md 10.2), group key (one bubble per piece group),
   *  dots (piece count 1..3). VOICE uses icon as the phrase id. */
  icon: Uint8Array;
  style: Uint8Array;
  prio: Float32Array;
  groupKey: Int16Array;
  dots: Uint8Array;
}

/** What happened in LIFE this tick, for the play-event ring (Social, Use, React, Wish, Discover, Pieces). LIFE_EV ids in src/data/life.ts;
 *  a and b are character slots (the host maps them to species and items), thing a thing index or -1, sub the kind's sub id, n2 the
 *  participants (pieces count). Capacity 32. */
export interface LifeEvents {
  n: number;
  kind: Uint8Array;
  sub: Uint8Array;
  a: Uint8Array;
  b: Uint8Array;
  n2: Uint8Array;
  thing: Int8Array;
}

/* ── PLAYGROUND play-event ring (the shell's typed events for the Journal; QUESTS.md 4) ──
 * A preallocated ring the shell fills from its producers (mat and party, physics events, LIFE events, travel, cut, Snap, the Journal UI)
 * and the quest host drains once a frame into the pure reducer (src/core/quests.ts). Never filled through emit() (it allocates). EV ids,
 * sub ids and flag bits are values in src/data/quests.ts. Capacity 64; overflow is counted in `dropped`, never wraps over unread events. */
export interface PlayEventRing {
  n: number;
  dropped: number;
  /** EV id (VISIT, BRING, TOUCH, USE, REACT, SOCIAL, FRIEND, WISH, DISCOVER, PIECES, CUT, WHOLE, PHOTO, CAPSULE, GIFT, UI, SIGNATURE). */
  kind: Uint8Array;
  /** The kind's sub id: a REACT, SOCIAL, USE verb, WISH state, TOUCH or UI id. */
  sub: Uint8Array;
  /** Place index; global thing index or -1; species idx of the actor and of the partner (255 = none); the actor's family idx (255 none). */
  place: Uint8Array;
  thing: Int16Array;
  a: Uint8Array;
  b: Uint8Array;
  fam: Uint8Array;
  /** Participants (pieces count), 0 when it does not apply. */
  n2: Uint8Array;
  /** 0 = by itself (LIFE or physics), 1 = by the player (a touch, a flick, a switch, a ride the player set up, a scripted "Go play with..."). */
  by: Uint8Array;
  /** Bit 0 a piece took part, bit 1 a best-friend pair, bit 2 a species new to the player. */
  flag: Uint8Array;
  /** A value the rule may need (a hold in s, a pull level, a glide in m). */
  v: Float32Array;
}

declare global {
  interface Window { __WH__?: DebugHook }
}
