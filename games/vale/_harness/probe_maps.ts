// VALE probe — the three maps (content/maps/map_rift.json Hourfall, map_bridge.json Needlespan,
// map_fray.json Noonplate) loaded with the REAL content in the REAL sim. Lane CONTENT (maps).
//
// The catalog is built by the real tools/build_content.ts (check mode) from a temp tree:
//   _harness/fixtures/content_min  +  content/{modes,queues,ranks,units,team_buffs,roles,classes,
//   resources,vfx,audio}.json  +  content/maps/*.json  (+ content/fighters, skins, items, setup,
//   store, client, strings, bot_names when they exist; the fixture fighter stands in otherwise).
// So zod, cross-references, map coordinates, music ids and the deny-list names all run as in a
// real build. Missing art files (scene.glb, minimap.png, …) are expected at this stage.
//
// Per map:
//   * every base spawn / fountain / shop, FFA spawn, map shop, pickup, camp unit (its body) and
//     structure (its body + nav clearance disc) stands on walkable ground (walls only);
//   * nav paths (the sim's NavGrid.findPath, every structure standing as an obstacle) exist
//     waypoint by waypoint along every lane base → base, base → every camp, spawn → every pickup
//     and → the map shop; the end of each path is the goal itself (same nav component);
//   * lane centre-lines keep ≥ 3.6 m from every wall (the paved road is clear);
//   * structures: ids unique per team, `requires` same-team, acyclic, every structure reachable
//     from an unprotected outer Needle, terminals are the core or a Lantern (UNITS design §9.2: the
//     Bell Needles open on the Seat road's Lantern), protection order follows the road (what you
//     must kill first stands farther from your base), one core per team, lane ends within Wick
//     aggro range of the enemy core and every lane structure within aggro range of its lane;
//   * symmetry: Rift/Bridge mirror across x = W/2 (walls by nav cell, thickets, lanes, structures,
//     camps, pickups, bases); Fray: 10 hour-marks clockwise from 12 at one radius, walls 10-fold;
//   * walk times along each lane (fighter 3.45 m/s, Wick speed from units.json) and base → camps;
//   * sim: a bot-less wave run (fighters idle at home) — the first Wick-vs-Wick attack on every
//     lane happens at the lane's middle, structures spawn where placed, camps spawn on their
//     marks, pickups spawn, Fray seats spawn on their own hour-mark, the Lampwright cart sells,
//     practice dummies land on open ground.
//
// usage: node _harness/probe_maps.ts [--verbose] [--keep]      exit 0 PASS · 1 FAIL

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MapDef, type CatalogT, type MapDefT, type UnitDefT } from '../src/contracts/catalog.ts';
import type { MatchSetup, SeatSetup, SimEvent } from '../src/contracts/sim.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';
import { createSim } from '../src/sim/sim.ts';
import { NavGrid } from '../src/sim/nav.ts';
import { STRUCTURE_NAV_CLEARANCE } from '../src/sim/spawn.ts';
import { minionState } from '../src/sim/units/minions.ts';
import { killEntity } from '../src/sim/combat.ts';
import { pointInPolygon, polygonEdgeDist2 } from '../src/sim/math.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT = join(ROOT, 'content');
const FIX = join(ROOT, '_harness', 'fixtures', 'content_min');
const VERBOSE = process.argv.includes('--verbose');
const KEEP = process.argv.includes('--keep');

const FIGHTER_SPEED = 3.45;      // m/s, middle of VOCAB's calibration range 3.30–3.60
const ROAD_HALF = 3.6;           // m, paved half-width (render/terrain.ts LANE_HALF)
const MAP_IDS = ['map_rift', 'map_bridge', 'map_fray'] as const;

let checks = 0, failures = 0;
const notes: string[] = [];
function check(cond: unknown, what: string, detail?: unknown): boolean {
  checks++;
  if (cond) { if (VERBOSE) console.log(`  ok   ${what}`); return true; }
  failures++;
  console.log(`  FAIL ${what}${detail !== undefined ? `  ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  return false;
}
const info = (s: string): void => { console.log(`  ·    ${s}`); };
const f1 = (n: number): string => n.toFixed(1);
type V2 = readonly [number, number];
const dist = (a: V2, b: V2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
const polyLen = (p: readonly V2[]): number => p.slice(1).reduce((s, q, i) => s + dist(p[i], q), 0);

// ── 1. assemble the content tree and run the real content build ─────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'vale-probe-maps-'));
const tree = join(TMP, 'content');
cpSync(FIX, tree, { recursive: true });
const readJson = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
const asArr = (j: unknown, fam: string): Record<string, unknown>[] =>
  (Array.isArray(j) ? j : (j as Record<string, unknown>)[fam]) as Record<string, unknown>[];
const real = (f: string): string => join(CONTENT, f);
const put = (f: string, v: unknown): void => writeFileSync(join(tree, f), JSON.stringify(v, null, 1));

for (const f of ['modes.json', 'queues.json', 'ranks.json']) {
  if (!existsSync(real(f))) { console.log(`FAIL content/${f} is missing (the maps are probed with the real rules)`); process.exit(1); }
  cpSync(real(f), join(tree, f));
}
for (const [f, fam] of [['roles.json', 'roles'], ['classes.json', 'classes'], ['resources.json', 'resources'], ['vfx.json', 'vfx'],
  ['units.json', 'units'], ['team_buffs.json', 'teamBuffs']] as const) {
  const fx = asArr(readJson(join(tree, f)), fam);
  if (!existsSync(real(f))) continue;
  const mine = asArr(readJson(real(f)), fam);
  const ids = new Set(mine.map((r) => r.id));
  put(f, [...fx.filter((r) => !ids.has(r.id)), ...mine]);
}
if (existsSync(real('audio.json'))) {
  const a = readJson(join(tree, 'audio.json')) as { cues: object; music: object };
  const b = readJson(real('audio.json')) as { cues: object; music: object };
  put('audio.json', { cues: { ...a.cues, ...b.cues }, music: { ...a.music, ...b.music } });
}
// whole-file families: the real file when it exists
for (const f of ['items.json', 'setup.json', 'store.json', 'client.json', 'strings.en.json', 'bot_names.json', 'version.json']) {
  if (existsSync(real(f))) cpSync(real(f), join(tree, f));
}
const realFighters = existsSync(real('fighters')) && readdirSync(real('fighters')).some((f) => f.endsWith('.json'));
if (realFighters) {
  rmSync(join(tree, 'fighters'), { recursive: true, force: true });
  rmSync(join(tree, 'skins'), { recursive: true, force: true });
  cpSync(real('fighters'), join(tree, 'fighters'), { recursive: true });
  if (existsSync(real('skins'))) cpSync(real('skins'), join(tree, 'skins'), { recursive: true });
}
if (!existsSync(real('items.json'))) {   // fixture items/spells/boons: sell in every pool
  const it = asArr(readJson(join(tree, 'items.json')), 'items');
  for (const x of it) x.pools = [];
  put('items.json', it);
}
if (!existsSync(real('setup.json'))) {
  const s = readJson(join(tree, 'setup.json')) as { spells: Record<string, unknown>[]; boons: Record<string, unknown>[] };
  for (const x of [...s.spells, ...s.boons]) x.pools = [];
  put('setup.json', s);
}
const modesRaw = asArr(readJson(join(tree, 'modes.json')), 'modes');
if (!existsSync(real('client.json'))) {
  const c = readJson(join(tree, 'client.json')) as { modeSlots: unknown[]; home: { feature: { cta: { params: Record<string, string> } } } };
  c.modeSlots = [...modesRaw.map((m) => ({ mode: m.id, status: 'live' })), { mode: null, status: 'reserved', label: 'Reserved', note: 'A new mode will be cut here.' }];
  if (c.home.feature.cta.params.mode !== undefined) c.home.feature.cta.params.mode = String(modesRaw[0].id);
  put('client.json', c);
}
rmSync(join(tree, 'maps'), { recursive: true, force: true });
cpSync(join(CONTENT, 'maps'), join(tree, 'maps'), { recursive: true });

console.log('content build (tools/build_content.ts --check on the merged tree)');
const build = () => buildContent({
  ...defaultOptions({ contentDir: tree, designDir: join(ROOT, '_design') }),
  artOutDir: join(ROOT, 'art', 'out'), audioOutDir: join(ROOT, 'audio', 'out'),
  check: true, allowMissingAssets: true, quiet: true,
});
let built = build();
// Another lane's whole-file family (items, setup, store, client, strings, bot names, fighters, skins)
// with build errors is not this probe's subject: it is swapped back to the fixture (and reported), so
// the maps are still checked against the real rules. Errors in the maps or the rules they are
// probed with (modes, queues, ranks, units, team buffs, roles, classes, resources, vfx, audio) fail.
const SWAPPABLE: Record<string, string[]> = {
  'items.json': ['items.json'], 'setup.json': ['setup.json'], 'store.json': ['store.json'], 'client.json': ['client.json'],
  'strings.en.json': ['strings.en.json'], 'bot_names.json': ['bot_names.json'], fighters: ['fighters', 'skins', 'store.json'], skins: ['fighters', 'skins', 'store.json'],
};
for (let round = 0; round < 4 && built.errors.length; round++) {
  const rel = (f: string): string => f.startsWith(tree) ? f.slice(tree.length + 1) : f;
  const bad = new Set(built.errors.map((e) => rel(e.file).split(/[\\/]/)[0]));
  const swap = [...bad].filter((f) => SWAPPABLE[f]);
  if (swap.length === 0 || swap.length < bad.size) break;
  for (const f of swap) {
    const n = built.errors.filter((e) => rel(e.file).split(/[\\/]/)[0] === f).length;
    notes.push(`note: content/${f} has ${n} build error${n === 1 ? '' : 's'} (another lane's file, e.g. "${built.errors.find((e) => rel(e.file).startsWith(f))!.msg.slice(0, 120)}"); the probe used the fixture ${SWAPPABLE[f].join(' + ')} instead`);
    for (const g of SWAPPABLE[f]) {
      rmSync(join(tree, g), { recursive: true, force: true });
      cpSync(join(FIX, g), join(tree, g), { recursive: true });
      if (g === 'items.json') { const it = asArr(readJson(join(tree, g)), 'items'); for (const x of it) x.pools = []; put(g, it); }
      if (g === 'setup.json') { const st = readJson(join(tree, g)) as { spells: Record<string, unknown>[]; boons: Record<string, unknown>[] }; for (const x of [...st.spells, ...st.boons]) x.pools = []; put(g, st); }
      if (g === 'client.json') {
        const c = readJson(join(tree, g)) as { modeSlots: unknown[]; home: { feature: { cta: { params: Record<string, string> } } } };
        c.modeSlots = [...modesRaw.map((m) => ({ mode: m.id, status: 'live' })), { mode: null, status: 'reserved', label: 'Reserved', note: 'A new mode will be cut here.' }];
        if (c.home.feature.cta.params.mode !== undefined) c.home.feature.cta.params.mode = String(modesRaw[0].id);
        put(g, c);
      }
    }
  }
  built = build();
}
for (const n of notes) console.log(`  ·    ${n}`);
const assetWarn = built.warnings.filter((w) => w.msg.startsWith('asset not found'));
const mapAssetWarn = assetWarn.filter((w) => w.path.startsWith('maps'));
for (const w of built.warnings) if (!w.msg.startsWith('asset not found') && VERBOSE) info(`warn ${w.file} ${w.path}: ${w.msg}`);
for (const e of built.errors) console.log(`  error ${e.file} ${e.path}: ${e.msg}`);
check(built.errors.length === 0 && built.catalog, `build: ${built.errors.length} errors (names checked: ${built.namesChecked})`);
info(`${assetWarn.length} missing-asset warnings (${mapAssetWarn.length} in maps: ${[...new Set(mapAssetWarn.map((w) => w.msg.match(/"([^"]+)"/)?.[1]))].join(', ')})`);
if (!built.catalog) { finish(); }
const cat = built.catalog as CatalogT;
const fighterId = cat.fighters[0].id;
const skinId = cat.skins.find((s) => s.fighter === fighterId)!.id;
info(`fighter for the sim runs: ${fighterId}${fighterId.startsWith('fx_') ? ' (fixture)' : ''}`);
const unit = (id: string): UnitDefT => cat.units.find((u) => u.id === id)!;

// ── 2. per-map static checks ───────────────────────────────────────────────────────────────────
function stripComments(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripComments);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => !k.startsWith('$')).map(([k, x]) => [k, stripComments(x)]));
  return v;
}

function navOf(m: MapDefT, structures: boolean): NavGrid {
  const nav = NavGrid.fromMap(m);
  if (structures) for (const s of m.structures) nav.addObstacle(s.at[0], s.at[1], unit(s.unit).collisionRadius + STRUCTURE_NAV_CLEARANCE);
  return nav;
}
/** a body of radius r at p clear of walls (centre + 16 rim samples) */
function footprintFree(nav: NavGrid, p: V2, r: number): boolean {
  if (!nav.wallFree(p[0], p[1])) return false;
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    if (!nav.wallFree(p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r)) return false;
  }
  return true;
}
/** the open point of a shop circle nearest to `from` (null: the circle holds no open ground) */
function shopPoint(nav: NavGrid, s: { at: readonly number[]; radius: number }, from: V2): V2 | null {
  if (nav.wallFree(s.at[0], s.at[1])) return [s.at[0], s.at[1]];
  const d = dist(from, s.at as V2);
  const ux = d > 1e-6 ? (from[0] - s.at[0]) / d : 0, uy = d > 1e-6 ? (from[1] - s.at[1]) / d : -1;
  for (let r = 0.25; r < s.radius - 0.2; r += 0.25) {
    const p: V2 = [s.at[0] + ux * r, s.at[1] + uy * r];
    if (nav.wallFree(p[0], p[1])) return p;
  }
  for (let a = 0; a < 360; a += 10) for (let r = 0.5; r < s.radius - 0.2; r += 0.25) {
    const p: V2 = [s.at[0] + Math.cos(a * Math.PI / 180) * r, s.at[1] + Math.sin(a * Math.PI / 180) * r];
    if (nav.wallFree(p[0], p[1])) return p;
  }
  return null;
}
interface Route { ok: boolean; len: number; end: V2; why?: string }
function route(nav: NavGrid, a: V2, b: V2): Route {
  const out: number[] = [];
  const ok = nav.findPath(a[0], a[1], b[0], b[1], out);
  if (!ok || out.length < 2) return { ok: false, len: Infinity, end: a, why: 'no path' };
  let len = 0, px = a[0], py = a[1];
  for (let i = 0; i < out.length; i += 2) { len += Math.hypot(out[i] - px, out[i + 1] - py); px = out[i]; py = out[i + 1]; }
  const end: V2 = [px, py];
  const same = nav.componentAt(a[0], a[1]) === nav.componentAt(b[0], b[1]) || !nav.walkable(b[0], b[1]);
  const reached = dist(end, b) < 0.8 && same;
  return { ok: reached, len, end, why: reached ? undefined : `ends at (${f1(px)}, ${f1(py)}), ${f1(dist(end, b))} m short` };
}
function routeChain(nav: NavGrid, pts: readonly V2[]): Route {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const r = route(nav, pts[i], pts[i + 1]);
    if (!r.ok) return { ok: false, len: Infinity, end: r.end, why: `leg ${i} (${pts[i].map(f1)} → ${pts[i + 1].map(f1)}): ${r.why}` };
    len += r.len;
  }
  return { ok: true, len, end: pts[pts.length - 1] };
}
function wallClearance(m: MapDefT, p: V2): number {
  let d2 = Infinity;
  for (const w of m.walls) {
    if (pointInPolygon(p[0], p[1], w as never)) return 0;
    d2 = Math.min(d2, polygonEdgeDist2(p[0], p[1], w as never));
  }
  return Math.sqrt(d2);
}
/** arc-length position of the projection of p on a polyline */
function project(path: readonly V2[], p: V2): { s: number; d: number } {
  let best = { s: 0, d: Infinity }, acc = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const L = dist(a, b);
    const t = L > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (L * L))) : 0;
    const q: V2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = dist(p, q);
    if (d < best.d) best = { s: acc + t * L, d };
    acc += L;
  }
  return best;
}
function segDistToPath(path: readonly V2[], p: V2): number { return project(path, p).d; }

function modeFor(mapId: string) { return cat.modes.find((x) => x.map === mapId)!; }
function coreIdsOf(m: MapDefT): Set<string> {
  const mode = modeFor(m.id);
  const core = mode?.rules.end.coreStructure;
  return new Set(m.structures.filter((s) => s.unit === core || s.id === core).map((s) => s.id));
}

function staticChecks(m: MapDefT): void {
  const W = m.size[0], H = m.size[1];
  const parsed = MapDef.safeParse(stripComments(readJson(join(CONTENT, 'maps', `${m.id}.json`))));
  check(parsed.success, `${m.id}: MapDef zod parse`, parsed.success ? undefined : parsed.error.issues.slice(0, 3));
  const nav = navOf(m, false);
  const navS = navOf(m, true);
  info(`${m.size[0]} × ${m.size[1]} m · nav ${nav.w} × ${nav.h} cells · ${m.walls.length} walls · ${m.thickets.length} thickets · ` +
    `${m.lanes.length} lanes · ${m.structures.length} structures · ${m.camps.length} camps · ${m.pickups.length} pickups · ${m.spawns.length} spawns`);

  // walkable placements
  const bad: string[] = [];
  for (const b of m.bases) {
    for (const [k, p] of [['spawn', b.spawn], ['fountain', b.fountain.at], ['shop', b.shop.at]] as const) if (!nav.wallFree(p[0], p[1])) bad.push(`base ${b.team} ${k}`);
  }
  m.spawns.forEach((p, i) => { if (!footprintFree(nav, p, 0.6)) bad.push(`spawn ${i}`); });
  // a map shop needs open ground inside its circle (the Lampwright's cart itself may be solid)
  m.shops.forEach((s, i) => { if (!shopPoint(nav, s, s.at as V2)) bad.push(`shop ${i}`); });
  for (const p of m.pickups) if (!footprintFree(nav, p.at, unit(p.unit).collisionRadius)) bad.push(`pickup ${p.id}`);
  for (const c of m.camps) for (const u of c.units) if (!footprintFree(nav, u.at, unit(u.unit).collisionRadius)) bad.push(`camp ${c.id}/${u.unit}`);
  for (const s of m.structures) if (!footprintFree(nav, s.at, unit(s.unit).collisionRadius)) bad.push(`structure ${s.id}`);
  for (const t of m.thickets) {
    const cx = t.reduce((a, p) => a + p[0], 0) / t.length, cy = t.reduce((a, p) => a + p[1], 0) / t.length;
    if (!nav.wallFree(cx, cy)) bad.push(`thicket at (${f1(cx)}, ${f1(cy)})`);
  }
  const placed = m.bases.length * 3 + m.spawns.length + m.shops.length + m.pickups.length + m.camps.reduce((a, c) => a + c.units.length, 0) + m.structures.length + m.thickets.length;
  check(bad.length === 0, `${m.id}: all ${placed} placements (bases, spawns, shops, pickups, camp bodies, structure bodies, thickets) on open ground`, bad);

  // lanes clear of walls, paths along lanes (structures standing)
  const minion = cat.units.find((u) => u.id === (modeFor(m.id)?.rules.minionWaves?.composition[0]?.unit ?? 'shieldwick'));
  const wickSpeed = minion?.base.moveSpeed ?? 3.25;
  const laneLen: Record<string, number> = {};
  for (const l of m.lanes) {
    const path = l.path as V2[];
    let minC = Infinity, at: V2 = path[0];
    const L = polyLen(path);
    for (let s = 0; s <= L; s += 0.25) {
      let acc = 0;
      for (let i = 0; i < path.length - 1; i++) {
        const d = dist(path[i], path[i + 1]);
        if (acc + d >= s || i === path.length - 2) {
          const t = d > 0 ? Math.min(1, (s - acc) / d) : 0;
          const p: V2 = [path[i][0] + (path[i + 1][0] - path[i][0]) * t, path[i][1] + (path[i + 1][1] - path[i][1]) * t];
          const c = wallClearance(m, p);
          if (c < minC) { minC = c; at = p; }
          break;
        }
        acc += d;
      }
    }
    check(minC >= ROAD_HALF, `${m.id}: lane ${l.id} keeps ≥ ${ROAD_HALF} m from walls (min ${f1(minC)} m at ${at.map(f1).join(', ')})`);
    // the Wicks' line runs clear of every structure's nav disc on its road (structures stand at the road edge)
    const onLine = m.structures.filter((s) => s.lane === l.id && segDistToPath(path, s.at) < unit(s.unit).collisionRadius + STRUCTURE_NAV_CLEARANCE + 0.5).map((s) => s.id);
    check(onLine.length === 0, `${m.id}: lane ${l.id} centre line passes ≥ 0.5 m clear of its structures' nav discs`, onLine);
    const r = routeChain(navS, path);
    check(r.ok, `${m.id}: nav path along lane ${l.id} base → base (structures standing)`, r.why);
    laneLen[l.id] = r.len;
    // spawn to enemy spawn through this lane
    const b0 = m.bases.find((b) => b.team === 0), b1 = m.bases.find((b) => b.team === 1);
    let full = r.len;
    if (b0 && b1) {
      const a = route(navS, b0.spawn, path[0]), z = route(navS, path[path.length - 1], b1.spawn);
      full += a.len + z.len;
    }
    info(`lane ${l.id}: path ${f1(L)} m, nav ${f1(r.len)} m → fighter ${f1(r.len / FIGHTER_SPEED)} s, Wick ${f1(r.len / wickSpeed)} s; spawn → enemy spawn ${f1(full)} m = ${f1(full / FIGHTER_SPEED)} s`);
  }
  if (m.lanes.length) {
    const lens = Object.values(laneLen);
    const tMin = Math.min(...lens) / FIGHTER_SPEED, tMax = Math.max(...lens) / FIGHTER_SPEED;
    const [lo, hi] = m.lanes.length >= 3 ? [34, 56] : [26, 46];
    check(tMin >= lo && tMax <= hi, `${m.id}: lane walk times ${f1(tMin)}–${f1(tMax)} s within ${lo}–${hi} s (fighter, base → base)`);
    if (m.lanes.length >= 3) check(Math.max(...lens) / Math.min(...lens) <= 1.4, `${m.id}: longest road ≤ 1.4 × the shortest (${(Math.max(...lens) / Math.min(...lens)).toFixed(2)})`);
  }

  // base → camps, spawns → pickups / shops
  const homes: { name: string; at: V2 }[] = m.bases.length ? m.bases.map((b) => ({ name: `base ${b.team}`, at: b.spawn as V2 })) : m.spawns.map((p, i) => ({ name: `hour-mark ${i + 1}`, at: p as V2 }));
  const unreached: string[] = [];
  let campMax = 0, campMaxName = '';
  for (const h of homes) {
    for (const c of m.camps) {
      const r = route(navS, h.at, c.units[0].at);
      if (!r.ok) unreached.push(`${h.name} → camp ${c.id}: ${r.why}`);
      else if (h.name === 'base 0' && r.len > campMax) { campMax = r.len; campMaxName = c.id; }
    }
    for (const p of m.pickups) { const r = route(navS, h.at, p.at); if (!r.ok) unreached.push(`${h.name} → pickup ${p.id}: ${r.why}`); }
    for (const [i, s] of m.shops.entries()) {
      const goal = shopPoint(navS, s, h.at);
      const r = goal ? route(navS, h.at, goal) : { ok: false, why: 'no open ground in the shop circle' };
      if (!r.ok) unreached.push(`${h.name} → shop ${i}: ${r.why}`);
    }
  }
  const nRoutes = homes.length * (m.camps.length + m.pickups.length + m.shops.length);
  check(unreached.length === 0, `${m.id}: ${nRoutes} nav paths home → camps / pickups / shops exist`, unreached.slice(0, 6));
  if (m.camps.length) {
    const b0 = m.bases.find((b) => b.team === 0)!;
    const times = m.camps.filter((c) => !c.id.startsWith('s_')).map((c) => `${c.id} ${f1(route(navS, b0.spawn, c.units[0].at).len / FIGHTER_SPEED)} s`);
    info(`Aubade spawn → camps: ${times.join(' · ')} (farthest ${campMaxName} ${f1(campMax)} m)`);
  }
  if (m.spawns.length && m.shops.length) {
    const t = m.spawns.map((p) => route(navS, p, shopPoint(navS, m.shops[0], p)!).len / FIGHTER_SPEED);
    info(`hour-mark → Lampwright cart: ${f1(Math.min(...t))}–${f1(Math.max(...t))} s`);
  }

  // art landmarks (art.terrain.landmarks, the Blender brief): solid ones stand on wall cells or off
  // the map, and hide no open ground from the 52° camera beyond what a standard cliff (3.4 m, the
  // render's tallest wall) already hides; flush inlays may lie on open ground
  const lms = ((m.art.terrain as { landmarks?: { id: string; at: V2; size: V2; height: number; flush?: boolean }[] }).landmarks) ?? [];
  if (lms.length) {
    const solidBad: string[] = [];
    const isSolid = (x: number, y: number): boolean => x < 0 || y < 0 || x > m.size[0] || y > m.size[1] || !nav.wallFree(x, y);
    const HIDE = 1 / Math.tan(52 * Math.PI / 180);
    const CLIFF = 3.4 * HIDE;   // ground north of any wall that its cliff already hides
    const cliffHidden = (x: number, y: number): boolean => { for (let t = 0.25; t <= CLIFF + 1e-6; t += 0.25) if (isSolid(x, y + t)) return true; return false; };
    for (const l of lms) {
      if (l.flush) continue;
      const [w2, d2] = [l.size[0] / 2, l.size[1] / 2];
      const yTop = l.at[1] - d2 - l.height * HIDE;
      let ok = true;
      for (let y = yTop; y <= l.at[1] + d2 + 1e-6 && ok; y += 0.25) for (let x = l.at[0] - w2; x <= l.at[0] + w2 + 1e-6; x += 0.25) {
        const behind = y < l.at[1] - d2;
        if (!isSolid(x, y) && !(behind && cliffHidden(x, y))) { ok = false; solidBad.push(`${l.id} (open ground at ${f1(x)}, ${f1(y)}${behind ? ', hidden behind it' : ''})`); break; }
      }
    }
    check(solidBad.length === 0, `${m.id}: ${lms.filter((l) => !l.flush).length} solid landmarks stand on wall cells or off the map and hide no more open ground than a 3.4 m cliff (camera 52°)`, solidBad);
  }

  // structures: requires graph
  if (m.structures.length) structureChecks(m);

  // symmetry
  if (m.bases.length === 2) mirrorChecks(m, nav);
  else ringChecks(m, nav);
}

function structureChecks(m: MapDefT): void {
  const byId = new Map(m.structures.map((s) => [s.id, s]));
  const cores = coreIdsOf(m);
  const errs: string[] = [];
  for (const s of m.structures) for (const r of s.requires) {
    const q = byId.get(r);
    if (!q) errs.push(`${s.id} requires unknown ${r}`);
    else if (q.team !== s.team) errs.push(`${s.id} requires the other team's ${r}`);
  }
  // acyclic
  const state = new Map<string, number>();
  let cycle = '';
  const dfs = (id: string, stack: string[]): void => {
    if (state.get(id) === 2 || cycle) return;
    if (state.get(id) === 1) { cycle = [...stack, id].join(' → '); return; }
    state.set(id, 1);
    for (const r of byId.get(id)?.requires ?? []) dfs(r, [...stack, id]);
    state.set(id, 2);
  };
  for (const s of m.structures) dfs(s.id, []);
  check(errs.length === 0 && !cycle, `${m.id}: requires reference same-team structures and form no cycle`, cycle || errs);
  for (const team of [0, 1]) {
    const mine = m.structures.filter((s) => s.team === team);
    const coreOf = mine.filter((s) => cores.has(s.id));
    check(coreOf.length === 1, `${m.id}: team ${team} has exactly one core (${coreOf.map((s) => s.id).join(', ')})`);
    const requiredBy = new Map<string, string[]>();
    for (const s of mine) for (const r of s.requires) requiredBy.set(r, [...(requiredBy.get(r) ?? []), s.id]);
    const roots = mine.filter((s) => s.requires.length === 0);
    const terminals = mine.filter((s) => !requiredBy.has(s.id));
    check(roots.every((s) => s.unit === 'needle_outer' && !!s.lane), `${m.id}: team ${team} chains start at outer Needles on a lane (${roots.map((s) => s.id).join(', ')})`);
    check(terminals.every((s) => cores.has(s.id) || s.unit === 'lantern'), `${m.id}: team ${team} chains end at the core or a Lantern (${terminals.map((s) => s.id).join(', ')})`);
    // every structure ultimately requires a root; the core requires every road through its chain
    const down = (id: string, seen = new Set<string>()): Set<string> => {
      for (const r of byId.get(id)?.requires ?? []) if (!seen.has(r)) { seen.add(r); down(r, seen); }
      return seen;
    };
    const unrooted = mine.filter((s) => s.requires.length > 0 && ![...down(s.id)].some((x) => byId.get(x)!.requires.length === 0));
    check(unrooted.length === 0, `${m.id}: team ${team} every protected structure chains down to an outer Needle`, unrooted.map((s) => s.id));
    const core = coreOf[0];
    if (core) {
      const below = down(core.id);
      const chainStr = (id: string): string => { const s = byId.get(id)!; return s.requires.length ? `${id} ← ${s.requires.map(chainStr).join(' + ')}` : id; };
      check(below.size >= 4, `${m.id}: team ${team} core chain: ${chainStr(core.id)}`);
      // lane order: a structure that requires another stands closer to home (along its lane)
      const home = m.bases.find((b) => b.team === team)!.fountain.at as V2;
      const wrong: string[] = [];
      for (const s of mine) for (const r of s.requires) {
        const q = byId.get(r)!;
        if (dist(q.at, home) <= dist(s.at, home)) wrong.push(`${s.id} (${f1(dist(s.at, home))} m from home) requires ${r} (${f1(dist(q.at, home))} m)`);
      }
      check(wrong.length === 0, `${m.id}: team ${team} protection order follows the road (outer first, core last)`, wrong);
    }
  }
  // Wick reach: lane ends within aggro of the enemy core; lane structures within aggro of their lane
  const wickAggro = Math.min(...cat.units.filter((u) => u.kind === 'minion' && !u.behavior.dummy).map((u) => Number(u.behavior.aggroRange ?? 7)));
  const far: string[] = [];
  for (const l of m.lanes) {
    const p = l.path as V2[];
    for (const [team, end] of [[0, p[0]], [1, p[p.length - 1]]] as const) {
      const core = m.structures.find((s) => s.team === team && cores.has(s.id))!;
      const edge = dist(end, core.at) - unit(core.unit).collisionRadius;
      if (edge > wickAggro) far.push(`${l.id} end at team ${team}'s core: ${f1(edge)} m`);
    }
  }
  for (const s of m.structures) {
    if (!s.lane) {
      const near = m.lanes.some((l) => [l.path[0], l.path[l.path.length - 1]].some((e) => dist(e as V2, s.at) - unit(s.unit).collisionRadius <= wickAggro));
      if (!near) far.push(`${s.id}: no lane end within ${wickAggro} m`);
      continue;
    }
    const l = m.lanes.find((x) => x.id === s.lane)!;
    const d = segDistToPath(l.path as V2[], s.at) - unit(s.unit).collisionRadius;
    if (d > wickAggro) far.push(`${s.id}: ${f1(d)} m off its lane`);
  }
  check(far.length === 0, `${m.id}: Wicks reach every structure (lane ends ≤ ${wickAggro} m from the enemy core, lane structures ≤ ${wickAggro} m from their lane)`, far);
}

function mirrorChecks(m: MapDefT, nav: NavGrid): void {
  const W = m.size[0];
  const mx = (p: V2): V2 => [W - p[0], p[1]];
  const eq = (a: V2, b: V2, tol = 0.051): boolean => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
  // walls by nav cell
  let mism = 0, total = 0;
  for (let cy = 0; cy < nav.h; cy++) for (let cx = 0; cx < nav.w; cx++) {
    total++;
    if (nav.isBlockedCell(cx, cy) !== nav.isBlockedCell(nav.w - 1 - cx, cy)) mism++;
  }
  check(mism === 0, `${m.id}: walls mirror across x = ${W / 2} (${mism} of ${total} nav cells differ)`);
  // thickets by sample
  let tm = 0, tn = 0;
  const inT = (x: number, y: number): boolean => m.thickets.some((t) => pointInPolygon(x, y, t as never));
  // samples off the 0.1 m vertex grid, so no sample sits exactly on an edge
  for (let y = 0.3119; y < m.size[1]; y += 0.5) for (let x = 0.2371; x < W / 2; x += 0.5) {
    const a = inT(x, y), b = inT(W - x, y);
    if (a || b) { tn++; if (a !== b) tm++; }
  }
  check(tm === 0, `${m.id}: Needlegrass mirrors (${tm} of ${tn} samples differ)`);
  // lanes: mirrored + reversed = itself
  for (const l of m.lanes) {
    const p = l.path as V2[];
    const ok = p.every((q, i) => eq(mx(q), p[p.length - 1 - i]));
    check(ok, `${m.id}: lane ${l.id} is its own mirror (team 1 walks the same road)`);
  }
  // structures
  const twins: string[] = [];
  const twinOf = new Map<string, string>();
  for (const s of m.structures) {
    const t = m.structures.find((q) => q.team === 1 - s.team && q.unit === s.unit && eq(q.at, mx(s.at)) && q.lane === s.lane && q.respawn === s.respawn);
    if (!t) twins.push(s.id); else twinOf.set(s.id, t.id);
  }
  const reqOk = m.structures.every((s) => {
    const t = m.structures.find((q) => q.id === twinOf.get(s.id));
    return !t || [...s.requires].map((r) => twinOf.get(r)).sort().join() === [...t.requires].sort().join();
  });
  check(twins.length === 0 && reqOk, `${m.id}: every structure has a mirrored twin on the other team with mirrored requires`, twins);
  const campBad = m.camps.filter((c) => !m.camps.some((d) => d.units.length === c.units.length && d.firstSpawn === c.firstSpawn && d.respawn === c.respawn &&
    c.units.every((u) => d.units.some((v) => v.unit === u.unit && eq(v.at, mx(u.at)))))).map((c) => c.id);
  check(campBad.length === 0, `${m.id}: camps mirror (objective pits sit on the noon line)`, campBad);
  const pkBad = m.pickups.filter((p) => !m.pickups.some((q) => q.unit === p.unit && q.firstSpawn === p.firstSpawn && q.respawn === p.respawn && eq(q.at, mx(p.at)))).map((p) => p.id);
  check(pkBad.length === 0, `${m.id}: pickups mirror`, pkBad);
  const [b0, b1] = [m.bases.find((b) => b.team === 0)!, m.bases.find((b) => b.team === 1)!];
  check(eq(b1.spawn, mx(b0.spawn)) && eq(b1.fountain.at, mx(b0.fountain.at)) && eq(b1.shop.at, mx(b0.shop.at)) &&
    b0.fountain.radius === b1.fountain.radius && b0.shop.radius === b1.shop.radius && b0.spawn[0] < W / 2,
  `${m.id}: bases mirror (Aubade west / screen-left, Serenade east)`);
}

function ringChecks(m: MapDefT, nav: NavGrid): void {
  const C: V2 = [m.size[0] / 2, m.size[1] / 2];
  const r = m.spawns.map((p) => dist(p, C));
  const ang = m.spawns.map((p) => (Math.atan2(p[0] - C[0], -(p[1] - C[1])) * 180 / Math.PI + 360) % 360);
  const stepOk = ang.every((a, i) => Math.abs(((a - 36 * i) + 540) % 360 - 180) < 0.5);
  check(m.spawns.length === 10 && Math.max(...r) - Math.min(...r) < 0.15 && stepOk,
    `${m.id}: 10 hour-marks at one radius (${f1(r[0])} m), seat order clockwise from 12 in 36° steps`, ang.map((a) => a.toFixed(1)));
  check(m.shops.length >= 1 && m.shops.every((s) => dist(s.at, C) < 0.5), `${m.id}: the Lampwright cart stands at the plate centre`);
  // walls, exactly: the rim is one circle, and every block inside it turns into another block by 36°
  const onBorder = (w: readonly V2[]): boolean => w.some((p) => p[0] <= 0 || p[1] <= 0 || p[0] >= m.size[0] || p[1] >= m.size[1]);
  const rimR = m.walls.filter(onBorder).flatMap((w) => w.map((p) => dist(p, C)).filter((d) => d < Math.min(...C)));
  check(rimR.length > 0 && Math.max(...rimR) - Math.min(...rimR) < 0.25,
    `${m.id}: the plate rim is one circle (r ${f1(Math.min(...rimR))}–${f1(Math.max(...rimR))} m)`);
  const blocks = m.walls.filter((w) => !onBorder(w));
  const rot = (p: V2, deg: number): V2 => {
    const a = deg * Math.PI / 180, dx = p[0] - C[0], dy = p[1] - C[1];
    return [C[0] + dx * Math.cos(a) - dy * Math.sin(a), C[1] + dx * Math.sin(a) + dy * Math.cos(a)];
  };
  const unmatched = blocks.filter((b) => !blocks.some((o) => o.length === b.length && b.every((p) => o.some((q) => dist(rot(p, 36), q) < 0.15))));
  check(unmatched.length === 0, `${m.id}: the ${blocks.length} blocks on the plate repeat every 36° (every seat sees the same plate)`, unmatched.length);
  const inT = (x: number, y: number): boolean => m.thickets.some((t) => pointInPolygon(x, y, t as never));
  let tm = 0, tn = 0;
  for (let rr = 0.53; rr < 29.5; rr += 0.5) for (let a = 0.37; a < 360; a += 1) {
    const t = a * Math.PI / 180, u = (a + 36) * Math.PI / 180;
    const p = inT(C[0] + rr * Math.sin(t), C[1] - rr * Math.cos(t)), q = inT(C[0] + rr * Math.sin(u), C[1] - rr * Math.cos(u));
    if (p || q) { tn++; if (p !== q) tm++; }
  }
  check(tm / Math.max(1, tn) < 0.02, `${m.id}: Needlegrass repeats every 36° (${tm} of ${tn} samples differ: 0.1 m vertex rounding)`);
  // every hour-mark the same distance from its nearest pickups of each kind
  for (const kind of new Set(m.pickups.map((p) => p.unit))) {
    const d = m.spawns.map((s) => Math.min(...m.pickups.filter((p) => p.unit === kind).map((p) => dist(s, p.at))));
    info(`hour-mark → nearest ${kind}: ${f1(Math.min(...d))}–${f1(Math.max(...d))} m`);
  }
}

// ── 3. sim runs ────────────────────────────────────────────────────────────────────────────────
function seats(n: number, ffa: boolean): SeatSetup[] {
  return Array.from({ length: n }, (_, i) => ({
    player: i, team: ffa ? i : (i < n / 2 ? 0 : 1), name: `p${i}`, fighter: fighterId, skin: skinId,
    loadout: { spells: cat.setup.defaults.spells, boons: cat.setup.defaults.boons }, controller: 'bot' as const, colorIndex: i,
  }));
}
function setupFor(queue: string, extra: Partial<MatchSetup> = {}): MatchSetup {
  const q = cat.queues.find((x) => x.id === queue)!;
  const mode = cat.modes.find((x) => x.id === q.mode)!;
  const ffa = mode.perTeam === 1;
  return { matchId: `probe_maps_${queue}`, seed: 11, queue, mode: mode.id, map: mode.map, seats: seats(mode.teams * mode.perTeam, ffa), catalogVersion: cat.version, ...extra };
}

function waveRun(m: MapDefT, queue: string): void {
  const sim = createSim(cat, setupFor(queue), { pregameSeconds: 0 });
  const w = sim.world;
  const rules = w.rules;
  // structures where placed
  const ents = w.entities.filter((e) => e.kind === 'structure' && e.alive);
  const misplaced = m.structures.filter((s) => !ents.some((e) => e.def === s.unit && e.team === s.team && Math.hypot(e.x - s.at[0], e.y - s.at[1]) < 0.05));
  check(ents.length === m.structures.length && misplaced.length === 0, `${m.id}: sim spawns all ${m.structures.length} structures where placed`, misplaced.map((s) => s.id));
  // lane of a Wick: by its path's first point
  const laneByStart = new Map<string, string>();
  for (const l of m.lanes) {
    laneByStart.set(`0|${l.path[0][0]},${l.path[0][1]}`, l.id);
    const z = l.path[l.path.length - 1];
    laneByStart.set(`1|${z[0]},${z[1]}`, l.id);
  }
  const first = new Map<string, { t: number; x: number; y: number }>();
  const maxLane = Math.max(...m.lanes.map((l) => polyLen(l.path as V2[])));
  const wick = Math.min(...rules.minionWaves!.composition.map((c) => unit(c.unit).base.moveSpeed ?? 3.25));
  const meetBy = rules.minionWaves!.first + maxLane / 2 / wick + 12;
  // run until the Wicks met on every road, every camp (objectives included) and every pickup is due
  const campTimes = rules.jungle ? [...new Set(m.camps.map((c) => c.firstSpawn))].sort((a, b) => a - b) : [];
  const until = Math.max(meetBy, ...campTimes.map((t) => t + 1), ...m.pickups.map((p) => p.firstSpawn + 1));
  const campMiss: string[] = [];
  const campOk: string[] = [];
  let nextCamp = 0;
  let wavesStopped = false;
  for (let i = 0; i < Math.ceil(until * 30); i++) {
    // once every road has met, stop the waves (nobody defends in this run, and a match that ends
    // freezes the clock before the late objectives are due)
    if (!wavesStopped && w.time > meetBy) {
      wavesStopped = true;
      (w.ext['waves'] as { nextAt: number }).nextAt = Infinity;
      for (const e of w.entities) if (e.kind === 'minion' && e.alive) killEntity(w, e, null);
    }
    const ev: SimEvent[] = sim.step();
    for (const e of ev) {
      if (e.e !== 'attack') continue;
      const a = w.live(e.src), b = w.live(e.dst);
      if (!a || !b || a.kind !== 'minion' || b.kind !== 'minion' || a.team === b.team) continue;
      const st = minionState(a);
      if (!st) continue;
      const lane = laneByStart.get(`${a.team}|${st.path[0][0]},${st.path[0][1]}`);
      if (lane && !first.has(lane)) first.set(lane, { t: w.time, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    }
    while (nextCamp < campTimes.length && w.time > campTimes[nextCamp] + 0.2) {
      // just after a spawn time: every camp due now stands on its marks (nobody has pulled them)
      for (const c of m.camps.filter((c) => c.firstSpawn === campTimes[nextCamp])) {
        let ok = true;
        for (const u of c.units) {
          if (!w.entities.some((e) => e.kind === 'monster' && e.alive && e.def === u.unit && Math.hypot(e.x - u.at[0], e.y - u.at[1]) < 0.3)) { ok = false; campMiss.push(`${c.id}/${u.unit}`); }
        }
        if (ok) campOk.push(`${c.id}@${c.firstSpawn}s`);
      }
      nextCamp++;
    }
  }
  check(sim.faults.length === 0, `${m.id}: no sim faults`);
  for (const l of m.lanes) {
    const f = first.get(l.id);
    const path = l.path as V2[];
    const L = polyLen(path);
    if (!check(!!f, `${m.id}: Wicks meet on ${l.id}`)) continue;
    const pr = project(path, [f!.x, f!.y]);
    const off = pr.s / L - 0.5;
    check(Math.abs(off) <= 0.04 && Math.abs(f!.x - m.size[0] / 2) <= 4 && pr.d <= ROAD_HALF + 1,
      `${m.id}: ${l.id} first Wick clash at (${f1(f!.x)}, ${f1(f!.y)}), ${(100 * pr.s / L).toFixed(1)} % along the road, ${f1(pr.d)} m off its centre, at ${f1(f!.t)} s`);
  }
  if (m.camps.length && rules.jungle) {
    check(campMiss.length === 0 && campOk.length === m.camps.length, `${m.id}: all ${m.camps.length} camps spawned on their marks at firstSpawn (${campTimes.map((t) => `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`).join(", ")})`, { campMiss, campOk });
    const due = sim.view.objectives;
    if (VERBOSE) info(`objective timers at ${f1(w.time)} s: ${JSON.stringify(due)}`);
  }
  if (m.pickups.length) {
    const due = m.pickups.filter((p) => p.firstSpawn < until - 0.5);
    const miss = due.filter((p) => !w.entities.some((e) => e.kind === 'pickup' && e.alive && e.def === p.unit && Math.hypot(e.x - p.at[0], e.y - p.at[1]) < 0.05));
    check(miss.length === 0, `${m.id}: ${due.length} pickups due by ${Math.ceil(until)} s spawned where placed`, miss.map((p) => p.id));
  }
}

function frayRun(m: MapDefT): void {
  const sim = createSim(cat, setupFor('fray_standard'), { pregameSeconds: 0 });
  const w = sim.world;
  const off = w.players.filter(Boolean).filter((p) => { const s = m.spawns[p!.player % m.spawns.length]; return Math.hypot(p!.ent!.x - s[0], p!.ent!.y - s[1]) > 0.5; });
  check(off.length === 0, `${m.id}: every Fray seat spawns on its own hour-mark (seat I at 12 o'clock)`, off.map((p) => p!.player));
  for (let i = 0; i < 61.5 * 30; i++) sim.step();
  const miss = m.pickups.filter((p) => !w.entities.some((e) => e.kind === 'pickup' && e.alive && e.def === p.unit && Math.hypot(e.x - p.at[0], e.y - p.at[1]) < 0.05));
  check(miss.length === 0, `${m.id}: all ${m.pickups.length} Sunmotes spawned where placed by 1:01`, miss.map((p) => p.id));
  // the cart: a fighter standing at it can shop, one at an hour-mark cannot
  const e0 = w.players[0]!.ent!;
  const sp = shopPoint(w.nav, m.shops[0], [m.shops[0].at[0] + m.shops[0].radius, m.shops[0].at[1]])!;
  e0.x = sp[0]; e0.y = sp[1]; w.hashDirty = true;
  sim.step();
  const atCart = sim.view.players[0].canShop;
  const e1 = w.players[1]!.ent!;
  const atMark = sim.view.players[1].canShop;
  check(atCart && !atMark, `${m.id}: the Lampwright cart sells at the centre (canShop ${atCart}) and not on the rim (${atMark}, seat II at ${f1(e1.x)}, ${f1(e1.y)})`);
  check(sim.faults.length === 0, `${m.id}: no sim faults`);
}

function practiceRun(m: MapDefT): void {
  const q = cat.queues.find((x) => x.kind === 'practice');
  if (!q || cat.modes.find((x) => x.id === q.mode)?.map !== m.id) return;
  const sim = createSim(cat, setupFor(q.id, { practice: { dummies: 3 } }), { pregameSeconds: 0 });
  sim.step();
  const nav = navOf(m, true);
  const dummies = sim.world.entities.filter((e) => e.alive && e.unit?.behavior.dummy === true);
  const bad = dummies.filter((d) => !nav.wallFree(d.x, d.y));
  check(dummies.length === 3 && bad.length === 0, `${m.id}: practice dummies land on open ground in front of the base (${dummies.map((d) => `${f1(d.x)},${f1(d.y)}`).join(' · ')})`);
}

// ── run ──────────────────────────────────────────────────────────────────────────────────────────
for (const id of MAP_IDS) {
  const m = cat.maps.find((x) => x.id === id);
  console.log(`\n${id}${m ? ` (${m.name})` : ''}`);
  if (!check(m, `${id} is in the catalog`)) continue;
  const mode = modeFor(id);
  check(!!mode, `${id}: a mode plays on it (${mode?.id})`);
  staticChecks(m!);
  if (m!.lanes.length) waveRun(m!, cat.queues.find((q) => q.mode === mode!.id && q.kind === 'standard')!.id);
  else frayRun(m!);
  practiceRun(m!);
}
finish();

function finish(): never {
  if (!KEEP) rmSync(TMP, { recursive: true, force: true }); else console.log(`kept ${TMP}`);
  console.log(`\nprobe_maps: ${checks - failures}/${checks} checks passed`);
  console.log(failures ? 'FAIL' : 'PASS');
  process.exit(failures ? 1 : 0);
}
