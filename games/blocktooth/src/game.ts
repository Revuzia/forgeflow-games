// BLOCKTOOTH — the app: state machine + frame wiring (CONTRACT.md §14, §6, §12, §13, §3). app lane.
//
//   boot → title → select → loading → slate → play ⇄ draft / pause → end (tabloid)
//
//   * ONE GameLoop drives everything. onStep = one sim tick: stepWorld(world, input.titanInput());
//     every tick's events are copied (world.events is cleared per tick) into the frame list and
//     the 400-event ring the test surface reads. onFrame = input.update → camera → lighting →
//     every ViewModule → HUD / boss bar / broadcast / audio → render.
//   * The sim is FROZEN (loop.simEnabled = false, accumulator discarded — doctrine §5) for the
//     slate, drafts, pause, the run-end aftermath and the tabloid. Views keep idling cosmetics.
//   * Rank-up = hit-stop (loop.timeScale 0.15 for 0.25 s real time) + broadcast.sizeUp + a music
//     intensity sting; the camera rig reads the same rankUp event for its punch + zoom-out (§3/§4).
//   * A pending draft (hasPendingDraft) freezes the sim INSIDE the tick that granted it, then the
//     DraftScreen loops (reroll → rerollOffer, pick → pickUpgrade) until no draft is owed.
//   * runEnd → 2.5 s aftermath (sim stopped, fx still playing) → one render → the freeze-frame
//     photo (canvas.toDataURL right after that render) → broadcast.tabloid → retry/select/title.
//   * Every await is guarded by a run EPOCH (doctrine §4): a stale continuation from a previous
//     flow no-ops. Loads are serialised by a lock so a view is never mounted twice at once.
//   * Errors: a boot/load failure or a sim exception surfaces in #fatal (onFatal); a view throwing
//     in a frame is logged and only escalates to #fatal if it keeps failing (60 frames in a row).
//   * ONLINE VS (lane B-VIEW, vs_design.md): the title's VS PRACTICE [V] → the select screen in VS mode → startVs() builds a
//     4-seat World (you + 3 bots, createWorld mode 'vs') and mounts the same views plus VsView / VsHud / CardRail. A VS
//     match is stepped through stepWorldN with ONE human input (quantised through net/proto.ts exactly like the online
//     wire word, plus the CARD RAIL edges); the sim never pauses for a draft (the rail is state + input words) and no
//     hit-stop slows it. EVICTED follows the killer for the respawn, an elimination follows the killer 2.5 s then
//     SPECTATES (Q / E cycle, M map); vsEnd → the front-page end card → REMATCH (titan swap, new seed, next city) /
//     LEAVE. Solo never touches any of this: every VS branch is gated on `this.vsInfo` / `w.mode === 'vs'`.
//   * v2 (FEATURES_V2 §13.1, pre-wired by lane L0 against the stubs; no later lane edits this file):
//     profile + run meta at run start, select ⇄ GOALS & RECORDS, the cinematic opening (CineCam.plan
//     null → the legacy slate), ability bar / tracker / markers / toasts every play frame, UPROAR
//     hit-stop, 1 Hz goal checks, draft BANISH / LOCK / NEW ids, run-end profile ledger, KEEP GOING →
//     EXTENDED COVERAGE, pause LOADOUT ctx. Every stub keeps today's behaviour.

import type { AlertKey, BiomeId, PerkId, PlayerSeat, Profile, RankIndex, RunMeta, SimEvent, TitanId, TitanInput, World } from './core/types.ts';
import { BIOME_IDS, EMPTY_RUN_META, PERK_IDS, TITAN_IDS } from './core/types.ts';
import { BUDGET, GATES, INPUT_BUFFER_S, SIM_DT, ULT, VS } from './core/config.ts';
import { createWorld, setViewSlot, stepWorld, stepWorldN } from './core/world.ts';
import { GameLoop, frameStats } from './core/loop.ts';
import { Input } from './core/input.ts';
import { DebugOverlay } from './core/debug.ts';
import { bestKey, loadBest, loadProfile, loadSettings, saveBest, saveProfile, type Settings } from './core/save.ts';

import { createRenderCore, defaultQuality, type RenderCore, type RenderStats } from './render/renderer.ts';
import { CameraRig } from './render/camera.ts';
import { Lighting } from './render/lighting.ts';
import { EnvView } from './render/env.ts';
import { warmup } from './render/warmup.ts';
import { FrameProf } from './render/frameprof.ts';
import type { FrameInfo, Quality, ViewCtx, ViewModule } from './render/viewtypes.ts';
import { CityView } from './city/cityview.ts';
import { TitanView } from './titans/titanview.ts';
import { renderPortrait, renderPortraits } from './titans/portraits.ts';
import { EnemyView } from './ai/enemyview.ts';
import { BossView } from './ai/bossview.ts';
import { TelegraphView } from './render/telegraphview.ts';
import { ProjectileView } from './render/projectileview.ts';
import { HazardView } from './render/hazardview.ts';
import { FxView } from './render/fx.ts';
import { DebrisView } from './render/debris.ts';
import { CivilianView } from './render/civilians.ts';
import { PickupView } from './render/pickupview.ts';
// v2 views (L6 / L10; L0 stubs)
import { UltView } from './render/ultview.ts';
import { ObjectiveView } from './render/objectiveview.ts';
import { PowerupView } from './render/powerupview.ts';
import { MarkerView } from './render/markerview.ts';
import { CineCam } from './render/cinecam.ts';
import { PerSeat } from './render/perseat.ts';           // ONLINE VS (B-VIEW): one UltView per seat
import { VsView } from './render/vsview.ts';             // ONLINE VS (B-VIEW): seat rings, crown beam, cordon, tender pillars

import { Hud } from './ui/hud.ts';
import { VsHud } from './ui/vshud.ts';                   // ONLINE VS (B-VIEW)
import { CardRail } from './ui/rail.ts';
import { VsEndScreen } from './ui/vsend.ts';
import type { VsMatchInfo } from './ui/vstypes.ts';
import { SEAT_COLORS } from './ui/vstypes.ts';
import { REMATCH_BIOMES, botName } from './data/strings_vs.ts';
import { CARD, decodeInput, encodeInput } from './net/proto.ts';
import { Room } from './net/room.ts';                       // ONLINE VS (O-LOBBY): room codes (?room=)
import { OnlineMatch, buildInfo, cleanName, guestName, rematchCode, type Connection, type LobbyState, type Notice, type OnlineMode } from './online.ts';
import { LobbyScreen, type MenuChoice } from './ui/lobby.ts';
import { NetNotices } from './ui/netnotice.ts';
import type { BotLevel } from './vs/types.ts';
import { Broadcast, onAirSeconds, runFigures } from './ui/broadcast.ts';
import { PortalClient, buildVersionFromUrl, mergeBests, newRunNonce, newVsPracticeMatchId, resultsMajority, VsIdentityBook, type RunFiling, type RunResultPayload, type VsFiling, type VsReportCtx } from './net/portal.ts';   // ONLINE_PLAN A.1.5 (lane A-GAME) + VS reporting (O-REPORT)
import { VS_GOAL_BY_ID, VsEventTally } from './data/vsgoals.ts';
import { BossBar } from './ui/bossbar.ts';
import { SelectScreen } from './ui/select.ts';
import { DraftScreen } from './ui/draft.ts';
import { PauseMenu, TitleScreen } from './ui/menus.ts';
// v2 UI (L8 / L9 / L10; L0 stubs)
import { AbilityBar } from './ui/abilitybar.ts';
import { ObjectiveTracker } from './ui/tracker.ts';
import { ScreenMarkers } from './ui/markers.ts';
import { Toasts } from './ui/toast.ts';
import { GoalsScreen } from './ui/goals.ts';
import { CineOverlay } from './ui/cine.ts';
import type { CineVariant, CiviliansAddV3, DraftResultV2, FaceAnchor, SelectResume, SelectResultV2, TabloidChoiceV2 } from './v2types.ts';
import { endFinale } from './meta/gates.ts';   // GATEKEEPERS §4.3: the finale skip (K0 stub: no-op)
import { STR_GATE } from './data/strings_gate.ts';   // GATEKEEPERS §6.6: the finale SKIP hint copy (lane K2b)

import { AudioEngine } from './audio/audio.ts';
import { Sfx } from './audio/sfx.ts';
import { Music } from './audio/music.ts';

import { TITANS } from './data/titans.ts';
import { BIOMES } from './data/biomes.ts';
import { BOSSES } from './data/bosses.ts';
import { UPGRADES, UPGRADE_BY_ID } from './data/upgrades.ts';
import { banishCard, hasPendingDraft, lockCard, pickUpgrade, rerollOffer, rollOffer } from './upgrades/draft.ts';
// v2 meta (L5; L0 stubs)
import { GOALS } from './data/goals.ts';
import { TITAN_PALETTES } from './data/palettes.ts';
import { applyRunToProfile, evalGoals, markSeen, runMetaFor, unlockLabel } from './meta/goals.ts';
import { emptyProfile } from './meta/profile.ts';
import { continueEndless } from './meta/endless.ts';

// ─────────────────────────────── types ───────────────────────────────

export type Screen = 'boot' | 'title' | 'select' | 'lobby' | 'loading' | 'slate' | 'play' | 'draft' | 'pause' | 'end' | 'goals';

/** Which awaited modal screen currently owns input (so it can be closed on a forced transition). */
type Modal = 'title' | 'select' | 'slate' | 'draft' | 'pause' | 'end' | 'goals';

export interface AppParams {
  seed: number | null;
  titan: TitanId | null;
  biome: BiomeId | null;
  /** skip title + select: straight to loading → slate */
  autostart: boolean;
  /** cheats + debug conveniences */
  dev: boolean;
  /** session quality override (not saved) */
  quality: 0 | 1 | 2 | null;
  /** skip the open slate */
  noslate: boolean;
  /** adaptive render scale (default on; `?dynres=0` pins the drawing buffer at the quality DPR) */
  dynres: boolean;
  /** frame profiler (perf attribution; `?prof=1`, exposed as window.__BTPROF__) */
  prof: boolean;
  /** v2 `?cine=0|1|2`: session override of the opening setting (null = settings.cinematic) */
  cine: 0 | 1 | 2 | null;
  /** v2 `?meta=fresh|full` (dev only): in-memory empty profile / everything unlocked; storage untouched */
  meta: 'fresh' | 'full' | null;
  /** v2 `?perk=<PerkId>` (dev only): the run's perk */
  perk: PerkId | null;
  /** v2 `?endless=1` (dev only): the clear tabloid auto-picks KEEP GOING (harness) */
  endless: boolean;
  /** ONLINE VS (B-VIEW) `?vs=1`: with `?autostart=1` the app skips the menus into a VS PRACTICE match (titan / biome / seed / bots) */
  vs: boolean;
  /** `?bots=rookie|regular|veteran` for `?vs=1` (default regular) */
  bots: BotLevel | null;
  /** ONLINE VS (O-LOBBY) `?room=CODE`: an invite link (the portal forwards it): straight to the titan pick, then JOIN that room */
  room: string | null;
  /** DEV (`?dev=1`): `?autostart=1&online=quick|create|join[&code=ABCD]` skips the menus into the online flow (harness) */
  online: OnlineMode | null;
  /** DEV: `?ns=NAME` puts the room + lobby channels in their own namespace (tests never meet real players) */
  ns: string | null;
  /** DEV: `?build=X` overrides the build string rooms are grouped by (version-mismatch tests) */
  build: string | null;
  /** DEV: `?name=X` overrides the display name */
  uname: string | null;
}

/** ONLINE VS PRACTICE: what the select screen hands the app */
export interface VsRequest { titan: TitanId; biome: BiomeId; seed: number; bots: BotLevel; palette?: number }
/** the built match: seats for createWorld + the app-side description */
interface VsBuild { seats: PlayerSeat[]; info: VsMatchInfo; req: VsRequest }

export interface RunRequest {
  titan: TitanId;
  biome: BiomeId;
  seed: number;
  skipSlate?: boolean;
  /** v2: explicit run meta (test surface); otherwise the app derives it (params / profile) */
  meta?: RunMeta;
  /** v2: play the SHORT opening (RETRY) */
  short?: boolean;
}

export type FatalHandler = (title: string, err: unknown) => void;

/** the one Object3D field the photo hides/restores (no three import needed in the app) */
type THREE_Object = { visible: boolean };

// ─────────────────────────────── tuning ───────────────────────────────

/** rank-up hit-stop (CONTRACT §3): sim time scale and real-time duration */
const HITSTOP_SCALE = 0.15;
const HITSTOP_S = 0.25;
/** frames drawn after a frozen modal's canvas changes size / quality before the picture is held
 *  again. On OPEN nothing is redrawn: the frame that opened the modal already drew the world at the
 *  tick it froze on (the only difference to a redraw is sub-tick interpolation, invisible under the
 *  modal's blurred, ~85 % opaque backdrop). The opening frames are when the GPU rasterises the modal's
 *  new DOM (three cards): ?prof=1 runs with 3 redrawn frames missed vsync on draft frames #2–#4. */
const HOLD_DRAWN = 1;
/** while hit-stop slows the sim, a buffered HOOK/DASH press must outlive one slowed tick (see Input.bufferS) */
const HITSTOP_BUFFER_S = Math.max(INPUT_BUFFER_S, SIM_DT / HITSTOP_SCALE + 0.02);
/**
 * A level-up owed in the same moment as a rank-up waits this long (real s) so the MASS BREACH
 * sting (broadcast SIZEUP_MS = 2.3 s: sweep in, hold, sweep out) is seen in full instead of being
 * frozen half-drawn under the MUTATION REPORT. The sim keeps running meanwhile.
 */
const SIZEUP_DRAFT_HOLD_S = 2.3;
/** real seconds between the runEnd event and the freeze-frame photo / tabloid */
const END_DELAY_S = 2.5;
/** scene roots hidden for the tabloid photo (live hostile warnings would bury the subject) */
const PHOTO_HIDDEN_ROOTS = ['view:telegraphs', 'view:hazards'] as const;
/** sim-event ring for __BT__.events(n) */
export const EVENT_RING = 400;
/** low-HP broadcast alert: fire below, re-arm above (fractions of max HP) */
const LOW_HP_FIRE = 0.25;
const LOW_HP_REARM = 0.45;
/** music intensity refresh period (s) */
const MUSIC_PERIOD_S = 0.25;
/** a view throwing this many frames in a row is a broken picture → #fatal */
const FRAME_ERROR_FATAL_STREAK = 60;
/** portrait size (px) for the select screen */
const PORTRAIT_PX = 320;

/** Loading-card copy (app-owned; data/strings.ts carries no boot/loading lines). */
const LOADING = {
  boot: 'PATCHING INTO WARD-7…',
  render: 'WARMING UP THE CAMERA VAN…',
  desk: 'SEATING THE NEWS DESK…',
  ready: 'ON AIR IN 3… 2…',
  portraits: 'DEVELOPING THE SIGHTING PHOTOS…',
  city: 'SURVEYING THE BLOCKS…',
  mount: 'ROLLING OUT THE CITY…',
  warm: 'FOCUSING THE LENS…',
  live: 'WE ARE LIVE',
} as const;

/** Keys that close each modal through its own UI path (used by forced transitions / harness). */
const CLOSE_KEY: Record<Exclude<Modal, 'slate' | 'end'>, { key: string; code: string }> = {
  title: { key: 'Enter', code: 'Enter' },
  select: { key: 'Escape', code: 'Escape' },
  draft: { key: '1', code: 'Digit1' },
  pause: { key: 'Escape', code: 'Escape' },
  goals: { key: 'Escape', code: 'Escape' },
};

/** v2: goals are checked this often while playing (s) */
const GOALS_PERIOD_S = 1;
/** v2: the RESTRUCTURED evolution toast sub-line hold (the Toasts stack owns timing) */
const EVO_TOAST_KICKER = 'RESTRUCTURED';

// ─────────────────────────────── small helpers ───────────────────────────────

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function isTitan(v: string | null | undefined): v is TitanId {
  return !!v && (TITAN_IDS as readonly string[]).includes(v);
}
function isBiome(v: string | null | undefined): v is BiomeId {
  return !!v && (BIOME_IDS as readonly string[]).includes(v);
}

/** Parse the URL params of CONTRACT §14. Unknown / malformed values fall back to null/false. */
export function parseParams(search: string): AppParams {
  let q: URLSearchParams;
  try { q = new URLSearchParams(search); } catch { q = new URLSearchParams(); }
  const flag = (k: string) => {
    const v = q.get(k);
    return v !== null && v !== '0' && v.toLowerCase() !== 'false';
  };
  const seedRaw = q.get('seed');
  let seed: number | null = null;
  if (seedRaw !== null && seedRaw.trim() !== '') {
    const n = Number(seedRaw);
    if (Number.isFinite(n)) seed = Math.abs(Math.floor(n)) >>> 0;
  }
  const qual = q.get('quality');
  const quality = qual === '0' || qual === '1' || qual === '2' ? (Number(qual) as 0 | 1 | 2) : null;
  const titan = (q.get('titan') || '').toLowerCase();
  const biome = (q.get('biome') || '').toLowerCase();
  return {
    seed,
    titan: isTitan(titan) ? titan : null,
    biome: isBiome(biome) ? biome : null,
    autostart: flag('autostart'),
    dev: flag('dev'),
    quality,
    noslate: flag('noslate'),
    dynres: q.get('dynres') === null ? true : flag('dynres'),
    prof: flag('prof'),
    cine: (() => { const c = q.get('cine'); return c === '0' || c === '1' || c === '2' ? (Number(c) as 0 | 1 | 2) : null; })(),
    meta: (() => { const m = (q.get('meta') || '').toLowerCase(); return m === 'fresh' || m === 'full' ? m : null; })(),
    perk: (() => { const k = q.get('perk') || ''; return (PERK_IDS as readonly string[]).includes(k) ? (k as PerkId) : null; })(),
    endless: flag('endless'),
    vs: flag('vs') || (q.get('mode') || '').toLowerCase() === 'vs',
    bots: (() => { const b = (q.get('bots') || '').toLowerCase(); return b === 'rookie' || b === 'regular' || b === 'veteran' ? b : null; })(),
    room: Room.codeFromUrl(search),
    online: (() => {
      if (!flag('dev')) return null;
      const m = (q.get('online') || '').toLowerCase();
      return m === 'quick' || m === 'create' || m === 'join' ? (m as OnlineMode) : m === 'host' ? 'create' : null;
    })(),
    ns: flag('dev') ? (q.get('ns') || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || null : null,
    build: flag('dev') ? (q.get('build') || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 40) || null : null,
    uname: flag('dev') ? cleanName(q.get('name') || '') || null : null,
  };
}

/** the other three titans (TITAN_IDS order) fill the bot seats of a VS PRACTICE match */
function vsBotTitans(me: TitanId): TitanId[] {
  const out: TitanId[] = [];
  for (const t of TITAN_IDS) if (t !== me && out.length < 3) out.push(t);
  return out;
}

/** build the 4 seats (you + 3 bots) and the match description for a VS PRACTICE request */
function buildVs(req: VsRequest): VsBuild {
  const pal = Number.isFinite(req.palette) ? Math.max(0, Math.min(2, Math.floor(req.palette as number))) : 0;
  const seats: PlayerSeat[] = [{ titan: req.titan, meta: { ...EMPTY_RUN_META, unlocked: [], perk: null, palette: pal }, bot: null }];
  const info: VsMatchInfo = {
    seats: [{ slot: 0, titan: req.titan, name: 'YOU', sign: '', bot: false, level: null, color: VS.seatColors[0] ?? SEAT_COLORS[0] }],
    local: 0, biome: req.biome, seed: req.seed, palettes: [pal, 0, 0, 0],
  };
  vsBotTitans(req.titan).forEach((t, k) => {
    const slot = k + 1;
    const nm = botName(slot, req.seed);
    seats.push({ titan: t, meta: { ...EMPTY_RUN_META, unlocked: [], perk: null, palette: 0 }, bot: req.bots });
    info.seats.push({ slot, titan: t, name: nm.unit, sign: nm.sign, bot: true, level: req.bots, color: VS.seatColors[slot] ?? SEAT_COLORS[slot] });
  });
  return { seats, info, req };
}

/**
 * Adaptive render scale. On integrated GPUs a GPU-bound frame misses vsync and the frame rate
 * halves. Measured on the reference Intel UHD at Size V + 250 foes, 1280×720, render scale PINNED
 * (?rscale=, 12 s perfcheck window): 1.0 → 5.6 % of frames miss vsync (p99 40 ms); 0.8 → 0.8 %;
 * 0.7 → 0.3 %; 0.6 → 0.2 %. The WebGL work itself barely scales with resolution (GPU timer 15.4 →
 * 14.0 ms from 1.0 to 0.6) — the pixel-bound part is the MSAA resolve + compositing of the canvas,
 * outside the timer — so the controller watches missed vsyncs, not the timer.
 *
 * Every second of live play it counts frames slower than 1.5× the display interval (the interval =
 * the fastest 1-s p10 seen this session, i.e. measured on cheap menu frames), IGNORING misses that
 * followed a frame whose main-thread work (sim + views + UI, excluding the render call) already ate
 * most of the interval — resolution cannot fix those. A p99 ≤ 22 ms budget allows < 1 % misses, so
 * ≥ 3 % in a window steps down: −0.1, or −0.2 at ≥ 6 %, −0.3 at ≥ 15 % (one step instead of three:
 * every step reallocates the drawing buffer, which stalls 55–75 ms while the GPU queue is full).
 * After a step the next 0.75 s is not judged (the step's own stall is not evidence). Up: +0.1 after
 * UP_CLEAN_S of windows with < 1 % misses; a level that fails within 6 s of a step up is locked
 * out for 60 s so the scale never oscillates. The scale multiplies the quality DPR (drawing buffer
 * only; the CSS size and every layout stay unchanged).
 */
export class DynRes {
  scale = 1;
  /** dev/perf attribution: `?rscale=0.7` pins the scale (no adaptation) */
  pinned = false;
  private readonly win = new Float32Array(240);
  private readonly cpu = new Float32Array(240);
  private n = 0;
  private acc = 0;
  private interval = 0;          // estimated display interval (s); 0 = unknown
  /** last decision window's missed-frame fraction (−1 = no live window yet) — test surface */
  lastMiss = -1;
  /** decisions taken (down / up steps) — test surface */
  steps = { down: 0, up: 0 };
  get displayInterval(): number { return this.interval; }
  private clean = 0;
  private t = 0;
  private lastUpT = -1e9;
  private lockUntil = 0;
  private settleUntil = 0;
  /** floor: 0.6 × the quality DPR (1280×720 → 768×432 drawing buffer on the reference Intel UHD) */
  static readonly MIN = 0.6;
  /** step down when at least this fraction of a live 1-s window missed vsync (GPU-side misses) */
  static readonly DOWN_MISS = 0.03;
  /** step up only after UP_CLEAN_S of windows with fewer misses than this */
  static readonly CLEAN_MISS = 0.01;
  /** 30 s (was 10): every step reallocates the MSAA drawing buffer — a 50–65 ms main-thread stall
   *  on the reference Intel UHD (?prof=1 `resize=` notes) — and with the Size V load now mostly
   *  resolution-independent (vertex-bound) an early step up bought little picture for a certain hitch */
  static readonly UP_CLEAN_S = 30;
  static readonly LOCK_S = 60;
  static readonly SETTLE_S = 0.75;

  /** Feed every rendered frame's dt (s). `live` = the sim is running (only live play adapts).
   *  `prevCpu` = main-thread seconds of the frame BEFORE this gap (render call excluded).
   *  Returns true when `scale` changed. */
  frame(dt: number, live: boolean, prevCpu = 0): boolean {
    if (!(dt > 0) || this.pinned) return false;
    this.t += dt;
    if (this.n < this.win.length) { this.win[this.n] = dt; this.cpu[this.n] = prevCpu; this.n++; }
    this.acc += dt;
    if (this.acc < 1) return false;
    // one decision window per second
    const n = this.n;
    const a = Array.prototype.slice.call(this.win, 0, n) as number[];
    a.sort((x, y) => x - y);
    const p10 = a[Math.floor(n * 0.1)] ?? 0;
    if (n >= 20 && p10 > 0.004 && (this.interval === 0 || p10 < this.interval)) this.interval = Math.min(p10, 1 / 24);
    let changed = false;
    if (live && n >= 10 && this.interval > 0 && this.t >= this.settleUntil) {
      const lim = this.interval * 1.5, cpuLim = this.interval * 0.75;
      let miss = 0;
      for (let i = 0; i < n; i++) if (this.win[i] > lim && this.cpu[i] < cpuLim) miss++;
      const frac = miss / n;
      this.lastMiss = frac;
      if (frac >= DynRes.DOWN_MISS) {
        this.clean = 0;
        if (this.scale > DynRes.MIN + 1e-3) {
          if (this.t - this.lastUpT < 6) this.lockUntil = this.t + DynRes.LOCK_S;
          const step = frac >= 0.15 ? 0.3 : frac >= 0.06 ? 0.2 : 0.1;
          this.scale = Math.max(DynRes.MIN, Math.round((this.scale - step) * 10) / 10);
          this.steps.down++;
          this.settleUntil = this.t + DynRes.SETTLE_S;
          changed = true;
        }
      } else if (frac < DynRes.CLEAN_MISS) {
        this.clean += this.acc;
        if (this.clean >= DynRes.UP_CLEAN_S && this.scale < 1 - 1e-3 && this.t >= this.lockUntil) {
          this.scale = Math.min(1, Math.round((this.scale + 0.1) * 10) / 10);
          this.steps.up++;
          this.lastUpT = this.t;
          this.settleUntil = this.t + DynRes.SETTLE_S;
          this.clean = 0;
          changed = true;
        }
      } else {
        this.clean = 0;
      }
    }
    this.n = 0;
    this.acc = 0;
    return changed;
  }
}

/** A fresh non-zero 31-bit seed (app-side: the sim only ever sees the number). */
export function freshSeed(): number {
  const s = (Math.floor(Math.random() * 0x7fffffff) ^ (Date.now() & 0x7fffffff)) >>> 0;
  return (s & 0x7fffffff) || 1;
}

/** Quality preset for a settings level (DPR ≤ BUDGET.dprMax always). */
export function qualityFor(level: 0 | 1 | 2, s: Settings): Quality {
  const base = defaultQuality();
  const cap = level === 0 ? 1 : level === 1 ? 1.25 : BUDGET.dprMax;
  return {
    dpr: Math.max(0.5, Math.min(base.dpr, cap, BUDGET.dprMax)),
    shadows: level > 0,
    level,
    reduceFlashing: !!s.reduceFlashing,
    screenShake: !!s.screenShake,
  };
}

/** rAF-or-timeout: lets the loading card paint, and never hangs in a hidden tab (rAF paused). */
function yieldFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => { if (!done) { done = true; resolve(); } };
    try { requestAnimationFrame(() => fin()); } catch { /* no rAF */ }
    setTimeout(fin, 120);
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Dispatch a synthetic key press (down + up) on window — drives a UI screen through its own keys. */
function synthKey(key: string, code: string): void {
  try {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }));
  } catch { /* no KeyboardEvent (non-browser) */ }
}

/** The loading / boot card from index.html (#boot). All no-ops when the page lacks it. */
class Splash {
  private readonly root: HTMLElement | null;
  private readonly fill: HTMLElement | null;
  private readonly status: HTMLElement | null;
  constructor(doc: Document) {
    this.root = doc.getElementById('boot');
    this.fill = doc.getElementById('boot-fill');
    this.status = doc.getElementById('boot-status');
  }
  show(text: string, frac: number): void {
    if (this.root) this.root.classList.remove('gone');
    this.set(text, frac);
  }
  set(text: string, frac: number): void {
    if (this.status && this.status.textContent !== text) this.status.textContent = text;
    if (this.fill) this.fill.style.width = `${Math.round(6 + 94 * clamp01(frac))}%`;
  }
  hide(): void { if (this.root) this.root.classList.add('gone'); }
  get visible(): boolean { return !!this.root && !this.root.classList.contains('gone'); }
}

// ─────────────────────────────── the app ───────────────────────────────

export class App {
  readonly params: AppParams;
  readonly canvas: HTMLCanvasElement;
  readonly uiRoot: HTMLElement;

  // engine
  readonly input: Input;
  readonly loop: GameLoop;
  readonly core: RenderCore;
  readonly rig: CameraRig;
  readonly lighting: Lighting;
  readonly views: readonly ViewModule[];
  readonly debug: DebugOverlay;

  // ui
  readonly hud: Hud;
  readonly broadcast: Broadcast;
  readonly bossbar: BossBar;
  readonly titleScreen: TitleScreen;
  readonly selectScreen: SelectScreen;
  readonly draftScreen: DraftScreen;
  readonly pauseMenu: PauseMenu;
  // v2 UI + views (FEATURES_V2 §13.1)
  readonly abilityBar: AbilityBar;
  readonly tracker: ObjectiveTracker;
  readonly markers: ScreenMarkers;
  readonly toasts: Toasts;
  readonly goalsScreen: GoalsScreen;
  readonly cineOverlay: CineOverlay;
  readonly cineCam: CineCam;
  private readonly markerView: MarkerView;
  private readonly titanView: TitanView;
  // ONLINE VS (B-VIEW)
  private readonly vsView: VsView;
  readonly vsHud: VsHud;
  readonly railUi: CardRail;
  readonly vsEndScreen: VsEndScreen;
  // ONLINE VS (O-LOBBY): the online menu + lobby, the in-match network notices, the live online match
  readonly lobbyUi: LobbyScreen;
  readonly netUi: NetNotices;

  // audio
  readonly audio: AudioEngine;
  readonly sfx: Sfx;
  readonly music: Music;

  /** called for unrecoverable errors (main.ts shows #fatal) */
  onFatal: FatalHandler = (title, err) => { console.error('[blocktooth]', title, err); };

  private _screen: Screen = 'boot';
  private _world: World | null = null;
  /** views mounted for the current world, in mount order */
  private mounted: ViewModule[] = [];
  /** world + views ready to update/render */
  private live = false;
  private epoch = 0;
  private loadLock: Promise<void> = Promise.resolve();
  private modal: Modal | null = null;
  private settings: Settings;
  private readonly splash: Splash;
  private portraits: Promise<Record<TitanId, string>> | null = null;
  private _choice: { titan: TitanId; biome: BiomeId; seed: number };

  // frame plumbing (double-buffered event lists: the list handed to views stays intact for a frame)
  private evA: SimEvent[] = [];
  private evB: SimEvent[] = [];
  private readonly noEvents: readonly SimEvent[] = [];
  private readonly ring: SimEvent[] = [];
  private ringHead = 0;
  private readonly fi: FrameInfo = { alpha: 1, dt: 0, time: 0, events: [], camDist: 1, frozen: true };
  private time = 0;

  // run-scoped app state
  private hitStopT = 0;
  /** real seconds left in which a newly owed draft waits for the MASS BREACH sting (0 = none) */
  private sizeUpHoldT = 0;
  /** adaptive render scale (see DynRes) */
  readonly dynres = new DynRes();
  /** wall ms inside core.render() this frame, and the previous frame's main-thread s without it (DynRes) */
  private renderMs = 0;
  private prevCpuS = 0;
  /** frames drawn since a frozen modal (draft / pause) opened, and the canvas key they were drawn at */
  private heldFrames = 0;
  private heldKey = '';
  /** ?prof=1 frame profiler (null otherwise) */
  readonly prof: FrameProf | null = null;
  private stingT = 0;
  // GATEKEEPERS (§4.3, §6.6): the gate nameplate hides 1.5 s after gateDefeated; the finale's app clock
  // (s since `finale on`, −1 = none) drives the SKIP hint (after GATES.finaleSkipS) and Enter / pad A
  private gateBarHideT = 0;
  private finaleAppT = -1;
  private finaleHint: HTMLElement | null = null;
  private civilians!: CivilianView;
  private musicAcc = 0;
  private lowHpArmed = true;
  private wantDraft = false;
  /** the draft owed now opens on the NEXT frame (see afterFrame): this frame drew the world */
  private draftArmed = false;
  private draftSuppressTick = -1;
  private ending = false;
  private endT = 0;
  private endResult: 'clear' | 'dead' | null = null;
  private _testFrozen = false;
  private forcedInput: TitanInput | null = null;

  // v2 app state (FEATURES_V2 §13.1)
  /** the persistent profile (in-memory copy; `?meta=` runs never touch storage) */
  private _profile: Profile;
  /** perk + palette chosen on the select screen (next runs) */
  private perkChoice: PerkId | null = null;
  private paletteChoice: Record<TitanId, number> = { molo: 0, voltkite: 0, hearthback: 0, briarwick: 0 };
  /** portrait cache per titan × palette (palette 0 = the canonical set) */
  private readonly portraitCache = new Map<string, Promise<string>>();
  /** the next opening plays the SHORT variant (RETRY) */
  private shortOpening = false;
  /** the cinematic overlay is up (dismiss() skips it instead of the slate) */
  private cinePlaying = false;
  private readonly face: FaceAnchor = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 1, h: 1 };
  /** goals met live this run (tabloid NEW ON THE RECORD) + the 1 Hz check timer */
  private runNewGoals: string[] = [];
  private goalsAcc = 0;
  /** v2 test surface (cheat.endless): the next clear tabloid picks KEEP GOING by itself, once */
  autoEndlessOnce = false;
  /** ONLINE_PLAN A.1.5: the forgeflowgames.com bridge client (no-op standalone / guest) + this run's filing */
  readonly portal: PortalClient;
  private runReport: { w: World; nonce: string; clearS: number | null; filing: RunFiling | null } | null = null;

  // ── ONLINE VS (lane B-VIEW) ──
  /** the live VS match's description (null in solo / outside a match) */
  private vsInfo: VsMatchInfo | null = null;
  private vsReq: VsRequest | null = null;
  /** the local human's seat */
  private vsLocal = 0;
  /** CARD RAIL edges captured by the frame, consumed by the first tick that follows (1..3 / reroll) */
  private vsRailPick = 0;
  private vsRailReroll = false;
  /** whose body the camera follows: 'own' · 'killer' (EVICTED respawn / the 2.5 s after an elimination) · 'spectate' */
  private vsMode: 'own' | 'killer' | 'spectate' = 'own';
  private vsFollowT = 0;
  /** the seat that knocked the local one out last (the spectate view prefers it while it lives) */
  private vsKiller = -1;
  private vsEndEv: { winner: number; placements: number[]; scores: number[] } | null = null;
  /**
   * VS RESULT REPORTING (O-REPORT, portal.ts vsMatchEnded): the online layer sets this to the running match's context (StartInfo.matchId,
   * the human seat count, the peers' account ids); null = offline VS PRACTICE (1 human, a match id made at load). Read once, at the end.
   */
  vsReport: VsReportCtx | null = null;
  private vsTally: VsEventTally | null = null;
  private vsMatchId = '';
  /** the last VS result's filing (what the portal answered) + the VS goals it earned: read by the tests and the end card */
  vsFiling: { matchId: string; goals: string[]; filing: VsFiling | null } | null = null;
  private readonly vsIn: (TitanInput | null)[] = [null, null, null, null];
  private readonly vsBuf = new Uint8Array(4);
  /** ONLINE VS (O-LOBBY): the live online match (null offline / in solo), the player's last online request (rematch), the account-id book */
  private online: OnlineMatch | null = null;
  private onlineReq: { mode: OnlineMode; code: string | null; titan: TitanId; biome: BiomeId } | null = null;
  private identityBook: VsIdentityBook | null = null;
  private rematchVoteEnd = 0;
  /** real seconds the VS aftermath (winner roar) runs before the end card */
  private static readonly VS_END_DELAY_S = 3;

  // error accounting
  private frameErrStreak = 0;
  private frameErrTotal = 0;
  private fatalShown = false;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement, params: AppParams) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.params = params;
    this.splash = new Splash(document);
    this.settings = loadSettings();
    this._profile = this.params.dev && this.params.meta ? emptyProfile() : loadProfile();
    this.perkChoice = this._profile.perk;
    for (const t of TITAN_IDS) this.paletteChoice[t] = this._profile.palette[t] ?? 0;
    this._choice = {
      titan: params.titan ?? 'molo',
      biome: params.biome ?? 'grideast',
      seed: params.seed ?? freshSeed(),
    };

    this.input = new Input(window);
    this.input.mode = 'ui';

    // render core + camera + lights (fixed light pool, created once)
    const level = params.quality ?? this.settings.quality;
    this.core = createRenderCore(canvas, qualityFor(level, this.settings));
    this.rig = new CameraRig(this.core.camera);
    // dev probes (?dev=1): the live rig (distance / auto distance / zoom) for the camera harness
    if (params.dev) (window as unknown as { __BTCAM__?: CameraRig }).__BTCAM__ = this.rig;
    this.lighting = new Lighting(this.core.scene);

    // every run-scoped view, constructed ONCE (CONTRACT §6); mount/unmount per run
    const ctx: ViewCtx = { renderer: this.core.renderer, scene: this.core.scene, camera: this.core.camera, quality: this.core.quality };
    this.titanView = new TitanView(ctx);
    this.markerView = new MarkerView(ctx);
    this.vsView = new VsView(ctx);
    this.views = [
      new EnvView(ctx),
      new CityView(ctx),
      (this.civilians = new CivilianView(ctx)),
      new PickupView(ctx),
      new DebrisView(ctx),
      this.titanView,
      new EnemyView(ctx),
      new BossView(ctx),
      new HazardView(ctx),
      new TelegraphView(ctx),
      new ProjectileView(ctx),
      new FxView(ctx),
      // v2 (FEATURES_V2 §2.6; L0 stubs, L6 fills)
      new ObjectiveView(ctx),
      new PowerupView(ctx),
      new PerSeat(ctx, (c) => new UltView(c)),
      this.markerView,
      this.vsView,
    ];
    this.cineCam = new CineCam(this.core.camera);

    // UI (HTML overlay). Layer z-order comes from ui/styles.css.
    this.hud = new Hud(uiRoot);
    this.bossbar = new BossBar(uiRoot);
    this.broadcast = new Broadcast(uiRoot, this.input);
    this.draftScreen = new DraftScreen(uiRoot, this.input);
    this.selectScreen = new SelectScreen(uiRoot, this.input);
    this.titleScreen = new TitleScreen(uiRoot, this.input);
    this.pauseMenu = new PauseMenu(uiRoot, this.input);
    this.pauseMenu.onSettings = (s) => this.applySettings(s);
    // v2 UI (FEATURES_V2 §13.1; L0 stubs, L8 / L9 / L10 fill)
    this.abilityBar = new AbilityBar(uiRoot);
    this.tracker = new ObjectiveTracker(uiRoot);
    this.markers = new ScreenMarkers(uiRoot);
    this.toasts = new Toasts(uiRoot);
    this.goalsScreen = new GoalsScreen(uiRoot, this.input);
    this.cineOverlay = new CineOverlay(uiRoot, this.input);
    // ONLINE VS (B-VIEW): the VS HUD, the CARD RAIL and the front-page end card (built once, shown only in a VS match)
    this.vsHud = new VsHud(uiRoot);
    this.railUi = new CardRail(uiRoot);
    this.vsEndScreen = new VsEndScreen(uiRoot, this.input);
    this.lobbyUi = new LobbyScreen(uiRoot, this.input);
    this.netUi = new NetNotices(uiRoot);
    this.netUi.onLeave = () => { void this.leaveOnline(); };
    this.vsHud.onSpectate = (d) => this.vsCycle(d);
    this.vsHud.onLeave = () => { void this.goTitle(); };
    this.vsHud.project = (x, y, z, out) => this.vsView.projectPoint(x, y, z, out);
    this.railUi.onPick = (n) => { this.vsRailPick = n; };
    this.railUi.onReroll = () => { this.vsRailReroll = true; };
    this.showHud(false);
    this.bossbar.hide();
    this.debug = new DebugOverlay(uiRoot);

    // audio (silent until unlocked by a gesture)
    this.audio = new AudioEngine();
    this.sfx = new Sfx(this.audio);
    this.music = new Music(this.audio);

    this.loop = new GameLoop(this.onStep, this.onFrame);
    const rs = Number(new URLSearchParams(location.search).get('rscale'));
    if (params.dev && rs >= 0.3 && rs <= 1) { this.dynres.scale = rs; this.dynres.pinned = true; this.core.setQuality(this.currentQuality()); }
    if (params.prof) {
      this.prof = new FrameProf(this.core.renderer);
      (window as unknown as { __BTPROF__?: FrameProf }).__BTPROF__ = this.prof;
      // shadow-pass attribution: wall ms of three's WebGLShadowMap.render per frame
      const sm = this.core.renderer.shadowMap as unknown as { render: (...a: unknown[]) => void; __ms?: number; __n?: number };
      const orig = sm.render.bind(sm);
      sm.render = (...a: unknown[]) => {
        const t0 = performance.now(), prevNeeds = (this.lighting as unknown as { sun?: { shadow: { needsUpdate: boolean; autoUpdate: boolean } } }).sun?.shadow;
        const will = !!prevNeeds && (prevNeeds.autoUpdate || prevNeeds.needsUpdate);
        orig(...a);
        if (will) { sm.__ms = (sm.__ms ?? 0) + performance.now() - t0; sm.__n = (sm.__n ?? 0) + 1; }
      };
    }
    this.applySettings(this.settings, false);
    this.installDomHooks();

    // ONLINE_PLAN A.1.5: portal bridge. `?meta=` harness runs keep an in-memory profile -> no cloud profile.
    this.portal = new PortalClient({
      cloudProfile: !(params.dev && params.meta),
      getProfile: () => this._profile,
      getBests: () => loadBest(),
      adopt: (p, b) => this.adoptCloudProfile(p, b),
      onChange: () => this.refreshAccountLine(),
    });
  }

  // ─────────────────────────────── public surface (main.ts, testsurface.ts) ───────────────────────────────

  get screen(): Screen { return this._screen; }
  /** the live world (read-only by convention — views and the test surface never write gameplay) */
  get world(): World | null { return this._world; }
  /** titan / biome / seed of the current (or next) run */
  get choice(): { titan: TitanId; biome: BiomeId; seed: number } { return { ...this._choice }; }
  get testFrozen(): boolean { return this._testFrozen; }
  /** v2: the in-memory profile (read-only by convention; test surface) */
  get profile(): Profile { return this._profile; }
  /** v2: the cinematic shot on screen (null outside the opening) */
  get cineShot(): { shot: string; t: number } | null {
    const s = this.cineCam.shot;
    return this.cinePlaying && s ? { shot: s.id, t: s.t } : null;
  }
  get isEnding(): boolean { return this.ending; }
  /** ONLINE VS (B-VIEW): the live match description (null in solo) and the follow state — test surface */
  get vs(): { info: VsMatchInfo; local: number; mode: 'own' | 'killer' | 'spectate'; view: number } | null {
    const w = this._world;
    return this.vsInfo && w ? { info: this.vsInfo, local: this.vsLocal, mode: this.vsMode, view: w.view } : null;
  }
  /** the live camera rig (VS framing probes) */
  get cameraRig(): CameraRig { return this.rig; }
  /** ONLINE VS test surface (dev): follow seat `slot` (spectate-style); returns the view seat */
  vsSetViewDev(w: World, slot: number): number {
    if (this.vsInfo && slot !== this.vsLocal) this.vsMode = 'spectate'; else if (this.vsInfo) this.vsMode = 'own';
    this.vsSetView(w, slot);
    return w.view;
  }

  /** Boot: start the frame loop, then the title (or ?autostart straight into a run). */
  async boot(): Promise<void> {
    this.portal.start();                                   // ONLINE_PLAN A.1.5: whoami (no-op outside the portal)
    this.splash.show(LOADING.boot, 0.1);
    this.loop.start();
    this.splash.set(LOADING.desk, 0.6);
    await yieldFrame();
    this.splash.set(LOADING.ready, 1);
    if (this.params.autostart && this.params.online) {         // DEV (?dev=1&autostart=1&online=quick|create|join): straight into the online flow
      const c = this._choice;
      const mode = this.params.online;
      const code = mode === 'create' ? (this.params.room ?? Room.makeCode()) : mode === 'join' ? (this.params.room ?? null) : null;
      this.splash.hide();
      await this.runOnline({ mode, code, titan: c.titan, biome: c.biome });
      return;
    }
    if (!this.params.autostart && this.params.room) {          // an invite link: pick a titan, then join that room
      this.splash.hide();
      void this.goOnlineSelect(this.params.room);
      return;
    }
    if (this.params.autostart) {
      const c = this._choice;
      if (this.params.vs) {                                 // ONLINE VS (B-VIEW): ?autostart=1&vs=1 → a VS PRACTICE match
        await this.startVs({ titan: c.titan, biome: c.biome, seed: c.seed, bots: this.params.bots ?? 'regular' });
        return;
      }
      await this.startRun({ titan: c.titan, biome: c.biome, seed: c.seed, skipSlate: this.params.noslate });
      return;
    }
    void this.goTitle();
  }

  /** Title screen → select → run. */
  async goTitle(): Promise<void> {
    const ep = ++this.epoch;
    await this.loadLock;
    if (ep !== this.epoch) return;
    await this.closeScreens();
    if (ep !== this.epoch) return;
    this.teardownRun();
    this.setScreen('title');
    this.input.mode = 'ui';
    this.splash.hide();
    this.music.play('title');
    this.modal = 'title';
    // pre-render the select portraits while the title is up (cached for the whole page; a no-op
    // once done) so Enter → select is instant
    if (!this.portraits) setTimeout(() => { if (ep === this.epoch && this._screen === 'title') void this.getPortraits(); }, 700);
    let pick: 'play' | 'goals' | 'vs' | 'online';
    try {
      pick = await this.titleScreen.run();
    } finally {
      if (this.modal === 'title') this.modal = null;
    }
    if (ep !== this.epoch) return;
    if (pick === 'goals') {          // v2: GOALS & RECORDS from the title, then back to the title
      void this.audio.unlock();
      await this.runGoals(ep);
      if (ep !== this.epoch) return;
      void this.goTitle();
      return;
    }
    if (pick === 'online') {         // ONLINE VS (O-LOBBY): titan + city, then QUICK MATCH / CREATE ROOM / JOIN WITH CODE
      void this.audio.unlock();
      this.sfx.ui('confirm');
      void this.goOnlineSelect(null);
      return;
    }
    if (pick === 'vs') {             // ONLINE VS (B-VIEW): VS PRACTICE
      void this.audio.unlock();
      this.sfx.ui('confirm');
      void this.goVsSelect();
      return;
    }
    void this.audio.unlock();       // the title's Enter/click is the first user gesture
    this.sfx.ui('confirm');
    void this.goSelect();
  }

  /** ONLINE VS (B-VIEW): VS PRACTICE select (titan + city + the rival bots' level) → startVs. null = back to the title. */
  async goVsSelect(initial?: Partial<SelectResume>, bots?: BotLevel): Promise<void> {
    const ep = ++this.epoch;
    await this.loadLock;
    if (ep !== this.epoch) return;
    await this.closeScreens();
    if (ep !== this.epoch) return;
    this.teardownRun();
    this.setScreen('loading');
    this.input.mode = 'ui';
    this.music.play('select');
    const pending = this.getPortraits();
    const slow = setTimeout(() => { if (ep === this.epoch) this.splash.show(LOADING.portraits, 0.5); }, 150);
    let portraits: Record<TitanId, string>;
    try { portraits = await pending; } finally { clearTimeout(slow); }
    this.splash.hide();
    if (ep !== this.epoch) return;
    this.setScreen('select');
    this.modal = 'select';
    let res: SelectResultV2 = null;
    try {
      res = await this.selectScreen.run({
        portraits,
        portraitFor: (t, pal) => this.portraitFor(t, pal),
        profile: this._profile,
        bests: loadBest(),
        initial: initial ?? { titan: this._choice.titan, biome: this._choice.biome },
        vs: true,
        bots: bots ?? this.vsReq?.bots ?? 'regular',
      });
    } finally {
      if (this.modal === 'select') this.modal = null;
    }
    if (ep !== this.epoch) return;
    if (!res || res.kind !== 'start') { this.sfx.ui('back'); void this.goTitle(); return; }
    this.sfx.ui('confirm');
    this.paletteChoice[res.titan] = res.palette;                 // the colourway is cosmetic and shared with solo
    this._profile.palette[res.titan] = res.palette;
    this.persistProfile();
    void this.startVs({ titan: res.titan, biome: res.biome, seed: freshSeed(), bots: res.bots ?? 'regular', palette: res.palette });
  }

  /** Titan + biome select → run (null result = back to the title). */
  async goSelect(initial?: Partial<SelectResume>): Promise<void> {
    const ep = ++this.epoch;
    await this.loadLock;
    if (ep !== this.epoch) return;
    await this.closeScreens();
    if (ep !== this.epoch) return;
    this.teardownRun();
    // 'loading' until the select screen actually takes input (portraits may still be rendering):
    // screen === 'select' must mean "the select screen is listening"
    this.setScreen('loading');
    this.input.mode = 'ui';
    this.music.play('select');
    // portraits are rendered once per page; show the card only if they are not ready yet
    const pending = this.getPortraits();
    const slow = setTimeout(() => { if (ep === this.epoch) this.splash.show(LOADING.portraits, 0.5); }, 150);
    let portraits: Record<TitanId, string>;
    try { portraits = await pending; } finally { clearTimeout(slow); }
    this.splash.hide();
    if (ep !== this.epoch) return;
    let from: Partial<SelectResume> = initial ?? { titan: this._choice.titan, biome: this._choice.biome };
    let res: SelectResultV2 = null;
    for (let guard = 0; guard < 32; guard++) {
      this.setScreen('select');
      this.modal = 'select';
      try {
        res = await this.selectScreen.run({
          portraits,
          portraitFor: (t, pal) => this.portraitFor(t, pal),
          profile: this._profile,
          bests: loadBest(),
          initial: from,
        });
      } finally {
        if (this.modal === 'select') this.modal = null;
      }
      if (ep !== this.epoch) return;
      if (!res || res.kind !== 'goals') break;
      // v2: GOALS & RECORDS from the select screen, then back to the same step / choice / row
      await this.runGoals(ep);
      if (ep !== this.epoch) return;
      from = res.resume;
    }
    if (!res || res.kind !== 'start') { this.sfx.ui('back'); void this.goTitle(); return; }
    this.sfx.ui('confirm');
    // v2: the chosen perk + palette are remembered (profile) and used by this and later runs
    this.perkChoice = res.perk;
    this.paletteChoice[res.titan] = res.palette;
    this._profile.perk = res.perk;
    this._profile.palette[res.titan] = res.palette;
    this.persistProfile();
    void this.startRun({ titan: res.titan, biome: res.biome, seed: freshSeed(), skipSlate: this.params.noslate });
  }

  /** v2: GOALS & RECORDS (from the title or the select screen). */
  private async runGoals(ep: number): Promise<void> {
    this.setScreen('goals');
    this.input.mode = 'ui';
    this.modal = 'goals';
    try {
      await this.goalsScreen.open(this._profile, loadBest());
    } finally {
      if (this.modal === 'goals') this.modal = null;
    }
    if (ep === this.epoch) this.sfx.ui('back');
  }

  /** v2 SelectRunOpts.portraitFor: one data URL per titan × palette (palette 0 = the canonical set). */
  private portraitFor(titan: TitanId, palette: number): Promise<string> {
    const pal = Number.isFinite(palette) ? Math.max(0, Math.min(2, Math.floor(palette))) : 0;
    if (pal === 0) return this.getPortraits().then((all) => all[titan] ?? '');
    const key = titan + '#' + pal;
    let p = this.portraitCache.get(key);
    if (!p) {
      p = renderPortrait(this.core.renderer, titan, PORTRAIT_PX, TITAN_PALETTES[titan][pal - 1]).catch((e: unknown) => {
        console.error('[blocktooth] palette portrait failed', e);
        this.portraitCache.delete(key);
        return '';
      });
      this.portraitCache.set(key, p);
    }
    return p;
  }

  /** v2: save the profile unless this is a `?meta=` harness run (in-memory only). */
  private persistProfile(): void {
    if (this.params.dev && this.params.meta) return;
    try { saveProfile(this._profile); } catch { /* storage is a nicety */ }
  }

  /** v2: the run meta for a titan (URL override → profile). */
  private runMetaFor(titan: TitanId): RunMeta {
    const P = this.params;
    if (P.dev && P.meta === 'full') {
      const unlocked = UPGRADES.filter((u) => u.locked).map((u) => u.id).sort();
      return { unlocked, perk: P.perk, palette: 0, reviveUsed: false };
    }
    if (P.dev && P.meta === 'fresh') return { ...EMPTY_RUN_META, unlocked: [], perk: P.perk };
    const perk = P.dev && P.perk ? P.perk : this.perkChoice;
    return runMetaFor(this._profile, titan, perk, this.paletteChoice[titan] ?? 0);
  }

  /**
   * Start a run: loading (createWorld, mount every view, warm shaders) → slate (or play with
   * skipSlate). Resolves once the slate is up (or play has begun) — NOT when the slate is dismissed.
   */
  async startRun(req: RunRequest): Promise<void> {
    const titan: TitanId = isTitan(req.titan) ? req.titan : 'molo';
    const biome: BiomeId = isBiome(req.biome) ? req.biome : 'grideast';
    const seed = Number.isFinite(req.seed) ? (Math.abs(Math.floor(req.seed)) >>> 0) : freshSeed();
    const ep = ++this.epoch;
    const prevLock = this.loadLock;
    let release: () => void = () => {};
    this.loadLock = new Promise<void>((r) => { release = r; });
    let ok = false;
    try {
      await prevLock;                                   // a superseded load bails at its next await
      if (ep !== this.epoch) return;
      await this.closeScreens();
      if (ep !== this.epoch) return;
      this.teardownRun();
      this._choice = { titan, biome, seed };
      this.shortOpening = !!req.short;
      ok = await this.loadRun(ep, titan, biome, seed, req.meta ?? this.runMetaFor(titan));
    } catch (e) {
      if (ep === this.epoch) this.fail('the run failed to load', e);
      return;
    } finally {
      release();
    }
    if (!ok || ep !== this.epoch) return;
    if (req.skipSlate) { this.enterPlay(); return; }
    void this.runOpening(ep);
  }

  /**
   * ONLINE VS (B-VIEW): start a VS PRACTICE match (you + 3 bots). Same load path as startRun (loading card, every view
   * mounted, shaders warmed) but the world is a 4-seat VS world and there is no slate / cinematic: play begins at the
   * COUNTDOWN (titans on their marks). Resolves when play has begun.
   */
  async startVs(req: VsRequest): Promise<void> {
    this.vsReport = null;                                              // VS PRACTICE is offline: 1 human + 3 bots (the online layer sets its own context)
    const titan: TitanId = isTitan(req.titan) ? req.titan : 'molo';
    const biome: BiomeId = isBiome(req.biome) ? req.biome : 'grideast';
    const seed = Number.isFinite(req.seed) ? (Math.abs(Math.floor(req.seed)) >>> 0) : freshSeed();
    const bots: BotLevel = req.bots === 'rookie' || req.bots === 'veteran' ? req.bots : 'regular';
    const build = buildVs({ titan, biome, seed, bots, palette: req.palette });
    const ep = ++this.epoch;
    const prevLock = this.loadLock;
    let release: () => void = () => {};
    this.loadLock = new Promise<void>((r) => { release = r; });
    let ok = false;
    try {
      await prevLock;
      if (ep !== this.epoch) return;
      await this.closeScreens();
      if (ep !== this.epoch) return;
      this.teardownRun();
      this._choice = { titan, biome, seed };
      this.vsReq = build.req;
      ok = await this.loadRun(ep, titan, biome, seed, EMPTY_RUN_META, build);
    } catch (e) {
      if (ep === this.epoch) this.fail('the VS match failed to load', e);
      return;
    } finally {
      release();
    }
    if (!ok || ep !== this.epoch) return;
    this.enterPlay();
  }

  /** Same VS setup, new seed (the pause menu's RETRY in a VS match). */
  retryVs(): Promise<void> {
    const r = this.vsReq;
    if (!r) return this.startVs({ titan: this._choice.titan, biome: this._choice.biome, seed: freshSeed(), bots: 'regular' });
    return this.startVs({ ...r, seed: freshSeed() });
  }

  /** Same titan + biome, new seed. */
  retry(): Promise<void> {
    if (this.vsInfo) return this.retryVs();
    const c = this._choice;
    return this.startRun({ titan: c.titan, biome: c.biome, seed: freshSeed(), skipSlate: this.params.noslate, short: true });   // v2: RETRY → short opening
  }

  /** Pause (Esc / P / __PAUSE__ / tab hidden). Only from live play. */
  pause(): void {
    if (this.online) {                                    // ONLINE VS: there is no pause; Esc asks LEAVE THE MATCH? and the match runs behind it
      if (this._screen === 'play' && !this.ending && this.online.live) { if (this.netUi.leaveAsked) this.netUi.closeLeave(); else this.netUi.askLeave(); }
      return;
    }
    if (this._screen === 'play' && !this.ending && this.live) void this.runPause();
  }

  /** the tab got hidden / the window lost focus: solo and practice pause; an online match cannot (the titan just stands still) */
  private autoPause(): void {
    if (this.online) { if (this.online.live) this.online.idleInput(); return; }
    this.pause();
  }

  /** Resume from the pause menu (drives the menu's own Resume path so its session closes cleanly). */
  resume(): void {
    if (this._screen === 'pause') void this.closeModalByKeys('pause');
  }

  togglePause(): void {
    if (this._screen === 'pause') this.resume();
    else this.pause();
  }

  /** Test surface: freeze / unfreeze the sim while in play (views keep idling). */
  freeze(on: boolean): void {
    this._testFrozen = !!on;
    // a draft granted by step() while frozen opens on the next frame — do not tick past it
    if (this._screen === 'play' && !this.ending) this.loop.simEnabled = !this._testFrozen && !this.wantDraft;
  }

  /** Test surface: run n ticks synchronously (only while frozen). */
  stepFrozen(n: number, input?: TitanInput | null): number {
    const w = this._world;
    if (!w || !this.live) throw new Error('step(): no live run');
    if (this.loop.simEnabled) throw new Error('step(): the sim is running — call freeze(true) first');
    const k = Number.isFinite(n) ? Math.max(0, Math.min(100000, Math.floor(n))) : 0;
    this.forcedInput = input ?? { mx: 0, mz: 0, ability: false, abilityHeld: false, dash: false };
    const t0 = w.tick;
    try {
      this.loop.stepSync(k);
    } finally {
      this.forcedInput = null;
    }
    // stepSync bypasses the loop's own freeze check; a draft/run end reached here opens on the next frame
    this.loop.simEnabled = false;
    return w.tick - t0;
  }

  /**
   * Test surface: dismiss whatever modal owns the game (slate / draft / tabloid / pause) through
   * its own close path. Resolves true when the screen changed.
   */
  async dismiss(): Promise<boolean> {
    const before = this._screen;
    switch (before) {
      case 'slate':
      case 'end': {
        if (before === 'end' && this.vsInfo) { synthKey('Enter', 'Enter'); break; }       // ONLINE VS end card: REMATCH → TITAN SWAP → LOCK IN
        if (before === 'slate' && this.cinePlaying) { this.cineOverlay.skip(); break; }   // v2 opening
        const b = this.broadcast as unknown as { dismiss?: () => boolean };
        if (typeof b.dismiss === 'function') b.dismiss();
        else synthKey('Enter', 'Enter');
        break;
      }
      case 'draft': await this.closeModalByKeys('draft'); break;
      case 'pause': await this.closeModalByKeys('pause'); break;
      case 'title': await this.closeModalByKeys('title'); break;
      case 'goals': await this.closeModalByKeys('goals'); break;
      default: return false;
    }
    for (let i = 0; i < 40 && this._screen === before; i++) await wait(50);
    return this._screen !== before;
  }

  /**
   * Run a world mutation OUTSIDE a tick (cheats, drafts) and route the events it emits to the
   * views/UI exactly like a tick's (world.events is only cleared at the next tick's start).
   */
  mutate<T>(fn: (w: World) => T): T {
    const w = this._world;
    if (!w) throw new Error('no live run');
    const n0 = w.events.length;
    const out = fn(w);
    const ev = w.events;
    for (let i = n0; i < ev.length; i++) this.pushEvent(ev[i]);
    return out;
  }

  /** The last n sim events (oldest first). */
  recentEvents(n: number): SimEvent[] {
    const total = Math.min(this.ring.length, EVENT_RING);
    const k = Math.max(0, Math.min(total, Number.isFinite(n) ? Math.floor(n) : total));
    const out: SimEvent[] = new Array(k);
    // newest sits at ringHead - 1
    let idx = (this.ringHead - k + EVENT_RING * 2) % EVENT_RING;
    for (let i = 0; i < k; i++) {
      out[i] = this.ring[idx];
      idx = (idx + 1) % EVENT_RING;
    }
    return out;
  }

  /** Renderer counters of the last rendered frame. */
  renderStats(): RenderStats { return this.core.stats(); }
  /** what the telegraph / hazard views drew last frame (tests: a live tell is ON SCREEN, not only in the sim) */
  viewStats(): { tgDrawn: number; tgBossDrawn: number; hzDrawn: number } {
    const tg = this.views.find((v): v is TelegraphView => v instanceof TelegraphView);
    const hz = this.views.find((v): v is HazardView => v instanceof HazardView);
    return { tgDrawn: tg ? tg.drawn : -1, tgBossDrawn: tg ? tg.bossDrawn : -1, hzDrawn: hz ? hz.drawn : -1 };
  }

  /**
   * Render one still frame right now (no events, dt 0 — nothing advances) and return the canvas
   * as a data URL. Used by __BT__.shot(); must run in one task so the drawing buffer is intact.
   */
  captureFrame(type: 'image/png' | 'image/jpeg' = 'image/png', quality = 0.92): string {
    const w = this._world;
    if (w && this.live) this.drawWorld(w, this.loop.alpha, 0, this.time, this.noEvents, false);
    else this.core.render();
    return this.core.renderer.domElement.toDataURL(type, quality);
  }

  /** Apply settings to audio, quality (DPR / shadows), screen shake and flashing. */
  applySettings(s: Settings, fromUser = true): void {
    this.settings = { ...s };
    this.audio.setVolumes(s.master, s.music, s.sfx);
    this.core.setQuality(this.currentQuality());
    try { document.documentElement.classList.toggle('bt-reduce-flash', !!s.reduceFlashing); } catch { /* no DOM */ }
    if (fromUser) this.sfx.ui('confirm');
  }

  /** The quality preset for the current settings × the adaptive render scale. */
  private currentQuality(): Quality {
    const q = qualityFor(this.params.quality ?? this.settings.quality, this.settings);
    if (this.params.dynres) q.dpr = Math.max(0.5, q.dpr * this.dynres.scale);
    return q;
  }

  // ─────────────────────────────── loading / teardown ───────────────────────────────

  /** Build the world and mount every view. Returns false when superseded (epoch changed). */
  private async loadRun(ep: number, titan: TitanId, biome: BiomeId, seed: number, meta: RunMeta, vs: VsBuild | null = null, preWorld: World | null = null): Promise<boolean> {
    this.setScreen('loading');
    this.input.mode = 'ui';
    this.splash.show(LOADING.city, 0.05);
    await yieldFrame();
    if (ep !== this.epoch) return false;

    const w = preWorld ?? (vs
      ? createWorld({ mode: 'vs', biome, seed, players: vs.seats, view: vs.info.local })
      : createWorld({ titan, biome, seed, meta }));
    this._world = w;
    this.vsInfo = vs ? vs.info : null;
    this.vsLocal = vs ? vs.info.local : 0;
    this.vsTally = vs ? new VsEventTally(vs.info.local) : null;      // O-REPORT: every SimEvent of the match, in order (pushEvent)
    this.vsMatchId = vs ? newVsPracticeMatchId(seed) : '';
    this.vsFiling = null;
    this.resetRunState();
    this.lighting.applyBiome(BIOMES[biome]);

    const n = this.views.length;
    for (let i = 0; i < n; i++) {
      const v = this.views[i];
      this.splash.set(LOADING.mount, 0.1 + 0.6 * (i / n));
      await v.mount(w);
      this.mounted.push(v);                         // recorded even if superseded, so teardown unmounts it
      if (ep !== this.epoch) return false;
      if (i % 3 === 2) {
        await yieldFrame();
        if (ep !== this.epoch) return false;
      }
    }

    // position every instance once (frozen, no events) so the warm frame sees the real scene.
    // `live` stays false until warmup is done: a view updating mid-warmup could flip visibility
    // that warmup is about to restore (it force-shows everything, then puts it back).
    this.rig.reset(w);
    this.drawWorld(w, 1, 0, this.time, this.noEvents, false, false);

    this.splash.set(LOADING.warm, 0.8);
    await yieldFrame();
    if (ep !== this.epoch) return false;
    await warmup(this.core.renderer, this.core.scene, this.core.camera);
    if (ep !== this.epoch) return false;
    await this.warmCompositor();
    if (ep !== this.epoch) return false;
    if (vs) {                                           // ONLINE VS: the seat cards need the four portraits
      const ph = await this.getPortraits();
      if (ep !== this.epoch) return false;
      this.vsHud.mount(w, vs.info, ph);
      this.vsHud.setCityName(BIOMES[biome].name);
      this.railUi.clear();
    }

    this.live = true;
    this.splash.set(LOADING.live, 1);
    // one real frame on screen before the card lifts (the slate freeze-frame is this picture)
    this.drawWorld(w, 1, 0, this.time, this.noEvents, false);
    this.splash.hide();
    return true;
  }

  /**
   * Compositor pre-warm (once per page). The FIRST draft of a session stalled the GPU process for
   * 240–280 ms with no script running (LoAF: 253 ms frame, 0 ms script) — the browser compiling
   * its filter shaders for the MUTATION REPORT backdrop (backdrop-filter blur + saturate) and the
   * dimmed cards (filter saturate + brightness) on the d3d11 ANGLE backend. Later drafts were
   * clean. Painting a tiny, near-transparent sample of those exact classes above the loading card
   * for a few frames moves that one-time compile into the load.
   */
  private compositorWarm = false;
  private async warmCompositor(): Promise<void> {
    if (this.compositorWarm || new URLSearchParams(location.search).get('warmui') === '0') return;
    const w = this._world;
    const layer = this.uiRoot.querySelector('.bt-draft');
    if (!w || !layer) return;
    this.compositorWarm = true;
    // a detached copy of the real MUTATION REPORT (backdrop, header, footer) + one real card per
    // rarity built by the draft screen itself, so every paint shader the first draft needs is seen
    const box = layer.cloneNode(true) as HTMLElement;
    box.classList.remove('bt-hidden');
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = 'z-index:901;opacity:.02;pointer-events:none';
    const cardsBox = box.querySelector('.bt-draft-cards');
    const build = (this.draftScreen as unknown as { buildCard?: (w: World, id: string, def: unknown, i: number) => HTMLElement }).buildCard;
    if (cardsBox && typeof build === 'function') {
      const seen = new Set<string>();
      const ids: string[] = [];
      for (const u of UPGRADES) if (!seen.has(u.rarity)) { seen.add(u.rarity); ids.push(u.id); }
      ids.forEach((id, i) => {
        try {
          const card = build.call(this.draftScreen, w, id, UPGRADE_BY_ID[id], i);
          if (i === 0) card.classList.add('is-sel');
          cardsBox.appendChild(card);
        } catch { /* warm only */ }
      });
    }
    this.uiRoot.appendChild(box);
    // replay the REAL deal-in (DraftScreen.animateIn) and then the pick classes. New Skia raster
    // programs compiled by the first real draft (Chrome trace, GrShaderCache::store): no warm-up 30;
    // the old generic fade/scale warm-up 11–12, all in one 50–80 ms flush on draft frame #4; this 3.
    const cards = Array.from(box.querySelectorAll<HTMLElement>('.bt-dossier'));
    try { DraftScreen.animateIn(cards, box.querySelector<HTMLElement>('.bt-draft-head'), false); } catch { /* no WAAPI */ }
    try {
      for (let i = 0; i < 12; i++) await yieldFrame();
      // then the pick: FILED stamp on one card, the others dropped (their own transitions + opacity)
      cards.forEach((c, i) => c.classList.add(i === 0 ? 'is-picked' : 'is-dropped'));
      for (let i = 0; i < 12; i++) await yieldFrame();
    } finally {
      box.remove();
    }
  }

  /** Unmount everything run-scoped and drop the world. Safe to call repeatedly. */
  private teardownRun(): void {
    this.loop.simEnabled = false;
    this.loop.timeScale = 1;
    this.live = false;
    for (let i = this.mounted.length - 1; i >= 0; i--) {
      try { this.mounted[i].unmount(); } catch (e) { console.error('[blocktooth] unmount failed', e); }
    }
    this.mounted = [];
    this._world = null;
    this.vsInfo = null;
    if (this.online) { try { this.online.leave(); } catch (e) { console.error('[blocktooth] online leave failed', e); } this.online = null; }
    if (this.identityBook) { try { this.identityBook.detach(); } catch { /* gone */ } }
    try { this.netUi.show(false); this.lobbyUi.clear(); } catch (e) { console.error('[blocktooth] online ui clear failed', e); }
    try { this.vsHud.clear(); this.railUi.clear(); this.vsEndScreen.clear(); } catch (e) { console.error('[blocktooth] vs ui clear failed', e); }
    this.showHud(false);
    this.bossbar.hide();
    this.broadcast.clear();
    this.stopCine();
    this.toasts.clear();
    this.evA.length = 0;
    this.evB.length = 0;
    this.ring.length = 0;
    this.ringHead = 0;
    this.resetRunState();
  }

  private resetRunState(): void {
    this.hitStopT = 0;
    this.sizeUpHoldT = 0;
    this.input.bufferS = INPUT_BUFFER_S;
    this.stingT = 0;
    this.gateBarHideT = 0;
    this.setFinaleHint(-1);
    this.musicAcc = 0;
    this.lowHpArmed = true;
    this.wantDraft = false;
    this.draftArmed = false;
    this.draftSuppressTick = -1;
    this.ending = false;
    this.endT = 0;
    this.endResult = null;
    this._testFrozen = false;
    this.forcedInput = null;
    this.loop.timeScale = 1;
    this.runNewGoals = [];
    this.goalsAcc = 0;
    this.vsRailPick = 0; this.vsRailReroll = false; this.vsMode = 'own'; this.vsFollowT = 0; this.vsKiller = -1; this.vsEndEv = null;
  }

  /** v2 abort path of the cinematic opening (closeScreens, teardown, every epoch change). */
  private stopCine(): void {
    this.cinePlaying = false;
    try { this.cineCam.stop(); } catch (e) { console.error('[blocktooth] cineCam.stop failed', e); }
    try { this.cineOverlay.clear(); } catch (e) { console.error('[blocktooth] cineOverlay.clear failed', e); }
    try { this.titanView.setCine(null); } catch { /* view not mounted */ }
  }

  /** The HUD and the v2 HUD pieces are shown / hidden together. */
  private showHud(on: boolean): void {
    const vs = on && !!this.vsInfo;
    this.hud.show(on);
    this.abilityBar.show(on);
    this.tracker.show(on && !vs);                       // the objective tracker is a solo rhythm (the KO feed owns the right column)
    this.markers.show(on);
    this.vsHud.show(vs);                                // ONLINE VS (B-VIEW)
    this.railUi.show(vs);
    this.netUi.show(vs && !!this.online);               // ONLINE VS (O-LOBBY): the notices + connection overlays
  }

  /**
   * Close whatever awaited modal is open, through its own path: broadcast.clear() for the slate
   * (resolves) and the tabloid (abandons); a synthetic key for the rest (their continuations are
   * epoch-guarded, so whatever they resolve with is ignored).
   */
  private async closeScreens(): Promise<void> {
    this.broadcast.clear();
    this.vsEndScreen.clear();
    this.lobbyUi.clear();
    this.stopCine();
    if (this.modal === 'slate' || this.modal === 'end') this.modal = null;
    const m = this.modal;
    if (m) await this.closeModalByKeys(m);
  }

  private async closeModalByKeys(m: Modal): Promise<void> {
    if (m === 'slate' || m === 'end') { this.broadcast.clear(); if (this.modal === m) this.modal = null; return; }
    const k = CLOSE_KEY[m];
    // a screen swallows presses for its first ~200–350 ms (armMs): retry until it closes
    for (let i = 0; i < 40 && this.modal === m; i++) {
      synthKey(k.key, k.code);
      await wait(90);
    }
    if (this.modal === m) {
      console.warn('[blocktooth] could not close the ' + m + ' screen through its keys');
      this.modal = null;
    }
  }

  // ─────────────────────────────── screens ───────────────────────────────

  private setScreen(s: Screen): void {
    this._screen = s;
    try { document.body.dataset.screen = s; } catch { /* no DOM */ }
  }

  /**
   * v2 opening (FEATURES_V2 §11 / §13.1): the WARD-7 STREET CAM cinematic when the setting (or ?cine)
   * asks for one AND CineCam.plan() returns a plan; otherwise the legacy freeze-frame slate (runSlate,
   * unchanged). The L0 stubs return no face anchor / no plan, so the slate always plays today.
   */
  private async runOpening(ep: number): Promise<void> {
    const w = this._world;
    if (!w) return;
    const setting = this.params.cine ?? this.settings.cinematic;
    const seenKey = w.titanId + '.' + w.biomeId;
    let plan = null;
    let variant: CineVariant = 'full';
    if (setting > 0) {
      variant = this.settings.reduceMotion ? 'reduced'
        : setting === 1 || this.shortOpening || this._profile.cineSeen[seenKey] === 1 ? 'short' : 'full';
      try {
        if (this.titanView.faceAnchor(this.face)) plan = this.cineCam.plan(w, this.rig, this.face, variant);
      } catch (e) {
        console.error('[blocktooth] cinematic plan failed — legacy slate', e);
        plan = null;
      }
    }
    this.shortOpening = false;
    if (!plan) { await this.runSlate(ep); return; }
    this.setScreen('slate');
    this.input.mode = 'ui';
    this.loop.simEnabled = false;
    this.showHud(false);
    this.music.stop();
    this.modal = 'slate';
    this.cinePlaying = true;
    let res: 'done' | 'skipped' | 'aborted' = 'aborted';
    try {
      this.cineCam.start(plan);
      const B = BIOMES[w.biomeId], T = TITANS[w.titanId];
      res = await this.cineOverlay.play(plan, {
        place: B.slate, sub: '', titanName: T.name,
        reduceFlash: !!this.settings.reduceFlashing, reduceMotion: !!this.settings.reduceMotion,
      });
    } catch (e) {
      console.error('[blocktooth] cinematic failed', e);
      res = 'skipped';
    } finally {
      if (this.modal === 'slate') this.modal = null;
      this.cinePlaying = false;
    }
    if (res === 'aborted' || ep !== this.epoch || this._world !== w) return;
    if (this.cineCam.active) this.cineCam.skip();
    this.titanView.setCine(null);
    if (res === 'done' && plan.variant === 'full') { this._profile.cineSeen[seenKey] = 1; this.persistProfile(); }
    void this.audio.unlock();
    this.enterPlay();
  }

  private async runSlate(ep: number): Promise<void> {
    const w = this._world;
    if (!w) return;
    this.setScreen('slate');
    this.input.mode = 'ui';
    this.loop.simEnabled = false;
    this.showHud(false);
    this.music.stop();
    this.sfx.ui('slate');
    this.modal = 'slate';
    try {
      await this.broadcast.openSlate(BIOMES[w.biomeId], TITANS[w.titanId]);
    } finally {
      if (this.modal === 'slate') this.modal = null;
    }
    if (ep !== this.epoch || this._world !== w) return;
    void this.audio.unlock();       // the slate's "press any key" is a user gesture too
    this.enterPlay();
  }

  private enterPlay(): void {
    const w = this._world;
    if (!w) return;
    this.setScreen('play');
    this.input.mode = 'game';
    this.input.clearEdges();
    this.showHud(true);
    this.loop.simEnabled = !this._testFrozen && !this.ending;
    this.musicAcc = MUSIC_PERIOD_S;               // refresh intensity on the next frame
    this.music.play(w.boss && w.boss.alive ? 'boss' : w.biomeId);
  }

  private async runDraft(): Promise<void> {
    const w = this._world;
    if (!w) return;
    const ep = this.epoch;
    this.setScreen('draft');
    this.input.mode = 'ui';
    this.loop.simEnabled = false;
    this.sfx.ui('draft');
    let guard = 0;
    while (ep === this.epoch && this._world === w && hasPendingDraft(w) && guard++ < 64) {
      const offer = this.mutate((ww) => rollOffer(ww));
      if (!offer || offer.length === 0) {
        // nothing offerable (should be impossible while hasPendingDraft is true) — never block play
        this.draftSuppressTick = w.tick + 30;
        break;
      }
      this.modal = 'draft';
      // v2: ids newly unlocked and not yet seen get the NEW ribbon once (markSeen + save right away)
      const U = w.upgrades;
      const newIds = offer.filter((id) => this._profile.newUnlocks.includes(id));
      if (newIds.length) { this._profile = markSeen(this._profile, newIds); this.persistProfile(); }
      let res: DraftResultV2;
      try {
        res = await this.draftScreen.open(w, offer, {
          rerollsLeft: Math.max(0, U.rerolls | 0), banishLeft: Math.max(0, U.banishLeft | 0),
          lockLeft: Math.max(0, U.lockLeft | 0), locked: U.locked, newIds,
        });
      } finally {
        if (this.modal === 'draft') this.modal = null;
      }
      if (ep !== this.epoch || this._world !== w) return;
      if ('reroll' in res) {
        this.mutate((ww) => rerollOffer(ww));
        this.sfx.ui('move');
        continue;
      }
      if ('banish' in res) {                     // v2 BANISH: same draft, refilled offer
        const bid = res.banish;
        this.mutate((ww) => banishCard(ww, bid));
        this.sfx.ui('move');
        continue;
      }
      if ('lock' in res) {                       // v2 LOCK (toggle): same draft
        const lid = res.lock;
        this.mutate((ww) => lockCard(ww, lid));
        this.sfx.ui('move');
        continue;
      }
      const id = res.pick;
      this.mutate((ww) => pickUpgrade(ww, id));
      this.sfx.ui('pick');
      const def = UPGRADE_BY_ID[id];
      if (def && def.evo && (w.upgrades.owned[id] ?? 0) > 0) {   // v2: an evolution was taken
        this.toasts.push({ kicker: EVO_TOAST_KICKER, title: EVO_TOAST_KICKER + ': ' + def.name.toUpperCase(), sub: '', glyph: 'evo' });
      }
    }
    if (ep !== this.epoch || this._world !== w) return;
    this.enterPlay();
  }

  private async runPause(): Promise<void> {
    const w = this._world;
    if (!w || this._screen !== 'play' || this.ending) return;
    const ep = this.epoch;
    this.setScreen('pause');
    this.input.mode = 'ui';
    this.loop.simEnabled = false;
    this.music.setIntensity(0.08);
    this.sfx.ui('back');
    this.modal = 'pause';
    let choice: 'resume' | 'retry' | 'quit';
    try {
      choice = await this.pauseMenu.open({ w });
    } finally {
      if (this.modal === 'pause') this.modal = null;
    }
    if (ep !== this.epoch || this._world !== w) return;
    // the menu saved whatever the player changed in Settings — make sure it is applied
    this.applySettings(loadSettings(), false);
    if (choice === 'retry') { this.sfx.ui('confirm'); void this.retry(); return; }
    if (choice === 'quit') { this.sfx.ui('back'); void this.goTitle(); return; }
    this.sfx.ui('confirm');
    this.enterPlay();
  }

  /** runEnd → aftermath timer (the sim is already stopped; fx keep playing). */
  private beginEnding(result: 'clear' | 'dead'): void {
    if (this.ending) return;
    this.ending = true;
    this.endResult = result;
    this.endT = END_DELAY_S;
    this.wantDraft = false;
    this.draftArmed = false;
    this.loop.simEnabled = false;
    this.loop.timeScale = 1;
    this.hitStopT = 0;
    this.sizeUpHoldT = 0;
    this.input.bufferS = INPUT_BUFFER_S;
    this.input.mode = 'ui';
    this.music.setIntensity(result === 'clear' ? 1 : 0.15);
    const w = this._world;
    if (w) {
      this.recordBests(w, result);
      this.fileRun(w, result);
    }
  }

  /** v2 run end (FEATURES_V2 §13.1): the profile ledger (applyRunToProfile → save → toasts). */
  private fileRun(w: World, result: 'clear' | 'dead'): void {
    try {
      const out = applyRunToProfile(this._profile, w, result);
      this._profile = out.profile;
      this.persistProfile();
      for (const id of out.newly) {
        if (!this.runNewGoals.includes(id)) this.runNewGoals.push(id);
        this.toastGoal(id);
        this.portal.achievement(id);                    // ONLINE_PLAN A.1.5 (no-op unless signed in)
      }
      this.portal.saveCloud();                          // cloud profile (write-locked until the account answered)
    } catch (e) {
      console.error('[blocktooth] profile update failed', e);
    }
  }

  /** v2: one GOAL MET toast for a goal id. */
  private toastGoal(id: string): void {
    const g = GOALS.find((x) => x.id === id);
    if (!g) return;
    const unlock = g.unlocks.length ? g.unlocks.map((u) => unlockLabel(u)).join(', ') : '';
    this.toasts.push({ kicker: 'GOAL MET', title: g.name, sub: unlock ? 'UNLOCKED: ' + unlock + ' — NEXT RUN' : '', glyph: 'ribbon' });
  }

  /** v2: live goal checks (1 Hz while playing): newly met run goals are filed, saved and toasted. */
  private checkGoals(w: World, dt: number): void {
    this.goalsAcc += dt;
    if (this.goalsAcc < GOALS_PERIOD_S) return;
    this.goalsAcc = 0;
    let ids: string[];
    try {
      ids = evalGoals(this._profile, w.tally, { titan: w.titanId, biome: w.biomeId, result: w.run.result, endT: w.run.endT });
    } catch (e) {
      console.error('[blocktooth] goal check failed', e);
      return;
    }
    let changed = false;
    for (const id of ids) {
      if (this._profile.done[id] !== undefined) continue;
      this._profile.done[id] = Date.now();
      changed = true;
      if (!this.runNewGoals.includes(id)) this.runNewGoals.push(id);
      this.toastGoal(id);
      this.portal.achievement(id);                      // ONLINE_PLAN A.1.5 (no-op unless signed in)
    }
    if (changed) this.persistProfile();
  }

  /** Aftermath over: photo right after a render, then the tabloid. */
  private async runTabloid(): Promise<void> {
    const w = this._world;
    if (!w) return;
    const ep = this.epoch;
    let photo = '';
    // the front-page photo is of the SUBJECT: live hostile telegraphs (and their x-ray pass) and
    // hazard paint are left out of it (the telegraph view has also faded them during the aftermath)
    const hidden: THREE_Object[] = [];
    for (const name of PHOTO_HIDDEN_ROOTS) {
      const o = this.core.scene.getObjectByName(name) as THREE_Object | undefined;
      if (o && o.visible) { o.visible = false; hidden.push(o); }
    }
    try {
      this.core.render();                               // the photo is THIS render
      photo = this.core.renderer.domElement.toDataURL('image/jpeg', 0.9);
    } catch (e) {
      console.error('[blocktooth] freeze-frame photo failed', e);
    } finally {
      for (const o of hidden) o.visible = true;
    }
    this.setScreen('end');
    this.showHud(false);
    this.bossbar.hide();
    this.music.play('tabloid');
    this.sfx.ui('print');
    this.modal = 'end';
    this.refreshAccountLine();                          // ONLINE_PLAN A.1.5: signed-in / guest line
    const canContinue = w.run.result === 'clear' && !w.endless;
    const newGoals = this.runNewGoals.map((id) => {
      const g = GOALS.find((x) => x.id === id);
      return { goal: g ? g.name : id, unlock: g ? g.unlocks.map((u) => unlockLabel(u)).join(', ') : '' };
    });
    let choice: TabloidChoiceV2;
    try {
      // `?endless=1` (dev harness): the clear front page picks KEEP GOING by itself
      if (canContinue && ((this.params.dev && this.params.endless) || this.autoEndlessOnce)) { this.autoEndlessOnce = false; choice = 'endless'; }
      else choice = await this.broadcast.tabloid(w, photo, { newGoals, canContinue, heldBy: this.heldBy(w) });
    } finally {
      if (this.modal === 'end') this.modal = null;
    }
    if (ep !== this.epoch) return;
    this.sfx.ui('confirm');
    if (choice === 'endless') { this.continueEndlessFlow(w); return; }
    if (choice === 'retry') void this.retry();
    else if (choice === 'select') void this.goSelect({ titan: w.titanId, biome: w.biomeId });
    else void this.goTitle();
  }

  /**
   * v2 KEEP GOING → EXTENDED COVERAGE (FEATURES_V2 §9.1). The stub continueEndless refuses, and the
   * app then falls back to RETRY (today's default choice).
   */
  private continueEndlessFlow(w: World): void {
    if (this._world !== w || !this.mutate((ww) => continueEndless(ww))) { void this.retry(); return; }
    // undo the ending state beginEnding set, or enterPlay would leave the sim frozen
    this.ending = false;
    this.endResult = null;
    this.endT = 0;
    this.hitStopT = 0;
    this.sizeUpHoldT = 0;
    this.loop.timeScale = 1;
    this.input.bufferS = INPUT_BUFFER_S;
    this.wantDraft = false;
    this.draftArmed = false;
    this.modal = null;
    this.bossbar.hide();
    // the runEnd fade blanked the telegraph + hazard stage; KEEP GOING does not remount the views,
    // so every view that faded on runEnd un-fades here (or no tell is ever drawn again this run)
    for (const v of this.views) v.resumeAfterEnd?.();
    const key: AlertKey = 'endless';
    this.evA.push({ type: 'alert', key });
    this.enterPlay();
    this.music.play(w.biomeId);
    this.music.setIntensity(0.8);
  }

  /**
   * File this run's personal bests (core/save.ts). The figures come from broadcast.runFigures —
   * the same generator the tabloid prints and compares with — and the bests as they stood BEFORE
   * this run are handed to the broadcast first, so its record book stamps exactly what fell.
   */
  private recordBests(w: World, result: 'clear' | 'dead'): void {
    try {
      const t = w.titanId, b = w.biomeId;
      this.broadcast.priorBests(loadBest());
      const fig = runFigures(w, result);
      const higher: Record<string, number> = {};
      for (const k in fig) if (k !== 'clearS') higher[bestKey(t, b, k)] = fig[k];
      saveBest(higher);
      if (fig.clearS !== undefined) saveBest(bestKey(t, b, 'clearS'), fig.clearS, true);   // lower wins
      if (w.endless) {                                  // v2 EXTENDED COVERAGE records (higher wins)
        const E = w.endless;
        saveBest({
          [bestKey(t, b, 'endlessS')]: Math.max(0, w.t - E.startT),
          [bestKey(t, b, 'endlessScore')]: E.score,
          [bestKey(t, b, 'rematches')]: E.rematches,
        });
      }
    } catch { /* storage blocked — bests are a nicety */ }
    this.reportRun(w, result);                          // ONLINE_PLAN A.1.5: the portal's run_result
  }

  /**
   * ONLINE_PLAN A.1.5: file this run with forgeflowgames.com (bt_submit_run through the portal bridge).
   * Once per run (World): the run's end; an EXTENDED COVERAGE continuation sends ONE follow-up with the SAME
   * run_nonce and phase 'endless' (result + clear_s stay the clear's). Read-only on the World; the portal
   * client drops it standalone / for guests / when the parent never answered.
   */
  private reportRun(w: World, result: 'clear' | 'dead'): void {
    try {
      let rep = this.runReport;
      let phase: 'run' | 'endless' = 'run';
      if (rep && rep.w === w) {
        if (!w.endless) return;                         // this World is already filed
        phase = 'endless';
      } else {
        rep = this.runReport = { w, nonce: newRunNonce(), clearS: null, filing: null };
      }
      const fig = runFigures(w, phase === 'endless' ? 'clear' : result);
      if (phase === 'run') rep.clearS = fig.clearS ?? null;
      // whole seconds on air (floored, what the tabloid prints) — but never below the clear time in tenths, so
      // bt_submit_run's `clear_s <= duration_s` holds for every clear (A-QA finding: 8.9 s clear vs 8 s floored)
      const durationS = Math.max(onAirSeconds(w), rep.clearS !== null ? Math.ceil(rep.clearS) : 0);
      if (durationS < 5) return;                       // bt_runs.duration_s >= 5 (a mis-click run is not a run)
      const E = w.endless;
      const t = w.tally;
      const payload: RunResultPayload = {
        run_nonce: rep.nonce,
        mode: 'solo',
        titan: w.titanId,
        biome: w.biomeId,
        result: phase === 'endless' ? 'clear' : result,
        duration_s: durationS,
        clear_s: rep.clearS,
        level: fig.level,
        peak_rank: fig.peakRank,
        kills: fig.kills,
        crushed: Math.max(0, Math.floor(t.crushed || 0)),
        tonnage: fig.tonnage,
        blocks: fig.blocks,
        bosses: Math.max(0, Math.floor(t.bossesDefeated || 0)),
        gate_kills: Math.max(0, Math.floor(t.gateKills || 0)),
        endless_s: E ? Math.max(0, Math.floor(w.t - E.startT)) : 0,
        endless_score: E ? Math.max(0, Math.floor(E.score)) : 0,
        rematches: E ? E.rematches : 0,
        titans_eaten: 0,
        vs_match_id: null,
        build_version: buildVersionFromUrl(location.search),
        phase,
      };
      const mine = rep;
      mine.filing = this.portal.signedIn ? { kind: 'sent' } : null;
      void this.portal.submitRun(payload).then((f) => {
        if (this.runReport !== mine) return;
        mine.filing = f;
        this.refreshAccountLine();
      });
    } catch (e) {
      console.error('[blocktooth] run report failed', e);
    }
  }

  /** ONLINE_PLAN A.1.5: the cloud profile merged with this device's — adopt it (and save it locally). */
  private adoptCloudProfile(p: Profile, bests: Record<string, number>): void {
    if (this.params.dev && this.params.meta) return;
    this._profile = p;
    this.perkChoice = p.perk;
    this.persistProfile();
    try {
      const cur = loadBest();
      const merged = mergeBests(cur, bests);
      const higher: Record<string, number> = {};
      for (const k in merged) {
        if (k.endsWith('.clearS')) { if (cur[k] === undefined || merged[k] < cur[k]) saveBest(k, merged[k], true); }
        else if (cur[k] === undefined || merged[k] > cur[k]) higher[k] = merged[k];
      }
      if (Object.keys(higher).length) saveBest(higher);
    } catch { /* storage blocked — bests are a nicety */ }
  }

  /** ONLINE_PLAN A.1.5: the end screen's signed-in / guest line (re-rendered when the identity or the ack changes). */
  private refreshAccountLine(): void {
    if (this.modal !== 'end') return;
    const st = this.portal.state;
    if (st === 'standalone' || st === 'silent' || st === 'waiting') { this.broadcast.setAccountLine(null); return; }
    if (st === 'guest') { this.broadcast.setAccountLine({ tone: 'guest', text: 'GUEST \u00b7 SIGN IN TO SAVE YOUR STATS' }); return; }
    const who = (this.portal.identity.username || 'YOUR ACCOUNT').toUpperCase();
    const rep = this.runReport;
    const f = rep && rep.w === this._world ? rep.filing : null;
    let sub = 'SIGNED IN';
    if (f && f.kind === 'sent') sub = 'FILING THIS RUN\u2026';
    else if (f && f.kind === 'noack') sub = 'THE SITE DID NOT CONFIRM THIS RUN';
    else if (f && f.kind === 'ack') {
      const city = rep ? (BIOMES[rep.w.biomeId]?.name ?? rep.w.biomeId).toUpperCase() : '';
      if (f.error) sub = 'RUN NOT FILED: ' + f.error.toUpperCase().slice(0, 60);
      else if (f.rank !== null) sub = `#${f.rank} ON THE ${city} BOARD`;
      else sub = f.already ? 'ALREADY ON FILE' : 'RUN FILED';
    }
    this.broadcast.setAccountLine({ tone: f && f.kind === 'ack' && !f.error ? 'filed' : 'signed', text: `${who} \u00b7 ${sub}` });
  }

  private getPortraits(): Promise<Record<TitanId, string>> {
    if (!this.portraits) {
      this.portraits = renderPortraits(this.core.renderer, PORTRAIT_PX).catch((e: unknown) => {
        console.error('[blocktooth] portrait render failed', e);
        this.portraits = null;                       // try again next time the select opens
        return {} as Record<TitanId, string>;
      });
    }
    return this.portraits;
  }

  // ─────────────────────────────── the loop ───────────────────────────────

  /** One sim tick. */
  private readonly onStep = (): void => {
    const w = this._world;
    if (!w || !this.live) return;
    try {
      this.input.update();                               // idempotent within one animation frame
      const inp = this.forcedInput ?? this.input.titanInput();
      if (w.mode === 'vs') this.vsStep(w, inp);
      else stepWorld(w, inp);
    } catch (e) {
      this.loop.simEnabled = false;
      this.fail('the simulation stopped', e);
      return;
    }
    const ev = w.events;
    for (let i = 0; i < ev.length; i++) this.pushEvent(ev[i]);   // a rankUp here arms sizeUpHoldT
    if (w.mode === 'vs') {
      // ONLINE VS: no modal drafts (the CARD RAIL never pauses the sim); the match end stops the sim like a solo run end
      if (w.run.result) { this.loop.simEnabled = false; this.beginVsEnding(w); }
    } else if (w.run.result) {
      this.loop.simEnabled = false;                      // run over: nothing more to simulate
    } else if (w.tick > this.draftSuppressTick && hasPendingDraft(w) && !(w.gates.finaleT > 0)) {
      // (GATEKEEPERS §4.3: draft screens are held for the finale — the level-ups stay owed)
      this.wantDraft = true;
      // freeze INSIDE the tick that granted it — unless the MASS BREACH sting is on screen: then
      // play runs on and the draft opens when the sting is over (afterFrame)
      if (!(this.sizeUpHoldT > 0) || this._testFrozen) this.loop.simEnabled = false;
    }
  };

  /** One rendered frame. */
  private readonly onFrame = (alpha: number, dt: number, time: number): void => {
    this.time = time;
    if (this.online && this.online.live) alpha = this.online.alpha;      // ONLINE VS: the session's Worker clock steps the sim, not this loop
    const f0 = performance.now();
    this.renderMs = 0;
    const P = this.prof;
    if (P) P.begin();
    try {
      this.input.update();
      if (this.input.pressed('debug')) this.debug.toggle();
      if (this._screen === 'play' && !this.ending && this.input.pressed('pause')) this.pause();
      // camera zoom (view-only; zoomInput is 0 while a screen owns input, and drains the wheel queue)
      const zin = this.input.zoomInput(dt);
      if (this._screen === 'play') {
        if (zin !== 0) this.rig.zoomBy(zin);
        if (this.input.pressed('zoomReset')) this.rig.resetZoom();
        if (this.vsInfo && !this.ending) this.vsFrameInput();
        if (this.online && this.online.live) this.onlineFrame(dt);
      }
      const w = this._world;
      if (w && this.live) {
        if (this.holdCanvas()) {
          // frozen modal (draft / pause): the world does not move, so the picture under the
          // (near-opaque, blurred) modal is held instead of redrawn — events keep collecting for
          // the first live frame; timers still run
          if (P) { P.mark('input'); P.annotate('held'); }
          this.afterFrame(w, dt);
          if (P) P.mark('afterFrame');
        } else {
          const events = this.swapEvents();
          if (P) P.mark('input');
          this.drawWorld(w, alpha, dt, time, events, true);
          this.afterFrame(w, dt);
          if (P) P.mark('afterFrame');
        }
      }
      if (this.params.dynres) {
        const live = !!w && this.live && this._screen === 'play' && (this.loop.simEnabled || !!(this.online && this.online.live)) && !this.ending && !this._testFrozen;
        if (this.dynres.frame(dt, live, this.prevCpuS)) { this.core.setQuality(this.currentQuality()); if (P) P.annotate('dynres->' + this.dynres.scale); }
        if (P) P.mark('dynres');
      }
      this.frameErrStreak = 0;
    } catch (e) {
      this.frameError(e);
    }
    this.prevCpuS = (performance.now() - f0 - this.renderMs + this.loop.lastSimMs) / 1000;
    if (P) {
      const L = this.loop;
      P.scale = this.dynres.scale;
      P.end(L.lastRawMs, L.lastTicks, L.lastSimMs, this.core.renderer.info, this._screen);
    }
    if (this.debug.visible) {
      try { this.debug.update(this._world, this.core.stats(), frameStats()); } catch { /* debug only */ }
    }
  };

  /**
   * Camera → lighting → views → HUD / boss bar / audio (+ app reactions) → render.
   * `react` = false for still frames (loading prime, shots): no audio/app reactions.
   */
  private drawWorld(w: World, alpha: number, dt: number, time: number, events: readonly SimEvent[], react: boolean, render = true): void {
    // ONLINE VS: the local titan is drawn where its own input will have taken it by the time the confirmed frames catch up
    // (render-side only: the sim's numbers are put back right after the draw, so the sim and the state hash never see it)
    const on = this.online;
    const pr = on && on.live && react && this._screen === 'play' && !this.ending
      ? on.beginPredict(w, dt, this.vsMode === 'own' && w.view === this.vsLocal) : null;
    try { this.drawWorldInner(w, alpha, dt, time, events, react, render); } finally { if (pr && on) on.endPredict(pr); }
  }

  private drawWorldInner(w: World, alpha: number, dt: number, time: number, events: readonly SimEvent[], react: boolean, render = true): void {
    const f = this.fi;
    f.alpha = alpha;
    f.dt = dt;
    f.time = time;
    f.events = events;
    f.frozen = this.viewsFrozen();
    f.camDist = this.rig.distance;
    const P = react ? this.prof : null;
    this.rig.update(w, f);
    f.camDist = this.rig.distance;
    if (P) P.mark('camera');
    this.lighting.update(w, this.rig);
    if (P) P.mark('lighting');
    const views = this.mounted;
    for (let i = 0; i < views.length; i++) {
      views[i].update(w, f);
      if (P) P.mark(views[i].constructor.name);
    }
    // v2 cinematic opening: CineCam owns the camera while active (after the rig, before the render)
    if (this.cineCam.active) {
      const on = this.cineCam.update(dt);
      this.cineOverlay.setShot(on ? this.cineCam.shot : null);
      this.titanView.setCine(on ? this.cineCam.channels() : null);
      if (P) P.mark('cine');
    }
    if (react) {
      // ONLINE VS: the solo HUD pieces read the VIEW seat only (the world cursor); another seat's events never reach them
      const own = w.mode === 'vs' && events.length ? this.ownEvents(w, events) : events;
      this.hud.update(w, dt);
      if (events.length) this.hud.onEvents(w, own);
      this.bossbar.update(w.boss, w.mode === 'vs');
      // v2 HUD (FEATURES_V2 §4, §13.1)
      this.abilityBar.update(w, dt);
      if (events.length) this.abilityBar.onEvents(w, own);
      this.tracker.update(w, dt);
      if (events.length) this.tracker.onEvents(w, own);
      this.markers.update(this.markerView.frame());
      if (w.mode === 'vs' && this.vsInfo) {
        const vc = { local: this.vsLocal, spectating: this.vsMode === 'spectate' };
        this.vsHud.update(w, dt, this.vsView.frame(), vc);
        if (events.length) this.vsHud.onEvents(w, events, vc);
        this.railUi.update(w, this.vsMode === 'own' && w.view === this.vsLocal, this.input.lastDevice === 'gamepad');
      }
      if (P) P.mark('hud');
      const tg = this.rig.target;
      this.sfx.onEvents(w, events, tg.x, tg.z);
      if (P) P.mark('sfx');
      if (events.length) this.appEvents(events);
      if (P) { P.mark('appEvents'); for (let i = 0; i < events.length; i++) if (events[i].type === 'rankUp' || events[i].type === 'levelUp') P.annotate(events[i].type); }
    }
    if (render) {
      if (P) P.gpuBegin();
      const r0 = performance.now();
      this.core.render();
      this.renderMs += performance.now() - r0;
      if (P) {
        P.gpuEnd(); P.mark('render');
        const R = this.core.renderer as unknown as { __resizeMs?: number };
        const SM = this.core.renderer.shadowMap as unknown as { __ms?: number; __n?: number };
        if (SM.__n) { P.annotate('sh' + (SM.__ms ?? 0).toFixed(1)); SM.__ms = 0; SM.__n = 0; }
        if (R.__resizeMs !== undefined) { P.annotate('resize=' + R.__resizeMs.toFixed(1) + 'ms'); R.__resizeMs = undefined; }
      }
    }
  }

  /**
   * true = skip this frame's world draw and keep the last presented picture. Only while a frozen
   * modal (draft / pause) is up: views are frozen there (viewsFrozen), so the picture cannot change,
   * yet the GPU kept redrawing ~1M triangles every frame under the modal while also compositing it.
   * On the reference Intel UHD at Size V that made 19 % of draft frames miss vsync (?prof=1, perfcheck
   * window: 29 of 154 draft frames > 30 ms; after the hold: 4 of 160). A canvas that is not drawn keeps
   * showing its last frame (preserveDrawingBuffer only matters for reads). Redrawn if the canvas box,
   * DPR or shadow setting changes while the modal is open (settings in the pause menu).
   */
  private holdCanvas(): boolean {
    const s = this._screen;
    // the frame between the tick that froze the sim for a draft and the draft opening (afterFrame):
    // the world cannot move, the last picture is the right one
    if (s === 'play' && this.draftArmed && !this.loop.simEnabled && !this.ending && !this._testFrozen) return true;
    if ((s !== 'draft' && s !== 'pause') || this.loop.simEnabled || this.ending || this._testFrozen) {
      this.heldFrames = 0;
      this.heldKey = '';
      return false;
    }
    const c = this.canvas, q = this.core.quality;
    const key = c.clientWidth + 'x' + c.clientHeight + '@' + q.dpr + (q.shadows ? 's' : '') + q.level;
    if (this.heldKey === '') {
      this.heldKey = key;                       // just opened: the canvas holds the last live frame
      this.heldFrames = HOLD_DRAWN;
    } else if (key !== this.heldKey) {
      this.heldKey = key;                       // resized / quality changed while open: redraw
      this.heldFrames = 0;
    }
    if (this.heldFrames < HOLD_DRAWN) { this.heldFrames++; return false; }
    return true;
  }

  /** Views idle (no sim-driven motion) everywhere except live play and the run-end aftermath. */
  private viewsFrozen(): boolean {
    if (this._screen !== 'play') return true;
    if (this.ending) return false;
    return this._testFrozen;
  }

  /** App-level reactions to this frame's events. */
  private appEvents(events: readonly SimEvent[]): void {
    const vw = this._world && this._world.mode === 'vs' ? this._world : null;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (vw && this.vsAppEvent(vw, e)) continue;
      switch (e.type) {
        case 'rankUp': this.onRankUp(e.rank); break;
        case 'alert': this.broadcast.alert(e.key); break;
        case 'bossSpawn': {
          const def = BOSSES[e.boss];
          if (def) this.bossbar.show(def);
          if (this._screen === 'play' || this._screen === 'draft') this.music.play('boss');
          this.stingT = Math.max(this.stingT, 3);
          break;
        }
        case 'bossPhase': this.stingT = Math.max(this.stingT, 2); break;
        case 'bossDefeated':
          // GATEKEEPERS §4.3.4: the (city) boss nameplate hides 1.5 s after the defeat stamp — the Size V finale
          // keeps the run going for 10 s, so the dead plate must not wait for beginEnding() to clear it
          this.gateBarHideT = 1.5; this.stingT = Math.max(this.stingT, 4); break;
        case 'eliteSpawn': this.stingT = Math.max(this.stingT, 2); break;
        case 'runEnd': this.beginEnding(e.result); break;
        case 'ultFire': this.onUltFire(); break;     // v2 UPROAR
        // ── GATEKEEPERS (§7.3; K0 pre-wire — the HUD / bossbar / sfx / views read the same events) ──
        case 'gateLocked': this.stingT = Math.max(this.stingT, 2); break;   // the GROW-bar lock refreshes from hud.onEvents
        case 'gateSpawn': {
          const def = BOSSES[e.gate];
          if (def) this.bossbar.show(def);           // ui/bossbar.ts renders the GATEKEEPER variant from def.role (lane K2b)
          this.gateBarHideT = 0;
          this.music.setIntensity(1);                // no track switch: the biome track at intensity 1 (§6.8)
          this.stingT = Math.max(this.stingT, 3);
          break;
        }
        case 'gateDefeated': this.gateBarHideT = 1.5; this.stingT = Math.max(this.stingT, 4); break;
        case 'finale': this.onFinale(e.on); break;
        default: break;
      }
    }
  }

  /** GATEKEEPERS §4.3: the Size V finale (app side). on: the boss track resolves into a brass swell (lane K2a's
   *  audio, called only when present), 120 fleeing civilians around the titan (render/civilians.ts surge,
   *  lane K2a — called only when present), the SKIP hint after GATES.finaleSkipS; draft screens are held
   *  (onStep). off: the hint goes (runEnd clear follows on the same tick). */
  private onFinale(on: boolean): void {
    if (!on) { this.setFinaleHint(-1); return; }
    this.setFinaleHint(0);
    // §4.3.4: the nameplate hides 1.5 s after the defeat stamp (bossDefeated pushes on the same tick; this
    // is the belt-and-braces for a finale whose defeat event was not seen by this app frame)
    if (!(this.gateBarHideT > 0)) this.gateBarHideT = 1.5;
    this.music.setIntensity(1);
    const mu = this.music as unknown as { swell?: () => void };
    if (typeof mu.swell === 'function') mu.swell();
    const w = this._world;
    const cv = this.civilians as unknown as Partial<CiviliansAddV3>;
    if (w && typeof cv.surge === 'function') cv.surge(w.titan.x, w.titan.z, 3 * w.titan.height, 120);
  }

  /** The finale SKIP hint: t < 0 removes it; t ≥ 0 keeps the app clock (shown from GATES.finaleSkipS). */
  private setFinaleHint(t: number): void {
    this.finaleAppT = t;
    if (t < 0) { if (this.finaleHint) { this.finaleHint.remove(); this.finaleHint = null; } return; }
  }

  private stepFinaleHint(w: World, dt: number): void {
    if (this.finaleAppT < 0) return;
    if (!(w.gates.finaleT > 0) || w.gates.finaleDone) { this.setFinaleHint(-1); return; }
    this.finaleAppT += dt;
    if (this.finaleAppT < GATES.finaleSkipS || this._screen !== 'play' || this.ending) return;
    const pad = this.input.lastDevice === 'gamepad';
    if (!this.finaleHint) {
      // the hint element (K0 inline style; the copy is K2b's STR_GATE.finaleSkip)
      const el = document.createElement('div');
      el.dataset.gate = 'finale-skip';
      el.style.cssText = 'position:absolute;right:24px;bottom:24px;font:700 14px/1 sans-serif;letter-spacing:.12em;color:#f4ecd8;'
        + 'background:rgba(27,20,38,.72);padding:8px 12px;border-radius:4px;pointer-events:none;z-index:40';
      this.uiRoot.appendChild(el);
      this.finaleHint = el;
    }
    const txt = pad ? STR_GATE.finaleSkip.pad : STR_GATE.finaleSkip.key;
    if (this.finaleHint.textContent !== txt) this.finaleHint.textContent = txt;
    // Enter (keyboard 'confirm' without Space's 'ability') or pad A (gameplay 'ability' from the gamepad)
    const enter = this.input.pressed('confirm') && !this.input.pressed('ability');
    const padA = pad && this.input.pressed('ability');
    if (enter || padA) { this.mutate((ww) => endFinale(ww)); }
  }

  /** v2 UPROAR fire (FEATURES_V2 §3.6): hit-stop, widened input buffer, camera punch (unless reduce motion). */
  private onUltFire(): void {
    if (this.ending || this._screen !== 'play' || this._testFrozen) return;
    if (!this.vsInfo && !(this.hitStopT > ULT.hitStopS)) {   // ONLINE VS never slows the sim (the lockstep clock is the clock)
      this.loop.timeScale = Math.min(this.loop.timeScale, ULT.hitStopScale);
      this.hitStopT = Math.max(this.hitStopT, ULT.hitStopS);
      this.input.bufferS = Math.max(this.input.bufferS, SIM_DT / ULT.hitStopScale + 0.02);
    }
    if (!this.settings.reduceMotion) {
      const r = this.rig as unknown as { punch?: (frac: number, s: number) => void };
      if (typeof r.punch === 'function') r.punch(0.06, 0.8);   // CameraRig.punch arrives with lane L6
    }
  }

  /** GATEKEEPERS §2.6: the gatekeeper that held the titan when it died (its name), else null. */
  private heldBy(w: World): string | null {
    if (w.run.result !== 'dead') return null;
    const b = w.boss;
    const live = b && b.alive && b.role === 'gate' ? b : null;
    if (!live && !(w.gates.active >= 1 && w.gates.active <= 3)) return null;
    const def = live ? BOSSES[live.id] : null;
    return def ? def.name : null;
  }

  private onRankUp(rank: RankIndex): void {
    if (!this.ending && this._screen === 'play' && !this._testFrozen && !this.vsInfo) {
      this.loop.timeScale = HITSTOP_SCALE;
      this.hitStopT = HITSTOP_S;
      this.input.bufferS = HITSTOP_BUFFER_S;
    }
    this.broadcast.sizeUp(rank);
    this.stingT = Math.max(this.stingT, 4);
    this.music.setIntensity(1);
  }

  /** Timers + transitions that follow a rendered frame. */
  private afterFrame(w: World, dt: number): void {
    if (this.hitStopT > 0) {
      this.hitStopT -= dt;
      if (this.hitStopT <= 0) { this.hitStopT = 0; this.loop.timeScale = 1; this.input.bufferS = INPUT_BUFFER_S; }
    }
    if (this.sizeUpHoldT > 0) this.sizeUpHoldT = Math.max(0, this.sizeUpHoldT - dt);
    if (this.stingT > 0) this.stingT = Math.max(0, this.stingT - dt);

    // GATEKEEPERS: the gate / boss nameplate hides 1.5 s after gateDefeated / bossDefeated (unless a new fight took the slot)
    if (this.gateBarHideT > 0) {
      this.gateBarHideT -= dt;
      if (this.gateBarHideT <= 0) { this.gateBarHideT = 0; if (!(w.boss && w.boss.alive)) this.bossbar.hide(); }
    }
    this.stepFinaleHint(w, dt);
    if (this._screen === 'play' && !this.ending) {
      this.musicAcc += dt;
      if (this.musicAcc >= MUSIC_PERIOD_S) {
        this.musicAcc = 0;
        this.music.setIntensity(this.musicIntensity(w));
      }
      this.checkLowHp(w);
      if (!this._testFrozen && this.loop.simEnabled && !this.vsInfo) this.checkGoals(w, dt);   // v2 (1 Hz)
      if (this.vsInfo) this.vsFollow(w, dt);
    }

    if (this.ending) {
      if (this._screen === 'play') {
        this.endT -= dt;
        if (this.endT <= 0) void (this.vsInfo ? this.runVsEnd() : this.runTabloid());       // renders + captures synchronously first
      }
      return;
    }
    if (this.wantDraft && this._screen === 'play' && !this._testFrozen && !(this.sizeUpHoldT > 0)) {
      // One frame later: the frame that froze the sim has just drawn the world (full GPU load); the
      // MUTATION REPORT's DOM build + style/layout/paint (4–7 ms of main thread) and its raster then
      // land on the next frame, whose world draw is held (holdCanvas) — on the reference Intel UHD
      // the two together in one frame were the most common draft-open vsync miss (?prof=1).
      if (!this.draftArmed) { this.draftArmed = true; return; }
      this.draftArmed = false;
      this.wantDraft = false;
      void this.runDraft();
    }
  }

  private musicIntensity(w: World): number {
    const T = w.titan;
    let alive = 0;
    const E = w.enemies;
    for (let i = 0; i < E.length; i++) if (E[i].alive) alive++;
    let x = 0.3 + 0.07 * T.rank + Math.min(0.3, alive / 90);
    if (w.boss && w.boss.alive) x = Math.max(x, 0.72 + 0.09 * (w.boss.phase - 1));
    const hpF = T.maxHp > 0 ? T.hp / T.maxHp : 1;
    if (hpF < 0.35) x += 0.12;
    if (this.stingT > 0) x += 0.25 * Math.min(1, this.stingT / 2);
    return clamp01(x);
  }

  /** The sim has no low-HP alert emitter: the app raises `alert lowHp` once per dip (hysteresis). */
  private checkLowHp(w: World): void {
    const T = w.titan;
    if (!T.alive || !(T.maxHp > 0)) return;
    const f = T.hp / T.maxHp;
    if (this.lowHpArmed && f < LOW_HP_FIRE) {
      this.lowHpArmed = false;
      const key: AlertKey = 'lowHp';
      // routed through next frame's event list so the HUD, broadcast and sfx all see it
      this.evA.push({ type: 'alert', key });
    } else if (!this.lowHpArmed && f > LOW_HP_REARM) {
      this.lowHpArmed = true;
    }
  }

  // ─────────────────────────────── ONLINE VS (lane O-LOBBY) ───────────────────────────────
  //
  // title [O] → select (titan + city; an invite link `?room=CODE` skips the city) → the menu (QUICK MATCH / CREATE ROOM / JOIN WITH
  // CODE) → the lobby → START: the world is built from the START (src/online.ts), every view is mounted against it, THEN the links
  // are waited for → play. The sim is stepped by the session's Worker clock (never by this app's rAF loop); this frame loop samples
  // input, renders with an interpolation alpha + the cosmetic prediction, and shows the net notices. There is no pause online: Esc
  // asks LEAVE THE MATCH? and the match keeps running behind it. The end card runs a 15 s REMATCH vote (same cast, new room code).

  /** the display name: the signed-in account name, else GUEST-xxxx (DEV: ?name=) */
  private onlineName(): string {
    if (this.params.uname) return this.params.uname;
    const u = this.portal.identity.username;
    return (u ? cleanName(u) : '') || guestName();
  }

  /** ONLINE VS: titan + city, then the menu. `inviteCode` (from ?room=) = the titan only, then JOIN that room. */
  async goOnlineSelect(inviteCode: string | null, initial?: Partial<SelectResume>): Promise<void> {
    const ep = ++this.epoch;
    await this.loadLock;
    if (ep !== this.epoch) return;
    await this.closeScreens();
    if (ep !== this.epoch) return;
    this.teardownRun();
    this.setScreen('loading');
    this.input.mode = 'ui';
    this.music.play('select');
    const pending = this.getPortraits();
    const slow = setTimeout(() => { if (ep === this.epoch) this.splash.show(LOADING.portraits, 0.5); }, 150);
    let portraits: Record<TitanId, string>;
    try { portraits = await pending; } finally { clearTimeout(slow); }
    this.splash.hide();
    if (ep !== this.epoch) return;
    let from: Partial<SelectResume> = initial ?? { titan: this._choice.titan, biome: this._choice.biome };
    for (let guard = 0; guard < 16; guard++) {
      this.setScreen('select');
      this.modal = 'select';
      let res: SelectResultV2 = null;
      try {
        res = await this.selectScreen.run({
          portraits,
          portraitFor: (t, pal) => this.portraitFor(t, pal),
          profile: this._profile,
          bests: loadBest(),
          initial: from,
          vs: true,
          online: true,
          titanOnly: !!inviteCode,
        });
      } finally {
        if (this.modal === 'select') this.modal = null;
      }
      if (ep !== this.epoch) return;
      if (!res || res.kind !== 'start') { this.sfx.ui('back'); void this.goTitle(); return; }
      this.sfx.ui('confirm');
      this._choice = { titan: res.titan, biome: res.biome, seed: this._choice.seed };
      if (inviteCode) { await this.runOnline({ mode: 'join', code: inviteCode, titan: res.titan, biome: res.biome }); return; }
      const ch = await this.onlineMenu(ep, res.titan, portraits);
      if (ep !== this.epoch) return;
      if (!ch) { from = { titan: res.titan, biome: res.biome, step: 2 }; continue; }   // BACK: the select screen on the city step
      await this.startOnlineChoice(ch, res.titan, res.biome);
      return;
    }
  }

  /** the 3-way menu over the select backdrop (screen 'lobby' while it is up); null = BACK */
  private async onlineMenu(ep: number, titan: TitanId, portraits: Record<TitanId, string>): Promise<MenuChoice | null> {
    this.setScreen('lobby');
    this.input.mode = 'ui';
    this.modal = null;
    const ch = await this.lobbyUi.openMenu({ titan, portraits, code: undefined });
    if (ep !== this.epoch) return null;
    if (!ch) this.sfx.ui('back'); else this.sfx.ui('confirm');
    return ch;
  }

  private startOnlineChoice(ch: MenuChoice, titan: TitanId, biome: BiomeId): Promise<void> {
    const code = ch.kind === 'create' ? Room.makeCode() : ch.kind === 'join' ? ch.code : null;
    return this.runOnline({ mode: ch.kind, code, titan, biome });
  }

  /** the lobby leave button: back to the menu (same titan + city), or the title for an invite / rematch room */
  private async backFromLobby(req: { mode: OnlineMode; titan: TitanId; biome: BiomeId }): Promise<void> {
    if (req.mode === 'rematch' || req.mode === 'join') { void this.goTitle(); return; }
    const ep = ++this.epoch;
    await this.loadLock;
    if (ep !== this.epoch) return;
    await this.closeScreens();
    if (ep !== this.epoch) return;
    this.teardownRun();
    this.setScreen('loading');
    const portraits = await this.getPortraits();
    if (ep !== this.epoch) return;
    const ch = await this.onlineMenu(ep, req.titan, portraits);
    if (ep !== this.epoch) return;
    if (!ch) { void this.goTitle(); return; }
    await this.startOnlineChoice(ch, req.titan, req.biome);
  }

  /** start the online flow: open the lobby, open the room, and wait for the START */
  async runOnline(req: { mode: OnlineMode; code: string | null; titan: TitanId; biome: BiomeId; waitMs?: number; expectHumans?: number }): Promise<void> {
    const ep = ++this.epoch;
    await this.loadLock;
    if (ep !== this.epoch) return;
    await this.closeScreens();
    if (ep !== this.epoch) return;
    this.teardownRun();
    this.vsReport = null;
    this.onlineReq = { mode: req.mode, code: req.code, titan: req.titan, biome: req.biome };
    this._choice = { titan: req.titan, biome: req.biome, seed: this._choice.seed };
    this.setScreen('lobby');
    this.input.mode = 'ui';
    this.music.play('select');
    const portraits = await this.getPortraits();
    if (ep !== this.epoch) return;
    const handle = this.lobbyUi.openLobby(portraits);
    this.lobbyUi.onStartNow = () => { if (this.online) this.online.startNow(); };
    const build = this.params.build ?? buildVersionFromUrl(location.search) ?? 'dev';
    const m = new OnlineMatch({
      mode: req.mode, code: req.code, titan: req.titan, biome: req.biome, name: this.onlineName(), build,
      gameId: this.params.ns ? 'blocktooth-' + this.params.ns : undefined, waitMs: req.waitMs, expectHumans: req.expectHumans,
      log: this.params.dev ? (msg: string) => console.log('[net] ' + msg) : undefined,
    }, {
      lobby: (s: LobbyState) => { if (this.online === m) handle.update(s); },
      load: (w, info, seat) => this.loadOnlineWorld(ep, m, w, info, seat),
      started: (info, seat, joined) => { if (this.online === m && ep === this.epoch) { handle.close(); this.enterOnlinePlay(m, info, joined); } },
      tick: (w) => { if (this.online === m) { const ev = w.events; for (let i = 0; i < ev.length; i++) this.pushEvent(ev[i]); } },
      notice: (n: Notice) => { if (this.online === m) this.netUi.push(n); },
      connection: (c: Connection) => { if (this.online === m) this.netUi.setConnection(c); },
      infoChanged: () => { if (this.online === m) this.vsHud.refreshSeats(); },
      rebuilt: (w) => { if (this.online === m) void this.rebindOnlineWorld(ep, m, w); },
      ended: () => { /* every peer holds the same standings; the end card reads the world */ },
      failed: (why, where) => {
        console.warn('[blocktooth] online', where, why);
        if (this.online === m && where === 'match') this.netUi.push({ key: 'failed', text: why.toUpperCase().slice(0, 80), tone: 'bad', ttlMs: 8000 });
      },
    });
    this.online = m;
    (window as unknown as { __BTONLINE__?: unknown }).__BTONLINE__ = { match: () => this.online, debug: () => (this.online ? this.online.debug() : null), app: this };
    void handle.done.then(() => {
      if (this.online === m && !m.live && ep === this.epoch) {            // LEAVE / Esc in the lobby
        const rq = { mode: req.mode, titan: req.titan, biome: req.biome };
        m.leave();
        this.online = null;
        void this.backFromLobby(rq);
      }
    });
    await m.begin();
  }

  /** the START arrived: mount every view against the world the session will adopt (its links are not waited for yet) */
  private async loadOnlineWorld(ep: number, m: OnlineMatch, w: World, info: VsMatchInfo, seat: number): Promise<void> {
    if (ep !== this.epoch || this.online !== m) throw new Error('cancelled');
    const prevLock = this.loadLock;
    let release: () => void = () => {};
    this.loadLock = new Promise<void>((r) => { release = r; });
    try {
      await prevLock;
      if (ep !== this.epoch || this.online !== m) throw new Error('cancelled');
      const titan = info.seats[seat] ? info.seats[seat].titan : this._choice.titan;
      const req: VsRequest = { titan, biome: info.biome, seed: info.seed, bots: 'regular' };
      this._choice = { titan, biome: info.biome, seed: info.seed };
      this.vsReq = req;
      const ok = await this.loadRun(ep, titan, info.biome, info.seed, EMPTY_RUN_META, { seats: [], info, req }, w);
      if (!ok || ep !== this.epoch || this.online !== m) throw new Error('cancelled');
    } finally {
      release();
    }
  }

  /** the links are up, the sim runs: leave the lobby behind and play */
  private enterOnlinePlay(m: OnlineMatch, info: VsMatchInfo, joined: boolean): void {
    const w = this._world;
    if (!w || !m.start) return;
    const T0 = performance.now();
    const lap = (what: string): void => { if (this.params.dev) console.log('[net] ol: enterOnlinePlay ' + what + ' +' + Math.round(performance.now() - T0) + ' ms'); };
    const book = this.identityBook ?? (this.identityBook = new VsIdentityBook(this.portal));
    book.attach(m.session.room, m.start.matchId);
    lap('book');
    this.vsReport = {
      matchId: m.start.matchId,
      humans: m.humansAtStart,
      uidsBySlot: () => book.uidsBySlot(m.session.peer ? m.session.peer.roster() : []),
      // O-REPORT: wait (<= 4 s) for the other live humans' RESULT hashes, then file only when MY hash is held by a strict majority (resultsMajority)
      ready: () => {
        const p = m.session.peer;
        if (!p) return true;
        const others = p.roster().filter((s) => s.peer && !s.left && s.peer !== m.session.room.id).length;
        return p.results.size >= others;
      },
      skip: () => {
        const me = this._world ? this._world.players[m.seat] : null;
        const p = m.session.peer;
        if (!me || me.bot !== null || !!(p && (p.state === 'desynced' || p.state === 'left'))) return true;
        return !!(p && p.standings && !resultsMajority(p.standings.hash, [...p.results.values()].map((r) => r.hash)));
      },
    };
    this.setScreen('play');
    this.input.mode = 'game';
    this.input.clearEdges();
    lap('input');
    this.showHud(true);
    lap('hud');
    this.loop.simEnabled = false;                     // the session's Worker clock steps the sim
    this.musicAcc = MUSIC_PERIOD_S;
    this.music.play(w.biomeId);
    lap('music');
    this.vsHud.refreshSeats();
    this.netUi.setConnection(joined ? 'catchup' : 'ok');
    void info;
    // the session adopted the world built in beforeStart; a different object means it rebuilt: rebind
    const sw = m.world;
    if (sw && sw !== w) void this.rebindOnlineWorld(this.epoch, m, sw);
  }

  /** a stepped-down host's session rebuilt its world from tick 0: mount the views against the new object */
  private async rebindOnlineWorld(ep: number, m: OnlineMatch, w: World): Promise<void> {
    if (ep !== this.epoch || this.online !== m || !this.vsInfo) return;
    this.live = false;
    this.splash.show(LOADING.city, 0.4);
    for (let i = this.mounted.length - 1; i >= 0; i--) { try { this.mounted[i].unmount(); } catch (e) { console.error('[blocktooth] unmount failed', e); } }
    this.mounted = [];
    this._world = w;
    this.evA.length = 0; this.evB.length = 0;
    for (const v of this.views) {
      await v.mount(w);
      this.mounted.push(v);
      if (ep !== this.epoch || this.online !== m) return;
    }
    this.rig.reset(w);
    const ph = await this.getPortraits();
    this.vsHud.mount(w, this.vsInfo, ph);
    this.vsHud.setCityName(BIOMES[this.vsInfo.biome].name);
    this.railUi.clear();
    this.live = true;
    this.splash.hide();
  }

  /** per rendered frame while an online match runs: the input sample, the notices, the connection overlay */
  private onlineFrame(dt: number): void {
    const on = this.online;
    if (!on) return;
    if (this.netUi.leaveAsked && this.input.pressed('confirm') && !this.input.pressed('ability')) { void this.leaveOnline(); return; }
    // a tab that was hidden through the end of the match replays it in one catch-up (the history's events are dropped): the decided
    // world is the source of truth, so the end card never depends on having seen the `vsEnd` event
    const dw = this._world;
    if (dw && dw.mode === 'vs' && dw.run.result && !this.ending && on.live) this.beginVsEnding(dw);
    if (!this.ending) {
      const raw = this.forcedInput ?? this.input.titanInput();
      let card = 0;
      if (this.vsRailReroll) card = CARD.REROLL;
      else if (this.vsRailPick >= 1 && this.vsRailPick <= 3) card = this.vsRailPick;
      this.vsRailPick = 0; this.vsRailReroll = false;
      on.setInput(raw, card);
    }
    on.session.kick();                                // a second pump driver beside the Worker clock (see OnlineSession.kick)
    on.frame(dt);
    this.netUi.update();
    if (on.connection === 'catchup' || on.catchingUp) {
      const p = on.session.peer;
      if (p) this.netUi.setCatchup(p.confirmed > 0 ? p.simTick / p.confirmed : 0);
    }
  }

  /** LEAVE the match / the end card: the seat becomes a bot for the others, this player returns to the title */
  async leaveOnline(): Promise<void> {
    const on = this.online;
    if (on) on.leave();
    await this.goTitle();
  }

  /** the end card's REMATCH: the same cast meets again in a new room (code derived from the old one), a fresh seed, the next city */
  private rematchOnline(titan: TitanId, biome: BiomeId): void {
    const on = this.online;
    if (!on) return;
    const w = this._world;
    const code = rematchCode(on.roomCode ?? 'ROOM');
    const humans = w ? w.players.filter((P) => P.bot === null && P.vs.data.left !== 1).length : on.humansAtStart;
    const next = REMATCH_BIOMES[(Math.max(0, REMATCH_BIOMES.indexOf(biome as typeof REMATCH_BIOMES[number])) + 1) % REMATCH_BIOMES.length];
    const left = Math.max(0, this.rematchVoteEnd - performance.now());
    on.leave();
    this.online = null;
    void this.runOnline({ mode: 'rematch', code, titan, biome: next, waitMs: left + 1200, expectHumans: humans });
  }

  // ─────────────────────────────── ONLINE VS (lane B-VIEW) ───────────────────────────────

  /** The events of the VIEW seat (and the match-level ones): what the solo HUD pieces may react to. */
  private ownEvents(w: World, ev: readonly SimEvent[]): readonly SimEvent[] {
    const out = this.vsOwnBuf;
    out.length = 0;
    for (let i = 0; i < ev.length; i++) {
      const p = ev[i].p;
      if (p === undefined || p < 0 || p === w.view) out.push(ev[i]);
    }
    return out;
  }
  private readonly vsOwnBuf: SimEvent[] = [];

  /**
   * One VS tick: the human's command is quantised through net/proto.ts (exactly the word the online session puts on the
   * wire: the local sim must step the DECODED input, netcode.md 6.3) with the CARD RAIL byte; every other seat gets
   * null (bots are driven by the sim's bot brain, an online peer by its own frame).
   */
  private vsStep(w: World, raw: TitanInput): void {
    let card = 0;
    if (this.vsRailReroll) card = CARD.REROLL;
    else if (this.vsRailPick >= 1 && this.vsRailPick <= 3) card = this.vsRailPick;
    this.vsRailPick = 0; this.vsRailReroll = false;
    const buf = this.vsBuf;
    encodeInput(raw, buf, 0, card);
    const dec = decodeInput(buf, 0);
    if (card === CARD.REROLL) dec.railReroll = true;
    else if (card > 0) dec.railPick = card;
    const ins = this.vsIn;
    for (let i = 0; i < ins.length; i++) ins[i] = null;
    ins[this.vsLocal] = dec;
    stepWorldN(w, ins);
  }

  /** per rendered frame in a VS match: rail edges, spectate keys, the map toggle */
  private vsFrameInput(): void {
    const I = this.input;
    if (I.pressed('pick1')) this.vsRailPick = 1;
    else if (I.pressed('pick2')) this.vsRailPick = 2;
    else if (I.pressed('pick3')) this.vsRailPick = 3;
    if (I.pressed('reroll')) {
      // R with no rerolls left on an open rail: say so (the sim would silently ignore the edge)
      const w = this._world, me = w ? w.players[this.vsLocal] : null;
      if (me && me.rail.open && w && w.view === this.vsLocal && (me.upgrades.rerolls | 0) <= 0) { this.railUi.refuseReroll(); this.sfx.ui('back'); }
      else this.vsRailReroll = true;
    }
    if (I.pressed('specPrev')) this.vsCycle(-1);
    if (I.pressed('specNext')) this.vsCycle(1);
    if (I.pressed('mapToggle')) this.vsHud.toggleMap();
  }

  /** point the camera / HUD at a seat (spectate, follow the killer, back to the own body) */
  private vsSetView(w: World, slot: number): void {
    if (slot === w.view || slot < 0 || slot >= w.players.length) return;
    setViewSlot(w, slot);
    this.rig.retarget();
    this.hud.rebind();
    this.abilityBar.show(slot === this.vsLocal && this._screen === 'play');
  }

  /** Q / E (pad LB / RB, the spectate bar's arrows): the next / previous LIVING titan while spectating */
  private vsCycle(dir: number): void {
    const w = this._world;
    if (!w || !this.vsInfo || this.vsMode !== 'spectate') return;
    const n = w.players.length;
    for (let k = 1; k <= n; k++) {
      const s = ((w.view + (dir < 0 ? -k : k)) % n + n) % n;
      const P = w.players[s];
      if (s === this.vsLocal || P.vs.eliminated) continue;
      this.vsSetView(w, s);
      this.sfx.ui('move');
      return;
    }
  }

  /** the VS-specific app reactions to an event; true = do not run the solo switch for it */
  private vsAppEvent(w: World, e: SimEvent): boolean {
    switch (e.type) {
      case 'evicted':
        if (e.victim === this.vsLocal && !this.ending && this.vsMode === 'own') {
          if (e.killer >= 0 && e.killer !== e.victim) {                 // hold on the killer for the respawn
            this.vsMode = 'killer'; this.vsFollowT = VS.ko.respawnS + 0.8;
            this.vsSetView(w, e.killer);
          }
        }
        return true;
      case 'eliminated':
        if (e.victim === this.vsLocal && !this.ending) {
          this.vsKiller = e.killer;
          this.vsMode = 'killer'; this.vsFollowT = VS.ko.followKillerS;
          if (e.killer >= 0 && e.killer !== e.victim) this.vsSetView(w, e.killer);
          else this.vsFollowT = 0;
        }
        return true;
      case 'respawn':
        if (e.slot === this.vsLocal && this.vsMode === 'killer') { this.vsMode = 'own'; this.vsSetView(w, this.vsLocal); }
        return true;
      case 'vsEnd':
        this.vsEndEv = { winner: e.winner, placements: e.placements.slice(), scores: e.scores.slice() };
        this.beginVsEnding(w);
        return true;
      case 'crown': case 'vsPhase': case 'rivalHit': case 'tenderMarker': case 'tenderSpawn': case 'tenderPaid': case 'ringStep':
      case 'railOffer': case 'railPick':
        return true;
      default:
        // another seat's own-body app cues (low-HP alerts, rank-up stings, UPROAR punch) are not ours to play
        if (e.p !== undefined && e.p >= 0 && e.p !== w.view && (e.type === 'rankUp' || e.type === 'alert' || e.type === 'ultFire' || e.type === 'eliteSpawn')) return true;
        return false;
    }
  }

  /** each frame in a VS match: follow-the-killer timing, spectate target upkeep */
  private vsFollow(w: World, dt: number): void {
    const me = w.players[this.vsLocal];
    if (!me || !w.vs) return;
    if (this.vsMode === 'killer') {
      this.vsFollowT -= dt;
      if (me.vs.eliminated) {
        if (this.vsFollowT <= 0) { this.vsMode = 'spectate'; this.vsEnterSpectate(w); }
      } else if (me.titan.alive && w.view !== this.vsLocal) { this.vsMode = 'own'; this.vsSetView(w, this.vsLocal); }   // back without a respawn event
      else if (this.vsFollowT <= 0 && me.titan.alive) { this.vsMode = 'own'; this.vsSetView(w, this.vsLocal); }
    } else if (this.vsMode === 'own' && me.vs.eliminated) {
      this.vsMode = 'spectate'; this.vsEnterSpectate(w);
    } else if (this.vsMode === 'spectate') {
      const cur = w.players[w.view];
      if (!cur || cur.vs.eliminated || w.view === this.vsLocal) this.vsEnterSpectate(w);
    }
  }

  private vsEnterSpectate(w: World): void {
    const n = w.players.length;
    let best = -1;
    const k = this.vsKiller;
    if (k >= 0 && k !== this.vsLocal && k < n && !w.players[k].vs.eliminated) best = k;   // stay on the killer: no camera cut
    for (let j = 0; best < 0 && j < n; j++) {
      const s = (this.vsLocal + 1 + j) % n;
      if (s !== this.vsLocal && !w.players[s].vs.eliminated) best = s;
    }
    if (best >= 0) this.vsSetView(w, best);
  }

  /** the match was decided: stop the sim, let the winner roar, then the end card */
  private beginVsEnding(w: World): void {
    if (this.ending) return;
    this.ending = true;
    this.reportVsEnd(w);
    this.endResult = null;
    this.endT = App.VS_END_DELAY_S;
    this.wantDraft = false;
    this.draftArmed = false;
    this.loop.simEnabled = false;
    this.loop.timeScale = 1;
    this.hitStopT = 0;
    this.input.mode = 'ui';
    this.music.setIntensity(0.95);
    // the front-page photo is of the WINNER (it roars during the aftermath): the camera goes to it, whoever we were following
    const win = w.vs ? w.vs.winner : -1;
    if (win >= 0 && win < w.players.length) this.vsSetView(w, win);
    else if (this.vsMode !== 'own' && w.players[this.vsLocal] && !w.players[this.vsLocal].vs.eliminated) this.vsSetView(w, this.vsLocal);
    this.vsMode = win === this.vsLocal ? 'own' : 'killer';   // not 'spectate': the spectate bar and keys are off for the aftermath
  }

  /**
   * O-REPORT: the match is decided. Update the VS ledger + post the VS goals, and (signed in) file this seat's bt_report_vs through the
   * portal bridge. Read-only on the World. Guests / standalone / a seat a bot has now file nothing.
   */
  private reportVsEnd(w: World, waitedMs = 0): void {
    try {
      if (!this.vsInfo || w.mode !== 'vs') return;
      const ctx = this.vsReport;
      // online: the other peers' RESULT hashes arrive up to ~1.5 s after the end; a ghost / diverged peer is told apart by them (resultsMajority)
      if (ctx && ctx.ready && !ctx.ready() && waitedMs < 4000) {
        const ep = this.epoch;
        window.setTimeout(() => { if (ep === this.epoch && this._world === w) this.reportVsEnd(w, waitedMs + 250); }, 250);
        return;
      }
      const matchId = ctx ? ctx.matchId : this.vsMatchId;
      const out = this.portal.vsMatchEnded({
        w, slot: this.vsLocal, matchId, humans: ctx ? ctx.humans : 1,
        uidBySlot: ctx ? ctx.uidsBySlot() : undefined, tally: this.vsTally, skip: ctx && ctx.skip ? ctx.skip() : false,
      });
      if (!out) return;
      const rec: NonNullable<App['vsFiling']> = { matchId, goals: out.goals.slice(), filing: null };
      this.vsFiling = rec;
      for (const id of out.goals) this.toastVsGoal(id);
      void out.filing.then((f) => { if (this.vsFiling === rec) rec.filing = f; });
    } catch (e) {
      console.error('[blocktooth] vs report failed', e);
    }
  }

  /** a GOAL MET toast for one of the 8 VS goals (the toast layer holds it until the end card is closed) */
  private toastVsGoal(id: string): void {
    const g = VS_GOAL_BY_ID[id];
    if (!g) return;
    this.toasts.push({ kicker: 'GOAL MET', title: g.name, sub: g.desc.toUpperCase(), glyph: 'ribbon' });
  }

  /** the front page: freeze-frame photo, then the end card → REMATCH (titan swap, new seed, next city) / LEAVE */
  private async runVsEnd(): Promise<void> {
    const w = this._world, info = this.vsInfo;
    if (!w || !info) return;
    const ep = this.epoch;
    let photo = '';
    const hidden: THREE_Object[] = [];
    for (const name of PHOTO_HIDDEN_ROOTS) {
      const o = this.core.scene.getObjectByName(name) as THREE_Object | undefined;
      if (o && o.visible) { o.visible = false; hidden.push(o); }
    }
    try {
      this.core.render();
      photo = this.core.renderer.domElement.toDataURL('image/jpeg', 0.9);
    } catch (e) {
      console.error('[blocktooth] vs freeze-frame photo failed', e);
    } finally {
      for (const o of hidden) o.visible = true;
    }
    this.setScreen('end');
    this.showHud(false);
    this.bossbar.hide();
    this.music.play('tabloid');
    this.sfx.ui('print');
    this.modal = 'end';
    const portraits = await this.getPortraits();
    if (ep !== this.epoch || this._world !== w) return;
    let choice: Awaited<ReturnType<VsEndScreen['open']>>;
    if (this.online) this.rematchVoteEnd = performance.now() + VS.rematch.voteS * 1000;
    try {
      choice = await this.vsEndScreen.open({ w, info, photo, portraits, voteS: this.online ? VS.rematch.voteS : null, end: this.vsEndEv });
    } finally {
      if (this.modal === 'end') this.modal = null;
    }
    if (ep !== this.epoch) return;
    this.sfx.ui('confirm');
    if (this.online) {                      // ONLINE: REMATCH = the same cast in a new room (a fresh seed, the next city); LEAVE = the title
      if (choice.kind === 'rematch') this.rematchOnline(choice.titan, info.biome);
      else void this.leaveOnline();
      return;
    }
    if (choice.kind === 'rematch') {
      const r = this.vsReq;
      const next = REMATCH_BIOMES[(Math.max(0, REMATCH_BIOMES.indexOf(info.biome as typeof REMATCH_BIOMES[number])) + 1) % REMATCH_BIOMES.length];
      void this.startVs({ titan: choice.titan, biome: next, seed: freshSeed(), bots: r ? r.bots : 'regular', palette: info.palettes[info.local] ?? 0 });
    } else void this.goTitle();
  }

  // ─────────────────────────────── events plumbing ───────────────────────────────

  private pushEvent(e: SimEvent): void {
    if (this.vsTally) this.vsTally.feed(e);
    // a rank-up (from a tick or a mutate()) holds any draft owed right now until the sting is seen
    if (e.type === 'rankUp' && !this._testFrozen && !this.ending) this.sizeUpHoldT = SIZEUP_DRAFT_HOLD_S;
    this.evA.push(e);
    this.ring[this.ringHead] = e;
    this.ringHead = (this.ringHead + 1) % EVENT_RING;
  }

  /** Hand out everything collected since the last frame; the next frame collects into the other list. */
  private swapEvents(): readonly SimEvent[] {
    const out = this.evA;
    this.evA = this.evB;
    this.evA.length = 0;
    this.evB = out;
    return out;
  }

  // ─────────────────────────────── errors + DOM hooks ───────────────────────────────

  private fail(title: string, err: unknown): void {
    console.error('[blocktooth]', title, err);
    if (this.fatalShown) return;
    this.fatalShown = true;
    try { this.onFatal(title, err); } catch { /* the reporter itself failed */ }
  }

  private frameError(e: unknown): void {
    this.frameErrStreak++;
    this.frameErrTotal++;
    if (this.frameErrTotal <= 8) console.error('[blocktooth] frame error', e);
    if (this.frameErrStreak >= FRAME_ERROR_FATAL_STREAK) this.fail('the picture froze', e);
  }

  private installDomHooks(): void {
    // auto-pause when the tab is hidden (CONTRACT §14); never destroys the run
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause();
    });
    // …and when the window loses focus (alt-tab, another monitor, the portal page around the
    // iframe): Input already releases every held key on blur, so without this an unattended
    // titan stood still while the sim kept running and died in ~25–45 s. pause() is a no-op
    // outside live play (menus, drafts, the tabloid, the run-end aftermath).
    window.addEventListener('blur', () => this.autoPause());
    // closing the tab / navigating away mid-match: tell the others at once (their seat for us becomes a bot) instead of letting them time out
    window.addEventListener('pagehide', () => { if (this.online) { try { this.online.leave(); } catch { /* going away */ } } });
    // first user gesture unlocks audio (the engine also listens; this covers ?autostart pages)
    const unlock = () => {
      void this.audio.unlock();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    // menu navigation ticks (the UI screens own their keys; this only adds the sound)
    let lastMove = 0;
    window.addEventListener('keydown', (e) => {
      const s = this._screen;
      if (s !== 'select' && s !== 'pause' && s !== 'draft' && s !== 'end') return;
      const nav = e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight'
        || e.code === 'KeyW' || e.code === 'KeyA' || e.code === 'KeyS' || e.code === 'KeyD';
      if (!nav) return;
      const now = performance.now();
      if (now - lastMove < 70) return;
      lastMove = now;
      this.sfx.ui('move');
    }, true);
    // a lost GL context cannot be recovered mid-run with the scene state we hold
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.loop.simEnabled = false;
      this.fail('the graphics device was reset', new Error('WebGL context lost — reload to restart the broadcast.'));
    });
    // keep the drawing buffer sized even while frozen / between frames
    window.addEventListener('resize', () => { try { this.core.resize(); } catch { /* ignore */ } });
  }
}
