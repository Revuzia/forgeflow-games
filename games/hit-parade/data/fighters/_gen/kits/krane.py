"""OFFICER KRANE - charge, riot shield + baton (Pro_Sword_and_Shield pack: shield-left, baton-right)."""
from kitlib import (Kit, air, crouch, layer, mix, seq, LV1, LV3, LV1_COST, LV3_COST)

SS = "Pro_Sword_and_Shield_Pack/"


def build():
    K = Kit(
        id="krane", name="OFFICER KRANE", persona="Riot Act", archetype="charge",
        body="Swat", heightM=1.82, hp=10000, build="average",
        walk=(1.94, 1.44), dash=(1.18, 0.56, 19, 24), jump=(4, 39, 3, 1.55, 1.40), throwRangeM=0.60,
        colors=[("Riot Blue", None), ("Night Shift", "#1b2a3a"), ("Hi-Vis", "#e6ff00"),
                ("Internal Affairs", "#7a7a7a")],
        intro="intro_draw", win=["win_holster", "win_rally"], taunt="taunt_rally", rival="bruno",
        stage="control_room",
        cpu={"style": "charge", "rangeM": [1.6, 3.5], "zoning": ["taser_m"], "antiAir": ["baton_flip_l", "2H"],
             "pokes": ["5M", "2M", "4H"], "punish": ["5H", "shield_rush_h"], "combo": ["2M", "taser_h"],
             "grab": ["cuff_m"], "meter": "backup", "charge": True},
        doc=dict(
            difficulty=2, packs="Pro_Sword_and_Shield (shield idle/block/crouch + 1H baton swings)",
            look="Swat: blue-grey uniform, black tactical vest, helmet with goggles, gloves, knee pads, face "
                 "exposed; riot shield on the left forearm, baton in the right hand (props).",
            bio="Twenty years on the riot line until Internal Affairs decided he enjoyed it. The network hired "
                "him as 'Stage Security' - then noticed the ratings when he worked the crowd. Now he is on the "
                "card, and he still reads opponents their rights.",
            plan="Sit in down-back: TASER SHOT (charge projectile, -3) controls the lane, BATON FLIP (charge "
                 "anti-air, air-invulnerable) swats jumps, SHIELD RUSH (armored on H) and UNDER ARREST (short "
                 "command grab) punish turtles. Standing block drains 50% less NERVE (riot shield).",
            weakness="Charge makes him predictable and weak when forced to walk forward; the shield passive does "
                     "not cover crouch block, so lows and throws open him up.",
            rivalry="Krane cuffed Bruno to a meat locker door; Bruno walked off with the door. Krane wants his "
                    "cuffs back.",
        ),
    )

    # shared-clip overrides (CONTRACT 20.5): the S&S idle/walk/block/crouch are SHIELD poses - only Krane
    K.clip("idle", mix(SS + "sword and shield idle", (1, 109), loop=True), "OVERRIDE shared idle: shield stance")
    K.clip("walk_f", mix(SS + "sword and shield walk", (1, 34), loop=True), "OVERRIDE shared walk_f (loop 0.0 deg)")
    K.clip("walk_b", mix(SS + "sword and shield walk (2)", (1, 39), loop=True), "OVERRIDE shared walk_b")
    K.clip("block_high", mix(SS + "sword and shield block idle", (1, 42), loop=True),
           "OVERRIDE shared block_high: shield up (loop 0.3 deg)")
    K.clip("block_low", mix(SS + "sword and shield crouch block idle", (1, 9), loop=True),
           "OVERRIDE shared block_low: crouched behind the shield")
    K.clip("crouch_idle", mix(SS + "sword and shield crouch idle", (1, 73), loop=True),
           "OVERRIDE shared crouch_idle (hips 0.44 m measured)")

    ss_crouch = mix(SS + "sword and shield crouch idle", (1, 73), loop=True)
    K.clip("baton_poke", mix(SS + "sword and shield attack (4)", (4, 31), contact=15),
           "Mixamo S&S attack (4): quick 1H baton poke, auto contact f15 (in place)")
    K.clip("baton_chop", mix(SS + "sword and shield slash", (8, 40), contact=19),
           "Mixamo S&S slash: vertical baton chop, front pass f19")
    K.clip("baton_swing", mix(SS + "sword and shield attack (2)", (5, 40), contact=18),
           "Mixamo S&S attack (2): horizontal swing, front pass f18 (root travel stripped)")
    K.clip("low_poke", crouch(mix(SS + "sword and shield attack (3)", (1, 53), contact=23), lower=ss_crouch),
           "S&S crouch idle legs + S&S attack (3) upper: the dipping low baton thrust (inventory hit f23 RightHand 0.81 m, hips 0.65 m) on crouched legs = a shin poke. Replaced the attack (4) upper (2026-09-30): that poke is aimed at head height, so on crouched legs it still landed at 1.42 m and the LOW never hit a crouching opponent in the sim (connect matrix)")
    K.clip("knee_rap", mix(SS + "sword and shield slash (5)", (5, 40), contact=19),
           "Mixamo S&S slash (5): crouched 1H swing (hips 0.45-0.61 m) = low baton rap")
    K.clip("rising_baton", mix(SS + "sword and shield slash (3)", (10, 45), contact=25),
           "Mixamo S&S slash (3): rising 1H swing, arm high by f30 (front pass f25)")
    K.clip("shield_block", mix(SS + "sword and shield block", (1, 18), contact=11),
           "Mixamo S&S block: left forearm (shield) thrust forward = shield bash")
    K.clip("boot", mix(SS + "sword and shield kick", (5, 37), contact=19),
           "Mixamo S&S kick: front kick right, front pass f19 (1.06 m)")
    K.clip("hop_chop", mix(SS + "sword and shield attack", (20, 60), contact=35),
           "Mixamo S&S attack: hop overhead chop (weapon-hand front pass f35)")
    K.clip("air_poke", air(mix(SS + "sword and shield attack (4)", (4, 31), contact=15)), "jump legs + baton poke")
    K.clip("air_chop", air(mix(SS + "sword and shield slash", (8, 40), contact=19)), "jump legs + baton chop")
    K.clip("air_swing", air(mix(SS + "sword and shield attack (2)", (5, 40), contact=18)), "jump legs + swing")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9), "two-hand grab")
    K.clip("book_em", mix(SS + "sword and shield slash (2)", (10, 100), contact=22),
           "Mixamo S&S slash (2): four baton swings (f22/38/49/76) = a baton beating")
    K.clip("perp_walk", mix(SS + "sword and shield 180 turn (2)", (1, 26)),
           "Mixamo S&S 180 turn (2): turns with them and shoves them past (back throw; the clip turns 180, "
           "CONTRACT 20.2 grab.swap)")
    K.clip("taser_fire", mix(SS + "sword and shield casting (2)", (1, 32), contact=8),
           "Mixamo S&S casting (2): the shield hand thrusts forward (LeftHand f8) = taser fired from the shield")
    K.clip("baton_flip_rise",
           layer(mix(SS + "sword and shield jump (2)", (1, 30)), mix(SS + "sword and shield slash (3)", (10, 45),
                                                                    contact=25), mode="sync"),
           "LAYERED: S&S jump (2) legs (apex f16 measured) + rising baton swing = flip anti-air")
    K.clip("shield_charge",
           layer(mix(SS + "sword and shield run", (1, 22), loop=True), mix(SS + "sword and shield block", (1, 18),
                                                                          contact=11), mode="loop"),
           "LAYERED: S&S run legs + shield-forward arms = shield charge")
    K.clip("cuff_pin", mix(SS + "sword and shield crouch block (2)", (1, 21)),
           "Mixamo S&S crouch block (2): kneels over the pinned opponent behind the shield (cuffing)")
    charge = layer(mix(SS + "sword and shield run", (1, 22), loop=True),
                   mix(SS + "sword and shield block", (1, 18), contact=11), mode="loop")
    K.clip("backup_combo", seq(charge, charge, mix(SS + "sword and shield attack (2)", (5, 40), contact=18), xf=2),
           "SEQ: two shield charges (one shield hit each) + horizontal baton swing")
    K.clip("intro_draw", mix(SS + "draw sword 2", (1, 24)), "Mixamo draw sword 2 = draws the baton")
    K.clip("win_holster", mix(SS + "sheath sword 2", (1, 25)), "Mixamo sheath sword 2 = holsters the baton")
    K.clip("win_rally", mix(SS + "sword and shield idle (4)", (1, 76)), "Mixamo S&S idle (4) (shield at rest)")
    K.clip("taunt_rally", mix(SS + "sword and shield power up", (1, 72)),
           "Mixamo S&S power up: rally flex, arms spread (usable unarmed per MIXAMO_CLIPS)")

    K.add("5L", "L", name="Baton Poke", clip="baton_poke", cancel=["chain:5L", "chain:2L", "special", "super"],
          role=["poke"], desc="Quick baton jab.")
    K.add("2L", "2L", name="Low Poke", clip="low_poke", cancel=["chain:2L", "chain:5L", "special", "super"],
          role=["poke", "low"], desc="Crouching baton poke to the shin (holds down-back charge).")
    K.add("5M", "M", name="Baton Chop", clip="baton_chop", cancel=["special", "super"], role=["poke"],
          sfx=[[5, "whoosh_light"]], desc="Vertical baton chop.")
    K.add("2M", "2M", name="Knee Rap", clip="knee_rap", cancel=["special", "super"], role=["poke", "low"],
          desc="Crouching baton rap; cancel into TASER SHOT while charging.")
    K.add("5H", "H", name="Baton Swing", clip="baton_swing", cancel=["special", "super"], sfx=[[8, "whoosh_heavy"]],
          desc="Horizontal baton swing.")
    K.add("2H", "AA", name="Rising Baton", clip="rising_baton", juggle={"js": 1, "ji": 1, "jl": 0},
          cancel=["special", "super"], desc="Rising baton anti-air.")
    K.add("4H", "CMD", input="4H", kind="command", name="Shield Bash", clip="shield_block", startup=14,
          pb=(0.60, 0.90), desc="Shield shove; pushes them out to taser range (+4/-1).",
          why="Charge-friendly command normal (hold back): 14f, +4 hit / -1 block, big block pushback 0.9 m "
              "so it resets to his range instead of starting pressure.",
          hitstun=27, blockstun=22)
    K.add("6M", "M", input="6M", kind="command", name="Front Boot", clip="boot", startup=9, recovery=17,
          pb=(0.35, 0.45), desc="Front kick, longer than 5M.",
          why="Kick command normal: 9/3/17 (+2/-4) for 1.06 m reach.")
    K.add("6H", "OH", input="6H", kind="command", name="Nightstick Drop", clip="hop_chop",
          moveY=[[0, 0], [6, 0.35], [15, 0.2], [18, 0.0]], desc="Hopping overhead chop.")
    K.add("j.L", "jL", input="j.L", name="Air Poke", clip="air_poke", desc="Air baton poke.")
    K.add("j.M", "jM", input="j.M", name="Air Chop", clip="air_chop", desc="Air baton chop.")
    K.add("j.H", "jH", input="j.H", name="Air Swing", clip="air_swing", desc="Wide air baton swing.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Book 'Em", clip="throw_reach",
          grab={"frames": 50, "adv": 21, "hitF": 36, "swap": False, "air": False, "techable": True,
                "clip": "book_em"}, desc="Holds them with the shield and lays in four baton shots.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Perp Walk", clip="throw_reach",
          grab={"frames": 44, "adv": 14, "hitF": 30, "swap": True, "air": False, "techable": True,
                "clip": "perp_walk"}, desc="Turns them around and shoves them with the shield.")

    taser = {"life": 180, "box": [0.30, 0.25], "y": 1.20, "hits": 1, "clip": "taser_bolt", "x": 0.6}
    K.special("taser", "proj", motion="[4]6",
              common=dict(name="Taser Shot", clip="taser_fire", startup=10, recovery=30, hitstun=34, blockstun=28,
                          damage=550, cancel=["super"], role=["projectile"], sfx=[[0, "electric_zap"]],
                          desc="Charge projectile ([4]6): 10f, +3 hit / -3 block point blank.",
                          why="Charge projectile = the Sonic Boom row (1a/1c: startup 10, recovery 30, +3/-3, "
                              "550): charge time pays for the speed."),
              per={s: dict(projectile=dict(taser, speed=v, strength=s.upper()))
                   for s, v in (("l", 4.5), ("m", 6.0), ("h", 7.5))},
              ex=dict(name="Taser Shot (EX)", damage=900, projectile=dict(taser, speed=7.5, hits=2, strength="H"),
                      desc="Double-barb taser: 2 hits.", why="EX: 2 hits at the fastest speed."))
    K.special("baton_flip", "dp", motion="[2]8",
              common=dict(name="Baton Flip", clip="baton_flip_rise", active=8, cancel=["super"], launch=[1.2, 5.5],
                          juggle={"js": 1, "ji": 1, "jl": 5}, role=["antiair"], sfx=[[1, "whoosh_heavy"]],
                          desc="Charge anti-air ([2]8): rising baton flip, air-invulnerable.",
                          why="Charge anti-air = the Somersault row (1a: 5/6/7, air-inv 1-7/1-8/1-9, -30..-32): "
                              "active 8, recovery 42/43/44, damage 1000/1100/1200."),
              per={"l": dict(recovery=42, damage=1000, hitstun=85, invuln={"air": [1, 7]},
                             moveY=[[0, 0], [5, 0.2], [11, 1.0], [20, 0.9], [50, 0.0]]),
                   "m": dict(recovery=43, damage=1100, hitstun=86, invuln={"air": [1, 8]},
                             moveY=[[0, 0], [6, 0.2], [12, 1.2], [22, 1.1], [52, 0.0]]),
                   "h": dict(recovery=44, damage=1200, hitstun=87, invuln={"air": [1, 9]},
                             moveY=[[0, 0], [7, 0.2], [13, 1.4], [24, 1.3], [54, 0.0]])},
              ex=dict(name="Baton Flip (EX)", startup=5, recovery=44, damage=1400, hitstun=86,
                      invuln={"strike": [1, 9], "throw": [1, 9], "air": [1, 9], "proj": [1, 9]},
                      hits=[{"f": [5, 6], "damage": 600, "hitstop": 11}, {"f": [9, 12], "damage": 800,
                                                                         "hitstop": 15}],
                      moveY=[[0, 0], [5, 0.3], [12, 1.4], [23, 1.3], [53, 0.0]], role=["antiair", "reversal"],
                      desc="Fully invulnerable 2-hit flip.", why="EX: fully invulnerable 1-9, 2 hits."))
    K.special("shield_rush", "rush", motion="236",
              common=dict(name="Shield Rush", clip="shield_charge", cancel=["super"], role=["approach"],
                          sfx=[[2, "whoosh_heavy"]], desc="Shield-first charge (no charge input needed)."),
              per={"l": dict(hitstun=54, move=[[0, 0], [10, 1.2], [14, 1.3]]),
                   "m": dict(hitstun=59, move=[[0, 0], [12, 1.8], [16, 1.9]]),
                   "h": dict(hitstun=69, move=[[0, 0], [14, 2.6], [18, 2.7]], armor={"hits": 1, "f": [3, 13]},
                             why="FIGHTING_DESIGN 8c 'SHIELD RUSH ... armor on H': the H version trades the "
                                 "rush template's throw invulnerability for 1 hit of armor (the shield).")},
              ex=dict(name="Shield Rush (EX)", startup=10, active=8, recovery=20, damage=1200, hitstun=52,
                      armor={"hits": 2, "f": [1, 12]}, move=[[0, 0], [10, 2.6], [17, 2.8]],
                      hits=[{"f": [10, 11], "damage": 500, "hitstop": 11}, {"f": [16, 17], "damage": 700,
                                                                           "hitstop": 13}],
                      desc="Two hits of armor, 2 hits, -2 on block.", why="EX: 2-hit armor, 2 hits, -2."))
    cuff = {}
    for s, (rng, dmg) in {"l": (0.95, 1600), "m": (0.90, 1800), "h": (0.85, 2000)}.items():
        cuff[s] = dict(damage=dmg, grab={"rangeM": rng, "frames": 60, "adv": 24, "hitF": 40, "swap": False,
                                         "air": False, "techable": False, "clip": "cuff_pin"})
    K.special("cuff", None, motion="214", kind="cmdgrab",
              common=dict(name="Under Arrest", clip="throw_reach", startup=6, active=3, recovery=40, hitstun=0,
                          blockstun=0, hitstop=0, guard="U", gain=2000, nerve=0, pb=(0.0, 0.0), role=["grab"],
                          sfx=[[1, "grab_cloth"]],
                          desc="Short command grab: pins and cuffs; the answer to a blocker.",
                          why="Short-range command grab (not a grappler's 360): 6/3/40, reach 0.95/0.90/0.85 m, "
                              "1600-2000, KD +24 - weaker than Bruno's on every axis."),
              per=cuff,
              ex=dict(name="Under Arrest (EX)", damage=2200, invuln={"strike": [1, 6]},
                      grab={"rangeM": 1.10, "frames": 64, "adv": 24, "hitF": 42, "swap": False, "air": False,
                            "techable": False, "clip": "cuff_pin"},
                      desc="Strike-invulnerable grab, longer reach.", why="EX: strike invulnerable 1-6, 1.10 m."))

    K.add("backup", LV1, kind="super1", input="236236", name="Backup's Here", strength="H", clip="backup_combo",
          active=23, recovery=54, hitstun=78,
          hits=[{"f": [8, 9], "damage": 600, "hitstop": 9}, {"f": [18, 19], "damage": 600, "hitstop": 9},
                {"f": [30, 30], "damage": 800, "hitstop": 20}],
          warp="auto", invuln={"strike": [1, 10], "throw": [1, 10]}, move=[[0, 0], [8, 1.0], [18, 1.8], [30, 2.0]],
          kd="soft", juggle={"js": 1, "ji": 0, "jl": 99}, cost={"showtime": LV1_COST}, gain=0, nerve=600,
          role=["reversal"], sfx=[[1, "crowd_cheer_burst"]],
          desc="Charge-free invulnerable shield charge: two shield hits and a baton swing.",
          why="1c Lv1 for a charge fighter: invulnerable 1-10 and NO charge input (FIGHTING_DESIGN 8c 'Lv1 "
              "charge-less shield bash (reversal)'); 3 hits 10-12 frames apart (one per clip contact), recovery 54 -> "
              "-30 on block.")
    K.add("riot_act", LV3, kind="super3", input="214214", name="Riot Act", strength="H", clip="shield_block",
          invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 0.8]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic={"frames": 165, "cue": "krane_riot_act",
                     "hits": [[25, 500], [50, 600], [75, 300], [88, 300], [100, 300], [118, 2500]],
                     "anim": [[0, "shield_block"], [20, "baton_swing"], [45, "baton_chop"], [70, "book_em"],
                              [110, "taser_fire"], [140, "win_holster"]],
                     "victim": [[0, "hit_high_s"], [20, "hit_high_l"], [45, "hit_body"], [70, "hit_high_s"],
                                [110, "dizzy"], [128, "kd_fall_b"], [145, "kd_ground_b"]],
                     "shots": [[0, "side_close"], [20, "punch_in"], [70, "over_shoulder"], [110, "front_low"],
                               [118, "slowmo_hold"], [140, "crowd_pop"]],
                     "endAdv": 19, "endGapM": 2.0},
          desc="PRIME TIME: a shield bash that starts a full riot-control sequence ending in a taser jolt.",
          why="1c Lv3: 10/4/58, -42, 4500, fully invulnerable 1-13.")

    K.simple = {"5S": "taser_m", "6S": "shield_rush_m", "2S": "baton_flip_m", "4S": "cuff_m", "S+H": "backup",
                "S+H+2": "riot_act", "assist": ["5L", "5M", "5H", "taser_m"]}
    K.classic = [{"motion": "[4]6", "btn": "LMH", "move": "taser_{s}"},
                 {"motion": "[2]8", "btn": "LMH", "move": "baton_flip_{s}"},
                 {"motion": "236", "btn": "LMH", "move": "shield_rush_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "cuff_{s}"}]
    K.unique = {"kind": "charge", "chargeF": 45, "keepF": 10, "standBlockNervePct": 50}
    K.cine_doc = [
        "f0 SHIELD BASH (side_close): the shield slams them upright.",
        "f20 BATON SWING (punch_in) - 500 at f25. f45 BATON CHOP (body) - 600 at f50.",
        "f70 BOOK 'EM (over_shoulder): three baton shots - 3 x 300.",
        "f110 TASER (front_low -> slowmo_hold): barbs from the shield, a comic full-body jolt - 2500 at f118.",
        "f140 HOLSTER (crowd_pop): he holsters the baton over the twitching body (KD +19).",
    ]
    return K
