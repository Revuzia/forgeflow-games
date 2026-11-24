// Particles, glow sprites and the prints a hero leaves. Each system is ONE draw call.
//
// Particles are drawn with premultiplied alpha, and every particle says how SOLID it is: 0 adds
// light (a spark, a glint: right against the dark), 1 covers what is behind it (smoke, dust, a
// puff of steam: the only thing that shows against a bright sky). One draw, both kinds, nothing to
// sort. A particle that does not say is solid when it is dark, and takes the level's default
// (`solidBright`: high by day, zero at night) when it is bright.

import * as THREE from '../../vendor/three.module.min.js';

const POINT_VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  attribute float aSolid;
  uniform float uScale;
  uniform vec2 uFogNF;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSolid;
  void main() {
    vColor = aColor; vSolid = aSolid;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vAlpha = aAlpha * (1.0 - smoothstep(uFogNF.x, uFogNF.y, -mv.z));      // lost in the level's haze like everything else
    gl_Position = projectionMatrix * mv;
    float px = aSize * uScale / max(0.1, -mv.z);
    gl_PointSize = clamp(px, 0.0, 220.0);
    // right in front of the lens a puff or a glow is a big pale disc over the picture, not a thing in the world:
    // fade it out as it comes within a couple of metres of the camera
    vAlpha *= smoothstep(0.6, 2.4, -mv.z);
  }`;

const POINT_FRAG = /* glsl */`
  precision mediump float;
  uniform float uSoft;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vSolid;
  void main() {
    vec2 d = gl_PointCoord - 0.5;
    float r = length(d) * 2.0;
    if (r > 1.0) discard;
    // a painted dot with a crisp edge - or, for glows, a halo that falls away from the middle
    float a = mix(1.0 - smoothstep(0.7, 1.0, r), pow(1.0 - r, 2.2), uSoft) * min(1.0, vAlpha);
    gl_FragColor = vec4(vColor * a, a * vSolid);
    #include <colorspace_fragment>
  }`;

function pointsMaterial(soft) {
  return new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uSoft: { value: soft }, uFogNF: { value: new THREE.Vector2(30, 96) } },
    vertexShader: POINT_VERT, fragmentShader: POINT_FRAG,
    transparent: true, depthWrite: false, depthTest: true,
    blending: THREE.NormalBlending, premultipliedAlpha: true,
    toneMapped: false, fog: false,
  });
}

/** Pooled CPU particles drawn as point sprites. */
export class Particles {
  constructor(max = 700) {
    this.max = max; this.count = 0; this.budget = 1;
    this.solidBright = 0.6;     // how solid a bright particle is when it does not say (set per theme)
    this.p = new Float32Array(max * 3); this.c = new Float32Array(max * 3);
    this.s = new Float32Array(max); this.a = new Float32Array(max); this.sol = new Float32Array(max);
    this.v = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max); this.grow = new Float32Array(max); this.alpha0 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSolid', new THREE.BufferAttribute(this.sol, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mesh = new THREE.Points(g, pointsMaterial(0.12));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.seed = 12345;
  }

  /** Cheap deterministic-ish random in [0,1). Visual only. */
  rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 4294967296; }

  /**
   * Spawn one particle. o: { x,y,z, vx,vy,vz, life, size, grow (size/s), color [r,g,b], alpha, gravity, drag,
   *   solid (0 adds light .. 1 covers what is behind; default by brightness, see the top of this file) }
   * Returns false when the pool is full (or the quality budget skipped it).
   */
  spawn(o) {
    if (this.count >= this.max) return false;
    if (this.budget < 1 && this.rnd() > this.budget) return false;
    const i = this.count++, j = i * 3;
    this.p[j] = o.x; this.p[j + 1] = o.y; this.p[j + 2] = o.z;
    this.v[j] = o.vx || 0; this.v[j + 1] = o.vy || 0; this.v[j + 2] = o.vz || 0;
    const col = o.color || WHITE;
    this.c[j] = col[0]; this.c[j + 1] = col[1]; this.c[j + 2] = col[2];
    this.sol[i] = o.solid !== undefined ? o.solid : (col[0] * 0.3 + col[1] * 0.59 + col[2] * 0.11 < 0.5 ? 1 : this.solidBright);
    this.life[i] = this.maxLife[i] = o.life || 1;
    this.size0[i] = o.size || 0.2; this.grow[i] = o.grow || 0;
    this.alpha0[i] = o.alpha === undefined ? 1 : o.alpha;
    this.grav[i] = o.gravity || 0; this.drag[i] = o.drag || 0;
    this.s[i] = this.size0[i]; this.a[i] = 0;
    return true;
  }

  /** Radial burst helper. */
  burst(x, y, z, n, o) {
    for (let k = 0; k < n; k++) {
      const a = this.rnd() * Math.PI * 2, e = (this.rnd() - (o.flat ? 0.5 : 0.2)) * (o.flat ? 0.5 : 1.6);
      const sp = (o.speed || 2) * (0.4 + this.rnd() * 0.8);
      const ch = Math.cos(e);
      this.spawn({
        x: x + (this.rnd() - 0.5) * (o.spread || 0.2), y: y + (this.rnd() - 0.5) * (o.spread || 0.2), z: z + (this.rnd() - 0.5) * (o.spread || 0.2),
        vx: Math.cos(a) * ch * sp, vy: Math.sin(e) * sp + (o.up || 0), vz: Math.sin(a) * ch * sp,
        life: (o.life || 0.6) * (0.6 + this.rnd() * 0.7), size: (o.size || 0.18) * (0.6 + this.rnd() * 0.8),
        grow: o.grow || 0, color: o.color, alpha: o.alpha, gravity: o.gravity, drag: o.drag, solid: o.solid,
      });
    }
  }

  update(dt) {
    let n = this.count;
    for (let i = 0; i < n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        // swap-remove
        n--;
        if (i !== n) this._move(n, i);
        i--;
        continue;
      }
      const j = i * 3;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.v[j] *= d; this.v[j + 1] = this.v[j + 1] * d - this.grav[i] * dt; this.v[j + 2] *= d;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
      const t = 1 - this.life[i] / this.maxLife[i];
      this.s[i] = Math.max(0.01, this.size0[i] + this.grow[i] * (this.maxLife[i] - this.life[i]));
      // quick fade in, smooth fade out
      this.a[i] = this.alpha0[i] * Math.min(1, t * 8) * (1 - t) * (1 - t * 0.4) * 1.3;
    }
    this.count = n;
    this.geo.setDrawRange(0, n);
    const at = this.geo.attributes;
    at.position.needsUpdate = true; at.aColor.needsUpdate = true; at.aSize.needsUpdate = true; at.aAlpha.needsUpdate = true; at.aSolid.needsUpdate = true;
  }

  _move(from, to) {
    const a = from * 3, b = to * 3;
    for (let k = 0; k < 3; k++) { this.p[b + k] = this.p[a + k]; this.v[b + k] = this.v[a + k]; this.c[b + k] = this.c[a + k]; }
    this.life[to] = this.life[from]; this.maxLife[to] = this.maxLife[from];
    this.size0[to] = this.size0[from]; this.grow[to] = this.grow[from]; this.alpha0[to] = this.alpha0[from];
    this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
    this.s[to] = this.s[from]; this.a[to] = this.a[from]; this.sol[to] = this.sol[from];
  }

  clear() { this.count = 0; this.geo.setDrawRange(0, 0); }
  setPixelScale(px) { this.mesh.material.uniforms.uScale.value = px; }
  setFog(near, far) { this.mesh.material.uniforms.uFogNF.value.set(near, far); }
}

const WHITE = [1, 1, 1];

/** Persistent soft glow sprites (lamps, embers, shards, the exit ...). One draw call for all of them; they only ever add light. */
export class Glows {
  constructor(max = 96) {
    this.max = max; this.items = [];
    this.gain = 1;              // per theme: halos are strong at night and only a hint by day
    this.p = new Float32Array(max * 3); this.c = new Float32Array(max * 3);
    this.s = new Float32Array(max); this.a = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.c, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.s, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSolid', new THREE.BufferAttribute(new Float32Array(max), 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mesh = new THREE.Points(g, pointsMaterial(1));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 19;
  }

  /** Returns a handle { x,y,z, color:[r,g,b], size, alpha, flicker } you may mutate every frame. */
  add(x, y, z, color, size, alpha = 0.5, flicker = 0) {
    const h = { x, y, z, color: color.slice(), size, alpha, flicker, phase: this.items.length * 1.7 };
    if (this.items.length < this.max) this.items.push(h);
    return h;
  }

  clear() { this.items.length = 0; this.geo.setDrawRange(0, 0); }

  update(time) {
    const n = this.items.length, gain = this.gain;
    for (let i = 0; i < n; i++) {
      const h = this.items[i], j = i * 3;
      this.p[j] = h.x; this.p[j + 1] = h.y; this.p[j + 2] = h.z;
      this.c[j] = h.color[0]; this.c[j + 1] = h.color[1]; this.c[j + 2] = h.color[2];
      const f = h.flicker ? 1 + h.flicker * (Math.sin(time * 9 + h.phase) * 0.5 + Math.sin(time * 23.7 + h.phase * 2.1) * 0.5) : 1;
      this.s[i] = h.size; this.a[i] = Math.max(0, h.alpha * f * gain);
    }
    this.geo.setDrawRange(0, n);
    const at = this.geo.attributes;
    at.position.needsUpdate = true; at.aColor.needsUpdate = true; at.aSize.needsUpdate = true; at.aAlpha.needsUpdate = true;
  }

  setPixelScale(px) { this.mesh.material.uniforms.uScale.value = px; }
  setFog(near, far) { this.mesh.material.uniforms.uFogNF.value.set(near, far); }
}

/**
 * Fading prints on the floor behind a hero - Mote's wet marks, Cinder's scorch - as instanced flat
 * blots, one draw call. setLook(inner, rim, glow) picks the colours; glow > 0 makes the rim add light.
 */
export class Prints {
  constructor(max = 48) {
    this.max = max; this.next = 0;
    this.age = new Float32Array(max).fill(99);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max); this.splat = new Uint8Array(max);
    const g = new THREE.InstancedBufferGeometry();
    const q = new THREE.PlaneGeometry(1, 1);
    q.rotateX(-Math.PI / 2);
    g.index = q.index; g.attributes.position = q.attributes.position; g.attributes.uv = q.attributes.uv;
    this.off = new Float32Array(max * 4); // x,y,z,size
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(this.off, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = max;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { uInner: { value: new THREE.Vector3(0.08, 0.36, 0.44) }, uRim: { value: new THREE.Vector3(0.85, 0.98, 1.0) }, uGlow: { value: 0 } },
      vertexShader: /* glsl */`
        attribute vec4 aOffset; attribute float aAlpha;
        varying vec2 vUv; varying float vAlpha; varying float vSeed;
        void main() {
          vUv = uv; vAlpha = aAlpha; vSeed = aOffset.x * 3.1 + aOffset.z * 1.7;
          vec3 p = position * aOffset.w + aOffset.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */`
        precision mediump float;
        uniform vec3 uInner; uniform vec3 uRim; uniform float uGlow;
        varying vec2 vUv; varying float vAlpha; varying float vSeed;
        void main() {
          vec2 q = vUv - 0.5;
          // a blot with a wobbly edge, so a row of prints does not look like a row of coins
          float r = length(q) * 2.0 * (1.0 + 0.09 * sin(atan(q.y, q.x) * 5.0 + vSeed));
          float a = (1.0 - smoothstep(0.88, 1.0, r)) * vAlpha;
          if (a < 0.01) discard;
          // flat paint with a drawn rim (wet: darker tile and a bright edge; scorch: soot and an ember edge)
          float rim = smoothstep(0.6, 0.72, r);
          gl_FragColor = vec4(mix(uInner, uRim, rim) * a, a * mix(1.0, 1.0 - uGlow, rim));
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      premultipliedAlpha: true, toneMapped: false, fog: false,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.life = 3.2;
  }

  /** A print; `splat` makes it a landing splat that spreads out fast from a small blot. */
  add(x, y, z, size, splat = false) {
    const i = this.next; this.next = (this.next + 1) % this.max;
    this.off[i * 4] = x; this.off[i * 4 + 1] = y + 0.012 + (splat ? 0.002 : 0); this.off[i * 4 + 2] = z;
    this.off[i * 4 + 3] = splat ? size * 0.35 : size;
    this.size[i] = size; this.splat[i] = splat ? 1 : 0;
    this.age[i] = 0;
    this.geo.attributes.aOffset.needsUpdate = true;
  }

  update(dt) {
    let grew = false;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > this.life) { this.alpha[i] = 0; continue; }
      this.age[i] += dt;
      const t = this.age[i] / this.life;
      this.alpha[i] = (this.splat[i] ? 0.6 : 0.42) * (1 - t) * Math.min(1, this.age[i] * 12);
      if (this.splat[i] && this.age[i] < 0.3) {
        const g = 1 - Math.pow(1 - this.age[i] / 0.3, 3);
        this.off[i * 4 + 3] = this.size[i] * (0.35 + 0.65 * g);
        grew = true;
      }
    }
    this.geo.attributes.aAlpha.needsUpdate = true;
    if (grew) this.geo.attributes.aOffset.needsUpdate = true;
  }

  clear() { this.age.fill(99); this.alpha.fill(0); this.geo.attributes.aAlpha.needsUpdate = true; }

  /** Colours of the blot and of its rim (linear rgb), and how much the rim glows (0..1). */
  setLook(inner, rim, glow = 0) {
    const u = this.mesh.material.uniforms;
    u.uInner.value.set(inner[0], inner[1], inner[2]); u.uRim.value.set(rim[0], rim[1], rim[2]); u.uGlow.value = glow;
  }
}
