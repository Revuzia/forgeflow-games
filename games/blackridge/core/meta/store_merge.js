// core/meta/store_merge.js — merge-on-write for device saves shared by tabs.
//
// Two open tabs each hold their own copy of a save record; with a plain
// setItem the last writer wins and the other tab's XP / challenge progress is
// lost. Every record here is saved through a THREE-WAY merge instead:
//
//   base = the record as this tab last read or wrote it from storage
//   cur  = this tab's in-memory record (base + this tab's unsaved deltas)
//   disk = what storage holds right now (base + the OTHER tabs' deltas)
//
//   merged = disk + (cur − base)
//
// so each tab's per-match deltas are added exactly once, whichever writes
// first. Per-path rules (a function path → rule) pick how a leaf combines:
//   "sum"   counters / XP        disk + max(0, cur − base)
//   "max"   high-water marks     max(cur, disk)
//   "or"    sticky flags         cur || disk
//   "union" string sets (seen)   disk ∪ cur, disk order first
//   "lww"   settings-like values cur if this tab changed it since base, else disk
// Objects recurse key-by-key (keys from both sides survive); arrays of equal
// length recurse element-wise under "lww"; anything else falls back to "lww".
//
// Pure and DOM-free (selftested in node by core/meta/store_merge.selftest.cjs).

const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => {
  if (a === b) return true;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
};
const clone = (v) => (v == null || typeof v !== "object") ? v : JSON.parse(JSON.stringify(v));
export { clone as cloneRecord };

/** merge3(base, cur, disk, ruleOf, path) — see the header. ruleOf(path, key)
 *  returns a rule name or a function (base, cur, disk, path) → value. */
export function merge3(base, cur, disk, ruleOf, path = "") {
  const rule = ruleOf ? ruleOf(path) : null;
  if (typeof rule === "function") return rule(base, cur, disk, path);
  if (cur === undefined) return clone(disk);
  if (disk === undefined) return clone(cur);
  if (rule === "sum" && typeof cur === "number" && typeof disk === "number") {
    const b = typeof base === "number" ? base : 0;
    return Math.max(0, disk + (cur - b));
  }
  if (rule === "max" && typeof cur === "number" && typeof disk === "number") return Math.max(cur, disk);
  if (rule === "or") return !!(cur || disk);
  if (rule === "union" && Array.isArray(cur) && Array.isArray(disk)) {
    const out = disk.slice();
    for (const x of cur) if (out.indexOf(x) < 0) out.push(x);
    return out;
  }
  if (isObj(cur) && isObj(disk) && rule !== "lwwWhole") {
    const out = {};
    const b = isObj(base) ? base : {};
    const keys = Object.keys(disk);
    for (const k of Object.keys(cur)) if (keys.indexOf(k) < 0) keys.push(k);
    for (const k of keys) out[k] = merge3(b[k], cur[k], disk[k], ruleOf, path ? path + "." + k : k);
    return out;
  }
  if (Array.isArray(cur) && Array.isArray(disk) && Array.isArray(base) &&
      cur.length === disk.length && base.length === cur.length && rule !== "lwwWhole") {
    return cur.map((x, i) => merge3(base[i], x, disk[i], ruleOf, path + "." + i));
  }
  // lww (default): this tab's value if it changed since base, else disk's
  return clone(same(cur, base) ? disk : cur);
}

/**
 * A small persistence helper around merge3 for one localStorage key.
 *   const ms = mergedStore({ storage, key, parse: raw => rec|null, ruleOf });
 *   ms.adopt(rec, raw)        after load: rec is the base, raw what was read
 *   ms.save(rec) → {rec, ok}  re-read disk, merge, write, rebase
 *   ms.absorb(raw, rec) → rec merge another tab's write without writing
 * parse must return null for an unreadable / newer-version record (merge is
 * then skipped and this tab's record is written as before).
 */
export function mergedStore(o) {
  const { storage, key, parse, ruleOf } = o;
  let base = null, lastRaw = null;
  const api = {
    adopt(rec, raw) { base = clone(rec); lastRaw = raw == null ? null : String(raw); },
    base: () => base,
    /** fold the current disk state into rec (no write). */
    rebase(rec, raw) {
      if (raw == null || raw === lastRaw) return rec;
      const disk = parse(raw);
      lastRaw = raw;
      if (!disk) return rec;
      const merged = merge3(base, rec, disk, ruleOf);
      base = clone(disk);
      return merged;
    },
    save(rec, serialize) {
      if (!storage) return { rec, ok: false };
      let raw = null;
      try { raw = storage.getItem(key); } catch (_) { raw = null; }
      const merged = api.rebase(rec, raw);
      const text = (serialize || JSON.stringify)(merged);
      storage.setItem(key, text); // throws on quota: the caller's retry path handles it
      lastRaw = text; base = clone(merged);
      return { rec: merged, ok: true };
    },
    absorb(raw, rec) { return api.rebase(rec, raw); },
  };
  return api;
}

/** Subscribe to other tabs' writes of `key` (browser only; no-op in node). */
export function onOtherTabWrite(key, fn) {
  if (typeof window === "undefined" || !window.addEventListener) return () => {};
  const h = (e) => { if (e && e.key === key && e.newValue != null) { try { fn(e.newValue); } catch (err) { console.warn("[store_merge]", key, err && err.message); } } };
  window.addEventListener("storage", h);
  return () => window.removeEventListener("storage", h);
}
