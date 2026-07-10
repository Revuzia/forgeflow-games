// Thronedrift — world orchestrator: arena, mobs/bosses, projectiles, pickups,
// residuals, camera/juice, and the mode layer (campaign waves or PVP). All
// playable fighters are Champion entities (sim/champion.js) driven by
// controllers (human / bot / remote) so every mode shares one combat core.

import * as THREE from "three";
import { ARENAS, BOARD_RADIUS, REST_BETWEEN_WAVES } from "../data/arenas.js";
import { ALL_TYPES, waveComp, levelWaves, LEVELS_PER_REALM } from "../data/enemies.js";
import { CLASSES } from "../data/abilities.js";
import { ArenaBoard } from "../view/arena.js";
import { Actor, makeArrow, makeSwipeArc } from "../view/chars.js";
import { Particles, FloatText, Decals, WorldBars } from "../view/fx.js";
import { SFX } from "../core/audio.js";
import { Music } from "../core/music.js";
import { clamp, rand, randInt, damp, dist2, formatScore, save } from "../core/util.js";
import { Champion, PLAYER_R } from "./champion.js";
import { PlayerController, BotController, botName, botClass } from "./controllers.js";
import { CampaignMode, FfaMode, DuelMode, TeamsMode } from "./modes.js";

const SPAWN_TELEGRAPH = 0.85;
const RISE_TIME = 0.45;

export class Game {
  constructor({ renderer, camera, hud, input, heroes, enemies, props, container }) {
    this.renderer = renderer; this.camera = camera;
    this.hud = hud; this.input = input;
    this.heroLib = heroes; this.enemyLib = enemies; this.propLib = props || {};
    this.container = container;

    this.scene = new THREE.Scene();
    this.state = "menu";
    this.timeScale = 1; this.hitstopT = 0;
    this.shake = 0;
    this.timers = [];
    this.settings = { shake: save.get("set_shake", true), dmgNum: save.get("set_dmgnum", true) };
    hud.cb.onSettings = (k, v) => { this.settings[k] = v; };
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();

    this.fx = null; this.text = null; this.decals = null; this.board = null;
    this.champions = []; this.local = null; this.mode = null;
    this.roundLive = true; this.cameraTarget = null;

    hud.cb.onStart = (classId, arenaIdx, levelIdx) => this.startRun(classId, arenaIdx, levelIdx || 0);
    hud.cb.onStartVersus = (modeId, classId, arenaIdx, roster) => this.startVersusWithRoster(modeId, classId, arenaIdx, roster);
    hud.cb.portrait = (type) => this.renderPortrait(type);
    this.camera.position.set(0, 16, 12);
    this.camera.lookAt(0, 0, 0);
  }

  // ================= WORLD / RUN SETUP ===================================

  _setupWorld(arenaIdx) {
    this.cleanupRun();
    this.disposeShowcase();
    this.hud.hideMenus();
    this.hud.clearPanel();
    this.arenaIdx = arenaIdx;
    this.arena = ARENAS[arenaIdx];
    this.board = new ArenaBoard(this.scene, this.arena);
    this.fx = new Particles(this.scene);
    this.text = new FloatText(this.hud.layerGame, this.camera);
    this.decals = new Decals(this.scene);
    this.bars = new WorldBars(this.hud.layerGame, this.camera);
    this.discovered = new Set(save.get("bestiary", []));
    this.enemies = [];
    this.projectiles = [];
    this.fallers = [];
    this.pickups = [];
    this.swipes = [];
    this.spawnQueue = [];
    this.pendingSpawns = [];
    this.waveIdx = -1; this.waveActive = false; this.restT = 1.4;
    this.paused = false;
    this.roundLive = true;
    this.cameraTarget = null;
  }

  addChampion(spec) {
    const c = new Champion(this, { id: this.champions.length, ...spec });
    this.champions.push(c);
    if (spec.isLocal) this.local = c;
    return c;
  }

  /** CAMPAIGN — one local champion vs the realm's waves */
  startRun(classId, arenaIdx, levelIdx = 0) {
    this._setupWorld(arenaIdx);
    this.levelIdx = levelIdx;
    this.levelWaveCount = levelWaves(this.arena.order, levelIdx);
    this.classId = classId;
    this.mode = new CampaignMode();
    this.mode.setup(this);
    const c = this.addChampion({ classId, controller: new PlayerController(this.input, this), team: "players", isLocal: true, name: "You" });
    c.x = 0; c.z = 4;

    this.hud.setKit(c.cls, c.kit(), c.modeIdx, c.modeKeys.length);
    this.hud.setHearts(c.hp, c.maxHp);
    this.hud.setGold(0); this.hud.setScore(0);
    this.hud.setWave(1, this.levelWaveCount, this.arena.name, "#" + this.arena.accent.toString(16).padStart(6, "0"), this.levelIdx);
    const hintBits = ["<b>WASD</b> move", "<b>J / Click</b> attack", "<b>1 2 3</b> abilities"];
    if (c.modeKeys.length > 1) hintBits.push("<b>TAB</b> weapon mode", "<b>hold 3</b> Block (Sword & Shield)");
    this.hud.hint(hintBits.join(" · "), 7);

    this.state = "playing";
    Music.play(this.levelIdx >= 4 ? "boss" : "level");
    this.input.enabled = true;
    this.input.clearEdges();
    const sub = this.levelIdx >= 4 ? "BOSS LEVEL — " + this.arena.tagline : `Level ${this.levelIdx + 1} of ${LEVELS_PER_REALM}`;
    this.hud.banner(this.arena.name.toUpperCase(), { color: "#" + this.arena.accent.toString(16).padStart(6, "0"), sub, dur: 2.2, size: 46 });
  }

  /** VERSUS — roster from the lobby ({classId, name, isBot, team, skill}) */
  startVersusWithRoster(modeId, classId, arenaIdx, roster) {
    this._setupWorld(arenaIdx);
    this.levelIdx = 0;
    this.classId = classId;
    const specs = roster.map((r) => ({
      classId: r.classId,
      controller: r.isBot ? new BotController({ skill: r.skill || 1 }) : new PlayerController(this.input, this),
      team: r.team, isLocal: !r.isBot && r.isLocal, name: r.name,
    }));
    this.mode = modeId === "ffa" ? new FfaMode(specs) : modeId === "duel" ? new DuelMode(specs) : new TeamsMode(specs);
    this.state = "playing";
    this.mode.setup(this);
    const c = this.local;
    this.hud.setKit(c.cls, c.kit(), c.modeIdx, c.modeKeys.length);
    this.hud.setHearts(c.hp, c.maxHp);
    this.hud.setGold(0); this.hud.setScore(0);
    this.hud.setScoreboard(this.champions, modeId, this.mode.roundWins);
    Music.play("boss");
    this.input.enabled = true;
    this.input.clearEdges();
  }

  /** convenience for REMATCH: rebuild an equivalent roster */
  startVersus(modeId, classId, arenaIdx) {
    const mk = (team, isLocal = false) => isLocal
      ? { classId, name: "You", isBot: false, isLocal: true, team }
      : { classId: botClass(), name: botName(), isBot: true, team, skill: rand(0.85, 1.15) };
    let roster;
    if (modeId === "ffa") roster = [mk("T0", true), mk("T1"), mk("T2"), mk("T3"), mk("T4")];
    else if (modeId === "duel") roster = [mk("A", true), mk("B")];
    else roster = [mk("A", true), mk("A"), mk("B"), mk("B")];
    this.startVersusWithRoster(modeId, classId, arenaIdx, roster);
  }

  cleanupRun() {
    if (this.board) { this.board.dispose(); this.board = null; }
    if (this.fx) { this.fx.dispose(this.scene); this.fx = null; }
    if (this.decals) { this.decals.clear(); this.decals = null; }
    if (this.text) { this.text.clear(); this.text = null; }
    if (this.bars) { this.bars.clear(); this.bars = null; }
    if (this.champions) for (const c of this.champions) c.dispose();
    this.champions = []; this.local = null;
    if (this.mode) { this.mode.onLeave(); this.mode = null; }
    if (this.enemies) for (const e of this.enemies) e.actor.dispose();
    if (this.projectiles) for (const p of this.projectiles) p.mesh.removeFromParent();
    if (this.fallers) for (const f of this.fallers) f.mesh.removeFromParent();
    if (this.pickups) for (const p of this.pickups) p.mesh.removeFromParent();
    if (this.swipes) for (const s of this.swipes) s.m.removeFromParent();
    this.swipes = [];
    this.bossRef = null; if (this.hud.setBoss) this.hud.setBoss(null);
    if (this.hud.setScoreboard) this.hud.setScoreboard(null);
    if (this.hud.setMatchStatus) this.hud.setMatchStatus(null);
    this.enemies = []; this.projectiles = []; this.fallers = []; this.pickups = []; this.timers = [];
    this.pendingSpawns = []; this.spawnQueue = [];
    this.timeScale = 1; this.shake = 0; this.paused = false;
    this.roundLive = true; this.cameraTarget = null;
  }

  /** wipe transient combat state between PVP rounds (board persists) */
  clearTransient() {
    for (const p of this.projectiles) p.mesh.removeFromParent();
    for (const f of this.fallers) f.mesh.removeFromParent();
    for (const s of this.swipes) s.m.removeFromParent();
    for (const p of this.pickups) p.mesh.removeFromParent();
    this.projectiles = []; this.fallers = []; this.swipes = []; this.pickups = [];
    this.timers = [];
    this.decals.clear();
  }

  // ================= WAVES (campaign) ====================================

  startWave() {
    this.waveIdx++;
    this.waveActive = true;
    const comp = waveComp(this.arena.order, this.levelIdx, this.waveIdx, this.levelWaveCount);
    let delay = 0.5;
    for (const [type, count] of comp)
      for (let n = 0; n < count; n++) {
        this.spawnQueue.push({ type, t: delay });
        delay += rand(0.35, 0.75);
      }
    this.hud.setWave(this.waveIdx + 1, this.levelWaveCount, this.arena.name, "#" + this.arena.accent.toString(16).padStart(6, "0"), this.levelIdx);
    this.hud.banner(this.levelIdx >= 4 ? "THE WARDEN COMES" : `WAVE ${this.waveIdx + 1}`, { color: "#f2e8d8", dur: 1.4, size: 46 });
    SFX.play("ui_big");
  }

  spawnEnemy(type, x, z) {
    const def = ALL_TYPES[type];
    const lib = this.enemyLib[def.model];
    if (!lib) return;
    const actor = new Actor(lib, { height: def.height, tint: this.arena.enemyTint });
    actor.root.position.set(x, -def.height, z);
    this.scene.add(actor.root);
    actor.play("Walk", { timeScale: 1.1 });
    const e = {
      def, type, actor, x, z, hp: def.hp, maxHp: def.hp,
      atkT: rand(0.6, 1.4), windup: 0, statuses: { shock: 0, burn: 0, frost: 0 },
      knockX: 0, knockZ: 0, spawnT: RISE_TIME + 0.3, riseT: RISE_TIME,
      statusFxT: 0, floatPhase: rand(Math.PI * 2), hopT: rand(0.6),
      dead: false, deadT: 0, targetRef: null, retargetT: 0,
    };
    if (def.boss && this.levelIdx >= 4) { e.hp = e.maxHp = Math.round(def.hp * 1.25); }
    this.enemies.push(e);
    if (def.boss) {
      this.bossRef = e;
      Music.play("boss");
      this.hud.setBoss(def.name, 1);
      this.hud.banner(def.name.toUpperCase(), { color: "#" + this.arena.accent.toString(16).padStart(6, "0"), sub: def.role, dur: 2.6, size: 40 });
      this.addShake(0.6);
    }
    this.fx.burst(x, 0.3, z, { count: 22, color: 0x6a5040, color2: this.arena.portal, speed: 3.5, up: 3.2, life: 0.55, spread: 1.5 });
    SFX.play("slam");
    if (!this.discovered.has(type)) {
      this.discovered.add(type);
      save.set("bestiary", [...this.discovered]);
      this.hud.toast(`NEW FOE — ${def.name.toUpperCase()}`, "#8ae0ff");
    }
    return e;
  }

  waveCleared() {
    this.waveActive = false;
    const c = this.local;
    const bonus = 250 * (this.waveIdx + 1) * c.mult;
    c.score += bonus;
    this.hud.setScore(c.score);
    SFX.play("wave_clear");
    this.hud.banner("WAVE CLEAR", { color: "#ffd24a", sub: `+${formatScore(bonus)} bonus`, dur: 1.8 });
    c.hp = Math.min(c.maxHp, c.hp + 1);
    this.hud.setHearts(c.hp, c.maxHp);
    if (this.waveIdx + 1 >= this.levelWaveCount) { this.levelCleared(); return; }
    this.restT = REST_BETWEEN_WAVES;
  }

  levelCleared() {
    if (this.levelIdx >= LEVELS_PER_REALM - 1) { this.arenaCleared(); return; }
    this.state = "arenaclear";
    this.input.enabled = false;
    SFX.play("wave_clear");
    const prog = save.get("progress", {});
    const cur = prog[this.arena.order] || 0;
    if (this.levelIdx + 1 > cur) { prog[this.arena.order] = this.levelIdx + 1; save.set("progress", prog); }
    const hi = save.get("hiscore", 0);
    if (this.local.score > hi) save.set("hiscore", this.local.score);
    const nextIsBoss = this.levelIdx + 1 === LEVELS_PER_REALM - 1;
    this.hud.panel({
      title: `LEVEL ${this.levelIdx + 1} CLEAR!`,
      titleColor: "#" + this.arena.accent.toString(16).padStart(6, "0"),
      lines: [
        `Score: <b style="color:#ffd24a;font-size:22px">${formatScore(this.local.score)}</b> · Gold: 🪙 ${this.local.gold}`,
        nextIsBoss ? `<b style="color:#ff6a8a">Next: the realm Warden awaits…</b>` : `Next: Level ${this.levelIdx + 2} of ${LEVELS_PER_REALM}`,
      ],
      buttons: [
        { label: nextIsBoss ? "FACE THE WARDEN →" : "NEXT LEVEL →", fn: () => this.startRun(this.classId, this.arenaIdx, this.levelIdx + 1) },
        { label: "LEVEL SELECT", fn: () => { this.toMenu(); this.hud.showLevelSelect(this.classId, this.arenaIdx); } },
        { label: "MENU", fn: () => this.toMenu() },
      ],
    });
  }

  arenaCleared() {
    this.state = "arenaclear";
    this.input.enabled = false;
    SFX.play("victory");
    const final = this.arena.clearIsFinal;
    const unlocked = save.get("unlocked", 1);
    if (!final && this.arena.order + 1 > unlocked) save.set("unlocked", this.arena.order + 1);
    const prog = save.get("progress", {});
    prog[this.arena.order] = LEVELS_PER_REALM;
    save.set("progress", prog);
    const hi = save.get("hiscore", 0);
    if (this.local.score > hi) save.set("hiscore", this.local.score);
    const lines = [
      `Final score: <b style="color:#ffd24a;font-size:24px">${formatScore(this.local.score)}</b>`,
      `Best: ${formatScore(Math.max(hi, this.local.score))} · Gold earned: 🪙 ${this.local.gold}`,
    ];
    const buttons = [];
    if (!final) buttons.push({ label: "NEXT REALM →", fn: () => this.startRun(this.classId, this.arenaIdx + 1, 0) });
    buttons.push({ label: "RESTART BOSS", fn: () => this.startRun(this.classId, this.arenaIdx, this.levelIdx) });
    buttons.push({ label: "MENU", fn: () => this.toMenu() });
    this.hud.panel({
      title: this.arena.clearWord,
      titleColor: final ? "#ffd24a" : "#" + this.arena.accent.toString(16).padStart(6, "0"),
      lines: final ? [`<div style="font-size:40px;margin-top:4px">👑</div>`, ...lines] : lines,
      buttons,
    });
  }

  gameOver() {
    if (this.state !== "playing") return;
    this.state = "gameover";
    this.input.enabled = false;
    SFX.play("game_over");
    const hi = save.get("hiscore", 0);
    if (this.local.score > hi) save.set("hiscore", this.local.score);
    setTimeout(() => this.hud.panel({
      title: "FALLEN IN THE ARENA",
      titleColor: "#ff5a4a",
      lines: [
        `You fell on level ${this.levelIdx + 1}, wave ${this.waveIdx + 1} of ${this.arena.name}.`,
        `Score: <b style="color:#ffd24a;font-size:22px">${formatScore(this.local.score)}</b> · Best: ${formatScore(Math.max(hi, this.local.score))}`,
      ],
      buttons: [
        { label: "RETRY LEVEL", fn: () => this.startRun(this.classId, this.arenaIdx, this.levelIdx) },
        { label: "MENU", fn: () => this.toMenu() },
      ],
    }), 1100);
  }

  toMenu() {
    this.cleanupRun();
    this.state = "menu";
    Music.play("menu");
    this.hud.clearPanel();
    this.buildMenuShowcase();
    this.hud.showTitle();
  }

  setPaused(v) {
    if (this.state !== "playing") return;
    this.paused = v;
    SFX.play("ui");
    if (v) this._pauseMenu();
    else this.hud.clearPanel();
  }

  _pauseMenu() {
    const versus = this.mode && !this.mode.usesWaves;
    this.hud.panel({
      title: "PAUSED", titleColor: "#e8b83a",
      lines: [versus ? `${this.mode.statusText()}` : `${this.arena.name} — level ${this.levelIdx + 1}, wave ${Math.max(1, this.waveIdx + 1)}`,
        `<span style="font-size:13px;color:#b89ae0">Scroll = zoom · Right-drag = rotate camera · ESC = resume</span>`,
        versus ? `<span style="font-size:12px;color:#8a7aa8">Note: bots keep fighting while you pause in versus</span>` : ""],
      buttons: [
        { label: "RESUME", fn: () => this.setPaused(false) },
        { label: "SETTINGS", fn: () => this.hud.settingsPanel(() => this._pauseMenu()) },
        ...(versus
          ? [{ label: "LEAVE MATCH", fn: () => { this.toMenu(); } }]
          : [{ label: "RESTART", fn: () => this.startRun(this.classId, this.arenaIdx, this.levelIdx) },
             { label: "QUIT TO MENU", fn: () => this.toMenu() }]),
      ],
    });
  }

  // ================= TARGETING / DAMAGE DISPATCH =========================

  after(t, fn) { this.timers.push({ t, fn }); }
  championById(id) { return this.champions.find((c) => c.id === id) || null; }

  /** all living hostiles (mobs + enemy champions) for a champion */
  allHostiles(ch) {
    const out = [];
    for (const e of this.enemies) if (!e.dead) out.push(e);
    for (const c of this.champions) if (!c.dead && c.team !== ch.team) out.push(c);
    return out;
  }

  nearestHostile(ch, maxD = 999) {
    let best = null, bd = maxD * maxD;
    for (const t of this.allHostiles(ch)) {
      const d = dist2(t.x, t.z, ch.x, ch.z);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  hostilesInArc(ch, arc, range) {
    const out = [];
    for (const t of this.allHostiles(ch)) {
      const dx = t.x - ch.x, dz = t.z - ch.z;
      const d = Math.hypot(dx, dz);
      const pad = t.isChampion ? PLAYER_R : t.def.height * 0.28;
      if (d > range + pad) continue;
      const ang = Math.atan2(dz, dx);
      let diff = Math.abs(ang - ch.facing) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff <= arc / 2) out.push(t);
    }
    return out;
  }

  hostilesInRadius(ch, x, z, radius) {
    const out = [];
    for (const t of this.allHostiles(ch)) {
      const pad = t.isChampion ? PLAYER_R : t.def.height * 0.2;
      if (dist2(t.x, t.z, x, z) <= (radius + pad) ** 2) out.push(t);
    }
    return out;
  }

  hostilesInLine(ch, a, length, width) {
    const out = [];
    for (const t of this.allHostiles(ch)) {
      const relX = t.x - ch.x, relZ = t.z - ch.z;
      const along = relX * Math.cos(a) + relZ * Math.sin(a);
      const across = Math.abs(-relX * Math.sin(a) + relZ * Math.cos(a));
      const pad = t.isChampion ? PLAYER_R : t.def.height * 0.2;
      if (along > 0 && along < length && across < width / 2 + pad) out.push(t);
    }
    return out;
  }

  /** unified damage entry: routes to champion or mob paths.
   *  Champion-vs-champion damage converts weapon numbers (tuned for mob HP
   *  pools) into hearts: TTK lands at ~4-8s instead of one-shots. */
  applyDamage(target, dmg, opts = {}, attacker = null) {
    if (target.isChampion) {
      const scaled = attacker && attacker.isChampion ? Math.max(0.35, dmg * 0.12) : dmg;
      const hit = target.takeDamage(scaled, opts.fromX ?? (attacker ? attacker.x : undefined), opts.fromZ ?? (attacker ? attacker.z : undefined), attacker, dmg);
      if (hit && opts.knockback) {
        const fx = opts.fromX ?? attacker.x, fz = opts.fromZ ?? attacker.z;
        const d = Math.max(0.001, Math.hypot(target.x - fx, target.z - fz));
        target.knockX += (target.x - fx) / d * opts.knockback;
        target.knockZ += (target.z - fz) / d * opts.knockback;
      }
      if (hit && opts.status) target.applyStatus(opts.status);
      if (hit && attacker && attacker.isChampion) {
        attacker.registerHit();
        if (this.settings.dmgNum !== false)
          this.text.spawn(String(Math.round(dmg)), target.x + rand(-0.3, 0.3), 1.6, target.z, { color: opts.heavy ? "#ffcf4a" : "#fff", size: opts.heavy ? 24 : 17 });
      }
      return;
    } else {
      this.hurtEnemy(target, dmg, opts, attacker);
    }
  }

  /** each mob chases its own champion target, re-picked every couple seconds */
  mobTarget(e) {
    e.retargetT -= 1 / 60;
    if (!e.targetRef || e.targetRef.dead || e.retargetT <= 0) {
      let best = null, bd = 1e18;
      for (const c of this.champions) {
        if (c.dead) continue;
        const d = dist2(c.x, c.z, e.x, e.z);
        if (d < bd) { bd = d; best = c; }
      }
      e.targetRef = best;
      e.retargetT = 2;
    }
    return e.targetRef;
  }

  // ================= MOB DAMAGE ==========================================

  hurtEnemy(e, dmg, { knockback = 0, fromX, fromZ, status = null, heavy = false, silent = false } = {}, attacker = null) {
    if (e.dead || e.spawnT > 0.1) return;
    const ax = fromX ?? (attacker ? attacker.x : e.x), az = fromZ ?? (attacker ? attacker.z : e.z);
    e.hp -= dmg;
    if (attacker && attacker.isChampion) {
      attacker.registerHit();
      attacker.dmgDealt += dmg;
      attacker.score += Math.round(dmg * attacker.mult);
      if (attacker.isLocal) this.hud.setScore(attacker.score);
    }
    if (!silent) SFX.play(heavy ? "hit_heavy" : "hit");
    const y = e.def.height * 0.7;
    if (this.settings.dmgNum !== false)
      this.text.spawn(String(Math.round(dmg)), e.x + rand(-0.3, 0.3), y, e.z, { color: heavy ? "#ffcf4a" : "#fff", size: heavy ? 24 : 17 });
    this.fx.burst(e.x, y * 0.7, e.z, { count: heavy ? 16 : 8, color: 0xffe0a0, color2: 0xff5a3a, speed: 3.2, up: 2, life: 0.35 });
    if (knockback) {
      const d = Math.max(0.001, Math.hypot(e.x - ax, e.z - az));
      const k = knockback * e.def.knockMult;
      e.knockX += (e.x - ax) / d * k; e.knockZ += (e.z - az) / d * k;
    }
    if (status) this.applyStatus(e, status);
    if (e.hp <= 0) this.killEnemy(e, attacker);
  }

  applyStatus(e, status) {
    const mods = this.arena.modifiers;
    if (status.shock) {
      e.statuses.shock = Math.max(e.statuses.shock, status.shock * (mods.shockDurMult || 1));
      this.text.spawn("SHOCK", e.x, e.def.height + 0.3, e.z, { color: "#b0a0ff", size: 21 });
      this.fx.burst(e.x, e.def.height * 0.6, e.z, { count: 12, color: 0xb0a0ff, color2: 0xffffff, speed: 2.5, up: 1.5, life: 0.3 });
      SFX.play("shock");
    }
    if (status.burn) {
      e.statuses.burn = Math.max(e.statuses.burn, status.burn);
      this.text.spawn("BURN", e.x, e.def.height + 0.3, e.z, { color: "#ff8a3a", size: 18 });
      SFX.play("burn");
    }
    if (status.frost) {
      e.statuses.frost = Math.max(e.statuses.frost, status.frost);
      this.text.spawn("FROST", e.x, e.def.height + 0.3, e.z, { color: "#8ae0ff", size: 18 });
      SFX.play("frost");
    }
    if (status.stagger) e.windup = 0, e.atkT = Math.max(e.atkT, status.stagger);
  }

  killEnemy(e, attacker = null) {
    if (e.dead) return;
    e.dead = true; e.deadT = 0;
    if (e.def.boss) {
      this.bossRef = null;
      Music.play("level");
      this.hud.setBoss(null);
      this.hud.banner(e.def.name.split(",")[0].toUpperCase() + " FALLS!", { color: "#ffd24a", dur: 2.2, size: 44 });
      this.addShake(0.9); this.hitstop(0.1);
    }
    const drops = e.def.boss ? 2 : (Math.random() < 0.08 ? 1 : 0);
    for (let n = 0; n < drops; n++) this.spawnPickup(e.x + rand(-0.8, 0.8), e.z + rand(-0.8, 0.8));
    const credit = attacker && attacker.isChampion ? attacker : this.local;
    if (credit) {
      const pts = e.def.score * credit.mult;
      credit.score += pts;
      if (credit.isLocal) this.hud.setScore(credit.score);
      const g = randInt(e.def.gold[0], e.def.gold[1]);
      if (g > 0) { credit.gold += g; if (credit.isLocal) { this.hud.setGold(credit.gold); SFX.play("coin"); } }
      this.text.spawn(`+${formatScore(pts)}`, e.x, e.def.height, e.z, { color: "#ffd24a", size: 19, life: 1.1 });
    }
    SFX.play("death");
    this.fx.burst(e.x, e.def.height * 0.5, e.z, { count: 26, color: this.arena.accent, color2: 0xffffff, speed: 4, up: 3, life: 0.6 });
    if (e.actor.actions["C_death"] || Object.keys(e.actor.actions).some((n) => /death|die/i.test(n))) {
      const dn = e.actor.actions["C_death"] ? "C_death" : Object.keys(e.actor.actions).find((n) => /death|die/i.test(n));
      e.actor.playOnce(dn, { timeScale: 1.4 });
    }
  }

  addShake(m) { if (this.settings.shake === false) return; this.shake = Math.min(1.4, this.shake + m); }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }

  // ================= SHARED FX / PROJECTILES =============================

  spawnSwipe(ch, color, radius, arc) {
    const m = makeSwipeArc(color, radius, arc);
    m.position.set(ch.x, 0.9, ch.z);
    m.rotation.z = -ch.facing + Math.PI / 2;
    this.scene.add(m);
    this.swipes.push({ m, t: 0.22 });
  }

  _glowTexture() {
    if (!this.__glowTex) {
      const S = 64, c = document.createElement("canvas"); c.width = c.height = S;
      const g = c.getContext("2d");
      const grd = g.createRadialGradient(S / 2, S / 2, 2, S / 2, S / 2, S / 2);
      grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.35, "rgba(255,255,255,0.5)"); grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd; g.fillRect(0, 0, S, S);
      this.__glowTex = new THREE.CanvasTexture(c);
    }
    return this.__glowTex;
  }

  /** o: {x,z,y,vx,vz,dmg,range,ownerId,team,tint,arrow,bomb,trailRate} */
  spawnProjectile(o) {
    const wrap = new THREE.Group();
    if (o.arrow) {
      wrap.add(makeArrow(o.tint));
    } else {
      const core = new THREE.Mesh(new THREE.SphereGeometry(o.bomb ? 0.28 : 0.15, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0xffffff }));
      wrap.add(core);
    }
    if (!o.arrow || o.bomb) {
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: this._glowTexture(), color: o.tint, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.setScalar(o.bomb ? 1.6 : 0.9);
      wrap.add(glow);
    }
    wrap.position.set(o.x, o.y, o.z);
    wrap.lookAt(o.x + o.vx, o.y, o.z + o.vz);
    this.scene.add(wrap);
    this.projectiles.push({ team: "mobs", ownerId: -1, ...o, mesh: wrap, traveled: 0 });
  }

  explode(def, x, z, attacker = null) {
    SFX.play("explode");
    if (!attacker || attacker.isLocal) this.addShake(def.shake || 0.4);
    if (def.hitstop && (!attacker || attacker.isLocal)) this.hitstop(def.hitstop);
    const isFrost = def.residual && def.residual.kind === "frost";
    this.decals.spawn(isFrost ? "shock" : "ring", x, z, def.radius, 0.55, { grow: true });
    this.decals.spawn("ring", x, z, def.radius * 0.55, 0.35, { grow: true });
    this.fx.burst(x, 0.8, z, {
      count: 44, color: isFrost ? 0x8ae0ff : 0xffb060, color2: isFrost ? 0xffffff : 0xff4a20,
      speed: 7, up: 3.5, life: 0.6, spread: 2,
    });
    this.after(0.08, () => this.fx.burst(x, 0.5, z, {
      count: 18, color: isFrost ? 0xd8f4ff : 0xff7a2a, speed: 2.5, up: isFrost ? 1 : 2.4, life: 0.9, gravity: isFrost ? 2 : 1, spread: def.radius * 0.5,
    }));
    const targets = attacker && attacker.isChampion
      ? this.hostilesInRadius(attacker, x, z, def.radius)
      : this.champions.filter((c) => !c.dead && dist2(c.x, c.z, x, z) <= (def.radius + PLAYER_R) ** 2);
    for (const t of targets)
      this.applyDamage(t, def.dmg, { heavy: true, fromX: x, fromZ: z, knockback: 3, status: def.status || null }, attacker);
    if (def.residual) {
      const r = def.residual;
      const mult = r.kind === "fire" ? (this.arena.modifiers.fireResidualMult || 1) : (this.arena.modifiers.frostResidualMult || 1);
      const d = this.decals.spawn(r.kind, x, z, r.radius, r.life * mult);
      d.dps = r.dps;
      d.ownerId = attacker ? attacker.id : -1;
      d.team = attacker ? attacker.team : "mobs";
    }
  }

  // ================= UPDATE LOOP =========================================

  update(rawDt) {
    const hudDt = Math.min(rawDt, 0.05);
    if (this.hitstopT > 0) { this.hitstopT -= rawDt; this.timeScale = 0.06; }
    else this.timeScale = 1;
    const dt = hudDt * this.timeScale;

    if (this.board) this.board.update(dt);
    if (this.fx) this.fx.update(dt);
    if (this.decals) this.decals.update(dt);
    if (this.text) {
      const r = this.container.getBoundingClientRect();
      this.text.update(hudDt, r.width, r.height);
    }
    this.hud.update(hudDt);

    if (this.state === "playing" && this.input.pausePressed()) this.setPaused(!this.paused);
    if (this.state === "menu" && this.showcaseActors) {
      for (const a of this.showcaseActors) { a.update(dt); a.updateRelax(dt, a.idleRelax || 0, false); }
    }
    const versus = this.mode && !this.mode.usesWaves;
    // pausing only freezes the sim in campaign; a versus match keeps running
    if (this.state === "playing" && (!this.paused || versus)) this.updatePlaying(dt, hudDt);
    else if (this.state === "gameover" || this.state === "arenaclear") {
      for (const c of this.champions) c.actor && c.actor.update(dt);
      for (const e of this.enemies) e.actor.update(dt);
    }

    this.updateCamera(hudDt);
  }

  updatePlaying(dt, hudDt) {
    // timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }

    // champions
    for (const c of this.champions) c.update(dt);

    // mode logic (respawns / rounds / win checks; waves for campaign below)
    if (this.mode) this.mode.update(dt);

    // waves (campaign only)
    if (this.mode && this.mode.usesWaves) {
      if (this.waveActive) {
        for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
          const s = this.spawnQueue[i];
          s.t -= dt;
          if (s.t <= 0) {
            this.spawnQueue.splice(i, 1);
            const p = this.board.spawnPoint();
            this.decals.spawn("reticle", p.x, p.z, 1.1, SPAWN_TELEGRAPH, { spin: 2.4 });
            this.fx.burst(p.x, 0.15, p.z, { count: 6, color: this.arena.portal, speed: 1, up: 1.2, life: 0.4 });
            this.pendingSpawns.push({ type: s.type, x: p.x, z: p.z, t: SPAWN_TELEGRAPH });
          }
        }
        for (let i = this.pendingSpawns.length - 1; i >= 0; i--) {
          const s = this.pendingSpawns[i];
          s.t -= dt;
          if (s.t <= 0) { this.pendingSpawns.splice(i, 1); this.spawnEnemy(s.type, s.x, s.z); }
        }
        if (this.spawnQueue.length === 0 && this.pendingSpawns.length === 0 && this.enemies.every((e) => e.dead)) this.waveCleared();
      } else {
        this.restT -= dt;
        if (this.restT <= 0 && this.state === "playing") this.startWave();
      }
    }

    // residual patches: mobs + champions
    const fires = this.decals.residuals("fire");
    const frosts = this.decals.residuals("frost");
    for (const c of this.champions) {
      if (c.dead) continue;
      for (const f of fires) {
        if (f.team === c.team) continue;
        if (dist2(c.x, c.z, f.x, f.z) < f.radius * f.radius) { c.statuses.burn = Math.max(c.statuses.burn, 0.5); }
      }
      for (const f of frosts) {
        if (f.team === c.team) continue;
        if (dist2(c.x, c.z, f.x, f.z) < f.radius * f.radius) c.statuses.frost = Math.max(c.statuses.frost, 0.4);
      }
    }

    // mobs
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const A = e.actor;
      if (e.dead) {
        e.deadT += dt;
        A.update(dt);
        A.root.position.y = -Math.max(0, e.deadT - 0.9) * 1.5;
        if (e.deadT > 1.7) { A.dispose(); this.enemies.splice(i, 1); }
        continue;
      }
      e.spawnT -= dt;
      if (e.riseT > 0) {
        e.riseT -= dt;
        const f = Math.max(0, e.riseT / RISE_TIME);
        e.actor.root.position.set(e.x, -e.def.height * f * f, e.z);
        e.actor.update(dt);
        if (Math.random() < dt * 20) this.fx.burst(e.x, 0.2, e.z, { count: 2, color: 0x6a5040, speed: 1.5, up: 2, life: 0.3 });
        continue;
      }
      const st = e.statuses;
      for (const k of ["shock", "burn", "frost"]) if (st[k] > 0) st[k] -= dt;

      for (const f of fires) {
        if (f.team === "mobs") continue;
        if (dist2(e.x, e.z, f.x, f.z) < f.radius * f.radius) {
          st.burn = Math.max(st.burn, 0.5);
          e.hp -= (f.dps ?? 8) * dt * (this.arena.modifiers.fireResidualMult || 1);
          if (e.hp <= 0) { this.killEnemy(e, this.championById(f.ownerId)); }
        }
      }
      for (const f of frosts) {
        if (f.team === "mobs") continue;
        if (dist2(e.x, e.z, f.x, f.z) < f.radius * f.radius) st.frost = Math.max(st.frost, 0.4);
      }
      if (e.dead) continue;

      if (st.burn > 0) {
        e.hp -= 6 * dt;
        e.statusFxT -= dt;
        if (e.statusFxT <= 0) { e.statusFxT = 0.18; this.fx.burst(e.x, e.def.height * 0.6, e.z, { count: 3, color: 0xff7a20, speed: 1, up: 2, life: 0.35 }); }
        if (e.hp <= 0) { this.killEnemy(e); continue; }
      }
      if (st.frost > 0 && Math.random() < dt * 6) this.fx.burst(e.x, e.def.height * 0.4, e.z, { count: 2, color: 0x9ae4ff, speed: 0.8, up: 0.8, life: 0.4 });
      if (st.shock > 0) {
        if (Math.random() < dt * 10) this.fx.burst(e.x, e.def.height * 0.7, e.z, { count: 3, color: 0xc8b8ff, color2: 0xffffff, speed: 2, up: 0.5, life: 0.15 });
        A.update(dt * 0.08);
      } else {
        const tgt = this.mobTarget(e);
        const tx = tgt ? tgt.x : 0, tz = tgt ? tgt.z : 0;
        const slow = st.frost > 0 ? 0.45 : 1;
        const dx = tx - e.x, dz = tz - e.z;
        const d = Math.hypot(dx, dz) || 0.001;
        const speed = e.def.speed * slow;
        let mvx = 0, mvz = 0;

        const bossBusy = e.def.boss && this.updateBossKit(e, dt, d, tgt);
        if (bossBusy) {
          // telegraphing / charging
        } else if (e.def.ranged) {
          const want = e.def.keepDist;
          const dir = d > want + 1 ? 1 : d < want - 1 ? -1 : 0;
          mvx = (dx / d) * speed * dir * 0.8; mvz = (dz / d) * speed * dir * 0.8;
          e.atkT -= dt;
          if (e.atkT <= 0 && d < e.def.atkRange + 1) {
            e.atkT = e.def.atkCd;
            this.spawnProjectile({
              x: e.x, z: e.z, y: e.def.floatH + 0.4,
              vx: dx / d * e.def.ranged.speed, vz: dz / d * e.def.ranged.speed,
              dmg: e.def.dmg, range: 16, team: "mobs", ownerId: -1, tint: this.arena.portal,
            });
            SFX.play("bolt");
          }
        } else {
          if (d > e.def.atkRange * 0.85) { mvx = dx / d * speed; mvz = dz / d * speed; }
          e.atkT -= dt;
          if (e.windup > 0) {
            e.windup -= dt;
            if (e.windup <= 0 && tgt && !tgt.dead) {
              if (Math.hypot(tgt.x - e.x, tgt.z - e.z) < e.def.atkRange + PLAYER_R)
                tgt.takeDamage(e.def.dmg, e.x, e.z, null);
            }
          } else if (e.atkT <= 0 && d < e.def.atkRange) {
            e.windup = e.def.atkWindup;
            e.atkT = e.def.atkCd;
            if (A.actions["C_attack"]) A.playOnce("C_attack", { timeScale: 1.3 });
            this.fx.burst(e.x, e.def.height * 0.8, e.z, { count: 5, color: 0xff3030, speed: 1, up: 1, life: 0.25 });
          }
        }

        for (const o of this.enemies) {
          if (o === e || o.dead) continue;
          const ox = e.x - o.x, oz = e.z - o.z;
          const od = Math.hypot(ox, oz);
          const min = (e.def.height + o.def.height) * 0.22;
          if (od > 0.001 && od < min) { mvx += ox / od * 2.4; mvz += oz / od * 2.4; }
        }
        let hopY = 0, moveMult = 1;
        if (e.def.move === "hop") {
          e.hopT += dt * slow;
          const phase = (e.hopT % 0.62) / 0.62;
          hopY = Math.max(0, Math.sin(phase * Math.PI * 2)) * 0.6;
          moveMult = hopY > 0.06 ? 1.7 : 0.08;
          const squash = hopY < 0.06 ? 0.82 : 1.06;
          A.model.scale.y = A.model.scale.x * squash;
        } else if (e.def.move === "lumber") {
          A.root.rotation.z = Math.sin(e.hopT += dt * 4) * 0.05;
        }
        e.x += (mvx * moveMult + e.knockX) * dt; e.z += (mvz * moveMult + e.knockZ) * dt;
        e.knockX *= Math.exp(-6 * dt); e.knockZ *= Math.exp(-6 * dt);
        const dc = Math.hypot(e.x, e.z);
        if (dc > BOARD_RADIUS) { e.x *= BOARD_RADIUS / dc; e.z *= BOARD_RADIUS / dc; }

        A.update(dt);
        const moving = Math.hypot(mvx, mvz) > 0.4;
        A.play(moving ? "Walk" : "Idle", { timeScale: moving ? 1.1 * slow : 1 });
        A.root.rotation.y = -Math.atan2(dz, dx) + Math.PI / 2;
        e.renderY = hopY;
      }
      const floatY = e.def.floatH ? e.def.floatH + Math.sin(performance.now() / 400 + e.floatPhase) * 0.2 : (e.renderY || 0);
      A.root.position.set(e.x, floatY, e.z);
    }

    // projectiles (owner/team resolution)
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const step = Math.hypot(p.vx, p.vz) * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.z += p.vz * dt;
      p.traveled += step;
      const x = p.mesh.position.x, z = p.mesh.position.z;
      let dead = false;
      const owner = this.championById(p.ownerId);

      // champion-owned projectiles hurt mobs
      if (p.team !== "mobs") {
        for (const e of this.enemies) {
          if (e.dead) continue;
          const rr = 0.5 + e.def.height * 0.22;
          if (dist2(e.x, e.z, x, z) < rr * rr) {
            if (p.bomb) this.explode(p.bomb, x, z, owner);
            else this.hurtEnemy(e, p.dmg, {}, owner);
            dead = true; break;
          }
        }
      }
      // any projectile hurts enemy champions (skip owner + same team)
      if (!dead) {
        for (const c of this.champions) {
          if (c.dead || c.id === p.ownerId || c.team === p.team) continue;
          if (dist2(c.x, c.z, x, z) < (PLAYER_R + 0.35) ** 2) {
            if (p.bomb) this.explode(p.bomb, x, z, owner);
            else this.applyDamage(c, p.dmg, { fromX: x - p.vx, fromZ: z - p.vz }, owner);
            dead = true; break;
          }
        }
      }
      if (!dead && Math.random() < (p.trailRate ?? 0.35))
        this.fx.burst(x, p.mesh.position.y, z, { count: p.bomb ? 2 : 1, color: p.tint, speed: 0.4, up: 0.2, life: p.bomb ? 0.45 : 0.28, gravity: 0.5 });
      if (p.traveled >= p.range || Math.hypot(x, z) > BOARD_RADIUS + 3) {
        if (p.bomb) this.explode(p.bomb, x, z, owner);
        dead = true;
      }
      if (dead) { p.mesh.removeFromParent(); this.projectiles.splice(i, 1); }
    }

    // rain fallers
    for (let i = this.fallers.length - 1; i >= 0; i--) {
      const f = this.fallers[i];
      f.mesh.position.y -= f.vy * dt;
      if (f.mesh.position.y <= 0.15) {
        this.fx.burst(f.mesh.position.x, 0.25, f.mesh.position.z, { count: 4, color: 0xffd080, color2: 0xff8a40, speed: 2, up: 1.6, life: 0.3 });
        f.mesh.removeFromParent(); this.fallers.splice(i, 1);
      }
    }

    // swipe arcs
    for (let i = this.swipes.length - 1; i >= 0; i--) {
      const s = this.swipes[i];
      s.t -= dt;
      s.m.rotation.z -= 9 * dt;
      s.m.material.opacity = Math.max(0, s.t / 0.22) * 0.85;
      const sc = 1 + (1 - s.t / 0.22) * 0.25;
      s.m.scale.set(sc, sc, 1);
      if (s.t <= 0) { s.m.removeFromParent(); s.m.material.dispose(); this.swipes.splice(i, 1); }
    }

    // pickups (any living champion can grab)
    this.updatePickups(dt);

    // boss bar
    if (this.bossRef) this.hud.setBoss(this.bossRef.def.name, Math.max(0, this.bossRef.hp / this.bossRef.maxHp));

    // world HP bars: mobs + non-local champions
    if (this.bars) {
      const r = this.container.getBoundingClientRect();
      const champBars = this.champions.filter((c) => !c.isLocal).map((c) => ({
        x: c.x, z: c.z, hp: c.hp, maxHp: c.maxHp, dead: c.dead,
        def: { height: 1.95 }, __champ: c,
      }));
      this.bars.update([...this.enemies, ...champBars], r.width, r.height);
    }
  }

  _heartTexture() {
    if (!this.__heartTex) {
      const S = 96, c = document.createElement("canvas"); c.width = c.height = S;
      const g = c.getContext("2d");
      g.translate(S / 2, S / 2);
      g.beginPath();
      g.moveTo(0, 30);
      g.bezierCurveTo(-42, -2, -26, -34, 0, -14);
      g.bezierCurveTo(26, -34, 42, -2, 0, 30);
      g.closePath();
      g.fillStyle = "#ff2038";
      g.shadowColor = "rgba(255,40,70,.95)"; g.shadowBlur = 16;
      g.fill();
      g.shadowBlur = 0;
      g.beginPath(); g.ellipse(-11, -14, 7, 5, -0.5, 0, Math.PI * 2);
      g.fillStyle = "rgba(255,255,255,.5)"; g.fill();
      this.__heartTex = new THREE.CanvasTexture(c);
    }
    return this.__heartTex;
  }

  spawnPickup(x, z) {
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: this._heartTexture(), transparent: true, depthWrite: false }));
    spr.scale.setScalar(0.9);
    const dc = Math.hypot(x, z);
    if (dc > BOARD_RADIUS - 1) { x *= (BOARD_RADIUS - 1) / dc; z *= (BOARD_RADIUS - 1) / dc; }
    spr.position.set(x, 1, z);
    this.scene.add(spr);
    this.pickups.push({ mesh: spr, x, z, t: 12, phase: rand(Math.PI * 2) });
  }

  updatePickups(dt) {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.t -= dt;
      p.mesh.position.y = 1 + Math.sin(performance.now() / 300 + p.phase) * 0.18;
      const pulse = 0.85 + Math.sin(performance.now() / 220 + p.phase) * 0.08;
      p.mesh.scale.setScalar(pulse);
      p.mesh.material.opacity = p.t < 3 ? (Math.floor(p.t * 6) % 2 ? 0.25 : 1) : 1;
      for (const c of this.champions) {
        if (c.dead || c.hp >= c.maxHp) continue;
        if (dist2(p.x, p.z, c.x, c.z) < 1.9) {
          c.hp = Math.min(c.maxHp, c.hp + 1);
          if (c.isLocal) this.hud.setHearts(c.hp, c.maxHp);
          this.text.spawn("+❤", c.x, 2.2, c.z, { color: "#ff6a8a", size: 22 });
          this.fx.burst(c.x, 1.4, c.z, { count: 14, color: 0xff5a7a, color2: 0xffc0d0, speed: 2.5, up: 2, life: 0.5 });
          SFX.play("heal");
          p.t = 0;
          break;
        }
      }
      if (p.t <= 0) { p.mesh.removeFromParent(); this.pickups.splice(i, 1); }
    }
  }

  /** boss kit engine — tgt is the boss's current champion target */
  updateBossKit(e, dt, d, tgt) {
    if (!tgt) return false;
    if (!e.kitCds) e.kitCds = e.def.kit.map((k) => k.cd * rand(0.35, 0.7));
    for (let i = 0; i < e.kitCds.length; i++) e.kitCds[i] -= dt;

    if (e.cast) {
      const c = e.cast, k = c.k;
      c.t -= dt;
      if (k.type === "charge" && c.phase === "go") {
        e.x += c.dx * k.speed * dt; e.z += c.dz * k.speed * dt;
        const dc = Math.hypot(e.x, e.z);
        if (dc > BOARD_RADIUS) { e.x *= BOARD_RADIUS / dc; e.z *= BOARD_RADIUS / dc; c.t = 0; }
        if (!c.hit) {
          for (const ch of this.champions) {
            if (ch.dead) continue;
            if (Math.hypot(ch.x - e.x, ch.z - e.z) < 1.7) { c.hit = true; ch.takeDamage(k.dmg, e.x - c.dx, e.z - c.dz, null); break; }
          }
        }
        this.fx.burst(e.x, 0.5, e.z, { count: 2, color: this.arena.accent, speed: 1.5, up: 1, life: 0.3 });
        if (c.t <= 0) e.cast = null;
        return true;
      }
      if (c.t > 0) return true;
      if (k.type === "slam") {
        this.decals.spawn("ring", e.x, e.z, k.radius, 0.55, { grow: true });
        this.fx.burst(e.x, 0.5, e.z, { count: 32, color: this.arena.accent, speed: 6, up: 3.2, life: 0.55, spread: 2 });
        this.addShake(0.7); SFX.play("slam");
        for (const ch of this.champions)
          if (!ch.dead && dist2(ch.x, ch.z, e.x, e.z) <= (k.radius + PLAYER_R) ** 2) ch.takeDamage(k.dmg, e.x, e.z, null);
      } else if (k.type === "volley") {
        const base = Math.atan2(tgt.z - e.z, tgt.x - e.x);
        for (let n = 0; n < k.count; n++) {
          const a = base + (k.count > 1 ? (n / (k.count - 1) - 0.5) * k.spread : 0);
          this.spawnProjectile({ x: e.x, z: e.z, y: 1.4, vx: Math.cos(a) * k.speed, vz: Math.sin(a) * k.speed,
            dmg: k.dmg, range: 30, team: "mobs", ownerId: -1, tint: this.arena.portal, trailRate: 0.5 });
        }
        SFX.play("bolt");
      } else if (k.type === "nova") {
        for (let n = 0; n < k.count; n++) {
          const a = (n / k.count) * Math.PI * 2;
          this.spawnProjectile({ x: e.x, z: e.z, y: 1.2, vx: Math.cos(a) * k.speed, vz: Math.sin(a) * k.speed,
            dmg: k.dmg, range: 30, team: "mobs", ownerId: -1, tint: this.arena.portal, trailRate: 0.5 });
        }
        SFX.play("frost");
      } else if (k.type === "summon") {
        for (let n = 0; n < k.count; n++) {
          const a = rand(Math.PI * 2), r = rand(1.6, 3.2);
          this.spawnEnemy(k.unit, e.x + Math.cos(a) * r, e.z + Math.sin(a) * r);
        }
        SFX.play("ui_big");
      } else if (k.type === "blink") {
        this.fx.burst(e.x, 1.2, e.z, { count: 22, color: this.arena.portal, speed: 3, up: 2, life: 0.45 });
        const a = rand(Math.PI * 2), r = rand(k.range[0], k.range[1]);
        e.x = tgt.x + Math.cos(a) * r; e.z = tgt.z + Math.sin(a) * r;
        const dc = Math.hypot(e.x, e.z);
        if (dc > BOARD_RADIUS - 1) { e.x *= (BOARD_RADIUS - 1) / dc; e.z *= (BOARD_RADIUS - 1) / dc; }
        this.fx.burst(e.x, 1.2, e.z, { count: 22, color: this.arena.portal, speed: 3, up: 2, life: 0.45 });
        SFX.play("ward");
      }
      e.cast = null;
      return false;
    }

    for (let i = 0; i < e.def.kit.length; i++) {
      if (e.kitCds[i] > 0) continue;
      const k = e.def.kit[i];
      if (k.type === "slam" && d > k.radius + 1.6) continue;
      if (k.type === "charge" && d < 4) continue;
      e.kitCds[i] = k.cd;
      if (k.type === "slam") this.decals.spawn("reticle", e.x, e.z, k.radius, k.windup, { spin: 2 });
      else if (k.type === "charge") {
        const a = Math.atan2(tgt.z - e.z, tgt.x - e.x);
        for (let s = 1; s <= 5; s++)
          this.decals.spawn("reticle", e.x + Math.cos(a) * s * 2.4, e.z + Math.sin(a) * s * 2.4, 0.85, k.windup + 0.1);
      } else {
        this.fx.burst(e.x, e.def.height * 0.7, e.z, { count: 14, color: this.arena.portal, speed: 2, up: 1.6, life: Math.max(0.4, k.windup || 0.5) });
      }
      const cast = { k, t: k.windup != null ? k.windup : 0.6, phase: "windup" };
      e.cast = cast;
      if (k.type === "charge") {
        const d2 = Math.max(0.001, Math.hypot(tgt.x - e.x, tgt.z - e.z));
        cast.dx = (tgt.x - e.x) / d2; cast.dz = (tgt.z - e.z) / d2;
        this.after(k.windup, () => {
          if (e.cast === cast && !e.dead) { cast.phase = "go"; cast.t = k.dur; cast.hit = false; SFX.play("swing_big"); }
        });
      }
      return true;
    }
    return false;
  }

  // ================= PORTRAITS / SHOWCASE / CAMERA =======================

  renderPortrait(type) {
    this.__portraits = this.__portraits || {};
    if (this.__portraits[type] !== undefined) return this.__portraits[type];
    const def = ALL_TYPES[type];
    const lib = def && this.enemyLib[def.model];
    if (!lib) { this.__portraits[type] = null; return null; }
    try {
      if (!this.__pScene) {
        this.__pScene = new THREE.Scene();
        this.__pScene.background = new THREE.Color(0x160c20);
        this.__pCam = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
        this.__pScene.add(new THREE.HemisphereLight(0xfff0d8, 0x201828, 1.2));
        const key = new THREE.DirectionalLight(0xffffff, 2.2);
        key.position.set(2, 3, 4);
        this.__pScene.add(key);
      }
      const actor = new Actor(lib, { height: 2 });
      actor.root.rotation.y = Math.PI * 0.18;
      this.__pScene.add(actor.root);
      this.__pCam.position.set(0.55, 1.25, 3.4);
      this.__pCam.lookAt(0, 0.95, 0);
      const R = this.renderer;
      const size = new THREE.Vector2();
      R.getSize(size);
      R.setSize(200, 200, false);
      R.render(this.__pScene, this.__pCam);
      const url = R.domElement.toDataURL("image/png");
      R.setSize(size.x, size.y, false);
      actor.dispose();
      this.__portraits[type] = url;
      return url;
    } catch (e) {
      console.warn("[bestiary] portrait failed:", type, e);
      this.__portraits[type] = null;
      return null;
    }
  }

  buildMenuShowcase() {
    if (this.showcase || !this.heroLib) return;
    const g = new THREE.Group();
    this.scene.fog = new THREE.Fog(0x120a1e, 16, 44);
    const hemi = new THREE.HemisphereLight(0xb59aff, 0x120a1e, 0.95);
    const key = new THREE.DirectionalLight(0xffe0b0, 1.7); key.position.set(4, 8, 6);
    const rim = new THREE.PointLight(0xe8b83a, 24, 32, 1.8); rim.position.set(0, 3.2, -3);
    const sky = new THREE.Mesh(new THREE.SphereGeometry(60, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x0d0716, side: THREE.BackSide, fog: false }));
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(6.6, 6.9, 0.6, 48),
      new THREE.MeshStandardMaterial({ color: 0x241a2e, metalness: 0.6, roughness: 0.5 }));
    plat.position.y = -0.31;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(6.7, 0.09, 8, 60),
      new THREE.MeshStandardMaterial({ color: 0xe8b83a, emissive: 0xe8b83a, emissiveIntensity: 1.8 }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.03;
    g.add(hemi, key, rim, sky, plat, ring);
    this.showcaseActors = [];
    const lineup = [["barbarian", -2.8], ["rogue", 0], ["sorceress", 2.8]];
    for (const pair of lineup) {
      const a = new Actor(this.heroLib[pair[0]], { height: 1.85 });
      // showcase equip mirrors Champion._equip via a throwaway shim
      Champion.prototype._equip.call({ game: this }, a, pair[0]);
      a.root.position.set(pair[1], 0, 0);
      a.play("Idle");
      g.add(a.root);
      this.showcaseActors.push(a);
    }
    this.scene.add(g);
    this.showcase = g;
  }

  disposeShowcase() {
    if (!this.showcase) return;
    for (const a of this.showcaseActors) a.dispose();
    this.scene.remove(this.showcase);
    this.showcase = null; this.showcaseActors = [];
  }

  updateCamera(dt) {
    const zoom = this.input.camZoom, yaw = this.input.camYaw, pitch = this.input.camPitch;
    // default elevation ~43° (was ~53° overhead — owner feedback); pitch 20°-57°
    const horiz = 15 * zoom, up = 14 * zoom * pitch;
    if (this.state === "menu") {
      const aspect = this.camera.aspect || 1.6;
      const back = 7.4 * Math.min(2.3, Math.max(1, 1.5 / Math.max(0.55, aspect)));
      this._v2.set(Math.sin(performance.now() / 7000) * 0.7, 2.35 + (back - 7.4) * 0.18, back);
      this.camera.position.lerp(this._v2, damp(4, dt));
      this.camera.lookAt(0, 1.15, 0);
      return;
    }
    const target = this.cameraTarget && !this.cameraTarget.dead ? this.cameraTarget : this.local;
    const tx = target ? target.x : 0, tz = target ? target.z : 0;
    const off = { x: Math.sin(yaw) * horiz, y: up, z: Math.cos(yaw) * horiz };
    const lx = tx * 0.72;
    const lz = tz * 0.72;
    this._v2.set(lx + off.x, off.y, lz + off.z);
    this.camera.position.lerp(this._v2, damp(5, dt));
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const s = this.shake * this.shake * 0.5;
    this.camera.position.x += rand(-s, s);
    this.camera.position.y += rand(-s, s) * 0.5;
    this.camera.position.z += rand(-s, s);
    this.camera.lookAt(lx, 0.8, lz);
  }
}
