#!/usr/bin/env python
"""spray - the P1-A gunplay probe (F:/lc_p1/P1-A/gunplay_probe.py) promoted to a gate (P2-F port): LC-01 recoil pattern, LC-33 bloom,
the disc pellet cone, LC-25 explosion line of sight and the LC-14 frag arc. The features are IN the base (int-p1), so the rows COUNT now.

    python _harness/p23/spray.py --disk
    python _harness/p23/spray.py --rev e10b9836                 # control: the Wave-8 snapshot before P1 (0.52 deg climb, splash through walls) - MUST FAIL
    python _harness/p23/spray.py --disk --plant flat-pattern    # K.RECOIL.ar pitch table x 0.1 - MUST FAIL (no climb to control)
    python _harness/p23/spray.py --disk --plant los-off         # W.map.losBlocked answers "open" - MUST FAIL (splash through the wall)
    python _harness/p23/spray.py --disk --plant cone-leak       # K.effectiveSpread x 0.5 for the pellet check only - MUST FAIL (pellets outside the drawn cone)

PRACTICE (Savanna seed 4242), REAL pointer lock, REAL LMB / RMB, kernel loop frozen, frames stepped by the harness pump. Rows (plan section 5
Gunplay; P1-A's verified numbers in brackets):
  climb [60 / 144 / 30 Hz]   an uncompensated 30-round AR spray in ADS peaks at 3.0-4.0 deg over the start pitch      [3.579 at every rate]
  pattern-identical          the per-shot pitch sequence is the same at 60 / 144 / 30 Hz and on a repeat (<= 0.02 deg)
  recover                    0.6 s after the trigger is released the aim is back within 0.05 deg of the start          [0.25 s]
  pull-down                  a player pulling down 0.8 deg/s through the spray is never dragged under where they pulled to
  smg-cap                    SMG hip spray peak <= 2.9 deg (its cap 0.05 rad)                                           [2.865]
  bloom                      AR standing burst: the spread fire() used on shot 2 <= 0.40 of the full cone; full (>= 0.95) by shot 8
  pellets                    >= 2,000 shotgun pellets: 0 outside the cone fire() used                                    [0 / 10,125]
  blast-los                  W.explode 0.1 m off a real wall: the range dummy 1.5 m BEHIND takes 0; the open-ground control takes > 0
  frag-arc                   3 real frag throws: first bounce within 0.25 m of K.predictArc                              [0.12 m]
  programs                   no shader program linked by the sprays, frags and explosions (rendered frames)
  errors
"""
from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = {
    "flat-pattern": "if (K.RECOIL && K.RECOIL.ar) K.RECOIL.ar.pitch = K.RECOIL.ar.pitch.map((x) => x * 0.1)",
    "los-off": "if (W.map) W.map.losBlocked = () => false",
    "cone-leak": "window.__P23_CONE_LEAK__ = true",
}
CLIMB_LO, CLIMB_HI = 3.0, 4.0

SETUP_JS = r"""() => {
  const W = window.__LC__.W, K = W.SIM;
  if (window.__P23S__) return 'already';
  const Q = window.__P23S__ = { spreads: [], shots: [], pellets: [], ev: [], spreadOn: false, pelOn: false };
  const es = K.effectiveSpread;
  K.effectiveSpread = function (id, r, st) {
    let v = es.call(this, id, r, st);
    if (Q.spreadOn && st && /at fire \(/.test(new Error().stack || '')) {
      const mx = es.call(this, id, r, Object.assign({}, st, { heat: 1, sinceLastShotS: 0 }));
      Q.spreads.push({ id, v, max: mx, t: +W.t.toFixed(4) });
      // planted fault cone-leak: the pellets keep the TRUE cone, the gate is told half of it
      if (window.__P23_CONE_LEAK__ && id === 'shotgun') Q.spreads[Q.spreads.length - 1].v = v * 0.5;
    }
    return v;
  };
  W.events.on('tracer', (p) => { if (Q.pelOn && p && p.ownerId != null && W.player && p.ownerId === W.player.id) Q.pellets.push([p.vx, p.vy, p.vz]); });
  W.events.on('shotFired', (a, wid, m, d) => { if (a === W.player && d) Q.shots.push({ wid, d: [d.x, d.y, d.z], t: +W.t.toFixed(4), n: Q.pellets.length }); });
  for (const name of ['grenadeThrown', 'roundBounce', 'explosion']) W.events.on(name, function () {
    const a = arguments, o = { name, t: +W.t.toFixed(4) };
    if (name === 'grenadeThrown') { o.own = a[0] === W.player; o.o = [a[2].x, a[2].y, a[2].z]; o.v = [a[3].x, a[3].y, a[3].z]; }
    else if (name === 'roundBounce') { o.p = [a[0].x, a[0].y, a[0].z]; o.wid = a[1]; }
    else o.p = [a[0].x, a[0].y, a[0].z];
    Q.ev.push(o); });
  return 'ok'; }"""

SPRAY_JS = r"""([n, dt, pull]) => {
  const W = window.__LC__.W, p = W.player, P = window.__H_PUMP__; const rows = [];
  for (let i = 0; i < n; i++) { if (pull) p.input.pitch -= pull * dt; P.step(1, dt, false);
    rows.push([+W.t.toFixed(4), p.input.pitch, p.input.yaw, W.stats.shotsFired]); }
  return rows; }"""


def deg(r):
    return r * 180.0 / math.pi


def equip(s, idx, obj=None, frames=40):
    if obj is not None:
        s.js("([i, o]) => { const p = window.__LC__.W.player; p.inventory.slots[i] = o; const a = p.inventory.ammo; a.medium = 999; a.light = 999; a.shells = 999; }", [idx, obj])
    s.press("Digit%d" % (idx + 1))
    s.step_frames(frames, 1 / 60)
    return s.js("() => { const p = window.__LC__.W.player; return p.weapon && p.weapon.id; }")


def level(s):
    s.js("() => { const p = window.__LC__.W.player; p.input.pitch = 0; p.recoilPitch = 0; p.recoilYaw = 0; p._rcBase = null; p._rcN = 0; p._heat = 0; p.vel.set(0, 0, 0); }")


def spray(s, hz, frames, wid="ar", pull=0.0):
    dt = 1.0 / hz
    s.js("(w) => { const W = window.__LC__.W, p = W.player; if (p.weapon && p.weapon.id === w) { const d = W.SIM.WEAPONS[w]; p.weapon.magAmmo = d.mag; p.weapon.state = 'ready'; if (p.weapon.slotRef) p.weapon.slotRef.mag = d.mag; } }", wid)
    level(s)
    s.step_frames(int(hz), dt)
    b = s.js("() => { const W = window.__LC__.W, p = W.player; return [p.input.pitch, p.input.yaw, W.stats.shotsFired, p.weapon && p.weapon.id]; }")
    s.page.mouse.down(button="left")
    rows = s.js(SPRAY_JS, [frames, dt, pull])
    s.page.mouse.up(button="left")
    tail = s.js(SPRAY_JS, [int(hz * 0.6), dt, 0])
    per, last = [], b[2]
    for r in rows:
        if r[3] > last:
            per.append(round(deg(r[1] - b[0]), 4))
            last = r[3]
    pulled_to = rows[-1][1]
    return {"hz": hz, "wid": b[3], "shots": rows[-1][3] - b[2], "peakDeg": round(max(deg(r[1] - b[0]) for r in rows), 4), "perShotDeg": per,
            "after06Deg": round(deg(tail[-1][1] - b[0]), 4), "minAfterReleaseVsPull": round(deg(min(r[1] for r in tail) - pulled_to), 4)}


FIND_WALL_JS = r"""() => {
  // a free-standing thin wall (<= 1.2 m thick, >= 4 m long, >= 2.4 m tall, standing on the ground) with open, level ground 2.5 m out on BOTH
  // sides; the whole map is scanned nearest-first (Wave 8's furnished houses left none of P1-A's radius-limited candidates near the spawn)
  const W = window.__LC__.W, p = W.player, M = W.map; const best = [];
  for (const c of M.colliders) {
    if (c.dead || c.kind !== 'box') continue;
    const sx = c.maxX - c.minX, sz = c.maxZ - c.minZ, thin = Math.min(sx, sz), long = Math.max(sx, sz);
    if (thin > 1.2 || thin < 0.15 || long < 4 || c.maxY - c.minY < 2.4) continue;
    const cx = (c.minX + c.maxX) / 2, cz = (c.minZ + c.maxZ) / 2;
    if (Math.abs(cx) > M.half - 20 || Math.abs(cz) > M.half - 20) continue;
    const gy = M.heightAt(cx, cz);
    if (gy < M.waterY + 1 || c.minY > gy + 0.3 || c.maxY < gy + 2.4) continue;
    best.push({ c, cx, cz, gy, n: sx < sz ? [1, 0] : [0, 1], half: thin / 2, d: Math.hypot(cx - p.pos.x, cz - p.pos.z) });
  }
  best.sort((a, b) => a.d - b.d);
  for (const w of best.slice(0, 4000)) { let ok = true;
    for (const sg of [-1, 1]) { const px = w.cx + w.n[0] * sg * (w.half + 2.5), pz = w.cz + w.n[1] * sg * (w.half + 2.5), h = M.heightAt(px, pz);
      if (M.queryColliders(px, pz, 2.2, []).some((o) => o !== w.c && !o.dead && o.maxY > h + 0.3 && o.minY < h + 2.2)) ok = false;
      if (Math.abs(h - w.gy) > 0.4) ok = false; }
    if (ok) { const r = { cx: w.cx, cz: w.cz, gy: w.gy, n: w.n, half: w.half, d: +w.d.toFixed(1), box: [w.c.minX, w.c.minY, w.c.minZ, w.c.maxX, w.c.maxY, w.c.maxZ].map((x) => +x.toFixed(2)) };
      window.__P23S__.wall = r; return r; } }
  window.__P23S__.wall = null; return { none: true, candidates: best.length }; }"""

BLAST_JS = r"""([side]) => {
  const W = window.__LC__.W, w = window.__P23S__.wall, dm = W.rangeDummies && W.rangeDummies[0];
  if (!w || !dm) return null;
  const off = w.half + 1.5, dx = w.cx + w.n[0] * side * off, dz = w.cz + w.n[1] * side * off;
  dm.pos.set(dx, W.map.heightAt(dx, dz), dz); dm.vel.set(0, 0, 0); if (dm.obj) dm.obj.position.copy(dm.pos); dm.hp = 100; dm.shield = 100; dm.alive = true;
  const before = dm.dummyDamage || 0, roll = W._dmgRng; W._dmgRng = () => 0.5;
  const bx = w.cx - w.n[0] * (w.half + 0.1), bz = w.cz - w.n[1] * (w.half + 0.1);
  W.explode(bx, w.gy + 1.0, bz, 'glauncher', 0, W.player.id);
  W._dmgRng = roll;
  return { dealt: (dm.dummyDamage || 0) - before, side }; }"""


def part_recoil(s, v, R):
    equip(s, 1, {"kind": "weapon", "id": "ar", "rarity": 0, "mag": 30})
    s.page.mouse.down(button="right")
    s.step_frames(40, 1 / 60)
    R["ads"] = s.js("() => !!window.__LC__.W.player.input.ads")
    hold = lambda hz, rpm=330, n=30: int(math.ceil((n - 1) * 60.0 / rpm * hz)) + 1
    runs = [spray(s, hz, hold(hz)) for hz in (60, 144, 30)]
    rep = spray(s, 60, hold(60))
    pull = spray(s, 60, hold(60), pull=math.radians(0.8))
    s.page.mouse.up(button="right")
    s.step_frames(20, 1 / 60)
    R["ar"], R["repeat"], R["pull"] = runs, rep, pull
    for r in runs:
        v.check("climb [%d Hz] (uncompensated 30-round AR ADS spray peaks %.1f-%.1f deg)" % (r["hz"], CLIMB_LO, CLIMB_HI),
                R["ads"] and r["shots"] >= 29 and CLIMB_LO <= r["peakDeg"] <= CLIMB_HI, {"peakDeg": r["peakDeg"], "shots": r["shots"], "ads": R["ads"]},
                "%.1f-%.1f deg" % (CLIMB_LO, CLIMB_HI))
    seqs = [r["perShotDeg"] for r in runs + [rep]]
    n = min(len(x) for x in seqs)
    dev = max((abs(a - b) for x in seqs[1:] for a, b in zip(seqs[0][:n], x[:n])), default=None)
    v.check("pattern-identical (per-shot pitch equal at 60 / 144 / 30 Hz and on a repeat)", n >= 29 and dev is not None and dev <= 0.02,
            {"shotsCompared": n, "maxDevDeg": dev}, "<= 0.02 deg")
    v.check("recover (0.6 s after release the aim is within 0.05 deg of the start)", all(abs(r["after06Deg"]) <= 0.05 for r in runs),
            [r["after06Deg"] for r in runs], "|x| <= 0.05")
    v.check("pull-down (recovery never drags under the player's own pull)", pull["minAfterReleaseVsPull"] >= -0.01, {"minVsPullDeg": pull["minAfterReleaseVsPull"]}, ">= -0.01 deg")
    equip(s, 2, {"kind": "weapon", "id": "smg", "rarity": 0, "mag": 30})
    smg = spray(s, 60, hold(60, 720), wid="smg")
    R["smg"] = smg
    v.check("smg-cap (SMG hip spray peak <= 2.9 deg)", smg["shots"] >= 25 and 0.5 <= smg["peakDeg"] <= 2.9, {"peakDeg": smg["peakDeg"], "shots": smg["shots"]}, "0.5-2.9 deg")


def part_bloom(s, v, R):
    equip(s, 1, {"kind": "weapon", "id": "ar", "rarity": 0, "mag": 30})
    s.js("() => { const W = window.__LC__.W, p = W.player; p.weapon.magAmmo = 30; window.__P23S__.spreads.length = 0; window.__P23S__.spreadOn = true; }")
    level(s)
    s.step_frames(60, 1 / 60)
    s.page.mouse.down(button="left")
    s.step_frames(int(60 * 60 / 330.0 * 12) + 2, 1 / 60)
    s.page.mouse.up(button="left")
    rows = s.js("() => { const Q = window.__P23S__; Q.spreadOn = false; return Q.spreads.filter((x) => x.id === 'ar').map((x) => +(x.v / x.max).toFixed(4)); }")
    full = next((i + 1 for i, x in enumerate(rows) if x >= 0.95), None)
    R["bloom"] = {"ratio": rows, "fullFromShot": full}
    v.check("bloom (AR: shot 2 <= 0.40 of the full cone, full by shot 8)", len(rows) >= 8 and rows[1] <= 0.40 and full is not None and full <= 8,
            R["bloom"], "<= 0.40 then full by 8")


def part_pellets(s, v, R, blasts):
    equip(s, 2, {"kind": "weapon", "id": "shotgun", "rarity": 0, "mag": 5})
    level(s)
    s.js("() => { const Q = window.__P23S__; Q.pellets.length = 0; Q.shots.length = 0; Q.spreads.length = 0; Q.spreadOn = true; Q.pelOn = true; }")
    s.step_frames(30, 1 / 60)
    left = blasts
    while left > 0:
        k = min(100, left)
        s.js("""(k) => { const W = window.__LC__.W, p = W.player, P = window.__H_PUMP__;
            for (let i = 0; i < k; i++) { p.weapon.cd = 0; p.weapon.magAmmo = 5; p.weapon.state = 'ready'; p.vel.set(0, 0, 0); p.input.pitch = 0; p.recoilPitch = 0; p._rcBase = null;
              W._fireEdge = performance.now(); P.step(1, 1 / 60, false); } }""", k)
        left -= k
    d = s.js("() => { const Q = window.__P23S__; Q.spreadOn = false; Q.pelOn = false; return { shots: Q.shots.filter((x) => x.wid === 'shotgun'), pellets: Q.pellets.slice(), spreads: Q.spreads.filter((x) => x.id === 'shotgun').map((x) => x.v) }; }")
    out = tot = 0
    worst, prev = 0.0, 0
    for i, sh in enumerate(d["shots"]):
        cone = d["spreads"][i] if i < len(d["spreads"]) else None
        dd = sh["d"]
        for p in d["pellets"][prev:sh["n"]]:
            m = math.sqrt(sum(x * x for x in p)) or 1.0
            ang = math.degrees(math.acos(max(-1.0, min(1.0, sum(a * b for a, b in zip(p, dd)) / m))))
            tot += 1
            if cone:
                worst = max(worst, ang / cone)
                if ang > cone + 1e-9:
                    out += 1
        prev = sh["n"]
    R["pellets"] = {"blasts": len(d["shots"]), "pellets": tot, "outside": out, "worstOverCone": round(worst, 4)}
    v.check("pellets (>= 2,000 shotgun pellets, 0 outside the cone fire() used)", tot >= 2000 and out == 0, R["pellets"], "0 outside")


def part_blast(s, v, R):
    wall = s.js(FIND_WALL_JS)
    R["wall"] = wall
    if not wall or wall.get("none"):
        v.cnj("blast-los (0 damage 1.5 m behind a wall; > 0 on open ground)", "no free-standing thin wall with open ground on both sides on this map: %s" % wall)
        return
    behind = s.js(BLAST_JS, [1])
    open_ = s.js(BLAST_JS, [-1])
    R["blast"] = {"behind": behind, "open": open_}
    v.check("blast-los (W.explode 0.1 m off a wall: 0 damage 1.5 m behind it; > 0 on the open side)",
            behind is not None and open_ is not None and behind["dealt"] == 0 and open_["dealt"] > 0,
            {"behind": behind and behind["dealt"], "open": open_ and open_["dealt"]}, "behind 0, open > 0")


def part_frag(s, v, R):
    if not s.js("() => !!(window.__LC__.W.SIM.CONSUMABLES && window.__LC__.W.SIM.CONSUMABLES.frag && window.__LC__.W.SIM.predictArc)"):
        v.check("frag-arc (first bounce within 0.25 m of K.predictArc)", False, {"frag": "absent in this build"}, "present")
        return
    equip(s, 3, {"kind": "consumable", "id": "frag", "count": 9})
    errs = []
    for pitch in (0.05, 0.3, 0.6):
        s.js("(pt) => { const W = window.__LC__.W, p = W.player; p.input.pitch = pt; p.recoilPitch = 0; p._rcBase = null; window.__P23S__.ev.length = 0; }", pitch)
        s.step_frames(20, 1 / 60)
        s.page.mouse.down(button="left")
        s.step_frames(1, 1 / 60)
        s.page.mouse.up(button="left")
        s.step_frames(int(60 * 3.4), 1 / 60)
        ev = s.js("() => window.__P23S__.ev.slice()")
        thr = next((e for e in ev if e["name"] == "grenadeThrown" and e.get("own")), None)
        bnc = next((e for e in ev if e["name"] == "roundBounce" and e.get("wid") == "frag"), None)
        if not (thr and bnc):
            errs.append(None)
        else:
            pr = s.js("""([o, v]) => { const W = window.__LC__.W, K = W.SIM;
                const r = K.predictArc(o[0], o[1], o[2], v[0], v[1], v[2], K.FRAG.gravity, 5, (x, z) => W.map.heightAt(x, z), (x, z, rr, b) => W.map.queryColliders(x, z, rr, b), []);
                return [r.x, r.y, r.z]; }""", [thr["o"], thr["v"]])
            errs.append(round(math.sqrt(sum((a - b) ** 2 for a, b in zip(pr, bnc["p"]))), 4))
        if s.js("() => window.__LC__.W.player.inventory.active") != 3:
            s.press("Digit4")
        s.step_frames(60, 1 / 60)
    R["frag"] = errs
    v.check("frag-arc (3 real throws: first bounce within 0.25 m of K.predictArc)", len(errs) == 3 and all(e is not None and e <= 0.25 for e in errs), errs, "<= 0.25 m")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    ap.add_argument("--blasts", type=int, default=260)
    args = L.parse(ap)

    def body(v):
        with C.Session(args, "p23_spray") as s:
            v.data["setup"] = L.practice(s, 4242, "ashgrid")
            s.js(SETUP_JS)
            if args.plant:
                L.plant_js(s, PLANTS[args.plant])
            s.step_frames(30, 1 / 60, render=True)
            prog0 = L.programs(s)
            v.data["lock_s"] = L.lock_pointer(s)
            s.step_frames(10, 1 / 60)
            R = v.data["rows"] = {}
            part_recoil(s, v, R)
            part_bloom(s, v, R)
            part_pellets(s, v, R, args.blasts)
            s.guard_player(False)
            part_frag(s, v, R)
            s.guard_player(True)
            part_blast(s, v, R)
            s.page.mouse.up(button="left")
            s.step_frames(40, 1 / 60, render=True)
            prog1 = L.programs(s)
            v.check("programs (no shader linked by sprays / frags / explosions)", prog0 is not None and prog1 == prog0, {"before": prog0, "after": prog1}, "unchanged")
            L.errors_row(v, s)
    return C.run_gate("p23_spray", body, args)


if __name__ == "__main__":
    sys.exit(main())
