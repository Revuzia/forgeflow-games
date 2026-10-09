// GENESIS — points of interest found from a planet's fields, for camera presets (`?cam=coast`, the test surface's
// camera({ poi })) and the opening. Works on whatever the sim sends (or lookdev), deterministic for given fields:
//   coast   — low land beside open sea, looking out to sea
//   valley  — a river among high ground, looking up the valley toward the highest peak in view
//   river   — flowing water (the sim's flow field) inland among trees, looking downstream
//   peak    — the highest ground
//   town    — the most worn ground (roads, settlements)
//   forest  — dense canopy on gentle ground
//   forest-edge — open meadow beside a dense wood, looking at the trees
//   farm    — the middle of the farmland of a settlement, looking toward the settlement
//   desert  — the widest sand
//   city / town / village / camp — the settlement of that size (largest population / iron+ era / bronze-clay / stone),
//   settlement-<era> — a settlement of that era, burning — the settlement with burning buildings, hive — a hive people;
//   homestead — a good place to set a people down; newest / settlement:<id> — a settlement by recency / id;
//   harbour — the busiest settlement's dock, from the water; farm:<id> — that settlement's own fields;
//   herd — the biggest herd of grazers on land; homestead-coast — a homestead with the sea in reach (coastal folk);
//   these look from just outside toward the settlement's centre (settlements first, the fields' guess as a fallback)
// Returns body-frame lat/lon (degrees) and a heading (degrees from north toward east).

import type { PlanetView } from './worldview.ts';
import { buildingAt } from '../render/life/catalog.ts';
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

/** a settlement POI: its centre, and a heading toward it from the side its streets open to */
function settlementPoi(pv: PlanetView, kind: string): Poi | null {
  const ss = pv.settlements;
  if (!ss || !ss.length) return null;
  const eraRank = (e: string) => ['stone', 'fire', 'clay', 'bronze', 'iron', 'classical', 'medieval', 'gunpowder', 'steam', 'electric', 'space'].indexOf(e);
  let pick = null as (typeof ss)[number] | null;
  if (kind === 'city') pick = ss.reduce((a, b) => (b.population > a.population ? b : a));
  else if (kind === 'town') pick = ss.filter((s) => eraRank(s.era) >= 4 && eraRank(s.era) <= 7).sort((a, b) => b.population - a.population)[0] ?? null;
  else if (kind === 'village') pick = ss.filter((s) => eraRank(s.era) >= 2 && eraRank(s.era) <= 3).sort((a, b) => b.population - a.population)[0] ?? null;
  else if (kind === 'camp') pick = ss.filter((s) => eraRank(s.era) <= 1 && s.species === ss[0].species).sort((a, b) => b.population - a.population)[0] ?? null;
  else if (kind.startsWith('settlement-')) pick = ss.filter((s) => s.era === kind.slice(11)).sort((a, b) => b.population - a.population)[0] ?? null;
  else if (kind === 'hive') pick = ss.find((s) => s.species !== ss[0].species) ?? null;
  else if (kind === 'burning') {
    const b = pv.buildings;
    if (!b) return null;
    const count = new Map<number, number>();
    for (let i = 0; i < b.count; i++) if (b.flags[i] & 1) count.set(b.settlement[i], (count.get(b.settlement[i]) ?? 0) + 1);
    let bestId = -1, bc = 0;
    for (const [id, n] of count) if (n > bc) { bc = n; bestId = id; }
    pick = ss.find((s) => s.id === bestId) ?? null;
  }
  if (!pick) return null;
  const c = pv.grid.nearestCell(pick.pos[0], pick.pos[1], pick.pos[2]);
  // look along the settlement's most-worn way out (its main street), toward the centre
  const road = pv.fields.get('road');
  let look = -1, bw = -1;
  if (road) for (let e = pv.grid.nbrStart[c]; e < pv.grid.nbrStart[c + 1]; e++) { const o = pv.grid.nbr[e]; if (road[o] > bw) { bw = road[o]; look = o; } }
  const ll = latlon(pv, c);
  // a burning settlement: look across it toward the fire front (the burning houses before the burning forest)
  const fire = kind === 'burning' ? pv.fields.get('fire') : undefined;
  if (fire) {
    const P = pv.grid.pos;
    let fx = 0, fy = 0, fz = 0, fw = 0;
    for (const o of pv.grid.cellsWithin(P[c * 3], P[c * 3 + 1], P[c * 3 + 2], 500 / pv.params.radius)) {
      if (fire[o] <= 0.05) continue;
      fx += P[o * 3] * fire[o]; fy += P[o * 3 + 1] * fire[o]; fz += P[o * 3 + 2] * fire[o]; fw += fire[o];
    }
    if (fw > 0) {
      const to = pv.grid.nearestCell(fx / fw, fy / fw, fz / fw);
      if (to !== c) return { lat: ll.lat, lon: ll.lon, heading: headingTo(pv, c, to), cell: c };
    }
  }
  return { lat: ll.lat, lon: ll.lon, heading: look >= 0 ? headingTo(pv, look, c) : 0, cell: c };
}

/** a settlement by id (`settlement:<id>`) or the newest one (`newest`): its centre, looking in along its main way */
function settlementById(pv: PlanetView, id: number | null): Poi | null {
  const ss = pv.settlements;
  if (!ss || !ss.length) return null;
  let pick = null as (typeof ss)[number] | null;
  if (id === null) { for (const s of ss) if (!(s.flags & 2) && (!pick || s.id > pick.id)) pick = s; }
  else pick = ss.find((s) => s.id === id) ?? null;
  if (!pick) return null;
  let at: ArrayLike<number> = pick.pos;
  // a band on the move, or a camp with nothing built yet: where its people are
  const A = pv.agents;
  const B = pv.buildings;
  let built = false;
  if (B) for (let i = 0; i < B.count && !built; i++) if (B.settlement[i] === pick.id) built = true;
  if (((pick.flags & 1) || !built) && A) {
    let x = 0, y = 0, z = 0, n = 0;
    for (let i = 0; i < A.count; i++) if (A.group[i] === pick.id) { x += A.pos[i * 3]; y += A.pos[i * 3 + 1]; z += A.pos[i * 3 + 2]; n++; }
    const l = Math.hypot(x, y, z);
    if (n && l > 0) at = [x / l, y / l, z / l];
  }
  const c = pv.grid.nearestCell(at[0], at[1], at[2]);
  const road = pv.fields.get('road');
  let look = -1, bw = -1;
  if (road) for (let e = pv.grid.nbrStart[c]; e < pv.grid.nbrStart[c + 1]; e++) { const o = pv.grid.nbr[e]; if (road[o] > bw) { bw = road[o]; look = o; } }
  const ll = latlon(pv, c);
  return { lat: ll.lat, lon: ll.lon, heading: look >= 0 && bw > 0.01 ? headingTo(pv, look, c) : 0, cell: c };
}

/**
 * A good place to set a people down (the god's "here" for `life.spawn-people` in shots and the opening): fresh water
 * within a short walk (a river or lake, not the sea), forage (grass and shrubs) and wood (trees) around it, gentle
 * ground, a mild climate, and room — well away from anyone already living there. The same ingredients the sim's own
 * site choice weighs (water, food, wood, slope, comfort, distance from others), so a band set down here settles fast.
 * Looks toward the water.
 */
export function homesteadCell(pv: PlanetView, coastal = false): { cell: number; look: number; score: number } {
  const g = pv.grid, N = g.count, R = pv.params.radius;
  const s = pv.fields.get('surface'), w = pv.fields.get('water');
  if (!s || !w) return { cell: -1, look: -1, score: -Infinity };
  const z = new Float32Array(N);
  const grass = pv.fields.get('grass') ?? z, shrub = pv.fields.get('shrub') ?? z, tree = pv.fields.get('tree') ?? z, fert = pv.fields.get('fertility') ?? z;
  const sal = pv.fields.get('salinity'), temp = pv.fields.get('temperature');
  const P = g.pos;
  const fresh = (c: number) => w[c] > 0.04 && w[c] < 4 && (!sal || sal[c] < 0.35) && (!temp || temp[c] > 1);
  const sea = (c: number) => w[c] > 4 || (sal ? sal[c] > 0.5 && w[c] > 0.3 : false);
  let best = -1, bs = -Infinity, look = -1;
  for (let c = 0; c < N; c++) {
    if (w[c] > 0.03 || s[c] < 1.5) continue;
    const t = temp ? temp[c] : 15;
    if (t < 8 || t > 30) continue;
    let water = 0, food = 0, wood = 0, slope = 0, wetC = -1, seaN = 0;
    const e0 = g.nbrStart[c], e1 = g.nbrStart[c + 1];
    for (let e = e0; e < e1; e++) {
      const o = g.nbr[e];
      if (fresh(o)) { water = 1; wetC = o; }
      if (sea(o)) seaN++;
      slope = Math.max(slope, Math.abs(s[o] - s[c]) / 50);
      for (let e2 = g.nbrStart[o]; e2 < g.nbrStart[o + 1]; e2++) {
        const q = g.nbr[e2];
        if (!water && fresh(q)) { water = 0.6; wetC = q; }
        if (sea(q)) seaN += 0.25;
        food += grass[q] * 0.4 + shrub[q] * 0.6;
        wood += tree[q];
      }
    }
    // coastal peoples want the sea within a short walk (fish, wetness); everyone else is kept off the beach
    if (water <= 0 || slope > 0.5 || (coastal ? seaN < 0.25 || seaN > 2.5 : seaN > 1.5)) continue;
    // a meadow to build on (not a beach, not the middle of the wood), a mild climate, and trees in reach: a site
    // without wood can never keep a fire (people/decide.ts gathers fuel only where trees grow)
    const sandC = pv.fields.get('sand')?.[c] ?? 0;
    let score = water * 3 + Math.min(4, food * 0.3) + Math.min(2, wood * 0.25) + fert[c] * 1.5 - slope * 3 - Math.abs(t - 17) * 0.1
      + grass[c] * 2 - Math.min(1.5, sandC) * 2 - Math.max(0, tree[c] - 0.3) * 4 + (coastal ? Math.min(1.5, seaN) * 1.2 : -seaN * 0.8)
      - (wood < 1 ? 3 : 0);
    // room: nobody within 700 m
    for (const st of pv.settlements) {
      const d = Math.acos(Math.min(1, st.pos[0] * P[c * 3] + st.pos[1] * P[c * 3 + 1] + st.pos[2] * P[c * 3 + 2])) * R;
      if (d < 700) score -= (700 - d) / 60;
    }
    if (score > bs) { bs = score; best = c; look = wetC; }
  }
  return { cell: best, look, score: bs };
}

export function findPoi(pv: PlanetView, kind0: string): Poi | null {
  let kind = kind0;
  let farmOf = -1;
  if (kind.startsWith('farm:')) { farmOf = Number(kind.slice(5)); kind = 'farm'; }
  if (kind === 'homestead' || kind === 'homestead-coast') {
    const h = homesteadCell(pv, kind === 'homestead-coast');
    if (h.cell < 0) return null;
    const ll = latlon(pv, h.cell);
    return { lat: ll.lat, lon: ll.lon, heading: h.look >= 0 ? headingTo(pv, h.cell, h.look) : 0, cell: h.cell };
  }
  if (kind === 'newest') return settlementById(pv, null);
  if (kind === 'herd') {
    // the biggest herd of grazers on land (not fish, birds or swarms), framed from its centre
    const M = pv.animals;
    if (!M || !M.count) return null;
    // members by group; a group can span several herds far apart (its mean then lands between them, at sea), so the
    // herd framed is a real cluster: the members within 60 m of the group's most central member
    const groups = new Map<number, number[]>();
    for (let i = 0; i < M.count; i++) {
      if (M.flags[i] & (4 | 8 | 16)) continue;
      const l = groups.get(M.group[i]);
      if (l) l.push(i); else groups.set(M.group[i], [i]);
    }
    const R = pv.params.radius;
    const water = pv.fields.get('water');
    const dryAt = (x: number, y: number, z: number) => !water || pv.grid.sample(water, x, y, z) < 0.05;
    let best: { n: number; x: number; y: number; z: number; members: number[] } | null = null;
    for (const l of groups.values()) {
      let mx = 0, my = 0, mz = 0;
      for (const i of l) { mx += M.pos[i * 3]; my += M.pos[i * 3 + 1]; mz += M.pos[i * 3 + 2]; }
      let seed = l[0], sd = Infinity;
      for (const i of l) { const d = Math.hypot(M.pos[i * 3] - mx / l.length, M.pos[i * 3 + 1] - my / l.length, M.pos[i * 3 + 2] - mz / l.length); if (d < sd) { sd = d; seed = i; } }
      const near = l.filter((i) => Math.hypot(M.pos[i * 3] - M.pos[seed * 3], M.pos[i * 3 + 1] - M.pos[seed * 3 + 1], M.pos[i * 3 + 2] - M.pos[seed * 3 + 2]) * R < 60);
      let x = 0, y = 0, z = 0;
      for (const i of near) { x += M.pos[i * 3]; y += M.pos[i * 3 + 1]; z += M.pos[i * 3 + 2]; }
      if (!best || near.length > best.n) best = { n: near.length, x: x / near.length, y: y / near.length, z: z / near.length, members: near };
    }
    if (!best) return null;
    let [px, py, pz] = [best.x, best.y, best.z];
    if (!dryAt(px, py, pz)) {
      // the centre is in water: frame the member on dry land nearest it
      let bd = Infinity;
      for (const i of best.members) {
        const x = M.pos[i * 3], y = M.pos[i * 3 + 1], z = M.pos[i * 3 + 2];
        if (!dryAt(x, y, z)) continue;
        const d = Math.hypot(x - best.x, y - best.y, z - best.z);
        if (d < bd) { bd = d; px = x; py = y; pz = z; }
      }
    }
    const c = pv.grid.nearestCell(px, py, pz);
    const ll = latlon(pv, c);
    return { lat: ll.lat, lon: ll.lon, heading: 0, cell: c };
  }
  if (kind === 'harbour') {
    // the dock of the most populous settlement that has one, seen from the water side looking back at the shore
    const B = pv.buildings;
    if (!B) return null;
    let best = -1, bp = -1;
    for (let i = 0; i < B.count; i++) {
      if (buildingAt(B.type[i]).kind !== 'dock') continue;
      const pop = pv.settlements.find((q) => q.id === B.settlement[i])?.population ?? 0;
      if (pop > bp) { bp = pop; best = i; }
    }
    if (best < 0) return null;
    const P = pv.grid.pos;
    const dc = pv.grid.nearestCell(B.pos[best * 3], B.pos[best * 3 + 1], B.pos[best * 3 + 2]);
    // stand off over the deepest water within ~120 m, facing the dock
    const w = pv.fields.get('water');
    let sea = dc, deep = -1;
    if (w) for (const o of pv.grid.cellsWithin(P[dc * 3], P[dc * 3 + 1], P[dc * 3 + 2], 120 / pv.params.radius)) if (w[o] > deep) { deep = w[o]; sea = o; }
    const ll = latlon(pv, dc);
    return { lat: ll.lat, lon: ll.lon, heading: sea !== dc ? headingTo(pv, sea, dc) : 0, cell: dc };
  }
  if (kind.startsWith('settlement:')) return settlementById(pv, Number(kind.slice(11)));
  if (kind === 'city' || kind === 'village' || kind === 'camp' || kind === 'burning' || kind === 'hive' || kind.startsWith('settlement-') || (kind === 'town' && pv.settlements?.length)) {
    const sp = settlementPoi(pv, kind);
    if (sp || kind !== 'town') return sp;
  }
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
    case 'river': {
      const fx = pv.fields.get('flowX'), fy = pv.fields.get('flowY'), fz = pv.fields.get('flowZ');
      const tree = pv.fields.get('tree');
      if (!w || !fx || !fy || !fz) return null;
      let bestFlow: [number, number, number] = [0, 0, 0];
      for (let c = 0; c < N; c++) {
        if (w[c] < 0.1 || w[c] > 8 || s[c] < 2) continue;
        if (temp && temp[c] < 1) continue;
        const f = Math.hypot(fx[c], fy[c], fz[c]); // m per tick
        if (f < 4) continue;
        // a river with trees on its banks and hills around, not out on the open shore
        let trees = 0, hi = -Infinity, wetN = 0;
        for (const o of near(c, 500 / R)) { if (tree) trees += tree[o]; if (s[o] > hi) hi = s[o]; if (w[o] > 0.1) wetN++; }
        const score = Math.min(f, 30) * 1.5 + Math.min(trees, 40) + Math.min(hi - s[c], 80) * 0.3 - wetN * 0.8 + tropicPref(c) * 15;
        if (score > bestScore) { bestScore = score; best = c; bestFlow = [fx[c], fy[c], fz[c]]; }
      }
      if (best < 0) return findPoi(pv, 'valley');
      // heading downstream: the flow vector in the cell's east/north frame
      const e: [number, number, number] = [0, 0, 0], n: [number, number, number] = [0, 0, 0];
      tangentBasis(e, n, [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]]);
      const hd = Math.atan2(bestFlow[0] * e[0] + bestFlow[1] * e[1] + bestFlow[2] * e[2], bestFlow[0] * n[0] + bestFlow[1] * n[1] + bestFlow[2] * n[2]) * DEG;
      const ll = latlon(pv, best);
      return { lat: ll.lat, lon: ll.lon, heading: hd, cell: best };
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
    case 'farm': {
      // the middle of the farmland nearest a settlement, looking toward the settlement over the fields
      // ('farm:<id>': that settlement's own fields — its territory)
      const crop0 = pv.fields.get('crop');
      const ss = pv.settlements;
      if (!crop0 || !ss?.length) return null;
      let crop = crop0;
      if (farmOf >= 0) {
        const terr = pv.fields.get('territory');
        const st = ss.find((q) => q.id === farmOf);
        if (!st) return null;
        crop = new Float32Array(N);
        const cs = g.cellsWithin(st.pos[0], st.pos[1], st.pos[2], 420 / R);
        for (const c of cs) if (!terr || Math.round(terr[c]) === farmOf) crop[c] = crop0[c];
      }
      // prefer the hemisphere where the crops stand in the fields now (summer into harvest)
      const yf = pv.params.dayOfYear / Math.max(1, pv.params.yearDays);
      // full fields where there are any; a young people's first plots (the live sim's crops start small) otherwise
      let maxCrop = 0;
      for (let c = 0; c < N; c++) if (crop[c] > maxCrop && !(w && w[c] > 0.02)) maxCrop = crop[c];
      const minCrop = Math.min(0.6, maxCrop * 0.6);
      if (maxCrop < 0.03) return null;
      for (let c = 0; c < N; c++) {
        if (crop[c] < minCrop || (w && w[c] > 0.02)) continue;
        let sum = 0;
        for (const o of near(c, 60 / R)) sum += crop[o];
        const yfH = P[c * 3 + 1] >= 0 ? yf : (yf + 0.5) % 1;
        const growing = yfH > 0.25 && yfH < 0.62 ? 1 : 0;
        const score = sum + growing * 100;
        if (score > bestScore) { bestScore = score; best = c; }
      }
      if (best < 0) return null;
      let bd = Infinity;
      for (const st of ss) {
        const d = 1 - (st.pos[0] * P[best * 3] + st.pos[1] * P[best * 3 + 1] + st.pos[2] * P[best * 3 + 2]);
        if (d < bd) { bd = d; look = g.nearestCell(st.pos[0], st.pos[1], st.pos[2]); }
      }
      break;
    }
    case 'forest-edge': {
      // open meadow on gentle ground facing a dense wood a stone's throw away: stand in the grass, look at the trees
      const tree = pv.fields.get('tree'), grass = pv.fields.get('grass'), road = pv.fields.get('road'), sand = pv.fields.get('sand');
      const crop = pv.fields.get('crop');
      if (!tree) return null;
      for (let c = 0; c < N; c++) {
        if (tree[c] > 0.12 || (w && w[c] > 0.02) || (road && road[c] > 0.3) || (grass && grass[c] < 0.45) || (sand && sand[c] > 0.12) || (crop && crop[c] > 0.1) || s[c] < 2) continue;
        let flat = 0, wet = false;
        let bestNb = -1, bt = 0;
        for (const o of near(c, 90 / R)) {
          flat = Math.max(flat, Math.abs(s[o] - s[c]));
          if (w && w[o] > 0.05) wet = true;
          if (tree[o] > bt) { bt = tree[o]; bestNb = o; }
        }
        // a meadow, not a beach or a lake shore
        if (wet) continue;
        if (bt < 0.6 || flat > 6) continue;
        const score = bt + (grass ? grass[c] : 0) * 0.5 - flat * 0.05 + tropicPref(c) * 0.2;
        if (score > bestScore) { bestScore = score; best = c; look = bestNb; }
      }
      if (best < 0) return null;
      break;
    }
    case 'desert': {
      // a real desert: deep sand, dry, and (almost) nothing growing — the sandiest cell alone can be a forested beach
      const sand = pv.fields.get('sand');
      if (!sand) return null;
      const tree = pv.fields.get('tree'), shrub = pv.fields.get('shrub'), grass = pv.fields.get('grass'), moist = pv.fields.get('moisture');
      const snow = pv.fields.get('snow');
      const at = (f: Float32Array | undefined, c: number) => (f ? f[c] : 0);
      for (let pass = 0; pass < 2 && best < 0; pass++) {
        for (let c = 0; c < N; c += 2) {
          if (w && w[c] >= 0.05) continue;
          // first look for a strict desert (real sand, dry, bare, not a polar snowfield: bare and dry alone also match
          // the ice caps); failing that, the driest, barest sand there is
          const veg = at(tree, c) + at(shrub, c) + at(grass, c);
          if (pass === 0 && (veg >= 0.15 || at(moist, c) >= 0.3 || sand[c] < 0.5 || at(snow, c) >= 0.05)) continue;
          // the widest sand, not a sandy clearing in a wood: the neighbours' bare sand counts as much as the cell's
          let around = 0;
          const e0 = g.nbrStart[c], e1 = g.nbrStart[c + 1];
          for (let e = e0; e < e1; e++) {
            const o = g.nbr[e];
            around += sand[o] - 2 * (at(tree, o) + at(shrub, o) + at(grass, o)) - 2 * at(snow, o) - (w && w[o] >= 0.05 ? 1 : 0);
          }
          const score = sand[c] + around / (e1 - e0) - (pass === 1 ? veg * 2 + at(moist, c) : 0);
          if (score > bestScore) { bestScore = score; best = c; }
        }
      }
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
