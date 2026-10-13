## Animation clips (assets/chars/clips) and the ram-air canopy (assets/props/canopy.glb)

Merge this block into `CREDITS.md` (it is not referenced by the game).

- Shared character clips `assets/chars/clips/<clip>.glb` (idle, walk, run, death, hit, dance, cheer, jump, swim, crouch,
  rifle_idle, rifle_walk, rifle_run, rifle_reload, rifle_crouch): the same clips the five per-skin
  `assets/chars/meshy/<skin>_<clip>.glb` files carry, de-duplicated into one file per clip (bone-translation / scale tracks removed,
  rotations stored as 16-bit normalised values; measured error 0.0033 degrees). No new source material; the licence is unchanged.
- Death clips `death_front`, `death_front_head`, `death_back`, `death_back_head`, `death_right`, `death_crouch_head`, `death_walking`:
  Adobe Mixamo animations ("death from the front", "death from front headshot", "death from the back", "death from back headshot",
  "death from right", "death crouching headshot front" from the Rifle 8-Way Locomotion Pack, and "walking to dying" from the Shooter Pack).
  Mixamo animations are royalty-free for use in games, including commercial ones (https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html).
  Only the baked, retargeted clips ship (rotations retargeted onto the Last Circle rig, hips converted to metres); the original FBX files are not
  redistributed.
- Ram-air canopy `assets/props/canopy.glb` / `canopy.json`: original asset authored for this game (parametric model built in Blender 5.1 by
  `_tools/art_a_canopy_build.py`); no third-party source. Draco-compressed with glTF-Transform (MIT).
