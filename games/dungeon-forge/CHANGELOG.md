# Dungeon Forge — CHANGELOG

## v1.14.1 — 2026-07-13 (wall-drag: gap-free runs + clean corners)
- **Wall tool no longer leaves gaps.** The drag used to place a single edge per
  pointer sample, so a quick drag skipped segments and corners didn't close (you
  had to go back and fill them in). It now INTERPOLATES — every edge between samples
  is filled — and a corner extends the old run into the junction, then starts the
  perpendicular run from that same grid corner, so L-shapes turn smoothly in one
  stroke. Edges are deduped across the drag; the stairs-block warning shows once.

## v1.14.0 — 2026-07-13 (12 new prebuilt delves + 6-floor support)
- **12 procedurally-authored "by players" dungeons** added to the play carousel
  (now 17 total): 3–6 floors each, Diablo-grade density — 22–73 levelled enemies,
  9–27 traps, 10–19 chests, 24–66 decor, hazard pools, a merchant, and a high-level
  boss on the deepest floor. Enemy levels scale with depth (elites at +2–4, boss at
  +5–8) so the new threat-colour rings actually mean something. Deterministic per
  seed; every one passes validate + boots clean in the node selftest.
- **6-floor dungeons**: raised `MAX_FLOORS` 5→6 (all usages scale off the constant),
  so both prebuilt delves and the builder now go up to 6 floors deep.

## v1.13.0 — 2026-07-13 (enemy levels + threat colours + combat rebalance)
- **Enemy LEVEL system**: every enemy has a `level` (builder-settable in the enemy
  panel; default scales with dungeon difficulty + floor depth). Level inflates
  hp/dmg/xp (hp +35%/lvl, dmg +18%/lvl), so a high-level foe is a real wall — e.g. a
  level-12 skeleton is 291hp/38dmg vs a level-1's 60hp/13dmg, and a fresh player needs
  ~27 bolts to drop it.
- **Threat-colour con ring**: each enemy shows a ground ring coloured by (its level −
  your level): green (way below) → white (neutral) → yellow (a bit above) → orange
  (clearly above) → red (deadly, pulsing). Reads at a glance whether a fight is safe.
- **Combat rebalance**: base player damage cut ~28% (melee arrays, bolt, specials,
  frost) so early kills take work; it scales back up through combatMul, whose
  per-level bonus was steepened (0.04→0.06) so spells/attacks visibly grow as you level.
- **Slower leveling**: XP curve stretched (baseXp 45→80, growth 1.35→1.45) — far fewer
  levels per dungeon.

## v1.12.1 — 2026-07-13 (FX + visual polish batch)
- **Fire-jet trap**: real-fire particle FX — layered flame tongues colour-graded by
  distance (white-hot core → yellow → orange → smoke), buoyant lift, rising embers.
- **Javelin trap**: the launched dart is now clearly visible — bigger shaft + a
  glinting steel head + red fletching, a warm point-light, a dust flight-trail, and
  a launch puff of chips down the firing dir.
- **Player character**: killed the Meshy GLB's self-lit WHITE emissive that showed as
  odd glowing blobs on the hands/face — scene lights now shade her normally.
- **Debug overlay**: F3 now opens a proper multi-line TOP-LEFT dev panel (FPS+low,
  draws/tris, geo/tex/dpr/quality, player pos/floor/hp/lvl/mana, foes+chasing, time),
  separate from the plain bottom-right FPS counter.
- **Enemy animation**: raised the skeleton-freeze cull 45u→80u so visible enemies (e.g.
  the ogre across a room) keep animating instead of GLIDING; procedural step-bob
  fallback added for any genuinely clip-less walker.

## v1.12.0 — 2026-07-13 (combat behavior: pack aggro, persistent chase, hard auto-target)
- **Group aggro**: damaging one enemy (incl. a ranged bolt into a crowd) now wakes
  its nearby friends (within 5 cells, same floor) onto the same attacker via a new
  `alertPack()`; also fires on first-sight. Shoot into a cluster → the cluster wakes.
- **Persistent pursuit**: removed the old home-leash (enemies used to give up after
  ~12 cells from spawn). Aggroed enemies now A*-path the whole way to the player and
  only disengage if the target is very far AND out of sight.
- **TAB hard auto-target**: with a TAB-locked enemy, every spell/attack now aims
  directly at it regardless of camera facing (was a narrow soft-assist cone). The
  soft cone still applies to the auto-picked (un-locked) target.

## v1.11.2 — 2026-07-13 (chest lid animation + enemies count badge)
- **Chest open animation**: chests are now a procedural model (`makeChest`) whose
  **lid is a separate group hinged at the back-top edge**. Opening eases only the
  lid up-and-back (~0.35s, frame-rate independent) instead of tilting the whole
  chest over. Already-looted chests render pre-opened on (re)join. `chest` decor
  also uses the new model.
- **Enemies HUD**: replaced the per-type remaining-enemies list with a single
  compact **count badge** (top-left) — "👹 Enemies left N", turns green "Clear!"
  when the floor is cleared and the exit unlocks.

## v1.0 — 2026-07-07
Initial release.
- **Builder**: cell-grid painting + room stamping across up to 5 floors, doors with
  a per-door 🔒 lock toggle, keys placeable on the floor / inside chests / on
  enemies, stairs that auto-cut their landing, chests, spike + vent traps,
  torches/neon lights with color presets, themed decor, spawn + exit portal,
  live solvability checker (key/lock flood-fill).
- **Two themes**: Classic Fantasy Dungeon (Kenney modular dungeon kit; skeletons,
  spiders, zombies, ghosts, slimes, orc brutes, demon lord) and Sci-Fi Robot
  Facility (Kenney modular space kit; drones, security bots, androids, plasma
  turrets, war mechs, hive alien).
- **Escape mode**: third/first-person controller, melee + mana bolts, enemy AI
  (patrol → LOS aggro → A* chase → attack), traps, chest loot by difficulty
  (gold/potions/energy/charms), locked doors consuming keys, multi-floor stairs,
  exit portal with run timer, deaths + respawns, results screen.
- **Multiplayer** (Supabase Realtime relay, NetPlay transport): 4-letter room
  codes; real-time co-building with shared ops + live peer cursors; co-op escape
  with owner-authority players @10Hz, host-authority enemies @7Hz, relayed world
  events, drop-in late joins with full keyframe (build) / world snapshot (play);
  host migration by lowest peer id.
- **Sharing**: localStorage saves, URL share codes (deflate + base64url), cloud
  publish under short codes with per-dungeon fastest-escape leaderboards
  (migration 0006, tables df_dungeons/df_scores).
- **Selftest**: `node runtime/sim/dungeon.selftest.cjs` — 56 assertions over the
  model, ops determinism, solvability, escape sim combat/keys/traps/exit.

## v1.1 — 2026-07-07 (same-day major update)
- **Original Meshy-generated player party** (replaces reused rigs): Knight,
  Barbarian, Sorceress, Rogue — AI-generated, auto-rigged 24-joint humanoids
  with Walk/Run clips (armature-retargeted); Idle from bind clip; attack/hit/
  death as procedural bone overlays. Textures repacked to 1024px (~750KB/char).
- **Visible equipment on bones**: chest loot now drops weapon upgrades (tier
  I-III, +12% dmg each, weapon grows + tints bronze/steel/gold in the RightHand
  bone) and armor (tier I-III, 10% soak each, chest plate + shoulder pads on
  Spine02) — visible to co-op partners over the wire (pst carries tiers).
- **Terrain cells**: LAVA (burns 10/tick through i-frames, embers, glow), WATER
  (55% wade speed, translucent animated sheet) and RAISED platforms (+1.1u,
  auto step-wedges at every lower edge; players/enemies smooth-step up/down).
  Painted with 3 new builder brushes; syncs in co-build; minimap colors.
- **D&D-style combat feedback**: soft target lock (facing cone) with red ring
  under the target + top-center enemy plate (name, HP x/y), floating damage
  numbers (gold = yours, red = incoming, armor math visible), slight aim assist.
- **Industry-standard settings** (persisted): music/SFX volume, mouse
  sensitivity, invert Y, quality (bloom/pixel-ratio), FPS counter — gear icon
  in menu + builder + Esc pause overlay (resume/settings/quit).
- **Proper main screen**: key-art background with slow zoom + dark vignette.
- **Big-map performance**: nearest-10 torch light gating + distance-gated enemy
  mixers — 30-room / 808-cell / 10-enemy map at 0.83 ms/frame (was 34 ms).
- Cloud tables df_dungeons/df_scores are LIVE (migration 0006 applied via
  Management API) — publish codes + global leaderboards fully working.
- Selftest grown to 91 assertions: terrain, targeting, equipment, 1/10/20/30-room
  scale + solvability, full 13-enemy roster kill tests (both themes).

## v1.2 — 2026-07-07 (classes + real combat FX)
- **Four playable classes** picked on the main menu, each a distinct kit:
  - Knight — sword + round shield (blocks 45% frontal), RMB shield bash (stun)
  - Barbarian — two-handed war axe, heavy combos, RMB Crush (2.2× finisher)
  - Sorceress — fire bolt (burn DoT) + frost bolt on R (slow), staff w/ glow orb
  - Rogue — dual daggers, fastest attacks, stacking poison (to 3 stacks)
- **3-hit combo system**: LMB chains stage 1 → 2 → finisher within the combo
  window; each stage its own damage + its own Meshy animation clip; combo
  counter in the HUD.
- **Real Meshy combat animations** (library action ids → clip-only GLBs,
  ~50KB each, retargeted by the shared 24-joint skeleton): slash1/slash2/
  finisher/parry/cast1/cast2/hit/death per class — no more weak procedural
  swings. 21 clips generated via pipeline/meshy_anims.py.
- **Class weapons on bones**: procedural 2H axe / arcane staff+orb / daggers,
  knight shield on the left hand — all tier-tinted, synced to co-op peers.
- **High-quality elemental FX** (layered particles + flash lights + auras):
  fire (embers + smoke + orange flash + burning aura), frost (ice shards +
  blue flash + material freeze-tint + drips), poison (green splash + bubbling
  aura), shield-bash/crush shockwave rings + camera shake; colored floating
  damage numbers per element (orange burn / green poison / cyan frost / gold).
- **Enemy status effects**: burn & poison DoT (poison stacks), frost slows
  movement + tints the enemy icy, bash/crush stun freezes their AI.
- Selftest → 101 assertions (adds class combos, bash stun, shield block,
  burn/frost/poison, barbarian crush). Event-path harness confirms every
  class emits the render events the FX layer consumes.

## v1.3 — 2026-07-07 (idle fix + merchants)
- **Fixed the "arms-out" A-pose**: generated a real neutral IDLE animation
  (Meshy action 0) for all four classes — they now stand naturally with arms
  at their sides in the menu 3D preview AND in escape mode (was the base bind
  pose). Clip-only GLBs (~70KB each) retargeted on the shared skeleton.
- **Merchant / NPC system** — the dungeon builder can now place vendors:
  - New 🛒 Merchant tool; procedural market stall + shopkeeper + coins + awning.
  - Click a placed merchant to toggle what it sells (potions, energy, weapon
    upgrade, armor upgrade, damage charm — each priced in gold).
  - In escape, walk up and press **E** to open the shop; buy with gold you find
    in chests (players now start with 40 gold so the opening vendor is usable).
    Purchases grant/equip immediately and show on the character.
  - Featured sample dungeons place a starter merchant by the entrance.
  - Merchants are solid; stock persists through save/share; MP-safe.
- Selftest → 111 assertions (adds merchant placement, solidity, stock
  roundtrip/edit, buy flow, gold/tier caps).

## v1.3.1 — 2026-07-07 (menu preview scale fix)
- **Fixed the menu 3D class preview rendering a giant head-only close-up.**
  CharPreview scaled off `Box3.setFromObject`, which reads a Meshy skinned
  rig's degenerate bind bounds → tiny measured height → model blown up ~15×.
  Now poses the idle clip and measures BONE world positions (the same path the
  in-game actors use), so all four classes show the full figure on the pedestal.
  Verified live in-browser: Knight/Barbarian/Sorceress/Rogue all frame correctly.
- Full in-browser verification pass (Chrome MCP): weapon parents to RightHand
  (Δ0), shield to left hand, armor (plate + 2 pauldrons) to Spine02; merchant
  stall renders, E opens the shop, buy deducts gold with live affordability
  gating + max-tier reject; builder places merchants and the per-vendor stock
  toggle panel works.

## v1.3.2 — 2026-07-07 (arms-down idle — real fix)
- **The A-pose "arms flung out" is finally fixed.** Investigation (live bone
  measurement + FK on the whole Meshy idle library) proved the problem was NOT
  a missing clip: the auto-rig bound every character in an A-pose and ALL of
  Meshy's idle presets (0, 11, 12, 243, 336, 338, …) keep the arms out (hands
  land ≥0.9 torso-heights from the body). Swapping the action can't fix it.
- New `relaxArms()` in assets.js rotates the upper-arm/forearm bones so the arms
  hang at the sides (hands drop from +0.2 above the hips to −0.25 below, radial
  1.14→0.6). Applied every frame after the mixer runs — in the menu 3D preview
  (always) and in escape (fades in only while standing idle, so walk/attack
  clips read normally). Weapons/shields ride the corrected hand bones, so they
  now rest naturally at the character's side instead of sticking out.
- Verified live across all four classes in the menu preview.

## v1.3.3 — 2026-07-07 (real combat animations actually play)
- **Fixed: attacks were using the crude procedural swing, not the Meshy combat
  clips.** `_makeActor` only registered idle/walk/run/death in `a.actions`, so
  `_playCombat`'s lookup of C_slash1/C_slash2/C_finisher/C_parry/C_melee/
  C_cast1/C_cast2/C_hit always missed and fell back to `_procStart`. The v1.2
  clips were loaded on the template but never bound. Now every `C_*` clip is
  registered — verified live: knight LMB plays C_slash1→C_slash2→C_finisher
  (real sword swings), confirmed on screen mid-slash.

## v1.4 — 2026-07-07 (roster expansion — library enemies)
- **+6 enemies from the CC0 creature library** (Quaternius, gltf→glb→texture-shrunk):
  - Fantasy: Imp (fast harasser), Myconid (tanky mushroom), Cyclops (brute).
  - Sci-Fi: Ooze Alien (blob), War Bot (mech), Xeno Brute.
  Each has idle/walk/run/attack/death/hit clips mapped via creatureClips; per-type
  render heights tuned. Verified live: all 6 load, animate, chase, and deal damage.
  Roster now 10 fantasy / 9 sci-fi. Builder enemy picker auto-lists them.
- Selftest → 117 (roster kill-tests auto-cover the new enemies).
- (Original Meshy-generated enemies — cultist/ogre/cyborg/sentinel — generated,
  integration in progress.)

## v1.4.1 — 2026-07-07 (critical: entry crashes + can't-enter-builder + retaliation)
- **FIXED the "can't enter builder" blocker**: menu-triggered modals (the Build
  and Play pickers) opened *inside* the HUD stacking context (z=20), which the
  menu overlay (z=30) painted over — so the picker was invisible and unclickable.
  Raised the HUD layer above the menu (still pointer-events:none, menu stays
  clickable). Build/Play/host pickers now appear. Verified live.
- **FIXED the KeyW TypeError flood** (image 4): escape AND builder read
  this.keys/this.camDist in update() before the async enter() ran _bindInput().
  Now input/camera state is initialized in the constructor and update() is gated
  behind a `ready` flag set at the end of enter(). No more per-frame crash.
- **Enemy retaliation**: any hit now aggros the enemy onto its attacker — a
  projectile from across the room or a no-line-of-sight sneak strike provokes it
  (previously only proximity/LOS aggro'd). Close-range aggro widened to ~1 cell.
- **+4 original Meshy enemies** (cultist/ogre · cyborg/sentinel) — rigged
  humanoids with walk/run + relaxed idle; roster now 12 fantasy / 11 sci-fi.
  Selftest 121.

## v1.4.2 — 2026-07-07 (builder UX: undo, drag-move, room preview)
- **Undo / Redo**: ↶/↷ buttons in the top bar + Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z).
  Snapshot-based, one step per gesture (a whole paint-drag or room = one undo).
  Verified: place→undo→redo round-trips exactly.
- **Select → drag to move**: pick an object with Select, then drag it to any
  floor cell (objEdit now allows x/z). Verified: chest relocates live.
- **Room live preview**: dragging the Room tool now shows a translucent rectangle
  of the exact area before you release, so you see what you're stamping.
- Hint bar updated; Room vs Floor now clearly distinct (Room = drag a whole
  rectangle, Floor = paint individual cells/corridors).

## v1.4.3 — 2026-07-07 (builder /loop batch 1: favicon, Floor=drag-rect, starter)
- Favicon added (emoji SVG data-URI) — clears the two favicon.ico 404s.
- **Merged Floor + Room**: the Floor tool now drags a rectangle (single click =
  one cell) with a live preview; the separate Room tool is removed. Verified:
  a 3-cell drag fills a 3×3 area.
- Starter dungeon spawn + exit now sit at OPPOSITE corners (7 cells apart), not
  lined up — and both are draggable.

## v1.4.4 — 2026-07-07 (/loop batch 2: floors, chest texture, stairs)
- **Multi-floor clarity (D)**: when editing a floor, the floor below now renders
  as a faint 14%-opacity ghost (its lights off) instead of a full-opacity layer
  stacked right under the current one. Verified: floor-below opacity 0.14 vs 1.0.
- **Untextured chest fixed (G)**: chest + crate/candles/coffin/debris/lantern/
  pillar (and sci-fi cables) referenced an external Textures/colormap.png that
  wasn't bundled in the props folder — so they rendered white/untextured. Copied
  the kit's colormap into props/{theme}/Textures/. Verified: chest hasMap → true.
- **Stairs verified (F)**: walking onto a stairs cell climbs to the next floor —
  confirmed live (player floor 0 → Floor 2/2 at the landing by the exit).

## v1.4.5 — 2026-07-07 (/loop batch 3: lighting, templates, share-code)
- **Proper dungeon lighting (4)**: raised ambient (0.62→1.0) with a warmer color,
  hemi (0.35→0.62), torch reach (range 13→18, decay 1.7→1.35, intensity 26→38),
  and thinned the fog (0.030→0.016). Dungeons are readable now while staying
  moody — verified live (floor/walls/torch glow all visible vs near-black before).
- **More starter templates (B)**: the New Build modal now offers 3 layouts ×
  2 themes — Blank Room, Twin Halls (2 rooms + corridor), Two Floors (stairs).
  All 6 verified solvable.
- **Share-code clarity (C)**: relabeled the import field ("Have a share code from
  a friend? … edit their dungeon") so its purpose is obvious.

## v1.4.6 — 2026-07-07 (/loop batch 4: NPC types)
- **Merchant → NPC with variety (J)**: the builder tool is now "NPC" with a type
  picker. Three roles, each a distinct interaction on E:
  - 🛒 Merchant — general store (editable stock of consumables/upgrades).
  - ⚒ Blacksmith — weapon & armor upgrades only, 15% off (70→60g). Verified.
  - 📜 Sage — one-time +25 max-HP blessing per run (no modal). Verified: HP 85→110.
  Distinct badge + light tint per type in builder and escape; selection panel has
  a type dropdown (stock toggle only for merchants). Selftest → 129.

## v1.4.7 — 2026-07-07 (/loop batch 5: Props toolbar consolidation)
- **Consolidated Key/Chest/Trap/Light/Decor under one "🎁 Props" category (I)**:
  the top toolbar drops from 17 tools to 13. Clicking Props opens a sub-palette
  (Chest · Key · Trap · Light · Decor); each still has its own deeper options
  (trap type, decor prop). Verified: toolbar has no standalone chest/key/trap/
  light/decor, Props picker shows all five, placing works.

## v1.4.8 — 2026-07-07 (/loop batch 6: real lava/water shaders)
- **Real Three.js lava & water shaders (part of 2)**: replaced the flat emissive/
  translucent boxes with custom ShaderMaterials. Lava flows — hot orange/yellow
  veins over a dark crust with a gentle pulse; water ripples with moving glints
  and view-angle fresnel transparency (world-space UVs so pools tile seamlessly).
  Animated via uTime in both escape and builder. Verified live: both compile and
  render beautifully. (The lava/water→Floor-subtype toolbar move ships with the
  raise/rolling-terrain work in the next slice.)

## v1.4.9 — 2026-07-07 (/loop batch 7: Floor sub-types + rolling terrain)
- **Lava/Water/Raised out of the top toolbar (2+3)**: the Floor tool is now a
  category with modes Floor · Lava · Water · Raise · Lower. Top toolbar drops to
  10 tools. Floor/Lava/Water drag-fill a rectangle with the chosen surface;
  Raise/Lower sculpt cell height by dragging.
- **Smooth ROLLING terrain (3)**: per-cell height LEVELS (raise/lower, clamped
  −3..+5) replace the binary raised platform. The elevated region renders as a
  continuous heightmap mesh with corner-averaged, subdivided, sloped transitions
  — no more voxel blocks. Player/enemy surface height now follows cellHeight
  (smoothed by the existing step lerp). Legacy raised platforms auto-upgrade to
  the rolling mesh. Verified live: a raised region reads as a smooth mound.
  Selftest → 137 (raise/lower levels, clamp, serialize roundtrip, cell- clears).

## v1.5.0 — 2026-07-07 (/loop batch 8 — final: doors-on-walls + solvability fix)
- **Doors auto-orient to their doorway (1)**: a new neighbour-derived `doorAxis()`
  replaces the stored-rotation logic everywhere (solvability flood-fill, escape
  collision, and rendering). A door now always lets you through ALONG its corridor
  and blocks only across its wall — regardless of the rot it was placed with.
- **Fixed the solvability + collision bug**: an UNLOCKED door dropped mid-corridor
  used to break the flood-fill ("exit not connected") because its rot didn't match
  the corridor. Now unlocked doors are passable along the doorway; locked doors are
  a keyed frontier as before. Verified live: rot-0 door in an E-W corridor →
  solvable, and the gate renders as an archway spanning the passage (in the wall,
  not floating at a tile centre). Selftest → 142.

—— With this, every item from the builder-feedback pass is done (v1.4.1 → v1.5.0). ——

## v1.6.0 — 2026-07-09 (/loop2 batch 1: +17 creatures)
- **Roster nearly doubled** (~19 → 40 enemies). +12 fantasy: Cave Bat, Floating
  Skull, Wisp, Cave Toad, Cactoro, Gargoyle, Shadow Ninja, Spawn of Cthulhu,
  Tribal Brute, Yeti, Giant, Young Dragon (mini-boss). +5 sci-fi: Xeno Drone,
  Void Floater, Strike Mech, Warframe, Xeno Brute. All CC0 Quaternius/Kenney
  (gltf→glb, textures shrunk), with idle/walk/attack/death/hit clips.
- creatureClips now also maps flying/hover/fly/bite/cast clip names, so flyers
  (bat/wisp/gargoyle/dragon/xeno drone/floater) animate + hover.
- Per-type render heights tuned. Verified live: all 12 new fantasy enemies render
  with valid bounds + mixers + full action sets. Selftest → 159 (auto kill-tests).

## v1.6.1 — 2026-07-09 (serious animation pass: arms-at-side locomotion)
- **Fixed the persistent "arms flung out" pose while MOVING.** Diagnosis (measured
  every clip's arm bones in-engine): Meshy auto-rigged every clip in an A-pose, so
  idle, walk AND run all land at radial ≥0.9 torso-heights with hands at hip
  height. The old `relaxArms` correction only ran while standing still — the moment
  the hero walked, the arms flared back out (this is what the screenshots showed).
- Now `relaxArms` runs EVERY frame across idle/walk/run (fades to 0 only during
  attack one-shots so the swing clips play unmodified), plus a procedural gait
  arm-swing (world-right-axis rotation synced to stride) so walking/running still
  reads as motion. Verified live: idle rR 0.68 / hands below hips (vR −0.26);
  walk relaxW 1.0 with gait swing (rR 0.56↔0.69); run swings too.
- Same continuous-relax + gait applied to the 4 Meshy enemies (cultist/ogre/
  cyborg/sentinel) which shared the A-pose. Attack clips verified as real swings
  (C_slash1 overhead vR 1.09, C_finisher two-hand smash vR 1.38 — not crossed).

## v1.6.2 — 2026-07-09 (NPCs rebuilt as distinct 3D figures)
- **Replaced the one-size-fits-all merchant stall** (used for all 3 NPC types +
  a floating emoji) with `makeNpc(ntype, theme)` — a real hand-built figure per
  type, theme-swapped fantasy/sci-fi, each on a round base station:
  - **Merchant**: robed trader w/ cap + sash, a coin counter (stacked gold coins
    + goods sack), coin pouch in hand. Icon changed 🛒 → 🪙 (no more cart).
  - **Blacksmith**: burly, leather apron, cap, hammer in hand, an anvil (horn +
    waist + foot) with a glowing forge ember + warm light.
  - **Sage**: taller hooded robe, white beard, a tall staff topped with a glowing
    crystal, and a floating open tome. Violet emissive glow.
- Wired through escape.js + builder.js (both call makeNpc); verified all 3 render
  distinctly in the builder with correct per-type props + tint. Selftest 159.

## v1.6.3 — 2026-07-09 (NPC visual overhaul — stylized flat-shaded figures)
- **makeNpc fully re-crafted** after owner feedback ("not polished, visually
  displeasing"): flat-shaded stylized low-poly look, lathe-curved robes with
  cinched waists + flared hems, gold trim (hem/collar/cuffs/belt buckle), real
  faces (eyes, brows, nose), mitt hands, posed asymmetric arms with held items.
- **Merchant**: feathered cap w/ gold band, short beard, coin offered in the
  right hand + ledger in the left, patterned canvas-texture rug (gold diamond
  border), draped counter w/ trim, stacked coins, working-look brass balance
  scale, iron-banded strongbox, goods sack.
- **Blacksmith**: red bandana, dark beard, leather apron w/ straps + pocket,
  gloves, hammer, stone slab strewn with coals (some glowing), stump-mounted
  anvil with a GLOWING hot iron bar, tripod brazier with molten embers, quench
  bucket. Icon ⚒ → 🔨 (⚒ rendered as a giant black glyph sprite).
- **Sage**: open-faced cowl (face + beard visible; peaked hood sits back),
  brighter layered violet robe w/ pale trim, long white beard, gnarled crystal
  staff (gold claw, glowing octahedron), floating tome above the open palm,
  orbiting arcane shards, glowing runic circle base (canvas texture, 16 runes).
- Badges shrunk + raised (escape 1.1→0.8 @3.2, builder 1.4→0.9 @3.35) so the
  icon no longer dwarfs the model. Sci-fi variants recolored (steel/cyan/holo).
- Verified all 3 live from the front in-browser; selftest 159 green.

## v1.6.4 — 2026-07-09 (builder UX: toolbar order + hotkeys + selection)
- **Toolbar reordered** (owner request): placement tools first, then Select &
  Erase at the END just before the Exit-portal tool —
  Floor·Door·Stairs·Props·Enemy·NPC·Spawn·Select·Erase·Exit.
- **Number-key hotkeys 1-0** select the toolbar tools left→right (1=Floor …
  8=Select, 9=Erase, 0=Exit). Each button shows its key as a small corner badge
  (highlighted on the active tool). Hint bar updated.
- **Selection now reads as selected**: a pulsing green (cyan in sci-fi) glow ring
  on the ground under the picked object PLUS a synced wireframe outline box
  (BoxHelper), driven in builder update() and re-acquired if the object is
  re-rendered/moved. Cleared on deselect / floor change.
- **Selection/edit panel moved ABOVE the toolbar** — was a fixed top-left panel;
  now a centered card just above the tool palette with an accent border, glow,
  and a downward pointer arrow. Verified live (order, badges, Digit2→Door,
  ring+box render, panel bottom above palette top, centered). Selftest 159.

## v1.6.5 — 2026-07-09 (thumbnail pickers — images, not names)
- **New offscreen thumbnail renderer** (runtime/3d/thumbs.js): a dedicated 128px
  WebGL context that renders any model (enemy GLB / NPC / prop) to a framed,
  3/4-view PNG data URL, cached by theme:kind:id. One context, reused session-wide.
- **Builder pickers now show a rendered IMAGE of each option** instead of a text
  name (owner: 'i want the images not the names', 'far from INDUSTRY STANDARD'):
  - **Enemy** picker: all 24 creatures as thumbnails in a scrollable grid, each
    with its name + ❤hp ⚔dmg stat line.
  - **NPC** picker: merchant / blacksmith / sage figures as thumbnails + role note.
  - **Decor** picker: all props (barrel/crate/bookshelf/pillar/coffin/…) as
    thumbnails under the prop-category row.
  - b.thumbFor(kind, key) builds the model (makeCreature / makeNpc / prop clone)
    and caches the render. Verified live: 24/24 enemy + 3/3 NPC + 8/8 decor
    thumbnails render (0 placeholders), ~940ms one-time to warm the enemy grid,
    instant thereafter. Selftest 159.
## v1.11.0 — 2026-07-13 (builder: wall turns, real spikes, trap UI, decor overhaul)
- **Walls turn corners** — a held wall drag now pivots to a new axis when you
  move perpendicular, so you can draw L-shapes without releasing; still won't box
  in stray side tiles.
- **Walls can't cut through stairs** — wall+ refuses the edge a staircase flight
  crosses.
- **Real pop-up spikes** — procedural steel spike cluster (18 cones) that thrusts
  up from underground when the trap fires, replacing the untextured GLB blob.
- **Trap picker is a contained icon panel** like Decor (was a strung-out row);
  the trap-type chooser in the selection panel is rounded buttons, not a native
  square dropdown.
- **Decor fixes**: barrel, bookshelf, and the two torches shipped a broken 1×1
  texture → now procedural (fully coloured). **Wall-torch mounts on the wall** —
  a smaller bracketed torch that auto-attaches to the cell's nearest wall side
  (was floor-only). **Every decor is now destroyable** when hit or shot (break FX
  + loot); barrel/canister still explode.
- Selftest 294 → 299.

## v1.10.0 — 2026-07-12 (owner batch: doors/walls/co-build/exit gate/terrain/music)
- **Doors now always align to their wall** — they rendered 90° sideways (the old
  kit-gate rotation mapping survived into the new procedural doors). Right-click
  or the panel's Rotate flips the hinge; Move relocates to another wall line.
- **Right-click = rotate** everywhere in the builder (placement ghost, selected
  object, edge-door hinge). RMB-drag still orbits.
- **Wall drags lock to a straight line** — the first edge anchors the run and the
  pointer projects onto it, so a wandering mouse can't box in side tiles.
- **Co-build hardening** (friend-couldn't-see-my-props report):
  - obj+ ops now broadcast their assigned id → ids converge across peers
    (interleaved edits no longer corrupt later edits/deletes)
  - version handshake: peers on a stale cached build get a loud "hard-refresh
    (Ctrl+F5)" warning on join — a stale client silently REJECTS op kinds it
    doesn't know (that's how props/NPCs/stairs vanished for your friend)
  - a teammate's edit that fails to apply now surfaces a toast + console warn
    instead of disappearing silently
  - verified end-to-end through a live relay room: chest/trap/NPC/enemy/decor/
    stairs/walls/cells all replicate, ids identical on both sides
- **Exit portal is sealed until every enemy is dead.** The HUD lists remaining
  enemy kinds + counts — bosses stay hidden ("+?" … "something stirs").
  Objective text + sealed-portal toast included.
- **Enemy-carried keys**: no more 3D key sitting on the enemy — the builder shows
  only the 🗝 badge, the enemy panel gains "🗝 Give key (drops on defeat)", and
  the key appears in the world only when dropped.
- **Rolling terrain fixed at the root**: the sim now walks the SAME smooth
  corner-averaged surface the renderer draws (`surfaceHeightAt`), so players ride
  visible slopes and chests/objects sit exactly ON the ground (they used to sink
  or float where render and sim disagreed). **Raise ⛰ / Lower 🕳 sculpting is
  back** in the Floor palette, one step per cell per drag.
- **Builder music calmed**: build mode was wired to the intense BATTLE track;
  it now plays the mysterious dungeon-ambience track. (Music stock is 9 tracks
  total — a bespoke generated builder theme is a ~23-credit Stability job,
  offered separately.)
- Enemies on other floors no longer render (matches play-floor isolation).
- Selftest 288 → 294 (exit gate, enemy key binding, surface heights, raise op guards).

## v1.9.7 — 2026-07-10 (distinct traps, all verified firing)
- **Five clearly-distinct trap types** (each a different damage flavor), relabelled
  so they don't read alike:
  - ⚙ **Pop-up Spikes** — iron spikes erupt from the floor (physical)
  - ☠ **Poison Gas Vent** — now GREEN with a grate + a rising toxic-gas cloud
    (was fire-coloured and looked like the fire jet)
  - 🔥 **Wall Fire Jet** — a 3-cell flame cone from the wall
  - 🏹 **Javelin Tripwire** — launches a dart across the room
  - 🕳 **Secret Pit** — the floor gives way; instant death (jump to clear it)
  Picker notes now spell out the flavor + how each behaves.
- **Every trap verified firing in play** (owner asked to test them all): spikes 150dmg,
  poison 72dmg, fire 56dmg, javelin launches its dart, pit → fall → death. Confirmed
  render refs + damage + events for each.
- Checked all 13 decor types — every one is textured or properly materialed (no
  actual untextured props; the dark shapes in the report were dim-lit objects).

## v1.9.6 — 2026-07-10 (doors overhaul + sublevel review fixes)
### Doors
- **Procedural doors that fill a wall opening** — the old broken kit gate is gone.
  Every door now has stone jambs + a lintel so it clearly *replaces a wall
  segment*, and a leaf that **swings open on its hinge** in play.
- **Four door styles**: 🚪 Wood (planks + iron bands + ring), 🛡 Iron (studded
  slab), 🔲 Bars (see-through portcullis), 🏛 Ornate (gold-trimmed arch). Pick
  the style in the Walls → Door palette.
- **Select a door to edit it**: change style, **⟳ Rotate** (flip the hinge side),
  **✥ Move** it to another wall line, lock/unlock, or delete — not just lock.
### Sublevel/stairs fixes (from an adversarial self-review)
- **Co-build desync fixed**: a peer receiving a remote sublevel dig now reindexes
  its current floor, so both builders keep editing the same room.
- **No lost content**: `floor-below` + stairs edits now trigger a full rebuild, so
  a sublevel dig (even onto an occupied cell) never leaves a floor unrendered.
- **No false validation error**: `validate()` now understands down-stairs, so the
  sublevel feature no longer reports a bogus "stairs lead nowhere".
- **No stair soft-lock**: pressing interact on a staircase always transports, so a
  player can never be permanently stranded on a walled-in landing (was a co-op
  run-blocker).
- **No ghost landing markers**: deleting a staircase now clears its landing marker
  on the connected floor.
- Selftest 276 → 284.

## v1.9.5 — 2026-07-10 (play-floor isolation · quieter stairs · Light→Decor)
- **Play mode shows ONLY the floor you're on.** You no longer see the floor above
  (or any other) bleeding into view — each floor is isolated until you climb.
- **Stairs landings are quieter.** Dropped the big glowing green ring/chevron
  (it read like a spotlight); the recessed descending stairwell reads as
  "stairs down" on its own.
- **Light folded into Decor.** Removed the separate Light tool; torch + wall-torch
  (and lantern/candles, sci-fi lamp) are decor items now and still cast a warm
  light + flame. Props palette is now Chest · Key · Trap · Decor.

## v1.9.4 — 2026-07-10 (chest glow + SPACE jump)
- **Chests now glow.** Unopened chests wear a pulsing gold ring so it's obvious
  they're lootable — walk up and press **E** ("E Open chest" prompt) to grab the
  contents. (The mechanic already worked; this makes it discoverable.)
- **SPACE = jump.** The player hops in a real arc (jump velocity + gravity, sim
  stays 2D) with a whoop + landing thud. While airborne you **clear floor traps**
  — jump over pop-up spikes, steam vents and secret pits. Wall fire-jets and
  javelins still catch you (they're at body height). Blocked mid-stair-climb and
  while swimming so it never fights those.
- Landing rings + chest glows pulse each frame. How-to screen updated (walls,
  bidirectional stairs/sublevels, Space jump, glowing chests, Tab target).
- Selftest 272 → 276 (pit kills grounded / airborne clears it; spikes hurt
  grounded / airborne dodges). Browser-verified: chest glow + jump arc 1.24u,
  airborne during peak, lands clean.

## v1.9.3 — 2026-07-10 (dig SUBLEVELS with stairs down)
- **Stairs Down on the lowest floor now DIGS a sublevel** beneath the whole
  dungeon (owner: "why can't we go into a SUBLEVEL?") instead of refusing. The
  new basement is added below, you stay on your floor, and the staircase drops
  into it with its landing auto-added — mirroring how Stairs Up grows a floor
  above. The dig + placement is a single undo.
- Model op `floor-below` unshifts a floor; since objects live in fl.objects (no
  stored floor index) every existing floor shifts up an index for free, and
  stairLinks/findAll recompute live — spawn/exit/stairs/walls all stay correct.
- Selftest 262 → 272 (dig, reindex integrity, down-link, solvable, descend,
  roundtrip). Browser-verified: 1→2 floors, grouped undo/redo, sublevel viewable.

## v1.9.2 — 2026-07-10 (stairs go BOTH ways + visible landings)
- **Stairs are bidirectional now.** You climb a staircase up AND walk back down
  the same one — no key, just step onto either end. An anti-bounce lock keeps you
  from ping-ponging (arrive → the cell won't re-trigger until you step off it).
  Fixes the in-game "stairs are closed off, I can't go back down" bug.
- **The landing tile is no longer a blank square.** The connected end of every
  staircase renders a recessed stairwell + a glowing green down-ring + chevron on
  the OTHER floor, so the connection is obvious on both levels (and you can see
  exactly where to step to descend). Shows in the builder too.
- Selftest 255 → 262 (climb up, anti-bounce hold, step-off re-arm, descend, no
  re-climb). Browser-verified end-to-end.

## v1.9.1 — 2026-07-10 (builder shows REAL walls)
- **The builder now renders full-height walls** (they were squashed to 42% —
  "how am I supposed to add doors and put traps if I can't see the walls?").
  The playtest cutaway runs in build mode too: only the walls between your
  camera and the spot you're editing sink out of the way, and they spring back
  as you orbit. Works for boundary walls AND manual interior walls.
- Verified live: 32 boundary walls render full; a low camera angle sinks
  exactly the 4 occluders; orbiting back to top-down restores all 32.

## v1.9.0 — 2026-07-10 (THE WALLS TOOL — interior walls + doors on the line)
- **Toolbar slot 2 is now 🧱 WALLS** (the owner's long-standing ask). Click or
  drag along the grid LINES between floor tiles to raise interior walls, with a
  live edge highlight showing exactly which line you're on.
- **Four wall styles** — 🪨 Stone · 🧱 Brick · 🪵 Wood · ⬛ Metal — for different
  dungeon looks (style-tinted batches of the kit wall, readable from both rooms).
- **🚪 Doors now sit ON the wall line, not in a tile** — pick Door in the Walls
  palette and click a line: the gate arch straddles the edge. Select-click an
  edge door to toggle its 🔒 lock. In play they open/close/unlock with E exactly
  like classic doors (same events, same key rules) — and the arch leaf animates.
- **The sim respects every wall**: movement, enemy pathing, projectiles, line of
  sight, A* and the solvability checker all treat interior walls as solid and
  edge doors as gates (locked ones count as key gates). Wall cutaway lowers
  interior walls too when they block the camera. Legacy cell doors untouched.
- *Gauntlet of the 99 Steps* now uses a wood partition + edge door mid-hall.
- Selftest 236 → 255 (placement/rejection, movement/LOS/A* blocking, solvability
  splits, edge-door unlock flow with key consumption, serialize roundtrip,
  cell-erase cleanup).

## v1.8.7 — 2026-07-10 (builder fixes: toolbar order, Original texture, stairs DOWN)
- **Toolbar reordered** (owner spec): … 6 NPC · **7 Select · 8 Erase · 9 Spawn** · 0 Exit.
- **"Original" floor texture**: the default kit tile now has a recognizable
  terracotta swatch labeled **Original** in the Floor picker — one click paints
  any cell back to the stock floor.
- **Stairs UP / DOWN**: the Stairs tool has a direction picker. Down-stairs
  descend to the floor below (blocked on floor 1 with a clear warning), auto-add
  their landing tile below, render as a flipped flight, and the sim links/climb
  work both ways. Selftest 233 → 236.

## v1.8.6 — 2026-07-10 (menu overhaul batch: one carousel, simpler Build, pause polish, wider cutaway)
- **Play menu**: FEATURED / BY PLAYERS merged into ONE **DUNGEONS** carousel
  (7 cards). **Hold-and-drag scrolling** (grab the shelf and pull), thin amber
  scrollbar, edge fades, arrow paging. **MY DUNGEONS is now your pin board** —
  your own builds live there, and loading a friend's dungeon code **pins it
  there too** (shows "· by <author>").
- **Build menu**: template grid gone. Now just **▶ Continue** (reopens your last
  build), **✨ New Build**, MY DUNGEONS — where every dungeon has a **📋 Code**
  button that copies its share code — and the import row.
- **Pause menu polished**: glowing ⏸ header, live run chips (time · floor ·
  gold · kills · level), full-width icon buttons with hover lift.
- **Wall cutaway widened**: the whole sightline opens now (8 segments in the
  two-room test, was 1-4) — at least the closest 3 walls in the view direction.

## v1.8.5 — 2026-07-10 (five community dungeons + "by players" carousel + menu polish)
- **Five hand-authored dungeons** in a new BY PLAYERS carousel on the play menu,
  every one showcasing the new systems (floor textures, fire jets, javelin
  tripwires, secret pits, explosive barrels, swimming, NPCs, finale bosses):
  - 🏰 *Cellars of the Drowned King* by Mirella (easy) — flooded cellars, vault tripwire
  - 🏰 *The Ember Foundry* by TorchBearer99 (tricky) — lava channel, fire-jet corridor, blacksmith, cyclops
  - 🏰 *The Serpent's Bathhouse* by Naga (tricky) — marble pools, lying floors, cthulhu shrine
  - 🤖 *Blackout: Sector 7* by VOLTA (brutal) — two decks, canister stacks, warframe bridge
  - 🏰 *Gauntlet of the 99 Steps* by GrimJim (brutal) — one long trapped road to a dragon
  All live in `runtime/sim/community.js` (pure ops) and are selftest-enforced:
  schema-valid + key/lock solvable + escape sim runs clean.
- **Carousel UI**: horizontal cards (theme, author, difficulty skulls, blurb, your
  best time) with arrow paging; per-dungeon best times recorded (`community:` keys).
- **Menu polish**: accent section headers with gradient rules, row hover states,
  card hover lift — toward the arcane-realms/thronedrift standard.
- Selftest 222 → 233.

## v1.8.4 — 2026-07-10 (wall cutaway)
- **Walls now come down as you walk** (owner request): every wall segment sitting
  between the chase camera and the player smoothly sinks to 14% height (the
  builder's low-wall look) and grows back the moment it stops occluding. Pure
  per-instance matrix writes — only transitioning walls are touched per frame,
  steady-state cost ~zero. Skipped in first-person.
- Verified live: player behind a wall row → exactly the 4 occluding segments
  sank to 0.14 (46 others untouched); camera beside the player → all recovered.

## v1.8.3 — 2026-07-10 (swimming + lava swimming)
- **Water is swum, not walked on**: entering water sinks the body to chest depth
  (-0.78u, was an ankle wade), with a gentle swim bob, a forward lean while
  stroking (levels out when you stop), an entry splash and stroke splashes.
- **Lava is swum too — while it burns**: same chest-deep sink + bob, plus a
  constant shower of embers off the swimmer (burn damage unchanged).
- Enemies submerge to chest depth in liquids as well, with their own bob.
- Verified live: land y=0 → water/lava y=-0.78, bob amplitude 0.14, lean 0.5
  swimming forward → 0 at rest, 30hp burned + 109 ember particles in lava.

## v1.8.2 — 2026-07-10 (explosive barrels)
- **Barrels (fantasy) and canisters (sci-fi) are now LIVE explosives**:
  - **Pushable** — walk into one to shove it into position (the Barbarian bullies
    them at 2×). The mesh rolls with the entity; they no longer block cells.
  - **Explode when hit or shot** — melee, any spell bolt, a trap javelin, even an
    enemy plasma shot sets them off: fireball + shockwave + smoke + screen shake
    + a proper boom. The blast hurts **enemies AND players** (falloff), and
    **chains** to barrels next door.
  - Players can herd barrels into choke points and detonate them from range —
    build-your-own ambush, exactly as the owner asked.
- Builder Decor picker marks explosive types 💥 with a warning note.
- Selftest 215 → 222 (entity spin-up, push, melee boom, chain, enemy+player AoE,
  ranged detonation; the old smash-for-gold test moved from barrel → crate).

## v1.8.1 — 2026-07-10 (booby traps: fire jets, random spikes, javelins, secret pits)
- **Four real booby traps** (owner spec), all placeable in the builder's Trap picker:
  - **🜂 Wall Fire Jet** — a wall nozzle that roars a 3-cell flame cone down its
    facing direction (R rotates), with real particle flames, flickering light and
    fire sfx. Builder preview shows the burn cone.
  - **⚙ Pop-up Spikes** — now pop at RANDOM intervals (seed-deterministic jitter).
  - **🏹 Javelin Tripwire** — stepping on the plate looses a real javelin (wooden
    shaft + steel head) that whooshes across the room — and it SKEWERS ENEMIES
    too, so players can lure foes into the line of fire.
  - **🕳 Secret Pit** — a nearly invisible tile; one footstep and the floor cracks,
    falls away (rumble + dust + camera shake) leaving a real hole. Falling is
    lethal — for players AND enemies. Visible with a red ring in build mode only.
- Fixed a latent bug: `_buildFloor` REPLACED each object mesh's userData, wiping
  the per-kind animation refs (vent discs / spikes / new trap parts). Now merged.
- Selftest 205 → 215 (cone hit + off-cone miss, javelin launch/cooldown/skewer,
  pit arm/open/lethality, random-spike determinism).

## v1.8.0 — 2026-07-10 (owner feedback batch 1: combat UX + full cast regen)
- **All 4 classes regenerated** from clean T-pose reference art (image-to-3d →
  remesh → rig → full anim set, ~775 credits total): natural stances, clean
  fingers-together hands, and the sorceress **no longer has the staff baked
  across her body** — she holds one proper orb staff via the ported grip system.
- **Enemies no longer walk backwards** (stray +PI on the view yaw).
- **Hotbar rework**: the normal attack lives on LMB only; the **sorceress's normal
  attack is now an ARCANE BOLT** (free ranged poke). Slots: 1 Fireball · 2 Frost ·
  3 Chain Lightning (range 6.5→9) · 4 Health potion · 5 Mana potion.
- **TAB target cycling**: lock nearest → cycle outward → unlock past the last.
- **Lights toned down** (placed lights were intensity 11 + emissive 2.6 → blinding).
- **F3 debug** now works: fps + draw calls + tris + position + live enemy count.
- **Combat audio**: punchier swing/hit/hurt, distinct fire/frost cast sounds,
  audible enemy attacks, explosion sfx staged for the barrel feature.
- Selftest 203 → 205.

## v1.7.7 — 2026-07-10 (character shrug + giant-sword fixes — no regen needed)
- **The "shrug" stance is fixed** — root cause was the Meshy idle clip animating the
  **shoulder/arm/hand POSITION tracks** (raising the shoulders), while the `relaxArms`
  hack only corrected rotation, so it could never undo the raised shoulders. Now we
  strip those position tracks from every character clip (same pattern as the existing
  scale-track strip). Verified live: all 4 classes stand with arms hanging naturally
  (hands 0.41–0.52 below the shoulders), not shrugging.
- **The oversized knight sword is fixed** — the sword GLB was sized with
  `normalizeFoot(0.95)` (footprint = max of x/z width). A blade is thin in x/z and long
  in +Y, so scaling its narrow width to 0.95 blew the length up ~10× (the giant,
  backwards blade). Switched to `normalizeH` (size by blade length). Verified: the
  blade is now 1.04 units ≈ 0.7× body height, held correctly in hand.
- **Diagnosis note:** inspected the live rigs first — they're clean 24-bone Meshy
  humanoids with a fine A-pose bind, so **no T-pose regeneration was needed** (saved
  ~212 Meshy credits). Both fixes are code-only, $0.

## v1.7.6 — 2026-07-10 (XP & leveling foundation)
- **Kills now grant XP and the player levels up.** Each enemy is worth XP scaled
  to its HP+damage (bosses ×3); crossing the per-level threshold raises the level,
  adds +12 max HP, full-heals, and boosts damage. Curve is exponential
  (`xpToNext = 45·1.35^(lvl-1)`), cap L30. Overflow XP carries into the next level.
- **HUD**: a gold **Lv N** chip + an XP progress bar (with `x / y XP` readout, "MAX"
  at cap) sit atop the health/mana vitals. Level-ups pop a toast + golden burst.
- **Refactor**: the five identical attack multipliers (charms · weapon tier · gear
  affixes) are now one `combatMul(p)` — which also folds in the +4%/level damage,
  so melee/bolt/special/frost/chain all scale with level from a single source.
  Foundation for the per-class skill trees (abilities gate on level next).
- Selftest +9 → 203: curve rises, boss 3×, start L1/0xp, threshold levels up
  (+maxHp, full-heal, event), overflow carries multiple levels, a kill awards xp.
  Verified live: Lv1→2 raised maxHp 85→97 and refilled; HUD chip + bar render and
  update (0%→40%→29.5% carrying 18 overflow), whole vitals stack fits the viewport.

## v1.7.5 — 2026-07-10 (Floor tool: Raise/Lower removed + procedural floor textures)
- **Raise/Lower are gone from the Floor tool** (owner request) — the sub-palette is
  now just Floor · Lava · Water. The sim still honours legacy per-cell height data so
  older dungeons keep their rolling terrain; new builds stay flat.
- **Floor textures** — Floor mode now carries a surface texture painted onto each
  cell, picked from a swatch row: Stone (default kit tile) · Cobble · Brick ·
  Flagstone · Dirt · Cave Rock · Wood · Sand · Marble · Mossy. Nine of them are
  seamless procedural textures generated in-code (`runtime/3d/floor_tex.js`):
  toroidal Voronoi (cobble/flagstone/moss), running-bond bricks, wood planks with
  lengthwise grain, marble veins, rippled sand, cracked cave rock — each a 256²
  canvas that tiles with **zero-delta seams** (verified numerically) and needs no
  external assets or generation credits.
- Data model: an optional per-cell `tex` map on each floor (walkable cells only;
  cleared when a cell becomes lava/water or is erased), threaded through `cell+`,
  `cell-`, `stampRoom`, and the serialize→sanitize roundtrip. Render splits flat
  cells into default (kit tile) + textured (a UV-mapped plane on the tile top),
  since the kit's colormap-atlas UVs can't tile a swapped map. Both builder and
  play mode render textures via the shared `makeCellSurfaces`.
- Verified live on the CDN: Floor modes = [floor,lava,water] (no raise/lower); a
  9-texture striped floor rendered 108 textured instances across 9 distinct
  CanvasTexture materials; HUD swatch picker shows 10 options (256² thumbnails,
  click sets the paint texture). Selftest +7 → 194.

## v1.7.4 — 2026-07-10 (assignable action hotbar)
- **The read-only ability bar is now a real hotbar** — 6 slots showing the
  player's abilities + consumables with icons, cooldown fill overlays, and
  consumable counts: 1 Attack · 2 Special (class fireball/crush/bash/poison) ·
  3 Frost · 4 Chain Lightning (Sorceress) · 5 Health Potion · 6 Mana Potion.
  Empty consumables dim. Slots are built from a shared `hotbar(p)` (escape_sim)
  so per-class kits (Knight has no frost/chain) renumber cleanly.
- **Number keys 1-N activate the mapped slot** (routed through the same input
  flags as the dedicated keys, which keep working). Verified live: Digit2 fired
  the Fireball, Digit5 drank a Health Potion (hp 50→85); hotbar shows 6 slots.
- Selftest +2 (per-class hotbar composition) → 187. Completes the RPG-foundations
  trio (mana potion → item model → hotbar) — abilities/skills now have real slots.

## v1.7.3 — 2026-07-09 (item/equipment data model — the loot keystone)
- **Real item objects** replace the bare weaponTier/armorTier integers:
  `{id, slot, rarity, base, tier, affixes[], name}`. RARITY (common/magic/rare/
  legendary) sets the rolled-affix count; AFFIX_POOL rolls +Damage% / +Max HP,
  scaled by tier. makeItem/itemScore/rollRarity in dungeon.js.
- Player now has `equipped {weapon,armor}` + an `inventory[]`; chest loot ships a
  pre-rolled item (deterministic per chest seed). New gear auto-equips if it
  out-scores the current slot, else banks in inventory. weaponTier/armorTier are
  DERIVED from the equipped items (recomputeGear) so all combat math + tier-tint
  gear appearance keep working unchanged; affixes add gearDmg (× on every damage
  formula) and gearMaxHp (→ maxHp, alongside the Sage blessing, via recomputeMaxHp).
- HUD ⚔/🛡 chips now tint by the equipped item's rarity and show its name +
  affixes on hover; equip/loot toasts name the item.
- Verified: selftest +7 (auto-equip, tier derive, affix→maxHp/gearDmg, inventory,
  chest items) → 185; live — legendary weapon shows ⚔ III in orange, name
  "Ancient Master Blade — +12% Damage, +24 Max HP", weapon still renders, maxHp
  144. This is the KEYSTONE for the coming rarity/affix/set-item depth (#23 pt2).

## v1.7.2 — 2026-07-09 (stored mana potion + potion heal-cap fix)
- **Mana is now a stored, hotkeyed consumable** (audit gap): mana loot / shop
  purchases add a counted 🔷 Mana Potion (p.manaPots) instead of an instant
  refill; press **X** to drink one for +60 mana (parity with 🧪 Health / Q). New
  HUD slot (hidden at 0), manapot event + toast, SHOP entry relabelled.
- **Fixed the potion heal cap**: health potions now heal up to `p.maxHp`, not the
  constant 100 — so a Sage-blessed player (maxHp 125) can potion above 100 (it was
  a silent no-op there before). Verified: hp 110 + potion → 125.
- Selftest +4 (grant-stores-pot, X-drinks-+60, blessed-potion-to-maxHp) → 178.
  Verified live: HUD 🔷2→🔷1, drink restored mana. First RPG-foundations slice.

## v1.7.1 — 2026-07-09 (spell FX overhaul + chain lightning + class design)
- Built by a **6-agent workflow** (one per effect + design + integration). Four
  upgraded, reference-matched spell effects in fx.js, self-contained + merge-safe:
  - **Frost bolt** → a faceted crystalline ICE SHARD (elongated octahedron, cyan→
    white additive layers) oriented along velocity, spinning, with a cold swirl +
    icy trail; impact shatters into 9 tumbling shards + a frost ring + spray.
  - **Fireball** → a churning 3-layer core (white-hot→orange→deep-red, counter-
    rotating + flickering) with a dense buoyant ember/smoke TRAIL; impact = fire
    dome + smoke plume + expanding ring.
  - **Chain lightning** (NEW ability, Sorceress KeyC) → jagged blue-white
    LineSegments arcs with forked branches + sparks that JUMP to up to 3 nearby
    enemies (−20%/jump, 0.3s micro-stun). New sim castChain + 'chain' event +
    relay. Verified live: arc renders caster→enemy with a 22 damage number.
  - **Poison cloud** → a lingering drifting green toxic billow + ground glow disc;
    fires on the Rogue's poison-knife impact (or fx.poisonCloud()).
- syncBolts now renders per-element projectiles (frost crystal / fireball) instead
  of a plain sphere; boltHit routes to the upgraded impacts. Verified all four
  create their FX objects in-game (fireball group, frost crystal, arc, cloud).
- **Per-class ability + leveling design** (knight/barbarian/sorceress/rogue,
  Diablo-like) captured in games/dungeon-forge/DESIGN_CLASSES.md — the roadmap for
  the leveling/skill-tree build-out (task #23). Selftest 174.

## v1.7.0 — 2026-07-09 (weapons flush in hand — no more through-the-hip)
- **Weapons are now gripped correctly in the fist** (owner: 'hold weapons the
  right way not through the hip'). Two faults, both fixed:
  1. Weapons were gripped at their BUTT (mesh origin) and rotated by a blind fixed
     Euler that ignored the Meshy hand-bone's arbitrary local axes → the shaft
     cantilevered through the hip. New `_gripMount`: measures each weapon's bbox,
     places the GRIP (per-class gripFrac) at the hand, and orients the shaft from
     the hand bone's real world basis toward a per-class rest direction (staff up,
     sword fwd-up, axe up-fwd, dagger fwd), computed at the idle pose so it then
     follows every animation.
  2. **Attachment scale regression** (introduced by v1.6.9's scale-track strip):
     Meshy armatures bind bones at ~0.01 world scale and the animation scale
     tracks were inflating them; stripping the tracks left bones at bind scale, so
     weapons/armor/shield shrank ~100×. Fixed by countering each bone's ACTUAL
     measured world scale (`boneCounterScale`) instead of the mismatched rigScale.
- Verified live: Sorceress staff full-size (1.74) held upright with the orb at the
  top, gripped exactly at the hand (dist 0), beside the body (0.31 from hip, not
  through it); Knight sword full-size (1.55) fwd-up + shield restored (0.72).

## v1.6.9 — 2026-07-09 (inverted strafe + walk-shrink fixes)
- **Inverted A/D strafe fixed** (owner: 'A goes right and D goes left'). The
  camera-relative strafe term had the wrong sign in _gatherInput (escape.js) —
  flipped only the fx (strafe) terms so A=screen-left, D=screen-right; W/S
  untouched. Verified empirically (frozen-camera displacement: D dot +1, A dot −1).
- **Character no longer shrinks while walking** (owner). Root cause (found by a
  multi-agent audit): the Meshy idle clip bakes a uniform Hips root-scale of
  1.1765 while walk/run/combat clips bake 1.0, so the mixer shrank the body to
  0.85× whenever a locomotion clip played (poseRig measured against the inflated
  idle). Fix: strip `.scale` bone tracks when cloning each char clip — skeleton
  stays at constant bind scale. Verified: torso height ratio walk/idle 1.02 (was
  ~0.85). Appearance unchanged (the 1.1765 is a pure root scale already
  normalized away by obj.scale = 1.72/height).

## v1.6.8 — 2026-07-09 (player facing fix)
- **Player now faces forward** (owner: 'facing the wrong way'). The player rig's
  rotation had a stray `+ Math.PI` that pointed the character AT the chase camera
  — so you saw its front and it "shot out of its back". Removed the offset so the
  Meshy char rigs face the yaw/look direction (into the scene). Verified: rig
  forward now dot −1 vs the camera (faces away); the knight shows its back + cape.
  Camera + enemy facing unchanged (enemies correctly face the player they aggro).

## v1.6.7 — 2026-07-09 (more props + breakable decor + colormap 404 fix)
- **Smashable decor**: barrels, crates, coffins, debris (+ new pot/urn/bones and
  sci-fi canister) now BREAK when meleed or hit by a player bolt — shatter FX,
  3–8 gold, and the cell becomes walkable (owner: 'interactables we can break').
  Tracked in st.brokenDecor (MP-relayed via a decorBreak event); collision +
  render both honour it. Deterministic gold (hashStr) for MP consistency.
- **3 new fantasy props** (pot, urn, bones) + **1 sci-fi** (canister), hand-built
  flat-shaded (assets.makeProp), injected into the props map and auto-thumbnailed
  in the picker — fantasy decor 8 → 11. Per-type render footprint map (DECOR_FOOT)
  so small props stay small.
- **Fixed the Textures/colormap.png 404**: items/coin.glb + items/key.glb
  referenced an external colormap with no sibling Textures/ dir — copied the kit
  colormap into items/Textures/ (same fix as the earlier chest-texture bug).
- Verified live: 11 decor thumbnails all render; decorBreak hides the mesh +
  marks it broken for collision; clean reload shows no colormap 404. Selftest +7
  (place/smash/gold/passable/roundtrip) → 174 green.

## v1.6.6 — 2026-07-09 (editable per-placement enemy stats — finishes #9)
- **Enemy stats are now adjustable per placement** (owner: 'stats … standard but
  can be adjustable by world builder'). Selecting a placed enemy shows HP / DMG /
  Speed number fields in the selection panel, pre-filled with that creature's
  defaults; edited fields highlight in the accent colour and show "def N", with a
  "↺ Reset stats to default" button.
- Overrides stored as `o.stats = {hp,dmg,speed}` on the object, validated + clamped
  (ENEMY_STAT_DEFS + clampStats in dungeon.js), merged over the roster defaults
  when the escape sim spawns the enemy (`K = {...base, ...o.stats}`). Survives
  save / share / relay via sanitize; changing the creature type clears the override.
- Verified end-to-end live: edit orc HP 150→500 → persists on object → survives an
  escape→builder round-trip → orc spawns in escape with K.hp 500 (dmg stays 22).
  Selftest +8 assertions (store/clamp/roundtrip/sim-spawn/type-reset) → 167 green.
