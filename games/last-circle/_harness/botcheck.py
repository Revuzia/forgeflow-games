"""Measure how well the NPC bots actually play.

Runs headless matches through __LC__.fastForward (deterministic, no rAF) and
samples every bot twice a second. Reports the three complaints as NUMBERS so a
fix can be shown to move them:

  STUCK   alive, in a moving state, and displaced < 0.4 m over 3 s
  DRY     holding a gun with 0 in the mag AND 0 matching reserve - it cannot
          shoot no matter how well it aims
  FIRING  share of samples with the fire input held
  HITREG  hurt events caused by bots per bot trigger pull ('shotFired'), per weapon (shotgun pellets hit separately) -
          PLAN L6 "botcheck hit registration unchanged": compare before / after

Retargeted 2026-09-30 (lane L1) onto common.py: --base (default the scoped :8790 server) / --disk / --rev, headless by
default, and the lobby helper (startMatch -> a REAL Enter with the kernel loop frozen) so W.phase reaches the drop and
the match with the storm ON (the old driver stayed in the lobby: storm off). Information only: exit 0 when the matches
ran, 2 when the environment stopped them, 1 only on a page error.

    python _harness/botcheck.py --seeds 1,2,3 --map isla_viva --disk
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

RUN = r"""
async ([seed, mapId, seconds, stepS, skipStart]) => {
  const C = window.__LC__, W = C.W;
  if (!skipStart) await C.startMatch({ mapId, mode: "standard", seed });
  // hit registration (PLAN L6: "botcheck hit registration unchanged"): bot trigger pulls vs hurt events a bot caused.
  // W.events has no off(): a generation token retires the listeners of an earlier run in the same page.
  const gen = window.__bcGen = (window.__bcGen || 0) + 1;
  const HR = { shots: 0, hits: 0, byW: {} };
  W.events.on("shotFired", (a, wid) => { if (window.__bcGen !== gen || !a || !a.isBot) return; HR.shots++;
    const r = HR.byW[wid] = HR.byW[wid] || { shots: 0, hits: 0 }; r.shots++; });
  W.events.on("actorHurt", (v, info) => { if (window.__bcGen !== gen || !info) return; const k = W.actorById.get(info.attackerId);
    if (!k || !k.isBot) return; HR.hits++; const r = HR.byW[info.weaponId] = HR.byW[info.weaponId] || { shots: 0, hits: 0 }; r.hits++; });
  // let the match settle (actors spawned, loot placed)
  C.fastForward(2, stepS);

  const samples = [];
  const SLICE = 0.5;
  for (let t = 0; t < seconds; t += SLICE) {
    C.fastForward(SLICE, stepS);
    if (W.match && W.match.over) break;
    const row = [];
    for (const a of W.actors) {
      if (!a || !a.alive) continue;
      if (W.player && a === W.player) continue;
      let reserve = 0;
      try { for (const k in a.inventory.ammo) reserve += a.inventory.ammo[k] | 0; } catch (e) {}
      const mag = (a.weapon && a.weapon.magAmmo != null) ? a.weapon.magAmmo : 0;
      row.push({ id: a.id, x: +a.pos.x.toFixed(2), z: +a.pos.z.toFixed(2),
                 mag, reserve, fire: !!(a.input && a.input.fire),
                 wid: a.weapon ? a.weapon.id : null });
    }
    samples.push({ t: +(W.t).toFixed(2), n: row.length, row });
  }
  return { samples, hitReg: HR, alive: W.match ? W.match.aliveCount() : null,
           over: !!(W.match && W.match.over), t: W.t };
}
"""

def analyse(res):
    samples = res["samples"]
    # per-bot position history for the stuck window (3 s = 6 slices)
    hist, stuck, dry, firing, total = {}, 0, 0, 0, 0
    perbot_dry = {}
    for i, s in enumerate(samples):
        for r in s["row"]:
            total += 1
            h = hist.setdefault(r["id"], [])
            h.append((r["x"], r["z"]))
            if len(h) > 6: h.pop(0)
            if len(h) == 6:
                dx = max(p[0] for p in h) - min(p[0] for p in h)
                dz = max(p[1] for p in h) - min(p[1] for p in h)
                if (dx*dx + dz*dz) ** 0.5 < 0.4: stuck += 1
            if r["mag"] == 0 and r["reserve"] == 0:
                dry += 1; perbot_dry[r["id"]] = perbot_dry.get(r["id"], 0) + 1
            if r["fire"]: firing += 1
    return {"botSamples": total,
            "stuckPct": round(100*stuck/max(1,total), 1),
            "dryPct": round(100*dry/max(1,total), 1),
            "firingPct": round(100*firing/max(1,total), 1),
            "botsEverDry": len(perbot_dry),
            "aliveAtEnd": res["alive"], "simSeconds": round(res["t"],1),
            "botShots": (res.get("hitReg") or {}).get("shots"), "botHits": (res.get("hitReg") or {}).get("hits"),
            "hitsPerTriggerPull": round((res.get("hitReg") or {}).get("hits", 0) / max(1, (res.get("hitReg") or {}).get("shots", 0)), 3),
            "byWeapon": (res.get("hitReg") or {}).get("byW")}

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--seeds", default="1,2,3")
    ap.add_argument("--map", default="")
    ap.add_argument("--mode", default="standard", choices=["standard", "quick", "practice"])
    ap.add_argument("--seconds", type=int, default=150)
    a = ap.parse_args()
    seeds = [int(x) for x in a.seeds.split(",") if x.strip()]

    def body(v):
        agg = []
        with C.Session(a, "botcheck", viewport={"width": 1000, "height": 640}) as s:
            s.boot()
            s.freeze_loop()
            for sd in seeds:
                s.start_match(a.mode, sd, a.map or None, enter=True)
                s.freeze_loop()
                res = s.page.evaluate(RUN, [sd, a.map or None, a.seconds, 1 / 30, 1])
                m = analyse(res); m["seed"] = sd; agg.append(m)
                print(f"  seed {sd:>3}  bots-sampled {m['botSamples']:>6}  "
                      f"STUCK {m['stuckPct']:>5}%   DRY {m['dryPct']:>5}%   "
                      f"FIRING {m['firingPct']:>5}%   everDry {m['botsEverDry']:>3}  "
                      f"alive@end {m['aliveAtEnd']}", flush=True)
                v.info("seed %d" % sd, m)
            d = s.diagnostics()
        n = max(1, len(agg))
        v.info("MEAN", {"stuckPct": round(sum(x["stuckPct"] for x in agg) / n, 1), "dryPct": round(sum(x["dryPct"] for x in agg) / n, 1),
                        "firingPct": round(sum(x["firingPct"] for x in agg) / n, 1)})
        v.check("the matches ran with 0 page / window errors", bool(agg) and not (d["pageErrors"] or d["windowErrors"]),
                {"runs": len(agg), "pageErrors": d["pageErrors"][:3], "windowErrors": d["windowErrors"][:3]})
    return C.run_gate("botcheck", body, a)


if __name__ == "__main__":
    sys.exit(main())
