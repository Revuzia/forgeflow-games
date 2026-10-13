#!/usr/bin/env python
"""SKY lane (Wave 4): the plan P4.2 STEP B A/B sheet for the owner. NOT shipped - nothing here touches the repo's maps.js.

Two builds are rendered through the real game on all three maps (ground + drop views, the new clouds in frame):
  A = the shipped step A   (working-copy maps.js)
  B = step A + the owner-held step B, applied as substitutions to the SERVED copy only:
        toneMappingExposure 1.15 -> 0.90   and   every terrain colour (colorAt -> rgb()) x 0.80  ("darker sand/grass")
Output: a contact sheet (rows = maps; columns = ground A | ground B | chute A | chute B | drop A | drop B), the three exterior reference frames
(ref_t08 / t22 / t52) underneath, and per-tile imgstats (brightness = mean luma, saturation, |red - blue|) printed under each tile
and saved to JSON. Neutral tone mapping is kept (the plan's AgX / ACES findings), the menu diorama is untouched.

Everything except maps.js is served frozen from git HEAD (other lanes are mid-edit in the same tree).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sky_lib as L  # noqa: E402

C = L.C
REF_DIR = (r"C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/"
           r"scratchpad/lc_look/reference/")
REFS = [("ref_t08_drop_overview_towns.jpg", "BridgeZone t08 (drop)"), ("ref_t22_parachute_downtown_storm.jpg", "BridgeZone t22 (chute)"),
        ("ref_t52_fpp_street_houses_lootbeam.jpg", "BridgeZone t52 (street)")]

STEP_B = [
    ("kn.renderer.toneMappingExposure = 1.15;", "kn.renderer.toneMappingExposure = 0.9;"),
    ("function rgb(o, r, g, b) { o[0] = r; o[1] = g; o[2] = b; return o; }", "function rgb(o, r, g, b) { o[0] = r * 0.80; o[1] = g * 0.80; o[2] = b * 0.80; return o; }"),
]


def lush_spot(mr):
    """A ground spot on ordinary grass / sand (3-25 m above the waterline), not the volcano rock."""
    s = mr.s
    cand = []
    for q in mr.pois:
        h = s.js("([x,z]) => window.__SKY__.ground(x,z)", [q["x"], q["z"]])
        if 3.0 <= h <= 25.0:
            cand.append((q["r"], q, h))
    if not cand:
        return mr.ground_spot()[:4]
    _, q, _ = max(cand, key=lambda t: t[0])
    gx, gz = q["x"] + 30.0, q["z"] + 30.0
    gy = s.js("([x,z]) => window.__SKY__.ground(x,z)", [gx, gz])
    sun = s.js("() => window.__LC__.W.map.K.sun.pos")
    return gx, gy, gz, math.atan2(-sun[0], -sun[2])


def run(args, which, subs, label, maps):
    a = argparse.Namespace(**vars(args))
    a.disk = True
    a.rev = "HEAD"
    out = {}
    outdir = os.path.join(args.shots, label)
    with C.Session(a, "stepb_" + label) as s:
        L.maps_override(s, which, subs)
        s.boot()
        s.freeze_loop()
        s.install_pump()
        for mid in maps:
            mr = L.MapRun(s, mid, args.seed, "standard", outdir, label)
            mr.start()
            x, y, z, yaw, pit = mr.drop_pose(250.0)
            mr.take("drop", x, y, z, yaw, pit, ground=False)
            # chute view (like ref t22, a canopy at 69 m): 90 m above the POI is under the 110 m auto-deploy height, so the
            # canopy is out, and the shallow pitch puts the horizon and the new cloud deck in frame (the freefall "drop" tile,
            # like ref t08, looks down and shows no sky)
            # (v2 used the drop pose's pitch -0.2: the canopy camera then looked down at the ground and the horizon sat at the
            #  very top of the frame on all three maps, so no cloud deck was in view; +0.10 = looking slightly up, like ref t22)
            x, y, z, yaw, pit = mr.drop_pose(90.0)
            mr.take("chute", x, y, z, yaw, 0.10, ground=False, frames=10)
            s.land(max_s=120, protect=True)
            gx, gy, gz, sun_yaw = lush_spot(mr)
            mr.take("ground", gx, gy + 0.05, gz, sun_yaw + 0.9, 0.12, vy=0, ground=True, frames=10)
            out[mid] = {k: {"png": v["png"], "imgstats": v["imgstats"], "fog": v["fogDensity"], "exposure": s.js("() => window.__LC__.W.kernel.renderer.toneMappingExposure")}
                        for k, v in mr.shots.items()}
        out["_diag"] = {k: v[:3] for k, v in s.diagnostics().items() if isinstance(v, list) and v and k in ("consoleErrors", "pageErrors", "windowErrors", "shader", "failedRequests")}
    return out


def tile(path, w, h, caption, ref=False):
    import cv2
    import numpy as np
    im = cv2.imread(path)
    ih, iw = im.shape[:2]
    sc = min(w / iw, h / ih)
    im = cv2.resize(im, (int(iw * sc), int(ih * sc)), interpolation=cv2.INTER_AREA)
    canvas = np.full((h + 34, w, 3), 24, np.uint8)
    canvas[0:im.shape[0], 0:im.shape[1]] = im
    st = L.stats(path)
    txt = "%s  luma %.2f  sat %.2f  |r-b| %.2f" % (caption, st["luma"], st["sat"], st["abs_r_minus_b"])
    cv2.putText(canvas, txt, (6, h + 22), cv2.FONT_HERSHEY_SIMPLEX, 0.38 if w < 450 else 0.46, (235, 235, 235), 1, cv2.LINE_AA)
    return canvas, st


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--maps", default="isla_viva,ashgrid,deepwood")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--shots", required=True)
    ap.add_argument("--sheet", required=True)
    args = ap.parse_args()
    maps = [m for m in args.maps.split(",") if m]
    os.makedirs(args.shots, exist_ok=True)
    A = run(args, "work", None, "A", maps)
    B = run(args, "work", STEP_B, "B", maps)
    import cv2
    import numpy as np
    W_, H_ = 400, 225
    rows = []
    table = {"maps": {}, "refs": {}}
    for mid in maps:
        cells = []
        for kind in ("ground", "chute", "drop"):
            for lab, R in (("A step A (shipped)", A), ("B step A + exposure 0.9, albedo x0.8", B)):
                c, st = tile(R[mid][kind]["png"], W_, H_, "%s %s %s" % (mid[:5], kind, lab[0]))
                cells.append(c)
                table["maps"].setdefault(mid, {})["%s_%s" % (kind, lab[0])] = {k: round(v, 3) for k, v in st.items()}
        rows.append(np.hstack(cells))
    ref_cells = []
    for f, name in REFS:
        c, st = tile(REF_DIR + f, W_, H_, name.replace("BridgeZone ", "BZ "))
        ref_cells.append(c)
        table["refs"][name] = {k: round(v, 3) for k, v in st.items()}
    while len(ref_cells) < 6:
        ref_cells.append(np.full_like(ref_cells[0], 24))
    rows.append(np.hstack(ref_cells))
    sheet = np.vstack(rows)
    head = np.full((46, sheet.shape[1], 3), 16, np.uint8)
    cv2.putText(head, "Last Circle P4.2 STEP B A/B (NOT shipped). Columns: ground A | ground B | chute 90 m A | chute B | freefall 250 m A | freefall B. A = step A only (shipped). B = A + exposure 1.15->0.90 + terrain albedo x0.80.",
                (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.52, (255, 255, 255), 1, cv2.LINE_AA)
    cv2.putText(head, "Bottom row: BridgeZone exterior reference frames t08 / t22 / t52 (the only ones the colour targets are judged against). Under each tile: mean luma, mean HSV saturation, |red - blue|.",
                (8, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.46, (200, 200, 200), 1, cv2.LINE_AA)
    sheet = np.vstack([head, sheet])
    os.makedirs(os.path.dirname(os.path.abspath(args.sheet)), exist_ok=True)
    cv2.imwrite(args.sheet, sheet, [cv2.IMWRITE_JPEG_QUALITY, 90])
    jp = os.path.splitext(args.sheet)[0] + "_stats.json"
    json.dump({"stepB": [list(x) for x in STEP_B], "table": table, "diagA": A.get("_diag"), "diagB": B.get("_diag")}, open(jp, "w"), indent=1)
    print("sheet", args.sheet, sheet.shape)
    print("stats", jp)
    print("%-26s %6s %6s %7s" % ("tile", "luma", "sat", "|r-b|"))
    for mid, d in table["maps"].items():
        for k, st in d.items():
            print("%-26s %6.3f %6.3f %7.3f" % (mid + " " + k, st["luma"], st["sat"], st["abs_r_minus_b"]))
    for k, st in table["refs"].items():
        print("%-26s %6.3f %6.3f %7.3f" % (k, st["luma"], st["sat"], st["abs_r_minus_b"]))
    bad = (A.get("_diag") or {}) or (B.get("_diag") or {})
    print("diagnostics:", "clean" if not bad else json.dumps(bad)[:400])
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
