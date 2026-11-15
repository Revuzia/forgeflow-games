// core/level/layout.js [W4 — PVP map split, PVP_BUILD_PLAN C17/O2, Amendment A1]
// Thin re-export over core/level/maps/*. `buildLayout(seed)` KEEPS its frozen
// signature; which map it builds is a module-level selection.
//
// DEFAULT = meridian_ward (the campaign map, byte-identical to the pre-split
// layout.js). Amendment A1 overrides C17's "default lanternwalk": the campaign
// stays wired and playable, and the concurrent aim wave's ground/z-fight
// probes (lanec_ground.py, lanec_gate.py — O2) sample ward geometry at boot.
// Matches select the arena via setActiveMap('lanternwalk') before rebuilding
// colliders/nav (W1's startMatch path owns that call).
//
// Node probes may preselect a map with the BLACKRIDGE_MAP env var
// (browser-safe guard: no `process` there).
//
// [multi-arena amendment] SWITCHYARD and SALTMARKET are authored in
// CONCURRENT lanes, so this module must register them WITHOUT being able to
// assume the files exist yet.
//
// CHOICE: a try/catch registry populated ONCE at module init, using top-level
// await around a dynamic import — NOT import-on-demand inside buildLayoutFor.
// Why: `buildLayout(seed)` / `buildLayoutFor(mapId, seed)` are SYNCHRONOUS and
// their signatures are frozen (colliders.js, nav.js and boot.js's setWorldMap
// all call them synchronously), so a lazy import inside them would force every
// caller to become async. Top-level await keeps the sync contract and still
// tolerates a missing file: importers of layout.js simply wait for this loop,
// which is the module-graph behaviour they already have. A map whose file is
// absent (or whose module throws) is WARNED and left unregistered — it is then
// an unknown id, and buildLayoutFor/setActiveMap throw the same clear error
// they always threw. meridian_ward and lanternwalk stay STATIC imports, so a
// break in either is a hard boot failure exactly as before.

import { buildLayout as buildMeridianWard, computePlacements } from "./maps/meridian_ward.js";
import { buildLayout as buildLanternwalk } from "./maps/lanternwalk.js";

const MAPS = {
  meridian_ward: buildMeridianWard,
  lanternwalk: buildLanternwalk,
};

// Arenas that land in a concurrent lane. Registered if present, skipped loudly
// if not — never a boot failure for the campaign or lanternwalk.
export const OPTIONAL_MAPS = ["switchyard", "saltmarket"];
for (const id of OPTIONAL_MAPS) {
  try {
    const mod = await import(`./maps/${id}.js`);
    if (typeof mod.buildLayout === "function") MAPS[id] = mod.buildLayout;
    else console.warn(`[layout] map '${id}' loaded but exports no buildLayout — not registered`);
  } catch (e) {
    // 404 (lane not landed) and a syntax error inside the module both arrive
    // here; the message distinguishes them, so it is logged verbatim.
    console.warn(`[layout] optional arena '${id}' not registered — ${(e && e.message) || e}`);
  }
}

export function listMaps() { return Object.keys(MAPS); }

let ACTIVE =
  (typeof process !== "undefined" && process.env && process.env.BLACKRIDGE_MAP && MAPS[process.env.BLACKRIDGE_MAP])
    ? process.env.BLACKRIDGE_MAP
    : "meridian_ward";

export function setActiveMap(id) {
  if (!MAPS[id]) throw new Error(`layout.setActiveMap: unknown map '${id}'`);
  ACTIVE = id;
}
export function getActiveMap() { return ACTIVE; }
export function buildLayoutFor(mapId, seed = 1) {
  if (!MAPS[mapId]) throw new Error(`layout.buildLayoutFor: unknown map '${mapId}'`);
  return MAPS[mapId](seed);
}
export function buildLayout(seed = 1) { return MAPS[ACTIVE](seed); }
export { computePlacements };
