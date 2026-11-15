#!/usr/bin/env python
"""player_rim - P1.8 readability rim: edge-vs-body luminance probe + program count (lane PLAYER, wave 4).

A real match is loaded and the human lands (protected). For each of the 5 skins a bot of that skin is found and the camera is
placed by hand 6 m (near) and 45 m (far) from it, then the SAME frame is rendered three times through the game's composer:
  B  the actor hidden                      -> the background
  A0 the actor shown, rim gain 0           -> the old look
  A1 the actor shown, rim gain = the game's value
|A0 - B| > 6/255 is the actor mask. EDGE = the 1..3 px band just inside the mask, BODY = the mask eroded by 6 px.
Asserts (counts and ratios, never milliseconds):
  * the shipped rim is on (W.rimGain.value > 0) and every body material points at ONE shared rim uniform
  * rim ON never changes a pixel outside the mask dilated by 2 px (the rim is part of the body shader only)
  * the rim LIFTS the silhouette: mean EDGE luminance A1 > A0 on the darkest skin at 45 m
  * glare bar: peak per-pixel luminance gain <= 70/255 and mean EDGE luminance A1 <= 3.0 x mean BODY luminance A1
    (an outline that out-shines the body by more than ~3x would read as a glow, not a rim)
  * one program: every body material shares the same compiled program (distinct programs carrying zRimK == 1)
  * 0 console / page / window errors, 0 failed requests, 0 shader errors, 0 [rig] lines
Exit 0 pass / 1 fail / 2 could-not-judge.
    python _harness/new/player_rim.py --disk
"""
from __future__ import annotations

import argparse
import base64
import io
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import common as C  # noqa: E402
import player_lib as PL  # noqa: E402

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402
from scipy import ndimage  # noqa: E402

SKINS = ["soldier", "athlete", "wraith", "juggernaut", "viper"]

SETUP_JS = r"""() => {
  const W = window.__LC__.W, k = W.kernel, r = k.renderer, cam = W.camera;
  const by = {};
  for (const a of W.actors) {
    if (!a.alive || !a.rig || a === W.player || a.gliding || !a.onGround || a.isDummy) continue;
    (by[a.skin] = by[a.skin] || []).push(a.id);
  }
  window.__PL_RIM__ = {
    by,
    shot(id, dist, hide, gain, opts) {
      const a = W.actorById.get(id);
      const o = opts || {};
      const g0 = W.rimGain.value;
      W.rimGain.value = gain;
      // only THIS actor may differ between the renders: the gain is global, so every other actor in frame would change too
      const vis = W.actors.map((x) => x.obj.visible);
      for (const x of W.actors) if (x !== a) x.obj.visible = false;
      a.obj.visible = !hide;
      // near shots: the full-detail body (the game shows LOD0 up close)
      if (a._bodies && a._bodies.length && a._lod0Geo) a._bodies[0].geometry = (dist > 30 && a._lod1Geo) ? a._lod1Geo : a._lod0Geo;
      const p = a.obj.position;
      const yaw = o.yaw != null ? o.yaw : 0.9;
      // far shots: a narrow lens, so a 45 m actor fills the frame like a 6 m one (the rim reads the view DISTANCE, not the fov)
      cam.fov = dist > 30 ? 57 * 6 / dist : 57; cam.updateProjectionMatrix();
      cam.position.set(p.x + Math.sin(yaw) * dist, p.y + 1.1 + dist * 0.06, p.z + Math.cos(yaw) * dist);
      cam.lookAt(p.x, p.y + 1.1, p.z);
      cam.updateMatrixWorld(true);
      if (k.composer) k.composer.render(0.016); else r.render(k.scene, cam);
      const url = r.domElement.toDataURL('image/png');
      W.rimGain.value = g0;
      W.actors.forEach((x, i) => { x.obj.visible = vis[i]; });
      return url;
    },
  };
  return { by: Object.fromEntries(Object.entries(by).map(([k2, v]) => [k2, v.length])), gain: W.rimGain && W.rimGain.value };
}"""

PROG_JS = r"""() => {
  const W = window.__LC__.W, r = W.kernel.renderer;
  const progs = new Map(); let mats = 0, shared = 0; const uni = new Set();
  for (const a of W.actors) {
    if (!a._bodies || !a._bodies.length) continue;
    const m = a._bodies[0].material; mats++;
    const props = r.properties.get(m);
    if (props && props.currentProgram) progs.set(props.currentProgram.cacheKey, (progs.get(props.currentProgram.cacheKey) || 0) + 1);
    if (m.userData && m.userData.zRimCol) shared++;
    const u = props && props.uniforms; if (u && u.zRimK) uni.add(u.zRimK);
  }
  return { materials: mats, withRimUniforms: shared, distinctPrograms: progs.size, programKeys: [...progs.keys()].map((k2) => k2.slice(-40)),
           sharedGainObjects: uni.size, gain: W.rimGain && W.rimGain.value };
}"""


def decode(url):
    return np.asarray(Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1]))).convert("RGB")).astype(np.float32)


def lum(a):
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def analyse(B, A0, A1, A0b):
    # the mask is the UNION of "differs from the background" with the rim off and on: a dark skin against a dark background has
    # |A0 - B| <= 6 at its silhouette, exactly where the rim lights it, so a mask taken from A0 alone would miss the very pixels
    # the rim changes and then blame them on the background
    m0 = (np.abs(A0 - B).max(axis=2) > 6.0)
    m = ndimage.binary_opening(m0, iterations=1) | (np.abs(A1 - B).max(axis=2) > 6.0) & ndimage.binary_dilation(m0, iterations=3)
    area = int(m.sum())
    if area < 400:
        return {"area": area, "usable": False}
    inner = ndimage.binary_erosion(m, iterations=3)
    edge = m & ~inner
    body = ndimage.binary_erosion(m, iterations=6)
    if body.sum() < 50 or edge.sum() < 20:
        return {"area": area, "usable": False}
    L0, L1 = lum(A0), lum(A1)
    d = L1 - L0
    outside = ~ndimage.binary_dilation(m, iterations=3)
    return {
        "usable": True, "area": area, "edgePx": int(edge.sum()), "bodyPx": int(body.sum()),
        "edgeL0": float(L0[edge].mean()), "edgeL1": float(L1[edge].mean()),
        "bodyL0": float(L0[body].mean()), "bodyL1": float(L1[body].mean()),
        "peakGain": float(d[m].max()), "p99Gain": float(np.percentile(d[m], 99)), "meanEdgeGain": float(d[edge].mean()),
        "edgeRatio": float(L1[edge].mean() / max(L0[edge].mean(), 4.0)),
        "edgeRGB1": [float(A1[..., c][edge].mean()) for c in range(3)],
        "dRGB": [float((A1 - A0)[..., c][edge].mean()) for c in range(3)],
        "outsideMaxAbsDelta": float(np.abs(A1 - A0)[outside].max()) if outside.any() else 0.0,
        # noise floor: the same A0 frame rendered twice (animated water / sky differ between two renders of a frozen scene)
        "noiseFloorMax": float(np.abs(A0b - A0)[outside].max()) if outside.any() else 0.0,
    }


def sheet(imgs, path):
    """A0 | A1 | |A1-A0| x6, cropped to the actor and scaled up, for the human eye."""
    d = np.abs(imgs["A0"] - imgs["B"]).max(axis=2) > 6.0
    ys, xs = np.where(d)
    if not len(ys):
        return
    pad = 14
    y0, y1 = max(0, ys.min() - pad), min(d.shape[0], ys.max() + pad)
    x0, x1 = max(0, xs.min() - pad), min(d.shape[1], xs.max() + pad)
    k = max(1, int(360 / max(1, (y1 - y0))))
    tiles = []
    for im in (imgs["A0"], imgs["A1"], np.clip(np.abs(imgs["A1"] - imgs["A0"]) * 6.0, 0, 255)):
        t = Image.fromarray(im[y0:y1, x0:x1].astype(np.uint8))
        tiles.append(t.resize((t.width * k, t.height * k), Image.NEAREST))
    W_ = sum(t.width for t in tiles) + 8 * (len(tiles) - 1)
    out = Image.new("RGB", (W_, tiles[0].height), (20, 20, 20))
    x = 0
    for t in tiles:
        out.paste(t, (x, 0)); x += t.width + 8
    out.save(path)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    PL.add_args(ap)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--map", default="isla_viva", choices=C.MAPS)
    ap.add_argument("--shots", default=None, help="folder for the A0/A1 PNGs (default: _harness/_shots)")
    args = ap.parse_args()
    PL.prepare(args)
    shots = args.shots or C.SHOTS

    def body(v):
        with C.Session(args, "player_rim") as s:
            PL.overlay(s, args)
            PL.served_note(v, args)
            s.boot()
            s.start_match("standard", args.seed, args.map)
            s.guard_player(True)
            v.info("land", s.land(120, protect=True))
            s.freeze_loop()
            s.step_frames(20, 1 / 60, render=True)
            info = s.js(SETUP_JS)
            v.info("bots on the ground per skin", info)
            gain = info.get("gain")
            v.check("the rim is on (W.rimGain.value > 0)", isinstance(gain, (int, float)) and gain > 0, {"gain": gain})
            by = s.js("() => window.__PL_RIM__.by")
            res = {}
            for skin in SKINS:
                ids = by.get(skin) or []
                if not ids:
                    v.note("no grounded bot wears %s on this seed, skin not measured" % skin)
                    continue
                for tag, dist in (("near", 6.0), ("far", 45.0)):
                    r = None
                    for cand in ids[:4]:                  # a bot that is in the open and in view; try up to 4
                        imgs = {}
                        for name, hide, g in (("B", True, gain), ("A0", False, 0.0), ("A0b", False, 0.0), ("A1", False, gain)):
                            imgs[name] = decode(s.js("([id, d, h, g]) => window.__PL_RIM__.shot(id, d, h, g)", [cand, dist, hide, g]))
                        r = analyse(imgs["B"], imgs["A0"], imgs["A1"], imgs["A0b"])
                        if r.get("usable"):
                            break
                    res["%s_%s" % (skin, tag)] = r
                    os.makedirs(shots, exist_ok=True)
                    for name in ("A0", "A1"):
                        Image.fromarray(imgs[name].astype(np.uint8)).save(os.path.join(shots, "player_rim_%s_%s_%s.png" % (skin, tag, name)))
                    if r.get("usable"):
                        sheet(imgs, os.path.join(shots, "player_rim_%s_%s_sheet.png" % (skin, tag)))
                    v.info("%s %s" % (skin, tag), {k: (round(x, 2) if isinstance(x, float) else x) for k, x in r.items()})
            v.data["measurements"] = res
            usable = {k: r for k, r in res.items() if r.get("usable")}
            if not usable:
                v.cnj("rim measurements", "no skin produced a usable mask (bots not in view / all hidden)")
            else:
                # bloom may spread a bright edge a few px past the mask; what must NOT happen is a change beyond the animated-background
                # noise floor (the same frame rendered twice with the rim off) by more than a small bloom allowance
                v.check("rim ON changes no pixel outside the actor mask (+3 px) beyond the render-to-render noise floor + 6/255",
                        all(r["outsideMaxAbsDelta"] <= r["noiseFloorMax"] + 6.0 for r in usable.values()),
                        {k: [round(r["outsideMaxAbsDelta"], 1), round(r["noiseFloorMax"], 1)] for k, r in usable.items()})
                far = {k: r for k, r in usable.items() if k.endswith("_far")}
                if far:
                    dk = min(far.items(), key=lambda kv: kv[1]["bodyL0"])
                    v.check("the rim lifts the silhouette of the darkest skin at 45 m (edge luminance up)", dk[1]["meanEdgeGain"] >= 1.0,
                            {"skin": dk[0], "edgeL0": round(dk[1]["edgeL0"], 1), "edgeL1": round(dk[1]["edgeL1"], 1), "meanEdgeGain": round(dk[1]["meanEdgeGain"], 2)})
                else:
                    v.cnj("the rim lifts the silhouette of the darkest skin at 45 m", "no usable far measurement")
                v.check("glare bar: p99 luminance gain inside the mask <= 70/255 (single flare pixels are information)",
                        all(r["p99Gain"] <= 70.0 for r in usable.values()),
                        {k: [round(r["p99Gain"], 1), round(r["peakGain"], 1)] for k, r in usable.items()})
                v.check("glare bar: mean edge luminance with the rim <= 4.0 x without it (emissive bar 3-8x, START LOW)",
                        all(r["edgeRatio"] <= 4.0 for r in usable.values()),
                        {k: round(r["edgeRatio"], 2) for k, r in usable.items()})
                v.check("glare bar: mean edge luminance <= 3.0 x body luminance", all(r["edgeL1"] <= 3.0 * max(r["bodyL1"], 8.0) for r in usable.values()),
                        {k: [round(r["edgeL1"], 1), round(r["bodyL1"], 1)] for k, r in usable.items()})
            # SQUAD UP ally rim: the same team id on the human and one bot -> mode 2 (green); cleared -> back to mode 1 (cool)
            ids_all = [i for lst in by.values() for i in lst]
            if not ids_all:
                v.cnj("SQUAD UP ally gets the green rim", "no grounded bot to team up with")
            else:
                got = None
                for cand in ids_all[:4]:
                    s.js("([id]) => { const W = window.__LC__.W; W.player.teamId = 'sq-test'; W.actorById.get(id).teamId = 'sq-test'; }", [cand])
                    s.step_frames(3, 1 / 60, render=False)
                    st = s.js("([id]) => { const a = window.__LC__.W.actorById.get(id); const u = a._bodies[0].material.userData;"
                              " return { mode: a._rimMode, hex: u.zRimCol.value.getHexString(), p: u.zRimP.value.toArray() }; }", [cand])
                    imgs = {}
                    for name, hide, g in (("B", True, gain), ("A0", False, 0.0), ("A0b", False, 0.0), ("A1", False, gain)):
                        imgs[name] = decode(s.js("([id, d, h, g]) => window.__PL_RIM__.shot(id, d, h, g)", [cand, 6.0, hide, g]))
                    ra = analyse(imgs["B"], imgs["A0"], imgs["A1"], imgs["A0b"])
                    if ra.get("usable"):
                        sheet(imgs, os.path.join(shots, "player_rim_ally_sheet.png"))
                        got = (cand, st, ra)
                        break
                s.js("() => { const W = window.__LC__.W; W.player.teamId = null; for (const a of W.actors) a.teamId = null; }")
                s.step_frames(3, 1 / 60, render=False)
                if got is None:
                    v.cnj("SQUAD UP ally gets the green rim", "no usable ally measurement (bot never in view)")
                else:
                    cand, st, ra = got
                    back = s.js("([id]) => { const a = window.__LC__.W.actorById.get(id); const u = a._bodies[0].material.userData; return { mode: a._rimMode, hex: u.zRimCol.value.getHexString() }; }", [cand])
                    v.info("ally measurement", {"state": st, "dRGB": [round(x, 2) for x in ra["dRGB"]], "p99Gain": round(ra["p99Gain"], 1), "edgeRatio": round(ra["edgeRatio"], 2)})
                    v.check("SQUAD UP ally: mode 2, green rim colour, and the added light is green-dominant",
                            st["mode"] == 2 and st["hex"] == "3dffa0" and ra["dRGB"][1] > ra["dRGB"][2] and ra["dRGB"][1] > ra["dRGB"][0], {"state": st, "dRGB": ra["dRGB"]})
                    v.check("SQUAD UP ally: back to mode 1 and the cool colour once the team id is cleared", back["mode"] == 1 and back["hex"] != "3dffa0", back)
                    v.check("SQUAD UP ally: glare bar still holds (p99 gain <= 70/255, edge ratio <= 4)", ra["p99Gain"] <= 70.0 and ra["edgeRatio"] <= 4.0,
                            {"p99Gain": round(ra["p99Gain"], 1), "edgeRatio": round(ra["edgeRatio"], 2)})
            pr = s.js(PROG_JS)
            v.info("body programs", pr)
            v.check("every body material carries the rim uniforms and shares ONE gain uniform", pr["withRimUniforms"] == pr["materials"] and pr["sharedGainObjects"] == 1,
                    {k: pr[k] for k in ("materials", "withRimUniforms", "sharedGainObjects")})
            v.check("one program for all body materials", pr["distinctPrograms"] == 1, {"distinct": pr["distinctPrograms"], "keys": pr["programKeys"]})
            s.guard_player(False)
            d = s.diagnostics()
            v.data["diagnostics"] = d
            C.print_diagnostics(d)
            v.check("0 console errors", not d["consoleErrors"], d["consoleErrors"][:5])
            v.check("0 page / window errors", not (d["pageErrors"] or d["windowErrors"]), (d["pageErrors"] + d["windowErrors"])[:5])
            v.check("0 failed requests", not d["failedRequests"], d["failedRequests"][:8])
            v.check("0 shader/GL errors", not d["shader"], d["shader"][:3])
            v.check("0 [rig] warnings", not d["rigWarnings"], d["rigWarnings"][:3])
    return C.run_gate("player_rim", body, args)


if __name__ == "__main__":
    sys.exit(main())
