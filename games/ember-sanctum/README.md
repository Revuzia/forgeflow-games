# Ember Sanctum

Isometric 3D arena wave-survival — five story realms with named Wardens
(pre-fight dialogue + 15 telegraphed signature attacks) and a PVP Arena
(Duel of Champions / Ember Rush / Last Sanctum) vs an AI rival champion.

## ⚠ This folder is the BUILT deploy copy

The **source of truth is `F:\GrokUI\projects\default`** (Vite + npm three,
GrokBuild's home for this game). Do not hand-edit the hashed bundle here.

To ship an update:

```bash
cd /d F:\GrokUI\projects\default
npm run build
# copy dist\* over this folder (keep game_meta.json / content.json / thumbnail.png / README / CHANGELOG)
python pipeline/deploy_game.py --game-dir games/ember-sanctum --slug ember-sanctum
```

`game_controls.js` (fullscreen/mute bar) ships from the source project's
`public/` — it is part of the build output.

## v3.0.0 highlights (2026-07-10)
- Boss confrontation dialogue (back-and-forth exchanges, skip, story beats)
- Per-realm boss signature attack kits (3 specials × 5 Wardens, all telegraphed)
- Boss names on realm/level select (no more "Boss L5")
- PVP Arena: Duel of Champions (Bo3) · Ember Rush (120s score race) · Last Sanctum (survival) vs AI rival champion — online rivals planned behind the same interface
- Fullscreen buttons (title / pause / HUD) + ForgeFlow page control bar
- Campaign story epilogue after the Solar Archon falls
