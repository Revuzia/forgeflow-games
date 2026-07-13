# Last Circle — CHANGELOG

Source of truth for this game's history and design decisions.
Design research: `forgeflow-games/state/research_battle_royale.json` (Fortnite building/storm, Final Drop browser formula, PUBG ballistics/loot, Apex shields/feedback).

## 2026-07-12 — v4.9 real sky + proper freefall/canopy + click-to-play menu (?v=15, LIVE)

Owner round: "do the falling boneless, realsky and clouds and birds, run to
check mouse look, and fix the menu." All done, verified in live play (pump +
rAF-shim + canvas→JPEG upload pipeline), then deployed to the CDN (?v=15) and
re-verified on the live workers.dev URL.

- **REAL SKY (`maps.js`):** added a gradient sky dome (ShaderMaterial, horizon→
  zenith), 24 drifting cloud groups (soft radial-gradient billboard sprites,
  3–5 puffs each), and 3 looping bird flocks (V-silhouette sprites) — all
  map-agnostic off each map's `sky` colour. Verified from altitude: fluffy
  clouds + V-birds render against the dome (shots `skydive_gamecam`,
  `birds_close`). **Fog thinned** (isla_viva 0.0011→0.0006, ashgrid
  0.0013→0.0007, deepwood 0.0016→0.0009) so the ground no longer washes white
  when you look down while dropping — the dome now covers the far distance, the
  fog is just light atmospheric haze (storm keeps its own heavier weather).
- **PROPER FREEFALL + CANOPY (`pose.js`):** the skydive/hang arm+leg targets
  were single straight lines (no elbow/knee bend) → the "boneless spread-eagle"
  and "arms rammed straight up" the owner flagged. Rebuilt both with real joint
  articulation: skydive = box/arch (upper arms out at shoulder level, forearms
  bent ~90° so hands come up-and-forward; thighs splayed back, knees bent so the
  shins kick up) — verified live (bones: head down-forward, hips up, feet kicked
  up-and-back, hands forward-spread; shot `skydive_fixed`). Canopy hang = upper
  arms reach up-and-out to the risers, forearms angle back up to the toggles
  (bent elbows, not straight up), legs dangle with a slight knee bend — verified
  live under an open chute (shot `hang_frozen`). No Meshy regen — pure runtime
  pose layer.
- **MENU click-to-play (`hud.js`):** removed the separate "▶ DROP IN" button;
  each of the 3 glass mode cards (BATTLE ROYALE / QUICK MATCH / PRACTICE) is now
  the play button — one click launches that mode, with a ▶ chevron affordance
  and a "CHOOSE A MODE TO DEPLOY" hint. Already glassmorphic (backdrop-filter
  blur 18px, saturate 1.35, rounded, blue glow). Verified on the LIVE deploy:
  3 cards, each `onclick` launches, no DROP IN button, glass confirmed.
- **MOUSE-LOOK verified LIVE:** the existing model is correct — any mousedown
  requests pointer lock, then `mousemove`'s `movementX/Y` drive `input.yaw/pitch`
  (cursor-follow aim is the lock-denied fallback). Proven in a live match via
  the RMB-drag path (same yaw code): movementX=140 drove yaw 0.000→−0.246→−0.493,
  movementY drove pitch 0→0.106, and the camera world-dir rotated (−0.057,−0.998)
  → (0.418,−0.904). (Real pointer-lock *engagement* still needs a focused real
  browser — the headless preview tab is `hidden`.)
- Sim selftest 45/45. `HAND_AIM_ROT` gun calibration and the 5-skin roster
  (drifter cut) unchanged.
- **Test-harness note:** reviving a dead actor (`hp:0`) in the verify harness
  leaves `a.obj` detached from the scene (death path `victim.obj.parent.remove`,
  player.js:893) → the body renders nowhere. It is a *test artifact only*
  (normal freefall never kills you); re-add with `k.scene.add(a.obj)` to inspect.

## 2026-07-09 — v4.8 per-skin weapon calibration (level barrel on all 5)

wraith + juggernaut aimed ~35° high with the shared grip rotation (their
Meshy hand-bone rest differs). Auto-calibrated each rig LIVE (measure barrel
world dir → rotate to forward+level) and baked the five per-skin hand
rotations into `HAND_AIM_ROT`. Verified in live play: dot 1.0, muzzle level on
soldier/athlete/wraith/juggernaut/viper (montage in scratchpad).

**Verification-pipeline lesson (never crash the preview again):** driving the
game with a setTimeout pump + rAF shim (needed because the headless tab is
hidden) leaks a WebGL context on every `startMatch`; ~15 restarts wedged the
renderer. Rules: (1) RELOAD the page between skin tests, don't loop
`startMatch`; (2) `clearInterval(window.__pump)` + restore `requestAnimationFrame`
BEFORE any navigate, or CDP navigation hangs 300s on the still-busy page;
(3) cap matches per page load.

## 2026-07-09 — v4.7 HOTFIX: revert per-frame gun aim (it broke the cast)

The v4.6 "skin-independent per-frame barrel aim" was the cause of the viper
body contortion AND the "gun points backward" — verified in LIVE play (see
below). Removed it entirely; the weapon uses the static per-skin grip rotation
set at load. Measured all 5 fighters after the revert: barrel points FORWARD
on every skin (dot 0.97–0.99 soldier/athlete/viper; 0.80 wraith/juggernaut,
which additionally tilt up ~35° — leveling tracked separately). Viper runs
upright, no contortion.

**Verification method fixed for good:** the headless preview tab runs *hidden*,
so `requestAnimationFrame` never fires → the game loop stalls → earlier
"verified" claims were reading frozen state. Live play is now driven via a
setTimeout pump + rAF shim, and frames are captured by copying the WebGL canvas
to a JPEG POSTed to a tiny local upload server (scratchpad/upload_server.py)
and read back as an image. ALWAYS verify through that pipeline, never a static
eval, never a frozen frame.

## 2026-07-09 — v4.6 BLACK-SCREEN fix, upright run, skin-independent gun aim

Owner round 8 (screenshots): matches loaded pitch black, characters ran bent
over with the gun pointing the wrong way. All three root-caused + verified in
real gameplay renders (not just measurements — a lesson below).

- **BLACK MATCHES FIXED**: the concurrent v4.4 menu overhaul's
  `teardownMenuWorld` slammed `scene.background`/fog to dark navy 0x0a1622 at
  **10× fog density (0.012)** as a "placeholder for maps.js" — but teardown
  runs AFTER buildMap, so dense dark fog swallowed every match. Removed the
  override; the map owns the sky (each map's daytime `sky`/`fog` now shows).
- **UPRIGHT RUN**: player locomotion no longer uses the Meshy RunFast clip
  (leans ~30° forward — the "running bent over" the owner kept flagging). All
  ground movement plays the UPRIGHT walk clip, sped up by ground speed to a
  jog/sprint. Movement speed unchanged (9.6 m/s); only posture is upright.
- **SKIN-INDEPENDENT GUN AIM**: the Meshy rigs do NOT share a hand-bone
  orientation — soldier's points forward, **juggernaut's points straight
  DOWN** — so no single hand rotation can aim every gun forward (soldier was
  fine, juggernaut fired backward). The weapon holder is now re-oriented EVERY
  FRAME so the barrel (+Z) points along the actor's aim vector, compensated
  through the (fresh) hand-bone world quaternion. Verified in-render for
  soldier/juggernaut/viper — all point forward. (Lesson: a separate-eval
  measurement read a stale matrix mid-animation and looked broken; the actual
  per-frame render was correct — always confirm with a screenshot.)
- Tracers already shortened in v4.5 (len 4, life .22 — a dash); the long gold
  columns in-scene are LOOT BEAMS (chest markers), not tracers. The pistol/AR
  molded on the soldier's vest is baked into the Meshy model (one skinned
  mesh), not a code-added weapon.

## 2026-07-09 — v4.5 weapon GRIP anchoring, first-person scope, Scrap cut

Owner round 7 (screenshots): guns weren't held IN the hand, Scrap's arms/run
looked broken, you saw your own body when sniping, tracers too long, wanted
mouse-look. Diagnosed each in real gameplay this time (not isolated poses).

- **WEAPON GRIP ANCHORING** (the "hold it in the hand" fix): guns were
  normalized then CENTERED, so the fist held the barrel's midpoint and the
  weapon floated across the chest. Now a data-driven grip anchor (centroid of
  the bottom-third vertex cluster = the handle, à la the Claudecraft "grip y"
  metadata) is placed AT the hand; long guns nudge +Z so the stock clears the
  arm. Verified: pistol / AR / sniper all sit in the fist, barrel forward.
- **SCRAP (drifter) CUT**: measured every rig's idle torso lean — Scrap's
  Meshy rig shipped a **27° baked-in forward slouch** (all 5 others sit at
  1-5°), so his every clip hunched and his arms read broken. Unfixable without
  regen (which risked the same slouch on a "street raider"); owner cut him.
  Roster is now soldier / athlete / wraith / juggernaut / viper (5).
- **FIRST-PERSON SCOPE**: aiming a scoped weapon (sniper) drops to first-person
  at the eye and HIDES your own body, so it no longer blocks the shot (owner:
  "when sniping im in the way of the cursor and can see myself"). Non-scope ADS
  (AR etc.) pulls tight over the right shoulder so the body sits left of a
  clear reticle. Body re-shows the instant ADS releases.
- **MOUSE-LOOK PRIMARY**: any click now grabs pointer lock → moving the mouse
  looks around; RMB is ADS only (was: must hold RMB to drag-look). Cursor-
  follow aim stays as the lock-denied fallback.
- **SHORTER TRACERS** (len 9→4, life 0.4→0.22 — a punchy dash, not a beam) and
  **quieter gunshots** (gains −35%).
- NOTE: this rides on top of the concurrent v4.4 menu overhaul (another
  session) — committed together per owner direction.

## 2026-07-08 — v4.4 AAA menu / UI polish (live Three.js cinematic)

Owner: "I expected this UI to be significantly more polished, more 3js, highly
professional and AAA standard." The menu was CSS gradient + SVG islands with a
tiny character canvas — mid-tier indie, not Fortnite/Apex lobby energy.

- **LIVE 3D MENU BACKDROP** on the main kernel WebGL canvas: procedural tropical
  island (vertex-colored terrain), ocean, purple storm ring (brand), floating
  sky islands, atmospheric dust points, god-ray planes, golden-hour sky shader
  dome, optional real prop GLBs (palm/tree/rocks/pine). Cinematic orbit camera
  + elev bob runs every frame while `phase==="menu"` (`updateMenuWorld`).
- **GLASS UI OVER THE WORLD**: translucent panels with backdrop-blur so the 3D
  scene reads through; Orbitron/Rajdhani type; animated title reveal; mode
  cards with icon tiles + hot selection chrome; glowing DROP IN CTA; top
  season chrome bar. Character bay gets metallic stage floor, blue emissive
  ring, rim/kick lights, ACES tonemap on the preview renderer, corner
  brackets, pulse dots.
- **Loading / lobby / post-match** restyled to the same glass + display-type
  system; shimmer load bar; lobby slot highlight for self.
- Bloom enabled on the menu path for storm-ring glow. Teardown clears menu3d
  group + restores fog when match starts.

## 2026-07-08 — v4.3 FIST SURGERY + full animation-state pass (AAA sweep)

Owner round 6: "hands look mangled… why can't closed be a fist?" + "check ALL
models, ALL animations, ALL bones." The definitive hand finding: a close-up
contact sheet (all 12 hands rendered tile-by-tile) proved **every one of the
six models shipped with OPEN modeled hands** — the "fists" prompt never truly
worked, gloves just hid it at distance. Meshy rigs have NO finger bones and
the rigging API can't add them, so hands can only be closed in the MESH.

- **FIST SURGERY (`tools/curl_fists.mjs`)**: closes hands in the bind
  geometry — verts past the knuckle line get a progressive curl around the
  knuckle axis PLUS quadratic compaction into a fist-center ball, with
  sphere-blended normals (pure rotation looked like mangled hooked fingers —
  owner called it). Finger axis = principal axis of the hand vert cloud via
  covariance power iteration (forearm→hand direction fails on rigs with
  bent-back bind wrists — the athlete's palms-up shrug). Meshy IBMs carry
  non-rigid armature scales → NEVER trust bone matrices for positions; use
  vertex clouds. Backups: *.openhands.bak beside each GLB (gitignored).
  Verified per-hand on a 6-tile close-up sheet (render ALL tiles in ONE
  frame with preserveDrawingBuffer — the buffer wipes between browser frames).
- **JUMP + SWIM clips** (Basic_Jump 86 / Swim_Forward 569, all six rigs,
  ~25cr): airborne actors used to play IDLE (no clip matched "jump");
  swimming was run@0.6. Both verified live (SPACE → jump clip; river → real
  freestyle stroke).
- **AIM PITCH** (AAA upper-body layer): gunReady/reload target dirs tilt with
  the camera's vertical aim + Spine01/Spine02 bend — the gun visibly tracks
  where you aim up/down (verified at steep up-aim).
- **BACKPEDAL** plays the stride in REVERSE (negative setEffectiveTimeScale)
  when moving against facing in combat — no more moonwalking (verified
  ts=-1.31 under ADS+S).
- Meshy balance after: 989cr. gen-scripts live in session scratchpad; the
  temp dir gets purged by the OS — `meshy_lc5.py` silently became 0 BYTES and
  "ran" successfully (empty file exits 0). Check file sizes before batches.

## 2026-07-08 — v4.2 particles were NEVER rendering, emote locker, leg posing, storm feel

Owner round 5. The headline find: **no particle had ever rendered in a match**
— fx.js adds its InstancedMesh to the "fx" scene group once at page init, and
startMatch `g.clear()`s every group before the first match begins. Muzzle
flashes, tracers, impact bursts, explosions: all silently orphaned since the
groups-clear was introduced. That was the real "when shooting i dont see
bullets". Fixed with a self-healing re-adopt in fx.update.

- **TRACERS you can see**: bolts now FLY with the round instead of a static
  140ms muzzle blink; cosmetic speed cap 200 m/s (hitscan 999 m/s crosses the
  screen in one frame — the eye never sees it; the damage ray is already
  resolved). Thicker (0.15), brighter gold, 0.4s life, bigger 3-color muzzle
  flash. Bots' fire uses the same global event → incoming fire reads too.
- **EMOTE LOCKER**: the menu turntable now plays cheer (greeting) → dance
  loop per skin instead of Meshy's arms-out idle ("show his character off").
  Clip files load on demand into the preview mixer; raw-idle + relax layer
  stays as fallback while a skin is still baking.
- **LEG POSING** for skydive (arched back-spread) and canopy hang (legs
  together, slight knee bend) — pose.js now steers UpLeg/Leg/Foot chains too;
  clip legs read wrong mid-air (frozen run stride).
- **STORM FEEL** (owner: "shrinks too much too quickly" + "damage should
  increase the longer you're in it"): standard table rebuilt — 8 phases,
  ~13.5 min, gentler early cuts (~58-64% radius kept vs ~46%); per-actor
  RAMPING storm damage +50% per 6s soaked (cap 3×), decays when back inside
  — verified live: ticks 1,1,1,1,1,1.5×6,2. Final phase still dps 12
  (selftest pins it).
- **RELOAD SFX**: mechanical sequence timed to the weapon's reloadS — mag
  release click → mag drop → seat clunk → slide rack (was two beeps).

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
