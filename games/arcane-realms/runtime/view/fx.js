// Arcane Realms TCG — particle & visual-effects system.
// One pooled THREE.Points cloud (soft-sprite, additive) + ring shockwaves.
// Cheap enough for hundreds of live particles; density scales with settings.

import * as THREE from 'three';

const MAX_P = 900;

function makeSpriteTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.density = 1.0; // settings: 0.4 low / 1.0 high
    this.pos = new Float32Array(MAX_P * 3);
    this.col = new Float32Array(MAX_P * 3);
    this.size = new Float32Array(MAX_P);
    this.vel = new Float32Array(MAX_P * 3);
    this.life = new Float32Array(MAX_P);   // remaining
    this.life0 = new Float32Array(MAX_P);  // initial
    this.grav = new Float32Array(MAX_P);
    this.drag = new Float32Array(MAX_P);
    this.baseSize = new Float32Array(MAX_P);
    this.head = 0;
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeSpriteTex() } },
      vertexShader: `
        attribute float size;
        varying vec3 vColor;
        void main(){
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (240.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec3 vColor;
        void main(){
          vec4 tex = texture2D(map, gl_PointCoord);
          gl_FragColor = vec4(vColor, 1.0) * tex;
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 50;
    scene.add(this.points);

    // ring shockwaves
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.42, 0.5, 48);
    // persistent emitters (legendary auras): {pos, color, rate, acc}
    this.emitters = new Map();
  }

  spawn(p, v, color, size, life, grav = 0, drag = 0.99) {
    const i = this.head;
    this.head = (this.head + 1) % MAX_P;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    const c = new THREE.Color(color);
    this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    this.baseSize[i] = size;
    this.size[i] = size;
    this.life[i] = life; this.life0[i] = life;
    this.grav[i] = grav; this.drag[i] = drag;
  }

  burst(pos, color, { n = 24, speed = 2.2, size = 0.42, life = 0.7, up = 0.6, grav = -2.2, spread = 1 } = {}) {
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.4 + Math.random() * 0.6) * speed;
      this.spawn(
        pos,
        new THREE.Vector3(Math.cos(a) * r * spread, up * (0.5 + Math.random()), Math.sin(a) * r * spread),
        color, size * (0.7 + Math.random() * 0.7), life * (0.7 + Math.random() * 0.6), grav);
    }
  }

  fountain(pos, color, { n = 16, size = 0.3, life = 0.9 } = {}) {
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) {
      this.spawn(
        new THREE.Vector3(pos.x + (Math.random() - 0.5) * 0.8, pos.y, pos.z + (Math.random() - 0.5) * 0.8),
        new THREE.Vector3((Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4),
        color, size, life, -0.4);
    }
  }

  ring(pos, color, { maxR = 2.2, dur = 0.55, y = 0.06 } = {}) {
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.9, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(this.ringGeo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, y + pos.y, pos.z);
    m.renderOrder = 40;
    this.scene.add(m);
    this.rings.push({ m, t: 0, dur, maxR });
  }

  beam(from, to, color, { n = 26, size = 0.3, life = 0.4 } = {}) {
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) {
      const f = i / n;
      const p = new THREE.Vector3().lerpVectors(from, to, f);
      p.y += Math.sin(f * Math.PI) * 0.7;
      this.spawn(p, new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.5, (Math.random() - 0.5) * 0.5),
        color, size, life + f * 0.25, 0);
    }
  }

  snow(pos, { n = 14 } = {}) { // freeze flakes drift down
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) {
      this.spawn(
        new THREE.Vector3(pos.x + (Math.random() - 0.5) * 1.1, pos.y + 1.2 + Math.random() * 0.5, pos.z + (Math.random() - 0.5) * 1.1),
        new THREE.Vector3((Math.random() - 0.5) * 0.2, -0.7 - Math.random() * 0.4, (Math.random() - 0.5) * 0.2),
        0x9fdcff, 0.26, 1.1, 0, 0.995);
    }
  }

  setEmitter(key, pos, color, rate = 6) {
    this.emitters.set(key, { pos: pos.clone(), color, rate, acc: 0 });
  }
  moveEmitter(key, pos) {
    const e = this.emitters.get(key);
    if (e) e.pos.copy(pos);
  }
  clearEmitter(key) { this.emitters.delete(key); }

  update(dt) {
    // particles
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) { this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.life0[i]);
      this.vel[i * 3 + 1] += this.grav[i] * dt;
      this.vel[i * 3] *= this.drag[i]; this.vel[i * 3 + 1] *= this.drag[i]; this.vel[i * 3 + 2] *= this.drag[i];
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = this.baseSize[i] * k;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const f = r.t / r.dur;
      if (f >= 1) { this.scene.remove(r.m); r.m.material.dispose(); this.rings.splice(i, 1); continue; }
      const s = 0.2 + f * r.maxR;
      r.m.scale.set(s, s, s);
      r.m.material.opacity = 0.9 * (1 - f);
    }
    // emitters (legendary idle auras)
    for (const e of this.emitters.values()) {
      e.acc += dt * e.rate * this.density;
      while (e.acc >= 1) {
        e.acc -= 1;
        this.spawn(
          new THREE.Vector3(e.pos.x + (Math.random() - 0.5) * 1.15, e.pos.y + 0.05, e.pos.z + (Math.random() - 0.5) * 1.6),
          new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.5 + Math.random() * 0.5, (Math.random() - 0.5) * 0.15),
          e.color, 0.22, 1.3, 0, 0.99);
      }
    }
  }
}
