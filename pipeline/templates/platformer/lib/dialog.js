/* dialog.js — minimal NPC dialog system driven by design.npc_cast[].
 *
 * design.npc_cast[i] = { name, role, dialog (string|array), location_world (int) }
 *
 * Dialog.spawn(scene, x, y, npc) creates a sprite with an exclamation mark
 * indicator. When the player overlaps, the indicator fills and pressing E
 * opens a typewriter-style speech box at the top of the screen.
 */
(function (root) {
  "use strict";

  function spawn(scene, x, y, npc) {
    if (!scene.npcs) {
      scene.npcs = scene.physics.add.staticGroup();
      try { scene._dlgKey = scene.input.keyboard.addKey("E"); } catch (_e) {}
    }
    const sprite = scene.npcs.create(x, y, "characters", 24);
    sprite.setDisplaySize(48, 48).setTint(0xff8866);
    sprite.npc = npc;
    // Floating exclamation
    const mark = scene.add.text(x, y - 40, "!", {
      fontSize: "24px", color: "#ffd700", fontStyle: "bold"
    }).setOrigin(0.5);
    sprite._mark = mark;
    scene.tweens.add({ targets: mark, y: y - 50, duration: 600, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    return sprite;
  }

  function checkInteraction(scene) {
    if (!scene.npcs || !scene.player) return;
    const p = scene.player;
    let near = null;
    scene.npcs.children.iterate(n => {
      if (!n || !n.active) return;
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < 80) near = n;
    });
    if (near && scene._dlgKey && Phaser.Input.Keyboard.JustDown(scene._dlgKey) && !scene._dlgActive) {
      _openSpeechBox(scene, near.npc);
    }
  }

  function _openSpeechBox(scene, npc) {
    if (scene._dlgActive) return;
    scene._dlgActive = true;
    const cam = scene.cameras.main;
    const w = cam.width, h = cam.height;
    const bgY = 40, bgH = 80;
    const bg = scene.add.rectangle(20, bgY, w - 40, bgH, 0x000000, 0.85)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(1000)
      .setStrokeStyle(2, 0xffd700);
    const nameTxt = scene.add.text(36, bgY + 8, npc.name || "???", {
      fontSize: "16px", color: "#ffd700", fontStyle: "bold"
    }).setScrollFactor(0).setDepth(1001);
    const lines = Array.isArray(npc.dialog) ? npc.dialog
      : (typeof npc.dialog === "string" ? [npc.dialog] : ["..."]);
    let lineIdx = 0;
    const txt = scene.add.text(36, bgY + 32, "", {
      fontSize: "14px", color: "#ffffff", wordWrap: { width: w - 80 }
    }).setScrollFactor(0).setDepth(1001);

    function _typeLine() {
      const full = lines[lineIdx] || "";
      let i = 0;
      txt.setText("");
      const ev = scene.time.addEvent({
        delay: 30, repeat: full.length - 1,
        callback: () => { txt.setText(full.slice(0, ++i)); },
      });
      scene._dlgTypeEv = ev;
    }
    _typeLine();

    const advance = () => {
      // Skip typing or advance line
      if (scene._dlgTypeEv && scene._dlgTypeEv.getProgress() < 1) {
        scene._dlgTypeEv.remove();
        txt.setText(lines[lineIdx]);
        return;
      }
      lineIdx++;
      if (lineIdx >= lines.length) {
        // Close
        bg.destroy(); nameTxt.destroy(); txt.destroy();
        scene._dlgActive = false;
        if (scene._dlgKey) scene._dlgKey.removeAllListeners();
        return;
      }
      _typeLine();
    };
    scene._dlgKey && scene._dlgKey.on("down", advance);
  }

  // Spawn NPCs for the current world. Place them at the level's ~25%/75% x
  // points on the floor.
  function spawnForWorld(scene, designNpcs, currentWorld) {
    if (!designNpcs || !scene.map) return;
    const inWorld = designNpcs.filter(n => !n.location_world || n.location_world === currentWorld);
    if (!inWorld.length) return;
    const w = scene.map.widthInPixels;
    const floorY = (scene.map.height - 4) * (scene.map.tileWidth || 18) - 24;
    inWorld.slice(0, 2).forEach((npc, i) => {
      const x = (i === 0) ? w * 0.25 : w * 0.75;
      spawn(scene, x, floorY, npc);
    });
  }

  root.Dialog = { spawn, spawnForWorld, checkInteraction };
})(typeof window !== "undefined" ? window : this);
