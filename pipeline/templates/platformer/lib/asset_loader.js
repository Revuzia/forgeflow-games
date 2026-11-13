/* asset_loader.js — register the standard sprite library in PreloadScene.
 *
 * The Claude Claw asset library lives in ../shared/assets/ (copied at deploy
 * time by the pipeline). This file declares which assets to load. PreloadScene
 * calls AssetLoader.preload(this) inside its preload().
 *
 * All keys here can be safely used by interactives.js, world_mechanics.js,
 * dialog.js, and per-game patches without checking textures.exists().
 *
 * Categories:
 *   - INTERACTIVE TILES: spring, switches, levers, conveyor, ladder, doors, keys
 *   - HAZARDS: lava, water, spikes, saw
 *   - HUD: hearts, coins, gems, key icons
 *   - BACKGROUNDS: bg, bg_castle
 *   - PROJECTILES: bomb, fireball
 *
 * If a file isn't on disk (some games strip the lib), the load silently
 * fails; consumers fall back via Interactives' _safeKey helper.
 */
(function (root) {
  "use strict";

  // Per-key path relative to game root. The pipeline's deploy step copies
  // shared/ into each game folder so these paths work in production.
  const ASSETS = {
    // Tiles + interactives (from new-platformer-pack)
    spring: "shared/sprites/spring.png",
    spring_out: "shared/sprites/spring_out.png",
    switch_blue: "shared/sprites/switch_blue.png",
    switch_blue_pressed: "shared/sprites/switch_blue_pressed.png",
    switch_red: "shared/sprites/switch_red.png",
    switch_red_pressed: "shared/sprites/switch_red_pressed.png",
    switch_green: "shared/sprites/switch_green.png",
    switch_green_pressed: "shared/sprites/switch_green_pressed.png",
    switch_yellow: "shared/sprites/switch_yellow.png",
    switch_yellow_pressed: "shared/sprites/switch_yellow_pressed.png",
    lever: "shared/sprites/lever.png",
    lever_left: "shared/sprites/lever_left.png",
    lever_right: "shared/sprites/lever_right.png",
    conveyor: "shared/sprites/conveyor.png",
    ladder_top: "shared/sprites/ladder_top.png",
    ladder_middle: "shared/sprites/ladder_middle.png",
    ladder_bottom: "shared/sprites/ladder_bottom.png",
    door_closed: "shared/sprites/door_closed.png",
    door_closed_top: "shared/sprites/door_closed_top.png",
    door_open: "shared/sprites/door_open.png",
    door_open_top: "shared/sprites/door_open_top.png",
    sign: "shared/sprites/sign.png",
    sign_exit: "shared/sprites/sign_exit.png",
    sign_left: "shared/sprites/sign_left.png",
    sign_right: "shared/sprites/sign_right.png",

    // Keys
    key_blue: "shared/sprites/key_blue.png",
    key_red: "shared/sprites/key_red.png",
    key_green: "shared/sprites/key_green.png",
    key_yellow: "shared/sprites/key_yellow.png",

    // Question / item blocks
    block_coin: "shared/sprites/block_coin.png",
    block_coin_active: "shared/sprites/block_coin_active.png",
    block_empty: "shared/sprites/block_empty.png",
    block_exclamation: "shared/sprites/block_exclamation.png",
    block_exclamation_active: "shared/sprites/block_exclamation_active.png",
    block_spikes: "shared/sprites/block_spikes.png",

    // Hazards
    lava: "shared/sprites/lava.png",
    lava_top: "shared/sprites/lava_top.png",
    lava_top_low: "shared/sprites/lava_top_low.png",
    water: "shared/sprites/water.png",
    spikes: "shared/sprites/spikes.png",
    saw: "shared/sprites/saw.png",
    bomb: "shared/sprites/bomb.png",
    bomb_active: "shared/sprites/bomb_active.png",

    // Castle / building (deluxe pack)
    bg_castle: "shared/sprites/bg_castle.png",
    castleMid: "shared/sprites/castleMid.png",
    castleCenter: "shared/sprites/castleCenter.png",
    brickWall: "shared/sprites/brickWall.png",
    torch: "shared/sprites/torch.png",

    // HUD
    hud_heartFull: "shared/sprites/hud_heartFull.png",
    hud_heartHalf: "shared/sprites/hud_heartHalf.png",
    hud_heartEmpty: "shared/sprites/hud_heartEmpty.png",
    hud_coins: "shared/sprites/hud_coins.png",
    hud_key_blue: "shared/sprites/hud_key_blue.png",
    hud_key_red: "shared/sprites/hud_key_red.png",
    hud_key_green: "shared/sprites/hud_key_green.png",
    hud_key_yellow: "shared/sprites/hud_key_yellow.png",

    // Flags (checkpoints / goal)
    flagBlue: "shared/sprites/flagBlue.png",
    flagBlueHanging: "shared/sprites/flagBlueHanging.png",
    flagGreen: "shared/sprites/flagGreen.png",
    flagRed: "shared/sprites/flagRed.png",
    flagYellow: "shared/sprites/flagYellow.png",

    // Coins / gems
    coinGold: "shared/sprites/coinGold.png",
    coinSilver: "shared/sprites/coinSilver.png",
    coinBronze: "shared/sprites/coinBronze.png",
    gemBlue: "shared/sprites/gemBlue.png",
    gemRed: "shared/sprites/gemRed.png",
    gemGreen: "shared/sprites/gemGreen.png",
    gemYellow: "shared/sprites/gemYellow.png",
    star: "shared/sprites/star.png",
  };

  function preload(scene) {
    if (!scene || !scene.load) return;
    let loaded = 0;
    for (const [key, path] of Object.entries(ASSETS)) {
      try { scene.load.image(key, path); loaded++; } catch (_e) {}
    }
    return loaded;
  }

  function listKeys() { return Object.keys(ASSETS); }

  root.AssetLoader = { preload, listKeys, ASSETS };
})(typeof window !== "undefined" ? window : this);
