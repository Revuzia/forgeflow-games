/* particle_burst.js — neon-vector explosion + line-trail effects.
 *
 * Geometry-Wars aesthetic: thin bright lines on dark bg, particles
 * expand outward in a ring on enemy death.
 *
 * Burst.explosion(scene, x, y, color, count) — radial particle pop
 * Burst.trail(scene, sprite, color)           — line trail behind sprite
 */
(function (root) {
  "use strict";

  function explosion(scene, x, y, color, count) {
    color = color || 0x00e5ff;
    count = count || 18;
    if (!scene.add || !scene.add.line) return;
    for (let i = 0; i < count; i++) {
      const ang = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.4;
      const speed = 200 + Math.random() * 200;
      const dx = Math.cos(ang) * speed;
      const dy = Math.sin(ang) * speed;
      const line = scene.add.rectangle(x, y, 2, 14, color)
        .setOrigin(0.5).setRotation(ang).setDepth(60);
      scene.tweens.add({
        targets: line, x: x + dx * 0.4, y: y + dy * 0.4,
        alpha: 0, duration: 500 + Math.random() * 200,
        onComplete: () => line.destroy(),
      });
    }
  }

  function trail(scene, sprite, color) {
    color = color || 0x00e5ff;
    if (!sprite || !sprite.active) return null;
    const ev = scene.time.addEvent({
      delay: 30, loop: true, callback: () => {
        if (!sprite.active) { ev.remove(); return; }
        const dot = scene.add.circle(sprite.x, sprite.y, 4, color, 0.8).setDepth(40);
        scene.tweens.add({
          targets: dot, alpha: 0, scale: 0,
          duration: 350, onComplete: () => dot.destroy(),
        });
      },
    });
    return ev;
  }

  // Death pop with score float text
  function killPop(scene, x, y, color, scoreText) {
    explosion(scene, x, y, color || 0xffffff, 12);
    if (scoreText) {
      const t = scene.add.text(x, y, "+" + scoreText, {
        fontSize: "14px", color: "#ffffff", fontStyle: "bold",
      }).setOrigin(0.5).setDepth(60);
      scene.tweens.add({ targets: t, y: y - 30, alpha: 0, duration: 600,
        onComplete: () => t.destroy() });
    }
  }

  root.Burst = { explosion, trail, killPop };
})(typeof window !== "undefined" ? window : this);
