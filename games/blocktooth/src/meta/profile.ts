// BLOCKTOOTH v2 — the persistent profile's shape guard (FEATURES_V2 §8.3). APP-PURE: DOM-free and
// storage-free (core/save.ts does the storage). Lane L5 (META/ENDLESS-SIM).
//
// sanitizeProfile coerces a stored blob FIELD BY FIELD into a complete, in-range Profile, so a corrupt,
// hand-edited or older blob can never break the select screen, the goals screen or a run:
//   * unknown goal ids (done / best) are dropped; non-finite / negative numbers are dropped; counters are
//     floored and clamped to [0, MAX_COUNT]; strings that look like numbers are accepted (like settings);
//   * titan / biome / boss / perk ids are validated against the unions; palette indices are 0..2;
//   * clearedBy lists are de-duplicated and sorted in BIOME_IDS order; newUnlocks keeps only real
//     `locked` card ids (de-duplicated); cineSeen keeps only `${titan}.${biome}` keys.
// Never throws (probe_meta fuzzes it with corrupt JSON, wrong types and huge numbers).

import type { BiomeId, BossId, PerkId, Profile, TitanId } from '../core/types.ts';
import { BIOME_IDS, BOSS_IDS, PERK_IDS, TITAN_IDS } from '../core/types.ts';
import { GOAL_BY_ID } from '../data/goals.ts';
import { UPGRADE_BY_ID } from '../data/upgrades.ts';

/** upper bound for every counter / progress value (a hand-edited 1e308 cannot overflow a sum) */
const MAX_COUNT = 1e9;
/** upper bound for an epoch-ms timestamp (year ~2286) */
const MAX_TS = 1e13;

export function emptyProfile(): Profile {
  return {
    v: 1,
    done: {},
    best: {},
    life: {
      runs: 0, clears: 0, banishes: 0, evolutions: 0,
      clearedBy: { molo: [], voltkite: [], hearthback: [], briarwick: [] },
      bossKills: {},
    },
    perk: null,
    palette: { molo: 0, voltkite: 0, hearthback: 0, briarwick: 0 },
    cineSeen: {},
    newUnlocks: [],
  };
}

// ─────────────────────────────── coercion helpers ───────────────────────────────
const hasOwn = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
/** a real goal id (own key of GOAL_BY_ID — never 'constructor' / '__proto__' off the prototype) */
function isGoal(id: string): boolean { return hasOwn(GOAL_BY_ID, id); }

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** finite, ≥ 0 number (numeric strings accepted) or null */
function nonNeg(v: unknown, max = MAX_COUNT): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return n > max ? max : n;
}

function count(v: unknown): number {
  const n = nonNeg(v);
  return n === null ? 0 : Math.floor(n);
}

function isTitan(v: unknown): v is TitanId { return typeof v === 'string' && (TITAN_IDS as readonly string[]).includes(v); }
function isBiome(v: unknown): v is BiomeId { return typeof v === 'string' && (BIOME_IDS as readonly string[]).includes(v); }
function isBoss(v: unknown): v is BossId { return typeof v === 'string' && (BOSS_IDS as readonly string[]).includes(v); }
function isPerk(v: unknown): v is PerkId { return typeof v === 'string' && (PERK_IDS as readonly string[]).includes(v); }

/** a locked card (incl. locked evolutions) — the only ids that can carry a NEW ribbon */
function isLockedCard(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  if (!hasOwn(UPGRADE_BY_ID, v)) return false;
  const u = UPGRADE_BY_ID[v];
  return !!u && u.locked === true;
}

// ─────────────────────────────── sanitize ───────────────────────────────
/** Coerce anything (partial, corrupt, older schema, wrong types) into a complete Profile. Never throws. */
export function sanitizeProfile(v: unknown): Profile {
  const p = emptyProfile();
  try {
    const o = obj(v);
    if (!o) return p;

    const done = obj(o.done);
    if (done) {
      for (const id of Object.keys(done)) {
        if (!isGoal(id)) continue;
        const ts = nonNeg(done[id], MAX_TS);
        if (ts !== null) p.done[id] = Math.floor(ts);
      }
    }

    const best = obj(o.best);
    if (best) {
      for (const id of Object.keys(best)) {
        if (!isGoal(id)) continue;
        const x = nonNeg(best[id]);
        if (x !== null) p.best[id] = x;
      }
    }

    const life = obj(o.life);
    if (life) {
      p.life.runs = count(life.runs);
      p.life.clears = count(life.clears);
      p.life.banishes = count(life.banishes);
      p.life.evolutions = count(life.evolutions);
      const cb = obj(life.clearedBy);
      if (cb) {
        for (const t of TITAN_IDS) {
          const arr = cb[t];
          if (!Array.isArray(arr)) continue;
          p.life.clearedBy[t] = BIOME_IDS.filter((b) => arr.includes(b));
        }
      }
      const bk = obj(life.bossKills);
      if (bk) {
        for (const id of Object.keys(bk)) {
          if (!isBoss(id)) continue;
          const n = count(bk[id]);
          if (n > 0) p.life.bossKills[id] = n;
        }
      }
    }

    p.perk = isPerk(o.perk) ? o.perk : null;

    const pal = obj(o.palette);
    if (pal) {
      for (const t of TITAN_IDS) {
        const n = nonNeg(pal[t], 2);
        p.palette[t] = n === null ? 0 : Math.round(n);
      }
    }

    const cs = obj(o.cineSeen);
    if (cs) {
      for (const k of Object.keys(cs)) {
        const dot = k.indexOf('.');
        if (dot < 0) continue;
        const t = k.slice(0, dot), b = k.slice(dot + 1);
        if (isTitan(t) && isBiome(b) && cs[k]) p.cineSeen[k] = 1;
      }
    }

    if (Array.isArray(o.newUnlocks)) {
      const seen = new Set<string>();
      for (const id of o.newUnlocks) if (isLockedCard(id) && !seen.has(id)) { seen.add(id); p.newUnlocks.push(id); }
    }
  } catch {
    return emptyProfile();
  }
  return p;
}

/** Deep copy of a (sanitised) profile — goals.ts returns new profiles, never mutates the caller's. */
export function cloneProfile(p: Profile): Profile {
  const c = emptyProfile();
  c.done = { ...p.done };
  c.best = { ...p.best };
  c.life = {
    runs: p.life.runs, clears: p.life.clears, banishes: p.life.banishes, evolutions: p.life.evolutions,
    clearedBy: {
      molo: p.life.clearedBy.molo.slice(), voltkite: p.life.clearedBy.voltkite.slice(),
      hearthback: p.life.clearedBy.hearthback.slice(), briarwick: p.life.clearedBy.briarwick.slice(),
    },
    bossKills: { ...p.life.bossKills },
  };
  c.perk = p.perk;
  c.palette = { ...p.palette };
  c.cineSeen = { ...p.cineSeen };
  c.newUnlocks = p.newUnlocks.slice();
  return c;
}
