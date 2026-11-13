// homes.mjs - the Wave 10 R1A homes census (a port of F:/lc_p23/w10/audit/houses/census.mjs, the audit's own numbers): Node only, no browser, no file edited.
//
//   node _harness/p23/homes.mjs --root <game dir> --maps isla_viva,ashgrid,deepwood --seeds 1,7,1234,2026 --out <json> [--twice]
//
// Builds every map x seed with the UNMODIFIED <root>/runtime/3d/royale/maps.js (world_env.mjs) and writes one compact record per enterable building, per
// room of a home, plus per-build totals (loot, kit colliders vs the drawn kit box). homes.py judges the bars; this file only measures.
// A "home" = use house and not the ruin theme. "Substantive" = a piece whose drawn type is not filler (the audit's FILL list, stats2.cjs).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(arg("root", path.join(HERE, "..", "..")));
const MAPS = arg("maps", "isla_viva,ashgrid,deepwood").split(",");
const SEEDS = arg("seeds", "1,7,1234,2026").split(",").map(Number);
const OUT = arg("out", null);
const TWICE = argv.includes("--twice");
const { makeEnv } = await import(pathToFileURL(path.join(HERE, "..", "world_env.mjs")).href);
const E = await makeEnv({ root: ROOT, vendor: arg("vendor", null) || undefined });
const { buildMap } = await E.importMaps();
let HG = null;
const MAN = JSON.parse(fs.readFileSync(path.join(ROOT, "assets", "props", "city", "manifest.json"), "utf8"));
try { HG = await import(pathToFileURL(path.join(ROOT, "runtime", "3d", "royale", "housegen.js")).href); } catch (e) { HG = null; }

const FILL = /clock|lamp|[pP]lant|trash|art|poster|rug|wallShelf|mirror|whiteboard|runner|coatRack|monitor|carton|box\/box|televisionModern|Microwave/;
const r3 = (v) => Math.round(v * 1000) / 1000;

function bigRect(cells) {
  // the largest axis-aligned rectangle of a room's cells: [narrow, long] in cells (a stair landing merged into a room does not widen it)
  const S = new Set(cells.map((c) => c[0] + "," + c[1]));
  let i0 = 1e9, j0 = 1e9, i1 = -1e9, j1 = -1e9;
  for (const [i, j] of cells) { i0 = Math.min(i0, i); j0 = Math.min(j0, j); i1 = Math.max(i1, i); j1 = Math.max(j1, j); }
  let best = [0, 0, 0];
  for (let a = i0; a <= i1; a++) for (let b = a; b <= i1; b++) for (let c = j0; c <= j1; c++) for (let d = c; d <= j1; d++) {
    const w = b - a + 1, h = d - c + 1;
    if (w * h <= best[0]) continue;
    let ok = true;
    for (let i = a; i <= b && ok; i++) for (let j = c; j <= d; j++) if (!S.has(i + "," + j)) { ok = false; break; }
    if (ok) best = [w * h, Math.min(w, h), Math.max(w, h)];
  }
  return [best[1], best[2]];
}
const gap = (A, B) => Math.max(A.min[0] - B.max[0], B.min[0] - A.max[0], A.min[2] - B.max[2], B.min[2] - A.max[2]);
function runs(units) {
  // connected components of base units touching within 5 cm (a closed counter run is ONE component)
  const n = units.length, par = units.map((_, i) => i);
  const find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (gap(units[a], units[b]) <= 0.05) par[find(a)] = find(b);
  return new Set(units.map((_, i) => find(i))).size;
}
const BASE = /kitchenCabinet(?!Upper)|kitchenSink|kitchenStove|box\/counter|box\/stoveBox|kitchenBar/;
const STOVE = /kitchenStove|box\/stoveBox/, HOOD = /hood/i, UPPER = /kitchenCabinetUpper/;
const TABLE = /^(furniture\/table(Cloth|Cross|Round)?|box\/tableA|box\/diningTable)$/, CHAIR = /^(furniture\/chair(ModernCushion|Cushion|Rounded)?|box\/chair\w*)$/;
const BED = /bed(Double|Single|Bunk)|^box\/bed/, NIGHT = /cabinetBed|nightstand/, WARD = /bookcaseClosedDoors|wardrobe|dresser|sideTableDrawers/;
const SOFA = /[sS]ofa(?!Ottoman)/, COFFEE = /tableCoffee|coffee/, TVU = /cabinetTelevision|televisionVintage|tvUnit/;
const SINKB = /bathroomSink|box\/basin/, MIRROR = /bathroomMirror|box\/mirror/, WASH = /shower|bathtub/;
const FLOORLAMP = /lamp(Round|Square)Floor|box\/lampFloor/, PLANT = /pottedPlant/, CLOCK = /clock/;

function homeRows(M) {
  const out = { buildings: [], rooms: [], kit: { n: 0, bad: 0, worst: 0, worstId: null, ks: {} }, loot: { points: M.lootPoints ? M.lootPoints.length : 0, house: 0, chests: 0 }, homeLoot: 0, homeArea: 0 };
  for (const H of M.houses) {
    const home = H.use === "house" && H.theme !== "ruin";
    const nonHall = H.rooms.filter((r) => r.kind !== "hall");
    const b = { id: H.id, use: H.use, theme: H.theme, W: H.W, D: H.D, storeys: H.storeys, rooms: H.rooms.length, roomsNonHall: nonHall.length, home: home ? 1 : 0, kinds: [...new Set(H.rooms.map((r) => r.kind))].sort().join("+"),
      tris: H.tris && H.tris.floors ? H.tris.floors.slice() : [], loot: H.loot.length + H.chests.length, pieces: H.furniture.length, fill: H.furniture.filter((q) => FILL.test(q.type)).length,
      clocks: H.furniture.filter((q) => CLOCK.test(q.type)).length };
    out.loot.house += H.loot.length; out.loot.chests += H.chests.length;
    out.buildings.push(b);
    // kit pieces: the collider housegen hands the game vs the box the kit DRAWS for that entry: manifest.json's bbox_min_m / bbox_max_m (the drawn GLB's extent at
    // suggested_scale, kitcollide's decode row) x the entry's scale, turned by citykit's exact quarter turn (x' = x cos + z sin, z' = -x sin + z cos)
    for (const q of H.furniture) {
      if (q.src !== "kit") continue;
      const k = q.kit.scale == null ? 1 : q.kit.scale, T = MAN.types[q.kit.type];
      out.kit.ks[k] = (out.kit.ks[k] || 0) + 1;
      out.kit.n++;
      if (!T) { out.kit.bad++; continue; }
      const c = [1, 0, -1, 0][q.kit.rot & 3], sn = [0, 1, 0, -1][q.kit.rot & 3];
      const mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const lx of [T.bbox_min_m[0], T.bbox_max_m[0]]) for (const lz of [T.bbox_min_m[2], T.bbox_max_m[2]]) {
        const x = q.kit.x + k * (lx * c + lz * sn), z = q.kit.z + k * (-lx * sn + lz * c);
        mn[0] = Math.min(mn[0], x); mx[0] = Math.max(mx[0], x); mn[2] = Math.min(mn[2], z); mx[2] = Math.max(mx[2], z);
      }
      mn[1] = q.kit.y + k * T.bbox_min_m[1]; mx[1] = q.kit.y + k * T.bbox_max_m[1];
      let d = 0;
      for (let a = 0; a < 3; a++) d = Math.max(d, Math.abs(mn[a] - q.min[a]), Math.abs(mx[a] - q.max[a]));
      if (!(d <= 0.02)) out.kit.bad++;
      if (!(d <= out.kit.worst)) { out.kit.worst = r3(d); out.kit.worstId = q.id + " " + q.kit.type; }
    }
    if (!home) continue;
    const roomArea = H.rooms.reduce((a, r) => a + r.area, 0);
    out.homeLoot += H.loot.length + H.chests.length; out.homeArea += roomArea;
    const doorRooms = new Map();
    for (const d of H.doors) if (d.rooms && d.rooms.length === 2) for (const [a, c] of [[d.rooms[0], d.rooms[1]], [d.rooms[1], d.rooms[0]]]) { if (!doorRooms.has(a)) doorRooms.set(a, new Set()); doorRooms.get(a).add(c); }
    const byRoom = new Map(H.rooms.map((r) => [r.id, H.furniture.filter((q) => q.room === r.id)]));
    const dining = (rid) => { const f = byRoom.get(rid) || []; return f.some((q) => TABLE.test(q.type)) && f.filter((q) => CHAIR.test(q.type)).length >= 2; };
    for (const r of H.rooms) {
      const f = byRoom.get(r.id);
      const stand = f.filter((q) => !q.deco && q.mount !== "wall" && q.mount !== "top");
      const fa = stand.reduce((a, q) => a + (q.max[0] - q.min[0]) * (q.max[2] - q.min[2]), 0);
      const [nw, nl] = bigRect(r.cells);
      const has = (re) => f.some((q) => re.test(q.type));
      const base = f.filter((q) => BASE.test(q.type) && q.mount !== "wall" && q.mount !== "top");
      const stoves = f.filter((q) => STOVE.test(q.type)), hoods = f.filter((q) => HOOD.test(q.type));
      const hoodOver = stoves.length > 0 && stoves.some((s) => hoods.some((h) => {
        const cx = (h.min[0] + h.max[0]) / 2, cz = (h.min[2] + h.max[2]) / 2;
        return cx >= s.min[0] - 0.15 && cx <= s.max[0] + 0.15 && cz >= s.min[2] - 0.15 && cz <= s.max[2] + 0.15 && h.min[1] > s.max[1];
      }));
      out.rooms.push({ h: H.id, kind: r.kind, floor: r.floor, area: r.area, nw: nw * 2.5, nl: nl * 2.5, cov: r3(fa / r.area), sub: f.filter((q) => !FILL.test(q.type)).length, all: f.length,
        lamps: f.filter((q) => FLOORLAMP.test(q.type)).length, plants: f.filter((q) => PLANT.test(q.type)).length,
        bed: has(BED) ? 1 : 0, night: has(NIGHT) ? 1 : 0, ward: has(WARD) ? 1 : 0, sofa: has(SOFA) ? 1 : 0, coffee: has(COFFEE) ? 1 : 0, tv: has(TVU) ? 1 : 0,
        dine: r.kind === "kitchen" ? (dining(r.id) || [...(doorRooms.get(r.id) || [])].some(dining) ? 1 : 0) : 0,
        base: base.length, runs: base.length ? runs(base) : 0, upper: has(UPPER) ? 1 : 0, stove: stoves.length, hood: hoodOver ? 1 : 0,
        bsink: has(SINKB) ? 1 : 0, mirror: has(MIRROR) ? 1 : 0, wash: has(WASH) ? 1 : 0 });
    }
  }
  out.loot.total = out.loot.points + out.loot.house + out.loot.chests;
  return out;
}

const res = { root: ROOT, maps: MAPS, seeds: SEEDS, furnK: HG && HG.FURN_K != null ? HG.FURN_K : 1, triBudget: HG ? HG.TRI_BUDGET : null, genVersion: null, hgVersion: HG ? HG.VERSION : null, builds: [], determinism: null };
const w = console.warn; console.warn = () => {};
const hashOf = (o) => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 16);
for (const m of MAPS) for (const s of SEEDS) {
  globalThis.__LC_BOXES = null;
  const t0 = Date.now();
  const M = await buildMap(E.makeW(s), m);
  res.genVersion = M.genVersion;
  const R = homeRows(M);
  R.map = m; R.seed = s; R.ms = Date.now() - t0; R.hash = hashOf([R.buildings, R.rooms]);
  res.builds.push(R);
  process.stderr.write(`${m} ${s}: ${M.houses.length} buildings ${R.ms} ms hash ${R.hash}\n`);
  try { M.dispose && M.dispose(); } catch (e) { /* the census never needs the scene */ }
}
if (TWICE) {
  const m = MAPS[0], s = SEEDS[0];
  globalThis.__LC_BOXES = null;
  const M = await buildMap(E.makeW(s), m);
  const R = homeRows(M);
  res.determinism = { map: m, seed: s, a: res.builds[0].hash, b: hashOf([R.buildings, R.rooms]) };
  try { M.dispose && M.dispose(); } catch (e) { /* as above */ }
}
console.warn = w;
const txt = JSON.stringify(res);
if (OUT) fs.writeFileSync(OUT, txt); else process.stdout.write(txt);
