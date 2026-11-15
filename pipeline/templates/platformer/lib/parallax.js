/* parallax.js — multi-layer scrolling bg for depth.
 *
 * Replaces the single bg image with 3 stacked layers:
 *   far    — slow scroll (0.15) for sky/mountains
 *   mid    — medium scroll (0.40) for canopy/buildings
 *   near   — fast scroll (0.75) for foreground foliage
 *
 * Uses the existing per-world bg + tints/scales for the other 2 layers
 * (no extra asset generation required). Falls back to single-layer if
 * the world bg key is missing.
 */
(function (root) {
  "use strict";

  function build(scene, mapWidth, mapHeight, worldNum) {
    const bgKey = `world_${String(worldNum).padStart(2, "0")}_bg`;
    if (!scene.textures || !scene.textures.exists(bgKey)) return null;
    const tex = scene.textures.get(bgKey);
    const camH = scene.cameras.main.height;
    const srcH = (tex.source && tex.source[0] && tex.source[0].height) || 1;

    // Far layer — desaturated tint, slowest scroll, deepest layer
    const far = scene.add.tileSprite(0, 0, mapWidth, camH, bgKey)
      .setOrigin(0, 0).setScrollFactor(0.15).setDepth(-12)
      .setTint(0x607080);
    far.setTileScale(camH / srcH, camH / srcH);

    // Mid layer — normal tint, medium scroll
    const mid = scene.add.tileSprite(0, 0, mapWidth, camH, bgKey)
      .setOrigin(0, 0).setScrollFactor(0.4).setDepth(-10)
      .setAlpha(0.9);
    mid.setTileScale(camH / srcH, camH / srcH);

    // Near layer — brighter tint, fast scroll, only renders in lower half
    const near = scene.add.tileSprite(0, camH * 0.5, mapWidth, camH * 0.5, bgKey)
      .setOrigin(0, 0).setScrollFactor(0.75).setDepth(-8)
      .setAlpha(0.55);
    near.setTileScale(camH / srcH * 0.7, camH / srcH * 0.7);

    // Dark vignette overlay so foreground sprites pop
    scene.add.rectangle(0, 0, mapWidth, mapHeight, 0x000814, 0.4)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(-7);

    return { far, mid, near };
  }

  root.Parallax = { build };
})(typeof window !== "undefined" ? window : this);
