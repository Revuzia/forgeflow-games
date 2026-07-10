/**
 * Dungeon Forge — runtime/3d/enemies.js
 * Visual layer for sim enemies: skinned GLB clones with animation mixers
 * (idle/walk/attack/death per Quaternius clip names), procedural hover for
 * rigless models (android, drone), HP pips, hurt flash and death fade.
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
const D = await import("../sim/dungeon.js" + V);
const { Assets, creatureClips, makeCreature, findArmBones, relaxArms } = await import("./assets.js" + V);

const FLOOR_H = 4.4;
const _eSwing = new THREE.Vector3(); // scratch: enemy right-vector for gait arm-swing

export class EnemyPool {
  constructor(game, root, dungeon) {
    this.g = game;
    this.root = root;
    this.d = dungeon;
    this.views = new Map(); // enemy id → view
  }

  async init(run) {
    this.tpls = await this.g.assets.enemies(this.d.theme);
    for (const e of run.enemies) this._make(e);
  }

  _make(e) {
    const tpl = this.tpls[e.etype] || Object.values(this.tpls)[0];
    if (!tpl) return;
    const grp = new THREE.Group();
    const K = e.K || {};
    const H = { spider: 1.15, drone: 0.95, slime: 1.2, turret: 1.6, imp: 1.35, myconid: 1.45, cyclops: 2.3, blob: 1.5, warbot: 2.1, xeno: 2.3,
                cultist: 1.85, ogre: 2.3, cyborg: 1.9, sentinel: 2.2,
                bat: 0.85, skull: 1.0, wisp: 0.9, frog: 1.1, cactoro: 1.5, gargoyle: 1.7, ninja: 1.8, cthulhu: 2.0, brute: 1.95, yeti: 2.15, giant: 2.6,
                xenosmall: 1.0, floater: 1.1, striker: 2.0, warframe: 2.1, xenobig: 2.25 };
    const h = K.boss ? 2.7 : (H[e.etype] || 1.75);
    const made = makeCreature(this.g.assets, tpl, h, THREE);
    const obj = made.obj;
    grp.add(obj);

    let mixer = made.mixer, actions = {};
    if (mixer && tpl.animations && tpl.animations.length) {
      const clips = creatureClips(tpl.animations);
      for (const k of Object.keys(clips)) if (clips[k]) actions[k] = mixer.clipAction(clips[k]);
    }
    // rigless: procedural bob/hover
    const hover = K.fly || e.etype === "android" || e.etype === "drone";
    if (hover) obj.position.y += 0.9;

    // key badge (carries a bound key)
    if (e.key) {
      const badge = this._emojiSprite("🗝️", 1.0);
      badge.position.y = h + 0.7;
      grp.add(badge);
      grp.userData.badge = badge;
    }
    // hp bar
    const bar = makeBar();
    bar.grp.position.y = h + 0.35;
    grp.add(bar.grp);

    this.root.add(grp);
    const view = { e, grp, obj, mixer, actions, cur: null, oneshotT: 0, hover, bar, dead: false, fade: 1 };
    // Meshy enemies ship walk/run but no idle clip → relax arms to the sides while standing
    if (tpl.meshy) { view.armBones = findArmBones(obj); view.relaxW = 0; }
    if (actions.idle) this._play(view, "idle");
    this.views.set(e.id, view);
    grp.position.set(e.x, e.f * FLOOR_H, e.z);
    return view;
  }

  _emojiSprite(ch, s) {
    const c = document.createElement("canvas"); c.width = c.height = 96;
    const g = c.getContext("2d"); g.font = "72px serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(ch, 48, 54);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    spr.scale.set(s, s, 1);
    return spr;
  }

  _play(v, name, oneshot) {
    const act = v.actions[name] || v.actions.idle;
    if (!act) return;
    if (oneshot) {
      act.reset(); act.setLoop(THREE.LoopOnce); act.clampWhenFinished = true; act.play();
      if (v.cur && v.cur !== act) v.cur.crossFadeTo(act, 0.08, false);
      v.oneshotT = (act.getClip().duration || 0.6) * 0.9;
      v.osAct = act;
      return;
    }
    if (v.cur === act) return;
    act.reset(); act.setLoop(THREE.LoopRepeat); act.play();
    if (v.cur) v.cur.crossFadeTo(act, 0.16, false);
    v.cur = act;
  }

  onHit(ev) {
    const v = this.views.get(ev.id);
    if (!v) return;
    this._play(v, "hit", true);
    // red flash
    v.obj.traverse((m) => {
      if (m.isMesh && m.material && m.material.emissive) {
        m.material = m.material.clone();
        m.material.emissive.set(0xff2222); m.material.emissiveIntensity = 0.9;
        setTimeout(() => { try { m.material.emissiveIntensity = 0; } catch (e) {} }, 130);
      }
    });
  }

  onAttack(ev) {
    const v = this.views.get(ev.id);
    if (v) this._play(v, "attack", true);
  }

  /** Show a status aura on an enemy (burn/frost/poison/stun). */
  setStatus(id, kind, dur) {
    const v = this.views.get(id);
    if (!v) return;
    v.status = v.status || {};
    v.status[kind] = performance.now() / 1000 + (dur || 2);
    if (kind === "frost" && !v.frostTint) {
      // freeze the material to icy blue
      v.frostTint = [];
      v.obj.traverse((m) => { if (m.isMesh && m.material) { const orig = m.material; m.material = m.material.clone(); m.material.color.lerp(new THREE.Color(0x8fd0ff), 0.55); v.frostTint.push([m, orig]); } });
    }
  }

  onDeath(ev) {
    const v = this.views.get(ev.id);
    if (!v || v.dead) return;
    v.dead = true;
    v.bar.grp.visible = false;
    if (v.grp.userData.badge) v.grp.userData.badge.visible = false;
    if (v.actions.death) this._play(v, "death", true);
  }

  update(dt, run, me) {
    const t = performance.now() / 1000;
    for (const e of run.enemies) {
      const v = this.views.get(e.id);
      if (!v) continue;
      // distant enemies: skip skinning/anim cost (they still move via sim)
      const far = me && !v.dead && ((e.x - me.x) ** 2 + (e.z - me.z) ** 2) > 2025;
      if (v.mixer && !far) v.mixer.update(dt);
      if (v.dead) {
        v.fade -= dt * 0.5;
        if (v.fade <= 0) { v.grp.visible = false; continue; }
        if (v.fade < 0.5) v.grp.position.y = e.f * FLOOR_H - (0.5 - v.fade) * 1.6;
        continue;
      }
      const ct = D.cellType(this.d, e.f, Math.floor(e.x / 4), Math.floor(e.z / 4));
      // liquids submerge enemies to chest depth too (matches the player swim)
      const inLiquid = ct === D.CT.WATER || ct === D.CT.LAVA;
      const surfY = D.cellHeight(this.d, e.f, Math.floor(e.x / 4), Math.floor(e.z / 4)) + (inLiquid ? -0.7 : 0);
      v.surfY = v.surfY == null ? surfY : v.surfY + (surfY - v.surfY) * Math.min(1, dt * 10);
      const swimBob = inLiquid && v.surfY < -0.3 ? Math.sin(t * 4.6 + e.x * 2) * 0.06 : 0;
      v.grp.position.set(e.x, e.f * FLOOR_H + v.surfY + swimBob, e.z);
      v.grp.rotation.y = e.yaw;   // creature rigs face +Z = yaw dir (the stray +PI made enemies walk BACKWARDS)
      v.grp.visible = me ? Math.abs(e.f - me.f) <= 1 : true;
      if (far) { v.bar.grp.visible = false; continue; }
      if (v.hover) v.obj.position.y = 0.9 + Math.sin(t * 3 + e.x) * 0.18;
      if (e.etype === "slime" && !v.mixer) v.obj.scale.y = 1 + Math.sin(t * 6) * 0.06;
      // anim state
      if (v.oneshotT > 0) {
        v.oneshotT -= dt;
        if (v.oneshotT <= 0 && v.cur) { v.cur.reset().play(); if (v.osAct) v.osAct.crossFadeTo(v.cur, 0.14, false); }
      } else if (v.actions.walk || v.actions.run) {
        const moving = e.state === "chase" || e.moving;
        const running = moving && e.state === "chase" && v.actions.run;
        this._play(v, moving ? (running ? "run" : "walk") : "idle");
        e.moving = false;
        // Meshy enemies were auto-rigged in an A-pose (arms flung out in every
        // clip). Pull the arms to the sides EVERY frame — idle and while moving —
        // with a procedural gait swing so walking still reads. Fades during
        // attack/hit one-shots so those clips play unmodified.
        if (v.armBones && v.oneshotT <= 0) {
          v.relaxW += (1 - v.relaxW) * Math.min(1, dt * 10);
          if (v.relaxW > 0.02) {
            v.obj.updateMatrixWorld(true);
            relaxArms(v.armBones, v.relaxW);
            if (moving) {
              v.gait = (v.gait || 0) + dt * (running ? 12 : 8);
              const sw = Math.sin(v.gait) * (running ? 0.55 : 0.4) * v.relaxW;
              _eSwing.set(1, 0, 0).applyQuaternion(v.grp.quaternion);
              v.armBones.rArm.rotateOnWorldAxis(_eSwing, sw);  v.armBones.rArm.updateMatrixWorld(true);
              v.armBones.lArm.rotateOnWorldAxis(_eSwing, -sw); v.armBones.lArm.updateMatrixWorld(true);
            }
          }
        }
      }
      // status auras: fire embers / poison bubbles / frost drips / stun stars
      if (v.status) {
        const now = t;
        for (const kind of ["burn", "poison", "frost", "stun"]) {
          if (v.status[kind] && v.status[kind] < now) {
            delete v.status[kind];
            if (kind === "frost" && v.frostTint) { for (const [m, orig] of v.frostTint) m.material = orig; v.frostTint = null; }
            continue;
          }
          if (!v.status[kind]) continue;
          const wp = v.grp.position.clone(); wp.y += 1.0;
          if (kind === "burn" && Math.random() < 0.4) this.g.fx.spawn(wp.add(new THREE.Vector3((Math.random() - .5) * .7, Math.random() * .8, (Math.random() - .5) * .7)), new THREE.Vector3((Math.random() - .5) * .3, 1.4 + Math.random(), (Math.random() - .5) * .3), 0.45, 1.8, Math.random() < .6 ? 0xff6a1f : 0xffc23a);
          if (kind === "poison" && Math.random() < 0.3) this.g.fx.spawn(wp.add(new THREE.Vector3((Math.random() - .5) * .7, Math.random() * .9, (Math.random() - .5) * .7)), new THREE.Vector3((Math.random() - .5) * .2, .6 + Math.random() * .5, (Math.random() - .5) * .2), 0.7, 1.6, 0x8fe04a);
          if (kind === "frost" && Math.random() < 0.2) this.g.fx.spawn(wp.add(new THREE.Vector3((Math.random() - .5) * .6, Math.random() * .8, (Math.random() - .5) * .6)), new THREE.Vector3(0, -0.6, 0), 0.6, 1.4, 0xbfeeff);
        }
      }
      // hp bar faces camera + fills
      const frac = Math.max(0, e.hp / (e.K.hp * (0.85 + 0.15 * (this.d.difficulty || 1))));
      v.bar.set(frac);
      v.bar.grp.visible = frac < 1 && v.grp.visible;
      v.bar.grp.quaternion.copy(this.g.camera.quaternion);
    }
  }
}

function makeBar() {
  const grp = new THREE.Group();
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.14), new THREE.MeshBasicMaterial({ color: 0x111118, transparent: true, opacity: 0.8, depthTest: false }));
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(1.26, 0.1), new THREE.MeshBasicMaterial({ color: 0xff4455, depthTest: false }));
  fill.position.z = 0.001;
  grp.add(back, fill);
  return {
    grp,
    set(frac) {
      fill.scale.x = Math.max(0.001, frac);
      fill.position.x = -(1 - Math.max(0.001, frac)) * 1.26 / 2;
    },
  };
}
