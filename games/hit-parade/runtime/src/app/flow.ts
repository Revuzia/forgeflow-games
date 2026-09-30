// HIT PARADE - the app's screen / mode state machine and THE SEASON ladder slots (CONTRACT §8, §11, §16, §18.6).
//
// DOM-free and THREE-free (a Node probe can drive it). Two small pieces:
//
//   Flow        the app phase every harness polls (`__HP__.state().phase`, CONTRACT §18.6):
//                 boot -> loading -> title -> menu -> loading -> ready -> bout <-> paused -> results -> ...
//               plus the MODE of the current activity (versus / arcade / training / online / brawl / heckler)
//               and the menu screen with the screen it came from (`screenBefore`, doctrine §6: "Settings->Back
//               stranded players in the wrong screen for months" - every navigation records where it came
//               from). An illegal transition is applied anyway (the game must never wedge on a bookkeeping
//               error) but it is recorded in `violations` and warned once, so the menus harness can gate on
//               zero violations.
//
//   SeasonRun   THE SEASON / PILOT ladder (FIGHTING_DESIGN §9b, CONTRACT §11): an ordered list of slots
//               (random bouts, RIVAL, BRAWL BREAK, HECKLER TOSS, MINI BOSS THE FREAK, BOSS RICKY), the CPU
//               level of each slot (Normal ladder, shifted by the difficulty -2..+2, clamped 0..8), the
//               opponents drawn without replacement from the playable roster with a seeded mulberry32 (same
//               seed + same roster = same ladder), continues (a continue restarts the slot; the episode's
//               ratings reset - the score bookkeeping belongs to the results screen), and clear detection.
//               data/ladder.json (lane AI) overrides the default shape when it carries `season` / `pilot`
//               slot arrays; anything it lacks falls back to the defaults below.
//
// Default ladders (FIGHTING_DESIGN §9b, Normal levels):
//   season: Ep1 random L2 · Ep2 random L3 · Ep3 random L3 · BRAWL BREAK · Ep4 random L4 · Ep5 RIVAL L5 ·
//           Ep6 random L5 · HECKLER TOSS · Ep7 MINI BOSS (freak) L6 · Ep8 BOSS (ricky) L6
//   pilot:  Ep1 random L2 · Ep2 random L3 · BRAWL BREAK · Ep3 random L4 · Ep4 MINI BOSS L6 · Ep5 BOSS L6

export type Phase = 'boot' | 'loading' | 'title' | 'menu' | 'ready' | 'bout' | 'paused' | 'results' | 'error';
export type FlowMode = 'none' | 'versus' | 'arcade' | 'training' | 'online' | 'brawl' | 'heckler';

export const PHASES: readonly Phase[] = ['boot', 'loading', 'title', 'menu', 'ready', 'bout', 'paused', 'results', 'error'];

/** allowed transitions; 'error' is terminal (the error card's RELOAD is a page reload) */
const ALLOWED: Readonly<Record<Phase, readonly Phase[]>> = {
  boot: ['loading', 'title', 'menu', 'error'],
  loading: ['loading', 'title', 'menu', 'ready', 'bout', 'error'],
  title: ['menu', 'loading', 'error'],
  menu: ['menu', 'title', 'loading', 'error'],
  ready: ['bout', 'loading', 'menu', 'title', 'error'],
  bout: ['paused', 'results', 'loading', 'menu', 'title', 'error'],
  paused: ['bout', 'results', 'loading', 'menu', 'title', 'error'],
  results: ['loading', 'menu', 'title', 'error'],
  error: [],
};

export interface FlowChange { from: Phase; to: Phase; why: string; legal: boolean }

export class Flow {
  private cur: Phase = 'boot';
  mode: FlowMode = 'none';
  /** the menu screen on show (ui/menus ScreenId) and the one before it */
  screen = '';
  screenBefore = '';
  /** the last error message (phase 'error') */
  error: string | null = null;
  /** illegal transitions seen (applied anyway; the menus harness gates on none) */
  readonly violations: FlowChange[] = [];
  /** the last 40 transitions (debug read-back) */
  readonly history: FlowChange[] = [];
  private readonly fns = new Set<(c: FlowChange) => void>();

  get phase(): Phase { return this.cur; }

  /** move to `to`; returns false (and records a violation) when the table does not allow it */
  go(to: Phase, why = ''): boolean {
    const from = this.cur;
    const legal = ALLOWED[from].includes(to);
    const c: FlowChange = { from, to, why, legal };
    if (!legal) {
      this.violations.push(c);
      if (this.violations.length <= 8) console.warn(`[hit-parade] flow: illegal ${from} -> ${to}${why ? ` (${why})` : ''}`);
      if (from === 'error') return false;    // terminal: nothing leaves the error card but a reload
    }
    this.cur = to;
    this.history.push(c);
    if (this.history.length > 40) this.history.shift();
    for (const fn of [...this.fns]) {
      try { fn(c); } catch (e) { console.error('[hit-parade] flow listener', e); }
    }
    return legal;
  }

  /** a terminal failure: phase 'error' with the message */
  fail(message: string): void {
    this.error = message;
    if (this.cur !== 'error') this.go('error', 'fail');
  }

  /** a menu navigation: records where it came from (doctrine §6) */
  setScreen(screen: string): void {
    if (screen === this.screen) return;
    this.screenBefore = this.screen;
    this.screen = screen;
  }

  onChange(fn: (c: FlowChange) => void): () => void {
    this.fns.add(fn);
    return () => { this.fns.delete(fn); };
  }

  snapshot(): { phase: Phase; mode: FlowMode; screen: string; screenBefore: string; violations: number; error: string | null } {
    return { phase: this.cur, mode: this.mode, screen: this.screen, screenBefore: this.screenBefore, violations: this.violations.length, error: this.error };
  }
}

// ─────────────────────────────── THE SEASON ───────────────────────────────

export type SlotKind = 'bout' | 'rival' | 'miniboss' | 'boss' | 'brawl' | 'heckler';
export type SeasonLength = 'season' | 'pilot';

export interface SeasonSlot {
  kind: SlotKind;
  /** fighter id of the CPU opponent (null for the bonus rounds) */
  opponent: string | null;
  /** stage id (null = the opponent's home stage, resolved by the caller) */
  stage: string | null;
  /** CPU level 0..8 after the difficulty shift */
  level: number;
  /** 1-based episode number of a bout slot (0 for bonus rounds) */
  episode: number;
}

export interface SeasonInit {
  fighter: string;
  color: number;
  scheme: 0 | 1;
  length: SeasonLength;
  /** difficulty shift: -2 Easy .. 0 Normal .. +2 Hard (FIGHTING_DESIGN §9b) */
  difficulty: number;
  seed: number;
}

/** what the ladder needs to know about the roster */
export interface SeasonRoster {
  /** every PLAYABLE fighter id in roster order (no mini boss / boss) */
  playable: readonly string[];
  /** the mini boss / boss ids */
  miniboss: string;
  boss: string;
  /** a fighter's rival id, or null */
  rival(id: string): string | null;
}

interface SlotSpec { kind: SlotKind; level: number; opponent?: string; stage?: string }

const DEFAULT_LADDERS: Readonly<Record<SeasonLength, readonly SlotSpec[]>> = {
  season: [
    { kind: 'bout', level: 2 }, { kind: 'bout', level: 3 }, { kind: 'bout', level: 3 },
    { kind: 'brawl', level: 0 },
    { kind: 'bout', level: 4 }, { kind: 'rival', level: 5 }, { kind: 'bout', level: 5 },
    { kind: 'heckler', level: 0 },
    { kind: 'miniboss', level: 6 }, { kind: 'boss', level: 6 },
  ],
  pilot: [
    { kind: 'bout', level: 2 }, { kind: 'bout', level: 3 },
    { kind: 'brawl', level: 0 },
    { kind: 'bout', level: 4 }, { kind: 'miniboss', level: 6 }, { kind: 'boss', level: 6 },
  ],
};

const SLOT_KINDS: readonly SlotKind[] = ['bout', 'rival', 'miniboss', 'boss', 'brawl', 'heckler'];

/** mulberry32 (the same generator as core/rng.ts; local so the app layer never reaches into core state) */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** the ladder's slot specs: data/ladder.json `season` / `pilot` arrays when present and sane, else the defaults */
export function ladderSpecs(ladder: unknown, length: SeasonLength): SlotSpec[] {
  const src = ladder && typeof ladder === 'object' ? (ladder as Record<string, unknown>)[length] : undefined;
  const rows = Array.isArray(src) ? src : (src && typeof src === 'object' && Array.isArray((src as Record<string, unknown>).slots) ? (src as Record<string, unknown>).slots as unknown[] : null);
  if (rows && rows.length > 0) {
    const out: SlotSpec[] = [];
    for (const r of rows) {
      if (!r || typeof r !== 'object') continue;
      const o = r as Record<string, unknown>;
      const kind = typeof o.kind === 'string' && (SLOT_KINDS as readonly string[]).includes(o.kind) ? o.kind as SlotKind : null;
      if (!kind) continue;
      const lv = typeof o.level === 'number' && Number.isFinite(o.level) ? o.level : typeof o.cpu === 'number' && Number.isFinite(o.cpu) ? o.cpu : 4;
      const spec: SlotSpec = { kind, level: lv };
      if (typeof o.opponent === 'string' && o.opponent) spec.opponent = o.opponent;
      if (typeof o.stage === 'string' && o.stage) spec.stage = o.stage;
      out.push(spec);
    }
    if (out.some((s) => s.kind === 'boss')) return out;
  }
  return DEFAULT_LADDERS[length].map((s) => ({ ...s }));
}

/** build the concrete slots of one run (deterministic for (init.seed, roster, ladder)) */
export function buildSeason(init: SeasonInit, roster: SeasonRoster, ladder: unknown): SeasonSlot[] {
  const specs = ladderSpecs(ladder, init.length);
  const shift = Math.max(-2, Math.min(2, Math.round(Number.isFinite(init.difficulty) ? init.difficulty : 0)));
  const rnd = mulberry32((init.seed ^ 0x5ea5011) >>> 0);
  const rival = roster.rival(init.fighter);
  const hasRival = specs.some((s) => s.kind === 'rival');
  // the random pool: playable, not the player, not the rival when a rival slot exists (the rival gets its own)
  const pool = roster.playable.filter((id) => id !== init.fighter && !(hasRival && id === rival));
  // Fisher-Yates with the seeded stream
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  let draw = 0;
  let episode = 0;
  const out: SeasonSlot[] = [];
  for (const s of specs) {
    const bonus = s.kind === 'brawl' || s.kind === 'heckler';
    if (!bonus) episode++;
    let opponent: string | null = null;
    if (s.opponent) opponent = s.opponent;
    else if (s.kind === 'rival') opponent = rival ?? (pool.length ? pool[draw++ % pool.length] : init.fighter);
    else if (s.kind === 'miniboss') opponent = roster.miniboss;
    else if (s.kind === 'boss') opponent = roster.boss;
    else if (s.kind === 'bout') opponent = pool.length ? pool[draw++ % pool.length] : init.fighter;
    out.push({
      kind: s.kind, opponent, stage: s.stage ?? null,
      level: bonus ? 0 : Math.max(0, Math.min(8, Math.round(s.level + shift))),
      episode: bonus ? 0 : episode,
    });
  }
  return out;
}

export class SeasonRun {
  readonly init: SeasonInit;
  readonly slots: SeasonSlot[];
  index = 0;
  continues = 0;
  /** per slot: 'win' | 'loss' (bonus rounds are always 'win' = played) */
  readonly outcomes: Array<'win' | 'loss'> = [];

  constructor(init: SeasonInit, roster: SeasonRoster, ladder: unknown) {
    this.init = { ...init };
    this.slots = buildSeason(init, roster, ladder);
  }

  get done(): boolean { return this.index >= this.slots.length; }
  get cleared(): boolean { return this.done && this.outcomes.length >= this.slots.length; }
  current(): SeasonSlot | null { return this.done ? null : this.slots[this.index]; }
  /** the episode count (bouts only) */
  get episodes(): number { return this.slots.filter((s) => s.episode > 0).length; }

  /** record the current slot's outcome: a win (or any bonus round) advances; a loss stays (continue or quit) */
  record(won: boolean): 'next' | 'retry' | 'cleared' {
    const s = this.current();
    if (!s) return 'cleared';
    const bonus = s.kind === 'brawl' || s.kind === 'heckler';
    if (won || bonus) {
      this.outcomes[this.index] = 'win';
      this.index++;
      return this.done ? 'cleared' : 'next';
    }
    this.outcomes[this.index] = 'loss';
    return 'retry';
  }

  /** a continue: the same slot again (FIGHTING_DESIGN §9b: unlimited; the episode's ratings reset) */
  continueSlot(): SeasonSlot | null {
    this.continues++;
    return this.current();
  }

  /** a stable per-slot seed (each slot gets its own sim seed, a continue gets a fresh one) */
  slotSeed(): number {
    return (Math.imul((this.init.seed ^ 0x9e3779b9) >>> 0, 31) + this.index * 7919 + this.continues * 104729) >>> 0;
  }
}
