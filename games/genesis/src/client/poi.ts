// GENESIS — points of interest found from a planet's fields, for camera presets (`?cam=coast`, the test surface's
// camera({ poi })) and the opening. Works on whatever the sim sends (or lookdev), deterministic for given fields:
//   coast   — low land beside open sea, looking out to sea
//   valley  — a river among high ground, looking up the valley toward the highest peak in view
//   peak    — the highest ground
//   town    — the most worn ground (roads, settlements)
//   forest  — dense canopy on gentle ground
//   desert  — the widest sand
// Returns body-frame lat/lon (degrees) and a heading (degrees from north toward east).

import type { PlanetView } from './worldview.ts';
import { tangentBasis } from '../sim/core/vec3.ts';

export interface Poi { lat: number; lon: number; heading: number; cell: number }

const DEG = 180 / Math.PI;

function headingTo(pv: PlanetView, from: number, to: number): number {
  const P = pv.grid.pos;
  const p = [P[from * 3], P[from * 3 + 1], P[from * 3 + 2]];
  const e: [number, number, number] = [0, 0, 0], n: [number, number, number] = [0, 0, 0];
  tangentBasis(e, n, p);
  const d = [P[to * 3] - p[0], P[to * 3 + 1] - p[1], P[to * 3 + 2] - p[2]];
  return Math.atan2(d[0] * e[0] + d[1] * e[1] + d[2] * e[2], d[0] * n[0] + d[1] * n[1] + d[2] * n[2]) * DEG;
}

function latlon(pv: PlanetView, c: number): { lat: number; lon: number } {
  const P = pv.grid.pos;
  return { lat: Math.asin(Math.max(-1, Math.min(1, P[c * 3 + 1]))) * DEG, lon: Math.atan2(P[c * 3], P[c * 3 + 2]) * DEG };
}

export function findPoi(pv: PlanetView, kind: string): Poi | null {
  const g = pv.grid;
  const N = g.count;
  const s = pv.fields.get('surface');
  if (!s) return null;
  const w = pv.fields.get('water');
  const temp = pv.fields.get('temperature');
  const cloud = pv.fields.get('cloud');
  const P = g.pos;
  const near = (c: number, angle: number) => g.cellsWithin(P[c * 3], P[c * 3 + 1], P[c * 3 + 2], angle);
  const R = pv.params.radius;
  let best = -1, bestScore = -Infinity, look = -1;
  const tropicPref = (c: number) => 1 - Math.abs(g.lat[c]) / 1.3;
  switch (kind) {
    case 'peak': {
      for (let c = 0; c < N; c++) if (s[c] > bestScore) { bestScore = s[c]; best = c; }
      if (best < 0) return null;
      // look toward the lowest ground in a 1.5 km radius (a view down the range)
      let lo = Infinity;
      for (const o of near(best, 1500 / R)) if (s[o] < lo) { lo = s[o]; look = o; }
      break;
    }
    case 'coast': {
      if (!w) return null;
      for (let c = 0; c < N; c += 3) {
        if (w[c] > 0.05 || s[c] < 1 || s[c] > 25) continue;
        let sea = 0;
        for (let e = g.nbrStart[c]; e < g.nbrStart[c + 1]; e++) if (w[g.nbr[e]] > 3) sea++;
        if (!sea) continue;
        // prefer coasts with hills behind them and open water in front, away from the poles
        let hills = 0, water = 0;
        for (const o of near(c, 700 / R)) { if (s[o] > 40) hills++; if (w[o] > 4) water++; }
        const score = Math.min(hills, 30) * 0.6 + Math.min(water, 60) * 0.4 + tropicPref(c) * 20;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (best < 0) return null;
      // look across the deepest nearby water
      let deep = -1;
      for (const o of near(best, 900 / R)) if (w[o] > deep) { deep = w[o]; look = o; }
      break;
    }
    case 'westcoast': {
      // a coast whose open water lies to the west: the sun sets over the sea
      if (!w) return null;
      const g2 = pv.grid;
      for (let c = 0; c < N; c += 2) {
        if (w[c] > 0.05 || s[c] < 0.5 || s[c] > 18) continue;
        if (temp && temp[c] < 8) continue; // no frozen shores for a sunset
        let sea = 0;
        for (let e = g2.nbrStart[c]; e < g2.nbrStart[c + 1]; e++) if (w[g2.nbr[e]] > 2) sea++;
        if (!sea) continue;
        let deep = -1, lookC = -1;
        for (const o of near(c, 900 / R)) if (w[o] > deep) { deep = w[o]; lookC = o; }
        if (lookC < 0) continue;
        const hd = headingTo(pv, c, lookC);
        const west = Math.abs(((hd + 90 + 540) % 360) - 180);
        if (west > 40) continue;
        let water = 0, clouds = 0;
        for (const o of near(c, 800 / R)) if (w[o] > 3) water++;
        // clouds out over the sea catch the sunset
        if (cloud) for (const o of near(lookC, 900 / R)) if (cloud[o] > 0.3) clouds++;
        const score = water - west * 0.5 + tropicPref(c) * 30 + Math.min(clouds, 50) * 1.2 - (cloud ? cloud[c] * 60 : 0);
        if (score > bestScore) { bestScore = score; best = c; look = lookC; }
      }
      if (best < 0) return findPoi(pv, 'coast');
      break;
    }
    case 'valley': {
      if (!w) return null;
      for (let c = 0; c < N; c += 2) {
        if (w[c] < 0.4 || w[c] > 6 || s[c] < 20) continue;
        if (temp && temp[c] < 2) continue;
        // river cell in high country: relief within ~800 m; clouds in view but not overhead
        let hi = -Infinity;
        let clouds = 0;
        for (const o of near(c, 1500 / R)) { if (s[o] > hi) hi = s[o]; if (cloud && cloud[o] > 0.35) clouds++; }
        const relief = hi - s[c];
        const overhead = cloud ? cloud[c] : 0;
        const score = relief + tropicPref(c) * 40 + Math.min(clouds, 60) * 1.5 - overhead * 120;
        if (relief > 90 && score > bestScore) { bestScore = score; best = c; }
      }
      if (best < 0) return findPoi(pv, 'peak');
      // look down-valley: toward the lowest wet ground 400–1200 m away (the river's way out)
      let lo = Infinity;
      for (const o of near(best, 1200 / R)) {
        const d = P[o * 3] * P[best * 3] + P[o * 3 + 1] * P[best * 3 + 1] + P[o * 3 + 2] * P[best * 3 + 2];
        if (Math.acos(Math.min(1, d)) * R < 400) continue;
        const v = s[o] - (w[o] > 0.3 ? 30 : 0);
        if (v < lo) { lo = v; look = o; }
      }
      break;
    }
    case 'town': {
      const road = pv.fields.get('road');
      if (!road) return null;
      for (let c = 0; c < N; c++) if (road[c] > bestScore) { bestScore = road[c]; best = c; }
      if (best < 0 || bestScore <= 0) return null;
      let hi = -Infinity;
      for (const o of near(best, 1200 / R)) if (s[o] > hi) { hi = s[o]; look = o; }
      break;
    }
    case 'forest': {
      const tree = pv.fields.get('tree');
      if (!tree) return null;
      for (let c = 0; c < N; c += 2) {
        if (tree[c] < 0.7) continue;
        let t = 0;
        for (const o of near(c, 400 / R)) t += tree[o];
        if (t > bestScore) { bestScore = t; best = c; }
      }
      if (best < 0) return null;
      let hi = -Infinity;
      for (const o of near(best, 1500 / R)) if (s[o] > hi) { hi = s[o]; look = o; }
      break;
    }
    case 'desert': {
      const sand = pv.fields.get('sand');
      if (!sand) return null;
      for (let c = 0; c < N; c += 2) if (sand[c] > bestScore && (!w || w[c] < 0.05)) { bestScore = sand[c]; best = c; }
      if (best < 0) return null;
      look = g.nbr[g.nbrStart[best]];
      break;
    }
    default:
      return null;
  }
  const ll = latlon(pv, best);
  return { lat: ll.lat, lon: ll.lon, heading: look >= 0 && look !== best ? headingTo(pv, best, look) : 0, cell: best };
}
