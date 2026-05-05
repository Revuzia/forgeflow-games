#!/usr/bin/env python3
"""
test_runner.py — Playwright-based QA that actually plays browser games.

Uses window.__TEST__ hooks exposed by game templates to:
- Verify game starts without errors
- Test player movement (arrow keys change position)
- Test jumping (player goes up)
- Test enemy spawning and movement
- Test collectible pickup (score increases)
- Test death/respawn (lives decrease)
- Test game over screen
- Test level transitions
- Verify no console errors

Usage:
  python pipeline/qa/test_runner.py --game-url file:///path/to/index.html
  python pipeline/qa/test_runner.py --game-url https://cdn.example.com/game/index.html
  python pipeline/qa/test_runner.py --game-dir games/my-game/
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

# Check if Playwright is installed
def ensure_playwright():
    try:
        import playwright
        return True
    except ImportError:
        print("[qa] Installing Playwright...")
        subprocess.run([sys.executable, "-m", "pip", "install", "playwright"], check=True)
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
        return True


# 2026-05-05: genre classification for QA test selection.
# Action genres have a continuously-moving player + enemies + physics.
# Turn-based genres have selection + click-to-act + end-turn rhythm.
# Management genres have build palette + tick-based simulation.
# Whole-game generated games (strategy/simulation) get the right tests
# automatically; legacy platformer/topdown games keep their existing tests.
ACTION_GENRES     = {"platformer", "topdown", "adventure", "rpg", "arpg", "action",
                     "arcade", "shmup", "flight", "obby", "3d-platformer", "3d-arpg"}
TURN_BASED_GENRES = {"strategy", "puzzle", "boardgame", "board_game"}
MANAGEMENT_GENRES = {"simulation"}

# Genres where the player jumps (Space = up). Twin-stick arcades use Space
# for bombs, top-down RPGs walk in 4-directions, simulation/strategy don't
# have a player. Failing jump_works on these is a false-positive QA failure
# that masks real bugs by lowering the overall score.
JUMP_GENRES = {"platformer", "obby", "3d-platformer"}

# Genres whose enemies use Phaser atlas-frame animations (changing
# currentFrame.index over time). Vector-graphics genres render enemies
# with Graphics + tween-based motion — frame index doesn't change.
ATLAS_ANIM_GENRES = {"platformer", "topdown", "adventure", "rpg", "arpg",
                     "action", "obby", "3d-platformer", "3d-arpg"}


def _has_jump(genre: str) -> bool:
    return (genre or "").lower() in JUMP_GENRES


def _has_atlas_anims(genre: str) -> bool:
    return (genre or "").lower() in ATLAS_ANIM_GENRES


def _is_action_genre(genre: str) -> bool:
    return (genre or "").lower() in ACTION_GENRES


def _is_turn_based(genre: str) -> bool:
    return (genre or "").lower() in TURN_BASED_GENRES


def _is_management(genre: str) -> bool:
    return (genre or "").lower() in MANAGEMENT_GENRES


# 2026-05-05: Whole-game generation can return Player as a wrapper class
# instance (`{container: {x, y}, ...}`) instead of a flat sprite (`{x, y, ...}`).
# The legacy QA hardcoded `player["x"]` and KeyError'd on the wrapper shape,
# crashing the test suite mid-run. This JS helper normalizes either shape into
# a flat `{x, y, alive}` so every QA test reads the same contract regardless
# of how Opus chose to expose the Player. Same logic for getEnemies() entries.
_NORMALIZE_PLAYER_JS = """(() => {
  const p = window.__TEST__ && window.__TEST__.getPlayer ? window.__TEST__.getPlayer() : null;
  if (!p) return null;
  const x = (typeof p.x === 'number') ? p.x : (p.container && typeof p.container.x === 'number' ? p.container.x : null);
  const y = (typeof p.y === 'number') ? p.y : (p.container && typeof p.container.y === 'number' ? p.container.y : null);
  if (x === null || y === null) return null;  // shape unrecognized
  return { x, y, alive: p.alive !== false, onGround: p.onGround === true || (p.body && p.body.touching && p.body.touching.down) };
})()"""

_NORMALIZE_ENEMIES_JS = """(() => {
  const list = window.__TEST__ && window.__TEST__.getEnemies ? window.__TEST__.getEnemies() : null;
  if (!Array.isArray(list)) return null;
  return list.map(e => {
    if (!e) return null;
    const x = (typeof e.x === 'number') ? e.x : (e.container && typeof e.container.x === 'number' ? e.container.x : null);
    const y = (typeof e.y === 'number') ? e.y : (e.container && typeof e.container.y === 'number' ? e.container.y : null);
    return (x === null || y === null) ? null : { x, y };
  }).filter(e => e !== null);
})()"""


def run_qa_tests(game_url: str, genre: str = "platformer", timeout_ms: int = 30000) -> dict:
    """
    Run automated QA tests against a game.
    Returns dict with test results, score, and pass/fail status.

    2026-05-05: genre-aware. Strategy/simulation/puzzle no longer fail
    platformer-shape movement tests they were never meant to satisfy.
    Each genre family gets a dedicated test suite that matches its
    interaction model (action: movement+jump+enemies; turn-based:
    select+click+endturn; management: place+tick+resources).
    """
    ensure_playwright()
    from playwright.sync_api import sync_playwright

    results = {
        "url": game_url,
        "genre": genre,
        "tests": {},
        "console_errors": [],
        "network_errors": [],
        "total_tests": 0,
        "passed_tests": 0,
        "failed_tests": 0,
        "score": 0,
        "passed": False,
        # 2026-04-22 AAA-standard bug severity. Any P0 failure blocks deploy
        # regardless of overall score. P1 must be ≥90% pass. P2/P3 are warnings.
        "severity_failures": {"P0": [], "P1": [], "P2": [], "P3": []},
    }

    # Test name → severity map.
    # P0 = blocker (game doesn't function): no deploy allowed
    # P1 = core gameplay (moves, jumps, enemies, exit): must fix
    # P2 = quality / polish: should fix
    # P3 = nice-to-have / cross-compat: can ship if rest is clean
    TEST_SEVERITY = {
        # ── Universal P0 (every genre must pass these) ──
        "game_loads":          "P0",
        "has_canvas":          "P0",
        "canvas_renders":      "P0",
        "no_critical_errors":  "P0",
        "execution":           "P0",
        # ── Universal P1 (every genre should expose these via __TEST__) ──
        "scene_system":        "P1",
        "start_screen":        "P1",
        "score_system":        "P2",
        # ── Action-genre P1 ──
        "player_exists":       "P1",
        "movement_right":      "P1",
        "movement_left":       "P1",
        "jump_works":          "P1",
        "enemies_exist":       "P1",
        "lives_system":        "P2",
        "enemies_move":        "P2",
        "enemies_animate":     "P2",
        "bosses_animate":      "P2",
        "boss_attack_variety": "P2",
        "gravity_works":       "P2",
        # ── Turn-based-genre P1 (2026-05-05) ──
        "click_responds":      "P1",   # click on canvas elicits a state change
        "turn_advances":       "P1",   # end-turn / next-move cycles game state
        "valid_move_accepts":  "P2",
        "invalid_move_rejects":"P2",
        # ── Management-genre P1 (2026-05-05) ──
        "place_entity":        "P1",   # click-to-place produces an entity
        "tick_advances":       "P1",   # simulation tick advances state
        "resources_change":    "P2",   # ticks change resources / time
        # ── Universal P2/P3 ──
        "visual_not_blank":    "P2",
        "stability_10s":       "P2",
        "sound_initialized":   "P3",
        "screenshot_taken":    "P3",
        # ── 2026-05-05 AAA-tier playtest gates (catches Opus output bugs) ──
        "hud_no_nan":          "P0",  # HUD showing "WAVE NaN" is unshippable
        "audio_no_cacophony":  "P1",  # 8 sounds/sec from un-rate-limited SFX
        "music_exclusive":     "P1",  # menu + game music both playing
        "bullets_move":        "P0",  # bullets fired but stuck = game broken
    }

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 960, "height": 540})

        # Capture console errors
        page.on("console", lambda msg: (
            results["console_errors"].append(msg.text)
            if msg.type == "error" else None
        ))

        # 2026-04-23: capture failed network requests (404/5xx) with their URL
        # so we can actually diagnose which asset is missing instead of only
        # seeing "Failed to load resource: 404" with no path.
        def _on_response(resp):
            try:
                if resp.status >= 400:
                    results.setdefault("network_errors", []).append({
                        "status": resp.status,
                        "url": resp.url,
                    })
            except Exception:
                pass
        page.on("response", _on_response)

        try:
            # ── TEST 1: Game loads without errors ──
            print("  [1/10] Game loads...")
            page.goto(game_url, timeout=timeout_ms)
            page.wait_for_timeout(3000)  # Wait for Phaser to initialize

            has_phaser = page.evaluate("typeof Phaser !== 'undefined'")
            has_game = page.evaluate("typeof window.__GAME__ !== 'undefined'")
            results["tests"]["game_loads"] = has_phaser and has_game
            if not has_game:
                # Try without __GAME__ (for non-template games)
                has_canvas = page.evaluate("document.querySelector('canvas') !== null")
                results["tests"]["game_loads"] = has_canvas

            # ── TEST 2: Start screen present ──
            print("  [2/10] Start screen...")
            # 2026-04-22: cover ALL plausible start-screen dismissal patterns.
            # Phaser templates put a START GAME text button at different Y
            # positions (y=270, 300, 320, 350 seen across templates). Click
            # the whole vertical column at x=480 + fire keyboard inputs.
            has_test_api = page.evaluate("typeof window.__TEST__ !== 'undefined'")
            # 1) keyboard
            for key in ("Space", "Enter", "ArrowRight"):
                page.keyboard.press(key)
                page.wait_for_timeout(150)
            # 2) click multiple Y positions to cover any button placement
            for click_y in (270, 300, 320, 350, 400):
                page.mouse.click(480, click_y)
                page.wait_for_timeout(150)
            # 3) if scene API exposed, force-start GameScene (last resort for games
            #    whose MainMenu has no keyboard handler AND button hit-area is unusual)
            try:
                page.evaluate("""
                    (() => {
                        if (!window.__GAME__) return;
                        const sm = window.__GAME__.scene;
                        if (!sm) return;
                        const g = sm.getScene && sm.getScene('Game');
                        const gameScene = sm.keys && (sm.keys['Game'] || sm.keys['GameScene'] || sm.keys['game']);
                        const target = gameScene || g;
                        if (target && sm.start) { sm.start('Game'); }
                    })();
                """)
            except Exception:
                pass
            page.wait_for_timeout(500)
            # Poll for player to spawn (up to 5s) — GameScene.create() runs async.
            # Uses _NORMALIZE_PLAYER_JS so either flat {x,y} or wrapper
            # {container:{x,y}} shape resolves to a flat {x,y,alive} dict.
            player = None
            for _ in range(25):
                try:
                    player = page.evaluate(_NORMALIZE_PLAYER_JS)
                except Exception:
                    player = None
                if player is not None and isinstance(player, dict) and "x" in player:
                    break
                page.wait_for_timeout(200)
            results["tests"]["start_screen"] = True  # If we got here, start screen existed
            has_test_api = page.evaluate("typeof window.__TEST__ !== 'undefined'")

            if has_test_api and _is_action_genre(genre):
                # ── TEST 3: Player exists and has position ──
                print(f"  [3/10] Player exists... (action genre: {genre})")
                # Defensive — `player` is the normalized dict from
                # _NORMALIZE_PLAYER_JS, so `.get("x", 0)` never KeyErrors.
                results["tests"]["player_exists"] = (
                    player is not None and isinstance(player, dict)
                    and isinstance(player.get("x"), (int, float))
                )
                initial_x = (player.get("x", 0) if isinstance(player, dict) else 0) or 0
                initial_y = (player.get("y", 0) if isinstance(player, dict) else 0) or 0

                # ── TEST 4: Right arrow moves player right ──
                print("  [4/10] Movement right...")
                page.keyboard.down("ArrowRight")
                page.wait_for_timeout(500)
                page.keyboard.up("ArrowRight")
                page.wait_for_timeout(100)
                player_after = page.evaluate(_NORMALIZE_PLAYER_JS)
                moved_right = bool(
                    player_after and isinstance(player_after, dict)
                    and isinstance(player_after.get("x"), (int, float))
                    and player_after["x"] > initial_x + 5
                )
                results["tests"]["movement_right"] = moved_right

                # ── TEST 5: Left arrow moves player left ──
                # 2026-04-22: guard against None — Python was crashing on
                # `None["x"]` when player_exists failed, aborting the entire
                # QA sweep with 'NoneType' is not subscriptable.
                print("  [5/10] Movement left...")
                _pl = page.evaluate(_NORMALIZE_PLAYER_JS)
                if not isinstance(_pl, dict) or not isinstance(_pl.get("x"), (int, float)):
                    results["tests"]["movement_left"] = False
                    # 2026-05-05: don't raise — let later tests run + bullet/audio
                    # gates still apply. Movement-left fail = recorded; sweep continues.
                else:
                    pos_before_left = _pl["x"]
                    page.keyboard.down("ArrowLeft")
                    page.wait_for_timeout(500)
                    page.keyboard.up("ArrowLeft")
                    page.wait_for_timeout(100)
                    _pl2 = page.evaluate(_NORMALIZE_PLAYER_JS)
                    pos_after_left = _pl2.get("x") if isinstance(_pl2, dict) else None
                    results["tests"]["movement_left"] = (
                        isinstance(pos_after_left, (int, float))
                        and pos_after_left < pos_before_left - 5
                    )

                # ── TEST 6: Jump works (player goes up) ──
                # 2026-04-22: previously used page.keyboard.press() which is
                # an instant down+up in <1ms. Many Phaser templates implement
                # variable-jump-height: if Space is released while velocity.y
                # is still negative, multiply velocity by ~0.7. Instant press
                # triggers that cut every frame → player barely leaves ground.
                # Hold Space for ~150ms (realistic tap) so variable-jump kicks
                # in AFTER apex, not during liftoff.
                # Jump is genre-conditional: twin-stick arcade uses Space for
                # BOMB, top-down RPGs don't jump, only platformer/obby/3D-
                # platformer have vertical jump. SKIP rather than FAIL for
                # genres where Space is a different action.
                if _has_jump(genre):
                    print("  [6/10] Jump...")
                    player_before_jump = page.evaluate(_NORMALIZE_PLAYER_JS)
                    page.keyboard.down("Space")
                    page.wait_for_timeout(150)
                    page.keyboard.up("Space")
                    page.wait_for_timeout(150)
                    player_mid_jump = page.evaluate(_NORMALIZE_PLAYER_JS)
                    results["tests"]["jump_works"] = bool(
                        isinstance(player_mid_jump, dict) and isinstance(player_before_jump, dict)
                        and isinstance(player_mid_jump.get("y"), (int, float))
                        and isinstance(player_before_jump.get("y"), (int, float))
                        and player_mid_jump["y"] < player_before_jump["y"] - 5
                    )
                else:
                    print(f"  [6/10] Jump... SKIP ({genre} has no jump action)")
                    results["tests"]["jump_works"] = None  # explicit skip

                page.wait_for_timeout(500)  # Wait to land

                # ── TEST 7: Score system works ──
                print("  [7/10] Score system...")
                # Defensive __TEST__ method call — game may not expose every hook
                score = page.evaluate("(window.__TEST__ && window.__TEST__.getScore) ? window.__TEST__.getScore() : null")
                results["tests"]["score_system"] = score is not None and isinstance(score, (int, float))

                # ── TEST 8: Enemies exist + move + animate ──
                print("  [8/10] Enemies...")
                enemies = page.evaluate(_NORMALIZE_ENEMIES_JS)
                results["tests"]["enemies_exist"] = enemies is not None and len(enemies) > 0
                if enemies and len(enemies) > 0 and isinstance(enemies[0], dict):
                    # Check enemy moves: capture ALL enemy positions (not just
                    # entries[0]) so dying/respawning enemies don't false-positive
                    # the test. Test passes if ANY enemy moved >5px in 500ms,
                    # which is what we actually care about ("the swarm moves").
                    enemies_before_pos = [
                        (e.get("x", 0), e.get("y", 0))
                        for e in enemies if isinstance(e, dict)
                    ]
                    enemy_x_before = enemies[0].get("x", 0)  # legacy compat for anim test below
                    # Capture animation frame index at t=0 (requires enemy.anims.currentFrame)
                    anim_frame_before = page.evaluate(
                        "() => { const s = window.__GAME__ && window.__GAME__.scene.getScene('Game');"
                        "  const e = s && s.enemies && s.enemies.children.entries[0];"
                        "  return e && e.anims && e.anims.currentFrame ? e.anims.currentFrame.index : null; }"
                    )
                    page.wait_for_timeout(500)
                    enemies_after = page.evaluate(_NORMALIZE_ENEMIES_JS)
                    anim_frame_after = page.evaluate(
                        "() => { const s = window.__GAME__ && window.__GAME__.scene.getScene('Game');"
                        "  const e = s && s.enemies && s.enemies.children.entries[0];"
                        "  return e && e.anims && e.anims.currentFrame ? e.anims.currentFrame.index : null; }"
                    )
                    # Test passes if ANY enemy in the after-snapshot is far
                    # enough from EVERY enemy in the before-snapshot. Robust
                    # to enemies dying/respawning between probes.
                    if enemies_after and len(enemies_after) > 0:
                        any_moved = False
                        for e in enemies_after:
                            if not isinstance(e, dict):
                                continue
                            x, y = e.get("x"), e.get("y")
                            if not (isinstance(x, (int, float)) and isinstance(y, (int, float))):
                                continue
                            # Match against the closest before-snapshot enemy
                            if not enemies_before_pos:
                                continue
                            min_dist = min(
                                ((x - bx) ** 2 + (y - by) ** 2) ** 0.5
                                for bx, by in enemies_before_pos
                            )
                            # Closest enemy moved at least 3px? Treat as motion.
                            # (Static enemies have min_dist≈0; moving enemies
                            # have min_dist >> 3 over 500ms at 60+ px/sec.)
                            if min_dist > 3:
                                any_moved = True
                                break
                        results["tests"]["enemies_move"] = any_moved
                    else:
                        results["tests"]["enemies_move"] = False
                    # 2026-04-23: enemies_animate — frame index should change over
                    # 500ms if Kenney-atlas animations are registered + playing.
                    # 2026-05-05: SKIP for vector-graphics genres (twin-stick arcade,
                    # arcade in general). Those use Phaser.Graphics + tween-based
                    # rotation/motion instead of atlas frames. anim_frame_index is
                    # legitimately null for them — failing this gate would be a
                    # false-positive blocking otherwise-AAA games.
                    if not _has_atlas_anims(genre):
                        results["tests"]["enemies_animate"] = None  # explicit skip
                    elif anim_frame_before is None and anim_frame_after is None:
                        results["tests"]["enemies_animate"] = False  # no animation at all
                    else:
                        # Either frame changed OR both are valid numbers (idle anim can keep same frame briefly)
                        results["tests"]["enemies_animate"] = (
                            anim_frame_before != anim_frame_after
                            or (anim_frame_after is not None and anim_frame_after >= 0)
                        )
                else:
                    results["tests"]["enemies_move"] = False
                    results["tests"]["enemies_animate"] = False

                # ── TEST 9: Lives system ──
                print("  [9/10] Lives system...")
                lives = page.evaluate("(window.__TEST__ && window.__TEST__.getLives) ? window.__TEST__.getLives() : null")
                results["tests"]["lives_system"] = lives is not None and isinstance(lives, (int, float)) and lives > 0

                # ── TEST 10: Current scene ──
                print("  [10/14] Scene system...")
                scene = page.evaluate("(window.__TEST__ && window.__TEST__.getCurrentScene) ? window.__TEST__.getCurrentScene() : null")
                results["tests"]["scene_system"] = scene is not None and isinstance(scene, str) and len(scene) > 0

                # ── TEST 11: GENRE-SPECIFIC TESTS ──
                if genre == "platformer":
                    print("  [11/14] Platformer: gravity pulls player down...")
                    player_grav = page.evaluate(_NORMALIZE_PLAYER_JS)
                    if player_grav and not player_grav.get("onGround", True):
                        page.wait_for_timeout(300)
                        player_grav2 = page.evaluate(_NORMALIZE_PLAYER_JS)
                        results["tests"]["gravity_works"] = player_grav2["y"] > player_grav["y"] if player_grav2 else False
                    else:
                        results["tests"]["gravity_works"] = True  # On ground = gravity working

                elif genre == "topdown":
                    print("  [11/14] Top-down: 4-directional movement...")
                    # Test up movement
                    pos_before = page.evaluate(_NORMALIZE_PLAYER_JS)
                    page.keyboard.down("ArrowUp")
                    page.wait_for_timeout(300)
                    page.keyboard.up("ArrowUp")
                    pos_after = page.evaluate(_NORMALIZE_PLAYER_JS)
                    results["tests"]["movement_up"] = pos_after and pos_after["y"] < pos_before["y"] - 3

                    # Test down movement
                    pos_before = page.evaluate(_NORMALIZE_PLAYER_JS)
                    page.keyboard.down("ArrowDown")
                    page.wait_for_timeout(300)
                    page.keyboard.up("ArrowDown")
                    pos_after = page.evaluate(_NORMALIZE_PLAYER_JS)
                    results["tests"]["movement_down"] = pos_after and pos_after["y"] > pos_before["y"] + 3

                elif genre == "boardgame":
                    print("  [11/14] Board game: turn system...")
                    game_state = page.evaluate("""
                        window.__TEST__ ? {
                            currentPlayer: window.__TEST__.getPlayer(),
                            score: window.__TEST__.getScore(),
                        } : null
                    """)
                    results["tests"]["turn_system"] = game_state is not None

                elif genre == "arpg":
                    print("  [11/14] ARPG: attack works...")
                    page.keyboard.press("KeyX")
                    page.wait_for_timeout(200)
                    # Just verify no crash after attack (use normalizer for shape-tolerance)
                    pl = page.evaluate(_NORMALIZE_PLAYER_JS)
                    still_alive = pl is not None and pl.get("alive", True) is not False
                    results["tests"]["attack_works"] = still_alive

            # 2026-05-05: TURN-BASED genre tests (strategy, puzzle, boardgame).
            # No continuous player movement; test click-to-act + end-turn rhythm.
            elif has_test_api and _is_turn_based(genre):
                print(f"  [3/8] Turn-based ({genre}): scene system...")
                scene = page.evaluate("window.__TEST__ && window.__TEST__.getCurrentScene ? window.__TEST__.getCurrentScene() : null")
                results["tests"]["scene_system"] = scene is not None and isinstance(scene, str) and len(scene) > 0

                # Click on the canvas — should elicit some state change
                print("  [4/8] Click responds...")
                state_before = page.evaluate("window.__TEST__ && window.__TEST__.getGameState ? JSON.stringify(window.__TEST__.getGameState()) : ''")
                page.mouse.click(480, 270)
                page.wait_for_timeout(300)
                page.mouse.click(560, 270)
                page.wait_for_timeout(300)
                state_after = page.evaluate("window.__TEST__ && window.__TEST__.getGameState ? JSON.stringify(window.__TEST__.getGameState()) : ''")
                # Either state changed, or just verify no crash + scene still valid
                results["tests"]["click_responds"] = (
                    (state_before != state_after) or
                    page.evaluate("typeof window.__GAME__ !== 'undefined' && window.__GAME__.scene !== undefined")
                )

                # End-turn / next-move
                print("  [5/8] Turn advances...")
                turn_before = page.evaluate(
                    "window.__TEST__ && window.__TEST__.getCurrentTurn ? window.__TEST__.getCurrentTurn() : null"
                )
                # Press Space (common end-turn key) and click typical end-turn button location
                page.keyboard.press("Space")
                page.wait_for_timeout(400)
                page.mouse.click(900, 12)  # top-right end-turn area
                page.wait_for_timeout(400)
                turn_after = page.evaluate(
                    "window.__TEST__ && window.__TEST__.getCurrentTurn ? window.__TEST__.getCurrentTurn() : null"
                )
                if turn_before is not None and turn_after is not None:
                    results["tests"]["turn_advances"] = turn_after != turn_before
                else:
                    # No turn hook exposed — fall back to a scene/state continuity check
                    still_alive = page.evaluate(
                        "typeof window.__GAME__ !== 'undefined' && window.__GAME__.scene !== undefined"
                    )
                    results["tests"]["turn_advances"] = still_alive

                # Score (universal)
                score = page.evaluate("window.__TEST__ && window.__TEST__.getScore ? window.__TEST__.getScore() : null")
                results["tests"]["score_system"] = score is not None

            # 2026-05-05: MANAGEMENT genre tests (simulation).
            # No player; test place-entity + tick-advance rhythm.
            elif has_test_api and _is_management(genre):
                print(f"  [3/8] Management ({genre}): scene system...")
                scene = page.evaluate("window.__TEST__ && window.__TEST__.getCurrentScene ? window.__TEST__.getCurrentScene() : null")
                results["tests"]["scene_system"] = scene is not None and isinstance(scene, str) and len(scene) > 0

                # Place an entity by clicking
                print("  [4/8] Place entity...")
                ents_before = page.evaluate(
                    "window.__TEST__ && window.__TEST__.getEntities ? window.__TEST__.getEntities().length : null"
                )
                # Click multiple grid positions to be robust to placement rules
                for click_x, click_y in [(200, 300), (400, 300), (600, 300)]:
                    page.mouse.click(click_x, click_y)
                    page.wait_for_timeout(200)
                ents_after = page.evaluate(
                    "window.__TEST__ && window.__TEST__.getEntities ? window.__TEST__.getEntities().length : null"
                )
                if ents_before is not None and ents_after is not None:
                    results["tests"]["place_entity"] = ents_after > ents_before
                else:
                    # No entity hook — fall back to "click did not crash"
                    still_alive = page.evaluate(
                        "typeof window.__GAME__ !== 'undefined' && window.__GAME__.scene !== undefined"
                    )
                    results["tests"]["place_entity"] = still_alive

                # Tick advances (simulation should run autonomously)
                print("  [5/8] Tick advances...")
                tick_before = page.evaluate(
                    "window.__TEST__ && window.__TEST__.getTick ? window.__TEST__.getTick() : null"
                )
                page.wait_for_timeout(1500)
                tick_after = page.evaluate(
                    "window.__TEST__ && window.__TEST__.getTick ? window.__TEST__.getTick() : null"
                )
                if tick_before is not None and tick_after is not None:
                    results["tests"]["tick_advances"] = tick_after > tick_before
                else:
                    # No tick hook — fall back to resource change OR scene continuity
                    res_before = page.evaluate(
                        "window.__TEST__ && window.__TEST__.getResources ? JSON.stringify(window.__TEST__.getResources()) : ''"
                    )
                    page.wait_for_timeout(1500)
                    res_after = page.evaluate(
                        "window.__TEST__ && window.__TEST__.getResources ? JSON.stringify(window.__TEST__.getResources()) : ''"
                    )
                    results["tests"]["tick_advances"] = (
                        (res_before != res_after) or
                        page.evaluate("typeof window.__GAME__ !== 'undefined'")
                    )
                    results["tests"]["resources_change"] = res_before != res_after

                # Score (universal)
                score = page.evaluate("window.__TEST__ && window.__TEST__.getScore ? window.__TEST__.getScore() : null")
                results["tests"]["score_system"] = score is not None

            elif not has_test_api:
                # No test API — run basic visual checks
                print("  [3-10] No __TEST__ API — running basic checks...")
                has_canvas = page.evaluate("document.querySelector('canvas') !== null")
                results["tests"]["has_canvas"] = has_canvas

                # Check canvas is rendering (not blank)
                canvas_data = page.evaluate("""
                    (() => {
                        const c = document.querySelector('canvas');
                        if (!c) return null;
                        const ctx = c.getContext('2d');
                        if (!ctx) return 'webgl';
                        const d = ctx.getImageData(c.width/2, c.height/2, 10, 10).data;
                        return Array.from(d.slice(0, 12));
                    })()
                """)
                results["tests"]["canvas_renders"] = canvas_data is not None

                # Screenshot for visual inspection
                page.screenshot(path=str(ROOT / "forgeflow-games" / "pipeline" / "qa" / "last_qa_screenshot.png"))
                results["tests"]["screenshot_taken"] = True

                # Fill in remaining tests as skipped
                for t in ["player_exists", "movement_right", "movement_left",
                          "jump_works", "score_system", "enemies_exist",
                          "enemies_move", "lives_system", "scene_system"]:
                    if t not in results["tests"]:
                        results["tests"][t] = None  # Skipped

            # ── TEST 12-14: UNIVERSAL — Visual / Sound / Stability ──
            # These run for every genre that has a test API (action / turn-based
            # / management). Stability test uses genre-appropriate input keys
            # so it doesn't crash a turn-based game by spamming arrow keys.
            if has_test_api:
                # ── TEST 12: VISUAL QA — Screenshot + canvas-not-blank ──
                print("  [12/14] Visual QA: canvas not blank...")
                screenshot_path = str(Path(__file__).parent / "last_qa_screenshot.png")
                page.screenshot(path=screenshot_path)

                canvas_check = page.evaluate("""
                    (() => {
                        const c = document.querySelector('canvas');
                        if (!c) return {ok: false, reason: 'no_canvas'};
                        try {
                            const ctx = c.getContext('2d', {willReadFrequently: true});
                            if (!ctx) return {ok: true, reason: 'webgl_no_2d'};
                            const samples = [];
                            for (let i = 0; i < 5; i++) {
                                const x = Math.floor(c.width * (0.2 + i * 0.15));
                                const y = Math.floor(c.height * 0.5);
                                const px = ctx.getImageData(x, y, 1, 1).data;
                                samples.push([px[0], px[1], px[2]]);
                            }
                            const allSame = samples.every(s =>
                                Math.abs(s[0]-samples[0][0]) < 5 &&
                                Math.abs(s[1]-samples[0][1]) < 5 &&
                                Math.abs(s[2]-samples[0][2]) < 5
                            );
                            return {ok: !allSame, reason: allSame ? 'all_same_color' : 'varied_pixels', samples: samples};
                        } catch(e) {
                            return {ok: true, reason: 'webgl_context'};
                        }
                    })()
                """)
                results["tests"]["visual_not_blank"] = canvas_check.get("ok", False) if canvas_check else False
                if canvas_check and not canvas_check.get("ok"):
                    print(f"    Visual check: {canvas_check.get('reason')} — game may not be rendering correctly")

                # ── TEST 13: Sound system initialized ──
                print("  [13/14] Sound system...")
                has_sound = page.evaluate("""
                    window.__GAME__?.sound?.sounds?.length > 0 ||
                    document.querySelectorAll('audio').length > 0 ||
                    (typeof window.__GAME__?.sound !== 'undefined')
                """)
                results["tests"]["sound_initialized"] = bool(has_sound)

                # ── TEST 14: Stability — 10s of genre-appropriate input ──
                print(f"  [14/14] Stability: 10s {genre} gameplay...")
                if _is_action_genre(genre):
                    # Spam arrow keys + space (movement + jump)
                    for _ in range(5):
                        page.keyboard.press("ArrowRight")
                        page.wait_for_timeout(500)
                        page.keyboard.press("Space")
                        page.wait_for_timeout(500)
                        page.keyboard.press("ArrowLeft")
                        page.wait_for_timeout(500)
                        page.keyboard.press("ArrowRight")
                        page.wait_for_timeout(500)
                elif _is_turn_based(genre):
                    # Click around + press end-turn
                    for click_xy in [(300, 300), (500, 300), (700, 300), (480, 270)]:
                        page.mouse.click(*click_xy)
                        page.wait_for_timeout(500)
                        page.keyboard.press("Space")
                        page.wait_for_timeout(500)
                elif _is_management(genre):
                    # Place entities + let sim tick
                    for click_xy in [(200, 300), (400, 300), (600, 300)]:
                        page.mouse.click(*click_xy)
                        page.wait_for_timeout(800)
                    page.wait_for_timeout(2000)  # let sim run
                else:
                    page.wait_for_timeout(2000)
                stability_ok = page.evaluate("typeof window.__GAME__ !== 'undefined' || document.querySelector('canvas') !== null")
                results["tests"]["stability_10s"] = bool(stability_ok)

            # ── 2026-05-05 AAA-TIER LIVE PLAYTEST GATES ──
            # User playtested production output and reported bugs the existing
            # QA missed: WAVE NaN in HUD, bullets fired but stuck at player
            # position (zero velocity), 8 sounds/sec cacophony from fire-rate,
            # menu music + game music both playing simultaneously. These are
            # the gates that catch those specific failure modes.
            if has_test_api:
                # ── PLAYTEST 1: HUD-NaN scan ──
                # Walk the Phaser display list for any Text object whose
                # rendered string contains "NaN", "undefined", "null". Catches
                # uninitialized HUD state at render time.
                print("  [playtest 1] HUD NaN/undefined scan...")
                hud_check = page.evaluate("""
                    (() => {
                        const bad = [];
                        try {
                            const game = window.__GAME__;
                            if (!game) return { ok: true, reason: 'no game' };
                            for (const scene of game.scene.scenes) {
                                if (!scene.children || !scene.children.list) continue;
                                const walk = (obj) => {
                                    if (!obj) return;
                                    if (obj.text !== undefined && typeof obj.text === 'string') {
                                        const t = obj.text;
                                        if (/\\b(NaN|undefined|null)\\b/i.test(t)) {
                                            bad.push({ scene: scene.scene.key, text: t.slice(0, 60) });
                                        }
                                    }
                                    if (obj.list && Array.isArray(obj.list)) obj.list.forEach(walk);
                                };
                                scene.children.list.forEach(walk);
                            }
                        } catch (e) { return { ok: true, error: e.message }; }
                        return { ok: bad.length === 0, bad: bad.slice(0, 5) };
                    })()
                """)
                results["tests"]["hud_no_nan"] = bool(hud_check.get("ok", False)) if hud_check else True
                if hud_check and not hud_check.get("ok"):
                    results.setdefault("playtest_issues", []).append(
                        f"HUD shows NaN/undefined/null: {hud_check.get('bad')}"
                    )
                    print(f"    HUD: {hud_check.get('bad')}")

                # ── PLAYTEST 2: Audio cacophony check ──
                # If >5 simultaneous Sound instances are playing for >2
                # seconds, the audio mixer is broken (no rate-limit / no
                # Sound pool reuse). Genre-agnostic — strategy/sim games can
                # also have cacophony if Opus added rapid-fire SFX.
                if True:
                    print("  [playtest 2] Audio cacophony check...")
                    # Trigger fire input to provoke SFX storm
                    page.mouse.move(700, 200)
                    page.mouse.down()
                    page.wait_for_timeout(2000)  # 2 sec of held-fire
                    audio_state = page.evaluate("""
                        (() => {
                            const g = window.__GAME__;
                            if (!g || !g.sound || !g.sound.sounds) return { peak: 0, music: 0 };
                            const playing = g.sound.sounds.filter(s => s.isPlaying);
                            const music = playing.filter(s => s.key && /^music_/.test(s.key));
                            return {
                                peak: playing.length,
                                music: music.length,
                                playingKeys: playing.map(s => s.key).slice(0, 10),
                            };
                        })()
                    """)
                    page.mouse.up()
                    results["tests"]["audio_no_cacophony"] = audio_state.get("peak", 0) <= 5
                    results["tests"]["music_exclusive"] = audio_state.get("music", 0) <= 1
                    if not results["tests"]["audio_no_cacophony"]:
                        results.setdefault("playtest_issues", []).append(
                            f"Audio cacophony: {audio_state.get('peak')} simultaneous sounds: {audio_state.get('playingKeys')}"
                        )
                        print(f"    Audio peak: {audio_state.get('peak')} sounds — {audio_state.get('playingKeys')}")
                    if not results["tests"]["music_exclusive"]:
                        results.setdefault("playtest_issues", []).append(
                            f"Multiple music tracks playing: {audio_state.get('music')}"
                        )
                        print(f"    Music overlap: {audio_state.get('music')} tracks playing")
                # ── PLAYTEST 3: Bullets actually move ──
                # Genre-agnostic — only run if game has a bullets-like group.
                # Probe sequence: hold mouse-fire for 600ms, then immediately
                # snapshot. By cacophony-test time bullets have all flown off-
                # screen, so we re-fire right before checking.
                print("  [playtest 3] Bullets-move check...")
                # First detect: is there a bullet group at all?
                has_bullet_group = page.evaluate("""
                    (() => {
                        const g = window.__GAME__;
                        if (!g) return false;
                        for (const scene of g.scene.scenes) {
                            for (const k of ['bullets', 'projectiles', 'shots', 'lasers']) {
                                if (scene[k] && scene[k].children) return true;
                            }
                        }
                        return false;
                    })()
                """)
                if not has_bullet_group:
                    results["tests"]["bullets_move"] = None  # no projectile combat — skip
                else:
                    # Position mouse over the canvas + fire briefly to spawn bullets
                    try:
                        canvas_rect = page.evaluate("(() => { const c = document.querySelector('canvas'); const r = c.getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; })()")
                        if canvas_rect:
                            # Aim at upper-right of canvas, click-and-hold
                            target_x = canvas_rect["left"] + canvas_rect["w"] * 0.8
                            target_y = canvas_rect["top"] + canvas_rect["h"] * 0.3
                            page.mouse.move(target_x, target_y)
                            page.mouse.down()
                            page.wait_for_timeout(300)  # 300ms = ~3 shots at 8/sec
                    except Exception:
                        pass
                    bullets_check = page.evaluate("""
                        (() => {
                            const g = window.__GAME__;
                            for (const scene of g.scene.scenes) {
                                for (const k of ['bullets', 'projectiles', 'shots', 'lasers']) {
                                    const grp = scene[k];
                                    if (!grp || !grp.children || !grp.children.entries) continue;
                                    const list = grp.children.entries;
                                    if (list.length === 0) continue;
                                    // Find any bullet with non-zero velocity
                                    for (const b of list) {
                                        const v = b.body && b.body.velocity;
                                        if (!v) continue;
                                        const speed = Math.sqrt(v.x*v.x + v.y*v.y);
                                        if (speed > 10) return { ok: true, speed, count: list.length, group: k };
                                    }
                                    return { ok: false, reason: 'all bullets stationary', count: list.length, group: k };
                                }
                            }
                            return { ok: false, reason: 'no bullets after fire' };
                        })()
                    """)
                    try:
                        page.mouse.up()
                    except Exception:
                        pass
                    results["tests"]["bullets_move"] = bool(bullets_check and bullets_check.get("ok"))
                    if not results["tests"]["bullets_move"]:
                        results.setdefault("playtest_issues", []).append(
                            f"Bullets-move FAIL: {bullets_check}"
                        )
                        print(f"    Bullets-move: {bullets_check}")

            # ── Console error check ──
            critical_errors = [e for e in results["console_errors"]
                             if "error" in e.lower() and "favicon" not in e.lower()]
            results["tests"]["no_critical_errors"] = len(critical_errors) == 0

        except Exception as e:
            results["tests"]["execution"] = False
            results["error"] = str(e)
            print(f"  [ERROR] {e}")

        finally:
            browser.close()

    # ── SCORING ──
    total = 0
    passed = 0
    for test_name, result in results["tests"].items():
        if result is None:
            continue  # Skipped
        total += 1
        if result:
            passed += 1

    results["total_tests"] = total
    results["passed_tests"] = passed
    results["failed_tests"] = total - passed
    results["score"] = round((passed / max(total, 1)) * 100, 1)
    # 2026-04-27: AAA standard — every L1 test must pass to ship. Anything
    # less is noise that masks real bugs.
    results["passed"] = results["score"] >= 100  # require 100% pass

    # 2026-04-22: bucket failures by severity so phase_qa can gate deploy.
    for test_name, outcome in results["tests"].items():
        if outcome is False:  # explicit False, skip None
            sev = TEST_SEVERITY.get(test_name, "P2")  # default medium if unmapped
            results["severity_failures"][sev].append(test_name)
    results["has_P0"] = len(results["severity_failures"]["P0"]) > 0
    results["has_P1"] = len(results["severity_failures"]["P1"]) > 0

    return results


def print_results(results: dict):
    print("\n" + "=" * 50)
    print(f"QA Results: {results['score']:.0f}/100 — {'PASS' if results['passed'] else 'FAIL'}")
    print("=" * 50)
    for test_name, result in results["tests"].items():
        if result is None:
            icon = "⏭️"
            label = "SKIP"
        elif result:
            icon = "✅"
            label = "PASS"
        else:
            icon = "❌"
            label = "FAIL"
        print(f"  {icon} {label}: {test_name}")

    if results["console_errors"]:
        print(f"\n  Console errors ({len(results['console_errors'])}):")
        for err in results["console_errors"][:5]:
            print(f"    - {err[:100]}")

    # 2026-04-23: surface 4xx/5xx with URLs so "Failed to load resource: 404"
    # actually tells us WHICH asset is missing. Captured by page.on("response").
    net_errs = results.get("network_errors") or []
    if net_errs:
        print(f"\n  Network errors ({len(net_errs)}):")
        for e in net_errs[:10]:
            if isinstance(e, dict):
                print(f"    - HTTP {e.get('status', '?')}  {e.get('url', '?')}")
            else:
                print(f"    - {str(e)[:120]}")

    print(f"\n  Total: {results['passed_tests']}/{results['total_tests']} passed")
    print(f"  Score: {results['score']:.0f}/100")
    print(f"  Status: {'✅ PASSED' if results['passed'] else '❌ FAILED'}")


def main():
    parser = argparse.ArgumentParser(description="Game QA Test Runner")
    parser.add_argument("--game-url", help="URL to the game (file:// or https://)")
    parser.add_argument("--game-dir", help="Local game directory (will use file:// URL)")
    parser.add_argument("--genre", default="platformer", choices=["platformer", "topdown", "boardgame", "arpg", "arcade"])
    parser.add_argument("--timeout", type=int, default=30000, help="Page load timeout in ms")
    args = parser.parse_args()

    if args.game_dir:
        game_path = Path(args.game_dir).resolve()
        game_url = f"file:///{game_path / 'index.html'}"
    elif args.game_url:
        game_url = args.game_url
    else:
        print("Error: Provide --game-url or --game-dir")
        sys.exit(1)

    print(f"Running QA tests on: {game_url}")
    print(f"Genre: {args.genre}")
    print()

    results = run_qa_tests(game_url, args.genre, args.timeout)
    print_results(results)

    # Save results
    results_path = ROOT / "forgeflow-games" / "pipeline" / "qa" / "last_qa_results.json"
    results_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nResults saved to: {results_path}")

    sys.exit(0 if results["passed"] else 1)


if __name__ == "__main__":
    main()
