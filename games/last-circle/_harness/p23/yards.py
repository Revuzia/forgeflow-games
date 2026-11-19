#!/usr/bin/env python
"""yards - w10_yards: do the towns' homes have front yards, fences / hedges with a gate, a door path and yard props, and are the town layouts varied?
(Wave 10, round 4, lane R4B.) NODE ONLY: no browser, no server, no file of the tree edited (a planted fault edits a scratch copy).

    python _harness/p23/yards.py --disk                        # the working copy: 3 maps x seeds 1, 7, 1234, 2026 (12 builds)
    python _harness/p23/yards.py --disk --plant bare-lots      # a planted fault (see PLANTS): exit 1 = caught

The probe (written to the temp dir, run with node) builds each map with the UNMODIFIED maps.js (world_env.mjs) and reads what the game places:
map.city.kit (every street / yard prop and its rot), map.city.layout (towns, blocks, parcels, roads) and map.houses (every housegen house and its doors).
Only grid towns (towns with blocks) are judged. Footprints are citykit.footprintFor (the colliders the game adds); a path stone has none (a 0.1 m slab: its
1.2 m square is used).

Rows (any FAIL -> exit 1; the probe not running -> exit 2):
  props-per-building  (street + yard props) / buildings of the grid towns >= 2.0 per map (cars count, as the audit did; path stones do not; a lot's fence /
                      hedge run counts once); distinct non-car prop types placed over the 12 builds >= 18 (path stones not counted)   [Isla s1 153 / 240 = 0.64; 9 types]
  yards               >= 70 % of homes (use house, housegen) have a fence / hedge run with a gap >= 1.6 m where the path crosses it AND a door path: the
                      path stones of the lot form one chain (touching within 5 cm) from the house's REAL front door (housegen's, map.houses) to within 0.8 m
                      of the lot's street line   [0]
  pitch-variety       every grid town of > 1 block has >= 3 distinct block pitches (adjacent block centres, rounded to 0.5 m) and every village street is
                      <= 7.5 m wide   [56 m / 10 m everywhere]
  clear-doors         0 props (not path stones, not fence / hedge pieces) within 1.5 m of an exterior door's swing (a 1.13 m disc about the door centre) or of
                      a path stone; 0 lots closed by their run (a fence / hedge piece on a path stone, or no gap >= 1.6 m at the path)
PLANTS (each must make its rows FAIL):
  bare-lots     towngen yardDressing() returns at once                                    -> yards, props-per-building
  fence-closed  YARD_GAP 2.6 -> 0 (the run is continuous across the path)                   -> clear-doors
  one-pitch     gridShifts returns no jog / shift (every block on the one PITCH lattice)   -> pitch-variety
"""
from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402

C = L.C
GATE = "w10_yards"
HERE = os.path.dirname(os.path.abspath(__file__))
MAPS = "isla_viva,ashgrid,deepwood"
SEEDS = "1,7,1234,2026"
TG = "runtime/3d/royale/towngen.js"
PLANTS = {
    "bare-lots": ({"yards", "props-per-building"}, [(TG, r"function yardDressing\(L, seed, add, out, homes\) \{\n", "function yardDressing(L, seed, add, out, homes) {\n  return;\n")]),
    "fence-closed": ({"clear-doors"}, [(TG, r"export const YARD_GAP = 2\.6;", "export const YARD_GAP = 0;")]),
    "one-pitch": ({"pitch-variety"}, [(TG, r"function gridShifts\(rng, cols, rows\) \{\n",
                                       "function gridShifts(rng, cols, rows) {\n  if (rng) return { J: 0, rowShift: new Array(rows).fill(0), colShift: new Array(cols).fill(0) };\n")]),
}

MJS = r'''
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf("--" + k); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(arg("root"));
const HARN = path.resolve(arg("harness"));
const MAPS = arg("maps").split(","), SEEDS = arg("seeds").split(",").map(Number), OUT = arg("out");
const { makeEnv } = await import(pathToFileURL(path.join(HARN, "world_env.mjs")).href);
const E = await makeEnv({ root: ROOT, vendor: arg("vendor", null) || undefined });
const { buildMap } = await E.importMaps();
const CK = await import(pathToFileURL(path.join(ROOT, "runtime", "3d", "royale", "citykit.js")).href);
const TGm = await import(pathToFileURL(path.join(ROOT, "runtime", "3d", "royale", "towngen.js")).href);
console.warn = () => {}; console.log = () => {};
const BLD = /^(suburban|commercial|skyscraper|lowdetail)\//, PATH = "props/yard-path", RUN = /^props\/yard-(fence|hedge)$/;
const builds = [];
const dRect = (f, x, z) => Math.hypot(Math.max(f.minX - x, 0, x - f.maxX), Math.max(f.minZ - z, 0, z - f.maxZ));
const dRR = (a, b) => Math.hypot(Math.max(a.minX - b.maxX, 0, b.minX - a.maxX), Math.max(a.minZ - b.maxZ, 0, b.minZ - a.maxZ));
const ovl = (a, b) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX) > 0.02 && Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ) > 0.02;
const tile = (e) => ({ minX: e.x - 0.6, maxX: e.x + 0.6, minZ: e.z - 0.6, maxZ: e.z + 0.6 });
for (const m of MAPS) for (const s of SEEDS) {
  globalThis.__LC_BOXES = null;
  const M = await buildMap(E.makeW(s), m);
  const lay = M.city.layout, kit = M.city.kit || [];
  const towns = lay.towns.filter((T) => T.blocks && T.blocks.length);
  const HP = TGm.PITCH / 2;
  const townOf = (x, z) => { for (const T of towns) for (const b of T.blocks) if (Math.abs(x - b.cx) <= HP && Math.abs(z - b.cz) <= HP) return T; return null; };
  const ents = [];
  for (const e of kit) { if (BLD.test(e.type)) continue; const T = townOf(e.x, e.z); if (!T) continue; ents.push({ e, T, f: e.type === PATH ? tile(e) : CK.footprintFor(e.type, e.x, e.z, e.rot, undefined, e.sy) }); }
  let nB = 0; for (const T of towns) for (const p of T.parcels) if (p.building) nB++;
  const lotOf = (T, x, z) => T.parcels.find((p) => x >= p.rect[0] - 1e-6 && x <= p.rect[2] + 1e-6 && z >= p.rect[1] - 1e-6 && z <= p.rect[3] + 1e-6);
  const runLots = new Set(); let nProps = 0; const types = {};
  for (const q of ents) {
    if (q.e.type === PATH) continue;
    if (!/^cars\//.test(q.e.type)) types[q.e.type] = (types[q.e.type] || 0) + 1;
    if (RUN.test(q.e.type)) { const p = lotOf(q.T, q.e.x, q.e.z); const k = q.T.id + ":" + (p ? p.id : "?"); if (!runLots.has(k)) { runLots.add(k); nProps++; } continue; }
    nProps++;
  }
  const houseBy = new Map(); for (const H of M.houses || []) houseBy.set(H.town + "@" + H.parcel, H);
  let homes = 0, withRun = 0, withPath = 0, yardOK = 0, closed = 0; const missEx = [];
  const lotsTiles = new Map(), lotsRun = new Map();
  for (const q of ents) {
    if (q.e.type !== PATH && !RUN.test(q.e.type)) continue;
    const p = lotOf(q.T, q.e.x, q.e.z); if (!p) continue;
    const k = q.T.id + "@" + p.id, M2 = q.e.type === PATH ? lotsTiles : lotsRun;
    if (!M2.has(k)) M2.set(k, []);
    M2.get(k).push(q);
  }
  for (const T of towns) for (const p of T.parcels) {
    const b = p.building;
    if (p.use !== "house" || !b || b.gen === "shell") continue;
    homes++;
    const k = T.id + "@" + p.id, tiles = lotsTiles.get(k) || [], run = lotsRun.get(k) || [];
    const fx = p.facing[0], fz = p.facing[1], lx = fz ? 1 : 0, lz = fz ? 0 : 1, S = (x, z) => x * fx + z * fz, Tt = (x, z) => x * lx + z * lz, r = p.rect;
    const sF = Math.max(S(r[0], r[1]), S(r[2], r[3]));
    let gapOK = false, stem = null;
    for (const q of tiles) if (!stem || S(q.e.x, q.e.z) > S(stem.e.x, stem.e.z)) stem = q;
    if (run.length && stem) {
      const ts = Tt(stem.e.x, stem.e.z);
      gapOK = run.every((q) => { const a = Tt(q.f.minX, q.f.minZ), c = Tt(q.f.maxX, q.f.maxZ); return Math.min(a, c) >= ts + 0.8 - 1e-6 || Math.max(a, c) <= ts - 0.8 + 1e-6; });
    }
    if (run.length) withRun++;
    const runOnPath = run.some((q) => tiles.some((t) => ovl(q.f, t.f)));
    if (run.length && (!gapOK || runOnPath)) closed++;
    const H = houseBy.get(T.id + "@" + p.id);
    const fd = H ? (H.doors || []).find((d) => d.kind === "front") : null;
    let pathOK = false;
    if (fd && tiles.length) {
      const n = tiles.length, par = tiles.map((_, i) => i), find = (i) => (par[i] === i ? i : (par[i] = find(par[i])));
      for (let a = 0; a < n; a++) for (let c = a + 1; c < n; c++) if (dRR(tiles[a].f, tiles[c].f) <= 0.05) par[find(a)] = find(c);
      const atDoor = [], atStreet = new Set();
      tiles.forEach((t, i) => {
        if (dRect(t.f, fd.x, fd.z) <= 0.35) atDoor.push(find(i));
        if (sF - Math.max(S(t.f.minX, t.f.minZ), S(t.f.maxX, t.f.maxZ)) <= 0.8) atStreet.add(find(i));
      });
      pathOK = atDoor.some((c) => atStreet.has(c));
    }
    if (pathOK) withPath++;
    if (run.length && gapOK && !runOnPath && pathOK) yardOK++;
    else if (missEx.length < 4) missEx.push(k + (run.length ? "" : " no-run") + (run.length && !gapOK ? " no-gap" : "") + (pathOK ? "" : fd ? " no-path" : " no-front-door"));
  }
  const props = ents.filter((q) => q.e.type !== PATH && !RUN.test(q.e.type) && Number.isFinite(q.f.minX));
  const allTiles = ents.filter((q) => q.e.type === PATH);
  let nearDoor = 0, nearPath = 0; const clrEx = [], doorTypes = {}, pathTypes = {};
  const tset = new Set(towns.map((t) => t.id));
  for (const H of M.houses || []) {
    if (!tset.has(H.town)) continue;
    for (const d of H.doors || []) {
      if (d.kind !== "front" && d.kind !== "back") continue;
      for (const q of props) { const dd = dRect(q.f, d.x, d.z); if (dd < 1.13 + 1.5) { nearDoor++; doorTypes[q.e.type] = (doorTypes[q.e.type] || 0) + 1; if (clrEx.length < 4) clrEx.push(q.e.type + " " + dd.toFixed(2) + " m from the " + d.kind + " door of " + H.town + "@" + H.parcel); } }
    }
  }
  for (const t of allTiles) for (const q of props) { const dd = dRR(q.f, t.f); if (dd < 1.5) { nearPath++; pathTypes[q.e.type] = (pathTypes[q.e.type] || 0) + 1; if (clrEx.length < 6) clrEx.push(q.e.type + " " + dd.toFixed(2) + " m from a path stone at " + t.e.x + "," + t.e.z); } }
  const tw = [];
  for (const T of towns) {
    const P = new Set();
    for (const a of T.blocks) for (const c of T.blocks) {
      if (c.j === a.j && c.i === a.i + 1) P.add(Math.round(Math.abs(c.cx - a.cx) * 2) / 2);
      if (c.i === a.i && c.j === a.j + 1) P.add(Math.round(Math.abs(c.cz - a.cz) * 2) / 2);
    }
    const wmax = Math.max(0, ...((T.roads && T.roads.edges) || []).map((e) => e.width || 0));
    tw.push({ id: T.id, kind: T.kind, theme: T.theme, blocks: T.blocks.length, pitches: [...P].sort((x, y) => x - y), roadW: wmax });
  }
  builds.push({ map: m, seed: s, buildings: nB, props: nProps, types, homes, withRun, withPath, yardOK, closed, missEx, nearDoor, nearPath, clrEx, doorTypes, pathTypes, towns: tw, paths: allTiles.length });
  try { M.dispose && M.dispose(); } catch (e) {}
}
fs.writeFileSync(OUT, JSON.stringify({ builds, genVersion: TGm.VERSION }));
'''


def planted_root(src, plant):
    """a scratch copy of <src>/runtime + assets/props + assets/vendor with the plant's edits (each anchor must match exactly once)"""
    dst = tempfile.mkdtemp(prefix="lc_w10yards_%s_" % plant)
    for part in ("runtime", os.path.join("assets", "props"), os.path.join("assets", "vendor")):
        if os.path.isdir(os.path.join(src, part)):
            shutil.copytree(os.path.join(src, part), os.path.join(dst, part))
    for rel, rx, rep in PLANTS[plant][1]:
        fn = os.path.join(dst, rel.replace("/", os.sep))
        with open(fn, encoding="utf-8") as fh:
            s = fh.read()
        n = len(re.findall(rx, s))
        if n != 1:
            raise C.EnvFailure("plant %s: anchor %r matched %d times in %s (the tree moved: re-anchor the plant)" % (plant, rx, n, rel))
        s = re.sub(rx, lambda _m: rep, s)
        with open(fn, "w", encoding="utf-8") as fh:
            fh.write(s)
    return dst


def probe(root, maps, seeds):
    fn = os.path.join(tempfile.gettempdir(), "lc_w10yards_probe_%d.mjs" % os.getpid())
    with open(fn, "w", encoding="utf-8") as fh:
        fh.write(MJS)
    argv = [fn, "--root", root, "--harness", os.path.dirname(HERE), "--maps", maps, "--seeds", seeds, "--vendor", os.path.join(root, "assets", "vendor", "three")]
    data, tail, secs = L.run_node(argv, timeout=3600)
    if not data:
        raise C.EnvFailure("yards probe produced no report: %s" % (tail or "")[-600:])
    data["secs"] = secs
    return data


def judge(v, d):
    B = d["builds"]
    if not B:
        v.cnj("census", "no builds")
        return
    v.info("census", {"builds": len(B), "genVersion": d.get("genVersion"), "secs": round(d.get("secs") or 0, 1),
                      "paths": sum(b["paths"] for b in B), "homes": sum(b["homes"] for b in B)})
    parts, bad = [], []
    for m in sorted({b["map"] for b in B}):
        R = [b for b in B if b["map"] == m]
        pr, bd = sum(b["props"] for b in R), sum(b["buildings"] for b in R)
        ratio = pr / bd if bd else 0
        parts.append("%s %d / %d = %.2f" % (m, pr, bd, ratio))
        if ratio < 2.0:
            bad.append(m)
    types = {}
    for b in B:
        for k, n in b["types"].items():
            types[k] = types.get(k, 0) + n
    v.check("props-per-building", not bad and len(types) >= 18, "%s; %d non-car prop types: %s" % ("; ".join(parts), len(types), ", ".join(sorted(types))),
            ">= 2.0 per building every map; >= 18 types")
    homes = sum(b["homes"] for b in B)
    ok = sum(b["yardOK"] for b in B)
    ex = [e for b in B for e in b["missEx"]][:4]
    v.check("yards", homes > 0 and 100.0 * ok / homes >= 70.0,
            "%d of %d homes (%.1f %%) have a run with a gap at the path and a door path from the real front door; run %d, door path %d%s" % (
                ok, homes, 100.0 * ok / max(1, homes), sum(b["withRun"] for b in B), sum(b["withPath"] for b in B), (" e.g. " + "; ".join(ex)) if ex else ""), ">= 70 %")
    few, wide = [], []
    for b in B:
        for t in b["towns"]:
            if len(t["pitches"]) < 3 and t["blocks"] > 1:
                few.append("%s s%d %s %s" % (b["map"], b["seed"], t["id"], "/".join("%g" % p for p in t["pitches"])))
            if t["kind"] == "village" and t["roadW"] > 7.5:
                wide.append("%s s%d %s %g m" % (b["map"], b["seed"], t["id"], t["roadW"]))
    ntown = sum(1 for b in B for t in b["towns"] if t["blocks"] > 1)
    v.check("pitch-variety", not few and not wide, "%d of %d grid towns with < 3 block pitches (e.g. %s); %d village streets > 7.5 m (e.g. %s)" % (
        len(few), ntown, "; ".join(few[:3]) or "-", len(wide), "; ".join(wide[:2]) or "-"), ">= 3 pitches every grid town; village streets <= 7.5 m")
    nd, np_, cl = sum(b["nearDoor"] for b in B), sum(b["nearPath"] for b in B), sum(b["closed"] for b in B)
    ex = [e for b in B for e in b["clrEx"]][:4]
    dt, pt = {}, {}
    for b in B:
        for k, n in b.get("doorTypes", {}).items():
            dt[k] = dt.get(k, 0) + n
        for k, n in b.get("pathTypes", {}).items():
            pt[k] = pt.get(k, 0) + n
    fmt = lambda t: ", ".join("%s %d" % (k.split("/")[-1], n) for k, n in sorted(t.items(), key=lambda kv: -kv[1])) or "-"
    v.check("clear-doors", nd == 0 and np_ == 0 and cl == 0, "props within 1.5 m of a door swing %d (%s), of a path stone %d (%s); lots closed by their run %d%s" % (
        nd, fmt(dt), np_, fmt(pt), cl, (" e.g. " + "; ".join(ex)) if ex else ""), "0 / 0 / 0")


def main_fn(v, args):
    root, label = L.node_root(args)
    if args.plant:
        root = planted_root(root, args.plant)
        label += " + plant " + args.plant
        v.note("plant %s: rows that must FAIL: %s" % (args.plant, ", ".join(sorted(PLANTS[args.plant][0]))))
    v.data["tree"] = label
    d = probe(root, args.maps, args.seeds)
    v.data["builds"] = d["builds"]
    judge(v, d)
    if args.plant:
        must = PLANTS[args.plant][0]
        for r in v.rows:
            if r["kind"] == "gate" and r["name"] not in must and r["ok"] is not None:
                r["kind"] = "info"          # under a plant only the designated rows count (exit 1 = the fault was caught)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, PLANTS.keys())
    ap.add_argument("--maps", default=MAPS)
    ap.add_argument("--seeds", default=SEEDS)
    args = L.parse(ap)
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
