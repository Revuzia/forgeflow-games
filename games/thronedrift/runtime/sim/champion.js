// Thronedrift — Champion entity: a playable fighter (human, bot, or remote)
// with the full data-driven class kit. Extracted from the single-player state
// that used to live flat on Game so that campaign (1 champion vs waves) and
// PVP (N champions vs each other) run the exact same combat code.

import * as THREE from "three";
import { BOARD_RADIUS } from "../data/arenas.js";
import { CLASSES, COMBO_TIERS, COMBO_WINDOW, DASHES } from "../data/abilities.js";
import { Actor, makeGreatblade, makeSword, makeShield, makeBow, makeStaff, makeArrow, makeSpinTrail, normalizeShaftProp } from "../view/chars.js";
import { SFX } from "../core/audio.js";
import { clamp, rand, angleLerp, damp, dist2 } from "../core/util.js";

export const PLAYER_R = 0.65;
const IFRAMES = 0.9;

export class Champion {
  constructor(game, { id, classId, controller, team, isLocal = false, name = "Champion" }) {
    this.game = game;
    this.id = id; this.classId = classId; this.controller = controller;
    this.team = team; this.isLocal = isLocal; this.name = name;
    this.isChampion = true;

    const cls = CLASSES[classId];
    this.cls = cls;
    this.modeKeys = cls.modes || ["base"];
    this.modeIdx = 0;

    this.x = 0; this.z = 4;
    this.facing = -Math.PI / 2;
    this.hp = cls.hearts; this.maxHp = cls.hearts;
    this.gold = 0; this.score = 0;
    this.iframeT = 0; this.wardHp = 0; this.wardT = 0;
    this.basicT = 0; this.attackAnimT = 0; this.basicAlt = 0;
    this.block = { active: false, raisedAt: 0, holdT: 0 };
    this.spin = null; this.spinTrail = null;
    this.dead = false; this.respawnT = 0; this.deadT = 0;
    this.cds = {};
    for (const k of this.modeKeys) this.cds[k] = [0, 0, 0];
    this.combo = 0; this.comboT = 0; this.mult = 1;
    // PVP: champions can be shocked/burned/frozen/knocked like mobs
    this.statuses = { shock: 0, burn: 0, frost: 0 };
    this.knockX = 0; this.knockZ = 0;
    this.statusFxT = 0;
    this.kills = 0; this.deaths = 0; this.dmgDealt = 0;
    this.dashDef = DASHES[classId];
    this.dashCd = 0; this.dashing = null;   // {t, vx, vz, def}
    this.swapCd = 0;                        // TAB weapon-mode cooldown
    this.jumpVy = 0; this.airY = 0;         // SPACE jump

    // actors — warrior gets one per weapon mode
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.actors = {};
    for (const k of this.modeKeys) {
      const kit = cls.kits[k];
      const actor = new Actor(game.heroLib[kit.model], { height: 1.85 });
      this._equip(actor, kit.model);
      actor.root.visible = false;
      this.group.add(actor.root);
      this.actors[k] = actor;
    }
    this._applyMode(true);

    this.wardMesh = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0xb47aff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.wardMesh.visible = false;
    this.group.add(this.wardMesh);
  }

  kit() { return this.cls.kits[this.modeKeys[this.modeIdx]]; }
  modeKey() { return this.modeKeys[this.modeIdx]; }

  _equip(actor, model) {
    const g = this.game;
    if (model === "barbarian") {
      // shoulder-carry diagonal for the calm Idle_02 (dead-vertical read odd)
      actor.attachWeapon(makeGreatblade(), "Right", { gripFrac: 0.13, palm: 0.13, rest: [0.5, 0.75, 0.3] });
    }
    else if (model === "knight") {
      actor.attachWeapon(makeSword(), "Right", { gripFrac: 0.14, palm: 0.12, rest: [0.15, 0.62, 0.77] });
      actor.attachShield(makeShield());
    } else if (model === "rogue") {
      const bow = g.propLib.bow ? normalizeShaftProp(g.propLib.bow, 1.2) : makeBow();
      actor.attachWeapon(bow, "Left", { gripFrac: 0.5, palm: 0.12, roll: 0, rest: [0.05, 0.98, 0.15] });
    } else if (model === "sorceress") {
      // ORIGINAL Meshy mesh restored (owner 2026-07-13): the baked staff
      // stays as authored — every local surgery graft read worse. No
      // procedural staff, no idle relax (relax fights the authored
      // staff-carry pose). Proper fix = Meshy animation-library clips,
      // researched in BUILD_STATUS.
    }
  }

  _applyMode(first) {
    for (const k of this.modeKeys) this.actors[k].root.visible = false;
    const actor = this.actors[this.modeKey()];
    actor.root.visible = true;
    this.actor = actor;
    actor.play("Idle");
    if (!first) {
      SFX.play("mode");
      if (this.isLocal) {
        this.game.hud.setKit(this.cls, this.kit(), this.modeIdx, this.modeKeys.length);
        this.game.hud.callout(this.kit().label.toUpperCase() + "!", this.cls.uiColor);
      }
      this.game.fx.burst(this.x, 1.2, this.z, { count: 26, color: 0xffd24a, color2: this.cls.color, speed: 3, up: 2, life: 0.5 });
      this.block.active = false;
      this.attackAnimT = 0.25;
    }
  }

  // ---------------- combo (per champion; HUD only for local) ----------------

  registerHit() {
    this.combo++;
    this.comboT = COMBO_WINDOW;
    let tier = COMBO_TIERS[0];
    for (const t of COMBO_TIERS) if (this.combo >= t.hits) tier = t;
    if (tier.mult > this.mult) {
      this.mult = tier.mult;
      if (this.isLocal) {
        this.game.hud.comboPop(this.mult);
        this.game.hud.callout(`${this.mult}x COMBO!`, "#ffd24a");
        SFX.play("combo");
      }
    }
    if (this.isLocal) this.game.hud.setCombo(this.mult, this.combo);
  }

  dropCombo() {
    this.combo = 0; this.mult = 1;
    if (this.isLocal) this.game.hud.setCombo(1, 0);
  }

  // ---------------- abilities ----------------------------------------------

  fireBasic() {
    const g = this.game;
    const b = this.kit().basic;
    this.basicT = b.rate;
    const tgt = g.nearestHostile(this, b.range ? Math.max(7, b.range) : 8);
    if (tgt) this.facing = Math.atan2(tgt.z - this.z, tgt.x - this.x);
    const anim = Array.isArray(b.anim) ? b.anim[this.basicAlt++ % b.anim.length] : b.anim;
    const action = this.actor.actions["C_" + anim];
    const clipDur = action ? action.getClip().duration : 0.5;
    const ts = clipDur / Math.max(0.22, b.rate * 0.95);
    const dur = this.actor.playOnce("C_" + anim, { timeScale: ts });
    this.attackAnimT = Math.min(dur * 0.7, b.rate * 0.8);
    SFX.play(b.sfx);
    if (b.type === "melee") {
      g.after(dur * 0.35, () => {
        if (this.dead) return;
        g.spawnSwipe(this, b.trail || 0xffd24a, b.range, b.arc);
        const hits = g.hostilesInArc(this, b.arc, b.range);
        for (const t of hits) g.applyDamage(t, b.dmg, {}, this);
        if (hits.length && this.isLocal) g.addShake(0.08);
        g.fx.burst(this.x + Math.cos(this.facing) * 1.6, 1.1, this.z + Math.sin(this.facing) * 1.6,
          { count: 7, color: b.trail || 0xffffff, speed: 2, up: 1, life: 0.25 });
      });
    } else if (b.type === "shot") {
      g.after(dur * 0.25, () => { if (!this.dead) this.spawnShots(b); });
    }
  }

  spawnShots(def) {
    const g = this.game;
    const count = def.count || 1;
    const spread = def.spread || 0;
    for (let i = 0; i < count; i++) {
      const off = count > 1 ? (i / (count - 1) - 0.5) * spread : 0;
      const a = this.facing + off;
      g.spawnProjectile({
        x: this.x + Math.cos(a) * 0.8, z: this.z + Math.sin(a) * 0.8, y: 1.2,
        vx: Math.cos(a) * def.speed, vz: Math.sin(a) * def.speed,
        dmg: def.dmg, range: def.range || 16,
        ownerId: this.id, team: this.team,
        tint: def.tint || 0xffd080, arrow: this.classId === "archer",
        bomb: def.type === "bomb" ? def : null,
        trailRate: def.type === "bomb" ? 0.95 : this.classId === "mage" ? 0.6 : 0.22,
      });
    }
  }

  castAbility(slot) {
    const g = this.game;
    const key = this.modeKey();
    const def = this.kit().abilities[slot];
    if (!def || this.cds[key][slot] > 0 || this.attackAnimT > 0.15) return;
    if (def.type === "block") { this.startBlock(def, slot); return; }
    this.cds[key][slot] = def.cd;
    const tgt = g.nearestHostile(this, 12);
    if (tgt && def.type !== "spin" && def.type !== "ward") this.facing = Math.atan2(tgt.z - this.z, tgt.x - this.x);
    const abAction = this.actor.actions["C_" + def.anim];
    const abClipDur = abAction ? abAction.getClip().duration : 0.6;
    const abTs = Math.max(def.animScale || 1, abClipDur / 0.9);
    const dur = this.actor.playOnce("C_" + def.anim, { timeScale: abTs });
    this.attackAnimT = Math.min(dur * 0.85, 1.0);
    if (def.callout && this.isLocal) g.hud.callout(def.callout, this.cls.uiColor);
    SFX.play(def.sfx);
    if (def.shake && this.isLocal) g.addShake(def.shake);

    switch (def.type) {
      case "melee": {
        g.after(dur * 0.35, () => {
          if (this.dead) return;
          g.spawnSwipe(this, 0xffd24a, def.range, def.arc);
          for (const t of g.hostilesInArc(this, def.arc, def.range))
            g.applyDamage(t, def.dmg, { heavy: true, knockback: def.knockback || 0, status: def.stagger ? { stagger: def.stagger } : null }, this);
        });
        break;
      }
      case "bash": {
        g.after(dur * 0.3, () => {
          if (this.dead) return;
          const hits = g.hostilesInArc(this, def.arc, def.range);
          for (const t of hits)
            g.applyDamage(t, def.dmg, { heavy: true, knockback: def.knockback, status: { shock: def.shock } }, this);
          if (hits.length && def.hitstop && this.isLocal) g.hitstop(def.hitstop);
        });
        break;
      }
      case "spin": {
        this.spin = { def, t: def.duration, tickT: 0, interval: def.duration / def.ticks };
        this.spinTrail = makeSpinTrail(this.cls.color);
        this.group.add(this.spinTrail);
        g.decals.spawn("ring", this.x, this.z, def.radius, def.duration, { grow: true, spin: 3 });
        break;
      }
      case "slam": {
        g.after(dur * 0.42, () => {
          if (this.dead) return;
          g.decals.spawn("ring", this.x, this.z, def.radius, 0.55, { grow: true });
          g.fx.burst(this.x, 0.4, this.z, { count: 34, color: 0xffb060, color2: 0xff5a2a, speed: 6, up: 3.5, life: 0.5, spread: 3 });
          for (const t of g.hostilesInRadius(this, this.x, this.z, def.radius))
            g.applyDamage(t, def.dmg, { heavy: true, knockback: def.knockback, status: { stagger: def.stagger } }, this);
          if (this.isLocal) { g.addShake(def.shake); g.hitstop(def.hitstop || 0); }
          SFX.play("slam");
        });
        break;
      }
      case "rupture": {
        const a = this.facing;
        g.after(dur * 0.35, () => {
          if (this.dead) return;
          const steps = 6;
          for (let s = 1; s <= steps; s++) {
            const t = (s / steps);
            g.after(s * 0.045, () => {
              const x = this.x + Math.cos(a) * def.length * t;
              const z = this.z + Math.sin(a) * def.length * t;
              g.decals.spawn("ring", x, z, def.width * 0.8, 0.5, { grow: true });
              g.fx.burst(x, 0.3, z, { count: 10, color: 0xffa040, color2: 0x8a5030, speed: 3, up: 4, life: 0.45 });
            });
          }
          for (const t of g.hostilesInLine(this, a, def.length, def.width))
            g.applyDamage(t, def.dmg, { heavy: true, status: { stagger: def.stagger } }, this);
          if (this.isLocal) g.hitstop(def.hitstop || 0);
        });
        break;
      }
      case "shot": {
        g.after(dur * 0.25, () => { if (!this.dead) this.spawnShots(def); });
        break;
      }
      case "bomb": {
        g.after(dur * 0.3, () => { if (!this.dead) this.spawnShots(def); });
        break;
      }
      case "rain": {
        // target the densest hostile cluster in range
        let tx = this.x + Math.cos(this.facing) * def.range * 0.55;
        let tz = this.z + Math.sin(this.facing) * def.range * 0.55;
        let bestScore = 0;
        const hostiles = g.allHostiles(this);
        for (const c of hostiles) {
          if (dist2(c.x, c.z, this.x, this.z) > def.range * def.range) continue;
          let s = 0;
          for (const e of hostiles) if (dist2(e.x, e.z, c.x, c.z) < def.radius * def.radius) s++;
          if (s > bestScore) { bestScore = s; tx = c.x; tz = c.z; }
        }
        g.decals.spawn("reticle", tx, tz, def.radius, def.delay + def.volleys * def.volleyGap, { spin: 1.2 });
        for (let v = 0; v < def.volleys; v++) {
          g.after(Math.max(0.05, def.delay + v * def.volleyGap - 0.32), () => {
            for (let n = 0; n < 8; n++) {
              const a2 = rand(Math.PI * 2), r2 = Math.sqrt(Math.random()) * def.radius;
              const ax = tx + Math.cos(a2) * r2, az = tz + Math.sin(a2) * r2;
              const m = makeArrow(0xffc060);
              m.position.set(ax, 9 + rand(0, 2), az);
              m.lookAt(ax, -10, az);
              g.scene.add(m);
              g.fallers.push({ mesh: m, vy: 30 });
            }
          });
        }
        for (let v = 0; v < def.volleys; v++) {
          g.after(def.delay + v * def.volleyGap, () => {
            SFX.play("rain");
            if (this.isLocal) g.addShake(0.2);
            for (let n = 0; n < 6; n++) {
              const a2 = rand(Math.PI * 2), r2 = Math.sqrt(Math.random()) * def.radius;
              g.fx.burst(tx + Math.cos(a2) * r2, 0.3, tz + Math.sin(a2) * r2, { count: 6, color: 0xffd080, color2: 0xff8a40, speed: 2.5, up: 3, life: 0.35 });
            }
            let n0 = 0;
            for (const t of g.hostilesInRadius(this, tx, tz, def.radius))
              g.applyDamage(t, def.dmg, { silent: n0++ > 0 }, this);
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

  castDash() {
    const g = this.game, d = this.dashDef;
    if (!d || this.dashCd > 0 || this.spin || this.dashing) return;
    this.dashCd = d.cd;
    const dx = Math.cos(this.facing), dz = Math.sin(this.facing);
    if (d.callout && this.isLocal) g.hud.callout(d.callout, this.cls.uiColor);
    if (d.type === "blink") {
      g.fx.burst(this.x, 1.2, this.z, { count: 22, color: this.cls.color, color2: 0xffffff, speed: 3, up: 2, life: 0.45 });
      this.x += dx * d.dist; this.z += dz * d.dist;
      const dc = Math.hypot(this.x, this.z);
      if (dc > BOARD_RADIUS - 0.5) { this.x *= (BOARD_RADIUS - 0.5) / dc; this.z *= (BOARD_RADIUS - 0.5) / dc; }
      this.iframeT = Math.max(this.iframeT, 0.3);
      g.fx.burst(this.x, 1.2, this.z, { count: 22, color: this.cls.color, color2: 0xffffff, speed: 3, up: 2, life: 0.45 });
      SFX.play("ward");
      return;
    }
    this.dashing = { t: d.dur, vx: dx * d.dist / d.dur, vz: dz * d.dist / d.dur, def: d };
    if (d.type === "roll") { this.iframeT = Math.max(this.iframeT, d.dur + 0.2); this.actor.play("Run", { timeScale: 2 }); }
    else this.actor.playOnce(this.actor.actions["C_finisher"] ? "C_finisher" : "C_slash1", { timeScale: 2.4 });
    SFX.play(d.type === "lunge" ? "swing_big" : "swing");
  }

  _updateDash(dt) {
    const g = this.game, ds = this.dashing;
    ds.t -= dt;
    this.x += ds.vx * dt; this.z += ds.vz * dt;
    const dc = Math.hypot(this.x, this.z);
    if (dc > BOARD_RADIUS) { this.x *= BOARD_RADIUS / dc; this.z *= BOARD_RADIUS / dc; ds.t = 0; }
    g.fx.burst(this.x, 0.4, this.z, { count: 2, color: this.cls.color, speed: 1, up: 0.6, life: 0.25 });
    if (ds.t <= 0) {
      if (ds.def.type === "lunge") {
        g.spawnSwipe(this, 0xff5a3a, 2.4, 2.0);
        for (const t of g.hostilesInLine(this, this.facing, ds.def.dist * 0.7, 1.8))
          g.applyDamage(t, ds.def.dmg, { heavy: true, knockback: 2 }, this);
        if (this.isLocal) g.addShake(0.3);
        SFX.play("hit_heavy");
      }
      this.dashing = null;
    }
  }

  startBlock(def, slot) {
    const key = this.modeKey();
    if (this.cds[key][slot] > 0 || this.block.active) return;
    this.block.active = true;
    this.block.raisedAt = performance.now() / 1000;
    this.block.holdT = 0;
    this.block.def = def; this.block.slot = slot;
    this.actor.playOnce("C_parry", { timeScale: def.animScale });
    if (this.isLocal) this.game.hud.callout(def.callout, this.cls.uiColor);
    SFX.play("block");
  }

  endBlock() {
    if (!this.block.active) return;
    this.cds[this.modeKey()][this.block.slot] = this.block.def.cd;
    this.block.active = false;
  }

  // ---------------- damage intake -------------------------------------------

  /** returns true if the hit connected (not warded/blocked/iframed).
   *  rawDmg (pre-conversion weapon damage) feeds the stats/scoreboard. */
  takeDamage(dmg, fromX, fromZ, attacker = null, rawDmg = null) {
    const g = this.game;
    if (this.iframeT > 0 || this.dead || g.state !== "playing") return false;
    if (this.wardHp > 0) {
      this.wardHp -= dmg;
      g.fx.burst(this.x, 1.3, this.z, { count: 14, color: 0xb47aff, speed: 3, up: 1.5, life: 0.35 });
      SFX.play("block");
      if (this.wardHp <= 0) { this.wardMesh.visible = false; this.wardT = 0; }
      return false;
    }
    if (this.block.active && fromX !== undefined) {
      const toSrc = Math.atan2(fromZ - this.z, fromX - this.x);
      let diff = Math.abs(toSrc - this.facing) % (Math.PI * 2);
      if (diff > Math.PI) diff = Math.PI * 2 - diff;
      if (diff < Math.PI * 0.6) {
        const now = performance.now() / 1000;
        const perfect = now - this.block.raisedAt <= this.block.def.perfectWindow;
        g.fx.burst(this.x + Math.cos(this.facing) * 0.8, 1.2, this.z + Math.sin(this.facing) * 0.8,
          { count: perfect ? 22 : 10, color: 0xffd24a, color2: 0xffffff, speed: 3, up: 1.5, life: 0.3 });
        if (perfect) {
          SFX.play("block_perfect");
          g.text.spawn("PERFECT BLOCK", this.x, 2.4, this.z, { color: "#ffd24a", size: 20 });
          const p = this.block.def.perfectPulse;
          for (const t of g.hostilesInArc(this, p.arc, p.range)) g.applyDamage(t, p.dmg, { status: { shock: p.shock } }, this);
          return false;
        }
        SFX.play("block");
        dmg *= (1 - this.block.def.dr);
      }
    }
    this.hp -= dmg;
    if (attacker && attacker.isChampion) attacker.dmgDealt += (rawDmg ?? dmg);
    this.iframeT = IFRAMES;
    this.dropCombo();
    if (this.isLocal) { g.hud.setHearts(this.hp, this.maxHp); g.addShake(0.5); }
    SFX.play("hurt");
    g.fx.burst(this.x, 1.2, this.z, { count: 16, color: 0xff4040, speed: 3.5, up: 2, life: 0.4 });
    this.actor.playOnce("C_hit", { timeScale: 1.4 });
    this.attackAnimT = Math.max(this.attackAnimT, 0.2);
    if (this.hp <= 0) g.mode.onDeath(this, attacker);
    return true;
  }

  applyStatus(status) {
    const g = this.game;
    const mods = g.arena.modifiers;
    if (status.shock) {
      this.statuses.shock = Math.max(this.statuses.shock, status.shock * (mods.shockDurMult || 1));
      g.text.spawn("SHOCK", this.x, 2.2, this.z, { color: "#b0a0ff", size: 21 });
      g.fx.burst(this.x, 1.2, this.z, { count: 12, color: 0xb0a0ff, color2: 0xffffff, speed: 2.5, up: 1.5, life: 0.3 });
      SFX.play("shock");
    }
    if (status.burn) { this.statuses.burn = Math.max(this.statuses.burn, status.burn); g.text.spawn("BURN", this.x, 2.2, this.z, { color: "#ff8a3a", size: 18 }); }
    if (status.frost) { this.statuses.frost = Math.max(this.statuses.frost, status.frost); g.text.spawn("FROST", this.x, 2.2, this.z, { color: "#8ae0ff", size: 18 }); }
    if (status.stagger) this.attackAnimT = Math.max(this.attackAnimT, status.stagger * 0.5);
  }

  die() {
    this.dead = true; this.deadT = 0; this.deaths++;
    this.endBlock();
    if (this.spin) { this.spin = null; this.group.rotation.y = 0; if (this.spinTrail) { this.spinTrail.removeFromParent(); this.spinTrail = null; } }
    this.wardHp = 0; this.wardT = 0; this.wardMesh.visible = false;
    this.actor.playOnce("C_death", { timeScale: 1 });
    SFX.play("death");
  }

  respawn(x, z) {
    this.dead = false; this.respawnT = 0;
    this.hp = this.maxHp;
    this.x = x; this.z = z;
    this.iframeT = 2;                                 // spawn protection
    for (const k of this.modeKeys) this.cds[k] = [0, 0, 0];
    this.statuses = { shock: 0, burn: 0, frost: 0 };
    this.knockX = 0; this.knockZ = 0;
    this.basicT = 0; this.attackAnimT = 0;
    this.actor.play("Idle");
    this.actor.model.visible = true;
    this.game.fx.burst(x, 1.2, z, { count: 24, color: this.cls.color, color2: 0xffffff, speed: 3, up: 2.5, life: 0.5 });
    if (this.isLocal) {
      this.game.hud.setHearts(this.hp, this.maxHp);
      this.game.cameraTarget = null;
    }
  }

  // ---------------- per-frame -----------------------------------------------

  update(dt) {
    const g = this.game;
    if (this.dead) {
      this.deadT += dt;
      this.actor.update(dt);
      this.group.position.set(this.x, -Math.max(0, this.deadT - 1.2) * 0.8, this.z);
      return;
    }

    // statuses tick
    const st = this.statuses;
    for (const k of ["shock", "burn", "frost"]) if (st[k] > 0) st[k] -= dt;
    if (st.burn > 0) {
      this.statusFxT -= dt;
      if (this.statusFxT <= 0) { this.statusFxT = 0.18; g.fx.burst(this.x, 1.1, this.z, { count: 3, color: 0xff7a20, speed: 1, up: 2, life: 0.35 }); }
      this.hp -= 2.2 * dt / this.maxHp * 4;    // gentle DoT in hearts
      if (this.isLocal) g.hud.setHearts(this.hp, this.maxHp);
      if (this.hp <= 0 && !this.dead) g.mode.onDeath(this, null);
    }
    const shocked = st.shock > 0;
    if (shocked && Math.random() < dt * 10) g.fx.burst(this.x, 1.3, this.z, { count: 3, color: 0xc8b8ff, color2: 0xffffff, speed: 2, up: 0.5, life: 0.15 });

    const ctrl = this.controller;
    const live = g.roundLive !== false;
    ctrl.update && ctrl.update(dt, this, g);

    // dash cooldown + active dash
    if (this.dashCd > 0) this.dashCd -= dt;
    if (this.dashing) this._updateDash(dt);
    else if (live && !shocked && ctrl.dashPressed()) this.castDash();

    // mode toggle (on a short cooldown like the dash — owner request)
    if (this.swapCd > 0) this.swapCd -= dt;
    if (live && !shocked && ctrl.togglePressed()) {
      if (this.modeKeys.length > 1 && !this.spin && this.swapCd <= 0) {
        this.swapCd = 2.5;
        this.endBlock();
        this.modeIdx = (this.modeIdx + 1) % this.modeKeys.length;
        this._applyMode(false);
      }
    }

    // SPACE jump — pure verticality, weapons stay usable
    if (live && !shocked && this.airY === 0 && !this.dashing && ctrl.jumpPressed()) {
      this.jumpVy = 6.6;
      SFX.play("swing");
      this.game.fx.burst(this.x, 0.15, this.z, { count: 6, color: 0xcfc8b8, speed: 1.5, up: 0.8, life: 0.3 });
    }
    if (this.airY > 0 || this.jumpVy > 0) {
      this.airY += this.jumpVy * dt;
      this.jumpVy -= 17 * dt;
      if (this.airY <= 0) {
        if (this.jumpVy < -3) this.game.fx.burst(this.x, 0.15, this.z, { count: 8, color: 0xcfc8b8, speed: 2, up: 1, life: 0.3 });
        this.airY = 0; this.jumpVy = 0;
      }
    }

    // abilities
    if (live && !shocked) {
      for (let i = 0; i < 3; i++) {
        const def = this.kit().abilities[i];
        if (!def) continue;
        if (def.hold) {
          if (ctrl.abilityPressed(i)) this.castAbility(i);
          if (this.block.active) {
            this.block.holdT += dt;
            if (!ctrl.abilityHeld[i] || this.block.holdT >= def.maxHold) this.endBlock();
          }
        } else if (ctrl.abilityPressed(i)) this.castAbility(i);
      }
      this.basicT -= dt;
      if (ctrl.basicHeld && this.basicT <= 0 && !this.spin && !this.block.active) this.fireBasic();
    }

    // movement (a kinetic dash overrides steering)
    const mv = live && !shocked && !this.dashing ? ctrl.moveVec() : { x: 0, z: 0, mag: 0 };
    const frostMult = st.frost > 0 ? 0.55 : 1;
    // melee slows less than before while swinging; ranged barely slows —
    // this was why archers FELT far faster than warriors
    const atkSlow = this.attackAnimT > 0 ? (this.kit().basic.type === "melee" ? 0.7 : 0.85) : 1;
    const spd = this.cls.speed * frostMult * (this.block.active ? 0.45 : 1) * atkSlow;
    this.x += mv.x * spd * dt + this.knockX * dt;
    this.z += mv.z * spd * dt + this.knockZ * dt;
    this.knockX *= Math.exp(-6 * dt); this.knockZ *= Math.exp(-6 * dt);
    const dCenter = Math.hypot(this.x, this.z);
    if (dCenter > BOARD_RADIUS) { this.x *= BOARD_RADIUS / dCenter; this.z *= BOARD_RADIUS / dCenter; }

    // facing: controller aim beats movement direction
    const aim = live && !shocked ? ctrl.aim() : null;
    if (aim) this.facing = Math.atan2(aim.z - this.z, aim.x - this.x);
    else if (mv.mag > 0.1 && this.attackAnimT <= 0) this.facing = angleLerp(this.facing, Math.atan2(mv.z, mv.x), damp(14, dt));

    // locomotion / spin
    const actor = this.actor;
    this.attackAnimT -= dt;
    if (this.spin) {
      this.spin.t -= dt;
      this.spin.tickT -= dt;
      this.group.rotation.y -= 13 * dt;
      if (this.spinTrail) {
        this.spinTrail.rotation.y += 22 * dt;
        const pulse = 1 + Math.sin(this.spin.t * 30) * 0.08;
        this.spinTrail.scale.set(pulse, 1, pulse);
      }
      if (this.spin.tickT <= 0) {
        this.spin.tickT = this.spin.interval;
        const d = this.spin.def;
        g.fx.burst(this.x, 0.9, this.z, { count: 18, color: 0xff5a3a, color2: 0xffd24a, speed: 6, up: 1.4, life: 0.4, spread: 3 });
        for (const t of g.hostilesInRadius(this, this.x, this.z, d.radius))
          g.applyDamage(t, d.dmg, { knockback: 1.5 }, this);
        SFX.play("swing_big");
      }
      if (this.spin.t <= 0) {
        this.spin = null; this.group.rotation.y = 0;
        if (this.spinTrail) { this.spinTrail.removeFromParent(); this.spinTrail = null; }
      }
    } else if (this.attackAnimT <= 0) {
      // feet match actual ground speed (class speed + frost/block/attack
      // slows) instead of one fixed rate — kills the skating look
      const gs = spd * mv.mag;
      if (mv.mag > 0.55) actor.play("Run", { timeScale: clamp(1.2 * gs / 6.1, 0.7, 1.6) });
      else if (mv.mag > 0.05) actor.play("Walk", { timeScale: clamp(1.1 * gs / 2.6, 0.6, 1.5) });
      else if (!this.block.active) actor.play("Idle");
    }
    actor.update(shocked ? dt * 0.08 : dt);
    const moving = mv.mag > 0.05;
    // v1.5: proper Meshy library clips on fresh rigs — the arm-relax hack is
    // retired for heroes (it existed to fight the old arms-out clips)
    actor.updateRelax(dt, 0, moving, mv.mag > 0.55);

    // squash & stretch sells the jump without a dedicated clip
    const stretch = this.airY > 0 ? 1 + Math.min(0.12, Math.abs(this.jumpVy) * 0.015) : 1;
    this.group.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
    this.group.position.set(this.x, this.airY, this.z);
    if (!this.spin) this.group.rotation.y = -this.facing + Math.PI / 2;

    // iframes flash
    this.iframeT -= dt;
    actor.model.visible = !(this.iframeT > 0 && Math.floor(this.iframeT * 14) % 2 === 0);

    // ward
    if (this.wardT > 0) {
      this.wardT -= dt;
      this.wardMesh.position.y = 1.1;
      this.wardMesh.material.opacity = 0.16 + Math.sin(performance.now() / 130) * 0.06;
      if (this.wardT <= 0) { this.wardHp = 0; this.wardMesh.visible = false; }
    }

    // combo window
    if (this.combo > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.dropCombo();
    }

    // cooldowns
    const cds = this.cds[this.modeKey()];
    for (let i = 0; i < 3; i++) if (cds[i] > 0) cds[i] -= dt;
    if (this.isLocal) {
      const defs = this.kit().abilities;
      const list = defs.map((d, i) => ({ frac: d ? clamp(cds[i] / d.cd, 0, 1) : 0, secs: Math.max(0, cds[i]) }));
      if (this.dashDef) list.push({ frac: clamp(this.dashCd / this.dashDef.cd, 0, 1), secs: Math.max(0, this.dashCd) });
      g.hud.setCooldowns(list);
      if (this.modeKeys.length > 1 && g.hud.setSwapCd) g.hud.setSwapCd(clamp(this.swapCd / 2.5, 0, 1), Math.max(0, this.swapCd));
    }
  }

  dispose() {
    this.game.scene.remove(this.group);
    for (const k of this.modeKeys) this.actors[k].dispose();
  }
}
