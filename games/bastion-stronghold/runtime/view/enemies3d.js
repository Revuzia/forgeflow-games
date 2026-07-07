// Enemy construct views: procedural animation (no skeletal mixers), hp bars,
// status tints, death-collapse, orphan sweep.
import * as THREE from 'three';
import { buildEnemyMesh } from './models.js';

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
  const w = Math.max(0, Math.min(1, frac)) * 68;
  ctx.fillStyle = frac > 0.5 ? '#7def56' : frac > 0.25 ? '#e8c84a' : '#e85a4a';
  ctx.fillRect(2, 2, w, 6);
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
    const built = buildEnemyMesh(e.def.model, { tint: e.def.tint ?? null, scale: e.def.scale * (e.elite ? 1.2 : 1) });
    const root = new THREE.Group();
    root.add(built.group);
    const bar = makeHpBar();
    bar.spr.position.y = 1.6 * e.def.scale + (e.flying ? 1.6 : 0.6);
    if (e.boss) bar.spr.scale.set(2.6, 0.3, 1);
    root.add(bar.spr);
    const v = {
      id: e.id, root, built, bar, def: e.def, flying: e.flying, boss: e.boss,
      phase: Math.random() * Math.PI * 2, lastDist: e.dist,
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
    wrecks.push({ root: v.root, t: breached ? 0.6 : 0, spin: (Math.random() - 0.5) * 3 });
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
        const fly = v.flying ? 1.6 + Math.sin(t * 2.6 + v.phase) * 0.14 : 0;
        v.root.position.set(p.x, fly, p.z);
        if (p.dx || p.dz) v.root.rotation.y = Math.atan2(p.dx, p.dz);
        // gait phase from distance traveled
        const ph = e.dist * 4.4 + v.phase;
        v.built.anim?.(t, ph);
        // status tint: stun = blue flicker, slow = frost hint, phase-immune glow
        const stunned = sim.time < e.stunUntil;
        const emiss = stunned ? 0x62b8f0
          : sim.time < e.physImmuneUntil ? 0xc8b0ff
          : sim.time < e.magicImmuneUntil ? 0xffb060
          : null;
        if (emiss !== v._lastEmiss) {
          v._lastEmiss = emiss;
          v.built.group.traverse((n) => {
            if (!n.isMesh || !n.material?.emissive) return;
            if (!n.userData._oe) n.userData._oe = { c: n.material.emissive.getHex(), i: n.material.emissiveIntensity ?? 0 };
            if (emiss) {
              n.material = n.material.clone();
              n.material.emissive.setHex(emiss);
              n.material.emissiveIntensity = 0.7;
            } else {
              n.material.emissive.setHex(n.userData._oe.c);
              n.material.emissiveIntensity = n.userData._oe.i;
            }
          });
        }
        const frac = e.hp / e.maxHp;
        if (Math.abs(frac - v.bar.lastFrac) > 0.005 || (e.shieldHits > 0) !== (v.bar.lastShield > 0)) {
          drawHpBar(v.bar, frac, e.shieldHits);
          v.bar.lastFrac = frac; v.bar.lastShield = e.shieldHits;
        }
        v.bar.spr.visible = frac < 0.999 || e.boss || e.shieldHits > 0;
      }

      // construct wrecks: crumple, sink, gone
      for (let i = wrecks.length - 1; i >= 0; i--) {
        const w = wrecks[i];
        w.t += dt;
        w.root.rotation.z += w.spin * dt;
        w.root.scale.multiplyScalar(Math.max(0.0001, 1 - dt * 1.6));
        w.root.position.y -= dt * 0.8;
        if (w.t > 0.8) { group.remove(w.root); wrecks.splice(i, 1); }
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
