# Crownfire Arenas — Build Status (loop tracker)

Working doc for the /loop build. Update every iteration. Delete when shipped.

## Iteration 1 — 2026-07-10 ✅ VERTICAL SLICE PLAYABLE

**Done + verified in browser (localhost:8197/games/crownfire/):**
- Boot, loading screen, title → class select → arena select → playing flow
- Emberthrone + Glacier Court render **visually distinct** (screenshots verified);
  board = floating realm disc w/ rune ring, motif, rim pylons, debris, sky, portals
- Warrior 2H + Sword&Shield: mode swap (TAB) verified swapping kit + model +
  separate cooldown tracks; Shield Bash fires w/ cooldown radial ticking
- Waves spawn/stagger from portals, enemies chase/windup/attack, player death →
  FALLEN IN THE ARENA panel → RESTART works
- Score/combo/gold/hearts HUD live; radial conic-gradient cooldowns work
- Human play test (user in preview panel): mage run to wave 3 (3,288), warrior
  glacier run to 5,967 — game is genuinely playable and engaging

**Fixed this iteration:**
- Meshy skinned-rig height: Box3-on-bind-pose garbage → poseRig bone-measure
  (DF recipe); weapons were flying at y=111 before this
- Mode-swap edge consumed silently while attacking (togglePressed order bug)
- Rain-of-arrows TDZ crash; double-kill guard; floor emissive overexposure
- Board readability: BOARD_RADIUS 21→13.5 + camera (0,19,14.5) + 0.72 center
  bias so rim/void/sky always frame the shot

## Punch list (next iterations, in order)

1. **Balance**: users died on wave 2-3 twice — early lethality hot. Lower wave-1/2
   counts or enemy speed; consider hearts=6 for warrior, contact dmg windup longer.
2. **Verify live**: Whirlwind/Ground Slam/Earthsplitter callouts+shake+hitstop;
   Bulwark hold-block + perfect-block pulse; Archer kit (fan/fire arrow/rain);
   Mage kit (fireball/frost orb residual DECALS on ground, ward bubble).
3. **Arenas 3-5** visual QA (tempest lightning flashes, umbra fog, solar god-rays).
4. **Full campaign run**: realm unlock chain → CROWN CLAIMED final panel.
5. **Mobile pass**: joystick + touch buttons on 375px viewport; DPR/fps check.
6. **Audio**: procedural SFX QA (mute toggle via game_controls), consider stock
   music via audio_mapper (9 tracks avail) or keep silent+SFX.
7. **thumbnail.png**: pipeline/generate_cover.py --out games/crownfire (writes
   thumbnail.png directly — that IS the catalog card for new games).
8. **selftest.mjs**: node syntax-load of all runtime modules + data invariants
   (5 arenas, 3 classes × kit shape, cd>0, enemy defs sane) like siegeheart.
9. Meshy bow-draw anim set for Archer (currently rogue slash reinterpreted).
10. **Deploy**: python pipeline/deploy_game.py --game-dir games/crownfire --slug
    crownfire (auto-runs portal rebuild). Publish toggle after full QA only.

## Conventions locked
- Slug `crownfire` · port 8197 in .claude/launch.json · ?v=1 cache-bust suffix
- Assets: chars from dungeon-forge Meshy set (shared), enemies from creature lib
- __FFG3D__.stats() eval hook for automated verification
