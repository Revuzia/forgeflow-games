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

import { buildLayout as buildMeridianWard, computePlacements } from "./maps/meridian_ward.js";
import { buildLayout as buildLanternwalk } from "./maps/lanternwalk.js";

const MAPS = {
  meridian_ward: buildMeridianWard,
  lanternwalk: buildLanternwalk,
};

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
