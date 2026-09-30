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
        key = json.dumps([e["file"], rng, speed, bool(e.get("mirror")), e.get("fist", 75), e.get("face"),
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
            s, t = int(rng[0]), int(rng[1])
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
        return R.ClipSampler(lib.ev(e["file"]), e.get("range"), e.get("speed", 1.0), e.get("mirror", False))
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
    opts = {"air": e.get("air"), "loopBlend": e.get("loopBlend", 0)}
    res = R.retarget(smp, tgt, opts)
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
    for i, (x, g) in enumerate(zip(e["seq"], smp.segs)):
        x = norm_entry(x)
        c, _ = entry_points(x, g)
        if not isinstance(c, (int, float)):
            continue
        cf = max(0, min(n - 1, int(round(smp.starts[i] + c))))
        eff = entry_effector(x)
        if not eff:
            hips_all = [Pk[tgt.hips].translation for Pk in P]
            eff = R._fastest(tgt, P, hips_all, n, effector_cands(x), (max(0, cf - 4), min(n - 1, cf + 1)))[0]
        if not eff:
            continue
        hips = P[cf][tgt.hips].translation
        v = R.eff_point(tgt, P[cf], eff)[0] - hips
        v.z = 0.0
        deg = math.degrees(math.atan2(-v.x, -v.y))
        rec = {"segment": i, "frame": cf, "effector": eff, "deg": round(deg, 1), "dist_m": round(v.length, 3)}
        if v.length >= AIM_MIN_DIST and abs(deg) > AIM_MIN_DEG:
            smp.segs[i] = R.YawSampler(g, R.yaw_to_front(v))
            rec["aimed"] = True
            changed = True
        recs.append(rec)
    if not changed:
        return None
    smp._off = None
    return {"deg": max((r["deg"] for r in recs if r.get("aimed")), key=abs), "point": "segments",
            "scope": "segments", "segments": recs, "effector_before": None, "_sampler": smp}


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
    if ed < AIM_MIN_DIST or abs(edeg) <= AIM_MIN_DEG:
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
    return {"deg": round(deg, 1), "point": what, "dist_m": round(dist, 3), "scope": scope,
            "effector_deg": round(edeg, 1), "effector_before": m["effector"], "_sampler": new}


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
            smp = build_sampler(e, lib)
            res, act, fl, P, m, mk_out = bake_pass(e, smp, tgt, body, cid)
            aim = aim_clip(e, smp, tgt, P, m)
            if aim:
                smp = aim.pop("_sampler")
                res, act, fl, P, m, mk_out = bake_pass(e, smp, tgt, body, cid)
                aim["effector_after"] = m["effector"]
                C.log("AIM", cid, json.dumps(aim))
            order_first = order_first or act
            n = res["n"]
            marks = {}
            for mk, mf in mk_out:
                marks[mk] = round(max(0.0, min(n - 1.0, mf)) / float(FPS), 4)
            entry = {"dur": round((n - 1) / float(FPS), 4), "frames": n, "contact": m["contact"],
                     "effector": m["effector"], "root": res["root"], "apexY": m["apexY"],
                     "loop": bool(e.get("loop", False))}
            if marks:
                entry["marks"] = marks
            report["clips"][cid] = {"clip": entry, "contact_frame": m.get("contact_frame"), "floor": fl, "aim": aim, "effector_note": m.get("effector_note"),
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
