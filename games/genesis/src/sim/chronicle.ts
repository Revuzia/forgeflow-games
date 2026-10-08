// GENESIS — the chronicle (CONTRACT.md §13), phase 1: entries are appended through Universe.chronicleAdd (dated with the
// planet's calendar, prefixed "Year N.") from god acts (air, the star, the sun standing still) and from the world's
// FIRSTS, checked hourly here: first rain, first snow, first sea, first plants (life), first forest (vegetation.ts),
// first fire (fire.ts). Firsts that already exist when a world is generated are marked at tick 0 so a living world does
// not announce its own oceans. Later phases add discoveries, foundings, wars, extinctions… through templates
// (events.json).

import type { ChronicleEntry } from './types.ts';
import type { Universe } from './world/universe.ts';
import type { Planet } from './world/planet.ts';

export const CHRONICLE_CADENCE = 60;
export const CHRONICLE_OFFSET = 45;

/** mark what a freshly generated world already has (no announcements for those) */
export function markInitialFirsts(p: Planet): void {
  const f = p.f;
  if (p.st.atmosphere.pressure >= 0.02) p.firsts.air = 0;
  if (p.hydro.oceanCells > p.count * 0.01) p.firsts.sea = 0;
  let rain = false, snow = false, trees = 0;
  for (let c = 0; c < p.count; c++) {
    if (f.precip[c] > 0) { if (f.precipType[c] === 2) snow = true; else rain = true; }
    if (f.tree[c] > 0.5) trees++;
  }
  if (p.vegTotal > 1) p.firsts.life = 0;
  if (trees > 40) p.firsts.forest = 0;
  if (p.airy && (rain || p.hydro.oceanCells > 0)) p.firsts.rain = 0;
  if (p.airy && snow) p.firsts.snow = 0;
}

/** hourly: look for firsts */
export function chronicleCheck(u: Universe, p: Planet): void {
  const f = p.f, fs = p.firsts;
  if (fs.rain === undefined || fs.snow === undefined) {
    for (let c = 0; c < p.count; c += 3) {
      if (f.precip[c] <= 0) continue;
      const t = f.precipType[c];
      if (fs.rain === undefined && (t === 1 || t === 5 || t === 6) && !(p.s.ocean[c] && f.water[c] > 0.5)) {
        fs.rain = u.tick;
        u.chronicleAdd(p, 'nature', 'Rain fell for the first time, and ran down the stone.', 2);
      }
      if (fs.snow === undefined && t === 2) {
        fs.snow = u.tick;
        u.chronicleAdd(p, 'nature', 'The first snow fell.', 1);
      }
      if (fs.rain !== undefined && fs.snow !== undefined) break;
    }
  }
  if (fs.sea === undefined) {
    let wet = 0;
    for (let c = 0; c < p.count; c += 4) if (f.water[c] > 1) wet++;
    if (wet * 4 > p.count * 0.02) {
      fs.sea = u.tick;
      u.chronicleAdd(p, 'nature', 'Water gathered in the low places, and the first sea lay under the sky.', 3);
    }
  }
  if (fs.life === undefined && p.vegTotal > 1) {
    fs.life = u.tick;
    u.chronicleAdd(p, 'nature', 'Green came to the world: the first plants took root.', 3);
  }
}

/** chronicle entries after index `from` (snapshots send only new ones) */
export function chronicleSince(u: Universe, from: number): ChronicleEntry[] {
  return u.chronicle.slice(Math.max(0, from));
}
