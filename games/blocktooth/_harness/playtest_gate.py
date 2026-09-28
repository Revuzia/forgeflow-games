#!/usr/bin/env python
"""BLOCKTOOTH GATEKEEPERS real-input playtest — GATEKEEPERS.md §8.3 (orchestrator, after K2).

    python _harness/playtest_gate.py --base http://localhost:5178/        # headed Chrome, molo / grideast, all steps
    python _harness/playtest_gate.py --steps 1,2 --headless              # a subset (debugging only; the gate runs all)

Cheats (`?dev=1`) only SET state (god, XP, levels, gate locks, a boss's HP, the city boss's earliest time).
Every acceptance ACTION is a real key (page.keyboard: WASD / Space / Shift / Enter / K) or a pad button the
game reads through `navigator.getGamepads()` (the standard-mapping stub of playtest_v2.py, installed before
load). The harness reads `__BT__.state()`, `state().gates` and the read-only world handle to steer.

Steps (§8.3):
  1  a run from the title with real keys; XP set 1 point short of LV 7; eat a street prop (real W) →
     `gateLocked` slot 1; the GROW bar reads `SIZE LOCKED — STENCIL-1 EN ROUTE`, then `… BEAT STENCIL-1`;
     the nameplate shows the GATEKEEPER kicker
  2  fight with real keys (god on): after a STRIPE RUN go behind the cart and hit the open drum → SPILL rises;
     cheat gateHp(0.03); a real attack lands the kill → one frame's events hold `gateDefeated` + `rankUp 1`;
     the MASS BREACH banner is visible; titan.rank 1
  2b NO HP cheat: a fresh STENCIL-1 fight from its spawn, god on; real keys only (out of each lane, behind the
     cart during REFILL, attacks on the open drum) until SPILL fills → `bossStagger` (TIPPED OVER); budget
     120 s of game time; SPILL per REFILL window and the time to TIPPED OVER are reported
  3  avoidance: the CORDON-2 lock; real keys away from it for 45 s → gates.pressure ≥ 2; the gatekeeper stays
     within 2.2 × spawnRing (any excursion past it ends with a reposition within repositionS + 1.5 s)
  4  finale: gatesOpen(3) + LV 35 → the city boss spawns; its HP cheat to 1 %; a real attack kills it →
     `finale on`, titan.rank 4, `THE CITY GOT SMALLER.` in the DOM; real Enter after 3 s → the clear tabloid,
     whose TIME equals the kill time
  5  real K on the clear tabloid → EXTENDED COVERAGE at Size V; 75 s later a gatekeeper rematch with the
     `REISSUED · SIZE V` kicker
  6  gamepad (stubbed standard pad): pad A skips a second finale

Exit: 0 = every step passed · 1 = a step failed · 2 = could not start.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (BIOMES, SHOTS, TITANS, HarnessError, Session, add_common_args, build_url,  # noqa: E402
                    diag_problems, dismiss_slate, ensure_play, menus_to_slate, print_diagnostics, save_report,
                    world_to_keys)
from playtest_v2 import PAD_A, PAD_JS  # noqa: E402  (the same standard-mapping pad stub)

STEPS = ["1", "2", "2b", "3", "4", "5", "6"]

# ── read-only probes ──────────────────────────────────────────────────────────────────────────────
GS_JS = r"""
() => {
  const B = window.__BT__; const W = B && B.world; if (!W) return null;
  const T = W.titan, b = W.boss, G = W.gates, E = W.endless;
  const bo = b ? { id: b.id, role: b.role, slot: b.slot, alive: b.alive, x: b.x, z: b.z, heading: b.heading,
    hp: b.hp, maxHp: b.maxHp, introT: b.introT, staggerT: b.staggerT, meter: b.meter, attack: b.attack,
    attackT: b.attackT, phase: b.phase, H: b.data.H, drumOpen: b.data.drumOpen || 0, raceT: b.data.raceT || 0,
    weakMask: b.data.weakMask || 0 } : null;
  return { t: W.t, tick: W.tick, screen: B.state().screen,
    titan: { x: T.x, z: T.z, heading: T.heading, height: T.height, radius: T.radius, rank: T.rank, level: T.level,
             xp: T.xp, xpToNext: T.xpToNext, hp: T.hp, alive: T.alive, dashCharges: T.dashCharges, dashT: T.dashT },
    gates: { unlocked: G.unlocked, pending: G.pending, active: G.active, pressure: G.pressure, ignoredS: G.ignoredS,
             farS: G.farS, finaleT: G.finaleT, finaleDone: G.finaleDone, mainKillT: G.mainKillT, dueT: G.dueT,
             mainEarliestT: G.mainEarliestT, rematchGates: G.rematchGates },
    boss: bo, run: { result: W.run.result, endT: W.run.endT, phase: W.run.phase },
    endless: E ? { nextBossT: E.nextBossT } : null };
}
"""

DOM_JS = r"""
() => {
  const q = (s) => document.querySelector(s);
  const vis = (e) => { if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05; };
  const gl = q('[data-gate="grow-lock"]'); const glt = gl ? gl.querySelector('.bt-gl-t') : null;
  const kick = q('[data-gate="kicker"]'); const layer = q('.bt-bossbar');
  const su = q('.bt-sizeup'); const sut = su ? su.querySelector('.bt-su-title') : null;
  const skip = q('[data-gate="finale-skip"]');
  const txt = document.body ? document.body.innerText : '';
  return { lockVisible: vis(gl), lockText: glt ? glt.textContent : null,
    plateVisible: vis(layer) && !(layer && layer.classList.contains('bt-hidden')),
    kickerVisible: vis(kick), kicker: kick ? kick.textContent : null,
    plateName: q('.bt-boss-name') ? q('.bt-boss-name').textContent : null,
    sizeUpVisible: vis(su) && !(su && su.classList.contains('bt-hidden')), sizeUpTitle: sut ? sut.textContent : null,
    cityGotSmaller: txt.includes('THE CITY GOT SMALLER.'), skipHint: skip ? skip.textContent : null,
    tabTime: (() => { const r = document.querySelector('.bt-np-stat .v'); return r ? r.textContent : null; })(),
    tabHeadline: q('.bt-np-headline') ? q('.bt-np-headline').textContent : null,
    tabStamp: q('.bt-np-stamp') ? q('.bt-np-stamp').textContent : null };
}
"""

# the city-got-smaller banner: the broadcast alert strap is ON (class `on`) and its title is the finale title
BANNER_JS = r"""
() => { const a = document.querySelector('.bt-alert.on'); const t = a && a.querySelector('.bt-alert-title');
  if (!a || !t || (t.textContent || '').trim() !== 'THE CITY GOT SMALLER.') return [];
  const r = a.getBoundingClientRect(); const cs = getComputedStyle(a);
  return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.3
    ? [a.className + ' @' + [r.x | 0, r.y | 0, r.width | 0, r.height | 0].join(',')] : []; }
"""

# frame watcher: every rAF (registered after the game's loop, so it runs after the frame's sim steps) the new
# entries of the __BT__.events ring since the previous frame are one "frame group"; groups holding a watched type
# are kept with the world tick and the last tick's own world.events.
FW_JS = r"""
(types) => {
  const S = window.__PG_FW__ || (window.__PG_FW__ = { loop: false });
  S.on = true; S.types = types; S.frames = []; S.n = 0;
  S.last = (window.__BT__.events(48) || []).map((e) => JSON.stringify(e));
  if (!S.loop) {
    S.loop = true;
    const f = () => {
      if (S.on) {
        S.n++;
        let arr = []; try { arr = window.__BT__.events(48) || []; } catch (_) {}
        const cur = arr.map((e) => JSON.stringify(e));
        const old = S.last; let m = 0;
        for (let k = Math.min(old.length, cur.length); k > 0; k--) {
          let ok = true;
          for (let i = 0; i < k; i++) if (old[old.length - k + i] !== cur[i]) { ok = false; break; }
          if (ok) { m = k; break; }
        }
        const fresh = cur.slice(m).map((s) => JSON.parse(s));
        S.last = cur;
        if (fresh.some((e) => S.types.includes(e.type))) {
          const W = window.__BT__.world;
          S.frames.push({ frame: S.n, tick: W ? W.tick : null, events: fresh,
                          tickEvents: W ? W.events.map((e) => e.type) : [] });
        }
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }
  return true;
}
"""
FW_READ_JS = "() => { const S = window.__PG_FW__; return S ? { n: S.n, frames: S.frames } : null; }"
FW_OFF_JS = "() => { const S = window.__PG_FW__; if (S) S.on = false; return true; }"

# STENCIL-1 / generic gate policy (read-only): where the titan should move (world XZ), whether to dash / press
# Space. Threats first (a live hostile tell the titan stands in), then the open weak point (stand just outside
# it, on its far side from the rig's centre, walking round the rig — never through it), else hold the band edge.
POLICY_JS = r"""
(opts) => {
  const W = window.__BT__.world; if (!W) return null;
  const T = W.titan, b = W.boss;
  const out = { dx: 0, dz: 0, dash: false, space: false, mode: 'idle', d: null, need: 0 };
  if (!b || !b.alive || !T.alive) return out;
  const H = (b.data.H > 0 ? b.data.H : T.height), R = T.radius * 1.25 + 0.3;
  const reach = (opts.reachH || 0.9) * T.height * Math.max(0.5, T.stats.attackRange || 1);
  // ── threats ──
  let sx = 0, sz = 0, cnt = 0, tMin = 9, need = 0;
  const esc = (s) => {
    const x = T.x, z = T.z;
    if (s.k === 'circle') { const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz) || 1e-6; return { x: dx / d, z: dz / d, need: s.r + R - d }; }
    if (s.k === 'ring') { const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz) || 1e-6; const o = s.r1 + R - d, i = s.r0 - R > 0 ? d - (s.r0 - R) : 1e9;
      return i < o ? { x: -dx / d, z: -dz / d, need: i } : { x: dx / d, z: dz / d, need: o }; }
    if (s.k === 'lane') { const fx = Math.sin(s.dir), fz = Math.cos(s.dir), nx = fz, nz = -fx, dx = x - s.x, dz = z - s.z;
      const along = dx * fx + dz * fz, side = dx * nx + dz * nz;
      if (along < -R || along > s.len + R) return { x: 0, z: 0, need: -1 };
      const sg = side >= 0 ? 1 : -1; return { x: nx * sg, z: nz * sg, need: s.w / 2 + R - Math.abs(side) }; }
    if (s.k === 'capsule') { const vx = s.x1 - s.x0, vz = s.z1 - s.z0, L2 = vx * vx + vz * vz;
      const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - s.x0) * vx + (z - s.z0) * vz) / L2)) : 0;
      const cx = s.x0 + vx * t, cz = s.z0 + vz * t; let dx = x - cx, dz = z - cz; let d = Math.hypot(dx, dz);
      if (d < 1e-6) { dx = -vz; dz = vx; d = Math.hypot(dx, dz) || 1; }
      return { x: dx / d, z: dz / d, need: s.r + R - d }; }
    if (s.k === 'cone') { const dx = x - s.x, dz = z - s.z, d = Math.hypot(dx, dz) || 1e-6; const th = Math.atan2(dx, dz);
      let a = th - s.dir; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
      if (Math.abs(a) > s.half + 0.2 || d > s.r + R) return { x: 0, z: 0, need: -1 };
      const sg = a >= 0 ? 1 : -1; return { x: Math.cos(th) * sg, z: -Math.sin(th) * sg, need: d * Math.sin(Math.max(0, s.half - Math.abs(a))) + R }; }
    if (s.k === 'oval') { const fx = Math.sin(s.rot), fz = Math.cos(s.rot), nx = fz, nz = -fx, dx = x - s.x, dz = z - s.z;
      const lz = dx * fx + dz * fz, lx = dx * nx + dz * nz, ax = s.rx + R, az = s.rz + R;
      const q = Math.sqrt((lx / ax) ** 2 + (lz / az) ** 2); if (q >= 1) return { x: 0, z: 0, need: -1 };
      let gx = nx * lx / (ax * ax) + fx * lz / (az * az), gz = nz * lx / (ax * ax) + fz * lz / (az * az); const m = Math.hypot(gx, gz) || 1;
      return { x: gx / m, z: gz / m, need: (1 - q) * Math.min(ax, az) + 0.5 }; }
    return { x: 0, z: 0, need: -1 };
  };
  for (const tg of W.telegraphs) {
    if (!tg.alive || tg.owner === 'titan') continue;
    let tLeft;
    if (!tg.fired) tLeft = tg.windup - tg.t; else if (tg.active > 0 && tg.t < tg.windup + tg.active) tLeft = 0; else continue;
    if (tLeft > 1.6) continue;
    const e = esc(tg.shape); if (!(e.need > 0)) continue;
    const wgt = 1 / (0.15 + Math.max(0, tLeft)); sx += e.x * wgt; sz += e.z * wgt; cnt++;
    if (tLeft < tMin) { tMin = tLeft; need = e.need; }
  }
  const dRig = Math.hypot(T.x - b.x, T.z - b.z);
  out.d = dRig / H;
  if (cnt > 0) {
    const m = Math.hypot(sx, sz) || 1; out.dx = sx / m; out.dz = sz / m; out.mode = 'dodge'; out.need = need;
    const walk = 1.1 * T.height * Math.max(0.3, T.stats.moveSpeed || 1) * Math.max(0, tMin);
    out.dash = opts.dash !== false && T.dashCharges >= 1 && T.dashT <= 0 && need > 0.5 * walk && tMin < 0.7;
    return out;
  }
  if (b.introT > 0) { out.mode = 'intro'; return out; }
  // ── an open weak point: stand just outside it on its far side from the rig centre (walk round, not through) ──
  const mask = b.data.weakMask | 0;
  let p = null, best = 1e9;
  for (let i = 0; i < b.parts.length && i < 31; i++) {
    if (!((mask >>> i) & 1)) continue;
    const q = b.parts[i]; const dd = Math.hypot(q.x - T.x, q.z - T.z) - q.r;
    if (dd < best) { best = dd; p = q; }
  }
  if (!p && opts.chase) {       // no weak point: close on the nearest part (the kill / the city boss)
    for (const q of b.parts) { const dd = Math.hypot(q.x - T.x, q.z - T.z) - q.r; if (dd < best) { best = dd; p = q; } }
    if (p) {
      const dx = p.x - T.x, dz = p.z - T.z, dd = Math.hypot(dx, dz) || 1;
      const gap = dd - p.r - R;
      out.mode = 'chase';
      if (gap > 0.35 * reach) { out.dx = dx / dd; out.dz = dz / dd; }
      out.space = gap < 1.5 * reach + 1;
      return out;
    }
  }
  if (p) {
    let ux = p.x - b.x, uz = p.z - b.z; let m = Math.hypot(ux, uz);
    if (m < 1e-6) { ux = -Math.sin(b.heading); uz = -Math.cos(b.heading); m = 1; }
    ux /= m; uz /= m;
    const gap = Math.min(0.8 * H, Math.max(0.25 * H, 0.5 * reach));
    let tx = p.x + ux * (p.r + gap + R * 0.5), tz = p.z + uz * (p.r + gap + R * 0.5);
    const rx = T.x - b.x, rz = T.z - b.z;
    const along = rx * ux + rz * uz, rStand = Math.hypot(tx - b.x, tz - b.z);
    if (along < 0.25 * rStand) {
      const px = -uz, pz = ux; const side = rx * px + rz * pz >= 0 ? 1 : -1;
      const rr = Math.max(rStand, Math.hypot(rx, rz) * 0.9);
      tx = b.x + (px * side * 0.85 + ux * 0.5) * rr; tz = b.z + (pz * side * 0.85 + uz * 0.5) * rr;
    }
    const dx = tx - T.x, dz = tz - T.z, dd = Math.hypot(dx, dz);
    out.mode = 'weak'; out.weak = p.name;
    if (dd > 0.35) { out.dx = dx / dd; out.dz = dz / dd; }
    const dp = Math.hypot(p.x - T.x, p.z - T.z) - p.r;
    out.space = dp < reach + 0.6;
    return out;
  }
  // ── otherwise: hold near the band's inner edge so the lanes aim at the titan (then the step-out wins) ──
  const want = (opts.holdH || 3.2) * H;
  const dx = b.x - T.x, dz = b.z - T.z, dd = Math.hypot(dx, dz) || 1;
  out.mode = 'hold';
  if (dd > want + 0.6 * H) { out.dx = dx / dd; out.dz = dz / dd; }
  else if (dd < want - 0.8 * H) { out.dx = -dx / dd; out.dz = -dz / dd; }
  out.space = dd < 1.6 * H;
  return out;
}
"""

RING_JS = r"""
async () => { const m = await import('/src/ai/director.ts'); const W = window.__BT__.world; return m.spawnRing(W); }
"""

FMT_JS = r"""
async (sec) => { const m = await import('/src/ui/dom.ts'); return m.fmtTime(sec); }
"""


class GatePlaytest:
    def __init__(self, args):
        self.args = args
        self.sess = None
        self.results = {}
        self.sub = {}
        self.shots = []
        self.log_lines = []
        self.metrics = {}
        self.shot_dir = os.path.join(args.out_dir, "playtest_gate")

    # ── plumbing ──
    def log(self, msg):
        line = "[gate] %s" % msg
        self.log_lines.append(line)
        print(line, flush=True)

    def check(self, step, ok, text):
        self.sub.setdefault(step, []).append((bool(ok), text))
        self.log("  step %s: [%s] %s" % (step, "ok" if ok else "FAIL", text))
        return bool(ok)

    def gs(self):
        g = self.sess.safe_js(GS_JS)
        return g if isinstance(g, dict) else {}

    def dom(self):
        d = self.sess.safe_js(DOM_JS)
        return d if isinstance(d, dict) else {}

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

    def pad_press(self, i, hold_s=0.15):
        self.pad(i, True)
        time.sleep(hold_s)
        self.pad(i, False)

    def fresh_run(self, seed):
        """A fresh run straight into play (URL autostart: setup, not an acceptance action)."""
        s = self.sess
        s.release_all()
        s.goto(build_url(self.args.base, dev=1, noslate=1, autostart=1, titan=self.args.titan, biome=self.args.biome,
                         seed=seed, quality=self.args.quality))
        if not s.wait_bt(90):
            raise HarnessError("__BT__ never appeared")
        ok, scr = s.wait_screen(("play", "slate", "draft"), 90)
        if scr == "slate":
            dismiss_slate(s, 20)
        ok, scr = ensure_play(s, 20)
        if not ok:
            raise HarnessError("fresh run never reached play (screen=%s)" % scr)
        self.cheat("god", True)
        time.sleep(0.8)

    def keep_play(self):
        """Clear a level-up draft / pause with real keys (1 / Esc). Returns the screen."""
        scr = self.sess.screen()
        if scr in ("draft", "pause"):
            self.sess.release_all()
            ensure_play(self.sess, 8)
            scr = self.sess.screen()
        return scr

    def drive(self, pol, hold_space=True):
        """Real keys for one policy sample."""
        s = self.sess
        if pol.get("dx") or pol.get("dz"):
            s.hold(world_to_keys(pol["dx"], pol["dz"]) or set())
        else:
            s.hold(set())
        if pol.get("dash"):
            s.press("ShiftLeft", 50)
        if hold_space and pol.get("space"):
            s.press("Space", 40)

    def xp_to_one_short(self):
        """XP bar set to exactly 1 point short of the next level (a cheat: sets state only)."""
        return self.sess.js("() => { const T = window.__BT__.world.titan; T.xp = Math.max(0, T.xpToNext - 1); "
                            "return { level: T.level, xp: T.xp, xpToNext: T.xpToNext }; }")

    def wait_gate(self, pred, timeout_s, poll=0.1, drafts=True):
        deadline = time.time() + timeout_s
        last = {}
        while time.time() < deadline:
            last = self.gs()
            try:
                if pred(last):
                    return True, last
            except Exception:
                pass
            if drafts and last.get("screen") in ("draft", "pause"):
                self.keep_play()
            time.sleep(poll)
        return False, last

    def lock_and_field(self, level_below, slot, gid, timeout_s=15):
        """Level to one below the gate, XP 1 short, one real-path level-up (cheat.xp(1) through gainXp → grow →
        the lock), the summon delay, the arrival. Returns the gate state at the arrival."""
        self.cheat("level", level_below)
        time.sleep(0.5)
        self.keep_play()
        self.xp_to_one_short()
        self.cheat("xp", 2)
        ok, g = self.wait_gate(lambda q: (q.get("gates") or {}).get("pending") == slot or (q.get("gates") or {}).get("active") == slot, 4)
        if not ok:
            self.log("  XP did not lock slot %d (gates %s) — cheat.gateLock(%d) (the real lockGate path)" % (
                slot, json.dumps(g.get("gates")), slot))
            self.cheat("gateLock", slot)
        ok, g = self.wait_gate(lambda q: (q.get("boss") or {}).get("id") == gid and (q.get("boss") or {}).get("alive"), timeout_s)
        if not ok:
            raise HarnessError("%s never arrived (gates %s)" % (gid, json.dumps(g.get("gates"))))
        return g

    # ── step 1 ──
    def step1(self):
        s = self.sess
        s.goto(build_url(self.args.base, dev=1, seed=self.args.seed, quality=self.args.quality))
        if not s.wait_bt(90):
            raise HarnessError("__BT__ never appeared")
        ok, scr = s.wait_screen("title", 60)
        if not self.check("1", ok, "title screen up (screen=%s)" % scr):
            return
        time.sleep(1.0)
        ok, nav = menus_to_slate(s, self.args.titan, self.args.biome, log=self.log, timeout_s=90)
        if not self.check("1", ok, "title → select → biome → slate with real keys (%s)" % (nav.get("error") or "ok")):
            return
        ok, scr = dismiss_slate(s, 25, "Enter")
        if not self.check("1", ok, "real Enter → play (screen=%s)" % scr):
            return
        self.cheat("god", True)
        time.sleep(1.0)
        self.cheat("level", 6)
        time.sleep(0.6)
        self.keep_play()
        xs = self.xp_to_one_short()
        g = self.gs()
        self.check("1", (g.get("titan") or {}).get("level") == 6 and (g.get("gates") or {}).get("pending") == 0,
                   "LV %s, XP %s / %s (1 point short of LV 7), gates.pending %s" % (
                       xs.get("level"), round(xs.get("xp", 0), 2), xs.get("xpToNext"), (g.get("gates") or {}).get("pending")))
        s.js(FW_JS, ["gateLocked", "levelUp"])
        # real W: steer at the nearest street prop (tier 0) until it is eaten and the lock lands
        t0 = time.time()
        locked = False
        texts = []
        props0 = (s.state() or {}).get("propsEaten")
        while time.time() - t0 < 25:
            g = self.gs()
            if g.get("screen") in ("draft", "pause"):
                s.release_all()
                d = self.dom()
                if d.get("lockText"):
                    texts.append(d.get("lockText"))
                self.keep_play()
                continue
            if (g.get("gates") or {}).get("pending") == 1:
                locked = True
                s.release_all()
                break
            tgt = s.js("() => { const W = window.__BT__.world, T = W.titan; let best = null, bd = 1e9;"
                       " for (const p of W.city.props) { if (!p.alive || p.tier !== 0) continue;"
                       "   const d = Math.hypot(p.x - T.x, p.z - T.z); if (d < bd) { bd = d; best = p; } }"
                       " return best ? { x: best.x, z: best.z, d: bd, kind: best.kind } : null; }")
            T = g.get("titan") or {}
            if tgt:
                keys = world_to_keys(tgt["x"] - T.get("x", 0), tgt["z"] - T.get("z", 0)) or {"KeyW"}
            else:
                keys = {"KeyW"}
            s.hold(keys)
            time.sleep(0.08)
        s.release_all()
        fw = s.js(FW_READ_JS) or {}
        gl_ev = [e for fr in fw.get("frames") or [] for e in fr["events"] if e.get("type") == "gateLocked"]
        props1 = (s.state() or {}).get("propsEaten")
        self.check("1", locked and any(e.get("slot") == 1 for e in gl_ev),
                   "real W ate street props (propsEaten %s → %s) → gateLocked %s in %.1f s" % (
                       props0, props1, json.dumps(gl_ev[:1]), time.time() - t0))
        # the EN ROUTE line (summon delay 1.5 s of sim time; a level-up draft freezes the sim on the lock tick)
        d = self.dom()
        if d.get("lockText"):
            texts.append(d.get("lockText"))
        self.snap("step1_locked_enroute")
        enroute = [x for x in texts if x and "EN ROUTE" in x]
        ok_en = any(x.strip() == "SIZE LOCKED — STENCIL-1 EN ROUTE" for x in texts)
        self.check("1", ok_en and d.get("lockVisible", False) is not None,
                   "GROW bar: %s (visible %s)" % (json.dumps(enroute[:2] or texts[:2]), d.get("lockVisible")))
        ok, g = self.wait_gate(lambda q: (q.get("boss") or {}).get("id") == "stencil1", 10)
        time.sleep(0.6)
        self.keep_play()
        d = self.dom()
        self.check("1", ok and (d.get("lockText") or "").strip() == "SIZE LOCKED — BEAT STENCIL-1" and d.get("lockVisible"),
                   "STENCIL-1 arrived → GROW bar %r (visible %s)" % (d.get("lockText"), d.get("lockVisible")))
        self.check("1", d.get("kickerVisible") and "GATEKEEPER" in (d.get("kicker") or "") and d.get("plateVisible"),
                   "nameplate %r with kicker %r (visible %s)" % (d.get("plateName"), d.get("kicker"), d.get("kickerVisible")))
        self.snap("step1_beat_stencil")
        s.js(FW_OFF_JS)

    # ── the STENCIL-1 fight loop (steps 2 and 2b) ──
    def fight(self, step, budget_s, stop, tag, hold_opts=None):
        """Real-key fight with the policy. stop(g) ends it. Tracks REFILL windows (drumOpen edges): SPILL at
        open → at shut. Returns (ok, stats)."""
        s = self.sess
        opts = {"reachH": 0.9, "holdH": 3.2}
        opts.update(hold_opts or {})
        g0 = self.gs()
        t_game0 = g0.get("t") or 0.0
        wall0 = time.time()
        refills = []
        cur = None
        races = 0
        last_race = 0
        modes = {}
        last = g0
        dash_n = space_n = 0
        while True:
            g = self.gs()
            if not g:
                time.sleep(0.1)
                continue
            last = g
            if stop(g):
                s.release_all()
                return True, dict(refills=refills, races=races, modes=modes, gameS=(g.get("t") or 0) - t_game0,
                                  wallS=time.time() - wall0, dashes=dash_n, spaces=space_n, last=g, open=cur)
            if (g.get("t") or 0) - t_game0 > budget_s or time.time() - wall0 > budget_s * 2.5 + 30:
                s.release_all()
                return False, dict(refills=refills, races=races, modes=modes, gameS=(g.get("t") or 0) - t_game0,
                                   wallS=time.time() - wall0, dashes=dash_n, spaces=space_n, last=g, open=cur)
            if g.get("screen") != "play":
                s.release_all()
                self.keep_play()
                time.sleep(0.1)
                continue
            b = g.get("boss") or {}
            if b.get("raceT", 0) > 0 and last_race == 0:
                races += 1
            last_race = 1 if b.get("raceT", 0) > 0 else 0
            dopen = (b.get("drumOpen") or 0) > 0 and (b.get("staggerT") or 0) <= 0
            if dopen and cur is None:
                cur = {"t0": round((g.get("t") or 0) - t_game0, 2), "m0": round(b.get("meter") or 0, 3), "hits": 0}
            if cur is not None:
                cur["m1"] = round(b.get("meter") or 0, 3)
            if not dopen and cur is not None:
                cur["t1"] = round((g.get("t") or 0) - t_game0, 2)
                cur["gain"] = round(cur["m1"] - cur["m0"], 3)
                refills.append(cur)
                self.log("  %s: REFILL window %.1f–%.1f s: SPILL %.3f → %.3f (+%.3f)" % (
                    tag, cur["t0"], cur["t1"], cur["m0"], cur["m1"], cur["gain"]))
                cur = None
            pol = s.js(POLICY_JS, opts) or {}
            modes[pol.get("mode")] = modes.get(pol.get("mode"), 0) + 1
            self.drive(pol)
            dash_n += 1 if pol.get("dash") else 0
            space_n += 1 if pol.get("space") else 0
            time.sleep(0.05)

    # ── step 2 ──
    def step2(self):
        s = self.sess
        g = self.gs()
        b = g.get("boss") or {}
        if not self.check("2", b.get("id") == "stencil1" and b.get("alive"), "STENCIL-1 live from step 1 (%s)" % json.dumps(b)[:160]):
            return
        # fight until a REFILL window in which SPILL rose (the drum hit from behind)
        st = {}

        def spill_rose(q):
            bb = q.get("boss") or {}
            return st.get("m0") is not None and (bb.get("meter") or 0) > st["m0"] + 0.02

        # track through the generic loop: stop once a finished (or live) REFILL window gained SPILL
        def stop(q):
            bb = q.get("boss") or {}
            if (bb.get("drumOpen") or 0) > 0 and st.get("m0") is None:
                st["m0"] = bb.get("meter") or 0
            if (bb.get("drumOpen") or 0) <= 0:
                st.pop("m0", None)
            return spill_rose(q) or not bb.get("alive")

        ok, r = self.fight("2", 90, stop, "step 2")
        last = r.get("last") or {}
        lb = last.get("boss") or {}
        self.check("2", ok and lb.get("alive"),
                   "after %d STRIPE RUN race(s), behind the cart on the open drum: SPILL %.3f → %.3f in %.1f s game "
                   "(modes %s)" % (r.get("races"), st.get("m0", -1), lb.get("meter", -1), r.get("gameS"), json.dumps(r.get("modes"))))
        self.metrics["step2_fight"] = {k: v for k, v in r.items() if k != "last"}
        self.snap("step2_drum_hit")
        # HP cheat, then the kill with a real attack (auto-attack in reach + Space)
        self.cheat("gateHp", 0.03)
        s.js(FW_JS, ["gateDefeated", "rankUp", "bossDefeated"])
        ok, r2 = self.fight("2", 30, lambda q: not (q.get("boss") or {}).get("alive") or (q.get("boss") or {}).get("id") != "stencil1",
                            "step 2 kill", {"chase": True})
        s.release_all()
        time.sleep(0.25)
        d = self.dom()
        self.snap("step2_mass_breach")
        fw = s.js(FW_READ_JS) or {}
        s.js(FW_OFF_JS)
        kill_frames = [fr for fr in fw.get("frames") or [] if any(e.get("type") == "gateDefeated" for e in fr["events"])]
        same = [fr for fr in kill_frames if any(e.get("type") == "rankUp" and e.get("rank") == 1 for e in fr["events"])]
        same_tick = [fr for fr in kill_frames if "gateDefeated" in fr.get("tickEvents", []) and "rankUp" in fr.get("tickEvents", [])]
        g = self.gs()
        self.check("2", ok, "real attack killed STENCIL-1 at 3 %% HP in %.1f s game (spaces %d)" % (r2.get("gameS", 0), r2.get("spaces", 0)))
        self.check("2", bool(same), "one frame's events hold gateDefeated + rankUp 1: %s (same world tick: %s)" % (
            json.dumps([[e.get("type") + (":%s" % e.get("rank") if e.get("type") == "rankUp" else "") for e in fr["events"]]
                        for fr in kill_frames])[:300], "yes, tick %s" % same_tick[0]["tick"] if same_tick else "not caught in one tick sample"))
        ok_b = d.get("sizeUpVisible") and (d.get("sizeUpTitle") or "") == "MASS BREACH"
        if not ok_b:
            ok_b2, _ = self.wait_gate(lambda q: True, 0.01)
            d2 = self.dom()
            ok_b = d2.get("sizeUpVisible") and (d2.get("sizeUpTitle") or "") == "MASS BREACH"
            d = d2 if ok_b else d
        self.check("2", ok_b, "MASS BREACH banner visible (title %r, visible %s)" % (d.get("sizeUpTitle"), d.get("sizeUpVisible")))
        self.check("2", (g.get("titan") or {}).get("rank") == 1 and (g.get("gates") or {}).get("unlocked", 0) >= 1,
                   "titan.rank %s · gates.unlocked %s" % ((g.get("titan") or {}).get("rank"), (g.get("gates") or {}).get("unlocked")))
        time.sleep(2.5)
        self.keep_play()

    # ── step 2b ──
    def step2b(self):
        s = self.sess
        self.fresh_run(self.args.seed + 21)
        g = self.lock_and_field(6, 1, "stencil1")
        spawn_t = g.get("t") or 0.0
        self.log("  STENCIL-1 spawned at t %.2f (no HP cheat from here on)" % spawn_t)
        s.js(FW_JS, ["bossStagger"])

        def stop(q):
            bb = q.get("boss") or {}
            return (bb.get("staggerT") or 0) > 0 or not bb.get("alive")

        ok, r = self.fight("2b", 120, stop, "step 2b")
        last = r.get("last") or {}
        lb = last.get("boss") or {}
        s.release_all()
        time.sleep(0.35)
        self.snap("step2b_tipped_over")
        fw = s.js(FW_READ_JS) or {}
        s.js(FW_OFF_JS)
        stag = [e for fr in fw.get("frames") or [] for e in fr["events"] if e.get("type") == "bossStagger"]
        t_tip = (last.get("t") or 0) - spawn_t
        wins = r.get("refills") or []
        if r.get("open"):
            o = dict(r["open"])
            o["t1"] = "open at the stagger"
            o["gain"] = round((o.get("m1") or 0) - (o.get("m0") or 0), 3)
            wins = wins + [o]
        self.metrics["step2b"] = {"spillPerRefill": wins, "tippedAtS": round(t_tip, 2), "races": r.get("races"),
                                  "modes": r.get("modes"), "dashes": r.get("dashes"), "gameS": r.get("gameS")}
        self.log("  SPILL per REFILL window: %s" % json.dumps([(w.get("t0"), w.get("t1"), w.get("m0"), w.get("m1"), w.get("gain")) for w in wins]))
        self.check("2b", ok and (lb.get("staggerT") or 0) > 0 and bool(stag),
                   "TIPPED OVER (bossStagger ×%d, staggerT %.2f) %.1f s of game time after the spawn (budget 120 s); "
                   "%d REFILL window(s), SPILL gains %s; races %d; hp %.0f / %.0f (no gateHp)" % (
                       len(stag), lb.get("staggerT") or 0, t_tip, len(wins), [w.get("gain") for w in wins], r.get("races") or 0,
                       lb.get("hp") or 0, lb.get("maxHp") or 0))
        self.check("2b", any((w.get("gain") or 0) > 0 for w in wins), "SPILL rose inside a REFILL window (drum hit from behind)")

    # ── step 3 ──
    def step3(self):
        s = self.sess
        self.fresh_run(self.args.seed + 31)
        self.cheat("gatesOpen", 1)
        time.sleep(0.3)
        g = self.lock_and_field(15, 2, "cordon2", 20)
        ok, g = self.wait_gate(lambda q: (q.get("boss") or {}).get("introT", 1) <= 0, 6)
        ring = s.js(RING_JS)
        H = (g.get("boss") or {}).get("H") or 5
        self.log("  CORDON-2 live at t %.1f · spawnRing %.1f m · rig H %.2f" % (g.get("t") or 0, ring or -1, H))
        t0 = g.get("t") or 0
        wall0 = time.time()
        maxP = 0
        dmax = 0
        far_run = 0.0
        far_runs = []
        prev_t = t0
        repos = 0
        prev_b = None
        stuck_t = 0.0
        last_pos = None
        turn = 0.0
        pz = []
        s.js(FW_JS, ["gateReposition", "gateEscalate"])
        B = s.js("() => window.__BT__.world.city.bounds")
        while True:
            g = self.gs()
            t = g.get("t") or t0
            if t - t0 >= 45 or time.time() - wall0 > 150:
                break
            if g.get("screen") != "play":
                s.release_all()
                self.keep_play()
                continue
            T = g.get("titan") or {}
            b = g.get("boss") or {}
            G = g.get("gates") or {}
            maxP = max(maxP, G.get("pressure") or 0)
            d = math.hypot((b.get("x") or 0) - T.get("x", 0), (b.get("z") or 0) - T.get("z", 0))
            dmax = max(dmax, d)
            if ring and d > 2.2 * ring:
                far_run += t - prev_t
            elif far_run > 0:
                far_runs.append(round(far_run, 2))
                far_run = 0.0
            if prev_b and math.hypot(b.get("x", 0) - prev_b[0], b.get("z", 0) - prev_b[1]) > 0.5 * (ring or 50):
                repos += 1
            prev_b = (b.get("x", 0), b.get("z", 0))
            if int(t) != int(prev_t):
                pz.append((round(t - t0), G.get("pressure"), round(d / max(1e-6, ring or 1), 2)))
            prev_t = t
            # away from the rig, bent away from the map edge; turn 90° when stuck
            ax, az = T.get("x", 0) - b.get("x", 0), T.get("z", 0) - b.get("z", 0)
            m = math.hypot(ax, az) or 1
            ax, az = ax / m, az / m
            if B:
                cx, cz = (B["minX"] + B["maxX"]) / 2, (B["minZ"] + B["maxZ"]) / 2
                hx, hz = (B["maxX"] - B["minX"]) / 2, (B["maxZ"] - B["minZ"]) / 2
                ex = (T.get("x", 0) - cx) / max(1, hx)
                ez = (T.get("z", 0) - cz) / max(1, hz)
                if abs(ex) > 0.7:
                    ax -= 2.0 * ex
                if abs(ez) > 0.7:
                    az -= 2.0 * ez
            if last_pos is not None:
                moved = math.hypot(T.get("x", 0) - last_pos[0], T.get("z", 0) - last_pos[1])
                stuck_t = stuck_t + 0.1 if moved < 0.05 * max(1, T.get("height", 5)) else 0.0
            last_pos = (T.get("x", 0), T.get("z", 0))
            if stuck_t > 0.6:
                turn = time.time() + 1.2
                stuck_t = 0.0
            if time.time() < turn:
                ax, az = -az, ax
            s.hold(world_to_keys(ax, az) or {"KeyW"})
            if d < 3.0 * H and (T.get("dashCharges") or 0) >= 1:
                s.press("ShiftLeft", 50)
            time.sleep(0.1)
        s.release_all()
        if far_run > 0:
            far_runs.append(round(far_run, 2))
        fw = s.js(FW_READ_JS) or {}
        s.js(FW_OFF_JS)
        evr = [e.get("type") for fr in fw.get("frames") or [] for e in fr["events"]]
        g = self.gs()
        G = g.get("gates") or {}
        self.snap("step3_avoid_pressure")
        self.metrics["step3"] = {"pressureSeries": pz, "spawnRing": ring, "maxDistOverRing": round(dmax / max(1e-6, ring or 1), 2),
                                 "farRuns": far_runs, "repositionEvents": evr.count("gateReposition"),
                                 "escalateEvents": evr.count("gateEscalate"), "gameS": round((g.get("t") or 0) - t0, 1)}
        self.log("  pressure / distance÷spawnRing per second: %s" % json.dumps(pz))
        self.check("3", (G.get("pressure") or 0) >= 2 or maxP >= 2,
                   "45 s of real keys away from CORDON-2 → gates.pressure %s (max %s; ignoredS %.1f; gateEscalate ×%d)" % (
                       G.get("pressure"), maxP, G.get("ignoredS") or 0, evr.count("gateEscalate")))
        long_far = [x for x in far_runs if x > 4 + 1.5]
        self.check("3", not long_far,
                   "the gatekeeper stays within 2.2 × spawnRing (%.1f m): max %.2f × ring; past 2.2 × for %s s at a time; "
                   "gateReposition ×%d" % (2.2 * (ring or 0), dmax / max(1e-6, ring or 1), far_runs or "never",
                                          evr.count("gateReposition")))

    # ── step 4 + 5 ──
    def to_city_boss(self, seed):
        """LV 34 at Size IV (gatesOpen(3)), the city boss's earliest time moved to now (a GATES constant copied into
        the run so a cheat may move it), XP 1 short, one real-path level-up to LV 35 → lockGate(4) → the arrival."""
        s = self.sess
        self.fresh_run(seed)
        s.js("() => { window.__BT__.world.gates.mainEarliestT = 0; }")
        self.cheat("gatesOpen", 3)
        time.sleep(0.3)
        self.cheat("level", 34)
        time.sleep(0.6)
        self.keep_play()
        g0 = self.gs()
        self.xp_to_one_short()
        self.cheat("xp", 2)
        ok, g = self.wait_gate(lambda q: (q.get("gates") or {}).get("pending") == 4 or (q.get("gates") or {}).get("active") == 4, 4)
        via = "LV %s → %s by the real grow path" % ((g0.get("titan") or {}).get("level"), (g.get("titan") or {}).get("level"))
        if not ok:
            via += " did NOT lock slot 4 (gates %s) — cheat.gateLock(4)" % json.dumps(g.get("gates"))
            self.log("  " + via)
            self.cheat("gateLock", 4)
        ok, g = self.wait_gate(lambda q: (q.get("boss") or {}).get("role") == "main" and (q.get("boss") or {}).get("alive"), 20)
        g["_via"] = via
        g["_rank0"] = (g0.get("titan") or {}).get("rank")
        return ok, g

    def step4(self):
        s = self.sess
        ok, g = self.to_city_boss(self.args.seed + 41)
        b = g.get("boss") or {}
        if not self.check("4", ok and (g.get("titan") or {}).get("rank") == 3,
                          "gatesOpen(3) + LV 35 (%s) → the city boss %s spawned; titan at Size %s (rank %s)" % (
                              g.get("_via"), b.get("id"), ["I", "II", "III", "IV", "V"][(g.get("titan") or {}).get("rank", 0)],
                              (g.get("titan") or {}).get("rank"))):
            return False
        self.wait_gate(lambda q: (q.get("boss") or {}).get("introT", 1) <= 0, 8)
        self.cheat("gateHp", 0.01)
        s.js(FW_JS, ["finale", "rankUp", "bossDefeated", "runEnd"])
        ok, r = self.fight("4", 120, lambda q: not (q.get("boss") or {}).get("alive"), "step 4 kill", {"chase": True, "reachH": 1.0})
        s.release_all()
        kill_wall = time.time()
        g = self.gs()
        fw = s.js(FW_READ_JS) or {}
        kill_frames = [fr for fr in fw.get("frames") or [] if any(e.get("type") == "finale" and e.get("on") for e in fr["events"])]
        fin = [e for fr in kill_frames for e in fr["events"] if e.get("type") == "finale"]
        same = [fr for fr in kill_frames if any(e.get("type") == "rankUp" and e.get("rank") == 4 for e in fr["events"])]
        self.check("4", ok and bool(fin), "a real attack killed the city boss at 1 %% HP in %.1f s game (modes %s, spaces %d) → "
                   "finale on %s; same frame holds rankUp 4: %s" % (r.get("gameS", 0), json.dumps(r.get("modes")), r.get("spaces", 0),
                                                                 json.dumps(fin[:1]), bool(same)))
        self.check("4", (g.get("titan") or {}).get("rank") == 4, "titan.rank %s (Size V)" % (g.get("titan") or {}).get("rank"))
        # the `alert finale` is due 2.5 s after the kill (FINALE_ALERT_S, after the MASS BREACH sting): poll to +3.3 s
        ban, seen_at, d, snapped = [], None, {}, False
        while time.time() - kill_wall < 3.3:
            b2 = s.js(BANNER_JS) or []
            if b2 and seen_at is None:
                seen_at = time.time() - kill_wall
                ban = b2
            if seen_at is not None and not snapped and time.time() - kill_wall >= min(seen_at + 0.45, 3.2):
                snapped = True
                self.snap("step4_finale_banner")      # past the strap's wipe-in
            time.sleep(0.1)
        kill_t = (g.get("gates") or {}).get("mainKillT")
        d = self.dom()
        self.log("  skip hint at +3.3 s: %r" % d.get("skipHint"))
        self.check("4", bool(ban), "`THE CITY GOT SMALLER.` banner visible in the DOM %s (%s)" % (
            "at +%.1f s after the kill" % seen_at if seen_at is not None else "— not within 3.3 s of the kill", ban[:2]))
        g_pre = self.gs()
        s.press("Enter", 80)
        ok, g2 = self.wait_gate(lambda q: (q.get("gates") or {}).get("finaleDone"), 3, drafts=False)
        self.check("4", ok and (g_pre.get("gates") or {}).get("finaleT", 0) > 0,
                   "real Enter at +3.3 s ended the finale (finaleT left %.2f s → finaleDone %s)" % (
                       (g_pre.get("gates") or {}).get("finaleT") or 0, (g2.get("gates") or {}).get("finaleDone")))
        ok, scr = s.wait_screen(("end",), 20)
        time.sleep(2.2)
        d = self.dom()
        g = self.gs()
        self.snap("step4_tabloid_clear")
        want = s.js(FMT_JS, kill_t) if isinstance(kill_t, (int, float)) else None
        run = g.get("run") or {}
        self.check("4", ok and run.get("result") == "clear",
                   "the tabloid printed, clear variant (screen %s, result %s, headline %r, stamp %r)" % (
                       scr, run.get("result"), d.get("tabHeadline"), d.get("tabStamp")))
        self.check("4", want is not None and d.get("tabTime") == want and abs((run.get("endT") or -1) - (kill_t or -2)) < 1e-6,
                   "tabloid TIME %r = fmtTime(mainKillT %.3f) %r · run.endT %.3f" % (
                       d.get("tabTime"), kill_t or -1, want, run.get("endT") or -1))
        return ok

    def step5(self):
        s = self.sess
        if s.screen() != "end":
            self.check("5", False, "not on the clear tabloid (screen %s)" % s.screen())
            return
        s.press("KeyK", 80)
        ok, g = self.wait_gate(lambda q: q.get("endless") is not None and (q.get("run") or {}).get("phase") == "endless", 10, drafts=False)
        ensure_play(s, 15)
        g = self.gs()
        self.check("5", ok and (g.get("titan") or {}).get("rank") == 4,
                   "real K → EXTENDED COVERAGE (run.phase %s) at Size %s; next boss at t %.1f (now %.1f)" % (
                       (g.get("run") or {}).get("phase"), ["I", "II", "III", "IV", "V"][(g.get("titan") or {}).get("rank", 0)],
                       (g.get("endless") or {}).get("nextBossT") or -1, g.get("t") or -1))
        t_k = g.get("t") or 0
        ok, g = self.wait_gate(lambda q: (q.get("boss") or {}).get("role") == "gate" and (q.get("boss") or {}).get("alive"), 140)
        b = g.get("boss") or {}
        time.sleep(1.2)
        d = self.dom()
        self.snap("step5_rematch_v")
        self.check("5", ok and b.get("slot") == 0 and 70 <= (g.get("t") or 0) - t_k <= 82,
                   "gatekeeper rematch %s (slot %s) spawned %.1f s of game time after KEEP GOING (75 s)" % (
                       b.get("id"), b.get("slot"), (g.get("t") or 0) - t_k))
        self.check("5", d.get("kickerVisible") and (d.get("kicker") or "").strip() == "REISSUED · SIZE V",
                   "nameplate kicker %r (visible %s), name %r" % (d.get("kicker"), d.get("kickerVisible"), d.get("plateName")))

    # ── step 6 ──
    def step6(self):
        s = self.sess
        ok, g = self.to_city_boss(self.args.seed + 61)
        if not self.check("6", ok, "second city boss live (%s)" % (g.get("boss") or {}).get("id")):
            return
        self.wait_gate(lambda q: (q.get("boss") or {}).get("introT", 1) <= 0, 8)
        self.cheat("gateKill")                      # setup: the finale itself is what step 6 acts on
        ok, g = self.wait_gate(lambda q: (q.get("gates") or {}).get("finaleT", 0) > 0, 5, drafts=False)
        if not self.check("6", ok, "finale on (finaleT %.2f)" % ((g.get("gates") or {}).get("finaleT") or 0)):
            return
        t_on = time.time()
        while time.time() - t_on < 3.4:
            time.sleep(0.1)
        g_pre = self.gs()
        self.pad_press(PAD_A, 0.15)
        ok, g2 = self.wait_gate(lambda q: (q.get("gates") or {}).get("finaleDone"), 2.5, drafts=False)
        if not ok:
            self.log("  first pad A did not skip (lastDevice may have flipped to the pad on that press) — pressing again")
            time.sleep(0.3)
            self.pad_press(PAD_A, 0.15)
            ok, g2 = self.wait_gate(lambda q: (q.get("gates") or {}).get("finaleDone"), 2.5, drafts=False)
        d = self.dom()
        self.check("6", ok and (g_pre.get("gates") or {}).get("finaleT", 0) > 1.0,
                   "pad A skipped the finale with %.2f s of it left (finaleDone %s; hint %r)" % (
                       (g_pre.get("gates") or {}).get("finaleT") or 0, (g2.get("gates") or {}).get("finaleDone"), d.get("skipHint")))
        ok, scr = s.wait_screen(("end",), 20)
        self.check("6", ok, "→ the tabloid (screen %s)" % scr)

    # ── driver ──
    def run(self):
        want = [x.strip() for x in self.args.steps.split(",") if x.strip()] if self.args.steps else list(STEPS)
        self.sess = Session(self.args, "playtest_gate")
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
            plan = [("1", self.step1), ("2", self.step2), ("2b", self.step2b), ("3", self.step3), ("4", self.step4),
                    ("5", self.step5), ("6", self.step6)]
            for st, fn in plan:
                if st not in want:
                    continue
                if st == "2" and "1" not in want:
                    self.check("2", False, "step 2 continues step 1's fight (run 1,2 together)")
                    continue
                if st == "5" and "4" not in want:
                    self.check("5", False, "step 5 continues step 4's tabloid (run 4,5 together)")
                    continue
                self.log("── step %s ──" % st)
                t0 = time.time()
                try:
                    fn()
                except HarnessError as e:
                    self.check(st, False, "harness stop: %s" % str(e)[:300])
                except Exception as e:
                    self.check(st, False, "exception: %s" % str(e).splitlines()[0][:300])
                self.sess.release_all()
                self.log("  (step %s: %.0f s wall)" % (st, time.time() - t0))
        except Exception as e:
            fatal = str(e).splitlines()[0][:300]
            self.log("FATAL: %s" % fatal)
        finally:
            diag = self.sess.diagnostics() if self.sess.page else {}
            self.sess.close()

        for st in want:
            subs = self.sub.get(st) or []
            if not subs:
                self.results[st] = ("FAIL", "not reached" + (" (%s)" % fatal if fatal else ""))
            else:
                self.results[st] = ("PASS" if all(ok for ok, _ in subs) else "FAIL",
                                    "; ".join(("" if ok else "✗ ") + t for ok, t in subs))
        dprob = diag_problems(diag)
        print("=" * 78)
        print("PLAYTEST_GATE %s/%s seed %s (%s)" % (self.args.titan, self.args.biome, self.args.seed,
                                                    "headless" if self.args.headless else "headed"))
        print_diagnostics(diag, limit=15)
        for st in want:
            status, detail = self.results[st]
            print("  STEP %-3s %-5s %s" % (st, status, detail[:1200]))
        if "step2b" in self.metrics:
            m = self.metrics["step2b"]
            print("  2b metrics: TIPPED OVER at %.1f s after the spawn · SPILL per REFILL %s" % (
                m["tippedAtS"], json.dumps([(w.get("t0"), w.get("m0"), w.get("m1")) for w in m["spillPerRefill"]])))
        print("  diagnostics: %s" % ("clean" if not dprob else ", ".join(dprob)))
        failed = [st for st, (status, _) in self.results.items() if status == "FAIL"]
        if fatal:
            failed.append("fatal")
        if dprob:
            failed.append("diagnostics")
        verdict = "FAIL (%s)" % ", ".join(failed) if failed else "ALL %d PASS" % len(self.results)
        print("PLAYTEST_GATE: %s" % verdict)
        rep = {"titan": self.args.titan, "biome": self.args.biome, "seed": self.args.seed,
               "results": {k: {"status": v[0], "detail": v[1]} for k, v in self.results.items()},
               "sub": {k: [[ok, t] for ok, t in v] for k, v in self.sub.items()}, "metrics": self.metrics,
               "verdict": verdict, "fatal": fatal, "diagnostics": diag, "shots": self.shots, "log": self.log_lines}
        print("report: %s" % save_report("playtest_gate_%s_%s" % (self.args.titan, self.args.biome), rep,
                                        self.args.base, self.args.report_dir))
        return 1 if failed else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="BLOCKTOOTH GATEKEEPERS real-input playtest (GATEKEEPERS §8.3)")
    add_common_args(ap)
    ap.add_argument("--titan", default="molo", choices=TITANS)
    ap.add_argument("--biome", default="grideast", choices=BIOMES)
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--steps", default="", help="comma list of %s (default all)" % ",".join(STEPS))
    ap.add_argument("--out-dir", default=SHOTS)
    args = ap.parse_args()
    return GatePlaytest(args).run()


if __name__ == "__main__":
    raise SystemExit(main())
