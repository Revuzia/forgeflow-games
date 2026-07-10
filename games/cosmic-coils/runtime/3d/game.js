/**
 * Cosmic Coils — runtime/3d/game.js
 * Orchestrator: owns the sim world, planet/snake/fx renderers, camera, input,
 * menu/HUD flow, procedural audio, and (via net/coilnet.js) online play.
 *
 * Debug hook: window.__CC__ — state(), fastForward(s) is SYNCHRONOUS (the
 * preview tab freezes rAF when backgrounded, so tests drive the sim directly).
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
const S = await import("../sim/serpent.js" + V);
const { Planet, BIOME_DEFS } = await import("./planet.js" + V);
const { SnakeField } = await import("./snakes.js" + V);
const { FX } = await import("./fx.js" + V);
const { AudioSys } = await import("./audio.js" + V);
const { HUD } = await import("./hud.js" + V);
const { Menu, saveRecord, loadRecords } = await import("./menu.js" + V);

const { CONST, SKINS, BIOMES, ranking, segRadius } = S;

// graphics tiers: pixel ratio cap, bloom multiplier, particle budget multiplier
// pixel-ratio caps per tier. HIGH lowered 1.5→1.25 (big GPU win, ~imperceptible
// sharpness loss with bloom); LOW renders below native for weak machines.
const QUALITY_TIERS = {
  high: { dpr: 1.25, bloom: 1, particles: 1 },
  medium: { dpr: 1.0, bloom: 0.85, particles: 0.75 },
  low: { dpr: 0.8, bloom: 0.62, particles: 0.5 },
};

export class Game {
  constructor(env) {
    Object.assign(this, env); // THREE(unused, module import used), renderer, scene, camera, composer, bloom, container, content, V
    this.mode = "attract";
    this.W = null;
    this.planet = null;
    this.snakeField = null;
    this.fx = null;
    this.net = null;
    this.mySlot = 0;
    this.paused = false;
    this.pendingDeath = null;
    this.sessionBest = 0;
    this._deathGen = 0;
    this._deathTimer = null;
    this._acc = 0;
    this._last = performance.now();
    this._fps = 60;
    this._eatCombo = 0;
    this._eatComboT = 0;
    this._shake = 0;
    this._camPos = new THREE.Vector3(0, 0, CONST.R * 2.6);
    this._camUp = new THREE.Vector3(0, 1, 0);
    this._menuOrbit = 0;
    this.texLoader = new THREE.TextureLoader();
    // boost has three independent sources (W key, SPACE, LMB) so releasing one
    // never cancels another that's still held; same for the slow lever (S, RMB)
    this.input = { steerMouse: 0, kb: 0, bW: false, bSpace: false, bMouse: false, sKey: false, sMouse: false, touchBoost: false, touchStick: 0, touchSteer: null, throttle: 0, zoomTarget: 1 };
    this._zoom = 1;
    this.settings = {
      sens: parseFloat(localStorage.getItem("cc_sens") ?? "1.3"),
      invert: localStorage.getItem("cc_invert") === "1",
      quality: localStorage.getItem("cc_quality") || "high",
    };
  }

  async init() {
    this.audio = new AudioSys();
    this.hud = new HUD(this.container, this.audio);
    this.menu = new Menu(this.container, this.audio, {
      onPractice: () => this.startPractice(),
      onOnline: () => this.openOnline(),
      getSettings: () => ({ ...this.settings }),
      onSettings: (patch) => this.applySettings(patch),
    });
    this._bindInput();
    this.applySettings({});
    this._buildAttract();
    this._exposeHooks();
  }

  /** persist + apply user settings (mouse sens, invert, graphics quality) */
  applySettings(patch) {
    // a manual quality change (not the auto-tuner) clears the low-fps state so
    // the player's explicit choice sticks until it's genuinely too slow again
    if (patch && patch.quality && !patch._auto) { this._lowFpsT = 0; this._autoQCool = 8; }
    if (patch) delete patch._auto;
    Object.assign(this.settings, patch || {});
    try {
      localStorage.setItem("cc_sens", String(this.settings.sens));
      localStorage.setItem("cc_invert", this.settings.invert ? "1" : "0");
      localStorage.setItem("cc_quality", this.settings.quality);
    } catch (e) {}
    const t = QUALITY_TIERS[this.settings.quality] || QUALITY_TIERS.high;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, t.dpr));
    if (this.fx) this.fx.qMul = t.particles;
    this._applyBloom();
  }

  _applyBloom() {
    // dimmer global bloom so atmosphere ring + essence stay readable
    const base = this.W && (this.W.biome === "abyss" || this.W.biome === "ember") ? 0.46 : 0.38;
    const t = QUALITY_TIERS[this.settings.quality] || QUALITY_TIERS.high;
    this.bloom.strength = base * t.bloom;
  }

  /** FPS-adaptive quality: if the framerate stays low for a few seconds, drop
   * one graphics tier and tell the player (never auto-raises — avoids
   * oscillation). Resets when the user picks a tier manually. */
  _autoQuality(dt) {
    if (this.paused || this.settings.quality === "low") { this._lowFpsT = 0; return; }
    if (this._autoQCool > 0) { this._autoQCool -= dt; this._lowFpsT = 0; return; }
    if (this._fps < 45) this._lowFpsT = (this._lowFpsT || 0) + dt;
    else this._lowFpsT = Math.max(0, (this._lowFpsT || 0) - dt * 2);
    if (this._lowFpsT > 4) {
      const next = this.settings.quality === "high" ? "medium" : "low";
      this.applySettings({ quality: next, _auto: true });
      this.hud.toast(`⚙️ graphics → ${next.toUpperCase()} for smoother play`, "warn");
      this._lowFpsT = 0;
      this._autoQCool = 12; // don't re-trigger for 12s
    }
  }

  // ── worlds ────────────────────────────────────────────────────────────────
  _disposeWorld() {
    if (this.planet) { this.planet.dispose(); this.planet = null; }
    if (this.snakeField) { this.snakeField.dispose(); this.snakeField = null; }
    if (this.fx) { this.fx.dispose(); this.fx = null; }
    this.W = null;
  }

  _makeWorld({ seed, biome, simulateBots, idPrefix }) {
    if (this._deathTimer) { clearTimeout(this._deathTimer); this._deathTimer = null; }
    this._deathGen++;
    this._disposeWorld();
    const W = S.createWorld({ seed, biome, simulateBots, idPrefix, slots: 12, foodTarget: this.content.setup?.foodTarget || S.CONST.FOOD_TARGET });
    this.W = W;
    this.planet = new Planet(this.scene, W.biome, W.seed, this.texLoader);
    this.snakeField = new SnakeField(this.scene, W);
    this.fx = new FX(this.scene, W, BIOME_DEFS[W.biome]);
    this.fx.onThunder = () => { this.audio.thunder(); this._shake = Math.max(this._shake, 0.35); };
    this.fx.qMul = (QUALITY_TIERS[this.settings.quality] || QUALITY_TIERS.high).particles;
    this._applyBloom();
    return W;
  }

  _buildAttract() {
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const biome = BIOMES[Math.floor(Math.random() * BIOMES.length)];
    const W = this._makeWorld({ seed, biome, simulateBots: true });
    for (let i = 0; i < 12; i++) S.spawnSnake(W, i, { isBot: true });
    // pre-roll so the attract planet is already alive with big snakes
    for (let i = 0; i < 60 * 20; i++) S.step(W, 1 / 60);
    S.drainEvents(W);
    this.mode = "attract";
    this.hud.hide();
    this.menu.show("main");
  }

  startPractice(biomeOverride) {
    this._audit("startPractice");
    const seed = (Math.random() * 0xffffffff) >>> 0;
    const biome = biomeOverride || BIOMES[Math.floor(Math.random() * BIOMES.length)];
    const W = this._makeWorld({ seed, biome, simulateBots: true });
    const prof = this.menu.getProfile();
    S.spawnSnake(W, 0, { isBot: false, name: prof.name, skinId: prof.skinId });
    for (let i = 1; i < 12; i++) S.spawnSnake(W, i, { isBot: true });
    S.drainEvents(W);
    this.mode = "practice"; this._runSubmitted = false;
    this.mySlot = 0;
    this.sessionBest = 0;
    this.menu.hide();
    this.hud.show();
    this.hud.hideDeath();
    this.audio.setBiome(biome, seed);
    this.hud.countdown();
    this.hud.toast(`${BIOME_DEFS[biome].icon} welcome to ${BIOME_DEFS[biome].label}`, "");
  }

  async openOnline() {
    if (!this._netMod) this._netMod = await import("../net/coilnet.js" + V);
    this._netMod.openLobby(this);
  }

  /** called by coilnet when a match begins (host or guest) */
  startOnlineMatch(cfg, net) {
    this._audit("startOnlineMatch");
    // per-client food id prefix: a guest's boost pellets must never collide
    // with host-spawned gem ids (a "take" would then delete the wrong gem)
    const W = this._makeWorld({ seed: cfg.seed, biome: cfg.biome, simulateBots: net.isHost(), idPrefix: net.isHost() ? "h" : "g" + cfg.mySlot + "_" });
    this.net = net;
    this.mode = "online"; this._runSubmitted = false;
    this.mySlot = cfg.mySlot;
    this.sessionBest = 0;
    const humanSlots = new Set(cfg.roster.map((r) => r.slot));
    for (const r of cfg.roster) {
      S.spawnSnake(W, r.slot, {
        isBot: false, netRemote: r.slot !== cfg.mySlot,
        name: r.name, skinId: r.skinId,
      });
    }
    for (let i = 0; i < 12; i++) {
      if (!humanSlots.has(i)) S.spawnSnake(W, i, { isBot: true, netRemote: !net.isHost() });
    }
    S.drainEvents(W);
    this.menu.hide();
    this.hud.show();
    this.hud.hideDeath();
    this.audio.setBiome(cfg.biome, cfg.seed);
    this.hud.countdown();
    this.hud.toast(`${BIOME_DEFS[cfg.biome].icon} online — ${cfg.roster.length} serpent(s) connected`, "");
  }

  endToMenu() {
    this._saveMyRecord();
    if (this.net) { this.net.leave(); this.net = null; }
    this.paused = false;
    this.hud.hidePause();
    this.hud.hideDeath();
    this._buildAttract();
  }

  /** returns {newBest} — true when this run set a new device #1 (beating a
   * prior record), so the death screen can celebrate it. */
  _saveMyRecord() {
    if (!this.W || this.mode === "attract") return { newBest: false };
    const me = S.snakeBySlot(this.W, this.mySlot);
    const best = Math.max(this.sessionBest, me ? me.mass : 0);
    if (best <= CONST.START_MASS + 4) return { newBest: false };
    const len = Math.round(best * 2.4);
    const prev = loadRecords();
    const prevTop = prev.length ? prev[0].len : 0;
    saveRecord({ name: this.menu.getProfile().name, len, biome: this.W.biome, mode: this.mode, ts: Date.now() });
    // Report to the ForgeFlow account system via the standard portal bridge:
    // when the game is embedded in the forgeflowgames.com player (an iframe),
    // the portal submits this to leaderboard_scores — but ONLY for a signed-in
    // account. Guests play but aren't tracked. The game holds no auth/DB code.
    // Harmless no-op when played standalone (window.parent === window).
    if (!this._runSubmitted) {
      this._runSubmitted = true;
      try {
        if (window.parent && window.parent !== window) {
          window.parent.postMessage({ type: "forgeflow:game_over", score: len }, "*");
        }
      } catch (e) {}
    }
    // a genuine new best = beat an existing record (not just the first-ever run)
    return { newBest: prev.length > 0 && len > prevTop };
  }

  respawn() {
    if (!this.W) return;
    if (this._deathTimer) { clearTimeout(this._deathTimer); this._deathTimer = null; }
    const me = S.snakeBySlot(this.W, this.mySlot);
    if (me && me.alive) return; // never double-spawn a living snake
    this._audit("respawn");
    const prof = this.menu.getProfile();
    const sn = S.spawnSnake(this.W, this.mySlot, { isBot: false, name: prof.name, skinId: prof.skinId });
    this.hud.hideDeath();
    this.audio.respawn();
    if (this.net) this.net.sendSpawn(sn);
  }

  // ── input ─────────────────────────────────────────────────────────────────
  // SIGN NOTE: in the sim frame, POSITIVE steer turns LEFT (t' = t·cosφ +
  // (u×t)·sinφ with camera-up = u). Screen-intuitive controls therefore map
  // "right" to NEGATIVE steer: mouse right of center / D / drag-right = −1.
  // (Owner playtest 2026-07-07: A/D and mouse were inverted — this fixes it.)
  _bindInput() {
    const cv = this.renderer.domElement;
    window.addEventListener("mousemove", (e) => {
      const w = this.container.clientWidth;
      const dx = (e.clientX - w / 2) / (w * 0.3) * this.settings.sens;
      const signed = this.settings.invert ? dx : -dx;
      this.input.steerMouse = Math.abs(dx) < 0.04 ? 0 : Math.max(-1, Math.min(1, signed));
    });
    cv.addEventListener("pointerdown", (e) => {
      if (e.button === 0) this.input.bMouse = true;        // LMB = boost
      else if (e.button === 2) this.input.sMouse = true;   // RMB = slow, like S
    });
    window.addEventListener("pointerup", (e) => {
      if (e.button === 2) this.input.sMouse = false;
      else this.input.bMouse = false;
    });
    // RMB is a control, not a context menu
    this.container.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("blur", () => { this.input.bW = this.input.bSpace = this.input.bMouse = false; this.input.sKey = this.input.sMouse = false; this.input.kb = 0; });
    // auto-pause single-player when the tab goes to the background (online keeps
    // running — you can't freeze a shared match). Standard arcade courtesy.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.mode === "practice" && !this.paused) this._togglePause();
    });
    window.addEventListener("keydown", (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.code === "KeyA" || e.code === "ArrowLeft") this.input.kb = 1;
      else if (e.code === "KeyD" || e.code === "ArrowRight") this.input.kb = -1;
      else if (e.code === "KeyW" || e.code === "ArrowUp") this.input.bW = true;   // W = BOOST (same as LMB/SPACE)
      else if (e.code === "KeyS" || e.code === "ArrowDown") this.input.sKey = true;
      else if (e.code === "Space") { this.input.bSpace = true; e.preventDefault(); }
      else if (e.code === "Escape") this._togglePause();
      else if (e.code === "F3") {
        e.preventDefault();
        this.debugOn = !this.debugOn;
        this.hud.setDebug(this.debugOn);
      }
    });
    window.addEventListener("keyup", (e) => {
      if ((e.code === "KeyA" || e.code === "ArrowLeft") && this.input.kb === 1) this.input.kb = 0;
      if ((e.code === "KeyD" || e.code === "ArrowRight") && this.input.kb === -1) this.input.kb = 0;
      if (e.code === "KeyW" || e.code === "ArrowUp") this.input.bW = false;
      if (e.code === "KeyS" || e.code === "ArrowDown") this.input.sKey = false;
      if (e.code === "Space") this.input.bSpace = false;
    });
    // mouse wheel: zoom the chase camera out/in (persists until changed)
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const z = this.input.zoomTarget * (1 + e.deltaY * 0.0011);
      this.input.zoomTarget = Math.max(0.75, Math.min(2.3, z));
    }, { passive: false });
    // visible on-screen controls for touch devices (joystick + BOOST button).
    // When present, the raw-canvas fallback below is disabled to avoid double input.
    this._touchUI = this.hud.enableTouch(
      (x) => { this.input.touchStick = x; },
      (b) => { this.input.touchBoost = b; }
    );
    // fallback (no visible UI): left-zone drag steer, right-zone tap boost —
    // only when the on-screen joystick isn't active
    cv.addEventListener("touchstart", (e) => {
      if (this._touchUI) return;
      for (const t of e.changedTouches) {
        if (t.clientX < this.container.clientWidth * 0.55) this.input.touchSteer = { id: t.identifier, x0: t.clientX };
        else this.input.touchBoost = true;
      }
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener("touchmove", (e) => {
      if (this._touchUI || !this.input.touchSteer) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this.input.touchSteer.id) {
          const dx = (t.clientX - this.input.touchSteer.x0) / 70;
          this.input.steerMouse = Math.max(-1, Math.min(1, -dx));
        }
      }
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener("touchend", (e) => {
      if (this._touchUI) return;
      for (const t of e.changedTouches) {
        if (this.input.touchSteer && t.identifier === this.input.touchSteer.id) { this.input.touchSteer = null; this.input.steerMouse = 0; }
        else this.input.touchBoost = false;
      }
      e.preventDefault();
    }, { passive: false });

    window.__PAUSE__ = {
      toggle: () => this._togglePause(),
      pause: () => { if (!this.paused) this._togglePause(); },
      resume: () => { if (this.paused) this._togglePause(); },
      isPaused: () => this.paused,
    };
    window.addEventListener("mutechange", (ev) => {
      // page bar mute → suspend/resume our ctx (it also does this via __AUDIO_CTX__; belt+suspenders)
      if (!this.audio.ctx) return;
      if (ev.detail.muted) this.audio.suspend(); else this.audio.resume();
    });
  }

  _togglePause() {
    if (this.mode === "attract") return;
    this.paused = !this.paused;
    if (this.paused) {
      this.hud.showPause(
        { music: this.audio.musicVol, sfx: this.audio.sfxVol },
        () => this._togglePause(),
        () => { this.paused = false; this.endToMenu(); },
        this.settings.sens,
        (v) => this.applySettings({ sens: v }));
      if (this.mode === "online") this.hud.toast("online match keeps running!", "warn");
      else this.audio.suspend();
    } else {
      this.hud.hidePause();
      this.audio.resume();
    }
  }

  // ── main loop ─────────────────────────────────────────────────────────────
  start() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      let dt = (now - this._last) / 1000;
      this._last = now;
      if (!Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, 0.1);
      this._fps += (1 / Math.max(1e-3, dt) - this._fps) * 0.05;
      try { this._frame(dt); } catch (e) { console.error("[CC] frame error", e); }
    };
    requestAnimationFrame(loop);
  }

  _frame(dt) {
    this._frameT0 = performance.now();
    const W = this.W;
    if (!W) return;
    const simFrozen = this.paused && this.mode !== "online";

    if (!simFrozen) {
      this._acc = Math.min(this._acc + dt, 0.12);
      while (this._acc >= 1 / 60) {
        this._acc -= 1 / 60;
        this._simTick(1 / 60);
      }
    }

    // interpolate remote snakes between packets
    if (this.net) this.net.frame(dt);

    // visuals
    const w = W.weather;
    const rankArr = ranking(W);
    const leader = rankArr.length ? rankArr[0].slot : -1;
    this.snakeField.update(dt, this.mode === "attract" ? -1 : this.mySlot, leader);
    const me = this.mode === "attract" ? null : S.snakeBySlot(W, this.mySlot);
    const anchor = this._headWorld(me || (W.snakes.find((s) => s.alive)));
    this.fx.setWeather(w.kind, w.intensity);
    this.fx.update(dt, anchor, anchor ? anchor.clone().normalize() : null);
    this.planet.update(dt, w.mods.vis, this.fx.flash, w.kind === "aurora" ? w.intensity : 0);

    // boost FX + audio
    if (me && me.alive && me.boosting) {
      const head = this._headWorld(me);
      const back = new THREE.Vector3(-me.t.x, -me.t.y, -me.t.z);
      this.fx.boostTrail(head, back, SKINS[me.skinId % SKINS.length].glow);
    }
    this.audio.setBoost(!!(me && me.alive && me.boosting), dt);
    const stormAud = (w.kind !== "calm" && w.kind !== "fireflies" && w.kind !== "aurora") ? w.intensity : 0;
    this.audio.setStorm(stormAud, dt);
    this.audio.update(dt);

    this._camera(dt, me);

    if (this.mode !== "attract") {
      if (me && me.alive) this.sessionBest = Math.max(this.sessionBest, me.mass);
      this.hud.update(dt, W, this.mySlot, w, this.net ? this.net.humanSlots() : null, this.sessionBest);
      this.hud.setCombo(this._eatCombo, this._eatComboT / 2);
      this._autoQuality(dt);
    }

    const frameMs = performance.now() - (this._frameT0 || performance.now());
    this.composer.render();

    // F3 debug overlay (data gathered AFTER render so renderer.info is current)
    if (this.debugOn) {
      this._dbgWorst = Math.max(this._dbgWorst || 0, frameMs);
      this._dbgT = (this._dbgT || 0) + dt;
      if (this._dbgT > 0.25) {
        this._dbgT = 0;
        const info = this.renderer.info;
        const meD = me ? `mass ${me.mass.toFixed(1)} segs ${me.segN} ramp ${(me.boostRamp || 0).toFixed(2)} shield ${Math.max(0, me.shield).toFixed(1)}` : "—";
        const netD = this.net ? `room ${this.net.net.room} ${this.net.isHost() ? "HOST" : "guest"} peers ${this.net.peers.size} slot ${this.mySlot}` : "offline";
        this.hud.updateDebug(
          `FPS ${Math.round(this._fps)}  frame ${frameMs.toFixed(1)}ms  worst ${this._dbgWorst.toFixed(1)}ms\n` +
          `draws ${info.render.calls}  tris ${(info.render.triangles / 1000).toFixed(0)}k  progs ${info.programs.length}  geo ${info.memory.geometries}  tex ${info.memory.textures}\n` +
          `quality ${this.settings.quality.toUpperCase()}  dpr ${this.renderer.getPixelRatio().toFixed(2)}  zoom ${this._zoom.toFixed(2)}  bloom ${this.bloom.strength.toFixed(2)}\n` +
          `mode ${this.mode}  biome ${W.biome}  t ${W.time.toFixed(1)}s\n` +
          `weather ${w.kind} ${(w.intensity || 0).toFixed(2)}  vis ${w.mods.vis.toFixed(2)}  spd× ${w.mods.speed.toFixed(2)}\n` +
          `snakes ${W.snakes.filter((s) => s.alive).length}/12  segsDrawn ${this.snakeField.segMesh.count}  food ${W.food.size}\n` +
          `me: ${meD}\n` +
          `net: ${netD}  sens ${this.settings.sens.toFixed(2)}${this.settings.invert ? " INV" : ""}`
        );
        this._dbgWorst = 0;
      }
    }
  }

  _simTick(dt) {
    const W = this.W;
    // player steering
    if (this.mode !== "attract") {
      const me = S.snakeBySlot(W, this.mySlot);
      if (me && me.alive) {
        const steer = this.input.kb !== 0 ? this.input.kb : (this.input.touchStick || this.input.steerMouse);
        // throttle ramps while held ("longer you hold, faster it goes"), eases
        // back to neutral on release; boost overrides it in the sim
        // slow lever (S / RMB) ramps to -1 and back; boost sources are OR-ed
        const slow = this.input.sKey || this.input.sMouse;
        const tgt = slow ? -1 : 0;
        const rate = slow ? 1.4 : 1.7;
        this.input.throttle += (tgt - this.input.throttle) * Math.min(1, dt * rate);
        if (tgt === 0 && Math.abs(this.input.throttle) < 0.02) this.input.throttle = 0;
        const boost = this.input.bW || this.input.bSpace || this.input.bMouse || this.input.touchBoost;
        S.setInput(W, this.mySlot, { steer, boost, throttle: this.input.throttle });
      }
    }
    S.step(W, dt);
    // events → fx/audio/hud/net
    for (const ev of S.drainEvents(W)) this._onEvent(ev);
    if (this.net) this.net.simTick(dt);
  }

  _onEvent(ev) {
    const W = this.W;
    if (ev.type === "eat") {
      if (this.mode === "attract") return;
      this.fx.eatBurst(ev.u, ev.tier);
      if (ev.slot === this.mySlot) {
        this._eatComboT = 2;
        this.audio.eat(ev.tier, this._eatCombo++);
        // no essence popup (owner: too noisy) — rare gems still call out
        if (ev.tier === 3) this.hud.toast("rare gem +" + Math.round(ev.value * 2.4));
      }
      if (this.net) this.net.onSimEvent(ev);
      return;
    }
    if (ev.type === "death") {
      const sn = S.snakeBySlot(W, ev.slot);
      const skin = SKINS[(sn ? sn.skinId : 0) % SKINS.length];
      if (sn && this.mode !== "attract") {
        this.fx.deathBurst(sn.segs, sn.segN, skin.glow, W.R);
        const killer = ev.killer != null ? S.snakeBySlot(W, ev.killer) : null;
        if (killer && sn) this.hud.killFeed(killer.name, sn.name);
        if (ev.slot === this.mySlot) {
          this.audio.death(true);
          this._shake = 1;
          const rec = this._saveMyRecord();
          if (rec.newBest) { this.hud.toast("🏆 NEW PERSONAL BEST!", ""); this._shake = 1.4; }
          const len = Math.round(ev.mass * 2.4);
          // generation-guarded death screen: a stale timer from an earlier death
          // or an earlier world must never pop UI (or trigger actions) later
          const gen = ++this._deathGen;
          const world = this.W;
          if (this._deathTimer) clearTimeout(this._deathTimer);
          this._deathTimer = setTimeout(() => {
            this._deathTimer = null;
            if (this.mode === "attract" || this.W !== world || this._deathGen !== gen) return;
            const meNow = S.snakeBySlot(this.W, this.mySlot);
            if (meNow && meNow.alive) return; // already respawned some other way
            this.hud.showDeath(
              { killedBy: killer ? killer.name : null, length: len, kills: sn.kills || 0, best: Math.round(Math.max(this.sessionBest, ev.mass) * 2.4) },
              () => this.respawn(),
              () => this.endToMenu());
          }, 1100);
        } else {
          this.audio.death(false);
          if (ev.killer === this.mySlot) {
            this.audio.kill();
            this.hud.toast(`you coiled ${sn.name}! eat the essence`, "");
            this._shake = Math.max(this._shake, 0.3);
          }
        }
      }
      if (this.net) this.net.onSimEvent(ev);
      return;
    }
    if (ev.type === "foodAdd" || ev.type === "foodDel") {
      if (this.net) this.net.onSimEvent(ev);
    }
  }

  _headWorld(sn) {
    if (!sn) return null;
    const u = new THREE.Vector3(sn.u.x, sn.u.y, sn.u.z);
    const h = S.terrainH(u, this.W.seed, CONST.TERRAIN_AMP);
    return u.multiplyScalar(this.W.R + h + segRadius(sn.mass));
  }

  _camera(dt, me) {
    const W = this.W;
    const k = 1 - Math.exp(-dt * 5.5);
    if (this.mode === "attract" || !me) {
      // cinematic orbit
      this._menuOrbit += dt * 0.05;
      const r = W.R * 2.35;
      const target = new THREE.Vector3(
        Math.cos(this._menuOrbit) * r,
        Math.sin(this._menuOrbit * 0.7) * r * 0.4,
        Math.sin(this._menuOrbit) * r);
      this._camPos.lerp(target, Math.min(1, k));
      this._camUp.lerp(new THREE.Vector3(0, 1, 0), k).normalize();
      this.camera.position.copy(this._camPos);
      this.camera.up.copy(this._camUp);
      this.camera.lookAt(0, 0, 0);
      return;
    }
    // follow cam on the sphere
    const up = new THREE.Vector3(me.u.x, me.u.y, me.u.z);
    const fwd = new THREE.Vector3(me.t.x, me.t.y, me.t.z);
    const r = segRadius(me.mass);
    const head = this._headWorld(me);
    this._zoom += (this.input.zoomTarget - this._zoom) * Math.min(1, dt * 6);
    const dist = (8.5 + r * 8.2) * this._zoom, height = (5 + r * 5.4) * this._zoom;
    const want = head.clone().addScaledVector(fwd, -dist).addScaledVector(up, height);
    if (!me.alive) want.addScaledVector(up, 10); // death: rise above the scene
    this._camPos.lerp(want, k);
    this._camUp.lerp(up, 1 - Math.exp(-dt * 3.2)).normalize();
    // screen shake
    this._shake = Math.max(0, this._shake - dt * 2.2);
    const sh = this._shake * this._shake * 0.6;
    const jit = new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh);
    this.camera.position.copy(this._camPos).add(jit);
    this.camera.up.copy(this._camUp);
    const look = head.clone().addScaledVector(fwd, 6.5).addScaledVector(up, 1.1);
    this.camera.lookAt(look);
    // eat combo decay
    this._eatComboT -= dt;
    if (this._eatComboT <= 0) this._eatCombo = 0;
  }

  // ── debug hooks ───────────────────────────────────────────────────────────
  /** spawn-path audit trail — every route that can (re)create the player's
   * snake records itself here; readable via __CC__.audit() */
  _audit(tag) {
    if (!this._auditLog) this._auditLog = [];
    this._auditLog.push({ tag, t: this.W ? +this.W.time.toFixed(1) : -1, wall: Math.round(performance.now() / 100) / 10, stack: (new Error()).stack.split("\n").slice(2, 6).map((s) => s.trim()).join(" | ") });
    if (this._auditLog.length > 40) this._auditLog.shift();
  }

  _exposeHooks() {
    const self = this;
    window.__CC__ = {
      version: 1,
      game: self,
      world: () => self.W,
      state() {
        const W = self.W;
        const me = W ? S.snakeBySlot(W, self.mySlot) : null;
        const rank = W ? ranking(W) : [];
        return {
          mode: self.mode, paused: self.paused, biome: W && W.biome, time: W && +W.time.toFixed(2),
          fps: Math.round(self._fps),
          weather: W && W.weather.kind, weatherI: W && +(W.weather.intensity || 0).toFixed(2),
          snakes: W ? W.snakes.filter((s) => s.alive).length : 0,
          food: W ? W.food.size : 0,
          me: me ? { alive: me.alive, mass: +me.mass.toFixed(1), segs: me.segN, kills: me.kills, boosting: !!me.boosting, shield: +me.shield.toFixed(2) } : null,
          rank1: rank[0] ? { name: rank[0].name, mass: Math.round(rank[0].mass) } : null,
          segDraw: self.snakeField ? self.snakeField.segMesh.count : 0,
          online: self.net ? self.net.debug() : null,
          menuVisible: self.menu.root.style.display !== "none",
          deathVisible: !!self.hud.deathEl,
        };
      },
      fastForward(sec) {
        const n = Math.round(sec * 60);
        for (let i = 0; i < n; i++) self._simTick(1 / 60);
        return this.state();
      },
      startPractice(biome) { self.startPractice(biome); return this.state(); },
      toMenu() { self.endToMenu(); return this.state(); },
      respawn() { self.respawn(); return this.state(); },
      setSteer(v) { self.input.steerMouse = v; },
      setBoost(b) { self.input.bSpace = !!b; },
      killPlayer() {
        const me = S.snakeBySlot(self.W, self.mySlot);
        if (me && me.alive) S.killSnake(self.W, me, null);
        for (const ev of S.drainEvents(self.W)) self._onEvent(ev);
        return this.state();
      },
      spawnFoodAtPlayer(tier = 2) {
        const me = S.snakeBySlot(self.W, self.mySlot);
        if (me) S.spawnFood(self.W, { x: me.u.x, y: me.u.y, z: me.u.z }, tier);
      },
      audit() { return self._auditLog || []; },
      sim: S,
    };
  }
}
