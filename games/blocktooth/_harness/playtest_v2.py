#!/usr/bin/env python
"""BLOCKTOOTH v2 real-input playtest — FEATURES_V2 §15.4 (written by the orchestrator after C3).

    python _harness/playtest_v2.py                       # headed Chrome, molo / grideast, all 11 steps
    python _harness/playtest_v2.py --titan voltkite --biome lockwater --seed 7
    python _harness/playtest_v2.py --steps 1,2,5        # a subset (debugging only; the gate runs all)

Cheats (`?dev=1`) only SET UP state (UPROAR charge, a power-up / objective ahead, XP for a draft, the
clear). Every acceptance action is a REAL key (page.keyboard), a real walk (WASD steered through
common.world_to_keys) or a pad button read by the game through `navigator.getGamepads()`: the harness
injects a standard-mapping pad stub BEFORE load (init script) and flips its buttons; the game polls it
like a real controller. State is read from `__BT__.state().v2` / `.v2dom` (§13.3).

Steps (§15.4):
  1  title G → goals, Esc → title; select G → goals, Esc → same step + titan
  2  cheat.ult(100); real E → v2.ult.fired ≥ 1 and the sim advances ≥ 60 ticks after
  3  cheat.powerup('rushHour') 3 H ahead; walk in → v2.tally.powerups.rushHour + 1 (≤ 6 s)
  4  cheat.objective('reliefDepot', 3 H); walk in → v2.map.reliefsDone + 1;
     cheat.objective('overloadSite', 2 H) at Size I; walk + Space → v2.map.overloadsDone + 1 (≤ 15 s)
  5  level-up draft; real X → banishLeft − 1 and the offer changed; real C → locked set; pick with 1
  6  clear (cheat.endless(false): the tabloid does NOT auto-pick) → real K → v2.endless set,
     run.phase 'endless', the sim advances
  7  profile persistence: FIRST BROADCAST met by the finished run (fresh browser context = 0 runs =
     one short), location.reload(), v2.profile.done still has g_first_broadcast
  8  HUD DOM vs state: barSlots, badges (§4.2 / §4.3), activeCdText, meterPct
  9  gamepad: pad Y in play → ult.fired + 1; draft hold Y 0.6 s → banish, tap Y → none, LB → lock;
     pad X on the title → goals
 10  settings Opening OFF / SHORT / Reduce motion  (needs the C4 cinematic; PENDING until it lands)
 11  cinematic dismissed by a real key + zebra check   (needs the C4 cinematic; PENDING until it lands)

A PENDING step is neither PASS nor FAIL: the result line says so, and the run is `PASS (steps 1-9)`
only; `ALL 11 PASS` needs 10 and 11 to pass too. Exit: 0 = every non-pending step passed · 1 = a
step failed · 2 = could not start. `--require-all` turns PENDING into a failure (final battery, C4+).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (BIOMES, SHOTS, TITANS, TITAN_NAMES, HarnessError, Session, add_common_args,  # noqa: E402
                    build_url, detect_focus, diag_problems, dismiss_slate, menus_to_slate, navigate_cards,
                    owned_total, print_diagnostics, save_report, world_to_keys, xp_to_next)

# Standard-mapping gamepad stub, installed before any page script runs. The game polls it through
# navigator.getGamepads() exactly like a real pad; the harness flips buttons with __HPAD_SET__.
PAD_JS = r"""
(() => {
  if (window.__HPAD__) return;
  const mk = () => ({ pressed: false, touched: false, value: 0 });
  const pad = { id: 'BLOCKTOOTH harness pad (STANDARD GAMEPAD Vendor: 045e Product: 02ea)', index: 0,
                connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0],
                buttons: Array.from({ length: 17 }, mk), vibrationActuator: null, hapticActuators: [] };
  window.__HPAD__ = pad;
  const list = () => [pad, null, null, null];
  try { Object.defineProperty(Navigator.prototype, 'getGamepads', { configurable: true, writable: true, value: list }); } catch (_) {}
  try { Object.defineProperty(navigator, 'getGamepads', { configurable: true, writable: true, value: list }); } catch (_) {}
  window.__HPAD_SET__ = (i, down) => {
    const b = pad.buttons[i]; b.pressed = !!down; b.touched = !!down; b.value = down ? 1 : 0;
    pad.timestamp = performance.now();
    return navigator.getGamepads()[0].buttons[i].pressed;
  };
})();
"""
PAD_A, PAD_B, PAD_X, PAD_Y, PAD_LB = 0, 1, 2, 3, 4

# Read-only: titan pose + v2 objects (for steering).
POSE_JS = r"""
() => {
  const W = window.__H_W__ && window.__H_W__();
  if (!W || !W.titan) return null;
  const T = W.titan;
  return { x: T.x, z: T.z, heading: T.heading, height: T.height, radius: T.radius, rank: T.rank,
           abilityCd: T.abilityCd, alive: T.alive, tick: W.tick };
}
"""

# Read-only defs for the §4.2 / §4.3 rule check, straight from the module the game itself loaded.
DEFS_JS = r"""
async (ids) => {
  const m = await import('/src/data/upgrades.ts');
  const by = m.UPGRADE_BY_ID || {};
  const out = {};
  for (const id of ids) {
    const u = by[id];
    if (!u) { out[id] = null; continue; }
    out[id] = { maxStacks: u.maxStacks, evo: !!u.evo, perk: !!u.perk, rarity: u.rarity,
                trigger: (u.effects || []).some((e) => !!(e && e.trigger)) };
  }
  return out;
}
"""

HUD_JS = r"""
() => {
  const W = window.__H_W__ && window.__H_W__();
  const s = window.__BT__.state();
  return { order: W ? W.upgrades.order.slice() : [], owned: s.owned, abilityCd: s.abilityCd,
           charge: s.v2 && s.v2.ult ? s.v2.ult.charge : null, dom: s.v2dom, screen: s.screen };
}
"""


def bar_expect(order, owned, defs):
    """§4.2 slots + §4.3 badges (Python mirror of the spec text, not of the game's code)."""
    L = []
    for i in order:
        if (owned.get(i) or 0) <= 0 or i in L:
            continue
        d = defs.get(i)
        if not d or d.get("perk"):
            continue
        L.append(i)

    def badge(i):
        d, n = defs[i], owned.get(i) or 0
        if d["evo"]:
            return "EVO"
        if n >= d["maxStacks"]:
            return "MAX"
        return "L%d" % n if n >= 2 else ""

    def score(i):
        d, n = defs[i], owned.get(i) or 0
        s = 0
        if d["evo"]:
            s += 1000
        elif d["rarity"] == "legendary":
            s += 500
        elif d["rarity"] == "epic":
            s += 300
        elif d["trigger"]:
            s += 200
        elif d["rarity"] == "rare":
            s += 100
        if n >= d["maxStacks"]:
            s += 50
        return s + 10 * n

    if len(L) <= 10:
        shown = L
    else:
        ranked = sorted(range(len(L)), key=lambda k: (-score(L[k]), k))[:9]
        shown = [L[k] for k in sorted(ranked)]
    badges = [b for b in (badge(i) for i in shown) if b]
    return min(10, len(L)), badges, L


class V2Playtest:
    def __init__(self, args):
        self.args = args
        self.sess = None
        self.results = {}          # step -> (status, detail)   status: PASS | FAIL | PENDING
        self.sub = {}              # step -> list of (ok, text)
        self.shots = []
        self.log_lines = []
        self.url = build_url(args.base, dev=1, seed=args.seed, quality=args.quality)
        self.shot_dir = os.path.join(args.out_dir, "playtest_v2")

    # ── plumbing ──
    def log(self, msg):
        line = "[v2] %s" % msg
        self.log_lines.append(line)
        print(line, flush=True)

    def check(self, step, ok, text):
        self.sub.setdefault(step, []).append((bool(ok), text))
        self.log("  step %s: [%s] %s" % (step, "ok" if ok else "FAIL", text))
        return bool(ok)

    def st(self):
        s = self.sess.state()
        return s if isinstance(s, dict) else {}

    def v2(self):
        return self.st().get("v2") or {}

    def snap(self, name):
        p = os.path.join(self.shot_dir, "%s.png" % name)
        if self.sess.screenshot(p):
            self.shots.append(p)
            self.log("  shot %s" % p)

    def cheat(self, name, *a):
        ok, v = self.sess.cheat(name, *a)
        if not ok:
            raise HarnessError("cheat.%s%r failed: %s" % (name, a, v))
        return v

    def pad(self, i, down):
        return self.sess.js("([i, d]) => window.__HPAD_SET__(i, d)", [i, bool(down)])

    def pad_press(self, i, hold_s=0.12):
        self.pad(i, True)
        time.sleep(hold_s)
        self.pad(i, False)

    def wait(self, pred, timeout_s, poll=0.1):
        deadline = time.time() + timeout_s
        last = None
        while time.time() < deadline:
            last = self.st()
            try:
                if pred(last):
                    return True, last
            except Exception:
                pass
            time.sleep(poll)
        return False, last

    def pose(self):
        return self.sess.safe_js(POSE_JS)

    def to_play(self, timeout_s=15):
        """Back to `play` with real keys only if a draft is open (pick 1) — used between steps."""
        deadline = time.time() + timeout_s
        while time.time() < deadline:
            scr = self.sess.screen()
            if scr == "play":
                return True
            self.sess.release_all()
            if scr == "draft":
                time.sleep(0.5)
                self.sess.press("Digit1")
                time.sleep(0.8)
            elif scr == "pause":
                self.sess.press("Escape")
                time.sleep(0.6)
            else:
                time.sleep(0.3)
        return self.sess.screen() == "play"

    def walk_to(self, target, done, timeout_s, attack=False, tag=""):
        """Steer with real WASD toward target() (x, z) until done(state) or timeout. Space every
        0.6 s when attack. Returns (ok, seconds, last_state)."""
        t0 = time.time()
        last_space = 0.0
        last = None
        drafts = 0
        while time.time() - t0 < timeout_s:
            last = self.st()
            if done(last):
                self.sess.release_all()
                return True, time.time() - t0, last
            scr = last.get("screen")
            if scr == "draft":                        # a level-up popped mid-walk: take card 1, carry on
                self.sess.release_all()
                time.sleep(0.5)
                self.sess.press("Digit1")
                drafts += 1
                time.sleep(0.8)
                continue
            if scr != "play":
                self.sess.release_all()
                time.sleep(0.15)
                continue
            P = self.pose()
            tg = target(last)
            if not P or tg is None:
                self.sess.release_all()
                time.sleep(0.1)
                continue
            dx, dz = tg[0] - P["x"], tg[1] - P["z"]
            keys = world_to_keys(dx, dz) or {"KeyW"}
            self.sess.hold(keys)
            now = time.time()
            if attack and now - last_space > 0.6:
                self.sess.press("Space", 50)
                last_space = now
            time.sleep(0.08)
        self.sess.release_all()
        return False, time.time() - t0, last

    # ── steps ──
    def step1_and_pad_title(self):
        s = self.sess
        ok, scr = s.wait_screen("title", 60)
        if not self.check(1, ok, "title screen up (screen=%s)" % scr):
            return False
        time.sleep(1.0)
        # §9 part: pad X on the title → goals (done first, while the title is fresh)
        self.pad_press(PAD_X)
        okp, scr = s.wait_screen("goals", 5)
        self.check(9, okp, "pad X on the title → goals (screen=%s)" % scr)
        if okp:
            time.sleep(0.6)
            s.press("Escape")
            ok_back, scr = s.wait_screen("title", 5)
            self.check(9, ok_back, "Esc from goals → title (screen=%s)" % scr)
            time.sleep(0.8)
        # step 1: real G on the title
        s.press("KeyG")
        ok, scr = s.wait_screen("goals", 5)
        self.check(1, ok, "title: real G → goals (screen=%s)" % scr)
        if ok:
            time.sleep(0.8)
            self.snap("goals_screen")
            s.press("Escape")
        ok, scr = s.wait_screen("title", 5)
        self.check(1, ok, "goals: real Esc → title (screen=%s)" % scr)
        time.sleep(0.8)
        # select: move to the 2nd titan so "same titan" is a real check
        s.press("Enter")
        ok, scr = s.wait_screen("select", 8)
        if not self.check(1, ok, "title: Enter → select (screen=%s)" % scr):
            return False
        time.sleep(1.4)
        names = [TITAN_NAMES[t].upper() for t in TITANS]
        navigate_cards(s, TITANS, TITAN_NAMES, TITANS[1], log=self.log)
        time.sleep(0.4)
        f0, how0 = detect_focus(s, names)
        s.press("KeyG")
        ok, scr = s.wait_screen("goals", 5)
        self.check(1, ok, "select: real G → goals (screen=%s)" % scr)
        time.sleep(0.8)
        s.press("Escape")
        ok, scr = s.wait_screen("select", 5)
        self.check(1, ok, "goals: real Esc → select (screen=%s)" % scr)
        time.sleep(1.2)
        f1, how1 = detect_focus(s, names)
        self.check(1, f0 is not None and f0 == f1,
                   "same step + titan after goals: before %s (%s) · after %s (%s)" % (f0, how0.get("how"), f1, how1.get("how")))
        return True

    def enter_run(self):
        ok, nav = menus_to_slate(self.sess, self.args.titan, self.args.biome, log=self.log, timeout_s=90)
        if not ok:
            raise HarnessError("menus → slate failed: %s" % nav.get("error"))
        ok, scr = dismiss_slate(self.sess, 25, "Enter")
        if not ok:
            raise HarnessError("slate did not give way to play (screen=%s)" % scr)
        self.cheat("god", True)
        time.sleep(1.2)

    def step2(self):
        u0 = (self.v2().get("ult") or {})
        self.cheat("ult", 100)
        time.sleep(0.4)
        u = self.v2().get("ult") or {}
        self.log("  ult before E: %s" % json.dumps(u))
        f0 = int(u.get("fired") or 0)
        self.sess.press("KeyE", 90)
        ok, s = self.wait(lambda s: int(((s.get("v2") or {}).get("ult") or {}).get("fired") or 0) >= max(1, f0 + 1), 3.0)
        u1 = ((s or {}).get("v2") or {}).get("ult") or {}
        self.check(2, ok, "real E → v2.ult.fired %s → %s (phase %s)" % (f0, u1.get("fired"), u1.get("phase")))
        t0 = int(self.st().get("tick") or 0)
        c0 = time.time()
        ok, s = self.wait(lambda q: int(q.get("tick") or 0) - t0 >= 60, 6.0, poll=0.1)
        t1 = int(s.get("tick") or 0)
        self.check(2, ok, "sim advanced %d ticks in %.1f s after the fire (≥ 60 within 6 s)" % (t1 - t0, time.time() - c0))
        del u0

    def step3(self):
        v = self.v2()
        n0 = int(((v.get("tally") or {}).get("powerups") or {}).get("rushHour") or 0)
        pid = self.cheat("powerup", "rushHour")
        if not self.check(3, pid is not None, "cheat.powerup('rushHour') placed id %s" % pid):
            return

        def target(s):
            for p in ((s.get("v2") or {}).get("powerups") or []):
                if p.get("id") == pid:
                    return (p["x"], p["z"])
            return None

        def done(s):
            return int((((s.get("v2") or {}).get("tally") or {}).get("powerups") or {}).get("rushHour") or 0) > n0

        ok, secs, last = self.walk_to(target, done, 6.0)
        n1 = int((((last or {}).get("v2") or {}).get("tally") or {}).get("powerups", {}).get("rushHour") or 0)
        self.check(3, ok, "walked in with real keys: tally.powerups.rushHour %d → %d in %.1f s (limit 6 s)" % (n0, n1, secs))

    def step4(self):
        P = self.pose() or {}
        H = float(P.get("height") or 1.5)
        m0 = (self.v2().get("map") or {})
        r0 = int(m0.get("reliefsDone") or 0)
        oid = self.cheat("objective", "reliefDepot", 3 * H)
        if self.check(4, oid is not None, "cheat.objective('reliefDepot', 3 H = %.1f m) placed id %s" % (3 * H, oid)):
            def target(s):
                for o in ((s.get("v2") or {}).get("objectives") or []):
                    if o.get("id") == oid:
                        return (o["x"], o["z"])
                return None
            ok, secs, last = self.walk_to(target, lambda s: int(((s.get("v2") or {}).get("map") or {}).get("reliefsDone") or 0) > r0, 10.0)
            r1 = int((((last or {}).get("v2") or {}).get("map") or {}).get("reliefsDone") or 0)
            self.check(4, ok, "RELIEF DEPOT walked in: map.reliefsDone %d → %d in %.1f s" % (r0, r1, secs))
            ring = self.sess.safe_js("(id) => (window.__BT__.events(512) || []).filter((e) => e.type === 'objectiveDone' && e.id === id).length",
                                     oid, default=0) or 0
            cnt = int(self.sess.event_counts().get("objectiveDone", 0))
            self.check(4, ring >= 1 or cnt >= 1, "objectiveDone event for id %s seen (event ring %d · collector %d)" % (oid, ring, cnt))
        rank = int(self.st().get("rank") or 0)
        o0 = int((self.v2().get("map") or {}).get("overloadsDone") or 0)
        if not self.check(4, rank == 0, "titan still at Size I for the prop OVERLOAD SITE (rank %d)" % rank):
            return
        P = self.pose() or {}
        H = float(P.get("height") or 1.5)
        oid = self.cheat("objective", "overloadSite", 2 * H)
        if not self.check(4, oid is not None, "cheat.objective('overloadSite', 2 H = %.1f m) placed id %s" % (2 * H, oid)):
            return
        obj = next((o for o in (self.v2().get("objectives") or []) if o.get("id") == oid), {})
        P = self.pose() or {}
        self.log("  overload site: target %s #%s at %.1f m" % (obj.get("target"), obj.get("targetId"),
                                                                math.hypot(obj.get("x", 0) - P.get("x", 0), obj.get("z", 0) - P.get("z", 0))))

        def target(s):
            for o in ((s.get("v2") or {}).get("objectives") or []):
                if o.get("id") == oid:
                    return (o["x"], o["z"])
            return (obj.get("x"), obj.get("z")) if obj else None

        ok, secs, last = self.walk_to(target, lambda s: int(((s.get("v2") or {}).get("map") or {}).get("overloadsDone") or 0) > o0,
                                      15.0, attack=True)
        o1 = int((((last or {}).get("v2") or {}).get("map") or {}).get("overloadsDone") or 0)
        self.check(4, ok, "OVERLOAD SITE walked into with W + Space: map.overloadsDone %d → %d in %.1f s (limit 15 s)" % (o0, o1, secs))

    def open_draft(self, tag):
        """Cheat XP for exactly one level-up; wait for the draft screen. Returns (ok, state)."""
        self.to_play()
        s = self.st()
        need = xp_to_next(int(s.get("level") or 1)) - float(s.get("xp") or 0) + 0.5
        self.cheat("xp", max(1.0, need))
        ok, s = self.wait(lambda s: s.get("screen") == "draft", 6.0)
        self.log("  %s: draft open=%s offer=%s" % (tag, ok, ((s or {}).get("drafts") or {}).get("offer")))
        time.sleep(1.0)                                   # reveal + DRAFT_V2.banishArmS (0.6 s)
        return ok, self.st()

    def step5(self):
        ok, s = self.open_draft("step 5")
        if not self.check(5, ok, "level-up draft opened (screen=%s)" % s.get("screen")):
            return
        d0 = (s.get("v2") or {}).get("draft") or {}
        off0 = (s.get("drafts") or {}).get("offer")
        self.sess.press("KeyX")
        ok, s1 = self.wait(lambda q: int(((q.get("v2") or {}).get("draft") or {}).get("banishLeft", 99)) < int(d0.get("banishLeft", 0))
                           and q.get("screen") == "draft", 4.0)
        d1 = (s1.get("v2") or {}).get("draft") or {}
        off1 = (s1.get("drafts") or {}).get("offer")
        self.check(5, ok and off1 != off0, "real X → banishLeft %s → %s; offer %s → %s" % (
            d0.get("banishLeft"), d1.get("banishLeft"), off0, off1))
        time.sleep(0.9)
        self.sess.press("KeyC")
        ok, s2 = self.wait(lambda q: bool(((q.get("v2") or {}).get("draft") or {}).get("locked")) and q.get("screen") == "draft", 4.0)
        d2 = (s2.get("v2") or {}).get("draft") or {}
        self.check(5, ok, "real C → draft.locked = %s (lockLeft %s → %s)" % (d2.get("locked"), d1.get("lockLeft"), d2.get("lockLeft")))
        time.sleep(0.9)
        self.snap("draft_banish_lock")
        before = owned_total(s2.get("owned"))
        self.sess.press("Digit1")
        ok, s3 = self.wait(lambda q: owned_total(q.get("owned")) > before, 4.0)
        self.check(5, ok, "real 1 picks: owned %d → %d (screen %s)" % (before, owned_total(s3.get("owned")), s3.get("screen")))
        self.to_play()

    def step8(self):
        self.to_play()
        # give the bar something to badge: a maxed base (MAX) and a multi-stack card
        try:
            self.cheat("evolveReady", self.args.evo)
        except HarnessError as e:
            self.log("  evolveReady skipped: %s" % e)
        time.sleep(1.2)
        h = self.sess.js(HUD_JS)
        ids = sorted(set(h["order"]) | set((h.get("owned") or {}).keys()))
        defs = self.sess.js(DEFS_JS, ids)
        missing = [i for i in ids if not defs.get(i)]
        slots, badges, L = bar_expect(h["order"], h.get("owned") or {}, {k: v for k, v in defs.items() if v})
        dom = h.get("dom") or {}
        self.check(8, not missing, "every owned id has a card def (%d ids%s)" % (len(ids), "; missing %s" % missing if missing else ""))
        self.check(8, dom.get("barSlots") == slots, "v2dom.barSlots %s == min(10, owned non-perk %d) = %d" % (dom.get("barSlots"), len(L), slots))
        self.check(8, list(dom.get("barBadges") or []) == badges, "v2dom.barBadges %s == §4.3 rule %s" % (dom.get("barBadges"), badges))
        # ACTIVE cd text + meter: sample several frames (DOM and sim read in one call)
        cd_ok = meter_ok = 0
        cd_close = meter_close = True
        rows = []
        for i in range(8):
            if i == 3:
                self.sess.press("Space", 50)          # put the hook on cooldown so a number shows
            if i == 5:
                self.cheat("ult", 37)
            time.sleep(0.35)
            h = self.sess.js(HUD_JS)
            dom = h.get("dom") or {}
            cd = float(h.get("abilityCd") or 0)
            want = "READY" if cd <= 0 else "%ds" % math.ceil(cd)
            got = dom.get("activeCdText") or ""
            if got == want:
                cd_ok += 1
            else:
                try:
                    gv = 0 if got == "READY" else int(got.rstrip("s"))
                    if abs(gv - (0 if cd <= 0 else math.ceil(cd))) > 1:
                        cd_close = False
                except ValueError:
                    cd_close = False
            ch = h.get("charge")
            mp = dom.get("meterPct")
            if ch is not None and isinstance(mp, (int, float)):
                if abs(mp - round(ch)) <= 1:
                    meter_ok += 1
                else:
                    meter_close = False
            rows.append("cd %.2f→%r/%r · charge %s→%s" % (cd, got, want, None if ch is None else round(ch, 1), mp))
        self.log("  samples: " + " | ".join(rows))
        self.check(8, cd_close and cd_ok >= 6, "activeCdText matches ceil(abilityCd)+'s' / READY in %d/8 samples (others within 1 frame: %s)" % (cd_ok, cd_close))
        self.check(8, meter_close and meter_ok == 8, "meterPct == round(v2.ult.charge) ± 1 in %d/8 samples" % meter_ok)
        self.snap("abilitybar_%d" % self.args.width)

    def step9_play_and_draft(self):
        self.to_play()
        ok, s = self.wait(lambda q: ((q.get("v2") or {}).get("ult") or {}).get("phase") == "idle", 12.0)
        self.cheat("ult", 100)
        ok, s = self.wait(lambda q: bool(((q.get("v2") or {}).get("ult") or {}).get("ready")), 8.0)
        u = (s.get("v2") or {}).get("ult") or {}
        f0 = int(u.get("fired") or 0)
        self.log("  ult before pad Y: %s" % json.dumps(u))
        self.pad_press(PAD_Y, 0.15)
        ok, s = self.wait(lambda q: int(((q.get("v2") or {}).get("ult") or {}).get("fired") or 0) >= f0 + 1, 3.0)
        self.check(9, ok, "pad Y in play → ult.fired %d → %s" % (f0, ((s.get("v2") or {}).get("ult") or {}).get("fired")))
        time.sleep(2.5)
        ok, s = self.open_draft("step 9")
        if not self.check(9, ok, "draft opened for the pad checks"):
            return
        d0 = (s.get("v2") or {}).get("draft") or {}
        # tap Y (0.12 s < DRAFT_V2.banishHoldS 0.5 s) → no banish
        self.pad_press(PAD_Y, 0.12)
        time.sleep(1.0)
        d1 = (self.v2().get("draft") or {})
        self.check(9, d1.get("banishLeft") == d0.get("banishLeft") and self.sess.screen() == "draft",
                   "tap Y → no banish (banishLeft %s → %s)" % (d0.get("banishLeft"), d1.get("banishLeft")))
        # hold Y 0.6 s → banish
        self.pad_press(PAD_Y, 0.6)
        ok, s2 = self.wait(lambda q: int(((q.get("v2") or {}).get("draft") or {}).get("banishLeft", 99)) < int(d1.get("banishLeft", 0)), 3.0)
        d2 = (s2.get("v2") or {}).get("draft") or {}
        self.check(9, ok, "hold Y 0.6 s → banish (banishLeft %s → %s)" % (d1.get("banishLeft"), d2.get("banishLeft")))
        self.wait(lambda q: q.get("screen") == "draft", 3.0)
        time.sleep(1.0)
        d2 = (self.v2().get("draft") or {})
        want_lock = not d2.get("locked")
        self.pad_press(PAD_LB, 0.12)
        ok, s3 = self.wait(lambda q: (bool(((q.get("v2") or {}).get("draft") or {}).get("locked")) == want_lock), 3.0)
        d3 = (s3.get("v2") or {}).get("draft") or {}
        self.check(9, ok, "LB → lock toggled (locked %s → %s)" % (d2.get("locked"), d3.get("locked")))
        time.sleep(0.8)
        before = owned_total(self.st().get("owned"))
        self.wait(lambda q: q.get("screen") == "draft", 3.0)
        time.sleep(0.5)
        self.pad_press(PAD_A, 0.12)
        ok, s4 = self.wait(lambda q: owned_total(q.get("owned")) > before, 3.0)
        self.log("  pad A picks: owned %d → %d (not a §15.4 check)" % (before, owned_total(s4.get("owned"))))
        self.to_play()

    def step6(self):
        self.to_play()
        v = self.cheat("endless", False)
        self.log("  cheat.endless(false) → boss down: %s" % v)
        ok, s = self.wait(lambda q: q.get("screen") == "end", 40.0, poll=0.25)
        run = s.get("run") or {}
        if not self.check(6, ok and run.get("result") == "clear", "run cleared → tabloid (screen=%s, result=%s, endless=%s)" % (
                s.get("screen"), run.get("result"), (s.get("v2") or {}).get("endless"))):
            return
        time.sleep(2.0)                                   # tabloid armMs 1000 + reveal
        self.snap("tabloid_clear_keepgoing")
        self.sess.press("KeyK")
        ok, s = self.wait(lambda q: (q.get("v2") or {}).get("endless") is not None and (q.get("run") or {}).get("phase") == "endless", 10.0)
        self.check(6, ok, "real K → v2.endless %s, run.phase %s, screen %s" % (
            "set" if (s.get("v2") or {}).get("endless") is not None else None, (s.get("run") or {}).get("phase"), s.get("screen")))
        ok_p, s = self.wait(lambda q: q.get("screen") == "play", 15.0)
        t0 = int(self.st().get("tick") or 0)
        c0 = time.time()
        ok_t, s2 = self.wait(lambda q: int(q.get("tick") or 0) - t0 >= 60, 6.0, poll=0.1)
        t1 = int(s2.get("tick") or 0)
        self.check(6, ok_p and ok_t, "endless play: screen %s, sim advanced %d ticks in %.1f s (≥ 60 within 6 s)" % (
            s.get("screen"), t1 - t0, time.time() - c0))

    def step7(self):
        done0 = (self.v2().get("profile") or {}).get("done") or []
        self.check(7, "g_first_broadcast" in done0, "after the finished run (fresh context: 0 runs = one short) "
                   "v2.profile.done has g_first_broadcast (%d goals done)" % len(done0))
        ls = self.sess.safe_js("() => Object.keys(localStorage).filter((k) => /blocktooth|bt/i.test(k))", default=[])
        self.log("  localStorage keys: %s" % ls)
        self.sess.release_all()
        self.sess.page.reload(wait_until="load")
        if not self.sess.wait_bt(60):
            self.check(7, False, "__BT__ back after reload")
            return
        self.sess.wait_screen(("title", "select"), 60)
        done1 = (self.v2().get("profile") or {}).get("done") or []
        self.check(7, "g_first_broadcast" in done1, "after location.reload(): v2.profile.done has g_first_broadcast (%d goals: %s)" % (
            len(done1), ",".join(sorted(done1))[:200]))

    def cine_available(self):
        """Is the C4 cinematic in? Start a run with ?cine=2 and look for a v2.cine shot."""
        s = self.sess
        url = build_url(self.args.base, dev=1, seed=self.args.seed + 1, cine=2, quality=self.args.quality)
        s.goto(url)
        if not s.wait_bt(60):
            return None, "no __BT__"
        s.wait_screen(("title",), 60)
        s.bt_call("newRun", {"titan": self.args.titan, "biome": self.args.biome, "seed": self.args.seed + 1})
        seen = None
        deadline = time.time() + 6
        scr = None
        while time.time() < deadline:
            st = self.st()
            scr = st.get("screen")
            c = (st.get("v2") or {}).get("cine")
            if c:
                seen = c
                break
            time.sleep(0.1)
        return bool(seen), "screen %s, v2.cine %s" % (scr, seen)

    def steps10_11(self):
        avail, why = self.cine_available()
        if not avail:
            for st in (10, 11):
                self.results[st] = ("PENDING", "C4 cinematic not landed (?cine=2 run: %s)" % why)
                self.log("  step %d: PENDING — C4 cinematic not landed (%s)" % (st, why))
            return
        for st in (10, 11):
            self.check(st, False, "cinematic present but step %d is not written yet — C4/orchestrator must extend playtest_v2" % st)

    # ── driver ──
    def run(self):
        want = set(int(x) for x in self.args.steps.split(",")) if self.args.steps else set(range(1, 12))
        self.sess = Session(self.args, "playtest_v2")
        try:
            self.sess.start()
        except Exception as e:
            self.sess.close()
            print("SETUP FAILED: %s" % e)
            return 2
        fatal = None
        diag = {}
        try:
            self.sess.page.add_init_script(PAD_JS)
            self.log("open %s (pad stub injected before load)" % self.url)
            self.sess.goto(self.url)
            if not self.sess.wait_bt(60):
                raise HarnessError("window.__BT__ never appeared")
            pads = self.sess.js("() => { const p = navigator.getGamepads()[0]; return p ? {id: p.id, mapping: p.mapping, n: p.buttons.length} : null; }")
            self.log("pad stub: %s" % pads)
            plan = [
                (1, self.step1_and_pad_title),
                (0, self.enter_run),
                (2, self.step2), (3, self.step3), (4, self.step4), (5, self.step5), (8, self.step8),
                (9, self.step9_play_and_draft), (6, self.step6), (7, self.step7), (10, self.steps10_11),
            ]
            for st, fn in plan:
                if st and st not in want and not (st == 1 and 9 in want) and not (st == 10 and 11 in want):
                    continue
                self.log("── step %s ──" % (st or "setup: menus → run"))
                try:
                    fn()
                except HarnessError as e:
                    if st == 0:
                        raise
                    self.check(st, False, "harness stop: %s" % str(e)[:300])
                except Exception as e:  # a driver failure is that step's FAIL with its message
                    if st == 0:
                        raise
                    self.check(st, False, "exception: %s" % str(e).splitlines()[0][:300])
                    self.sess.release_all()
        except Exception as e:
            fatal = str(e).splitlines()[0][:300]
            self.log("FATAL: %s" % fatal)
        finally:
            try:
                ev = self.sess.event_counts()
            except Exception:
                ev = {}
            diag = self.sess.diagnostics() if self.sess.page else {}
            self.sess.close()

        for st in range(1, 12):
            if st not in want or st in self.results:
                continue
            subs = self.sub.get(st) or []
            if not subs:
                self.results[st] = ("FAIL", "not reached" + (" (%s)" % fatal if fatal else ""))
            else:
                self.results[st] = ("PASS" if all(ok for ok, _ in subs) else "FAIL",
                                    "; ".join(("" if ok else "✗ ") + t for ok, t in subs))
        dprob = diag_problems(diag)
        print("=" * 78)
        print("PLAYTEST_V2 %s/%s seed %s (%s)" % (self.args.titan, self.args.biome, self.args.seed,
                                                  "headless" if self.args.headless else "headed"))
        print("v2 events: %s" % json.dumps({k: ev[k] for k in sorted(ev) if any(t in str(k).lower() for t in (
            "ult", "objective", "powerup", "power", "banish", "lock", "evol", "endless", "goal"))}))
        print_diagnostics(diag, limit=15)
        for st in sorted(self.results):
            status, detail = self.results[st]
            print("  STEP %2d %-7s %s" % (st, status, detail[:900]))
        print("  diagnostics: %s" % ("clean" if not dprob else ", ".join(dprob)))
        failed = [st for st, (status, _) in self.results.items() if status == "FAIL"]
        pending = [st for st, (status, _) in self.results.items() if status == "PENDING"]
        if fatal:
            failed.append("fatal")
        if dprob:
            failed.append("diagnostics")
        if self.args.require_all and pending:
            failed.extend("pending-%d" % p for p in pending)
        if failed:
            verdict = "FAIL (%s)" % ", ".join(str(f) for f in failed)
        elif pending:
            verdict = "PASS (steps %s) · PENDING %s" % (",".join(str(s) for s in sorted(self.results) if s not in pending),
                                                        ",".join(str(p) for p in pending))
        else:
            verdict = "ALL %d PASS" % len(self.results)
        print("PLAYTEST_V2: %s" % verdict)
        rep = {"titan": self.args.titan, "biome": self.args.biome, "seed": self.args.seed, "url": self.url,
               "results": {str(k): {"status": v[0], "detail": v[1]} for k, v in self.results.items()},
               "sub": {str(k): [[ok, t] for ok, t in v] for k, v in self.sub.items()},
               "verdict": verdict, "fatal": fatal, "events": ev, "diagnostics": diag, "shots": self.shots,
               "log": self.log_lines}
        print("report: %s" % save_report("playtest_v2_%s_%s" % (self.args.titan, self.args.biome), rep,
                                        self.args.base, self.args.report_dir))
        return 1 if failed else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="BLOCKTOOTH v2 real-input playtest (FEATURES_V2 §15.4)")
    add_common_args(ap)
    ap.add_argument("--titan", default="molo", choices=TITANS)
    ap.add_argument("--biome", default="grideast", choices=BIOMES)
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--evo", default="evo_shear_wall_certificate", help="evolution whose recipe step 8 readies (badge coverage)")
    ap.add_argument("--steps", default="", help="comma list of steps (default all 11)")
    ap.add_argument("--require-all", action="store_true", help="PENDING steps count as failures (final battery)")
    ap.add_argument("--out-dir", default=SHOTS)
    args = ap.parse_args()
    return V2Playtest(args).run()


if __name__ == "__main__":
    raise SystemExit(main())
