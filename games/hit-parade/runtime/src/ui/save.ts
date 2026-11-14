// HIT PARADE - the save (CONTRACT §8: key `hitparade.save.v1`). Pattern: blocktooth src/core/save.ts.
//
// ONE localStorage blob holds everything a player keeps:
//   settings   the SettingsStore's value (ui/settings.ts sanitises it; this file only stores the raw object)
//   unlocks    { freak, ricky } - the mini boss and the boss become playable in VERSUS after a SEASON clear
//              (DESIGN "Unlocks/save"; a PILOT clear does not unlock them)
//   clears     per fighter: { season, pilot } clear counts + the best difficulty shift cleared (-2..2)
//   scores     the local ratings board: top 10 { name, fighter, score, length, difficulty, at } per ladder length
//              (FIGHTING_DESIGN §9b: separate boards per ladder length)
//   online     { name } - the online display name
//   seen       one-time flags (tutorial captions, home-screen tip, first-run hints)
//
// Every storage touch is wrapped in try/catch: sandboxed iframes (the portal), private windows, disabled storage
// and quota errors all throw - sometimes on the mere `window.localStorage` property read (blocktooth E19). A
// failure degrades to an IN-MEMORY copy for the session (`persisted` = false), never a crash. Loaded values are
// sanitised field by field, so a corrupt or hand-edited blob (or an older schema) can never push NaN or junk into
// the game. `on(fn)` notifies after every successful change.

export const SAVE_KEY = 'hitparade.save.v1';
export const SAVE_VERSION = 1;
export const BOARD_SIZE = 10;
export const NAME_MAX = 12;

export type LadderLength = 'season' | 'pilot';

export interface Clear { season: number; pilot: number; bestDifficulty: number | null }

export interface ScoreRow { name: string; fighter: string; score: number; length: LadderLength; difficulty: number; at: number }

export interface SaveData {
  v: number;
  settings: unknown;
  unlocks: { freak: boolean; ricky: boolean };
  clears: Record<string, Clear>;
  scores: { season: ScoreRow[]; pilot: ScoreRow[] };
  online: { name: string };
  seen: Record<string, boolean>;
}

/** SaveStore.get(): the stored data + derived flat fields for the UI screens */
export interface SaveView extends SaveData {
  seasonClears: Record<string, number>;
  bestScores: Record<string, number>;
  board: ScoreRow[];
  onlineName: string;
}

export function emptySave(): SaveData {
  return { v: SAVE_VERSION, settings: null, unlocks: { freak: false, ricky: false }, clears: {}, scores: { season: [], pilot: [] }, online: { name: '' }, seen: {} };
}

// ─────────────────────────────── storage access ───────────────────────────────
interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** localStorage or null; the property read itself can throw (SecurityError in sandboxed iframes) */
function store(): StorageLike | null {
  try {
    const g = globalThis as unknown as { localStorage?: StorageLike };
    const s = g.localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

function readRaw(key: string): unknown {
  try {
    const s = store();
    if (!s) return null;
    const raw = s.getItem(key);
    if (raw === null || raw === '') return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function writeRaw(key: string, value: unknown): boolean {
  try {
    const s = store();
    if (!s) return false;
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────── sanitising ───────────────────────────────
const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
const FLAG_RE = /^[A-Za-z0-9_.:-]{1,48}$/;

function num(v: unknown, lo: number, hi: number, d: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
}

/** a display name: letters, digits, space, - _ . ' ; trimmed; <= NAME_MAX characters */
export function cleanName(raw: unknown): string {
  const s = String(raw ?? '').normalize('NFC').replace(/[^\p{L}\p{N} _.'-]+/gu, '').replace(/\s+/g, ' ').trim();
  return Array.from(s).slice(0, NAME_MAX).join('');
}

function cleanRow(r: unknown, length: LadderLength): ScoreRow | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const fighter = typeof o.fighter === 'string' && ID_RE.test(o.fighter) ? o.fighter : null;
  const score = num(o.score, 0, 1e9, NaN);
  if (!fighter || !Number.isFinite(score)) return null;
  return { name: cleanName(o.name) || 'PLAYER', fighter, score: Math.round(score), length, difficulty: Math.round(num(o.difficulty, -2, 2, 0)), at: Math.round(num(o.at, 0, 1e13, 0)) };
}

function cleanBoard(v: unknown, length: LadderLength): ScoreRow[] {
  if (!Array.isArray(v)) return [];
  const rows = v.map((r) => cleanRow(r, length)).filter((r): r is ScoreRow => r !== null);
  rows.sort((a, b) => b.score - a.score || a.at - b.at);
  return rows.slice(0, BOARD_SIZE);
}

export function sanitizeSave(raw: unknown): SaveData {
  const d = emptySave();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  const un = (o.unlocks && typeof o.unlocks === 'object' ? o.unlocks : {}) as Record<string, unknown>;
  const clears: Record<string, Clear> = {};
  if (o.clears && typeof o.clears === 'object' && !Array.isArray(o.clears)) {
    for (const [k, v] of Object.entries(o.clears as Record<string, unknown>)) {
      if (!ID_RE.test(k) || !v || typeof v !== 'object') continue;
      const c = v as Record<string, unknown>;
      const bd = c.bestDifficulty;
      clears[k] = {
        season: Math.round(num(c.season, 0, 1e6, 0)),
        pilot: Math.round(num(c.pilot, 0, 1e6, 0)),
        bestDifficulty: typeof bd === 'number' && Number.isFinite(bd) ? Math.round(Math.min(2, Math.max(-2, bd))) : null,
      };
    }
  }
  const sc = (o.scores && typeof o.scores === 'object' ? o.scores : {}) as Record<string, unknown>;
  const on = (o.online && typeof o.online === 'object' ? o.online : {}) as Record<string, unknown>;
  const seen: Record<string, boolean> = {};
  if (o.seen && typeof o.seen === 'object' && !Array.isArray(o.seen)) {
    for (const [k, v] of Object.entries(o.seen as Record<string, unknown>)) if (FLAG_RE.test(k) && v === true) seen[k] = true;
  }
  return {
    v: SAVE_VERSION,
    settings: o.settings && typeof o.settings === 'object' ? o.settings : null,
    unlocks: { freak: un.freak === true, ricky: un.ricky === true },
    clears,
    scores: { season: cleanBoard(sc.season, 'season'), pilot: cleanBoard(sc.pilot, 'pilot') },
    online: { name: cleanName(on.name) },
    seen,
  };
}

// ─────────────────────────────── the store ───────────────────────────────
export type SaveListener = (s: Readonly<SaveData>, what: string) => void;

export class SaveStore {
  private data: SaveData;
  private readonly fns = new Set<SaveListener>();
  private readonly key: string;
  /** false when the last write did not reach storage (kept in memory for the session) */
  persisted = true;
  /** storage was readable at construction */
  readonly available: boolean;

  constructor(key: string = SAVE_KEY) {
    this.key = key;
    this.available = store() !== null;
    this.data = sanitizeSave(readRaw(key));
  }

  /**
   * The save plus the flat read-outs lane UI's screens read (ui/types.ts UiSave): `seasonClears` (fighter -> SEASON +
   * PILOT clears), `bestScores` (fighter -> best ladder score, both boards), `board` (the SEASON board, best first)
   * and `onlineName`. Rebuilt on every read (small); the stored blob keeps only SaveData.
   */
  get(): Readonly<SaveView> {
    const d = this.data;
    const seasonClears: Record<string, number> = {};
    for (const [k, c] of Object.entries(d.clears)) seasonClears[k] = c.season + c.pilot;
    const bestScores: Record<string, number> = {};
    for (const r of [...d.scores.season, ...d.scores.pilot]) bestScores[r.fighter] = Math.max(bestScores[r.fighter] ?? 0, r.score);
    return { ...d, seasonClears, bestScores, board: d.scores.season.slice(), onlineName: d.online.name };
  }

  /** the UI's generic write (ui/types.ts UiSaveStore.set): only `onlineName` is writable this way */
  set(patch: { onlineName?: string }): void {
    if (patch && typeof patch.onlineName === 'string') this.setOnlineName(patch.onlineName);
  }

  on(fn: SaveListener): () => void {
    this.fns.add(fn);
    return () => { this.fns.delete(fn); };
  }

  private commit(what: string): boolean {
    this.data = sanitizeSave(this.data);
    this.persisted = writeRaw(this.key, this.data);
    for (const fn of [...this.fns]) {
      try { fn(this.data, what); } catch (e) { console.error('[hit-parade] save listener', e); }
    }
    return this.persisted;
  }

  // settings (the raw object; ui/settings.ts owns its shape)
  settingsRaw(): unknown { return this.data.settings; }
  writeSettings(v: unknown): boolean {
    this.data.settings = v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) as unknown : null;
    return this.commit('settings');
  }

  // unlocks
  isUnlocked(id: string): boolean {
    if (id === 'freak') return this.data.unlocks.freak;
    if (id === 'ricky') return this.data.unlocks.ricky;
    return true;
  }

  /**
   * A cleared ladder. A SEASON clear unlocks THE FREAK and RICKY MARQUEE for VERSUS. Returns the ids unlocked by
   * this clear (empty when already unlocked) and the board rank of `score` (0-based, null = not on the board).
   */
  recordClear(r: { fighter: string; length: LadderLength; difficulty: number; score: number; name?: string; at?: number }): { unlocked: string[]; rank: number | null } {
    const unlocked: string[] = [];
    if (!ID_RE.test(r.fighter)) return { unlocked, rank: null };
    const c = this.data.clears[r.fighter] ?? { season: 0, pilot: 0, bestDifficulty: null };
    if (r.length === 'season') c.season++; else c.pilot++;
    const dd = Math.round(Math.min(2, Math.max(-2, Number.isFinite(r.difficulty) ? r.difficulty : 0)));
    c.bestDifficulty = c.bestDifficulty === null ? dd : Math.max(c.bestDifficulty, dd);
    this.data.clears[r.fighter] = c;
    if (r.length === 'season') {
      if (!this.data.unlocks.freak) { this.data.unlocks.freak = true; unlocked.push('freak'); }
      if (!this.data.unlocks.ricky) { this.data.unlocks.ricky = true; unlocked.push('ricky'); }
    }
    const rank = this.insertScore({ name: r.name ?? this.data.online.name, fighter: r.fighter, score: r.score, length: r.length, difficulty: dd, at: r.at ?? Date.now() });
    this.commit('clear');
    return { unlocked, rank };
  }

  /** a ladder score (cleared or not) -> board rank or null; does not count as a clear */
  addScore(row: { name?: string; fighter: string; score: number; length: LadderLength; difficulty?: number; at?: number }): number | null {
    const rank = this.insertScore({ name: row.name ?? this.data.online.name, fighter: row.fighter, score: row.score, length: row.length,
      difficulty: row.difficulty ?? 0, at: row.at ?? Date.now() });
    if (rank !== null) this.commit('score');
    return rank;
  }

  private insertScore(raw: Record<string, unknown> & { length: LadderLength }): number | null {
    const row = cleanRow(raw, raw.length);
    if (!row) return null;
    const board = this.data.scores[row.length];
    board.push(row);
    board.sort((a, b) => b.score - a.score || a.at - b.at);
    const rank = board.indexOf(row);
    this.data.scores[row.length] = board.slice(0, BOARD_SIZE);
    return rank < BOARD_SIZE ? rank : null;
  }

  board(length: LadderLength): readonly ScoreRow[] { return this.data.scores[length]; }
  clears(fighter: string): Clear | null { return this.data.clears[fighter] ?? null; }

  setOnlineName(name: string): string {
    this.data.online.name = cleanName(name);
    this.commit('online');
    return this.data.online.name;
  }

  seen(flag: string): boolean { return this.data.seen[flag] === true; }
  markSeen(flag: string): void {
    if (!FLAG_RE.test(flag) || this.data.seen[flag]) return;
    this.data.seen[flag] = true;
    this.commit('seen');
  }

  /** wipe everything (settings included) - SETTINGS "reset save" and tests */
  reset(): void {
    this.data = emptySave();
    this.commit('reset');
  }
}
