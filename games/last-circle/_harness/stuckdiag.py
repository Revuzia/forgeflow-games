"""Genuine stuck = HAS a destination and is not closing on it.

Standing still is not stuck: a camper, a bot channelling a 2 s chest and a bot
healing are all motionless on purpose. So this tracks distance-to-destination
per bot and flags only the ones whose distance fails to fall.

Retargeted 2026-09-30 (lane L1) onto common.py: --base (default the scoped :8790 server) / --disk / --rev, headless by
default, and the lobby helper (startMatch -> a REAL Enter with the kernel loop frozen) so the match runs with the storm
ON (the old driver stayed in the lobby). Diagnostic: exit 0 when it ran, 2 on an environment failure, 1 on a page error.

    python _harness/stuckdiag.py --seeds 1,2 --map isla_viva --disk
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
  for (let t = 0; t < seconds; t += 0.5) {
    C.fastForward(0.5, stepS);
    if (W.match && W.match.over) break;
    const row = [];
    for (const b of (C.brains ? C.brains() : [])) {
      const a = b.actor; if (!a || !a.alive) continue;
      const mt = b.bb && b.bb.moveTo;
      row.push({ id: a.id, st: b.state,
                 d: mt ? +Math.hypot(mt.x - a.pos.x, mt.z - a.pos.z).toFixed(2) : null,
                 x: +a.pos.x.toFixed(2), z: +a.pos.z.toFixed(2),
                 y: +a.pos.y.toFixed(2) });
    }
    out.push({ t: +W.t.toFixed(2), row });
  }
  return out;
}
"""


def analyse(samples):
    hist = collections.defaultdict(list)   # id -> [(d,x,z,state)]
    stuck_samples = 0
    total_with_goal = 0
    by_state = collections.Counter()
    spots = []
    for smp in samples:
        for r in smp["row"]:
            if r["d"] is None:
                continue
            total_with_goal += 1
            h = hist[r["id"]]
            h.append((r["d"], r["x"], r["z"], r["st"]))
            if len(h) > 8:
                h.pop(0)
            if len(h) == 8:
                # 4 s: destination distance not falling AND barely moved
                dd = h[0][0] - h[-1][0]
                moved = max(abs(h[0][1] - h[-1][1]), abs(h[0][2] - h[-1][2]))
                if dd < 0.5 and moved < 1.0 and h[-1][0] > 3.0:
                    stuck_samples += 1
                    by_state[r["st"]] += 1
                    if len(spots) < 6:
                        spots.append((round(r["x"]), round(r["z"]), r["st"], r["d"]))
    return {"samplesWithGoal": total_with_goal, "genuinelyStuck": stuck_samples,
            "pct": round(100 * stuck_samples / max(1, total_with_goal), 1), "byState": dict(by_state.most_common(6)), "spots": spots}


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
        with C.Session(a, "stuckdiag", viewport={"width": 1000, "height": 640}) as s:
            s.boot()
            s.freeze_loop()
            for sd in seeds:
                s.start_match("standard", sd, a.map, enter=True)
                s.freeze_loop()
                row = analyse(s.page.evaluate(RUN, [sd, a.seconds, 1 / 30, 1]))
                print("\nseed %d: %s" % (sd, row), flush=True)
                v.info("seed %d" % sd, row)
                n += 1
            d = s.diagnostics()
        v.check("ran with 0 page / window errors", n > 0 and not (d["pageErrors"] or d["windowErrors"]), (d["pageErrors"] + d["windowErrors"])[:3])
    return C.run_gate("stuckdiag", body, a)


if __name__ == "__main__":
    sys.exit(main())
