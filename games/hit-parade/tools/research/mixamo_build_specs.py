"""Build render specs (which clips, which frames) from the merged inventory JSON.

Usage: python mixamo_build_specs.py <inv_all.json> <out_dir> <n_parts>
Writes <out_dir>/spec_<k>.json and <out_dir>/selection.json (clip id -> frames + role of frames).
ASCII only.
"""
import json
import os
import re
import sys

INV, OUTD, NPART = sys.argv[1], sys.argv[2], int(sys.argv[3])
recs = json.load(open(INV))

SEL = {
    "Pro_Melee_Axe_Pack": r"^standing (melee|react|taunt|block|idle$)|^unarmed (idle$|walk forward)",
    "Pro_Magic_Pack": r"^Standing (React|Block|2H Magic|1H Magic|2H Cast)|^standing idle$|^Standing Walk (Left|Forward)$",
    "Soccer_Game_Pack": r"kick|knee|header|tackle|trip|fallen|standing up|throw|diving|body block|goalkeeper (pass|scoop|catch$)|strike",
    "Creature_Pack": r"^(jump attack|mutant (jump attack|punch|swiping|roaring|flexing muscles|dying|idle$))",
    "Breakdance_Pack": r".",
    "Gestures_Pack_Basic": r".",
    "Great_Sword_Pack": r"attack|kick|slash|impact$|impact \(2\)|blocking$|power up|casting|^great sword idle$|death",
    "Pro_Sword_and_Shield_Pack": r"attack|kick|slash|impact|death|block$|block \(2\)|power up|^sword and shield idle$",
    "Male_Injured_Pack": r"idle|^injured walk$|^injured run$",
    "Male_Drunk_Pack": r"idle|^drunk walk$|^drunk run forward$",
    "Rifle_8-Way_Locomotion_Pack": r"^death",
    "Scary_Zombie_Pack": r".",
    "Male_Locomotion_Pack": r"^(idle|walking|standard run|left strafe)$",
    "Basic_Shooter_Pack": r"^hit reaction$",
}


def primary_hits(r):
    hits = r.get("hits", [])
    if not hits:
        return []
    ext = [h for h in hits if h["extending"]] or hits
    top = max(h["peak_speed"] for h in ext)
    strong = [h for h in ext if h["peak_speed"] >= 0.7 * top]
    return strong


def frames_for(r):
    f0, f1 = r["frame_start"], r["frame_end"]
    if r.get("attack_like"):
        strong = primary_hits(r)
        if len(strong) >= 2:
            fr = [f0] + [h["contact_frame"] for h in strong[:4]] + [f1]
            roles = ["start"] + ["contact"] * len(strong[:4]) + ["end"]
        elif strong:
            c = strong[0]["contact_frame"]
            fr = [f0, c - 8, c - 3, c, c + 5, f1]
            roles = ["start", "c-8", "c-3", "contact", "c+5", "end"]
        else:
            fr, roles = None, None
        if fr:
            out = []
            for f, ro in zip(fr, roles):
                f = max(f0, min(f1, f))
                if not out or out[-1][0] != f:
                    out.append((f, ro))
            return out
    n = 6
    return [(int(round(f0 + (f1 - f0) * i / (n - 1))), "even") for i in range(n)]


items = []
selection = {}
for r in recs:
    pat = SEL.get(r["pack"])
    if not pat or "error" in r or not re.search(pat, r["clip"]):
        continue
    cid = (r["pack"] + "__" + r["clip"]).replace(" ", "_").replace("(", "").replace(")", "")
    fr = frames_for(r)
    items.append({"id": cid, "file": r["file"], "frames": [f for f, _ in fr]})
    selection[cid] = {"pack": r["pack"], "clip": r["clip"], "frames": fr,
                      "primary_hits": primary_hits(r) if r.get("attack_like") else []}

os.makedirs(OUTD, exist_ok=True)
for k in range(NPART):
    part = items[k::NPART]
    json.dump(part, open(os.path.join(OUTD, "spec_%d.json" % k), "w"), indent=1)
json.dump(selection, open(os.path.join(OUTD, "selection.json"), "w"), indent=1)
print("selected", len(items), "clips,", sum(len(i["frames"]) for i in items), "frames")
