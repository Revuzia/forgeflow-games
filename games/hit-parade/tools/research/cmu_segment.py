"""Mine CMU BVH takes for fighting moves: detect strikes / getups / falls,
segment them into single-move windows, classify by geometry, rate quality.

Usage:  python cmu_segment.py <out_dir> [take ...]
Writes <out_dir>/cmu_segments_auto.json (+ per-take event traces).
All numbers are measured from the BVH via bvh_lib FK (Blender Z-up metres).
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bvh_lib as B  # noqa: E402

DATA = "F:/games/forgeflow-games-assets/_downloaded/cmu-mocap/cmu-mocap-master/data"

STRIKE_TAKES = [
    "02_05", "13_17", "13_18", "14_01", "14_02", "14_03", "15_13", "17_10", "79_08", "80_10",
    "56_03", "56_04", "56_05", "56_06", "86_01", "86_02", "86_03", "86_04", "86_05", "86_06",
    "86_08", "111_19", "113_13", "141_14", "143_23", "143_24", "144_05", "144_06", "144_09",
    "144_10", "144_13", "144_14", "144_20", "144_21", "76_01", "76_02", "74_03", "74_04",
    "74_05", "74_06", "75_16", "90_05", "90_06", "90_07", "87_01", "88_04", "88_06",
    "135_01", "135_02", "135_03", "135_04", "135_05", "135_06", "135_07", "135_09", "135_10",
    "135_11", "15_04", "15_05",
]
DUPLICATES = {"77_16": "139_16", "77_17": "139_17", "77_18": "139_18",
              "105_59": "91_59"}  # byte-identical files (md5 checked 2026-09-29)
GROUND_TAKES = [
    "111_06", "111_07", "111_08", "139_16", "139_17", "139_18", "140_01", "140_02", "140_03",
    "140_04", "140_08", "140_09", "113_08", "114_02", "114_11",
    "90_16", "90_17", "90_18", "85_15", "90_12", "90_13", "88_04", "111_12", "111_21",
]


def take_path(take):
    s = take.split("_")[0]
    return "%s/%03d/%s.bvh" % (DATA, int(s), take)


def smooth(x, win):
    """Centered moving average along axis 0 (edge-padded)."""
    if win <= 1:
        return x
    k = np.ones(win) / win
    pad = win // 2
    xp = np.concatenate([np.repeat(x[:1], pad, 0), x, np.repeat(x[-1:], win - 1 - pad, 0)], 0)
    out = np.apply_along_axis(lambda v: np.convolve(v, k, mode="valid"), 0, xp)
    return out


def hdir(v):
    v = np.array(v, dtype=float)
    v[..., 2] = 0.0
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-9)


def yaw_of(v):
    return np.arctan2(v[..., 1], v[..., 0])


def unwrap_deg(a):
    return np.degrees(np.unwrap(a))


def angle_between(a, b):
    na = np.linalg.norm(a, axis=-1)
    nb = np.linalg.norm(b, axis=-1)
    c = np.sum(a * b, -1) / np.maximum(na * nb, 1e-9)
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


class Take(object):
    def __init__(self, take):
        self.take = take
        d = B.load_blender(take_path(take))
        self.fps = d["fps"]
        p = d["pos"].copy()
        r = d["rot"].copy()
        # frame 0 of every Hahne file is a T-pose calibration frame: never use it
        p[0] = p[1]
        r[0] = r[1]
        self.raw = p
        self.rot = r
        self.I = d["idx"]
        self.rest = d["rest"]
        self.n = p.shape[0]
        win = max(3, int(round(self.fps / 24.0)))  # ~42 ms
        self.p = smooth(p, win)
        self.dt = 1.0 / self.fps
        self.v = np.gradient(self.p, self.dt, axis=0)
        I = self.I
        feet = [I[n] for n in ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase",
                               "LeftToeBase_End", "RightToeBase_End")]
        self.floor = float(np.percentile(self.raw[1:, feet, 2].min(1), 2))
        rest = self.rest
        self.leg_len = float(np.linalg.norm(rest[I["LeftUpLeg"]] - rest[I["LeftLeg"]]) +
                             np.linalg.norm(rest[I["LeftLeg"]] - rest[I["LeftFoot"]]))
        self.arm_len = float(np.linalg.norm(rest[I["LeftArm"]] - rest[I["LeftForeArm"]]) +
                             np.linalg.norm(rest[I["LeftForeArm"]] - rest[I["LeftHand"]]) +
                             np.linalg.norm(rest[I["LeftHand"]] - rest[I["LeftHandIndex1_End"]]))
        self.stand_h = self.leg_len + 0.07
        # facing (hips) and chest facing
        self.hips_fwd = hdir(np.einsum("fij,j->fi", self.rot[:, I["Hips"]], [0, -1, 0]))
        self.chest_fwd3 = np.einsum("fij,j->fi", self.rot[:, I["Spine1"]], [0, -1, 0])
        self.hips_yaw = unwrap_deg(yaw_of(self.hips_fwd))
        sh = self.p[:, I["LeftArm"]] - self.p[:, I["RightArm"]]
        # shoulder-line facing: left x up -> forward
        self.sh_fwd = hdir(np.cross(sh, np.array([0, 0, 1.0])))
        self.sh_yaw = unwrap_deg(yaw_of(self.sh_fwd))
        self.hip_z = self.p[:, I["Hips"], 2] - self.floor
        self.hip_hspeed = np.linalg.norm(smooth(self.v[:, I["Hips"], :2], int(self.fps / 4)), axis=1)
        main = [I[n] for n in I if not (n.endswith("_End") or "Thumb" in n or "Finger" in n or "Index" in n)]
        self.main = main
        self.body_speed = np.mean(np.linalg.norm(self.v[:, main] - 0 * self.v[:, [I["Hips"]]], axis=2), axis=1)

    # ---------- helpers
    def rel_speed(self, j):
        I = self.I
        return np.linalg.norm(self.v[:, I[j]] - self.v[:, I["Hips"]], axis=1)

    def P(self, j, f=None):
        if f is None:
            return self.p[:, self.I[j]]
        return self.p[f, self.I[j]]

    def pops(self, s, e):
        """Frames where a main joint sits >3 cm off its 5-frame median (raw data):
        a single-frame spike, not fast-but-smooth motion."""
        s = max(3, s)
        e = min(self.n - 3, e)
        if e <= s:
            return 0
        x = self.raw[s - 2:e + 3, self.main]
        st = np.stack([x[k:k + (e - s + 1)] for k in range(5)], 0)
        med = np.median(st, axis=0)
        dev = np.linalg.norm(x[2:2 + (e - s + 1)] - med, axis=2)
        return int(np.sum(dev.max(1) > 0.03))

    def foot_slide(self, s, e):
        """Planted-foot drift in cm: for each run of >=8 frames where the foot's
        lowest point is within 3 cm of that foot's floor, the horizontal path
        length of the stiller of ankle/toe. Returns the max over runs."""
        I = self.I
        worst = 0.0
        for side in ("Left", "Right"):
            ids = [I[side + "Foot"], I[side + "ToeBase"], I[side + "ToeBase_End"]]
            low_all = self.raw[1:, ids, 2].min(1)
            ffloor = np.percentile(low_all, 2)
            lo = self.raw[s:e + 1, ids, 2].min(1) - ffloor
            planted = lo < 0.03
            k = 0
            m = len(planted)
            while k < m:
                if planted[k]:
                    j = k
                    while j < m and planted[j]:
                        j += 1
                    if j - k >= 8:
                        best = 1e9
                        for jid in ids[:2]:
                            xy = self.raw[s + k:s + j, jid, :2]
                            best = min(best, float(np.sum(np.linalg.norm(np.diff(xy, axis=0), axis=1))))
                        worst = max(worst, best)
                    k = j
                else:
                    k += 1
        return round(worst * 100.0, 1)


# ------------------------------------------------------------------ strikes
def detect_strikes(T):
    I = T.I
    fps = T.fps
    events = []
    limbs = [("L", "hand"), ("R", "hand"), ("L", "foot"), ("R", "foot"), ("L", "knee"), ("R", "knee")]
    for side, kind in limbs:
        S = "Left" if side == "L" else "Right"
        if kind == "hand":
            eff = S + "HandIndex1_End"
            root = S + "Arm"
            thr = 2.2
            length = T.arm_len
        elif kind == "foot":
            eff = S + "Foot"
            root = S + "UpLeg"
            thr = 3.0
            length = T.leg_len
        else:
            eff = S + "Leg"  # knee joint
            root = S + "UpLeg"
            thr = 1.8
            length = T.leg_len
        sp = T.rel_speed(eff)
        ext = np.linalg.norm(T.P(eff) - T.P(root), axis=1) / length
        # peaks
        cand = np.where((sp[1:-1] > sp[:-2]) & (sp[1:-1] >= sp[2:]) & (sp[1:-1] > thr))[0] + 1
        # keep strongest peak per 0.3 s window
        cand = sorted(cand, key=lambda i: -sp[i])
        taken = []
        for c in cand:
            if all(abs(c - t) > 0.3 * fps for t in taken):
                taken.append(c)
        for pk in sorted(taken):
            if pk < int(0.3 * fps) or pk > T.n - int(0.3 * fps):
                continue
            if T.hip_hspeed[pk] > 2.0:
                continue  # running
            lo = max(1, pk - int(0.03 * fps))
            hi = min(T.n - 1, pk + int(0.3 * fps))
            if kind == "knee":
                kz = T.P(eff)[lo:hi, 2] - T.P("Hips")[lo:hi, 2]
                ct = lo + int(np.argmax(kz))
            elif kind == "foot":
                hd = np.linalg.norm((T.P(eff)[lo:hi] - T.P("Hips")[lo:hi])[:, :2], axis=1)
                fz = T.P(eff)[lo:hi, 2] - T.floor
                ct = lo + int(np.argmax(hd + 0.5 * fz))
            else:
                ct = lo + int(np.argmax(ext[lo:hi]))
            # windup start: walk back until speed quiet
            quiet = max(0.5, 0.15 * sp[pk])
            cap = int((0.6 if kind == "hand" else 1.0) * fps)
            s = pk
            while s > max(1, pk - cap) and sp[s] > quiet:
                s -= 1
            s = min(s, ct - 3)
            # recovery end: forward from contact until quiet again after the return
            cap2 = int((0.8 if kind == "hand" else 1.2) * fps)
            e = ct + int(0.08 * fps)
            ret_peak_seen = False
            while e < min(T.n - 2, ct + cap2):
                if sp[e] > quiet * 1.5:
                    ret_peak_seen = True
                if ret_peak_seen and sp[e] < quiet:
                    break
                e += 1
            # --- refined boundaries (v2): guard-to-guard for hands, planted-to-planted for legs
            s_v1 = s  # the filters keep using the v1 (quiet-speed) windup start
            if kind == "hand":
                # nearest guard (extension minimum) before/after contact, with
                # hysteresis: stop once extension climbs 3% of arm length above
                # the running minimum (a per-frame tolerance walks up slow slopes)
                k = ct - max(2, int(0.04 * fps))
                best = k
                lim = max(1, ct - int(0.5 * fps))
                while k > lim:
                    k -= 1
                    if ext[k] < ext[best]:
                        best = k
                    elif ext[k] > ext[best] + 0.03:
                        break
                s = best if best < ct - 3 else s
                k = ct + max(2, int(0.04 * fps))
                best = k
                lim = min(T.n - 2, ct + int(0.6 * fps))
                while k < lim:
                    k += 1
                    if ext[k] < ext[best]:
                        best = k
                    elif ext[k] > ext[best] + 0.03:
                        break
                e = best if best > ct + 3 else e
            else:
                ids = [T.I[S + "Foot"], T.I[S + "ToeBase"], T.I[S + "ToeBase_End"]]
                low = T.raw[:, ids, 2].min(1)
                ffl = np.percentile(low[1:], 2)
                planted = (low - ffl) < 0.035
                k = ct
                lim = max(1, ct - int(1.5 * fps))
                while k > lim and not planted[k]:
                    k -= 1
                if planted[k] and k < ct - 3:
                    s = k
                k = ct
                lim = min(T.n - 2, ct + int(1.5 * fps))
                while k < lim and not planted[k]:
                    k += 1
                if planted[k] and k > ct + 3:
                    e = k
            events.append({"side": side, "kind": kind, "peak": int(pk), "start": int(s),
                           "contact": int(ct), "end": int(e), "peak_speed": round(float(sp[pk]), 2),
                           "ext_contact": round(float(ext[ct]), 3), "ext_start": round(float(ext[s_v1]), 3),
                           "start_v1": int(s_v1)})
    return filter_events(T, events)


def filter_events(T, events):
    """Drop non-strikes: retractions (no extension gain), steps (low foot),
    knee rises that are really the chamber of a kick; dedupe overlaps."""
    fps = T.fps
    keep = []
    for ev in events:
        gain = ev["ext_contact"] - ev["ext_start"]
        if ev["kind"] == "hand":
            S = "Left" if ev["side"] == "L" else "Right"
            el = T.P(S + "ForeArm", ev["contact"])
            elbow_led = (T.rel_speed(S + "ForeArm")[ev["peak"]] > 0.8 * ev["peak_speed"])
            if gain < 0.10:
                if not elbow_led:
                    continue
                sh = T.P(S + "Arm", ev["contact"])
                wr = T.P(S + "Hand", ev["contact"])
                ang = float(angle_between(sh - el, wr - el))
                ch0 = T.P("Spine1", ev.get("start_v1", ev["start"]))
                ch1 = T.P("Spine1", ev["contact"])
                out0 = np.linalg.norm((T.P(S + "ForeArm", ev.get("start_v1", ev["start"])) - ch0)[:2])
                out1 = np.linalg.norm((el - ch1)[:2])
                if ang > 80 or out1 - out0 < 0.08:
                    continue
        elif ev["kind"] == "foot":
            S = "Left" if ev["side"] == "L" else "Right"
            O = "Right" if ev["side"] == "L" else "Left"
            fh = T.P(S + "Foot", ev["contact"])[2] - T.floor
            sup = min(T.P(O + "Foot", ev["contact"])[2], T.P(O + "ToeBase", ev["contact"])[2]) - T.floor
            if fh < 0.30 and sup < 0.12:
                continue
            hd0 = np.linalg.norm((T.P(S + "Foot", ev["contact"]) - T.P("Hips", ev["contact"]))[:2])
            if sup >= 0.20 and (fh < 0.45 or hd0 < 0.45):
                continue  # hop / jump, not a jump kick
            hd = np.linalg.norm((T.P(S + "Foot", ev["contact"]) - T.P("Hips", ev["contact"]))[:2])
            if hd < 0.30 and sup < 0.12:
                continue
        if ev["kind"] == "hand":
            S = "Left" if ev["side"] == "L" else "Right"
            eff = S + "HandIndex1_End"
            s1 = ev.get("start_v1", ev["start"])
            h0 = np.linalg.norm((T.P(eff, s1) - T.P("Spine1", s1))[:2])
            h1 = np.linalg.norm((T.P(eff, ev["contact"]) - T.P("Spine1", ev["contact"]))[:2])
            ev["reach_h_m"] = round(float(h1), 3)
            ev["reach_gain_m"] = round(float(h1 - h0), 3)
            elbow_ok = ev.get("elbow_led_ok", False)
            if (h1 < 0.24 or h1 - h0 < 0.08) and gain >= 0.10:
                continue
        keep.append(ev)
    # knee events: drop when the same leg throws a foot kick within 0.3 s
    out = []
    for ev in keep:
        if ev["kind"] == "knee":
            clash = [f for f in keep if f["kind"] == "foot" and f["side"] == ev["side"]
                     and abs(f["contact"] - ev["contact"]) < 0.35 * fps]
            if clash:
                continue
            S = "Left" if ev["side"] == "L" else "Right"
            kz = T.P(S + "Leg", ev["contact"])[2] - T.P("Hips", ev["contact"])[2]
            if kz < -0.18:
                continue
        out.append(ev)
    # dedupe same-limb overlaps (keep the faster)
    out.sort(key=lambda e: -e["peak_speed"])
    final = []
    for ev in out:
        dup = False
        for f in final:
            if f["side"] == ev["side"] and f["kind"] == ev["kind"]:
                ov = min(f["end"], ev["end"]) - max(f["start"], ev["start"])
                if ov > 0.5 * min(f["end"] - f["start"], ev["end"] - ev["start"]):
                    dup = True
                    break
        if not dup:
            final.append(ev)
    final.sort(key=lambda e: e["contact"])
    return final


def target_dirs(T, events):
    """Per hand event: the fighter's target line = mean horizontal chest->fist
    direction at contact of all near-straight punches (elbow >= 135 deg)
    within +/-3 s. Stored on the event as 'target_dir'."""
    fps = T.fps
    atts = []
    for ev in events:
        if ev["kind"] != "hand":
            continue
        S = "Left" if ev["side"] == "L" else "Right"
        c = ev["contact"]
        sh, el, wr = T.P(S + "Arm", c), T.P(S + "ForeArm", c), T.P(S + "Hand", c)
        ang = float(angle_between(sh - el, wr - el))
        a = hdir(T.P(S + "HandIndex1_End", c) - T.P("Spine1", c))
        if ang >= 135:
            atts.append((c, a))
    for ev in events:
        if ev["kind"] != "hand":
            continue
        near = [a for (c, a) in atts if abs(c - ev["contact"]) <= 3 * fps]
        if near:
            m = np.mean(near, axis=0)
            ev["target_dir"] = hdir(m)
        else:
            ev["target_dir"] = T.hips_fwd[ev["start"]]


def take_lead(T, f, tdir):
    """Lead side from the feet along the TARGET LINE, median over +/-0.5 s:
    > +8 cm left foot ahead -> 'L', < -8 cm -> 'R', else None (square)."""
    fps = T.fps
    a = max(1, f - int(0.5 * fps))
    b = min(T.n - 1, f + int(0.5 * fps))
    d = T.P("LeftFoot")[a:b] - T.P("RightFoot")[a:b]
    proj = d @ tdir
    m = float(np.median(proj))
    if m > 0.08:
        return "L", m
    if m < -0.08:
        return "R", m
    return None, m


def stance_frame(T, f, attack_dir=None):
    fwd = attack_dir if attack_dir is not None else T.hips_fwd[f]
    fwd = hdir(fwd)
    left = np.array([-fwd[1], fwd[0], 0.0])
    return fwd, left


def classify_strike(T, ev):
    I = T.I
    fps = T.fps
    s, c, e = ev["start"], ev["contact"], ev["end"]
    side = ev["side"]
    S = "Left" if side == "L" else "Right"
    O = "Right" if side == "L" else "Left"
    out = {}
    notes = []
    if ev["kind"] == "hand":
        eff = S + "HandIndex1_End"
        chest = T.P("Spine1", c)
        att = hdir(T.P(eff, c) - chest)
        if np.linalg.norm(T.P(eff, c)[:2] - chest[:2]) < 0.08:
            att = T.hips_fwd[s]
        fwd, left = stance_frame(T, s, att)
        k0 = max(s, c - int(0.05 * fps))
        dv = T.P(eff, c) - T.P(eff, k0) - (T.P("Hips", c) - T.P("Hips", k0))
        vn = np.linalg.norm(dv) + 1e-9
        v_f = float(np.dot(dv, fwd) / vn)
        v_l = float(np.dot(dv, left) / vn)
        v_z = float(dv[2] / vn)
        sh = T.P(S + "Arm", c)
        el = T.P(S + "ForeArm", c)
        wr = T.P(S + "Hand", c)
        elbow_ang = float(angle_between(sh - el, wr - el))
        # path straightness (hip-relative) start->contact
        rel = T.P(eff)[s:c + 1] - T.P("Hips")[s:c + 1]
        chord = np.linalg.norm(rel[-1] - rel[0])
        plen = np.sum(np.linalg.norm(np.diff(rel, axis=0), axis=1)) + 1e-9
        straight = float(chord / plen)
        dz = float(T.P(eff, c)[2] - T.P(eff, s)[2])
        h_rel_sh = float(T.P(eff, c)[2] - sh[2])
        h_rel_chest = float(T.P(eff, c)[2] - chest[2])
        el_sp = float(np.max(T.rel_speed(S + "ForeArm")[s:c + 1]))
        lead, lead_m = take_lead(T, s, ev.get("target_dir", T.hips_fwd[s]))
        rot = float(abs(T.sh_yaw[c] - T.sh_yaw[s]))
        # class
        ext_gain = ev["ext_contact"] - ev["ext_start"]
        cls = None
        if elbow_ang < 75 and el_sp > 0.8 * ev["peak_speed"] and ev["ext_contact"] < 0.6:
            cls = "elbow"
        elif v_z < -0.65:
            cls = "hammer_chop"
        elif v_z > 0.6 and dz > 0.1 and elbow_ang < 150:
            cls = "uppercut"
        elif elbow_ang < 140 and abs(v_l) > 0.5:
            cls = "hook"
        elif elbow_ang >= 140 or straight > 0.85:
            if lead is None:
                cls = "straight_%s" % side
                notes.append("square stance: lead/rear undecidable (shoulder rot %.0f deg)" % rot)
            else:
                cls = "jab" if side == lead else "cross"
        else:
            cls = "hook" if abs(v_l) > 0.35 else "punch_other"
        if cls in ("jab", "cross", "hook", "straight_L", "straight_R") and h_rel_chest < -0.12:
            notes.append("contact below chest -> body blow (%s path)" % cls)
            cls = "body_blow"
        if ext_gain < 0.08 and cls not in ("elbow", "hammer_chop"):
            notes.append("low extension gain %.2f" % ext_gain)
        out.update({"limb": side + "_hand", "attack_dir_deg": round(float(np.degrees(np.arctan2(att[1], att[0]))), 1),
                    "v_fwd": round(v_f, 2), "v_lat": round(v_l, 2), "v_up": round(v_z, 2),
                    "elbow_deg": round(elbow_ang, 1), "straightness": round(straight, 2),
                    "rise_m": round(dz, 3), "h_rel_shoulder_m": round(h_rel_sh, 3),
                    "h_rel_chest_m": round(h_rel_chest, 3), "lead": lead, "lead_feet_m": round(lead_m, 3), "shoulder_rot_deg": round(rot, 1),
                    "ext_gain": round(ext_gain, 3)})
    else:
        eff = S + ("Foot" if ev["kind"] == "foot" else "Leg")
        fwd, left = stance_frame(T, s)
        k0 = max(s, c - int(0.05 * fps))
        dv = T.P(eff, c) - T.P(eff, k0) - (T.P("Hips", c) - T.P("Hips", k0))
        vn = np.linalg.norm(dv) + 1e-9
        v_f = float(np.dot(dv, fwd) / vn)
        v_l = float(np.dot(dv, left) / vn)
        v_z = float(dv[2] / vn)
        yaw_turn = float(T.hips_yaw[c] - T.hips_yaw[s])
        yaw_span = float(np.max(T.hips_yaw[s:c + 1]) - np.min(T.hips_yaw[s:c + 1]))
        rel = T.P(eff)[s:c + 1] - T.P("Hips")[s:c + 1]
        chord = np.linalg.norm(rel[-1] - rel[0])
        plen = np.sum(np.linalg.norm(np.diff(rel, axis=0), axis=1)) + 1e-9
        straight = float(chord / plen)
        support = O + "ToeBase"
        sup_h = float(min(T.P(O + "Foot", c)[2], T.P(support, c)[2]) - T.floor)
        foot_h = float(T.P(S + "Foot", c)[2] - T.floor)
        knee_h_rel = float(T.P(S + "Leg", c)[2] - T.P("Hips", c)[2])
        radial = T.P(S + "Foot", c) - T.P(S + "UpLeg", c)
        rad_cos = float(np.dot(dv, radial) / (vn * np.linalg.norm(radial) + 1e-9))
        ext = float(np.linalg.norm(radial) / T.leg_len)
        # angle of the kick direction vs hips facing at contact
        kick_h = hdir(radial)
        hf = T.hips_fwd[c]
        side_ang = float(angle_between(kick_h, hf))
        hip_h = float(T.hip_z[c])
        if ev["kind"] == "knee":
            cls = "knee" if (knee_h_rel > -0.18 and ext < 0.8) else "knee_low"
        elif abs(yaw_span) > 150:
            cls = "spin_kick"
        elif sup_h > 0.20:
            cls = "jump_kick"
        elif ext < 0.72 and knee_h_rel > -0.15:
            cls = "knee"
        elif side_ang > 65 and rad_cos > 0.25:
            cls = "side_kick"
        elif abs(v_l) >= 0.5 and (abs(yaw_turn) > 40 or straight < 0.8):
            cls = "roundhouse"
        elif side_ang <= 50:
            cls = "front_kick"
        else:
            cls = "kick_other"
        if foot_h < 0.35 and cls not in ("knee", "knee_low", "jump_kick"):
            notes.append("low contact (foot %.2f m)" % foot_h)
        out.update({"limb": side + ("_foot" if ev["kind"] == "foot" else "_knee"),
                    "v_fwd": round(v_f, 2), "v_lat": round(v_l, 2), "v_up": round(v_z, 2),
                    "yaw_turn_deg": round(yaw_turn, 1), "yaw_span_deg": round(yaw_span, 1),
                    "straightness": round(straight, 2), "support_foot_h_m": round(sup_h, 3),
                    "foot_h_m": round(foot_h, 3), "knee_rel_hips_m": round(knee_h_rel, 3),
                    "radial_cos": round(rad_cos, 2), "leg_ext": round(ext, 2),
                    "kick_vs_hips_deg": round(side_ang, 1), "hip_h_m": round(hip_h, 3)})
    out["class"] = cls
    out["notes"] = notes
    return out


# ------------------------------------------------------------------ ground
def detect_ground(T):
    fps = T.fps
    h = T.hip_z
    low = h < 0.33
    stand = h > 0.78 * T.stand_h
    segs = []
    n = T.n
    # getups: low -> stand
    i = 1
    while i < n:
        if low[i]:
            j = i
            while j < n and not stand[j]:
                j += 1
            if j >= n:
                break
            # last low frame before j
            k = j
            while k > i and not low[k]:
                k -= 1
            # start: go back from k while body is moving, cap 3 s
            s = k
            while s > max(1, k - int(3.0 * fps)) and T.body_speed[s] > 0.12:
                s -= 1
            # end: settle after reaching stand
            e = j
            while e < min(n - 2, j + int(2.0 * fps)) and T.body_speed[e] > 0.18:
                e += 1
            cf = T.chest_fwd3[s]
            cz = float(cf[2] / (np.linalg.norm(cf) + 1e-9))
            if cz > 0.45:
                cls = "getup_back"
            elif cz < -0.45:
                cls = "getup_front"
            else:
                cls = "getup_side_or_sit"
            segs.append({"kind": "getup", "start": int(s), "contact": int(k), "end": int(e),
                         "class": cls, "chest_up_at_start": round(cz, 2),
                         "hip_h_start_m": round(float(h[s]), 3)})
            # skip to after this standing
            i = j + 1
            while i < n and not low[i]:
                i += 1
        else:
            i += 1
    # falls: stand -> low
    i = 1
    while i < n:
        if stand[i]:
            j = i
            while j < n and not low[j]:
                j += 1
            if j >= n:
                break
            k = j
            while k > i and not stand[k]:
                k -= 1
            # start: 0.35 s before leaving stand band, or where hips vertical vel ~0
            s = max(1, k - int(0.5 * fps))
            e = j
            while e < min(n - 2, j + int(2.0 * fps)) and T.body_speed[e] > 0.15:
                e += 1
            e = min(e, j + int(2.0 * fps))
            cf = T.chest_fwd3[min(n - 1, j + int(0.3 * fps))]
            cz = float(cf[2] / (np.linalg.norm(cf) + 1e-9))
            fall_time = (j - k) / fps
            if cz < -0.45:
                cls = "fall_forward"
            elif cz > 0.45:
                cls = "fall_backward"
            else:
                cls = "fall_side_or_sitdown"
            segs.append({"kind": "fall", "start": int(s), "contact": int(j), "end": int(e),
                         "class": cls, "chest_up_after_m": round(cz, 2),
                         "drop_time_s": round(fall_time, 2)})
            i = j + 1
            while i < n and not stand[i]:
                i += 1
        else:
            i += 1
    return segs


def run(takes_strike, takes_ground):
    out = []
    for take in takes_strike:
        try:
            T = Take(take)
        except Exception as ex:  # noqa
            print("FAIL", take, ex)
            continue
        evs = detect_strikes(T)
        target_dirs(T, evs)
        for ev in evs:
            info = classify_strike(T, ev)
            seg = {"take": take, "fps": round(T.fps, 3), "start": ev["start"], "contact": ev["contact"],
                   "end": ev["end"], "kind": ev["kind"], "peak_speed_ms": ev["peak_speed"],
                   "ext_contact": ev["ext_contact"], "foot_drift_cm": T.foot_slide(ev["start"], ev["end"]),
                   "pops": T.pops(ev["start"], ev["end"]),
                   "hips_hspeed_ms": round(float(T.hip_hspeed[ev["contact"]]), 2)}
            # combo contamination: peak speed (rel. hips) of the OTHER hand inside the window
            O = "Right" if ev["side"] == "L" else "Left"
            oth = T.rel_speed(O + "HandIndex1_End")[ev["start"]:ev["end"] + 1]
            seg["other_hand_peak_ms"] = round(float(oth.max()), 2) if len(oth) else 0.0
            if "reach_h_m" in ev:
                seg["reach_h_m"] = ev["reach_h_m"]
                seg["reach_gain_m"] = ev["reach_gain_m"]
            seg.update(info)
            out.append(seg)
        print(take, "n=%d fps=%.0f floor=%.3f strikes=%d" % (T.n, T.fps, T.floor, len(evs)))
    for take in takes_ground:
        try:
            T = Take(take)
        except Exception as ex:  # noqa
            print("FAIL", take, ex)
            continue
        segs = detect_ground(T)
        for sg in segs:
            sg.update({"take": take, "fps": round(T.fps, 3), "limb": "body",
                       "foot_drift_cm": T.foot_slide(sg["start"], sg["end"]),
                       "pops": T.pops(sg["start"], sg["end"]), "notes": []})
            out.append(sg)
        print(take, "n=%d ground segs=%d  hip_z min %.2f max %.2f" % (T.n, len(segs), T.hip_z.min(), T.hip_z.max()))
    return out


if __name__ == "__main__":
    od = sys.argv[1]
    takes = sys.argv[2:]
    if takes:
        st = [t for t in takes if t in STRIKE_TAKES or not t in GROUND_TAKES]
        gr = [t for t in takes if t in GROUND_TAKES]
    else:
        st, gr = STRIKE_TAKES, GROUND_TAKES
    segs = run(st, gr)
    os.makedirs(od, exist_ok=True)
    with open(os.path.join(od, "cmu_segments_auto.json"), "w") as fh:
        json.dump(segs, fh, indent=1)
    from collections import Counter
    print(Counter(s["class"] for s in segs))
