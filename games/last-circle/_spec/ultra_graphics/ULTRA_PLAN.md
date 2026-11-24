# Last Circle - ULTRA graphics plan (complete)

Written 2026-11-22 from all four specialist audits (69 ideas) and the first plan. Read-only planning: no game file was changed, nothing was run in a browser.

**Owner ask:** improve ULTRA graphics in every way we can and still run at high fps. Standing rules: on par with top similar games; CC0 / free assets only, no spend; Mixamo only; phones and LOW unchanged; HUD layout signed off.

**Short answer:** yes, there is a lot to gain, and most of it is cheap. But ULTRA has never been measured on the hardware it is meant for (a discrete GPU), so the plan starts by measuring, then buys frame time back, then spends it on the most visible upgrades, each one tied to an fps governor that switches it off before the frame rate drops.

## 1. Frame budget and headroom

- SOURCES: this plan is built from all four audits read in full (17 + 17 + 15 + 20 = 69 ideas) and the first plan, which had seen only the lighting audit and part of the world audit. Spot-checked in the code this session (master @ 8ccb6efce): BLOOM_RES ultra 1 (ffg_royale3d.js:429); ladder thresholds DOWN 22 ms / UP 14 ms (:768) and steps aa, bloom, shadow 2048, DPR 1.5 / 1.25 / 1.0 (:443-446); preserveDrawingBuffer true (ffg_kernel_3d.js:298); fixed reflection-sun at (30,34,16) (maps.js:1594); ULTRA world table (maps.js:1510); grass blades receiveShadow false (maps.js:7387); 'footstep' emitted at player.js:2551 with no listener in fx.js; character limits 45 m / 20 m / 37 m (player.js:2106-2107); only 5 'matrixAutoUpdate = false' in royale/*.js; no csm folder under assets/vendor/three/examples/jsm; harness 'dgpu' profile exists (_harness/common.py:95).
- WHAT ULTRA HOLDS TODAY ON THE INTEL UHD iGPU (1280x720, DPR 1, Savanna ground, quiet box, newest run 2026-11-22, gate_20261122_153228/p23_tierprof.log, read this session): GPU median low 5.92, medium 9.24, high 14.47, ULTRA 18.80 ms. Raw frame p50 20.1 ms, p90 40 ms on high and ULTRA (the display snaps frames to 20 / 40 ms, so the GPU column is the real cost). ULTRA is already over the 16.7 ms a 60 fps frame allows, so the iGPU has ZERO free milliseconds on ULTRA. That is expected: the first-run auto-tier picks medium there. The iGPU is not ULTRA's target; every new ULTRA cost must be shed by the governor on it.
- CORRECTION TO THE FIRST PLAN: it used 24.18 ms (2026-11-17) and asked why ULTRA 'regressed' from 20.89. The 24-25 ms readings were taken with another Chrome running (shared box: 6.7 / 11.6 / 22.5 / 25.5 ms); the quiet-box figure is 18.80 ms. Treat the old 'regression' as box noise until a quiet rerun says otherwise.
- WHAT ULTRA HOLDS ON ITS TARGET HARDWARE (a discrete GPU): NOT MEASURED. The only discrete-GPU match numbers are on MEDIUM, before Wave 10, RTX A2000 laptop GPU, 1600x900, DPR 1, vsync off (lc_liveprobe_perfcheck_20261019_103602.json, read this session): ground frame p50 5.0 ms Savanna / 6.5 Deepwood / 7.3 Isla Viva (about 137-200 fps); CPU frame p50 4.6 / 6.0 / 6.6 ms, of which three.js render submission is 3.8 / 5.2 / 5.7 ms and game simulation only 0.5-0.7 ms. So on the box ULTRA is meant for, the frame is limited by the CPU submitting draw calls, not by GPU maths.
- FREE MILLISECONDS ON THE DISCRETE GPU (from those medium numbers; ULTRA adds +3 to +14 draw calls and +9 to +33 % triangles on top, so real ULTRA headroom is smaller and unmeasured): at 144 Hz (6.94 ms per frame) about 0.3-2.3 ms of CPU room, and Isla Viva at 7.3 ms is already over; at 120 Hz (8.33 ms) about 1-3.3 ms; at 60 Hz (16.7 ms) about 9-11 ms. GPU-side cost at 1080p / 1440p / DPR 2 is unmeasured; the one scaling fact is that 720p -> 1080p cost 1.7x, so ULTRA at 1440p or DPR 2 probably becomes GPU-limited as well.
- THE BARS THE GATES ENFORCE (none is an ULTRA or discrete-GPU fps bar): tierprof - heap <= 85 KB per frame (ULTRA 72.21, so 12.8 KB free; HIGH 82.42, only 2.6 KB free), queryColliders mean <= 150 (ULTRA 129.1), bots p95 <= 3 ms, 0 new shader programs in the measured frames, GPU ms order low <= medium <= high <= ULTRA, auto-picked tier ground raw p50 <= 20 ms on the quiet iGPU. perf_district / framecheck - world draw calls <= live baseline + 40, triangles <= x1.25 (phone x1.20), drop cluster <= 250 calls, match frame < 5M triangles, heap < 100 KB per match frame, shadow share of drop triangles < 30 %. Plan: drop p50 <= 33 ms, houseload x1.25. Kernel budget (information only): 450 draw calls, p99 22 ms. The tightest bar for new features is +40 draw calls, then triangles x1.25, then heap per frame.
- THE GOVERNOR THAT EXISTS: one in-match ladder, GPU-timer driven, stepping SMAA -> FXAA, bloom off, shadow 4096 -> 2048, DPR 1.5 / 1.25 / 1.0. It steps down only when GPU p75 > 22 ms (about 45 fps) and up below 14 ms, so a 144 Hz player sliding to 90 fps never triggers it, it cannot see CPU time, and it cannot switch any world or effect feature off (those are compile-time defines).
- MILLISECONDS THAT CAN BE BOUGHT, AND HOW (estimates unless marked measured): CPU - static-object matrices and frozen skipped skeletons 0.3-1.0 ms; later, far characters as one instanced draw 0.5-1.5 ms and 20-40 calls; three.js garbage cleanup trims p99 hitches (measured 148.7 KB allocated per rendered ULTRA frame, 65.8 KB of it inside three). GPU - half-res bloom 0.3-1 ms discrete / 1-3 ms iGPU (difference measured invisible); FXAA instead of SMAA whenever render scale is above native (measured on the UHD at 1080p: 9.2-10.5 ms vs 0.46-0.76 ms); no preserved drawing buffer 0.1-0.5 ms; terrain near ring 0.2-0.5 ms and 100-200k triangles; lamp parking 0.2-0.8 ms; fog-aware draw distance (size unmeasured); cached far shadow map (unmeasured). Round 1 as a whole is expected to return roughly 0.3-1 ms CPU and 0.8-2.8 ms GPU on the discrete GPU before anything visible is spent - an estimate that measure-first M1-M3 must confirm.
- PLANNING RULES: (1) every new ULTRA effect is desktop-ULTRA-only (desktop high+ only where stated), switched by a uniform, a count or a pass flag - never a new shader program mid-match - pre-warmed at match start, and registered as a governor step if it costs more than about 0.2 ms; (2) phones, LOW and the HUD layout are untouched and their gate rows stay bit-identical; (3) on the target box CPU submission and draw calls are scarcer than GPU maths, so prefer shader terms inside existing draws over new objects or passes; (4) CC0 or own-made assets only (ambientCG sets on F:, Kenney Particle Pack), Mixamo only for animation, no spend; (5) no existing bar is ever lowered.
- STD FRAME BAR used in every acceptance test: tierprof rows for low / medium / high unchanged (kb <= 85, qc <= 150, 0 new programs, order); LOW and phone screenshots bit-identical; perf_district calls <= +40 and triangles <= x1.25; and, once M1 has set the baseline, the new discrete-GPU ULTRA row: CPU frame p50 and GPU p50 no higher than baseline plus the item's stated cost, with the governor holding p75 under the display target.

## 2. Ranked items

Ranked by visible gain per millisecond, headroom-buying and near-free items first. Costs are estimates unless they say measured. 'Governor step' = it switches off by itself when fps drops.

| # | Item | What the player sees | Cost on ULTRA | Lane | Round | Governor step |
|---|---|---|---|---|---|---|
| 1 | Refresh-aware ULTRA fps governor (extend the existing quality ladder) | ULTRA holds the monitor's refresh rate (60 / 120 / 144 Hz). In a heavy fight or a drop over a town the least visible extra switches off first and comes back when calm, instead of the frame rate sagging. | about 0.01-0.02 ms CPU (estimate; the ladder and GPU timer already run) | E (engine/post) - waits for w10-friends merge | 1b | IS the governor |
| 2 | Half-resolution bloom chain on ULTRA (buys headroom) | Nothing. The project's own measurement: at most 9-10/255 difference on 0.005 % of pixels. | SAVES an estimated 0.3-1 ms GPU on the discrete GPU at 1440p / DPR 2 and 1-3 ms on the UHD (bloom is about 6 ms of the UHD medium frame at half chain, comment :439) | E - waits for w10-friends merge (one table value in ffg_royale3d.js) | 1b | yes (full-res chain can be the top level, dropped first) |
| 3 | Stop keeping the drawing buffer for players (harness keeps it) | Nothing visible; slightly lower, steadier frame time. | SAVES an estimated 0.1-0.5 ms per frame at 1440p (one full-screen copy per frame). Not measured. | E-kernel (kernel file only - can start now) | 1a | no (always on) |
| 4 | Cut CPU render submission: static objects stop recomputing matrices; skipped far skeletons freeze | Higher, steadier fps at 120-144 Hz on a discrete GPU, where the CPU render step is the limit. | SAVES an estimated 0.3-1.0 ms CPU per frame (cpuRender is 3.8-5.7 ms p50 on the A2000 at medium; the share spent in matrix updates is unmeasured: M3) | W for maps.js / housegen.js / citykit.js; the player.js half goes in lane C after w10-anim-fix | 1a (world part), 3 (skeleton part) | no (always on) |
| 5 | Fix the reflection-sky sun direction per map (a defect) | Metal, glass, guns and wet sand shine from the same side as the sun on Savanna and Deepwood (today the highlight comes from the wrong side on 2 of 3 maps). | 0 ms per frame (one build at map load) | W | 1a | no (load-time) |
| 6 | Fog-aware draw distance (buys headroom) | Nothing on the ground: the cut objects were already about 99 % fog. Full range stays from the air. | Negative; size UNMEASURED (ULTRA draws trees to 2,063 m, past the 2,000 m far plane; ground fog is about 99.5 % at about 1,210 m) | W | 1a | no (always on; it is itself a saving) |
| 7 | Cheaper ULTRA terrain near ring | Nothing, as long as far ridgelines keep their outline. | SAVES an estimated 100-200k triangles per frame, about 0.2-0.5 ms GPU on the discrete GPU (arithmetic from 76x76 cells per near chunk; ring 2 adds 16 chunks) | W | 1a | yes (ring 2 -> 1 is a governor step) |
| 8 | Park unused point lamps and confirm effect / loot distance culling | Same look; frame time stays flat with many lamps or effects in view. | SAVES an estimated 0.2-0.8 ms GPU at 1440p (unmeasured) | W (maps.js lamps); the fx.js / loot.js check joins lane C | 1a | partly (lamps 6 -> 4 by intensity only) |
| 9 | Render scale above native on ULTRA with smooth dynamic resolution (fixed-size targets, no reallocation) | On an ordinary 1x monitor ULTRA finally looks sharper than HIGH: fences, power lines, foliage edges and far shorelines stop shimmering. Under load the picture softens slightly instead of stuttering. | Estimate +1.5-3 ms GPU on a mid discrete GPU at scale 1.5 (scene pass measured 1.7x time for 2.25x pixels). SMAA must give way to folded FXAA at scale >= 1.4 (SMAA measured 9.2-10.5 ms vs FXAA 0.46-0.76 ms on the UHD at 1080p). Not viable on the UHD: the governor holds 1.0. | E (kernel plumbing can start now; the tier wiring waits for w10-friends) | 1a plumbing, 1b wiring | yes (the scale IS a governor lever, 0.05-0.125 steps) |
| 10 | Sharpening (AMD CAS / FSR1 RCAS, MIT) folded into the output pass | Crisper textures and enemy outlines, most of all when dynamic resolution has scaled down. | Estimate 0.2-0.5 ms UHD, < 0.1 ms discrete (folded FXAA with similar taps measured 0.46-0.76 ms) | E-kernel (lc_output_pass.js only - can start now) | 1a | no (strength follows the render scale) |
| 11 | Scene depth texture (groundwork for all depth-based effects) | Nothing by itself. | Estimate 0-0.2 ms; about 14 MB at 2560x1440. ULTRA desktop only. | E-kernel | 1a | no (groundwork) |
| 12 | Screen-space ambient occlusion at half resolution, with short sun contact shadows in the same pass | Corners, wall bases, under cars and eaves, door frames, furniture legs and feet get soft contact darkening; buildings and props sit in the world instead of floating. | Estimate 0.6-1.6 ms on a discrete GPU at 1440p; 3-7 ms on the UHD (shed by the governor). Published references: 0.5 ms on PS4 at 1080p half-res (Activision GTAO), 2.3 ms at 720p on 2012 hardware (McGuire SAO). | E | 2 | yes (first heavy step to drop after shafts) |
| 13 | Real ground materials on ULTRA: photo normal + roughness layers from the CC0 sets already on F:, slope rock layer, near-foot detail sample, large-scale colour variation | Ground with relief at foot level: pebbles and soil catch the sun, dirt is glossier than grass, hillsides read as rock, and from the air the ground stops looking like one flat tint. | Estimate +0.45-1.25 ms GPU (layers 0.3-0.8, slope triplanar 0.05-0.25, near detail 0.05-0.1, macro 1 fetch); 0 draw calls; +35-70 MB GPU memory uncompressed | W | 2 | yes (uniform branch uLcUltra: normal/roughness fetch off) |
| 14 | Water pass 2: seabed refraction wobble, back-lit crest colour, contact foam round piers and rocks | The shallow seabed wobbles under the waves, crests glow turquoise against the sun, white foam rings where objects meet water. | Estimate +0.1-0.2 ms (arithmetic plus 1 fetch on water pixels); 0 draw calls | W | 1a | yes (uniform) |
| 15 | Leaf translucency and canopy colour gradient | Back-lit leaves glow green-gold looking toward the sun; crowns are darker inside and lighter at the tips. | Estimate +0.05-0.15 ms | W | 1a | no (too cheap to matter) |
| 16 | Effects pack that costs almost nothing: footstep dust and splashes, varied muzzle flashes with a side-view star and barrel smoke, tracer core + halo, surface-specific bullet holes with 256 decal slots, glowing explosion column and debris that bounces | Sprinting kicks up dust, every shot's flash looks different and reads from the side, rounds look like hot bolts, metal / wood / stone / glass each show their own bullet mark and a firefight leaves marks that stay, grenade smoke glows at its base and chunks bounce. | Each piece < 0.05 ms (estimate): all are extra quads in the existing single particle draw and the existing decal draw; 0 new draw calls | C (characters and effects) - waits for w10-anim-fix merge | 3 | yes (effect counts fall to the HIGH set: step 'fxq') |
| 17 | Longer character detail and shadow distances on ULTRA | Enemies at 40-80 m keep their full model and cast a ground shadow (today detail drops at 35 m and shadows at 45 m on every tier: verified player.js:2106-2107). | Estimate < 0.1 ms on a discrete GPU, 0.2-0.4 ms UHD; adds skinned draws to CPU submit (watch cpuRender) | C - waits for w10-anim-fix | 3 | yes (step restores the HIGH distances) |
| 18 | Skin and cloth shading: soft warm light wrap on skin, cloth sheen, no glints in seams | Faces and arms read as skin instead of plastic, fabric gets a soft grazing sheen, seams and pockets stop glinting. | Estimate < 0.1 ms | C - waits for w10-anim-fix | 3 | no (uniform, cost negligible) |
| 19 | Smoke grenades: slow churning billows and sun-lit edges | Smoke clouds churn instead of being a still picture and their edges glow when the sun is behind them. | Estimate +0.05-0.15 ms per close cloud on the UHD (the body costs about 0.2 ms for 3 clouds, code comment) | C - waits for w10-anim-fix (lane rule; fx.js only) | 3 | yes (second sample off) |
| 20 | Close-up character shadow map (crisp self-shadow on your own character and near actors) | The gun shades the chest, arms shade the torso, the helmet shades the face. Today a 1.8 m body gets 13.7 cm shadow texels - blotches (and ULTRA is coarser than HIGH's 10.7 cm). | Estimate 0.05-0.1 ms on a mid discrete GPU, 0.3-0.5 ms UHD; +1 small depth pass of up to 4 actors | X (cross-cutting, runs alone): needs BOTH merges | 4 | yes (step 'charshadow') |
| 21 | Soft particles: dust, blast and smoke puffs melt into walls and ground | No more hard straight cut lines where smoke and dust meet a wall or the floor. | Estimate 0.05-0.15 ms GPU on a mid discrete GPU, 0.4-0.9 ms UHD, plus 0.1-0.3 ms CPU for the second effects-only traversal | X: kernel + fx.js (needs item 11 and the w10-anim-fix merge) | 4 | yes (step 'softfx') |
| 22 | Height fog with a warm glow toward the sun | Distance reads as depth: bluer, hazier far hills, low mist in valleys, warm haze toward the sun. | Estimate 0.1-0.3 ms | X: ffg_royale3d.js + maps.js (needs w10-friends merged) | 4 | no (define; cheap) |
| 23 | Per-map colour grade (3D lookup table) in the output pass | A filmic look per map: warm Savanna shadows, lush Isla greens, cold Deepwood blues. | Estimate 0.1-0.2 ms | E for the shader; the per-map tables go in lane X | 2 (shader), 4 (per-map tables) | no |
| 24 | Capture the real map once at match start for reflections; scope-lens glass | Gun steel, cars and windows reflect the map's actual sky and ground colours; sniper and DMR scopes show coated glass. | 0 ms per frame; about 10-30 ms once at load (estimate) | X: maps.js + weapons.js (needs w10-anim-fix merged) | 4 | no (load-time) |
| 25 | Light from muzzle flashes and explosions (4-slot uniform light pool, no real point lights) | Gunfire flickers on nearby walls, floors and your own character, most of all indoors; a grenade lights the ground orange for a moment. | 0 ms with no light live; estimate 0.05-0.15 ms on a mid discrete GPU and 0.3-1.0 ms UHD while a slot is live (muzzle slots live 75 ms) | X: ffg_royale3d.js + fx.js (needs BOTH merges) | 4 | yes (step 'fxlight': explosions only, then off) |
| 26 | Grass that takes building and tree shadows, parts round every actor, and steadier far tuft edges | Grass in a house shadow is dark like the ground under it; blades bend away from players and bots alike; far tufts stop sizzling. | Estimate +0.05-0.4 ms | W | 2 | yes (blade shadows off through uLcUltra) |
| 27 | Real wall, roof and road materials (normal + roughness), rain streaks under sills, softer road edges | Brick with mortar depth, wood grain, clay roof tiles, streaks under window sills, asphalt grain and no repeating crack pattern. | Estimate +0.15-0.4 ms; 0 draw calls | W | 2 | yes (uniform) |
| 28 | Storm wall with flowing haze, ground mist and lightning that lights the land; explosion shockwave ripple | The storm is a moving wall of haze with mist at its foot; lightning briefly brightens the land; a grenade warps the air in a quick ring. | Estimate +0.2-0.5 ms UHD when the wall fills the view, about 0 when far; shockwave 0.1-0.2 ms for 0.3 s per blast | X: storm.js + fx.js + lc_output_pass.js (needs w10-anim-fix merged) | 4 | yes (noise layers and mist off) |
| 29 | Two sun-shadow cascades with a cached far map and contact-hardening edges | Shadows near you become 4-5x sharper (window frames, railings, leaves) and soften with distance from the caster; far shadows still reach the hills. | UNKNOWN until measured. Estimates: -0.5 to +1.5 ms GPU net against today's every-frame 4096 map; shadow draws from 8-16 to 20-35 per frame (counts against the +40-call bar) | X, last and alone: ffg_royale3d.js + maps.js + player.js + ffg_warmup.js (needs BOTH merges) | 5 (go / no-go after M2, M5 and item 20) | yes (cascades -> single map) |
| 30 | Local reflection probe refreshed in slices near the player | Water mirrors the real palms, houses and hills; shop windows reflect the street. | About 0 on most frames; estimate +0.5-2 ms on each of about 7 capture frames, one capture per 10-30 s. Each capture face is a full scene submission: CPU cost on the box where CPU is the limit. | X: maps.js + citykit.js + ffg_royale3d.js (needs w10-friends merged) | 5 | yes (probe refresh off; never during a fight) |
| 31 | Sun shafts when facing the sun | Light shafts through canopies, between towers and over ridgelines in the drop. | Estimate 0.3-0.8 ms discrete, 1-2 ms UHD, 0 facing away | E | 5 | yes (first step to drop) |
| 32 | Wet characters after swimming | Clothes go darker and glossier for about 20 s after leaving the water, with a few drips. | About 0 ms (estimate) | C | 5 | no |
| 33 | Later list, ordered by gain per ms: dithered LOD cross-fade; layer height-blending + anti-tiling; near-ground parallax depth; ground clutter atlas + snow photo; mip sharpening on ground and roads; interior mapping for far windows; far-tree impostors; visible bloom tuning (only emissives glow); 3D shell casings; interior occlusion culling; three.js per-frame garbage cleanup; far characters as one instanced draw; texture compression (KTX2) for 2K sets; indoor/outdoor exposure easing; scope-only foreground blur; temporal AA as an A/B option; water-only screen-space reflections; camera-following wave patch | No popping, no repeating tiles from the air, depth in gravel at your feet, flowers and pebbles, lit rooms behind far windows, real-looking distant forests, tasteful glow on flashes, fewer random hitches. | Audit estimates: cross-fade +0.02-0.1; anti-tiling +0.1-0.4; parallax +0.2-0.7; clutter +0.05-0.2; mip bias +0.02-0.1; interior mapping +0.05-0.2; impostors -0.2 to +0.2; casings 0.05 and +1 call; interior occlusion saves unknown; garbage cleanup trims p99 only; instanced far characters save 0.5-1.5 ms CPU and 20-40 calls (high effort); KTX2 saves 0.1-0.5; exposure easing 0; scope blur 0.3-0.8 while scoped; temporal AA 0.5-1.0; water reflections 0.5-1.5 | W, then E, then C - one item at a time | 6+ (one at a time, each a go / no-go after measurement) | each gets its own step when scheduled |

## 3. Build lanes and rounds

- Lane names and file ownership (no file is in two lanes at once). W = world: runtime/3d/royale/maps.js (one lane at a time), housegen.js, citykit.js, assets/tex. E = engine/post: runtime/3d/ffg_kernel_3d.js, lc_output_pass.js, ffg_warmup.js, new lc_ao_pass.js, and ffg_royale3d.js. C = characters and effects: runtime/3d/royale/player.js, fx.js, weapons.js, storm.js, loot.js. X = cross-cutting items that need files from two lanes: runs ALONE, one item at a time. M = measurement (harness only).
- WAITS: lane C and every X item touching player.js / weapons.js / fx.js wait for the animation lane's branch w10-anim-fix to merge (it edits player.js, pose.js, weapons.js: verified with git diff --name-only). Every item touching ffg_royale3d.js (items 1, 2, 9 wiring, 12 wiring, 20, 22, 25, 29, 30) waits for the friends-rooms branch w10-friends to merge (it edits ffg_royale3d.js, net.js, hud.js, and also _harness/common.py and p23lib.py: verified). Lane W (maps.js) and the kernel / output-pass half of lane E touch none of those files and can start now. No lane ever touches hud.js or net.js.
- At most 2 lanes at once. One measuring agent at a time on a quiet box; no browser work until the agents now using the machine are finished.
- Round 0 - lane M alone: measure-first M1-M6 with the existing 'dgpu' harness profile (no edit to _harness/common.py, which w10-friends is changing). Sets the discrete-GPU ULTRA baseline every later test refers to.
- Round 1a (can start before either merge) - lane W: items 4 (world half), 5, 6, 7, 8, 14, 15, plus exposing the ULTRA switches (one uLcUltra uniform and live-tunable grass / clutter / ring / proxy counts) for the governor to call later. In parallel lane E-kernel (ffg_kernel_3d.js, lc_output_pass.js, ffg_warmup.js only): items 3, 10, 11, the fixed-target plumbing of item 9, and per-pass GPU timers behind ?prof=2.
- Round 1b (after w10-friends merges) - lane E: items 1, 2 and the tier wiring of item 9 in ffg_royale3d.js. Lane W keeps going beside it.
- Round 2 - lane E: item 12 (AO + contact shadows) and the shader half of item 23. Lane W: items 13, 26, 27.
- Round 3 (after w10-anim-fix merges) - lane C: items 16, 17, 18, 19 and the skeleton half of item 4. Second lane: W finishing round 2, or idle.
- Round 4 - lane X alone, one item at a time, both merges done: 20 (close-up character shadow), 21 (soft particles), 24 (match-start reflection capture), 22 (height fog) with item 23's per-map tables, 25 (effect light pool), 28 (storm wall + shockwave).
- Round 5 - go / no-go after re-measuring: lane X items 29 (cascades, last) and 30 (probe); lane E item 31 (sun shafts) alongside lane C item 32 when X is idle.
- Round 6+ - the item 33 list, one at a time.
- After every round: the full existing gate battery (p23_tierprof, framecheck, perf_district incl. --phone and --identical, interiorcheck, stormfx, w10_gunhold, w10_waterlook) by ONE agent on a quiet box, the new discrete-GPU ULTRA rows, and a blind A/B of ULTRA before / after judged in motion, not only from stills.

## 4. Acceptance test per item

Every item has a measurable look row, a planted fault that must make that row fail, and a frame-time bar. 'STD' is the standard frame bar defined at the end of section 1.

**1. Refresh-aware ULTRA fps governor (extend the existing quality ladder)**  
Files: runtime/3d/ffg_royale3d.js (LADDER_ALL :443, thresholds :768, ladderSteps/ladderFrame :783-857, applyTier), runtime/3d/ffg_kernel_3d.js (rawMs / CPU frame time), runtime/3d/ffg_warmup.js  
Why: Large enabler. Today the ladder only acts above 22 ms GPU (about 45 fps) and only sees GPU time, while the discrete GPU box is limited by CPU submission. New: target = measured display interval (floor 6.9 ms, fallback 16.7); step down when GPU p75 OR CPU-frame p75 > 0.9 x target, up after 4 s under 0.7 x target. ULTRA-only steps placed before today's, in this order: sun shafts, AO + contact shadows, effect lights, soft particles, close-up character shadow, reflection-probe refresh, surface extras (parallax, terrain PBR, blade shadows), effect counts ultra -> high set, grass radius 60 -> 45 m, clutter 2900 -> 1700, tree proxies 112 -> 72, then SMAA -> FXAA, render scale, bloom off, shadow 2048, DPR caps.  
Test: Look row: none (invisible when idle). Planted fault: inject +10 ms fake GPU load and, separately, +4 ms fake CPU load; the ladder must log a step down within 3 s and step back up within 6 s of removal, with 0 new programs. Frame bar: STD; low/medium/high ladder behaviour byte-identical (scoped to ULTRA desktop). Governor step: it is the governor.  
Governor step: IS the governor.  
Risk: Low-medium. Oscillation on variable-refresh displays (keep 4 s hold, 2 s gap). The exact trigger needs measure-first M1; a 'target fps' Video option is an owner call (settings menu, not HUD).

**2. Half-resolution bloom chain on ULTRA (buys headroom)**  
Files: runtime/3d/ffg_royale3d.js :429 (BLOOM_RES.ultra 1 -> 0.5; verified this session)  
Why: Headroom for AO and shadows.  
Test: Look row: frozen-frame ULTRA before/after diff, max channel delta <= 10/255 (bloomres_check on ULTRA). Planted fault: BLOOM_RES.ultra 0.25 must fail that row. Frame bar: ULTRA GPU median must fall against the 18.80 ms UHD baseline; STD.  
Governor step: yes (full-res chain can be the top level, dropped first).  
Risk: Very low; the ULTRA 'tiers' SSIM baseline must be re-read.

**3. Stop keeping the drawing buffer for players (harness keeps it)**  
Files: runtime/3d/ffg_kernel_3d.js :288-298 (preserveDrawingBuffer: true, verified)  
Why: Free headroom on every tier.  
Test: Look row: player-mode frame is pixel-identical to today (captured through the harness flag). Planted fault: remove the flag under AUTOMATED - every screenshot gate must fail with a blank capture, proving the harness path is what is tested. Frame bar: A/B on frozen frames on the discrete GPU must show frame time <= today; STD.  
Governor step: no (always on).  
Risk: Low. The flag must stay on under AUTOMATED / ?pdb=1 or every vision gate breaks.

**4. Cut CPU render submission: static objects stop recomputing matrices; skipped far skeletons freeze**  
Files: runtime/3d/royale/maps.js, housegen.js, citykit.js (matrixAutoUpdate = false on static meshes; today only 5 places set it: verified grep, maps 1, citykit 4); runtime/3d/royale/player.js (~:2250-2300, mixer-skipped actors)  
Why: Buys the scarcest resource on the target box.  
Test: Look row: 600-frame scripted run is pixel-identical before/after (doors, loot, near proxies still move). Planted fault: freeze a door leaf's matrix - the door gate must fail. Frame bar: discrete-GPU cpuRender p50 must drop; STD.  
Governor step: no (always on).  
Risk: Medium: anything that moves must keep auto-update; freeze a skeleton only when its body casts no shadow.

**5. Fix the reflection-sky sun direction per map (a defect)**  
Files: runtime/3d/royale/maps.js :1571-1601 (fixed sun quad at (30,34,16), :1594 verified)  
Why: Medium, free.  
Test: Look row: highlight on a chrome test sphere within 15 degrees of the map's sun on all 3 maps. Planted fault: restore the fixed (30,34,16) quad - the Savanna row must fail. Frame bar: STD; LOW / phone screenshots bit-identical (gate the change to desktop medium+).  
Governor step: no (load-time).  
Risk: Low; check skin does not go glossy (M9).

**6. Fog-aware draw distance (buys headroom)**  
Files: runtime/3d/royale/maps.js (TIER_Q :1506-1512, district cull :5337, fog height :2015-2028)  
Why: Frees triangles and calls for near detail.  
Test: Look row: ground and drop screenshots SSIM >= 0.995 before/after. Planted fault: use the ground density while at altitude - a far tower pops and the row fails. Frame bar: perf_district triangles and calls <= baseline (must go down); STD.  
Governor step: no (always on; it is itself a saving).  
Risk: Low; must use the same altitude-thinned density the shader uses that frame.

**7. Cheaper ULTRA terrain near ring**  
Files: runtime/3d/royale/maps.js :1639-1760  
Why: Pays for groves and blade shadows.  
Test: Look row: pinned far-ridge view SSIM >= 0.99; silhouette edge shift <= 1 px. Planted fault: outer ring at far density - the silhouette row must fail. Frame bar: ULTRA triangles down by >= 100k in the ground view; STD.  
Governor step: yes (ring 2 -> 1 is a governor step).  
Risk: Low; cliff silhouettes may soften.

**8. Park unused point lamps and confirm effect / loot distance culling**  
Files: runtime/3d/royale/maps.js :6716-6740; later fx.js, loot.js  
Why: Small headroom.  
Test: Look row: lamp-lit night-room crop unchanged within 2/255. Planted fault: change the light COUNT mid-match - the 'programs' row must fail (proves the step is intensity-only). Frame bar: STD.  
Governor step: partly (lamps 6 -> 4 by intensity only).  
Risk: Low.

**9. Render scale above native on ULTRA with smooth dynamic resolution (fixed-size targets, no reallocation)**  
Files: runtime/3d/ffg_kernel_3d.js (setDpr ~550-590, composer), runtime/3d/lc_output_pass.js (UV scale), runtime/3d/ffg_royale3d.js (applyTier, ladder)  
Why: Large - the most visible 'ultra' upgrade, and the same mechanism lets ULTRA dip to 0.85 in a fight instead of stuttering.  
Test: Look row: frame-to-frame luma variance on a fence / foliage strip in a slow pan lower than HIGH by a set margin. Planted fault: force scale 1.5 with the governor off and +8 ms fake load - the frame bar must fail. Frame bar: discrete-GPU p75 under the governor target; 0 new programs; no target reallocation during a match; STD.  
Governor step: yes (the scale IS a governor lever, 0.05-0.125 steps).  
Risk: Medium: bloom and AA must run at the scaled viewport; VRAM about 60-70 MB at 1440p x1.5 (estimate).

**10. Sharpening (AMD CAS / FSR1 RCAS, MIT) folded into the output pass**  
Files: runtime/3d/lc_output_pass.js; strength set from ffg_royale3d.js later  
Why: Small, near free; pairs with item 9.  
Test: Look row: edge acutance on a test chart up; halo overshoot <= 4/255. Planted fault: strength 1.5 - the halo row must fail. Frame bar: strength 0 output bit-identical; output pass delta <= 0.5 ms on the UHD; STD.  
Governor step: no (strength follows the render scale).  
Risk: Low.

**11. Scene depth texture (groundwork for all depth-based effects)**  
Files: runtime/3d/ffg_kernel_3d.js (enableBloom :668-690), runtime/3d/ffg_warmup.js  
Why: Unlocks AO, contact shadows, soft particles, sun shafts.  
Test: Look row: depth readback at 3 known distances within 1 %. Planted fault: attach depth to only one composer buffer - alternate frames fail the readback. Frame bar: 0 new programs; medium / high / low bit-identical; STD.  
Governor step: no (groundwork).  
Risk: Low-medium (composer buffer swap, warm-up variants).

**12. Screen-space ambient occlusion at half resolution, with short sun contact shadows in the same pass**  
Files: new runtime/3d/lc_ao_pass.js, ffg_kernel_3d.js, lc_output_pass.js, ffg_royale3d.js  
Why: Large - answers the audit's 'lighting is flat'.  
Test: Look row: mean luminance in a wall-base strip drops 8-20 % while open ground changes < 2 %; interiors stay >= 0.15. Planted fault: AO strength 1.0 - the interior row must fail. Frame bar: on the UHD the governor must shed it and return to the baseline GPU median; discrete p75 under target; STD.  
Governor step: yes (first heavy step to drop after shafts).  
Risk: Medium: halos at depth edges, noise on grass cards, darkening tuned interiors.

**13. Real ground materials on ULTRA: photo normal + roughness layers from the CC0 sets already on F:, slope rock layer, near-foot detail sample, large-scale colour variation**  
Files: runtime/3d/royale/maps.js (PHOTO_FILES :267, patchTerrainPhoto :306-338, splat :1680-1700, splatAt :774, LCU :341-370), assets/tex/ground_*_n / _r (ambientCG CC0, from F:/3d-asset-packs/terrain-textures), CREDITS.md  
Why: Large - the ground is 40-60 % of a third-person frame.  
Test: Look row: normal-map variance on a ground crop above threshold; specular response differs between dirt and grass crops. Planted fault: flip the normal green channel - a lighting-direction row must fail. Frame bar: terrain delta <= 1.3 ms discrete; 0 new programs mid-match; minimap and footstep-surface rows unchanged; STD.  
Governor step: yes (uniform branch uLcUltra: normal/roughness fetch off).  
Risk: Low-medium: +1 terrain program (pre-warm); shadow bias may need a retune; check R4A is not already built on a lane branch first (M12).

**14. Water pass 2: seabed refraction wobble, back-lit crest colour, contact foam round piers and rocks**  
Files: runtime/3d/royale/maps.js (LC_WATER2 :555-596, :691-715; LC_WET :609-659)  
Why: Medium. Camera-following vertex waves stay deferred (+1 draw call, waterline risk).  
Test: Look row: foam pixels within 1 m of a pier > 0 and 0 in open water; seabed offset varies over time. Planted fault: invert the foam mask - the open-water row must fail. Frame bar: Isla Viva shore view delta <= 0.3 ms; STD.  
Governor step: yes (uniform).  
Risk: Low. Judge in motion: the last water round was judged from stills only.

**15. Leaf translucency and canopy colour gradient**  
Files: runtime/3d/royale/maps.js (windMat :6800, WIND_K :6797)  
Why: Medium, cheap.  
Test: Look row: canopy luminance facing the sun exceeds the away side by a set ratio. Planted fault: flip the sun term's sign - the row must fail. Frame bar: forest view delta <= 0.2 ms; STD.  
Governor step: no (too cheap to matter).  
Risk: Low.

**16. Effects pack that costs almost nothing: footstep dust and splashes, varied muzzle flashes with a side-view star and barrel smoke, tracer core + halo, surface-specific bullet holes with 256 decal slots, glowing explosion column and debris that bounces**  
Files: runtime/3d/royale/fx.js (wireEvents, muzzleFlash :552-595, tracers :1611-1631, decals :628-720, impactFx :747-831, explosionFx :835-910), assets/fx/fx_sheet.png (Kenney Particle Pack, CC0), CREDITS.md  
Why: Medium, near free. Verified gap: player.js:2551 emits 'footstep' and fx.js has no listener.  
Test: Look row: dust puff pixels > 0 under a sprinting actor on sand and 0 on a wood floor; flash shape variance across 20 shots > 0; the decal crop differs by surface. Planted fault: 200 KB/frame allocation plant must fail the kb row (proves the new handlers allocate nothing); flash scale x3 must fail the glare bar (<= 8x). Frame bar: scripted firefight + 2 grenades GPU delta <= 0.2 ms; kb <= 85; qc <= 150 (no new collider queries); STD.  
Governor step: yes (effect counts fall to the HIGH set: step 'fxq').  
Risk: Low-medium: the glare bar and the w10_gunhold flash rows must still pass; touch keeps its own sheet.

**17. Longer character detail and shadow distances on ULTRA**  
Files: runtime/3d/royale/player.js (constants :2106-2107, actorView)  
Why: Medium.  
Test: Look row: an actor at 60 m draws LOD0 and a shadow blob under it on ULTRA, and neither on HIGH. Planted fault: LOD distance 500 m - the framecheck skinned-triangle and drop-cluster rows must fail. Frame bar: perf_district triangles <= x1.25; discrete cpuRender p50 not above baseline + 0.2 ms; STD.  
Governor step: yes (step restores the HIGH distances).  
Risk: Low.

**18. Skin and cloth shading: soft warm light wrap on skin, cloth sheen, no glints in seams**  
Files: runtime/3d/royale/player.js (body shader patch ~:965-1006)  
Why: Medium - your own character is always on screen.  
Test: Look row: skin crop shadow-edge hue shifts warm by a set amount; w10_gunhold sheen row still <= 0.6x. Planted fault: sheen x5 - the sheen row must fail. Frame bar: with the uniform at 0 the output is bit-identical; LOW / touch pixel-identical after the one program-key bump; STD.  
Governor step: no (uniform, cost negligible).  
Risk: Low-medium.

**19. Smoke grenades: slow churning billows and sun-lit edges**  
Files: runtime/3d/royale/fx.js (SMOKE_VS/FS :943-1050, smokeLights :1194-1216)  
Why: Medium.  
Test: Look row: smoke crop changes frame to frame while its opacity mask stays equal to the sim's sight-blocking chord. Planted fault: opacity x0.8 - the smoke sight gate must fail. Frame bar: 3 clouds delta <= 0.3 ms; STD.  
Governor step: yes (second sample off).  
Risk: Low; visible opacity must stay exactly the sim's.

**20. Close-up character shadow map (crisp self-shadow on your own character and near actors)**  
Files: runtime/3d/royale/player.js (body patch ~:948), runtime/3d/ffg_royale3d.js (frame pipeline ~:947-980), runtime/3d/royale/weapons.js  
Why: Large for its cost; the cheap first answer to the ULTRA shadow complaint. Build before cascades and re-judge whether cascades are still needed.  
Test: Look row: shadow edge width of the held gun on the chest <= 3 cm. Planted fault: drop the gun from the layer set - the row must fail. Frame bar: kb per frame +0; with the uniform off LOW and touch are pixel-identical; shadow share of drop triangles stays < 30 %; STD.  
Governor step: yes (step 'charshadow').  
Risk: Medium: double shadow at the box edge needs a fade.

**21. Soft particles: dust, blast and smoke puffs melt into walls and ground**  
Files: runtime/3d/ffg_kernel_3d.js (split render pass + depth copy), runtime/3d/royale/fx.js (FX_FS, SMOKE_FS)  
Why: Large.  
Test: Look row: alpha gradient across a puff / wall intersection spans >= 6 px (today 1 px). Planted fault: sample the attached depth directly (no copy) - the console-error row must fail on the feedback-loop error. Frame bar: 0 new programs; kb-rendered not above baseline; STD.  
Governor step: yes (step 'softfx').  
Risk: Medium: changes the composer route; ULTRA desktop only.

**22. Height fog with a warm glow toward the sun**  
Files: runtime/3d/ffg_royale3d.js :125-165, runtime/3d/royale/maps.js (MAPS table, sky dome ~1881-1940, fog :1605)  
Why: Medium.  
Test: Look row: fog toward the sun warmer than away; fog blend at 300 m no higher than today. Planted fault: double the density - the 300 m enemy-visibility row must fail. Frame bar: delta <= 0.3 ms; STD.  
Governor step: no (define; cheap).  
Risk: Low-medium; competitive visibility is the guard.

**23. Per-map colour grade (3D lookup table) in the output pass**  
Files: runtime/3d/lc_output_pass.js, assets/tex/lut_*.png (own-authored), runtime/3d/royale/maps.js (MAPS.grade)  
Why: Medium, cheap.  
Test: Look row: drop-view mean luminance stays 0.45-0.50 and interiors >= 0.15. Planted fault: a crushed-blacks table - the interior row must fail. Frame bar: amount 0 is bit-identical; STD.  
Governor step: no.  
Risk: Low.

**24. Capture the real map once at match start for reflections; scope-lens glass**  
Files: runtime/3d/royale/maps.js (after buildEnvironment :1562-1600), runtime/3d/royale/weapons.js (:191-232, :347-423)  
Why: Medium, free per frame; the cheap first stage of the reflection probe (item 30).  
Test: Look row: a chrome sphere at spawn shows the ground colour in its lower half and sky above. Planted fault: capture before the map is built - the row must fail (all sky). Frame bar: houseload x1.25; 0 new programs after warm-up; LOW / touch untouched; STD.  
Governor step: no (load-time).  
Risk: Low-medium: one new gun program in the warm-up. No HDRI files are used (their licence is unconfirmed).

**25. Light from muzzle flashes and explosions (4-slot uniform light pool, no real point lights)**  
Files: runtime/3d/ffg_royale3d.js (global compile hook :186-200), runtime/3d/royale/fx.js (muzzleFlash, explosionFx, SMOKE_FS)  
Why: Large - the signature 'top game' effect indoors.  
Test: Look row: wall luminance within 3 m of a muzzle rises during the 75 ms flash and is unchanged at 30 m. Planted fault: intensity x10 - the glare bar (<= 8x) must fail. Frame bar: 0 new programs after boot; LOW and touch programs byte-identical; STD.  
Governor step: yes (step 'fxlight': explosions only, then off).  
Risk: Medium-high: touches every lit desktop program's source; warm-up and route-key rules apply.

**26. Grass that takes building and tree shadows, parts round every actor, and steadier far tuft edges**  
Files: runtime/3d/royale/maps.js (blades :7318-7400, receiveShadow false at :7387 verified; tufts :7238)  
Why: Medium.  
Test: Look row: blade luminance inside a house shadow within 15 % of the shadowed ground. Planted fault: receiveShadow off - the row must fail. Frame bar: grass view delta <= 0.4 ms; blades still absent on LOW / touch; STD.  
Governor step: yes (blade shadows off through uLcUltra).  
Risk: Low-medium; +1 program on ULTRA. Bending must apply to every actor or it becomes a tell. First confirm the defect with one still (M11).

**27. Real wall, roof and road materials (normal + roughness), rain streaks under sills, softer road edges**  
Files: runtime/3d/royale/maps.js (structTex :153-160, dualStructMaterial :6559-6590, KIND_PBR :6538, LC_GRIME :539-548, road :6761), new CC0 sets in assets/tex, CREDITS.md  
Why: Medium.  
Test: Look row: wall crop normal variance above threshold; road autocorrelation peak at the tile period falls. Planted fault: wrong texel density (x4) - the wall-detail row must fail. Frame bar: town view delta <= 0.4 ms; interior light rows green; STD.  
Governor step: yes (uniform).  
Risk: Low-medium: +1 program per wall kind on ULTRA.

**28. Storm wall with flowing haze, ground mist and lightning that lights the land; explosion shockwave ripple**  
Files: runtime/3d/royale/storm.js (WALL_FS :125+, :515), runtime/3d/royale/fx.js, runtime/3d/lc_output_pass.js  
Why: Medium.  
Test: Look row: wall crop changes over time (flow) and the silhouette-contrast cap (60 %) holds. Planted fault: streak brightness x3 - the stormfx glare row (<= 2x) must fail. Frame bar: wall-filling view delta <= 0.5 ms; shockwave off = bit-identical; STD.  
Governor step: yes (noise layers and mist off).  
Risk: Low-medium.

**29. Two sun-shadow cascades with a cached far map and contact-hardening edges**  
Files: runtime/3d/ffg_royale3d.js (:506-559, followShadow :945-1010), runtime/3d/royale/maps.js, runtime/3d/royale/player.js, runtime/3d/ffg_warmup.js  
Why: Large but the riskiest item.  
Test: Look row: shadow edge of a 5 cm railing at 5 m <= 4 cm wide. Planted fault: near cascade without characters - the character-shadow row must fail. Frame bar: perf_district calls <= +40 and triangles <= x1.25 including shadow passes; discrete cpuRender p50 not above baseline + 0.5 ms; STD.  
Governor step: yes (cascades -> single map).  
Risk: High: re-keys every lit program, cascade seams, whole-map instanced meshes are never culled so each cascade resubmits them.

**30. Local reflection probe refreshed in slices near the player**  
Files: runtime/3d/royale/maps.js (:1571-1602, :691-715, glass :4816-4830), runtime/3d/royale/citykit.js :691-695, runtime/3d/ffg_royale3d.js  
Why: Large, but only after item 24 has shown what a static capture already gives.  
Test: Look row: a red test wall at the shore appears in the water reflection crop. Planted fault: capture all 6 faces in one frame - the p99 frame-time row must fail. Frame bar: p99 not above today's; 0 new programs; STD.  
Governor step: yes (probe refresh off; never during a fight).  
Risk: Medium: capture spikes; reflections only right near the capture point.

**31. Sun shafts when facing the sun**  
Files: runtime/3d/ffg_kernel_3d.js, runtime/3d/lc_output_pass.js, runtime/3d/royale/maps.js (sun uniform, via lane X)  
Why: Medium.  
Test: Look row: shaft energy > 0 with the sun on screen and exactly 0 at 90 degrees off. Planted fault: strength x4 - the crosshair-area contrast row must fail. Frame bar: delta <= 0.8 ms discrete; STD.  
Governor step: yes (first step to drop).  
Risk: Medium; glare can hide enemies.

**32. Wet characters after swimming**  
Files: runtime/3d/royale/player.js, runtime/3d/royale/fx.js  
Why: Small, free.  
Test: Look row: cloth crop luminance x0.7 (+-0.1) right after a swim and back to 1.0 by 25 s. Planted fault: no decay - the 25 s row must fail. Frame bar: kb +0; STD.  
Governor step: no.  
Risk: Low.

**33. Later list, ordered by gain per ms: dithered LOD cross-fade; layer height-blending + anti-tiling; near-ground parallax depth; ground clutter atlas + snow photo; mip sharpening on ground and roads; interior mapping for far windows; far-tree impostors; visible bloom tuning (only emissives glow); 3D shell casings; interior occlusion culling; three.js per-frame garbage cleanup; far characters as one instanced draw; texture compression (KTX2) for 2K sets; indoor/outdoor exposure easing; scope-only foreground blur; temporal AA as an A/B option; water-only screen-space reflections; camera-following wave patch**  
Files: runtime/3d/royale/maps.js, housegen.js, citykit.js, fx.js, player.js, assets/vendor/three/**, new lc_taa_pass.js / lc_ssr_pass.js, new _tools/bake_impostors.mjs and bake_vat tool  
Why: Small to medium each.  
Test: Each gets the same three-part test when scheduled: one measurable look row, one planted fault that must fail it, and the STD frame bar with a governor step where it costs more than 0.2 ms.  
Governor step: each gets its own step when scheduled.  
Risk: Medium to high (temporal AA ghosting, water reflections and the instanced-character bake are the high ones).

## 5. Rejected or held, with reasons

- Real three.js PointLights for muzzle flashes and blasts: adding a light forces a shader recompile across every material (fx.js:623-627). Replaced by the uniform light pool (item 25).
- Stock three.js CSM addon: it patches the same shader chunk as the game's own lcPatch chain and the canvas-output patch, and it is not in the vendored three (checked: no csm folder). A hand-rolled two-cascade version is planned instead (item 29), and only after the cheaper close-up character shadow (item 20).
- A fixed tighter ladder trigger (the first plan's 15 / 11 ms): superseded by the refresh-aware target with a CPU signal; a fixed number would leave weak machines permanently stepped down and 144 Hz machines unprotected.
- Planar water reflection (re-rendering the scene mirrored) and a normal pre-pass for AO: each is a second scene submission on a frame limited by CPU draw submission.
- Sniper vapour trails and freefall / glide trails as ULTRA extras: they reveal player positions, so they are game information. Either every tier gets them or none: owner decision, not part of the ULTRA plan.
- Blood decals: a content and rating choice for the owner; not built without a ruling. Surface bullet marks go ahead without them.
- Baking ambient occlusion into the five Meshy character models: it re-exports the character files, close to the plan's 'never re-roll' rule; needs the owner's OK. Screen-space AO (item 12) and the close-up shadow (item 20) cover most of the look.
- Camera hit pulse and lens droplets: an owner taste call that could read as a HUD change (the HUD is signed off); held for a ruling, with an off switch if approved.
- Grass bending only round the local player: a tell. Kept only in the form where every actor bends grass (item 26).
- The HDRI files at F:/AssetLibrary/luminascape_pending/hdri: no licence file found. The map's own match-start capture is used instead (item 24).
- Motion blur and full-screen depth of field: hurt target tracking in a shooter. Only a scope-only foreground blur stays, in the later list.
- Ray-traced or WebGPU-only features (ray-traced shadows or reflections, Lumen-style lighting, Nanite-style geometry, DLSS / FSR 2+): not available in WebGL2.
- True volumetric fog: too costly in WebGL2; height fog plus screen-space sun shafts cover the look.
- Vertex water waves that change swim height or the waterline: a simulation change. A visual-only wave patch stays in the later list.
- The 'bloomFold' path: measured saving 0.06 ms and it broke bit-identity (ffg_kernel_3d.js:697-703).
- Tuning ULTRA for the Intel UHD iGPU, or lowering any existing bar: the iGPU auto-picks medium and is already at 18.8 ms on ULTRA; the governor sheds there instead.
- Wave 10 R4A world content (tree variants, groves, snow, road anti-tile, clutter): not rejected, but it is world content for every tier with its own plan (F:/lc_p23/w10/PLAN.md:484-547); only the ULTRA shader terms are taken here.
- Any paid asset or tool, any non-Mixamo animation, any change to phones, LOW or the HUD layout.
- The audit's 'cost table for candidate features' and 'add discrete-GPU bars' ideas are not build items: the first became planning rule 3, the second is measure-first M1 and M6.

## 6. What must be measured first

- M1. ULTRA in a real match on the discrete GPU (RTX A2000 laptop, harness profile 'dgpu') at 1920x1080 and 2560x1440, DPR 1 and 2, all 3 maps, in drop, town ground, interior and endgame views: CPU frame, three.js render-submit time, GPU ms, p50 / p75 / p99. No such number exists; without it the free-millisecond figure and the governor target are guesses. Also repeat MEDIUM after Wave 10 (the only discrete-GPU run is from Oct 19, before the dense grass, water and furnished homes).
- M2. Per-pass GPU time for today's ULTRA frame: shadow pass (4096, every frame), scene, grass, water, full-res bloom, SMAA at the real ULTRA resolution, output pass. Only a whole-frame timer exists. Decides bloom, cascades and AO.
- M3. How much of the CPU render step is matrix updates and scene traversal (one CPU profile of a ground frame). Sets the real gain of item 4.
- M4. A/B on frozen frames on the discrete GPU: preserved drawing buffer on / off (item 3), and bloom chain 1 vs 0.5 on ULTRA with the pixel diff (item 2).
- M5. Shadow-pass draw calls and triangles at ground level per map, and how many whole-map instanced casters a second cascade would resubmit. Decides whether cascades need chunked shadow casters first.
- M6. Agree the discrete-GPU ULTRA bars with the owner as NEW rows (nothing existing is lowered). Proposed from today's numbers: CPU frame p50 <= 5.5 ms and p99 <= 8.3 ms, GPU p50 <= 6 ms at 1440p, ULTRA calls <= medium + 60. Also record which refresh rate the owner and players use (60 / 120 / 144 / 240 Hz) and why the iGPU display snaps to 20 ms.
- M7. Triangles and calls actually saved per map by the fog-aware cut and by the terrain ring trim (items 6, 7), and the draw-call room left under the +40 bar after Wave 10 R3 (the newest perf_district file found is from Wave 9).
- M8. Whether a depth texture on the composer targets survives the buffer swap and the warm-up, the cost of the depth copy at DPR 2, and how depth-based AO behaves on alpha-tested grass and foliage cards (look test).
- M9. Whether the reflection-sun fix changes character skin shine beyond the existing compensation (maps.js:1631).
- M10. Effects cost: a scripted firefight plus 2 grenades plus a smoke on ULTRA with the per-pass timer, on both GPUs. No report isolates the particle pool, decals or a blast. Also confirm the 'footstep' event fires for bots as well as the player.
- M11. One still of dense grass inside a house shadow on ULTRA, to confirm the blades really stay lit (inferred from the code, never seen).
- M12. Check that Wave 10 R4A terrain work does not already exist on a lane branch or worktree (F:/lcwt/p23-maps) before building item 13.
- M13. Visibility checks before any look change ships: interior luminance >= 0.15 under AO and grade; enemy contrast at 100-300 m under height fog, grade and sun shafts; the glare bar (<= 8x) for flashes, lights and lightning; the tiers gate (SSIM ULTRA vs medium <= 0.92); blind A/B in motion.
- M14. The Deepwood ground stalls on the discrete GPU (5 frames over 100 ms, worst 349 ms, Oct 19): find the cause. A governor cannot fix stalls.
- OWNER RULINGS NEEDED (not measurements): blood decals; position-revealing trails (all tiers or none); camera hit pulse and lens droplets; AO baked into the Meshy models; a 'target fps' option in the Video settings; whether a dusk / time-of-day preset is wanted (emissive windows only matter then).

## 7. How the 69 audit ideas were merged

- Governor: the lighting audit's 'ladder steps', the world audit's 'surface uniforms', the budget audit's 'refresh-aware governor' and the effects audit's 'effects steps + refresh target' are one item (1).
- Half-res bloom appeared in two audits (item 2); 'make bloom visible on purpose' moved to the later list.
- Shadows: cascades appeared in three audits and the soft-edge (PCSS) idea in one; merged as item 29, behind the cheaper close-up character shadow (item 20).
- Reflections: sun-direction fix (5), match-start capture for guns and world (24) and the sliced local probe (30) are three stages of one idea from three audits.
- Resolution: 'render scale above native', 'dynamic resolution without reallocation' and the two sharpening ideas are items 9 and 10.
- Depth: the depth texture (11) serves AO + contact shadows (12), soft particles (21) and sun shafts (31).
- Texture compression appeared in two audits; one entry in the later list.
- Terrain: PBR layers, slope rock, near detail sample and macro colour are item 13; height-blend, anti-tiling and parallax stay in the later list.
- Effects: footstep dust, muzzle variety, tracer halo, decal atlas and explosion column / debris are item 16; smoke is 19; storm wall and shockwave are 28.
