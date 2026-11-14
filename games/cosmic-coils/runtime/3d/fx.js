/**
 * Cosmic Coils — runtime/3d/fx.js
 * GPU-light particle work, all pooled:
 *   bursts  — eat sparkles, death explosions, kill confetti, boost embers
 *   motes   — permanent biome ambience (fireflies / embers / sparkle / dust / spores)
 *   weather — rain, snow, ash, sandstorm, spore storm sheets in a bubble around
 *             the player, plus lightning flash scheduling for storm events
 * Three THREE.Points total, custom shader (per-particle size/alpha/color).
 */
import * as THREE from "three";

const V = new URL(import.meta.url).search;
const S = await import("../sim/serpent.js" + V);
const { terrainH, CONST } = S;

function dotTexture() {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 64;
  const c = cv.getContext("2d");
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g; c.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  return t;
}

function makePoints(cap, tex, blending = THREE.AdditiveBlending) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aColor", new THREE.BufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute("aAlpha", new THREE.BufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending, fog: false,
    uniforms: { uTex: { value: tex } },
    vertexShader: `
      attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
      varying vec3 vC; varying float vA;
      void main(){
        vC = aColor; vA = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (240.0 / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uTex; varying vec3 vC; varying float vA;
      void main(){
        vec4 t = texture2D(uTex, gl_PointCoord);
        gl_FragColor = vec4(vC, t.a * vA);
        if (gl_FragColor.a < 0.01) discard;
      }`,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

const BURST_CAP = 2600, MOTE_CAP = 260, WX_CAP = 1300;

export class FX {
  constructor(scene, W, biomeDef) {
    this.scene = scene;
    this.W = W;
    this.def = biomeDef;
    this.t = 0;
    const tex = dotTexture();

    // bursts pool
    this.bp = makePoints(BURST_CAP, tex);
    this.bursts = new Array(BURST_CAP).fill(null).map(() => ({ live: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, max: 1, s0: 1, s1: 0, c: new THREE.Color(), grav: 0, damp: 0.99 }));
    this.bN = 0;
    scene.add(this.bp);

    // ambient motes
    this.mp = makePoints(MOTE_CAP, tex);
    this.motes = new Array(MOTE_CAP).fill(null).map(() => ({ u: new THREE.Vector3(), h: 0, ph: Math.random() * 6.28, sp: 0.4 + Math.random() * 0.8 }));
    scene.add(this.mp);
    this._initMotes();

    // weather sheet
    this.wp = makePoints(WX_CAP, tex, THREE.NormalBlending);
    this.wx = new Array(WX_CAP).fill(null).map(() => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), ph: Math.random() * 6.28 }));
    this.weatherKind = "calm";
    this.weatherI = 0;
    scene.add(this.wp);
    this._wxInit = false;

    this.flash = 0;
    this._nextBolt = 0;
    this.onThunder = null; // set by game (audio hook)
    this.qMul = 1;         // particle budget multiplier: HIGH 1 / MEDIUM 0.75 / LOW 0.5

    // clouds: soft high-altitude puffs, biome-tinted, always on
    this.cp = makePoints(64, tex, THREE.NormalBlending);
    this.cloudPuffs = [];
    this._initClouds();
    scene.add(this.cp);

    // rainbow (verdant, after rain) — one cheap mesh, drawn only while fading.
    // (aurora is now a DISTANT sky-dome effect in planet.js, not an overhead
    // plane — the old plane obscured the surface when you rolled under it.)
    this._rainbow = null; this._rainbowT = 0; this._rainbowMax = 20;
    this._lastWxKind = "calm";

    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._anchor = new THREE.Vector3(0, 0, CONST.R + 6);
    this._ref = new THREE.Vector3(); this._t1 = new THREE.Vector3(); this._t2 = new THREE.Vector3();
  }

  _initClouds() {
    const def = this.def.clouds || { color: 0xffffff, n: 24, alpha: 0.15, alt: [10, 16] };
    this.cloudPuffs.length = 0;
    for (let i = 0; i < 64; i++) {
      const u = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      this.cloudPuffs.push({
        u, alt: def.alt[0] + Math.random() * (def.alt[1] - def.alt[0]),
        size: 8 + Math.random() * 9, ph: Math.random() * 6.28,
        axis: new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize(),
        sp: 0.004 + Math.random() * 0.008,
      });
    }
  }

  _makeRainbow() {
    const geo = new THREE.TorusGeometry(20, 2.6, 8, 48, Math.PI);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      uniforms: { uA: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec2 vUv; uniform float uA;
        vec3 hue(float h){ vec3 p = abs(fract(vec3(h) + vec3(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0); return clamp(p - 1.0, 0.0, 1.0); }
        void main(){
          // vUv.y wraps around the tube: map the OUTER half to rainbow bands
          float band = clamp(vUv.y * 2.0 - 0.5, 0.0, 1.0);
          vec3 col = hue(0.83 * (1.0 - band));
          float edge = smoothstep(0.0, 0.15, band) * smoothstep(1.0, 0.85, band);
          gl_FragColor = vec4(col, uA * edge * 0.5);
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    this.scene.add(m);
    return m;
  }

  _initMotes() {
    const rng = Math.random;
    for (const m of this.motes) {
      m.u.set(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      m.h = 0.6 + rng() * 3.2;
    }
  }

  // ── bursts ────────────────────────────────────────────────────────────────
  spawn(p, v, life, s0, s1, colorHex, grav = 0, damp = 0.985) {
    const b = this.bursts[this.bN];
    this.bN = (this.bN + 1) % BURST_CAP;
    b.live = true; b.p.copy(p); b.v.copy(v);
    b.life = 0; b.max = life; b.s0 = s0; b.s1 = s1;
    b.c.setHex(colorHex); b.grav = grav; b.damp = damp;
  }
  burstAt(worldP, colorHex, n = 14, speed = 5, size = 0.8, life = 0.6) {
    for (let i = 0; i < n; i++) {
      this._tmp2.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(speed * (0.4 + Math.random() * 0.8));
      this.spawn(worldP, this._tmp2, life * (0.6 + Math.random() * 0.7), size * (0.7 + Math.random() * 0.7), 0.05, colorHex, 2.2);
    }
  }
  surfPoint(u, lift = 0.6) {
    this._tmp.set(u.x, u.y, u.z);
    const h = terrainH(this._tmp, this.W.seed, CONST.TERRAIN_AMP);
    return this._tmp.multiplyScalar(this.W.R + h + lift);
  }
  eatBurst(u, tier) {
    const col = tier === 9 ? 0x78c850 : tier === 2 ? 0xd8b840 : tier === 3 ? 0xd848b0 : tier === 0 ? 0xe0a858 : 0x3cc8d8;
    const n = tier === 9 ? 8 : tier >= 2 ? 16 : 10;
    this.burstAt(this.surfPoint(u, 0.8), col, n, tier === 9 ? 3.2 : 4.5, tier === 9 ? 0.5 : 0.75, 0.5);
  }
  deathBurst(segs, segN, colorHex, R) {
    const n = Math.min(segN, 60);
    const stride = Math.max(1, Math.floor(segN / n));
    for (let i = 0; i < segN; i += stride) {
      this._tmp.set(segs[i * 3], segs[i * 3 + 1], segs[i * 3 + 2]);
      const h = terrainH(this._tmp, this.W.seed, CONST.TERRAIN_AMP);
      this._tmp.multiplyScalar(R + h + 1);
      for (let k = 0; k < 3; k++) {
        this._tmp2.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize().multiplyScalar(3 + Math.random() * 6);
        this.spawn(this._tmp, this._tmp2, 0.9 + Math.random() * 0.6, 1.1, 0.04, colorHex, 1.4, 0.97);
      }
    }
  }
  boostTrail(headWorld, backDir, colorHex) {
    if (Math.random() < 0.65) {
      this._tmp2.copy(backDir).multiplyScalar(3 + Math.random() * 2);
      this._tmp2.x += (Math.random() - 0.5) * 2; this._tmp2.y += (Math.random() - 0.5) * 2; this._tmp2.z += (Math.random() - 0.5) * 2;
      this.spawn(headWorld, this._tmp2, 0.4 + Math.random() * 0.25, 0.9, 0.05, colorHex, 0, 0.94);
    }
  }

  setWeather(kind, intensity) {
    if (kind !== this.weatherKind) {
      this._wxInit = false;
      // 🌈 a rain shower ending on the forest world leaves a rainbow behind
      if (this.weatherKind === "rain" && kind === "calm") {
        this._rainbowT = this._rainbowMax;
        this._rainbowPlaced = false;
      }
    }
    this.weatherKind = kind;
    this.weatherI = intensity;
  }

  _wxRespawn(w, anchor, normal) {
    // scatter in a HORIZONTAL disk around the player (tangent plane) and place
    // it clearly ABOVE along the surface normal — so precipitation visibly
    // falls DOWN through view (the old world-axis cube put drops below/beside,
    // which read ambiguously / "upward").
    const ref = Math.abs(normal.y) < 0.9 ? this._ref.set(0, 1, 0) : this._ref.set(1, 0, 0);
    this._t1.crossVectors(ref, normal).normalize();
    this._t2.crossVectors(normal, this._t1);
    const a = Math.random() * 6.2832, r = 6 + Math.random() * 28;
    w.p.copy(anchor)
      .addScaledVector(this._t1, Math.cos(a) * r)
      .addScaledVector(this._t2, Math.sin(a) * r)
      .addScaledVector(normal, 14 + Math.random() * 34);
  }

  update(dt, playerHead, playerNormal) {
    this.t += dt;
    const anchor = playerHead || this._anchor;
    const normal = playerNormal || this._tmp.copy(anchor).normalize();

    // ── bursts ──
    {
      const pos = this.bp.geometry.attributes.position.array;
      const col = this.bp.geometry.attributes.aColor.array;
      const siz = this.bp.geometry.attributes.aSize.array;
      const alp = this.bp.geometry.attributes.aAlpha.array;
      let i = 0;
      for (const b of this.bursts) {
        if (!b.live) { alp[i] = 0; i++; continue; }
        b.life += dt;
        if (b.life >= b.max) { b.live = false; alp[i] = 0; i++; continue; }
        const k = b.life / b.max;
        // gravity pulls toward planet center
        if (b.grav) {
          this._tmp2.copy(b.p).normalize().multiplyScalar(-b.grav * dt * 9);
          b.v.add(this._tmp2);
        }
        b.v.multiplyScalar(Math.pow(b.damp, dt * 60));
        b.p.addScaledVector(b.v, dt);
        pos[i * 3] = b.p.x; pos[i * 3 + 1] = b.p.y; pos[i * 3 + 2] = b.p.z;
        col[i * 3] = b.c.r; col[i * 3 + 1] = b.c.g; col[i * 3 + 2] = b.c.b;
        siz[i] = b.s0 + (b.s1 - b.s0) * k;
        alp[i] = 1 - k * k;
        i++;
      }
      this.bp.geometry.attributes.position.needsUpdate = true;
      this.bp.geometry.attributes.aColor.needsUpdate = true;
      this.bp.geometry.attributes.aSize.needsUpdate = true;
      this.bp.geometry.attributes.aAlpha.needsUpdate = true;
      this.bp.geometry.setDrawRange(0, BURST_CAP);
    }

    // ── motes (biome ambience around the whole planet, drawn near player) ──
    {
      const def = this.def.ambientMotes;
      const pos = this.mp.geometry.attributes.position.array;
      const col = this.mp.geometry.attributes.aColor.array;
      const siz = this.mp.geometry.attributes.aSize.array;
      const alp = this.mp.geometry.attributes.aAlpha.array;
      const c = new THREE.Color(def.color);
      const n = Math.min(def.n, MOTE_CAP);
      for (let i = 0; i < MOTE_CAP; i++) {
        if (i >= n) { alp[i] = 0; continue; }
        const m = this.motes[i];
        // slow orbit drift
        const w = 0.02 * m.sp;
        m.u.applyAxisAngle(this._tmp2.set(Math.sin(m.ph), Math.cos(m.ph * 1.3), Math.sin(m.ph * 0.7)).normalize(), w * dt);
        const h = terrainH(m.u, this.W.seed, CONST.TERRAIN_AMP);
        let bobH = m.h;
        if (def.mode === "firefly") bobH += Math.sin(this.t * m.sp * 2 + m.ph) * 0.8;
        if (def.mode === "ember") bobH += (this.t * m.sp) % 4;
        if (def.mode === "spore") bobH += Math.sin(this.t * m.sp + m.ph) * 1.6;
        this._tmp2.copy(m.u).multiplyScalar(this.W.R + h + 0.5 + bobH);
        const d = this._tmp2.distanceTo(anchor);
        pos[i * 3] = this._tmp2.x; pos[i * 3 + 1] = this._tmp2.y; pos[i * 3 + 2] = this._tmp2.z;
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        const tw = def.mode === "sparkle" ? (0.3 + 0.7 * Math.max(0, Math.sin(this.t * 6 + m.ph * 9))) : (0.55 + 0.45 * Math.sin(this.t * 2.2 + m.ph));
        siz[i] = def.mode === "dust" ? 0.55 : 0.8;
        alp[i] = Math.max(0, 1 - d / 70) * tw * 0.85;
      }
      this.mp.geometry.attributes.position.needsUpdate = true;
      this.mp.geometry.attributes.aColor.needsUpdate = true;
      this.mp.geometry.attributes.aSize.needsUpdate = true;
      this.mp.geometry.attributes.aAlpha.needsUpdate = true;
    }

    // ── weather ──
    {
      const kind = this.weatherKind, I = this.weatherI;
      const pos = this.wp.geometry.attributes.position.array;
      const col = this.wp.geometry.attributes.aColor.array;
      const siz = this.wp.geometry.attributes.aSize.array;
      const alp = this.wp.geometry.attributes.aAlpha.array;
      const active = kind !== "calm" && kind !== "fireflies" && kind !== "aurora" && kind !== "heatwave" && I > 0.02;
      const budget = WX_CAP * this.qMul;
      const n = active ? Math.floor(budget * Math.min(1, I * 1.2)) : 0;
      if (active && !this._wxInit) {
        this._wxInit = true;
        for (const w of this.wx) this._wxRespawn(w, anchor, normal);
      }
      const c = new THREE.Color(
        kind === "rain" ? 0x9fd4ff : kind === "blizzard" ? 0xf0faff :
        kind === "ashstorm" ? 0x6a5a58 : kind === "emberrain" ? 0xff9a3c :
        kind === "sandstorm" ? 0xe8c47a : kind === "sporestorm" ? 0xe27aff :
        kind === "voidstorm" ? 0x8a9aff : 0xffffff);
      // wind tangent (consistent-ish direction in local frame)
      const wind = this._tmp2.crossVectors(normal, new THREE.Vector3(0.3, 1, 0.2)).normalize();
      for (let i = 0; i < WX_CAP; i++) {
        if (i >= n) { alp[i] = 0; continue; }
        const w = this.wx[i];
        // velocity per kind
        if (kind === "rain") w.v.copy(normal).multiplyScalar(-26).addScaledVector(wind, 4);
        else if (kind === "blizzard") w.v.copy(normal).multiplyScalar(-7).addScaledVector(wind, 12 + Math.sin(this.t * 2 + w.ph) * 4);
        else if (kind === "ashstorm") w.v.copy(normal).multiplyScalar(1.5).addScaledVector(wind, 9 + Math.sin(this.t + w.ph) * 3);
        else if (kind === "emberrain") w.v.copy(normal).multiplyScalar(3.5 + Math.sin(this.t * 3 + w.ph)).addScaledVector(wind, 2);
        else if (kind === "sandstorm") w.v.copy(wind).multiplyScalar(24 + Math.sin(this.t * 2.5 + w.ph) * 6).addScaledVector(normal, -1);
        else if (kind === "sporestorm") w.v.copy(normal).multiplyScalar(Math.sin(this.t * 1.5 + w.ph) * 2).addScaledVector(wind, 3.5);
        else w.v.copy(wind).multiplyScalar(6); // voidstorm drift
        w.p.addScaledVector(w.v, dt);
        // re-wrap into bubble
        if (w.p.distanceToSquared(anchor) > 42 * 42) this._wxRespawn(w, anchor, normal);
        // ground cull: below surface → respawn
        const rl = w.p.length();
        if (rl < this.W.R - 1.5) this._wxRespawn(w, anchor, normal);
        pos[i * 3] = w.p.x; pos[i * 3 + 1] = w.p.y; pos[i * 3 + 2] = w.p.z;
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        siz[i] = kind === "rain" ? 0.6 : kind === "sandstorm" ? 1.15 : kind === "blizzard" ? 0.95 : kind === "sporestorm" ? 0.9 : 0.7;
        const glow = kind === "emberrain" || kind === "sporestorm" || kind === "voidstorm" ? 0.95 : 0.8;
        alp[i] = glow * Math.min(1, I * 1.3) * (0.62 + 0.38 * Math.sin(this.t * 3 + w.ph * 7));
      }
      this.wp.geometry.attributes.position.needsUpdate = true;
      this.wp.geometry.attributes.aColor.needsUpdate = true;
      this.wp.geometry.attributes.aSize.needsUpdate = true;
      this.wp.geometry.attributes.aAlpha.needsUpdate = true;

      // lightning in the heavy storms (NOT blizzards — snow doesn't thunder)
      this.flash = Math.max(0, this.flash - dt * 3.2);
      const stormy = (kind === "voidstorm" || kind === "rain") && I > 0.5;
      if (stormy && this.t > this._nextBolt) {
        this._nextBolt = this.t + 4 + Math.random() * 9;
        this.flash = 0.55 + Math.random() * 0.4;
        if (this.onThunder) this.onThunder();
      }
    }

    // ── clouds (always on, drifting high above the surface) ──
    {
      const def = this.def.clouds || { color: 0xffffff, n: 24, alpha: 0.15 };
      const n = Math.min(64, Math.ceil(def.n * this.qMul));
      const pos = this.cp.geometry.attributes.position.array;
      const col = this.cp.geometry.attributes.aColor.array;
      const siz = this.cp.geometry.attributes.aSize.array;
      const alp = this.cp.geometry.attributes.aAlpha.array;
      const c = new THREE.Color(def.color);
      for (let i = 0; i < 64; i++) {
        if (i >= n) { alp[i] = 0; continue; }
        const p = this.cloudPuffs[i];
        p.u.applyAxisAngle(p.axis, p.sp * dt);
        this._tmp2.copy(p.u).multiplyScalar(this.W.R + p.alt + Math.sin(this.t * 0.15 + p.ph) * 0.6);
        pos[i * 3] = this._tmp2.x; pos[i * 3 + 1] = this._tmp2.y; pos[i * 3 + 2] = this._tmp2.z;
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        siz[i] = p.size;
        alp[i] = def.alpha * (0.75 + 0.25 * Math.sin(this.t * 0.1 + p.ph * 3));
      }
      this.cp.geometry.attributes.position.needsUpdate = true;
      this.cp.geometry.attributes.aColor.needsUpdate = true;
      this.cp.geometry.attributes.aSize.needsUpdate = true;
      this.cp.geometry.attributes.aAlpha.needsUpdate = true;
    }

    // ── rainbow (verdant, ~20s after a rain shower ends) ──
    if (this._rainbowT > 0) {
      if (!this._rainbow) this._rainbow = this._makeRainbow();
      const rb = this._rainbow;
      if (!this._rainbowPlaced) {
        this._rainbowPlaced = true;
        // plant it on the surface ~40u ahead of the player, arch upright
        const up = this._tmp.copy(anchor).normalize();
        const fwd = this._tmp2.set(0.3, 1, 0.2).cross(up).normalize();
        const base = up.clone().multiplyScalar(this.W.R - 2).addScaledVector(fwd, 40);
        base.normalize();
        const bu = base.clone();
        rb.position.copy(bu).multiplyScalar(this.W.R - 1);
        // orient: torus arc opens downward → local Y = surface normal
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), bu);
        rb.quaternion.copy(q);
        rb.visible = true;
      }
      this._rainbowT -= dt;
      const k = this._rainbowT / this._rainbowMax;
      rb.material.uniforms.uA.value = Math.min(1, Math.min((1 - k) * 6, k * 4));
      if (this._rainbowT <= 0) rb.visible = false;
    }
    // (aurora now lives in the distant sky dome — see planet.js update())
  }

  setWorld(W, biomeDef) {
    this.W = W;
    this.def = biomeDef;
    this._initMotes();
    this._wxInit = false;
    for (const b of this.bursts) b.live = false;
  }

  dispose() {
    for (const p of [this.bp, this.mp, this.wp, this.cp]) {
      this.scene.remove(p);
      p.geometry.dispose(); p.material.uniforms.uTex.value.dispose(); p.material.dispose();
    }
    if (this._rainbow) {
      this.scene.remove(this._rainbow);
      this._rainbow.geometry.dispose(); this._rainbow.material.dispose();
    }
  }
}
