"""Assemble mixamo_inventory.json + MIXAMO_CLIPS.md from the measured data (no new measurements here).

Usage: python mixamo_build_report.py <work_dir> <out_dir>
Inputs in work_dir: inv_all.json (mixamo_inventory.py), move_map.json (curated), contact_measure.json
(mixamo_contact_measure.py), hands_all.json + specs/selection.json (mixamo_render_sheet.py),
visual_notes.txt. Sheet index from <out_dir>/renders_mixamo/sheets/xbot_index.json.
ASCII only.
"""
import json
import math
import os
import sys
from collections import defaultdict, OrderedDict

W, OUT = sys.argv[1], sys.argv[2]
recs = json.load(open(os.path.join(W, "inv_all.json")))
mm = json.load(open(os.path.join(W, "move_map.json")))["entries"]
cm = json.load(open(os.path.join(W, "contact_measure.json")))
hands = json.load(open(os.path.join(W, "hands_all.json")))
sheet_idx = json.load(open(os.path.join(OUT, "renders_mixamo", "sheets", "xbot_index.json")))

PACK_PREF = ["Pro_Melee_Axe_Pack", "Pro_Magic_Pack", "Soccer_Game_Pack", "Creature_Pack", "Breakdance_Pack",
             "Gestures_Pack_Basic", "Great_Sword_Pack", "Pro_Sword_and_Shield_Pack", "Male_Injured_Pack",
             "Male_Drunk_Pack", "Rifle_8-Way_Locomotion_Pack", "Scary_Zombie_Pack", "Male_Locomotion_Pack"]


def pref(p):
    return PACK_PREF.index(p) if p in PACK_PREF else 100


def cid(pack, clip):
    return (pack + "__" + clip).replace(" ", "_").replace("(", "").replace(")", "")


# ---- duplicates: identical motion signature across packs
def sig(r):
    if "hips" not in r:
        return None
    e = r.get("effectors", {})
    return (r.get("frames"), r["hips"]["z_min"], r["hips"]["path_h"],
            e.get("RightHand", {}).get("peak_speed"), e.get("LeftFoot", {}).get("peak_speed"))


groups = defaultdict(list)
for r in recs:
    s = sig(r)
    if s:
        groups[s].append(r)
dup_of = {}
for s, g in groups.items():
    if len(g) < 2:
        continue
    g.sort(key=lambda r: (pref(r["pack"]), r["pack"], r["clip"]))
    for r in g[1:]:
        dup_of[(r["pack"], r["clip"])] = g[0]["pack"] + "/" + g[0]["clip"]

mm_by = {e["k"]: e for e in mm}
by_pack = OrderedDict()
for r in sorted(recs, key=lambda r: (pref(r["pack"]), r["pack"], r["clip"])):
    k = r["pack"] + "/" + r["clip"]
    r = dict(r)
    r["duplicate_of"] = dup_of.get((r["pack"], r["clip"]))
    c = cid(r["pack"], r["clip"])
    r["render_sheet"] = ("renders_mixamo/sheets/" + sheet_idx[c]) if c in sheet_idx else None
    if c in hands:
        r["hand_distance_m"] = hands[c]
    if k in mm_by:
        e = mm_by[k]
        r["hit_parade"] = {"move": e["move"], "category": e["cat"], "striker": e["striker"],
                           "contact_frames": e["contact"], "contact_source": e["src"],
                           "unarmed": e["unarmed"], "note": e["note"], "contact_measure": cm.get(k)}
    by_pack.setdefault(r["pack"], []).append(r)

n_unique = len(recs) - len(dup_of)
meta = {
    "generated_by": "tools/research/mixamo_inventory.py + mixamo_contact_measure.py + mixamo_render_sheet.py + mixamo_build_report.py",
    "blender": "5.1.2 headless", "source_root": "F:/games/forgeflow-games-assets/_downloaded/mixamo/animations",
    "reference_skeleton": "Pro_Melee_Axe_Pack/X Bot.fbx (65 bones, hips rest 1.0427 m)",
    "units": "metres, seconds, frames are 1-based at the clip fps",
    "axes": "model forward = -Y world (rest toe direction); right = -X world; travel/reach use these model axes",
    "n_pack_dirs": len(by_pack), "n_clips": len(recs), "n_duplicate_clips": len(dup_of), "n_unique_motions": n_unique,
    "fields": {
        "hips.travel_fwd/right": "hips start->end horizontal displacement on model axes (root motion)",
        "hips.z_min/z_max/z_range": "hips world height range over the clip",
        "hips.start_hips_yaw_vs_model_deg": "hips facing at frame 1 vs model forward (side-on stances ~ -50..-58)",
        "effectors.*.peak_speed": "peak speed of that end-effector RELATIVE TO HIPS (m/s) and its frame",
        "hits": "automatic strike candidates (peak speed, then contact = first frame extension stops or speed < 50%); a lead only - see hit_parade.contact_frames for render-judged contacts",
        "loop_pose_err_deg": "max body-bone orientation difference first vs last frame (small = loops cleanly)",
        "location_varying_bones": "bones whose translation fcurves vary (>0.01 cm); every clip carries 195 location fcurves",
        "rest_rot_maxdiff_vs_xbot": "clip armature bind vs X Bot.fbx bind (0.0169 on RightHandThumb3 for all 610 X Bot clips)",
        "hand_distance_m": "min/median/max distance between hand bones over the clip (rendered clips only); 2H weapon grip keeps it < 0.25 m",
        "hit_parade": "curated move proposal + render-judged contact frames + contact_measure (reach/side/height at contact, model axes)",
    },
}
inv = {"meta": meta,
       "packs": {p: {"n_clips": len(v), "n_duplicates": sum(1 for r in v if r["duplicate_of"]), "clips": v}
                 for p, v in by_pack.items()}}
json.dump(inv, open(os.path.join(OUT, "mixamo_inventory.json"), "w"), indent=1)

# ---------------------------------------------------------------- markdown
rec_by = {(r["pack"] + "/" + r["clip"]): r for r in recs}
CAT_ORDER = [("attack-light", "Light strikes"), ("attack-heavy", "Heavy strikes"), ("kick", "Kicks"),
             ("knee", "Knees"), ("attack-aoe", "Slams, sweeps, spins (AoE)"),
             ("grab-throw", "Grabs, shoves, throws, pick-ups"), ("weapon-1H", "One-handed prop moves (pipe)"),
             ("weapon-2H", "Two-handed prop moves (bat / sledgehammer)"), ("react", "Hit reactions"),
             ("block", "Blocks"), ("knockdown", "Knockdowns / KOs"), ("downed", "Downed states"),
             ("getup", "Getups"), ("evade", "Evades"), ("state", "Idles and HP states"),
             ("taunt", "Taunts (ratings)"), ("locomotion", "Locomotion"), ("npc", "Host / NPC gestures")]


def fmt_contact(e):
    """judged contact (render) with its strike direction, and the measured front-pass frame + reach."""
    k = e["k"]
    if not e["contact"]:
        return "-", "-", "-", "-"
    ms = cm.get(k, [])
    judged, front, reach = [], [], []
    for i, f in enumerate(e["contact"]):
        m = ms[i] if i < len(ms) else {}
        d = ""
        if "reach_fwd" in m:
            d = " %+.0f deg" % math.degrees(math.atan2(m["side"], m["reach_fwd"]))
        judged.append("f%d (%.2fs)%s" % (f, m.get("t", float("nan")), d))
        if "front_frame" in m:
            front.append("f%d (%.2fs)" % (m["front_frame"], m["front_t"]))
            reach.append("%.2f/%+.2f/%.2f, %+.0f deg" % (m["front_reach_fwd"], m["front_side"], m["front_height"],
                                                     math.degrees(math.atan2(m["front_side"], m["front_reach_fwd"]))))
        else:
            front.append("-")
            reach.append("-")
    return "<br>".join(judged), "<br>".join(front), (e["striker"] or "-"), "<br>".join(reach)


rec_by0 = {(r["pack"] + "/" + r["clip"]): r for r in recs}
lines = []
A = lines.append
A("# HIT PARADE - Mixamo clip inventory + move mapping")
A("")
A("Lane: animations/mixamo. Status: COMPLETE. Every number below is measured (Blender 5.1.2 headless) or")
A("read off a render I inspected this session; the machine-readable version is `mixamo_inventory.json`.")
A("Rig transfer (can these clips go on the character bodies?) is answered in `rig_compat.md`.")
A("")
A("## What is in the folder (measured)")
A("")
A("- **%d clips in %d pack dirs**, all 30 fps. **%d are exact duplicates** of a clip in another pack (same frames," % (len(recs), len(by_pack), len(dup_of)))
A("  hips path and effector speeds), so there are **%d distinct motions**. Duplicate sets: Magic_Locomotion_Pack and" % n_unique)
A("  Magic_Spell_Pack are subsets of Pro_Magic_Pack; Sword_and_Shield_Pack = Pro_Sword_and_Shield_Pack minus 2 draw")
A("  clips; Creature_NPC_Pack is a subset of Creature_Pack; Shooter_Pack shares 7 clips with Basic_Shooter_Pack;")
A("  Extra/WithSkin share one breathing idle and Extra holds the skateboard clip twice (skin / no skin).")
A("- **610 clips are on the X Bot skeleton** (65 bones; bind identical to `X Bot.fbx` except one thumb bone, maxdiff")
A("  0.0169). `Extra/` (6) and `WithSkin/` (12) use a different 41-bone rig with the hips rest at z=0 - not X Bot.")
A("- **All 610 X Bot clips carry 195 location + 260 rotation + 195 scale fcurves** (65 bones; counted by")
A("  `mixamo_fcurve_count.py`), but only `Hips` translation varies (627 of 628 clips; `WithSkin/falling_idle_ws70`")
A("  has none). Strip the 64 constant location tracks (and scale tracks) before three.js, or the clip imposes X Bot's")
A("  bone lengths on other bodies (see rig_compat.md).")
A("- **Stances are side-on.** Hips yaw at frame 1 vs the model's forward axis: Pro_Magic idle -58.3 deg, sword & shield")
A("  idle -54.5 deg, axe idle -50.1 deg; Male_Locomotion idle -5.2, mutant idle 0.0. So reach below is measured on the")
A("  MODEL axes (forward = rest toe direction), which is what an auto-facing controller turns toward the target.")
A("- **Root motion** is in the hips track (hips travel columns). Locomotion and many attacks travel; e.g.")
A("  `Creature_Pack/jump attack` moves the hips %.2f m forward, `Soccer_Game_Pack/throw in` %.2f m." % (
    rec_by0["Creature_Pack/jump attack"]["hips"]["travel_fwd"], rec_by0["Soccer_Game_Pack/throw in"]["hips"]["travel_fwd"]))
A("")
A("## Method")
A("")
A("1. `mixamo_inventory.py` samples every integer frame of every clip: timing, hips travel/height, loop error, and the")
A("   speed of hands/feet/knees/elbows/head RELATIVE TO THE HIPS. Automatic contact = the fastest end-effector's")
A("   speed peak, then the first frame it stops extending or drops below 50% of peak; a foot peak with the knee bent")
A("   under 100 deg is re-labelled a knee strike (that is how `kneeing soccerball` came out as `LeftKnee` f13).")
A("2. 209 clips were rendered on the X Bot mesh (6 frames each, contact frames boxed) into")
A("   `renders_mixamo/sheets/xbot_00..34.png`, and 16 ambiguous ones again at 1-4 frame spacing")
A("   (`renders_mixamo/sheets/dense_00..03.png`). I read every sheet; the contact frames in the table are the")
A("   render-judged ones; the Source column says where the automatic pick was wrong.")
A("3. `mixamo_contact_measure.py` then measured the striking part at each judged frame AND scanned frames")
A("   [judged-8, judged+3] for the **front pass**: the frame where the striker is farthest in front of the hips on the")
A("   model forward axis. Sweeping strikes cross the front BEFORE the visible end of the motion: `mutant punch` is a")
A("   right-to-left hook whose fist is 0.62 m in front at f9 (+6 deg) but 68 deg to the LEFT at the judged f11.")
A("   **Use the front-pass frame to time hitboxes for a target straight ahead** (strikes, kicks, knees, swings);")
A("   use the judged frame for floor impacts (slams, ground pound) and releases (throws). Reach is in metres on")
A("   the X Bot (hips 1.04 m): multiply by the body's hip ratio (rig_compat.md).")
A("")
A("Columns: **contact** = render-judged frame (time from clip start) and the strike direction there, degrees from")
A("model forward (+ right, - left). **front pass** = measured frame the striker is farthest forward. **reach** =")
A("forward/side/height of the striker at the front pass, metres, + its direction. **travel** = hips start->end on")
A("model axes (fwd/right). **unarmed**: yes / prop (reads as a held-prop move) / no (weapon or shield pose baked in).")
A("")
A("## Move-mapping table")
for cat, title in CAT_ORDER:
    es = [e for e in mm if e["cat"] == cat]
    if not es:
        continue
    A("")
    A("### " + title)
    A("")
    A("| HIT PARADE move | clip | dur s (frames) | contact (render-judged), dir | front pass (measured) | striker | at front pass: reach fwd/side/height m, dir | travel m fwd/right | hips z range m | unarmed | source / notes |")
    A("|---|---|---|---|---|---|---|---|---|---|---|")
    for e in es:
        r = rec_by.get(e["k"])
        if r is None:
            continue
        cf, fp, st, rc = fmt_contact(e)
        h = r["hips"]
        note = e["src"] + ("; " + e["note"] if e["note"] else "")
        dup = dup_of.get((r["pack"], r["clip"]))
        if dup:
            note += "; duplicate of " + dup
        A("| %s | `%s` | %.2f (%d) | %s | %s | %s | %s | %+.2f / %+.2f | %.2f-%.2f | %s | %s |" % (
            e["move"], e["k"], r["duration_s"], r["frames"], cf, fp, st, rc,
            h["travel_fwd"], h["travel_right"], h["z_min"], h["z_max"], e["unarmed"], note))

# weapon flags
A("")
A("Prop reach: for hand-held props the reach column is the KNUCKLES; add the prop length (a bat or pipe adds")
A("roughly its own length along the forearm direction) when sizing weapon hitboxes.")
A("")
A("## Weapon-pose flags (held-weapon pose baked in)")
A("")
gs = [(k.split("__", 1)[1], v) for k, v in hands.items() if k.startswith("Great_Sword_Pack__")]
gs_2h = [x for x in gs if x[1]["frac_below_0p25m"] >= 0.89]
meds = sorted(v["median"] for _, v in gs_2h)
A("- **Great_Sword_Pack = two-handed grip, measured.** In %d of %d rendered clips the hands stay within 0.25 m of each" % (len(gs_2h), len(gs)))
A("  other on >= 89%% of frames (median hand distance %.3f-%.3f m). Unarmed they read as clasped fists; use them only" % (meds[0], meds[-1]))
A("  with a 2H prop (bat, pipe, sledgehammer). The 2 deaths are the exceptions (grip breaks as the body falls).")
A("- **Pro_Sword_and_Shield_Pack**: idle, block, crouch block, impact hold the LEFT forearm flat in front (shield); not")
A("  unarmed. Its attacks are right-hand 1H swings (pipe); its kick, power up, impact (2) and deaths are usable unarmed.")
A("- **Pro_Melee_Axe_Pack**: `standing *` clips are axe-armed (right fist curled as a grip, swings carry axe weight);")
A("  the idle is not unarmed. The single swings read as big haymaker / hammer-fist / backfist / spin arm swings")
A("  unarmed (rendered); the combos read as prop strings. `unarmed *` clips are relaxed unarmed locomotion.")
A("- **Rifle_8-Way deaths** start in a rifle-carry pose for ~10 frames (both forearms forward): crossfade in after it.")
A("- **Basic_Shooter hit reaction**: rifle hold throughout - unusable. Rifle/pistol/bow locomotion packs and")
A("  Action_Adventure/Shooter were measured (JSON) but not rendered or mapped: not needed for a melee brawler.")
A("- **Weak but usable**: soccer `header` (head moves only 1.14 m/s), soccer `kick soccerball` / `kick up` (small")
A("  taps), Gestures_Pack_Basic (all 15 are head-nod / hand-flick scale - fine for host cutaways, invisible in combat).")
A("")
lie = json.load(open(os.path.join(W, "lying.json")))
lie1 = json.load(open(os.path.join(W, "lying_first.json")))
A("## Locomotion speeds (measured, X Bot scale)")
A("")
A("Pro_Magic stance locomotion is **4-way** (Walk/Run Forward, Back, Left, Right + Sprint Forward): no diagonals, so an")
A("8-way lock-on strafe needs blending. Speed = hips horizontal path / duration; loop = first-vs-last pose error.")
A("")
A("| clip | dur s | travel fwd/right m | speed m/s | loop err deg |")
A("|---|---|---|---|---|")
for e in mm:
    if e["cat"] != "locomotion":
        continue
    r = rec_by0.get(e["k"])
    if not r or r["duration_s"] <= 0:
        continue
    h = r["hips"]
    A("| `%s` | %.2f | %+.2f / %+.2f | %.2f | %.1f |" % (e["k"], r["duration_s"], h["travel_fwd"], h["travel_right"],
                                                      h["path_h"] / r["duration_s"], r.get("loop_pose_err_deg", float("nan"))))
A("")
A("## Chains that line up (measured end/start poses)")
A("")
A("Lying orientation = chest-forward vector at the last (or first) frame, from `mixamo_lying_check.py`:")
A("")
A("- **Knockdown -> downed -> getup (face-down chain):** `soccer trip` ends chest-z %+.2f / hips %.2f m, `fallen idle`" % (
    lie["Soccer_Game_Pack/soccer trip"]["chest_fwd_z"], lie["Soccer_Game_Pack/soccer trip"]["hips_z_end"]))
A("  loops at chest-z %+.2f / hips %.2f m, and `standing up` STARTS at chest-z %+.2f / hips %.2f m: one continuous chain." % (
    lie["Soccer_Game_Pack/fallen idle"]["chest_fwd_z"], lie["Soccer_Game_Pack/fallen idle"]["hips_z_end"],
    lie1["Soccer_Game_Pack/standing up@first"]["chest_fwd_z"], lie1["Soccer_Game_Pack/standing up@first"]["hips_z_end"]))
A("  Face-down KOs that can feed it: React Death Forward, React Death Right, S&S death (2), zombie dying, rifle back /")
A("  crouching headshot.")
A("- **Face-up KOs have NO matching getup in these packs** (React Death Backward/Left, mutant dying, both 2H deaths,")
A("  S&S death, zombie death, rifle front headshot all end chest-up). Use them as final KOs for enemies, or source a")
A("  face-up getup elsewhere (cmu_pilot lane / another Mixamo download).")
A("- **Spinning sweep:** `flair (3)` (stand -> flair) -> `flair (2)` loop (first/last pose error %.1f deg) -> `flair` (exit to" % (
    rec_by0["Breakdance_Pack/flair (2)"]["loop_pose_err_deg"]))
A("  stand by f75).")
A("- **Block:** Pro_Magic `Block Start` -> `Block Idle` (loop error %.1f deg) -> `Block React Large` -> `Block End`." % (
    rec_by0["Pro_Magic_Pack/Standing Block Idle"]["loop_pose_err_deg"]))
A("- **Reacts return to the Pro_Magic stance** (side-on, hips %.1f deg from model forward), not to a square boxing idle:" % (
    rec_by0["Pro_Magic_Pack/standing idle"]["hips"]["start_hips_yaw_vs_model_deg"]))
A("  either make `Pro_Magic_Pack/standing idle` the fighting idle or crossfade ~0.2 s out of every react.")
fz = ["breakdance freeze var 1", "breakdance freeze var 2", "breakdance freeze var 3", "breakdance freeze var 4", "breakdance freezes"]
A("- **Showboat freezes** return to the toprock pose SHAPE (renders) but turn and travel on the way (measured net hips")
A("  yaw / travel fwd,right m): " + "; ".join("%s %+.0f deg / %+.2f,%+.2f" % (
    c.replace("breakdance ", ""), rec_by0["Breakdance_Pack/" + c]["hips"]["net_yaw_deg"],
    rec_by0["Breakdance_Pack/" + c]["hips"]["travel_fwd"], rec_by0["Breakdance_Pack/" + c]["hips"]["travel_right"]) for c in fz) + ".")
A("  Apply their root yaw/travel (or re-face the model) before chaining them. `flair (2)` turns exactly %+.0f deg per loop" % (
    rec_by0["Breakdance_Pack/flair (2)"]["hips"]["net_yaw_deg"]))
A("  with %.2f m travel." % rec_by0["Breakdance_Pack/flair (2)"]["hips"]["travel_h"])
A("")
A("## Contact picks the automatic detector got wrong (fixed by renders)")
A("")
wrong = [e for e in mm if e["src"].startswith("dense render") or "pick is" in e["src"] or "not the strike" in e["src"]
         or "END of the hook" in e["src"] or "(dropped)" in e["src"]]
for e in wrong:
    cf = ("contact f" + ",".join(str(x) for x in e["contact"])) if e["contact"] else "hitbox active through the loop"
    A("- `%s`: %s -> %s" % (e["k"], e["src"], cf))
A("")
A("## Front pass vs judged frame (>= 3 frames apart: time the hitbox on the front pass)")
A("")
A("| clip | judged frame, dir | front pass frame | reach fwd m at front pass |")
A("|---|---|---|---|")
for e in mm:
    for i, m in enumerate(cm.get(e["k"], [])):
        if "front_frame" in m and "reach_fwd" in m and abs(m["front_frame"] - m["frame"]) >= 3:
            A("| `%s` | f%d, %+.0f deg | f%d | %.2f |" % (e["k"], m["frame"], math.degrees(math.atan2(m["side"], m["reach_fwd"])),
                                                      m["front_frame"], m["front_reach_fwd"]))
A("")
A("## Pack overview")
A("")
A("| pack dir | clips | duplicates | duration range s | rendered | notes |")
A("|---|---|---|---|---|---|")
for p, v in by_pack.items():
    ds = [r["duration_s"] for r in v if "duration_s" in r]
    nren = sum(1 for r in v if r["render_sheet"])
    ndup = sum(1 for r in v if r["duplicate_of"])
    note = ""
    if p in ("Extra", "WithSkin"):
        note = "41-bone non-X Bot rig"
    A("| %s | %d | %d | %.2f-%.2f | %d | %s |" % (p, len(v), ndup, min(ds), max(ds), nren, note))
A("")
A("## Files")
A("")
A("- `mixamo_inventory.json` - every clip: timing, hips, effectors, automatic hits, loop error, duplicates, render sheet,")
A("  hand distance, and the `hit_parade` block for mapped clips.")
A("- `renders_mixamo/sheets/xbot_NN.png` (35 sheets, 209 clips) + `dense_NN.png` (4 sheets) - X Bot contact sheets.")
A("- `renders_mixamo/proof/` - rig-transfer proof (see rig_compat.md).")
A("- Scripts: `tools/research/mixamo_inventory.py`, `mixamo_render_sheet.py`, `mixamo_montage.py`,")
A("  `mixamo_build_specs.py`, `mixamo_contact_measure.py`, `mixamo_build_report.py`, `mixamo_rig_compat.py`,")
A("  `mixamo_rig_proof.py`, `mixamo_proof_montage.py`, `mixamo_proof_compare.py`, `mixamo_proof_diff.py`.")
open(os.path.join(OUT, "MIXAMO_CLIPS.md"), "w").write("\n".join(lines) + "\n")
print("inventory clips", len(recs), "dups", len(dup_of), "unique", n_unique, "mapped", len(mm))
