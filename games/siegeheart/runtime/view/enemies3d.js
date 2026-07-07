// Enemy views: skinned library models w/ animation mixers (procedural fallback
// for the Prime Prism), hp bars, status tints, wreck collapse, orphan sweep.
import * as THREE from 'three';
import { instantiate, getModel, resolveClip } from '../core/assets.js';
import { buildEnemyMesh } from './models.js';

const normCache = new Map();
function normalization(model) {
  if (normCache.has(model)) return normCache.get(model);
  const entry = getModel(model);
  let out = { scale: 1, yOff: 0 };
  if (entry) {
    const box = new THREE.Box3().setFromObject(entry.scene);
    const h = Math.max(0.001, box.max.y - box.min.y);
    const target = 1.5;
    out = { scale: target / h, yOff: -box.min.y * (target / h) };
  }
  normCache.set(model, out);
  return out;
}

function makeHpBar() {
  const c = document.createElement('canvas');
  c.width = 72; c.height = 10;
  const tex = new THREE.CanvasTexture(c);
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  spr.scale.set(1.5, 0.21, 1);
  spr.renderOrder = 50;
  return { spr, c, tex, lastFrac: -1, lastShield: -1 };
}
function drawHpBar(bar, frac, shield) {
  const ctx = bar.c.getContext('2d');
  ctx.clearRect(0, 0, 72, 10);
  ctx.fillStyle = 'rgba(12,10,8,0.85)';
  ctx.fillRect(0, 0, 72, 10);
  ctx.fillStyle = frac > 0.5 ? '#7def56' : frac > 0.25 ? '#e8c84a' : '#e85a4a';
  ctx.fillRect(2, 2, Math.max(0, Math.min(1, frac)) * 68, 6);
  if (shield > 0) { ctx.strokeStyle = '#8fd4ff'; ctx.lineWidth = 2; ctx.strokeRect(1, 1, 70, 8); }
  bar.tex.needsUpdate = true;
}

export function createEnemyLayer(scene) {
  const group = new THREE.Group();
  group.name = 'enemies';
  scene.add(group);
  const views = new Map();
  const wrecks = [];

  function spawn(e) {
    const def = e.def;
    const root = new THREE.Group();
    let mixer = null, action = null, built = null, inst = null;
    if (getModel(def.model)) {
      inst = instantiate(def.model, { tint: def.tint ?? null });
      const norm = normalization(def.model);
      const s = norm.scale * def.scale * (e.elite ? 1.2 : 1);
      inst.obj.scale.setScalar(s);
      inst.obj.position.y = norm.yOff * def.scale * (e.elite ? 1.2 : 1);
      root.add(inst.obj);
      mixer = new THREE.AnimationMixer(inst.obj);
      const clip = resolveClip(inst.animations, def.anim?.move, 'move');
      if (clip) { action = mixer.clipAction(clip); action.play(); }
    } else {
      // procedural fallback (Prime Prism)
      built = buildEnemyMesh(def.model, { tint: def.tint ?? null, scale: def.scale });
      root.add(built.group);
    }
    const bar = makeHpBar();
    bar.spr.position.y = 1.6 * def.scale + (e.flying ? 1.7 : 0.6);
    if (e.boss) bar.spr.scale.set(2.6, 0.3, 1);
    root.add(bar.spr);
    const v = {
      id: e.id, root, inst, built, mixer, action, bar,
      def, flying: e.flying, float: !!def.float, boss: e.boss,
      phase: Math.random() * Math.PI * 2, _lastEmiss: undefined,
    };
    group.add(root);
    views.set(e.id, v);
    return v;
  }

  function killView(id, breached = false) {
    const v = views.get(id);
    if (!v) return;
    views.delete(id);
    v.bar.spr.visible = false;
    if (breached || !v.mixer) {
      wrecks.push({ root: v.root, mixer: null, t: breached ? 0.55 : 0.35, spin: (Math.random() - 0.5) * 2.4 });
      return;
    }
    const deathClip = resolveClip(v.inst.animations, v.def.anim?.death, 'death');
    if (deathClip) {
      v.mixer.stopAllAction();
      const a = v.mixer.clipAction(deathClip);
      a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true;
      a.play();
      v.mixer.timeScale = 1.4;
      wrecks.push({ root: v.root, mixer: v.mixer, t: 0, spin: 0 });
    } else {
      wrecks.push({ root: v.root, mixer: null, t: 0.35, spin: (Math.random() - 0.5) * 2.4 });
    }
  }

  function fadeRoot(root, opacity) {
    root.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      const mats = Array.isArray(n.material) ? n.material : [n.material];
      for (const m of mats) { m.transparent = true; m.opacity = opacity; }
    });
  }

  return {
    group, views,
    sync(sim, dt, t) {
      for (const e of sim.enemies) if (!views.has(e.id)) spawn(e);
      const orphans = [];
      for (const id of views.keys()) if (!sim.enemies.some((x) => x.id === id)) orphans.push(id);
      for (const id of orphans) killView(id);

      for (const [id, v] of views) {
        const e = sim.enemies.find((x) => x.id === id);
        if (!e) continue;
        const p = sim.enemyPos(e);
        const hover = v.flying ? 1.7 + Math.sin(t * 2.6 + v.phase) * 0.14
          : v.float ? 0.4 + Math.sin(t * 2.2 + v.phase) * 0.1 : 0;
        v.root.position.set(p.x, hover, p.z);
        if (p.dx || p.dz) v.root.rotation.y = Math.atan2(p.dx, p.dz);

        // status emissive: stun blue / phys-immune violet / magic-immune orange
        const stunned = sim.time < e.stunUntil;
        const emiss = stunned ? 0x62b8f0
          : sim.time < e.physImmuneUntil ? 0xc8b0ff
          : sim.time < e.magicImmuneUntil ? 0xffb060
          : null;
        if (emiss !== v._lastEmiss) {
          v._lastEmiss = emiss;
          v.root.traverse((n) => {
            if (!n.isMesh || !n.material?.emissive) return;
            const m = n.material;
            if (emiss) { m.emissive.setHex(emiss); m.emissiveIntensity = 0.7; }
            else {
              m.emissive.setHex(m.userData._origEmissiveHex || 0);
              m.emissiveIntensity = m.userData._origEmissive ?? 1;
            }
          });
        }

        const frac = e.hp / e.maxHp;
        if (Math.abs(frac - v.bar.lastFrac) > 0.005 || (e.shieldHits > 0) !== (v.bar.lastShield > 0)) {
          drawHpBar(v.bar, frac, e.shieldHits);
          v.bar.lastFrac = frac; v.bar.lastShield = e.shieldHits;
        }
        v.bar.spr.visible = frac < 0.999 || e.boss || e.shieldHits > 0;

        if (v.mixer) {
          const slowMul = stunned ? 0.05 : (1 - (e.slowPct || 0));
          v.mixer.timeScale = Math.max(0.05, slowMul) * Math.max(0.6, v.def.speed / 3);
          v.mixer.update(dt);
        } else if (v.built) {
          v.built.anim?.(t, e.dist * 4.4 + v.phase);
        }
      }

      for (let i = wrecks.length - 1; i >= 0; i--) {
        const w = wrecks[i];
        w.t += dt;
        w.mixer?.update(dt);
        if (w.spin) w.root.rotation.z += w.spin * dt;
        if (w.t > 0.7) {
          w.root.position.y -= dt * 1.8;
          fadeRoot(w.root, Math.max(0, 1 - (w.t - 0.7) / 0.5));
        }
        if (w.t > 1.25) { group.remove(w.root); wrecks.splice(i, 1); }
      }
    },
    kill: killView,
    clear() {
      views.clear();
      wrecks.length = 0;
      while (group.children.length) group.remove(group.children[0]);
    },
  };
}
