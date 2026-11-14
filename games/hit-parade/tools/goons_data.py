"""HIT PARADE - data/goons.json for BRAWL BREAK (lane ASSETS; CONTRACT 32, read by core/data.ts applyGoons).

  python tools/goons_data.py            (after `python tools/build_fighters.py --goons` published the clips)

Generated from the measured goon clips (data/clips/goon_*.clips.json) + data/system.json `brawl` (SIM-owned frame data,
HP and walk speed: this tool never carries its own copy of them - CHANGED(ASSETS) P2 resume). Every move is an ordinary
CONTRACT 5.2 Move object with the system.json row's frame data and THAT goon's measured geometry:
  anim.warp  = [[0, 0], [startup, clip contact], [startup + active + recovery, clip dur]]  (the strike pose lands on
               the first active frame; the wind-up is slowed to the telegraph length, system.json brawl.telegraphMinF);
  boxes      = one box per move, from the body front (0.25 m) to the goon's measured effector + half the class width,
               centred on the effector height (class sizes = system.json boxes.L / M / H), active frames;
  move       = the clip's stripped forward root travel (clips.json `root`) sampled at the warp keys;
  rangeM     = where the goon starts the move: goon centre -> the player's near hurt edge = root travel at the first
               active frame + the box's far edge - RANGE_MARGIN (the player may drift), clamped to RANGE_CLAMP.
The sim (core/data.ts applyGoons) takes boxes / move / rangeM / weights per goon when the entry's startup / active /
recovery match system.json (else it warns "stale" and uses the shared rows). --shared prints the mean of the three goons'
geometry = the shared fallback rows for system.json. ASCII only.
"""
import json
import os
import sys

TOOLS = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(TOOLS)

# ASSETS-owned presentation / AI flavour per goon (frame data, HP, walk live in data/system.json brawl)
GOONS = {
    "goon_hardhat": {"name": "HARDHAT", "role": "stagehand bruiser (hard hat, hi-vis vest)", "body": "Ch17_nonPBR",
                     "weights": {"shove": 2, "haymaker": 3, "kick": 1}},
    "goon_security": {"name": "SECURITY", "role": "show security (helmet, gas mask, K13 SECURITY vest)",
                      "body": "Ch35_nonPBR", "weights": {"shove": 3, "haymaker": 1, "kick": 2}},
    "goon_medic": {"name": "MEDIC", "role": "show medic (scrubs, cap, mask)", "body": "Ch16_nonPBR",
                   "weights": {"shove": 1, "haymaker": 1, "kick": 3}},
}
MOVE_NAMES = {"shove": "Two-Hand Shove", "haymaker": "Haymaker", "kick": "Push Kick"}
BODY_FRONT = 0.25
RANGE_MARGIN = 0.15
RANGE_CLAMP = (0.6, 2.5)
FRAME_KEYS = ("kind", "input", "strength", "startup", "active", "recovery", "damage", "hitstop", "hitstun",
              "blockstun", "guard", "pushback")


def root_at(root, t):
    """forward root travel (m) at clip time t, linear between baked rows"""
    if not root:
        return 0.0
    if t <= root[0][0]:
        return root[0][1]
    for (t0, x0), (t1, x1) in zip(root, root[1:]):
        if t0 <= t <= t1:
            return x0 + (x1 - x0) * ((t - t0) / (t1 - t0) if t1 > t0 else 0.0)
    return root[-1][1]


def load(p):
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def main():
    system = load(os.path.join(GAME, "data", "system.json"))
    br = system["brawl"]
    size = {k: tuple(system["boxes"][k]) for k in ("L", "M", "H")}
    kinds = {k["id"]: k for k in br["kinds"]}
    missing = [k for k in kinds if k not in GOONS]
    if missing:
        sys.exit("system.json brawl.kinds has ids without a goon body here: %s" % missing)
    out = {"version": 2, "generated_by": "tools/goons_data.py (lane ASSETS) - do not hand-edit",
           "_doc": [
               "BRAWL BREAK goons (CONTRACT 32). ids = system.json brawl.kinds order = the goon GLB stems in "
               "art/gltf/fighters/ and the data/clips/<id>.clips.json stems. Each goon carries the 34 shared system clips "
               "(CONTRACT 6.2) + goon_shove, goon_haymaker, goon_kick, goon_taunt.",
               "moves.<name> = CONTRACT 5.2 Move objects: system.json brawl.moves frame data + THAT goon's measured "
               "geometry (anim.warp startup -> clip contact, one box at the measured effector, move = root travel, rangeM = "
               "start range). weights = relative AI pick odds when a token is granted. taunt = the clip a goon may play "
               "between tokens (not driven by the sim yet).",
               "hp / walk are copies of system.json brawl.kinds (the sim reads those).",
               "units: frames 60 Hz, metres fighter-local (x forward, y up), damage in HP points."],
           "ids": [k["id"] for k in br["kinds"]], "moveNames": [m["id"] for m in br["moves"]], "goons": {}}
    shared = {}
    for gid in out["ids"]:
        g = GOONS[gid]
        cj = load(os.path.join(GAME, "data", "clips", gid + ".clips.json"))
        clips = cj["clips"]
        moves = {}
        for sm in br["moves"]:
            mname = sm["id"]
            clip = sm["anim"]["clip"]
            c = clips[clip]
            s, a, r = sm["startup"], sm["active"], sm["recovery"]
            tot = s + a + r
            contact = c["contact"] if c["contact"] is not None else c["dur"] / 2
            warp = [[0, 0.0], [s, round(contact, 4)], [tot, round(c["dur"], 4)]]
            w, h = size[sm["strength"]]
            eff = (c.get("effector") or {}).get("at") or [0.8, 1.2]
            x0 = BODY_FRONT
            x1 = max(eff[0] + w / 2, x0 + w)
            box = {"f": [s, s + a - 1], "x": round((x0 + x1) / 2, 3), "y": round(eff[1], 3), "w": round(x1 - x0, 3),
                   "h": round(h, 3)}
            t_contact = round(root_at(c["root"], contact), 3)
            mv = [[0, 0.0], [s, t_contact], [tot, round(root_at(c["root"], c["dur"]), 3)]]
            rng = max(RANGE_CLAMP[0], min(RANGE_CLAMP[1], t_contact + x1 - RANGE_MARGIN))
            mo = {k: sm[k] for k in FRAME_KEYS if k in sm}
            mo.update({"name": MOVE_NAMES.get(mname, mname), "boxes": [box], "move": mv,
                       "anim": {"clip": clip, "warp": warp}, "rangeM": round(rng, 2),
                       "effector": c.get("effector"), "_clip": {"dur": c["dur"], "contact": c["contact"]}})
            moves[mname] = mo
            sh = shared.setdefault(mname, [])
            sh.append((box, mv, rng))
        k = kinds[gid]
        out["goons"][gid] = {
            "name": g["name"], "role": g["role"], "body": g["body"], "glb": "art/gltf/fighters/%s.glb" % gid,
            "clips": "data/clips/%s.clips.json" % gid, "heightM": cj["body"]["heightM"], "hp": k["hp"],
            "walk": k["walk"], "weights": g["weights"], "taunt": "goon_taunt",
            "tauntDur": clips["goon_taunt"]["dur"], "moves": moves}
    p = os.path.join(GAME, "data", "goons.json")
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1)
        fh.write("\n")
    mean = {}
    for mname, rows in shared.items():
        n = len(rows)
        bx = {q: round(sum(r[0][q] for r in rows) / n, 2) for q in ("x", "y", "w", "h")}
        bx["f"] = rows[0][0]["f"]
        mean[mname] = {"box": bx, "move": [[0, 0], [rows[0][1][1][0], round(sum(r[1][1][1] for r in rows) / n, 2)],
                                           [rows[0][1][2][0], round(sum(r[1][2][1] for r in rows) / n, 2)]],
                       "rangeM": round(sum(r[2] for r in rows) / n, 2)}
    print(json.dumps({"ok": True, "path": p,
                      "goons": {k: {m: {"box": v["boxes"][0], "move": v["move"], "rangeM": v["rangeM"]}
                                    for m, v in g["moves"].items()} for k, g in out["goons"].items()},
                      "shared_mean": mean}))


if __name__ == "__main__":
    main()
