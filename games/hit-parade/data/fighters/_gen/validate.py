"""Validate data/fighters/*.json + tools/clipplan/*.json against CONTRACT 5.2 / 5.4 / 6.2 / 19 / 20.

Reads ONLY the emitted JSON (never the kit sources), re-derives the frame arithmetic with the
tools/research/fg_template_check.py convention, and checks:
  - required fields and enums on every fighter and every move
  - CONTRACT 5.4 roster table values (name, body, HP, stage, rival)
  - advantage arithmetic: total = S+A+R-1; on hit / on block; no ground normal <= -5 on block unless role
    sweep / antiair (fg_template_check rule); KD hitstun rule (19.3)
  - multi-hit sums, cinematic <= 180 frames and damage sums, grab blocks, projectile blocks
  - routing: simple/classic ids resolve ({s} expansion), EX ids, assist ids, chain targets, tc reachability
  - every anim.clip / grab clip / cinematic clip / intro / win / taunt / stance clip exists in the fighter's
    clip plan or the shared set; clip-plan sources inside the measured source lengths
  - hit volumes (ROSTER.md conventions, 2026-09-30): crouch hurtbox <= stand; every grounded non-anti-air
    strike's box (explicit, else SIM-derived from data/clips/<id>.clips.json) reaches the 1.10 m crouch line
    (world height incl. moveY) and starts within point-blank reach; straight projectiles reach the line;
    `boxSrc: hitVolume` boxes still match the clips.json effector (stale after a re-bake -> rerun build.py);
    box frames inside the active frames. Clips whose plan differs from the published bake
    (art/renders/<id>/_build/bake.json src) are reported PENDING (lane ASSETS re-bake), not failed.
  - CHANGED(FIGHTERS3D) 3D ring fields (CONTRACT 35.12): every move's track {until, rate} matches its class (homing =
    last active frame at 20 deg/f, linear = frame 1, else startup - 6 (throws - 4) at 180), homing strikes >= 0.40 m deep,
    lateralM on every strike and only there, projectile aimed + lateralM, step-attacks (SS.<btn>, role stepatk; patch
    and spin must have one), every fighter has a reliable homing tool and an antistep move, cpu antiStep / stepAttack
    refs resolve, and _spec/ROSTER.md carries each fighter's "3D ring play" section.
Writes _harness/_reports/fighters_validate.txt. Exit 0 = PASS, 1 = FAIL.
Usage: python data/fighters/_gen/validate.py
"""
import importlib.util
import json
import math
import os
import re
import sys

sys.dont_write_bytecode = True  # keep data/ free of __pycache__

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.normpath(os.path.join(HERE, "..", "..", ".."))
FDIR = os.path.join(GAME, "data", "fighters")
PDIR = os.path.join(GAME, "tools", "clipplan")
REPORT = os.path.join(GAME, "_harness", "_reports", "fighters_validate.txt")
MIX_INV = os.path.join(GAME, "_research", "animations", "mixamo_inventory.json")
CMU_ROOT = "F:/games/forgeflow-games-assets/_downloaded/cmu-mocap/cmu-mocap-master/data"

SHARED = ["idle", "walk_f", "walk_b", "crouch", "crouch_idle", "jump_up", "jump_f", "jump_b", "land",
          "dash_f", "dash_b", "block_high", "block_low", "hit_high_s", "hit_high_l", "hit_body", "hit_low",
          "hit_air", "crumple", "kd_fall_b", "kd_fall_f", "kd_ground_b", "kd_ground_f", "wake_b", "wake_f",
          "wall_splat", "thrown_f", "thrown_b", "dizzy", "ko_fall", "timeover_lose", "parry",
          "impact_windup", "shove"]
# CONTRACT 5.4
ROSTER = {
    "johnny": ("JOHNNY RIOT", "Ch42_nonPBR", 10000, "rust_theater", "boneyard", "none"),
    "patch": ("PATCH", "Eve By J.Gonzales", 9500, "rooftop", "spin", "none"),
    "bruno": ('BRUNO "THE FRIDGE"', "Brute", 11000, "butcher_block", "krane", "armorStep"),
    "zambini": ("THE GREAT ZAMBINI", "Whiteclown N Hallin", 9500, "wheel_of_pain", "gazza", "teleport"),
    "krane": ("OFFICER KRANE", "Swat", 10000, "control_room", "bruno", "charge"),
    "lotus": ("LOTUS LIU", "Kachujin G Rosales", 9500, "wheel_of_pain", "rerun", "stance"),
    "boneyard": ("BONEYARD", "Ch05_nonPBR", 10500, "butcher_block", "johnny", "armorStep"),
    "spin": ("SPIN", "Ch06_nonPBR", 9500, "rooftop", "patch", "none"),
    "gazza": ("GAZZA", "Ch08_nonPBR", 10000, "rooftop", "zambini", "ball"),
    "rerun": ("RERUN", "Prisoner B Styperek", 10000, "rust_theater", "lotus", "counter"),
    "freak": ("THE FREAK", "Mutant", 11500, "butcher_block", "-", "armorStep"),
    "ricky": ("RICKY MARQUEE", "Ch40_nonPBR", 13000, "control_room", "-", "phases"),
}
KINDS = {"normal", "command", "special", "ex", "super1", "super3", "throw", "cmdgrab", "projectile", "system"}
GUARDS = {"HL", "H", "L", "U"}
KDS = {"none", "soft", "hard"}
MOTIONS = {"236", "214", "623", "421", "41236", "63214", "360", "236236", "214214", "[4]6", "[2]8", "22"}
SIMPLE_KEYS = {"5S", "6S", "2S", "4S", "jS", "S+H", "S+H+2", "assist", "A5S", "A6S", "A2S", "A4S"}
MOVE_REQ = ["kind", "input", "name", "strength", "startup", "active", "recovery", "damage", "chipPct", "hitstop",
            "hitstun", "blockstun", "guard", "move", "pushback", "cancel", "juggle", "onHit", "gain", "cost",
            "invuln", "armor", "anim", "role", "desc"]
TOP_REQ = ["id", "name", "persona", "archetype", "body", "heightM", "hp", "walk", "dash", "jump", "throwRangeM",
           "hurt", "pushbox", "colors", "moves", "simple", "classic", "unique", "intro", "win", "taunt", "rival",
           "stage", "cpu"]

ROUTER = os.path.join(GAME, "runtime", "src", "audio", "router.ts")
OUT = []
FAILS = []
PENDING = []
# hit-volume constants (duplicated from the ROSTER.md conventions on purpose: this validator never imports the
# kit sources). Crouch line = lowest measured crouch top (krane 1.159 m) - 0.05; point blank = the slimmest
# defender (pushbox 0.39, hurtbox half 0.23) touching, minus 0.10 m.
CROUCH_LINE, EXT_CAP = 1.10, 0.50
SYSTEM = os.path.join(GAME, "data", "system.json")


ROSTER_DEF_MIN = None   # CHANGED(fixer) D2: min(push.front + hurt.stand[0] / 2) over data/fighters/*.json (main)


def pb_near_max(pb_w, front=None):
    """CHANGED(fixer) D2: with measured push boxes, touching = push front + push front apart, so a box must start
    within front + ROSTER_DEF_MIN - 0.10 m (the slimmest touching defender); else the symmetric-box rule."""
    if front is not None and ROSTER_DEF_MIN is not None:
        return front + ROSTER_DEF_MIN - 0.10
    return (pb_w + 0.39) / 2.0 + 0.23 - 0.10


def _strip(o):
    if isinstance(o, dict):
        # `marks` only add named times (e.g. THROW PAIR SYNC slam); they never move the pose or the effector
        return {k: _strip(v) for k, v in o.items() if not k.startswith("_") and k not in ("id", "marks")}
    if isinstance(o, list):
        return [_strip(x) for x in o]
    if isinstance(o, float) and o == int(o):
        return int(o)
    return o


def lift_at(o, f):
    pts = o.get("moveY")
    if not pts:
        return 0.0
    if f <= pts[0][0]:
        return pts[0][1]
    for (a, ya), (b, yb) in zip(pts, pts[1:]):
        if a <= f <= b:
            return ya + (yb - ya) * (f - a) / float(b - a) if b > a else yb
    return pts[-1][1]


def check_hit_volume(fid, d, plan):
    moves = d["moves"]
    if d["hurt"]["crouch"][1] > d["hurt"]["stand"][1]:
        fail(fid, "crouch hurtbox %.2f taller than stand %.2f" % (d["hurt"]["crouch"][1], d["hurt"]["stand"][1]))
    cp = os.path.join(GAME, "data", "clips", fid + ".clips.json")
    if not os.path.exists(cp):
        say("  hit volumes: clips.json not generated yet - skipped")
        return
    clips = json.load(open(cp, encoding="utf-8"))["clips"]
    sysb = json.load(open(SYSTEM, encoding="utf-8"))["boxes"]
    bp = os.path.join(GAME, "art", "renders", fid, "_build", "bake.json")
    pending = set()
    if os.path.exists(bp):
        baked = json.load(open(bp, encoding="utf-8")).get("clips", {})
        pending = {c for c, e in plan.items() if c not in baked or _strip(e) != _strip(baked[c].get("src", {}))}
    near_max = pb_near_max(d["pushbox"][0], (d.get("push") or {}).get("front"))
    n_ok = n_explicit = 0
    for mid, o in moves.items():
        last_act = o["startup"] + o["active"] - 1
        for b in o.get("boxes", []):
            if not (o["startup"] <= b["f"][0] <= b["f"][1] <= last_act):
                fail(fid, "%s: box frames %s outside the active frames %d-%d" % (mid, b["f"], o["startup"], last_act))
        pj = o.get("projectile")
        roles = set(o.get("role", []))
        ground = not (o["input"].startswith("j.") or o.get("air") is True)
        if pj and ground and "antiair" not in roles and not pj.get("g") and not pj.get("vy"):
            if pj["y"] - pj["box"][1] / 2.0 > CROUCH_LINE + 1e-6:
                fail(fid, "%s: projectile box bottom %.2f m above the crouch line %.2f" % (
                    mid, pj["y"] - pj["box"][1] / 2.0, CROUCH_LINE))
        strike = not (o["kind"] in ("throw", "cmdgrab") or o.get("grab") or pj) and bool(
            o.get("cinematic") or o["damage"] > 0)
        if not strike or not ground or "high" in roles or ("antiair" in roles and "reversal" not in roles):
            continue
        clip = o["anim"]["clip"]
        c = clips.get(clip)
        if "boxes" in o:
            boxes = o["boxes"]
            n_explicit += 1
            if o.get("boxSrc") == "hitVolume":
                if clip in pending:
                    PENDING.append("%s %s: boxSrc hitVolume on clip %s that awaits a re-bake" % (fid, mid, clip))
                elif c and c.get("effector"):
                    st = "H" if o["kind"] in ("super1", "super3") else o["strength"]
                    w, h = sysb[st]
                    ex, ey = c["effector"]["at"]
                    for b in boxes:
                        if abs(b["x"] + b["w"] / 2 - (ex + w / 2)) > 0.011 or                                 abs(b["y"] + b["h"] / 2 - (ey + h / 2)) > 0.011:
                            fail(fid, "%s: hitVolume box no longer matches clips.json %s effector %s (re-run "
                                      "build.py)" % (mid, clip, c["effector"]["at"]))
                            break
        else:
            if clip in pending:
                PENDING.append("%s %s: clip %s awaits a lane ASSETS re-bake (plan changed); derived box is stale" % (
                    fid, mid, clip))
                continue
            if not c or not c.get("effector"):
                continue
            st = "H" if o["kind"] in ("super1", "super3") else o["strength"]
            w, h = sysb[st]
            ranges = [x["f"] for x in o["hits"]] if o.get("hits") else [[o["startup"], last_act]]
            boxes = [{"f": r, "x": c["effector"]["at"][0], "y": c["effector"]["at"][1], "w": w, "h": h}
                     for r in ranges]
        bad = None
        rev = "antiair" in roles   # reversal anti-air: only the first (grounded) hit must reach
        for bi, b in enumerate(boxes):
            if rev and bi > 0:
                continue
            bottom = lift_at(o, b["f"][0]) + b["y"] - b["h"] / 2.0
            if bottom > CROUCH_LINE + 0.002:   # 0.002: boxes are written at 3 decimals
                bad = "box bottom %.2f m (world) above the crouch line %.2f m - whiffs crouching opponents" % (
                    bottom, CROUCH_LINE)
                break
            if b["x"] - b["w"] / 2.0 > near_max + 0.002:
                bad = "box near edge %.2f m beyond point-blank reach %.2f m - whiffs a touching opponent" % (
                    b["x"] - b["w"] / 2.0, near_max)
                break
        if bad:
            fail(fid, "%s: %s" % (mid, bad))
        else:
            n_ok += 1
    say("  hit volumes: %d grounded strikes reach crouch + point blank (%d with explicit boxes); pending clips %s" % (
        n_ok, n_explicit, sorted(pending) or "none"))


def sfx_names():
    """SFX_CUE_ALIASES keys from lane AUDIO's router.ts (CONTRACT 9.1: probe_audio fails on unknown names)."""
    if not os.path.exists(ROUTER):
        return None
    src = open(ROUTER, encoding="utf-8").read()
    i = src.find("SFX_CUE_ALIASES")
    j = src.find("};", i)
    return set(re.findall(r"([a-z_0-9]+):\s*'", src[i:j]))


def say(s=""):
    OUT.append(s)
    print(s)


def fail(fid, msg):
    FAILS.append("%s: %s" % (fid, msg))
    say("  FAIL %s" % msg)


def template_check():
    """Run the research script's arithmetic on its own template rows (fg_template_check logic)."""
    p = os.path.join(GAME, "tools", "research", "fg_template_check.py")
    spec = importlib.util.spec_from_file_location("fgt", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    rows = []
    for (n, s, a, r, hs, bs, *_rest) in m.MOVES:
        oh, ob = m.adv(hs, a, r), m.adv(bs, a, r)
        rows.append((n, s, a, r, oh, ob))
    return m, rows


def adv_of(o):
    """(kind_of_result, on_hit, on_block) with the fg_template_check convention."""
    last = o["startup"]
    if o.get("hits"):
        last = o["hits"][-1]["f"][0]
    after = o["startup"] + o["active"] - last + o["recovery"]
    return o["hitstun"] - after, o["blockstun"] - after


_BVH = {}


def bvh_frames(take):
    if take not in _BVH:
        p = "%s/%03d/%s.bvh" % (CMU_ROOT, int(take.split("_")[0]), take)
        n = None
        if os.path.exists(p):
            with open(p, encoding="ascii", errors="replace") as fh:
                for line in fh:
                    if line.startswith("Frames:"):
                        n = int(line.split()[1])
                        break
        _BVH[take] = n
    return _BVH[take]


def check_plan_entry(fid, cid, e, mix):
    s = e.get("src")
    if s == "mixamo":
        fn = e.get("file", "")
        if fn.endswith(".fbx"):
            fail(fid, "clip %s: mixamo file must omit .fbx (ASSETS builder appends it)" % cid)
        c = mix.get(fn + ".fbx")
        if not c:
            fail(fid, "clip %s: mixamo file %r not in mixamo_inventory.json" % (cid, fn))
            return
        f0, f1 = e["range"]
        if not (1 <= f0 < f1 <= c):
            fail(fid, "clip %s: range %s outside 1..%d" % (cid, e["range"], c))
        if e.get("contact") is not None and not (f0 <= e["contact"] <= f1):
            fail(fid, "clip %s: contact %s outside %s" % (cid, e["contact"], e["range"]))
        for mk, mf in (e.get("marks") or {}).items():
            if not (f0 <= mf <= f1):
                fail(fid, "clip %s: mark %s=%s outside %s" % (cid, mk, mf, e["range"]))
    elif s == "cmu":
        n = bvh_frames(e.get("file", ""))
        f0, f1 = e["range"]
        if n is None or not (1 <= f0 < f1 < n):
            fail(fid, "clip %s: CMU %s range %s outside 1..%s" % (cid, e.get("file"), e["range"], n))
        for k in ("kind", "limb", "fist", "mirror"):
            if k not in e:
                fail(fid, "clip %s: CMU entry missing %s" % (cid, k))
    elif s == "layer":
        ly = e.get("layer", {})
        for k in ("lower", "upper", "split", "lowerMode"):
            if k not in ly:
                fail(fid, "clip %s: layer missing %s" % (cid, k))
        if ly.get("lowerMode") not in ("hold", "loop", "sync"):
            fail(fid, "clip %s: lowerMode %r" % (cid, ly.get("lowerMode")))
        check_plan_entry(fid, cid, ly["lower"], mix)
        check_plan_entry(fid, cid, ly["upper"], mix)
        lo = ly["lower"]
        n_lo = int((lo["range"][1] - lo["range"][0]) / float(lo.get("speed", 1.0)) + 1e-6) + 1
        if e.get("_upperFrames") and n_lo != e["_upperFrames"]:
            fail(fid, "clip %s: lower plays %d frames, upper has %d (builder time-warps the upper onto the "
                      "lower)" % (cid, n_lo, e["_upperFrames"]))
        if e.get("contact") is not None and not (lo["range"][0] <= e["contact"] <= lo["range"][1]):
            fail(fid, "clip %s: layer contact %s is not a lower-source frame in %s" % (cid, e["contact"], lo["range"]))
    elif s == "seq":
        if not e.get("seq"):
            fail(fid, "clip %s: empty seq" % cid)
        for x in e.get("seq", []):
            check_plan_entry(fid, cid, x, mix)
    elif s == "author":
        for k in ("file", "frames", "contact", "_keys"):
            if k not in e:
                fail(fid, "clip %s: author entry missing %s" % (cid, k))
        if e.get("file") not in ("crouch_toe_kick", "crouch_shin_kick"):
            fail(fid, "clip %s: unknown authored motion %r" % (cid, e.get("file")))
        if not (0 <= e.get("contact", -1) < e.get("frames", 0)):
            fail(fid, "clip %s: author contact outside 0..frames-1" % cid)
        check_plan_entry(fid, cid, e["_base"], mix)
    else:
        fail(fid, "clip %s: src %r not mixamo|cmu|layer|seq|author" % (cid, s))


SFX = None

# ------------------------------------------------------------------ CHANGED(FIGHTERS) P2: CONTRACT 26 checks
# lying pose each shared clip ends in, and the clip time from which it already lies (read off the victim-clip render
# sheet of 2026-09-30: kd_fall_b lies from 1.45 s, thrown_f lands at 0.74 s, thrown_b at 0.67 s, ...)
LYING = {"kd_fall_b": (1.4, "back"), "thrown_f": (0.73, "back"), "kd_ground_b": (0.0, "back"), "ko_fall": (1.79, "back"),
         "thrown_b": (0.66, "front"), "kd_fall_f": (1.19, "front"), "kd_ground_f": (0.0, "front"),
         "crumple": (1.74, "front"), "wall_splat": (1.09, "front")}
REACT = {"hit_high_s", "hit_high_l", "hit_body", "hit_low", "hit_air", "crumple", "kd_fall_b", "kd_fall_f", "thrown_f",
         "thrown_b", "wall_splat", "dizzy", "ko_fall", "kd_ground_b", "kd_ground_f"}
CAM_SHOTS = {"wide", "close", "low", "over_shoulder", "orbit", "top"}
CAM_TARGETS = {"attacker", "defender", "both"}
CAM_EASE = {"linear", "in", "out", "inOut", "hold"}
FX_NAMES = {"impact_s", "impact_m", "impact_l", "splat", "smear", "dust", "shock_ring", "fire", "electric", "sparks",
            "smoke", "doves", "cards", "ball_trail", "flash", "shake_s", "shake_m", "shake_l", "speed_lines",
            "zoom_lines", "freeze_frame", "letterbox", "letterbox_off", "slate", "dim", "undim", "spot", "spot_off",
            "lights_flicker", "pyro", "confetti"}
FX_TARGETS = {"attacker", "defender", "both", "stage"}
CROWD_REACTS = {"ooh", "gasp", "cheer", "roar", "boo", "laugh", "hush", "chant", "applause"}
RATINGS = {"up", "spike", "peak"}
PLAYABLE = ["johnny", "patch", "bruno", "zambini", "krane", "lotus", "boneyard", "spin", "gazza", "rerun"]
_CL = {}
_PEND = {}


def clips_of(fid):
    if fid not in _CL:
        p = os.path.join(GAME, "data", "clips", fid + ".clips.json")
        _CL[fid] = json.load(open(p, encoding="utf-8"))["clips"] if os.path.exists(p) else {}
    return _CL[fid]


def pending_of(fid, plan):
    if fid not in _PEND:
        bp = os.path.join(GAME, "art", "renders", fid, "_build", "bake.json")
        out = set()
        if os.path.exists(bp):
            baked = json.load(open(bp, encoding="utf-8")).get("clips", {})
            out = {c for c, e in plan.items() if c not in baked or _strip(e) != _strip(baked[c].get("src", {}))}
        _PEND[fid] = out
    return _PEND[fid]


def root_at(c, t):
    r = c.get("root") or []
    if not r:
        return 0.0
    return min(r, key=lambda q: abs(q[0] - t))[1]


def check_rows(fid, where, rows, frames, clips, pend, shared_only):
    """Timeline rows [f0, clip, fromS?, toS?]: sorted, first at 0, inside the span, clip times inside the clip."""
    if not rows or rows[0][0] != 0:
        fail(fid, "%s: timeline must start at frame 0" % where)
    last = -1
    for e in rows:
        if len(e) not in (2, 4):
            fail(fid, "%s: row %s is not [f0, clip] or [f0, clip, fromS, toS]" % (where, e))
            continue
        if not (last < e[0] < frames):
            fail(fid, "%s: row frame %s not increasing inside 0..%d" % (where, e[0], frames - 1))
        last = e[0]
        if shared_only and e[1] not in SHARED:
            fail(fid, "%s: %r is not a shared clip" % (where, e[1]))
        if len(e) == 4:
            if not (0 <= e[2] <= e[3]):
                fail(fid, "%s: row %s has fromS > toS" % (where, e))
            if e[1] in pend:
                PENDING.append("%s %s: clip %s awaits a re-bake (clip-time range unchecked)" % (fid, where, e[1]))
                continue
            c = clips.get(e[1])
            if c is None:
                fail(fid, "%s: clip %r not in clips.json" % (where, e[1]))
            elif e[3] > c["dur"] + 0.002:
                fail(fid, "%s: row %s runs past the clip end %.3f s" % (where, e, c["dur"]))


def lying_ok(fid, where, row, want=None):
    lie = LYING.get(row[1])
    if lie is None:
        fail(fid, "%s: last segment %r does not end on the floor (CONTRACT 26.2)" % (where, row[1]))
        return None
    if len(row) == 4 and row[3] < lie[0] - 1e-6:
        fail(fid, "%s: last segment %r stops at %.2f s, before the body lies (%.2f s)" % (where, row[1], row[3], lie[0]))
    if want is not None and lie[1] != want:
        fail(fid, "%s: endPose %s but the last segment %r ends lying %s" % (where, want, row[1], lie[1]))
    return lie[1]


def num_or_pair(v):
    if isinstance(v, (int, float)):
        return [v]
    if isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v):
        return v
    return None


def check_cinematic_v2(fid, mid, o, c, plan):
    where = "%s cinematic" % mid
    for k in ("camera", "fx", "crowd", "pathA", "gapD", "slate", "endPose"):
        if k not in c:
            fail(fid, "%s.%s missing (CONTRACT 26.1)" % (where, k))
            return
    n = c["frames"]
    ref = clips_of("johnny")
    check_rows(fid, where + " anim", c["anim"], n, clips_of(fid), pending_of(fid, plan), False)
    check_rows(fid, where + " victim", c["victim"], n, ref, set(), True)
    for f, _ in c["hits"]:
        seg = [e for e in c["victim"] if e[0] <= f][-1:]
        if not seg or seg[0][1] not in REACT:
            fail(fid, "%s: hit frame %d has no reacting victim segment" % (where, f))
    lying_ok(fid, where + " victim", c["victim"][-1], c["endPose"])
    cams = c["camera"]
    if not cams or cams[0]["from"] != 0 or cams[-1]["to"] != n:
        fail(fid, "%s camera: shots must cover [0, %d)" % (where, n))
    for a, b in zip(cams, cams[1:]):
        if a["to"] != b["from"]:
            fail(fid, "%s camera: gap/overlap between f%d and f%d" % (where, a["to"], b["from"]))
    for k in cams:
        tag = "%s camera f%d" % (where, k.get("from", -1))
        if not (0 <= k["from"] < k["to"] <= n):
            fail(fid, "%s: bad span %s-%s" % (tag, k["from"], k["to"]))
        if k["shot"] not in CAM_SHOTS or k["target"] not in CAM_TARGETS or k.get("ease", "inOut") not in CAM_EASE:
            fail(fid, "%s: shot/target/ease %r/%r/%r" % (tag, k["shot"], k["target"], k.get("ease")))
        for key, lo, hi in (("fovDeg", 15, 80), ("dist", 0.3, 12), ("height", 0.0, 8.0), ("yawDeg", -150, 150),
                            ("lookH", 0.0, 3.0), ("roll", -30, 30)):
            if key not in k:
                if key in ("fovDeg", "dist", "height", "yawDeg"):
                    fail(fid, "%s: %s missing" % (tag, key))
                continue
            v = num_or_pair(k[key])
            if v is None or any(not (lo <= x <= hi) for x in v):
                fail(fid, "%s: %s %r outside %s..%s" % (tag, key, k[key], lo, hi))
    if c["shots"] != [[k["from"], k["shot"]] for k in cams]:
        fail(fid, "%s: shots are not generated from camera" % where)
    for e in c["fx"]:
        if not (0 <= e["f"] < n) or e["fx"] not in FX_NAMES or e.get("target", "stage") not in FX_TARGETS:
            fail(fid, "%s fx: bad beat %s" % (where, e))
    for e in c["crowd"]:
        if not (0 <= e["f"] < n) or e["react"] not in CROWD_REACTS or e.get("ratings", "up") not in RATINGS:
            fail(fid, "%s crowd: bad beat %s" % (where, e))
    for key, end_gap in (("pathA", 0.0), ("gapD", c["endGapM"])):
        rows = c[key]
        if not rows:
            fail(fid, "%s %s: empty" % (where, key))
            continue
        last = 0
        for row in rows:
            f, x, y = row[0], row[1], row[2]   # CHANGED(wf6_fixer_core) V2: gapD rows may carry a 4th number (turnDeg)
            if not (last < f < n) or y < 0:
                fail(fid, "%s %s: key f%d (x %.2f, lift %.2f) not increasing inside 1..%d or lift < 0" % (
                    where, key, f, x, y, n - 1))
            last = f
        if abs(rows[-1][1] - end_gap) > 1e-6 or abs(rows[-1][2]) > 1e-6:
            fail(fid, "%s %s: last key %s must be [f, %.2f, 0] (sim end state)" % (where, key, rows[-1], end_gap))
    if not isinstance(c["slate"], str) or not c["slate"] or not c["slate"].isascii():
        fail(fid, "%s: slate must be non-empty ASCII text" % where)
    g = o.get("grab")
    if g is not None and g.get("victim") != c["victim"]:
        fail(fid, "%s: a grab super's grab.victim must equal the cinematic victim timeline" % where)


def check_grab_victim(fid, mid, o, g):
    where = "%s grab.victim" % mid
    v = g.get("victim")
    if not v:
        fail(fid, "%s: missing (CONTRACT 26.2: every throw / command grab has a paired victim timeline)" % where)
        return
    if len(v) > 8:
        fail(fid, "%s: %d segments > 8 (sim limit)" % (where, len(v)))
    ref = clips_of("johnny")
    check_rows(fid, where, v, g["frames"], ref, set(), True)
    lying_ok(fid, where, v[-1])
    seg = [e for e in v if e[0] <= g["hitF"]][-1:]
    if not seg or seg[0][1] not in REACT:
        fail(fid, "%s: damage frame hitF %d is not inside a reacting segment" % (where, g["hitF"]))
    tw = json.load(open(SYSTEM, encoding="utf-8"))["throw"]["techWindow"]
    if g.get("techable") and g["hitF"] <= tw:
        fail(fid, "%s: techable throw deals damage on lock frame %d, inside the %d-frame tech window (probe_data G1)" % (
            where, g["hitF"], tw))
    travel = 0.0
    for e in v:
        c = ref.get(e[1])
        if c and len(e) == 4:
            travel += root_at(c, e[3]) - root_at(c, e[2])
    if g.get("swap") and travel < 0.5:
        fail(fid, "%s: side-swap victim travels %.2f m forward in total (< 0.5 m: thrDisp scaling would jerk)" % (
            where, travel))
    if not g.get("swap") and travel > 0.1:
        fail(fid, "%s: forward-throw victim travels %.2f m TOWARD the thrower" % (where, travel))
    # CHANGED(fix_core) D4 (CONTRACT 35.20): a grab super carries grab.path = its cinematic gapD (the sim carries that
    # victim: the view draws it at the sim's position); keys ascending inside the lock, gaps / lifts >= 0, ending on the floor
    cin = o.get("cinematic")
    p = g.get("path")
    if cin and cin.get("gapD") and p != [[int(k[0]), float(k[1]), float(k[2]) if len(k) > 2 else 0.0] + ([float(k[3])] if len(k) > 3 else [])
                                         for k in cin["gapD"]]:
        fail(fid, "%s grab.path: must equal cinematic.gapD (the sim carries a grab super's victim)" % mid)
    if p is not None:
        fr = [k[0] for k in p]
        if not p or fr != sorted(fr) or fr[0] < 1 or fr[-1] > g["frames"] or any(k[1] < 0 or k[2] < 0 for k in p):
            fail(fid, "%s grab.path %s: keys [frame 1..frames ascending, gapM >= 0, liftM >= 0]" % (mid, p))
        elif p[-1][2] != 0:
            fail(fid, "%s grab.path: the last key must be on the floor (lift 0), has %s" % (mid, p[-1]))
        elif cin and abs(p[-1][1] - cin.get("endGapM", p[-1][1])) > 1e-6:
            fail(fid, "%s grab.path: the last gap %.2f != cinematic.endGapM %.2f" % (mid, p[-1][1], cin.get("endGapM")))
        # CHANGED(wf6_fixer_core) V2: turn keys (4th number, deg): the thrower ends facing the way it grabbed (whole turns),
        # and no more than 15 deg per lock frame between keys (the view shows <= 12-15 deg / frame turns as they come)
        turns = [k[3] if len(k) > 3 else 0.0 for k in p]
        if any(len(k) not in (3, 4) for k in p):
            fail(fid, "%s grab.path: keys are [frame, gapM, liftM] or [frame, gapM, liftM, turnDeg]" % mid)
        elif abs(turns[-1] - 360.0 * round(turns[-1] / 360.0)) > 1e-6:
            fail(fid, "%s grab.path: the last turn %.1f deg is not a whole number of turns" % (mid, turns[-1]))
        else:
            pf, pt = 0, 0.0
            for k, tr in zip(p, turns):
                if k[0] > pf and abs(tr - pt) / (k[0] - pf) > 15.0 + 1e-6:
                    fail(fid, "%s grab.path: turn %.1f -> %.1f deg over lock %d..%d is > 15 deg / frame" % (mid, pt, tr, pf, k[0]))
                pf, pt = k[0], tr
    return travel


# ------------------------------------------------------------------ CHANGED(FIGHTERS3D): CONTRACT 35.4 / 35.12 checks
TRACK_LEAD = {"normal": 6, "command": 6, "throw": 4}   # until = max(1, startup - lead); other kinds 6 (CHANGED(STEPTUNE) 35.15: normal / command 4 -> 6)
HOMING_RATE, TRACK_FULL = 20, 180
LAT_RANGE, PROJ_LAT_RANGE = (0.10, 1.50), (0.10, 0.80)
STEP_ATTACK_REQUIRED = ("patch", "spin")
ROSTER_MD = os.path.join(GAME, "_spec", "ROSTER.md")


# CHANGED(fix_core) D1 (CONTRACT 35.20): the per-fighter sidestep length, re-derived here from data/bodies.json (the rule
# kitlib.step_dist_m states: arc needed A = 1.2 asin((0.22 + r) / (1.2 - off)), distM = clamp(1.555 A, 0.85, 2.0); r / off
# of the measured stand hurt cylinder). The windows it buys are measured and gated by _harness/probe_3d.ts (section 3b).
STEP_RULE = {"default": 0.85, "gap": 1.2, "lat": 0.22, "k": 1.555, "max": 2.0}
BODIES = os.path.join(GAME, "data", "bodies.json")


def check_step(fid, d):
    st = d.get("step")
    if not (isinstance(st, dict) and isinstance(st.get("distM"), (int, float))):
        fail(fid, "step.distM missing (CONTRACT 35.20: every fighter carries its sidestep length)")
        return
    dist = float(st["distM"])
    if not (STEP_RULE["default"] <= dist <= STEP_RULE["max"]):
        fail(fid, "step.distM %.3f outside %.2f..%.2f m" % (dist, STEP_RULE["default"], STEP_RULE["max"]))
    bodies = json.load(open(BODIES, encoding="utf-8")).get("fighters", {}) if os.path.exists(BODIES) else {}
    b = bodies.get(fid)
    if not b:
        want = STEP_RULE["default"]
    else:
        fr, bk = float(b["stand"][0]), float(b["stand"][1])
        r, off = (fr + bk) / 2.0, (fr - bk) / 2.0
        arc = STEP_RULE["gap"] * math.asin(min(1.0, (STEP_RULE["lat"] + r) / (STEP_RULE["gap"] - off)))
        want = round(min(STEP_RULE["max"], max(STEP_RULE["default"], STEP_RULE["k"] * arc)), 3)
    if abs(dist - want) > 0.0005:
        fail(fid, "step.distM %.3f != %.3f from the measured body (data/bodies.json)" % (dist, want))
    say("  step.distM %.3f (rule %.3f)" % (dist, want))


def is_strike3d(o):
    """SIM isStrikeKind (build.py is_strike): the moves whose boxes need a lateral depth."""
    if o["kind"] in ("throw", "cmdgrab") or o.get("grab") or o.get("projectile"):
        return False
    if o.get("cinematic"):
        return True
    return o.get("damage", 0) > 0 or any(h["damage"] > 0 for h in o.get("hits", []))


def check_3d(fid, d):
    moves = d["moves"]
    n_hom = n_lin = n_aim = 0
    reliable, antistep, stepatk = [], [], []
    for mid, o in moves.items():
        S, A = o["startup"], o["active"]
        last_act = S + A - 1
        t = o.get("track")
        if not (isinstance(t, dict) and isinstance(t.get("until"), int) and isinstance(t.get("rate"), int)):
            fail(fid, "%s: track {until, rate} missing or not integers (CONTRACT 35.12)" % mid)
            continue
        if not (1 <= t["until"] <= max(1, last_act)):
            fail(fid, "%s: track.until %d outside 1..%d (the last active frame)" % (mid, t["until"], last_act))
        if not (1 <= t["rate"] <= 180):
            fail(fid, "%s: track.rate %d outside 1..180 deg/frame" % (mid, t["rate"]))
        hom, lin = o.get("homing"), o.get("linear")
        for k, v in (("homing", hom), ("linear", lin)):
            if v is not None and v is not True:
                fail(fid, "%s: %s must be true or absent" % (mid, k))
        if hom and lin:
            fail(fid, "%s: homing and linear both set" % mid)
        strike = is_strike3d(o)
        if hom:
            n_hom += 1
            if t != {"until": last_act, "rate": HOMING_RATE}:
                fail(fid, "%s: homing needs track {until: %d (last active), rate: %d}, has %s" % (mid, last_act,
                                                                                              HOMING_RATE, t))
            if strike and o.get("lateralM", 0) < 0.40:
                fail(fid, "%s: homing strike %.2f m deep (< 0.40: it would miss the stepper it tracks)" % (
                    mid, o.get("lateralM", 0)))
        elif lin:
            n_lin += 1
            if t != {"until": 1, "rate": TRACK_FULL}:
                fail(fid, "%s: linear needs track {until: 1, rate: 180}, has %s" % (mid, t))
        else:
            want = max(1, S - TRACK_LEAD.get(o["kind"], 6))
            if t != {"until": want, "rate": TRACK_FULL}:
                fail(fid, "%s: class-default track should be {until: %d, rate: 180}, has %s" % (mid, want, t))
        if strike:
            lat = o.get("lateralM")
            if not isinstance(lat, (int, float)) or not (LAT_RANGE[0] <= lat <= LAT_RANGE[1]):
                fail(fid, "%s: strike lateralM %r outside %s m" % (mid, lat, LAT_RANGE))
        elif "lateralM" in o:
            fail(fid, "%s: lateralM on a non-strike (grabs use the front arc, projectiles projectile.lateralM)" % mid)
        pj = o.get("projectile")
        if pj:
            if not isinstance(pj.get("aimed"), bool):
                fail(fid, "%s: projectile.aimed must be a boolean" % mid)
            pl = pj.get("lateralM")
            if not isinstance(pl, (int, float)) or not (PROJ_LAT_RANGE[0] <= pl <= PROJ_LAT_RANGE[1]):
                fail(fid, "%s: projectile.lateralM %r outside %s m" % (mid, pl, PROJ_LAT_RANGE))
            if pj.get("aimed"):
                n_aim += 1
                if lin:
                    fail(fid, "%s: an aimed projectile on a linear move (aim = the special's default tracking)" % mid)
        inp = o.get("input", "")
        roles = set(o.get("role", []))
        if inp.startswith("SS."):
            if o["kind"] != "command" or inp[3:] not in ("L", "M", "H") or "stepatk" not in roles:
                fail(fid, "%s: step-attack needs kind command, input SS.L|SS.M|SS.H and role stepatk" % mid)
            stepatk.append(mid)
        elif "stepatk" in roles:
            fail(fid, "%s: role stepatk without an SS.<btn> input" % mid)
        blk = adv_of(o)[1]
        ground = not (inp.startswith("j.") or o.get("air"))
        normalish = o["kind"] in ("normal", "command", "special", "ex") and not o.get("tc")
        aimed_proj = bool(pj and pj.get("aimed"))
        if normalish and ground and S <= 16 and ((hom and strike and blk >= -6) or aimed_proj):
            reliable.append(mid)
        if "antistep" in roles:
            ok = S <= 12 and ((hom and (strike or o.get("grab"))) or aimed_proj)
            if not ok:
                fail(fid, "%s: role antistep needs a homing strike / command grab with startup <= 12, or an aimed "
                          "projectile (startup %d, homing %s)" % (mid, S, bool(hom)))
            antistep.append(mid)
    if not reliable:
        fail(fid, "no reliable homing tool (homing normal / command / special, startup <= 16, >= -6 on block, or an "
                  "aimed projectile special)")
    if not antistep:
        fail(fid, "no move with role antistep (the fighter's fast step-catcher)")
    if fid in STEP_ATTACK_REQUIRED and not stepatk:
        fail(fid, "no step-attack (SS.<btn>) - required for the rushdown / aerial kits")
    if len(set(moves[m]["input"] for m in stepatk)) != len(stepatk):
        fail(fid, "two step-attacks share one SS.<btn> input")
    for k in ("antiStep",):
        for x in d["cpu"].get(k, []) or []:
            if x not in moves:
                fail(fid, "cpu.%s -> %s missing" % (k, x))
    if d["cpu"].get("stepAttack") and d["cpu"]["stepAttack"] not in stepatk:
        fail(fid, "cpu.stepAttack %s is not a step-attack" % d["cpu"]["stepAttack"])
    ros = open(ROSTER_MD, encoding="utf-8").read() if os.path.exists(ROSTER_MD) else ""
    sec = ros.split("(`%s`)" % fid, 1)[1].split("\n## ", 1)[0] if ("(`%s`)" % fid) in ros else ""
    for tag in ("**3D ring play.**", "*Stepping game:*", "*Homing tools:*", "*Wall game:*"):
        if tag not in sec:
            fail(fid, "_spec/ROSTER.md section lacks %s" % tag)
    say("  3D: homing %d, linear %d, aimed projectiles %d | reliable homing tools %s | antistep %s | step-attacks %s" % (
        n_hom, n_lin, n_aim, reliable, antistep, stepatk or "-"))


def sentences(t):
    return len(re.findall(r"[.!?](\s|$)", t))


def check_text(fid, d):
    for k in ("introLine", "winQuotes", "banter", "ending"):
        if k not in d:
            fail(fid, "season text: %s missing (CONTRACT 26.3)" % k)
            return
    il = d["introLine"]
    if not isinstance(il, str) or not il or len(il) > 80:
        fail(fid, "introLine must be 1..80 chars (%d)" % len(il or ""))
    wq = d["winQuotes"]
    if not (isinstance(wq, list) and len(wq) == 3 and all(isinstance(x, str) and x for x in wq)):
        fail(fid, "winQuotes must be 3 non-empty strings")
    b = d["banter"]
    if fid == "freak":
        want = ["default"]
    elif fid == "ricky":
        want = PLAYABLE + ["default"]
    else:
        want = [d["rival"], "freak", "ricky", "default"]
    for k in want:
        v = b.get(k)
        if not (isinstance(v, list) and len(v) == 2 and all(isinstance(x, str) and x for x in v)):
            fail(fid, "banter[%s] must be 2 non-empty lines" % k)
    for k in b:
        if k not in want:
            fail(fid, "banter key %r unexpected (want %s)" % (k, want))
    ns = sentences(d["ending"])
    if not (3 <= ns <= 5):
        fail(fid, "ending has %d sentences (3-5)" % ns)
    blob = json.dumps([il, wq, b, d["ending"]])
    if not blob.isascii():
        fail(fid, "season text must be ASCII")
    say("  season text: intro %d chars, %d win quotes, banter keys %s, ending %d sentences" % (
        len(il), len(wq), sorted(b), ns))


def validate_fighter(fid, mix):
    say("== %s" % fid)
    d = json.load(open(os.path.join(FDIR, fid + ".json"), encoding="ascii"))
    plan = json.load(open(os.path.join(PDIR, fid + ".json"), encoding="ascii"))
    for k in TOP_REQ:
        if k not in d:
            fail(fid, "top-level field %s missing" % k)
    name, body, hp, stage, rival, ukind = ROSTER[fid]
    if (d.get("name"), d.get("body"), d.get("hp"), d.get("stage"), d.get("rival")) != (name, body, hp, stage, rival):
        fail(fid, "CONTRACT 5.4 mismatch: %r" % ((d.get("name"), d.get("body"), d.get("hp"), d.get("stage"),
                                                  d.get("rival")),))
    if d["unique"].get("kind") != ukind:
        fail(fid, "unique.kind %r != %r (CONTRACT 5.3)" % (d["unique"].get("kind"), ukind))
    for k in ("fwd", "back"):
        if k not in d["walk"]:
            fail(fid, "walk.%s missing" % k)
    for k in ("fwd", "back", "fwdFrames", "backFrames"):
        if k not in d["dash"]:
            fail(fid, "dash.%s missing" % k)
    for k in ("prejump", "air", "landing", "apexM", "fwdM"):
        if k not in d["jump"]:
            fail(fid, "jump.%s missing" % k)
    for k in ("stand", "crouch", "air"):
        if len(d["hurt"].get(k, [])) != 2:
            fail(fid, "hurt.%s not [w,h]" % k)
    if "style" not in d["cpu"]:
        fail(fid, "cpu.style missing")
    moves = d["moves"]
    clipset = set(plan) | set(SHARED)

    def need_clip(c, what):
        if c not in clipset:
            fail(fid, "%s clip %r not in tools/clipplan/%s.json nor the shared set" % (what, c, fid))

    normals = 0
    fams = {}
    fams2 = {}
    rows = []
    for mid, o in moves.items():
        for k in MOVE_REQ:
            if k not in o:
                fail(fid, "%s: field %s missing" % (mid, k))
        if o.get("kind") not in KINDS:
            fail(fid, "%s: kind %r" % (mid, o.get("kind")))
        if o.get("guard") not in GUARDS:
            fail(fid, "%s: guard %r" % (mid, o.get("guard")))
        if o["onHit"].get("kd") not in KDS:
            fail(fid, "%s: onHit.kd %r" % (mid, o["onHit"].get("kd")))
        for k in ("hit", "block"):
            if k not in o["pushback"]:
                fail(fid, "%s: pushback.%s missing" % (mid, k))
        for k in ("js", "ji", "jl"):
            if k not in o["juggle"]:
                fail(fid, "%s: juggle.%s missing" % (mid, k))
        for k in ("showtime", "nerveCost"):
            if k not in o["gain"]:
                fail(fid, "%s: gain.%s missing" % (mid, k))
        for k in ("showtime", "nerve"):
            if k not in o["cost"]:
                fail(fid, "%s: cost.%s missing" % (mid, k))
        if o["startup"] < 1 or o["active"] < 1 or o["recovery"] < 0:
            fail(fid, "%s: bad S/A/R %d/%d/%d" % (mid, o["startup"], o["active"], o["recovery"]))
        total = o["startup"] + o["active"] + o["recovery"] - 1
        need_clip(o["anim"]["clip"], mid)
        if "warp" in o["anim"]:
            w = o["anim"]["warp"]
            if w[-1][0] != total + 1:
                fail(fid, "%s: warp ends at frame %s, expected S+A+R = %d (SIM derive convention)" % (
                    mid, w[-1][0], total + 1))
            if any(w[i + 1][0] <= w[i][0] or w[i + 1][1] < w[i][1] for i in range(len(w) - 1)):
                fail(fid, "%s: warp not increasing" % mid)
        for k, v in o["invuln"].items():
            if k not in ("strike", "throw", "air", "proj") or not (1 <= v[0] <= v[1] <= total):
                fail(fid, "%s: invuln %s %s outside 1..%d" % (mid, k, v, total))
        if o["armor"]["hits"] and not (1 <= o["armor"]["f"][0] <= o["armor"]["f"][1] <= total):
            fail(fid, "%s: armor frames %s" % (mid, o["armor"]["f"]))
        if o.get("hits"):
            if sum(h["damage"] for h in o["hits"]) != o["damage"]:
                fail(fid, "%s: hits sum %d != damage %d" % (mid, sum(h["damage"] for h in o["hits"]), o["damage"]))
            if o["hits"][0]["f"][0] != o["startup"]:
                fail(fid, "%s: first hit f%d != startup %d" % (mid, o["hits"][0]["f"][0], o["startup"]))
            for h in o["hits"]:
                if not (o["startup"] <= h["f"][0] <= h["f"][1] <= o["startup"] + o["active"] - 1):
                    fail(fid, "%s: hit window %s outside the active frames" % (mid, h["f"]))
        if o.get("hurtOverride"):
            for h in o["hurtOverride"]:
                if not (1 <= h["f"][0] <= h["f"][1] <= total + 20):
                    fail(fid, "%s: hurtOverride frames %s" % (mid, h["f"]))
        if o["kind"] in ("throw", "cmdgrab") or o.get("grab"):
            g = o.get("grab")
            if not g:
                fail(fid, "%s: kind %s without grab block" % (mid, o["kind"]))
            else:
                for k in ("frames", "adv", "hitF", "swap", "air", "techable", "clip"):
                    if k not in g:
                        fail(fid, "%s: grab.%s missing" % (mid, k))
                if g.get("hitF", 0) >= g.get("frames", 0):
                    fail(fid, "%s: grab.hitF >= frames" % mid)
                need_clip(g.get("clip"), mid + " grab")
                if g.get("clip") in plan and "slam" not in (plan[g["clip"]].get("marks") or {}):
                    fail(fid, "%s: grab clip %s has no marks.slam (CONTRACT 6.2 THROW PAIR SYNC)" % (mid, g["clip"]))
                if o["kind"] == "cmdgrab" and "rangeM" not in g:
                    fail(fid, "%s: cmdgrab without grab.rangeM" % mid)
                tr = check_grab_victim(fid, mid, o, g)
                if tr is not None:
                    say("  %-16s grab lock %3d hitF %3d swap %-5s victim %d segs, root travel %+.2f m" % (
                        mid, g["frames"], g["hitF"], g.get("swap"), len(g.get("victim") or []), tr))
        if o.get("projectile"):
            p = o["projectile"]
            for k in ("speed", "life", "box", "y", "hits", "strength", "clip"):
                if k not in p:
                    fail(fid, "%s: projectile.%s missing" % (mid, k))
        if o.get("cinematic"):
            c = o["cinematic"]
            for k in ("frames", "cue", "hits", "anim", "victim", "shots", "endAdv", "endGapM"):
                if k not in c:
                    fail(fid, "%s: cinematic.%s missing" % (mid, k))
            if c["frames"] > 180:
                fail(fid, "%s: cinematic %d frames > 180" % (mid, c["frames"]))
            if sum(x[1] for x in c["hits"]) != o["damage"]:
                fail(fid, "%s: cinematic hits sum %d != damage %d" % (mid, sum(x[1] for x in c["hits"]), o["damage"]))
            if any(not (0 <= x[0] < c["frames"]) for x in c["hits"] + c["anim"] + c["victim"] + c["shots"]):
                fail(fid, "%s: cinematic timeline frame outside 0..%d" % (mid, c["frames"] - 1))
            for e in c["anim"]:
                need_clip(e[1], mid + " cinematic")
            for e in c["victim"]:
                if e[1] not in SHARED:
                    fail(fid, "%s: victim clip %r not a shared system clip" % (mid, e[1]))
            check_cinematic_v2(fid, mid, o, c, plan)
        if o["kind"] == "super3" and not o.get("cinematic"):
            fail(fid, "%s: Lv3 without a cinematic block" % mid)
        for tok in o["cancel"]:
            if tok.startswith("chain:") and tok[6:] not in moves:
                fail(fid, "%s: chain target %s missing" % (mid, tok[6:]))
            elif not tok.startswith("chain:") and tok not in ("special", "super", "whiff", "jump"):
                fail(fid, "%s: cancel token %r" % (mid, tok))
        for f_, nm in o.get("sfx", []):
            if SFX is not None and nm not in SFX:
                fail(fid, "%s: sfx %r not in AUDIO SFX_CUE_ALIASES" % (mid, nm))
            if not (0 <= f_ <= total):
                fail(fid, "%s: sfx frame %d outside the move" % (mid, f_))
        if o.get("counter") and o["counter"].get("follow") not in moves:
            fail(fid, "%s: counter.follow missing" % mid)
        # ---- arithmetic
        oh, ob = adv_of(o)
        ground = not (o["input"].startswith("j.") or o.get("air"))
        if o["kind"] in ("normal", "command"):
            normals += 1
            if ground and ob <= -5 and not ({"sweep", "antiair"} & set(o["role"])):
                fail(fid, "%s: normal %+d on block (<= -5) without role sweep/antiair" % (mid, ob))
        if o["onHit"]["kd"] != "none" and o["onHit"]["launch"][1] <= 0 and not o.get("grab") \
                and not o.get("cinematic") and o["hitstun"] <= 0 and ground:
            fail(fid, "%s: KD move without total-downtime hitstun (CONTRACT 19.3)" % mid)
        m = re.match(r"^(.*)_(l|m|h|ex)$", mid)
        if m and o["kind"] in ("special", "ex", "cmdgrab", "projectile"):
            (fams2 if o.get("phase") == 2 else fams).setdefault(m.group(1), set()).add(m.group(2))
        if o.get("grab"):
            res = "grab KD +%d" % o["grab"]["adv"]
        elif o.get("cinematic"):
            res = "cine KD +%d" % o["cinematic"]["endAdv"]
        elif not ground:
            res = "air"
        elif o["damage"] == 0:
            res = "no hitbox"
        elif o["onHit"]["kd"] != "none":
            res = ("KD launch" if o["onHit"]["launch"][1] > 0 else "KD %+d" % oh)
        else:
            res = "%+d" % oh
        rows.append("  %-16s %-9s S%-3d A%-3d R%-3d tot%-4d hit %-9s blk %+4d dmg %5d %s" % (
            mid, o["kind"], o["startup"], o["active"], o["recovery"], total, res, ob, o["damage"], o["guard"]))
    for r in rows:
        say(r)
    # ---- counts
    if not (9 <= normals <= 12):
        fail(fid, "%d normals (need 9-12)" % normals)
    if not (3 <= len(fams) <= 4):
        fail(fid, "%d special families %s (need 3-4; follow-up parts are not families)" % (len(fams), sorted(fams)))
    for f, ss in list(fams.items()) + list(fams2.items()):
        if ss != {"l", "m", "h", "ex"}:
            fail(fid, "special %s has %s (need l/m/h/ex)" % (f, sorted(ss)))
    kinds = [o["kind"] for o in moves.values()]
    if "super1" not in kinds or "super3" not in kinds:
        fail(fid, "missing Lv1 or Lv3")
    if "throw_f" not in moves or "throw_b" not in moves:
        fail(fid, "missing throw_f / throw_b")
    elif (moves["throw_f"]["input"], moves["throw_b"]["input"]) != ("LM", "4LM"):
        fail(fid, "throw inputs must be LM / 4LM (CONTRACT 19.1)")
    # ---- routing
    s = d["simple"]
    for k, v in s.items():
        if k not in SIMPLE_KEYS:
            fail(fid, "simple key %r" % k)
        ids = v if isinstance(v, list) else [v]
        for x in ids:
            if x not in moves:
                fail(fid, "simple %s -> %r missing" % (k, x))
    for k in ("5S", "6S", "2S", "4S", "S+H", "S+H+2", "assist"):
        if k not in s:
            fail(fid, "simple.%s missing" % k)
    if s.get("jS") and not moves.get(s["jS"], {}).get("air"):
        fail(fid, "simple.jS -> %s is not air:true" % s.get("jS"))
    for k in ("5S", "6S", "2S", "4S"):
        v = s.get(k, "")
        ex = s.get("A" + k) or re.sub(r"_(l|m|h)$", "_ex", v)
        if ex not in moves:
            fail(fid, "SIMPLE EX for %s (%s) missing" % (k, ex))
    if s.get("S+H") and moves.get(s["S+H"], {}).get("kind") != "super1":
        fail(fid, "S+H is not a super1")
    if s.get("S+H+2") and moves.get(s["S+H+2"], {}).get("kind") != "super3":
        fail(fid, "S+H+2 is not a super3")
    for c in d["classic"]:
        if c["motion"] not in MOTIONS:
            fail(fid, "classic motion %r not in CONTRACT 19.2" % c["motion"])
        for b in c["btn"]:
            mid = c["move"].replace("{s}", b.lower())
            if mid not in moves:
                fail(fid, "classic %s+%s -> %s missing" % (c["motion"], b, mid))
        if "{s}" in c["move"] and c["move"].replace("{s}", "ex") not in moves:
            fail(fid, "classic %s has no EX id" % c["move"])
    tcs = [mid for mid, o in moves.items() if o.get("tc")]
    chained = set()
    for o in moves.values():
        for tok in o["cancel"]:
            if tok.startswith("chain:"):
                chained.add(tok[6:])
        if o.get("counter"):
            chained.add(o["counter"]["follow"])
    uq = d["unique"]
    for v in (uq.get("followups") or {}).values():
        chained.add(v)
    for v in (uq.get("exit") or {}).values():
        chained.add(v)
    for t in tcs:
        if t not in chained:
            fail(fid, "tc move %s is not reachable from any chain/counter/stance" % t)
        if not moves[t].get("trigger") and ">" not in moves[t]["input"] and t not in (
                set((uq.get("followups") or {}).values()) | set((uq.get("exit") or {}).values())):
            fail(fid, "tc move %s has neither trigger nor a 'A>B' input" % t)
    # ---- unique references
    for key in ("enter", "steps", "armored", "moves"):
        for x in uq.get(key, []) or []:
            if x not in moves:
                fail(fid, "unique.%s -> %s missing" % (key, x))
    for k, v in (uq.get("clips") or {}).items():
        need_clip(v, "unique stance " + k)
    # ---- intro / win / taunt + plan sources
    need_clip(d["intro"], "intro")
    need_clip(d["taunt"], "taunt")
    for w in d["win"]:
        need_clip(w, "win")
    for cid, e in plan.items():
        check_plan_entry(fid, cid, e, mix)
    used = set()
    for o in moves.values():
        used.add(o["anim"]["clip"])
        if o.get("grab"):
            used.add(o["grab"]["clip"])
        if o.get("cinematic"):
            used |= {e[1] for e in o["cinematic"]["anim"]}
    used |= {d["intro"], d["taunt"], *d["win"]} | set((uq.get("clips") or {}).values())
    unused = [c for c in plan if c not in used and c not in SHARED]
    if unused:
        say("  note: plan clips not referenced by moves: %s" % unused)
    overrides = [c for c in plan if c in SHARED]
    say("  normals %d, special families %s%s, clips %d (shared overrides %s)" % (
        normals, sorted(fams), (" + phase-2 %s" % sorted(fams2)) if fams2 else "", len(plan), overrides))
    check_hit_volume(fid, d, plan)
    check_text(fid, d)
    check_3d(fid, d)   # CHANGED(FIGHTERS3D)
    check_step(fid, d)   # CHANGED(fix_core) D1


def main():
    inv = json.load(open(MIX_INV, encoding="utf-8"))
    mix = {}
    for pk, p in inv["packs"].items():
        for c in p["clips"]:
            mix["%s/%s.fbx" % (pk, c["clip"])] = c["frames"]
    global SFX
    SFX = sfx_names()
    say("AUDIO SFX_CUE_ALIASES: %s" % ("%d names" % len(SFX) if SFX is not None else "router.ts absent - sfx names unchecked"))
    m, rows = template_check()
    say("fg_template_check rows (research templates, arithmetic by the research script's adv()):")
    ok = True
    for (n, s, a, r, oh, ob) in rows:
        say("  %-28s %d/%d/%d hit %s block %+d" % (n, s, a, r, "KD" if oh is None else "%+d" % oh, ob))
        if ob <= -m.FASTEST and "sweep" not in n and "anti-air" not in n:
            ok = False
    if not ok:
        FAILS.append("template rows punishable")
    fids = [f[:-5] for f in sorted(os.listdir(FDIR)) if f.endswith(".json")]
    global ROSTER_DEF_MIN
    dm = []
    for fid in fids:
        fd = json.load(open(os.path.join(FDIR, fid + ".json"), encoding="utf-8"))
        pu = fd.get("push")
        if isinstance(pu, dict) and isinstance(pu.get("front"), (int, float)):
            dm.append(pu["front"] + fd["hurt"]["stand"][0] / 2.0)
            if not (pu["front"] > 0 and pu.get("back", -1) >= 0 and abs(pu["front"] + pu["back"] - fd["pushbox"][0]) <= 0.011):
                FAILS.append("%s: push %s inconsistent with pushbox %s (front + back = width)" % (fid, pu, fd["pushbox"]))
    ROSTER_DEF_MIN = round(min(dm), 3) if dm and len(dm) == len(fids) else None
    say("point blank: ROSTER_DEF_MIN (min push front + hurt half) = %s" % ROSTER_DEF_MIN)
    for fid in fids:
        if fid not in ROSTER:
            FAILS.append("unknown fighter file %s" % fid)
            continue
        validate_fighter(fid, mix)
    missing = [f for f in ROSTER if f not in fids]
    say("")
    say("fighters validated: %d/%d%s" % (len(fids), len(ROSTER), (" (missing %s)" % missing) if missing else ""))
    if missing:
        FAILS.append("missing fighter files: %s" % missing)
    say("PENDING lane ASSETS re-bake (not failures; re-run build.py + this validator after the bake): %d" % len(PENDING))
    for p in PENDING:
        say("  - " + p)
    say("RESULT: %s (%d failure(s))" % ("PASS" if not FAILS else "FAIL", len(FAILS)))
    for f in FAILS:
        say("  - " + f)
    os.makedirs(os.path.dirname(REPORT), exist_ok=True)
    with open(REPORT, "w", encoding="ascii", errors="replace", newline="\n") as fh:
        fh.write("\n".join(OUT) + "\n")
    sys.exit(0 if not FAILS else 1)


if __name__ == "__main__":
    main()
