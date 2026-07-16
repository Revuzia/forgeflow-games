# Grid Rush

Standalone neon **hover-circuit racer** for the browser. Not part of Neon Veil.

**Tagline:** Prism rails. Data Orbs. Original gadgets.

## Play

```bash
# from this folder
npx --yes serve -p 8788 .
# open http://localhost:8788/
```

Or any static server. Requires HTTP (not `file://`) for ES modules + Three.js CDN.

## Features

- 6 original chassis (Prism Sled, Volt Runner, Glass Phantom, Mag-Drill, Echo Wedge, Nova Disc)
- 5 circuits with distinct palettes
- 10 original gadgets (Pulse Mine, Phase Skate, Volt Lash, Gravity Well, Mirror Fog, Overclock, EMP Bloom, Data Siphon, Warp Anchor, Static Veil)
- Drift → turbine charge → SHIFT burst
- AI rivals, rubber banding, racer collisions
- Data Orb item pads, hazards, minimap, standings
- WebAudio SFX + synthwave music bed

## Controls

| Key | Action |
|-----|--------|
| A / D or ← → | Steer |
| W / ↑ | Throttle |
| S / ↓ | Brake |
| SPACE | Drift |
| SHIFT | Turbine burst |
| E / LMB | Use gadget |
| Esc | Pause |

## Verify

```bash
node selftest.mjs
```

## Stack

Three.js 0.170 via importmap CDN · ES modules under `runtime/` · no bundler.

## Do not

- Merge into Neon Veil
- Copy Mario Kart item names/silhouettes
