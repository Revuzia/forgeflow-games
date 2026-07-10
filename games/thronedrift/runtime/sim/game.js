// Thronedrift — core simulation: player controller, ability primitives,
// enemy AI, waves, statuses (Shock/Burn/Frost), ground residuals, combo/score,
// camera follow + screen shake + hit-stop, and run flow (wave clear → realm
// clear → crown claimed / game over).

import * as THREE from "three";
import { ARENAS, BOARD_RADIUS, REST_BETWEEN_WAVES } from "../data/arenas.js";
import { ALL_TYPES, waveComp, levelWaves, LEVELS_PER_REALM } from "../data/enemies.js";
import { CLASSES, COMBO_TIERS, COMBO_WINDOW } from "../data/abilities.js";
import { ArenaBoard } from "../view/arena.js";
import { Actor, makeGreatblade, makeSword, makeShield, makeBow, makeStaff, makeArrow, makeSpinTrail, makeSwipeArc, normalizeShaftProp } from "../view/chars.js";
import { Particles, FloatText, Decals, WorldBars } from "../view/fx.js";
import { SFX } from "../core/audio.js";
import { Music } from "../core/music.js";
import { clamp, lerp, rand, randInt, angleLerp, damp, dist2, formatScore, save } from "../core/util.js";

const PLAYER_R = 0.65;         // player collision radius
const IFRAMES = 0.9;
const SPAWN_TELEGRAPH = 0.85;  // ground-warning time before an enemy erupts
const RISE_TIME = 0.45;        // how long an enemy takes to climb out of the ground

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

    hud.cb.onStart = (classId, arenaIdx, levelIdx) => this.startRun(classId, arenaIdx, levelIdx || 0);
    hud.cb.portrait = (type) => this.renderPortrait(type);
    this.camera.position.set(0, 16, 12);
    this.camera.lookAt(0, 0, 0);
  }

  // ================= RUN SETUP ==========================================

  startRun(classId, arenaIdx, levelIdx = 0) {
    this.cleanupRun();
    this.disposeShowcase();
    this.hud.hideMenus();
    this.hud.clearPanel();
    this.classId = classId;
    this.arenaIdx = arenaIdx;
    this.levelIdx = levelIdx;
    this.levelWaveCount = levelWaves(ARENAS[arenaIdx].order, levelIdx);
    this.arena = ARENAS[arenaIdx];
    this.board = new ArenaBoard(this.scene, this.arena);
    this.fx = new Particles(this.scene);
    this.text = new FloatText(this.hud.layerGame, this.camera);
    this.decals = new Decals(this.scene);
    this.bars = new WorldBars(this.hud.layerGame, this.camera);
    this.discovered = new Set(save.get("bestiary", []));

    const cls = CLASSES[classId];
    this.cls = cls;
    this.modeKeys = cls.modes || ["base"];
    this.modeIdx = 0;

    // player state
    this.px = 0; this.pz = 4;
    this.facing = -Math.PI / 2;
    this.hp = cls.hearts; this.maxHp = cls.hearts;
    this.gold = 0; this.score = 0;
    this.iframeT = 0; this.wardHp = 0; this.wardT = 0;
    this.basicT = 0; this.attackAnimT = 0; this.basicAlt = 0;
    this.block = { active: false, raisedAt: 0, holdT: 0 };
    this.spin = null; this.dead = false;
    this.cds = {};       // cooldowns per modeKey → array of remaining seconds
    for (const k of this.modeKeys) this.cds[k] = [0, 0, 0];

    // combo
    this.combo = 0; this.comboT = 0; this.mult = 1;

    // actors — warrior gets one per mode, others one
    this.playerGroup = new THREE.Group();
    this.scene.add(this.playerGroup);
    this.actors = {};
    for (const k of this.modeKeys) {
      const kit = cls.kits[k];
      const actor = new Actor(this.heroLib[kit.model], { height: 1.85 });
      this._equip(actor, kit.model);
      actor.root.visible = false;
      this.playerGroup.add(actor.root);
      this.actors[k] = actor;
    }
    this._applyMode(true);

    // ward bubble
    this.wardMesh = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xb47aff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.wardMesh.visible = false;
    this.playerGroup.add(this.wardMesh);

    // sim collections
    this.enemies = [];
    this.projectiles = [];
    this.fallers = [];           // rain-of-arrows falling shafts
    this.pickups = [];           // heart drops
    this.swipes = [];            // crescent slash FX
    this.spawnQueue = [];        // {type, t} — t until ground telegraph
    this.pendingSpawns = [];     // {type, x, z, t} — telegraph shown, erupting soon
    this.waveIdx = -1; this.waveActive = false; this.restT = 1.4;
    this.paused = false;

    this.hud.setKit(cls, this.kit(), this.modeIdx, this.modeKeys.length);
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.setGold(0); this.hud.setScore(0);
    this.hud.setWave(1, this.levelWaveCount, this.arena.name, "#" + this.arena.accent.toString(16).padStart(6, "0"), this.levelIdx);
    const hintBits = ["<b>WASD</b> move", "<b>J / Click</b> attack", "<b>1 2 3</b> abilities"];
    if (this.modeKeys.length > 1) hintBits.push("<b>TAB</b> weapon mode", "<b>hold 3</b> Block (Sword & Shield)");
    this.hud.hint(hintBits.join(" · "), 7);

    this.state = "playing";
    Music.play(this.levelIdx >= 4 ? "boss" : "level");
    this.input.enabled = true;
    this.input.clearEdges();
    const sub = this.levelIdx >= 4 ? "BOSS LEVEL — " + this.arena.tagline : `Level ${this.levelIdx + 1} of ${LEVELS_PER_REALM}`;
    this.hud.banner(this.arena.name.toUpperCase(), { color: "#" + this.arena.accent.toString(16).padStart(6, "0"), sub, dur: 2.2, size: 46 });
  }

  cleanupRun() {
    if (this.board) { this.board.dispose(); this.board = null; }
    if (this.fx) { this.fx.dispose(this.scene); this.fx = null; }
    if (this.decals) { this.decals.clear(); this.decals = null; }
    if (this.text) { this.text.clear(); this.text = null; }
    if (this.bars) { this.bars.clear(); this.bars = null; }
    if (this.playerGroup) { this.scene.remove(this.playerGroup); this.playerGroup = null; }
    if (this.enemies) for (const e of this.enemies) e.actor.dispose();
    if (this.projectiles) for (const p of this.projectiles) p.mesh.removeFromParent();
    if (this.fallers) for (const f of this.fallers) f.mesh.removeFromParent();
    if (this.pickups) for (const p of this.pickups) p.mesh.removeFromParent();
    if (this.swipes) for (const s of this.swipes) s.m.removeFromParent();
    this.swipes = [];
    this.bossRef = null; if (this.hud.setBoss) this.hud.setBoss(null);
    this.enemies = []; this.projectiles = []; this.fallers = []; this.pickups = []; this.timers = [];
    this.pendingSpawns = []; this.spawnQueue = [];
    this.timeScale = 1; this.shake = 0; this.paused = false;
  }

  kit() { return this.cls.kits[this.modeKeys[this.modeIdx]]; }
  modeKey() { return this.modeKeys[this.modeIdx]; }

  _equip(actor, model) {
    // grip fracs/rest dirs follow DF's WEAPON_CFG conventions (+Y shaft weapons)
    if (model === "barbarian") actor.attachWeapon(makeGreatblade(), "Right", { gripFrac: 0.13, palm: 0.13, rest: [0.10, 0.95, 0.30] });
    else if (model === "knight") {
      actor.attachWeapon(makeSword(), "Right", { gripFrac: 0.14, palm: 0.12, rest: [0.15, 0.62, 0.77] });
      actor.attachShield(makeShield());
    } else if (model === "rogue") {
      // Meshy-generated bow (assets/props/bow.glb) — procedural fallback
      const bow = this.propLib.bow ? normalizeShaftProp(this.propLib.bow, 1.2) : makeBow();
      actor.attachWeapon(bow, "Left", { gripFrac: 0.5, palm: 0.12, roll: 0, rest: [0.05, 0.98, 0.15] });
    }
    // sorceress base.glb has an ornate flame-staff BAKED INTO the model (verified
    // visually) — attaching a procedural one gave her a floating duplicate
  }

  _applyMode(first) {
    for (const k of this.modeKeys) this.actors[k].root.visible = false;
    const actor = this.actors[this.modeKey()];
    actor.root.visible = true;
    this.playerActor = actor;
    actor.play("Idle");
    if (!first) {
      SFX.play("mode");
      this.hud.setKit(this.cls, this.kit(), this.modeIdx, this.modeKeys.length);
      this.hud.callout(this.kit().label.toUpperCase() + "!", this.cls.uiColor);
      this.fx.burst(this.px, 1.2, this.pz, { count: 26, color: 0xffd24a, color2: this.cls.color, speed: 3, up: 2, life: 0.5 });
      this.block.active = false;
      this.attackAnimT = 0.25; // brief equip commitment
    }
  }

  // ================= WAVES ==============================================

  startWave() {
    this.waveIdx++;
    this.waveActive = true;
    const comp = waveComp(this.arena.order, this.levelIdx, this.waveIdx, this.levelWaveCount);
    let delay = 0.5;
    for (const [type, count] of comp)
      for (let n = 0; n < count; n++) {
        this.spawnQueue.push({ type, t: delay });
        delay += rand(0.35, 0.75); // slower trickle than iteration 1 — no instant onslaught
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
      dead: false, deadT: 0,
    };
    if (def.boss && this.levelIdx >= 4) { e.hp = e.maxHp = Math.round(def.hp * 1.25); } // dedicated boss level — a proper battle
    this.enemies.push(e);
    if (def.boss) {
      this.bossRef = e;
      Music.play("boss");
      this.hud.setBoss(def.name, 1);
      this.hud.banner(def.name.toUpperCase(), { color: "#" + this.arena.accent.toString(16).padStart(6, "0"), sub: def.role, dur: 2.6, size: 40 });
      this.addShake(0.6);
    }
    // eruption burst — dirt + realm magic
    this.fx.burst(x, 0.3, z, { count: 22, color: 0x6a5040, color2: this.arena.portal, speed: 3.5, up: 3.2, life: 0.55, spread: 1.5 });
    SFX.play("slam");
    // bestiary discovery
    if (!this.discovered.has(type)) {
      this.discovered.add(type);
      save.set("bestiary", [...this.discovered]);
      this.hud.toast(`NEW FOE — ${def.name.toUpperCase()}`, "#8ae0ff");
    }
    return e;
  }

  waveCleared() {
    this.waveActive = false;
    const bonus = 250 * (this.waveIdx + 1) * this.mult;
    this.score += bonus;
    this.hud.setScore(this.score);
    SFX.play("wave_clear");
    this.hud.banner("WAVE CLEAR", { color: "#ffd24a", sub: `+${formatScore(bonus)} bonus`, dur: 1.8 });
    this.hp = Math.min(this.maxHp, this.hp + 1);
    this.hud.setHearts(this.hp, this.maxHp);
    if (this.waveIdx + 1 >= this.levelWaveCount) { this.levelCleared(); return; }
    this.restT = REST_BETWEEN_WAVES;
  }

  /** a non-boss level was finished (boss level routes to arenaCleared) */
  levelCleared() {
    if (this.levelIdx >= LEVELS_PER_REALM - 1) { this.arenaCleared(); return; }
    this.state = "arenaclear";
    this.input.enabled = false;
    SFX.play("wave_clear");
    // persist per-realm level progress
    const prog = save.get("progress", {});
    const cur = prog[this.arena.order] || 0;
    if (this.levelIdx + 1 > cur) { prog[this.arena.order] = this.levelIdx + 1; save.set("progress", prog); }
    const hi = save.get("hiscore", 0);
    if (this.score > hi) save.set("hiscore", this.score);
    const nextIsBoss = this.levelIdx + 1 === LEVELS_PER_REALM - 1;
    this.hud.panel({
      title: `LEVEL ${this.levelIdx + 1} CLEAR!`,
      titleColor: "#" + this.arena.accent.toString(16).padStart(6, "0"),
      lines: [
        `Score: <b style="color:#ffd24a;font-size:22px">${formatScore(this.score)}</b> · Gold: 🪙 ${this.gold}`,
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
    prog[this.arena.order] = LEVELS_PER_REALM;   // realm fully cleared
    save.set("progress", prog);
    const hi = save.get("hiscore", 0);
    if (this.score > hi) save.set("hiscore", this.score);
    const lines = [
      `Final score: <b style="color:#ffd24a;font-size:24px">${formatScore(this.score)}</b>`,
      `Best: ${formatScore(Math.max(hi, this.score))} · Gold earned: 🪙 ${this.gold}`,
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
    this.dead = true;
    this.input.enabled = false;
    this.playerActor.playOnce("C_death", { timeScale: 1 });
    SFX.play("game_over");
    const hi = save.get("hiscore", 0);
    if (this.score > hi) save.set("hiscore", this.score);
    setTimeout(() => this.hud.panel({
      title: "FALLEN IN THE ARENA",
      titleColor: "#ff5a4a",
      lines: [
        `You fell on level ${this.levelIdx + 1}, wave ${this.waveIdx + 1} of ${this.arena.name}.`,
        `Score: <b style="color:#ffd24a;font-size:22px">${formatScore(this.score)}</b> · Best: ${formatScore(Math.max(hi, this.score))}`,
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
    this.hud.panel({
      title: "PAUSED", titleColor: "#e8b83a",
      lines: [`${this.arena.name} — level ${this.levelIdx + 1}, wave ${Math.max(1, this.waveIdx + 1)}`,
        `<span style="font-size:13px;color:#b89ae0">Scroll = zoom · Right-drag = rotate camera · ESC = resume</span>`],
      buttons: [
        { label: "RESUME", fn: () => this.setPaused(false) },
        { label: "SETTINGS", fn: () => this.hud.settingsPanel(() => this._pauseMenu()) },
        { label: "RESTART", fn: () => this.startRun(this.classId, this.arenaIdx) },
        { label: "QUIT TO MENU", fn: () => this.toMenu() },
      ],
    });
  }

  // ================= COMBAT HELPERS =====================================

  after(t, fn) { this.timers.push({ t, fn }); }

  registerHit() {
    this.combo++;
    this.comboT = COMBO_WINDOW;
    let tier = COMBO_TIERS[0];
    for (const t of COMBO_TIERS) if (this.combo >= t.hits) tier = t;
    if (tier.mult > this.mult) {
      this.mult = tier.mult;
      this.hud.comboPop(this.mult);
      this.hud.callout(`${this.mult}x COMBO!`, "#ffd24a");
      SFX.play("combo");
    }
    this.hud.setCombo(this.mult, this.combo);
  }

  dropCombo() { this.combo = 0; this.mult = 1; this.hud.setCombo(1, 0); }

  /** damage one enemy; source position for knockback dir */
  hurtEnemy(e, dmg, { knockback = 0, fromX = this.px, fromZ = this.pz, status = null, heavy = false, silent = false } = {}) {
    if (e.dead || e.spawnT > 0.1) return;
    e.hp -= dmg;
    this.registerHit();
    this.score += Math.round(dmg * this.mult);
    this.hud.setScore(this.score);
    if (!silent) SFX.play(heavy ? "hit_heavy" : "hit");
    const y = e.def.height * 0.7;
    if (this.settings.dmgNum !== false)
      this.text.spawn(String(Math.round(dmg)), e.x + rand(-0.3, 0.3), y, e.z, { color: heavy ? "#ffcf4a" : "#fff", size: heavy ? 24 : 17 });
    this.fx.burst(e.x, y * 0.7, e.z, { count: heavy ? 16 : 8, color: 0xffe0a0, color2: 0xff5a3a, speed: 3.2, up: 2, life: 0.35 });
    if (knockback) {
      const d = Math.max(0.001, Math.hypot(e.x - fromX, e.z - fromZ));
      const k = knockback * e.def.knockMult;
      e.knockX += (e.x - fromX) / d * k; e.knockZ += (e.z - fromZ) / d * k;
    }
    if (status) this.applyStatus(e, status);
    if (e.hp <= 0) this.killEnemy(e);
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

  killEnemy(e) {
    if (e.dead) return;
    e.dead = true; e.deadT = 0;
    if (e.def.boss) {
      this.bossRef = null;
      Music.play("level");
      this.hud.setBoss(null);
      this.hud.banner(e.def.name.split(",")[0].toUpperCase() + " FALLS!", { color: "#ffd24a", dur: 2.2, size: 44 });
      this.addShake(0.9); this.hitstop(0.1);
    }
    // rare heart drop (bosses always drop two)
    const drops = e.def.boss ? 2 : (Math.random() < 0.08 ? 1 : 0);
    for (let n = 0; n < drops; n++) this.spawnPickup(e.x + rand(-0.8, 0.8), e.z + rand(-0.8, 0.8));
    const pts = e.def.score * this.mult;
    this.score += pts;
    this.hud.setScore(this.score);
    const g = randInt(e.def.gold[0], e.def.gold[1]);
    if (g > 0) { this.gold += g; this.hud.setGold(this.gold); SFX.play("coin"); }
    SFX.play("death");
    this.text.spawn(`+${formatScore(pts)}`, e.x, e.def.height, e.z, { color: "#ffd24a", size: 19, life: 1.1 });
    this.fx.burst(e.x, e.def.height * 0.5, e.z, { count: 26, color: this.arena.accent, color2: 0xffffff, speed: 4, up: 3, life: 0.6 });
    if (e.actor.actions["C_death"] || Object.keys(e.actor.actions).some((n) => /death|die/i.test(n))) {
      const dn = e.actor.actions["C_death"] ? "C_death" : Object.keys(e.actor.actions).find((n) => /death|die/i.test(n));
      e.actor.playOnce(dn, { timeScale: 1.4 });
    }
  }

  /** enemies within melee arc of the player */
  enemiesInArc(arc, range) {
    const out = [];
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.x - this.px, dz = e.z - this.pz;
      const d = Math.hypot(dx, dz);
      if (d > range + e.def.height * 0.28) continue;
      const ang = Math.atan2(dz, dx);
      let diff = Math.abs(ang - this.facing) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff <= arc / 2) out.push(e);
    }
    return out;
  }

  nearestEnemy(maxD = 999) {
    let best = null, bd = maxD * maxD;
    for (const e of this.enemies) {
      if (e.dead) continue;
      const d = dist2(e.x, e.z, this.px, this.pz);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  addShake(m) { if (this.settings.shake === false) return; this.shake = Math.min(1.4, this.shake + m); }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }

  // ================= PLAYER ABILITIES ===================================

  /** crescent slash FX oriented along the current facing */
  spawnSwipe(color, radius, arc) {
    const m = makeSwipeArc(color, radius, arc);
    m.position.set(this.px, 0.9, this.pz);
    m.rotation.z = -this.facing + Math.PI / 2; // ring arc midline onto facing
    this.scene.add(m);
    this.swipes.push({ m, t: 0.22 });
  }

  fireBasic() {
    const b = this.kit().basic;
    this.basicT = b.rate;
    // soft aim assist: face nearest enemy in front-ish range
    const tgt = this.nearestEnemy(b.range ? Math.max(7, b.range) : 8);
    if (tgt) this.facing = Math.atan2(tgt.z - this.pz, tgt.x - this.px);
    const anim = Array.isArray(b.anim) ? b.anim[this.basicAlt++ % b.anim.length] : b.anim;
    // fit the swing clip INSIDE the attack rate — restarting a half-played clip
    // every press is what made spam attacks look broken in iteration 1
    const action = this.playerActor.actions["C_" + anim];
    const clipDur = action ? action.getClip().duration : 0.5;
    const ts = clipDur / Math.max(0.22, b.rate * 0.95);
    const dur = this.playerActor.playOnce("C_" + anim, { timeScale: ts });
    this.attackAnimT = Math.min(dur * 0.7, b.rate * 0.8);
    SFX.play(b.sfx);
    if (b.type === "melee") {
      this.after(dur * 0.35, () => {
        // visible crescent swipe — the swing must READ as a frontal cone
        this.spawnSwipe(b.trail || 0xffd24a, b.range, b.arc);
        const hits = this.enemiesInArc(b.arc, b.range);
        for (const e of hits) this.hurtEnemy(e, b.dmg);
        if (hits.length) this.addShake(0.08);
        this.fx.burst(this.px + Math.cos(this.facing) * 1.6, 1.1, this.pz + Math.sin(this.facing) * 1.6,
          { count: 7, color: b.trail || 0xffffff, speed: 2, up: 1, life: 0.25 });
      });
    } else if (b.type === "shot") {
      this.after(dur * 0.25, () => this.spawnShots(b, false));
    }
  }

  spawnShots(def, isAbility) {
    const count = def.count || 1;
    const spread = def.spread || 0;
    for (let i = 0; i < count; i++) {
      const off = count > 1 ? (i / (count - 1) - 0.5) * spread : 0;
      const a = this.facing + off;
      this.spawnProjectile({
        x: this.px + Math.cos(a) * 0.8, z: this.pz + Math.sin(a) * 0.8, y: 1.2,
        vx: Math.cos(a) * def.speed, vz: Math.sin(a) * def.speed,
        dmg: def.dmg, range: def.range || 16, friendly: true,
        tint: def.tint || 0xffd080, arrow: this.classId === "archer",
        bomb: def.type === "bomb" ? def : null,
        // trail density: heavy magic > bolts > arrows
        trailRate: def.type === "bomb" ? 0.95 : this.classId === "mage" ? 0.6 : 0.22,
      });
    }
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
      // soft additive glow halo sells the "magic missile" read
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
    this.projectiles.push({ ...o, mesh: wrap, traveled: 0 });
  }

  castAbility(slot) {
    const key = this.modeKey();
    const def = this.kit().abilities[slot];
    if (!def || this.cds[key][slot] > 0 || this.attackAnimT > 0.15) return;
    if (def.type === "block") { this.startBlock(def, slot); return; }
    this.cds[key][slot] = def.cd;
    const tgt = this.nearestEnemy(12);
    if (tgt && def.type !== "spin" && def.type !== "ward") this.facing = Math.atan2(tgt.z - this.pz, tgt.x - this.px);
    // fit the clip into a ~0.9s ability window (some Meshy clips run 2-8s raw)
    const abAction = this.playerActor.actions["C_" + def.anim];
    const abClipDur = abAction ? abAction.getClip().duration : 0.6;
    const abTs = Math.max(def.animScale || 1, abClipDur / 0.9);
    const dur = this.playerActor.playOnce("C_" + def.anim, { timeScale: abTs });
    this.attackAnimT = Math.min(dur * 0.85, 1.0);
    if (def.callout) this.hud.callout(def.callout, this.cls.uiColor);
    SFX.play(def.sfx);
    if (def.shake) this.addShake(def.shake);

    switch (def.type) {
      case "melee": {
        this.after(dur * 0.35, () => {
          this.spawnSwipe(0xffd24a, def.range, def.arc);
          for (const e of this.enemiesInArc(def.arc, def.range))
            this.hurtEnemy(e, def.dmg, { heavy: true, knockback: def.knockback || 0, status: def.stagger ? { stagger: def.stagger } : null });
        });
        break;
      }
      case "bash": {
        this.after(dur * 0.3, () => {
          const hits = this.enemiesInArc(def.arc, def.range);
          for (const e of hits)
            this.hurtEnemy(e, def.dmg, { heavy: true, knockback: def.knockback, status: { shock: def.shock } });
          if (hits.length && def.hitstop) this.hitstop(def.hitstop);
        });
        break;
      }
      case "spin": {
        this.spin = { def, t: def.duration, tickT: 0, interval: def.duration / def.ticks };
        // spinning blade-trail ring — Whirlwind finally LOOKS like a whirlwind
        this.spinTrail = makeSpinTrail(this.cls.color);
        this.playerGroup.add(this.spinTrail);
        this.decals.spawn("ring", this.px, this.pz, def.radius, def.duration, { grow: true, spin: 3 });
        break;
      }
      case "slam": {
        this.after(dur * 0.42, () => {
          this.decals.spawn("ring", this.px, this.pz, def.radius, 0.55, { grow: true });
          this.fx.burst(this.px, 0.4, this.pz, { count: 34, color: 0xffb060, color2: 0xff5a2a, speed: 6, up: 3.5, life: 0.5, spread: 3 });
          for (const e of this.enemies) {
            if (e.dead) continue;
            if (dist2(e.x, e.z, this.px, this.pz) <= def.radius * def.radius)
              this.hurtEnemy(e, def.dmg, { heavy: true, knockback: def.knockback, status: { stagger: def.stagger } });
          }
          this.addShake(def.shake); this.hitstop(def.hitstop || 0);
          SFX.play("slam");
        });
        break;
      }
      case "rupture": {
        const a = this.facing;
        this.after(dur * 0.35, () => {
          const steps = 6;
          for (let s = 1; s <= steps; s++) {
            const t = (s / steps);
            this.after(s * 0.045, () => {
              const x = this.px + Math.cos(a) * def.length * t;
              const z = this.pz + Math.sin(a) * def.length * t;
              this.decals.spawn("ring", x, z, def.width * 0.8, 0.5, { grow: true });
              this.fx.burst(x, 0.3, z, { count: 10, color: 0xffa040, color2: 0x8a5030, speed: 3, up: 4, life: 0.45 });
            });
          }
          // line-segment damage test
          for (const e of this.enemies) {
            if (e.dead) continue;
            const relX = e.x - this.px, relZ = e.z - this.pz;
            const along = relX * Math.cos(a) + relZ * Math.sin(a);
            const across = Math.abs(-relX * Math.sin(a) + relZ * Math.cos(a));
            if (along > 0 && along < def.length && across < def.width / 2 + e.def.height * 0.2)
              this.hurtEnemy(e, def.dmg, { heavy: true, status: { stagger: def.stagger } });
          }
          this.hitstop(def.hitstop || 0);
        });
        break;
      }
      case "shot": {   // Fan Shot — volley of real projectiles in a visible cone
        this.after(dur * 0.25, () => this.spawnShots(def, true));
        break;
      }
      case "bomb": {
        this.after(dur * 0.3, () => this.spawnShots(def, true));
        break;
      }
      case "rain": {
        // target the densest cluster of enemies in range (mobile-friendly auto aim)
        let tx = this.px + Math.cos(this.facing) * def.range * 0.55;
        let tz = this.pz + Math.sin(this.facing) * def.range * 0.55;
        let bestScore = 0;
        for (const c of this.enemies) {
          if (c.dead) continue;
          if (dist2(c.x, c.z, this.px, this.pz) > def.range * def.range) continue;
          let s = 0;
          for (const e of this.enemies) if (!e.dead && dist2(e.x, e.z, c.x, c.z) < def.radius * def.radius) s++;
          if (s > bestScore) { bestScore = s; tx = c.x; tz = c.z; }
        }
        this.decals.spawn("reticle", tx, tz, def.radius, def.delay + def.volleys * def.volleyGap, { spin: 1.2 });
        // visible arrow shafts falling into the circle, timed to land on each volley
        for (let v = 0; v < def.volleys; v++) {
          this.after(Math.max(0.05, def.delay + v * def.volleyGap - 0.32), () => {
            for (let n = 0; n < 8; n++) {
              const a2 = rand(Math.PI * 2), r2 = Math.sqrt(Math.random()) * def.radius;
              const ax = tx + Math.cos(a2) * r2, az = tz + Math.sin(a2) * r2;
              const m = makeArrow(0xffc060);
              m.position.set(ax, 9 + rand(0, 2), az);
              m.lookAt(ax, -10, az);   // nose-down
              this.scene.add(m);
              this.fallers.push({ mesh: m, vy: 30 });
            }
          });
        }
        for (let v = 0; v < def.volleys; v++) {
          this.after(def.delay + v * def.volleyGap, () => {
            SFX.play("rain");
            this.addShake(0.2);
            for (let n = 0; n < 6; n++) {
              const a2 = rand(Math.PI * 2), r2 = Math.sqrt(Math.random()) * def.radius;
              const ix = tx + Math.cos(a2) * r2, iz = tz + Math.sin(a2) * r2;
              this.fx.burst(ix, 0.3, iz, { count: 6, color: 0xffd080, color2: 0xff8a40, speed: 2.5, up: 3, life: 0.35 });
            }
            let n0 = 0;
            for (const e of this.enemies) {
              if (e.dead) continue;
              if (dist2(e.x, e.z, tx, tz) <= def.radius * def.radius) this.hurtEnemy(e, def.dmg, { silent: n0++ > 0 });
            }
          });
        }
        break;
      }
      case "ward": {
        this.wardHp = def.absorb; this.wardT = def.duration;
        this.wardMesh.visible = true;
        break;
      }
    }
  }

  startBlock(def, slot) {
    const key = this.modeKey();
    if (this.cds[key][slot] > 0 || this.block.active) return;
    this.block.active = true;
    this.block.raisedAt = performance.now() / 1000;
    this.block.holdT = 0;
    this.block.def = def; this.block.slot = slot;
    this.playerActor.playOnce("C_parry", { timeScale: def.animScale });
    this.hud.callout(def.callout, this.cls.uiColor);
    SFX.play("block");
  }

  endBlock() {
    if (!this.block.active) return;
    const key = this.modeKey();
    this.cds[key][this.block.slot] = this.block.def.cd;
    this.block.active = false;
  }

  /** player takes damage (returns true if it connected) */
  hurtPlayer(dmg, fromX, fromZ) {
    if (this.iframeT > 0 || this.dead || this.state !== "playing") return false;
    // ward absorbs first
    if (this.wardHp > 0) {
      this.wardHp -= dmg;
      this.fx.burst(this.px, 1.3, this.pz, { count: 14, color: 0xb47aff, speed: 3, up: 1.5, life: 0.35 });
      SFX.play("block");
      if (this.wardHp <= 0) { this.wardMesh.visible = false; this.wardT = 0; }
      return false;
    }
    // block: strong vs frontal hits while active (Sword & Shield only)
    if (this.block.active && fromX !== undefined) {
      const toEnemy = Math.atan2(fromZ - this.pz, fromX - this.px);
      let diff = Math.abs(toEnemy - this.facing) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < Math.PI * 0.6) {
        const now = performance.now() / 1000;
        const perfect = now - this.block.raisedAt <= this.block.def.perfectWindow;
        this.fx.burst(this.px + Math.cos(this.facing) * 0.8, 1.2, this.pz + Math.sin(this.facing) * 0.8,
          { count: perfect ? 22 : 10, color: 0xffd24a, color2: 0xffffff, speed: 3, up: 1.5, life: 0.3 });
        if (perfect) {
          SFX.play("block_perfect");
          this.text.spawn("PERFECT BLOCK", this.px, 2.4, this.pz, { color: "#ffd24a", size: 20 });
          const p = this.block.def.perfectPulse;
          for (const e of this.enemiesInArc(p.arc, p.range)) this.hurtEnemy(e, p.dmg, { status: { shock: p.shock } });
          return false;
        }
        SFX.play("block");
        dmg *= (1 - this.block.def.dr);   // chip damage drains the smooth hearts — block reduces, never fully immunizes
      }
    }
    this.hp -= dmg;
    this.iframeT = IFRAMES;
    this.dropCombo();
    this.hud.setHearts(this.hp, this.maxHp);
    this.addShake(0.5);
    SFX.play("hurt");
    this.fx.burst(this.px, 1.2, this.pz, { count: 16, color: 0xff4040, speed: 3.5, up: 2, life: 0.4 });
    this.playerActor.playOnce("C_hit", { timeScale: 1.4 });
    this.attackAnimT = Math.max(this.attackAnimT, 0.2);
    if (this.hp <= 0) this.gameOver();
    return true;
  }

  // ================= UPDATE LOOP ========================================

  update(rawDt) {
    const hudDt = Math.min(rawDt, 0.05);
    // hit-stop eats real time
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
      for (const a of this.showcaseActors) { a.update(dt); a.updateRelax(dt, 0, false); }
    }
    if (this.state === "playing" && !this.paused) this.updatePlaying(dt, hudDt);
    else if (this.state === "gameover" || this.state === "arenaclear") {
      // let corpses/FX settle behind the panel
      if (this.playerActor) this.playerActor.update(dt);
      for (const e of this.enemies) e.actor.update(dt);
    }

    this.updateCamera(hudDt);
  }

  updatePlaying(dt, hudDt) {
    // ---- timers
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const t = this.timers[i];
      t.t -= dt;
      if (t.t <= 0) { this.timers.splice(i, 1); t.fn(); }
    }

    // ---- input: mode toggle (consumes the edge FIRST — never silently eat a
    // press; swap cancels the current attack so it always feels instant)
    if (this.input.togglePressed()) {
      if (this.modeKeys.length > 1 && !this.spin) {
        this.endBlock();
        this.modeIdx = (this.modeIdx + 1) % this.modeKeys.length;
        this._applyMode(false);
      }
    }

    // ---- abilities
    for (let i = 0; i < 3; i++) {
      const def = this.kit().abilities[i];
      if (!def) continue;
      if (def.hold) {
        if (this.input.abilityPressed(i)) this.castAbility(i);
        if (this.block.active) {
          this.block.holdT += dt;
          if (!this.input.abilityHeld[i] || this.block.holdT >= def.maxHold) this.endBlock();
        }
      } else if (this.input.abilityPressed(i)) this.castAbility(i);
    }

    // ---- basic attack
    this.basicT -= dt;
    if (this.input.basicHeld && this.basicT <= 0 && !this.spin && !this.block.active) this.fireBasic();

    // ---- movement
    const mv = this.input.moveVec();
    const spd = this.cls.speed * (this.block.active ? 0.45 : 1) * (this.attackAnimT > 0 && this.classId !== "archer" ? 0.55 : 1);
    this.px += mv.x * spd * dt;
    this.pz += mv.z * spd * dt;
    const dCenter = Math.hypot(this.px, this.pz);
    if (dCenter > BOARD_RADIUS) { this.px *= BOARD_RADIUS / dCenter; this.pz *= BOARD_RADIUS / dCenter; }

    // mouse aim (desktop): face pointer while attacking
    if (this.input.pointer.down && !("ontouchstart" in window)) {
      this.raycaster.setFromCamera(this.input.pointer, this.camera);
      if (this.raycaster.ray.intersectPlane(this.groundPlane, this._v))
        this.facing = Math.atan2(this._v.z - this.pz, this._v.x - this.px);
    } else if (mv.mag > 0.1 && this.attackAnimT <= 0) {
      this.facing = angleLerp(this.facing, Math.atan2(mv.z, mv.x), damp(14, dt));
    }

    // ---- locomotion anim
    const actor = this.playerActor;
    this.attackAnimT -= dt;
    if (this.spin) {
      this.spin.t -= dt;
      this.spin.tickT -= dt;
      this.playerGroup.rotation.y -= 13 * dt; // visual whirl
      if (this.spinTrail) {
        this.spinTrail.rotation.y += 22 * dt;  // trail spins faster than the body
        const pulse = 1 + Math.sin(this.spin.t * 30) * 0.08;
        this.spinTrail.scale.set(pulse, 1, pulse);
      }
      if (this.spin.tickT <= 0) {
        this.spin.tickT = this.spin.interval;
        const d = this.spin.def;
        this.fx.burst(this.px, 0.9, this.pz, { count: 18, color: 0xff5a3a, color2: 0xffd24a, speed: 6, up: 1.4, life: 0.4, spread: 3 });
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (dist2(e.x, e.z, this.px, this.pz) <= d.radius * d.radius)
            this.hurtEnemy(e, d.dmg, { knockback: 1.5 });
        }
        SFX.play("swing_big");
      }
      if (this.spin.t <= 0) {
        this.spin = null; this.playerGroup.rotation.y = 0;
        if (this.spinTrail) { this.spinTrail.removeFromParent(); this.spinTrail = null; }
      }
    } else if (this.attackAnimT <= 0 && !this.dead) {
      if (mv.mag > 0.55) actor.play("Run", { timeScale: 1.2 });
      else if (mv.mag > 0.05) actor.play("Walk", { timeScale: 1.1 });
      else if (!this.block.active) actor.play("Idle");
    }
    actor.update(dt);
    // relax ONLY during locomotion — Meshy walk/run clips fling the arms out,
    // but the authored idle already stands naturally (forcing relax at rest
    // made everyone a mannequin and inverted elbows — owner feedback)
    const moving = mv.mag > 0.05;
    const relaxTarget = (this.attackAnimT > 0 || this.spin || this.dead || this.block.active || !moving) ? 0 : 1;
    actor.updateRelax(dt, relaxTarget, moving, mv.mag > 0.55);

    // place player
    this.playerGroup.position.set(this.px, 0, this.pz);
    if (!this.spin) this.playerGroup.rotation.y = -this.facing + Math.PI / 2;

    // ---- iframes flash
    this.iframeT -= dt;
    actor.model.visible = !(this.iframeT > 0 && Math.floor(this.iframeT * 14) % 2 === 0);

    // ---- ward
    if (this.wardT > 0) {
      this.wardT -= dt;
      this.wardMesh.position.y = 1.1;
      this.wardMesh.material.opacity = 0.16 + Math.sin(performance.now() / 130) * 0.06;
      if (this.wardT <= 0) { this.wardHp = 0; this.wardMesh.visible = false; }
    }

    // ---- combo window
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.dropCombo();
    }

    // ---- cooldown HUD
    const key = this.modeKey();
    const cds = this.cds[key];
    const defs = this.kit().abilities;
    for (let i = 0; i < 3; i++) if (cds[i] > 0) cds[i] -= dt;
    this.hud.setCooldowns(defs.map((d, i) => ({ frac: d ? clamp(cds[i] / d.cd, 0, 1) : 0, secs: Math.max(0, cds[i]) })));

    // ---- spawn queue / wave state (ground eruption: telegraph decal → rise)
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

    // ---- residual patches affect enemies
    const fires = this.decals.residuals("fire");
    const frosts = this.decals.residuals("frost");

    // ---- enemies
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const A = e.actor;
      if (e.dead) {
        e.deadT += dt;
        A.update(dt);
        A.root.position.y = -Math.max(0, e.deadT - 0.9) * 1.5; // sink after death anim
        if (e.deadT > 1.7) { A.dispose(); this.enemies.splice(i, 1); }
        continue;
      }
      e.spawnT -= dt;
      // climbing out of the ground — no AI, no damage-dealing yet
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

      // residual queries
      for (const f of fires) if (dist2(e.x, e.z, f.x, f.z) < f.radius * f.radius) { st.burn = Math.max(st.burn, 0.5); e.hp -= (f.dps ?? 8) * dt * (this.arena.modifiers.fireResidualMult || 1); if (e.hp <= 0) { this.killEnemy(e); } }
      for (const f of frosts) if (dist2(e.x, e.z, f.x, f.z) < f.radius * f.radius) st.frost = Math.max(st.frost, 0.4);
      if (e.dead) continue;

      // burn DoT
      if (st.burn > 0) {
        e.hp -= 6 * dt;
        e.statusFxT -= dt;
        if (e.statusFxT <= 0) { e.statusFxT = 0.18; this.fx.burst(e.x, e.def.height * 0.6, e.z, { count: 3, color: 0xff7a20, speed: 1, up: 2, life: 0.35 }); }
        if (e.hp <= 0) { this.killEnemy(e); continue; }
      }
      if (st.frost > 0 && Math.random() < dt * 6) this.fx.burst(e.x, e.def.height * 0.4, e.z, { count: 2, color: 0x9ae4ff, speed: 0.8, up: 0.8, life: 0.4 });
      if (st.shock > 0) {
        if (Math.random() < dt * 10) this.fx.burst(e.x, e.def.height * 0.7, e.z, { count: 3, color: 0xc8b8ff, color2: 0xffffff, speed: 2, up: 0.5, life: 0.15 });
        A.update(dt * 0.08); // frozen mid-pose
      } else {
        const slow = st.frost > 0 ? 0.45 : 1;
        const dx = this.px - e.x, dz = this.pz - e.z;
        const d = Math.hypot(dx, dz) || 0.001;
        const speed = e.def.speed * slow;
        let mvx = 0, mvz = 0;

        const bossBusy = e.def.boss && this.updateBossKit(e, dt, d);
        if (bossBusy) {
          // winding up / charging — telegraphs are on the floor, movement is scripted
        } else if (e.def.ranged) {
          // wisps hover at keepDist and lob bolts
          const want = e.def.keepDist;
          const dir = d > want + 1 ? 1 : d < want - 1 ? -1 : 0;
          mvx = (dx / d) * speed * dir * 0.8; mvz = (dz / d) * speed * dir * 0.8;
          e.atkT -= dt;
          if (e.atkT <= 0 && d < e.def.atkRange + 1) {
            e.atkT = e.def.atkCd;
            this.spawnProjectile({
              x: e.x, z: e.z, y: e.def.floatH + 0.4,
              vx: dx / d * e.def.ranged.speed, vz: dz / d * e.def.ranged.speed,
              dmg: e.def.dmg, range: 16, friendly: false, tint: this.arena.portal,
            });
            SFX.play("bolt");
          }
        } else {
          if (d > e.def.atkRange * 0.85) { mvx = dx / d * speed; mvz = dz / d * speed; }
          // attack cycle with windup telegraph
          e.atkT -= dt;
          if (e.windup > 0) {
            e.windup -= dt;
            if (e.windup <= 0) {
              if (Math.hypot(this.px - e.x, this.pz - e.z) < e.def.atkRange + PLAYER_R)
                this.hurtPlayer(e.def.dmg, e.x, e.z);
            }
          } else if (e.atkT <= 0 && d < e.def.atkRange) {
            e.windup = e.def.atkWindup;
            e.atkT = e.def.atkCd;
            if (A.actions["C_attack"]) A.playOnce("C_attack", { timeScale: 1.3 });
            // telegraph flash
            this.fx.burst(e.x, e.def.height * 0.8, e.z, { count: 5, color: 0xff3030, speed: 1, up: 1, life: 0.25 });
          }
        }

        // cheap separation
        for (const o of this.enemies) {
          if (o === e || o.dead) continue;
          const ox = e.x - o.x, oz = e.z - o.z;
          const od = Math.hypot(ox, oz);
          const min = (e.def.height + o.def.height) * 0.22;
          if (od > 0.001 && od < min) { mvx += ox / od * 2.4; mvz += oz / od * 2.4; }
        }
        // movement personality: slimes bounce (move mid-hop), brutes lumber
        let hopY = 0, moveMult = 1;
        if (e.def.move === "hop") {
          e.hopT += dt * slow;
          const phase = (e.hopT % 0.62) / 0.62;
          hopY = Math.max(0, Math.sin(phase * Math.PI * 2)) * 0.6;
          moveMult = hopY > 0.06 ? 1.7 : 0.08;           // airborne = surge, grounded = squat
          const squash = hopY < 0.06 ? 0.82 : 1.06;
          A.model.scale.y = A.model.scale.x * squash;    // squash & stretch
        } else if (e.def.move === "lumber") {
          A.root.rotation.z = Math.sin(e.hopT += dt * 4) * 0.05;
        }
        // knockback decay
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

    // ---- projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      const step = Math.hypot(p.vx, p.vz) * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.z += p.vz * dt;
      p.traveled += step;
      const x = p.mesh.position.x, z = p.mesh.position.z;
      let dead = false;

      if (p.friendly) {
        for (const e of this.enemies) {
          if (e.dead) continue;
          const rr = 0.5 + e.def.height * 0.22;
          if (dist2(e.x, e.z, x, z) < rr * rr) {
            if (p.bomb) this.explode(p.bomb, x, z);
            else this.hurtEnemy(e, p.dmg);
            dead = true; break;
          }
        }
        if (!dead && Math.random() < (p.trailRate ?? 0.35))
          this.fx.burst(x, p.mesh.position.y, z, { count: p.bomb ? 2 : 1, color: p.tint, speed: 0.4, up: 0.2, life: p.bomb ? 0.45 : 0.28, gravity: 0.5 });
      } else {
        if (dist2(this.px, this.pz, x, z) < (PLAYER_R + 0.35) ** 2) {
          this.hurtPlayer(p.dmg, x - p.vx, z - p.vz);
          dead = true;
        }
      }
      if (p.traveled >= p.range || Math.hypot(x, z) > BOARD_RADIUS + 3) {
        if (p.bomb) this.explode(p.bomb, x, z);
        dead = true;
      }
      if (dead) { p.mesh.removeFromParent(); this.projectiles.splice(i, 1); }
    }

    // ---- rain-of-arrows fallers
    for (let i = this.fallers.length - 1; i >= 0; i--) {
      const f = this.fallers[i];
      f.mesh.position.y -= f.vy * dt;
      if (f.mesh.position.y <= 0.15) {
        this.fx.burst(f.mesh.position.x, 0.25, f.mesh.position.z, { count: 4, color: 0xffd080, color2: 0xff8a40, speed: 2, up: 1.6, life: 0.3 });
        f.mesh.removeFromParent(); this.fallers.splice(i, 1);
      }
    }

    // ---- swipe arcs sweep + fade
    for (let i = this.swipes.length - 1; i >= 0; i--) {
      const s = this.swipes[i];
      s.t -= dt;
      s.m.rotation.z -= 9 * dt;
      s.m.material.opacity = Math.max(0, s.t / 0.22) * 0.85;
      const sc = 1 + (1 - s.t / 0.22) * 0.25;
      s.m.scale.set(sc, sc, 1);
      if (s.t <= 0) { s.m.removeFromParent(); s.m.material.dispose(); this.swipes.splice(i, 1); }
    }

    // ---- heart pickups
    this.updatePickups(dt);

    // ---- boss health bar
    if (this.bossRef) this.hud.setBoss(this.bossRef.def.name, Math.max(0, this.bossRef.hp / this.bossRef.maxHp));

    // ---- enemy health bars
    if (this.bars) {
      const r = this.container.getBoundingClientRect();
      this.bars.update(this.enemies, r.width, r.height);
    }
  }

  _heartTexture() {
    if (!this.__heartTex) {
      // vector heart — emoji glyphs render purple/monochrome on some systems
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
      p.mesh.scale.setScalar(pulse);                  // upright, gentle pulse — no spin
      p.mesh.material.opacity = p.t < 3 ? (Math.floor(p.t * 6) % 2 ? 0.25 : 1) : 1; // blink before despawn
      if (dist2(p.x, p.z, this.px, this.pz) < 1.9) {
        this.hp = Math.min(this.maxHp, this.hp + 1);
        this.hud.setHearts(this.hp, this.maxHp);
        this.text.spawn("+❤", this.px, 2.2, this.pz, { color: "#ff6a8a", size: 22 });
        this.fx.burst(this.px, 1.4, this.pz, { count: 14, color: 0xff5a7a, color2: 0xffc0d0, speed: 2.5, up: 2, life: 0.5 });
        SFX.play("heal");
        p.t = 0;
      }
      if (p.t <= 0) { p.mesh.removeFromParent(); this.pickups.splice(i, 1); }
    }
  }

  explode(def, x, z) {
    SFX.play("explode");
    this.addShake(def.shake || 0.4);
    if (def.hitstop) this.hitstop(def.hitstop);
    const isFrost = def.residual && def.residual.kind === "frost";
    this.decals.spawn(isFrost ? "shock" : "ring", x, z, def.radius, 0.55, { grow: true });
    this.decals.spawn("ring", x, z, def.radius * 0.55, 0.35, { grow: true });
    this.fx.burst(x, 0.8, z, {
      count: 44, color: isFrost ? 0x8ae0ff : 0xffb060, color2: isFrost ? 0xffffff : 0xff4a20,
      speed: 7, up: 3.5, life: 0.6, spread: 2,
    });
    // secondary slow-motes wave (embers linger / ice crystals drift)
    this.after(0.08, () => this.fx.burst(x, 0.5, z, {
      count: 18, color: isFrost ? 0xd8f4ff : 0xff7a2a, speed: 2.5, up: isFrost ? 1 : 2.4, life: 0.9, gravity: isFrost ? 2 : 1, spread: def.radius * 0.5,
    }));
    for (const e of this.enemies) {
      if (e.dead) continue;
      if (dist2(e.x, e.z, x, z) <= (def.radius + e.def.height * 0.2) ** 2)
        this.hurtEnemy(e, def.dmg, { heavy: true, fromX: x, fromZ: z, knockback: 3, status: def.status || null });
    }
    if (def.residual) {
      const r = def.residual;
      const mult = r.kind === "fire" ? (this.arena.modifiers.fireResidualMult || 1) : (this.arena.modifiers.frostResidualMult || 1);
      const d = this.decals.spawn(r.kind, x, z, r.radius, r.life * mult);
      d.dps = r.dps;
    }
  }

  /**
   * Boss ability engine: each realm boss cycles a small class-flavored kit
   * (slam / charge / volley / nova / summon / blink). Every projectile flies
   * STRAIGHT - bosses telegraph, the player dodges. Returns true while the
   * boss is winding up or charging (normal chase/attack suspended).
   */
  updateBossKit(e, dt, d) {
    if (!e.kitCds) e.kitCds = e.def.kit.map((k) => k.cd * rand(0.35, 0.7));
    for (let i = 0; i < e.kitCds.length; i++) e.kitCds[i] -= dt;

    if (e.cast) {
      const c = e.cast, k = c.k;
      c.t -= dt;
      if (k.type === "charge" && c.phase === "go") {
        e.x += c.dx * k.speed * dt; e.z += c.dz * k.speed * dt;
        const dc = Math.hypot(e.x, e.z);
        if (dc > BOARD_RADIUS) { e.x *= BOARD_RADIUS / dc; e.z *= BOARD_RADIUS / dc; c.t = 0; }
        if (!c.hit && Math.hypot(this.px - e.x, this.pz - e.z) < 1.7) {
          c.hit = true;
          this.hurtPlayer(k.dmg, e.x - c.dx, e.z - c.dz);
        }
        this.fx.burst(e.x, 0.5, e.z, { count: 2, color: this.arena.accent, speed: 1.5, up: 1, life: 0.3 });
        if (c.t <= 0) e.cast = null;
        return true;
      }
      if (c.t > 0) return true; // telegraph still showing
      // windup complete - fire
      if (k.type === "slam") {
        this.decals.spawn("ring", e.x, e.z, k.radius, 0.55, { grow: true });
        this.fx.burst(e.x, 0.5, e.z, { count: 32, color: this.arena.accent, speed: 6, up: 3.2, life: 0.55, spread: 2 });
        this.addShake(0.7); SFX.play("slam");
        if (dist2(this.px, this.pz, e.x, e.z) <= (k.radius + PLAYER_R) ** 2) this.hurtPlayer(k.dmg, e.x, e.z);
      } else if (k.type === "volley") {
        const base = Math.atan2(this.pz - e.z, this.px - e.x);
        for (let n = 0; n < k.count; n++) {
          const a = base + (k.count > 1 ? (n / (k.count - 1) - 0.5) * k.spread : 0);
          this.spawnProjectile({ x: e.x, z: e.z, y: 1.4, vx: Math.cos(a) * k.speed, vz: Math.sin(a) * k.speed,
            dmg: k.dmg, range: 30, friendly: false, tint: this.arena.portal, trailRate: 0.5 });
        }
        SFX.play("bolt");
      } else if (k.type === "nova") {
        for (let n = 0; n < k.count; n++) {
          const a = (n / k.count) * Math.PI * 2;
          this.spawnProjectile({ x: e.x, z: e.z, y: 1.2, vx: Math.cos(a) * k.speed, vz: Math.sin(a) * k.speed,
            dmg: k.dmg, range: 30, friendly: false, tint: this.arena.portal, trailRate: 0.5 });
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
        e.x = this.px + Math.cos(a) * r; e.z = this.pz + Math.sin(a) * r;
        const dc = Math.hypot(e.x, e.z);
        if (dc > BOARD_RADIUS - 1) { e.x *= (BOARD_RADIUS - 1) / dc; e.z *= (BOARD_RADIUS - 1) / dc; }
        this.fx.burst(e.x, 1.2, e.z, { count: 22, color: this.arena.portal, speed: 3, up: 2, life: 0.45 });
        SFX.play("ward");
      }
      e.cast = null;
      return false;
    }

    // pick a ready ability
    for (let i = 0; i < e.def.kit.length; i++) {
      if (e.kitCds[i] > 0) continue;
      const k = e.def.kit[i];
      if (k.type === "slam" && d > k.radius + 1.6) continue;
      if (k.type === "charge" && d < 4) continue;
      e.kitCds[i] = k.cd;
      if (k.type === "slam") this.decals.spawn("reticle", e.x, e.z, k.radius, k.windup, { spin: 2 });
      else if (k.type === "charge") {
        const a = Math.atan2(this.pz - e.z, this.px - e.x);
        for (let s = 1; s <= 5; s++)
          this.decals.spawn("reticle", e.x + Math.cos(a) * s * 2.4, e.z + Math.sin(a) * s * 2.4, 0.85, k.windup + 0.1);
      } else {
        this.fx.burst(e.x, e.def.height * 0.7, e.z, { count: 14, color: this.arena.portal, speed: 2, up: 1.6, life: Math.max(0.4, k.windup || 0.5) });
      }
      const cast = { k, t: k.windup != null ? k.windup : 0.6, phase: "windup" };
      e.cast = cast;
      if (k.type === "charge") {
        const d2 = Math.max(0.001, Math.hypot(this.px - e.x, this.pz - e.z));
        cast.dx = (this.px - e.x) / d2; cast.dz = (this.pz - e.z) / d2;
        this.after(k.windup, () => {
          if (e.cast === cast && !e.dead) { cast.phase = "go"; cast.t = k.dur; cast.hit = false; SFX.play("swing_big"); }
        });
      }
      return true;
    }
    return false;
  }

  /**
   * Bestiary portrait: render an enemy model once to a small offscreen frame
   * and cache the dataURL (grabbed immediately after render — no
   * preserveDrawingBuffer needed). Same normalized height for every foe.
   */
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

  /** menu 3D showcase: the three champions on a drifting dais (title screen) */
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
      this._equip(a, pair[0]);
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
    const tx = this.px ?? 0, tz = this.pz ?? 0;
    // player-adjustable framing: wheel/pinch zoom, right-drag orbit + pitch
    const zoom = this.input.camZoom, yaw = this.input.camYaw, pitch = this.input.camPitch;
    const horiz = 14.5 * zoom, up = 19 * zoom * pitch;
    if (this.state === "menu") {
      // hero-showcase framing: eye-level dolly; pull back on narrow screens so
      // all three champions stay in frame
      const aspect = this.camera.aspect || 1.6;
      const back = 7.4 * Math.min(2.3, Math.max(1, 1.5 / Math.max(0.55, aspect)));
      this._v2.set(Math.sin(performance.now() / 7000) * 0.7, 2.35 + (back - 7.4) * 0.18, back);
      this.camera.position.lerp(this._v2, damp(4, dt));
      this.camera.lookAt(0, 1.15, 0);
      return;
    }
    const off = { x: Math.sin(yaw) * horiz, y: up, z: Math.cos(yaw) * horiz };
    // bias follow toward board center so the rim + void stay framed
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
