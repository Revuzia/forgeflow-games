#!/usr/bin/env python
"""Wave hit diagnostic — why do near-arc dummies miss at low fps?

Replays the A2 scenario (stand behind the Rime/Floe midpoint, cast wave at
the midpoint), recording the sweep's OWN state (t, reach, ox/oz, dx/dz) per
frame, then recomputes every spellHits._wave gate per dummy per frame
offline: ring band from the crescent center k, arc angle, bell(u), env,
height gate. Prints, for each dummy, the frames where it was inside the ring
and which gate passed/failed.
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
        return { name: d.name, tier: d.tier, id: d.id, hp: s >= 0 ? reg.hp[s] : 0,
                 x: d.x, y: d.y, z: d.z,
                 radius: s >= 0 ? reg.radius[s] : 0,
                 ry: s >= 0 ? reg.y[s] : 0,
                 ground: SF.terrain.heightAt(d.x, d.z) };
      });
    },
    heal() {
      for (const d of SF.combat.dummies.list) {
        if (d.id < 0) continue;
        const s = reg.slot(d.id);
        if (s >= 0) { reg.hp[s] = reg.hpMax[s]; reg.poise[s] = reg.poiseMax[s]; }
      }
      SF.character.mana = SF.character.manaMax;
      for (const k of [1,2,3,4,5]) SF.spells._cdUntil[k] = 0;
    },
    tp(x, z) {
      const c = SF.character;
      c.position.x = x; c.position.z = z;
      c.position.y = SF.terrain.heightAt(x, z);
      c.velocity.set(0, 0, 0);
    },
    aimCast(tx, ty, tz) {
      const rig = SF.rig;
      const eye = rig.camera.position;
      let dx = tx - eye.x, dy = ty - eye.y, dz = tz - eye.z;
      const l = Math.hypot(dx, dy, dz) || 1;
      dx /= l; dy /= l; dz /= l;
      rig.yaw = Math.atan2(dx, -dz);
      rig.pitch = Math.min(1.05, Math.max(-0.62, Math.asin(-dy)));
      rig.forward.set(dx, dy, dz);
      SF.spells.aim.set(dx, dy, dz);
      SF.spells.cast(1);
    },
    recStart(ids) {
      const r = window.__rec = { on: true, ids: ids.slice(), rows: [] };
      const step = () => {
        if (!r.on) return;
        const sw = SF.spells.sweep;
        const row = { t: reg.time,
                      sw: sw.active ? { t: sw.t, reach: sw.reach, ox: sw.ox,
                                        oz: sw.oz, dx: sw.dx, dz: sw.dz } : null,
                      hp: [] };
        for (const id of r.ids) {
          const s = reg.slot(id);
          row.hp.push(s < 0 ? null : reg.hp[s]);
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

CURVE, THICK, ARC0, ARC1, PEAK, LIFE, SINK, GATE = 5.5, 0.7, 0.52, 0.96, 2.15, 2.4, 0.13, 0.05


def clamp01(x): return 0 if x < 0 else (1 if x > 1 else x)


def smooth01(x):
    x = clamp01(x)
    return x * x * (3 - 2 * x)


def bell(u):
    s = math.sin(math.pi * clamp01(u))
    return s * s


def main():
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
        pg.wait_for_timeout(3000)
        pg.evaluate(HELPERS)

        dums = pg.evaluate("__qa.dummies()")
        r_, f_ = dums[1], dums[2]
        mx, mz = (r_["x"] + f_["x"]) / 2, (r_["z"] + f_["z"]) / 2
        lc = math.hypot(mx, mz) or 1
        px, pz = mx - mx / lc * 8.0, mz - mz / lc * 8.0
        pg.evaluate(f"__qa.tp({px}, {pz})")
        pg.evaluate("__qa.heal()")
        pg.wait_for_timeout(2000)
        dums = pg.evaluate("__qa.dummies()")
        ids = [d["id"] for d in dums]
        pg.evaluate(f"__qa.recStart({json.dumps(ids)})")
        pg.evaluate(f"__qa.aimCast({mx}, {dums[1]['y'] + 0.5}, {mz})")
        t_end = time.time() + 40
        while time.time() < t_end:
            a = pg.evaluate(
                "SNOWFLOW.spells.sweep.active || !!SNOWFLOW.spells._pending.key")
            if not a and time.time() > t_end - 38:
                # give the strike delay a chance to arm before trusting quiet
                if pg.evaluate("SNOWFLOW.spells.sweep.active === false && "
                               "!SNOWFLOW.spells._pending.key"):
                    if time.time() - (t_end - 40) > 4:
                        break
            pg.wait_for_timeout(300)
        rows = pg.evaluate("__qa.recStop()")
        br.close()

    print(f"player at ({px:.2f},{pz:.2f}); {len(rows)} frames recorded")
    for i, d in enumerate(dums):
        print(f"\n== {d['name']} at ({d['x']:.2f},{d['z']:.2f}) "
              f"radius={d['radius']:.2f} regY={d['ry']:.2f} ground={d['ground']:.2f}")
        hits = 0
        prev_hp = None
        for row in rows:
            sw = row["sw"]
            hp = row["hp"][i]
            if prev_hp is not None and hp is not None and hp < prev_hp - 1e-4:
                print(f"   t={row['t']:.2f}  *** HIT for {prev_hp - hp:.2f}")
                hits += 1
            prev_hp = hp
            if not sw:
                continue
            spread = clamp01((sw["reach"] - 1.4) / 14)
            arc = ARC0 + (ARC1 - ARC0) * spread
            kx = sw["ox"] + sw["dx"] * (sw["reach"] - CURVE)
            kz = sw["oz"] + sw["dz"] * (sw["reach"] - CURVE)
            dx = d["x"] - kx
            dz = d["z"] - kz
            dd = math.hypot(dx, dz)
            in_ring = not (dd + d["radius"] < CURVE - THICK or
                           dd - d["radius"] > CURVE + THICK)
            if not in_ring:
                continue
            life01 = sw["t"] / LIFE
            rise = smooth01(sw["t"] / 0.26)
            fall = 1 - clamp01((life01 - 0.55) / 0.45)
            env = rise * fall * fall
            ang = math.acos(max(-1, min(1, (dx * sw["dx"] + dz * sw["dz"]) / max(1e-6, dd))))
            width = math.atan2(d["radius"], max(0.5, dd))
            in_arc = ang <= arc + width
            along = dx * sw["dx"] + dz * sw["dz"]
            lateral = dx * sw["dz"] + dz * (-sw["dx"])
            th = math.atan2(lateral, along)
            u = clamp01(th / (2 * arc) + 0.5)
            b = bell(u)
            hgt_ok = d["ry"] <= (d["ground"] - SINK) + PEAK * env
            print(f"   t={row['t']:.2f} sw.t={sw['t']:.2f} reach={sw['reach']:5.2f} "
                  f"d(k)={dd:5.2f} IN-RING arc={arc:.2f} ang={ang:.2f} "
                  f"inArc={in_arc} u={u:.2f} bell={b:.2f} env={env:.2f} "
                  f"envOK={env >= GATE} hgtOK={hgt_ok} "
                  f"-> dmg={20 * b * env:.1f}")
        print(f"   hits={hits}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
