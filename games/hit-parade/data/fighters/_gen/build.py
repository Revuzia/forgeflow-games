"""Build every kit: data/fighters/<id>.json, tools/clipplan/<id>.json, _spec/ROSTER.md.

Usage (from anywhere):  python data/fighters/_gen/build.py
Fails (exit 1) when a template deviation has no reason, a clip is missing, or a source range is outside
the measured source length (mixamo_inventory.json frames / CMU BVH 'Frames:' header).
ASCII only, LF line endings.
"""
import importlib
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # keep data/ free of __pycache__

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "kits"))
import kitlib as L  # noqa: E402

IDS = ["johnny", "patch", "bruno", "zambini", "krane", "lotus", "boneyard", "spin", "gazza", "rerun", "freak",
       "ricky"]
OUT_FIGHTERS = os.path.join(L.GAME, "data", "fighters")
OUT_CLIPPLAN = os.path.join(L.GAME, "tools", "clipplan")
OUT_ROSTER = os.path.join(L.GAME, "_spec", "ROSTER.md")
CHECK_FIELDS = ("startup", "active", "recovery", "hitstun", "blockstun", "damage", "hitstop", "guard")
ERRORS = []


def err(msg):
    ERRORS.append(msg)
    print("ERROR", msg)


# ------------------------------------------------------------------------------------ JSON formatting
def _inline(o):
    return json.dumps(o, ensure_ascii=True, separators=(", ", ": "))


def fmt(o, ind=0, depth=0):
    pad = "  " * ind
    if isinstance(o, dict):
        if not o:
            return "{}"
        s = _inline(o)
        if depth >= 2 and len(s) <= 110:
            return s
        items = []
        for k, v in o.items():
            items.append("%s  %s: %s" % (pad, json.dumps(k), fmt(v, ind + 1, depth + 1)))
        return "{\n" + ",\n".join(items) + "\n" + pad + "}"
    if isinstance(o, list):
        s = _inline(o)
        if len(s) <= 110 or all(not isinstance(x, (dict, list)) for x in o):
            return s
        items = ["%s  %s" % (pad, fmt(v, ind + 1, depth + 1)) for v in o]
        return "[\n" + ",\n".join(items) + "\n" + pad + "]"
    return json.dumps(o, ensure_ascii=True)


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="ascii", newline="\n") as fh:
        fh.write(text)


# ------------------------------------------------------------------------------------ source checks
_BVH = {}


def bvh_frames(take):
    if take not in _BVH:
        p = "%s/%03d/%s.bvh" % (L.CMU_ROOT, int(take.split("_")[0]), take)
        n = None
        try:
            with open(p, encoding="ascii", errors="replace") as fh:
                for line in fh:
                    if line.startswith("Frames:"):
                        n = int(line.split()[1])
                        break
        except OSError as e:
            err("CMU take %s unreadable: %r" % (take, e))
        _BVH[take] = n
    return _BVH[take]


def check_entry(fid, cid, e, where=""):
    src = e.get("src")
    tag = "%s clip %s%s" % (fid, cid, where)
    if src == "mixamo":
        cat = L.mixamo_catalog().get(e["file"])
        if not cat:
            err("%s: mixamo file not in inventory: %s" % (tag, e["file"]))
            return
        f0, f1 = e["range"]
        if not (1 <= f0 < f1 <= cat["frames"]):
            err("%s: range %s outside 1..%d (%s)" % (tag, e["range"], cat["frames"], e["file"]))
        c = e.get("contact")
        if c is not None and not (f0 <= c <= f1):
            err("%s: contact %s outside range %s" % (tag, c, e["range"]))
    elif src == "cmu":
        n = bvh_frames(e["file"])
        f0, f1 = e["range"]
        if n is None or not (1 <= f0 < f1 <= n - 1):
            err("%s: CMU range %s outside 1..%s (take %s)" % (tag, e["range"], n, e["file"]))
        c = e.get("contact")
        if c is not None and not (f0 <= c <= f1):
            err("%s: CMU contact %s outside range %s" % (tag, c, e["range"]))
        if e.get("kind") not in ("hand", "foot", "knee", "getup", "fall", "body"):
            err("%s: CMU kind %r" % (tag, e.get("kind")))
    elif src == "layer":
        check_entry(fid, cid, e["layer"]["lower"], where + " (lower)")
        check_entry(fid, cid, e["layer"]["upper"], where + " (upper)")
        if e["layer"]["lowerMode"] == "hold" and "lowerFrame" not in e["layer"]:
            err("%s: hold layer needs lowerFrame" % tag)
    elif src == "seq":
        for i, s in enumerate(e["seq"]):
            check_entry(fid, cid, s, where + " (seq %d)" % i)
    elif src == "authored":
        check_entry(fid, cid, e["base"], where + " (base)")
        if not e.get("keys"):
            err("%s: authored clip without keys" % tag)
    else:
        err("%s: unknown src %r" % (tag, src))


def entry_seconds(e):
    """(duration s, contact s) of a plan entry; None when unknown."""
    src = e["src"]
    if src in ("mixamo", "cmu"):
        fps = 30.0 if src == "mixamo" else 120.0
        f0, f1 = e["range"]
        c = e.get("contact")
        return (f1 - f0) / fps, (None if c is None else (c - f0) / fps)
    if src == "layer":
        return entry_seconds(e["layer"]["upper"])
    if src == "seq":
        t = 0.0
        c0 = None
        for i, s in enumerate(e["seq"]):
            d, c = entry_seconds(s)
            if i > 0:
                t -= e.get("xf", 0) / 30.0
            if c0 is None and c is not None:
                c0 = t + c
            t += d
        return t, c0
    if src == "authored":
        return (e["frames"] - 1) / 30.0, (e["contact"] - 1) / 30.0
    return None, None


# ------------------------------------------------------------------------------------ kit checks
def template_of(m):
    t = m.get("_tpl")
    if not t:
        return None
    if t in L.TPL:
        return L.TPL[t]
    fam, s = t.rsplit("_", 1)
    d = dict(L.SPECIAL[fam]["all"])
    d.update(L.SPECIAL[fam][s])
    return d


def deviations(m):
    t = template_of(m)
    if not t:
        return []
    out = []
    for k in CHECK_FIELDS:
        if k in t and k in m and m[k] != t[k]:
            out.append("%s %s->%s" % (k, t[k], m[k]))
    return out


def check_kit(K):
    fid = K.info["id"]
    for mid in K.order:
        m = K.moves[mid]
        dv = deviations(m)
        if dv and not m.get("why"):
            err("%s %s deviates from template %s (%s) without a reason" % (fid, mid, m.get("_tpl"), ", ".join(dv)))
        if not m.get("_tpl") and not (m.get("why") or m.get("desc")):
            err("%s %s has no template and no design note" % (fid, mid))
        if m.get("clip") not in K.clips and m.get("clip") not in L.SHARED:
            err("%s %s: anim clip %r not in the clip plan" % (fid, mid, m.get("clip")))
        g = m.get("grab")
        if g and g.get("clip") and g["clip"] not in K.clips:
            err("%s %s: grab clip %r not in the clip plan" % (fid, mid, g["clip"]))
        c = m.get("cinematic")
        if c:
            for _, cl in c.get("anim", []):
                if cl not in K.clips:
                    err("%s %s: cinematic clip %r not in the clip plan" % (fid, mid, cl))
    for cid, e in K.clips.items():
        check_entry(fid, cid, e)
    for k in ("intro", "taunt"):
        if K.info[k] not in K.clips:
            err("%s %s clip %r missing" % (fid, k, K.info[k]))
    for w in K.info["win"]:
        if w not in K.clips:
            err("%s win clip %r missing" % (fid, w))


# ------------------------------------------------------------------------------------ ROSTER.md
def md_escape(s):
    return str(s).replace("|", "/")


def src_text(e, top=True):
    s = e["src"]
    if s == "mixamo":
        t = "Mixamo `%s` f%d-%d" % (e["file"][:-4], e["range"][0], e["range"][1])
        if e.get("contact") is not None:
            t += " contact f%d" % e["contact"]
    elif s == "cmu":
        t = "CMU %s%s f%d-%d" % (e["file"], " (%s)" % e["_cand"] if e.get("_cand") else "", e["range"][0],
                                  e["range"][1])
        if e.get("contact") is not None:
            t += " contact %d" % e["contact"]
        if e.get("mirror"):
            t += " MIRROR"
    elif s == "layer":
        ly = e["layer"]
        t = "LAYER lower[%s, %s%s] + upper[%s]" % (src_text(ly["lower"], False), ly["lowerMode"],
                                                   " f%d" % ly["lowerFrame"] if "lowerFrame" in ly else "",
                                                   src_text(ly["upper"], False))
    elif s == "seq":
        t = "SEQ " + " + ".join("[%s]" % src_text(x, False) for x in e["seq"])
    elif s == "authored":
        t = "AUTHORED `%s` (%d f @30, contact f%d) over [%s]" % (e.get("_authored", "?"), e["frames"],
                                                                e["contact"], src_text(e["base"], False))
    else:
        t = s
    return t


def fighter_md(K):
    i = K.info
    d = i["doc"]
    J = K.to_json()
    fid = i["id"]
    lines = []
    A = lines.append
    A("## %s - %s (`%s`)" % (i["name"], i["persona"], fid))
    A("")
    A("*Archetype:* %s. *Body:* `%s` at %.2f m. *Home stage:* `%s`. *Rival:* `%s`. *Difficulty:* %d/3." % (
        i["archetype"], i["body"], i["heightM"], i["stage"], i["rival"], d["difficulty"]))
    A("")
    A("**Bio.** %s" % d["bio"])
    A("")
    A("**Look.** %s" % d["look"])
    A("")
    A("**Game plan.** %s" % d["plan"])
    A("")
    A("**Weakness (the counter-play).** %s" % d["weakness"])
    A("")
    if d.get("rivalry"):
        A("**Rivalry.** %s" % d["rivalry"])
        A("")
    h = J["hurt"]
    A("**Stats.** HP %d | walk %.2f / %.2f m/s | dash %.2f m (%df) / %.2f m (%df) | jump %d+%d+%d, apex %.2f m, "
      "forward %.2f m | throw range %.2f m | hurtbox stand %s, crouch %s, air %s m | pushbox %s m | build `%s`." % (
          i["hp"], i["walk"][0], i["walk"][1], i["dash"][0], i["dash"][2], i["dash"][1], i["dash"][3],
          i["jump"][0], i["jump"][1], i["jump"][2], i["jump"][3], i["jump"][4], i["throwRangeM"], h["stand"],
          h["crouch"], h["air"], J["pushbox"], i["build"]))
    A("")
    A("**Unique (`unique.kind` = `%s`).** `%s`" % (K.unique["kind"], json.dumps(K.unique)))
    A("")
    # controls
    A("**Controls.**")
    A("")
    A("| SIMPLE | move | CLASSIC |")
    A("|---|---|---|")
    cl = {}
    for c in K.classic:
        mv = c["move"]
        key = mv.replace("_{s}", "")
        cl.setdefault(key, []).append("%s+%s" % (c["motion"], c["btn"]))
    for k in ("5S", "6S", "2S", "4S", "jS", "S+H", "S+H+2"):
        if k in K.simple:
            mv = K.simple[k]
            base = re.sub(r"_(l|m|h|ex)$", "", mv)
            cls = ", ".join(cl.get(base, [])) or ("236236+any" if k == "S+H" else "214214+any" if k == "S+H+2"
                                                   else "-")
            A("| %s | `%s` %s | %s |" % (k, mv, md_escape(K.moves[mv]["name"]), cls))
    A("")
    A("EX = ASSIST+S+direction (SIMPLE) or motion+S (CLASSIC), 2 NERVE bars. SIMPLE one-button specials and "
      "supers deal x0.8. Assist route (hold ASSIST, tap L): `%s`." % " > ".join(K.simple.get("assist", [])))
    for c in K.classic:
        if c.get("note"):
            A("- %s" % c["note"])
    A("")
    # move table
    A("**Frame data** (60 fps; startup counts the first active frame; advantage = stun - (active + recovery), "
      "from the last hit for multi-hit moves; KD = knockdown advantage; `tpl` = FIGHTING_DESIGN template row).")
    A("")
    A("| id | name | input | S | A | R | total | on hit | on block | dmg | guard | stop | cancel | inv/armor | tpl "
      "| deviation / design note |")
    A("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for mid in K.order:
        m = K.moves[mid]
        o = J["moves"][mid]
        oh, ob = L.adv(o)
        tot = o["startup"] + o["active"] + o["recovery"] - 1
        inv = []
        for k, v in o["invuln"].items():
            inv.append("%s %d-%d" % (k, v[0], v[1]))
        if o["armor"]["hits"]:
            inv.append("armor %dx %d-%d" % (o["armor"]["hits"], o["armor"]["f"][0], o["armor"]["f"][1]))
        if o.get("hurtOverride"):
            inv.append("low-prof %d-%d" % tuple(o["hurtOverride"][0]["f"]))
        if o.get("counter"):
            inv.append("catch %d-%d" % tuple(o["counter"]["catch"]))
        note = m.get("why", "")
        dv = deviations(m)
        if dv:
            note = "(%s) %s" % ("; ".join(dv), note)
        if o.get("hits"):
            note = ("hits: %s. " % ", ".join("f%d %d" % (x["f"][0], x["damage"]) for x in o["hits"])) + note
        if o.get("grab"):
            g = o["grab"]
            note = ("grab: range %s m, lock %d f, dmg at f%d, %s. " % (
                g.get("rangeM", J["throwRangeM"]), g["frames"], g["hitF"],
                "swap sides" if g["swap"] else "same side")) + note
        A("| `%s` | %s | %s | %d | %d | %d | %d | %s | %s | %d | %s | %d | %s | %s | %s | %s |" % (
            mid, md_escape(o["name"]), md_escape(o["input"]), o["startup"], o["active"], o["recovery"], tot, oh,
            ob, o["damage"], o["guard"], o["hitstop"], md_escape(" ".join(o["cancel"])) or "-",
            md_escape(", ".join(inv)) or "-", m.get("_tpl", "custom"), md_escape(note)))
    A("")
    # descriptions
    A("**Move notes.**")
    A("")
    for mid in K.order:
        o = J["moves"][mid]
        extra = []
        if o.get("projectile"):
            p = o["projectile"]
            extra.append("projectile %.1f m/s, %d hit(s), y %.2f m%s" % (p["speed"], p.get("hits", 1), p.get("y", 1.2),
                                                                       ", arc" if p.get("g") else ""))
        if o.get("teleport"):
            extra.append("teleport %s" % json.dumps(o["teleport"]))
        if o.get("counter"):
            extra.append("counter %s" % json.dumps(o["counter"]))
        if o.get("stance"):
            extra.append("stance %s" % o["stance"])
        if o.get("ball"):
            extra.append("ball %s" % o["ball"]["act"])
        if o.get("phase"):
            extra.append("phase %d only" % o["phase"])
        A("- `%s` %s: %s%s" % (mid, o["name"], o["desc"], (" (" + "; ".join(extra) + ")") if extra else ""))
    A("")
    # cinematic
    lv3 = [mid for mid in K.order if J["moves"][mid]["kind"] == "super3"]
    for mid in lv3:
        c = J["moves"][mid]["cinematic"]
        A("**Lv3 PRIME TIME cinematic `%s` (%s)** - %d frames (<= 180), cue `%s`, damage %s = %d, ends KD +%d at "
          "%.1f m." % (mid, J["moves"][mid]["name"], c["frames"], c["cue"], "+".join(str(x[1]) for x in c["hits"]),
                      sum(x[1] for x in c["hits"]), c["endAdv"], c["endGapM"]))
        A("")
        for line in getattr(K, "cine_doc", []):
            A("- %s" % line)
        A("- attacker clips: %s" % ", ".join("f%d `%s`" % (f, cl) for f, cl in c["anim"]))
        A("- victim clips: %s" % ", ".join("f%d `%s`" % (f, cl) for f, cl in c["victim"]))
        A("- camera shots: %s" % ", ".join("f%d %s" % (f, s) for f, s in c["shots"]))
        A("")
    # animation sources
    A("**Animation sources** (`tools/clipplan/%s.json`; every `anim.clip`, grab clip, cinematic clip, intro, "
      "win and taunt; ranges shown after the automatic fit)." % fid)
    A("")
    A("| clip | used by | source | why |")
    A("|---|---|---|---|")
    users = {}
    for mid in K.order:
        m = K.moves[mid]
        users.setdefault(m["clip"], []).append(mid)
        if m.get("grab") and m["grab"].get("clip"):
            users.setdefault(m["grab"]["clip"], []).append(mid + " (grab)")
        if m.get("cinematic"):
            for _, cl in m["cinematic"]["anim"]:
                users.setdefault(cl, []).append(mid + " (cine)")
    for k in ("intro", "taunt"):
        users.setdefault(K.info[k], []).append(k)
    for w in K.info["win"]:
        users.setdefault(w, []).append("win")
    if K.unique.get("clips"):
        for k, v in K.unique["clips"].items():
            users.setdefault(v, []).append("stance " + k)
    for cid, e in K.clips.items():
        A("| `%s` | %s | %s | %s |" % (cid, md_escape(", ".join(dict.fromkeys(users.get(cid, ["shared override"])))),
                                        md_escape(src_text(e)), md_escape(K.clip_notes.get(cid, e.get("_why", "")))))
    A("")
    A("**CPU.** `%s`. **Intro** `%s`, **win** %s, **taunt** `%s`." % (
        json.dumps(i["cpu"]), i["intro"], ", ".join("`%s`" % w for w in i["win"]), i["taunt"]))
    A("")
    return lines


HEADER = """# HIT PARADE - ROSTER (lane FIGHTERS)

GENERATED by `data/fighters/_gen/build.py` from the kit sources in `data/fighters/_gen/kits/*.py`
(the single source of truth for `data/fighters/<id>.json`, `tools/clipplan/<id>.json` and this file).
Edit the kit source and rebuild; never hand-edit the outputs. Validator: `python data/fighters/_gen/validate.py`.

## Conventions

- **Frame data** (FIGHTING_DESIGN 1b/1c, SF6): 60 fps; startup counts the first active frame; advantage =
  stun - (active + recovery). Knockdown moves without an upward launch carry `hitstun` = total frames until the
  defender acts again (CONTRACT 19.3), so "KD +33" is the same arithmetic. Grabs use `grab.adv`.
  Every move starts from a template row (`tpl` column) and every deviation is listed with its reason; the
  build fails on an unexplained deviation.
- **Templates** (FIGHTING_DESIGN 1b normals, 1c specials): L 5/3/9 +3/-2 300; 2L low 250; M 8/3/16 +3/-3 600;
  2M low 8/3/15 +4/-2; H 12/3/20 +2/-3 800; AA 9/4/21 +2/-6 800; SWEEP 10/3/24 KD+33 -11 900; OH 18/3/17
  +2/-4 600; CMD 16/3/20 +2/-3 800; j.L 5/7/3; j.M 7/6/3; j.H 10/6/3; throws 5/3/23 1200 (KD +21 fwd, +11..+17
  back); projectile 16/14/12 startup, 47 total, 600; DP 5/6/7, 10 active, -23/-32/-39, air-inv 1-14/1-9/1-8;
  rush 10/12/14, 4 active, -4/-6/-12, 900/1000/1100; command grab 5/3/54, 2500/2900/3300, reach
  1.22/1.10/0.92 m; Lv1 8/5/50 -30 2000; Lv3 10/4/58 -42 4500. Pushback: light 0.27 m (SF6 ratio, 2h); M 0.35 hit /
  0.40 block, H 0.45 / 0.50, air 0.20-0.30 [R starting values].
- **Meters in data**: `gain.showtime` light 300 / medium 500 / heavy 1000 / specials 600-1000 / throws 2000 /
  cmd grabs 3000 (2d); `gain.nerveCost` = SF6 median Drive damage on block (1a: light 500, medium 3000, heavy 5000,
  sweep/command 4000, air 1500/2500/4000, projectile 2500, DP 4000); EX costs 20000 NERVE; Lv1 10000 / Lv3 30000
  SHOWTIME; `chipPct` 25 on specials/supers applies only in STAGE FRIGHT (3a).
- **Notation**: numpad, facing-relative. Normals are keyed by their CONTRACT 19.1 `input` (`5L`, `2M`, `j.H`,
  `6H`). Specials `<name>_l|_m|_h|_ex`; SIMPLE 5S/6S/2S/4S route the M version (x0.8), ASSIST+S+dir the EX.
- **Hurtboxes from body height** (FIGHTERS [R]): stand h = 0.95 H, crouch h = 0.60 H, air h = 0.62 H; width =
  build factor x H (slim 0.27, average 0.30, heavy 0.34, monster 0.36); crouch width x1.15, air x0.95; pushbox =
  0.85 x stand width by 0.90 x stand height.
- **Clip sources**: Mixamo pack clips at the MIXAMO_CLIPS.md contact frames (front pass for strikes at a target
  ahead, render-judged frame for slams and releases); CMU segments from CMU_CLIPS.md / best_candidates.json
  (mirror = southpaw take made orthodox); LAYER = legs from clip A + Spine-up from clip B (crouch and air attacks:
  legs held at Pro_Magic Crouch Idle f1 or at the measured Standing Jump apex f28 / hips 1.488 m); SEQ = clips
  back to back; AUTHORED = keyframed in Blender (two motions roster-wide, below). Range = source frames
  (Mixamo 1-based @30 fps, CMU @120 fps); `contact` is authoritative for clips.json.
- **Research constraints respected**: Rerun's Prisoner body has no right-hand finger bones -> open-hand/claw
  moves and `fist: 0` on CMU punches; Great_Sword clips are two-handed -> only Ricky's mic-cane uses them;
  Sword_and_Shield idle/block/impact are shield poses -> only Krane (who overrides the shared idle/block with
  them); the Brute axe mesh is hidden -> Bruno is unarmed (axe-pack swings read as haymakers/hammer-fists). The
  shared neutral that reacts return to is lane ASSETS' `idle` (tools/clipplan/_shared.json: the CMU 13_17 boxing
  guard, because ASSETS found the Pro_Magic standing idle is a spell-caster pose); fighters that override `idle`
  rely on the 6-frame view blend out of the shared reacts.
- **Shared-clip overrides** (CONTRACT 20.5): a fighter plan may redefine a shared id; used for stance-defining
  idles/walks/blocks (Krane shield, Freak hunch, Rerun zombie, Spin uprock, Ricky cane, Boneyard cleaver, Bruno
  goalkeeper ready stance, Gazza offensive idle). Lotus's drunk sway idle/walks are stance clips
  (`unique.clips`), not overrides.
- **Camera shot vocabulary** for `cinematic.shots` (view/cinematics.ts): `side_close`, `punch_in`, `front_low`,
  `low_angle_up`, `top_down`, `over_shoulder`, `orbit`, `crowd_pop` (cut to crowd / ratings spike), `wide`,
  `slowmo_hold` (hold the frame, time slows), `host_cam` (Ricky's host camera), `spotlight` (single spotlight,
  set dimmed).

## AUTHORED motions (keyframed on X Bot, 30 fps; the only two in the roster)

"""


def authored_md():
    lines = []
    for name, a in L.AUTHORED.items():
        lines.append("### `%s` - %d frames, contact f%d, base `%s`" % (name, a["frames"], a["contact"],
                                                                         a["base"]["file"]))
        lines.append("")
        for f, pose in a["keys"]:
            lines.append("- f%d: %s" % (f, pose))
        lines.append("")
    return lines


def overview_md(kits):
    lines = ["## Roster overview", "",
             "| id | name | archetype | HP | walk f/b | dash f/b | throw | height | build | pack(s) | unique | "
             "stage | rival |",
             "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for K in kits:
        i = K.info
        lines.append("| `%s` | %s | %s | %d | %.2f / %.2f | %.2f / %.2f | %.2f | %.2f | %s | %s | %s | %s | %s |" % (
            i["id"], md_escape(i["name"]), i["archetype"], i["hp"], i["walk"][0], i["walk"][1], i["dash"][0],
            i["dash"][1], i["throwRangeM"], i["heightM"], i["build"], i["doc"].get("packs", "-"), K.unique["kind"],
            i["stage"], i["rival"]))
    lines.append("")
    return lines


def timing_report(K, J, out):
    """Clip playback speed per warp segment (clip seconds / sim seconds). The warp is the move's explicit one,
    else SIM's derived [[0,0],[S,contact],[S+A+R,dur]] (core/data.ts derive). > 3.5x reads as a blur, < 0.4x
    as slow motion - listed for tuning."""
    flagged = []
    for mid in K.order:
        o = J["moves"][mid]
        cl = K.clips.get(o["anim"]["clip"])
        if cl is None:
            continue
        dur, cs = L.entry_seconds(cl)
        tot1 = o["startup"] + o["active"] + o["recovery"]
        w = o["anim"].get("warp")
        if not w:
            w = [[0, 0.0], [o["startup"], cs[0]], [tot1, dur]] if cs and 0 < cs[0] < dur else [[0, 0.0], [tot1, dur]]
        segs = []
        for a, b in zip(w, w[1:]):
            df = (b[0] - a[0]) / 60.0
            sp = (b[1] - a[1]) / df if df > 0 else 99.0
            segs.append(sp)
        worst = max(segs)
        slow = min(segs)
        tag = []
        if worst > 3.5:
            tag.append("FAST %.1fx" % worst)
        if slow < 0.4:
            tag.append("SLOW %.2fx" % slow)
        if tag:
            flagged.append("%s %s (clip %s): %s | segs %s" % (K.info["id"], mid, o["anim"]["clip"], ", ".join(tag),
                                                              " ".join("%.2f" % x for x in segs)))
    out.extend(flagged)
    return len(flagged)


def main():
    kits = []
    timing = []
    for fid in IDS:
        if not os.path.exists(os.path.join(HERE, "kits", fid + ".py")):
            print("SKIP (no kit source yet)", fid)
            continue
        K = importlib.import_module(fid).build()
        K.fit()
        check_kit(K)
        write(os.path.join(OUT_FIGHTERS, fid + ".json"), fmt(K.to_json()) + "\n")
        airborne, grounded = set(), set()
        for mid in K.order:
            m = K.moves[mid]
            up = bool(m.get("moveY")) or m.get("input", mid).startswith("j.") or bool(m.get("air"))
            (airborne if up else grounded).add(m["clip"])
        plan = {}
        for cid, e in K.clips.items():
            be = L.builder_entry(e)
            if cid in airborne and cid not in grounded:
                be["air"] = "strip"   # the sim owns the height (jump arc / moveY): no lift baked into the clip
            plan[cid] = be
        write(os.path.join(OUT_CLIPPLAN, fid + ".json"), fmt(plan) + "\n")
        kits.append(K)
        nflag = timing_report(K, K.to_json(), timing)
        print("built", fid, "moves", len(K.order), "clips", len(K.clips), "timing flags", nflag)
    body = HEADER.split("\n") + authored_md() + overview_md(kits)
    for K in kits:
        body += fighter_md(K)
    write(OUT_ROSTER, "\n".join(body) + "\n")
    print("ROSTER.md", len(body), "lines")
    rep = os.path.join(L.GAME, "_harness", "_reports", "fighters_timing.txt")
    write(rep, "clip playback speed flags (> 3.5x fast, < 0.4x slow)\n" + "\n".join(timing) + "\n")
    print("timing flags total:", len(timing), "->", rep)
    if ERRORS:
        print("BUILD FAILED: %d error(s)" % len(ERRORS))
        sys.exit(1)
    print("BUILD OK")


if __name__ == "__main__":
    main()
