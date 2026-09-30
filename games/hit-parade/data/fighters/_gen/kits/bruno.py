"""BRUNO "THE FRIDGE" - grappler (Soccer goalkeeper grabs + throw-in, axe-pack unarmed swings, CMU grab)."""
from kitlib import (Kit, air, cam, cinematic, cmu, crouch, layer, mix, SPECIAL, LV1, LV3, LV1_COST, LV3_COST)


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
             "combo": ["2L", "5M", "fridge_door_m"], "grab": ["walk_in_l", "walk_in_h"], "meter": "cold_storage",
             "antiStep": ["lariat_l", "walk_in_l", "5H"]},
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
            # CHANGED(FIGHTERS3D): 3D ring play (CONTRACT 35.12)
            ring=dict(
                stepping="Bruno cannot out-step anyone (slowest walk in the cast). FRIDGE DOOR L/M/H is a LINEAR "
                         "armored rush - a read sidestep makes it run past him - so it is a combo ender or a punish on "
                         "a backing-off opponent, and the EX re-aims until frame 10. He makes the opponent's step "
                         "itself the risk: every command grab homes.",
                homing="WALK-IN FREEZER (5f, every strength), COLD STORAGE and FINAL DELIVERY home through their active "
                       "frames, so a sidestep on his walk-in is grabbed like a block. DOUBLE-DOOR LARIAT (8f homing "
                       "spin, 0.60 m deep) is the anti-step strike and 5H HAYMAKER (13f, -4) the safe homing swing.",
                wall="6H BIG BOOT and FRIDGE DOOR wall-splat; at the ring edge a stepping opponent has one side left, "
                     "which makes the 360 guess worse for them."),
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
    K.clip("fridge_drop", mix("Creature_Pack/mutant jump attack", (40, 62), contact=51),
           "P2: Mixamo mutant jump attack, the descent: arms overhead, knees tucked, both fists to the floor at f51 in a "
           "crouched landing = the fridge dropping on you. Was goalkeeper body block f1-40: a sideways sprawl that ends "
           "rolled onto the back with the legs in the air (QC sheet: lying, legs up at the last two strip frames)")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9),
           "Mixamo goalkeeper catch (2): two-hand grab (throw / command grab whiff)")
    K.clip("delivery_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (5, 30), contact=9),
           "goalkeeper catch (2) from f5: the 3-frame Lv3 grab reach")
    K.clip("bear_hug", mix("Soccer_Game_Pack/goalkeeper scoop", (28, 66), contact=34),
           "P2: Mixamo goalkeeper scoop f28-66: arms wrap low around the waist (f34), lift to the chest (f43) and hold "
           "it hugged (f51-66) = a bear hug. Was CMU grab_pull.1 (18_05 200-330): QC strip showed the arms flung out "
           "sideways and the hands BEHIND the body (bake RightHand swing 85-107 deg all clip) - not a hug")
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
    K.clip("taunt_flex", cmu("flex_taunt.1", rng=(580, 800), contact=False),
           "P2: CMU 79_94 580-800 = the FRONTAL part of the take: double biceps (f647) into the crab most-muscular "
           "(f675-762), hips yaw steady within 30 deg (stick sheet). Was 241-480: the subject turns +46 deg then -33 "
           "deg in that window and kind 'body' aims the clip by the END frame, so the QC game frame showed his BACK")
    K.clip("win_flex", mix("Creature_Pack/mutant flexing muscles", (45, 105)),
           "P2: Mixamo mutant flexing muscles f45-105: arms thrown up, then the crab most-muscular (f74-89) - a strongman "
           "win. Was CMU 79_94 480-721: turned 30 deg away with one arm out = read as a bow (lane ASSETS QC)")
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
          cancel=["special", "super"], sfx=[[8, "whoosh_heavy"]], homing=True,
          why3d="axe-pack horizontal swing (unarmed): a wide haymaker, homing",
          desc="The reference's big haymaker; homing.",
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
          grab={"frames": 50, "adv": 21, "hitF": 36, "swap": False, "air": False, "techable": True,
                "clip": "bear_hug",
                # P2 paired throw (new bear_hug = goalkeeper scoop f28-66, 1.27 s over 50 f): arms wrap at lock frame 5,
                # lift to the chest at 12, hold hugged 18-50. The victim folds in the wrap, is squeezed doubled over
                # 12-36 and drops out of the hug on the crush (lock 36: kd_fall_b 1.04 -> lying 1.5 s, face up).
                "victim": [[0, "hit_body", 0.0, 0.25], [12, "hit_body", 0.25, 0.7], [36, "kd_fall_b", 1.04, 1.5]]},
          desc="Crushes them in a bear hug.", why="Grappler throws deal 1300 (+100 over 1200).")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Carousel", clip="throw_reach", damage=1300,
          grab={"frames": 52, "adv": 16, "hitF": 26, "swap": True, "air": False, "techable": True,
                "clip": "lariat_spin",
                # P2 paired throw: the throw-in HURLS FORWARD (release f50) while a back throw's victim lands BEHIND him,
                # so the back throw is now the spinning lariat (axe 360 high, 1.33 s over 52 f): he spins with them and
                # lets go at the half turn (lock 26); thrown_b carries them past (+1.30 m, monotonic) face down behind.
                "victim": [[0, "hit_high_s", 0.0, 0.2], [10, "thrown_b", 0.0, 0.4], [26, "thrown_b", 0.4, 1.2]]},
          desc="Spins them round and flings them behind him.", why="Grappler throws deal 1300.")

    # ---------------- specials ----------------
    grab_l = SPECIAL["cmdgrab"]
    walk = {}
    for s in ("l", "m", "h"):
        # P2 paired grab: freezer_slam (2.67 s over 70 f) reaches (lock 0), lifts overhead (lock 17) and drives them into
        # the floor at clip 1.00 s = lock 26 (was hitF 52, when he is already standing up again). Victim: folded in the
        # grab, lifted and flipped (thrown_f 0.15 -> 0.70 s), flat on the back from lock ~29.
        walk[s] = dict(grab={"rangeM": grab_l[s]["rangeM"], "frames": 70, "adv": 28, "hitF": 26, "swap": False,
                             "air": False, "techable": False, "clip": "freezer_slam",
                             "victim": [[0, "hit_body", 0.0, 0.3], [9, "thrown_f", 0.15, 0.7],
                                        [26, "thrown_f", 0.7, 1.3333]]})
    K.special("walk_in", motion="360", fam="cmdgrab", kind="cmdgrab",
              common=dict(name="Walk-In Freezer", clip="throw_reach", role=["grab", "antistep"], sfx=[[1, "grab_cloth"]],
                          why3d="command grab reach arc: homes through its active frames (a stepper is grabbed)",
                          desc="360 command grab; L reaches furthest, H hits hardest."),
              per=walk,
              ex=dict(name="Walk-In Freezer (EX)", damage=3500, invuln={"strike": [1, 5]},
                      grab={"rangeM": 1.30, "frames": 76, "adv": 28, "hitF": 28, "swap": False, "air": False,
                            "techable": False, "clip": "freezer_slam",
                            "victim": [[0, "hit_body", 0.0, 0.3], [10, "thrown_f", 0.15, 0.7],
                                       [28, "thrown_f", 0.7, 1.3333]]},
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
                             move=[[0, 0], [16, 1.0], [20, 1.1]], linear=True, why3d="running shove: linear"),
                   "m": dict(startup=18, recovery=26, damage=1100, hitstun=60, armor={"hits": 1, "f": [3, 17]},
                             move=[[0, 0], [18, 1.5], [22, 1.6]], linear=True, why3d="running shove: linear"),
                   "h": dict(startup=20, recovery=28, damage=1200, hitstun=62, armor={"hits": 1, "f": [3, 19]},
                             move=[[0, 0], [20, 2.0], [24, 2.1]], linear=True, why3d="running shove: linear")},
              ex=dict(name="Fridge Door (EX)", startup=16, recovery=20, damage=1400, hitstun=54,
                      why3d="OD: not linear - re-aims until frame 10 (special default)",
                      armor={"hits": 2, "f": [1, 15]}, move=[[0, 0], [16, 2.0], [20, 2.1]],
                      desc="Two hits of armor, -4 on block.", why="EX: 2-hit armor from frame 1, -4 on block."))
    K.special("lariat", motion="623", fam=None,
              common=dict(name="Double-Door Lariat", clip="lariat_spin", active=12, blockstun=20, hitstop=13,
                          guard="HL", gain=900, nerve=4000, pb=(0.0, 0.50), kd="soft", cancel=["super"],
                          role=["antiair", "reversal", "antistep"], sfx=[[2, "whoosh_heavy"], [10, "whoosh_heavy"]],
                          homing=True, why3d="spinning clothesline: homing, 0.60 m deep - the anti-step strike",
                          desc="Spinning clothesline: projectile-invulnerable, upper-body air-invulnerable; homing.",
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
          # P2 paired grab: storage_slam (3.40 s over 90 f) dives at lock 11 and splashes onto the floor at clip 1.07 s =
          # lock 28 (was hitF 70, when he is getting back up); the victim is dragged down and flipped onto its back
          # under him (thrown_f 0.25 -> 0.70 s), then lies while he rises.
          grab={"rangeM": 0.90, "frames": 90, "adv": 20, "hitF": 28, "swap": False, "air": False,
                "techable": False, "clip": "storage_slam",
                "victim": [[0, "hit_body", 0.0, 0.3], [11, "thrown_f", 0.25, 0.7], [28, "thrown_f", 0.7, 1.3333]]},
          cost={"showtime": LV1_COST}, gain=0, nerve=0, role=["grab", "approach"],
          desc="Running grab; unblockable, jump it.",
          why="Grappler Lv1 is a running command grab (FIGHTING_DESIGN 8c): unblockable, so it gives up the "
              "Lv1 template's 8f startup (12f run, visible) and invulnerability after f6; 2400 because grabs "
              "cannot be scaled by a combo starter.")
    # P2 Lv3: a grab super (CONTRACT 26.1 grab supers): the sim locks 175 f and carries the victim along grab.victim;
    # the cinematic block drives VIEW from the lock frame (and a real cinematic if SIM starts one on the connect).
    fd_victim = [[0, "hit_body", 0.0, 0.3], [24, "hit_body", 0.2, 0.6], [40, "hit_air", 0.2, 0.9],
                 [100, "hit_air", 0.9, 1.3], [128, "thrown_f", 0.3, 0.74], [140, "thrown_f", 0.74, 1.3333]]
    K.add("final_delivery", LV3, kind="super3", input="214214", name="Final Delivery", strength="H",
          clip="delivery_reach", startup=3, active=3, recovery=58, guard="U", blockstun=0,
          invuln={"strike": [1, 3]}, cost={"showtime": LV3_COST}, gain=0, nerve=0, role=["grab"],
          grab={"rangeM": 1.30, "frames": 175, "adv": 19, "hitF": 140, "swap": False, "air": False,
                "techable": False, "clip": "bear_hug", "victim": fd_victim},
          cinematic=lambda: cinematic(
              175, "bruno_final_delivery",
              hits=[[24, 500], [70, 1000], [140, 3000]],
              anim=[K.seg(0, "bear_hug", 40, fromS=0.1), K.seg(40, "lariat_spin", 70, fromS=0.1, rate=1.6),
                    K.seg(70, "lariat_spin", 100, fromS=0.1, rate=1.6), K.seg(100, "throw_in", 150, hit=128),
                    K.seg(150, "win_flex", 175, fromS=0.8)],
              victim=fd_victim,
              camera=[cam(0, 40, "low", "both", 38, 2.8, 0.5, 20, lookH=1.3),
                      cam(40, 100, "orbit", "both", 40, 3.4, 1.4, [-50, 70], ease="linear"),
                      cam(100, 128, "low", "attacker", 44, 3.2, 0.3, 25, lookH=2.0),
                      cam(128, 150, "wide", "both", 40, [4.5, 5.6], 1.6, 10),
                      cam(150, 175, "close", "attacker", 32, 2.4, 1.6, 30)],
              fx=[(0, "slate"), (24, "impact_m"), (24, "shake_s"), (40, "speed_lines"), (70, "impact_m"),
                  (70, "shake_m"), (100, "spot", "attacker"), (128, "spot_off"), (128, "smear", "attacker"),
                  (140, "impact_l"), (140, "flash"), (140, "shake_l"), (140, "dust"), (140, "freeze_frame"),
                  (150, "lights_flicker")],
              crowd=[(24, "ooh"), (70, "roar", "up"), (100, "gasp"), (140, "roar", "spike"), (150, "cheer", "peak"),
                     (165, "chant")],
              pathA=[[40, 0.1, 0], [100, 0.1, 0], [128, 0.3, 0], [160, 0, 0]],
              gapD=[[10, 0.6, 0], [40, 0.6, 0.3], [70, 0.7, 0.6], [100, 0.4, 1.4], [128, 0.8, 1.6], [134, 2.0, 1.0],
                    [140, 3.0, 0]],
              slate='PRIME TIME - BRUNO "THE FRIDGE": FINAL DELIVERY', endPose="back", endAdv=19, endGapM=3.0),
          desc="PRIME TIME command grab: hugged, spun like a carousel, lifted overhead and hurled across the set.",
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
        "f0 BEAR HUG (low, both): Bruno scoops them up and squeezes - 500 at f24.",
        "f40 CAROUSEL (orbit -50 -> +70 deg): two lariat spins with the victim lifted and flailing - 1000 at f70.",
        "f100 OVERHEAD (low, looking up, spotlight): the throw-in lift, the victim held 1.4 m up over his head.",
        "f128 HURL (wide): released across the set - 3000 when they land at f140 (flash, freeze-frame, dust).",
        "f150 MOST-MUSCULAR (close on Bruno): the crab flex over a body lying face up 3.0 m away (KD +19).",
    ]
    K.text = dict(
        introLine="Thirty flights of stairs, no elevator. You're lighter than a freezer.",
        winQuotes=["Signed, sealed, delivered. No returns.",
                   "I've carried fridges with more fight in them.",
                   "Tip your mover. Or don't. I'll take it anyway."],
        banter={"krane": ["You cuffed me to a meat locker door. I kept the door. Want it back?",
                          "Read me my rights, officer. I'll read you the stairs."],
                "freak": ["Big, ugly and heavy. You'll lift like a chest freezer.",
                          "Hold still. This is a two-man job, and I'm the only man."],
                "ricky": ["Twenty years you've paid me in steak, Ricky.",
                          "Tonight I'm collecting the whole cow."],
                "default": ["Hold still. I'm not paid by the hour.",
                            "You walked in. I'll walk you out. That's the service."]},
        ending='BRUNO "THE FRIDGE" carries the host out of the Control Room on one shoulder and the broadcast console '
               'on the other. He loads both into his old moving van and drives off before the credits roll. Nobody '
               "knows where he delivered them. The network's new office has a walk-in freezer, and it is always "
               'locked.')
    return K
