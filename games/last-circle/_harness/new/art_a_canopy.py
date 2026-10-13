#!/usr/bin/env python
"""art_a_canopy.py - ART-A gate (plan P2.6): the ram-air canopy asset (assets/props/canopy.glb + canopy.json, contract C-ART-CANOPY).

One real Chrome through common.Session; the game's own GLTFLoader (Draco wasm) loads the file; the render uses the game's own
gore-mask shader patch (player.js ensureChute: vColor.xyz = mix(instanceColor.xyz, vec3(1.0), color.r)) on an InstancedMesh.

  * file: exactly one Mesh node named "Canopy"; position / normal / uv / color attributes; COLOR_0 is 3 floats; 1500-2000 triangles
    (the plan's ~1.5-2k, vs ~250 for the dome); fewer than 65535 vertices (the dome code uses Uint16 indices);
    COLOR_0.r is a clean 0/1 gore mask with both values present.
  * orientation / units: +Y up and above the origin (the hang point), nose toward -Z (the intake mouth interior - COLOR_0.g <= 0.3 -
    sits on the -Z side of the wing centre), span 4.0-5.0 m (the dome was 3.4 m).
  * canopy.json: lines = pairs of {x,y,z} (attach on the underside, riser end), every attach point inside the mesh bbox (+-5 cm),
    every riser end within 0.35 m of the origin, every line 1.0-3.2 m, span within 1 % of the mesh X extent, hang {x,y,z}.
  * the game's own gore shader compiles on this geometry (0 shader errors) and a render with a dark background shows BOTH the
    instance colour and the white gores on the wing.
  * 0 page errors / console errors / failed requests.
Writes a PNG proof sheet (--sheet): ref_t22 | before (dome) | after (today's shader) / after + AO | underside | side | crowd.

Exit 0 pass / 1 fail / 2 could-not-judge.   python _harness/new/art_a_canopy.py --disk --sheet <png> [--gpu swiftshader]
"""
from __future__ import annotations

import argparse
import base64
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
import common  # noqa: E402
import art_a_lib  # noqa: E402
from common import Session, add_common_args, run_gate  # noqa: E402

LC_LOOK = "C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_look"
REF = LC_LOOK + "/reference/ref_t22_parachute_downtown_storm.jpg"
BEFORE = LC_LOOK + "/camera-characters/shots/03_parachute_tpp.png"

JS = r"""
async (cfg) => {
  const THREE = await import('three');
  const W = window.__LC__.W, loader = W.kernel.loader, base = W.assetBase;
  const out = { facts: {}, shots: {}, errors: [] };
  const g = await loader.loadAsync(base + 'assets/props/canopy.glb');
  const meshes = []; g.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  out.facts.meshCount = meshes.length;
  out.facts.meshNames = meshes.map((m) => m.name);
  out.facts.rootChildren = g.scene.children.map((c) => c.name);
  const geo = meshes[0].geometry;
  const A = geo.attributes;
  out.facts.attrs = Object.keys(A);
  out.facts.colorItemSize = A.color ? A.color.itemSize : null;
  out.facts.verts = A.position.count;
  out.facts.tris = (geo.index ? geo.index.count : A.position.count) / 3;
  out.facts.indexArray = geo.index ? geo.index.array.constructor.name : null;
  geo.computeBoundingBox(); const bb = geo.boundingBox;
  out.facts.bbox = [bb.min.toArray(), bb.max.toArray()];
  let nW = 0, nC = 0, nOther = 0, mz = 0, mn = 0; const R = A.color;
  for (let i = 0; i < R.count; i++) {
    const r = R.getX(i), gg = R.getY(i);
    if (r === 1) nW++; else if (r === 0) nC++; else nOther++;
    if (gg <= 0.3) { mz += A.position.getZ(i); mn++; }
  }
  out.facts.maskWhite = nW; out.facts.maskColour = nC; out.facts.maskOther = nOther;
  out.facts.mouthVerts = mn; out.facts.mouthMeanZ = mn ? mz / mn : null;
  out.facts.materialSide = meshes[0].material && meshes[0].material.side;
  const meta = cfg.meta;
  // ---- render ----
  const CW = cfg.cell[0], CH = cfg.cell[1];
  const cv = document.createElement('canvas'); cv.width = CW; cv.height = CH;
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(CW, CH, false); renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const shaderErrors = [];
  const _ce = console.error; console.error = (...a) => { shaderErrors.push(a.map(String).join(' ').slice(0, 300)); };
  const makeMat = (ao) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 });
    m.customProgramCacheKey = () => (ao ? 'artaChuteAO' : 'artaChute');
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>',
        '#include <color_vertex>\n#if defined( USE_INSTANCING_COLOR ) && defined( USE_COLOR )\n  vColor.xyz = mix( instanceColor.xyz, vec3( 1.0 ), color.r )' + (ao ? ' * color.g' : '') + ';\n#endif');
    };
    return m;
  };
  const colours = [0x57b0ff, 0xe0685a, 0xf2c14e, 0x7fb069, 0xb05cf0, 0x22d3a0];
  const hang = meta.hang;
  const lines = meta.lines;
  function build(ao, placements) {
    const mesh = new THREE.InstancedMesh(geo, makeMat(ao), Math.max(1, placements.length));
    const lpos = new Float32Array(placements.length * lines.length * 3);
    const M = new THREE.Matrix4(), P = new THREE.Vector3(), e = new THREE.Euler(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1);
    placements.forEach((pl, i) => {
      e.set(pl.rx || 0, pl.ry || 0, 0, 'YXZ'); q.setFromEuler(e); P.set(pl.x, pl.y + hang.y, pl.z); M.compose(P, q, s1);
      mesh.setMatrixAt(i, M); mesh.setColorAt(i, new THREE.Color(colours[pl.c % colours.length]));
      const v = new THREE.Vector3();
      for (let k = 0; k < lines.length; k++) { v.set(lines[k].x, lines[k].y, lines[k].z).applyMatrix4(M); v.toArray(lpos, (i * lines.length + k) * 3); }
    });
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false;
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lpos, 3));
    const ls = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0x444444 })); ls.frustumCulled = false;
    return [mesh, ls];
  }
  // pilot: the soldier with the cheer clip (arms up) standing at the origin, hang point at +hang.y
  const sg = await loader.loadAsync(base + 'assets/chars/meshy/soldier.glb');
  const body = sg.scene; body.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; const m = o.material; if (m && m.emissiveMap) { m.emissiveMap = null; m.emissive && m.emissive.setHex(0); } } });
  try {
    const cg = await loader.loadAsync(base + 'assets/chars/clips/cheer.glb');
    const c = cg.animations[0].clone();
    const names = new Set(); body.traverse((o) => names.add(o.name));
    c.tracks = c.tracks.filter((t) => { const n = THREE.PropertyBinding.parseTrackName(t.name).nodeName; return names.has(n) && !/\.(position|scale)$/.test(t.name); });
    const mx = new THREE.AnimationMixer(body); const a = mx.clipAction(c); a.play(); mx.setTime(c.duration * 0.5); body.updateMatrixWorld(true);
    // hips height as the game's clips use (1.0179): standing pose
    let hips = null; body.traverse((o) => { if (!hips && /Hips$/.test(o.name)) hips = o; }); if (hips) hips.position.y = 1.0179;
    body.updateMatrixWorld(true);
  } catch (e) { out.errors.push('cheer pose: ' + e.message); }
  const sky = new THREE.Color(0x8ecbf0);
  function scene(bg, withBody, placements, ao, ground) {
    const sc = new THREE.Scene(); sc.background = new THREE.Color(bg);
    sc.add(new THREE.HemisphereLight(0xbfe3ff, 0x223344, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-40, 80, 30); sc.add(sun);
    if (ground) { const gp = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000), new THREE.MeshStandardMaterial({ color: 0x6a9a58, roughness: 1 })); gp.rotation.x = -Math.PI / 2; gp.position.y = ground; sc.add(gp); }
    if (withBody) sc.add(body); else if (body.parent) body.parent.remove(body);
    const [m, l] = build(ao, placements); sc.add(m); sc.add(l);
    return sc;
  }
  const cam = new THREE.PerspectiveCamera(50, CW / CH, 0.1, 3000);
  const shot = (sc, pos, look, fov) => { cam.fov = fov || 50; cam.updateProjectionMatrix(); cam.position.set(...pos); cam.lookAt(...look); cam.updateMatrixWorld(); renderer.render(sc, cam); return cv.toDataURL('image/png'); };
  const one = [{ x: 0, y: 0, z: 0, c: 0 }];
  out.shots.after = shot(scene(sky, true, one, false, -40), [0, 4.8, 9.5], [0, 2.4, -0.4], 50);
  out.shots.afterAO = shot(scene(sky, true, one, true, -40), [0, 4.8, 9.5], [0, 2.4, -0.4], 50);
  out.shots.under = shot(scene(sky, true, one, true, -40), [-1.6, -0.6, -6.5], [0, 2.4, 0.2], 50);
  out.shots.mouth = shot(scene(sky, false, one, true, -40), [0.9, 2.9, -1.7], [0.3, 3.35, -0.7], 48);
  // COLOR_0.g (the AO-like channel) as grey, flat-shaded, from below the nose: shows the lip, the intake mouth and the wall behind it
  { const sc = new THREE.Scene(); sc.background = new THREE.Color(0xdde6ee);
    const gm = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    gm.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <color_vertex>', ['#include <color_vertex>', '#ifdef USE_COLOR', '  vColor.xyz = vec3( color.g );', '#endif'].join(String.fromCharCode(10))); };
    const gmesh = new THREE.Mesh(geo, gm); gmesh.position.set(0, hang.y, 0); sc.add(gmesh);
    out.shots.mouthNoAO = shot(sc, [0.9, 2.9, -1.7], [0.3, 3.35, -0.7], 48); }
  out.shots.side = shot(scene(sky, true, one, true, -40), [9.5, 2.5, 0.1], [0, 2.4, 0.1], 36);
  out.shots.top = shot(scene(sky, false, one, true, -40), [0.01, 9.5, 0.6], [0, 2.4, 0.2], 40);
  // crowd: a drop cluster seen from a player's camera (nose toward -Z; the cluster is ahead)
  const crowd = []; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) crowd.push({ x: (rnd() - 0.5) * 70, y: (rnd() - 0.5) * 20, z: -14 - rnd() * 60, ry: rnd() * 6.28, c: i });
  out.shots.crowd = shot(scene(sky, false, crowd, true, -90), [0, 5, 6], [0, 0, -40], 60);
  // stats render: dark background, a single blue canopy, no body, no ground
  out.shots.stats = shot(scene(0x20242a, false, one, false, 0), [0, 5.5, 9.5], [0, 2.4, 0.0], 42);
  console.error = _ce;
  out.shaderErrors = shaderErrors;
  renderer.dispose();
  return out;
}
"""


def main(v):
    art_a_lib.served_note(v, v.args)
    a = v.args
    glb = os.path.join(common.ROOT, "assets", "props", "canopy.glb")
    jp = os.path.join(common.ROOT, "assets", "props", "canopy.json")
    ok_files = os.path.isfile(glb) and os.path.isfile(jp)
    v.check("assets/props/canopy.glb and canopy.json exist", ok_files, "%s / %s" % (os.path.getsize(glb) if os.path.isfile(glb) else "missing", os.path.getsize(jp) if os.path.isfile(jp) else "missing"))
    if not ok_files:
        return
    meta = json.load(open(jp))
    with Session(a, name="art_a_canopy") as s:
        art_a_lib.overlay(s, a)
        s.boot()
        s.freeze_loop()
        res = s.js(JS, {"meta": meta, "cell": [a.cell_w, a.cell_h]})
        f = res["facts"]
        v.data["facts"] = f
        v.info("file", json.dumps({k: f[k] for k in ("meshNames", "attrs", "colorItemSize", "verts", "tris", "indexArray", "bbox")}))
        v.check("one Mesh node named Canopy", f["meshCount"] == 1 and f["meshNames"] == ["Canopy"] and f["rootChildren"] == ["Canopy"],
                "meshes %s, scene children %s" % (f["meshNames"], f["rootChildren"]))
        need = {"position", "normal", "uv", "color"}
        v.check("attributes position/normal/uv/color; COLOR_0 is 3 floats", need <= set(f["attrs"]) and f["colorItemSize"] == 3,
                "attrs %s, colour itemSize %s" % (f["attrs"], f["colorItemSize"]))
        v.check("1500-2000 triangles (the dome was ~250), < 65535 vertices", 1500 <= f["tris"] <= 2000 and f["verts"] < 65535,
                "%d tris, %d verts, index %s" % (f["tris"], f["verts"], f["indexArray"]))
        both = f["maskWhite"] > 0 and f["maskColour"] > 0 and f["maskOther"] == 0
        v.check("COLOR_0.r is a clean 0/1 gore mask with both values present", both,
                "white %d, colour %d, other %d (%.0f %% white)" % (f["maskWhite"], f["maskColour"], f["maskOther"], 100.0 * f["maskWhite"] / max(1, f["verts"])))
        (x0, y0, z0), (x1, y1, z1) = f["bbox"]
        v.check("orientation/units: +Y up and above the hang point, wing top 2.0-3.0 m above the origin, span 4.0-5.0 m (dome 3.4 m)",
                y0 > 0.3 and 2.0 <= y1 <= 3.0 and 4.0 <= (x1 - x0) <= 5.0, "y %.2f..%.2f, x extent %.2f, z %.2f..%.2f" % (y0, y1, x1 - x0, z0, z1))
        v.check("nose toward -Z: the mouth interior (COLOR_0.g <= 0.3) sits on the -Z side; the leading edge is the bbox min z",
                f["mouthMeanZ"] is not None and f["mouthMeanZ"] < (z0 + z1) / 2 - 0.2, "mouth mean z %.2f vs wing mid-chord z %.2f (bbox z %.2f..%.2f)" % (f["mouthMeanZ"], (z0 + z1) / 2, z0, z1))
        # canopy.json
        L = meta["lines"]
        pairs_ok = len(L) % 2 == 0 and len(L) >= 16
        bad_attach, bad_riser, bad_len = [], [], []
        for i in range(0, len(L) - 1, 2):
            p, q = L[i], L[i + 1]
            if not (x0 - 0.05 <= p["x"] <= x1 + 0.05 and y0 - 0.05 <= p["y"] <= y1 + 0.05 and z0 - 0.05 <= p["z"] <= z1 + 0.05):
                bad_attach.append(i // 2)
            if (q["x"] ** 2 + q["y"] ** 2 + q["z"] ** 2) ** 0.5 > 0.35:
                bad_riser.append(i // 2)
            ln = ((p["x"] - q["x"]) ** 2 + (p["y"] - q["y"]) ** 2 + (p["z"] - q["z"]) ** 2) ** 0.5
            if not (1.0 <= ln <= 3.2):
                bad_len.append((i // 2, round(ln, 2)))
        v.check("canopy.json lines: pairs of {x,y,z}; attach points inside the mesh; riser ends within 0.35 m of the origin; lengths 1.0-3.2 m",
                pairs_ok and not bad_attach and not bad_riser and not bad_len,
                "%d segments; bad attach %s, riser %s, length %s" % (len(L) // 2, bad_attach[:4], bad_riser[:4], bad_len[:4]))
        h = meta.get("hang", {})
        v.check("canopy.json span within 1 percent of the mesh X extent; hang {x,y,z} present", abs(meta["span"] - (x1 - x0)) <= 0.01 * (x1 - x0) and all(k in h for k in "xyz"),
                "span %s vs mesh %.3f, hang %s" % (meta["span"], x1 - x0, h))
        # render
        v.check("the game's gore shader compiles on this geometry (0 shader/GL console errors)", not res["shaderErrors"], "; ".join(res["shaderErrors"][:2]) or "0 errors")
        from PIL import Image
        def img(url):
            return Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGB")
        st = img(res["shots"]["stats"])
        px = st.load()
        white = blue = canopy = 0
        for yy in range(st.height):
            for xx in range(st.width):
                r, g, b = px[xx, yy]
                if abs(r - 0x20) < 12 and abs(g - 0x24) < 12 and abs(b - 0x2a) < 14:
                    continue
                canopy += 1
                if r > 170 and g > 170 and b > 170:
                    white += 1
                elif b > r + 40 and b > 120:
                    blue += 1
        v.check("a render on a dark background shows BOTH the instance colour (blue) and the white gores on the wing",
                canopy > 800 and white > 0.05 * canopy and blue > 0.05 * canopy,
                "%d canopy pixels: %.0f %% white, %.0f %% blue" % (canopy, 100.0 * white / max(1, canopy), 100.0 * blue / max(1, canopy)))
        d2 = s.diagnostics()
        v.check("0 page errors / window errors / console errors / failed requests",
                not (d2["pageErrors"] or d2["windowErrors"] or d2["consoleErrors"] or d2["failedRequests"] or d2["shader"]),
                json.dumps({k: d2[k][:2] for k in ("pageErrors", "windowErrors", "consoleErrors", "failedRequests", "shader") if d2[k]}) or "clean")
        if a.sheet:
            from PIL import ImageDraw
            cw, ch = a.cell_w, a.cell_h
            cells = []
            def fit(im):
                im = im.copy(); r = max(cw / im.width, ch / im.height); im = im.resize((int(im.width * r), int(im.height * r)))
                l, t = (im.width - cw) // 2, (im.height - ch) // 2
                return im.crop((l, t, l + cw, t + ch))
            ref = fit(Image.open(REF).convert("RGB")) if os.path.isfile(REF) else Image.new("RGB", (cw, ch), (40, 40, 40))
            bef = fit(Image.open(BEFORE).convert("RGB")) if os.path.isfile(BEFORE) else Image.new("RGB", (cw, ch), (40, 40, 40))
            cells = [("REFERENCE ref_t22 (BridgeZone)", ref), ("BEFORE: today's SphereGeometry dome", bef), ("AFTER: ram-air wing, game shader (mask only)", img(res["shots"]["after"])),
                     ("AFTER + COLOR_0.g AO multiplied in", img(res["shots"]["afterAO"])), ("AFTER underside: intake mouths", img(res["shots"]["under"])),
                     ("AFTER side view: arch + airfoil", img(res["shots"]["side"])), ("AFTER top-down", img(res["shots"]["top"])), ("AFTER: 40-canopy drop cluster", img(res["shots"]["crowd"])), ("AFTER close-up: nose + intake mouths (AO)", img(res["shots"]["mouth"])), ("COLOR_0.g as grey, same camera", img(res["shots"]["mouthNoAO"]))]
            cols = 4; rows = (len(cells) + cols - 1) // cols
            sheet = Image.new("RGB", (cols * cw, rows * ch), (20, 20, 20)); dr = ImageDraw.Draw(sheet)
            for i, (label, im) in enumerate(cells):
                x, y = (i % cols) * cw, (i // cols) * ch
                sheet.paste(im, (x, y)); dr.rectangle([x, y, x + cw, y + 15], fill=(0, 0, 0)); dr.text((x + 4, y + 2), label, fill=(255, 255, 255))
            sheet.save(a.sheet)
            v.note("wrote %s (%dx%d)" % (a.sheet, sheet.width, sheet.height))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    add_common_args(ap)
    art_a_lib.add_args(ap)
    ap.add_argument("--sheet", default=None, help="write the PNG proof sheet here")
    ap.add_argument("--cell-w", type=int, default=480)
    ap.add_argument("--cell-h", type=int, default=360)
    a = ap.parse_args()
    art_a_lib.prepare(a)
    sys.exit(run_gate("art_a_canopy", main, a))
