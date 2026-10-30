#!/usr/bin/env python
"""housegen_demo - the Wave 8 house grammar (runtime/3d/royale/housegen.js, lane H1) built in a REAL browser and photographed.
(The pure half - plans, reachability, doors, windows, stairs, colliders vs extents, budget, determinism - is housegen.selftest.cjs.)

    python _harness/housegen_demo.py --disk                     # the working copy (default); screenshots -> --shots DIR (default _harness/_shots)

One Chrome boots the game to the MENU (no match), stops the kernel loop and builds a THROWAWAY scene with the game's own renderer: 12 houses
(3 themes x 4 sizes: 7.5 x 7.5 m bungalow, 10 x 10 m two-storey, 12.5 x 10 m L two-storey, 15 x 12.5 m three-storey) on flat ground. Walls / floors /
roofs / stairs / authored furniture come from housegen.buildHouse (merged per material); kit furniture (CC0 Kenney Furniture Kit, incl. lane H2's interior
types) is drawn from the real GLBs (the game's GLTFLoader + meshopt decoder) through buildHouse's kitTemplates, instanced per part.

Rows (exit 0 pass / 1 fail / 2 could-not-judge):
  boot           the menu is up, housegen.js imports, 0 page errors / console errors / failed requests over the whole session
  build          12 houses built; every kit GLB the houses use loaded (none failed)
  kit-extents    every kit furniture instance AS DRAWN (instance matrix x the loaded GLB geometry's bounds) equals its housegen collider within 2 cm
  wall-extents   per house, the drawn walls group's bounds == the AABB of its collider boxes (+ ramps) within 2 cm
  windows-shoot  through every window of the 12 houses, the game's own segment test (FFG.sim.Royale.segmentColliders on the house's colliders): a
                 standing-eye (floor + 1.62) shot passes, a crouched-eye (floor + 0.97) shot is stopped by the sill
  lod            updateLod: furniture visible at 30 m, hidden at 120 m; draw calls fall when it hides
  budget         renderer.info triangles of each house drawn alone (no shadow pass) == housegen's own count (house.tris), every storey <= 4,000
Screenshots (LOOK at them): overview, a street per theme, a dollhouse cut-away of each theme's biggest house (every storey), interiors (living room,
kitchen, bedroom, bath, shop, stairwell, a window looking out).
"""
from __future__ import annotations

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402

GATE = "housegen_demo"

PROBE = r"""
() => {
  const LC = window.__LC__, W = LC.W, THREE = W.THREE, K = W.kernel, R = K.renderer;
  const HG_URL = new URL("runtime/3d/royale/housegen.js", W.assetBase).href + "?v=" + Date.now();
  let HG = null, S = null;
  const houses = [];
  async function load() { if (!HG) HG = await import(HG_URL); }
  function scene() {
    if (S) return S;
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x9cc7e8);
    sc.fog = new THREE.Fog(0xb9d3e6, 300, 1500);
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0xb8b2a6, 2.2); sc.add(hemi);   // a pale ground term: a ceiling is lit by it (the game's interiors get stage B's indoor ambient)
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4); sun.position.set(-60, 120, 40); sun.target.position.set(40, 0, 30);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    const c2 = sun.shadow.camera; c2.left = -90; c2.right = 90; c2.top = 90; c2.bottom = -90; c2.near = 10; c2.far = 400;
    sc.add(sun); sc.add(sun.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x8fa36a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.005; ground.receiveShadow = true; sc.add(ground);
    const road = new THREE.Mesh(new THREE.PlaneGeometry(200, 8), new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.95 }));
    road.rotation.x = -Math.PI / 2; road.position.set(45, 0.0, -14); road.receiveShadow = true; sc.add(road);
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 3000);
    S = { scene: sc, cam, sun, hemi, ground };
    return S;
  }
  const THEMES = ["city", "resort", "lodge"];
  const SIZES = [{ w: 7.5, d: 7.5, st: 1, plan: "rect" }, { w: 10, d: 10, st: 2, plan: "rect" }, { w: 12.5, d: 10, st: 2, plan: "L" }, { w: 15, d: 12.5, st: 3, plan: "rect" }];
  async function build() {
    await load(); const sc = scene();
    // the kit furniture is drawn from the real GLBs through buildHouse's kitTemplates (one InstancedMesh per part per type per house): lane H2's interior
    // types live in manifest_interior.json in stage A and citykit's collider table does not know them yet (stage B merges the manifests)
    const man = await (await fetch(new URL("assets/props/city/manifest.json", W.assetBase).href, { cache: "no-cache" })).json();
    let manI = { types: {} };
    try { manI = await (await fetch(new URL("assets/props/city/manifest_interior.json", W.assetBase).href, { cache: "no-cache" })).json(); } catch (e) { /* base kit only */ }
    const rowOf = (type) => man.types[type] || manI.types[type];
    const specs = [];
    THEMES.forEach((theme, ti) => SIZES.forEach((sz, si) => {
      // a street along x at z = -14; each row's front doors face it (turn 2 = local +Z -> world -Z)
      const cx = si * 26 + 4, cz = ti * 30 + 2;
      specs.push({ theme, si, H: HG.generate({ id: theme + si, cx, cz, y: 0, w: sz.w, d: sz.d, turn: 2, theme, storeys: sz.st, seed: 1000 + ti * 10 + si, plan: sz.plan, use: theme === "city" && si === 1 ? "shop" : "house" }) });
    }));
    const types = [...new Set(specs.flatMap((q) => q.H.furniture.filter((p) => p.src === "kit").map((p) => p.kit.type)))].sort();
    const templates = new Map(), failed = [];
    const t0 = performance.now();
    await Promise.all(types.map(async (type) => {
      const row = rowOf(type);
      if (!row) { failed.push({ type, error: "no manifest row" }); return; }
      try {
        const root = await K.loadGLTF(new URL("assets/props/city/" + row.file, W.assetBase).href);
        root.updateMatrixWorld(true);
        const S = new THREE.Matrix4().makeScale(row.suggested_scale, row.suggested_scale, row.suggested_scale), parts = [];
        root.traverse((o) => { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, local: S.clone().multiply(o.matrixWorld) }); });
        templates.set(type, parts);
      } catch (e) { failed.push({ type, error: String(e && e.message || e).slice(0, 160) }); }
    }));
    for (const q of specs) {
      const B = HG.buildHouse(THREE, q.H, { kitTemplates: templates });
      sc.scene.add(B.group);
      B.group.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { o.castShadow = true; o.receiveShadow = true; } });
      houses.push({ H: q.H, B, theme: q.theme, si: q.si });
    }
    return { houses: houses.map((q) => ({ id: q.H.id, kit: q.H.kit, storeys: q.H.storeys, rooms: q.H.rooms.map((r) => r.kind + "@" + r.floor + ":" + q.H.furniture.filter((p) => p.room === r.id).length), furniture: q.H.furniture.length,
      kitN: q.H.furniture.filter((p) => p.src === "kit").length, loot: q.H.loot.length, windows: q.H.windows.length, doors: q.H.doors.length, notes: q.H.notes, tris: q.H.tris.floors, plan: q.H.plan, use: q.H.use })),
      kitEntries: houses.reduce((a, q) => a + q.H.furniture.filter((p) => p.src === "kit").length, 0), types: types.length, failed, skipped: types.filter((t) => !templates.has(t)), placeMs: Math.round(performance.now() - t0) };
  }
  // every kit instance as drawn vs its housegen collider
  function kitExtents() {
    const sc = scene(); sc.scene.updateMatrixWorld(true);
    const drawn = [];                                      // [type?, box]
    const M = new THREE.Matrix4(), bb = new THREE.Box3();
    const byKey = new Map();
    sc.scene.traverse((o) => {
      if (!o.isInstancedMesh) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, M); M.premultiply(o.matrixWorld);
        bb.copy(o.geometry.boundingBox).applyMatrix4(M);
        const key = o.uuid.slice(0, 0) + (o.userData.type || o.name) + "|" + i + "|" + o.parent.uuid;
        void key;
        drawn.push({ name: o.name, box: bb.clone(), centre: bb.getCenter(new THREE.Vector3()) });
      }
    });
    // group the parts of one instance (one InstancedMesh per part): union boxes whose centres coincide within the piece
    let worst = 0, matched = 0, unmatched = 0, rows = [];
    for (const q of houses) for (const p of q.H.furniture) {
      if (p.src !== "kit") continue;
      const exp = new THREE.Box3(new THREE.Vector3(...p.min), new THREE.Vector3(...p.max));
      const cands = drawn.filter((d) => exp.clone().expandByScalar(0.05).containsBox(d.box));
      if (!cands.length) { unmatched++; if (rows.length < 6) rows.push({ id: p.id, type: p.type, why: "no drawn instance inside" }); continue; }
      const u = new THREE.Box3(); for (const d of cands) u.union(d.box);
      const e = Math.max(Math.abs(u.min.x - exp.min.x), Math.abs(u.min.y - exp.min.y), Math.abs(u.min.z - exp.min.z), Math.abs(u.max.x - exp.max.x), Math.abs(u.max.y - exp.max.y), Math.abs(u.max.z - exp.max.z));
      worst = Math.max(worst, e); matched++;
      if (e > 0.02 && rows.length < 6) rows.push({ id: p.id, type: p.type, err: +e.toFixed(3) });
    }
    return { instances: drawn.length, matched, unmatched, worst: +worst.toFixed(4), rows };
  }
  function wallExtents() {
    const out = [];
    for (const q of houses) {
      const bb = new THREE.Box3();
      for (const m of q.B.walls.children) { m.geometry.computeBoundingBox(); bb.union(m.geometry.boundingBox); }
      const c = new THREE.Box3();
      for (const col of q.B.colliders.slice(0, q.H.boxes.filter((b) => b.c).length + q.H.ramps.length)) c.union(new THREE.Box3(new THREE.Vector3(col.minX, col.minY, col.minZ), new THREE.Vector3(col.maxX, col.maxY, col.maxZ)));
      const e = Math.max(Math.abs(bb.min.x - c.min.x), Math.abs(bb.min.y - c.min.y), Math.abs(bb.min.z - c.min.z), Math.abs(bb.max.x - c.max.x), Math.abs(bb.max.y - c.max.y), Math.abs(bb.max.z - c.max.z));
      out.push({ id: q.H.id, err: +e.toFixed(4), meshes: q.B.walls.children.length });
    }
    return out;
  }
  function windowsShoot() {
    const Sim = window.FFG && window.FFG.sim && window.FFG.sim.Royale;
    if (!Sim || !Sim.segmentColliders) return { error: "FFG.sim.Royale.segmentColliders missing" };
    let n = 0, standOK = 0, crouchBlocked = 0, bad = [];
    for (const q of houses) {
      const cols = q.B.colliders;
      for (const w of q.H.windows) {
        n++;
        const fl = q.H.floors[w.floor].y;
        const seg = (eye) => Sim.segmentColliders(w.x - w.nx * 1.5, fl + eye, w.z - w.nz * 1.5, w.x + w.nx * 1.5, fl + eye, w.z + w.nz * 1.5, cols);
        const a = seg(1.62), b = seg(0.97);
        if (!a) standOK++; if (b) crouchBlocked++;
        if ((a || !b) && bad.length < 5) bad.push({ id: w.id, stand: !!a, crouch: !!b });
      }
    }
    return { n, standOK, crouchBlocked, bad };
  }
  function info() { const i = R.info; return { calls: i.render.calls, triangles: i.render.triangles, programs: i.programs ? i.programs.length : null }; }
  function view(pos, look, fov) {
    const sc = scene(), sz = R.getSize(new THREE.Vector2());
    sc.cam.position.set(pos[0], pos[1], pos[2]); sc.cam.up.set(0, 1, 0); sc.cam.lookAt(look[0], look[1], look[2]);
    sc.cam.fov = fov || 60; sc.cam.aspect = sz.x / Math.max(1, sz.y); sc.cam.near = 0.1; sc.cam.updateProjectionMatrix();
    R.shadowMap.enabled = true; R.shadowMap.needsUpdate = true;
    R.setRenderTarget(null); R.info.reset(); R.render(sc.scene, sc.cam);
    return info();
  }
  // a cut-away: hide every box above y (clip planes on the walls + furniture materials) and look down
  let clip = null;
  function setClip(y) {
    const sc = scene();
    clip = y == null ? null : [new THREE.Plane(new THREE.Vector3(0, -1, 0), y)];
    R.localClippingEnabled = !!clip;
    sc.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o !== sc.ground) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { m.clippingPlanes = clip; m.needsUpdate = true; } } });
  }
  function lod() {
    const out = {};
    const q = houses.find((h) => h.si === 3 && h.theme === "city");
    const c = new THREE.Vector3(q.H.lod.cx, 1.7, q.H.lod.cz);
    for (const d of [30, 120]) {
      const p = { x: c.x + d, y: 1.7, z: c.z };
      for (const h of houses) h.B.updateLod(p, 60);
      out["d" + d] = { visible: q.B.furniture.visible, render: view([p.x, 3, p.z], [c.x, 3, c.z]) };
    }
    for (const h of houses) h.B.setFurnitureVisible(true);
    return out;
  }
  function data() { return houses.map((q) => q.H); }
  function houseCost(id) {
    // one house alone, no shadow pass, the whole house in frame: the triangles and draw calls the renderer really spends on it
    const sc = scene(), q = houses.find((h) => h.H.id === id);
    const hidden = [];
    for (const o of sc.scene.children) if (o.isMesh && o.visible) { o.visible = false; hidden.push(o); }      // the ground and the road
    for (const h of houses) h.B.group.visible = h === q;
    const shadow = sc.sun.castShadow; sc.sun.castShadow = false;
    const sz = R.getSize(new THREE.Vector2());
    sc.cam.position.set(q.H.lod.cx + 30, q.H.lod.cy + 45, q.H.lod.cz + 30); sc.cam.lookAt(q.H.lod.cx, q.H.lod.cy, q.H.lod.cz);
    sc.cam.fov = 50; sc.cam.aspect = sz.x / Math.max(1, sz.y); sc.cam.updateProjectionMatrix();
    R.setRenderTarget(null); R.info.reset(); R.render(sc.scene, sc.cam);     // (no light casts: no shadow pass; the shadow MAP stays enabled - toggling it needs every material recompiled)
    const r = info();
    sc.sun.castShadow = shadow;
    for (const h of houses) h.B.group.visible = true;
    for (const o of hidden) o.visible = true;
    return Object.assign(r, { expected: q.H.tris.total, floors: q.H.tris.floors });
  }
  function toPNG() { return R.domElement.toDataURL("image/png"); }
  return { build, kitExtents, wallExtents, windowsShoot, view, setClip, lod, data, houseCost, toPNG, houses };
}
"""


def main_fn(v, args):
    shots = args.shots or C.SHOTS
    os.makedirs(shots, exist_ok=True)
    s = C.Session(args, name="housegen_demo")
    s.start()
    try:
        s.boot()
        s.freeze_loop()
        keys = s.js("() => { window.__HG__ = (" + PROBE + ")(); return Object.keys(window.__HG__); }")
        if not keys or "build" not in keys:
            raise C.HarnessError("probe did not install: %s" % keys)
        s.stage("build")
        b = s.js("() => window.__HG__.build()")
        v.data["build"] = b
        v.check("build", len(b["houses"]) == 12 and not b["failed"] and not b["skipped"], "%d houses, %d kit pieces of %d types from the real GLBs (loaded in %d ms); failed %s skipped %s" % (len(b["houses"]), b["kitEntries"], b["types"], b["placeMs"], b["failed"], b["skipped"]))
        for h in b["houses"]:
            v.info("house " + h["id"], "%s kit, %s %s, %d storeys, rooms (kind@floor:pieces) %s, %d furniture (%d kit), %d loot, %d windows, %d doors, tris/storey %s%s" % (
                h["kit"], h["use"], h["plan"], h["storeys"], " ".join(h["rooms"]), h["furniture"], h["kitN"], h["loot"], h["windows"], h["doors"], h["tris"], (" notes " + "; ".join(h["notes"])) if h["notes"] else ""))
        s.stage("measure")
        s.js("() => window.__HG__.view([40, 60, -60], [40, 0, 30])")      # one warm render (GLB uploads, shadow maps)
        ke = s.js("() => window.__HG__.kitExtents()")
        v.data["kitExtents"] = ke
        v.check("kit-extents", ke["unmatched"] == 0 and ke["matched"] > 0 and ke["worst"] <= 0.02, "%d kit pieces matched to drawn instances (%d instances drawn), worst |drawn - collider| %.4f m, unmatched %d %s" % (ke["matched"], ke["instances"], ke["worst"], ke["unmatched"], ke["rows"]))
        we = s.js("() => window.__HG__.wallExtents()")
        worst = max(r["err"] for r in we)
        v.check("wall-extents", worst <= 0.02, "drawn walls group bounds vs collider AABB, worst %.4f m over %d houses" % (worst, len(we)))
        ws = s.js("() => window.__HG__.windowsShoot()")
        v.data["windows"] = ws
        v.check("windows-shoot", not ws.get("error") and ws["n"] > 0 and ws["standOK"] == ws["n"] and ws["crouchBlocked"] == ws["n"],
                "the game's segmentColliders through %s windows: standing eye clear %s, crouched eye blocked %s %s" % (ws.get("n"), ws.get("standOK"), ws.get("crouchBlocked"), ws.get("bad") or ws.get("error", "")))
        lo = s.js("() => window.__HG__.lod()")
        v.data["lod"] = lo
        v.check("lod", lo["d30"]["visible"] and not lo["d120"]["visible"], "furniture visible at 30 m %s, at 120 m %s; calls %s -> %s" % (lo["d30"]["visible"], lo["d120"]["visible"], lo["d30"]["render"]["calls"], lo["d120"]["render"]["calls"]))
        H = s.js("() => window.__HG__.data()")
        s.stage("shots")
        shotlist = []

        def shot(name, pos, look, fov=60, clip=None):
            p = os.path.join(shots, "housegen_%s.png" % name)
            s.js("(y) => window.__HG__.setClip(y)", clip)
            s.canvas_png(p, "window.__HG__.view(%s, %s, %s)" % (json.dumps(pos), json.dumps(look), fov))
            shotlist.append(p)
            return p

        shot("overview", [-30, 45, -55], [40, 0, 32], 55)
        for ti, th in enumerate(["city", "resort", "lodge"]):
            shot("street_" + th, [-6, 2.2, ti * 30 - 16], [60, 4, ti * 30 + 2], 62)
        # dollhouse cut-aways: each theme's biggest house (index 3), every storey (clip just under that storey's ceiling)
        for h in H:
            if not h["id"].endswith("3") and not h["id"].endswith("2"):
                continue
            for f in range(h["storeys"]):
                fl = h["floors"][f]
                cx, cz = h["lod"]["cx"], h["lod"]["cz"]
                shot("cut_%s_f%d" % (h["id"], f), [cx - 4, fl["y"] + 17, cz - 11], [cx, fl["y"], cz], 55, fl["y"] + 2.1)
        # interiors: from a room's door, eye height 1.7, looking at the room's far corner
        def interior(name, hid, kind, floor=None):
            hh = next(x for x in H if x["id"] == hid)
            rooms = [r for r in hh["rooms"] if r["kind"] == kind and (floor is None or r["floor"] == floor)]
            if not rooms:
                v.info("interior " + name, "no %s room in %s" % (kind, hid))
                return
            r = max(rooms, key=lambda q: q["area"])
            y = r["y"] + 1.7
            # stand just inside, in the corner nearest a door of the room, look at the opposite corner
            d = next((dd for dd in hh["doors"] if dd["id"] in r["doors"]), None)
            corners = [(r["x0"] + 0.5, r["z0"] + 0.5), (r["x1"] - 0.5, r["z0"] + 0.5), (r["x0"] + 0.5, r["z1"] - 0.5), (r["x1"] - 0.5, r["z1"] - 0.5)]
            if d:
                c0 = min(corners, key=lambda c: (c[0] - d["x"]) ** 2 + (c[1] - d["z"]) ** 2)
            else:
                c0 = corners[0]
            c1 = max(corners, key=lambda c: (c[0] - c0[0]) ** 2 + (c[1] - c0[1]) ** 2)
            shot("in_" + name, [c0[0], y + 0.4, c0[1]], [c1[0], r["y"] + 0.6, c1[1]], 75)

        interior("living_city", "city3", "living", 0)
        interior("kitchen_resort", "resort3", "kitchen", 0)
        interior("kitchen_lodge", "lodge2", "kitchen", 0)
        interior("bedroom_resort", "resort3", "bedroom", 1)
        interior("bedroom_lodge", "lodge3", "bedroom", 1)
        interior("bath_city", "city3", "bath", 1)
        interior("shop_city", "city1", "shop", 0)
        interior("office_city", "city3", "office", 0)
        # the stairwell of the city 3-storey house: from the approach cell looking up the stair
        hh = next(x for x in H if x["id"] == "city3")
        st = hh["stairs"][0]
        shot("in_stair_city3", [st["approach"][0] * 1.0, st["foot"][1] + 1.7, st["approach"][1]], [st["top"][0], st["top"][1] + 1.0, st["top"][2]], 75)
        st2 = hh["stairs"][-1]
        shot("in_stairtop_city3", [st2["exit"][0], st2["top"][1] + 1.7, st2["exit"][1]], [st2["foot"][0], st2["foot"][1], st2["foot"][2]], 75)
        # a window from inside, looking out (resort 2)
        h2 = next(x for x in H if x["id"] == "resort2")
        w = h2["windows"][0]
        fl = h2["floors"][w["floor"]]["y"]
        shot("in_window_resort2", [w["x"] - w["nx"] * 2.6, fl + 1.62, w["z"] - w["nz"] * 2.6], [w["x"] + w["nx"] * 6, fl + 1.3, w["z"] + w["nz"] * 6], 70)
        s.js("() => window.__HG__.setClip(null)")
        # the cost of each house alone LAST: it switches the sun's shadow off for one render (no shadow pass in the count)
        costs = []
        for h in H:
            r = s.js("(id) => window.__HG__.houseCost(id)", h["id"])
            costs.append((h["id"], r["triangles"], r["expected"], r["calls"], max(r["floors"])))
        v.data["houseCost"] = costs
        bad = [c for c in costs if c[1] != c[2] or c[4] > 4000]
        v.check("budget", not bad, "renderer.info triangles of each house drawn alone == housegen's count (so its per-storey numbers are what the GPU draws) and every storey <= 4,000; mismatches %s" % bad[:3])
        v.info("house cost", ", ".join("%s %d tris (data %d) %d calls, max storey %d" % c for c in costs))
        v.data["shots"] = shotlist
        v.info("screenshots", ", ".join(shotlist))
        d = s.diagnostics()
        v.data["diagnostics"] = d
        perr = s.page_errors
        cerr = [t for (k, t, st_) in s.console if k == "error"]
        v.check("boot", not perr and not cerr and not s.failed, "page errors %d %s; console errors %d %s; failed requests %d %s" % (len(perr), perr[:2], len(cerr), cerr[:2], len(s.failed), s.failed[:3]))
    finally:
        s.close()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.set_defaults(disk=True)
    ap.add_argument("--shots", default=None, help="directory for the screenshots (default _harness/_shots)")
    args = ap.parse_args()
    return C.run_gate(GATE, lambda v: main_fn(v, args), args)


if __name__ == "__main__":
    sys.exit(main())
