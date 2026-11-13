/**
 * world_map.js — Mario-style world map / level select hub.
 *
 * Provides a persistent overworld scene where the player:
 *   - Walks between nodes on a path (each node = 1 level)
 *   - Sees completion stars on beaten levels
 *   - Can enter any unlocked level
 *   - Sees which worlds are locked (need previous world boss defeated)
 *
 * API (Phaser):
 *   WorldMap.init(scene, worldData);
 *   // worldData = {
 *   //   worlds: [{num, name, unlocked, levels: [{num, x, y, unlocked, completed, stars}]}],
 *   //   current_pos: {world: 1, level: 1},
 *   //   paths: [[{x,y}, {x,y}, ...]] // path points between nodes
 *   // }
 *   // scene emits "enter-level" event with {world, level} when player confirms
 */
const WorldMap = {
  _bgColor: 0x0a3d62,

  init(scene, worldData, opts = {}) {
    const bg = scene.add.rectangle(
      scene.scale.width / 2, scene.scale.height / 2,
      scene.scale.width, scene.scale.height,
      opts.bgColor ?? WorldMap._bgColor
    );

    const worldContainer = scene.add.container(0, 0);

    const nodes = [];
    for (const world of worldData.worlds) {
      for (const level of world.levels) {
        const node = scene.add.circle(level.x, level.y, 24, level.unlocked ? 0xffdd00 : 0x555555);
        node.setStrokeStyle(3, 0x000000);
        node.setInteractive({ useHandCursor: level.unlocked });
        node.levelData = { world: world.num, level: level.num };
        if (level.completed) {
          node.setFillStyle(0x00cc66);
        }
        // Level number text
        const label = scene.add.text(level.x, level.y, `${level.num}`, {
          fontSize: "16px", color: "#000000", fontFamily: "Arial Black",
        }).setOrigin(0.5);
        // Stars (for 100% completion)
        if (level.stars > 0) {
          const starText = "⭐".repeat(level.stars);
          scene.add.text(level.x, level.y + 30, starText, {
            fontSize: "12px",
          }).setOrigin(0.5);
        }
        if (level.unlocked) {
          node.on("pointerdown", () => {
            scene.events.emit("enter-level", node.levelData);
          });
        }
        nodes.push(node);
        worldContainer.add([node, label]);
      }

      // World name banner
      if (world.levels.length > 0) {
        const firstLevel = world.levels[0];
        const banner = scene.add.text(firstLevel.x - 40, firstLevel.y - 60,
          `${world.name}${world.unlocked ? "" : " 🔒"}`, {
            fontSize: "18px", color: world.unlocked ? "#ffffff" : "#888888",
            fontFamily: "Arial Black", stroke: "#000000", strokeThickness: 2,
          });
        worldContainer.add(banner);
      }
    }

    // Path lines connecting levels (if worldData.paths provided)
    if (worldData.paths) {
      const graphics = scene.add.graphics();
      graphics.lineStyle(4, 0xffee88, 0.7);
      for (const path of worldData.paths) {
        if (path.length < 2) continue;
        graphics.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
          graphics.lineTo(path[i].x, path[i].y);
        }
        graphics.strokePath();
      }
      worldContainer.setDepth(1);
      graphics.setDepth(0);
    }

    // Player cursor on map (shows current position)
    const current = worldData.current_pos;
    if (current) {
      const currentWorld = worldData.worlds.find(w => w.num === current.world);
      const currentLevel = currentWorld?.levels.find(l => l.num === current.level);
      if (currentLevel) {
        const cursor = scene.add.circle(currentLevel.x, currentLevel.y - 40, 8, 0xff3333);
        scene.tweens.add({
          targets: cursor, y: cursor.y - 8, duration: 400, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
        });
      }
    }

    scene.worldMap = { nodes, container: worldContainer };
    return scene.worldMap;
  },
};

if (typeof window !== "undefined") {
  window.WorldMap = WorldMap;
}
