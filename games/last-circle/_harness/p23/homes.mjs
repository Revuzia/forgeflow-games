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
// the kit's furniture GLBs are EXT_meshopt_compression files (world_env's own GLB reader refuses them): load them as the game does - three's GLTFLoader with
// the vendored MeshoptDecoder - so maps.js BAKES the real GLB vertices and the 'scale' row reads the box those baked vertices span (globalThis.__LC_KITDRAWN)
const JSM = path.join(E.ROOT, "assets", "vendor", "three", "examples", "jsm");
const { GLTFLoader } = await import(pathToFileURL(path.join(JSM, "loaders", "GLTFLoader.js")).href);
const { MeshoptDecoder } = await import(pathToFileURL(path.join(JSM, "libs", "meshopt_decoder.module.js")).href);
await MeshoptDecoder.ready;
const GL = new GLTFLoader(); GL.setMeshoptDecoder(MeshoptDecoder);
const _kitGlb = {};
async function loadGLTF(url) {
  const rel = String(url).replace(/^.*?assets\//, "assets/").split("?")[0];
  if (!/^assets\/props\/city\/furniture\//.test(rel)) return E.loadGLTF(url);
  if (!_kitGlb[rel]) { const b = fs.readFileSync(path.join(ROOT, rel)); _kitGlb[rel] = await GL.parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), ""); }
  return _kitGlb[rel].scene.clone(true);
}
const makeW = (s) => { const W = E.makeW(s); W.kernel.loadGLTF = loadGLTF; return W; };
let HG = null;
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

// (W10 R3A) the interiors-II census: work rooms (shop / storage / warehouse; office / meeting / lobby / corridor = a hall of a non-home building), cover pieces, the
// finish of the homes' lived rooms (wall decor, real curtains, ceilings), roofs and porches. A COVER piece: standing on its room's floor (not wall-hung, not on a top,
// not decor), >= 0.9 m tall, >= 0.7 m wide (its wider side)
const WORK = new Set(["shop", "storage", "warehouse", "office", "meeting", "lobby", "hall"]);
const DECOR = /^box\/(art|artWide|poster|clock|mirror|mirrorHi|whiteboard)$/;
const isCover = (q, r) => !q.deco && !q.mount && Math.abs(q.min[1] - r.y) <= 0.02 && q.max[1] - q.min[1] >= 0.9 - 1e-6 && Math.max(q.max[0] - q.min[0], q.max[2] - q.min[2]) >= 0.7 - 1e-6;
const ART_MIN = 0.05;          // (W10 R3A fix5) a picture's UV rect, both ways, of the 1 x 1 atlas (its cell spans 0.25 less the pad, cropped to the picture's proportions)
const lumOf = (hex) => (0.2126 * ((hex >> 16) & 255) + 0.7152 * ((hex >> 8) & 255) + 0.0722 * (hex & 255)) / 255;
function interiorRows(M) {
  const out = { work: [], lived: [], ceil: { n: 0, white: 0, min: 1 }, roofs: [], finTris: [], art: [] };
  for (const H of M.houses) {
    const home = H.use === "house" && H.theme !== "ruin";
    out.roofs.push({ id: H.id, use: H.use, theme: H.theme, roof: H.roof, home: home ? 1 : 0, core: H.core ? 1 : 0, porch: H.porch ? 1 : 0 });
    if (H.theme === "ruin") continue;
    const pics = (H.fin && H.fin.pics) || [], cur = new Set(((H.fin && H.fin.cur) || []).map((c) => c[0]));
    // (W10 R3A fix5, ruling R3A-6) the pictures as the medium+ renderer draws them: meshData with the finish AND the art atlas (opts.art), the "art|in" group's
    // quads in H.fin.pics order; a picture SAMPLES THE ATLAS when its UV rect spans >= ART_MIN of the atlas both ways (a cell is 0.25; the no-art plant collapses it)
    const artBy = new Map();
    if (HG && HG.ART_ATLAS != null && pics.length) {
      const md = HG.meshData(H, () => [1, 1, 1], { interior: true, finish: true, art: true, leaves: false });
      const ag = md.groups.walls.get("art|in") || md.groups.walls.get("art"), uv = ag ? ag.uv : [];
      pics.forEach((p, i) => {
        const q = uv.slice(i * 8, i * 8 + 8);
        if (q.length < 8) return;
        const us = [q[0], q[2], q[4], q[6]], vs = [q[1], q[3], q[5], q[7]], du = Math.max(...us) - Math.min(...us), dv = Math.max(...vs) - Math.min(...vs);
        const e = artBy.get(p.room) || { n: 0, atlas: 0, cells: [] };
        e.n++; if (du >= ART_MIN && dv >= ART_MIN) { e.atlas++; e.cells.push(p.pic); }
        artBy.set(p.room, e);
      });
    }
    for (const r of H.rooms) {
      const f = H.furniture.filter((q) => q.room === r.id);
      if ((home && r.kind === "living") || (!home && (r.kind === "office" || r.kind === "lobby"))) {
        const e = artBy.get(r.id) || { n: 0, atlas: 0, cells: [] };
        out.art.push({ h: H.id, kind: r.kind, pics: e.n, atlas: e.atlas, cells: e.cells });
      }
      if (!home && WORK.has(r.kind) && H.use !== "barn") {
        out.work.push({ h: H.id, use: H.use, kind: r.kind === "hall" ? "corridor" : r.kind, area: r.area, n: f.length, cover: f.filter((q) => isCover(q, r)).length });
      }
      if (home && (r.kind === "living" || r.kind === "bedroom" || r.kind === "kitchen" || r.kind === "dining")) {
        const wins = H.windows.map((w, k) => [w, k]).filter(([w]) => w.room === r.id);
        out.lived.push({ h: H.id, kind: r.kind, decor: f.some((q) => DECOR.test(q.type)) || pics.some((p) => p.room === r.id) ? 1 : 0, pics: pics.filter((p) => p.room === r.id).length,
          wins: wins.length, cur: wins.filter(([, k]) => cur.has(k)).length });
      }
    }
    if (home) for (const b of H.boxes) {
      if (!(b.p === "slab" || b.p === "roof" || b.p === "shell") || (b.h & 8) || b.min[1] < H.floors[0].y + 1) continue;
      // a CEILING: its underside lies over a room of the house (a room whose ceiling height is this face, a sample point of the face inside one of its cells) -
      // the eaves, ridge caps and soffits outside are not ceilings
      let over = false;
      for (const r of H.rooms) {
        if (Math.abs(r.ceil - b.min[1]) > 0.05) continue;
        for (const [fx, fz] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.25, 0.75], [0.75, 0.25]]) {
          const x = b.min[0] + (b.max[0] - b.min[0]) * fx, z = b.min[2] + (b.max[2] - b.min[2]) * fz;
          if (r.rects.some((c) => x > c[0] + 0.15 && x < c[2] - 0.15 && z > c[1] + 0.15 && z < c[3] - 0.15)) { over = true; break; }
        }
        if (over) break;
      }
      if (!over) continue;
      const pe = H.palette[b.f[3]], L = lumOf(pe.color);
      out.ceil.n++; if (L >= 0.85) out.ceil.white++; out.ceil.min = Math.min(out.ceil.min, Math.round(L * 1000) / 1000);
    }
  }
  return out;
}

function homeRows(M, KD) {
  const out = { buildings: [], rooms: [], kit: { n: 0, drawn: 0, boxes: 0, bad: 0, worst: 0, worstId: null, ks: {} }, loot: { points: M.lootPoints ? M.lootPoints.length : 0, house: 0, chests: 0 }, homeLoot: 0, homeArea: 0 };
  for (const H of M.houses) {
    const home = H.use === "house" && H.theme !== "ruin";
    const nonHall = H.rooms.filter((r) => r.kind !== "hall");
    const b = { id: H.id, use: H.use, theme: H.theme, W: H.W, D: H.D, storeys: H.storeys, rooms: H.rooms.length, roomsNonHall: nonHall.length, home: home ? 1 : 0, kinds: [...new Set(H.rooms.map((r) => r.kind))].sort().join("+"),
      tris: H.tris && H.tris.floors ? H.tris.floors.slice() : [], loot: H.loot.length + H.chests.length, pieces: H.furniture.length, fill: H.furniture.filter((q) => FILL.test(q.type)).length,
      clocks: H.furniture.filter((q) => CLOCK.test(q.type)).length };
    out.loot.house += H.loot.length; out.loot.chests += H.chests.length;
    out.buildings.push(b);
    for (const q of H.furniture) if (q.src === "kit") { const k = q.kit.scale == null ? 1 : q.kit.scale; out.kit.ks[k] = (out.kit.ks[k] || 0) + 1; out.kit.n++; }
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
      out.rooms.push({ h: H.id, kind: r.kind, floor: r.floor, area: r.area, nd: r.doors.length, nwin: H.windows.filter((x) => x.room === r.id).length, nw: nw * 2.5, nl: nl * 2.5, cov: r3(fa / r.area), sub: f.filter((q) => !FILL.test(q.type)).length, all: f.length,
        lamps: f.filter((q) => FLOORLAMP.test(q.type)).length, plants: f.filter((q) => PLANT.test(q.type)).length,
        bed: has(BED) ? 1 : 0, night: has(NIGHT) ? 1 : 0, ward: has(WARD) ? 1 : 0, sofa: has(SOFA) ? 1 : 0, coffee: has(COFFEE) ? 1 : 0, tv: has(TVU) ? 1 : 0,
        dine: r.kind === "kitchen" ? (dining(r.id) || [...(doorRooms.get(r.id) || [])].some(dining) ? 1 : 0) : 0,
        base: base.length, runs: base.length ? runs(base) : 0, upper: has(UPPER) ? 1 : 0, stove: stoves.length, hood: hoodOver ? 1 : 0,
        bsink: has(SINKB) ? 1 : 0, wash: has(WASH) ? 1 : 0,
        // a mirror OVER a basin: its middle within 0.3 m of the basin's footprint (a mirror is a drawn-only wall plate authored 1.25 - 2.2 m up: its record's box
        // starts at the floor, so only its place along the wall is judged)
        mirror: f.some((m) => MIRROR.test(m.type) && f.some((b) => SINKB.test(b.type) && (m.min[0] + m.max[0]) / 2 > b.min[0] - 0.3 && (m.min[0] + m.max[0]) / 2 < b.max[0] + 0.3 &&
          (m.min[2] + m.max[2]) / 2 > b.min[2] - 0.3 && (m.min[2] + m.max[2]) / 2 < b.max[2] + 0.3)) ? 1 : 0 });
    }
  }
  // kit pieces: the collider housegen hands the game vs the box of the vertices maps.js BAKED for that entry (buildHouseFurniture's draw path, read through its
  // __LC_KITDRAWN hook: the real GLB at the draw scale maps.js applies). A piece drawn as its collider box (GLB not loaded) is counted apart: not a judged draw
  for (const r of KD || []) {
    out.kit.drawn++;
    if (!r.glb) { out.kit.boxes++; continue; }
    let d = 0;
    for (let a = 0; a < 3; a++) d = Math.max(d, Math.abs(r.drawn[a] - r.min[a]), Math.abs(r.drawn[a + 3] - r.max[a]));
    if (!(d <= 0.02)) out.kit.bad++;
    if (!(d <= out.kit.worst)) { out.kit.worst = r3(d); out.kit.worstId = r.type; }
  }
  out.loot.total = out.loot.points + out.loot.chests;            // (map.lootPoints already holds every house's points, maps.js: the house column is a part of it)
  return out;
}

const res = { root: ROOT, maps: MAPS, seeds: SEEDS, furnK: HG && HG.FURN_K != null ? HG.FURN_K : 1, triBudget: HG ? HG.TRI_BUDGET : null, genVersion: null, hgVersion: HG ? HG.VERSION : null, builds: [], determinism: null };
const w = console.warn; console.warn = () => {};
const hashOf = (o) => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 16);
for (const m of MAPS) for (const s of SEEDS) {
  globalThis.__LC_BOXES = null; globalThis.__LC_KITDRAWN = [];
  const t0 = Date.now();
  const M = await buildMap(makeW(s), m);
  res.genVersion = M.genVersion;
  const R = homeRows(M, globalThis.__LC_KITDRAWN);
  globalThis.__LC_KITDRAWN = null;
  R.inter = interiorRows(M);
  R.map = m; R.seed = s; R.ms = Date.now() - t0; R.hash = hashOf([R.buildings, R.rooms]);
  res.builds.push(R);
  process.stderr.write(`${m} ${s}: ${M.houses.length} buildings ${R.ms} ms hash ${R.hash}\n`);
  try { M.dispose && M.dispose(); } catch (e) { /* the census never needs the scene */ }
}
if (TWICE) {
  const m = MAPS[0], s = SEEDS[0];
  globalThis.__LC_BOXES = null; globalThis.__LC_KITDRAWN = null;
  const M = await buildMap(makeW(s), m);
  const R = homeRows(M, null);
  res.determinism = { map: m, seed: s, a: res.builds[0].hash, b: hashOf([R.buildings, R.rooms]) };
  try { M.dispose && M.dispose(); } catch (e) { /* as above */ }
}
console.warn = w;
const txt = JSON.stringify(res);
if (OUT) fs.writeFileSync(OUT, txt); else process.stdout.write(txt);
