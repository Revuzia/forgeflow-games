// Thronedrift — procedural realm-board builder.
// Every realm is a floating circular "realm board": ornate rim, glowing rune
// ring, biome floor painted on a 2048px canvas (albedo + emissive), floating
// rock underside, orbiting debris, sky dome, portal rings and ambient FX.
// One parameterized builder = five visually distinct boards.

import * as THREE from "three";
import { BOARD_RADIUS } from "../data/arenas.js";
import { rand, pick } from "../core/util.js";

const R = BOARD_RADIUS + 1.6; // visual disc slightly larger than playable bound

// ---------- floor painting ----------------------------------------------

function paintFloor(def) {
  const S = 2048, c = document.createElement("canvas"); c.width = c.height = S;
  const g = c.getContext("2d");
  const e = document.createElement("canvas"); e.width = e.height = S;
  const ge = e.getContext("2d");
  const cx = S / 2, cy = S / 2, rad = S / 2;
  const css = (hex, a = 1) => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;

  const style = def.floor;
  const P = {
    ember: { base: "#3a2320", low: "#241412", vein: 0xff5a1a, tile: "#4a2c24", crack: "#1a0c0a" },
    ice:   { base: "#b8d8e8", low: "#8fb8d0", vein: 0x66e0ff, tile: "#cfe8f4", crack: "#6a98b8" },
    storm: { base: "#2a2438", low: "#1c1828", vein: 0xb070ff, tile: "#342c48", crack: "#141020" },
    void:  { base: "#241a2e", low: "#160e1e", vein: 0xff4dcf, tile: "#2e2138", crack: "#0e0714" },
    solar: { base: "#e8d8b0", low: "#cbb684", vein: 0xffb020, tile: "#f2e4c4", crack: "#a8925e" },
  }[style];

  // base
  const grd = g.createRadialGradient(cx, cy, rad * 0.1, cx, cy, rad);
  grd.addColorStop(0, P.tile); grd.addColorStop(0.75, P.base); grd.addColorStop(1, P.low);
  g.fillStyle = grd; g.fillRect(0, 0, S, S);

  // tile grout: concentric rings + radial spokes (realm-board flagstones)
  g.strokeStyle = P.crack; g.lineWidth = 4; g.globalAlpha = 0.28;
  for (let i = 1; i <= 6; i++) { g.beginPath(); g.arc(cx, cy, rad * (0.14 + i * 0.135), 0, Math.PI * 2); g.stroke(); }
  const spokes = 28;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + (i % 2) * 0.05;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * rad * 0.2, cy + Math.sin(a) * rad * 0.2);
    g.lineTo(cx + Math.cos(a) * rad * 0.96, cy + Math.sin(a) * rad * 0.96); g.stroke();
  }
  g.globalAlpha = 1;

  // noise blotches for wear
  for (let i = 0; i < 900; i++) {
    const a = rand(Math.PI * 2), r = Math.sqrt(Math.random()) * rad * 0.97;
    g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.06)" : "rgba(255,255,255,0.04)";
    g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rand(6, 30), 0, Math.PI * 2); g.fill();
  }

  // veins (lava seams / frost veins / lightning inlay / void cracks / gold filigree)
  ge.fillStyle = "#000"; ge.fillRect(0, 0, S, S);
  const veinCol = css(P.vein);
  const drawVein = (x, y, ang, len, w) => {
    for (const ctx2 of [g, ge]) {
      ctx2.strokeStyle = ctx2 === g ? css(P.vein, 0.8) : veinCol;
      ctx2.lineWidth = w; ctx2.lineCap = "round"; ctx2.beginPath(); ctx2.moveTo(x, y);
      let px = x, py = y, pa = ang;
      const seg = Math.floor(len / 18);
      for (let s = 0; s < seg; s++) { pa += rand(-0.55, 0.55); px += Math.cos(pa) * 18; py += Math.sin(pa) * 18; ctx2.lineTo(px, py); }
      ctx2.stroke();
    }
  };
  for (let i = 0; i < 22; i++) {
    const a = rand(Math.PI * 2), r = rand(rad * 0.2, rad * 0.85);
    drawVein(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rand(Math.PI * 2), rand(90, 300), rand(2, style === "storm" ? 4 : 6));
  }

  // rune ring near the edge
  const runes = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ";
  const runeR = rad * 0.88, count = 36;
  for (const [ctx2, alpha] of [[g, 0.9], [ge, 1]]) {
    ctx2.font = `${Math.floor(S * 0.032)}px serif`; ctx2.textAlign = "center"; ctx2.textBaseline = "middle";
    ctx2.fillStyle = ctx2 === g ? css(def.runeGlow, alpha) : css(def.runeGlow);
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      ctx2.save(); ctx2.translate(cx + Math.cos(a) * runeR, cy + Math.sin(a) * runeR);
      ctx2.rotate(a + Math.PI / 2); ctx2.fillText(runes[i % runes.length], 0, 0); ctx2.restore();
    }
    // double ring around the runes
    ctx2.strokeStyle = ctx2.fillStyle; ctx2.lineWidth = 6;
    ctx2.beginPath(); ctx2.arc(cx, cy, rad * 0.925, 0, Math.PI * 2); ctx2.stroke();
    ctx2.lineWidth = 3; ctx2.beginPath(); ctx2.arc(cx, cy, rad * 0.845, 0, Math.PI * 2); ctx2.stroke();
  }

  // center motif per realm
  const motifR = rad * 0.3;
  const motif = (ctx2, strong) => {
    ctx2.save(); ctx2.translate(cx, cy);
    ctx2.strokeStyle = css(def.runeGlow, strong ? 1 : 0.85); ctx2.lineWidth = 8;
    ctx2.beginPath(); ctx2.arc(0, 0, motifR, 0, Math.PI * 2); ctx2.stroke();
    ctx2.lineWidth = 4; ctx2.beginPath(); ctx2.arc(0, 0, motifR * 0.72, 0, Math.PI * 2); ctx2.stroke();
    if (style === "ember" || style === "solar") {          // sunburst / crown rays
      const rays = style === "solar" ? 16 : 10;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2;
        ctx2.beginPath(); ctx2.moveTo(Math.cos(a) * motifR * 0.72, Math.sin(a) * motifR * 0.72);
        ctx2.lineTo(Math.cos(a) * motifR * (i % 2 ? 1.25 : 1.45), Math.sin(a) * motifR * (i % 2 ? 1.25 : 1.45)); ctx2.stroke();
      }
    } else if (style === "ice") {                          // snowflake
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx2.beginPath(); ctx2.moveTo(0, 0); ctx2.lineTo(Math.cos(a) * motifR * 1.3, Math.sin(a) * motifR * 1.3); ctx2.stroke();
        for (const s of [0.55, 0.85]) {
          const bx = Math.cos(a) * motifR * s * 1.3, by = Math.sin(a) * motifR * s * 1.3;
          for (const off of [-0.5, 0.5]) {
            ctx2.beginPath(); ctx2.moveTo(bx, by);
            ctx2.lineTo(bx + Math.cos(a + off) * motifR * 0.22, by + Math.sin(a + off) * motifR * 0.22); ctx2.stroke();
          }
        }
      }
    } else if (style === "storm") {                        // lightning sigil
      for (let i = 0; i < 3; i++) {
        const a0 = (i / 3) * Math.PI * 2;
        ctx2.beginPath(); ctx2.moveTo(Math.cos(a0) * motifR * 0.2, Math.sin(a0) * motifR * 0.2);
        ctx2.lineTo(Math.cos(a0 + 0.5) * motifR * 0.7, Math.sin(a0 + 0.5) * motifR * 0.7);
        ctx2.lineTo(Math.cos(a0 + 0.3) * motifR * 0.75, Math.sin(a0 + 0.3) * motifR * 0.75);
        ctx2.lineTo(Math.cos(a0 + 0.85) * motifR * 1.25, Math.sin(a0 + 0.85) * motifR * 1.25); ctx2.stroke();
      }
    } else if (style === "void") {                         // void spiral
      ctx2.beginPath();
      for (let t = 0; t < Math.PI * 6; t += 0.12) {
        const rr = motifR * 1.3 * (t / (Math.PI * 6));
        const x = Math.cos(t) * rr, y = Math.sin(t) * rr;
        t === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y);
      }
      ctx2.stroke();
    }
    ctx2.restore();
  };
  motif(g, false); motif(ge, true);

  return { albedo: c, emissive: e };
}

// ---------- ambient particle field ---------------------------------------

class AmbientField {
  constructor(scene, def) {
    this.def = def; this.kind = def.particles;
    const N = this.kind === "snow" ? 420 : this.kind === "gold" ? 320 : 260;
    this.N = N;
    this.pos = new Float32Array(N * 3); this.vel = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) this.reset(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    const col = new THREE.Color(this.kind === "snow" ? 0xdff4ff : def.accent);
    this.mat = new THREE.PointsMaterial({
      color: col, size: this.kind === "snow" ? 0.16 : 0.12, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }
  reset(i, scatter) {
    const a = rand(Math.PI * 2), r = Math.sqrt(Math.random()) * (R + 8);
    const up = this.kind === "embers" || this.kind === "void";
    this.pos[i * 3] = Math.cos(a) * r;
    this.pos[i * 3 + 1] = scatter ? rand(0, 14) : (up ? rand(0, 0.5) : rand(12, 15));
    this.pos[i * 3 + 2] = Math.sin(a) * r;
    const s = this.kind === "storm" ? rand(3, 7) : rand(0.4, 1.2);
    this.vel[i * 3] = this.kind === "storm" ? s : rand(-0.25, 0.25);
    this.vel[i * 3 + 1] = up ? rand(0.7, 1.8) : this.kind === "storm" ? rand(-0.2, 0.2) : -rand(0.5, 1.4);
    this.vel[i * 3 + 2] = rand(-0.25, 0.25);
  }
  update(dt) {
    for (let i = 0; i < this.N; i++) {
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const y = this.pos[i * 3 + 1];
      if (y < -0.5 || y > 16 || Math.abs(this.pos[i * 3]) > R + 12) this.reset(i, false);
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
  dispose(scene) { scene.remove(this.points); this.points.geometry.dispose(); this.mat.dispose(); }
}

// ---------- the board ----------------------------------------------------

export class ArenaBoard {
  /** Builds the whole realm into `scene`; call update(dt) each frame, dispose() on exit. */
  constructor(scene, def) {
    this.scene = scene; this.def = def;
    this.group = new THREE.Group(); scene.add(this.group);
    this.t = 0; this.flashT = 0;
    this._disposables = [];

    scene.fog = new THREE.Fog(def.fog.color, def.fog.near, def.fog.far);

    // sky dome (vertex-gradient, inside-out sphere)
    {
      const geo = new THREE.SphereGeometry(140, 24, 16);
      const top = new THREE.Color(def.sky.top), bot = new THREE.Color(def.sky.bottom);
      const cols = [];
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const t = THREE.MathUtils.clamp(pos.getY(i) / 140 * 0.5 + 0.5, 0, 1);
        const c = bot.clone().lerp(top, t); cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false });
      const sky = new THREE.Mesh(geo, mat);
      this.group.add(sky); this._disposables.push(geo, mat);
    }

    // lights
    const hemi = new THREE.HemisphereLight(def.hemi.sky, def.hemi.ground, def.hemi.intensity);
    const sun = new THREE.DirectionalLight(def.sun.color, def.sun.intensity);
    sun.position.set(...def.sun.pos);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -26; sun.shadow.camera.right = 26;
    sun.shadow.camera.top = 26; sun.shadow.camera.bottom = -26;
    sun.shadow.camera.far = 70; sun.shadow.bias = -0.0008;
    const rim = new THREE.PointLight(def.rimGlow, 30, 60, 1.6); rim.position.set(0, 3, 0);
    this.group.add(hemi, sun, rim);
    this.sun = sun; this.stormLight = null;
    if (def.particles === "storm") {
      this.stormLight = new THREE.DirectionalLight(0xd8c8ff, 0); this.stormLight.position.set(-8, 20, 4);
      this.group.add(this.stormLight);
    }

    // floor disc
    const painted = paintFloor(def);
    const albedoTex = new THREE.CanvasTexture(painted.albedo); albedoTex.colorSpace = THREE.SRGBColorSpace; albedoTex.anisotropy = 4;
    const emisTex = new THREE.CanvasTexture(painted.emissive);
    const floorMat = new THREE.MeshStandardMaterial({
      map: albedoTex, emissiveMap: emisTex, emissive: 0xffffff, emissiveIntensity: 0.5,
      roughness: def.floor === "ice" ? 0.25 : def.floor === "solar" ? 0.35 : 0.85,
      metalness: def.floor === "solar" ? 0.35 : 0.05,
    });
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.985, 1.1, 96), floorMat);
    disc.position.y = -0.55; disc.receiveShadow = true;
    this.group.add(disc);
    this._disposables.push(albedoTex, emisTex, floorMat, disc.geometry);
    this.floorMat = floorMat;

    // ornate rim: torus + pylon crystals
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x3a3040, metalness: 0.85, roughness: 0.35 });
    const glowMat = new THREE.MeshStandardMaterial({ color: def.rimGlow, emissive: def.rimGlow, emissiveIntensity: 2.2, metalness: 0.2, roughness: 0.4 });
    this.glowMat = glowMat;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.42, 12, 96), rimMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.05;
    const ringGlow = new THREE.Mesh(new THREE.TorusGeometry(R + 0.15, 0.12, 8, 96), glowMat);
    ringGlow.rotation.x = Math.PI / 2; ringGlow.position.y = 0.28;
    this.group.add(ring, ringGlow);
    this._disposables.push(ring.geometry, ringGlow.geometry, rimMat, glowMat);

    const pylons = 10;
    for (let i = 0; i < pylons; i++) {
      const a = (i / pylons) * Math.PI * 2;
      const py = new THREE.Group();
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 1.1, 8), rimMat);
      const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), glowMat);
      crystal.position.y = 1.35; crystal.scale.y = 1.9;
      py.add(base, crystal);
      py.position.set(Math.cos(a) * (R + 0.9), 0.4, Math.sin(a) * (R + 0.9));
      this.group.add(py);
      this._disposables.push(base.geometry, crystal.geometry);
    }

    // floating-island underside (inverted cone of rock)
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x241c22, roughness: 1 });
    const under = new THREE.Mesh(new THREE.ConeGeometry(R * 0.92, 13, 24, 3), rockMat);
    under.rotation.x = Math.PI; under.position.y = -7.6;
    this.group.add(under);
    this._disposables.push(under.geometry, rockMat);

    // orbiting debris chunks
    this.debris = [];
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.4, 1.3), 0), rockMat);
      const a = rand(Math.PI * 2);
      m.userData = { a, r: rand(R + 4, R + 12), y: rand(-4, 6), spin: rand(0.2, 0.8), orbit: rand(0.02, 0.07) * pick([1, -1]) };
      this.group.add(m); this.debris.push(m);
      this._disposables.push(m.geometry);
    }

    // camera follows the player across the board — bias the follow target
    // toward center so the far rim stays in frame (handled in game.js).
    // solar god-ray cones
    if (def.particles === "gold") {
      const rayMat = new THREE.MeshBasicMaterial({ color: 0xffdf8a, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
      for (let i = 0; i < 3; i++) {
        const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 5.5, 30, 12, 1, true), rayMat);
        cone.position.set(rand(-10, 10), 14, rand(-10, 10));
        cone.rotation.z = rand(-0.18, 0.18);
        this.group.add(cone); this._disposables.push(cone.geometry);
      }
      this._disposables.push(rayMat);
    }

    this.ambient = new AmbientField(this.group, def);
  }

  /** random ground spawn point — enemies erupt anywhere on the board, near or
   *  far (a telegraph decal in the sim keeps close spawns fair) */
  spawnPoint() {
    const a = rand(Math.PI * 2);
    const r = 2.5 + Math.sqrt(Math.random()) * (BOARD_RADIUS - 3.5);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }

  update(dt) {
    this.t += dt;
    this.ambient.update(dt);
    for (const m of this.debris) {
      const u = m.userData; u.a += u.orbit * dt;
      m.position.set(Math.cos(u.a) * u.r, u.y + Math.sin(this.t * 0.6 + u.r) * 0.8, Math.sin(u.a) * u.r);
      m.rotation.x += u.spin * dt; m.rotation.y += u.spin * 0.7 * dt;
    }
    this.glowMat.emissiveIntensity = 2.0 + Math.sin(this.t * 2.2) * 0.5;
    // storm realm: random lightning flashes
    if (this.stormLight) {
      this.flashT -= dt;
      if (this.flashT <= 0 && Math.random() < 0.008) { this.stormLight.intensity = rand(2.5, 5); this.flashT = 0.1; }
      else this.stormLight.intensity = Math.max(0, this.stormLight.intensity - dt * 30);
    }
  }

  dispose() {
    this.ambient.dispose(this.group);
    this.scene.remove(this.group);
    for (const d of this._disposables) { try { d.dispose(); } catch (e) {} }
  }
}
