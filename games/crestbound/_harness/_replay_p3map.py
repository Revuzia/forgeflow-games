# -*- coding: utf-8 -*-
"""Map probe3 (correctly-placed critter / pound / NPC tests) onto defects.

probe3 supersedes probe2 for wardens, gnashers, breakables and NPCs: probe2 read
critter positions off `mesh.position` (always the origin) and its "pound" was a
crouch on the ground.  probe3 uses the authored `def.p` / live `post`, drops the
hero 7 m so the pound is unambiguously airborne, and records the state sequence.
"""
import json, os, re, glob, math

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "_replayout")

P3 = {}
for f in glob.glob(os.path.join(OUT, "probe3_*.json")):
    try:
        j = json.load(open(f, encoding="utf-8"))
        if j.get("course"):
            P3[j["course"]] = j
    except Exception:
        pass

SUBJ = {
    "warden":    r"\bwarden\b",
    "gnasher":   r"gnasher",
    "breakable": (r"breakable|crate|\burn(s)?\b|glyph wall|portcullis|\bbell\b|hay wall|"
                  r"ice plug|coral wall|drain stone|mezzanine|ingot|mossy|smash|pound(ing|ed)? (it|the)"),
    "npc":       r"\bold fen\b|\bfen\b|\bNPC\b|dialogue|talk",
}


def near(a, b, r=4.5):
    if not a or not b:
        return False
    return math.dist(a, b) <= r


def broke_of(t, inv_cols):
    a = t.get("after") or {}
    if a.get("broken"):
        return True
    if inv_cols and a.get("cols") == 0:
        return True
    return False


def decide(d):
    pr = P3.get(d["course"])
    if not pr:
        return None, ""
    text = " ".join([d["where"], d["did"], d["happened"], d["should"]])
    coords = d.get("coords") or []
    inv = pr.get("inventory") or {}

    for t in pr.get("tests", []):
        k = t.get("kind")
        pat = SUBJ.get(k)
        if not pat or not re.search(pat, text, re.I):
            continue
        if t.get("error"):
            continue
        tp = t.get("at") or t.get("p") or t.get("post") or t.get("npcAt")
        # a positional match is REQUIRED: without it the first breakable / warden /
        # gnasher in the course answers for every defect that merely says "pound"
        if not tp or not coords or not any(near(tp, c) for c in coords):
            continue
        q = json.dumps({x: y for x, y in t.items() if x != "kind"})[:300]

        if k == "warden":
            if t.get("woke"):
                return "FIXED", "the warden wakes when the hero stands in its arena -- " + q
            return "STILL REPRODUCES", ("the warden is still a statue: 4 s standing at its authored "
                                        "position leaves state 'dormant', hp 3 -- ") + q
        if k == "gnasher":
            if not re.search(r"kill|died|death|bite|reach|telegraph|no chance", text, re.I):
                return None, q
            if t.get("killed"):
                return "STILL REPRODUCES", ("it still kills a motionless hero 3.0 m from the post "
                                            "(authored chain %s), cause '%s' -- %s"
                                            % (t.get("chain"), t.get("cause"), q))
            return "FIXED", "a hero standing 3.0 m from the post survives 4 s -- " + q
        if k == "breakable":
            i = t.get("i")
            bl = inv.get("breakables") or []
            inv_cols = (bl[i].get("cols") if (isinstance(i, int) and i < len(bl)) else None)
            if not t.get("pounded"):
                return None, "the probe's pound never fired (states %s) -- cannot decide -- %s" % (t.get("states"), q)
            if broke_of(t, inv_cols):
                return "FIXED", "a real ground pound breaks it (colliders %s -> 0) -- %s" % (inv_cols, q)
            return "STILL REPRODUCES", ("three real ground pounds (poundHang/poundFall/poundLand "
                                        "observed) still do not break it -- ") + q
        if k == "npc":
            if t.get("dialogue"):
                return "FIXED", "E opens dialogue: %s -- %s" % (str(t["dialogue"])[:120], q)
            if t.get("prompt") and "show" in str(t.get("prompt")):
                return "STILL REPRODUCES", ("the TALK prompt is up but E produces no dialogue node "
                                            "(DOM delta %s) -- %s" % (t.get("domDelta"), q))
            return None, q
    return None, ""
