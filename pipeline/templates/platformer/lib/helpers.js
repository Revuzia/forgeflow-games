/* helpers.js — Squawks-style guide NPCs that reveal hidden items.
 *
 * When player is near a hidden puzzle piece or bonus entry, a small
 * helper sprite (e.g. parrot) flies in and points at it, then leaves.
 * Genre-agnostic — uses any small sprite from asset library.
 *
 * Helpers.attach(scene) wires the system. Call once per level.
 */
(function (root) {
  "use strict";

  function attach(scene) {
    if (scene._helperWired) return;
    scene._helperWired = true;
    scene._helperShownFor = new Set();

    // Per-frame: check if player near a hidden puzzle piece or bonus
    // entry and not yet shown for it. Show helper once.
    scene._helperTickEv = scene.time.addEvent({
      delay: 1000, loop: true, callback: () => {
        if (!scene.player) return;
        // Check puzzle pieces (in itemPickups with handler.tex matching)
        const candidates = [];
        if (scene.itemPickups) {
          scene.itemPickups.children.iterate(it => {
            if (it && it.active && it._handler && /piece|hidden/i.test(it._handler.tex || "")) {
              candidates.push(it);
            }
          });
        }
        if (scene.bonusEntries) {
          scene.bonusEntries.children.iterate(b => {
            if (b && b.active) candidates.push(b);
          });
        }
        for (const c of candidates) {
          const id = `${c.x}_${c.y}`;
          if (scene._helperShownFor.has(id)) continue;
          const d = Math.hypot(c.x - scene.player.x, c.y - scene.player.y);
          if (d < 280) {
            scene._helperShownFor.add(id);
            _showHelper(scene, c);
          }
        }
      },
    });
  }

  function _showHelper(scene, target) {
    // Spawn a small bird-like sprite that flies in, hovers, points at target, leaves
    const tex = scene.textures.exists("enemies_atlas") ? "enemies_atlas" : "__pixel";
    const cam = scene.cameras.main;
    const startX = cam.scrollX + cam.width + 50;
    const helper = scene.add.sprite(startX, target.y - 80, tex,
      tex === "enemies_atlas" ? "fly_a" : 0);
    helper.setScale(2).setTint(0x00bcd4).setDepth(70);
    // Fly in to a hover spot
    scene.tweens.add({
      targets: helper, x: target.x + 40, y: target.y - 60,
      duration: 800, ease: "Sine.easeInOut",
      onComplete: () => {
        // Show pointer arrow
        const arrow = scene.add.text(target.x, target.y - 30, "▼", {
          fontSize: "20px", color: "#00bcd4", fontStyle: "bold"
        }).setOrigin(0.5).setDepth(71);
        scene.tweens.add({
          targets: arrow, y: target.y - 20, duration: 300, yoyo: true, repeat: 2,
        });
        // Hover, then leave
        scene.time.delayedCall(2000, () => {
          arrow.destroy();
          scene.tweens.add({
            targets: helper, x: cam.scrollX - 80, alpha: 0,
            duration: 800, onComplete: () => helper.destroy(),
          });
        });
      },
    });
  }

  root.Helpers = { attach };
})(typeof window !== "undefined" ? window : this);
