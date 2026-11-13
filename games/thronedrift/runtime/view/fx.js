// Thronedrift — juice: pooled burst particles, floating combat text
// (DOM, projected each frame), and ground decals (residual fire/frost patches,
// slam shockwaves, target reticles). Screen shake + hit-stop live in game.js.

import * as THREE from "three";
import { rand, clamp } from "../core/util.js";

// ---------- burst particles (one Points pool) ------------------------------

const MAX_P = 1600;

export class Particles {
  constructor(scene) {
    this.pos = new Float32Array(MAX_P * 3);
    this.col = new Float32Array(MAX_P * 3);
    this.vel = new Float32Array(MAX_P * 3);
    this.life = new Float32Array(MAX_P);
    this.maxLife = new Float32Array(MAX_P);
    this.grav = new Float32Array(MAX_P);
    this.head = 0; this.alive = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({
      size: 0.22, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    // park dead particles far below the board
    for (let i = 0; i < MAX_P; i++) this.pos[i * 3 + 1] = -999;
  }

  burst(x, y, z, { count = 14, color = 0xffaa33, color2 = null, speed = 4, up = 2.5, life = 0.5, gravity = 6, spread = 1 } = {}) {
    const c1 = new THREE.Color(color), c2 = color2 ? new THREE.Color(color2) : c1;
    for (let n = 0; n < count; n++) {
      const i = this.head; this.head = (this.head + 1) % MAX_P;
      const a = rand(Math.PI * 2), r = rand(0.2, 1) * speed;
      this.pos[i * 3] = x + rand(-spread, spread) * 0.3;
      this.pos[i * 3 + 1] = y + rand(-0.2, 0.2);
      this.pos[i * 3 + 2] = z + rand(-spread, spread) * 0.3;
      this.vel[i * 3] = Math.cos(a) * r;
      this.vel[i * 3 + 1] = rand(0.3, 1) * up;
      this.vel[i * 3 + 2] = Math.sin(a) * r;
      this.life[i] = this.maxLife[i] = life * rand(0.6, 1.3);
      this.grav[i] = gravity;
      const c = Math.random() < 0.5 ? c1 : c2;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
    }
  }

  update(dt) {
    for (let i = 0; i < MAX_P; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) { this.pos[i * 3 + 1] = 0.02; this.vel[i * 3 + 1] *= -0.3; }
      const f = this.life[i] / this.maxLife[i];
      this.col[i * 3] *= (0.985 + f * 0.01); // slight dim over life
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }

  dispose(scene) { scene.remove(this.points); this.points.geometry.dispose(); this.mat.dispose(); }
}

// ---------- floating combat text (DOM projected) ---------------------------

export class FloatText {
  constructor(container, camera) {
    this.container = container; this.camera = camera;
    this.items = [];
    this.v = new THREE.Vector3();
  }

  spawn(text, wx, wy, wz, { color = "#fff", size = 18, life = 0.9, rise = 1.6, weight = 900, stroke = true } = {}) {
    if (this.items.length > 48) this._kill(this.items[0]);
    const el = document.createElement("div");
    el.textContent = text;
    el.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;font-weight:${weight};` +
      `font-size:${size}px;color:${color};white-space:nowrap;transform:translate(-50%,-50%);` +
      (stroke ? "text-shadow:0 0 6px rgba(0,0,0,.9),0 2px 2px rgba(0,0,0,.8);" : "") +
      "font-family:'Segoe UI',system-ui,sans-serif;will-change:transform,opacity;";
    this.container.appendChild(el);
    const it = { el, wx, wy, wz, t: 0, life, rise, size };
    this.items.push(it);
    return it;
  }

  _kill(it) { it.el.remove(); const i = this.items.indexOf(it); if (i >= 0) this.items.splice(i, 1); }

  update(dt, w, h) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      if (it.t >= it.life) { this._kill(it); continue; }
      const f = it.t / it.life;
      this.v.set(it.wx, it.wy + it.rise * f, it.wz).project(this.camera);
      if (this.v.z > 1) { it.el.style.opacity = "0"; continue; }
      const x = (this.v.x * 0.5 + 0.5) * w, y = (-this.v.y * 0.5 + 0.5) * h;
      const pop = f < 0.15 ? 0.5 + (f / 0.15) * 0.7 : 1.2 - f * 0.25;
      it.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${pop})`;
      it.el.style.opacity = String(f > 0.7 ? 1 - (f - 0.7) / 0.3 : 1);
    }
  }

  clear() { for (const it of [...this.items]) this._kill(it); }
}

// ---------- enemy health bars (DOM projected, shown once damaged) -----------

export class WorldBars {
  constructor(container, camera) {
    this.container = container; this.camera = camera;
    this.bars = new Map();       // enemy → {wrap, fill}
    this.v = new THREE.Vector3();
  }

  /** call once per frame with the live enemy list */
  update(enemies, w, h) {
    const seen = new Set();
    for (const e of enemies) {
      if (e.dead || e.hp >= e.maxHp) continue;
      seen.add(e);
      let b = this.bars.get(e);
      if (!b) {
        const wrap = document.createElement("div");
        wrap.style.cssText = "position:absolute;left:0;top:0;width:42px;height:6px;transform:translate(-50%,-50%);" +
          "background:rgba(10,4,16,.8);border:1px solid rgba(232,184,58,.55);border-radius:3px;pointer-events:none;overflow:hidden";
        const fill = document.createElement("div");
        fill.style.cssText = "height:100%;width:100%;background:linear-gradient(90deg,#ff4a3a,#ff7a4a);border-radius:2px;transition:width .12s";
        wrap.appendChild(fill);
        this.container.appendChild(wrap);
        b = { wrap, fill };
        this.bars.set(e, b);
      }
      this.v.set(e.x, e.def.height + 0.45, e.z).project(this.camera);
      if (this.v.z > 1) { b.wrap.style.display = "none"; continue; }
      b.wrap.style.display = "block";
      b.wrap.style.transform = `translate(${(this.v.x * 0.5 + 0.5) * w}px,${(-this.v.y * 0.5 + 0.5) * h}px) translate(-50%,-50%)`;
      b.fill.style.width = `${clamp(e.hp / e.maxHp, 0, 1) * 100}%`;
    }
    for (const [e, b] of this.bars) if (!seen.has(e)) { b.wrap.remove(); this.bars.delete(e); }
  }

  clear() { for (const [, b] of this.bars) b.wrap.remove(); this.bars.clear(); }
}

// ---------- ground decals (residuals, shockwaves, reticles) ----------------

function radialTex(inner, outer, stops) {
  const S = 256, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(S / 2, S / 2, S / 2 * inner, S / 2, S / 2, S / 2 * outer);
  for (const [t, col] of stops) grd.addColorStop(t, col);
  g.fillStyle = grd; g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let TEXS = null;
function texs() {
  if (TEXS) return TEXS;
  TEXS = {
    fire: radialTex(0, 1, [[0, "rgba(255,190,80,0.95)"], [0.4, "rgba(255,90,20,0.75)"], [0.8, "rgba(180,30,0,0.3)"], [1, "rgba(120,20,0,0)"]]),
    frost: radialTex(0, 1, [[0, "rgba(210,245,255,0.95)"], [0.4, "rgba(90,200,255,0.7)"], [0.8, "rgba(40,120,200,0.28)"], [1, "rgba(20,80,160,0)"]]),
    ring: radialTex(0.7, 1, [[0, "rgba(255,255,255,0)"], [0.5, "rgba(255,230,150,0.9)"], [1, "rgba(255,180,60,0)"]]),
    reticle: radialTex(0.82, 1, [[0, "rgba(255,60,60,0)"], [0.5, "rgba(255,80,60,0.95)"], [1, "rgba(255,60,60,0)"]]),
    shock: radialTex(0.5, 1, [[0, "rgba(200,220,255,0)"], [0.5, "rgba(170,140,255,0.9)"], [1, "rgba(140,90,255,0)"]]),
  };
  return TEXS;
}

export class Decals {
  constructor(scene) {
    this.scene = scene; this.items = [];
    this.geo = new THREE.PlaneGeometry(1, 1);
  }

  /** kind: fire|frost|ring|reticle|shock. Returns handle with .pos/.radius (for sim queries). */
  spawn(kind, x, z, radius, life, { grow = false, spin = 0 } = {}) {
    const mat = new THREE.MeshBasicMaterial({
      map: texs()[kind], transparent: true, depthWrite: false,
      blending: kind === "frost" ? THREE.NormalBlending : THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(this.geo, mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.06 + this.items.length * 0.0012, z); // slight stagger avoids z-fighting
    m.scale.setScalar(radius * 2);
    this.scene.add(m);
    const it = { m, mat, kind, x, z, radius, t: 0, life, grow, spin };
    this.items.push(it);
    return it;
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const f = it.t / it.life;
      if (f >= 1) { this.scene.remove(it.m); it.mat.dispose(); this.items.splice(i, 1); continue; }
      if (it.grow) it.m.scale.setScalar(it.radius * 2 * clamp(f * 3, 0.2, 1));
      if (it.spin) it.m.rotation.z += it.spin * dt;
      // residuals flicker; everything fades in the last third
      const flicker = (it.kind === "fire") ? 0.85 + Math.sin(it.t * 22) * 0.15 : 1;
      it.mat.opacity = flicker * (f > 0.66 ? 1 - (f - 0.66) / 0.34 : 1);
    }
  }

  /** active residuals of a kind (for damage/slow queries in the sim) */
  residuals(kind) { return this.items.filter((i) => i.kind === kind); }

  clear() { for (const it of [...this.items]) { this.scene.remove(it.m); it.mat.dispose(); } this.items.length = 0; }
}
