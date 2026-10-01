// HIT PARADE - UI-side types (lane UI, CONTRACT section 8 / 16).
//
// The UI reads other lanes' objects through these STRUCTURAL shapes: each one lists only the fields the UI touches, typed
// loosely enough that the SIM / SHELL / VIEW / AUDIO types (GameData, FighterSnap, MatchSnap, SettingsStore, SaveStore,
// Showcase, GameAudio) are assignable to them without an import. That lets this lane compile and run its lab page before
// the other lanes land, and keeps game.ts free to pass the real objects straight in.
//
// MatchCfg / PlayerCfg / Scheme are the CONTRACT section 4.1 types verbatim: the menus PRODUCE them (MenuIntent).

export type Scheme = 0 | 1;                       // 0 SIMPLE, 1 CLASSIC
export interface PlayerCfg { fighter: string; color: number; scheme: Scheme; cpu: number /* -1 human, 0..8 */ }
export type MatchMode = 'versus' | 'arcade' | 'training' | 'online' | 'brawl' | 'heckler';
export interface MatchCfg {
  mode: MatchMode;
  stage: string; seed: number; p: [PlayerCfg, PlayerCfg];
  rounds?: number /* first-to, default 2 */; timer?: number /* s, default 99, 0 = infinite */;
}

/** CONTRACT 4.5: one sim event (ints). The UI reads `type` through ui/ev.ts and `a` as the player the event is about. */
export interface SimEvent { frame: number; type: number; a: number; b: number; c: number; d: number }

/** CONTRACT 4.6 FighterSnap, the fields the UI reads. `actionable` / `stun` are optional additions (CHANGED(UI)). */
export interface UiFighterSnap {
  x?: number; y?: number; facing?: number;
  state?: number; moveId?: number; moveFrame?: number;
  hp: number; hpMax: number; greyHp?: number;
  showtime: number; nerve: number; stageFright: number | boolean;
  /** CONTRACT 4.6 + 19.7: hits this fighter is currently LANDING (the attacker's side) and that combo's damage */
  combo: number; comboDamage?: number; hitstop?: number;
  flags?: { ko?: number | boolean; counter?: number | boolean; armor?: number | boolean; taunting?: number | boolean; stance?: number };
  /** true when the fighter can act (free to walk / attack); used by the training frame-advantage readout */
  actionable?: boolean;
  /** remaining hit/block stun frames (optional; readout fallback) */
  stun?: number;
  /** CONTRACT 19.7 extras the training driver / readout use (optional) */
  stateName?: string; moveName?: string; moveKind?: string; airborne?: boolean; crouching?: boolean;
  /** CONTRACT 28.1: fighter 1 is not on the set in a bonus round */
  absent?: boolean;
}

/** CONTRACT 4.6 MatchSnap, the fields the UI reads. */
export interface UiMatchSnap {
  /** timer: seconds shown; -1 = infinite (CONTRACT 19.7) */
  frame: number; round: number; timer: number;
  wins: ArrayLike<number>;
  phase?: number | string;
  cinematic?: { active: number | boolean };
  winner?: number;
  /** 19.7: -1 none, 0 | 1, 2 = drawn round */
  roundWinner?: number;
  draw?: boolean;
  slowmo?: number | boolean;
  /** CHANGED(UI) P2: CONTRACT 28.4 BRAWL BREAK / HECKLER TOSS snapshot (SIM) - the fields the HUD / results read */
  brawl?: UiBrawlSnap;
}
export interface UiBrawlSnap {
  mode: 'brawl' | 'heckler'; score: number; ratings: number; grade: number; mult: number; timeLeft: number;
  wave?: number; spawned?: number; downed?: number; combo?: number; parries?: number; perfects?: number; hitsTaken?: number;
}

/** CONTRACT 5.2 Move, the fields the move list / training read. `name` is optional (CHANGED(UI) request). */
export interface UiMoveDef {
  kind: string; input?: string; name?: string;
  startup?: number; active?: number; recovery?: number; damage?: number; guard?: string;
  hitstun?: number; blockstun?: number;
  cost?: { showtime?: number; nerve?: number };
  /** CONTRACT 20.2 informational fields the move list shows */
  desc?: string; role?: ReadonlyArray<string>;
  /** CHANGED(UI3D) (CONTRACT §35.12 FIGHTERS3D): the move tracks a stepper (HOMING) / never turns after frame 1 (LINEAR) */
  homing?: boolean; linear?: boolean;
  track?: { until?: number; rate?: number };
  projectile?: { aimed?: boolean };
  /** CHANGED(fix_ui_stage) (CONTRACT 19.1 / 20.2 / 28.2): the follow-up plumbing the move list reads - `cancel` entries
   *  `chain:<id>`, `tc` = reachable only through a parent's chain, `trigger` = the input that fires a rekka part inside the
   *  parent's window, `stance` 'enter' | 'follow' | 'exit', `counter.follow` = the counter's automatic follow-up */
  cancel?: ReadonlyArray<string>;
  tc?: boolean;
  trigger?: { classic?: { motion?: string; btn?: string }; simple?: string };
  stance?: string;
  counter?: { follow?: string };
}

/** CONTRACT 5.2 fighter file, the fields the UI reads. `difficulty` (1..3) is optional (CHANGED(UI) request). */
export interface UiFighterDef {
  id: string; name: string; persona?: string; archetype?: string; hp?: number; difficulty?: number;
  colors?: ReadonlyArray<{ name: string; tint: string | null }>;
  moves?: Readonly<Record<string, UiMoveDef>>;
  simple?: Readonly<Record<string, unknown>>;
  classic?: ReadonlyArray<{ motion: string; btn: string; move: string }>;
  unique?: { kind: string; trait?: string; thresholdPct?: number;
    /** CHANGED(fix_ui_stage): a stance's follow-ups by button / its exits by direction (CONTRACT 28.2 `stance`) */
    followups?: Readonly<Record<string, string>>; exit?: Readonly<Record<string, string>> };
  rival?: string; stage?: string;
  /** CHANGED(UI) P2 - CONTRACT 26.3 season text (lane FIGHTERS): VS-card line, results quotes, pre-fight lines per
   *  opponent id (or 'default'), the SEASON ending text */
  introLine?: string;
  winQuotes?: ReadonlyArray<string>;
  banter?: Readonly<Record<string, ReadonlyArray<string>>>;
  ending?: string;
}

/** CONTRACT 16 GameData, the fields the UI reads. `stages` is read through ui/data.ts stageList() (shape-tolerant). */
export interface UiGameData {
  fighters: Readonly<Record<string, UiFighterDef>>;
  stages?: unknown;
  strings?: Readonly<Record<string, string>>;
  ladder?: unknown;
  /** CHANGED(fixer) D1: data/system.json - the HUD paces its round banners to `round.{introFrames, koHitstop,
   *  koSlowmoFrames, koOutroFrames, timeoverOutroFrames}` (read shape-tolerantly; defaults when absent) */
  system?: unknown;
}

// ─────────────────────────── deps the menus take (CONTRACT 16 Menus constructor) ───────────────────────────

/** VIEW Showcase (CONTRACT 16). setRect / hide are optional additions: the menus tell the showcase where its region is. */
export interface UiShowcase {
  show(fighterId: string, color: number, pose: 'idle' | 'intro' | 'win'): Promise<void>;
  frame(dt: number): void;
  render(): void;
  setRect?(r: { x: number; y: number; w: number; h: number } | null): void;
  hide?(): void;
}

/** AUDIO GameAudio (CONTRACT 9 / 16), the calls the UI makes. */
export interface UiAudio { ui?(cue: string): void; music?(cue: string | null): void }

/** the remappable actions, in the order the SETTINGS list shows them (CHANGED(UI): SHELL's input.ts uses these ids;
 *  CHANGED(UI3D): + stepIn / stepOut = the CONTRACT §35.2 STEP controls, listed after the directions) */
export const ACTIONS = ['up', 'down', 'left', 'right', 'stepIn', 'stepOut', 'l', 'm', 'h', 's', 'assist', 'throw', 'parry', 'impact', 'taunt', 'pause'] as const;
export type Action = typeof ACTIONS[number];

/** one player's controls: KeyboardEvent.code per action (up to 2) + Standard-mapping pad button indices (up to 1) */
export interface PlayerControls { scheme: Scheme; keys: Partial<Record<Action, string[]>>; pad: Partial<Record<Action, number[]>> }

export type GoreMode = 'splatter' | 'sparks' | 'confetti';
export type CinematicMode = 'full' | 'short';
export type Quality = 'low' | 'med' | 'high';

/** Settings fields the UI reads and writes (CHANGED(UI), CONTRACT 16.1). Every field optional: the UI fills defaults. */
export interface UiSettings {
  volume?: { master?: number; music?: number; sfx?: number; crowd?: number; voice?: number };
  gore?: GoreMode;
  screenShake?: number;          // 0..1
  reduceFlashing?: boolean;
  cinematics?: CinematicMode;
  quality?: Quality;
  bloom?: boolean;
  language?: 'en';
  controls?: ReadonlyArray<PlayerControls>;     // [P1, P2]
  touchScale?: number;           // 0.8..1.3
  touchOpacity?: number;         // 0.35..1
  touchLeftHanded?: boolean;
  haptics?: boolean;
  touchLayout?: TouchLayout | null;
}
export type TouchLayout = Record<string, { dx: number; dy: number; s: number }>;

/** SHELL SettingsStore (CONTRACT 16), structurally. `set` merges a patch; `on` returns an unsubscribe. */
export interface UiSettingsStore {
  get(): UiSettings;
  set(patch: Partial<UiSettings>): void;
  on(fn: (s: UiSettings) => void): () => void;
  resetControls?(player: 0 | 1): void;
}

/** SHELL SaveStore (CONTRACT 8 `hitparade.save.v1`), the fields the UI reads. */
export interface UiSave {
  unlocks?: ReadonlyArray<string> | Readonly<Record<string, boolean>>;
  seasonClears?: Readonly<Record<string, number>>;
  bestScores?: Readonly<Record<string, number>>;
  board?: ReadonlyArray<{ name: string; score: number; fighter: string }>;
  /** CHANGED(fix_ui_stage) (verifier modes D3): SaveStore's per-length boards (`board` above = the SEASON one) */
  scores?: { readonly season?: ReadonlyArray<{ name: string; score: number; fighter: string }>; readonly pilot?: ReadonlyArray<{ name: string; score: number; fighter: string }> };
  onlineName?: string;
}
export interface UiSaveStore { get(): UiSave; set?(patch: Partial<UiSave>): void }

/** SHELL Input (CONTRACT 18.3 deps.input): the remap capture sets `suspended` while it listens */
export interface UiInput { suspended: boolean; releaseAll?(): void }

/** CHANGED(UI) P2: one round of a bout as the Hud logged it from the sim's events + snapshots (Hud.rounds()) */
export interface RoundLog {
  round: number;
  winner: 0 | 1 | -1;
  how: 'ko' | 'time' | 'perfect' | 'double' | 'draw';
  /** sim frames from FIGHT to the KO / TIME OVER frame */
  frames: number;
  damage: [number, number];
  maxCombo: [number, number];
}
export interface MenusDeps { showcase: UiShowcase | null; settings: UiSettingsStore; save: UiSaveStore; audio: UiAudio | null; input?: UiInput | null }

// ─────────────────────────── what the menus emit / show ───────────────────────────

/** CONTRACT 16 MenuIntent (+ `onlinePick`, CHANGED(UI): the blind-select lock-in of an online bout). */
export type MenuIntent =
  | { kind: 'startMatch'; cfg: MatchCfg }
  | { kind: 'startSeason'; fighter: string; color: number; scheme: Scheme; length: 'season' | 'pilot'; difficulty: number }
  | { kind: 'online'; action: 'quick' | 'create' | 'join' | 'cancel'; code?: string; name?: string }
  | { kind: 'onlinePick'; fighter: string; color: number; scheme: Scheme }
  | { kind: 'training'; cfg: MatchCfg }
  | { kind: 'quitToTitle' };

export type ScreenId =
  | 'title' | 'main' | 'season' | 'versus' | 'charselect' | 'stage' | 'vs' | 'results' | 'ladder' | 'card' | 'ending'
  | 'nameentry' | 'pause' | 'settings' | 'training' | 'movelist' | 'online' | 'credits'
  /** CHANGED(UI3D): HOW TO PLAY (walk / the ring: sidestep, circle-walk, step-attacks, homing vs linear / attack / defend) */
  | 'howto';

/** per-player tallies the HUD keeps from the sim's own events + snapshots (Hud.tally(); CHANGED(UI) MatchResult.stats) */
export interface MatchStats {
  damage: number; maxCombo: number; counters: number; punishes: number;
  perfectParries: number; throws: number; supers: number; wallSplats: number;
}
/**
 * CONTRACT 18.3 MatchResult (game.ts builds it from sim snapshots only) + optional UI additions (CHANGED(UI)):
 * stats (= hud.tally()), score / best (arcade episode score), names (online display names), rated (online).
 */
export interface MatchResult {
  cfg: MatchCfg;
  winner: -1 | 0 | 1;
  wins: [number, number];
  frames: number;
  forfeit: -1 | 0 | 1;
  fighters: [UiFighterSnap, UiFighterSnap];
  match: UiMatchSnap;
  season?: { slot: number; slots: number; kind: string; opponent: string; cleared: boolean; continues: number };
  stats?: [MatchStats, MatchStats];
  score?: number;
  best?: boolean;
  names?: [string | null, string | null];
  rated?: boolean;
  disconnect?: boolean;
  /** CHANGED(UI) P2 (CONTRACT 27.3): per-round winners from game.ts BoutStats.rounds */
  rounds?: ReadonlyArray<{ winner: 0 | 1 | -1; how: 'ko' | 'time' | 'perfect' | 'double' | 'draw' }>;
}

export type LadderKind = 'bout' | 'rival' | 'miniboss' | 'boss' | 'brawl' | 'heckler';
export interface LadderView {
  fighter: string; color: number; length: 'season' | 'pilot';
  bouts: ReadonlyArray<{ kind: LadderKind; opponent?: string; result?: 'won' | 'lost' | null }>;
  current: number; score: number; ratings?: number;
  /** CHANGED(UI) P2: continues used so far (shown when passed) */
  continues?: number;
}

/** CHANGED(UI) P2 (CONTRACT 27.2): the NET 19.4 events game.ts forwards to Menus.onlineEvent */
export type OnlineEventName = 'paired' | 'select' | 'opponentLocked' | 'reveal' | 'rematch' | 'matchEnd' | 'disconnect' | 'end' | 'ratings';

export type CardKind = 'rival' | 'miniboss' | 'boss' | 'brawl' | 'heckler';
/** a pre-bout card; `seconds` = the bonus round's length (default CONTRACT 4.3: BRAWL BREAK 45, HECKLER TOSS 40) */
export interface CardView { kind: CardKind; a?: string; b?: string; banter?: [string, string] | null; seconds?: number }

export interface VsView {
  p: [{ fighter: string; color: number; label?: string }, { fighter: string; color: number; label?: string }];
  stage: string; mode: MatchMode; episode?: number; kind?: LadderKind; rated?: boolean;
}

/** lobby status: the UI's own states, or NET's `status` / `error` payload (a `code` key from NET_STRINGS + vars) */
export type UiOnlineStatus =
  | { st: 'idle' } | { st: 'searching' } | { st: 'waiting'; code: string } | { st: 'connecting' }
  | { st: 'connected'; name: string; ping: number } | { st: 'relay' } | { st: 'failed'; reason: string };
export interface NetOnlineStatus { code: string; phase?: string; rttMs?: number; room?: string; [k: string]: unknown }
export type OnlineStatus = UiOnlineStatus | NetOnlineStatus;

export type Rect = { x: number; y: number; w: number; h: number };
