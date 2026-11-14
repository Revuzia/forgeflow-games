# Pirate's Cove — Build Log & Architecture

> **What this is.** *Pirate's Cove* is a REAL-TIME 3D open-ocean pirate sandbox in the ForgeFlow Games
> arcade. You sail a ship live (throttle + rudder, chase cam) across a big ocean; NPC ships patrol and
> wander; hostile pirates/marauders fight you in LIVE combat on the Tide Breakers D&D dice; islands are
> dockable for treasure, ashore away-team fights, and crew rescue. **Not turn-based.**
>
> This CHANGELOG is the source of truth for Pirate's Cove's feature history (version-controlled with the
> code); auto-memory keeps only a short pointer.

## Architecture — reuses the Tide Breakers substrate
- Built as a NEW kernel genre **`openseas`** (`runtime/3d/ffg_openseas3d.js`), registered into the same
  genre-agnostic three.js kernel (`ffg_kernel_3d.js`) as Tide Breakers' turn-based `navalfree`.
- **Reused verbatim**: the reflective `Water`, dusk `Sky`/sun/IBL, the ship GLBs (`assets/ship-*.glb`,
  pirate hulls), creature GLBs, and — for combat later — the D&D dice in `runtime/sim/navalfree.js`
  (d20 to-hit, damage bands, crits). The game dir was copied from `tide-breakers/` then re-skinned.
- Boot: `ffg_boot3d.js` imports the kernel + `ffg_openseas3d.js` (no turn-based shell yet), fetches
  `content.json` (`genre: "openseas"`, `setup: {sea, npc, islands, seed}`), and boots sailing directly.
- **Debug hook** `window.__PC__`: state(), npcState(), press(k,v), teleport(x,z), topDown()/chase().
- Cache-bust: bump the `?v=` in index.html on every redeploy (propagates to all runtime imports).
- Deploy (arcade, when ready): `deploy_game.py --game-dir <abs> --slug pirates-cove` (NO --force; incremental).

## Naming history
Working names iterated with the owner: **Corsair's Reach → Marauder's Sea → Pirate's Cove** (final).
Renaming = move the dir + update slug/title/HUD/debug-hook/launch.json. The dir can be "Device or resource
busy" right after a preview server ran on it — kill the port-8144 python http.server first, then Move-Item.

## Feature history

### 2026-07-07 (52) — Full sword swing + QUICK-tap vs HOLD-to-CHARGE attack with a WebGL charge FX (combat batch 2, part B)
- **Full swing (owner: "doesn't FULLY swing"):** the 1.53s slash was cut off at ~1/3 because `heroSlash` set `hero.animT=0.5` and
  line 913 snaps the hero back to idle when animT hits 0. Now the swing (and the flintlock draw) play THROUGH — sped up via
  `play({timeScale})` so a full slash lands in ~0.8s. No animation regen needed.
- **Quick-tap vs hold-to-charge (owner):** LEFT-press ashore starts CHARGING; a quick tap (<0.2s) = the normal fast strike; HOLD
  builds a charge and RELEASE unleashes a **charged attack** — for the cutlass a heavier, WIDER sweep that hits **every** foe in a
  broad cone for up to ~2.6× damage; for the flintlock a boosted shot. Verified: quick = 1 foe/21 dmg · full charge = 3 foes/~60
  each. Charge amount widens the arc + extends reach + scales damage. (SPACE stays a quick attack; drag-to-aim while charging is fine.)
- **Charge-up WebGL FX:** a glowing additive **orb** on the sword hand that grows + shifts **cyan→gold** as it fills (pulses at max),
  plus a spinning ground **ring**; release fires an expanding gold **shockwave** ring + flash. Cleared on release / leaving the isle.
  **Adversarial review caught + fixed two edge cases:** the orb froze visible behind the pause menu if you paused mid-charge (updateChargeFx
  is gated on `!paused`) — `openPause` now cancels the charge; and a lost pointerup (alt-tab/blur/pointercancel) left the charge stuck —
  now cancelled on `blur`/`pointercancel`. Verified: pause → charging:false/orb hidden · blur → charging:false.
- **Grip — best-effort (owner-chosen):** the Meshy rig has **no finger bones** so the hand mesh is permanently OPEN — no animation
  can curl it into a fist, so a true clenched grip is impossible without regenerating the character MODEL. Owner chose best-effort:
  both weapon grips (`WPN_*`/`FL_*`) were pulled back so the hilt sits at the **palm base** (not pushed past the fingers "in front")
  with a small into-palm nudge, and the cutlass shrunk 1.0→0.95. Reads as held-at-the-ready; a true fist grip is a future model regen.

### 2026-07-07 (51) — Ship RAMMING + TAB enemy lock + whole-HP + title-ram fix (combat batch 2, part A)
- **Ship ramming (owner-confirmed):** `stepCollisions()` — hulls that touch damage BOTH ships, shove apart (SOLID, no pass-through),
  and a forward ram **bounces you back** (speed→-5) so you must reverse to peel off. Damage scales with the HULL upgrade (you deal
  more + take less) AND with the enemy's **level** — higher-level ships have tougher hulls + ram harder (they carry upgrades).
  Verified: hull0 even 24/24 · hull2 you take 12/deal 53 · a lvl-6 ship takes 14 & deals 40 vs a lvl-1's 21/27 · NPC↔NPC works.
- **Adversarial review caught a real bug:** `stepCollisions` ran during the **title/attract screen** too, so drifting NPCs could ram
  the frozen player and drain (even sink) HP behind the overlay, carrying into the game. Fixed with a `!gameStarted` guard
  (mirrors `stepPlayer`'s frozen guard). Verified: pre-Set-Sail rams now deal 0.
- **TAB target-lock (on foot):** TAB cycles the nearest→next island enemies (red ring); SPACE attacks the LOCKED foe (LEFT-CLICK
  still free-aims at the cursor); the lock drops when the foe dies or you leave. Verified cycling 32→45→91u + SPACE-fires-at-lock.
- **Whole-number HP:** all HP *numbers* (ship info card, HUD hero/ship, shop repair) now `Math.round()`; ram damage is rounded too.
- Debug hooks: `stepColl`, `ramSet`, `foeLock`, `tabFoe`. Controls panel + gained a TAB and MOUSE-WHEEL row.
- STILL PENDING (batch 2 part B): weapon hilt properly IN the open Meshy hand (needs a weapon-holding idle regen), and the full
  swing + quick-tap/hold-to-charge attack with charge FX.

### 2026-07-07 (50) — Captain combat polish batch 1/2: weapon grips + zoom + enemies fight back
Owner combat feedback (batch 1 of 2). Done here: (1) **Cutlass held in the HAND, not the wrist, + smaller** — the Meshy
`RightHand` bone origin sits at the wrist, so the hilt was floating there; now the grip is pushed along the hand's +Y (finger
direction, probed live) INTO the palm and `WPN_SIZE` 1.4→1.0. (2) **Flintlock smaller + grip in the palm** (`FL_SIZE` 1.05→0.72,
same +Y palm offset) so it's not oversized. (3) **Mouse-WHEEL zoom** — a `_camZoom` multiplier (0.5–2.4) on the chase distance,
applied to both the sail and ashore cameras. (4) **Enemies fight back — no more free kills:** foot foes only woke inside
`FOE_AGGRO` range, so you could shoot pirates from afar with zero danger; new `alertFoes()` makes any foe the hero (or crew) hits
— even a missed shot aimed at it — **instantly engage and charge**, and alerts its mates within 55u so a shot rouses the group.
Still to come (batch 2): full sword swing, quick-tap vs hold-to-charge attack with charge FX, TAB to cycle island enemies, and
ship-ram collision damage (upgrade-scaled).

### 2026-07-07 (49) — FIX (owner): ships were not click-targetable — `selectAt` called a method that never existed
Owner: *"I cannot target enemy ships — nothing is targetable with left mouse click."* `selectAt()` called `kernel.pickAt(...)`, but
the kernel's raycast method is named `raycast()` — so **every ship click threw `TypeError: kernel.pickAt is not a function`** and
silently failed. It went unnoticed until entry 47 because left-click *also* fired the broadside (the click still "did something");
once left-click became select-only, the broken call was the sole action → clicks did nothing. Fixed to `kernel.raycast()` and
filtered to on-screen ships. Verified: a real left-click on a ship now selects it (ring snaps to the hull), then SPACE fires at it.

### 2026-07-07 (48) — REAL pirate cast: Meshy-generated CAPTAIN + 3 CREW (rigged + animated) replace the reused fantasy characters
Owner: *"instead of the same archer/mage we reuse in other games, generate NEW crewmate models on Meshy that match the theme —
they must all have bones and proper animations."* Mages/rangers don't belong in a pirate game, so the whole away-party cast is
now **AI-generated pirates**, each a rigged, animated character built through Meshy's API.
- **The cast:** ① **Pirate Captain** (hero — replaces the reused Ranger): tricorn + red plume, gold-trimmed navy coat, holds the
  cutlass/flintlock. ② hired **crew** — a **Gunner** (red bandana, striped shirt, bandolier — replaces the out-of-place Wizard
  *mage*), a **Swashbuckler** (feathered hat, sash, gloves) and a **Bosun** (bald brute, big beard, leather harness). The 3 crew
  models **rotate per hire** for variety.
- **Full Meshy pipeline (scripted, resumable — `scratchpad/meshy_gen.py`):** text-to-3D (a-pose) → refine (PBR) → **auto-rig**
  (24-bone humanoid skeleton) → **per-clip animations** from Meshy's library (Idle / Confident-or-Casual Walk / RunFast /
  Right-Hand Sword-Slash / Cowboy Quick-Draw for the gunner's shot / Dead). The captain's idle was redone as a **Combat_Stance**
  (steady weapon hold) and given a Quick-Draw **ranged** clip for the flintlock. ~559 Meshy credits total.
- **Optimised 47 MB → ~1 MB per character** (`optimize_char.mjs`, gltf-transform + sharp): one small BASE glb (mesh + skeleton +
  idle, 512² webp texture) + tiny **clip-only** glbs (mesh/skin stripped, ~25–110 KB each). All 4 characters = **4 MB** total.
- **Engine integration:** `loadMeshyChar()` appends each clip-only glb's animation into the base gltf so the existing
  `makeCharacterRole` mixer drives them like the multi-clip Quaternius files; clip-name picking now matches BOTH Quaternius and the
  Meshy `Armature|Name|baselayer` names. The weapon attach finds the Meshy **`RightHand`** bone (vs Quaternius `FistR`) and
  **normalises the weapon size/offset by the hand bone's world scale** (Meshy ~0.065 vs Quaternius ~5.5 — otherwise the cutlass
  shrank to a speck). Cutlass + flintlock grips **re-solved** for the RightHand frame (blade up-forward / barrel level-forward,
  score 0.999). Meshy glbs are cache-busted with the module `?v=`.
- Verified in-game (zero console errors): captain animates + holds both weapons; all 3 crew spawn as 24-bone rigged pirates and
  play their clips. Assets under `assets/props/meshy/`.

### 2026-07-06 (47) — FIX floating rocks (for real) + click-to-select ship targeting (SPACE fires only at your target)
Owner: *"rocks are floating in the air… place each properly. SPACE should only fire if I CLICK a ship to select it; left-click should
select, not attack; no selection → not attackable (else SPACE sprays every ship)."*
- **Floating rocks — root cause found (and it was my own entry-43 bug):** `rocks.glb` sits **off its own origin**, so entry-43's
  "slope tilt" (`p.rotation.x/z`) rotated the pivot about a point far from the rock and **flung it through a huge arc** — lowest
  vertices ended up **100–220u in the sky** (amplified by the ~4.7× height-scale). My entry-43 "0 floating" check was bogus: it
  measured `pivot.position.y` (fine) instead of the actual **mesh vertices** (flung). Fix: (1) `makeProp(key, targetH, centerXZ)`
  now optionally **centers the model horizontally on its pivot** — used for rocks so the pivot sits under the rock's true centre
  (also fixes the collision disc, which referenced a point away from the visible rock); (2) rocks are seated **FLAT at the lowest
  point of their footprint** (embedded uphill, never floating downhill), footprints steeper than the rock is tall are skipped, and
  the fling-prone tilt is **removed**. Palms/trees untouched (they don't pass `centerXZ`). Verified by scanning every rock's lowest
  world vertex vs the terrain beneath it: **floaters 26 → 0**, 34/38 well-seated, 1 rock skipped on a steep spot.
- **Click-to-select ship targeting:** at sea, **LEFT-CLICK now only SELECTS** the clicked ship (a coloured ring + info card drop on
  it) — it no longer fires. **SPACE fires the broadside ONLY at your selected ship** via new `fireAtSelected()`: no target →
  a *"Click a ship to target it"* nudge and **no shot**; target out of range / in the fore-aft dead-zone / mid-reload → the matching
  hint and no shot; otherwise the side that bears volleys the **selected ship alone** (`fireBroadside(side, [selected])` — no other
  ship is ever in the hit list, so you can't accidentally spray the whole sea). The top-center **bearing ribbon** now tracks your
  selected target (FIRE / turn / range / reloading) or prompts you to pick one. Controls + title text updated. `playerFire()` (the
  old fire-at-all) is kept only behind debug hooks. Verified live (reload-timer + hp isolation): no-selection → no fire · abeam
  target → fires that side · fore/out-of-range → no fire · left-click → no fire.

### 2026-07-06 (46) — DUAL WEAPONS ashore: ⚔ Cutlass (melee) + 🔫 Flintlock (ranged), press **Q** to swap
Owner (after seeing the procedural flintlock): *"both and make sure we have a simple way to switch."* So the hero now carries
BOTH pirate sidearms and swaps between them ashore with one key.
- **Two weapons, one hero:** module state `heroWeapon = "cutlass" | "flintlock"`. `equipHeroGun()` attaches the ACTIVE weapon to
  the right-hand bone (`FistR`): the cutlass is `_gunGltf.scene.clone(true)` (shared GLB); the flintlock is a fresh
  `makeFlintlock()` procedural build. Each has its own grip transform (`WPN_*` vs `FL_*`).
- **Grips PROPERLY seated (owner: *"cutlass not properly held; gun too large, not held facing outward"*):** both grips were
  re-tuned **deterministically against the live `FistR` bone frame** rather than by eye. Probed the hand bone's world axes, then
  solved each weapon's euler so the geometry points where it should — **cutlass** hilt seated in the fist with the blade UP +
  slightly FORWARD (a real ready stance; measured blade·up = 0.94, blade·forward = 0.35, was pointing *down-back-left/buried*);
  **flintlock** shrunk (`FL_SIZE` 1.7 → 1.05) and rotated so the barrel is LEVEL and points **outward toward enemies**
  (measured barrel·forward = 1.0, was pointing at the sky). Verified stable across idle frames + screenshotted both in-hand
  from a 3/4 inspection cam. New `__PC__.wcam(dist,aimY,side)` debug cam for weapon-in-hand inspection.
- **Simple switch — Q (ashore):** `switchWeapon()` flips `heroWeapon`, re-equips, and banners *"⚔ Cutlass drawn — LEFT-CLICK to
  swing"* / *"🔫 Flintlock drawn — LEFT-CLICK to shoot"*. Guarded to ashore + not paused/shop.
- **Attack routes to the active weapon:** new `heroAttack(dx,dz)` owns the cooldown/guard and routes — **flintlock →
  `fireArrowDir()`** (musket ball + muzzle flash + gunshot, `BOW_CD`), **cutlass → `heroSlash()`** (frontal-cone melee + whoosh,
  `SLASH_CD`). Both SPACE (`heroShootForward`) and LEFT-CLICK (`heroShootAt`) funnel through it. `heroSlash` no longer owns its
  own guard (moved up to `heroAttack`), so the two weapons share one clean cooldown gate.
- **No leak / no corruption on swap:** `equipHeroGun` disposes ONLY the procedural flintlock's fresh geos/mats on switch-away
  (tagged `userData.procedural`); the cutlass GLB clone is never disposed because `clone(true)` SHARES geometry/material with
  the shared `_gunGltf` (disposing it would corrupt every future cutlass). Verified: `heldMeshes` stays 1 across 24 swaps.
- **UI updated:** ashore HUD caption shows the active weapon `⚔ Cutlass`/`🔫 Flintlock (Q swap)`; the enter-island banner and the
  pause **Controls** panel now list the Q-swap and "LEFT-CLICK attack" for both weapons.
- Verified via Preview MCP (zero console errors): default = cutlass (melee hit, 0 bolts); swap → flintlock (procedural, 1 bolt
  fired, no melee); swap back re-attaches the cutlass GLB; 24× swap → no mesh accumulation; both weapons screenshotted in-hand.
- `__PC__`: `swapWeapon()` / `setWeapon(which)` / `weaponState()`; `attack(rangeAway)` now routes through the active weapon.

### 2026-07-06 (45) — FIX (owner): cutlass SWINGS (real anim + whoosh) + cannons are an UPGRADE, not OP from the start
Owner: *"the scimitar is great — use it in hand PROPERLY to SWING, not as a gun (it makes a shooting sound). Also my ship
starts with 3-4 cannons firing everywhere — seems OP; that should be an upgrade. And could you make a flintlock in 3js?"*
- **Real sword SWING (not a punch/thrust):** the hero is the Ranger rig, which has NO blade clip, so the cutlass attack fell
  back to `Punch`. Now `makeCharacterRole` (for `role==="hero"`) **borrows the Warrior's `Sword_Attack` clip** (shared
  Quaternius skeleton) so the hero SWINGS the cutlass just like the marauder foes. Verified: the hero's mixer runs a real
  `Sword_Attack` (swing pose screenshotted).
- **Swing SOUND, not a gunshot:** `heroSlash` was playing `sfxAt("fire")` = `cannon.ogg` (a boom). Added a synthesized blade
  **`playSwing()` whoosh** (band-pass-swept noise) and use it instead.
- **Cannons are now an UPGRADE:** the broadside fired a **flat `VOLLEY_N=4`** balls from the start (OP). Now
  `volleyN = 2 + min(upg.cannon, 2)` → **starts at 2**, scales to 4 via "Bigger Cannons"; the visible barrels
  (`buildCannons`) match at `1 + min(upg.cannon, 2)` pairs (1→3). Shop desc notes "+1 broadside gun". Verified: volley 2/3/4
  at upg 0/1/2, barrels 1→3 pairs.
- **Procedural FLINTLOCK (in Three.js):** no flintlock exists in the asset library, so `makeFlintlock()` builds one from
  primitives (octagonal barrel + brass muzzle, breech/lock/S-cock hammer/frizzen, curved wooden grip + brass butt, trigger +
  guard + ramrod). Built + shown (`__PC__.showFlintlock`) but NOT yet the live weapon — pending the owner's choice of
  cutlass-melee vs flintlock-gun vs both.
- *Verified (Preview MCP, screenshots): swing pose + cannon volley scaling + zero console errors. Adversarial review clean
  (0 confirmed bugs).*
- `index.html` `?v=` → 1781100000. **REDEPLOYED** (cutlass fixes + cannon rebalance; flintlock dormant).

### 2026-07-06 (44) — FIX (owner): pirate CUTLASS in the HAND (was a modern gun on the elbow) + melee swing
Owner: *"the gun is a NEW gun, not for a pirate game — use pirate weapons; if we don't have pirate guns then use swords; and
make sure the PC holds the weapon in their HAND not on their elbow."*
- **Pirate weapon:** searched the Poly.Pizza library — NO flintlock/blunderbuss/musket exists, so (per the owner's fallback)
  the hero now wields a **Cutlass** (`assets/props/cutlass.glb`, CC0) — a curved brass-guarded pirate blade.
- **In the HAND, not the elbow:** the old `equipHeroGun` regex `/LowerArmR|HandR|ForeArmR/` grabbed the FIRST match, which
  in bone-traversal order is `LowerArmR` (the forearm) — it never reached the hand. The Quaternius hand bone is **`FistR`**
  (not "HandR"); now the cutlass attaches to `FistR` with a tuned grip (hilt in the fist, blade forward, rx=1.15). Tunable
  live via `__PC__.reWeapon` + `weaponInfo`.
- **Melee, not bullets:** a cutlass firing musket balls would look worse than the gun did, so the ashore attack is now a
  **swing** — LEFT-CLICK/SPACE → `heroSlash(dir)` faces that way, plays the attack motion (+ a bright `slashFx` arc), and
  strikes the NEAREST living foe within `MELEE_RANGE` (18) inside a frontal cone, using the same D&D dice (can miss). Reach
  18 > the foes' 15 so you out-range them. Crew keep their ranged spells; sea broadsides are unchanged. Control hints +
  the ashore banner now say "swing ⚔". (The Ranger rig has no sword clip, so the swing uses its Punch/thrust motion.)
- *Verified (Preview MCP, screenshots): cutlass renders in the hand (`FistR`, 1 child) as a forward-pointing pirate blade;
  swings miss on a bad roll then hit for ~23 dmg; the attack motion + slash arc play; control text updated; zero console
  errors. Adversarial code-review pass before deploy.*
- `index.html` `?v=` → 1781090000. **REDEPLOYED.**

### 2026-07-06 (43) — FIX (owner): island rocks floating / buried / clipping — proper X-Y-Z placement
Owner: *"rocks can be found hanging in the air, in the ground, or objects — check collision on all rocks for proper X Y Z
placement."* Confirmed by measurement: the terrain under a rock's footprint varied 4–7u (steep slopes), and rocks were
seated at the **centre** height, so the downhill edge floated up to **1.9u** while the uphill side buried — and there was
no spacing check, so rock footprints overlapped (clipping). Fixes in `buildIsland`'s prop loop:
- **TILT to the slope:** each rock now samples the local terrain gradient (`_isleH` at ±footprint E/W/N/S) and rotates
  `rotation.x/z` to align its up-axis with the ground, so its base FOLLOWS the slope — never floating on the downhill
  edge nor buried on the uphill one, on any slope (keeps full rock density instead of skipping hilly spots).
- **Spacing:** skip a prop whose footprint overlaps an already-placed one (`(fr+q.fr)*0.9`) — no more rocks clipping into
  each other / into palms/trees.
- **No rocks in the sea:** the whole footprint must sample dry land (`min(E,W,N,S,centre) >= 1.0`).
- **Collision matches the visual:** the collision disc radius `cr` now equals the exact footprint `fr` used for placement.
- *Verified (Preview MCP, numeric sweep of ALL 16 islands): 39 rocks, ALL tilted to their slope; 0 floating; every base
  edge within ~0.6u of the terrain (worst overhang 0.62u, down from 1.9u); density restored (2.4 rocks/isle, 12/16 isles);
  zero console errors. (Close-up screenshots were blocked by the preview's fixed-portrait camera over high terrain.)*
- `index.html` `?v=` → 1781080000. **REDEPLOYED** (bundled with the entry-42 quest deploy).

### 2026-07-06 (42) — NEW SYSTEM: treasure-map quests (batch FINALE)
Last of the owner's four-system batch. **Buy a treasure map at Tortuga, follow the gold marker to a distant isle, dig up
the X-marks-the-spot hoard.**
- **Quest giver** = the Tortuga shop: a new **🗺 Treasure Map** row (cost `MAP_COST=120`) → `startQuest()` picks a random
  non-town island as `activeQuest={isle,dug,spot,mesh}`. ONE quest at a time (`buy()` guards `kind==="map" && activeQuest`;
  the row shows an "active → sail to X" status instead of a buy button while one is running).
- **Navigation:** a **GOLD quest chevron** (replaces the nav compass in `drawHUD` while active) + a **gold "X" dot on the
  minimap** (clamped to the rim if beyond range) point you to the isle + show the distance.
- **X-marks-the-spot ashore:** landing on the quest isle plants an X marker (`spawnQuestX` — a gold torus ring + two crossed
  stakes at a `_spotNear` spot, gently pulsing/spinning). Within 15u a **"Press F to DIG"** prompt shows; **F** →
  `tryDig()` awards a big hoard (`250 + rand·220 + lvl·45` gold + XP), a burst, and clears the quest.
- **Persistence + cleanup:** the quest persists across landings until dug (`leaveIsland`→`stripQuestMesh` removes the mesh
  but keeps `activeQuest`; the marker rebuilds each landing). Marker geometry/materials are disposed on dig + leave (no
  leak); it's a separate scene child so `refillIsland` never touches it.
- *Verified (Preview MCP, screenshots): buy → quest to "Cutlass Cay"; gold chevron + minimap X; land → X marker builds; dig
  prompt at <15u; F → +631 gold + level 1→3 + quest cleared; persists across landings (marker rebuilds); 2nd map blocked;
  zero console errors.*
- *Adversarial code-review (3-lens) caught + fixed 2 issues before deploy: (a) F/dig fired while the game was PAUSED
  (`tryDig` now guards `paused||shopOpen`; E/dock also gated); (b) defensive `startQuest` reachability filter so a map can
  never target an isle outside the sail box (near edge must be `<= SEA-40`). One flagged HIGH (soft-lock) was a false
  alarm at the live `sea=1400` (all belts sit inside the box) but the filter is kept as insurance.*
- `index.html` `?v=` → 1781080000. **REDEPLOYED.** **The owner's four-system batch (visual ship upgrades · night+boss ·
  weather/storms · treasure-map quests) is COMPLETE.**

### 2026-07-06 (41) — NEW SYSTEM: weather / storms (squalls) — composed with night
Third of the owner's new-systems batch. Periodic **squalls** roll across the sea: darker sky, the fog wall pulls in, the
swell turns rough, **rain**, **lightning + thunder**, and **wind that drifts your ship**.
- **Composed with night, not clobbering it.** Night (entry 39/40) and storm both modulate exposure/fog/sun/water every
  frame, so they're now unified into ONE `applyEnv()` that folds the DAY baseline + `night.t` + `storm.intensity`:
  exposure = (night lerp) × (1 − 0.34·s) + a lightning pop; fog colour→grey + far pulled to ~330; sun dims; water colour
  darkens; `distortionScale` 3.2→8.5 + `size` 8.0→4.2 (rougher, bigger swell); sky turbidity hazes; the moon is swallowed
  by cloud. At `night.t=0 && storm.intensity=0` it restores the EXACT day baseline (verified: settledToDay true).
- **Rain** = ONE `InstancedMesh` (175 wind-tilted streaks, one draw call, lazy-created, recycled around the camera; only
  drawn when `storm.intensity>0.12 && mode==="sail"` — zero cost when calm). **Lightning** = a brief exposure pop +
  `addShake` thunder on a random timer (`storm.intensity>0.42`). **Wind** = `storm.windDir` drift added to the player's +
  NPCs' position integration (steer to hold heading).
- **Scheduling:** `stepStorm` (onset timer only while `mode==="sail"`, frozen ashore like the night cycle) toggles
  `storm.target` between calm and 0.62–0.95 on `STORM_DUR`/`STORM_CALM` timers; `stepNight` ramps `storm.intensity` +
  runs `applyEnv` every frame (renders during pause). A **⛈ Squall %** HUD badge shows at sea. `__PC__`:
  setStorm/stormState/lightning.
- *Verified (Preview MCP, screenshots): storm-by-day (dark, fog-in, rough water, tilted rain, badge, wind-drift); stormy
  NIGHT composes (exposure 0.18, darker than either alone); lightning flash + thunder shake; clean restore to day; zero
  console errors. Adversarial code-review pass before deploy.*
- `index.html` `?v=` → 1781060000. **REDEPLOYED.** (last in batch: treasure-map quests.)

### 2026-07-06 (40) — BOSS v2 (owner): rare + random + hard-to-find, at SEA and on LAND
Owner: *"boss ships and boss enemies on land? can it be random at night — not so easy to find, doesn't show up every
night, certainly not on every island."* Reworked the boss system to be a rare night terror, sea + land (owner picked the
cadence: sea boss ~1 in 5 nights + spawns far; land boss fully random at each night landing).
- **Night is now a recurring CYCLE, decoupled from the boss.** `stepBoss` (only while `mode==="sail"`) counts `night.cool`
  down to `startNight()` (a ~120s night), then `night.dur` down to `endNight()` (dawn), then schedules the next
  (`NIGHT_GAP 220–350s`, so night is ~30% of sailing time). Ashore the clock is FROZEN (stepBoss early-returns) so a night
  landing stays night. `dawnBreak()` ends a night early on victory/flee.
- **Sea boss (Dreadmaw): ~1 in 5 nights, spawns FAR.** `startNight()` rolls `Math.random()<0.2`; on a hit `riseBoss()`
  surfaces the Dreadmaw **820–1160u away** (was ~450) with only a vague warning — you HUNT it via a **red hunt-marker on the
  minimap** (clamped to the rim if beyond range) + the `☠` bar's live distance. It dives at dawn if you don't catch it, or on
  flee-to-harbour / death. So **most nights are just dark, empty sea**; the Dreadmaw is a real event.
- **Land boss ("Dread Captain"): fully random at each NIGHT landing (~1 in 5), on ANY island.** `maybeLandBoss()` in
  `enterIsland` (gated on `night.t>=0.5`) rolls `<0.22` → a bigger (17.5 vs 12.8), darker, much tougher marauder-kind foe
  (`hp ×2.7`, `dmg ×2.2`, `boss:true`) joins the isle's foes; big bounty (`200+lvl·30` gold + XP) via the
  `arrowStrike`/`crewCastSpell` boss branch; `stripLandBoss()` on leave removes it so each landing re-rolls (transient, no leak).
- *Verified (Preview MCP): sea boss at 925–1008u + minimap hunt-marker + HP-bar distance; natural nightfall gives a 120s
  night usually with NO boss (the 1-in-5 confirmed); Dread Captain spawns bigger/darker at a night landing → +230 gold on
  kill → stripped on leave; death-respawn-to-harbour submerges the sea boss (dawn); zero console errors. Adversarial
  code-review pass before deploy.*
- `index.html` `?v=` → 1781050000. **REDEPLOYED.**

### 2026-07-06 (39) — NEW SYSTEM: night falls + a boss, "The Dreadmaw"
Second of the owner's new-systems batch (*"boss at night"*). Night is an **event tied to the boss**, not a passive cycle —
more dramatic and fully controllable. After a stretch of open-water sailing (`boss.cool` counts down only while at sea,
beyond the harbour), **night descends** over ~4s and **The Dreadmaw** — a bigger, dark, ghost-lit `pirateLg` — surfaces
~450u away with its own health bar. Sink it for a big gold+XP bounty (dawn returns); flee to safe harbour or die and it
submerges. It reuses the existing NPC systems (`stepNPC`/`enemyFire`/`computeEngageSet`) so the **≤3-simultaneous-attacker
cap still holds** — it counts as one — but hits **hard** (hp `420+lvl·45`, dmg `22+lvl·2`), not faster (per the owner's rule).
- **Day/night ambience** — `applyNight()` lerps the whole palette from the captured DAY baseline toward moonlit-dark by
  `night.t` (0=day, 1=night): tone-mapping exposure 0.6→0.26, sun 2.1→0.5 + warm→cool, fog 820→600 + darkened, env-IBL
  0.5→0.16, water colour + sky rayleigh/turbidity, plus a cool `nightAmbient` fill + a `moon` disc (glints in the water).
  IBL is baked once (stays dusk) so we lean on exposure/fog/env rather than re-baking. `stepNight()` tweens in the
  pre-`!paused` region so the palette renders correctly even while paused. **t=0 restores the exact day baseline (no drift).**
- **Boss lifecycle** — `riseBoss()` spawns the Dreadmaw (dark-tinted + faint red emissive glow, 1.28× scale) as an NPC;
  `onBossDefeated()` (from `sinkNPC`'s `n.boss` branch) grants `300+lvl·45` gold + big XP + dawn; `despawnBoss()` on
  flee/harbour; bosses never respawn (`!n.boss` guard in `stepNPC`) and sunk bosses are **reaped + disposed** in `stepBoss()`
  *after* the npc loop (safe `npcs[]` splice, no mesh/material leak). `stepBoss` only rises/hunts while `mode==="sail"`.
- **HUD** — a top-centre **☠ THE DREADMAW** bar (distance + red health) while the boss is alive at sea.
- *Verified (Preview MCP): full-night palette + clean restore-to-baseline (matchesBaseline true); Dreadmaw rises with banner
  + HP bar + dark ship at night; HP bar drops on hit; defeat → +525 gold, level 1→4, dawn; flee-to-harbor submerge; boss
  reap; zero console errors.*
- *Adversarial code-review pass (3-lens workflow) before deploy caught + fixed one cosmetic bug: the boss's ghost-glow
  emissive was permanently wiped to black by the first damage-flash (`stepFlash` decayed the shared hull emissive toward
  0 with no restore path) → `stepFlash` now snapshots each hull's RESTING emissive and flashes red ON TOP of it (verified:
  glow returns to #37060a after a hit). Also hardened `disposeShip` to dispose per-instance materials only, never the
  SHARED hull geometry. A second flagged issue (shared-geometry disposal) was traced to a false alarm and dismissed.*
- `index.html` `?v=` → 1781040000. **REDEPLOYED.** (next in batch: weather/storms, then treasure-map quests.)

### 2026-07-06 (38) — NEW SYSTEM: your ship VISUALLY upgrades ("Blackened Broadside")
Owner: *"we DO have ship upgrades at port — do they VISUALLY upgrade the ship though?"* Answer (verified in code):
the Tortuga shop existed but **every purchase only changed numbers** — `buy()` (line ~1301) never touched the 3D
model, so you sailed the same stock Brigantine from launch to fully-kitted. Now the ship's **look tracks the stats**.
Design came from a 3-lens design-panel workflow (readable-progression / pirate-cool-factor / perf-asset-reality →
synthesizer); the "Blackened Broadside" scheme gives each of the five stat drivers ONE legible visual channel:
- **Rigging (speed)** → sails grow subtly (×1.06/1.12/1.18) and **darken** (hue preserved via `multiplyScalar`, so
  weathered battle-canvas, never a black void). Kept small so tall sails never wall off the chase-cam view.
- **Cannon (firepower)** → a growing **broadside of dark barrels** (1→2→3 pairs, cap 6) — one shared low-poly geo +
  one shared material, `castShadow=false`, parented to the hull node at the gunwale (local y=2.8, x=±2.48).
- **Hull (armor)** → hull **paint** darkens tan-oak → tar-black + rising metalness (kept off pure black so planks read).
- **Crew (hands)** → the mast **crowds with flags**: flag-a (crimson) baseline, flag-b (gold) at 1 crew, flag-c (teal) at 2.
- **Level (veteran)** → sail **rank hue** climbs dun → crimson (Lv4) → crimson-gold (Lv8); and at **Lv8 the whole hull
  swaps to the bigger `ship-large.glb`** flagship (one-shot, guarded by `_flagship`).
- **How:** one idempotent `applyShipVisuals()` re-derives ALL channels from current state (`upg`/`crew`/`level`) — called
  from `buy()`, the level-up loop, and boot — so the look can never drift from the numbers. `hullNode()` resolves the
  hull mesh by `/^ship-/` name-prefix (survives the ship-large swap). Recolors hit the player ship's **per-instance-cloned**
  materials only (`makeShip` clones per mesh) — the ~48 NPC hulls are untouched. Repainted sail/hull/flag mats are
  registered into `player.hullMats` so the on-hit damage-flash still covers them (`.color` for paint, `.emissive` for
  flash — no conflict). `ship-large.glb` is preloaded at boot so the capstone swap never hitches.
- *Verified (Preview MCP, screenshots): stock ship (pale dun sails / tan hull / 1 flag / no guns) → maxed war-galleon
  (blood-red sails / tar hull / 6 gunwale cannons / 3 flags); gradual tiers confirmed (1-of-each = ×1.06 scale, 2 cannons,
  2 flags, mid-tan hull); two-axis check (Lv1-max = dark taupe canvas, Lv6-max = blood-red); Lv8 flagship swap to
  `ship-large_1` re-applies all channels + re-points hullMats with no crash; distinct material UUIDs (no NPC bleed);
  zero console errors throughout.*
- `index.html` `?v=` → 1781030000. **REDEPLOYED.** First of the owner's new-systems batch (next: night boss, weather/storms, treasure-map quests).

### 2026-07-06 (37) — POLISH: lingering gunsmoke puff on gunfire
Small cosmetic feel pass on the hero's flintlock. Firing already spawned a bright additive muzzle flash; now it also
leaves a soft grey **smoke puff** that rises, expands, and fades over ~1.5s — reads as real black-powder discharge.
- **`puffSmoke(x,y,z)`** (cosmetic `Math.random`): 3 semi-transparent grey spheres per shot at the muzzle, each with a
  small random offset, upward drift (`vy`), and growth (`grow`); `opacity` eases out with life. Hard cap **40 live puffs**
  so rapid fire can't runaway. `updateGunsmoke(dt)` ticks + disposes them in the sim block (line ~1685); `clearOverlay()`
  resets `_gunsmoke` on scene teardown. Called from `heroMuzzleFlash()` so it fires on every gun shot (ashore + at sea).
- *Verified (Preview MCP): one shot adds exactly +5 scene objects (bullet + flash + 3 puffs); all `SphereGeometry` puffs
  return to zero after ~1.5s (no leak — the scene settles back to its transient-fx baseline); zero console errors.*
- `index.html` `?v=` → 1781021000. **REDEPLOYED.** Purely cosmetic; no gameplay/balance change.

### 2026-07-03 (36) — PLAYTHROUGH complete (stages 2-7 verified) + FIX: your broadside missed MOVING enemies
Finished the end-to-end verification pass. Found + fixed a real ship-combat flaw, then confirmed every stage.
- **FIX — asymmetric cannon LEAD**: the `LEAD 0.35` added in entry 29 (so YOU can dodge enemy fire) was shared by
  `fireBall` in BOTH directions, so YOUR broadside also under-led → moving enemies dodged your shots (a fired volley
  did 0 damage to a sailing Brigantine). Split it: `fireBall(...,lead)` param; the player broadside now leads well
  (`PLAYER_LEAD=0.9`) so moving enemies are hittable, while enemy→player fire keeps `LEAD=0.35` (still dodgeable).
  *Verified: broadside vs a moving (speed 18) enemy now lands — hp 75→55; the player-dodge behaviour is unchanged.*
- **Playthrough VERIFIED end-to-end** (Preview MCP, screenshots): (1) SAIL — clean HUD, full 46kn from spawn;
  (2) SHIP COMBAT — broadside hits a moving enemy (dice + damage + burst FX); (3) DODGE — enemy lead 0.35 preserved;
  (4) DOCK — forceAshore → Rum Island zoom-in; (5) ASHORE — skinned marauders (not blocks), red/green HP bars, D&D
  damage numbers (14/15), gun bullets + crew spell orbs, rock collision (Tarhaven) + seated rocks; (6) PAUSE/SETTINGS —
  Esc pause over a blurred FROZEN scene, sliders drive the audio (master 0.6·.4·.9=0.216, music .30·.6·.4=0.072),
  double-Esc resumes; (7) RETURN — leaveIsle → sail, sim resumes. Zero console errors throughout.
- `index.html` `?v=` → 1781020000. **REDEPLOYED.** Pirate's Cove is feature-complete + verified end-to-end.

### 2026-07-03 (35) — PLAYTHROUGH pass — CRITICAL FIX: ship was GROUNDED at spawn (couldn't sail)
Ran a full playthrough verification and immediately hit a game-breaker: **at spawn the ship couldn't accelerate** (stuck
at ~0.2 kn). Root cause: the spawn sits at `town.r + 48 ≈ 280` from origin, but the near Lv1 islands (centre ~365, r
~110) have footprints reaching INWARD to ~250 — so the spawn was INSIDE an island's `overlapsLand` circle and
`stepPlayer` bled the speed to ~0 every frame. (`sinkPlayer` respawn at `townPos.z+132` was inside the town radius too.)
- **`harborSpawn()`** (new, shared by the initial spawn AND the sink respawn): fans out from the Tortuga docks, steps
  outward until a spot is clear of every island footprint, AND picks a HEADING with a clear channel to open sea (scans
  ~11 bearings, returns the first with ≥220u clear, else the clearest). So you spawn in open water pointed at a lane.
- **Harbour bubble**: `scatterIslands` now requires each island's INNER EDGE (`centre − r`) to stay ≥300 from origin
  (was centre ≥300, so radii poked in) — no island reaches the docks. Islands 18→17 (one placement dropped; fine).
- *Verified: ship now accelerates to full 45.6 kn from spawn with only W (no steering); nearest island inner-edge 315;
  Stage-1 SAIL HUD screenshot clean (pips + compass + bearing ribbon + scout pill + waters + minimap).*
- `index.html` `?v=` → 1781019200. Zero console errors. **REDEPLOYED** (this fixes a LIVE game-breaker — the deployed
  build spawned grounded). Playthrough stages 2–7 (ship combat, dodge, dock, ashore gun+crew, pause/settings, return)
  to be re-verified next tick.

### 2026-07-03 (34) — [P8] minimap scaled to the whole map + [P9] ambient sea bed + compass chevron to nearest plunder
- **P8 — minimap radar now scales to the WHOLE map**: `MM_RANGE` was a magic 620 → now `= SEA` (1400), so the
  player-centric radar plots the entire map relative to the player (far islands appear near the rim instead of never
  showing). Out-of-disc items are still cleanly clipped (the `inR` check). *Verified: radar shows islands + ships across
  the map with the player arrow centered.*
- **P9a — ambient sea bed**: `startAmbient()` synthesizes a very soft looping low-passed noise WASH (distant surf) with a
  slow swell LFO, routed through `audio.master` (SFX bus) so the Master + SFX sliders govern it; started with the music in
  `resumeAudio`. Subtle (gain 0.05), no file, no health framing. *Verified: `audioState().ambient=true`, gain 0.05.*
- **P9b — compass chevron**: a top-center-top HUD pill "🧭 ↑ {island} {dist}m" whose arrow rotates to the bearing of the
  NEAREST UNPLUNDERED island (has alive foes OR untaken chests), sea-mode only — so the big map is navigable. *Verified
  in-screenshot: "🧭 ↗ Wreckers' Cay 248m".*
- Debug: `audioState().ambient`. `index.html` `?v=` → 1781018100. Zero console errors; sim live. **REDEPLOYED.**
- **Main roadmap (P4–P9, C3–C5) COMPLETE.** Next: a full playthrough-style verification pass.

### 2026-07-03 (33) — [C5] Rock collision (hero can't walk through) + terrain blending (rocks seat deeper)
Owner: the rocks on land + in the water need collision + must blend into the terrain (not float).
- **Rock collision store**: `buildIsland` now collects each rock's LOCAL position + a footprint radius into `is.rocks`
  (`{x,z,cr}`, cr = 2.2 + rockHeight·0.32).
- **Hero can't walk through rocks**: `stepHero` gates movement on `heroCanGo()` = dry land AND `!hitsRock()`; if blocked
  it SLIDES along X-or-Z so you go around rather than sticking. *Verified: walking straight at a rock (cr 4.7) the hero
  stops at 4.9u — just outside — and the rock centre is solid.*
- **Blending**: rocks now seat DEEPER into the terrain — `seat = 0.6 + rockHeight·0.22` (was a flat 0.4) — so bigger
  rocks embed proportionally and never float on a slope. *Verified in-screenshot: shore rocks sit in the waterline with
  reflections, no floating.*
- **Ship**: no code needed — the ship already grounds at `overlapsLand(r+8)` and rocks live INSIDE the island (rd ≤
  0.74·r), so the ship stops well before any rock (can't sail through them). Noted for clarity.
- Debug: `islandsInfo().rocks`, `rockProbe()`, `rockCollideTest()`. `index.html` `?v=` → 1781017000. Zero console
  errors; sim live. **REDEPLOYED to forgeflowgames.com.**

### 2026-07-03 (32) — [C4] Industry-standard UI: clean "Charted Ledger" HUD + Esc PAUSE menu + SETTINGS (designed via workflow)
Ran a 3-lens design-panel WORKFLOW (minimalist / AAA / diegetic) → a synthesized, code-cited spec ("Charted Ledger +
Bearing Ribbon"), then implemented it.
- **HUD rebuilt** (drawHUD, still one kernel.hud string): the cramped 6-row TEXT WALL → a fixed-height gold/navy
  STATUS CARD of iconized PIPS (sea: ❤hull+microbar / 💰gold / ⭐level+xp-arc / ⛵speed / 🧑‍✈️crew; ashore swaps to
  ❤hero / 💰 / ⚔foes / 🎁chests / 🧑‍✈️crew-up). The live aim indicator → a top-center **BEARING RIBBON** (🎯 ◀PORT/▶STBD
  — FIRE / ⟳reloading / ↩turn) shown only when a hostile is within FIRE_RANGE. Waters → a caption over the minimap;
  scout + dock → transient bottom-center pills (sea only). The always-on controls line is GONE (rehomed in Pause>Controls).
- **Esc PAUSE menu** (new `_pauseEl`, one persistent pointer-events:auto overlay like _shopEl, NOT in kernel.hud): a
  blurred title-style scrim + gold-Georgia "⚓ PAUSED" sheet — Resume / Settings / Controls / Return to Title (with an
  abandon-voyage confirm). Esc pauses; Esc from a sub-view steps back to the menu; Esc/backdrop-click from the menu resumes.
- **Full-sim FREEZE**: added `paused` to the `frozen` gate AND wrapped the whole sim-integration block in `if(!paused)`
  so the ENTIRE world halts (ships/foes/projectiles/music/refills) while the still scene + camera + HUD keep rendering.
  *Verified: npc x stops at pause, resumes on close.*
- **SETTINGS**: master / music / SFX gold-themed range sliders + a Mute toggle + a full CONTROLS reference. Wired to the
  real audio graph via `applyAudio()` — `audio.master.gain = 0.6·master·sfx` (SFX bus), `audio.musicGain = muted?0:
  MUSIC_MASTER·music·master`. toggleMute() now routes through applyAudio (unmute respects sliders). Persisted to
  localStorage `pc_audio` and applied in initAudio. *Verified: sliders drive the gain nodes (0.6·.5·.8=0.24 master,
  .30·.3·.5=0.045 music); mute/unmute round-trips.*
- Debug: `pauseState()/pause()/setPauseView()/setVolume()`. `index.html` `?v=` → 1781016100. Zero console errors; title
  + minimap untouched. **REDEPLOYED to forgeflowgames.com.**

### 2026-07-03 (31) — [P7 verified] sliding pirates fixed · [C3] more content far out + strict banding confirmed + content.json cache-bust
- **P7 — sliding pirates VERIFIED FIXED** (no code change): a CHASING pirate plays the Rogue's `Run` clip (confirmed
  live — activeClip `Run` at dist 123 while the hero fled). They only show `Idle`/`Dagger_Attack` at melee range, which
  is correct. The entry-26 clip-picker rewrite already resolved the slide.
- **C3 — strict level banding CONFIRMED already strict**: islands are perfectly banded (0 out of band), and hostiles
  are LEASHED to their zone belts so **zero Lv5+ mobs sit near the start** (hardNearStart=0). The only drift is Lv1-2
  neutral traders wandering ±45u within their leash near Tortuga — harmless.
- **C3 — more content in the OUTER belts** (the 1400 map felt empty far out): islands 14→**18** (`setup.islands`; +4
  more to explore, 7 now beyond r=880, all uniquely named — added 6 island names), and the outer hostile belts bumped
  Lv4/5/6/7 5/5/4/3 → **5/6/5/4** (23→**26** hostiles, 20 of them far out). Tuned so **worst-case simultaneous attackers
  stays 3** (a 30-hostile pass hit worst=4, so dialed back) — verified worstAtShip=3, worstAtMidpoint=3.
- **Infra fix (cache gotcha)**: `ffg_boot3d.js` now fetches `content.json` with the module `?v=` query, so a redeploy
  never serves a stale `content.json` (was why the island bump didn't show on reload). Still bump `?v=` per change.
- `index.html` `?v=` → 1781015300. Zero console errors; sim live. **REDEPLOYED to forgeflowgames.com.**

### 2026-07-03 (30) — Hero wields an OLD GUN (flintlock) instead of a bow + a real GUNSHOT sound
Owner: "instead of a bow, can the main character have an old gun — and when I shoot it makes the same sound as cannon
fire; do we have a gunshot?"
- **Old gun replaces the bow**: the Ranger's built-in bow mesh (`Ranger_Bow`) is hidden and a Poly.Pizza flintlock
  **pistol** (`assets/props/gun.glb`, CC-BY TARgamSC) is attached to the right-arm bone (`equipHeroGun` on hero spawn),
  scaled to bone-local ~0.34 and tinted dark gunmetal (it loaded bright yellow + oversized). Debug `reGun()` live-tunes it.
- **Gun feel**: `fireArrowDir` now fires a fast **musket ball** (`makeBulletMesh`, `GUN_SPD=300`) with a **muzzle flash +
  smoke puff** (`heroMuzzleFlash` via the `_fx` pool) — no longer a slow arrow. Reload eased to `BOW_CD=0.75`.
- **Real GUNSHOT sound** (was reusing the cannon `fire` = cannon.ogg): `playGunshot()` **synthesizes** a flintlock crack
  (band-passed decaying noise) + a short low boom via WebAudio — no audio file needed, and it's distinct from the ship's
  cannon broadside (which still uses cannon.ogg, correctly). *Verified: firing spawns bullet + 2 fx (flash+smoke), audio
  ctx running, gunshot plays; the shot connects (dmg number); bow hidden + dark pistol in hand in-screenshot.*
- Credit added for the pistol (CC-BY). `index.html` `?v=` → 1781013800. Zero console errors; sea sim intact.
- **REDEPLOYED to forgeflowgames.com.**

### 2026-07-03 (29) — Aim-based combat: LEFT-CLICK to attack, dodgeable non-homing projectiles, no auto-lock; stronger foes
Owner: "make projectiles dodgeable — I shouldn't LOCK IN on enemies by pressing space; use LEFT MOUSE to attack (an
arrow flies out every click); change the boat's SPACE to left-click on an enemy too; if an enemy shoots me at ~80°
but I move too fast I should DODGE — nothing heat-seeking. Also make pirates/marauders STRONGER — they can HIT HARDER
(not faster / not longer reach)."
- **LEFT-CLICK = attack** (SPACE kept as a fallback). ASHORE: a left-click looses an arrow toward the **cursor**
  (ray-plane `groundPointAt`) — SPACE shoots straight ahead. SEA: a left-click fires the broadside that bears + inspects
  the clicked ship. HUD hints + the live aim indicator updated ("LEFT-CLICK to fire").
- **No auto-lock, dodgeable arrows** (`fireArrowDir`): the hero's arrow flies STRAIGHT along the aim to max range and
  strikes the FIRST foe in its path (`ARROW_HITR=9`, per-frame collision in `updateBolts`) — you must AIM, and a foe can
  step aside to DODGE. Replaced the old nearest-foe auto-target `heroAttack`/`fireArrow`. *Verified: shooting forward
  with all 8 foes clustered to the side hit ZERO foes; an arrow through a foe rolled damage.*
- **Cannonballs dodgeable by SPEED** (`fireBall`): the lead is now PARTIAL (`LEAD 1.0→0.35`) and the landing point is
  fixed (already non-homing) — at full speed you outrun the splash at any real range (gap 17.6–22.2 > 15 hit-radius),
  and TURNING dodges at all ranges; slow/stationary ships still get hit. *Verified via the dodge geometry.*
- **Stronger foes** (owner: hit harder, NOT faster/reach): hull `30+lv·10 → 44+lv·14` (marauder ×1.6→×1.85), damage
  `(4+lv) → (6+lv·1.4)` (marauder ×1.5→×1.7). Attack cadence + reach UNCHANGED. *Verified Lv7: pirate 142hp/16dmg,
  marauder 263hp/27dmg.*
- Debug: `meleeTest`→`shootTest`; `attack`/`bowTest`/`spawnBothProjectiles` retargeted to `fireArrowDir`.
- `index.html` `?v=` → 1781012600. Zero console errors; sea sim intact.
- **REDEPLOYED to forgeflowgames.com.**

### 2026-07-03 (28) — Right-drag FREE-LOOK camera + R reset; crew spell orb made BIG + visible (+ trail)
Owner: "cleric or wizard, same thing — fine either way. I see the cast animation but no spell comes out — we need
the animation AND the projectile. Also: RIGHT-CLICK-hold to look around in all directions, R resets view."
- **FREE-LOOK camera**: hold **RIGHT mouse + drag** to orbit the camera in any direction around you (yaw 360° +
  clamped pitch); the offset persists until **R** snaps it back to the default chase. Works at sea AND ashore
  (`orbitOffset` rotates the cam offset in `shipCamPoints`/`heroCamPoints`; right-drag adjusts `_lookYaw/_lookPitch`
  via `pointermove` with `setPointerCapture`; `contextmenu` suppressed). R was the roster toggle → **roster moved to C**;
  control hints updated (sail/ashore/title). *Verified: sim right-drag orbits cam bearing 180°→58°, R resets to 180°;
  screenshot shows the ship from a new side angle.*
- **"No spell comes out" fixed/verified**: the crew DID already cast (confirmed live — spell damage numbers land), so
  the owner was almost certainly seeing a **cached older melee-crew build**. To make it unmistakable regardless: the
  spell orb is now a **big bright white-violet core + double additive halo**, flies slower (`SPELL_SPD 95→78`), and
  leaves a **glowing purple trail** (`spawnTrail`/`updateTrail`, pooled, cleared on leave). *Verified in-screenshot:
  a large glowing orb clearly mid-flight from a crew wizard.* Cleric vs Wizard model unchanged (owner: same thing).
- `index.html` `?v=` → 1781008800. Zero console errors; sea sim intact.
- **REDEPLOYED to forgeflowgames.com** (free-look + visible crew spells).

### 2026-07-03 (27) — Correction: wizard is the HIRED CREW, not a foe (owner) — remove wizard foe, crew casts spells
Owner: "i didn't say wizard FOE — we have a hired help that looks like a wizard that shoots. remove wizard foe, only
the hired character." Correcting entry 26: the wizard/caster belongs to the ALLY away-party, not the enemies.
- **Removed the wizard/caster FOE entirely**: `planIslandContent` seeds only melee marauders + pirates again;
  `buildIslandMeshes` no longer spawns the Wizard model for enemies; `stepFoot` lost the caster kite/cast branch;
  dropped the foe `castSpell`, the `caster` faction colour, and `CAST_RANGE`/`CAST_CD`. *Verified: `foeKinds` = only
  pirate/marauder on a Lv7 island, no caster.*
- **The HIRED CREW are now WIZARDS that shoot spells** (this is the "hired help that looks like a wizard that shoots"):
  `spawnCrewParty` uses the Quaternius **Wizard** model; `stepCrew` was rewritten from melee to RANGED — the crew keep
  the cast distance (`CREW_CAST_RANGE=112`, kite in/out of the band) and lob the glowing spell orb (`crewCastSpell`,
  same `_bolts`/`Spell1` system) at the nearest foe, rolling the same D&D dice; kills still earn crew XP + your gold.
  Blue (ally) HP bar. *Verified in-screenshot: blue-robed bearded wizards playing `Spell1`, purple orbs mid-flight.*
- Debug `castTest`/`spawnBothProjectiles` retargeted to crew. `index.html` `?v=` → 1781005200. Zero console errors; sea intact.
- **REDEPLOYED to forgeflowgames.com** to correct the live game (remove wizard foes, add wizard crew).

### 2026-07-03 (26) — Visible projectiles + real attack animations; WIZARD ranged casters; then FIRST public deploy
Owner: "main pc shoots arrows — i don't see arrows being launched, or wizards shooting spells; make sure pc + npcs
have animations." Two real bugs + one new enemy type, then ship it to forgeflowgames.com.
- **Attack animations were wrong** (root cause): the clip-picker regex matched the STANDING poses "Idle_Attacking" /
  "Attacking_Idle" as the "attack" clip, so hero/wizard attacks looked frozen. Rewrote the picks against the VERIFIED
  Quaternius clip names: melee = `Dagger_/Sword_/Staff_Attack` or `Punch`; ranged = `Bow_Shoot` (Ranger) / `Spell1`
  (Wizard/Cleric); idle = `^Idle$` (not Idle_Attacking); run = `^Run$`. *Verified via `charClips`: hero plays
  **Bow_Shoot** on a loose and **Punch** in melee; wizard plays **Spell1** on a cast.*
- **Arrows now actually fire + are visible**: (1) the Ranger is RANGED-PRIMARY — SPACE looses an arrow at the nearest
  foe unless it's point-blank (`MELEE_LUNGE=16`), so arrows fly the whole time a foe is closing (before, the bow only
  fired when NO foe was within melee 30 — i.e. almost never, since foes rush you). (2) The arrow mesh is now a chunky,
  readable **shaft + metal head + red fletching** group, and slowed (`ARROW_SPD 220→130`) so you see it in flight.
- **NEW: Wizard ranged casters** (the "wizards shooting spells"): added the Quaternius **Wizard** model (`char-wizard.glb`)
  as a `caster` foe kind seeded on Lv3+ islands (1, or 2 on Lv6+), squishy glass-cannons. They **kite** — keep
  `CAST_RANGE≈120`, back off if crowded — and lob a glowing **spell orb** (`Spell1` anim) that flies a slow dodgeable
  arc and rolls the same D&D dice. Purple HP bar. *Verified in-screenshot: the orb is an unmistakable glowing sphere
  mid-flight from the wizard to the hero.*
- Generalized the projectile layer into one `_bolts` system (arrows + spell orbs), `spawnBolt`/`updateBolts`.
- Debug: `clipNames()`, `castTest()`, plus `freezeBolts()`/`spawnBothProjectiles()` for projectile screenshots;
  `overlayProbe` now splits arrows vs spells. `index.html` `?v=` → 1781001700. Zero console errors; sea sim intact.
- **DEPLOYED to forgeflowgames.com** (owner's explicit go) — the game's FIRST public publish. `deploy_game.py --game-dir
  games/pirates-cove --slug pirates-cove` (no --force): 47/47 files → R2, Supabase row inserted, `game_meta.json`
  `status:"published"` (added), existing polished cover reused (no xAI spend). LIVE + verified HTTP 200 at
  **https://forgeflowgames.com/games/pirates-cove/** (CDN worker + public domain; live module confirmed to contain
  the wizard/bow code; live index cache-busts to v=1781001700).

### 2026-07-03 (25) — Real ashore combat: skinned enemies (fix "black blocks") + HP bars + D&D damage numbers + Ranger bow
Owner: enemies render as "BLACK — not skinned — black human blocks"; wants real ashore combat for the away party —
basic shooting/arrows, HP bars above characters, damage numbers popping over the PC/recruits/enemies, D&D miss/crit.
- **Root-caused the "black blocks"**: `makeCharacterRole` was doing `mt.color.setHex(tint)` — a FLAT repaint of every
  material to one dark hex. The Quaternius characters are **textured** (white material + a colour atlas), so setHex
  multiplied the whole texture down to near-black (pirate `0x8a1f1f`, marauder `0x5a0f0f` → black silhouettes).
  **Fix**: replaced the repaint with a FAINT `color.lerp(tint, 0.13)` — the texture shows through, so pirates (Rogue)
  and marauders (Warrior) now read as real skinned characters. Friend/foe is signalled by HP-bar colour, not by
  recolouring bodies. Marauders bumped to targetH 12.8 (clearly bigger) with a deeper faction cast.
  *Verified: `charColorProbe` shows the textured white material; screenshots show fully detailed pirates + armored
  marauders, not blocks.*
- **Ashore combat overlay** (new projected DOM layer, ashore-only): a floating **HP bar** over the hero (green),
  every up recruit (blue), and every engaged/near foe (red / marauder deep-red); and **rising D&D damage numbers**
  over whoever is struck — grey **MISS**, white hit, gold **CRIT** — driven by the existing `rollShot` dice for hero
  melee, foe→party hits, crew→foe hits, AND the new bow. Bars/numbers project via `camera.project`; pool is cleared on
  `leaveIsland`. *Verified: bars = hero+crew+near-foes, numbers show MISS/12/15/24 in-screenshot.*
- **Ranger BOW (ranged shooting/arrows)**: SPACE now swings a blade in melee range and otherwise **looses a real
  arrow projectile** at the nearest LOS foe within `BOW_RANGE=135` — the arrow flies a short arc, and on impact rolls
  D&D damage + a damage number + a kill if it drops the foe. Added a `ranged` clip pick (bow/shoot/aim; falls back to
  the melee swing). *Verified: `bowTest` — arrow flew, connected, foe hp 9999→9042.*
- **Brighter ashore fill** 1.25→1.55 so the characters pop against the dusk terrain.
- Debug: `overlayProbe()`, `bowTest()`, `charColorProbe()`; `attack()` now reports arrows/dmgNums.
- `index.html` `?v=` → 1780936400. Zero console errors.
- **Deferred to next ticks (owner's same message):** more ships/islands in the OUTER belts + STRICT level banding
  (no Lv5 near Lv1-3 = level "zones"); industry-standard UI (clean top-left HUD + pause menu + settings);
  rock props need collision + terrain blending.

### 2026-07-03 (24) — Per-island variety (owner rescope: NO biomes) + bigger map + feel FX (wakes/debris/shake)
Owner rescoped P4: *"we don't need island biomes, they just need to all look slightly different and have different
enemy amounts by difficulty as we go further out."* So — lightweight variety, not 6 named biomes; and verified the
distance-scaled difficulty was actually landing. Then the rest of the polish loop (bigger map, feel FX).
- **P4 — subtle per-island variety** (no biomes). `_isleH` gained an optional per-island `sh` shape
  `{p: dome exponent, a: hill amplitude, f: relief frequency}` from a seeded `pickIslandShape()` — `p<1` broadens the
  plateau top (more dry land), `p>1` sharpens the peak. `sh` is stored as `is.sh` and **threaded into every one of the
  9 `_isleH` call sites** (on-foot ground height depends on it: groundYOn/enterIsland/stepHero/stepFoot/_spotNear/
  buildIsland ×2/foe-walk/crew-walk). Plus a per-island **palette nudge** (coherent `offsetHSL` across sand/grass/rock
  so islands read warmer/cooler/greener) and a **vegetation-mix bias** (`veg`: palm cay ↔ wooded ↔ rocky crag) with
  varied prop density. Kept subtle so every island stays foot-landable. *Verified: 14 islands all have a unique dome-p
  (0.83–1.44); 6 sampled landings (r 99→185) all dry (groundY 2.2–3.4).*
- **Difficulty-by-distance (was already coded — verified live, not changed).** `islandCounts(level)` 3→9 foes / 1→4
  chests, `islandRadiusFor(level)` 90+13·lvl, placed in ascending level belts. Measured: nearest islands (dist ~370)
  are **Lv1, r~100, 3 foes/1 chest/0 marauders**; farthest (dist ~1225–1386) are **Lv5–7, r 151–185, 7–8 foes/
  3–4 chests/2 marauders**. Clean monotonic easy-small-near → hard-big-far gradient.
- **P5 — bigger ocean.** `content.json` `sea` 1000→**1400**, `islands` 9→**14**. `SAFE_R` 240→**330** and the `ZONES`
  belts rescaled ~1.4× (rOut out to 1400) with the **SAME hostile counts (6/5/5/4/3 = 23)** → the same 23 hostiles now
  spread over ~2× the area = LOWER density. Water plane (6000) + sky (30000) already cover it; fog@820 stays so the far
  zones are revealed by sailing. *Verified: worst-case simultaneous attackers still **3** (rule ≤3 holds), 23 hostiles.*
- **P6 — feel FX** (all COSMETIC → `Math.random`, not seeded). **Wake trails**: pooled flat foam discs emitted at the
  stern of the moving player + truly-near NPC ships (within 520u), `spawnWake` evicts the oldest at a 90-cap so the
  **player's trail is never starved** by NPC wakes. **Sink FX**: `sinkSplash` throws 6–9 tumbling plank debris (ballistic,
  bounce-on-water) + two expanding foam rings on any ship sink (player or NPC). **On-hit screen shake**: `addShake` gives
  a small camera kick when YOUR ship is shelled (crit 1.0 / hit 0.55), decays fast (~0.3s) and is skipped in debug free-cam.
  *Verified: sink → debris 6 + rings; crit hit → shake 1.0 then clean decay to 0 (camera not wedged); wake trail visible
  behind the moving ship in-screenshot.*
- Debug: `islandsInfo()` now reports each island's `shape`; added `feelProbe()`, `hitMe(crit)`, `sinkTest()`.
- `index.html` `?v=` → 1780929700. Zero console errors.

### 2026-07-03 (23) — FIX overstuffing (6→3 max attackers) + broadside circling AI + hard ashore-ignore (owner, 2nd flag)
Owner (twice): enemy ships are overstuffed. Measured the worst case: **6 hostiles could shell one point** (5 near an
island). Also boats appeared to menace the player on land. Root-caused + fixed via a design panel (workflow wk0huezrs).
- **Root cause found & fixed** (the real bug): in `stepNPC` the crowd/separation `targetYaw` **outranked**
  land-avoidance, so a crowded ship near an island steered its crowd-escape vector INTO the island, hit the
  last-ditch freeze, and other ships piled onto the frozen one → island-adjacent concentration. Reordered the
  priority ladder so **land/edge safety outranks everything** (safety → engage → crowd → belt); added **island
  repulsion** into the existing single separation loop (push off any shoreline within 90u — no 2nd O(N) pass); and
  made the last-ditch land contact a **deterministic outward slide** (keeps headway) instead of a random-spin freeze.
- **Density cut** (primary lever): `ZONES` hostile belts 12/12/12/10/8 → **6/5/5/4/3** and widened, so a 235u fire-disk
  spans ~1 belt not 3. Total ~39 ships, **23 hostiles** (was ~50). Neutral Lv1-2 kept busy. MIN_SEP + separation
  radius unchanged (raising them starves spawns).
- **Capped broadside circling AI** (structural ≤3 guarantee): `computeEngageSet()` runs once/frame (O(N), no N²),
  picks the nearest **≤ENGAGE_CAP=3** LOS-visible hostiles as `engaged`; only they circle (present a side via seeded
  `orbitSide` + `ORBIT_HYST` hysteresis + a **staggered `orbitR`** so the 3 form a loose firing line) and only they
  are held to an **abeam fire gate** (55° of broadside). Non-engaged ships wander their belt; a stray 4th still fires
  opportunistically but you never face >3 pressing broadsides.
- **HARD ASHORE-IGNORE**: `computeEngageSet` force-clears every `engaged` the instant `mode!=="sail"`, and `enemyFire`
  early-returns on `mode!=="sail"` **before the reload even ticks** — so while you're on foot, no boat fires at,
  orients to, or gathers on your parked ship. Structural, not heuristic.
- **Verified via Preview MCP:** worst-case hostiles-with-LOS-within-235u of any point = **3** (was 6); engage cap held
  at exactly 3 (mixed sides) in the densest knot; **0 engaged + 0 fire while ashore**; worst island concentration
  3 (was 5); 23 hostiles; screenshot shows an uncrowded sea near an island. Zero console errors.
- **NEXT (queue):** [P4] island biome variety; [P5] larger map; [P6] feel FX (wake trail, sink debris/foam ring,
  on-hit screen shake). Optional: pirate GLB with a walk cycle.

### 2026-07-03 (22) — Polish: combat animation clips wired + brighter ashore lighting
- **Character clips wired to combat** (P1): `makeCharacterRole` now builds a named-action map from the GLB clips
  (idle=`/^idle$/`, run=`/run|walk/`, attack=`/dagger|sword|slash|attack|punch|spell/`, death=`/death/`) and returns a
  crossfading `play(name, {once})` (0.15s fadeIn/Out). Stored on hero/foe/crew. States: **IDLE** when still, **RUN**
  when moving (chasing / walking), **ATTACK** (once, held ~0.6s via an `animT` lock) when a strike lands, **DEATH**
  (once, `LoopOnce`+`clampWhenFinished`) on a foe's killing blow — the corpse plays the death anim for ~1.1s
  (`f.deathT`) before hiding instead of vanishing. Verified: hero "Idle"; a woken pirate plays "Dagger_Attack"; a
  killed pirate crossfades to "Death" then hides. *Note:* the Rogue (pirate) GLB has no run/walk clip, so chasing
  pirates idle-slide (fallback to Idle); the Warrior marauder, Ranger hero, and Cleric crew all have Run.
- **Brighter ashore lighting** (P2): added a `HemisphereLight` (`ashoreFill`) that lerps 0→1.25 when `mode==="ashore"`
  and back to 0 at sea — the on-foot characters were silhouetting into the dusk terrain; now they read clearly
  (verified by screenshot: the Ranger's green hood, tan neck, blue tunic all legible vs the earlier dark blobs).
- Zero console errors. (`__PC__.charClips()` added for verification.)
- **NEXT (queue):** [P3] NPC broadside circling AI + anti-bunching; [P4] island biome variety; [P5] larger map
  (SEA 1400, ISLE_N 14); [P6] feel FX (wake trail, sink debris/foam ring, on-hit screen shake). Optional: source a
  pirate character GLB that includes a walk cycle so pirates don't slide while chasing.

### 2026-07-03 (21) — Owner corrections: pirate-appropriate music, attack ANY boat, line-of-sight combat
Five owner corrections in one pass.
- **Music was TECHNO, not pirate-appropriate** → swapped for genuinely nautical tracks. Used the project's own
  `album_genre_presets.json` to find the right genres: EXPLORE = **`fantasy`** (celtic, tin whistle + harp) →
  "Gloaming Thicket" (theme *"a seaside cliff village at dusk"*); BATTLE = **`epic`** (orchestral, heroic brass) →
  "Dawnbreak Saga" (theme *"a fleet sailing into a storm"*). Re-encoded both to ~50s ogg loops (q4, ~760-790 KB).
- **"Where is the regular music?"** → the ambient drone was near-inaudible; bumped `MUSIC_MASTER` 0.16 → **0.30** and
  the explore track is now a melodic celtic piece, so calm sailing has present, fitting music (not wallpaper).
- **Attack ANY boat** (owner: "I should be able to attack any boat, even easy ones though they aren't hostile"):
  `playerFire` + the HUD aim indicator now target ANY alive ship, not just hostiles. Hitting a neutral **provokes
  it** (`tgt.hostile = true` on the landed shot) so it fights back. Verified: fired on a neutral Sloop → 58 dmg +
  turned hostile. (Lv1-2 stay non-aggressive until *you* attack, so the safe start is preserved — you choose piracy.)
- **Ship LINE-OF-SIGHT** (owner: "one boat can see me and another from far attacks too"): `enemyFire` is gated on a
  new `segBlockedByIsland` — a hostile can't fire through an island, so boats hidden behind land don't shell you and
  distant pile-ons in island-dense areas are cut. Verified the segment-vs-island geometry.
- **Island combat isn't a swarm** (owner: "combat on an island shouldn't auto-attack my PC with all enemies at once —
  it's line of sight"): `FOE_AGGRO` 135 → **70**, and a foe only WAKES (`f.aggro`) when the hero is within range AND
  in terrain line of sight (`losTerrain` — hills block); `aggro` resets each landing. Verified on Bone Atoll: 0
  foes aggro'd on landing → only the 2 nearest woke and engaged while 3 distant ones stayed idle until approached.
- Zero console errors. **NEXT (polish queue):** wire Death/Attack clips to combat; brighten ashore lighting; NPC
  broadside circling AI; island biomes; larger map; feel FX (wake trail, sink debris, on-hit screen shake).

### 2026-07-03 (20) — BATTLE vs EXPLORATION music crossfade (owner ask — "not reusing audio")
Owner: "audio, but not reusing audio — for battle vs non battle." Done — combat now has its own music.
- **Two owned tracks → two ~45s ogg loops** (ffmpeg, libvorbis q3, 0.4s fades, ~580 KB each): `music_explore.ogg`
  (calm — F:\Music "Atoll Drone") and `music_battle.ogg` (intense — "Anvil Reactor"). `content.json` gained a `music`
  block. Replaced the single ambient `music.ogg` bed.
- **Dual-bed crossfade** (`_makeBed`/`startMusic`/`setMusicState`): two looping `BufferSource`s, each with its own
  gain under `audio.musicGain` (so `toggleMute` still works). Explore starts at full, battle silent;
  `setMusicState(next)` `linearRampToValueAtTime` crossfades the two over `MUSIC_FADE=1.5s`.
- **Combat-state detection** (`_combatActiveNow`): sea = you just fired (reloadTP/TS) OR any alive hostile within
  `FIRE_RANGE`; ashore = `hero.atkT>0` OR a living island foe within 60u of the hero. `updateMusicState(dt)` flips
  to **battle instantly** on combat and back to **explore after `COMBAT_HOLD=5s`** of calm (hysteresis dead-band so
  brief lulls don't thrash). Wired into onUpdate.
- **Verified via Preview MCP:** both beds decode (45s); on resume → `explore` (vol 1/0); teleport next to a hostile
  → `battle` (vol 0/1); once out of range >5s → `explore` again. Zero console errors. (`__PC__.musicState()` added.)
- This closes all four exploration-overhaul asks (persistent scoutable content, difficulty scaling, dock zoom,
  character variety, battle music). **NEXT (polish queue):** wire Death/Attack character clips to combat events
  (makeCharacterRole plays only Idle now); brighten ashore lighting (foes read dark at dusk); NPC broadside circling
  AI + anti-bunching; island biome variety; larger map; feel FX (wake trail, sink debris/foam ring, on-hit screen shake).

### 2026-07-03 (19) — Dock ZOOM-IN "into the island" + scouting HUD (owner ask)
Owner: "when we DOCK the view shrinks since pc/npcs are much smaller than boats, and we go INTO the island… making
it seem much bigger"; "seeing how many pirates and chests exist lets us know what challenge to expect."
- **Camera zoom transition** (`camMode` sail/zoomIn/ashore/zoomOut + `camT` + `blendCam`): on dock the camera dollies
  from the ship-scale chase cam **into** the tight character cam over ~1s — **FOV 50→42 and height 42→24** (verified),
  smoothstep-eased, so the island feels much bigger on foot. Leaving reverses it (zoom-out to the boat). Extracted
  `shipCamPoints()`/`heroCamPoints()` as the shared source for the steady cams + the blend; `enterIsland` sets
  `camMode=zoomIn`, `leaveIsland` sets `zoomOut`; the onUpdate camera dispatch routes by `camMode`.
- **Scouting HUD** (`updateDock` tracks `scoutTarget` = nearest non-town island within `SCOUT_RANGE=320` **edge**
  distance): the sail HUD shows a card "🔭 {name} — ⚔ N pirates · 🎁 M chests · [tier]" (live counts of *alive* foes /
  *untaken* chests) colored by the island's difficulty tier, or "Plundered" when cleared — so you judge the fight
  from your boat before committing. Verified by screenshot ("Coral Fang — ⚔ 7 pirates · 🎁 4 chests · Hard", red).
- Verified via Preview MCP: FOV/camY zoom in (50→42/42→24) and out (42→50/24→42); scout card renders with correct
  counts + tier color. Zero console errors.
- **NEXT (queued):** [4] battle vs exploration music crossfade (music_explore/battle.ogg from F:\Music, combat-state
  hysteresis). Also: wire Death/Attack clips to combat; brighten ashore lighting; NPC circling AI; biomes; larger map; feel FX.

### 2026-07-03 (18) — PERSISTENT, scoutable island content + difficulty-scaled counts & sizes (owner ask)
Owner: "in the boat I should be able to SEE if there are chests or pirates on the islands"; "shouldn't be limited to
4 pirates and 3 chests hardcoded but within a range of difficulty… variety of island sizes based on level." Both done.
- **Content moved from spawn-on-landing → WORLD-GEN**: pirates + chests are now DATA on each island record
  (`is.foes`/`is.chests`, seeded at `buildIsland` via `planIslandContent`), exist from the start, and are RENDERED
  so **you see them standing on the island from your boat** (verified by screenshot — figures with weapons + a chest
  on the terrain). Docking no longer spawns; it just switches to on-foot control of the already-present content.
- **Difficulty-scaled counts + island SIZE by level** (`islandCounts`/`islandRadiusFor`): Lv1 = 3 pirates/1 chest on a
  small (~r99) island near Tortuga; scales to Lv7 = 8 pirates/4 chests on a big (~r178) island far out; foe cap 9
  (never over-crowd); a couple of tougher **marauders** appear on Lv≥4. `scatterIslands` now places by
  `buildIslandLevelPlan` (ascending, easy-small-near / hard-big-far, each island body inside its level's ZONE belt).
  Verified: Gullrock Lv1 r99/311u 3p/1c … Coral Fang Lv6 r167/869u 7p/4c/2mar … Widow's Rock Lv7 r178/941u 8p/4c.
- **Lazy meshes + culling** (low-churn design): content meshes are scene-parented (world coords, so `stepFoot` is
  unchanged) and built once on first cull-in (`buildIslandMeshes`); `activateIsland`/`deactivateIsland` toggle
  visibility with the existing 1050u island cull; `stepIslandChars` idle-animates pirates only on NEAR islands
  (no AI at sea). `footFoes`/`footChests` kept as ALIASES repointed to `is.foes`/`is.chests` in `enterIsland` — so
  all the ashore combat/HUD/debug code is untouched. Removed `spawnAshore`/`clearAshore`.
- **Persistence + refill**: kills persist (dead pirate stays dead across leave/re-enter — verified 7→6→6); leaving
  sets `is.refillT = REFILL_SECS (180)`; the cull loop ticks it and regrows the island (`refillIsland`) after 3 min.
- Zero console errors. (`__PC__.islandsInfo()` added for verification.)
- **NEXT (queued, plan in workflow wffurp2kg):** [2] dock ZOOM-IN "into the island" (blend ship-cam→hero-cam, FOV
  50→42) + SCOUTING HUD (near an island, show "🔭 N pirates · M chests · [tier]" before docking); [4] battle vs
  exploration music crossfade. Also: wire Death/Attack clips to combat; brighten ashore lighting (foes read dark at dusk).

### 2026-07-03 (17) — Real animated character ROSTER: distinct hero / pirate / marauder / crew (owner ask)
Owner: "do we not have real animated 3d heroes for pirates/marauders?" — YES, we do. A 4-agent design/discovery
workflow (id wffurp2kg) found a full **CC0 Quaternius RPG cast** already local at
`forgeflow-games/pipeline/assets/3d-models/quaternius-rpg/GLB/` — all rigged, multi-clip, sharing one skeleton.
No more one-tinted-mesh-for-everyone.
- **Copied 5 animated GLBs** into `assets/props/`: `char-hero.glb` (Ranger — bow/melee, 14 clips), `char-pirate.glb`
  (Rogue — dagger/roll, 12 clips), `char-marauder.glb` (Warrior — sword brute, 13 clips), `char-crew.glb`
  (Cleric — 11 clips), `char-skeleton.glb` (Poly Pizza, reserved elite). All CC0 (credits added to content.json).
- **Multi-role loader**: replaced single `CHAR_URL`/`makeCharacter` with `CHAR_URLS{role}` + `_charGltf{role}` +
  `makeCharacterRole(role,targetH,tint)` — skeleton-clones the role's GLB, tints, seats/scales, and plays the **Idle**
  clip (falls back Walk/Run → clip[0]; missing GLB → falls back to hero role + `console.warn`, never throws).
  `makeCharacter` kept as a hero-role wrapper for existing callers.
- **Role assignment**: HERO = Ranger (no tint); foot **PIRATE** = Rogue (blood-red 0x8a1f1f, scale ~9); **MARAUDER**
  (a couple on Lv≥4 islands) = Warrior rendered **bigger (targetH 11.5, ~1.3× the pirate) + darker (0x5a0f0f) +
  tougher (1.6× hp, 1.5× dmg)** so "this one's harder" reads instantly; CREW = Cleric (blue ALLY_TINT). `foe.kind`
  is seeded/deterministic.
- **Verified (screenshot + numeric):** landed Wreckers' Cay (Lv7) → 2 marauders (160hp/17dmg, scale 3.84) + 4 pirates
  (100hp/11dmg, scale 2.97); screenshot shows a **hooded Ranger hero, an armored sword-wielding Warrior marauder
  (visibly bigger), a second foe, and a detailed treasure chest** — real RPG models, not blobs. Facing correct
  (HERO_OFF=0 holds for the Quaternius rig). Mixers advancing (animating). Zero console errors.
- **NEXT (designed, queued — plan in workflow wffurp2kg):** [1] PERSISTENT scoutable island content (pirates+chests
  live on the island from world-gen, visible from the boat, difficulty-scaled counts + island SIZES by level, refill
  on revisit) — the highest-value structural change; [2] dock ZOOM-IN "into the island" + scouting HUD (see counts
  before docking); [4] BATTLE vs EXPLORATION music crossfade (music_explore/battle.ogg from F:\Music, combat-state
  hysteresis). Also: wire Death/Attack clips to combat events (currently only Idle plays).

### 2026-07-03 (16) — FIX: animated away-party characters + visible pirates/chests on islands (owner bug report)
Owner docked and saw no character and no pirates/chests — the ashore experience was broken in practice (it had only
ever been "verified" via debug hooks + numbers, never by looking at the rendered scene). Two real bugs:
- **No animated character.** The hero/foes/crew were loaded via `kernel.loadGLTF` (a STATIC clone — frozen pose).
  The character GLB is actually a **Mixamo-rigged SKINNED mesh with a walk clip**, which needs SkeletonUtils cloning +
  an `AnimationMixer`. Added `makeCharacter(targetH, tint)`: imports `GLTFLoader` + `SkeletonUtils`, preloads the
  character GLB once (`preloadChar`), and spins up one independent animated instance per entity (own mixer, tinted,
  seated+scaled like `makeProp`), looping the clip. Hero/foes/crew now use it; their mixers are driven each frame in
  `stepHero`/`stepFoot`/`stepCrew`. Removed the old static `makeFoot` + `loadProp("hero")`.
- **Pirates/chests invisible.** They spawned across the whole island (`_isleSpot` 0.15–0.7r) — landing on inland
  HILLS at y≈28–44, far from where the hero drops on the beach (y≈1.9). Replaced with `_spotNear(is,cx,cz,minR,maxR)`
  that seeds content within 26–95u of the **hero's actual landing point**, so you see the pirates + chests right there.
  Bumped chest count (2+rand3) and gave pirates a stronger blood-red tint (0x8a1f1f) vs the blue crew (0x3a86ff).
- **Verified by LOOKING (not just numbers):** docked → screenshot shows the **animated yellow-green hero** with
  **red pirates walking toward it** (legs mid-stride; mixer time advances 73→79s = looping), "4 pirates · 3 chests"
  in HUD, content 43–62u from the hero; overhead shot confirms hero + pirates on the beach terrain. Zero console errors.
- **Lesson (logged):** debug-hook/`ashoreState` numbers said content existed, but it was off-screen/frozen — ALWAYS
  screenshot the real dock→ashore scene. Ties to the "verify real input paths" rule.
- NEXT here: distinct MARAUDER foe variant (tougher), idle-vs-walk anim gating, chest open anim.

### 2026-07-03 (15) — Owner corrections: DODGEABLE fire, dice damage, neutral Lv1-2, fire back on SPACE
Four owner-requested fixes on top of the broadside combat.
- **Cannon fire is DODGEABLE, not seeking** (`fireBall` helper, `HIT_RADIUS=15`): a shot is lofted at the target's
  **predicted** position (led by its velocity) plus a dice-quality scatter, then flies a **fixed** arc — it never
  homes. On impact it re-checks the target's LIVE position: it only connects if the target is still within
  `HIT_RADIUS` of where the ball came down, so **steering off your predicted course dodges it** — even a well-aimed
  (dice-hit) shot. Applies to BOTH player broadsides and enemy fire (so you can weave through incoming volleys).
  `fireBroadside` + `enemyFire` now route through `fireBall`.
- **Damage still rolls like D&D**: `rollShot`'s d20 to-hit / nat-1 miss / nat-20 crit / bell-band damage is unchanged
  and governs each ball's miss/crit/damage; the dodge is a *positional* gate layered on top (a dice-hit you evade
  becomes a splash). Scatter tightens with roll quality (crit 0u, hit 4u, miss 22u).
- **Levels 1-2 are NEUTRAL** (`hostile = level >= 3`): the near-start EASY belts (21 traders) no longer attack —
  only **Lv3+ attack on sight** further out. Verified: 0 hostiles at Lv1-2, 53 at Lv3+.
- **Fire is back on SPACEBAR** (owner: "not left click"): `onKey` SPACE fires (ashore hero-melee too); the pointer
  handler reverts to **left-click = inspect only**. HUD/title/aim-indicator text updated ("press SPACE to fire").
- **Verified via Preview MCP (numeric, loop live):** fired at a holding target → connected (d=2.3u, dice hit, 87 dmg);
  fired then yanked the target 220u away → **dice hit but connected:false, 0 dmg** (clean dodge); SPACE fires,
  left-click doesn't; Lv1-2 non-hostile. Zero console errors.
  - *Preview gotcha logged:* async ball resolution (`spawnShot` onLand) only runs while the rAF loop is live — the
    preview tab can **freeze rAF** (sim stops advancing, shots stick, screenshots time out). Confirm the sim is live
    (sample a moving npc's x across two evals) before testing anything asynchronous; **restart the preview server**
    to get a fresh active loop.

### 2026-07-03 (14) — BROADSIDE cannons + LEFT-CLICK fire (owner request)
Combat overhaul: ships fire from their SIDES, not the bow — you must turn to bring guns to bear. Designed via a
4-agent Workflow design panel (broadside mechanics / NPC AI / island biomes / larger map); this entry ships item [1].
- **Broadside arcs** (`relBearing`, `ARC_MIN=35°`, `ARC_MAX=145°`): a side "bears" only when the target's
  bearing off the bow is in [35°,145°] on that side — a wide abeam wedge with 35° dead zones fore & aft.
  Player + NPC will share this wedge. `relBearing(sx,sz,yaw,tx,tz)` returns signed bearing (>0 starboard, <0 port).
- **`playerFire` rewritten**: scans hostiles in `FIRE_RANGE`, sorts each into the port/starboard broadside that
  bears (or flags a dead-zone target), then fires each side whose reload is ready. **Independent port/starboard
  reloads** (`reloadTP`/`reloadTS`) — fire port, spin, fire starboard on a fresh timer.
- **`fireBroadside(side, hits)`**: a **4-ball VOLLEY** (`VOLLEY_N`) from muzzles spaced fore→aft along that beam
  (`GUN_SPAN`/`GUN_BEAM`), each ball rolled independently via the existing `rollShot` dice and cycling across the
  hostiles on that side; reuses `muzzle`/`spawnShot`/`burst`/`damageFlash`/`sinkNPC` verbatim. Cosmetic scatter/pitch
  use `Math.random()` (gameplay rolls stay on seeded `rng()`).
- **"Adjustment for the boat sailor"**: `fireFeedback` banners "↩ Bring your guns to bear — turn to point a SIDE at
  them" when a target's in range but no gun bears; plus a **live HUD aim indicator** — green "🎯 PORT/STBD guns bear
  — LEFT-CLICK to fire" vs orange "↩ Turn to bring a broadside onto the target".
- **LEFT-CLICK = fire** (owner: "not Space"): `pointerup` handler fires the bearing broadside at sea (and hero-melee
  ashore), then inspects the clicked ship — **fire runs first** so it never depends on the raycast. SPACE kept as a
  harmless alias. Title + HUD control text now say LEFT-CLICK.
- **Verified via Preview MCP (numeric):** starboard/port beam each fire a 4-ball volley consuming only that side's
  reload; bow-on = **0 shots** (dead zone → turn feedback); HUD indicator flips green↔orange (screenshots); a
  synthetic PointerEvent left-click fires when abeam and withholds bow-on. Zero console errors.
  - *Preview gotcha logged:* `preview_click` emits **mouse** events, not pointer events, so it never triggers the
    game's `pointerup` handler — use a synthetic `PointerEvent` (pointerdown+pointerup) to test clicks. Also the
    preview's game canvas backing store can be a degenerate size (70×683); trust `camera.project`/state evals over
    raw screenshots, and firing was reordered before `selectAt` because that raycast misbehaved on the tiny canvas.
- **Debug** (`__PC__`): `fireArc()` (per-target bearing + which side bears), `fire()` resets both reloads.
- **NEXT (designed, queued):** [2] NPC broadside AI (circle to present a side) + anti-bunching; [3] island biome
  variety (flat/mountainous/rocky/jungle/lagoon); [4] larger map (~SEA 1400, 9 belts, held to ~73 ships).

### 2026-07-03 (13) — Polish: crew roster panel, muzzle flash, hull damage-flash (+ facing/size verified)
Roadmap #1–#2 polish. Two potential bugs investigated and RULED OUT analytically; three feel features added.
- **HERO_OFF facing — verified CORRECT (no change).** Screenshots of the on-foot hero were inconclusive
  (tiny/low-contrast + the preview wedges), so verified by math instead: (a) camera-projection of the hero's
  world extent gives `ndcHeight≈1.71` — the character **fills ~86% of the frame** at chase distance, so the
  9u size is right (the "specks" in earlier ashore shots were **stale renders**, not a scale bug); (b) the
  hero geometry is perfectly **Z-symmetric** (feet & head both mean-Z 0) with its larger horizontal axis
  along Z (depth 3.2 > width 1.6), so the character walks **front/back-aligned, never sideways** → `HERO_OFF=0`
  holds. (Kept a `faceProbe(yaw,off)` debug hook + a `_probeHideShips` flag for future top-down checks.)
- **Crew roster panel** (`toggleRoster`, key **R**): a corner list of your hired hands with name · level · XP
  (or "hire at Tortuga" when empty). Re-rendered live on the HUD tick so XP/level updates show. HUD hint added.
- **Muzzle flash** (`muzzle`): a brief bright-yellow puff at the firing ship, biased toward the target, on
  every player + enemy cannon shot. Rides the existing `_fx` pool with a new `fast` flag (quicker decay,
  smaller expansion) so it reads as a flash, not a smoke cloud.
- **Hull damage-flash** (`damageFlash`/`stepFlash`): a ship pulses its hull **emissive red** for ~0.26s when
  a shot lands (player + NPCs). `makeShip` now collects each hull's emissive materials into
  `userData.hullMats`; the pulse decays k·red→0 each frame and returns cleanly to black (verified no stuck-red).
- Verified via Preview MCP: roster renders (3 crew, names/levels), muzzle spawns on fire (`fxProbe`), damage
  emissive applies proportional to flashT and decays to 0; a clean in-game screenshot shows the roster panel +
  minimap + correctly-scaled ship. Zero console errors. (`__PC__`: `roster()`, `fxProbe()`, `flashProbe()`, `faceProbe()`.)

### 2026-07-03 (12) — Title screen + difficulty-colored minimap
Roadmap #1 (final) done — the game now front-doors like a real arcade title and you can read the seas at a glance.
- **Title / attract screen** (`buildTitle`/`startGame`): the world boots straight into an **attract mode** —
  ocean + ships animate and the camera **slow-orbits** the docked ship at Tortuga (`titleCam`, 0.12 rad/s) —
  with a gold-serif "PIRATE'S COVE" overlay, tagline, controls, and a **▶ Set Sail** button on top (z 120).
  `gameStarted` gates ship input (`stepPlayer` freezes) and the SPACE/E/etc handlers until Play; **Enter or
  Space** also starts. Set Sail hides the overlay, resumes audio + starts music, and drops you into the chase cam.
- **Minimap radar** (`buildMinimap`/`drawMinimap`, a 150px corner `<canvas>` @ ~8fps): **player-centric**,
  north-up, `MM_RANGE 620`u → disc radius. Plots **Tortuga** (gold, outlined), **islands** (tan, sized by
  radius), and **nearby ships colored by difficulty tier** via the same `diffOf().hex` as the inspect ring
  (green/orange/red). The **player is a white arrow at center pointing along heading**. Shown only while
  `gameStarted && mode==="sail"` (hidden on the title + ashore).
- Verified via Preview MCP: title renders over the orbiting world (screenshot), Set Sail flips
  `started→true` + hides title + shows minimap (15k lit px) + starts music; radar plots all three tiers
  (at the docks only green/orange are in range — **no red near spawn**, confirming the zoning; sailing to
  r≈780 puts 5 red + 3 orange + 9 green on the radar). Zero console errors. (`__PC__`: `titleState()`,
  `play()`, `minimapPixels()`.)

### 2026-07-03 (11) — Audio: cannon/melee/sink SFX + looping ambient music
Roadmap #1 (SFX) done — the sea finally has sound.
- **WebAudio one-shot pool** (`initAudio`/`playSfx`/`sfxAt`): decodes each distinct `content.sfx` file once
  into an AudioBuffer, then plays via short-lived `BufferSource`s so shots **overlap** (a single `<audio>`
  element can't play itself twice at once — a whole broadside would clip). A master gain (0.6) sits over
  the SFX; a separate music gain (0.16) over the bed.
- **Autoplay-correct**: the `AudioContext` starts **suspended** and is `resume()`d on the **first key or
  click** (`resumeAudio` wired into `onKey`/`pointerdown`), which also kicks off the looping music. Missing
  or undecodable files **no-op gracefully** (each buffer is `null` on failure, warned once).
- **World-positioned SFX** (`sfxAt`): cannon fire, impacts, and sinks attenuate by distance from the
  listener (player at sea, hero ashore; audible within ~320u) with slight random pitch — so a distant
  firefight is a low rumble, not a wall of noise, even with dozens of ships.
- **Wired at**: player cannon fire (full vol) + hit/splash-miss on impact; enemy fire (quieter, range-fall)
  + hit/miss on you; ship **sink** (NPC via `sfxAt`, player louder); hero melee connect; crew melee connect;
  foe hits landing on hero/crew; a soft "sink" thud when any foot-combatant goes down.
- **Ambient music**: the bundled `assets/audio/music.ogg` (~35s) loops under everything at low volume.
  **`M`** toggles mute (music + SFX); HUD control hint updated.
- **Gotcha fixed in testing**: `assets/*` live at the GAME ROOT (like the GLBs `loadGLTF` fetches), so audio
  is fetched against `document.baseURI`, **not** `import.meta.url` (which pointed at `runtime/3d/` → 404 →
  all buffers "FAILED"). Only `runtime/3d/textures/*` resolve against the module.
- **Debug** (`__PC__`): `audioState()`, `audioResume()`, `playSfx(name,vol)`, `muteToggle()`. Verified via
  Preview MCP — all 5 buffers decode (cannon 2.6s / hit 0.36s / splash 0.16s / sink 1.49s / music 34.9s),
  ctx runs, music loops, each SFX + the integrated fire/sink paths play with zero console errors.

### 2026-07-03 (10) — Away-team crew: hired hands land ashore and fight beside you
Roadmap #1 (next) done — the crew you hire at Tortuga are no longer just a roster; they're a fighting party.
- **Land WITH you** (`spawnCrewParty` in `enterIsland`): each `player.crew` hand spawns as a bright-blue
  (`ALLY_TINT 0x3a86ff`) tinted hero-clone, fanned **inland + beside** the hero (spawning *behind* dropped
  them in the surf → all stacked on the hero's tile; forward is the dry side since the hero lands facing
  inland). Falls back just inland of the hero if a slot is water.
- **Follow + engage** (`stepCrew`): with no pirate near they trail the hero (`CREW_FOLLOW 17`); a foe inside
  `CREW_ENGAGE 80` makes them break off, close to `CREW_ATK_RANGE 26`, and strike on the **same d20 dice**
  (`rollShot`), `CREW_ATK_CD 0.7`s. Kills pay **you** the gold and the **crew member** XP.
- **Foes split aggro** — `stepFoot` now targets the nearest living party member (`nearestTarget`: hero or an
  up crew hand), not always the hero, via a shared `foeHit` that routes damage to whoever was aimed at.
- **Down + revive** — a crew hand at 0 hp goes `down` (hidden, out for the landing); they **revive to full
  back aboard** the ship (fresh `spawnCrewParty` each landing). Verified: leave+reland restores full hp.
- **Persistent leveling** — XP accrues to the roster member (`c.ref`, *not* the transient landing actor —
  the bug caught in testing), so a hand that fights well comes back tougher: verified One-Eye Jack Lv1→Lv3
  (55hp/13dmg → 75hp/19dmg) and Salt Meg Lv1→Lv2 across landings. `crewStats(cm) = {hpMax 45+lv·10, dmg 10+lv·3}`.
- **HUD**: ashore line now shows `🧑‍✈️ Crew up/total` (green when all up, red when some are down).
- **Debug** (`__PC__`): `giveCrew(n)`, `crewState()`, `crewFight(secs)`. Verified via Preview MCP — crew
  spawn spread on dry land, engage + clear pirates, earn gold + persistent XP, take split-aggro damage,
  revive full on reland; zero console errors.

### 2026-07-03 (9) — Tortuga shop: spend gold on repairs, ship upgrades & crew
Roadmap #1 done — gold now has a purpose, closing the economy loop.
- **Dock Tortuga (E) → Harbour Master shop** (`openShop`): a DOM modal over the scene; the ship freezes
  while it's open (`stepPlayer` zeroes throttle/steer on `shopOpen`; SPACE/fire suppressed). E or "⚓ Set
  Sail" closes it.
- **Purchasable (escalating cost, spends `player.gold`)**: 🛠️ Repair Hull (to full, cost scales with
  damage; disabled at full), 🛡️ Reinforce Hull (+25 max), 💥 Bigger Cannons (+4 dmg), ⛵ Better Rigging
  (+3 top speed), 🧑‍✈️ Hire Crew (+8 hull, adds a named hand to `player.crew`). `upg` tracks tiers so
  each buy costs more.
- **Crew roster** shown in the shop + a 🧑‍✈️ count in the sail HUD. (Crew fighting alongside you ashore
  is next.)
- **Verified (Preview MCP)**: opened with 500 test gold → bought hull (120→145), cannon (18→22 dmg),
  rigging (46→49 spd), crew (+8 hull, roster "Bess"), gold 500→305 with correct escalation; close
  restores sail controls; zero console errors. Screenshot shows the full "Tortuga — Harbour Master" panel.
- NEXT: away-team CREW follow you ashore + help fight; cannon/melee SFX (content.json sfx paths); a
  title/menu + minimap; tune HERO_OFF.

### 2026-07-03 (8) — Ashore combat + treasure (fight pirates on foot, loot chests, gold economy)
Roadmap #1 continued: the on-foot islands now have CONTENT.
- **Enemy foot-pirates** (`spawnAshore` on dock): 2–6 walkable pirates spawn on the island's dry land
  (`_isleSpot`), scaled up on harder (further-out) islands. Real model: the CC0 hero GLB tinted dark-red
  (`makeFoot`). They **aggro** within 135u, walk toward you over the heightfield, and **attack** in melee
  range on a cooldown — all on the same `rollShot` d20 dice as the ships.
- **Hero melee** (SPACE ashore): strike the nearest pirate within 30u (d20 to-hit, crit, damage band); a
  kill grants **gold + XP** (feeds the same ship level-up). Cleared on `leaveIsland`.
- **Treasure chests** (real CC0 `chest.glb`): 1–3 per island; walk within 14u to auto-loot **gold + XP**.
- **Gold economy** (`player.gold`) shown in both HUDs; ashore HUD now reads party HP, gold, live pirate +
  chest counts, and "SPACE attack". Party death (hero HP ≤0) returns you to the ship.
- **Balance pass**: party 60→**100 hp**, hero hit 15→**22** on a **0.5s** cooldown, pirate dmg 5+2·lv →
  **4+lv** on a slower **~1.9–2.9s** cooldown — so a swarm is winnable, not an instant wipe.
- **Verified (Preview MCP eval)**: dock → 6 pirates + 3 chests spawn; grabbing a chest gave +119 gold;
  melee killed a Lv7 pirate (100hp→dead, +26 gold +25 xp, foes 6→5); a real swarm dropped party HP
  100→39 (pirates attack) and wiped the party → auto-return to ship; HUD shows it all; zero console errors.
- NEXT: away-team CREW that dock ashore + help fight; Tortuga trade/upgrade/hire (spend the gold); cannon
  SFX; tune HERO_OFF facing. Assets (CC0, Poly.Pizza): Chest (O72u4Drp8k).

### 2026-07-03 (7) — LIVE cannon combat (D&D dice) + XP/level + sink/respawn
Roadmap #1: real-time naval combat reusing the Tide Breakers d20 dice.
- **`rollShot(nom, evasion, rangeFrac)`** mirrors `navalfree.js`: to-hit = clamp(3 + round(6·rangeFrac) +
  evasion, 2, 19) on a d20; nat-1 always misses, nat-20 always hits + crits (×1.5); damage is a
  bell-weighted band ±30% of nominal. Real-time, not turn-based.
- **Player fires with SPACE** (reload-gated ~1.0s; holding auto-fires) at the nearest hostile within
  `FIRE_RANGE=235`. A cannonball arcs to the target and resolves the roll on impact — orange burst on a
  hit (gold on a crit), blue splash on a miss.
- **Enemies fire back**: any hostile within range shoots the player on a ~2.6s reload. Player `gunDmg`,
  enemy `dmg = 6+4·level`, and hull `evasion` (Sloop 3 → Galleon 0) drive the dice.
- **Sink + XP + level-up**: a ship at ≤0 hull heels over, sinks, and after a delay **respawns in its own
  difficulty belt** (`respawnNPC`) so zones never empty. Kills grant XP (`6+5·level`); leveling up boosts
  hull, cannon, and speed (`gainXP`).
- **Death = respawn**: player hull ≤0 → back to the Tortuga docks at full hull (no permadeath).
- **Safe harbour is truly safe**: enemies don't fire while the player is inside `SAFE_R`, so the spawn
  can't be sniped.
- HUD now shows hull, **⭐ Level + XP**, live ship count, and "SPACE fire / ·reloading".
- **Verified (Preview MCP eval)**: fired a volley → kills → XP 0→21; enemy fire dropped player hull
  109→65; sunk ships respawned (dead count returns to full); safe harbour held hull at 120; and a forced
  hard-zone death respawned the player at the town docks (0,132) at full hull — all with zero console
  errors. Screenshot HUD confirmed "Lv 1 (11/35 xp) · 72 ships · SPACE fire".
- NEXT: on-island ashore combat (pirates to fight on foot) + treasure; away-team crew; cannon SFX;
  target-lock/broadside-arc polish.

### 2026-07-03 (6) — ON-FOOT island exploration (dock → walk ashore → return to ship)
Roadmap #1: press **E** to DOCK at an island and drop the away party ashore as a walkable character.
- **Sail ⇄ ashore mode** (`mode`): `tryDock` now branches — near an island it calls `enterIsland` (drops
  the hero on the beach nearest the ship, facing inland, ship anchored offshore); pressing E again
  `leaveIsland`s back aboard. Town still shows its trade/hire banner.
- **Walkable hero** on the heightfield: `stepHero` (WASD — A/D turn, W/S walk) moves the character over
  the terrain, ground height from the shared `_isleH` (islands now store their `ox/oz` noise offset so it
  can be recomputed off-mesh). Constrained to dry land (`_isleH > 0.6`) so you can't walk into the sea.
- **Real character model**: copied CC0 `hero.glb` (Poly.Pizza "Character_Man") into `assets/props/`,
  loaded like the island props; `makeProp` scales it to ~9u and seats it on the ground.
- **Third-person ashore camera** (`updateHeroCamera`) trails the hero; the update loop branches sail/ashore
  for stepping, camera, dock, and selection; island culling anchors on the hero when ashore so the island
  you're on never culls out.
- HUD switches to an "· ashore / Exploring <island> / WASD explore · E return to ship" panel.
- **Verified (Preview MCP)**: `forceAshore` → mode ashore, hero mesh present (1 mesh, 9u tall, on ground,
  visible), walked 190u following the terrain height and stopping at the waterline, camera follows, ashore
  HUD, zero console errors. Screenshot shows the character on the green island surface.
- NEXT on this feature: on-island CONTENT — enemies/pirates to fight ashore (ties into live combat + the
  away-team crew), treasure, optional caves; and tune the character's art-forward (`HERO_OFF`) if it walks
  off-facing. Assets (CC0, Poly.Pizza): Character_Man (IE7rk47BHn).

### 2026-07-03 (5) — BIG heightfield islands (rolling hills + real GLB palms/rocks)
Owner: current islands "look terrible and too small" — wants LuminaScape-style rolling-hill terrain,
big enough for a 30-60s+ on-foot explore. Rebuilt the islands:
- **Heightfield terrain per island** (`buildIsland` now displaces a subdivided plane by a smoothstep
  dome × 4-octave value-noise fbm → rolling hills; `_isleH` is the shared height fn used for both the
  mesh and prop placement). Vertex-coloured by height: **sand beach → grass → rock highland**. Corners
  dive underwater (hidden by the reflective Water) so it reads as a round island.
- **Much bigger + fewer**: radius **95-175** (was 24-60), **9 islands** (was 14-16), spaced ≥120u apart
  and kept out of the r<280 safe-harbour core. Verified radii 97-172.
- **Real GLB dressing** (no more primitive cones): copied 3 CC0 Poly.Pizza models into `assets/props/`
  — `palm.glb` (Quaternius Palm), `tree.glb`, `rocks.glb` — loaded once (`loadProp`) + cloned/normalized
  (`makeProp`, base-seated, scaled to a target height, no shadows) and scattered on each island's grass.
- **PERF**: island groups **distance-culled** (only drawn within ~1050u of the player; fog hides the
  rest), matching the ship culling; island props cast no shadows.
- **Verified (Preview MCP)**: 9 islands r97-172, 168 terrain+prop meshes, zero console/GLTF errors; two
  screenshots — a low-angle shore (rolling green hills rising from a beach) and a top-down (beach ring →
  green hills → grey rocky highland, with palms + rock formations placed on the surface). Foundation for
  the on-foot explore/away-team next.
Assets (all CC0, Poly.Pizza): Palm Tree by Quaternius; Rocks (XVRCQ0j2AF); Tree (2paAm1ja4w).

### 2026-07-03 (4) — Difficulty ZONING + anti-crowding (spread out, gradual, safe start)
Owner: "don't over-populate; if hard enemies are too close to start, players quit — there should be large
areas to explore of each category/level." Redesigned enemy distribution via a 3-lens design workflow
(concentric-rings / spacing-first / new-player-onboarding), then synthesized:
- **Ocean enlarged** SEA 900→1000 so the hard belts get real offshore room.
- **Concentric difficulty ZONES** (`ZONES` table) replace the old uniform scatter + steep 140u/level ramp.
  A **big safe core (r<240, NO enemies)**, then one wide belt per level to the rim: EASY/green r240-460,
  MEDIUM/orange r460-700, HARD/red r700-1000. **76 ships** total (down from 80), density ~half, decreasing
  outward. Each ship's level is stamped from its belt (never recomputed).
- **Even angular-slot placement + 110u min spacing** per belt (area-uniform radius, skip-don't-force) so
  spawns never clump.
- **Dynamic SEPARATION** in `stepNPC` (steer off any ship within 95u) — the key fix: spacing was spawn-only,
  so wandering ships re-piled (min gap had collapsed to 21u). Now they peel apart while sailing.
- **Belt LEASH** (`rIn/rOut` per ship, ±45u) keeps each ship in its tier so the gradient never smears and
  the safe core stays clear.
- HUD shows "Safe Harbor" in the core; `levelForDist` + `diffOf` now include a Safe (level 0) tier.
- **Verified numerically (Preview MCP eval)**: 76 ships, nearest enemy 228u (spawn 132u → 96u buffer),
  min inter-ship spacing 88u (was 21), first MEDIUM at 416u, first HARD/red at 659u (~527u from spawn),
  zero console errors. (Design panel: 3 agents / 182k tok / 2min.)

### 2026-07-03 (3) — Home port + 80 tiered enemies (difficulty by distance) + click-to-inspect
- **Home port TOWN "Tortuga"** (`buildTown`) at world origin: bigger island with a green, 11 pitched-roof
  cabins, a hill, and three wooden piers. It's a dockable hub (trade/upgrade/hire = placeholder banner
  for now) and the anchor point difficulty scales from. Player now **spawns at the docks** (0, town.r+48)
  bow to open sea. Town is added to `islands` so it's dockable + avoided.
- **80 enemy ships** (was 10; `content.setup.npc` 10→80). Each ship's **LEVEL scales with distance from
  town** (`levelForDist`: safe harbour to ~210u, then +1 level per ~140u, cap 7) — the sea gets deadlier
  the further out you sail. Level sets hull type (Sloop/Brigantine near shore → Pirate Cutter → Marauder
  Galleon far out), HP (45+30·lv), damage (6+4·lv), and hostility (deep water = all hostile). Verified
  histogram: Lv1:2 Lv2:14 Lv3:20 Lv4:13 Lv5:16 Lv6:9 Lv7:6.
- **Click a ship to inspect** (`selectAt` via `kernel.pickAt`): a colour **difficulty ring** drops under
  it (green Easy ≤Lv2 / orange Medium Lv3-4 / red Hard ≥Lv5) + an **info card** shows type, level, tier,
  hull HP bar, and damage. HUD also shows current **Waters** danger (tier + level + distance from Tortuga).
  Verified via screenshots: "Pirate Cutter Lv3 Medium (orange)" and "Marauder Galleon Lv7 Hard (red)".
- **PERF (important — a big scene now)**: 80 full ship GLBs + the reflective Water (which re-renders the
  whole scene each frame) + a large island/town scene overwhelmed the preview's software GPU. Fixes:
  (a) **distance-cull ships** — only draw ships within ~850u of the player (fog fully hides the rest, so
  no pop); the other ~55 still simulate but aren't drawn (or reflected). (b) **on-demand shadows**
  (`shadowMap.autoUpdate=false`, refresh ~3×/s) instead of a full shadow pass every frame. (c) island
  decor (mounds/rocks/palms) no longer cast shadows. (d) linear fog (300→820) as the cull horizon. NPC
  hulls already skip the shadow pass. NOTE: the headless preview GPU is very weak — `preview_screenshot`
  still times out on the full scene there and needed most ships hidden to capture; a real GPU renders
  this trivially. Consider ship LOD / instancing if weak real devices struggle.

### 2026-07-03 (2) — Pirate's Cove: bow-first fix + NPCs no longer dead-in-the-water
- **Renamed** Marauder's Sea → **Pirate's Cove** (owner choice): dir, slug, title, HUD banner, `__PC__` hook.
- **SHIP FACING BUG (owner: "ship is horizontal, not facing STRAIGHT")** — the ship sailed BROADSIDE. The
  GLBs are modelled with the bow along local **+Z**, so `rotation.y = yaw` already points the bow along
  the heading; the earlier `BOW_OFF = -PI/2` rotated it 90° off. Fixed → `BOW_OFF = 0`. Verified with a
  top-down debug cam: at yaw=0 (sailing +Z) the bowsprit now leads screen-down (travel), hull long-axis
  aligned with travel. Applies to player + NPCs (same faceYaw path).
- **NPCs "dead in the water" BUG** — the old edge/land handler froze position and multiplied speed ×0.6
  every contact frame, so any ship that touched land/edge decayed to ~0 and wedged forever. Rewrote
  `stepNPC` with LOOK-AHEAD avoidance (probe a point ahead scaled by speed; steer toward open water and
  turn 2.4× harder BEFORE arriving) + a hard **speed floor (min 6)** so they always make way. Verified:
  all 10 NPCs cruise 15–25 kn, and moved 230–460 units over 5s (0 stalled).

### 2026-07-03 (1) — Foundation (as "Marauder's Sea"/"Corsair's Reach")
Real-time sailing (throttle/rudder, momentum, chase cam), reflective ocean (900-unit sailable half-extent),
10 wandering NPC ships (7 hostile), 14 scattered islands with dock-proximity prompts, live HUD. Fixed a
waterline bug (hulls were centred on y=0 so only masts showed above the reflective water → seat the keel
with a shallow draft, `size.y*0.13` capped at 3.2). Booted clean, zero console errors.

## ROADMAP (the `/goal`, on `/loop`)
1. **Bigger EXPLORABLE islands** (owner: current islands "look terrible and too small"). Replace the small
   procedural mounds with LARGER landmasses like LuminaScape's opening (rolling-hill heightfield terrain,
   maybe caves). Dock → drop onto the island and explore **30–60s+ on foot** (bigger if enemies present).
   Consider porting LuminaScape's chunked-heightfield gen and real F:\ island/palm/rock assets.
2. **Live cannon combat** — broadside fire on a reload cooldown, resolved on the Tide Breakers d20/damage-
   band/crit dice; hostile marauders close + fire back; hull damage, sinking, wreckage. **Ship-fight wins
   grant XP.**
3. **Away-team + crew** — rescued/recruited crew **dock WITH you** onto islands to fight pirates/marauders
   on foot and **gain experience**; crew buff the ship (reload, hull, speed, lookout range).
4. **Death = respawn** (no permadeath) — the player (and away-team) respawn on death.
5. Title/menu + pause + minimap, then first arcade deploy under slug `pirates-cove`.
