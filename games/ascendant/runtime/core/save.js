/* ============================================================================
 * ASCENDANT — runtime/core/save.js
 * Contract §3.  Versioned, migration-guarded, fail-soft persistence.
 *
 * Storage key: 'ascendant.save.v1'   (backup on a rejected migration: '…​.bak')
 *
 * Every localStorage touch is wrapped: in private mode / a sandboxed iframe the
 * whole API keeps working against an in-memory store for the session, and
 * `Save.persistent` reports false so the UI can say so.
 *
 * World unlock rule (deliberately generous — a player is never hard-walled):
 *   world 0 is always unlocked; world N unlocks once world N-1 has >= 2 stages
 *   cleared.  Stage ids follow the contract's `<worldId>-<n>` convention, so
 *   world membership is derived from the id — save.js imports nothing.
 *   Game may call `Save.registerWorlds(WORLDS)` at boot for exact stage counts.
 * ==========================================================================*/

const KEY = 'ascendant.save.v1';
const BAK_KEY = 'ascendant.save.v1.bak';
const SCHEMA_VERSION = 1;
const WRITE_DEBOUNCE_MS = 320;
const DEFAULT_STAGES_PER_WORLD = 3;
const UNLOCK_THRESHOLD = 2;

/** Fallback world order — matches contract §22. `registerWorlds` overrides it. */
const DEFAULT_WORLD_ORDER = ['neon', 'foundry', 'spire', 'temple'];

const IS_BROWSER = typeof window !== 'undefined';

/* ---------------------------------------------------------------- helpers */
function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function num(v, def) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : def;
}

function posInt(v, def) {
  const n = num(v, def);
  const i = Math.floor(n);
  return i >= 0 ? i : def;
}

function msOrNull(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return Math.round(v);
}

function uniqSortedInts(arr, cap) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const n = arr[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) continue;
    const k = Math.floor(n);
    if (k < 0 || k > 4095) continue;
    if (out.indexOf(k) === -1) out.push(k);
    if (out.length >= (cap || 512)) break;
  }
  out.sort((a, b) => a - b);
  return out;
}

function worldOf(stageId) {
  if (typeof stageId !== 'string') return '';
  const i = stageId.lastIndexOf('-');
  return i > 0 ? stageId.slice(0, i) : stageId;
}

function freshStage(stageId) {
  return {
    id: stageId,
    world: worldOf(stageId),
    best: null,              // ms, null until first clear
    deaths: 0,
    cleared: false,
    coins: [],               // collected coin indices
    cpIndex: 0,              // furthest checkpoint reached
    attempts: 0,
    clears: 0,
    playMs: 0,
    firstClearDate: null,    // ISO string
    lastPlayed: 0,           // epoch ms
    longestRunNoDeathMs: 0,
  };
}

function freshData() {
  const now = Date.now();
  return {
    v: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    sessions: 0,
    totalPlaytimeMs: 0,
    longestRunNoDeathMs: 0,
    unlockAll: false,
    stages: Object.create(null),
  };
}

/* ------------------------------------------------------------ storage shim */
const _mem = Object.create(null);
let _storeChecked = false;
let _store = null;          // window.localStorage or null
let _persistent = false;

function storage() {
  if (_storeChecked) return _store;
  _storeChecked = true;
  try {
    if (IS_BROWSER && window.localStorage) {
      const probe = '__asc_probe__';
      window.localStorage.setItem(probe, '1');
      window.localStorage.removeItem(probe);
      _store = window.localStorage;
      _persistent = true;
    }
  } catch (e) {
    _store = null;
    _persistent = false;
  }
  return _store;
}

function readRaw(key) {
  try {
    const s = storage();
    if (s) return s.getItem(key);
  } catch (e) { /* quota / security */ }
  return Object.prototype.hasOwnProperty.call(_mem, key) ? _mem[key] : null;
}

function writeRaw(key, value) {
  _mem[key] = value;
  try {
    const s = storage();
    if (s) { s.setItem(key, value); return true; }
  } catch (e) {
    /* QuotaExceeded: drop the backup slot and retry once. */
    try {
      const s2 = storage();
      if (s2) { s2.removeItem(BAK_KEY); s2.setItem(key, value); return true; }
    } catch (e2) { /* stay in memory */ }
  }
  return false;
}

function removeRaw(key) {
  delete _mem[key];
  try {
    const s = storage();
    if (s) s.removeItem(key);
  } catch (e) {}
}

/* ------------------------------------------------------------- migration */
/**
 * Accepts anything and returns a valid, fully sanitised save object.
 * Unknown-future versions are preserved to the .bak slot and replaced with a
 * fresh save rather than being half-read into a broken state.
 */
function migrate(raw) {
  if (!isObj(raw)) return { data: freshData(), replaced: true };

  const v = posInt(raw.v, 0);

  if (v > SCHEMA_VERSION) {
    try { writeRaw(BAK_KEY, JSON.stringify(raw)); } catch (e) {}
    const d = freshData();
    d.migratedFromVersion = v;
    return { data: d, replaced: true };
  }

  const out = freshData();
  out.createdAt = posInt(raw.createdAt, out.createdAt);
  out.updatedAt = posInt(raw.updatedAt, out.updatedAt);
  out.sessions = posInt(raw.sessions, 0);
  out.totalPlaytimeMs = posInt(raw.totalPlaytimeMs, 0);
  out.longestRunNoDeathMs = posInt(raw.longestRunNoDeathMs, 0);
  out.unlockAll = raw.unlockAll === true;

  /* v0 (pre-versioning) stored the stage map at the root. */
  const srcStages = isObj(raw.stages) ? raw.stages : (v === 0 ? raw : null);
  if (isObj(srcStages)) {
    for (const id in srcStages) {
      if (!Object.prototype.hasOwnProperty.call(srcStages, id)) continue;
      if (id === 'v' || id === 'stages' || id === 'createdAt' || id === 'updatedAt') continue;
      const s = srcStages[id];
      if (!isObj(s)) continue;
      const rec = freshStage(id);
      rec.best = msOrNull(s.best);
      rec.deaths = posInt(s.deaths, 0);
      rec.cleared = s.cleared === true || rec.best !== null;
      rec.coins = uniqSortedInts(s.coins, 512);
      rec.cpIndex = posInt(s.cpIndex, 0);
      rec.attempts = posInt(s.attempts, 0);
      rec.clears = posInt(s.clears, rec.cleared ? 1 : 0);
      rec.playMs = posInt(s.playMs, 0);
      rec.lastPlayed = posInt(s.lastPlayed, 0);
      rec.longestRunNoDeathMs = posInt(s.longestRunNoDeathMs, 0);
      rec.firstClearDate = (typeof s.firstClearDate === 'string' && s.firstClearDate.length <= 40)
        ? s.firstClearDate : null;
      if (rec.cleared && !rec.firstClearDate) rec.firstClearDate = new Date(rec.lastPlayed || Date.now()).toISOString();
      if (typeof s.world === 'string' && s.world) rec.world = s.world;
      out.stages[id] = rec;
    }
  }

  out.v = SCHEMA_VERSION;
  return { data: out, replaced: false };
}

/* ============================================================ Save object */
let _data = null;
let _dirty = false;
let _writeTimer = 0;
let _unloadHooked = false;
const _subs = [];

let _worldOrder = DEFAULT_WORLD_ORDER.slice();
let _worldStages = Object.create(null);   // worldId -> [stageId] (from registerWorlds)

function ensure() {
  if (_data) return _data;
  Save.load();
  return _data;
}

function emit(type, payload) {
  if (_subs.length === 0) return;
  const evt = payload || {};
  evt.type = type;
  for (let i = 0; i < _subs.length; i++) {
    try { _subs[i](evt); } catch (e) { /* a bad subscriber never breaks a save */ }
  }
}

function hookUnload() {
  if (_unloadHooked || !IS_BROWSER) return;
  _unloadHooked = true;
  const flush = () => { try { Save.flush(); } catch (e) {} };
  window.addEventListener('pagehide', flush, false);
  window.addEventListener('beforeunload', flush, false);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  }, false);
}

function markDirty(type, payload) {
  _dirty = true;
  if (_data) _data.updatedAt = Date.now();
  hookUnload();
  if (IS_BROWSER) {
    if (_writeTimer) clearTimeout(_writeTimer);
    _writeTimer = setTimeout(() => { _writeTimer = 0; Save.flush(); }, WRITE_DEBOUNCE_MS);
  }
  if (type) emit(type, payload);
}

function clearedCountIn(worldId) {
  const d = ensure();
  const listed = _worldStages[worldId];
  let n = 0;
  if (listed && listed.length) {
    for (let i = 0; i < listed.length; i++) {
      const rec = d.stages[listed[i]];
      if (rec && rec.cleared) n++;
    }
    return n;
  }
  const prefix = worldId + '-';
  for (const id in d.stages) {
    if (!Object.prototype.hasOwnProperty.call(d.stages, id)) continue;
    if (id.indexOf(prefix) === 0 && d.stages[id].cleared) n++;
  }
  return n;
}

export const Save = {
  /** localStorage key, exposed for tooling/tests. */
  KEY,
  SCHEMA_VERSION,

  /** false when running in private mode / storage-denied contexts. */
  get persistent() { storage(); return _persistent; },

  /* ---------------------------------------------------- load / reset / io */

  /** Read + migrate from storage. Idempotent; returns the live save object. */
  load() {
    let parsed = null;
    try {
      const raw = readRaw(KEY);
      if (raw) parsed = JSON.parse(raw);
    } catch (e) {
      /* Corrupt JSON: keep the bad text around for a bug report, start clean. */
      try { const raw = readRaw(KEY); if (raw) writeRaw(BAK_KEY, raw); } catch (e2) {}
      parsed = null;
    }
    const res = migrate(parsed);
    _data = res.data;
    _data.sessions = posInt(_data.sessions, 0) + 1;
    if (res.replaced || !parsed) markDirty(null);
    else { _dirty = true; hookUnload(); }
    emit('load', { replaced: res.replaced });
    return _data;
  },

  /** Wipe everything back to a brand-new save. */
  reset() {
    const old = _data;
    if (old) { try { writeRaw(BAK_KEY, JSON.stringify(old)); } catch (e) {} }
    _data = freshData();
    _data.sessions = 1;
    _dirty = true;
    this.flush();
    emit('reset', {});
    return _data;
  },

  /** Force an immediate synchronous write. */
  flush() {
    if (!_data || !_dirty) return true;
    if (_writeTimer) { try { clearTimeout(_writeTimer); } catch (e) {} _writeTimer = 0; }
    let ok = false;
    try {
      _data.updatedAt = Date.now();
      ok = writeRaw(KEY, JSON.stringify(_data));
    } catch (e) { ok = false; }
    _dirty = false;
    return ok;
  },

  /** Raw JSON string of the whole save (for an export/backup button). */
  exportJSON() {
    const d = ensure();
    try { return JSON.stringify(d); } catch (e) { return '{}'; }
  },

  /** Replace the save from a JSON string. Returns true on success. */
  importJSON(str) {
    let parsed = null;
    try { parsed = JSON.parse(String(str)); } catch (e) { return false; }
    if (!isObj(parsed)) return false;
    if (_data) { try { writeRaw(BAK_KEY, JSON.stringify(_data)); } catch (e) {} }
    const res = migrate(parsed);
    _data = res.data;
    _dirty = true;
    this.flush();
    emit('import', { replaced: res.replaced });
    return true;
  },

  /* ------------------------------------------------------ change events */
  on(fn) { if (typeof fn === 'function' && _subs.indexOf(fn) === -1) _subs.push(fn); return this; },
  off(fn) { const i = _subs.indexOf(fn); if (i !== -1) _subs.splice(i, 1); return this; },

  /* --------------------------------------------------------- world wiring */
  /**
   * Optional: give Save the authoritative world list so `worldCleared` knows the
   * exact stage count. Accepts contract §22's WORLDS array.
   */
  registerWorlds(worlds) {
    if (!Array.isArray(worlds) || worlds.length === 0) return this;
    const order = [];
    const map = Object.create(null);
    for (let i = 0; i < worlds.length; i++) {
      const w = worlds[i];
      if (!isObj(w) || typeof w.id !== 'string' || !w.id) continue;
      order.push(w.id);
      map[w.id] = Array.isArray(w.stages) ? w.stages.filter((s) => typeof s === 'string' && s) : [];
    }
    if (order.length) { _worldOrder = order; _worldStages = map; }
    return this;
  },

  worldOrder() { return _worldOrder.slice(); },

  /* --------------------------------------------------------- stage record */
  /**
   * Live per-stage record (created on demand). Superset of the contract shape:
   * {best, deaths, cleared, coins, cpIndex} plus attempts/clears/playMs/
   * firstClearDate/longestRunNoDeathMs/lastPlayed.
   * Treat it as read-only — mutate through the methods so writes get scheduled.
   */
  stage(stageId) {
    const d = ensure();
    const id = String(stageId);
    let rec = d.stages[id];
    if (!rec) { rec = freshStage(id); d.stages[id] = rec; }
    return rec;
  },

  /** Detached copy, safe to hand to UI code that mutates. */
  stageCopy(stageId) {
    const r = this.stage(stageId);
    return {
      id: r.id, world: r.world, best: r.best, deaths: r.deaths, cleared: r.cleared,
      coins: r.coins.slice(), cpIndex: r.cpIndex, attempts: r.attempts, clears: r.clears,
      playMs: r.playMs, firstClearDate: r.firstClearDate, lastPlayed: r.lastPlayed,
      longestRunNoDeathMs: r.longestRunNoDeathMs,
    };
  },

  /** Every stage id that has a record. */
  stageIds() {
    const d = ensure();
    const out = [];
    for (const id in d.stages) if (Object.prototype.hasOwnProperty.call(d.stages, id)) out.push(id);
    out.sort();
    return out;
  },

  /** True if this run's time is a new personal best. Returns the record. */
  setBest(stageId, ms) {
    const rec = this.stage(stageId);
    const t = msOrNull(ms);
    if (t === null) return rec;
    if (rec.best === null || t < rec.best) {
      const prev = rec.best;
      rec.best = t;
      rec.lastPlayed = Date.now();
      markDirty('best', { stageId: rec.id, best: t, prev });
      this.flush();
    }
    return rec;
  },

  addDeath(stageId) {
    const rec = this.stage(stageId);
    rec.deaths++;
    rec.lastPlayed = Date.now();
    markDirty('death', { stageId: rec.id, deaths: rec.deaths });
    return rec.deaths;
  },

  /** Count a fresh attempt (stage start / full restart). */
  addAttempt(stageId) {
    const rec = this.stage(stageId);
    rec.attempts++;
    rec.lastPlayed = Date.now();
    markDirty('attempt', { stageId: rec.id, attempts: rec.attempts });
    return rec.attempts;
  },

  /** Furthest checkpoint reached. Never moves backwards unless forced. */
  setCheckpoint(stageId, idx, force) {
    const rec = this.stage(stageId);
    const i = posInt(idx, 0);
    if (force === true) {
      if (rec.cpIndex === i) return rec.cpIndex;
      rec.cpIndex = i;
    } else {
      if (i <= rec.cpIndex) return rec.cpIndex;
      rec.cpIndex = i;
    }
    markDirty('checkpoint', { stageId: rec.id, cpIndex: rec.cpIndex });
    return rec.cpIndex;
  },

  /** Full restart — send the player back to the stage start next session. */
  resetCheckpoint(stageId) {
    return this.setCheckpoint(stageId, 0, true);
  },

  /** Mark cleared and fold in the time. Returns {rec, isBest, firstClear}. */
  clearStage(stageId, ms) {
    const rec = this.stage(stageId);
    const t = msOrNull(ms);
    const firstClear = !rec.cleared;
    rec.cleared = true;
    rec.clears++;
    rec.lastPlayed = Date.now();
    if (firstClear && !rec.firstClearDate) rec.firstClearDate = new Date().toISOString();
    let isBest = false;
    if (t !== null && (rec.best === null || t < rec.best)) { rec.best = t; isBest = true; }
    markDirty('clear', { stageId: rec.id, ms: t, isBest, firstClear, worldId: rec.world });
    this.flush();
    if (firstClear) emit('unlock', { worlds: this.unlockedWorlds() });
    return { rec, isBest, firstClear };
  },

  /** True when this coin was not already banked. */
  collectCoin(stageId, idx) {
    const rec = this.stage(stageId);
    const i = posInt(idx, -1);
    if (i < 0) return false;
    if (rec.coins.indexOf(i) !== -1) return false;
    rec.coins.push(i);
    rec.coins.sort((a, b) => a - b);
    markDirty('coin', { stageId: rec.id, idx: i, count: rec.coins.length });
    return true;
  },

  hasCoin(stageId, idx) {
    return this.stage(stageId).coins.indexOf(posInt(idx, -1)) !== -1;
  },

  /* --------------------------------------------------- playtime / streaks */
  /** Fold wall-clock play time into the global + per-stage counters. */
  addPlaytime(ms, stageId) {
    const t = num(ms, 0);
    if (!(t > 0) || t > 3600000) return;
    const d = ensure();
    d.totalPlaytimeMs += Math.round(t);
    if (stageId) {
      const rec = this.stage(stageId);
      rec.playMs += Math.round(t);
      rec.lastPlayed = Date.now();
    }
    markDirty('playtime', { totalPlaytimeMs: d.totalPlaytimeMs, stageId: stageId || null });
  },

  /** Longest stretch (ms) survived without dying — per stage and overall. */
  noteRunNoDeath(stageId, ms) {
    const t = num(ms, 0);
    if (!(t > 0)) return;
    const d = ensure();
    const v = Math.round(t);
    let changed = false;
    if (stageId) {
      const rec = this.stage(stageId);
      if (v > rec.longestRunNoDeathMs) { rec.longestRunNoDeathMs = v; changed = true; }
    }
    if (v > d.longestRunNoDeathMs) { d.longestRunNoDeathMs = v; changed = true; }
    if (changed) markDirty('streak', { stageId: stageId || null, ms: v });
  },

  totalPlaytimeMs() { return ensure().totalPlaytimeMs; },
  longestRunNoDeath() { return ensure().longestRunNoDeathMs; },

  /* ------------------------------------------------------------- worlds */
  /** Stages cleared in a world (uses the registered list when available). */
  worldProgress(worldId) {
    const listed = _worldStages[worldId];
    const total = (listed && listed.length) ? listed.length : DEFAULT_STAGES_PER_WORLD;
    const cleared = clearedCountIn(worldId);
    return { worldId, cleared, total, complete: cleared >= total, unlocked: this.isWorldUnlocked(worldId) };
  },

  worldCleared(worldId) {
    const listed = _worldStages[worldId];
    const total = (listed && listed.length) ? listed.length : DEFAULT_STAGES_PER_WORLD;
    return clearedCountIn(worldId) >= total;
  },

  /**
   * World 0 always unlocked; world N unlocks when world N-1 has >= 2 cleared.
   * The chain stops at the first locked world.
   */
  unlockedWorlds() {
    const d = ensure();
    if (d.unlockAll) return _worldOrder.slice();
    const out = [];
    for (let i = 0; i < _worldOrder.length; i++) {
      if (i === 0) { out.push(_worldOrder[i]); continue; }
      const prev = _worldOrder[i - 1];
      if (clearedCountIn(prev) >= UNLOCK_THRESHOLD || this.worldCleared(prev)) out.push(_worldOrder[i]);
      else break;
    }
    return out;
  },

  isWorldUnlocked(worldId) {
    if (!worldId || worldId === 'hub') return true;
    return this.unlockedWorlds().indexOf(worldId) !== -1;
  },

  /** How many more stage clears the previous world needs to open this one. */
  stagesUntilUnlock(worldId) {
    const i = _worldOrder.indexOf(worldId);
    if (i <= 0) return 0;
    const need = UNLOCK_THRESHOLD - clearedCountIn(_worldOrder[i - 1]);
    return need > 0 ? need : 0;
  },

  /** Dev/accessibility escape hatch. */
  unlockAll(on) {
    const d = ensure();
    d.unlockAll = on !== false;
    markDirty('unlock', { worlds: this.unlockedWorlds() });
    this.flush();
    return d.unlockAll;
  },

  /* ------------------------------------------------------------- totals */
  /**
   * {deaths, timeMs, coins, cleared} per contract, plus playtimeMs / bestSum /
   * stagesPlayed / worldsComplete for the results and stage-select screens.
   */
  totals() {
    const d = ensure();
    let deaths = 0, coins = 0, cleared = 0, bestSum = 0, played = 0, allBest = true;
    for (const id in d.stages) {
      if (!Object.prototype.hasOwnProperty.call(d.stages, id)) continue;
      const r = d.stages[id];
      deaths += r.deaths;
      coins += r.coins.length;
      played++;
      if (r.cleared) {
        cleared++;
        if (r.best !== null) bestSum += r.best; else allBest = false;
      }
    }
    let worldsComplete = 0;
    for (let i = 0; i < _worldOrder.length; i++) if (this.worldCleared(_worldOrder[i])) worldsComplete++;
    return {
      deaths,
      timeMs: bestSum,          // sum of best times over cleared stages
      coins,
      cleared,
      bestSum,
      allTimed: allBest,        // false if a cleared stage somehow has no time
      stagesPlayed: played,
      playtimeMs: d.totalPlaytimeMs,
      longestRunNoDeathMs: d.longestRunNoDeathMs,
      worldsComplete,
      worldsTotal: _worldOrder.length,
      sessions: d.sessions,
    };
  },

  /** Raw live object — for the dev overlay only. */
  raw() { return ensure(); },
};

export default Save;
