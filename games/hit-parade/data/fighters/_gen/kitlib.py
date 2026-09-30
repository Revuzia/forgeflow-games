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


def _shared_times():
    """CHANGED(FIGHTERS) P2: (dur s, [contact s]) and marks of the shared clips, read off a baked body (lane ASSETS bakes
    the same shared sources on every body, so durations and marks are identical: kd_fall_b 1.867 s on johnny, bruno and
    freak alike). Used to time cinematic / throw victim segments."""
    p = os.path.join(GAME, "data", "clips", "johnny.clips.json")
    if not os.path.exists(p):
        return {}, {}
    cl = json.load(open(p, encoding="utf-8"))["clips"]
    t, mk = {}, {}
    for k in SHARED:
        c = cl.get(k)
        if c:
            t[k] = (c["dur"], [c["contact"]] if c.get("contact") is not None else [])
            mk[k] = dict(c.get("marks") or {})
    return t, mk


SHARED_TIMES, SHARED_MARKS = _shared_times()
# the shared victim clips' end poses (CONTRACT 26.2): lying face up / face down when the clip ends
LIE_UP = ("kd_fall_b", "thrown_f", "kd_ground_b", "ko_fall")
LIE_DOWN = ("thrown_b", "kd_fall_f", "kd_ground_f", "crumple", "wall_splat")
# reaction clips (a cinematic hit frame must fall inside one of these victim segments)
REACT = ("hit_high_s", "hit_high_l", "hit_body", "hit_low", "hit_air", "crumple", "kd_fall_b", "kd_fall_f",
         "thrown_f", "thrown_b", "wall_splat", "dizzy", "ko_fall", "kd_ground_b", "kd_ground_f")
CAM_SHOTS = ("wide", "close", "low", "over_shoulder", "orbit", "top")
CAM_TARGETS = ("attacker", "defender", "both")
CAM_EASE = ("linear", "in", "out", "inOut", "hold")
FX_NAMES = ("impact_s", "impact_m", "impact_l", "splat", "smear", "dust", "shock_ring", "fire", "electric", "sparks",
            "smoke", "doves", "cards", "ball_trail", "flash", "shake_s", "shake_m", "shake_l", "speed_lines",
            "zoom_lines", "freeze_frame", "letterbox", "letterbox_off", "slate", "dim", "undim", "spot", "spot_off",
            "lights_flicker", "pyro", "confetti")
CROWD_REACTS = ("ooh", "gasp", "cheer", "roar", "boo", "laugh", "hush", "chant", "applause")
RATINGS = ("up", "spike", "peak")


# Framing floors (P2, measured on the cinepreview renders of 2026-09-30: at FOV 30-32 a camera sees 0.54 x dist of height,
# so a 'close' at 1.5-2.1 m looking at the chest (1.2 m) cut every head and an over-the-shoulder at 2.3 m filled half the
# frame with the attacker's back). Values are for a 1.80 m body; VIEW scales lookH / dist by the target's height
# (CONTRACT 26.1 amendment).
FRAMING = {
    ("close", "single"): {"minDist": 2.5, "lookH": 1.45},
    ("close", "both"): {"minDist": 3.0, "lookH": 1.3},
    ("over_shoulder", "single"): {"minDist": 2.9, "minHeight": 1.8, "lookH": 1.4},
    ("over_shoulder", "both"): {"minDist": 3.2, "minHeight": 1.8, "lookH": 1.3},
    ("wide", "single"): {"minDist": 4.5, "lookH": 1.1},
    ("wide", "both"): {"minDist": 4.5, "lookH": 1.1},
}


def _floor(v, lo):
    return max(v, lo) if isinstance(v, (int, float)) else [max(x, lo) for x in v]


def cam(fr, to, shot, target, fov, dist, height, yaw, ease="inOut", **kw):
    """One camera shot of a cinematic (CONTRACT 26.1 `camera`); FRAMING floors applied to close / over-the-shoulder /
    wide shots (a shot's explicit lookH wins)."""
    fr_ = FRAMING.get((shot, "both" if target == "both" else "single"), {})
    if "minDist" in fr_:
        dist = _floor(dist, fr_["minDist"])
    if "minHeight" in fr_:
        height = _floor(height, fr_["minHeight"])
    d = {"from": int(fr), "to": int(to), "shot": shot, "target": target, "fovDeg": fov, "dist": dist,
         "height": height, "yawDeg": yaw, "ease": ease}
    if "lookH" not in kw and "lookH" in fr_:
        d["lookH"] = fr_["lookH"]
    for k in ("lookH", "roll", "blend"):
        if k in kw:
            d[k] = kw[k]
    return d


def cinematic(frames, cue, hits, anim, victim, camera, fx, crowd, pathA, gapD, slate, endPose, endAdv=19,
              endGapM=2.0):
    """CONTRACT 26.1 cinematic v2 block; `shots` is generated from `camera` (old readers)."""
    return {"frames": int(frames), "cue": cue, "hits": [[int(f), int(d)] for f, d in hits], "anim": anim,
            "victim": victim, "shots": [[c["from"], c["shot"]] for c in camera], "camera": camera,
            "fx": [{"f": int(f), "fx": x} if t is None else {"f": int(f), "fx": x, "target": t}
                   for f, x, t in [(e + (None,))[:3] for e in fx]],
            "crowd": [{"f": int(f), "react": r} if g is None else {"f": int(f), "react": r, "ratings": g}
                      for f, r, g in [(e + (None,))[:3] for e in crowd]],
            "pathA": [[int(f), round(x, 3), round(y, 3)] for f, x, y in pathA],
            "gapD": [[int(f), round(x, 3), round(y, 3)] for f, x, y in gapD],
            "slate": slate, "endPose": endPose, "endAdv": int(endAdv), "endGapM": endGapM}

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
            [4, "Front knee chambers (the LEFT leg is the front leg of the shared crouch - lane ASSETS measured; "
                "the spec in art/blender/author_clips.py uses it): UpLeg flexed 45 deg forward of the crouch pose, "
                "shin folded back so the foot sits under the knee 10 cm off the floor; torso leans back 5 deg."],
            [6, "CONTACT: front leg extends straight forward, foot 6 cm above the floor at ~0.75 m in front of "
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
        for k in ("_why", "air", "loop", "floor", "effector", "aim", "limb_lock"):
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

    # ---- CHANGED(FIGHTERS) P2: cinematic v2 + grab victim timelines (CONTRACT 26)
    def resolve(self):
        """Evaluate deferred move fields (a `cinematic` given as a callable): they read clip times, which fit() may have
        just changed, so build.py calls this right after fit()."""
        for mid in self.order:
            m = self.moves[mid]
            for k in ("cinematic",):
                if callable(m.get(k)):
                    m[k] = m[k]()
            g = m.get("grab")
            if g is not None and callable(g.get("victim")):
                g["victim"] = g["victim"]()

    def clip_times(self, cid):
        """(dur s, [contact s ...]) of a clip as the next bake will produce it: the fighter's plan entry (after fit()),
        else a shared clip (durations are identical on every body: shared sources baked per body)."""
        if cid in self.clips:
            return entry_seconds(self.clips[cid])
        if cid in SHARED_TIMES:
            return SHARED_TIMES[cid]
        raise ValueError("%s: unknown clip %s" % (self.info["id"], cid))

    def seg(self, f0, cid, f1, hit=None, k=0, rate=1.0, fromS=None):
        """Attacker / victim sub-clip [f0, clip, fromS, toS] over cinematic (or lock) frames f0..f1. `hit` = the frame the
        clip's k-th contact must land on (the start is back-computed at `rate` clip-s per 60 f); else from `fromS` (0)."""
        dur, cs = self.clip_times(cid)
        span = (f1 - f0) / 60.0 * rate
        if hit is not None:
            c = cs[k]
            a = c - (hit - f0) / 60.0 * rate
            if a < -0.034:   # up to one 30 fps frame early is clamped to the clip start
                raise ValueError("%s seg %s: contact %.3f cannot land on f%d from f%d at rate %.2f" % (
                    self.info["id"], cid, c, hit, f0, rate))
            a = max(0.0, a)
        else:
            a = fromS or 0.0
        b = min(dur, a + span)
        return [int(f0), cid, round(a, 3), round(b, 3)]

    def to_json(self):
        i = self.info
        uq = dict(self.unique)
        if "trait" not in uq:
            uq["trait"] = TRAITS[i["id"]]
        d = {"id": i["id"], "name": i["name"], "persona": i["persona"], "archetype": i["archetype"],
             "difficulty": int(i["doc"]["difficulty"]),
             "body": i["body"], "heightM": i["heightM"], "hp": i["hp"],
             "walk": {"fwd": i["walk"][0], "back": i["walk"][1]},
             "dash": {"fwd": i["dash"][0], "back": i["dash"][1], "fwdFrames": i["dash"][2],
                      "backFrames": i["dash"][3]},
             "jump": {"prejump": i["jump"][0], "air": i["jump"][1], "landing": i["jump"][2],
                      "apexM": i["jump"][3], "fwdM": i["jump"][4]},
             "throwRangeM": i["throwRangeM"], "hurt": hurtboxes(i), "pushbox": pushbox(i),
             "push": push_extents(i["id"]),
             "colors": [{"name": n, "tint": t} for n, t in i["colors"]],
             "moves": {mid: self.emit_move(mid) for mid in self.order},
             "simple": self.simple, "classic": self.classic, "unique": uq,
             "intro": i["intro"], "win": i["win"], "taunt": i["taunt"], "rival": i["rival"],
             "stage": i["stage"], "cpu": i["cpu"]}
        # CHANGED(FIGHTERS) P2 (CONTRACT 26.3): season text, rendered by UI
        t = getattr(self, "text", None)
        if t:
            d["introLine"] = t["introLine"]
            d["winQuotes"] = list(t["winQuotes"])
            d["banter"] = dict(t["banter"])
            d["ending"] = t["ending"]
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


# One-line unique traits (CONTRACT 22.5: UI mirrors unique.trait into strings.json as trait.<fighter>);
# johnny / patch / spin carry theirs in the kit's `none` block.
TRAITS = {
    "bruno": "ARMOR STEP: BRACE walks through one hit into WALK-IN FREEZER or a 2L tick; FRIDGE DOOR walls them in.",
    "boneyard": "ARMOR: 5H, MEAT HOOK and BUTCHER'S BLOCK absorb a hit; big damage per touch, no DP.",
    "freak": "BOSS ARMOR: 5H, 6H and every special take 2 hits of armor; 2.40 m reach and 11,500 HP.",
    "gazza": "THE BALL: one ball on screen - shoot it, park it with KEEPY-UPPY, volley it later; one wall rebound.",
    "krane": "CHARGE + RIOT SHIELD: [4]6 and [2]8 specials; blocking standing drains half the NERVE.",
    "lotus": "SWAY STANCE: leans out of high attacks; L low, M overhead, H hop over lows.",
    "rerun": "PLAY DEAD: drops to the floor and catches strikes on frames 4-20, then rises into a counter.",
    "ricky": "TWO PHASES: below 50% HP the set goes live - PYRO fire lines and a second Lv3, SEASON FINALE.",
    "zambini": "VANISHING ACT: trapdoor teleport behind the opponent or home to his corner; keeps you at 3-5 m.",
}


# --------------------------------------------------------------------------------------------------
# Hurtboxes. Heights are MEASURED on the baked bodies (FIGHTERS [M], 2026-09-30): Blender 5.1 headless,
# mesh max-up of lane ASSETS' art/renders/<id>/_build/raw.glb, median of 7 evenly spaced frames of the
# posture clip each fighter actually plays - `idle` (stand) and `crouch_idle` (crouch), shared or the
# fighter's override (scratch pose_tops.py; numbers in _harness/_reports/progress_fighters.md). The first
# kit rule (crouch 0.60 H) sat 0.13-0.29 m BELOW every measured crouch pose, so standing strikes, overheads,
# projectiles and supers whiffed over crouching bodies that visibly stood taller. Crouch is clamped to the
# stand height (Freak's hunched mutant crouch measures 2.085 m, above his 2.013 m idle). Air h = 0.62 H
# (tucked jump; jump clips are ground-locked, not measurable this way). Width = build factor x H: slim 0.27,
# average 0.30, heavy 0.34, monster 0.36; crouch w = 1.15 stand w, air w = 0.95 stand w.
# Pushbox = 0.85 stand w x 0.90 stand h.
# --------------------------------------------------------------------------------------------------
BUILD = {"slim": 0.27, "average": 0.30, "heavy": 0.34, "monster": 0.36}
# id: (idle median top m, crouch_idle median top m)
POSTURE_M = {
    "johnny": (1.712, 1.271), "patch": (1.674, 1.215), "bruno": (1.745, 1.387), "zambini": (1.744, 1.328),
    "krane": (1.665, 1.159), "lotus": (1.623, 1.164), "boneyard": (1.747, 1.438), "spin": (1.619, 1.270),
    "gazza": (1.795, 1.280), "rerun": (1.662, 1.219), "freak": (2.013, 2.085), "ricky": (1.793, 1.265),
}
# The crouch line: the lowest measured crouch top in the roster (krane 1.159) minus 0.05 m. A grounded strike
# that is meant to hit crouching opponents must reach at least this low (build.py crouch-reach rule).
CROUCH_LINE_M = 1.10
BOX_EXT_CAP_M = 0.50
# Reversal anti-airs (DPs): only the FIRST hit must reach crouch / point blank (later hits are the airborne rise);
# its cap is 0.60 m because the rising arm sweeps up through that space during the first active frames while
# the clip contact (the fist at the top) sits higher.
REV_EXT_CAP_M = 0.60
# Point-blank reach: bodies touching = pushbox fronts together. Against the slimmest body in the roster
# (pushbox 0.39 m, stand hurtbox 0.46 m wide: lotus / patch) the defender's hurtbox far edge is then
# (pb_attacker + 0.39) / 2 + 0.23 ahead of the attacker; a strike's box must start at least 0.10 m inside it
# or the move whiffs a touching opponent (measured: Freak's 1.16 m claw rushes / Meltdown only connected from
# 2.4-3.2 m, nothing closer).
PB_MIN_M, HURT_HALF_MIN_M, PB_MARGIN_M = 0.39, 0.23, 0.10
# CHANGED(fixer) D2: with measured, asymmetric push boxes "touching" = the attacker's push FRONT + the defender's push FRONT
# apart; the defender's hurtbox (centred on its root) then reaches front_att + (front_def + hurt_half_def). build.py sets
# ROSTER_DEF_MIN = the smallest (front_def + hurt_half_def) in the roster (the slimmest touching defender).
ROSTER_DEF_MIN = None


def point_blank_near_max(pb_w, front=None):
    """Box near-edge limit (m, from the attacker's root) that still hits the slimmest TOUCHING defender by PB_MARGIN_M.
    With `front` (the attacker's measured push front) and ROSTER_DEF_MIN set: front + ROSTER_DEF_MIN - margin; else the
    symmetric-box rule (pb_w + 0.39) / 2 + 0.23 - margin."""
    if front is not None and ROSTER_DEF_MIN is not None:
        return front + ROSTER_DEF_MIN - PB_MARGIN_M
    return (pb_w + PB_MIN_M) / 2.0 + HURT_HALF_MIN_M - PB_MARGIN_M


def posture_tops(i):
    st, cr = POSTURE_M[i["id"]]
    return round(st, 2), round(min(cr, st), 2)


def hurtboxes(i):
    h = i["heightM"]
    w = BUILD[i["build"]] * h
    st, cr = posture_tops(i)
    return {"stand": [round(w, 2), st], "crouch": [round(1.15 * w, 2), cr],
            "air": [round(0.95 * w, 2), round(0.62 * h, 2)]}


def pushbox(i):
    """[w, h]. CHANGED(fixer) D2: w = measured front + back (push_extents) when the body is measured, else the old
    build-factor guess (0.85 x stand width)."""
    h = i["heightM"]
    st, _ = posture_tops(i)
    pe = push_extents(i["id"])
    if pe:
        return [round(pe["front"] + pe["back"], 2), round(0.90 * st, 2)]
    w = BUILD[i["build"]] * h
    return [round(0.85 * w, 2), round(0.90 * st, 2)]


# --------------------------------------------------------------------------------------------------
# CHANGED(fixer) D2: push boxes MEASURED on the baked bodies. The build-factor box (0.85 x 0.30 H, centred on the root)
# let two neutral bodies overlap by 0.3-0.4 m at the minimum separation (verifier D2: johnny vs bruno stopped 0.52 m apart,
# Johnny's head inside Bruno's hunched chest). art/blender/measure_body.py evaluates the skinned mesh of every clip per
# baked frame (lane ASSETS qc.glb) and records the 98th-percentile forward / backward extent of the CORE vertices (hips,
# spine, neck, head, shoulders, thighs - arms, shins and feet may overlap an opponent as in any 2D / 2.5D fighter) into
# tools/measure/<id>.body_all.json. Rules:
#   stand front = max(median over idle frames, median over walk_f frames) (the poses bodies meet in; a walk-in peak
#                 may kiss, an idle pair never overlaps); stand back = max(median idle back, median walk_b back)
#   crouch front / back = median over crouch_idle frames (the sim uses them while FL.CROUCHING)
#   pushExt (per move) = the move clip's core front over the stand (or crouch, for 1/2/3 normals) front, mapped through
#                 the move's anim warp to sim frames, kept when it reaches >= 0.04 m, simplified to a <= 0.02 m error
# --------------------------------------------------------------------------------------------------
MEASURE_DIR = os.path.join(GAME, "tools", "measure")
PUSHEXT_MIN_M = 0.04
PUSHEXT_TOL_M = 0.02
_MEASURED = {}


def body_measure(fid):
    if fid not in _MEASURED:
        p = os.path.join(MEASURE_DIR, fid + ".body_all.json")
        _MEASURED[fid] = json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None
    return _MEASURED[fid]


def _median(xs):
    ys = sorted(xs)
    n = len(ys)
    if n == 0:
        return 0.0
    return ys[n // 2] if n % 2 else 0.5 * (ys[n // 2 - 1] + ys[n // 2])


def push_extents(fid):
    """{"front", "back", "crouchFront", "crouchBack"} (m) or None when the body has no measurement."""
    mb = body_measure(fid)
    if not mb:
        return None
    c = mb["clips"]

    def med(clip, key):
        r = c.get(clip)
        return _median(r[key]) if r and not r.get("missing") and r.get(key) else None

    fr = [v for v in (med("idle", "core_front"), med("walk_f", "core_front")) if v is not None]
    bk = [v for v in (med("idle", "core_back"), med("walk_b", "core_back")) if v is not None]
    if not fr or not bk:
        return None
    front, back = max(fr), max(bk)
    cf, cb = med("crouch_idle", "core_front"), med("crouch_idle", "core_back")
    out = {"front": round(front, 3), "back": round(back, 3)}
    out["crouchFront"] = round(cf if cf is not None else front, 3)
    out["crouchBack"] = round(cb if cb is not None else back, 3)
    return out


def _pwl(pts, x):
    if x <= pts[0][0]:
        return pts[0][1]
    for (a, ya), (b, yb) in zip(pts, pts[1:]):
        if x <= b:
            return ya if b == a else ya + (yb - ya) * (x - a) / float(b - a)
    return pts[-1][1]


def _simplify(pts, tol):
    """Douglas-Peucker on [frame, value] points."""
    if len(pts) <= 2:
        return pts
    a, b = pts[0], pts[-1]
    worst, wi = -1.0, -1
    for k in range(1, len(pts) - 1):
        f, v = pts[k]
        t = (f - a[0]) / float(b[0] - a[0]) if b[0] != a[0] else 0.0
        e = abs(v - (a[1] + (b[1] - a[1]) * t))
        if e > worst:
            worst, wi = e, k
    if worst <= tol:
        return [a, b]
    return _simplify(pts[:wi + 1], tol)[:-1] + _simplify(pts[wi:], tol)


def push_ext_curve(fid, o, clips_file):
    """The move's pushExt [[frame, m], ...] or None (see the block comment above)."""
    mb = body_measure(fid)
    pe = push_extents(fid)
    if not mb or not pe or not clips_file:
        return None
    clip = o.get("anim", {}).get("clip")
    r = mb["clips"].get(clip)
    ci = clips_file["clips"].get(clip)
    if not r or r.get("missing") or not ci:
        return None
    total1 = o["startup"] + o["active"] + o["recovery"]
    warp = o["anim"].get("warp")
    if not warp:
        dur, con = ci["dur"], ci.get("contact")
        warp = [[0, 0.0], [o["startup"], con], [total1, dur]] if con is not None and 0 < con < dur else [[0, 0.0], [total1, dur]]
    inp = o.get("input", "")
    crouch = o["kind"] in ("normal", "command") and not inp.startswith("j.") and inp[:1] in ("1", "2", "3")
    base = pe["crouchFront"] if crouch else pe["front"]
    cfr = r["core_front"]
    pts = []
    for f in range(0, total1 + 1):
        t = _pwl(warp, f)
        k = max(0, min(len(cfr) - 1, int(round(t * 30.0))))
        pts.append([f, max(0.0, cfr[k] - base)])
    if max(v for _, v in pts) < PUSHEXT_MIN_M:
        return None
    sp = _simplify(pts, PUSHEXT_TOL_M)
    return [[int(f), round(v, 3)] for f, v in sp]


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
