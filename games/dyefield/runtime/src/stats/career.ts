// DYEFIELD — career: buckets, slots, apply-a-record, merge, display fold, the cloud record, localStorage I/O
// (_spec/CONTRACT_STATS.md §S5). Pure except the two storage helpers at the bottom (every access in try/catch).
//
// Every number in a slot only ever grows: counters add, bests take the max, ach[slug] = the first-unlock time (never
// removed). That makes three merges exact:
//   addSlot      (guest claim)        counters summed, bests maxed, achievements unioned
//   maxMergeSlot (my slot vs. its     per-leaf max — two snapshots of the SAME monotone slot (the cloud copy can only be
//                 cloud copy)         behind my local bucket, or ahead of an empty / storage-less one)
//   foldSlots    (display career)     counters summed, bests maxed, achievements unioned (earliest), recent = newest 10

import type {
  AcctSlot, Bests, CareerCounters, CloudRecord, DisplayCareer, LocalStore, MatchRecord, ModeKey, Outcome, Slot, WLD,
} from './types.ts';

export const KIT_IDS = ['mist-rasp', 'sheet-drum', 'needle-glint', 'pop-well'] as const;
export const MAP_IDS = ['pier18', 'lockwell', 'cinder'] as const;
export const MODE_KEYS: readonly ModeKey[] = ['teams_turf', 'teams_washout', 'ffa_turf', 'ffa_washout'];
export const RECENT_SLOT = 5;
export const RECENT_DISPLAY = 10;
export const PENDING_MAX = 50;
export const STORE_KEY = 'dyefield.career.v1';
export const STORE_KEY_DEV = 'dyefield.career.dev.v1';

// ───────────────────────────── constructors ─────────────────────────────

export const wld = (): WLD => ({ m: 0, w: 0, l: 0, d: 0 });

export function emptyCounters(): CareerCounters {
  const byKit: Record<string, WLD> = {};
  for (const k of KIT_IDS) byKit[k] = wld();
  const byMap: Record<string, WLD> = {};
  for (const m of MAP_IDS) byMap[m] = wld();
  return {
    matches: 0, wins: 0, losses: 0, draws: 0, idle: 0, abandoned: 0,
    byMode: { teams_turf: wld(), teams_washout: wld(), ffa_turf: wld(), ffa_washout: wld() },
    byKit, byMap,
    online: { ...wld(), void: 0 },
    storm: wld(),
    podiums: 0, limitWins: 0,
    washes: 0, washed: 0, paintedM2: 0, specials: 0, subs: 0, splashdowns: 0, liveS: 0,
  };
}

export const emptyBests = (): Bests => ({ score: 0, turfPctTeams: 0, turfPctFfa: 0, washes: 0, paintedM2: 0, streak: 0 });

export function emptySlot(at = 0): Slot {
  return { c: emptyCounters(), best: emptyBests(), ach: {}, recent: [], at };
}

export function emptyAcct(now: number): AcctSlot {
  return { ...emptySlot(0), since: now, achSyncAt: 0 };
}

export function randomToken(len: number, rnd: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < len; i++) s += Math.floor(rnd() * 36).toString(36);
  return s;
}

export function emptyStore(rnd: () => number = Math.random): LocalStore {
  return { v: 1, dev: randomToken(12, rnd), guest: emptySlot(0), accts: {}, pending: [], pendingX: { abandoned: 0, void: 0 }, outbox: [], lastTag: null };
}

// ───────────────────────────── generic numeric-tree helpers ─────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** a ← a ⊕ b over every numeric leaf of b (missing keys are created); op 'add' or 'max' */
function combineInto(a: Record<string, unknown>, b: Record<string, unknown>, op: 'add' | 'max'): void {
  for (const k of Object.keys(b)) {
    const bv = b[k];
    if (isObj(bv)) {
      if (!isObj(a[k])) a[k] = {};
      combineInto(a[k] as Record<string, unknown>, bv, op);
    } else if (typeof bv === 'number' && Number.isFinite(bv)) {
      const av = num(a[k]);
      a[k] = op === 'add' ? av + bv : Math.max(av, bv);
    }
  }
}

/** a deep copy of a slot, normalised (missing parts filled, non-numeric leaves dropped) — safe on cloud data */
export function normSlot(s: unknown): Slot {
  const out = emptySlot(0);
  if (!isObj(s)) return out;
  if (isObj(s.c)) combineInto(out.c as unknown as Record<string, unknown>, s.c, 'max');
  if (isObj(s.best)) combineInto(out.best as unknown as Record<string, unknown>, s.best, 'max');
  if (isObj(s.ach)) for (const k of Object.keys(s.ach)) { const t = num(s.ach[k]); if (k.length <= 64) out.ach[k] = t; }
  if (Array.isArray(s.recent)) out.recent = s.recent.filter(isRecordLike).slice(0, RECENT_SLOT).map((r) => ({ ...(r as MatchRecord) }));
  out.at = num(s.at);
  return out;
}

function isRecordLike(r: unknown): boolean {
  return isObj(r) && typeof r.id === 'string' && typeof r.at === 'number' && typeof r.mode === 'string' && typeof r.result === 'string';
}

export function slotIsEmpty(s: Slot): boolean {
  return s.c.matches === 0 && s.c.idle === 0 && s.c.abandoned === 0 && s.c.online.void === 0 && Object.keys(s.ach).length === 0 && s.recent.length === 0;
}

export function cloneSlot(s: Slot): Slot { return normSlot(s); }

// ───────────────────────────── apply ─────────────────────────────

function bump(x: WLD, res: MatchRecord['result']): void {
  x.m++;
  if (res === 'win') x.w++; else if (res === 'loss') x.l++; else x.d++;
}

/** §S5.1: one outcome into a slot (mutates). Eligible records count; an ineligible one is idle; abandons / voids count only themselves. */
export function applyOutcome(slot: Slot, o: Outcome): void {
  const c = slot.c;
  if (o.k === 'abandoned') { c.abandoned++; slot.at = Math.max(slot.at, o.at); return; }
  if (o.k === 'void') { c.online.void++; slot.at = Math.max(slot.at, o.at); return; }
  const r = o.rec;
  slot.at = Math.max(slot.at, r.at);
  if (!r.eligible) { c.idle++; return; }
  c.matches++;
  if (r.result === 'win') c.wins++; else if (r.result === 'loss') c.losses++; else c.draws++;
  bump(c.byMode[`${r.mode}_${r.rule}` as ModeKey] ??= wld(), r.result);
  bump(c.byKit[r.kit] ??= wld(), r.result);
  bump(c.byMap[r.map] ??= wld(), r.result);
  if (r.online) bump(c.online, r.result);
  if (!r.online && r.skill === 'storm') bump(c.storm, r.result);
  if (r.mode === 'ffa' && r.place <= 3) c.podiums++;
  if (r.rule === 'washout' && r.result === 'win' && r.endedBy === 'limit') c.limitWins++;
  c.washes += r.washes; c.washed += r.washed; c.paintedM2 += r.paintedM2;
  c.specials += r.specials; c.subs += r.subs; c.splashdowns += r.splashdowns;
  c.liveS = Math.round((c.liveS + r.liveS) * 10) / 10;
  const b = slot.best;
  b.score = Math.max(b.score, r.score);
  if (r.mode === 'teams') b.turfPctTeams = Math.max(b.turfPctTeams, r.turfPct); else b.turfPctFfa = Math.max(b.turfPctFfa, r.turfPct);
  b.washes = Math.max(b.washes, r.washes);
  b.paintedM2 = Math.max(b.paintedM2, r.paintedM2);
  b.streak = Math.max(b.streak, r.bestStreak);
  slot.recent = mergeRecent([r], slot.recent, RECENT_SLOT);
}

/** newest first by `at`, unique by id, at most n */
export function mergeRecent(a: readonly MatchRecord[], b: readonly MatchRecord[], n: number): MatchRecord[] {
  const seen = new Set<string>();
  const out: MatchRecord[] = [];
  for (const r of [...a, ...b].sort((x, y) => (y.at - x.at) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

function unionAch(into: Record<string, number>, from: Record<string, number>): void {
  for (const k of Object.keys(from)) {
    const t = num(from[k]);
    into[k] = k in into ? Math.min(num(into[k]), t) : t;
  }
}

/** guest claim: counters added, bests maxed, achievements unioned (mutates `into`) */
export function addSlot(into: Slot, from: Slot): void {
  combineInto(into.c as unknown as Record<string, unknown>, from.c as unknown as Record<string, unknown>, 'add');
  into.c.liveS = Math.round(into.c.liveS * 10) / 10;
  combineInto(into.best as unknown as Record<string, unknown>, from.best as unknown as Record<string, unknown>, 'max');
  unionAch(into.ach, from.ach);
  into.recent = mergeRecent(into.recent, from.recent, RECENT_SLOT);
  into.at = Math.max(into.at, from.at);
}

/** two snapshots of the same monotone slot → the per-leaf max (mutates `into`) */
export function maxMergeSlot(into: Slot, from: Slot): void {
  combineInto(into.c as unknown as Record<string, unknown>, from.c as unknown as Record<string, unknown>, 'max');
  combineInto(into.best as unknown as Record<string, unknown>, from.best as unknown as Record<string, unknown>, 'max');
  unionAch(into.ach, from.ach);
  into.recent = mergeRecent(into.recent, from.recent, RECENT_SLOT);
  into.at = Math.max(into.at, from.at);
}

/** is `cloud` behind `mine` on any counter / best / achievement (or missing)? → the repair push (§S3.3) */
export function slotBehind(cloud: Slot | undefined, mine: Slot): boolean {
  if (!cloud) return !slotIsEmpty(mine);
  const behind = (a: unknown, b: unknown): boolean => {
    if (isObj(b)) {
      for (const k of Object.keys(b)) if (behind(isObj(a) ? a[k] : undefined, b[k])) return true;
      return false;
    }
    return typeof b === 'number' && Number.isFinite(b) && num(a) < b;
  };
  if (behind(cloud.c, mine.c) || behind(cloud.best, mine.best)) return true;
  for (const k of Object.keys(mine.ach)) if (!(k in cloud.ach)) return true;
  const ids = new Set(cloud.recent.map((r) => r.id));
  return mine.recent.some((r) => !ids.has(r.id));
}

/** §S5.4: the display career over several slots */
export function foldSlots(slots: readonly Slot[], extra: readonly MatchRecord[] = []): DisplayCareer {
  const acc = emptySlot(0);
  for (const s of slots) addSlot(acc, s);
  let recent: MatchRecord[] = [];
  for (const s of slots) recent = mergeRecent(recent, s.recent, RECENT_DISPLAY);
  recent = mergeRecent(recent, extra.filter((r) => r.eligible), RECENT_DISPLAY);
  return { c: acc.c, best: acc.best, ach: acc.ach, recent };
}

/** the guest slot plus the pending records (§S5.4 "otherwise") */
export function provisionalSlot(guest: Slot, pending: readonly MatchRecord[], x: { abandoned: number; void: number }): Slot {
  const s = cloneSlot(guest);
  for (const r of pending) applyOutcome(s, { k: 'record', rec: r });
  s.c.abandoned += x.abandoned;
  s.c.online.void += x.void;
  return s;
}

// ───────────────────────────── the cloud record (§S5.3) ─────────────────────────────

/** validation of a read: v === 1, tags and slots plain objects, every slot's c an object */
export function validCloud(d: unknown): d is CloudRecord {
  if (!isObj(d) || d.v !== 1 || !isObj(d.tags) || !isObj(d.slots)) return false;
  for (const k of Object.keys(d.slots)) { const s = d.slots[k]; if (!isObj(s) || !isObj(s.c)) return false; }
  return true;
}

/** the account tag a device uses for a cloud record: a local bucket whose tag the record lists (several: the oldest
 *  bucket), else the record's oldest tag (a new local bucket); null for an empty record (the caller makes a tag) */
export function pickTag(rec: CloudRecord | null, accts: Readonly<Record<string, AcctSlot>>): { tag: string; known: boolean } | null {
  if (!rec) return null;
  const tags = Object.keys(rec.tags).filter((t) => typeof t === 'string' && t.length > 0 && t.length <= 32);
  if (!tags.length) return null;
  const known = tags.filter((t) => accts[t]).sort((a, b) => (accts[a].since - accts[b].since) || (a < b ? -1 : 1));
  if (known.length) return { tag: known[0], known: true };
  const oldest = tags.sort((a, b) => (num(rec.tags[a]) - num(rec.tags[b])) || (a < b ? -1 : 1))[0];
  return { tag: oldest, known: false };
}

export function slotKeyFor(dev: string, tag: string, storageless: boolean): string {
  return storageless ? `nostore-${tag}` : `${dev}-${tag}`;
}

/** the thin push: only my tag and my slot (the portal's merge keeps every other key) */
export function thinPayload(tag: string, tagSince: number, slotKey: string, slot: Slot): CloudRecord {
  const s = cloneSlot(slot);
  return { v: 1, game: 'dyefield', tags: { [tag]: tagSince }, slots: { [slotKey]: { c: s.c, best: s.best, ach: s.ach, recent: s.recent, at: s.at } } };
}

/** a JS port of forgeflow-games/src/lib/saveMerge.ts mergePreservingKeys (the probe + the harness model the portal) */
export function mergePreservingKeys(stored: unknown, incoming: unknown): unknown {
  if (stored === null || stored === undefined) return incoming;
  if (incoming === null || incoming === undefined) return stored;
  if (!isObj(stored) || !isObj(incoming)) return incoming;
  const out: Record<string, unknown> = { ...stored };
  for (const k of Object.keys(incoming)) {
    out[k] = isObj(stored[k]) && isObj(incoming[k]) ? mergePreservingKeys(stored[k], incoming[k]) : incoming[k];
  }
  return out;
}

// ───────────────────────────── the local store (§S5.2) ─────────────────────────────

/** a store read from storage → a valid store (unknown / broken parts replaced; a broken store → a fresh one) */
export function normStore(raw: unknown, rnd: () => number = Math.random): LocalStore {
  if (!isObj(raw) || raw.v !== 1) return emptyStore(rnd);
  const s = emptyStore(rnd);
  if (typeof raw.dev === 'string' && /^[0-9a-z]{6,24}$/.test(raw.dev)) s.dev = raw.dev;
  s.guest = normSlot(raw.guest);
  if (isObj(raw.accts)) {
    for (const t of Object.keys(raw.accts)) {
      const a = raw.accts[t];
      if (!isObj(a)) continue;
      s.accts[t] = { ...normSlot(a), since: num(a.since), achSyncAt: num(a.achSyncAt) };
    }
  }
  if (Array.isArray(raw.pending)) s.pending = raw.pending.filter(isRecordLike).slice(-PENDING_MAX) as MatchRecord[];
  if (isObj(raw.pendingX)) s.pendingX = { abandoned: num(raw.pendingX.abandoned), void: num(raw.pendingX.void) };
  if (Array.isArray(raw.outbox)) {
    for (const it of raw.outbox) {
      if (!isObj(it)) continue;
      if (it.k === 'ach' && typeof it.slug === 'string') s.outbox.push({ k: 'ach', slug: it.slug });
      else if (it.k === 'score' && typeof it.score === 'number' && typeof it.at === 'number') s.outbox.push({ k: 'score', score: it.score, at: it.at });
    }
  }
  s.lastTag = typeof raw.lastTag === 'string' ? raw.lastTag : null;
  return s;
}

/** the minimal storage surface (localStorage, or a fake in the probe) */
export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** a write-then-read test of the storage; false → the session is storage-less (§S5.2) */
export function storageWorks(kv: KV | null): boolean {
  if (!kv) return false;
  try {
    const k = 'dyefield.career.probe', v = String(Date.now());
    kv.setItem(k, v);
    const ok = kv.getItem(k) === v;
    kv.removeItem(k);
    return ok;
  } catch { return false; }
}

export function readStore(kv: KV | null, key: string, rnd: () => number = Math.random): LocalStore {
  if (!kv) return emptyStore(rnd);
  try {
    const raw = kv.getItem(key);
    return raw ? normStore(JSON.parse(raw), rnd) : emptyStore(rnd);
  } catch { return emptyStore(rnd); }
}

export function writeStore(kv: KV | null, key: string, s: LocalStore): boolean {
  if (!kv) return false;
  try { kv.setItem(key, JSON.stringify(s)); return true; } catch { return false; }
}
