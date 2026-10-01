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
    """Atomic write (temp + replace): lane ASSETS' builder may read a clip plan while this runs."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="ascii", newline="\n") as fh:
        fh.write(text)
    # CHANGED(FIGHTERS) P2: on Windows a concurrent reader (another lane's dev server / probe) can hold the target open
    # for a moment and os.replace fails with WinError 5; retry for up to ~3 s instead of aborting the build
    import time
    for attempt in range(30):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 29:
                raise
            time.sleep(0.1)


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
        # CHANGED(FIGHTERS3D): a lateral-depth override or a tracking decision against the class default needs its reason
        if ("lateralM" in m or "projLateralM" in m) and not m.get("why3d"):
            err("%s %s: lateralM override without why3d" % (fid, mid))
        if m.get("homing") is False and "sweep" in m.get("role", []) and not m.get("why3d"):
            err("%s %s: non-homing sweep without why3d" % (fid, mid))
        if m.get("input", "").startswith("SS.") and "stepatk" not in m.get("role", []):
            err("%s %s: step-attack input without role stepatk" % (fid, mid))
    ring = K.info["doc"].get("ring")
    if not ring or any(not ring.get(k) for k in ("stepping", "homing", "wall")):
        err("%s: doc.ring needs stepping / homing / wall text (ROSTER 3D ring play)" % fid)
        g = m.get("grab")
        if g and g.get("clip") and g["clip"] not in K.clips:
            err("%s %s: grab clip %r not in the clip plan" % (fid, mid, g["clip"]))
        c = m.get("cinematic")
        if c:
            for e in c.get("anim", []):
                if e[1] not in K.clips and e[1] not in L.SHARED:
                    err("%s %s: cinematic clip %r not in the clip plan" % (fid, mid, e[1]))
            for e in c.get("victim", []):
                if e[1] not in L.SHARED:
                    err("%s %s: cinematic victim clip %r is not a shared clip" % (fid, mid, e[1]))
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
    J = getattr(K, "final_json", None) or K.to_json()
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
    # CHANGED(FIGHTERS3D): how the fighter plays the 360-degree ring (CONTRACT 35); the move lists are generated from the
    # emitted JSON so the prose and the data cannot drift apart
    ring = d.get("ring") or {}
    A("**3D ring play.**")
    A("")
    A("- *Stepping game:* %s" % ring.get("stepping", "-"))
    A("- *Homing tools:* %s" % ring.get("homing", "-"))
    A("- *Wall game:* %s" % ring.get("wall", "-"))
    mv = J["moves"]

    def ids(pred):
        return ", ".join("`%s`" % k for k, o in mv.items() if pred(o)) or "-"
    A("- *From the data:* homing %s | linear (steppable) %s | aimed projectiles %s | straight projectiles %s | "
      "anti-step %s | step-attacks %s | wall splat %s." % (
          ids(lambda o: o.get("homing")), ids(lambda o: o.get("linear")),
          ids(lambda o: o.get("projectile", {}).get("aimed")),
          ids(lambda o: o.get("projectile") and not o["projectile"].get("aimed")),
          ids(lambda o: "antistep" in o["role"]), ids(lambda o: "stepatk" in o["role"]),
          ids(lambda o: o["onHit"].get("wallSplat"))))
    # CHANGED(fix_core) D1 (CONTRACT 35.20): the fighter's own sidestep length (kitlib.step_dist_m, from the measured body)
    A("- *Sidestep:* %.3f m arc in 15 frames (kitlib.step_dist_m from the measured body; the default 0.85 m for the "
      "small bodies) - CONTRACT 35.20." % J.get("step", {}).get("distM", L.STEP_DEFAULT_M))
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
    A("| id | name | input | S | A | R | total | on hit | on block | dmg | guard | stop | cancel | inv/armor | 3D | tpl "
      "| deviation / design note |")
    A("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
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
            vic = "; victim " + ", ".join("f%d %s %.2f-%.2f s" % (v[0], v[1], v[2], v[3]) if len(v) >= 4 else
                                          "f%d %s" % (v[0], v[1]) for v in g["victim"]) if g.get("victim") else ""
            note = ("grab: range %s m, lock %d f, dmg at f%d, %s%s. " % (
                g.get("rangeM", J["throwRangeM"]), g["frames"], g["hitF"],
                "swap sides" if g["swap"] else "same side", vic)) + note
        if m.get("why3d"):
            note = (note + " " if note else "") + "3D: " + m["why3d"]
        A("| `%s` | %s | %s | %d | %d | %d | %d | %s | %s | %d | %s | %d | %s | %s | %s | %s | %s |" % (
            mid, md_escape(o["name"]), md_escape(o["input"]), o["startup"], o["active"], o["recovery"], tot, oh,
            ob, o["damage"], o["guard"], o["hitstop"], md_escape(" ".join(o["cancel"])) or "-",
            md_escape(", ".join(inv)) or "-", md_escape(L.dim3(o)), m.get("_tpl", "custom"), md_escape(note)))
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
        hv = HITVOL.get(fid, {"notes": {}, "problems": []})
        if mid in hv["notes"]:
            extra.append("hit volume: " + hv["notes"][mid])
        elif "boxes" in K.moves[mid]:
            extra.append("hand-set hit volume %s" % ", ".join(
                "f%d-%d x %.2f y %.2f w %.2f h %.2f" % (b["f"][0], b["f"][1], b["x"], b["y"], b["w"], b["h"])
                for b in o["boxes"]))
        for pk, pm, pc, pd in hv["problems"]:
            if pm == mid:
                extra.append("%s: clip `%s` - %s" % ("PENDING RE-BAKE" if pk == "PENDING" else "HIT-VOLUME DEFECT",
                                                     pc, pd))
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
        def tl(rows):
            return ", ".join("f%d `%s`%s" % (e[0], e[1], (" %.2f-%.2f s" % (e[2], e[3])) if len(e) >= 4 else "")
                             for e in rows)
        A("- slate: \"%s\"; defender ends lying %s" % (c.get("slate", ""), c.get("endPose", "?")))
        A("- attacker clips: %s" % tl(c["anim"]))
        A("- victim clips: %s" % tl(c["victim"]))
        if c.get("camera"):
            A("- camera: %s" % "; ".join(
                "f%d-%d %s on %s (fov %s, dist %s, h %s, yaw %s%s)" % (
                    k["from"], k["to"], k["shot"], k["target"], k["fovDeg"], k["dist"], k["height"], k["yawDeg"],
                    (", lookH %s" % k["lookH"]) if "lookH" in k else "") for k in c["camera"]))
        else:
            A("- camera shots: %s" % ", ".join("f%d %s" % (f, s_) for f, s_ in c["shots"]))
        if c.get("fx"):
            A("- fx: %s" % ", ".join("f%d %s%s" % (e["f"], e["fx"], ("@" + e["target"]) if "target" in e else "")
                                     for e in c["fx"]))
        if c.get("crowd"):
            A("- crowd: %s" % ", ".join("f%d %s%s" % (e["f"], e["react"], ("/" + e["ratings"]) if "ratings" in e
                                                        else "") for e in c["crowd"]))
        if c.get("pathA"):
            A("- attacker path (f, dx, lift m): %s; defender gap (f, gap, lift m): %s" % (
                " ".join("[%d %.2f %.2f]" % tuple(e) for e in c["pathA"]),
                " ".join("[%d %.2f %.2f]" % tuple(e) for e in c["gapD"])))
        A("")
    # CHANGED(FIGHTERS) P2: season text (CONTRACT 26.3)
    if J.get("introLine"):
        A("**Season text** (`introLine`, `winQuotes`, `banter`, `ending`; UI renders them).")
        A("")
        A("- intro: \"%s\"" % J["introLine"])
        A("- win quotes: %s" % " / ".join("\"%s\"" % q for q in J["winQuotes"]))
        for k, v in J["banter"].items():
            A("- banter vs `%s`: \"%s\" ... \"%s\"" % (k, v[0], v[1]))
        A("- ending: %s" % J["ending"])
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
            for e in m["cinematic"]["anim"]:
                users.setdefault(e[1], []).append(mid + " (cine)")
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
- **Hurtboxes** (FIGHTERS [M], 2026-09-30): stand / crouch heights are MEASURED on the baked bodies - Blender 5.1
  mesh max-up of lane ASSETS' raw.glb, median of 7 frames of the `idle` / `crouch_idle` clip that fighter plays
  (crouch clamped to stand; Freak's hunched crouch measures above his idle). The first rule (crouch 0.60 H) sat
  0.13-0.29 m below every real crouch pose. Air h = 0.62 H (tucked jump); width = build factor x H (slim 0.27,
  average 0.30, heavy 0.34, monster 0.36); crouch width x1.15, air x0.95; pushbox = 0.85 x stand width by 0.90 x
  stand height.
- **Hit volumes / crouch-reach rule** (FIGHTERS [M]): SIM derives each strike's box centred on the clips.json
  effector at contact (L 0.30x0.25, M 0.40x0.30, H/supers 0.50x0.35 m). Every grounded strike that is not an
  anti-air must reach the **crouch line 1.10 m** (lowest measured crouch top, Krane 1.159 m, minus 0.05): SF-style
  mids, overheads, projectiles and supers hit crouching opponents. It must also hit a TOUCHING opponent: the box's
  near edge sits within point-blank reach ((own pushbox + 0.39) / 2 + 0.23 - 0.10 m: the slimmest defender's
  hurtbox far edge when the pushboxes touch, minus 0.10). The build widens a derived box to that limb volume (top,
  far reach and frames unchanged; `boxSrc: "hitVolume"`); lowering a box more than 0.50 m means the clip is aimed
  over every crouch, and the clip is fixed instead. Measured in the real sim before the rules: 53 of 307 damaging
  ground moves whiffed crouching opponents (incl. overheads, 2 projectile families and 6 supers) and Freak's
  long-arm rushes and Lv1 connected only from 2.4-3.2 m. Pure anti-airs are exempt; a reversal anti-air (the DPs)
  must reach both with its FIRST hit (cap 0.60 m - the rising arm sweeps that space). Anti-air normals with a poor
  effector carry hand-set boxes (listed per move). Weapon props (baton, cleaver, mic-cane) are not in the effector point; their extra reach is not
  modelled yet (open item).
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
- **Lv3 PRIME TIME cinematics (CONTRACT 26.1, v2, P2):** each Lv3 carries attacker / victim sub-clip timelines
  `[f0, clip, fromS, toS]` (strike clips aligned so the clip contact lands on its `hits` frame: `Kit.seg(hit=...)`),
  root paths (`pathA` attacker offset, `gapD` defender gap; the last keys match the sim's end state), a contiguous camera
  shot list (`wide | close | low | over_shoulder | orbit | top` on `attacker | defender | both`, with fov / dist / height /
  yaw, numbers or [start, end] eased; `kitlib.cam()` framing floors), FX beats, crowd / ratings beats, a TV slate line
  and the defender's end pose. Numbers are for 1.80 m bodies; VIEW scales by the target's height and keeps grounded
  bodies apart by their push fronts (CONTRACT 26.5). Legacy `shots` = generated `[from, shot]`.
- **Paired throws (CONTRACT 26.2, P2):** every throw, command grab and grab super has a `grab.victim` timeline on the
  shared victim clips, and `grab.hitF` sits on the attacker clip's visible impact (read off grab-clip render sheets):
  holds show hit reactions on each strike, the final segment ends lying (face up: kd_fall_b / thrown_f; face down:
  thrown_b / crumple), side swaps travel forward >= 0.5 m (thrown_b), techable throws deal damage after the 9-frame tech
  window. Verified in the real sim (scratch throwcheck: all 31 grabs x 3 victim bodies).
- **Season text (CONTRACT 26.3, P2):** `introLine`, `winQuotes` (3), `banter` (rival / freak / ricky / default; Ricky
  vs every contestant; the Freak's lines are stage directions), `ending` (3-5 sentences), listed per fighter below.
- **3D ring (CONTRACT 35.4 / 35.12, lane FIGHTERS3D):** the fight is a 360-degree ring; fighters sidestep (15 f; the arc
  is per fighter, CONTRACT 35.20: 0.85 m for the small bodies, up to 1.7 m for the long / wide ones) and circle-walk. Every move carries `track {until, rate}` (the last frame the attacker turns toward the opponent,
  degrees per frame); class defaults: normals, command normals, specials and supers track to startup - 6 (throws to
  startup - 4; CHANGED(STEPTUNE) 35.15: normals were startup - 4), at 180 deg / f (snap). **HOMING** moves track through their last active frame at 20 deg / f and are 0.60 m deep across the
  attack line: they catch a stepper (wide hooks and roundhouses, low roundhouses, sweeps, spins / flairs / lariats,
  command-grab reach arcs, counter follow-ups, most supers). **LINEAR** moves face the opponent on frame 1 and never turn
  (rushes, charge moves, leaps and dives, straight non-aimed projectile throws, lunges): a sidestep during their startup
  beats them, and the stepper punishes from the side. Default moves track through most of their startup and then
  freeze (straight punches' later frames). Measured in the sim (lane STEPTUNE, CONTRACT 35.15, probe_3d steppable table:
  front-loaded step = 64 % of its 0.85 m arc in the first 6 frames, 1.2 m apart, johnny defending): a READ step -
  started 4-8 frames before the first active frame - evades a default normal (52 of 53, median window 4 frames; the
  4-frame johnny 5L is the exception) and a LINEAR move (median window 20 frames); a step started less than 3 frames
  before a default normal's active frames is hit; HOMING moves (and aimed projectiles at 1.2 m) are never evaded. The
  defender's body matters as much: with one 0.85 m step the big bodies (boneyard, bruno, freak, krane, rerun, spin) never
  stepped a straight normal (CONTRACT 35.15 item 7), so each fighter now carries its own `step.distM` sized from the
  measured body (kitlib.step_dist_m, CHANGED(fix_core) 35.20): at 1.2 m every body evades a straight 5M / 5H on a read
  (big bodies 2-3 start frames, the small ones keep their 3-6), and homing moves stay unsteppable.
  `lateralM` = each box's half-depth across the attack line (L 0.15,
  M 0.18 by button for normals; specials / EX / supers 0.22; sweeps 0.45, homing 0.60 unless noted). Projectiles: **AIMED** = launched at the opponent on
  the spawn frame (the step has to come after the release); straight = along the thrower's yaw (steppable on
  anticipation). Roles: `antistep` = the fighter's fast step-catcher (every fighter has one), `stepatk` = a step-attack
  (`SS.<button>`: the button pressed during a sidestep from its frame 2, out on frame 11, or while circle-walking; PATCH and
  SPIN). The 3D column of each frame table shows the class, the tracking end frame and the depth; per-fighter "3D ring
  play" covers the stepping game, the homing tools and the wall game (ring boundary = wall; `onHit.wallSplat` enders).

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


# ------------------------------------------------------------------------------------ hit volumes
# Hit-volume rules (2026-09-30, measured in the real sim - see ROSTER.md conventions). SIM derives a strike's
# box centred on the clips.json effector at contact (core/data.ts derive, CONTRACT 5.2), i.e. only the fist /
# foot. For every grounded strike that is not an anti-air the build widens that box to the limb volume:
#  - CROUCH REACH: bottom lowered to kitlib.CROUCH_LINE_M (SF-structure mids, overheads, projectiles and supers
#    hit crouching opponents); top unchanged; lowering more than kitlib.BOX_EXT_CAP_M is a clip defect (the
#    strike is aimed over every crouching head: fix the clip, do not stretch the box).
#  - POINT BLANK: near edge pulled back to kitlib.point_blank_near_max(pushbox) (the arm/leg between the body
#    and the effector is there; a touching opponent must be hit); far edge (reach) unchanged.
# Pure anti-airs are exempt; `reversal` anti-airs (DPs) apply both rules to their FIRST hit with the 0.60 m cap.
# Emitted boxes are tagged `boxSrc: "hitVolume"`. Hand-set kit boxes must already satisfy both (build error).
# Clips whose plan entry differs from the entry the published bake used (art/renders/<id>/_build/bake.json
# `src`) are PENDING: their clips.json effector is stale, so no box is emitted until lane ASSETS re-bakes and
# this build runs again. Multi-hit moves: SIM derives every hit's box at the FIRST contact's effector (clips.json
# has one effector); per-hit points need ASSETS `marksAt` (requested, CONTRACT 20.6).
SYS = json.load(open(os.path.join(L.GAME, "data", "system.json"), encoding="utf-8"))
PENDING = {}     # fid -> {clip ids}
HITVOL = {}      # fid -> {"notes": {mid: text}, "problems": [(kind, mid, clip, detail)]}


def load_clips(fid):
    p = os.path.join(L.GAME, "data", "clips", fid + ".clips.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as fh:
        return json.load(fh)


def _strip(o):
    if isinstance(o, dict):
        # `marks` only add named times (e.g. THROW PAIR SYNC slam); they never move the pose or the effector
        return {k: _strip(v) for k, v in o.items() if not k.startswith("_") and k not in ("id", "marks")}
    if isinstance(o, list):
        return [_strip(x) for x in o]
    if isinstance(o, float) and o == int(o):
        return int(o)
    return o


def baked_pending(fid, plan):
    """Plan clip ids whose entry differs from the one the last bake used (None = no bake record)."""
    p = os.path.join(L.GAME, "art", "renders", fid, "_build", "bake.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as fh:
        baked = json.load(fh).get("clips", {})
    out = set()
    for cid, be in plan.items():
        b = baked.get(cid)
        if b is None or _strip(be) != _strip(b.get("src", {})):
            out.add(cid)
    return out


def is_strike(o):
    """SIM core/data.ts isStrikeKind."""
    if o["kind"] in ("throw", "cmdgrab") or o.get("grab") or o.get("projectile"):
        return False
    if o.get("cinematic"):
        return True
    return o.get("damage", 0) > 0 or any(h["damage"] > 0 for h in o.get("hits", []))


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


def hit_volume(K, J, clips, pending):
    """Crouch-reach + point-blank rules on every grounded non-anti-air strike (see the block comment above)."""
    fid = K.info["id"]
    line = L.CROUCH_LINE_M
    near_max = round(L.point_blank_near_max(J["pushbox"][0], (J.get("push") or {}).get("front")), 3)
    notes, problems = {}, []
    for mid in K.order:
        o = J["moves"][mid]
        if not is_strike(o) or o["input"].startswith("j.") or o.get("air") is True:
            continue
        roles = o.get("role", [])
        # pure anti-airs are exempt; a `reversal` (wake-up / invincible) must also hit a crouching or touching
        # opponent, even when it is an anti-air too (SF convention: the DP's rising arm starts low)
        if ("antiair" in roles and "reversal" not in roles) or "high" in roles:
            continue
        clip = o["anim"]["clip"]
        hand = "boxes" in o
        if hand:
            boxes = [dict(b) for b in o["boxes"]]
        else:
            if clip in pending:
                # CHANGED(FIGHTERS) P2: keep the box from the PREVIOUS bake's effector until lane ASSETS re-bakes (dropping
                # it made the sim fall back to the bare fist box meanwhile); validate.py lists it PENDING, build.py
                # recomputes it after the bake
                problems.append(("PENDING", mid, clip, "plan changed since the published bake (box from the previous "
                                                       "bake's effector until the re-bake)"))
            c = clips["clips"].get(clip) if clips else None
            if not c or not c.get("effector"):
                continue
            st = "H" if o["kind"] in ("super1", "super3") else o["strength"]
            w, h = SYS["boxes"][st]
            x, y = c["effector"]["at"]
            ranges = [hh["f"] for hh in o["hits"]] if o.get("hits") else [[o["startup"], o["startup"] + o["active"] - 1]]
            boxes = [{"f": list(r), "x": x, "y": y, "w": w, "h": h} for r in ranges]
        ext_y, ext_x, bad = 0.0, 0.0, None
        rev = "antiair" in roles   # (reversal too, else skipped above): first hit only, reversal cap
        cap = L.REV_EXT_CAP_M if rev else L.BOX_EXT_CAP_M
        for bi, b in enumerate(boxes):
            if rev and bi > 0:
                continue
            lift = lift_at(o, b["f"][0])
            bottom = lift + b["y"] - b["h"] / 2.0
            near = b["x"] - b["w"] / 2.0
            if hand:
                if bottom > line + 1e-9:
                    bad = "hand-set box bottom %.2f m (world, lift %.2f) above the crouch line %.2f m" % (bottom, lift, line)
                elif near > near_max + 1e-9:
                    bad = "hand-set box near edge %.2f m beyond point-blank reach %.2f m" % (near, near_max)
                if bad:
                    break
                continue
            if bottom > line + 1e-9:
                ext = bottom - line
                if ext > cap + 1e-9:
                    bad = "derived box bottom %.2f m needs %.2f m (> cap %.2f): strike aimed over every crouch" % (
                        bottom, ext, cap)
                    break
                top = b["y"] + b["h"] / 2.0
                nb = line - lift
                b["y"], b["h"] = (top + nb) / 2.0, top - nb
                ext_y = max(ext_y, ext)
            if near > near_max + 1e-9:
                far = b["x"] + b["w"] / 2.0
                b["x"], b["w"] = (near_max + far) / 2.0, far - near_max
                ext_x = max(ext_x, near - near_max)
            for k in ("x", "y", "w", "h"):
                b[k] = round(b[k], 3)
        if bad:
            if hand:
                err("%s %s: %s" % (fid, mid, bad))
            problems.append(("HAND" if hand else "CLIP", mid, clip, bad))
            continue
        if ext_y > 0 or ext_x > 0:
            o["boxes"] = boxes
            o["boxSrc"] = "hitVolume"
            parts = []
            if ext_y > 0:
                parts.append("bottom lowered %.2f m to the crouch line %.2f m" % (ext_y, line))
            if ext_x > 0:
                parts.append("near edge pulled back %.2f m to point-blank reach %.2f m" % (ext_x, near_max))
            notes[mid] = "%s (clips.json `%s` effector %s)" % ("; ".join(parts), clip,
                                                                clips["clips"][clip]["effector"]["bone"])
    HITVOL[fid] = {"notes": notes, "problems": problems}
    return notes, problems


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
    built = []
    for fid in IDS:
        if not os.path.exists(os.path.join(HERE, "kits", fid + ".py")):
            print("SKIP (no kit source yet)", fid)
            continue
        built.append((fid, importlib.import_module(fid).build()))
    # CHANGED(fixer) D2: the slimmest touching defender over the whole roster (measured push fronts + hurtbox halves)
    dm = []
    for fid, K in built:
        pe = L.push_extents(fid)
        if pe:
            dm.append(pe["front"] + L.hurtboxes(K.info)["stand"][0] / 2.0)
    L.ROSTER_DEF_MIN = round(min(dm), 3) if len(dm) == len(built) and dm else None
    print("point blank: ROSTER_DEF_MIN (min push front + hurt half) =", L.ROSTER_DEF_MIN)
    for fid, K in built:
        K.fit()
        K.resolve()   # CHANGED(FIGHTERS) P2: cinematic timelines read the fitted clip times
        check_kit(K)
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
        # THROW PAIR SYNC (CONTRACT 6.2, lane ASSETS): every attacker grab clip declares marks.slam = the source
        # frame the clip shows on the damage frame (grab.hitF) under the linear lock warp (CONTRACT 19.10), so
        # the view lands the victim's thrown_f / thrown_b floor impact on the damage frame without re-timing the
        # attacker. First grab move using the clip decides; later users that differ are reported.
        slam_from = {}
        for mid in K.order:
            g = K.moves[mid].get("grab")
            if not g or not g.get("clip") or g["clip"] not in plan:
                continue
            e = plan[g["clip"]]
            if e.get("src") not in ("mixamo", "cmu"):
                err("%s %s: grab clip %s src %s - slam mark needs a mixamo/cmu entry" % (fid, mid, g["clip"],
                                                                                       e.get("src")))
                continue
            fps = 30.0 if e["src"] == "mixamo" else 120.0
            f0, f1 = e["range"]
            dur, _ = L.entry_seconds(e)
            slam = int(round(f0 + (g["hitF"] / float(g["frames"])) * dur * fps * float(e.get("speed", 1.0))))
            slam = max(f0, min(f1, slam))
            if g["clip"] in slam_from:
                if abs(slam - e["marks"]["slam"]) > 3 * (fps / 30.0):
                    print("   note: %s grab clip %s slam %d from %s; %s would put it at %d" % (
                        fid, g["clip"], e["marks"]["slam"], slam_from[g["clip"]], mid, slam))
                continue
            e.setdefault("marks", {})["slam"] = slam
            slam_from[g["clip"]] = mid
        pend = baked_pending(fid, plan)
        PENDING[fid] = pend if pend is not None else set()
        J = K.to_json()
        if J.get("push") is None:
            J.pop("push", None)
        notes, probs = hit_volume(K, J, load_clips(fid), PENDING[fid])
        # CHANGED(fixer) D2: per-move push-box front extension from the clip's measured lean (kitlib.push_ext_curve)
        cfile = load_clips(fid)
        n_ext = 0
        for mid in K.order:
            o = J["moves"][mid]
            pe_curve = L.push_ext_curve(fid, o, cfile)
            if pe_curve:
                o["pushExt"] = pe_curve
                n_ext += 1
        K.final_json = J
        write(os.path.join(OUT_FIGHTERS, fid + ".json"), fmt(J) + "\n")
        write(os.path.join(OUT_CLIPPLAN, fid + ".json"), fmt(plan) + "\n")
        kits.append(K)
        nflag = timing_report(K, J, timing)
        print("built", fid, "moves", len(K.order), "clips", len(K.clips), "timing flags", nflag,
              "| push", J.get("push"), "| pushExt moves", n_ext,
              "| hit-volume boxes", len(notes), "| hit-volume problems", len(probs),
              "| clips pending re-bake", sorted(PENDING[fid]) if pend is not None else "no bake record")
        for p in probs:
            print("   ", p[0], p[1], p[2], "-", p[3])
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
