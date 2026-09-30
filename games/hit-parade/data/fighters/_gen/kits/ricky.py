"""RICKY MARQUEE - boss, two-phase showman (Great_Sword_Pack = two-handed clips -> his mic-cane is held in both
hands; Gestures for the host; one Pro_Magic-free kit)."""
from kitlib import (Kit, air, crouch, layer, mix, LV1, LV3, LV1_COST, LV3_COST)

GS = "Great_Sword_Pack/"
GE = "Gestures_Pack_Basic/"


def build():
    K = Kit(
        id="ricky", name="RICKY MARQUEE", persona="The Host", archetype="boss_showman",
        body="Ch40_nonPBR", heightM=1.90, hp=13000, build="average",
        walk=(2.12, 1.44), dash=(1.20, 0.80, 18, 23), jump=(4, 38, 3, 1.59, 1.43), throwRangeM=0.60,
        colors=[("Sequins", None), ("Prime Time Gold", "#ffd54f"), ("Late Night Purple", "#4a148c"),
                ("Test Card", "#b0bec5")],
        intro="intro_power", win=["win_bow", "win_cane"], taunt="taunt_dismiss", rival="-", stage="control_room",
        cpu={"style": "boss_showman", "rangeM": [1.4, 3.2], "zoning": ["spotlight_m"], "antiAir": ["mic_drop_l", "2H"],
             "counter": ["commercial_break_m"], "punish": ["5H", "the_hook_h"], "combo": ["2M", "5H", "the_hook_m"],
             "phase2": ["pyro_m", "season_finale"], "meter": "standing_ovation"},
        doc=dict(
            difficulty=3, packs="Great_Sword (two-handed = mic-cane), Gestures (host)",
            look="Ch40 (showman mask, gold-trimmed vest, one gloved sleeve, striped trousers) retextured with a "
                 "sequined jacket; the microphone-cane prop is held two-handed like the Great_Sword clips "
                 "(research flag: those clips are two-handed).",
            bio="The face of KNOCKOUT 13 for thirty years and the only man who has read the contracts. Every "
                "season ends the same way: the last contestant standing gets to fight the host, live, for the "
                "right to leave. Nobody has left.",
            plan="Two phases, honest frame data (FIGHTING_DESIGN 10: tools not cheats): SPOTLIGHT beams zone, "
                 "COMMERCIAL BREAK counters a predictable strike, MIC DROP anti-airs, THE HOOK (vaudeville cane) "
                 "drags them in from range. Below 50% HP (once per bout) PHASE 2 adds PYRO - a floor fire line - "
                 "and a second Lv3, SEASON FINALE, that uses the whole set.",
            weakness="Two readable phases; COMMERCIAL BREAK loses to throws and delays; THE HOOK is -12 on block; "
                     "13,000 HP but the same frame rules as the players.",
            rivalry="Everyone's. He picks the rivals.",
        ),
    )

    K.clip("idle", mix(GS + "great sword idle", (1, 61), loop=True), "OVERRIDE shared idle: two-handed cane stance")
    K.clip("walk_f", mix(GS + "great sword walk", (1, 42), loop=True), "OVERRIDE shared walk_f: cane walk")
    K.clip("walk_b", mix(GS + "great sword walk (2)", (1, 40), loop=True), "OVERRIDE shared walk_b (loop 0.6 deg)")
    K.clip("cane_jab", mix(GS + "great sword attack", (5, 37), contact=17),
           "Mixamo great sword attack: two-hand butt thrust, front pass f17 (reach + cane length)")
    K.clip("cane_swing", mix(GS + "great sword slash", (8, 39), contact=19),
           "Mixamo great sword slash: overhead-diagonal chop, front pass f19")
    K.clip("showstopper", mix(GS + "great sword slash (3)", (10, 56), contact=27),
           "Mixamo great sword slash (3): horizontal two-hand swing, front pass f27")
    K.clip("low_tap", crouch(mix(GS + "great sword attack", (5, 37), contact=17),
                             lower=mix(GS + "great sword crouching (3)", (1, 56), loop=True)),
           "LAYERED: great sword crouching (3) legs (hips 0.49 m measured) + cane thrust")
    K.clip("low_cane", mix(GS + "great sword slash (5)", (1, 44), contact=16),
           "Mixamo great sword slash (5): low crouch swing (hips 0.49-0.62 m)")
    K.clip("cane_twirl", dict(mix(GS + "great sword high spin attack", (1, 40), contact=7), effector="RightHand"),
           "Mixamo great sword high spin: both hands up in front = anti-air twirl. Contact f7 + effector RightHand (2026-09-30): bake trace hands 1.68 / 1.61 m, 0.42 / 0.56 m forward, lateral < 0.1 m; at the old f11 the hands were already swinging 0.36 m to the side and the builder picked the RightKnee (0.64 m) as the effector")
    K.clip("sledgehammer", mix(GS + "great sword slash (4)", (25, 55), contact=43),
           "Mixamo great sword slash (4): sledgehammer overhead chop, impact f41-43 (dense render)")
    K.clip("stage_kick", mix(GS + "great sword kick", (5, 46), contact=19),
           "Mixamo great sword kick (holding the cane), front pass f19 (1.07 m)")
    K.clip("hook_slide", mix(GS + "great sword slide attack", (1, 65), contact=38),
           "Mixamo great sword slide attack: kneeling lunge swing, second front pass f38 = the vaudeville hook")
    K.clip("air_jab", air(mix(GS + "great sword attack", (5, 37), contact=17)), "jump legs + cane thrust")
    K.clip("air_swing", air(mix(GS + "great sword slash", (8, 39), contact=19)), "jump legs + chop")
    K.clip("air_hammer", air(mix(GS + "great sword slash (4)", (25, 55), contact=43)), "jump legs + sledgehammer")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9), "two-hand grab")
    K.clip("three_swings", dict(mix(GS + "great sword slash (2)", (15, 107), contact=26), contacts=[26, 59, 80]),
           "Mixamo great sword slash (2): three two-hand swings (front passes f25/f53/f81)")
    K.clip("spin_fling", mix(GS + "great sword high spin attack", (1, 57), contact=18),
           "Mixamo great sword high spin (full): 360 swing flings them behind")
    K.clip("spotlight_cast", mix(GS + "great sword attack", (1, 37), contact=17),
           "great sword attack thrust: the cane's head fires the spotlight beam")
    K.clip("catch_pose", mix(GS + "great sword blocking", (1, 16)),
           "Mixamo great sword blocking: cane held horizontal = COMMERCIAL BREAK catch")
    K.clip("mic_drop_leap", layer(mix(GS + "great sword jump (2)", (1, 28)),
                                  mix(GS + "great sword slash (3)", (10, 56), contact=27), mode="sync"),
           "LAYERED: great sword jump (2) legs (apex f10 measured) + horizontal swing = leaping anti-air")
    K.clip("counter_smash", mix(GS + "great sword slash (4)", (25, 55), contact=43),
           "great sword slash (4) sledgehammer, fitted separately for the 6-frame counter follow-up")
    K.clip("finale_slam", mix(GS + "great sword casting", (40, 110), contact=72),
           "great sword casting floor smash, fitted separately for the 10-frame Lv3 trigger")
    K.clip("pyro_slam", mix(GS + "great sword casting", (40, 110), contact=72),
           "Mixamo great sword casting: smashes the cane into the floor (f72) = triggers the pyro line")
    K.clip("intro_power", mix(GS + "great sword power up", (1, 94)), "cane power-up flourish")
    K.clip("win_bow", mix(GE + "happy hand gesture", (1, 83)), "host gesture")
    K.clip("win_cane", mix(GS + "great sword idle (3)", (1, 109)), "cane idle (3)")
    K.clip("taunt_dismiss", mix(GE + "dismissing gesture", (1, 99)), "dismissive host wave")

    K.add("5L", "L", name="Cane Jab", clip="cane_jab", cancel=["chain:5L", "chain:2L", "special", "super"],
          role=["poke"], desc="Two-hand cane butt thrust.")
    K.add("2L", "2L", name="Tap Dance", clip="low_tap", cancel=["chain:2L", "special", "super"], role=["poke", "low"],
          desc="Crouching cane tap to the ankle.")
    K.add("5M", "M", name="Cane Swing", clip="cane_swing", startup=9, recovery=17, cancel=["special", "super"],
          role=["poke"], desc="Diagonal cane chop.", why="Cane weight: 9/3/17 (+2/-4).")
    K.add("2M", "2M", name="Low Cane", clip="low_cane", startup=9, cancel=["special", "super"], role=["poke", "low"],
          desc="Low sweeping cane swing.", why="Startup 9 (long cane).")
    K.add("5H", "H", name="Showstopper", clip="showstopper", cancel=["special", "super"], sfx=[[8, "whoosh_heavy"]],
          desc="Big horizontal cane swing.")
    K.add("2H", "AA", name="Cane Twirl", clip="cane_twirl", juggle={"js": 1, "ji": 1, "jl": 0},
          boxes=[{"f": [9, 12], "x": 0.60, "y": 1.80, "w": 0.70, "h": 0.50}],
          cancel=["special", "super"], desc="Chest-high twirl: anti-air.")
    K.add("3H", "SWEEP", input="3H", kind="command", name="The Hook", clip="hook_slide", startup=14,
          move=[[0, 0], [14, 0.8]], launch=[-2.0, 0.0], cancel=[],
          desc="Vaudeville hook: a sliding low cane swing that drags them in and down.",
          why="Sweep on 3H (2H is the anti-air); the hook slides 0.8 m (startup 14) and pulls the victim toward "
              "him on hit (launch vx -2.0 m/s).")
    K.add("4M", "M", input="4M", kind="command", name="Stage Kick", clip="stage_kick", startup=9, recovery=17,
          desc="Kick while holding the cane.", why="9/3/17 (+2/-4).")
    K.add("6H", "OH", input="6H", kind="command", name="Sledgehammer", clip="sledgehammer", startup=20, damage=800,
          sfx=[[12, "whoosh_heavy"]], desc="Two-hand overhead cane smash.",
          why="Overhead with a two-hand weapon: 20f and 800.")
    K.add("j.L", "jL", input="j.L", name="Air Thrust", clip="air_jab", desc="Air cane thrust.")
    K.add("j.M", "jM", input="j.M", name="Air Chop", clip="air_swing", desc="Air cane chop.")
    K.add("j.H", "jH", input="j.H", name="Air Sledgehammer", clip="air_hammer", desc="Overhead cane jump-in.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Three-Act Beating", clip="throw_reach", damage=1300,
          grab={"frames": 54, "adv": 21, "hitF": 40, "swap": False, "air": False, "techable": True,
                "clip": "three_swings"}, desc="Holds them at cane's length for three swings.",
          why="Boss throw: 1300.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Exit Stage Left", clip="throw_reach", damage=1300,
          grab={"frames": 48, "adv": 15, "hitF": 30, "swap": True, "air": False, "techable": True,
                "clip": "spin_fling"}, desc="Spins them past with the cane.", why="Boss throw: 1300.")

    beam = {"life": 180, "box": [0.50, 0.50], "y": 1.30, "hits": 1, "clip": "spotlight_beam", "x": 0.8}
    K.special("spotlight", "proj", motion="236",
              common=dict(name="Spotlight", clip="spotlight_cast", cancel=["super"], role=["projectile"],
                          sfx=[[0, "electric_zap"]], desc="The cane head fires a spotlight beam.",
                          why="Boss projectile: template frames, beams 5.0/6.5/8.0 m/s."),
              per={s: dict(projectile=dict(beam, speed=v, strength=s.upper()))
                   for s, v in (("l", 5.0), ("m", 6.5), ("h", 8.0))},
              ex=dict(name="Spotlight (EX)", startup=11, recovery=30, damage=1000,
                      projectile=dict(beam, speed=8.0, hits=2, strength="H", box=[0.7, 0.7]),
                      desc="Double beam: 2 hits.", why="EX: 2 hits, 11f."))
    cb = {}
    for s, (c1, rec) in {"l": (14, 24), "m": (18, 28), "h": (22, 32)}.items():
        cb[s] = dict(active=c1 - 2, recovery=rec, counter={"catch": [3, c1], "vs": ["strike"],
                                                           "follow": "commercial_hit"})
    K.special("commercial_break", None, motion="214",
              common=dict(name="Commercial Break", clip="catch_pose", startup=3, damage=0, hitstun=0, blockstun=0,
                          hitstop=0, gain=0, nerve=0, pb=(0.0, 0.0), guard="HL", cancel=[], role=["reversal"],
                          desc="Parry-counter: 'We'll be right back' - catches a strike and answers with the "
                               "sledgehammer.",
                          why="FIGHTING_DESIGN 8c 'COMMERCIAL BREAK parry-counter' (move-level counter block, the "
                              "same mechanic as Rerun's): catch 3-14/3-18/3-22, whiff recovery 24/28/32."),
              per=cb,
              ex=dict(name="Commercial Break (EX)", startup=1, active=24, recovery=24,
                      counter={"catch": [1, 24], "vs": ["strike", "proj"], "follow": "commercial_hit"},
                      desc="Catches strikes and projectiles from frame 1.", why="EX: catch 1-24 incl. projectiles."))
    K.add("commercial_hit", None, kind="special", input="214>catch", name="Back After This", strength="H", tc=True,
          clip="counter_smash", startup=6, active=3, recovery=22, damage=1400, hitstun=55, blockstun=16, hitstop=17,
          guard="HL", gain=1000, nerve=3000, pb=(0.0, 0.50), kd="soft", cancel=["super"], role=["reversal"],
          desc="The counter's sledgehammer (after a COMMERCIAL BREAK catch).",
          why="Counter follow-up: 6/3/22, 1400, KD +30 (boss damage).")
    md = {}
    for s, (st, rec, dmg, inv) in {"l": (6, 30, 1000, 12), "m": (7, 34, 1100, 9), "h": (8, 38, 1300, 7)}.items():
        md[s] = dict(startup=st, recovery=rec, damage=dmg, hitstun=30 + 6 + rec, invuln={"air": [1, inv]},
                     moveY=[[0, 0], [st, 0.3], [st + 6, 1.0], [st + 6 + rec - 3, 0.0]])
    K.special("mic_drop", None, motion="623",
              common=dict(name="Mic Drop", clip="mic_drop_leap", active=6, blockstun=20, hitstop=15, guard="HL",
                          gain=800, nerve=4000, pb=(0.0, 0.45), kd="soft", launch=[1.2, 5.5],
                          juggle={"js": 1, "ji": 1, "jl": 5}, cancel=["super"], role=["antiair"],
                          sfx=[[2, "whoosh_heavy"]], desc="Leaping cane swing anti-air.",
                          why="Boss anti-air: 6/7/8 startup, air-invulnerable 1-12/1-9/1-7, -16/-20/-24."),
              per=md,
              ex=dict(name="Mic Drop (EX)", startup=6, recovery=36, damage=1500, hitstun=72,
                      invuln={"strike": [1, 9], "throw": [1, 9], "air": [1, 9], "proj": [1, 9]},
                      moveY=[[0, 0], [6, 0.3], [12, 1.2], [45, 0.0]], role=["antiair", "reversal"],
                      desc="Fully invulnerable.", why="EX: fully invulnerable 1-9."))
    th = {}
    for s, (st, mv, dmg) in {"l": (16, 1.0, 800), "m": (18, 1.5, 900), "h": (20, 2.0, 1000)}.items():
        th[s] = dict(startup=st, damage=dmg, move=[[0, 0], [st, mv]])
    K.special("the_hook", None, motion="41236",
              common=dict(name="Get The Hook", clip="hook_slide", active=4, recovery=24, hitstun=58, blockstun=16,
                          hitstop=15, guard="L", gain=900, nerve=3000, pb=(0.0, 0.40), kd="soft", launch=[-3.0, 0.0],
                          cancel=["super"], role=["low", "approach"], sfx=[[3, "whoosh_heavy"]],
                          desc="Sliding low hook that drags them across the floor to him (low, knockdown).",
                          why="Vaudeville hook special: 16/18/20 slide 1.0/1.5/2.0 m, pulls on hit, -12 on block."),
              per=th,
              ex=dict(name="Get The Hook (EX)", startup=14, active=10, recovery=20, damage=1300, hitstun=52,
                      armor={"hits": 1, "f": [1, 13]}, move=[[0, 0], [14, 2.2]],
                      hits=[{"f": [14, 15], "damage": 500, "hitstop": 11}, {"f": [22, 23], "damage": 800,
                                                                           "hitstop": 15}],
                      desc="Armored 2-hit hook, -6 on block.", why="EX: 1-hit armor, 2 hits, -6."))
    pyro = {"life": 150, "box": [0.60, 1.40], "y": 0.70, "hits": 2, "clip": "pyro_line", "x": 0.8, "ground": True}
    K.special("pyro", None, motion="22",
              common=dict(name="Pyro", clip="pyro_slam", startup=18, active=1, recovery=30, damage=800, hitstun=34,
                          blockstun=26, hitstop=8, guard="HL", gain=700, nerve=3000, pb=(0.40, 0.50), phase=2,
                          cancel=["super"], role=["projectile"], sfx=[[0, "explosion"]],
                          desc="PHASE 2: the cane slams the floor and a line of stage pyro races along it (2 hits).",
                          why="Phase-2 second projectile (FIGHTING_DESIGN 8c/9b): a tall floor fire line you jump "
                              "or block; 18f startup, -5 point blank."),
              per={s: dict(projectile=dict(pyro, speed=v, strength=s.upper()))
                   for s, v in (("l", 3.5), ("m", 4.5), ("h", 5.5))},
              ex=dict(name="Pyro (EX)", startup=14, damage=1200, projectile=dict(pyro, speed=5.5, hits=3, strength="H"),
                      desc="Three-hit pyro line.", why="EX: 3 hits, 14f."))

    K.add("standing_ovation", LV1, kind="super1", input="236236", name="Standing Ovation", strength="H",
          clip="three_swings", active=36, recovery=53, damage=2200, hitstun=78,
          hits=[{"f": [8, 9], "damage": 600, "hitstop": 9}, {"f": [28, 29], "damage": 700, "hitstop": 9},
                {"f": [42, 43], "damage": 900, "hitstop": 20}],
          warp="auto", invuln={"strike": [1, 10], "throw": [1, 10]}, move=[[0, 0], [8, 0.5], [28, 1.1], [42, 1.6]],
          kd="soft", juggle={"js": 1, "ji": 0, "jl": 99}, cost={"showtime": LV1_COST}, gain=0, nerve=600,
          role=["reversal"], sfx=[[1, "crowd_cheer_burst"]],
          desc="Invulnerable three-swing cane routine.",
          why="Boss Lv1: invulnerable 1-10, 3 swings 14-20 frames apart (the clip's three swings), 2200 (boss "
              "damage), -30 on block.")
    K.add("prime_time", LV3, kind="super3", input="214214", name="Prime Time", strength="H", clip="showstopper",
          damage=5000, invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 0.8]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic={"frames": 170, "cue": "ricky_prime_time", "hits": [[20, 700], [50, 900], [80, 1000], [140, 2400]],
                     "anim": [[0, "showstopper"], [30, "cane_swing"], [60, "three_swings"], [110, "intro_power"],
                              [130, "sledgehammer"], [150, "win_bow"]],
                     "victim": [[0, "hit_high_l"], [30, "hit_high_s"], [60, "hit_body"], [110, "dizzy"],
                                [140, "kd_fall_b"], [152, "kd_ground_b"]],
                     "shots": [[0, "host_cam"], [30, "side_close"], [60, "punch_in"], [110, "spotlight"],
                               [130, "top_down"], [150, "crowd_pop"]],
                     "endAdv": 19, "endGapM": 2.2},
          desc="PRIME TIME (phase 1): the host's cane routine for camera one.",
          why="Boss Lv3: 5000 (inside the SF6 2600-5300 range), 10/4/58.")
    K.add("season_finale", LV3, kind="super3", input="214214", name="Season Finale", strength="H", clip="finale_slam",
          damage=5300, phase=2, invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 0.5]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic={"frames": 180, "cue": "ricky_season_finale",
                     "hits": [[25, 800], [60, 1000], [95, 1000], [150, 2500]],
                     "anim": [[0, "pyro_slam"], [45, "showstopper"], [80, "spin_fling"], [120, "intro_power"],
                              [140, "sledgehammer"], [160, "win_bow"]],
                     "victim": [[0, "hit_body"], [45, "hit_high_l"], [80, "hit_air"], [120, "dizzy"],
                                [150, "kd_fall_b"], [165, "kd_ground_b"]],
                     "shots": [[0, "wide"], [25, "low_angle_up"], [45, "side_close"], [80, "orbit"],
                               [120, "host_cam"], [150, "slowmo_hold"], [165, "crowd_pop"]],
                     "endAdv": 19, "endGapM": 2.5},
          desc="PHASE 2 Lv3: the whole set - pyro columns, a falling lighting rig and the confetti cannon.",
          why="Phase-2 Lv3 'that uses the arena' (FIGHTING_DESIGN 8c): 5300 = the SF6 Lv3 maximum, 180 frames.")

    K.simple = {"5S": "spotlight_m", "6S": "the_hook_m", "2S": "mic_drop_m", "4S": "commercial_break_m",
                "S+H": "standing_ovation", "S+H+2": "prime_time", "assist": ["2L", "5M", "5H", "the_hook_m"]}
    K.classic = [{"motion": "236", "btn": "LMH", "move": "spotlight_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "commercial_break_{s}"},
                 {"motion": "623", "btn": "LMH", "move": "mic_drop_{s}"},
                 {"motion": "41236", "btn": "LMH", "move": "the_hook_{s}"},
                 {"motion": "22", "btn": "LMH", "move": "pyro_{s}",
                  "note": "PYRO exists only in phase 2 (move field phase: 2); in phase 2 SIMPLE 6S routes to PYRO "
                          "and S+H+2 to SEASON FINALE (unique.phases)."}]
    K.unique = {"kind": "phases", "thresholdPct": 50, "lockF": 60, "cue": "ricky_phase2",
                "moves": ["pyro_l", "pyro_m", "pyro_h", "pyro_ex", "season_finale"], "lv3": "season_finale",
                "simple": {"6S": "pyro_m"}}
    K.cine_doc = [
        "PRIME TIME (phase 1, 170 f): f0 host_cam: 'Ladies and gentlemen...' SHOWSTOPPER - 700 at f20; f30 CANE "
        "SWING - 900 at f50; f60 THREE-ACT BEATING (punch_in) - 1000 at f80; f110 POWER-UP (spotlight): the set "
        "goes dark except his spotlight; f130 SLEDGEHAMMER (top_down) - 2400 at f140; f150 BOW (crowd_pop).",
        "SEASON FINALE (phase 2, 180 f): f0 wide: the cane slams the floor, pyro columns erupt - 800 at f25; "
        "f45 SHOWSTOPPER - 1000 at f60; f80 SPIN FLING (orbit) into the lighting rig - 1000 at f95; f120 "
        "host_cam: 'And that's our season!'; f140 SLEDGEHAMMER as the rig falls (slowmo_hold) - 2500 at f150; "
        "f160 BOW under the confetti cannon (crowd_pop).",
    ]
    return K
