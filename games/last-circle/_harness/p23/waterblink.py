#!/usr/bin/env python
"""waterblink - owner 2026-11-24 "water blinks when floating from high above" (gate p23_waterblink).

Cause (F:/lc_p23/waterblink/notes.txt): depth error of the water against the seabed under it, in two parts. (1) The sea was ONE 5.6 km quad
(maps.js PlaneGeometry(WATER_W, WATER_W, 1, 1)): with the camera moving, its two triangles are re-clipped every frame (most of each lies behind
the camera / past the 2000 m far plane) and the clipped vertices' float error tilts the water's interpolated depth by more than the few cm of
water over a beach. (2) The 0.1 m near plane: at 300-1500 m the depth buffer resolves 5 cm - 1.3 m, coarser than the water at the foam lip.
From the drop the shore lip and the shallows flip between water and seabed frame to frame. A still camera never blinks; polygonOffset -4
units does not help. Fix: the sea is WATER_SEG x WATER_SEG cells (1), and while the camera's focus glides the near plane grows with the
height over ground / water, 0.1 m at <= 30 m to 1.0 m from 120 m (2) (maps.js glideNear, W._lcGlideNear).

A standard match (seed 7) is loaded and frozen in the DROP. Over two coasts of the map (ground within -0.6..+0.3 m of the water, deeper water
seaward, dry land inland; the second >= 400 m from the first) the camera is placed at 5 heights (40 / 90 / 160 / 250 / 330 m) x 3 pitches
(25 / 45 / 70 deg down) and DESCENDS (the drop: -14 m/s, +6 m/s along the view) for 8 frames, the map clock advancing 1/60 s a frame (every
map updater run at that clock: bob, waves, foam), each frame drawn through the game's composer (actors / fx hidden), the near plane set by
the map's own rule for the placed camera. Each frame is drawn again with the water hidden: a pixel is decisively WATER (> 16 / 255 apart),
decisively NOT (< 3 / 255) or undecided. Blink = pixels that are water / not / water (or not / water / not) on 3 consecutive frames, as a
share of the pixels that are water in any frame; the worst frame triple of the view. (A waterline sliding with the camera changes once and
never returns; a colour jump-and-return metric also counted the ULTRA waves' fine texture sliding 1-2 px a frame: reported as jumpBack, info.)

Rows (per map x tier session; default: isla_viva / ashgrid / deepwood medium + isla_viva low + deepwood ultra + deepwood phone (pixel7 touch);
--full = every map on ultra / medium / low / phone):
  no water blink from altitude   worst blink over the 30 views <= BAR, as served (the same session's pre-fix build - 1-quad plane, ground near -
                                 is reported per view; --ab adds each half of the fix alone). A map without water (ashgrid) must have no
                                 water mesh at all.
  ground-level look unchanged    the waterlook views (shore / inwater / underwater up / sun-facing / looking down, pinned clock): as served vs a
                                 512 x 512 reference plane (the least float error: what the flat plane's shading is) in the same frame:
                                 <= LOOK_BAR of the pixels differ by > 8 / 255, and the near plane there is the ground one. (The pre-fix
                                 1-quad plane is reported against the same reference: its float error shifted the wave / foam texels.)
  0 page / console errors, failed requests
INFO: the water's triangles, the GPU ms of the game's own drop frame with the served vs the 1-quad plane (kernel GPU timer, when supported).

    python _harness/p23/waterblink.py --disk                        # the gate
    python _harness/p23/waterblink.py --disk --full --ab            # every map x ultra / medium / low / phone, each half of the fix alone too
    python _harness/p23/waterblink.py --disk --plant one-quad       # the pre-fix plane served (WATER_SEG 1)       - MUST FAIL no water blink
    python _harness/p23/waterblink.py --disk --plant ground-near    # the pre-fix near plane in the glide (0.1 m)  - MUST FAIL no water blink
Exit 0 pass / 1 fail / 2 could-not-judge.
"""
from __future__ import annotations

import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.dirname(HERE))
import common as C  # noqa: E402
import p23lib as L  # noqa: E402
import waterlook as WL  # noqa: E402
import mobilekit as MK  # noqa: E402

import numpy as np  # noqa: E402

RP = "runtime/3d/royale/"
SEED = 7
JUMP = 40.0                  # /255, max channel: a blink is a jump between water and seabed / sand, not the waves' shimmer
BAR = 0.001                  # worst blink share of the water pixels, as served (see notes.txt: as served <= ~0.0003, each half of the fix alone >= 0.002, pre-fix 0.05)
LOOK_BAR = 0.002             # share of pixels differing > 8/255 from the 512-seg reference at ground level (64-seg: <= 0.0008; the 1-quad: 0.012-0.021)
HEIGHTS = (40, 90, 160, 250, 330)
PITCHES = (25, 45, 70)
DESCENT = (-14.0, 6.0)       # m/s down, m/s forward along the view (the drop)
NFR = 8
T0 = 40.0                    # map clock of the first frame
DEFAULT_RUNS = "isla_viva:medium,ashgrid:medium,deepwood:medium,isla_viva:low,deepwood:ultra,deepwood:phone"
FULL_RUNS = ",".join("%s:%s" % (m, t) for m in ("isla_viva", "ashgrid", "deepwood") for t in ("ultra", "medium", "low", "phone"))

PLANTS = {
    # the pre-fix sea: one 5.6 km quad - MUST FAIL no water blink from altitude
    "one-quad": [(RP + "maps.js", [("    const WATER_SEG = 64;", "    const WATER_SEG = 1;")])],
    # the pre-fix near plane: 0.1 m in the glide too - MUST FAIL no water blink from altitude
    "ground-near": [(RP + "maps.js", [("      if (f && f.gliding && !W._underwater) {", "      if (false) {")])],
}
# configs measured in one session (the geometry swapped in memory, the near plane by the map's own rule or held at the ground value):
# fixed = as served; preFix = 1-quad plane + ground near (the build before this fix); --ab adds noSeg (1-quad + glide near), noNear (served plane + ground near)
CONFIGS = {"fixed": ("ship", "glide"), "preFix": ("quad", "ground"), "noSeg": ("quad", "glide"), "noNear": ("ship", "ground"), "ref": ("ref", "glide"), "refAloft": ("ref", "one")}

# waterlook's RENDER_JS with the near plane set for the PLACED camera (the map's own rule W._lcGlideNear, as its per-frame updater does; or held
# at the kernel's ground value) - the updater ran for the game's camera in the stepped frame, not for the pinned one
RENDER_JS = WL.RENDER_JS.replace("cam.position.set(px, py, pz); cam.lookAt(tx, ty, tz); cam.updateMatrixWorld(true);",
                                 "cam.position.set(px, py, pz); cam.lookAt(tx, ty, tz); cam.updateMatrixWorld(true);"
                                 " if (W.__wbNear === 'one') { cam.near = 1.0; cam.updateProjectionMatrix(); }"
                                 " else if (W.__wbNear === 'ground') { cam.near = k._nearGround != null ? k._nearGround : 0.1; cam.updateProjectionMatrix(); }"
                                 " else if (W._lcGlideNear) W._lcGlideNear(); const usedNear = cam.near;").replace(
                                 "const out = { png:", "const out = { near: usedNear, png:")
assert RENDER_JS.count("usedNear") == 2
# the diver kept aloft and gliding (the views are many seconds of sim): back to 280 m when under 200 m
ALOFT_JS = r"""() => { const W = window.__LC__.W, p = W.player; if (!p) return null; if (p.pos.y < 200) { p.pos.y = 280; if (p.vel) p.vel.y = 0; } return { y: +p.pos.y.toFixed(1), gliding: !!p.gliding, phase: W.phase }; }"""

# coasts: ground within [-0.6, +0.3] m of the water, deeper water 60 m seaward, dry land 40 m inland (sea, or Deepwood's shallower lakes / river);
# the first one on rings from 0.3 x half outward, then the first >= 400 m from it (two different shores per map)
COAST_JS = r"""() => { const M = window.__LC__.W.map, wy = M.waterY, half = M.half, G = (x, z) => (M.groundAt || M.heightAt)(x, z);
  if (!M.water || wy < -900) return [];
  const out = [];
  for (const deep of [-3, -1.5]) { for (let r = half * 0.3; r < half * 0.98 && out.length < 2; r += 15) for (let a = 0; a < 64 && out.length < 2; a++) {
      const x = Math.cos(a * 0.0982) * r, z = Math.sin(a * 0.0982) * r;
      const h = G(x, z) - wy; if (h > 0.3 || h < -0.6) continue;
      if (out.some((c) => Math.hypot(c.x - x, c.z - z) < 400)) continue;
      for (let k = 0; k < 8; k++) { const dx = Math.cos(k * 0.7854), dz = Math.sin(k * 0.7854);
        if (G(x + dx * 60, z + dz * 60) - wy < deep && G(x - dx * 40, z - dz * 40) - wy > 1) { out.push({ x, z, dx, dz, deep }); break; } } }
    if (out.length) break; }
  // no sea coast (Deepwood: a river / lakes 10-40 m wide, the plateau >= 10 m over the water elsewhere): any water-to-land boundary - a 4 m grid
  // over the map (the rings above step past a narrow radial river), water >= 0.8 m deep 10 m out, dry land (> 1 m over) 16 m in
  if (!out.length) { const S = 4, R = Math.floor(half * 0.95 / S);
    for (let i = -R; i <= R && out.length < 2; i++) for (let j = -R; j <= R && out.length < 2; j++) {
      const x = i * S, z = j * S, h = G(x, z) - wy; if (h > 0.3 || h < -0.6) continue;
      if (out.some((c) => Math.hypot(c.x - x, c.z - z) < 400)) continue;
      for (let k = 0; k < 8; k++) { const dx = Math.cos(k * 0.7854), dz = Math.sin(k * 0.7854);
        if (G(x + dx * 10, z + dz * 10) - wy < -0.8 && G(x - dx * 16, z - dz * 16) - wy > 1) { out.push({ x, z, dx, dz, deep: -0.8, kind: 'inland' }); break; } } } }
  return out; }"""

INFO_JS = r"""() => { const W = window.__LC__.W, w = W.map.water, p = W.player, r = W.kernel.renderer;
  return { phase: W.phase, tier: W.gfxTier, glideNear: typeof W._lcGlideNear === 'function', nearGround: W.kernel._nearGround, touch: !!(W._gfx && W._gfx.touch), water: !!w, seg: w ? w.geometry.parameters.widthSegments : null,
    tris: w ? (w.geometry.index ? w.geometry.index.count / 3 : 0) : 0, defs: w ? Object.keys(w.material.defines || {}).sort() : null,
    near: W.kernel.camera.near, far: W.kernel.camera.far, size: [r.domElement.width, r.domElement.height],
    playerY: p ? +p.pos.y.toFixed(1) : null, vel: p && p.vel ? p.vel.toArray().map((x) => +x.toFixed(1)) : null }; }"""

# swap the water's geometry: 'quad' = the pre-fix 1 x 1 plane, 'ref' = a 512 x 512 reference (least float error; built here, same size, same
# rotation), 'ship' = the build's own
SWAP_JS = r"""(which) => { const W = window.__LC__.W, T = W.THREE, w = W.map.water;
  if (!w.userData.__shipGeo) w.userData.__shipGeo = w.geometry;
  const p = w.userData.__shipGeo.parameters, seg = { quad: 1, ref: 512 }[which];
  if (seg) { const key = '__geo' + seg; if (!w.userData[key]) { const g = new T.PlaneGeometry(p.width, p.height, seg, seg); g.rotateX(-Math.PI / 2); w.userData[key] = g; } w.geometry = w.userData[key]; }
  else w.geometry = w.userData.__shipGeo;
  return w.geometry.parameters.widthSegments; }"""


def flipback(fr, mask):
    """INFO only: water pixels that jump > JUMP and come back (colour). Motion-sensitive: a fine wave / glint texture sliding 1-2 px a frame
    also reads as a jump that returns (ULTRA's third wave layer at 40 m: 1.5 % in every config), so it does not judge."""
    out = []
    n = max(1, int(mask.sum()))
    for a, b, c in zip(fr, fr[1:], fr[2:]):
        d1 = np.abs(a - b).max(axis=2)
        d2 = np.abs(b - c).max(axis=2)
        d0 = np.abs(a - c).max(axis=2)
        out.append(float(((d1 > JUMP) & (d2 > JUMP) & (d0 < JUMP / 2) & mask).sum()) / n)
    return out


SHOWN_HI, SHOWN_LO = 16.0, 3.0   # /255 max channel: water decisively drawn / decisively not drawn at a pixel (between: undecided, never a toggle)


def toggles(state):
    """THE blink: per frame and pixel, is the water drawn (the frame vs the same frame with the water hidden: > SHOWN_HI = +1, < SHOWN_LO = -1,
    else 0)? A pixel that is decisively water, then decisively not, then water again (or the reverse) on consecutive frames blinked. Share of
    the pixels decisively water in any frame; the worst frame triple. A waterline sliding with the camera changes once and never returns, the
    waves' texture never stops being water; far water that is all fog (water vs no water within a few levels) is undecided, not a blink.
    Returns (per-triple shares, water share, the worst triple's toggled-pixel mask)."""
    anyw = np.zeros(state[0].shape, bool)
    for m in state:
        anyw |= m > 0
    n = max(1, int(anyw.sum()))
    out, worst = [], None
    for a, b, c in zip(state, state[1:], state[2:]):
        t = (a * b < 0) & (b * c < 0)
        out.append(float(t.sum()) / n)
        if worst is None or out[-1] >= max(out[:-1] or [0]):
            worst = t
    return out, float(anyw.mean()), worst


def state_of(F, B):
    d = np.abs(F - B).max(axis=2)
    return np.where(d > SHOWN_HI, 1, np.where(d < SHOWN_LO, -1, 0)).astype(np.int8)


def views(coasts):
    out = []
    for ci, coast in enumerate(coasts):
        for hgt in HEIGHTS:
            for pitch in PITCHES:
                back = hgt / np.tan(np.radians(pitch))
                cx, cz = coast["x"] - coast["dx"] * back * 0.5, coast["z"] - coast["dz"] * back * 0.5
                out.append(("c%d_h%d_p%d" % (ci, hgt, pitch), [cx, hgt, cz, cx + coast["dx"] * back, 0.0, cz + coast["dz"] * back, 60], (coast["dx"], coast["dz"])))
    return out


def descend(s, spec, dirxz):
    fr, shown, nears = [], [], []
    for i in range(NFR):
        s.step_frames(1, 1 / 60, render=False)
        s.js(WL.SETTLE_JS, T0 + i / 60)
        t = i / 60
        sp = list(spec)
        dy, fw = DESCENT[0] * t, DESCENT[1] * t
        sp[0] += dirxz[0] * fw; sp[2] += dirxz[1] * fw; sp[3] += dirxz[0] * fw; sp[5] += dirxz[1] * fw
        sp[1] += dy; sp[4] += dy
        r = s.js(RENDER_JS, [sp, [], None])
        nears.append(r["near"])
        F = WL.decode(r["png"])
        B = WL.decode(s.js(RENDER_JS, [sp, ["water"], None])["png"])      # the same frame (camera, clock), the water hidden
        fr.append(F)
        shown.append(state_of(F, B))
    tg, share, wmask = toggles(shown)
    fb = flipback(fr, shown[-1] > 0)
    return {"water": round(share, 3), "worst": round(max(tg), 5), "mean": round(float(np.mean(tg)), 5), "jumpBack": round(max(fb), 5),
            "near": [round(min(nears), 3), round(max(nears), 3)], "_mask": wmask}, fr


def set_cfg(s, cfg):
    geo, near = CONFIGS[cfg]
    s.js(SWAP_JS, geo)
    s.js("(m) => { window.__LC__.W.__wbNear = m; return m; }", near)


# a map with no sea shore for waterlook's cameras (Deepwood: a river / lakes): the same kinds of ground-level views at the first water edge the
# blink row found - the beach eye 1.7 m up looking along the waterline, 0.45 m over the water looking back at the land, 2 m under looking up
EDGE_CAMS_JS = r"""([c]) => { const M = window.__LC__.W.map, wy = M.waterY, H = (x, z) => M.heightAt(x, z), px = -c.dz, pz = c.dx, x = c.x, z = c.z, dx = c.dx, dz = c.dz;
  return { shore: [x - dx * 3, H(x - dx * 3, z - dz * 3) + 1.7, z - dz * 3, x + px * 40 + dx * 6, wy + 0.3, z + pz * 40 + dz * 6, 70],
           inwater: [x + dx * 6, wy + 0.45, z + dz * 6, x - dx * 20 + px * 12, wy + 2.5, z - dz * 20 + pz * 12, 70],
           underup: [x + dx * 8, wy - 1.0, z + dz * 8, x + dx * 30, wy + 1.5, z + dz * 30, 70] }; }"""


def look_ab(s, shots, tag, coasts=None):
    """ground-level views (waterlook's cameras), pinned clock, the same frame drawn as served, with a 512 x 512 reference plane (the least float
    error: what the flat plane's shading IS), as the pre-fix build (1-quad plane, ground near) and as served again (noise). A map whose water
    waterlook's camera search does not find (no sea shore): the same view kinds at the blink row's first inland water edge"""
    cams = s.js(WL.CAMS_JS)
    if not any(cams.get(k) for k in ("shore", "inwater", "underup", "sunward", "down")) and coasts and coasts[0].get("kind") == "inland":
        cams = s.js(EDGE_CAMS_JS, [coasts[0]])
    out = {}
    for nm in ("shore", "inwater", "underup", "sunward", "down"):
        spec = cams.get(nm)
        if not spec:
            continue
        set_cfg(s, "fixed")
        WL.view(s, spec, settle=WL.SHORE_T[1])          # (settles the view: LOD ring, shadow focus)
        fr = {}
        for k, c in (("fixed", "fixed"), ("ref", "ref"), ("preFix", "preFix"), ("fixed2", "fixed")):
            set_cfg(s, c)
            s.js(WL.SETTLE_JS, WL.SHORE_T[1])
            fr[k] = s.js(RENDER_JS, [spec, [], None])
        set_cfg(s, "fixed")
        for k in ("fixed", "preFix", "ref"):
            WL.save(fr[k]["png"], shots, "%s_look_%s_%s.png" % (tag, nm, k))
        A = {k: WL.decode(fr[k]["png"]) for k in fr}
        d8 = lambda a, b: round(float((np.abs(A[a] - A[b]).max(axis=2) > 8).mean()), 6)
        out[nm] = {"fixedVsRef": d8("fixed", "ref"), "preFixVsRef": d8("preFix", "ref"), "fixedVsPreFix": d8("fixed", "preFix"), "noise": d8("fixed", "fixed2"),
                   "meanLuma[fixed, preFix]": [round(float(WL.lum(A["fixed"]).mean()), 4), round(float(WL.lum(A["preFix"]).mean()), 4)],
                   "near": [fr["fixed"]["near"], fr["preFix"]["near"]]}
    return out


def gpu_ab(s):
    """the game's own drop frame (its camera), GPU ms with the served plane vs the 1-quad plane, interleaved 3 x 40 frames each (one warm-up first)"""
    res = {"fixed": [], "preFix": []}
    if L.gpu_ms(s, 20) is None:
        return None
    for _ in range(3):
        for c in ("fixed", "preFix"):
            s.js(SWAP_JS, CONFIGS[c][0])           # (the geometry only: the near plane costs nothing)
            m = L.gpu_ms(s, 40) or []
            res[c] += m[5:]
    set_cfg(s, "fixed")
    f, q = L.med(res["fixed"]), L.med(res["preFix"])
    return {"fixedMs": round(f, 3) if f else None, "preFixMs": round(q, 3) if q else None, "ratio": round(f / q, 3) if f and q else None, "n": [len(res["fixed"]), len(res["preFix"])]}


def run_one(args, v, map_id, tier, plant, shots):
    tag = "%s_%s" % (map_id, tier)
    kw = {}
    if tier == "phone":
        sp = MK.DEVICES["pixel7"]
        kw = dict(viewport={"width": sp["w"], "height": sp["h"]}, init_scripts=[MK.PHONE_NO_LOCK],
                  context_kw={"device_scale_factor": sp["dpr"], "is_mobile": True, "has_touch": True, "user_agent": sp["ua"]})
    R = {}
    row = "no water blink from altitude [%s]" % tag
    with C.Session(args, "p23_waterblink_" + tag, **kw) as s:
        plant(s)
        s.boot()
        L.dismiss_cards(s)
        s.js("() => { try { localStorage.setItem('lc_tutorial_seen', '1'); } catch (e) {} return 1; }")
        if tier != "phone":
            R["setGfx"] = s.safe_js("(t) => { const W = window.__LC__.W; return W.setGfx ? JSON.stringify(W.setGfx('tier', t)) : 'no setGfx'; }", tier)
        R["start"] = s.start_match("standard", SEED, map_id, enter=True, guard=True)
        s.freeze_loop()
        s.install_pump()
        s.guard_player(True)
        s.step_frames(4, 1 / 60, render=True)
        info = R["info"] = s.js(INFO_JS)
        v.info("%s: session" % tag, info)
        if info["phase"] != "drop":
            v.cnj(row, "not in the drop (phase %s)" % info["phase"])
            return R
        if not info["water"]:
            v.check(row, map_id == "ashgrid", {"water": False}, "a map without water has no water mesh (nothing to blink)")
            L.errors_row(v, s, "0 page errors / console errors / failed requests [%s]" % tag)
            return R
        if not info["glideNear"]:
            v.cnj(row, "the map's glide near-plane rule (W._lcGlideNear) is missing")
            return R
        coasts = R["coasts"] = s.js(COAST_JS)
        if not coasts:
            v.cnj(row, "no coast found")
            return R
        if not args.no_gpu:
            R["gpu"] = gpu_ab(s)
            v.info("%s: GPU ms of the game's drop frame, served plane vs 1-quad plane" % tag, R["gpu"] or "GPU timer not supported")
        res = {}
        aloft = []
        cfgs = ["fixed", "preFix"] + (["noSeg", "noNear"] if args.ab else [])
        from PIL import Image
        for cfg in cfgs:
            set_cfg(s, cfg)
            res[cfg] = {}
            for nm, spec, dirxz in views(coasts):
                aloft.append(s.js(ALOFT_JS))
                m, fr = descend(s, spec, dirxz)
                wm = m.pop("_mask")
                res[cfg][nm] = m
                if cfg == "fixed" and m["worst"] > BAR / 2 and wm is not None:      # where the as-served build still toggles: red over the frame
                    ov = fr[3].copy()
                    ov[wm] = [255, 0, 0]
                    Image.fromarray(ov.astype(np.uint8)).save(os.path.join(shots, "%s_toggles_%s.png" % (tag, nm)))
                if nm in ("c0_h160_p45", "c0_h250_p45") and cfg in ("fixed", "preFix"):
                    for i in (2, 3):
                        Image.fromarray(fr[i].astype(np.uint8)).save(os.path.join(shots, "%s_%s_%s_f%d.png" % (tag, cfg, nm, i)))
        set_cfg(s, "fixed")
        R["views"] = res
        notglide = sum(1 for x in aloft if not (x and x["gliding"]))
        worst = {c: max(x["worst"] for x in res[c].values()) for c in cfgs}
        hot = {k: x["worst"] for k, x in res["fixed"].items() if x["worst"] > BAR}
        # 2026-11-24 (lead ruling, deepwood's 3 m river): a waterline pixel that aliases as the camera descends toggles in ANY render, the
        # error-free one included (512-seg plane, near 1.0 m: 0.0012 at c1_h330_p25) - on a thin river that is a large share of little water.
        # THE blink is the depth error, so a view over BAR is judged on its EXCESS over that reference render of the same view (same
        # session, same frames); views at or under BAR are judged as before. BAR itself is unchanged.
        excess = {}
        if hot:
            set_cfg(s, "refAloft")
            byname = {nm: (spec, dirxz) for nm, spec, dirxz in views(coasts)}
            for nm in hot:
                m, _fr = descend(s, *byname[nm])
                m.pop("_mask", None)
                excess[nm] = {"fixed": hot[nm], "ref": m["worst"], "excess": round(hot[nm] - m["worst"], 5)}
            set_cfg(s, "fixed")
        judged = max([0.0] + [x["worst"] for k, x in res["fixed"].items() if k not in excess] + [e["excess"] for e in excess.values()])
        per = {k: [res[c][k]["worst"] for c in cfgs] for k in res["fixed"]}
        detail = {"worst": worst, "judged": judged, "overVsRef": excess, "seg": info["seg"], "over": hot, "cols": cfgs, "perView": per, "near": {k: x["near"] for k, x in res["fixed"].items()}}
        if notglide:
            v.cnj(row, "the diver was not gliding at %d of %d views: %s" % (notglide, len(aloft), aloft[:3]))
        else:
            v.check(row, judged <= BAR, detail, "worst toggle share of the water pixels <= %.3f over %d views (descending), as served; a view over it is judged on its excess over the error-free reference render of the same view" % (BAR, len(per)))
        R["look"] = look_ab(s, shots, tag, coasts)
        lw = max((x["fixedVsRef"] for x in R["look"].values()), default=None)
        nz = max((x["noise"] for x in R["look"].values()), default=0)
        if lw is None:
            v.cnj("ground-level look unchanged [%s]" % tag, "no ground-level water view found")
        elif nz > LOOK_BAR / 2:
            v.cnj("ground-level look unchanged [%s]" % tag, "the same frame drawn twice differs in %.4f of the pixels" % nz)
        else:
            v.check("ground-level look unchanged [%s]" % tag, lw <= LOOK_BAR and all(x["near"][0] == x["near"][1] for x in R["look"].values()), R["look"],
                    "<= %.4f of the pixels differ > 8/255 from the 512 x 512 reference plane; the ground near plane untouched" % LOOK_BAR)
        s.step_frames(4, 1 / 60, render=True)
        L.errors_row(v, s, "0 page errors / console errors / failed requests [%s]" % tag)
    return R


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--runs", default=None, help="map:tier,... (tier ultra / high / medium / low / phone); default " + DEFAULT_RUNS)
    ap.add_argument("--full", action="store_true", help="every map x ultra / medium / low / phone")
    ap.add_argument("--ab", action="store_true", help="also measure noSeg (1-quad + glide near) and noNear (served plane + ground near)")
    ap.add_argument("--no-gpu", action="store_true", help="skip the GPU-ms A/B")
    ap.add_argument("--shots", default=None)
    args = L.parse(ap)
    runs = [r.split(":") for r in (args.runs or (FULL_RUNS if args.full else DEFAULT_RUNS)).split(",") if r]
    if args.plant and not args.runs:
        runs = [["isla_viva", "medium"], ["deepwood", "medium"]]
    tag = args.plant or ("rev-" + args.rev if getattr(args, "rev", None) else "disk")
    shots = args.shots or os.path.join(C.SHOTS, "waterblink_" + tag)
    os.makedirs(shots, exist_ok=True)

    def plant(s):
        if args.plant:
            for rel, edits in PLANTS[args.plant]:
                L.serve_patched(s, rel, edits)

    def body(v):
        R = v.data["rows"] = {}
        for map_id, tier in runs:
            R["%s_%s" % (map_id, tier)] = run_one(args, v, map_id, tier, plant, shots)

    return C.run_gate("p23_waterblink", body, args)


if __name__ == "__main__":
    sys.exit(main())
