// probe_navtown.mjs - can a walker get street -> room -> street in EVERY room of the Savanna towns and compounds, planned by NavGrid.bakeTown and walked by the REAL mover?
// (Wave 7, lane 7D; the closed loop of lane 7B1's phase3.mjs promoted over bakeTown rects.)  NO browser, NO server, NO file edited.
//
//   node _harness/probe_navtown.mjs [--root <game dir>] [--vendor <three dir>] [--navgrid <navgrid.js>] [--maps ashgrid,isla_viva,deepwood] [--seeds 7,1234,2026] [--dists 25,16,34]
//                                   [--plant coarse-indoor] [--maxrooms N] [--out result.json]
// (Wave 7b, lane B2: every map's towns, compounds and bridge. `--map X` is still accepted for one map. A seed record carries its `map`; a map whose build has no M.city layout is
//  recorded with noCity, and navtown.py judges that as a FAIL on a blocking map. A layout with `bridges[]` (Riverside Mill) gets a BRIDGE half: the grid plans bank -> bank both
//  ways and the real mover walks the plan, see `bridgeWalk` below.)
//
// Per (map, seed): the UNMODIFIED maps.js builds the map (world gates' Node environment); its towngen layout (M.city.layout: towns + compounds) is baked with
// NavGrid.bakeTown(M.colliders, M.heightAt, rects, { waterY, portals }) - the way stage B composes the grid (only the coarse tiles that touch a town / compound rect +
// margin, every building inside as fine 0.75 m tiles). The rooms are found from the colliders with navcheck's own room survey (probe_rooms.js section B, ported verbatim in
// surveyRooms below: a roofed floor with >= 1.85 m of head room, connected cells, >= 3 cells) and kept when they lie inside a baked rect. For every room and every
// street start (an open, roof-free, wall-free ground point D metres away: D = 25 first, then 16, then 34; up to 4 starts inside the SAME rect) the probe asks the grid for
// a path in (start -> room) and out (room -> start) and then WALKS it with player.js's tick() (stepActor): steer at the next waypoint, advance at 0.55 m, give up after
// 2.5 s without progress. A walk "reaches" when the last waypoint is within 0.45 m.
//   planned   findPath returned a path that ends within 1.6 m (xz) / 1.8 m (y) of the goal
//   walked    the real mover arrived (counted over all walks; "of planned" is printed beside it)
// Rooms are classed by height over the terrain: ground (<= 1.5 m), upper (<= 7.5 m), top (above). A ROOM is reached when at least one of its streets gets a walker in
// AND (a walk of its own) out; the per-walk figures are printed too. Per town the bake's memory (tiles whose centre lies in the town's rect) is reported.
//
// --plant coarse-indoor  bakes with cellIndoor 3 m: no 1 m door fits a 3 m cell, so the rooms behind doors are unreachable (the control: every rate must collapse).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeEnv } from "./world_env.mjs";
import { loadPlayer, makeGameW as makeGameW0, makeMover as makeMover0, follow as follow0 } from "./mover_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root || path.join(HERE, ".."));
const MAPS = String(args.maps || args.map || "ashgrid").split(",").filter(Boolean);
const SEEDS = String(args.seeds || "7,1234,2026").split(",").filter(Boolean).map(Number);
const DISTS = String(args.dists || "25,16,34").split(",").filter(Boolean).map(Number);
const MAXROOMS = Number(args.maxrooms || 1e9);
const PLANT = args.plant || null;
const OUT = args.out || null;
const NAVGRID = path.resolve(args.navgrid || path.join(ROOT, "runtime", "sim", "navgrid.js"));
const STEP_UP = 0.55, R = 0.45, H = 1.8;

const E = await makeEnv({ root: ROOT, vendor: args.vendor });
const { buildMap } = await E.importMaps();
const req = createRequire(import.meta.url);
const NGmod = req(NAVGRID);
const NG = NGmod && NGmod.bakeTile ? NGmod : globalThis.FFG.sim.NavGrid;
if (!NG || !NG.bakeTown) { process.stderr.write("navgrid.js has no bakeTown (a Wave-6 module): nothing to measure\n"); process.exit(3); }
const THREE = E.THREE;
const Pmod = await loadPlayer(ROOT);
const warn = console.warn, log = console.log;
console.warn = () => {}; console.log = () => {};
const makeGameW = (M, seed) => makeGameW0(E, Pmod, M, seed);
const makeMover = (GW) => makeMover0(GW, THREE);
const follow = (mover, GW, start, wp) => follow0(Pmod, mover, GW, start, wp);

// ───────────── navcheck's room survey (probe_rooms.js section B) over the built map M ─────────────
function surveyRooms(M) {
  const cols = M.colliders;
  const colIdx = new Map(); cols.forEach((c, i) => colIdx.set(c, i));
  const qc = (x, z, r) => { const out = []; M.queryColliders(x, z, r, out); return out; };
  const rampTop = (c, x, z) => {
    let f;
    if (c.dir === 0) f = (x - c.minX) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 1) f = (c.maxX - x) / Math.max(0.01, c.maxX - c.minX);
    else if (c.dir === 2) f = (z - c.minZ) / Math.max(0.01, c.maxZ - c.minZ);
    else f = (c.maxZ - z) / Math.max(0.01, c.maxZ - c.minZ);
    return c.minY + (c.maxY - c.minY) * Math.min(1, Math.max(0, f));
  };
  const topAt = (c, x, z) => (c.kind === "ramp" ? rampTop(c, x, z) : c.maxY);
  const supportAt = (x, z, y, L) => {
    L = L || qc(x, z, 0.6);
    let s = M.heightAt(x, z), col = null;
    for (const c of L) {
      if (c.dead) continue;
      if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
      const top = topAt(c, x, z);
      if (top <= y + STEP_UP && top > s) { s = top; col = c; }
    }
    return { s, col };
  };
  const roofAt = (x, z, y, L) => {
    L = L || qc(x, z, 0.6);
    let best = null;
    for (const c of L) {
      if (c.dead || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.minY > y + 2.0 && c.minY < y + 12) { if (!best || c.minY < best.minY) best = c; }
    }
    return best;
  };
  const capsuleBlocked = (x, z, y, L) => {
    L = L || qc(x, z, 1.0);
    for (const c of L) {
      if (c.dead || c.kind === "ramp") continue;
      if (c.maxY <= y + STEP_UP || c.minY >= y + H) continue;
      const ex = x - Math.min(Math.max(x, c.minX), c.maxX), ez = z - Math.min(Math.max(z, c.minZ), c.maxZ);
      if (ex * ex + ez * ez < R * R) return c;
    }
    return null;
  };
  const wallDist = (x, z, y, L) => {
    L = L || qc(x, z, 2.0);
    let d = 99;
    for (const c of L) {
      if (c.dead || c.kind === "ramp") continue;
      if (c.maxY <= y + STEP_UP || c.minY >= y + H) continue;
      const ex = x - Math.min(Math.max(x, c.minX), c.maxX), ez = z - Math.min(Math.max(z, c.minZ), c.maxZ);
      d = Math.min(d, Math.sqrt(ex * ex + ez * ez));
    }
    return d;
  };
  const roofish = [];
  for (const c of cols) {
    if (c.kind === "ramp") continue;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    if (c.maxY - c.minY <= 1.6 && w * d >= 2 && w >= 1.0 && d >= 1.0) roofish.push(c);
  }
  const par = new Map(); roofish.forEach((c) => par.set(c, c));
  const find = (c) => { while (par.get(c) !== c) { par.set(c, par.get(par.get(c))); c = par.get(c); } return c; };
  const B = new Map(), BK = 8;
  roofish.forEach((c) => {
    for (let bx = Math.floor((c.minX - 0.5) / BK); bx <= Math.floor((c.maxX + 0.5) / BK); bx++)
      for (let bz = Math.floor((c.minZ - 0.5) / BK); bz <= Math.floor((c.maxZ + 0.5) / BK); bz++) {
        const k = bx * 100003 + bz; if (!B.has(k)) B.set(k, []); B.get(k).push(c);
      }
  });
  for (const l of B.values()) for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
    const a = l[i], b = l[j];
    if (a.maxX + 0.5 < b.minX || b.maxX + 0.5 < a.minX || a.maxZ + 0.5 < b.minZ || b.maxZ + 0.5 < a.minZ) continue;
    const ra = find(a), rb = find(b); if (ra !== rb) par.set(ra, rb);
  }
  const bldOf = (c) => (c && par.has(c) ? colIdx.get(find(c)) : -1);
  const pts = new Map();
  let pockets = 0;
  for (const Rf of roofish) {
    for (let x = Math.ceil(Rf.minX + 0.4); x <= Rf.maxX - 0.4; x += 1) for (let z = Math.ceil(Rf.minZ + 0.4); z <= Rf.maxZ - 0.4; z += 1) {
      const L = qc(x, z, 1.2);
      const terr = M.heightAt(x, z);
      let s = terr, sc = null;
      for (const c of L) {
        if (c.dead || c === Rf) continue;
        if (x < c.minX - 0.3 || x > c.maxX + 0.3 || z < c.minZ - 0.3 || z > c.maxZ + 0.3) continue;
        const top = topAt(c, x, z);
        if (top <= Rf.minY - 1.0 && top > s) { s = top; sc = c; }
      }
      if (sc && sc.prop) continue;
      if (Rf.minY - s > 12 || Rf.minY - s < 0.3) continue;
      let lower = false;
      for (const c of L) { if (c === Rf || c.dead) continue; if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue; if (c.minY > s + 0.3 && c.minY < Rf.minY - 1e-3) { lower = true; break; } }
      if (lower) continue;
      if (s <= terr + 1e-6 && terr < M.waterY + 0.3) continue;
      const head = Rf.minY - s;
      if (capsuleBlocked(x, z, s, L)) continue;
      if (head < 1.85) { pockets++; continue; }
      const key = x + "," + z + "," + Math.round(s * 2);
      if (!pts.has(key)) pts.set(key, { x, z, s, terr, bld: bldOf(Rf), key });
    }
  }
  const byXZ = new Map();
  for (const p of pts.values()) { const k = p.x + "," + p.z; if (!byXZ.has(k)) byXZ.set(k, []); byXZ.get(k).push(p); }
  const parent = new Map(); for (const p of pts.values()) parent.set(p, p);
  const find2 = (p) => { while (parent.get(p) !== p) { parent.set(p, parent.get(parent.get(p))); p = parent.get(p); } return p; };
  for (const p of pts.values()) for (const [dx, dz] of [[1, 0], [0, 1]]) {
    const l = byXZ.get((p.x + dx) + "," + (p.z + dz)); if (!l) continue;
    for (const q of l) if (Math.abs(q.s - p.s) <= 0.6) { const a = find2(p), b = find2(q); if (a !== b) parent.set(a, b); }
  }
  const groups = new Map();
  for (const p of pts.values()) { const r = find2(p); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); }
  const rooms = [];
  for (const g of groups.values()) {
    if (g.length < 3) continue;
    let cx = 0, cz = 0; for (const p of g) { cx += p.x; cz += p.z; } cx /= g.length; cz /= g.length;
    let rep = g[0], bd = 1e9; for (const p of g) { const d = Math.hypot(p.x - cx, p.z - cz); if (d < bd) { bd = d; rep = p; } }
    // height over the ground a walker stands on: a room on a dock over open water stands on the SURFACE (+0.9 m), not 3-5 m over the seabed (Wave 7b: Lagoon Docks was classed 'upper'); a dry map has waterY -999
    rooms.push({ x: rep.x, z: rep.z, s: rep.s, agl: +(rep.s - Math.max(rep.terr, M.waterY)).toFixed(2), n: g.length, bld: rep.bld });
  }
  rooms.sort((a, b) => a.x - b.x || a.z - b.z);
  const openPt = (x, z) => {
    if (Math.abs(x) > M.half - 15 || Math.abs(z) > M.half - 15) return null;
    const terr = M.heightAt(x, z);
    if (terr < M.waterY + 0.4) {
      // Wave 7b: over open water the street IS the deck: a thin slab 0.3-1.6 m over the surface (the Lagoon Docks boardwalk, a pier), roofless and clear of walls. A dock room 40-60 m out on a boardwalk has
      // no dry point within the 34 m reach; the planner and the real mover walk the deck like any street
      const L = qc(x, z, 0.6);
      let top = null;
      for (const c of L) {
        if (c.dead || c.kind === "ramp" || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ || c.maxY - c.minY > 1.2) continue;
        if (c.maxY >= M.waterY + 0.3 && c.maxY <= M.waterY + 1.6 && (top === null || c.maxY > top)) top = c.maxY;
      }
      if (top === null || roofAt(x, z, top) || wallDist(x, z, top) < 0.8) return null;
      return { x, z, y: top };
    }
    const sp = supportAt(x, z, terr + 0.2);
    if (sp.s > terr + 0.05) return null;
    if (roofAt(x, z, terr)) return null;
    if (wallDist(x, z, terr) < 0.8) return null;
    return { x, z, y: terr };
  };
  const startsFor = (r, D) => {
    const out = [];
    for (let k = 0; k < 8 && out.length < 4; k++) {
      const ang = k * Math.PI / 2 + (k >= 4 ? Math.PI / 4 : 0);
      const p = openPt(r.x + Math.cos(ang) * D, r.z + Math.sin(ang) * D);
      if (p) out.push(p);
    }
    return out;
  };
  return { rooms, roofish: roofish.length, pockets, startsFor };
}

const pct = (a, b) => (b ? Math.round(1000 * a / b) / 10 : null);
const res = { root: ROOT, navgrid: NAVGRID, maps: MAPS, plant: PLANT, dists: DISTS, seeds: [] };
for (const MAP of MAPS) for (const seed of SEEDS) {
  const M = await buildMap(E.makeW(seed), MAP);
  const rec = { map: MAP, seed, genVersion: M.genVersion, noCity: !M.city };
  if (!M.city) { res.seeds.push(rec); try { M.dispose && M.dispose(); } catch (e) { /* stub */ } continue; }
  const L = M.city.layout;
  const rects = [...L.towns, ...L.compounds];
  const ids = [...L.towns.map((t) => t.id), ...L.compounds.map((c) => c.id)];
  const cover = rects.map((r) => NG.rectOfLayout(r, 6));
  const bakeOpts = { waterY: M.waterY, portals: M.portals };
  if (PLANT === "coarse-indoor") bakeOpts.cellIndoor = 3.0;
  const t0 = process.hrtime.bigint();
  const town = NG.bakeTown(M.colliders, M.heightAt, rects, bakeOpts);
  const bakeMs = Number(process.hrtime.bigint() - t0) / 1e6;
  const st = NG.worldStats(town.world);
  Object.assign(rec, { towns: L.towns.length, compounds: L.compounds.length, tiles: town.world.slots.length, bakeMs: Math.round(bakeMs), done: town.done, MB: Math.round(st.bytes / 1048576 * 100) / 100 });
  const GW = await makeGameW(M, seed);
  const mover = makeMover(GW);
  const sv = surveyRooms(M);
  const where = (x, z) => { for (let i = 0; i < cover.length; i++) { const c = cover[i]; if (x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ) return i; } return -1; };
  const lvl = (r) => (r.agl > 7.5 ? "top" : r.agl > 1.5 ? "upper" : "ground");
  const tab = { ground: { rooms: 0, both: 0, walks: 0, plan: 0, walk: 0 }, upper: { rooms: 0, both: 0, walks: 0, plan: 0, walk: 0 }, top: { rooms: 0, both: 0, walks: 0, plan: 0, walk: 0 } };
  const unreached = [];
  // memory per town: the tiles whose centre lies in the town's rect
  const townMB = L.towns.map((t, i) => { let by = 0, n = 0; for (const T of NG.tiles(town.world)) { const cx = (T.minX + T.maxX) / 2, cz = (T.minZ + T.maxZ) / 2; const c = cover[i]; if (cx >= c.minX && cx <= c.maxX && cz >= c.minZ && cz <= c.maxZ) { by += T.stats.bytes; n++; } } return { id: t.id, tiles: n, MB: Math.round(by / 1048576 * 100) / 100 }; });
  const roomsIn = { in: { ground: [0, 0], upper: [0, 0], top: [0, 0] }, out: { ground: [0, 0], upper: [0, 0], top: [0, 0] } };
  const noplan = [], fails = [], noStart = [];
  const perPlace = {};
  const W = town.world;
  const nearPortal = (q) => (M.portals || []).some((p) => Math.hypot(p.x - q.x, p.z - q.z) < 3.2 && q.y - p.y > -1.2 && q.y - p.y < 3.6);
  let nr = 0, nTown = 0;
  const q0 = Date.now();
  for (const r of sv.rooms) {
    const ti = where(r.x, r.z);
    if (ti < 0) continue;
    nTown++;
    if (nr++ >= MAXROOMS) break;
    if (nearPortal({ x: r.x, y: r.s, z: r.z })) continue;
    const lv = lvl(r), b = tab[lv];
    b.rooms++;
    // streets: open points D m away that lie inside the SAME baked rect (outside it the grid knows nothing), the first D that gives any
    let st4 = [];
    for (const D of DISTS) {
      st4 = sv.startsFor(r, D).filter((q) => !nearPortal(q) && where(q.x, q.z) === ti);
      if (st4.length) break;
    }
    if (!st4.length) { b.noStart = (b.noStart || 0) + 1; if (noStart.length < 8) noStart.push({ place: ids[ti], room: [r.x, r.s, r.z].map((v) => +v.toFixed(1)) }); continue; }
    const pp = perPlace[ids[ti]] || (perPlace[ids[ti]] = { rooms: 0, walks: 0, planned: 0, walked: 0 });
    pp.rooms++;
    let anyIn = false, anyOut = false, whyNot = null;
    for (const s of st4) for (const dir of ["in", "out"]) {
      b.walks++; pp.walks++;
      const from = dir === "in" ? { x: s.x, y: s.y, z: s.z } : { x: r.x, y: r.s, z: r.z };
      const to = dir === "in" ? { x: r.x, y: r.s, z: r.z } : { x: s.x, y: s.y, z: s.z };
      const p = NG.findPath(W, from.x, from.y, from.z, to.x, to.y, to.z);
      const okPlan = p && p.length && Math.hypot(p[p.length - 1].x - to.x, p[p.length - 1].z - to.z) < 1.6 && Math.abs(p[p.length - 1].y - to.y) < 1.8;
      roomsIn[dir][lv][1]++;
      if (!okPlan) { whyNot = whyNot || (W.lastFail || "partial path"); if (noplan.length < 12) noplan.push({ dir, place: ids[ti], lvl: lv, room: [r.x, r.s, r.z].map((v) => +v.toFixed(1)), why: W.lastFail }); continue; }
      b.plan++; pp.planned++;
      const f = follow(mover, GW, from, p);
      if (f.ok) { b.walk++; pp.walked++; roomsIn[dir][lv][0]++; if (dir === "in") anyIn = true; else anyOut = true; }
      else if (fails.length < 20) fails.push({ dir, place: ids[ti], lvl: lv, from: [from.x, from.y, from.z].map((v) => +v.toFixed(1)), to: [to.x, to.y, to.z].map((v) => +v.toFixed(1)), why: f.why, wi: f.wi, of: f.of, at: f.at && f.at.map((v) => +v.toFixed(1)), toward: f.toward && f.toward.map((v) => +v.toFixed(1)), kinds: p.map((q) => q.k).join("") });
    }
    if (anyIn && anyOut) b.both++;
    else if (unreached.length < 16) unreached.push({ place: ids[ti], lvl: lv, room: [r.x, r.s, r.z].map((v) => +v.toFixed(1)), in: anyIn, out: anyOut, why: whyNot });
  }
  Object.assign(rec, { roomsFound: sv.rooms.length, roomsInTowns: nTown, queryWalkMs: Date.now() - q0, tab, walkedByDir: roomsIn, perPlace, noplan, fails, noStart, unreached, townMB });
  // ---- the BRIDGE half (Wave 7b): every layout bridge {x0, z0, x1, z1, len, width, deck} (Riverside Mill): the grid plans bank -> bank both ways, the real mover walks the plan ----
  {
    const bw = { bridges: 0, walks: 0, planned: 0, walked: 0, fails: [] };
    const dry = (x, z) => M.heightAt(x, z) > M.waterY + 0.4 && !(M.queryColliders ? (() => { const o = []; M.queryColliders(x, z, 0.6, o); return o.some((c) => !c.dead && c.kind !== "ramp" && x > c.minX - 0.5 && x < c.maxX + 0.5 && z > c.minZ - 0.5 && z < c.maxZ + 0.5 && c.maxY - c.minY > 0.6 && c.minY < M.heightAt(x, z) + 1.5); })() : false);
    for (const T of L.towns.concat(L.compounds)) for (const br of (T.bridges || [])) {
      bw.bridges++;
      const dx = br.x1 - br.x0, dz = br.z1 - br.z0, len = Math.hypot(dx, dz) || 1, ux = dx / len, uz = dz / len;
      const bank = (sx, sz, sgn) => { for (const d of [8, 11, 14, 18]) { const x = sx + sgn * ux * d, z = sz + sgn * uz * d; if (dry(x, z)) return { x, y: M.heightAt(x, z), z }; } return null; };
      const A = bank(br.x0, br.z0, -1), B = bank(br.x1, br.z1, 1);
      if (!A || !B) { bw.fails.push({ town: T.id, why: "no dry bank point 8-18 m past the bridge ends", len: +len.toFixed(1) }); continue; }
      for (const [from, to, dir] of [[A, B, "ab"], [B, A, "ba"]]) {
        bw.walks++;
        const p = NG.findPath(town.world, from.x, from.y, from.z, to.x, to.y, to.z);
        const okPlan = p && p.length && Math.hypot(p[p.length - 1].x - to.x, p[p.length - 1].z - to.z) < 1.6 && Math.abs(p[p.length - 1].y - to.y) < 1.8;
        if (!okPlan) { bw.fails.push({ town: T.id, dir, why: "no plan: " + (town.world.lastFail || "partial path"), len: +len.toFixed(1) }); continue; }
        bw.planned++;
        const f = follow(mover, GW, from, p);
        if (f.ok) bw.walked++; else bw.fails.push({ town: T.id, dir, why: "mover " + f.why, at: f.at && f.at.map((v) => +v.toFixed(1)), len: +len.toFixed(1) });
      }
    }
    rec.bridgeWalk = bw;
  }
  res.seeds.push(rec);
  try { M.dispose && M.dispose(); } catch (e) { /* the Node stub has nothing to free */ }
}
console.warn = warn; console.log = log;
if (OUT) fs.writeFileSync(OUT, JSON.stringify(res));
else process.stdout.write(JSON.stringify(res) + "\n");
process.exit(0);
