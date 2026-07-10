// Crownfire Arenas — core simulation: player controller, ability primitives,
// enemy AI, waves, statuses (Shock/Burn/Frost), ground residuals, combo/score,
// camera follow + screen shake + hit-stop, and run flow (wave clear → realm
// clear → crown claimed / game over).

import * as THREE from "three";
import { ARENAS, BOARD_RADIUS, REST_BETWEEN_WAVES } from "../data/arenas.js";
import { ENEMY_TYPES, waveComp } from "../data/enemies.js";
import { CLASSES, COMBO_TIERS, COMBO_WINDOW } from "../data/abilities.js";
import { ArenaBoard } from "../view/arena.js";
import { Actor, makeGreatblade, makeSword, makeShield, makeBow, makeStaff } from "../view/chars.js";
import { Particles, FloatText, Decals } from "../view/fx.js";
import { SFX } from "../core/audio.js";
import { clamp, lerp, rand, randInt, angleLerp, damp, dist2, formatScore } from "../core/util.js";

const PLAYER_R = 0.65;         // player collision radius
const IFRAMES = 0.7;

export class Game {
  constructor({ renderer, camera, hud, input, heroes, enemies, container }) {
    this.renderer = renderer; this.camera = camera;
    this.hud = hud; this.input = input;
    this.heroLib = heroes; this.enemyLib = enemies;
    this.container = container;

    this.scene = new THREE.Scene();
    this.state = "menu";
    this.timeScale = 1; this.hitstopT = 0;
    this.shake = 0;
    this.timers = [];
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3();

    this.fx = null; this.text = null; this.decals = null; this.board = null;

    hud.cb.onStart = (classId, arenaIdx) => this.startRun(classId, arenaIdx);
    this.camera.position.set(0, 16, 12);
    this.camera.lookAt(0, 0, 0);
  }

  // ================= RUN SETUP ==========================================

  startRun(classId, arenaIdx) {
    this.cleanupRun();
    this.hud.hideMenus();
    this.hud.clearPanel();
    this.classId = classId;
    this.arenaIdx = arenaIdx;
    this.arena = ARENAS[arenaIdx];
    this.board = new ArenaBoard(this.scene, this.arena);
    this.fx = new Particles(this.scene);
    this.text = new FloatText(this.hud.layerGame, this.camera);
    this.decals = new Decals(this.scene);

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
    this.spawnQueue = [];
    this.waveIdx = -1; this.waveActive = false; this.restT = 1.4;

    this.hud.setKit(cls, this.kit(), this.modeIdx, this.modeKeys.length);
    this.hud.setHearts(this.hp, this.maxHp);
    this.hud.setGold(0); this.hud.setScore(0);
    this.hud.setWave(1, this.arena.waves, this.arena.name, "#" + this.arena.accent.toString(16).padStart(6, "0"));
    const hintBits = ["<b>WASD</b> move", "<b>J / Click</b> attack", "<b>1 2 3</b> abilities"];
    if (this.modeKeys.length > 1) hintBits.push("<b>TAB</b> weapon mode", "<b>hold 3</b> Block (Sword & Shield)");
    this.hud.hint(hintBits.join(" · "), 7);

    this.state = "playing";
    this.input.enabled = true;
    this.input.clearEdges();
    this.hud.banner(this.arena.name.toUpperCase(), { color: "#" + this.arena.accent.toString(16).padStart(6, "0"), sub: this.arena.tagline, dur: 2.2, size: 46 });
  }

  cleanupRun() {
    if (this.board) { this.board.dispose(); this.board = null; }
    if (this.fx) { this.fx.dispose(this.scene); this.fx = null; }
    if (this.decals) { this.decals.clear(); this.decals = null; }
    if (this.text) { this.text.clear(); this.text = null; }
    if (this.playerGroup) { this.scene.remove(this.playerGroup); this.playerGroup = null; }
    if (this.enemies) for (const e of this.enemies) e.actor.dispose();
    if (this.projectiles) for (const p of this.projectiles) p.mesh.removeFromParent();
    this.enemies = []; this.projectiles = []; this.timers = [];
    this.timeScale = 1; this.shake = 0;
  }

  kit() { return this.cls.kits[this.modeKeys[this.modeIdx]]; }
  modeKey() { return this.modeKeys[this.modeIdx]; }

  _equip(actor, model) {
    if (model === "barbarian") actor.attachHand(makeGreatblade(), "Right");
    else if (model === "knight") { actor.attachHand(makeSword(), "Right"); actor.attachForearm(makeShield(), "Left"); }
    else if (model === "rogue") actor.attachHand(makeBow(), "Left");
    else if (model === "sorceress") actor.attachHand(makeStaff(), "Right");
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
    const comp = waveComp(this.arena.order, this.waveIdx, this.arena.waves);
    let i = 0, delay = 0.4;
    for (const [type, count] of comp)
      for (let n = 0; n < count; n++) {
        this.spawnQueue.push({ type, t: delay, portal: i % 4 });
        delay += rand(0.18, 0.4); i++;
      }
    this.hud.setWave(this.waveIdx + 1, this.arena.waves, this.arena.name, "#" + this.arena.accent.toString(16).padStart(6, "0"));
    this.hud.banner(`WAVE ${this.waveIdx + 1}`, { color: "#f2e8d8", dur: 1.4, size: 46 });
    SFX.play("ui_big");
  }

  spawnEnemy(type, portal) {
    const def = ENEMY_TYPES[type];
    const lib = this.enemyLib[def.model];
    if (!lib) return;
    const p = this.board.spawnPoint(portal);
    const actor = new Actor(lib, { height: def.height, tint: this.arena.enemyTint });
    actor.root.position.set(p.x, 0, p.z);
    this.scene.add(actor.root);
    actor.play("Walk", { timeScale: 1.1 });
    const e = {
      def, type, actor, x: p.x, z: p.z, hp: def.hp, maxHp: def.hp,
      atkT: rand(0.4, 1), windup: 0, statuses: { shock: 0, burn: 0, frost: 0 },
      knockX: 0, knockZ: 0, spawnT: 0.5, statusFxT: 0, floatPhase: rand(Math.PI * 2),
      dead: false, deadT: 0,
    };
    this.enemies.push(e);
    this.fx.burst(p.x, 1.2, p.z, { count: 18, color: this.arena.portal, speed: 3, up: 2.2, life: 0.5 });
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
    if (this.waveIdx + 1 >= this.arena.waves) { this.arenaCleared(); return; }
    this.restT = REST_BETWEEN_WAVES;
  }

  arenaCleared() {
    this.state = "arenaclear";
    this.input.enabled = false;
    SFX.play("victory");
    const final = this.arena.clearIsFinal;
    const unlocked = parseInt(localStorage.getItem("crownfire_unlocked") || "1", 10);
    if (!final && this.arena.order + 1 > unlocked) localStorage.setItem("crownfire_unlocked", String(this.arena.order + 1));
    const hi = parseInt(localStorage.getItem("crownfire_hiscore") || "0", 10);
    if (this.score > hi) localStorage.setItem("crownfire_hiscore", String(this.score));
    const lines = [
      `Final score: <b style="color:#ffd24a;font-size:24px">${formatScore(this.score)}</b>`,
      `Best: ${formatScore(Math.max(hi, this.score))} · Gold earned: 🪙 ${this.gold}`,
    ];
    const buttons = [];
    if (!final) buttons.push({ label: "NEXT REALM →", fn: () => this.startRun(this.classId, this.arenaIdx + 1) });
    buttons.push({ label: "RESTART", fn: () => this.startRun(this.classId, this.arenaIdx) });
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
    const hi = parseInt(localStorage.getItem("crownfire_hiscore") || "0", 10);
    if (this.score > hi) localStorage.setItem("crownfire_hiscore", String(this.score));
    setTimeout(() => this.hud.panel({
      title: "FALLEN IN THE ARENA",
      titleColor: "#ff5a4a",
      lines: [
        `You fell on wave ${this.waveIdx + 1} of ${this.arena.name}.`,
        `Score: <b style="color:#ffd24a;font-size:22px">${formatScore(this.score)}</b> · Best: ${formatScore(Math.max(hi, this.score))}`,
      ],
      buttons: [
        { label: "RESTART", fn: () => this.startRun(this.classId, this.arenaIdx) },
        { label: "MENU", fn: () => this.toMenu() },
      ],
    }), 1100);
  }

  toMenu() {
    this.cleanupRun();
    this.state = "menu";
    this.hud.clearPanel();
    this.hud.showTitle();
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

  addShake(m) { this.shake = Math.min(1.4, this.shake + m); }
  hitstop(t) { this.hitstopT = Math.max(this.hitstopT, t); }

  // ================= PLAYER ABILITIES ===================================

  fireBasic() {
    const b = this.kit().basic;
    this.basicT = b.rate;
    // soft aim assist: face nearest enemy in front-ish range
    const tgt = this.nearestEnemy(b.range ? Math.max(7, b.range) : 8);
    if (tgt) this.facing = Math.atan2(tgt.z - this.pz, tgt.x - this.px);
    const anim = Array.isArray(b.anim) ? b.anim[this.basicAlt++ % b.anim.length] : b.anim;
    const dur = this.playerActor.playOnce("C_" + anim, { timeScale: b.animScale });
    this.attackAnimT = Math.min(dur * 0.8, b.rate * 0.9);
    SFX.play(b.sfx);
    if (b.type === "melee") {
      this.after(dur * 0.35, () => {
        const hits = this.enemiesInArc(b.arc, b.range);
        for (const e of hits) this.hurtEnemy(e, b.dmg);
        if (hits.length) this.addShake(0.08);
        // swing trail flash
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
      });
    }
  }

  spawnProjectile(o) {
    let mesh;
    if (o.arrow) {
      mesh = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.65, 6),
        new THREE.MeshBasicMaterial({ color: o.tint }));
      mesh.rotation.x = Math.PI / 2;
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(o.bomb ? 0.3 : 0.17, 10, 8),
        new THREE.MeshBasicMaterial({ color: o.tint }));
    }
    const wrap = new THREE.Group();
    wrap.add(mesh);
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
    const dur = this.playerActor.playOnce("C_" + def.anim, { timeScale: def.animScale });
    this.attackAnimT = Math.min(dur * 0.85, 1.0);
    if (def.callout) this.hud.callout(def.callout, this.cls.uiColor);
    SFX.play(def.sfx);
    if (def.shake) this.addShake(def.shake);

    switch (def.type) {
      case "melee": {
        this.after(dur * 0.35, () => {
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
        dmg *= (1 - this.block.def.dr);
        if (dmg < 0.5) return false;
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

    if (this.state === "playing") this.updatePlaying(dt, hudDt);
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
      if (this.spin.tickT <= 0) {
        this.spin.tickT = this.spin.interval;
        const d = this.spin.def;
        this.fx.burst(this.px, 0.9, this.pz, { count: 14, color: 0xff5a3a, color2: 0xffd24a, speed: 5, up: 1.2, life: 0.35, spread: 2.5 });
        for (const e of this.enemies) {
          if (e.dead) continue;
          if (dist2(e.x, e.z, this.px, this.pz) <= d.radius * d.radius)
            this.hurtEnemy(e, d.dmg, { knockback: 1.5 });
        }
        SFX.play("swing_big");
      }
      if (this.spin.t <= 0) { this.spin = null; this.playerGroup.rotation.y = 0; }
    } else if (this.attackAnimT <= 0 && !this.dead) {
      if (mv.mag > 0.55) actor.play("Run", { timeScale: 1.2 });
      else if (mv.mag > 0.05) actor.play("Walk", { timeScale: 1.1 });
      else if (!this.block.active) actor.play("Idle");
    }
    actor.update(dt);

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

    // ---- spawn queue / wave state
    if (this.waveActive) {
      for (let i = this.spawnQueue.length - 1; i >= 0; i--) {
        const s = this.spawnQueue[i];
        s.t -= dt;
        if (s.t <= 0) { this.spawnQueue.splice(i, 1); this.spawnEnemy(s.type, s.portal); }
      }
      if (this.spawnQueue.length === 0 && this.enemies.every((e) => e.dead)) this.waveCleared();
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

        if (e.def.ranged) {
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
        // knockback decay
        e.x += (mvx + e.knockX) * dt; e.z += (mvz + e.knockZ) * dt;
        e.knockX *= Math.exp(-6 * dt); e.knockZ *= Math.exp(-6 * dt);
        const dc = Math.hypot(e.x, e.z);
        if (dc > BOARD_RADIUS) { e.x *= BOARD_RADIUS / dc; e.z *= BOARD_RADIUS / dc; }

        A.update(dt);
        const moving = Math.hypot(mvx, mvz) > 0.4;
        A.play(moving ? "Walk" : "Idle", { timeScale: moving ? 1.1 * slow : 1 });
        A.root.rotation.y = -Math.atan2(dz, dx) + Math.PI / 2;
      }
      const floatY = e.def.floatH ? e.def.floatH + Math.sin(performance.now() / 400 + e.floatPhase) * 0.2 : 0;
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
        if (!dead && Math.random() < 0.35) this.fx.burst(x, p.mesh.position.y, z, { count: 1, color: p.tint, speed: 0.3, up: 0, life: 0.25, gravity: 0 });
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

    if (this.input.pausePressed()) this.hud.banner("REALM " + this.arena.order + " · " + this.arena.name.toUpperCase(), { dur: 1.2, size: 30 });
  }

  explode(def, x, z) {
    SFX.play("explode");
    this.addShake(def.shake || 0.4);
    if (def.hitstop) this.hitstop(def.hitstop);
    const isFrost = def.residual && def.residual.kind === "frost";
    this.decals.spawn("ring", x, z, def.radius, 0.5, { grow: true });
    this.fx.burst(x, 0.8, z, {
      count: 30, color: isFrost ? 0x8ae0ff : 0xffb060, color2: isFrost ? 0xffffff : 0xff4a20,
      speed: 6, up: 3, life: 0.55, spread: 2,
    });
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

  updateCamera(dt) {
    const tx = this.px ?? 0, tz = this.pz ?? 0;
    const off = this.state === "menu" ? { x: 10, y: 15, z: 14 } : { x: 0, y: 19, z: 14.5 };
    // bias follow toward board center so the rim + void stay framed
    const lx = this.state === "menu" ? Math.cos(performance.now() / 9000) * 8 : tx * 0.72;
    const lz = this.state === "menu" ? Math.sin(performance.now() / 9000) * 8 : tz * 0.72;
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
