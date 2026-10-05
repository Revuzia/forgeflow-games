// DYEFIELD — the running game: a MatchWorld (the 8-runner sim) + a BotDirector, a fixed 60 Hz step
// and an interpolated render (CONTRACT §2, §5.1, §11).
//
//   * frame(now): accumulate real time, run at most MAX_STEPS_PER_FRAME ticks, drop the rest of the
//     debt, render interpolated between the last two ticks (alpha = acc / TICK).
//   * one tick: the human's intent is intents[0] (Input → camera-relative move + camera yaw/pitch, SHIFT
//     = slick, LMB = the MIST-RASP) with the aim point from a camera ray through the reticle
//     (physics.raycast, 60 m, plus a ray-vs-capsule pick of seen enemies); the BotDirector fills the
//     other seven; MatchWorld.step(intents). The phase-2 DEV_BRUSH is retired from normal play and
//     lives only behind ?dev=1&brush=1.
//   * events drain every frame into fx.ts (splats, muzzle mist, dry puffs, sparks, washed bursts, the
//     tide-spout), players.ts (hit flash, washed pop, respawn drop) and the HUD (kill feed, toasts,
//     death slate, victory slate). The view reads the sim and never writes gameplay.
//   * phase 6 kits (CONTRACT_P6_11 §18.2): 'shot' → the kit's muzzle FX (MIST-RASP mist, SHEET-DRUM flick
//     fan, POP-WELL pop + the blast clip; NEEDLE-GLINT draws its 'beam' instead), 'beam' → the release
//     flash, 'burst' → the blaster rings, 'flick' → the flick clip, 'sub' throw / land / pop → the throw
//     clip, the jelly splat and pop, 'special' ready / start / end → the gauge pop, the special_throw or
//     slam clip, the WELLSPRING take-off splash and the CLOUDBURST dissipate, 'ring' → the WELLSPRING wave.
//     Every frame, each charging NEEDLE-GLINT runner (any crew: the glint is visible to enemies) gets its
//     glint line from the scope to the point its aim ray meets within the charge's range.
//   * pause gates simStep() itself (doctrine §5); window.__PAUSE__ = { pause, resume, toggle }.
//     ESC pauses; losing pointer lock pauses (except after the final horn, when the mouse is freed
//     on purpose for the victory slate's PLAY AGAIN). The pause CARD is the menus' (hooks.paused).
//   * PLAY AGAIN rebuilds the match: painter.reset(), a new MatchWorld + BotDirector over the same
//     PhysicsWorld, NavGraph and views. The PhysicsWorld is kept on purpose: the NavGraph queries it
//     (bots string-pull their paths with sphere casts); the old world's character capsules are removed
//     from it (releaseWorld) so rebuilt matches never pile up colliders.
//   * phase 9 (CONTRACT_P6_11 §20): mode 'lobby' — the same sim with an all-bot roster (a few runners
//     painting at BREEZE, no countdown, a long clock that restarts itself), no input and no HUD; the camera
//     drifts slowly round the court on an ellipse (lobbyCamera) and the menus draw over it. The app phase
//     is 'menu' while it runs. mode 'match' is the phase 3–8 game. dispose() stops the loop and removes
//     every listener so main.ts can swap sessions (lobby ⇄ match, map to map) in one page.
//   * CONTRACT_FFA F3: MatchConfig.mode 'ffa' runs MatchWorld in FREE-FOR-ALL (8 crews of one). The HUD gets the
//     per-crew shares every frame (Painter.coverageByTeam into one reused buffer); the victory slate gets the result's
//     standings (winner / top 3 / everyone, with %); the victory / defeat stinger follows whether the HUMAN won (a draw
//     counts as won when the human is among the tied crews). Teams mode takes none of these branches.
//   * CONTRACT_MOBILE M3 / M4 (input.mode === 'touch'; every branch below is skipped in kbm, so desktop is unchanged):
//     no pointer lock — CLICK TO PLAY (TAP TO PLAY), RESUME and PLAY AGAIN enter play at once (startedBy 'touch'), a
//     lost lock never pauses, and a switch to touch mid-play releases a held lock without pausing. The pause triggers
//     are the overlay's PAUSE button (main.ts → pause()), the page going hidden, pagehide, a window blur (a call, an
//     app switch) and the rotate overlay (main.ts); nothing ever auto-resumes. Each frame: the overlay's visibility
//     (play / paused-behind-card, not after the final horn) and meters, the touch look (Input.takeTouchLook) through
//     the aim assist (touch/aimassist.ts: world.canSee visibility, the human kit's range), haptics on WASHED.
//     The renderer's touch shadow cap (M7) is applied to the sun here.
//   * mobile review fixes (2026-09-29; touch mode only, kbm untouched): A-A6 — the system BACK (Android back / edge swipe,
//     iOS edge swipe) pauses instead of leaving: every play entry by touch pushes one same-document history entry (the
//     "back trap", armBackTrap) and its popstate pauses a live match (a second back from the pause card leaves; RESUME
//     re-arms); leaving the match (QUIT / LOBBY / dispose) drops a leftover entry. Leaving full screen (the first Android
//     back in full screen only exits it) pauses too. A-A10 — the loop renders at most ~60 frames a second on a 90 / 120
//     / 144 Hz phone (the governor budgets 60 fps; the extra frames were heat and battery).
//   * lane C (2026-09-30) — CONTRACT_CONTROLS C1–C3, CONTRACT_WASHOUT W4–W7, CONTRACT_FFA_SPAWNS S3 / S5 (view side only;
//     the sim never sees AIM and every TURF hash is untouched):
//       AIM (C1): aimFrame() → FollowCamera.aimTarget while Input.aiming() (RMB held / toggled, the touch toggle) and the
//       human is alive, on foot and in play; the camera eases zoom (NEEDLE-GLINT the scope zoom) / shoulder / look ×
//       aimSens (the touch look too); hud.setAiming on a change; a wash drops a toggled aim.
//       SPECIAL (C2 / C3): 'special' end → the CLOUDBURST dissipate ONLY for phase 'end' (a 'denied' used to fire it);
//       'denied' (the human) → hud.specialDenied + the touch SPECIAL shake (the audio router ticks); hud.setSpecial per
//       change (fill %, ready, the name, the actual binding).
//       WASHOUT (W): MatchConfig.rule → MatchWorld; hud.setRule(rule, limit) per match, setScores(world.scores()) every
//       WASHOUT frame, scorePop on the human's own 'score', setProtected while its spawn protection runs; the victory
//       slate gets rule + washoutVictory(result, runners).
//       FFA SPAWNS (S3 / S5): 'spawn' → the site's drop-in marker (GameParts.drops, view/mapview.ts) in the runner's crew +
//       a minimap ping; markers hold through the countdown, clear on PLAY AGAIN.
//   * CHANGED(ONLINE) (CONTRACT_ONLINE §O5, §O10, §O12.2): an online match session is the same Game with a GameNet attached
//     (attachNet; net/session.ts). The local runner is Game.me (MatchConfig.localPid; 0 offline — every offline path and
//     hash unchanged). With a net: simStep builds the local intent exactly as offline and hands it to the net (the host
//     steps the real world, a client predicts its own runner on the container world), drainEvents takes the net's events,
//     each frame the net interpolates the remote runners first; there is no pause online (pause() → the online menu card
//     through hooks.netMenu, the local intent neutral while it is up; a lost pointer lock never pauses); the sim runs
//     from 'ready' on (the host's countdown does not wait for a click); a host migration swaps the world (adoptWorld).
//   * CHANGED(STATS) (CONTRACT_STATS §S10.1) + the bot-tier fix: three optional GameHooks — matchBegin (a MATCH world was created:
//     the constructor, and restart() after it builds the next world), simEvents (each frame's drained events, read-only) and
//     matchAbandon (a world discarded before its horn: restart / dispose) — feed the stats facade (stats/index.ts). The
//     BotDirector is now built with botSkills(roster) (a tier per runner id) at BOTH call sites: it used to be built without a
//     skill, so every bot played SWELL whatever BREEZE / SWELL / STORM was picked. __DF__.match() reads back rosterTiers /
//     botTiers. No sim input changes: the node probes build their own directors (and pass the skill), their hashes hold.
//   * review fixes (2026-09-30, view / input only — core and every determinism hash untouched):
//       A-A1 airSpecial(): a SPECIAL press (key tap or touch tap) made in the AIR with a FULL meter is held for the human as
//       a level request until the sim can start it — the landing tick (C2 "mid-air = not yet") — or AIR_SPECIAL_TICKS
//       pass, the meter stops being full, a special starts, the runner dies or leaps. The core's own wait (0.35 s) is
//       shorter than every jump, so a tap before the last 21 air ticks used to lapse silently; bots keep the core rule.
//       The HUD's ready prompt reads "Q  CLOUDBURST · on landing" while it waits.
//       A-A3: a 'denied' press while the human's own special runs (meter 0, the special is active) gives no deny feedback
//       (the core still emits it, per C2); A-A5: setScores also carries the per-crew washed counts (the FFA panel's
//       tie-break); A-A6: HudFrame.endedBy (a limit ending freezes the timer).

import * as THREE from 'three';
import { TICK, MAX_STEPS_PER_FRAME, DEV_BRUSH, COMBAT, CAMERA } from './core/config.ts';
import { CREW_SLOTS, DEG, emptyIntent, type MatchMode, type MatchRule, type PlayerIntent, type TeamId } from './core/types.ts';
import { WEAPONS, crewDef, type MapDef } from './core/data.ts';
import type { MapGeometry } from './core/mapgeo.ts';
import type { PaintAtlas } from './core/paint/atlas.ts';
import type { Painter } from './core/paint/painter.ts';
import type { MinimapRaster } from './core/paint/minimap.ts';
import type { PhysicsWorld, Rapier } from './core/physics.ts';
import { MatchWorld } from './core/match/world.ts';
import type { SimEvent } from './core/match/events.ts';
import { botSkills, type RosterEntry, type BotSkill } from './core/match/roster.ts';
import { BotDirector } from './core/bots/director.ts';
import type { NavGraph } from './core/bots/nav.ts';
import type { Runner } from './core/runner.ts';
import type { RendererRig, RenderQuality } from './view/renderer.ts';
import { AIM, type FollowCamera } from './view/camera.ts';
import type { DropMarkers } from './view/mapview.ts';
import type { SkyRig } from './view/sky.ts';
import type { WaterRig } from './view/water.ts';
import type { PaintTexture } from './view/paintlayer.ts';
import type { DyeUniforms } from './view/surfaces.ts';
import type { MapView } from './view/mapview.ts';
import { kitFireType, type KitFireType, type PlayerViews, type PlayersFrameOpts } from './view/players.ts';
import type { Fx } from './view/fx.ts';
import type { Hud, HudDebug, CrestInfo, DotInfo, HudFrame, FfaVictory } from './ui/hud.ts';
import { washoutVictory, type VictoryInfo } from './ui/slates.ts';
import type { BootUI } from './ui/boot.ts';
import type { Juice, JuiceCtx } from './ui/juice.ts';
import type { AudioFrame, GameAudio, ListenerPose } from './audio/index.ts';
import type { Input } from './input.ts';
import type { TouchControls } from './touch/controls.ts';
import { aimAssist, type AimAssistFoe } from './touch/aimassist.ts';
import type { GameNet } from './net/session.ts';

export type Phase = 'boot' | 'loading' | 'ready' | 'play' | 'paused' | 'menu' | 'error';

/** App-wide status that exists before the Game does (the test surface reads it from boot on). */
export interface AppStatus {
  phase: Phase;
  mapId: string;
  dev: boolean;
  error?: string;
  version: string;
  game: Game | null;
  /** how play was entered: 'pointerlock' (real click) | 'dev-start' (__DF__.start / ?autostart, no lock yet) |
   *  'touch' (CONTRACT_MOBILE M4: TAP TO PLAY / START in touch mode — never a pointer lock) */
  startedBy: 'pointerlock' | 'dev-start' | 'touch' | null;
  lockErrors: number;
  lockSuccesses: number;
}

/** match settings from the query (CONTRACT §11) or the menus: ?kit ?bots ?seed ?matchSeconds (dev) ?autostart */
export interface MatchConfig {
  kit: string;
  skill: BotSkill;
  seed: number;
  /** null = the MatchWorld default (180 s) */
  durationS: number | null;
  humanName?: string;
  /** the human's crew (menus crew choice; default SUNCREW) */
  crew?: TeamId;
  /** ?dev=1&brush=1: LMB is the phase-2 DEV_BRUSH instead of the kit */
  devBrush: boolean;
  /** CONTRACT_FFA F3: 'teams' (default) or 'ffa' (8 crews of one; `crew` is then the human's FFA colour 1..8) */
  mode?: MatchMode;
  /** CONTRACT_WASHOUT W4: 'turf' (default: the most floor wins) or 'washout' (the most credited washes wins) */
  rule?: MatchRule;
  /** CHANGED(ONLINE): the online roster (every member's MatchWorld is built from the same one); offline: unset */
  roster?: RosterEntry[];
  /** CHANGED(ONLINE): the local runner's id (0 offline) */
  localPid?: number;
  /** CHANGED(ONLINE): an online match session (no pause, no PLAY AGAIN restart) */
  online?: boolean;
}

export type GameMode = 'lobby' | 'match';

/** app callbacks (main.ts): the menus, the mannequin pass, the FPS meter */
export interface GameHooks {
  /** show / hide the pause card (msg: e.g. 'Click RESUME again to capture the mouse.') */
  paused?(on: boolean, msg: string): void;
  /** the victory slate's LOBBY button */
  lobby?(): void;
  /** after the world render (the LOADOUT mannequin pass) */
  overlay?(renderer: THREE.WebGLRenderer, dt: number): void;
  /** every frame, after the render (menus' gamepad polling, the FPS meter) */
  frame?(dt: number): void;
  /** the victory slate showed (its element: a focus scope) or hid (null) */
  victory?(el: HTMLElement | null): void;
  /** mouse-look multipliers when the camera has no settings fields of its own */
  look?(): { sens: number; invertY: boolean };
  /** CONTRACT_MOBILE M3: the AIM ASSIST setting (touch mode only; default on) */
  assist?(): boolean;
  /** CHANGED(ONLINE): the online match menu card (ESC / PAUSE / blur / back open it; the match runs on) */
  netMenu?(on: boolean): void;
  /** CHANGED(STATS) (CONTRACT_STATS §S10.1): a MATCH world was created (the constructor, and restart() after it builds the
   *  next world); never for the lobby */
  matchBegin?(w: MatchWorld, cfg: Readonly<MatchConfig>, matchNo: number): void;
  /** CHANGED(STATS): this frame's drained sim events, match sessions only. READ-ONLY: copy what you need, never keep `events` */
  simEvents?(events: readonly SimEvent[], w: MatchWorld): void;
  /** CHANGED(STATS): a match world is being discarded before its horn (dispose: QUIT MATCH / LOBBY / error; restart before the end) */
  matchAbandon?(w: MatchWorld, why: 'dispose' | 'restart'): void;
}

export interface GameParts {
  app: AppStatus;
  def: MapDef;
  canvas: HTMLCanvasElement;
  rig: RendererRig;
  scene: THREE.Scene;
  cam: FollowCamera;
  sky: SkyRig;
  water: WaterRig;
  map: MapView;
  geo: MapGeometry;
  atlas: PaintAtlas;
  painter: Painter;
  minimap: MinimapRaster;
  paint: PaintTexture;
  dye: DyeUniforms;
  R: Rapier;
  physics: PhysicsWorld;
  nav: NavGraph;
  roster: RosterEntry[];
  players: PlayerViews;
  fx: Fx;
  hud: Hud;
  boot: BootUI;
  input: Input;
  config: MatchConfig;
  /** phase 9: 'match' (default) or the lobby's live backdrop */
  mode?: GameMode;
  hooks?: GameHooks;
  /** phase 10 (CONTRACT_P6_11 §21): the page's WebAudio (main.ts creates it once). The lobby only ticks it
   *  (ambience + music); a match routes its drained SimEvents + the listener pose to it every frame. */
  audio?: GameAudio | null;
  /** phase 10: the screen-space juice (hit markers, damage vignette + arc, trauma shake, victory confetti) —
   *  match sessions only. It replaces the HUD's old hit marker / vignette and the legacy cam.shake writes. */
  juice?: Juice | null;
  /** CONTRACT_MOBILE M2: the touch overlay (match sessions; main.ts constructs and disposes it) */
  touch?: TouchControls | null;
  /** CONTRACT_FFA_SPAWNS S3: the drop-in markers of the FFA spawn sites (FFA match sessions; main.ts builds / disposes) */
  drops?: DropMarkers | null;
}

/** player-facing settings the game applies itself */
export interface GameSettings {
  quality: RenderQuality;
}

/** a logged event with the sim tick it was drained on (the __DF__.events(n) read-back) */
export type LoggedEvent = SimEvent & { tick: number };

const EVENT_LOG = 512;
/** the human's runner id offline (CHANGED(ONLINE): Game.me — MatchConfig.localPid online) */
const HUMAN = 0;
/** review fix A-A1: how long the human's mid-air SPECIAL press is held for the landing (1.5 s in whole ticks: longer than
 *  any walk, slog or slick jump — a walk jump is ~0.83 s — and still bounded, so a long fall never fires a stale press) */
export const AIR_SPECIAL_TICKS = Math.round(1.5 / TICK);
/** lobby clock: a long 'match' that restarts itself (fresh paint) */
export const LOBBY_SECONDS = 900;
/** the lobby backdrop is fast-forwarded this far before it shows (runners spread out, some dye down) */
export const LOBBY_WARM_S = 10;
/** the lobby camera's vertical FOV (the match camera's is CAMERA.fovDeg) */
export const LOBBY_FOV = 46;

const numField = (o: unknown, k: string, d: number): number => {
  const v = (o as Record<string, unknown> | undefined)?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : d;
};
/** NEEDLE-GLINT range at charge c (weapons.json fire.minRange / maxRange) */
function chargeRange(kitId: string): [number, number] {
  const fire = WEAPONS.kits.find((k) => k.id === kitId)?.fire;
  return [numField(fire, 'minRange', 12), numField(fire, 'maxRange', 30)];
}
const JELLY_ROW = WEAPONS.subs.find((s) => s.id === 'jelly-charge');
const SUB_COST = numField(JELLY_ROW, 'tankCost', 70);
const SUB_BLAST = numField(JELLY_ROW, 'blastRadius', 3);

/** review A-A10: touch mode renders at most one frame per this interval (60 fps), less a little jitter slack */
export const FRAME_CAP_MS = 1000 / 60;
const FRAME_CAP_SLACK_MS = 2.5;

// ───────────────────────────── review A-A6: the back-button trap (touch) ─────────────────────────────
/** popstate events our own history.back() (dropBackTrap) will cause: ignored, never a pause */
let ignorePops = 0;
let ignoreTimer = 0;
const TRAP = 'match';

/** a live touch match sits on one extra same-document history entry, so the system back pops it (a popstate: pause)
 *  instead of leaving the page. Pushed inside a gesture where possible (Chrome skips entries a page added without one). */
export function armBackTrap(): void {
  try {
    const st = history.state as { df?: string } | null;
    if (st && st.df === TRAP) return;
    history.pushState({ df: TRAP }, '');
  } catch { /* sandboxed / unsupported: back leaves, as before */ }
}

/** leaving the match (QUIT / LOBBY / dispose): step back off a trap entry that is still on top (no extra back press later) */
export function dropBackTrap(): void {
  try {
    const st = history.state as { df?: string } | null;
    if (!st || st.df !== TRAP) return;
    ignorePops++;
    clearTimeout(ignoreTimer);
    ignoreTimer = window.setTimeout(() => { ignorePops = 0; }, 1500);
    history.back();
  } catch { /* unsupported */ }
}

/** CONTRACT_MOBILE M3: a kit's reach for the aim assist (weapons.json fire.maxRange; the roller's flick reach) */
export function kitRange(kitId: string): number {
  const fire = WEAPONS.kits.find((k) => k.id === kitId)?.fire as Record<string, unknown> | undefined;
  const flick = fire?.['flick'] as Record<string, unknown> | undefined;
  return numField(fire, 'maxRange', numField(flick, 'reach', 13));
}

export class Game {
  readonly p: GameParts;
  readonly settings: GameSettings;
  readonly mode: GameMode;
  /** CHANGED(ONLINE): the local human's runner id (0 offline) */
  readonly me: number;
  /** CHANGED(ONLINE): the online session driving this match (null offline) */
  net: GameNet | null = null;
  /** CHANGED(ONLINE): the online menu card is up (the local intent is neutral; the match runs on) */
  netMenuOn = false;
  /** CHANGED(ONLINE), read-back: mean sim ms per tick (EWMA) — the lobby's measures this device's host capacity (hello.simMs) */
  simMs = 0;
  /** CHANGED(ONLINE), dev ?renderfps: render at most every this many ms (0 = every frame); the sim is unaffected */
  renderEveryMs = 0;
  private lastRenderAt = -1e9;
  private readonly netLocal: PlayerIntent = emptyIntent();
  world: MatchWorld;
  director: BotDirector;
  physics: PhysicsWorld;
  tick = 0;
  fps = 0;
  frames = 0;
  matchNo = 1;
  private acc = 0;
  private last = -1;
  private fpsClock = 0;
  private fpsFrames = 0;
  private time = 0;
  private raf = 0;
  private disposed = false;
  /** review A-A10: the touch frame cap's current slot (ms, rAF clock; -1 = none) and the rAFs it skipped */
  private capSlot = -1;
  capSkips = 0;
  private readonly intents: PlayerIntent[] = [];
  private readonly feet = { x: 0, y: 0, z: 0 };
  private readonly focus = new THREE.Vector3();
  private stepping = false;
  private lockReq = 0;
  private lockSeq = 0;
  /** pointer lock was held at some point of this play session (a later loss pauses) */
  private lockedThisPlay = false;
  private readonly offs: Array<() => void> = [];
  // events
  private readonly drained: SimEvent[] = [];
  private readonly log: LoggedEvent[] = [];
  readonly counts: Record<string, number> = {};
  // aim
  private readonly camPos = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private aimOk = false;
  private aim = { x: 0, y: 0, z: 0 };
  // team vision (dots, tags)
  private readonly seen: boolean[] = [];
  private seenClock = 0;
  private readonly crests: CrestInfo[] = [];
  private readonly dots: DotInfo[] = [];
  private readonly hudFrame: HudFrame;
  private readonly seenFn = (id: number): boolean => this.seen[id] === true;
  private readonly frameOpts: PlayersFrameOpts;
  // match end
  private endT = -1;
  private victoryShown = false;
  // dev brush
  private brushClock = 0;
  private brushSplats = 0;
  // phase 6: per-runner kit
  private readonly fireType: KitFireType[] = [];
  private readonly range: Array<[number, number]> = [];
  private readonly v1 = new THREE.Vector3();
  /** dev (harness): freeze the sim AND the visuals, keep rendering (a screenshot of an exact moment) */
  frozen = false;
  /** phases 7–8: runner.launches already splashed (the sim has no launch event; the view watches the counter) */
  private readonly launchSeen: number[] = [];
  // phase 9: the lobby camera drift
  private lobbyT = 0;
  private readonly lobbyTarget = new THREE.Vector3();
  /** the smoothed point the lobby camera circles (the crews' centroid pulled toward mid-court) */
  private readonly lobbyAim = new THREE.Vector3(NaN, 0, 0);
  /** the follow camera's FOV, restored when the lobby session ends (the lobby shoots tighter) */
  private savedFov = 0;
  /** lobby rounds played (each restart repaints the court from clean) */
  lobbyRounds = 0;
  // phase 10: the one ctx object each of juice / audio reads every frame (no per-frame allocation)
  private readonly juiceCtx: JuiceCtx;
  private readonly listener: ListenerPose = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 };
  private readonly audioFrame: AudioFrame;
  /** CONTRACT_FFA F3: the match mode ('teams' for the lobby) */
  readonly matchMode: MatchMode;
  /** FFA: the per-crew coverage shares, refreshed each rendered frame (no per-frame allocation) */
  private readonly shareBuf = new Float64Array(CREW_SLOTS);
  // CONTRACT_MOBILE M3: the aim assist of the last frame (the __DF__.touch() read-back) + its reused inputs
  readonly assist = { slow: 1, dyaw: 0, dpitch: 0, foes: 0, visible: 0 };
  private readonly foeBuf: AimAssistFoe[] = [];
  private readonly assistEye = { x: 0, y: 0, z: 0 };
  private readonly assistRange: number;
  /** M7: the sun's authored shadow-map size (the touch cap never raises it) */
  private shadowBase = 0;
  /** CONTRACT_WASHOUT W1: the match rule ('turf' for the lobby) */
  readonly rule: MatchRule;
  // CONTRACT_CONTROLS C1 / C3 + CONTRACT_WASHOUT W5: the last values handed to the HUD (a call only on a change)
  private hudAiming = false;
  private hudProtected = false;
  private readonly hudSpecial = { pct: -1, ready: false, label: '', key: '', waiting: false };
  /** review fix A-A1: ticks left of the human's mid-air SPECIAL request held for the landing (0 = none) */
  private airHold = 0;
  /** review fix A-A1: the human's raw SPECIAL intent of the previous tick (its rising edge = a press) */
  private rawSpecialPrev = false;
  /** review fix A-A1: read-back — presses held for a landing, and how each hold ended */
  readonly airSpecialStats = { held: 0, started: 0, lapsed: 0, cancelled: 0 };
  /** review fix A-A5: per-crew washed counts for the FFA WASHOUT panel (no per-frame allocation) */
  private readonly washedBuf: number[] = [];
  /** the human's special name (weapons.json), the HUD prompt "Q  CLOUDBURST" */
  private readonly specialName: string;
  /** read-backs: SPECIAL 'denied' events of the human, score pops, drop-in markers shown, minimap pings */
  readonly c3 = { denied: 0, scorePops: 0, markers: 0, pings: 0 };
  /** CONTRACT_FFA_SPAWNS S5: the live minimap pings (DOM) */
  private readonly pingEls = new Set<HTMLElement>();

  constructor(parts: GameParts, settings: Partial<GameSettings> = {}) {
    this.p = parts;
    this.mode = parts.mode ?? 'match';
    this.me = this.mode === 'match' ? (parts.config.localPid ?? HUMAN) : HUMAN;
    this.matchMode = this.mode === 'match' && parts.config.mode === 'ffa' ? 'ffa' : 'teams';
    this.rule = this.mode === 'match' && parts.config.rule === 'washout' ? 'washout' : 'turf';
    this.settings = { quality: settings.quality ?? parts.rig.adaptive().quality };
    this.physics = parts.physics;
    for (let i = 0; i < parts.roster.length; i++) {
      this.intents.push(emptyIntent());
      this.seen.push(this.mode === 'lobby');
      const r = parts.roster[i];
      this.crests.push({ id: r.id, name: r.name, team: r.team, alive: true, respawnIn: 0, special: 0, you: r.id === this.me });
      this.dots.push({ x: 0, z: 0, team: r.team, show: false });
      this.fireType.push(kitFireType(r.kit));
      this.range.push(chargeRange(r.kit));
      this.launchSeen.push(0);
      if (i !== this.me) this.foeBuf.push({ x: 0, y: 0, z: 0, visible: false });
    }
    this.assistRange = kitRange(parts.roster[this.me]?.kit ?? parts.config.kit);
    {
      const kitId = parts.roster[this.me]?.kit ?? parts.config.kit;
      const spId = WEAPONS.kits.find((k) => k.id === kitId)?.special;
      this.specialName = WEAPONS.specials.find((s) => s.id === spId)?.name ?? '';
    }
    this.world = this.makeWorld();
    // CHANGED(STATS-INTEGRATION) (owner decision 6): the director takes each bot's tier from the roster. It was built
    // without a skill, so every bot was SWELL whatever BREEZE / SWELL / STORM was picked.
    this.director = new BotDirector(this.world, parts.nav, parts.config.seed ^ 0x9e3779b9, botSkills(parts.roster));
    if (this.mode === 'match') parts.hooks?.matchBegin?.(this.world, parts.config, this.matchNo);   // CHANGED(STATS) §S10.1
    this.juiceCtx = { me: this.me, runners: this.world.runners, cam: parts.cam };
    this.audioFrame = {
      listener: this.listener, runners: this.world.runners, me: this.me, map: parts.def.id,
      phase: this.world.phase, timeLeft: this.world.timeLeft, countdown: this.world.countdown,
      projectiles: this.world.projectiles, conveyors: parts.geo.features?.conveyors,
    };
    this.frameOpts = {
      alpha: 1, camera: parts.cam.camera, viewerTeam: this.humanTeam, viewerId: this.me, seen: this.seenFn, width: 1, height: 1, winner: null,
      mistRange: this.world.mistRange,
    };
    this.hudFrame = {
      phase: 'countdown', timeLeft: this.world.timeLeft, countdown: this.world.countdown, coverage: { sun: 0, gulf: 0, neutral: 1 },
      tank: 100, hp: 100, alive: true, slick: false, firing: false, x: 0, z: 0, yaw: 0, special: 0,
      crests: this.crests, dots: this.dots, respawnIn: 0, charge: 0, specialReady: false, subReady: false,
    };
    if (this.mode === 'lobby') {                // no input, no pointer lock, no pause API in the lobby
      const c = parts.cam.camera;
      this.savedFov = c.fov;
      c.fov = LOBBY_FOV;
      c.updateProjectionMatrix();
      return;
    }

    const { input, hud, canvas } = parts;
    // C1: NEEDLE-GLINT aims through a scope-like zoom, every other kit the regular one
    parts.cam.aimZoom = this.fireType[this.me] === 'charge' ? AIM.scopeFovMul : AIM.fovMul;
    this.hudMatch();
    this.offs.push(input.onUi((a) => {
      if (a === 'debug') hud.toggleDebug();
    }));
    const onLock = (): void => {
      if (this.disposed) return;
      const locked = document.pointerLockElement === canvas;
      if (locked) {
        this.lockReq = 0;
        parts.app.lockSuccesses++;
        this.lockedThisPlay = true;
        if ((this.phase === 'ready' || this.phase === 'paused') && input.mode !== 'touch') this.enterPlay('pointerlock');
      } else if (this.phase === 'play' && this.lockedThisPlay && !this.matchOver && input.mode !== 'touch' && !this.net) {
        this.pause('pointer lock lost');        // CONTRACT_MOBILE M4: a lost lock never pauses in touch mode; CHANGED(ONLINE): nor online
      }
    };
    const onLockErr = (): void => { if (!this.disposed) this.lockFailed(this.lockReq, 'pointerlockerror'); };
    // a play session entered without the lock (?autostart / __DF__.start): a click on the view captures the mouse
    const onDown = (): void => {
      if (input.mode === 'touch') return;
      if (this.phase === 'play' && !this.matchOver && document.pointerLockElement !== canvas && this.lockReq === 0) this.requestLock();
    };
    document.addEventListener('pointerlockchange', onLock);
    document.addEventListener('pointerlockerror', onLockErr);
    canvas.addEventListener('mousedown', onDown);
    this.offs.push(() => {
      document.removeEventListener('pointerlockchange', onLock);
      document.removeEventListener('pointerlockerror', onLockErr);
      canvas.removeEventListener('mousedown', onDown);
    });
    // CONTRACT_MOBILE M4 pause triggers in touch mode: hidden page, pagehide, window blur (a call / an app switch).
    // The rotate overlay and the PAUSE button come in through pause() from main.ts. Nothing ever auto-resumes.
    const touchPause = (why: string): void => {
      if (this.disposed || input.mode !== 'touch') return;
      if (this.phase === 'play' && !this.matchOver) this.pause(why);
    };
    const onHidden = (): void => { if (document.visibilityState === 'hidden') touchPause('hidden'); };
    const onPageHide = (): void => touchPause('pagehide');
    const onBlur = (): void => touchPause('blur');
    // review A-A6: the system BACK pops the trap entry (armBackTrap) — pause, never leave; leaving full screen (Android's
    // first back in full screen only exits it) pauses as well. No re-push here: a second back from the card leaves.
    const onPop = (): void => {
      if (ignorePops > 0) { ignorePops--; return; }
      touchPause('back');
    };
    const onFullscreen = (): void => { if (!document.fullscreenElement) touchPause('fullscreen exit'); };
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('blur', onBlur);
    window.addEventListener('popstate', onPop);
    document.addEventListener('fullscreenchange', onFullscreen);
    this.offs.push(() => {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('fullscreenchange', onFullscreen);
    });
    // a hybrid device switched to touch mid-play: free a held pointer lock WITHOUT pausing (the loss is expected)
    this.offs.push(input.onMode((m) => {
      if (this.disposed || m !== 'touch') return;
      this.lockReq = 0;
      this.lockedThisPlay = false;
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }));
    const api = {
      pause: () => this.pause('api'),
      resume: () => this.resume(),
      toggle: () => (this.phase === 'paused' ? this.resume() : this.pause('api')),
    };
    (window as unknown as { __PAUSE__: unknown }).__PAUSE__ = api;
    this.offs.push(() => {
      const w = window as unknown as { __PAUSE__?: unknown };
      if (w.__PAUSE__ === api) delete w.__PAUSE__;
    });
  }

  get phase(): Phase { return this.p.app.phase; }
  private set phase(v: Phase) { this.p.app.phase = v; }
  get matchOver(): boolean { return this.world.phase === 'ended'; }
  get human(): Runner { return this.world.runners[this.me]; }
  get humanTeam(): TeamId { return this.p.roster[this.me]?.team ?? 1; }
  get isLobby(): boolean { return this.mode === 'lobby'; }
  /** the sim advances: a match in play, or the lobby behind the menus */
  private get running(): boolean {
    if (this.mode === 'lobby') return this.phase === 'menu';
    if (this.net) return this.phase === 'play' || this.phase === 'ready' || this.phase === 'paused';   // CHANGED(ONLINE)
    return this.phase === 'play';
  }

  /** CHANGED(ONLINE): run this match through an online session (net/session.ts) */
  attachNet(net: GameNet): void {
    this.net = net;
    if (net.world !== this.world) this.adoptWorld(net.world);
  }

  /** CHANGED(ONLINE): a host migration rebuilt the world (§O6.3): the views, juice and audio read the new runners. The
   *  painter, the court and the views are kept (never restart(): it resets the painter). */
  adoptWorld(w: MatchWorld): void {
    if (w === this.world) return;
    this.world = w;
    this.juiceCtx.runners = w.runners;
    this.audioFrame.runners = w.runners;
    this.audioFrame.projectiles = w.projectiles;
  }

  private makeWorld(): MatchWorld {
    const p = this.p;
    const lobby = this.mode === 'lobby';
    const dur = lobby ? LOBBY_SECONDS : p.config.durationS;
    return new MatchWorld({
      def: p.def, geo: p.geo, physics: this.physics, painter: p.painter, roster: p.roster,
      seed: p.config.seed + (lobby ? this.lobbyRounds * 7919 : 0),
      ...(dur ? { durationS: dur } : {}), ...(lobby ? { countdownS: 0 } : {}),
      ...(this.matchMode === 'ffa' ? { mode: 'ffa' as const } : {}),
      ...(this.rule === 'washout' ? { rule: 'washout' as const } : {}),     // CONTRACT_WASHOUT W1 (TURF: the option unset)
    });
  }

  /** a match (re)starts: the HUD learns the rule + the map's limit; the per-change HUD values are re-sent
   *  (CONTRACT_WASHOUT W5 + CONTRACT_CONTROLS C1 / C3: ui/hud.ts setRule / setScores / setAiming / setProtected) */
  private hudMatch(): void {
    if (this.mode !== 'match') return;
    const hud = this.p.hud;
    hud.setRule(this.rule, this.world.limit);
    if (this.rule === 'washout') hud.setScores(this.world.scores());
    this.hudAiming = false;
    hud.setAiming(false);
    this.hudProtected = false;
    hud.setProtected(false);
    this.hudSpecial.pct = -1;
  }

  /** remove the runners' capsules of a world we are discarding from the kept PhysicsWorld */
  private releaseWorld(w: MatchWorld): void {
    const pw = this.physics;
    for (const r of w.runners) {
      const b = r.body as unknown as { dispose?: (world: unknown) => void };
      try { b.dispose?.(pw.world); } catch { /* already gone */ }
    }
  }

  /**
   * Lobby: fast-forward the backdrop `seconds` of sim (behind the loading card), so the court is already
   * alive when the menus appear. The events of the skipped time are dropped (no FX burst on frame 1).
   * Returns the ms it took.
   */
  warm(seconds = LOBBY_WARM_S): number {
    if (this.mode !== 'lobby') return 0;
    const t0 = performance.now();
    const n = Math.max(0, Math.round(seconds / TICK));
    for (let i = 0; i < n && this.world.phase !== 'ended'; i++) {
      this.director.think(this.intents);
      this.world.step(this.intents);
      this.tick++;
    }
    this.world.drainEvents(this.drained);
    this.drained.length = 0;
    this.p.players.reset();
    return performance.now() - t0;
  }

  /** start the render loop (the scene renders behind the CLICK TO PLAY card) */
  run(): void {
    const loop = (now: number): void => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      if (this.frameCapped(now)) return;
      try {
        this.frame(now);
      } catch (e) {
        cancelAnimationFrame(this.raf);
        this.fail(e);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  /**
   * Review A-A10: in touch mode the loop renders at most ~60 frames a second — a 90 / 120 / 144 Hz phone runs rAF at the
   * panel rate, and every extra frame is GPU heat and battery the governor (60 fps target) never asked for. A leaky
   * bucket: a frame renders once FRAME_CAP_MS (less the jitter slack) has passed since the last slot, and the slot
   * advances by exactly one interval (so 90 Hz renders 2 of 3 frames, 120 Hz every other one: 60 on average); a stall
   * resyncs. The sim is time-accumulated, so a skipped rAF loses nothing. kbm: every rAF renders, as before.
   */
  private frameCapped(now: number): boolean {
    if (this.p.input.mode !== 'touch') { this.capSlot = -1; return false; }
    if (this.capSlot < 0 || now - this.capSlot > FRAME_CAP_MS * 4) { this.capSlot = now; return false; }
    if (now - this.capSlot < FRAME_CAP_MS - FRAME_CAP_SLACK_MS) { this.capSkips++; return true; }
    this.capSlot += FRAME_CAP_MS;
    if (now - this.capSlot > FRAME_CAP_MS) this.capSlot = now;
    return false;
  }

  /** stop the loop, drop every listener and the world's capsules (the session is being replaced) */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const f of this.offs) { try { f(); } catch { /* ignore */ } }
    this.offs.length = 0;
    if (this.mode === 'match') dropBackTrap();   // A-A6: QUIT / LOBBY — no stale trap entry under the lobby
    if (this.mode === 'match' && this.world.phase !== 'ended') this.p.hooks?.matchAbandon?.(this.world, 'dispose');   // CHANGED(STATS) §S10.1
    this.releaseWorld(this.world);
    if (this.victoryShown) this.p.hooks?.victory?.(null);
    if (this.mode === 'lobby' && this.savedFov > 0) {
      const c = this.p.cam.camera;
      c.fov = this.savedFov;
      c.updateProjectionMatrix();
    }
    if (this.mode === 'match') {
      this.p.input.live = false;
      this.p.input.releaseAll();
      this.p.audio?.setPaused(false);             // QUIT MATCH from the pause card: the lobby must not stay muted
      this.p.cam.clearAim();                      // C1: the next session's camera starts unzoomed
      this.clearPings();
    }
  }

  fail(e: unknown): void {
    const msg = e instanceof Error ? (e.stack || e.message) : String(e);
    this.p.app.phase = 'error';
    this.p.app.error = msg;
    this.p.input.live = false;
    this.p.hud.show(false);
    this.p.audio?.setPaused(true);
    this.p.hooks?.paused?.(false, '');
    this.p.boot.error('The match stopped', msg);
    console.error('[dyefield] frame error:', e);
  }

  /** CLICK TO PLAY: ask for pointer lock; play begins on pointerlockchange. Touch mode (TAP TO PLAY): play at once. */
  requestPlay(): void {
    if (this.mode === 'lobby' || this.disposed) return;
    if (this.phase !== 'ready' && this.phase !== 'paused') return;
    if (this.p.input.mode === 'touch') { this.enterPlay('touch'); return; }
    if (document.pointerLockElement === this.p.canvas) { this.enterPlay('pointerlock'); return; }
    this.requestLock();
  }

  /**
   * CONTRACT_MOBILE M4: the menus' START in touch mode goes straight to the countdown (no pointer lock exists there).
   * False outside touch mode or when the match is not ready (main then shows the play card).
   */
  beginTouch(): boolean {
    if (this.mode === 'lobby' || this.disposed || this.phase !== 'ready' || this.p.input.mode !== 'touch') return false;
    this.enterPlay('touch');
    return true;
  }

  private requestLock(): void {
    const c = this.p.canvas;
    const id = ++this.lockSeq;
    this.lockReq = id;
    try {
      const r = c.requestPointerLock({ unadjustedMovement: false } as PointerLockOptions) as unknown;
      if (r && typeof (r as Promise<void>).then === 'function') {
        (r as Promise<void>).then(() => undefined, (err: unknown) => this.lockFailed(id, err instanceof Error ? err.message : String(err)));
      }
    } catch (err) {
      this.lockFailed(id, err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * One refused request counts once (Chrome reports the same refusal twice: the promise rejects AND
   * a pointerlockerror fires). Doctrine §6: 2+ refusals with zero successful locks ever → tell the
   * player ("MOUSE CAPTURE BLOCKED"), while a click on that card still retries.
   */
  private lockFailed(id: number, why: string): void {
    if (id === 0 || id !== this.lockReq) return;
    this.lockReq = 0;
    const app = this.p.app;
    app.lockErrors++;
    console.warn(`[dyefield] pointer lock refused (${app.lockErrors}): ${why}`);
    if (app.lockErrors >= 2 && app.lockSuccesses === 0 && (this.phase === 'ready' || this.phase === 'paused')) {
      this.p.boot.showBlocked(() => this.requestPlay());
      this.p.hooks?.paused?.(false, '');
    } else if (this.phase === 'paused') {
      this.p.hooks?.paused?.(true, 'Click RESUME again to capture the mouse.');
    }
  }

  /** Settings hook: render quality 'auto' (adaptive resolution) · 'high' (DPR cap) · 'low' (floor). */
  setQuality(q: RenderQuality): void {
    this.settings.quality = q;
    this.p.rig.setQuality(q);
    if (this.phase === 'play') this.p.rig.graceFor(2);
  }

  /** dev (__DF__.start) / ?autostart=1: enter play without pointer lock (a click on the view captures it later) */
  devStart(): void {
    if (this.mode === 'lobby') return;
    if (this.phase === 'ready' || this.phase === 'paused') this.enterPlay('dev-start');
  }

  /**
   * The menus' START: the click already asked for pointer lock (a user gesture) while the arena loaded.
   * Locked now → straight into the countdown; otherwise false (main shows CLICK TO PLAY).
   */
  beginWithLock(): boolean {
    if (this.mode === 'lobby' || this.phase !== 'ready') return false;
    if (document.pointerLockElement !== this.p.canvas) return false;
    this.lockedThisPlay = true;
    this.enterPlay('pointerlock');
    return true;
  }

  private enterPlay(by: 'pointerlock' | 'dev-start' | 'touch'): void {
    this.p.app.startedBy = by;
    if (by === 'dev-start') this.lockedThisPlay = document.pointerLockElement === this.p.canvas;
    else if (by === 'touch') { this.lockedThisPlay = false; this.lockReq = 0; armBackTrap(); }   // A-A6 (TAP TO PLAY / RESUME are gestures)
    this.acc = 0;
    this.last = -1;
    this.p.input.releaseAll();
    this.p.input.live = true;
    this.phase = 'play';
    this.p.rig.graceFor(2);                       // never rescale in the first 2 s of play
    this.p.boot.hide();
    this.p.audio?.setPaused(false);
    this.p.hooks?.paused?.(false, '');
    this.p.hud.show(true);
    this.p.canvas.focus({ preventScroll: true });
  }

  pause(reason = 'api'): void {
    if (this.mode === 'lobby' || this.phase !== 'play') return;
    if (this.net) { this.netMenu(true); return; }           // CHANGED(ONLINE): no pause online (§O10)
    this.phase = 'paused';
    this.acc = 0;
    this.p.input.live = false;
    this.p.input.releaseAll();
    this.p.audio?.setPaused(true);                // world sounds + loops silent, music at 40 %; UI sounds stay
    // ESC in a pointer-locked page arrives as a lock loss (the browser eats the key): the same plain pause card
    this.p.hooks?.paused?.(true, '');
    if (document.pointerLockElement === this.p.canvas) document.exitPointerLock();
  }

  /** CHANGED(ONLINE): the online menu card up / down — the match runs on; the local intent is neutral while it is up */
  netMenu(on: boolean): void {
    if (on === this.netMenuOn) return;
    this.netMenuOn = on;
    this.p.input.live = !on;
    this.p.input.releaseAll();
    if (on && document.pointerLockElement === this.p.canvas) document.exitPointerLock();
    this.p.hooks?.netMenu?.(on);
    if (!on && this.phase === 'play' && this.p.input.mode !== 'touch' && document.pointerLockElement !== this.p.canvas) this.requestLock();
  }

  resume(): void {
    if (this.net && this.netMenuOn) { this.netMenu(false); return; }   // CHANGED(ONLINE)
    if (this.phase !== 'paused') return;
    // CONTRACT_MOBILE M4: RESUME in touch mode is the tap itself (no lock); a touch-started match resumed with the
    // mouse (a hybrid device switched back) asks for the lock like a CLICK TO PLAY
    if (this.p.input.mode === 'touch') { this.enterPlay('touch'); return; }
    const by = this.p.app.startedBy;
    if (by === 'pointerlock' || by === 'touch') this.requestPlay();
    else this.enterPlay('dev-start');
  }

  /** PLAY AGAIN: a fresh match on the same map (the lobby restarts its own round the same way). */
  restart(): void {
    if (this.net && this.mode === 'match') return;          // CHANGED(ONLINE): a rematch is a new online session
    const p = this.p;
    p.painter.reset();
    p.paint.rebuildAll();
    p.minimap.rebuild();
    if (this.mode === 'match' && this.world.phase !== 'ended') p.hooks?.matchAbandon?.(this.world, 'restart');   // CHANGED(STATS) §S10.1
    this.releaseWorld(this.world);
    if (this.mode === 'lobby') this.lobbyRounds++;
    this.world = this.makeWorld();
    this.juiceCtx.runners = this.world.runners;
    this.audioFrame.runners = this.world.runners;
    this.audioFrame.projectiles = this.world.projectiles;
    p.juice?.reset();
    this.director = new BotDirector(this.world, p.nav, (p.config.seed + this.matchNo * 7919) ^ 0x9e3779b9, botSkills(p.roster));   // CHANGED(STATS-INTEGRATION): the roster's tiers
    this.matchNo++;
    if (this.mode === 'match') p.hooks?.matchBegin?.(this.world, p.config, this.matchNo);   // CHANGED(STATS) §S10.1
    this.tick = 0;
    this.acc = 0;
    this.endT = -1;
    if (this.victoryShown) p.hooks?.victory?.(null);
    this.victoryShown = false;
    this.drained.length = 0;
    for (const k of Object.keys(this.counts)) delete this.counts[k];
    this.launchSeen.fill(0);
    for (const it of this.intents) Object.assign(it, emptyIntent());
    this.airHold = 0;
    this.rawSpecialPrev = false;
    p.players.reset();
    p.fx.clear();
    p.hud.reset();
    if (this.mode === 'lobby') return;
    p.drops?.clear();                               // S3: no marker survives into the next match
    this.clearPings();
    this.hudMatch();
    const h = this.human;
    p.cam.reset(h.yaw);
    this.feet.x = h.x; this.feet.y = h.y; this.feet.z = h.z;
    p.cam.update(0, this.feet, this.physics);
    if (this.phase === 'play') {
      p.input.releaseAll();
      p.input.live = true;
      if (document.pointerLockElement !== p.canvas && p.input.mode !== 'touch') this.requestLock();
    }
  }

  // ───────────────────────────── the sim tick ─────────────────────────────
  /** One fixed sim tick — gated: nothing advances unless the game is in play (or the lobby runs). */
  simStep(): boolean {
    if (!this.running || this.stepping) return false;
    this.stepping = true;
    if (this.net) {
      // CHANGED(ONLINE): the local intent exactly as offline (neutral before play / with the menu card up), then the net
      try {
        const { input, cam } = this.p;
        const me = this.netLocal;
        if (this.phase === 'play' && !this.netMenuOn) {
          input.intent(cam.yaw, cam.pitch, me);
          this.airSpecial(me);
          me.hasAim = this.aimOk;
          me.aimX = this.aim.x; me.aimY = this.aim.y; me.aimZ = this.aim.z;
        } else {
          me.moveX = 0; me.moveZ = 0; me.jump = false; me.fire = false; me.slick = false; me.sub = false; me.special = false;
          me.yaw = cam.yaw; me.pitch = cam.pitch;
        }
        const t0 = performance.now();
        if (this.net.tick(this.intents, me, t0)) this.tick++;
        this.simMs += (performance.now() - t0 - this.simMs) * 0.05;
      } finally {
        this.stepping = false;
      }
      return true;
    }
    const tSim = performance.now();
    try {
      const { input, cam, config } = this.p;
      const me = this.intents[this.me];
      let brush = false;
      if (this.mode === 'match') {
        input.intent(cam.yaw, cam.pitch, me);
        this.airSpecial(me);
        me.hasAim = this.aimOk;
        me.aimX = this.aim.x; me.aimY = this.aim.y; me.aimZ = this.aim.z;
        brush = config.devBrush && me.fire;
        if (config.devBrush) me.fire = false;
      }
      this.director.think(this.intents);
      this.world.step(this.intents);
      if (brush) this.devBrushStep();
      this.tick++;
    } finally {
      this.stepping = false;
    }
    this.simMs += (performance.now() - tSim - this.simMs) * 0.05;   // CHANGED(ONLINE) read-back (no effect on the sim)
    return true;
  }

  /**
   * Review fix A-A1 (CONTRACT_CONTROLS C2 "mid-air is a not-yet state"): the human's SPECIAL press made in the air with a
   * full meter is held as a level request (intent.special stays true) until the sim can answer it. The core starts a held
   * request on the first tick the runner is on a surface — the landing tick — exactly as for a key held through the
   * landing; its own 0.35 s press wait is shorter than a walk jump (~0.8 s), so a tap at or before the apex used to lapse
   * with no start and no deny. The hold ends when a special starts, the meter is no longer full, the runner dies or
   * leaps, the match leaves 'live', or AIR_SPECIAL_TICKS pass (a long fall never fires a stale press). Input layer only:
   * the sim's rules, the bots and every determinism hash are unchanged. Call right after Input.intent() each tick.
   */
  private airSpecial(it: PlayerIntent): void {
    const raw = !!it.special;
    const pressed = raw && !this.rawSpecialPrev;
    this.rawSpecialPrev = raw;
    const h = this.human;
    const full = h.specialReady && h.special >= 1;
    const free = this.world.phase === 'live' && h.alive && !h.leaping && h.specialActive === '' && full;
    if (pressed && free && !h.grounded && h.state !== 'wallslick') {
      if (this.airHold === 0) this.airSpecialStats.held++;
      this.airHold = AIR_SPECIAL_TICKS;
    }
    if (this.airHold <= 0) return;
    if (h.specialActive !== '') { this.airHold = 0; this.airSpecialStats.started++; return; }
    if (!free) { this.airHold = 0; this.airSpecialStats.cancelled++; return; }
    it.special = true;
    if (--this.airHold === 0) this.airSpecialStats.lapsed++;
  }

  /** ?dev=1&brush=1 — the phase-2 DEV_BRUSH (a splat under the feet at DEV_BRUSH.perSecond) */
  private devBrushStep(): void {
    const h = this.human;
    if (!h.alive || this.world.phase !== 'live') return;
    this.brushClock -= TICK;
    if (this.brushClock > 1e-9) return;
    this.brushClock += 1 / DEV_BRUSH.perSecond;
    this.brushSplats++;
    this.p.painter.splat(h.x, h.y, h.z, {
      radius: DEV_BRUSH.radius, team: h.team, nx: 0, ny: 1, nz: 0, minFacing: DEV_BRUSH.minFacing,
      seed: (this.brushSplats * 2654435761) >>> 0,
    });
  }

  /** the reticle's world point: a camera ray (60 m) against the map, then against seen enemy capsules */
  private updateAim(): void {
    const cam = this.p.cam;
    this.camPos.setFromMatrixPosition(cam.camera.matrixWorld);
    cam.forward(this.camDir);
    const o = this.camPos, d = this.camDir;
    let best = 60;
    const hit = this.physics.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 60);
    if (hit) best = hit.toi;
    // enemy capsules (vertical cylinder r 0.42, 1.2 m tall) the crew can see
    const me = this.human;
    for (const r of this.world.runners) {
      if (r.team === me.team || !r.alive || !this.seen[r.id]) continue;
      const t = rayCylinder(o.x, o.y, o.z, d.x, d.y, d.z, r.x, r.y, r.z, 0.42, r.slickForm ? 0.5 : 1.2);
      if (t > 0 && t < best) best = t;
    }
    // ignore hits between the camera and the runner (a pulled-in boom can graze a rail)
    const toRunner = cam.boom * 0.9;
    if (best < toRunner) best = 60;
    this.aim.x = o.x + d.x * best; this.aim.y = o.y + d.y * best; this.aim.z = o.z + d.z * best;
    this.aimOk = true;
  }

  /** mouse look with the settings (the camera applies them itself when it has the fields) */
  private look(dx: number, dy: number): void {
    const cam = this.p.cam as FollowCamera & { sensitivityScale?: number };
    if (typeof cam.sensitivityScale === 'number') { cam.addMouse(dx, dy); return; }
    const l = this.p.hooks?.look?.();
    const s = l ? l.sens : 1;
    cam.addMouse(dx * s, dy * s * (l?.invertY ? -1 : 1));
  }

  frame(now: number): void {
    const p = this.p;
    const rawMs = this.last < 0 ? 0 : now - this.last;
    let dt = this.last < 0 ? 1 / 60 : rawMs / 1000;
    this.last = now;
    p.rig.frameTime(rawMs, this.phase === 'play');
    if (!(dt >= 0)) dt = 0;
    dt = Math.min(dt, 0.25);
    this.frames++;
    this.fpsFrames++;
    this.fpsClock += dt;
    if (this.fpsClock >= 0.5) { this.fps = this.fpsFrames / this.fpsClock; this.fpsFrames = 0; this.fpsClock = 0; }

    const playing = this.running && !this.frozen;
    if (playing) {
      if (this.mode === 'match') {
        const m = p.input.takeMouse();
        if (!this.matchOver) this.look(m.dx, m.dy);
        this.touchLook(dt);
        this.updateAim();
      }
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < MAX_STEPS_PER_FRAME) {
        this.simStep();
        this.acc -= TICK;
        steps++;
      }
      if (this.acc >= TICK) this.acc %= TICK;      // drop the excess debt
    } else if (!this.frozen) {
      this.acc = 0;
      if (this.mode === 'match') { p.input.takeMouse(); p.input.takeTouchLook(); }
    }
    if (this.net) this.net.frame(dt, now);                  // CHANGED(ONLINE): remote runners + the events due
    this.drainEvents();
    this.springLaunches();
    // visuals (water, dye sparkle, idle animation) stay alive behind the CLICK TO PLAY card and
    // freeze with the sim while paused
    const vdt = this.phase === 'paused' || this.phase === 'error' || this.frozen ? 0 : dt;
    this.time += vdt;
    const alpha = playing || this.frozen ? Math.min(1, this.acc / TICK) : 1;
    this.matchFlow(vdt);
    this.aimFrame();
    this.touchFrame();
    // CHANGED(ONLINE): the local runner's visual error offset around the render; ?renderfps (dev) throttles the render
    // only (sim and net run every frame) for multi-client browser tests
    if (this.renderEveryMs <= 0 || now - this.lastRenderAt >= this.renderEveryMs) {
      this.lastRenderAt = now;
      this.net?.shift(1);
      this.render(vdt, alpha);
      this.net?.shift(-1);
    }
    this.sound(vdt);
    p.hooks?.frame?.(dt);
  }

  // ───────────────────────────── CONTRACT_MOBILE: touch ─────────────────────────────
  /**
   * M2: the overlay shows only in touch mode while the match is in play or paused behind the pause card (never
   * before TAP TO PLAY, never after the final horn: the victory slate's buttons need the taps); its meters follow the
   * human every frame (setMeters writes the DOM only on a change).
   */
  private touchFrame(): void {
    const tc = this.p.touch;
    if (!tc || this.mode !== 'match') return;
    const on = this.p.input.mode === 'touch' && (this.phase === 'play' || this.phase === 'paused') && this.world.phase !== 'ended';
    tc.setVisible(on);
    if (!on) return;
    const me = this.human;
    tc.setMeters({
      specialFrac: me.special,
      specialReady: me.alive && me.specialReady && me.specialActive === '',
      subReady: me.alive && me.tank >= SUB_COST && me.subCooldown <= 0,
    });
    tc.setAim(this.p.input.touch.aim);              // C1: the AIM toggle's light follows its real state
  }

  /**
   * CONTRACT_CONTROLS C1: AIM → the camera (view only). Wanted (Input.aiming: RMB held / toggled, the touch toggle) AND
   * allowed — in play, the human alive and on foot (a slick keeps its own tuck framing; a wash drops a toggle) — sets the
   * camera's aimTarget (it eases zoom / shoulder / look over 0.15 s); hud.setAiming follows on a change.
   */
  private aimFrame(): void {
    if (this.mode !== 'match') return;
    const cam = this.p.cam;
    const me = this.human;
    const on = this.phase === 'play' && !this.matchOver && !this.frozen && me.alive && !me.slickForm && this.p.input.aiming();
    cam.aimTarget = on ? 1 : 0;
    if (on !== this.hudAiming) { this.hudAiming = on; this.p.hud.setAiming(on); }
  }

  // ───────────────────────────── CONTRACT_FFA_SPAWNS S5: the minimap ping ─────────────────────────────
  /**
   * A brief ping on the HUD minimap where a drop-in marker lands (every 'spawn' event, FFA). Drawn beside the HUD's own
   * dots (a DOM ring in the crew colour, placed with the minimap raster's worldToPixel — the FFA minimap is north-up, never
   * turned), ~0.9 s, then removed. Reduce motion: it fades without the grow.
   */
  private pingMinimap(x: number, z: number, crew: TeamId): void {
    const canvas = document.getElementById('df-minimap') as HTMLCanvasElement | null;
    const view = canvas?.parentElement;
    if (!canvas || !view || !canvas.width || !canvas.height) return;
    const [px, py] = this.p.minimap.worldToPixel(x, z);
    const sx = (view.clientWidth || canvas.clientWidth) / canvas.width;
    const sy = (view.clientHeight || canvas.clientHeight) / canvas.height;
    let c = '#fff8ec';
    try { c = crewDef('ffa', crew).ui; } catch { /* unknown crew: cream */ }
    const e = document.createElement('i');
    e.className = 'df-mini-ping';
    e.setAttribute('aria-hidden', 'true');
    const d = 12;
    Object.assign(e.style, {
      position: 'absolute', left: `${(px * sx - d / 2).toFixed(1)}px`, top: `${(py * sy - d / 2).toFixed(1)}px`,
      width: `${d}px`, height: `${d}px`, borderRadius: '50%', boxSizing: 'border-box',
      border: `2.5px solid ${c}`, boxShadow: `0 0 6px ${c}`, pointerEvents: 'none', zIndex: '3',
    });
    const host = view.querySelector<HTMLElement>('.df-mini-dots') ?? view;
    host.append(e);
    this.pingEls.add(e);
    this.c3.pings++;
    const still = this.p.cam.reduceMotion;
    try {
      e.animate(still ? [{ opacity: 1 }, { opacity: 0 }] : [{ opacity: 1, scale: '0.5' }, { opacity: 0.9, scale: '1.6', offset: 0.45 }, { opacity: 0, scale: '2.4' }],
        { duration: 900, easing: 'ease-out', fill: 'forwards' });
    } catch { /* no Web Animations: the element still goes away below */ }
    window.setTimeout(() => { e.remove(); this.pingEls.delete(e); }, 950);
  }

  private clearPings(): void {
    for (const e of this.pingEls) e.remove();
    this.pingEls.clear();
  }

  /**
   * M2 / M3: apply the touch look radians (Input.takeTouchLook) through the aim assist — the slowdown scales the
   * player's own look, the pull is added on top (never a snap: aimassist.ts caps it at 22°/s). kbm: the drained
   * radians are dropped and the assist reads neutral.
   */
  private touchLook(dt: number): void {
    const input = this.p.input;
    const t = input.takeTouchLook();
    const a = this.assist;
    a.slow = 1; a.dyaw = 0; a.dpitch = 0; a.foes = 0; a.visible = 0;
    if (input.mode !== 'touch' || this.matchOver) return;
    const me = this.human;
    const cam = this.p.cam;
    const on = this.p.hooks?.assist ? this.p.hooks.assist() : true;
    if (on && me.alive && this.world.phase === 'live') {
      const eye = this.assistEye;
      const cp = cam.camera.position;
      eye.x = cp.x; eye.y = cp.y; eye.z = cp.z;
      const range = this.assistRange + cam.boom;    // the kit's reach from the runner, measured from the camera
      const r2 = range * range;
      const rs = this.world.runners;
      let k = 0;
      for (let i = 0; i < rs.length; i++) {
        if (i === this.me) continue;
        const r = rs[i];
        const f = this.foeBuf[k++];
        if (!f) break;
        f.x = r.x; f.y = r.y + r.hitHeight() * 0.5; f.z = r.z;
        f.visible = false;
        if (r.team === me.team || !r.alive) continue;
        a.foes++;
        const dx = f.x - eye.x, dy = f.y - eye.y, dz = f.z - eye.z;
        if (dx * dx + dy * dy + dz * dz > r2) continue;   // out of range: no line-of-sight ray
        f.visible = this.world.canSee(me, r);
        if (f.visible) a.visible++;
      }
      const ts = input.touch;
      const res = aimAssist({
        camYaw: cam.yaw, camPitch: cam.pitch, eye, foes: this.foeBuf, range,
        firing: ts.held.has('fire'), moving: ts.moveX !== 0 || ts.moveZ !== 0 || t.dyaw !== 0 || t.dpitch !== 0,
        dt, strength: 1,
      });
      a.slow = res.slow; a.dyaw = res.dyaw; a.dpitch = res.dpitch;
    }
    // C1: the player's own look × the aim multiplier (the assist's pull is not scaled — it is already capped)
    const ls = cam.lookScale;
    const dyaw = t.dyaw * a.slow * ls + a.dyaw;
    const dpitch = t.dpitch * a.slow * ls + a.dpitch;
    if (dyaw || dpitch) this.addLookRad(dyaw, dpitch);
  }

  /** turn the follow camera by radians (the camera's own yaw wrap + pitch clamp; touch has no invert-Y) */
  private addLookRad(dyaw: number, dpitch: number): void {
    const cam = this.p.cam;
    const TAU = Math.PI * 2;
    let y = cam.yaw + dyaw;
    if (y > Math.PI) y -= TAU;
    else if (y < -Math.PI) y += TAU;
    cam.yaw = y;
    cam.pitch = Math.min(CAMERA.maxPitchDeg * DEG, Math.max(CAMERA.minPitchDeg * DEG, cam.pitch + dpitch));
  }

  /** M7: the renderer's touch shadow cap on the sun (a changed size re-allocates the map on the next render) */
  private shadowCap(): void {
    const sun = this.p.sky.sun;
    if (!sun?.shadow) return;
    // the authored size lives on the light (one sky serves the lobby and a match on the same arena)
    const ud = sun.userData as { dfShadowBase?: number };
    if (!(ud.dfShadowBase && ud.dfShadowBase > 0)) ud.dfShadowBase = sun.shadow.mapSize.x || 1024;
    this.shadowBase = ud.dfShadowBase;
    const want = Math.min(this.shadowBase, this.p.rig.shadowMapCap());
    if (sun.shadow.mapSize.x === want && sun.shadow.mapSize.y === want) return;
    sun.shadow.mapSize.set(want, want);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }

  /**
   * Audio, EVERY frame (audio/README.md §4 — quiet frames too: drainEvents() returns early on an empty queue).
   * A match routes this frame's drained events with the listener = the camera just rendered, plus the flow
   * state (the countdown beeps start when the countdown actually runs; the final-10 ticks are exact). The
   * lobby only ticks the router (ambience + music): its backdrop bots are scenery, not a soundscape.
   */
  private sound(vdt: number): void {
    const a = this.p.audio;
    if (!a) return;
    if (this.mode === 'match') {
      const e = this.p.cam.camera.matrixWorld.elements, L = this.listener;
      L.x = e[12]; L.y = e[13]; L.z = e[14];
      L.fx = -e[8]; L.fy = -e[9]; L.fz = -e[10];
      L.ux = e[4]; L.uy = e[5]; L.uz = e[6];
      const f = this.audioFrame, w = this.world;
      f.phase = w.phase; f.timeLeft = w.timeLeft; f.countdown = w.countdown;
      a.onEvents(this.drained, f);
    }
    a.update(vdt);                                  // the visuals' dt: 0 while paused
  }

  // ───────────────────────────── events → view ─────────────────────────────
  private drainEvents(): void {
    const out = this.drained;
    out.length = 0;
    if (this.net) this.net.drain(out);                      // CHANGED(ONLINE): the host's tick events / a client's record stream
    else this.world.drainEvents(out);
    if (!out.length) return;
    const { fx, players, hud, cam } = this.p;
    const rs = this.world.runners;
    const lobby = this.mode === 'lobby';
    const me = lobby ? -1 : this.me;
    if (!lobby) this.p.hooks?.simEvents?.(out, this.world);        // CHANGED(STATS) §S10.1: read-only; the stats facade guards itself
    // juice: trauma shake (per kit / by damage / near slams, pops, washes), hit markers, the damage vignette
    // + arc. It owns every screen shake and hit marker: the old cam.shake writes and HUD marks are gone.
    if (!lobby) this.p.juice?.onEvents(out, this.juiceCtx);
    for (const e of out) {
      this.counts[e.t] = (this.counts[e.t] ?? 0) + 1;
      const le = e as LoggedEvent;
      le.tick = this.tick;
      if (this.log.length >= EVENT_LOG) this.log.shift();
      this.log.push(le);
      switch (e.t) {
        case 'shot': {
          const team = rs[e.pid]?.team ?? 1;
          const ft = this.fireType[e.pid] ?? 'stream';
          if (ft === 'charge') break;                              // the 'beam' event draws the release
          const m = players.muzzle(e.pid, this.muzzle) ? this.muzzle : this.v1.set(e.x, e.y, e.z);
          if (ft === 'roll') fx.flickFan(m.x, m.y, m.z, e.dx, e.dy, e.dz, team);
          else if (ft === 'burst') { fx.muzzle(m.x, m.y, m.z, e.dx, e.dy, e.dz, team, 2.2); players.onBlast(e.pid); }
          else fx.muzzle(m.x, m.y, m.z, e.dx, e.dy, e.dz, team);
          break;
        }
        case 'beam': {
          const team = rs[e.pid]?.team ?? 1;
          const m = players.muzzle(e.pid, this.muzzle) ? this.muzzle : this.v1.set(e.x0, e.y0, e.z0);
          fx.beamFlash(m.x, m.y, m.z, e.x1, e.y1, e.z1, e.charge, team);
          break;
        }
        case 'burst':
          fx.burst(e.x, e.y, e.z, e.r, e.air, rs[e.pid]?.team ?? 1);
          break;
        case 'flick':
          players.onFlick(e.pid);
          break;
        case 'ring':
          fx.ringWave(e.x, e.y, e.z, e.r, rs[e.pid]?.team ?? 1);
          break;
        case 'sub': {
          const team = rs[e.pid]?.team ?? 1;
          if (e.phase === 'throw') players.onThrow(e.pid);
          else if (e.phase === 'land') fx.jellyLand(e.x, e.y, e.z, team);
          else fx.jellyPop(e.x, e.y, e.z, SUB_BLAST, team);
          break;
        }
        case 'special': {
          const team = rs[e.pid]?.team ?? 1;
          if (e.phase === 'ready') { if (e.pid === me) hud.specialReady(); }
          else if (e.phase === 'start') {
            players.onSpecialStart(e.pid, e.id);
            if (e.id === 'wellspring') fx.leapBurst(e.x, e.y, e.z, team);
          } else if (e.phase === 'end') {
            if (e.id === 'cloudburst') fx.cloudEnd(e.x, e.y, e.z, team);   // only a real end dissipates the cell
          } else if (e.phase === 'denied' && e.pid === me && !rs[e.pid]?.specialActive) {
            // CONTRACT_CONTROLS C3: the press the meter could not answer — the chip shakes + "Charging — n %", the touch
            // SPECIAL button shakes; the soft deny tick is the audio router's (the same drained event). Review fix A-A3: a
            // press while the human's OWN special runs (a double tap / mash; the core denies it, C2) is no failure — the
            // special is active and the meter does not charge — so it gets no deny feedback (WELLSPRING keeps
            // specialActive through the leap)
            this.c3.denied++;
            this.p.hud.specialDenied(rs[e.pid]?.special ?? 0);
            this.p.touch?.specialDenied();
          }
          break;
        }
        case 'dry': {
          if (players.muzzle(e.pid, this.muzzle)) fx.dryPuff(this.muzzle.x, this.muzzle.y, this.muzzle.z);
          if (e.pid === me) hud.dry();
          break;
        }
        case 'splat':
          fx.splat(e.x, e.y, e.z, e.nx, e.ny, e.nz, e.r, e.team);
          break;
        case 'hit': {
          const by = rs[e.by];
          fx.hitSparks(e.x, e.y, e.z, by?.team ?? 1);
          players.onHit(e.victim, by?.team, e.x, e.y, e.z, e.dmg);   // the body stain sits at the hit, sized by damage
          break;
        }
        case 'washed': {
          const v = rs[e.victim];
          const by = e.by !== null && e.by >= 0 ? rs[e.by] : null;
          if (v) {
            const burstTeam: TeamId = by ? by.team : this.matchMode === 'ffa' ? v.team : (v.team === 1 ? 2 : 1);
            if (e.cause !== 'sea') fx.washedBurst(v.x, v.y, v.z, burstTeam);
            players.onWashed(e.victim);
            if (!lobby) hud.killFeed(e.cause === 'sea' || !by ? null : { name: by.name, team: by.team }, { name: v.name, team: v.team });
          }
          if (e.victim === me) {
            hud.showDeath(e.cause === 'sea' || !by ? null : by.name, by ? by.team : null, WEAPONS.respawnSeconds);
            if (this.p.input.mode === 'touch') this.p.touch?.vibrate(60);   // CONTRACT_MOBILE M2 haptics
            this.p.input.clearAim();                                         // C1: a toggled aim ends with the wash
          }
          break;
        }
        case 'score':
          // CONTRACT_WASHOUT W5: the human's own credited wash → the "+1" pop (the chips read scores() every frame)
          if (!lobby && e.pid === me) { this.c3.scorePops++; this.p.hud.scorePop(); }
          break;
        case 'spawn': {
          // CONTRACT_FFA_SPAWNS S3 / S5: a runner dropped in at a spawn site → the site's marker in its crew colour + a
          // minimap ping (FFA only; the core pushes no 'spawn' in teams)
          if (lobby || this.matchMode !== 'ffa') break;
          const team = rs[e.pid]?.team ?? ((e.pid + 1) as TeamId);
          this.p.drops?.show(e.site, team);
          this.c3.markers++;
          this.pingMinimap(e.x, e.z, team);
          break;
        }
        case 'respawn': {
          const r = rs[e.pid];
          players.onRespawn(e.pid);
          if (r) fx.spout(r.x, r.y, r.z, r.team);
          if (e.pid === me) {
            hud.hideDeath();
            if (r) cam.reset(r.yaw);
          }
          break;
        }
        case 'tankLow':
          if (e.pid === me) hud.lowTank();
          break;
        case 'phase':
          if (e.phase === 'ended') this.endT = 0;
          break;
        default:
          break;
      }
    }
  }

  /** the drained events of this frame (read synchronously after frame(): the audio router's input) */
  get frameEvents(): readonly SimEvent[] { return this.drained; }

  /** spring pads (phases 7–8): a launch has no SimEvent — each growth of runner.launches splashes its pad */
  private springLaunches(): void {
    const springs = this.p.geo.features?.springs;
    if (!springs || !springs.length) return;
    const rs = this.world.runners;
    for (let i = 0; i < rs.length && i < this.launchSeen.length; i++) {
      const r = rs[i];
      if (r.launches === this.launchSeen[i]) continue;
      if (r.launches < this.launchSeen[i]) { this.launchSeen[i] = r.launches; continue; }
      this.launchSeen[i] = r.launches;
      const sp = springs[r.lastSpring];
      if (!sp) continue;
      const lh = Math.hypot(sp.launch[0], sp.launch[2]);
      this.p.fx.springSplash(sp.x, sp.y, sp.z, Math.max(0.6, sp.r), lh > 1e-3 ? sp.launch[0] / lh : 0, lh > 1e-3 ? sp.launch[2] / lh : 0);
      this.counts.springLaunch = (this.counts.springLaunch ?? 0) + 1;
      if (i === this.me && this.mode === 'match') this.p.juice?.trauma(0.2, 0.35);
    }
  }

  /** after the final horn: 1.6 s of victory poses, then the slate + a free mouse for PLAY AGAIN / LOBBY */
  private matchFlow(dt: number): void {
    if (this.world.phase !== 'ended') return;
    if (this.mode === 'lobby') {
      // the lobby's round is over: a fresh court, fast-forwarded (the menus stay up; nobody is watching a scoreboard)
      if (this.phase === 'menu') { this.restart(); this.warm(); }
      return;
    }
    if (this.endT < 0) this.endT = 0;
    this.endT += dt;
    if (this.net && !this.world.result && this.endT < 5) return;   // CHANGED(ONLINE): the slate is the host's result
    if (!this.victoryShown && this.endT >= 1.6) {
      this.victoryShown = true;
      const res = this.world.result ?? { ...this.p.painter.coverage(), winner: 0 as TeamId };
      this.p.hud.hideDeath();
      const hooks = this.p.hooks;
      const ffa = this.matchMode === 'ffa' ? this.ffaVictory() : undefined;
      // CONTRACT_WASHOUT W6: a WASHOUT slate gets the rule and its scoreboard block (the result's scores / limit / endedBy
      // + every runner's W / D, built by the slate module's washoutVictory); TURF passes neither (its slate is unchanged)
      const vi: VictoryInfo = {
        sun: res.sun, gulf: res.gulf, neutral: res.neutral, winner: res.winner, ...(ffa ? { ffa } : {}),
        ...(this.rule === 'washout' ? { rule: 'washout' as const, washout: washoutVictory(this.world.result ?? {}, this.world.runners, this.me) } : {}),
      };
      this.p.hud.showVictory(vi, () => this.playAgain(), hooks?.lobby ? () => hooks.lobby?.() : undefined);
      hooks?.victory?.(this.p.hud.slates.victoryEl);
      // confetti in the winner's colours, kept off the slate's card (title + tally stay clean); the stinger
      if (ffa) this.p.juice?.victory(res.winner, this.p.hud.slates.victoryCardEl, ffa.winners);   // FFA draw: the tied crews' colours
      else this.p.juice?.victory(res.winner, this.p.hud.slates.victoryCardEl);
      // the stinger follows whether the human won (teams: a draw plays 'victory', as before; FFA: a draw is won only
      // when the human is among the crews tied for first)
      const won = ffa ? ffa.winners.includes(this.humanTeam) : res.winner === this.humanTeam || res.winner === 0;
      this.p.audio?.playMusic(won ? 'victory' : 'defeat');
      // the world is over: the keys belong to the slate now (arrows / Space / Enter drive PLAY AGAIN · LOBBY)
      this.p.input.live = false;
      this.p.input.releaseAll();
      if (document.pointerLockElement === this.p.canvas) document.exitPointerLock();
    }
  }

  /**
   * CONTRACT_FFA F3: the FFA slate's data — the sim's final standings (share descending, a tie → the lower crew id) with
   * the runner names, and the winners (the winner, or every crew tied for first on a draw). A result without standings
   * (never the case for a finished FFA match) falls back to the painter's per-crew shares.
   */
  private ffaVictory(): FfaVictory {
    const w = this.world;
    const res = w.result;
    const rs = w.runners;
    const standings = res?.standings?.length
      ? res.standings.map((s) => ({ team: s.crew, name: s.name, share: s.share, you: s.pid === this.me }))
      : (() => {
        const sh = this.p.painter.coverageByTeam(this.shareBuf);
        return rs.map((r) => ({ team: r.team, name: r.name, share: sh[r.team] ?? 0, you: r.id === this.me }))
          .sort((a, b) => (b.share - a.share) || (a.team - b.team));
      })();
    let winners: number[];
    if (res && res.winner !== 0) winners = [res.winner];
    else if (res?.tied?.length) winners = [...res.tied];
    else {
      const top = standings.length ? standings[0].share : 0;
      winners = standings.filter((s) => s.share === top).map((s) => s.team);
    }
    const neutral = res?.shares ? res.shares[0] : this.p.painter.coverageByTeam(this.shareBuf)[0];
    return { standings, winners, neutral };
  }

  private playAgain(): void {
    if (this.phase !== 'play' && this.phase !== 'paused') return;
    if (this.phase === 'paused') { this.phase = 'play'; this.p.hooks?.paused?.(false, ''); }
    if (this.p.input.mode === 'touch') armBackTrap();   // A-A6: a back on the victory slate may have used the entry up
    this.restart();
  }

  // ───────────────────────────── lobby camera ─────────────────────────────
  /**
   * The lobby camera: a slow orbit (radius 17 m, ~7 m up) round a point that glides after the crews — their
   * centroid pulled 40 % toward mid-court, smoothed over ~2.5 s — so a few runners painting are always in a
   * readable shot. The view is turned a little about the world up axis so the action sits right of the menu
   * column.
   */
  private lobbyCamera(dt: number): void {
    this.lobbyT += dt;
    const cam = this.p.cam.camera;
    const b = this.p.def.bounds;
    const mx = b ? (b.min[0] + b.max[0]) / 2 : 0, mz = b ? (b.min[2] + b.max[2]) / 2 : 0;
    let sx = 0, sz = 0, n = 0;
    for (const r of this.world.runners) { if (!r.alive) continue; sx += r.x; sz += r.z; n++; }
    const tx = n ? mx + (sx / n - mx) * 0.6 : mx, tz = n ? mz + (sz / n - mz) * 0.6 : mz;
    const aim = this.lobbyAim;
    if (Number.isNaN(aim.x)) aim.set(tx, 0, tz);
    const k = 1 - Math.exp(-Math.max(0, dt) / 2.5);
    aim.x += (tx - aim.x) * k;
    aim.z += (tz - aim.z) * k;
    const a = 2.3 + this.lobbyT * 0.035;
    const R = 17, y = 7 + Math.sin(this.lobbyT * 0.11) * 1.0;
    cam.position.set(aim.x + Math.sin(a) * R, y, aim.z + Math.cos(a) * R);
    this.focus.set(aim.x, 0.8, aim.z);
    // turn the view about the WORLD up axis (a level horizon), so the action sits right of the menu column
    const dx = aim.x - cam.position.x, dz = aim.z - cam.position.z;
    const t = 0.22, c = Math.cos(t), s = Math.sin(t);
    this.lobbyTarget.set(cam.position.x + dx * c + dz * s, 0.8, cam.position.z - dx * s + dz * c);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.lobbyTarget);
    cam.updateMatrixWorld();
  }

  // ───────────────────────────── render ─────────────────────────────
  /** interpolated render of the current state (also used by __DF__.shot) */
  render(dt: number, alpha = 1): void {
    const p = this.p;
    const w = this.world;
    const me = this.human;
    const lobby = this.mode === 'lobby';
    this.updateSeen(dt);
    const fo = this.frameOpts;
    fo.alpha = alpha;
    fo.viewerTeam = lobby ? 1 : me.team;
    fo.width = p.canvas.clientWidth || window.innerWidth;
    fo.height = p.canvas.clientHeight || window.innerHeight;
    fo.winner = w.phase === 'ended' && w.result ? w.result.winner : null;
    p.players.update(dt, w.runners, fo);
    const f = p.players.frame(this.me);
    if (lobby) {
      this.lobbyCamera(dt);
    } else {
      this.feet.x = f.x; this.feet.y = f.y + p.players.dropOffset(this.me); this.feet.z = f.z;
      p.cam.slickTarget = me.alive && me.slickForm ? 1 : 0;
      p.cam.update(dt, this.feet, this.physics);
      this.focus.set(f.x, f.y + 0.6, f.z);
    }
    p.sky.update(dt, p.cam.camera, this.focus);
    p.water.update(this.time, p.cam.camera);
    p.map.update(dt, p.cam.camera);          // light_ pool re-assignment (0.5 s) + fades; stands the auto driver down
    if (!lobby) p.drops?.update(dt, w.phase === 'countdown');   // S3: the drop-in markers (held through the countdown)
    const ut = p.dye.uTime;
    if (ut) ut.value = this.time;
    p.paint.upload(p.painter);
    this.glints();
    p.fx.viewHeight = fo.height;
    p.fx.update(dt, p.cam.camera, this.running || this.phase === 'paused' ? w.projectiles : null, alpha);

    p.rig.resize(p.cam.camera);
    p.rig.beginFrame();
    this.shadowCap();
    p.rig.renderer.render(p.scene, p.cam.camera);
    p.hooks?.overlay?.(p.rig.renderer, dt);
    if (lobby) return;
    p.juice?.update(dt, this.juiceCtx);           // the same dt as the visuals: pause + dev freeze stop it

    // HUD
    const hf = this.hudFrame;
    hf.phase = w.phase;
    hf.timeLeft = w.timeLeft;
    hf.endedBy = w.endedBy;                       // A-A6: a WASHOUT limit ending freezes the timer at the time left
    hf.countdown = w.countdown;
    hf.coverage = p.painter.coverage();
    hf.shares = this.matchMode === 'ffa' ? p.painter.coverageByTeam(this.shareBuf) : null;
    hf.tank = me.tank; hf.hp = me.hp; hf.alive = me.alive;
    hf.slick = me.slickForm; hf.firing = me.firing && this.phase === 'play';
    hf.x = f.x; hf.z = f.z; hf.yaw = f.yaw;
    hf.special = me.special;
    hf.specialReady = me.specialReady && me.specialActive === '';
    hf.charge = me.charge;
    hf.subReady = me.alive && me.tank >= SUB_COST && me.subCooldown <= 0;
    hf.respawnIn = me.alive ? 0 : Math.max(0, me.respawnT);
    for (let i = 0; i < w.runners.length && i < this.crests.length; i++) {
      const r = w.runners[i];
      const c = this.crests[i];
      c.alive = r.alive; c.respawnIn = r.respawnT; c.special = r.special;
      const d = this.dots[i];
      const fr = p.players.frame(i);
      d.x = fr.x; d.z = fr.z;
      d.show = i !== this.me && r.alive && (r.team === me.team || this.seen[i] === true);
    }
    p.hud.update(dt, hf, () => this.debugInfo());
    this.hudExtras(me);
  }

  /**
   * The WASHOUT / CONTROLS HUD entry points, per frame (each call only on a change, except the WASHOUT scores): the live
   * scores (world.scores(), the world's own array — never written here), PROTECTED while the human's spawn protection
   * runs, and the C3 special chip (fill + %, the ready prompt with the ACTUAL binding: "Q  CLOUDBURST").
   */
  private hudExtras(me: Runner): void {
    const hud = this.p.hud;
    if (this.rule === 'washout') {
      // A-A5: the per-crew washed counts (every cause, as MatchWorld.computeResult sums Runner.washedCount) ride along, so
      // the FFA panel ranks ties on score exactly as the standings (fewer times washed, then turf)
      const wd = this.washedBuf;
      wd.length = CREW_SLOTS;
      wd.fill(0);
      for (const r of this.world.runners) if (r.team > 0 && r.team < CREW_SLOTS) wd[r.team] += r.washedCount;
      hud.setScores(this.world.scores(), wd);
    }
    const prot = me.alive && me.protectedT > 0 && this.world.phase !== 'ended';
    if (prot !== this.hudProtected) { this.hudProtected = prot; hud.setProtected(prot); }
    const s = this.hudSpecial;
    const pct = Math.round(Math.max(0, Math.min(1, me.special)) * 100);
    const ready = me.alive && me.specialReady && me.specialActive === '' && me.special >= 1;
    const key = this.p.input.keyLabel('special');
    const waiting = ready && this.airHold > 0;      // A-A1: a mid-air press held for the landing
    if (pct !== s.pct || ready !== s.ready || key !== s.key || this.specialName !== s.label || waiting !== s.waiting) {
      s.pct = pct; s.ready = ready; s.key = key; s.label = this.specialName; s.waiting = waiting;
      hud.setSpecial({ frac: pct / 100, ready, label: this.specialName, keyLabel: key, waiting });
    }
  }

  /**
   * NEEDLE-GLINT glint lines: for every charging runner, the scope → the point where its aim ray (the sim's
   * shot origin on the capsule axis, the sim's aim) meets the map within lerp(minRange, maxRange, charge).
   */
  private glints(): void {
    const { players, fx } = this.p;
    const rs = this.world.runners;
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i];
      if (this.fireType[i] !== 'charge' || !r.alive || !(r.charge > 0)) continue;
      const f = players.frame(i);
      const [lo, hi] = this.range[i];
      const L = lo + (hi - lo) * r.charge;
      const cp = Math.cos(r.aimPitch);
      const dx = Math.sin(r.aimYaw) * cp, dy = Math.sin(r.aimPitch), dz = Math.cos(r.aimYaw) * cp;
      const ox = f.x, oy = f.y + COMBAT.muzzleHeight, oz = f.z;
      const hit = this.physics.raycast(ox, oy, oz, dx, dy, dz, L);
      const t = hit ? hit.toi : L;
      const s = players.scope(i, this.v1) ? this.v1 : this.v1.set(ox, oy, oz);
      fx.glint(i, s.x, s.y, s.z, ox + dx * t, oy + dy * t, oz + dz * t, r.charge, r.team);
    }
  }

  /** team vision at 5 Hz: an enemy is seen when any living crewmate can see it (world.canSee) */
  private updateSeen(dt: number): void {
    if (this.mode === 'lobby') return;          // the lobby shows everyone
    this.seenClock -= dt;
    if (this.seenClock > 0) return;
    this.seenClock = 0.2;
    const rs = this.world.runners;
    const myTeam = this.human.team;
    for (const t of rs) {
      if (t.team === myTeam) { this.seen[t.id] = true; continue; }
      let s = false;
      if (t.alive) {
        for (const v of rs) {
          if (v.team !== myTeam || !v.alive) continue;
          if (this.world.canSee(v, t)) { s = true; break; }
        }
      }
      this.seen[t.id] = s;
    }
  }

  /** match summary for __DF__.match() */
  matchInfo(): Record<string, unknown> {
    const w = this.world;
    return {
      mode: this.mode, phase: w.phase, timeLeft: w.timeLeft, countdown: w.countdown, tick: w.tick, result: w.result,
      coverage: this.p.painter.coverage(), matchNo: this.matchNo, victoryShown: this.victoryShown,
      // CONTRACT_FFA F3: the match mode, the crews in play (world.crews, ascending) and the weighted share per crew id
      // (index 0 = neutral; teams mode fills 1 / 2)
      matchMode: this.matchMode, crews: [...w.crews], coverageByTeam: Array.from(this.p.painter.coverageByTeam()),
      // CHANGED(STATS-INTEGRATION) read-back: the roster's bot tiers vs the tiers the director's brains actually play
      rosterTiers: this.p.roster.map((r) => (r.bot ? r.skill : null)), botTiers: this.director.tiers(),
      // CONTRACT_WASHOUT W10: the rule, the live scores per crew id, the limit it plays to and how it ended
      rule: w.rule, limit: w.limit, scores: [...w.scores()], endedBy: w.endedBy,
      runners: w.runners.map((r) => ({
        id: r.id, name: r.name, team: r.team, bot: r.bot, state: r.state, hp: r.hp, tank: r.tank, alive: r.alive,
        x: r.x, y: r.y, z: r.z, hidden: r.hidden, slickForm: r.slickForm, special: r.special, respawnT: r.respawnT,
        washes: r.washes, washedCount: r.washedCount, painted: r.painted, firing: r.firing, seen: this.seen[r.id] === true,
        kit: r.kit, charge: r.charge, rolling: r.rolling, flicking: r.flicking, leaping: r.leaping, specialActive: r.specialActive,
        specialReady: r.specialReady, subCooldown: r.subCooldown,
        protectedT: r.protectedT, spawnSite: r.spawnSite,                       // W1 / S2
      })),
      events: { ...this.counts },
      projectiles: w.projectiles.count,
      // CONTRACT_FFA_SPAWNS S5: the shown drop-in markers + counts; C3: the human's SPECIAL denials; W5: score pops
      markers: this.p.drops ? this.p.drops.active() : null, markerSites: this.p.drops ? this.p.drops.count : 0,
      shimmer: this.p.players.shimmer(), feedback: { ...this.c3 },
      // review fix A-A1: the human's mid-air SPECIAL presses held for the landing (+ the ticks left on the current one)
      airSpecial: { ...this.airSpecialStats, holding: this.airHold },
    };
  }

  /** CONTRACT_CONTROLS C1 read-back: the aim state + the camera it drives */
  aimInfo(): Record<string, unknown> {
    const c = this.p.cam;
    return {
      wanted: this.p.input.aiming(), target: c.aimTarget, blend: Math.round(c.aimBlend * 1000) / 1000,
      fov: Math.round(c.camera.fov * 1000) / 1000, baseFov: c.baseFov, zoom: c.aimZoom, lookScale: Math.round(c.lookScale * 1000) / 1000,
      aimSens: c.aimSens, toggle: this.p.input.aimToggle, touch: this.p.input.touch.aim, hud: this.hudAiming, boom: Math.round(c.boom * 1000) / 1000,
    };
  }

  /** the last n drained events (oldest first) */
  events(n = 50): LoggedEvent[] {
    const k = Math.max(0, Math.min(this.log.length, n | 0));
    return this.log.slice(this.log.length - k);
  }

  debugInfo(): HudDebug {
    const p = this.p;
    const me = this.human;
    const st = p.rig.stats();
    const ad = p.rig.adaptive();
    const rv = p.players.view(this.me);
    const alive = this.world.runners.filter((r) => r.alive).length;
    return {
      coverage: p.painter.coverage(), tank: me.tank, mapId: p.def.id, fps: this.fps, state: me.state, grounded: me.grounded,
      atlasSize: p.atlas.size, atlasCount: p.atlas.count, overlaps: p.atlas.overlaps,
      calls: st.calls, triangles: st.triangles, programs: st.programs, tick: this.tick,
      x: me.x, y: me.y, z: me.z, flips: p.painter.flips, speed: me.speed,
      anim: rv ? rv.describe() : '—',
      pointerLock: document.pointerLockElement === p.canvas,
      scale: ad.scale, scaleMin: ad.min, scaleMax: ad.max, quality: ad.quality,
      buffer: [p.canvas.width, p.canvas.height], p90: ad.p90, targetMs: ad.targetMs,
      match: `${this.world.phase} · ${this.world.timeLeft.toFixed(1)} s · #${this.matchNo}`,
      hp: me.hp, projectiles: this.world.projectiles.count, particles: p.fx.emitted,
      runners: `${alive}/${this.world.runners.length} alive`,
    };
  }
}

/** ray (o + t·d, |d| = 1) vs a vertical cylinder (feet at (cx, cy, cz), radius r, height h) → t or −1 */
function rayCylinder(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number, r: number, h: number): number {
  const fx = ox - cx, fz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) return -1;
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - r * r;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  for (const t of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
    if (t <= 0) continue;
    const y = oy + dy * t;
    if (y >= cy && y <= cy + h) return t;
  }
  return -1;
}
