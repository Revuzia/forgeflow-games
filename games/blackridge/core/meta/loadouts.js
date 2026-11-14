// core/meta/loadouts.js — the player's five SAVED CLASSES, one versioned
// localStorage record, validated on every load. DOM-free (node selftest runs
// it with a fake storage); the rules a class must satisfy live in
// core/sim/classes.js so the store, the editor and the sim agree.
//
// Record (key "blackridge.classes", v1):
//   { v: 1, selected: 0..4, playlist: "classes" | "pistol", classes: [5 × class] }
//   class = { name, primary, secondary, lethal, perks: [tier1, tier2, tier3],
//             builds: { <weaponId>: { attach: [ids], camo } } }   (gunsmith; optional)
// A missing, unparsable, wrong-version or partially-bad record is repaired
// field by field against DEFAULT_CLASSES (never thrown away wholesale unless it
// is not an object at all), and the repaired record is written back.
//
// PLAYLIST: "classes" (default) spawns everyone from a class; "pistol" is the
// original PISTOL START rule (everyone spawns with the Pike and fights for the
// racks) — kept as a selectable playlist.
//
// Progression gate: matchSpec(progression) resolves the selected class through
// progression.isUnlocked (absent = everything unlocked), so a locked weapon /
// perk / lethal never reaches a match even if the saved class names it.

import { DEFAULT_CLASSES, CLASS_COUNT, validateClass, resolveKit } from "../sim/classes.js";
import { validateBuild } from "../sim/attachments.js"; // [gunsmith]
import { mergedStore, onOtherTabWrite } from "./store_merge.js";

// [polish v149] two tabs: a class edit in one tab must survive an unrelated
// edit in the other. Settings-like data, so every leaf is last-writer-wins
// against the base this tab last saw; whole arrays (perks, attachments) move
// together so a merge can never stitch an illegal build. The merged record is
// re-validated by parseRecord.
const loadoutMergeRule = (path) => /(^|\.)(perks|attach)$/.test(path) ? "lwwWhole" : null;

// deep-enough copy of a class (perks + gunsmith builds are the nested parts)
function copyClass(c) {
  const builds = {};
  for (const w of Object.keys(c.builds || {})) builds[w] = { attach: c.builds[w].attach.slice(), camo: c.builds[w].camo || null };
  return { ...c, perks: c.perks.slice(), builds };
}

export const STORE_KEY = "blackridge.classes";
export const STORE_VERSION = 1;
export const PLAYLISTS = ["classes", "pistol"];

export function defaultRecord() {
  return {
    v: STORE_VERSION, selected: 0, playlist: "classes",
    classes: DEFAULT_CLASSES.map((c) => ({ ...c, perks: c.perks.slice() })),
  };
}

// raw (string | object | null) -> {rec, dirty}
export function parseRecord(raw) {
  let o = raw;
  if (typeof raw === "string") {
    try { o = JSON.parse(raw); } catch (e) { o = null; }
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { rec: defaultRecord(), dirty: true };
  let dirty = o.v !== STORE_VERSION;
  const inClasses = Array.isArray(o.classes) ? o.classes : [];
  if (inClasses.length !== CLASS_COUNT) dirty = true;
  const classes = [];
  for (let i = 0; i < CLASS_COUNT; i++) {
    const r = validateClass(inClasses[i], i);
    if (r.fixed) dirty = true;
    classes.push(r.cls);
  }
  let selected = Number.isInteger(o.selected) && o.selected >= 0 && o.selected < CLASS_COUNT ? o.selected : (dirty = true, 0);
  const playlist = PLAYLISTS.indexOf(o.playlist) >= 0 ? o.playlist : (dirty = true, "classes");
  return { rec: { v: STORE_VERSION, selected, playlist, classes }, dirty };
}

function defaultStorage() {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch (e) { return null; }
}

export function createLoadouts(opts) {
  const o = opts || {};
  const storage = o.storage !== undefined ? o.storage : defaultStorage();
  const listeners = [];
  let rec;

  const ms = mergedStore({
    storage, key: STORE_KEY, ruleOf: loadoutMergeRule,
    parse: (raw) => { try { return parseRecord(raw).rec; } catch (e) { return null; } },
  });
  function read() {
    let raw = null;
    try { raw = storage ? storage.getItem(STORE_KEY) : null; } catch (e) { raw = null; }
    const r = parseRecord(raw);
    rec = r.rec;
    ms.adopt(rec, raw);
    if (r.dirty) write();
  }
  function write() {
    try {
      if (!storage) return;
      const merged = ms.save(rec).rec;
      const v = parseRecord(JSON.stringify(merged)); // re-validate the merge
      rec = v.rec;
      if (v.dirty) { storage.setItem(STORE_KEY, JSON.stringify(rec)); ms.adopt(rec, JSON.stringify(rec)); }
    } catch (e) { /* best-effort */ }
  }
  function changed() {
    write();
    for (const fn of listeners.slice()) { try { fn(api); } catch (e) { /* listener fault */ } }
  }
  read();
  // another tab edited its classes: adopt them (this store writes on every
  // change, so there are no unsaved local edits to keep)
  onOtherTabWrite(STORE_KEY, (raw) => {
    rec = parseRecord(raw).rec; ms.adopt(rec, raw);
    for (const fn of listeners.slice()) { try { fn(api); } catch (e) { /* listener fault */ } }
  });

  const api = {
    classes() { return rec.classes.map(copyClass); },
    get(i) { const c = rec.classes[i | 0]; return c ? copyClass(c) : null; },
    selected() { return rec.selected; },
    select(i) {
      if (!Number.isInteger(i) || i < 0 || i >= CLASS_COUNT) return false;
      rec.selected = i; changed(); return true;
    },
    // patch any subset of {name, primary, secondary, lethal, perks}; perks may
    // be a full array or {tier: 1..3, id}. The result is validated — an
    // illegal patch is rejected (returns false) and nothing changes.
    update(i, patch) {
      const cur = rec.classes[i | 0];
      if (!cur || !patch) return false;
      const next = copyClass(cur);
      // [gunsmith] {build: {weapon, attach?, camo?}} — attach/camo each optional (a
      // camo pick keeps the attachments); an illegal build is rejected, never repaired
      if (patch.build && typeof patch.build === "object") {
        const wid = patch.build.weapon;
        const prev = next.builds[wid] || { attach: [], camo: null };
        const want = { attach: "attach" in patch.build ? patch.build.attach : prev.attach,
                       camo: "camo" in patch.build ? patch.build.camo : prev.camo };
        const vb = validateBuild(wid, want);
        if (vb.fixed) return false;
        if (vb.build.attach.length || vb.build.camo) next.builds[wid] = vb.build; else delete next.builds[wid];
      }
      for (const k of ["name", "primary", "secondary", "lethal", "tactical"]) if (k in patch) next[k] = patch[k];
      if (Array.isArray(patch.perks)) next.perks = patch.perks.slice(0, 3);
      if (patch.perk && patch.perk.tier >= 1 && patch.perk.tier <= 3) next.perks[patch.perk.tier - 1] = patch.perk.id;
      const v = validateClass(next, i);
      if (v.fixed && !("name" in patch && Object.keys(patch).length === 1)) {
        // only a name may be silently cleaned (case/length); any other repair = illegal patch
        const onlyName = v.cls.primary === next.primary && v.cls.secondary === next.secondary &&
          v.cls.lethal === next.lethal && (v.cls.tactical || null) === (next.tactical || null) &&
          v.cls.perks.every((p, ti) => p === next.perks[ti]);
        if (!onlyName) return false;
      }
      rec.classes[i | 0] = v.cls;
      changed();
      return true;
    },
    reset(i) {
      const d = DEFAULT_CLASSES[i | 0];
      if (!d) return false;
      rec.classes[i | 0] = copyClass(d);
      changed();
      return true;
    },
    playlist() { return rec.playlist; },
    setPlaylist(p) {
      if (PLAYLISTS.indexOf(p) < 0) return false;
      rec.playlist = p; changed(); return true;
    },
    // what a match needs: the sim's `classes` option / content.pvpClassSelected
    matchSpec(progression, index) {
      const i = index != null ? index | 0 : rec.selected;
      return {
        enabled: rec.playlist !== "pistol",
        classId: i,
        player: api.kitFor(i, progression),
      };
    },
    kitFor(i, progression) {
      const gate = progression && typeof progression.isUnlocked === "function"
        ? (k) => progression.isUnlocked(k) : null;
      return resolveKit(rec.classes[i | 0], { isUnlocked: gate, classId: i | 0, index: i | 0 });
    },
    onChange(fn) { listeners.push(fn); return () => { const k = listeners.indexOf(fn); if (k >= 0) listeners.splice(k, 1); }; },
    reload: read,
    record() { return JSON.parse(JSON.stringify(rec)); },
  };
  return api;
}
