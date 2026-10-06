// WOBBLEHOARD game core: the composition of the shell modules around one frame loop. DOM-free on purpose (no document/window at import
// time or in createGame), so the same code runs under node with the mocks in _harness/mocks.ts. src/shell/boot.ts adds the DOM.
// The production bundle contains this, never the debug hook: src/app.ts (= createGame + src/shell/debugHook.ts) is what the node probes
// and the dev server use.
//
// Module map (one responsibility each):
//   clock.ts         gesture clock (virtual while paused) + sim-time one-shot timers
//   loop.ts          rAF loop, consecutive-error streak, the fatal-frame path
//   bodies.ts        the play body (+ stage-B extras): atomic swap, adopting a ceremony's resultBody
//   driver.ts        gesture actions -> fingers / grabs / camera; per-finger touch state
//   feedback.ts      SoftEvent -> audio / haptics / shake / FX; held voices; round-3 play-mat voices
//   feel.ts          feel constants + the body CALIBRATION (audit finding 5)
//   settingsCtl.ts   settings (persisted / session / resolved) applied with change detection
//   collectionPort.ts the shell's port to the collection (src/collection) and adaptCollection
//   capsules.ts      meter-full cue, the table queue, hold-to-open, the DOM twin
//   ceremonies.ts    reveal + merge on the stage, beat -> sound / haptics, skip gate, result adoption
//   game.ts          this file: phases, the frame, the input port, lifecycle (hidden / context loss / covered), listeners
import type {
  PieceOpts, Settings, SoftBodyLike, SoftEvent, SoftMetrics, SquishAudio, StageFrameInput, StageLike, TierName, V3,
} from '../contracts.ts';
import type { Cutter, CutResult } from './cut.ts';
import { createCutter } from './cut.ts';
import type { Genome, SquishyInstance } from '../core/genome.ts';
import { genomeEquals } from '../core/genome.ts';
import { clamp } from '../core/rng.ts';
import type { ResolvedSettings, SettingsEnv, StorageLike } from '../core/settings.ts';
import { detectEnv, safeLocalStorage } from '../core/settings.ts';
import type { ProfileStore } from '../core/save.ts';
import { createProfileStore } from '../core/save.ts';
import type { BodyHost } from '../input/camera.ts';
import { cameraRay, createBodyHost, pxToNdc, raycastAt } from '../input/camera.ts';
import type { Gestures } from '../input/gestures.ts';
import { createGestures } from '../input/gestures.ts';
import type { Haptics } from '../input/haptics.ts';
import { createHaptics } from '../input/haptics.ts';
import type { BodyManager, ExtraBody, PlayIdentity } from './bodies.ts';
import { createBodyManager, styleTier, tierOfGenome } from './bodies.ts';
import type { Capsules } from './capsules.ts';
import { createCapsules } from './capsules.ts';
import type { Ceremonies, RevealInfo } from './ceremonies.ts';
import { createCeremonies, speciesName } from './ceremonies.ts';
import type { GestureClock } from './clock.ts';
import { createGestureClock, createSimTimers } from './clock.ts';
import type { ItemView, MergeParentView, MeterReading, ShellCollection } from './collectionPort.ts';
import { adaptCollection } from './collectionPort.ts';
import type { Collection } from '../collection/index.ts';
import { createCollection } from '../collection/index.ts';
import type { Driver } from './driver.ts';
import { createDriver } from './driver.ts';
import type { Feedback } from './feedback.ts';
import { createFeedback } from './feedback.ts';
import { TUNING } from './feel.ts';
import { createLoop } from './loop.ts';
import type { Mat } from './mat.ts';
import { createMat } from './mat.ts';
import type { PlayHistory } from './playHistory.ts';
import { createPlayHistory } from './playHistory.ts';
import type { SettingsController } from './settingsCtl.ts';
import { createSettingsController } from './settingsCtl.ts';
import type { MeterView } from '../collection/types.ts';
import { projectToNdc } from '../input/camera.ts';
import type { Gain, GainKind, Pending } from './xp.ts';
import { createPending, gainOf } from './xp.ts';

export type Phase = 'boot' | 'title' | 'play' | 'error';
/** The toy tray's tools (FUN.md 1): the Hand (poke, squish, stretch), the Cut tool (CUT.md), Snap (photo mode: drags orbit, nothing pokes). */
export type Tool = 'hand' | 'cut' | 'snap';
/** A tab hidden longer than this reconnects a cut squishy when it comes back (CUT.md 2.2). */
export const HIDDEN_RECONNECT_MS = 60_000;
/** Why the sim and the audio are paused: the tab is hidden, the GL context is lost, a full-screen panel covers the stage. */
export type PauseReason = 'hidden' | 'context' | 'covered';

export interface PointerIn {
  id: number;
  /** CSS px relative to the canvas, origin top-left */
  x: number;
  y: number;
  /** event timestamp (same clock as GameDeps.now). Omitted = now. */
  t?: number;
  button?: number;
  type?: 'mouse' | 'touch' | 'pen';
  /** Shift is held (src/input/pointer.ts sets it from mouse and pen events only). On the move that commits a press to a pull it pulls BOTH
   *  sides (gestures.ts SHIFT). The facade drops it for `type: 'touch'`: a finger never mirrors. */
  shift?: boolean;
}

export interface InputPort {
  pointerDown(p: PointerIn): void;
  pointerMove(p: PointerIn): void;
  pointerUp(p: PointerIn): void;
  pointerCancel(id: number): void;
  /** mouse hover (eyes follow) without a press */
  hover(x: number, y: number): void;
  hoverEnd(): void;
  wheel(deltaPx: number): void;
  cancelAll(): void;
  /** keyboard orbit/zoom helpers (accessibility) */
  orbitBy(dxPx: number, dyPx: number): void;
  zoomBy(notches: number): void;
  /** where Space pokes (px), or null before the first frame */
  screenCentre(): { x: number; y: number } | null;
  isDown(id: number): boolean;
  /** a key (Space / Enter / Escape) while a ceremony runs: skip it after the 350 ms gate. True = consumed. */
  skip(): boolean;
  /** pointer / key input currently reaches the play body (phase play, no ceremony, nothing suspended) */
  readonly live: boolean;
}

export interface GameDeps {
  /** `opts.at` (the play mat with body-to-body contact): build the squishy standing at this world point. A physics that cannot place a
   *  body ignores it (the mat then keeps that body apart: mat.ts). `opts.piece` (CUT): build one piece of a cut squishy (PieceOpts). */
  createBody(genome: Genome, opts?: { at?: V3; piece?: PieceOpts }): SoftBodyLike;
  createStage(canvas: HTMLCanvasElement): StageLike;
  createAudio(): SquishAudio;
  /** handed to createStage; node tests omit it */
  canvas?: HTMLCanvasElement;
  /** null = no persistence at all. Default: localStorage (guarded). */
  storage?: StorageLike | null;
  /** ?genome= override. Previewed only, never written to the profile. */
  genome?: Genome;
  /** URL overrides (?float=1, ?quality=): applied on top of stored settings, not persisted until the player changes them. */
  overrides?: Partial<Settings>;
  muted?: boolean;
  env?: SettingsEnv;
  haptics?: Haptics;
  /** ms, monotonic. Default performance.now. Pointer timestamps and the gesture clock use it. */
  now?: () => number;
  /** epoch ms for the meter feed (meter.ts reads epoch times). Default Date.now. */
  epochNow?: () => number;
  raf?: (cb: (ts: number) => void) => number;
  caf?: (id: number) => void;
  onFatal?: (err: unknown) => void;
  profile?: ProfileStore;
  /** The collection module (src/collection createCollection). Default: one built here on `storage` (the practice ledger), sharing the
   *  profile's starter id. boot.ts builds it itself so the profile and the collection share one cross-tab storage subscription. */
  collection?: Collection;
}

export interface ShellEvents {
  interaction: () => void;
  settings: (s: ResolvedSettings) => void;
  identity: (id: PlayIdentity, label: PlayLabel) => void;
  mute: (muted: boolean) => void;
  phase: (p: Phase) => void;
  meter: (m: MeterReading) => void;
  capsuleReady: (credits: number) => void;
  message: (text: string) => void;
  ceremony: (e: { type: 'start'; kind: 'capsule' | 'merge' } | { type: 'reveal' | 'end'; info: RevealInfo }) => void;
  paused: (reasons: readonly PauseReason[]) => void;
  /** a polite status line from the collection (table full, resting, done for today, a save problem) */
  notice: (text: string) => void;
  /** visible XP (FUN.md 2): a touch paid squish points (where it was on the canvas, CSS px): the sparks or the calm glow */
  gain: (g: Gain) => void;
  /** the toy tray's tool changed */
  tool: (t: Tool) => void;
  /** the Cut tool's blade: a swipe in progress over the canvas (CSS px), or its end (null) */
  blade: (b: { x0: number; y0: number; x1: number; y1: number } | null) => void;
  /** a swipe, a Split in two or a Reconnect all ended: what happened (the cutter says the line itself) */
  cut: (r: CutResult | 'joined') => void;
}

/** What the HUD shows: the catalog species name (audit finding 19), the tier, and a nickname only when the item has one. */
export interface PlayLabel { species: string; tier: TierName; nickname: string | null }

export interface Game {
  readonly stage: StageLike;
  readonly audio: SquishAudio;
  readonly haptics: Haptics;
  readonly profile: ProfileStore;
  readonly input: InputPort;
  readonly host: BodyHost;
  readonly body: SoftBodyLike;
  readonly bodies: BodyManager;
  readonly settings: ResolvedSettings;
  readonly genome: Genome;
  readonly identity: PlayIdentity;
  readonly label: PlayLabel;
  /** the stored starter (profile) */
  readonly instance: SquishyInstance;
  readonly phase: Phase;
  readonly muted: boolean;
  /** the sim is frozen by pause() (DebugHook) */
  readonly paused: boolean;
  readonly hidden: boolean;
  readonly pauseReasons: readonly PauseReason[];
  readonly fps: number;
  readonly viewport: { w: number; h: number };
  /** the shell's port to the collection (meter, capsules, merge results) */
  readonly collection: ShellCollection;
  /** SHELL-2b seam: the full collection module (stacks, items, previewMerge / merge, hearts, prefs, restock, tasks) */
  readonly hoard: Collection;
  readonly capsules: Capsules;
  /** stage B1: squishies brought out of the Hoard onto the mat beside the play body */
  readonly mat: Mat;
  /** visible XP (FUN.md 2): the pending gain of the squeeze or stretch being held, as a fraction of the ring (0 = none). Cheap; call per step. */
  pendingFill(): number;
  /** where the pending figure comes from: the collection's own preview, or the published pay constants (until ECON's preview lands) */
  readonly pendingSource: 'collection' | 'constants';
  /** the toy tray (FUN.md 1): the tool in hand; setTool('cut') does nothing while the physics cannot cut */
  readonly tool: Tool;
  setTool(t: Tool): void;
  /** CUT: the piece manager of the play squishy */
  readonly cut: Cutter;
  /** the play squishy that survives reloads, and the recently played ones (the HUD quick switcher) */
  readonly history: PlayHistory;
  /**
   * Switch the play squishy to a collection item, in one action (SHELL-2b). 'queued': a ceremony runs (or waits), and the switch applies
   * right after it ends; 'missing': no such item; 'failed': its body could not be built (nothing changed).
   */
  switchTo(itemId: string): 'done' | 'queued' | 'missing' | 'failed';
  readonly ceremonies: Ceremonies;
  readonly clock: GestureClock;
  readonly simTime: number;
  /** the collection's epoch clock (ms; the dev meter accelerator pushes it ahead): lock times are on it */
  epochNow(): number;
  /** the last 32 SoftEvents, oldest first (copies) */
  recentEvents(): SoftEvent[];
  setPhase(p: Phase): void;
  start(): void;
  stop(): void;
  /** One loop iteration at rAF timestamp `ts` (ms). The rAF loop calls this; tests call it directly. */
  frame(ts: number): void;
  /** Advance the sim one fixed step of `dt` and update the stage by `dt` (DebugHook.step). Works while paused. */
  stepOnce(dt: number): void;
  present(dt: number): void;
  resize(w: number, h: number, dpr: number): void;
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  /** another tab saved settings (the 'storage' event): adopt them without saving again */
  adoptExternalSettings(s: Settings): void;
  toggleGravity(): void;
  toggleMute(): void;
  setMuted(m: boolean): void;
  /** Swap the play body to another genome (atomic; false = construction failed and nothing changed). */
  setGenome(g: Genome, opts?: { itemId?: string | null; nickname?: string | null }): boolean;
  /** SHELL-2b seam (COLLECTION 9.3): show a Hoard item as the live play body; restorePrimary() puts the previous squishy back. */
  focusInstance(item: { genome: Genome; itemId?: string | null; nickname?: string | null }): boolean;
  restorePrimary(): boolean;
  /** SHELL-2b seam (MERGE 7): play the merge ceremony for a result the collection already decided. */
  playMerge(parents: MergeParentView[], result: ItemView & { tierUp: boolean }): Promise<void>;
  /** Resume the AudioContext from a user gesture (call synchronously inside the handler: iOS requirement). */
  unlockAudio(): void;
  /** Page visibility: hidden pauses sim + audio and releases every finger; visible resumes with no dt spike. */
  setHidden(h: boolean): void;
  /** Lifecycle pause by reason (context loss, a covering panel): freezes input, releases fingers, pauses audio. */
  suspend(reason: PauseReason): void;
  unsuspend(reason: PauseReason): void;
  /** Hold input away from the stage while a DOM panel needs it (a reason per caller). */
  holdInput(reason: string, on: boolean): void;
  pause(): void;
  resume(): void;
  /** release every finger, grab, held voice and capsule hold (never throws) */
  releaseEverything(): void;
  on<K extends keyof ShellEvents>(type: K, fn: ShellEvents[K]): () => void;
  /** a callback every sim step (the reveal plate's game-time timer in hudBinding.ts; the sound lab's scripted squelch) */
  onStep(fn: (dt: number, simTime: number) => void): () => void;
  /** dev tools: a callback inside releaseEverything (the sound lab's held voice ends when the tab hides) */
  onRelease(fn: () => void): () => void;
  /** stage.update(dt) with the current frame input, optionally render (DebugHook.step) */
  stageUpdate(dt: number, render: boolean): void;
  onInteraction(cb: () => void): () => void;
  onSettings(cb: (s: Settings) => void): () => void;
  onMute(cb: (muted: boolean) => void): () => void;
  onPhase(cb: (p: Phase) => void): () => void;
  dispose(): void;
}

const report = (e: unknown): void => { console.error(e); };

export function createGame(deps: GameDeps): Game {
  const now = deps.now ?? (() => performance.now());
  const epochNow = deps.epochNow ?? (() => Date.now());
  const env = deps.env ?? detectEnv();
  const storage = deps.storage === undefined ? safeLocalStorage() : deps.storage;
  const profile = deps.profile ?? createProfileStore(storage);
  const instance = profile.profile.instance;

  // ---- listeners ----
  // listener lists are arrays, copied on write: emitting iterates a stable snapshot without allocating one
  const L: { [K in keyof ShellEvents]: Array<ShellEvents[K]> } = {
    interaction: [], settings: [], identity: [], mute: [], phase: [], meter: [],
    capsuleReady: [], message: [], ceremony: [], paused: [], notice: [], gain: [], tool: [], blade: [], cut: [],
  };
  const emit = <K extends keyof ShellEvents>(k: K, ...a: Parameters<ShellEvents[K]>): void => {
    const fs = L[k];
    for (let i = 0; i < fs.length; i++) { try { (fs[i] as (...x: unknown[]) => void)(...a); } catch (e) { report(e); } }
  };
  let stepHooks: Array<(dt: number, t: number) => void> = [];   // an array (copy-on-write): iterating a Set allocates an iterator per frame
  const releaseHooks = new Set<() => void>();

  // ---- modules: construct in dependency order; a failure part-way disposes what was built (audit finding 7) ----
  // the play squishy of the last visit (playHistory.ts), when the collection still has it; else the stored starter
  const history = createPlayHistory(storage);
  const playItem0 = !deps.genome && deps.collection && history.current ? deps.collection.item(history.current) : null;
  const genome0: Genome = deps.genome ?? playItem0?.genome ?? instance.genome;
  const audio = deps.createAudio();
  let stage: StageLike;
  let body0: SoftBodyLike;
  try {
    stage = deps.createStage(deps.canvas as HTMLCanvasElement);
    try { body0 = deps.createBody(genome0); stage.setBody(body0, genome0); }
    catch (e) { try { stage.dispose(); } catch { /* ignore */ } throw e; }
  } catch (e) { try { audio.dispose?.(); } catch { /* ignore */ } throw e; }
  const haptics = deps.haptics ?? createHaptics({ enabled: false });
  try { body0.warmUp?.(); } catch (e) { report(e); }   // pay the physics JIT warm-up while the title card is up (contracts.ts)

  // ---- state ----
  let phase: Phase = 'boot';
  let viewport = { w: 1, h: 1 };
  let simTime = 0;
  let stepCount = 0;
  let lastTs: number | null = null;
  let needsRender = true;
  let fpsEma = 60;
  let muted = !!deps.muted;
  const reasons = new Set<PauseReason>();
  const holds = new Set<string>();
  let pointerNdc: { x: number; y: number } | null = null;
  const frameInput: StageFrameInput = { time: 0, pointerNdc: null };
  const evBuf: SoftEvent[] = [];
  // the debug ring: preallocated, copied into (no allocation per event)
  const RING = TUNING.recentEvents;
  const ring: SoftEvent[] = Array.from({ length: RING }, () => ({ kind: 'poke', at: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, intensity: 0, heldFor: 0, finger: 0 }));
  let ringHead = 0, ringCount = 0;
  const clock = createGestureClock(now);
  const timers = createSimTimers(report);
  const audioPaused = (): boolean => reasons.size > 0;

  let bodies: BodyManager;   // assigned below (the settings controller reads the body lazily)
  const settingsCtl: SettingsController = createSettingsController({
    storage, env, overrides: deps.overrides ?? {}, audio, stage, haptics,
    body: () => bodies.body, muted: () => muted, audioPaused, report, dirty: () => { needsRender = true; },
  });
  const S = (): ResolvedSettings => settingsCtl.settings;

  // ---- the play mat (mat.ts): fingers act on the body a press hits. `active` = that body when it is an extra (null = the play body).
  let active: ExtraBody | null = null;
  const ORIGIN: V3 = { x: 0, y: 0, z: 0 };
  const activeBody = (): SoftBodyLike => (active ? active.body : bodies.body);
  const activeGenome = (): Genome => (active ? active.genome : bodies.identity.genome);
  const host = createBodyHost({ camera: () => stage.camera, body: activeBody, viewport: () => viewport, offset: () => (active ? active.position : ORIGIN) });
  const panOfNdc = (x: number): number => clamp(x * TUNING.panMax, -TUNING.panMax, TUNING.panMax);
  const panOfPoint = (p: V3): number => { const n = host.ndcOf(p); return n ? panOfNdc(n.x) : 0; };

  const driver: Driver = createDriver({
    body: activeBody, stage, simTime: () => simTime, stepCount: () => stepCount, panOfPoint,
    extraSquish: () => S().extraSquish, interact: () => emit('interaction'), dirty: () => { needsRender = true; }, report,
  });
  const gestures: Gestures = createGestures(host, (a) => driver.onAction(a));

  const feedback: Feedback = createFeedback({
    audio, haptics, stage, touch: driver.touch, timers, body: activeBody, genome: activeGenome,
    simTime: () => simTime, stepCount: () => stepCount, gravity: () => S().gravity, panOfPoint, bump: (k) => profile.bump(k), report,
  });

  const nicknameOf = (g: Genome): string | null => (genomeEquals(g, instance.genome) && instance.name !== speciesName(g) ? instance.name : null);
  const labelOf = (id: PlayIdentity): PlayLabel => ({ species: speciesName(id.genome), tier: id.tier, nickname: id.nickname });

  bodies = createBodyManager({
    createBody: deps.createBody, stage, report,
    initial: { body: body0, identity: { genome: genome0, tier: tierOfGenome(genome0), itemId: playItem0 ? playItem0.id : genomeEquals(genome0, instance.genome) ? instance.id : null, nickname: playItem0 ? null : nicknameOf(genome0) } },
    beforeSwap() { releaseEverything(); },
    afterSwap(id, b, silent) {
      if (!focusing && !silent) history.note(id.itemId);   // a card preview is not a switch
      b.gravity = S().gravity;
      stage.setFloatMode(!S().gravity);
      ringCount = 0; ringHead = 0;
      feedback.resetBody();
      driver.touch.resetPull();   // the new body has its own maximum pull (learned again from its snaps)
      needsRender = true;
      if (!silent) emit('identity', id, labelOf(id));
    },
  });
  styleTier(stage, bodies.identity.tier);

  // ---- the collection port, the ceremonies, the capsule table ----
  const hoard: Collection = deps.collection ?? createCollection({ storage, profile: profile.profile, now: epochNow });
  const collection: ShellCollection = adaptCollection(hoard);
  const ceremonies: Ceremonies = createCeremonies({
    stage, audio, haptics, bodies, createBody: deps.createBody, now: () => clock.now(),
    calm: () => S().calm, skipAnimations: () => S().skipAnimations, fastOpen: () => S().fastOpen,
    beforeStart: () => { leaving(); setTool('hand'); try { mat.clear(); } catch (e) { report(e); } },   // a ceremony shows its own bodies
    markSeen: (ids) => { try { collection.markSeen(ids); } catch (e) { report(e); } },
    ui: {
      start: (kind) => emit('ceremony', { type: 'start', kind }),
      reveal: (info) => emit('ceremony', { type: 'reveal', info }),
      end: (info) => { emit('ceremony', { type: 'end', info }); capsules.sync(); queueMicrotask(applyPendingSwitch); },
    },
    report,
  });
  const capsules: Capsules = createCapsules({
    stage, audio, haptics, collection, ceremonies, now: () => clock.now(), calm: () => S().calm,
    bodyContact: () => driver.touch.contact(),
    ui: {
      meter: (m) => emit('meter', m),
      ready: (n) => emit('capsuleReady', n),
      message: (t) => emit('message', t),
    },
    report,
  });
  const offCollection = collection.onChange(() => capsules.sync());

  // ---- the play mat (stage B1)
  const mat: Mat = createMat({
    bodies, stage, createBody: deps.createBody, gravity: () => S().gravity,
    quality: () => { try { return stage.stats().tier; } catch { return 'low'; } },
    frameMs: () => { try { return stage.stats().frameMsEma; } catch { return 0; } },
    beforeChange: () => { releaseEverything(); active = null; },
    report,
  });

  // ---- CUT (cut.ts): the play squishy's pieces; the toy tray's tool
  let tool: Tool = 'hand';
  const cut: Cutter = createCutter({
    bodies, stage, audio, haptics, createBody: deps.createBody,
    quality: () => { try { return stage.stats().tier; } catch { return 'low'; } },
    calm: () => S().calm, gravity: () => S().gravity, simTime: () => simTime, viewport: () => viewport,
    activeBody, touching: () => driver.touch.contact(),
    beforeChange: () => { releaseEverything(); active = null; },
    clearMat: () => { const n = mat.count - 1; try { mat.clear(); } catch (e) { report(e); } return n; },
    panOf: (p) => panOfPoint(p),
    say: (t) => emit('notice', t),
    report,
  });
  /** leaving puts a cut squishy back together at once (CUT.md 2.2: a switch, a card, a ceremony; the body is replaced right after) */
  function leaving(): void {
    releaseEverything();
    try { cut.reconnectAll(false); } catch (e) { report(e); }
  }
  function setTool(t: Tool): void {
    const want: Tool = t === 'cut' && !cut.supported ? 'hand' : t;
    if (want === tool) return;
    releaseEverything();
    if (blade) { blade = null; emit('blade', null); }
    snapDrag.clear();
    tool = want;
    if (tool === 'snap') { try { capsules.putAway(); } catch (e) { report(e); } }   // a clean frame: the capsule comes back after
    else { try { capsules.sync(); } catch (e) { report(e); } }
    needsRender = true;
    emit('tool', tool);
  }
  // the Cut tool's swipe, and Snap's drag-to-orbit (every other gesture is paused while those tools are in hand)
  let blade: { id: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  const snapDrag = new Map<number, { x: number; y: number }>();
  /** a press on the mat: the nearest body under it becomes the one the fingers act on (only between touches) */
  function pickBody(x: number, y: number): void {
    const cam = stage.camera;
    if (!cam) return;
    try { cam.updateMatrixWorld(); } catch { /* a mock camera */ }
    const n = pxToNdc(x, y, viewport);
    const r = cameraRay(cam, n.x, n.y);
    let best: ExtraBody | null = null, bestT = Infinity;
    const h0 = raycastAt(bodies.body, r.origin, r.dir, ORIGIN);
    if (h0) bestT = h0.t;
    for (const xb of bodies.extras) { const h = raycastAt(xb.body, r.origin, r.dir, xb.position); if (h && h.t < bestT) { bestT = h.t; best = xb; } }
    if (bestT === Infinity || best === active) return;   // a miss keeps the last body (an orbit or a pull from the air)
    active = best;
    try { feedback.resetBody(); } catch (e) { report(e); }
  }
  const offEvents = collection.onEvent((e) => { if (e.type === 'notice') emit('notice', e.text); else if (e.type === 'external') capsules.sync(); });

  // ---- visible XP (FUN.md 2, xp.ts): the meter view cached (refreshed on change, so the per-step pending read allocates nothing)
  let meterView: MeterView | null = null;
  const readMeter = (): void => { try { meterView = hoard.meter(); } catch (e) { report(e); meterView = null; } };
  readMeter();
  const offMeterView = hoard.onChange(readMeter);
  const previewTouch = hoard.previewTouch;
  const pending: Pending = createPending({
    preview: typeof previewTouch === 'function' ? (k, h, l) => previewTouch.call(hoard, k, h, l) : null,
    heldFor: (f) => driver.touch.heldFor(f),
    pullFor: (f) => driver.touch.pullFor(f),
    pullLevel: (f) => driver.touch.pull(f),
  });
  const GAIN_KIND: Partial<Record<SoftEvent['kind'], GainKind>> = { poke: 'poke', release: 'squeeze', snap: 'pull' };
  /** a fed touch paid: where it was on the canvas (the event's point, drawn at `off`) */
  function emitGain(ev: SoftEvent, kind: GainKind, sp: number, off: V3): void {
    pending.paid(kind, epochNow());
    let x: number | null = null, y: number | null = null;
    try {
      const cam = stage.camera;
      if (cam) {
        const n = projectToNdc(cam, { x: ev.at.x + off.x, y: ev.at.y + off.y, z: ev.at.z + off.z });
        if (n && Math.abs(n.x) <= 1.2 && Math.abs(n.y) <= 1.2) { x = (n.x + 1) * 0.5 * viewport.w; y = (1 - n.y) * 0.5 * viewport.h; }
      }
    } catch { /* a mock camera */ }
    emit('gain', { kind, sp, x, y });
  }

  // ---------------------------------------------------------------- release / lifecycle
  function releaseEverything(): void {
    try { gestures.cancelAll(clock.now()); } catch (e) { report(e); }
    driver.releaseBody();
    try { feedback.endAll(0.05); } catch (e) { report(e); }
    timers.clear();
    try { haptics.cancel(); } catch (e) { report(e); }
    try { capsules.cancelHold(); } catch (e) { report(e); }
    for (const f of [...releaseHooks]) { try { f(); } catch (e) { report(e); } }
  }

  function setPaused(reason: PauseReason, on: boolean): void {
    if (on === reasons.has(reason)) return;
    const before = reasons.size > 0;
    if (on) reasons.add(reason); else reasons.delete(reason);
    const after = reasons.size > 0;
    if (on) releaseEverything();
    if (before !== after) {
      if (!after) lastTs = null; // no dt spike on the way back
      try { audio.setPaused?.(after); } catch (e) { report(e); }
    }
    settingsCtl.apply();
    emit('paused', [...reasons]);
  }

  // ---------------------------------------------------------------- the simulation step (shared by the rAF loop and DebugHook.step)
  /** drain one body's events. Positions stay in that body's own space (the host maps the ACTIVE body's to the screen; a land on another
   *  mat body pans as if it were the active one: close enough for a thud). Every body's touches feed the meter. */
  function drainBody(b: SoftBodyLike, off: V3): void {
    evBuf.length = 0;
    b.drainEvents(evBuf);
    for (let i = 0; i < evBuf.length; i++) {
      const ev = evBuf[i];
      const r = ring[ringHead];
      r.kind = ev.kind; r.at.x = ev.at.x; r.at.y = ev.at.y; r.at.z = ev.at.z; r.normal.x = ev.normal.x; r.normal.y = ev.normal.y; r.normal.z = ev.normal.z;
      r.intensity = ev.intensity; r.heldFor = ev.heldFor; r.finger = ev.finger;
      ringHead = (ringHead + 1) % RING; if (ringCount < RING) ringCount++;
      // a Shift pull's second hand (driver.touch.mirrorEvent): feedback makes no second sound for it, and it is no touch of its own: the meter,
      // the tasks and the sparks see ONE pull (feeding it paid the pull twice, the second at the 3 percent freshness floor: INPUT_SHIFT report)
      const twin = (ev.kind === 'snap' || ev.kind === 'grab') && b === activeBody() && driver.touch.mirrorEvent(ev.kind, ev.finger);
      feedback.handle(ev, twin);
      if (twin) continue;
      // visible XP: a touch kind is read before and after the feed (only these events: the meter view allocates)
      const kind = GAIN_KIND[ev.kind];
      const before = kind && L.gain.length ? meterView : null;
      try { collection.feed(ev, epochNow()); } catch (e) { report(e); }
      if (before && kind) {
        readMeter();
        const sp = meterView ? gainOf(before, meterView) : 0;
        if (sp > 1e-6) emitGain(ev, kind, sp, off);
      }
    }
  }
  function drain(): void {
    drainBody(bodies.body, ORIGIN);
    const xs = bodies.extras;
    for (let i = 0; i < xs.length; i++) drainBody(xs[i].body, xs[i].position);
    feedback.sweep();
  }

  function simStep(dt: number): void {
    gestures.update(clock.now());
    driver.flushPendingUps();
    if (dt > 0) bodies.step(dt);
    simTime += dt;
    stepCount++;
    driver.notePress();
    drain();
    timers.run(simTime);
    feedback.update(dt);
    try { cut.update(dt); } catch (e) { report(e); }
    capsules.update();
    ceremonies.update();   // a queued ceremony starts once the 1 s burst spacing has passed (flash safety)
    for (let i = 0; i < stepHooks.length; i++) { try { stepHooks[i](dt, simTime); } catch (e) { report(e); } }
  }

  function present(dt: number): void {
    frameInput.time = simTime;
    frameInput.pointerNdc = pointerNdc;
    stage.update(dt, frameInput);
    stage.render();
    needsRender = false;
  }

  function frame(ts: number): void {
    if (reasons.size > 0) { lastTs = null; return; }
    if (clock.paused) {
      if (needsRender) present(0);
      lastTs = null;
      return;
    }
    let dt = 1 / 60;
    if (lastTs !== null) {
      const raw = (ts - lastTs) / 1000;
      dt = clamp(Number.isFinite(raw) ? raw : 1 / 60, 0, TUNING.maxDt);
      if (raw > 0 && raw < 1) fpsEma += (1 / raw - fpsEma) * 0.1;
    }
    lastTs = ts;
    simStep(dt);
    present(dt);
  }

  const loop = createLoop({
    raf: deps.raf ?? ((cb) => requestAnimationFrame(cb)),
    caf: deps.caf ?? ((id) => cancelAnimationFrame(id)),
    frame, fatalAfter: TUNING.consecutiveFrameErrorsFatal, report,
    onFatal(e) {
      // phase first (listeners guarded), then the card, then cleanup: nothing after a broken body may skip the first two
      phase = 'error';
      emit('phase', 'error');
      try { deps.onFatal?.(e); } catch (x) { report(x); }
      try { ceremonies.abort(); } catch (x) { report(x); }
      releaseEverything();
    },
  });

  // ---------------------------------------------------------------- input port
  const inputLive = (): boolean => phase === 'play' && reasons.size === 0 && holds.size === 0 && !ceremonies.active;
  const ndcOf = (x: number, y: number): { x: number; y: number } => ({ x: (x / Math.max(1, viewport.w)) * 2 - 1, y: 1 - (y / Math.max(1, viewport.h)) * 2 });
  /** the Shift flag as the gesture machine's sample field: only a mouse or pen (or an untyped scripted pointer) that holds Shift carries it */
  const shiftOf = (p: PointerIn): { shift?: true } => (p.shift === true && p.type !== 'touch' ? { shift: true } : {});
  const input: InputPort = {
    pointerDown(p) {
      pointerNdc = ndcOf(p.x, p.y);
      if (phase !== 'play' || reasons.size > 0 || holds.size > 0) return;
      if (ceremonies.active) { ceremonies.tapSkip(); return; }
      if (tool === 'cut') { if (!blade && (p.button ?? 0) === 0) { blade = { id: p.id, x0: p.x, y0: p.y, x1: p.x, y1: p.y }; emit('interaction'); emit('blade', { x0: p.x, y0: p.y, x1: p.x, y1: p.y }); } return; }
      if (tool === 'snap') { snapDrag.set(p.id, { x: p.x, y: p.y }); emit('interaction'); return; }
      if ((p.button ?? 0) === 0 && capsules.pointerDown(p.id, p.x, p.y)) { emit('interaction'); return; }
      if (bodies.extras.length && gestures.activeCount() === 0 && !driver.touch.contact()) pickBody(p.x, p.y);
      gestures.pointerDown({ id: p.id, x: p.x, y: p.y, t: clock.eventTime(p.t), button: p.button ?? 0, ...shiftOf(p) });
    },
    pointerMove(p) {
      pointerNdc = ndcOf(p.x, p.y);
      if (phase !== 'play') return;
      if (tool === 'cut') { if (blade && blade.id === p.id) { blade.x1 = p.x; blade.y1 = p.y; emit('blade', { x0: blade.x0, y0: blade.y0, x1: p.x, y1: p.y }); } return; }
      if (tool === 'snap') {
        const q = snapDrag.get(p.id);
        if (!q || !inputLive()) return;
        if (snapDrag.size >= 2) {
          // two fingers: the change of their spread zooms (spread growing = closer)
          let a: { x: number; y: number } | null = null, b: { x: number; y: number } | null = null;
          for (const [id, v] of snapDrag) { if (id === p.id) continue; if (!a) a = v; else if (!b) b = v; }
          if (a) { const d0 = Math.hypot(q.x - a.x, q.y - a.y), d1 = Math.hypot(p.x - a.x, p.y - a.y); driver.onAction({ type: 'zoom', delta: d0 - d1, source: 'pinch' }); }
          void b;
        } else driver.onAction({ type: 'orbit', dx: p.x - q.x, dy: p.y - q.y });
        q.x = p.x; q.y = p.y;
        return;
      }
      if (capsules.pointerMove(p.id, p.x, p.y)) return;
      gestures.pointerMove({ id: p.id, x: p.x, y: p.y, t: clock.eventTime(p.t), ...shiftOf(p) });
    },
    pointerUp(p) {
      if (p.type && p.type !== 'mouse') pointerNdc = null;
      if (phase !== 'play') return;
      if (tool === 'cut') {
        if (!blade || blade.id !== p.id) return;
        const b = blade;
        blade = null;
        emit('blade', null);
        if (!inputLive()) return;
        const r = cut.swipe(b.x0, b.y0, p.x, p.y);
        emit('cut', r);
        return;
      }
      if (tool === 'snap') { snapDrag.delete(p.id); return; }
      if (capsules.pointerUp(p.id)) return;
      gestures.pointerUp({ id: p.id, x: p.x, y: p.y, t: clock.eventTime(p.t), ...shiftOf(p) });
    },
    pointerCancel(id) {
      if (blade && blade.id === id) { blade = null; emit('blade', null); return; }
      if (snapDrag.delete(id)) return;
      if (!capsules.pointerCancel(id)) gestures.pointerCancel(id, clock.now());
    },
    hover(x, y) { pointerNdc = ndcOf(x, y); },
    hoverEnd() { pointerNdc = null; },
    wheel(deltaPx) { if (inputLive()) gestures.wheel(deltaPx); },
    cancelAll() { gestures.cancelAll(clock.now()); capsules.cancelHold(); },
    orbitBy(dx, dy) { if (inputLive()) { emit('interaction'); driver.onAction({ type: 'orbit', dx, dy }); } },
    zoomBy(n) { if (inputLive()) { emit('interaction'); driver.onAction({ type: 'zoom', delta: n, source: 'wheel' }); } },
    screenCentre: () => host.screenCentre(),
    isDown: (id) => gestures.isActive(id),
    skip: () => ceremonies.tapSkip(),
    get live() { return inputLive(); },
  };

  // ---------------------------------------------------------------- body swaps (atomic) and the Hoard seams
  let hiddenAt = 0;
  let focused: { previous: PlayIdentity; previousBody: SoftBodyLike } | null = null;
  let focusing = false;
  let pendingSwitch: string | null = null;
  function switchNow(itemId: string): 'done' | 'missing' | 'failed' {
    const it = hoard.item(itemId);
    if (!it) return 'missing';
    if (focused) { const f = focused; focused = null; void f; }   // a card was open: the switch replaces whatever it previewed
    leaving();
    try { mat.remove(itemId); } catch (e) { report(e); }
    return bodies.swapTo(it.genome, { itemId: it.id, nickname: null }) ? 'done' : 'failed';
  }
  function applyPendingSwitch(): void {
    if (!pendingSwitch || ceremonies.active || ceremonies.pending) return;
    const id = pendingSwitch;
    pendingSwitch = null;
    switchNow(id);
  }
  function setGenome(g: Genome, opts: { itemId?: string | null; nickname?: string | null } = {}): boolean {
    leaving();
    return bodies.swapTo(g, { itemId: opts.itemId ?? (genomeEquals(g, instance.genome) ? instance.id : null), nickname: opts.nickname ?? nicknameOf(g) });
  }

  // ---------------------------------------------------------------- mute / audio unlock
  function setMuted(m: boolean): void {
    if (m === muted) return;
    muted = m;
    settingsCtl.apply();
    emit('mute', muted);
  }

  let audioRunningAt = -1e9;
  let warmed = false;
  function unlockAudio(): void {
    try {
      const t = now();
      // stats() reads (and resets) the analyser peak, so only re-check a context we believe is running about once a second
      if (audio.ready && t - audioRunningAt < 1000) return;
      if (audio.ready && audio.stats().state === 'running') { audioRunningAt = t; return; }
      audioRunningAt = -1e9;
      const p = audio.unlock();
      if (p && typeof p.catch === 'function') p.catch(() => { /* blocked until a real gesture: retried on the next one */ });
      // round-3 extra (not in contracts.ts yet): an engine that offers warmUp() pays its one-time costs now, before the first frame
      const w = (audio as SquishAudio & { warmUp?: () => void }).warmUp;
      if (!warmed && typeof w === 'function') { warmed = true; try { w.call(audio); } catch (e) { report(e); } }
    } catch { /* ignore */ }
  }

  // ---------------------------------------------------------------- the game object
  const game: Game = {
    get stage() { return stage; },
    get audio() { return audio; },
    get haptics() { return haptics; },
    get profile() { return profile; },
    input, host,
    get body() { return bodies.body; },
    get bodies() { return bodies; },
    get settings() { return settingsCtl.settings; },
    get genome() { return bodies.identity.genome; },
    get identity() { return bodies.identity; },
    get label() { return labelOf(bodies.identity); },
    get instance() { return instance; },
    get phase() { return phase; },
    get muted() { return muted; },
    get paused() { return clock.paused; },
    get hidden() { return reasons.has('hidden'); },
    get pauseReasons() { return [...reasons]; },
    get fps() { return fpsEma; },
    get viewport() { return viewport; },
    get collection() { return collection; },
    get hoard() { return hoard; },
    get capsules() { return capsules; },
    get mat() { return mat; },
    pendingFill: () => (phase === 'play' && reasons.size === 0 ? pending.fill(meterView, epochNow()) : 0),
    get tool() { return tool; },
    setTool,
    get cut() { return cut; },
    get pendingSource() { return pending.source; },
    get ceremonies() { return ceremonies; },
    get clock() { return clock; },
    get simTime() { return simTime; },
    epochNow: () => epochNow(),
    recentEvents() {
      const out: SoftEvent[] = [];
      for (let i = 0; i < ringCount; i++) {
        const e = ring[(ringHead - ringCount + i + RING) % RING];
        out.push({ kind: e.kind, at: { ...e.at }, normal: { ...e.normal }, intensity: e.intensity, heldFor: e.heldFor, finger: e.finger });
      }
      return out;
    },
    setPhase(p) {
      if (p === phase) return;
      if (phase === 'play' && p !== 'play') { releaseEverything(); setTool('hand'); }
      phase = p;
      emit('phase', p);
    },
    start() { if (loop.running) return; lastTs = null; loop.start(); },
    stop: () => loop.stop(),
    frame,
    stepOnce(dt) { simStep(dt); },
    present,
    resize(w, h, dpr) {
      viewport = { w: Math.max(1, w), h: Math.max(1, h) };
      stage.resize(viewport.w, viewport.h, dpr);
      needsRender = true;
    },
    setSetting: (k, v) => settingsCtl.set(k, v),
    adoptExternalSettings: (s) => settingsCtl.adoptExternal(s),
    toggleGravity() { settingsCtl.set('gravity', !S().gravity); },
    toggleMute() { setMuted(!muted); },
    setMuted,
    setGenome,
    focusInstance(item) {
      leaving();   // a card preview shows another squishy: the cut one goes back together first (CUT.md 2.2)
      const prev = { previous: bodies.identity, previousBody: bodies.body };
      focusing = true;
      const ok = bodies.swapTo(item.genome, { itemId: item.itemId ?? null, nickname: item.nickname ?? null });
      focusing = false;
      if (!ok) return false;
      if (!focused) focused = prev;
      return true;
    },
    restorePrimary() {
      if (!focused) return false;
      const f = focused;
      focused = null;
      return bodies.swapTo(f.previous.genome, { body: f.previousBody, itemId: f.previous.itemId, nickname: f.previous.nickname });
    },
    playMerge: (parents, result) => ceremonies.playMerge(parents, result),
    get history() { return history; },
    switchTo(itemId) {
      if (!hoard.item(itemId)) return 'missing';
      if (ceremonies.active || ceremonies.pending) { pendingSwitch = itemId; return 'queued'; }
      pendingSwitch = null;
      return switchNow(itemId);
    },
    unlockAudio,
    setHidden(h) {
      if (h && !reasons.has('hidden')) hiddenAt = now();
      if (!h && reasons.has('hidden') && now() - hiddenAt > HIDDEN_RECONNECT_MS) { try { cut.reconnectAll(false); } catch (e) { report(e); } }
      setPaused('hidden', h);
    },
    suspend(r) { setPaused(r, true); },
    unsuspend(r) { setPaused(r, false); },
    holdInput(reason, on) {
      if (on === holds.has(reason)) return;
      if (on) { holds.add(reason); releaseEverything(); } else holds.delete(reason);
    },
    pause() { clock.pause(); },
    resume() { if (!clock.paused) return; clock.resume(); lastTs = null; },
    releaseEverything,
    on(type, fn) {
      const lists = L as { [K in keyof ShellEvents]: unknown[] };
      lists[type] = lists[type].concat(fn);
      return () => { lists[type] = lists[type].filter((f) => f !== fn); };
    },
    onStep(fn) { stepHooks = stepHooks.concat(fn); return () => { stepHooks = stepHooks.filter((f) => f !== fn); }; },
    onRelease(fn) { releaseHooks.add(fn); return () => { releaseHooks.delete(fn); }; },
    stageUpdate(dt, render) {
      frameInput.time = simTime;
      frameInput.pointerNdc = pointerNdc;
      stage.update(dt, frameInput);
      if (render) { stage.render(); needsRender = false; }
    },
    onInteraction(cb) { return game.on('interaction', cb); },
    onSettings(cb) { return game.on('settings', cb); },
    onMute(cb) { return game.on('mute', cb); },
    onPhase(cb) { return game.on('phase', cb); },
    dispose() {
      loop.stop();
      try { ceremonies.abort(); } catch (e) { report(e); }
      releaseEverything();
      try { offCollection(); offEvents(); offMeterView(); capsules.dispose(); collection.flush(); collection.dispose(); } catch (e) { report(e); }
      try { profile.dispose(); } catch (e) { report(e); }
      for (const k of Object.keys(L) as Array<keyof ShellEvents>) L[k] = [];
      stepHooks = []; releaseHooks.clear();
      try { stage.dispose(); } catch { /* ignore */ }
      try { audio.dispose?.(); } catch { /* ignore */ }
    },
  };
  // forward settings changes (after construction, so the first apply does not notify)
  settingsCtl.onChange((s) => { for (const xb of bodies.extras) { try { xb.body.gravity = s.gravity; } catch { /* optional */ } } emit('settings', s); });

  settingsCtl.apply(true);
  capsules.sync();
  return game;
}

export type { SoftMetrics };
