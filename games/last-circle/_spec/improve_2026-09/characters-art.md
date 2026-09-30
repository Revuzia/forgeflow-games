# Last Circle audit — lane: characters-art

Status: DONE (measurements complete; final ranked list + <=450 plan at the bottom under FINAL).

Scope: how the 50 characters and the world are rendered in Last Circle vs BLOCKTOOTH's
instanced GPU-animated crowd (src/render/civilians.ts) and renderer budgets.

## Findings (appended below)

### Static read (quoted; before live measurement)

S1. One SkinnedMesh + one AnimationMixer + one cloned material PER ACTOR (no instancing).
  - runtime/3d/ffg_kernel_3d.js:406-408 `const scene = skeletonClone(gltf.scene); const mixer = new THREE.AnimationMixer(scene); this._mixers.push(mixer);`
  - runtime/3d/royale/player.js:361 `const m = o.material.clone();` (per actor; one shared program via player.js:390 `m.customProgramCacheKey = () => "lcZoneTint";`)
  - player.js:371-372 comment: every skin GLB carries "meshes 1 | materials 1 | prims [1]" -> 1 body draw per actor per pass.
  - Every character mesh casts shadow: ffg_kernel_3d.js:397 `g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } ...`
S2. Animation "LOD" freezes the pose but not the cost.
  - player.js:1416 `a.rig.mixer.timeScale = far ? 0 : 1;` (far = bot > 250 m, player.js:962)
  - ffg_kernel_3d.js:489 `for (let i = 0; i < this._mixers.length; i++) this._mixers[i].update(dt);` runs for EVERY mixer every frame.
  - three r172 AnimationMixer.update (three.core.js:34229-34260): `deltaTime *= this.timeScale;` then STILL loops every active action `action._update(...)` and every binding `bindings[ i ].apply( accuIndex )`. timeScale 0 = same CPU, frozen picture.
  - Mixers run at render rate with variable dt (kernel loop), not on a fixed tick.
S3. Per-actor extras: nametag = 1 Sprite with its own 256x48 CanvasTexture (player.js:554-558); held weapon = `proto.clone()` of a 5.9k-6.2k-tri Meshy GLB (weapons.js:247; tri counts in BENCHMARK_DIMENSIONS.json:1456); parachute = 3 meshes + 1 LineSegments built with NEW geometry + NEW materials on every deploy (player.js:1344-1370).
S4. BLOCKTOOTH reference: one instanced draw per archetype + a MID figure + a ~52-tri far LOD figure for the whole crowd (blocktooth/src/render/civilians.ts:10-18, 1115-1116 `const MID_PX = 26;`), tier chosen by projected pixel height (civilians.ts:1453 `let tier = figPx >= FULL_PX ? 0 : figPx >= MID_PX ? 1 : 2;`). Honest counters: renderer.ts:14 "info.autoReset = false and ONE reset per frame" (renderer.ts:87, :160).
  - Last Circle has NO honest per-frame counter: the composer (bloom) is on for the whole session (ffg_kernel_3d.js:67-72 comment) and `renderer.info.autoReset` is never set (grep `autoReset` over runtime/ -> 0 hits), so any read of renderer.info after a frame sees only the last fullscreen pass.

### FINDING A (biggest): the Mixamo re-rig inflated every character body 16-42x in triangles
Parsed the glTF JSON of the shipped GLBs (scratch script; index accessor count / 3):

| skin | shipped .glb tris / verts / bones | pre_mixamo.bak tris / bones | factor |
|---|---|---|---|
| athlete    | 245,730 / 131,456 / 34 | 12,761 / 24 | 19x |
| juggernaut | 632,456 / 329,098 / 52 | 14,870 / 24 | 43x |
| soldier    | 409,150 / 214,760 / 52 | 15,490 / 24 | 26x |
| viper      | 331,176 / 174,252 / 52 | 15,636 / 24 | 21x |
| wraith     | 281,438 / 147,108 / 52 | 15,382 / 24 | 18x |

All five: 1 mesh, 1 material, three 512x512 JPEG maps (base/normal/emissive).
Commit that shipped it: aebe7736 2026-08-04 "last-circle+pirates: Draco character bases, Mixamo pistol/rifle/fall clips"
("Geometry-only Draco cuts LC skins ~10x" -> Draco shrank the DOWNLOAD; the GPU still draws every triangle).
BENCHMARK_DIMENSIONS.json:1171 still records the pre-rig figure: "measured live at 15,490 triangles, 24 bones, a single SkinnedMesh".
Mean body = 379,990 tris; 50 actors rotate the 5 skins (player.js:298 `urls[i % urls.length]`) -> ~19.0 M triangles if all were drawn, before the shadow pass draws casters a second time (ffg_kernel_3d.js:397 castShadow = true).

### Reference bars (quoted)
- BLOCKTOOTH src/core/config.ts:989-994 `export const BUDGET = { fpsMin: 55, drawCallsMax: 450, simTickMsMax: 4, dprMax: 1.5, shadowMap: 1024, ...`
- BLOCKTOOTH civilians.ts:1111-1120 detail tiers by on-screen height (`FULL_PX = 44`, `MID_PX = 26`) and a triangle ceiling for the mid crowd (`PILL_TRIS = 81920`).
- DYEFIELD _spec/CONTRACT.md:148 hero character "Budget: <= 12k triangles"; CONTRACT.md:1005-1008 "The runtime merges each hero's primitives into one skinned geometry ... So each runner is <= 2 draw calls (body, plus the kit if it is not merged)."
- HIT PARADE research (games/hit-parade/_research/TECH_REUSE.md:15,18): "resize -> WebP -> meshopt cut a Mixamo character from 5,494,020 to 554,320 bytes" and "pick meshopt, not Draco".

### Other static facts
- Dead actors keep ticking: killActor sets `victim.rig.mixer.timeScale = 1` (player.js:1992) and removes the body after ~4.2 s (player.js:2009-2015 `onComplete: () => { if (victim.obj.parent) victim.obj.parent.remove(victim.obj); }`) but never calls `W.kernel.disposeMixer`; mixers are only disposed at the NEXT match start (ffg_royale3d.js:345-346). By the final circle ~45 detached rigs are still animated every frame for nothing.
- Pose/IK/barrel-weld CPU layer (player.js:1504-1698: applyArmPose, twoBoneIK, updateWorldMatrix, getWorldPosition x3) runs for every actor within 250 m whether or not it is on screen; the only gate is `far` (player.js:962) and `mixer.timeScale !== 0` (player.js:1610).
- Parachute: `new THREE.SphereGeometry` x2 + `new THREE.MeshStandardMaterial` x2 + `new THREE.LineBasicMaterial` + `new THREE.BufferGeometry().setFromPoints` per deploy (player.js:1344-1370); removeChute (player.js:1375-1377) only unparents -> geometry/material never disposed, and a player who toggles the chute (SPACE, player.js:1031-1034) allocates a fresh set every toggle.

### Feasibility check for Finding A (scratch only, repo untouched)
The globally installed gltf-transform CLI 4.4.2 (the one HIT PARADE's tools/compress_glb.py already uses) decimates the shipped skins in ~10 s each, keeping the skin:
`gltf-transform simplify <skin>.glb out.glb --ratio <15000/tris> --error 0.01` ->
athlete 14,996 tris / 34 bones; juggernaut 15,000 / 52; soldier 14,990 / 52; viper 14,998 / 52; wraith 14,994 / 52 —
attributes kept on all five: JOINTS_0, NORMAL, POSITION, TEXCOORD_0, WEIGHTS_0 (scratch/chars/dec/*_lod0.glb, 0.71-0.79 MB each vs 1.1-2.9 MB shipped).
Same tool at ~2,500 tris for a far LOD: 2,496-2,500 tris, bones kept (scratch/chars/dec/*_lod1.glb, 0.18-0.26 MB).
Bone count/order unchanged -> clips, HAND_AIM_ROT (player.js:115-121) and the rig audit (rig_pipeline.js) are unaffected in principle; visual parity still has to be shown in a browser (see the A/B render below).

### Measurement conditions (read before trusting any ms number)
- Box: Intel UHD (0x9A60) via ANGLE D3D11, 16 logical CPUs at LoadPercentage 100, 106 chrome processes, ~1.8 GB RAM free (Get-CimInstance, this session). Other lanes' probes share the GPU. The frame-pipeline lane's scratch log shows menu frame gaps p50 1,777 ms and a startMatch of 205,929 ms on this box (scratch/frameprobe_log.txt, scratch/framepump4_log.txt — per that lane, not re-measured by me).
- Therefore: draw calls / triangles / programs / object counts below are exact and load-independent; every ms figure is information only.
- Probe: scratch/chars/charprobe.js wraps renderer.renderBufferDirect to attribute every draw (pass = main | shadow | post) to its scene group and, for actors, to body / weapon / nametag / chute; sets info.autoReset=false and resets once per measured frame (the BLOCKTOOTH renderer.ts:14 rule). One synchronous composer.render per measurement.

### LIVE: Isla Viva, standard, seed 7, graphics medium, 1280x720, DPR 1 (scratch/chars/run_isla3.log)
startMatch took 457 s on this saturated box (info only; 53.7 s -> 510.7 s in the log).

[t+0, drop start, W.t 0.1, 50 alive] calls 220 | tris 12,921,109 | programs 78 | textures 92 | geometries 344
  shadow|actor-body   31 calls  11,741,024 tris   <- 91% of the frame's triangles
  main|map:inst       27 calls     600,792
  main|actor-body      1 call      409,150   (the player's own soldier body)
  main|map:mesh       56 calls     105,046
  shadow|map:mesh     59 calls      58,364
  main|actor-weapon    1 call        5,955
  bodies in view frustum 1; distance from camera: 1 <25 m, 3 in 110-250 m, 46 >= 250 m
  mixers 50, of which 46 frozen at timeScale 0 (>250 m) — all 50 still updated every frame (1.44 ms for 50 x update(0) on this box)
READING: at the drop, 31 airborne bodies are drawn into the shadow map at full 380k-tri detail. The shadow box is widened with altitude
(ffg_royale3d.js:281-282 `const wantExt = Math.min(620, ext + (agl > 40 ? (agl - 40) * 2.4 : 0));`) so it swallows most of the lobby,
and every body casts (ffg_kernel_3d.js:397). At 620 m / 2048 texels one shadow texel is ~0.6 m, i.e. a person's shadow is about one texel:
~11.7 M triangles are spent on shadows no player can see.

[t+10, drop, 50 chutes open] calls 228 | tris 7,730,611 — main|actor-body 9 calls 3,727,738; shadow|actor-body 8 calls 3,222,994; main|actor-chute 40 calls (10 canopies in view x 4 objects each); shadow|actor-weapon 3; main|map:inst 9 calls 573,192
[t+20, drop] calls 188 | tris 5,828,420 — main|actor-body 8 / 3,446,300; shadow|actor-body 4 / 1,654,220; main|actor-chute 32 calls
[t+45, landed, W.t 46.9, 38 alive] calls 105 | tris 2,926,935 — shadow|actor-body 5 calls 2,063,370 (70% of the frame), main|actor-body 1 / 331,176; mixers still 50 (12 dead rigs ticking)
[CLUSTER at t+45: the 38 living actors placed in a 14 m ring 20 m ahead of the camera (drop-cluster / final-circle stand-in)]
  full               calls 177 | tris 30,468,365
  - weapons hidden   calls 173 | tris 30,444,545   (only 3 weapons were inside the 110 m weapon LOD by their sim position)
  - char shadows off calls 133 | tris 15,131,263   (-44 calls, -15.3 M tris)
  world only         calls  95 | tris    508,569
  => characters = 82 calls and 29.96 M triangles: main|actor-body 38 calls 14,622,694 + shadow|actor-body 40 calls 15,313,282.
  (nametag rows unchanged because tag visibility is driven from a.pos, which the cluster stand-in did not move — tags are 1 call each when shown.)
READING: in every measured frame the draw-call count stays under the 450 bar (max 228); the character problem is TRIANGLES, ~385k per body per pass.
The same 38 bodies at the pre-rig 15k would be ~0.57 M main + ~0.6 M shadow.

### A/B render, shipped vs decimated (scratch/chars/abrender.py, run_ab.log) — soldier
Same idle frame (soldier_idle.glb at 0.6 s), same lights as the kernel (hemi 0.9 + sun 1.6), same in-game material fix, ACES, 400x400 per tile, fov 57, camera at 4.2 m (third-person follow distance, player.js:1774), 12 m and 35 m.
- tris: full 409,150 | LOD0 14,990 | LOD1 2,498
- SkinnedMesh.computeBoundingSphere (runs once per clone at its first frustum test; three r172 skins every vertex on the CPU): full 164.1 ms | LOD0 13.1 ms | LOD1 1.9 ms (per clone, this box). 50 clones of the five skins hold ~9.97 M vertices (5 skins' vertex totals x 10), so by vertex-count scaling the roster costs ~7.6 s of main-thread skinning on this box the first time the actors are culled — an ESTIMATE from the soldier timing, not a direct measurement.
- pixel diff vs full over character pixels (mean |dRGB| / px over 32): 4.2 m LOD0 12.49 / 605 of 5,866 px; LOD1 23.84 / 1,564 px. 12 m LOD0 12.33 / 74 of 805; LOD1 20.66 / 185. 35 m LOD0 13.96 / 11 of 115; LOD1 19.18 / 20 of 115.
  (Needs the eyeball check of ab_soldier.png before claiming "looks the same"; a mean diff of ~12/255 can be shading drift from the normal map on re-computed normals.)
- EYEBALL CHECK (scratch/chars/ab_soldier.png, zoom of the 4.2 m row: ab_soldier_zoom42.png): full 409k vs LOD0 15k are indistinguishable at the third-person follow distance — plate carrier pouches, flag patch, gloves, boots and face all read the same, because the 512x512 albedo/normal carry the detail, not the geometry. LOD1 2.5k softens the face and hand silhouettes at 4.2 m (so it is a far-only LOD, >= ~35 m where the whole figure is ~115 px of 400).
  Re-run timing on a second pass: computeBoundingSphere full 126.0 ms | LOD0 10.1 ms | LOD1 1.8 ms (run_ab2.log).

[t+120, mid-match, W.t 124.5, 22 alive] calls 180 | tris 5,585,834 | programs 82 | textures 117 | geometries 386
  main|actor-body 5 calls 2,460,244 + shadow|actor-body 6 calls 2,309,100 = 85% of the frame's triangles from 5-6 bodies
  shadow|loot:mesh 42 calls (loot lane), main|map:inst 12 / 588,382, main|map:mesh 40 / 94,368
  mixers: 50 registered for 22 living actors (28 dead rigs still updated every frame); 50 x update(0) = 3.42 ms on this box (was 1.1 ms at t+10 when 47 were frozen) — info only.

[t+240, W.t 248.6, 12 alive, camera near ground at (451.9, 0.2, -417.9)] calls 405 | tris 21,723,801 | programs 84 | textures 129 | geometries 447
  main|actor-body 48 calls 18,386,886 tris (48 bodies in view — 36 of them CORPSES; see caveat) ; shadow|actor-body 5 / 2,460,244
  main|map:mesh 146 calls / 209,172 ; main|map:inst 30 / 604,500 ; main|loot:mesh 44 calls
  CLUSTER (all living actors pulled into the 14 m ring): calls 414 | tris 24,723,491 ; -nametags 410 ; -weapons 403 ; -char shadows 391 / 19,503,304 ; WORLD ONLY 338 calls / 834,584 tris
  CAVEAT (harness artifact, not a game bug): the probe advanced the sim with one synchronous fastForward per scenario, and killActor removes a corpse with a
  wall-clock setTimeout(3000) + a kernel tween driven by frame dt (player.js:2009-2015). Neither can run inside a synchronous task, so corpses that real
  play would have sunk after ~4.2 s were still standing. Read this row as "48 bodies in view" (a corpse pile / hot-drop stand-in), not as a real t=248 frame.
  What it does show for real: 48 bodies in view = 18.4 M triangles; and this viewpoint's WORLD alone is 338 calls, so characters have ~110 calls of
  headroom under the 450 bar here.
Scene inventory at the end (P.groups): actors = 50 skinned + 53 meshes + 49 sprites; loot = 499 meshes + 77 sprites; map = 175 meshes + 33 InstancedMesh (1,985 instances) + 120 sprites.

### A/B render — juggernaut (worst skin, run_ab2.log)
- tris: full 632,456 | LOD0 15,000 | LOD1 2,498 ; computeBoundingSphere per clone: full 242 ms | LOD0 8.1 ms | LOD1 1.8 ms
- pixel diff (mean |dRGB| / px over 32): 4.2 m LOD0 15.23 / 979 of 7,419 px ; LOD1 25.35 / 2,067 ; 12 m LOD0 13.78 / 111 of 1,000 ; 35 m LOD0 13.26 / 11 of 133
- EYEBALL (ab_juggernaut_zoom42.png): LOD0 keeps every plate, the chest label, gloves and boots; the only visible change is slightly softer specular breakup on the shoulder plates. LOD1 visibly rounds the armour — far-only.
  If the owner wants zero visible risk on the most-looked-at model, a 25k LOD0 still cuts the juggernaut 25x.

## GAPS — early draft (SUPERSEDED by the final ranked list at the bottom; numbering differs)

G1 [HIGH] Character bodies are 245k-632k tris each (16-43x the pre-rig 15k; DYEFIELD budget <= 12k). Measured: 38 bodies in view = 29.96 M tris (main+shadow);
   drop start = 12.9 M tris of which 11.7 M are 31 body shadows; mid-match 85% of the frame is 5-6 bodies.
   FIX (generator + assets): add games/last-circle/_tools/char_lod.py that runs `gltf-transform simplify` (global CLI 4.4.2, same tool HIT PARADE's
   tools/compress_glb.py drives) on each base -> LOD0 ~15k (or 25k for juggernaut) and LOD1 ~2.5k, asserts joints list + order unchanged, tri budget,
   and writes assets/chars/meshy/<skin>.glb + <skin>_lod1.glb. Scratch trial already produced all 10 files with bones/attrs intact.
   Files: games/last-circle/_tools/char_lod.py (new), games/last-circle/assets/chars/meshy/{athlete,juggernaut,soldier,viper,wraith}.glb (+ *_lod1.glb).
   Verify (real browser): per-skin tris <= 16k; live cluster tris 30.5 M -> ~1.7 M; W._rigAudit all pass; validateAttachments clean; A/B shots at 4.2 m.

G2 [HIGH] Every body and held weapon casts a shadow at any range; the drop widens the shadow box to 620 m so 31 airborne bodies render into the shadow map.
   FIX: in player.js update() (the per-actor loop at :973-991 that already owns weapon LOD) set body/weapon castShadow = d2 < 45^2 (camera distance);
   store a.bodyMesh at load (player.js:358-412). Files: player.js only.
   Verify: probe shadow|actor-body calls <= actors within 45 m; drop-start shadow tris 11.7 M -> ~0; own shadow still visible in a screenshot.

G3 [MEDIUM] No body geometry LOD (grep `THREE.LOD|lod1|geoLod` over runtime/ -> 0 hits); 7 on-screen bodies at > 250 m during the drop cost 380k each.
   FIX: load <skin>_lod1.glb, keep both BufferGeometries on the actor, swap sm.geometry by camera distance (> 35 m) in the same loop. Same skeleton,
   same material -> zero extra draw calls, zero new programs. Files: player.js (+ G1 assets).

G4 [MEDIUM] Parachute = 4 draw calls per canopy and fresh geometry/materials per deploy (leaked on remove). 10 canopies in view measured 40 calls.
   FIX: build canopy geometry once (dome + 2 stripe gores merged, vertex colour or 2 groups), a per-colour material cache, lines merged; dispose nothing
   per deploy because nothing is allocated. Best: one InstancedMesh for all canopies (matrix = a.chute world matrix, colour = instanceColor).
   Files: player.js (:1330-1377, chute part of syncObj :1413).

G5 [MEDIUM] Mixers: 50 always updated; far "LOD" is timeScale 0 which three still fully evaluates; dead rigs keep ticking all match (50 mixers for 22 alive).
   FIX: dispose the mixer in killActor's removal onComplete; own the mixers in player.js (kernel.disposeMixer at load, tick in syncObj) with
   on-screen/near = every frame, on-screen far = 10 Hz accumulated dt, off-screen = skip. Leaves ffg_kernel_3d.js (in-flight edits) untouched.
   Files: player.js.

G6 [LOW-MED] First-cull CPU skinning of 50 bounding spheres (126-242 ms per full-res clone measured; ~7.6 s roster estimate on this box).
   FIX: assign a fixed local-space bounding sphere (centre (0,0.9,0), r 1.25) to each body at load. Files: player.js.

G7 [LOW] Pose/IK/barrel-weld CPU for off-screen actors (player.js:1504-1698). FIX: skip when the actor's sphere is outside the camera frustum. Files: player.js.

G8 [LOW] Nametags: 1 draw + 1 CanvasTexture per actor (49 textures). FIX: one name atlas + one instanced billboard. Files: player.js (+ optional royale/nametags.js).

W1 [MEDIUM, already queued] map-wide instanced props never cull, no foliage LOD (BUILD_ORDER.md:72 #55); main|map:inst 27-30 calls / 0.57-0.60 M tris in
   nearly every measured frame. Files: maps.js.
W2 [LOW] merged structure batches castShadow=true map-wide (maps.js:1858-1859): shadow|map:mesh 20-59 calls. Files: maps.js.
X1 [cross-lane] no honest per-frame counter / __LC__.render() (DYEFIELD perfcheck.py:21 reads __DF__.render()). Files: ffg_royale3d.js (frame-pipeline lane).
X2 [cross-lane] loot casts shadows: shadow|loot:mesh 22-42 calls per frame. Files: loot.js (loot lane).

### v4 run (run_drop4.log) - what it did and did not show
- startMatch 875 s this time (box got worse). Intended drop cluster FAILED to hold: positions were set in one evaluate and measured in the next,
  and the live frame pipeline re-synced every a.obj from a.pos in between (player.js:1381 "a.obj.position.copy(a.pos);"). So dc_* rows are the
  real t+10 view (9 bodies, 10 canopies in frustum) with tags/weapons forced on, NOT a cluster:
  dc_simVis 227 calls / 7.73 M ; dc_real (tags+weapons on) 247 / 7.80 M ; -chutes 211 (-36) ; -tags 239 (-8) ; -char shadows 231 / 4.53 M ; world only 165 / 0.75 M.
  Per-object costs confirmed: canopy = 4 draws (main|actor-chute objs 40 for 10 canopies), nametag = 1 draw, weapon = 1 main + 1 shadow draw.
- The in-match cold-vs-warm bounding-sphere frame pair is UNUSABLE: the "warm" frame took 174,108 ms and the "cold" 6,662 ms - contention noise,
  not a signal. The per-clone timings from the A/B page (126-242 ms full, 8-10 ms LOD0) stand; the roster figure stays an estimate.
- Verified for the geometry-swap LOD: the decimated LOD0 and LOD1 of all five skins keep the IDENTICAL joints list in the same order
  (athlete 34, others 52; python compare of skins[0].joints node names -> True for all 10), so a runtime skinnedMesh.geometry = lodGeo
  swap on the existing skeleton is valid.

## Per-character cost card (measured per object, Isla Viva, medium)
| part | draws (main) | draws (shadow) | tris per draw | when |
|---|---|---|---|---|
| body SkinnedMesh | 1 | 1 (castShadow always) | 245,730-632,456 (mean 380k) | always, any distance, frustum-culled only |
| held weapon (Meshy GLB, 1 mesh) | 1 | 1 | 5,943-6,169 | camera distance < 110 m (medium) |
| nametag Sprite (own CanvasTexture) | 1 | 0 | 2 | bots 12-70 m, peers to 250 m |
| parachute (dome + 2 gores + lines) | 4 | 0 | ~99 | while gliding with canopy |
Drop worst case (49 others in view, all under canopy, estimate from the per-object costs above + measured world 165):
  165 world + 49 x (1 body + 1 body shadow + 1 weapon + 1 weapon shadow + 1 tag + 4 canopy) = 165 + 441 = ~606 calls (> 450),
  and 49 x 380k x 2 = ~37 M triangles.

### LIVE DROP CLUSTER (v5, run_c5b.log; one synchronous evaluate, so positions held) — Isla Viva, seed 7, W.t 10.3
49 other actors, all under canopy, in a 12 m ring 22 m ahead of the camera and 4 m below it; tags/weapons shown as update() would inside 70/110 m.
| variant | draw calls | triangles |
|---|---|---|
| shipped | **482** | **20,065,124** |
| + decimated LOD0 bodies swapped onto the live SkinnedMeshes (same skeletons) | 482 | 1,815,404 |
| + canopies & nametags hidden (stand-in for 1 instanced draw each) + weapon shadows off | 237 | 1,795,902 |
| + body shadows only inside 45 m | 237 | 1,795,902 |
| world only (actors group hidden) | 133 | 747,976 |
Shipped breakdown: main|actor-chute 200 calls (50 canopies x 4 objects) ; main|actor-body 50 calls / 18,999,500 tris ; main|actor-weapon 50 / 297,750 ;
main|actor-nametag 49 ; main|map:mesh 52 ; shadow|map:mesh 24 ; post 14 ; main|map:inst 12 / 603,536.
(No shadow|actor-body rows here: the cluster sits at canopy altitude, outside the ground-anchored shadow box — ffg_royale3d.js:289.)
=> The drop is the one measured frame over the 450-call bar, and the canopy (200) + nametag (49) draws are what put it there.
=> Decimation alone removes 18.25 M of the 20.07 M triangles (-91%) with no draw-call change.
Real post-fix estimate for this frame: 237 + ~2 (instanced canopies + lines) + 1 (instanced tags) = ~240 calls, ~1.8 M tris.
In-game visual parity, same frame (scratch/chars/drop_t10_snapShipped.jpg vs drop_t10_snapLod0.jpg, 1280x720 game canvas):
mean |diff| 0.56 / 255 over the whole frame; 5,657 px differ by > 16 and 1,346 px by > 32 (0.15% of 921,600), all inside the character block
(bbox 224,238 - 1040,472). Eyeballed side by side: indistinguishable at game resolution.

### LIVE GROUND CLUSTER (v5) — W.t 46.5, 37 living others in a 12 m ring 16 m ahead, on the terrain
| variant | draw calls | triangles |
|---|---|---|
| shipped | 363 | **32,913,531** |
| + LOD0 bodies (15k) swapped on the live skeletons | 363 | 2,363,015 |
| + nametags hidden (stand-in for 1 instanced draw) + weapon shadows off | 287 | 2,130,696 |
| + body shadows only inside 45 m | 285 | 2,100,706 |
| world only | 170 | 719,754 |
Shipped breakdown: shadow|actor-body 41 calls / 16,296,756 ; main|actor-body 38 / 15,438,412 ; shadow|actor-weapon 39 / 232,245 ; main|actor-weapon 38 / 226,290 ;
main|actor-nametag 37 ; main|map:mesh 50 ; shadow|map:mesh 46 ; shadow|loot:mesh 22.
Characters = 193 of the 363 calls (5 per actor: body, body shadow, weapon, weapon shadow, tag) and 32.2 M of the 32.9 M triangles.
In-game parity (ground_t45_snapShipped.jpg vs ground_t45_snapLod0.jpg; stacked in ground_t45_ab.jpg): mean |diff| 1.055/255, 3,790 px > 32 of 921,600 (0.41%),
all inside the crowd band; eyeballed: indistinguishable.


## FINAL

### Summary
Characters are the heaviest thing Last Circle draws, and triangles are the reason, not draw calls. The 2026-08-04 Mixamo re-rig (commit aebe7736)
shipped every body at 245k-632k triangles (16-43x the 12.8k-15.6k pre-rig meshes; DYEFIELD's bar is <= 12k), each actor is its own full-detail
SkinnedMesh that also casts a shadow at any range, and nothing is LOD'd: 38 actors in view measure 30-33 M triangles, a drop cluster 20 M, and the
drop start spends 11.7 M of 12.9 M triangles on shadows of airborne bodies. Draw calls stay under 450 everywhere except the drop cluster (482), where
parachutes (4 draws each = 200) and per-actor nametag sprites (49) push it over. Decimated 15k bodies swapped onto the live skeletons cut the
cluster frames by 91-93% of their triangles with no visible change at game resolution (whole-frame mean |diff| 0.56-1.06 / 255).

### Minimal path to <= 450 draw calls without making characters look worse (all measured in-page on the live match except where marked)
1. Decimate the five bodies to ~15k (G1). Draw calls unchanged; triangles: drop cluster 20.07 M -> 1.82 M, ground cluster 32.91 M -> 2.36 M.
2. One instanced draw for all canopies (G3) and one for all nametags (G4). Drop cluster 482 -> 237 measured with both hidden (+~3 for the
   instanced replacements = ~240). Ground cluster 363 -> 287 (tags hidden, weapon shadows off).
3. Near-only character/weapon shadows (G2): removes the drop-start 11.7 M-triangle shadow pass; weapon shadows alone were 39 calls in the ground cluster.
4. Far LOD1 geometry swap + fixed bounding spheres + mixer ownership (G5-G7) are CPU/triangle wins, not draw-call wins.
Resulting worst measured frame: ~287 calls / ~2.1 M tris (ground cluster), well under BLOCKTOOTH's drawCallsMax 450.

### Final ranked gap list (numbering used in the FINAL summary and the structured output)
G1 [high]   Bodies 245k-632k tris each -> decimate to ~15k via a committed generator (_tools/char_lod.py + 5 GLBs). S.
G2 [high]   Every body/weapon casts shadows at any range; drop-start shadow pass 11.7 M tris -> near-only castShadow in player.js update(). S.
G3 [medium] Parachute = 4 draws per canopy + per-deploy allocations; 200 of the drop cluster's 482 calls -> one InstancedMesh (player.js). M.
G4 [medium] Nametag = 1 draw + 1 CanvasTexture per actor; 49 calls in the drop cluster -> one atlas + one instanced billboard (player.js). M.
G5 [medium] No body LOD (0 grep hits) -> LOD1 ~2.5k geometry swap by distance, same skeleton (player.js + *_lod1.glb). S-M.
G6 [medium] Mixers: all 50 ticked every frame at render dt; timeScale-0 "LOD" still fully evaluates; corpses tick all match -> player.js owns mixers with visibility/distance rate policy; dispose on corpse removal. M.
G7 [low]    First-cull CPU skinning of bounding spheres (126-242 ms per full-res clone) -> fixed per-body bounding sphere at load (player.js). S.
G8 [low]    Pose/IK/barrel-weld layer runs for off-screen actors -> skip when outside the frustum (player.js). S.
W1 [medium] Map-wide instanced props never cull, no foliage LOD (maps.js; already BUILD_ORDER #55). L.
W2 [low]    Map-wide merged structures cast shadows (maps.js) — 20-59 shadow calls per frame. S-M.
X1 [none, tooling] No honest per-frame counter / no character perf gate -> __LC__.render() in ffg_royale3d.js (frame-pipeline lane) + _harness/charcheck.py from scratch/chars/charprobe.js. S.
File-disjointness: G2-G8 all live in runtime/3d/royale/player.js (one lane); G1/G5 assets + _tools are asset-only; W1/W2 maps.js; X1 ffg_royale3d.js + _harness.
ffg_kernel_3d.js (uncommitted PORTRAIT CAMERA FIT work by another session) is deliberately NOT touched by any fix here.
