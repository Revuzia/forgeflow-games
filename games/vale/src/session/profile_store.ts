// VALE session — the persisted Profile: creation, migrations, reconciliation, stores (CONTRACT §7, §8).
//
// STORES: LocalProfileStore persists one JSON blob at localStorage['vale.profile.v1']; every access
// is wrapped in try/catch, and when storage is missing or throws (private mode, quota, Node) it
// falls back to an in-memory copy for the rest of the page's life. MemoryProfileStore is the Node /
// probe store (it still round-trips through JSON, exactly like the real one). A blob that is not
// JSON is copied to '<key>.corrupt' before a fresh profile replaces it.
// LOGIN SEAM: a RemoteProfileStore implements the same ProfileStore over HTTPS (identity.ts).
//
// MIGRATIONS: `schema` is PROFILE_SCHEMA (contracts/session.ts). migrateProfile() walks MIGRATIONS
// from the blob's schema up to the current one; a blob from a NEWER client (schema > current) is
// refused (null) rather than downgraded. Schema 0 is the prototype save format, documented as
// ProfileV0 below: flat coin balances without a ledger, owned skins as a flag list, and no records.
// v0 → v1: identity from {id, name}; each known currency balance becomes one 'migration' ledger
// entry; each owned skin that still exists becomes an OwnershipRecord (source 'grant', sku
// 'migration:<skin>'); ratings keep rating/rd/vol/games/wins; history is dropped (its shape
// changed); settings are normalized onto the defaults. A migrated profile does NOT get the starter
// wallet again (it was paid in the v0 era) but does get any missing starter skins.
//
// NEW PROFILE: identity 'local-<random>', level 1, starter ownership records for every
// store.starterOwnership skin, starter wallet ledger entries, default settings, and each fighter's
// owned base skin equipped.
//
// RECONCILE (every load): starter skins added by a newer catalog, wallet keys for every currency,
// equipped entries that are no longer owned/known dropped and base skins re-equipped, settings
// normalized, history capped at HISTORY_CAP. Ownership records are never deleted.

import type { CatalogT } from '../contracts/catalog.ts';
import { PROFILE_SCHEMA } from '../contracts/session.ts';
import type { Identity, MatchHistoryEntry, Profile, ProfileStore, RatingRecord } from '../contracts/session.ts';
import {
  addLedger, addOwnership, grantStarterSkins, grantStarterWallet, ownsSkin, wornSkin, type LedgerCtx,
} from './economy.ts';
import { newLocalIdentity, sanitizeName } from './identity.ts';
import { defaultSettings, normalizeSettings } from './settings.ts';

export const PROFILE_KEY = 'vale.profile.v1';
export const HISTORY_CAP = 50;

/** what creating/migrating a profile needs */
export interface ProfileContext extends LedgerCtx {
  readonly catalog: CatalogT;
  /** random token for a new identity id */
  token(): string;
  /** display name for a brand-new identity */
  defaultName(): string;
}

/** schema 0: the prototype save format (no `schema` key, or schema: 0) */
export interface ProfileV0 {
  schema?: 0;
  id?: string;
  name?: string;
  created?: string;
  level?: number;
  xp?: number;
  /** currency id → balance (no ledger) */
  coins?: Record<string, number>;
  /** owned skin ids (flags) */
  skins?: string[];
  equipped?: Record<string, string>;
  ratings?: Record<string, { rating?: number; rd?: number; vol?: number; games?: number; wins?: number }>;
  history?: unknown[];
  settings?: unknown;
  tutorials?: string[];
}

// ── new profile + reconcile ─────────────────────────────────────────────────────────────────────
export function newProfile(ctx: ProfileContext, identity?: Identity): Profile {
  const id = identity ?? newLocalIdentity(ctx.token(), ctx.defaultName(), ctx.nowIso());
  const p: Profile = {
    schema: PROFILE_SCHEMA, identity: { ...id }, level: 1, xp: 0, wallet: {}, ledger: [], owned: [], equipped: {}, loadouts: {},
    ratings: {}, history: [], settings: defaultSettings(), seenCatalogVersion: ctx.catalog.version, tutorialsSeen: [],
  };
  grantStarterSkins(p, ctx.catalog, ctx);
  grantStarterWallet(p, ctx.catalog, ctx);
  equipDefaults(p, ctx.catalog);
  return p;
}

/** equip an owned base skin for every fighter whose equipped skin is missing or invalid */
function equipDefaults(p: Profile, catalog: CatalogT): boolean {
  let changed = false;
  for (const f of catalog.fighters) {
    const cur = p.equipped[f.id];
    if (cur && ownsSkin(p, cur)) continue;
    const s = wornSkin(p, catalog, f.id);
    if (s && ownsSkin(p, s)) { p.equipped[f.id] = s; changed = true; }
    else if (cur !== undefined) { delete p.equipped[f.id]; changed = true; }
  }
  return changed;
}

/** bring a loaded profile in line with the current catalog; true when anything changed */
export function reconcileProfile(p: Profile, ctx: ProfileContext): boolean {
  const c = ctx.catalog;
  let changed = grantStarterSkins(p, c, ctx) > 0;
  for (const cur of c.store.currencies) if (p.wallet[cur.id] === undefined) { p.wallet[cur.id] = 0; changed = true; }
  for (const [f, s] of Object.entries(p.equipped)) {
    const def = c.skins.find((x) => x.id === s);
    if (!def || def.fighter !== f || !ownsSkin(p, s)) { delete p.equipped[f]; changed = true; }
  }
  if (equipDefaults(p, c)) changed = true;
  const before = JSON.stringify(p.settings);
  p.settings = normalizeSettings(p.settings);
  if (JSON.stringify(p.settings) !== before) changed = true;
  if (p.history.length > HISTORY_CAP) { p.history.length = HISTORY_CAP; changed = true; }
  if (p.seenCatalogVersion !== c.version) { p.seenCatalogVersion = c.version; changed = true; }
  return changed;
}

// ── migrations ──────────────────────────────────────────────────────────────────────────────────
type Blob = Record<string, unknown>;
const isObj = (v: unknown): v is Blob => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** schema n → n + 1 */
export const MIGRATIONS: Readonly<Record<number, (raw: Blob, ctx: ProfileContext) => Blob>> = {
  0: (raw, ctx) => {
    const v0 = raw as ProfileV0;
    const c = ctx.catalog;
    const name = sanitizeName(v0.name, ctx.defaultName());
    const identity: Identity = typeof v0.id === 'string' && v0.id.length > 0
      ? { id: v0.id, displayName: name, kind: 'local', createdAt: typeof v0.created === 'string' ? v0.created : ctx.nowIso() }
      : newLocalIdentity(ctx.token(), name, ctx.nowIso());
    const p: Profile = {
      schema: PROFILE_SCHEMA, identity, level: Math.max(1, Math.floor(num(v0.level, 1))), xp: Math.max(0, Math.floor(num(v0.xp, 0))),
      wallet: {}, ledger: [], owned: [], equipped: {}, loadouts: {}, ratings: {}, history: [],
      settings: normalizeSettings(v0.settings), seenCatalogVersion: undefined, tutorialsSeen: Array.isArray(v0.tutorials) ? v0.tutorials.filter((t) => typeof t === 'string') : [],
    };
    for (const [cur, amount] of Object.entries(isObj(v0.coins) ? v0.coins : {})) {
      if (!c.store.currencies.some((x) => x.id === cur)) continue;
      const a = Math.max(0, Math.floor(num(amount, 0)));
      if (a > 0) addLedger(p, ctx, cur, a, 'migration', 'schema-0');
    }
    for (const id of Array.isArray(v0.skins) ? v0.skins : []) {
      const skin = typeof id === 'string' ? c.skins.find((s) => s.id === id) : undefined;
      if (skin && !ownsSkin(p, skin.id)) addOwnership(p, ctx, { sku: `migration:${skin.id}`, skin, source: 'grant' });
    }
    for (const [f, s] of Object.entries(isObj(v0.equipped) ? v0.equipped : {})) if (typeof s === 'string') p.equipped[f] = s;
    for (const [rid, r] of Object.entries(isObj(v0.ratings) ? v0.ratings : {})) {
      if (!isObj(r)) continue;
      const rating = num(r.rating, 1500);
      const rec: RatingRecord = {
        ratingId: rid, rating, rd: num(r.rd, 350), vol: num(r.vol, 0.06), games: Math.max(0, Math.floor(num(r.games, 0))),
        wins: Math.max(0, Math.floor(num(r.wins, 0))), peak: rating, provisional: true, updatedAt: ctx.nowIso(),
      };
      p.ratings[rid] = rec;
    }
    return p as unknown as Blob;
  },
};

/** fill a current-schema blob's missing/garbled fields (a hand-edited or truncated save) */
function normalizeCurrent(raw: Blob, ctx: ProfileContext): Profile {
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const obj = <T>(v: unknown): Record<string, T> => (isObj(v) ? (v as Record<string, T>) : {});
  const idRaw = obj<unknown>(raw.identity);
  const identity: Identity = typeof idRaw.id === 'string'
    ? { id: idRaw.id, displayName: sanitizeName(idRaw.displayName, ctx.defaultName()), kind: idRaw.kind === 'account' ? 'account' : 'local', createdAt: typeof idRaw.createdAt === 'string' ? idRaw.createdAt : ctx.nowIso() }
    : newLocalIdentity(ctx.token(), ctx.defaultName(), ctx.nowIso());
  return {
    schema: PROFILE_SCHEMA, identity,
    level: Math.max(1, Math.floor(num(raw.level, 1))), xp: Math.max(0, Math.floor(num(raw.xp, 0))),
    wallet: obj<number>(raw.wallet), ledger: arr(raw.ledger), owned: arr(raw.owned), equipped: obj<string>(raw.equipped),
    loadouts: obj(raw.loadouts), ratings: obj(raw.ratings), history: arr<MatchHistoryEntry>(raw.history),
    firstWinAt: typeof raw.firstWinAt === 'string' ? raw.firstWinAt : undefined,
    settings: normalizeSettings(raw.settings),
    seenCatalogVersion: typeof raw.seenCatalogVersion === 'string' ? raw.seenCatalogVersion : undefined,
    tutorialsSeen: arr<string>(raw.tutorialsSeen).filter((t) => typeof t === 'string'),
  };
}

export type MigrateResult = { profile: Profile; from: number; migrated: boolean } | { profile: null; from: number | null; reason: 'empty' | 'corrupt' | 'future' };

/** any stored blob → a current Profile (null when empty, unreadable, or from a newer client) */
export function migrateProfile(raw: unknown, ctx: ProfileContext): MigrateResult {
  if (raw === null || raw === undefined) return { profile: null, from: null, reason: 'empty' };
  if (!isObj(raw)) return { profile: null, from: null, reason: 'corrupt' };
  const from = raw.schema === undefined ? 0 : raw.schema;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 0) return { profile: null, from: null, reason: 'corrupt' };
  if (from > PROFILE_SCHEMA) return { profile: null, from, reason: 'future' };
  let blob: Blob = raw;
  for (let s = from; s < PROFILE_SCHEMA; s++) {
    const step = MIGRATIONS[s];
    if (!step) return { profile: null, from, reason: 'corrupt' };
    blob = step(blob, ctx);
  }
  return { profile: normalizeCurrent(blob, ctx), from, migrated: from !== PROFILE_SCHEMA };
}

// ── stores ──────────────────────────────────────────────────────────────────────────────────────
/** a ProfileStore that also hands out the raw blob (the session migrates it with its own context) */
export interface RawProfileStore extends ProfileStore {
  loadRaw(): unknown;
}

function parse(text: string | null): { ok: true; value: unknown } | { ok: false } {
  if (text === null) return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(text) as unknown }; } catch { return { ok: false }; }
}

/** in-memory store (Node, probes); serializes through JSON like the real one */
export class MemoryProfileStore implements RawProfileStore {
  private data: string | null;
  private readonly ctx: ProfileContext | undefined;
  corrupt: string | null = null;

  /** @param initial a blob to start from (object or JSON text), e.g. a schema-0 save */
  constructor(initial?: unknown, ctx?: ProfileContext) {
    this.data = initial === undefined || initial === null ? null : typeof initial === 'string' ? initial : JSON.stringify(initial);
    this.ctx = ctx;
  }
  loadRaw(): unknown {
    const r = parse(this.data);
    if (!r.ok) { this.corrupt = this.data; return null; }
    return r.value;
  }
  load(): Profile | null { return loadVia(this.loadRaw(), this.ctx); }
  save(p: Profile): void { this.data = JSON.stringify(p); }
  reset(): void { this.data = null; }
  /** the stored JSON text (tests) */
  raw(): string | null { return this.data; }
}

interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }

/** localStorage['vale.profile.v1'] with try/catch everywhere and an in-memory fallback */
export class LocalProfileStore implements RawProfileStore {
  readonly key: string;
  private storage: StorageLike | null;
  private memory: string | null = null;
  private readonly ctx: ProfileContext | undefined;
  /** true once storage failed and the store runs from memory */
  degraded = false;

  constructor(ctx?: ProfileContext, key = PROFILE_KEY, storage?: StorageLike | null) {
    this.ctx = ctx;
    this.key = key;
    if (storage !== undefined) this.storage = storage;
    else {
      try { this.storage = (globalThis as { localStorage?: StorageLike }).localStorage ?? null; } catch { this.storage = null; }
    }
    if (!this.storage) this.degraded = true;
  }
  private read(): string | null {
    if (this.storage) {
      try { return this.storage.getItem(this.key); } catch { this.fallback(); }
    }
    return this.memory;
  }
  private fallback(): void { this.storage = null; this.degraded = true; }
  loadRaw(): unknown {
    const text = this.read();
    const r = parse(text);
    if (r.ok) return r.value;
    if (this.storage) { try { this.storage.setItem(`${this.key}.corrupt`, text ?? ''); } catch { /* best effort */ } }
    return null;
  }
  load(): Profile | null { return loadVia(this.loadRaw(), this.ctx); }
  save(p: Profile): void {
    const text = JSON.stringify(p);
    this.memory = text;
    if (this.storage) {
      try { this.storage.setItem(this.key, text); } catch { this.fallback(); }
    }
  }
  reset(): void {
    this.memory = null;
    if (this.storage) {
      try { this.storage.removeItem(this.key); } catch { this.fallback(); }
    }
  }
}

/** ProfileStore.load(): with a context any older schema migrates; without one only a current-schema blob loads */
function loadVia(raw: unknown, ctx: ProfileContext | undefined): Profile | null {
  if (ctx) return migrateProfile(raw, ctx).profile;
  return isObj(raw) && raw.schema === PROFILE_SCHEMA ? (raw as unknown as Profile) : null;
}

export function isRawStore(s: ProfileStore): s is RawProfileStore {
  return typeof (s as Partial<RawProfileStore>).loadRaw === 'function';
}
