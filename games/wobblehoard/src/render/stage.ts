/// <reference types="vite/client" />
// WOBBLEHOARD stage: owns the WebGLRenderer, the camera rig, the set, and a LIST of body views (multi-body: the play squishy, or
// two parents plus the result during a ceremony), the capsule, the shared particle system, and the ceremony director.
// `createStage(canvas)` implements StageLike (src/contracts.ts). In a DEV build (Vite dev server: the harness, ?dev=1) the same object also
// carries a few dev-only members (renderer access, memory counters, context-loss helpers, the `info` readout, the ceremony internals);
// they sit behind `import.meta.env.DEV`, so `vite build` drops them. `createStageDev` (src/render/stageDev.ts, imported by the harnesses only) is the typed accessor.
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
//
// Stage B and CUT (_spec/CUT.md), how the shell drives them (all optional StageLike members, every one implemented here):
//   * matLayout(n) -> offsets for addBody(..., { position }); with 2+ bodies visible the camera frames them all (pieces of a cut too).
//     setBody() on a stage that shows bodies (a swap: the Hoard preview, a quick switch) eases from the current framing instead of
//     snapping to one body, so re-adding the mat bodies right after keeps the group framing without a jump; after clearBodies it snaps.
//   * The meter-full capsule stands clear of setSafeInsets' HUD rows and of every body's screen box; where no full-size spot is clean (a
//     tall phone with ~200 px of HUD rows) it stands smaller (down to 0.46x) beside the body, and grows back to full when a reveal takes it.
//   * setSafeInsets({ bottom, ... }): the HUD's CSS px; onStrand(bodyId, e): the strand voice (tack strands and the cut's parting strand).
//   * A cut: every frame of the neck, body.setNeck(plane, t) (PHYS) and stage.setCutSeam(bodyId, plane, t) (the warm seam glow, plane in
//     the body's world space). At t = 1: removeBody(id), addBody(piece, genome, { tier, chunk }) for each piece (chunk: no face, same
//     jelly), then partPieces(aId, bId): the parting strand, render-owned, and the seam carried over onto both cut faces, fading.
//   * A reconnect: setBridge(receiverId, giverId, t) every frame (t 0..1, eased here), body.setFrac on both (PHYS), then removeBody(giver)
//     (the bridge eases out by itself; setBridge(a, b, 0) also lets it go).
//   * Every CUT light is a glow (eased in and out, capped), halved in calm mode (the seam to ~22%) and held low for 1 s after a granted ceremony flash.
//   * After a WebGL context restore the stale three 'dispose' listeners of every pre-loss object are dropped (no INVALID_OPERATION
//     warnings when those objects are disposed later).
import * as THREE from 'three';
import type {
  AddBodyOpts, CapsuleHandle, CapsuleRevealSpec, CeremonyHandle, CeremonyHooks, FxKind, MergeCeremonySpec, QualityTier, SoftBodyLike,
  StageFrameInput, StageLike, TierName, V3,
} from '../contracts.ts';
import type { Genome } from '../core/genome.ts';
import { clamp } from '../core/rng.ts';
import { BodyView } from './bodyview.ts';
import { Capsule, CAPSULE_HEIGHT } from './capsule.ts';

/** The capsule's radius (capsule.ts R): its footprint for the landing-spot choice. */
const CAP_R = 0.24;
/** The capsule-spot search: sizes tried in turn, sides, depths and side gaps (x body scale), in-front spots ([x share, z x gap]). */
const SPOT_SIZES = [1, 0.8, 0.66, 0.55, 0.46];
/**
 * The most the camera may pull back (x the framing it would use without the capsule) to make room for a waiting capsule BESIDE the squishy
 * on a narrow portrait frame. A frame where that costs more has the capsule stand smaller beside the body instead (never in front of it).
 */
const REFRAME_MAX = 1.2;
/** ... and the most it may pull back for a very wide species (a long bean that fills a narrow frame) before the capsule has to stand in front or behind it. */
const REFRAME_WIDE = 1.32;
/**
 * The play mat's slots, [x, z] in body-scale units, the play body first; stage.matLayout(n) is the first n of them. The list is NESTED on purpose: the shell builds the
 * mat one squishy at a time, and with body-to-body contact (the real soft body) an extra stays in shared space where it was built (bodies.placeExtras moves only the apart
 * ones), so a body's spot is the one matLayout(k + 1) gave it when it came out, never one of a later, bigger layout. (The old per-n layouts were not nested: 4 bodies
 * came out as a 2 x 2 grid whose back row stood straight behind the front row, hiding one squishy behind another: VERIFY_RENDER_B B-M1.)
 * A wide frame: a plain ROW, 1.3 apart (a body is ~1 wide; the camera frames the group). Outlines of two bodies never overlap in a row; depth, at the camera's low pitch, only
 * shifts a body up the picture by ~0.27 per unit, far less than its height, so a body BEHIND another is mostly hidden. A tall frame has no width to spare for a row (the
 * bodies would be ~50 px): a chevron instead, the play body in front and the others behind it to either side, each further out, so every face stays clear of the bodies in front.
 */
const MAT_SLOTS_WIDE: readonly (readonly [number, number])[] = [[0, 0], [1.3, 0], [-1.3, 0], [2.6, 0], [-2.6, 0]];
const MAT_SLOTS_TALL: readonly (readonly [number, number])[] = [[0, 0], [0.9, -1.3], [-0.9, -1.3], [1.8, -2.6], [-1.8, -2.6]];
const SIDES = [1, -1];
const SPOT_DEPTHS = [0.15, 0, -0.25, -0.5];
const SPOT_GAPS = [0.14, 0.06, 0.26];
const FRONT: readonly (readonly [number, number])[] = [[0.45, 1], [0.5, 1], [0.45, 2], [0, 2.2], [0, 3.2], [0.3, 3.9], [0.3, 2.6], [0.3, 1.6], [0.5, 4.8], [0.5, 6], [0.5, 7.5]];
import { CeremonyDirector, type CeremonyHost } from './ceremony.ts';
import { CutFx } from './cutfx.ts';
import { createDecalGeometry } from './decals.ts';
import { EnvHub, KEY_DIR, RIM_DIR } from './env.ts';
import { FlashGovernor } from './flash.ts';
import { Particles } from './particles.ts';
import { QualityGovernor, TIERS } from './quality.ts';
import { safeTier } from './rarity.ts';
import { ScreenFx } from './screenfx.ts';
import { Table, PALETTE } from './table.ts';
import type { StrandEvent } from './strands.ts';
import type { Emotes, EmoteFrame } from './emotes.ts';
import type { HomeKit } from './homekit.ts';
import { visibleTableAt } from './homeview.ts';
import type { PlayFrame } from './placeview.ts';
import type { PlaceHost, StageCtx } from './place.ts';

/** The camera's rest pitch (the default the player orbits from): visibleTable reports the table at it (PLAYGROUND_BUILD.md 9). */
const REST_PITCH = 0.27;

type RoundTwo = Required<Pick<StageLike, 'addBody' | 'removeBody' | 'clearBodies' | 'primaryBodyId' | 'setBodyTier' | 'setCalmEffects' | 'dropCapsule' | 'playCapsuleReveal' | 'playMergeCeremony'>>;

/**
 * Stage B and CUT members (StageLike, optional there; every one implemented here): onStrand (B6 strand hook), setSafeInsets (HUD insets
 * for the capsule spot), matLayout (B1 offsets for 1..5 bodies), setCutSeam / partPieces / setBridge (CUT visuals). See src/contracts.ts.
 */
export type StageExtras = Required<Pick<StageLike, 'matLayout' | 'setSafeInsets' | 'setCutSeam' | 'setBridge' | 'partPieces'>> & {
  onStrand: ((bodyId: number, e: StrandEvent) => void) | null;
};

export interface StageDev extends Omit<StageLike, keyof RoundTwo | keyof StageExtras>, RoundTwo, StageExtras {
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
    particlesDropped: number; camScale: number; cut: { strands: number; bridges: number; glow: number };
    /** The standing capsule's table spot and size (null when none): the harness checks where it landed. */
    cap: { x: number; z: number; size: number } | null;
  };
  readonly views: readonly BodyView[];
  readonly flash: FlashGovernor;
  /** PLAYGROUND (dev): the bubble layer, Home's things, the autonomy framing flag. */
  readonly emotes: Emotes | null;
  readonly homeKit: HomeKit | null;
  /** (dev) load the lazy LIFE look now (bubbles, Home's things). */
  loadLifeLook(): Promise<void>;
  readonly autoFraming: boolean;
}

const TARGET_Y = 0.42;
/** The smallest frame the stage will size its drawing buffer for (CSS px per side; a 0 / 1 px canvas makes three's offscreen targets zero sized). */
const MIN_FRAME_PX = 4;
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

/** Empty the 'dispose' listener list of a three object (EventDispatcher keeps them in `_listeners`). */
function dropDispose(o: unknown): void {
  const l = (o as { _listeners?: Record<string, unknown[]> } | null)?._listeners;
  if (l && l.dispose) l.dispose.length = 0;
}
/** Every geometry, material and texture (material slots and shader uniforms) reachable from `root`: see the stage's onRestored. */
function dropStaleDisposeListeners(root: THREE.Object3D): void {
  const tex = (v: unknown): void => { if (v && (v as THREE.Texture).isTexture) dropDispose(v); };
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) dropDispose(m.geometry);
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      dropDispose(mat);
      for (const k of Object.keys(mat)) tex((mat as unknown as Record<string, unknown>)[k]);
      const un = (mat as THREE.ShaderMaterial).uniforms;
      if (un) for (const k of Object.keys(un)) tex(un[k]?.value);
    }
  });
}

/** How far past a body's jelly (x its half extent) its tier's table light reaches: the Mythic dome (R x 1.2 .. 1.5), the Epic+ caustic ring. The waiting capsule stands outside it. */
function fxReach(v: BodyView): number {
  if (v.style.dome > 0) return Math.max(1.2, 1.5 * v.rarity.frameFit) - 1;
  return v.style.ring > 0 ? 0.12 : 0;
}

function buildStage(canvas: HTMLCanvasElement): StageLike & StageExtras {
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
  const cut = new CutFx(hub);          // CUT: parting strands and reconnect bridges (the seam glow is in each body's jelly)
  scene.add(cut.group);

  const governor = new QualityGovernor();
  let tier = governor.tier;
  renderer.transmissionResolutionScale = TIERS[tier].transmissionScale;

  // ---- PLAYGROUND: bubbles, Home's things, the autonomy framing, reduced motion, capsule obstacles ----
  // the bubbles and Home's things live in a LAZY module (lifelook.ts; PLAYGROUND_BUILD 14.3's overflow rule: the render lane's first-load share
  // is capped at 16 KB): loaded on first use, which only ever comes from the LIFE host; what was asked before it landed is replayed
  let emotes: Emotes | null = null;
  let home: HomeKit | null = null;
  let lifeLoad: Promise<void> | null = null;
  const pendEm = new Float64Array(8 * 7), pendOn = new Uint8Array(8);
  const pendThing = new Float64Array(6 * 5);   // set, shown, x, z, yaw
  let pendKeep = -1, pendPhoto = 1, pendBind: [Float32Array | null, number, Int16Array | null] | null = null;
  function needLife(): void {
    if (lifeLoad || disposed) return;
    lifeLoad = import('./lifelook.ts').then((m) => {
      if (disposed) return;
      const em = new m.Emotes(), hk = new m.HomeKit(hub);
      scene.add(em.mesh); scene.add(hk.group);
      emotes = em; home = hk;
      em.setInPhoto(pendPhoto === 1);
      for (let i = 0; i < 8; i++) if (pendOn[i]) { const o = i * 7; em.show(i, pendEm[o], pendEm[o + 1], pendEm[o + 2], pendEm[o + 3], pendEm[o + 4], pendEm[o + 5]); }
      if (pendBind) hk.bind(pendBind[0], pendBind[1], pendBind[2]);
      for (let k = 0; k < 6; k++) { const o = k * 5; if (pendThing[o]) hk.setThing(k, pendThing[o + 1] === 1, pendThing[o + 2], pendThing[o + 3], pendThing[o + 4]); }
      if (pendKeep >= 0) hk.setKeepsakes(pendKeep);
    }).catch(() => { lifeLoad = null; });   // a failed load retries on the next call
  }
  /** setAutonomyFraming: LIFE is on at Home: frame the mat slots in use, follow only the player's motion (D-37, RD-14). */
  let autoFraming = false;
  /** prefers-reduced-motion, read by the stage itself: every new PLAYGROUND motion is a fade with it OR with Calm (each on its own, RD-09). */
  let reducedMotion = false, coarsePointer = false;
  const mqReduce = (() => { try { return typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null; } catch { return null; } })();
  const mqCoarse = (() => { try { return typeof matchMedia === 'function' ? matchMedia('(pointer: coarse)') : null; } catch { return null; } })();
  const onMotionPref = (): void => { reducedMotion = !!mqReduce?.matches; coarsePointer = !!mqCoarse?.matches; };
  onMotionPref();
  try { mqReduce?.addEventListener('change', onMotionPref); mqCoarse?.addEventListener('change', onMotionPref); } catch { /* an old browser: read once */ }
  /** setObstacles: prop footprints (x, z, r) the meter-full capsule lands clear of. */
  const obstacles = new Float32Array(3 * 32);
  let obstacleN = 0;
  const anchorV = new THREE.Vector3(), anchorR = new THREE.Vector3();
  /** setPlayBounds (a place): the bounds of the layout in use and the framing fitted to them for this frame (null = Home's framing). */
  const playB = new Float64Array(4);
  let play: PlayFrame | null = null;
  function refitPlay(): void {
    play = placeHost && Number.isFinite(playB[2]) && playB[2] > 0 ? placeHost.fit(playB[0], playB[1], playB[2], playB[3], cssW, cssH, safe.top, safe.right, safe.bottom, safe.left) : null;
    if (play) { tYaw = 0; tPitch = play.pitch; tZoom = 1; }
  }
  // ---- PLAYGROUND places (the away chunk src/render/place.ts, which swaps, poses and frames a place; one look chunk per place) ----
  let placeHost: PlaceHost | null = null;
  /** bindProps: the PropWorldLike poses and which thing each drives (Home's things and a place's movers read them). */
  let propPoses: Float32Array | null = null, propCount = 0, propThing: Int16Array | null = null;
  /** setHeatPoint: the place's heat point (xyz; w 1 = set), shared by every jelly (toast browns the side facing it). */
  const heat = new THREE.Vector4(0, 0, 0, 0);
  const capPt = { x: 0, y: 0, r: 0 };

  // ---- camera rig ----
  let yaw = 0, pitch = REST_PITCH, zoomF = 1;
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
  /** CSS px of the frame the shell's HUD covers (setSafeInsets); the meter-full capsule never lands under them. */
  const safe = { top: 0, right: 0, bottom: 72, left: 0 };
  const spotBoxes: number[][] = [], spotBox = [0, 0, 0, 0], spotV = new THREE.Vector3();
  let spotReframes = false;
  /** resize() has run: the frame's real size is known (before that the canvas is 1 x 1 CSS px and no capsule spot can be chosen). */
  let sized = false;
  /** A dropCapsule() before the first resize (a capsule already waiting when the game boots): placed on the first update after it. */
  let pendingDrop: (() => void) | null = null;
  /** The waiting capsule was placed by the caller (dropCapsule `at`): never re-placed. */
  let capFixed = false;
  /** Seconds until the waiting capsule's spot is re-checked (the frame, the HUD rows or the bodies changed under it); < 0 = nothing to check. */
  let capRecheck = -1;
  const CAP_RECHECK_S = 0.7;
  /** setBody of a swap: the new primary does not snap the camera framing (it eases from where it is). */
  let keepFraming = false;

  const primary = (): BodyView | null => { for (const v of views) if (v.id === primaryId) return v; return null; };
  const viewById = (id: number): BodyView | null => { for (const v of views) if (v.id === id) return v; return null; };
  const fitDistance = (): number => camScale * Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect));
  /** Half the world width the frame shows at the table centre at the rest framing (a body of scale 1 is 1 wide). */
  const hwPerNow = (): number => Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect)) * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
  /** What framingFor returns (one reused object: no allocation). */
  const frameOut = { want: 1, multi: false, mx: 0, mz: 0 };
  /**
   * The framing (a scale over the rest framing of a unit body) the visible bodies need, and the middle of the group they stand in; with
   * `withCap` also a capsule of size `cs` standing at (cx, cz): it counts as one more body, so with a single squishy on a narrow portrait
   * frame the camera pulls back and aims between the two. (Several bodies: their table extents plus a margin; one body alone: a wide
   * species still fits a narrow frame whole.) Used by the camera every frame and by the capsule's spot search.
   */
  /**
   * PLAYGROUND (D-37, RD-14): where a body counts for the framing. Off (autoFraming false): its live centre, as always. On (LIFE at Home):
   * its mat slot (the k-th whole body out takes matLayout's k-th slot), unless the player is moving it (a finger, a grab, a toss until it
   * is still), so LIFE's own motion never moves the camera; a cut squishy's chunks count only while the player moves them. `rest` = the
   * rest framing whatever the player does (visibleTable). Writes slotXZ; false = leave this body out of the framing.
   */
  const slotXZ = { x: 0, z: 0 };
  function framePoint(v: BodyView, k: number, rest: boolean): boolean {
    const live = !(rest || autoFraming) || (!rest && v.playerMoving);
    if (live) { slotXZ.x = v.proxy.center.x; slotXZ.z = v.proxy.center.z; return true; }
    if (v.chunk) return false;
    const sl = camera.aspect < 0.9 ? MAT_SLOTS_TALL : MAT_SLOTS_WIDE, i = Math.min(k, sl.length - 1);
    slotXZ.x = sl[i][0] * bodyScale; slotXZ.z = sl[i][1] * bodyScale;
    return true;
  }
  function framingFor(withCap: boolean, cx: number, cz: number, cs: number, rest = false): typeof frameOut {
    const pv = primary();
    let want = framing ?? bodyScale * (pv ? pv.growth : 1), n = 0, bcx = 0;   // (a piece that grew since it was built: setFrac)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;          // a mat of bodies: generous reach
    let tx0 = Infinity, tx1 = -Infinity, tz0 = Infinity, tz1 = -Infinity;      // one body and a capsule: its silhouette's reach
    let k = 0;
    for (const v of views) {
      if (!v.visible) continue;
      const kk = k; if (!v.chunk) k++;
      if (!framePoint(v, kk, rest)) continue;
      n++;
      const gk = v.growth, c = slotXZ, r = Math.max(v.proxy.restRadius * 1.25, v.restHalfW * 1.12) * gk, t = (v.restHalfW * 1.06 + 0.05 * v.scale) * gk;
      bcx = c.x;
      if (c.x - r < x0) x0 = c.x - r; if (c.x + r > x1) x1 = c.x + r; if (c.z - r < z0) z0 = c.z - r; if (c.z + r > z1) z1 = c.z + r;
      if (c.x - t < tx0) tx0 = c.x - t; if (c.x + t > tx1) tx1 = c.x + t; if (c.z - t < tz0) tz0 = c.z - t; if (c.z + t > tz1) tz1 = c.z + t;
    }
    if (withCap) {
      const r = CAP_R * cs;
      if (cx - r < x0) x0 = cx - r; if (cx + r > x1) x1 = cx + r; if (cz - r < z0) z0 = cz - r; if (cz + r > z1) z1 = cz + r;
      if (cx - r < tx0) tx0 = cx - r; if (cx + r > tx1) tx1 = cx + r; if (cz - r < tz0) tz0 = cz - r; if (cz + r > tz1) tz1 = cz + r;
    }
    const hwPer = hwPerNow();
    // a piece that grew in a reconnect (setFrac) must fit the frame's height too, a tall one above all: its rest height above the table, against what the
    // frame shows above the aim point (the bodies' own jumps never count: only the rest height, so a toss does not move the camera)
    // (a body in the middle of a cut has its lobes swell up by ~30% while the neck forms: that headroom too, except in calm mode, which moves no camera)
    { let hTop = 0; for (const v of views) {
        if (!v.visible) continue;
        const sk = calm ? 0 : Math.min(1, v.seamAmount / 0.85), grew = v.growth > 1.02;
        if (grew || sk > 0.02) hTop = Math.max(hTop, v.restH * v.growth * (1 + 0.45 * sk) * (grew ? 1.15 : 1));
        // REMOVE-WHEN-PHYSICS-FIXED (the next line is a stopgap, not render logic; delete it once the neck morph no longer stands the lobes up to 2.0 - 2.9x their rest height)
        // STOPGAP (the generator is PHYS, see _handoff/reports/RENDER_R.md "PART C"): while the neck forms the volume the waist gives up goes UP, and for putty / slow-rise /
        // firm silicone the lobes stand 2.0x / 2.2x / 2.9x their rest height and the new pieces are thrown up to 1.3 m for ~0.6 s (measured, real body, real shell). The frame
        // follows the LIVE top of a body that still shows its seam, so those pieces are not cut off by the top of the frame (never more than 2.0x the rest height); a body whose
        // neck stays low (sticky, gel, mochi, marshmallow ...) is not affected: its live top is below the headroom above
        if (sk > 0.02) hTop = Math.max(hTop, Math.min(v.jelly.maxY * 1.05, v.restH * v.growth * 2.0));
      }
      want = Math.max(want, hTop / (TARGET_Y + 0.85 * hwPer / Math.max(0.2, camera.aspect))); }
    // one body: a wide species (a half-moon dumpling, a long bean) must fit a narrow portrait frame whole (its rest reach + a margin)
    const p1 = n === 1 ? primary() : null;
    // (a Mythic body also keeps room for its prism dome, which the rarity pass holds inside the frame's sides: a wide species on a portrait phone had it cut by both, VERIFY_RENDER_B B-m6)
    if (p1) want = Math.max(want, ((p1.restHalfW * (p1.style.dome > 0 ? 1.34 : 1.06) + 0.05 * p1.scale) * p1.growth) / hwPer);
    let multi = false, mx = 0, mz = 0;
    const solo = n === 1 && withCap;
    if (n + (withCap ? 1 : 0) >= 2) {
      const ax0 = solo ? tx0 : x0, ax1 = solo ? tx1 : x1, az0 = solo ? tz0 : z0, az1 = solo ? tz1 : z1;
      // a lone squishy whose capsule already fits the frame at the single-body framing (a wide frame) keeps the camera where it is: no pull-back,
      // no sideways shift (only a narrow portrait frame needs both)
      const fits = solo && Math.max(bcx - ax0, ax1 - bcx) + 0.06 <= want * hwPer;
      multi = !fits;
      // a portrait frame has height to spare: depth (which reads as height on screen) costs little zoom there
      if (!fits) {
        want = Math.max(want, ((ax1 - ax0) / 2 + (solo ? 0.06 : 0.1) + (camera.aspect < 0.9 ? 0.12 : 0.35) * (az1 - az0) / 2) / hwPer);
        mx = (ax0 + ax1) / 2; mz = (az0 + az1) / 2;
      }
    }
    frameOut.want = want; frameOut.multi = multi; frameOut.mx = mx; frameOut.mz = mz;
    return frameOut;
  }

  /**
   * Where the meter-full capsule lands, chosen ON SCREEN: the first spot (in this order) whose capsule stays inside the frame minus the
   * shell's safe insets (setSafeInsets: its HUD rows; by default the bottom 72 CSS px) and clear of every visible body's screen box:
   * beside the bodies on the right, on the left (closest clean offset first, at four depths), behind them to a side, in front of them.
   * If no spot is clean at full size (a tall phone whose HUD rows take the bottom ~200 px, the body filling the width) the same search
   * runs with a smaller capsule (0.8x, 0.66x, 0.55x, 0.46x); only if none of those is clean either does the least bad spot win. During a
   * ceremony the primary may be sliding off (capsule reveal) or hidden (merge): the spots are around the PAD (a unit body there).
   */
  function capsuleSpot(p: BodyView | null): { x: number; z: number; size: number } {
    const sc = p ? p.scale : 1;
    camera.updateMatrixWorld();
    // the bodies' table extents (world) and screen boxes
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, zc = 0;
    spotBoxes.length = 0;
    if (director.active || !p) { x0 = -0.5 * sc; x1 = 0.5 * sc; z0 = -0.5 * sc; z1 = 0.5 * sc; spotBoxes.push(screenBox(x0, 0, z0, x1, 1.1 * sc, z1, [0, 0, 0, 0])); }
    else {
      for (const v of views) {
        if (!v.visible) continue;
        const j = v.jelly;
        // (the tier's own light on the table reaches past the jelly: the Mythic dome, the Epic+ caustic ring; a capsule stands beyond it, not half inside it, VERIFY_RENDER_B B-m1)
        const reach = fxReach(v) * Math.max(j.maxX - j.minX, j.maxZ - j.minZ) * 0.5;
        x0 = Math.min(x0, j.minX - reach); x1 = Math.max(x1, j.maxX + reach); z0 = Math.min(z0, j.minZ - reach); z1 = Math.max(z1, j.maxZ + reach);
        // the body's silhouette box on screen (its skin vertices, not its world box: that one's corners overhang the silhouette a lot)
        const P = v.proxy.positions, b = [Infinity, Infinity, -Infinity, -Infinity];
        for (let i = 0; i < P.length; i += 3) {
          spotV.set(P[i], P[i + 1], P[i + 2]).project(camera);
          const sx = (spotV.x * 0.5 + 0.5) * cssW, sy = (1 - (spotV.y * 0.5 + 0.5)) * cssH;
          if (sx < b[0]) b[0] = sx; if (sx > b[2]) b[2] = sx; if (sy < b[1]) b[1] = sy; if (sy > b[3]) b[3] = sy;
        }
        spotBoxes.push(b);
      }
      if (!Number.isFinite(x0)) { x0 = -0.5 * sc; x1 = 0.5 * sc; z0 = -0.5 * sc; z1 = 0.5 * sc; }
      zc = p.proxy.center.z;
    }
    // outside a ceremony the camera frames a waiting capsule WITH the bodies (updateCamera: it pulls back to make room, up to REFRAME_MAX), so
    // a spot beside them is never "off the frame" sideways; one that would cost a bigger pull-back than that is rejected (a smaller capsule
    // beside the body instead: never one in front of it just because the frame is narrow)
    spotReframes = !director.active && !!p;
    const baseWant = spotReframes ? framingFor(false, 0, 0, 1).want : 1;
    const baseDist = Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect)) * zoomF;   // the camera's distance at a framing of 1
    const cx = (x0 + x1) / 2;
    let bx = x1 + CAP_R + 0.14 * sc, bz = zc, bs = 1, bestBad = Infinity, maxRatio = REFRAME_MAX;
    const tryAt = (x: number, z: number, size: number): boolean => {
      let pen = 0;
      if (spotReframes) {
        const f = framingFor(true, x, z, size);
        let ratio = f.want / Math.max(1e-6, baseWant);
        // (the camera also aims between the body and a capsule standing in front of it, which moves it forward and the body further from it:
        // that shrinks the body too, by about depth / distance; a spot that costs more than the limit counts that, not only the zoom)
        if (f.multi && f.mz > 0) ratio *= 1 + (f.mz * 0.8 * Math.cos(yaw) * Math.cos(pitch)) / (f.want * baseDist);
        if (ratio > maxRatio) pen = (ratio - maxRatio) * 2000;
      }
      const bad = spotBadness(x, z, z < zc ? 2 : 0.6, size) + pen + (1 - size) * 4;   // (between equally bad spots, the bigger capsule)
      if (bad < bestBad - 1e-6) { bestBad = bad; bx = x; bz = z; bs = size; }
      return bad - (1 - size) * 4 <= 0;
    };
    // beside the bodies first, at every size (a smaller capsule beside the squishy beats a big one in front of it): right, then left, at four
    // depths; the usual gap first, then a tighter one, then a wider one
    for (const wide of spotReframes ? [false, true] : [false]) {
      maxRatio = wide ? REFRAME_WIDE : REFRAME_MAX;
      for (const size of SPOT_SIZES) {
        const r = CAP_R * size;
        for (const g of SPOT_GAPS) for (const side of SIDES) for (const dz of SPOT_DEPTHS) {
          const x = side > 0 ? x1 + r + g * sc : x0 - r - g * sc;
          if (tryAt(x, zc + dz * sc, size)) return { x: bx, z: bz, size: bs };
        }
      }
    }
    // nothing beside is clean (a very wide body): behind to a side, then in front (lower in the picture)
    for (const size of SPOT_SIZES) {
      const gap = CAP_R * size + 0.14 * sc;
      if (tryAt(x1 + gap * 0.4, z0 - gap, size) || tryAt(x0 - gap * 0.4, z0 - gap, size)) return { x: bx, z: bz, size: bs };
      for (const [fx, fz] of FRONT) if (tryAt(cx + fx * (x1 - x0), z1 + fz * gap, size)) return { x: bx, z: bz, size: bs };
    }
    return { x: bx, z: bz, size: bs };
  }
  /**
   * How badly a capsule of `size` standing at (x, z) breaks the rules, in CSS px: outside the safe frame (x3) + overlap with a body box
   * (0 = clean). The overlap is weighted by `hideW`: a capsule BEHIND a body is hidden by it (2); one in front covers the face (the upper
   * 65% of the box, 0.6) or, less badly, the foot (0.2).
   */
  function spotBadness(x: number, z: number, hideW: number, size: number): number {
    // the capsule's silhouette box: its centre +- its projected radius / half-height
    const hh = CAPSULE_HEIGHT * size;
    spotV.set(x, hh / 2, z).project(camera);
    const cx = (spotV.x * 0.5 + 0.5) * cssW, cy = (1 - (spotV.y * 0.5 + 0.5)) * cssH;
    spotV.set(x + CAP_R * size, hh / 2, z).project(camera);
    const rx = Math.abs((spotV.x * 0.5 + 0.5) * cssW - cx);
    spotV.set(x, hh, z).project(camera);
    const ry = Math.abs((1 - (spotV.y * 0.5 + 0.5)) * cssH - cy);
    const b = spotBox; b[0] = cx - rx; b[2] = cx + rx; b[1] = cy - ry; b[3] = cy + ry;
    const W = cssW, H = cssH, m = 6;
    // the tap circle (CapsuleHandle.screenPoint: 1.35x the projected radius) is wider than the silhouette: it must stay on screen too
    spotV.set(x, (CAPSULE_HEIGHT / 2 + CAP_R) * size, z).project(camera);
    const rh = Math.max(rx, Math.max(20, Math.abs((1 - (spotV.y * 0.5 + 0.5)) * cssH - cy) * 1.35));
    // off the safe frame counts 3x: a capsule half under the HUD or off the edge cannot be tapped; a little overlap only hides some of it
    let bad = 3 * (Math.max(0, safe.top + m - b[1]) + Math.max(0, b[3] - (H - safe.bottom - m)));
    if (!spotReframes) bad += 3 * (Math.max(0, safe.left + m - (cx - rh)) + Math.max(0, cx + rh - (W - safe.right - m)));
    // PLAYGROUND (setObstacles): never on a prop's footprint (a thing at Home, a place's props): metres of overlap, weighted like a hidden capsule
    for (let i = 0; i < obstacleN; i++) {
      const ox = x - obstacles[i * 3], oz = z - obstacles[i * 3 + 1], need = obstacles[i * 3 + 2] + CAP_R * size + 0.04;
      const d2 = ox * ox + oz * oz;
      if (d2 < need * need) bad += 2000 * (need - Math.sqrt(d2));
    }
    // (the overlap test works on the box grown by a small margin: a capsule that only just clears a body's box still reads as touching it)
    const gm = 8;
    for (const o of spotBoxes) {
      const ox = Math.min(b[2] + gm, o[2]) - Math.max(b[0] - gm, o[0]);
      if (ox <= 0) continue;
      if (hideW >= 1) { const oy = Math.min(b[3] + gm, o[3]) - Math.max(b[1] - gm, o[1]); if (oy > 0) bad += hideW * Math.sqrt(ox * oy); continue; }
      const face = o[1] + 0.65 * (o[3] - o[1]);
      const oyF = Math.min(b[3] + gm, face) - Math.max(b[1] - gm, o[1]), oyL = Math.min(b[3] + gm, o[3]) - Math.max(b[1] - gm, face);
      if (oyF > 0) bad += hideW * Math.sqrt(ox * oyF);
      if (oyL > 0) bad += 0.2 * Math.sqrt(ox * oyL);
    }
    return bad;
  }
  /** Screen box [x0, y0, x1, y1] (CSS px) of a world-space box. */
  function screenBox(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: number[]): number[] {
    out[0] = Infinity; out[1] = Infinity; out[2] = -Infinity; out[3] = -Infinity;
    for (let k = 0; k < 8; k++) {
      spotV.set(k & 1 ? bx : ax, k & 2 ? by : ay, k & 4 ? bz : az).project(camera);
      const sx = (spotV.x * 0.5 + 0.5) * cssW, sy = (1 - (spotV.y * 0.5 + 0.5)) * cssH;
      if (sx < out[0]) out[0] = sx; if (sx > out[2]) out[2] = sx; if (sy < out[1]) out[1] = sy; if (sy > out[3]) out[3] = sy;
    }
    return out;
  }

  function applySize(): void {
    // (a fractional ratio on a tiny frame must not round the drawing buffer down to 1 px either)
    renderer.setPixelRatio(Math.max(Math.min(dpr, TIERS[tier].dprCap), MIN_FRAME_PX / Math.min(cssW, cssH)));
    renderer.setSize(cssW, cssH, false);
    camera.aspect = cssW / cssH;
    camera.updateProjectionMatrix();
  }

  /** The frame, the HUD rows or the bodies changed: a waiting capsule's spot is checked again once things have settled (see replaceCapsule). */
  function markCapSpot(): void { if (capsule && !capFixed) capRecheck = CAP_RECHECK_S; }
  function addView(body: SoftBodyLike, genome: Genome, t: TierName, owned: boolean, pos?: V3, chunk = false, lite = false): BodyView {
    markCapSpot();
    const v = new BodyView(nextId++, body, genome, t, TIERS[tier], hub, quad, owned, chunk, lite);
    v.mats.uniforms.uHeat.value = heat;   // (one shared heat point: setHeatPoint)
    if (placeHost?.light) v.mats.setLight(placeHost.light);
    v.setCalm(calm);
    // (the proxy's centre carries the offset only after a sync: without one the camera, which runs before the views update, framed a body added at an offset as if it stood at the
    // origin for one frame: a mat re-added after a swap dipped the framing by 2 .. 3% and eased back; VERIFY_RENDER_B measured 0.0314 / frame on the phone)
    if (pos) { v.proxy.setOffset(pos.x, pos.y, pos.z); v.proxy.sync(0, 0); }
    scene.add(v.group);
    views.push(v);
    if (primaryId === null) { primaryId = v.id; bodyScale = v.scale; if (!director.active && !keepFraming) camScale = bodyScale; }
    return v;
  }
  function removeView(v: BodyView): void {
    markCapSpot();
    const i = views.indexOf(v);
    if (i >= 0) views.splice(i, 1);
    emotes?.dropBody(v.id);
    cut.bodyRemoved(v);
    v.dispose();
    if (primaryId === v.id) { primaryId = views.length ? views[0].id : null; }
  }
  function removeAllViews(): void { while (views.length) removeView(views[views.length - 1]); primaryId = null; }
  function discardCapsule(): void { if (capsule) { capsule.dispose(); capsule = null; } capsuleParked = false; pendingDrop = null; capFixed = false; capRecheck = -1; }
  /**
   * A waiting capsule whose spot went bad since it was chosen (the phone turned, the HUD rows moved, another squishy or the pieces of a
   * cut now stand where it does) glides to the best spot for the frame as it is now: standing, over ~0.4 s. A spot that is still clean
   * (inside the safe frame, clear of every body) is left alone. Never while it is held, opening, parked, falling, or was placed by the caller.
   */
  function replaceCapsule(): void {
    const c = capsule;
    if (!c || capFixed || capsuleParked || pendingDrop || !sized || !c.group.visible || c.gone || !c.landed || c.burstT >= 0 || c.squeezeAmount > 0.01) return;
    const p = primary(), spot = capsuleSpot(p);
    // (capsuleSpot just filled spotBoxes / spotReframes: how bad is where it stands now, by the same measure)
    const zc = p && !director.active ? p.proxy.center.z : 0;
    const now = spotBadness(c.pos.x, c.pos.z, c.pos.z < zc ? 2 : 0.6, c.size);
    if (now <= 0.5 && c.size >= spot.size - 0.02) return;
    if (Math.hypot(spot.x - c.pos.x, spot.z - c.pos.z) > 0.03 || Math.abs(spot.size - c.size) > 0.04) c.glideTo(spot.x, spot.z, spot.size);
  }
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

  /** The camera's aim for ONE body at its slot and rest height (updateCamera's one-body follow with the live centre replaced). */
  const aimOut = { x: 0, y: 0, z: 0 };
  function restAim(p: BodyView, scale: number): void {
    let k = 0;
    for (const v of views) { if (v === p) break; if (v.visible && !v.chunk) k++; }
    framePoint(p, k, true);
    aimOut.x = slotXZ.x * 0.6; aimOut.z = slotXZ.z * 0.6;
    aimOut.y = TARGET_Y * scale + Math.max(0, p.restCy * p.growth - TARGET_Y * scale) * 0.7;
  }
  function updateCamera(dt: number, time: number): void {
    const k = 1 - Math.exp(-dt * 12);
    yaw += (tYaw - yaw) * k;
    pitch += (tPitch - pitch) * k;
    zoomF += (tZoom - zoomF) * k;
    // PLAYGROUND (a place, P8): the camera frames the play bounds of the layout in use, fitted once (setPlayBounds) with its lens (placeview.ts:
    // the widest that meets RD-17); it never follows a body. Home keeps the 35 degree lens.
    const fv = play ? play.fov : 35;
    if (camera.fov !== fv) { camera.fov = fv; camera.updateProjectionMatrix(); }
    if (play) {
      const kt = 1 - Math.exp(-dt * 6);
      tgt.x += (play.aimX - tgt.x) * kt; tgt.y += (play.aimY - tgt.y) * kt; tgt.z += (play.aimZ - tgt.z) * kt;
      const d = play.dist * zoomF * cameraFx.dist;
      const yw = yaw + cameraFx.yaw, pt = clamp(pitch + cameraFx.pitch, 0.06, 1.38), cp = Math.cos(pt);
      camera.position.set(tgt.x + d * Math.sin(yw) * cp, tgt.y + d * Math.sin(pt), tgt.z + d * Math.cos(yw) * cp);
      camera.lookAt(tgt);
      camera.updateMatrixWorld();
      return;
    }
    // stage B1: with 2..5 bodies out on the mat, frame them all (their table extents, plus a margin) and aim at their middle
    let want = framing ?? bodyScale, multi = false, mx = 0, mz = 0;
    if (!director.active) {
      // a capsule standing on the mat beside the squishy (or the group) is framed with it
      const c = capsule && !capsuleParked && capsule.group.visible ? capsule : null;
      const f = c ? framingFor(true, c.pos.x, c.pos.z, c.size) : framingFor(false, 0, 0, 1);
      want = f.want; multi = f.multi; mx = f.mx; mz = f.mz;
    }
    // (quicker while a neck forms: the lobes of a cut body swell within a third of a second)
    let necking = false;
    if (!calm) for (const v of views) if (v.visible && v.seamAmount > 0.02) { necking = true; break; }
    camScale += (want - camScale) * (1 - Math.exp(-dt * (necking ? 14 : 4)));
    // follow the primary body gently (it can drift when shoved or floating); a ceremony keeps the pad centred
    let wx = 0, wy = TARGET_Y * camScale, wz = 0;
    const p = primary();
    if (multi) { wx = mx; wz = mz * 0.8; wy = TARGET_Y * bodyScale; }   // the bodies stand on the table whatever the zoom: aim at their middle
    else if (p && !director.active) {
      const c = p.proxy.center;
      if (autoFraming && !p.playerMoving) {
        // PLAYGROUND (D-37): LIFE at Home: the one body is framed at its slot and rest height, so its own hops and scoots never move the camera
        restAim(p, camScale);
        wx = aimOut.x; wy = aimOut.y; wz = aimOut.z;
      } else {
        wx = c.x * 0.6; wz = c.z * 0.6;
        wy = TARGET_Y * camScale + Math.max(0, c.y - TARGET_Y * camScale) * 0.7;
      }
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

  /**
   * RD-12 (SHELL_4.md: the "four-eyed" look): the eyes draw after every jelly with no depth from them, so a squishy's eyes read crisp
   * THROUGH a clear body standing in front of it. Each eye that the ray from the camera passes through another body's jelly (its rest
   * ellipsoid from the jelly's box, shrunk to its silhouette) on the way, with that body's centre nearer the camera, fades: to 0.15 behind a
   * clear jelly, to 0 behind an opaque family (the share of transmission the front body keeps), softly at the silhouette's edge, eased (~0.06 s).
   * One body alone, or eyes in front, keep opacity 1 exactly (today's pixels). Zero allocation.
   */
  function fadeOccludedEyes(dt: number): void {
    const cp = camera.position, ke = 1 - Math.exp(-dt * 18);
    const fw = camera.matrixWorld.elements, fx = -fw[8], fy = -fw[9], fz = -fw[10];   // the view direction
    for (const v of views) {
      if (!v.visible || v.chunk || v.faceHidden) continue;
      const E = v.face.eyeWorld;
      for (let e = 0; e < 2; e++) {
        const ex = E[e * 3], ey = E[e * 3 + 1], ez = E[e * 3 + 2];
        const eyeDepth = (ex - cp.x) * fx + (ey - cp.y) * fy + (ez - cp.z) * fz;
        let target = 1;
        for (const o of views) {
          if (o === v || !o.visible) continue;
          const j = o.jelly;
          const cx = (j.minX + j.maxX) * 0.5, cy = (j.minY + j.maxY) * 0.5, cz = (j.minZ + j.maxZ) * 0.5;
          if ((cx - cp.x) * fx + (cy - cp.y) * fy + (cz - cp.z) * fz >= eyeDepth) continue;   // that body is not in front of this eye
          const rx = Math.max(0.03, (j.maxX - j.minX) * 0.47), ry = Math.max(0.03, (j.maxY - j.minY) * 0.47), rz = Math.max(0.03, (j.maxZ - j.minZ) * 0.47);
          // the segment camera -> eye in the ellipsoid's unit space: its closest approach to the centre
          const ox = (cp.x - cx) / rx, oy = (cp.y - cy) / ry, oz = (cp.z - cz) / rz;
          const dx = (ex - cp.x) / rx, dy = (ey - cp.y) / ry, dz = (ez - cp.z) / rz;
          const dd = dx * dx + dy * dy + dz * dz;
          const t = dd > 1e-12 ? Math.min(1, Math.max(0, -(ox * dx + oy * dy + oz * dz) / dd)) : 0;
          const mx = ox + t * dx, my = oy + t * dy, mz = oz + t * dz;
          const m = Math.sqrt(mx * mx + my * my + mz * mz);
          if (m >= 1) continue;
          const u = Math.min(1, (1 - m) / 0.2), occ = u * u * (3 - 2 * u);
          const floor = 0.15 * Math.max(0, Math.min(1, (o.mats.keep - 0.3) / 0.7));   // clear jelly: 0.15 (0.25 still read four-eyed by eye); the most opaque family: 0
          const a = 1 - occ * (1 - floor);
          if (a < target) target = a;
        }
        const now = v.face.eyeAlpha[e];
        let next = now + (target - now) * ke;
        if (target === 1 && next > 0.999) next = 1;
        v.face.setEyeAlpha(e, next);
      }
    }
  }

  /** What the place host needs of the stage (its own objects). */
  const placeCtx: StageCtx = {
    renderer, scene, table, key, rim, fill, views: () => views, heat,
    setSkyBand: (r, g, b) => emotes?.setSky(r, g, b),
    body(id, out) { const v = viewById(id); if (!v || !v.visible) return false; const c = v.proxy.center; out[0] = c.x; out[1] = c.y; out[2] = c.z; out[3] = v.liveRadius; return true; },
    phone: () => coarsePointer || Math.min(cssW, cssH) < 600,
  };
  /** What the bubbles need this frame (one reused object). */
  const emoteFrame: EmoteFrame = {
    camera, cssW: 1, cssH: 1, dpr: 1, safe, capX: 0, capY: 0, capR: 0, ceremony: false, quiet: false, phone: false,
    anchor(bodyId: number, out: Float32Array): boolean {
      const v = viewById(bodyId);
      if (!v || !v.visible) return false;
      const c = v.proxy.center, R = v.proxy.restRadius * v.growth;
      out[0] = c.x; out[2] = c.z;
      out[1] = Math.max(v.jelly.maxY + 0.15 * R, c.y + 1.3 * R);   // the tail tip just above the top (LIFE.md 7.2: 1.3 x rest radius over the centre)
      return true;
    },
  };
  function fillEmoteFrame(quiet: boolean): void {
    const f = emoteFrame;
    f.cssW = cssW; f.cssH = cssH; f.dpr = renderer.getPixelRatio(); f.quiet = quiet; f.ceremony = director.active;
    f.phone = coarsePointer || Math.min(cssW, cssH) < 600;
    const s = capsule && !capsuleParked && capsule.group.visible ? capsule.screenPoint(camera, cssW, cssH, capPt) : null;
    if (s) { f.capX = s.x; f.capY = s.y; f.capR = s.r; } else f.capR = 0;
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
      capsule = null; pendingDrop = null; capFixed = false; capRecheck = -1;
      revealCap = c;
      c.sizeGoal = 1;                      // a capsule stood small beside the body grows back to full as the reveal slides it to the pad
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
      capsule.setSize(spot.size);
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
    // the camera's own geometry (updateCamera: aim at TARGET_Y x the framing, distance = fitDistance x zoom, pitch): a point h above the table at the pad projects
    // to ndcY = q cos(p) / ((d - q sin(p)) tan(fov/2)) with q = h - aim; solving ndcY = 1 - margin for the framing scale gives the closed form below
    framingForHeight: (h: number, margin = 0.04) => {
      const T = Math.tan((camera.fov * Math.PI) / 360), D0 = Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect)) * zoomF;
      const cp = Math.cos(pitch), sp = Math.sin(pitch), yt = (1 - margin) * T, k = cp + yt * sp;
      return (h * k) / (yt * D0 + TARGET_Y * k);
    },
    viewHalfWidth: (scale?: number) => (scale === undefined ? fitDistance() : fitDistance() * scale / camScale) * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect,
  };
  const director = new CeremonyDirector(host);

  const onLost = (e: Event): void => { e.preventDefault(); lost = true; };
  const onRestored = (): void => {
    lost = false;
    // three rebuilt its GL bookkeeping (new attribute / texture / program maps), but every geometry, material and texture made BEFORE the
    // loss still carries the OLD maps' 'dispose' listeners: disposing it later would delete GL objects of the dead context (Chrome logs an
    // INVALID_OPERATION "object does not belong to this context" warning for each). Drop them now, before anything renders and registers
    // the new ones (three's own restore handler ran first: it was added to the canvas first).
    dropStaleDisposeListeners(scene);
    // three re-uploads geometry, textures and programs by itself; the baked environment cube is a render target, so bake it again
    try { hub.rebuild(renderer); } catch { /* a second loss mid-restore: the next restore rebuilds it */ }
    governor.resetWindow(30);
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  applySize();

  const stage: StageLike & RoundTwo & StageExtras = {
    canvas,
    camera,
    onStrand: null,

    setSafeInsets(insets) {
      if (!insets) return;
      let changed = false;
      for (const k of ['top', 'right', 'bottom', 'left'] as const) { const v = insets[k]; if (typeof v === 'number' && Number.isFinite(v) && Math.max(0, v) !== safe[k]) { safe[k] = Math.max(0, v); changed = true; } }
      if (changed) markCapSpot();   // (a waiting capsule that now stands under the HUD glides out from under it)
    },

    matLayout(n) {
      const k = Math.max(1, Math.min(5, Math.floor(Number.isFinite(n) ? n : 1))), s = bodyScale, out: V3[] = [];
      // the first k slots of the frame's slot list (MAT_SLOTS_*): NESTED, so growing the mat never moves a body that is already out
      const slots = camera.aspect < 0.9 ? MAT_SLOTS_TALL : MAT_SLOTS_WIDE;
      for (let i = 0; i < k; i++) out.push({ x: slots[i][0] * s, y: 0, z: slots[i][1] * s });
      return out;
    },

    setBody(body, genome) {
      if (disposed) return;
      director.abort();
      // a SWAP (bodies were showing: the Hoard's preview, a quick switch) eases from the current framing, so a mat group the shell
      // re-adds right after keeps its framing without the camera jumping in and back out; the first body after an empty stage snaps
      const swap = views.length > 0;
      // (not clearBodies(): a CUT swaps the face piece in with setBody right where the cut body's seam glow and the bridges are, and they
      // must carry over the swap, not be wiped with it; each removed view still hands its seam to cut.bodyRemoved)
      removeAllViews();
      keepFraming = swap;
      const v = addView(body, genome, 'common', false);
      keepFraming = false;
      primaryId = v.id; bodyScale = v.scale; framing = null;
      if (!swap) { camScale = bodyScale; tgt.set(body.center.x * 0.6, TARGET_Y * bodyScale, body.center.z * 0.6); }
      governor.resetWindow(24);
    },

    addBody(body, genome, opts?: AddBodyOpts) {
      if (disposed) return -1;
      const v = addView(body, genome, safeTier(opts?.tier), false, opts?.position, !!opts?.chunk, !!opts?.lite);
      governor.resetWindow(24);
      return v.id;
    },
    // a running ceremony owns its bodies (and adopts the result at its end): removing bodies under it first ends it at its final frame,
    // exactly as setBody does, so the result is never orphaned (a primary id pointing at a removed view)
    removeBody(id) { const v = views.find((x) => x.id === id); if (!v) return; if (director.active) director.abort(); if (views.includes(v)) removeView(v); },
    clearBodies() { director.abort(); removeAllViews(); cut.clear(); },
    primaryBodyId() { return primaryId; },
    setBodyTier(id, t) { views.find((x) => x.id === id)?.setTier(safeTier(t)); },
    setCalmEffects(on) {
      calm = !!on; flash.calm = calm;
      for (const v of views) v.setCalm(calm);
      particles.setTwinkle(!calm);
      if (capsule) capsule.calm = calm;
      if (revealCap) revealCap.calm = calm;
      cut.calm = calm;
      if (calm) { cameraFx.dist = 1; cameraFx.yaw = 0; cameraFx.pitch = 0; screen.stopRamp(); }
    },

    setCutSeam(bodyId, plane, t) {
      if (disposed) return;
      for (const v of views) if (v.id === bodyId) { v.setSeam(plane, Number.isFinite(t) ? t : 0); return; }
    },
    partPieces(aId, bId) {
      if (disposed) return;
      const a = viewById(aId), b = viewById(bId);
      if (a && b) cut.part(a, b);
    },
    setBridge(aId, bId, t) {   // (called every frame of a reconnect: no allocation)
      if (disposed) return;
      const a = viewById(aId), b = viewById(bId);
      if (a && b) cut.bridge(a, b, t);
    },

    dropCapsule(opts) {
      if (disposed) return INERT_CAPSULE;
      discardCapsule();
      capsule = new Capsule(hub, quad, !TIERS[tier].transmission);
      const c = capsule;
      const id = ++capsuleId;
      capFixed = !!opts?.at;
      // where it stands is chosen on screen (capsuleSpot), which needs the frame's real size: a capsule dropped before the first resize() (one
      // already waiting when the game boots, the shell drops it while it is built) is placed on the first update after it, not on a 1 x 1 frame
      const place = (): void => {
        if (capsule !== c) return;
        const spot = opts?.at ? { x: opts.at.x, z: opts.at.z, size: 1 } : capsuleSpot(primary());
        c.setSize(spot.size);
        c.calm = calm;
        if (director.kind === 'merge') {     // the pad is busy: it waits out of sight and fades in beside the result when the merge ends
          c.placeStanding(spot.x, spot.z); c.group.visible = false; c.touchedDown = false; capsuleParked = true; parkedOnLand = opts?.onLand ?? null;
        } else if (calm) c.appear(spot.x, spot.z, opts?.onLand); else c.drop(spot.x, spot.z, opts?.onLand);   // calm / reduced motion: it fades in, no drop
      };
      if (sized || opts?.at) place(); else { c.calm = calm; c.group.visible = false; pendingDrop = place; }
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
      // a capsule dropped before the frame had a size lands now (the camera is up to date for it); a waiting one is re-checked once the frame,
      // the HUD rows or the bodies have stopped changing
      if (pendingDrop && sized) { const f = pendingDrop; pendingDrop = null; f(); }
      else if (capRecheck >= 0) { capRecheck -= d; if (capRecheck < 0 && !director.active) replaceCapsule(); else if (capRecheck < 0) capRecheck = CAP_RECHECK_S; }
      table.update(camera);
      const quiet = calm || reducedMotion;
      for (const v of views) {
        v.clock += d;                     // every view ages, hidden ones too (a ceremony result is created hidden at t = 0)
        if (!v.visible) continue;
        v.quiet = quiet;
        v.update(d, v.clock, input.pointerNdc, camera, floatT, v.owned ? d * ts : 0);
      }
      // PLAYGROUND: eyes seen through another body's jelly are depth-faded (RD-12), Home's things, the bubbles (after the camera moved)
      fadeOccludedEyes(d);
      if (home) home.update(d, quiet);
      if (placeHost) placeHost.update(d, time, quiet, reducedMotion, tier === 'high' ? 0 : tier === 'med' ? 1 : 2, propPoses, propCount, propThing, director.active);
      if (emotes) { fillEmoteFrame(quiet); emotes.update(d, emoteFrame); }
      // Back-to-front order of the translucent jellies. Their meshes sit at the origin with world-space vertices, so three's own
      // transparent / transmissive sort sees one depth for all of them and falls back to creation order (a back body painted over a front
      // one: plainly wrong in a 3-parent merge). renderOrder 10.00..10.99, far first; everything else keeps its own order.
      depthOrder.length = 0;
      for (const v of views) if (v.visible) depthOrder.push(v);
      for (const v of depthOrder) { const c = v.proxy.center; v.sortDepth = (camera.position.x - c.x) ** 2 + (camera.position.y - c.y) ** 2 + (camera.position.z - c.z) ** 2; }
      depthOrder.sort(farFirst);
      for (let i = 0; i < depthOrder.length; i++) depthOrder[i].jelly.mesh.renderOrder = 10 + Math.min(0.99, i * 0.01);
      // CUT glows (seam, bridge): calm halves them, and for a second after a granted ceremony flash they stay low (the flash governor)
      const govK = (calm ? 0.5 : 1) * (flash.sinceFlash(time) < 1 ? 0.35 : 1);
      for (const v of views) v.glowK = govK;
      cut.update(d, govK);
      // tack strands (stage B6) and the CUT parting strands -> the shell's strand voice
      const hook = stage.onStrand;
      if (hook) {
        for (const v of views) { const ev = v.strands.events; for (let i = 0; i < ev.length; i++) { try { hook(v.id, ev[i]); } catch { /* a hook must never break a frame */ } } }
        for (let i = 0; i < cut.events.length; i++) { try { hook(cut.eventBody[i], cut.events[i]); } catch { /* idem */ } }
      }
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
      // a size that is not a number (NaN / Infinity) says nothing about the frame: ignored (it used to leave camScale NaN for good, VERIFY_RENDER_A R-A3);
      // 0 and 1 px (a hidden iframe reports 0; a 1 px canvas) are held at MIN_FRAME_PX: three's offscreen targets (transmission, crossfade) are the drawing buffer x a
      // scale, and a zero-sized one logs GL_INVALID_FRAMEBUFFER_OPERATION on every draw
      if (!Number.isFinite(width) || !Number.isFinite(height)) return;
      const w = Math.max(MIN_FRAME_PX, Math.floor(width)), h = Math.max(MIN_FRAME_PX, Math.floor(height));
      if (sized && (w !== cssW || h !== cssH)) markCapSpot();   // (turned or resized: a waiting capsule is re-placed for the new frame)
      cssW = w; cssH = h; sized = true;
      dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
      applySize();
      if (play) refitPlay();
      governor.resetWindow(10);
    },

    orbit(dYaw, dPitch) {
      if (!Number.isFinite(dYaw) || !Number.isFinite(dPitch)) return;
      tYaw -= dYaw;
      tPitch = clamp(tPitch + dPitch, 0.06, 1.38);   // never under the table, never exactly top-down
      if (play) { tYaw = clamp(tYaw, -Math.PI / 3, Math.PI / 3); tPitch = clamp(tPitch, 0.15, 0.9); }   // a place: yaw within 60 degrees of its front (P8)
    },

    zoom(delta) {
      if (!Number.isFinite(delta)) return;
      const k = Math.abs(delta) > 4 ? 0.0016 : 0.12;
      tZoom = clamp(tZoom * Math.exp(delta * k), play ? 0.7 : 0.55, play ? 1.6 : 1.9);
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

    /* ── PLAYGROUND (PLAYGROUND_BUILD.md 9; contracts.ts PLAYGROUND block) ── */
    setBodyGaze(id, x, y, z, weight) {
      const v = viewById(id);
      if (!v) return;
      const g = v.face.gaze, w = Number.isFinite(weight) ? Math.max(0, Math.min(1, weight)) : 0;
      if (w > 0 && Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) { g[0] = x; g[1] = y; g[2] = z; g[3] = w; } else g[3] = 0;
    },
    setBodyExpression(id, expr, amount) { viewById(id)?.face.setExpression(expr, amount); },
    setBodyPose(id, leanX, leanZ, swayAmp, swayHz, swayPhase) { viewById(id)?.pose.set(leanX, leanZ, swayAmp, swayHz, swayPhase, viewById(id)?.clock ?? 0); },
    setBodyBreath(id, depth) { const v = viewById(id); if (v) v.pose.deep = Number.isFinite(depth) ? Math.max(0, Math.min(1, depth)) : 0; },
    setBodyAsleep(id, asleep) { const v = viewById(id); if (v) { v.asleep = !!asleep; v.pose.asleep = !!asleep; } },
    setBodyLook(id, frost, wet, sand, toast, snow) {
      const v = viewById(id);
      if (!v) return;
      const c = (x: number): number => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0);
      v.look[0] = c(frost); v.look[1] = c(wet); v.look[2] = c(sand); v.look[3] = c(toast); v.look[4] = c(snow);
    },
    setHeatPoint(x, y, z) { if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) heat.set(x, y, z, 1); else heat.set(0, 0, 0, 0); },
    emoteSlots: 8,
    emote(slot, bodyId, icon, style, lifeS, dots, flags) {
      if (disposed) return;
      if (emotes) { emotes.show(slot, bodyId, icon, style, lifeS, dots, flags); return; }
      const i = Math.floor(slot);
      if (i >= 0 && i < 8) { pendOn[i] = 1; pendEm.set([bodyId, icon, style, lifeS, dots, flags], i * 7); }
      needLife();
    },
    clearEmote(slot) { if (emotes) emotes.clear(slot); else { const i = Math.floor(slot); if (i >= 0 && i < 8) pendOn[i] = 0; } },
    emoteScreen(slot, out) { return emotes ? emotes.screen(slot, out) : false; },
    setEmotesInPhoto(on) { pendPhoto = on ? 1 : 0; emotes?.setInPhoto(!!on); },
    bodyScreenPoint(id, out) {
      const v = viewById(id);
      if (!v || !v.visible || !sized) return false;
      const c = v.proxy.center;
      anchorV.set(c.x, c.y, c.z).project(camera);
      if (anchorV.z > 1 || Math.abs(anchorV.x) > 1 || Math.abs(anchorV.y) > 1) return false;
      const sx = (anchorV.x * 0.5 + 0.5) * cssW, sy = (1 - (anchorV.y * 0.5 + 0.5)) * cssH;
      const e = camera.matrixWorld.elements, R = v.proxy.restRadius * v.growth;
      anchorR.set(c.x + e[0] * R, c.y + e[1] * R, c.z + e[2] * R).project(camera);
      out[0] = sx; out[1] = sy; out[2] = Math.abs((anchorR.x * 0.5 + 0.5) * cssW - sx);
      return true;
    },
    setObstacles(xzr, n) {
      const k = xzr ? Math.max(0, Math.min(32, Math.floor(n) || 0, Math.floor(xzr.length / 3))) : 0;
      for (let i = 0; i < k * 3; i++) obstacles[i] = Number.isFinite(xzr![i]) ? xzr![i] : 0;
      obstacleN = k;
      markCapSpot();
    },
    visibleTable(out) {
      if (!sized || disposed) return false;
      // the REST framing of the mat slots in use: yaw 0, zoom 1, no ceremony push, the rest pitch (stage.ts updateCamera with slots for centres)
      const f = framingFor(false, 0, 0, 1, true);
      let ax: number, ay: number, az: number;
      if (f.multi) { ax = f.mx; az = f.mz * 0.8; ay = TARGET_Y * bodyScale; }
      else { const p = primary(); if (p) { restAim(p, f.want); ax = aimOut.x; ay = aimOut.y; az = aimOut.z; } else { ax = 0; az = 0; ay = TARGET_Y * f.want; } }
      const dist = f.want * Math.max(3.0, 2.4 / Math.max(0.2, camera.aspect));
      return visibleTableAt(ax, ay, az, dist, REST_PITCH, camera.fov, cssW, cssH, safe.top, safe.right, safe.bottom, safe.left, out);
    },
    setAutonomyFraming(on) { autoFraming = !!on; if (autoFraming) needLife(); },
    async loadPlace(id) {
      if (!id || id === 'home') return true;
      if (disposed) return false;
      try {
        if (!placeHost) { const m = await import('./place.ts'); placeHost ??= new m.PlaceHost(hub); }
        const ok = await placeHost.load(id);
        if (ok && !play) refitPlay();   // (bounds set before the away chunk landed)
        return ok;
      } catch { return false; }
    },
    setPlace(id, fadeS) {
      if (disposed) return false;
      const isHome = !id || id === 'home';
      if (!isHome && !placeHost?.look(id!)) return false;
      // the swap hides under a snapshot crossfade (screenfx.ts: a fade from the frame as it was, never a flash)
      if (!lost && sized) { renderer.render(scene, camera); screen.beginCrossfade(renderer, Math.max(0.05, Number.isFinite(fadeS) ? fadeS : 0.35), 'linear'); }
      if (isHome) { playB.set([0, 0, NaN, NaN]); play = null; }
      return placeHost ? placeHost.enter(placeCtx, isHome ? null : id, camera.aspect < 0.9 ? 1 : 0) : true;
    },
    reactFx(kind, bodyId, x, y, z, amount, lifeS) { return !!placeHost?.react(kind, bodyId, x, y, z, amount, lifeS); },
    thingFx(thing, kind, amount) { return !!placeHost?.thingFx(thing, kind, amount); },
    setPlayBounds(cx, cz, hx, hz) {
      // (a non-finite or empty bounds clears it: Home's framing again)
      if ([cx, cz, hx, hz].every(Number.isFinite) && hx > 0 && hz > 0) playB.set([cx, cz, hx, hz]); else playB.set([0, 0, NaN, NaN]);
      refitPlay();
    },
    bindProps(poses, count, pThing) {
      propPoses = poses; propCount = poses ? Math.max(0, Math.min(Math.floor(count) || 0, Math.floor(poses.length / 8))) : 0; propThing = pThing ?? null;
      if (home) home.bind(poses, count, pThing ?? null); else { pendBind = [poses, count, pThing ?? null]; if (poses && !placeHost?.active) needLife(); }
    },
    setHomeThing(thing, shown, x, z, yaw) {
      const k = Math.floor(thing);
      if (home) { home.setThing(k, !!shown, x, z, yaw); return; }
      if (k >= 0 && k < 6) { pendThing.set([1, shown ? 1 : 0, x, z, yaw], k * 5); if (shown) needLife(); }
    },
    setKeepsakes(mask) { const m = Number.isFinite(mask) ? mask : 0; if (home) home.setKeepsakes(m); else { pendKeep = m; if (m) needLife(); } },

    dispose() {
      if (disposed) return;
      disposed = true;
      director.abort();
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      try { mqReduce?.removeEventListener('change', onMotionPref); mqCoarse?.removeEventListener('change', onMotionPref); } catch { /* read once */ }
      while (views.length) removeView(views[views.length - 1]);
      discardCapsule(); discardRevealCapsule();
      emotes?.dispose(); home?.dispose(); emotes = null; home = null;
      placeHost?.enter(placeCtx, null, 0);
      table.dispose(); quad.dispose(); screen.dispose(); particles.dispose(); cut.dispose();
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
      emotes: { get: () => emotes },
      homeKit: { get: () => home },
      /** (dev) the lazy LIFE look (bubbles and Home's things) loads now; resolves when it is ready. */
      loadLifeLook: { value: (): Promise<void> => { needLife(); return lifeLoad ?? Promise.resolve(); } },
      autoFraming: { get: () => autoFraming },
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
            particlesDropped: particles.dropped, camScale, cut: { ...cut.live }, cap: capsule ? { x: capsule.pos.x, z: capsule.pos.z, size: capsule.size } : null,
          };
        },
      },
    });
  }
  return stage;
}

/** The stage (StageLike, every round-2 member). */
export function createStage(canvas: HTMLCanvasElement): StageLike & StageExtras {
  return buildStage(canvas);
}
