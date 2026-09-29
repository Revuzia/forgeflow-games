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
# step 5: live boss tells / hazards in the sim vs what the views drew last frame (+ a steer toward the rig)
TELL_DRAWN_JS = r"""
() => {
  const B = window.__BT__; const W = B && B.world; if (!W) return null;
  const st = B.state(); const v = st.views || {};
  let bossTells = 0, tellAge = 0;
  for (const tg of W.telegraphs) if (tg.alive && tg.owner === 'boss' && !tg.fired) { bossTells++; tellAge = Math.max(tellAge, tg.t); }
  let hazards = 0, hazAge = 0;
  for (const h of W.hazards) if (h.alive) { hazards++; hazAge = Math.max(hazAge, h.t); }
  const b = W.boss, T = W.titan;
  const out = { t: W.t, bossTells, tellAge, hazards, hazAge, tgDrawn: v.tgDrawn, tgBossDrawn: v.tgBossDrawn, hzDrawn: v.hzDrawn };
  if (b && b.alive) { const dx = b.x - T.x, dz = b.z - T.z, d = Math.hypot(dx, dz);
    out.dx = dx / (d || 1); out.dz = dz / (d || 1); out.far = d > 3 * (b.data.H || 10); }
  return out;
}
"""

GS_JS = r"""
() => {
  const B = window.__BT__; const W = B && B.world; if (!W) return null;
  const T = W.titan, b = W.boss, G = W.gates, E = W.endless;
  const bo = b ? { id: b.id, role: b.role, slot: b.slot, alive: b.alive, x: b.x, z: b.z, heading: b.heading,
    hp: b.hp, maxHp: b.maxHp, introT: b.introT, staggerT: b.staggerT, meter: b.meter, attack: b.attack,
    attackT: b.attackT, phase: b.phase, H: b.data.H, drumOpen: b.data.drumOpen || 0, raceT: b.data.raceT || 0,
    weakMask: b.data.weakMask || 0,
    byKind: Object.fromEntries(Object.entries(b.data).filter(([k, v]) => k.startsWith('by_') && typeof v === 'number')) } : null;
  return { t: W.t, tick: W.tick, screen: B.state().screen,
    titan: { x: T.x, z: T.z, heading: T.heading, height: T.height, radius: T.radius, rank: T.rank, level: T.level,
             xp: T.xp, xpToNext: T.xpToNext, hp: T.hp, alive: T.alive, dashCharges: T.dashCharges, dashT: T.dashT },
    gates: { unlocked: G.unlocked, pending: G.pending, active: G.active, pressure: G.pressure, ignoredS: G.ignoredS,
             farS: G.farS, finaleT: G.finaleT, finaleDone: G.finaleDone, mainKillT: G.mainKillT, dueT: G.dueT,
             mainEarliestT: G.mainEarliestT, rematchGates: G.rematchGates, engagedS: G.engagedS,
             lastAddHitT: G.lastAddHitT, bossLastHitT: b && Number.isFinite(b.data.lastHitT) ? b.data.lastHitT : null },
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
# step 3: every rendered frame, the nameplate subtitle the PLAYER sees (DOM .bt-boss-sub) + the rig's b.attack, stored
# as transitions [tick, attack, text] — read back to check each cut-off re-entry put CUTTING YOU OFF on screen
SUB_JS = r"""
() => {
  const S = window.__PG_SUB__ || (window.__PG_SUB__ = { loop: false });
  S.on = true; S.tr = []; S.key = '';
  if (!S.loop) {
    S.loop = true;
    const f = () => {
      if (S.on) {
        const W = window.__BT__.world, b = W && W.boss, e = document.querySelector('.bt-boss-sub');
        const txt = e ? (e.textContent || '').trim() : '', at = b && b.alive ? (b.attack || '') : '';
        const k = at + '|' + txt;
        if (W && k !== S.key) { S.key = k; S.tr.push([W.tick, at, txt]); }
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }
  return true;
}
"""
SUB_READ_JS = "() => { const S = window.__PG_SUB__; if (!S) return null; S.on = false; return S.tr; }"
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

# step 3's runner reads the street grid a player sees (roads are the open lanes between blocks; no building
# stands on a road), the titan's walk / dash reach and the rig's band — read-only
GRID_JS = r"""
async () => {
  const W = window.__BT__.world; if (!W) return null;
  const c = W.city, T = W.titan, b = W.boss;
  const m = await import('/src/ai/bosses/index.ts');
  const H = b ? m.bossH(W, b) : T.height;
  return { blocksX: c.blocksX, blocksZ: c.blocksZ, pitch: c.pitch, roadW: c.roadW, sidewalkW: c.sidewalkW, originX: c.originX,
    originZ: c.originZ, bounds: c.bounds, walk: m.titanWalk(W), R: T.radius, height: T.height,
    dashM: Math.max(0, T.stats.dashDistance || 0) * T.height, H,
    bandMaxH: b && b.data.bandMaxH > 0 ? b.data.bandMaxH : 3.5 };
}
"""


class StreetRunner:
    """A player running from a hunting gatekeeper (GATEKEEPERS §2.4) with nothing but WASD + Shift.

    It runs the open street grid (roads never hold a building, so nothing uncrushable is in the way), and at
    every intersection picks the next street the way a runner reads the map: for each street out of the corner
    (and the three after it, a ~16 s look-ahead) it plays the chase forward — the rig driving straight at the
    titan at the §2.4 hunt speed (huntClose / huntHot × the titan's walk, eased to HUNT_FLOOR at the engagement
    edge; a pessimistic rig that ignores buildings) — and takes the street whose closest approach stays largest,
    then the one that ends farthest from the rig and away from the city edge (a corner is a trap). Every ~1 s it
    re-reads the rig (a cut-off can put it ahead) and turns back on the street if that is clearly better. It dashes
    (Shift) whenever a charge is up, the street ahead is long enough for the dash, and the rig is behind it."""

    HUNT_FLOOR = 0.8
    HUNT_CLOSE, HUNT_HOT, ENGAGE_MARGIN_H = 0.95, 1.05, 0.5

    def __init__(self, grid, log=None):
        g = grid or {}
        self.ok = bool(g) and (g.get("pitch") or 0) > 0
        self.log = log or (lambda *_: None)
        self.nx = int(g.get("blocksX") or 0) + 1
        self.nz = int(g.get("blocksZ") or 0) + 1
        self.pitch = float(g.get("pitch") or 72)
        self.roadW = float(g.get("roadW") or 14)
        self.sidewalkW = float(g.get("sidewalkW") or 0)
        self.ox = float(g.get("originX") or 0)
        self.oz = float(g.get("originZ") or 0)
        B = g.get("bounds") or {}
        self.B = (B.get("minX", -1e9), B.get("maxX", 1e9), B.get("minZ", -1e9), B.get("maxZ", 1e9))
        self.walk = float(g.get("walk") or 15)
        self.R = float(g.get("R") or 4)
        self.dashM = float(g.get("dashM") or 0)
        self.H = float(g.get("H") or 10)
        self.bandMax = float(g.get("bandMaxH") or 3.5) * self.H
        self.edge = self.bandMax + self.ENGAGE_MARGIN_H * self.H
        self.target = None          # (i, j) intersection being run to
        self.prev = None            # the intersection the titan left
        self.on_road = True
        self.replans = 0
        self.unsticks = 0
        self.turns = 0
        self.last_eval = -1e9
        self.last_pos = None
        self.stuck_t = 0.0
        self.unstick_until = 0.0
        self.unstick_dir = None
        self.pressure = 0

    # ── the grid ──
    def node_xz(self, n):
        return self.ox + n[0] * self.pitch, self.oz + n[1] * self.pitch

    def valid(self, n):
        if not (0 <= n[0] < self.nx and 0 <= n[1] < self.nz):
            return False
        x, z = self.node_xz(n)
        return self.B[0] <= x <= self.B[1] and self.B[2] <= z <= self.B[3]

    def nbrs(self, n):
        for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            m = (n[0] + di, n[1] + dj)
            if self.valid(m):
                yield m

    def nearest_node(self, x, z):
        i = min(self.nx - 1, max(0, int(round((x - self.ox) / self.pitch))))
        j = min(self.nz - 1, max(0, int(round((z - self.oz) / self.pitch))))
        return (i, j)

    def edge_dist(self, x, z):
        return min(x - self.B[0], self.B[1] - x, z - self.B[2], self.B[3] - z)

    # ── the chase, played forward ──
    def hunt_speed(self, d, hot):
        over = min(1.0, max(0.0, (d - self.edge) / max(1e-6, self.bandMax)))
        return (self.HUNT_HOT if hot else self.HUNT_CLOSE) * self.walk * max(self.HUNT_FLOOR, over)

    def play(self, tx, tz, pts, bx, bz, horizon=14.0, dt=0.25):
        """Titan from (tx, tz) along the polyline pts at its walk (a 90° corner costs 0.3 s, a reversal 0.6 s);
        the rig pursues. Returns (closest approach, final distance, final titan point)."""
        hot = self.pressure >= 2
        v = self.walk
        seg = 0
        cx, cz = tx, tz
        hdg = None
        pause = 0.0
        dmin = math.hypot(bx - cx, bz - cz)
        t = 0.0
        while t < horizon:
            step = v * dt
            if pause > 0:
                use = min(pause, dt)
                pause -= use
                step = v * (dt - use)
            while step > 1e-6 and seg < len(pts):
                px, pz = pts[seg]
                ddx, ddz = px - cx, pz - cz
                L = math.hypot(ddx, ddz)
                if L < 1e-6:
                    seg += 1
                    continue
                h = (ddx / L, ddz / L)
                if hdg is not None and h[0] * hdg[0] + h[1] * hdg[1] < 0.5:
                    pause += 0.6 if h[0] * hdg[0] + h[1] * hdg[1] < -0.5 else 0.3
                    hdg = h
                    break
                hdg = h
                if L <= step:
                    cx, cz = px, pz
                    step -= L
                    seg += 1
                else:
                    cx += h[0] * step
                    cz += h[1] * step
                    step = 0
            d = math.hypot(cx - bx, cz - bz)
            if d > 1e-6:
                s = min(d, self.hunt_speed(d, hot) * dt)
                bx += (cx - bx) / d * s
                bz += (cz - bz) / d * s
            d = math.hypot(cx - bx, cz - bz)
            dmin = min(dmin, d)
            t += dt
        return dmin, math.hypot(cx - bx, cz - bz), (cx, cz)

    # ── steering (keys) ──
    def keys_to(self, T, n):
        """Hold the keys that run the titan down the street to intersection n (centred on the road)."""
        x, z = T.get("x", 0), T.get("z", 0)
        nx_, nz_ = self.node_xz(n)
        dx, dz = nx_ - x, nz_ - z
        # the street's axis: the larger leg; the smaller leg is the drift off the road's centre line
        if abs(dx) >= abs(dz):
            ax, lat = (1.0 if dx > 0 else -1.0, 0.0), dz
        else:
            ax, lat = (0.0, 1.0 if dz > 0 else -1.0), dx
        off = abs(lat)
        # the titan's centre may drift this far off the centre line before its body meets the kerb-side buildings
        half = max(0.5, self.roadW / 2 + self.sidewalkW - self.R)
        vx, vz = ax
        if off > 0.5 * half:                      # drifting toward a kerb: bear back to the centre line
            k = 0.9 if off > half else 0.55
            if ax[0] != 0:
                vz += k * (1 if lat > 0 else -1)
            else:
                vx += k * (1 if lat > 0 else -1)
        return world_to_keys(vx, vz) or {"KeyW"}, (vx, vz)

    def step(self, T, b, t, pressure=0):
        """One 0.1 s decision. Returns (held keys, mode label)."""
        self.pressure = pressure or 0
        x, z = T.get("x", 0), T.get("z", 0)
        bx, bz = b.get("x", 0), b.get("z", 0)
        if not self.ok:
            return world_to_keys(x - bx, z - bz) or {"KeyW"}, "flee"
        # on the road network?
        fi, fj = (x - self.ox) / self.pitch, (z - self.oz) / self.pitch
        offx = abs(fi - round(fi)) * self.pitch
        offz = abs(fj - round(fj)) * self.pitch
        self.on_road = min(offx, offz) <= self.roadW / 2
        # stuck (a prop / the rig's body / a knock): step across for 0.8 s, then re-plan
        if self.last_pos is not None:
            moved = math.hypot(x - self.last_pos[0], z - self.last_pos[1])
            self.stuck_t = self.stuck_t + 0.1 if moved < 0.12 * self.walk * 0.1 else 0.0
        self.last_pos = (x, z)
        if self.stuck_t > 0.6:
            self.stuck_t = 0.0
            self.unsticks += 1
            self.unstick_until = t + 0.8
            ax, az = x - bx, z - bz
            self.unstick_dir = (-az, ax) if (self.unsticks % 2) else (az, -ax)
            self.target = None
        if t < self.unstick_until and self.unstick_dir:
            return world_to_keys(*self.unstick_dir) or {"KeyW"}, "unstick"
        if not self.on_road:
            # back onto the nearest street, the short way (perpendicular to it), away-side preferred
            ri, rj = round(fi), round(fj)
            if offx <= offz:
                return world_to_keys(self.ox + ri * self.pitch - x, 0.0) or {"KeyW"}, "to-road"
            return world_to_keys(0.0, self.oz + rj * self.pitch - z) or {"KeyW"}, "to-road"
        here = self.nearest_node(x, z)
        hx, hz = self.node_xz(here)
        at_node = math.hypot(x - hx, z - hz) <= max(4.0, 0.45 * self.roadW)
        if self.target is not None and not self.valid(self.target):
            self.target = None
        if self.target is not None and self.target == here and at_node:
            self.prev, self.target = here, None
        if self.target is None:
            # a decision at (or on the way to) an intersection: which street next
            if at_node:
                start, cands = here, list(self.nbrs(here))
            else:
                # mid-street: the two ends of the street the titan stands on
                if offx <= offz:          # on a north-south street (x = const)
                    i = round(fi); j0 = math.floor(fj)
                    cands = [m for m in ((i, j0), (i, j0 + 1)) if self.valid(m)]
                else:
                    j = round(fj); i0 = math.floor(fi)
                    cands = [m for m in ((i0, j), (i0 + 1, j)) if self.valid(m)]
                start = None
            best = None
            for c in cands:
                sc = self.score_from(x, z, start, c, bx, bz)
                if sc and (best is None or sc[0] > best[0]):
                    best = (sc[0], c, sc)
            if best is None:
                return world_to_keys(x - bx, z - bz) or {"KeyW"}, "flee"
            if self.target is not None and best[1] != self.target:
                self.turns += 1
            self.prev, self.target = start, best[1]
            self.last_eval = t
        elif t - self.last_eval >= 1.0:
            # re-read the rig: keep running to the target, or turn back if that is clearly better
            self.last_eval = t
            keep = self.score_from(x, z, None, self.target, bx, bz)
            back = self.prev if self.prev is not None and self.valid(self.prev) else None
            if back is not None and back != self.target:
                alt = self.score_from(x, z, None, back, bx, bz)
                if keep and alt and alt[0] > keep[0] + 2.0 * self.H:
                    self.replans += 1
                    self.prev, self.target = self.target, back
        keys, _ = self.keys_to(T, self.target)
        return keys, "run"

    def score_from(self, x, z, start, first, bx, bz):
        """score() with the titan's current point first (so a street it is half-way along is costed right)."""
        best = None
        cap_min, cap_end = 9.0 * self.H, 16.0 * self.H
        stack = [[first]]
        paths = []
        while stack:
            path = stack.pop()
            if len(path) >= 4:
                paths.append(path)
                continue
            last = path[-1]
            prev = path[-2] if len(path) >= 2 else start
            ext = False
            for m in self.nbrs(last):
                if m == prev:
                    continue
                stack.append(path + [m])
                ext = True
            if not ext:
                paths.append(path)
        for path in paths:
            pts = [self.node_xz(n) for n in path]
            dmin, dend, (ex, ez) = self.play(x, z, pts, bx, bz)
            room = self.edge_dist(ex, ez)
            sc = 3.0 * min(dmin, cap_min) + min(dend, cap_end) - 2.0 * max(0.0, 2.5 * self.pitch - room)
            if best is None or sc > best[0]:
                best = (sc, path, dmin, dend)
        return best

    def want_dash(self, T, b):
        """Shift now? A charge is up, the titan is lined up with its street, the street ahead holds the whole dash
        (so it does not dash into a block), and the rig is behind it."""
        if not self.ok or self.target is None or not self.on_road or self.dashM <= 0:
            return False
        if (T.get("dashCharges") or 0) < 1 or (T.get("dashT") or 0) > 0:
            return False
        x, z = T.get("x", 0), T.get("z", 0)
        nx_, nz_ = self.node_xz(self.target)
        dx, dz = nx_ - x, nz_ - z
        L = math.hypot(dx, dz)
        if L < self.dashM + self.R + 4.0:
            return False
        ux, uz = dx / L, dz / L
        hd = T.get("heading") or 0.0
        if math.sin(hd) * ux + math.cos(hd) * uz < 0.94:
            return False
        rx, rz = x - b.get("x", 0), z - b.get("z", 0)
        rm = math.hypot(rx, rz) or 1.0
        return (rx * ux + rz * uz) / rm > 0.2


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
        kit = s.js("() => { const W = window.__BT__.world, T = W.titan; return { thorns: T.stats.thorns || 0, "
                   "owned: (window.__BT__.state().owned || []) }; }") or {}
        self.log("  titan kit at the start: thorns %s · owned %s" % (kit.get("thorns"), json.dumps(kit.get("owned"))[:300]))
        t0 = g.get("t") or 0
        wall0 = time.time()
        maxP = 0
        dmax = 0
        far_run = 0.0
        far_runs = []
        prev_t = t0
        repos = 0
        prev_b = None
        pz = []
        s.js(FW_JS, ["gateReposition", "gateEscalate"])
        s.js(SUB_JS)
        grid = s.js(GRID_JS)
        runner = StreetRunner(grid, self.log)
        modes = {}
        dashes = 0
        eng_log = []
        hit_log = []                 # (game s since live, dist÷ring, damage by kind since the last hit, titan hp)
        last_lh = (self.gs().get("gates") or {}).get("bossLastHitT")
        last_by = dict(((self.gs().get("boss") or {}).get("byKind")) or {})
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
            # why a tick counts as engaged (§2.4): proximity / a hit on the rig / a hit on one of its adds
            eng_p = d <= (runner.bandMax / max(1e-6, runner.H) + 0.5) * H
            lh, la = G.get("bossLastHitT"), G.get("lastAddHitT")
            eng_h = isinstance(lh, (int, float)) and t - lh <= 5
            eng_a = isinstance(la, (int, float)) and t - la <= 5
            if isinstance(lh, (int, float)) and lh != last_lh:
                bk = b.get("byKind") or {}
                dk = {k: round(v - last_by.get(k, 0), 2) for k, v in bk.items() if v - last_by.get(k, 0) > 1e-6}
                hit_log.append((round(lh - t0, 1), round(d / max(1e-6, ring or 1), 2), dk, round(T.get("hp") or 0)))
                last_lh, last_by = lh, dict(bk)
            if eng_p or eng_h or eng_a:
                why = ("prox " if eng_p else "") + ("rigHit " if eng_h else "") + ("addHit" if eng_a else "")
                eng_log.append((round(t - t0, 1), why.strip()))
            if int(t) != int(prev_t):
                pz.append((round(t - t0), G.get("pressure"), round(d / max(1e-6, ring or 1), 2)))
            prev_t = t
            # a real runner: flee along the open street grid (roads never hold an uncrushable building), choosing
            # each next intersection by a short look-ahead of where the hunting rig will be; only WASD / Shift
            keys, info = runner.step(T, b, g.get("t") or t, G.get("pressure") or 0)
            modes[info] = modes.get(info, 0) + 1
            s.hold(keys or {"KeyW"})
            if runner.want_dash(T, b):
                s.press("ShiftLeft", 50)
                dashes += 1
            time.sleep(0.1)
        s.release_all()
        if far_run > 0:
            far_runs.append(round(far_run, 2))
        fw = s.js(FW_READ_JS) or {}
        s.js(FW_OFF_JS)
        sub_tr = s.js(SUB_READ_JS) or []
        evr = [e.get("type") for fr in fw.get("frames") or [] for e in fr["events"]]
        g = self.gs()
        G = g.get("gates") or {}
        self.snap("step3_avoid_pressure")
        self.metrics["step3"] = {"pressureSeries": pz, "spawnRing": ring, "maxDistOverRing": round(dmax / max(1e-6, ring or 1), 2),
                                 "farRuns": far_runs, "repositionEvents": evr.count("gateReposition"),
                                 "escalateEvents": evr.count("gateEscalate"), "gameS": round((g.get("t") or 0) - t0, 1),
                                 "runnerModes": modes, "dashes": dashes, "replans": runner.replans, "unsticks": runner.unsticks,
                                 "engagedS": round(G.get("engagedS") or 0, 1) if "engagedS" in G else None}
        self.log("  pressure / distance÷spawnRing per second: %s" % json.dumps(pz))
        self.log("  engaged samples (game s since live, why): %d · %s · engagedS %s" % (
            len(eng_log), json.dumps(eng_log[:60]), G.get("engagedS")))
        self.metrics["step3"]["engaged"] = eng_log
        self.log("  titan hits on the rig (game s since live, dist÷ring, dmg by kind, titan hp): %s" % json.dumps(hit_log[:40]))
        self.metrics["step3"]["rigHits"] = hit_log
        self.check("3", (G.get("pressure") or 0) >= 2 or maxP >= 2,
                   "45 s of real keys away from CORDON-2 → gates.pressure %s (max %s; ignoredS %.1f; gateEscalate ×%d)" % (
                       G.get("pressure"), maxP, G.get("ignoredS") or 0, evr.count("gateEscalate")))
        # §2.4 cut-off for a runner that out-walks the hunt (Lane A fx2: gateUnstick's out-run rule — the rig hunts,
        # stops closing for repositionS → it re-enters ahead of the titan, `gateReposition`)
        self.check("3", evr.count("gateReposition") >= 1,
                   "out-run → CUTTING YOU OFF: gateReposition ×%d (≥ 1) · runner: %d dashes, %d turn-backs, %d unsticks, "
                   "modes %s" % (evr.count("gateReposition"), dashes, runner.replans, runner.unsticks, json.dumps(modes)))
        # critic 2026-09-29: the out-run cut-off (gateUnstick → gateReenter, after that tick's gateBeats) never showed
        # CUTTING YOU OFF. Each re-entry made while the rig was free (no real attack live — the beat's own rule) must
        # put the subtitle in the DOM within 1.5 s (45 ticks).
        rep_ticks = [fr.get("tick") for fr in fw.get("frames") or [] for e in fr["events"]
                     if e.get("type") == "gateReposition" and isinstance(fr.get("tick"), (int, float))]
        elig = shown = 0
        detail = []
        for rt in rep_ticks:
            prior = [x for x in sub_tr if x[0] <= rt - 1]
            at_before = prior[-1][1] if prior else ""
            if at_before not in ("", "ramming", "cutOff"):
                detail.append((rt, "busy:" + at_before))
                continue
            elig += 1
            ok_sub = any(rt - 1 <= x[0] <= rt + 45 and "CUTTING YOU OFF" in (x[2] or "") for x in sub_tr)
            shown += 1 if ok_sub else 0
            detail.append((rt, "shown" if ok_sub else "MISSING"))
        self.metrics["step3"]["cutOffSubtitle"] = detail
        self.check("3", elig >= 1 and shown == elig,
                   "CUTTING YOU OFF on the nameplate (DOM) within 1.5 s of each free cut-off re-entry: %d of %d "
                   "(%d re-entries; %s)" % (shown, elig, len(rep_ticks), json.dumps(detail[:12])))
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
        plate2 = None                              # §4.3.4: the dead boss's nameplate is gone 2 s after `finale on`
        while time.time() - kill_wall < 3.3:
            if plate2 is None and time.time() - kill_wall >= 2.0:
                dp = self.dom()
                gp = self.gs()
                plate2 = {"visible": dp.get("plateVisible"), "name": dp.get("plateName"),
                          "wallS": round(time.time() - kill_wall, 2),
                          "gameS": round((gp.get("t") or 0) - ((gp.get("gates") or {}).get("mainKillT") or 0), 2)}
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
        self.check("4", plate2 is not None and plate2.get("visible") is False,
                   "the dead boss's nameplate is hidden 2 s after `finale on` (%s)" % json.dumps(plate2))
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
        # the rematch's tells must be DRAWN, not only live in the sim (critic 2026-09-29: the runEnd fade blanked
        # every telegraph + hazard for the rest of an EXTENDED COVERAGE run). Real keys only: walk toward the rig
        # so it attacks; sample the sim's live boss tells vs what TelegraphView drew last frame.
        if not ok:
            return
        n_live = n_drawn = 0
        hz_live = hz_drawn = 0
        first = None
        t_end = time.time() + 45
        while time.time() < t_end and (n_live < 8 or hz_live < 8):
            if s.screen() != "play":
                self.keep_play()
            v = s.safe_js(TELL_DRAWN_JS) or {}
            if v.get("dx") is not None and v.get("far"):
                s.hold(world_to_keys(v["dx"], v["dz"]) or set())
            else:
                s.hold(set())
            if v.get("bossTells", 0) > 0 and v.get("tellAge", 0) >= 0.25:
                n_live += 1
                n_drawn += 1 if v.get("tgBossDrawn", 0) > 0 else 0
                if first is None:
                    first = v
            if v.get("hazards", 0) > 0 and v.get("hazAge", 0) >= 0.5:
                hz_live += 1
                hz_drawn += 1 if v.get("hzDrawn", 0) > 0 else 0
            time.sleep(0.12)
        s.release_all()
        self.snap("step5_rematch_tell")
        self.check("5", n_live >= 3 and n_drawn == n_live,
                   "rematch tells DRAWN: %d of %d samples with a live boss tell (>= 0.25 s old) had it on screen "
                   "(TelegraphView boss decals > 0); first %s" % (n_drawn, n_live, json.dumps(first)))
        self.check("5", hz_live == 0 or hz_drawn == hz_live,
                   "hazards DRAWN: %d of %d samples with a live hazard (>= 0.5 s old) drew it (HazardView > 0)" % (
                       hz_drawn, hz_live))

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
