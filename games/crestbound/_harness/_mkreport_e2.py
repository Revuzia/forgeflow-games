# -*- coding: utf-8 -*-
"""Assemble the ember-2 PISTON HALLS playtest report from the observations made in
_harness/_play_e2*.py.  Every line below traces to a run whose raw trace is in
_harness/_playreports/_raw_e2*.json."""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
P = os.path.join(HERE, "_playreports", "ember-2.json")
S = "games/crestbound/_shots/play_"

played = (
 "Booted the shipped page (?dev=1&quality=low&autoscale=0), left the title with the real NEW GAME button, "
 "unlocked the gates and travelled to ember-2 with __dev.goto, then played PISTON HALLS with real KeyboardEvents "
 "through window across 12 driver runs (_harness/_play_e2a.py .. _play_e2m.py, all committed).\n"
 "ROUTE A: spawned on the apron at [0,6,54], read the PISTON HALLS marquee from the pad, walked the coin trail "
 "south-to-north on W through the hall's south door, then ran all THREE piston lanes (x -7 / 0 / +7) end to end "
 "three times each - nine full crossings of the twelve crushers. Sampled every crusher head 40 times over 8 s to "
 "read the rhythm; stood under a row-1 head on purpose to check it kills; stood on a parked head and on its "
 "housing; idled 12 s in the row-1/row-2 breather band.\n"
 "BEAT 3: walked the hall's west margin to the seventh piston and pounded the odd steel panel (broke on the second "
 "pound). BEAT 4 SORTER: skipped to cp-sorter, ran at the belts from the floor, jumped onto the x=0 cross belt, "
 "stood on all three belts to see if they carry, ran onto both speedpads at full run speed, pounded a coin crate "
 "from 7.6 m up (it broke, +3 coins), stood 9 s inside the sweep bar's arc, and stood 8 s just outside and then "
 "inside the gnasher's 5.5 m chain.\n"
 "ROUTE B GANTRY: walked from the spawn apron around the hall's east flank on W and climbed the switchback stair, "
 "then ran the roof deck through all four pulse beams three times, rode/was-shoved-by the maintenance trolley, "
 "boarded it with a timed jump, then walked the north catwalk grate by grate and walked the seesaw end to end "
 "while sampling its collider's rotation every 150 ms.\n"
 "BEAT 6 CHANNEL: walked down the south bank onto the south plate, hopped plate -> vanishing grate -> north plate, "
 "then jumped into the coolant, drifted 9 s with no input to measure the current, crouched to walk the bottom, "
 "stroked back to the surface and swam west to the pump jetty.\n"
 "BEAT 8 FLYWHEEL: stood on the drum roof deck, measured the gondola boarding window off the engine's own rAF for "
 "13 s, and made 10 boarding attempts across two runs, riding one gondola up and trying to step across to the crown.\n"
 "Screenshotted 130+ frames into games/crestbound/_shots/play_e2a .. play_e2m and read them."
)

defects = [
 {"id": "E2-1", "severity": "high",
  "where": "ember-2 BEAT 4 THE SORTER - all three belts (deck tops 6.60) against the sorter floor (6.00)",
  "did": "Ran north at full run speed (9.0 m/s) from the race pad at [0,6,15] up the lane the two speedpads aim at, straight into the south edge of the x=0 cross belt.",
  "happened": "BONK and a dead stop. Speed 9.00 -> 2.20 -> 0.00 and the hero held state 'bonk' at z=6.38 for the remaining 1.6 s. Collider probe: the belt decks are solid boxes with top 6.60 on a 6.00 floor - a 0.60 m lip against TUNE.stepUp 0.45 - so a walking or running player can NEVER get onto a belt from the floor. A deliberate jump does work (lands on surface 'conveyor').",
  "should": "BEAT 4's whole premise is 'THE BELT DECIDES YOUR SPEED / RUN AGAINST IT TO STAND STILL'. Walking into the sorter should put you on the belt. Give the decks a sub-0.45 m lip (or a kerb/ramp) so the set piece is entered by walking into it, not by discovering you must jump a knee-high wall.",
  "png": S + "e2d/04_pad1.png ; trace in _harness/_playreports/_raw_e2d.json -> res.pad_runs[1].path"},

 {"id": "E2-2", "severity": "high",
  "where": "ember-2 BEAT 4 - both speedpads: [-6,5.34,-3] power 12 and [0,6.15,12] power 11, dir [0,0,-1]",
  "did": "Ran onto each pad in its own direction at full run speed, sampling player speed every 200 ms; y confirms the hero was standing on the pad (6.14 -> 6.30 = the pad top).",
  "happened": "Nothing at all. Speed reads EXACTLY 9.00 m/s (= TUNE.speedRun) on the frame before the pad, on the pad, and after it. The run's peak (9.33 / 9.93) happened BEFORE the pad was touched. The authored 11 and 12 m/s never appear anywhere in the trace.",
  "should": "A speedpad should launch the hero at its authored power - that is what makes the 'STAND ON THE PLATE' sign true and what is supposed to throw you north into the coolant channel. As shipped, both pads are painted rubber.",
  "png": S + "e2d/04_pad0.png, " + S + "e2d/04_pad1.png"},

 {"id": "E2-3", "severity": "high",
  "where": "ember-2 BEAT 5 - the seesaw walkway at [8,20.05,-16.5] s[9,0.5,3.2], axis 'z', maxDeg 18, spring 5",
  "did": "Stood on its south end at [8,20.30,-14.9] and walked the full plank north on W, sampling the seesaw collider's quaternion and the hero's y every 150 ms.",
  "happened": "IT NEVER MOVES. The collider quaternion is identity [0,0,0,1] before the hero steps on, at every sample while he crosses (z -15.10 -> -18.62), and after. Measured tilt 0.00 degrees against an authored maxDeg of 18, and the hero's y is a flat 20.30 the whole way. The course comment says 'you walk the plank and it tips as you pass centre'; it does not tip at all.",
  "should": "The seesaw should tilt under the hero's weight - it is one of only two named set pieces on the 60 m north catwalk and it currently behaves as a static grate.",
  "png": S + "e2j/01_01_on_seesaw.png ; sample table in _raw_e2j.json -> res.seesaw_tilt"},

 {"id": "E2-4", "severity": "high",
  "where": "ember-2 ROUTE B - the switchback stair's first flight (x 18.5) and its landing platform [21,12.7,17] s[8,0.6,4]",
  "did": "Walked up flight 1 from the stair foot at [18.5,6.5,25.5] with W held and no jumping, the way anybody climbs a staircase.",
  "happened": "The hero stops dead at [18.50, 12.30, 19.38] in state 'run' and cannot go further. Collider probe of x16..26 y10..16 z14..22: flight 1's treads top out at 12.30 (z 19.0), 12.65 (z 18.6) and 13.00 (z 18.2), but the LANDING SLAB occupies y 12.40..13.00 across z 15..19 - so the landing's own underside caps the last two treads. Reachable tread 12.30, landing top 13.00 = a 0.70 m step against TUNE.stepUp 0.45. One jump clears it (verified: -> [19.91, 13.00, 18.78]) but nothing tells you a staircase needs a jump.",
  "should": "Seat the landing on the top tread (or raise its slab clear of them) so route B's first flight is walkable end to end.",
  "png": S + "e2g/02_stair_stopped.png, " + S + "e2g/03_stair_stop_view.png"},

 {"id": "E2-5", "severity": "high",
  "where": "ember-2 BEAT 5 - catwalk A [8,20.0,9] (top 20.30) and the maintenance trolley (mover, oscillate amp 9 period 9, deck top 20.75)",
  "did": "Stood still on catwalk A at [8.0,20.3,9.0] - the exact spot the course comment calls a step onto the trolley ('its near pose (x 7.5..10.5) overlaps catwalk A, so boarding is a step') - and watched 9 s without touching a key.",
  "happened": "The trolley BULLDOZED the hero along the catwalk: x 7.24 -> 7.87 -> 8.94 -> 9.95 -> 10.52, past the catwalk's east edge at x=10, then a 14.3 m fall to the sorter floor (y 20.30 -> 6.04). y never became 20.75, so the hero was never carried on the deck - the trolley's 0.45 m side face acted as a plough. (Boarding it on purpose DOES work: 2 of 3 timed jumps landed on 20.75.)",
  "should": "A trolley whose stated job is to be boarded must not shove a standing player off a 14 m drop. Either bring its deck flush with 20.30 so the hero is carried, or stop its near pose clear of the catwalk.",
  "png": S + "e2f/08_trolley.png ; path in _raw_e2f.json -> res.trolley_ride.path"},

 {"id": "E2-6", "severity": "high",
  "where": "ember-2 BEAT 8 - THE FLYWHEEL: two gondolas (mover, orbit r 6.90 about [-10.5,27.90,-50], period 6 s) boarded from the drum roof deck (top 20.30, west edge x=-8)",
  "did": "Measured the boarding window off the engine's own requestAnimationFrame for 13 s of course clock, then made 10 boarding attempts across two runs, boarding from the roof's west edge and riding up.",
  "happened": "(a) The window is 0.41 s on average (0.38 / 0.41 / 0.41 / 0.44 s, once every 3.0 s) - the gondola sweeps horizontally at ~7.2 m/s at the bottom of its circle, so the 'a 1.10 m step off the roof' the comment describes is a sub-half-second timing test, and only 2 of 10 attempts boarded even with frame-accurate JS timing. (b) NEITHER successful ride reached the crown. Both times the gondola carried the hero up the east arc to y ~32.5 and then left him behind: he dropped into state 'fall', fell 26 m to the core yard, and both rides ended in a death. The 3.70 m step onto the crown deck never became available.",
  "should": "The course calls the flywheel 'the one you will tell people about'. As shipped you cannot board it reliably and you cannot ride it to the top - the platform stops carrying the hero on the upper arc. Fix the mover carry on an orbit path, and widen or dwell the boarding pose.",
  "png": S + "e2j/20_05_fly_try1.png, " + S + "e2j/21_06_fly_ride.png ; windows in _raw_e2l.json -> res.board_windows, rides in res.rides"},

 {"id": "E2-7", "severity": "medium",
  "where": "ember-2 BEAT 5 - the north catwalk, seen from its own entrance on catwalk A at [8,20.3,12]",
  "did": "Stood on catwalk A at the default camera (yaw 0, pitch 0.22) and at pitch 0.05 and -0.20, looking north down the 60 m of route B I was about to jump along.",
  "happened": "You cannot see ANY of it. Grates 1/2/3 (z 1.5 / -4.5 / -10.5), the seesaw (-16.5), platform C (-22.5), grate 4 (-29) and platform D (-35) are all invisible: the dark IRON grates read as nothing against a dark slag horizon, and when a grate is in its off phase all that is drawn is a wireframe outline that vanishes at range. The only things in frame are the trolley machine and its sign. A first-time player standing there concludes the catwalk ends at his feet.",
  "should": "Route B's 60 m of catwalk needs to read from its entrance - brighter safe-edge on the grates, a lit handrail line, or a lamp run - the way the piston hall's lanes do.",
  "png": S + "e2m/05_02_catwalkA_north_default.png, " + S + "e2m/07_02_catwalkA_north_down.png, " + S + "e2m/z_northdown.png"},

 {"id": "E2-8", "severity": "medium",
  "where": "ember-2 BEAT 2 - the piston hall, the three lanes at x -7 / 0 / +7 between z 41 and 15",
  "did": "Ran each lane end to end with W held, three times each - nine full crossings of all three rows of crushers, no jumping and no timing.",
  "happened": "Zero deaths in 9 of 9 runs. The 4.8 m heads on 7 m centres leave 2.20 m lanes that are clear on EVERY phase, so nothing in the hall can touch a player who walks a lane. The marquee outside says 'EVERY PISTON KEEPS ITS OWN COUNT / WATCH ONE / THEN MOVE' and the sign inside says 'THREE LANES - THREE COUNTS', but no count is ever required on the route.",
  "should": "The hall's headline hazard should gate the route it stands in - overlap the lanes on some phase, or lay a coin/sigil line that forces a lateral crossing under a head. (The rhythm itself is good: 40 samples over 8 s show the heads running 12.40 -> 7.20 on 3.6 / 4.4 / 2.6 s periods with the quarter-cycle offsets the data authors, and no two rows ever line up.)",
  "png": S + "e2b/07_lane+0_try2.png"},

 {"id": "E2-9", "severity": "medium",
  "where": "ember-2 - every authored deck in the course (hall floor, roof deck, catwalks, stairs, channel plates)",
  "did": "Read player.surface at six stations along routes A and B: apron, hall floor, sorter floor, stair head, catwalk, channel plate.",
  "happened": "apron 'sand', hall floor 'normal', sorter floor 'sand', stair head 'normal', catwalk 'normal', channel plate 'normal'. Every grate, plate, stair and deck in a STEEL FOUNDRY reports the default surface, so step_metal never plays; the two terrain stations report 'sand', so the foundry yard plays sand footsteps. Only the conveyors carry a real surface ('conveyor'). CONTRACT section 5 ships step_metal / step_stone / step_wood for exactly this.",
  "should": "mat 'grate' / 'metal' / 'brick' geometry should put surface 'metal' / 'stone' on its collider so Piston Halls sounds like a foundry underfoot.",
  "png": S + "e2c (the dev overlay's 'surface' field is in every frame)"},

 {"id": "E2-10", "severity": "medium",
  "where": "ember-2 BEAT 5 - the pulse beams at y 21.30 (1.00 m over the 20.30 roof deck), z 34 / 26 / 18 / 14",
  "did": "Teleported to [0,20.5,38] and ran flat out south-to-north through all four beams, three times.",
  "happened": "Died 2 of 3 runs, both at the SECOND beam (z=26), at full run speed. They cannot be crouched under - beam bottom is 0.78 m over the deck and TUNE.crouchHeight is 0.95 - so the only answer is a jump on a 0.7 s warn.",
  "should": "Playable, but it is the one place in Piston Halls where a first-timer dies without learning what the answer was, and it sits immediately after cp-gantry so it is the first thing route B shows you. Worth confirming the warn is unmissable from a running third-person camera, or lengthening the off window on the z=26 beam.",
  "png": S + "e2f/07_beam_run1.png, " + S + "e2f/06_roof_deck_beams.png"},

 {"id": "E2-11", "severity": "low",
  "where": "ember-2 BEAT 5 - the sign 'GRATES REMEMBER YOUR WEIGHT' at [8.0,21.6,5.6], size 0.22",
  "did": "Read it from catwalk A at the default camera, the only place a player ever stands to read it.",
  "happened": "It wraps to two lines and the FIRST line is degraded - the glyphs of 'GRATES' bleed into each other and read as 'GRRTES' / 'GAATES'. The second line is legible. Same effect at 0.45 camera pitch.",
  "should": "Either author it as two short strings (the file already does that elsewhere) or raise the size, so the word that names the hazard is readable.",
  "png": S + "e2m/z_sign2.png, " + S + "e2h/z_sign.png"},

 {"id": "E2-12", "severity": "low",
  "where": "ember-2 BEAT 8 - the crown deck seen from the flywheel deck at [-5.4,20.3,-50], camera looking west and up",
  "did": "Looked up at the crown from the flywheel deck - the pose you are in while working out how to get up there.",
  "happened": "Two things read badly. (1) The 3x3 crown column at [0,20.3,-50] sits between the third-person camera and the hero whenever the hero stands west of it and fills the left half of the frame. (2) Large unlit pale-blue and orange chevrons and a pale horizontal band paint over the crown deck's lattice and, in one frame, over the hero's own head - they look like edge-stripe/marker geometry drawn without depth. I could NOT attribute them to a named mesh (a scene scan of y 22..42 found nothing oversized but the sky dome), so this is 'looks wrong, worth a look', not a diagnosed bug.",
  "should": "The camera should pull around the crown column, and whatever paints those chevrons should respect depth.",
  "png": S + "e2j/18_03_flywheel_from_roof.png, " + S + "e2j/z_crown.png, " + S + "e2m/01_01_flywheeldeck_west_up.png"},

 {"id": "E2-13", "severity": "low",
  "where": "ember-2 BEAT 6 - the coolant current volume [-8,1.6,-14] s[64,2.2,13] dir[-1,0,0] power 3.2",
  "did": "Dropped into the channel at [4,4.5,-14] and floated 9 s with no input at all, measuring drift.",
  "happened": "Drifted x 0.97 -> -19.00 = 2.22 m/s west, against an authored 3.2. The channel still delivers you to the pump jetty, so it is not broken - just about 30 percent slower than the number in the data, which matters for the 55 s race overlay.",
  "should": "Worth confirming the current volume applies its full authored power to a floating swimmer.",
  "png": S + "e2h/09_drifting.png"},
]

worked = [
 "ROUTE A's entry is clean: the spawn apron -> south door walk works on plain W with no snags, and the PISTON HALLS marquee is large, bright and fully readable from the spawn pad.",
 "The crusher rhythm is real and deterministic - 40 samples over 8 s show the twelve heads on 3.6 / 4.4 / 2.6 s periods with quarter-cycle offsets, and no two rows ever line up. It is a genuinely good read; it just does not gate anything (E2-8).",
 "Crushers kill correctly and fairly: standing under a row-1 head at [-10.5,6.05,37] took exactly one death when it came down, and the rewind + respawn put the hero back on the last checkpoint.",
 "A parked crusher IS a platform, exactly as hazards/crushers.js promises: a solid deck at 13.10 and a second housing deck at 14.76, both standable.",
 "The gnasher is FAIR: 8 s standing still at 7.1 m from its post (just outside the 5.5 m chain) took zero damage; 8 s inside the chain took exactly one death. You can pace out its disc from safety.",
 "The sorter sweep bar PUSHES and does not kill, exactly as designed: 9 s standing in its arc = 0 deaths and 8.18 m of displacement.",
 "The GROUND POUND breaks crates properly when you are genuinely airborne: pounding the belt crate from 7.6 m up deactivated its collider and paid out coins (1 -> 4).",
 "The seventh-wall secret works: pounding beside the odd steel panel at [-14.2,8.2,29] deactivated it on the second pound, and the material clue (newer steel in old brick) is visible from the hall floor.",
 "The coolant channel plays well: the two 3.10 m plate -> vanishing grate -> plate hops land cleanly (miss distances 0.78 m and 0.05 m), crouch really does walk you down to the channel floor at 0.50, jump really does stroke you back up, and swimming west lands you standing on the pump jetty at 3.50 - the 'miss and you are downstream, not dead' design pays off exactly as written.",
 "Vanish grates cycle correctly and fail forward: standing on grate 1 when it went dropped the hero 14 m to the sorter floor with a hard landing and NO death.",
 "The trolley is boardable with a deliberate timed jump from catwalk A (2 of 3 attempts landed on its 20.75 deck).",
 "Checkpoints are unmistakable - the ringed glowing pad reads instantly - and the HUD coin / sigil / checkpoint tally is legible at every station.",
 "No console errors in any of the 12 runs; the only warning is the pre-existing '[Course ember-2] props.js had no entry for: girders, pipes, slabs, antennae, fins'.",
]

blocked = [
 "SWIM TUNNELS AND AIR POCKETS: my brief lists them for this area, but ember-2 has none. The course's only water is one open 'lake' volume, waters[0] p[-3,0.6,-14] s[90,4.2,17], surface 2.70 - an open trench with no roof, no submerged passage and no air pocket. Nothing to test. (Swim tunnels are azure-1 TIDEWELL TEMPLE.)",
 "The vanish grates' WARN telegraph: I could not confirm what a warning grate looks like on screen. Two attempts to catch the 0.5 s warn frame failed - the hazard exposes no on/warning/opacity field my probe could read, and the one time I teleported onto grate 1 it happened to be in its off phase so the hero fell through before the burst. The grates DO cycle (solid true/false sampled 16 times) and dropping through one is survivable; only the telegraph is unverified.",
 "Belt CARRY SPEED: I confirmed the belts move a standing hero (surface 'conveyor') but could not get a clean number. Every clear stretch of the z=3 belt is inside the gnasher's 5.5 m chain, the z=-1 belt has a crate and a bumbler patrol on it, and both are crossed by the x=0 belt, so three attempts were contaminated (one ended in a gnasher kill, one landed the hero on a bumbler, surface 'bounce'). Two rough reads gave ~1.1 m/s and ~5.1 m/s against an authored 5.0, which is not evidence either way.",
 "The WARDEN on the flywheel deck and the CANNON to the floating grate: outside my lane's list, and I did not reach them because the flywheel boarding (E2-6) consumed the BEAT 8 budget.",
 "Two of eleven lane runs showed the course clock advancing about 0.05 s per second of wall clock for ~1.5 s right after a __dev.respawn(), while the hero stayed frozen mid-'run'. It looked like a stall, not a game-logic freeze, and I could not reproduce it deliberately or rule out a headless-Chrome hitch, so I am NOT calling it a defect - but if anyone else sees a post-respawn hitch, the traces are in _raw_e2b.json under res.lanes.",
]

json.dump({"area": "ember-2 PISTON HALLS", "status": "complete", "played": played,
           "defects": defects, "worked": worked, "blocked": blocked},
          open(P, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("wrote", P, len(defects), "defects,", len(worked), "worked,", len(blocked), "blocked")
