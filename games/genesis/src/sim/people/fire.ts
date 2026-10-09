// GENESIS — keeping fire (CONTRACT.md §8.4, §16.1 "first night"): hearths burn fuel and go out untended; a people
// that knows fire-keeping but not fire-making can only relight from a living flame — another lit hearth, a wildfire or
// a lightning fire in reach, or one they carried home recently. Fire-makers can light one anywhere.

import type { PCtx } from './ctx.ts';
import type { Settlement } from './state.ts';
import { BuildingFlag } from '../types.ts';

/** ticks of burn one unit of fuel gives a hearth */
export const FUEL_TICKS = 300;

/** is there a flame the settlement can take fire from (or can it make fire itself) */
export function fireSourceNear(x: PCtx, st: Settlement): boolean {
  const fm = x.rt.byId.get('fire-making');
  if (fm !== undefined && st.library.includes(fm)) return true;
  for (const b of x.ps.of(st.id)) {
    if (b.fuel > 0 && b.progress >= 1 && !(b.flags & BuildingFlag.ruined) && x.c.buildings.list[b.type].heat > 0 && x.c.buildings.list[b.type].function === 'hearth') return true;
  }
  for (const k of ['wildfire', 'lightning-fire']) {
    const t = st.recent[k];
    if (t !== undefined && x.tick - t < 3 * x.day) return true;
  }
  // a fire burning in the territory right now
  const f = x.p.f;
  const cells = st.flow?.cells ?? [st.cell];
  for (let i = 0; i < cells.length; i++) if (f.fire[cells[i]] > 0.05) return true;
  return false;
}

/** hourly: hearths burn their fuel (lit flag for the renderer) */
export function burnHearths(x: PCtx, st: Settlement, ticks: number): void {
  for (const b of x.ps.of(st.id)) {
    if (b.progress < 1) continue;
    const def = x.c.buildings.list[b.type];
    if (def.function !== 'hearth') continue;
    const was = b.fuel > 0;
    if (b.fuel > 0) b.fuel = Math.max(0, b.fuel - ticks);
    // rain douses an open hearth
    if (b.fuel > 0 && x.p.f.precip[b.cell] > 6 && x.p.f.precipType[b.cell] === 1) b.fuel = Math.max(0, b.fuel - ticks * 2);
    const lit = b.fuel > 0;
    if (lit) b.flags |= BuildingFlag.lit; else b.flags &= ~BuildingFlag.lit;
    if (was !== lit) x.ps.version++;
  }
}

/** a new hearth catches only if a flame is at hand */
export function lightNewHearth(x: PCtx, st: Settlement, fuelTicks: number): number {
  return fireSourceNear(x, st) ? fuelTicks : 0;
}
