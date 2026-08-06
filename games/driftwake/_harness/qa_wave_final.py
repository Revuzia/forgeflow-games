#!/usr/bin/env python
"""Wave finals — A1 center-bell damage + A2 one-hit-per-cast, with the aim
direction taken from the PLAYER (the sweep's own origin), not the eye, so
camera parallax after a teleport cannot rotate the crescent off target.

Two casts for A2: verifies at-most-one hit per dummy per cast, twice.
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
        return { name: d.name, tier: d.tier, id: d.id,
                 hp: s >= 0 ? reg.hp[s] : 0, hpMax: d.hpMax,
                 x: d.x, y: d.y, z: d.z };
      });
    },
    prep(x, z) {
      const c = SF.character;
      c.position.x = x; c.position.z = z;
      c.position.y = SF.terrain.heightAt(x, z);
      c.velocity.set(0, 0, 0);
      for (const d of SF.combat.dummies.list) {
        if (d.id < 0) continue;
        const s = reg.slot(d.id);
        if (s >= 0) { reg.hp[s] = reg.hpMax[s]; reg.poise[s] = reg.poiseMax[s]; }
      }
      c.mana = c.manaMax;
      for (const k of [1,2,3,4,5]) SF.spells._cdUntil[k] = 0;
      SF.combat.spellHits.damageMult = 1.0;
    },
    /** Wave cast with the aim taken player->target (the sweep's own frame). */
    waveAt(tx, tz) {
      const c = SF.character;
      let dx = tx - c.position.x, dz = tz - c.position.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      SF.spells.aim.set(dx, 0, dz);
      SF.rig.yaw = Math.atan2(dx, -dz);
      c.facing = Math.atan2(dx, -dz);
      SF.spells.cast(1);
    },
    quiet() {
      return !SF.spells.sweep.active && !SF.spells._pending.key;
    },
    recStart(ids) {
      const r = window.__rec = { on: true, ids: ids.slice(), rows: [] };
      const step = () => {
        if (!r.on) return;
        const row = { t: reg.time, hp: [] };
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


def drops(rows, di):
    out = []
    prev = None
    for row in rows:
        hp = row["hp"][di]
        if hp is None:
            prev = None
            continue
        if prev is not None and hp < prev - 1e-4:
            out.append((row["t"], prev - hp))
        prev = hp
    return out


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

        def wait_done(min_s=3, timeout_s=40):
            t0 = time.time()
            while time.time() - t0 < timeout_s:
                if time.time() - t0 > min_s and pg.evaluate("__qa.quiet()"):
                    return
                pg.wait_for_timeout(300)

        dums = pg.evaluate("__qa.dummies()")

        # ---- A1: wave dead-center on the Glacier Totem from 7 m ----------
        g = dums[3]
        l = math.hypot(g["x"], g["z"]) or 1
        px, pz = g["x"] - g["x"] / l * 7.0, g["z"] - g["z"] / l * 7.0
        pg.evaluate(f"__qa.prep({px}, {pz})")
        pg.wait_for_timeout(1200)
        pg.evaluate(f"__qa.recStart([{g['id']}])")
        pg.evaluate(f"__qa.waveAt({g['x']}, {g['z']})")
        wait_done()
        rows = pg.evaluate("__qa.recStop()")
        dr = drops(rows, 0)
        print(f"A1 WAVE center vs Glacier @7m (player-origin aim): "
              f"hits={len(dr)} per-hit={[round(a, 2) for _, a in dr]}")

        # ---- A2: one-hit-per-cast, aimed between Rime and Floe, twice ----
        r_, f_ = dums[1], dums[2]
        mx, mz = (r_["x"] + f_["x"]) / 2, (r_["z"] + f_["z"]) / 2
        lc = math.hypot(mx, mz) or 1
        px, pz = mx - mx / lc * 8.0, mz - mz / lc * 8.0
        for cast in (1, 2):
            pg.evaluate(f"__qa.prep({px}, {pz})")
            pg.wait_for_timeout(1200)
            dd = pg.evaluate("__qa.dummies()")
            ids = [d["id"] for d in dd]
            pg.evaluate(f"__qa.recStart({json.dumps(ids)})")
            pg.evaluate(f"__qa.waveAt({mx}, {mz})")
            wait_done()
            rows = pg.evaluate("__qa.recStop()")
            print(f"A2 WAVE cast {cast} (player at {px:.1f},{pz:.1f} "
                  f"aim at Rime/Floe midpoint):")
            for i, d in enumerate(dd):
                dr = drops(rows, i)
                dist = math.hypot(d["x"] - px, d["z"] - pz)
                print(f"  {d['name']:<14} dist={dist:5.1f}m hits={len(dr)} "
                      f"per-hit={[round(a, 2) for _, a in dr]}")
        br.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
