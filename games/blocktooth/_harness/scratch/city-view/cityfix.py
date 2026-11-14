#!/usr/bin/env python
"""city fix-group captures (occluder ghosts, prop see-through, rubble heaps, tower bands, breakdown).

    python _harness/scratch/city-view/cityfix.py --base http://localhost:5194/ --only occl,props,rubble,towers,bd,pancake --tag after

Output: _shots/city_fix/<tag>_<name>.png (+ *_crop.png around the titan). Cheats (?dev=1) + direct
world writes are used to POSE shots (a camera, not a playtest).
"""
import argparse
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(os.path.dirname(HERE)))
from common import (ROOT, Session, add_common_args, build_url, ensure_play, set_rank, world_to_keys)  # noqa: E402

OUT = os.path.join(ROOT, "_shots", "city_fix")

PROJ_JS = r"""
(pts) => {
  const B = window.__BT__; const core = B && B.debugCore; if (!core) return null;
  const cam = core.camera; const V = cam.position.constructor;
  const cv = core.renderer.domElement; const r = cv.getBoundingClientRect();
  return pts.map(p => { const v = new V(p[0], p[1], p[2]).project(cam);
    return [ (v.x * 0.5 + 0.5) * r.width + r.left, (-v.y * 0.5 + 0.5) * r.height + r.top, v.z ]; });
}
"""

PLACE_JS = r"""
([x, z]) => { const W = window.__H_W__(); const T = W.titan;
  T.x = x; T.z = z; T.px = x; T.pz = z; if ('vx' in T) { T.vx = 0; T.vz = 0; }
  return { x: T.x, z: T.z, h: T.height, r: T.radius }; }
"""


def log(m):
    print(m, flush=True)


class C:
    def __init__(self, s, a):
        self.s = s
        self.a = a
        os.makedirs(OUT, exist_ok=True)

    def path(self, name):
        return os.path.join(OUT, "%s_%s.png" % (self.a.tag, name))

    def shot(self, name, crop=None):
        p = self.path(name)
        self.s.screenshot(p)
        log("  shot %s" % p)
        if crop:
            try:
                from PIL import Image
                im = Image.open(p)
                cx, cy, hw = crop
                box = (max(0, int(cx - hw)), max(0, int(cy - hw)), min(im.width, int(cx + hw)), min(im.height, int(cy + hw)))
                c = im.crop(box)
                if c.width < 500:
                    k = 500 / max(1, c.width)
                    c = c.resize((int(c.width * k), int(c.height * k)), Image.NEAREST)
                cp = p.replace(".png", "_crop.png")
                c.save(cp)
                log("  crop %s" % cp)
            except Exception as e:  # noqa: BLE001
                log("  crop failed: %s" % e)
        return p

    def run(self, titan, biome, seed):
        s = self.s
        s.release_all()
        s.goto(build_url(self.a.base, autostart=1, dev=1, titan=titan, biome=biome, seed=seed, noslate=1))
        s.wait_bt(90)
        s.wait_screen(("slate", "play", "draft"), 90)
        ensure_play(s, 15)
        s.cheat("god", True)
        s.cheat("noSpawns", True)
        s.cheat("killAll")

    def rank(self, r, settle=2.6):
        set_rank(self.s, r, log)
        t0 = time.time()
        while time.time() - t0 < settle:
            ensure_play(self.s, 5)
            self.s.safe_js("() => { const U = window.__H_W__().upgrades; U.pendingDrafts = 0; U.chestDrafts = 0; }")
            time.sleep(0.3)
        ensure_play(self.s, 10)

    def titan_px(self):
        o = self.s.safe_js("() => { const T = window.__H_W__().titan; return [T.x, T.height, T.z, T.radius]; }")
        pr = self.s.safe_js(PROJ_JS, [[o[0], o[1] * 0.5, o[2]]])
        return o, pr[0] if pr else None

    # ── breakdown at Size V ──
    def bd(self):
        log("== breakdown (molo / grideast, Size V)")
        self.run("molo", "grideast", 5)
        self.rank(4, 4.0)
        s = self.s
        s.hold({"KeyW"})
        time.sleep(1.5)
        s.release_all()
        time.sleep(1.0)
        b = s.safe_js("() => window.__BT__.renderBreakdown(40)")
        st = s.state() or {}
        log("  state draws %s tris %s programs %s fps %s scale %s" % (st.get("draws"), st.get("tris"), st.get("programs"), st.get("fps"), st.get("renderScale")))
        if b:
            log("  total tris %s draws %s" % (b["totalTris"], b["totalDraws"]))
            for g in b["groups"]:
                log("   group %-28s tris %8d draws %4d" % (g["name"], g["tris"], g["draws"]))
            for m in b["meshes"]:
                if "city" in m["path"]:
                    log("   mesh %-60s tris %8d inst %5d cast %s" % (m["path"][-60:], m["tris"], m["instances"], m["castShadow"]))
        self.shot("bd_sizeV")

    # ── tower bands ──
    def towers(self):
        for biome, seed in (("lockwater", 7), ("grideast", 7), ("whitestacks", 7)):
            if self.a.biomes and biome not in self.a.biomes.split(","):
                continue
            log("== towers %s Size V" % biome)
            self.run("molo", biome, seed)
            self.rank(4, 4.0)
            self.s.bt_call("freeze", True)
            time.sleep(0.8)
            self.shot("towers_%s_V" % biome, crop=(640, 300, 180))
            self.s.bt_call("freeze", False)

    # ── building occluders: titan behind a tall building ──
    def occl(self):
        for titan, biome, rank in (("molo", "grideast", 2), ("voltkite", "whitestacks", 2), ("molo", "grideast", 1)):
            log("== occl %s/%s rank %d" % (titan, biome, rank))
            self.run(titan, biome, 21)
            self.rank(rank, 3.0)
            s = self.s
            s.bt_call("freeze", True)
            js = r"""
            () => { const W = window.__H_W__(); const T = W.titan; let best = null, bd = 1e9;
              for (const b of W.city.buildings) { if (b.collapsed || b.alive < 2) continue;
                const top = b.alive * b.floorH; if (top < T.height * 1.3 || top > T.height * 4) continue;
                const d = Math.hypot(b.x - T.x, b.z - T.z); if (d < bd) { bd = d; best = b; } }
              return best ? { id: best.id, x: best.x, z: best.z, w: best.w, d: best.d, top: best.alive * best.floorH, arch: best.arch } : null; }
            """
            b = s.safe_js(js)
            log("   building %s" % (b,))
            if not b:
                s.bt_call("freeze", False)
                continue
            o = s.safe_js("() => { const T = window.__H_W__().titan; return [T.height, T.radius]; }")
            off = math.hypot(b["w"], b["d"]) * 0.5 + o[1] * 0.9
            x = b["x"] - off * math.sqrt(0.5)
            z = b["z"] - off * math.sqrt(0.5)
            s.safe_js(PLACE_JS, [x, z])
            time.sleep(2.2)
            _, pr = self.titan_px()
            name = "occl_%s_%s_%s" % (titan, biome, ["I", "II", "III", "IV", "V"][rank])
            self.shot(name, crop=(pr[0], pr[1], 170) if pr else None)
            s.bt_call("freeze", False)

    # ── prop occluders at Size I ──
    def props(self):
        for biome, kinds in (("grideast", ("kiosk", "vending", "bus", "truck", "van", "car")), ("whitestacks", ("container", "truck", "forklift", "van"))):
            log("== props %s Size I" % biome)
            self.run("molo", biome, 31)
            s = self.s
            ensure_play(s, 10)
            s.bt_call("freeze", True)
            js = r"""
            (kinds) => { const W = window.__H_W__(); const T = W.titan; let best = null, bd = 1e9;
              for (const p of W.city.props) { if (!p.alive || p.lane >= 0 || !kinds.includes(p.kind)) continue;
                const d = Math.hypot(p.x - T.x, p.z - T.z); if (d < bd) { bd = d; best = p; } }
              return best ? { id: best.id, x: best.x, z: best.z, kind: best.kind, d: bd } : null; }
            """
            p = s.safe_js(js, list(kinds))
            log("   prop %s" % (p,))
            if not p:
                s.bt_call("freeze", False)
                continue
            o = s.safe_js("() => { const T = window.__H_W__().titan; return [T.height, T.radius]; }")
            off = {"bus": 3.2, "truck": 3.0, "container": 3.0}.get(p["kind"], 1.7) + o[1]
            x = p["x"] - off * math.sqrt(0.5)
            z = p["z"] - off * math.sqrt(0.5)
            s.safe_js(PLACE_JS, [x, z])
            time.sleep(2.0)
            _, pr = self.titan_px()
            self.shot("props_%s_I_%s" % (biome, p["kind"]), crop=(pr[0], pr[1], 110) if pr else None)
            s.bt_call("freeze", False)

    # ── rubble heaps at Size IV/V ──
    def rubble(self):
        for biome in ("grideast", "whitestacks", "lockwater"):
            log("== rubble %s" % biome)
            self.run("molo", biome, 41)
            self.rank(3, 3.0)
            s = self.s
            s.bt_call("freeze", True)
            n = s.safe_js(r"""() => { const W = window.__H_W__(); const T = W.titan; let n = 0;
              for (const b of W.city.buildings) { if (b.collapsed) continue; const d = Math.hypot(b.x - T.x, b.z - T.z);
                if (d > 40 && d < 170 && (b.id % 2 === 0)) { b.alive = 0; b.collapsed = true; n++; } }
              return n; }""")
            log("   collapsed %s buildings" % n)
            time.sleep(3.0)
            self.shot("rubble_%s_IV" % biome, crop=(640, 360, 200))
            s.bt_call("freeze", False)
            self.rank(4, 3.0)
            s.bt_call("freeze", True)
            time.sleep(1.2)
            self.shot("rubble_%s_V" % biome, crop=(640, 360, 200))
            s.bt_call("freeze", False)

    # ── pancake: Size II titan chewing a tier-2 midrise, burst on each floorBreak ──
    def pancake(self):
        log("== pancake (molo / grideast, Size II vs tier-2 midrise)")
        self.run("molo", "grideast", 313)
        s = self.s
        self.rank(1, 2.0)
        js = r"""
        () => { const W = window.__H_W__(); const T = W.titan; let best = null, bd = 1e9;
          for (const b of W.city.buildings) { if (b.collapsed || b.alive < 5 || b.tier !== 2) continue;
            const d = Math.hypot(b.x - T.x, b.z - T.z); if (d < bd) { bd = d; best = b; } }
          return best ? { id: best.id, x: best.x, z: best.z, alive: best.alive, d: bd } : null; }
        """
        b = s.safe_js(js)
        log("   target %s" % (b,))
        if not b:
            return
        last = b["alive"]
        bursts = 0
        t0 = time.time()
        while time.time() - t0 < 30 and bursts < 3:
            s.safe_js("() => { const U = window.__H_W__().upgrades; U.pendingDrafts = 0; U.chestDrafts = 0; }")
            if s.screen() != "play":
                s.release_all()
                ensure_play(s, 5)
                continue
            T = s.safe_js("() => { const T = window.__H_W__().titan; return [T.x, T.z]; }")
            s.hold(world_to_keys(b["x"] - T[0], b["z"] - T[1]) or {"KeyW"})
            cur = s.safe_js("(id) => window.__H_W__().city.buildings[id].alive", b["id"])
            if cur is not None and cur < last:
                s.bt_call("freeze", True)
                time.sleep(0.25)
                pr = s.safe_js(PROJ_JS, [[b["x"], 6.0, b["z"]]])
                self.shot("pancake_%d" % bursts, crop=(pr[0][0], pr[0][1], 190) if pr else None)
                s.bt_call("freeze", False)
                bursts += 1
                last = cur
            time.sleep(0.04)
        s.release_all()


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--only", default="bd,towers,occl,props,rubble,pancake")
    ap.add_argument("--tag", default="after")
    ap.add_argument("--biomes", default="")
    a = ap.parse_args()
    a.no_serve = True
    with Session(a, "cityfix") as s:
        c = C(s, a)
        for name in a.only.split(","):
            try:
                getattr(c, name)()
            except Exception as e:  # noqa: BLE001
                log("!! %s failed: %s" % (name, e))
        errs = [t for (k, t) in s.console if k == "error"] + s.page_errors
        log("console/page errors: %d" % len(errs))
        for e in errs[:10]:
            log("   " + str(e)[:300])


if __name__ == "__main__":
    main()
