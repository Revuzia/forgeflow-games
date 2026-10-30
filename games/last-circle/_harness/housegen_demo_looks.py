#!/usr/bin/env python
"""housegen_demo_looks - housegen buildings in a REAL browser, drawn with the real kit GLBs, photographed inside and out FROM THE GAME'S THIRD-PERSON CAMERA,
and every room's doorway view counted in rendered pixels. (Last Circle Wave 8 stage A2 lane H4; round 3 lane H6: the third-person camera, the compound themes.
The pure half - plans, reach, doors, windows, colliders, roofs, budget, determinism - is housegen.selftest.cjs; the Node / page interior gate is interiorcheck.py;
bots planning inside the rooms is housegen_demo_nav.py.)

    python _harness/housegen_demo_looks.py --disk                  # screenshots + contact sheets -> --shots DIR (default _harness/_shots)

One Chrome boots the game to the MENU (no match), stops the kernel loop and builds a THROWAWAY scene with the game's own renderer: per theme (city, resort, lodge)
a two-storey HOUSE, a two-storey SHOP (4.0 m storeys), a HALL (5.0 m, a warehouse floor) and a TOWER asked for 6 storeys (3 walkable, 3 closed shell storeys) - the
12 judged buildings - plus six compound buildings towngen also emits (farm house / barn / shed, ruin house / hall, mill hall), on flat lots along streets. Walls /
floors / roofs (incl. pitched planks and gables) / stairs / glass / door leaves / authored furniture come from housegen.buildHouse; kit furniture is drawn from the
real GLBs (assets/props/city, the game's GLTFLoader + meshopt decoder) through buildHouse's kitTemplates.

THE CAMERA is the game's (player.js updateCamera, 2026-10-19): the eye 1.62 m over the feet, the boom 4.2 m back along the view, 0.7 m to the right and 0.25 m up,
a 57 degree vertical field of view, pulled in along the boom where a collider box is in the way (camRayHit: lens sphere 0.28 m, never closer than 0.12 m).
A stand-in body (a 0.5 m x 1.8 m figure) is drawn where the player stands, so what the body hides does not count.

Rows (exit 0 pass / 1 fail / 2 could-not-judge):
  build          the 12 judged buildings (4 uses x 3 themes) + the 6 compound ones, every kit GLB they use loaded (none failed)
  kit-extents    every kit furniture instance AS DRAWN equals its housegen collider within 2 cm
  view-pixels    every room of the 12 judged buildings, from its best entrance as housegen records it (rooms[].views), the PLAYER standing 0.9 m inside the
                 doorway (interiorcheck's spot) facing in, seen from the third-person camera: >= 3 furniture pieces each change >= 60 pixels when hidden in turn
                 (a piece of the next room seen through an opening counts, like interiorcheck; how many of the room's OWN pieces show is printed beside it)
  view-pixels-compound   the same for the 6 compound buildings (farm / ruin / mill)
  glass          every window of an intact building has a pane that DRAWS and no pane has a collider (a ruin - THEMES[].ruined - keeps one pane in
                 four by design, Wave 8 K1: its panes are counted apart, never more than its windows)
  boot           0 page errors / console errors / failed requests
Screenshots (LOOK at them): per use a contact sheet (street, the front from the third-person camera, stepping in through the front door, the biggest room
from its doorway), the compound sheet, the storeys cut-away sheet, and every building's every room from its doorway (third person).
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common as C  # noqa: E402

GATE = "housegen_demo_looks"
PX_MIN = 60
VIEW_MIN = 3

PROBE = r"""
() => {
  const LC = window.__LC__, W = LC.W, THREE = W.THREE, K = W.kernel, R = K.renderer;
  const HG_URL = new URL("runtime/3d/royale/housegen.js", W.assetBase).href + "?v=" + Date.now();
  let HG = null, S = null;
  const houses = [];
  // the game's third-person rig (player.js updateCamera / camWall / camRayHit, 2026-10-19)
  const CAM = { dist: 4.2, shoulder: 0.7, lift: 0.25, eye: 1.62, fov: 57, r: 0.28, minD: 0.12 };
  function scene() {
    if (S) return S;
    const sc = new THREE.Scene();
    sc.background = new THREE.Color(0x9cc7e8);
    sc.fog = new THREE.Fog(0xb9d3e6, 300, 1500);
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0xb8b2a6, 2.2); sc.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d8, 2.4); sun.position.set(-60, 120, 40); sun.target.position.set(60, 0, 60);
    sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
    const c2 = sun.shadow.camera; c2.left = -140; c2.right = 140; c2.top = 140; c2.bottom = -140; c2.near = 10; c2.far = 460;
    sc.add(sun); sc.add(sun.target);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x8fa36a, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.005; ground.receiveShadow = true; sc.add(ground);
    for (let r = 0; r < 5; r++) { const road = new THREE.Mesh(new THREE.PlaneGeometry(260, 8), new THREE.MeshStandardMaterial({ color: 0x4a4c50, roughness: 0.95 })); road.rotation.x = -Math.PI / 2; road.position.set(85, 0.0, r * 40 - 14); road.receiveShadow = true; sc.add(road); }
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 3000);
    // the stand-in body: a figure the size of the soldier (shoulders 0.5 m, 1.8 m tall), drawn where the player stands
    const body = new THREE.Group();
    const bm = new THREE.MeshStandardMaterial({ color: 0x55603f, roughness: 0.9 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.75, 0.28), bm); torso.position.y = 1.15; body.add(torso);
    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.8, 0.22), bm); legs.position.y = 0.4; body.add(legs);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshStandardMaterial({ color: 0xb08a6a })); head.position.y = 1.66; body.add(head);
    body.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    body.visible = false; sc.add(body);
    S = { scene: sc, cam, sun, hemi, ground, body };
    return S;
  }
  const THEMES = ["city", "resort", "lodge"];
  const USES = [{ use: "house", w: 12.5, d: 10, st: 2 }, { use: "shop", w: 12.5, d: 12.5, st: 2 }, { use: "hall", w: 17.5, d: 12.5, st: 1 }, { use: "tower", w: 15, d: 15, st: 6 }];
  const EXTRA = [{ theme: "farm", use: "house", w: 12.5, d: 10, st: 2 }, { theme: "farm", use: "barn", w: 17.5, d: 12.5, st: 1 }, { theme: "farm", use: "shed", w: 7.5, d: 5, st: 1 },
    { theme: "ruin", use: "house", w: 10, d: 10, st: 2 }, { theme: "ruin", use: "hall", w: 15, d: 10, st: 1 }, { theme: "mill", use: "hall", w: 17.5, d: 12.5, st: 1 }];
  async function build() {
    HG = await import(HG_URL); const sc = scene();
    const man = await (await fetch(new URL("assets/props/city/manifest.json", W.assetBase).href, { cache: "no-cache" })).json();
    const specs = [];
    THEMES.forEach((theme, ti) => USES.forEach((u, ui) => {
      // a street along x at z = ti * 40 - 14; each row's front doors face it (turn 2 = local +Z -> world -Z)
      const cx = ui * 34 + 10, cz = ti * 40 + 2 + (u.d - 10) / 2;
      specs.push({ theme, core: true, H: HG.generate({ id: theme + "_" + u.use, cx, cz, y: 0, w: u.w, d: u.d, turn: 2, theme, storeys: u.st, seed: 4200 + ti * 10 + ui, use: u.use }) });
    }));
    EXTRA.forEach((u, k) => {
      const row = 3 + Math.floor(k / 3), col = k % 3, cx = col * 40 + 10, cz = row * 40 + 2 + (u.d - 10) / 2;
      specs.push({ theme: u.theme, core: false, H: HG.generate({ id: u.theme + "_" + u.use, cx, cz, y: 0, w: u.w, d: u.d, turn: 2, theme: u.theme, storeys: u.st, seed: 5300 + k * 7, use: u.use }) });
    });
    const types = [...new Set(specs.flatMap((q) => q.H.furniture.filter((p) => p.src === "kit").map((p) => p.kit.type)))].sort();
    const templates = new Map(), failed = [];
    let bytes = 0;
    await Promise.all(types.map(async (type) => {
      const row = man.types[type];
      if (!row) { failed.push({ type, error: "no manifest row" }); return; }
      try {
        const url = new URL("assets/props/city/" + row.file, W.assetBase).href;
        const ab = await (await fetch(url)).arrayBuffer(); bytes += ab.byteLength;
        const root = await K.loadGLTF(url);
        root.updateMatrixWorld(true);
        const Sm = new THREE.Matrix4().makeScale(row.suggested_scale, row.suggested_scale, row.suggested_scale), parts = [];
        root.traverse((o) => { if (o.isMesh) parts.push({ geometry: o.geometry, material: o.material, local: Sm.clone().multiply(o.matrixWorld) }); });
        templates.set(type, parts);
      } catch (e) { failed.push({ type, error: String(e && e.message || e).slice(0, 160) }); }
    }));
    for (const q of specs) {
      const B = HG.buildHouse(THREE, q.H, { kitTemplates: templates });
      sc.scene.add(B.group);
      B.group.traverse((o) => { if (o.isMesh || o.isInstancedMesh) { o.castShadow = !(o.parent && o.parent.name === "glass"); o.receiveShadow = true; } });
      houses.push({ H: q.H, B, theme: q.theme, use: q.H.use, core: q.core });
    }
    return { houses: houses.map((q) => ({ id: q.H.id, core: q.core, use: q.H.use, theme: q.theme, roof: q.H.roof, storeys: q.H.storeys, shell: q.H.shell, fh: q.H.fh,
      rooms: q.H.rooms.map((r) => r.kind + "@" + r.floor + ":" + q.H.furniture.filter((p) => p.room === r.id && !p.deco).length),
      furniture: q.H.furniture.length, kitN: q.H.furniture.filter((p) => p.src === "kit").length, windows: q.H.windows.length, doors: q.H.doors.length, notes: q.H.notes, tris: q.H.tris,
      relief: q.H.boxes.filter((b) => b.p === "trim").length, planks: (q.H.roofs || []).length })),
      types: types.length, bytes, failed, skipped: types.filter((t) => !templates.has(t)) };
  }
  function kitExtents() {
    const sc = scene(); sc.scene.updateMatrixWorld(true);
    const drawn = [], M = new THREE.Matrix4(), bb = new THREE.Box3();
    sc.scene.traverse((o) => {
      if (!o.isInstancedMesh) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); M.premultiply(o.matrixWorld); bb.copy(o.geometry.boundingBox).applyMatrix4(M); drawn.push(bb.clone()); }
    });
    let worst = 0, matched = 0, unmatched = 0;
    for (const q of houses) for (const p of q.H.furniture) {
      if (p.src !== "kit") continue;
      const exp = new THREE.Box3(new THREE.Vector3(...p.min), new THREE.Vector3(...p.max)), grow = exp.clone().expandByScalar(0.05);
      const cands = drawn.filter((d) => grow.containsBox(d));
      if (!cands.length) { unmatched++; continue; }
      const u = new THREE.Box3(); for (const d of cands) u.union(d);
      worst = Math.max(worst, Math.abs(u.min.x - exp.min.x), Math.abs(u.min.y - exp.min.y), Math.abs(u.min.z - exp.min.z), Math.abs(u.max.x - exp.max.x), Math.abs(u.max.y - exp.max.y), Math.abs(u.max.z - exp.max.z)); matched++;
    }
    return { matched, unmatched, worst: +worst.toFixed(4) };
  }
  function render(fov) {
    const sc = scene(), sz = R.getSize(new THREE.Vector2());
    sc.cam.fov = fov || 60; sc.cam.aspect = sz.x / Math.max(1, sz.y); sc.cam.near = 0.1; sc.cam.updateProjectionMatrix();
    R.shadowMap.enabled = true; R.shadowMap.needsUpdate = true;
    R.setRenderTarget(null); R.info.reset(); R.render(sc.scene, sc.cam);
    return { calls: R.info.render.calls, triangles: R.info.render.triangles };
  }
  function look(pos, at, fov) {
    const sc = scene(); sc.body.visible = false;
    sc.cam.position.set(pos[0], pos[1], pos[2]); sc.cam.up.set(0, 1, 0); sc.cam.lookAt(at[0], at[1], at[2]);
    return render(fov);
  }
  // camRayHit (player.js): earliest t in (0, best) at which the boom enters a collider box grown by r
  function camRayHit(cols, ox, oy, oz, dx, dy, dz, r, best) {
    for (const c of cols) {
      if (c.kind !== "box" || c.dead) continue;
      let rr = r;
      for (let pass = 0; pass < 2; pass++) {
        let t0 = 0, t1 = best, miss = false;
        const slab = (o, d, lo, hi) => { if (d > -1e-9 && d < 1e-9) { if (o < lo - rr || o > hi + rr) miss = true; return; } let a = (lo - rr - o) / d, b = (hi + rr - o) / d; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; if (t0 > t1) miss = true; };
        slab(ox, dx, c.minX, c.maxX); if (!miss) slab(oy, dy, c.minY, c.maxY); if (!miss) slab(oz, dz, c.minZ, c.maxZ);
        if (miss) break;
        if (t0 > 0) { best = t0; break; }
        if (pass === 1) break;
        const ex = ox < c.minX ? c.minX - ox : ox > c.maxX ? ox - c.maxX : 0, ey = oy < c.minY ? c.minY - oy : oy > c.maxY ? oy - c.maxY : 0, ez = oz < c.minZ ? c.minZ - oz : oz > c.maxZ ? oz - c.maxZ : 0;
        const dd = Math.sqrt(ex * ex + ey * ey + ez * ez);
        if (dd <= 0.03) break;
        rr = dd - 0.015;
      }
    }
    return best;
  }
  let allCols = null;
  function colsNear(x, z, r) { if (!allCols) { allCols = []; for (const q of houses) for (const c of q.B.colliders) allCols.push(c); } return allCols.filter((c) => c.maxX >= x - r && c.minX <= x + r && c.maxZ >= z - r && c.minZ <= z + r); }
  // the player stands at feet (x, y, z) facing (fx, fz), level look (pitch 0): the game's camera
  function tp(x, y, z, fx, fz, pitch) {
    const sc = scene(), p = pitch || 0;
    const yaw = Math.atan2(-fx, -fz), sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(p), cp = Math.cos(p);
    const fwd = [-sy * cp, sp, -cy * cp];
    const tgt = [x, y + CAM.eye, z];
    const free = [tgt[0] - fwd[0] * CAM.dist + cy * CAM.shoulder, tgt[1] - fwd[1] * CAM.dist + CAM.lift, tgt[2] - fwd[2] * CAM.dist - sy * CAM.shoulder];
    const dx = free[0] - tgt[0], dy = free[1] - tgt[1], dz = free[2] - tgt[2], len = Math.hypot(dx, dy, dz);
    let f = 1;
    const cols = colsNear((tgt[0] + free[0]) / 2, (tgt[2] + free[2]) / 2, len / 2 + CAM.r + 0.1);
    const t = camRayHit(cols, tgt[0], tgt[1], tgt[2], dx, dy, dz, CAM.r, 1);
    if (t < 1) f = Math.max(CAM.minD / len, t - 0.015);
    sc.cam.position.set(tgt[0] + dx * f, tgt[1] + dy * f, tgt[2] + dz * f); sc.cam.up.set(0, 1, 0);
    sc.cam.lookAt(sc.cam.position.x + fwd[0] * 10, sc.cam.position.y + fwd[1] * 10, sc.cam.position.z + fwd[2] * 10);
    sc.body.visible = true; sc.body.position.set(x, y, z); sc.body.rotation.y = Math.atan2(fx, fz);
    const info = render(CAM.fov);
    return Object.assign(info, { pulled: +f.toFixed(3) });
  }
  let clip = null;
  function setClip(y) {
    const sc = scene();
    clip = y == null ? null : [new THREE.Plane(new THREE.Vector3(0, -1, 0), y)];
    R.localClippingEnabled = !!clip;
    sc.scene.traverse((o) => { if ((o.isMesh || o.isInstancedMesh) && o !== sc.ground) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { m.clippingPlanes = clip; m.needsUpdate = true; } } });
  }
  // per-piece hide / show: a kit piece = its instance in its type's InstancedMeshes (housegen's order), an authored piece = its parts' vertices collapsed in place
  function pieceOps(q) {
    const out = new Map(), kitIdx = new Map();
    q.H.furniture.forEach((p) => {
      if (p.src === "kit") {
        const k = kitIdx.get(p.kit.type) || 0; kitIdx.set(p.kit.type, k + 1);
        const ims = q.B.instanced.filter((im) => im.name === "housegen:" + q.H.id + ":" + p.kit.type), saved = [];
        out.set(p.id, { hide: () => { for (const im of ims) { const a = im.instanceMatrix.array; saved.push(a.slice(k * 16, k * 16 + 16)); for (let z = 0; z < 16; z++) a[k * 16 + z] = 0; im.instanceMatrix.needsUpdate = true; } },
          show: () => { ims.forEach((im, n) => { im.instanceMatrix.array.set(saved[n], k * 16); im.instanceMatrix.needsUpdate = true; }); saved.length = 0; } });
      } else {
        const boxes = (p.parts || []).map((bi) => q.H.boxes[bi]), saved = [];
        out.set(p.id, { hide: () => {
          for (const m of q.B.furniture.children) {
            if (!m.isMesh || m.isInstancedMesh) continue;
            const pa = m.geometry.attributes.position, A = pa.array; let hit = false;
            for (let v = 0; v < pa.count; v++) {
              const x = A[v * 3], y = A[v * 3 + 1], z = A[v * 3 + 2];
              if (boxes.some((b) => x >= b.min[0] - 1e-4 && x <= b.max[0] + 1e-4 && y >= b.min[1] - 1e-4 && y <= b.max[1] + 1e-4 && z >= b.min[2] - 1e-4 && z <= b.max[2] + 1e-4)) { saved.push([m, v, x, y, z]); A[v * 3] = boxes[0].min[0]; A[v * 3 + 1] = boxes[0].min[1]; A[v * 3 + 2] = boxes[0].min[2]; hit = true; }
            }
            if (hit) pa.needsUpdate = true;
          }
        }, show: () => { for (const [m, v, x, y, z] of saved) { const A = m.geometry.attributes.position.array; A[v * 3] = x; A[v * 3 + 1] = y; A[v * 3 + 2] = z; m.geometry.attributes.position.needsUpdate = true; } saved.length = 0; } });
      }
    });
    return out;
  }
  // where the player stands to read a room: its best recorded entrance, 0.9 m inside a doorway (interiorcheck's spot) or at the stair top, facing in
  function entrance(r) {
    const v = (r.views || []).slice().sort((a, b) => b.seen - a.seen)[0];
    if (!v) return null;
    const k = v.door ? 0.3 : 0;
    return { x: v.x + v.dir[0] * k, y: r.y, z: v.z + v.dir[1] * k, fx: v.dir[0], fz: v.dir[1], seen: v.seen, door: !!v.door };
  }
  function viewPixels(core) {
    const gl = R.getContext(), out = [];
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(w * h * 4);
    const read = () => { gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf); return buf; };
    const sc = scene(); const shadow = sc.sun.castShadow; sc.sun.castShadow = false;
    for (const q of houses) {
      if (q.core !== core) continue;
      const ops = pieceOps(q);
      for (const r of q.H.rooms) {
        const e = entrance(r);
        if (!e) { out.push({ house: q.H.id, room: r.id, kind: r.kind, floor: r.floor, views: 0, inView: 0, own: 0, per: [] }); continue; }
        const t = tp(e.x, e.y, e.z, e.fx, e.fz); const ref = read().slice();
        let n = 0, own = 0; const per = [];
        for (const p of q.H.furniture) {
          if (p.floor !== r.floor || p.deco || p.max[1] - p.min[1] < 0.25) continue;
          const cx = (p.min[0] + p.max[0]) / 2 - e.x, cz = (p.min[2] + p.max[2]) / 2 - e.z;
          if (cx * e.fx + cz * e.fz < -0.5 || cx * cx + cz * cz > 400) continue;
          const o = ops.get(p.id); if (!o) continue;
          o.hide(); tp(e.x, e.y, e.z, e.fx, e.fz); const px = read(); o.show();
          let d = 0; for (let k = 0; k < px.length; k += 4) if (Math.abs(px[k] - ref[k]) + Math.abs(px[k + 1] - ref[k + 1]) + Math.abs(px[k + 2] - ref[k + 2]) > 24) d++;
          if (d >= 60) { n++; if (p.room === r.id) own++; per.push((p.room === r.id ? "" : "(next) ") + p.cat + ":" + d); }
        }
        out.push({ house: q.H.id, room: r.id, kind: r.kind, floor: r.floor, views: r.views.length, model: e.seen, inView: n, own, per, at: [+e.x.toFixed(2), +e.z.toFixed(2)], pulled: t.pulled });
      }
    }
    sc.sun.castShadow = shadow;
    sc.body.visible = false;
    return out;
  }
  // R4: a RUIN (housegen THEMES[theme].ruined, Wave 8 K1 788eb418: "a ruin's panes are mostly gone", one kept in four from its own stream)
  // is judged apart - its windows may lack panes (never more panes than windows); every intact building still needs one pane per window
  function glass() {
    let panes = 0, windows = 0, colliding = 0, ruinPanes = 0, ruinWindows = 0;
    const per = [];
    for (const q of houses) {
      const ruin = !!(HG.THEMES && HG.THEMES[q.H.theme] && HG.THEMES[q.H.theme].ruined);
      let np = 0;
      for (const b of q.H.boxes) if (b.p === "glass") { np++; if (b.c) colliding++; }
      if (ruin) { ruinPanes += np; ruinWindows += q.H.windows.length; } else { panes += np; windows += q.H.windows.length; }
      per.push({ id: q.H.id, theme: q.H.theme, ruin, windows: q.H.windows.length, panes: np });
    }
    const meshes = []; for (const q of houses) q.B.group.traverse((o) => { if (o.isMesh && o.parent && o.parent.name === "glass") meshes.push(o.geometry.index.count / 3); });
    return { windows, panes, ruinWindows, ruinPanes, colliding, glassMeshes: meshes.length, glassTris: meshes.reduce((a, b) => a + b, 0),
             short: per.filter((x) => !x.ruin && x.panes !== x.windows), ruins: per.filter((x) => x.ruin) };
  }
  // contact sheet: views rendered one by one into a grid of 640 x 360 tiles. A view is { tp: [x, y, z, fx, fz] } (the game's camera) or { pos, at, fov }
  function sheet(list, cols) {
    const tw = 640, th = 360, n = list.length, rows = Math.ceil(n / cols);
    const cv = document.createElement("canvas"); cv.width = tw * cols; cv.height = th * rows;
    const g = cv.getContext("2d"); g.fillStyle = "#222"; g.fillRect(0, 0, cv.width, cv.height); g.font = "16px sans-serif";
    list.forEach((v, i) => {
      setClip(v.clip == null ? null : v.clip);
      if (v.tp) tp(v.tp[0], v.tp[1], v.tp[2], v.tp[3], v.tp[4], v.tp[5] || 0); else look(v.pos, v.at, v.fov || 60);
      g.drawImage(R.domElement, (i % cols) * tw, Math.floor(i / cols) * th, tw, th);
      g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect((i % cols) * tw, Math.floor(i / cols) * th, tw, 22); g.fillStyle = "#fff"; g.fillText(v.label || "", (i % cols) * tw + 6, Math.floor(i / cols) * th + 16);
    });
    setClip(null);
    scene().body.visible = false;
    return cv.toDataURL("image/png");
  }
  function data() { return houses.map((q) => Object.assign({ core: q.core }, q.H)); }
  return { build, kitExtents, look, tp, setClip, viewPixels, glass, sheet, data };
}
"""


def main_fn(v, args):
    shots = args.shots or C.SHOTS
    os.makedirs(shots, exist_ok=True)
    s = C.Session(args, name="housegen_demo_looks")
    s.start()
    try:
        s.boot()
        s.freeze_loop()
        keys = s.js("() => { window.__HGL__ = (" + PROBE + ")(); return Object.keys(window.__HGL__); }")
        if not keys or "build" not in keys:
            raise C.HarnessError("probe did not install: %s" % keys)
        s.stage("build")
        b = s.js("() => window.__HGL__.build()")
        v.data["build"] = b
        core = [h for h in b["houses"] if h["core"]]
        combos = sorted((h["theme"], h["use"]) for h in core)
        v.check("build", len(core) == 12 and len(set(combos)) == 12 and len(b["houses"]) == 18 and not b["failed"] and not b["skipped"],
                "%d judged buildings %s + %d compound; %d kit types from the real GLBs (%d bytes); failed %s skipped %s" % (
                    len(core), combos, len(b["houses"]) - len(core), b["types"], b["bytes"], b["failed"], b["skipped"]))
        for h in b["houses"]:
            v.info("building " + h["id"], "%s, roof %s (%d planks), %d walkable storeys (+%d closed), %.1f m storeys, %d relief boxes, rooms (kind@floor:pieces) %s, %d furniture (%d kit), %d windows, %d doors, tris %s%s" % (
                h["use"], h["roof"], h["planks"], h["storeys"], h["shell"], h["fh"], h["relief"], " ".join(h["rooms"]), h["furniture"], h["kitN"], h["windows"], h["doors"], h["tris"],
                (" notes " + "; ".join(h["notes"])) if h["notes"] else ""))
        s.stage("measure")
        s.js("() => window.__HGL__.look([60, 60, -70], [60, 0, 40], 55)")
        ke = s.js("() => window.__HGL__.kitExtents()")
        v.check("kit-extents", ke["unmatched"] == 0 and ke["matched"] > 0 and ke["worst"] <= 0.02, "%d kit pieces matched, worst |drawn - collider| %.4f m, unmatched %d" % (ke["matched"], ke["worst"], ke["unmatched"]))
        for label, flag in (("view-pixels", True), ("view-pixels-compound", False)):
            vp = s.js("(c) => window.__HGL__.viewPixels(c)", flag)
            v.data[label] = vp
            poor = [r for r in vp if r["inView"] < VIEW_MIN]
            bykind = {}
            for r in vp:
                k = bykind.setdefault(r["kind"], [0, 0])
                k[0] += 1
                k[1] += 1 if r["inView"] >= VIEW_MIN else 0
            v.check(label, vp and not poor, "%d of %d rooms show >= %d furniture pieces (>= %d px each) from the THIRD-PERSON camera at their best entrance; by kind [rooms, ok] %s; short %s" % (
                len(vp) - len(poor), len(vp), VIEW_MIN, PX_MIN, bykind, [(r["room"], r["kind"], r["inView"], r.get("model"), r.get("per")) for r in poor[:8]]))
            ownp = [r for r in vp if r["own"] < VIEW_MIN]
            v.info(label + "-own", "%d of %d rooms show >= %d of their OWN pieces from that view; mean pieces in view %.1f; %s" % (
                len(vp) - len(ownp), len(vp), VIEW_MIN, sum(r["inView"] for r in vp) / max(1, len(vp)), [(r["room"], r["kind"], r["own"], r["inView"]) for r in ownp[:12]]))
        gl = s.js("() => window.__HGL__.glass()")
        ruins = gl.get("ruins") or []
        v.check("glass", gl["windows"] > 0 and gl["panes"] == gl["windows"] and gl["ruinPanes"] <= gl["ruinWindows"] and gl["colliding"] == 0 and gl["glassTris"] > 0,
                "%d panes for %d windows of the intact buildings (short %s), ruins (K1: panes mostly gone) %d panes for %d windows %s, %d with a collider; %d glass meshes, %d triangles drawn" % (
                    gl["panes"], gl["windows"], gl.get("short"), gl["ruinPanes"], gl["ruinWindows"], [(x["id"], x["panes"], x["windows"]) for x in ruins],
                    gl["colliding"], gl["glassMeshes"], gl["glassTris"]))
        H = s.js("() => window.__HGL__.data()")
        s.stage("shots")
        shotlist = []

        def save_png(name, data_url):
            p = os.path.join(shots, "housegen_looks_%s.png" % name)
            with open(p, "wb") as f:
                f.write(base64.b64decode(data_url.split(",", 1)[1]))
            shotlist.append(p)
            return p

        def best_room(h):
            for r in sorted(h["rooms"], key=lambda r: -r["area"]):
                if r.get("views"):
                    return r, max(r["views"], key=lambda q: q["seen"])
            return None, None

        def tp_entrance(r, vv):
            k = 0.3 if vv.get("door") else 0.0
            return [vv["x"] + vv["dir"][0] * k, r["y"], vv["z"] + vv["dir"][1] * k, vv["dir"][0], vv["dir"][1]]

        def views_of(h, label):
            fd = next(d for d in h["doors"] if d["kind"] == "front")
            cx, cz, top = h["lod"]["cx"], h["lod"]["cz"], h["aabb"]["max"][1]
            out = [
                {"label": "%s: street" % label, "pos": [fd["x"] + 10, 2.2, fd["z"] + fd["nz"] * 16 + fd["nx"] * 16], "at": [cx, min(top, 10) * 0.45, cz], "fov": 62},
                {"label": "%s: the front (3rd person)" % label, "tp": [fd["x"] + fd["nx"] * 7.5, fd["y"], fd["z"] + fd["nz"] * 7.5, -fd["nx"], -fd["nz"], 0.15]},
                {"label": "%s: stepping in (3rd person)" % label, "tp": [fd["x"] - fd["nx"] * 0.9, fd["y"], fd["z"] - fd["nz"] * 0.9, -fd["nx"], -fd["nz"]]},
            ]
            r, vv = best_room(h)
            if vv:
                out.append({"label": "%s: %s from its doorway (3rd person)" % (label, r["kind"]), "tp": tp_entrance(r, vv)})
            return out

        for use in ["house", "shop", "hall", "tower"]:
            lst = []
            for h in [x for x in H if x["use"] == use and x["core"]]:
                lst += views_of(h, "%s %s" % (h["theme"], use))
            save_png("sheet_" + use, s.js("(l) => window.__HGL__.sheet(l, 4)", lst))
        lst = []
        for h in [x for x in H if not x["core"]]:
            lst += views_of(h, "%s %s" % (h["theme"], h["use"]))
        save_png("sheet_compound", s.js("(l) => window.__HGL__.sheet(l, 4)", lst))
        # upper storeys: a cut-away of every walkable storey of three buildings
        lst = []
        for hid in ["city_house", "lodge_tower", "resort_shop", "farm_house"]:
            h = next(x for x in H if x["id"] == hid)
            cx, cz = h["lod"]["cx"], h["lod"]["cz"]
            for f, fl in enumerate(h["floors"]):
                lst.append({"label": "%s floor %d" % (hid, f), "pos": [cx - 4, fl["y"] + 18, cz - 12], "at": [cx, fl["y"], cz], "fov": 55, "clip": fl["y"] + 2.1})
        save_png("sheet_storeys", s.js("(l) => window.__HGL__.sheet(l, 4)", lst))
        # each building's every room from its best entrance, the game's camera, 4 per row
        for h in H:
            lst = []
            for r in h["rooms"]:
                if not r.get("views"):
                    continue
                vv = max(r["views"], key=lambda q: q["seen"])
                lst.append({"label": "%s %s f%d (%d)" % (h["id"], r["kind"], r["floor"], vv["seen"]), "tp": tp_entrance(r, vv)})
            if lst:
                save_png("rooms_" + h["id"], s.js("(l) => window.__HGL__.sheet(l, 4)", lst))
        p = os.path.join(shots, "housegen_looks_overview.png")
        s.canvas_png(p, "window.__HGL__.look([-30, 80, -80], [70, 0, 80], 55)")
        shotlist.append(p)
        v.data["shots"] = shotlist
        v.info("screenshots", ", ".join(shotlist))
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
