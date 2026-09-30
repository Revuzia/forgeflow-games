"""RERUN - counter zombie (Scary_Zombie_Pack; Prisoner body has NO right-hand finger bones -> claws / open hands,
CMU punches with fist 0)."""
from kitlib import (Kit, air, cmu, crouch, layer, mix, seq, LV1, LV3, LV1_COST, LV3_COST)

ZB = "Scary_Zombie_Pack/"


def build():
    K = Kit(
        id="rerun", name="RERUN", persona="The Contestant Who Won't Stay Cancelled", archetype="counter",
        body="Prisoner B Styperek", heightM=1.80, hp=10000, build="average",
        walk=(1.80, 1.30), dash=(1.00, 0.80, 19, 24), jump=(4, 40, 3, 1.55, 1.35), throwRangeM=0.60,
        colors=[("Death Row", None), ("Solitary", "#37474f"), ("Orange Jumpsuit", "#ef6c00"), ("Graveyard", "#4e5d3a")],
        intro="intro_rise", win=["win_chew", "win_idle"], taunt="taunt_scream", rival="lotus", stage="rust_theater",
        cpu={"style": "counter", "rangeM": [1.0, 2.0], "pokes": ["2M", "5M"],
             "counter": ["play_dead_l", "play_dead_m"], "antiAir": ["arise_l", "2H"], "punish": ["5H", "grave_crawl_h"],
             "grab": ["last_meal_m"], "combo": ["2L", "5M", "grave_crawl_m"], "meter": "dead_air"},
        doc=dict(
            difficulty=2, packs="Scary_Zombie (lurch, neck bite, crawl, scream, death) + CMU open-hand swat",
            look="Prisoner: zombified convict in a grey/white striped uniform and cap, barefoot; the right hand "
                 "stays half-open (no finger bones in the rig) - every strike is a claw or open hand.",
            bio="Died on camera in season one, week three. The ratings were the best the network ever had, so "
                "they brought him back. Then again. Then again. He is the most profitable rerun in television.",
            plan="Counter and footsies: PLAY DEAD (214 / 4S) drops him to the floor and catches strikes on frames "
                 "4-20 into GRAVE RISE; the prone CRAWL CLAW (2M) slides under high pokes; LAST MEAL (63214 "
                 "command grab) punishes blockers who fear the counter; GRAVE CRAWL creeps in low.",
            weakness="Counters lose to throws, projectiles and delayed attacks; PLAY DEAD has 26+ frames of "
                     "whiff recovery lying on the floor; slow walk for his range.",
            rivalry="He ate Lotus Liu's lucky gourd on the Wheel of Pain. He does not remember doing it.",
        ),
    )

    K.clip("idle", mix(ZB + "zombie idle", (1, 129), loop=True), "OVERRIDE shared idle: zombie idle (loop 0.4 deg)")
    K.clip("walk_f", mix(ZB + "zombie walk", (1, 122), loop=True), "OVERRIDE shared walk_f: zombie shamble")
    K.clip("swat", cmu("jab.3", mirror=True, fist=0), "CMU jab.3 clean (mirrored = LEFT hand, which has fingers), "
                                                       "fist 0 = open-hand swat")
    K.clip("lurch", mix(ZB + "zombie attack", (15, 55), contact=33),
           "Mixamo zombie attack: wild one-arm claw, arm fully extended f30, front pass f33 (0.86 m)")
    K.clip("long_reach", mix(ZB + "zombie neck bite", (8, 40), contact=25),
           "Mixamo zombie neck bite: both arms reach out f23-25 = long double-claw lunge")
    K.clip("ankle_bite", mix(ZB + "zombie biting (2)", (10, 40), contact=22),
           "Mixamo zombie biting (2): crouched head bite (hips 0.41-0.46 m, Head f22)")
    K.clip("crawl_claw", mix(ZB + "zombie crawl", (1, 40), contact=10),
           "Mixamo zombie crawl: prone reaching claw along the floor (hips 0.09-0.26 m, RightHand f10)")
    K.clip("scream_up", mix(ZB + "zombie scream", (15, 45), contact=30),
           "Mixamo zombie scream: arms flung up (LeftHand f30) = upward flail anti-air")
    K.clip("drop_headbutt", mix(ZB + "zombie neck bite", (20, 45), contact=32),
           "Mixamo zombie neck bite head lunge (front pass f32, 1.48 m) = overhead headbutt")
    K.clip("air_swat", air(cmu("jab.3", mirror=True, fist=0)), "jump apex legs + open-hand swat")
    K.clip("air_lurch", air(mix(ZB + "zombie attack", (15, 55), contact=33)), "jump apex legs + claw")
    K.clip("air_reach", air(mix(ZB + "zombie neck bite", (8, 40), contact=25)), "jump apex legs + double claw")
    K.clip("throw_reach", mix(ZB + "zombie neck bite", (16, 45), contact=23), "zombie neck bite reach (grab whiff)")
    K.clip("bite_lunge", mix(ZB + "zombie neck bite", (22, 60), contact=23),
           "zombie neck bite from the grab frame: the 1-frame DEAD AIR BITE connect")
    K.clip("scream_grab", mix(ZB + "zombie scream", (1, 85), contact=30), "grabs and screams in their face")
    K.clip("swing_toss", mix(ZB + "zombie attack", (1, 76), contact=30), "wild swing flings them past")
    K.clip("play_dead_fall", mix(ZB + "zombie death", (5, 45)),
           "Mixamo zombie death: flails and falls on the back (lying from ~f56 measured; f45 = on the floor)")
    K.clip("rise_claw", mix(ZB + "zombie attack", (20, 55), contact=33),
           "zombie attack claw from mid-swing: snaps up from the floor into the claw (6-frame view blend)")
    K.clip("crawl_run", seq(mix(ZB + "running crawl", (1, 20), loop=True),
                            mix(ZB + "zombie biting (2)", (14, 40), contact=22), xf=2),
           "SEQ: one four-limb running-crawl loop + crouched ankle bite")
    K.clip("crawl_run_ex", seq(mix(ZB + "running crawl", (1, 20), loop=True),
                               mix(ZB + "zombie biting (2)", (14, 40), contact=22),
                               mix(ZB + "zombie biting (2)", (14, 40), contact=22), xf=2),
           "SEQ: crawl loop + two ankle bites")
    K.clip("neck_bite", dict(mix(ZB + "zombie neck bite", (1, 123), contact=23), contacts=[23, 29]),
           "Mixamo zombie neck bite: arms grab f23, head lunge f29, shoves away f93-107")
    K.clip("arise_leap", layer(mix("Pro_Magic_Pack/Standing Jump", (15, 45)),
                               mix(ZB + "zombie scream", (15, 45), contact=30), mode="sync"),
           "LAYERED: jump legs + zombie scream arms = leaping claw anti-air")
    K.clip("intro_rise", cmu("getup_back.1", contact=False),
           "CMU getup_back.1 clean (140_08 flat on the back -> sit -> crouch -> stand): rises from the dead")
    K.clip("win_chew", mix(ZB + "zombie biting (2)", (1, 70)), "crouched chewing")
    K.clip("win_idle", mix(ZB + "zombie idle", (1, 129)), "zombie idle sway")
    K.clip("taunt_scream", mix(ZB + "zombie scream", (1, 85)), "feral scream (MIXAMO_CLIPS taunts)")

    K.add("5L", "L", name="Swat", clip="swat", cancel=["chain:5L", "chain:2L", "special", "super"], role=["poke"],
          desc="Open-hand swat.")
    K.add("2L", "2L", name="Ankle Bite", clip="ankle_bite", cancel=["chain:2L", "special", "super"],
          role=["poke", "low"], desc="Crouching bite at the ankle.")
    K.add("5M", "M", name="Lurch Claw", clip="lurch", startup=9, recovery=17, cancel=["special", "super"],
          role=["poke"], sfx=[[5, "whoosh_light"]], desc="Wild one-arm claw.",
          why="Zombie wind-up: 9/3/17 (+2/-4).")
    K.add("2M", "2M", name="Crawl Claw", clip="crawl_claw", startup=10, recovery=17,
          hurtOverride=[{"f": [4, 22], "w": 0.95, "h": 0.45}], cancel=["special", "super"],
          role=["poke", "low", "lowprofile"],
          desc="Drops prone and claws along the floor: goes UNDER high pokes; -4 on block.",
          why="Signature footsie tool: prone 0.45 m low profile 4-22 beats high pokes, so it is slower "
              "(10f) and -4 on block (recovery 17).")
    K.add("5H", "H", name="Long Reach", clip="long_reach", startup=13, cancel=["special", "super"],
          desc="Double-claw lunge: his longest button (1.35 m).",
          why="Longest reach in his kit: startup 12->13.")
    K.add("2H", "AA", name="Scream Claw", clip="scream_up", juggle={"js": 1, "ji": 1, "jl": 0},
          cancel=["special", "super"], desc="Arms flung up in a scream: anti-air.")
    K.add("6H", "OH", input="6H", kind="command", name="Drop-Dead Headbutt", clip="drop_headbutt",
          boxes=[{"f": [18, 20], "x": 0.45, "y": 1.45, "w": 0.40, "h": 0.40}],
          desc="Lunging headbutt from above: overhead.",
          why="Overhead template; hand-set box on the head lunge (front pass f32: 0.43 m ahead, 1.48 m high).")
    K.add("j.L", "jL", input="j.L", name="Air Swat", clip="air_swat", desc="Air swat.")
    K.add("j.M", "jM", input="j.M", name="Air Claw", clip="air_lurch", desc="Air claw.")
    K.add("j.H", "jH", input="j.H", name="Pounce", clip="air_reach", desc="Double-claw pounce.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="In Your Face", clip="throw_reach",
          grab={"frames": 50, "adv": 21, "hitF": 32, "swap": False, "air": False, "techable": True,
                "clip": "scream_grab"}, desc="Grabs them and screams in their face.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Graveyard Swing", clip="throw_reach",
          grab={"frames": 48, "adv": 14, "hitF": 30, "swap": True, "air": False, "techable": True,
                "clip": "swing_toss"}, desc="Swings them past with a wild claw.")

    pd = {}
    for s, (c1, rec, fol) in {"l": (20, 26, "grave_rise"), "m": (24, 30, "grave_rise"),
                              "h": (20, 28, "grave_rise_big")}.items():
        pd[s] = dict(active=c1 - 3, recovery=rec, counter={"catch": [4, c1], "vs": ["strike"], "follow": fol})
    K.special("play_dead", None, motion="214",
              common=dict(name="Play Dead", clip="play_dead_fall", startup=4, damage=0, hitstun=0, blockstun=0,
                          hitstop=0, gain=0, nerve=0, pb=(0.0, 0.0), guard="HL", cancel=[], role=["reversal"],
                          hurtOverride=[{"f": [14, 40], "w": 1.2, "h": 0.40}],
                          desc="Collapses like a corpse; a strike on the catch frames triggers GRAVE RISE.",
                          why="counter unique (CONTRACT 5.3: PLAY DEAD catches strikes f4-20): L 4-20, M 4-24 "
                              "(longer, more recovery), H 4-20 into the stronger GRAVE RISE; lying from f14 (0.40 m) "
                              "so late highs whiff; throws and projectiles beat it."),
              per=pd,
              ex=dict(name="Play Dead (EX)", startup=1, active=26, recovery=22,
                      counter={"catch": [1, 26], "vs": ["strike", "proj"], "follow": "grave_rise_big"},
                      desc="Catches strikes AND projectiles from frame 1.", why="EX: catch 1-26 incl. projectiles."))
    K.add("grave_rise", None, kind="special", input="214>catch", name="Grave Rise", strength="M", tc=True,
          clip="rise_claw", startup=5, active=3, recovery=20, damage=1200, hitstun=53, blockstun=16, hitstop=15,
          guard="HL", gain=1000, nerve=3000, pb=(0.0, 0.50), kd="soft", cancel=["super"], role=["reversal"],
          desc="Snaps up off the floor into a claw (after a PLAY DEAD catch).",
          why="Counter follow-up: 5/3/20, 1200, KD +30 (the caught attacker is in recovery = punish counter).")
    K.add("grave_rise_big", None, kind="special", input="214H>catch", name="Grave Rise (Heavy)", strength="H", tc=True,
          clip="rise_claw", startup=5, active=3, recovery=24, damage=1600, hitstun=57, blockstun=16, hitstop=17,
          guard="HL", gain=1200, nerve=3000, pb=(0.0, 0.50), kd="soft", groundBounce=True, launch=[0.5, 4.0],
          juggle={"js": 1, "ji": 1, "jl": 4}, cancel=["super"], role=["reversal", "launcher"],
          desc="Bigger rise: ground bounce for a juggle.", why="H / EX follow-up: 1600 and a ground bounce.")
    gc = {}
    for s, (st, mv, dmg) in {"l": (16, 1.5, 800), "m": (18, 2.0, 900), "h": (20, 2.5, 1000)}.items():
        gc[s] = dict(startup=st, damage=dmg, hitstun=30 + 3 + 22, move=[[0, 0], [st, mv]],
                     hurtOverride=[{"f": [3, st + 3], "w": 1.0, "h": 0.60}])
    K.special("grave_crawl", None, motion="236",
              common=dict(name="Grave Crawl", clip="crawl_run", active=3, recovery=22, blockstun=16, hitstop=15,
                          guard="L", gain=900, nerve=3000, pb=(0.0, 0.40), kd="soft", warp="auto", cancel=["super"],
                          role=["low", "lowprofile", "approach"], sfx=[[2, "whoosh_light"]],
                          desc="Four-limb crawl under everything, then an ankle bite (low, knockdown).",
                          why="Low-profile approach (0.60 m from f3): 16/18/20 startup, -9 on block, KD +30."),
              per=gc,
              ex=dict(name="Grave Crawl (EX)", clip="crawl_run_ex", startup=15, active=16, recovery=18,
                      damage=1200, hitstun=50, invuln={"proj": [1, 20]}, move=[[0, 0], [15, 2.2]],
                      hits=[{"f": [15, 16], "damage": 500, "hitstop": 9}, {"f": [29, 30], "damage": 700,
                                                                           "hitstop": 15}],
                      hurtOverride=[{"f": [3, 31], "w": 1.0, "h": 0.60}],
                      desc="Projectile-invulnerable crawl, two bites, -4 on block.",
                      why="EX: projectile invulnerable 1-20, 2 bites 14 frames apart, -4."))
    lm = {}
    for s, (rng, dmg) in {"l": (1.00, 2200), "m": (0.95, 2400), "h": (0.90, 2600)}.items():
        lm[s] = dict(damage=dmg, grab={"rangeM": rng, "frames": 100, "adv": 26, "hitF": 60, "swap": False,
                                       "air": False, "techable": False, "clip": "neck_bite"})
    K.special("last_meal", None, motion="63214", kind="cmdgrab",
              common=dict(name="Last Meal", clip="throw_reach", startup=5, active=3, recovery=48, hitstun=0,
                          blockstun=0, hitstop=0, guard="U", gain=3000, nerve=0, pb=(0.0, 0.0), role=["grab"],
                          sfx=[[1, "grab_cloth"]],
                          desc="Half-circle command grab: grabs, gnaws (comic), shoves them away.",
                          why="Counter fighter's answer to blockers: a half-circle (not 360) grab with less reach "
                              "and damage than Bruno's (1.00/0.95/0.90 m, 2200-2600) and less whiff recovery (48)."),
              per=lm,
              ex=dict(name="Last Meal (EX)", damage=2800, invuln={"strike": [1, 5]},
                      grab={"rangeM": 1.10, "frames": 104, "adv": 26, "hitF": 62, "swap": False, "air": False,
                            "techable": False, "clip": "neck_bite"},
                      desc="Strike-invulnerable grab, 1.10 m.", why="EX: strike invulnerable 1-5."))
    ar = {}
    for s, (st, rec, dmg, inv) in {"l": (8, 28, 900, 10), "m": (9, 31, 1000, 7), "h": (10, 34, 1100, 5)}.items():
        ar[s] = dict(startup=st, recovery=rec, damage=dmg, hitstun=30 + 6 + rec, invuln={"air": [1, inv]},
                     moveY=[[0, 0], [st, 0.4], [st + 8, 0.9], [st + 6 + rec - 3, 0.0]])
    K.special("arise", None, motion="623",
              common=dict(name="Arise", clip="arise_leap", active=6, blockstun=20, hitstop=15, guard="HL", gain=800,
                          nerve=4000, pb=(0.0, 0.45), kd="soft", launch=[1.0, 5.0], juggle={"js": 1, "ji": 1, "jl": 4},
                          cancel=["super"], role=["antiair"], sfx=[[2, "whoosh_heavy"]],
                          desc="Leaping screaming claw anti-air.",
                          why="Anti-air (DP-lite): 8/9/10 startup, air-invulnerable 1-10/1-7/1-5, -14/-17/-20."),
              per=ar,
              ex=dict(name="Arise (EX)", startup=7, recovery=32, damage=1300, hitstun=68,
                      invuln={"strike": [1, 9], "throw": [1, 9], "air": [1, 9], "proj": [1, 9]},
                      moveY=[[0, 0], [7, 0.4], [15, 1.0], [42, 0.0]], role=["antiair", "reversal"],
                      desc="Fully invulnerable leap.", why="EX: fully invulnerable 1-9."))

    K.add("dead_air", LV1, kind="super1", input="236236", name="Dead Air", strength="H", clip="play_dead_fall",
          startup=4, active=27, recovery=30, damage=0, hitstun=0, blockstun=0, hitstop=0, guard="HL",
          counter={"catch": [1, 30], "vs": ["strike", "proj"], "follow": "dead_air_bite"},
          hurtOverride=[{"f": [14, 40], "w": 1.2, "h": 0.40}], cost={"showtime": LV1_COST}, gain=0, nerve=0,
          role=["reversal"],
          desc="Counter super: plays dead for 30 frames; any strike or projectile is answered with a lunge-bite.",
          why="Counter archetype Lv1 (FIGHTING_DESIGN 8c 'Lv1 counter super'): catch 1-30 vs strikes and "
              "projectiles; the damage lives in DEAD AIR BITE; loses to throws.")
    K.add("dead_air_bite", None, kind="special", input="236236>catch", name="Dead Air Bite", strength="H", tc=True,
          clip="bite_lunge", startup=1, active=3, recovery=20, damage=2000, hitstun=0, blockstun=0, hitstop=0,
          guard="U", gain=0, nerve=0, pb=(0.0, 0.0), role=["grab"],
          grab={"rangeM": 2.5, "frames": 90, "adv": 23, "hitF": 50, "swap": False, "air": False, "techable": False,
                "clip": "neck_bite"},
          desc="The Lv1 follow-up: lunges 2.5 m and bites (unblockable, 2000).",
          why="Lv1 damage (2000) delivered as an unblockable 2.5 m grab so a caught attacker cannot escape it.")
    K.add("series_finale", LV3, kind="super3", input="214214", name="Series Finale", strength="H", clip="long_reach",
          invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]}, move=[[0, 0], [10, 0.8]],
          cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"], juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic={"frames": 170, "cue": "rerun_series_finale",
                     "hits": [[30, 800], [60, 1200], [100, 1000], [130, 1500]],
                     "anim": [[0, "long_reach"], [25, "neck_bite"], [80, "crawl_run"], [120, "play_dead_fall"],
                              [140, "intro_rise"]],
                     "victim": [[0, "hit_high_s"], [25, "thrown_f"], [80, "kd_ground_f"], [130, "kd_ground_b"]],
                     "shots": [[0, "side_close"], [25, "front_low"], [80, "top_down"], [120, "wide"],
                               [140, "low_angle_up"]],
                     "endAdv": 19, "endGapM": 2.0},
          desc="PRIME TIME: grabs, bites, drags them into a trapdoor grave - and climbs back out alone.",
          why="1c Lv3: 10/4/58, -42, 4500, fully invulnerable 1-13.")

    K.simple = {"5S": "last_meal_m", "6S": "grave_crawl_m", "2S": "arise_m", "4S": "play_dead_m", "S+H": "dead_air",
                "S+H+2": "series_finale", "assist": ["2L", "5M", "5H", "grave_crawl_m"]}
    K.classic = [{"motion": "63214", "btn": "LMH", "move": "last_meal_{s}"},
                 {"motion": "236", "btn": "LMH", "move": "grave_crawl_{s}"},
                 {"motion": "623", "btn": "LMH", "move": "arise_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "play_dead_{s}"}]
    K.unique = {"kind": "counter", "moves": ["play_dead_l", "play_dead_m", "play_dead_h", "play_dead_ex", "dead_air"]}
    K.cine_doc = [
        "f0 LONG REACH (side_close): both claws catch the collar.",
        "f25 NECK BITE (front_low): the comic gnaw - 800 at f30; head lunge - 1200 at f60.",
        "f80 CRAWL (top_down): a Rust Theater trapdoor opens; he drags them in on all fours - 1000 at f100.",
        "f120 PLAY DEAD (wide): he drops in after them; the lid slams - 1500 at f130.",
        "f140 RISE (low_angle_up): the lid creaks open and Rerun climbs back out alone (KD +19).",
    ]
    return K
