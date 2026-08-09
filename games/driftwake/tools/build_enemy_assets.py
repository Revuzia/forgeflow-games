#!/usr/bin/env python
"""
Build the Driftwake enemy asset pack: 30 Meshy bodies + their clip bundles.

WHY THIS TOOL EXISTS
The 30 enemies arrive as two disjoint halves that only this script joins:

  BODIES   F:\\GrokUI\\driftwake_enemies_meshy\\mixamo_rig\\<slug>\\web\\<slug>_draco.glb
           Rigged (mixamorig, 28-52 joints), Draco-compressed, 247-338 KB, ONE
           JPEG base-colour texture, ONE material. VERIFIED 2026-08-07: every one
           of them carries a single animation named "mixamo.com" whose sampler
           input accessor is count=1, max=[0] -- a single keyframe at t=0. The
           bodies are BIND POSE ONLY. There is no motion in them.

  MOTION   F:\\assets\\meshy-characters\\_web_mixamo_pack\\anims\\*.glb  (skeleton-only,
           0 meshes / 0 skins / 66 mixamorig nodes) plus the raw Mixamo FBX packs
           under F:\\games\\forgeflow-games-assets\\_downloaded\\mixamo\\animations\\.

Motion therefore has to be RETARGETED onto each body. Not copied: `blender_retarget.py`
in this same directory documents the measured reason -- a Mixamo clip's bone-local
rotations are deltas from the rig it was authored against, and pasting them by bone
name onto a different auto-rig bends the body (0.51 matrix_local maxdiff on this
project's own hero). Every Meshy body has its own rest pose, so every body needs its
own retarget pass. This is the same lesson `games/colosseum` learned the hard way
("NEVER copy one dir's anim_*.glb to another" -- feet ended up 13-22 cm apart at idle).

STAGES
  meshes   copy the 30 Draco bodies into assets/enemies/, hash-verified, and write
           manifest.json (realm, bytes, joints, engine scale, clip slots, budgets)
  clips    retarget each body's role kit through Blender and emit <slug>_anims.glb
           (skeleton-only, finger tracks stripped, horizontal Hips motion dropped)

Idempotent and resumable: a stage skips any output that already matches its source
hash. `--only <slug>` restricts every stage to one body, which is how the clip stage
is piloted before committing to a 30-body Blender batch.

    python tools/build_enemy_assets.py --stage meshes
    python tools/build_enemy_assets.py --stage clips --only 01_cold_rime_imp
    python tools/build_enemy_assets.py --stage all
"""
import argparse
import ast
import hashlib
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
GAME = os.path.dirname(HERE)
OUT_DIR = os.path.join(GAME, "assets", "enemies")
AUDIT = os.path.join(GAME, "_spec", "_build", "enemy_mesh_audit.json")
CLIP_MAP = os.path.join(GAME, "_spec", "_build", "enemy_clip_map.json")
CLIP_BUILD = os.path.join(HERE, "_clipbuild")
BLENDER_DRIVER = os.path.join(HERE, "blender_enemy_clips.py")

RIG_ROOT = r"F:\GrokUI\driftwake_enemies_meshy\mixamo_rig"
ROSTER_PY = r"F:\GrokUI\driftwake_enemies_meshy\_build_roster_html.py"
BLENDER = r"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe"

# Every body gets these five regardless of role; the role kit adds its attacks.
CORE_ANIMS = ["idle", "walk", "run", "hit", "death"]

# Download budget the runtime is designed around: enemies load PER REALM, never all
# thirty at once, so the number that matters is the worst realm's total -- not 8.4 MB.
REALM_BUDGET_MB = 3.0
# The clip bundles ride on top of the meshes in that same per-realm download, and
# get their own ceiling because they are the half that can be tuned (keyframe
# rate, dropped slots) after the meshes are locked.
CLIP_BUDGET_MB = 2.5


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def glb_json(path):
    """The glTF JSON chunk. Draco geometry is never touched -- everything this
    script needs (skins, animations, images) lives in the JSON chunk."""
    with open(path, "rb") as f:
        magic, ver, _ = struct.unpack("<III", f.read(12))
        if magic != 0x46546C67:
            raise ValueError("not a GLB: " + path)
        clen, _ctype = struct.unpack("<II", f.read(8))
        return json.loads(f.read(clen).decode("utf-8"))


def load_role_kit():
    """ROLE_KIT + the 30 ENEMIES dicts, ast-parsed out of the roster builder.

    The roster builder is the machine-readable source of truth for which clips a
    role needs; importing it would execute its HTML build, so the two literals are
    lifted with `ast` instead."""
    src = open(ROSTER_PY, encoding="utf-8").read()
    tree = ast.parse(src)
    role_kit = enemies = None
    for node in tree.body:
        if not isinstance(node, ast.Assign):
            continue
        name = getattr(node.targets[0], "id", None)
        if name == "ROLE_KIT":
            role_kit = ast.literal_eval(node.value)
        elif name == "ENEMIES":
            # ENEMIES is a list of dict(...) CALLS, not dict literals.
            enemies = [
                {kw.arg: ast.literal_eval(kw.value) for kw in call.keywords}
                for call in node.value.elts
            ]
    if role_kit is None or enemies is None:
        raise RuntimeError("could not lift ROLE_KIT/ENEMIES from " + ROSTER_PY)
    return role_kit, enemies


def clip_slots(role_kit, anim_role):
    """The ordered clip-slot names one role's bodies must carry."""
    kit = role_kit.get(anim_role)
    if not kit:
        raise KeyError("unknown animRole: " + str(anim_role))
    # attacks are (need, mixamo_clip, where, pack) -- the slot name is need[0],
    # normalised to an identifier the runtime can key on.
    slots = [a[0].replace("/", "_").replace(" ", "_") for a in kit["attacks"]]
    # DEDUPE, first occurrence wins on ORDER. The `boss` role's third attack is
    # itself called "death" ("two handed sword death"), which collides with the
    # core death every body gets -- so a naive concat asks for `death` twice and
    # the manifest disagrees with the 7-clip bundle the pipeline actually emits.
    # Only the NAME is deduped here; resolve_clips() still prefers the
    # role-specific SOURCE for a colliding core slot, so a realm boss keeps its
    # greatsword death rather than falling back to the generic one.
    out, seen = [], set()
    for s in CORE_ANIMS + slots:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out


def stage_meshes(only, audit, role_kit, enemies):
    """Copy the 30 Draco bodies in and write manifest.json."""
    os.makedirs(OUT_DIR, exist_ok=True)
    by_slug = {e["slug"]: e for e in enemies}
    aud = audit["enemies"]

    # Existing manifest, so a stage re-run merges instead of overwriting.
    prev = {}
    mpath = os.path.join(OUT_DIR, "manifest.json")
    if os.path.isfile(mpath):
        try:
            prev = json.load(open(mpath, encoding="utf-8")).get("enemies", {})
        except Exception:
            prev = {}

    entries, copied, skipped, failed = {}, 0, 0, []
    for slug in sorted(by_slug):
        if only and slug != only:
            continue
        src = os.path.join(RIG_ROOT, slug, "web", slug + "_draco.glb")
        dst = os.path.join(OUT_DIR, slug + ".glb")
        if not os.path.isfile(src):
            failed.append((slug, "source missing: " + src))
            continue

        src_hash = sha256(src)
        if os.path.isfile(dst) and sha256(dst) == src_hash:
            skipped += 1
        else:
            shutil.copy2(src, dst)
            if sha256(dst) != src_hash:
                failed.append((slug, "copy hash mismatch"))
                continue
            copied += 1

        a = aud.get(slug, {})
        e = by_slug[slug]
        j = glb_json(dst)
        entries[slug] = {
            "mesh": slug + ".glb",
            "bytes": os.path.getsize(dst),
            "sha256": src_hash[:16],
            "realm": a.get("realm") or e.get("realm"),
            "name": e.get("name"),
            "role": e.get("role"),
            "animRole": e.get("animRole"),
            "combatKey": e.get("key"),
            "joints": a.get("joint_count") or len(j.get("skins", [{}])[0].get("joints", [])),
            # Normalises this body to the player's head-above-feet height and then
            # folds in the roster's deliberate size intent (brute 1.45, golem 2.2).
            # The runtime must apply exactly this -- raw Meshy scales differ by 2x.
            "engineScale": a.get("required_engine_scale"),
            "rosterSizeScale": a.get("roster_sizeScale"),
            "aabbHeightM": a.get("aabb_height_m"),
            "textureBytes": a.get("image_total_bytes"),
            "clipSlots": clip_slots(role_kit, e.get("animRole")),
            # Filled by the clips stage; null until then, which is how the runtime
            # knows a body is still bind-pose-only.
            # CARRIED FORWARD, not reset: the two stages write the same manifest,
            # so a plain `None` here made `--stage meshes` silently wipe every
            # clip record the `clips` stage had just written. Re-running a stage
            # must never destroy another stage's output.
            "anims": prev.get(slug, {}).get("anims"),
        }

    realms = {}
    for slug, e in entries.items():
        r = realms.setdefault(e["realm"], {"slugs": [], "meshBytes": 0})
        r["slugs"].append(slug)
        r["meshBytes"] += e["bytes"]
    for r in realms.values():
        r["slugs"].sort()
        r["meshMiB"] = round(r["meshBytes"] / 1048576, 3)
        r["overBudget"] = r["meshMiB"] > REALM_BUDGET_MB

    manifest = {
        "generatedBy": "tools/build_enemy_assets.py",
        "note": ("Bodies are BIND POSE ONLY (one keyframe at t=0). Motion comes from "
                 "<slug>_anims.glb, retargeted per body -- clips are NEVER shared "
                 "between bodies, see blender_retarget.py."),
        "realmBudgetMiB": REALM_BUDGET_MB,
        "count": len(entries),
        "totalMeshBytes": sum(e["bytes"] for e in entries.values()),
        "realms": realms,
        "enemies": entries,
    }
    if not only:
        with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest, f, indent=1)

    print(f"[meshes] copied={copied} unchanged={skipped} failed={len(failed)}")
    for slug, why in failed:
        print(f"  FAIL {slug}: {why}", file=sys.stderr)
    for realm in sorted(realms):
        r = realms[realm]
        flag = "  OVER BUDGET" if r["overBudget"] else ""
        print(f"  {realm:5s} {len(r['slugs'])} bodies  {r['meshMiB']:.3f} MiB{flag}")
    print(f"  total {manifest['totalMeshBytes']/1048576:.3f} MiB across {len(entries)} bodies")
    return 1 if failed else 0


def dedupe(seq):
    """Order-preserving unique. ROLE_KIT lets an attack reuse a core slot name
    (boss lists its own 'death'), so clipSlots can carry the name twice."""
    seen, out = set(), []
    for x in seq:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def resolve_clips(clip_map, anim_role, slots):
    """slot -> the ONE source clip to retarget, out of enemy_clip_map.json.

    A role's resolution list is the five core clips (indices 0-4) followed by the
    role kit's attacks, and a slot can offer several candidates ('boss:heavy_combo'
    resolves five great-sword variants). Rules:
      * a slot named by the role's ATTACK list beats the generic core entry of the
        same name -- that is the whole point of ROLE_KIT's ('death', 'two handed
        sword death') for bosses;
      * otherwise the first candidate wins, which is the role kit's own primary.
    """
    entries = clip_map["resolution"][anim_role]
    head = [e["need"].replace("/", "_").replace(" ", "_") for e in entries[:len(CORE_ANIMS)]]
    if head != CORE_ANIMS:
        raise RuntimeError("role %s: expected core clips first, got %s" % (anim_role, head))
    by_slot = {}
    for i, e in enumerate(entries):
        by_slot.setdefault(e["need"].replace("/", "_").replace(" ", "_"), []).append((i, e))

    out = []
    for s in dedupe(slots):
        cands = by_slot.get(s)
        if not cands:
            raise KeyError("role %s has no resolved clip for slot %r" % (anim_role, s))
        pick = cands[0]
        if s in CORE_ANIMS:
            role_specific = [c for c in cands if c[0] >= len(CORE_ANIMS)]
            if role_specific:
                pick = role_specific[0]
        e = pick[1]
        if not e.get("exists"):
            raise RuntimeError("missing source clip: " + e["resolvedPath"])
        out.append({"slot": s, "path": e["resolvedPath"], "kind": e["kind"],
                    "srcDurationS": e.get("durationS")})
    return out


def input_signature(mesh_path, clips):
    """What the bundle was built FROM. A rebuild is skipped only when this is
    unchanged, which is what makes the stage idempotent without trusting mtimes."""
    h = hashlib.sha256()
    h.update(("mesh:%d|" % os.path.getsize(mesh_path)).encode())
    for c in clips:
        h.update(("%s|%s|%d|" % (c["slot"], c["path"], os.path.getsize(c["path"]))).encode())
    return h.hexdigest()[:16]


def verify_anim_bundle(mesh_path, anim_path, slots):
    """Parse the emitted bundle and prove it is what the runtime expects.

    The load-bearing check is the third one: a channel aimed at a bone the body's
    skin does not contain is a SILENT no-op -- it costs bytes, animates nothing,
    and nothing downstream complains. Everything else here is cheap insurance."""
    body = glb_json(mesh_path)
    skin_joints = {body["nodes"][i].get("name") for i in body["skins"][0]["joints"]}
    doc = glb_json(anim_path)
    names = [n.get("name") for n in doc.get("nodes", ())]
    problems = []

    for key in ("meshes", "skins", "images"):
        if doc.get(key):
            problems.append("%s: %d (want 0)" % (key, len(doc[key])))

    got = [a.get("name") for a in doc.get("animations", ())]
    if got != list(slots):
        problems.append("animation names %s != requested %s" % (got, list(slots)))

    for acc in doc.get("accessors", ()):
        for k in ("min", "max"):
            for v in acc.get(k, ()):
                if not math.isfinite(v):
                    problems.append("non-finite accessor %s: %r" % (k, v))

    per_clip = []
    for a in doc.get("animations", ()):
        bones = {names[c["target"]["node"]] for c in a["channels"]}
        outside = sorted(b for b in bones if b not in skin_joints)
        if outside:
            problems.append("%s targets bones outside the skin: %s" % (a.get("name"), outside))
        paths = sorted({c["target"]["path"] for c in a["channels"]})
        dur = 0.0
        for s in a["samplers"]:
            mx = doc["accessors"][s["input"]].get("max")
            if mx:
                dur = max(dur, float(mx[0]))
        per_clip.append({"name": a.get("name"), "covered": len(bones),
                         "total": len(skin_joints), "channels": len(a["channels"]),
                         "paths": paths, "durationS": round(dur, 4)})

    return {"ok": not problems, "problems": problems, "clips": per_clip,
            "skinJoints": len(skin_joints), "nodes": len(names),
            "bytes": os.path.getsize(anim_path)}


def stage_clips(only, audit, role_kit, enemies):
    """Retarget each body's role kit and emit <slug>_anims.glb.

    Bodies are ordered by animRole so the Blender process imports each of the 49
    source clips once and reuses it across every body that shares the role -- the
    family-A bake is the expensive step (200 frames x 65 bones) and there is no
    reason to pay for it ten times.

    Pilot before batch: `--only 01_cold_rime_imp` then `--only 61_v3_cold_frost_golem`
    bracket the rig variation (46 joints small vs 34 joints, engineScale 2.2).
    """
    manifest_path = os.path.join(OUT_DIR, "manifest.json")
    if not os.path.isfile(manifest_path):
        print("[clips] run --stage meshes first: no " + manifest_path, file=sys.stderr)
        return 2
    manifest = json.load(open(manifest_path, encoding="utf-8"))
    clip_map = json.load(open(CLIP_MAP, encoding="utf-8"))
    by_slug = {e["slug"]: e for e in enemies}

    jobs, skipped, failed = [], [], []
    for slug in sorted(manifest["enemies"]):
        if only and slug != only:
            continue
        ent = manifest["enemies"][slug]
        mesh = os.path.join(OUT_DIR, ent["mesh"])
        try:
            clips = resolve_clips(clip_map, by_slug[slug]["animRole"], ent["clipSlots"])
        except Exception as exc:
            failed.append((slug, "%s: %s" % (type(exc).__name__, exc)))
            continue
        out = os.path.join(OUT_DIR, slug + "_anims.glb")
        sig = input_signature(mesh, clips)
        have = ent.get("anims") or {}
        if os.path.isfile(out) and have.get("inputSig") == sig:
            skipped.append(slug)
            continue
        jobs.append({"slug": slug, "mesh": mesh, "out": out, "sig": sig,
                     "animRole": by_slug[slug]["animRole"], "clips": clips,
                     "slots": [c["slot"] for c in clips]})

    jobs.sort(key=lambda j: (j["animRole"], j["slug"]))
    print("[clips] %d to build, %d unchanged, %d unresolvable"
          % (len(jobs), len(skipped), len(failed)))
    for slug, why in failed:
        print("  FAIL %s: %s" % (slug, why), file=sys.stderr)

    results = {}
    if jobs:
        os.makedirs(CLIP_BUILD, exist_ok=True)
        job_path = os.path.join(CLIP_BUILD, "job.json")
        res_path = os.path.join(CLIP_BUILD, "result.json")
        with open(job_path, "w", encoding="utf-8") as f:
            json.dump({"bodies": jobs}, f, indent=1)
        if os.path.isfile(res_path):
            os.remove(res_path)
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        t0 = time.time()
        rc = subprocess.call([BLENDER, "--background", "--factory-startup",
                              "--python", BLENDER_DRIVER, "--",
                              "--job", job_path, "--result", res_path], env=env)
        print("[clips] blender rc=%d in %.0fs" % (rc, time.time() - t0))
        if not os.path.isfile(res_path):
            print("[clips] blender produced no result file -- see the log above",
                  file=sys.stderr)
            return 2
        for r in json.load(open(res_path, encoding="utf-8"))["bodies"]:
            results[r["slug"]] = r

    # ---- verify + fold into the manifest -----------------------------------
    for j in jobs:
        slug = j["slug"]
        r = results.get(slug, {"ok": False, "error": "blender returned no row"})
        if not r.get("ok"):
            failed.append((slug, r.get("error", "unknown")))
            continue
        v = verify_anim_bundle(j["mesh"], j["out"], j["slots"])
        if not v["ok"]:
            failed.append((slug, "; ".join(v["problems"])))
            continue
        by_slot = {c["slot"]: c for c in r["clips"]}
        manifest["enemies"][slug]["anims"] = {
            "file": slug + "_anims.glb",
            "bytes": v["bytes"],
            "fps": 24,
            "inputSig": j["sig"],
            "rigBones": r["rigBones"],
            "clips": [{"name": c["name"], "durationS": c["durationS"],
                       "bytes": by_slot[c["name"]]["bytes"],
                       "bonesAnimated": c["covered"],
                       "channels": c["channels"],
                       "src": os.path.basename(by_slot[c["name"]]["src"])}
                      for c in v["clips"]],
        }

    realms = {}
    for slug, ent in manifest["enemies"].items():
        a = ent.get("anims")
        r = realms.setdefault(ent["realm"], {"clipBytes": 0, "have": 0, "n": 0})
        r["n"] += 1
        if a:
            r["clipBytes"] += a["bytes"]
            r["have"] += 1
    for realm, r in realms.items():
        r["clipMiB"] = round(r["clipBytes"] / 1048576, 3)
        r["overBudget"] = r["clipMiB"] > CLIP_BUDGET_MB
        manifest["realms"][realm].update(
            {k: r[k] for k in ("clipBytes", "clipMiB", "overBudget")})
        manifest["realms"][realm]["totalMiB"] = round(
            (manifest["realms"][realm]["meshBytes"] + r["clipBytes"]) / 1048576, 3)
    manifest["clipBudgetMiB"] = CLIP_BUDGET_MB
    manifest["totalClipBytes"] = sum(r["clipBytes"] for r in realms.values())
    with open(manifest_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=1)

    print("[clips] built=%d unchanged=%d failed=%d"
          % (len(jobs) - len([1 for s, _ in failed if s in {j['slug'] for j in jobs}]),
             len(skipped), len(failed)))
    for slug, why in failed:
        print("  FAIL %s: %s" % (slug, why), file=sys.stderr)
    for realm in sorted(realms):
        r = realms[realm]
        flag = "  OVER BUDGET" if r["overBudget"] else ""
        print("  %-5s %2d/%2d bodies  clips %.3f MiB  (mesh %.3f + clips = %.3f MiB)%s"
              % (realm, r["have"], r["n"], r["clipMiB"],
                 manifest["realms"][realm]["meshMiB"],
                 manifest["realms"][realm]["totalMiB"], flag))
    print("  total clips %.3f MiB" % (manifest["totalClipBytes"] / 1048576))
    return 1 if failed else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stage", choices=["meshes", "clips", "all"], default="meshes")
    ap.add_argument("--only", default=None, help="restrict to one slug")
    args = ap.parse_args()

    audit = json.load(open(AUDIT, encoding="utf-8"))
    role_kit, enemies = load_role_kit()
    print(f"roster: {len(enemies)} enemies, {len(role_kit)} roles")

    rc = 0
    if args.stage in ("meshes", "all"):
        rc |= stage_meshes(args.only, audit, role_kit, enemies)
    if args.stage in ("clips", "all"):
        rc |= stage_clips(args.only, audit, role_kit, enemies)
    return rc


if __name__ == "__main__":
    sys.exit(main())
