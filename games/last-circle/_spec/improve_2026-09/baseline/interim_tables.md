runs: 4 (isla_viva r1, ashgrid r1, deepwood r1, ashgrid r2)

### Boot (ms from navigation start; median [min-max] over 4 runs)

| | first paint | __FFG3D__ (kernel up) | __LC__ (menu built) | splash removed | CDN last byte | local last byte | long tasks n / total ms / max | resources / MB |
|---|---|---|---|---|---|---|---|---|
| cold | 7836 [2100-39804] | 32897 [13985-42028] | 27064 [12250-40265] | 33308 [14298-42500] | 3544 [797-4262] | 29136 [12261-40295] | 3 [2-3] / 10937 [7540-20189] / 10466 [6263-19840] | 44 [44-45] / 3.50 [3.50-4.19] |
| warm | 5038 [944-12292] | 9244 [2720-52806] | 5303 [2128-25441] | 10238 [3074-53277] | 3836 [221-9199] | 5682 [2069-25377] | 4 [2-6] / 6463 [1386-44225] / 5924 [1012-43469] | 43 [43-44] / 0.00 [0.00-0.00] |

### Box control (blank WebGL2 clear page, same browser + flags, measured right before each run)

| map | frames | p50 ms | p95 ms | p99 ms | max ms | >33ms |
|---|---|---|---|---|---|---|
| isla_viva | 882 | 0.50 | 1.40 | 3.5 | 929 | 0.2% |
| ashgrid | 1988 [1161-2814] | 0.35 [0.30-0.40] | 0.85 [0.70-1.00] | 1.9 [1.4-2.4] | 424 [4-844] | 0.1 [0.0-0.1]% |
| deepwood | 769 | 0.40 | 1.10 | 2.9 | 15 | 0.0% |

### Match load timeline (ms after startMatch(); first poll sample where the condition held)

| map | main thread first free (first poll after start) | map built (W.map new) | 50 mixers (models loaded) | resolved (lobby shown) | programs at resolve | textures | geometries |
|---|---|---|---|---|---|---|---|
| isla_viva | 7188 | 21738 | 36307 | 36355 | 79 | 42 | 326 |
| ashgrid | 2772 [1370-4175] | 73438 [55947-90930] | 123998 [97349-150648] | 124058 [97393-150724] | 72 [72-72] | 46 [44-48] | 319 [319-319] |
| deepwood | 13833 | 86844 | 112342 | 112396 | 73 | 42 | 325 |

### Match load / lobby (per map)

| map | startMatch() ms (menu -> lobby shown) | Enter -> drop s | land fastForward wall s | endgame over? | endgame wall s | PLAY AGAIN -> lobby s |
|---|---|---|---|---|---|---|
| isla_viva | 36355 | 12.85 | 18.0 | True | 145 | 81.7 |
| ashgrid | 124058 [97393-150724] | 15.17 [5.08-25.25] | 5.6 [4.3-6.8] | True/True | 179 [167-191] | 43.4 [37.1-49.7] |
| deepwood | 112396 | 4.28 | 35.2 | True | 205 | n/a |

### Window: menu (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 1 | 28.4 | 35.2 | 47.1 | 48.1 | 48 | 50.0% | 12.7 / 13.5 (0.2 / 12.5) | 283 (61 / 269) | 92k | 19 | 206 | 16 | 24 | 1.00, [1600, 900] | 100 / 93 |
| ashgrid | 2 | 9.8 [6.4-13.1] | 10.6 [8.7-12.4] | 177.3 [29.1-325.5] | 2179.0 [1762.3-2595.7] | 3084 [2847-3320] | 5.6 [3.6-7.7]% | 7.3 [5.6-9.1] / 2176.4 [1759.0-2593.8] (0.2 [0.2-0.3] / 7.0 [5.3-8.8]) | 290 [283-297] (61 [61-61] / 276 [269-283]) | 92 [92-93]k | 19 [19-19] | 206 [205-208] | 16 [16-16] | 33 [32-34] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 101 [94-108] |
| deepwood | 1 | n/a | n/a | n/a | n/a | n/a | n/a% | n/a / n/a (n/a / n/a) | n/a (n/a / n/a) | n/ak | 19 | 208 | 16 | 32 | 1.00, [1600, 900] | 100 / 94 |

### Window: drop (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 1 | 25.4 | 14.1 | 33.3 | 807.9 | 3101 | 5.1% | 12.9 / 800.8 (2.9 / 9.4) | 87 (34 / 73) | 2208k | 83 | 348 | 55 | 139 | 1.00, [1600, 900] | 100 / 98 |
| ashgrid | 2 | 11.2 [5.8-16.7] | 29.5 [29.1-29.9] | 96.8 [82.5-111.2] | 1998.7 [714.8-3282.6] | 3102 [1251-4953] | 33.2 [29.5-36.8]% | 24.7 [23.9-25.5] / 1999.6 [716.4-3282.7] (4.5 [4.4-4.7] / 19.6 [18.6-20.7]) | 262 [257-266] (86 [86-87] / 248 [243-252]) | 10991 [10962-11020]k | 76 [76-76] | 374 [368-380] | 72 [69-76] | 161 [154-168] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 94 [92-97] |
| deepwood | 1 | 39.3 | 25.1 | 36.6 | 39.4 | 41 | 17.5% | 20.6 / 30.0 (4.4 / 15.8) | 118 (64 / 104) | 7955k | 76 | 353 | 61 | 152 | 1.00, [1600, 900] | 100 / 99 |

### Window: ground (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 1 | 5.6 | 27.4 | 648.5 | 2729.8 | 7324 | 26.6% | 26.1 / 2270.4 (9.5 / 15.9) | 307 (64 / 293) | 9452k | 86 | 435 | 96 | 142 | 1.00, [1600, 900] | 100 / 101 |
| ashgrid | 2 | 10.6 [8.2-12.9] | 24.1 [21.2-27.0] | 53.4 [51.8-55.0] | 1964.4 [1094.7-2834.1] | 4844 [4596-5092] | 18.5 [18.3-18.8]% | 22.8 [19.9-25.7] / 1966.6 [1098.1-2835.0] (6.3 [5.8-6.9] / 16.2 [13.8-18.6]) | 280 [268-292] (78 [77-79] / 266 [254-278]) | 8206 [8163-8249]k | 78 [78-78] | 428 [417-438] | 96 [96-97] | 152 [142-163] | 1.00 [1.00-1.00], [1600, 900] | 100 [100-100] / 98 [95-100] |
| deepwood | 1 | 4.6 | 40.1 | 873.9 | 4656.4 | 4662 | 85.5% | 36.8 / 4652.9 (10.9 / 24.4) | 374 (40 / 360) | 14999k | 82 | 413 | 111 | 163 | 1.00, [1600, 900] | 100 / 97 |

### Window: endgame_realframes (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 1 | 30.5 | 16.6 | 82.1 | 498.2 | 1537 | 10.8% | 14.4 / 4088.3 (3.2 / 10.2) | 247 (63 / 233) | 3945k | 86 | 479 | 133 | 152 | 1.00, [1600, 900] | n/a / n/a |
| ashgrid | 2 | 26.6 [25.5-27.7] | 19.3 [17.5-21.1] | 65.4 [62.2-68.6] | 477.6 [468.6-486.5] | 1403 [1236-1570] | 13.8 [12.1-15.5]% | 17.5 [16.1-18.9] / 4491.2 [3564.4-5418.0] (4.3 [3.9-4.8] / 12.7 [11.5-13.8]) | 261 [254-268] (78 [76-79] / 247 [240-254]) | 5334 [5312-5357]k | 78 [78-78] | 500 [496-503] | 116 [114-118] | 146 [144-147] | 1.00 [1.00-1.00], [1600, 900] | n/a / n/a |
| deepwood | 1 | 21.2 | 25.4 | 106.3 | 517.2 | 1815 | 25.0% | 21.2 / 6770.4 (5.4 / 14.4) | 197 (45 / 183) | 3760k | 82 | 461 | 138 | 146 | 1.00, [1600, 900] | n/a / n/a |

### Window: again_drop (median [min-max] across repeats)

| map | n | fps | p50 ms | p95 ms | p99 ms | max ms | >33ms | CPU frame p50/p99 ms (upd p50 / render p50) | draw calls (shadow / scene) | tris | programs | geoms | textures | heap MB | DPR, buffer | box CPU% / other-GPU% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| isla_viva | 1 | 8.4 | 35.9 | 415.5 | 1117.6 | 1293 | 62.5% | 33.5 / 1119.7 (5.0 / 22.9) | 268 (31 / 254) | 2543k | 85 | 430 | 157 | 150 | 1.00, [1600, 900] | 100 / 92 |
| ashgrid | 2 | 8.2 [7.5-9.0] | 33.8 [28.9-38.7] | 242.2 [67.0-417.4] | 1610.9 [910.5-2311.3] | 2224 [1034-3414] | 46.2 [35.3-57.1]% | 31.6 [27.6-35.7] / 1609.1 [913.1-2305.2] (5.1 [4.8-5.5] / 21.8 [21.6-21.9]) | 352 [342-361] (76 [60-92] / 338 [328-347]) | 9512 [5847-13178]k | 84 [80-89] | 466 [465-467] | 140 [137-144] | 160 [152-167] | 1.00 [1.00-1.00], [1600, 900] | 100 [99-100] / 97 [96-97] |
| deepwood | 1 | 46.9 | 18.5 | 50.2 | 51.0 | 51 | 11.8% | 16.0 / 49.2 (3.2 / 11.8) | 139 (48 / 125) | 2869k | 86 | 375 | 172 | 144 | 1.00, [1600, 900] | 100 / 97 |

### Stall attribution (frames whose CPU frame > 50 ms; per window, summed over runs)

| window | map | frames >50 ms | >100 ms | of which a new program / texture / geometry appeared | pre-window frame cpu ms | worst 3 (cpu ms, render-submit ms, dProg/dTex/dGeo) |
|---|---|---|---|---|---|---|
| menu | isla_viva | 0 | 0 | 0 (of the <=8 worst listed per run) | 15131 |  |
| menu | ashgrid | 4 | 4 | 0 (of the <=8 worst listed per run) | 11 [10-12] | 3318.1/3317.9 (0/0/0); 2844.4/2843.5 (0/0/0); 871.0/870.6 (0/0/0) |
| menu | deepwood | 0 | 0 | 0 (of the <=8 worst listed per run) | 14126 |  |
| drop | isla_viva | 5 | 4 | 1 (of the <=8 worst listed per run) | 15 | 3089.5/3086.9 (1/2/1); 1385.1/1382.5 (0/0/0); 856.8/854 (0/0/0) |
| drop | ashgrid | 8 | 5 | 1 (of the <=8 worst listed per run) | 62 [43-81] | 4946.3/4941.8 (0/0/0); 1255.6/1248.2 (0/0/0); 450.2/446.2 (1/1/0) |
| drop | deepwood | 0 | 0 | 0 (of the <=8 worst listed per run) | 106 |  |
| ground | isla_viva | 7 | 6 | 2 (of the <=8 worst listed per run) | 8549 | 7319.2/7306.9 (0/0/0); 2375.1/2360.2 (0/13/18); 1502.5/1493.4 (0/1/1) |
| ground | ashgrid | 20 | 16 | 0 (of the <=8 worst listed per run) | 2029 [1453-2605] | 5102.3/5095.6 (0/0/0); 4593.7/4587.9 (0/0/0); 4513.3/4505.3 (0/0/0) |
| ground | deepwood | 9 | 4 | 0 (of the <=8 worst listed per run) | 1252 | 4673.8/4663.3 (0/0/0); 4643.1/4630.7 (0/0/0); 1639.4/1628.8 (0/0/0) |
| endgame_realframes | isla_viva | 38 | 35 | 1 (of the <=8 worst listed per run) | n/a | 10786.3/10778 (0/1/0); 8598.6/8594.5 (0/0/0); 6661.4/6659.6 (0/0/0) |
| endgame_realframes | ashgrid | 75 | 67 | 0 (of the <=8 worst listed per run) | n/a | 27784.7/27780.4 (0/0/0); 17810.5/17806.2 (0/0/0); 12368.9/12365.7 (0/0/0) |
| endgame_realframes | deepwood | 41 | 29 | 0 (of the <=8 worst listed per run) | n/a | 16995.2/16991.3 (0/0/0); 14807.4/14802.6 (0/0/0); 12237.2/12232.6 (0/0/0) |
| again_drop | isla_viva | 3 | 2 | 0 (of the <=8 worst listed per run) | 45 | 1296.9/1267.2 (0/0/0); 115.4/108.6 (0/0/0); 58.8/54.5 (0/0/0) |
| again_drop | ashgrid | 5 | 2 | 0 (of the <=8 worst listed per run) | 34 [34-34] | 3401.5/3391.5 (0/0/0); 1037.1/1033 (0/0/0); 83.1/78.2 (0/0/0) |
| again_drop | deepwood | 1 | 0 | 0 (of the <=8 worst listed per run) | 26 | 54.5/50.3 (0/0/0) |

### Errors by stage (all runs)

- boot_cold: 4 console errors, 0 warnings
    - `[error] Failed to load resource: the server responded with a status of 404 (File not found) @http://127.0.0.1:8790/favicon.ico:0`
- load: 4 console errors, 940 warnings
    - `[error] Failed to load resource: the server responded with a status of 404 (File not found) @http://127.0.0.1:8790/favicon.ico:0`
    - `[warning] [rig] soldier FAILS the skeleton contract — missing: [Hips, Spine02, Spine01, Spine, Head, RightArm, RightForeArm, RightHand, LeftArm, LeftForeArm, LeftHand, RightUpLeg, RightLeg, RightFoot, LeftUpLeg, LeftLeg, LeftFoot, neck|Neck], skinnedMeshes: 1, handBone: NONE. Downstream: pose.js aim chain and the weapon holder will misbehave on this rig. @http://127.0.0.1:8790/games/last-circle/ru`
    - `[warning] [rig] soldier attachment issues: [weapon holder parented to "mixamorigRightHand" — legal: RightHand, FistR] @http://127.0.0.1:8790/games/last-circle/runtime/3d/royale/rig_pipeline.js?v=1789530264:177`
    - `[warning] [rig] athlete FAILS the skeleton contract — missing: [Hips, Spine02, Spine01, Spine, Head, RightArm, RightForeArm, RightHand, LeftArm, LeftForeArm, LeftHand, RightUpLeg, RightLeg, RightFoot, LeftUpLeg, LeftLeg, LeftFoot, neck|Neck], skinnedMeshes: 1, handBone: NONE. Downstream: pose.js aim chain and the weapon holder will misbehave on this rig. @http://127.0.0.1:8790/games/last-circle/ru`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle1.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle2.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle3.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- endgame: 0 console errors, 174 warnings
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- again_load: 0 console errors, 920 warnings
    - `[warning] [rig] soldier attachment issues: [weapon holder parented to "mixamorigRightHand" — legal: RightHand, FistR] @http://127.0.0.1:8790/games/last-circle/runtime/3d/royale/rig_pipeline.js?v=1789530264:177`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle1.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle2.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle3.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing1.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing2.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- land_ff: 0 console errors, 6 warnings
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- menu: 1 console errors, 0 warnings
    - `[error] Failed to load resource: the server responded with a status of 404 (File not found) @http://127.0.0.1:8790/favicon.ico:0`
- ground: 0 console errors, 6 warnings
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigRightHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandMiddle4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandRing4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
    - `[warning] THREE.PropertyBinding: No target node found for track: mixamorigLeftHandPinky4.quaternion. @https://cdn.jsdelivr.net/npm/three@0.172.0/build/three.core.js:32264`
- pageerrors: 0
- window error/unhandledrejection (init-script listener): 0
- failed requests: 1
    - ashgrid r1 [load] FAILED http://127.0.0.1:8790/games/last-circle/assets/audio/sfx/step_wood_001.ogg net::ERR_CONNECTION_REFUSED
- probe notes: 0

### Contamination

- isla_viva r1: other automated Chromes at start = 11; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 455.6 s
- ashgrid r1: other automated Chromes at start = 10; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 610.7 s
- deepwood r1: other automated Chromes at start = 12; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 722.3 s
- ashgrid r2: other automated Chromes at start = 12; GL = ANGLE (NVIDIA, NVIDIA RTX A2000 Laptop GPU (0x000025B8) Direct3D11 vs_5_0 ps_5_0, D3D11); run wall 444.2 s
