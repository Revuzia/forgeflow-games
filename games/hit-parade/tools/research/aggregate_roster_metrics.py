# HIT PARADE research: merge per-character render metrics into _research/characters/metrics.json
# Usage: python aggregate_roster_metrics.py
import os, json, glob

ROOT = "C:/Users/TestRun/Claude Claw/forgeflow-games/games/hit-parade/_research/characters"
REN = ROOT + "/renders"
CLS = "F:/games/forgeflow-games-assets/_downloaded/mixamo/classification.json"
SRC = "F:/games/forgeflow-games-assets/_downloaded/mixamo/characters"

cls = json.load(open(CLS, encoding="utf-8"))
out = {"generated_by": "tools/research/render_mixamo_roster.py + aggregate_roster_metrics.py",
       "source_dir": SRC, "characters": [], "failures": []}
fbx = sorted(glob.glob(SRC + "/*.fbx"), key=lambda p: os.path.basename(p).lower())
for p in fbx:
    base = os.path.basename(p)
    stem = os.path.splitext(base)[0]
    jp = os.path.join(REN, stem + ".json")
    if not os.path.isfile(jp):
        ep = os.path.join(REN, stem + ".error.txt")
        err = open(ep, encoding="utf-8").read().strip().splitlines()[-1] if os.path.isfile(ep) else "no output"
        out["failures"].append({"file": base, "error": err})
        continue
    m = json.load(open(jp, encoding="utf-8"))
    for t in m.get("textures", []):
        t["filepath"] = os.path.basename(t.get("filepath", "").replace("\\", "/"))
    flags = []
    if m.get("largest_texture_px", 0) >= 4096:
        flags.append("4k_textures")
    if m.get("texture_mb", 0) >= 20:
        flags.append("texture_heavy_%.0fMB" % m["texture_mb"])
    if m.get("broken_textures"):
        flags.append("broken_textures")
    if m.get("triangles", 0) >= 40000:
        flags.append("high_poly_%dk" % round(m["triangles"] / 1000))
    alpha_const = [mm["name"] for mm in m.get("materials", []) if any(f.startswith("alpha_const") for f in mm["flags"])]
    if alpha_const:
        flags.append("alpha_const_materials:" + ",".join(alpha_const))
    untex = [mm["name"] for mm in m.get("materials", []) if "base_color_untextured" in mm["flags"]]
    m["untextured_materials"] = untex
    m["flags"] = flags
    c = cls.get(base, {})
    m["classification_label"] = {k: c.get(k) for k in ("role", "era", "archetype", "visual_description")}
    out["characters"].append(m)

cs = out["characters"]
out["summary"] = {
    "files": len(fbx), "measured": len(cs), "failed": len(out["failures"]),
    "total_texture_mb": round(sum(c["texture_mb"] for c in cs), 1),
    "t_pose": sum(1 for c in cs if c.get("rest_pose") == "T-pose"),
    "a_pose": sum(1 for c in cs if c.get("rest_pose") == "A-pose"),
    "mixamorig": sum(1 for c in cs if c.get("mixamorig_prefix")),
    "with_4k": sum(1 for c in cs if c.get("largest_texture_px", 0) >= 4096),
}
json.dump(out, open(os.path.join(ROOT, "metrics.json"), "w", encoding="utf-8"), indent=1)
print(json.dumps(out["summary"]))
print("failures", out["failures"])
