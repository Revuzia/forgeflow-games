# Thronedrift

Top-down isometric 3D arena wave-survival (Three.js/WebGL). Five floating
realm-boards, three champions, combo multipliers, shock/burn/frost statuses,
ground residuals, radial ability cooldowns, WAVE CLEAR / crown-claim ceremony.

## Run locally

Static ES modules — any web server from this directory:

```
python ../../serve_nocache.py   # or: python -m http.server 8080
```

Open `http://localhost:<port>/games/thronedrift/`. No build step; Three.js 0.172
loads from CDN via import map.

## Controls

| Input | Action |
|---|---|
| **WASD / arrows** (ZQSD works — physical positions) | Move |
| **J / Space / Left-click** | Basic attack (spamable; click also aims) |
| **1 / 2 / 3** (or U / I / O) | Abilities (radial cooldown on HUD) |
| **Hold 3** | Bulwark Block — Sword & Shield mode only |
| **TAB / F** | Warrior weapon-mode swap (2H ↔ Sword & Shield) |
| **Touch** | Left joystick + right ability buttons |

### Warrior weapon modes

Swapping modes swaps the whole kit — model, weapon, animations, abilities.
**Cooldown policy: each mode keeps its own independent cooldown tracks** —
swapping never resets or refunds timers.

- **Two-Handed** (barbarian, greatblade): Heavy Slash · Whirlwind · Ground Slam · Earthsplitter. No block.
- **Sword & Shield** (knight): Sword Strike · Frontal Swipe · Shield Bash (SHOCK + push) · Bulwark
  (hold-to-block, 80% frontal damage reduction; block within 0.25s of a hit = **perfect block** → frontal stun pulse).

### Archer — Single Arrow · Fan Shot · Fire Arrow (AOE + fire patch) · Rain of Arrows (auto-targets densest cluster)
### Mage — Arcane Bolt · Fireball (AOE + fire patch) · Frost Orb (AOE slow + frost patch) · Arcane Ward (absorb bubble)

## The five realms

1. **Emberthrone** — volcanic stone, lava seams, rising embers. Fire patches +35%.
2. **Glacier Court** — ice tiles, frost veins, falling snow. Frost patches +40%.
3. **Tempest Ring** — dark basalt, lightning inlay, storm flashes. Shock +50% duration.
4. **Umbra Throne** — void cracks, magenta fog, darkest board. All statuses +15%.
5. **Aurelian Bastion** — white-gold marble, god-rays, final realm. **THE CROWN IS CLAIMED!**

Campaign progression (clearing a realm unlocks the next; stored in
localStorage `thronedrift_unlocked`) plus free arena select of anything unlocked.

## Assets

- **Heroes**: Meshy auto-rigged humanoids (barbarian/knight/sorceress/rogue) with
  retargeted animation clips — shared with Dungeon Forge (`assets/chars/meshy/`).
  Loader strips baked bone-scale + shoulder-position tracks (Meshy rig gotchas).
- **Enemies**: ForgeFlow creature library GLBs (`assets/enemies/`).
- **Boards**: 100% procedural — 2048px canvas albedo+emissive floors, rune rings,
  center motifs, rim pylons, floating debris, per-realm particle fields.
- **Audio**: fully procedural WebAudio SFX (no files).
- **Weapons**: procedural (greatblade/sword/shield/bow/staff), crimson-gold identity.

Known follow-up: Archer uses the rogue model + procedural bow; a dedicated Meshy
bow-draw animation set is queued (see BUILD_STATUS.md).

## Architecture

```
runtime/boot.js        renderer, preload, main loop, __FFG3D__ eval hooks
runtime/core/          input (kb/mouse/touch), procedural audio, math utils
runtime/data/          arenas.js · abilities.js (data-driven kits) · enemies.js
runtime/view/          arena.js (board builder) · chars.js (GLB actors) · fx.js
runtime/ui/hud.js      DOM HUD: radial cooldowns, joystick, banners, menus
runtime/sim/game.js    combat primitives, waves, statuses, camera, run flow
```

Verification hook: `window.__FFG3D__.stats()` → `{state, hp, score, wave, enemies, combo, mode, drawCalls, tris}`.
