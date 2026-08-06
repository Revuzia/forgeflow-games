#!/usr/bin/env python
"""DRIFTWAKE Battery C follow-up — the three items pass 1 left open.

  kb     wave knockback on a STUNNED imp at 5 m (pass 1 let it close to melee
         during the cast-clip delay; a stunned body isolates the impulse),
         with sweep.active/reach + mana diagnostics.
  tele   brute telegraph re-measured against registry.time (sim clock), to
         split AI timing from wall-clock frame-rate loss.
  leash  45 s window + sim clock, to observe the full return + heal.
"""
import json, sys, time
from playwright.sync_api import sync_playwright

for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception: pass

URL = "http://localhost:8799/games/driftwake/index.html"

SETUP = r"""
() => {
  const SF = globalThis.SNOWFLOW;
  if (!SF || !SF.combat) return false;
  const E = SF.combat.enemies;
  window.__qa = {
    slotOf(id) {
      for (let i = 0; i < 24; i++) if (E.alive[i] && E.id[i] === id) return i;
      return -1;
    },
    faceAt(i) {
      const p = SF.character.position;
      E.yaw[i] = Math.atan2(p.x - E.x[i], -(p.z - E.z[i]));
    },
    sample(secs, fn) {
      const rec = []; const t0 = performance.now();
      return new Promise(res => {
        const step = () => {
          const t = (performance.now() - t0) / 1000;
          rec.push(fn(t));
          if (t < secs) requestAnimationFrame(step); else res(rec);
        };
        requestAnimationFrame(step);
      });
    },
  };
  SF.combat.encounters.update = () => {};
  E.clear();
  return true;
}
"""

KB = r"""
async () => {
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  const reg = SF.combat.registry;
  E.clear(); C.health = 100; C.mana = 100;
  const p = C.position;
  const id = E.spawn('rime_imp', p.x + 5, p.z, 20);
  const i = Q.slotOf(id);
  reg.damage(id, 1, { cc: 'stun', ccDur: 3 });   // hold it still through the cast
  const s0 = reg.slot(id);
  const hp0 = reg.hp[s0];
  const mana0 = C.mana;
  const dx = E.x[i] - p.x, dz = E.z[i] - p.z;
  const d = Math.hypot(dx, dz);
  SF.spells.aim.set(dx / d, 0, dz / d);
  C.facing = Math.atan2(dz, dx);
  SF.spells.cast(1);
  const rec = await Q.sample(3, t => {
    const s = reg.slot(id);
    const sw = SF.spells.sweep;
    return [t, Math.hypot(E.x[i] - p.x, E.z[i] - p.z),
            s >= 0 ? reg.hp[s] : -1,
            sw.active ? 1 : 0, sw.active ? sw.reach : -1];
  });
  const manaAfterEarly = C.mana;
  E.clear();
  return { hp0, mana0, manaAfter: manaAfterEarly, rec };
}
"""

TELE = r"""
async () => {
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  const reg = SF.combat.registry;
  E.clear(); C.health = 100;
  const p = C.position;
  const id = E.spawn('glacier_brute', p.x + 2, p.z, 10);
  const i = Q.slotOf(id);
  const rec = await Q.sample(9, t => [t, reg.time, E.state[i], C.health]);
  E.clear();
  return { rec };
}
"""

LEASH = r"""
async () => {
  const SF = SNOWFLOW, Q = window.__qa, E = SF.combat.enemies, C = SF.character;
  const reg = SF.combat.registry;
  E.clear(); C.health = 100;
  const p = C.position;
  const px0 = p.x, pz0 = p.z;
  const id = E.spawn('rime_imp', px0 + 12, pz0, 10);
  const i = Q.slotOf(id);
  Q.faceAt(i);
  await Q.sample(1.0, () => 0);
  reg.damage(id, 10);
  p.x = px0 - 80;
  const rec = await Q.sample(45, t => {
    const s = reg.slot(id);
    return [t, reg.time,
            Math.hypot(E.x[i] - E.homeX[i], E.z[i] - E.homeZ[i]),
            E.state[i], s >= 0 ? reg.hp[s] : -1];
  });
  p.x = px0; p.z = pz0;
  const s = reg.slot(id);
  const end = { hp: s >= 0 ? reg.hp[s] : -1,
                hpMax: s >= 0 ? reg.hpMax[s] : -1, state: E.state[i] };
  E.clear();
  return { rec, end };
}
"""

ST = {0:"IDLE",1:"ALERTED",2:"COMBAT",3:"WINDUP",4:"RECOVER",5:"SUBMERGED",
      6:"RETREAT",7:"RETURN",8:"FIRING",9:"DYING"}


def main():
    out = {}
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
        assert pg.evaluate(SETUP)

        # ---- knockback ------------------------------------------------------
        r = pg.evaluate(KB)
        rec = r["rec"]
        hp0 = r["hp0"]
        t_hit = next((s[0] for s in rec if 0 <= s[2] < hp0 - 1e-6), None)
        sw_seen = any(s[3] for s in rec)
        reach_max = max((s[4] for s in rec if s[3]), default=-1)
        if t_hit is not None:
            d_at = next(s[1] for s in rec if s[0] >= t_hit)
            after = [s[1] for s in rec if t_hit <= s[0] <= t_hit + 1.5]
            hp_after = min(s[2] for s in rec if s[2] >= 0)
            out["kb"] = {"tHit": t_hit, "dAtHit": d_at, "dMax": max(after),
                         "kb": max(after) - d_at, "dmg": hp0 - hp_after,
                         "manaSpent": r["mana0"] - r["manaAfter"],
                         "sweepActive": sw_seen, "reachMax": reach_max}
            print(f"KB    stunned imp @ {rec[0][1]:.2f} m: sweep active={sw_seen} "
                  f"(reach max {reach_max:.1f} m), mana spent "
                  f"{r['mana0']-r['manaAfter']:.0f}; hit t={t_hit:.2f} s, dist "
                  f"{d_at:.2f} -> {max(after):.2f} m (knockback {max(after)-d_at:.2f} m), "
                  f"dmg {hp0-hp_after:.1f}")
        else:
            out["kb"] = {"tHit": None, "sweepActive": sw_seen,
                         "reachMax": reach_max,
                         "manaSpent": r["mana0"] - r["manaAfter"],
                         "dSeries": [round(s[1], 2) for s in rec[::20]]}
            print(f"KB    NO HIT. sweep active={sw_seen} reachMax={reach_max} "
                  f"manaSpent={r['mana0']-r['manaAfter']:.0f} "
                  f"dist series {[round(s[1],2) for s in rec[::30]]}")

        # ---- telegraph vs sim clock ----------------------------------------
        r = pg.evaluate(TELE)
        rec = r["rec"]
        tele = []
        t_w = None; st_w = None
        prev = rec[0]
        for s in rec:
            if s[2] == 3 and prev[2] != 3:
                t_w, st_w = s[0], s[1]
            if s[3] < prev[3] - 1e-6 and t_w is not None:
                tele.append({"wallMs": round((s[0]-t_w)*1000),
                             "simMs": round((s[1]-st_w)*1000),
                             "dmg": round(prev[3]-s[3], 2)})
                t_w = None
            prev = s
        wall_s = rec[-1][0] - rec[0][0]
        sim_s = rec[-1][1] - rec[0][1]
        out["tele"] = {"slams": tele, "simPerWall": sim_s / wall_s,
                       "frames": len(rec), "fps": len(rec) / wall_s}
        print(f"TELE  sim/wall={sim_s/wall_s:.3f} ({len(rec)/wall_s:.0f} fps); " +
              "; ".join(f"windup->hit {t['wallMs']} ms wall / {t['simMs']} ms sim, "
                        f"dmg {t['dmg']}" for t in tele))

        # ---- leash 45 s -----------------------------------------------------
        r = pg.evaluate(LEASH)
        rec = r["rec"]
        t_ret = next((s[0] for s in rec if s[3] == 7), None)
        maxHome = max(s[2] for s in rec)
        t_home = next((s[0] for s in rec
                       if t_ret is not None and s[0] > t_ret and s[2] < 1.5), None)
        t_heal = next((s[0] for s in rec if s[4] >= 23.9), None)
        hp_low = min(s[4] for s in rec if s[4] >= 0)
        e = r["end"]
        # transitions for the report
        trans = []
        for a, b in zip(rec, rec[1:]):
            if a[3] != b[3]:
                trans.append((round(b[0], 2), ST[b[3]]))
        out["leash"] = {"tReturn": t_ret, "maxHome": maxHome, "tHome": t_home,
                        "tHeal": t_heal, "hpLow": hp_low, "end": e,
                        "transitions": trans}
        print(f"LEASH chased to {maxHome:.1f} m from home; transitions {trans}; "
              f"home at t={t_home}, healed (hp>=24) at t={t_heal}; "
              f"hp {hp_low:.0f} -> {e['hp']:.1f}/{e['hpMax']:.1f}, "
              f"end {ST.get(e['state'])}")

        br.close()

    with open("qa_battery_c2_last.json", "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
    print("  -> qa_battery_c2_last.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
