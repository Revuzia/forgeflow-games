// VALE sim — fog of war (CONTRACT §5.4 Vision).
//
// Per team, a byte grid at navCell × 4 metres per cell (0 = unseen, 255 = seen), rebuilt at 10 Hz
// by stamping a precomputed disc for every sight source of that team: fighters, minions,
// structures, wards, summons (anything alive with `sight > 0`). Then each entity's visibleMask:
//   * own team always sees its own entities;
//   * structures are always visible to everyone (they are landmarks; their state is public);
//   * otherwise the entity's cell must be seen by the team, AND
//       - if it stands in a thicket, the team must have a unit (or ward) inside the same thicket,
//       - if it is invisible, it is hidden,
//     unless the team has revealed it (reveal status), which overrides fog, thickets and invisibility.
//
// Walls do NOT occlude sight in this slice: sight is a plain disc. This is deliberate (cost and
// readability); terrain occlusion can be added later by raycasting stamps against the nav grid
// without changing this module's interface.

import type { MapDefT } from '../contracts/catalog.ts';
import type { TeamId } from '../contracts/sim.ts';
import { ST_INVISIBLE, type Entity } from './entity.ts';
import { pointInPolygon, polygonAabb, type Aabb, type Poly } from './math.ts';

/** fighters have no sightRange record; this is their sight radius in metres */
export const FIGHTER_SIGHT = 12;
/** ticks between rebuilds (30 Hz / 3 = 10 Hz) */
export const VISION_INTERVAL_TICKS = 3;

export interface VisionGridView { width: number; height: number; cell: number; data: Uint8Array }

export class Vision {
  readonly w: number;
  readonly h: number;
  readonly cell: number;
  readonly teamCount: number;
  private views: VisionGridView[] = [];
  private thickets: Poly[];
  private boxes: Aabb[];
  /** occupied[team * thicketCount + thicket] = 1 when the team has a unit inside */
  private occupied: Uint8Array;
  private stamps = new Map<number, Int32Array>();
  lastUpdateTick = -1_000_000;

  constructor(map: MapDefT, teamCount: number) {
    this.cell = map.navCell * 4;
    this.w = Math.max(1, Math.ceil(map.size[0] / this.cell));
    this.h = Math.max(1, Math.ceil(map.size[1] / this.cell));
    this.teamCount = teamCount;
    for (let t = 0; t < teamCount; t++) this.views.push({ width: this.w, height: this.h, cell: this.cell, data: new Uint8Array(this.w * this.h) });
    this.thickets = map.thickets;
    this.boxes = map.thickets.map(polygonAabb);
    this.occupied = new Uint8Array(Math.max(1, teamCount * this.thickets.length));
  }

  /** the live grid for a team (same object every call; contents change at 10 Hz) */
  grid(team: TeamId): VisionGridView {
    const v = this.views[team];
    if (!v) throw new Error(`vision: no team ${team}`);
    return v;
  }

  /** index of the thicket containing (x, y), or -1 */
  thicketAt(x: number, y: number): number {
    for (let i = 0; i < this.thickets.length; i++) {
      const b = this.boxes[i];
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if (pointInPolygon(x, y, this.thickets[i])) return i;
    }
    return -1;
  }

  /** is the cell under (x, y) seen by `team` right now */
  seen(team: TeamId, x: number, y: number): boolean {
    const v = this.views[team];
    if (!v) return false;
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.w || cy >= this.h) return false;
    return v.data[cy * this.w + cx] !== 0;
  }

  private stampFor(radius: number): Int32Array {
    const key = Math.round(radius * 100);
    let s = this.stamps.get(key);
    if (s) return s;
    const rc = radius / this.cell;
    const n = Math.ceil(rc);
    const offs: number[] = [];
    for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) if (dx * dx + dy * dy <= rc * rc + 0.25) offs.push(dx, dy);
    s = Int32Array.from(offs);
    this.stamps.set(key, s);
    return s;
  }

  /** rebuild grids + every entity's thicket and visibleMask */
  update(entities: readonly Entity[], tick: number): void {
    this.lastUpdateTick = tick;
    const T = this.teamCount, nT = this.thickets.length, w = this.w, h = this.h, cell = this.cell;
    for (let t = 0; t < T; t++) this.views[t].data.fill(0);
    this.occupied.fill(0);

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      if (e.kind === 'projectile' || e.kind === 'zone') continue;
      e.thicket = nT > 0 ? this.thicketAt(e.x, e.y) : -1;
      if (!e.alive || e.team < 0 || e.team >= T) continue;
      if (e.thicket >= 0) this.occupied[e.team * nT + e.thicket] = 1;
      if (e.sight <= 0) continue;
      const data = this.views[e.team].data;
      const st = this.stampFor(e.sight);
      const cx = Math.floor(e.x / cell), cy = Math.floor(e.y / cell);
      for (let k = 0; k < st.length; k += 2) {
        const x = cx + st[k], y = cy + st[k + 1];
        if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = 255;
      }
    }

    for (let i = 0; i < entities.length; i++) {
      const e = entities[i];
      let mask = 0;
      const cx = Math.floor(e.x / cell), cy = Math.floor(e.y / cell);
      const inGrid = cx >= 0 && cy >= 0 && cx < w && cy < h;
      const ci = cy * w + cx;
      const transient = e.kind === 'projectile' || e.kind === 'zone';
      for (let t = 0; t < T; t++) {
        const bit = 1 << t;
        if (e.team === t || e.kind === 'structure' || (e.revealMask & bit) !== 0) { mask |= bit; continue; }
        if (!inGrid || this.views[t].data[ci] === 0) continue;
        if (!transient) {
          if ((e.ccMask & ST_INVISIBLE) !== 0) continue;
          if (e.thicket >= 0 && this.occupied[t * nT + e.thicket] === 0) continue;
        }
        mask |= bit;
      }
      e.visibleMask = mask;
    }
  }
}
