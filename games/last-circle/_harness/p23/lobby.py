#!/usr/bin/env python
"""lobby - LC-11 lobby safety + LC-07 ping wire rules (P1-D, in the base) as a gate: the P1-D phantom probe (F:/lc_p1/P1-D/phantom.mjs) and
its forgery cases promoted (P2-F port). NO browser: net.js's pure exports, the functions the live lobby / match loop call.

    python _harness/p23/lobby.py --disk
    python _harness/p23/lobby.py --rev e10b9836                    # control: the Wave-8 snapshot before P1 (phantom slot, no senderMay) - MUST FAIL
    python _harness/p23/lobby.py --disk --plant presence-blind     # isPresent always true (the old roster) - MUST FAIL
    python _harness/p23/lobby.py --disk --plant forgery-open       # senderMay allows everything - MUST FAIL
    python _harness/p23/lobby.py --disk --plant ping-merged        # world ping and map pin share one 1/s stream - MUST FAIL

Rows (plan section 5 Online: "0 phantom slots; forged messages are ignored"; P1-D-fix ffe96307):
  exports        SquadHandshake.onPresence, senderMay, PingOutbox, pingTeamOk, normPing exist
  phantom        a peer that closed its tab before START gets no slot (roster = host + the peer still there)
  grace          a peer heard but not yet in presence: a slot within PRESENCE_GRACE_MS of its hello, none after
  forgeries      8 forged messages (P1-D's cases) all refused
  legit          7 legitimate messages (own state / fire / hit / died / bye, host takeover, host-run bot) all allowed
  ping-streams   world ping + map pin in the same second both sent; a second pin within 1 s held (coalesced) and due at 1 s with the LAST body
  ping-team      shown to the same team only (never to an empty team id)
  ping-norm      bad kind / NaN / off-map bodies dropped, a good one rounded to 0.1 m
"""
from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import p23lib as L  # noqa: E402
C = L.C

PLANTS = ("presence-blind", "forgery-open", "ping-merged")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    L.add_args(ap, plants=PLANTS)
    args = L.parse(ap)

    def body(v):
        root, label = L.node_root(args)
        v.data["root"] = label
        argv = [os.path.join(L.HERE, "node", "lobby.mjs"), "--root", root]
        if args.plant:
            argv += ["--plant", args.plant]
        r, _t, wall = L.run_node(argv, timeout=300)
        v.data["result"] = r
        v.check("exports (onPresence, senderMay, PingOutbox, pingTeamOk, normPing)", not r["missing"], {"missing": r["missing"]}, "none missing")
        ph = r.get("phantom") or {}
        v.check("phantom (a peer that left before START gets no slot)", ph.get("presenceAware") and ph.get("phantomSlot") is False and ph.get("roster") == ["a_host", "b_alice"],
                ph, "roster a_host, b_alice")
        g = r.get("grace") or {}
        v.check("grace (heard, not yet present: slot within the grace, none after)", g.get("slotWithinGrace") is True and g.get("slotAfterGrace") is False, g, "true / false")
        fo = r.get("forgeries") or []
        v.check("forgeries (8 forged messages refused)", len(fo) == 8 and all(x["refused"] for x in fo), {x["n"]: x["refused"] for x in fo}, "every one refused")
        lg = r.get("legit") or []
        v.check("legit (7 legitimate messages allowed)", len(lg) == 7 and not any(x["refused"] for x in lg), {x["n"]: x["refused"] for x in lg}, "none refused")
        p = r.get("pings") or {}
        v.check("ping-streams (ping + pin both sent; second pin held, due at 1 s with the last body)",
                p.get("worldSent") and p.get("pinSent") and p.get("secondPinHeld") and p.get("dueEarly") == 0 and p.get("dueAt1s") == [["s1:m", 9]], p,
                "sent, sent, held, 0 early, [s1:m, x 9] at 1 s")
        t = r.get("pingTeam") or {}
        v.check("ping-team (same team only, never an empty id)", t.get("same") is True and t.get("other") is False and t.get("empty") is False, t, "true / false / false")
        n = r.get("pingNorm") or {}
        good = n.get("good") or {}
        v.check("ping-norm (bad kind / NaN / off-map dropped; good rounded)", n.get("badKind") is None and n.get("nan") is None and n.get("far") is None and good.get("x") == 10.0,
                n, "null, null, null, x 10.0")
        v.info("node wall", {"s": wall})
    return C.run_gate("p23_lobby", body, args)


if __name__ == "__main__":
    sys.exit(main())
