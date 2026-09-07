import json, os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_playreports", "rime-3.json")
d = json.load(open(p, encoding="utf-8"))
d["defects"] += [
 {
  "where": "rime-3 BEAT 2, the west face. The 'LEAN WEST - THE LEDGES ARE CUT WIDE FOR IT' text plate at (-25.2, 5.2, 29.6), on the walking line between cp-westface and shelf A.",
  "did": "Stood on cp-westface and looked at it (12 m), then walked to (-25.4, 3.92, 26.4) and looked straight on from 3.7 m.",
  "happened": "It renders as a SOLID BLACK PANEL about 4.5 m wide and 3 m tall. Not one letter is readable at any distance or angle. All-hits raycast through it names 'Mesh (material cb.wood.rime) < detail 2,4 < course:rime-3' at (-25.0, 5.6, 29.6) - the authored text object. It is also tall enough that on the approach it hides Nim completely: only the top of his head shows above it.",
  "should": "This is the sign that teaches the course's one new verb. It should read like the camp boards (cream plate, dark blue letters) and it should not stand as an opaque wall across the route.",
  "png": "_shots/play_rime3/look2_01_frame_for_ray.png, _shots/play_rime3/look_03_sign_leanwest_close.png, _shots/play_rime3/west_04_sign_leanwest.png"
 },
 {
  "where": "rime-3 BEAT 3, the gorge lip, standing motionless at (-31.87, 7.22, -15.11) on snow (surface reported 'snow', y 7.22 vs vanish tile top 6.90 - I was NOT on the tile).",
  "did": "Teleported there, released every key, sampled state every 600 ms without touching an input. Repeated the same test twice more in a later session.",
  "happened": "First run: deaths went 0 -> 1 about 2.5 s in and I was rewound to cp-gorge with nothing pressed. Two later runs at the same spot survived 8 s each. So it is INTERMITTENT, not deterministic. The only things that reach that point are the gorge skitter (path [-36,11,-14] -> [-22,14,-30], speed 4.0) and the swinging plank mover at (-32.1, 6.80, -17.0).",
  "should": "Standing still on solid ground beside an OPTIONAL hazard line should never kill. If the skitter swoops that far down it needs a telegraph.",
  "png": "_shots/play_rime3/gorge_06_vanish_tile1.png"
 },
 {
  "where": "rime-3 ROUTE C, the gorge floor. Ice shelf top -0.80 at (-27.6, -19.0) -> the frozen-fall chamber floor 0.10 at (-26.7, -16.5).",
  "did": "Walked north toward the frozen fall with W held, twice, then tried short hops.",
  "happened": "Walking stops DEAD at (-27.38, -0.80, -18.48): 0.5 m of travel on the first attempt and 0.00 m on the second, hero pinned against a near-vertical dark wall with no feedback of any kind. A 0.90 m lip is what blocks it - a short hop clears it and lands on the chamber floor at y 0.10 (and on one hop the sigil counter went 0 -> 1, so sigil 5 is right there). Nothing in the frame tells a player the wall in front of them is a 0.9 m step.",
  "should": "Either the lip is low enough to walk up, or the ice shelf reads as a step. Right now the route the course advertises ('falling in is a way down') dead-ends on a wall.",
  "png": "_shots/play_rime3/gorge_09_frozen_fall.png, _shots/play_rime3/gorge2_03_frozenfall_blocked.png"
 },
 {
  "where": "rime-3 BEAT 3, the rope bridge, standing at the mouth of span A (-36.59, 6.60, -14.71).",
  "did": "Walked to the bridge mouth and looked along it.",
  "happened": "The bridge reads as a dark skeleton - two posts, a rail, a couple of thin dark slats and some rope lines - with the snow visible straight through it; there is barely any deck. The 13 m chasm it crosses is also not legible from the mouth: the terrain reads as one continuous white swell with a faint blue shadow.",
  "should": "The set piece of the course should read as a plank bridge over a visible chasm.",
  "png": "_shots/play_rime3/gorge_03_bridge_mouth.png"
 },
 {
  "where": "rime-3 terrain, everywhere I walked (camp, west face, gorge lip).",
  "did": "Looked at the snow from eye height at several stations and raycast the light and dark halves.",
  "happened": "Two recurring artefacts. (1) Large regions of the mountain render near-black brown with heavy mottled noise and a HARD boundary against white snow; the raycast confirms both halves are the same mesh and material ('terrain.1,2', material 'terrain_snow'), so one surface splits into a lit and an unlit half on a hard line. (2) Dead-straight bright hairlines run across the snow the full width of the frame - across look_01 at eye level and diagonally in the bridge-mouth frame.",
  "should": "One snow surface should not read as two, and there should be no bright seams across it. Same family as the owner's P7.",
  "png": "_shots/play_rime3/look_01_westface_shadows_on.png, _shots/play_rime3/gorge_03_bridge_mouth.png"
 },
 {
  "where": "rime-3 BEAT 2, shelf A (-29.0, top 4.15, 26.0) -> shelf B (-32.6, top 5.20, 20.0), in the 9-11 m/s2 gale.",
  "did": "Stood on shelf A, faced B, ran up and jumped twice (0.8 s and 1.4 s run-ups), holding forward through the air and re-aiming every 200 ms.",
  "happened": "Both attempts missed. Run 1 took off already blown to (-33.98, 3.28, 22.38) and landed on snow at (-34.92, 2.87, 22.79), 3.63 m from B. Run 2 landed at (-34.98, 3.50, 20.20), 2.39 m from B's centre and 1.70 m BELOW its top. Measured push: walking due north from (-28, 26) with W held and no correction for 5 s ended at (-37.52, 6.35, 11.40) - 9.5 m of lateral drift, about 1.9 m/s.",
  "should": "If the shelf chain is BEAT 2's authored line, a run-and-jump aimed at the next shelf should land on it. Nothing is lost when you miss (the snow catches you), and I then walked the entire west face from (-35, 20) down to the gorge lip (-37.2, -1.4) with no jump at all - so the four carved shelves are decorative and the beat can be walked straight past.",
  "png": "_shots/play_rime3/west_07_shelfA.png, _shots/play_rime3/west_08_after_A_to_B.png"
 },
]
d["worked"] += [
 "The wind is honest: standing still inside the strongest volume for 8 s drifted me 0.14 m total, so the gale never steals a stationary player; held W across it drifts about 1.9 m/s, which is legible and correctable.",
 "Death and rewind: dying at the gorge respawned me EXACTLY on the cp-gorge pad (-36.01, 6.63, -9.00) with the course clock rewound 98 s -> 16 s, in 445 ms.",
 "Checkpoints arm on contact and the HUD toast reads clearly (CHECKPOINT 1/5 at cp-westface, 2/5 at cp-gorge).",
 "Coins pick up on contact along the trodden track - 11 between the camp and cp-westface without aiming at any of them.",
 "The whole west face is walkable on foot; the 28-35 degree slope never turned into an uncontrolled slide.",
 "The BLIZZARD PEAK camp board is large and completely legible from the spawn, wrapped onto five lines.",
]
d["blocked"] += [
 "Renderer crashes: with 93 Chrome processes live on this box (other lanes' browser gates plus the owner's own Chrome) the headless page was killed mid-run four times. Every phase now retries a fresh browser 3x (run() in _harness/_play_rime3.py). This is contention, not a game defect - but the fps 20-23 readings in these shots are NOT usable as perf evidence.",
]
json.dump(d, open(p, "w", encoding="utf-8"), indent=1)
print("defects:", len(d["defects"]), "worked:", len(d["worked"]), "blocked:", len(d["blocked"]))
