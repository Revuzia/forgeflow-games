# credits_player.md - lane player (parity Waves P2+P3), new asset files, all $0

Baked with F:/lc_p23/player/tools/bake_p23.mjs (a copy of P1-F `_tools/art_a_make_loco8.mjs`: same rest-delta retarget onto the
soldier GameRig, same container; only the CLIPS list differs). Source library: the local Mixamo download
F:/games/forgeflow-games-assets/_downloaded/mixamo/animations/ (Adobe Mixamo; royalty-free for use in games; only the baked
clip-only GLBs ship, never the FBX). Licence: Mixamo terms (https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html):
free, royalty-free for personal, commercial and non-profit projects incl. games. Mixamo-only rule respected (no Meshy).

| file (assets/chars/clips/) | source FBX (Mixamo pack/clip) | use |
|---|---|---|
| rifle_idle_g.glb | Rifle_8-Way_Locomotion_Pack/idle.fbx | combat idle, feet-down hips (the shipped rifle_idle floats +0.065 m) |
| rifle_walk_g.glb | Rifle_8-Way_Locomotion_Pack/walk forward.fbx | combat walk forward (blends with the P1-F strafes) |
| rifle_run_g.glb | Rifle_8-Way_Locomotion_Pack/run forward.fbx | combat run forward |
| rifle_sprint_g.glb | Rifle_8-Way_Locomotion_Pack/sprint forward.fbx | sprint forward (root 7.08 m/s: 1.13x at the 8.0 m/s sprint) |
| rifle_crouch_g.glb | Rifle_8-Way_Locomotion_Pack/walk crouching forward.fbx | crouch walk forward (rifle + pistol legs) |
| rifle_sprint_left.glb | Rifle_8-Way_Locomotion_Pack/sprint left.fbx | hip-fire combat strafe left at 6.0 m/s (LC-10; the run strafes skated 1.5-1.7x) |
| rifle_sprint_right.glb | Rifle_8-Way_Locomotion_Pack/sprint right.fbx | hip-fire combat strafe right at 6.0 m/s (LC-10) |
| turn_left_90.glb | Rifle_8-Way_Locomotion_Pack/turn 90 left.fbx | turn-in-place (LC-64) |
| turn_right_90.glb | Rifle_8-Way_Locomotion_Pack/turn 90 right.fbx | turn-in-place (LC-64) |
| slide.glb (P23 fix round) | Soccer_Game_Pack/soccer tackle (2).fbx (hips, legs, spine; 0.07-1.47 s) + Rifle_8-Way_Locomotion_Pack/walk crouching forward.fbx (shoulders, arms, hands, neck, head) | LC-21 slide: no Mixamo rifle slide exists in the local library; the sliding tackle is the closest Mixamo clip. Composite of the two Mixamo clips (no hand-keyed poses): the spine re-aimed so the chest holds the crouch walk's orientation pitched back 20 deg (the tackle turns ~100 deg sideways and lies back 60-70 deg). Tool: F:/lc_p23/player/fix/tools/bake_slide.mjs |

Measurements per clip (root speed, hips range, bytes): assets/chars/clips/manifest_p23.json (sidecar, not read by the runtime).

Source URL: https://www.mixamo.com (Adobe Mixamo animation library, downloaded locally to the path above).
Licence URL: https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html (royalty-free for games; only the baked clips are distributed).
Cost: $0. No CC0 / third-party files were added by lane player.
