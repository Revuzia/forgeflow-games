/**
 * gamepad.js — Unified gamepad input (Xbox + PlayStation + generic HID).
 *
 * Phaser has built-in gamepad support but it's inconsistent across browsers.
 * This module provides a unified API that maps any gamepad's buttons to
 * game actions (jump, attack, dash, etc.) via a customizable binding.
 *
 * API:
 *   Gamepad.init(scene);
 *   scene.gamepad.isDown("jump")    -> boolean
 *   scene.gamepad.justPressed("jump") -> boolean (single-frame)
 *   scene.gamepad.getAxis("movex")  -> -1..1
 *   scene.gamepad.rebind("jump", 0); // map button index 0 to "jump"
 */
const Gamepad = {
  // Default Xbox-style button map
  DEFAULT_BINDINGS: {
    jump:    0,   // A
    attack:  2,   // X
    dash:    1,   // B
    special: 3,   // Y
    pause:   9,   // Start
    menu:    8,   // Back/Select
  },
  DEFAULT_AXES: {
    movex: 0,  // Left stick X
    movey: 1,  // Left stick Y
    aimx:  2,  // Right stick X
    aimy:  3,  // Right stick Y
  },

  init(scene) {
    scene.gamepad = {
      _bindings: { ...Gamepad.DEFAULT_BINDINGS },
      _axes:     { ...Gamepad.DEFAULT_AXES },
      _prevButtons: new Set(),
      _currButtons: new Set(),

      _poll() {
        const pads = navigator.getGamepads ? navigator.getGamepads() : [];
        const pad = pads[0];
        if (!pad) return null;
        scene.gamepad._prevButtons = new Set(scene.gamepad._currButtons);
        scene.gamepad._currButtons = new Set();
        pad.buttons.forEach((b, i) => {
          if (b.pressed || b.value > 0.3) scene.gamepad._currButtons.add(i);
        });
        return pad;
      },

      update() {
        scene.gamepad._lastPad = scene.gamepad._poll();
      },

      isDown(action) {
        const idx = scene.gamepad._bindings[action];
        if (idx === undefined) return false;
        return scene.gamepad._currButtons.has(idx);
      },

      justPressed(action) {
        const idx = scene.gamepad._bindings[action];
        if (idx === undefined) return false;
        return scene.gamepad._currButtons.has(idx) && !scene.gamepad._prevButtons.has(idx);
      },

      getAxis(axis) {
        const pad = scene.gamepad._lastPad;
        if (!pad) return 0;
        const idx = scene.gamepad._axes[axis];
        if (idx === undefined) return 0;
        const value = pad.axes[idx] ?? 0;
        return Math.abs(value) < 0.15 ? 0 : value;  // deadzone
      },

      rebind(action, buttonIndex) {
        scene.gamepad._bindings[action] = buttonIndex;
      },

      connected() {
        return scene.gamepad._poll() !== null;
      },
    };

    // Register polling in scene update
    const originalUpdate = scene.update?.bind(scene);
    scene.update = function (...args) {
      scene.gamepad.update();
      if (originalUpdate) originalUpdate(...args);
    };
  },
};

if (typeof window !== "undefined") {
  window.Gamepad = Gamepad;
}
