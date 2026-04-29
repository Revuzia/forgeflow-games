/* bonus_room.js — DKC-style hidden bonus rooms.
 *
 * A hidden barrel placed somewhere in the level (typically a corner or
 * behind a wall). Player walks into it → fade to bonus arena → 30s timer
 * to grab as many bananas as possible → return to main level with reward.
 *
 * BonusRoom.placeEntry(scene, x, y) creates a hidden barrel.
 * On entry: BonusRoom.enter(scene) creates a sub-arena overlay.
 *
 * Genre-agnostic: scope is "side challenge with timer + reward" — works
 * for any platformer (Mario star-coin rooms, Sonic special stages, etc.)
 */
(function (root) {
  "use strict";

  function placeEntry(scene, x, y) {
    if (!scene.bonusEntries) {
      scene.bonusEntries = scene.physics.add.staticGroup();
      if (scene.player) {
        scene.physics.add.overlap(scene.player, scene.bonusEntries, (p, e) => {
          if (e._used) return;
          e._used = true;
          enter(scene);
          e.destroy();
        });
      }
    }
    const tex = scene.textures.exists("block_strong_empty") ? "block_strong_empty" : "__platform";
    const e = scene.bonusEntries.create(x, y, tex);
    e.setDisplaySize(24, 24).setTint(0x8d4f1a);
    // Subtle "?" indicator above
    const q = scene.add.text(x, y - 20, "?", {
      fontSize: "20px", color: "#ffd700", fontStyle: "bold"
    }).setOrigin(0.5).setDepth(50);
    scene.tweens.add({ targets: q, alpha: 0.4, duration: 800, yoyo: true, repeat: -1 });
    e._marker = q;
    return e;
  }

  function enter(scene) {
    if (scene._inBonusRoom) return;
    scene._inBonusRoom = true;
    const cam = scene.cameras.main;
    // Save player state
    const savedX = scene.player.x;
    const savedY = scene.player.y;
    const savedVx = scene.player.body.velocity.x;
    const savedVy = scene.player.body.velocity.y;
    // Fade overlay
    const fade = scene.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 1)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2000);

    scene.time.delayedCall(400, () => {
      // Build a mini-arena off-screen (down 1000 units, won't interact with main level)
      const arenaCx = scene.player.x;
      const arenaCy = scene.map.heightInPixels + 600;
      // Floor strip
      const floor = scene.add.rectangle(arenaCx, arenaCy + 60, 600, 24, 0x4caf50)
        .setScrollFactor(1).setDepth(50);
      scene.physics.add.existing(floor, true);  // static body
      scene.physics.add.collider(scene.player, floor);

      // Scatter 12 bananas across the arena
      const bonusCoins = [];
      const bonusGroup = scene.physics.add.staticGroup();
      for (let i = 0; i < 12; i++) {
        const cx = arenaCx - 250 + i * 40;
        const cy = arenaCy + 30 - (i % 3) * 30;
        const tex = scene.textures.exists("coinGold") ? "coinGold" : "__pixel";
        const coin = bonusGroup.create(cx, cy, tex);
        coin.setDisplaySize(16, 16).setTint(0xffd700);
        bonusCoins.push(coin);
      }
      let collectedInBonus = 0;
      scene.physics.add.overlap(scene.player, bonusGroup, (p, c) => {
        if (c._got) return;
        c._got = true;
        collectedInBonus++;
        scene.score = (scene.score || 0) + 10;
        if (typeof scene.updateHUD === "function") scene.updateHUD();
        c.destroy();
      });

      // Move player + camera to arena
      scene.player.setPosition(arenaCx - 250, arenaCy);
      scene.player.setVelocity(0, 0);
      cam.scrollY = arenaCy - cam.height / 2;
      cam.scrollX = arenaCx - cam.width / 2;
      // Stop camera follow temporarily
      cam.stopFollow && cam.stopFollow();

      // Banner + 30s timer
      const banner = scene.add.text(cam.width / 2, 40, "BONUS ROOM — Grab all bananas!", {
        fontSize: "20px", color: "#ffd700", fontStyle: "bold",
        backgroundColor: "#000000aa", padding: { x: 10, y: 6 }
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2003);
      const timerText = scene.add.text(cam.width / 2, 80, "30", {
        fontSize: "24px", color: "#ffffff", fontStyle: "bold"
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2003);
      let timeLeft = 30;
      const tick = scene.time.addEvent({
        delay: 1000, repeat: 29, callback: () => {
          timeLeft--;
          timerText.setText(String(timeLeft));
        },
      });
      // Fade in
      scene.tweens.add({ targets: fade, alpha: 0, duration: 400, onComplete: () => fade.destroy() });

      // Auto-exit after 30s
      scene.time.delayedCall(30000, () => exit());

      function exit() {
        const f2 = scene.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 0)
          .setOrigin(0, 0).setScrollFactor(0).setDepth(2000);
        scene.tweens.add({
          targets: f2, alpha: 1, duration: 400, onComplete: () => {
            // Restore player + camera
            scene.player.setPosition(savedX, savedY);
            scene.player.setVelocity(0, 0);
            if (scene.cameras.main.startFollow) scene.cameras.main.startFollow(scene.player, true, 0.1, 0.1);
            // Cleanup
            try { floor.destroy(); banner.destroy(); timerText.destroy(); tick.remove(); } catch (_e) {}
            try { bonusGroup.children && bonusGroup.children.iterate(c => c && c.destroy()); } catch (_e) {}
            // Reward float text
            if (collectedInBonus > 0 && typeof scene.showFloatText === "function") {
              scene.showFloatText(scene.player.x, scene.player.y - 40, `BONUS +${collectedInBonus * 10}`, "#ffd700");
            }
            scene.tweens.add({ targets: f2, alpha: 0, duration: 400, onComplete: () => f2.destroy() });
            scene._inBonusRoom = false;
          },
        });
      }
    });
  }

  root.BonusRoom = { placeEntry, enter };
})(typeof window !== "undefined" ? window : this);
