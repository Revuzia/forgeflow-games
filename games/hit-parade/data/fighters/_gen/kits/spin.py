"""SPIN - aerial breakdancer (Breakdance pack: floor footwork, flairs, one-hand spin, freezes; CMU jump kicks)."""
from kitlib import (Kit, air, cam, cinematic, cmu, mix, seq, LV1, LV3, LV1_COST, LV3_COST)

BD = "Breakdance_Pack/"


def _flair_loop():
    """One flair (2) loop: both legs pass the front, twice per 31-frame loop (dense render: legs circle)."""
    return dict(mix(BD + "flair (2)", (1, 31), contact=8), contacts=[8, 24])


def _windmill(loops):
    """flair (3) entry + N flair (2) loops + the first 40 frames of the flair exit (legs out at f5, rising).
    Every contact is a hit: 2 + 2N hits. The exit is trimmed so the recovery plays at <= 3x."""
    return seq(mix(BD + "flair (3)", (34, 51), contact=43), *[_flair_loop() for _ in range(loops)],
               mix(BD + "flair", (1, 40), contact=5), xf=2)


def build():
    K = Kit(
        id="spin", name="SPIN", persona="The B-Boy", archetype="aerial",
        body="Ch06_nonPBR", heightM=1.76, hp=9500, build="slim",
        walk=(2.20, 1.50), dash=(1.20, 0.90, 17, 21), jump=(4, 40, 3, 1.75, 1.60), throwRangeM=0.60,
        colors=[("Hoodie Black", None), ("Rooftop Red", "#d32f2f"), ("Neon Teal", "#00bfa5"), ("Sunburst", "#ffb300")],
        intro="intro_uprock", win=["win_freeze", "win_ending"], taunt="taunt_uprock", rival="patch", stage="rooftop",
        cpu={"style": "aerial", "rangeM": [1.2, 3.0], "approach": ["drop_in_m", "six_step_m"],
             "antiAir": ["handspin_l", "j.M"], "pokes": ["2M", "5M"], "punish": ["5H", "windmill_h"],
             "combo": ["2L", "2M", "windmill_m"], "meter": "cypher", "air": ["drop_in_l", "drop_in_h"]},
        doc=dict(
            difficulty=3, packs="Breakdance (footwork, flairs, one-hand spin, freezes), CMU jump/spin kicks",
            look="Ch06: black hooded track top, black cap, white/red over-ear headphones, black joggers, "
                 "red/white sneakers.",
            bio="Won a rooftop cypher that the network was secretly filming and woke up with a contract. He "
                "plays every bout like a battle round: the crowd is the judge and the floor is his.",
            plan="Get in from the air and from the floor: the floatiest jump (apex 1.75 m), DROP-IN dive kick "
                 "(air-only), SIX STEP crawls in low under pokes and projectiles, WINDMILL spins through the "
                 "opponent. His floor normals shrink his hurtbox under high attacks.",
            weakness="Anti-airs get full punishes on his jumps; DROP-IN is unsafe when it hits shallow; 9500 HP; "
                     "the low-profile moves are all minus on block and lose to low attacks.",
            rivalry="He headspun through Patch's live cue on the rooftop set. She still counts him down.",
        ),
    )

    K.clip("idle", mix(BD + "breakdance uprock var 1", (1, 64), loop=True),
           "OVERRIDE shared idle: bouncing uprock (loop error 1.4 deg, no travel)")
    K.clip("jab", cmu("jab.4", mirror=True), "CMU jab.4 clean (14_02 southpaw 7.5 m/s, mirrored)")
    K.clip("front_kick", cmu("front_kick.6"), "CMU front_kick.6 clean (144_09 left 1.37 m, returns to stance)")
    K.clip("swipes", dict(mix(BD + "breakdance swipes", (60, 91), contact=76), contacts=[76, 81]),
           "Mixamo breakdance swipes: legs whip at hip-to-head height, front passes f76 and f81 (dense render)")
    K.clip("floor_tap", mix(BD + "breakdance footwork 2", (1, 30), contact=11),
           "Mixamo footwork 2: leg extended along the floor at f11")
    K.clip("footwork_sweep", mix(BD + "breakdance footwork 1", (42, 66), contact=56),
           "Mixamo footwork 1: legs flat on the floor f54-58 (dense render)")
    K.clip("flare_sweep", mix(BD + "flair (3)", (22, 51), contact=46),
           "Mixamo flair (3): legs out on the hands, front pass f46 (1.03 m at 0.11 m height)")
    K.clip("butterfly", cmu("spin_kick.1", rng=(30, 140)), "CMU spin_kick.1 usable (88_06 jump spin kick)")
    K.clip("air_jab", air(cmu("jab.4", mirror=True)), "jump apex legs + jab")
    K.clip("air_swipe", mix(BD + "breakdance swipes", (66, 86), contact=76), "breakdance swipes leg whip in the air")
    K.clip("jump_kick", cmu("jump_kick.1"), "CMU jump_kick.1 usable (90_05 airborne turning kick, foot 1.76 m)")
    K.clip("throw_reach", mix("Soccer_Game_Pack/goalkeeper catch (2)", (1, 30), contact=9), "two-hand grab")
    K.clip("footwork_trip", mix(BD + "breakdance footwork to freeze", (1, 50), contact=30),
           "Mixamo footwork to freeze f1-50: drops to the floor, lunges and sweeps the leg up at f30 (grab sheet: leg "
           "sweep at clip 0.99 s). P2: window 1-80 -> 1-50 (the full 2.63 s over a 48-frame lock played at 3.3x)")
    K.clip("flair_toss", mix(BD + "flair (3)", (1, 51), contact=36), "Mixamo flair (3) spin = fling behind")
    K.clip("windmill_l", _windmill(0), "SEQ: flair (3) entry + flair exit f1-40 (chain from MIXAMO_CLIPS)")
    K.clip("windmill_m", _windmill(1), "SEQ: flair entry + 1 flair loop + exit f1-40")
    K.clip("windmill_h", _windmill(2), "SEQ: flair entry + 2 flair loops + exit f1-40")
    K.clip("handspin_clip", seq(mix(BD + "breakdance 1990", (10, 26), contact=19),
                                dict(mix(BD + "breakdance 1990 (2)", (1, 16), contact=8), contacts=[8]),
                                dict(mix(BD + "breakdance 1990 (2)", (1, 16), contact=8), contacts=[8]), xf=1),
           "SEQ: breakdance 1990 (into the one-hand spin, hips down to 0.81 m at f19 measured) + two 1990 (2) "
           "spin loops: legs up = anti-air")
    K.clip("six_step_clip", dict(mix(BD + "breakdance footwork 3", (8, 60), contact=20), contacts=[20, 27]),
           "Mixamo footwork 3: low footwork with leg sweeps at f20 and f27")
    K.clip("six_step_ex_clip", seq(dict(mix(BD + "breakdance footwork 3", (8, 34), contact=20), contacts=[20, 27]),
                                   mix(BD + "breakdance footwork 2", (1, 30), contact=11), xf=2),
           "SEQ: footwork 3 (two sweeps) + footwork 2 floor tap (third low)")
    K.clip("dive_kick", cmu(take="144_10", rng=(915, 1035), contact=955, kind="foot", limb="L_foot"),
           "CMU front_kick 144_10 880/955/1035 (clean, left 1.41 m), played as a held dive kick")
    K.clip("cypher_clip", _windmill(2), "SEQ: flair entry + 2 flair loops + exit f1-40 (Lv1)")
    K.clip("intro_uprock", mix(BD + "breakdance uprock var 1 start", (1, 46)), "uprock start")
    K.clip("win_freeze", mix(BD + "breakdance freezes", (1, 202)), "handstand freezes")
    K.clip("win_ending", mix(BD + "breakdance ending 1", (1, 196)), "breakdance ending 1")
    K.clip("taunt_uprock", mix(BD + "breakdance uprock (2)", (1, 109)), "uprock (2)")

    K.add("5L", "L", name="Toprock Jab", clip="jab", cancel=["chain:5L", "chain:2L", "special", "super"],
          role=["poke"], desc="Jab out of the uprock.")
    K.add("2L", "2L", name="Floor Tap", clip="floor_tap", hurtOverride=[{"f": [3, 14], "w": 0.75, "h": 0.75}],
          cancel=["chain:2L", "special", "super"], role=["poke", "low", "lowprofile"],
          desc="Drops to the floor and taps the shin; low profile.")
    K.add("5M", "M", name="Front Kick", clip="front_kick", startup=9, cancel=["special", "super"], role=["poke"],
          desc="Long front kick.", why="Kick: startup 8->9 (+2/-4) for 1.37 m.")
    K.add("2M", "2M", name="Footwork Sweep", clip="footwork_sweep", startup=9,
          hurtOverride=[{"f": [3, 18], "w": 0.80, "h": 0.70}], cancel=["special", "super"],
          role=["poke", "low", "lowprofile"], desc="Floor footwork leg sweep (low, no knockdown), low profile.",
          why="Low-profile floor poke: startup 9.")
    K.add("5H", "H", name="Swipes", clip="swipes", active=7, recovery=21, damage=850,
          hits=[{"f": [12, 13], "damage": 400, "hitstop": 11}, {"f": [17, 18], "damage": 450, "hitstop": 13}],
          cancel=["special", "super"], sfx=[[8, "whoosh_heavy"]], desc="Two whipping leg swipes.",
          why="Two-hit heavy (the clip whips both legs): active 7, recovery 21 keeps +2/-3 from the last hit; "
              "850 over 2 hits.")
    K.add("2H", "SWEEP", name="Flare Sweep", clip="flare_sweep", startup=11,
          hurtOverride=[{"f": [4, 20], "w": 0.90, "h": 0.80}], desc="Flair leg sweep, low profile.",
          why="Flair sweep: startup 11 (drops onto the hands first), low profile 4-20.")
    K.add("6M", "OH", input="6M", kind="command", name="Butterfly Kick", clip="butterfly",
          moveY=[[0, 0], [8, 0.6], [18, 0.3], [21, 0.0]], desc="Jump spin kick overhead that hops over lows.",
          why="Overhead template 18/3/17 on a hop (airborne 1-20, beats lows).")
    K.add("j.L", "jL", input="j.L", name="Air Jab", clip="air_jab", desc="Air jab.")
    K.add("j.M", "jM", input="j.M", name="Air Swipe", clip="air_swipe", role=["antiair"], desc="Leg whip air-to-air.")
    K.add("j.H", "jH", input="j.H", name="Jump Turning Kick", clip="jump_kick", desc="Turning jump-in.")
    K.add("throw_f", "THROW_F", input="LM", kind="throw", name="Footwork Trip", clip="throw_reach",
          grab={"frames": 48, "adv": 21, "hitF": 28, "swap": False, "air": False, "techable": True,
                "clip": "footwork_trip",
                # P2 paired throw: footwork_trip (f1-50, 1.63 s over 48 f) drops under them, kicks the shin (lock 12)
                # and sweeps the legs at clip 0.97 s = lock 28; they topple backwards (kd_fall_b from the drop, face up).
                "victim": [[0, "hit_high_s", 0.0, 0.2], [12, "hit_low", 0.0, 0.5], [28, "kd_fall_b", 1.0, 1.55]]},
          desc="Drags them down into his footwork.")
    K.add("throw_b", "THROW_B", input="4LM", kind="throw", name="Flair Toss", clip="throw_reach",
          grab={"frames": 46, "adv": 14, "hitF": 32, "swap": True, "air": False, "techable": True,
                "clip": "flair_toss",
                # P2 paired throw: the flair's leg pass at clip 1.17 s = lock 32 (1.67 s over 46 f) flings them past; the
                # victim is pulled into the spin (thrown_b 0 -> 0.55 s) and lands face down behind him at lock ~35.
                "victim": [[0, "hit_high_s", 0.0, 0.15], [8, "thrown_b", 0.0, 0.55], [32, "thrown_b", 0.55, 1.1]]},
          desc="Flairs and flings them behind.")

    wm = {}
    for s_, (st, gaps, rec, dmgs, mv) in {"l": (12, [8], 24, [450, 550], 0.6),
                                          "m": (13, [11, 13, 8], 26, [250, 250, 300, 300], 1.0),
                                          "h": (14, [11, 13, 10, 13, 8], 28, [200, 200, 200, 200, 200, 200],
                                                1.4)}.items():
        fs = [st]
        for g in gaps:
            fs.append(fs[-1] + g)
        hits = [{"f": [f, f + 1], "damage": d, "hitstop": 9 if k < len(fs) - 1 else 13}
                for k, (f, d) in enumerate(zip(fs, dmgs))]
        last = fs[-1]
        wm[s_] = dict(startup=st, active=last + 1 - st + 1, recovery=rec, damage=sum(dmgs), hits=hits,
                      hitstun=30 + 2 + rec, clip="windmill_" + s_, warp="auto",
                      move=[[0, 0], [last, mv]], hurtOverride=[{"f": [6, last + 2], "w": 0.9, "h": 0.8}])
    K.special("windmill", None, motion="236",
              common=dict(name="Windmill", blockstun=18, hitstop=13, guard="HL", gain=900, nerve=3000,
                          pb=(0.0, 0.45), kd="soft", cancel=["super"], role=["lowprofile", "approach"],
                          sfx=[[4, "whoosh_light"]],
                          desc="Flair spin through the opponent (2/4/6 hits), low profile.",
                          why="Multi-hit spin (Breakdance flair chain): one hit per leg pass (entry, 2 per flair "
                              "loop, exit) at ~2.5x, -8/-10/-12 on block, KD +30 from the last hit."),
              per=wm,
              ex=dict(name="Windmill (EX)", clip="windmill_h", startup=10, active=57, recovery=22, damage=1400,
                      hitstun=54, warp="auto", invuln={"proj": [1, 30]}, move=[[0, 0], [65, 1.6]],
                      hurtOverride=[{"f": [4, 67], "w": 0.9, "h": 0.8}],
                      hits=[{"f": [f, f + 1], "damage": d, "hitstop": 9 if k < 5 else 15}
                            for k, (f, d) in enumerate(zip([10, 21, 34, 44, 57, 65], [200, 200, 200, 250, 250, 300]))],
                      desc="Projectile-invulnerable 6-hit windmill, -6 on block.",
                      why="EX: projectile invulnerable 1-30, 6 hits, -6."))
    hs = {}
    for s, (st, rec, dmg, inv) in {"l": (7, 30, [300, 300, 300], 12), "m": (8, 33, [300, 350, 350], 9),
                                   "h": (9, 36, [350, 350, 400], 7)}.items():
        hs[s] = dict(startup=st, active=22, recovery=rec, damage=sum(dmg), hitstun=30 + 2 + rec,
                     hits=[{"f": [st + 10 * k, st + 10 * k + 1], "damage": dmg[k], "hitstop": 9 if k < 2 else 15}
                           for k in range(3)],
                     invuln={"air": [1, inv]}, hurtOverride=[{"f": [4, st + 21], "w": 0.6, "h": 1.0}],
                     moveY=[[0, 0], [st, 0.1], [st + 10, 0.4], [st + 22 + rec - 4, 0.0]])
    K.special("handspin", None, motion="623",
              common=dict(name="Handspin", clip="handspin_clip", blockstun=20, hitstop=13, guard="HL", gain=800,
                          nerve=4000, pb=(0.0, 0.45), kd="soft", launch=[0.5, 5.0], warp="auto",
                          juggle={"js": 1, "ji": 1, "jl": 4}, cancel=["super"], role=["antiair"],
                          sfx=[[2, "whoosh_heavy"]],
                          desc="One-hand spin with the legs up: 3-hit anti-air, air-invulnerable legs-up startup.",
                          why="Aerial fighter's anti-air (not a DP): 7/8/9 startup, air-invulnerable 1-12/1-9/1-7 "
                              "(body low, legs high), -12/-15/-18 on block."),
              per=hs,
              ex=dict(name="Handspin (EX)", startup=7, active=22, recovery=34, damage=1300, hitstun=66,
                      invuln={"strike": [1, 10], "throw": [1, 10], "air": [1, 10], "proj": [1, 10]},
                      hits=[{"f": [7, 8], "damage": 400, "hitstop": 9}, {"f": [17, 18], "damage": 400, "hitstop": 9},
                            {"f": [27, 28], "damage": 500, "hitstop": 15}],
                      hurtOverride=[{"f": [4, 28], "w": 0.6, "h": 1.0}],
                      moveY=[[0, 0], [7, 0.1], [17, 0.5], [55, 0.0]], role=["antiair", "reversal"],
                      desc="Fully invulnerable handspin.", why="EX: fully invulnerable 1-10."))
    ss = {}
    for s, (st, rec, mv, d) in {"l": (12, 18, 1.2, (400, 400)), "m": (14, 20, 1.6, (450, 450)),
                                "h": (16, 22, 2.0, (500, 500))}.items():
        ss[s] = dict(startup=st, active=10, recovery=rec, damage=sum(d),
                     hits=[{"f": [st, st + 1], "damage": d[0], "hitstop": 9},
                           {"f": [st + 8, st + 9], "damage": d[1], "hitstop": 11}],
                     move=[[0, 0], [st + 8, mv]], hurtOverride=[{"f": [4, st + 10], "w": 0.9, "h": 0.75}])
    K.special("six_step", None, motion="214",
              common=dict(name="Six Step", clip="six_step_clip", hitstun=22, blockstun=16, hitstop=11, guard="L",
                          gain=800, nerve=3000, pb=(0.25, 0.35), warp="auto", cancel=["super"],
                          role=["low", "lowprofile", "approach"], sfx=[[3, "whoosh_light"]],
                          desc="Low-profile footwork crawl-in with two low sweeps.",
                          why="Approach special: two lows 8 frames apart, low profile from frame 4, +2/-4 (L) "
                              "to -2/-8 (H)."),
              per=ss,
              ex=dict(name="Six Step (EX)", clip="six_step_ex_clip", startup=12, active=21, recovery=16, damage=1200,
                      move=[[0, 0], [31, 2.2]],
                      hits=[{"f": [12, 13], "damage": 400, "hitstop": 9}, {"f": [20, 21], "damage": 400, "hitstop": 9},
                            {"f": [31, 32], "damage": 400, "hitstop": 11}],
                      hurtOverride=[{"f": [3, 33], "w": 0.9, "h": 0.75}],
                      desc="Three lows, -2 on block.", why="EX: 3 hits (its own 3-contact clip), -2."))
    K.special("drop_in", None, motion="214",
              common=dict(name="Drop-In", clip="dive_kick", air=True, active=20, recovery=6, hitstun=20, blockstun=16,
                          hitstop=11, guard="H", gain=700, nerve=2500, pb=(0.25, 0.30), cancel=[],
                          role=["approach"], sfx=[[2, "whoosh_light"]],
                          desc="Air-only dive kick (214 or S in the air): L steep, H flat and far.",
                          why="FIGHTING_DESIGN 8c DIVE KICK (air, 10f, +2 on block if deep): the dive lasts until "
                              "landing (active 20 max), 6 landing frames; advantage depends on height."),
              per={"l": dict(startup=8, damage=700, airVel=[2.0, -6.0]),
                   "m": dict(startup=9, damage=750, airVel=[3.0, -5.0]),
                   "h": dict(startup=10, damage=800, airVel=[4.0, -4.0])},
              ex=dict(name="Drop-In (EX)", startup=7, damage=1000, blockstun=19, airVel=[4.5, -5.5],
                      desc="Fast, far dive, +3 more on block.", why="EX: 7f and 3 extra blockstun."))
    K.add("cypher", LV1, kind="super1", input="236236", name="Cypher", strength="H", clip="cypher_clip",
          active=57, recovery=53, hitstun=78,
          hits=[{"f": [f, f + 1], "damage": d, "hitstop": 9 if k < 5 else 20}
                for k, (f, d) in enumerate(zip([8, 19, 32, 42, 55, 63], [300, 300, 300, 300, 300, 500]))],
          warp="auto", invuln={"strike": [1, 10], "throw": [1, 10]}, move=[[0, 0], [63, 1.6]],
          hurtOverride=[{"f": [4, 65], "w": 0.9, "h": 0.8}], kd="soft", juggle={"js": 1, "ji": 0, "jl": 99},
          cost={"showtime": LV1_COST}, gain=0, nerve=600, role=["reversal", "lowprofile"],
          sfx=[[1, "crowd_cheer_burst"]], desc="Invulnerable 6-hit flair cyclone.",
          why="1c Lv1: invulnerable 1-10, 6 hits (one per flair contact), recovery 53 -> -30 on block, KD +23.")
    K.add("battle_of_the_year", LV3, kind="super3", input="214214", name="Battle of the Year", strength="H",
          clip="front_kick", invuln={"strike": [1, 13], "throw": [1, 13], "air": [1, 13], "proj": [1, 13]},
          move=[[0, 0], [10, 0.8]], cost={"showtime": LV3_COST}, gain=0, nerve=7500, role=["reversal"],
          juggle={"js": 1, "ji": 0, "jl": 99},
          cinematic=lambda: cinematic(
              165, "spin_battle",
              hits=[[8, 400], [30, 300], [36, 300], [55, 600], [80, 700], [108, 900], [134, 1300]],
              anim=[K.seg(0, "front_kick", 22, hit=8), K.seg(22, "swipes", 48, hit=30, rate=1.7),
                    K.seg(48, "flare_sweep", 72, hit=55), K.seg(72, "butterfly", 100, hit=80),
                    K.seg(100, "jump_kick", 128, hit=108), K.seg(128, "handspin_clip", 150, hit=134),
                    K.seg(150, "win_freeze", 165, fromS=1.0)],
              victim=[[0, "hit_high_s", 0.0, 0.3], [8, "hit_high_s", 0.0, 0.35], [30, "hit_high_l", 0.0, 0.2],
                      [36, "hit_high_l", 0.1, 0.4], [55, "hit_air", 0.0, 0.4], [80, "hit_air", 0.3, 0.7],
                      [108, "hit_air", 0.5, 1.0], [134, "hit_air", 0.6, 1.1], [142, "kd_fall_b", 1.3, 1.8667]],
              camera=[cam(0, 22, "close", "both", 32, 2.4, 1.4, 15),
                      cam(22, 48, "low", "both", 40, 2.6, 0.45, -20, lookH=1.1),
                      cam(48, 72, "top", "both", 42, 1.6, 5.0, 10, lookH=0.4),
                      cam(72, 100, "low", "defender", 42, 3.0, 0.3, 25, lookH=1.9),
                      cam(100, 128, "orbit", "both", 40, 3.6, 2.0, [-30, 50], lookH=1.9, ease="linear"),
                      cam(128, 150, "close", "both", [36, 32], 3.4, 1.3, 30, lookH=1.6),
                      cam(150, 165, "wide", "both", 38, 5.6, 1.7, 0)],
              fx=[(0, "slate"), (8, "impact_s"), (30, "impact_s"), (36, "impact_s"), (36, "smear", "attacker"),
                  (55, "impact_m"), (55, "dust"), (80, "impact_m"), (80, "speed_lines"), (108, "impact_m"),
                  (108, "shake_s"), (134, "impact_l"), (134, "flash"), (134, "shake_m"), (134, "freeze_frame"),
                  (150, "spot", "attacker"), (150, "confetti")],
              crowd=[(8, "ooh"), (30, "cheer"), (55, "ooh", "up"), (80, "cheer", "up"), (108, "roar", "up"),
                     (134, "roar", "spike"), (150, "chant", "peak")],
              pathA=[[8, 0.2, 0], [30, 0.35, 0], [55, 0.45, 0], [80, 0.6, 0.5], [92, 0.7, 0], [108, 0.8, 0.8],
                     [118, 0.9, 0], [134, 0.95, 0.2], [148, 0.9, 0], [163, 0, 0]],
              gapD=[[8, 1.0, 0], [30, 1.0, 0], [55, 1.0, 0.3], [80, 1.0, 0.9], [100, 1.0, 1.2], [108, 1.0, 1.4],
                    [128, 1.0, 1.0], [134, 1.0, 0.9], [142, 1.2, 0], [163, 2.2, 0]],
              slate="PRIME TIME - SPIN: BATTLE OF THE YEAR", endPose="back", endAdv=19, endGapM=2.2),
          desc="PRIME TIME: a front kick opens a full battle round the crowd scores live.",
          why="1c Lv3: 10/4/58, -42, 4500, fully invulnerable 1-13.")

    K.simple = {"5S": "windmill_m", "6S": "six_step_m", "2S": "handspin_m", "4S": "handspin_l", "jS": "drop_in_m",
                "S+H": "cypher", "S+H+2": "battle_of_the_year", "assist": ["5L", "5M", "5H", "windmill_m"]}
    K.classic = [{"motion": "236", "btn": "LMH", "move": "windmill_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "six_step_{s}"},
                 {"motion": "214", "btn": "LMH", "move": "drop_in_{s}",
                  "note": "214 in the air = DROP-IN (air:true), on the ground = SIX STEP (CONTRACT 20.4)."},
                 {"motion": "623", "btn": "LMH", "move": "handspin_{s}",
                  "note": "SIMPLE 4S = HANDSPIN L (the most air-invulnerable version) and 2S = HANDSPIN M: SF6 "
                          "Modern also maps several SP directions to strengths of one move."}]
    K.unique = {"kind": "none",
                "trait": "LOW PROFILE + AIR: floor normals (2L/2M/2H), WINDMILL and SIX STEP shrink his "
                         "hurtbox under highs and projectiles; DROP-IN is an air-only dive kick; floatiest jump "
                         "(apex 1.75 m, 40 air frames)."}
    K.cine_doc = [
        "f0 FRONT KICK (close) - 400 at f8. f22 SWIPES (low): two leg whips at 1.7x - 300 + 300 (f30 / f36).",
        "f48 FLARE SWEEP (top-down): swept off their feet and up - 600 at f55.",
        "f72 BUTTERFLY (low, looking up) - 700 at f80. f100 JUMP TURNING KICK (orbit -30 -> +50 deg, both in the "
        "air) - 900 at f108.",
        "f128 HANDSPIN (close): the legs-up spin juggles them - 1300 at f134 (flash, freeze-frame).",
        "f150 FREEZE (wide, spotlight, confetti): handstand freeze, the crowd scores 10s; opponent face up at 2.2 m "
        "(KD +19).",
    ]
    K.text = dict(
        introLine="Cypher's open. Crowd's the judge. You're the warm-up.",
        winQuotes=["Ten, ten, ten. The judges have spoken.",
                   "You danced like you were paying rent on the floor.",
                   "Battle's over. Send me somebody with footwork."],
        banter={"patch": ["It was ONE headspin through your cue, Patch.",
                          "Count me in. I'll be done before three."],
                "freak": ["Big guy, zero rhythm. This is gonna be embarrassing.",
                          "Try to keep up. The floor is lava, and I'm the lava."],
                "ricky": ["You filmed my cypher without asking, Ricky.",
                          "Tonight the crowd votes. Not the network."],
                "default": ["Circle up. Show me what you got.",
                            "Nice stance. Shame about the rest."]},
        ending="SPIN wins the season and the rooftop cypher on the same night; the crowd holds up score cards all the "
               "way down the fire escape. He wires the host's microphone into a speaker and runs a free battle on the "
               "roof every Friday. The network sends lawyers. The lawyers stay for the music.")
    return K
