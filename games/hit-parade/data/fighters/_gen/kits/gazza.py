"""GAZZA - setplay footballer (Soccer_Game_Pack: shots, header, bicycle kick, slide tackle, keepy-uppy;
CMU 74_xx soccer-style swing kicks)."""
from kitlib import (Kit, air, cam, cinematic, cmu, crouch, mix, seq, LV1, LV3, LV1_COST, LV3_COST)

SC = "Soccer_Game_Pack/"


def build():
    K = Kit(
        id="gazza", name="GAZZA", persona="Goal Line", archetype="setplay",
        body="Ch08_nonPBR", heightM=1.80, hp=10000, build="average",
        walk=(2.00, 1.40), dash=(1.00, 0.75, 18, 23), jump=(4, 38, 3, 1.62, 1.45), throwRangeM=0.60,
        colors=[("Sunday League", None), ("Home Kit", "#c62828"), ("Away Kit", "#1565c0"), ("Goalkeeper", "#9ccc65")],
        intro="intro_flick", win=["win_point", "win_juggle"], taunt="taunt_keepy", rival="zambini", stage="rooftop",
        cpu={"style": "setplay", "rangeM": [1.8, 3.5], "zoning": ["power_shot_m", "power_shot_l"],
             "setup": ["keepy_m"], "antiAir": ["bicycle_l", "j.M"], "pokes": ["5M", "2M"],
             "punish": ["5H", "bicycle_h"], "combo": ["2L", "5M", "power_shot_h"], "approach": ["dive_m"],
             "meter": "top_bins", "antiStep": ["2M", "power_shot_l"]},
        doc=dict(
            difficulty=3, packs="Soccer_Game_Pack (shots, header, bicycle, slide, keepy-uppy) + CMU 74_xx swing kicks",
            look="Ch08: bearded, fade haircut, light-grey hoodie, grey sweatpants with a black side stripe, black "
                 "sneakers; one football (prop / ball entity).",
            bio="Scored forty goals a season for a pub team that no longer exists, then got banned from every "
                "ground in the county. HIT PARADE lets him bring his own ball. He still argues with the referee "
                "(there isn't one).",
            plan="Setplay: POWER SHOT (roller low, straight mid, chip lob), then KEEPY-UPPY parks the ball in the "
                 "air as an anti-air trap you can volley later; the ball rebounds once off the wall. BICYCLE KICK "
                 "is his anti-air, DIVE rolls under projectiles, the slide tackle 2H sweeps from range.",
            weakness="Without the ball he has no projectile (it rests on the floor until he walks over it or it "
                     "respawns after 3 s); BICYCLE KICK lands him on his back (-26 to -34); no anti-air normal.",
            rivalry="His stray shot popped Zambini's prize dove on live TV. Zambini swears revenge on the ball.",
            # CHANGED(FIGHTERS3D): 3D ring play (CONTRACT 35.12)
            ring=dict(
                stepping="POWER SHOT M is a straight driven shot (LINEAR, along his frame-1 facing): step it on "
                         "anticipation. The L roller, the H chip lob and the EX curler are AIMED on the kick, so against "
                         "those the step has to come after the ball leaves his foot. A missed shot rebounds off the ring "
                         "boundary (vector reflection) and can come back through a stepper's new line. 2H SLIDE TACKLE "
                         "and the SIMULATION dive are LINEAR.",
                homing="2M GRASS CUTTER (10f homing low swing kick, 0.40 m deep, -2) is the anti-step tool; KEEPY-UPPY "
                       "parks a ball above him that hits whoever circles in; TOP BINS is aimed; HAT TRICK homes.",
                wall="5H VOLLEY wall-splats at the ring edge; near the boundary a shot rebounds sooner, so the ball comes "
                     "back fast for the next set-play."),
        ),
    )

    K.clip("idle", mix(SC + "offensive idle", (1, 316), loop=True), "OVERRIDE shared idle: footballer's offensive "
                                                                    "idle (loop 1.2 deg)")
    K.clip("jab", cmu("jab.2", mirror=True), "CMU jab.2 clean (13_18 southpaw, mirrored; pilot p02)")
    K.clip("snap_kick", mix("Pro_Melee_Axe_Pack/standing melee attack kick ver. 2", (5, 40), contact=24),
           "Mixamo axe kick ver. 2 front snap kick (front pass f24) - unarmed")
    K.clip("volley", mix("Pro_Sword_and_Shield_Pack/sword and shield kick", (5, 37), contact=19),
           "Mixamo S&S kick: front kick right, usable unarmed per MIXAMO_CLIPS (front pass f19, 1.06 m)")
    K.clip("crouch_jab", crouch(cmu("jab.2", mirror=True)), "Crouch Idle legs + jab")
    K.clip("grass_cutter", cmu(take="74_03", rng=(181, 247), contact=226, kind="foot", limb="R_foot"),
           "CMU punt_kick 74_03 181/226/247 (usable: soccer-style swing kick, low 0.36 m)")
    K.clip("slide_tackle", mix(SC + "soccer tackle", (10, 70), contact=27),
           "Mixamo soccer tackle: feet-first slide, legs along the floor f26-28 (dense render)")
    K.clip("knee_trap", dict(mix(SC + "kneeing soccerball (2)", (1, 19), contact=9), effector="RightKnee"),
           "Mixamo kneeing soccerball (2): right knee at hip height f9-13 (dense render). P2: effector RightKnee - the "
           "builder named the right FOOT (bake: foot 0.50 m forward at 0.42 m up, knee 0.45 m / 0.98 m) because the toe "
           "sits 5 cm farther out than the knee, which fails the knee rule; contact_check flagged EXT on the foot")
    K.clip("header", mix(SC + "header soccerball", (15, 45), contact=27),
           "Mixamo header soccerball (weak: head only 1.14 m/s and behind the hips at contact - hitbox hand-set)")
    K.clip("air_knee", mix(SC + "kneeing soccerball", (1, 28), contact=16), "kneeing soccerball played airborne")
    K.clip("flying_volley", mix(SC + "strike foward jog", (8, 39), contact=18),
           "Mixamo strike foward jog (running kick, front pass f18 at 1.15 m) played airborne")
    K.clip("flying_punt", mix(SC + "goalkeeper drop kick", (55, 95), contact=65),
           "Mixamo goalkeeper drop kick: leg extended forward-up f65-66")
    K.clip("throw_reach", mix(SC + "goalkeeper catch (2)", (1, 30), contact=9), "goalkeeper two-hand catch")
    K.clip("drop_kick_throw", mix(SC + "goalkeeper drop kick", (45, 85), contact=65),
           "Mixamo goalkeeper drop kick f45-85: the drop, the step and the punt (leg extended f65). P2: window 40-118 -> "
           "45-85 (the full 2.6 s over a 50-frame lock played at 3.1x; 1.33 s = 1.6x)")
    K.clip("bicycle_toss", mix(SC + "scissor kick", (5, 80), contact=23),
           "P2 back throw: Mixamo scissor kick f5-80 with its real height (not ground-locked like the `bicycle` DP clip): "
           "he falls back and bicycle-kicks the victim over his head (f23), lands on his back and gets up facing the "
           "other way (net hips yaw +192 deg, mixamo_inventory) = the victim lands BEHIND him and his facing flip at the "
           "release is seamless. Replaces `keeper_throw` (goalkeeper overhand throw): it bowls FORWARD while a back "
           "throw's victim lands behind")
    K.clip("shot_kick", mix(SC + "soccer penalty kick", (12, 46), contact=27),
           "Mixamo soccer penalty kick: the plant and strike (front pass f27, foot at 0.42 m); run-up trimmed")
    K.clip("bicycle", mix(SC + "scissor kick", (1, 84), contact=23),
           "Mixamo scissor kick: foot at the top f23 (measured hips apex f23), lands on the back, up by f84")
    K.clip("keepy", mix(SC + "kick up soccerball", (1, 41), contact=20), "Mixamo kick up soccerball (flick f20)")
    K.clip("dive_roll", mix(SC + "goalkeeper diving save (2)", (20, 80)),
           "Mixamo goalkeeper diving save (2): forward dive-roll, back up by f97")
    K.clip("intro_flick", mix(SC + "kick up soccerball", (1, 41)), "flicks the ball up")
    K.clip("win_point", mix(SC + "goalkeeper directing", (1, 120)), "points and directs")
    K.clip("win_juggle", mix(SC + "stall soccerball (4)", (1, 56)), "stalls the ball")
    K.clip("taunt_keepy", mix(SC + "stall soccerball (2)", (1, 65)), "keepy-uppy stall")

    K.add("5L", "L", name="Jab", clip="jab", cancel=["chain:5L", "chain:2L", "special", "super"], role=["poke"],
          desc="Pub-brawler jab.")
    K.add("2L", "2L", name="Low Jab", clip="crouch_jab", cancel=["chain:2L", "chain:5L", "special", "super"],
          role=["poke", "low"], desc="Crouching jab.")
    K.add("5M", "M", name="Snap Kick", clip="snap_kick", startup=9, cancel=["special", "super"], role=["poke"],
          desc="Front snap kick.", why="Kick: startup 8->9 (+2/-4).")
    K.add("2M", "2M", name="Grass Cutter", clip="grass_cutter", startup=10,
          hurtOverride=[{"f": [1, 27], "w": 0.54, "h": 1.71}], cancel=["special", "super"],
          role=["poke", "low", "antistep"], homing=True, lateralM=0.40,
          why3d="soccer swing kick along the grass: homing anti-step low, 0.40 m deep",
          desc="Standing low swing kick along the grass: long low, but he stays tall; homing.",
          why="Footballer low: a standing soccer swing kick (low, 0.36 m) with a standing hurtbox; startup 10.")
    K.add("5H", "H", name="Volley", clip="volley", cancel=["special", "super"], sfx=[[8, "whoosh_heavy"]],
          wallSplat=True, why3d="straight front kick (tracks to f8); wall-splats at the ring edge (3D wall game)",
          desc="Big front volley; wall-splats at the ring edge.")
    K.add("2H", "SWEEP", name="Slide Tackle", clip="slide_tackle", startup=12, move=[[0, 0], [12, 1.2]],
          hurtOverride=[{"f": [6, 20], "w": 0.9, "h": 0.6}], role=["sweep", "low", "lowprofile"],
          homing=False, linear=True, why3d="a 1.2 m feet-first slide cannot turn: linear (not the homing sweep default)",
          sfx=[[4, "whoosh_light"]], desc="Feet-first slide tackle from range (travels 1.2 m).",
          why="Slide sweep: travels 1.2 m during a 12-frame startup (10->12), low profile 6-20.")
    K.add("4M", "M", input="4M", kind="command", name="Knee Trap", clip="knee_trap", startup=7, recovery=15,
          hitstun=20, blockstun=15, cancel=["special", "super"], desc="Quick short knee (+2/-3).",
          why="Short fast command normal: 7/3/15, +2/-3 (reach 0.45 m).")
    K.add("6H", "OH", input="6H", kind="command", name="Diving Header", clip="header", startup=20,
          moveY=[[0, 0], [8, 0.3], [20, 0.1], [22, 0.0]],
          boxes=[{"f": [20, 22], "x": 0.55, "y": 1.3625, "w": 0.40, "h": 0.725}],
          desc="Hopping header onto the head: overhead.",
          why="Header overhead: 20f on a small hop; the box is hand-set because the head is behind the hips at "
              "the clip contact (MIXAMO_CLIPS header note).")
    K.add("j.L", "jL", input="j.L", name="Air Knee", clip="air_knee", desc="Air knee.")
    K.add("j.M", "jM", input="j.M", name="Flying Volley", clip="flying_volley", role=["antiair"],
          desc="Air-to-air volley.")
    K.add("j.H", "jH", input="j.H", name="Flying Punt", clip="flying_punt", desc="Big flying punt jump-in.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Drop Kick", clip="throw_reach",
          grab={"frames": 50, "adv": 21, "hitF": 25, "swap": False, "air": False, "techable": True,
                "clip": "drop_kick_throw",
                # P2 paired throw: drop_kick_throw (f45-85, 1.33 s over 50 f) drops them and punts at clip 0.67 s = lock
                # 25; the victim folds while dropped and is punted up and away (thrown_f from the lift at 0.30 s, flat
                # on the back at lock ~36).
                "victim": [[0, "hit_body", 0.0, 0.35], [25, "thrown_f", 0.3, 1.3333]]},
          desc="Drops them like a ball and punts them away.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Overhead Kick", clip="throw_reach",
          grab={"frames": 64, "adv": 14, "hitF": 15, "swap": True, "air": False, "techable": True,
                "clip": "bicycle_toss",
                # P2 paired throw: bicycle_toss (scissor kick f5-80, 2.5 s over 64 f = 2.3x) kicks them over his head at
                # clip 0.60 s = lock 15; thrown_b flips them over (0.10 -> 0.67 s, lock 8-30) face down behind him while
                # he lands on his back and gets up turned round.
                "victim": [[0, "hit_high_s", 0.0, 0.15], [8, "thrown_b", 0.1, 0.67], [30, "thrown_b", 0.67, 1.2]]},
          desc="Falls back and bicycle-kicks them over his head.")

    ball = {"life": 180, "box": [0.30, 0.30], "hits": 1, "clip": "football", "x": 0.6}
    K.special("power_shot", "proj", motion="236",
              common=dict(name="Power Shot", clip="shot_kick", ball={"act": "shoot"}, cancel=["super"],
                          role=["projectile"], sfx=[[0, "ball_kick"]],
                          desc="Shoots the ball: L low roller (hit low), M straight, H chip lob; rebounds once off "
                               "the wall."),
              per={"l": dict(guard="L", projectile=dict(ball, speed=5.0, y=0.15, ground=True, strength="L"),
                             why="L is a ground roller: guard L (must be blocked crouching).", aimed=True,
                             why3d="the roller is AIMED at the opponent's feet"),
                   "m": dict(projectile=dict(ball, speed=7.0, y=1.0, strength="M"), linear=True,
                             why3d="a straight driven shot along his frame-1 facing: linear, not aimed (step bait)"),
                   "h": dict(projectile=dict(ball, speed=5.5, y=0.3, vy=5.5, g=14.0, strength="H"),
                             role=["projectile", "antiair"], aimed=True,
                             why3d="the chip lob is AIMED (it drops on the opponent's line)")},
              ex=dict(name="Power Shot (EX)", startup=11, recovery=30, damage=1000, aimed=True, projLateralM=0.30,
                      why3d="the curler is AIMED and bends 0.30 m wide",
                      projectile=dict(ball, speed=8.0, y=1.0, hits=2, strength="H"),
                      desc="Curling 2-hit shot.", why="EX: 2 hits, 11f."))
    K.special("bicycle", "dp", motion="623",
              common=dict(name="Bicycle Kick", clip="bicycle", active=8, cancel=["super"], launch=[1.0, 5.5],
                          juggle={"js": 1, "ji": 1, "jl": 5}, role=["antiair"], sfx=[[2, "whoosh_heavy"]],
                          desc="Overhead bicycle kick anti-air; lands on his back.",
                          why="Acrobatic DP: startup 7/8/9 (the flip), active 8, recovery 38/42/46 because he "
                              "lands on his back: -26/-30/-34 on block; air-invulnerable per the template."),
              per={"l": dict(startup=7, recovery=38, hitstun=81, moveY=[[0, 0], [7, 0.3], [12, 0.9], [22, 0.7],
                                                                           [48, 0.0]]),
                   "m": dict(startup=8, recovery=42, hitstun=85, moveY=[[0, 0], [8, 0.3], [13, 1.1], [24, 0.9],
                                                                           [53, 0.0]]),
                   "h": dict(startup=9, recovery=46, hitstun=89, moveY=[[0, 0], [9, 0.3], [14, 1.3], [26, 1.1],
                                                                           [58, 0.0]])},
              ex=dict(name="Bicycle Kick (EX)", startup=7, recovery=44, damage=1400, hitstun=87,
                      invuln={"strike": [1, 9], "throw": [1, 9], "air": [1, 9], "proj": [1, 9]},
                      hits=[{"f": [7, 8], "damage": 500, "hitstop": 9}, {"f": [11, 14], "damage": 900,
                                                                         "hitstop": 15}],
                      moveY=[[0, 0], [7, 0.3], [13, 1.3], [25, 1.1], [56, 0.0]], role=["antiair", "reversal"],
                      desc="Fully invulnerable bicycle.", why="EX: fully invulnerable 1-9, 2 hits."))
    hov = {"speed": 0.0, "box": [0.35, 0.35], "hits": 1, "clip": "football", "x": 0.2, "strength": "M"}
    K.special("keepy", None, motion="214",
              common=dict(name="Keepy-Uppy", clip="keepy", startup=10, active=1, recovery=18, damage=400,
                          hitstun=24, blockstun=16, hitstop=9, guard="HL", gain=500, nerve=1500, pb=(0.3, 0.3),
                          ball={"act": "hover"}, cancel=["super"], role=["antiair", "projectile"],
                          desc="Juggles the ball above him (1.2 / 1.8 / 2.4 m) for 2 s: an anti-air trap; POWER "
                               "SHOT then volleys it from there.",
                          why="Setplay tool (CONTRACT 5.3 ball: keepy-uppy hover): the hovering ball is a "
                              "stationary projectile hitbox (400) for 120 frames."),
              per={"l": dict(projectile=dict(hov, life=120, y=1.2)), "m": dict(projectile=dict(hov, life=120, y=1.8)),
                   "h": dict(projectile=dict(hov, life=120, y=2.4))},
              ex=dict(name="Keepy-Uppy (EX)", startup=8, damage=800, projectile=dict(hov, life=180, y=1.8, hits=2),
                      desc="3-second hover, 2 hits.", why="EX: 180 frames, 2 hits, 8f."))
    K.special("dive", None, motion="22",
              common=dict(name="Simulation", clip="dive_roll", damage=0, hitstun=0, blockstun=0, hitstop=0, gain=0,
                          nerve=0, pb=(0.0, 0.0), guard="HL", cancel=["whiff", "special"], startup=2, active=24,
                          role=["lowprofile", "approach"], linear=True,
                          why3d="a dive-roll along its frame-1 line: linear",
                          desc="A theatrical forward dive-roll under projectiles and high attacks.",
                          why="Approach trick: low profile (0.6 m) and projectile-invulnerable 3-24, travel "
                              "1.2/1.6/2.0 m, 14/16/18 recovery (punishable on reaction)."),
              per={s: dict(recovery=r, move=[[0, 0], [24, mv]], invuln={"proj": [3, 24]},
                           hurtOverride=[{"f": [3, 24], "w": 0.9, "h": 0.6}])
                   for s, r, mv in (("l", 14, 1.2), ("m", 16, 1.6), ("h", 18, 2.0))},
              ex=dict(name="Simulation (EX)", startup=1, recovery=10, move=[[0, 0], [24, 1.8]],
                      invuln={"strike": [1, 20], "proj": [1, 24]}, hurtOverride=[{"f": [1, 24], "w": 0.9, "h": 0.6}],
                      desc="Strike-invulnerable dive.", why="EX: strike invulnerable 1-20."))

    K.add("top_bins", LV1, kind="super1", input="236236", name="Top Bins", strength="H", clip="shot_kick",
          startup=9, active=1, recovery=45, hitstun=69, blockstun=25, hitstop=9, kd="soft", ball={"act": "summon"},
          invuln={"strike": [1, 11], "throw": [1, 11]}, cost={"showtime": LV1_COST}, gain=0, nerve=600,
          projectile={"speed": 8.0, "life": 120, "box": [0.6, 0.6], "y": 1.0, "hits": 5, "strength": "H",
                      "clip": "fireball_football", "x": 0.8},
          role=["projectile", "reversal"], sfx=[[0, "crowd_cheer_burst"]], aimed=True,
          why3d="the flaming shot is AIMED on the kick",
          desc="Flicks up a fresh ball and smashes a 5-hit flaming shot; invulnerable startup.",
          why="Setplay Lv1 = projectile super (always summons a ball): 5 x 400, invulnerable 1-11, knocks down "
              "(KD +23 point blank).")
    K.add("hat_trick", LV3, kind="super3", input="214214", name="Hat Trick", strength="H", clip="volley",
          invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]}, ball={"act": "summon"},
          move=[[0, 0], [10, 0.8]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic=lambda: cinematic(
              165, "gazza_hat_trick",
              hits=[[10, 600], [40, 800], [70, 900], [128, 2200]],
              anim=[K.seg(0, "volley", 30, hit=10), K.seg(30, "shot_kick", 60, hit=40), K.seg(60, "header", 90, hit=70),
                    K.seg(90, "taunt_keepy", 112, fromS=0.2), K.seg(112, "bicycle_toss", 148, hit=128),
                    K.seg(148, "win_point", 165, fromS=0.5)],
              victim=[[0, "hit_body", 0.0, 0.4], [10, "hit_body", 0.0, 0.5], [40, "hit_high_l", 0.0, 0.5],
                      [70, "hit_high_s", 0.0, 0.5], [90, "dizzy", 0.3, 0.9], [128, "thrown_f", 0.3, 0.74],
                      [140, "thrown_f", 0.74, 1.3333]],
              camera=[cam(0, 30, "close", "both", 32, 2.6, 1.3, 15),
                      cam(30, 60, "low", "both", 38, 2.8, 0.4, -20, lookH=1.1),
                      cam(60, 90, "close", "defender", [32, 28], [2.1, 1.7], 1.6, 35),
                      cam(90, 112, "wide", "both", 38, 4.8, 1.6, 0),
                      cam(112, 140, "low", "attacker", 44, 3.2, 0.3, 25, lookH=1.5),
                      cam(140, 165, "wide", "both", 38, 6.0, 1.8, 0, lookH=1.1)],
              fx=[(0, "slate"), (10, "impact_m"), (30, "ball_trail", "attacker"), (40, "impact_m"), (40, "ball_trail"),
                  (70, "impact_m"), (70, "shake_s"), (112, "speed_lines"), (128, "impact_l"), (128, "ball_trail"),
                  (128, "flash"), (128, "shake_l"), (128, "freeze_frame"), (140, "dust"), (148, "confetti")],
              crowd=[(10, "ooh"), (40, "ooh"), (70, "cheer"), (90, "chant", "up"), (128, "roar", "spike"),
                     (148, "cheer", "peak")],
              pathA=[[10, 0.1, 0], [40, 0.2, 0], [70, 0.35, 0], [112, 0.3, 0], [148, 0.3, 0], [163, 0, 0]],
              gapD=[[10, 1.0, 0], [40, 1.2, 0], [70, 1.1, 0], [90, 1.2, 0], [128, 1.1, 0.4], [136, 2.4, 0.3],
                    [142, 3.0, 0], [163, 3.0, 0]],
              slate="PRIME TIME - GAZZA: HAT TRICK", endPose="back", endAdv=19, endGapM=3.0),
          desc="PRIME TIME: point-blank volley, a shot to the chest, a header, and the bicycle-kick finale.",
          why="1c Lv3: 10/4/58, -42, 4500, fully invulnerable 1-13.")

    K.simple = {"5S": "power_shot_m", "6S": "dive_m", "2S": "bicycle_m", "4S": "keepy_m", "S+H": "top_bins",
                "S+H+2": "hat_trick", "assist": ["5L", "5M", "5H", "power_shot_m"]}
    K.classic = [{"motion": "236", "btn": "LMH", "move": "power_shot_{s}"},
                 {"motion": "623", "btn": "LMH", "move": "bicycle_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "keepy_{s}"},
                 {"motion": "22", "btn": "LMH", "move": "dive_{s}"}]
    K.unique = {"kind": "ball", "respawnF": 180, "restF": 240, "pickupM": 0.4,
                "hover": {"l": 1.2, "m": 1.8, "h": 2.4, "frames": 120}, "bounces": 1}
    K.cine_doc = [
        "f0 VOLLEY (close): point-blank into the gut - 600 at f10.",
        "f30 SHOT (low, ball trail): a fresh ball to the chest - 800 at f40. f60 HEADER (punch-in) - 900 at f70.",
        "f90 KEEPY-UPPY (wide): he juggles over the dazed opponent while the crowd counts.",
        "f112 BICYCLE KICK (low, looking up): the real overhead kick - 2200 at f128 (ball trail, flash, "
        "freeze-frame); they fly 1.9 m and land face up.",
        "f148 POINTING (wide, confetti): 'GOAL!' Opponent face up at 3.0 m (KD +19).",
    ]
    K.text = dict(
        introLine="Brought me own ball. Ref's not coming. Kick-off.",
        winQuotes=["GOAL! And he's gone down like a sack of match programmes.",
                   "Top bins. Back of the net. Back of your head.",
                   "Man of the match. Again. Somebody fetch the trophy."],
        banter={"zambini": ["It was ONE dove, mate, and it was offside.",
                            "Pull a rabbit out of that hat. Go on. I'll volley it."],
                "freak": ["Big lad. Bet you can't head a ball, though.",
                          "I've played Sunday league, son. You're nothing."],
                "ricky": ["Banned from every ground in the county, and you still booked me.",
                          "Blow the whistle, Ricky. Final whistle."],
                "default": ["Mind your ankles. I won't.",
                            "Two-footed? Me? Never."]},
        ending="GAZZA knocks the host clean off his own set with a bicycle kick and celebrates with his hoodie over his "
               "head for eleven minutes. He spends the prize money on a pitch behind the Rust Theater with real "
               "floodlights and a real referee. He argues with that referee every Sunday. He has never been happier.")
    return K
