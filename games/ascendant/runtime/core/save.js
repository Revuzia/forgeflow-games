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
 * PROGRESSION RULE (the owner's words: "stage 2 is unlocked by stage 1, stage 3
 * is unlocked by stage 2 - per world. once unlocked, player accounts can access
 * any stage they unlocked"):
 *   - Stage 1 of a world is playable whenever that world is unlocked.
 *   - Stage N+1 unlocks when stage N is CLEARED (finish crossed). `cleared` is
 *     set only by clearStage(); reaching a checkpoint is NOT a clear.
 *   - Once unlocked a stage stays unlocked and can be re-entered directly.
 *   - World 1 is always open; world N unlocks when ALL stages of world N-1 are
 *     cleared. Nothing here is "2 out of 3" any more — the lock copy on screen
 *     has to be true of the rule actually enforced.
 *   - MIGRATION CLAUSE: a stage the player has already STARTED (an attempt, a
 *     death, a checkpoint, a time, an orb) stays unlocked even when the rule
 *     above would close it, so existing partial progress is never stranded.
 *   Stage ids follow the contract's `<worldId>-<n>` convention, so world
 *   membership is derived from the id — save.js imports nothing.
 *   Game may call `Save.registerWorlds(WORLDS)` at boot for the real stage lists.
 * ==========================================================================*/

const KEY = 'ascendant.save.v1';
const BAK_KEY = 'ascendant.save.v1.bak';
const SCHEMA_VERSION = 1;
const WRITE_DEBOUNCE_MS = 320;
const DEFAULT_STAGES_PER_WORLD = 3;

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
/*
 * Sanitisers that also REPORT. A field that is PRESENT but unusable is a
 * repair — the player is told once that their save was damaged and mended.
 * An ABSENT field is normal (older, leaner saves) and never counts.
 */
const MAX_REPAIRS = 24;
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
function note(repairs, where) { if (repairs.length < MAX_REPAIRS) repairs.push(where); }

/** non-negative integer, or `def` (+repair) when present but unusable */
function takeInt(raw, key, def, repairs, where) {
  if (!has(raw, key)) return def;
  const v = raw[key];
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return Math.floor(v);
  note(repairs, where + '.' + key);
  return def;
}

/** positive ms rounded, or null; null is a legal stored value (no clear yet) */
function takeMs(raw, key, repairs, where) {
  if (!has(raw, key)) return null;
  const v = raw[key];
  if (v === null) return null;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) return Math.round(v);
  note(repairs, where + '.' + key);
  return null;
}

function takeBool(raw, key, def, repairs, where) {
  if (!has(raw, key)) return def;
  const v = raw[key];
  if (typeof v === 'boolean') return v;
  note(repairs, where + '.' + key);
  return def;
}

function takeCoins(raw, repairs, where) {
  if (!has(raw, 'coins')) return [];
  const v = raw.coins;
  if (!Array.isArray(v)) { note(repairs, where + '.coins'); return []; }
  const out = uniqSortedInts(v, 512);
  for (let i = 0; i < v.length; i++) {
    const n = v[i];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 4095) { note(repairs, where + '.coins[' + i + ']'); break; }
  }
  return out;
}

/**
 * Accepts anything and returns a valid, fully sanitised save object plus the
 * list of fields that had to be repaired.
 * Unknown-future versions are preserved to the .bak slot and replaced with a
 * fresh save rather than being half-read into a broken state.
 */
function migrate(raw) {
  const repairs = [];
  if (!isObj(raw)) return { data: freshData(), replaced: true, repairs };

  const v = takeInt(raw, 'v', 0, repairs, 'save');

  if (v > SCHEMA_VERSION) {
    try { writeRaw(BAK_KEY, JSON.stringify(raw)); } catch (e) {}
    const d = freshData();
    d.migratedFromVersion = v;
    return { data: d, replaced: true, repairs };
  }

  const out = freshData();
  out.createdAt = takeInt(raw, 'createdAt', out.createdAt, repairs, 'save');
  out.updatedAt = takeInt(raw, 'updatedAt', out.updatedAt, repairs, 'save');
  out.sessions = takeInt(raw, 'sessions', 0, repairs, 'save');
  out.totalPlaytimeMs = takeInt(raw, 'totalPlaytimeMs', 0, repairs, 'save');
  out.longestRunNoDeathMs = takeInt(raw, 'longestRunNoDeathMs', 0, repairs, 'save');
  out.unlockAll = takeBool(raw, 'unlockAll', false, repairs, 'save');

  /* v0 (pre-versioning) stored the stage map at the root. */
  const stagesIsMap = isObj(raw.stages);
  if (has(raw, 'stages') && !stagesIsMap) note(repairs, 'save.stages');
  const srcStages = stagesIsMap ? raw.stages : (v === 0 ? raw : null);
  if (isObj(srcStages)) {
    for (const id in srcStages) {
      if (!has(srcStages, id)) continue;
      if (id === 'v' || id === 'stages' || id === 'createdAt' || id === 'updatedAt') continue;
      const s = srcStages[id];
      if (!isObj(s)) {
        /* In a real stage map every entry is a record; at a v0 root the other
           keys are ordinary top-level fields and are not corruption. */
        if (stagesIsMap) note(repairs, 'stages.' + id);
        continue;
      }
      const where = 'stages.' + id;
      const rec = freshStage(id);
      rec.best = takeMs(s, 'best', repairs, where);
      rec.deaths = takeInt(s, 'deaths', 0, repairs, where);
      rec.cleared = takeBool(s, 'cleared', false, repairs, where) || rec.best !== null;
      rec.coins = takeCoins(s, repairs, where);
      rec.cpIndex = takeInt(s, 'cpIndex', 0, repairs, where);
      rec.attempts = takeInt(s, 'attempts', 0, repairs, where);
      rec.clears = takeInt(s, 'clears', rec.cleared ? 1 : 0, repairs, where);
      rec.playMs = takeInt(s, 'playMs', 0, repairs, where);
      rec.lastPlayed = takeInt(s, 'lastPlayed', 0, repairs, where);
      rec.longestRunNoDeathMs = takeInt(s, 'longestRunNoDeathMs', 0, repairs, where);
      if (has(s, 'firstClearDate')) {
        const f = s.firstClearDate;
        if (f === null || (typeof f === 'string' && f.length <= 40)) rec.firstClearDate = f;
        else note(repairs, where + '.firstClearDate');
      }
      if (rec.cleared && !rec.firstClearDate) rec.firstClearDate = new Date(rec.lastPlayed || Date.now()).toISOString();
      if (has(s, 'world')) {
        if (typeof s.world === 'string' && s.world) rec.world = s.world;
        else note(repairs, where + '.world');
      }
      out.stages[id] = rec;
    }
  }

  out.v = SCHEMA_VERSION;
  return { data: out, replaced: false, repairs };
}

/* ============================================================ Save object */
let _data = null;
let _dirty = false;
let _writeTimer = 0;
let _unloadHooked = false;
/** Set by load() when this page load did NOT start from a clean, readable save. */
let _recovery = null;
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

/** Ordered stage ids for a world — the registered list when Game supplied one. */
function stagesOf(worldId) {
  const listed = _worldStages[worldId];
  return (listed && listed.length) ? listed : null;
}

/**
 * A stage the player has actually ENTERED: an attempt, a death, a checkpoint, a
 * recorded time, an orb, or a clear. Only the migration clause of the unlock
 * rule reads this — a started stage is never re-locked underneath a player.
 */
function startedRec(rec) {
  if (!rec) return false;
  return !!rec.cleared || rec.best !== null || (rec.attempts | 0) > 0 ||
    (rec.deaths | 0) > 0 || (rec.cpIndex | 0) > 0 ||
    (Array.isArray(rec.coins) && rec.coins.length > 0) || (rec.playMs | 0) > 0;
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

  /**
   * true when this page load did not start from a clean, readable save:
   * the stored payload was unparseable, not an object, from a newer schema,
   * or had fields that were present but unusable and got reset.
   * A brand-new player (no stored payload at all) is NOT a recovery.
   */
  get recovered() { return _recovery !== null; },

  /**
   * Detail for the one-time notice / a bug report, or null.
   * {kind:'unreadable'|'not-an-object'|'newer-version'|'repaired',
   *  repairs:string[], fromVersion:number|null, backedUp:boolean, at:number}
   */
  get recovery() { return _recovery; },

  /* ---------------------------------------------------- load / reset / io */

  /**
   * Read + migrate from storage. IDEMPOTENT: the first call reads storage,
   * every later call returns the live object. boot.js and Game.boot() both
   * call this, and re-reading counted every page load as two sessions
   * (sessions=2 on a first run). Pass {force:true} to re-read on purpose.
   */
  load(opts) {
    if (_data && !(opts && opts.force === true)) return _data;

    let raw = null;
    try { raw = readRaw(KEY); } catch (e) { raw = null; }
    const present = typeof raw === 'string';
    let parsed = null;
    let unreadable = false;
    if (present) {
      try { parsed = JSON.parse(raw); } catch (e) { unreadable = true; parsed = null; }
    }

    const res = migrate(parsed);

    let kind = null;
    if (present) {
      if (unreadable) kind = 'unreadable';
      else if (!isObj(parsed)) kind = 'not-an-object';
      else if (res.data.migratedFromVersion) kind = 'newer-version';
      else if (res.repairs.length) kind = 'repaired';
    }
    /* Keep the damaged text around for a bug report (a newer-version payload
       was already copied to the .bak slot inside migrate). */
    if (kind && kind !== 'newer-version') { try { writeRaw(BAK_KEY, raw); } catch (e) {} }

    _data = res.data;
    _data.sessions = posInt(_data.sessions, 0) + 1;
    _recovery = kind ? {
      kind,
      repairs: res.repairs.slice(),
      fromVersion: res.data.migratedFromVersion || null,
      backedUp: true,
      at: Date.now(),
    } : null;

    /* A replaced OR repaired save is written promptly, so the next load is
       clean and the recovery notice is shown exactly once. */
    if (kind || res.replaced || !parsed) markDirty(null);
    else { _dirty = true; hookUnload(); }
    emit('load', { replaced: res.replaced, recovered: kind !== null, recovery: _recovery });
    return _data;
  },

  /** Re-read storage on purpose (tooling / a "reload save" button). */
  reload() { return this.load({ force: true }); },

  /** Wipe everything back to a brand-new save. */
  reset() {
    const old = _data;
    if (old) { try { writeRaw(BAK_KEY, JSON.stringify(old)); } catch (e) {} }
    _data = freshData();
    _data.sessions = 1;
    _recovery = null;
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
    _recovery = null;
    _dirty = true;
    this.flush();
    emit('import', { replaced: res.replaced, repairs: res.repairs.slice() });
    return true;
  },

  /* ------------------------------------------------- cloud sync (portal) */
  /**
   * The subset of the save that is worth syncing to a signed-in ForgeFlow
   * account: STAGE PROGRESS ONLY. Deliberately excludes `cpIndex` — a waypoint
   * inside a stage is not save state and must never travel between devices.
   *
   * @returns {{v:number, at:number, unlockAll:boolean, stages:object}}
   */
  exportProgress() {
    const d = ensure();
    const stages = Object.create(null);
    /* Only real stages travel to the account row. The hub picks up a record as
       soon as it is loaded and is never "cleared" — it is not progress. */
    const known = Object.create(null);
    for (let i = 0; i < _worldOrder.length; i++) {
      const list = stagesOf(_worldOrder[i]);
      if (list) for (let j = 0; j < list.length; j++) known[list[j]] = true;
    }
    const filtering = Object.keys(known).length > 0;
    for (const id in d.stages) {
      if (!Object.prototype.hasOwnProperty.call(d.stages, id)) continue;
      if (filtering && !known[id]) continue;
      const r = d.stages[id];
      stages[id] = {
        cleared: !!r.cleared,
        best: r.best,
        deaths: r.deaths | 0,
        coins: r.coins.slice(),
        attempts: r.attempts | 0,
        clears: r.clears | 0,
        playMs: r.playMs | 0,
        firstClearDate: r.firstClearDate || null,
      };
    }
    return { v: SCHEMA_VERSION, at: Date.now(), unlockAll: !!d.unlockAll, stages };
  },

  /**
   * Fold a cloud record INTO the local save. Strictly additive — every field
   * moves one way only:
   *   cleared  OR      best    min      coins   union
   *   deaths   max     attempts/clears/playMs  max
   *   firstClearDate   earliest          unlockAll  OR
   * `cpIndex` is ignored on purpose. An empty, missing or malformed record is a
   * no-op: a cloud that knows nothing can never take progress away.
   *
   * @returns {{changed:boolean, stages:number}} what actually moved
   */
  mergeProgress(remote) {
    if (!isObj(remote)) return { changed: false, stages: 0 };
    const src = isObj(remote.stages) ? remote.stages : null;
    const d = ensure();
    let changed = false;
    let touched = 0;

    if (remote.unlockAll === true && !d.unlockAll) { d.unlockAll = true; changed = true; }

    if (src) {
      for (const id in src) {
        if (!Object.prototype.hasOwnProperty.call(src, id)) continue;
        const rs = src[id];
        if (!isObj(rs)) continue;
        const rec = this.stage(id);
        let hit = false;

        if (rs.cleared === true && !rec.cleared) { rec.cleared = true; hit = true; }
        const rb = msOrNull(rs.best);
        if (rb !== null && (rec.best === null || rb < rec.best)) { rec.best = rb; hit = true; }
        const rd = posInt(rs.deaths, 0);
        if (rd > rec.deaths) { rec.deaths = rd; hit = true; }
        const ra = posInt(rs.attempts, 0);
        if (ra > rec.attempts) { rec.attempts = ra; hit = true; }
        const rc = posInt(rs.clears, 0);
        if (rc > rec.clears) { rec.clears = rc; hit = true; }
        const rp = posInt(rs.playMs, 0);
        if (rp > rec.playMs) { rec.playMs = rp; hit = true; }
        if (Array.isArray(rs.coins)) {
          const before = rec.coins.length;
          const union = uniqSortedInts(rec.coins.concat(uniqSortedInts(rs.coins, 512)), 512);
          if (union.length !== before) { rec.coins = union; hit = true; }
        }
        if (typeof rs.firstClearDate === 'string' && rs.firstClearDate.length <= 40) {
          if (!rec.firstClearDate || rs.firstClearDate < rec.firstClearDate) {
            rec.firstClearDate = rs.firstClearDate; hit = true;
          }
        }
        if (rec.cleared && !rec.firstClearDate) rec.firstClearDate = new Date().toISOString();
        if (hit) { touched++; changed = true; }
      }
    }

    if (changed) { markDirty('merge', { stages: touched }); this.flush(); }
    return { changed, stages: touched };
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
   * World 1 always unlocked; world N unlocks when ALL stages of world N-1 are
   * cleared. The chain stops at the first locked world. A world that holds a
   * STARTED stage also stays open (migration clause) so partial progress made
   * under the old, looser rule is never stranded behind a lock.
   */
  unlockedWorlds() {
    const d = ensure();
    if (d.unlockAll) return _worldOrder.slice();
    const out = [];
    let chainOpen = true;
    for (let i = 0; i < _worldOrder.length; i++) {
      const id = _worldOrder[i];
      if (i === 0) { out.push(id); continue; }
      if (chainOpen && this.worldCleared(_worldOrder[i - 1])) { out.push(id); continue; }
      chainOpen = false;
      if (this.worldStarted(id)) out.push(id);   // already played — never re-lock
    }
    return out;
  },

  /** True when any stage of this world has been entered. */
  worldStarted(worldId) {
    const d = ensure();
    const listed = stagesOf(worldId);
    if (listed) {
      for (let i = 0; i < listed.length; i++) if (startedRec(d.stages[listed[i]])) return true;
      return false;
    }
    const prefix = worldId + '-';
    for (const id in d.stages) {
      if (!Object.prototype.hasOwnProperty.call(d.stages, id)) continue;
      if (id.indexOf(prefix) === 0 && startedRec(d.stages[id])) return true;
    }
    return false;
  },

  isWorldUnlocked(worldId) {
    if (!worldId || worldId === 'hub') return true;
    return this.unlockedWorlds().indexOf(worldId) !== -1;
  },

  /** How many more stage clears the previous world needs to open this one. */
  stagesUntilUnlock(worldId) {
    const i = _worldOrder.indexOf(worldId);
    if (i <= 0) return 0;
    const prev = _worldOrder[i - 1];
    const listed = stagesOf(prev);
    const total = listed ? listed.length : DEFAULT_STAGES_PER_WORLD;
    const need = total - clearedCountIn(prev);
    return need > 0 ? need : 0;
  },

  /* ------------------------------------------------------ stage unlocking */
  /** True when this stage has been entered at least once. */
  stageStarted(stageId) { return startedRec(ensure().stages[String(stageId)]); },

  /**
   * Is this stage enterable? World unlocked AND (it is the world's first stage,
   * OR the stage before it in the same world is CLEARED, OR the player has
   * already started it). `unlockAll` opens everything.
   */
  isStageUnlocked(stageId) {
    const id = String(stageId);
    if (!id || id === 'hub') return true;
    const d = ensure();
    if (d.unlockAll) return true;
    if (startedRec(d.stages[id])) return true;          // migration clause
    const wid = worldOf(id);
    if (!this.isWorldUnlocked(wid)) return false;
    const listed = stagesOf(wid);
    if (!listed) return true;                            // no world list -> no stage gating
    const i = listed.indexOf(id);
    if (i <= 0) return true;                             // unknown, or first of world
    const prevRec = d.stages[listed[i - 1]];
    return !!(prevRec && prevRec.cleared);
  },

  /**
   * Why this stage is locked, as a sentence that is TRUE of the rule above.
   * '' when the stage is open. `nameOf` maps a stage/world id to a display
   * name (stage select passes one in); ids are used when it is absent.
   */
  stageLockReason(stageId, nameOf) {
    const id = String(stageId);
    if (this.isStageUnlocked(id)) return '';
    const name = (v) => {
      let n = null;
      try { n = typeof nameOf === 'function' ? nameOf(v) : null; } catch (e) { n = null; }
      return String(n || v).toUpperCase();
    };
    const wid = worldOf(id);
    if (!this.isWorldUnlocked(wid)) {
      const wi = _worldOrder.indexOf(wid);
      const prevW = wi > 0 ? _worldOrder[wi - 1] : null;
      if (!prevW) return 'LOCKED';
      const need = this.stagesUntilUnlock(wid);
      return 'CLEAR ALL ' + (stagesOf(prevW) || { length: DEFAULT_STAGES_PER_WORLD }).length +
        ' STAGES OF ' + name(prevW) + ' TO UNLOCK  ·  ' + need + ' TO GO';
    }
    const listed = stagesOf(wid);
    const i = listed ? listed.indexOf(id) : -1;
    if (i > 0) return 'CLEAR ' + name(listed[i - 1]) + ' TO UNLOCK';
    return 'LOCKED';
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
