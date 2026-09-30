"""JOHNNY RIOT - shoto boxer (CMU boxing takes)."""
from kitlib import (Kit, air, cam, cinematic, cmu, crouch, layer, mix, seq, LV1, LV3, LV1_COST, LV3_COST,
                    EX_NERVE)


def build():
    K = Kit(
        id="johnny", name="JOHNNY RIOT", persona="The Headliner", archetype="shoto",
        body="Ch42_nonPBR", heightM=1.80, hp=10000, build="average",
        walk=(2.12, 1.44), dash=(1.06, 0.68, 18, 23), jump=(4, 38, 3, 1.59, 1.43), throwRangeM=0.60,
        colors=[("Headliner", None), ("Encore", "#2a6bd6"), ("Blackout", "#1c1c1c"), ("Gold Record", "#d4a017")],
        intro="intro_shadowbox", win=["win_arms_up", "win_wave"], taunt="taunt_cocky",
        rival="boneyard", stage="rust_theater",
        cpu={"style": "balanced", "rangeM": [1.4, 2.6], "pokes": ["5M", "2M"], "antiAir": ["encore_l", "2H"],
             "punish": ["5H", "hook_h"], "combo": ["2L", "5M", "hook_m"], "zoning": ["brickbat_m"],
             "meter": "sold_out"},
        doc=dict(
            difficulty=1, packs="CMU boxing takes (jabs, crosses, hooks, uppercut, body blows, overhand)",
            look="Ch42: shaggy dark hair, tattoo sleeves, red grunge tee, denim shorts, white sneakers.",
            bio="Season 12 champion of HIT PARADE who signed KNOCKOUT 13's 'lifetime headliner' contract "
                "before reading it. Every Friday he fights for the poster slot, because the week he loses "
                "it, the network owns his band's name.",
            plan="All-rounder: BRICKBAT controls the mid range, ENCORE punishes jumps, HEADLINE HOOK ends "
                 "every light or medium confirm. The 4-frame jab is the fastest button in the cast and the "
                 "only light that links into itself.",
            weakness="No damage specialty: lower corner damage than Boneyard or Bruno; ENCORE is -23 to -39 "
                     "on block; BRICKBAT recovery (47 total) loses to a read jump.",
            rivalry="Boneyard carved Johnny's name off the Rust Theater marquee with a cleaver. Johnny wants "
                    "the sign back.",
        ),
    )

    # ---------------- clips ----------------
    K.clip("jab", cmu("jab.1", mirror=True),
           "CMU jab.1 clean (14_02 southpaw, mirrored = orthodox lead jab; pilot p01 rendered and checked)")
    K.clip("crouch_jab", crouch(cmu("jab.4", mirror=True)),
           "Crouch Idle legs + CMU jab.4 (clean southpaw jab, mirrored): a low jab to the knee")
    K.clip("cross", cmu("cross.1"), "CMU cross.1 clean (13_17, 7.6 m/s; pilot p03)")
    K.clip("low_body", crouch(cmu("body_blow.1")),
           "Crouch Idle legs + CMU body_blow.1 (14_03 dip + rear straight; pilot p06)")
    K.clip("haymaker", cmu("hook.1"), "CMU hook.1 clean (14_03 rear hook, arm swings wide then across; pilot p04)")
    K.clip("uppercut", cmu("uppercut.2", rng=(1559, 1595)),
           "CMU uppercut.2 usable (17_10 rear uppercut, fist rises 0.33 m to chin, 7.8 m/s - the fastest "
           "uppercut in the pool; no clean uppercut exists, CMU_CLIPS 4). P2: window ends at 1595 - the take throws a "
           "second, LEFT punch right after (bake trace: LeftHand 0.23 -> 0.68 m forward at output f10-15 = source "
           "1599-1619), which read as a phantom jab in the recovery")
    K.clip("low_blow", crouch(cmu("hook.3")),
           "Crouch Idle legs + CMU hook.3 (14_01 orthodox lead hook, elbow 95): a crouching hook to the knee")
    K.clip("overhand", cmu(take="113_13", rng=(614, 718), contact=662, kind="hand", limb="R_hand"),
           "CMU overhand (113_13 614/662/718, reviewed usable: downward-angled straight 4.8 m/s)")
    K.clip("air_jab", air(cmu("jab.2", mirror=True)), "jump apex legs + CMU jab.2 (13_18, mirrored; pilot p02)")
    K.clip("air_cross", air(cmu("cross.2")), "jump apex legs + CMU cross.2 (14_02 2808/2822/2893, 8.0 m/s)")
    K.clip("air_hammer", air(cmu("hammer_chop.1")),
           "jump apex legs + CMU hammer_chop.1 (86_06 diagonal downward chop 9.1 m/s)")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9),
           "Mixamo goalkeeper catch (2): low two-hand grab (throw whiff)")
    K.clip("body_burst", cmu(take="14_03", rng=(3225, 3310), contact=3245, kind="hand", limb="R_hand"),
           "CMU 14_03 3225-3310: three consecutive body blows (segments 3245/3265/3285) = clinch body shots")
    K.clip("hook_fling", cmu("hook.4"), "CMU hook.4 clean (14_01 wide left hook, arm swings out and across)")
    K.clip("brick_throw", mix("Soccer_Game_Pack/goalkeeper overhand throw", (36, 72), contact=48),
           "Mixamo goalkeeper overhand throw, release f48 (front pass). Range starts at the last plant step "
           "(the clip has a run-up; root motion is stripped so only a crow-hop step remains)")
    K.clip("encore_upper",
           layer(mix("Pro_Magic_Pack/Standing Jump", (15, 45)), cmu("uppercut.2", rng=(1559, 1595)), mode="sync",
                 why="jump legs (take-off to apex f28) time-scaled under the CMU rear uppercut"),
           "LAYERED: Pro_Magic Standing Jump f15-45 legs (sync) + CMU uppercut.2 arms (window 1559-1595: no phantom "
           "left punch in the recovery, see `uppercut`) = jumping uppercut")
    K.clip("run_hook",
           layer(mix("Pro_Magic_Pack/Standing Run Forward", (1, 23), loop=True),
                 cmu("hook.2", rng=(256, 350)), mode="loop",
                 why="running legs loop under the fastest CMU hook (11.7 m/s)"),
           "LAYERED: Pro_Magic Standing Run Forward legs (loop) + CMU hook.2 (79_08; tail extended to 350)")
    K.clip("weave_duck",
           layer(mix("Pro_Magic_Pack/Standing Idle To Crouch", (1, 22)),
                 dict(cmu(take="13_17", rng=(4168, 4216), contact=None, kind="getup", limb="body", fist=75),
                      face="guard"), mode="sync",
                 why="the shared `crouch` recipe (Idle To Crouch legs + the 13_17 boxing guard) as a quick duck"),
           "LAYERED (P2): Pro_Magic Standing Idle To Crouch f1-22 legs (sync) + CMU 13_17 boxing guard arms = a guarded "
           "duck. Was the CMU duck_counter.1 duck (17_10 2129-2166): bake trace RightHand -0.34 m BEHIND the hips at "
           "0.55 m, swinging to 0.53 m / 1.65 m by the end (the start of the counter hook) - hands flailing, no guard")
    K.clip("weave_counter_hook", cmu("duck_counter.1", rng=(2150, 2197), contact=2174, limb="R_hand"),
           "CMU duck_counter.1 second half: rising RIGHT hook. P2: limb R_hand + contact 2174 - the plan said L_hand "
           "(catalog) but the bake measured the right hand rising -0.37 -> 0.39 m forward / 0.76 -> 1.71 m up, highest "
           "and farthest forward at output f5-6 (source 2170-2174); the left hand stays back")
    K.clip("sold_out_flurry",
           seq(dict(cmu(take="14_02", rng=(1550, 1632), contact=1567, mirror=True, kind="hand", limb="L_hand"),
                    contacts=[1567, 1593, 1617]),
               cmu("uppercut.2", rng=(1559, 1595)),
               dict(cmu(take="13_17", rng=(4168, 4232), contact=None, kind="getup", limb="body", fist=75), face="guard"),
               xf=2,
               why="14_02 jab 1567 / cross 1593 / jab 1617 is one real combo in the take; + rear uppercut; + back to the "
                   "13_17 guard (the shared idle source) for the 52-frame recovery"),
           "SEQ: CMU 14_02 1550-1632 (jab-cross-jab, mirrored) + uppercut.2 (window 1559-1595, no phantom left punch) + "
           "CMU 13_17 4168-4232 boxing guard (P2: the recovery returns to guard instead of holding the uppercut 0.2x)")
    K.clip("intro_shadowbox", dict(cmu(take="14_01", rng=(3030, 3110), contact=3042, kind="hand", limb="R_hand"),
                                   contacts=[3042, 3066, 3094]),
           "CMU 14_01 3030-3110: shadow-boxing intro. P2: limb R_hand + punches 3042 (R) / 3066 (L) / 3094 (R) - the "
           "plan named the LEFT hand for 3043, but the bake trace shows the right hand out first (0.68 m forward at output "
           "f3), the left at f9 (0.65 m), the right again at f16 (0.79 m)")
    K.clip("win_arms_up", mix("Pro_Magic_Pack/Standing 2H Cast Spell 01", (1, 66)),
           "Mixamo 2H Cast Spell 01 = play-to-the-crowd arms-up pose (MIXAMO_CLIPS taunts)")
    K.clip("win_wave", mix("Pro_Sword_and_Shield_Pack/sword and shield power up", (1, 72)),
           "P2: Mixamo S&S power up = chest out, head back, roaring at the crowd (usable unarmed, MIXAMO_CLIPS rally "
           "flex). Was Male_Injured 'injured wave idle' = the research's BEG / tap-out plea: bake trace both hands at "
           "0.73-0.81 m for f0-15 = hunched over, then a pleading wave - not a winner. The clip id stays `win_wave` so "
           "the published GLB keeps a valid ref until lane ASSETS re-bakes it (G1 --strict fails on a missing win clip)")
    K.clip("taunt_cocky", mix("Gestures_Pack_Basic/being cocky", (1, 87)), "Mixamo being cocky (shrug)")

    # ---------------- normals ----------------
    lc = ["chain:5L", "chain:2L", "special", "super"]
    K.add("5L", "L", name="Lead Jab", clip="jab", startup=4, hitstun=16, cancel=lc, role=["poke"],
          sfx=[[2, "whoosh_light"]], desc="4-frame jab; links into itself, chains into 2L.",
          why="Shoto trait (FIGHTING_DESIGN 8c 'one 4f jab'): startup 5->4 and hitstun 15->16 make it +4 "
              "on hit so it links into itself (1-frame link) and +8 on punish counter into 5M.")
    K.add("2L", "2L", name="Shin Jab", clip="crouch_jab", cancel=lc, role=["poke", "low"],
          sfx=[[3, "whoosh_light"]], desc="Low jab to the knee; chains and cancels.")
    K.add("5M", "M", name="Cross", clip="cross", cancel=["special", "super"], role=["poke"],
          sfx=[[5, "whoosh_light"]], desc="Straight right; his best mid-range button.")
    K.add("2M", "2M", name="Knee Breaker", clip="low_body", cancel=["special", "super"], role=["poke", "low"],
          sfx=[[5, "whoosh_light"]], desc="Crouching straight to the knee; cancel into HEADLINE HOOK.")
    K.add("5H", "H", name="Haymaker", clip="haymaker", cancel=["special", "super"], sfx=[[8, "whoosh_heavy"]],
          desc="Wide rear hook.")
    K.add("2H", "AA", name="Rising Uppercut", clip="uppercut", cancel=["special", "super"],
          juggle={"js": 1, "ji": 1, "jl": 0}, sfx=[[6, "whoosh_heavy"]], desc="Anti-air uppercut.")
    K.add("3H", "SWEEP", input="3H", kind="command", name="Low Blow", clip="low_blow", cancel=[],
          sfx=[[7, "whoosh_heavy"]], desc="Crouching hook to the knee that drops them (low, knockdown).",
          why="Johnny's 2H is the anti-air, so the sweep lives on 3H (CONTRACT 1: crouch H = anti-air OR "
              "sweep per fighter).")
    K.add("6H", "OH", input="6H", kind="command", name="Overhand Right", clip="overhand", cancel=[],
          sfx=[[12, "whoosh_heavy"]], desc="Looping overhand; must be blocked standing.")
    K.add("j.L", "jL", input="j.L", name="Air Jab", clip="air_jab", desc="Fast air-to-air jab.")
    K.add("j.M", "jM", input="j.M", name="Air Cross", clip="air_cross", desc="Long jump-in straight.")
    K.add("j.H", "jH", input="j.H", name="Diving Hammer", clip="air_hammer", desc="Downward hammer fist jump-in.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Clinch Body Shots", clip="throw_reach",
          grab={"frames": 45, "adv": 21, "hitF": 31, "swap": False, "air": False, "techable": True,
                "clip": "body_burst",
                # P2 paired throw: body_burst's three shots land at clip 0.167 / 0.333 / 0.500 s = lock frames 10 / 20 / 31
                # (0.733 s over 45 f); the victim folds on each and drops on the last (kd_fall_b from the fall at 1.04 s
                # to lying at 1.5 s: 14 f at 2x, face up). CHANGED(fixer) D3 had shots on 10 and 30 and the whole 0.87 s
                # fall squeezed into 15 f (3.7x).
                "victim": [[0, "hit_body", 0.05, 0.2], [10, "hit_body", 0.1, 0.45], [20, "hit_body", 0.15, 0.5],
                           [31, "kd_fall_b", 1.04, 1.5]]},
          desc="Clinches and digs three body shots.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Wide Hook Toss", clip="throw_reach",
          grab={"frames": 48, "adv": 14, "hitF": 22, "swap": True, "air": False, "techable": True,
                "clip": "hook_fling",
                # P2 paired throw: the wide hook passes the front at clip 0.50 s = lock frame 22 (1.10 s over 48 f); the
                # victim is yanked past (thrown_b's forward dive 0-0.40 s) and the hook flips them down behind him
                # (0.40 s -> lying face down at 0.67 s -> 1.2 s). thrown_b travels +1.30 m forward (monotonic), the sim
                # scales it to land behind the thrower.
                "victim": [[0, "hit_high_s", 0.0, 0.2], [8, "thrown_b", 0.0, 0.4], [22, "thrown_b", 0.4, 1.2]]},
          desc="Pulls them past and hooks them the other way.")

    # ---------------- specials ----------------
    # y 1.25 (was 1.35): the brick box must reach the crouch line (1.10 m) - a 1.35 m brick sailed over every
    # measured crouch (1.16-1.44 m); 1.25 is also where the hand releases it (brick_throw effector 1.20 m).
    brick = {"life": 180, "box": [0.35, 0.30], "y": 1.25, "hits": 1, "strength": "M", "clip": "brick", "x": 0.6}
    K.special("brickbat", motion="236", fam="proj",
              common=dict(name="Brickbat", clip="brick_throw", cancel=["super"], role=["projectile"],
                          sfx=[[0, "whoosh_light"]], desc="Hurls a brick. L slow, H fast."),
              per={s: dict(projectile=dict(brick, speed=v, strength=s.upper()))
                   for s, v in (("l", 4.5), ("m", 6.0), ("h", 7.5))},
              ex=dict(name="Brickbat (EX)", startup=11, recovery=30, damage=1000,
                      projectile=dict(brick, speed=7.5, hits=2, strength="H"),
                      desc="Two bricks at once: 2 hits, fastest startup.",
                      why="SF6 OD fireball pattern: 2 hits and faster (11f) for 2 NERVE bars."))
    K.special("encore", motion="623", fam="dp",
              common=dict(name="Encore", clip="encore_upper", cancel=["super"], launch=[1.5, 6.0],
                          juggle={"js": 1, "ji": 1, "jl": 5}, role=["antiair", "reversal", "launcher"],
                          sfx=[[1, "whoosh_heavy"]], desc="Jumping uppercut; air-invulnerable anti-air."),
              per={"l": dict(hitstun=78, move=[[0, 0], [5, 0.2], [15, 0.3]],
                             moveY=[[0, 0], [5, 0.1], [11, 0.8], [20, 0.75], [44, 0.0]]),
                   "m": dict(hitstun=87, move=[[0, 0], [6, 0.3], [16, 0.5]],
                             moveY=[[0, 0], [6, 0.15], [13, 1.1], [24, 1.0], [55, 0.0]]),
                   "h": dict(hitstun=94, move=[[0, 0], [7, 0.4], [17, 0.7]],
                             moveY=[[0, 0], [7, 0.2], [15, 1.4], [27, 1.3], [63, 0.0]])},
              ex=dict(name="Encore (EX)", startup=6, recovery=49, damage=1400, hitstun=88,
                      invuln={"strike": [1, 8], "throw": [1, 8], "air": [1, 8], "proj": [1, 8]},
                      hits=[{"f": [6, 7], "damage": 500, "hitstop": 9}, {"f": [12, 15], "damage": 900,
                                                                          "hitstop": 15}],
                      move=[[0, 0], [6, 0.3], [16, 0.6]],
                      moveY=[[0, 0], [6, 0.2], [15, 1.5], [27, 1.4], [63, 0.0]],
                      desc="Fully invulnerable 2-hit uppercut.",
                      why="1c: 'EX (2 NERVE) fully invulnerable 1-8'; 2 hits for the OD reward."))
    K.special("hook", motion="214", fam="rush",
              common=dict(name="Headline Hook", clip="run_hook", cancel=["super"], role=["approach"],
                          sfx=[[2, "whoosh_heavy"]], desc="Running hook; ends every confirm."),
              per={"l": dict(hitstun=54, move=[[0, 0], [10, 1.2], [14, 1.3]]),
                   "m": dict(hitstun=59, move=[[0, 0], [12, 1.8], [16, 1.9]]),
                   "h": dict(hitstun=69, move=[[0, 0], [14, 2.6], [18, 2.7]], invuln={"throw": [1, 14]})},
              ex=dict(name="Headline Hook (EX)", startup=10, active=8, recovery=20, damage=1200, hitstun=52,
                      armor={"hits": 1, "f": [1, 12]}, move=[[0, 0], [10, 2.6], [17, 2.8]],
                      hits=[{"f": [10, 11], "damage": 500, "hitstop": 11}, {"f": [16, 17], "damage": 700,
                                                                           "hitstop": 13}],
                      desc="Armored two-hook rush, -2 on block.",
                      why="OD rush: 1 hit of armor on the run, 2 hits, -2 on block (vs -12 for H)."))
    weave_c = dict(damage=0, hitstun=0, blockstun=0, hitstop=0, gain=0, nerve=0, pb=(0.0, 0.0),
                   cancel=["whiff", "chain:weave_counter"], role=["lowprofile"], name="Weave",
                   clip="weave_duck", desc="Ducks under high attacks and projectiles; any attack button "
                                           "counters with a rising hook.")
    K.special("weave", motion="22", fam=None, common=weave_c,
              per={"l": dict(startup=3, active=12, recovery=8,
                             hurtOverride=[{"f": [3, 14], "w": 0.62, "h": 1.00}]),
                   "m": dict(startup=3, active=14, recovery=10, move=[[0, 0], [10, 0.3]],
                             hurtOverride=[{"f": [3, 16], "w": 0.62, "h": 1.00}]),
                   "h": dict(startup=3, active=16, recovery=12, move=[[0, 0], [12, 0.6]],
                             hurtOverride=[{"f": [3, 18], "w": 0.62, "h": 0.95}])},
              ex=dict(name="Weave (EX)", startup=1, active=18, recovery=8, move=[[0, 0], [12, 0.4]],
                      invuln={"strike": [1, 18]}, hurtOverride=[{"f": [1, 18], "w": 0.62, "h": 1.00}],
                      desc="Strike-invulnerable weave.", why="EX turns the low-profile duck into full "
                                                             "strike invulnerability 1-18."))
    K.add("weave_counter", None, kind="special", input="22>LMH", name="Counter Hook", strength="H", tc=True,
          trigger={"classic": {"motion": "", "btn": "LMH"}, "simple": "LMH"},
          clip="weave_counter_hook", startup=6, active=3, recovery=20, damage=900, hitstun=48, blockstun=16,
          hitstop=13, guard="HL", gain=1000, nerve=3000, pb=(0.0, 0.45), kd="soft", cancel=["super"],
          role=["reversal"], desc="Rising hook out of a Weave; knocks down, -7 on block.",
          why="Weave follow-up (not a template class): hook frame data 6/3/20, KD +25, -7 so it is "
              "punishable when blocked.")

    # ---------------- supers ----------------
    K.add("sold_out", LV1, kind="super1", input="236236", name="Sold Out", strength="H", clip="sold_out_flurry",
          active=17, recovery=52, hitstun=78,
          hits=[{"f": [8, 9], "damage": 350, "hitstop": 9}, {"f": [12, 13], "damage": 350, "hitstop": 9},
                {"f": [16, 17], "damage": 350, "hitstop": 9}, {"f": [22, 24], "damage": 950, "hitstop": 20}],
          warp="auto",
          invuln={"strike": [1, 10], "throw": [1, 10]}, move=[[0, 0], [8, 0.6], [16, 1.2], [24, 1.8]],
          kd="soft", juggle={"js": 1, "ji": 0, "jl": 99}, cost={"showtime": LV1_COST}, gain=0, nerve=600,
          role=["reversal"], sfx=[[1, "crowd_cheer_burst"]],
          desc="Invulnerable jab-cross-jab-uppercut rush.",
          why="1c Lv1: invulnerable 1-(startup+2); 4 hits (9 hitstop, 20 on the last); recovery 50->52 so the "
              "last hit is -30 on block like the template.")
    K.add("main_event", LV3, kind="super3", input="214214", name="Main Event", strength="H", clip="cross",
          invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 1.0]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic=lambda: cinematic(
              170, "johnny_main_event",
              hits=[[7, 400], [24, 400], [42, 500], [62, 250], [70, 250], [78, 250], [99, 900], [128, 1550]],
              anim=[K.seg(0, "jab", 16, hit=7), K.seg(16, "cross", 34, hit=24), K.seg(34, "haymaker", 56, hit=42),
                    K.seg(56, "body_burst", 92, hit=62, rate=1.25), K.seg(92, "uppercut", 114, hit=99),
                    K.seg(114, "air_hammer", 140, hit=128, rate=0.9), K.seg(140, "win_arms_up", 170, fromS=0.2)],
              victim=[[0, "hit_high_s", 0.0, 0.25], [7, "hit_high_s", 0.0, 0.3], [24, "hit_high_s", 0.0, 0.35],
                      [42, "hit_high_l", 0.0, 0.55], [62, "hit_body", 0.0, 0.18], [70, "hit_body", 0.05, 0.25],
                      [78, "hit_body", 0.05, 0.6], [99, "hit_air", 0.0, 0.6], [128, "kd_fall_b", 1.2, 1.8667],
                      [150, "kd_ground_b", 0.0, 0.367]],
              camera=[cam(0, 34, "close", "both", 32, 2.6, 1.45, 18),
                      cam(34, 56, "close", "defender", [30, 26], [1.9, 1.5], 1.6, 38),
                      cam(56, 92, "low", "both", 40, 2.8, 0.45, -22, lookH=1.1),
                      cam(92, 114, "low", "defender", 42, 3.0, 0.3, 28, lookH=1.7),
                      cam(114, 140, "top", "defender", 40, 1.4, 5.5, 12, lookH=0.6),
                      cam(140, 158, "close", "attacker", 32, [2.4, 2.0], 1.5, [35, 15]),
                      cam(158, 170, "wide", "both", 38, 6.0, 1.8, 0)],
              fx=[(0, "slate"), (7, "impact_s"), (24, "impact_s"), (42, "impact_m"), (42, "shake_s"), (62, "impact_s"),
                  (70, "impact_s"), (78, "impact_m"), (99, "impact_l"), (99, "speed_lines"), (99, "shake_m"),
                  (128, "impact_l"), (128, "flash"), (128, "shake_l"), (128, "dust"), (128, "freeze_frame"),
                  (140, "spot", "attacker"), (158, "spot_off"), (158, "confetti")],
              crowd=[(7, "ooh"), (42, "gasp"), (78, "cheer", "up"), (99, "roar", "up"), (128, "roar", "spike"),
                     (144, "cheer", "peak"), (160, "chant")],
              pathA=[[7, 0.1, 0], [24, 0.2, 0], [42, 0.3, 0], [92, 0.35, 0], [118, 0.55, 0.9], [128, 0.8, 0.3],
                     [134, 0.85, 0], [150, 0.8, 0], [168, 0, 0]],
              gapD=[[7, 1.0, 0], [42, 1.1, 0], [62, 1.0, 0], [99, 1.0, 0.15], [114, 1.25, 1.1], [124, 1.15, 1.25],
                    [131, 1.35, 0], [168, 2.2, 0]],
              slate="PRIME TIME - JOHNNY RIOT: MAIN EVENT", endPose="back", endAdv=19, endGapM=2.2),
          desc="PRIME TIME: a lunging cross that starts a 170-frame beating.",
          why="1c Lv3: 10/4/58, -42 (blockstun 20), 4500, fully invulnerable 1-13.")

    # ---------------- routing ----------------
    K.simple = {"5S": "brickbat_m", "6S": "hook_m", "2S": "encore_m", "4S": "weave_m", "S+H": "sold_out",
                "S+H+2": "main_event", "assist": ["2L", "5M", "5H", "hook_m"]}
    K.classic = [{"motion": "236", "btn": "LMH", "move": "brickbat_{s}"},
                 {"motion": "623", "btn": "LMH", "move": "encore_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "hook_{s}"},
                 {"motion": "22", "btn": "LMH", "move": "weave_{s}"}]
    K.unique = {"kind": "none",
                "trait": "HEADLINER JAB: 4-frame 5L (+4 on hit) links into itself; on a punish counter (+8) "
                         "it links into 5M. The only light in the cast that links."}
    K.cine_doc = [
        "f0 JAB (close, both): Johnny steps in behind the lunging cross; the jab snaps the head back - 400 at f7.",
        "f16 CROSS - 400 at f24. f34 HAYMAKER (punch-in on the face): the crowd gasps - 500 at f42.",
        "f56 BODY BURST (low): three body shots at 1.25x fold them over - 3 x 250 (f62 / f70 / f78).",
        "f92 UPPERCUT (low, looking up): launches them 1.1 m - 900 at f99, speed lines.",
        "f114 DIVING HAMMER (top-down): Johnny leaps 0.9 m and hammers them into the floor - 1550 at f128: flash, "
        "freeze-frame, dust; the ratings spike.",
        "f140 ARMS UP (spotlight on Johnny -> wide, confetti): back on his mark; opponent face up (KD +19) at 2.2 m.",
    ]
    K.text = dict(
        introLine="Doors open, lights down - and I'm still the headliner.",
        winQuotes=["Encore? You couldn't even get through the opening act.",
                   "Put my name back on that marquee. In lights. Big ones.",
                   "That's the hit single. You just heard it live."],
        banter={"boneyard": ["You carved my name off the marquee. I came to carve it back.",
                             "Keep the cleaver in the freezer, butcher. Tonight it's fists and a full house."],
                "freak": ["They let you off the chain for one episode. Let's keep it short.",
                          "Nice claws. I've got a four-frame jab and a contract to honor."],
                "ricky": ["Thirty seasons, Ricky, and you're the only one who read the fine print.",
                          "I'm not here for the poster. I'm here for my band's name."],
                "default": ["Front row paid double tonight. Don't waste their money.",
                            "Lights up, mic check - you're the warm-up act."]},
        ending="JOHNNY RIOT walks out of the Control Room with the host's microphone in one hand and the lifetime "
               "contract in the other. He reads it for the first time, laughs, and feeds it to the confetti cannon. "
               "The band gets its name back on Monday. On Friday the marquee over the Rust Theater lights up one word, "
               "in every bulb that still works: RIOT.")
    return K
