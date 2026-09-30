"""PATCH - rushdown kickboxer (CMU kicks + Muay Thai knees, the two AUTHORED crouch kicks)."""
from kitlib import (Kit, air, authored, cam, cinematic, cmu, mix, seq, LV1, LV3, LV1_COST, LV3_COST)


def build():
    K = Kit(
        id="patch", name="PATCH", persona="The Floor Manager", archetype="rushdown",
        body="Eve By J.Gonzales", heightM=1.72, hp=9500, build="slim",
        walk=(2.28, 1.49), dash=(1.43, 0.84, 17, 22), jump=(4, 36, 3, 1.50, 1.55), throwRangeM=0.60,
        colors=[("Floor Manager", None), ("Red Light", "#c8102e"), ("Gaffer Tape", "#2b2b2b"),
                ("Cue Card", "#f2e8c9")],
        intro="intro_point", win=["win_dismiss", "win_high_kick"], taunt="taunt_hype", rival="spin",
        stage="rooftop",
        cpu={"style": "rushdown", "rangeM": [0.8, 1.8], "approach": ["cue_m", "stage_dive_m", "slide_m"],
             "pokes": ["5M", "2M"], "antiAir": ["spotlight_l", "j.M"], "punish": ["5H", "cue_h"],
             "combo": ["2L", "2L", "cue_l"], "meter": "highlight_reel", "antiStep": ["2M", "5H"],
             "stepAttack": "SS.H"},
        doc=dict(
            difficulty=2, packs="CMU kicks/knees + 2 AUTHORED crouch kicks",
            look="Eve: high bun, eyepatch, black leather jacket with gold piping and a red collar, belted shorts, "
                 "thigh boots.",
            bio="Ran the HIT PARADE studio floor for six seasons: cue cards, cables, and the fights that broke "
                "out when the cameras stopped. The network finally put her on camera - one eye, no patience, "
                "and a count of three that nobody survives.",
            plan="Pressure. The fastest walk and dash in the cast close any gap, the CUE KICK rekka turns every "
                 "confirm into a three-part guess (overhead CUE 3 on 236, low CUE 3 on 214), STAGE DIVE hops "
                 "over lows as a +1 overhead, and SLIDE runs under projectiles.",
            weakness="Lowest HP (9500), no projectile, meterless SPOTLIGHT has no invulnerability (EX only); "
                     "every rekka gap can be interrupted and CUE 3 low is -13 on block.",
            rivalry="Spin crashed her live cue with a headspin on the rooftop set. She counts him down every "
                    "time.",
            # CHANGED(FIGHTERS3D): 3D ring play (CONTRACT 35.12)
            ring=dict(
                stepping="Her approach specials are LINEAR - CUE KICK L/M/H, STAGE DIVE, FLOOR SLIDE and the 6M step "
                         "knee commit to their frame-1 line, and 4H BACK KICK is a straight thrust - so a read sidestep "
                         "beats a raw approach; she hides them behind confirms and the fastest dash in the cast. Her own "
                         "step is a weapon: BLINDSIDE KICK (STEP + H, out of a sidestep from frame 11 or a circle-walk) "
                         "is a homing turning kick into the flank that knocks down and wall-splats, the punish for a "
                         "stepped linear move.",
                homing="2M SHIN KICK (8f homing low roundhouse, 0.40 m deep) is the anti-step poke and cancels into the "
                       "rekka; 5H HEAD KICK homes (12f, -3). CUE 2 homes, so stepping the gap after a blocked CUE 1 gets "
                       "caught; CUE 3 low homes, CUE 3 overhead does not (a step beats the overhead ender). 2H leg kick "
                       "is a homing sweep; HIGHLIGHT REEL and ON AIR home.",
                wall="4H BACK KICK and BLINDSIDE KICK wall-splat; at the ring edge the CUE 3 overhead / low guess is her "
                     "damage and a stepper runs into the boundary."),
        ),
    )

    # ---------------- clips ----------------
    K.clip("jab", cmu("jab.3", mirror=True), "CMU jab.3 clean (14_03 southpaw 6.6 m/s, mirrored)")
    K.clip("toe_kick", authored("crouch_toe_kick"), "AUTHORED crouch toe kick (CMU has no crouch kick class)")
    K.clip("shin_kick", authored("crouch_shin_kick"), "AUTHORED crouch low roundhouse")
    K.clip("teep", cmu("front_kick.4", rng=(3480, 3579)),
           "CMU front_kick.4 clean (86_06 push kick 0.97 m); start trimmed to 29 frames before contact")
    K.clip("roundhouse_hi", cmu("roundhouse.1", rng=(88, 173)),
           "CMU roundhouse.1 clean (135_07 head-high 1.38 m; pilot p08); 30-frame windup")
    K.clip("leg_kick", cmu("roundhouse.5", rng=(1410, 1508)),
           "CMU roundhouse.5 usable (144_05: mid-low turning kick, foot 0.57 m) = Muay Thai leg kick")
    K.clip("side_kick_back", cmu("side_kick.1", rng=(585, 682)),
           "CMU side_kick.1 clean (135_11 yoko-geri 1.31 m; pilot p14) = long back kick")
    K.clip("step_knee", cmu("knee.3", rng=(6740, 6882)), "CMU knee.3 clean (86_06 clinch knee, hands in the plum)")
    K.clip("air_jab", air(cmu("jab.3", mirror=True)), "jump apex legs + CMU jab.3")
    K.clip("flying_side", cmu("side_kick.2"), "CMU side_kick.2 clean (135_11 left yoko-geri) played airborne")
    K.clip("jump_kick", cmu("jump_kick.2"),
           "CMU jump_kick.2 usable (90_06 airborne turning kick, foot 1.65 m) - a real airborne kick")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9),
           "Mixamo goalkeeper catch (2) two-hand grab (throw whiff)")
    K.clip("clinch_knee", dict(cmu("knee.1", kind="knee", limb="R_knee"), effector="RightKnee"),
           "CMU knee.1 clean (86_06: hands grab and pull down, knee to the chest; pilot p09). Effector RightKnee: the builder measured the right FOOT (lane ASSETS flag). P2: kind knee / limb R_knee (was the catalog's foot / R_foot): the CMU facing is aimed from the KNEE, the striking point of a clinch knee")
    K.clip("spin_toss", cmu("roundhouse.3", rng=(735, 828)),
           "CMU roundhouse.3 clean (135_07 R head kick, 104 deg turn): swings them past, turning kick")
    K.clip("cue_kick", cmu("front_kick.1", rng=(330, 428)),
           "CMU front_kick.1 clean (144_05 guard stance 1.05 m, returns to stance; pilot p07)")
    K.clip("cue_round", cmu("roundhouse.2", rng=(412, 502)), "CMU roundhouse.2 clean (135_07 LEFT head kick)")
    K.clip("cue_drop", cmu("jump_kick.3"), "CMU jump_kick.3 usable (90_07 airborne turning kick) = CUE 3 overhead")
    K.clip("flying_knee", cmu("knee.2", rng=(6495, 6627)), "CMU knee.2 clean (86_06 knee) played on a hop")
    K.clip("flip_kick", cmu("front_kick.5", rng=(950, 1087)),
           "CMU front_kick.5 clean (113_13 high snap kick 1.29 m) played rising = flip-kick anti-air")
    K.clip("slide", dict(mix("Soccer_Game_Pack/soccer tackle", (12, 60), contact=24), effector="LeftFoot"),
           "P2: Mixamo soccer tackle f12-60, FEET-FIRST: the lead (left) foot skims in low at f24 (Gazza's bake of the "
           "same source: LeftFoot 0.82 m forward, 0.27 m up at output f13) = a low slide that hits the shins. Was soccer "
           "tackle (2), a HEAD-first dive: at its contact she sat on the floor with the effector on her raised hand "
           "(QC game frames), so the low was a hand swipe")
    K.clip("reel_kicks",
           seq(cmu("front_kick.3", rng=(890, 960)), cmu("roundhouse.4", rng=(3730, 3807)),
               cmu("jump_kick.1", rng=(262, 333)), xf=2),
           "SEQ of three CMU kicks: front kick (144_06), turning kick (135_01), jump turning kick (90_05)")
    K.clip("intro_point", mix("Gestures_Pack_Basic/angry gesture", (1, 66)), "Mixamo angry gesture (points)")
    K.clip("win_dismiss", mix("Gestures_Pack_Basic/look away gesture", (1, 55)), "Mixamo look away gesture")
    K.clip("win_high_kick", cmu(take="144_09", rng=(2182, 2323), contact=2229, kind="foot", limb="L_foot"),
           "CMU front_kick 144_09 2182/2229/2323 (clean, left 1.28 m): victory high kick")
    K.clip("taunt_hype", mix("Pro_Magic_Pack/Standing 2H Cast Spell 01", (1, 66)), "Mixamo arms-up hype")

    # ---------------- normals ----------------
    lc = ["chain:5L", "chain:2L", "special", "super"]
    K.add("5L", "L", name="Lead Jab", clip="jab", cancel=lc, role=["poke"], sfx=[[3, "whoosh_light"]],
          desc="Jab; chains into 2L.")
    K.add("2L", "2L", name="Toe Kick", clip="toe_kick", cancel=lc, role=["poke", "low"],
          desc="Crouching toe kick (low).")
    K.add("5M", "M", name="Teep", clip="teep", pb=(0.35, 0.55), cancel=["special", "super"], role=["poke"],
          sfx=[[5, "whoosh_light"]], desc="Push kick; long reach, pushes blockers out.")
    K.add("2M", "2M", name="Shin Kick", clip="shin_kick", cancel=["special", "super"], role=["poke", "low", "antistep"],
          homing=True, lateralM=0.40,
          why3d="low roundhouse (authored: the leg whips round at shin height): homing anti-step poke; 0.40 m deep, not the "
                "0.60 of a full spin (an 8f -2 low must stay answerable)",
          desc="Crouching low roundhouse; homing (catches a sidestep); cancel into the CUE KICK rekka.")
    K.add("5H", "H", name="Head Kick", clip="roundhouse_hi", cancel=["special", "super"], sfx=[[8, "whoosh_heavy"]],
          homing=True, why3d="head-high roundhouse (CMU roundhouse.1): homing, her safe tool vs a stepper",
          desc="Head-high roundhouse; homing.")
    K.add("2H", "SWEEP", name="Leg Kick", clip="leg_kick", startup=11,
          hurtOverride=[{"f": [1, 37], "w": 0.46, "h": 1.63}], role=["sweep", "low"], sfx=[[7, "whoosh_heavy"]],
          desc="Standing Muay Thai leg kick that knocks down; long, but she stands tall.",
          why="Kickboxer sweep is a STANDING leg kick (no low profile: hurtOverride = stand box) - a readable "
              "trade for its reach; startup 10->11 for the full turning kick.")
    K.add("6M", "CMD", input="6M", kind="command", name="Step Knee", clip="step_knee", startup=14, recovery=17,
          hitstun=22, blockstun=16, damage=700, move=[[0, 0], [14, 0.5]], role=["approach"],
          linear=True, why3d="stepping straight knee: commits to its line (a sidestep beats it)",
          desc="Stepping knee: +2 on hit, -4 on block, travels 0.5 m.",
          why="Rushdown approach normal: 0.5 m step, 14/3/17 (+2/-4), 700.")
    K.add("4H", "CMD", input="4H", kind="command", name="Back Kick", clip="side_kick_back", pb=(0.60, 0.60),
          linear=True, wallSplat=True,
          why3d="the spin only chambers it: the strike is a straight back-kick thrust (CMU side_kick.1), LINEAR - her "
                "longest button, beaten by a read step; wall-splats a cornered opponent (the 0.60 m pushback carries)",
          desc="Long spinning back kick; her furthest button (+2/-3); wall-splats at the ring edge.")
    # CHANGED(FIGHTERS3D): step-attack (CONTRACT 35.12 item 5) - reuses the spin_toss clip (CMU roundhouse.3, already in the
    # GLB as the back-throw clip): no new clip, no re-bake
    K.add("SS.H", "CMD", input="SS.H", kind="command", name="Blindside Kick", clip="spin_toss", startup=13,
          recovery=18, damage=900, hitstun=51, blockstun=19, pb=(0.0, 0.50), kd="soft", wallSplat=True,
          cancel=["super"], role=["stepatk"], homing=True, sfx=[[7, "whoosh_heavy"]],
          why="STEP-ATTACK: H out of a sidestep (from step frame 11) or a circle-walk. 13/3/18 (the CMD 16/3/20 minus the "
              "frames the step already spent), 900, KD +30 and wall splat on hit, -2 on block: the reward for stepping a "
              "linear move.",
          why3d="homing turning kick into the flank (CMU roundhouse.3, 104 deg turn); wall-splats at the ring",
          desc="STEP + H: turning kick into the flank out of a sidestep; knocks down, wall-splats, -2 on block.")
    K.add("j.L", "jL", input="j.L", name="Air Jab", clip="air_jab", desc="Air jab.")
    K.add("j.M", "jM", input="j.M", name="Flying Side Kick", clip="flying_side", role=["antiair"],
          desc="Air-to-air side kick.")
    K.add("j.H", "jH", input="j.H", name="Jump Turning Kick", clip="jump_kick", desc="Big turning jump-in.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Plum Knees", clip="throw_reach",
          grab={"frames": 46, "adv": 21, "hitF": 16, "swap": False, "air": False, "techable": True,
                "clip": "clinch_knee",
                # P2 paired throw: the plum pulls the head down (lock 0-16), the knee lands at clip 0.45 s = lock 16
                # (1.27 s over 46 f); the victim folds on it, stays doubled while the knee is held up (16-34) and drops
                # back when she lets go (kd_fall_b 1.04 -> 1.5 s, face up).
                "victim": [[0, "hit_high_s", 0.0, 0.3], [16, "hit_body", 0.15, 0.8], [34, "kd_fall_b", 1.04, 1.5]]},
          desc="Muay Thai clinch, knee to the chest.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Spin Toss", clip="throw_reach",
          grab={"frames": 48, "adv": 14, "hitF": 19, "swap": True, "air": False, "techable": True,
                "clip": "spin_toss",
                # P2 paired throw: the turning head kick lands at clip 0.31 s = lock 19 (0.80 s over 48 f); the victim is
                # swung past (thrown_b 0.05 -> 0.40 s) and the kick sends them face down behind her.
                "victim": [[0, "hit_high_s", 0.0, 0.25], [10, "thrown_b", 0.05, 0.4], [19, "thrown_b", 0.4, 1.2]]},
          desc="Spins and flings them behind.")

    # ---------------- specials ----------------
    K.special("cue", None, motion="236",
              common=dict(name="Cue Kick", clip="cue_kick", active=3, hitstun=22, blockstun=16, hitstop=13,
                          guard="HL", gain=700, nerve=3000, pb=(0.25, 0.30), cancel=["chain:cue2", "super"],
                          role=["approach"], sfx=[[2, "whoosh_light"]],
                          desc="Rekka part 1: stepping front kick; 236 again for CUE 2.",
                          why="Rekka opener (FIGHTING_DESIGN 8c rushdown): rush-class startups 10/12/14 but "
                              "no knockdown: +1/-1/-3 on hit, -5/-7/-9 on block, always cancelable into CUE 2."),
              per={"l": dict(startup=10, recovery=18, damage=700, move=[[0, 0], [10, 0.6]], linear=True,
                             why3d="stepping front-kick rush: linear"),
                   "m": dict(startup=12, recovery=20, damage=750, move=[[0, 0], [12, 0.9]], linear=True,
                             why3d="stepping front-kick rush: linear"),
                   "h": dict(startup=14, recovery=22, damage=800, move=[[0, 0], [14, 1.2]], linear=True,
                             why3d="stepping front-kick rush: linear")},
              ex=dict(name="Cue Kick (EX)", startup=9, recovery=16, blockstun=17, damage=1000,
                      why3d="OD: not linear - re-aims until frame 3 (special default)",
                      armor={"hits": 1, "f": [1, 8]}, move=[[0, 0], [9, 1.2]],
                      desc="Armored, -2 on block.", why="EX: 1 hit of armor through startup, -2 on block."))
    K.add("cue2", None, kind="special", input="236>236", name="Cue 2: Head Snap", strength="M", tc=True,
          trigger={"classic": {"motion": "236", "btn": "LMH"}, "simple": "5S"}, clip="cue_round",
          startup=9, active=3, recovery=20, hitstun=24, blockstun=16, damage=700, hitstop=13, guard="HL",
          gain=700, nerve=3000, pb=(0.25, 0.35), move=[[0, 0], [9, 0.4]],
          cancel=["chain:cue3_oh", "chain:cue3_lo", "super"], sfx=[[3, "whoosh_heavy"]],
          homing=True, why3d="round head kick (CMU roundhouse.2): homes, so stepping the gap after a blocked CUE 1 is caught",
          desc="Rekka part 2: left head kick (+1/-7); homing; 236 = CUE 3 overhead, 214 = CUE 3 low.",
          why="Rekka part 2: 9/3/20, +1 on hit so CUE 3 combos, -7 on block (the gap to interrupt).")
    K.add("cue3_oh", None, kind="special", input="236>236>236", name="Cue 3: Curtain Drop", strength="H", tc=True,
          trigger={"classic": {"motion": "236", "btn": "LMH"}, "simple": "5S"}, clip="cue_drop",
          startup=18, active=4, recovery=18, hitstun=50, blockstun=18, damage=1000, hitstop=15, guard="H",
          gain=1000, nerve=4000, pb=(0.0, 0.40), kd="soft", move=[[0, 0], [18, 0.6]],
          moveY=[[0, 0], [8, 0.5], [18, 0.3], [22, 0.0]], role=["overhead"], sfx=[[10, "whoosh_heavy"]],
          desc="Rekka finisher: jumping overhead kick, knocks down, -4 on block.",
          why="Overhead finisher: 18f (reactable per FIGHTING_DESIGN 12), KD +28, -4.")
    K.add("cue3_lo", None, kind="special", input="236>236>214", name="Cue 3: Trapdoor", strength="H", tc=True,
          trigger={"classic": {"motion": "214", "btn": "LMH"}, "simple": "2S"}, clip="leg_kick",
          startup=12, active=3, recovery=26, hitstun=59, blockstun=16, damage=900, hitstop=15, guard="L",
          gain=1000, nerve=4000, pb=(0.0, 0.45), kd="soft", role=["low"], sfx=[[7, "whoosh_heavy"]],
          homing=True, lateralM=0.40,
          why3d="turning leg kick: homes (0.40 m, a low roundhouse) - the overhead ender does not, so a step after CUE 2 "
                "beats only the overhead",
          desc="Rekka finisher: low leg kick, knocks down, -13 on block.",
          why="Low finisher: faster than the overhead (12f) but -13 on block, KD +30.")
    K.special("stage_dive", None, motion="214",
              common=dict(name="Stage Dive", clip="flying_knee", active=3, hitstun=21, blockstun=18, hitstop=13,
                          guard="H", gain=800, nerve=4000, pb=(0.30, 0.35), cancel=["super"],
                          role=["overhead", "approach"], sfx=[[4, "whoosh_heavy"]], linear=True,
                          why3d="a 1-2 m hop along its frame-1 line: linear (a read step makes it sail past)",
                          desc="Hopping flying knee: an overhead that hops over lows.",
                          why="FIGHTING_DESIGN 8c STAGE DIVE (overhead hop 20f, +1): +4/+1 L, +3/0 M, +2/-1 H."),
              per={"l": dict(startup=20, recovery=14, damage=700, move=[[0, 0], [20, 1.0]],
                             moveY=[[0, 0], [4, 0.1], [12, 0.8], [23, 0.0]]),
                   "m": dict(startup=22, recovery=15, damage=800, move=[[0, 0], [22, 1.5]],
                             moveY=[[0, 0], [4, 0.1], [13, 1.0], [25, 0.0]]),
                   "h": dict(startup=24, recovery=16, damage=900, move=[[0, 0], [24, 2.0]],
                             moveY=[[0, 0], [4, 0.1], [14, 1.2], [27, 0.0]])},
              ex=dict(name="Stage Dive (EX)", startup=18, active=8, recovery=12, damage=1100, blockstun=20,
                      move=[[0, 0], [18, 1.6]], moveY=[[0, 0], [4, 0.1], [11, 1.0], [26, 0.0]],
                      hits=[{"f": [18, 19], "damage": 500, "hitstop": 11}, {"f": [24, 25], "damage": 600,
                                                                           "hitstop": 13}],
                      desc="Two-hit dive, +2 on block.", why="EX: faster (18f), 2 hits, +2 on block."))
    K.special("spotlight", None, motion="623",
              common=dict(name="Spotlight", clip="flip_kick", active=6, blockstun=20, hitstop=15, guard="HL",
                          gain=800, nerve=4000, pb=(0.0, 0.45), kd="soft", launch=[1.0, 5.0],
                          juggle={"js": 1, "ji": 1, "jl": 4}, cancel=["super"], role=["antiair"],
                          sfx=[[2, "whoosh_heavy"]],
                          desc="Rising flip kick. NOT invulnerable (trades); the EX is.",
                          why="FIGHTING_DESIGN 8c 'flip kick DP-lite (7f, not invulnerable; EX invulnerable)': "
                              "7/8/9 startup, -16/-20/-24 on block."),
              per={"l": dict(startup=7, recovery=30, damage=900, hitstun=70,
                             moveY=[[0, 0], [7, 0.2], [12, 0.9], [20, 0.8], [40, 0.0]]),
                   "m": dict(startup=8, recovery=34, damage=1000, hitstun=75,
                             moveY=[[0, 0], [8, 0.3], [14, 1.2], [22, 1.1], [45, 0.0]]),
                   "h": dict(startup=9, recovery=38, damage=1100, hitstun=80,
                             moveY=[[0, 0], [9, 0.3], [16, 1.5], [25, 1.4], [50, 0.0]])},
              ex=dict(name="Spotlight (EX)", startup=7, recovery=36, damage=1300, hitstun=78,
                      invuln={"strike": [1, 9], "throw": [1, 9], "air": [1, 9], "proj": [1, 9]},
                      moveY=[[0, 0], [7, 0.3], [14, 1.4], [23, 1.3], [48, 0.0]],
                      desc="Fully invulnerable flip kick.", role=["antiair", "reversal"],
                      why="EX: fully invulnerable 1-9 (her only reversal)."))
    K.special("slide", None, motion="22",
              common=dict(name="Floor Slide", clip="slide", active=8, blockstun=18, hitstop=13, guard="L",
                          gain=800, nerve=3000, pb=(0.0, 0.40), kd="soft", cancel=["super"],
                          role=["low", "lowprofile", "approach"], sfx=[[3, "whoosh_light"]], linear=True,
                          why3d="a feet-first floor slide cannot turn: linear",
                          desc="Low-profile slide under projectiles; low, knocks down.",
                          why="Anti-zoning tool: low profile from frame 4 (0.45 m tall), -10/-12/-14 on block."),
              per={"l": dict(startup=12, recovery=20, damage=800, hitstun=58, move=[[0, 0], [20, 1.5]],
                             hurtOverride=[{"f": [4, 20], "w": 0.9, "h": 0.45}]),
                   "m": dict(startup=14, recovery=22, damage=900, hitstun=60, move=[[0, 0], [22, 2.0]],
                             hurtOverride=[{"f": [4, 22], "w": 0.9, "h": 0.45}]),
                   "h": dict(startup=16, recovery=24, damage=1000, hitstun=62, move=[[0, 0], [24, 2.5]],
                             hurtOverride=[{"f": [4, 24], "w": 0.9, "h": 0.45}])},
              ex=dict(name="Floor Slide (EX)", startup=10, recovery=16, damage=1200, hitstun=54,
                      invuln={"proj": [1, 24]}, move=[[0, 0], [18, 2.5]],
                      hurtOverride=[{"f": [3, 18], "w": 0.9, "h": 0.45}],
                      desc="Projectile-invulnerable slide, -6 on block.",
                      why="EX: projectile-invulnerable 1-24 and -6 on block."))

    # ---------------- supers ----------------
    K.add("highlight_reel", LV1, kind="super1", input="236236", name="Highlight Reel", strength="H",
          clip="reel_kicks", active=26, recovery=51, hitstun=78,
          hits=[{"f": [8, 9], "damage": 500, "hitstop": 9}, {"f": [19, 20], "damage": 600, "hitstop": 9},
                {"f": [30, 33], "damage": 900, "hitstop": 20}],
          warp="auto",
          invuln={"strike": [1, 10], "throw": [1, 10]}, move=[[0, 0], [8, 0.5], [19, 1.1], [30, 1.6]],
          moveY=[[0, 0], [24, 0.0], [30, 0.3], [38, 0.0]], kd="soft", juggle={"js": 1, "ji": 0, "jl": 99},
          boxes=[{"f": [8, 9], "x": 0.75, "y": 1.4225, "w": 0.50, "h": 0.645},
                 {"f": [19, 20], "x": 0.79, "y": 1.10, "w": 0.54, "h": 0.35},
                 {"f": [30, 33], "x": 0.72, "y": 1.0625, "w": 0.50, "h": 0.525}],
          cost={"showtime": LV1_COST}, gain=0, nerve=600, role=["reversal"], sfx=[[1, "crowd_cheer_burst"]],
          desc="Invulnerable three-kick flurry ending in a jump kick.",
          why="1c Lv1: invulnerable 1-10, 3 hits (9/9/20 hitstop), recovery 51 -> -30 on block, KD +23. Hand-set per-hit boxes (2026-09-30) at each kick's strike point from the bake trace (right foot 0.75/1.57 m, right foot ~0.81/1.10 m, left foot ~0.72/1.15 m), each reaching the 1.10 m crouch line; jump-kick hop 0.6 -> 0.3 m. Before: SIM derived all three boxes at the first kick's point, so the hopping third kick sat at 1.99-2.34 m and the super dropped its finisher (sim: 2/3 hits standing, 0/3 crouching).")
    K.add("on_air", LV3, kind="super3", input="214214", name="On Air", strength="H", clip="teep",
          invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 0.8]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic=lambda: cinematic(
              160, "patch_on_air",
              hits=[[10, 400], [35, 500], [60, 600], [85, 700], [110, 900], [135, 1400]],
              anim=[K.seg(0, "clinch_knee", 28, hit=10), K.seg(28, "cue_round", 52, hit=35),
                    K.seg(52, "roundhouse_hi", 78, hit=60), K.seg(78, "flying_knee", 102, hit=85),
                    K.seg(102, "jump_kick", 126, hit=110), K.seg(126, "cue_drop", 146, hit=135),
                    K.seg(146, "win_high_kick", 160, fromS=0.2)],
              victim=[[0, "hit_body", 0.0, 0.3], [10, "hit_body", 0.0, 0.4], [35, "hit_high_l", 0.0, 0.4],
                      [60, "hit_high_l", 0.1, 0.45], [85, "hit_air", 0.0, 0.4], [110, "hit_air", 0.3, 0.8],
                      [135, "kd_fall_b", 1.25, 1.8667], [148, "kd_ground_b", 0.0, 0.367]],
              camera=[cam(0, 28, "low", "both", 38, 2.6, 0.5, 18, lookH=1.2),
                      cam(28, 52, "close", "defender", 30, 2.0, 1.55, 40),
                      cam(52, 78, "close", "both", [34, 30], [2.4, 2.0], 1.6, -30),
                      cam(78, 102, "low", "defender", 42, 3.0, 0.3, 25, lookH=1.8),
                      cam(102, 126, "orbit", "both", 40, 3.4, 2.0, [30, -40], lookH=1.8, ease="linear"),
                      cam(126, 146, "top", "defender", 40, 1.3, 5.2, 8, lookH=0.5),
                      cam(146, 160, "wide", "both", 38, 5.5, 1.7, 0)],
              fx=[(0, "slate"), (10, "impact_m"), (35, "impact_s"), (60, "impact_m"), (60, "smear", "attacker"),
                  (85, "impact_m"), (85, "shake_s"), (102, "speed_lines"), (110, "impact_m"), (135, "impact_l"),
                  (135, "flash"), (135, "shake_l"), (135, "dust"), (135, "freeze_frame"), (146, "spot", "attacker"),
                  (158, "spot_off")],
              crowd=[(10, "ooh"), (35, "ooh"), (60, "gasp"), (85, "cheer", "up"), (110, "roar", "up"),
                     (135, "roar", "spike"), (146, "chant", "peak")],
              pathA=[[10, 0.1, 0], [35, 0.25, 0], [60, 0.4, 0], [85, 0.5, 0.35], [95, 0.55, 0], [110, 0.7, 0.9],
                     [120, 0.8, 0.9], [135, 0.9, 0.2], [140, 0.9, 0], [158, 0, 0]],
              gapD=[[10, 0.8, 0], [35, 0.9, 0], [60, 1.0, 0], [85, 0.9, 0.3], [100, 1.0, 1.0], [110, 0.9, 1.2],
                    [128, 0.9, 1.0], [136, 1.1, 0], [158, 2.0, 0]],
              slate="PRIME TIME - PATCH: ON AIR IN 3... 2... 1...", endPose="back", endAdv=19, endGapM=2.0),
          desc="PRIME TIME: a teep that starts a juggle she counts down live.",
          why="1c Lv3: 10/4/58, -42, 4500, fully invulnerable 1-13.")

    K.simple = {"5S": "cue_m", "6S": "stage_dive_m", "2S": "spotlight_m", "4S": "slide_m", "S+H": "highlight_reel",
                "S+H+2": "on_air", "assist": ["5L", "5M", "5H", "cue_m"]}
    K.classic = [{"motion": "236", "btn": "LMH", "move": "cue_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "stage_dive_{s}"},
                 {"motion": "623", "btn": "LMH", "move": "spotlight_{s}"},
                 {"motion": "22", "btn": "LMH", "move": "slide_{s}"}]
    K.unique = {"kind": "none",
                "trait": "RED LIGHT REKKA: CUE KICK chains into CUE 2, then CUE 3 overhead (236) or low (214). "
                         "Fastest walk (2.28 m/s) and longest dash (1.43 m); lowest HP (9500), no projectile."}
    K.cine_doc = [
        "f0 PLUM (low front): she clinches off the teep and knees the chest - 400 at f10.",
        "f28 HEAD SNAP (close on the defender) - 500 at f35. f52 HEAD KICK (close, over her side, smear) - 600 at f60.",
        "f78 FLYING KNEE (low, looking up): the hop launches them 1.0 m - 700 at f85.",
        "f102 JUMP TURNING KICK (orbit 30 -> -40 deg, both in the air) keeps them up - 900 at f110.",
        "f126 CURTAIN DROP (top-down): the axe kick slams them down - 1400 at f135 (flash, freeze-frame, dust).",
        "f146 HIGH KICK POSE (wide, spotlight): the crowd chants the count; opponent face up at 2.0 m (KD +19).",
    ]
    K.text = dict(
        introLine="Quiet on set. We're live in three... two...",
        winQuotes=["That's a wrap. Strike the set - and him.",
                   "You missed your cue. Nobody misses my cue.",
                   "Cut to commercial. Somebody mop the floor."],
        banter={"spin": ["You headspun through my live cue. That's a fine AND a firing.",
                         "Places, b-boy. I count three and you're off the air."],
                "freak": ["Specimen Thirteen, you're on in five. Hit your mark.",
                          "Everybody on this floor takes direction. Even the monster."],
                "ricky": ["Six seasons I ran your floor, Ricky. I know every blind spot.",
                          "Tonight the cameras keep rolling after the bell."],
                "default": ["You're blocking my shot. Move, or get moved.",
                            "Three... two... you're done."]},
        ending="PATCH takes the host's headset, counts the whole studio down from three and cuts the feed herself. For "
               "one Friday the slot plays static, and it pulls the best ratings in the network's history. By Monday "
               "she runs the building. The first new rule is taped to every door: nobody fights when the cameras stop.")
    return K
