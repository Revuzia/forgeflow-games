/* cutscene.js — between-level story cards.
 *
 * Generic across all game types. Pulls a 1-3 line beat from window.GAME_DESIGN
 * (story, world.name, world.theme, npc_cast, signature_mechanic) and shows
 * it for ~4 seconds before transitioning to the next level.
 *
 * Usage:
 *   Cutscene.show(scene, { fromLevel: 0, toLevel: 1, onDone: () => scene.scene.start("Game") })
 *   Cutscene.intro(scene)              — game opening (story preamble)
 *   Cutscene.worldChange(scene, n)     — world boundary
 *   Cutscene.victory(scene)            — final win
 *
 * Style: black scrim + game palette accent stripe + typewriter text + skip
 * hint. No external assets required.
 */
(function (root) {
  "use strict";

  function _bg(scene) {
    const cam = scene.cameras.main;
    const bg = scene.add.rectangle(0, 0, cam.width, cam.height, 0x000000, 1)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2000);
    return bg;
  }
  function _accent(scene, color) {
    const cam = scene.cameras.main;
    const top = scene.add.rectangle(0, cam.height * 0.22, cam.width, 4, color || 0xffd700)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2001);
    const bot = scene.add.rectangle(0, cam.height * 0.78, cam.width, 4, color || 0xffd700)
      .setOrigin(0, 0).setScrollFactor(0).setDepth(2001);
    return [top, bot];
  }
  function _typeText(scene, x, y, str, opts) {
    opts = opts || {};
    const txt = scene.add.text(x, y, "", Object.assign({
      fontSize: "20px", color: "#ffffff", wordWrap: { width: opts.width || 700 },
      align: "center",
    }, opts.style || {})).setOrigin(0.5).setScrollFactor(0).setDepth(2003);
    let i = 0;
    const ev = scene.time.addEvent({
      delay: 25, repeat: str.length - 1,
      callback: () => txt.setText(str.slice(0, ++i)),
    });
    return { txt, ev };
  }

  // Build a 1-3 line beat from design. Generic across game types.
  function _beatFor(toLevel, design) {
    if (!design) return ["...", "Onward."];
    // Determine target world for this level
    const worlds = design.worlds || [];
    const targetWorld = (() => {
      // Compute world by counting levels
      let acc = 0;
      for (let i = 0; i < worlds.length; i++) {
        const lc = worlds[i].level_count || 7;
        if (toLevel < acc + lc) return worlds[i];
        acc += lc;
      }
      return worlds[0] || null;
    })();
    const lines = [];
    if (toLevel === 0 && design.story) {
      // Opening: use story (truncate to first 200 chars)
      lines.push(design.story.slice(0, 200) + (design.story.length > 200 ? "…" : ""));
      if (design.signature_mechanic) {
        lines.push(design.signature_mechanic.slice(0, 120));
      }
    } else if (targetWorld) {
      // Per-world intro: use world name + theme + unique_mechanic
      lines.push(`${targetWorld.name || "New World"}`);
      if (targetWorld.unique_mechanic) {
        lines.push(targetWorld.unique_mechanic.slice(0, 140));
      } else if (targetWorld.theme) {
        lines.push(`Theme: ${targetWorld.theme}`);
      }
    } else {
      lines.push(`Level ${toLevel + 1}`);
    }
    return lines;
  }

  function _show(scene, opts) {
    opts = opts || {};
    const cam = scene.cameras.main;
    const design = window.GAME_DESIGN || {};
    const lines = opts.lines || _beatFor(opts.toLevel || 0, design);
    const accentColor = opts.accentColor || 0xffd700;

    const bg = _bg(scene);
    const stripes = _accent(scene, accentColor);
    const title = opts.title ||
      (lines.length && opts.toLevel === 0 ? (design.title || "") : "");
    let titleTxt = null;
    if (title) {
      titleTxt = scene.add.text(cam.width / 2, cam.height * 0.16, title, {
        fontSize: "28px", color: "#ffd700", fontStyle: "bold"
      }).setOrigin(0.5).setScrollFactor(0).setDepth(2003);
    }
    // Render all lines with vertical spacing
    const startY = cam.height * 0.35;
    const lineGap = 70;
    const typeRefs = [];
    lines.forEach((s, i) => {
      typeRefs.push(_typeText(scene, cam.width / 2, startY + i * lineGap, s));
    });
    const skip = scene.add.text(cam.width / 2, cam.height * 0.92, "Press SPACE to continue", {
      fontSize: "14px", color: "#888888"
    }).setOrigin(0.5).setScrollFactor(0).setDepth(2003);

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      try { typeRefs.forEach(r => r.ev && r.ev.remove && r.ev.remove()); } catch (_e) {}
      try { typeRefs.forEach(r => r.txt && r.txt.destroy()); } catch (_e) {}
      try { stripes.forEach(s => s.destroy()); } catch (_e) {}
      try { titleTxt && titleTxt.destroy(); } catch (_e) {}
      try { skip.destroy(); } catch (_e) {}
      try { bg.destroy(); } catch (_e) {}
      if (typeof opts.onDone === "function") opts.onDone();
    };
    // Auto-dismiss after 4s (or longer if many lines)
    scene.time.delayedCall((opts.durationMs || (3500 + lines.length * 1000)), dismiss);
    // Manual skip via SPACE
    try {
      const k = scene.input.keyboard.addKey("SPACE");
      k.once("down", dismiss);
    } catch (_e) {}
  }

  function show(scene, opts) { return _show(scene, opts); }
  function intro(scene, onDone) {
    return _show(scene, { toLevel: 0, accentColor: 0xffd700, onDone });
  }
  function worldChange(scene, worldNum, onDone) {
    return _show(scene, { toLevel: worldNum * 7, accentColor: 0x00bcd4, onDone });
  }
  function victory(scene, onDone) {
    const d = window.GAME_DESIGN || {};
    return _show(scene, {
      lines: ["VICTORY", `${d.protagonist && d.protagonist.name || "The hero"} prevails.`,
              "Thank you for playing."],
      title: d.title, accentColor: 0xff8a65, durationMs: 8000, onDone,
    });
  }

  root.Cutscene = { show, intro, worldChange, victory };
})(typeof window !== "undefined" ? window : this);
