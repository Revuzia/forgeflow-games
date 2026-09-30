#!/usr/bin/env python
"""HIT PARADE look evidence - the G5 inputs (CONTRACT section 7, 13). Lane VIEW. Adapted from dyefield _harness/lookshots.py.

    python _harness/lookshots.py                     # the VIEW lab (runtime/lab/view.html), headed Chrome d3d11, 1600x900
    python _harness/lookshots.py --headless          # headless Chrome (same d3d11 flags)
    python _harness/lookshots.py --only toon,sep     # a subset of the shot groups
    python _harness/lookshots.py --base http://localhost:5323/ --no-serve
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
        self.browser = self._pw.chromium.launch(channel="chrome", headless=self.args.headless, args=FLAGS)
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
    args = ap.parse_args()
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
                s = p.js("(o) => window.__LAB__.prime(o)", {"phase2": ph2})
                start = s.get("cineAt", -1) if s.get("cineAt", -1) >= 0 else s.get("lockAt", -1)
                row = {"script": s, "frames": []}
                g[key] = row
                if start is None or start < 0:
                    fails.append("prime %s: no cinematic / grab lock started (%s)" % (key, s.get("note")))
                    log("prime %-16s NO CINEMATIC %s" % (key, json.dumps(s)))
                    continue
                info = goto(start + 1)
                pr = info.get("prime") or {}
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
                    row["frames"].append({"cf": cf, "shot": nm, "cam": info["camera"]["mode"], "prime": {k: pr.get(k) for k in ("f", "shot", "att", "vic", "gap", "vy", "carry", "freeze", "slate", "letterbox", "dim", "spot")},
                                          "fighters": [{k: x.get(k) for k in ("x", "y", "clip", "t", "propsShown", "override")} for x in info.get("fighters", [])], "fx": info.get("fx")})
                    log("prime %-16s cf %3d %-14s att %-26s vic %-26s gap %.2f vy %.2f" % (key, cf, nm, ",".join(pr.get("att") or [])[:26], ",".join(pr.get("vic") or [])[:26], pr.get("gap") or 0, pr.get("vy") or 0))
                if end is not None and end >= 0:
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
                s = p.js("([k, o]) => window.__LAB__.special(k, o)", [key, {"phase2": ph2, "after": 150}])
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
            s = p.js("() => window.__LAB__.ko()")
            ko = s.get("koAt", -1)
            g = rep["groups"]["ko"] = {"script": s, "frames": []}
            if ko is None or ko < 0:
                fails.append("ko: no KO (%s)" % json.dumps(s))
            else:
                paths = []
                for k in [4, 40, 80, 130, 190, 250]:
                    info = goto(ko + k)
                    paths.append(shoot("ko_%03d" % k))
                    g["frames"].append({"k": k, "cam": info["camera"], "tops": None})
                    log("ko +%3d cam %s d=%.2f" % (k, info["camera"]["mode"], info["camera"]["dist"]))
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


if __name__ == "__main__":
    raise SystemExit(main())
