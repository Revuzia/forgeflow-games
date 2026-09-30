"""THE GREAT ZAMBINI - zoner magician (Pro_Magic pack: casts, palms, area attacks)."""
from kitlib import (Kit, air, crouch, mix, seq, LV1, LV3, LV1_COST, LV3_COST)


def build():
    K = Kit(
        id="zambini", name="THE GREAT ZAMBINI", persona="The Act", archetype="zoner",
        body="Whiteclown N Hallin", heightM=1.85, hp=9500, build="average",
        walk=(1.26, 1.13), dash=(1.10, 0.75, 19, 24), jump=(4, 42, 3, 1.70, 1.30), throwRangeM=0.60,
        colors=[("Top Hat", None), ("Rabbit White", "#e8e8e8"), ("Velvet", "#6a1b9a"), ("Curtain Red", "#b71c1c")],
        intro="intro_tada", win=["win_flourish", "win_ack"], taunt="taunt_twirl", rival="gazza",
        stage="wheel_of_pain",
        cpu={"style": "zoner", "rangeM": [2.8, 5.5], "zoning": ["card_fan_m", "flash_paper_m"],
             "antiAir": ["flourish_l", "2H"], "escape": ["vanish_h"], "pokes": ["5M", "2M"],
             "punish": ["5H", "flourish_h"], "combo": ["2M", "card_fan_h"], "meter": "grand_illusion"},
        doc=dict(
            difficulty=2, packs="Pro_Magic (casts, palms, area attacks)",
            look="Whiteclown: bald white clown face, dark eye rings, toothy grin, black tuxedo with bow tie and "
                 "pocket square, grey gloves, ragged hems, bare grey feet.",
            bio="Forty years sawing assistants in half on cruise ships and county fairs, until one assistant "
                "never came back out of the box. KNOCKOUT 13 booked him the next morning. Nobody has seen how "
                "the trick ends.",
            plan="Keep them at 3-5 m: CARD FAN is fast and straight, FLASH PAPER lobs fire onto the landing "
                 "spot of a jump, FLOURISH bursts above him when they get close, and VANISHING ACT drops "
                 "through a trapdoor behind them - or back to his own corner.",
            weakness="Slowest walk in the cast (1.26 m/s), 9500 HP; VANISHING ACT has 14 frames of visible "
                     "recovery after he reappears; up close his only escapes are EX FLOURISH and the Lv1.",
            rivalry="Gazza's stray shot popped Zambini's prize dove on live TV. Zambini has not forgiven the ball.",
        ),
    )

    K.clip("palm_flick", mix("Pro_Magic_Pack/Standing 1H Magic Attack 02", (12, 40), contact=21),
           "Mixamo 1H Magic Attack 02 palm push; front pass f21 (0.78 m)")
    K.clip("spear_hand", mix("Pro_Magic_Pack/Standing 2H Magic Attack 03", (22, 60), contact=35),
           "Mixamo 2H Magic Attack 03 long spear-hand; front pass f35 (0.92 m, straight arm)")
    K.clip("double_palm", mix("Pro_Magic_Pack/Standing 2H Magic Attack 01", (24, 62), contact=39),
           "Mixamo 2H Magic Attack 01 double palm; front pass f39 (0.90 m)")
    K.clip("low_palm", crouch(mix("Pro_Magic_Pack/Standing 1H Magic Attack 02", (12, 40), contact=21)),
           "Crouch Idle legs + 1H palm")
    K.clip("low_spear", crouch(mix("Pro_Magic_Pack/Standing 2H Magic Attack 03", (22, 60), contact=35)),
           "Crouch Idle legs + spear hand = long low poke")
    K.clip("rising_palm", mix("Pro_Magic_Pack/Standing 2H Magic Attack 05", (44, 84), contact=64),
           "Mixamo 2H Magic Attack 05 second half: rising arm f64 (front pass f65, 1.33 m high)")
    K.clip("abracadabra", mix("Pro_Magic_Pack/Standing 2H Magic Area Attack 01", (18, 60), contact=40),
           "Mixamo 2H Area Attack 01 double-fist pound, hands reach the floor f40 (dense render)")
    K.clip("air_palm", air(mix("Pro_Magic_Pack/Standing 1H Magic Attack 02", (12, 40), contact=21)),
           "jump apex legs + palm")
    K.clip("air_flick", air(mix("Pro_Magic_Pack/Standing 1H Magic Attack 01", (15, 50), contact=29)),
           "jump apex legs + 1H Attack 01 flung arm (front pass f29)")
    K.clip("air_double", air(mix("Pro_Magic_Pack/Standing 2H Magic Attack 01", (24, 62), contact=39)),
           "jump apex legs + double palm")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9), "two-hand grab")
    K.clip("palm_shove", mix("Pro_Magic_Pack/Standing 2H Magic Attack 02", (25, 62), contact=43),
           "Mixamo 2H Magic Attack 02 double-palm shove (front pass f43)")
    K.clip("spin_fling", mix("Pro_Magic_Pack/Standing 1H Magic Attack 01", (10, 60), contact=29),
           "Mixamo 1H Magic Attack 01 spinning backfist, arms flung wide = spin and fling")
    K.clip("card_flick", mix("Pro_Magic_Pack/Standing 1H Magic Attack 01", (15, 50), contact=29),
           "Mixamo 1H Magic Attack 01: the arm flings forward at f29 = card release")
    K.clip("flash_cast", mix("Pro_Magic_Pack/standing 1H cast spell 01", (8, 45), contact=22),
           "Mixamo standing 1H cast spell 01 (RightHand peak f22) = underhand flame lob")
    K.clip("vanish", mix("Pro_Magic_Pack/Standing Idle To Crouch", (1, 29)),
           "Mixamo Standing Idle To Crouch: drops into the trapdoor (the view's smoke hides the teleport; the "
           "6-frame blend pops him back up)")
    K.clip("flourish_burst", mix("Pro_Magic_Pack/Standing 2H Magic Area Attack 02", (30, 70), contact=48),
           "Mixamo 2H Area Attack 02 radial burst, arms flung wide (front pass f48)")
    K.clip("intro_tada", mix("Pro_Magic_Pack/Standing 2H Cast Spell 01", (1, 66)), "arms-up 'ta-da'")
    K.clip("win_flourish", mix("Pro_Magic_Pack/standing 1H cast spell 01", (1, 69)), "one-hand flourish")
    K.clip("win_ack", mix("Gestures_Pack_Basic/acknowledging", (1, 48)), "Mixamo acknowledging (a small bow)")
    K.clip("taunt_twirl", mix("Pro_Magic_Pack/Standing Idle 03", (60, 130)),
           "Mixamo Standing Idle 03 f60-130: hand gestures (RightHand peaks f67/f101/f120)")

    K.add("5L", "L", name="Palm Flick", clip="palm_flick", cancel=["chain:5L", "special", "super"], role=["poke"],
          desc="Quick palm.")
    K.add("2L", "2L", name="Low Palm", clip="low_palm", cancel=["chain:2L", "special", "super"], role=["poke", "low"],
          desc="Crouching palm to the shin.")
    K.add("5M", "M", name="Spear Hand", clip="spear_hand", startup=9, recovery=17, pb=(0.40, 0.50),
          cancel=["special", "super"], role=["poke"],
          desc="Long straight-arm spear hand: the zoner's longest poke.",
          why="Zoner long poke (FIGHTING_DESIGN 8c: longest medium): +1 startup / +1 recovery (+2/-4) for reach.")
    K.add("2M", "2M", name="Low Spear", clip="low_spear", startup=9, cancel=["special", "super"],
          role=["poke", "low"], desc="Long crouching spear hand (low); cancel into CARD FAN.",
          why="Long low poke: startup 9 pays for the reach.")
    K.add("5H", "H", name="Double Palm", clip="double_palm", pb=(0.60, 0.80), cancel=["special", "super"],
          desc="Double palm that shoves them back to his range.")
    K.add("2H", "AA", name="Rising Palm", clip="rising_palm", juggle={"js": 1, "ji": 1, "jl": 0},
          cancel=["special", "super"], desc="Rising palm anti-air.")
    K.add("6H", "OH", input="6H", kind="command", name="Abracadabra", clip="abracadabra", startup=20, recovery=16,
          desc="Two-fist hammer onto the head: overhead.",
          why="Zoner's overhead is slower (20f) with 1 less recovery (+3/-3): a surprise tool, not a mixup "
              "engine.")
    K.add("j.L", "jL", input="j.L", name="Air Palm", clip="air_palm", desc="Air palm.")
    K.add("j.M", "jM", input="j.M", name="Air Card Flick", clip="air_flick", desc="Flung arm air-to-air.")
    K.add("j.H", "jH", input="j.H", name="Levitating Palms", clip="air_double", desc="Double-palm jump-in.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Now You See Me", clip="throw_reach",
          grab={"frames": 44, "adv": 21, "hitF": 30, "swap": False, "air": False, "techable": True,
                "clip": "palm_shove"}, desc="Grabs the lapels and blasts them away with both palms.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Now You Don't", clip="throw_reach",
          grab={"frames": 48, "adv": 14, "hitF": 28, "swap": True, "air": False, "techable": True,
                "clip": "spin_fling"}, desc="Spins and flings them behind him.")

    card = {"life": 180, "box": [0.30, 0.20], "y": 1.25, "hits": 1, "clip": "card", "x": 0.6}
    K.special("card_fan", "proj", motion="236",
              common=dict(name="Card Fan", clip="card_flick", damage=500, cancel=["super"], role=["projectile"],
                          sfx=[[0, "card_throw"]], desc="Flicked playing cards; fast and straight.",
                          why="Zoner projectile is his neutral: 500 (-100) for faster speeds 5.0/6.5/8.0 m/s "
                              "(template 4.5/6/7.5)."),
              per={s: dict(projectile=dict(card, speed=v, strength=s.upper()))
                   for s, v in (("l", 5.0), ("m", 6.5), ("h", 8.0))},
              ex=dict(name="Card Fan (EX)", startup=11, recovery=30, damage=900,
                      projectile=dict(card, speed=8.0, hits=3, strength="H", box=[0.40, 0.40]),
                      desc="A full deck: 3 hits.", why="EX: 3-hit projectile, 11f startup."))
    lob = {"life": 120, "box": [0.45, 0.45], "y": 1.60, "hits": 1, "clip": "flame", "x": 0.6, "vy": 5.0, "g": 15.0}
    K.special("flash_paper", None, motion="63214",
              common=dict(name="Flash Paper", clip="flash_cast", active=1, recovery=28, hitstun=28, blockstun=22,
                          hitstop=8, guard="HL", gain=600, nerve=2500, pb=(0.40, 0.50), cancel=["super"],
                          role=["projectile", "antiair"], sfx=[[0, "fire_whoosh"]],
                          desc="Lobbed fireball that lands at 1.5 / 3.0 / 4.5 m: covers the landing of a jump.",
                          why="Arcing projectile (FIGHTING_DESIGN 8c HAIL analog): launched at 5.0 m/s up with "
                              "15 m/s2 gravity from 1.6 m -> 0.90 s airtime; horizontal speeds 1.0/2.6/4.3 m/s "
                              "land it at 1.5/3.0/4.5 m. Slower startup 18/20/22 than a straight projectile."),
              per={"l": dict(startup=18, damage=700, projectile=dict(lob, speed=1.0, strength="L")),
                   "m": dict(startup=20, damage=700, projectile=dict(lob, speed=2.6, strength="M")),
                   "h": dict(startup=22, damage=700, projectile=dict(lob, speed=4.3, strength="H"))},
              ex=dict(name="Flash Paper (EX)", startup=16, damage=1000,
                      projectile=dict(lob, speed=2.6, hits=2, strength="H", box=[0.9, 0.9]),
                      desc="A huge fireball, 2 hits.", why="EX: bigger box, 2 hits, 16f."))
    tele = dict(name="Vanishing Act", clip="vanish", damage=0, hitstun=0, blockstun=0, hitstop=0, gain=0, nerve=0,
                pb=(0.0, 0.0), guard="HL", cancel=[], role=["approach"])
    K.special("vanish", None, motion="214", common=tele,
              per={"l": dict(startup=8, active=18, recovery=14, invuln={"strike": [8, 25], "throw": [8, 25],
                                                                        "proj": [8, 25]},
                             teleport={"f": 17, "to": "behind", "gapM": 0.8},
                             desc="Trapdoor: reappears 0.8 m BEHIND the opponent (14f recovery)."),
                   "m": dict(startup=8, active=18, recovery=14, invuln={"strike": [8, 25], "throw": [8, 25],
                                                                        "proj": [8, 25]},
                             teleport={"f": 17, "to": "front", "gapM": 0.9},
                             desc="Trapdoor: reappears 0.9 m IN FRONT of the opponent."),
                   "h": dict(startup=8, active=18, recovery=14, invuln={"strike": [8, 25], "throw": [8, 25],
                                                                        "proj": [8, 25]},
                             teleport={"f": 17, "to": "home", "gapM": 1.0}, role=["escape"],
                             desc="Trapdoor: escapes to 1.0 m from his own wall.")},
              ex=dict(name="Vanishing Act (EX)", startup=4, active=14, recovery=8,
                      invuln={"strike": [1, 17], "throw": [1, 17], "proj": [1, 17]},
                      teleport={"f": 10, "to": "behind", "gapM": 0.8}, cancel=["whiff", "special"],
                      desc="Instant: invulnerable from frame 1, reappears behind, cancelable into a special.",
                      why="EX: invulnerable 1-17 (a reversal escape) and whiff-cancelable into specials."))
    K.special("flourish", None, motion="623",
              common=dict(name="Flourish", clip="flourish_burst", active=5, blockstun=20, hitstop=15, guard="HL",
                          gain=800, nerve=4000, pb=(0.0, 0.60), kd="soft", launch=[0.8, 4.5],
                          juggle={"js": 1, "ji": 1, "jl": 3}, cancel=["super"], role=["antiair"],
                          sfx=[[0, "fire_whoosh"]],
                          boxes=[{"f": [9, 15], "x": 0.30, "y": 1.70, "w": 1.20, "h": 1.00}],
                          desc="Burst of flame and doves above and around him; not invulnerable (EX is).",
                          why="Area anti-air (not a DP): 9/10/11 startup, -11/-14/-17 on block; a hand-set box "
                              "above-front because the effector (0.53 m ahead, 1.16 m) would miss jumpers."),
              per={"l": dict(startup=9, recovery=26, damage=900, hitstun=66,
                             boxes=[{"f": [9, 13], "x": 0.30, "y": 1.70, "w": 1.20, "h": 1.00}]),
                   "m": dict(startup=10, recovery=29, damage=1000, hitstun=69,
                             boxes=[{"f": [10, 14], "x": 0.40, "y": 1.70, "w": 1.30, "h": 1.00}]),
                   "h": dict(startup=11, recovery=32, damage=1100, hitstun=72,
                             boxes=[{"f": [11, 15], "x": 0.50, "y": 1.75, "w": 1.40, "h": 1.10}])},
              ex=dict(name="Flourish (EX)", startup=8, recovery=30, damage=1300, hitstun=70,
                      invuln={"strike": [1, 11], "throw": [1, 11], "air": [1, 11], "proj": [1, 11]},
                      boxes=[{"f": [8, 12], "x": 0.30, "y": 1.40, "w": 1.60, "h": 1.60}], role=["antiair", "reversal"],
                      desc="Fully invulnerable burst.", why="EX: fully invulnerable 1-11 (his reversal)."))

    K.add("grand_illusion", LV1, kind="super1", input="236236", name="Grand Illusion", strength="H",
          clip="palm_shove", startup=9, active=1, recovery=45, hitstun=69, blockstun=25, hitstop=9, kd="soft",
          invuln={"strike": [1, 11], "throw": [1, 11]}, cost={"showtime": LV1_COST}, gain=0, nerve=600,
          projectile={"speed": 7.0, "life": 120, "box": [0.9, 0.9], "y": 1.1, "hits": 5, "strength": "H",
                      "clip": "saw_card", "x": 0.8},
          role=["projectile", "reversal"], sfx=[[0, "crowd_cheer_burst"]],
          desc="A giant spinning card-saw: 5-hit projectile, invulnerable startup.",
          why="Zoner Lv1 = projectile super (FIGHTING_DESIGN 8c 'Lv1 lightning column' analog): 5 x 400; "
              "invulnerable 1-11 because up close Lv1/EX are his only escapes; knocks down (KD +23 point blank).")
    K.add("the_prestige", LV3, kind="super3", input="214214", name="The Prestige", strength="H", clip="palm_shove",
          invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 0.6]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic={"frames": 150, "cue": "zambini_prestige", "hits": [[40, 1000], [80, 1500], [120, 2000]],
                     "anim": [[0, "palm_shove"], [20, "intro_tada"], [60, "flourish_burst"], [100, "vanish"],
                              [120, "abracadabra"], [135, "win_flourish"]],
                     "victim": [[0, "hit_high_s"], [20, "dizzy"], [60, "hit_air"], [100, "hit_air"],
                                [120, "kd_fall_f"], [136, "kd_ground_f"]],
                     "shots": [[0, "side_close"], [20, "spotlight"], [40, "crowd_pop"], [60, "low_angle_up"],
                               [100, "wide"], [120, "top_down"], [135, "crowd_pop"]],
                     "endAdv": 19, "endGapM": 2.5},
          desc="PRIME TIME: a palm to the chest, a sheet over the victim, and the big reveal.",
          why="1c Lv3: 10/4/58, -42, 4500, fully invulnerable 1-13.")

    K.simple = {"5S": "card_fan_m", "6S": "vanish_l", "2S": "flourish_m", "4S": "flash_paper_m",
                "S+H": "grand_illusion", "S+H+2": "the_prestige", "assist": ["5L", "5M", "5H", "card_fan_m"]}
    K.classic = [{"motion": "236", "btn": "LMH", "move": "card_fan_{s}"},
                 {"motion": "63214", "btn": "LMH", "move": "flash_paper_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "vanish_{s}"},
                 {"motion": "623", "btn": "LMH", "move": "flourish_{s}"}]
    K.unique = {"kind": "teleport", "moves": ["vanish_l", "vanish_m", "vanish_h", "vanish_ex"]}
    K.cine_doc = [
        "f0 PALM (side_close): a light palm to the chest freezes them.",
        "f20 TA-DA (spotlight): the set dims to one spotlight; a sheet drops over the victim (VIEW prop).",
        "f40 (crowd_pop) the sheet bursts into doves - 1000.",
        "f60 FLOURISH (low_angle_up): fire and doves lift the sheet off an empty floor - 1500 at f80.",
        "f100 VANISH (wide): Zambini drops through the trapdoor; the victim falls from the rafters - 2000 at "
        "f120.",
        "f135 BOW (crowd_pop): he reappears for the bow (KD +19).",
    ]
    return K
