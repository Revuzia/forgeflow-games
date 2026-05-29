/**
 * FFG runtime — ffg_tactics.js
 * The render + input + FEEL layer for grid tactics. Binds FFG.sim.TacticalBattle
 * (pure logic) to Phaser: selection, movement-range highlight, path preview,
 * hit% targeting UI, damage popups, turn banners, win/lose. Registers itself as
 * the "tactics" genre. NOT regenerated per game — games supply only content.json.
 *
 * Exposes scene.__test (sim + scripted actions) so the signature/feel gates and
 * play-bot can drive it headlessly without clicking.
 */
(function (root) {
  "use strict";
  var FFG = root.FFG = root.FFG || {};

  FFG.register("tactics", function (content) {
    var Phaser = root.Phaser;

    var TILE_COLORS = { 0: 0x1c2433, 1: 0x4a5568, 2: 0x6b5535, 3: 0x8a6d3b, 4: 0x5b2a2a };

    function TacticsScene() { Phaser.Scene.call(this, { key: "FFGTactics" }); }
    TacticsScene.prototype = Object.create(Phaser.Scene.prototype);
    TacticsScene.prototype.constructor = TacticsScene;

    TacticsScene.prototype.preload = function () {
      var a = content.assets || {};
      var self = this;
      (a.images || []).forEach(function (im) { try { self.load.image(im.key, im.url); } catch (e) {} });
      (a.audio || []).forEach(function (au) { try { self.load.audio(au.key, au.url); } catch (e) {} });
    };

    TacticsScene.prototype.create = function () {
      var self = this;
      FFG.audio.bind(this);
      this._mission = (content.missions && content.missions[0]) || content;
      this._missionIndex = 0;
      this._inputLocked = false;
      this._selected = null;
      this._highlights = [];
      this._pathDots = [];
      this._unitViews = {};

      this._buildSim();
      this._computeLayout();
      this._drawGrid();
      this._drawUnits();
      this._buildHUD();
      this._wireInput();

      this._exposeTestHooks();
      // Standard engine shell (menu / pause / win-lose / music) — same one the
      // 3D games use. Gameplay starts on Play.
      this._started = false; this._paused = false;
      var self2 = this;
      if (root.FFG && root.FFG.Shell) {
        this._shell = new root.FFG.Shell({
          parent: (this.game.canvas && this.game.canvas.parentNode) || root.document.body,
          title: content.title || "Mission",
          tagline: content.tagline || "",
          music: (content.audio && content.audio.music) || null,
          difficulties: [],
          onPlay: function () { self2._begin(); },
          onPause: function () { self2._paused = true; },
          onResume: function () { self2._paused = false; },
        });
        this._shell.start();
      } else {
        this._begin(); // shell unavailable -> play immediately (back-compat)
      }
    };

    TacticsScene.prototype._begin = function () {
      this._started = true;
      this._announce(this._mission.name || content.title || "Mission", "#fde047");
      this._setPhaseBanner("PLAYER PHASE");
    };

    TacticsScene.prototype._buildSim = function () {
      var m = this._mission;
      var self = this;
      this.sim = new FFG.sim.TacticalBattle({
        grid: m.grid,
        player_units: m.player_units,
        enemy_units: m.enemy_units,
        seed: content.seed != null ? content.seed : 12345,
        onEvent: function (type, payload) { self._events.push({ type: type, payload: payload }); },
        onEnd: function () {},
      });
      this._events = [];
    };

    TacticsScene.prototype._computeLayout = function () {
      var W = this.scale.width, H = this.scale.height;
      var gw = this.sim.gridW, gh = this.sim.gridH;
      var pad = 90; // room for HUD top/bottom
      this.tile = Math.floor(Math.min((W - 40) / gw, (H - pad) / gh));
      this.tile = Math.max(20, Math.min(this.tile, 64));
      this.ox = Math.floor((W - this.tile * gw) / 2);
      this.oy = Math.floor((H - this.tile * gh) / 2) + 10;
    };

    TacticsScene.prototype.t2w = function (tx, ty) {
      return { x: this.ox + tx * this.tile + this.tile / 2, y: this.oy + ty * this.tile + this.tile / 2 };
    };
    TacticsScene.prototype.w2t = function (wx, wy) {
      return { x: Math.floor((wx - this.ox) / this.tile), y: Math.floor((wy - this.oy) / this.tile) };
    };

    TacticsScene.prototype._drawGrid = function () {
      var self = this;
      this._tileRects = [];
      for (var y = 0; y < this.sim.gridH; y++) {
        for (var x = 0; x < this.sim.gridW; x++) {
          var t = this.sim.grid[y][x];
          var w = this.t2w(x, y);
          var rect = this.add.rectangle(w.x, w.y, this.tile - 1, this.tile - 1, TILE_COLORS[t] != null ? TILE_COLORS[t] : 0x000000);
          rect.setStrokeStyle(1, 0x0c1018);
          rect.setData("tx", x); rect.setData("ty", y);
          rect.setInteractive();
          (function (gx, gy) {
            rect.on("pointerover", function () { self._onHover(gx, gy); });
            rect.on("pointerdown", function () { self._onTileClick(gx, gy); });
          })(x, y);
          // cover glyph
          if (t === 2 || t === 3) {
            FFG.text(this, w.x, w.y, t === 3 ? "■" : "▫", { size: Math.floor(this.tile * 0.4), color: "#d9b779", origin: 0.5, depth: 2 });
          } else if (t === 4) {
            FFG.text(this, w.x, w.y, "♨", { size: Math.floor(this.tile * 0.4), color: "#ff7a7a", origin: 0.5, depth: 2 });
          }
          this._tileRects.push(rect);
        }
      }
    };

    TacticsScene.prototype._drawUnits = function () {
      var self = this;
      this.sim.allUnits().forEach(function (u) { self._makeUnitView(u); });
    };

    TacticsScene.prototype._makeUnitView = function (u) {
      var w = this.t2w(u.x, u.y);
      var c = this.add.container(w.x, w.y).setDepth(10);
      var col = u.tint != null ? FFG.color(u.tint) : (u.side === "player" ? 0x47b4ff : 0xff5a5a);
      var ring = this.add.circle(0, 0, this.tile * 0.36, col).setStrokeStyle(2, 0x0c1018);
      var initial = this.add.text(0, 0, (u.name || u.id)[0].toUpperCase(), { fontFamily: "monospace", fontSize: Math.floor(this.tile * 0.34) + "px", color: "#0a0e1a", resolution: 2 }).setOrigin(0.5);
      var hpBg = this.add.rectangle(0, -this.tile * 0.5, this.tile * 0.7, 4, 0x222a38).setOrigin(0.5);
      var hpFill = this.add.rectangle(-this.tile * 0.35, -this.tile * 0.5, this.tile * 0.7, 4, 0x3ddc84).setOrigin(0, 0.5);
      c.add([ring, initial, hpBg, hpFill]);
      this._unitViews[u.id] = { c: c, ring: ring, hpFill: hpFill, col: col };
    };

    TacticsScene.prototype._refreshUnit = function (u) {
      var v = this._unitViews[u.id];
      if (!v) return;
      if (u.hp <= 0) { v.c.setVisible(false); return; }
      var pct = Math.max(0, u.hp / u.maxHp);
      v.hpFill.width = this.tile * 0.7 * pct;
      v.hpFill.fillColor = pct > 0.5 ? 0x3ddc84 : pct > 0.25 ? 0xf5c518 : 0xff5a5a;
    };

    // ── HUD ────────────────────────────────────────────────────────────────
    TacticsScene.prototype._buildHUD = function () {
      var W = this.scale.width, H = this.scale.height;
      this._objText = FFG.text(this, 10, 8, "Objective: " + (this._mission.objective || "Eliminate all hostiles"), { size: 13, color: "#cfe3ff" });
      this._turnText = FFG.text(this, W - 10, 8, "Turn 1", { size: 13, color: "#cfe3ff", origin: 1, originY: 0 });
      this._panel = FFG.text(this, 10, H - 24, "", { size: 13, color: "#fde047" });
      // End Turn button
      var btn = this.add.rectangle(W - 70, H - 18, 120, 26, 0x2d3b66).setStrokeStyle(1, 0x5a78c8).setInteractive();
      var lbl = FFG.text(this, W - 70, H - 18, "END TURN", { size: 12, color: "#ffffff", origin: 0.5 });
      var self = this;
      btn.on("pointerover", function () { btn.fillColor = 0x3b4f8a; });
      btn.on("pointerout", function () { btn.fillColor = 0x2d3b66; });
      btn.on("pointerdown", function () { self._endTurn(); });
      this._endBtn = btn; this._endLbl = lbl;
      // Phase banner (centered, fades)
      this._banner = FFG.text(this, W / 2, H / 2, "", { size: 34, color: "#ffffff", origin: 0.5, stroke: "#000000", strokeThickness: 4, depth: 100 }).setAlpha(0);
    };

    TacticsScene.prototype._setPhaseBanner = function (txt) {
      this._turnText.setText("Turn " + this.sim.turnNumber);
      var b = this._banner; b.setText(txt); b.setAlpha(0).setScale(0.8);
      this.tweens.add({ targets: b, alpha: 1, scale: 1, duration: 220, yoyo: true, hold: 360, onComplete: function () { b.setAlpha(0); } });
    };

    TacticsScene.prototype._announce = function (txt, color) {
      var W = this.scale.width;
      var t = FFG.text(this, W / 2, 56, txt, { size: 18, color: color || "#ffffff", origin: 0.5, stroke: "#000000", strokeThickness: 3, depth: 100 });
      this.tweens.add({ targets: t, y: 40, alpha: 0, duration: 1600, delay: 700, onComplete: function () { t.destroy(); } });
    };

    // ── Input / selection ────────────────────────────────────────────────────
    TacticsScene.prototype._wireInput = function () {
      var self = this;
      this.input.on("pointerdown", function (p, objs) {
        // unit token clicks handled via tile click (we resolve unit at tile)
      });
    };

    TacticsScene.prototype._onTileClick = function (tx, ty) {
      if (!this._started || this._paused || this._inputLocked || this.sim.ended || this.sim.currentPhase !== "player") return;
      var occupant = this.sim.unitAt(tx, ty);
      if (occupant && occupant.side === "player") { this._select(occupant); return; }
      if (occupant && occupant.side === "enemy") { this._tryAttack(occupant); return; }
      if (this._selected) this._tryMove(tx, ty);
    };

    TacticsScene.prototype._onHover = function (tx, ty) {
      if (!this._started || this._paused || this._inputLocked || !this._selected) return;
      this._clearPath();
      var occupant = this.sim.unitAt(tx, ty);
      if (occupant && occupant.side === "enemy") { this._showHitPreview(this._selected, occupant); return; }
      // preview movement path if tile is reachable
      var reach = this._reachSet && this._reachSet[tx + "," + ty];
      if (reach == null) return;
      var path = this.sim.findPath(this._selected.x, this._selected.y, tx, ty);
      if (!path) return;
      var self = this;
      path.forEach(function (p) {
        var w = self.t2w(p.x, p.y);
        self._pathDots.push(self.add.circle(w.x, w.y, 3, 0xffffff, 0.8).setDepth(6));
      });
    };

    TacticsScene.prototype._select = function (u) {
      this._selected = u;
      this._clearHighlights();
      this._clearPath();
      // highlight reachable tiles
      var reach = this.sim.reachableTiles(u);
      this._reachSet = {};
      var self = this;
      reach.forEach(function (r) {
        self._reachSet[r.x + "," + r.y] = r.cost;
        var w = self.t2w(r.x, r.y);
        var hl = self.add.rectangle(w.x, w.y, self.tile - 4, self.tile - 4, 0x47b4ff, u.actionPoints > 0 ? 0.18 : 0.06).setDepth(3);
        self._highlights.push(hl);
      });
      // ring pulse on selected
      var v = this._unitViews[u.id];
      if (v) { v.ring.setStrokeStyle(3, 0xfde047); }
      this._updatePanel();
      FFG.audio.sfx("select", 0.4);
    };

    TacticsScene.prototype._updatePanel = function () {
      var u = this._selected;
      if (!u) { this._panel.setText(""); return; }
      this._panel.setText(u.name + "   HP " + u.hp + "/" + u.maxHp + "   AP " + u.actionPoints + "/" + u.maxAP + "   AIM " + Math.round(u.aim * 100) + "%");
    };

    TacticsScene.prototype._clearHighlights = function () {
      this._highlights.forEach(function (h) { h.destroy(); });
      this._highlights = [];
      this._reachSet = null;
      var self = this;
      // reset selection ring on all player units
      this.sim.player_units.forEach(function (pu) { var v = self._unitViews[pu.id]; if (v && pu.hp > 0) v.ring.setStrokeStyle(2, 0x0c1018); });
    };

    TacticsScene.prototype._clearPath = function () {
      this._pathDots.forEach(function (d) { d.destroy(); });
      this._pathDots = [];
      if (this._hitTip) { this._hitTip.destroy(); this._hitTip = null; }
    };

    TacticsScene.prototype._showHitPreview = function (attacker, target) {
      if (attacker.actionPoints < 1) return;
      var chance = this.sim.calculateHitChance(attacker, target);
      var los = this.sim.hasLineOfSight(attacker.x, attacker.y, target.x, target.y);
      var w = this.t2w(target.x, target.y);
      var txt = !los ? "NO LOS" : chance <= 0 ? "OUT OF RANGE" : Math.round(chance * 100) + "%";
      var col = !los || chance <= 0 ? "#ff8888" : chance >= 0.7 ? "#88ff88" : "#ffe066";
      this._hitTip = FFG.text(this, w.x, w.y - this.tile * 0.7, txt, { size: 14, color: col, origin: 0.5, stroke: "#000", strokeThickness: 3, depth: 20 });
    };

    // ── Actions ───────────────────────────────────────────────────────────────
    TacticsScene.prototype._tryMove = function (tx, ty) {
      var u = this._selected;
      if (!u || u.actionPoints < 1) return;
      if (!this._reachSet || this._reachSet[tx + "," + ty] == null) return;
      var path = this.sim.moveUnit(u.id, tx, ty);
      if (!path) return;
      this._inputLocked = true;
      this._clearHighlights(); this._clearPath();
      this._animateMove(u, path, this._drainEvents.bind(this, function () {
        // re-select to refresh range if AP remain, else clear
        if (u.hp > 0 && u.actionPoints > 0) this._select(u); else { this._selected = null; this._updatePanel(); }
        this._inputLocked = false;
      }.bind(this)));
    };

    TacticsScene.prototype._tryAttack = function (target) {
      var u = this._selected;
      if (!u || u.actionPoints < 1) return;
      var res = this.sim.attackUnit(u.id, target.id);
      if (!res.success) { this._floatText(target, res.reason.toUpperCase(), "#ff8888"); return; }
      this._inputLocked = true;
      this._clearHighlights(); this._clearPath();
      var self = this;
      this._drainEvents(function () {
        if (u.hp > 0 && u.actionPoints > 0 && !self.sim.ended) self._select(u);
        else { self._selected = null; self._updatePanel(); }
        self._inputLocked = false;
      });
    };

    // ── Animation of sim events ────────────────────────────────────────────────
    TacticsScene.prototype._animateMove = function (u, path, done) {
      var self = this;
      var v = this._unitViews[u.id];
      if (!v) { done(); return; }
      var i = 0;
      var stepTime = 110;
      function step() {
        if (i >= path.length) { FFG.audio.sfx("step", 0.3); done(); return; }
        var w = self.t2w(path[i].x, path[i].y);
        self.tweens.add({ targets: v.c, x: w.x, y: w.y, duration: stepTime, onComplete: function () { i++; step(); } });
      }
      step();
    };

    // Drain the sim event queue produced by player/enemy actions, animating each
    // with a short delay so combat reads beat-by-beat.
    TacticsScene.prototype._drainEvents = function (done) {
      var self = this;
      var q = this._events.slice(); this._events = [];
      var i = 0;
      function next() {
        if (i >= q.length) { done && done(); return; }
        var e = q[i++];
        var delay = self._playEvent(e);
        self.time.delayedCall(delay, next);
      }
      next();
    };

    TacticsScene.prototype._playEvent = function (e) {
      var self = this;
      if (e.type === "move") {
        var v = this._unitViews[e.payload.unit.id];
        var path = e.payload.path || [];
        if (v && path.length) { this._animateMove(e.payload.unit, path, function () {}); return Math.min(path.length, 6) * 110 + 60; }
        return 40;
      }
      if (e.type === "attack") {
        var a = e.payload.attacker, t = e.payload.target;
        // tracer line
        var wa = this.t2w(a.x, a.y), wt = this.t2w(t.x, t.y);
        var line = this.add.line(0, 0, wa.x, wa.y, wt.x, wt.y, e.payload.hit ? 0xffe066 : 0x8899aa, 0.9).setOrigin(0, 0).setLineWidth(2).setDepth(15);
        this.tweens.add({ targets: line, alpha: 0, duration: 280, onComplete: function () { line.destroy(); } });
        if (e.payload.hit) {
          FFG.audio.sfx("hit", 0.5);
          this._floatText(t, "-" + e.payload.damage, "#ff6b6b");
          this._flash(t);
          this._refreshUnit(t);
          if (e.payload.killed) { this._floatText(t, "DOWN", "#ffffff"); }
        } else {
          FFG.audio.sfx("miss", 0.4);
          this._floatText(t, "MISS", "#aab4c8");
        }
        this._updatePanel();
        return 360;
      }
      if (e.type === "phase") { if (e.payload.phase === "enemy") this._setPhaseBanner("ENEMY PHASE"); return 200; }
      if (e.type === "end") { this._win(e.payload.victory); return 200; }
      return 30;
    };

    TacticsScene.prototype._floatText = function (u, txt, color) {
      var w = this.t2w(u.x, u.y);
      var t = FFG.text(this, w.x, w.y - this.tile * 0.4, txt, { size: 16, color: color, origin: 0.5, stroke: "#000", strokeThickness: 3, depth: 25 });
      this.tweens.add({ targets: t, y: t.y - 26, alpha: 0, duration: 700, onComplete: function () { t.destroy(); } });
    };

    TacticsScene.prototype._flash = function (u) {
      var v = this._unitViews[u.id];
      if (!v) return;
      var orig = v.ring.fillColor;
      v.ring.fillColor = 0xffffff;
      this.tweens.add({ targets: v.ring, alpha: 0.3, duration: 90, yoyo: true, onComplete: function () { v.ring.alpha = 1; v.ring.fillColor = orig; } });
    };

    TacticsScene.prototype._endTurn = function () {
      if (this._inputLocked || this.sim.ended || this.sim.currentPhase !== "player") return;
      this._inputLocked = true;
      this._selected = null; this._clearHighlights(); this._clearPath(); this._updatePanel();
      this.sim.endTurn(); // resolves enemy phase synchronously, queueing events
      var self = this;
      this._drainEvents(function () {
        self._inputLocked = false;
        if (!self.sim.ended) self._setPhaseBanner("PLAYER PHASE");
      });
    };

    TacticsScene.prototype._win = function (victory) {
      root.__FFG_RESULT__ = { victory: victory, turns: this.sim.turnNumber };
      FFG.audio.sfx(victory ? "win" : "lose", 0.6);
      // Standard end screen via the engine shell (with Play Again). Fallback to
      // an in-canvas overlay if the shell isn't present.
      if (this._shell) {
        this._shell.end(victory, (victory ? "Mission complete" : "Squad eliminated") + " · " + this.sim.turnNumber + " turns");
        return;
      }
      var W = this.scale.width, H = this.scale.height;
      this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.6).setDepth(200);
      FFG.text(this, W / 2, H / 2 - 10, victory ? "VICTORY" : "DEFEAT", { size: 48, color: victory ? "#7CFC9A" : "#ff6b6b", origin: 0.5, stroke: "#000", strokeThickness: 5, depth: 201 });
      FFG.text(this, W / 2, H / 2 + 36, victory ? "Mission complete" : "Squad eliminated", { size: 16, color: "#ffffff", origin: 0.5, depth: 201 });
    };

    // ── Test hooks: let gates + play-bots drive without clicking ────────────────
    TacticsScene.prototype._exposeTestHooks = function () {
      var self = this;
      this.__test = {
        sim: this.sim,
        // Standard cross-genre hook: dismiss the menu + begin gameplay.
        start: function () { if (self._shell) { self._shell.hide(); self._shell.phase = "playing"; self._shell._playMusic(); } self._begin(); },
        state: function () {
          return {
            phase: self.sim.currentPhase, turn: self.sim.turnNumber, ended: self.sim.ended,
            allies: self.sim.aliveAllies().map(function (u) { return { id: u.id, x: u.x, y: u.y, hp: u.hp, ap: u.actionPoints }; }),
            enemies: self.sim.aliveEnemies().map(function (u) { return { id: u.id, x: u.x, y: u.y, hp: u.hp }; }),
            result: root.__FFG_RESULT__ || null,
          };
        },
        select: function (id) { var u = self.sim.getUnit(id); if (u && u.side === "player") self._select(u); return !!u; },
        move: function (id, x, y) { self._select(self.sim.getUnit(id)); return !!self.sim.moveUnit(id, x, y) && (self._refreshAfterScripted(), true); },
        attack: function (aid, tid) { var r = self.sim.attackUnit(aid, tid); self._refreshAfterScripted(); return r; },
        endTurn: function () { self.sim.endTurn(); self._refreshAfterScripted(); },
        // Standard cross-genre hook: greedily play to a resolution (used by the
        // feel gate). Each turn: move toward + shoot nearest enemy, then end turn.
        autoResolve: function (maxTurns) {
          var sim = self.sim, n = 0;
          while (!sim.ended && n++ < (maxTurns || 40)) {
            if (sim.currentPhase !== "player") { sim.endTurn(); continue; }
            var allies = sim.aliveAllies();
            for (var i = 0; i < allies.length; i++) {
              var u = sim.getUnit(allies[i].id), guard = 0;
              while (u.actionPoints > 0 && guard++ < 4 && !sim.ended) {
                var es = sim.aliveEnemies(); if (!es.length) break;
                es.sort(function (a, b) { return (Math.abs(a.x - u.x) + Math.abs(a.y - u.y)) - (Math.abs(b.x - u.x) + Math.abs(b.y - u.y)); });
                var e = es[0], d = Math.abs(e.x - u.x) + Math.abs(e.y - u.y);
                if (d <= u.range && sim.hasLineOfSight(u.x, u.y, e.x, e.y)) { sim.attackUnit(u.id, e.id); }
                else { var p = sim.findPath(u.x, u.y, e.x, e.y); if (!p || !p.length) break; var s = Math.min(p.length, u.movement); var dst = p[s - 1]; if (dst.x === e.x && dst.y === e.y) { if (s < 2) break; dst = p[s - 2]; } if (!sim.moveUnit(u.id, dst.x, dst.y)) break; }
              }
            }
            sim.endTurn();
          }
          self._refreshAfterScripted();
          return { ended: sim.ended, victory: sim.aliveAllies().length > 0, turns: sim.turnNumber };
        },
      };
    };

    // After a scripted (non-animated) action, sync views immediately.
    TacticsScene.prototype._refreshAfterScripted = function () {
      var self = this;
      this._events = [];
      this.sim.allUnits().forEach(function (u) {
        var v = self._unitViews[u.id]; if (!v) return;
        if (u.hp <= 0) { v.c.setVisible(false); return; }
        var w = self.t2w(u.x, u.y); v.c.x = w.x; v.c.y = w.y; self._refreshUnit(u);
      });
      if (this.sim.ended && !root.__FFG_RESULT__) this._win(this.sim.aliveAllies().length > 0);
    };

    return TacticsScene;
  });
})(typeof window !== "undefined" ? window : globalThis);
