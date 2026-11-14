#!/usr/bin/env python
"""Visual-critic targeted captures (read-only critic pass). Output: _shots/critic/x/<name>.png

    python _harness/scratch/critic/critic_shots.py --base http://localhost:5191/ --headless --only alert,pancake,...
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

OUT = os.path.join(ROOT, "_shots", "critic", "x")
LOG = []


def log(m):
    LOG.append(m)
    print(m, flush=True)


PROJ_JS = r"""
(pts) => {
  const B = window.__BT__; const core = B && B.debugCore; if (!core) return null;
  const cam = core.camera; const V = cam.position.constructor;
  const cv = core.renderer.domElement; const r = cv.getBoundingClientRect();
  return pts.map(p => { const v = new V(p[0], p[1], p[2]).project(cam);
    return [ (v.x * 0.5 + 0.5) * r.width + r.left, (-v.y * 0.5 + 0.5) * r.height + r.top, v.z ]; });
}
"""

W_JS = r"""
() => { const W = window.__H_W__ && window.__H_W__(); if (!W) return null; const T = W.titan; const b = W.boss;
  const tgs = [];
  for (const tg of (W.telegraphs || [])) { if (!tg.alive || tg.fired) continue;
    tgs.push({ id: tg.id, owner: tg.owner, style: tg.style, tag: tg.tag || '', t: tg.t, windup: tg.windup }); }
  return { t: W.t, T: { x: T.x, z: T.z, h: T.height, r: T.radius, hp: T.hp, maxHp: T.maxHp, leash: T.leash ? T.leash.t : 0, heading: T.heading },
    boss: b ? { id: b.id, x: b.x, z: b.z, hp: b.hp, maxHp: b.maxHp, phase: b.phase, attack: b.attack, attackT: b.attackT, introT: b.introT, alive: b.alive } : null,
    tgs, enemies: (W.enemies || []).filter(e => e.alive).map(e => ({ id: e.id, kind: e.kind, x: e.x, z: e.z, h: e.height || 2 })) };
}
"""


class C:
    def __init__(self, sess, args):
        self.s = sess
        self.a = args
        os.makedirs(OUT, exist_ok=True)
        self.manifest = []

    def shot(self, name, **meta):
        p = os.path.join(OUT, name + ".png")
        ok = self.s.screenshot(p)
        st = self.s.state() or {}
        meta.update({"name": name, "ok": ok, "screen": st.get("screen"), "rank": st.get("rank"),
                     "biome": st.get("biome"), "titan": st.get("titan"), "wall": round(time.time(), 3)})
        self.manifest.append(meta)
        log("  [%s] %s %s" % ("ok" if ok else "!!", name, json.dumps({k: v for k, v in meta.items() if k not in ("name", "ok", "wall")})[:200]))
        return ok

    def run(self, titan, biome, seed, slate=False):
        s = self.s
        s.release_all()
        url = build_url(self.a.base, autostart=1, dev=1, titan=titan, biome=biome, seed=seed, noslate=None if slate else 1)
        s.goto(url)
        s.wait_bt(90)
        ok, scr = s.wait_screen(("slate", "play", "draft"), 90)
        return ok, scr

    def w(self):
        return self.s.safe_js(W_JS)

    def keep_play(self):
        return ensure_play(self.s, 10)

    # ── the opening HALVARD alert: sequence of frames through enter / hold / exit ──
    def alert(self):
        log("== alert sequence (molo / grideast)")
        self.run("molo", "grideast", 301)
        self.keep_play()
        t0 = time.time()
        # the contractors alert fires early; snap every ~0.35 s for 7 s
        i = 0
        while time.time() - t0 < 7.5:
            vis = self.s.safe_js("() => { const a = document.querySelector('.bt-alert'); if (!a) return null;"
                                 " const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);"
                                 " return {on: a.classList.contains('on'), vis: cs.visibility, x: Math.round(r.left), w: Math.round(r.width), t: a.querySelector('.bt-alert-title').textContent}; }")
            self.shot("alert_seq_%02d" % i, alert=vis, dt=round(time.time() - t0, 2))
            i += 1
            time.sleep(0.25)

    # ── pancake: a Size III titan chews a tier-3 office block (oversize → pancakes floor by floor) ──
    def pancake(self):
        log("== pancake (molo / grideast, size II vs midrise)")
        self.run("molo", "grideast", 302)
        self.keep_play()
        self.s.cheat("god", True)
        self.s.cheat("noSpawns", True)
        self.s.cheat("killAll")
        set_rank(self.s, 2, log)
        time.sleep(2.0)
        # find the nearest live building with tier == 3 (oversize at Size III => pancakes slowly) or tier 2 w/ >=4 floors
        js = r"""
        () => { const W = window.__H_W__(); const T = W.titan; let best = null, bd = 1e9;
          for (const b of W.city.buildings) { if (b.collapsed || b.alive < 4) continue; if (b.tier < 2 || b.tier > 3) continue;
            const d = Math.hypot(b.x - T.x, b.z - T.z); if (d < bd) { bd = d; best = b; } }
          return best ? { id: best.id, x: best.x, z: best.z, tier: best.tier, alive: best.alive, d: bd } : null; }
        """
        b = self.s.safe_js(js)
        log("    target building %s" % (b,))
        if not b:
            return
        t0 = time.time()
        burst_done = 0
        last_alive = b["alive"]
        while time.time() - t0 < 30 and burst_done < 2:
            if self.s.screen() != "play":
                self.s.release_all()
                self.keep_play()
                continue
            o = self.w()
            T = o["T"]
            dx, dz = b["x"] - T["x"], b["z"] - T["z"]
            self.s.hold(world_to_keys(dx, dz) or {"KeyW"})
            cur = self.s.safe_js("(id) => { const W = window.__H_W__(); const b = W.city.buildings[id]; return b ? b.alive : null; }", b["id"])
            if cur is not None and cur < last_alive:
                # a floor just broke: 3 frames ~0.12 s apart
                for k in range(3):
                    t1 = time.time()
                    self.shot("pancake_%d_%d" % (burst_done, k), floorsLeft=cur)
                    dt = time.time() - t1
                    if dt < 0.12:
                        time.sleep(0.12 - dt)
                burst_done += 1
                last_alive = cur
            time.sleep(0.05)
        self.s.release_all()

    def pancake2(self):
        """Fast JPEG burst on each floorBreak (drafts suppressed so they don't cover the frames)."""
        log("== pancake2 (molo / grideast, size III vs midrise)")
        self.run("molo", "grideast", 312)
        self.keep_play()
        s = self.s
        s.cheat("god", True)
        s.cheat("noSpawns", True)
        s.cheat("killAll")
        set_rank(s, 2, log)
        time.sleep(2.0)
        self.keep_play()
        js = r"""
        () => { const W = window.__H_W__(); const T = W.titan; let best = null, bd = 1e9;
          for (const b of W.city.buildings) { if (b.collapsed || b.alive < 5 || b.tier !== 2) continue;
            const d = Math.hypot(b.x - T.x, b.z - T.z); if (d < bd) { bd = d; best = b; } }
          return best ? { id: best.id, x: best.x, z: best.z, alive: best.alive, d: bd } : null; }
        """
        b = s.safe_js(js)
        log("    target %s" % (b,))
        if not b:
            return
        last = b["alive"]
        bursts = 0
        t0 = time.time()
        while time.time() - t0 < 30 and bursts < 3:
            s.safe_js("() => { const U = window.__H_W__().upgrades; U.pendingDrafts = 0; U.chestDrafts = 0; }")
            if s.screen() != "play":
                s.release_all()
                self.keep_play()
                continue
            o = self.w()
            T = o["T"]
            s.hold(world_to_keys(b["x"] - T["x"], b["z"] - T["z"]) or {"KeyW"})
            cur = s.safe_js("(id) => window.__H_W__().city.buildings[id].alive", b["id"])
            if cur is not None and cur < last:
                ts = []
                for k in range(4):
                    t1 = time.time()
                    p = os.path.join(OUT, "pancake2_%d_%d.jpg" % (bursts, k))
                    s.page.screenshot(path=p, type="jpeg", quality=80)
                    ts.append(round(t1 - (ts and 0 or t1), 3))
                    ts[-1] = round(time.time() - t1, 3)
                log("    burst %d floorsLeft=%s shot durations %s" % (bursts, cur, ts))
                bursts += 1
                last = cur
            time.sleep(0.03)
        s.release_all()

    def pancake3(self):
        """Size II titan chewing an oversize tier-2 midrise; in-page captureFrame at +0/+0.12/+0.24/+0.36 s
        after each floorBreak (canvas only, precise timing)."""
        log("== pancake3 (molo / grideast, Size II vs tier-2 midrise, in-page timed capture)")
        self.run("molo", "grideast", 313)
        self.keep_play()
        s = self.s
        s.cheat("god", True)
        s.cheat("noSpawns", True)
        s.cheat("killAll")
        set_rank(s, 1, log)
        time.sleep(2.0)
        self.keep_play()
        js = r"""
        () => { const W = window.__H_W__(); const T = W.titan; let best = null, bd = 1e9;
          for (const b of W.city.buildings) { if (b.collapsed || b.alive < 5 || b.tier !== 2) continue;
            const d = Math.hypot(b.x - T.x, b.z - T.z); if (d < bd) { bd = d; best = b; } }
          return best ? { id: best.id, x: best.x, z: best.z, alive: best.alive, d: bd } : null; }
        """
        b = s.safe_js(js)
        log("    target %s" % (b,))
        if not b:
            return
        s.safe_js(r"""(id) => { window.__PK__ = { frames: [], last: null, bursts: 0 };
          const P = window.__PK__;
          const loop = () => { const W = window.__H_W__(); if (!W) return; const bb = W.city.buildings[id];
            if (P.last === null) P.last = bb.alive;
            if (bb.alive < P.last && P.bursts < 3) { P.last = bb.alive; const k = P.bursts++; const t0 = performance.now();
              [0, 120, 240, 360].forEach((dt, j) => setTimeout(() => {
                P.frames.push({ k, j, t: Math.round(performance.now() - t0), alive: bb.alive, url: window.__BT__ && window.__BT__.debugCore ? null : null,
                  data: (window.__APPCAP__ || null) });
                window.__BT__.shot('critic_pancake3_' + k + '_' + j);
              }, dt)); }
            requestAnimationFrame(loop); };
          requestAnimationFrame(loop); }""", b["id"])
        t0 = time.time()
        while time.time() - t0 < 25:
            s.safe_js("() => { const U = window.__H_W__().upgrades; U.pendingDrafts = 0; U.chestDrafts = 0; }")
            if s.screen() != "play":
                s.release_all()
                self.keep_play()
                continue
            n = s.safe_js("() => window.__PK__.bursts", default=0)
            if n >= 3:
                break
            o = self.w()
            T = o["T"]
            s.hold(world_to_keys(b["x"] - T["x"], b["z"] - T["z"]) or {"KeyW"})
            time.sleep(0.1)
        s.release_all()
        time.sleep(2)
        log("    frames %s" % s.safe_js("() => window.__PK__.frames.map(f => [f.k, f.j, f.t, f.alive])"))

    # ── enemy roster: each of the 8 kinds at Size II/III, frozen near the titan ──
    def enemies(self):
        log("== enemy roster (briarwick / grideast)")
        self.run("hearthback", "grideast", 303)
        self.keep_play()
        self.s.cheat("god", True)
        self.s.cheat("noSpawns", True)
        self.s.cheat("killAll")
        for kind, rank in (("android", 1), ("squad", 1), ("drone", 1), ("buggy", 1), ("apc", 2), ("tank", 2), ("walker", 2), ("elite", 2)):
            cur = (self.s.state() or {}).get("rank") or 0
            if rank > cur:
                set_rank(self.s, rank, log)
                time.sleep(1.8)
            self.s.cheat("killAll")
            self.keep_play()
            self.s.cheat("spawn", kind, 4 if kind not in ("elite", "walker") else 1)
            # wait until one is within ~0.45 of the view height from the titan
            t0 = time.time()
            got = False
            while time.time() - t0 < 14:
                if self.s.screen() != "play":
                    self.keep_play()
                    continue
                o = self.w()
                if not o:
                    break
                T = o["T"]
                es = [e for e in o["enemies"] if e["kind"] == kind]
                if not es:
                    time.sleep(0.2)
                    continue
                e = min(es, key=lambda e: math.hypot(e["x"] - T["x"], e["z"] - T["z"]))
                d = math.hypot(e["x"] - T["x"], e["z"] - T["z"])
                view_h = [9.2, 33.3, 82.4, 168.4, 285.7][rank]
                if d < view_h * 0.42:
                    self.s.bt_call("freeze", True)
                    time.sleep(0.35)
                    pr = self.s.safe_js(PROJ_JS, [[e["x"], e["h"] * 0.5, e["z"]]])
                    self.shot("enemy_%s" % kind, kind=kind, dist=round(d, 1), screenXY=pr)
                    self.s.bt_call("freeze", False)
                    got = True
                    break
                # walk toward it
                self.s.hold(world_to_keys(e["x"] - T["x"], e["z"] - T["z"]) or {"KeyW"})
                time.sleep(0.15)
            self.s.release_all()
            if not got:
                log("    !! no %s came into frame" % kind)
                self.shot("enemy_%s_miss" % kind, kind=kind)

    # ── bosses: every attack in every phase ──
    def stomp(self, titan, biome, tag):
        """CAISSON-4 phase 3 hugging the boss, to catch legStomp (anti-melee ring)."""
        log("== boss stomp %s (%s / %s)" % (tag, titan, biome))
        self.run(titan, biome, 310)
        self.keep_play()
        s = self.s
        s.cheat("god", True)
        s.cheat("noSpawns", True)
        s.cheat("killAll")
        set_rank(s, 4, log)
        time.sleep(2.5)
        s.cheat("boss")
        t0 = time.time()
        got = set()
        intro = False
        while time.time() - t0 < 110 and len(got) < 3:
            if s.screen() != "play":
                s.release_all()
                self.keep_play()
                continue
            o = self.w()
            if not o or not o.get("boss"):
                time.sleep(0.2)
                continue
            b, T = o["boss"], o["T"]
            if not intro and time.time() - t0 > 3.0:
                self.shot("boss_%s_intro" % tag)
                intro = True
            if b["introT"] <= 0 and b["phase"] < 3:
                s.safe_js("() => { const b = window.__H_W__().boss; b.hp = Math.min(b.hp, b.maxHp * 0.3); }")
            dx, dz = b["x"] - T["x"], b["z"] - T["z"]
            d = math.hypot(dx, dz) or 1
            if d < 60:
                dx, dz = -dz, dx
            s.hold(world_to_keys(dx, dz) or {"KeyW"})
            for tg in o["tgs"]:
                if tg["owner"] != "boss" or not tg["windup"]:
                    continue
                key = "P%d_%s" % (b["phase"], b["attack"] or tg["tag"])
                fr = tg["t"] / tg["windup"]
                if key not in got and 0.4 <= fr <= 0.8 and b["introT"] <= 0 and (b["attack"] == "legStomp" or len(got) < 1):
                    s.release_all()
                    s.bt_call("freeze", True)
                    time.sleep(0.35)
                    self.shot("boss_%s_%s" % (tag, key), frac=round(fr, 2), tag=tg["tag"], style=tg["style"], d=round(d))
                    s.bt_call("freeze", False)
                    got.add(key)
                    break
            time.sleep(0.07)
        s.release_all()
        log("    captured: %s" % sorted(got))

    def boss(self, titan, biome, tag):
        log("== boss %s (%s / %s)" % (tag, titan, biome))
        self.run(titan, biome, 304)
        self.keep_play()
        s = self.s
        s.cheat("god", True)
        s.cheat("noSpawns", True)
        s.cheat("killAll")
        set_rank(s, 4, log)
        time.sleep(2.5)
        s.cheat("boss")
        t_boss = time.time()
        intro = False
        got = set()
        leash_shot = False
        phase_target = 1
        phase_t = time.time()
        mode_t = time.time()
        toward = True
        while time.time() - t_boss < 150:
            scr = s.screen()
            if scr == "end":
                break
            if scr != "play":
                s.release_all()
                self.keep_play()
                continue
            o = self.w()
            if not o or not o.get("boss"):
                time.sleep(0.2)
                continue
            b, T = o["boss"], o["T"]
            if not intro and time.time() - t_boss > 2.2:
                self.shot("boss_%s_intro" % tag)
                intro = True
            # phase control: stay ~35 s per phase, then drop hp below the threshold
            if time.time() - phase_t > 38 and phase_target < 3:
                phase_target += 1
                frac = 0.6 if phase_target == 2 else 0.3
                s.safe_js("(f) => { const b = window.__H_W__().boss; if (b.hp > b.maxHp * f) b.hp = b.maxHp * f; }", frac)
                phase_t = time.time()
                time.sleep(0.9)
                self.shot("boss_%s_phase%d_alert" % (tag, phase_target))
            elif phase_target == 3 and time.time() - phase_t > 40:
                break
            # alternate closing in and backing off so distance-gated attacks come up
            if time.time() - mode_t > 5.0:
                toward = not toward
                mode_t = time.time()
            dx, dz = b["x"] - T["x"], b["z"] - T["z"]
            d = math.hypot(dx, dz) or 1
            if not toward:
                dx, dz = -dx, -dz
            elif d < 70:
                dx, dz = -dz, dx
            s.hold(world_to_keys(dx, dz) or {"KeyW"})
            if T["leash"] > 0 and not leash_shot:
                s.release_all()
                s.bt_call("freeze", True)
                time.sleep(0.35)
                self.shot("boss_%s_P%d_leash_cable" % (tag, b["phase"]))
                s.bt_call("freeze", False)
                leash_shot = True
            for tg in o["tgs"]:
                if tg["owner"] != "boss" or not tg["windup"]:
                    continue
                key = "P%d_%s" % (b["phase"], b["attack"] or tg["tag"])
                fr = tg["t"] / tg["windup"]
                if key not in got and 0.4 <= fr <= 0.8 and b["introT"] <= 0:
                    s.release_all()
                    s.bt_call("freeze", True)
                    time.sleep(0.35)
                    self.shot("boss_%s_%s" % (tag, key), frac=round(fr, 2), tag=tg["tag"], style=tg["style"], attack=b["attack"], d=round(d))
                    s.bt_call("freeze", False)
                    got.add(key)
                    break
            time.sleep(0.07)
        s.release_all()
        log("    captured: %s" % sorted(got))

    def menus(self):
        log("== pause / settings / draft")
        self.run("briarwick", "whitestacks", 305)
        self.keep_play()
        s = self.s
        s.cheat("god", True)
        time.sleep(1.5)
        s.press("Escape")
        time.sleep(1.0)
        self.shot("pause")
        # navigate to SETTINGS (second item) with real keys
        s.press("ArrowDown")
        time.sleep(0.3)
        s.press("Enter")
        time.sleep(1.0)
        self.shot("settings")
        s.press("Escape")
        time.sleep(0.6)
        s.press("Escape")
        time.sleep(0.8)
        self.keep_play()
        set_rank(s, 2, log)
        time.sleep(2.0)
        s.cheat("xp", 400)
        ok, _ = s.wait_screen("draft", 6)
        time.sleep(1.4)
        self.shot("draft_whitestacks")

    def massbreach(self):
        log("== MASS BREACH mid-sting, lockwater")
        self.run("voltkite", "lockwater", 306)
        self.keep_play()
        s = self.s
        s.cheat("god", True)
        time.sleep(1.2)
        s.cheat("rank", 1)
        for k in range(4):
            time.sleep(0.25)
            self.shot("massbreach_II_lw_%d" % k)
        self.keep_play()
        time.sleep(2)
        s.cheat("rank", 4)
        for k in range(4):
            time.sleep(0.25)
            self.shot("massbreach_V_lw_%d" % k)

    def tabloids(self):
        s = self.s
        log("== tabloid clear (molo / grideast)")
        self.run("molo", "grideast", 307)
        self.keep_play()
        s.cheat("god", True)
        s.cheat("noSpawns", True)
        s.cheat("killAll")
        set_rank(s, 4, log)
        time.sleep(2)
        s.cheat("boss")
        time.sleep(6)
        t0 = time.time()
        while time.time() - t0 < 60:
            scr = s.screen()
            if scr == "end":
                break
            if scr != "play":
                s.release_all()
                self.keep_play()
                continue
            o = self.w()
            if o and o.get("boss"):
                b, T = o["boss"], o["T"]
                s.safe_js("() => { const b = window.__H_W__().boss; if (b && b.introT <= 0 && b.hp > 50) b.hp = 50; }")
                s.hold(world_to_keys(b["x"] - T["x"], b["z"] - T["z"]) or {"KeyW"})
                s.press("Space")
            time.sleep(0.2)
        s.release_all()
        ok, _ = s.wait_screen("end", 20)
        time.sleep(4.0)
        self.shot("tabloid_clear", ended=ok)
        log("== tabloid dead (hearthback / lockwater)")
        self.run("hearthback", "lockwater", 308)
        self.keep_play()
        s.cheat("god", False)
        set_rank(s, 1, log)
        time.sleep(2)
        s.cheat("spawn", "tank", 8)
        s.cheat("spawn", "walker", 3)
        t0 = time.time()
        while time.time() - t0 < 50:
            scr = s.screen()
            if scr == "end":
                break
            if scr == "draft":
                s.press("Digit1")
                time.sleep(0.5)
                continue
            s.safe_js("() => { const T = window.__H_W__().titan; if (T.hp > 5) T.hp = 5; }")
            time.sleep(0.4)
        if s.screen() != "end":
            s.safe_js("() => { const T = window.__H_W__().titan; T.hp = 0; T.alive = false; }")
        ok, _ = s.wait_screen("end", 20)
        time.sleep(4.0)
        self.shot("tabloid_dead", ended=ok)

    def biomes(self):
        s = self.s
        for titan, biome, rank, name in (("molo", "lockwater", 0, "lw_I"), ("briarwick", "lockwater", 4, "lw_V"),
                                         ("voltkite", "whitestacks", 2, "ws_III"), ("molo", "grideast", 3, "ge_IV")):
            log("== biome %s" % name)
            self.run(titan, biome, 309)
            self.keep_play()
            s.cheat("god", True)
            if rank:
                set_rank(s, rank, log)
            time.sleep(1.0)
            s.hold({"KeyW"})
            time.sleep(1.5)
            s.release_all()
            time.sleep(2.5)
            self.keep_play()
            self.shot("biome_%s" % name)


def main():
    ap = argparse.ArgumentParser()
    add_common_args(ap)
    ap.add_argument("--only", default="alert,pancake,enemies,boss_c4,boss_ig,menus,massbreach,tabloids,biomes")
    a = ap.parse_args()
    a.no_serve = True
    sess = Session(a, "critic")
    sess.start()
    c = C(sess, a)
    try:
        for part in a.only.split(","):
            try:
                if part == "boss_c4":
                    c.boss("molo", "grideast", "c4ge")
                elif part == "boss_c4lw":
                    c.boss("voltkite", "lockwater", "c4lw")
                elif part == "pancake3":
                    c.pancake3()
                elif part == "stomp_lw":
                    c.stomp("voltkite", "lockwater", "c4lw")
                elif part == "boss_ig":
                    c.boss("briarwick", "whitestacks", "igws")
                else:
                    getattr(c, part)()
            except Exception as e:
                log("!! %s failed: %s" % (part, str(e).splitlines()[0][:300]))
                sess.release_all()
    finally:
        d = sess.diagnostics()
        sess.close()
        with open(os.path.join(OUT, "manifest_%s.json" % a.only.replace(",", "_")[:60]), "w") as f:
            json.dump({"shots": c.manifest, "diag": d, "log": LOG}, f, indent=1, default=str)
        print("diag errors:", len(d.get("consoleErrors", [])), len(d.get("pageErrors", [])))


if __name__ == "__main__":
    main()
