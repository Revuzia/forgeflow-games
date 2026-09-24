// BLOCKTOOTH — PickupView (fx lane, CONTRACT §6 / §6.1 / §3).
//
// Every pickup in `w.pickups` drawn with a handful of instanced batches (no per-pickup objects):
//   * rubble — faceted broken-concrete chunk in the biome's building colours, warm glow
//   * scrap  — faceted hex nut + bent plate, cool glow
//   * heal   — green cross token on a white backing, spins upright
//   * chest  — hazard-striped crate (canvas stripe texture) + a pulsing light beacon beam
//   * a soft additive GROUND GLOW disc under each pickup (reads at every zoom level)
//   * a sparkle TRAIL (tiny bright shards) behind pickups while they are magnetised
// Poses interpolate px/py/pz → x/y/z with FrameInfo.alpha. Resting pickups bob + spin; airborne
// ones tumble. Sizes follow the CURRENT titan height so loot stays readable after a rank-up.

import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Pickup, World } from '../core/types.ts';
import { CITY } from '../core/config.ts';
import { BIOMES } from '../data/biomes.ts';
import { addOutline, bakeOutlineNormals, facet, makeToon, OUTLINE_PX } from './materials.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';

const CAP_LOOT = CITY.maxPickups;      // rubble / scrap batches
const CAP_HEAL = 96;
const CAP_CHEST = 16;
const CAP_TRAIL = 320;
const TRAIL_LIFE = 0.38;
/** pickup body size as a fraction of titan height */
const SIZE_H = 0.15;

function hash01(i: number, salt: number): number {
  let h = (i * 374761393 + salt * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function paint(g: THREE.BufferGeometry, fn: (tri: number, cx: number, cy: number, cz: number) => [number, number, number]): void {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const n = pos.count;
  const col = new Float32Array(n * 3);
  for (let t = 0; t < n / 3; t++) {
    const a = t * 3;
    const cx = (pos.getX(a) + pos.getX(a + 1) + pos.getX(a + 2)) / 3;
    const cy = (pos.getY(a) + pos.getY(a + 1) + pos.getY(a + 2)) / 3;
    const cz = (pos.getZ(a) + pos.getZ(a + 1) + pos.getZ(a + 2)) / 3;
    const [r, gg, b] = fn(t, cx, cy, cz);
    for (let k = 0; k < 3; k++) { col[(a + k) * 3] = r; col[(a + k) * 3 + 1] = gg; col[(a + k) * 3 + 2] = b; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function finish(g: THREE.BufferGeometry): THREE.BufferGeometry {
  bakeOutlineNormals(g);
  g.computeBoundingSphere();
  return g;
}

/** broken concrete chunk (unit size) */
function rubbleGeometry(): THREE.BufferGeometry {
  let g: THREE.BufferGeometry = new THREE.IcosahedronGeometry(0.55, 0);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) * (0.85 + hash01(i, 3) * 0.35), p.getY(i) * (0.7 + hash01(i, 5) * 0.3), p.getZ(i) * (0.85 + hash01(i, 7) * 0.35));
  }
  g = facet(g);
  paint(g, (t, _x, y) => { const v = y > 0.15 ? 1 : 0.78 + 0.12 * hash01(t, 9); return [v, v, v]; });
  return finish(g);
}

/** hex nut + bent plate (unit size), vertex-painted steel + safety orange */
function scrapGeometry(): THREE.BufferGeometry {
  const nut = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 6).toNonIndexed();
  nut.rotateX(Math.PI / 2); nut.rotateY(0.4); nut.translate(-0.12, 0.08, 0);
  const plate = new THREE.BoxGeometry(0.62, 0.1, 0.4).toNonIndexed();
  plate.rotateZ(0.5); plate.rotateY(-0.5); plate.translate(0.16, -0.06, 0.05);
  const bolt = new THREE.CylinderGeometry(0.08, 0.08, 0.7, 5).toNonIndexed();
  bolt.rotateZ(1.2); bolt.translate(0.02, 0.02, -0.18);
  const parts = [nut, plate, bolt];
  const cols: [number, number, number][] = [[0.78, 0.82, 0.87], [0.98, 0.52, 0.22], [0.62, 0.66, 0.72]];
  let total = 0;
  for (const q of parts) { q.deleteAttribute('uv'); q.deleteAttribute('normal'); total += q.getAttribute('position').count; }
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  parts.forEach((q, pi) => {
    const a = q.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++, o++) {
      pos[o * 3] = a.getX(i); pos[o * 3 + 1] = a.getY(i); pos[o * 3 + 2] = a.getZ(i);
      const c = cols[pi];
      col[o * 3] = c[0]; col[o * 3 + 1] = c[1]; col[o * 3 + 2] = c[2];
    }
    q.dispose();
  });
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g = facet(g);
  return finish(g);
}

function plusShape(arm: number, len: number): THREE.Shape {
  const s = new THREE.Shape();
  const a = arm / 2, l = len / 2;
  s.moveTo(-a, l); s.lineTo(a, l); s.lineTo(a, a); s.lineTo(l, a); s.lineTo(l, -a); s.lineTo(a, -a);
  s.lineTo(a, -l); s.lineTo(-a, -l); s.lineTo(-a, -a); s.lineTo(-l, -a); s.lineTo(-l, a); s.lineTo(-a, a); s.lineTo(-a, l);
  return s;
}

/** green cross on a white backing plate (unit size, stands upright, faces ±Z) */
function healGeometry(): THREE.BufferGeometry {
  const back = new THREE.ExtrudeGeometry(plusShape(0.5, 1.0), { depth: 0.2, bevelEnabled: false });
  back.translate(0, 0, -0.1);
  const front = new THREE.ExtrudeGeometry(plusShape(0.3, 0.8), { depth: 0.34, bevelEnabled: false });
  front.translate(0, 0, -0.17);
  // ExtrudeGeometry is already non-indexed in r186 (toNonIndexed() on it only logs a warning)
  const a = back.index ? back.toNonIndexed() : back, b = front.index ? front.toNonIndexed() : front;
  if (a !== back) back.dispose();
  if (b !== front) front.dispose();
  const pa = a.getAttribute('position') as THREE.BufferAttribute, pb = b.getAttribute('position') as THREE.BufferAttribute;
  const n = pa.count + pb.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  const white = new THREE.Color('#f7f4ea'), green = new THREE.Color('#3fd46a');
  for (let i = 0; i < n; i++) {
    const src = i < pa.count ? pa : pb, j = i < pa.count ? i : i - pa.count;
    pos[i * 3] = src.getX(j); pos[i * 3 + 1] = src.getY(j); pos[i * 3 + 2] = src.getZ(j);
    const c = i < pa.count ? white : green;
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g = facet(g);
  a.dispose(); b.dispose();
  return finish(g);
}

/** crate (unit: 1 × 0.8 × 0.8, base at y = −0.4) with UVs for the hazard-stripe texture */
function chestGeometry(): THREE.BufferGeometry {
  const body = new THREE.BoxGeometry(1, 0.8, 0.8);
  const g = body.toNonIndexed();
  body.dispose();
  g.computeVertexNormals();
  return finish(g);
}

function hazardTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffc93c'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#1b1426';
  for (let i = -128; i < 256; i += 32) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 16, 0); x.lineTo(i + 16 + 128, 128); x.lineTo(i + 128, 128); x.closePath(); x.fill();
  }
  // frame + a cream label plate in the middle
  x.lineWidth = 14; x.strokeStyle = '#3a2f22'; x.strokeRect(7, 7, 114, 114);
  x.fillStyle = '#f4ecd8'; x.fillRect(34, 46, 60, 36);
  x.lineWidth = 4; x.strokeStyle = '#1b1426'; x.strokeRect(34, 46, 60, 36);
  x.fillStyle = '#ff6f5e'; x.fillRect(58, 52, 12, 24);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  vUv = uv;
  vCol = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #endif
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}`;
const GLOW_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float a = smoothstep(1.0, 0.15, r);
  a *= a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * a * uOpacity, 1.0);
  #include <colorspace_fragment>
}`;

const BEAM_VERT = /* glsl */ `
varying float vY;
varying vec3 vCol;
void main() {
  vY = position.y + 0.5;
  vCol = vec3(1.0);
  #ifdef USE_INSTANCING_COLOR
    vCol = instanceColor;
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const BEAM_FRAG = /* glsl */ `
uniform float uTime;
varying float vY;
varying vec3 vCol;
void main() {
  float a = (1.0 - vY) * (1.0 - vY) * (0.32 + 0.14 * sin(uTime * 6.0 - vY * 14.0));
  gl_FragColor = vec4(vCol * a, 1.0);
  #include <colorspace_fragment>
}`;

interface Trail { x: number; y: number; z: number; t: number; s: number; r: number; g: number; b: number; }

export class PickupView implements ViewModule {
  private readonly ctx: ViewCtx;
  private readonly root = new THREE.Group();
  private rubble: THREE.InstancedMesh | null = null;
  private scrap: THREE.InstancedMesh | null = null;
  private heal: THREE.InstancedMesh | null = null;
  private chest: THREE.InstancedMesh | null = null;
  private beam: THREE.InstancedMesh | null = null;
  private glow: THREE.InstancedMesh | null = null;
  private trail: THREE.InstancedMesh | null = null;
  private trails: Trail[] = [];
  private trailCursor = 0;
  private disposables: { dispose(): void }[] = [];
  private beamMat: THREE.ShaderMaterial | null = null;
  private rubbleCols: THREE.Color[] = [];
  // scratch
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly eul = new THREE.Euler();
  private readonly p3 = new THREE.Vector3();
  private readonly s3 = new THREE.Vector3();
  private readonly col = new THREE.Color();

  constructor(ctx: ViewCtx) { this.ctx = ctx; this.root.name = 'pickups'; }

  mount(w: World): void {
    const pal = BIOMES[w.biomeId].palette;
    const night = BIOMES[w.biomeId].time === 'night';
    // rubble reads as LOOT: the biome's building colours pushed toward a warm amber
    this.rubbleCols = [pal.bodyA, pal.bodyB, pal.bodyC, pal.roofA].map((h) => new THREE.Color(h).lerp(new THREE.Color('#ffc24a'), 0.55));

    const mk = (geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string, outline: number | null): THREE.InstancedMesh => {
      const im = new THREE.InstancedMesh(geo, mat, cap);
      im.name = name;
      im.count = 0;
      im.frustumCulled = false;          // pickups are scattered over the whole view; one batch
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (outline) addOutline(im, outline);
      this.root.add(im);
      this.disposables.push(geo, mat);
      return im;
    };

    const rubbleMat = makeToon({ vertexColors: true, emissive: '#ff9f2e', emissiveIntensity: night ? 0.38 : 0.24 });
    this.rubble = mk(rubbleGeometry(), rubbleMat, CAP_LOOT, 'pickup:rubble', OUTLINE_PX.prop);
    this.rubble.setColorAt(0, this.col.setRGB(1, 1, 1));
    const scrapMat = makeToon({ vertexColors: true, emissive: '#3fd8ff', emissiveIntensity: night ? 0.32 : 0.2 });
    this.scrap = mk(scrapGeometry(), scrapMat, CAP_LOOT, 'pickup:scrap', OUTLINE_PX.prop);
    this.scrap.setColorAt(0, this.col.setRGB(1, 1, 1));
    const healMat = makeToon({ vertexColors: true, emissive: '#3fd46a', emissiveIntensity: 0.2 });
    this.heal = mk(healGeometry(), healMat, CAP_HEAL, 'pickup:heal', OUTLINE_PX.enemy);
    const tex = hazardTexture();
    this.disposables.push(tex);
    const chestMat = makeToon({ color: '#ffffff', emissive: '#ffc93c', emissiveIntensity: 0.08 });
    chestMat.map = tex;
    this.chest = mk(chestGeometry(), chestMat, CAP_CHEST, 'pickup:chest', OUTLINE_PX.enemy);

    this.beamMat = new THREE.ShaderMaterial({
      name: 'pickupBeacon', vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG,
      uniforms: { uTime: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beam = mk(new THREE.CylinderGeometry(0.5, 0.5, 1, 14, 1, true), this.beamMat, CAP_CHEST, 'pickup:beacon', null);
    this.beam.setColorAt(0, this.col.set('#ffd166'));
    this.beam.renderOrder = 3;

    const glowMat = new THREE.ShaderMaterial({
      name: 'pickupGlow', vertexShader: GLOW_VERT, fragmentShader: GLOW_FRAG,
      uniforms: { uOpacity: { value: night ? 0.9 : 0.6 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const disc = new THREE.PlaneGeometry(1, 1);
    disc.rotateX(-Math.PI / 2);
    this.glow = mk(disc, glowMat, CAP_LOOT + CAP_HEAL + CAP_CHEST, 'pickup:glow', null);
    this.glow.setColorAt(0, this.col.setRGB(1, 1, 1));
    this.glow.renderOrder = 1;

    const trailMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    this.trail = mk(new THREE.OctahedronGeometry(0.5, 0), trailMat, CAP_TRAIL, 'pickup:trail', null);
    this.trail.setColorAt(0, this.col.setRGB(1, 1, 1));
    this.trails.length = 0;

    for (const im of [this.rubble, this.scrap, this.heal, this.chest, this.beam, this.glow, this.trail]) {
      im.castShadow = false; im.receiveShadow = im === this.rubble || im === this.scrap || im === this.chest;
    }
    this.ctx.scene.add(this.root);
  }

  update(w: World, f: FrameInfo): void {
    if (!this.rubble || !this.scrap || !this.heal || !this.chest || !this.beam || !this.glow || !this.trail) return;
    const H = w.titan.height;
    const base = H * SIZE_H;
    const a = f.alpha;
    const time = f.time;
    const q = this.ctx.quality.level;
    let nR = 0, nS = 0, nH = 0, nC = 0, nG = 0;
    const trailRate = q === 0 ? 10 : q === 1 ? 18 : 28;      // shards / s per magnetised pickup

    for (let i = 0; i < w.pickups.length; i++) {
      const p: Pickup = w.pickups[i];
      if (!p.alive) continue;
      const x = p.px + (p.x - p.px) * a, y = p.py + (p.y - p.py) * a, z = p.pz + (p.z - p.pz) * a;
      const ph = hash01(p.id, 1) * 6.283;
      const grounded = y < 0.02 * H + 0.01;
      const sizeK = 0.85 + 0.3 * Math.min(1, Math.log10(1 + Math.max(0, p.mass)) / 2.5);
      let s = base * sizeK;
      const bob = grounded ? (0.16 + 0.05 * Math.sin(time * 3.1 + ph)) * H * 0.6 : 0;
      const lift = y + bob + s * 0.5;
      let spinY = time * 1.9 + ph, tilt = 0.35;
      if (!grounded) { spinY = time * 7 + ph; tilt = time * 6 + ph; }
      if (p.magnet) { s *= 0.92; tilt = time * 9 + ph; }

      switch (p.kind) {
        case 'rubble': case 'scrap': {
          const im = p.kind === 'rubble' ? this.rubble : this.scrap;
          const idx = p.kind === 'rubble' ? nR++ : nS++;
          if (idx >= CAP_LOOT) break;
          this.eul.set(tilt, spinY, tilt * 0.6);
          this.q.setFromEuler(this.eul);
          this.p3.set(x, lift, z);
          this.s3.set(s, s, s);
          this.m4.compose(this.p3, this.q, this.s3);
          im.setMatrixAt(idx, this.m4);
          if (p.kind === 'rubble') this.col.copy(this.rubbleCols[p.id % this.rubbleCols.length]);
          else { const v = 0.82 + 0.18 * hash01(p.id, 4); this.col.setRGB(v, v, v); }
          im.setColorAt(idx, this.col);
          this.addGlow(nG++, x, z, s * 2.6, p.kind === 'rubble' ? 0xffc862 : 0x6ff3ff, 0.8 + 0.2 * Math.sin(time * 4 + ph));
          break;
        }
        case 'heal': {
          if (nH >= CAP_HEAL) break;
          const hs = s * 1.5;
          this.eul.set(0, time * 2.6 + ph, 0);
          this.q.setFromEuler(this.eul);
          this.p3.set(x, y + bob + hs * 0.65, z);
          this.s3.set(hs, hs, hs);
          this.m4.compose(this.p3, this.q, this.s3);
          this.heal.setMatrixAt(nH++, this.m4);
          this.addGlow(nG++, x, z, hs * 2.4, 0x5cff86, 1);
          break;
        }
        case 'chest': {
          if (nC >= CAP_CHEST) break;
          const cs = Math.max(s * 2.2, 0.5);
          this.eul.set(0, ph + Math.sin(time * 1.3 + ph) * 0.25, 0);
          this.q.setFromEuler(this.eul);
          this.p3.set(x, y + cs * 0.4 + (grounded ? Math.abs(Math.sin(time * 2.2 + ph)) * cs * 0.12 : 0), z);
          this.s3.set(cs, cs, cs);
          this.m4.compose(this.p3, this.q, this.s3);
          this.chest.setMatrixAt(nC, this.m4);
          // beacon: a tall pulsing beam so an elite's chest can be found from across the block
          const bh = H * 6 + 3, br = cs * (0.4 + 0.06 * Math.sin(time * 5));
          this.q.identity();
          this.p3.set(x, bh * 0.5, z);
          this.s3.set(br, bh, br);
          this.m4.compose(this.p3, this.q, this.s3);
          this.beam.setMatrixAt(nC, this.m4);
          this.beam.setColorAt(nC, this.col.set(this.ctx.quality.reduceFlashing ? 0xc9a24a : 0xffd166));
          nC++;
          this.addGlow(nG++, x, z, cs * 3.2, 0xffd166, 1);
          break;
        }
      }
      // sparkle trail while magnetised (cosmetic randomness is fine in views)
      if (p.magnet && !f.frozen && Math.random() < trailRate * f.dt) {
        const c = p.kind === 'scrap' ? 0x9ffcff : p.kind === 'heal' ? 0x9dffb0 : 0xffe28a;
        this.col.set(c);
        this.pushTrail(x + (Math.random() - 0.5) * s, lift + (Math.random() - 0.5) * s, z + (Math.random() - 0.5) * s, s * 0.35);
      }
    }

    // trail shards: shrink + drift up (fixed pool; dead shards have t >= TRAIL_LIFE)
    const dt = f.frozen ? 0 : f.dt;
    let nT = 0;
    for (let i = 0; i < this.trails.length; i++) {
      const t = this.trails[i];
      if (t.t >= TRAIL_LIFE) continue;
      t.t += dt;
      if (t.t >= TRAIL_LIFE) continue;
      const k = 1 - t.t / TRAIL_LIFE;
      t.y += dt * H * 0.4;
      this.eul.set(time * 5 + i, time * 3, 0);
      this.q.setFromEuler(this.eul);
      this.p3.set(t.x, t.y, t.z);
      const ss = t.s * k;
      this.s3.set(ss, ss * 1.6, ss);
      this.m4.compose(this.p3, this.q, this.s3);
      this.trail.setMatrixAt(nT, this.m4);
      this.trail.setColorAt(nT, this.col.setRGB(t.r, t.g, t.b));
      nT++;
    }

    this.rubble.count = Math.min(nR, CAP_LOOT);
    this.scrap.count = Math.min(nS, CAP_LOOT);
    this.heal.count = nH;
    this.chest.count = nC;
    this.beam.count = nC;
    this.glow.count = Math.min(nG, this.glow.instanceMatrix.count);
    this.trail.count = nT;
    for (const im of [this.rubble, this.scrap, this.heal, this.chest, this.beam, this.glow, this.trail]) {
      im.visible = im.count > 0;
      if (im.count > 0) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    if (this.beamMat) this.beamMat.uniforms.uTime.value = this.ctx.quality.reduceFlashing ? 0 : time;
  }

  unmount(): void {
    this.root.removeFromParent();
    for (const im of [this.rubble, this.scrap, this.heal, this.chest, this.beam, this.glow, this.trail]) im?.dispose();
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.root.clear();
    this.rubble = this.scrap = this.heal = this.chest = this.beam = this.glow = this.trail = null;
    this.beamMat = null;
    this.trails.length = 0;
  }

  // ─────────────────────────────── internals ───────────────────────────────
  private addGlow(i: number, x: number, z: number, d: number, hex: number, k: number): void {
    const g = this.glow!;
    if (i >= g.instanceMatrix.count) return;
    this.q.identity();
    this.p3.set(x, 0.04, z);
    this.s3.set(d, 1, d);
    this.m4.compose(this.p3, this.q, this.s3);
    g.setMatrixAt(i, this.m4);
    this.col.set(hex).multiplyScalar(k);
    g.setColorAt(i, this.col);
  }

  /** push a trail shard using the colour currently in this.col (fixed pool, rotating cursor) */
  private pushTrail(x: number, y: number, z: number, s: number): void {
    if (this.trails.length === 0) {
      for (let i = 0; i < CAP_TRAIL; i++) this.trails.push({ x: 0, y: 0, z: 0, t: TRAIL_LIFE, s: 0, r: 1, g: 1, b: 1 });
    }
    let t = this.trails[this.trailCursor];
    for (let k = 0; k < 8 && t.t < TRAIL_LIFE; k++) { this.trailCursor = (this.trailCursor + 1) % CAP_TRAIL; t = this.trails[this.trailCursor]; }
    this.trailCursor = (this.trailCursor + 1) % CAP_TRAIL;
    t.x = x; t.y = y; t.z = z; t.t = 0; t.s = s;
    t.r = this.col.r; t.g = this.col.g; t.b = this.col.b;
  }
}
