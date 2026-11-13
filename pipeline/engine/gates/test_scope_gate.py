#!/usr/bin/env python3
"""test_scope_gate.py — hermetic both-ways suite for the content-scope gate. No claude, no I/O."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import scope_gate as G  # noqa: E402

N, FAILS = 0, []


def chk(label, ok):
    global N
    N += 1
    print(("  [PASS] " if ok else "  [FAIL] ") + label)
    if not ok:
        FAILS.append(label)


# ── promised_scope ───────────────────────────────────────────────────────────────────────────────
DD = {"scope": "IN: 5 hand-crafted worlds (10 screens each = 50 total). Tutorial world (5 screens). "
               "3 difficulty modes (Normal/Hard/Deathless).",
      "core_loop": "dash through lava geysers"}
p, u = G.promised_scope(DD)
chk("frost-spire-style doc -> 5 worlds", p == 5 and u == "world")
chk("ignores sub-units (screens) and modes", G.promised_scope({"scope": "50 screens, 3 modes"}) == (0, None))
chk("waves promise parsed", G.promised_scope({"scope": "survive 8 waves of enemies"}) == (8, "wave"))
chk("no numbers -> (0, None)", G.promised_scope({"scope": "a fun platformer"}) == (0, None))
chk("absurd counts ignored (cap 30)", G.promised_scope({"scope": "999 levels"}) == (0, None))
chk("empty doc -> (0, None)", G.promised_scope({}) == (0, None))

# ── declared_scope ───────────────────────────────────────────────────────────────────────────────
JS5 = """const LEVELS = [
  { name: "Cinder Steps", platforms: [[1,2],[3,4]] },   // world 1
  { name: "Obsidian Cliffs", gimmick: "wall,jump" },
  { name: "Geyser Fields" },
  { name: "Collapse Run, the gauntlet" },
  { name: "Summit Shrine" },
];
export const GAME = { setup(ctx){}, update(dt,ctx){} };"""
d, how = G.declared_scope(JS5)
chk("LEVELS array of 5 objects -> 5", d == 5)
chk("commas inside strings/arrays don't inflate the count", "5 element" in how)
chk("trailing comma tolerated", G.declared_scope("const WORLDS = [1, 2, 3,];")[0] == 3)
chk("LEVEL_COUNT literal accepted", G.declared_scope("const LEVEL_COUNT = 7;")[0] == 7)
chk("no declaration -> 0", G.declared_scope("export const GAME = {};")[0] == 0)
chk("comment with bracket doesn't break scan",
    G.declared_scope("const LEVELS = [ /* [a,b] */ {a:1}, {b:2} ];")[0] == 2)

# ── run_gate both ways ───────────────────────────────────────────────────────────────────────────
chk("5 promised + 5 declared -> ok", G.run_gate(DD, JS5)["ok"] is True)
r = G.run_gate(DD, "const LEVELS = [ {only:1} ];")
chk("5 promised + 1 declared -> BLOCK with shortfall named",
    r["ok"] is False and "BUILD THE REMAINING 4" in r["detail"])
chk("no promise -> inconclusive pass", G.run_gate({}, "anything")["ok"] is True)
r2 = G.run_gate(DD, "export const GAME = {};")
chk("promise but nothing declared -> BLOCK with contract hint",
    r2["ok"] is False and "no LEVELS" in G.declared_scope("export const GAME = {};")[1])

print(f"\nchecks run: {N}")
print("SCOPE-GATE: " + ("PASS (%d checks)" % N if not FAILS else "FAIL — " + "; ".join(FAILS)))
sys.exit(0 if not FAILS else 1)
