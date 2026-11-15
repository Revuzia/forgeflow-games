// Enemy visuals: skinned clones, mixers, health bars, status FX, deaths.
import * as THREE from 'three';
import { instantiate, getModel, resolveClip } from '../core/assets.js';

const normCache = new Map(); // model -> {scale, yOff}
function normalization(model) {
  if (normCache.has(model)) return normCache.get(model);
  const entry = getModel(model);
  let out = { scale: 1, yOff: 0 };
  if (entry) {
    const box = new THREE.Box3().setFromObject(entry.scene);
    const h = Math.max(0.001, box.max.y - box.min.y);
    const target = 1.5; // base enemy height in world units before def.scale
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
function drawHpBar(bar, frac, shield, boss) {
  const ctx = bar.c.getContext('2d');
  ctx.clearRect(0, 0, 72, 10);
  ctx.fillStyle = 'rgba(10,14,20,0.85)';
  ctx.fillRect(0, 0, 72, 10);
  const w = Math.max(0, Math.min(1, frac)) * 68;
  const g = ctx.createLinearGradient(0, 0, 0, 10);
  const col = frac > 0.5 ? ['#7de f56', '#4aa832'] : frac > 0.25 ? ['#e8c84a', '#b08a2a'] : ['#e85a4a', '#a83a2c'];
  g.addColorStop(0, col[0].replace(' ', '')); g.addColorStop(1, col[1]);
  ctx.fillStyle = g;
  ctx.fillRect(2, 2, w, 6);
  if (shield > 0) {
    ctx.strokeStyle = '#8fd4ff'; ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, 70, 8);
  }
  bar.tex.needsUpdate = true;
}

export function createEnemyLayer(scene) {
  const group = new THREE.Group();
  group.name = 'enemies';
  scene.add(group);
  const views = new Map();   // enemyId -> view
  const corpses = [];

  const iceGeo = new THREE.BoxGeometry(1.1, 1.5, 1.1);
  const iceMat = new THREE.MeshStandardMaterial({ color: 0x9adcff, transparent: true, opacity: 0.55, roughness: 0.1 });
  const bubbleGeo = new THREE.SphereGeometry(1.05, 16, 12);
  const bubbleMat = new THREE.MeshBasicMaterial({ color: 0x8fd4ff, transparent: true, opacity: 0.22, side: THREE.DoubleSide });

  function spawn(e) {
    const def = e.def;
    const inst = instantiate(def.model, { tint: def.tint ?? null });
    if (!inst) return null;
    const norm = normalization(def.model);
    const root = new THREE.Group();
    const s = norm.scale * def.scale * (e.elite ? 1.25 : 1);
    inst.obj.scale.setScalar(s);
    inst.obj.position.y = norm.yOff * def.scale * (e.elite ? 1.25 : 1) / norm.scale * norm.scale;
    root.add(inst.obj);

    const mixer = new THREE.AnimationMixer(inst.obj);
    const moveClip = resolveClip(inst.animations, def.anim?.move, 'move');
    let action = null;
    if (moveClip) {
      action = mixer.clipAction(moveClip);
      action.play();
    }
    const bar = makeHpBar();
    const barH = 1.5 * def.scale * (e.elite ? 1.3 : 1) + (e.flying ? 1.9 : 0.7);
    bar.spr.position.y = barH;
    if (e.boss) bar.spr.scale.set(2.6, 0.3, 1);
    root.add(bar.spr);

    const v = {
      id: e.id, root, inst, mixer, action, bar,
      def, flying: e.flying, float: def.float, boss: e.boss,
      ice: null, bubble: null, baseY: 0, phase: Math.random() * Math.PI * 2,
      dead: false,
    };
    group.add(root);
    views.set(e.id, v);
    return v;
  }

  function ensureIce(v, on) {
    if (on && !v.ice) {
      v.ice = new THREE.Mesh(iceGeo, iceMat);
      v.ice.position.y = 0.8;
      v.root.add(v.ice);
    } else if (!on && v.ice) {
      v.root.remove(v.ice); v.ice = null;
    }
  }
  function ensureBubble(v, on) {
    if (on && !v.bubble) {
      v.bubble = new THREE.Mesh(bubbleGeo, bubbleMat);
      v.bubble.position.y = 0.9;
      v.bubble.scale.setScalar(v.boss ? 1.7 : 1);
      v.root.add(v.bubble);
    } else if (!on && v.bubble) {
      v.root.remove(v.bubble); v.bubble = null;
    }
  }

  // Move a view into the corpse pipeline (death anim -> sink -> fade -> remove).
  function killView(id, leaked = false) {
    const v = views.get(id);
    if (!v) return;
    views.delete(id);
    v.bar.spr.visible = false;
    ensureIce(v, false); ensureBubble(v, false);
    if (leaked) {
      corpses.push({ root: v.root, mixer: null, t: 0.8 });
      return;
    }
    const deathClip = resolveClip(v.inst.animations, v.def.anim?.death, 'death');
    if (deathClip && v.mixer) {
      v.mixer.stopAllAction();
      const a = v.mixer.clipAction(deathClip);
      a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true;
      a.play();
      v.mixer.timeScale = 1.4;
      corpses.push({ root: v.root, mixer: v.mixer, t: 0 });
    } else {
      corpses.push({ root: v.root, mixer: null, t: 0.7 });
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
      // spawn views for new enemies
      for (const e of sim.enemies) {
        if (!views.has(e.id)) spawn(e);
      }
      // orphan sweep: a view whose enemy left the sim without us seeing the
      // death/leak event (e.g. dropped under load) must never linger — bury it.
      const orphans = [];
      for (const id of views.keys()) {
        if (!sim.enemies.some((x) => x.id === id)) orphans.push(id);
      }
      for (const id of orphans) killView(id);
      for (const [id, v] of views) {
        const e = sim.enemies.find((x) => x.id === id);
        if (!e) continue; // death handled by events
        const p = sim.enemyPos(e);
        const hover = v.flying ? 1.7 + Math.sin(t * 3 + v.phase) * 0.15
          : v.float ? 0.45 + Math.sin(t * 2.4 + v.phase) * 0.1 : 0;
        v.root.position.set(p.x, hover, p.z);
        if (p.dx || p.dz) v.root.rotation.y = Math.atan2(p.dx, p.dz);

        const frozen = sim.time < e.freezeUntil || sim.time < e.stunUntil;
        ensureIce(v, sim.time < e.freezeUntil);
        ensureBubble(v, e.shieldHits > 0);
        if (v.bubble) v.bubble.material.opacity = 0.16 + 0.08 * Math.sin(t * 6);

        // tint flash for burn/poison via per-instance emissive (restores native glow after)
        const burning = !!e.burn;
        const poisoned = e.poisons.length > 0;
        v.inst.obj.traverse((n) => {
          if (!n.isMesh || !n.material?.emissive) return;
          const m = n.material;
          if (burning) { m.emissive.setHex(0xff5a14); m.emissiveIntensity = 0.45 + 0.2 * Math.sin(t * 12); }
          else if (poisoned) { m.emissive.setHex(0x66c828); m.emissiveIntensity = 0.35; }
          else if (sim.time < e.etherealUntil) { m.emissive.setHex(0x8fb8ff); m.emissiveIntensity = 0.6; }
          else {
            m.emissive.setHex(m.userData._origEmissiveHex || 0);
            m.emissiveIntensity = m.userData._origEmissive ?? 1;
          }
        });
        if (sim.time < e.etherealUntil || v.def.model === 'ghost' || v.def.model === 'lich_skull') {
          v.inst.obj.traverse((n) => { if (n.isMesh) { n.material.transparent = true; n.material.opacity = sim.time < e.etherealUntil ? 0.45 : 0.85; } });
        }

        // hp bar
        const frac = e.hp / e.maxHp;
        if (Math.abs(frac - v.bar.lastFrac) > 0.005 || (e.shieldHits > 0) !== (v.bar.lastShield > 0)) {
          drawHpBar(v.bar, frac, e.shieldHits, e.boss);
          v.bar.lastFrac = frac; v.bar.lastShield = e.shieldHits;
        }
        v.bar.spr.visible = frac < 0.999 || e.boss || e.shieldHits > 0;

        // animation speed reflects actual movement
        if (v.action) {
          const slowMul = frozen ? 0 : (1 - (e.slowPct || 0));
          v.mixer.timeScale = Math.max(0.001, slowMul) * (v.def.speed / 3);
        }
        v.mixer.update(dt);
      }
      // corpses: brief death pose, then sink + fade out and remove
      for (let i = corpses.length - 1; i >= 0; i--) {
        const c = corpses[i];
        c.t += dt;
        c.mixer?.update(dt);
        if (c.t > 0.7) {
          c.root.position.y -= dt * 1.8;
          fadeRoot(c.root, Math.max(0, 1 - (c.t - 0.7) / 0.5));
        }
        if (c.t > 1.25) {
          group.remove(c.root);
          corpses.splice(i, 1);
        }
      }
    },

    // Called from death/leak events (and internally by the orphan sweep).
    kill: killView,

    clear() {
      views.clear();
      corpses.length = 0;
      while (group.children.length) group.remove(group.children[0]);
    },
  };
}
