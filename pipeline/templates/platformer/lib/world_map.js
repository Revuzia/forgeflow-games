/* world_map.js — between-level hub showing progress + next destination.
 *
 * Genre-agnostic: reads window.GAME_DESIGN.worlds[] and lays them out as
 * nodes. Highlights the current world + animates the player marker to the
 * next level. Press SPACE to enter the next level.
 *
 * Optional: shows score, lives, and KONG-letter collection state.
 */
(function (root) {
  "use strict";

  function show(scene, opts) {
    opts = opts || {};
    const cam = scene.cameras.main;
    const design = window.GAME_DESIGN || {};
    const worlds = design.worlds || [];
    const targetLevel = opts.toLevel || 0;
    const accentColor = opts.accentColor || 0xffd700;

    // Compute target world index from level
    let targetWorld = 0; let acc = 0;
    for (let i = 0; i < worlds.length; i++) {
      const lc = worlds[i].level_count || 7;
      if (targetLevel < acc + lc) { targetWorld = i; break; }
      acc += lc;
    }

    // BG
    const bg = scene.add.rectangle(0, 0, cam.width, cam.height, 0x0a0e1a, 1)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2000);
    // Title
    const title = scene.add.text(cam.width / 2, 50,
      `${(design.title || "Adventure").toUpperCase()} — World Map`, {
      fontSize: "28px", color: "#ffd700", fontStyle: "bold"
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2003);

    // World nodes laid out horizontally
    const yMid = cam.height / 2;
    const margin = 100;
    const span = (cam.width - 2 * margin) / Math.max(1, worlds.length - 1);
    const nodes = [];
    worlds.forEach((w, i) => {
      const x = margin + i * span;
      const node = scene.add.circle(x, yMid, i === targetWorld ? 28 : 20,
        i === targetWorld ? accentColor : 0x546e7a, 1).setScrollFactor(0).setDepth(2002);
      const lbl = scene.add.text(x, yMid + 50, w.name || `World ${i + 1}`, {
        fontSize: "13px", color: i === targetWorld ? "#ffd700" : "#aaaaaa",
        align: "center", wordWrap: { width: 120 }
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2003);
      nodes.push({ node, lbl, x, w });
      // Connector line to next
      if (i < worlds.length - 1) {
        const line = scene.add.rectangle(x + span / 2, yMid, span - 40, 3,
          i < targetWorld ? accentColor : 0x546e7a)
          .setScrollFactor(0).setDepth(2001);
      }
    });

    // Stats row at bottom
    const stats = [
      `Score: ${scene.score || 0}`,
      `Lives: ${scene.lives || 3}`,
      `Level: ${targetLevel + 1} / ${design.total_level_count || worlds.reduce((s, w) => s + (w.level_count || 7), 0)}`,
    ];
    if (scene._kongCollected) {
      const collected = Object.keys(scene._kongCollected).filter(k => scene._kongCollected[k]).join("");
      stats.push(`Letters: ${collected || "—"}`);
    }
    const statsTxt = scene.add.text(cam.width / 2, cam.height - 80, stats.join("    "), {
      fontSize: "16px", color: "#ffffff"
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2003);

    // Hint
    const hint = scene.add.text(cam.width / 2, cam.height - 30,
      "Press SPACE to continue", { fontSize: "14px", color: "#888888" })
      .setOrigin(0.5).setScrollFactor(0).setDepth(2003);

    // Pulse the active node
    if (nodes[targetWorld]) {
      scene.tweens.add({
        targets: nodes[targetWorld].node, scale: 1.3,
        duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
    }

    // 2026-04-29: interactive selection. LEFT/RIGHT moves cursor between
    // unlocked worlds; ENTER/SPACE confirms and starts that world's
    // first level. (Locked worlds — currentWorld + 1 onward — can't be
    // selected.)
    let cursor = targetWorld;
    const cursorRing = scene.add.circle(nodes[cursor].x, yMid, 38, 0xffffff, 0)
      .setStrokeStyle(3, 0xffffff, 0.8).setScrollFactor(0).setDepth(2004);
    function updateCursor() {
      cursorRing.x = nodes[cursor].x;
    }
    const keyL = scene.input.keyboard.addKey("LEFT");
    const keyR = scene.input.keyboard.addKey("RIGHT");
    const keyA = scene.input.keyboard.addKey("A");
    const keyD = scene.input.keyboard.addKey("D");
    keyL.on("down", () => { if (cursor > 0) { cursor--; updateCursor(); } });
    keyA.on("down", () => { if (cursor > 0) { cursor--; updateCursor(); } });
    keyR.on("down", () => { if (cursor < targetWorld) { cursor++; updateCursor(); } });
    keyD.on("down", () => { if (cursor < targetWorld) { cursor++; updateCursor(); } });

    let dismissed = false;
    const dismiss = (chosenLevel) => {
      if (dismissed) return;
      dismissed = true;
      try { bg.destroy(); title.destroy(); statsTxt.destroy(); hint.destroy(); cursorRing.destroy(); } catch (_e) {}
      try { nodes.forEach(n => { n.node.destroy(); n.lbl.destroy(); }); } catch (_e) {}
      try { keyL.destroy(); keyR.destroy(); keyA.destroy(); keyD.destroy(); } catch (_e) {}
      if (typeof opts.onDone === "function") opts.onDone(chosenLevel);
    };
    const startSelected = () => {
      // Compute first-level index of selected world
      let firstLvl = 0;
      for (let i = 0; i < cursor; i++) firstLvl += worlds[i].level_count || 7;
      dismiss(firstLvl);
    };
    try {
      const kSpace = scene.input.keyboard.addKey("SPACE");
      const kEnter = scene.input.keyboard.addKey("ENTER");
      kSpace.once("down", startSelected);
      kEnter.once("down", startSelected);
    } catch (_e) {}
    // Auto-progress after 8s if no selection
    scene.time.delayedCall(opts.durationMs || 8000, () => dismiss());
  }

  root.WorldMap = { show };
})(typeof window !== "undefined" ? window : this);
