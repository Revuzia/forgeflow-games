// probe_loot.mjs - Node probe for loot.js on a REAL built map (Wave 7, lane 7C). NO browser, NO server, NO file edited.
//
//   node _harness/probe_loot.mjs [--root <game dir>] [--vendor <three vendor dir>] [--loot <loot.js to measure>] [--maps ashgrid] [--seeds 7,1,2,3,4] [--out loot.json] [--list] [--gate]
//
// It imports the UNMODIFIED <root>/runtime/3d/royale/maps.js and loot.js (the three resolve hook of world_env.mjs), builds each (map, seed) with the
// world gates' fake W, runs the game's own loot.js populate() and measures what a player would meet. The measurement code is INDEPENDENT of
// loot.js (it re-derives the support and the ceiling from M.queryColliders / M.heightAt), so a loot.js bug cannot hide behind itself.
//
// Per (map, seed):
//   points     map.lootPoints: floor / chest, with and without a poi
//   items      what populate() spawned (floor items + chests), weapons, light-ammo boxes; census = (floor guns + chests) / 50 players (the
//              probe_match gate's definition: >= 3)
//   inSolid    an item or chest whose body (item: x,z +-0.15 m, y+0.05 .. y+0.7; chest: 0.55 m radius, y+0.05 .. y+0.9) overlaps the interior of a
//              solid box (not ramps, not a box it rests on). Unreachable loot.
//   floating   floatingAir = nothing under it within 0.9 m (over a stairwell hole, in the air); onRamp = a stair surface is under it (not floating).
//              gap = item y - the support under it (the highest box top <= y + 0.05, else the ground). `gapOver` counts gap > 0.9 m for an item
//              (floor items are authored at surface + 0.5, so 0.5 is normal, a death drop starts 0.2 over the feet), > 0.1 m for a chest
//              (a chest RESTS on its surface). `noBlob` = the contact-shadow disc found no surface within 0.9 m (what a hovering item looks like)
//   rings      the floor ring's y against that independent support (|ring - (support + 0.035/0.065)| > 0.10 m = misplaced) and rings inside a solid
//   beams      beam top above the ceiling (the lowest collider that starts > 0.6 m over the floor, within the beam radius): `throughRoof`
//   pools      live slots / capacity of rings, beams, glows (and the blob budget): headroom after 50 death drops of 8 items each
//   slabs      items that a player standing on ANOTHER floor within 1.5 m horizontally can reach through nearby()'s old |dy| < 4 gate
//              (a slab top 2.2-4.0 m above the item): `throughSlabOld`; with the 2.2 m gate this is 0 by construction (`throughSlabGate` re-measures
//              it with the gate the game now uses: the browser proof is probe_loot_live.py)
//
// --list prints the worst offenders (id, x, y, z, poi). --gate prints the pass/fail rows and exits 1 when one fails (the control: --loot <the live build's loot.js>
// fails them: `git show 60b854d0:games/last-circle/runtime/3d/royale/loot.js > old_loot.js`).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeEnv } from "./world_env.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const k = a.slice(2); const n = process.argv[i + 1]; if (n === undefined || n.startsWith("--")) args[k] = true; else { args[k] = n; i++; } }
}
const ROOT = path.resolve(args.root || path.join(HERE, ".."));
const MAPS = (args.maps || "ashgrid").split(",").filter(Boolean);
const SEEDS = (args.seeds || "7,1,2,3,4").split(",").filter(Boolean).map(Number);
const OUT = args.out || null;
const LIST = !!args.list;
const r3 = (v) => Math.round(v * 1000) / 1000;
const SLAB_GATE = Number(args["slab-gate"] || 2.2);

const E = await makeEnv({ root: ROOT, vendor: args.vendor });
const { buildMap } = await E.importMaps();
// --loot <file>: measure another loot.js (e.g. the live build's, extracted from git) on THIS tree's maps - the A/B for loot.js alone
const lootMod = await import(pathToFileURL(path.resolve(args.loot || path.join(ROOT, "runtime", "3d", "royale", "loot.js"))).href);

function measure(M, W) {
  const items = lootMod.debugItems();
  const chests = W.debugChests();
  const cols = [];
  const colsAt = (x, z, r) => M.queryColliders(x, z, r, cols).filter((c) => !c.dead);
  const support = (x, z, y) => {
    let f = M.heightAt(x, z), box = false;
    for (const c of colsAt(x, z, 0.05)) {
      if (c.kind !== "box" || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      if (c.maxY <= y + 0.05 && c.maxY > f) { f = c.maxY; box = true; }
    }
    return { f, box };
  };
  // a ramp surface within 0.9 m under (x, y, z): an item lying on a stair (not floating: the stair is under it)
  const rampUnder = (x, z, y) => {
    let best = -Infinity;
    for (const c of colsAt(x, z, 0.05)) {
      if (c.kind !== "ramp" || x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
      const w = Math.max(0.01, c.dir < 2 ? c.maxX - c.minX : c.maxZ - c.minZ);
      const f = c.dir === 0 ? (x - c.minX) / w : c.dir === 1 ? (c.maxX - x) / w : c.dir === 2 ? (z - c.minZ) / w : (c.maxZ - z) / w;
      const top = c.minY + (c.maxY - c.minY) * Math.min(1, Math.max(0, f));
      if (top <= y + 0.05 && top > best) best = top;
    }
    return best;
  };
  const inSolid = (x, z, y, rad, lo, hi) => {
    for (const c of colsAt(x, z, rad + 0.1)) {
      if (c.kind !== "box") continue;
      if (x < c.minX - rad || x > c.maxX + rad || z < c.minZ - rad || z > c.maxZ + rad) continue;
      // the box the object rests on (top at or under its base) is the floor, not a solid it is inside
      if (c.maxY <= y + 0.12) continue;
      if (y + hi > c.minY + 0.05 && y + lo < c.maxY - 0.05) return c;
    }
    return null;
  };
  const inSolidBox = (x, z, y, hx, hz, lo, hi) => {
    for (const c of colsAt(x, z, Math.max(hx, hz) + 0.1)) {
      if (c.kind !== "box") continue;
      if (x + hx <= c.minX || x - hx >= c.maxX || z + hz <= c.minZ || z - hz >= c.maxZ) continue;
      if (c.maxY <= y + 0.05) continue;                       // the floor it stands on
      if (y + hi > c.minY + 0.05 && y + lo < c.maxY - 0.05) return c;
    }
    return null;
  };
  // a house item's given surface must be one of its house's record surfaces (a loot point's y or a chest slot's floor) within 1.6 m: the ring row trusts it.surf only then
  const HS = Array.isArray(M.houses) ? M.houses : [], hById = new Map(HS.map((H) => [H.id, H]));
  const onRecord = (it) => {
    const H = hById.get(it.house); if (!H) return false;
    for (const l of (H.loot || []).concat(H.chests || [])) if (Math.abs(l.y - it.surf) < 1e-6 && Math.hypot(l.x - it.pos.x, l.z - it.pos.z) <= 1.6) return true;
    return false;
  };
  const ceilingOver = (x, z, floor, rad) => {
    let ceil = Infinity;
    for (const c of colsAt(x, z, rad)) {
      if (c.kind !== "box") continue;
      if (c.maxX < x - rad || c.minX > x + rad || c.maxZ < z - rad || c.minZ > z + rad) continue;
      if (c.minY > floor + 0.6 && c.minY < ceil) ceil = c.minY;
    }
    return ceil;
  };
  // standing surfaces (slabs) a player can really be on: a box with a wide top (>= 2 m on both axes) that a RAMP reaches (the ramp's high end within
  // 0.5 m of the top, its footprint within 1.3 m of the slab's) - a house roof deck no ramp touches is not a floor anybody stands on
  const ramps = M.colliders.filter((c) => c.kind === "ramp" && !c.dead);
  const reached = (c) => ramps.some((rp) => Math.abs(rp.maxY - c.maxY) < 0.5 && rp.maxX > c.minX - 1.3 && rp.minX < c.maxX + 1.3 && rp.maxZ > c.minZ - 1.3 && rp.minZ < c.maxZ + 1.3);
  const slabAbove = (x, z, y, dyLo, dyHi) => {
    for (const c of colsAt(x, z, 1.6)) {
      if (c.kind !== "box") continue;
      if (c.maxX - c.minX < 2 || c.maxZ - c.minZ < 2) continue;
      if (x < c.minX - 1.5 || x > c.maxX + 1.5 || z < c.minZ - 1.5 || z > c.maxZ + 1.5) continue;
      const top = c.maxY - y;
      if (top >= dyLo && top < dyHi && reached(c)) return c;
    }
    return null;
  };
  const P = lootMod.debugLootFx();
  const out = {
    items: items.length, chests: chests.length, weapons: 0, lightAmmo: 0,
    inSolid: [], gapOver: [], floatingAir: [], onRamp: [], noBlob: [], ringMisplaced: [], ringInSolid: [], beamThroughRoof: [], throughSlabOld: [], throughSlabGate: [],
    ringMissing: 0, beamMissing: 0, maxCeilClampError: 0,
  };
  const gaps = [];
  const note = (arr, it, extra) => arr.push(Object.assign({ id: it.id, x: r3(it.pos.x), y: r3(it.pos.y), z: r3(it.pos.z) }, extra || {}));
  for (const it of items) {
    if (it.data.kind === "weapon") out.weapons++;
    if (it.data.kind === "ammo" && it.data.id === "light") out.lightAmmo++;
    const { x, y, z } = it.pos;
    const s = support(x, z, y);
    const gap = y - s.f;
    gaps.push(gap);
    const sol = inSolid(x, z, y, 0.15, 0.05, 0.7);
    if (sol) note(out.inSolid, it, { kind: it.data.kind, box: [r3(sol.minX), r3(sol.maxX), r3(sol.minY), r3(sol.maxY), r3(sol.minZ), r3(sol.maxZ)], prop: sol.prop || null });
    if (gap > 0.9) {
      note(out.gapOver, it, { gap: r3(gap) });
      // over a stairwell hole / in the air (nothing under it) vs lying on a stair (a ramp surface within 0.9 m under it)
      const rt = rampUnder(x, z, y);
      if (y - rt <= 0.9) note(out.onRamp, it, { gap: r3(gap), rampGap: r3(y - rt) }); else note(out.floatingAir, it, { gap: r3(gap) });
    }
    if (it.blob < 0) note(out.noBlob, it, { gap: r3(gap) });
    if (it.ring < 0) out.ringMissing++;
    else {
      const info = lootMod.debugLootFx(it.id);
      const ring = info && info.obj && info.obj.ring;
      if (ring) {
        // a furnished house's item (Wave 8) lies on its record's surface AS GIVEN (it.surf: a counter, a shelf - possibly under that piece's coarser collider top):
        // its ring belongs there; the surface is checked against the house record (W.map.houses loot y) below
        const want = it.surf != null ? it.surf + 0.035 : s.f + (s.box ? 0.035 : 0.065);
        if (it.surf != null && !onRecord(it)) note(out.ringMisplaced, it, { surf: r3(it.surf), unrecorded: true });
        // a ring that fell back to "15 cm under the item" (no support in reach) is the floating case: reported through noBlob / gapOver too
        if (Math.abs(ring.y - want) > 0.10) note(out.ringMisplaced, it, { ringY: r3(ring.y), support: r3(s.f), box: s.box });
        if (inSolid(ring.x, ring.z, ring.y - 0.1, 0.05, 0, 0.2)) note(out.ringInSolid, it, { ringY: r3(ring.y) });
      }
      const beam = info && info.obj && info.obj.beam;
      if (beam && beam.alive) {
        const ceil = ceilingOver(x, z, s.f, 0.15);
        if (beam.top > ceil - 0.0 + 1e-3) note(out.beamThroughRoof, it, { top: r3(beam.top), ceil: r3(ceil) });
      }
      if (it.data.kind === "weapon" && it.beam < 0) out.beamMissing++;
    }
    const sl = slabAbove(x, z, y, 2.2, 4.0 - 1e-6);        // |dy| < 4 (old gate): a player on a slab 2.2..4 m ABOVE the item (the roof over a top-floor item)
    if (sl) note(out.throughSlabOld, it, { slabTop: r3(sl.maxY) });
    const sg = SLAB_GATE < 4 ? null : sl;                 // with a gate of SLAB_GATE the same player sees |dy| >= SLAB_GATE as out of reach
    if (sg) note(out.throughSlabGate, it, { slabTop: r3(sg.maxY) });
  }
  for (const c of chests) {
    const { x, y, z } = c.pos;
    const s = support(x, z, y + 0.35);
    const gap = y - s.f;
    gaps.push(gap);
    // a chest's body: the outdoor 1.6 m chest is judged as a 0.55 m disc; a furnished house's chest (Wave 8, loot.js PER-ROOM LOOT) is drawn at 0.625 to fit
    // its 1.0 x 0.75 m slot against a wall and reports its own half extents (c.half, axis-aligned: quarter turns) - judged as that box (2 cm tolerance), to its
    // drawn height 0.62 m (the disc would put a wall 0.375 m behind every slot inside it)
    const sol = c.half ? inSolidBox(x, z, y, c.half[0] - 0.02, c.half[1] - 0.02, 0.05, 0.62) : inSolid(x, z, y, 0.55, 0.05, 0.9);
    const rec = { id: c.id, x: r3(x), y: r3(y), z: r3(z) };
    if (sol) out.inSolid.push(Object.assign({ chest: true }, rec, { box: [r3(sol.minX), r3(sol.maxX), r3(sol.minY), r3(sol.maxY), r3(sol.minZ), r3(sol.maxZ)], prop: sol.prop || null }));
    if (Math.abs(gap) > 0.1) {
      out.gapOver.push(Object.assign({ chest: true, gap: r3(gap) }, rec));
      const rt = rampUnder(x, z, y + 0.35);
      if (y - rt <= 0.9) out.onRamp.push(Object.assign({ chest: true, gap: r3(gap) }, rec)); else out.floatingAir.push(Object.assign({ chest: true, gap: r3(gap) }, rec));
    }
    if (c.ring < 0) out.ringMissing++;
    const info = lootMod.debugLootFx(c.id);
    const beam = info && info.obj && info.obj.beam;
    if (beam && beam.alive) {
      const ceil = ceilingOver(x, z, s.f, 0.25);
      if (beam.top > ceil + 1e-3) out.beamThroughRoof.push(Object.assign({ chest: true, top: r3(beam.top), ceil: r3(ceil) }, rec));
    }
    const sl = slabAbove(x, z, y, 2.2, 4.0 - 1e-6);
    if (sl) out.throughSlabOld.push(Object.assign({ chest: true, slabTop: r3(sl.maxY) }, rec));
  }
  const sorted = gaps.slice().sort((a, b) => a - b);
  const q = (f) => (sorted.length ? r3(sorted[Math.floor(f * (sorted.length - 1))]) : null);
  out.gapQuantiles = { min: q(0), p5: q(0.05), p50: q(0.5), p95: q(0.95), max: q(1) };
  out.pools = {
    rings: { live: P.rings.live, cap: P.rings.max }, beams: { live: P.beams.live, cap: P.beams.max }, glows: { live: P.glows.live, cap: P.glows.max },
    // 50 deaths x (<= 3 guns + 2 consumables + 3 ammo = 8 items; each a ring, each gun a beam and every death item a glow)
    ringHeadroomAfter50Deaths: P.rings.max - P.rings.live - 400, beamHeadroomAfter50Deaths: P.beams.max - P.beams.live - 150, glowHeadroomAfter50Deaths: P.glows.max - P.glows.live - 400,
  };
  // bots.js assignDrops' landing-spot rule: a chest point, or a floor point with a non-pistol gun within 1.8 m (W.nearbyLoot) - settled items must still satisfy it
  let spots = 0;
  for (const lp of M.lootPoints) {
    let ok = lp.kind === "chest";
    if (!ok) for (const n of W.nearbyLoot(lp, 1.8)) if (n.type === "item" && n.data.kind === "weapon" && n.data.id !== "pistol") { ok = true; break; }
    if (ok) spots++;
  }
  out.dropSpots = spots;
  // chests whose beacon beam is CLAMPED under a roof / upper floor (loot.js ceilingAbove): from the air they show no full beam
  let roofed = 0, openSky = 0;
  for (const c of chests) { const info = lootMod.debugLootFx(c.id); const b = info && info.obj && info.obj.beam; if (b && b.alive && b.top < b.y + b.nominal - 0.01) roofed++; else openSky++; }
  out.roofedChests = roofed; out.openSkyChests = openSky;
  const guns = out.weapons + out.chests;
  out.census = { floorGuns: out.weapons, chests: out.chests, gunsPerPlayer: r3(guns / 50), lightAmmo: out.lightAmmo };
  return out;
}

const results = [];
const counts = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Array.isArray(v) ? v.length : v]));
for (const mapId of MAPS) for (const seed of SEEDS) {
  const t0 = Date.now();
  globalThis.__LC_BOXES = null;
  const W = E.makeW(seed);
  const M = await buildMap(W, mapId);
  W.map = M; W.mapId = mapId;
  if (!W.__lootInit) { lootMod.init(W); W.__lootInit = true; }
  lootMod.populate(W);
  const lp = M.lootPoints;
  const m = measure(M, W);
  const rec = {
    map: mapId, seed, genVersion: M.genVersion, ms: Date.now() - t0,
    points: { total: lp.length, floor: lp.filter((p) => p.kind === "floor").length, chest: lp.filter((p) => p.kind === "chest").length, withPoi: lp.filter((p) => p.poi != null).length },
    summary: counts(m), detail: m,
  };
  results.push(rec);
  console.log(`probe_loot ${mapId} seed ${seed} (genVersion ${M.genVersion}, ${rec.ms} ms): points ${JSON.stringify(rec.points)}`);
  console.log("   " + JSON.stringify(Object.assign({}, rec.summary, { gapQuantiles: m.gapQuantiles })));
  console.log("   pools " + JSON.stringify(m.pools) + "  census " + JSON.stringify(m.census));
  if (LIST) for (const k of ["inSolid", "floatingAir", "onRamp", "noBlob", "ringMisplaced", "ringInSolid", "beamThroughRoof", "throughSlabOld"]) {
    for (const o of m[k].slice(0, 6)) console.log("     " + k + " " + JSON.stringify(o));
  }
  try { if (typeof M.dispose === "function") M.dispose(); } catch (e) { /* ignore */ }
}
const tot = (k) => results.reduce((s, r) => s + r.detail[k].length, 0);
const agg = { builds: results.length, items: results.reduce((s, r) => s + r.detail.items, 0), chests: results.reduce((s, r) => s + r.detail.chests, 0),
  inSolid: tot("inSolid"), gapOver: tot("gapOver"), floatingAir: tot("floatingAir"), onRamp: tot("onRamp"), noBlob: tot("noBlob"), ringMisplaced: tot("ringMisplaced"), ringInSolid: tot("ringInSolid"),
  beamThroughRoof: tot("beamThroughRoof"), throughSlabOld: tot("throughSlabOld"), ringMissing: results.reduce((s, r) => s + r.detail.ringMissing, 0),
  dropSpots: results.reduce((s, r) => s + r.detail.dropSpots, 0), roofedChests: results.reduce((s, r) => s + r.detail.roofedChests, 0), openSkyChests: results.reduce((s, r) => s + r.detail.openSkyChests, 0), minGunsPerPlayer: Math.min(...results.map((r) => r.detail.census.gunsPerPlayer)), minLightAmmo: Math.min(...results.map((r) => r.detail.census.lightAmmo)),
  minRingHeadroom: Math.min(...results.map((r) => r.detail.pools.ringHeadroomAfter50Deaths)), minBeamHeadroom: Math.min(...results.map((r) => r.detail.pools.beamHeadroomAfter50Deaths)) };
console.log("probe_loot TOTAL " + JSON.stringify(agg));
// --gate: the rows 7D registers (exit 0 pass / 1 fail). Counts are exact pass criteria; nothing here is a millisecond.
const ROWS = [
  ["no loot inside a solid box (items + chests)", agg.inSolid === 0, agg.inSolid],
  ["no loot hovering over nothing (over a stairwell hole / in the air)", agg.floatingAir === 0, agg.floatingAir],
  ["every floor ring sits on its support (+-10 cm) and none is inside a solid", agg.ringMisplaced === 0 && agg.ringInSolid === 0, [agg.ringMisplaced, agg.ringInSolid]],
  ["no beam above its ceiling (no beam through a roof)", agg.beamThroughRoof === 0, agg.beamThroughRoof],
  ["every item got a ring (pools not exhausted)", agg.ringMissing === 0, agg.ringMissing],
  ["(floor guns + chests) / 50 players >= 3 on every build", agg.minGunsPerPlayer >= 3, agg.minGunsPerPlayer],
  [">= 8 light-ammo boxes on every build", agg.minLightAmmo >= 8, agg.minLightAmmo],
  ["marker pools keep headroom after 50 death drops (rings, beams)", agg.minRingHeadroom >= 0 && agg.minBeamHeadroom >= 0, [agg.minRingHeadroom, agg.minBeamHeadroom]],
];
let gateFail = 0;
if (args.gate) {
  console.log("probe_loot gate rows:");
  for (const [name, ok, v] of ROWS) { if (!ok) gateFail++; console.log("  " + (ok ? "PASS" : "FAIL") + "  " + name + "  " + JSON.stringify(v)); }
  console.log("VERDICT probe_loot: " + (gateFail ? "FAIL (" + gateFail + " row(s))" : "PASS") + "  (" + results.length + " builds: " + MAPS.join(",") + " x seeds " + SEEDS.join(",") + ")");
}
if (OUT) { fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify({ tool: "probe_loot.mjs", root: ROOT, maps: MAPS, seeds: SEEDS, agg, results }, null, 1)); }
process.exit(gateFail ? 1 : 0);
