#!/usr/bin/env python
"""BATTERY A — spell damage E2E vs the training dummies, through the LIVE game.

Drives http://localhost:8799/games/driftwake/index.html with playwright
(channel chrome, headed). navigator.webdriver => AUTOPLAY, so the sim runs
without the shell. All measurements are read back from the Damageable
registry (SNOWFLOW.combat.registry) via a per-frame rAF recorder.

Timing: the page runs slow under automation on this box and the engine clamps
per-frame dt, so GAME time advances slower than wall clock. Every wait is
therefore condition-based (spell object goes inactive) with a wall timeout,
and each test reports the median game dt so tick-capped DoT numbers can be
interpreted.

Normalisation: spellHits.damageMult is recorded and pinned to 1.0. Dummy HP
is topped back up between tests.
"""
import json, math, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/driftwake/index.html"

HELPERS = r"""
() => {
  const SF = globalThis.SNOWFLOW;
  const reg = SF.combat.registry;
  window.__qa = {
    dummies() {
      return SF.combat.dummies.list.map(d => {
        const s = d.id >= 0 ? reg.slot(d.id) : -1;
        return { name: d.name, tier: d.tier, id: d.id, alive: d.alive,
                 hp: s >= 0 ? reg.hp[s] : 0, hpMax: d.hpMax,
                 x: d.x, y: d.y, z: d.z };
      });
    },
    state() {
      const c = SF.character;
      return { px: c.position.x, py: c.position.y, pz: c.position.z,
               facing: c.facing, speed: c.speed, mana: c.mana,
               manaMax: c.manaMax,
               level: SF.progression ? SF.progression.level : null,
               dmgMult: SF.combat.spellHits.damageMult,
               time: reg.time };
    },
    normalize() { SF.combat.spellHits.damageMult = 1.0; },
    healAll() {
      for (const d of SF.combat.dummies.list) {
        if (d.id < 0) continue;
        const s = reg.slot(d.id);
        if (s >= 0) { reg.hp[s] = reg.hpMax[s]; reg.poise[s] = reg.poiseMax[s];
                      reg.stunUntil[s] = 0; reg.staggerUntil[s] = 0;
                      reg.chill[s] = 0; reg.brittleUntil[s] = 0; }
      }
    },
    refill() {
      SF.character.mana = SF.character.manaMax;
      const cd = SF.spells._cdUntil;
      for (const k of [1,2,3,4,5]) cd[k] = 0;
    },
    tp(x, z) {
      const c = SF.character;
      c.position.x = x; c.position.z = z;
      c.position.y = SF.terrain.heightAt(x, z);
      c.velocity.set(0, 0, 0);
    },
    /** Point rig (yaw/pitch), spells.aim and body facing at world (tx,ty,tz). */
    aimAt(tx, ty, tz) {
      const rig = SF.rig;
      const eye = rig.camera.position;
      let dx = tx - eye.x, dy = ty - eye.y, dz = tz - eye.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      rig.yaw = Math.atan2(dx, -dz);
      rig.pitch = Math.min(1.05, Math.max(-0.62, Math.asin(-dy)));
      rig.forward.set(dx, dy, dz);
      SF.spells.aim.set(dx, dy, dz);
      const c = SF.character;
      const fx = tx - c.position.x, fz = tz - c.position.z;
      c.facing = Math.atan2(fx, -fz);
      return { eye: [eye.x, eye.y, eye.z], dir: [dx, dy, dz] };
    },
    /** aimAt + cast atomically, and report where the eye-ray targeting lands. */
    aimCast(k, tx, ty, tz) {
      const a = this.aimAt(tx, ty, tz);
      SF.spells.cast(k);
      return a;
    },
    cast(k) { SF.spells.cast(k); },
    holdBolt(on) { SF.spells.debugRibbon = !!on; },   // poll-proof hold
    active() {
      const sp = SF.spells;
      return { sweep: sp.sweep.active, bloom: sp.bloom.active,
               crys: sp.crystallize.active, vortex: sp.vortex.active,
               ribbon: sp.ribbon.active, pending: sp._pending.key || 0 };
    },
    recStart(ids) {
      const r = window.__rec = { on: true, ids: ids.slice(), rows: [] };
      const step = () => {
        if (!r.on) return;
        const bl = SF.spells.bloom, vx = SF.spells.vortex,
              rb = SF.spells.ribbon, sw = SF.spells.sweep;
        const row = { t: reg.time, w: performance.now(),
                      bloom: bl.active ? { b: !!bl._burst, x: bl.x, y: bl.y, z: bl.z, t: bl.t } : null,
                      vor: vx.active ? { ring: vx.ring, x: vx.x, z: vx.z, t: vx.t } : null,
                      rib: rb.active ? { thrown: !!rb.thrown, spl: !!rb._splashed,
                                         tx: rb.tipX, ty: rb.tipY, tz: rb.tipZ } : null,
                      sweep: sw.active ? { t: sw.t, reach: sw.reach } : null,
                      d: [] };
        for (const id of r.ids) {
          const s = reg.slot(id);
          row.d.push(s < 0 ? null :
            { hp: reg.hp[s], stun: reg.stunUntil[s], stag: reg.staggerUntil[s],
              poise: reg.poise[s], slowU: reg.slowUntil[s], slowF: reg.slowFrac[s] });
        }
        r.rows.push(row);
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    recStop() { const r = window.__rec; r.on = false; return r.rows; },
  };
  return true;
}
"""


def drops(rows, di):
    out = []
    prev = None
    for row in rows:
        d = row["d"][di]
        if d is None:
            prev = None
            continue
        if prev is not None and d["hp"] < prev - 1e-4:
            out.append((row["t"], prev - d["hp"]))
        prev = d["hp"]
    return out


def dt_stats(rows):
    """Median game dt and wall dt per recorded frame, + game/wall ratio."""
    gd = [rows[i]["t"] - rows[i - 1]["t"] for i in range(1, len(rows))]
    wd = [(rows[i]["w"] - rows[i - 1]["w"]) / 1000 for i in range(1, len(rows))]
    gd.sort(); wd.sort()
    if not gd:
        return {}
    m = len(gd) // 2
    span_g = rows[-1]["t"] - rows[0]["t"]
    span_w = (rows[-1]["w"] - rows[0]["w"]) / 1000
    return {"game_dt": gd[m], "wall_dt": wd[m], "fps": 1 / wd[m] if wd[m] else None,
            "ratio": span_g / span_w if span_w else None}


def main():
    report = {}
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel="chrome", headless=False, args=[
            "--ignore-gpu-blocklist", "--use-angle=d3d11",
            "--disable-gpu-sandbox", "--enable-gpu-rasterization"])
        pg = br.new_page(viewport={"width": 1280, "height": 720})
        pg.goto(URL, wait_until="load", timeout=120_000)
        end = time.time() + 180
        while time.time() < end and not pg.evaluate(
                "!!(globalThis.SNOWFLOW && SNOWFLOW.combat)"):
            pg.wait_for_timeout(400)
        if not pg.evaluate("!!(globalThis.SNOWFLOW && SNOWFLOW.combat)"):
            print("FATAL: SNOWFLOW.combat never appeared"); return 1
        pg.wait_for_timeout(3000)
        pg.evaluate(HELPERS)

        def wait_quiet(timeout_s=40):
            """Wait until no spell volume is active and nothing is pending."""
            t_end = time.time() + timeout_s
            while time.time() < t_end:
                a = pg.evaluate("__qa.active()")
                if not any([a["sweep"], a["bloom"], a["crys"], a["vortex"],
                            a["ribbon"], a["pending"]]):
                    return True
                pg.wait_for_timeout(300)
            return False

        st0 = pg.evaluate("__qa.state()")
        print(f"state: level={st0['level']} dmgMult={st0['dmgMult']:.4f} "
              f"mana={st0['mana']:.0f}/{st0['manaMax']}")
        pg.evaluate("__qa.normalize()")
        report["session"] = st0

        dums = pg.evaluate("__qa.dummies()")
        for d in dums:
            print(f"  {d['name']:<14} tier={d['tier']} hp={d['hp']:.0f}/{d['hpMax']} "
                  f"at ({d['x']:.2f},{d['z']:.2f})")
        report["dummies"] = dums

        def dummy(name):
            for d in pg.evaluate("__qa.dummies()"):
                if d["name"].startswith(name):
                    return d
            return None

        def toward_spawn(d, dist):
            dx, dz = -d["x"], -d["z"]
            l = math.hypot(dx, dz) or 1
            return d["x"] + dx / l * dist, d["z"] + dz / l * dist

        def place(px, pz):
            pg.evaluate(f"__qa.tp({px}, {pz})")
            pg.evaluate("__qa.healAll(); __qa.refill()")
            pg.wait_for_timeout(2000)     # camera settles

        # ============================================== A1 wave center hit
        g = dummy("Glacier")
        px, pz = toward_spawn(g, 7.0)
        place(px, pz)
        pg.evaluate(f"__qa.recStart([{g['id']}])")
        pg.evaluate(f"__qa.aimCast(1, {g['x']}, {g['y'] + 0.5}, {g['z']})")
        wait_quiet()
        rows = pg.evaluate("__qa.recStop()")
        dr = drops(rows, 0)
        st = dt_stats(rows)
        total = sum(a for _, a in dr)
        print(f"\nA1 WAVE vs Glacier @7m: hits={len(dr)} total={total:.2f} "
              f"per-hit={[round(a, 2) for _, a in dr]}  "
              f"[game dt {st['game_dt']:.3f}s, {st['fps']:.1f} fps]")
        report["A1_wave"] = {"drops": dr, "total": total, "dt": st}

        # ============================================== A2 wave one-hit-per-cast
        # Stand behind the Rime/Floe midpoint: both totems near the arc
        # center where bell(u) is meaningful; Frost/Glacier at the horns.
        dums = pg.evaluate("__qa.dummies()")
        r_, f_ = dums[1], dums[2]                     # Rime, Floe
        mx, mz = (r_["x"] + f_["x"]) / 2, (r_["z"] + f_["z"]) / 2
        dxc, dzc = -mx, -mz
        lc = math.hypot(dxc, dzc) or 1
        px, pz = mx + dxc / lc * 8.0, mz + dzc / lc * 8.0
        place(px, pz)
        dums = pg.evaluate("__qa.dummies()")
        ids = [d["id"] for d in dums]
        pg.evaluate(f"__qa.recStart({json.dumps(ids)})")
        pg.evaluate(f"__qa.aimCast(1, {mx}, {dums[1]['y'] + 0.5}, {mz})")
        wait_quiet()
        rows = pg.evaluate("__qa.recStop()")
        a2 = {}
        print(f"\nA2 WAVE one-hit-per-cast (player at {px:.1f},{pz:.1f}):")
        for i, d in enumerate(dums):
            dr = drops(rows, i)
            tot = sum(a for _, a in dr)
            dist = math.hypot(d["x"] - px, d["z"] - pz)
            a2[d["name"]] = {"hits": len(dr), "total": tot, "dist": dist,
                             "per_hit": [round(a, 2) for _, a in dr]}
            print(f"  {d['name']:<14} dist={dist:5.1f}m  hits={len(dr)}  "
                  f"total={tot:6.2f}  per-hit={[round(a, 2) for _, a in dr]}")
        report["A2_wave_onehit"] = a2

        # ============================================== A3 bloom at 2 ranges
        g = dummy("Glacier")
        a3 = []
        for label, offx in (("center", 0.0), ("offset", 1.7)):
            px, pz = toward_spawn(g, 8.0)
            place(px, pz)
            gg = dummy("Glacier")
            pg.evaluate(f"__qa.recStart([{gg['id']}])")
            aim = pg.evaluate(
                f"__qa.aimCast(3, {g['x'] + offx}, {g['y']}, {g['z']})")
            wait_quiet()
            rows = pg.evaluate("__qa.recStop()")
            dr = drops(rows, 0)
            burst = max((a for _, a in dr), default=0.0)
            total = sum(a for _, a in dr)
            bx = bz = by = None
            for row in rows:
                if row["bloom"] and row["bloom"]["b"]:
                    bx, by, bz = (row["bloom"]["x"], row["bloom"]["y"],
                                  row["bloom"]["z"])
                    break
            dist = (math.hypot(g["x"] - bx, g["z"] - bz)
                    if bx is not None else None)
            expd = None
            if dist is not None:
                inner = 0.8
                fr = min(1.0, max(0.0, (dist - inner) / 1.2))
                expd = 35 + (18 - 35) * fr
            print(f"\nA3 BLOOM {label}: burst drop={burst:.2f}  "
                  f"total(+column)={total:.2f}  burst at "
                  f"({bx and round(bx,2)},{bz and round(bz,2)}) "
                  f"dist-from-dummy={dist and round(dist, 3)}m  "
                  f"design@dist={expd and round(expd, 2)}")
            a3.append({"label": label, "burst": burst, "total": total,
                       "burst_xyz": [bx, by, bz], "dist": dist,
                       "design_at_dist": expd, "aim": aim,
                       "drops": [(round(t, 2), round(a, 3)) for t, a in dr]})
        report["A3_bloom"] = a3

        # ============================================== A4 spikes + stun (LIGHT)
        r = dummy("Rime")
        px, pz = toward_spawn(r, 8.0)
        place(px, pz)
        rr = dummy("Rime")
        pg.evaluate(f"__qa.recStart([{rr['id']}])")
        pg.evaluate(f"__qa.aimCast(4, {r['x']}, {r['y']}, {r['z']})")
        wait_quiet()
        rows = pg.evaluate("__qa.recStop()")
        dr = drops(rows, 0)
        total = sum(a for _, a in dr)
        stun_m = max((row["d"][0]["stun"] - row["t"] for row in rows
                      if row["d"][0]), default=0.0)
        stag_m = max((row["d"][0]["stag"] - row["t"] for row in rows
                      if row["d"][0]), default=0.0)
        print(f"\nA4 SPIKES vs Rime (light): hits={len(dr)} total={total:.2f} "
              f"per-hit={[round(a, 2) for _, a in dr]}  "
              f"stunUntil-time max={stun_m:.2f}s  stagger max={stag_m:.2f}s")
        report["A4_spikes"] = {"drops": dr, "total": total,
                               "stun_margin": stun_m, "stagger_margin": stag_m}

        # spikes vs fodder for the record (24 hp < 30: dies)
        f = dummy("Frost")
        px, pz = toward_spawn(f, 8.0)
        place(px, pz)
        ff = dummy("Frost")
        pg.evaluate(f"__qa.recStart([{ff['id']}])")
        pg.evaluate(f"__qa.aimCast(4, {f['x']}, {f['y']}, {f['z']})")
        wait_quiet()
        rows = pg.evaluate("__qa.recStop()")
        dr = drops(rows, 0)
        gone = any(row["d"][0] is None for row in rows[3:])
        last_hp = next((row["d"][0]["hp"] for row in reversed(rows)
                        if row["d"][0] is not None), None)
        print(f"A4b SPIKES vs Frost (fodder 24hp): drops="
              f"{[(round(t, 2), round(a, 2)) for t, a in dr]} "
              f"slot-reaped={gone} last_hp={last_hp}")
        report["A4b_spikes_fodder"] = {"drops": dr, "reaped": gone}

        # ============================================== A5 vortex DoT
        g = dummy("Glacier")
        px, pz = toward_spawn(g, 1.3)
        place(px, pz)
        gg = dummy("Glacier")
        pg.evaluate(f"__qa.recStart([{gg['id']}])")
        pg.evaluate(f"__qa.aimCast(5, {g['x']}, {g['y'] + 0.8}, {g['z']})")
        wait_quiet(timeout_s=60)
        rows = pg.evaluate("__qa.recStop()")
        dr = drops(rows, 0)
        st = dt_stats(rows)
        total = sum(a for _, a in dr)
        # dps inside the steady hold: vortex t in [ramp+0.2, ramp+2.2]
        hp_a = hp_b = ta = tb = None
        for row in rows:
            d = row["d"][0]
            v = row["vor"]
            if d is None or v is None:
                continue
            if v["t"] >= 0.75 and hp_a is None:
                hp_a, ta = d["hp"], row["t"]
            if v["t"] <= 2.75:
                hp_b, tb = d["hp"], row["t"]
        dps = ((hp_a - hp_b) / (tb - ta)) if hp_a is not None and tb and tb > ta else None
        ticks = [a for _, a in dr]
        avg_tick = sum(ticks) / len(ticks) if ticks else 0
        print(f"\nA5 VORTEX vs Glacier @1.3m: dps(2s hold window)="
              f"{dps and round(dps, 2)}  total={total:.2f}  ticks={len(dr)} "
              f"avg-tick={avg_tick:.3f}  "
              f"[game dt {st['game_dt']:.3f}s vs tickCap 0.05 -> paid "
              f"{min(0.05, st['game_dt']) / st['game_dt'] * 100:.0f}% of contact time]")
        report["A5_vortex"] = {"dps_window": dps, "total": total,
                               "ticks": len(dr), "avg_tick": avg_tick, "dt": st}

        # ============================================== A6 bolt (thrown ribbon)
        g = dummy("Glacier")
        a6 = []
        for attempt in range(3):
            px, pz = toward_spawn(g, 10.0)
            place(px, pz)
            gg = dummy("Glacier")
            pg.evaluate(f"__qa.recStart([{gg['id']}])")
            pg.evaluate(f"__qa.aimAt({g['x']}, {g['y'] + 0.85}, {g['z']}); "
                        "__qa.holdBolt(true)")
            pg.wait_for_timeout(1500)      # build the stream (slow frames)
            pg.evaluate(f"__qa.aimAt({g['x']}, {g['y'] + 0.85}, {g['z']}); "
                        "__qa.holdBolt(false)")
            wait_quiet()
            rows = pg.evaluate("__qa.recStop()")
            dr = drops(rows, 0)
            total = sum(a for _, a in dr)
            thrown = any(row["rib"] and row["rib"]["thrown"] for row in rows)
            a6.append({"attempt": attempt + 1, "total": total, "thrown": thrown,
                       "drops": [(round(t, 2), round(a, 2)) for t, a in dr]})
            print(f"A6 BOLT attempt {attempt + 1}: thrown={thrown} drops="
                  f"{[(round(t, 2), round(a, 2)) for t, a in dr]} total={total:.2f}")
            if total > 0:
                break
        report["A6_bolt"] = a6

        br.close()

    with open("qa_battery_a_last.json", "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=1)
    print("\n-> qa_battery_a_last.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
