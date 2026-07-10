# Thronedrift — Changelog (né Crownfire Arenas)

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
