#!/usr/bin/env python
"""HIT PARADE look evidence - the G5 inputs (CONTRACT section 7, 13). Lane VIEW. Adapted from dyefield _harness/lookshots.py.

    python _harness/lookshots.py                     # the VIEW lab (runtime/lab/view.html), headed Chrome d3d11, 1600x900
    python _harness/lookshots.py --headless          # headless Chrome (same d3d11 flags)
    python _harness/lookshots.py --only toon,sep     # a subset of the shot groups
    python _harness/lookshots.py --base http://localhost:5323/ --no-serve

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
    args = ap.parse_args()
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


if __name__ == "__main__":
    raise SystemExit(main())
