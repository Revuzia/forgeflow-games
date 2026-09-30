"""BONEYARD - big body with a cleaver (Pro_Melee_Axe pack: the cleaver sits in the axe grip)."""
from kitlib import (Kit, air, cam, cinematic, cmu, crouch, layer, mix, LV1, LV3, LV1_COST, LV3_COST)

AX = "Pro_Melee_Axe_Pack/"


def build():
    K = Kit(
        id="boneyard", name="BONEYARD", persona="The Butcher of Block Street", archetype="bigbody",
        body="Ch05_nonPBR", heightM=1.90, hp=10500, build="heavy",
        walk=(1.80, 1.20), dash=(0.95, 0.60, 20, 25), jump=(4, 40, 4, 1.50, 1.35), throwRangeM=0.68,
        colors=[("Butcher", None), ("Bone White", "#ece6d6"), ("Rust", "#8b3a1a"), ("Meat Locker", "#5d6d7e")],
        intro="intro_look", win=["win_shoulder", "win_look2"], taunt="taunt_thump", rival="johnny",
        stage="butcher_block",
        cpu={"style": "bigbody", "rangeM": [1.2, 2.2], "pokes": ["5M", "2M"], "antiAir": ["2H"],
             "punish": ["5H", "meat_hook_h"], "combo": ["2L", "5M", "meat_hook_m"],
             "armor": ["5H", "meat_hook_m", "chefs_special"], "approach": ["butcher_block_m", "cleaver_drop_l"],
             "meter": "chefs_special", "antiStep": ["2M", "ham_slam_l"]},
        doc=dict(
            difficulty=1, packs="Pro_Melee_Axe (cleaver in the axe grip: swings, chops, leap slam, taunts)",
            look="Ch05: bald, half the face painted white, scalp stitches, leather harness, fur pauldrons, "
                 "bone-spine necklace, spiked left gauntlet; a butcher's cleaver in the right hand (prop). "
                 "Cleaver hits are comic flat-side smacks - no realistic gore (owner rule).",
            bio="Runs the meat locker under the BUTCHER BLOCK set and has 'tenderised' four seasons of "
                "contestants. He took Johnny Riot's name off the marquee with the cleaver and hung it in the "
                "freezer as a trophy.",
            plan="Walk forward behind armored buttons: 5H and MEAT HOOK absorb a hit, BUTCHER'S BLOCK steps "
                 "through pokes into any special, CLEAVER DROP leaps in as an overhead, HAM SLAM is a low "
                 "ground-bounce launcher. Big damage per touch.",
            weakness="Big hurtbox, slow buttons, weak anti-air (2H only, no DP); armor loses to throws and "
                     "multi-hits; HAM SLAM is -13 to -17 on block.",
            rivalry="Johnny wants his marquee name back; Boneyard wants Johnny on the menu.",
            # CHANGED(FIGHTERS3D): 3D ring play (CONTRACT 35.12)
            ring=dict(
                stepping="CLEAVER DROP is a LINEAR leap (20-28f): step it and punish the landing. He does not out-step "
                         "anyone - he makes stepping expensive; BUTCHER'S BLOCK walks straight in along the line, so vs a "
                         "circling opponent he plants and swings instead of chasing.",
                homing="MEAT HOOK's two armored cleaver swings home through all 11 active frames (0.60 m deep): stepping "
                       "his slow startup gets hooked, and it wall-splats. 2M LOW CLEAVER (10f homing low, 0.40 m, -2) is "
                       "the anti-step poke; HAM SLAM's spin homes and launches; CHEF'S SPECIAL and SUNDAY ROAST home.",
                wall="MEAT HOOK and CHEF'S SPECIAL wall-splat: he walks them to the ring boundary behind armor and hooks "
                     "them into it; at the wall the 6H TENDERIZER overhead vs HAM SLAM low guess is his damage."),
        ),
    )

    # shared-clip overrides: the axe-pack stance holds the cleaver grip
    K.clip("idle", mix(AX + "standing idle", (1, 55), loop=True), "OVERRIDE shared idle: axe (cleaver) stance")
    K.clip("walk_f", mix(AX + "standing walk forward", (1, 41), loop=True), "OVERRIDE shared walk_f (loop 0.2 deg)")
    K.clip("walk_b", mix(AX + "standing walk back", (1, 42), loop=True), "OVERRIDE shared walk_b")
    K.clip("block_high", mix(AX + "standing block idle", (1, 51), loop=True),
           "OVERRIDE shared block_high: hands at the face, right hand curled on the cleaver")
    K.clip("crouch_idle", mix(AX + "crouch idle", (1, 51), loop=True), "OVERRIDE shared crouch_idle (axe crouch)")

    K.clip("gauntlet_jab", cmu("jab.6"), "CMU jab.6 usable (13_17 orthodox lead jab) = spiked-gauntlet jab")
    K.clip("snap_kick", mix(AX + "standing melee attack kick ver. 2", (5, 40), contact=24),
           "Mixamo axe kick ver. 2 front snap kick, front pass f24 (1.01 m)")
    K.clip("cleaver_swing", mix(AX + "standing melee combo attack ver. 1", (40, 80), contact=60),
           "Mixamo axe combo ver. 1 first swing (front pass f60; carries the weapon weight)")
    K.clip("stomp", cmu("stomp.1"), "CMU stomp.1 usable (135_01 knee lift + downward stamp)")
    K.clip("low_cleaver", crouch(mix(AX + "standing melee attack horizontal", (16, 52), contact=29),
                                 lower=mix(AX + "crouch idle", (1, 51), loop=True)),
           "LAYERED: axe crouch idle legs + axe horizontal swing arms = low cleaver sweep")
    K.clip("rising_backhand", mix(AX + "standing melee attack backhand", (15, 60), contact=32),
           "Mixamo axe backhand: rising backhand, passes the front at f32 and ends high")
    K.clip("chop_down", mix(AX + "standing melee attack downward", (8, 45), contact=26),
           "Mixamo axe downward overhead chop, contact f26 (render-confirmed)")
    K.clip("air_jab", air(cmu("jab.6")), "jump apex legs + gauntlet jab")
    K.clip("air_backhand", air(mix(AX + "standing melee attack backhand", (15, 60), contact=32)),
           "jump apex legs + rising backhand")
    K.clip("air_chop", air(mix(AX + "standing melee attack downward", (8, 45), contact=26)),
           "jump apex legs + overhead chop")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9), "two-hand grab")
    K.clip("three_swings", dict(mix(AX + "standing melee combo attack ver. 2", (15, 95), contact=30),
                                contacts=[30, 60, 80]),
           "Mixamo axe combo ver. 2: three swings f30/60/80 (flat-side smacks on the held victim); P2: the three "
           "swings are declared as marks (the throw and the Lv3 time the victim's reactions on them)")
    K.clip("over_shoulder", mix(AX + "standing disarm over shoulder", (1, 50), contact=10),
           "Mixamo axe disarm over shoulder: hauls something over his shoulder = throw behind")
    K.clip("meat_hook_swing", dict(mix(AX + "standing melee combo attack ver. 3", (15, 70), contact=30),
                                   contacts=[30, 49]),
           "Mixamo axe combo ver. 3: two swings, front passes f30 and f49")
    K.clip("cleaver_leap", mix(AX + "standing melee run jump attack", (30, 90), contact=53),
           "Mixamo axe run jump attack: leap, hands meet overhead, crouched landing smash f53")
    K.clip("ham_spin", mix(AX + "standing melee attack 360 low", (10, 60), contact=30),
           "Mixamo axe 360 low: crouched spinning low swing (reads right with the cleaver prop)")
    K.clip("block_step", layer(mix(AX + "standing walk forward", (1, 41), loop=True),
                               mix(AX + "standing block idle", (1, 36), loop=True), mode="sync"),
           "LAYERED: axe walk-forward legs + block-idle arms = armored step")
    K.clip("roast_swing", mix(AX + "standing melee combo attack ver. 1", (40, 80), contact=60),
           "axe combo ver. 1 first swing, fitted separately for the 10-frame Lv3 trigger")
    K.clip("chefs_combo", dict(mix(AX + "standing melee combo attack ver. 1", (40, 141), contact=60),
                               contacts=[60, 88]),
           "Mixamo axe combo ver. 1: two big swings (front passes f60, f88) with a step")
    K.clip("intro_look", mix(AX + "standing idle looking ver. 1", (1, 150)), "axe idle looking around")
    K.clip("win_shoulder", mix(AX + "unarmed equip over shoulder", (1, 51)), "rests the cleaver on his shoulder")
    K.clip("win_look2", mix(AX + "standing idle looking ver. 2", (1, 120)), "axe idle looking ver. 2")
    K.clip("taunt_thump", mix(AX + "standing taunt chest thump", (1, 77)), "Mixamo chest-thump taunt")

    K.add("5L", "L", name="Gauntlet Jab", clip="gauntlet_jab", startup=6, recovery=10,
          cancel=["chain:2L", "special", "super"], role=["poke"], desc="Spiked-gauntlet jab.",
          why="Big-body lights are a frame slower: 6/3/10 (+2/-3).")
    K.add("2L", "2L", name="Boot Stomp", clip="stomp", startup=7, hurtOverride=[{"f": [1, 16], "w": 0.65,
                                                                                 "h": 1.80}],
          cancel=["chain:2L", "special", "super"], role=["poke", "low"], desc="Stamps on the toes (low).",
          why="The stomp needs its knee lift (startup 7) and he stays tall (standing hurtbox).")
    K.add("5M", "M", name="Snap Kick", clip="snap_kick", startup=9, recovery=17, cancel=["special", "super"],
          role=["poke"], desc="Front snap kick.", why="Big body: 9/3/17 (+2/-4).")
    K.add("2M", "2M", name="Low Cleaver", clip="low_cleaver", startup=10, damage=700, cancel=["special", "super"],
          role=["poke", "low", "antistep"], homing=True, lateralM=0.40,
          why3d="crouching cleaver swing: homing anti-step low, 0.40 m deep",
          desc="Crouching cleaver swing (low); homing; cancel into MEAT HOOK.",
          why="Cleaver weight: startup 10 for 700 damage.")
    K.add("5H", "H", name="Cleaver Swing", clip="cleaver_swing", startup=14, recovery=21, damage=1000,
          armor={"hits": 1, "f": [5, 13]}, cancel=["special", "super"], sfx=[[9, "whoosh_heavy"]],
          desc="Armored overhand cleaver swing (1 hit of armor on frames 5-13).",
          why="Big-body armored heavy (FIGHTING_DESIGN 8c): 14/3/21, 1000, +1/-4, 1 hit of armor 5-13.")
    K.add("2H", "AA", name="Rising Backhand", clip="rising_backhand", startup=10, recovery=22,
          juggle={"js": 1, "ji": 1, "jl": 0}, cancel=["special", "super"],
          desc="Rising backhand anti-air (his only one).", why="Big body: 10/4/22 (+1/-7).")
    K.add("6H", "OH", input="6H", kind="command", name="Tenderizer", clip="chop_down", startup=20, damage=800,
          sfx=[[12, "whoosh_heavy"]], desc="Overhead cleaver chop (+2/-4).",
          why="Cleaver overhead: 20f and 800 (the weight is in the startup).")
    K.add("j.L", "jL", input="j.L", name="Air Jab", clip="air_jab", startup=6, desc="Air jab.",
          why="Big body: startup 6.")
    K.add("j.M", "jM", input="j.M", name="Air Backhand", clip="air_backhand", desc="Air backhand.")
    K.add("j.H", "jH", input="j.H", name="Falling Cleaver", clip="air_chop", desc="Overhead cleaver jump-in.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Three Cuts", clip="throw_reach", damage=1300,
          grab={"frames": 66, "adv": 21, "hitF": 54, "swap": False, "air": False, "techable": True,
                "clip": "three_swings",
                # P2 paired throw: lock 52 -> 66 (2.67 s of swings at 2.4x, was 3.1x); the smacks land at clip 0.50 /
                # 1.50 / 2.17 s = lock 12 / 37 / 54: head, body, and the third drops them (kd_fall_b, face up).
                "victim": [[0, "hit_high_s", 0.0, 0.15], [12, "hit_high_s", 0.0, 0.6], [37, "hit_body", 0.1, 0.6],
                           [54, "kd_fall_b", 1.04, 1.5]]},
          desc="Holds them and delivers three flat-side cleaver smacks.",
          why="Big-body throw: 1300.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Over the Shoulder", clip="throw_reach",
          damage=1300, grab={"frames": 46, "adv": 15, "hitF": 28, "swap": True, "air": False, "techable": True,
                             "clip": "over_shoulder",
                             # P2 paired throw: he hauls them up (lock 10-17) and over his shoulder (hands above and
                             # behind the head at lock 17-28, clip 0.6-1.0 s) and turns away; thrown_b flips them over
                             # (0.10 -> 0.53 s) and slams them face down behind him at lock ~31.
                             "victim": [[0, "hit_body", 0.0, 0.2], [10, "thrown_b", 0.1, 0.53],
                                        [28, "thrown_b", 0.53, 1.2]]},
          desc="Hauls them over his shoulder.",
          why="Big-body throw: 1300.")

    hook = {}
    for s, (st, arm, d1, d2, mv) in {"l": (18, (1, [4, 17]), 500, 600, 0.4), "m": (22, (1, [4, 21]), 550, 650, 0.7),
                                     "h": (26, (2, [4, 25]), 600, 700, 1.0)}.items():
        hook[s] = dict(startup=st, damage=d1 + d2, armor={"hits": arm[0], "f": arm[1]},
                       hits=[{"f": [st, st + 1], "damage": d1, "hitstop": 13},
                             {"f": [st + 9, st + 10], "damage": d2, "hitstop": 15}],
                       move=[[0, 0], [st, mv]])
    K.special("meat_hook", None, motion="236",
              common=dict(name="Meat Hook", clip="meat_hook_swing", active=11, recovery=24, hitstun=56, blockstun=20,
                          hitstop=15, guard="HL", gain=1000, nerve=5000, pb=(0.0, 0.50), kd="soft", wallSplat=True,
                          cancel=["super"], role=["wallsplat"], sfx=[[2, "whoosh_heavy"]], homing=True,
                          why3d="two wide cleaver swings: homing through all active frames (a step into the slow startup "
                                "is hooked)",
                          desc="Slow armored two-swing heavy; homing; wall-splats in the corner.",
                          why="FIGHTING_DESIGN 8c MEAT HOOK (slow 2-hit armored heavy, 22f, wall splat): L 18 / "
                              "M 22 / H 26 startup with armor through startup (H 2 hits), -6 on block, KD +30."),
              per=hook,
              ex=dict(name="Meat Hook (EX)", startup=16, recovery=21, damage=1500, hitstun=53,
                      armor={"hits": 2, "f": [1, 17]}, move=[[0, 0], [16, 0.8]],
                      hits=[{"f": [16, 17], "damage": 700, "hitstop": 13}, {"f": [25, 26], "damage": 800,
                                                                           "hitstop": 15}],
                      desc="Faster, 2-hit armor from frame 1, -3 on block.", why="EX: 16f, 2-hit armor, -3."))
    K.special("cleaver_drop", None, motion="214",
              common=dict(name="Cleaver Drop", clip="cleaver_leap", active=3, blockstun=20, hitstop=15, guard="H",
                          gain=1000, nerve=4000, pb=(0.30, 0.40), cancel=["super"], role=["overhead", "approach"],
                          sfx=[[6, "whoosh_heavy"]], linear=True,
                          why3d="a 1-2.6 m leap along its frame-1 line: linear",
                          desc="Leaping overhead cleaver smash (hops over lows).",
                          why="FIGHTING_DESIGN 8c CHOP (overhead 20f, +2) as a leap: 20/24/28 startup, +1/-1/-3 "
                              "on block, H knocks down."),
              per={"l": dict(startup=20, recovery=16, damage=900, hitstun=23, move=[[0, 0], [20, 1.0]],
                             moveY=[[0, 0], [4, 0.2], [12, 1.0], [22, 0.0]]),
                   "m": dict(startup=24, recovery=18, damage=1000, hitstun=23, move=[[0, 0], [24, 1.8]],
                             moveY=[[0, 0], [4, 0.2], [14, 1.3], [26, 0.0]]),
                   "h": dict(startup=28, recovery=20, damage=1100, hitstun=53, kd="soft", move=[[0, 0], [28, 2.6]],
                             moveY=[[0, 0], [4, 0.2], [16, 1.6], [30, 0.0]])},
              ex=dict(name="Cleaver Drop (EX)", startup=18, active=8, recovery=18, damage=1300, hitstun=51,
                      kd="soft", groundBounce=True, move=[[0, 0], [18, 1.8]],
                      moveY=[[0, 0], [4, 0.2], [11, 1.2], [20, 0.0]],
                      hits=[{"f": [18, 19], "damage": 700, "hitstop": 13}, {"f": [24, 25], "damage": 600,
                                                                           "hitstop": 15}],
                      desc="Leap + landing shockwave, ground bounce.", why="EX: 18f, 2 hits, ground bounce."))
    K.special("ham_slam", None, motion="22",
              common=dict(name="Ham Slam", clip="ham_spin", active=3, blockstun=18, hitstop=15, guard="L",
                          gain=1000, nerve=4000, pb=(0.0, 0.45), kd="soft", groundBounce=True, launch=[0.5, 4.0],
                          juggle={"js": 1, "ji": 1, "jl": 4}, cancel=["super"], role=["low", "launcher"],
                          sfx=[[4, "whoosh_heavy"]], homing=True, why3d="spinning low swing: homing, 0.60 m deep",
                          desc="Spinning low cleaver swing that bounces them for a juggle.",
                          why="FIGHTING_DESIGN 8c HAM SLAM (ground bounce launcher): low, 14/16/18, -13/-15/-17."),
              per={"l": dict(startup=14, recovery=28, damage=900, hitstun=60),
                   "m": dict(startup=16, recovery=30, damage=1000, hitstun=62),
                   "h": dict(startup=18, recovery=32, damage=1100, hitstun=64)},
              ex=dict(name="Ham Slam (EX)", startup=12, active=9, recovery=26, damage=1300, hitstun=58,
                      hits=[{"f": [12, 13], "damage": 600, "hitstop": 11}, {"f": [18, 20], "damage": 700,
                                                                           "hitstop": 15}],
                      desc="Two spins, -11 on block.", why="EX: 12f, 2 hits, -11."))
    K.special("butcher_block", None, motion="421",
              common=dict(name="Butcher's Block", clip="block_step", damage=0, hitstun=0, blockstun=0, hitstop=0,
                          gain=0, nerve=0, pb=(0.0, 0.0), guard="HL", cancel=["whiff", "special"],
                          role=["approach"], startup=3, active=16, armor={"hits": 1, "f": [3, 18]},
                          desc="Armored step with the cleaver up; cancels into any special.",
                          why="armorStep unique: 1-hit armor 3-18, cancel into MEAT HOOK / CLEAVER DROP."),
              per={"l": dict(recovery=8, move=[[0, 0], [18, 0.3]]), "m": dict(recovery=10, move=[[0, 0], [18, 0.6]]),
                   "h": dict(recovery=12, move=[[0, 0], [18, 0.9]])},
              ex=dict(name="Butcher's Block (EX)", startup=1, active=20, recovery=8, armor={"hits": 2, "f": [1, 20]},
                      move=[[0, 0], [20, 1.0]], desc="2-hit armor from frame 1.", why="EX: 2-hit armor from f1."))

    K.add("chefs_special", LV1, kind="super1", input="236236", name="Chef's Special", strength="H",
          clip="chefs_combo", startup=10, active=21, recovery=54, hitstun=78,
          hits=[{"f": [10, 11], "damage": 900, "hitstop": 9}, {"f": [30, 30], "damage": 1100, "hitstop": 20}],
          warp="auto", armor={"hits": 99, "f": [1, 30]}, invuln={"throw": [1, 10]},
          move=[[0, 0], [10, 1.0], [30, 2.0]], kd="soft", wallSplat=True, juggle={"js": 1, "ji": 0, "jl": 99},
          cost={"showtime": LV1_COST}, gain=0, nerve=600, role=["reversal", "wallsplat"],
          sfx=[[1, "crowd_cheer_burst"]], desc="Super-armored charge with two cleaver swings.",
          why="Big-body Lv1 = armored charge (FIGHTING_DESIGN 8c): super armor 1-30 instead of invulnerability "
              "(armor loses to throws, so throw-invulnerable 1-10 only), startup 10, -30 on block.")
    K.add("sunday_roast", LV3, kind="super3", input="214214", name="Sunday Roast", strength="H",
          clip="roast_swing", invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 0.8]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic=lambda: cinematic(
              170, "boneyard_sunday_roast",
              hits=[[8, 500], [32, 600], [50, 600], [70, 300], [94, 300], [128, 2200]],
              anim=[K.seg(0, "cleaver_swing", 25, hit=8), K.seg(25, "meat_hook_swing", 60, hit=32, rate=2.11),
                    K.seg(60, "three_swings", 100, hit=70, rate=2.5), K.seg(100, "cleaver_leap", 145, hit=128),
                    K.seg(145, "taunt_thump", 170, fromS=0.5)],
              victim=[[0, "hit_high_l", 0.0, 0.4], [8, "hit_high_l", 0.0, 0.45], [32, "hit_body", 0.0, 0.35],
                      [50, "hit_high_s", 0.0, 0.5], [70, "hit_high_s", 0.0, 0.5], [94, "hit_body", 0.1, 0.7],
                      [128, "kd_fall_b", 1.25, 1.8667], [148, "kd_ground_b", 0.0, 0.367]],
              camera=[cam(0, 25, "close", "both", 32, 2.5, 1.5, 15),
                      cam(25, 60, "close", "defender", [32, 28], [2.2, 1.8], 1.6, 38),
                      cam(60, 100, "over_shoulder", "defender", 36, 2.4, 1.8, -65),
                      cam(100, 128, "low", "attacker", 44, 3.2, 0.35, 20, lookH=1.9),
                      cam(128, 145, "top", "defender", 40, 1.4, 5.4, 10, lookH=0.5),
                      cam(145, 170, "close", "attacker", 32, 2.6, 1.55, 30)],
              fx=[(0, "slate"), (8, "impact_m"), (8, "sparks"), (32, "impact_m"), (50, "impact_m"), (50, "shake_s"),
                  (70, "impact_s"), (94, "impact_m"), (110, "speed_lines"), (128, "impact_l"), (128, "splat"),
                  (128, "flash"), (128, "shake_l"), (128, "dust"), (128, "freeze_frame"), (145, "spot", "attacker"),
                  (166, "spot_off")],
              crowd=[(8, "gasp"), (50, "ooh"), (94, "boo"), (128, "roar", "spike"), (148, "chant", "peak")],
              pathA=[[8, 0.1, 0], [32, 0.2, 0], [50, 0.3, 0], [94, 0.35, 0], [110, 0.2, 0.3], [120, 0.5, 1.2],
                     [128, 0.9, 0.1], [132, 0.9, 0], [150, 0.8, 0], [168, 0, 0]],
              gapD=[[8, 1.1, 0], [32, 1.0, 0], [50, 1.05, 0], [70, 1.0, 0], [94, 1.0, 0], [110, 1.2, 0],
                    [128, 0.7, 0], [132, 0.9, 0], [168, 1.8, 0]],
              slate="PRIME TIME - BONEYARD: SUNDAY ROAST", endPose="back", endAdv=19, endGapM=1.8),
          desc="PRIME TIME: a cleaver swing that starts the full butchery demonstration (flat-side smacks).",
          why="1c Lv3: 10/4/58, -42, 4500, fully invulnerable 1-13.")

    K.simple = {"5S": "meat_hook_m", "6S": "cleaver_drop_m", "2S": "ham_slam_m", "4S": "butcher_block_m",
                "S+H": "chefs_special", "S+H+2": "sunday_roast", "assist": ["5L", "5M", "5H", "meat_hook_m"]}
    K.classic = [{"motion": "236", "btn": "LMH", "move": "meat_hook_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "cleaver_drop_{s}"},
                 {"motion": "22", "btn": "LMH", "move": "ham_slam_{s}"},
                 {"motion": "421", "btn": "LMH", "move": "butcher_block_{s}"}]
    K.unique = {"kind": "armorStep", "steps": ["butcher_block_l", "butcher_block_m", "butcher_block_h",
                                               "butcher_block_ex"],
                "armored": ["5H", "meat_hook_l", "meat_hook_m", "meat_hook_h", "meat_hook_ex", "butcher_block_l",
                            "butcher_block_m", "butcher_block_h", "butcher_block_ex", "chefs_special"]}
    K.cine_doc = [
        "f0 CLEAVER SWING (close, sparks) - 500 at f8.",
        "f25 MEAT HOOK (punch-in on the defender): two swings at 2.1x - 600 + 600 (f32 / f50).",
        "f60 THREE CUTS (over his shoulder): flat-side smacks on the butcher block - 300 + 300 (f70 / f94); the "
        "crowd boos the butcher.",
        "f100 CLEAVER DROP (low, looking up at the 1.2 m leap -> top-down): smashes them flat - 2200 at f128 "
        "(comic splat, flash, freeze-frame, dust).",
        "f145 CHEST THUMP (close, spotlight): 'Order up!' Opponent face up at 1.8 m (KD +19).",
    ]
    K.text = dict(
        introLine="Take a number. The butcher's open.",
        winQuotes=["Order up. Tenderized, flat side, well done.",
                   "I hang the good ones in the freezer. You're a keeper.",
                   "No refunds on Block Street."],
        banter={"johnny": ["Your name's hanging in my freezer, rock star. Next to the ribs.",
                           "Tonight I carve the rest of the marquee."],
                "freak": ["They grew you in my basement. You owe me rent.",
                          "Big cut, tough meat. I've got the cleaver for it."],
                "ricky": ["Four seasons I tenderized your contestants, Ricky.",
                          "Tonight I work on the host."],
                "default": ["Step up to the counter.",
                            "Relax. I only use the flat side. Mostly."]},
        ending="BONEYARD hangs the host's sequined jacket in the meat locker next to Johnny Riot's marquee letters and "
               "locks the door. KNOCKOUT 13 cancels HIT PARADE and replaces it with a cooking show, and Boneyard is "
               "the only chef who stays. His signature dish is called The Sunday Roast. Nobody has ever sent it back.")
    return K
