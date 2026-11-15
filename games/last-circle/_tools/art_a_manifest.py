#!/usr/bin/env python3
"""art_a_manifest.py - write assets/chars/clips/manifest.json (clip list, sizes, durations, and for the seven Mixamo deaths the
end-pose facts the PLAYER lane needs to pick a fall by hit direction). Pure FK on the soldier rest skeleton (same numbers the
browser probe measures: hips start/end agree to <1 mm).  Rig space: +Y up, character faces +Z, +X = character's left.
  python art_a_manifest.py
"""
import sys, os, json, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from art_a_glbinfo import load, acc
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLIPS = os.path.join(ROOT, "assets/chars/clips")
SHARED = ["idle", "walk", "run", "death", "hit", "dance", "cheer", "jump", "swim", "crouch",
          "rifle_idle", "rifle_walk", "rifle_run", "rifle_reload", "rifle_crouch"]
DEATHS = ["death_front", "death_front_head", "death_back", "death_back_head", "death_right", "death_crouch_head", "death_walking"]

def qmul(a, b):
    ax, ay, az, aw = a; bx, by, bz, bw = b
    return np.array([aw*bx+ax*bw+ay*bz-az*by, aw*by-ax*bz+ay*bw+az*bx, aw*bz+ax*by-ay*bx+az*bw, aw*bw-ax*bx-ay*by-az*bz])
def qinv(q): return np.array([-q[0], -q[1], -q[2], q[3]])
def qrot(q, v): return qmul(qmul(q, np.append(v, 0.0)), qinv(q))[:3]
def sample(t, v, x):
    if x >= t[-1]: return v[-1]
    if x <= t[0]: return v[0]
    i = np.searchsorted(t, x) - 1; a = (x - t[i]) / (t[i+1] - t[i]); p, q = v[i], v[i+1]
    if v.shape[1] == 4:
        if np.dot(p, q) < 0: q = -q
        r = p * (1 - a) + q * a; return r / np.linalg.norm(r)
    return p * (1 - a) + q * a

def skeleton():
    js, _ = load(os.path.join(ROOT, "assets/chars/meshy/soldier_rifle_idle.glb"))
    nodes = js["nodes"]; par = {}
    for i, n in enumerate(nodes):
        for c in n.get("children", []): par[c] = i
    names = [n["name"].replace(":", "") for n in nodes]
    order = []
    def rec(i): order.append(i); [rec(c) for c in nodes[i].get("children", [])]
    for r in js["scenes"][0]["nodes"]: rec(r)
    return nodes, par, names, order

def pose_at(path, x, sk):
    nodes, par, names, order = sk
    js, b = load(path); a = js["animations"][0]; tr = {}
    for ch in a["channels"]:
        nm = js["nodes"][ch["target"]["node"]]["name"].replace(":", ""); s = a["samplers"][ch["sampler"]]
        tr[(nm, ch["target"]["path"])] = (acc(js, b, s["input"]), acc(js, b, s["output"]))
    dur = max(t[0][-1] for t in tr.values())
    x = dur if x is None else x
    W = {}
    for i in order:
        nm = names[i]
        t = np.array(nodes[i].get("translation", [0, 0, 0]), float); q = np.array(nodes[i].get("rotation", [0, 0, 0, 1]), float)
        if (nm, "translation") in tr: t = sample(*tr[(nm, "translation")], x)
        if (nm, "rotation") in tr: q = sample(*tr[(nm, "rotation")], x)
        if i in par: pq, pp = W[par[i]]; W[i] = (qmul(pq, q), pp + qrot(pq, t))
        else: W[i] = (q, t)
    return {names[i]: W[i] for i in W}, dur

def main():
    sk = skeleton(); out = {"about": "ART-A clip manifest. Rig space: +Y up, character faces +Z, +X = character's left. Heights in metres above the feet origin (soldier rig).", "clips": {}}
    for c in SHARED + DEATHS:
        p = os.path.join(CLIPS, c + ".glb"); e = {"bytes": os.path.getsize(p), "kind": "death" if c in DEATHS else "shared"}
        if c in DEATHS:
            P0, dur = pose_at(p, 0.0, sk); P1, _ = pose_at(p, None, sk)
            hips0 = P0["mixamorigHips"][1]; hips1 = P1["mixamorigHips"][1]; head1 = P1["mixamorigHead"][1]
            chest = qrot(P1["mixamorigSpine2"][0], np.array([0, 0, 1.0]))   # chest "front" direction at the end
            rel = head1 - hips1; heading = math.degrees(math.atan2(rel[0], rel[2]))
            fy = float(chest[1])
            e.update(duration=round(dur, 3), hipsStartY=round(float(hips0[1]), 3), hipsEndY=round(float(hips1[1]), 3),
                     startPose="crouch" if hips0[1] < 0.6 else ("walking" if c == "death_walking" else "standing"),
                     endChestFrontY=round(fy, 2), endLying="face-down" if fy < -0.45 else ("face-up" if fy > 0.45 else "on-side"),
                     headHeadingDeg=round(heading, 0),
                     headHeading="forward(+Z)" if abs(heading) < 45 else ("backward(-Z)" if abs(heading) > 135 else ("left(+X)" if heading > 0 else "right(-X)")),
                     source="Mixamo (Adobe), royalty-free in games; baked clip only")
        out["clips"][c] = e
    # measured by _harness/new/art_a_clips.py (real skinned vertices on the real skins): lowest vertex y at the start and end of each death clip
    rep = os.path.join(ROOT, "_harness", "_reports", "art_a_clips.json")
    if os.path.isfile(rep):
        probe = json.load(open(rep)).get("probe", {}).get("skins", {})
        for c in DEATHS:
            sink = {}
            for skin, R in probe.items():
                r = R.get("deaths", {}).get(c)
                if r and r.get("minVertEnd") is not None:
                    sink[skin] = {"start": round(r["minVertStart"], 3), "end": round(r["minVertEnd"], 3)}
            out["clips"][c]["lowestVertexY"] = sink
        out["lowestVertexY_about"] = "metres relative to the actor origin (feet = 0). The standing start differs by skin (-0.11..+0.05, the same for every shipped clip: the clips carry the soldier's 1.0179 m hips height); the lying end pose sinks 0.06-0.18 m below y=0 on every skin, like the shipped 'death' clip (-0.08..-0.21). A corpse lift of ~0.10 m would sit it on the ground."
    json.dump(out, open(os.path.join(CLIPS, "manifest.json"), "w"), indent=1)
    for c in DEATHS: print(c, {k: out["clips"][c][k] for k in ("duration", "hipsStartY", "hipsEndY", "startPose", "endLying", "endChestFrontY", "headHeading", "headHeadingDeg")})
main()
