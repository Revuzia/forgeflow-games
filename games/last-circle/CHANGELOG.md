# Last Circle — CHANGELOG

Source of truth for this game's history and design decisions.
Design research: `forgeflow-games/state/research_battle_royale.json` (Fortnite building/storm, Final Drop browser formula, PUBG ballistics/loot, Apex shields/feedback).

## 2026-07-08 — v4.1 runtime arm-pose layer, ramp render fix, per-weapon ADS

Owner round 4 with screenshots: the Meshy ARMED clips retarget broken on these
rigs (Alert folded both arms across the face — "broken bone animation"), menu
idle stood arms-out, the tower ramp rendered backwards ("im in the wall"), and
ADS needed per-weapon zoom. No model regeneration needed — the rigs are fine;
the ARMS are now owned by code.

- **ARM-POSE LAYER (`pose.js`)** — the Dungeon Forge relaxArms technique,
  generalized: every frame AFTER the mixer (kernel updates mixers before game
  updaters) each arm chain is slerped toward actor-local target directions.
  Modes: `relax` (menu/unarmed — arms hang naturally), `gunReady` (two-handed
  gun at chest — replaces ALL armed clips), `skydive` (arms swept back),
  `hang` (hands up on the risers — the canopy shot finally looks real),
  `reload` (muzzle dips, left hand works the receiver, driven by
  weapon.state==="reloading"). Clips own legs/torso; arms always read right on
  every rig. Armed clips (idlearmed/walkarmed/runarmed) NO LONGER LOAD; files
  stay on the CDN. POSES exported for live tuning. **Verify pose work
  UNPAUSED** — W.paused stops the layer but kernel mixers keep running, so
  paused screenshots show the raw clip drifting back (cost 20 min).
- **RAMP RENDER FIX**: addRamp's slab was inverted for dir 2/3 (visual rose
  −Z while the collider rose +Z — players walked "inside the wall" on the
  correct collider) and completely FLAT for dir 0/1 (rotateZ on the slab's
  long axis is a no-op). All four dirs now match supportAt exactly; dir 0/1
  collider footprints also had width/run swapped — fixed (highway ramp is now
  a real 26m run, not a 9m cliff).
- **PER-WEAPON ADS** (`adsFov` in sim): sniper 20 + scope overlay (verified
  via real RMB), AR 42, launcher 45, SMG 47, pistol 48, shotgun 49.
- Menu turntable applies `relax` — the locker pose looks natural, not the
  Meshy library arms-out idle.

## 2026-07-08 — v4.0 fist cast, armed locomotion, portals, cursor-aim, skin locker

Owner playtest round 3 ("characters hold hands out / run odd / don't hold
weapons, shots don't go where the mouse points, no weapon cursors, chests on
roofs unreachable, falling off islands is death — need portals, menu needs
polish"). All fixes verified live with real key/mouse events + screenshots.

- **SIX-FIGHTER FIST CAST**: full regenerated Meshy roster — soldier (SGT.
  BRICK) / athlete (DASH) / drifter (SCRAP, regenerated once: first roll came
  out open-palmed) / wraith (NIGHTFALL, the all-black-with-helmet one) /
  juggernaut (BULWARK) / viper (STINGER) — all prompted "hands clenched into
  tight fists" (Meshy rigs have NO finger bones; open hands can only be fixed
  at generation). Meshy also hallucinated base pedestals under some models
  (athlete stood on a red disc everywhere) — stripped by connected-component
  analysis + a radius/up-normal triangle cut in the GLB optimizer.
- **ARMED LOCOMOTION** (the "hands out / odd run" fix): 18 new Meshy library
  clips — idlearmed=Alert(2), walkarmed=Walk_Forward_While_Shooting(234),
  runarmed=Run_and_Shoot(98) — for all six rigs; armed actors now hold the
  gun up in idle, walk, and run. Anim pace now TRACKS ground speed
  (setEffectiveTimeScale retune, never restart — restart-per-frame stutters).
- **CURSOR AIM**: without pointer lock the shot ray now goes through the OS
  cursor (unproject → capsule/terrain march), the per-weapon reticle RIDES the
  cursor, and the OS arrow is hidden over the canvas during play. Verified:
  bot at NDC(-0.31,0.05), one click, exactly one pistol hit.
- **LAUNCH PORTALS + CHUTE REDEPLOY**: every sky island carries a glowing
  ring portal (+ up to 4 ground portals at POIs) — walk in → ballistic boost
  (~80m, half-gravity) → skydive handover → canopy failsafe at 60m. SPACE in
  any mid-air fall ≥12m AGL re-opens the parachute, so stepping off an island
  is an escape, not a death. Portal whoosh in audio.js.
- **ROOF ACCESS**: every tower() gets an exterior ramp along the +X wall
  (ends short of the parapet; step sideways onto the slab — verified climb to
  y=12.9 on ashgrid), shipwreck gets a boarding plank, deepwood barn a hay
  ramp. Rooftop chests are all reachable on foot now.
- **MENU 2.0**: layered animated backdrop (bobbing sky-island SVGs, drifting
  clouds, rotating storm ring, vignette), gradient title, stacked mode cards,
  and a SKIN LOCKER — live 3D turntable preview (extra WebGLRenderer, real
  meters so no Box3 scaling), ‹/› + dots, choice persists in localStorage
  `lc_skin` and the player spawns as it (bots keep rotating the cast).
- **SPEED AUDIT**: walk 6.0 / sprint 9.6 m/s already exceeds Fortnite
  (~5.7/6.5-7), Apex (~7.4), Warzone (~6.7) — the "feels slow" was fixed-rate
  anims + narrow FOV, not m/s. Base FOV 53→57, sprint 64→70.
- **WEAPON MOUNT AUTO-ALIGN**: Meshy renders some "side view" props at a 3/4
  angle (sniper sat diagonal in its bbox and looked like a scrunched blob in
  hand). The mount now searches yaw for minimum cross-width and flips 180° by
  vertex-density (muzzle end is thin, stock end dense).
- **HARDENING**: brains[] now clears between matches (stale brains from the
  previous match kept thinking into detached actors forever); the human input
  struct is rebuilt every frame from live key/button state (a phantom
  input episode drained the whole pistol reserve mid-test — mx/mz/fire/ads
  can no longer stick); emotes holster the gun (hidden during dance/cheer,
  restored after).
- Meshy spend this round: drifter regen + 18 armed clips ≈ 300cr (2286 start
  → 1079 after). Raw GLBs re-downloadable by task id (state/meshy_raw got
  wiped mid-session by an outside process — task ids in scratchpad state
  JSONs saved the day; download URLs live ~3 days).

## 2026-07-07 — v3.0 Meshy cast + the "did you actually play it" patch

Owner playtest feedback round 2 + new requirement: original AI-generated
characters. Everything below verified live via real MouseEvents/KeyboardEvents
+ screenshots (not just sim runs).

- **MESHY AI CHARACTER CAST** (owner requirement: no reused fantasy rigs):
  4 original battle-royale characters generated on the owner's Meshy account —
  commando / runner / raider / specter — text-to-3d→refine(PBR)→rig(1.8m)→
  animate (idle 0 / walk 30 / run 16 / death 8). 188 credits total (2286→2098).
  Optimized 8MB→~0.7MB base + 25-68KB clip-only GLBs (gltf-transform+sharp,
  512px webp). Clips merged into the cached gltf at load (renamed idle/walk/
  run/death); per-actor hue tints for 50 distinct looks. Old Quaternius chars
  DELETED. **Gotchas:** do NOT bbox-normalize Meshy rigs (bind-pose bbox reads
  ~0.1m from tiny armature scales → 26m giants; rigs are authored at real
  meters). Hand bone = `RightHand`, world scale ~0.065 → scale-compensate the
  weapon holder; grip tuned live to (0, -90°, +90°). Raw GLBs in
  state/meshy_raw (not repo); pipeline scripts in session scratchpad.
- **AIM FIXED — the real bugs found by tracing actual projectiles:**
  (1) fixed-120m camera-convergence missed uphill targets → replaced with a
  true CROSSHAIR RAYCAST (camera ray vs actor capsules + terrain + colliders;
  projectile flies muzzle→that point). (2) **recoil never recovered** — every
  shot permanently kicked pitch up; after a few clicks the reticle sat ~2m
  above the target ("my pistol doesn't work"). Recoil now tracks in
  accumulators and re-centers over ~0.3s. (3) FIRST-SHOT ACCURACY: deliberate
  standing shots get 0.15× spread. Verified: crosshair-on-chest real clicks
  land (4/6 even 0.5m off-center), damage events fire.
- **Drop v2**: SPACE now TOGGLES the parachute open/cut/open repeatedly
  (verified open→cut→open); failsafe auto-deploy 60m first-time / 22m hard
  floor after manual toggles. Freefall pose fixed — belly-DOWN (sign flip;
  was falling face-up "on my back") and near-frozen mid-stride limbs
  (timeScale 0.05; 0.35 looked like jogging in the sky). No forced forward
  drift (AFK players used to slide ~100m into the ocean).
- **Body facing**: characters now turn toward their RUN direction outside
  combat (pure camera-facing read as "running sideways"); they square up to
  the camera while aiming/shooting (1.5s combat window).
- **Movement**: walk 6.0 / sprint 9.6 (9.2 effective, verified via real
  keys), ads 3.8, accel 0.13, sprint FOV 64. Stuck-ADS clears on blur.
- **Combat feedback**: per-PROJECTILE tracers (every weapon, every shotgun
  pellet — bright 22-34m streaks, colored for sniper/GL); damage numbers
  26px w/ stroke; PER-WEAPON CROSSHAIRS (pistol/smg tight cross · AR wide
  cross · shotgun spread ring · sniper fine dot + scope on ADS · GL arc
  chevron) with movement bloom.
- **Audio coverage**: footsteps (stride-distance emitter, self quiet/enemies
  loud), weapon-switch click, parachute deploy whoosh + cut, kill-confirm
  two-tone; chest open/pickup/reload/shield-break already covered. Chests
  verified opening (hold-E 2s channel).
- **NPC battle model** (owner: "run from storms but FIGHT once safe"):
  rotation urgency = meters-past-safety vs time-left (95 only when genuinely
  pressed, 40 when there's time); live enemy ≤40m scores 88+ and dominates.
  Soak: 8/9 living bots in ENGAGE mid-game, 43 gun kills vs 6 storm.
- Shield potions verified end-to-end (pickup room preserved by the ≤3-gun
  auto-pickup cap; slot-select + click → bar rises 0→25).

## 2026-07-05 — v2.1 drop/feel/AI polish (owner screenshot feedback)

- **Skydive + parachute drop** (was: rigid straight-down fall): freefall is
  belly-down (~70° tilt, banks into turns, run-clip limbs read as spread),
  fast fall −20 (dive −34 on SHIFT) with forward air inertia; a composed
  parachute (gored dome + suspension lines, per-actor color) auto-deploys at
  60 m AGL → upright pendulum sway, −5.5 fall; camera tracks the dive
  (pitch bias −0.62 freefall / −0.18 canopy, dist 9-10). Chute removed on
  landing. Bots get the identical sequence.
- **Gun actually in hand**: weapon holder is now parented to the rigs'
  `FistR` bone (scale-compensated) instead of a fixed chest offset that
  floated at head height — guns ride the skeleton through every animation.
  Armed actors use the rigs' `Idle_Weapon`/`Run_Holding` holding poses.
- **Character variety**: 5th rig (wizard) + per-actor procedural hue/light
  shifts on cloned materials — 50 visually distinct opponents (verified:
  red vs blue wizards etc. in a lineup shot).
- **Input fixed for lock-less contexts**: LMB ALWAYS fires (previously the
  first click was swallowed requesting pointer lock — if lock was denied the
  game was unplayable); unlocked = hold-RMB-drag rotates the camera (and
  ADSes); locked = mouse-look + RMB ADS.
- **Storm slowed to real BR pacing**: standard ~10.75 min of storm
  (12-13 min matches), quick ~4 min. Selftest asserts the envelope.
- **Bots fight like players now** (the "ran right past me" fix):
  engage-on-sight outranks everything when the target is LIVE and close;
  ~160° vision cone + unconditional awareness within 15 m; reload = sprint
  for lateral cover; FLEE blends escape vectors toward the circle (never
  flees INTO storm); phase≥4 rotates early; wider skill spread (tier1 7.5°
  err/700 ms → tier5 0.9°/210 ms). Balance loop discovered in soak tests:
  pure aggression gridlocked the lobby into eternal starter-pistol duels
  (0% looting) — fixed with FIGHT FATIGUE (14 s stalemate → break off,
  6 s re-target cooldown) and "distant enemies don't stop an un-geared bot
  from looting" (>35 m). Result: 46/49 gun kills, 3 storm deaths, 75%
  upgraded by late-game, winner with kills.
- Playtested via screenshots: freefall pose, canopy descent (player + bot
  chutes), armed lineup (variety + guns in hands), swimming (player + bot),
  chest beam visible at range; live-fire input verified with real
  MouseEvents (fire w/o pointer lock, RMB-drag rotate 0.53 rad).

## 2026-07-05 — v2.0 pure BR shooter rework (owner direction)

Owner feedback: drop the Fortnite building identity entirely; make it a clean
battle-royale SHOOTER. Full rework in one session:

- **Building/harvesting/materials REMOVED everywhere** — sim (BuildGrid,
  BUILD, MATERIALS gone; selftest now asserts their absence), building.js
  deleted, all build keys/UI/HUD mats, bot wall-up/box/ramp-push behaviors,
  net build mirroring. Map structures remain as static cover.
- **Arsenal = 6 guns**: pistol / SMG / AR / shotgun / sniper / **grenade
  launcher** (new: arcing fused shells, bounce, burst on body hit; replaces
  rocket launcher). Pickaxe melee + hand grenades removed. **Everyone spawns
  with a common pistol** (16 mag + 36 light) — verified all 6 weapons score
  kills in soak tests; storm kills fell from ~30% to 8% of eliminations on
  standard (fights actually resolve).
- **Swimming**: deep water = real swim (surface buoyancy + bob, swim/sprint-swim
  speeds, no shooting while swimming, SPACE = stroke hop, splash FX/audio).
  Replaces the old push-back-to-shore hack.
- **Controls simplified** to WASD / SPACE / SHIFT / LMB / RMB(ADS) / R / E
  (+ 1-5/scroll slots, M map, ESC). Crouch, quick-heal (T), and every build
  key removed; settings keybind list trimmed to match. Scroll now cycles
  weapon slots.
- **Loot rework**: chests are UNMISSABLE (large chest model + gold rarity
  ring + pulsing glow sprite + vertical light beam, all removed on open) and
  take a **2-second HOLD-E channel** (progress ring on the HUD crosshair;
  bots obey the same 2s rule). Items: walk-over auto-pickup whenever there's
  room; **tap E swaps the ground item with your active slot** when full.
  Death drops now include the EQUIPPED weapon (all slots + ammo).
- **Directional indicators** (industry standard): white footstep icons on the
  screen-edge ring for moving players within 30 m (1.4 s per-actor throttle),
  gunfire chevrons for shots 12-250 m away, red arcs toward whoever damaged
  you. All fade ~1 s, positioned by world bearing relative to camera yaw.
- **Neutral characters**: the Quaternius rigs' baked weapon meshes
  (Ranger_Bow / Rogue_Dagger / Warrior_Sword / Cleric_Staff) are stripped at
  load — nobody holds anything except their actual gun (starting pistol is
  now visible in hand from spawn via equip-on-load).
- Bots: FARM state + build behaviors removed; new **flanker** personality
  (arcing strafe pushes) replaces "builder"; suppression reflex = sprint to
  lateral cover when shot by an unseen attacker; chest opens channel 2 s;
  loot brain rewritten around "upgrade off the starter pistol" (14/26 alive
  bots upgraded by t=150 in soak).
- Verified in preview: full matches on isla standard (t≈7:40, 45/49 gun
  kills, winner 6 kills) + deepwood quick; swim/hold-E/indicators/walkover
  all exercised through the real input paths; sim selftest 44/44; zero
  console errors.

## 2026-07-03 — v1.0 initial build (full game, one session)

**What it is:** 50-player third-person battle royale with Fortnite-style building.
1 human + 49 AI opponents (friends can join online and replace bots). Three maps,
three modes, full loot/storm/build/combat loop, win/lose/stats screens.

### Architecture
- FFG 3D kernel (`ffg_kernel_3d.js`, shared with Pirate's Cove/Tide Breakers) + new genre `royale`.
- **Rules core** `runtime/sim/royale.js` — pure, deterministic, node-tested
  (`royale.selftest.cjs`, 47 asserts): weapons/damage/falloff, storm phase math
  (nested seeded circles), BuildGrid (slots, HP ramp, support graph, cascade
  destroy), loot tables, match bookkeeping.
- **Genre modules** `runtime/3d/royale/*`: maps, player, weapons, building,
  loot, storm, bots, hud, audio, fx, net. Orchestrated by `ffg_royale3d.js`
  (shared world object `W`, fixed frame pipeline, `window.__LC__` debug hook
  with synchronous `fastForward` for deterministic testing).
- **Bots are players structurally**: brains write the same input struct the
  keyboard does; movement/weapons/building are one code path.
- **Multiplayer**: Supabase Realtime (NetPlay). World is deterministic from the
  shared seed; only live state relays. Host simulates bots (10Hz snapshots);
  each human simulates themselves (12Hz); hits on remote actors route to their
  owning client. Guests take over bot slots; disconnect → bot brain re-attaches
  (explicit `bye` + 12s host watchdog). Loot item ids are derived from source
  (`f:`/`cb:`/`dd:`/`sd:`/`sw:` prefixes) so pickup mirroring never desyncs.
  VERIFIED live with 2 clients (host tab + same-origin iframe): identical seeds,
  slot takeover, bot snapshots flowing, 0m relay error on player state.

### Maps (seeded procedural, 1600m)
- **Isla Viva** — tropical: radial island, volcano+crater, beaches, 8 POIs
  (Palm Bay, Coco Village, Volcano Rim, Shipwreck Cove, Cliff Temples, Lagoon
  Docks, Jungle Market, Banana Farm), palms/trees instanced + harvestable.
- **Ashgrid** — urban: bowl downtown with multi-floor enterable towers (interior
  ramps, roof chests), overpass, container yard + motor pool (metal), crane
  high-point, rubble cover field.
- **Deepwood** — forest: rolling hills, river+lake carve, ranger towers,
  logging camp, quarry (brick), cabins, fire watch.
- **Proving Grounds** — practice-only: range with distance markers, build lot,
  movement course.
- Batched box-geometry structures (one mesh per color) + InstancedMesh props;
  static collider spatial hash; analytic heightAt shared with minimap render.

### Systems
- Weapons: pickaxe/pistol/SMG/AR/shotgun/sniper/rocket/grenade; rarity tiers
  (+8% dmg, −10% spread per tier); real projectiles with travel + drop
  (sniper/rocket), pellets, splash+knockback, recoil, reload, falloff to 40%.
- Building: wall/floor/ramp/stair; 10 mats; wood/brick/metal HP ramp
  (90→150 / 100→300 / 110→500); door edits; support-graph cascade destroy;
  ghost preview + turbo-build for the human; bots build via the same tryBuild.
- Loot: seeded floor spawns + chests (golden ring, burst on open), supply drops
  (2/match, drift down into next circle), death drops (deterministic, seeded by
  victim id), 5-slot inventory, ammo/mats auto-pickup.
- Storm: 7 phases standard (~8.5 min storm → 10-13 min match), 5 quick (~3.5 min);
  final circle HOLDS at ~10 m (r=0 storm-killed every survivor simultaneously —
  someone must WIN the fight); violet additive wall (hidden pre-shrink +
  practice); minimap current+next rings + outside-veil; warnings + sirens.
- Bots (49): utility state machine (DROP/LOOT/FARM/ROTATE/ENGAGE/FLEE/HEAL/
  CAMP/PUSH/WANDER) over per-bot blackboard; 5 skill tiers (reaction 600→220 ms,
  aim error 6°→1°, build ability none→edit-plays) × 6 personalities (rusher,
  builder, camper, loot_goblin, rotator, sniper); staggered thinking (150/400 ms
  near/far); vision cone + LOS + hearing (shots 250 m); aim model with acquire
  overshoot, tracking warm-up, motion penalty, smooth error wobble; burst fire
  discipline; wall-up reflex on damage; box-up heal; ramp pushes; third-party
  drift; endgame aggression (camp off, +engage, duel aim 0.55×).
- HUD/UI: menu (mode+map cards), lobby fill (50 named slots + countdown), HUD
  (bars, slots w/ rarity, mats, ammo, minimap, kill feed, storm timer, alive,
  interact hints, hitmarkers, damage numbers, storm/hurt tints, sniper scope),
  big map (M), pause, settings (volumes, sensitivity, graphics presets,
  click-to-rebind keymap via canonical-code remap), death→spectate (killer
  hand-off), post-match stats, victory + confetti.
- Audio: procedural Web Audio SFX (per-class gunshots w/ distance+pan to 260 m,
  builds, impacts, shield break, chests, heals, storm sirens, UI); music =
  3 unique Laser Sequence tracks (menu/match/endgame) per no-duplicate rule.
- FX: single 1024-cube InstancedMesh particle pool (muzzle, tracers, impacts,
  explosions, debris, chest bursts) + DOM damage numbers + camera shake.
- Perf: 51 fps / 25 draw calls / ~500 k tris with 50 actors in preview (DPR 1.5,
  shadows 1024); far-bot LOD (cheap physics + frozen mixers >250 m), staggered
  AI, spatial hashes, particle/projectile pooling.

### Bugs found & fixed during preview verification
- **Versioned-import dual-instance**: `import "./x.js"` (bare) alongside
  `import("./x.js?v=")` = TWO module instances (empty genre registry / null K).
  All intra-runtime imports must propagate `?v=`.
- Emitter dropped 4th event arg (tracer dir undefined).
- Build cell `Math.round` → walls a cell above the builder (never grounded).
- Bot plan-stall: state unchanged → onEnter never re-ran → idle forever.
- **Sticky-crouch**: glide-dive set input.crouch, nothing cleared it → every bot
  crawled at 2.2 m/s all match.
- **Mats starvation loop**: nobody could afford a first wall → kills dropped no
  mats → no one EVER built. Fix: 50 starting wood (humans too), Fortnite-scale
  harvest (14+8/swing), 50-count mats pickups. 61-103 builds/match after.
- **r=0 final circle** crowned a corpse (winner at −11 HP); holds at ~10 m now.
- Stale MATCH OVER overlay leaked into the next match (layer cleanup).
- Rock cluster normalized by height → house-sized blob (compact props normalize
  by max dimension).
- Spectated actor's nametag filled the screen (focus tag hidden; tags culled).
- Preview gotchas confirmed: plain `http.server` serves stale ESM (use
  serve_nocache.py); `window.open` blocked (2nd client = same-origin iframe).

### Match-quality numbers (fastForward soak tests)
- Standard/Isla: hot-drop fights from t≈60 s, 40%→88% armed (t=100→300),
  61 builds, winner 1-13 kills, full match 9-11 min, storm kills ≈15/49.
- Quick/Ashgrid: complete in ~6.5 min, 103 builds.
- Deepwood: verified spawn/fights/POIs; player got shotgunned by a bot (good).

### Known limitations (v1)
- Mid-match join syncs t/builds/loot but not in-flight projectiles.
- Bot pathing is steering-based (no navmesh); rare storm stragglers die dumb
  (tier-appropriate, honestly).
- Stairs render stepped but share ramp collision; roof piece not implemented.
- No swimming — deep water pushes back to shore (Fortnite-pre-swim rule).
