"""LOTUS LIU - stance drunken fist (Male_Drunk sway stance, CMU karate kicks/knees/lunges, Pro_Magic palm)."""
from kitlib import (Kit, air, authored, cmu, crouch, mix, seq, LV1, LV3, LV1_COST, LV3_COST)

DR = "Male_Drunk_Pack/"


def build():
    K = Kit(
        id="lotus", name="LOTUS LIU", persona="The Drunken Lotus", archetype="stance",
        body="Kachujin G Rosales", heightM=1.70, hp=9500, build="slim",
        walk=(2.12, 1.44), dash=(1.30, 0.80, 18, 23), jump=(4, 37, 3, 1.60, 1.45), throwRangeM=0.60,
        colors=[("Lotus Red", None), ("Jade", "#2e8b57"), ("Porcelain", "#f0ece2"), ("Plum Wine", "#6b1f3a")],
        intro="intro_sip", win=["win_sway", "win_sigh"], taunt="taunt_wobble", rival="rerun",
        stage="wheel_of_pain",
        cpu={"style": "stance", "rangeM": [1.0, 2.2], "approach": ["sway_h", "6M"], "pokes": ["5M", "2M"],
             "antiAir": ["rising_lotus_l", "2H"], "punish": ["5H", "rising_lotus_h"],
             "combo": ["2L", "5M", "dragon_breath_m"], "mixup": ["sway_oh", "sway_low", "sway_hop"],
             "meter": "bottoms_up"},
        doc=dict(
            difficulty=3, packs="Male_Drunk (sway stance/stumble), CMU karate kicks + knees + lunges",
            look="Kachujin: bun with bangs, red wrap dress with black obi, blue scarf, arm guards, grey greaves; "
                 "a gourd bottle prop (bow-bone meshes hidden, CONTRACT 5.4).",
            bio="Kung-fu film stunt double who played the drunk master in eleven movies and never once drank on "
                "set. On HIT PARADE the gourd is 'for the cameras'. Nobody who has fought her believes that.",
            plan="Stance pressure: SWAY (214 / 4S) leans away from high attacks and opens three follow-ups - "
                 "TIPSY TOE KICK (L, low), AXE KICK (M, overhead) and TORNADO HOP (H, throw-invulnerable hop over "
                 "lows). DRAGON'S BREATH is a short flame that stops dashes; LOTUS RISING is her DP.",
            weakness="Every stance follow-up has a readable tell and is minus on block (-9 / -4 / -2); low HP "
                     "(9500); the sway only dodges highs, so lows and throws beat the entry.",
            rivalry="Rerun ate her lucky gourd on the Wheel of Pain. She wants it back - or at least wants him "
                    "to regret it.",
        ),
    )

    K.clip("jab5", cmu("jab.5", rng=(1579, 1640)), "CMU jab.5 usable (17_10 orthodox lead jab 5.9 m/s; trimmed "
                                                    "before the step)")
    K.clip("lunge_palm", cmu("lunge_punch.2"), "CMU lunge_punch.2 (135_06 oi-zuki with a long step)")
    K.clip("drunk_round", cmu("roundhouse.4"), "CMU roundhouse.4 usable (135_01 turning kick 1.12 m, curved path)")
    K.clip("low_palm", crouch(cmu("jab.5", rng=(1579, 1640))), "Crouch Idle legs + CMU jab.5")
    K.clip("shin_kick", authored("crouch_shin_kick"), "AUTHORED crouch low roundhouse (shared authored motion)")
    K.clip("knee_lift", cmu("knee.5"), "CMU knee.5 usable (135_02 kata knee-lift from back stance) = anti-air knee")
    K.clip("wobble_palm", cmu(take="135_09", rng=(1886, 1932), contact=1914, kind="hand", limb="L_hand"),
           "CMU lunge_punch 135_09 1886/1914/1932 (left oi-zuki, usable) = stumbling step palm")
    K.clip("lean_kick", cmu("side_kick.3"), "CMU side_kick.3 clean (143_24 left 0.84 m, torso leans away)")
    K.clip("air_palm", air(cmu("lunge_punch.2")), "jump apex legs + lunge palm arms")
    K.clip("flying_front", cmu("front_kick.2"), "CMU front_kick.2 clean (135_04 mae-geri 1.16 m) played airborne")
    K.clip("flying_front_hi", cmu(take="144_10", rng=(2780, 2929), contact=2828, kind="foot", limb="L_foot"),
           "CMU front_kick 144_10 2763/2828/2929 (clean, left 1.39 m) played airborne")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9), "two-hand grab")
    K.clip("palm_launch", cmu("lunge_punch.1", rng=(289, 401)),
           "CMU lunge_punch.1 (135_09 oi-zuki; window extended to 401 per CMU_CLIPS note)")
    K.clip("wild_toss", cmu("hook.5", mirror=True), "CMU hook.5 clean (14_02 rear hook, mirrored) = wild swing toss")
    K.clip("sway_enter", mix(DR + "drunk idle variation (2)", (1, 24)), "Mixamo drunk idle variation (2) start "
                                                                       "(arms out for balance)")
    K.clip("sway_idle", mix(DR + "drunk idle variation (2)", (1, 162), loop=True),
           "stance idle: drunk idle variation (2) (loop error 0.6 deg)")
    K.clip("sway_walk", mix(DR + "drunk walk", (1, 91), loop=True), "stance walk forward: drunk walk")
    K.clip("sway_walk_b", mix(DR + "drunk walk backwards", (1, 48), loop=True), "stance walk back")
    K.clip("gourd_sweep", cmu(take="143_24", rng=(595, 657), contact=621, kind="foot", limb="R_foot"),
           "CMU front_kick 143_24 590/621/657 (clean: low 0.57 m front kick, returns to stance) = tipsy toe kick")
    K.clip("axe_kick", cmu(take="144_05", rng=(2235, 2345), contact=2268, kind="foot", limb="R_foot"),
           "CMU front_kick 144_05 2221/2268/2345 (usable: rising axe/crescent kick 1.32 m)")
    K.clip("tornado_hop", cmu("spin_kick.2"), "CMU spin_kick.2 usable (87_01 aerial tornado kick)")
    K.clip("sway_exit", mix(DR + "drunk idle variation", (90, 100)), "drunk idle variation f90-100")
    K.clip("dragon_palm", mix("Pro_Magic_Pack/Standing 2H Magic Attack 02", (25, 62), contact=43),
           "Mixamo 2H Magic Attack 02 double-palm thrust (front pass f43) = the flame jet push")
    K.clip("rising_knee", cmu("knee.4"), "CMU knee.4 usable (135_02 kata knee-lift) played rising = DP")
    K.clip("bottoms_seq", seq(cmu("lunge_punch.2"), cmu("roundhouse.4", rng=(3730, 3807)), cmu("knee.4"), xf=2),
           "SEQ: lunge palm + turning kick + rising knee")
    K.clip("intro_sip", mix(DR + "drunk idle", (1, 120)), "Mixamo drunk idle (sways)")
    K.clip("win_sway", mix(DR + "drunk walking turn", (1, 78)), "Mixamo drunk walking turn")
    K.clip("win_sigh", mix("Gestures_Pack_Basic/relieved sigh", (1, 91)), "Mixamo relieved sigh")
    K.clip("taunt_wobble", mix(DR + "drunk idle variation", (1, 120)), "Mixamo drunk idle variation")

    K.add("5L", "L", name="Tipsy Jab", clip="jab5", cancel=["chain:5L", "chain:2L", "special", "super"],
          role=["poke"], desc="Jab.")
    K.add("2L", "2L", name="Low Palm", clip="low_palm", cancel=["chain:2L", "chain:5L", "special", "super"],
          role=["poke", "low"], desc="Crouching palm to the shin.")
    K.add("5M", "M", name="Staggering Palm", clip="lunge_palm", move=[[0, 0], [8, 0.25]], cancel=["special", "super"],
          role=["poke"], desc="Lunging palm that steps in 0.25 m.")
    K.add("2M", "2M", name="Shin Kick", clip="shin_kick", cancel=["special", "super"], role=["poke", "low"],
          desc="Crouching low roundhouse.")
    K.add("5H", "H", name="Drunken Roundhouse", clip="drunk_round", startup=13, cancel=["special", "super"],
          desc="Curving turning kick.", why="Turning kick with a curved path: startup 12->13.")
    K.add("2H", "AA", name="Knee Lift", clip="knee_lift", juggle={"js": 1, "ji": 1, "jl": 0},
          cancel=["special", "super"], desc="Knee-lift anti-air.")
    K.add("6M", "CMD", input="6M", kind="command", name="Wobble Palm", clip="wobble_palm", startup=14, recovery=17,
          hitstun=22, blockstun=16, damage=700, move=[[0, 0], [14, 0.4]], role=["approach"],
          desc="Stumbling step-in palm (+2/-4).", why="Approach command normal: 0.4 m step, 14/3/17, 700.")
    K.add("4H", "CMD", input="4H", kind="command", name="Lean-Away Kick", clip="lean_kick", startup=15,
          hurtOverride=[{"f": [3, 14], "w": 0.40, "h": 1.30}],
          desc="Leans away from high attacks and kicks back (+3/-2).",
          why="Drunken evasion normal: upper body leans out of high attacks on frames 3-14 (hurtOverride), "
              "startup 16->15.")
    K.add("j.L", "jL", input="j.L", name="Air Palm", clip="air_palm", desc="Air palm.")
    K.add("j.M", "jM", input="j.M", name="Flying Front Kick", clip="flying_front", desc="Air front kick.")
    K.add("j.H", "jH", input="j.H", name="Flying High Kick", clip="flying_front_hi", desc="Long flying kick.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Palm Launch", clip="throw_reach",
          grab={"frames": 44, "adv": 21, "hitF": 30, "swap": False, "air": False, "techable": True,
                "clip": "palm_launch"}, desc="Grabs the collar and launches them with a lunging palm.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Wild Swing Toss", clip="throw_reach",
          grab={"frames": 46, "adv": 14, "hitF": 28, "swap": True, "air": False, "techable": True,
                "clip": "wild_toss"}, desc="Swings them past with a wild hook.")

    K.special("sway", None, motion="214",
              common=dict(name="Drunken Sway", clip="sway_enter", damage=0, hitstun=0, blockstun=0, hitstop=0,
                          gain=0, nerve=0, pb=(0.0, 0.0), guard="HL", cancel=[], stance="enter",
                          startup=4, active=10, recovery=4, role=["lowprofile"],
                          hurtOverride=[{"f": [4, 13], "w": 0.40, "h": 1.30}],
                          desc="Enters SWAY stance, leaning away from high attacks; L/M/H follow-ups.",
                          why="Stance entry (CONTRACT 5.3): 4/10/4 then the stance; the lean (0.40 x 1.30 m) "
                              "dodges highs only, so lows and throws beat it."),
              per={"l": dict(move=[[0, 0], [10, -0.3]], desc="Sways BACK 0.3 m into SWAY."),
                   "m": dict(desc="Sways in place into SWAY."),
                   "h": dict(move=[[0, 0], [12, 0.6]], role=["lowprofile", "approach"],
                             desc="Stumbles FORWARD 0.6 m into SWAY.")},
              ex=dict(name="Drunken Sway (EX)", startup=1, active=14, recovery=0,
                      invuln={"strike": [1, 12], "throw": [1, 12]},
                      desc="Invulnerable sway, straight into the stance.",
                      why="EX: strike+throw invulnerable 1-12 and no recovery before the stance."))
    flame = {"box": [0.55, 0.45], "y": 1.30, "hits": 2, "clip": "flame_breath", "x": 0.6, "speed": 5.0}
    K.special("dragon_breath", "proj", motion="236",
              common=dict(name="Dragon's Breath", clip="dragon_palm", recovery=26, hitstun=28, blockstun=24,
                          damage=700, cancel=["super"], role=["projectile"], sfx=[[0, "fire_whoosh"]],
                          desc="A swig and a short jet of flame (2 hits); range 1.8 / 2.3 / 2.8 m.",
                          why="Short-range flame, not a full-screen projectile: lifetime-capped (14/20/26 f at "
                              "5 m/s), so startup 13/14/15, recovery 26 and +1/-3 point blank; 700 over 2 hits."),
              per={"l": dict(startup=13, projectile=dict(flame, life=14, strength="L")),
                   "m": dict(startup=14, projectile=dict(flame, life=20, strength="M")),
                   "h": dict(startup=15, projectile=dict(flame, life=26, strength="H"))},
              ex=dict(name="Dragon's Breath (EX)", startup=12, damage=1100,
                      projectile=dict(flame, life=36, hits=3, strength="H", box=[0.8, 0.6]),
                      desc="Long 3-hit flame (3.6 m).", why="EX: 36-frame flame, 3 hits."))
    K.special("rising_lotus", "dp", motion="623",
              common=dict(name="Lotus Rising", clip="rising_knee", cancel=["super"], launch=[1.2, 6.0],
                          juggle={"js": 1, "ji": 1, "jl": 5}, role=["antiair", "reversal"],
                          sfx=[[1, "whoosh_heavy"]], desc="Rising flying knee; air-invulnerable anti-air."),
              per={"l": dict(hitstun=78, moveY=[[0, 0], [5, 0.1], [11, 0.8], [20, 0.75], [44, 0.0]]),
                   "m": dict(hitstun=87, moveY=[[0, 0], [6, 0.15], [13, 1.1], [24, 1.0], [55, 0.0]],
                             move=[[0, 0], [16, 0.4]]),
                   "h": dict(hitstun=94, moveY=[[0, 0], [7, 0.2], [15, 1.4], [27, 1.3], [63, 0.0]],
                             move=[[0, 0], [17, 0.7]])},
              ex=dict(name="Lotus Rising (EX)", startup=6, recovery=49, damage=1400, hitstun=88,
                      invuln={"strike": [1, 8], "throw": [1, 8], "air": [1, 8], "proj": [1, 8]},
                      hits=[{"f": [6, 7], "damage": 500, "hitstop": 9}, {"f": [12, 15], "damage": 900,
                                                                         "hitstop": 15}],
                      moveY=[[0, 0], [6, 0.2], [15, 1.5], [27, 1.4], [63, 0.0]],
                      desc="Fully invulnerable 2-hit knee.", why="1c: EX DP fully invulnerable 1-8, 2 hits."))
    fol = dict(kind="special", tc=True, stance="follow", hitstop=13, gain=800, nerve=3000)
    K.add("sway_low", None, input="sway>L", name="Tipsy Toe Kick", strength="M", clip="gourd_sweep", startup=10,
          active=3, recovery=22, hitstun=50, blockstun=16, damage=800, guard="L", pb=(0.0, 0.40), kd="soft",
          role=["low", "sweep"], desc="SWAY follow-up (L): stumbling low toe kick, knocks down, -9 on block.",
          why="Stance low: 10/3/22, KD +25, -9.", **fol)
    K.add("sway_oh", None, input="sway>M", name="Axe Kick", strength="M", clip="axe_kick", startup=18, active=3,
          recovery=18, hitstun=23, blockstun=17, damage=800, guard="H", pb=(0.30, 0.35),
          moveY=[[0, 0], [6, 0.3], [18, 0.1], [21, 0.0]], role=["overhead"],
          desc="SWAY follow-up (M): crescent axe kick overhead, +2 / -4.",
          why="Stance overhead: 18f (reactable), +2/-4.", **fol)
    K.add("sway_hop", None, input="sway>H", name="Tornado Hop", strength="H", clip="tornado_hop", startup=16,
          active=4, recovery=16, hitstun=24, blockstun=18, damage=900, guard="HL", pb=(0.30, 0.40),
          invuln={"throw": [1, 19]}, moveY=[[0, 0], [3, 0.2], [12, 0.9], [19, 0.2], [21, 0.0]],
          role=["approach"], desc="SWAY follow-up (H): throw-invulnerable hop over lows into a tornado kick.",
          why="Stance hop: airborne from f3 (beats lows and throws), +4/-2.", **fol)
    K.add("sway_exit", None, input="sway>2", name="Sober Up", strength="L", clip="sway_exit", startup=1, active=1,
          recovery=6, damage=0, hitstun=0, blockstun=0, guard="HL", stance="exit", kind="special", tc=True,
          desc="Leaves SWAY (press down, or after 90 frames).", why="Stance exit: 8 frames total.")

    K.add("bottoms_up", LV1, kind="super1", input="236236", name="Bottoms Up", strength="H", clip="bottoms_seq",
          active=31, recovery=52, hitstun=78,
          hits=[{"f": [8, 9], "damage": 500, "hitstop": 9}, {"f": [22, 23], "damage": 600, "hitstop": 9},
                {"f": [36, 38], "damage": 900, "hitstop": 20}],
          warp="auto", invuln={"strike": [1, 10], "throw": [1, 10]}, move=[[0, 0], [8, 0.5], [22, 1.0], [36, 1.4]],
          moveY=[[0, 0], [30, 0.0], [36, 0.6], [46, 0.0]], kd="soft", juggle={"js": 1, "ji": 0, "jl": 99},
          cost={"showtime": LV1_COST}, gain=0, nerve=600, role=["reversal"], sfx=[[1, "crowd_cheer_burst"]],
          desc="A swig, then palm, turning kick and rising knee - invulnerable startup.",
          why="1c Lv1: invulnerable 1-10; hits spaced 14 frames apart (the clip holds three separate CMU "
              "moves); recovery 52 -> -30 on block.")
    K.add("happy_hour", LV3, kind="super3", input="214214", name="Happy Hour", strength="H", clip="lunge_palm",
          invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 0.8]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic={"frames": 160, "cue": "lotus_happy_hour",
                     "hits": [[8, 400], [48, 600], [72, 700], [98, 900], [122, 1900]],
                     "anim": [[0, "lunge_palm"], [22, "sway_enter"], [40, "drunk_round"], [64, "axe_kick"],
                              [90, "rising_knee"], [115, "dragon_palm"], [140, "win_sway"]],
                     "victim": [[0, "hit_high_s"], [22, "dizzy"], [40, "hit_high_l"], [64, "hit_high_l"],
                                [90, "hit_air"], [115, "hit_air"], [128, "kd_fall_b"], [144, "kd_ground_b"]],
                     "shots": [[0, "side_close"], [22, "spotlight"], [40, "punch_in"], [64, "over_shoulder"],
                               [90, "low_angle_up"], [115, "front_low"], [122, "slowmo_hold"], [140, "crowd_pop"]],
                     "endAdv": 19, "endGapM": 2.4},
          desc="PRIME TIME: a lunging palm, a long swig, and a drunken beating that ends in a fire blast.",
          why="1c Lv3: 10/4/58, -42, 4500, fully invulnerable 1-13.")

    K.simple = {"5S": "dragon_breath_m", "6S": "sway_h", "2S": "rising_lotus_m", "4S": "sway_m",
                "S+H": "bottoms_up", "S+H+2": "happy_hour", "assist": ["2L", "5M", "5H", "dragon_breath_m"]}
    K.classic = [{"motion": "214", "btn": "LMH", "move": "sway_{s}"},
                 {"motion": "236", "btn": "LMH", "move": "dragon_breath_{s}"},
                 {"motion": "623", "btn": "LMH", "move": "rising_lotus_{s}"}]
    K.unique = {"kind": "stance", "name": "sway", "enter": ["sway_l", "sway_m", "sway_h", "sway_ex"], "maxF": 90,
                "followups": {"L": "sway_low", "M": "sway_oh", "H": "sway_hop"},
                "exit": {"2": "sway_exit", "timeout": "sway_exit"}, "blockExitF": 6,
                "walk": {"fwd": 1.60, "back": 1.10},
                "clips": {"idle": "sway_idle", "walk_f": "sway_walk", "walk_b": "sway_walk_b"}}
    K.cine_doc = [
        "f0 LUNGE PALM (side_close) - 400 at f8. f22 SWIG (spotlight): she stops for a long drink; the "
        "victim wobbles (dizzy).",
        "f40 DRUNKEN ROUNDHOUSE (punch_in) - 600. f64 AXE KICK (over_shoulder) - 700.",
        "f90 LOTUS RISING (low_angle_up): flying knee launches - 900.",
        "f115 DRAGON PALM (front_low -> slowmo_hold): the flame jet blasts them across the set - 1900 at f122.",
        "f140 WOBBLE (crowd_pop): she staggers away, sober as a judge (KD +19).",
    ]
    return K
