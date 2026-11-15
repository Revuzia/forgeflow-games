# ForgeFlow Games — Pipeline Rebuild Specification
**Created:** 2026-04-15
**Status:** Ready for implementation
**Priority:** Critical — this is the foundation for a Poki/CrazyGames competitor

## Why Rebuild
The v1 pipeline was a single Claude prompt → entire game → string-matching QA. This produced Jungle Surge — colored rectangles with broken physics. Unacceptable. The rebuild must function like a full game development team.

## Architecture: 8-Role Pipeline

### Role 1: Researcher
- Deep-dive every mechanic, enemy, boss, level of the original game
- WebSearch + wiki extraction → structured JSON across 12 categories
- Output: `research/raw_research.json` (enemies, bosses, levels, controls, progression, visual style, audio)

### Role 2: Game Designer
- Takes research → creates 100% original IP
- Full GDD with original names, characters, worlds, story
- Must capture the same FUN FACTOR, not just mechanics
- Output: `design/gdd.json`

### Role 3: Engine Builder
- Uses pre-built Phaser.js genre templates (NOT from scratch each time)
- 4 templates: Platformer, Top-Down, Clicker/Puzzle, Endless Runner
- Each template: scene structure, physics, asset loading, score system, Playwright test hooks
- LLM fills in GAME-SPECIFIC logic on top of template
- Output: Phaser project scaffold with game-specific code

### Role 4: Artist
- PRIMARY: Kenney.nl CC0 asset packs (60,000+ assets, production quality)
- SECONDARY: PixelLab API for custom sprites ($0.01/sprite)
- TERTIARY: Procedural generation via Phaser Graphics API
- Must download and integrate real sprite sheets, not draw rectangles in code
- Output: `assets/` folder with sprites, tilesets, audio

### Role 5: Level Designer
- Hand-crafted levels using Tiled JSON format (or programmatic tilemap generation)
- Must match original game's difficulty curve from research
- Each level: unique layout, enemy placement, collectible placement, secret areas
- Minimum 5 levels for simple games, 10+ for complex
- Output: `assets/tilemaps/level_N.json`

### Role 6: QA Tester (Playwright-based)
- Actually PLAYS the game in a headless browser
- Tests via `page.evaluate()` reading game state from `window.__TEST__`
- Every game exposes: `{ getPlayer(), getScore(), getLives(), getEnemies(), getCurrentScene(), getLevel() }`
- Test cases per game type:

**All games:**
- Game starts without errors
- Start screen → gameplay transition works
- Score increments correctly
- Lives/health decrease on damage
- Game over screen appears at 0 lives
- Restart works from game over
- Pause/resume works

**Platformers:**
- Arrow keys move player (x position changes)
- Jump works (y position decreases then increases)
- Gravity pulls player down
- Ground collision stops fall
- Platform collision (can stand on platforms)
- Enemy contact damages player
- Stomping enemy kills it
- Collectible pickup increases score
- Level end triggers transition

**RPGs/Adventure:**
- Movement in 4/8 directions
- Attack action damages enemies
- Enemy HP decreases on hit
- Items can be picked up
- Inventory system works
- NPC dialog triggers
- Quest/objective tracking

**Board Games:**
- Piece placement works
- Turn rotation works
- Win condition triggers
- Invalid moves are rejected
- Score/resource tracking

### Role 7: Debugger
- Receives QA failures
- Reads the specific test failure + game code
- Generates targeted fix (not rewrite)
- Re-runs failed tests to verify fix
- Max 3 debug iterations before escalating

### Role 8: Deployer
- Production build via Vite/Webpack
- Upload to R2 (all files in game folder)
- Insert metadata into Supabase
- Generate thumbnail (screenshot of gameplay)
- Telegram notification
- Verify game loads on forgeflowgames.com

## Multi-Night Build Schedule

### Night 1: Research + Design + Foundation (~3 hours)
- Phase 1: Deep research (20 min)
- Phase 2: GDD creation (15 min)
- Phase 3: Download Kenney assets for this genre (10 min)
- Phase 4: Scaffold Phaser project from genre template (10 min)
- Phase 5: Implement player with sprites + physics (30 min)
- Phase 6: First level geometry/tilemap (30 min)
- Checkpoint: Player moves on screen with real sprites

### Night 2: Enemies + Core Loop (~3 hours)
- Phase 7: Enemy classes with AI behaviors (45 min)
- Phase 8: Collision system (damage, death, respawn) (30 min)
- Phase 9: Collectibles + power-ups (30 min)
- Phase 10: HUD (score, lives, level) (20 min)
- Checkpoint: One level fully playable with enemies and items

### Night 3: Content + Levels (~3 hours)
- Phase 11: Menu scene + game over scene (20 min)
- Phase 12: 4 more levels with increasing difficulty (60 min)
- Phase 13: Level transitions + progression (20 min)
- Phase 14: Boss fight (if applicable) (40 min)
- Checkpoint: Full game with 5+ levels, menu, game over

### Night 4: Polish + Audio (~3 hours)
- Phase 15: Particle effects (hits, deaths, collections) (30 min)
- Phase 16: Screen shake, hit flash, juice effects (20 min)
- Phase 17: Sound effects integration (30 min)
- Phase 18: Background music (20 min)
- Phase 19: Visual polish pass (backgrounds, parallax) (30 min)
- Checkpoint: Polished game with audio and effects

### Night 5: QA + Deploy (~3 hours)
- Phase 20: Write Playwright test suite (30 min)
- Phase 21: Run tests, collect failures (15 min)
- Phase 22: Debug and fix failures (60 min)
- Phase 23: Re-run tests until passing (15 min)
- Phase 24: Production build (10 min)
- Phase 25: Deploy to R2 + Supabase (10 min)
- Phase 26: Verify on forgeflowgames.com (5 min)
- Checkpoint: Published, tested, live game

## Genre Templates to Build First

### Template 1: Platformer (covers 12 games from master list)
- Phaser Arcade Physics with gravity
- Player: run, jump, double-jump, wall-slide
- Tilemap-based levels (Tiled JSON)
- Enemy patrol + chase AI
- Collectibles (coins/gems)
- Kenney Pixel Platformer pack

### Template 2: Top-Down Adventure (covers 10 games)
- Phaser Arcade Physics, no gravity
- 8-directional movement
- Sword/attack mechanic
- Tilemap with collision layers
- NPC interaction system
- Kenney RPG pack

### Template 3: Board Game (covers 11 games)
- No physics
- Turn-based state machine
- Grid-based interaction
- Mouse/touch input only
- Multiplayer turn rotation (local)
- Kenney Board Game pack

### Template 4: ARPG / Dungeon Crawler (covers 10 games)
- Phaser Arcade Physics, top-down
- Click-to-move or WASD
- Enemy waves, loot drops
- Inventory/equipment system
- Procedural dungeon generation
- Kenney RPG Urban pack

## Technology Stack
- **Engine:** Phaser 3.90 (stable)
- **Physics:** Arcade Physics (90% of games), Matter.js (physics puzzles only)
- **Build:** Vite
- **Art:** Kenney.nl CC0 packs + PixelLab API for custom sprites
- **Audio:** Kenney audio packs + freesound.org (CC0)
- **Tilemaps:** Tiled JSON format (programmatically generated)
- **QA:** Playwright with `window.__TEST__` game state hooks
- **Deploy:** Cloudflare R2 + Supabase + Workers CDN

## Game Selection Strategy
Instead of going 1-55 in order, build variety across categories:
- Week 1: 1 platformer, 1 board game (fill 2 categories)
- Week 2: 1 adventure, 1 puzzle (fill 2 more)
- Week 3: 1 ARPG, 1 platformer (deepen categories)
- This ensures the website has games in every category early

## Files to Create
- `scripts/run_game_pipeline.py` — Main orchestrator (REWRITE from scratch)
- `forgeflow-games/pipeline/templates/platformer/` — Phaser platformer template
- `forgeflow-games/pipeline/templates/topdown/` — Phaser top-down template
- `forgeflow-games/pipeline/templates/boardgame/` — Board game template
- `forgeflow-games/pipeline/templates/arpg/` — ARPG template
- `forgeflow-games/pipeline/qa/test_runner.py` — Playwright QA automation
- `forgeflow-games/pipeline/qa/test_cases/` — Per-genre test suites
- `forgeflow-games/pipeline/assets/kenney_manifest.json` — Available asset packs
- `forgeflow-games/pipeline/art/sprite_generator.py` — PixelLab API integration

## Critical Rules
1. NEVER generate an entire game in one prompt
2. EVERY game uses Phaser.js framework, not raw Canvas
3. EVERY game uses real sprite assets (Kenney or PixelLab), not colored rectangles
4. EVERY game has Playwright QA that actually plays the game
5. EVERY game spans 3-5 nights minimum
6. EVERY game exposes `window.__TEST__` for QA hooks
7. Genre templates are built ONCE and reused across all games in that genre
8. Quality bar: would this game be accepted on Poki? If not, don't deploy.
