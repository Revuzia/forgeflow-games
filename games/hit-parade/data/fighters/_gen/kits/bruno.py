"""BRUNO "THE FRIDGE" - grappler (Soccer goalkeeper grabs + throw-in, axe-pack unarmed swings, CMU grab)."""
from kitlib import (Kit, air, cmu, crouch, layer, mix, SPECIAL, LV1, LV3, LV1_COST, LV3_COST)


def build():
    K = Kit(
        id="bruno", name='BRUNO "THE FRIDGE"', persona="The Walk-In", archetype="grappler",
        body="Brute", heightM=2.00, hp=11000, build="heavy",
        walk=(1.64, 1.13), dash=(0.76, 0.54, 21, 25), jump=(4, 42, 4, 1.45, 1.30), throwRangeM=0.77,
        colors=[("Fridge", None), ("Freezer Burn", "#6fc3df"), ("Butcher Paper", "#c9a27e"),
                ("Blackout", "#222222")],
        intro="intro_battlecry", win=["win_flex", "win_nod"], taunt="taunt_flex", rival="krane",
        stage="butcher_block",
        cpu={"style": "grappler", "rangeM": [0.6, 1.4], "approach": ["brace_m", "fridge_door_l"],
             "pokes": ["2M", "5M"], "antiAir": ["lariat_l", "2H"], "punish": ["walk_in_h", "5H"],
             "combo": ["2L", "5M", "fridge_door_m"], "grab": ["walk_in_l", "walk_in_h"], "meter": "cold_storage"},
        doc=dict(
            difficulty=3, packs="Soccer goalkeeper (stance, grabs, splash, throw-in), axe-pack unarmed swings, CMU "
                                "grab/chop/flex",
            look="Brute (BattleAxe_GEO hidden - Bruno is unarmed): shirtless, handlebar moustache, earring, "
                 "baggy brown trousers, tall boots.",
            bio="Thirty years hauling walk-in freezers up tenement stairs, twenty more as a wrestling-show "
                "relic. The network pays him in steak. He has never lost a bout that went to the clinch.",
            plan="Walk in, BRACE through pokes, then guess: WALK-IN FREEZER (360 grab, 2500-3300) versus "
                 "a 2L tick. LARIAT beats jumps and fireballs; FRIDGE DOOR walls opponents in the corner.",
            weakness="Slowest walk (1.64 m/s) and shortest dash; zoners keep him out; every armored move "
                     "loses to throws and multi-hits; grab whiff = 54 frames of recovery.",
            rivalry="Officer Krane once cuffed Bruno to a meat locker door. Bruno took the door with him.",
        ),
    )

    # ---------------- clips ----------------
    K.clip("idle", mix("Soccer_Game_Pack/goalkeeper idle", (1, 140), loop=True),
           "OVERRIDE shared idle: goalkeeper ready stance (knees bent, arms wide = grappler; loop 0.0 deg)")
    K.clip("chop", cmu(take="86_06", rng=(4653, 4734), contact=4682, kind="hand", limb="R_hand"),
           "CMU hammer_chop 86_06 4653/4682/4734 (usable, 8.8 m/s downward chop) = wrestling knife-edge chop")
    K.clip("forearm", cmu("cross.4"), "CMU cross.4 clean (14_01 2592/2608/2666) = forearm smash")
    K.clip("haymaker", mix("Pro_Melee_Axe_Pack/standing melee attack horizontal", (16, 52), contact=29),
           "Mixamo axe horizontal = the reference's big haymaker; front pass f29 (reach 0.77 m)")
    K.clip("low_straight", crouch(cmu("cross.3")), "Crouch Idle legs + CMU cross.3 (14_03, 8.2 m/s)")
    K.clip("low_forearm", crouch(cmu("body_blow.4")),
           "Crouch Idle legs + CMU body_blow.4 (13_17 lead body shot with a dip)")
    K.clip("goalpost", mix("Pro_Magic_Pack/Standing 2H Cast Spell 01", (1, 34), contact=12),
           "Mixamo 2H Cast Spell 01 arms thrown overhead = double-arm anti-air. Contact f12 = both hands at the top (bake trace: 1.96 / 2.03 m, 0.07 / 0.28 m forward). Was f21 (the speed peak), which is the arms SLAMMING DOWN to 0.73 m - lane ASSETS flagged it and the jump-in test hit only landing opponents (8/88)")
    K.clip("big_boot", mix("Pro_Melee_Axe_Pack/standing melee attack kick ver. 1", (8, 40), contact=22),
           "Mixamo axe kick ver. 1 = front push kick (knockback into wall-splat); front pass f22")
    K.clip("air_chop", air(cmu(take="86_06", rng=(4653, 4734), contact=4682, kind="hand", limb="R_hand")),
           "jump apex legs + CMU downward chop")
    K.clip("air_forearm", air(cmu("cross.4")), "jump apex legs + CMU cross.4")
    K.clip("air_hammer", air(mix("Pro_Melee_Axe_Pack/standing melee attack downward", (10, 45), contact=26)),
           "jump apex legs + Mixamo axe downward hammer-fist (contact f26)")
    K.clip("fridge_drop", mix("Soccer_Game_Pack/goalkeeper body block", (1, 40), contact=22),
           "Mixamo goalkeeper body block: the sprawl (body press) part, f1-40")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9),
           "Mixamo goalkeeper catch (2): two-hand grab (throw / command grab whiff)")
    K.clip("delivery_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (5, 30), contact=9),
           "goalkeeper catch (2) from f5: the 3-frame Lv3 grab reach")
    K.clip("bear_hug", cmu("grab_pull.1", rng=(200, 330)), "CMU grab_pull.1 (18_05 lean-back two-arm pull)")
    K.clip("throw_in", mix("Soccer_Game_Pack/throw in", (30, 84), contact=50),
           "Mixamo throw in: victim held overhead f42-47, release f50 (hurled behind)")
    K.clip("freezer_slam", mix("Pro_Magic_Pack/Standing 2H Magic Area Attack 01", (10, 90), contact=40),
           "Mixamo 2H Magic Area Attack 01: both fists driven down to the floor at f40 (dense render) = the "
           "piledriver slam holding the victim (Great_Sword two-handed clips stay with Ricky)")
    K.clip("fridge_shove",
           layer(mix("Pro_Magic_Pack/Standing Run Forward", (1, 23), loop=True),
                 mix("Pro_Magic_Pack/Standing 2H Magic Attack 02", (28, 62), contact=43), mode="loop"),
           "LAYERED: running legs + Mixamo 2H Magic Attack 02 double-palm shove (front pass f43, 0.92 m)")
    K.clip("lariat_spin", mix("Pro_Melee_Axe_Pack/standing melee attack 360 high", (14, 60), contact=32),
           "Mixamo axe 360 high: spinning clothesline, arms flung wide (front pass f32)")
    K.clip("brace_step",
           layer(mix("Pro_Magic_Pack/Standing Walk Forward", (1, 35), loop=True),
                 mix("Pro_Melee_Axe_Pack/standing block idle", (1, 36), loop=True), mode="sync"),
           "LAYERED: walk-forward legs + axe block idle arms (hands at face) = armored step")
    K.clip("storage_run",
           layer(mix("Pro_Magic_Pack/Standing Run Forward", (1, 23), loop=True),
                 mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9), mode="loop"),
           "LAYERED: running legs + goalkeeper grab arms (running grab)")
    K.clip("storage_slam", mix("Soccer_Game_Pack/goalkeeper body block (3)", (1, 103), contact=33),
           "Mixamo goalkeeper body block (3): long sprawl onto the floor and back up = full body splash on the "
           "grabbed victim (the axe leap slam is Boneyard's)")
    K.clip("intro_battlecry", mix("Pro_Melee_Axe_Pack/standing taunt battlecry", (1, 86)),
           "Mixamo axe battlecry (crowd hype)")
    K.clip("taunt_flex", cmu("flex_taunt.1", rng=(241, 480), contact=False),
           "CMU 79_94 bodybuilder flexes (double biceps)")
    K.clip("win_flex", cmu("flex_taunt.1", rng=(480, 721), contact=False), "CMU 79_94 most-muscular pose")
    K.clip("win_nod", mix("Gestures_Pack_Basic/hard head nod", (1, 50)), "Mixamo hard head nod")

    # ---------------- normals ----------------
    K.add("5L", "L", name="Knife-Edge Chop", clip="chop", startup=6, recovery=10, cancel=["chain:2L", "special",
                                                                                        "super"],
          role=["poke"], sfx=[[3, "slap"]], desc="Wrestling chop.",
          why="Big-body buttons are a frame slower (FIGHTING_DESIGN 8b principle: trade speed for HP/damage): "
              "6/3/10 keeps +2 hit / -3 block.")
    K.add("2L", "2L", name="Low Straight", clip="low_straight", startup=6, cancel=["chain:2L", "special", "super"],
          role=["poke", "low"], desc="Crouching straight; the tick into WALK-IN FREEZER.",
          why="Startup 6 (big body); still +3/-2 so tick-throws work.")
    K.add("5M", "M", name="Forearm Smash", clip="forearm", startup=9, recovery=17, cancel=["special", "super"],
          role=["poke"], sfx=[[5, "whoosh_light"]], desc="Heavy straight forearm.",
          why="9/3/17 (+2/-4): one frame slower at both ends for a big body; -4 stays unpunishable.")
    K.add("2M", "2M", name="Low Forearm", clip="low_forearm", startup=9, cancel=["special", "super"],
          role=["poke", "low"], desc="Crouching body forearm; cancel into FRIDGE DOOR.",
          why="Startup 9 (big body).")
    K.add("5H", "H", name="Haymaker", clip="haymaker", startup=13, recovery=21, damage=900,
          cancel=["special", "super"], sfx=[[8, "whoosh_heavy"]], desc="The reference's big haymaker.",
          why="Grappler damage lever: 900 (+100) paid with startup 13 and recovery 21 (+1 hit / -4 block).")
    K.add("2H", "AA", name="Goalpost", clip="goalpost", startup=10, recovery=22,
          boxes=[{"f": [10, 13], "x": 0.30, "y": 1.90, "w": 0.70, "h": 0.50}],
          juggle={"js": 1, "ji": 1, "jl": 0}, cancel=["special", "super"], desc="Both arms swing up: anti-air.",
          why="Big-body anti-air one frame slower (10/4/22 -> +1/-7); still an anti-air class exemption.")
    K.add("6H", "CMD", input="6H", kind="command", name="Big Boot", clip="big_boot", startup=15, recovery=21,
          pb=(0.90, 0.60), wallSplat=True, role=["wallsplat"], sfx=[[9, "whoosh_heavy"]],
          desc="Push kick; wall-splats a cornered opponent.",
          why="Command normal 16/3/20 -> 15/3/21 (+1/-4); big hit pushback 0.9 m so it only splats near a wall.")
    K.add("j.L", "jL", input="j.L", name="Air Chop", clip="air_chop", startup=6, desc="Air chop.",
          why="Startup 6 (big body).")
    K.add("j.M", "jM", input="j.M", name="Flying Forearm", clip="air_forearm", desc="Air forearm.")
    K.add("j.H", "jH", input="j.H", name="Hammer Down", clip="air_hammer", desc="Double-fist jump-in.")
    K.add("j.2H", "jH", input="j.2H", kind="command", name="Fridge Drop", clip="fridge_drop", startup=12,
          active=10, damage=900, recovery=6, hitstun=20, blockstun=16,
          desc="Body press straight down; covers the space under him.",
          why="Air command normal: 12/10/6 landing, 900, a big active window (body press) paid with 6 landing "
              "frames.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Bear Hug", clip="throw_reach", damage=1300,
          grab={"frames": 50, "adv": 21, "hitF": 34, "swap": False, "air": False, "techable": True,
                "clip": "bear_hug",
                # CHANGED(fixer) D3: bear_hug is a lean-back two-arm pull (no lift): the victim is crushed doubled over
                # (two squeezes) and dropped backward on the crush (lock frame 34 = the slam mark) - it used to flip
                # over his shoulders in the generic thrown_f.
                "victim": [[0, "hit_body", 0.0, 0.35], [17, "hit_body", 0.05, 0.4], [34, "kd_fall_b", 1.0, 1.8667]]},
          desc="Crushes them in a bear hug.", why="Grappler throws deal 1300 (+100 over 1200).")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Throw-In", clip="throw_reach", damage=1300,
          grab={"frames": 52, "adv": 16, "hitF": 40, "swap": True, "air": False, "techable": True,
                "clip": "throw_in"},
          desc="Lifts them overhead and hurls them behind.", why="Grappler throws deal 1300.")

    # ---------------- specials ----------------
    grab_l = SPECIAL["cmdgrab"]
    walk = {}
    for s in ("l", "m", "h"):
        walk[s] = dict(grab={"rangeM": grab_l[s]["rangeM"], "frames": 70, "adv": 28, "hitF": 52, "swap": False,
                             "air": False, "techable": False, "clip": "freezer_slam"})
    K.special("walk_in", motion="360", fam="cmdgrab", kind="cmdgrab",
              common=dict(name="Walk-In Freezer", clip="throw_reach", role=["grab"], sfx=[[1, "grab_cloth"]],
                          desc="360 command grab; L reaches furthest, H hits hardest."),
              per=walk,
              ex=dict(name="Walk-In Freezer (EX)", damage=3500, invuln={"strike": [1, 5]},
                      grab={"rangeM": 1.30, "frames": 76, "adv": 28, "hitF": 56, "swap": False, "air": False,
                            "techable": False, "clip": "freezer_slam"},
                      desc="Strike-invulnerable 1-5 reversal grab with the longest reach.",
                      why="EX grab: strike invulnerable on startup (the SF6 rule: only OD/supers get true "
                          "invulnerability), 3500, reach 1.30 m."))
    K.special("fridge_door", motion="236", fam=None,
              common=dict(name="Fridge Door", clip="fridge_shove", active=4, blockstun=20, hitstop=15,
                          guard="HL", gain=1000, nerve=4000, pb=(0.0, 0.60), kd="soft", wallSplat=True,
                          cancel=["super"], role=["approach", "wallsplat"], sfx=[[2, "whoosh_heavy"]],
                          desc="Armored running double-palm shove; wall-splats in the corner.",
                          why="Armored rush (FIGHTING_DESIGN 8c 'BODY BLOCK armour'): rush class slowed to "
                              "16/18/20 for 1 hit of armor, -8/-10/-12 on block, KD +30."),
              per={"l": dict(startup=16, recovery=24, damage=1000, hitstun=58, armor={"hits": 1, "f": [3, 15]},
                             move=[[0, 0], [16, 1.0], [20, 1.1]]),
                   "m": dict(startup=18, recovery=26, damage=1100, hitstun=60, armor={"hits": 1, "f": [3, 17]},
                             move=[[0, 0], [18, 1.5], [22, 1.6]]),
                   "h": dict(startup=20, recovery=28, damage=1200, hitstun=62, armor={"hits": 1, "f": [3, 19]},
                             move=[[0, 0], [20, 2.0], [24, 2.1]])},
              ex=dict(name="Fridge Door (EX)", startup=16, recovery=20, damage=1400, hitstun=54,
                      armor={"hits": 2, "f": [1, 15]}, move=[[0, 0], [16, 2.0], [20, 2.1]],
                      desc="Two hits of armor, -4 on block.", why="EX: 2-hit armor from frame 1, -4 on block."))
    K.special("lariat", motion="623", fam=None,
              common=dict(name="Double-Door Lariat", clip="lariat_spin", active=12, blockstun=20, hitstop=13,
                          guard="HL", gain=900, nerve=4000, pb=(0.0, 0.50), kd="soft", cancel=["super"],
                          role=["antiair", "reversal"], sfx=[[2, "whoosh_heavy"], [10, "whoosh_heavy"]],
                          desc="Spinning clothesline: projectile-invulnerable, upper-body air-invulnerable.",
                          why="FIGHTING_DESIGN 8c LARIAT (anti-air + projectile-invulnerable spin); DP-class "
                              "anti-air with 2 hits: -10/-12/-14 on block, KD +30."),
              per={"l": dict(startup=8, recovery=26, damage=1000, hitstun=60,
                             hits=[{"f": [8, 10], "damage": 500, "hitstop": 11},
                                   {"f": [16, 18], "damage": 500, "hitstop": 13}],
                             invuln={"proj": [1, 24], "air": [1, 14]}),
                   "m": dict(startup=9, recovery=28, damage=1150, hitstun=62, move=[[0, 0], [20, 0.4]],
                             hits=[{"f": [9, 11], "damage": 550, "hitstop": 11},
                                   {"f": [17, 19], "damage": 600, "hitstop": 13}],
                             invuln={"proj": [1, 24], "air": [1, 10]}),
                   "h": dict(startup=10, recovery=30, damage=1300, hitstun=64, move=[[0, 0], [21, 0.8]],
                             hits=[{"f": [10, 12], "damage": 600, "hitstop": 11},
                                   {"f": [18, 20], "damage": 700, "hitstop": 13}],
                             invuln={"proj": [1, 24], "air": [1, 6]})},
              ex=dict(name="Double-Door Lariat (EX)", startup=8, recovery=30, damage=1500, hitstun=63,
                      hits=[{"f": [8, 10], "damage": 400, "hitstop": 11}, {"f": [13, 15], "damage": 450,
                                                                          "hitstop": 11},
                            {"f": [17, 19], "damage": 650, "hitstop": 15}],
                      invuln={"strike": [1, 10], "throw": [1, 10], "air": [1, 10], "proj": [1, 24]},
                      desc="Fully invulnerable 3-hit lariat.", why="EX reversal: full invulnerability 1-10."))
    K.special("brace", motion="22", fam=None,
              common=dict(name="Brace", clip="brace_step", damage=0, hitstun=0, blockstun=0, hitstop=0, gain=0,
                          nerve=0, pb=(0.0, 0.0), guard="HL", cancel=["whiff", "special"], role=["approach"],
                          desc="Armored step forward; cancels into any special (WALK-IN FREEZER, LARIAT).",
                          why="armorStep unique (CONTRACT 5.3): FIGHTING_DESIGN 8c 'armored step (1 hit armor, "
                              "18f)'."),
              per={"l": dict(startup=3, active=16, recovery=8, armor={"hits": 1, "f": [3, 18]},
                             move=[[0, 0], [18, 0.4]]),
                   "m": dict(startup=3, active=16, recovery=10, armor={"hits": 1, "f": [3, 18]},
                             move=[[0, 0], [18, 0.7]]),
                   "h": dict(startup=3, active=16, recovery=12, armor={"hits": 1, "f": [3, 18]},
                             move=[[0, 0], [18, 1.0]])},
              ex=dict(name="Brace (EX)", startup=1, active=20, recovery=8, armor={"hits": 2, "f": [1, 20]},
                      move=[[0, 0], [20, 1.2]], desc="Two hits of armor from frame 1.",
                      why="EX: 2-hit armor from frame 1."))

    # ---------------- supers ----------------
    K.add("cold_storage", LV1, kind="super1", input="236236", name="Cold Storage", strength="H",
          clip="storage_run", startup=12, active=6, recovery=50, damage=2400, guard="U", hitstun=0, blockstun=0,
          hitstop=0, invuln={"strike": [1, 6]}, move=[[0, 0], [12, 1.8], [17, 2.2]],
          grab={"rangeM": 0.90, "frames": 90, "adv": 20, "hitF": 70, "swap": False, "air": False,
                "techable": False, "clip": "storage_slam"},
          cost={"showtime": LV1_COST}, gain=0, nerve=0, role=["grab", "approach"],
          desc="Running grab; unblockable, jump it.",
          why="Grappler Lv1 is a running command grab (FIGHTING_DESIGN 8c): unblockable, so it gives up the "
              "Lv1 template's 8f startup (12f run, visible) and invulnerability after f6; 2400 because grabs "
              "cannot be scaled by a combo starter.")
    K.add("final_delivery", LV3, kind="super3", input="214214", name="Final Delivery", strength="H",
          clip="delivery_reach", startup=3, active=3, recovery=58, guard="U", blockstun=0,
          invuln={"strike": [1, 3]}, cost={"showtime": LV3_COST}, gain=0, nerve=0, role=["grab"],
          grab={"rangeM": 1.30, "frames": 175, "adv": 19, "hitF": 140, "swap": False, "air": False,
                "techable": False, "clip": "bear_hug"},
          cinematic={"frames": 175, "cue": "bruno_final_delivery", "hits": [[30, 500], [72, 1000], [140, 3000]],
                     "anim": [[0, "bear_hug"], [40, "lariat_spin"], [70, "lariat_spin"], [100, "freezer_slam"],
                              [150, "win_flex"]],
                     "victim": [[0, "thrown_f"], [100, "hit_air"], [140, "kd_ground_b"]],
                     "shots": [[0, "front_low"], [40, "orbit"], [100, "low_angle_up"], [140, "top_down"],
                               [150, "crowd_pop"]],
                     "endAdv": 19, "endGapM": 1.0},
          desc="PRIME TIME command grab: airplane spin into the freezer slam.",
          why="Grab Lv3: 3f unblockable grab (post-freeze) instead of the 10f strike template; 4500 total.")

    # ---------------- routing ----------------
    K.simple = {"5S": "walk_in_m", "6S": "fridge_door_m", "2S": "lariat_m", "4S": "brace_m", "S+H": "cold_storage",
                "S+H+2": "final_delivery", "assist": ["2L", "5M", "5H", "fridge_door_m"]}
    K.classic = [{"motion": "360", "btn": "LMH", "move": "walk_in_{s}"},
                 {"motion": "236", "btn": "LMH", "move": "fridge_door_{s}"},
                 {"motion": "623", "btn": "LMH", "move": "lariat_{s}"},
                 {"motion": "22", "btn": "LMH", "move": "brace_{s}"}]
    K.unique = {"kind": "armorStep", "steps": ["brace_l", "brace_m", "brace_h", "brace_ex"],
                "armored": ["brace_l", "brace_m", "brace_h", "brace_ex", "fridge_door_l", "fridge_door_m",
                            "fridge_door_h", "fridge_door_ex"]}
    K.cine_doc = [
        "f0 BEAR HUG (front_low): Bruno scoops them up - 500 at f30.",
        "f40 AIRPLANE SPIN (orbit): two full lariat spins with the victim across his shoulders - 1000 at f72.",
        "f100 FREEZER SLAM (low_angle_up -> top_down): lifts overhead and piledrives into the floor - 3000 at "
        "f140.",
        "f150 MOST-MUSCULAR (crowd_pop): Bruno flexes over the body (KD +19).",
    ]
    return K
