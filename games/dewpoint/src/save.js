// DEWPOINT save data. This module is the ONLY code that touches localStorage.
//
// Published shape (key `dewpoint.save.v1` - never rename, never change a field's meaning):
//   { v:1,
//     levels:{ [id]:{ done:boolean, shards:number[], bestMs:number } },
//     last:string,
//     settings:{ music:number, sfx:number, muted:boolean, quality:'auto'|'low'|'high',
//                invertY:boolean, sensitivity:number, reducedMotion:boolean } }
// Added with the three elements (DESIGN-ELEMENTS.md "Save"; both OPTIONAL, absent until needed):
//     element: 'water'|'fire'|'clay'              the element last chosen on the title screen
//     lastBy:  { water?:id, fire?:id, clay?:id }  the last level played in each campaign
// `levels` holds every element's results under the level ids (l01.., f01.., c01..), and `last`
// keeps its meaning: the last level played, whatever its element. A save written before these
// fields existed loads with nothing lost (it simply has neither); junk in them is dropped.
//
// Everything read is sanitised field by field, so missing, partial, wrongly typed or corrupt
// data degrades to defaults instead of throwing, and a storage that throws (private mode,
// quota, disabled cookies) simply leaves the game running on an in-memory copy.
// Unknown fields written by a newer build are preserved on rewrite.
//
// Two tabs (or windows) on the same save: each write first re-reads what is stored and MERGES it in, so
// neither tab's progress is lost to the other's last write - per level: done = either, collectibles =
// both, best time = the lower; for the last level, element and each setting: the value THIS tab changed
// since it last synced wins, otherwise the stored one is taken. Another tab's writes are also merged in as
// they happen (the `storage` event, listen()). Resetting progress stamps the save with `resetAt` (an
// added, optional field), so a tab that still holds the old progress does not bring it back.

export const SAVE_KEY = 'dewpoint.save.v1';
export const SHARDS_PER_LEVEL = 3;
export const QUALITIES = ['auto', 'low', 'high'];

export const SAVE_ELEMENTS = ['water', 'fire', 'clay'];
export const DEFAULT_SAVE_ELEMENT = 'water';

const UNSAFE = new Set(['__proto__', 'constructor', 'prototype']);
const KNOWN = new Set(['v', 'levels', 'last', 'settings', 'element', 'lastBy', 'resetAt']);
const isElement = (v) => typeof v === 'string' && SAVE_ELEMENTS.includes(v);

export function defaultSettings() {
  return { music: 0.6, sfx: 0.8, muted: false, quality: 'auto', invertY: false, sensitivity: 1, reducedMotion: false };
}

export function defaults() {
  return { v: 1, levels: {}, last: '', settings: defaultSettings() };
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num01 = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d);

function cleanLevel(raw) {
  const out = isObj(raw) ? copyExtras(raw, ['done', 'shards', 'bestMs']) : {};
  const src = isObj(raw) ? raw : {};
  out.done = src.done === true;
  const seen = new Set();
  if (Array.isArray(src.shards)) {
    for (const s of src.shards) {
      if (Number.isInteger(s) && s >= 0 && s < SHARDS_PER_LEVEL) seen.add(s);
    }
  }
  out.shards = [...seen].sort((a, b) => a - b);
  out.bestMs = typeof src.bestMs === 'number' && Number.isFinite(src.bestMs) && src.bestMs > 0 ? Math.round(src.bestMs) : 0;
  return out;
}

function copyExtras(raw, known) {
  const out = {};
  for (const k of Object.keys(raw)) {
    if (known.includes(k) || UNSAFE.has(k)) continue;
    const v = raw[k];
    if (v === undefined || typeof v === 'function') continue;
    out[k] = v;
  }
  return out;
}

/** Turn anything at all into a valid save object. Never throws. */
export function sanitize(raw, settingDefaults) {
  const base = defaults();
  if (settingDefaults) Object.assign(base.settings, settingDefaults);
  if (!isObj(raw)) return base;
  const out = copyExtras(raw, ['v', 'levels', 'last', 'settings', 'element', 'lastBy']);
  out.v = 1;
  // the optional element fields: kept only when valid, otherwise left out altogether
  if (isElement(raw.element)) out.element = raw.element;
  if (isObj(raw.lastBy)) {
    const lb = {};
    for (const e of SAVE_ELEMENTS) {
      const id = raw.lastBy[e];
      if (typeof id === 'string' && id && id.length <= 64 && !UNSAFE.has(id)) lb[e] = id;
    }
    if (Object.keys(lb).length) out.lastBy = lb;
  }
  out.levels = {};
  if (isObj(raw.levels)) {
    for (const id of Object.keys(raw.levels)) {
      if (UNSAFE.has(id) || !id) continue;
      out.levels[id] = cleanLevel(raw.levels[id]);
    }
  }
  out.last = typeof raw.last === 'string' ? raw.last.slice(0, 64) : '';
  const s = isObj(raw.settings) ? raw.settings : {};
  const d = base.settings;
  out.settings = isObj(raw.settings) ? copyExtras(raw.settings, Object.keys(d)) : {};
  out.settings.music = num01(s.music, d.music);
  out.settings.sfx = num01(s.sfx, d.sfx);
  out.settings.muted = typeof s.muted === 'boolean' ? s.muted : d.muted;
  out.settings.quality = QUALITIES.includes(s.quality) ? s.quality : d.quality;
  out.settings.invertY = typeof s.invertY === 'boolean' ? s.invertY : d.invertY;
  out.settings.sensitivity = typeof s.sensitivity === 'number' && Number.isFinite(s.sensitivity)
    ? Math.min(3, Math.max(0.2, s.sensitivity)) : d.sensitivity;
  out.settings.reducedMotion = typeof s.reducedMotion === 'boolean' ? s.reducedMotion : d.reducedMotion;
  return out;
}

/**
 * Create a save store.
 * storage: optional Storage-like object ({getItem,setItem,removeItem}); when omitted the
 *          browser's own is looked up lazily (and may be absent or throw).
 * settingDefaults: optional overrides for first-run settings (e.g. reducedMotion from the OS).
 */
export function createSave(storage, settingDefaults) {
  const getStore = () => {
    if (storage !== undefined) return storage;
    try { return globalThis.localStorage || null; } catch (e) { return null; }
  };
  // what this tab has changed since it last synced with storage: 'last', 'lastBy', 'element', 'settings.<key>'
  const dirty = new Set();
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  /** What is in storage now, sanitized, or null (nothing, unreadable, junk). */
  const readStored = () => {
    try {
      const st = getStore(); if (!st) return null;
      const text = st.getItem(SAVE_KEY);
      if (typeof text !== 'string' || !text.length) return null;
      const raw = JSON.parse(text);
      return isObj(raw) ? sanitize(raw, settingDefaults) : null;
    } catch (e) { return null; }
  };
  /** Merge a stored copy into this tab's data (see the header). */
  const mergeFrom = (other) => {
    if (!other) return;
    const d = api.data, mine = num(d.resetAt), theirs = num(other.resetAt);
    const resetThere = theirs > mine;
    if (resetThere) { d.levels = {}; d.resetAt = theirs; }           // reset elsewhere after this tab's progress: it is gone
    if (!(mine > theirs)) {                                            // (their levels predate a reset made here: leave them out)
      for (const id of Object.keys(other.levels)) {
        const a = d.levels[id] ? cleanLevel(d.levels[id]) : null, b = other.levels[id];
        if (!a) { d.levels[id] = cleanLevel(b); continue; }
        a.done = a.done || b.done;
        a.shards = [...new Set([...a.shards, ...b.shards])].sort((x, y) => x - y);
        if (b.bestMs > 0 && (a.bestMs === 0 || b.bestMs < a.bestMs)) a.bestMs = b.bestMs;
        d.levels[id] = a;
      }
    }
    for (const f of ['last', 'element']) {
      if (dirty.has(f)) continue;
      if (Object.prototype.hasOwnProperty.call(other, f)) d[f] = other[f]; else if (f !== 'last') delete d[f];
    }
    // the last level of each campaign: each one separately (this tab's change to one campaign does not hide the other tab's to another)
    const lb = {}, order = [...new Set([...Object.keys(isObj(d.lastBy) ? d.lastBy : {}), ...Object.keys(isObj(other.lastBy) ? other.lastBy : {})])];
    for (const e of order) {
      if (!SAVE_ELEMENTS.includes(e)) continue;
      const m = isObj(d.lastBy) ? d.lastBy[e] : undefined, o = isObj(other.lastBy) ? other.lastBy[e] : undefined;
      let v;
      if (dirty.has('lastBy.' + e)) v = m;                       // this tab chose it
      else if (dirty.has('reset')) v = undefined;                 // this tab reset progress: the stored choices went with it
      else v = o !== undefined ? o : (resetThere ? undefined : m);
      if (typeof v === 'string' && v) lb[e] = v;
    }
    if (Object.keys(lb).length) d.lastBy = lb; else delete d.lastBy;
    for (const k of Object.keys(other.settings)) if (!dirty.has('settings.' + k)) d.settings[k] = other.settings[k];
    // fields a newer build wrote, that this tab does not know about
    for (const k of Object.keys(other)) if (!KNOWN.has(k) && !Object.prototype.hasOwnProperty.call(d, k) && !UNSAFE.has(k)) d[k] = other[k];
  };

  const api = {
    data: sanitize(null, settingDefaults),
    /** false after a read or write failed: progress then lives only in memory for this session. */
    persistent: true,
    /** Why the last load fell back to defaults: '' | 'missing' | 'corrupt' | 'unavailable'. */
    loadStatus: '',

    load() {
      let text = null;
      api.persistent = true; api.loadStatus = '';
      try {
        const st = getStore();
        if (!st) { api.persistent = false; api.loadStatus = 'unavailable'; }
        else text = st.getItem(SAVE_KEY);
      } catch (e) { api.persistent = false; api.loadStatus = 'unavailable'; }
      let raw = null;
      if (typeof text === 'string' && text.length) {
        try { raw = JSON.parse(text); } catch (e) { raw = null; api.loadStatus = 'corrupt'; }
        if (raw !== null && !isObj(raw)) { raw = null; api.loadStatus = 'corrupt'; }
      } else if (!api.loadStatus) api.loadStatus = 'missing';
      api.data = sanitize(raw, settingDefaults);
      dirty.clear();
      return api.data;
    },

    /** Persist: merge in what another tab may have stored meanwhile, then write. Returns true when the data reached storage. Never throws. */
    write() {
      try {
        const st = getStore();
        if (!st) { api.persistent = false; return false; }
        mergeFrom(readStored());
        st.setItem(SAVE_KEY, JSON.stringify(api.data));
        dirty.clear();
        api.persistent = true;
        return true;
      } catch (e) { api.persistent = false; return false; }
    },

    /**
     * Another tab wrote the save: merge it in (`text` is the stored JSON, e.g. a storage event's newValue;
     * without it the storage is re-read). Returns true when something was merged.
     */
    sync(text) {
      let other = null;
      if (text === undefined) other = readStored();
      else { try { const raw = JSON.parse(text); other = isObj(raw) ? sanitize(raw, settingDefaults) : null; } catch (e) { other = null; } }
      if (!other) return false;
      mergeFrom(other);
      return true;
    },
    /** Keep in step with other tabs: merge their writes as they happen (the window's `storage` event). `onChange` runs after each. */
    listen(target = globalThis, onChange = null) {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener('storage', (e) => {
        if (e && e.key === SAVE_KEY && typeof e.newValue === 'string' && api.sync(e.newValue) && onChange) onChange();
      });
    },

    /** Progress for one level (defaults when never played). The returned object is a copy. */
    level(id) {
      const l = api.data.levels[id];
      return l ? { done: l.done, shards: l.shards.slice(), bestMs: l.bestMs } : { done: false, shards: [], bestMs: 0 };
    },

    /** Merge a completed run: done, union of shards, best (lowest) time. */
    recordLevel(id, result) {
      if (typeof id !== 'string' || !id || UNSAFE.has(id)) return api.level('');
      const cur = cleanLevel(api.data.levels[id]);
      const add = cleanLevel({ done: true, shards: result && result.shards, bestMs: result && result.timeMs });
      cur.done = true;
      cur.shards = [...new Set([...cur.shards, ...add.shards])].sort((a, b) => a - b);
      if (add.bestMs > 0 && (cur.bestMs === 0 || add.bestMs < cur.bestMs)) cur.bestMs = add.bestMs;
      api.data.levels[id] = cur;
      api.write();
      return api.level(id);
    },

    /**
     * Remember the last level played. With `element` (the campaign it belongs to) the element's own
     * "last" and the chosen element are remembered too; without it only `last` changes, as in v1.
     */
    setLast(id, element) {
      if (typeof id !== 'string') return;
      api.data.last = id.slice(0, 64);
      if (isElement(element) && id && !UNSAFE.has(id)) {
        api.data.lastBy = { ...(isObj(api.data.lastBy) ? api.data.lastBy : {}), [element]: api.data.last };
        api.data.element = element;
        dirty.add('lastBy.' + element); dirty.add('element');
      }
      dirty.add('last');
      api.write();
    },

    /** The element last chosen ('water' when never chosen, or when the field is missing or junk). */
    element() { return isElement(api.data.element) ? api.data.element : DEFAULT_SAVE_ELEMENT; },

    /** Remember the chosen element. Anything but 'water' | 'fire' | 'clay' is ignored. */
    setElement(element) {
      if (!isElement(element)) return api.element();
      api.data.element = element;
      dirty.add('element');
      api.write();
      return element;
    },

    /**
     * Id of the last level played in an element's campaign, or ''. A water-only save has no
     * `lastBy`: its `last` is then taken as Water's (the caller checks the id is really in that campaign).
     */
    lastFor(element) {
      const lb = api.data.lastBy;
      if (isObj(lb) && typeof lb[element] === 'string') return lb[element];
      return element === DEFAULT_SAVE_ELEMENT && !isObj(lb) ? api.data.last : '';
    },

    /** Collectibles held across the given level ids (one campaign's worth). */
    shardsIn(ids) {
      let n = 0;
      for (const id of ids) if (Object.prototype.hasOwnProperty.call(api.data.levels, id)) n += api.data.levels[id].shards.length;
      return n;
    },

    /** Change one setting (validated through sanitize). */
    setSetting(key, value) {
      const next = sanitize({ ...api.data, settings: { ...api.data.settings, [key]: value } }, settingDefaults);
      api.data.settings = next.settings;
      dirty.add('settings.' + key);
      api.write();
      return api.data.settings[key];
    },

    totalShards() {
      let n = 0;
      for (const id of Object.keys(api.data.levels)) n += api.data.levels[id].shards.length;
      return n;
    },

    /** Wipe progress (settings are kept). */
    resetProgress() {
      api.data.levels = {};
      api.data.last = '';
      delete api.data.lastBy;          // progress; the chosen element is a preference and stays
      api.data.resetAt = Math.max(Date.now(), num(api.data.resetAt) + 1);
      dirty.add('last'); dirty.add('reset');
      api.write();
    },
  };
  return api;
}
