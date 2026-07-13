// Arcane Realms TCG — particle & visual-effects system.
// One pooled THREE.Points cloud (soft-sprite, additive) + ring shockwaves.
// Cheap enough for hundreds of live particles; density scales with settings.

import * as THREE from 'three';

const MAX_P = 900;

// 4-cell shape atlas — every particle picks a silhouette, so each element has
// its own matter: 0 soft dot (smoke/wisps), 1 four-point spark (fire/light),
// 2 leaf (nature), 3 ice crystal (frost). Shapes keep a safe margin so rotated
// point-sprites never bleed into the neighboring cell.
export const P_DOT = 0, P_SPARK = 1, P_LEAF = 2, P_ICE = 3;
function makeSpriteTex() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  // cell 0 — soft dot
  let grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  // cell 1 — four-point spark (star with a hot core)
  g.save(); g.translate(96, 32);
  grad = g.createRadialGradient(0, 0, 0, 0, 0, 26);
  grad.addColorStop(0, 'rgba(255,255,255,.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fillRect(-26, -26, 52, 52);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.beginPath();
  g.moveTo(0, -26); g.quadraticCurveTo(3.5, -3.5, 26, 0); g.quadraticCurveTo(3.5, 3.5, 0, 26);
  g.quadraticCurveTo(-3.5, 3.5, -26, 0); g.quadraticCurveTo(-3.5, -3.5, 0, -26);
  g.closePath(); g.fill();
  g.restore();
  // cell 2 — leaf (pointed teardrop + vein)
  g.save(); g.translate(160, 32);
  g.fillStyle = 'rgba(255,255,255,.95)';
  g.beginPath();
  g.moveTo(0, -24); g.quadraticCurveTo(15, -8, 0, 24); g.quadraticCurveTo(-15, -8, 0, -24);
  g.closePath(); g.fill();
  g.strokeStyle = 'rgba(120,120,120,.8)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, -20); g.lineTo(0, 20); g.stroke();
  g.restore();
  // cell 3 — six-arm ice crystal
  g.save(); g.translate(224, 32);
  g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 3.4; g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    g.save(); g.rotate((i * Math.PI) / 3);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -22);
    g.moveTo(0, -13); g.lineTo(6, -18); g.moveTo(0, -13); g.lineTo(-6, -18);
    g.stroke(); g.restore();
  }
  g.restore();
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
    this.cell = new Float32Array(MAX_P);   // atlas shape (P_DOT/P_SPARK/P_LEAF/P_ICE)
    this.rot = new Float32Array(MAX_P);    // sprite rotation
    this.spin = new Float32Array(MAX_P);   // rotation speed (leaves flutter, flakes twirl)
    this.head = 0;
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    geo.setAttribute('acell', new THREE.BufferAttribute(this.cell, 1));
    geo.setAttribute('arot', new THREE.BufferAttribute(this.rot, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: makeSpriteTex() } },
      vertexShader: `
        attribute float size;
        attribute float acell;
        attribute float arot;
        varying vec3 vColor;
        varying float vCell;
        varying float vRot;
        void main(){
          vColor = color;
          vCell = acell;
          vRot = arot;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * (240.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D map;
        varying vec3 vColor;
        varying float vCell;
        varying float vRot;
        void main(){
          // rotate the sprite around its center, then map into its atlas cell
          vec2 p = gl_PointCoord - 0.5;
          float c = cos(vRot), s = sin(vRot);
          vec2 q = vec2(c*p.x - s*p.y, s*p.x + c*p.y) + 0.5;
          q = clamp(q, 0.02, 0.98);
          vec4 tex = texture2D(map, vec2((q.x + vCell) * 0.25, q.y));
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

  spawn(p, v, color, size, life, grav = 0, drag = 0.99, cell = 0, spin = 0) {
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
    this.cell[i] = cell;
    this.rot[i] = spin ? Math.random() * Math.PI * 2 : 0;
    this.spin[i] = spin ? (Math.random() - 0.5) * 2 * spin : 0;
  }

  burst(pos, color, { n = 24, speed = 2.2, size = 0.42, life = 0.7, up = 0.6, grav = -2.2, spread = 1, cell = 0, spin = 0 } = {}) {
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.4 + Math.random() * 0.6) * speed;
      this.spawn(
        pos,
        new THREE.Vector3(Math.cos(a) * r * spread, up * (0.5 + Math.random()), Math.sin(a) * r * spread),
        color, size * (0.7 + Math.random() * 0.7), life * (0.7 + Math.random() * 0.6), grav, 0.99, cell, spin);
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

  snow(pos, { n = 14 } = {}) { // freeze crystals twirl down
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) {
      this.spawn(
        new THREE.Vector3(pos.x + (Math.random() - 0.5) * 1.1, pos.y + 1.2 + Math.random() * 0.5, pos.z + (Math.random() - 0.5) * 1.1),
        new THREE.Vector3((Math.random() - 0.5) * 0.2, -0.7 - Math.random() * 0.4, (Math.random() - 0.5) * 0.2),
        0x9fdcff, 0.3, 1.1, 0, 0.995, P_ICE, 1.6);
    }
  }

  // grove signature: leaves burst out and FLUTTER down, spinning as they fall
  leaves(pos, { n = 18, speed = 1.8, up = 1.4 } = {}) {
    n = Math.round(n * this.density);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.3 + Math.random() * 0.7) * speed;
      this.spawn(
        pos,
        new THREE.Vector3(Math.cos(a) * r, up * (0.5 + Math.random()), Math.sin(a) * r),
        Math.random() < 0.7 ? 0x54d06a : 0xa8e06a,
        0.38 * (0.7 + Math.random() * 0.7), 1.0 + Math.random() * 0.5, -1.3, 0.962, P_LEAF, 3.2);
    }
  }

  // ── spell choreography ─────────────────────────────────────────
  // A comet-style projectile that arcs from → to, trailing particles, then
  // detonates. Resolves AT IMPACT so damage numbers land with the hit.
  projectile(from, to, { color = 0xff7a3d, coreColor = 0xffe9a8, size = 0.55, dur = 0.42, trail = 150, arc = 1.6 } = {}) {
    return new Promise((resolve) => {
      this._projectiles = this._projectiles || [];
      const ctrl = from.clone().lerp(to, 0.5).add(new THREE.Vector3(0, arc, 0));
      // traveling light sells the comet — the board glows under its path
      const light = new THREE.PointLight(color, 16, 8, 2);
      light.position.copy(from);
      this.scene.add(light);
      this._projectiles.push({ t: 0, dur, from: from.clone(), ctrl, to: to.clone(), color, coreColor, size, trail, light, resolve });
    });
  }

  explosion(pos, color, { big = false } = {}) {
    const s = big ? 1.6 : 1;
    this.burst(pos, 0xffffff, { n: 10 * s, speed: 1.2, size: 0.8 * s, life: 0.18, up: 0.2, grav: 0 });
    // fire matter: spinning SPARKS fly out, embers rise off the blast
    this.burst(pos, color, { n: 34 * s, speed: 3.2 * s, size: 0.5, life: 0.75, up: 0.9, grav: -2.6, cell: P_SPARK, spin: 5 });
    this.burst(pos, 0xffd45f, { n: 12 * s, speed: 1.4, size: 0.3, life: 1.0, up: 2.2, grav: 0.5, cell: P_SPARK, spin: 3 });
    this.burst(pos, 0x2a2a2a, { n: 14 * s, speed: 1.1, size: 0.65, life: 1.1, up: 1.4, grav: -0.4 }); // smoke
    this.ring(pos, color, { maxR: big ? 3.2 : 2.1, dur: big ? 0.6 : 0.45 });
  }

  frostNova(pos, { big = false } = {}) {
    const s = big ? 1.5 : 1;
    // ice matter: crystalline shards + twirling flakes
    this.burst(pos, 0x9fdcff, { n: 26 * s, speed: 2.4 * s, size: 0.44, life: 0.7, up: 0.4, grav: -1.2, cell: P_ICE, spin: 2.4 });
    this.burst(pos, 0xe8f8ff, { n: 12 * s, speed: 0.8, size: 0.6, life: 0.5, up: 0.6, grav: 0 });
    this.ring(pos, 0x7fd0ff, { maxR: 2.4 * s, dur: 0.55 });
    this.snow(pos, { n: 18 * s });
  }

  holyPillar(pos) {
    // column of light: stacked rising star-motes + double ring
    for (let i = 0; i < 26 * this.density; i++) {
      this.spawn(
        new THREE.Vector3(pos.x + (Math.random() - 0.5) * 0.7, pos.y + Math.random() * 0.3, pos.z + (Math.random() - 0.5) * 0.7),
        new THREE.Vector3((Math.random() - 0.5) * 0.1, 2.4 + Math.random() * 1.6, (Math.random() - 0.5) * 0.1),
        0xffe9a8, 0.4, 0.9, 0, 0.985, P_SPARK, 0.8);
    }
    this.ring(pos, 0xffd45f, { maxR: 1.8, dur: 0.5 });
    this.ring(pos, 0xfff3c9, { maxR: 1.1, dur: 0.7 });
  }

  shadowRend(pos, { big = false } = {}) {
    const s = big ? 1.5 : 1;
    // implosion: smoky wisps rush INWARD then burst up with a few dark sparks
    for (let i = 0; i < 30 * s * this.density; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 1.4 + Math.random() * 0.8;
      const p = new THREE.Vector3(pos.x + Math.cos(a) * r, pos.y + 0.2 + Math.random() * 0.6, pos.z + Math.sin(a) * r);
      const v = pos.clone().sub(p).multiplyScalar(2.6);
      this.spawn(p, v, 0x8a3fd4, 0.4, 0.45, 0, 0.97);
    }
    setTimeout(() => {
      this.burst(pos, 0xb44fe8, { n: 20 * s, speed: 2.2, size: 0.42, life: 0.6, up: 1.4 });
      this.burst(pos, 0xd88fff, { n: 8 * s, speed: 1.6, size: 0.34, life: 0.7, up: 1.8, cell: P_SPARK, spin: 4 });
    }, 240);
    this.ring(pos, 0x8a3fd4, { maxR: 2.2 * s, dur: 0.5 });
  }

  natureBurst(pos, { big = false } = {}) {
    const s = big ? 1.5 : 1;
    // nature matter: real LEAVES flutter out and drift down
    this.leaves(pos, { n: 22 * s, speed: 2.0, up: 1.5 });
    this.burst(pos, 0xa8e06a, { n: 10 * s, speed: 1.2, size: 0.3, life: 0.9, up: 1.8, grav: -1.2 });
    this.ring(pos, 0x3fae52, { maxR: 2.2 * s, dur: 0.5 });
  }

  // traveling wave for AoE spells: a wall of element matter sweeping across
  async aoeSweep(positions, color, { stepMs = 90, cell = 0, spin = 0 } = {}) {
    for (const p of positions) {
      this.burst(p, color, { n: 20, speed: 2.2, size: 0.45, life: 0.6, up: 0.9, cell, spin });
      this.ring(p, color, { maxR: 1.5, dur: 0.4 });
      await new Promise((r) => setTimeout(r, stepMs));
    }
  }

  setEmitter(key, pos, color, rate = 6, style = 'rise') {
    this.emitters.set(key, { pos: pos.clone(), color, rate, acc: 0, style });
  }
  moveEmitter(key, pos) {
    const e = this.emitters.get(key);
    if (e) e.pos.copy(pos);
  }
  clearEmitter(key) { this.emitters.delete(key); }

  update(dt) {
    // projectiles (spell comets)
    if (this._projectiles?.length) {
      for (let i = this._projectiles.length - 1; i >= 0; i--) {
        const pr = this._projectiles[i];
        pr.t += dt;
        const f = Math.min(1, pr.t / pr.dur);
        // quadratic bezier position
        const a = pr.from.clone().lerp(pr.ctrl, f);
        const b = pr.ctrl.clone().lerp(pr.to, f);
        const p = a.lerp(b, f);
        // white-hot core inside a big colored halo + trail
        pr.light.position.copy(p);
        this.spawn(p, new THREE.Vector3(0, 0, 0), 0xffffff, pr.size * 1.1, 0.1, 0);
        this.spawn(p, new THREE.Vector3(0, 0, 0), pr.coreColor, pr.size * 2.2, 0.16, 0);
        const n = Math.round((pr.trail * dt) * this.density);
        for (let k = 0; k < n; k++) {
          this.spawn(
            p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2)),
            new THREE.Vector3((Math.random() - 0.5) * 0.6, -0.2 - Math.random() * 0.5, (Math.random() - 0.5) * 0.6),
            pr.color, pr.size * (0.55 + Math.random() * 0.55), 0.4 + Math.random() * 0.3, -0.6);
        }
        if (f >= 1) {
          this._projectiles.splice(i, 1);
          this.scene.remove(pr.light);
          pr.light.dispose?.();
          pr.resolve();
        }
      }
    }
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
      this.rot[i] += this.spin[i] * dt;
      this.size[i] = this.baseSize[i] * k;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.size.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.points.geometry.attributes.acell.needsUpdate = true;
    this.points.geometry.attributes.arot.needsUpdate = true;
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
    // emitters (legendary element auras) — style drives the particle motion
    for (const e of this.emitters.values()) {
      e.acc += dt * e.rate * this.density;
      const R = Math.random;
      while (e.acc >= 1) {
        e.acc -= 1;
        const S = e.style || 'rise';
        let vx = (R() - 0.5) * 0.15, vy = 0.5 + R() * 0.5, vz = (R() - 0.5) * 0.15;
        let size = 0.22, life = 1.3, y0 = 0.05, sx = 1.05, sz = 1.15, grav = 0, drag = 0.99;
        let cell = 0, spin = 0;
        if (S === 'ember')       { vy = 0.75 + R() * 0.7;  size = 0.24; life = 1.05; grav = 0.35; cell = 1; spin = 3; }
        else if (S === 'frost')  { vy = -0.12 - R() * 0.22; y0 = 1.7; size = 0.28; life = 1.7; sx = 1.2; sz = 1.2; cell = 3; spin = 1.4; }
        else if (S === 'spore')  { vx = (R() - 0.5) * 0.45; vy = 0.12 + R() * 0.22; vz = (R() - 0.5) * 0.45; size = 0.24; life = 1.9; drag = 0.985; cell = 2; spin = 2.2; }
        else if (S === 'light')  { vy = 0.6 + R() * 0.6; size = 0.2; life = 1.25; cell = 1; spin = 0.8; }
        else if (S === 'shadow') { vy = 0.32 + R() * 0.4; size = 0.3; life = 1.5; drag = 0.968; }
        else if (S === 'arcane') { vx = (R() - 0.5) * 0.4; vy = 0.28 + R() * 0.4; vz = (R() - 0.5) * 0.4; size = 0.18; life = 1.6; cell = 1; spin = 1.5; }
        this.spawn(
          new THREE.Vector3(e.pos.x + (R() - 0.5) * sx, e.pos.y + y0, e.pos.z + (R() - 0.5) * sz),
          new THREE.Vector3(vx, vy, vz), e.color, size, life, grav, drag, cell, spin);
      }
    }
  }
}
