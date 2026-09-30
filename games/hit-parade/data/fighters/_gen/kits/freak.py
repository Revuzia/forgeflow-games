"""THE FREAK - mini boss, armored monster (Creature_Pack: mutant punch/swiping/jump attacks/roar/flex).
Mutant rig has no finger bones: hands stay in the bind (claw) shape."""
from kitlib import (Kit, cam, cinematic, cmu, crouch, layer, mix, seq, LV1, LV3, LV1_COST, LV3_COST)

CR = "Creature_Pack/"


def jump_legs():
    return mix(CR + "mutant jumping", (1, 87), why="apex f49 measured")


def build():
    K = Kit(
        id="freak", name="THE FREAK", persona="Specimen 13", archetype="boss_armor",
        body="Mutant", heightM=2.40, hp=11500, build="monster",
        walk=(1.80, 1.20), dash=(0.90, 0.60, 22, 26), jump=(5, 42, 5, 1.55, 1.40), throwRangeM=0.70,
        colors=[("Specimen 13", None), ("Cobalt Crystal", "#1e88e5"), ("Toxic", "#76ff03"), ("Obsidian", "#212121")],
        intro="intro_roar", win=["win_roar", "win_idle"], taunt="taunt_flex", rival="-", stage="butcher_block",
        cpu={"style": "boss_armor", "rangeM": [1.0, 2.4], "pokes": ["5M", "2M"], "antiAir": ["2H"],
             "punish": ["5H", "claw_rush_h"], "combo": ["2L", "5M", "claw_rush_m"], "approach": ["crusher_leap_m"],
             "grab": ["specimen_grab_m"], "armor": ["5H", "6H", "claw_rush_m", "crusher_leap_m"], "meter": "meltdown",
             "antiStep": ["5M", "specimen_grab_m"]},
        doc=dict(
            difficulty=2, packs="Creature (mutant punch, swiping, jump attacks, roar, flex, run/walk)",
            look="Mutant: hulking cracked-rock skin, bony mask with cyan crystals, crystal claw growths on both "
                 "hands, torn blue jeans, bare feet, stitched chest scar; the branded chest number is repainted "
                 "to the show's own specimen number (research ROSTER content flag).",
            bio="Grown in the studio basement from 'audience feedback'. KNOCKOUT 13 keeps it chained under the "
                "Butcher Block set and lets it out for the season's second-to-last episode. It has never lost "
                "on camera.",
            plan="Boss tools, not cheats (FIGHTING_DESIGN 10): 2.40 m reach and 11,500 HP, 2 hits of armor on "
                 "5H, 6H and every special, CRUSHER LEAP crosses the screen as an overhead, ROAR blows people and "
                 "projectiles away, SPECIMEN GRAB has the longest command-grab reach in the game.",
            weakness="The biggest hurtbox in the game and the slowest dash; armor loses to throws, multi-hits "
                     "and supers; ROAR and CRUSHER LEAP are very punishable; honest frame data (no normal "
                     "below -4 except the anti-air).",
            rivalry="None - it is the network's property. It fights whoever reaches episode 7.",
            # CHANGED(FIGHTERS3D): 3D ring play (CONTRACT 35.12)
            ring=dict(
                stepping="CRUSHER LEAP (28-36f) and CLAW RUSH L/M/H are LINEAR: its big armored approaches are exactly "
                         "what a sidestep is for - step, then punish the landing or the -4..-12. The EX CLAW RUSH re-aims. "
                         "It does not need to step itself: 2.40 m reach and armor.",
                homing="5M WILD SWING (10f looping claw, homing, -4) is the anti-step tool. ROAR hits all around it (its "
                       "box is centred on the body: a square 2.0-3.0 m wide), so circling it does not help once it "
                       "roars. SPECIMEN GRAB homes with the longest command-grab reach in the game; MELTDOWN and "
                       "SPECIMEN 13 home.",
                wall="CLAW RUSH H / EX wall-splat; ROAR's 4 m/s launch becomes a wall splat when the opponent's back is "
                     "to the ring boundary."),
        ),
    )

    K.clip("idle", mix(CR + "mutant idle", (1, 390), loop=True), "OVERRIDE shared idle: hunched brute idle")
    K.clip("walk_f", mix(CR + "mutant walking", (1, 44), loop=True), "OVERRIDE shared walk_f: mutant walk "
                                                                    "(loop 1.2 deg)")
    K.clip("claw_jab", mix(CR + "mutant punch", (1, 22), contact=9),
           "Mixamo mutant punch opening: the hook passes the front at f9 (front pass; rig-proof clip)")
    K.clip("wild_swing", cmu("hammer_chop.1", fist=0),
           "CMU hammer_chop.1 (86_06 4868/4894/4944, usable: diagonal downward chop 9.1 m/s, contact 0.34 m below the chest), open claw. Replaced the 80_10 haymaker (2026-09-30): on the 2.4 m body that swing never came below 2.03 m (bake trace), so 5M whiffed every opponent in the sim (connect matrix 0/36)")
    K.clip("crystal_swipe", mix(CR + "mutant swiping", (25, 60), contact=41),
           "Mixamo mutant swiping: overhead claw haymaker, torso whips down f40, reach f41 (dense render)")
    K.clip("low_claw", crouch(mix(CR + "mutant punch", (1, 22), contact=9)), "Crouch Idle legs + claw hook")
    K.clip("floor_slam", mix(CR + "jump attack", (40, 70), contact=51),
           "Mixamo jump attack landing: hands to the floor f51 = low slam")
    K.clip("jump_claw", mix(CR + "mutant jumping", (20, 60), contact=37),
           "Mixamo mutant jumping: arms up on the rise = anti-air. P2: contact 32 -> 37: at 32 both claws were spread "
           "0.9 m to the SIDES at 0.97-1.10 m (bake trace, contact_check EXT + LAT); at 37 they rise in front "
           "(RightHand 0.76 m forward, 1.74 m up, 0.41 m out)")
    K.clip("hammer_down", mix(CR + "mutant jump attack", (30, 70), contact=51),
           "Mixamo mutant jump attack (in-place): leap slam, hands to the floor f51")
    K.clip("air_claw", layer(jump_legs(), mix(CR + "mutant punch", (1, 22), contact=9), mode="hold", lower_frame=49),
           "LAYERED: mutant jumping apex legs (f49 measured) + claw hook")
    K.clip("air_swipe", layer(jump_legs(), mix(CR + "mutant swiping", (25, 60), contact=41), mode="hold",
                              lower_frame=49), "LAYERED: mutant jumping apex legs + overhead swipe")
    K.clip("air_slam", mix(CR + "mutant jump attack", (40, 60), contact=51), "descending half of the leap slam")
    K.clip("throw_reach", mix(CR + "mutant punch", (1, 34), contact=9), "claw reach (grab whiff): full hook")
    K.clip("crush", mix(CR + "mutant flexing muscles", (40, 105), contact=65),
           "Mixamo mutant flexing muscles f40-105 = crushes the victim in a bear hug (hunched squeeze f55-95). P2: window "
           "1-133 -> 40-105 (4.4 s over a 60-frame lock played at 4.4x; 2.17 s = 2.2x)")
    K.clip("fling", mix(CR + "mutant swiping", (20, 70), contact=41),
           "overhead swipe flings them behind (claw through the front at f41). P2: window 1-73 -> 20-70 (2.4 s over "
           "50 f was 2.9x; 1.67 s = 2x)")
    K.clip("crusher_leap_clip", mix(CR + "jump attack", (1, 115), contact=51),
           "Mixamo jump attack: leap GROUND SLAM (hips 0.47-2.58 m, travel 2.26 m, hands to the floor f51)")
    K.clip("claw_rush_clip", layer(mix(CR + "mutant run", (1, 27), loop=True),
                                   mix(CR + "mutant swiping", (25, 60), contact=41), mode="loop"),
           "LAYERED: mutant run legs + overhead swipe")
    K.clip("roar_wave", mix(CR + "mutant roaring", (20, 70), contact=27), "Mixamo mutant roaring (RightHand f27)")
    K.clip("grab_slam", mix(CR + "mutant jump attack", (1, 112), contact=51),
           "Mixamo mutant jump attack: leaps with the victim and slams them (f51)")
    K.clip("meltdown_clip", seq(layer(mix(CR + "mutant run", (1, 27), loop=True),
                                      mix(CR + "mutant swiping", (25, 50), contact=41), mode="loop"),
                                mix(CR + "mutant punch", (1, 20), contact=9),
                                mix(CR + "mutant swiping", (30, 73), contact=41), xf=2),
           "SEQ: running swipe + hook + overhead swipe")
    K.clip("intro_roar", mix(CR + "mutant roaring", (1, 162)), "boss roar")
    K.clip("win_roar", mix(CR + "mutant roaring", (60, 162)), "roar (second half)")
    K.clip("win_idle", mix(CR + "mutant idle (2)", (1, 158)), "mutant idle (2)")
    K.clip("taunt_flex", mix(CR + "mutant flexing muscles", (1, 133)), "boss flex")

    K.add("5L", "L", name="Claw Jab", clip="claw_jab", startup=6, recovery=10,
          cancel=["chain:2L", "special", "super"], role=["poke"], desc="Short claw hook.",
          why="Monster lights are a frame slower: 6/3/10 (+2/-3).")
    K.add("2L", "2L", name="Low Claw", clip="low_claw", startup=6, cancel=["chain:2L", "special", "super"],
          role=["poke", "low"], desc="Crouching claw to the shin.", why="Startup 6 (monster).")
    K.add("5M", "M", name="Wild Swing", clip="wild_swing", startup=10, recovery=17, damage=700,
          cancel=["special", "super"], role=["poke", "antistep"], homing=True,
          why3d="looping claw chop across the body: homing anti-step tool",
          desc="Wild looping claw chop, downward across the body; homing.",
          why="Monster medium: 10/3/17, 700 (+2/-4).")
    K.add("2M", "2M", name="Floor Slam", clip="floor_slam", startup=11, damage=700, cancel=["special", "super"],
          role=["poke", "low"], desc="Slams both claws on the floor (low).", why="11f, 700 (+4/-2).")
    K.add("5H", "H", name="Crystal Swipe", clip="crystal_swipe", startup=15, recovery=21, damage=1100,
          armor={"hits": 2, "f": [5, 14]}, cancel=["special", "super"], sfx=[[9, "whoosh_heavy"]],
          desc="Overhead claw haymaker with 2 hits of armor.",
          why="Boss armored heavy (FIGHTING_DESIGN 8c ENFORCER: 2-hit armor on heavies): 15/3/21, 1100, +1/-4.")
    K.add("2H", "AA", name="Jumping Claw", clip="jump_claw", startup=11, recovery=22,
          moveY=[[0, 0], [6, 0.2], [11, 0.4], [24, 0.0]], juggle={"js": 1, "ji": 1, "jl": 0},
          cancel=["special", "super"], desc="Hops up with both claws: anti-air.",
          why="Monster anti-air: 11/4/22 (+1/-7) on a small hop.")
    K.add("6H", "OH", input="6H", kind="command", name="Hammer Down", clip="hammer_down", startup=24, damage=1000,
          armor={"hits": 2, "f": [5, 23]}, sfx=[[14, "whoosh_heavy"]], desc="Leaping two-claw slam: armored overhead.",
          why="Boss overhead: 24f (reactable) with 2-hit armor 5-23 and 1000 damage.")
    K.add("j.L", "jL", input="j.L", name="Air Claw", clip="air_claw", startup=6, desc="Air claw.",
          why="Startup 6 (monster).")
    K.add("j.M", "jM", input="j.M", name="Air Swipe", clip="air_swipe", desc="Air swipe.")
    K.add("j.H", "jH", input="j.H", name="Falling Slam", clip="air_slam", damage=900, desc="Two-claw falling slam.",
          why="Boss jump-in 900.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Crusher Hug", clip="throw_reach", damage=1400,
          grab={"frames": 60, "adv": 21, "hitF": 32, "swap": False, "air": False, "techable": True, "clip": "crush",
                # P2 paired throw: crush (f40-105, 2.17 s over 60 f) squeezes hunched from lock 14 to 51, hardest at
                # lock 32 (src 75); the victim is held folded, crushed, then dropped (kd_fall_b, face up) at lock 46.
                "victim": [[0, "hit_body", 0.0, 0.25], [16, "hit_body", 0.2, 0.75], [46, "kd_fall_b", 1.04, 1.5]]},
          desc="Crushes them in a bear hug.", why="Boss throw: 1400.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Specimen Toss", clip="throw_reach", damage=1400,
          grab={"frames": 50, "adv": 15, "hitF": 21, "swap": True, "air": False, "techable": True, "clip": "fling",
                # P2 paired throw: the overhead swipe passes the front at clip 0.70 s = lock 21 (f20-70); the victim is
                # hauled over (thrown_b 0.05 -> 0.40 s) and flung face down behind it.
                "victim": [[0, "hit_high_s", 0.0, 0.15], [8, "thrown_b", 0.05, 0.4], [21, "thrown_b", 0.4, 1.2]]},
          desc="Flings them over its shoulder.", why="Boss throw: 1400.")

    lp = {}
    for s, (st, mv, pk, dmg) in {"l": (28, 1.5, 1.5, 1200), "m": (32, 2.5, 1.8, 1300), "h": (36, 3.5, 2.1, 1400)}.items():
        lp[s] = dict(startup=st, damage=dmg, armor={"hits": 2, "f": [1, st - 1]}, move=[[0, 0], [st, mv]],
                     moveY=[[0, 0], [6, 0.3], [st // 2 + 3, pk], [st, 0.0]])
    K.special("crusher_leap", None, motion="214",
              common=dict(name="Crusher Leap", clip="crusher_leap_clip", active=4, recovery=20, hitstun=54,
                          blockstun=16, hitstop=15, guard="H", gain=1000, nerve=5000, pb=(0.0, 0.50), kd="soft",
                          cancel=[], role=["overhead", "approach"], sfx=[[4, "whoosh_heavy"]], linear=True,
                          why3d="a 1.5-3.5 m leap along its frame-1 line: linear (step it and punish)",
                          desc="Leaps across the stage and slams down: armored, overhead, very punishable.",
                          why="Boss leap slam (FIGHTING_DESIGN 8c ENFORCER tools): 28/32/36f (reactable), 2-hit armor "
                              "through the leap, overhead, -8 on block, KD +30."),
              per=lp,
              ex=dict(name="Crusher Leap (EX)", startup=25, damage=1600, hitstun=54, groundBounce=True,
                      armor={"hits": 3, "f": [1, 24]}, move=[[0, 0], [25, 3.0]],
                      moveY=[[0, 0], [6, 0.3], [15, 2.0], [25, 0.0]], desc="Faster leap, ground bounce.",
                      why="EX: 25f (vs 28-36), 3-hit armor, ground bounce."))
    K.special("claw_rush", "rush", motion="236",
              common=dict(name="Claw Rush", clip="claw_rush_clip", cancel=["super"], role=["approach"],
                          sfx=[[2, "whoosh_heavy"]], desc="Armored running claw swipe."),
              per={"l": dict(startup=14, hitstun=54, armor={"hits": 2, "f": [1, 13]}, move=[[0, 0], [14, 1.4]],
                             why="Boss rush: slower (14/16/18) with 2-hit armor through the run.", linear=True,
                             why3d="running rush: linear"),
                   "m": dict(startup=16, hitstun=59, armor={"hits": 2, "f": [1, 15]}, move=[[0, 0], [16, 2.0]],
                             why="Boss rush: slower (14/16/18) with 2-hit armor through the run.", linear=True,
                             why3d="running rush: linear"),
                   "h": dict(startup=18, hitstun=69, armor={"hits": 2, "f": [1, 17]}, move=[[0, 0], [18, 2.8]],
                             why="Boss rush: slower (14/16/18) with 2-hit armor through the run.", linear=True,
                             wallSplat=True, why3d="running rush: linear; the 2.8 m carry wall-splats at the ring")},
              ex=dict(name="Claw Rush (EX)", startup=14, active=8, recovery=20, damage=1400, hitstun=52,
                      wallSplat=True, why3d="OD: not linear - re-aims until frame 8 (special default); wall-splats",
                      armor={"hits": 99, "f": [1, 16]}, move=[[0, 0], [14, 2.8]],
                      hits=[{"f": [14, 15], "damage": 600, "hitstop": 11}, {"f": [20, 21], "damage": 800,
                                                                           "hitstop": 13}],
                      desc="Super-armored 2-hit rush, -2 on block.", why="EX: super armor 1-16, 2 hits."))
    rw = {}
    for s, (w, dmg) in {"l": (2.0, 500), "m": (2.4, 600), "h": (2.8, 700)}.items():
        rw[s] = dict(damage=dmg, boxes=[{"f": [20, 25], "x": 0.3, "y": 1.0, "w": w, "h": 2.0}], lateralM=w / 2.0,
                     why3d="shockwave all around it: the box is centred on the body, so its depth = half its width (a "
                           "square around the Freak); homing")
    K.special("roar", None, motion="22",
              common=dict(name="Roar", clip="roar_wave", startup=20, active=6, recovery=24, hitstun=48, blockstun=20,
                          hitstop=13, guard="HL", gain=800, nerve=4000, pb=(1.2, 1.0), kd="soft", launch=[4.0, 2.0],
                          armor={"hits": 2, "f": [1, 19]}, invuln={"proj": [1, 25]}, cancel=[],
                          role=["reversal"], sfx=[[20, "crowd_cheer_burst"]], homing=True,
                          desc="Shockwave roar all around it: blows opponents away, projectile-invulnerable.",
                          why="Boss 'get off me' tool: 20f startup, 2-hit armor, projectile invulnerable 1-25, a "
                              "2.0/2.4/2.8 m box around it, -10 on block."),
              per=rw,
              ex=dict(name="Roar (EX)", startup=12, damage=900, armor={"hits": 99, "f": [1, 17]},
                      boxes=[{"f": [12, 17], "x": 0.3, "y": 1.0, "w": 3.0, "h": 2.2}], desc="Fast super-armored roar.",
                      lateralM=1.5, role=["reversal", "antistep"],
                      why3d="12f radial shockwave (1.5 m deep = half the 3.0 m box): the EX is its fast anti-step answer",
                      why="EX: 12f, super armor."))
    sg = {}
    for s, (rng, dmg) in {"l": (1.30, 2600), "m": (1.20, 3000), "h": (1.10, 3400)}.items():
        # P2 paired grab: grab_slam (3.7 s over 80 f) rakes them (lock 10), leaps 2 m up (lock 18-30) and crashes down
        # at clip 1.67 s = lock 36 (was hitF 51, when it is already rising). The victim cannot be carried up (the sim
        # carry is horizontal), so it is raked, left dazed under the leap and flattened by the landing (kd_fall_b from
        # the floor impact).
        sg[s] = dict(damage=dmg, grab={"rangeM": rng, "frames": 80, "adv": 28, "hitF": 36, "swap": False,
                                       "air": False, "techable": False, "clip": "grab_slam",
                                       "victim": [[0, "hit_body", 0.0, 0.3], [10, "hit_high_l", 0.0, 0.3],
                                                  [18, "dizzy", 0.3, 1.0], [36, "kd_fall_b", 1.25, 1.8667]]})
    K.special("specimen_grab", "cmdgrab", motion="360", kind="cmdgrab",
              common=dict(name="Specimen Grab", clip="throw_reach", recovery=50, role=["grab", "antistep"],
                          sfx=[[1, "grab_cloth"]], why3d="command grab reach arc: homes through its active frames",
                          desc="360 command grab with the longest reach in the game.",
                          why="Boss command grab: reach +0.08..+0.18 m over the template (its 2.40 m arms), "
                              "damage +100 per strength, whiff recovery 50."),
              per=sg,
              ex=dict(name="Specimen Grab (EX)", damage=3700, invuln={"strike": [1, 5]},
                      grab={"rangeM": 1.40, "frames": 84, "adv": 28, "hitF": 38, "swap": False, "air": False,
                            "techable": False, "clip": "grab_slam",
                            "victim": [[0, "hit_body", 0.0, 0.3], [11, "hit_high_l", 0.0, 0.3], [19, "dizzy", 0.3, 1.0],
                                       [38, "kd_fall_b", 1.25, 1.8667]]},
                      desc="Strike-invulnerable 1-5, 1.40 m.", why="EX: strike invulnerable 1-5."))

    K.add("meltdown", LV1, kind="super1", input="236236", name="Meltdown", strength="H", clip="meltdown_clip",
          startup=10, active=27, recovery=50, damage=2200, hitstun=76,
          hits=[{"f": [10, 11], "damage": 600, "hitstop": 9}, {"f": [22, 23], "damage": 600, "hitstop": 9},
                {"f": [34, 36], "damage": 1000, "hitstop": 20}],
          warp="auto", armor={"hits": 99, "f": [1, 34]}, invuln={"throw": [1, 10]}, move=[[0, 0], [10, 1.4], [34, 2.5]],
          kd="soft", juggle={"js": 1, "ji": 0, "jl": 99}, cost={"showtime": LV1_COST}, gain=0, nerve=600,
          role=["reversal"], sfx=[[1, "crowd_cheer_burst"]],
          desc="Super-armored three-swipe rampage.",
          why="Boss Lv1: super armor 1-34 (not invulnerable - throws beat it), 2200 (boss damage), hits 12 frames "
              "apart (three separate swings in the clip), -28 on block.")
    K.add("specimen_13", LV3, kind="super3", input="214214", name="Specimen 13", strength="H", clip="crystal_swipe",
          damage=5000, invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 0.8]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic=lambda: cinematic(
              175, "freak_specimen_13",
              hits=[[40, 800], [70, 900], [100, 1000], [150, 2300]],
              anim=[K.seg(0, "crystal_swipe", 25, fromS=0.53), K.seg(25, "crush", 55, hit=40),
                    K.seg(55, "hammer_down", 85, hit=70), K.seg(85, "hammer_down", 115, hit=100),
                    K.seg(115, "roar_wave", 140, fromS=0.1), K.seg(140, "fling", 175, hit=150)],
              victim=[[0, "hit_high_l", 0.0, 0.4], [25, "hit_body", 0.0, 0.3], [40, "hit_body", 0.2, 0.8],
                      [70, "kd_fall_b", 1.2, 1.8667], [100, "kd_ground_b", 0.0, 0.367], [115, "wake_b", 0.2, 1.2333],
                      [130, "dizzy", 0.5, 1.0], [150, "thrown_f", 0.3, 0.74], [162, "thrown_f", 0.74, 1.3333]],
              camera=[cam(0, 25, "close", "both", 34, 3.4, 1.6, 25, lookH=1.1),
                      cam(25, 55, "low", "both", 40, 3.6, 0.5, 25, lookH=1.4),
                      cam(55, 115, "top", "defender", 42, 1.6, 6.0, 10, lookH=0.4),
                      cam(115, 140, "close", "attacker", 34, [2.9, 2.5], 1.6, 35, lookH=1.05),
                      cam(140, 175, "wide", "both", 40, [5.0, 6.2], 1.8, 5)],
              fx=[(0, "slate"), (25, "impact_m"), (40, "impact_m"), (40, "shake_s"), (70, "impact_l"), (70, "dust"),
                  (70, "shake_m"), (100, "impact_l"), (100, "dust"), (100, "shake_m"), (115, "lights_flicker"),
                  (115, "shock_ring", "attacker"), (115, "shake_m"), (150, "impact_l"), (150, "flash"),
                  (150, "shake_l"), (150, "freeze_frame"), (164, "dust")],
              crowd=[(0, "gasp"), (40, "gasp"), (70, "ooh"), (100, "ooh", "up"), (115, "hush"), (150, "roar", "spike"),
                     (164, "gasp", "peak")],
              pathA=[[25, 0.1, 0], [55, 0.2, 0], [70, 0.3, 0.3], [78, 0.35, 0], [100, 0.35, 0], [140, 0.2, 0],
                     [150, 0.25, 0], [173, 0, 0]],
              gapD=[[25, 0.9, 0], [40, 0.8, 0.4], [55, 0.9, 0.2], [70, 1.2, 0], [115, 1.2, 0], [150, 1.0, 0],
                    [158, 2.6, 0.6], [164, 3.5, 0], [173, 3.5, 0]],
              slate="PRIME TIME - THE FREAK: SPECIMEN 13", endPose="back", endAdv=19, endGapM=3.5),
          desc="PRIME TIME: grabbed, crushed, hammered into the floor twice, roared at and hurled across the set.",
          why="Boss Lv3: 5000 (+500 over the 4500 template; inside the SF6 range 2600-5300), otherwise 10/4/58.")

    K.simple = {"5S": "claw_rush_m", "6S": "crusher_leap_m", "2S": "roar_m", "4S": "specimen_grab_m",
                "S+H": "meltdown", "S+H+2": "specimen_13", "assist": ["2L", "5M", "5H", "claw_rush_m"]}
    K.classic = [{"motion": "236", "btn": "LMH", "move": "claw_rush_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "crusher_leap_{s}"},
                 {"motion": "22", "btn": "LMH", "move": "roar_{s}"},
                 {"motion": "360", "btn": "LMH", "move": "specimen_grab_{s}"}]
    K.unique = {"kind": "armorStep", "steps": [],
                "armored": ["5H", "6H", "crusher_leap_l", "crusher_leap_m", "crusher_leap_h", "crusher_leap_ex",
                            "claw_rush_l", "claw_rush_m", "claw_rush_h", "claw_rush_ex", "roar_l", "roar_m", "roar_h",
                            "roar_ex", "meltdown"]}
    # camera note: THE FREAK hunches (idle mesh top 2.01 m on a 2.40 m body, CONTRACT 26.5 scales lookH by 2.40 / 1.80),
    # so its close shots look at 1.05-1.1 m (-> 1.4-1.5 m scaled), not the 1.3-1.45 m framing floor
    K.cine_doc = [
        "f0 CRYSTAL SWIPE (close): the claw connects.",
        "f25 CRUSHER HUG (low): lifts them 0.4 m off the floor and squeezes - 800 at f40.",
        "f55 / f85 HAMMER DOWN x2 (top-down from 6 m): slams them flat, then again while they lie - 900 + 1000 "
        "(f70 / f100, dust).",
        "f115 ROAR (close on the Freak): a shock ring, the set lights flicker; the victim staggers up, dazed.",
        "f140 FLING (wide): hurled 2.5 m across the set - 2300 at f150 (flash, freeze-frame); lands face up at 3.5 m "
        "(KD +19).",
    ]
    K.text = dict(
        introLine="(The chains snap. Something in the dark breathes.)",
        winQuotes=["(It sniffs the floor where you fell. Then it roars.)",
                   "(It drags its chains back into the dark.)",
                   "(Specimen 13 flexes. The studio lights flicker.)"],
        banter={"default": ["(A low growl rattles the camera rigs.)",
                            "(RRRRAAAAGH.)"]},
        ending="THE FREAK smashes through the Control Room wall and walks out into the city with its chains trailing "
               "behind it. The network offers a reward for its return; nobody claims it. Weeks later a rooftop camera "
               "catches Specimen 13 watching the sunrise over Channel 13, perfectly still. For the first time in its "
               "life, nobody is filming it on purpose.")
    return K
