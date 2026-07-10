# Thronedrift — Changelog (né Crownfire Arenas)

## v1.1 — 2026-07-10 (SHIFT skills + polish batch)
- SHIFT MOVEMENT SKILLS: Warrior LUNGE (dash + blade drag damage), Mage BLINK
  (teleport along facing, brief iframes), Archer ROLL (dodge with iframes).
  Own cooldown chip in the HUD cluster; bots use them (close gaps / escape)
- Real SFX (Kenney CC0): death = heavy punch impact, defeat = deep bell toll,
  hurt = body hit — the synth chimes read as OS sounds
- Speeds rebalanced: warrior 5.9 / mage 6.1 / archer 6.3, and melee attack
  slow eased 0.55→0.7 (this was why archers FELT far faster)
- Barbarian: idle arm-relax (his authored idle is the arms-out one)
- Mage staff surgery v6: banded-radius selection — the A-pose arm no longer
  gets dragged along (the "meshed" plank); staff clean in hand
- Hearts HUD: glyph-width fix — no more clipped hearts
- Camera: default elevation lowered ~53°→43°, pitch range widened (20°-57°),
  zoom range widened
- Arena select: xAI-generated realm card art (5 images, assets/ui/)

## v1.0 — 2026-07-10 (VERSUS: PVP arenas + the Champion engine)
- CHAMPION ENGINE: all fighters (you, bots, future online players) are Champion
  entities running the identical data-driven kits via a controller interface
  (human input / utility-AI bots produce the same input surface). Campaign is
  unchanged — one champion vs waves; mobs now target the nearest champion.
- VERSUS MODES: FREE-FOR-ALL (5 champions, first to 10, respawns + spectate
  your killer), DUEL (1v1, best of 3 rounds), TEAMS (2v2, best of 3 team wipes,
  no friendly fire). Round resets with 3-2-1 FIGHT countdowns.
- LOBBY: quick match with search timer, staggered joins, CANCEL, vote-to-start
  (empty slots become AI on start), private-room toggle w/ code, auto countdown.
  Quick matches always include intelligent AI champions (class-aware kit usage,
  telegraph dodging, kiting, strafing, shield use).
- PVP combat: champion-vs-champion damage conversion (weapon numbers -> hearts,
  TTK ~5-8s), full statuses (shock/burn/frost/knockback) between champions,
  team-stamped residual patches, owner/team projectile resolution.
- HUD: live K/D scoreboard, kill feed, round pips, match status + timer,
  champion overhead HP bars, victory panel w/ full match stats.
- LEADERBOARDS (local): per-mode W/L, per-class wins/kills/damage, recent
  matches — on the title screen. Global boards ship with online play (relay
  research done: Supabase Realtime transport mapped from Pirates Cove stack).
- Versus pause = menu overlay but bots keep fighting; LEAVE MATCH exits clean.

## v0.9 — 2026-07-10 (campaign overhaul: realms are 5 LEVELS deep)
- CAMPAIGN RESTRUCTURE: each realm = 5 levels (L1: 3 waves → L4: 6 waves,
  rising difficulty), L5 = dedicated BOSS FIGHT (+25% boss HP, boss music,
  "THE WARDEN COMES"); level-select screen per realm w/ lock/cleared states;
  per-realm level progress persisted; LEVEL CLEAR panels chain levels
- Proper in-game PAUSE: ESC or the corner pause button (game_controls hook) —
  Resume / Settings / Restart / Quit; SETTINGS now reachable mid-run
- Right-drag camera pitch un-inverted (drag down looks down)

## v0.8 — 2026-07-10 (weapon-in-hand pass: generated bow + staff surgery)
- ARCHER: real Meshy-generated recurve bow (assets/props/bow.glb, text-to-3d)
  replaces the procedural one that read as an upside-down crossbow; auto
  shaft-normalization (longest axis -> +Y) + vision-tuned vertical grip
- MAGE: her staff is WELDED into the character mesh (Meshy ignored the
  empty-hands prompt) and was skinned to unstable mixed weights near her LEFT
  hand in bind pose. GLB surgery: 755 shaft vertices traced spatially,
  re-weighted uniformly to Hips (rigid, no gesture-waving) and translated to
  her measured average right-palm position — staff now stands in front of her
  palm. Pristine mesh backup: state/thronedrift_sorceress_base_pristine.glb
- WARRIOR: untouched (owner-approved)

## v0.7 — 2026-07-10 (feedback batch 3: realm-1 fix, swings, grips, music swap)
- FIXED: Realm 1 card invisible on arena select — absolutely-positioned menu
  bg/scrim painted OVER static content; locked cards escaped via their
  opacity/filter stacking contexts, the unlocked card did not (z-index lift)
- 2H Heavy Slash: full frontal cone swing (rate 0.9s, arc 2.6 rad, dmg 18) +
  crescent SWIPE arc FX on all melee swings (basics + Frontal Swipe)
- Run animation: full-strength arm relax + gait swing during locomotion
  (arms-out run fixed); idle still uses the authored clips untouched
- Grips: palm offset — hand-bone origin is the WRIST; hilts now seat in the
  fist; bow tilted battle-ready + rolled arc-forward
- Heart drops: red UPRIGHT vector heart (emoji rendered purple/sideways)
- MUSIC swapped to owner's own Suno epic-orchestral (Thunder Bulwark): menu
  "Greycrown Tempest", waves "Dawnbreak Legion", boss "Warden Requiem" —
  quieter base volumes + Music ON/OFF toggle in settings

## v0.6 — 2026-07-10 (idle/grip fixes + full verification pass)
- Idle poses: trust the AUTHORED Meshy idle clips — relaxArms now runs ONLY
  during walk/run (forcing it at rest made mannequin arms + inverted elbows)
- Grips: hand-basis snapshot at the settled authored idle (per-weapon poseT);
  mage's procedural staff REMOVED — her model has an ornate staff baked in
  (was rendering as a floating duplicate)
- Block: removed the sub-0.5 damage floor — blocked chip damage now drains the
  smooth hearts instead of silently immunizing everything under 3 dmg
- VERIFIED live + preview: live CDN build boots and plays; music starts on
  first gesture; wheel zoom / right-drag orbit / touch joystick via real
  events; pause/resume; settings toggles take effect; perfect + late + rear
  block math; boss fight visuals (HP bar, telegraphs, WHIRLWIND trail);
  all five realm boards screenshot-distinct

## v0.5 — 2026-07-10 (portraits + mobile polish; build complete)
- Bestiary: runtime 3D portraits rendered from the actual GLBs (all 20 foes)
- Mobile: responsive title sizing, menu buttons wrap, showcase camera pulls
  back on narrow aspects (all 3 champions framed at 375px), ability cluster
  raised 48px clear of the fullscreen/mute bar

## v0.4 — 2026-07-10 (campaign QA + music + selftest)
- FULL CAMPAIGN VERIFIED headless: all 5 realms cleared, all 5 bosses fought
  (Vulkar slams/charges, Boreas novas/summons, Skalvyrn volleys/blinks x4,
  Zhy'moth orbs/skulls/blinks x5, Aurex knives/dashes) -> THE CROWN IS CLAIMED
- Balance: heavy units capped at 4/wave (realm-5 late waves were 6-cyclops
  HP sponges body-blocking all projectiles)
- MUSIC: menu/level/boss beds (Kenney pool via audio_mapper, distinct tracks,
  crossfaded; game_controls mute covers them; settings volume wired)
- selftest.mjs: 718 data-invariant checks (arenas, rosters, kits, waves) PASS

## v0.3 — 2026-07-10 (feedback batch 2: bosses, bestiary x20, new main menu)
- Main menu rebuilt: LIVE 3D champion showcase (three heroes on a gold dais,
  click a champion card to enter — no PLAY step); aspect-adaptive menu camera
- SETTINGS screen: sound volume, screen shake, damage numbers, reset progress
- Loading screen uses the key art
- Roster: 15 regulars = 3 per realm (new: bat/spider/zombie/ghost/skull/
  gargoyle/yeti/cyclops/myconid) with per-realm spawn pools
- 5 REALM BOSSES with class-flavored kits (Vulkar warrior / Boreas frost
  warrior / Skalvyrn archer / Zhy'moth mage / Aurex blademaster): telegraphed
  slams, charges, straight dodgeable volleys/novas, summons, blinks; boss HP
  bar + intro/death banners; boss ends every realm
- Healing: +1 heart on wave clear AND rare heart drops (8% kills, bosses 2x)
- Hearts now DRAIN smoothly (animated fill, no stepped halves)
- Bow rebuilt (was rendering as a giant ring); bestiary 20 entries w/ realm tags

## v0.2 — 2026-07-10 (rename + owner feedback batch)
- RENAMED Crownfire Arenas → **Thronedrift** (biome-neutral; xAI-assisted, conflict-screened)
- xAI key art: menu_bg.png title background (Ken Burns + scrim) + thumbnail.png
- Industry-standard menu: PLAY / BESTIARY / HOW TO PLAY, pause menu (ESC), hiscore
- **Bestiary**: enemies recorded on first encounter (localStorage), lore + stats cards
- Meshy rig fixes (DF recipes): weapons were ~100× too small (bone world-scale
  counter via matrixWorld decompose) + grip mounts w/ rest orientation; relaxArms
  per-frame A-pose fix + procedural gait swing; basic attacks rate-fitted (barb
  slash1 is a 7.7s clip — swapped to finisher/slash2 and clips now fit the rate)
- Fixed: Fan Shot never spawned projectiles (castAbility had no "shot" case)
- Controls: 2×2 diamond ability cluster bottom-right (big basic in corner), warrior
  mode toggle moved bottom-left by the thumb; wheel/pinch zoom; right-drag orbit
- Enemies: ground-eruption spawns w/ telegraph decals (portals removed), HP bars,
  slime (hop/squash) added, per-type move styles, slower early waves, warrior 7 hearts
- FX: Whirlwind spin-trail ring, real arrow meshes + fletching, projectile glow
  sprites + trails, juicier explosions, falling arrow shafts on Rain of Arrows
- Half-heart HUD drain (blocked chip damage now visible), toast notifications

## v0.1 — 2026-07-10 (initial vertical slice)
- Full runtime scaffold: 5 procedural realm boards, 3 classes (Warrior dual-mode
  2H/Sword&Shield with Block + perfect parry, Archer, Mage), data-driven abilities,
  4+2 enemy types from the creature library, waves/combo/score, shock/burn/frost,
  fire+frost ground residuals, DOM HUD with radial cooldowns + touch joystick,
  wave clear / realm clear / crown-claimed / game-over flows, procedural SFX,
  campaign unlock + hiscore in localStorage.
