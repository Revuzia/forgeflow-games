"""RICKY MARQUEE - boss, two-phase showman (Great_Sword_Pack = two-handed clips -> his mic-cane is held in both
hands; Gestures for the host; one Pro_Magic-free kit)."""
from kitlib import (Kit, air, cam, cinematic, crouch, layer, mix, LV1, LV3, LV1_COST, LV3_COST)

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
             "phase2": ["pyro_m", "season_finale"], "meter": "standing_ovation", "antiStep": ["2M", "5H"]},
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
            # CHANGED(FIGHTERS3D): 3D ring play (CONTRACT 35.12)
            ring=dict(
                stepping="Phase 1 SPOTLIGHT beams are LINEAR (fired straight along the cane): step them on anticipation; "
                         "the EX beam is AIMED. GET THE HOOK L/M/H is a LINEAR slide. In phase 2 the PYRO floor line is "
                         "AIMED on the slam, so the step has to come after it starts racing. COMMERCIAL BREAK catches a "
                         "step-attack like any strike, and BACK AFTER THIS homes onto the caught attacker.",
                homing="5H SHOWSTOPPER (12f horizontal cane swing, homing, -3) and 2M LOW CANE (9f homing low, 0.40 m "
                       "deep) are the anti-step tools; 3H THE HOOK is a homing sweep that drags them in; STANDING "
                       "OVATION, PRIME TIME and SEASON FINALE home.",
                wall="5H SHOWSTOPPER wall-splats at the ring edge; THE HOOK pulls opponents toward him - off the wall - "
                     "when he wants the centre of the set."),
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
    K.clip("sledgehammer", mix(GS + "great sword slash (4)", (25, 55), contact=42),
           "Mixamo great sword slash (4): sledgehammer overhead chop, impact f41-43 (dense render). P2: contact 43 -> 42 "
           "= the measured front pass on the baked body (bake: hands farthest forward at output f17 = source 42, "
           "LeftHand 0.59 m / 1.45 m; at 43 already falling to 1.31 m). contact_check's EXT flag stays: the arms keep "
           "extending DOWN for 4 more frames after the cane head has crossed the opponent (prop reach, not a late fist)")
    K.clip("stage_kick", mix(GS + "great sword kick", (5, 46), contact=19),
           "Mixamo great sword kick (holding the cane), front pass f19 (1.07 m)")
    K.clip("hook_slide", mix(GS + "great sword slide attack", (1, 65), contact=38),
           "Mixamo great sword slide attack: kneeling lunge swing, second front pass f38 = the vaudeville hook")
    K.clip("air_jab", air(mix(GS + "great sword attack", (5, 37), contact=17)), "jump legs + cane thrust")
    K.clip("air_swing", air(mix(GS + "great sword slash", (8, 39), contact=19)), "jump legs + chop")
    K.clip("air_hammer", air(mix(GS + "great sword slash (4)", (25, 55), contact=40)),
           "jump legs + sledgehammer. P2: contact 43 -> 40 = the measured front pass of the air version (bake: hands "
           "0.70 m forward at output f10 = source 40; at 43 they were 0.58 m forward at 0.89 m, dropping)")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9), "two-hand grab")
    K.clip("three_swings", dict(mix(GS + "great sword slash (2)", (15, 95), contact=26), contacts=[26, 59, 80]),
           "Mixamo great sword slash (2): three two-hand swings (front passes f25/f53/f81). P2: window 15-107 -> 15-95 "
           "(the tail after the third swing; 3.07 s over the 54-frame throw lock was 3.4x, now 2.67 s over 64 f = 2.5x)")
    K.clip("spin_fling", mix(GS + "great sword high spin attack", (1, 57), contact=18),
           "Mixamo great sword high spin (full): 360 swing flings them behind")
    K.clip("spotlight_cast", mix(GS + "great sword attack", (1, 37), contact=17),
           "great sword attack thrust: the cane's head fires the spotlight beam")
    K.clip("catch_pose", mix(GS + "great sword blocking", (1, 16)),
           "Mixamo great sword blocking: cane held horizontal = COMMERCIAL BREAK catch")
    K.clip("mic_drop_leap", layer(mix(GS + "great sword jump (2)", (1, 28)),
                                  mix(GS + "great sword slash (3)", (10, 56), contact=27), mode="sync"),
           "LAYERED: great sword jump (2) legs (apex f10 measured) + horizontal swing = leaping anti-air")
    K.clip("counter_smash", mix(GS + "great sword slash (4)", (25, 55), contact=42),
           "great sword slash (4) sledgehammer, fitted separately for the 6-frame counter follow-up. P2: contact 43 -> "
           "42 (the measured front pass, as `sledgehammer`)")
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
    K.add("2M", "2M", name="Low Cane", clip="low_cane", startup=9, cancel=["special", "super"],
          role=["poke", "low", "antistep"], homing=True, lateralM=0.40,
          why3d="low sweeping cane swing: homing anti-step low, 0.40 m deep",
          desc="Low sweeping cane swing; homing.", why="Startup 9 (long cane).")
    K.add("5H", "H", name="Showstopper", clip="showstopper", cancel=["special", "super"], sfx=[[8, "whoosh_heavy"]],
          role=["antistep"], homing=True, wallSplat=True,
          why3d="big horizontal cane swing: homing; wall-splats at the ring edge (3D wall game)",
          desc="Big horizontal cane swing; homing; wall-splats at the ring edge.")
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
          grab={"frames": 64, "adv": 21, "hitF": 52, "swap": False, "air": False, "techable": True,
                "clip": "three_swings",
                # P2 paired throw: three_swings (f15-95, 2.67 s over 64 f) swings at clip 0.37 / 1.47 / 2.17 s = lock 9 /
                # 35 / 52: head, body, and the third drops them (kd_fall_b, face up). Lock 54 -> 64 (was 3.4x).
                "victim": [[0, "hit_high_s", 0.0, 0.1], [9, "hit_high_s", 0.0, 0.6], [35, "hit_body", 0.1, 0.6],
                           [52, "kd_fall_b", 1.04, 1.5]]},
          desc="Holds them at cane's length for three swings.",
          why="Boss throw: 1300.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Exit Stage Left", clip="throw_reach", damage=1300,
          grab={"frames": 48, "adv": 15, "hitF": 15, "swap": True, "air": False, "techable": True,
                "clip": "spin_fling",
                # P2 paired throw: the high spin's swing passes the front at clip 0.57 s = lock 15 (1.87 s over 48 f); the
                # victim is pulled into the spin (thrown_b 0 -> 0.40 s) and thrown face down behind him.
                "victim": [[0, "hit_high_s", 0.0, 0.1], [4, "thrown_b", 0.0, 0.4], [15, "thrown_b", 0.4, 1.2]]},
          desc="Spins them past with the cane.", why="Boss throw: 1300.")

    beam = {"life": 180, "box": [0.50, 0.50], "y": 1.30, "hits": 1, "clip": "spotlight_beam", "x": 0.8}
    K.special("spotlight", "proj", motion="236",
              common=dict(name="Spotlight", clip="spotlight_cast", cancel=["super"], role=["projectile"],
                          sfx=[[0, "electric_zap"]], desc="The cane head fires a spotlight beam.",
                          why="Boss projectile: template frames, beams 5.0/6.5/8.0 m/s."),
              per={s: dict(projectile=dict(beam, speed=v, strength=s.upper()), linear=True,
                           why3d="a beam straight along the cane: linear, not aimed (step bait)")
                   for s, v in (("l", 5.0), ("m", 6.5), ("h", 8.0))},
              ex=dict(name="Spotlight (EX)", startup=11, recovery=30, damage=1000, aimed=True,
                      why3d="OD reward: the double beam is AIMED on the release frame",
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
          homing=True, why3d="counter follow-up: homes onto the caught attacker",
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
        th[s] = dict(startup=st, damage=dmg, move=[[0, 0], [st, mv]], linear=True,
                     why3d="a 1-2 m slide along its frame-1 line: linear")
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
                      why3d="OD: not linear - re-aims until frame 8 (special default)",
                      desc="Armored 2-hit hook, -6 on block.", why="EX: 1-hit armor, 2 hits, -6."))
    pyro = {"life": 150, "box": [0.60, 1.40], "y": 0.70, "hits": 2, "clip": "pyro_line", "x": 0.8, "ground": True}
    K.special("pyro", None, motion="22",
              common=dict(name="Pyro", clip="pyro_slam", startup=18, active=1, recovery=30, damage=800, hitstun=34,
                          blockstun=26, hitstop=8, guard="HL", gain=700, nerve=3000, pb=(0.40, 0.50), phase=2,
                          cancel=["super"], role=["projectile"], sfx=[[0, "explosion"]], aimed=True,
                          why3d="phase 2: the fire line is AIMED at the opponent on the slam",
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
          cinematic=lambda: cinematic(
              170, "ricky_prime_time",
              hits=[[26, 700], [52, 900], [82, 1000], [140, 2400]],
              anim=[K.seg(0, "showstopper", 18, fromS=0.53), K.seg(18, "cane_swing", 42, hit=26),
                    K.seg(42, "three_swings", 92, hit=52, rate=2.2), K.seg(92, "intro_power", 122, fromS=1.2, rate=1.5),
                    K.seg(122, "sledgehammer", 150, hit=140), K.seg(150, "win_bow", 170, fromS=0.4)],
              victim=[[0, "hit_high_l", 0.0, 0.4], [26, "hit_high_s", 0.0, 0.4], [52, "hit_high_l", 0.0, 0.5],
                      [82, "hit_body", 0.1, 0.6], [100, "dizzy", 0.4, 1.2], [140, "kd_fall_b", 1.2, 1.8667],
                      [158, "kd_ground_b", 0.0, 0.367]],
              camera=[cam(0, 18, "close", "attacker", 30, 2.0, 1.6, 35),
                      cam(18, 42, "close", "defender", 32, 2.0, 1.55, 35),
                      cam(42, 92, "over_shoulder", "defender", 36, 2.5, 1.8, -65),
                      cam(92, 122, "low", "attacker", 40, 2.6, 0.5, 20, lookH=1.6),
                      cam(122, 150, "top", "defender", 40, 1.5, 5.4, 10, lookH=0.5),
                      cam(150, 170, "wide", "both", 38, 5.6, 1.8, 0)],
              fx=[(0, "slate"), (0, "spot", "attacker"), (18, "spot_off"), (26, "impact_m"), (52, "impact_m"),
                  (52, "sparks"), (82, "impact_m"), (82, "shake_s"), (92, "dim"), (92, "spot", "attacker"),
                  (122, "spot_off"), (140, "impact_l"), (140, "flash"), (140, "shake_l"), (140, "dust"),
                  (140, "freeze_frame"), (142, "undim"), (150, "confetti")],
              crowd=[(0, "applause"), (26, "ooh"), (52, "ooh"), (82, "cheer", "up"), (92, "hush"),
                     (140, "roar", "spike"), (150, "applause", "peak")],
              pathA=[[26, 0.1, 0], [52, 0.25, 0], [82, 0.4, 0], [120, 0.35, 0], [140, 0.45, 0], [168, 0, 0]],
              gapD=[[26, 1.1, 0], [52, 1.2, 0], [82, 1.15, 0], [100, 1.2, 0], [140, 1.3, 0], [146, 1.6, 0],
                    [168, 2.2, 0]],
              slate="PRIME TIME - RICKY MARQUEE: FOR CAMERA ONE", endPose="back", endAdv=19, endGapM=2.2),
          desc="PRIME TIME (phase 1): the host's cane routine for camera one.",
          why="Boss Lv3: 5000 (inside the SF6 2600-5300 range), 10/4/58.")
    K.add("season_finale", LV3, kind="super3", input="214214", name="Season Finale", strength="H", clip="finale_slam",
          damage=5300, phase=2, invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 0.5]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic=lambda: cinematic(
              180, "ricky_season_finale",
              hits=[[25, 800], [60, 1000], [95, 1000], [150, 2500]],
              anim=[K.seg(0, "pyro_slam", 45, hit=25), K.seg(45, "showstopper", 80, hit=60),
                    K.seg(80, "spin_fling", 120, hit=95), K.seg(120, "taunt_dismiss", 140, fromS=0.5),
                    K.seg(140, "sledgehammer", 165, hit=150), K.seg(165, "win_bow", 180, fromS=0.4)],
              victim=[[0, "hit_body", 0.0, 0.4], [25, "hit_air", 0.0, 0.6], [60, "hit_high_l", 0.0, 0.5],
                      [95, "hit_air", 0.1, 0.8], [120, "dizzy", 0.4, 1.0], [150, "kd_fall_b", 1.25, 1.8667],
                      [165, "kd_ground_b", 0.0, 0.367]],
              camera=[cam(0, 25, "wide", "both", 40, 5.2, 1.8, 0, lookH=1.4),
                      cam(25, 45, "low", "defender", 42, 3.0, 0.35, 25, lookH=1.7),
                      cam(45, 80, "close", "both", [32, 28], [2.4, 2.0], 1.6, -30),
                      cam(80, 120, "orbit", "both", 40, 3.8, 1.6, [-40, 60], ease="linear"),
                      cam(120, 140, "close", "attacker", 30, 1.9, 1.6, 35),
                      cam(140, 165, "low", "defender", 42, 2.8, 0.4, -20, lookH=1.2),
                      cam(165, 180, "wide", "both", 40, 6.0, 2.0, 0)],
              fx=[(0, "slate"), (0, "pyro"), (25, "impact_m"), (25, "fire"), (25, "shake_m"), (60, "impact_m"),
                  (60, "sparks"), (95, "impact_m"), (95, "sparks"), (95, "lights_flicker"), (120, "spot", "attacker"),
                  (140, "spot_off"), (140, "lights_flicker"), (150, "impact_l"), (150, "flash"), (150, "shake_l"),
                  (150, "dust"), (150, "freeze_frame"), (165, "confetti"), (165, "pyro")],
              crowd=[(0, "roar", "up"), (25, "gasp"), (60, "ooh"), (95, "gasp", "up"), (120, "hush"),
                     (150, "roar", "spike"), (165, "applause", "peak")],
              pathA=[[25, 0, 0], [60, 0.2, 0], [95, 0.35, 0], [140, 0.3, 0], [150, 0.5, 0], [178, 0, 0]],
              gapD=[[25, 1.3, 0.5], [40, 1.3, 0], [60, 1.2, 0], [95, 1.4, 0.5], [110, 2.2, 0.8], [120, 2.0, 0],
                    [140, 1.3, 0], [150, 1.1, 0], [156, 1.3, 0], [178, 1.8, 0]],
              slate="PRIME TIME - RICKY MARQUEE: SEASON FINALE", endPose="back", endAdv=19, endGapM=1.8),
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
        "PRIME TIME (phase 1, 170 f): f0 close on the host (spotlight) as the SHOWSTOPPER follows through; f18 CANE "
        "SWING - 700 at f26; f42 THREE-ACT BEATING (over his shoulder, 2.2x) - 900 at f52, 1000 at f82; f92 POWER-UP "
        "(low, set dark, spotlight) while the victim wobbles; f122 SLEDGEHAMMER (top-down) - 2400 at f140 (flash, "
        "freeze-frame); f150 BOW under confetti (wide). Face up at 2.2 m.",
        "SEASON FINALE (phase 2, 180 f): f0 wide: the cane hits the floor, pyro columns erupt; f25 the blast lifts "
        "them - 800; f45 SHOWSTOPPER (close) - 1000 at f60; f80 SPIN FLING (orbit) into the lighting rig - 1000 at f95, "
        "lights flicker; f120 host close-up: 'And that's our season!'; f140 SLEDGEHAMMER (low) as the rig comes down - "
        "2500 at f150 (flash, freeze-frame); f165 BOW under the confetti cannon and a last pyro burst. Face up at 1.8 m.",
    ]
    K.text = dict(
        introLine="Ladies and gentlemen... it's ME.",
        winQuotes=["And THAT is why they call it my show.",
                   "Don't touch that dial. We'll be right back - you won't.",
                   "Another contestant, another rerun. Roll credits!"],
        banter={"johnny": ["The Headliner! Your band's name looks lovely on my office wall.",
                           "Sing for me, Johnny. The contract says you have to."],
                "patch": ["My old floor manager! Who's running the cables tonight?",
                          "Take direction, Patch: fall down, stage left."],
                "bruno": ["Bruno! Twenty years, and the steak is still on me.",
                          "Carry this, big man: the weight of cancellation."],
                "zambini": ["Zambini! Still hiding the assistant?",
                            "Here's a trick: I make your career disappear."],
                "krane": ["Officer! You're supposed to be guarding ME.",
                          "Your badge was a prop, Krane. So is your future."],
                "lotus": ["Lotus! I wrote that drunk-master bit, you know.",
                          "One more round - on the house. On your head."],
                "boneyard": ["Boneyard! My favourite butcher.",
                             "Tonight I'm the one holding the cleaver. Figuratively."],
                "spin": ["The rooftop kid! I made you famous. You're welcome.",
                         "Dance for the camera, Spin. Last dance."],
                "gazza": ["Gazza! Still no referee, I'm afraid.",
                          "Red card, son. Early bath."],
                "rerun": ["Rerun! My most profitable death.",
                          "Let's make it a double feature."],
                "default": ["Welcome to the Season Finale!",
                            "Nobody leaves my show. NOBODY."]},
        ending="RICKY MARQUEE wins his own show. The confetti falls, the ratings peak, and for one second the studio is "
               "silent - there is nobody left to host. He signs himself to another lifetime contract before the credits "
               "finish. Next Friday: same time, same cane. The season never ends; it only renews.")
    return K
