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
Writes _harness/_reports/fighters_validate.txt. Exit 0 = PASS, 1 = FAIL.
Usage: python data/fighters/_gen/validate.py
"""
import importlib.util
import json
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
            for _, cl in c["anim"]:
                need_clip(cl, mid + " cinematic")
            for _, cl in c["victim"]:
                if cl not in SHARED:
                    fail(fid, "%s: victim clip %r not a shared system clip" % (mid, cl))
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
            used |= {c for _, c in o["cinematic"]["anim"]}
    used |= {d["intro"], d["taunt"], *d["win"]} | set((uq.get("clips") or {}).values())
    unused = [c for c in plan if c not in used and c not in SHARED]
    if unused:
        say("  note: plan clips not referenced by moves: %s" % unused)
    overrides = [c for c in plan if c in SHARED]
    say("  normals %d, special families %s%s, clips %d (shared overrides %s)" % (
        normals, sorted(fams), (" + phase-2 %s" % sorted(fams2)) if fams2 else "", len(plan), overrides))
    check_hit_volume(fid, d, plan)


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
