// GENESIS — ARC §2.6 / §6.9: the Tower, drawn from PlanetSnap.towers (TowerView). A stepped ziggurat of 12 m tiers,
// each set back × 0.82, a stair up its front face, in the builders' own brick and their culture's style tint, so it
// reads as theirs and real. By status:
//   rising      the tiers so far, a partial top tier (height mod 12), a timber scaffold with ladders round the top,
//               brick piles at the foot, dust (a smoke emitter within the particle budget) and the real builders
//   finished    all its tiers and a fire on the summit (a brazier emitter: the night-lights path lights it)
//   struck      the standing tiers, the top scorched, the fallen ones a rubble mound round the base, a one-time
//               column of dust and smoke for a day after the fall
//   scattered / abandoned   no scaffold, the top tier crumbled, weathering with the years since `ended`
// ONE mesh per tower and the same geometry at every quality preset (shadows follow the preset through the batch it
// is drawn in). It is drawn by Buildings into its own batches (the programs warmed at load: no shader compile after
// t = 0), and the BuildingBlock's `great-tower` record is skipped there.

import type { BufferGeometry } from 'three';
import type { TowerView } from '../../sim/types.ts';
import { hashFloat } from '../../sim/core/rng.ts';
import { KitBuilder, PART, mixc, mulc, type V3 } from '../gen/meshkit.ts';
import { EMIT, type BuildingMesh, type Emitter } from '../gen/buildinggen.ts';
import { SURF } from './catalog.ts';

type RGB = [number, number, number];

export const TOWER_TIER_M = 12;
export const TOWER_SETBACK = 0.82;
export const TOWER_MAX_TIERS = 10;

/** what the mesh depends on (quantised so a rising tower rebuilds its mesh once per metre, not every snapshot) */
export interface TowerLook {
  id: number;
  status: TowerView['status'];
  material: TowerView['material'];
  style: number;
  goal: number;
  /** height drawn (m, whole metres) */
  height: number;
  /** tiers fallen in a strike (struck only) */
  fallen: number;
  /** weathering 0..3 (scattered / abandoned / struck: years since `ended`) */
  weather: number;
}

/** the parts of a tower, for tests and the mesh (pure) */
export interface TowerShape {
  /** half widths of the drawn tiers, bottom up; the last one may be partial */
  halves: number[];
  /** heights of the drawn tiers (12 m, or the partial top) */
  rises: number[];
  scaffold: boolean;
  piles: boolean;
  fire: boolean;
  crumbled: boolean;
  scorched: boolean;
  /** rubble mound: outer radius and height (0 none) */
  moundR: number;
  moundH: number;
  top: number;
}

const BASE: Record<TowerView['material'], { surf: number; col: RGB }> = {
  mudbrick: { surf: SURF.mudbrick, col: [0.48, 0.33, 0.2] },
  brick: { surf: SURF.brick, col: [0.4, 0.15, 0.08] },
  // warm dressed sandstone (was a cold neutral grey that read blue-grey under the sky; colours are LINEAR albedo)
  stone: { surf: SURF.ashlar, col: [0.55, 0.4, 0.25] },
};
/** the culture's style variant (TowerView.style = the host's styleVariant): a small, stable shift of the brick's hue */
const STYLE_TINT: RGB[] = [
// (warm or neutral shifts only: a cool tint turned stone blue-grey)
  [1, 1, 1], [1.06, 0.98, 0.9], [0.98, 0.97, 0.93], [1.08, 1.0, 0.86],
  [0.96, 0.92, 0.9], [1.02, 1.04, 0.96], [0.93, 0.9, 0.86], [1.1, 0.96, 0.92],
];
const TIMBER: RGB = [0.24, 0.16, 0.09];
const SOOT: RGB = [0.06, 0.055, 0.05];
const AGED: RGB = [0.22, 0.2, 0.17];

/** the base half width (m) of a tower whose goal is `goal` metres: its footprint does not change as it rises */
export function towerBaseHalf(goal: number): number { return Math.max(22, Math.min(56, goal * 0.42)); }

/**
 * The ground a tower's site keeps clear of trees, shrubs and ground cover (m from its centre): the base square's corners,
 * the stair's foot, the brick piles and the widest struck mound's charred skirt, with a trodden margin. It depends on the goal only, so
 * the site is felled once when the tower is begun and never re-scattered as it rises, falls or weathers.
 */
export function towerClearR(goal: number): number { return towerBaseHalf(Math.max(TOWER_TIER_M, goal)) * 2.0 + 6; }

/** the clearings of PlanetSnap.towers: [ux, uy, uz, radius m, ...] (unit direction) and a signature that changes only
 *  when a tower is added, removed or moved */
export function towerClearings(list: readonly TowerView[] | undefined): { sig: string; at: number[] } {
  const at: number[] = [];
  let sig = '';
  for (const t of list ?? []) {
    const l = Math.hypot(t.pos[0], t.pos[1], t.pos[2]) || 1;
    const r = towerClearR(t.goal);
    at.push(t.pos[0] / l, t.pos[1] / l, t.pos[2] / l, r);
    sig += `${t.id}:${Math.round(r)}:${Math.round(t.pos[0] * 10)},${Math.round(t.pos[2] * 10)};`;
  }
  return { sig, at };
}

/** the TowerLook of a view at a tick (yearTicks: ticks per game year) */
export function towerLook(t: TowerView, tick: number, yearTicks: number): TowerLook {
  const height = Math.max(0, Math.min(TOWER_TIER_M * TOWER_MAX_TIERS, Math.floor(t.height)));
  const standing = Math.ceil(height / TOWER_TIER_M);
  const ended = t.ended >= 0 && t.status !== 'rising' && t.status !== 'finished';
  const years = ended ? Math.max(0, (tick - t.ended) / Math.max(1, yearTicks)) : 0;
  return {
    id: t.id, status: t.status, material: t.material, style: t.style & 7, goal: Math.max(TOWER_TIER_M, t.goal), height,
    // (TowerView.tiers keeps the count before the fall on a struck tower, ARC §6.2: the difference fell)
    fallen: t.status === 'struck' ? Math.max(1, t.tiers - standing) : 0,
    weather: ended ? (years < 1 ? 0 : years < 5 ? 1 : years < 20 ? 2 : 3) : 0,
  };
}

export function towerKey(l: TowerLook): string {
  return `${l.status}|${l.material}|${l.style}|${l.goal}|${l.height}|${l.fallen}|${l.weather}`;
}

export function towerShape(l: TowerLook): TowerShape {
  const b0 = towerBaseHalf(l.goal);
  const halves: number[] = [], rises: number[] = [];
  let y = 0, h = b0;
  const full = Math.floor(l.height / TOWER_TIER_M), part = l.height - full * TOWER_TIER_M;
  for (let i = 0; i < Math.min(full, TOWER_MAX_TIERS); i++) { halves.push(h); rises.push(TOWER_TIER_M); y += TOWER_TIER_M; h *= TOWER_SETBACK; }
  if (part >= 1 && halves.length < TOWER_MAX_TIERS) { halves.push(h); rises.push(part); y += part; }
  const ended = l.status === 'scattered' || l.status === 'abandoned';
  const struck = l.status === 'struck';
  const fallenM = struck ? l.fallen * TOWER_TIER_M : 0;
  return {
    halves, rises,
    scaffold: l.status === 'rising',
    piles: l.status === 'rising',
    fire: l.status === 'finished',
    crumbled: ended || struck,
    scorched: struck,
    // the fallen tiers' volume heaped round the base (a low wide ring: it never clears)
    moundR: struck ? b0 * (1.25 + 0.05 * Math.min(6, l.fallen)) : 0,
    moundH: struck ? Math.min(16, 3 + fallenM * 0.12) : 0,
    top: y,
  };
}

/** the tower's mesh (body-frame: +Y up, the stair on +Z); deterministic in its look */
export function towerMesh(l: TowerLook): BuildingMesh {
  const s = towerShape(l);
  const k = new KitBuilder();
  const base = BASE[l.material] ?? BASE.mudbrick;
  const tint = STYLE_TINT[l.style & 7];
  let col: RGB = [base.col[0] * tint[0], base.col[1] * tint[1], base.col[2] * tint[2]];
  // weathering: rain-streaked, darker and greyer with the years
  col = mixc(col, AGED, 0.12 * l.weather);
  const surf = base.surf;
  const em: Emitter[] = [];
  const n = s.halves.length;
  const rnd = (i: number, j = 0): number => hashFloat(l.id, i, j, 0x70f1);
  const uv0 = k.vertexCount;
  let y = 0;
  for (let i = 0; i < n; i++) {
    const b = s.halves[i], rise = s.rises[i];
    const t = b * 0.965;
    const isTop = i === n - 1;
    const y0 = i === 0 ? -6 : y, y1 = y + rise;
    let c = mulc(col, 1 - 0.03 * (i % 2));
    if (s.scorched && isTop) c = mixc(c, SOOT, 0.7);
    else if (s.scorched && i === n - 2) c = mixc(c, SOOT, 0.4);
    else if (s.scorched) c = mixc(c, SOOT, 0.18);
    if (s.crumbled && isTop && rise >= 3) {
      // the crumbled top: the lower part whole, the rest a broken crown of uneven blocks
      const keep = rise * 0.45;
      frustum(k, b, b - (b - t) * 0.45, y0, y + keep, surf, PART.wall, c, mulc(c, 0.85), l.id * 13 + i);
      const nb = 10;
      for (let q = 0; q < 4; q++) {
        k.push(0, 0, 0, (q * Math.PI) / 2);
        for (let j = 0; j < nb; j++) {
          const x0 = -b + (2 * b * j) / nb, x1 = x0 + (2 * b) / nb * 0.92;
          const hgt = (rise - keep) * (0.15 + 0.85 * rnd(i * 31 + q * 7 + j, 1));
          k.box(x0, y + keep - 0.2, b * 0.78, x1, y + keep + hgt, b * 0.97, surf, PART.wall, mulc(c, 0.92 + 0.1 * rnd(j, q)), { skip: ['bottom'], aoLow: 0.8 });
        }
        k.pop();
      }
    } else {
      frustum(k, b, t, y0, y1, surf, PART.wall, c, mulc(c, 0.86), l.id * 13 + i);
      // a coping course round the terrace edge
      for (let q = 0; q < 4; q++) {
        k.push(0, 0, 0, (q * Math.PI) / 2);
        k.beam([-t, y1 + 0.25, t - 0.4], [t, y1 + 0.25, t - 0.4], 0.8, 0.5, surf, PART.trim, mulc(c, 0.8), 0.9);
        // buttress rhythm on the face (the recessed niches of a brick face)
        const nbt = Math.max(4, Math.floor((2 * b) / 6));
        for (let j = 1; j < nbt; j++) {
          const x = -b + (2 * b * j) / nbt;
          if (q === 0 && Math.abs(x) < stairHalf(l.goal) + 1.2) continue;
          k.beam([x, y0 + 0.1, b + 0.25], [x * (t / b), y1 - 0.1, t + 0.25], 1.1, 0.5, surf, PART.wall, mulc(c, 1.06), 0.95);
        }
        k.pop();
      }
    }
    // the stair up this tier's front face, from the terrace (or the ground) in front
    if (!(s.crumbled && isTop)) {
      const sw = stairHalf(l.goal);
      const zTop = t - 0.3;
      const zFoot = i === 0 ? b + rise * 1.4 : Math.min(s.halves[i - 1] * 0.965 - 0.6, b + rise * 0.7);
      const steps = Math.max(4, Math.round(rise));
      const sc = mulc(c, 0.92);
      for (let j = 0; j < steps; j++) {
        const yi = y + ((j + 1) * rise) / steps, zi = zFoot - (j * (zFoot - zTop)) / steps;
        k.box(-sw, (i === 0 && j === 0 ? -2 : y), zTop - 1, sw, yi, zi, surf, PART.wall, sc, { skip: ['bottom', 'nz'], aoLow: 0.75 });
      }
      for (const sx of [-1, 1]) k.beam([sx * (sw + 0.5), y + 0.4, zFoot + 0.4], [sx * (sw + 0.5), y1 + 0.6, zTop], 1.0, 1.6, surf, PART.trim, mulc(c, 1.03), 0.9);
    }
    y = y1;
  }
  // the tiers' masonry at its monumental scale: the surface's blocks / bricks ×2.2, so the coursing still reads at
  // 150-400 m instead of fading to a flat wall
  k.scaleUv(1 / 2.2, uv0);
  const top = y;
  const tb = n ? s.halves[n - 1] * 0.965 : towerBaseHalf(l.goal);
  if (s.scaffold && n) {
    // timber scaffold round the top tier: standards, ledgers every 2 m, two ladders
    const yb = n > 1 ? top - s.rises[n - 1] : 0, yt = top + 2.4;
    const r = s.halves[n - 1] + 1.6;
    const per = Math.max(3, Math.round((2 * r) / 4.5));
    for (let q = 0; q < 4; q++) {
      k.push(0, 0, 0, (q * Math.PI) / 2);
      for (let j = 0; j <= per; j++) {
        const x = -r + (2 * r * j) / per;
        k.beam([x, yb, r], [x, yt, r], 0.22, 0.22, SURF.logs, PART.frame, TIMBER, 0.9);
      }
      for (let yy = yb + 2; yy <= yt; yy += 2) k.beam([-r, yy, r], [r, yy, r], 0.16, 0.16, SURF.logs, PART.frame, mulc(TIMBER, 0.9), 0.9);
      k.pop();
    }
    for (const sx of [-0.55, 0.4]) {
      const x = sx * r, z0 = r + 2.2;
      for (const d of [-0.3, 0.3]) k.beam([x + d, yb, z0], [x + d, yt, r + 0.2], 0.09, 0.09, SURF.logs, PART.frame, TIMBER, 0.9);
      for (let yy = yb + 0.4; yy < yt; yy += 0.4) {
        const f = (yy - yb) / (yt - yb), z = z0 + (r + 0.2 - z0) * f;
        k.beam([x - 0.3, yy, z], [x + 0.3, yy, z], 0.06, 0.06, SURF.logs, PART.frame, TIMBER, 0.9);
      }
    }
    // dust off the work
    em.push({ p: [0, top + 1, 0], kind: EMIT.smoke, size: 2.2 });
  }
  if (s.piles) {
    // brick piles at the foot (stacks of the tower's own brick), either side of the stair
    const b0 = towerBaseHalf(l.goal);
    for (let j = 0; j < 6; j++) {
      const a = (j < 3 ? 0.3 : -0.3) + (rnd(j, 5) - 0.5) * 0.25;
      const rr = b0 + 6 + rnd(j, 6) * 8;
      const x = Math.sin(a) * rr + (j < 3 ? 10 : -10), z = Math.cos(a) * rr;
      const w = 1.6 + rnd(j, 7), hh = 0.8 + rnd(j, 8) * 0.8;
      k.push(x, 0, z, rnd(j, 9) * Math.PI);
      k.box(-w, -0.3, -w * 0.6, w, hh, w * 0.6, surf, PART.prop, mulc(col, 0.95), { skip: ['bottom'], aoLow: 0.7 });
      k.pop();
    }
  }
  if (s.fire) {
    // the summit fire: a stone bowl on the top terrace, burning every night
    k.lathe(0, 0, [[tb * 0.12, top], [tb * 0.26, top + 1.4], [tb * 0.3, top + 1.6], [tb * 0.26, top + 1.65]], 12, surf, PART.trim, mulc(col, 0.8), 0.8, 1);
    k.quad([-tb * 0.22, top + 1.5, tb * 0.22], [tb * 0.22, top + 1.5, tb * 0.22], [tb * 0.22, top + 1.5, -tb * 0.22], [-tb * 0.22, top + 1.5, -tb * 0.22], SURF.ember, PART.hot, [0.05, 0.03, 0.02], 0.8);
    em.push({ p: [0, top + 1.8, 0], kind: EMIT.brazier, size: Math.max(1.5, tb * 0.25) });
  }
  if (s.moundR > 0) {
    // the fallen tiers: a ragged, scorched rubble heap round the base (never a neat ring): an outer skirt of charred
    // spill and ash, the heap itself with lobes where whole faces came down, and broken blocks and slabs of the
    // tower's own masonry thrown and tilted on it
    const b0 = towerBaseHalf(l.goal), R = s.moundR, H = s.moundH;
    const ph = l.id * 1.7;
    const lobes = (a: number, y: number, amp: number): number =>
      amp * (0.55 * Math.sin(2 * a + ph) + 0.3 * Math.sin(5 * a + 2.3 * ph) + 0.18 * Math.sin(11 * a + y * 0.4 + ph));
    let from = k.vertexCount;
    k.lathe(0, 0, [[R * 1.18, -1.6], [R * 1.1, 0.25], [R * 1.02, H * 0.3]], 40, SURF.rubble, PART.wall, mixc(col, SOOT, 0.94), 0.7, 0.9);
    k.jitterRadial(from, 0, 0, (a, y) => lobes(a, y, R * 0.1));
    from = k.vertexCount;
    // (closed over the middle by its crown: with every tier down it is one heap, never a ring round an empty floor)
    k.lathe(0, 0, [[R * 1.04, -1], [R * 0.9, H * 0.4], [(R + b0) * 0.5, H], [b0 * 0.6, H * 0.85]], 40, SURF.rubble, PART.wall, mixc(col, SOOT, 0.8), 0.7, 1);
    k.jitterRadial(from, 0, 0, (a, y) => lobes(a, y, R * 0.12) * Math.min(1, Math.max(0.3, 1 - y / (H * 1.6))));
    // its crown (not jittered: the apex stays closed)
    k.lathe(0, 0, [[b0 * 0.75, H * 0.8], [b0 * 0.35, H * 1.05], [0.01, H * 1.12]], 24, SURF.rubble, PART.wall, mixc(col, SOOT, 0.86), 0.8, 1);
    // every tier down: a broken stump of the first tier's walls stands out of the heap (ragged courses 2-8 m high,
    // sooted), and the crown is strewn with the fallen masonry too: a fallen tower, not a smooth barrow
    if (n === 0) {
      const sb = b0 * 0.8, nb = 12;
      for (let q = 0; q < 4; q++) {
        k.push(0, 0, 0, (q * Math.PI) / 2);
        for (let j = 0; j < nb; j++) {
          if (rnd(q * 17 + j, 21) < 0.22) continue;
          const x0 = -sb + (2 * sb * j) / nb, x1 = x0 + ((2 * sb) / nb) * (0.75 + 0.2 * rnd(j, q + 22));
          const hgt = H * 0.6 + (2 + 6 * rnd(q * 17 + j, 23)) * (0.5 + 0.5 * Math.abs(Math.sin(j * 0.9 + q)));
          k.box(x0, 0, sb - 3.5, x1, hgt, sb, surf, PART.wall, mixc(col, SOOT, 0.35 + 0.5 * rnd(j, q + 24)), { skip: ['bottom'], aoLow: 0.7 });
        }
        k.pop();
      }
      for (let j = 0; j < 60; j++) {
        const a = rnd(j, 31) * Math.PI * 2, rr = b0 * 0.85 * Math.sqrt(rnd(j, 32));
        const sz = 1.2 + rnd(j, 33) * 2.6;
        const yy = H * (1.12 - 0.3 * (rr / b0)) * (0.85 + 0.2 * rnd(j, 34));
        const dir = rnd(j, 35) * Math.PI * 2, tip = (0.15 + 0.7 * rnd(j, 36)) * (rnd(j, 37) < 0.5 ? -1 : 1), long = sz * (rnd(j, 38) < 0.3 ? 2.4 : 1.2);
        const hx = Math.cos(dir) * Math.cos(tip) * long * 0.5, hy = Math.sin(tip) * long * 0.5, hz = Math.sin(dir) * Math.cos(tip) * long * 0.5;
        const x = Math.cos(a) * rr, z = Math.sin(a) * rr;
        k.beam([x - hx, yy - hy, z - hz], [x + hx, yy + hy, z + hz], sz * (0.8 + 0.5 * rnd(j, 39)), sz * (0.45 + 0.4 * rnd(j, 40)), surf, PART.wall, mixc(col, SOOT, 0.3 + 0.65 * rnd(j, 41)), 0.75);
      }
    }
    for (let j = 0; j < 70; j++) {
      const a = rnd(j, 11) * Math.PI * 2, rr = b0 + (R * 1.15 - b0) * (0.1 + 0.85 * rnd(j, 12));
      const sz = 1.4 + rnd(j, 13) * 3.2;
      const yy = Math.max(0.3, H * (0.35 + 0.55 * (1 - Math.abs((rr - (R + b0) * 0.5) / (R - b0 + 1e-3))))) + lobes(a, 0, 0.6);
      const x = Math.cos(a) * (rr + lobes(a, 0, R * 0.1)), z = Math.sin(a) * (rr + lobes(a, 0, R * 0.1));
      // a block's long axis in a hashed direction, tipped 10-50 degrees: thrown down, not laid
      const dir = rnd(j, 14) * Math.PI * 2, tip = (0.18 + 0.7 * rnd(j, 16)) * (rnd(j, 17) < 0.5 ? -1 : 1);
      const long = rnd(j, 18) < 0.25 ? sz * 2.6 : sz * 1.2;
      const hx = Math.cos(dir) * Math.cos(tip) * long * 0.5, hy = Math.sin(tip) * long * 0.5, hz = Math.sin(dir) * Math.cos(tip) * long * 0.5;
      const bc = mixc(col, SOOT, 0.35 + 0.6 * rnd(j, 15));
      k.beam([x - hx, yy - hy, z - hz], [x + hx, yy + hy, z + hz], sz * (0.8 + 0.5 * rnd(j, 19)), sz * (0.45 + 0.4 * rnd(j, 20)), surf, PART.wall, bc, 0.75);
    }
  }
  const b0 = Math.max(towerBaseHalf(l.goal), s.moundR);
  const hz = b0 + (n ? s.rises[0] * 1.4 : 0);
  return { geo: k.build() as BufferGeometry, height: Math.max(top, s.moundH, 1), hx: b0, hz, ext: [-b0, b0, -b0, hz], emitters: em };
}

/** the stair's half width (m) */
function stairHalf(goal: number): number { return Math.max(2.2, towerBaseHalf(goal) * 0.07); }

/**
 * A battered tier: four sloping faces from half width b at y0 to t at y1, and its terrace. The faces are laid in
 * courses ~1.6 m high, each a hashed shade of the brick (every fifth a darker bond course), so the masonry reads as
 * coursed work from a distance, not one flat face.
 */
function frustum(k: KitBuilder, b: number, t: number, y0: number, y1: number, surf: number, part: number, col: RGB, topCol: RGB, seed = 0): void {
  const rows = Math.max(1, Math.round((y1 - y0) / 1.6));
  for (let q = 0; q < 4; q++) {
    k.push(0, 0, 0, (q * Math.PI) / 2);
    for (let r = 0; r < rows; r++) {
      const fa = r / rows, fb = (r + 1) / rows;
      const ya = y0 + (y1 - y0) * fa, yb = y0 + (y1 - y0) * fb;
      const ha = b + (t - b) * fa, hb = b + (t - b) * fb;
      let tone = 0.93 + 0.13 * hashFloat(seed, r, q, 0x70f3);
      if ((r + seed) % 5 === 4) tone *= 0.86;
      const aa = 0.62 + 0.33 * fa, ab = 0.62 + 0.33 * fb;
      k.quad([-ha, ya, ha], [ha, ya, ha], [hb, yb, hb], [-hb, yb, hb], surf, part, mulc(col, tone), [aa, aa, ab, ab]);
    }
    k.pop();
  }
  k.quad([-t, y1, t], [t, y1, t], [t, y1, -t], [-t, y1, -t], surf, part, topCol, 0.9);
}

/** a placed tower (Buildings keeps these; one instance each) */
export interface TowerRec {
  id: number;
  key: string;
  mesh: BuildingMesh;
  /** body-frame matrix (column-major, like Buildings' records) */
  m: Float32Array;
  px: number; py: number; pz: number;
  ux: number; uy: number; uz: number;
  seed: number;
  status: TowerView['status'];
  ended: number;
}

/** the facing of a tower's stair: toward its host town when the view has it, else a stable hashed yaw */
export function towerYaw(t: TowerView, hostDir: V3 | null): number {
  if (!hostDir) return hashFloat(t.id, 0x70f2) * Math.PI * 2;
  const l = Math.hypot(t.pos[0], t.pos[1], t.pos[2]) || 1;
  const ux = t.pos[0] / l, uy = t.pos[1] / l, uz = t.pos[2] / l;
  // tangent east / north at the tower (the convention of Buildings.place: east = Y × p)
  let ex = uz, ez = -ux;
  const el = Math.hypot(ex, ez) || 1;
  ex /= el; ez /= el;
  const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
  const dx = hostDir[0] - ux, dy = hostDir[1] - uy, dz = hostDir[2] - uz;
  const e = dx * ex + dz * ez, nn = dx * nx + dy * ny + dz * nz;
  return Math.hypot(e, nn) < 1e-9 ? 0 : Math.atan2(e, nn);
}
