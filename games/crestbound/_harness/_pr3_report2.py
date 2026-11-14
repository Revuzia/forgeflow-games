import json, os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_playreports", "rime-3.json")
d = json.load(open(p, encoding="utf-8"))
d["defects"] += [
 {
  "where": "rime-3 CHECKPOINT 4 'cp-bridge' at (-23.8, 8.00, -30.7), the far lip of the gorge - the checkpoint every player who crosses the rope bridge lands on.",
  "did": "Loaded the course straight to cp 3 in a fresh browser and then STOOD STILL with every key released, three separate runs.",
  "happened": "DEATH LOOP. The run already reported deaths=8 at load, before I pressed anything, and died again 3.6 s later while motionless. The death record at that instant: cause 'crush', and the gorge SKITTER was 2.9 m away in state 'swoop'. Two earlier runs read deaths=6 and deaths=6 at load and then died again while idle. The skitter's authored patrol is [-36,11,-14] -> [-22,14,-30] and its far endpoint (-22, -30) is 1.9 m from the checkpoint pad, so the bird's turnaround sits on top of the respawn point.",
  "should": "A checkpoint must be safe. Standing on it with no input must never kill, let alone kill 8 times before the player has touched a key. (Also: the death cause for a bird strike reads 'crush'.)",
  "png": "_shots/play_rime3/east3_01_cpbridge_death.png, _shots/play_rime3/east2_01_cpbridge_load.png"
 },
 {
  "where": "rime-3 BEAT 5, ROUTE A: the ice-shelf stair. Standing exactly on IS1's top (26.22, 15.20, -11.98), hopping for IS2 (26.4, top 16.80, -8.4).",
  "did": "Teleported onto IS1 (confirmed: y 15.20, grounded, idle), faced IS2, ran 330 ms and jumped, three times in a row.",
  "happened": "Zero height gained on any of the three attempts. The hero walked 1.7 m north, jammed at z -10.28 against IS2's south face, and every subsequent jump left him at exactly y 15.20: (26.60, 15.20, -10.28), (26.22, 15.20, -10.28), (25.13, 15.20, -10.28). IS2 is a 1.60 m step. I also tried the stair from its authored foot after walking the trodden path to (26, 15.20, -11.73): every hop LOST height (15.2 -> 7.68 -> 7.55 -> 9.36) as the 34-52 degree slope slid me east.",
  "should": "ROUTE A is the STATIC route to the shrine - 'every required surface is authored geometry or walkable ground'. If IS1 -> IS2 cannot be made, the whole east shoulder is impassable on ROUTE A.",
  "png": "_shots/play_rime3/east3_02_on_IS1.png, _shots/play_rime3/east3_03_stair_isolated.png, _shots/play_rime3/east2_03_stair_foot.png"
 },
 {
  "where": "rime-3 BEAT 5, ROUTE B: the east mill's gondola, authored boarding spot (30, -6), 'deck 12.65 over ground 11.83'.",
  "did": "Teleported to (30, 12.9, -6) and waited 15 s with no input for the gondola to come round.",
  "happened": "The hero never stood at the boarding spot: he settled at (34.22, 8.74, -6.07) on snow, 4.2 m east and 4.1 m BELOW the stated ground height. Fifteen seconds later he was still at y 8.74 - no gondola reached him, best y 8.74 against a terrace at 19.60.",
  "should": "ROUTE B is one of the three advertised ways to the crest. The boarding spot must be ground you can stand on, under the sweep the gondola actually passes through.",
  "png": "_shots/play_rime3/east3_04_mill_wait.png, _shots/play_rime3/east3_05_mill_after.png"
 },
 {
  "where": "rime-3 BEAT 6, the wall-kick chimney out of the crusher cave (floor 19.60/20.00 -> exit ledge 27.70, 8.10 m). This is the ONLY link ROUTE A has from the cave to the shrine stair.",
  "did": "Reactive kick loop: hold W into one wall, sample every ~170 ms, tap Space the instant the hero is wallslide/fall/jump next to it, and flip walls only after a kick actually fires. 16 presses.",
  "happened": "Five wall kicks DID fire, and the ladder still tops out at y 25.40 - 2.30 m short of the 27.70 ledge - then collapses: 25.40 -> 23.83 -> 23.17 -> 20.81 and back to running on the floor. A blind alternating version of the same test (8 presses, 6 kicks) peaked at 24.74. The crevasse chimney in the gorge behaves the same: floor 3.60, best y 9.53 against a 13.00 ledge, 3.47 m short, with 'slopeSlide' states inside the slot because the steep gorge terrain intrudes into it.",
  "should": "One jump plus four kicks is authored to clear 8.10 m. Measured net gain per successful kick is about 1.7 m and the hero loses more than that repositioning, so neither chimney climbs out. With the ice-shelf stair and the mill lift also failing, I could not reach the shrine from the terrace by any route the course offers.",
  "png": "_shots/play_rime3/east_12_cave_chimney.png, _shots/play_rime3/chim_01_crevasse_kicks.png"
 },
 {
  "where": "rime-3 BEAT 5/6, the terrace. The GNASHER post is at (21, 19.60, -2) with a 5.5 m chain; the 8-coin ring is authored at centre (19, 2) radius 4.2.",
  "did": "Walked the coin ring from cp-terrace, and separately walked cp-terrace -> cave mouth, three times.",
  "happened": "Killed every time, and never once reached the cave. Deaths at (20.34, 19.6, 1.58) [3.63 m from the post], (21.93, 19.6, 1.58) [3.60 m] and (23.07, 19.6, 2.09) [4.60 m]. Computing the ring: three of its eight coins sit 4.56 m, 2.01 m and 1.41 m from the gnasher's post, i.e. two of them are practically ON the post. The coin ring cannot be collected.",
  "should": "A chained critter's disc is meant to be paced out and dodged. It should not contain two of the eight coins of a collectible ring, and the walk from cp-terrace to the cave mouth should be survivable at least sometimes.",
  "png": "_shots/play_rime3/east2_05_gnashed_ring_90.png, _shots/play_rime3/east_09_gnasher.png"
 },
 {
  "where": "rime-3 BEAT 4, the north flank ice slabs: authored (-8.0, 8.20, -36.0) top 8.40 and (8.0, 8.90, -34.0) top 9.10.",
  "did": "Dropped the hero from 6 m above each slab and read where he landed and what surface he reported.",
  "happened": "West slab: landed y 8.40, surface 'ice' - correct. EAST slab: landed y 9.56 on surface 'snow', 0.46 m ABOVE the slab's top. It is buried in the heightfield and does nothing; the ice-slab beat is half missing.",
  "should": "Both slabs should be the surface the player is standing on.",
  "png": "_shots/play_rime3/east2_02_ice_slabs.png"
 },
 {
  "where": "rime-3 BEAT 7, the shrine cap. Walking off the marble platform in any direction.",
  "did": "From (4.40, 35.58, -7.78) walked 4.6 m toward the warden at (0, -9). From (2.0, 35.6, 6.0) walked 2 m toward the wing hat at (2.0, 36.30, 4.0). Also teleported to (-4.0, 35.4, -9.0) to hop the ice pinnacle.",
  "did_more": "",
  "happened": "Every one of them threw me off the mountain. Warden walk ended at (4.79, 17.85, -24.49) - 17.7 m LOWER and 17 m north. Wing-hat walk ended at (4.89, 16.96, 17.66) - 18.6 m lower and 12 m south. The pinnacle teleport killed me outright (deaths 0 -> 1 -> 2). The cap is documented as 'the flattest 14 m of the cap (EXACTLY 35.20)'.",
  "should": "The cap carries the open crest, the wing hat, sigil 8 and the boss arena. It needs a plateau you can walk on.",
  "png": "_shots/play_rime3/shrine_08_cap.png, _shots/play_rime3/shrine_10_warden_engage.png, _shots/play_rime3/shrine_16_wing_hat.png"
 },
 {
  "where": "rime-3 BEAT 7, THE WARDEN at (0, 35.20, -9), arena c=[0,-4] r=7.0, hp 3.",
  "did": "Loaded at cp-gate, walked onto the cap, moved into the arena, and ran six rounds of jump-then-pound within a few metres of it.",
  "happened": "The warden never left state 'idle'/'dormant' and hp stayed 3 for the whole session. It never charged, never fired a shockwave, and never reacted to being pounded next to. The course boss is inert.",
  "should": "'Jump the wave, sidestep the charge, pound its back' - none of that happened.",
  "png": "_shots/play_rime3/shrine_10_warden_engage.png, _shots/play_rime3/shrine_11_warden_fight.png, _shots/play_rime3/shrine_08_cap.png"
 },
 {
  "where": "rime-3 BEAT 7, the stair viaduct, flight P2 (landing 31.10 -> P2 top 35.00 -> gate landing 35.10).",
  "did": "Walked DOWN the viaduct from the gate landing to the chimney ledge (fine), then walked back UP the way a player would.",
  "happened": "Going up, the climb STUCK at (10.41, 33.80, -6.38) - 1.2 m below P2's top and 2.18 m from the gate landing - and would not advance. Going down the same flight worked. The last flight of the shrine stair is one-way.",
  "should": "The viaduct is the final approach to the shrine gate; it has to be climbable.",
  "png": "_shots/play_rime3/shrine_07_viaduct_climb_end.png"
 },
 {
  "where": "rime-3, the ice chamber behind the frozen fall, hero at (-23.60, 0.15, -17.37).",
  "did": "Hopped the lip into the chamber and walked in.",
  "happened": "The camera snapped to a hard top-down shot of the top of Nim's head at very close range - you cannot see ahead at all, and there is no way to look forward from inside the chamber. This is the owner's P10 ('camera gets buggy and hard to look around when inside a structure') reproduced exactly, in the one interior on this course.",
  "should": "Interiors need a camera that stays behind the hero or pulls to a usable angle.",
  "png": "_shots/play_rime3/chim_06_chamber.png"
 },
 {
  "where": "rime-3, the crest pedestals - at the shrine (0, 36.00, -4) as well as the two at base camp.",
  "did": "Claimed the open crest and looked at the plinth in the CREST CLAIMED frame.",
  "happened": "The shrine pedestal renders as a dark olive-black disc standing on thin black legs with a black web of shadow under it - the same broken-looking object as the two at base camp, and here it is on a white marble platform where it is impossible to miss.",
  "should": "Consistent pale stone/marble with a soft contact shadow.",
  "png": "_shots/play_rime3/shrine_13_plinth.png, _shots/play_rime3/frame_02_cpcamp_side.png"
 },
]
d["worked"] += [
 "THE OPEN CREST WORKS: standing on the shrine plinth claimed it - the card read 'CREST CLAIMED - THE CREST OF THE STORM SHRINE - 1 OF 7' and the game went to state 'clear'.",
 "Sigil 5 (behind the frozen fall) collects on contact - the sigil counter went 0 -> 1 when a hop put me on the chamber floor.",
 "Walking DOWN the whole stair viaduct works cleanly: gate landing 35.10 -> P2 -> landing P 31.10 -> P1 -> chimney ledge 27.70, picking up the viaduct coins on the way.",
 "The prayer wheels on the cap are safe: walking into one at (4.6, 36.1, -8.6) shoved and did not kill (deaths 0 -> 0).",
 "The north-flank ice wheel (rotor at -3.0, 9.60, -37.4) shoves rather than executes: standing in its sweep for 7 s pushed me 4 m clear with no death.",
 "The WEST ice slab on the north flank behaves: dropped onto it I land at exactly 8.40 with surface 'ice', and standing still on it drifts 0.00 m in 6 s.",
 "Checkpoint respawn is fast and exact everywhere I died: 445 ms, and always onto the authored pad.",
 "The three camp text boards and THE SHRINE GATE board are legible; the failure is specific to the west-face and gorge plates.",
]
json.dump(d, open(p, "w", encoding="utf-8"), indent=1)
print("defects:", len(d["defects"]), "worked:", len(d["worked"]))
