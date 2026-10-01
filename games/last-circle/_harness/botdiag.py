"""What is a DRY bot actually doing, and does it ever recover?

The baseline said bots spend ~11% of their lives with no usable ammo. The state
machine already scores LOOT 78 and chests 82 when dry, so the question is not
"do they decide to go for ammo" but "do they ever get any".

Per dry EPISODE: how long it lasts, whether it ends in a resupply or in death,
and which states the bot cycled through while dry.

Retargeted 2026-09-30 (lane L1) onto common.py: --base (default the scoped :8790 server) / --disk / --rev, headless by
default, and the lobby helper (startMatch -> a REAL Enter with the kernel loop frozen) so the match runs with the storm
ON (the old driver stayed in the lobby). Diagnostic: exit 0 when it ran, 2 on an environment failure, 1 on a page error.

    python _harness/botdiag.py --seeds 1,2 --seconds 150 --disk
"""
import argparse
import collections
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

RUN = r"""
async ([seed, seconds, stepS, skipStart]) => {
  const C = window.__LC__, W = C.W;
  if (!skipStart) await C.startMatch({ mode: "standard", seed });
  C.fastForward(2, stepS);
  const out = [];
  const SLICE = 0.5;
  for (let t = 0; t < seconds; t += SLICE) {
    C.fastForward(SLICE, stepS);
    if (W.match && W.match.over) break;
    const brains = C.brains ? C.brains() : [];
    const row = [];
    for (const b of brains) {
      const a = b.actor;
      if (!a || !a.alive) continue;
      let reserve = 0;
      try { for (const k in a.inventory.ammo) reserve += a.inventory.ammo[k] | 0; } catch (e) {}
      const mag = (a.weapon && a.weapon.magAmmo != null) ? a.weapon.magAmmo : 0;
      let usable = 0;
      try {
        for (const s of a.inventory.slots) if (s && s.kind === "weapon") usable += (s.mag || 0);
      } catch (e) {}
      row.push({ id: a.id, st: b.state, mag, reserve, slotMags: usable,
                 x: +a.pos.x.toFixed(1), z: +a.pos.z.toFixed(1),
                 hasTarget: !!(b.bb && b.bb.target), moveTo: !!(b.bb && b.bb.moveTo) });
    }
    out.push({ t: +W.t.toFixed(2), row });
  }
  return { samples: out, chestsOpened: (W.debugChests ? W.debugChests().filter(c=>c.opened).length : null),
           chestsTotal: (W.debugChests ? W.debugChests().length : null),
           alive: W.match ? W.match.aliveCount() : null };
}
"""


def episodes(res):
    eps = collections.defaultdict(list)
    cur = {}
    states_while_dry = collections.Counter()
    seen_last = {}
    for smp in res["samples"]:
        present = set()
        for r in smp["row"]:
            present.add(r["id"])
            dry = r["mag"] == 0 and r["reserve"] == 0
            if dry:
                states_while_dry[r["st"]] += 1
                cur.setdefault(r["id"], smp["t"])
            elif r["id"] in cur:
                eps[r["id"]].append((smp["t"] - cur.pop(r["id"]), "recovered"))
            seen_last[r["id"]] = smp["t"]
        for bid in list(cur):
            if bid not in present:                      # died while dry
                eps[bid].append((seen_last.get(bid, smp["t"]) - cur.pop(bid), "died"))
    allep = [e for vv in eps.values() for e in vv]
    rec = [d for d, k in allep if k == "recovered"]
    died = [d for d, k in allep if k == "died"]
    return {"dryEpisodes": len(allep), "recovered": len(rec), "diedWhileDry": len(died),
            "recoveryMedianS": round(sorted(rec)[len(rec) // 2], 1) if rec else None,
            "recoveryMaxS": round(max(rec), 1) if rec else None,
            "dryBeforeDeathMedianS": round(sorted(died)[len(died) // 2], 1) if died else None,
            "chests": [res.get("chestsOpened"), res.get("chestsTotal")], "aliveAtEnd": res.get("alive"),
            "statesWhileDry": dict(states_while_dry.most_common(6))}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    C.add_common_args(ap)
    ap.add_argument("--seeds", default="1,2")
    ap.add_argument("--seconds", type=int, default=150)
    ap.add_argument("--map", default=None)
    a = ap.parse_args()
    seeds = [int(x) for x in a.seeds.split(",") if x.strip()]

    def body(v):
        n = 0
        with C.Session(a, "botdiag", viewport={"width": 1000, "height": 640}) as s:
            s.boot()
            s.freeze_loop()
            for sd in seeds:
                s.start_match("standard", sd, a.map, enter=True)
                s.freeze_loop()
                res = s.page.evaluate(RUN, [sd, a.seconds, 1 / 30, 1])
                row = episodes(res)
                print("\nseed %d: %s" % (sd, row), flush=True)
                v.info("seed %d" % sd, row)
                n += 1
            d = s.diagnostics()
        v.check("ran with 0 page / window errors", n > 0 and not (d["pageErrors"] or d["windowErrors"]), (d["pageErrors"] + d["windowErrors"])[:3])
    return C.run_gate("botdiag", body, a)


if __name__ == "__main__":
    sys.exit(main())
