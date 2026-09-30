"""THE FREAK - mini boss, armored monster (Creature_Pack: mutant punch/swiping/jump attacks/roar/flex).
Mutant rig has no finger bones: hands stay in the bind (claw) shape."""
from kitlib import (Kit, cmu, crouch, layer, mix, seq, LV1, LV3, LV1_COST, LV3_COST)

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
             "grab": ["specimen_grab_m"], "armor": ["5H", "6H", "claw_rush_m", "crusher_leap_m"], "meter": "meltdown"},
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
    K.clip("jump_claw", mix(CR + "mutant jumping", (20, 60), contact=32),
           "Mixamo mutant jumping: arms up on the rise (RightHand f32) = anti-air")
    K.clip("hammer_down", mix(CR + "mutant jump attack", (30, 70), contact=51),
           "Mixamo mutant jump attack (in-place): leap slam, hands to the floor f51")
    K.clip("air_claw", layer(jump_legs(), mix(CR + "mutant punch", (1, 22), contact=9), mode="hold", lower_frame=49),
           "LAYERED: mutant jumping apex legs (f49 measured) + claw hook")
    K.clip("air_swipe", layer(jump_legs(), mix(CR + "mutant swiping", (25, 60), contact=41), mode="hold",
                              lower_frame=49), "LAYERED: mutant jumping apex legs + overhead swipe")
    K.clip("air_slam", mix(CR + "mutant jump attack", (40, 60), contact=51), "descending half of the leap slam")
    K.clip("throw_reach", mix(CR + "mutant punch", (1, 34), contact=9), "claw reach (grab whiff): full hook")
    K.clip("crush", mix(CR + "mutant flexing muscles", (1, 133), contact=65),
           "Mixamo mutant flexing muscles = crushes the victim in a bear hug")
    K.clip("fling", mix(CR + "mutant swiping", (1, 73), contact=41), "overhead swipe flings them behind")
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
          cancel=["special", "super"], role=["poke"], desc="Wild looping claw chop, downward across the body.",
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
          grab={"frames": 60, "adv": 21, "hitF": 40, "swap": False, "air": False, "techable": True, "clip": "crush"},
          desc="Crushes them in a bear hug.", why="Boss throw: 1400.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Specimen Toss", clip="throw_reach", damage=1400,
          grab={"frames": 50, "adv": 15, "hitF": 32, "swap": True, "air": False, "techable": True, "clip": "fling"},
          desc="Flings them over its shoulder.", why="Boss throw: 1400.")

    lp = {}
    for s, (st, mv, pk, dmg) in {"l": (28, 1.5, 1.5, 1200), "m": (32, 2.5, 1.8, 1300), "h": (36, 3.5, 2.1, 1400)}.items():
        lp[s] = dict(startup=st, damage=dmg, armor={"hits": 2, "f": [1, st - 1]}, move=[[0, 0], [st, mv]],
                     moveY=[[0, 0], [6, 0.3], [st // 2 + 3, pk], [st, 0.0]])
    K.special("crusher_leap", None, motion="214",
              common=dict(name="Crusher Leap", clip="crusher_leap_clip", active=4, recovery=20, hitstun=54,
                          blockstun=16, hitstop=15, guard="H", gain=1000, nerve=5000, pb=(0.0, 0.50), kd="soft",
                          cancel=[], role=["overhead", "approach"], sfx=[[4, "whoosh_heavy"]],
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
                             why="Boss rush: slower (14/16/18) with 2-hit armor through the run."),
                   "m": dict(startup=16, hitstun=59, armor={"hits": 2, "f": [1, 15]}, move=[[0, 0], [16, 2.0]],
                             why="Boss rush: slower (14/16/18) with 2-hit armor through the run."),
                   "h": dict(startup=18, hitstun=69, armor={"hits": 2, "f": [1, 17]}, move=[[0, 0], [18, 2.8]],
                             why="Boss rush: slower (14/16/18) with 2-hit armor through the run.")},
              ex=dict(name="Claw Rush (EX)", startup=14, active=8, recovery=20, damage=1400, hitstun=52,
                      armor={"hits": 99, "f": [1, 16]}, move=[[0, 0], [14, 2.8]],
                      hits=[{"f": [14, 15], "damage": 600, "hitstop": 11}, {"f": [20, 21], "damage": 800,
                                                                           "hitstop": 13}],
                      desc="Super-armored 2-hit rush, -2 on block.", why="EX: super armor 1-16, 2 hits."))
    rw = {}
    for s, (w, dmg) in {"l": (2.0, 500), "m": (2.4, 600), "h": (2.8, 700)}.items():
        rw[s] = dict(damage=dmg, boxes=[{"f": [20, 25], "x": 0.3, "y": 1.0, "w": w, "h": 2.0}])
    K.special("roar", None, motion="22",
              common=dict(name="Roar", clip="roar_wave", startup=20, active=6, recovery=24, hitstun=48, blockstun=20,
                          hitstop=13, guard="HL", gain=800, nerve=4000, pb=(1.2, 1.0), kd="soft", launch=[4.0, 2.0],
                          armor={"hits": 2, "f": [1, 19]}, invuln={"proj": [1, 25]}, cancel=[],
                          role=["reversal"], sfx=[[20, "crowd_cheer_burst"]],
                          desc="Shockwave roar all around it: blows opponents away, projectile-invulnerable.",
                          why="Boss 'get off me' tool: 20f startup, 2-hit armor, projectile invulnerable 1-25, a "
                              "2.0/2.4/2.8 m box around it, -10 on block."),
              per=rw,
              ex=dict(name="Roar (EX)", startup=12, damage=900, armor={"hits": 99, "f": [1, 17]},
                      boxes=[{"f": [12, 17], "x": 0.3, "y": 1.0, "w": 3.0, "h": 2.2}], desc="Fast super-armored roar.",
                      why="EX: 12f, super armor."))
    sg = {}
    for s, (rng, dmg) in {"l": (1.30, 2600), "m": (1.20, 3000), "h": (1.10, 3400)}.items():
        sg[s] = dict(damage=dmg, grab={"rangeM": rng, "frames": 80, "adv": 28, "hitF": 51, "swap": False,
                                       "air": False, "techable": False, "clip": "grab_slam"})
    K.special("specimen_grab", "cmdgrab", motion="360", kind="cmdgrab",
              common=dict(name="Specimen Grab", clip="throw_reach", recovery=50, role=["grab"], sfx=[[1, "grab_cloth"]],
                          desc="360 command grab with the longest reach in the game.",
                          why="Boss command grab: reach +0.08..+0.18 m over the template (its 2.40 m arms), "
                              "damage +100 per strength, whiff recovery 50."),
              per=sg,
              ex=dict(name="Specimen Grab (EX)", damage=3700, invuln={"strike": [1, 5]},
                      grab={"rangeM": 1.40, "frames": 84, "adv": 28, "hitF": 53, "swap": False, "air": False,
                            "techable": False, "clip": "grab_slam"},
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
          cinematic={"frames": 175, "cue": "freak_specimen_13",
                     "hits": [[35, 800], [65, 900], [95, 1000], [150, 2300]],
                     "anim": [[0, "crystal_swipe"], [25, "crush"], [55, "hammer_down"], [85, "hammer_down"],
                              [120, "roar_wave"], [140, "fling"]],
                     "victim": [[0, "hit_high_l"], [25, "thrown_f"], [65, "kd_ground_b"], [120, "dizzy"],
                                [140, "hit_air"], [150, "wall_splat"]],
                     "shots": [[0, "side_close"], [25, "front_low"], [55, "top_down"], [120, "low_angle_up"],
                               [140, "wide"], [150, "slowmo_hold"]],
                     "endAdv": 19, "endGapM": 3.5},
          desc="PRIME TIME: grabbed, slammed twice, roared at and hurled into the wall.",
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
    K.cine_doc = [
        "f0 CRYSTAL SWIPE (side_close): the claw connects.",
        "f25 CRUSHER HUG (front_low): lifts them off the floor - 800 at f35.",
        "f55 / f85 HAMMER DOWN x2 (top_down): slams them into the floor twice - 900 + 1000.",
        "f120 ROAR (low_angle_up): roars in the dazed opponent's face; the set lights flicker.",
        "f140 FLING (wide -> slowmo_hold): hurls them into the set wall - 2300 at f150 (wall splat).",
    ]
    return K
