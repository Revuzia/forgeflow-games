# Last Circle: "look more like BridgeZone" plus next steps. Merged PLAN (2026-10-05, v2)

Owner asks (verbatim): "check the best way to improve these things. also is there any way to further improve
graphics?" and "I want last circle looked a little more like this" (a BridgeZone video).

Status: RESEARCH ONLY. No game file was changed. This is the only repo file written.

Evidence folder (scratch, not in the repo):
`C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_look/`
(written `LOOK/` below).

## How this version was built, and what changed since the first draft

- **Primary source:** the structured results of six research lanes (visual-gap, lighting-post, world-towns,
  camera-characters, hud-vfx, next-steps) and the skeptic's verdict on each recommendation. Merge rules applied: what
  the skeptic CUT is dropped (section 5); where it said MODIFY, its corrected version is used; its MISSING items are added
  where they are backed by a probe or a code citation.
- **Gaps in the source, stated plainly:** some lane and skeptic texts reached this merge cut off part-way. For those
  items I used the lane's recommendation, the skeptic's probe files in `LOOK/*/review/`, and facts the first draft had
  already verified. Each such item is marked **(no full skeptic verdict reached the merge)**. They are: visual-gap R2-R4 (partly),
  the lighting-post clouds/height-fog/bloom/AA recs, world-towns 1b (partly) and 2a onward, camera-characters deaths/canopy/rim,
  hud-vfx loot (partly) and the HUD restyles, and next-steps DynRes/online.
- **Re-verified for this merge (tool output, 2026-10-05):** `maps.js:463-464` is `NeutralToneMapping` with exposure
  `1.15`. `player.js:2528` is `const firstPerson = scope;`. `player.js:1458` is the weapon-visibility line. `storm.js:45-56` is an
  additive `MeshBasicMaterial` on a 320 m cylinder at `y=120`, `renderOrder 5`. `loot.js:248-256` is an opaque `TorusGeometry`
  rarity ring. `player.js:342-346` fetches `<skin>_<clip>.glb`. `net.js:367` is `MAX_GUESTS = 3`. `CHANGELOG.md:1159` is the
  2026-07-20 "BRIGHT lighting" entry and `CHANGELOG.md:1308` holds the owner's "...all colours from the game." complaint. A
  fresh no-store fetch of the live CDN `index.html` still serves `ffg_boot3d.js?v=1789530264`, while the working copy is `?v=1790866476`.

### Where the first draft and the structured results disagree, and which is right

| Topic | First draft said | Structured results + skeptic say | Which is right, and why |
|---|---|---|---|
| Building draw calls | One `BatchedMesh` per colormap; calls 326 -> 317 (fewer) | three.js `renderer.info` counts a whole multi-draw as ONE call (vendored `three.module.js:4011`), and Chrome emulates `WEBGL_multi_draw`, so the driver still gets about one draw per visible instance | **Skeptic.** The prototype numbers undercount. Use `InstancedMesh` per building type **per district** with a bounding sphere. The skeptic measured that at +20 calls and +378k triangles for 300 buildings with shadows (`LOOK/visual-gap/review/perf_probe_log.json`: 268 -> 288 calls, 2.06 M -> 2.44 M triangles). Note that `framecheck --real-draws` stubs `drawArrays/drawElements/*Instanced` only, so it cannot count multi-draw either |
| What Kenney shells replace | Replace house()/tower() boxes with the kit | Shells are closed. Replacing house()/tower() deletes interior loot (`maps.js:1144-1147`), the window cover rules (`maps.js:1113-1125`) and the bot drop cap that scales with POI loot points (`bots.js:231`) | **Skeptic.** Shells are only the non-enterable fill and skyline. Loot-bearing enterable buildings stay in every district |
| Colour grade | "Cheap polish", not an owner call | It reverses the owner-approved 2026-07-20 BRIGHT look (`CHANGELOG.md:1159`) and risks a repeat of the "removed all colours" complaint (`CHANGELOG.md:1308`) | **Skeptic.** The grade is an **owner call (D4)**, decided on an A/B sheet. No global saturation LUT |
| Tone mapping today | Neutral 1.15 (visual-gap's "ACES 1.05" superseded) | Same | **Draft and lighting-post.** The kernel default is ACES 1.05 (`ffg_kernel_3d.js:147-148`), but `maps.js:463-464` overrides it at map build. The skeptic probe reads `toneMapping: 7` (Neutral) at runtime. Visual-gap R3's "ACES exposure 1.05" is wrong |
| Storm acceptance | p95 >= 2.5x background | Per-region deltas (ground band >= 20/255), checked at phase 2 (over water) and phase 6 (over hills) | **Skeptic.** A frame-mean or whole-frame number cannot be reached at a readable alpha. The isla_viva phase-2 circle is 360 deg over water and the phase-6 circle crosses hills up to 59 m (`LOOK/hud-vfx/review/probe_review.json`) |
| Loot beams | Chest beam already inside the bar, so don't reduce it; weapon beams at half width | 69 of 346 floor items and 17 of 51 chests sit under a roof 2.7-7.5 m up (median 3.1/3.4 m), so 4-14 m beams poke through about 20% of roofs. An additive ring on the 0.636-linear sand can reach only ~1.57x before clipping white | **Skeptic.** Clamp each beam to the ceiling above it, and draw the ring so it keeps its colour on bright ground (details in P1.3) |
| Deploying the 10-01 build | Owner call (D1) | Not an owner gate: under the standing rule (memory `feedback_games_build_to_cdn_no_stop`) a build is finished only when it is live and checked | **Skeptic.** Moved to Phase 0, with a dry-run first and no `--status` flag |
| Clip dedupe risk | ~0 | `player.js:353-380` rewrites each skin's clip in place (root rebase against that skin, root-motion strip, prune to that skin's bones; athlete has 34 bones vs 65). Sharing one `AnimationClip` object would corrupt other skins | **Skeptic.** Dedupe the **download**, then clone the clip per skin before the per-skin passes |
| DynRes | Only after an interleaved A/B | The lane said "now justified" (DPR 1.0 -> 0.75 = -38 ms) | **Draft (skeptic re-measure).** The interleaved iGPU run gives medium DPR 1.0 p50 154 ms vs DPR 0.5 75 ms; a non-interleaved run had DPR 0.75 *slower* than 1.0 (`LOOK/next-steps/review/tierprobe*.json`). "Half-res bloom" is already true: `UnrealBloomPass` renders its bright pass and mips at resolution/2 (`LOOK/next-steps/review/SKEPTIC.md`) |
| Dome clouds | Undecided (noisy bench) | Lane estimated < 0.2 ms | **Neither as written.** The skeptic's standalone 720p iGPU bench (`LOOK/lighting-post/review/fsbench_1280x720.json`) puts procedural fbm clouds at a 7.0-12.8 ms minimum full-screen, against 0.5-1.6 ms for the plain dome. The noise **baked to a texture** costs 0.65-4.4 ms minimum, about the same as the plain dome. Use the baked version |
| Camera wall collision | Not an owner call | Visual-gap R4 flags it as an owner call: a pull-in is camera motion, and the shipped doctrine says "no uncommanded camera motion" | **Structured result.** It is **D3**, with a recommended yes |
| HUD restyle | Owner call (D6) | Vitals card and weapon card are restyles in the same anchors, so not an owner call; any position move is | **Structured result.** The restyle is in Phase 1. Only the death banner move and the standings screen stay owner calls (D7) |
| Online step A cost | $5/mo Workers Paid minimum | Durable Objects also run on Workers Free (100k requests/day, 13,000 GB-s/day). DYEFIELD already has an unreleased `workers/dyefield-net` (SQLite DOs, hibernation, 8 seats) ruled DYEFIELD-exclusive (`LOOK/next-steps/review/SKEPTIC.md`) | **Skeptic.** Step A can run at $0 inside the daily caps; $5/mo only above them |

---

## 1. Summary for the owner (plain English)

- **The biggest difference is the towns, not the graphics settings.** BridgeZone is full of streets, houses, apartment
  blocks and a downtown. Our maps are mostly open ground with a few brown boxes, and switching our graphics from
  Medium to High changed nothing visible. Real towns are the change that matters most. **Size: large**, done one map at a time.
- **We already own free building kits that fit the look.** A test town built from them (street grid, lane lines,
  sidewalks, houses, glass towers) looked like a real town from the parachute and cost little extra speed. They are
  simpler and more cartoon-like than BridgeZone's, but much closer than boxes. **Size: medium-large for the first map.**
- **Walk-in furnished rooms come second.** Today a room's floor is the outdoor grass and the camera ends up behind the
  wall. Furnished rooms with stairs need new building code and bot fixes. **Size: large.**
- **The purple storm is almost invisible today.** It can become a clear lilac wall with falling streaks, with the
  world turning purple-grey when you are inside it. **Size: medium.**
- **Loot needs the coloured light beams and glowing floor rings from the video.** Today only chests glow, and the
  floor rings are darker than the sand. **Size: medium.** Hit sparks (little coloured cubes today) and the flat yellow tracer also get replaced.
- **First-person with arms and a rifle is the other big visual difference.** Our sister game Blackridge already built
  this from Last Circle's own guns. The recommendation is an *option*: aim-down-sights in first person first,
  then a full first-person setting, with third-person kept as the default. **Your call. Size: medium for the first gun, large for all six.**
- **The health, weapon and storm panels can be restyled to look like BridgeZone's without moving anything you signed
  off.** **Size: small.** Moving the death message to a top banner and adding a standings table are your call.
- **A calmer, less candy-coloured look is possible but reverses the "bright" look you asked for in July.** We will
  show you before/after pictures of all three maps and you pick. **Your call. Size: small.**
- **Free quick wins:** softer real-looking clouds, a gun that is no longer held up while parachuting, seven different
  death falls instead of one, and an edge highlight so dark characters stop looking like black cut-outs. **Size: small each.**
- **The 10-01 improvements are still not live.** The website still serves the old build, so phone players have none
  of them. Publishing them is the first step. **Size: small.**
- **Bot matches end too early.** Every bot match ends in circle 2 of 8, so the video's late-circle fights never happen.
  The first fix is a settings-table change; how long matches should last is your call. **Size: small, then medium.**
- **100 real online players like BridgeZone is a separate multi-week project with running costs.** It is not needed for
  the look. **Your call.**

---

## 2. Decisions only the owner can make (each with a recommended answer)

| # | Question | Recommended answer | Why / cost |
|---|---|---|---|
| D1 | Camera: keep third-person, switch to first-person, or offer both? | **Both, as options.** Third-person stays the default. Step 1: Settings > "ADS view: Over-shoulder / First-person" (assault rifle first). Step 2 later: "View: Third / First". Both off by default, and off on phones. The parachute stays third-person, as in the video. Right mouse keeps working exactly as today (hold-to-aim plus the aim-toggle setting) | The reference is first-person, but the signed-off camera doctrine, the 5-skin locker and the phone FIRE/ADS buttons (which sit where the gun would be drawn, `touch.js:14-19`) are built around third-person. PUBG and Warzone ship both. $0 |
| D2 | If both views exist, keep first- and third-person players apart online? | **Yes: one view per SQUAD UP lobby, chosen by the host** | Third-person players can peek round corners, so mixed lobbies are unfair. PUBG runs separate FPP/TPP queues |
| D3 | May the third-person camera pull in when a wall comes between it and your character? | **Yes.** It snaps in only when a wall blocks the view, eases back out slowly, never rotates, and the reticle stays centred | Today the camera only avoids terrain (`player.js:2577-2590`). Inside a house a wall fills about half the screen (`LOOK/world-towns/review/shots/_sheet_merge.jpg`). Enterable rooms are not worth building without this or first-person. It is camera motion you didn't command, which the doctrine forbids, so it needs your OK |
| D4 | Colour: keep today's bright, vibrant daylight (your 2026-07-20 call) or move toward BridgeZone's calmer grade? | **Approve step A now:** fix only the cyan sky/water cast (sky, zenith, fog and water colours toward steel-blue and muted teal). **Judge step B on an A/B sheet:** exposure 1.15 -> ~0.9 and darker sand/grass. No global desaturation, so grass, roofs, characters and loot colours stay rich | Today our frames are about 1.9x brighter than the reference's outdoor frames. Saturation is 0.38-0.40 against 0.23-0.31 for exterior reference frames (lighting-post + skeptic, own `imgstats.py`). But you once said we had "removed all colours" (`CHANGELOG.md:1308`). $0 |
| D5 | Where do modern towns go? | **Pilot on Savanna** (its POIs are already urban: Downtown Core, Metro Plaza, Old Mall, Container Yard, Overpass; flattest terrain). Then decide from screenshots between modern suburbs on tropical Isla Viva / log-cabin Deepwood, or a **4th modern-city map in the random rotation** (my lean: the 4th map, plus beach-resort / lodge buildings on the other two) | Kenney suburbs and skyscrapers on a tropical island or a cabin forest change those maps' theme. The random rotation stays (no map picker) |
| D6 | Stay with the free stylised kits, or buy a more realistic town pack? | **Free CC0 kits first, then judge.** BridgeZone's own buildings are simple low-poly shapes; most of its "realism" is density, road markings and soft light | A realistic pack is a spend. No price was quoted in this research, so get a quote before deciding |
| D7 | Death and match-end screens: (a) replace the centred death card with a top banner over the live view ("Eliminated #N of 50 - by X - weapon - HEADSHOT - 31 m"); (b) add a standings table (all players, kills, damage, your row highlighted) with "Run it back" and "Find a new match"? | **Yes to both.** "Find a new match" picks a new RANDOM map | Both move or add screen elements outside the signed-off layout. The data already exists in the death card (`hud.js:3697-3760`) |
| D8 | How long should a bot match last? | **Median match end at 600 s or later, and at most 12 of 49 bots dead in the first 60 s.** Try the cheap fix first: stretch the storm plan or soften tier 1-3 aim. Only then change bot decision-making | Measured: all 7 bot matches ended at 264-380 s, in circle 2 of 8 (storm phases end at 240/390/505/600/675/735/780/820 s, `royale.js:293-307`). 9-21 deaths happen before 60 s (`LOOK/next-steps/probe_match.json`) |
| D9 | Online at BridgeZone scale? | **Not now.** Step A only if friends want rooms bigger than 4: a Cloudflare Durable-Object relay. Probably $0 on Workers Free within its daily caps, $5/mo on Workers Paid above them. Effort M-L. Step B (100 real players: authoritative server, matchmaking, bot back-fill) is multi-week, at about $0.012/match on Durable Objects + $5/mo, or ~$0.09/match on Edgegap | Supabase Realtime cannot fan out 100 players (99,000 msg/s needed vs 2,500 msg/s on the Team plan). Prices: vendor pages quoted by the next-steps lane. Reusing DYEFIELD's unreleased `workers/dyefield-net` would undo its "DYEFIELD-exclusive" ruling, so that is also your call |
| D10 | Any spend? | **None needed for anything in Phases 0-3.** Optional later: tactical Meshy character skins (quote from Meshy first; never re-roll existing models) or a paid realistic town pack (quote first) | Any spend over $0 needs your approval |
| D11 | Gyro aiming on phones? | **Later.** It needs the portal's game iframe to allow `accelerometer; gyroscope` | The portal iframe allows only `autoplay; fullscreen; gamepad; pointer-lock` (`GamePlayer.tsx:178`, per the skeptic), so orientation events never reach the game. That is a portal change shared by every game |
| D12 | Character edge highlight strength, and a coloured rim for SQUAD UP allies? | **Faint cool rim for everyone (P1.8); a coloured rim for allies** | A look call |

---

## 3. Phased build plan

**Budget, honestly stated.** Design targets: p99 <= 22 ms and <= 450 draw calls. Draw calls are fine today (ground 46-315
scene calls, `LOOK/next-steps/perfcheck.log`). The Intel UHD frame is already far over 22 ms before any change. The
interleaved iGPU probe gives medium DPR 1.0 p50 154 ms and DPR 0.5 75 ms; a second run gave 84.6 ms at DPR 1.0 (both with a
`readPixels` sync on a box shared with 7+ other Chrome sessions, `LOOK/next-steps/review/tierprobe*.json`). So every item
below must be **about net-zero on the medium tier**, or switch on only at high. GPU milliseconds on this shared box are
information only; draw-call and triangle counts are exact.

### Phase 0: finish the 10-01 job (not an owner decision under the standing build-to-CDN rule)

**P0.1 Publish the 10-01 build, then check it live**
- Player sees: everything in the 10-01 CHANGELOG table: phone look/fire/loot (48/48 gates), no 4-9 s lobby freeze,
  0.87 M instead of 9.9 M drop triangles.
- Today: the CDN serves `?v=1789530264` (re-fetched for this merge); `touch.js` and `ffg_frameprof.js` return 404; live
  `soldier.glb` is 1,958,836 B vs 224,776 B local. Live `hud.js` md5 matches `state/r2_manifest_last-circle.json`, so this is a
  consistent old build, not a half-finished upload. The 10-01 commits landed 2026-10-04 23:11-23:12, so the deploy is pending, not forgotten.
- Steps: (a) `python pipeline/deploy_game.py --game-dir games/last-circle --slug last-circle --dry-run` and confirm the plan
  uploads `touch.js`, `ffg_frameprof.js`, the `*_lod1.glb` files and the new skin bases. (b) Deploy **without** `--status`, so
  the publish status is untouched (`deploy_game.py:853-855`). Note that `deploy_game.py` also runs `deploy_portal.py`.
  (c) Live check: one no-store fetch of `index.html` expecting `?v=1790866476`, then `bootcheck.py --base <CDN index URL>` and
  `portalcheck.py --live`. Check completeness by listing the R2 bucket and comparing sizes, **not** by rapid parallel GETs (this
  worker returns inconsistent 404/403 under bursts, `deploy_game.py:316-318`).
- Effort S. $0. Risk: a live publish. The July partial-upload outage is why the live gate exists.

### Phase 1: highest visual impact for the least risk; no owner decision needed

**P1.1 Load each animation file once (download -34%)** (corrected per skeptic)
- Player sees: a faster first match, especially on phones.
- Today: the 17 MESHY_CLIPS are md5-identical across all 5 skins (1,765,868 B per skin, 8,829,340 B in total), yet
  `player.js:342-346` fetches `<skin>_<clip>.glb` under 5 URLs.
- Technique: fetch `<clip>.glb` once, then **clone the AnimationClip per skin** before `rebaseRootTracks` / `stripRootMotion` /
  `pruneClipTracks` / the `rifle_reload_upper` derivation (`player.js:353-380`), because those rewrite the clip for that skin's
  rig. Offline, strip translation and scale tracks except Hips, and drop the unused second animation that 10 of 17 files carry
  (`clip` + `mixamo.com`; the runtime reads only `animations[0]`). Keep a per-skin override path for a future skin that differs.
- Files: `runtime/3d/royale/player.js`; `assets/chars/meshy/` (or a shared `assets/chars/clips/`).
- Effort S. Perf: 8.83 MB -> ~0.68 MB of clip downloads (34% of the 24.3 MB to first drop) and 68 fewer GLB parses; 0 draw calls.
- Licence: unchanged (Mixamo, royalty-free in games; baked clips only). Not an owner call.
- Gate: `dlprobe.py` "chars" 10.25 MB -> ~2 MB; `rigcheck.py` 0 `[rig]` lines on all 5 skins (athlete's 34-bone prune must not
  affect the others); `framecheck.py`, `bootcheck.py --disk`.

**P1.2 A storm you can see** (hud-vfx rec, corrected per skeptic; plus the storm grade from lighting-post, corrected)
- Player sees: a translucent lavender curtain with thin falling streaks and a brighter band where it meets the ground,
  readable at 150 m and side-on. Stepping into the storm turns the world, sky included, hazy purple-grey, and the CSS edge
  vignette stays as the readable cue. Today's clean A/B renders show only +9.07/255 per channel at 30 m and +5.67 at 150 m,
  green actually *drops* 6.8/255, and the wall reads as a faint magenta cast (`LOOK/hud-vfx/shots/ab/ab_stats.json`, `wall_in30_on.png`).
- Technique, on the same single cylinder (`storm.js:45-56`):
  (a) a ShaderMaterial with NormalBlending and premultiplied alpha (additive light cannot darken or desaturate what is behind it);
  (b) a ground reference: a 360-sample 1D DataTexture of `max(W.map.heightAt(x,z), waterY)` around the live circle, refreshed when
  the centre or radius changes. Curtain alpha (~0.3-0.4 near the ground, falling with height) and the 0-3 m bright band are
  measured from it, not from `waterY`;
  (c) streaks spaced in world metres, with width anti-aliased by `fwidth()` so they stay ~1.5-2 px at any distance (the
  reference streaks stay thin; fixed 0.6-1.2 m streaks would be 15-25 px bands at 30 m);
  (d) an alpha cap so a silhouette 20 m behind the wall keeps >= 60% contrast;
  (e) inside the storm, on `playerStormState` (`hud.js:3494`, `storm.js:142-147`): lerp `scene.fog` colour/density **and**
  `scene.background` **and** the sky dome's `top`/`bot` uniforms (the dome is `fog:false`, `maps.js:633`) toward ~#8a74b8, then
  restore all three exactly. Add a 40-50% desaturation + light lavender tint as a uniform in a **custom copy of three r172's
  OutputPass/OutputShader** (MIT), faded over 0.5 s, and set it neutral while the menu diorama renders (it shares the composer, `hud.js:823`);
  (f) draw order: move the loot beam/ring/glow pools and the fx quad pools to `renderOrder > 5`, and fade loot beams outside the
  circle through a shared storm centre/radius uniform, so the normal-blended wall does not veil effects in front of it;
  (g) purple lightning in the storm-side sky: 3-6 flashing billboards (from the first draft; reference t22) within the glare bar.
- Files: `runtime/3d/royale/storm.js`, `runtime/3d/royale/hud.js`, `runtime/3d/royale/fx.js` (`warmObjects`, `fx.js:639-651`),
  `runtime/3d/ffg_kernel_3d.js:412-427` (accept the custom output pass), new `runtime/3d/lc_output_pass.js`, `runtime/3d/royale/loot.js` (renderOrder).
- Effort M. Perf: wall stays 1 draw, 192 triangles; ~+0.1-0.3 ms estimated on the UHD (about 1.3 M fragments at DPR 1.5 x ~30
  flops; not measured). The grade folded into OutputPass adds 0 passes and 0 draws: the skeptic's 720p bench put an ALU grade at
  0.39-0.73 ms against 0.47-0.66 ms for a plain copy, so folding it in costs about nothing. 0 MB download; the 256 px canvas texture goes away.
- Glare bar: streaks <= 2x curtain luminance, ground band <= 2.5x, lightning <= 8x its sky, halo <= 2-3x width, nothing above the
  0.72 bloom threshold except lightning. Start low: assume the first pass is too hot.
- Licence: original shader; three.js MIT. Not an owner call.
- Gate (per region, not frame mean): a `capture5.py`-style A/B at **phase 2 (over water) and phase 6 (over hills)**. Ground band
  (0-10 m above the LUT ground) mean delta >= 20/255; streaks visible by eye at 150 m and side-on; luminance ratio 0.85-1.15;
  `framecheck.py --disk` shows 0 new programs on the drop frame; `lifecycle.py` PASS; side-by-side with `ref_t100` / `ref_t84`.

**P1.3 Rarity light beams on all floor loot plus glowing floor rings, as instanced draws** (hud-vfx rec, corrected per skeptic; no full skeptic verdict reached the merge past point 4)
- Player sees: every floor weapon gets a thin rarity-coloured beam with a white core that fades as it rises, height by
  rarity (common ~2 m to legendary ~14 m) **but never through a ceiling**. A soft glowing double ring sits under it, as in ref
  t52/t84. Chests keep a gold beam. Today floor items have only an opaque torus measured at 0.64x the sand's luminance (darker
  than the ground), and chest beams are 1.45x the sky and 5 px wide at 90 m.
- Technique: ONE InstancedMesh for beams (open 10-segment cylinder, scaled per instance; additive, depthWrite off, depthTest on;
  alpha = rarity gain x vertical gradient x soft core x distance fade per rarity, with chests visible from the glider,
  `loot.js:947-949`). **Clamp each beam's height** to the first collider above it, ray-cast once at spawn (69 of 346 items and
  17 of 51 chests are under a roof, median 3.1/3.4 m, `LOOK/hud-vfx/review/probe_review.json`). Rings: ONE InstancedMesh of
  flat quads with a procedural ring shader, using **normal blending with a dark outer edge plus a coloured emissive core**. An additive
  ring on the 0.636-linear sand caps out at ~1.57x and turns white, losing the rarity colour. Chest glow sprites become 1
  instanced billboard. Pickup or open hides an instance (scale 0) through the existing slot-allocator pattern (`loot.js:295-386`);
  re-park on `disposeMatch`; survive the net take mirroring (`loot.js:65`). Size the pools for **346 items + 51 chests**
  (isla_viva seed 7: 124 weapons, 157 ammo, 65 consumables), not 216. Ammo and consumables get rings only, no beam.
- Files: `runtime/3d/royale/loot.js`, `runtime/3d/royale/fx.js` (prewarm, contract C7).
- Effort M. Perf: the ~8 chest beams + 8 glows + ~12 rings/items in the measured ground frustum become 3 calls (about -25). From
  the glider the saving approaches 100, because chest beams and glow sprites are never culled today (`loot.js:943-946`; 51 additive beam
  meshes + 55 additive sprites in the scene). ~400 instances x 20 triangles = ~8k triangles. 0 MB.
- Glare bar: beam core 3-5x the surface behind it; common/uncommon below the 0.72 bloom threshold. Over a ~0.58-linear horizon sky
  any visible additive beam crosses 0.72, so judge the sky case by eye and cap the halo at <= 2x beam width. Cap legendary gain so it
  cannot mask an enemy.
- Licence: procedural, $0. Not an owner call.
- Gate: an A/B probe: ring reads as rarity-coloured on sand, grass and wood (hue error < 15 deg) at >= 1.4x floor luminance; no beam
  pixel above a ceiling collider; `framecheck.py --disk` drop cluster <= 250 calls and a smaller loot share; `leaktest.py` textures
  flat over 3 matches; a probe that picking an item hides its beam and ring.

**P1.4 Hit sparks, muzzle flash and tracers that are not cubes** (first draft + hud-vfx observations; no full skeptic verdict reached the merge)
- Player sees: soft sparks and dust puffs and a thin bright fading tracer streak, instead of coloured cubes and a flat yellow
  stick (`LOOK/hud-vfx/shots/crop_26_hurt_cubes.png`, `crop_25_bot_tracer.png`). The flat unlit cubes (`fx.js:51-57`) break the
  "no primitives as final art" rule today.
- Technique: camera-facing instanced quads with soft textures from Kenney Light Masks on F:
  (`_downloaded/light-masks`; the skeptic made a contact sheet, `LOOK/hud-vfx/review/lightmasks_sheet.png`). Tracer = a stretched additive
  quad with a gradient. Keep the 1,024-particle cap (263-300 live while firing).
- Files: `runtime/3d/royale/fx.js`, `runtime/3d/ffg_warmup.js`. Effort S-M. Perf: same instanced draw count; < 50 KB download.
- Licence: **CC0** (verified this merge: `light-masks/License.txt` "Creative Commons Zero, CC0", Kenney). Not an owner call.
- Gate: `feelcheck.py`; glare probe on flash and tracer (<= 8x surface, halo <= 2-3x width); 0 new programs on the drop frame.

**P1.5 Gun hidden while gliding**
- Player sees: no pistol in the raised hand under the canopy (`LOOK/camera-characters/shots/03_parachute_tpp.png`).
- Technique: `player.js:1458` `a.weaponMesh.visible = d2 < wl2 && !a.emoting` gains `&& !a.gliding`.
- Effort S. Perf: -1 to -2 calls per nearby glider. $0. Gate: drop screenshot with no weapon while gliding; gun visible on the first grounded frame.

**P1.6 Seven different death falls from Mixamo clips already on disk** (no full skeptic verdict reached the merge)
- Player sees: front, back, side, headshot and crouching falls (plus walking-to-dying) matched to shot direction. Corpses never
  stand back up. Today every corpse plays one clip.
- Technique: bake `F:/games/forgeflow-games-assets/_downloaded/mixamo/animations/Rifle_8-Way_Locomotion_Pack/death*.fbx` (6) and
  `Shooter_Pack/walking to dying.fbx` in the portable Blender to clip-only GLBs **in metres**, one shared file per clip. Replace the
  Meshy death2/death3 (Meshy library actions 183/184, `pipeline/meshy_lc_deaths.py:9-14`; against the Mixamo-only rule and already
  nulled at `player.js:585-588`). Pick from `victim.lastHit`, attacker position and `isHead` (`player.js:2708-2713`) with a **seeded**
  pick instead of `Math.random()` (`player.js:2775`). Verified in-page by the lane: 53/53 tracks bind, end hips 0.14-0.27 m.
- Trap (measured): centimetre roots trigger the unit guard (`player.js:212-219`), lifting the start pose to 1.53-2.06 m.
- Files: `player.js` (MESHY_CLIPS 283-291, killActor 2743-2797), `assets/chars/clips/*.glb`, `CREDITS.md`. Effort M.
- Perf: 0 calls; ~0.7 MB if shared (after P1.1). Licence: Mixamo royalty-free in games; baked clips only. Not an owner call.
- Gate: playtest kills 20 bots -> >= 5 distinct clips, 0 corpses with hips > 0.6 m at clip end; `rigcheck.py` on all 5 skins.

**P1.7 Real-looking clouds in the sky dome (baked-texture version)** (lighting-post rec, corrected by the skeptic's bench; no full skeptic verdict reached the merge)
- Player sees: soft wispy cumulus across the whole sky (prototype `LOOK/lighting-post/review/shots/ground_clouds.jpg`, looked at
  for this merge: broad soft cumulus over the island), instead of cotton-ball sprites.
- Today: a gradient dome (`maps.js:631-640`) plus 24 cloud groups of 3-5 canvas sprites at 320-460 m (`maps.js:642-669`), drifted per frame (`maps.js:695`).
- Technique: port the cloud shaping from three's `examples/jsm/objects/Sky.js` (MIT), but **bake the fbm noise once at load into a
  256-512 px tiling canvas/DataTexture** and sample two scrolling layers in the dome shader. Measured on this iGPU at 720p
  full-screen (`fsbench_1280x720.json`): procedural fbm 7.0-12.8 ms minimum vs the baked texture 0.65-4.4 ms vs the plain dome
  0.5-1.6 ms. Delete the sprite clouds. **Keep the birds** (the owner asked for "real clouds and birds", `maps.js:612`).
- Files: `runtime/3d/royale/maps.js:631-701`. Effort S.
- Perf: **-43 draw calls** measured in the Isla Viva ground view (372 -> 329); 0 MB download; ~+0-1 ms on the sky pixels (estimate from the bench minima).
- Licence: three.js MIT. Not an owner call (it does change the cloud look, so include it in the D4 A/B sheet).
- Gate: framecheck draw-call row drops by ~40; 0 new programs during the drop; sky screenshots at ground and 250 m on all 3 maps.

**P1.8 Readability rim on characters** (no full skeptic verdict reached the merge)
- Player sees: dark skins (wraith) stop reading as black cut-outs; a faint cool edge on head, shoulders and arms
  (`LOOK/camera-characters/shots/62_rim_compare_close.png`).
- Technique: in the zone-tint `onBeforeCompile` (`player.js:550-566`), add `pow(1-N.V,3) x up-facing x mix(0.22,0.45,smoothstep(8,60,viewDist))`
  to outgoing light (VALORANT approach). Give it a new `customProgramCacheKey` and add it to the `ffg_warmup` set. Prototyped: 50 materials, one program.
- Effort S. Perf: 0 calls, 1 shared program. Glare: term <= 0.45 at grazing angles. Not an owner call (strength = D12).
- Gate: `framecheck.py` 0 new programs on the drop frame; edge-vs-body luminance probe.

**P1.9 HUD restyle inside the signed-off positions** (hud-vfx recs; no full skeptic verdict reached the merge)
- Player sees: dark glassy rounded panels. Bottom-left: a big tabular "78" HP number over a 4-segment blue shield bar and a
  4-segment white HP bar, plus a consumables row with key chips (ref t84). Today: two pill bars with % text and emoji
  (`hud.js:2170-2185`). Bottom-right above the slot row: weapon name in rarity colour, an outlined rarity tag, AUTO/SEMI
  chip (same rule as `weapons.js:432`), big mag count "/ reserve", ammo type and a segmented mag bar (ref t38/t84). Today
  only "30 / 150" (`hud.js:2209-2214, 2708-2716`). The storm row reads "Circle N of 8 - X damage a second". Kill-feed rows get weapon
  silhouettes.
- Technique: DOM in the same boxes (`bottomLeft` at left 18 / bottom 16 / width 300; slot column at right 18 / bottom 54). Segment
  fills use `transform: scaleX`, written only when the cached value changes (`hud.js:2671-2688` caches `C.hp`/`C.sh`). SVG icons
  instead of emoji. Weapon silhouettes rendered offline from our own weapon GLBs (original). The game-icons set on F: is CC BY 3.0
  and needs attribution, so it is the fallback only.
- Constraint: in touch mode the stick lives bottom-left and chat sits at bottom 128 (`hud.js:2337`), so the vitals card stays under
  ~64 px tall, or it becomes a layout change.
- Files: `runtime/3d/royale/hud.js`. Effort S. Perf: 0 draws, DOM writes only on change, forced layouts stay 0.00. Not an owner call.
- Gate: `layoutcheck.py --disk` (desktop + phones, overlap rows, signed-off anchors unchanged), `mobile.py --disk`, `feelcheck.py --disk`,
  and a 1280x720 side-by-side against ref t84 (`LOOK/hud-vfx/contact_sheet_ref_vs_ours.png` row 1).

**P1.10 Altitude-scaled fog for the drop** (visual-gap R3b + skeptic fog50 shots; replaces the cut height-fog shader)
- Player sees: from the plane and glide the island reads crisply out to the coast instead of a milky haze (drop frames
  measure luma spread 0.049-0.054 vs 0.089 for ref t08). At ground level distance still fades softly.
- Technique: `FogExp2.density` is a uniform, so lowering it with camera height (e.g. full density below 40 m, ~50% at 250 m+)
  needs **no shader recompile**. The skeptic showed a runtime height-fog override changed no programs (50 -> 50), while forcing a
  real height-fog shader recompiled 1,501 materials (+20 programs) (`LOOK/lighting-post/review/skeptic_check.json`). Check that the
  thinner fog does not expose the map edge or ocean horizon; lighting-post flagged that a clearer drop reveals it.
- Files: `runtime/3d/royale/maps.js` (fog at :444) or the camera update. Effort S. Perf: 0 draws, 0 ms, 0 MB. Not an owner call.
- Gate: drop shots at 220/330 m on all 3 maps (`LOOK/visual-gap/review/shots/*_drop_grade_fog50.png` is the prototype);
  `imgstats.py` luma spread >= 0.08; no visible map-edge or ocean seam.

### Phase 2: real towns, Savanna first (largest visual gain; pilot needs no owner decision)

All of Phase 2 is one feature built in order. Ship P2.1-P2.3 together, so no district ever loses its loot.

**P2.0 Asset intake (prerequisite)**
- Add gltf-transform / gltfpack (meshopt) to asset intake **before** any kit lands. Vendor three r172's
  `examples/jsm/libs/meshopt_decoder.module.js` (MIT, 24,850 B), since there is no runtime build step. Same move: swap the forced Draco JS
  decoder (`ffg_kernel_3d.js:26`, 719,410 B) for wasm Draco (285,747 + 58,763 B) or meshopt.
- Effort S-M. Gate: `dlprobe.py`, `bootcheck.py --disk`.

**P2.1 Street-grid town generator with lane-marked roads, sidewalks and level plots** (world-towns 1a, corrected per skeptic)
- Player sees: from the plane, Downtown Core and Savanna Outpost read as real towns: a block grid of dark asphalt with white
  edge lines and a yellow dashed centre line, sidewalks around every block, buildings on lots facing the street
  (`LOOK/world-towns/shots/proto_B_parachute.png`). Today's matching view is 6 lone box towers on grass with two crossing ribbons
  (`maps.js:1519-1525`; `proto_B_parachute_before.png`), and the Outpost is ~10 box houses on one street.
- Technique: a new `towngen.js` with **only** BLOCKTOOTH's grid and parcel subdivision ported from `games/blocktooth/src/city/citygen.ts`
  (~150-250 of its 753 lines; no traffic, curb parking, harbour, titan-wading or destructible tiers), rescaled to BR size: block pitch
  ~56-64 m, road ~10 m, 3 m sidewalks. The layout comes from a **dedicated sub-RNG seeded from (W.seed, poi id)**, not the shared map RNG
  (`maps.js:376`), so squad clients still rebuild it identically and everything generated after the towns (trees, landmarks, loot) stays
  byte-identical to today. Add a flat plateau to `heightAt0` inside each town rectangle (`maps.js:224-277`), blended over >= 3 far-mesh
  cells (5.3 m each, `maps.js:488`). The rendered terrain interpolates `heightAt0` while physics reads it directly (`maps.js:1021-1037`),
  so a sharp edge would show a step. The plateau also removes ashgrid's +/-2.5 m berms there (`maps.js:239-249`), so buildings must supply
  that cover. Keep road and sidewalk lift <= 0.06 m (`ROAD_LIFT`); a raised curb needs a real curb strip and a support collider. Texture roads
  with on-disk Poly Haven `asphalt_01..07` (downscaled to 1024 px), not random canvas noise. **Mask grass tufts out of roads, sidewalks and
  footprints** in the clutter ring (`maps.js:2141-2151`). **Draw roads and block outlines into the minimap** (`maps.js:2294-2309`, terrain
  colour only today; HUD content inside the signed-off layout).
- Files: `runtime/3d/royale/maps.js` (`town()` 1178-1240, heightAt0, clutter ring, minimap), new `runtime/3d/royale/towngen.js`.
- Effort M-L. Perf: roads + sidewalks = 2 meshes (+2 main-pass draws); textures ~1-1.5 MB for asphalt at 1024 px (estimate).
- Licence: in-house code; Poly Haven CC0. Not an owner call.
- Gate: `framecheck.py --disk --map ashgrid` (the default map is isla_viva, `framecheck.py:282`): drop cluster <= 250 calls, match frame < 5 M
  triangles, 0 new programs. `probe_match.py --disk`: stuck < 2% (today <= 0.3%), path search usable >= 15/30 at 120 m and 180 m, same seed
  gives identical fingerprints, >= 3 guns per player. A street-level screenshot with no grass on asphalt and feet on the pavement.

**P2.2 Kenney City Kit buildings for the non-enterable fill, skyline and suburbs** (visual-gap R1 + world-towns 1b, corrected per skeptic)
- Player sees: glass and stone towers and mid-rises downtown, gabled houses with porches and roofs on the suburban blocks, a warehouse yard,
  and a far skyline (`LOOK/world-towns/shots/CONTACT_before_after.png`, looked at for this merge: shipping = lone brown boxes on grass;
  prototype = a dense grid with blue-glass towers and green-roof houses).
- Technique: `F:/games/forgeflow-games-assets/_downloaded/cc0-city/` City Kit Suburban `building-type-a..u`, Commercial `building-a..n` and
  `building-skyscraper-a..e`, `low-detail-building-*` (188 triangles) for far views. One **InstancedMesh per building type per district** with a
  computed bounding sphere, so frustum and shadow-camera culling work. A map-wide InstancedMesh cannot be culled (`maps.js:2003-2014` says so). A
  **hand-authored collider table per type** (a few boxes each, so porches and awnings are not invisible walls), baked offline and built **whether or
  not the GLB loads**. The `maps.js:1987` pattern drops colliders on a failed load, which would let squad clients disagree about cover. A separate
  decoration RNG. The suburban and commercial colormaps share the filename `Textures/colormap.png`, so stage them in separate folders and assign
  **one shared Texture** per palette after load. Palette variants by recolouring the 512 px colormap (prototype: green roofs -> slate,
  `LOOK/world-towns/colormap_suburban_shingle.png`). Per-type scale (prototype: houses 7.2, commercial 11-13). Baked contact-shadow decals or
  vertex AO under each footprint (visual-gap R3d, cheap on every tier).
- Files: `runtime/3d/royale/maps.js`, `runtime/3d/royale/towngen.js`, `assets/props/city/*.glb` (meshopt), `CREDITS.md`.
- Effort L (the first map); M per later map.
- Perf (measured by the skeptic on Savanna ground view, `perf_probe_log.json`): 300 stand-ins at ~1,260 triangles chunked per POI = **+20 calls,
  +378k triangles** (268 -> 288; 2.06 M -> 2.44 M); map-wide instancing = +47 calls, +737k. Kenney buildings measure 1,024-2,062 triangles each.
  Download ~2.8 MB raw for ~25 GLBs; meshopt measured 0.21-0.34x on 4 samples, so ~0.7-1 MB.
- Risk: the kit is cleaner and more toy-like than BridgeZone (D6). Theme on Isla Viva and Deepwood (D5). Bot paths, loot points and cover change.
- Licence: **CC0** (`cc0-city/SOURCES.json` + `LICENSE-kenney-*.txt`; kenney.nl kit pages). $0. Pilot is not an owner call.
- Gate: `framecheck.py --disk --map ashgrid`; per-district calls/triangles with the skeptic's probe; `probe_match.py --disk` stuck < 2%;
  `leaktest.py --disk` (instances freed in `disposeMapResources`, textures flat over 3 matches); `perfcheck.py --profile default` (iGPU) as
  information; an owner side-by-side of the drop shot against ref t08.

**P2.3 Keep enterable, loot-bearing lots in every district until P3.2 ships** (skeptic MISSING)
- Today each `town()` house carries a floor loot point and a 50% chest (`maps.js:1144-1145`), and the bot drop cap scales with POI loot points
  (`bots.js:231`). Keep today's `house()`/`tower()` on some parcels (or loot points on lots), so the census stays >= 3 guns per player.
- Gate: `probe_match.py` census rows unchanged (3.42-4.1 guns + chests per player today).

**P2.4 Street props, parked cars, named towns**
- Player sees: parked cars, street lights, hydrants, benches, dumpsters and fences (static cover; no driving). Town names on the minimap and the
  drop overview (the POI tables already have names: Isla Viva 8, `maps.js:1407-1414`; Savanna 9, `:1510-1518`; Deepwood 8, `:1651-1658`).
- Technique: Kenney Car Kit (16 vehicles, 3.2 MB raw) and cc0-city props (1.2 MB) + 8 Quaternius CC0 street props, instanced per model per district.
  These replace the `addBox` lamp posts, benches and hydrants (`maps.js:1149-1175`), which are primitives today. Names = labels on the minimap canvas.
- Effort S-M. Perf: +5-10 calls (estimate). Licence: CC0. Gate: `framecheck.py`, `layoutcheck.py` (no collision with the top cluster), `probe_match.py` cover.

**P2.5 Textured ground** (visual-gap R3c; no full skeptic verdict reached the merge)
- Player sees: textured sand, grass and rock instead of near-white sand (Isla Viva sand albedo is 0.93/0.87/0.64 linear, `maps.js:287`).
- Technique: Poly Haven CC0 `aerial_grass_rock`, `aerial_beach_01..03`, `aerial_sand` on disk, downscaled to 1024 px (the 2048 px sets are
  8.1 MB each) or KTX2. Any albedo darkening in `colorAt` also changes the minimap (`maps.js:2304`) and grass clutter (`maps.js:2161`), so it rides with D4 step B.
- Effort M. Perf: ~3-5 MB download (estimate), 0 draws. Gate: `imgstats.py` on fixed-seed ground shots; `dlprobe.py`.

**P2.6 Ram-air canopy** (camera-characters rec; fixes a primitive used as final art)
- Player sees: an arched, cell-segmented two-tone wing like ref t22 instead of a smooth half-sphere dome (`SphereGeometry`, `player.js:1934-1994`).
- Technique: a parametric GLB in the portable Blender (7-9 cells, airfoil section, stabilisers). The gore mask goes in vertex colour, so the
  instanceColor shader (`player.js:1971-1974`) still paints it. Still ONE InstancedMesh + ONE LineSegments; re-fit `CHUTE_LINES` (`player.js:1926-1930`).
  Seated hang pose from `hang` (`pose.js:131`).
- Effort M. Perf: calls unchanged; ~1.5-2k triangles per canopy vs ~250, ~+90k with 50 in view (estimate; the drop frame measured ~0.75-0.80 M).
- Licence: original FFG asset. Not an owner call. Gate: `framecheck.py` chute <= 2 calls, drop cluster <= 250; side-by-side with ref t22.

### Phase 3: enterable interiors (P3.1 needs D3, or first-person from D1)

**P3.1 Third-person camera wall collision (owner call D3)**
- Player sees: inside a building the camera pulls in instead of sitting behind the wall (today a wall fills ~half the frame in all 8
  skeptic shots, camDist 4.25, `LOOK/world-towns/review/shots/_sheet_merge.jpg`, `gamecam_inside.json`).
- Technique: a ray/sphere cast from the eye to the desired camera position against `W.map.queryColliders`. Snap in on contact, ease out slowly,
  never rotate; reticle stays centred. Today only terrain is tested (`player.js:2577-2590`; `heightAt` is terrain-only, `maps.js:2364`).
- Files: `runtime/3d/royale/player.js` (updateCamera 2508-2640). Effort M. Perf: ~1 collider query per frame (budget 150/frame).
- Gate: `gamecam_inside`-style probe: camera never inside or behind a wall collider across 4 yaws x N houses; `feelcheck.py` (no camera heave);
  `rigcheck.py`; `mobile.py`.

**P3.2 Enterable modular houses and apartments with furniture** (visual-gap R2 + world-towns 2a, corrected per skeptic where it reached the merge)
- Player sees: doorways into rooms with plank or tile floors (not terrain grass), framed windows, ceilings with light panels, sofas, tables,
  kitchen units, bookcases, and stairs in 2-storey buildings (ref t38/t68). Prototype room: `LOOK/world-towns/shots/proto_E_room_inside.png`.
- Technique: a house grammar on a 2.5 m module grid (rectangle or L footprint, 1-3 walkable storeys) from `cc0-city/walls` (16 pieces with separate inner and
  outer materials) and `cc0-city/furniture` (40 items, 7.8k triangles total). The kit does **not** match the game's cover maths (skeptic, `review/glbdeep.py`):
  scaled to the 3.4 m wall, `wallWindow` is a 0.99 m opening with sill 1.04 m and header 2.79 m, whereas colliders use sill 1.20 m, header 2.30 m and a 1.2 m
  opening (`maps.js:1113-1125`). So either rescale or author window pieces to the collider rule, or re-derive colliders from the kit and re-run `botcheck.py`;
  **never leave them disagreeing** (an invisible header would block shots between 2.30 and 2.79 m). Doors use `wallDoorwayWide` (2.26 m). `wallDoorway` (1.13 m)
  is narrower than the 1.4 m doors bots already fail on (`bots.js:1290-1300, 1404-1415`). Add door waypoints and cap at 3 walkable floors. Mask the grass ring
  indoors. Stair visuals: Quaternius `Stair_Interior_Solid` (Medieval Village MegaKit, CC0) re-textured over the existing ramp collider (`player.js:1251-1257`), or an
  authored stair. Furniture gets colliders or `collide:false` and adds low cover and loot points. Indoor ambient: the hemisphere light and IBL are not occluded indoors,
  so prototype rooms render as bright as outdoors; add an indoor ambient term (a per-room volume or baked vertex AO). Optional fidelity: Poly Haven CC0
  `beige_wall_001/002` and `anti_slip_concrete` on inner walls.
- Batching is mandatory: one prototype room drawn as plain meshes was 113 meshes and added ~100-120 draw calls (312-332 vs ~209). Merge per material per
  district (about 6-8 materials x 2 for shadow = 12-16 calls) and hide furniture beyond ~60 m.
- Files: `maps.js` (house 1126-1150, tower 857-930), `towngen.js`, `bots.js`, `loot.js`, `assets/props/town/*.glb`, `CREDITS.md`.
- Effort L. Perf: ~4k triangles per furnished storey; 150-300k in a town view after culling (estimate). Download ~0.74 MB raw, ~0.25 MB meshopt.
- Licence: CC0 (Kenney Furniture Kit 2.0; Quaternius). Owner call only if roofs end up as procedural prisms (no-primitives rule).
- Gate: interior shots on every map (floor not terrain, >= 3 furniture pieces in view, ceiling visible); a **new door-reachability probe** (bot path from
  the street to every room, Blackridge `probe_arena` style); `probe_match.py` stuck < 2%; `framecheck.py` queryColliders <= 150/frame; footsteps on
  floors via `surfaceAt` (`maps.js:2347-2353`).

### Phase 4: after owner decisions

**P4.1 First-person option (D1, D2)** (camera-characters rec, corrected per skeptic)
- Player sees: step 1, aiming the AR shows arms and the rifle in the lower right (ref t38/t52/t84); step 2, a full first-person setting.
- Technique: reuse Blackridge's work **without porting `viewmodel.js` wholesale**. That file owns the world camera (eye height, crouch lerp, head-bob, landing dips,
  view-only pitch/yaw/roll kick, `viewmodel.js:40-53, 166-200`); in Last Circle the aim ray **is** the camera direction (`weapons.js:366-368, 491`), so a camera kick
  would move the shots, and a head-bob breaks the camera doctrine.
  (a) Extract only the viewmodel-layer render: a 60 deg viewmodel camera, `clearDepth`, viewmodel-local springs (sway, bob, kick, ADS). The world camera stays
  with `updateCamera`, where `firstPerson` already gives camK=1 (`player.js:2607`). Change `player.js:2528` to `scope || fppView || (fppAds && ads)`.
  (b) Draw the viewmodel **inside the composer render target**, before bloom and output (three keys programs to the render target,
  `ffg_kernel_3d.js:102-109`, `ffg_royale3d.js:740-747`). Warm its programs in `ffg_warmup.js`.
  (c) In FPP, start tracers (`weapons.js:580-583`) and the muzzle flash (`weapons.js:606-616`) from a viewmodel muzzle socket projected into the world camera
  (Blackridge's `muzzleWorld` seam), not from the hidden third-person hand. Cut the crosshair march start (`weapons.js:511`, 3 m) and actor skip (`weapons.js:502`, 1 m) to ~0.3 m.
  (d) Anti-aliasing for the viewmodel (FXAA/SMAA pass or a multisampled viewmodel target). The game has none today (`antialias:false`, single-sampled target,
  `ffg_royale3d.js:259-261`) and the mock rifle shows stair-stepped edges.
  (e) Re-run `blackridge/tools/a4_build_fp_weapons.py` for all 6 guns (shotgun and launcher from `wpn_shotgun`/`wpn_glauncher`, owned Meshy sources, no re-roll),
  coloured to **match each Last Circle third-person gun** (lime/black in `12_tpp_ads_ar.png`), which is what other players see you holding, not the reference's camo.
  Keep normal maps lossless (or KTX2/UASTC); lossy WebP normals band on a screen-filling gun. Draco the geometry with the shipped DRACOLoader; share one arms texture set.
  (f) Load at match start when the setting is on; a mid-match toggle applies next match (warm-up runs under the loading screen). Wider FPP FOV default (~70 deg vertical vs 57).
- Effort: step 1 M (AR), step 2 L. Perf: viewmodel pass **+7 calls** (measured). World calls shift -7 to +45 with the eye position, measured **peak 409/450**
  at yaw3 (thin margin). ms unmeasured; estimated +0.3-1 ms on the UHD (PBR fill over 20-30% of the screen, plus AA). Measure p99 with `?prof=1` before step 2.
  Download ~0.9-1.3 MB per gun after repack (skeptic estimate), lazy.
- Licence: original FFG Meshy (`blackridge/CREDITS.md`); three.js MIT. $0.
- Gate: muzzle-ray/camera-ray convergence at 10/50/150 m; `framecheck.py` drop cluster <= 250, match frame +<= 10 calls; `mobile.py` with FPP forced off on touch;
  `feelcheck.py`, `rigcheck.py`, `layoutcheck.py`; hip and ADS screenshots per gun next to ref t38/t52/t84.

**P4.2 Colour grade (D4)**
- Step A (approved -> ship): re-author sky, zenith and fog hues (`maps.js:36-41`) and water (`maps.js:591`) toward steel-blue and muted teal. Leave grass, roofs, characters
  and loot colours alone. Prototype hexes (lighting-post, desaturated in linear space), e.g. Isla Viva sky `#7fd4f0 -> #9ed0e3`, zenith `#2f8fd8 -> #5c8dc1`, water `#2ec9d6 -> #80c2ca`.
- Step B (on the A/B sheet): `toneMappingExposure` 1.15 -> ~0.9 (`maps.js:464`) and darker terrain albedo in `colorAt` (`maps.js:280-330`), checking the minimap and clutter.
  Keep Neutral tone mapping (AgX greyed Savanna: saturation 0.252 -> 0.134; ACES raised brightness; matches DYEFIELD `_spec/CONTRACT.md:383-386`). The menu diorama keeps its own ACES 1.12 (`hud.js:644-645`).
- Compare only against exterior reference frames t08, t22, t52. Targets outdoors: saturation 0.25-0.32, |red - blue| < 0.10; brightness 0.45-0.55 is a judgement call.
- Effort S. Perf 0/0/0. Gate: `imgstats.py` on fixed-seed, fixed-POI ground and drop shots for every map; framecheck counts unchanged; owner sign-off.

**P4.3 Death banner + standings (D7)**: restyle the death card (`hud.js:3697-3760`) as a top banner over the live view; post-match standings table with
"Run it back" / "Find a new match" (random map). Effort M. Gate: `layoutcheck.py`, `mobile.py`, `leaktest.py` (PLAY AGAIN).

**P4.4 Towns on the other maps or a 4th map (D5)**, **realistic pack (D6)**, **tactical skins (D10)**: after the Savanna pilot screenshots and quotes.

**Optional, HIGH tier only, judged on screenshots after Phase 3:** FXAA on desktop medium/high, measured with `?prof=1` (a 9-tap pass benches at about a plain copy
on this iGPU, `fsbench`; the skeptic's in-game run was too noisy to price it). SMAA only on high.

---

## 4. Next best step for the areas already shipped

| Area | Next best step | Evidence | Effort | Owner call? | Gate |
|---|---|---|---|---|---|
| Deploy | Publish 10-01 + post-deploy live gate (P0.1) | CDN `?v=1789530264` (re-fetched 2026-10-05); touch.js/frameprof 404 | S | No (standing rule) | `bootcheck --base <CDN>`, `portalcheck --live`, R2 size listing |
| Perf: download | Clip dedupe + strip, cloned per skin (P1.1) | md5-identical x5; -8.15 MB | S | No | `dlprobe`, `rigcheck` all 5 skins |
| Perf: download | wasm Draco or meshopt instead of the 719 KB JS decoder; meshopt intake before kits (P2.0) | `ffg_kernel_3d.js:26` | S-M | No | `dlprobe`, `bootcheck` |
| Perf: frame | **Low tier: stop running the composer.** It stays allocated and running on low (`ffg_royale3d.js:285-291`). Measured low DPR 1.0 p50 72.5 -> 64.1 ms (run 1) and 110.7 -> 78.2 ms (interleaved run) without it | `tierprobe*.json` | S | No | `perfcheck --profile default` interleaved |
| Perf: frame | Auto-tier: every GPU defaults to medium (`ffg_royale3d.js:189`); pick low on iGPUs/phones from a short boot benchmark | SKEPTIC.md | S-M | No | `perfcheck --profile default`, `mobile.py` |
| Perf: frame | DynRes (DPR band ~0.5-1.5, hysteresis, step at most every 2 s through `kernel.setDpr`, `ffg_kernel_3d.js:333-347`) **only after an interleaved A/B confirms the gain**. Even DPR 0.5 stays ~3x over 22 ms on this iGPU (75 ms p50), so DynRes is not the fix by itself | `tierprobe_interleaved.json` | M | No | `perfcheck --profile default` interleaved |
| Perf: diagnose | Attribute the ashgrid ground p99 297 ms (render submit, cpuRender_p99 294 ms) with `?prof=1` on the iGPU | `perfcheck.log` | S | No | `perfcheck` |
| Harness | perfcheck `calls_med`/`tris_med` read 0 because the kernel sets `autoReset=false`; read them from frameprof. Teach framecheck `--real-draws` to count `multiDraw*` before any BatchedMesh lands | next-steps item 14; skeptic | S | No | perfcheck / framecheck self-test |
| Bots | **Step 1 (S): pacing by data:** scale the storm plan (`royale.js:293-307`) or soften tier 1-3 `aimErrDeg`/`reactionMs`. **Step 2 (M), if wanted:** tier-scaled decision terms in `bots.js:440-520` (engage range, commit threshold, disengage-to-rotate) + wider drop spread in `assignDrops` | Utility block reads personality, never tier (verified by skeptic); 55-67% of life in ENGAGE at every tier; matches end 264-380 s | S, then M | **Target length (D8)** | `probe_match.py` 24/24 + pacing rows; `botstates.py`; re-measure `perfcheck` ground/endgame (more bots alive = more skinning and LOS work) |
| Bots | Precomputed cover points from map colliders (worth more once towns exist) | 8-15% of ENGAGE in cover; 12-point ring sampler (`bots.js:2037-2049`) | M | No | `botstates` engage_in_cover >= 30% at tiers 4-5 |
| Bots | Bot squads for Duos/Squads (squad brains, knock/revive) | bots have no teamId (`ffg_royale3d.js:703`) | L | Yes (design) | new squad probe |
| Mobile | Guard `ensureCtx()` (`audio.js:450-452`) so a browser without Web Audio stays silent instead of throwing on every tap; owner's real iPhone checks the iOS unlock (`audio.js:887-892`) | webkitprobe page error | S | Owner's phone only | `webkitprobe.py` 0 page errors |
| Mobile | Gyro aim: blocked by the portal iframe allow-list (D11); HUD text scale is free now (`hud.js:4211` scales buttons only) | SKEPTIC.md | S (text scale) | Gyro: yes | `layoutcheck` at scale 0.85/1.2 |
| Feel | Mixamo 8-way rifle locomotion (real strafes and backpedal; today lateral plays the forward clip, backpedal = walk x -0.9, `player.js:2294-2306`) | Rifle_8-Way pack = 50 FBX on F: | M | No | `rigcheck`, `feelcheck` |
| Feel | Close the open support hand in ADS (orient LeftHand to the handguard after twoBoneIK) | `12_tpp_ads_ar.png`, `31_bot_closeup_a.png` | S-M | No | `rigcheck` palm-vs-barrel check |
| Feel | Gamepad support reusing `aimassist.js` | next-steps item 10 | M | No | new pad gate |
| Audio | Occlusion low-pass behind walls via `W.map.losBlocked` (worth more after towns/interiors) | next-steps item 11 | S-M | No | `feelcheck` |
| Robustness | Corpse sink uses wall-clock `setTimeout` (`player.js:2783`) and ignores pause and hit-stop; move it to sim time | camera-characters finding | S | No | `lifecycle`, stepped capture |
| Robustness | Immutable caching for `?v=`-stamped files (runtime JS is `no-store` today, ~0.75 MB gz re-downloaded every visit). The importmap three URL (`index.html:32`) must get a `?v=` first. Plus a first-party error beacon | next-steps item 13; SKEPTIC.md | S | **Yes** (CDN worker config is shared; the beacon is an outward call) | live gate |
| Online | Step A Durable-Object relay (lifts the 4-human cap, `net.js:367`); step B authoritative server + bot back-fill for 100 | Supabase limits; DO pricing | M-L / XL | **Yes (D9)** | `bridge_host.html` 2-8 clients; 100 headless clients, server tick p99 < 33 ms |

---

## 5. Cut, and why (one line each)

- **Kenney closed shells replacing house()/tower():** deletes interior loot, window cover rules and the bot drop cap (`maps.js:1113-1147`, `bots.js:231`).
- **One map-wide InstancedMesh per building type:** cannot be culled; +737k triangles in both passes (skeptic probe).
- **BatchedMesh draw-call claims ("+3 to +12 calls"):** `renderer.info` counts a multi-draw as one; the driver still sees ~one draw per instance on ANGLE.
- **Colliders taken from GLB bounds:** porches become invisible walls, and a failed load drops cover for some squad clients.
- **Porting citygen.ts line by line:** 753 lines of kaiju-scale traffic, harbour and destruction logic Last Circle does not use.
- **Town layout from the shared map RNG:** shifts trees, landmarks and loot on every seed and breaks before/after comparisons.
- **Roads lifted 0.10-0.20 m:** feet would sink into the pavement (`ROAD_LIFT` is 0.06).
- **Global saturation LUT / Data3DTexture:** the "LUT" was three lines of procedural maths, and it greys roofs, characters and rarity colours.
- **82% in-storm desaturation:** washes out enemies, the circle edge and rarity colours while you flee; 40-50% kept.
- **Storm alpha keyed to waterY, fixed-width streaks, frame-mean acceptance:** wrong ground at endgame circles, 15-25 px bands at 30 m, unreachable target.
- **Tinting only scene.fog inside the storm:** the sky dome ignores fog, so you'd get a cyan sky over purple ground.
- **4-14 m beams through roofs; additive rings ">= 2x floor":** 20% of loot is under a roof, and additive on bright sand clips to white.
- **AgX and ACES tone mapping:** AgX greys Savanna (saturation 0.252 -> 0.134); ACES raises brightness. Neutral stays.
- **Stock GTAOPass on any tier:** its normal pre-pass took 268 -> 484 calls and 2.06 M -> 4.12 M triangles, and drew sprites black. Baked contact AO kept instead.
- **VSM shadows:** +76% triangles, no visible gain.
- **HDRI image-based light:** barely changed rough terrain.
- **Procedural fbm clouds evaluated per pixel:** 7.0-12.8 ms minimum full-screen on this iGPU; baked-texture clouds kept.
- **Height-fog shader patch:** recompiles 1,501 materials (+20 programs); altitude-scaled fog density kept (0 cost).
- **SMAA on medium/low:** too costly on the iGPU; high only.
- **DynRes "now justified" and "half-res bloom":** the 0.75-DPR win did not reproduce, and bloom is already half-res.
- **Porting Blackridge viewmodel.js wholesale:** it drives the world camera, and a camera kick would move shots in Last Circle.
- **Viewmodel rendered after the composer:** not the shipping path (programs are keyed to the render target).
- **Lossy WebP normal maps; copying the reference's camo onto our gun:** banding on a screen-filling gun; the viewmodel must match our third-person gun.
- **PUBG tap/hold ADS split:** changes the signed-off right-mouse input.
- **Making first-person the default:** conflicts with the signed-off third-person doctrine; it is an option (D1).
- **Deploy as an owner gate:** under the standing build-to-CDN rule it is the last step of authorized work.
- **"IAUS rewrite" as the first pacing fix:** the code already is a utility system; a data-table change comes first.
- **Sharing one AnimationClip object across skins:** per-skin rebase and prune would corrupt other skins.
- **Visual-gap's "ACES exposure 1.05" baseline:** wrong; `maps.js:463-464` sets Neutral 1.15 at runtime.
- **Building, harvesting, a map picker:** owner rules. "Find a new match" picks a random map.
- **Hathora hosting:** left the game-hosting business in 2026. **Full-mesh WebRTC or Supabase fan-out for 100 players:** 99 peers per browser / 99,000 msg/s.
- **medieval-settlement-threejs repo:** no licence (study only). **Poly Pizza CC-BY parachute:** unknown shape, needs attribution; we author our own.
- **Meshy death2/death3:** against the Mixamo-only rule and fall-and-recover; replaced by Mixamo deaths (P1.6).

---

## 6. Best side-by-side images to show the owner (ours vs reference)

All under `C:/Users/TestRun/AppData/Local/Temp/claude/C--Users-TestRun-Claude-Claw/82f9ca33-342f-4680-86ad-98a5ab9d2079/scratchpad/lc_look/`:

1. `visual-gap/sheets/01_drop_overview.jpg`: reference drop view (dense towns, river, mountain) vs our three maps (empty hazy plains). **The core gap in one picture.**
2. `world-towns/shots/CONTACT_before_after.png`: shipping vs the CC0 street-grid prototype, at parachute height and at street level, plus the prototype furnished room.
3. `camera-characters/shots/90_reference_vs_lc.png`: reference first-person and ram-air canopy vs our third-person, our dome canopy, and the Blackridge viewmodel mocked into our world.
4. `hud-vfx/contact_sheet_ref_vs_ours.png`: HUD, storm wall at 30 m, loot beam and ring, kill feed / death banner, post-match, and our cube hit sparks and flat tracer.
5. `lighting-post/shots/sheet_ground.jpg` + `visual-gap/review/tone_sheet.jpg`: reference street vs our grade variants on all maps. These are the D4 A/B material, and they show grading alone does not close the gap.
6. `lighting-post/review/shots/ground_clouds.jpg`: the dome-cloud prototype (P1.7).
7. `world-towns/review/shots/_sheet_merge.jpg`: today's camera inside a house (a wall covers half the screen); the reason for D3 / P3.1.
8. Reference frames for the owner's own comparison: `reference/ref_t08_drop_overview_towns.jpg`, `ref_t22_parachute_downtown_storm.jpg`,
   `ref_t52_fpp_street_houses_lootbeam.jpg`, `ref_t84_interior_lootrings_storm_inside.jpg`, `ref_t100_storm_wall_eliminated_banner.jpg`, `ref_t113_postmatch_standings.jpg`.
