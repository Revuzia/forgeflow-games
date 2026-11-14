#!/usr/bin/env python
"""HIT PARADE look evidence - the G5 inputs (CONTRACT section 7, 13). Lane VIEW. Adapted from dyefield _harness/lookshots.py.

    python _harness/lookshots.py                     # the VIEW lab (runtime/lab/view.html), headed Chrome d3d11, 1600x900
    python _harness/lookshots.py --headless          # headless Chrome (same d3d11 flags)
    python _harness/lookshots.py --only toon,sep     # a subset of the shot groups
    python _harness/lookshots.py --base http://localhost:5323/ --no-serve
    python _harness/lookshots.py --game                # P2: the REAL game page (/?mode=...&dev=1, frozen, one tick per
                                                       #   rendered frame): gprops (props + projectiles per fighter), gbrawl,
                                                       #   gheckler (real goon GLBs, popups), gstage (dressing live values)
    python _harness/lookshots.py --game --only g3d     # CHANGED(VIEW3D): the 3D ring in the REAL game - circling (7 camera
                                                       #   angles), a sidestep dodging a projectile, a ring wall splat, PRIME
                                                       #   TIME on a diagonal, the 5 arenas (P2 circling: mirrored step clips),
                                                       #   BRAWL from all bearings. STEP (input bits 13/14) goes through
                                                       #   __HP__.dev.setInputs when input.ts WORD_MASK carries them, else a
                                                       #   dev-page patch of Input.sampleAll ORs them in (reported as stepDrive)
    python _harness/lookshots.py --sim                 # P2: REAL sim + REAL data drive the view (lab view.html?sim=1):
                                                       #   prime (a strip per fighter's Lv3 PRIME TIME), proj (every
                                                       #   projectile type), props, lineup (12), showcase, ko, brawl,
                                                       #   heckler, stage; --only / --fighters narrow it

Groups (all through the lab's scripted snapshots - no sim; every frame is stepped 0..N at 1/60 s, so a shot is the same
picture on every run):
  toon     both bodies side by side (Ch42 realistic 4K body + Brute painted body) with the shared cel material + outline,
           plus the colour alternates
  sep      camera framing at separation 1 m / 3 m / 6 m (FIGHTING_DESIGN 7b: 4.36 / 4.91 / 7.58 m at 16:9)
  anim     pose-from-state: attack windup, hitstop contact (attacker holds, victim shakes), recovery; knockdown; jump pan
  fx       hit sparks L/M/H, counter, punish, block, parry, IMPACT armour, throw, wall splat; splatter / sparks / confetti
  super    super-freeze punch-in + background dim, the Lv3 cinematic track (3 shots)
  showcase the char-select turntable (view/showcase.ts) in a canvas region, colour alternate + win pose
  ko       KO hitstop, slow-mo orbit, finish-zoom hold; perfect-parry zoom freeze
Writes _shots/<prefix>_<name>.png and _harness/_reports/lookshots_<prefix>.json (camera numbers per shot).
Exit 0 when every shot saved and the page stayed clean (0 console errors / page errors / failed requests); 1 otherwise;
2 setup failure. READ EVERY PNG - the gate is the vision review, not this exit code.
"""
import argparse
import json
import os
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SHOTS = os.path.join(ROOT, "_shots")
REPORTS = os.path.join(HERE, "_reports")
PORT = 5323
FLAGS = [
    "--ignore-gpu-blocklist",
    "--use-angle=d3d11",
    "--enable-gpu-rasterization",
    "--disable-features=CalculateNativeWinOcclusion",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
]

GROUPS = {
    "toon": [
        ("toon_lineup", "lineup", 60, {"sep": 1.3}),
        ("toon_fight_close", "idle", 60, {"sep": 1.0}),
    ],
    "sep": [
        ("sep_1m", "idle", 90, {"sep": 1.0}),
        ("sep_3m", "idle", 90, {"sep": 3.0}),
        ("sep_6m", "idle", 90, {"sep": 6.0}),
    ],
    "anim": [
        ("anim_windup", "attack", 25, {}),
        ("anim_contact_hitstop", "attack", 33, {}),
        ("anim_recovery", "attack", 52, {}),
        ("anim_block", "attack", 86, {}),
        ("anim_knockdown_fall", "knockdown", 80, {}),
        ("anim_knockdown_floor", "knockdown", 170, {}),
        ("anim_wakeup", "knockdown", 250, {}),
        ("anim_walk", "walk", 40, {"sep": 2.4}),
        ("anim_jump_apex", "jump", 34, {}),
    ],
    "fx": [
        ("fx_light", "fx", 12, {}),
        ("fx_heavy", "fx", 72, {}),
        ("fx_counter", "fx", 102, {}),
        ("fx_punish", "fx", 132, {}),
        ("fx_block", "fx", 162, {}),
        ("fx_parry", "fx", 192, {}),
        ("fx_impact_armor", "fx", 229, {}),
        ("fx_throw", "fx", 252, {}),
        ("fx_wallsplat", "wallsplat", 40, {}),
        ("fx_wallsplat_after", "wallsplat", 110, {}),
        ("fx_heavy_sparks", "fx", 72, {"gore": "sparks"}),
        ("fx_heavy_confetti", "fx", 74, {"gore": "confetti"}),
    ],
    "super": [
        ("super_freeze", "super", 40, {}),
        ("super_cine_a", "super", 90, {}),
        ("super_cine_b", "super", 140, {}),
        ("super_cine_c", "super", 185, {}),
        ("super_cine_hit", "super", 207, {}),
    ],
    "showcase": [
        ("showcase_johnny_alt", "showcase:johnny:1:idle", 60, {}),
        ("showcase_bruno_win", "showcase:bruno:0:win", 60, {}),
    ],
    "ko": [
        ("ko_hitstop", "ko", 40, {}),
        ("ko_slowmo_orbit", "ko", 95, {}),
        ("ko_finish_hold", "ko", 190, {}),
        ("parry_zoom_freeze", "parry", 55, {}),
        ("parry_punish", "parry", 106, {}),
    ],
}


def log(*a):
    print(*a, flush=True)


def server_up(base):
    try:
        with urllib.request.urlopen(base.rstrip("/") + "/lab/view.html", timeout=3) as r:
            return r.status == 200
    except Exception:
        return False


def ensure_server(base, serve):
    if server_up(base):
        return None
    if not serve:
        raise RuntimeError("no dev server at %s (start: HP_FROZEN=1 npx vite --port %d --strictPort)" % (base, PORT))
    env = dict(os.environ, HP_FROZEN="1", PYTHONIOENCODING="utf-8")
    npx = "npx.cmd" if os.name == "nt" else "npx"
    port = int(base.rstrip("/").rsplit(":", 1)[-1]) if base.count(":") >= 2 else PORT
    p = subprocess.Popen([npx, "vite", "--port", str(port), "--strictPort"], cwd=ROOT, env=env,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                         creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))
    t0 = time.time()
    while time.time() - t0 < 60:
        if server_up(base):
            log("dev server : started vite on %s (HP_FROZEN=1) in %.1f s" % (base, time.time() - t0))
            return p
        time.sleep(0.5)
    p.kill()
    raise RuntimeError("vite did not come up on %s" % base)


def stop_server(p):
    if not p:
        return
    try:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], capture_output=True)
        else:
            p.kill()
    except Exception:
        pass


class Page:
    def __init__(self, args):
        self.args = args
        self.console = []
        self.errors = []
        self.failed = []

    def start(self):
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        # CHANGED(fix_view): --chrome-arg extra flags (e.g. --force_high_performance_gpu when other sessions saturate the iGPU)
        self.browser = self._pw.chromium.launch(channel="chrome", headless=self.args.headless, args=FLAGS + list(getattr(self.args, "chrome_arg", None) or []))
        self.ctx = self.browser.new_context(viewport={"width": self.args.width, "height": self.args.height}, device_scale_factor=1)
        self.page = self.ctx.new_page()
        self.page.set_default_timeout(240_000)
        self.page.on("console", lambda m: self.console.append((m.type, m.text)))
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.on("requestfailed", lambda r: self.failed.append("%s %s" % (r.url, r.failure)))
        self.page.on("response", lambda r: self.failed.append("%s HTTP %d" % (r.url, r.status)) if r.status >= 400 else None)

    def close(self):
        for f in (lambda: self.ctx.close(), lambda: self.browser.close(), lambda: self._pw.stop()):
            try:
                f()
            except Exception:
                pass

    def js(self, expr, arg=None):
        return self.page.evaluate(expr, arg) if arg is not None else self.page.evaluate(expr)

    def frames(self, n=2):
        self.page.evaluate("(n) => new Promise((r) => { let k = 0; const f = () => (++k >= n ? r(k) : requestAnimationFrame(f)); requestAnimationFrame(f); })", n)


def wait_ready(p, budget):
    t0 = time.time()
    while time.time() - t0 < budget:
        st = p.js("() => window.__LAB__ ? { ready: window.__LAB__.ready, error: window.__LAB__.error } : null")
        if st and st.get("error"):
            raise RuntimeError("lab error: %s" % st["error"][:800])
        if st and st.get("ready"):
            return time.time() - t0
        time.sleep(0.25)
    raise RuntimeError("lab never reported ready in %.0f s" % budget)


def problems_of(p):
    probs = []
    errs = [t for k, t in p.console if k == "error"]
    if errs:
        probs.append("%d console errors: %s" % (len(errs), " | ".join(e[:200] for e in errs[:4])))
    if p.errors:
        probs.append("%d page errors: %s" % (len(p.errors), " | ".join(e[:200] for e in p.errors[:4])))
    if p.failed:
        probs.append("%d failed requests: %s" % (len(p.failed), " | ".join(f[:200] for f in p.failed[:4])))
    return probs


def main():
    ap = argparse.ArgumentParser(description="HIT PARADE look shots (G5 inputs) through the VIEW lab")
    ap.add_argument("--base", default="http://localhost:%d/" % PORT)
    ap.add_argument("--headless", action="store_true")
    ap.add_argument("--width", type=int, default=1600)
    ap.add_argument("--height", type=int, default=900)
    ap.add_argument("--no-serve", action="store_true")
    ap.add_argument("--prefix", default="view")
    ap.add_argument("--only", default="", help="comma list of groups: " + ",".join(GROUPS))
    ap.add_argument("--query", default="", help="extra lab query string, e.g. 'stage=rooftop&real=1'")
    ap.add_argument("--wait", type=float, default=120.0)
    ap.add_argument("--sim", action="store_true", help="P2: the real sim + real data drive the view (groups: %s)" % ",".join(SIM_GROUPS))
    ap.add_argument("--fighters", default="", help="--sim: comma list of fighter ids (default all 12)")
    ap.add_argument("--stages", default="rust_theater,butcher_block,wheel_of_pain,rooftop,control_room", help="--sim stage group ids")
    ap.add_argument("--game", action="store_true", help="P2: the REAL game page (deep link + __HP__ dev surface), groups: %s" % ",".join(GAME_GROUPS))
    ap.add_argument("--g3d", default="", help="CHANGED(VIEW3D) --game --only g3d: comma list of parts (default all): " + ",".join(G3D_PARTS))
    ap.add_argument("--circle", type=int, default=0, help="CHANGED(VIEW3D) --sim prime / proj: frames of STEP_IN after FIGHT before the action "
                    "(the fight line turns off the spawn axis: 60 f ~ 45 deg) - PRIME TIME / projectiles on a diagonal line")
    ap.add_argument("--fixview", default="", help="CHANGED(fix_view) --game --only fixview: comma list of parts (default all): " + ",".join(FIXVIEW_PARTS))
    ap.add_argument("--chrome-arg", action="append", default=[], help="CHANGED(fix_view) extra Chrome flag (repeatable), e.g. --chrome-arg=--force_high_performance_gpu")
    args = ap.parse_args()
    if args.game:
        if args.prefix == "view":
            args.prefix = "game"
        return game_main(args)
    if args.sim:
        if args.prefix == "view":
            args.prefix = "sim"
        return sim_main(args)
    groups = [g for g in (args.only.split(",") if args.only else GROUPS.keys()) if g]
    os.makedirs(SHOTS, exist_ok=True)
    os.makedirs(REPORTS, exist_ok=True)
    try:
        server = ensure_server(args.base, not args.no_serve)
    except Exception as e:
        log("SETUP FAILED: %s" % e)
        log("RESULT: FAIL")
        return 2
    rep = {"base": args.base, "size": [args.width, args.height], "headless": args.headless, "shots": {}, "notes": []}
    p = Page(args)
    probs = []
    try:
        p.start()
        url = args.base.rstrip("/") + "/lab/view.html?scene=idle&frame=10" + ("&" + args.query if args.query else "")
        p.page.goto(url)
        rep["readyS"] = round(wait_ready(p, args.wait), 2)
        rep["labInfo"] = p.js("() => window.__LAB__.info()")
        for g in groups:
            for name, scene, frame, opts in GROUPS.get(g, []):
                o = dict(opts)
                o.setdefault("gore", "splatter")
                if scene.startswith("showcase:"):
                    _, fid, col, pose = scene.split(":")
                    p.js("([s, f, o]) => window.__LAB__.run(s, f, o)", ["idle", frame, o])
                    p.js("([i, c, ps, t]) => window.__LAB__.showcase(i, c, ps, t)", [fid, int(col), pose, frame / 60.0])
                    info = p.js("() => window.__LAB__.info()")
                else:
                    info = p.js("([s, f, o]) => window.__LAB__.run(s, f, o)", [scene, frame, o])
                p.frames(2)
                path = os.path.join(SHOTS, "%s_%s.png" % (args.prefix, name))
                p.page.screenshot(path=path)
                cam = (info or {}).get("camera") or {}
                fi = (info or {}).get("fighters") or []
                rep["shots"][name] = {"path": path, "scene": scene, "frame": frame, "opts": o, "camera": cam,
                                      "fighters": fi, "fx": (info or {}).get("fx"),
                                      "render": {k: (info.get("render") or {}).get(k) for k in ("calls", "triangles", "programs", "buffer")}}
                log("shot %-22s %-9s f%-4d cam %-9s d=%.2f sep=%.2f fill=%.0f%%  p1 %s t=%.2f  p2 %s t=%.2f shake %+.2f" % (
                    name, scene, frame, cam.get("mode"), cam.get("dist", 0), cam.get("sep", 0), 100 * cam.get("fill", 0),
                    fi[0].get("clip") if fi else "-", fi[0].get("t", 0) if fi else 0,
                    fi[1].get("clip") if len(fi) > 1 else "-", fi[1].get("t", 0) if len(fi) > 1 else 0,
                    fi[1].get("shake", 0) if len(fi) > 1 else 0))
        rep["labInfoEnd"] = p.js("() => window.__LAB__.info()")
    except Exception as e:
        probs.append("harness error: %s" % str(e).splitlines()[0][:600])
    finally:
        probs += problems_of(p)
        rep["console"] = p.console[-60:]
        rep["pageErrors"] = p.errors
        rep["failed"] = p.failed
        p.close()
        stop_server(server)
    rep["problems"] = probs
    out = os.path.join(REPORTS, "lookshots_%s.json" % args.prefix)
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rep, fh, indent=2, default=str)
    li = rep.get("labInfo") or {}
    log("=" * 90)
    log("lab ready    : %s s (BoutView.create %s ms, warm-up %s ms, %s bytes of GLB)" % (
        rep.get("readyS"), li.get("createMs"), li.get("warmMs"), li.get("bytes")))
    r = li.get("render") or {}
    log("renderer     : %s | buffer %s scale %s" % (r.get("gpu"), r.get("buffer"), r.get("scale")))
    log("stage        : %s" % ("stand-in set (no stage GLB yet)" if li.get("stageFallback") else "stage GLB"))
    log("events table : %s" % li.get("evSource"))
    log("shots        : %d saved in %s" % (len(rep["shots"]), SHOTS))
    log("report       : %s" % out)
    for pr in probs:
        log("   X %s" % pr)
    log("RESULT: %s" % ("OK" if not probs else "FAIL"))
    return 0 if not probs else 1


# ─────────────────────────────── P2: SIM mode (the real sim + real data drive the view) ───────────────────────────────

FIGHTERS = ["johnny", "patch", "bruno", "zambini", "krane", "lotus", "boneyard", "spin", "gazza", "rerun", "freak", "ricky"]
PROJ = [  # (label, fighter, SIMPLE key, phase2)
    ("brick", "johnny", "5S", False), ("card_fan", "zambini", "5S", False), ("flame", "zambini", "4S", False),
    ("saw_card", "zambini", "S+H", False), ("taser", "krane", "5S", False), ("flame_breath", "lotus", "5S", False),
    ("football", "gazza", "5S", False), ("fireball_football", "gazza", "S+H", False), ("spotlight", "ricky", "5S", False),
    ("pyro_line", "ricky", "6S", True),
]
SIM_GROUPS = ["prime", "proj", "props", "lineup", "showcase", "ko", "brawl", "heckler", "stage"]


def strip(paths, out, cols=4, tile=(480, 270)):
    from PIL import Image
    ims = [Image.open(p).convert("RGB").resize(tile) for p in paths]
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (tile[0] * cols, tile[1] * rows), (0, 0, 0))
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % cols) * tile[0], (i // cols) * tile[1]))
    sheet.save(out)
    return out


def sim_main(args):
    groups = [g for g in (args.only.split(",") if args.only else SIM_GROUPS) if g]
    only_f = [x for x in args.fighters.split(",") if x] if args.fighters else FIGHTERS
    os.makedirs(SHOTS, exist_ok=True)
    os.makedirs(REPORTS, exist_ok=True)
    try:
        server = ensure_server(args.base, not args.no_serve)
    except Exception as e:
        log("SETUP FAILED: %s" % e)
        log("RESULT: FAIL")
        return 2
    rep = {"base": args.base, "size": [args.width, args.height], "headless": args.headless, "mode": "sim", "groups": {}, "notes": []}
    p = Page(args)
    probs = []
    fails = []
    pre = args.prefix

    def shoot(name):
        # the lab re-renders and reads the canvas back in one task (canvas.toDataURL): no compositor frame needed, so a
        # starved shared GPU (other lanes' Chromes + Blender bakes) cannot stall the capture like page.screenshot did
        import base64
        path = os.path.join(SHOTS, "%s_%s.png" % (pre, name))
        url = p.js("() => window.__LAB__.snap()")
        with open(path, "wb") as fh:
            fh.write(base64.b64decode(url.split(",", 1)[1]))
        return path

    def setup(p1, p2, **o):
        return p.js("([a, b, o]) => window.__LAB__.setup(a, b, o)", [p1, p2, o])

    def goto(f, **o):
        return p.js("([f, o]) => window.__LAB__.goto(f, o)", [f, o])

    try:
        p.start()
        p.page.goto(args.base.rstrip("/") + "/lab/view.html?sim=1&hud=0" + ("&" + args.query if args.query else ""))
        rep["readyS"] = round(wait_ready(p, args.wait), 2)
        log("lab ready %.1f s" % rep["readyS"])
        if "prime" in groups:
            g = rep["groups"]["prime"] = {}
            todo = [(f, False) for f in only_f] + ([("ricky", True)] if "ricky" in only_f else [])
            for fid, ph2 in todo:
                vic = "johnny" if fid == "bruno" else "bruno"
                key = fid + ("_phase2" if ph2 else "")
                setup(fid, vic)
                s = p.js("(o) => window.__LAB__.prime(o)", {"phase2": ph2, "circle": args.circle})
                start = s.get("cineAt", -1) if s.get("cineAt", -1) >= 0 else s.get("lockAt", -1)
                row = {"script": s, "frames": []}
                g[key] = row
                if start is None or start < 0:
                    fails.append("prime %s: no cinematic / grab lock started (%s)" % (key, s.get("note")))
                    log("prime %-16s NO CINEMATIC %s" % (key, json.dumps(s)))
                    continue
                info = goto(start + 1)
                pr = info.get("prime") or {}
                row["line"] = {"lineDegAtCine": s.get("lineDegAtCine"), "cineFrame": info.get("cineFrame"), "camN": info.get("camN")}
                log("prime %-16s fight line %s deg at the cinematic (circle %d f), cine frame %s" % (key, s.get("lineDegAtCine"), args.circle, json.dumps(info.get("cineFrame"))))
                shots = pr.get("shots") or []
                n = pr.get("frames") or 150
                picks = []
                avoid = list(pr.get("hits") or [])
                for a, b, nm in shots:
                    cf = int(a + (b - a) * 0.55)
                    # step off the blow / flash frames: a frame sitting on a spark reads as a white blob in a still
                    while any(abs(cf - h) <= 2 for h in avoid) and cf + 3 < b:
                        cf += 3
                    picks.append((cf, nm))
                if len(picks) > 7:
                    step = len(picks) / 7.0
                    picks = [picks[int(i * step)] for i in range(7)]
                end = s.get("endAt", -1)
                paths = []
                for cf, nm in picks:
                    info = goto(start + cf)
                    pr = info.get("prime") or {}
                    path = shoot("prime_%s_f%03d" % (key, cf))
                    paths.append(path)
                    camr = info.get("camera") or {}
                    row["frames"].append({"cf": cf, "shot": nm, "cam": camr.get("mode"), "camPos": camr.get("pos"), "camLook": camr.get("look"), "camFov": camr.get("fov"),
                                          "occl": {k: camr.get(k) for k in ("raise", "pull", "clearPull", "occluded", "camR")},
                                          "prime": {k: pr.get(k) for k in ("f", "shot", "att", "vic", "gap", "vy", "carry", "freeze", "slate", "letterbox", "dim", "spot", "guard", "camTarget")},
                                          "fighters": [{k: x.get(k) for k in ("x", "y", "z", "yawDeg", "clip", "t", "propsShown", "override")} for x in info.get("fighters", [])], "fx": info.get("fx")})
                    gd = pr.get("guard") or {}
                    log("prime %-16s cf %3d %-14s att %-26s vic %-26s gap %.2f vy %.2f guard d%.2f fov+%.1f cr%.2f" % (key, cf, nm, ",".join(pr.get("att") or [])[:26], ",".join(pr.get("vic") or [])[:26], pr.get("gap") or 0, pr.get("vy") or 0, gd.get("dolly") or 0, gd.get("fov") or 0, gd.get("crouch") or 0))
                if end is not None and end >= 0:
                    # hand-back: per-frame view-root steps of both bodies from 3 frames before CINEMATIC_END to 12 after
                    # (a pop = a jump well over a walk / knockback step; the camera cut back to the fight rig is by design)
                    prev = None
                    steps = []
                    for hf in range(end - 3, end + 13):
                        hi = goto(hf)
                        xy = [(fz.get("x") or 0, fz.get("y") or 0, fz.get("z") or 0) for fz in hi.get("fighters", [])]
                        if prev is not None and len(xy) == 2:
                            steps.append({"f": hf - end, "dx": [round(((xy[i][0] - prev[i][0]) ** 2 + (xy[i][2] - prev[i][2]) ** 2) ** 0.5, 3) for i in range(2)], "dy": [round(abs(xy[i][1] - prev[i][1]), 3) for i in range(2)],
                                          "clip": [fz.get("clip") for fz in hi.get("fighters", [])]})
                        prev = xy
                    mx = max((max(s_["dx"] + s_["dy"]) for s_ in steps), default=0)
                    worst = max(steps, key=lambda s_: max(s_["dx"] + s_["dy"])) if steps else {}
                    row["handback"] = {"maxStep": mx, "worst": worst, "steps": steps}
                    log("prime %-16s hand-back max step %.3f m (at end%+d, %s)" % (key, mx, worst.get("f", 0), json.dumps(worst.get("clip"))))
                    info = goto(end + 12)
                    paths.append(shoot("prime_%s_after" % key))
                    row["after"] = {"cam": info["camera"]["mode"], "f": info.get("f")}
                row["v2"] = pr.get("v2")
                row["strip"] = strip(paths, os.path.join(SHOTS, "%s_prime_%s_strip.png" % (pre, key)))
                row["missingClips"] = info.get("missingClips")
                log("prime %-16s strip %s (v2=%s, %d shots, frames %s, missing clips %s)" % (key, row["strip"], pr.get("v2"), len(shots), n, json.dumps(info.get("missingClips"))))
        if "proj" in groups:
            g = rep["groups"]["proj"] = {}
            for label, fid, key, ph2 in PROJ:
                if fid not in only_f:
                    continue
                setup(fid, "bruno")
                s = p.js("([k, o]) => window.__LAB__.special(k, o)", [key, {"phase2": ph2, "after": 150, "circle": args.circle}])
                sp = s.get("spawnAt", -1)
                row = {"script": s, "frames": []}
                g[label] = row
                if sp is None or sp < 0:
                    fails.append("proj %s: no projectile spawned (%s %s)" % (label, fid, key))
                    log("proj %-18s NO SPAWN %s" % (label, json.dumps(s)))
                    continue
                paths = []
                gone = -1
                for k in range(1, 150):
                    info = goto(sp + k)
                    if not info.get("simProj") and k > 2:
                        gone = sp + k
                        break
                for f in [sp + 3, sp + 12, (gone + 2) if gone > 0 else sp + 40]:
                    info = goto(f)
                    paths.append(shoot("proj_%s_%d" % (label, f - sp)))
                    row["frames"].append({"rel": f - sp, "sim": info.get("simProj"), "view": info.get("proj")})
                vi = p.js("() => window.__LAB__.info().proj")
                row["view"] = vi
                row["strip"] = strip(paths, os.path.join(SHOTS, "%s_proj_%s_strip.png" % (pre, label)), cols=3)
                log("proj %-18s spawn %d gone %d types %s assets %s" % (label, sp, gone, (vi or {}).get("types"), (vi or {}).get("assets")))
        if "props" in groups:
            g = rep["groups"]["props"] = {}
            paths = []
            for fid in ["krane", "boneyard", "ricky", "lotus"]:
                if fid not in only_f:
                    continue
                setup(fid, "bruno")
                p.js("(n) => window.__LAB__.idle(n)", 40)
                goto(120)
                c = p.js("(i) => window.__LAB__.closeup(i, {dist: 2.2})", 0)
                paths.append(shoot("props_%s" % fid))
                g[fid] = c
                log("props %-9s %s" % (fid, json.dumps(c.get("props"))))
            for fid, key, back in [("johnny", "5S", 4), ("zambini", "5S", 3), ("krane", "5S", 2)]:
                if fid not in only_f:
                    continue
                setup(fid, "bruno")
                s = p.js("([k, o]) => window.__LAB__.special(k, o)", [key, {"after": 40}])
                sp = s.get("spawnAt", -1)
                if sp is None or sp < 0:
                    fails.append("props %s %s: no spawn" % (fid, key)); continue
                goto(sp - back)
                c = p.js("(i) => window.__LAB__.closeup(i, {dist: 2.2})", 0)
                paths.append(shoot("props_%s_%s" % (fid, key)))
                g["%s_%s" % (fid, key)] = c
                log("props %-9s %s at spawn-%d: %s" % (fid, key, back, json.dumps(c.get("props"))))
            if paths:
                rep["groups"]["props_strip"] = strip(paths, os.path.join(SHOTS, "%s_props_strip.png" % pre), cols=4)
        if "lineup" in groups:
            setup("johnny", "bruno")
            p.js("(n) => window.__LAB__.idle(n)", 30)
            goto(100)
            r = p.js("(ids) => window.__LAB__.lineup(ids)", FIGHTERS)
            rep["groups"]["lineup"] = {"info": r, "path": shoot("lineup12")}
            log("lineup %s" % json.dumps(r))
        if "showcase" in groups:
            g = rep["groups"]["showcase"] = {}
            paths = []
            rect = {"x": 469, "y": 110, "w": 663, "h": 463}
            for fid, col, pose in [("bruno", 0, "idle"), ("johnny", 1, "idle"), ("freak", 0, "idle"), ("lotus", 0, "win"), ("ricky", 0, "idle"), ("spin", 0, "idle")]:
                r = p.js("([i, c, ps, t, rc]) => window.__LAB__.showcase(i, c, ps, t, rc)", [fid, col, pose, 1.2, rect])
                paths.append(shoot("showcase_%s" % fid))
                g[fid] = r
            rep["groups"]["showcase_strip"] = strip(paths, os.path.join(SHOTS, "%s_showcase_strip.png" % pre), cols=3)
            log("showcase strip %s" % rep["groups"]["showcase_strip"])
        if "ko" in groups:
            setup("johnny", "bruno", rounds=1)
            s = p.js("(o) => window.__LAB__.ko(o)", {"circle": args.circle})
            ko = s.get("koAt", -1)
            g = rep["groups"]["ko"] = {"script": s, "frames": []}
            if ko is None or ko < 0:
                fails.append("ko: no KO (%s)" % json.dumps(s))
            else:
                paths = []
                for k in [4, 40, 80, 130, 190, 250]:
                    info = goto(ko + k)
                    paths.append(shoot("ko_%03d" % k))
                    g["frames"].append({"k": k, "cam": info["camera"], "tops": None, "lineDeg": info.get("lineDeg")})
                    log("ko +%3d cam %s d=%.2f line %s deg yaw %s pos %s" % (k, info["camera"]["mode"], info["camera"]["dist"], info.get("lineDeg"), info["camera"].get("yawDeg"), info["camera"].get("pos")))
                g["strip"] = strip(paths, os.path.join(SHOTS, "%s_ko_strip.png" % pre), cols=3)
        for mode in ("brawl", "heckler"):
            if mode not in groups:
                continue
            g = rep["groups"][mode] = {"frames": []}
            try:
                setup("johnny", "bruno", mode=mode)
                s = p.js("([n, o]) => window.__LAB__.idle(n, o)", [700, {"every": 24, "word": 16 if mode == "brawl" else 1024}])
                g["script"] = s
                paths = []
                for f in [180, 300, 420, 560, 680]:
                    info = goto(f)
                    paths.append(shoot("%s_%03d" % (mode, f)))
                    g["frames"].append({"f": f, "brawl": info.get("brawl"), "proj": info.get("proj"), "phase": info.get("phase")})
                    log("%s f%d phase %s brawl %s proj %s" % (mode, f, info.get("phase"), json.dumps(info.get("brawl")), json.dumps(info.get("simProj"))[:200]))
                g["strip"] = strip(paths, os.path.join(SHOTS, "%s_%s_strip.png" % (pre, mode)), cols=3)
            except Exception as e:
                fails.append("%s: %s" % (mode, str(e).splitlines()[0][:300]))
        if "stage" in groups:
            g = rep["groups"]["stage"] = {}
            paths = []
            for sid in args.stages.split(","):
                try:
                    setup("johnny", "bruno", stage=sid)
                    p.js("(n) => window.__LAB__.idle(n)", 260)
                    info = goto(150)
                    paths.append(shoot("stage_%s_fight" % sid))
                    # the set itself: a wide from the audience side, then the same view 20 frames later (dressing moves)
                    v1 = p.js("([a, b, f, n]) => window.__LAB__.view(a, b, f, n)", [[0, 2.6, 9.5], [0, 2.4, -6], 55, 0])
                    paths.append(shoot("stage_%s_wide" % sid))
                    p.js("([a, b, f, n]) => window.__LAB__.view(a, b, f, n)", [[0, 2.6, 9.5], [0, 2.4, -6], 55, 20])
                    paths.append(shoot("stage_%s_wide20" % sid))
                    g[sid] = {"stage": info.get("stage"), "view": v1, "fallback": info.get("stageFallback")}
                    log("stage %-14s fallback %s dressing %s glare %s" % (sid, info.get("stageFallback"), json.dumps((info.get("stage") or {}).get("dressing")), json.dumps((info.get("stage") or {}).get("glareGraded"))))
                except Exception as e:
                    fails.append("stage %s: %s" % (sid, str(e).splitlines()[0][:300]))
            if paths:
                rep["groups"]["stage_strip"] = strip(paths, os.path.join(SHOTS, "%s_stage_strip.png" % pre), cols=3)
        rep["labInfoEnd"] = p.js("() => window.__LAB__.info()")
    except Exception as e:
        probs.append("harness error: %s" % str(e).splitlines()[0][:600])
    finally:
        probs += problems_of(p)
        rep["console"] = p.console[-80:]
        rep["pageErrors"] = p.errors
        rep["failed"] = p.failed
        p.close()
        stop_server(server)
    rep["problems"] = probs
    rep["fails"] = fails
    out = os.path.join(REPORTS, "lookshots_%s.json" % pre)
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rep, fh, indent=2, default=str)
    log("=" * 90)
    log("report       : %s" % out)
    for f in fails:
        log("   F %s" % f)
    for pr in probs:
        log("   X %s" % pr)
    ok = not probs and not fails
    log("RESULT: %s" % ("OK" if ok else "FAIL"))
    return 0 if ok else 1


# ─────────────────────────────── P2: GAME mode (the REAL game page, deep link + __HP__ dev surface) ───────────────────────────────
# Not the lab: runtime/index.html boots main.ts -> Game -> BoutView exactly as a player gets it. The harness freezes the loop
# and steps the sim one tick per rendered frame (__HP__.dev.step(1) + one rAF), so every tick is presented by the real
# game's own frame() (events drained, FX, props, HUD). View read-back: window.__HP_VIEW__ (dev-only handle set by
# BoutView.create). Shots: __HP__.shot(name) (the game's canvas -> /__shot -> _shots/<name>.png).

GAME_GROUPS = ["gprops", "gbrawl", "gheckler", "gstage", "g3d", "fixview"]
G3D_PARTS = ["circle", "dodge", "splat", "prime", "arenas", "brawl"]
# CHANGED(fix_view): the view-fix evidence (CONTRACT §35.23 fix_view) - every part runs the LEGACY presentation and the
# FIXED one in the same page (harness A/B switches on the live BoutView), REAL game, frozen sim, one presented frame per tick
FIXVIEW_PARTS = ["yaw", "step", "swing", "top", "bloom", "popups"]
GAME_PROJ = {  # fighter -> [(label, word, hold frames, phase2)]
    "johnny": [("brick", 128, 2, False)],
    "zambini": [("card_fan", 128, 2, False), ("flame", 4 | 128, 2, False), ("saw_card", 128 | 64, 2, False)],
    "krane": [("taser", 128, 2, False)],
    "lotus": [("flame_breath", 128, 2, False)],
    "gazza": [("football", 128, 2, False), ("fireball_football", 128 | 64, 2, False)],
    "ricky": [("spotlight", 128, 2, False), ("pyro_line", 8 | 128, 2, True)],
}
GAME_EXPECT_PROPS = {  # fighter -> {prop id: expected visible at idle}
    "johnny": {"brick": False}, "zambini": {"card_fan": False}, "krane": {"riot_shield": True, "baton": True, "taser": False},
    "lotus": {"gourd": True}, "boneyard": {"cleaver": True}, "ricky": {"mic_cane": True},
}
GAME_JS = r"""
window.__LK__ = {
  async frames(n) { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r())); },
  /** step n ticks, one rendered frame each; `word` forced on P1 for the first `hold` ticks */
  async step(n, word, hold) {
    for (let i = 0; i < n; i++) {
      if (word && i < (hold ?? 1)) window.__HP__.dev.setInputs(0, word, 1);
      window.__HP__.dev.step(1);
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    return window.__HP__.match()?.simFrame ?? -1;
  },
  /** step n ticks WITHOUT presenting each one (the machine is shared: rendering every intro / idle tick costs minutes);
   *  the next rendered frame drains all their events. `word` forced on P1 for the first `hold` ticks of every `every` */
  bulk(n, word, hold, every) {
    for (let i = 0; i < n; i++) {
      if (word && (i % (every || n)) < (hold ?? 1)) window.__HP__.dev.setInputs(0, word, 1);
      window.__HP__.dev.step(1);
    }
    return window.__HP__.match()?.simFrame ?? -1;
  },
  async untilFight(max) {
    for (let i = 0; i < max; i++) {
      const m = window.__HP__.match();
      if (m && m.phase === 'fight') { await new Promise((r) => requestAnimationFrame(() => r())); return i; }
      window.__HP__.dev.step(1);
    }
    return -1;
  },
  /** one presented tick + the projectile / prop read-back in ONE round trip */
  async tick(word, kind) {
    if (word) window.__HP__.dev.setInputs(0, word, 1);
    window.__HP__.dev.step(1);
    await new Promise((r) => requestAnimationFrame(() => r()));
    const m = window.__HP__.match() || {};
    const v = window.__HP_VIEW__ ? window.__HP_VIEW__.info() : {};
    const f0 = (window.__HP__.fighters() || [{}])[0] || {};
    const props = {};
    for (const q of ((v.fighters || [{}])[0] || {}).props || []) props[q.id] = q.visible;
    // P1's projectiles of the asked kind (0 = a move's projectile, 1 = Gazza's ball, which stays out between kicks)
    const n = (m.proj || []).filter((x) => (x.owner === 0 || x.owner === undefined) && (kind === undefined || (x.kind ?? 0) === kind)).length;
    return { simProj: n, move: f0.moveName, props, proj: v.proj || {} };
  },
  view() { return window.__HP_VIEW__ ? window.__HP_VIEW__.info() : null; },
  popups() { return window.__HP_VIEW__ ? window.__HP_VIEW__.popups() : []; },
  // ── CHANGED(VIEW3D) g3d helpers ──
  /** STEP drive: setInputs when input.ts WORD_MASK carries bits 13/14, else patch Input.sampleAll (dev page only) */
  async ensureStep() {
    const m = await import('/src/input.ts');
    const mask = m.WORD_MASK;
    if (mask & 0x6000) { window.__HP_STEPMODE__ = 'setInputs'; return { mask, mode: 'setInputs' }; }
    if (!m.Input.prototype.__hpStepPatched) {
      const orig = m.Input.prototype.sampleAll;
      window.__HP_STEP__ = [{ bits: 0, n: 0 }, { bits: 0, n: 0 }];
      m.Input.prototype.sampleAll = function (out) {
        const r = orig.call(this, out);
        for (const p of [0, 1]) { const s = window.__HP_STEP__[p]; if (s.n > 0) { r[p] |= s.bits; s.n--; } }
        return r;
      };
      m.Input.prototype.__hpStepPatched = true;
    }
    window.__HP_STEPMODE__ = 'patch';
    return { mask, mode: 'patch' };
  },
  press(p, word, n) {
    if (word) window.__HP__.dev.setInputs(p, word & 0x7fff, n);
    if (window.__HP_STEPMODE__ === 'patch' && (word & 0x6000)) window.__HP_STEP__[p] = { bits: word & 0x6000, n };
  },
  snap() {
    const m = window.__HP__.match() || {};
    const f = window.__HP__.fighters() || [];
    const v = window.__HP_VIEW__ ? window.__HP_VIEW__.info() : {};
    const r3 = (x) => Math.round((x || 0) * 1000) / 1000;
    return {
      simFrame: m.simFrame, phase: m.phase, camN: m.camN, cinematic: m.cinematic, ring: m.ring,
      line: f.length === 2 ? Math.round(Math.atan2(f[1].x - f[0].x, (f[1].z || 0) - (f[0].z || 0)) * 1800 / Math.PI) / 10 : null,
      f: f.map((x) => ({ x: r3(x.x), y: r3(x.y), z: r3(x.z), yawDeg: Math.round((x.yaw || 0) * 1800 / Math.PI) / 10, facing: x.facing, hp: x.hp, st: x.stateName, step: x.step, move: x.moveName })),
      cam: v.camera, view: (v.fighters || []).map((x) => ({ clip: x.clip, mirror: x.mirror, yawDeg: x.yawDeg, x: r3(x.x), z: r3(x.z) })),
      proj: v.proj, splat: v.splat, fx: v.fx, prime: v.prime, cineFrame: v.cineFrame, brawl: v.brawl, ring3: v.ring,
      proj3: (m.proj || []).map((q) => ({ slot: q.slot, owner: q.owner, kind: q.kind, x: r3(q.x), y: r3(q.y), z: r3(q.z), yawDeg: Math.round((q.yaw || 0) * 1800 / Math.PI) / 10 })),
      goons: ((m.brawl || {}).goons || []).map((g) => ({ slot: g.slot, kind: g.kind, x: r3(g.x), z: r3(g.z), yawDeg: Math.round((g.yaw || 0) * 1800 / Math.PI) / 10, st: g.stateName })),
    };
  },
  /** n presented ticks with words for both players (each tick: press, step 1, one rendered frame) */
  async stepP(n, w0, w1) {
    for (let i = 0; i < n; i++) {
      window.__LK__.press(0, w0 || 0, 1); window.__LK__.press(1, w1 || 0, 1);
      window.__HP__.dev.step(1);
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    return window.__HP__.match()?.simFrame ?? -1;
  },
  /** rendered frames with the sim frozen (the camera eases onto the current snapshot) */
  async settle(n) { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r())); },
  evs(n) { return (window.__HP__.events(n || 64) || []); },
  /** a HARNESS-ONLY top-down picture of the ring around the pair (not the game camera): screen-up = away from the game
   *  camera (-camN), so left / right read as in the game shot; the game camera is restored right after */
  async overhead(name, h) {
    const v = window.__HP_VIEW__ && window.__HP_VIEW__.view; if (!v) return null;
    const f = window.__HP__.fighters() || [], m = window.__HP__.match() || {};
    const n = m.camN || [0, 1];
    const mx = (f[0].x + f[1].x) / 2, mz = ((f[0].z || 0) + (f[1].z || 0)) / 2;
    const c = v.cam.camera;
    const keep = { p: c.position.clone(), q: c.quaternion.clone(), fov: c.fov, up: c.up.clone() };
    c.position.set(mx, h || 7.0, mz); c.up.set(-n[0], 0, -n[1]); c.fov = 52; c.updateProjectionMatrix();
    c.lookAt(mx, 0, mz); c.updateMatrixWorld();
    const r = await window.__HP__.shot(name);
    c.position.copy(keep.p); c.quaternion.copy(keep.q); c.up.copy(keep.up); c.fov = keep.fov; c.updateProjectionMatrix(); c.updateMatrixWorld();
    return r;
  },
};
"""


# ── CHANGED(fix_view): the fixview group (D2 yaw, D6 step, D10 swing, D13 top, D5 bloom, D7 popups) ──────────────────
FIXVIEW_JS = r"""
window.__FV__ = {
  /** n presented ticks; words for both players (per-tick arrays or numbers); optional per-tick samples */
  async run(n, w0, w1, sample) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = Array.isArray(w0) ? (w0[i] || 0) : (w0 || 0), b = Array.isArray(w1) ? (w1[i] || 0) : (w1 || 0);
      if (a) window.__HP__.dev.setInputs(0, a, 1);
      if (b) window.__HP__.dev.setInputs(1, b, 1);
      window.__HP__.dev.step(1);
      await new Promise((r) => requestAnimationFrame(() => r()));
      if (sample) out.push(window.__FV__.s());
    }
    return out;
  },
  s() {
    const m = window.__HP__.match() || {}, f = window.__HP__.fighters() || [];
    const v = window.__HP_VIEW__ ? window.__HP_VIEW__.info() : {};
    const vf = v.fighters || [];
    return { fr: m.simFrame, f: f.map((x, i) => ({ x: x.x, z: x.z, yaw: Math.round((x.yaw || 0) * 1800 / Math.PI) / 10, fac: x.facing, st: x.stateName, mv: x.moveName,
      mf: x.moveFrame, step: x.step, vyaw: (vf[i] || {}).yawDeg, mir: (vf[i] || {}).mirror, vt: (vf[i] || {}).t, stride: (vf[i] || {}).stride, feet: (v.feet || [])[i] })) };
  },
  /** the clip's own feet with the stripped lateral travel put back (= the mocap's world feet, root-local axes) */
  mocap(i, clip) {
    const fv = window.__HP_VIEW__.view.fighters[i];
    const lat = fv.stepFacts.lat[clip];
    const inv = fv.root.matrixWorld.clone().invert();
    const dur = fv.pose.dur(clip), rows = [];
    const latAt = (t) => { const T = lat.t, Q = lat.q; if (t <= T[0]) return 0; for (let j = 1; j < T.length; j++) if (t <= T[j]) return (Q[j - 1] + (Q[j] - Q[j - 1]) * (t - T[j - 1]) / (T[j] - T[j - 1])) * lat.len; return lat.len; };
    const sx = clip.endsWith('_l') ? 1 : -1;
    for (let j = 0; j < 57; j++) {
      const t = dur * j / 56;
      fv.pose.poseClip(clip, t); fv.root.updateMatrixWorld(true);
      const row = [t];
      for (const n of ['LeftFoot', 'LeftToeBase', 'RightFoot', 'RightToeBase']) { const b = fv.bone(n); const p = b.position.clone(); b.getWorldPosition(p); p.applyMatrix4(inv); row.push(p.x + sx * latAt(t), p.y, p.z); }
      rows.push(row);
    }
    return rows;
  },
  /** twin FightCameras (legacy / fixed) fed the real snapshots per sim frame at dt 1/60 */
  twin() {
    const v = window.__HP_VIEW__.view, C = v.cam.constructor;
    const mk = (legacy) => { const c = new C(16 / 9); c.ring = v.ring; c.safeTop = v.cam.safeTop; c.legacySwing = legacy; c.softPullOn = !legacy; return c; };
    window.__TW__ = { a: mk(true), b: mk(false), rows: [] };
  },
  feed(n, w) {
    const T = window.__TW__, v = window.__HP_VIEW__.view;
    for (let i = 0; i < n; i++) {
      window.__HP__.dev.setInputs(0, w, 1);
      window.__HP__.dev.step(1);
      const m = window.__HP__.match(), f = window.__HP__.fighters();
      const cf = f.map((x) => ({ x: x.x, y: x.y, z: x.z, head: x.y + 1.85 }));
      const row = {};
      for (const k of ['a', 'b']) { const c = T[k]; c.camN = m.camN ? [m.camN[0], m.camN[1]] : null; c.ring = v.ring; c.update(1 / 60, cf, 16 / 9, m.simFrame); const L = c.last;
        row[k] = [L.yawDeg, L.swingDeg, L.camR, L.softPull || 0, L.raise, L.occluded, L.fov]; }
      T.rows.push(row);
    }
    return T.rows.length;
  },
  /** each body's projected box (CSS px) for the pixel stats */
  boxes() {
    const v = window.__HP_VIEW__.view, cam = v.cam.camera, W = innerWidth, H = innerHeight;
    return v.fighters.map((f) => { const p = f.root.position, top = f.liveTop(); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      for (const [dx, dy, dz] of [[-0.45, 0, -0.45], [0.45, 0, 0.45], [-0.45, top - p.y, 0.45], [0.45, top - p.y, -0.45], [0.45, 0, -0.45], [-0.45, top - p.y, -0.45]]) {
        const q = p.clone().set(p.x + dx, p.y + dy, p.z + dz).project(cam); const sx = (q.x + 1) / 2 * W, sy = (1 - q.y) / 2 * H;
        x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); }
      return { box: [x0, y0, x1, y1], lightK: f.last.lightK }; });
  },
  /** BRAWL: walk at the nearest live goon, attack inside 1.15 m (L / M / H in turn); popups sampled every tick */
  async brawl(n, t0) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      const k = t0 + i, m = window.__HP__.match() || {}, f0 = (window.__HP__.fighters() || [])[0] || {};
      const gs = ((m.brawl || {}).goons || []).filter((q) => !(q.alive === false || q.alive === 0) && !(q.down === true || q.down === 1));
      let best = null, bd = 1e9;
      for (const q of gs) { const d = Math.hypot(q.x - f0.x, (q.z || 0) - (f0.z || 0)); if (d < bd) { bd = d; best = q; } }
      let w = 0;
      if (best) { if (bd > 1.15) w = (f0.facing || 1) > 0 ? 8 : 4; else if (k % 8 < 2) w = [16, 32, 64][Math.floor(k / 8) % 3]; }
      if (w) window.__HP__.dev.setInputs(0, w, 1);
      window.__HP__.dev.step(1);
      await new Promise((r) => requestAnimationFrame(() => r()));
      const pops = window.__HP_VIEW__.popups();
      if (pops.length) rows.push({ k, pops: pops.map((p) => ({ id: p.id, why: p.reason, x: p.x, y: p.y, wx: p.wx, wz: p.wz })) });
    }
    return rows;
  },
};
"""


def _angd(a, b):
    return (a - b + 180.0) % 360.0 - 180.0


def run_fixview(p, args, rep, fails, start, pre):
    """CHANGED(fix_view): legacy vs fixed presentation, same page, REAL game. Writes rep['groups']['fixview']."""
    import math
    g = rep["groups"]["fixview"] = {}
    parts = [x for x in (args.fixview.split(",") if args.fixview else FIXVIEW_PARTS) if x]
    js = p.js
    p.page.evaluate(FIXVIEW_JS)
    W_ = dict(LEFT=4, RIGHT=8, L=16, M=32, H=64, S=128, THROW=512, STEP_IN=8192, STEP_OUT=16384)

    def match(p1, p2, stage="rust_theater", seed=8, mode="versus"):
        start({"mode": mode, "stage": stage, "seed": seed, "p": [{"fighter": p1, "cpu": -1}, {"fighter": p2, "cpu": -1}]})
        js("() => window.__LK__.ensureStep()")

    def run(n, w0=0, w1=0, sample=True):
        return js("([n, a, b, s]) => window.__FV__.run(n, a, b, s)", [n, w0, w1, sample])

    def walk(who, gap):
        for _ in range(240):
            s_ = js("() => window.__FV__.s()")
            f = s_["f"]
            if math.hypot(f[1]["x"] - f[0]["x"], f[1]["z"] - f[0]["z"]) <= gap:
                return
            w = W_["RIGHT"] if f[who]["fac"] > 0 else W_["LEFT"]
            run(1, w if who == 0 else 0, w if who == 1 else 0, False)

    def pshot(name):
        path = os.path.join(SHOTS, "%s_%s.png" % (pre, name))
        p.page.screenshot(path=path, timeout=180000)
        return path

    def setv(expr, on):
        js("(on) => { const v = window.__HP_VIEW__.view; %s }" % expr, on)

    # D2: presented yaw on the verifier's re-face cases, legacy (no smoothing) vs fixed
    if "yaw" in parts:
        row = g["yaw"] = {}
        cases = [("krane5M_stepped", "johnny", "krane", [1]), ("hook_m_stepped", "johnny", "johnny", [1]), ("back_throw", "johnny", "bruno", [0, 1])]
        for tag, p1, p2, whos in cases:
            for mode in ("legacy", "fixed"):
                match(p1, p2)
                setv("for (const f of v.fighters) f.smoothTurns = on;", mode == "fixed")
                if tag == "krane5M_stepped":
                    walk(1, 1.2); run(10, 0, 0, False); rows = run(50, [W_["STEP_IN"]], [W_["M"]])
                elif tag == "hook_m_stepped":
                    walk(0, 1.2); run(10, 0, 0, False)
                    fac2 = js("() => window.__FV__.s()")["f"][1]["fac"]
                    rows = run(70, [W_["STEP_IN"]], [0, 0, (W_["RIGHT"] if fac2 > 0 else W_["LEFT"]) | W_["S"]])
                else:
                    walk(0, 0.75); run(4, 0, 0, False)
                    back = W_["LEFT"] if js("() => window.__FV__.s()")["f"][0]["fac"] > 0 else W_["RIGHT"]
                    rows = run(140, [back | W_["THROW"]] * 2, 0)
                for who in whos:
                    sim = max(abs(_angd(b["f"][who]["yaw"], a["f"][who]["yaw"])) for a, b in zip(rows, rows[1:]))
                    view = max(abs(_angd(b["f"][who]["vyaw"], a["f"][who]["vyaw"])) for a, b in zip(rows, rows[1:]))
                    bi = max(range(1, len(rows)), key=lambda k: abs(_angd(rows[k]["f"][who]["yaw"], rows[k - 1]["f"][who]["yaw"])))
                    steps = [round(abs(_angd(rows[k]["f"][who]["vyaw"], rows[k - 1]["f"][who]["vyaw"])), 1) for k in range(bi, min(len(rows), bi + 9))]
                    conv = next((k - bi for k in range(bi, len(rows)) if abs(_angd(rows[k]["f"][who]["vyaw"], rows[k]["f"][who]["yaw"])) < 0.5), None)
                    row["%s_%s_P%d" % (tag, mode, who + 1)] = {"simMaxOneFrame": round(sim, 1), "viewMaxOneFrame": round(view, 1), "viewStepsFromPop": steps,
                                                                 "framesToSimYaw": conv, "trace": [(r["fr"], r["f"][who]["st"], r["f"][who]["mv"], r["f"][who]["yaw"], r["f"][who]["vyaw"], r["f"][who]["mir"]) for r in rows[max(0, bi - 2):bi + 10]]}
                    log("fixview yaw %-16s %-6s P%d: sim one-frame max %.1f | view one-frame max %.1f | view steps from the pop %s | at the sim yaw after %s frames" % (
                        tag, mode, who + 1, sim, view, steps, conv))
                    if mode == "fixed" and (view > 45.5 or conv is None or conv > 8):
                        fails.append("fixview yaw %s P%d: view one-frame %.1f deg, converged after %s frames" % (tag, who + 1, view, conv))

    # D6: planted-foot slide during a sidestep (frames where the clip's OWN foot is planted), legacy vs fixed
    if "step" in parts:
        row = g["step"] = {}
        for fid in ["johnny", "bruno", "freak", "krane", "boneyard", "rerun"]:
            match(fid, "johnny", seed=3)
            run(2, 0, 0, False)
            mo = js("([i, c]) => window.__FV__.mocap(i, c)", [0, "sidestep_l"])
            sp = []
            for j in range(len(mo)):
                a, b = mo[max(0, j - 1)], mo[min(len(mo) - 1, j + 1)]
                sp.append([math.hypot(b[1 + 3 * q] - a[1 + 3 * q], b[3 + 3 * q] - a[3 + 3 * q]) / max(1e-6, b[0] - a[0]) / 60 for q in range(4)])

            def planted(t, q):
                j = min(range(len(mo)), key=lambda k: abs(mo[k][0] - t))
                return sp[j][q] < 0.004
            for mode in ("legacy", "fixed"):
                match(fid, "johnny", seed=3)
                run(6, 0, 0, False)
                setv("for (const f of v.fighters) f.stepSync = on;", mode == "fixed")
                rows = [x for x in run(18, [W_["STEP_IN"]], 0) if (x["f"][0]["step"] or {}).get("kind") == "sidestep"]
                slide = {}
                for q, name in enumerate(["L_ankle", "L_toe", "R_ankle", "R_toe"]):
                    tot = 0.0
                    for a, b in zip(rows, rows[1:]):
                        ta = a["f"][0]["vt"] if mode == "fixed" else (a["f"][0]["step"]["frame"] - 1) / 60
                        tb = b["f"][0]["vt"] if mode == "fixed" else (b["f"][0]["step"]["frame"] - 1) / 60
                        if planted(ta, q) and planted(tb, q):
                            fa, fb = a["f"][0]["feet"], b["f"][0]["feet"]
                            tot += math.hypot(fb[3 * q] - fa[3 * q], fb[3 * q + 2] - fa[3 * q + 2])
                    slide[name] = round(tot, 3)
                worst = max(slide.values())
                row["%s_%s" % (fid, mode)] = {"slide": slide, "worst": worst, "stride": rows[3]["f"][0]["stride"] if len(rows) > 3 else None}
                log("fixview step %-9s %-6s worst planted-foot slide %.3f m %s stride %s" % (fid, mode, worst, json.dumps(slide), row["%s_%s" % (fid, mode)]["stride"]))
                if mode == "fixed" and fid != "rerun" and worst > 0.10:
                    fails.append("fixview step %s: planted-foot slide %.3f m" % (fid, worst))

    # D10: wall swing near the centre - twin cameras (legacy / fixed) fed the real snapshots at 60 Hz, P1 circling P2
    if "swing" in parts:
        row = g["swing"] = {}
        for sid in ["rust_theater", "butcher_block", "wheel_of_pain", "rooftop", "control_room"]:
            match("johnny", "bruno", stage=sid, seed=3)
            run(4, 0, 0, False)
            js("() => window.__FV__.twin()")
            n = 0
            while n < 480:
                n = js("([n, w]) => window.__FV__.feed(n, w)", [40, W_["STEP_IN"]])
            rows = js("() => window.__TW__.rows")
            ring_r = js("() => window.__HP_VIEW__.view.ring.r")
            res = {}
            for k, mode in (("a", "legacy"), ("b", "fixed")):
                az = [r[k][0] for r in rows]
                vel = [_angd(az[i], az[i - 1]) for i in range(1, len(az))]
                acc = [abs(vel[i] - vel[i - 1]) for i in range(1, len(vel))]
                sw = [r[k][1] for r in rows]
                res[mode] = {"swing": [round(min(sw), 2), round(max(sw), 2)], "maxAzAccel": round(max(acc), 3), "beyondWall": round(max(r[k][2] for r in rows) - ring_r, 3),
                             "softPullMax": round(max(r[k][3] for r in rows), 3), "raiseMax": round(max(r[k][4] for r in rows), 3), "occluded": sum(r[k][5] for r in rows),
                             "fovMax": round(max(r[k][6] for r in rows), 2)}
                log("fixview swing %-13s %-6s swing %s deg | max azimuth accel %.3f deg/f^2 | camR - ring %.2f m | soft pull %.2f | raise %.2f | occluded %d | fov max %.1f" % (
                    sid, mode, res[mode]["swing"], res[mode]["maxAzAccel"], res[mode]["beyondWall"], res[mode]["softPullMax"], res[mode]["raiseMax"], res[mode]["occluded"], res[mode]["fovMax"]))
            row[sid] = res
            if res["fixed"]["maxAzAccel"] > 0.5 or res["fixed"]["occluded"]:
                fails.append("fixview swing %s: azimuth accel %.3f, occluded %d" % (sid, res["fixed"]["maxAzAccel"], res["fixed"]["occluded"]))

    # D13: THE FREAK's raised claw / feet vs the HUD-safe frame during a sidestep at 2.4 m (page shots include the HUD)
    if "top" in parts:
        row = g["top"] = {}
        FR = "() => { const v = window.__HP_VIEW__.info(); return { fr: v.framing, dist: v.camera.dist }; }"
        for p1, p2 in [("freak", "bruno"), ("johnny", "bruno")]:
            for mode in ("legacy", "fixed"):
                match(p1, p2, seed=3)
                run(4, 0, 0, False)
                setv("v.realTops = on; v.cam.bottomMargin = on ? 0.07 : 0.04; if (!on) v.cam.feetDepth = 0;", mode == "fixed")
                js("(n) => window.__LK__.settle(n)", 40)
                rows, paths = [], []
                for k in range(16):
                    if k:
                        run(1, W_["STEP_IN"] if k == 1 else 0, 0, False)
                    js("(n) => window.__LK__.settle(n)", 12)
                    rows.append(js(FR))
                    if k in (0, 6, 12):
                        paths.append(pshot("fixview_top_%s_%s_k%02d" % (p1, mode, k)))
                safe = rows[0]["fr"]["safeTop"]
                top = min(min(r["fr"]["live"]) for r in rows)
                feet = max(max(r["fr"]["liveFeet"]) for r in rows)
                row["%s_%s" % (p1, mode)] = {"hudBand": safe, "highestTop": top, "behindHud": round(max(0, safe - top), 3), "lowestFoot": feet,
                                             "topM": rows[0]["fr"]["topM"], "dist": [min(r["dist"] for r in rows), max(r["dist"] for r in rows)],
                                             "strip": strip(paths, os.path.join(SHOTS, "%s_fixview_top_%s_%s_strip.png" % (pre, p1, mode)), cols=3, tile=(640, 360))}
                log("fixview top %-7s vs %-6s %-6s HUD band %.3f | highest posed top %.3f (behind the HUD by %.3f) | lowest foot %.3f | topM %s | dist %.2f..%.2f" % (
                    p1, p2, mode, safe, top, max(0, safe - top), feet, json.dumps([round(x, 2) for x in rows[0]["fr"]["topM"]]), min(r["dist"] for r in rows), max(r["dist"] for r in rows)))
                if mode == "fixed" and (top < safe or feet > 0.985):
                    fails.append("fixview top %s: top %.3f under band %.3f / feet %.3f" % (p1, top, safe, feet))

    # D5: blown-out body pixels, 5 arenas x 8 orbit angles at the default quality (high + bloom), legacy vs fixed
    if "bloom" in parts:
        from PIL import Image
        row = g["bloom"] = {}

        def stats(path, box):
            im = Image.open(path).convert("RGB")
            x0, y0, x1, y1 = [int(round(v)) for v in box]
            cx0, cx1, cy0, cy1 = max(0, x0 + (x1 - x0) // 5), min(im.size[0], x1 - (x1 - x0) // 5), max(0, y0 + (y1 - y0) // 8), min(im.size[1], y1 - (y1 - y0) // 10)
            if cx1 <= cx0 or cy1 <= cy0:
                return None
            px = list(im.crop((cx0, cy0, cx1, cy1)).getdata())
            return {"blown": round(sum(1 for c in px if max(c) >= 250) / len(px), 4), "sat": round(sum((max(c) - min(c)) / max(1, max(c)) for c in px) / len(px), 3)}
        for sid in ["rust_theater", "butcher_block", "wheel_of_pain", "rooftop", "control_room"]:
            row[sid] = {}
            for mode in ("legacy", "fixed"):
                match("johnny", "bruno", stage=sid, seed=3)
                run(4, 0, 0, False)
                js("(on) => window.__HP_VIEW__.view.legacyLook(on)", mode == "legacy")
                paths, st, lk = [], [], []
                for a_ in range(8):
                    if a_:
                        run(60, W_["STEP_IN"], 0, False)
                    js("(n) => window.__LK__.settle(n)", 30)
                    bx = js("() => window.__FV__.boxes()")
                    path = pshot("fixview_bloom_%s_%s_a%d" % (sid, mode, a_))
                    paths.append(path)
                    st += [s_ for s_ in (stats(path, b["box"]) for b in bx) if s_]
                    lk.append([b["lightK"] for b in bx])
                q = js("() => [window.__HP_VIEW__.view.r.quality, window.__HP_VIEW__.view.post.bloom.enabled]")
                res = {"quality": q[0], "bloom": q[1], "maxBlown": max(s_["blown"] for s_ in st), "meanBlown": round(sum(s_["blown"] for s_ in st) / len(st), 4),
                       "meanSat": round(sum(s_["sat"] for s_ in st) / len(st), 3), "lightK": lk,
                       "strip": strip(paths, os.path.join(SHOTS, "%s_fixview_bloom_%s_%s_strip.png" % (pre, sid, mode)), cols=4, tile=(640, 360))}
                row[sid][mode] = res
                log("fixview bloom %-13s %-6s quality %s bloom %s | blown body pixels max %.2f %% mean %.2f %% | saturation %.3f | lightK min %.2f" % (
                    sid, mode, q[0], q[1], 100 * res["maxBlown"], 100 * res["meanBlown"], res["meanSat"], min(min(x) for x in lk)))
            if row[sid]["fixed"]["maxBlown"] > 0.08:
                fails.append("fixview bloom %s: %.1f %% blown body pixels" % (sid, 100 * row[sid]["fixed"]["maxBlown"]))

    # D7: BRAWL BREAK popups - anchors, overlaps, HUD-safe area (same seeded policy for both)
    if "popups" in parts:
        row = g["popups"] = {}
        for mode in ("legacy", "fixed"):
            match("johnny", "bruno", mode="brawl", seed=5)
            js("(on) => { window.__HP_VIEW__.view.brawl.legacyPopups = on; }", mode == "legacy")
            safe = js("() => window.__HP_VIEW__.view.cam.safeTop")
            rows, paths = [], []
            k = 0
            while k < 900:
                rows += js("([n, t]) => window.__FV__.brawl(n, t)", [60, k])
                k += 60
                if rows and rows[-1]["k"] == k - 1 and len(rows[-1]["pops"]) >= 2 and len(paths) < 6:
                    paths.append(pshot("fixview_popups_%s_k%04d" % (mode, k)))
            inband = sum(1 for r in rows for q in r["pops"] if q["y"] - 0.045 < safe)
            pairs = overl = 0
            for r in rows:
                ps = r["pops"]
                for i in range(len(ps)):
                    for j in range(i + 1, len(ps)):
                        pairs += 1
                        if abs(ps[i]["x"] - ps[j]["x"]) < 0.06 and abs(ps[i]["y"] - ps[j]["y"]) < 0.08:
                            overl += 1
            n_pop = len({q["id"] for r in rows for q in r["pops"]})
            score = (js("() => window.__HP__.match().brawl") or {}).get("score")
            row[mode] = {"popups": n_pop, "samplesInHudBand": inband, "overlappingPairSamples": overl, "pairSamples": pairs, "hudBand": safe, "score": score,
                         "strip": strip(paths, os.path.join(SHOTS, "%s_fixview_popups_%s_strip.png" % (pre, mode)), cols=3, tile=(640, 360)) if paths else None}
            log("fixview popups %-6s %d popups (score %s) | samples in the HUD band %d | overlapping pair-samples %d / %d" % (mode, n_pop, score, inband, overl, pairs))
        if row["fixed"]["samplesInHudBand"] or row["fixed"]["overlappingPairSamples"]:
            fails.append("fixview popups: %d samples in the HUD band, %d overlapping" % (row["fixed"]["samplesInHudBand"], row["fixed"]["overlappingPairSamples"]))


def game_main(args):
    # CHANGED(fix_view): `fixview` (~30 min of A/B runs) only when asked for with --only
    groups = [g for g in (args.only.split(",") if args.only else [x for x in GAME_GROUPS if x != "fixview"]) if g]
    only_f = [x for x in args.fighters.split(",") if x] if args.fighters else FIGHTERS
    os.makedirs(SHOTS, exist_ok=True)
    os.makedirs(REPORTS, exist_ok=True)
    try:
        server = ensure_server(args.base, not args.no_serve)
    except Exception as e:
        log("SETUP FAILED: %s" % e)
        log("RESULT: FAIL")
        return 2
    rep = {"base": args.base, "size": [args.width, args.height], "mode": "game", "groups": {}}
    p = Page(args)
    probs, fails = [], []
    pre = args.prefix

    def js(expr, arg=None):
        return p.js(expr, arg)

    def shot(name):
        r = js("(n) => window.__HP__.shot(n)", "%s_%s" % (pre, name))
        if not r or not r.get("ok"):
            raise RuntimeError("shot %s failed: %s" % (name, r))
        return r.get("path")

    def start(cfg):
        js("(c) => window.__HP__.dev.startMatch(c)", cfg)
        t0 = time.time()
        while time.time() - t0 < args.wait:
            st = js("() => window.__HP__.state()")
            if st.get("bout") and st.get("matchPhase"):
                break
            time.sleep(0.25)
        js("() => window.__HP__.dev.freeze(true)")
        k = js("(n) => window.__LK__.untilFight(n)", 900)
        if k < 0:
            raise RuntimeError("no FIGHT phase for %s" % json.dumps(cfg))
        return k

    def step(n, word=0, hold=1):
        return js("([n, w, h]) => window.__LK__.step(n, w, h)", [n, word, hold])

    def view():
        return js("() => window.__LK__.view()") or {}

    def props0(v):
        f = (v.get("fighters") or [{}])[0]
        return {q["id"]: q["visible"] for q in (f.get("props") or [])}

    def boot():
        """load the deep link, wait for the bout, inject the stepping helpers (again after a WebGL context-loss reload)"""
        url = args.base.rstrip("/") + "/?mode=versus&p1=johnny&p2=bruno&stage=rust_theater&seed=1&autostart=1&dev=1"
        p.page.goto(url)
        t0 = time.time()
        while time.time() - t0 < args.wait:
            try:
                st = p.js("() => window.__HP__ ? window.__HP__.state() : null")
            except Exception:
                st = None                      # the page is still navigating (a context-loss reload)
            if st and st.get("error"):
                raise RuntimeError("game error: %s" % str(st["error"])[:600])
            if st and st.get("bout") and st.get("matchPhase"):
                break
            time.sleep(0.5)
        rep["readyS"] = round(time.time() - t0, 1)
        log("game ready %.1f s (deep link, bout loaded)" % rep["readyS"])
        p.page.evaluate(GAME_JS)

    def lost(e):
        m = str(e)
        return "Execution context was destroyed" in m or "context lost" in m.lower() or "Target page, context or browser has been closed" in m

    try:
        p.start()
        boot()
        if "gprops" in groups:
            g = rep["groups"]["gprops"] = {}
            for fid in only_f:
                for attempt in (0, 1):
                    try:
                        row = g[fid] = {"proj": {}}
                        start({"mode": "versus", "stage": "rust_theater", "seed": 1, "p": [{"fighter": fid, "cpu": -1}, {"fighter": "bruno", "cpu": -1}]})
                        js("() => window.__HP__.dev.setMeter(0, 'showtime', 30000)")
                        js("(n) => window.__LK__.bulk(n, 0, 0, 0)", 14)
                        step(6)
                        v = view()
                        pv = props0(v)
                        row["idleProps"] = pv
                        row["idleShot"] = shot("gprops_%s_idle" % fid)
                        exp = GAME_EXPECT_PROPS.get(fid, {})
                        bad = {k: pv.get(k) for k, want in exp.items() if pv.get(k) is not want}
                        if bad:
                            fails.append("gprops %s idle props %s (expected %s)" % (fid, json.dumps(pv), json.dumps(exp)))
                        if fid not in GAME_EXPECT_PROPS and pv:
                            fails.append("gprops %s holds props %s (none expected)" % (fid, json.dumps(pv)))
                        log("gprops %-9s idle props %s" % (fid, json.dumps(pv)))
                        for label, word, hold, ph2 in GAME_PROJ.get(fid, []):
                            if ph2:
                                hpmax = (js("() => window.__HP__.fighters()[0]") or {}).get("hpMax", 10000)
                                js("(v) => window.__HP__.dev.setHp(0, v)", int(hpmax * 0.4))
                                step(4)
                                for _ in range(200):     # the phase-2 lock (world freeze) runs out
                                    m = js("() => window.__HP__.match()")
                                    if not m.get("freeze"):
                                        break
                                    step(1)
                            js("() => window.__HP__.dev.setMeter(0, 'showtime', 30000)")
                            js("(n) => window.__LK__.bulk(n, 0, 0, 0)", 36)
                            step(4)
                            v0 = view()
                            base = dict((v0.get("proj") or {}))
                            press = js("() => window.__HP__.match().simFrame")
                            trace = []
                            spawn = gone = -1
                            fly = hit = None
                            for k in range(160):
                                t_ = js("([w, kd]) => window.__LK__.tick(w, kd)", [word if k < hold else 0, 1 if label == "football" else 0])
                                pj = t_.get("proj") or {}
                                n = t_.get("simProj", 0)
                                trace.append({"k": k, "move": t_.get("move"), "props": t_.get("props") or {}, "simProj": n, "live": pj.get("live")})
                                if spawn < 0 and n > 0:
                                    spawn = k
                                if spawn >= 0 and k == spawn + 4 and fly is None:
                                    fly = shot("gproj_%s_%s_fly" % (fid, label))
                                imp = (pj.get("impacts", 0) - base.get("impacts", 0)) + (pj.get("destroyed", 0) - base.get("destroyed", 0))
                                if spawn >= 0 and k > spawn + 1 and (imp > 0 or n == 0) and gone < 0:
                                    gone = k
                                    step(2)
                                    hit = shot("gproj_%s_%s_hit" % (fid, label))
                                    break
                            pj = (view().get("proj") or {})
                            res = {"press": press, "spawnK": spawn, "goneK": gone, "types": pj.get("types"), "assets": pj.get("assets"),
                                   "spawned": pj.get("spawned", 0) - base.get("spawned", 0), "impacts": pj.get("impacts", 0) - base.get("impacts", 0),
                                   "destroyed": pj.get("destroyed", 0) - base.get("destroyed", 0), "fly": fly, "hit": hit,
                                   "trace": trace}
                            # the hand prop of a thrown projectile: visible between the press and the release, hidden after
                            hand = {"johnny": "brick", "zambini": "card_fan"}.get(fid) if label in ("brick", "card_fan") else None
                            if fid == "krane":
                                hand = "taser"
                            if hand and spawn >= 0:
                                before = [t["props"].get(hand) for t in trace[:spawn] if t["move"]]
                                after = [t["props"].get(hand) for t in trace[spawn + 2:]]
                                res["hand"] = {"prop": hand, "shownBeforeRelease": any(before), "shownAfterRelease": any(x for x in after if fid != "krane")}
                                if not any(before):
                                    fails.append("gproj %s %s: %s never shown during the throw" % (fid, label, hand))
                                if fid != "krane" and any(after):
                                    fails.append("gproj %s %s: %s still in hand after the release" % (fid, label, hand))
                            if spawn < 0:
                                fails.append("gproj %s %s: no projectile spawned" % (fid, label))
                            elif res["impacts"] + res["destroyed"] <= 0 and gone < 0:
                                fails.append("gproj %s %s: no impact / end seen" % (fid, label))
                            row["proj"][label] = res
                            log("gproj  %-9s %-18s spawn k%-3d end k%-3d spawned %d impacts %d destroyed %d types %s assets %s hand %s" % (
                                fid, label, spawn, gone, res["spawned"], res["impacts"], res["destroyed"], res["types"], res["assets"], json.dumps(res.get("hand"))))
                        break
                    except Exception as e:
                        if attempt or not lost(e):
                            raise
                        log("gprops %s: WebGL context lost (shared GPU) - page reloaded, fighter retried" % fid)
                        rep.setdefault("contextLost", []).append(fid)
                        time.sleep(3)
                        boot()
        for mode in ("gbrawl", "gheckler"):
            if mode not in groups:
                continue
            md = mode[1:]
            g = rep["groups"][mode] = {"frames": []}
            for attempt in (0, 1):
                try:
                    g["frames"] = []
                    start({"mode": md, "stage": "rust_theater", "seed": 1, "p": [{"fighter": "johnny", "cpu": -1}, {"fighter": "bruno", "cpu": -1}]})
                    word = 16 if md == "brawl" else 1024
                    done = 0
                    for f in [180, 300, 420, 560, 680]:
                        k = max(0, f - 12 - done)
                        if k:
                            js("([n, w]) => window.__LK__.bulk(n, w, 2, 24)", [k, word])
                            done += k
                        while done < f:     # the last 12 ticks presented one per rendered frame (FX, popups, blends)
                            step(1, word if done % 24 < 2 else 0, 1)
                            done += 1
                        v = view()
                        m = js("() => window.__HP__.match()")
                        b = v.get("brawl") or {}
                        pops = js("() => window.__LK__.popups()")
                        hud = js("() => window.__HP__.hud()")
                        path = shot("%s_%03d" % (mode, f))
                        live = b.get("live") or []
                        mism = [x for x in live if x.get("sim") and x.get("sim") != x.get("body")]
                        g["frames"].append({"f": f, "brawl": b, "popups": pops, "sim": {k2: (m.get("brawl") or {}).get(k2) for k2 in ("score", "ratings", "grade", "wave", "spawned", "downed", "hitsTaken", "parries")},
                                            "simGoons": [(x.get("slot"), x.get("kind"), x.get("stateName"), x.get("moveName")) for x in ((m.get("brawl") or {}).get("goons") or [])],
                                            "proj": [(x.get("kind"), x.get("obj")) for x in (m.get("proj") or [])], "cam": (v.get("camera") or {}).get("mode"),
                                            "hudPopups": (hud or {}).get("popups") if isinstance(hud, dict) else None, "path": path})
                        if b.get("fallback"):
                            fails.append("%s f%d: goons on the stand-in body (fallback)" % (mode, f))
                        if mism:
                            fails.append("%s f%d: goon body != sim kind %s" % (mode, f, json.dumps(mism)))
                        log("%s f%-3d cam %-8s kinds %s live %s popups %d sim %s proj %s" % (mode, f, (v.get("camera") or {}).get("mode"), b.get("kinds"),
                            json.dumps([(x.get("sim"), x.get("body"), x.get("clip")) for x in live]), len(pops or []), json.dumps(g["frames"][-1]["sim"]), json.dumps(g["frames"][-1]["proj"])))
                    g["strip"] = strip([fr["path"] for fr in g["frames"]], os.path.join(SHOTS, "%s_%s_strip.png" % (pre, mode)), cols=3)
                    break
                except Exception as e:
                    if attempt or not lost(e):
                        fails.append("%s: %s" % (mode, str(e).splitlines()[0][:300]))
                        break
                    log("%s: WebGL context lost (shared GPU) - page reloaded, retried" % mode)
                    time.sleep(3)
                    boot()
        if "gstage" in groups:
            g = rep["groups"]["gstage"] = {}
            paths = []
            for sid in args.stages.split(","):
                for attempt in (0, 1):
                    try:
                        start({"mode": "versus", "stage": sid, "seed": 1, "p": [{"fighter": "johnny", "cpu": -1}, {"fighter": "bruno", "cpu": -1}]})
                        step(12)
                        v1 = view()
                        paths.append(shot("gstage_%s_a" % sid))
                        step(20)
                        v2 = view()
                        paths.append(shot("gstage_%s_b" % sid))
                        s1, s2 = (v1.get("stage") or {}), (v2.get("stage") or {})
                        l1, l2 = s1.get("live") or {}, s2.get("live") or {}
                        moved = {k: l1.get(k) != l2.get(k) for k in ("spin", "flame", "flicker", "rainY") if l1.get(k)}
                        g[sid] = {"dressing": s2.get("dressing"), "glare": s2.get("glareGraded"), "live": [l1, l2], "moved": moved, "fallback": v2.get("stageFallback")}
                        for k, mv in moved.items():
                            if not mv:
                                fails.append("gstage %s: %s did not change over 20 frames (%s)" % (sid, k, json.dumps(l2.get(k))))
                        log("gstage %-14s dressing %s" % (sid, json.dumps(s2.get("dressing"))))
                        log("gstage %-14s live %s -> %s moved %s" % (sid, json.dumps({k: l1.get(k) for k in ('spin', 'flame', 'flicker', 'rainY', 'steam', 'screens')}),
                                                                   json.dumps({k: l2.get(k) for k in ('spin', 'flame', 'flicker', 'rainY')}), json.dumps(moved)))
                        break
                    except Exception as e:
                        if attempt or not lost(e):
                            fails.append("gstage %s: %s" % (sid, str(e).splitlines()[0][:300]))
                            break
                        log("%s: WebGL context lost (shared GPU) - page reloaded, retried" % sid)
                        time.sleep(3)
                        boot()
            if paths:
                rep["groups"]["gstage_strip"] = strip(paths, os.path.join(SHOTS, "%s_gstage_strip.png" % pre), cols=2)
        if "g3d" in groups:
            g = rep["groups"]["g3d"] = {}
            parts = [x for x in (args.g3d.split(",") if args.g3d else G3D_PARTS) if x]
            EVW = {"WALL_SPLAT": 14, "PROJ_SPAWN": 17, "PROJ_HIT": 18, "CINEMATIC_START": 26}
            STEP_IN, STEP_OUT, RIGHT, LEFT, DOWN, Hb, Sb = 8192, 16384, 8, 4, 2, 64, 128
            sd = js("() => window.__LK__.ensureStep()")
            g["stepDrive"] = sd
            log("g3d STEP drive: %s (input.ts WORD_MASK 0x%04x)" % (sd.get("mode"), sd.get("mask", 0)))
            snapf = lambda: js("() => window.__LK__.snap()")

            def stepP(n, w0=0, w1=0):
                return js("([n, a, b]) => window.__LK__.stepP(n, a, b)", [n, w0, w1])

            def fight(cfg):
                start(cfg)
                js("() => window.__LK__.ensureStep()")
                stepP(4)

            def camline(sn):
                c = sn.get("cam") or {}
                return "line %6s cam yaw %7s (camN yaw %7s) d %.2f pos %s raise %s pull %s occl %s" % (
                    sn.get("line"), c.get("yawDeg"), c.get("yawTDeg"), c.get("dist") or 0, c.get("pos"), c.get("raise"), c.get("pull"), c.get("occluded"))

            def part(name, fn):
                for attempt in (0, 1):
                    try:
                        fn()
                        return
                    except Exception as e:
                        if attempt or not lost(e):
                            fails.append("g3d %s: %s" % (name, str(e).splitlines()[0][:300]))
                            return
                        log("g3d %s: WebGL context lost - page reloaded, retried" % name)
                        time.sleep(3)
                        boot()
                        js("() => window.__LK__.ensureStep()")

            def p_circle():
                row = g["circle"] = {"frames": []}
                fight({"mode": "versus", "stage": "rust_theater", "seed": 1, "p": [{"fighter": "johnny", "cpu": -1}, {"fighter": "bruno", "cpu": -1}]})
                yaws = []
                for k in range(7):
                    if k:
                        stepP(75, STEP_IN, 0)
                    sn = snapf()
                    path = shot("g3d_circle_%d" % k)
                    yaws.append((sn.get("cam") or {}).get("yawDeg"))
                    row["frames"].append({"k": k, "path": path, "snap": sn})
                    log("g3d circle %d %s | P1 %s step %s view %s | P2 view %s" % (k, camline(sn), sn["f"][0]["st"], json.dumps(sn["f"][0].get("step")),
                        json.dumps(sn["view"][0]), json.dumps(sn["view"][1])))
                row["camYaws"] = yaws
                spread = sorted(set(int(round(float(y or 0))) // 30 for y in yaws))
                row["angleBins30"] = spread
                if len(spread) < 6:
                    fails.append("g3d circle: only %d distinct 30-deg camera bins over 7 shots (%s)" % (len(spread), yaws))
                row["strip"] = strip([fr["path"] for fr in row["frames"]], os.path.join(SHOTS, "%s_g3d_circle_strip.png" % pre), cols=4)

            def p_dodge():
                row = g["dodge"] = {"frames": []}
                fight({"mode": "versus", "stage": "rust_theater", "seed": 1, "p": [{"fighter": "bruno", "cpu": -1}, {"fighter": "johnny", "cpu": -1}]})
                stepP(30, STEP_IN, 0)                        # off the spawn axis first: the throw flies along a diagonal
                stepP(14)
                hp0 = snapf()["f"][0]["hp"]
                # P2 (johnny, facing screen-left) 5S = BRICKBAT, then P1 taps STEP_IN the tick the brick leaves the hand
                spawn = -1
                for k in range(60):
                    stepP(1, 0, Sb if k < 2 else 0)
                    sn = snapf()
                    if sn["proj3"]:
                        spawn = k
                        break
                if spawn < 0:
                    raise RuntimeError("no brick spawned")
                row["spawnSnap"] = snapf()
                before = js("(n) => window.__LK__.evs(n)", 256)
                best = None
                for k in range(40):
                    stepP(1, STEP_IN if k < 3 else 0, 0)
                    sn = snapf()
                    pj = sn["proj3"]
                    dd = None
                    if pj:
                        q = pj[0]; me = sn["f"][0]
                        dd = ((q["x"] - me["x"]) ** 2 + (q["z"] - me["z"]) ** 2) ** 0.5
                        if best is None or dd < best[0]:
                            best = (dd, k, sn)
                    if k in (3, 7) or (dd is not None and best[1] == k and dd < 0.9):
                        row["frames"].append({"k": k, "path": shot("g3d_dodge_k%02d" % k), "snap": sn})
                        if dd is not None and best[1] == k and dd < 0.9:
                            ov = js("(n) => window.__LK__.overhead(n)", "%s_g3d_dodge_k%02d_overhead_harness" % (pre, k))
                            row["overhead"] = (ov or {}).get("path")
                    if not pj and k > 4:
                        break
                stepP(10)
                after = js("(n) => window.__LK__.evs(n)", 256)
                fresh = [e for e in after if e not in before]
                hits = [e for e in fresh if e.get("type") == EVW["PROJ_HIT"]]
                hp1 = snapf()["f"][0]["hp"]
                row.update({"spawnK": spawn, "closest": {"m": round(best[0], 3), "k": best[1], "snap": best[2]} if best else None, "projHits": hits, "hp": [hp0, hp1]})
                row["frames"].append({"k": "after", "path": shot("g3d_dodge_after"), "snap": snapf()})
                log("g3d dodge: brick spawn k%d, closest approach %.3f m at k%s (P1 step %s), PROJ_HIT %d, P1 hp %s -> %s" % (
                    spawn, best[0] if best else -1, best[1] if best else "-", json.dumps(best[2]["f"][0].get("step")) if best else "-", len(hits), hp0, hp1))
                if hits or hp1 != hp0:
                    fails.append("g3d dodge: the sidestep did not evade (PROJ_HIT %d, hp %s -> %s)" % (len(hits), hp0, hp1))
                row["strip"] = strip([fr["path"] for fr in row["frames"]], os.path.join(SHOTS, "%s_g3d_dodge_strip.png" % pre), cols=4)

            def p_splat():
                row = g["splat"] = {"frames": []}
                fight({"mode": "versus", "stage": "rust_theater", "seed": 1, "p": [{"fighter": "bruno", "cpu": -1}, {"fighter": "johnny", "cpu": -1}]})
                stepP(40, STEP_OUT, 0)                       # the line turns ~30 deg: the wall is met off the spawn axis
                stepP(10)
                before = js("(n) => window.__LK__.evs(n)", 256)
                splat = None
                pushed = 0
                for rnd in range(6):
                    # walk P2 back toward the ring (bruno walks into johnny; johnny holds back = walks away), then 6H
                    for k in range(160):
                        sn = snapf()
                        rg = sn.get("ring") or {}
                        r = rg.get("radius", 5.5)
                        v = sn["f"][1]
                        if r - (v["x"] ** 2 + v["z"] ** 2) ** 0.5 < 0.85:
                            break
                        stepP(1, RIGHT, RIGHT if v["facing"] < 0 else LEFT)   # P2 holds BACK (screen side away from P1)
                        pushed += 1
                    # SIMPLE 6S = bruno FRIDGE DOOR (onHit.wallSplat, wallSplat.rangeM 0.9)
                    sn0 = snapf()
                    stepP(1, RIGHT | Sb, 0); stepP(1, RIGHT | Sb, 0)
                    seen = []
                    for k in range(50):
                        stepP(1)
                        evk = [e for e in js("(n) => window.__LK__.evs(n)", 64) if e not in before]
                        seen += [e.get("type") for e in evk if e.get("type") not in seen]
                        ev = [e for e in evk if e.get("type") == EVW["WALL_SPLAT"]]
                        if ev:
                            splat = ev[-1]
                            break
                        if k == 12:
                            sk = snapf()
                    v = sn0["f"][1]
                    rg = sn0.get("ring") or {}
                    row.setdefault("rounds", []).append({"p2WallGap": round(rg.get("radius", 5.5) - (v["x"] ** 2 + v["z"] ** 2) ** 0.5, 3), "p1Move": sk["f"][0]["move"] if not splat else "", "events": seen})
                    log("g3d splat round %d: P2 %.2f m from the ring, P1 move %s, new event types %s" % (rnd, row["rounds"][-1]["p2WallGap"], row["rounds"][-1]["p1Move"], seen))
                    if splat:
                        break
                    stepP(30)
                if not splat:
                    raise RuntimeError("no WALL_SPLAT after %d pushes" % pushed)
                sn = snapf()
                row["event"] = splat
                row["frames"].append({"k": 0, "path": shot("g3d_splat_0"), "snap": sn})
                stepP(20)
                sn2 = snapf()
                row["frames"].append({"k": 20, "path": shot("g3d_splat_20"), "snap": sn2})
                stepP(45)
                sn3 = snapf()
                row["frames"].append({"k": 65, "path": shot("g3d_splat_65"), "snap": sn3})
                log("g3d splat +20: %s | +65: %s" % (camline(sn2), camline(sn3)))
                js("(n) => window.__LK__.settle(n)", 2)
                b = splat.get("b", 0)
                row["decoded"] = {"wall": b & 255, "normalDeg": b >> 8, "contactCm": [splat.get("c"), splat.get("d")]}
                row["viewSplat"] = sn.get("splat")
                log("g3d splat: WALL_SPLAT %s -> wall %d normal %d deg contact (%s, %s) cm; view placed %s; fx.wall %s; %s" % (
                    json.dumps(splat), b & 255, b >> 8, splat.get("c"), splat.get("d"), json.dumps(sn.get("splat")), (sn.get("fx") or {}).get("wall"), camline(sn)))
                if not sn.get("splat"):
                    fails.append("g3d splat: the view did not place the splat")
                row["strip"] = strip([fr["path"] for fr in row["frames"]], os.path.join(SHOTS, "%s_g3d_splat_strip.png" % pre), cols=3)

            def p_prime():
                row = g["prime"] = {"frames": []}
                fid = args.fighters.split(",")[0] if args.fighters else "johnny"
                fight({"mode": "versus", "stage": "rust_theater", "seed": 1, "p": [{"fighter": fid, "cpu": -1}, {"fighter": "bruno" if fid != "bruno" else "johnny", "cpu": -1}]})
                stepP(60, STEP_IN, 0)
                stepP(10)
                for k in range(150):
                    sn = snapf()
                    a, b = sn["f"][0], sn["f"][1]
                    if ((a["x"] - b["x"]) ** 2 + (a["z"] - b["z"]) ** 2) ** 0.5 <= 0.95:
                        break
                    stepP(1, RIGHT, 0)
                stepP(4)
                js("() => window.__HP__.dev.setMeter(0, 'showtime', 30000)")
                stepP(2)
                row["lineAtPress"] = snapf().get("line")
                stepP(2, DOWN | Sb | Hb, 0)
                st = -1
                for k in range(120):
                    stepP(1)
                    sn = snapf()
                    if (sn.get("cinematic") or {}).get("active"):
                        st = k
                        break
                if st < 0:
                    raise RuntimeError("no PRIME TIME cinematic started (line %s)" % row["lineAtPress"])
                n = (sn.get("cinematic") or {}).get("frames") or 150
                done = 0
                for cf in [12, int(n * 0.3), int(n * 0.55), int(n * 0.8)]:
                    stepP(max(0, cf - done)); done = cf
                    s2 = snapf()
                    pr = s2.get("prime") or {}
                    row["frames"].append({"cf": cf, "path": shot("g3d_prime_cf%03d" % cf), "snap": s2})
                    log("g3d prime %s cf %3d shot %-8s cineFrame %s guard %s | %s" % (fid, cf, pr.get("shot"), json.dumps(s2.get("cineFrame")), json.dumps(pr.get("guard")), camline(s2)))
                row["fighter"] = fid
                row["frames"] and log("g3d prime: fight line %s deg at the press (spawn axis 90)" % row["lineAtPress"])
                row["strip"] = strip([fr["path"] for fr in row["frames"]], os.path.join(SHOTS, "%s_g3d_prime_strip.png" % pre), cols=4)

            def p_arenas():
                row = g["arenas"] = {}
                paths = []
                for sid in args.stages.split(","):
                    fight({"mode": "versus", "stage": sid, "seed": 1, "p": [{"fighter": "johnny", "cpu": -1}, {"fighter": "bruno", "cpu": -1}]})
                    stepP(6)
                    sa = snapf()
                    pa = shot("g3d_arena_%s_a" % sid)
                    stepP(110, 0, STEP_IN)                   # P2 (mirrored) circles: the swapped step clip shows
                    sb = snapf()
                    pb = shot("g3d_arena_%s_b" % sid)
                    paths += [pa, pb]
                    row[sid] = {"a": sa, "b": sb, "paths": [pa, pb]}
                    log("g3d arena %-13s a: %s" % (sid, camline(sa)))
                    log("g3d arena %-13s b: %s | P2 sim step %s view %s ring %s" % (sid, camline(sb), json.dumps(sb["f"][1].get("step")), json.dumps(sb["view"][1]), json.dumps(sb.get("ring3"))))
                    v = sb["view"][1]
                    side = (sb["f"][1].get("step") or {}).get("side", 0)
                    want = None
                    if (sb["f"][1].get("step") or {}).get("kind") == "sidewalk":
                        own = "sidewalk_l" if side < 0 else "sidewalk_r"
                        want = (own[:-1] + ("r" if own.endswith("l") else "l")) if v.get("mirror") else own
                        if v.get("clip") != want:
                            fails.append("g3d arena %s: P2 sidewalk clip %s (mirror %s, sim side %s) expected %s" % (sid, v.get("clip"), v.get("mirror"), side, want))
                    row[sid]["expectClip"] = want
                row["strip"] = strip(paths, os.path.join(SHOTS, "%s_g3d_arenas_strip.png" % pre), cols=2)

            def p_brawl():
                row = g["brawl"] = {"frames": []}
                fight({"mode": "brawl", "stage": "rust_theater", "seed": 1, "p": [{"fighter": "johnny", "cpu": -1}, {"fighter": "bruno", "cpu": -1}]})
                done = 0
                for f in [150, 260, 380, 500]:
                    while done < f:
                        stepP(1, 16 if done % 24 < 2 else 0, 0)
                        done += 1
                    sn = snapf()
                    row["frames"].append({"f": f, "path": shot("g3d_brawl_%03d" % f), "snap": sn})
                    log("g3d brawl f%d goons %s | %s" % (f, json.dumps(sn.get("goons")), camline(sn)))
                row["strip"] = strip([fr["path"] for fr in row["frames"]], os.path.join(SHOTS, "%s_g3d_brawl_strip.png" % pre), cols=2)

            for nm in parts:
                part(nm, {"circle": p_circle, "dodge": p_dodge, "splat": p_splat, "prime": p_prime, "arenas": p_arenas, "brawl": p_brawl}[nm])
        if "fixview" in groups:
            run_fixview(p, args, rep, fails, start, pre)
    except Exception as e:
        probs.append("harness error: %s" % str(e).splitlines()[0][:600])
    finally:
        probs += problems_of(p)
        rep["console"] = p.console[-80:]
        rep["pageErrors"] = p.errors
        rep["failed"] = p.failed
        p.close()
        stop_server(server)
    rep["problems"] = probs
    rep["fails"] = fails
    out = os.path.join(REPORTS, "lookshots_%s.json" % pre)
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(rep, fh, indent=2, default=str)
    log("=" * 90)
    log("report       : %s" % out)
    for f in fails:
        log("   F %s" % f)
    for pr in probs:
        log("   X %s" % pr)
    ok = not probs and not fails
    log("RESULT: %s" % ("OK" if ok else "FAIL"))
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
