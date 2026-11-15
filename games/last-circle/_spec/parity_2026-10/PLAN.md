# Last Circle - Parity Plan (FINAL, 2026-10-20)

Build audited: LIVE `9115494d` (Waves 1-7b, `?v=1792458191`). Wave 8 (furnished interiors) is still being finished in the same tree.
Inputs: 11 dimension audits (scratch `lc_parity/<dimension>/notes.md`), the synthesis draft, and skeptic verification votes on LC-01..LC-17.
Machine-readable register: `gaps.json` (96 gaps, same IDs, with files, wave, lane, gate and verification status).
This is a plan. No game code was changed to write it.

---

## 1. Summary for the owner

Last Circle is a solid browser battle royale: themed towns on all three maps, 50 players with bots, good hit feedback and a clean
menu. Next to PUBG, Fortnite, Apex and Warzone it is still behind in five places you notice every match:

1. **Shooting has no skill curve.** A held rifle doesn't climb at all, and there are only 6 guns and no grenades.
2. **Sound is placed at the camera, not the character.** Enemies behind you sound much louder than enemies in front.
3. **It looks rough.** There is no edge smoothing on any setting, the drop view is very pale, and walls are plain.
4. **It runs slowly on an ordinary laptop chip.** We measured about 16 fps on the default setting, and nothing lowers quality automatically.
5. **Squads are thin.** There are no pings, no knock-and-revive, and teammates land far apart. One bug can leave a frozen teammate so the match never ends.

The plan below fixes these in four waves. **Wave P1 can start today** because it doesn't touch any file the Wave-8 build is editing:
recoil, grenades (built switched off until bots can throw them), sound position, edge smoothing, auto quality, pings, and the squad lobby bug.
Waves P2-P4 start after Wave 8 is live.

Section 3 lists the decisions only you can make. The biggest is whether the final circle may land away from the map centre.

---

## 2. Scorecard: each dimension against the top battle royales today

Ratings are my judgement on a 1-5 scale, where 5 means level with the reference. The evidence beside each rating is measured or cited.
"AAA" means PUBG, Fortnite, Apex and Warzone. "Web" means the best browser BRs (Final Drop, ZombsRoyale, surviv/survev).

| Dimension | AAA | Web | Evidence (what holds it back / what is already strong) |
|---|---|---|---|
| Gunplay | 2 | 4 | **Behind:** no recoil climb (0.5157 deg on every shot of a 30-round AR spray, 0.0 deg at the end; verify/lc01). 6 guns, one per class (royale.js:77) vs PUBG's 12 ARs + 8 DMRs (pubg.wiki.gg/wiki/Weapons). No throwables (weapons.js:13). Explosions hit through walls (weapons.js:926-969). Body hit volume reaches 0.55-0.75 m off-centre vs arm bones at 0.18-0.22 m (gunplay/probe_out.json). **Strong:** layered hit feedback with shield-break ring and damage numbers (hud.js:2986-3069). |
| Movement & animation | 2 | 4 | **Behind:** combat strafes slide the forward clip sideways, feet skating 2.7x forward speed (verify/lc10). No slide (sprint + C keeps sprinting at 8.0 m/s). Pistol crouch-walk legs frozen (0.0002 m foot range). No jump/fall/land clips. No shoulder swap. **Strong:** a glider can't pass through walls (3/3), and mantling works (movement/notes.md). |
| Audio | 2 | 3 | **Behind:** the listener is at the camera, 4.26 m behind the character. A walking step at 16 m is 21.8 dB louder behind than in front (verify/lc02). Gun reports are dry, down to -40 dB in 30-60 ms, with no speed-of-sound delay. No occlusion. Remote players are silent on a guest. Apex ships 4 or more distance layers per weapon (asoundeffect.com/apex-legends-sound). **Strong:** HRTF panners and a voice pool capped at 24 (audio.js:43-45). |
| Visuals | 2 | 4 | **Behind:** no AA on any tier (live: antialias:false, SAMPLES 0; verify/lc03). The drop view's mean luminance is 0.67-0.81 vs 0.32-0.33 in the owner's reference (verify/lc04). Walls use one roughness and near-white grain. Water seams show. Explosions are gone in about 3 frames. **Strong:** themed towns and kit buildings, photo asphalt, trim geometry (verify/lc17). |
| UI / UX | 3 | 4 | **Behind:** no ping or marker (0 DOM nodes on MMB/Z/G; verify/lc07). Cold click to control is 21-30 s vs CrazyGames' 20 s bar (docs.crazygames.com/requirements/technical). The loading bar jumps back from 92% to 15%. Quitting records placement 51/50. No colour-blind mode or HUD scale (Apex and Fortnite have both: ea.com/able/resources/apex-legends/pc/features). **Strong:** live 3D menu, dailies, honest boot-failure card with auto-retry. |
| Loot | 2 | 3 | **Behind:** a heal is spent at start and can't be cancelled (verify/lc05), while Apex lets you cancel any time (apexlegends.wiki.gg/wiki/Regen). Death piles are an unreadable scatter. 1-2 supply drops with no visible marker after landing. No loot tiers or hot zone. **Strong:** 5 rarities with a clear colour language. |
| Bot AI & match flow | 2 | 4 | **Behind:** bushes don't hide a player from bots (452 of 456 sight lines clear). Re-peeks get no fresh reaction delay (p10 0.05-0.10 s). Endgame HUNT walks to the true enemy position. Cover is used in 2.6-3.4% of fights (verify/lc12). Calm bots skip shields they carry 42-58% of the time (verify/lc20). The CS bot's design calls for human limitations (Booth, GDC 2004). **Strong:** tiers, personalities, skill servo, staggered thinking. |
| Online / squads | 1 | 2 | **Behind:** at most 4 humans, all in one squad. No DBNO, revive or respawn (verify/lc15). A phantom lobby slot reproduces on the live net.js. Forged hits are trusted. Squadmates' drop points are 440-1019 m apart (verify/lc18). The squad dissolves after every match. surviv and ZombsRoyale have duo/squad fill and pings. **Strong:** map-version guard, invite links, squad chat. |
| World | 3 | 4 | **Behind:** the final circle centre is p50 37 m and max 119.7 m from the map centre (2000 seeds; verify/lc13). On Isla Viva every final centre is on the volcano. 43-55% of off-POI points are more than 20 m from hard cover. POI identity is lost (Container Yard has 5 containers). **Strong:** 97.5-99.6% of buildings enterable, endgame areas, bridges (CHANGELOG 7b). |
| Performance | 2 | 3 | **Behind:** UHD iGPU at default medium runs 15.5-17.5 fps in the drop (lane and verifier; shared iGPU, upper bounds). No auto-tier or dynamic resolution. Nav tiles bake on the main thread in the drop. Instanced props are never frustum-culled (76-83% of triangles). **Strong:** a 4-match soak with no heap growth and 0 page errors. Warzone ships an FPS-target dynamic resolution (news.blizzard.com/en-us/article/23662537). |
| Meta / retention | 2 | 2 | **Behind:** no duos or trios with bot teammates, no LTM. 8 unlocks in total, 2 emotes. W.stats is never incremented. Quick Match can offer a challenge longer than its storm. "SEASON 1" appears with no season system (meta/notes.md). ZombsRoyale runs seasonal passes and rotating LTMs (en.wikipedia.org/wiki/ZombsRoyale.io). **Strong:** XP, levels, dailies, career page, portal achievements. |

---

## 3. Owner decisions needed (each with a recommendation)

Nothing tied to these ships until your answer is recorded in CHANGELOG.md.
Anything that costs money goes through the Telegram YES/NO gate first.

| # | Decision | Recommendation | Why |
|---|---|---|---|
| OD-1 | **Final circle placement (LC-13).** This re-opens world-plan O4, where we left the storm alone and built endgame areas instead. Allow circles to land anywhere on land? | **Yes**, with area-uniform placement and a land check (F about 0.85). Keep the storm timeline. | Sim of 2000 seeds x 3 maps: final-centre p50 rises from 37 m to 164-185 m, 0 circles in water, storm total stays 920 s, every edge-speed cap holds. PUBG reduced zone-centring "to make circle locations less predictable" (patched.gg/games/pubg-battlegrounds/dev-letter-blue-zone-revamp), and Fortnite centres are random (fortnite-archive.fandom.com/wiki/The_Storm_(Battle_Royale)). The late-phase half has no cheap fix: accept matches ending in circle 5 (your D8 target is met). |
| OD-2 | **Darker, higher-contrast drop view (LC-04).** This reverses the bright look you approved on 2026-07-20 (look-plan D4, step B). | **Approve a target mean of 0.45-0.50 per map**, picked from an A/B sheet that P1-G makes from the live build. | Exposure alone moves brightness only ~11%. The verifier reached 0.41-0.51 by lowering exposure, fill light and ground colour together. Going darker than that turns Savanna muddy. |
| OD-3 | **Respawn style for squads (LC-15).** | **Ship knock-and-revive (DBNO). Add a timed redeploy before circle 4 later if you want it.** Skip Apex-style beacons. | DBNO is standard in every reference squad BR (pubg.wiki.gg/wiki/DBNO). Beacons need world props and new HUD. |
| OD-4 | **Modes (LC-19):** Duos/Trios with bot teammates, a rotating LTM, ranked. | **Duos/Trios with bot teammates first**; no ranked. | Online rooms hold at most 4 humans, so a solo player never gets a squad today. Ranked needs a player population we don't have. |
| OD-5 | **Attachments (LC-37).** The audit lanes disagree. | **No attachments for now.** Revisit optics-by-rarity in P4. | The roster and throwables add more choice per hour of work. |
| OD-6 | **Gun feel taste calls:** per-class ADS time (LC-34), melee (LC-56), per-shell shotgun reload (LC-57), crouch speed (LC-62). | **ADS times yes. Melee, per-shell reload and crouch-speed changes no.** You approved crouch speed 0.72 on 2026-07-28. | ADS time is data-only and standard. The other three are taste or already decided. |
| OD-7 | **Landing choice (LC-59).** You removed drop-select on 2026-09-15. | **Optional big-map waypoint during freefall; default stays auto.** | Landing choice is currently limited to about 200 m around an auto-picked POI. |
| OD-8 | **Fall damage (LC-61).** | **No HP damage; a 0.4 s landing stagger only.** | Apex has no fall damage, and an HP penalty punishes the drop you designed. |
| OD-9 | **Teammate status (LC-18).** The HUD layout is signed off. | **Show it inside the existing vitals anchor**, with no new panel. | Keeps your sign-off intact. |
| OD-10 | **Paid relay or TURN server (LC-49/LC-50).** | **Not now.** Revisit only if squad rooms grow. Any spend goes through Telegram approval. | One 4-human room on the relay uses about 80 of the project-wide 100 msg/s (net.js:1101-1117). |
| OD-11 | **Enemy name tags (LC-42).** Today they show out to 70 m. | **Show them only within about 25-30 m or when aimed at.** | Reference BRs don't tag enemies at range. Tags out to 70 m are a readability crutch. |
| OD-12 | **Vehicles (LC-94)**, prone (LC-93), Isla Viva size, start radius (LC-48), weather variants, skin palettes, armour, diving, gamepad. | **Vehicles: no** (cost: XL, physics + net sync + bot driving on our own collision; benefit: small, since sprint 8 m/s crosses the 1.6 km map in ~200 s). **Prone: no.** The rest: decide after P2 data. | Fix portals (LC-51) first, and ziplines (LC-60) if traversal still needs help. |

---

## 4. Implementation waves (file-disjoint lanes, with acceptance gates)

**Wave-8 files** (no lane may touch them until Wave 8 is deployed and live-checked): `maps.js`, `housegen.js`, `towngen.js`, `citykit.js`,
`bots.js`, `navgrid.js`, `player.js`, `loot.js` and `_harness/*`.

Rules for every wave:
- No two lanes in one wave edit the same file.
- One **integrator** per wave owns all of these, and lanes write `credits_<lane>.md` / `changelog_<lane>.md` beside this plan instead:
  - `CHANGELOG.md`, `CREDITS.md`, `AUDIO_SOURCES.md`;
  - the `MAP_GEN_VERSION` bump (maps.js:499; already 6 for Wave 8);
  - the cache-bust, deploy and live check.
- Any change that alters seeded world or loot output bumps `MAP_GEN_VERSION`, so the squad version handshake refuses mixed builds.
- P1 lanes gate with node selftests plus Playwright probes run from a scratch dir against a local server. Nothing is written into `_harness`.
  Those probes are ported into `gate.py` in P2-F.
- Every iGPU number is measured ABAB on a quiet box (the audits' iGPU was shared, so their ms are upper bounds).

### Wave P1 - starts now (no Wave-8 files)

**P1-A Gunplay core** - `runtime/sim/royale.js`, `runtime/sim/royale.selftest.cjs`, `runtime/3d/royale/weapons.js`

- **LC-01 recoil**, per the verifier's design (about 20 lines):
  - automatics only, human only, touch skipped;
  - burst shot counter and a per-gun deterministic pattern table;
  - recovery held while the trigger is held;
  - climb capped at AR 0.07 rad and SMG 0.05 rad;
  - recovery never pulls below the burst baseline.
- **LC-33 spread:** per-shot bloom inside `K.effectiveSpread`, plus disc pellet sampling.
- **LC-25 explosion line of sight:** `W.map.losBlocked` is read-only use of the maps API.
- **LC-14 frag, built dark:**
  - a `frag` WEAPONS entry kept out of `WEAPON_IDS`;
  - a CONSUMABLE with `throws`, its own throw branch in `stepWeapon` (never through `useConsumable`/`applyHeal`), using the pooled arcing round and `explode()`;
  - added to the loot rolls **at weight 0**, so loot layout per seed stays byte-identical.
- **LC-05 hook:** at the top of `equipSlot`, `if (a.healing && !a.isBot && idx !== a.inventory.active && W.cancelHeal) W.cancelHeal(W, a)`. It stays inert until P2-A defines `W.cancelHeal`.
- **Gates:**
  - **Recoil:** 30-round AR ADS burst at 60 Hz peaks at 3-4 deg; pitch is back to baseline within 0.4 s of release; tapped pistol peaks at 0.5 deg or less; same seed gives the same per-shot pitch; touch path unchanged.
  - **Spread:** after shot 1 at most 0.35x max, at least 0.95x by shot N; 0 of 10k pellets outside the reticle radius.
  - **Explosions:** a shell or frag against a wall does 0 damage to a dummy 1.5 m behind it.
  - **Frag:** lands within 0.5 m of the computed arc; never changes HP or shield through the heal path.
  - **Loot and selftest:** loot placement hash unchanged; `node royale.selftest.cjs` green.

**P1-B Audio** - `runtime/3d/royale/audio.js`, new files under `assets/audio/sfx/`

- **LC-02:** listener position at the focus actor's head, orientation from the camera (the Unreal listener-attenuation pattern).
- **LC-08:** FFSL mid-distance takes beyond 80 m (already shipped CC0 library), a synthetic outdoor tail, and a distance delay beyond 25 m.
- **LC-26:** per-source roof test, room/outdoor sends, and slab-test occlusion via `W.map.queryColliders` (read-only).
- **LC-09:** footsteps for `netRemote` actors synthesized from position deltas, so player.js isn't needed.
- **Mix and music:** LC-53 teammate -8 dB / enemy +2 dB plus threat ducking; LC-54 phase crossfade and gapless loop.
- **New CC0 sounds:** LC-55 shield/flesh/break/explosion samples; LC-67 vocals; LC-68 drop wind.
- **Settings engine:** LC-69 `audio.setOutput/setMix/setMono` (the Settings rows come in P2-G).
- **Fixes:** LC-87 guard `ensureCtx` (audio.js:452); LC-95 hygiene; pass feet height to `surfaceAt` (LC-52, part).
- **Gates:**
  - **Listener:** footstep pairs at +/-9 m and +/-16 m within 1.5 dB of each other; crouched step 9 m ahead louder than -45 dBFS.
  - **Gun reports:** AR at 5 m takes at least 250 ms to reach -40 dB; sniper at 450 m starts at least 1.2 s after emit.
  - **Occlusion:** occluded AR at 20 m is 4-8 dB lower with a centroid at least 40% lower.
  - **Mix:** teammate step at least 6 dB under an enemy step.
  - **Remote steps:** a guest hears at least 80% of the host's footsteps for host bots.
  - **Budget:** 10-shooter sim stays at or under 24 voices and 0.3 ms/frame of audio; added SFX at or under 450 KB, all CC0 and recorded.
  - **No Web Audio:** a WebKit build without Web Audio shows 0 page errors.

**P1-C Render, quality and boot** - `runtime/3d/ffg_kernel_3d.js`, `runtime/3d/ffg_royale3d.js`, `runtime/3d/lc_output_pass.js`,
`assets/vendor/three/examples/jsm/{postprocessing/SMAAPass.js, shaders/SMAAShader.js, shaders/FXAAShader.js}` (copied from games/ascendant, r172, MIT), `index.html` (favicon only)

- **LC-03 anti-aliasing,** added after the output pass:
  - medium: FXAA, or SMAA if it measures within budget;
  - high: SMAA;
  - low tier and touch unchanged. Never `antialias:true` on the renderer.
- **LC-06 quality:**
  - **First-run auto-tier (desktop, never clicked a tier):** about 90 menu frames on the GPU timer. If p50 is over about 12 ms, pick low.
  - **In-match ladder:** bloom off, then DPR 1.25, then 1.0. Hysteresis down at p75 > 22 ms and up after 4 s under 14 ms, at most one step per 2 s.
  - **Never changed mid-match:** loot or weapon cull, maps.js build switches, or routing to low.
  - **Exposed for the Video tab:** `W.setGfx(key, val)`.
- **LC-23:** prefetch actor and clip GLBs while the menu is idle. The URL list is imported read-only from player.js exports.
- **LC-44:** forfeit through the sim before `endMatch` (ffg_royale3d.js:1007).
- **LC-87:** context-loss resume; favicon.
- **LC-18:** "Run it back" calls P1-D's `net.rematch()` instead of `netMod.leave` (ffg_royale3d.js:1077/1080).
- **LC-43 hook:** optional daltonize step in the output pass, driven by P2-G.
- **Gates:**
  - **AA:** stair-step edge pixels -50% on 3 fixed views; at most +0.8 ms GPU on the UHD at medium; storm grade unchanged.
  - **Auto-tier and ladder:**
    - auto-tier decided within the menu warm-up;
    - ground raw p50 at or under 20 ms on all three maps at the auto-picked settings;
    - 0 programs compiled after the first drop frame;
    - phones identical.
  - **Load:** cold cache plus 15 s menu idle gives Quick Match click-to-control in 20 s or less (median of 3).
  - **Quit:** at 4 s shows placement N/50 with N = alive count.

**P1-D HUD, comms and netcode safety** - `runtime/3d/royale/hud.js`, `runtime/3d/royale/net.js`, `runtime/3d/royale/net.selftest.cjs`, `runtime/3d/royale/nametags.js`

- **LC-07 ping:**
  - **Input:** MMB plus a rebindable Ping key, using hud.js's own window listeners. The world point comes from `K.aimRayDist` (read-only).
  - **Shown:** a world pip with distance and an edge arrow, a compass tick, and a minimap/big-map diamond.
  - **Big map:** a click places a pin and right-click clears it.
  - **Lifetime:** 30 s, or on arrival for "go" pings.
  - **Network:** `qsend("ping")` limited to 1/s and team-filtered.
  - **Sound:** a `pingPlaced` event that P1-B voices.
  - Touch gets no binding.
- **LC-11 netcode safety:**
  - prune `S.peers` on presence-leave;
  - bind sender to slot for state/hitYou/died/bye/takeover (precedent net.js:208-218);
  - the host watchdog also covers peers that never sent state.
- **LC-09:** sprint flag bit, plus a relay of host-side `healStart`/reload events.
- **LC-18:** `net.rematch()` keeps the room.
- **LC-14:** frag HUD entries (CON_NAME/COLOR/icon, the short-name map) and the dead `"grenade"` check at hud.js:3790; remote explosion relay.
- **Menus and copy:**
  - LC-23 monotonic loading bar with map name and tips;
  - LC-82 copy fixes, LC-83 menu fit, LC-81 damage-taken recap, LC-44 quit confirm;
  - LC-19 mode-aware challenge pick, plus W.stats increments from existing events;
  - LC-70 indicator rule; LC-85 squad panel restyle;
  - the HOST LEFT banner is no longer swallowed by the death box (hud.js:4150-4157).
- **Gates:**
  - **Ping:**
    - MMB on a point about 120 m away puts one marker in world, compass and minimap within one HUD tick, reading 120 +/- 3 m;
    - a big-map click places a pin and the map stays open;
    - the guest sees the host's ping within 500 ms.
  - **HUD anchors:** 0 moves.
  - **Lobby bug:** the phantom probe (`phantom.mjs` pattern) assigns no slot.
  - **Forged messages:** hitYou/died/takeover from a guest console change nothing.
  - **Net selftest:** `node net.selftest.cjs` green plus new rows.
  - **Loading bar:** sampled at 4 Hz, never decreases.
  - **Menu fit:** at 1280x720, 1366x768, 1536x864 and 1920x1080, no control is outside the viewport.
  - **Copy:** the stale strings grep to 0.
  - **Challenges:** Quick never offers a challenge longer than its storm.

**P1-E FX and storm look** - `runtime/3d/royale/fx.js`, `runtime/3d/royale/storm.js`, new files under `assets/fx/`

- **LC-40:** explosion flipbook, flash, smoke column, debris and scorch; per-surface impacts.
- **LC-72:** storm streaks fade with distance and height.
- **Gates:**
  - an explosion at 14 m changes at least 2,000 px for at least 1.5 s, with the smoke top at 6 m or higher;
  - 4 simultaneous blasts fit inside the 1,024-quad pool, at +0 draw calls;
  - in circle 1 the storm wall changes 15% of sky pixels or fewer;
  - existing storm gates still pass.

**P1-F Animation bake (no runtime wiring)** - `_tools/art_a_make_loco8.mjs` (new; copy of `art_a_make_deaths.mjs`), new files under `assets/chars/clips/`, sidecar manifest (not the live `manifest.json`)

- **Clips to bake** from the local Mixamo library (CC0-equivalent royalty-free, $0, Mixamo only):
  - Rifle_8-Way walk/run (left/right/back), crouch-walk left/right/back;
  - pistol strafes;
  - jump up/loop/down, falling idle, hard landing;
  - `toss grenade`;
  - `zombie crawl`/`running crawl` and `injured idle` for DBNO;
  - reload clips;
  - 4 or more Gestures/Breakdance emotes.
- **Stride per clip:** measured at bake time.
- **Gates:**
  - rest-delta retarget error at or under 0.01 deg against `rifle_idle`, the same check as the death clips;
  - the rifle strafe set adds 260 KB or less, and all clips together 700 KB or less;
  - licence lines in `credits_P1-F.md`.

**P1-G Owner decision packs (scratch only, no repo writes)**

- **LC-04 A/B sheet:** 3 maps x 4 grades, made by changing settings inside the page on the live build.
- **LC-13 storm study:** the proposed-storm 2000-seed sim plus the edge-speed table.
- **Probe staging:** scratch probes staged for P2-F.
- **Gate:** the owner has both sheets before P2 starts.

### Wave P2 - after the Wave-8 deploy is live and verified (Wave-8 files open)

**P2-A Player and camera** - `player.js`, `pose.js`

- **LC-05:** spend on completion via `finishHeal` (look the slot up by id); `W.cancelHeal` defined.
- **LC-10:** quadrant clip pick on a body-local angle with 10 deg hysteresis, timescale from the baked stride, orientation warp for diagonals.
- **LC-30:** jump/fall/land, mantle legs, pistol crouch-walk.
- **LC-21:** slide.
- **LC-31:** shoulder swap plus free-look.
- **LC-35:** reload timescale and a pistol reload.
- **LC-14:** human throw clip and key.
- **LC-18:** squad drop point shared from the seed; spectate a squadmate first.
- **LC-59:** freefall waypoint, if OD-7 is approved.
- **LC-46:** read rebindable Drop/Fire.
- **Gates:**
  - **Strafe skate:** combat strafe planted-foot skate 1.25x forward or less (today 2.68-2.78x ADS, 2.2x hip).
  - **Heal:** medkit at hp 30 switched at 1.0 s leaves the count unchanged and the pistol fires; a full heal costs one medkit and reaches hp 100.
  - **Slide:** peaks at 9.5 +/- 0.3 m/s and decays to 4.4 m/s or less in 0.7-0.9 s.
  - **Shoulder swap:** offset -0.70 +/- 0.02 m within 0.25 s; crosshair truth passes on both shoulders.
  - **Squad drop:** touchdowns within 100 m on at least 95% of 400 seeds.
  - **Rig and cost:** rigcheck green on all 5 skins; mixer cost +0.3 ms or less at 50 actors.

**P2-B Bots** - `bots.js`

- **LC-12:**
  - for new acquisitions only, the notice range shrinks: crouched x0.7, still x0.75, in a bush (via P2-C's `concealAt`) capped at about 12 m;
  - `acquireT` resets when the same target is re-seen after more than 0.9 s;
  - HUNT goes to the last heard shot (under 20 s old), otherwise the next circle centre;
  - cover is used at range (seen, more than 30 m, AR or sniper).
- **LC-20:** shields topped up when calm.
- **LC-96:** new-player grace in the first 60-90 s after landing.
- **LC-14:** bot frag throws via `arcPitch`.
- **Other:** PREFER_RANGE for the new guns; humans-only heal cancel stays bot-exempt.
- **Gates (24-match AFK batch):**
  - re-sight-to-shot median at or above each tier's reactionMs;
  - ENGAGE in-cover share at least 15%;
  - calm bots under 50 shield holding an unused shield item 10% or less;
  - median alive-bot shield at t >= 600 s at least 75;
  - AFK human median survival at least 150 s;
  - at least 1 bot frag per match;
  - match-end median still 10-15 min;
  - navcheck/botcheck show no regression.

**P2-C Map materials and render cost** - `maps.js`

- **LC-04** per OD-2: exposure, hemisphere fill, environment and albedo applied in `colorAt`; Savanna desaturated.
- **LC-17:** per-kind roughness and metalness (metal 0.45/0.5 now that IBL exists); CC0 photo detail on walls (low tier skipped); wear baked into vertex colours.
- **LC-89:** per-cell instanced prop chunks so the camera frustum culls them.
- **LC-52:** `surfaceAt` from splat weights, not from neighbouring colliders.
- **LC-12:** `concealAt` export.
- **LC-39:** water seam fix.
- **Gates:**
  - drop-view luminance mean 0.45-0.55 and p5 at or under 0.25 (if approved);
  - facade local contrast +30%, wall base 15-25% darker;
  - Deepwood ground-frame triangles -40%;
  - footstep census at least 90% correct per zone;
  - download +1.5 MB or less;
  - world placement hash unchanged except intended layers (genversion gate).

**P2-D Weapons roster and storm** - `sim/royale.js`, `royale.selftest.cjs`, `weapons.js`, `storm.js`

- **LC-16:** DMR, LMG and burst AR, with an explicit `fire` field and burst cadence. All three positional loot weight lists extended together. CC0 models.
- **LC-22:** bone-driven hit volumes.
- **LC-13:** storm placement, if OD-1 is approved, plus the `landAt` predicate from `W.map.heightAt`.
- **LC-34:** ADS times, if OD-6 is approved.
- **LC-14:** frag loot weight switched on, after P2-A and P2-B pass.
- **LC-77:** chest table with no commons.
- **LC-29:** tier tables.
- **Gates:**
  - **Roster:** selftest length 9. DMR beats AR at 90 m and AR beats DMR at 15 m. LMG has the highest sustained value at 30 m. Each new gun spawns from a seeded roll.
  - **Bot soak:** over 10 matches every gun gets at least 1 kill.
  - **Hitboxes:** no body hit more than 0.06 m outside the bone silhouette; head-top + 0.1 m misses.
  - **Storm:** 2000-seed final-centre p50 at least 150 m, 0 circles in water, total time 920 s.

**P2-E Navigation** - `navgrid.js`

- **LC-88:** bake tiles in idle slices or a worker, or before the drop.
- **Gate:** drop-frame bots section at or under 3 ms p95; navcheck unchanged.

**P2-F Harness** - `_harness/*`

- Port the scratch probes into `gate.py` with negative controls: spray, hitbox sweep, feet skate, audio tap, ping, loading bar, footstep census, cover/re-sight bot batch, phantom lobby.
- Add an iGPU profile (`--profile default`) and fix perfcheck `calls_med 0`.
- Pass the storm `landAt` predicate to every harness Storm caller (probe_city.js, placement_census.mjs, perf_district.py, shotsheet.py).
- **Gate:** full `gate.py --disk --negative-controls` green.

**P2-G Settings, map and onboarding** - `hud.js`, `nametags.js`

- **LC-46:** tabs and rebinds.
- **Video and Audio tabs:** rows driven by `W.setGfx` and P1-B's API.
- **LC-43:** colour-blind (3 modes), HUD scale with anchor-corner origin, brightness, flash reduction.
- **LC-24:** local minimap at 3 m/px or finer; big-map zoom, pan and grid.
- **LC-45:** one-time hints and short guided practice.
- **LC-16:** icons and the BURST label.
- **LC-28:** supply banner order.
- **Gates:**
  - every tab except Controls fits at 1280x720;
  - rebinding Drop to G works and Q does nothing;
  - at 130% HUD scale every panel stays inside its anchor corner;
  - each hint fires exactly once.

**P2-H Loot** - `loot.js`

- **LC-27:** death pile with the full ammo bundle and one marker in the best item's rarity colour.
- **LC-28:** 3-4 supply drops, hold-E to open, beacon until opened.
- **LC-29:** hot zone.
- **LC-76:** ammo tints.
- **LC-77:** burst at the gun's spot.
- A chest accessor for audio.
- **Gates:**
  - a bot killed holding 240 medium drops 240 medium;
  - at least 3 drops have landed by t = 760 s on 3 seeds;
  - high-tier POIs give at least 1.5x the rare share of basic POIs;
  - squad determinism gate passes.

**P2-I Towns and houses** - `towngen.js`, `citykit.js`, `housegen.js`, `assets/tex/`

- **LC-17:** town and house materials.
- **LC-47:** rotation cover and road smoothing.
- **LC-29:** POI identity (Container Yard containers, Old Mall, log piles).
- **Gates:**
  - Container Yard has at least 30 containers on every seed;
  - 30% or fewer off-POI points are more than 20 m from hard cover;
  - draw calls +6 or less, texture memory +24 MB or less.

**P2-J Audio round 2** - `audio.js`

- Chest shimmer via P2-H's accessor, and a final mix pass against P2 measurements.
- **Gate:** P1-B gates re-run inside a Wave-8 house.

### Wave P3 - squad features and world polish (one feature split across file owners in the same wave)

- **LC-15 DBNO and revive (respawn per OD-3):**

  | File owner | Slice |
  |---|---|
  | `sim/royale.js` + `weapons.js` | downed capsule 0.6 m via `K.actorHeight`; downed gates |
  | `player.js` | downed state in `hurtActor`, crawl, revive channel copied from the chest channel |
  | `net.js` | one spare flag bit plus a `revive` message |
  | `hud.js` | BLEEDING OUT inside the vitals anchor; `[HOLD E] Revive` using the existing ring |
  | `loot.js` | downed gate |
  | `bots.js` | finish or ignore downed players; bot teammates revive in Duos/Trios |

  **Gates:**
  - a two-human probe goes knock -> crawl -> 5 s revive and ends on 30 HP;
  - bleed-out kills when the timer ends;
  - a squad is eliminated only when all its members are downed or dead;
  - solo play is unchanged;
  - per-tick net bytes are unchanged.
- **LC-19 Duos/Trios with bot teammates (OD-4):**
  - mode table in sim;
  - team assignment in `ffg_royale3d.js`;
  - squad behaviour in `bots.js`;
  - menu card in `hud.js`.
  - **Gate:** bot teammates share `teamId`, follow within 60 m, and revive.
- **LC-14 smoke:**
  - clouds in `fx.js`;
  - spheres respected by `losBlocked` in `maps.js`;
  - bot use in `bots.js`.
  - **Gate:** smoke cuts bot line of sight to 0 for its lifetime, at +0.3 ms or less with 3 smokes on the iGPU.
- **LC-49 netcode:** sequence numbers and server-time stamps in `pack()`; rejoin within 60 s on `?room=`.
  - **Gate:** out-of-order injection never pulls a remote backwards.
- **Polish:**
  - `player.js`: LC-32 camera boom keeps the shoulder offset plus dither; LC-64 turn-in-place; LC-65 crouch toggle and invert-Y; LC-42 readability floor and tag distance per OD-11.
  - `maps.js`: LC-38 foliage wind; LC-51 portals; LC-73 sky islands; LC-41 baked AO; LC-74 cloud shadows; LC-90 landmarks; LC-48 start radius (OD-12).

### Wave P4 - optional, owner-gated or low ROI

LC-36 bullet drop, LC-37 optics (OD-5), LC-58 glint, LC-60 ziplines, LC-61 landing stagger (OD-8), LC-63 diving, LC-71 CSM on high,
LC-75 skin palettes, LC-78/79/80 inventory screen, boosts and armour, LC-84 gamepad, LC-91 doors.

### Top of the ROI order (score = severity x impact / effort; full list in gaps.json)

| Score | Gaps |
|---|---|
| 20 | LC-01 recoil, LC-03 AA |
| 16 | LC-02 listener, LC-05 heal cancel |
| 12 | LC-11 lobby/trust, LC-20 bot shields, LC-31 shoulder swap |
| 10 | LC-04 drop look (OD), LC-06 iGPU, LC-10 strafes, LC-13 circle placement (OD), LC-14 frag |
| 9 | LC-25 explosion LOS, LC-44 quit placement, LC-53 mix |
| 8 | LC-07 ping, LC-08 gun reports, LC-09 remote foley, LC-12 bot AI, LC-16 roster, LC-17 materials, LC-23 load, LC-33 bloom |

---

## 5. What "on par" means: the exit bar per dimension

A dimension counts as on par when every line below is observed on the live CDN build. Proxies such as a passing selftest don't count.

| Dimension | Exit bar (all measurable) |
|---|---|
| Gunplay | **Recoil:** uncompensated AR burst climbs 3-4 deg in a learnable per-gun pattern; scripted pull-down lands at least 90% at 35 m. **Roster:** at least 9 guns including DMR, LMG and burst, each with its own TTK band. **Throwables:** frag plus smoke, with at least 1 bot throw per match. **Hits:** no body hit more than 0.06 m outside the silhouette; 0 splash damage through walls. |
| Movement & animation | **Strafing:** combat strafe skate at or under 1.25x forward. **Slide:** curve within the P2-A gate. **Clips:** jump/fall/land play; pistol crouch legs move more than 0.1 m. **Camera:** shoulder swap passes crosshair truth on both sides; at 1.5 m from a wall the body never covers the reticle. |
| Audio | **Listener:** front/back footstep pairs within 1.5 dB. **Gun reports:** tail at least 250 ms at 5 m; sniper at 450 m delayed at least 1.2 s. **Occlusion:** 4-8 dB. **Surfaces:** footstep census at least 90% correct. **Remote:** guest hears at least 80% of remote steps. **Mix:** teammate steps at least 6 dB under enemy steps. |
| Visuals | **AA:** on medium and high, stair-step pixels -50%. **Drop view:** luminance mean 0.45-0.55, p5 at or under 0.25 (per OD-2). **Facades:** contrast +30%. **Explosions:** visible at least 1.5 s with a 6 m or taller smoke column. **Foliage and water:** canopy motion at least 2% of pixels; no water seam grid. |
| UI / UX | **Ping:** world, compass, minimap and big map, guest within 500 ms. **Load:** cold click-to-control at or under 20 s; the bar never goes backwards. **Accessibility:** 3 colour-blind modes, HUD scale 130% inside anchors, invert-Y. **Fit:** menus and settings fit at 1280x720. **Correctness:** placement correct on quit; 0 false copy strings. |
| Loot | **Heals:** cancel with refund; the gun usable within 0.4 s of a switch. **Death piles:** one readable pile with all ammo. **Supply drops:** at least 3 per match, beacon until opened. **Tiers:** tiered POIs at least 1.5x rare share, plus a marked hot zone. **Throwables:** in the tables. |
| Bot AI & flow | **Reactions:** re-sight-to-shot median at or above tier reactionMs. **Cover:** ENGAGE in cover at least 15%. **Concealment:** a crouched player in a bush is unseen beyond about 12 m. **Hunting:** HUNT uses heard information only. **Shields:** calm shield neglect 10% or less. **New players:** AFK human median survival at least 150 s. **Pacing:** match length median 10-15 min. |
| Online / squads | **Lobby safety:** 0 phantom slots; forged messages are ignored. **Drop:** squad touchdowns within 100 m on at least 95% of seeds. **Squad flow:** DBNO plus revive; spectate a squadmate first; rematch keeps the room. **Netcode:** rejoin within 60 s; no backward pulls from out-of-order packets. **Modes:** Duos/Trios with bot teammates (per OD-4). |
| World | **Circles:** final-centre p50 at least 150 m from the map centre and 0 circles in water (per OD-1). **Cover:** 30% or fewer off-POI points more than 20 m from hard cover. **POI identity:** Container Yard has at least 30 containers. **Landmarks:** one map-scale landmark per map visible from the drop. |
| Performance | **UHD iGPU, default first run, quiet box:** ground raw p50 at or under 20 ms on all maps; drop p50 at or under 33 ms (after LC-88 and LC-89). **Drop CPU:** bots section 3 ms p95 or less. **Stability:** 0 shader compiles after the first drop frame; a 4-match soak shows no heap growth and 0 page errors. |
| Meta | **Modes:** Duos/Trios with bot teammates. **Content:** at least 20 unlocks and at least 6 emotes; weekly challenges. **Correctness:** W.stats fields increment; 0 impossible challenges; no "SEASON"/"ranked" copy without the feature behind it. |

---

## 6. Cut list (one line each)

- **First-person mode:** owner constraint (third person only).
- **Building or harvesting:** owner constraint.
- **Phone or touch changes:** owner constraint. Every P1-P4 change is gated to leave touch byte-identical.
- **Map picker:** owner constraint (random rotation).
- **Physics engine:** owner decision O1 (fix our own collision).
- **Sprint stamina:** the owner removed it on 2026-07-28.
- **Meshy models or re-rolls for new guns or characters:** they spend credits and break the owner rule. New art is CC0 or authored.
- **Primitive-composite gun models (the draft's "composed low-poly silhouettes"):** the owner's no-primitive-assets rule. CC0 models instead.
- **Vehicles (LC-94):** XL cost for little gain on a 1.6 km map. Recommendation no, owner decision OD-12.
- **Prone (LC-93):** L effort, no local Mixamo prone set, low value.
- **Voice or proximity chat (LC-86):** needs moderation and the iframe microphone permission; messaging-people gate.
- **Paid relay or TURN (LC-50):** spend; only through Telegram approval (OD-10).
- **Melee (LC-56) and per-shell shotgun reload (LC-57):** taste calls with low parity value (OD-6).
- **Crouch speed change (LC-62):** the owner already set 0.72 on 2026-07-28.
- **Slope speed (LC-66):** severity 1.
- **Bullet penetration (LC-92):** severity 1.
- **Ranked mode:** needs a player population that 4-human rooms can't supply.
- **Killcam or replay:** needs full state recording; XL for the browser build.
- **Removing per-hit damage spread:** owner direction 2026-09-15 (royale.js:762-765).
- **Output-pass contrast curve or LUT for LC-04 (the draft's P1-C item):** the look plan already rejected a global LUT, and the verifier showed grading alone can't reach the reference without muddiness.
- **Adding `bush` to `propColliderKinds`:** it changes walking and bullet collision and the baked collider table. A separate `concealAt` is used instead.
- **Storm timeline compression for late phases:** the selftest has a 780 s floor, plus owner D8. Match length tracks storm time, so compression defeats itself.
- **`antialias:true` renderer / MSAA composer target:** a wasted backbuffer (BUILD_ORDER item 69) and iGPU bandwidth.
- **Dynamic resolution below DPR 1.0:** the gain did not reproduce (Isla 22.2 ms at 1.0 vs 22.6 ms at 0.75).
- **Mid-match switch to the low tier:** it compiles new shader programs (a hitch).
- **Draft claims refuted by verification:**
  - LC-10 "backpedals moonwalk" (backpedal plays a reverse stride);
  - LC-17 "one struct material, no trim, no decals" (six texture kinds, trim and ground decals exist);
  - LC-04 "exposure 1.15 is the cause" (about 11% of the gap);
  - LC-07 "any big-map click closes it" (with the cursor locked the click passes to the game).
- **Flash and molotov throwables:** after frag and smoke prove out.

---

## 7. Verification ledger (what changed from the synthesis draft)

| Gap | Votes | Change folded into this plan |
|---|---|---|
| LC-01 | real, real | Effort L->S. Climb gate 3-4 deg (not >= 5) with cap and baseline clamp; automatics only; touch skipped. |
| LC-02 | real (2nd vote truncated) | 4.26 m horizontal / 4.65 m 3D, 21.8 dB front/back at 16 m. |
| LC-03 | real, real | AA files exist in games/ascendant (r172, MIT). Add after the output pass; low tier and touch unchanged. |
| LC-04 | real, partly | Moved from P1 to P2-C (maps.js). Exposure is about 11% of the gap; target mean 0.45-0.50, not the reference 0.32. Reverses the 07-20 look, so it is OD-2. |
| LC-05 | real, real | Cancel human-only (bots.js:513 vs :578). The weapons.js hook ships inert in P1. |
| LC-06 | real, real | DPR is already 1.0 on DPR-1 laptops: the ladder is bloom then DPR, floor 1.0, first-run auto-tier. The drop also needs LC-88 and LC-89. |
| LC-07 | real, real | Big-map click passes through when the cursor is locked. The input lives in hud.js, so ping stays in P1. |
| LC-10 | real, real | Narrowed to combat strafes; effort L->M; bake in P1, wire in P2. |
| LC-11 | (vote not received) | Phantom slot reproduced in the final pass on the live net.js. |
| LC-12 | real, real | No `bush` collider; `concealAt` instead; cover 2.6-3.4%; re-peek reset threshold 0.9 s. |
| LC-13 | real, partly | Placement half: area-uniform plus land check, needs a MAP_GEN_VERSION bump and harness callers. Late-phase half: no cheap fix. Max 119.7 m; phase 6 started in 9 of 27. OD-1 re-opens O4. |
| LC-14 | real, real | Effort XL->M for the frag. Built dark in P1, live in P2 once bots throw. Smoke in P3. |
| LC-15 | real, real | Two slices; the bit flag and revive message reuse the existing channels. |
| LC-16 | real, real | CC0 models only; extend all three positional weight lists; burst AR may reuse the AR model. |
| LC-17 | partly, real | Narrowed to roughness response, grain and wear; 0 extra draw calls for steps 1-3. |
| LC-18, LC-20 | (votes not received) | Measured from verifier artifacts in the final pass: squad drops 440-1019 m apart; 41.7-58% shield neglect. |
| All others | (votes not received) | Carried from the audit lanes, marked "not-voted" in gaps.json. Verify before staffing if any is contested. |

Out-of-scope findings named here, not fixed:
- `_harness/feelcheck.py:639` says a long burst leaves pitch "near the clamp". The live measurement contradicts it, so the comment is likely stale.
- The CDN serves every runtime JS with `Cache-Control: no-store` (perf notes). That is a worker setting outside this game folder; it costs warm loads 1.27 MB.
- The skin_level_N achievement descriptions say "and win a match", but the code fires on reaching the level (meta notes).
