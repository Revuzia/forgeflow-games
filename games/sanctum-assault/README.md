# Sanctum Assault

**Original IP** top-down isometric arena wave-survival game built with **Three.js + WebGL**.

Fight enemy legions across five mystical **realm boards** (collectible-board fantasy: ornate rims, glowing runes, biome lighting). Choose **Warrior**, **Archer**, or **Mage**. Combos, radial ability cooldowns, Shock/Burn/Frost, ground residuals, WAVE CLEAR, and final REALM CLEARED screens.

## How to run

No build step required (ES modules + Three.js CDN).

```bash
# from this folder
npx --yes serve -p 5179 .
# or
python -m http.server 5179
```

Open `http://localhost:5179/`

If nested under ForgeFlow monorepo, serve the `sanctum-assault` folder (or the games root) so relative module paths resolve.

## Controls

| Action | Desktop | Mobile |
|--------|---------|--------|
| Move | WASD or ZQSD / arrows | Left virtual joystick |
| Aim | Mouse position on arena | Face move direction / last stick |
| Basic attack (spam) | Left click or **J** | Tap basic button |
| Abilities 1–3 | **1 / 2 / 3** or **U I O** | Ability buttons (radial CD) |
| Warrior mode swap | **Q** or **Tab** | Mode toggle button |
| Block (Sword & Shield only) | Hold **Shift** or **K** | Hold Block button |
| Heal (1 heart / 8◈) | **H** | Heal button |
| Pause | **Esc** | Pause control |

### Warrior weapon modes

| Mode | Basic | Abilities | Block |
|------|-------|-----------|-------|
| **Two-Handed** | Heavy Slash | Whirlwind · Ground Slam · Earthsplitter | No |
| **Sword & Shield** | Sword Strike | Frontal Swipe · Shield Bash (Shock) · Bulwark | Yes (hold) |

Mode swap is instant (short equip flash). Ability cooldowns are **per-slot tracks** that persist across swap so you cannot double-dip the same slot immediately; the HUD icon set swaps with the mode.

## Classes

- **Warrior** — dual kits (2H power vs S&S control/block). Crimson / steel / gold.
- **Archer** — Single Arrow, Fan Shot, Fire Arrow (+ fire patch), Rain of Arrows (ground reticle). Orange / gold.
- **Mage** — Arcane Bolt, Fireball (+ fire patch), Frost Orb (+ frost patch), Arcane Ward. Violet / cyan / white.

## Five arenas

| # | Arena | Mood |
|---|-------|------|
| 1 | **Ember Crucible** | Volcanic stone, lava seams, sparks |
| 2 | **Frostveil Circle** | Ice tiles, cyan light, snow |
| 3 | **Stormspire Board** | Basalt, lightning runes, wind |
| 4 | **Umbral Fen** | Obsidian void cracks, magenta fog |
| 5 | **Solar Bastion** | White-gold marble, sunburst seal |

Paths: **Campaign** (Arena 1→5) and **Arena Select** (free pick). Same combat systems; art, lighting, ambient FX, and light modifiers differ.

## Core systems shipped

- Waves, spawn portals, WAVE CLEAR banner + rest, final REALM CLEARED + Restart
- Combo multiplier (2x → 32x style) + floating combat text
- Hearts → Game Over; even waves grant a free sanctum heal pulse
- Wave clear gold bonus; campaign carries **score + gold + HP** between realm boards
- Spend **8 gold** for +1 heart (**H** / heal button)
- Statuses: **Shock/Stun**, **Burn**, **Frost/Slow** (enemy emissive tints)
- Mage **Arcane Ward** damage reduce + reflect pulse
- Ground residuals: fire / frost patches
- Juice: hit-stop, screen shake, crits, ability callouts, damage numbers
- Enemy soft separation + portal spawn invuln
- Stormspire ambient lightning flashes
- Object pooling (projectiles, particles, float text)
- Audio manager (Web Audio procedural SFX)
- Result screen marks **NEW BEST** hi-scores

## Architecture

```
runtime/
  boot.js          entry + renderer
  main.js          loop, state machine, orchestration
  data.js          arenas, classes, abilities, enemies, waves
  input.js         keyboard + touch + joystick
  audio.js         SFX
  pool.js          object pools
  arena.js         board geometry / lighting / ambient FX
  chars.js         procedural chibi meshes + weapons
  player.js        movement, facing, abilities, block, mode swap
  enemy.js         AI, HP, statuses
  combat.js        hit detection, projectiles, ground effects
  fx.js            particles, shake, hitstop, float text
  ui.js            menus, HUD, radials, banners
```

State flow: `Menu → ClassSelect → ArenaSelect → Playing → WaveClear → ArenaClear / Victory / GameOver`

## Art notes (Meshy / xAI / Arcane Realms)

- **Boards**: procedural discs + canvas rune textures + emissive rims (Arcane Realms–style framing without copying TCG assets). Optional: drop floor albedo PNGs into `assets/floors/` and wire in `arena.js`.
- **Characters**: procedural low-poly chibi silhouettes (no commercial assets). Meshy GLBs can replace `chars.js` builders later (`assets/models/`).
- **xAI / Grok**: naming, banner copy, arena flavor (Ember Crucible, etc.).
- **Color language**: crimson, ember-orange, gold primary; deep violet / midnight blue / bone white secondary — not jade-green ninja identity.

## High score

Local storage:
- `sanctum_assault_hiscore` — best single-run score
- `sanctum_assault_campaign_best` — farthest campaign realm cleared (1–5)

## License / IP

Original game design and naming. Do not ship trademarked third-party art or names.
