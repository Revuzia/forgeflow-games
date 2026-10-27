#!/usr/bin/env python
"""themeshots - what do the kit's town THEMES (resort = Isla Viva, lodge = Deepwood, city = Savanna) look like, as a player sees them?
(world-plan 2026-10, Wave 7b stage A, lane B3.  New file; nothing else in _harness/ is touched.)

    python _harness/themeshots.py --disk --label after                       # the working copy -> _harness/_shots/themes_after_*.png
    python _harness/themeshots.py --rev 1b445153 --label before              # a frozen build (the "before" column)
    python _harness/themeshots.py --disk --theme-overlay DIR --label try     # serve DIR/<game-relative path> over the working copy
                                                                             # (a generator run into DIR via art_b_city.py --out-root, a patched citykit.js, ...)
    python _harness/themeshots.py --disk --themes resort,lodge,city --shots DIR --label after

One Chrome boots the game to the MENU (no match), stops the kernel loop and builds a THROWAWAY THREE.Scene (own camera, lights, ground) that the game's own
renderer draws, the way citykit_probe.py does.  citykit.js / towngen.js / manifest.json / palettes come from whatever is SERVED, so the sheet shows exactly
what the game would draw: THEME_TYPES (citykit.js) picks the building types per role, towngen.js THEMES picks the palette variant per parcel (paletteFor),
citykit.js THEMES gives the district default + tint.  Every entry carries its variant explicitly, and the sheet counts the ones citykit silently ignores
(a variant name that is not in citykit's VARIANT_ORDER falls back to the district theme: the "variants-resolve" row).

Scenes (per theme), each drawn from the SAME kit placement:
  town     3 x 2 street-grid blocks (towngen pitch 56 m, 10 m roads, 3 m sidewalks), a row of kit buildings on each block side facing its street, lamp posts,
           hydrants and parked cars; cameras: street (2.8 m), hero (a 3/4 view of two frontages), air (240 m
           up, 150 m back, every district at detail); then with the REAL LOD the drop cameras (330 m up, 500 m and 330 m back), where every district is its far proxy
  lineup   every colourway of the theme side by side: a house, a shop and a big building behind each
  catalog  every building type of the theme's roles (rows = palette variants of the theme, columns = types), one camera 3/4 from the front

Rows (exit 0 pass / 1 fail / 2 could-not-judge):
  boot                  the game reaches the menu, citykit.js / towngen.js import, 0 page / console / shader errors and 0 failed requests over the whole run
  <T>-variants-resolve  every palette variant the theme's towngen table names resolves to itself in citykit.resolvePalette (none silently ignored)
  <T>-colourways        distinct (palette key, variant) colourways a town of the theme draws: houses >= 5, big buildings (shops / mid-rises / halls) >= 3  (resort, lodge)
  <T>-types             no building type outside the theme's character (skyscrapers / the skyline silhouettes are for the city theme only; a lodge has no mid-rise)
  <T>-draws             every view drew (calls > 0, triangles > 0) and compiled 0 new shader programs on its second frame
  resort-look           the colours a player sees, from the SERVED palette PNGs at the swatches the buildings' UVs use (wall (3,1), roof (0,0)): light walls (lightness >= 0.62
                        in 80 % of the colourways) in >= 4 distinct pastel hues (not white), AND at least one coral / terracotta roof AND one teal / blue roof
  lodge-look            warm timber walls (lightness <= 0.55 and a saturated hue under 55 degrees in the bars below) AND dark roofs (lightness <= 0.42 in 60 %)
  lodge-timber          the lodge's suburban wall swatches carry horizontal boards (>= 8 board gaps over a storey) in >= 4 colourways
  <T>-tables-in-sync    manifest.json `themes` (written by _tools/art_b_city.py) equals the served towngen.js THEMES lists, citykit.js THEMES default and THEME_TYPES
  INFO                  textures a theme loads, the colour of every colourway as served; the city theme is the control and only reports

Screenshots (LOOK at them): themes_<label>_<theme>_{street,hero,drop,air,lineup,catalog}.png
"""
from __future__ import annotations

import argparse
import colorsys
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402

GATE = "themeshots"

PROBE_JS = r"""
() => {
  const C = window.__LC__, W = C.W, THREE = W.THREE, K = W.kernel, R = K.renderer;
  const U = (p) => new URL(p, W.assetBase).href;
  let CK = null, TG = null, MAN = null, S = null, KIT = null, CUR = null;
  const GROUND = { resort: 0xd9cba3, lodge: 0x59683f, city: 0xb2a98a, farm: 0xa89f6a, ruin: 0x8d8777, mill: 0x59683f };
  const PITCH = 56, ROAD = 10, SW = 3, HALFB = (PITCH - ROAD) / 2;
  const r3 = (v) => Math.round(v * 1000) / 1000;
  async function load() {
    if (!CK) CK = await import(U("runtime/3d/royale/citykit.js"));
    if (!TG) { try { TG = await import(U("runtime/3d/royale/towngen.js")); } catch (e) { TG = { error: String(e && e.message || e) }; } }
    if (!MAN) MAN = await (await fetch(U("assets/props/city/manifest.json"), { cache: "no-cache" })).json();
    return { ck: Object.keys(CK).length, tg: TG && !TG.error, tgError: TG && TG.error || null };
  }
  function scene(theme) {
    if (!S) {
      const sc = new THREE.Scene();
      sc.background = new THREE.Color(0x9cc7e8);
      sc.fog = new THREE.Fog(0xb9d3e6, 500, 3200);
      sc.add(new THREE.HemisphereLight(0xbfdcff, 0x8a8470, 2.6));
      const sun = new THREE.DirectionalLight(0xfff0d8, 2.6); sun.position.set(-300, 500, 200); sun.target.position.set(0, 0, 0);
      sc.add(sun); sc.add(sun.target);
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ color: 0xb2a98a, roughness: 1, metalness: 0 }));
      ground.rotation.x = -Math.PI / 2; ground.position.set(0, -0.03, 0); ground.name = "probe-ground"; sc.add(ground);
      S = { scene: sc, cam: new THREE.PerspectiveCamera(57, 16 / 9, 0.3, 8000), ground, extras: [] };
    }
    S.ground.material.color.setHex(GROUND[theme] || 0xb2a98a);
    return S;
  }
  function clearScene() {
    if (KIT) { try { KIT.dispose(); } catch (e) {} KIT = null; }
    if (S) { for (const o of S.extras) { S.scene.remove(o); if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); } S.extras = []; }
  }
  const mat = (hex) => new THREE.MeshStandardMaterial({ color: hex, roughness: 1, metalness: 0 });
  function slab(x, y, z, w, h, d, hex) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(hex)); m.position.set(x, y + h / 2, z); S.extras.push(m); S.scene.add(m); return m;
  }
  const B = (id) => MAN.types[id].bbox_m;
  const turn = (q) => q % 2 === 1;
  // the variants a theme's towngen table names for a palette key (null = the base colormap)
  function variantsOf(theme, big) {
    const t = TG && TG.THEMES && (TG.THEMES[theme] || TG.THEMES.city);
    if (!t) return [null];
    return (big ? t.big : t.house)[1].slice();
  }
  const keyOfType = (id) => (MAN.types[id] && MAN.types[id].palette) || null;
  // ---------------------------------------------------------------- the town scene
  function planTown(theme, cols, rows) {
    const TT = CK.THEME_TYPES[theme] || CK.THEME_TYPES.city;
    const roleList = (r) => (TT[r] && TT[r].length ? TT[r] : null);
    const pattern = ["house", "house", "shop", "house", "midrise", "house", "house", "warehouse", "house", "shop"];
    const hv = variantsOf(theme, false), bv = variantsOf(theme, true);
    const plan = [], cnt = { house: 0, shop: 0, midrise: 0, warehouse: 0, tower: 0 };
    let k = 0;
    for (let bj = 0; bj < rows; bj++) for (let bi = 0; bi < cols; bi++) {
      const cx = bi * PITCH, cz = bj * PITCH;
      for (const side of [-1, 1]) {                                   // -1 = the north row (faces -z), +1 = the south row (faces +z)
        let cursor = -HALFB + 2;
        const q = side < 0 ? 2 : 0;
        for (let guard = 0; guard < 12; guard++) {
          let role = pattern[(k++) % pattern.length];
          if (!roleList(role)) role = "house";
          const list = roleList(role) || roleList("house");
          const id = list[(cnt[role]++) % list.length];
          const b = B(id), w = b.x, d = b.z;
          if (cursor + w > HALFB - 1) break;
          const big = role !== "house";
          const vs = big ? bv : hv, v = vs[(k + bi + bj) % vs.length];
          const along = cursor + w / 2, depth = Math.min(d, 17);
          plan.push({ id, role, variant: v, x: cx + along, z: cz + side * (HALFB - SW - 0.4 - d / 2), q, key: keyOfType(id), big });
          cursor += w + 2.2;
        }
      }
    }
    return plan;
  }
  async function setupTown(theme, opt) {
    await load(); clearScene(); const sc = scene(theme);
    opt = opt || {};
    const lod = opt.lod || "detail";
    const cols = opt.cols || 3, rows = opt.rows || 2;
    const plan = planTown(theme, cols, rows);
    const list = [];
    const extra = { lamps: 0, cars: 0, hyd: 0 };
    for (const p of plan) list.push({ type: p.id, x: p.x, y: 0, z: p.z, rot: p.q, district: "T:" + theme, palette: p.variant || "base" });
    // street furniture and parked cars (kit props, so the scene is the kit's real draw cost)
    const carTypes = ["cars/sedan", "cars/suv", "cars/taxi", "cars/van", "cars/hatchback-sports", "cars/truck"];
    const carTint = [0xb8322e, 0x2f5f9e, 0xe6e2d6, 0x3b3f46, 0x2e7d5b, 0xd8a237, 0x8a8f99];
    let ci = 0;
    for (let bj = 0; bj < rows; bj++) for (let bi = 0; bi < cols; bi++) {
      const cx = bi * PITCH, cz = bj * PITCH;
      for (const side of [-1, 1]) {
        const zs = cz + side * (HALFB + SW / 2 + 0.2 + 0.0);
        for (let t = -HALFB + 8; t < HALFB; t += 22) { list.push({ type: "props/light-curved", x: cx + t, y: 0, z: cz + side * (HALFB - 0.3), rot: side < 0 ? 2 : 0, district: "T:" + theme + ":street" }); extra.lamps++; }
        list.push({ type: "props/hydrant", x: cx + HALFB - 4, y: 0, z: cz + side * (HALFB - 0.5), rot: 0, district: "T:" + theme + ":street" }); extra.hyd++;
        for (let t = -HALFB + 6; t < HALFB - 6; t += 17 + (ci % 3) * 4) {
          list.push({ type: carTypes[ci % carTypes.length], x: cx + t, y: 0, z: cz + side * (HALFB + 2.4), rot: side < 0 ? 1 : 3, district: "T:" + theme + ":street", tint: carTint[ci % carTint.length] }); ci++; extra.cars++;
        }
      }
    }
    // roads, sidewalks (flat slabs)
    const W0 = (cols - 1) * PITCH + PITCH, H0 = (rows - 1) * PITCH + PITCH;
    const x0 = -PITCH / 2, z0 = -PITCH / 2, x1 = x0 + W0, z1 = z0 + H0;
    for (let bj = 0; bj <= rows; bj++) slab((x0 + x1) / 2, 0, z0 + bj * PITCH, W0, 0.06, ROAD, 0x3b3e43);
    for (let bi = 0; bi <= cols; bi++) slab(x0 + bi * PITCH, 0, (z0 + z1) / 2, ROAD, 0.06, H0, 0x3b3e43);
    for (let bj = 0; bj < rows; bj++) for (let bi = 0; bi < cols; bi++) slab(bi * PITCH, 0, bj * PITCH, PITCH - ROAD, 0.1, PITCH - ROAD, 0xb9b6ac);
    const districts = {}; districts["T:" + theme] = { theme }; districts["T:" + theme + ":street"] = { theme };
    KIT = CK.createCityKit({ THREE, kernel: K, assetBase: W.assetBase });
    const res = await KIT.place(list, { parent: sc.scene, districts, lod });
    sc.sun = sc.sun || null;
    const st = KIT.stats();
    const cx = (cols - 1) * PITCH / 2, cz = (rows - 1) * PITCH / 2;
    CUR = { kind: "town", theme, cols, rows, cx, cz, x0, x1, z0, z1 };
    return summary(theme, plan, res, st, { cx, cz, w: W0, h: H0, extra });
  }
  // ---------------------------------------------------------------- the lineup scene: every colourway of the theme side by side (house, shop, big building behind each)
  async function setupLineup(theme) {
    await load(); clearScene(); const sc = scene(theme);
    const TT = CK.THEME_TYPES[theme] || CK.THEME_TYPES.city;
    const hv = variantsOf(theme, false), bv = variantsOf(theme, true), nV = Math.max(hv.length, bv.length);
    const houses = TT.house || [], shops = TT.shop || [], bigs = TT.midrise || TT.warehouse || [];
    const plan = [], list = [], pitch = 19;
    for (let i = 0; i < nV; i++) {
      const rows = [[houses[i % houses.length], hv, 0, false], [shops[0] || houses[0], bv, -17, true], [bigs.length ? bigs[i % bigs.length] : null, bv, -40, true]];
      for (const [id, vs, z, big] of rows) {
        if (!id) continue;
        const v = vs[i % vs.length];
        plan.push({ id, variant: v, key: keyOfType(id), big, role: big ? "big" : "house", x: i * pitch, z });
        list.push({ type: id, x: i * pitch, y: 0, z, rot: 0, district: "T:" + theme + ":line", palette: v || "base" });
      }
    }
    const districts = {}; districts["T:" + theme + ":line"] = { theme };
    KIT = CK.createCityKit({ THREE, kernel: K, assetBase: W.assetBase });
    const res = await KIT.place(list, { parent: sc.scene, districts, lod: "detail" });
    const st = KIT.stats();
    const w = (nV - 1) * pitch;
    CUR = { kind: "lineup", theme, w, n: nV, pitch };
    return summary(theme, plan, res, st, { cx: w / 2, cz: -14, w, h: 40, nV });
  }
  // ---------------------------------------------------------------- the catalogue scene
  async function setupCatalog(theme) {
    await load(); clearScene(); const sc = scene(theme);
    const TT = CK.THEME_TYPES[theme] || CK.THEME_TYPES.city;
    const types = []; for (const r of Object.keys(TT)) for (const id of TT[r]) if (types.indexOf(id) < 0 && MAN.types[id] && MAN.types[id].kind === "building") types.push(id);
    const hv = variantsOf(theme, false), bv = variantsOf(theme, true);
    const nV = Math.max(hv.length, bv.length);
    const colW = Math.max(...types.map((id) => Math.max(B(id).x, B(id).z))) + 3, rowW = Math.max(...types.map((id) => Math.min(B(id).x, B(id).z))) + 5;
    const plan = [], list = [];
    types.forEach((id, i) => {
      const big = keyOfType(id) === "commercial";
      const vs = big ? bv : hv;
      for (let r = 0; r < nV; r++) { const v = vs[r % vs.length]; plan.push({ id, variant: v, key: keyOfType(id), big, role: big ? "big" : "house", x: i * colW, z: r * rowW }); list.push({ type: id, x: i * colW, y: 0, z: r * rowW, rot: 0, district: "T:" + theme + ":cat", palette: v || "base" }); }
    });
    const districts = {}; districts["T:" + theme + ":cat"] = { theme };
    KIT = CK.createCityKit({ THREE, kernel: K, assetBase: W.assetBase });
    const res = await KIT.place(list, { parent: sc.scene, districts, lod: "detail" });
    const st = KIT.stats();
    const w = (types.length - 1) * colW, h = (nV - 1) * rowW;
    CUR = { kind: "catalog", theme, w, h, types: types.length, rows: nV };
    return summary(theme, plan, res, st, { cx: w / 2, cz: h / 2, w, h, types, nV });
  }
  function summary(theme, plan, res, st, extra) {
    const requested = {}, resolved = {}, unresolved = [];
    for (const p of plan) {
      if (!p.key) continue;
      const want = p.variant || "base", got = CK.resolvePalette(p.key, want, theme).variant;
      const k = p.key + ":" + want; requested[k] = (requested[k] || 0) + 1;
      if (got !== want) unresolved.push(k);
    }
    const groups = []; for (const d of Object.values(st.districts)) for (const g of d.groups) groups.push(g.type + "=" + g.palette);
    const mats = new Set(); S.scene.traverse((q) => { if (q.isInstancedMesh && q.name.startsWith("kit:") && q.userData.kitType) mats.add(q.material); });
    return { theme, n: plan.length, entries: plan.length, failed: res.failed.length, skipped: res.skipped.length, colliders: res.colliders.length, requested,
      unresolved: Array.from(new Set(unresolved)), types: Array.from(new Set(plan.map((p) => p.id))).sort(), groups, totals: st.totals,
      materials: mats.size, textures: st.totals.textures, textureNames: Array.from(new Set(Array.from(mats).map((m) => m.map && m.map.name))).sort(),
      tints: Array.from(new Set(Array.from(mats).map((m) => m.color.getHexString()))).sort(), extra };
  }
  // ---------------------------------------------------------------- cameras and shots
  function view(name) {
    const c = CUR;
    if (c.kind === "catalog") {
      const d = Math.max(c.w * 0.5, c.h * 1.1, 40);
      return { pos: [c.w / 2 + d * 0.08, 8 + d * 0.5, c.h + d * 0.78], look: [c.w / 2, 3, c.h / 2 + 2], fov: 50 };
    }
    if (c.kind === "lineup") return { pos: [c.w / 2, 15, 22 + c.w * 0.40], look: [c.w / 2, 5, -16], fov: 52 };
    const zStreet = c.z0 + PITCH;                                      // the E-W street between the two block rows
    if (name === "street") return { pos: [c.x0 + 4, 2.8, zStreet + 3.2], look: [c.cx + 40, 5.5, zStreet - 1] };
    if (name === "street2") return { pos: [c.x1 - 4, 2.8, zStreet - 3.2], look: [c.cx - 40, 5.5, zStreet + 1] };
    if (name === "hero") return { pos: [c.cx - 24, 5.2, c.cz + PITCH / 2 + 22], look: [c.cx - 8, 5.5, c.cz + PITCH / 2 - HALFB + 14], fov: 62 };
    if (name === "drop") return { pos: [c.cx, 330, c.cz + 500], look: [c.cx, 0, c.cz] };
    if (name === "drop2") return { pos: [c.cx, 330, c.cz + 330], look: [c.cx, 0, c.cz] };
    if (name === "air") return { pos: [c.cx, 240, c.cz + 150], look: [c.cx, 0, c.cz - 4], fov: 60 };
    if (name === "cross") return { pos: [c.cx + 2, 2.8, c.cz - 6], look: [c.cx + 2, 6, c.cz + 80] };
    throw new Error("unknown view " + name);
  }
  function shot(name, o) {
    o = o || {};
    const v = typeof name === "string" ? view(name) : name, sz = R.getSize(new THREE.Vector2()), cam = S.cam;
    cam.position.set(v.pos[0], v.pos[1], v.pos[2]); cam.up.set(0, 1, 0); cam.lookAt(v.look[0], v.look[1], v.look[2]);
    cam.fov = v.fov || 57; cam.far = v.far || 8000; cam.aspect = sz.x / Math.max(1, sz.y); cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    R.info.reset();
    const p0 = R.info.programs ? R.info.programs.length : 0;
    R.setRenderTarget(null); R.render(S.scene, cam);
    const i = R.info;
    return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs ? i.programs.length : null, newPrograms: i.programs ? i.programs.length - p0 : null };
  }
  function tables() {
    const t = {};
    for (const th of Object.keys(CK.THEMES)) {
      const tg = TG && TG.THEMES && TG.THEMES[th];
      t[th] = { ck: CK.THEMES[th], types: CK.THEME_TYPES[th] || null, tgHouse: tg ? tg.house : null, tgBig: tg ? tg.big : null, tgShell: tg ? tg.shell : null };
    }
    return t;
  }
  function manifestInfo() {
    const out = { variants: {}, themes: MAN.themes || null, swatchUse: MAN.swatch_use || null };
    for (const k of ["suburban", "commercial"]) { const p = MAN.palettes[k]; out.variants[k] = { base: { file: p.file, bytes: p.bytes }, ...Object.fromEntries(Object.entries(p.variants || {}).map(([n, v]) => [n, { file: v.file, bytes: v.bytes }])) }; }
    return out;
  }
  function dispose() { clearScene(); return true; }
  return { load, setupTown, setupCatalog, setupLineup, shot, view, tables, manifestInfo, dispose };
}
"""


def install(s):
    s.freeze_loop()
    keys = s.js("() => { window.__THEMES__ = (" + PROBE_JS + ")(); return Object.keys(window.__THEMES__); }")
    if not keys or "setupTown" not in keys:
        raise C.HarnessError("themeshots probe did not install: %s" % keys)


def overlay_route(s, overlay):
    """serve DIR/<path relative to the game dir> over the game's own file when it exists (a generator run, a patched citykit.js ...)"""
    if not overlay:
        return []
    served = []

    def rel_of(url):
        p = url.split("?")[0]
        i = p.find(C.GAME_PATH)
        return None if i < 0 else p[i + len(C.GAME_PATH):]

    def pred(u):
        r = rel_of(u)
        return bool(r) and os.path.isfile(os.path.join(overlay, r.replace("/", os.sep)))

    def handler(route):
        r = rel_of(route.request.url)
        fp = os.path.join(overlay, r.replace("/", os.sep))
        with open(fp, "rb") as f:
            body = f.read()
        served.append(r)
        ext = os.path.splitext(fp)[1].lower()
        route.fulfill(status=200, body=body, headers={"Content-Type": C.CTYPES.get(ext, "application/octet-stream"), "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"})

    s.disk.overrides.append((pred, handler))
    return served


def take(s, shots, label, th, name, row, again=True):
    """draw view `name` of the current scene (warm frame first), save the canvas of the SAME task, optionally draw it once more to count new shader programs"""
    row["views"][name] = s.js("(a) => window.__THEMES__.shot(a)", name)
    path = os.path.join(shots, "themes_%s_%s_%s.png" % (label, th, name))
    s.canvas_png(path, "window.__THEMES__.shot(%s)" % json.dumps(name))
    row["views"][name]["png"] = path
    if again:
        row["views"][name]["again"] = s.js("(a) => window.__THEMES__.shot(a)", name)


def main_fn(v, args):
    shots = args.shots or C.SHOTS
    os.makedirs(shots, exist_ok=True)
    themes = [t for t in args.themes.split(",") if t]
    label = args.label
    s = C.Session(args, name="themeshots")
    s.start()
    if not s.disk:
        raise C.EnvFailure("themeshots serves through page routing: run it with --disk (or --rev)")
    overlay_served = overlay_route(s, args.theme_overlay)
    s.page.set_default_timeout(900_000)
    out = {}
    try:
        s.boot()
        install(s)
        s.stage("load")
        ld = s.js("() => window.__THEMES__.load()")
        v.data["load"] = ld
        tabs = s.js("() => window.__THEMES__.tables()")
        man = s.js("() => window.__THEMES__.manifestInfo()")
        v.data["tables"], v.data["manifest"] = tabs, man
        for th in themes:
            row = {"views": {}}
            s.stage("town-" + th)
            row["town"] = s.js("(t) => window.__THEMES__.setupTown(t, { lod: 'detail' })", th)
            for vw in [x for x in args.views.split(",") if x]:
                take(s, shots, label, th, vw, row)
            s.stage("far-" + th)
            row["townFar"] = s.js("(t) => window.__THEMES__.setupTown(t, { lod: 'auto' })", th)        # the real LOD: from the drop camera the districts are their far proxies
            for vw in [x for x in args.far_views.split(",") if x]:
                take(s, shots, label, th, vw, row)
            s.stage("lineup-" + th)
            row["lineup"] = s.js("(t) => window.__THEMES__.setupLineup(t)", th)
            take(s, shots, label, th, "lineup", row)
            s.stage("catalog-" + th)
            row["catalog"] = s.js("(t) => window.__THEMES__.setupCatalog(t)", th)
            take(s, shots, label, th, "catalog", row)
            out[th] = row
        s.js("() => window.__THEMES__.dispose()")
        diag = s.diagnostics()
    finally:
        s.close()
    v.data["scenes"] = out
    v.data["overlayServed"] = sorted(set(overlay_served))
    v.data["shots"] = {th: {k: x.get("png") for k, x in out[th]["views"].items()} for th in out}

    problems = C.diag_problems(diag, rig=False)
    v.check("boot", ld["tg"] and not problems, "citykit.js imported (%d exports), towngen.js %s; %s" % (
        ld["ck"], "imported" if ld["tg"] else "FAILED: %s" % ld.get("tgError"), ", ".join(problems) or "0 page / console / shader errors, 0 failed requests"))

    for th in themes:
        T, Cc, Ln = out[th]["town"], out[th]["catalog"], out[th]["lineup"]
        unresolved = sorted(set(T["unresolved"] + Cc["unresolved"] + Ln["unresolved"]))
        v.check("%s-variants-resolve" % th, not unresolved,
                "variants the theme's towngen table names: %s; silently ignored by citykit.resolvePalette: %s" % (sorted(T["requested"]), unresolved or "none"))
        houses = sorted(k for k in T["requested"] if k.startswith("suburban:"))
        bigs = sorted(k for k in T["requested"] if k.startswith("commercial:"))
        cw_detail = "house colourways %d (bar %d): %s; big-building colourways %d (bar %d): %s" % (len(houses), args.min_house, houses, len(bigs), args.min_big, bigs)
        if th in ("resort", "lodge"):
            v.check("%s-colourways" % th, len(houses) >= args.min_house and len(bigs) >= args.min_big, cw_detail)
        else:
            v.info("%s-colourways (control, no bar)" % th, cw_detail)
        types = T["types"]
        sky = [t for t in types if t.startswith("skyscraper/") or t.startswith("lowdetail/")]
        mids = [t for t in types if t in ("commercial/building-i", "commercial/building-m")]
        bad = sky + mids if th != "city" else []
        if th == "lodge":
            bad = bad + [t for t in types if t in ("commercial/building-a", "commercial/building-f", "commercial/building-h")]
        v.check("%s-types" % th, not bad and T["failed"] == 0 and T["skipped"] == 0,
                "%d building / prop types drawn; outside the theme's character: %s; failed %d, skipped %d" % (len(types), bad or "none", T["failed"], T["skipped"]))
        vs = out[th]["views"]
        news = [vs[k].get("again", {}).get("newPrograms") for k in vs if "again" in vs[k]]
        v.check("%s-draws" % th, all(vs[k]["calls"] > 0 and vs[k]["triangles"] > 0 for k in vs) and not any(news),
                "calls/triangles per view %s; new programs on the second frame of each view: %s" % ({k: (vs[k]["calls"], vs[k]["triangles"]) for k in vs}, news))
        v.info("%s kit cost" % th, "town: %d buildings, %d materials, %d textures %s, tints %s" % (T["entries"], T["materials"], T["textures"], T["textureNames"], T["tints"]))

    look_rows(v, man, tabs, themes, args)
    v.info("screenshots", ", ".join(p for th in v.data["shots"] for p in v.data["shots"][th].values()))


# ------------------------------------------------------------------------------------------------ look audit (the SERVED palette PNGs, no browser pixels)
# Which swatch of the suburban / commercial colormaps is a wall, a roof or the trim was measured with a debug colormap (art_b_city.py SWATCH_USE; the same cells in every
# frozen build, so the audit can judge any revision). Colours are the MEAN of the 64 x 128 swatch (its light -> dark ramp averaged), sRGB.
CELLS = {"wall": (3, 1), "roof": (0, 0), "trim": (0, 1)}


def _hsl(rgb):
    r, g, b = [c / 255.0 for c in rgb]
    h, l, sat = colorsys.rgb_to_hls(r, g, b)
    return h * 360.0, sat, l


def swatch_mean(img, cell):
    import numpy as np
    col, row = cell
    a = np.asarray(img.crop((col * 64, 128 + row * 128, col * 64 + 64, 128 + row * 128 + 128))).reshape(-1, 3).mean(0)
    return tuple(int(round(x)) for x in a)


def board_gaps(img, cell, period):
    """number of horizontal board gaps painted into a swatch: rows whose luminance is >= 10 % under their neighbourhood, counted as runs (the used v range of a wall is rows 13..115)"""
    import numpy as np
    col, row = cell
    a = np.asarray(img.crop((col * 64, 128 + row * 128, col * 64 + 64, 128 + row * 128 + 128))).astype(np.float64)
    lum = (a @ np.array([0.2126, 0.7152, 0.0722])).mean(1)[13:116]
    k = np.ones(2 * period + 1) / (2 * period + 1)
    avg = np.convolve(np.pad(lum, period, mode="edge"), k, mode="valid")
    low = (lum / np.maximum(avg, 1e-6)) < 0.90
    return int(np.sum(low[1:] & ~low[:-1]) + (1 if low[0] else 0))


def fetch_png(overlay, rev, rel):
    """open a palette PNG the way the page was served (overlay first, then the git revision or the working copy)"""
    from PIL import Image
    import io
    if overlay:
        p = os.path.join(overlay, rel.replace("/", os.sep))
        if os.path.isfile(p):
            return Image.open(p).convert("RGB")
    if rev:
        data = C.git_blobs(rev).read(rel)
        if data is None:
            raise C.EnvFailure("%s is not in %s" % (rel, rev))
        return Image.open(io.BytesIO(data)).convert("RGB")
    return Image.open(os.path.join(C.ROOT, rel.replace("/", os.sep))).convert("RGB")


def served_colourways(tabs, th):
    """[(palette key, variant)] a town of theme th draws: towngen's palette lists as SERVED (null = the base colormap)"""
    t = tabs.get(th)
    if not t or not t["tgHouse"]:
        return []
    out = []
    for key, lst in (("suburban", t["tgHouse"][1]), ("commercial", t["tgBig"][1])):
        for var in sorted(set(x or "base" for x in lst)):
            out.append((key, var))
    return out


def look_rows(v, man, tabs, themes, args):
    for th in themes:
        ways = served_colourways(tabs, th)
        if not ways:
            v.info("%s-look" % th, "towngen.js serves no palette table for this theme")
            continue
        rows, walls, roofs = [], [], []
        for key, var in ways:
            ent = man["variants"][key].get(var)
            if ent is None:
                rows.append("%s:%s has no palette file" % (key, var))
                continue
            img = fetch_png(args.theme_overlay, args.rev, "assets/props/city/" + ent["file"])
            w, r = swatch_mean(img, CELLS["wall"]), swatch_mean(img, CELLS["roof"])
            hw, sw, lw = _hsl(w)
            hr, sr, lr = _hsl(r)
            walls.append((hw, sw, lw))
            roofs.append((hr, sr, lr))
            rows.append("%s:%s wall #%02x%02x%02x (h%.0f s%.2f l%.2f) roof #%02x%02x%02x (h%.0f s%.2f l%.2f)" % (key, var, *w, hw, sw, lw, *r, hr, sr, lr))
        v.info("%s palette colours (as served)" % th, "; ".join(rows))
        look = LOOK.get(th)
        if look and walls:
            ok, detail = look(walls, roofs)
            v.check("%s-look" % th, ok, detail)
        if th == "lodge":
            n_ok, per = 0, []
            for key, var in ways:
                ent = man["variants"][key].get(var) if key == "suburban" else None
                if ent is None:
                    continue
                g = board_gaps(fetch_png(args.theme_overlay, args.rev, "assets/props/city/" + ent["file"]), CELLS["wall"], 9)
                per.append("%s %d" % (var, g))
                n_ok += 1 if g >= 8 else 0
            v.check("lodge-timber", n_ok >= 4, "suburban colourways whose wall swatch carries horizontal boards (>= 8 board gaps over a storey): %d (bar 4); gaps per colourway: %s" % (n_ok, ", ".join(per)))
        TM = (man.get("themes") or {}).get(th)
        if TM:
            served = {k: sorted(set(x for x in l if x)) for k, l in (("suburban", tabs[th]["tgHouse"][1]), ("commercial", tabs[th]["tgBig"][1]))}
            want = {k: sorted(TM["variants"][k]) for k in ("suburban", "commercial")}
            ck = tabs[th]["ck"]
            drift = []
            for k in served:
                if served[k] != want[k]:
                    drift.append("towngen %s %s != manifest %s" % (k, served[k], want[k]))
            for k in ("suburban", "commercial"):
                if ck["variant"][k] not in TM["variants"][k]:
                    drift.append("citykit THEMES.%s.%s = %s is not a manifest colourway" % (th, k, ck["variant"][k]))
            if tabs[th]["types"] != TM["types"]:
                drift.append("citykit THEME_TYPES differs from manifest.themes.%s.types" % th)
            v.check("%s-tables-in-sync" % th, not drift, "manifest.themes vs towngen.js THEMES + citykit.js THEMES / THEME_TYPES as served: %s" % ("; ".join(drift) or "identical"))
        else:
            v.info("%s-tables-in-sync" % th, "the served manifest has no `themes` block (a frozen build)")


def look_resort(walls, roofs):
    light = sum(1 for w in walls if w[2] >= 0.62) / len(walls)
    warm = [r for r in roofs if (r[0] < 30 or r[0] > 340) and r[1] >= 0.35 and 0.3 <= r[2] <= 0.7]          # coral / terracotta / orange
    cool = [r for r in roofs if 165 <= r[0] <= 230 and r[1] >= 0.35 and 0.2 <= r[2] <= 0.7]                  # teal / aqua / sea blue (green roofs are the suburban look)
    pastel = {int(round(w[0] / 30.0)) % 12 for w in walls if w[1] >= 0.25 and w[2] >= 0.62}                   # coloured (not white) light walls, one bucket per 30 degrees of hue
    ok = light >= 0.8 and len(warm) >= 1 and len(cool) >= 1 and len(pastel) >= 4
    return ok, "wall lightness >= 0.62 in %.0f %% of the colourways (bar 80 %%); pastel wall hues (saturation >= 0.25) in %d buckets of 30 degrees (bar 4); coral / terracotta roofs %d, teal / blue roofs %d (bar 1 each)" % (100 * light, len(pastel), len(warm), len(cool))


def look_lodge(walls, roofs):
    dark_wall = sum(1 for w in walls if w[2] <= 0.55) / len(walls)
    warm_wall = sum(1 for w in walls if (w[0] < 55 or w[0] > 340) and w[1] >= 0.15) / len(walls)            # brown / red timber: hue under 55 degrees, not grey
    dark_roof = sum(1 for r in roofs if r[2] <= 0.42) / len(roofs)
    ok = dark_wall >= 0.6 and warm_wall >= 0.5 and dark_roof >= 0.6
    return ok, "wall lightness <= 0.55 in %.0f %% (bar 60 %%), warm timber hue (under 55 deg, saturated) in %.0f %% (bar 50 %%), roofs with lightness <= 0.42 in %.0f %% (bar 60 %%)" % (100 * dark_wall, 100 * warm_wall, 100 * dark_roof)


LOOK = {"resort": look_resort, "lodge": look_lodge}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.set_defaults(disk=True)
    ap.add_argument("--shots", default=None, help="directory for the screenshots (default _harness/_shots)")
    ap.add_argument("--label", default="after", help="file name label: themes_<label>_<theme>_<view>.png")
    ap.add_argument("--themes", default="resort,lodge", help="comma list of themes (resort, lodge, city, farm, ruin, mill)")
    ap.add_argument("--views", default="street,hero,air", help="town views, every district at detail")
    ap.add_argument("--far-views", default="drop,drop2", help="town views with the real LOD (the drop cameras: 330 m up, 500 / 330 m back; every district is its far proxy)")
    # its own loose-directory overlay (any DIR holding game-relative files, e.g. generator output); renamed from --overlay in the P2/P3 fix round,
    # when common.add_common_args gained the shared --overlay (a games/last-circle dir) and the duplicate option crashed argparse (gate 10-27 12:43)
    ap.add_argument("--theme-overlay", default=None, help="serve DIR/<game-relative path> over the game's file when it exists (generator output, a patched citykit.js)")
    ap.add_argument("--min-house", type=int, default=5, help="bar: distinct house colourways per theme (resort, lodge)")
    ap.add_argument("--min-big", type=int, default=3, help="bar: distinct big-building colourways per theme (resort, lodge)")
    args = ap.parse_args()
    args.report = args.report or "themeshots_" + args.label
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
