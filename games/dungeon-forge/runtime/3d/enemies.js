/**
 * Dungeon Forge — runtime/3d/enemies.js
 * Visual layer for sim enemies: skinned GLB clones with animation mixers
 * (idle/walk/attack/death per Quaternius clip names), procedural hover for
 * rigless models (android, drone), HP pips, hurt flash and death fade.
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
const D = await import("../sim/dungeon.js" + V);
const { Assets, creatureClips, makeCreature } = await import("./assets.js" + V);

const FLOOR_H = 4.4;

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
    const h = K.boss ? 2.7 : e.etype === "spider" ? 1.15 : e.etype === "drone" ? 0.95 : e.etype === "slime" ? 1.2 : e.etype === "turret" ? 1.6 : 1.75;
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
      if (v.mixer) v.mixer.update(dt);
      if (v.dead) {
        v.fade -= dt * 0.5;
        if (v.fade <= 0) { v.grp.visible = false; continue; }
        if (v.fade < 0.5) v.grp.position.y = e.f * FLOOR_H - (0.5 - v.fade) * 1.6;
        continue;
      }
      v.grp.position.set(e.x, e.f * FLOOR_H, e.z);
      v.grp.rotation.y = e.yaw + Math.PI;
      v.grp.visible = me ? Math.abs(e.f - me.f) <= 1 : true;
      if (v.hover) v.obj.position.y = 0.9 + Math.sin(t * 3 + e.x) * 0.18;
      if (e.etype === "slime" && !v.mixer) v.obj.scale.y = 1 + Math.sin(t * 6) * 0.06;
      // anim state
      if (v.oneshotT > 0) {
        v.oneshotT -= dt;
        if (v.oneshotT <= 0 && v.cur) { v.cur.reset().play(); if (v.osAct) v.osAct.crossFadeTo(v.cur, 0.14, false); }
      } else if (v.actions.walk || v.actions.run) {
        const moving = e.state === "chase" || e.moving;
        this._play(v, moving ? (e.state === "chase" && v.actions.run ? "run" : "walk") : "idle");
        e.moving = false;
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
