import json, os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_playreports", "rime-3.json")
d = json.load(open(p, encoding="utf-8"))

# --- correction: the earlier "the cap has no walkable plateau" claim was too strong.
for x in d["defects"]:
    if x["where"].startswith("rime-3 BEAT 7, the shrine cap."):
        x["happened"] = ("Two walks off the marble platform threw me off the mountain: from (4.40, 35.58, -7.78) "
                         "toward the warden I ended at (4.79, 17.85, -24.49) - 17.7 m lower and 17 m north; from "
                         "(2.0, 35.6, 6.0) toward the wing hat at (2.0, 36.30, 4.0) I ended at (4.89, 16.96, 17.66) "
                         "- 18.6 m lower and 12 m south. A later drop-grid maps why: the cap is genuinely flat at "
                         "35.20 over roughly x -3..+3, z -4..-11, but it ENDS abruptly - at z -12 all four sample "
                         "columns fall away (landed 17.47 / 12.35 / 15.17 / 16.15), x -6 falls away from z -8 south, "
                         "and x +6 falls away from z -10. The WARDEN's arena is authored c=[0,-4] r=7.0, i.e. x -7..+7 "
                         "and z +3..-11, so its west and east thirds hang over the cliff, and the wing hat at "
                         "(2.0, 36.30, 4.0) is past the southern lip.")
        x["should"] = ("The boss arena and the wing hat should sit inside ground you can stand on. As it is, "
                       "sidestepping a charge toward the arena rim is a death, and the second wing hat cannot be picked up.")
        x["png"] = "_shots/play_rime3/final_02_cap_map.png, _shots/play_rime3/shrine_08_cap.png, _shots/play_rime3/shrine_16_wing_hat.png"
    if x["where"].startswith("rime-3 BEAT 7, THE WARDEN"):
        x["happened"] = ("CORRECTED after a second pass. The warden DOES wake: standing at (0, 36.5, -6) inside its "
                         "arena flipped it from 'dormant' to 'stomp' within 1 s and it slid to (0, 35.2, -6). But it "
                         "went straight back to dormant and hp stayed 3 through four rounds of walk-in + jump + pound "
                         "beside it, so I never landed a hit and never saw a charge or a shockwave. My first session "
                         "reported it inert - that reading was taken while I was 18 m BELOW the cap after sliding off, "
                         "so it is withdrawn.")
        x["should"] = ("'Jump the wave, sidestep the charge, pound its back'. It wakes; I could not damage it in four "
                       "attempts and it re-slept while I was standing 3 m away.")
d["worked"] = [w for w in d["worked"] if "SHRINE GATE board" not in w]
d["worked"].append("The three camp text boards are legible from the spawn; the unreadable-black-plate failure is specific to the west-face and gorge plates.")

d["defects"] += [
 {
  "where": "rime-3 BEAT 6, THE CRUSHER CAVE. The 10.6 x 4.8 m chamber along z = -2, from the terrace mouth at x 25 to the chimney at x 14. Floor authored 'EXACTLY 19.60'.",
  "did": "Dropped the hero from y 21.5 at twelve x positions along z = -2 and recorded where he came to rest.",
  "happened": "THERE IS NO FLOOR. x = 25, 24, 23, 22, 21, 20, 19, 18 and 17 ALL fell out of the world and respawned at cp-terrace (16.50, 19.60, 6.50) - nine of nine. A direct teleport to (21, 20, -2) read (21.00, -14.88, -2.00) with vy -54.63 m/s in open sky below the mountain. Only x = 16, 15 and 14 have ground, at y 20.00 (the authored ice block and the chimney floor). Every hammer (x 23.0 / 20.5 / 18.0) and both beam tripwires (x 21.8 / 19.2) stand over a hole.",
  "should": "The cave is a required beat on ROUTE A and its floor is supposed to be the terrace flat at 19.60. Walking in from the terrace should not drop the player off the map.",
  "png": "_shots/play_rime3/final_01_cave_floor_map.png, _shots/play_rime3/east4_02_cave_under_hammer.png"
 },
 {
  "where": "rime-3 BEAT 5, the mechanical root of the ice-shelf stair failure. Standing on IS1 (26.2, 15.20, -12.0).",
  "did": "Three plain standing jumps from a standstill on IS1, sampling y every 110 ms.",
  "happened": "Apex rise measured 1.42 m, 1.30 m and 1.48 m. Every riser on the ice-shelf stair is 1.60 m (15.20 -> 16.80 -> 18.40). The jump is 12-19 % short of the step, so from a standstill the stair is physically unclimbable; with a run-up you hit IS2's face and stop dead at z -10.28. The course text asserts 'single-safe at +1.6 is 3.28'.",
  "should": "Either the risers come down to something the jump clears, or the jump reaches the height the course was authored against.",
  "png": "_shots/play_rime3/east4_01_is1_early_jump.png, _shots/play_rime3/east3_02_on_IS1.png"
 },
 {
  "where": "rime-3 BEAT 5/6, the GNASHER at the crusher-cave mouth (post 21, 19.60, -2; chain 5.5 m; contract says it 'telegraphs with a 0.5 s crouch before every lunge').",
  "did": "Walked slowly east from (16.23, 19.99, -2.01) toward the post, sampling the gnasher's own state and its distance every 150 ms.",
  "happened": "t=0.0 s state 'idle' at 7.73 m; t=0.1 s state 'telegraph' at 6.65 m; t=0.3 s still 'telegraph' at 5.80 m; t=0.4 s still 'telegraph' at 5.00 m - and I was killed on that frame. The bite lands 0.3 s into a telegraph that is supposed to run 0.5 s before the lunge, so the tell never finishes before the kill.",
  "should": "The telegraph has to complete before the bite can connect, or the 0.5 s promise is worthless. This is what made the terrace unpassable for me on four separate runs.",
  "png": "_shots/play_rime3/east4_05_gnasher_bite.png"
 },
 {
  "where": "rime-3 BEAT 7, the ground beside the shrine gate landing. Teleport target (13.0, 35.4, -4.2), 2.6 m east of the gate landing platform (10.4, top 35.10, -4.2).",
  "did": "Tried to stand 2.6 m east of the gate landing to photograph the SHRINE GATE board.",
  "happened": "The hero fell to (13.00, 28.26, -4.20) and came to rest on the very corner tip of a stair flight hanging in open sky. The resulting frame shows the viaduct as three disconnected pieces of staircase and a dark slab floating over the mountain with nothing joining them - which is the owner's P6 'the images have odd stairs but i cant reach the main stairs' on this course.",
  "should": "The gate landing needs ground beside it, and the viaduct should read as one connected structure.",
  "png": "_shots/play_rime3/shrine_02_gate_sign.png"
 },
 {
  "where": "rime-3, the snow, at several stations (e.g. (24.24, 13.37, -17.33) on the east flank, and beside the base-camp pedestals).",
  "did": "Looked at the ground while standing on it.",
  "happened": "Blown-out white circular hot spots sit on the snow with no visible source - a 1.5 m fully-saturated patch a metre from the hero at (24.24, -17.33), and similar blue-white blobs around the camp pedestals. Combined with the dark/light terrain split they make the snow read as a texture problem rather than a surface.",
  "should": "Point-light falloff on snow should not clip to pure white.",
  "png": "_shots/play_rime3/final_04_viaduct_wide.png, _shots/play_rime3/frame_02_cpcamp_side.png"
 },
]
d["worked"] += [
 "The shrine cap IS a real plateau in its core: drops at (-3,-4), (+3,-4), (-6,-4), (+6,-4), (-3,-2), (-6,-2), (0,-2), (0,-8) all settle at exactly 35.20 with 0.00 m of slide.",
 "The crusher cave's own chimney floor and the authored ice block at x 14-16 are solid at y 20.00.",
 "The gnasher's state machine does run an 'idle' -> 'telegraph' cycle and its distance readout is sane - the tell exists, it is just too short to survive.",
 "The wall kick DOES fire and gains height when the hero is genuinely pressed into a wall (5 kicks in 16 presses in the cave chimney, 2 in 8 in the crevasse) - the failure is the ladder's net gain, not the move.",
]
d["blocked"] += [
 "The BLIZZARD RUN race (90 s, camp -> shrine gate) - not attempted; the route it grades is broken at the terrace, so a timing run would only re-measure that.",
 "The 14-ring wing overlay and both wing hats - never got the power: the cap hat at (2.0, 36.30, 4.0) is past the cap's southern lip and the terrace hat is on the far side of the gnasher.",
 "Sigils 1, 2, 3, 4, 6, 7 and 8 - only sigil 5 (behind the frozen fall) was collected. 1 and 2 are off the west-face shelf chain I could not land on, 3 is on the mill gallery (ROUTE B does not board), 6 is past the crushers in the floorless cave, 7 and 8 are off the cap lip.",
 "The vanish-ice line and the two swinging planks over the gorge - I stood beside tile 1 and was killed by the skitter before a cycle completed, and did not get back to them.",
 "Frame rate: every number in these shots was taken with 93 Chrome processes live on the box (fps 20-34, p99 80-700 ms). Not usable as perf evidence either way.",
]
json.dump(d, open(p, "w", encoding="utf-8"), indent=1)
print("defects:", len(d["defects"]), "worked:", len(d["worked"]), "blocked:", len(d["blocked"]))
