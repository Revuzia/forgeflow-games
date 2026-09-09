# -*- coding: utf-8 -*-
"""Merge the VERIFY pass's re-measured verdicts into _replay_verdicts.json.

Only the 31 distinct rows this pass actually drove are touched; every other row
keeps the verdict and evidence the pass that measured it wrote.
"""
import io, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VF = os.path.join(HERE, "_playreports", "_replay_verdicts.json")
L1 = json.load(open(os.path.join(HERE, "_playreports", "_vf_locks.json")))
L2 = json.load(open(os.path.join(HERE, "_playreports", "_vf_locks2.json")))
D1 = json.load(open(os.path.join(HERE, "_playreports", "_vf_deaths.json")))
D2 = json.load(open(os.path.join(HERE, "_playreports", "_vf_deaths2.json")))


def ev(*srcs):
    out = []
    for src, key in srcs:
        if key in src:
            out.append(src[key]["evidence"])
    return " || ".join(out)[:1400]


LOCKS = {
    "azure-1#00": ("FIXED",
        "all five breakables break with a real jump+pound: terrace urn W/E and the north urn "
        "(coins 1->4->6->9), the tide-switch pedestal broken with trigger 'tide-drawn' (approached "
        "from the east at (-2.9, 6.9, -33.4)), and the tidewell CORAL WALL broken with the metal hat "
        "on, trigger 'coral-broken', crests 0->1. Without the hat the coral wall does not break - that "
        "is the authored counterplay, not the defect."),
    "azure-1#02": ("FIXED",
        "swim in at (0, -0.6, 12) and hold W north: the hero swims the drowned forecourt, RUNS up the "
        "great stair and ends grounded on the terrace at (0.36, 5.00, -16.76), highest y 5.47, deaths +0."),
    "azure-2#04": ("FIXED",
        "walked west from the CLIMB IN sign at (-1.6, -10.2, -8.5): the hero crossed the old dead stop "
        "at x -3.55 and BOARDED - state 'cannon' at (-5.00, -9.95, -8.50), moved 3.40 m. The two 0.33 m "
        "treads onto the 1.00 m pad are what the walk needed."),
    "azure-2#12": ("STILL REPRODUCES",
        "the CLIMB is fixed and the ENTRY is not. Frame-exact wall-kick ladder from the shaft floor "
        "(_mv_kickladder.py azure-2 6.6,33.00,-6.6 40.00): 33.60 -> 40.869 m, reached=true, 3 kicks at "
        "+1.17/+1.19 m - the 40.00 clock face is covered. But every walk into the shaft still bonks: from "
        "x 1.0 the hero stops at 1.12, from x 2.6 he stops at x 3.77 (the tester's own number, the west "
        "wall face at 4.15 minus the 0.38 body radius), and from the north at (6.6, -2.6) he bonks at "
        "(7.95, -3.77). There is no way in on foot."),
    "azure-3#21": ("COULD NOT TEST",
        "not a physical measurement: placed on the start deck at (-27.8, 50.00, -62.0) with a verified "
        "9.00 m/s run-up, the triple produced apex 0.00 m and the hero ran west to x -37 instead of "
        "launching. feelcheck measures apex1 1.911 / apex3 3.579 m on the same build with the same key, "
        "so this is the driver, not the moveset. The 3.00 m deck rise is still unproven either way."),
    "keep#04": ("FIXED",
        "E at Old Fen now speaks: the screen goes from ['E OLD FEN TALK'] to 'OLD FEN / Walk it first. "
        "Push the stick gently and you stroll; push it home and you run...', and a second E advances to "
        "'OLD FEN / Land and jump again straight away, then again. Three jumps...'. The earlier "
        "'nothing happens' was a probe reading the wrong DOM node."),
    "rime-1#01": ("FIXED",
        "walking west from the green at (6.0, 15.10, -46.8) now ends INSIDE the shaft at x -1.22 (the "
        "old stop was x 2.38, pressed against the outer face). Frame-exact ladder "
        "(_mv_kickladder.py rime-1 0,15.10,-47.0 23.10 z): 15.10 -> 24.383 m, reached=true, 4 kicks, and "
        "the hero LANDS grounded on the belfry deck at (0, 23.10, -50.93)."),
    "rime-2#09": ("FIXED",
        "frame-exact ladder in the re-planted chimney (_mv_kickladder.py rime-2 -13,21.60,-21.0 30.20): "
        "21.60 -> 30.894 m against the 30.20 exit ledge, reached=true, 4 kicks at +1.43/+1.34/+1.44 m. "
        "The old shaft floor at 14.40 was inside the mountain (snow heightfield 17.82); the chimney now "
        "stands on the flank at 21.60 with a west doorway."),
    "rime-2#15": ("STILL REPRODUCES",
        "the height is there and the carry is not: a double jump off serac 1 (-26.4, top 3.30, 21.6) "
        "apexes +2.76 m against the 2.40 m rise, but with the stick held it carries the hero clean past "
        "serac 2 - end (-51.47, 2.74, -2.74), grounded, not one landing on the 3.0 m block. Exactly the "
        "tester's 'a double can make the height but carried the hero 4.5 to 7.6 m past'."),
    "rime-3#15": ("FIXED",
        "frame-exact ladder out of the crusher cave (_mv_kickladder.py rime-3 15.2,20.00,-2.0 27.70 z): "
        "20.00 -> 28.962 m against the 27.70 exit ledge, reached=true, kicks fired every time. The old "
        "ceiling was the exit ledge's own underside at 26.90; the ledge was moved north off the mouth."),
}

DEATHS = {
    "azure-1#01": ("FIXED",
        "5.7 s standing in the inner-court ring at (0, 1.6, -48): states seen roar, chargeTele, charge, "
        "dizzy, idle - the warden wakes and fights (hp 3, alive). 30 s hands-off at the ring edge "
        "(0, 1.80, -41.5): 0 deaths, drift 0.52 m."),
    "azure-2#03": ("FIXED",
        "30 s hands-off on the secret-crest pedestal at its new spot (0, -10.60, -9.5): 0 deaths, drift "
        "0.00 m. The pedestal's ORIGINAL x,z under the counterweight still crushes at +4.87 s - which is "
        "why it was moved 4.5 m south off the 6 m grate hole."),
    "azure-2#10": ("FIXED",
        "30 s hands-off ON all three escapement hammers ((6, 28.00, 6), (-6, 28.00, 6), (0, 28.00, -6)): "
        "0 deaths, the hero still at y 29.23 - he is no longer driven through gallery 3's floor to 17.00. "
        "The gallery-3 south walk (0, 25.10, 6) is also clean for 30 s; standing directly UNDER the SE "
        "hammer's stroke at (6, 25.10, 6) still crushes, which is the hazard doing its job."),
    "azure-2#12": ("STILL REPRODUCES", ""),
    "azure-3#13": ("FIXED",
        "30 s hands-off at three cloud-shelf stations - 1.3 m from the gnasher post (-34, 26.30, -3.3), "
        "AT the post (-34, 26.30, -2.0) and on sigil 2 inside the 6 m disc (-34, 27.80, -6.0): 0 deaths "
        "at all three. The post-safe radius disarms the bite where the pound has to be performed."),
    "azure-3#22": ("STILL REPRODUCES",
        "the file no longer lies, but the two coordinates the tester named still kill. 30 s hands-off: "
        "x 24.6 (inside the course's newly published clear band 24.6-29.0) survives with 0 deaths, while "
        "x 17.4 dies at +0.02 s (crush) and the tester's own x 18 and x 24 die at +0.02 s / +0.07 s "
        "(spike). len 2.2 + the 0.95 m capsule reach still covers x 17.85..24.15."),
    "azure-3#24": ("FIXED",
        "30 s hands-off on sigil 7 between the prism hammers (12.5, 53.00, -62.0): 0 deaths, drift 0.00 m. "
        "The two hammers were pushed 0.40 m apart each, taking the gap from 1.60 m to 2.60 m for a 0.76 m "
        "capsule."),
    "azure-3#30": ("STILL REPRODUCES",
        "the console still logs it at every boot of the course: '[Course azure-3] killY (8) sits at or "
        "above the lowest geometry (-0.50) - players may die standing on real ground'."),
    "ember-1#04": ("FIXED",
        "at cp-junction (0, 3.20, -7.50) the follow camera holds dist 6.80 m (minDist 1.60) at cam y 6.03 "
        "with the hero at y 3.00, and a broadphase ray from the lens to the hero's head is NOT blocked - "
        "the lens is not inside the flame vent's basin."),
    "ember-1#18": ("FIXED",
        "30 s hands-off on THE POUR's level-3 walk at x -6.03, -8.0 and -10.0 (y 15.20, z -30.40): 0 "
        "deaths at all three, worst drift 4.20 m ending at x -5.13, outside the curtain's blocked band. "
        "The west-lane bumbler's patrol now turns at -7.5 instead of carrying a standing hero into the jet."),
    "ember-1#23": ("COULD NOT TEST",
        "there is no contact left to measure at this station: 6 s standing in the west lane at "
        "(-4.79, 15.20, -30.40) produced no bumbler contact at all (moved 0.00 m, state idle throughout, "
        "deaths +0) because the patrol was shortened to turn at x -7.5. The claim - that a bumbler which "
        "intersects Nim does nothing - needs a station inside the new patrol."),
    "ember-1#26": ("FIXED",
        "the lens is out and the box is not sealed. Inside the crucible at (-4.0, 6.40, -40.49) the camera "
        "holds dist 6.71 m with an unblocked ray to the hero's head; a triple jump escapes the 8.8 m box "
        "in 2 of 4 directions (north peak 11.13 m ending (4.02, 6.00, -33.98), east ending "
        "(4.02, 6.00, -42.02))."),
    "ember-1#29": ("STILL REPRODUCES",
        "0 of 3 timed runs crossed the flame catwalk from the quay at (0, 3.40, 12.5) holding W: clock "
        "1.5 died to lava at z 2.40, clock 2.6 died at z 8.40, clock 3.4 died at z 8.40. The tester got "
        "1 in 3; this pass got 0 in 3."),
    "ember-2#07": ("STILL REPRODUCES",
        "the complaint is the ABSENCE of danger and the absence is still there: 30 s hands-off in each of "
        "the three piston-hall lanes (x -7, 0, +7 at y 6.20, z 28.0) - 0 deaths, drift 0.00 m, state idle "
        "in every lane."),
    "ember-4#04": ("STILL REPRODUCES",
        "holding W west out of the dunes from (-62, 1.60, 64.0) still runs off the edge of the heightfield "
        "and dies: 'void' at (-79.47, -14.26, 64.04). No wall, no fence, no slide-back."),
    "ember-4#08": ("STILL REPRODUCES",
        "6 s hands-off on both tomb vanish glyphs: glyph 1 (0, 4.80, -52.2) dead at +0.02 s (spike), "
        "glyph 2 (0, 4.80, -56.0) dead at +0.02 s (spike). The scarab rotor still covers both."),
    "rime-1#11": ("FIXED",
        "30 s hands-off at the barn yard's exact centre (-21.0, 5.20, 4.0): 0 deaths, drift 0.00 m, state "
        "idle - it was 'gnasher' in 0.03 s. The chain is 4.0 m, so standing AT 4.00 m from the post "
        "(-19.0, 5.20, 12.6) is still bitten at +1.10 s, which is what the course comment always claimed."),
    "rime-2#09": ("FIXED", ""),
    "rime-3#16": ("FIXED",
        "30 s hands-off on the terrace coin ring's nearest coin (19.0, 19.80, 2.0): 0 deaths, drift 0.00 m. "
        "The gnasher post and creature were moved out of the two ice hammers' footprints to z 0.80; the "
        "crusher-cave mouth itself is still a crusher and still crushes, as authored."),
    "verdant-2#12": ("FIXED",
        "30 s hands-off at the WEST POST pound spot (-7.0, 5.85, 26.5): 0 deaths, the hero settling at "
        "(-6.40, 5.42, 26.60). Inside GN_POST_SAFE the creature thrashes instead of lunging, so the "
        "authored counterplay can be performed."),
    "verdant-2#21": ("COULD NOT TEST",
        "the driver could not stand on the authored pad: a teleport to (-8.0, y, 24.5) settles the hero at "
        "(-8.00, 12.00, 22.92) - 5.5 m above the pad's authored y and 1.6 m north of it - at three "
        "different drop heights, and no launch was measured (gain 0.00 m). The pad's throw into the outer "
        "wall is neither confirmed nor cleared."),
    "verdant-3#01": ("FIXED",
        "the freeze was the CLEAR CARD, not the controller. Pounding the granary mezzanine takes the "
        "SECRET CREST (crests 0 -> 1) and game.state goes to 'clear'; with the card dismissed the hero "
        "walks normally - held W for 2.4 s and moved 5.12 m, (-8.00, 13.61, -16.00) -> "
        "(-2.88, 13.60, -16.00), state idle."),
    "verdant-3#16": ("FIXED",
        "30 s hands-off on threshing deck B, both the deck line (-8.8, 12.70, -8.2) and the jump-pad "
        "landing line (-8.7, 12.70, -8.7): 0 deaths at both. A chained ground critter now bites only "
        "inside [groundY - 0.5, groundY + 2.2] and never through a wall."),
}

ALL = {}
for k, (v, e) in LOCKS.items():
    ALL[k] = (v, e, "content lock")
for k, (v, e) in DEATHS.items():
    if k in ALL:
        continue
    ALL[k] = (v, e, "death defect")
# the two rows in BOTH sets keep the lock evidence and are tagged for both
for k in ("azure-2#12", "rime-2#09"):
    v, e, _ = ALL[k]
    ALL[k] = (v, e, "content lock + death defect")

doc = json.load(open(VF, encoding="utf-8"))
byKey = {v["key"]: v for v in doc["verdicts"]}
missing = [k for k in ALL if k not in byKey]
if missing:
    print("!! keys not in the corpus:", missing)
    sys.exit(1)

changed, kept = [], []
for k, (verdict, evidence, tag) in ALL.items():
    row = byKey[k]
    was = row["verdict"]
    if evidence:
        row["evidence"] = evidence
    row["verdict"] = verdict
    row["evidenceSource"] = "verify pass - real input on the current tree"
    row["reMeasuredBy"] = "verify-redeploy-push (2026-09-08), " + tag
    (changed if was != verdict else kept).append({"key": k, "was": was, "now": verdict})

tot = {"fixed": 0, "stillReproduces": 0, "couldNotTest": 0}
for v in doc["verdicts"]:
    if v["verdict"] == "FIXED":
        tot["fixed"] += 1
    elif v["verdict"] == "STILL REPRODUCES":
        tot["stillReproduces"] += 1
    else:
        tot["couldNotTest"] += 1
doc["totals"] = tot

byClass = {}
for v in doc["verdicts"]:
    byClass.setdefault(v["cls"], {}).setdefault(v["verdict"], 0)
    byClass[v["cls"]][v["verdict"]] += 1
doc["byClass"] = byClass

doc.setdefault("passes", []).append({
    "pass": "verify-redeploy-push",
    "date": "2026-09-08",
    "scope": "the ten content locks and the 23 death defects (the `death`-signature rows that stood at "
             "STILL REPRODUCES), 31 distinct rows - all 31 were STILL REPRODUCES before this pass",
    "harness": [
        "_vf_locks.py / _vf_locks2.py - the ten locks, real input, game resumed and course verified before each battery",
        "_vf_deaths.py / _vf_deaths2.py - the 23 death rows, 30 s hand-stepped hands-off stands plus per-claim batteries",
        "_mv_kickladder.py - the FRAME-EXACT wall-kick ladder (press only on a falling wall contact past wallKick.minFall)",
        "_lf_prove_a1b.py / _lf_a1coral.py / _lf_prove_rime.py / _lf_r1bell.py - the locks lane's own drivers, re-run",
        "_vf_apply.py - this merge",
    ],
    "reMeasured": len(ALL),
    "outcome": {"FIXED": sum(1 for v, _, _ in ALL.values() if v == "FIXED"),
                "STILL REPRODUCES": sum(1 for v, _, _ in ALL.values() if v == "STILL REPRODUCES"),
                "COULD NOT TEST": sum(1 for v, _, _ in ALL.values() if v == "COULD NOT TEST")},
    "changed": changed,
    "unchanged": kept,
    "harnessLesson": "A BLIND ALTERNATING LADDER IS NOT EVIDENCE ABOUT A SHAFT. The lane drivers press "
                     "Space on a wall-clock schedule; on rime-1, rime-2, rime-3 and azure-2 that produced "
                     "peaks of 16.7 / 23.2 / 21.9 / 34.8 m and 0-2 kicks, i.e. 'the chimney does not "
                     "climb'. The frame-exact driver - press only when the hero is ON the wall and FALLING "
                     "past TUNE.wallKick.minFall, honour the lockout - climbed all four on the same build, "
                     "same minute: 24.383 / 30.894 / 28.962 / 40.869 m, every one past its exit. feelcheck's "
                     "own wallkick_ladder_m read 14.252 m with 6 kicks in the contract's 3.20 m shaft, "
                     "which is what said the moveset was innocent before any geometry was blamed.",
})

with io.open(VF, "w", encoding="utf-8") as f:
    json.dump(doc, f, indent=1, ensure_ascii=False)

print("re-measured %d rows: %s" % (len(ALL), doc["passes"][-1]["outcome"]))
print("changed verdicts: %d" % len(changed))
for c in changed:
    print("   %-14s %-18s -> %s" % (c["key"], c["was"], c["now"]))
print("NEW TOTALS over all %d: %s" % (len(doc["verdicts"]), tot))
