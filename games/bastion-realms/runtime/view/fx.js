// FX layer: pooled particles, lightning beams, explosion rings, damage numbers,
// ambient biome particles. All pooled — zero allocation during steady gameplay.
import * as THREE from 'three';
import { spriteTexture } from '../core/assets.js';

const STYLES = {
  ember:  { color: '#ff8c3a', size: 0.5 },
  flame:  { color: '#ffb24a', size: 0.62 },
  spark:  { color: '#9adcff', size: 0.4 },
  ice:    { color: '#c2ecff', size: 0.45 },
  poison: { color: '#8fd435', size: 0.55 },
  smoke:  { color: '#8a8a92', size: 0.9 },
  gold:   { color: '#ffd76a', size: 0.42 },
  star:   { color: '#b89aff', size: 0.45 },
  blood:  { color: '#c8544a', size: 0.42 },
  heal:   { color: '#7dec6a', size: 0.5 },
};

class ParticlePool {
  constructor(scene, style, n = 320) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.sizeMul = new Float32Array(n).fill(1);
    this.alive = 0;
    this.cursor = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo = geo;
    this.mat = new THREE.PointsMaterial({
      map: spriteTexture(STYLES[style].color),
      color: 0xffffff, size: STYLES[style].size, sizeAttenuation: true,
      transparent: true, opacity: 0.95, depthWrite: false, fog: false,
      blending: style === 'smoke' ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    scene.add(this.points);
    // park all offscreen
    for (let i = 0; i < n; i++) { this.pos[i * 3 + 1] = -999; this.life[i] = 0; }
  }
  burst(x, y, z, count, { spread = 0.6, vel = 2.4, up = 2.2, life = 0.7, jitter = 0.5, sizeMul = 1 } = {}) {
    for (let c = 0; c < count; c++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      this.pos[i * 3] = x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = y + (Math.random() - 0.5) * spread * 0.5;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
      const a = Math.random() * Math.PI * 2;
      const v = vel * (0.4 + Math.random() * 0.8);
      this.vel[i * 3] = Math.cos(a) * v;
      this.vel[i * 3 + 1] = up * (0.5 + Math.random() * jitter);
      this.vel[i * 3 + 2] = Math.sin(a) * v;
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.7);
      this.sizeMul[i] = sizeMul;
    }
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3 + 1] -= 4.5 * dt; // gravity-ish
    }
    if (any) this.geo.attributes.position.needsUpdate = true;
  }
}

// ---------- lightning ----------
class BeamPool {
  constructor(scene, n = 14) {
    this.beams = [];
    for (let i = 0; i < n; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 40), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x9adcff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.renderOrder = 25;
      scene.add(line);
      this.beams.push({ line, t: 0, active: false });
    }
    this.cursor = 0;
  }
  spawn(points, color = 0x9adcff) {
    const b = this.beams[this.cursor];
    this.cursor = (this.cursor + 1) % this.beams.length;
    const pos = b.line.geometry.attributes.position;
    let vi = 0;
    for (let i = 0; i < points.length - 1 && vi < 39; i++) {
      const a = points[i], c = points[i + 1];
      const segs = 4;
      for (let s = 0; s <= segs && vi < 40; s++) {
        const t = s / segs;
        const jx = (s > 0 && s < segs) ? (Math.random() - 0.5) * 0.55 : 0;
        const jz = (s > 0 && s < segs) ? (Math.random() - 0.5) * 0.55 : 0;
        pos.setXYZ(vi++,
          a.x + (c.x - a.x) * t + jx,
          (a.y ?? 1.4) + ((c.y ?? 1.0) - (a.y ?? 1.4)) * t + Math.random() * 0.3,
          a.z + (c.z - a.z) * t + jz);
      }
    }
    b.line.geometry.setDrawRange(0, vi);
    pos.needsUpdate = true;
    b.line.material.color.setHex(color);
    b.line.material.opacity = 0.95;
    b.t = 0.22; b.active = true;
  }
  update(dt) {
    for (const b of this.beams) {
      if (!b.active) continue;
      b.t -= dt;
      b.line.material.opacity = Math.max(0, b.t / 0.22) * 0.95;
      if (b.t <= 0) { b.active = false; b.line.geometry.setDrawRange(0, 0); }
    }
  }
}

// ---------- expanding rings ----------
class RingPool {
  constructor(scene, n = 10) {
    this.rings = [];
    const geo = new THREE.RingGeometry(0.85, 1, 28);
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffb24a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false });
      const m = new THREE.Mesh(geo, mat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 15;
      scene.add(m);
      this.rings.push({ m, t: 0, dur: 0.4, maxR: 2.5, active: false });
    }
    this.cursor = 0;
  }
  spawn(x, z, maxR, color = 0xffb24a, dur = 0.45) {
    const r = this.rings[this.cursor];
    this.cursor = (this.cursor + 1) % this.rings.length;
    r.m.position.set(x, 0.12, z);
    r.m.material.color.setHex(color);
    r.t = 0; r.dur = dur; r.maxR = maxR; r.active = true; r.m.visible = true;
  }
  update(dt) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.t += dt;
      const k = Math.min(1, r.t / r.dur);
      r.m.scale.setScalar(0.2 + k * r.maxR);
      r.m.material.opacity = (1 - k) * 0.85;
      if (k >= 1) { r.active = false; r.m.visible = false; }
    }
  }
}

// ---------- damage numbers ----------
class NumberPool {
  constructor(scene, n = 44) {
    this.items = [];
    for (let i = 0; i < n; i++) {
      const c = document.createElement('canvas');
      c.width = 128; c.height = 48;
      const tex = new THREE.CanvasTexture(c);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, opacity: 0 }));
      spr.scale.set(1.9, 0.72, 1);
      spr.renderOrder = 60;
      spr.visible = false;
      scene.add(spr);
      this.items.push({ spr, c, tex, t: 0, active: false });
    }
    this.cursor = 0;
  }
  spawn(x, y, z, text, color = '#ffe9b0', big = false) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    const ctx = it.c.getContext('2d');
    ctx.clearRect(0, 0, 128, 48);
    ctx.font = `bold ${big ? 34 : 26}px "Segoe UI", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.lineWidth = 5;
    ctx.strokeText(text, 64, 24);
    ctx.fillStyle = color;
    ctx.fillText(text, 64, 24);
    it.tex.needsUpdate = true;
    it.spr.position.set(x + (Math.random() - 0.5) * 0.5, y, z);
    it.spr.scale.set(big ? 2.6 : 1.9, big ? 1.0 : 0.72, 1);
    it.t = 0; it.active = true; it.spr.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      it.spr.position.y += dt * 1.5;
      it.spr.material.opacity = it.t < 0.1 ? it.t / 0.1 : Math.max(0, 1 - (it.t - 0.45) / 0.5);
      if (it.t > 0.95) { it.active = false; it.spr.visible = false; }
    }
  }
}

// ---------- ambient biome particles ----------
class Ambient {
  constructor(scene, kind, rngSeedless = Math.random) {
    this.kind = kind;
    const conf = {
      fireflies: { n: 60, color: '#d8f078', size: 0.32, op: 0.8 },
      embers:    { n: 90, color: '#ff9a3a', size: 0.3, op: 0.9 },
      snow:      { n: 220, color: '#ffffff', size: 0.3, op: 0.85 },
      ghostlights: { n: 40, color: '#9fe8b8', size: 0.5, op: 0.55 },
      stardust:  { n: 160, color: '#c9b8ff', size: 0.28, op: 0.8 },
    }[kind];
    this.conf = conf;
    this.pos = new Float32Array(conf.n * 3);
    this.phase = new Float32Array(conf.n);
    for (let i = 0; i < conf.n; i++) {
      this.pos[i * 3] = (Math.random() - 0.5) * 44;
      this.pos[i * 3 + 1] = Math.random() * 9 + 0.5;
      this.pos[i * 3 + 2] = (Math.random() - 0.5) * 30;
      this.phase[i] = Math.random() * Math.PI * 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: spriteTexture(conf.color), size: conf.size, transparent: true, opacity: conf.op,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false,
    }));
    this.points.frustumCulled = false;
    this.geo = geo;
    scene.add(this.points);
  }
  update(dt, t) {
    const { n } = this.conf;
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      if (this.kind === 'snow') {
        this.pos[k + 1] -= dt * (1.1 + Math.sin(this.phase[i]) * 0.3);
        this.pos[k] += Math.sin(t * 0.8 + this.phase[i]) * dt * 0.7;
        if (this.pos[k + 1] < 0.1) this.pos[k + 1] = 9;
      } else if (this.kind === 'embers') {
        this.pos[k + 1] += dt * (0.8 + Math.sin(this.phase[i]) * 0.4);
        this.pos[k] += Math.sin(t * 1.4 + this.phase[i]) * dt * 0.5;
        if (this.pos[k + 1] > 9) this.pos[k + 1] = 0.2;
      } else if (this.kind === 'fireflies' || this.kind === 'ghostlights') {
        this.pos[k] += Math.sin(t * 0.7 + this.phase[i]) * dt * 0.8;
        this.pos[k + 1] += Math.cos(t * 0.5 + this.phase[i] * 2) * dt * 0.4;
        this.pos[k + 2] += Math.cos(t * 0.6 + this.phase[i]) * dt * 0.8;
        if (this.pos[k + 1] < 0.3) this.pos[k + 1] = 0.3;
        if (this.pos[k + 1] > 7) this.pos[k + 1] = 7;
      } else { // stardust
        this.pos[k] += dt * 0.5;
        this.pos[k + 1] += Math.sin(t + this.phase[i]) * dt * 0.2;
        if (this.pos[k] > 23) this.pos[k] = -23;
      }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.points); this.geo.dispose(); this.points.material.dispose(); }
}

export function createFx(scene, biome) {
  const pools = {};
  for (const s of Object.keys(STYLES)) pools[s] = new ParticlePool(scene, s, s === 'smoke' ? 220 : 320);
  const beams = new BeamPool(scene);
  const rings = new RingPool(scene);
  const numbers = new NumberPool(scene);
  const ambient = biome.particles ? new Ambient(scene, biome.particles) : null;

  return {
    pools, beams, rings, numbers,
    burst(style, x, y, z, count, opts) { pools[style]?.burst(x, y, z, count, opts); },
    lightning(points, color) { beams.spawn(points, color); },
    ring(x, z, r, color, dur) { rings.spawn(x, z, r, color, dur); },
    number(x, y, z, text, color, big) { numbers.spawn(x, y, z, text, color, big); },
    update(dt, t) {
      for (const p of Object.values(pools)) p.update(dt);
      beams.update(dt); rings.update(dt); numbers.update(dt);
      ambient?.update(dt, t);
    },
  };
}
