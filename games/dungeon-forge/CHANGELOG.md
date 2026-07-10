# Dungeon Forge — CHANGELOG

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
