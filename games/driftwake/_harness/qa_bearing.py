#!/usr/bin/env python
"""Ridge-bearing table across realms, high-pass widths, crops and LAYERS.

Two jobs.

1. REPORT, in one table, exactly the measurement that refuted the last agent's
   "sand ripples run transverse" claim: `qa_aniso.measure` (structure tensor of
   the box-blur high-pass residual) at four high-pass widths per realm, so this
   wave's numbers are directly comparable with the last wave's.

2. DECOMPOSE it. A bearing measured on the beauty frame is the sum of every
   layer that writes a normal, and the realm's micro-relief is only one of them.
   Pass `--layers` and each realm is additionally shot with:

       full     as shipped
       norealm  realmUniforms.uFineA.x = uFineB.y = 0  (realm layer off)
       nofine   terrain._sastrugiMul = 0  (kills BOTH analytic fine twins --
                lib/terrain's sastrugi AND realmFine, which is handed the same
                `sastrugiAmp` as its amplitude)
       macro    nofine + S.detailNormalStrength = 0  (macro landform alone)
       fineonly debugView 'fineNormals' -- normalFromGradient(fine.yz), i.e. the
                analytic fine layer with the landform REMOVED. The instrument
                that says what realmFine is actually doing, as opposed to what
                survives into the beauty frame.

   If `full` and `macro` report the same bearing, the landform is what the
   structure tensor is measuring and no change to the fine octave can move it.

Uses the qa_realmab pinning (frozen clock, restored camera transform) so every
frame in the table differs by the realm and the override and nothing else.

    python _harness/qa_bearing.py --layers
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from playwright.sync_api import sync_playwright
from qa_aniso import measure

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# The last three matter when another agent's Chrome is running on the same
# desktop: an occluded or backgrounded window stops servicing rAF, and the frame
# counter this probe waits on simply stops advancing.
FLAGS = ["--ignore-gpu-blocklist", "--use-angle=d3d11", "--disable-gpu-sandbox",
         "--enable-gpu-rasterization",
         "--disable-features=CalculateNativeWinOcclusion",
         "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding",
         "--disable-background-timer-throttling"]

READY = """() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.enterRealm || !SF.rig || !SF.character) return false;
  const b = document.getElementById('boot');
  return !(b && !b.classList.contains('gone'));
}"""

CAPTURE = """() => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character;
  return { cp: c.position.toArray(), cq: c.quaternion.toArray(),
           chp: ch.position.toArray() };
}"""

RESTORE = """(P) => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character;
  ch.position.fromArray(P.chp);
  c.position.fromArray(P.cp);
  c.quaternion.fromArray(P.cq);
  c.updateMatrixWorld(true);
  return true;
}"""

# ---------------------------------------------------------------- the top-down
# pose. The shipped chase camera looks along a near-grazing slope, where the
# world->screen Jacobian is close to singular: a 90-degree rotation in the world
# lands as a few degrees on screen (measured -- see the wind-90 control rows), so
# a screen-space structure tensor there reports the FORESHORTENING axis whatever
# the surface does. Looking straight down makes the Jacobian a similarity, and
# then a world bearing is a screen bearing.
#
# With camera.up = (0,0,-1) and the camera looking down -Y:
#     screen +x = world +X,  screen UP = world -Z
# so a world direction (dx, dz) reads as the screen-up-frame vector (dx, -dz),
# which is the frame qa_aniso already reports in.
TOPDOWN = """(P) => {
  const SF = globalThis.SNOWFLOW, c = SF.rig.camera, ch = SF.character;
  // The rig re-derives the camera from the character every frame (camera.js:166),
  // so a pose written from outside survives exactly one frame. Neutralise it for
  // the life of the page rather than racing it.
  if (!SF.rig.__frozen) { SF.rig.__frozen = true; SF.rig.update = function () {}; }
  ch.position.fromArray(P.chp);
  for (const o of [SF.character, SF.figure]) { if (o && 'visible' in o) o.visible = false; }
  const tx = P.chp[0] + P.off, tz = P.chp[2] + P.off;
  c.position.set(tx, P.chp[1] + P.h, tz);
  c.up.set(0, 0, -1);
  c.lookAt(tx, P.chp[1], tz + 1e-4);
  c.updateMatrixWorld(true);
  const vh = 2 * P.h * Math.tan(c.fov * Math.PI / 360);
  return { fov: c.fov, mPerPx: +(vh / 720).toFixed(4),
           spanX: +(vh * c.aspect).toFixed(1) };
}"""

CHROME = """() => {
  for (const sel of ['#hud','#crosshair','#spellbar','#minimap','#overlay',
                     '#boot','.ffg-controls','#xp','#floaters','#enemybars']) {
    document.querySelectorAll(sel).forEach(e => { e.style.visibility = 'hidden'; });
  }
}"""

# Layer overrides. Each is applied from the realm's own freshly-applied state, so
# they never stack; `reset` restores from the values recorded at entry.
APPLY = """(o) => {
  const SF = globalThis.SNOWFLOW, T = SF.terrain, u = T.realmUniforms;
  if (o.saveIt) {
    globalThis.__sv = { fa: u.uFineA.value.toArray(), fb: u.uFineB.value.toArray(),
                        sm: T._sastrugiMul, ds: SF.S.detailNormalStrength,
                        wd: SF.S.windDirection };
  }
  const sv = globalThis.__sv;
  u.uFineA.value.fromArray(sv.fa);
  u.uFineB.value.fromArray(sv.fb);
  T._sastrugiMul = sv.sm;
  SF.S.detailNormalStrength = sv.ds;
  SF.S.windDirection = sv.wd;
  SF.S.debugView = 'beauty';
  if (o.norealm) { u.uFineA.value.x = 0.0; u.uFineB.value.y = 0.0; }
  if (o.nofine)  { T._sastrugiMul = 0.0; }
  if (o.nodetail){ SF.S.detailNormalStrength = 0.0; }
  // Rotating the wind rotates every ANALYTIC fine layer live (windAngle is a
  // per-frame clipmap uniform) and leaves the baked landform and the tiled grain
  // exactly where they are. If the measured bearing does not follow it, the
  // analytic layer is not what the measurement is looking at.
  if (o.wind) { SF.S.windDirection = (sv.wd + o.wind) % 360; }
  // A debug view is a DATA readout, and the post chain is a picture chain: AgX
  // plus contrast plus bloom plus grain plus sharpen all mix channels, and that
  // mixing shows up in a two-channel gradient readout as a spurious gx==gz
  // correlation (measured: every realm reported ~137 deg at coherence 0.5-0.8,
  // wind-invariant, which is the signature of R and B carrying a common
  // luminance term). Flatten the chain whenever a debug view is being measured.
  if (!globalThis.__pv) {
    globalThis.__pv = { t: SF.S.tonemap, e: SF.S.exposure, c: SF.S.contrast,
                        b: SF.S.bloom, g: SF.S.grain, sh: SF.S.sharpen,
                        d: SF.S.dof, ta: SF.S.taa, sr: SF.S.ssr,
                        ls: SF.S.showLightShafts };
  }
  const pv = globalThis.__pv;
  SF.S.tonemap = pv.t; SF.S.exposure = pv.e; SF.S.contrast = pv.c;
  SF.S.bloom = pv.b; SF.S.grain = pv.g; SF.S.sharpen = pv.sh;
  SF.S.dof = pv.d; SF.S.taa = pv.ta; SF.S.ssr = pv.sr;
  if (o.debugView) {
    SF.S.debugView = o.debugView;
    SF.S.tonemap = 'none'; SF.S.exposure = 1.0; SF.S.contrast = 1.0;
    SF.S.bloom = false; SF.S.grain = false; SF.S.sharpen = false;
    SF.S.dof = false; SF.S.ssr = false;
    // God rays are composited over the whole frame in post, so they survive the
    // fragment-stage debug override as a smooth achromatic wash -- identical in
    // R and B, which is exactly the common-mode the zero-relief control caught
    // (fine == 0 still measured coherence 1.00 at 135 deg). TAA off too: with a
    // jittered projection the resolve mixes neighbours across a frozen frame.
    SF.S.showLightShafts = false; SF.S.taa = false;
  }
  return { fineMode: u.uFineMode.value, fineA: u.uFineA.value.toArray(),
           fineB: u.uFineB.value.toArray(), sastrugiMul: T._sastrugiMul,
           detail: SF.S.detailNormalStrength, wind: SF.S.windDirection,
           view: SF.S.debugView };
}"""

LAYERS = [
    ("full",     {}),
    ("norealm",  {"norealm": True}),
    ("nofine",   {"nofine": True}),
    ("macro",    {"nofine": True, "nodetail": True}),
    # The analytic fine layer's OWN contribution to the beauty frame, with the
    # tiled grain out of the way. This is the row a realm's micro-relief has to
    # move; `full` is the row the player sees.
    ("detoff",   {"nodetail": True}),
    ("detoff90", {"nodetail": True, "wind": 90}),
    ("full90",   {"wind": 90}),
    ("fineonly", {"debugView": "fineNormals"}),
    # Same view with the wind spun a quarter turn: the instrument's own validity
    # check. A measurement of wind-aligned relief that does not move ~90 degrees
    # here is not measuring wind-aligned relief.
    ("fineon90", {"debugView": "fineNormals", "wind": 90}),
    # Zero-relief control: sastrugiMul 0 makes `fine` identically zero, so the
    # fineNormals view is a CONSTANT colour and any anisotropy the tensor reports
    # on it is the instrument's, not the surface's.
    ("fineflat", {"debugView": "fineNormals", "nofine": True}),
]

# Two crops, both terrain-only at the pinned pose (verified against
# _shots/qa_ab_cold.png): NEAR is the left foreground slope, MID the bank the
# character is on. The HUD strip and the FFG buttons are chrome-hidden anyway.
# NEAR is the exact crop the last wave's bearing table was measured on, kept
# unchanged so this wave's numbers are comparable with it.
CROPS = {"near": (40, 430, 360, 200), "mid": (620, 300, 320, 180)}
HPS = (5, 9, 13, 17)

# Top-down: one large centred crop, and high-pass widths chosen against the
# metres-per-pixel the probe prints (~0.065 m/px at h=45), so the band spans
# Sand's 0.9 m ripple (~14 px) up through Cold's 2.3 m sastrugi (~35 px).
TD_CROPS = {"td": (240, 60, 800, 600), "tdc": (420, 200, 600, 440)}
TD_HPS = (9, 15, 25, 41)
TD_H = 45.0
TD_OFF = 34.0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--layers", action="store_true")
    ap.add_argument("--tag", default="bg")
    ap.add_argument("--realms", default="cold,sand,ash")
    ap.add_argument("--pose", default="grazing", choices=["grazing", "topdown"])
    ap.add_argument("--only", default="", help="comma-separated layer subset")
    args = ap.parse_args()

    realms = args.realms.split(",")
    layers = LAYERS if args.layers else LAYERS[:1]
    if args.only:
        keep = set(args.only.split(","))
        layers = [l for l in LAYERS if l[0] in keep]
    topdown = args.pose == "topdown"
    crops = TD_CROPS if topdown else CROPS
    hps = TD_HPS if topdown else HPS
    rows, errors = [], []

    with sync_playwright() as p:
        br = p.chromium.launch(channel="chrome", headless=False, args=FLAGS)
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.on("pageerror", lambda e: errors.append("pageerror: %s" % e))
        pg.on("console", lambda m: errors.append("console.error: " + m.text)
              if m.type == "error" else None)
        pg.add_init_script(
            "window.__f=0;(function t(){window.__f++;requestAnimationFrame(t);})();")
        pg.goto("http://localhost:8788/games/driftwake/index.html?v=%s" % args.tag,
                wait_until="load", timeout=90_000)
        pg.bring_to_front()
        pg.wait_for_function(READY, timeout=220_000)

        def frames(n):
            s = pg.evaluate("() => window.__f")
            try:
                pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s,
                                     timeout=60_000)
            except Exception:
                # rAF stalled (window occluded by a concurrent agent's browser).
                # Front the page and give it one more window before failing loud.
                pg.bring_to_front()
                pg.wait_for_function("(s) => window.__f > s + %d" % n, arg=s,
                                     timeout=60_000)

        frames(60)
        pg.evaluate(CHROME)
        pose = pg.evaluate(CAPTURE)
        pose["h"], pose["off"] = TD_H, TD_OFF
        print("pinned camera=%s character=%s"
              % (json.dumps([round(v, 2) for v in pose["cp"]]),
                 json.dumps([round(v, 2) for v in pose["chp"]])))

        SET_POSE = TOPDOWN if topdown else RESTORE
        if topdown:
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
            frames(3)
            print("top-down %s" % json.dumps(pg.evaluate(TOPDOWN, pose)))

        for realm in realms:
            if realm != "cold":
                pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = false; }")
                pg.evaluate("(r) => globalThis.SNOWFLOW.enterRealm(r)", realm)
                frames(150)
            pg.evaluate("() => { globalThis.SNOWFLOW.S.freezeTime = true; }")
            frames(4)
            first = True
            for name, ov in layers:
                o = dict(ov)
                o["saveIt"] = first
                st = pg.evaluate(APPLY, o)
                first = False
                pg.evaluate(SET_POSE, pose)
                frames(3)
                pg.evaluate(SET_POSE, pose)
                frames(2)
                path = "_shots/%s_%s_%s.png" % (args.tag, realm, name)
                pg.screenshot(path=path)
                for cname, (x, y, w, h) in crops.items():
                    for hp in hps:
                        m = measure(path, x, y, w, h, hp=hp)
                        rows.append(dict(realm=realm, layer=name, crop=cname,
                                         hp=hp, ridge=m["ridge_deg"],
                                         coh=m["coherence"], energy=m["energy"]))
                print("  %-5s %-8s mode=%s fineA=%s sastrugiMul=%.2f view=%s"
                      % (realm, name, st["fineMode"],
                         [round(v, 4) for v in st["fineA"]],
                         st["sastrugiMul"], st["view"]))
            # leave the realm in its shipped state before the next swap
            pg.evaluate(APPLY, {"saveIt": False})

        print("\nerrors %d" % len(errors))
        for e in errors[:8]:
            print("  ", e)
        br.close()

    for cname in crops:
        print("\n=== %s crop %s %s ===" % (args.pose, cname, crops[cname]))
        print("%-6s %-9s %s" % ("realm", "layer",
                                "  ".join("hp%-2d ridge  coh " % h for h in hps)))
        for realm in realms:
            for name, _ in layers:
                cells = []
                for hp in hps:
                    r = next(q for q in rows if q["realm"] == realm
                             and q["layer"] == name and q["crop"] == cname
                             and q["hp"] == hp)
                    cells.append("%6.1f %.3f" % (r["ridge"], r["coh"]))
                print("%-6s %-9s %s" % (realm, name, "  ".join(cells)))

    out = "_harness/%s_rows.json" % args.tag
    with open(out, "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1)
    print("\nrows -> " + out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
