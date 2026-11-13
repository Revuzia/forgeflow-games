// Particles, screen shake, hit-stop, floating combat text
import * as THREE from 'three';
import { createPool } from './pool.js';

export function createFX(scene, camera, renderer) {
  const floatLayer = document.getElementById('float-layer');
  const calloutEl = document.getElementById('callout');
  const bannerEl = document.getElementById('banner');

  let hitstop = 0;
  let shake = 0;
  let shakeMag = 0;
  const particles = [];

  // Particle pool via simple meshes
  const pGeo = new THREE.SphereGeometry(0.08, 4, 4);
  const particlePool = createPool(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(pGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    return {
      mesh,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      maxLife: 1,
      gravity: 0,
    };
  }, 64);

  function spawnParticles(x, y, z, color, count = 10, speed = 4) {
    for (let i = 0; i < count; i++) {
      const p = particlePool.acquire();
      p.mesh.visible = true;
      p.mesh.position.set(x, y, z);
      p.mesh.material.color.setHex(color);
      p.mesh.material.opacity = 1;
      p.mesh.scale.setScalar(0.6 + Math.random() * 1.2);
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random());
      p.vx = Math.cos(a) * sp;
      p.vy = 2 + Math.random() * 4;
      p.vz = Math.sin(a) * sp;
      p.life = 0.3 + Math.random() * 0.5;
      p.maxLife = p.life;
      p.gravity = 10;
    }
  }

  function ringBurst(x, z, color, radius = 2) {
    const geo = new THREE.RingGeometry(0.1, 0.35, 24);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.12, z);
    scene.add(mesh);
    particles.push({
      mesh,
      life: 0.35,
      maxLife: 0.35,
      grow: radius,
      type: 'ring',
    });
  }

  function slashArc(x, z, yaw, color, range = 2.2) {
    const geo = new THREE.RingGeometry(range * 0.4, range, 16, 1, -0.6, 1.2);
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.rotation.z = -yaw + Math.PI / 2;
    mesh.position.set(x, 0.4, z);
    scene.add(mesh);
    particles.push({
      mesh,
      life: 0.18,
      maxLife: 0.18,
      type: 'slash',
    });
  }

  function shockBurst(x, y, z, intensity = 1) {
    spawnParticles(x, y, z, 0xaaddff, Math.floor(12 * intensity), 6 * intensity);
    spawnParticles(x, y, z, 0xffffff, Math.floor(6 * intensity), 4);
    ringBurst(x, z, 0x88ccff, 1.5 * intensity);
  }

  function floatText(sx, sy, text, color = '#fff', size = 18) {
    if (!floatLayer) return;
    const el = document.createElement('div');
    el.className = 'float-txt';
    el.textContent = text;
    el.style.left = sx + 'px';
    el.style.top = sy + 'px';
    el.style.color = color;
    el.style.fontSize = size + 'px';
    floatLayer.appendChild(el);
    setTimeout(() => el.remove(), 950);
  }

  function worldToScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z);
    v.project(camera);
    const halfW = renderer.domElement.clientWidth / 2;
    const halfH = renderer.domElement.clientHeight / 2;
    return {
      x: v.x * halfW + halfW,
      y: -v.y * halfH + halfH,
    };
  }

  function damageNumber(x, y, z, dmg, opts = {}) {
    const s = worldToScreen(x, y + 1.2, z);
    if (s.x < 0 || s.y < 0 || s.x > renderer.domElement.clientWidth) return;
    const col = opts.crit ? '#ff6b35' : opts.heal ? '#6f6' : opts.shock ? '#8cf' : '#fff';
    const prefix = opts.crit ? '' : '';
    floatText(s.x, s.y, prefix + Math.round(dmg), col, opts.crit ? 26 : 18);
  }

  function statusText(x, y, z, label, color) {
    const s = worldToScreen(x, y + 1.5, z);
    floatText(s.x, s.y, label, color, 14);
  }

  function callout(text) {
    if (!calloutEl) return;
    calloutEl.textContent = text;
    calloutEl.classList.add('show');
    clearTimeout(calloutEl._t);
    calloutEl._t = setTimeout(() => calloutEl.classList.remove('show'), 700);
  }

  function banner(text, style = '') {
    if (!bannerEl) return;
    bannerEl.textContent = text;
    bannerEl.className = 'show' + (style ? ' ' + style : '');
    clearTimeout(bannerEl._t);
    bannerEl._t = setTimeout(() => {
      bannerEl.className = '';
    }, 1800);
  }

  function addHitstop(t) {
    hitstop = Math.max(hitstop, t);
  }

  function addShake(mag, dur = 0.2) {
    shake = Math.max(shake, dur);
    shakeMag = Math.max(shakeMag, mag);
  }

  /** Tick VFX + hit-stop; returns sim dt (0 while frozen). Call before gameplay. */
  function beginFrame(dt) {
    // Particles keep moving during hit-stop for juice
    particlePool.forEachAlive((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        p.mesh.visible = false;
        particlePool.release(p);
        return;
      }
      p.vy -= p.gravity * dt;
      p.mesh.position.x += p.vx * dt;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += p.vz * dt;
      p.mesh.material.opacity = Math.max(0, p.life / p.maxLife);
    });

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.type === 'ring') {
        const t = 1 - p.life / p.maxLife;
        const s = 0.2 + t * p.grow;
        p.mesh.scale.set(s, s, s);
        p.mesh.material.opacity = 0.9 * (1 - t);
      } else if (p.type === 'slash') {
        p.mesh.material.opacity = (p.life / p.maxLife) * 0.75;
      }
      if (p.life <= 0) {
        scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        particles.splice(i, 1);
      }
    }

    let simDt = dt;
    if (hitstop > 0) {
      hitstop -= dt;
      simDt = 0;
    }

    if (shake > 0) {
      shake -= dt;
      if (shake <= 0) {
        shake = 0;
        shakeMag = 0;
      }
    }

    return simDt;
  }

  /** Apply camera shake after gameplay has positioned the camera. */
  function applyShake() {
    if (shake <= 0 || shakeMag <= 0) return;
    const m = shakeMag * Math.min(1, shake * 5);
    camera.position.x += (Math.random() - 0.5) * m;
    camera.position.y += (Math.random() - 0.5) * m * 0.5;
    camera.position.z += (Math.random() - 0.5) * m;
  }

  /** @deprecated use beginFrame + applyShake */
  function update(dt, cameraTarget) {
    void cameraTarget;
    const simDt = beginFrame(dt);
    applyShake();
    return simDt;
  }

  function clear() {
    particlePool.forEachAlive((p) => {
      p.mesh.visible = false;
      particlePool.release(p);
    });
    for (const p of particles) {
      scene.remove(p.mesh);
      p.mesh.geometry?.dispose();
      p.mesh.material?.dispose();
    }
    particles.length = 0;
    hitstop = 0;
    shake = 0;
    if (floatLayer) floatLayer.innerHTML = '';
  }

  return {
    spawnParticles,
    ringBurst,
    slashArc,
    shockBurst,
    damageNumber,
    statusText,
    floatText,
    worldToScreen,
    callout,
    banner,
    addHitstop,
    addShake,
    beginFrame,
    applyShake,
    update,
    clear,
    get hitstop() {
      return hitstop;
    },
  };
}
