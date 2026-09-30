"""HIT PARADE fighter-kit generator library (lane FIGHTERS).

Single source of truth for the 12 kits: kits/<id>.py build a Kit with this library, build.py emits
  data/fighters/<id>.json      (CONTRACT 5.2 + 19 + 20)
  tools/clipplan/<id>.json     (CONTRACT 6.2 + 20.5)
  _spec/ROSTER.md              (kits, frame tables with every deviation's reason, animation sources)
No .json lives in this folder (core/data.ts globs data/**/*.json).

Frame-data conventions (FIGHTING_DESIGN 1b, SF6): startup counts the first active frame;
advantage = stun - (active + recovery). KD moves without an upward launch carry hitstun = total frames
until the defender acts again (CONTRACT 19.3), so the same arithmetic gives the knockdown advantage.
ASCII only.
"""
import copy
import json
import math
import os

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
RESEARCH_ANIM = os.path.join(GAME, "_research", "animations")
MIXAMO_ROOT = "F:/games/forgeflow-games-assets/_downloaded/mixamo/animations/"
CMU_ROOT = "F:/games/forgeflow-games-assets/_downloaded/cmu-mocap/cmu-mocap-master/data"

# CONTRACT 6.2 shared system clips, in the 17.2 anim-table order.
SHARED = ["idle", "walk_f", "walk_b", "crouch", "crouch_idle", "jump_up", "jump_f", "jump_b", "land",
          "dash_f", "dash_b", "block_high", "block_low", "hit_high_s", "hit_high_l", "hit_body", "hit_low",
          "hit_air", "crumple", "kd_fall_b", "kd_fall_f", "kd_ground_b", "kd_ground_f", "wake_b", "wake_f",
          "wall_splat", "thrown_f", "thrown_b", "dizzy", "ko_fall", "timeover_lose", "parry",
          "impact_windup", "shove"]

# --------------------------------------------------------------------------------------------------
# Frame-data templates. Normals = FIGHTING_DESIGN 1b rows (checked against
# tools/research/fg_template_check.py MOVES by validate.py). Specials/supers = 1c rows.
# nerve = SF6 median Drive damage on block (FIGHTING_DESIGN 1a column) -> gain.nerveCost.
# pb = pushback (hit, block) in metres: light 0.27 is the measured SF6 ratio (2h); M/H/air are [R]
# starting values (SF6 pushback beyond the light was not in the pages the research read).
# --------------------------------------------------------------------------------------------------
TPL = {
    "L":     dict(startup=5, active=3, recovery=9, hitstun=15, blockstun=10, damage=300, hitstop=9,
                  guard="HL", gain=300, nerve=500, pb=(0.27, 0.27), strength="L"),
    "2L":    dict(startup=5, active=3, recovery=9, hitstun=15, blockstun=10, damage=250, hitstop=9,
                  guard="L", gain=300, nerve=500, pb=(0.27, 0.27), strength="L"),
    "M":     dict(startup=8, active=3, recovery=16, hitstun=22, blockstun=16, damage=600, hitstop=11,
                  guard="HL", gain=500, nerve=3000, pb=(0.35, 0.40), strength="M"),
    "2M":    dict(startup=8, active=3, recovery=15, hitstun=22, blockstun=16, damage=600, hitstop=11,
                  guard="L", gain=500, nerve=3000, pb=(0.35, 0.40), strength="M"),
    "H":     dict(startup=12, active=3, recovery=20, hitstun=25, blockstun=20, damage=800, hitstop=13,
                  guard="HL", gain=1000, nerve=5000, pb=(0.45, 0.50), strength="H"),
    "AA":    dict(startup=9, active=4, recovery=21, hitstun=27, blockstun=19, damage=800, hitstop=13,
                  guard="HL", gain=1000, nerve=5000, pb=(0.45, 0.50), strength="H", role=["antiair"]),
    "SWEEP": dict(startup=10, active=3, recovery=24, hitstun=60, blockstun=16, damage=900, hitstop=13,
                  guard="L", gain=1000, nerve=4000, pb=(0.0, 0.45), strength="H", kd="soft",
                  role=["sweep", "low"]),
    "OH":    dict(startup=18, active=3, recovery=17, hitstun=22, blockstun=16, damage=600, hitstop=11,
                  guard="H", gain=500, nerve=4000, pb=(0.35, 0.40), strength="M", role=["overhead"]),
    "CMD":   dict(startup=16, active=3, recovery=20, hitstun=25, blockstun=20, damage=800, hitstop=13,
                  guard="HL", gain=1000, nerve=4000, pb=(0.45, 0.50), strength="H"),
    "jL":    dict(startup=5, active=7, recovery=3, hitstun=13, blockstun=9, damage=300, hitstop=9,
                  guard="H", gain=300, nerve=1500, pb=(0.20, 0.20), strength="L"),
    "jM":    dict(startup=7, active=6, recovery=3, hitstun=17, blockstun=13, damage=600, hitstop=11,
                  guard="H", gain=500, nerve=2500, pb=(0.25, 0.25), strength="M"),
    "jH":    dict(startup=10, active=6, recovery=3, hitstun=19, blockstun=15, damage=800, hitstop=13,
                  guard="H", gain=1000, nerve=4000, pb=(0.30, 0.30), strength="H"),
    # 1c: normal throws 5/3/23, 1200, KD +21 (fwd) / +11..+17 (back), gain 2000 (2d)
    "THROW_F": dict(startup=5, active=3, recovery=23, hitstun=0, blockstun=0, damage=1200, hitstop=0,
                    guard="U", gain=2000, nerve=0, pb=(0.0, 0.0), strength="M"),
    "THROW_B": dict(startup=5, active=3, recovery=23, hitstun=0, blockstun=0, damage=1200, hitstop=0,
                    guard="U", gain=2000, nerve=0, pb=(0.0, 0.0), strength="M"),
}

# 1c specials (per strength). Values are the research template; kits deviate per move with a reason.
SPECIAL = {
    # projectile: startup 16/14/12, 47 total (active 1 = spawn frame), hitstop 8, 600, speed 4.5/6/7.5 m/s
    "proj": {"l": dict(startup=16, active=1, recovery=31, speed=4.5),
             "m": dict(startup=14, active=1, recovery=33, speed=6.0),
             "h": dict(startup=12, active=1, recovery=35, speed=7.5),
             "all": dict(hitstun=31, blockstun=27, damage=600, hitstop=8, guard="HL", gain=600, nerve=2500,
                         pb=(0.40, 0.50))},
    # DP: 5/6/7, 10 active, block -23/-32/-39 with blockstun 20 (recovery 33/42/49), KD +35, air-inv 1-14/1-9/1-8
    "dp": {"l": dict(startup=5, recovery=33, damage=1000, invuln={"air": [1, 14]}),
           "m": dict(startup=6, recovery=42, damage=1100, invuln={"air": [1, 9]}),
           "h": dict(startup=7, recovery=49, damage=1300, invuln={"air": [1, 8]}),
           "all": dict(active=10, blockstun=20, hitstop=15, guard="HL", gain=800, nerve=4000, pb=(0.0, 0.50),
                       kd="soft")},
    # rush: 10/12/14, 4 active, block -4/-6/-12 (blockstun 20 -> recovery 20/22/28), KD +30/+33/+37
    "rush": {"l": dict(startup=10, recovery=20, damage=900),
             "m": dict(startup=12, recovery=22, damage=1000),
             "h": dict(startup=14, recovery=28, damage=1100),
             "all": dict(active=4, blockstun=20, hitstop=13, guard="HL", gain=1000, nerve=4000, pb=(0.0, 0.50),
                         kd="soft")},
    # command grab: 5/3/54, 2500/2900/3300, reach 1.22/1.10/0.92 m, hard KD +28, gain 3000
    "cmdgrab": {"l": dict(damage=2500, rangeM=1.22), "m": dict(damage=2900, rangeM=1.10),
                "h": dict(damage=3300, rangeM=0.92),
                "all": dict(startup=5, active=3, recovery=54, hitstun=0, blockstun=0, hitstop=0, guard="U",
                            gain=3000, nerve=0, pb=(0.0, 0.0))},
}
# Lv1: 8-9 / 5 / 50, -30 (blockstun 25), KD +23, 2000, hitstop 9 per hit / 20 last, cost 10000
LV1 = dict(startup=8, active=5, recovery=50, blockstun=25, damage=2000, hitstop=20, guard="HL", pb=(0.0, 0.80))
# Lv3: 10 / 4 / 58, -42 (blockstun 20), KD +19, 4500, full invuln 1-13, cost 30000
LV3 = dict(startup=10, active=4, recovery=58, blockstun=20, damage=4500, hitstop=0, guard="HL", pb=(0.0, 0.0))

EX_NERVE = 20000
LV1_COST = 10000
LV3_COST = 30000

MOVE_KINDS = ("normal", "command", "special", "ex", "super1", "super3", "throw", "cmdgrab", "projectile",
              "system")


# --------------------------------------------------------------------------------------------------
# Source catalogs (evidence: research JSON)
# --------------------------------------------------------------------------------------------------
_MIX = None
_CMU = None


def mixamo_catalog():
    global _MIX
    if _MIX is None:
        d = json.load(open(os.path.join(RESEARCH_ANIM, "mixamo_inventory.json"), encoding="utf-8"))
        _MIX = {}
        for pk, p in d["packs"].items():
            for c in p["clips"]:
                _MIX["%s/%s.fbx" % (pk, c["clip"])] = {"frames": c["frames"], "dur": c["duration_s"],
                                                       "fps": c["fps"]}
    return _MIX


def cmu_catalog():
    global _CMU
    if _CMU is None:
        d = json.load(open(os.path.join(RESEARCH_ANIM, "best_candidates.json"), encoding="utf-8"))
        _CMU = {x["id"]: x for x in d if x.get("id")}
    return _CMU


# --------------------------------------------------------------------------------------------------
# Clip DSL (CONTRACT 20.5)
# --------------------------------------------------------------------------------------------------
def mix(file, rng, contact=None, loop=False, mirror=False, speed=1.0, why=""):
    f = file if file.endswith(".fbx") else file + ".fbx"
    e = {"src": "mixamo", "file": f, "range": [int(rng[0]), int(rng[1])], "contact": contact,
         "mirror": mirror, "speed": speed, "loop": loop}
    if why:
        e["_why"] = why
    return e


_LIMB_SWAP = {"L": "R", "R": "L"}
_CLASS_KIND = {"spin_kick": "foot", "jump_kick": "foot", "punt_kick": "foot", "stomp": "foot",
               "flex_taunt": "body", "grab_pull": "body", "stagger_forward": "body", "stagger_light": "body"}


def cmu(cand=None, take=None, rng=None, contact=None, mirror=False, kind=None, limb=None, fist=None,
        why=""):
    """CMU segment. cand = best_candidates.json id (take/start/contact/end/limb read from it)."""
    src = {}
    if cand:
        src = cmu_catalog()[cand]
    tk = take or src.get("take")
    s = rng[0] if rng else src["start"]
    e_ = rng[1] if rng else src["end"]
    c = contact if contact is not None else src.get("contact")
    if c is False:
        c = None
    k = kind or src.get("kind")
    if k == "manual":
        k = _CLASS_KIND.get(src.get("class"), "body")
    lb = limb or src.get("limb") or "body"
    if mirror and not limb and lb[0] in "LR":
        lb = _LIMB_SWAP[lb[0]] + lb[1:]
    if fist is None:
        fist = 80 if k == "hand" else 0
    e = {"src": "cmu", "file": tk, "range": [int(s), int(e_)], "contact": c, "mirror": mirror, "speed": 1.0,
         "loop": False, "kind": k, "limb": lb, "fist": fist}
    if cand:
        e["_cand"] = cand
    if why:
        e["_why"] = why
    return e


def layer(lower, upper, mode="hold", lower_frame=None, split="Spine", why=""):
    e = {"src": "layer", "layer": {"lower": lower, "upper": upper, "split": split, "lowerMode": mode}}
    if lower_frame is not None:
        e["layer"]["lowerFrame"] = lower_frame
    e["range"] = list(upper.get("range") or [0, 0])
    e["contact"] = upper.get("contact")
    if why:
        e["_why"] = why
    return e


def seq(*entries, xf=2, why=""):
    e = {"src": "seq", "seq": list(entries), "xf": xf, "contact": entries[0].get("contact")}
    if why:
        e["_why"] = why
    return e


# Two authored motions, shared roster-wide (CONTRACT 20.5). Keys are 30 fps frames on X Bot.
AUTHORED = {
    "crouch_toe_kick": {
        "src": "authored", "frames": 18, "contact": 6,
        "base": mix("Pro_Magic_Pack/Crouch Idle", (1, 42), loop=True),
        "keys": [
            [1, "Crouch Idle f1 pose unchanged (hips 0.56 m, weight centred)."],
            [4, "Front (right) knee chambers: RightUpLeg flexed 45 deg forward of the crouch pose, RightLeg "
                "(shin) folded back so the foot sits under the knee 10 cm off the floor; torso leans back 5 deg."],
            [6, "CONTACT: right leg extends straight forward, foot 6 cm above the floor at ~0.75 m in front of "
                "the hips, toes pointed (RightFoot plantar-flexed 35 deg); left leg and hips unchanged; lead "
                "hand stays up in guard."],
            [8, "Hold the extension (same pose as f6, toes relax 10 deg)."],
            [12, "Right leg folds back to the chamber pose of f4."],
            [18, "Back to Crouch Idle f1 pose (loops cleanly into crouch_idle)."]]},
    "crouch_shin_kick": {
        "src": "authored", "frames": 24, "contact": 9,
        "base": mix("Pro_Magic_Pack/Crouch Idle", (1, 42), loop=True),
        "keys": [
            [1, "Crouch Idle f1 pose."],
            [5, "Hips yaw 25 deg toward the kicking side, right knee chambers out to the side at hip height "
                "(RightUpLeg abducted 50 deg, shin folded 90 deg), left heel pivots 30 deg."],
            [9, "CONTACT: right leg whips round to full extension at shin height (foot 0.25 m above the floor, "
                "0.95 m in front of the hips), instep leading; hips yaw 45 deg; both arms counter-swing, lead "
                "hand stays at the chin."],
            [12, "Hold the extension, hips yaw 40 deg."],
            [17, "Leg re-chambers (f5 pose), hips unwind to 15 deg."],
            [24, "Back to Crouch Idle f1 pose."]]},
}


def entry_seconds(e):
    """(duration s, [contact s per segment]) of a plan entry (30 fps mixamo, 120 fps CMU, seq xf @30)."""
    src = e["src"]
    if src in ("mixamo", "cmu"):
        fps = 30.0 if src == "mixamo" else 120.0
        f0, f1 = e["range"]
        c = e.get("contact")
        cl = e.get("contacts") or ([] if c is None else [c])
        n, _ = out_frames(e)   # exact baked length (CMU windows get an extra end frame when not step-aligned)
        return (n - 1) / 30.0, [(x - f0) / fps for x in cl]
    if src == "layer":
        return entry_seconds(e["layer"]["upper"])
    if src == "seq":
        t = 0.0
        cs = []
        for i, s in enumerate(e["seq"]):
            d, c = entry_seconds(s)
            if i > 0:
                t -= e.get("xf", 0) / 30.0
            cs += [t + x for x in c]
            t += d
        return t, cs
    if src == "authored":
        return (e["frames"] - 1) / 30.0, [(e["contact"] - 1) / 30.0]
    return 0.0, []


def out_frames(e):
    """(output frame count at 30 fps, contact output frame | None) of a mixamo/cmu entry as ASSETS'
    tools builder samples it (bake_fighter ClipSampler / cmu_retarget frame list)."""
    f0, f1 = e["range"]
    c = e.get("contact")
    if e["src"] == "mixamo":
        sp = float(e.get("speed", 1.0))
        return int((f1 - f0) / sp + 1e-6) + 1, (None if c is None else (c - f0) / sp)
    n = len(range(f0, f1 + 1, 4)) + (1 if (f1 - f0) % 4 else 0)
    return n, (None if c is None else (c - f0) / 4.0)


def _floor6(x):
    """Round DOWN to 6 decimals so the builder's floor((f1-f0)/speed + 1e-6) + 1 yields exactly N frames."""
    return math.floor(x * 1e6) / 1e6


def builder_entry(e):
    """Clip-plan entry in the form lane ASSETS' tools/build_fighters.py consumes (checked against
    art/blender/bake_fighter.py build_sampler/src_to_out on 2026-09-29): mixamo file without .fbx; layer
    lower clip speed-matched so its frame count equals the upper clip's (= the upper keeps its own timing,
    CONTRACT 20.5 hold/loop/sync) and `contact` expressed in LOWER source frames (src_to_out maps layers
    through the lower); authored -> src 'author' (spec name, 0-based contact); multi-contact sources ->
    `marks`. Intent fields stay as extras."""
    e = copy.deepcopy(e)
    s = e["src"]
    if s == "mixamo":
        if e["file"].endswith(".fbx"):
            e["file"] = e["file"][:-4]
    if s in ("mixamo", "cmu") and e.get("contacts"):
        e["marks"] = {"hit%d" % (i + 1): f for i, f in enumerate(e["contacts"])}
    if s == "seq":
        e["seq"] = [builder_entry(x) for x in e["seq"]]
    if s == "authored":
        return {"src": "author", "file": e["_authored"], "contact": e["contact"] - 1, "frames": e["frames"],
                "_base": builder_entry(e["base"]), "_keys": e["keys"], "_why": e.get("_why", "")}
    if s == "layer":
        orig = e
        ly = e["layer"]
        up = builder_entry(ly["upper"])
        lo = builder_entry(ly["lower"])
        n_up, k_c = out_frames(ly["upper"])
        mode = ly["lowerMode"]
        if mode == "hold":
            h = ly["lowerFrame"]
            lo["range"] = [h, h + 1]
            lo["speed"] = _floor6(1.0 / (n_up - 1))
            lo["loop"] = False
        else:
            a, b = lo["range"]
            lo["speed"] = _floor6((b - a) / float(n_up - 1))
        e = {"src": "layer", "layer": {"lower": lo, "upper": up, "split": ly["split"], "lowerMode": mode},
             "_upperFrames": n_up, "_upperContact": ly["upper"].get("contact")}
        if "lowerFrame" in ly:
            e["layer"]["lowerFrame"] = ly["lowerFrame"]
        if k_c is not None:
            e["contact"] = round(lo["range"][0] + k_c * lo["speed"], 4)
        else:
            e["contact"] = None
        for k in ("_why", "air", "loop", "floor"):
            if k in orig:
                e[k] = orig[k]
    return e


def auto_warp(entry, hit_frames, total):
    """Warp mapping each hit's first frame onto the matching segment contact (CONTRACT 5.2: startup ->
    contact), and the move end (S+A+R, the frame after the last move frame - SIM core/data.ts derive
    convention) onto the clip end."""
    dur, cs = entry_seconds(entry)
    if len(cs) < len(hit_frames):
        raise ValueError("auto warp: %d hits but only %d contacts" % (len(hit_frames), len(cs)))
    w = [[0, 0.0]] + [[f, round(c, 3)] for f, c in zip(hit_frames, cs)] + [[total, round(dur, 3)]]
    for a, b in zip(w, w[1:]):
        if not (b[0] > a[0] and b[1] > a[1]):
            raise ValueError("auto warp not increasing: %s" % w)
    return w


def authored(name, why=""):
    e = copy.deepcopy(AUTHORED[name])
    e["_authored"] = name
    if why:
        e["_why"] = why
    return e


def jump_hold():
    """Legs of the measured Pro_Magic Standing Jump apex (f28, hips 1.488 m, jump_apex.py)."""
    return mix("Pro_Magic_Pack/Standing Jump", (1, 71), why="apex f28 measured")


def crouch_hold():
    return mix("Pro_Magic_Pack/Crouch Idle", (1, 42), loop=True)


def air(upper, why=""):
    return layer(jump_hold(), upper, mode="hold", lower_frame=28, why=why or "air normal: legs held at the "
                 "measured jump apex (f28), arms from the strike clip")


def crouch(upper, why="", lower=None, frame=1):
    return layer(lower or crouch_hold(), upper, mode="hold", lower_frame=frame,
                 why=why or "crouch normal: legs held in Crouch Idle, arms from the strike clip")


# --------------------------------------------------------------------------------------------------
# Kit
# --------------------------------------------------------------------------------------------------
def _pb(p):
    return {"hit": round(p[0], 2), "block": round(p[1], 2)}


class Kit:
    def __init__(self, **kw):
        self.info = kw
        self.moves = {}          # id -> move dict (JSON-shaped + private keys starting with _)
        self.order = []
        self.clips = {}          # id -> clip plan entry
        self.clip_notes = {}
        self.simple = {}
        self.classic = []
        self.unique = {"kind": "none"}
        self.cine = None

    # ---- clips
    def clip(self, cid, entry, note=""):
        if cid in self.clips:
            raise ValueError("%s: duplicate clip %s" % (self.info["id"], cid))
        self.clips[cid] = entry
        if note:
            self.clip_notes[cid] = note
        return cid

    # ---- moves
    def add(self, mid, tpl=None, **f):
        """Add a move. tpl = TPL key or dict of defaults; f = overrides + JSON fields.
        Private keys: why (deviation reason), aa/sweep flags are expressed through role."""
        if mid in self.moves:
            raise ValueError("%s: duplicate move %s" % (self.info["id"], mid))
        base = {}
        if isinstance(tpl, str):
            base = copy.deepcopy(TPL[tpl])
            base["_tpl"] = tpl
        elif isinstance(tpl, dict):
            base = copy.deepcopy(tpl)
        base.update(f)
        self.moves[mid] = base
        self.order.append(mid)
        return base

    def special(self, name, fam, kind="special", per=None, common=None, ex=None, motion=""):
        """Add <name>_l/_m/_h (+ _ex) from a SPECIAL family (or fam=None for custom).
        motion = CLASSIC motion ('236', '[4]6', ...) -> input '236L' / '236S' (informational for specials)."""
        per = per or {}
        common = common or {}
        out = []
        for s in ("l", "m", "h"):
            d = {}
            if fam:
                d.update(copy.deepcopy(SPECIAL[fam]["all"]))
                d.update(copy.deepcopy(SPECIAL[fam][s]))
                d["_tpl"] = fam + "_" + s
            d.update(copy.deepcopy(common))
            d.update(copy.deepcopy(per.get(s, {})))
            d.setdefault("strength", s.upper())
            d.setdefault("kind", kind)
            d.setdefault("input", motion + s.upper())
            out.append(self.add("%s_%s" % (name, s), None, **d))
        if ex is not None:
            d = {}
            if fam:
                d.update(copy.deepcopy(SPECIAL[fam]["all"]))
                d.update(copy.deepcopy(SPECIAL[fam]["h"]))
                d["_tpl"] = fam + "_h"
            d.update(copy.deepcopy(common))
            d.update(copy.deepcopy(ex))
            d["kind"] = "ex"
            d.setdefault("input", motion + "S")
            d.setdefault("strength", "H")
            c = d.setdefault("cost", {})
            c.setdefault("nerve", EX_NERVE)
            out.append(self.add("%s_ex" % name, None, **d))
        return out

    # ---- emit
    def emit_move(self, mid):
        m = self.moves[mid]
        kind = m.get("kind", "normal")
        o = {"kind": kind, "input": m.get("input", mid), "name": m["name"],
             "strength": m.get("strength", "M")}
        for k in ("startup", "active", "recovery", "damage"):
            o[k] = int(m[k])
        default_chip = 0 if kind in ("normal", "command", "throw", "cmdgrab") else 25
        o["chipPct"] = int(m.get("chipPct", default_chip))
        o["hitstop"] = int(m.get("hitstop", 0))
        o["hitstun"] = int(m.get("hitstun", 0))
        o["blockstun"] = int(m.get("blockstun", 0))
        o["guard"] = m.get("guard", "HL")
        o["move"] = m.get("move", [[0, 0]])
        o["pushback"] = _pb(m.get("pb", (0.0, 0.0)))
        o["cancel"] = list(m.get("cancel", []))
        o["juggle"] = m.get("juggle", {"js": 0, "ji": 1, "jl": 0})
        oh = {"kd": m.get("kd", "none"), "launch": m.get("launch", [0, 0]),
              "wallSplat": bool(m.get("wallSplat", False)), "groundBounce": bool(m.get("groundBounce", False)),
              "crumple": bool(m.get("crumple", False))}
        o["onHit"] = oh
        o["gain"] = {"showtime": int(m.get("gain", 0)), "nerveCost": int(m.get("nerve", 0))}
        cost = m.get("cost", {})
        o["cost"] = {"showtime": int(cost.get("showtime", 0)), "nerve": int(cost.get("nerve", 0))}
        o["invuln"] = m.get("invuln", {})
        o["armor"] = m.get("armor", {"hits": 0, "f": [0, 0]})
        for k in ("hits", "moveY", "air", "airVel", "hurtOverride", "grab", "tc", "trigger", "counter",
                  "teleport", "stance", "ball", "phase", "projectile", "cinematic", "boxes", "hurtExt",
                  "armorBreak", "starter", "multi"):
            if k in m:
                o[k] = m[k]
        o["role"] = list(m.get("role", []))
        anim = {"clip": m["clip"]}
        if m.get("warp") == "auto":
            hf = [h["f"][0] for h in m["hits"]] if m.get("hits") else [o["startup"]]
            anim["warp"] = auto_warp(self.clips[m["clip"]], hf, o["startup"] + o["active"] + o["recovery"])
        elif "warp" in m:
            anim["warp"] = m["warp"]
        o["anim"] = anim
        if "sfx" in m:
            o["sfx"] = m["sfx"]
        o["desc"] = m.get("desc", "")
        return o

    def to_json(self):
        i = self.info
        d = {"id": i["id"], "name": i["name"], "persona": i["persona"], "archetype": i["archetype"],
             "body": i["body"], "heightM": i["heightM"], "hp": i["hp"],
             "walk": {"fwd": i["walk"][0], "back": i["walk"][1]},
             "dash": {"fwd": i["dash"][0], "back": i["dash"][1], "fwdFrames": i["dash"][2],
                      "backFrames": i["dash"][3]},
             "jump": {"prejump": i["jump"][0], "air": i["jump"][1], "landing": i["jump"][2],
                      "apexM": i["jump"][3], "fwdM": i["jump"][4]},
             "throwRangeM": i["throwRangeM"], "hurt": hurtboxes(i), "pushbox": pushbox(i),
             "colors": [{"name": n, "tint": t} for n, t in i["colors"]],
             "moves": {mid: self.emit_move(mid) for mid in self.order},
             "simple": self.simple, "classic": self.classic, "unique": self.unique,
             "intro": i["intro"], "win": i["win"], "taunt": i["taunt"], "rival": i["rival"],
             "stage": i["stage"], "cpu": i["cpu"]}
        return d

    def clipplan(self):
        return self.clips

    def fit(self, k=1.3):
        """Shrink each contact clip's source window so the windup plays ~2k x (k source frames @30 per sim
        frame of startup) and the tail ~2k x over active+recovery (median of the moves that use it as
        anim.clip). Never extends past the chosen (reviewed) window; seq/authored/loop clips untouched.
        Returns [(clip, old range, new range)]."""
        uses = {}
        for mid in self.order:
            m = self.moves[mid]
            uses.setdefault(m["clip"], []).append(m)
        changed = []
        for cid, ms in uses.items():
            e = self.clips.get(cid)
            if not e:
                continue
            tgt = e["layer"]["upper"] if e["src"] == "layer" else e
            if tgt["src"] not in ("mixamo", "cmu") or tgt.get("loop") or tgt.get("contact") is None:
                continue
            ss = sorted(m["startup"] for m in ms)
            ars = sorted(m["active"] + m["recovery"] for m in ms)
            s_med, ar_med = ss[len(ss) // 2], ars[len(ars) // 2]
            mul = 1 if tgt["src"] == "mixamo" else 4
            pre = int(math.ceil(k * s_med)) * mul
            post = int(math.ceil(k * ar_med)) * mul
            cl = tgt.get("contacts") or [tgt["contact"]]
            f0, f1 = tgt["range"]
            n0, n1 = max(f0, cl[0] - pre), min(f1, cl[-1] + post)
            if (n0, n1) != (f0, f1) and n0 < cl[0] <= cl[-1] < n1:
                changed.append((cid, [f0, f1], [n0, n1]))
                tgt["range"] = [n0, n1]
                if e["src"] == "layer":
                    e["range"] = [n0, n1]
        self.fitted = changed
        return changed


# --------------------------------------------------------------------------------------------------
# Hurtboxes from body height (FIGHTERS [R]): stand h = 0.95 H (head top), crouch h = 0.60 H,
# air h = 0.62 H (tucked jump). Width = build factor x H: slim 0.27, average 0.30, heavy 0.34,
# monster 0.36. Crouch w = 1.15 stand w, air w = 0.95 stand w. Pushbox = 0.85 stand w x 0.90 stand h.
# --------------------------------------------------------------------------------------------------
BUILD = {"slim": 0.27, "average": 0.30, "heavy": 0.34, "monster": 0.36}


def hurtboxes(i):
    h = i["heightM"]
    w = BUILD[i["build"]] * h
    return {"stand": [round(w, 2), round(0.95 * h, 2)], "crouch": [round(1.15 * w, 2), round(0.60 * h, 2)],
            "air": [round(0.95 * w, 2), round(0.62 * h, 2)]}


def pushbox(i):
    h = i["heightM"]
    w = BUILD[i["build"]] * h
    return [round(0.85 * w, 2), round(0.90 * 0.95 * h, 2)]


# --------------------------------------------------------------------------------------------------
# Frame arithmetic shared by the ROSTER tables (validate.py re-implements it independently on the JSON)
# --------------------------------------------------------------------------------------------------
def adv(o):
    """(on_hit, on_block) as strings for a JSON move."""
    k = o["kind"]
    if o.get("grab"):
        return ("KD +%d" % o["grab"]["adv"], "-")
    if o.get("cinematic"):
        return ("cine, KD +%d" % o["cinematic"].get("endAdv", 0), "%+d" % (o["blockstun"] - o["active"] -
                                                                            o["recovery"]))
    if o["input"].startswith("j.") or o.get("air"):
        return ("air %d" % o["hitstun"], "air %d" % o["blockstun"])
    last = o["startup"]
    if o.get("hits"):
        last = o["hits"][-1]["f"][0]
    after = o["startup"] + o["active"] - last + o["recovery"]
    hb = o["blockstun"] - after
    if o["onHit"]["kd"] != "none":
        la = o["onHit"].get("launch", [0, 0])
        if la and la[1] > 0:
            return ("KD launch", "%+d" % hb)
        return ("KD %+d" % (o["hitstun"] - after), "%+d" % hb)
    if o["kind"] in ("super3",):
        return ("-", "%+d" % hb)
    if o["hitstun"] == 0 and o["blockstun"] == 0:
        return ("-", "-")
    return ("%+d" % (o["hitstun"] - after), "%+d" % hb)
