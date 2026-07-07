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
const { Menu, saveRecord } = await import("./menu.js" + V);

const { CONST, SKINS, BIOMES, ranking, segRadius } = S;

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
    this.input = { steerMouse: 0, kb: 0, boost: false, touchSteer: null };
  }

  async init() {
    this.audio = new AudioSys();
    this.hud = new HUD(this.container, this.audio);
    this.menu = new Menu(this.container, this.audio, {
      onPractice: () => this.startPractice(),
      onOnline: () => this.openOnline(),
    });
    this._bindInput();
    this._buildAttract();
    this._exposeHooks();
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
    const W = S.createWorld({ seed, biome, simulateBots, idPrefix, slots: 12, foodTarget: this.content.setup?.foodTarget || 330 });
    this.W = W;
    this.planet = new Planet(this.scene, W.biome, W.seed, this.texLoader);
    this.snakeField = new SnakeField(this.scene, W);
    this.fx = new FX(this.scene, W, BIOME_DEFS[W.biome]);
    this.fx.onThunder = () => { this.audio.thunder(); this._shake = Math.max(this._shake, 0.35); };
    this.bloom.strength = W.biome === "abyss" || W.biome === "ember" ? 1.0 : 0.85;
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
    this.mode = "practice";
    this.mySlot = 0;
    this.sessionBest = 0;
    this.menu.hide();
    this.hud.show();
    this.hud.hideDeath();
    this.audio.setBiome(biome, seed);
    this.audio.respawn();
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
    this.mode = "online";
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
    this.audio.respawn();
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

  _saveMyRecord() {
    if (!this.W || this.mode === "attract") return;
    const me = S.snakeBySlot(this.W, this.mySlot);
    const best = Math.max(this.sessionBest, me ? me.mass : 0);
    if (best > CONST.START_MASS + 4) {
      saveRecord({ name: this.menu.getProfile().name, len: Math.round(best * 2.4), biome: this.W.biome, mode: this.mode, ts: Date.now() });
    }
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
  _bindInput() {
    const cv = this.renderer.domElement;
    window.addEventListener("mousemove", (e) => {
      const w = this.container.clientWidth;
      const dx = (e.clientX - w / 2) / (w * 0.3);
      this.input.steerMouse = Math.abs(dx) < 0.05 ? 0 : Math.max(-1, Math.min(1, dx));
    });
    cv.addEventListener("pointerdown", (e) => { if (e.button === 0) this.input.boost = true; });
    window.addEventListener("pointerup", () => { this.input.boost = false; });
    window.addEventListener("blur", () => { this.input.boost = false; this.input.kb = 0; });
    window.addEventListener("keydown", (e) => {
      if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
      if (e.code === "KeyA" || e.code === "ArrowLeft") this.input.kb = -1;
      else if (e.code === "KeyD" || e.code === "ArrowRight") this.input.kb = 1;
      else if (e.code === "Space") { this.input.boost = true; e.preventDefault(); }
      else if (e.code === "Escape") this._togglePause();
    });
    window.addEventListener("keyup", (e) => {
      if ((e.code === "KeyA" || e.code === "ArrowLeft") && this.input.kb === -1) this.input.kb = 0;
      if ((e.code === "KeyD" || e.code === "ArrowRight") && this.input.kb === 1) this.input.kb = 0;
      if (e.code === "Space") this.input.boost = false;
    });
    // touch: left zone steer (drag), right zone boost
    cv.addEventListener("touchstart", (e) => {
      for (const t of e.changedTouches) {
        if (t.clientX < this.container.clientWidth * 0.55) this.input.touchSteer = { id: t.identifier, x0: t.clientX };
        else this.input.boost = true;
      }
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener("touchmove", (e) => {
      if (!this.input.touchSteer) return;
      for (const t of e.changedTouches) {
        if (t.identifier === this.input.touchSteer.id) {
          const dx = (t.clientX - this.input.touchSteer.x0) / 70;
          this.input.steerMouse = Math.max(-1, Math.min(1, dx));
        }
      }
      e.preventDefault();
    }, { passive: false });
    cv.addEventListener("touchend", (e) => {
      for (const t of e.changedTouches) {
        if (this.input.touchSteer && t.identifier === this.input.touchSteer.id) { this.input.touchSteer = null; this.input.steerMouse = 0; }
        else this.input.boost = false;
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
        () => { this.paused = false; this.endToMenu(); });
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
    this.planet.update(dt, w.mods.vis, this.fx.flash);

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
    }

    this.composer.render();
  }

  _simTick(dt) {
    const W = this.W;
    // player steering
    if (this.mode !== "attract") {
      const me = S.snakeBySlot(W, this.mySlot);
      if (me && me.alive) {
        const steer = this.input.kb !== 0 ? this.input.kb : this.input.steerMouse;
        S.setInput(W, this.mySlot, { steer, boost: this.input.boost });
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
        if (ev.tier === 9 && ev.value > 2) this.hud.toast(`+${Math.round(ev.value * 2.4)} essence!`);
        else if (ev.tier === 3) this.hud.toast("rare gem +" + Math.round(ev.value * 2.4));
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
          this._saveMyRecord();
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
    const dist = 8.5 + r * 8.2, height = 5 + r * 5.4;
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
      setBoost(b) { self.input.boost = !!b; },
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
