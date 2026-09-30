"""HIT PARADE - data/goons.json for BRAWL BREAK (lane ASSETS; CONTRACT CHANGED(ASSETS) goons, read by SIM's brawl.ts).

  python tools/goons_data.py            (after `python tools/build_fighters.py --goons` published the clips)

Generated from the measured goon clips (data/clips/goon_*.clips.json) + the frame-data table below. Every Move is an
ordinary CONTRACT 5.2 Move object (the shape system.json `brawl.moves` already uses), so SIM can compile it as is:
  anim.warp  = [[0, 0], [startup, clip contact], [startup + active + recovery, clip dur]]  (the strike pose lands on
               the first active frame; the wind-up is slowed to the telegraph length, system.json brawl.telegraphMinF);
  boxes      = one box per move, from the body front (0.25 m) to the goon's measured effector + half the class width,
               centred on the effector height (class sizes CONTRACT 5.2: M 0.40 x 0.30, H 0.50 x 0.35), active frames;
  move       = the clip's stripped forward root travel (clips.json `root`) sampled at the warp keys.
Frame data: startup >= 30 (DESIGN_RESEARCH 1c telegraphs 30-54 f); numbers mirror SIM's proposal (system.json brawl:
jab 30/4/30 300, haymaker 45/5/40 600, lunge 36/6/45 500) with the moves the goon clips actually show (a two-hand
shove, a haymaker hook, a push kick). HP / walk = SIM's kinds (2400/1.5, 3000/1.3, 1800/1.8). ASCII only.
"""
import json
import os

TOOLS = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(TOOLS)

GOONS = [
    {"id": "goon_hardhat", "name": "HARDHAT", "role": "stagehand bruiser (hard hat, hi-vis vest)", "body": "Ch17_nonPBR",
     "hp": 2400, "walk": 1.5, "weights": {"shove": 2, "haymaker": 3, "kick": 1}},
    {"id": "goon_security", "name": "SECURITY", "role": "show security (helmet, gas mask, K13 SECURITY vest)",
     "body": "Ch35_nonPBR", "hp": 3000, "walk": 1.3, "weights": {"shove": 3, "haymaker": 1, "kick": 2}},
    {"id": "goon_medic", "name": "MEDIC", "role": "show medic (scrubs, cap, mask)", "body": "Ch16_nonPBR",
     "hp": 1800, "walk": 1.8, "weights": {"shove": 1, "haymaker": 1, "kick": 3}},
]
MOVES = {
    "shove": {"clip": "goon_shove", "kind": "normal", "input": "5M", "strength": "M", "startup": 32, "active": 4,
              "recovery": 30, "damage": 350, "hitstop": 11, "hitstun": 18, "blockstun": 14, "guard": "HL",
              "pushback": {"hit": 0.9, "block": 0.7}, "onHit": {"kd": "none"}, "name": "Two-Hand Shove"},
    "haymaker": {"clip": "goon_haymaker", "kind": "normal", "input": "5H", "strength": "H", "startup": 45, "active": 5,
                 "recovery": 40, "damage": 600, "hitstop": 13, "hitstun": 24, "blockstun": 16, "guard": "HL",
                 "pushback": {"hit": 0.45, "block": 0.5}, "onHit": {"kd": "none"}, "name": "Haymaker"},
    "kick": {"clip": "goon_kick", "kind": "normal", "input": "6M", "strength": "M", "startup": 36, "active": 5,
             "recovery": 40, "damage": 500, "hitstop": 11, "hitstun": 20, "blockstun": 14, "guard": "HL",
             "pushback": {"hit": 0.6, "block": 0.55}, "onHit": {"kd": "none"}, "name": "Push Kick"},
}
SIZE = {"L": (0.30, 0.25), "M": (0.40, 0.30), "H": (0.50, 0.35)}
BODY_FRONT = 0.25


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


def main():
    out = {"version": 1, "generated_by": "tools/goons_data.py (lane ASSETS) - do not hand-edit",
           "_doc": [
               "BRAWL BREAK goons (CONTRACT CHANGED(ASSETS) goons). ids = the goon GLB stems in art/gltf/fighters/ and the "
               "data/clips/<id>.clips.json stems. Each goon carries the 34 shared system clips (CONTRACT 6.2) + goon_shove, "
               "goon_haymaker, goon_kick, goon_taunt.",
               "moves.<name> = CONTRACT 5.2 Move objects measured on THAT goon's clips (anim.warp startup -> clip contact, one "
               "box at the measured effector, move = root travel). weights = relative pick odds for the AI when a token is "
               "granted (SIM may ignore them). taunt = the clip a goon plays between tokens.",
               "units: frames 60 Hz, metres fighter-local (x forward, y up), damage in HP points."],
           "ids": [g["id"] for g in GOONS], "moveNames": list(MOVES), "goons": {}}
    for g in GOONS:
        cj = json.load(open(os.path.join(GAME, "data", "clips", g["id"] + ".clips.json"), encoding="utf-8"))
        clips = cj["clips"]
        moves = {}
        for mname, m in MOVES.items():
            c = clips[m["clip"]]
            s, a, r = m["startup"], m["active"], m["recovery"]
            tot = s + a + r
            contact = c["contact"] if c["contact"] is not None else c["dur"] / 2
            warp = [[0, 0.0], [s, round(contact, 4)], [tot, round(c["dur"], 4)]]
            w, h = SIZE[m["strength"]]
            eff = (c.get("effector") or {}).get("at") or [0.8, 1.2]
            x0 = BODY_FRONT
            x1 = max(eff[0] + w / 2, x0 + w)
            box = {"f": [s, s + a - 1], "x": round((x0 + x1) / 2, 3), "y": round(eff[1], 3), "w": round(x1 - x0, 3),
                   "h": round(h, 3)}
            mv = [[0, 0.0], [s, round(root_at(c["root"], contact), 3)], [tot, round(root_at(c["root"], c["dur"]), 3)]]
            mo = {k: v for k, v in m.items() if k != "clip"}
            mo.update({"boxes": [box], "move": mv, "anim": {"clip": m["clip"], "warp": warp},
                       "effector": c.get("effector"), "_clip": {"dur": c["dur"], "contact": c["contact"]}})
            moves[mname] = mo
        out["goons"][g["id"]] = {
            "name": g["name"], "role": g["role"], "body": g["body"], "glb": "art/gltf/fighters/%s.glb" % g["id"],
            "clips": "data/clips/%s.clips.json" % g["id"], "heightM": cj["body"]["heightM"], "hp": g["hp"],
            "walk": g["walk"], "weights": g["weights"], "taunt": "goon_taunt",
            "tauntDur": clips["goon_taunt"]["dur"], "moves": moves}
    p = os.path.join(GAME, "data", "goons.json")
    with open(p, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=1)
    print(json.dumps({"ok": True, "path": p, "goons": {k: {m: v["boxes"][0] for m, v in g["moves"].items()}
                                                        for k, g in out["goons"].items()}}))


if __name__ == "__main__":
    main()
