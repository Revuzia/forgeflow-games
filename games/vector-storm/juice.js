/**
 * juice.js — Reusable polish/juice module for ForgeFlow Games.
 *
 * The single biggest difference between "works technically" and "feels good" is
 * juice: particles, screen shake, hit-pause, squash-stretch, floating damage
 * numbers, camera rumble. Research confirms professional studios spend hundreds
 * of hours tuning these. This module provides production-ready helpers so the
 * generated code doesn't rewrite them per game.
 *
 * Every generated game gets this injected into its game.js via phase_build.
 * Functions are attached to the scene via Juice.attach(scene) for Phaser, or
 * called directly for Three.js.
 *
 * PHASER API (attach to a scene):
 *   Juice.attach(scene);
 *   scene.juice.shake(ms, intensity)     — camera shake
 *   scene.juice.hitPause(ms)              — freeze all scene time briefly
 *   scene.juice.flash(color, ms)          — full-screen flash
 *   scene.juice.squashStretch(sprite, s)  — impact squash-stretch tween
 *   scene.juice.damageNumber(x, y, text)  — floating damage text
 *   scene.juice.particles(x, y, opts)     — burst of particles
 *   scene.juice.zoomPunch(scale, ms)      — camera zoom punch
 *   scene.juice.rippleText(text, x, y)    — text that pops in + fades
 *
 * THREE.JS API (singleton):
 *   Juice3D.init(scene, camera, renderer);
 *   Juice3D.shake(ms, intensity)
 *   Juice3D.hitPause(ms)
 *   Juice3D.flash(color, ms)
 *   Juice3D.damageNumber(worldPos, text)
 */

// ─────────────────────────────────────────────────────────────────────────
// PHASER JUICE
// ─────────────────────────────────────────────────────────────────────────
const Juice = {
  attach(scene) {
    scene.juice = {
      _timeScale: 1,
      _shakeTween: null,

      shake(ms = 200, intensity = 0.01) {
        scene.cameras.main.shake(ms, intensity);
      },

      hitPause(ms = 80) {
        // Freeze physics + tweens briefly — sells impacts
        const originalTimeScale = scene.physics?.world?.timeScale ?? 1;
        if (scene.physics?.world) scene.physics.world.timeScale = 0;
        scene.tweens.timeScale = 0;
        scene.time.delayedCall(ms, () => {
          if (scene.physics?.world) scene.physics.world.timeScale = originalTimeScale;
          scene.tweens.timeScale = 1;
        });
      },

      flash(color = 0xffffff, ms = 100) {
        scene.cameras.main.flash(ms, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff);
      },

      squashStretch(sprite, amount = 0.3, ms = 100) {
        // Classic impact animation — compress on hit, bounce back
        if (!sprite || !sprite.setScale) return;
        const origScaleX = sprite.scaleX;
        const origScaleY = sprite.scaleY;
        scene.tweens.add({
          targets: sprite,
          scaleX: origScaleX * (1 + amount),
          scaleY: origScaleY * (1 - amount),
          duration: ms / 2,
          yoyo: true,
          onComplete: () => {
            sprite.setScale(origScaleX, origScaleY);
          },
        });
      },

      damageNumber(x, y, text, color = "#ff3333", size = 20) {
        // Floating damage number — critical feedback for combat
        const t = scene.add.text(x, y, text, {
          fontFamily: "Arial Black",
          fontSize: `${size}px`,
          color: color,
          stroke: "#000000",
          strokeThickness: 3,
        }).setOrigin(0.5);
        t.setDepth(1000);
        scene.tweens.add({
          targets: t,
          y: y - 60,
          alpha: 0,
          duration: 800,
          ease: "Cubic.easeOut",
          onComplete: () => t.destroy(),
        });
      },

      particles(x, y, opts = {}) {
        // Burst of particles — dust, sparks, or colored
        const count = opts.count ?? 12;
        const color = opts.color ?? 0xffee88;
        const speed = opts.speed ?? 150;
        const lifespan = opts.lifespan ?? 400;
        const size = opts.size ?? 4;

        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          const p = scene.add.rectangle(x, y, size, size, color);
          p.setDepth(900);
          scene.tweens.add({
            targets: p,
            x: x + Math.cos(angle) * speed,
            y: y + Math.sin(angle) * speed,
            alpha: 0,
            scale: 0,
            duration: lifespan,
            ease: "Cubic.easeOut",
            onComplete: () => p.destroy(),
          });
        }
      },

      zoomPunch(scale = 1.05, ms = 120) {
        // Momentary camera zoom — sells big impacts
        const cam = scene.cameras.main;
        const origZoom = cam.zoom;
        scene.tweens.add({
          targets: cam,
          zoom: origZoom * scale,
          duration: ms / 2,
          yoyo: true,
          ease: "Quad.easeOut",
        });
      },

      rippleText(text, x, y, opts = {}) {
        // Large callout text — "LEVEL UP!", "BOSS DOWN!", etc.
        const t = scene.add.text(x, y, text, {
          fontFamily: "Arial Black",
          fontSize: opts.size ?? "48px",
          color: opts.color ?? "#ffcc00",
          stroke: "#000000",
          strokeThickness: 4,
        }).setOrigin(0.5).setScale(0).setDepth(1100);

        scene.tweens.add({
          targets: t,
          scale: 1,
          duration: 200,
          ease: "Back.easeOut",
        });
        scene.time.delayedCall(opts.duration ?? 1500, () => {
          scene.tweens.add({
            targets: t,
            alpha: 0,
            scale: 0.8,
            duration: 300,
            onComplete: () => t.destroy(),
          });
        });
      },

      parallax(imageKey, depth, scrollFactor) {
        // Add a parallax background layer
        const bg = scene.add.tileSprite(0, 0,
          scene.cameras.main.width, scene.cameras.main.height,
          imageKey).setOrigin(0, 0).setScrollFactor(scrollFactor).setDepth(depth);
        return bg;
      },

      trailFollow(sprite, opts = {}) {
        // Leave a fading trail behind a sprite — dash or special-ability effect
        const trails = [];
        const interval = opts.interval ?? 40;
        const lifespan = opts.lifespan ?? 300;
        const event = scene.time.addEvent({
          delay: interval,
          loop: true,
          callback: () => {
            if (!sprite.active) return;
            const ghost = scene.add.sprite(sprite.x, sprite.y, sprite.texture.key).setAlpha(0.4).setTint(opts.tint ?? 0x66ccff);
            ghost.setDepth(sprite.depth - 1);
            trails.push(ghost);
            scene.tweens.add({
              targets: ghost,
              alpha: 0,
              duration: lifespan,
              onComplete: () => ghost.destroy(),
            });
          },
        });
        return { stop: () => event.remove() };
      },

      comboCounter(x, y) {
        // Incrementing combo counter — classic platformer/fighter feedback
        let count = 0;
        let decay = null;
        const t = scene.add.text(x, y, "", {
          fontFamily: "Arial Black",
          fontSize: "32px",
          color: "#ffcc00",
          stroke: "#000000",
          strokeThickness: 4,
        }).setOrigin(0.5).setDepth(1000).setVisible(false);

        return {
          hit() {
            count += 1;
            t.setText(`${count}x COMBO`);
            t.setVisible(true);
            t.setScale(1.3);
            scene.tweens.add({ targets: t, scale: 1, duration: 150, ease: "Back.easeOut" });
            if (decay) decay.remove();
            decay = scene.time.delayedCall(2500, () => {
              scene.tweens.add({
                targets: t,
                alpha: 0,
                duration: 400,
                onComplete: () => { count = 0; t.setVisible(false); t.setAlpha(1); },
              });
            });
          },
          reset() {
            count = 0;
            t.setVisible(false);
          },
        };
      },
    };
  },
};

// Expose globally so template game.js can access without imports
if (typeof window !== "undefined") {
  window.Juice = Juice;
}


// ─────────────────────────────────────────────────────────────────────────
// THREE.JS JUICE (for 3D templates)
// ─────────────────────────────────────────────────────────────────────────
const Juice3D = {
  _scene: null,
  _camera: null,
  _renderer: null,
  _originalCameraPos: null,
  _shakeUntil: 0,
  _shakeIntensity: 0,

  init(scene, camera, renderer) {
    this._scene = scene;
    this._camera = camera;
    this._renderer = renderer;
    this._originalCameraPos = camera.position.clone();
  },

  update(delta) {
    if (!this._camera) return;
    if (performance.now() < this._shakeUntil) {
      this._camera.position.x = this._originalCameraPos.x + (Math.random() - 0.5) * this._shakeIntensity;
      this._camera.position.y = this._originalCameraPos.y + (Math.random() - 0.5) * this._shakeIntensity;
    } else if (this._camera.position.distanceTo(this._originalCameraPos) > 0.001) {
      this._camera.position.lerp(this._originalCameraPos, 0.2);
    }
  },

  shake(ms = 200, intensity = 0.3) {
    this._shakeUntil = performance.now() + ms;
    this._shakeIntensity = intensity;
  },

  hitPause(ms = 80) {
    // 3D games use animation mixers — return a pause token
    return { duration: ms, start: performance.now() };
  },

  flash(color = 0xffffff, ms = 100) {
    if (!this._renderer) return;
    const canvas = this._renderer.domElement;
    const overlay = document.createElement("div");
    overlay.style.cssText = `
      position:absolute; inset:0; pointer-events:none; z-index:100;
      background: #${color.toString(16).padStart(6, "0")};
      opacity: 0.6; transition: opacity ${ms}ms;
    `;
    canvas.parentElement.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = "0"; });
    setTimeout(() => overlay.remove(), ms + 50);
  },

  damageNumber(worldPos, text, color = "#ff3333") {
    // Use CSS2DRenderer if available; fall back to absolute-positioned HTML
    const el = document.createElement("div");
    el.className = "damage-number";
    el.textContent = text;
    el.style.cssText = `
      position: absolute; color: ${color}; font-weight: 900; font-size: 18px;
      text-shadow: 0 0 4px #000; pointer-events: none; z-index: 50;
      animation: float-up 0.8s ease-out forwards;
    `;
    // Project world pos to screen
    const vec = worldPos.clone().project(this._camera);
    const canvas = this._renderer.domElement;
    el.style.left = ((vec.x + 1) / 2 * canvas.clientWidth) + "px";
    el.style.top  = (-(vec.y - 1) / 2 * canvas.clientHeight) + "px";
    canvas.parentElement.appendChild(el);
    setTimeout(() => el.remove(), 800);
  },
};

if (typeof window !== "undefined") {
  window.Juice3D = Juice3D;
}
