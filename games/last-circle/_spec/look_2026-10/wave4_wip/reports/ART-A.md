# ART-A report (lane: shared clips P1.1 + Mixamo deaths P1.6 + ram-air canopy P2.6)

## TRIAGE (top)
Fresh run: no previous REPORT.md and no assets/chars/clips dir existed at start. Status when this line was written: IN PROGRESS (research done, building).

## Findings so far (all measured this session)
- The Blender retarget script that baked the shipped rifle_* clips is NOT in the repo (searched pipeline/, games/last-circle/_tools,
  git history incl. commit 62765464 "regenerate all 9 pistol/rifle/fall clips on the game rig" - the commit contains no script).
  I recovered the maths from the shipped data instead: shipped soldier_rifle_idle.glb == FBX idle.fbx retargeted as
  q_out(t) = rest_soldier[bone] * inverse(rest_fbx[bone]) * q_fbx(t) per bone ("rest-delta, rotations only against the game rig = soldier skin").
  Verified numerically: mean error 0.008 deg over all 52 bones (direct copy: 7.7 deg; right-delta: 2.9 deg). The shipped clips' hips
  translation is the constant soldier rest height 1.0179 m.
- FBX units: hips position in FBX is centimetres (97.6 at stand); death clips need metres.
- FBX2glTF.exe is installed (npm fbx2gltf) but I use three FBXLoader parse in node + my own GLB writer (no Blender needed for clips).

## Progress log
- [x] triage + plan reading + tool/art research
- [x] P1.1 built: assets/chars/clips/<17 clips>.glb via _tools/art_a_make_clips.mjs --quant. Total 716,336 B shared (per-skin originals: 1,765,868 B x 5 = 8,829,340 B).
      Lossless-in-effect: offline max rotation error 0.0033 deg (int16 normalised outputs), hips position exact. (--tol keyframe reduction rejected: up to 0.27 deg.)
- [x] P1.6 built: 7 death clips via _tools/art_a_make_deaths.mjs (rest-delta retarget recovered from the shipped data + hips cm->m x 0.97613).
      sizes 39-51 KB each (314,... B total). hips Y start 0.953 (crouch 0.453, walking 0.925) end 0.14-0.26, mean 0.46-0.62 (unit guard silent).
- [ ] browser gate _harness/new/art_a_clips.py : written, running next
- [ ] P2.6 canopy: not started
- [x] browser gate _harness/new/art_a_clips.py PASS (10/10, 58 s): 24 files; 17 clips x 5 skins bind (0 PropertyBinding warnings after the game's prune; athlete prunes 18/18/24 orphan tracks
      identically old vs new); processed track sets identical; track values <= 2.06e-05; bone world positions old vs new <= 0.07 mm; 7 deaths bind on all 5 skins; in metres (start hips 0.953, crouch 0.453,
      walking 0.925; mean 0.46-0.62 -> unit guard silent); end hips 0.14-0.26 (<= 0.6); 0 page/console errors, 0 failed requests.
- [x] visual: contact sheet scratch/death_sheet_soldier.png (7 deaths x 5 views + shipped 'death' reference row): all end on the ground, 7 different sprawls (looked at it).
      Soldier mesh sinks 8-17 cm into y=0 at the final pose (shipped death: 14.8 cm) - same magnitude as today; recommended corpse lift in PLAYER (see requests).
- [x] _tools/art_a_manifest.py -> assets/chars/clips/manifest.json (fall facts for the seeded pick)
- [x] P2.6 canopy built: _tools/art_a_canopy_build.py (Blender 5.1.2 headless) -> _tools/art_a_canopy_pack.mjs -> assets/props/canopy.glb 8,436 B (Draco) + canopy.json.
      9 cells (5 colour + 4 white gores), arched (tips drop 0.80 m), airfoil section, pillowed top skin, intake mouth + interior wall, tapered/swept tips, stabilisers,
      16 line segments to 4 risers; 1746 tris / 1282 verts, 4.555 m span x 1.80 m chord (dome: 3.4 m, ~250 tris). Gate art_a_canopy.py PASS 12/12; proof sheet viewed.
