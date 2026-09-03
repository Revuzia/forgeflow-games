/* ============================================================================
 * CRESTBOUND — runtime/core/save.js
 * Contract §3.  Versioned, migration-guarded, fail-soft persistence.
 *
 * Storage key: 'crestbound.save.v1'   (backup on a rejected migration: '….bak')
 *
 * SCHEMA (v1)
 *   {
 *     v, createdAt, updatedAt, sessions, totalPlaytimeMs, unlockAll,
 *     courses: {
 *       [courseId]: { id, crests:[crestId…], coinsBest, cleared, deaths,
 *                     bestMs:{[crestId]:ms}, clears, playMs, lastPlayed,
 *                     firstClearDate }
 *     },
 *     flags: { [key]: bool|number|string }      // misc: seenIntro, keepDoorOpen…
 *   }
 *
 * What is NOT persisted, on purpose: the checkpoint index. A Crest course is an
 * open diorama the player re-enters from its painting; "resume at the last
 * flag" only means anything inside one sitting. `checkpoint()` /
 * `setCheckpoint()` therefore live in a session-only map (per contract §3)
 * that a page reload clears.
 *
 * Progression rule: Keep gates unlock on the TOTAL crest count (a gate's
 * `requires.crests`), never on per-course clears — collecting anything anywhere
 * always moves the player forward. `unlockAll` is the dev/accessibility escape.
 *
 * Every localStorage touch is wrapped: in private mode / a sandboxed iframe the
 * whole API keeps working against an in-memory store for the session, and
 * `Save.persistent` reports false so the UI can say so.
 *
 * Ported from Ascendant's save.js: the load/repair/backup pattern (`recovered`
 * / `recovery`) is unchanged — a present-but-unusable field is repaired and
 * reported once; an absent field is a normal lean save.
 * ==========================================================================*/

const KEY = 'crestbound.save.v1';
const BAK_KEY = 'crestbound.save.v1.bak';
const SCHEMA_VERSION = 1;
const WRITE_DEBOUNCE_MS = 320;

/** Per-course caps: a Crest course has 7 crests; anything beyond this is junk. */
const MAX_CRESTS_PER_COURSE = 32;
const MAX_CREST_ID_LEN = 40;
const MAX_COURSE_ID_LEN = 48;
const MAX_FLAG_KEY_LEN = 48;
const MAX_FLAG_STR_LEN = 200;
const MAX_FLAGS = 128;
const MAX_COURSES = 256;

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

function idOk(v, maxLen) {
  return typeof v === 'string' && v.length > 0 && v.length <= maxLen;
}

function freshCourse(courseId) {
  return {
    id: courseId,
    crests: [],              // collected crest ids, in collection order
    coinsBest: 0,            // most coins banked in one visit
    cleared: false,          // first crest of the course marks it cleared
    deaths: 0,
    bestMs: Object.create(null),   // crestId -> fastest time to that crest
    clears: 0,               // crest pick-ups counted as "course clears"
    playMs: 0,
    lastPlayed: 0,           // epoch ms
    firstClearDate: null,    // ISO string
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
    unlockAll: false,
    courses: Object.create(null),
    flags: Object.create(null),
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
      const probe = '__cb_probe__';
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

function takeBool(raw, key, def, repairs, where) {
  if (!has(raw, key)) return def;
  const v = raw[key];
  if (typeof v === 'boolean') return v;
  note(repairs, where + '.' + key);
  return def;
}

/** crest id list: unique strings, capped */
function takeCrests(raw, repairs, where) {
  if (!has(raw, 'crests')) return [];
  const v = raw.crests;
  if (!Array.isArray(v)) { note(repairs, where + '.crests'); return []; }
  const out = [];
  let noted = false;
  for (let i = 0; i < v.length; i++) {
    const id = v[i];
    if (!idOk(id, MAX_CREST_ID_LEN)) { if (!noted) { note(repairs, where + '.crests[' + i + ']'); noted = true; } continue; }
    if (out.indexOf(id) === -1) out.push(id);
    if (out.length >= MAX_CRESTS_PER_COURSE) break;
  }
  return out;
}

/** crestId -> positive ms map */
function takeBestMs(raw, repairs, where) {
  const out = Object.create(null);
  if (!has(raw, 'bestMs')) return out;
  const v = raw.bestMs;
  if (!isObj(v)) { note(repairs, where + '.bestMs'); return out; }
  let n = 0;
  for (const k in v) {
    if (!has(v, k)) continue;
    if (!idOk(k, MAX_CREST_ID_LEN)) { note(repairs, where + '.bestMs.' + String(k).slice(0, 12)); continue; }
    const ms = msOrNull(v[k]);
    if (ms === null) { note(repairs, where + '.bestMs.' + k); continue; }
    out[k] = ms;
    if (++n >= MAX_CRESTS_PER_COURSE) break;
  }
  return out;
}

function flagValueOk(v) {
  if (typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= MAX_FLAG_STR_LEN;
  return false;
}

function takeFlags(raw, repairs) {
  const out = Object.create(null);
  if (!has(raw, 'flags')) return out;
  const v = raw.flags;
  if (!isObj(v)) { note(repairs, 'save.flags'); return out; }
  let n = 0;
  for (const k in v) {
    if (!has(v, k)) continue;
    if (!idOk(k, MAX_FLAG_KEY_LEN) || !flagValueOk(v[k])) { note(repairs, 'flags.' + String(k).slice(0, 16)); continue; }
    out[k] = v[k];
    if (++n >= MAX_FLAGS) break;
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
  out.unlockAll = takeBool(raw, 'unlockAll', false, repairs, 'save');
  out.flags = takeFlags(raw, repairs);

  const coursesIsMap = isObj(raw.courses);
  if (has(raw, 'courses') && !coursesIsMap) note(repairs, 'save.courses');
  if (coursesIsMap) {
    let n = 0;
    for (const id in raw.courses) {
      if (!has(raw.courses, id)) continue;
      const s = raw.courses[id];
      const where = 'courses.' + String(id).slice(0, 24);
      if (!idOk(id, MAX_COURSE_ID_LEN) || !isObj(s)) { note(repairs, where); continue; }
      const rec = freshCourse(id);
      rec.crests = takeCrests(s, repairs, where);
      rec.coinsBest = takeInt(s, 'coinsBest', 0, repairs, where);
      rec.deaths = takeInt(s, 'deaths', 0, repairs, where);
      rec.bestMs = takeBestMs(s, repairs, where);
      rec.cleared = takeBool(s, 'cleared', false, repairs, where) || rec.crests.length > 0;
      rec.clears = takeInt(s, 'clears', rec.crests.length, repairs, where);
      rec.playMs = takeInt(s, 'playMs', 0, repairs, where);
      rec.lastPlayed = takeInt(s, 'lastPlayed', 0, repairs, where);
      if (has(s, 'firstClearDate')) {
        const f = s.firstClearDate;
        if (f === null || (typeof f === 'string' && f.length <= 40)) rec.firstClearDate = f;
        else note(repairs, where + '.firstClearDate');
      }
      if (rec.cleared && !rec.firstClearDate) rec.firstClearDate = new Date(rec.lastPlayed || Date.now()).toISOString();
      out.courses[id] = rec;
      if (++n >= MAX_COURSES) break;
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

/** Session-only checkpoint memory: courseId -> index. Never written to storage. */
const _sessionCp = Object.create(null);

function ensure() {
  if (_data) return _data;
  Save.load();
  return _data;
}

/**
 * The record every READ of an unplayed course gets: a shared, empty one that is
 * NOT stored. Reading a save must never write to it — `_refreshGateState()`
 * looks up all 13 gates the moment the Keep loads, and when `course()` minted a
 * record per lookup a player who had never pressed a button owned 13 "played"
 * courses, so `totals().coursesPlayed` was 13, `_hasProgress()` was true, the
 * title screen led with CONTINUE and NEW GAME asked to erase progress that did
 * not exist. One object, reused: a per-read copy would allocate inside the
 * frame loop (`_refreshCrestGot`).
 */
const BLANK_COURSE = freshCourse('');

/** Live record for WRITING — created and stored on demand. Writers only. */
function ensureCourse(courseId) {
  const d = ensure();
  const id = String(courseId);
  let rec = d.courses[id];
  if (!rec) { rec = freshCourse(id); d.courses[id] = rec; }
  return rec;
}

/** True when a record holds anything a player actually did. */
function courseTouched(r) {
  return !!r && (r.crests.length > 0 || r.deaths > 0 || r.coinsBest > 0 || r.clears > 0 ||
                 r.playMs > 0 || r.cleared === true || r.lastPlayed > 0);
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
  try {
    window.addEventListener('pagehide', flush, false);
    window.addEventListener('beforeunload', flush, false);
    if (typeof document !== 'undefined' && document && document.addEventListener) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
      }, false);
    }
  } catch (e) { /* headless shim without listeners */ }
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

function gateRequirement(gate) {
  if (!isObj(gate)) return 0;
  const req = gate.requires;
  if (isObj(req)) return posInt(req.crests, 0);
  if (typeof req === 'number') return posInt(req, 0);   // tolerate `requires: 12`
  return 0;
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
   * every later call returns the live object (boot.js and Game.boot() both
   * call this; re-reading would count every page load as two sessions).
   * Pass {force:true} to re-read on purpose.
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

  /** Wipe everything back to a brand-new save (session checkpoints too). */
  reset() {
    const old = _data;
    if (old) { try { writeRaw(BAK_KEY, JSON.stringify(old)); } catch (e) {} }
    _data = freshData();
    _data.sessions = 1;
    _recovery = null;
    _dirty = true;
    for (const k in _sessionCp) delete _sessionCp[k];
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

  /** Remove the persisted blob AND the backup (the "erase everything" flow). */
  purge() {
    removeRaw(KEY);
    removeRaw(BAK_KEY);
    this.reset();
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

  /* ------------------------------------------------------ change events */
  /**
   * Subscribe to save events. Handler receives one object with `type` in:
   * load reset import crest coinsBest death bestMs playtime flag unlock
   * checkpoint clear.
   */
  on(fn) { if (typeof fn === 'function' && _subs.indexOf(fn) === -1) _subs.push(fn); return this; },
  off(fn) { const i = _subs.indexOf(fn); if (i !== -1) _subs.splice(i, 1); return this; },

  /* -------------------------------------------------------- course record */
  /**
   * Per-course record. Contract shape {crests, coinsBest, cleared, deaths,
   * bestMs} plus clears / playMs / lastPlayed / firstClearDate.
   *
   * READ-ONLY, and NON-MUTATING: a course with no record yet returns the shared
   * empty record and NOTHING is stored, so merely rendering a menu or resolving
   * the Keep's gates can no longer invent progress. Mutate through the methods
   * (collectCrest / setCoinsBest / addDeath / setBestMs) — they create the real
   * record, schedule the write and fire the event.
   */
  course(courseId) {
    const d = ensure();
    const rec = d.courses[String(courseId)];
    return rec || BLANK_COURSE;
  },

  /** Has this course ever been recorded (as opposed to merely looked at)? */
  courseKnown(courseId) {
    const d = ensure();
    return has(d.courses, String(courseId));
  },

  /** Detached copy, safe to hand to UI code that mutates. */
  courseCopy(courseId) {
    const r = this.course(courseId);
    const best = {};
    for (const k in r.bestMs) best[k] = r.bestMs[k];
    return {
      id: r.id, crests: r.crests.slice(), coinsBest: r.coinsBest, cleared: r.cleared,
      deaths: r.deaths, bestMs: best, clears: r.clears, playMs: r.playMs,
      lastPlayed: r.lastPlayed, firstClearDate: r.firstClearDate,
    };
  },

  /** Every course id that has a record, sorted. */
  courseIds() {
    const d = ensure();
    const out = [];
    for (const id in d.courses) if (has(d.courses, id)) out.push(id);
    out.sort();
    return out;
  },

  /** @returns {boolean} whether this crest has been collected */
  hasCrest(courseId, crestId) {
    return this.course(courseId).crests.indexOf(String(crestId)) !== -1;
  },

  /**
   * Bank a crest. Returns true when it was NEW (the first crest of a course
   * also marks it cleared — contract §22). Flushes synchronously: a crest is
   * the one thing a player must never lose to a closed tab.
   * @returns {boolean}
   */
  collectCrest(courseId, crestId) {
    const rec = ensureCourse(courseId);
    const id = String(crestId);
    if (!idOk(id, MAX_CREST_ID_LEN)) return false;
    if (rec.crests.indexOf(id) !== -1) return false;
    if (rec.crests.length >= MAX_CRESTS_PER_COURSE) return false;
    rec.crests.push(id);
    rec.clears++;
    rec.lastPlayed = Date.now();
    const firstClear = !rec.cleared;
    if (firstClear) {
      rec.cleared = true;
      if (!rec.firstClearDate) rec.firstClearDate = new Date().toISOString();
    }
    const total = this.crestTotal();
    markDirty('crest', { courseId: rec.id, crestId: id, count: rec.crests.length, total, firstClear });
    this.flush();
    if (firstClear) emit('clear', { courseId: rec.id, crestId: id });
    emit('unlock', { total });
    return true;
  },

  /** Raise (never lower) the coins-in-one-visit record. Returns the record value. */
  setCoinsBest(courseId, n) {
    const rec = ensureCourse(courseId);
    const v = posInt(n, 0);
    if (v <= rec.coinsBest) return rec.coinsBest;
    rec.coinsBest = v;
    rec.lastPlayed = Date.now();
    markDirty('coinsBest', { courseId: rec.id, coinsBest: v });
    return rec.coinsBest;
  },

  addDeath(courseId) {
    const rec = ensureCourse(courseId);
    rec.deaths++;
    rec.lastPlayed = Date.now();
    markDirty('death', { courseId: rec.id, deaths: rec.deaths });
    return rec.deaths;
  },

  /**
   * Record the time taken to reach a crest; kept only when faster than the
   * stored best. Returns true on a new best.
   * @returns {boolean}
   */
  setBestMs(courseId, crestId, ms) {
    const rec = ensureCourse(courseId);
    const id = String(crestId);
    if (!idOk(id, MAX_CREST_ID_LEN)) return false;
    const t = msOrNull(ms);
    if (t === null) return false;
    const prev = has(rec.bestMs, id) ? rec.bestMs[id] : null;
    if (prev !== null && t >= prev) return false;
    rec.bestMs[id] = t;
    rec.lastPlayed = Date.now();
    markDirty('bestMs', { courseId: rec.id, crestId: id, ms: t, prev });
    this.flush();
    return true;
  },

  /** Best time for one crest, or null. */
  bestMs(courseId, crestId) {
    const rec = this.course(courseId);
    const id = String(crestId);
    return has(rec.bestMs, id) ? rec.bestMs[id] : null;
  },

  /* ----------------------------------------------------------- progression */
  /** Total crests collected across every course — the unlock currency. */
  crestTotal() {
    const d = ensure();
    let n = 0;
    for (const id in d.courses) if (has(d.courses, id)) n += d.courses[id].crests.length;
    return n;
  },

  /**
   * Indices into `keepDef.gates` that are open for this save: a gate opens
   * when `gate.requires.crests` (missing = 0) is <= crestTotal(), or when
   * `unlockAll` is on. Order matches the gates array.
   * @param {{gates?:Array}} keepDef
   * @returns {number[]}
   */
  unlockedGates(keepDef) {
    const gates = keepDef && Array.isArray(keepDef.gates) ? keepDef.gates
      : (Array.isArray(keepDef) ? keepDef : null);
    const out = [];
    if (!gates) return out;
    const d = ensure();
    const total = this.crestTotal();
    for (let i = 0; i < gates.length; i++) {
      if (d.unlockAll || gateRequirement(gates[i]) <= total) out.push(i);
    }
    return out;
  },

  /** @returns {boolean} whether one gate is open */
  isGateUnlocked(gate) {
    const d = ensure();
    return d.unlockAll || gateRequirement(gate) <= this.crestTotal();
  },

  /** Crests still needed before a gate opens (0 when open). */
  crestsUntil(gate) {
    const d = ensure();
    if (d.unlockAll) return 0;
    const need = gateRequirement(gate) - this.crestTotal();
    return need > 0 ? need : 0;
  },

  /** Dev/accessibility escape hatch. */
  unlockAll(on) {
    const d = ensure();
    d.unlockAll = on !== false;
    markDirty('unlock', { total: this.crestTotal(), unlockAll: d.unlockAll });
    this.flush();
    return d.unlockAll;
  },

  /* ------------------------------------------------------------- totals */
  /**
   * {crests, deaths, timeMs, coins, coursesCleared} per contract, plus
   * coursesPlayed / bestSumMs / sessions for the results and keep screens.
   * `timeMs` is total play time; `bestSumMs` is the sum of every recorded
   * crest best time.
   */
  totals() {
    const d = ensure();
    let crests = 0, deaths = 0, coins = 0, cleared = 0, played = 0, bestSum = 0;
    for (const id in d.courses) {
      if (!has(d.courses, id)) continue;
      const r = d.courses[id];
      crests += r.crests.length;
      deaths += r.deaths;
      coins += r.coinsBest;
      /* Only a record with real activity counts as PLAYED. A record that exists
         because something read it (an older save written before course() stopped
         minting on read) must never make a virgin profile look like a saved game. */
      if (courseTouched(r)) played++;
      if (r.cleared) cleared++;
      for (const k in r.bestMs) bestSum += r.bestMs[k];
    }
    return {
      crests,
      deaths,
      timeMs: d.totalPlaytimeMs,
      coins,
      coursesCleared: cleared,
      coursesPlayed: played,
      bestSumMs: bestSum,
      sessions: d.sessions,
    };
  },

  /* --------------------------------------------------------- playtime */
  /** Fold wall-clock play time into the global + per-course counters. */
  addPlaytime(ms, courseId) {
    const t = num(ms, 0);
    if (!(t > 0) || t > 3600000) return;
    const d = ensure();
    d.totalPlaytimeMs += Math.round(t);
    if (courseId) {
      const rec = ensureCourse(courseId);
      rec.playMs += Math.round(t);
      rec.lastPlayed = Date.now();
    }
    markDirty('playtime', { totalPlaytimeMs: d.totalPlaytimeMs, courseId: courseId || null });
  },

  totalPlaytimeMs() { return ensure().totalPlaytimeMs; },

  /* --------------------------------------------- session-only checkpoints */
  /**
   * Last checkpoint touched in this course during THIS session, or null.
   * Never persisted: a reload starts every course at its spawn.
   * @returns {number|null}
   */
  checkpoint(courseId) {
    const id = String(courseId);
    return has(_sessionCp, id) ? _sessionCp[id] : null;
  },

  /** Remember the last checkpoint touched (session only). Returns the index. */
  setCheckpoint(courseId, idx) {
    const id = String(courseId);
    const i = posInt(idx, 0);
    if (_sessionCp[id] === i) return i;
    _sessionCp[id] = i;
    emit('checkpoint', { courseId: id, cpIndex: i });
    return i;
  },

  /** Forget the session checkpoint for a course (full restart). */
  clearCheckpoint(courseId) {
    const id = String(courseId);
    if (has(_sessionCp, id)) {
      delete _sessionCp[id];
      emit('checkpoint', { courseId: id, cpIndex: null });
    }
  },

  /* --------------------------------------------------------------- flags */
  /**
   * Misc persisted flags (seenIntro, keepDoorOpen, fenLine…). Values are
   * bool | finite number | string ≤ 200 chars; anything else is refused.
   */
  flags: {
    get(k, def) {
      const d = ensure();
      const key = String(k);
      return has(d.flags, key) ? d.flags[key] : def;
    },
    set(k, v) {
      const d = ensure();
      const key = String(k);
      if (!idOk(key, MAX_FLAG_KEY_LEN) || !flagValueOk(v)) return false;
      if (has(d.flags, key) && d.flags[key] === v) return true;
      if (!has(d.flags, key) && Object.keys(d.flags).length >= MAX_FLAGS) return false;
      d.flags[key] = v;
      markDirty('flag', { key, value: v });
      return true;
    },
    has(k) {
      return has(ensure().flags, String(k));
    },
    remove(k) {
      const d = ensure();
      const key = String(k);
      if (!has(d.flags, key)) return false;
      delete d.flags[key];
      markDirty('flag', { key, value: undefined });
      return true;
    },
  },

  /** Raw live object — for the dev overlay only. */
  raw() { return ensure(); },
};

export default Save;
