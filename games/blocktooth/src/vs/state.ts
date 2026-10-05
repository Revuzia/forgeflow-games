// BLOCKTOOTH VS — initial state factories (lane B-CORE wrote the first version; lane B-VS OWNS this file now).
// THREE-FREE, deterministic (no Math.random / clocks / engine-approximated Math: detban scans src/vs).
// createWorld (core/world.ts) calls these when RunOptions.mode === 'vs'.

import { VS } from '../core/config.ts';
import type { CityLayout } from '../core/types.ts';
import type { BotLevel, BotMemory, PlayerVs, RingState, VsWorld } from './types.ts';

/** A neutral per-seat VS record (also what a solo world's single player carries; never read in solo). */
export function createPlayerVs(): PlayerVs {
  return {
    eliminated: false, elimT: -1, place: 0,
    respawnT: -1, spawnProtT: 0, clearedT: 0,
    koCount: 0, evictions: 0, assists: 0,
    pvpDealt: 0, pvpTaken: 0,
    tenderBids: 0, tenderTop: 0, crownS: 0,
    peakRank: 0, rankT: [-1, -1, -1, -1],
    score: 0, hits: [], lastKillerSlot: -1, sleeper: null,
    data: {},
  };
}

/** A bot seat's brain memory (the VS bot lane fills the rest through `data`). */
export function createBotMemory(level: BotLevel): BotMemory {
  return {
    level, mode: 'food', targetSlot: -1, modeT: 0, data: {},
    inited: false, hasTarget: false, tx: 0, tz: 0, planTick: -1_000_000,
    lastX: 0, lastZ: 0, checkTick: 0, wasMoving: false,
    detourUntil: -1, detourX: 0, detourZ: 0, detourSign: 1, avoid: [],
    holdAbilityUntil: -1, strafeSign: 1, strafeFlipTick: 0,
    engagedTick: -1, fleeUntil: -1, railSeq: -1,
  };
}

/**
 * Where each seat's titan stands at the start (vs_design.md §3: "one in each quadrant"). Slot 0 keeps the generated
 * solo spawn (`city.spawn`: the zebra near downtown with the slate props around it); slots 1..3 take the crosswalk
 * nearest the MIRROR of it about the city centre (slot 1 mirrors X, slot 2 mirrors Z, slot 3 both), never within
 * 2 road-pitches of an already chosen seat, ties by lowest crosswalk index. Pure function of the city, so every
 * peer computes the same points. B-VS may replace this with a tuned layout.
 */
export function vsSpawnPoints(city: CityLayout, n: number): { x: number; z: number; heading: number }[] {
  const out: { x: number; z: number; heading: number }[] = [{ x: city.spawn.x, z: city.spawn.z, heading: city.spawn.heading }];
  if (n <= 1) return out;
  const b = city.bounds;
  const cx = (b.minX + b.maxX) * 0.5, cz = (b.minZ + b.maxZ) * 0.5;
  const sx = city.spawn.x, sz = city.spawn.z;
  const targets = [
    { x: 2 * cx - sx, z: sz },
    { x: sx, z: 2 * cz - sz },
    { x: 2 * cx - sx, z: 2 * cz - sz },
  ];
  const minSep = 2 * city.pitch;
  const inset = city.pitch;                           // stay off the very edge of the playable bounds
  for (let s = 1; s < n; s++) {
    const tg = targets[s - 1];
    let best = -1, bestD = Infinity;
    for (let k = 0; k < city.crosswalks.length; k++) {
      const c = city.crosswalks[k];
      if (c.x < b.minX + inset || c.x > b.maxX - inset || c.z < b.minZ + inset || c.z > b.maxZ - inset) continue;
      let clash = false;
      for (let j = 0; j < out.length; j++) {
        const dx = c.x - out[j].x, dz = c.z - out[j].z;
        if (dx * dx + dz * dz < minSep * minSep) { clash = true; break; }
      }
      if (clash) continue;
      const dx = c.x - tg.x, dz = c.z - tg.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = k; }
    }
    if (best < 0) {                                   // degenerate city: fall back to the target itself
      out.push({ x: tg.x, z: tg.z, heading: city.spawn.heading });
      continue;
    }
    const c = city.crosswalks[best];
    out.push({ x: c.x, z: c.z, heading: c.axis === 'z' ? 0 : Math.PI / 2 });
  }
  return out;
}

/** World-level VS state at tick 0 (phase 'countdown'; the ring centre / radius are filled by the VS lane at match start). */
export function createVsWorld(city: CityLayout): VsWorld {
  const b = city.bounds;
  const half = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.5;
  const ring: RingState = {
    cx: (b.minX + b.maxX) * 0.5, cz: (b.minZ + b.maxZ) * 0.5,
    r: half, r0: half, fromR: half, toR: half, t0: 0, t1: 0, step: -1, mortarT: 0,
  };
  return {
    phase: 'countdown', phaseT: 0, startT: VS.countdownS,
    crown: -1, ring,
    tenders: VS.tender.gates.map((g) => ({
      gate: g.gate, boss: g.gate, state: 'pending' as const, atS: g.atS, x: 0, z: 0, spawnSlot: -1,
      markerT: -1, spawnT: -1, dmg: [0, 0, 0, 0], recent: [0, 0, 0, 0], targetSlot: -1, retargetT: -1, ignoredS: 0,
    })),
    order: [], winner: -1, endT: -1, data: {},
  };
}
