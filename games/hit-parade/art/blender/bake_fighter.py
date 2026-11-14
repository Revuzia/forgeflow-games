"""HIT PARADE - bake ONE fighter GLB headless (lane ASSETS, CONTRACT 6.1-6.3).

  blender.exe --background --python art/blender/bake_fighter.py -- <job.json>

job.json is written by tools/build_fighters.py:
  {"fighter", "body": {"fbx", "heightM", "hide"}, "work_dir", "raw_glb", "bake_json",
   "mixamo_root", "xbot_fbx", "tools_dir", "atlas", "clips": [ {id, src, file, range, ...}, ... ]}
Clip entry fields (tools/clipplan/*.json, CONTRACT 6.2 + additive fields documented there):
  src: mixamo | cmu | layer | author     file: "Pack/clip" (mixamo) | "13_17" (cmu take) | name (author)
  range: [f0, f1] source frames          speed: playback factor      mirror: swap L/R
  layer: {lower: <entry|"Pack/clip">, upper: <entry|"Pack/clip">, attach: "yaw"|"full"|"world"}
         (upper time-warped onto lower; attach default "yaw" = the upper keeps its own world yaw)
  seq: [<entry>, ...], xf: 2   (segments back to back, xf-frame crossfade; hp_retarget.SeqSampler)
  loop, loopBlend (frames), air ("strip" ground-lock | "hold" hips height), contact ("auto" | null |
  source frame), effector (bone), marks {name: source frame}; cmu extras: kind, limb, fist, face
  ("guard" = face the mean hands direction), cmuContact.
  CHANGED(ASSETS3D): rootSpeed (m/s) + rootAxis ("lat" | "fwd"): per-body playback rate of a travelling loop
  (apply_root_speed); rootLat: true -> clips.json rootLat (lateral stripped travel); loopBlendScope: "upper";
  mixamo `cycle` [c0, c1]: the source is a gait cycle, frames past c1 wrap (+ one stride of travel per wrap);
  rootFrom: "feet" (with rootSpeed): second pass at the rate that makes the planted feet travel at the target speed,
  root / rootLat scaled to that feet travel (feet_travel_factor).
  bake.json per clip also records `rate`, `slide` (foot slide at the authored speed) and `twist` (pelvis vs shoulders).
Writes the raw (uncompressed) GLB and bake.json (clips meta + body facts + gate numbers).
ASCII only.
"""
import json
import math
import os
import sys
import time
import traceback

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import hp_common as C  # noqa: E402
import hp_body as HB  # noqa: E402
import hp_retarget as R  # noqa: E402
import author_clips as AU  # noqa: E402

FPS = R.FPS


class Library(object):
    """Imported X Bot-skeleton sources, cached and released when no remaining clip needs them."""

    def __init__(self, job):
        self.job = job
        self.mix = {}
        self.cmu = {}
        self.refs = {}
        self._bvh = {}
        self._cmu_mod = None

    # --- mixamo clip FBX, or "cmu:<take>:<start>:<end>[:<kind>:<limb>:<contact>[:m]]" for authored bases
    def ev(self, clip):
        if clip.startswith("cmu:"):
            p = clip.split(":")
            e = {"file": p[1], "range": [int(p[2]), int(p[3])], "fist": 75}
            if len(p) >= 7:
                e.update({"kind": p[4], "limb": p[5], "cmuContact": int(p[6])})
            else:
                e.update({"kind": "getup", "face": "guard"})
            if len(p) >= 8 and p[7] == "m":
                e["mirror"] = True
            return self.cmu_ev(e)
        if clip not in self.mix:
            path = os.path.join(self.job["mixamo_root"], clip + ".fbx")
            objs = C.import_fbx(path)
            arm = next(o for o in objs if o.type == "ARMATURE")
            C.remove_objects([o for o in objs if o is not arm])
            arm.name = "SRC_" + clip.split("/")[-1][:40]
            self.mix[clip] = R._ArmEval(arm)
        return self.mix[clip]

    # --- CMU take -> X Bot armature (tools/cmu_retarget.py, reused verbatim)
    def cmu_ev(self, e):
        rng = e["range"]
        speed = float(e.get("speed", 1.0))
        if self._cmu_mod is None:
            C.add_path(self.job["tools_dir"])
            C.add_path(os.path.join(self.job["tools_dir"], "research"))
            import cmu_retarget  # noqa
            self._cmu_mod = cmu_retarget
        self.verify_limb(e, self._cmu_mod)
        key = json.dumps([e["file"], rng, e.get("faceRange"), speed, bool(e.get("mirror")), e.get("fist", 75), e.get("face"),
                          e.get("kind", "getup"), e.get("_limb_resolved") or e.get("limb", "R"), e.get("cmuContact"),
                          e.get("contact") if isinstance(e.get("contact"), (int, float)) else None])
        if key in self.cmu:
            return self.cmu[key]
        CR = self._cmu_mod
        objs = C.import_fbx(self.job["xbot_fbx"])
        arm = next(o for o in objs if o.type == "ARMATURE")
        C.remove_objects([o for o in objs if o is not arm])
        for a in list(bpy.data.actions):
            if a.users == 0 or (arm.animation_data and arm.animation_data.action is a):
                pass
        arm.animation_data_clear()
        arm.name = "CMU_" + e["file"]
        fps_out = int(round(30.0 / speed))
        step = int(round(120.0 / fps_out))
        if abs(120.0 / step - 30.0 / speed) > 1e-6:
            C.log("WARN cmu speed %.3f is not reachable with an integer 120fps step; using step %d (speed %.3f)"
                  % (speed, step, step / 4.0))
        clip = {"name": "__cmu_%s_%d" % (e["file"], len(self.cmu)), "take": e["file"],
                "start": int(rng[0]), "end": int(rng[1]),
                "contact": int(e["cmuContact"] if e.get("cmuContact") is not None else
                               (e["contact"] if isinstance(e.get("contact"), (int, float)) else
                                (int(rng[0]) + int(rng[1])) // 2)),
                "kind": e.get("kind", "getup"), "limb": e.get("_limb_resolved") or e.get("limb", "R"),
                "mirror": bool(e.get("mirror")), "fist": e.get("fist", 75)}
        if e.get("face") == "guard":
            import numpy as np
            d = CR.B.load_blender(CR.take_path(e["file"]))
            I = d["idx"]
            pos = d["pos"]
            if clip["mirror"]:
                pos, _, _ = CR.mirror_source(d)
            # CHANGED(ASSETS3D): `faceRange` = the window the guard facing is measured on (default: the clip's own
            # range). The side-step's upper (13_17 f4140-4168) is faced like the idle window (4168-4316), so the step
            # ends on exactly the idle's upper-body facing instead of its own window's mean-hands direction
            s, t = [int(x) for x in (e.get("faceRange") or rng)]
            mid = (pos[s:t + 1, I["LeftHand"]] + pos[s:t + 1, I["RightHand"]]) / 2.0
            v = (mid - pos[s:t + 1, I["Hips"]]).mean(axis=0)
            clip["face_override"] = [float(v[0]), float(v[1]), 0.0]
        elif isinstance(e.get("face"), list):
            clip["face_override"] = e["face"]
        act, info, _ = CR.retarget(arm, clip, fps_out)
        bpy.context.scene.render.fps = FPS
        ev = R._ArmEval(arm)
        ev.cmu_info = info
        ev.cmu_step = step
        self.cmu[key] = ev
        return ev

    def verify_limb(self, e, CR):
        """The striking limb of a CMU strike is DECLARED by the plan (`limb`, post-mirror). Verify it on
        the source: peak speed (limb point - Spine1 for hands, - Hips for feet/knees) in [c-16, c+4]
        source frames of the declared side vs the same limb on the other side. When the other side is
        > 2x faster AND > 4 m/s the declared side is not the one striking (measured: johnny
        weave_counter_hook 17_10 declares L_hand 2.7 m/s while the right hand swings at 10.8 m/s): bake
        with the measured side (facing + effector) and record `_limb_resolved` / `_limb_check` in
        bake.json so the plan owner can fix the entry. `limb_lock: true` in the entry skips this."""
        kind = e.get("kind")
        limb = e.get("limb") or ""
        c = e.get("cmuContact") if e.get("cmuContact") is not None else e.get("contact")
        if kind not in ("hand", "foot", "knee") or limb[:1] not in ("L", "R") or e.get("limb_lock") \
                or not isinstance(c, (int, float)) or "_limb_check" in e:
            return
        import numpy as np
        bk = (e["file"], bool(e.get("mirror")))
        if bk not in self._bvh:
            d = CR.B.load_blender(CR.take_path(e["file"]))
            pos = CR.mirror_source(d)[0] if e.get("mirror") else d["pos"]
            self._bvh[bk] = (d["idx"], pos)
        I, pos = self._bvh[bk]
        part = {"hand": "Hand", "foot": "Foot", "knee": "Leg"}[kind]
        ref = "Spine1" if kind == "hand" else "Hips"
        s, t = int(e["range"][0]), int(e["range"][1])
        lo, hi = max(s + 1, int(c) - 16), min(t - 1, int(c) + 4)
        if hi < lo:
            return

        def peak(side):
            q = pos[:, I[side + part]] - pos[:, I[ref]]
            return float(max(np.linalg.norm(q[f + 1] - q[f - 1]) * 60.0 for f in range(lo, hi + 1)))
        S = "Left" if limb[0] == "L" else "Right"
        O = "Right" if S == "Left" else "Left"
        a, b = peak(S), peak(O)
        chk = {"declared": limb, "speed_declared": round(a, 2), "speed_other": round(b, 2)}
        if b > 2.0 * a and b > 4.0:
            e["_limb_resolved"] = O[0] + limb[1:]
            chk["resolved"] = e["_limb_resolved"]
            C.log("LIMB CHECK %s: declared %s %.1f m/s, other side %.1f m/s -> baked as %s"
                  % (e["file"], limb, a, b, e["_limb_resolved"]))
        e["_limb_check"] = chk

    def release_all(self):
        arms = [ev.arm for ev in list(self.mix.values()) + list(self.cmu.values())]
        C.remove_objects(arms)
        self.mix, self.cmu = {}, {}


def norm_entry(x):
    if isinstance(x, str):
        return {"src": "mixamo", "file": x}
    return x


def build_sampler(e, lib):
    src = e.get("src", "mixamo")
    if src == "mixamo":
        return R.ClipSampler(lib.ev(e["file"]), e.get("range"), e.get("speed", 1.0), e.get("mirror", False),
                             e.get("cycle"))
    if src == "cmu":
        return R.ClipSampler(lib.cmu_ev(e), None, 1.0, False)
    if src == "author":
        spec = AU.AUTHORED[e["file"]]
        return AU.AuthorSampler(e["file"], spec, lib.ev)
    if src == "layer":
        lo = build_sampler(norm_entry(e["layer"]["lower"]), lib)
        up = build_sampler(norm_entry(e["layer"]["upper"]), lib)
        return R.LayerSampler(lo, up, e["layer"].get("attach") or lib.job.get("layer_attach") or "yaw")
    if src == "seq":
        segs = [build_sampler(norm_entry(x), lib) for x in e["seq"]]
        return R.SeqSampler(segs, e.get("xf", 2))
    raise ValueError("unknown src " + str(src))


def src_to_out(e, sampler, f):
    """Source frame -> output frame for contact/marks. A seq maps through its FIRST segment (use
    seq_points() for the per-segment contacts/marks)."""
    src = e.get("src", "mixamo")
    if src == "layer":
        return src_to_out(norm_entry(e["layer"]["lower"]), sampler.lo, f)
    if src == "seq":
        return sampler.starts[0] + src_to_out(norm_entry(e["seq"][0]), sampler.segs[0], f)
    if src == "cmu":
        step = int(round(120.0 / int(round(30.0 / float(e.get("speed", 1.0))))))
        return (float(f) - float(e["range"][0])) / step
    f0 = getattr(sampler, "f0", 0.0)
    sp = getattr(sampler, "speed", 1.0)
    return (float(f) - f0) / sp


def _num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def entry_points(e, sampler):
    """(contact output frame | None, [(mark name, output frame)]) of one plan entry in ITS OWN output
    frames. marks: the entry's `marks` (source frames), else its `contacts` as hit1..N; a layer maps its
    own marks through the lower and, when it has none, the upper's marks/contacts through the upper ->
    lower time warp (LayerSampler); a seq concatenates every segment's contacts as hit1..N (plus any
    other named segment marks), offset by the segment's start (= kitlib.entry_seconds)."""
    src = e.get("src", "mixamo")
    marks = []
    if src == "seq":
        hits, named = [], []
        for i, (x, g) in enumerate(zip(e["seq"], sampler.segs)):
            x = norm_entry(x)
            c, mk = entry_points(x, g)
            seg_hits = [f for (nm, f) in mk if nm.startswith("hit")]
            if not seg_hits and c is not None:
                seg_hits = [c]
            hits += [sampler.starts[i] + f for f in seg_hits]
            named += [(nm, sampler.starts[i] + f) for (nm, f) in mk if not nm.startswith("hit")]
        seen = set()
        for nm, f in named:
            if nm not in seen:
                seen.add(nm)
                marks.append((nm, f))
        if len(hits) > 1:
            marks += [("hit%d" % (k + 1), f) for k, f in enumerate(hits)]
        # contact = the first segment that HAS a contact (lane FIGHTERS' kitlib.seq copies entries[0].contact,
        # so a leading run-in segment made rerun crawl_run / crawl_run_ex contact-less although their bite
        # segment strikes -> the SIM fell back to default boxes); null only when no segment strikes
        c0 = None
        for i, (x, g) in enumerate(zip(e["seq"], sampler.segs)):
            x = norm_entry(x)
            if _num(x.get("contact")):
                c0 = sampler.starts[i] + entry_points(x, g)[0]
                break
        if c0 is None and _num(e.get("contact")):
            c0 = src_to_out(e, sampler, e["contact"])
        elif c0 is None and e.get("contact", "auto") == "auto":
            c0 = "auto"
        return c0, marks
    c = e.get("contact", "auto")
    cf = src_to_out(e, sampler, c) if _num(c) else (None if c is None else "auto")
    if e.get("marks"):
        marks = [(nm, src_to_out(e, sampler, f)) for nm, f in e["marks"].items()]
    elif e.get("contacts") and len(e["contacts"]) > 1:
        marks = [("hit%d" % (k + 1), src_to_out(e, sampler, f)) for k, f in enumerate(e["contacts"])]
    elif src == "layer":
        up = norm_entry(e["layer"]["upper"])
        _, um = entry_points(up, sampler.up)
        if um:
            sc = (sampler.n - 1) / float(max(1, sampler.up.n - 1))
            marks = [(nm, f * sc) for nm, f in um]
    return cf, marks


def entry_effector(e):
    """The striking bone for measurement: the plan's `effector`, else a CMU entry's limb (post-mirror,
    e.g. L_hand -> LeftHand), else (layer) the upper's, else (seq) the first segment's."""
    if e.get("effector"):
        return e["effector"]
    src = e.get("src", "mixamo")
    if src == "layer":
        return entry_effector(norm_entry(e["layer"]["upper"]))
    if src == "seq":
        # the segment the seq contact comes from: the first one with a contact
        segs = [norm_entry(x) for x in e["seq"]]
        first = next((x for x in segs if _num(x.get("contact"))), segs[0])
        return entry_effector(first)
    limb, kind = e.get("_limb_resolved") or e.get("limb") or "", e.get("kind")
    if limb[:1] in ("L", "R") and kind in ("hand", "foot", "knee"):
        return ("Left" if limb[0] == "L" else "Right") + {"hand": "Hand", "foot": "Foot", "knee": "Knee"}[kind]
    return None


def hands_from_cmu(e):
    """True when the clip's hands come from CMU mocap (a cmu entry, a layer whose upper is cmu, a seq with
    any cmu segment): those get hp_retarget.sanitize_wrists. Authored clips keep their keyed hands."""
    e = norm_entry(e)
    src = e.get("src", "mixamo")
    if src == "cmu":
        return True
    if src == "layer":
        return hands_from_cmu(e["layer"]["upper"])
    if src == "seq":
        return any(hands_from_cmu(x) for x in e["seq"])
    return False


def cmu_body(e):
    """True when the clip's LEGS come from CMU too (a cmu entry, a seq with a cmu segment; a layer's legs come
    from its lower): feet + limb spikes are sanitised as well as the hands."""
    e = norm_entry(e)
    src = e.get("src", "mixamo")
    if src == "cmu":
        return True
    if src == "layer":
        return cmu_body(e["layer"]["lower"])
    if src == "seq":
        return any(cmu_body(x) for x in e["seq"])
    return False


def effector_cands(e):
    """A layered strike comes from the upper body: only the hands (and head) are candidates."""
    src = e.get("src", "mixamo")
    if src == "layer" or (src == "seq" and norm_entry(e["seq"][0]).get("src") == "layer"):
        return ("RightHand", "LeftHand")
    return None


TRACE_EFF = ("RightHand", "LeftHand", "RightFoot", "LeftFoot", "RightKnee", "LeftKnee")


def effector_trace(tgt, frames_P):
    """Per baked frame, fighter-local [fwd, up, right] (metres) of each main effector point and of its
    limb root (shoulder / hip joint): the evidence tools/contact_check.py judges contact time, the
    striking limb and the facing with (bake.json only, never clips.json)."""
    out = {}
    for eff in TRACE_EFF:
        pts, roots = [], []
        for P in frames_P:
            p, r = R.eff_point(tgt, P, eff)
            pts.append([round(-p.y, 3), round(p.z, 3), round(-p.x, 3)])
            roots.append([round(-r.y, 3), round(r.z, 3), round(-r.x, 3)])
        out[eff] = {"p": pts, "root": roots}
    return out


def bake_pass(e, smp, tgt, body, cid):
    """retarget -> action -> floor fix -> FK -> contact / effector measurement for one sampler."""
    opts = {"air": e.get("air"), "loopBlend": e.get("loopBlend", 0), "loopBlendScope": e.get("loopBlendScope", "all")}
    res = R.retarget(smp, tgt, opts)
    # extremities (hp_retarget: CMU hand data is marker garbage in places; shoes do not bend 58+ deg)
    xs = {}
    if hands_from_cmu(e) and e.get("wrist") != "raw":
        # frames the contact / strike marks sample (floor + ceil of each explicit time) stay untouched by the
        # snap spread; an invalid (spike / broken) contact frame is still repaired
        c0, mk0 = entry_points(e, smp)
        prot = set()
        for t in [c0] + [f for _, f in mk0]:
            if _num(t):
                t = max(0.0, min(res["n"] - 1.0, float(t)))
                prot.update({int(math.floor(t)), int(math.ceil(t))})
        xs["wrist"] = R.sanitize_wrists(res, prot, "all" if cmu_body(e) else "hands")
    if e.get("toes") != "raw":
        xs["toes"] = R.clamp_toes(res)
    res["extremities"] = xs
    act = R.write_action(tgt, cid, res)
    # floor mode: the plan's, else an authored spec's own default (a crouch kick lifts the
    # planted foot, so the body settles onto the rear toes: "plant"), else clamp
    fmode = e.get("floor") or (AU.AUTHORED.get(e.get("file"), {}).get("floor")
                               if e.get("src") == "author" else None) or "clamp"
    fl = floor_fix(tgt, body, act, res, fmode)
    if fl["moved"]:
        act = R.write_action(tgt, cid, res)
    P = R.fk_frames(tgt, res)
    plan = dict(e)
    c_out, mk_out = entry_points(e, smp)
    plan["contact"] = c_out
    plan["effector"] = entry_effector(e)
    plan["_eff_explicit"] = bool(e.get("effector"))
    plan["_eff_cands"] = effector_cands(e)
    m = R.measure(tgt, res, plan, P)
    return res, act, fl, P, m, mk_out


def apply_root_speed(e, lib, tgt, k=1.0):
    """CHANGED(ASSETS3D) (CONTRACT 35.5): plan `rootSpeed` (m/s) + `rootAxis` ("lat" default | "fwd"): the playback
    rate of a travelling loop is set PER BODY so the stripped root travels at exactly that speed on this body (the
    sim moves every fighter at the same m/s; the retarget scales the source's hips travel by the body's hip-height
    ratio, so one fixed `speed` would slide the feet by up to +-15 % across the roster). Works on a mixamo entry or
    on a layer's mixamo LOWER (the travel comes from the lower; the upper is time-warped onto it anyway). The source
    `range` must be a whole number of gait cycles; the output frame count is rounded so the last output frame lands
    exactly on the range end (seamless loop), the achieved speed is within half a frame per cycle of the target.
    Returns (entry with the lower's explicit `speed`, rate record for bake.json) or (entry, None)."""
    want = e.get("rootSpeed")
    if not _num(want):
        return e, None
    e = json.loads(json.dumps(e))
    if e.get("src") == "layer":
        if isinstance(e["layer"]["lower"], str):
            e["layer"]["lower"] = {"src": "mixamo", "file": e["layer"]["lower"]}
        le = e["layer"]["lower"]
    else:
        le = e
    if le.get("src", "mixamo") != "mixamo" or not le.get("range"):
        raise ValueError("rootSpeed needs a mixamo entry (or a layer with a mixamo lower) with an explicit range")
    f0, f1 = float(le["range"][0]), float(le["range"][1])
    smp = R.ClipSampler(lib.ev(le["file"]), le["range"], 1.0, le.get("mirror", False), le.get("cycle"))
    _, h0 = smp.sample(0)
    _, h1 = smp.sample(smp.n - 1)
    ratio = tgt.hip_h / smp.hip_h
    axis = e.get("rootAxis", "lat")
    travel = (-(h1.x - h0.x) if axis == "lat" else -(h1.y - h0.y)) * ratio
    span = f1 - f0
    nat = travel / (span / float(FPS))
    if abs(nat) < 0.05:
        raise ValueError("rootSpeed: source %s travels %.3f m/s along %s - nothing to match" % (le["file"], nat, axis))
    # k (CHANGED(ASSETS3D) rootFrom "feet", second pass): the travel that keeps THIS body's planted feet still is k x
    # the hip-ratio travel (feet_travel_factor); the rate then makes that feet travel run at the target speed
    s = float(want) / (abs(nat) * k)
    nout = max(2, int(round(span / s)) + 1)
    s2 = span / float(nout - 1)
    le["speed"] = s2
    rec = {"target_mps": float(want), "axis": axis, "source": le["file"], "range": le["range"],
           "mirror": bool(le.get("mirror")), "ratio": round(ratio, 4), "travel_m": round(travel * k, 4),
           "natural_mps": round(nat, 4), "feet_k": round(k, 4), "speed": round(s2, 5), "frames": nout,
           "achieved_mps": round(abs(travel * k) / ((nout - 1) / float(FPS)), 4)}
    C.log("ROOT SPEED", e.get("id"), json.dumps(rec))
    return e, rec


def stance_runs(zs, band=0.02, min_len=3):
    """Stance = runs of >= min_len consecutive frames with the point within `band` of its lowest height (a crossover
    swing skims the floor for 1-2 frames: not a plant). Returns [(first, last), ...]."""
    zmin = min(zs)
    n = len(zs)
    runs, k = [], 0
    while k < n:
        if zs[k] < zmin + band:
            j = k
            while j + 1 < n and zs[j + 1] < zmin + band:
                j += 1
            if j - k + 1 >= min_len:
                runs.append((k, j))
            k = j + 1
        else:
            k += 1
    return runs


def feet_travel_factor(tgt, P, res, axis="lat"):
    """CHANGED(ASSETS3D) plan `rootFrom: "feet"` (with rootSpeed): the stripped hips travel is scaled by the body's
    hip-height ratio, but a body whose legs are proportioned differently from the source's plants its feet a few %
    off that travel (measured on the first staged rebake: planted-foot drift per plant bruno -2.6 cm, rerun +3.9 cm,
    johnny +-1.2 cm at 1.8 m/s). k = the ratio of the planted feet's own backward travel (ball of foot, inner frames of
    every stance run, both feet) to the root travel over the same frames. Returns (k, detail) or (None, detail)."""
    n = res["n"]
    rt = [r[1] for r in (res["root_lat"] if axis == "lat" else res["root"])]
    num = den = 0.0
    runs_used = []
    for side in ("Left", "Right"):
        b = C.PFX + side + "ToeBase"
        if b not in P[0]:
            continue
        loc = [P[k_][b].translation for k_ in range(n)]
        for a, z in stance_runs([v.z for v in loc]):
            if z - a < 3:
                continue
            p0, p1 = loc[a + 1], loc[z - 1]
            dl = -(p1.x - p0.x) if axis == "lat" else -(p1.y - p0.y)
            dr = rt[z - 1] - rt[a + 1]
            num += -dl
            den += dr
            runs_used.append([side, a, z, round(dl, 4), round(dr, 4)])
    if abs(den) < 0.05:
        return None, {"runs": runs_used, "why": "root travel over the stance runs < 5 cm"}
    return num / den, {"runs": runs_used}


def foot_slide(tgt, P, res):
    """CHANGED(ASSETS3D): foot slide AT THE AUTHORED SPEED. The GLB keeps the hips above the root, so a foot that
    is planted in the world moves backward in the clip at the root speed; re-adding the stripped travel (clips.json
    `root` forward + `rootLat` lateral) gives each foot's world path. Stance = stance_runs() of the ball of the foot
    (<Side>ToeBase head; also the ankle <Side>Foot head for reference). Per foot: slide = the horizontal world speed
    between consecutive stance frames (0 = planted; touch-down / lift-off pairs included), and the INNER DRIFT of
    each run (2nd -> 2nd-to-last stance frame, lat = + his right / fwd): a wrong loop rate shows up as a lateral
    drift that grows with the run length."""
    n = res["n"]
    fwd = [r[1] for r in res["root"]]
    lat = [r[1] for r in res.get("root_lat") or [[0, 0.0]] * n]
    out = {}
    for side in ("Left", "Right"):
        for pt in ("ToeBase", "Foot"):
            b = C.PFX + side + pt
            if b not in P[0]:
                continue
            w = [P[k][b].translation + Vector((-lat[k], -fwd[k], 0.0)) for k in range(n)]
            runs = stance_runs([v.z for v in w])
            sp, drift = [], []
            for a, z in runs:
                sp += [((w[k + 1] - w[k]).to_2d()).length * FPS for k in range(a, z)]
                if z - a >= 3:
                    d = w[z - 1] - w[a + 1]
                    drift.append([a, z, round(-d.x, 3), round(-d.y, 3)])
            out[side + pt] = {"stance_frames": sum(z - a + 1 for a, z in runs),
                              "slide_mps_mean": round(sum(sp) / len(sp), 3) if sp else None,
                              "slide_mps_max": round(max(sp), 3) if sp else None,
                              "inner_drift": drift}
    return out


def waist_twist(tgt, P):
    """CHANGED(ASSETS3D): yaw between the pelvis line (hip joints) and the shoulder line (upper-arm heads), seen
    from above, per frame (degrees): a layered clip whose lower body is bladed while the guard upper stays square
    twists here (the existing walk_f is the reference on every body)."""
    def yaw(a, b):
        v = P_[C.PFX + b].translation - P_[C.PFX + a].translation
        return math.degrees(math.atan2(v.y, v.x))
    tw = []
    for P_ in P:
        d = yaw("LeftArm", "RightArm") - yaw("LeftUpLeg", "RightUpLeg")
        tw.append((d + 180.0) % 360.0 - 180.0)
    return {"max_abs": round(max(abs(x) for x in tw), 1), "mean": round(sum(tw) / len(tw), 1),
            "min": round(min(tw), 1), "max": round(max(tw), 1)}


AIM_MIN_DEG = 25.0
AIM_MIN_DIST = 0.20


def aim_seq(e, smp, tgt, P):
    """Per-SEGMENT contact aim for a seq clip: each segment with its own contact is turned so its striking
    point (the segment's effector, else the fastest limb in [c-4, c+1]) lands straight ahead, with the same
    thresholds as aim_clip; the xf crossfade then pivots between segments. Measured before: spin
    handspin_clip toe 0.93 m BEHIND the body at contact, windmill_l/m/h foot 0.58 m to the side, krane
    backup_combo hand 0.41 m behind."""
    n = len(P)
    recs = []
    changed = False
    switched = {}
    for i, (x, g) in enumerate(zip(e["seq"], smp.segs)):
        x = norm_entry(x)
        c, _ = entry_points(x, g)
        if not isinstance(c, (int, float)):
            continue
        cf = max(0, min(n - 1, int(round(smp.starts[i] + c))))
        eff = entry_effector(x)
        explicit = bool(eff)
        if not eff:
            hips_all = [Pk[tgt.hips].translation for Pk in P]
            eff = R._fastest(tgt, P, hips_all, n, effector_cands(x), (max(0, cf - 4), min(n - 1, cf + 1)))[0]
        if not eff:
            continue
        v, deg = _aim_vec(tgt, P[cf], eff)
        rec = {"segment": i, "frame": cf, "effector": eff, "deg": round(deg, 1), "dist_m": round(v.length, 3)}
        sw = None if explicit else _hand_switch(tgt, P[cf], eff, deg)
        if sw:
            rec.update({"effector_switch": "%s -> %s" % (eff, sw[0]), "deg_before": rec["deg"]})
            eff, v, deg = sw
            rec.update({"effector": eff, "deg": round(deg, 1), "dist_m": round(v.length, 3)})
            switched[i] = eff
            changed = True
        if v.length >= AIM_MIN_DIST and abs(deg) > AIM_MIN_DEG:
            Rz = R.yaw_to_front(v)
            if isinstance(g, R.LayerSampler):
                # a layered segment turns its UPPER only, like aim_clip (krane backup_combo's run-in legs
                # were turned 143 deg with the whole segment: the fighter ran backward)
                g.up_yaw = Rz
                rec["scope"] = "upper"
            else:
                smp.segs[i] = R.YawSampler(g, Rz)
            rec["aimed"] = True
            changed = True
        recs.append(rec)
    if not changed:
        return None
    smp._off = None
    out = {"deg": max([r["deg"] for r in recs if r.get("aimed")] or [0.0], key=abs), "point": "segments",
           "scope": "segments", "segments": recs, "effector_before": None, "_sampler": smp}
    if switched:
        e2 = dict(e)
        e2["seq"] = [dict(norm_entry(x), effector=switched[i]) if i in switched else x for i, x in enumerate(e["seq"])]
        out["_entry"] = e2
    return out


AIM_SWITCH_DEG = 90.0   # an auto-picked striking hand this far off forward at contact = probably the wrong hand
AIM_SWITCH_OK = 60.0    # ... if the other hand is out in front (within this, >= AIM_MIN_DIST) it is the striker


def _aim_vec(tgt, Pc, eff):
    hips = Pc[tgt.hips].translation
    v = R.eff_point(tgt, Pc, eff)[0] - hips
    v.z = 0.0
    return v, math.degrees(math.atan2(-v.x, -v.y))


def _hand_switch(tgt, Pc, eff, deg):
    """An AUTO-picked hand that is > AIM_SWITCH_DEG off forward at contact while the other hand is out in
    front (<= AIM_SWITCH_OK, >= AIM_MIN_DIST): the other hand strikes (the fastest-limb pick caught the rear
    hand pulling back; krane backup_combo's shield push: LeftHand 0.63 m out at 30 deg, RightHand 0.41 m
    BEHIND - the aim turned the fighter 143 deg to face it). Returns (other, vec, deg) or None."""
    if eff not in ("RightHand", "LeftHand") or abs(deg) <= AIM_SWITCH_DEG:
        return None
    other = "LeftHand" if eff == "RightHand" else "RightHand"
    vo, dego = _aim_vec(tgt, Pc, other)
    if vo.length >= AIM_MIN_DIST and abs(dego) <= AIM_SWITCH_OK:
        return other, vo, dego
    return None


def aim_clip(e, smp, tgt, P, m):
    """CONTACT AIM. In a 2.5D fighter the opponent is always straight ahead, so a strike's effector must
    be in front of the body at contact. Seen from above, from the hips:
      1. the effector point is within AIM_MIN_DEG of forward (or closer than AIM_MIN_DIST) -> no aim;
      2. two-handed moves (other hand >= 0.6x the effector's speed near the contact, or both hands out at
         a similar height) and CMU 'body' grabs use the MID-POINT of the hands: if that is on-line (a
         symmetric spread / slam that already squares up) -> no aim;
      3. otherwise the clip is turned about the vertical so the aim point lands straight ahead: the whole
         clip (YawSampler), or only the UPPER body of a layered strike (the legs keep their own line).
    Measured: bruno storage_slam (goalkeeper dive to the side) turned -76.6 deg, x_fwd 0.39 -> 1.05 m;
    goalpost / freezer_slam (Pro_Magic 2H spells, hands spread +-0.4 m, squared up at contact) and the
    one-hand crouch strike low_forearm stay untouched. Not applied to authored or seq clips nor to entries
    with "aim": false. Returns the aim record (new sampler under '_sampler') or None."""
    src = e.get("src", "mixamo")
    if src == "seq" and e.get("aim") is not False:
        return aim_seq(e, smp, tgt, P)
    if src in ("author", "seq") or e.get("aim") is False:
        return None
    cf = m.get("contact_frame")
    if cf is None or not m.get("effector"):
        return None
    Pc = P[cf]
    hips = Pc[tgt.hips].translation

    def hv(pt):
        v = pt - hips
        v.z = 0.0
        return v, v.length, math.degrees(math.atan2(-v.x, -v.y))   # + = to the model's RIGHT

    eff = m["effector"]["bone"]
    ev, ed, edeg = hv(R.eff_point(tgt, Pc, eff)[0])
    switch = None
    if not e.get("effector"):
        sw = _hand_switch(tgt, Pc, eff, edeg)
        if sw:
            switch = "%s -> %s" % (eff, sw[0])
            eff = sw[0]
            ev, ed, edeg = hv(R.eff_point(tgt, Pc, eff)[0])
    if ed < AIM_MIN_DIST or abs(edeg) <= AIM_MIN_DEG:
        if switch:
            return {"deg": 0.0, "point": eff, "dist_m": round(ed, 3), "scope": "none", "effector_switch": switch,
                    "effector_deg": round(edeg, 1), "effector_before": m["effector"], "_sampler": smp,
                    "_entry": dict(e, effector=eff)}
        return None
    two = src == "cmu" and e.get("kind") in ("body", "getup", None)
    if not two and eff in ("RightHand", "LeftHand"):
        other = "LeftHand" if eff == "RightHand" else "RightHand"
        n = len(P)

        def spd(limb):
            best = 0.0
            for k in range(max(1, cf - 6), min(n - 1, cf + 2) + 1):
                a0, r0 = R.eff_point(tgt, P[k - 1], limb)
                a1, r1 = R.eff_point(tgt, P[k], limb)
                best = max(best, ((a1 - r1) - (a0 - r0)).length * FPS)
            return best
        pe = R.eff_point(tgt, Pc, eff)[0] - hips
        po = R.eff_point(tgt, Pc, other)[0] - hips
        he, ho = Vector((pe.x, pe.y, 0.0)).length, Vector((po.x, po.y, 0.0)).length
        two = spd(other) >= 0.6 * spd(eff) or (ho >= 0.6 * he and ho > 0.3 and abs(pe.z - po.z) < 0.3)
        # a hand BEHIND the body (> 90 deg off forward) is not the second striking hand: krane shield_block's
        # baton hand pulling back 0.46 m behind made the mid-hands point 86 deg sideways and turned the clip
        if two and abs(math.degrees(math.atan2(-po.x, -po.y))) > AIM_SWITCH_DEG:
            two = False
    if two:
        v, dist, deg = hv((R.eff_point(tgt, Pc, "RightHand")[0] + R.eff_point(tgt, Pc, "LeftHand")[0]) * 0.5)
        if dist < AIM_MIN_DIST or abs(deg) <= AIM_MIN_DEG:
            return None
        what = "mid-hands"
    else:
        v, dist, deg = ev, ed, edeg
        what = eff
    Rz = R.yaw_to_front(v)
    if src == "layer":
        smp.up_yaw = Rz
        new = smp
        scope = "upper"
    else:
        new = R.YawSampler(smp, Rz)
        scope = "clip"
    out = {"deg": round(deg, 1), "point": what, "dist_m": round(dist, 3), "scope": scope,
           "effector_deg": round(edeg, 1), "effector_before": m["effector"], "_sampler": new}
    if switch:
        out["effector_switch"] = switch
        out["_entry"] = dict(e, effector=eff)
    return out


def mesh_lowest(body):
    import numpy as np
    deps = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(deps)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3, dtype=np.float32)
    me.vertices.foreach_get("co", co)
    z = co.reshape(-1, 3)[:, 2].min() + ev.matrix_world.translation.z
    ev.to_mesh_clear()
    return float(z)


def floor_fix(tgt, body, act, res, mode):
    """Evaluate the real skinned mesh on every frame. 'clamp': raise the hips wherever the lowest
    vertex is under the floor (different body proportions sink a few cm); 'plant': put the lowest
    vertex exactly on the floor every frame (authored standing clips); 'none': measure only."""
    tgt.arm.animation_data.action = act
    lows = []
    for k in range(res["n"]):
        bpy.context.scene.frame_set(k)
        bpy.context.view_layer.update()
        lows.append(mesh_lowest(body))
    moved = 0
    # 'clamp' also SETTLES a clip that never touches the floor (every frame > +5 mm): the whole clip is
    # lowered by its smallest gap first (measured: johnny overhand, CMU 113_13, floated 7-10 cm on all
    # 27 frames; bruno's ground-locked air normals 3.7 cm). Relative vertical motion is kept.
    settle = -min(lows) if (mode == "clamp" and min(lows) > 0.005) else 0.0
    for k, lo in enumerate(lows):
        dz = 0.0
        if mode == "plant":
            dz = -lo
        elif mode == "clamp":
            dz = settle
            if lo + settle < 0.0:
                dz = -lo
        if abs(dz) > 1e-5:
            res["hips_loc"][k] = res["hips_loc"][k] + tgt.hips_rrest_inv @ Vector((0.0, 0.0, dz))
            moved += 1
    return {"mode": mode, "moved": moved, "settled_m": round(settle, 4),
            "lowest_before": [round(min(lows), 4), round(max(lows), 4)]}


def identity_gate(lib, clip):
    """Retarget a clip onto a transform-applied COPY of its own rig: must reproduce it (< 1e-4)."""
    ev = lib.ev(clip)
    src = ev.arm
    cp = src.copy()
    cp.data = src.data.copy()
    cp.animation_data_clear()
    bpy.context.scene.collection.objects.link(cp)
    bpy.ops.object.select_all(action="DESELECT")
    cp.select_set(True)
    bpy.context.view_layer.objects.active = cp
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    tgt = R.Target(cp)
    smp = R.ClipSampler(ev)
    res = R.retarget(smp, tgt)
    act = R.write_action(tgt, "__identity__", res)
    worst_r, worst_z, who = 0.0, 0.0, None
    step = max(1, smp.n // 10)
    for k in range(0, smp.n, step):
        # source keys live on 1-based source frames, the copy's keys on output frames 0..N-1
        bpy.context.scene.frame_set(int(smp.src_frame(k)))
        bpy.context.view_layer.update()
        A = {b: (ev.m3 @ src.pose.bones[b].matrix.to_3x3()).normalized() for b in tgt.order}
        hz_s = (src.matrix_world @ src.pose.bones[C.PFX + "Hips"].head).z
        bpy.context.scene.frame_set(k)
        bpy.context.view_layer.update()
        for b in tgt.order:
            a = A[b]
            c = cp.pose.bones[b].matrix.to_3x3().normalized()
            err = max(abs(a[i][j] - c[i][j]) for i in range(3) for j in range(3))
            if err > worst_r:
                worst_r, who = err, b
        hz_t = cp.pose.bones[C.PFX + "Hips"].head.z
        worst_z = max(worst_z, abs(hz_s - hz_t))
    C.remove_objects([cp])
    bpy.data.actions.remove(act)
    return {"clip": clip, "worst_rot": worst_r, "bone": who, "worst_hips_z_m": worst_z,
            "ok": worst_r < 1e-4 and worst_z < 1e-4}


def export_glb(arm, body, path, first_action):
    for a in bpy.data.actions:
        a.use_fake_user = True
    arm.animation_data.action = first_action
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.frame_set(0)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    body.select_set(True)
    bpy.context.view_layer.objects.active = arm
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_animations=True,
              export_animation_mode="ACTIONS", export_force_sampling=True, export_frame_range=False,
              export_anim_slide_to_zero=True, export_optimize_animation_size=False,
              export_def_bones=False, export_leaf_bone=False, export_apply=False, export_yup=True,
              export_skins=True, export_morph=False, export_texcoords=True, export_normals=True,
              export_tangents=False, export_image_format="AUTO", export_extras=False,
              export_anim_single_armature=True, export_rest_position_armature=True)
    props = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    dropped = [k for k in kw if k not in props]
    if dropped:
        C.log("exporter ignores", dropped)
    bpy.ops.export_scene.gltf(**{k: v for k, v in kw.items() if k in props})


def main():
    job = json.load(open(sys.argv[sys.argv.index("--") + 1]))
    t0 = time.time()
    fid = job["fighter"]
    C.ensure_dir(job["work_dir"])
    C.reset_scene()
    bpy.context.scene.render.fps = FPS
    arm, body, facts = HB.prepare_body(job["body"], fid, job["work_dir"], int(job.get("atlas", 1024)))
    tgt = R.Target(arm)
    lib = Library(job)
    report = {"fighter": fid, "body": facts, "clips": {}, "errors": [], "gates": {}}
    # X Bot reference hip height (ratio denominator) from the first mixamo clip / X Bot.fbx
    mix_first = None
    for e in job["clips"]:
        if e.get("src", "mixamo") == "mixamo":
            mix_first = e["file"]
            break
    if mix_first:
        g = identity_gate(lib, mix_first)
        report["gates"]["identity"] = g
        C.log("IDENTITY GATE", json.dumps(g))
    fk_checked = False
    order_first = None
    for e in job["clips"]:
        cid = e["id"]
        tc = time.time()
        try:
            e, rate = apply_root_speed(e, lib, tgt)   # CHANGED(ASSETS3D): per-body loop rate (plan rootSpeed)
            smp = build_sampler(e, lib)
            res, act, fl, P, m, mk_out = bake_pass(e, smp, tgt, body, cid)
            aim = aim_clip(e, smp, tgt, P, m)
            if aim:
                smp = aim.pop("_sampler")
                e_b = aim.pop("_entry", None) or e   # effector switched by the aim (auto-picked wrong hand)
                res, act, fl, P, m, mk_out = bake_pass(e_b, smp, tgt, body, cid)
                aim["effector_after"] = m["effector"]
                C.log("AIM", cid, json.dumps(aim))
            if rate and e.get("rootFrom") == "feet":
                # CHANGED(ASSETS3D): second pass at the rate that makes the PLANTED FEET travel at the target speed
                kf, kd = feet_travel_factor(tgt, P, res, rate["axis"])
                if kf is not None and abs(kf - 1.0) > 0.003:
                    e, rate = apply_root_speed(e, lib, tgt, kf)
                    smp = build_sampler(e, lib)
                    res, act, fl, P, m, mk_out = bake_pass(e, smp, tgt, body, cid)
                key = "root_lat" if rate["axis"] == "lat" else "root"
                if kf is not None:
                    res[key] = [[t, round(v * kf, 4)] for t, v in res[key]]
                    k2, kd2 = feet_travel_factor(tgt, P, res, rate["axis"])
                    rate["feet_k_after"] = round(k2, 4) if k2 is not None else None
                rate["feet_k_detail"] = kd
                C.log("ROOT FEET", cid, json.dumps({x: rate[x] for x in ("feet_k", "feet_k_after", "speed", "frames",
                                                                         "achieved_mps") if x in rate}))
            order_first = order_first or act
            n = res["n"]
            marks = {}
            for mk, mf in mk_out:
                marks[mk] = round(max(0.0, min(n - 1.0, mf)) / float(FPS), 4)
            entry = {"dur": round((n - 1) / float(FPS), 4), "frames": n, "contact": m["contact"],
                     "effector": m["effector"], "root": res["root"], "apexY": m["apexY"],
                     "loop": bool(e.get("loop", False))}
            if e.get("rootLat"):
                # CHANGED(ASSETS3D) (CONTRACT 35.5 / 6.3): lateral stripped travel, + = the fighter's own right
                entry["rootLat"] = res["root_lat"]
            if marks:
                entry["marks"] = marks
                # per strike mark effector point (lane FIGHTERS request, CONTRACT 20.6 -> 6.3 marksAt)
                mpts = R.mark_points(tgt, res, P, [(mk, max(0.0, min(n - 1.0, mf))) for mk, mf in mk_out],
                                     (m.get("effector") or {}).get("bone"), effector_cands(e))
                if mpts:
                    entry["marksAt"] = mpts
            report["clips"][cid] = {"clip": entry, "contact_frame": m.get("contact_frame"), "floor": fl, "aim": aim, "effector_note": m.get("effector_note"),
                                    "extremities": res.get("extremities"),
                                    "rate": rate, "slide": foot_slide(tgt, P, res), "twist": waist_twist(tgt, P),
                                    "ratio": round(res["ratio"], 4), "src": e,
                                    "secs": round(time.time() - tc, 2), "trace": effector_trace(tgt, P)}
            if not fk_checked and n > 2:
                fk_err = R.fk_gate(tgt, act, res, [0, n // 2, n - 1])
                report["gates"]["fk_vs_blender_m"] = fk_err
                C.log("FK GATE worst head error m", fk_err)
                fk_checked = True
            C.log("clip", cid, "frames", n, "contact", m["contact"], "eff", m["effector"], "apex", m["apexY"],
                  "root_end", res["root"][-1][1], "%.1fs" % (time.time() - tc))
        except Exception as ex:  # noqa
            report["errors"].append({"clip": cid, "error": repr(ex), "trace": traceback.format_exc()})
            C.log("CLIP FAILED", cid, repr(ex))
            traceback.print_exc()
    lib.release_all()
    # purge every action that is not a clip id (E46: the body's own T-pose action etc.)
    keep = set(report["clips"].keys())
    for a in list(bpy.data.actions):
        if a.name not in keep:
            bpy.data.actions.remove(a)
    C.purge_orphans()
    report["gates"]["actions_in_file"] = sorted(a.name for a in bpy.data.actions)
    report["body_facts"] = dict(R.body_facts(tgt), heightM=facts["heightM"])
    if order_first is not None and keep:
        first = bpy.data.actions.get("idle") or order_first
        export_glb(arm, body, job["raw_glb"], first)
        report["raw_glb_bytes"] = os.path.getsize(job["raw_glb"])
    report["secs"] = round(time.time() - t0, 1)
    with open(job["bake_json"], "w") as fh:
        json.dump(report, fh, indent=1)
    if job.get("save_blend"):
        bpy.ops.wm.save_as_mainfile(filepath=job["save_blend"])
    C.log("BAKE DONE", fid, "clips", len(report["clips"]), "errors", len(report["errors"]), "secs", report["secs"])


if __name__ == "__main__":
    try:
        main()
    except Exception:  # noqa
        traceback.print_exc()
        sys.exit(1)
