// GENESIS — miracles, seen (CONTRACT.md §11.1, §15.7): every 'miracle' event of the sim (data.kind) becomes a moment:
//   water      a dark cloud gathering over the place and a column of rain falling from it, ripples where it lands
//   food       a bounty of fruit and loaves falling from the sky and bouncing, golden sparkle
//   heal       golden motes rising and spiralling through the people, a ring of warm light spreading on the ground
//   forest     a green wave rolling out over the land, leaves and pollen swirling up (the trees are the sim's)
//   storm      black clouds boiling together and the first bolts (the thunderstorm itself is the sim's weather)
//   fire       a tongue of fire falling from the sky and bursting where it lands
//   shield     a dome of light over the place for as long as it holds (the 'shield' event's until tick), its base ring
//   lightning  a bolt (the 'lightning' event; GodFx strikes it) and scorched ground
//   fertility  green-gold motes and a swelling ring
//   calm       pale blue ripples spreading, soft motes, a gentle light
//   teach      threads of light from the sky into the heads of the people there, sparkling where they enter
//   wood       logs tumbling down into a stack
// The hand casts: GodFx turns the hand to its cast pose when a miracle lands near it.

import { BufferAttribute, BufferGeometry, DoubleSide, Group, Mesh, ShaderMaterial, Vector3, type IUniform } from 'three';
import type { SimEvent } from '../../sim/types.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { DECAL, decal } from './decals.ts';
import { SYS } from './vfx.ts';
import { Dome, Fireball } from './meshfx.ts';
import { frameAt, type FxCtx } from './disasters.ts';
import { ADD_LIGHT, FX_DEPTH_GLSL, FX_LAYER, clamp01, smooth } from './fxcommon.ts';

interface Shield { id: number; p: Vector3; r: number; until: number; dome: Dome; fade: number; hit: number }
interface Moment { t0: number; dur: number; step(age: number, k: number, ctx: FxCtx): void; end?(): void }

const BEAM_VERT = /* glsl */ `
attribute float aT;
attribute float aSide;
uniform vec3 uCamB;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  vT = aT; vSide = aSide;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
const BEAM_FRAG = /* glsl */ `
${FX_DEPTH_GLSL}
uniform float uK;
uniform vec3 uCol;
varying float vT;
varying float vSide;
varying float vZ;
void main() {
  float vis = fxSoft(vZ, 1.0);
  float x = abs(vSide);
  float core = exp(-x * x * 30.0), halo = exp(-x * x * 3.0);
  // light pours down the thread: pulses travelling to the head
  float pulse = 0.6 + 0.4 * sin(vT * 40.0 + uFxTime * 9.0);
  float k = (core * 3.0 + halo * 0.6) * pulse * uK * vis * smoothstep(0.0, 0.08, vT) * (0.5 + 0.5 * vT);
  gl_FragColor = vec4(uCol * k * 4.0 * fxDisplay(0.7), 0.0);
}
`;

/** thin camera-facing threads of light from the sky down to points (teaching) */
class Beams {
  readonly mesh: Mesh;
  private geo = new BufferGeometry();
  private pos: Float32Array;
  readonly u = { uK: { value: 0 }, uCol: { value: new Vector3(1, 0.85, 0.5) }, uCamB: { value: new Vector3() } };
  constructor(fx: Record<string, IUniform>, n: number) {
    const S = 24;
    this.pos = new Float32Array(n * (S + 1) * 2 * 3);
    const t = new Float32Array(n * (S + 1) * 2), side = new Float32Array(n * (S + 1) * 2);
    const idx: number[] = [];
    for (let b = 0; b < n; b++) for (let i = 0; i <= S; i++) {
      const k = (b * (S + 1) + i) * 2;
      t[k] = t[k + 1] = i / S; side[k] = 1; side[k + 1] = -1;
      if (i < S) idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
    this.geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aT', new BufferAttribute(t, 1));
    this.geo.setAttribute('aSide', new BufferAttribute(side, 1));
    this.geo.setIndex(idx);
    this.mesh = new Mesh(this.geo, new ShaderMaterial({ vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, uniforms: { ...this.u, ...fx }, transparent: true, depthTest: false, depthWrite: false, ...ADD_LIGHT, side: DoubleSide }));
    this.mesh.frustumCulled = false; this.mesh.matrixAutoUpdate = false; this.mesh.layers.set(FX_LAYER);
  }
  /** threads from tops to heads (body m), width w */
  set(tops: Vector3[], heads: Vector3[], cam: Vector3, w: number): void {
    const S = 24;
    const n = Math.min(tops.length, this.pos.length / ((S + 1) * 6));
    for (let b = 0; b < n; b++) {
      const a = tops[b], h = heads[b];
      for (let i = 0; i <= S; i++) {
        const t = i / S;
        // a gentle curve: the thread bows a little
        const p = _p.copy(a).lerp(h, t).addScaledVector(_q.copy(a).normalize(), Math.sin(t * Math.PI) * a.distanceTo(h) * 0.04);
        const dir = _d.copy(h).sub(a).normalize();
        const side = _s.crossVectors(dir, _v.copy(cam).sub(p)).normalize().multiplyScalar(w * (0.6 + 0.4 * t));
        const k = (b * (S + 1) + i) * 6;
        this.pos[k] = p.x + side.x; this.pos[k + 1] = p.y + side.y; this.pos[k + 2] = p.z + side.z;
        this.pos[k + 3] = p.x - side.x; this.pos[k + 4] = p.y - side.y; this.pos[k + 5] = p.z - side.z;
      }
    }
    this.geo.setDrawRange(0, n * S * 6);
    (this.geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }
  dispose(): void { this.geo.dispose(); (this.mesh.material as ShaderMaterial).dispose(); }
}

const _p = new Vector3(), _q = new Vector3(), _d = new Vector3(), _s = new Vector3(), _v = new Vector3();

export class MiracleFx {
  readonly group = new Group();
  private shields = new Map<number, Shield>();
  private moments: Moment[] = [];
  private fx: Record<string, IUniform>;

  constructor(fx: Record<string, IUniform>) {
    this.fx = fx;
    this.group.name = 'miracles';
    this.group.matrixAutoUpdate = false;
  }

  onEvent(e: SimEvent, ctx: FxCtx): void {
    if (!e.pos) return;
    const pv = ctx.pv;
    const u = new Vector3(e.pos[0], e.pos[1], e.pos[2]).normalize();
    const g = u.clone().multiplyScalar(groundHeight(pv.ground, u.x, u.y, u.z));
    if (e.t === 'shield') {
      const id = Number((e.data as { id?: number } | undefined)?.id ?? Math.random() * 1e9);
      const dome = new Dome(this.fx);
      this.group.add(dome.mesh);
      this.shields.set(id, { id, p: g, r: Math.max(20, e.a ?? 200), until: e.b ?? 0, dome, fade: 0, hit: 0 });
      return;
    }
    if (e.t !== 'miracle') return;
    const kind = String((e.data as { kind?: string } | undefined)?.kind ?? e.text ?? '');
    const R = Math.max(20, e.a ?? 150);
    const now = ctx.now;
    const v = ctx.vfx;
    const em = (d: Parameters<typeof v.emit>[0]) => v.emit(d, now);
    switch (kind) {
      case 'water': {
        const H = Math.min(260, 80 + R * 0.5);
        em({ sys: SYS.cloud, x: g.x, y: g.y, z: g.z, size: R * 0.35, life: 16, count: 160, p0: R * 0.55, p1: H, duration: 12, r: 0.32, g: 0.34, b: 0.38 });
        em({ sys: SYS.rainCol, x: g.x, y: g.y, z: g.z, size: 0.05, life: 1.6, count: Math.round(1600 * ctx.q), p0: R * 0.5, p1: H, duration: 12, r: 0.7, g: 0.75, b: 0.82, t0: now + 1.2 });
        em({ sys: SYS.splash, x: g.x, y: g.y, z: g.z, size: 0.3, life: 0.4, count: 200, p0: 400, duration: 12, r: 0.75, g: 0.8, b: 0.85, t0: now + 2 });
        this.ring(g, R * 0.5, [0.45, 0.6, 0.75], 6, false, ctx);
        break;
      }
      case 'food': case 'wood': {
        em({ sys: SYS.bounty, x: g.x, y: g.y, z: g.z, size: kind === 'wood' ? 0.45 : 0.3, life: 3.2, count: kind === 'wood' ? 90 : 160, p0: R * 0.3, p1: 70, p2: kind === 'wood' ? 1 : 0, duration: 3, r: 0.32, g: 0.2, b: 0.1 });
        em({ sys: SYS.sparkle, x: g.x, y: g.y, z: g.z, size: 0.4, life: 4, count: 140, p0: R * 0.35, p1: 40, r: 1, g: 0.85, b: 0.45, duration: 3 });
        break;
      }
      case 'heal': {
        em({ sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.45, life: 5, count: Math.round(500 * ctx.q), p0: R * 0.6, p1: 0, r: 1, g: 0.8, b: 0.4, duration: 5 });
        this.ring(g, R, [1, 0.78, 0.4], 5, true, ctx);
        this.light(g, R * 1.5, [1, 0.8, 0.5], 4e3 * R * R / 25600, 5);
        break;
      }
      case 'forest': {
        this.ring(g, R * 1.1, [0.35, 0.85, 0.3], 6, true, ctx);
        em({ sys: SYS.leaves, x: g.x, y: g.y, z: g.z, size: 0.5, life: 6, count: 260, p0: R * 0.7, r: 0.2, g: 0.42, b: 0.08, duration: 5 });
        em({ sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.4, life: 5, count: 260, p0: R * 0.8, r: 0.6, g: 1, b: 0.4, duration: 5 });
        break;
      }
      case 'fertility': {
        this.ring(g, R, [0.7, 0.95, 0.35], 6, true, ctx);
        em({ sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.5, life: 6, count: 380, p0: R * 0.7, r: 0.75, g: 1, b: 0.45, duration: 5 });
        em({ sys: SYS.leaves, x: g.x, y: g.y, z: g.z, size: 0.35, life: 5, count: 140, p0: R * 0.5, r: 0.8, g: 0.75, b: 0.3, duration: 4 });
        break;
      }
      case 'calm': {
        for (let i = 0; i < 3; i++) this.ring(g, R, [0.55, 0.75, 1], 7, true, ctx, i * 1.4);
        em({ sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.5, life: 7, count: 260, p0: R * 0.5, r: 0.6, g: 0.8, b: 1, duration: 5 });
        this.light(g, R, [0.6, 0.8, 1], 2e3 * R * R / 250000, 6);
        break;
      }
      case 'storm': {
        em({ sys: SYS.cloud, x: g.x, y: g.y, z: g.z, size: R * 0.3, life: 30, count: 320, p0: R * 0.8, p1: 230, duration: 18, r: 0.18, g: 0.19, b: 0.22 });
        for (let i = 0; i < 3; i++) {
          this.moments.push({ t0: now + 2 + i * 1.7, dur: 0.1, step: (_a, _k, c) => {
            const a = Math.random() * 6.283, r = Math.random() * R * 0.6;
            const pu = u.clone().multiplyScalar(pv.params.radius).add(_v.set(Math.cos(a) * r, 0, Math.sin(a) * r)).normalize();
            const gp = pu.clone().multiplyScalar(groundHeight(pv.ground, pu.x, pu.y, pu.z));
            c.bolts.strike(gp.clone().addScaledVector(pu, 240), gp, c.now, 1, 6);
            c.thunder(gp, 1);
          } });
        }
        break;
      }
      case 'fire': {
        // a tongue of fire falls from the sky; where it lands it bursts
        const top = g.clone().addScaledVector(u, 160);
        this.moments.push({
          t0: now, dur: 1.0, step: (age, _k, c) => {
            const at = top.clone().lerp(g, Math.min(1, age / 0.8));
            c.vfx.emit({ sys: SYS.embers, x: at.x, y: at.y, z: at.z, size: 1.2, life: 1.5, count: 24, p0: 2, p1: 3, burst: true }, c.now);
          }, end: () => this.burst(g, R * 0.5, ctx),
        });
        em({ sys: SYS.flash, x: top.x, y: top.y, z: top.z, size: 30, life: 1.0, count: 1, p1: 30, burst: true, r: 1, g: 0.6, b: 0.2 });
        break;
      }
      case 'teach': {
        // threads of light into the heads of the people there
        const A = pv.agents;
        const heads: Vector3[] = [];
        if (A) {
          for (let i = 0; i < A.count && heads.length < 8; i++) {
            const ax = A.pos[i * 3], ay = A.pos[i * 3 + 1], az = A.pos[i * 3 + 2];
            const d = Math.acos(Math.max(-1, Math.min(1, (ax * u.x + ay * u.y + az * u.z) / (Math.hypot(ax, ay, az) || 1)))) * pv.params.radius;
            if (d > R * 1.2) continue;
            const hu = new Vector3(ax, ay, az).normalize();
            heads.push(hu.clone().multiplyScalar(groundHeight(pv.ground, hu.x, hu.y, hu.z) + 1.75));
          }
        }
        if (!heads.length) heads.push(g.clone().addScaledVector(u, 1.8));
        const tops = heads.map((h) => h.clone().addScaledVector(u, 140).addScaledVector(_v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5), 25));
        const beams = new Beams(this.fx, 8);
        this.group.add(beams.mesh);
        this.moments.push({
          t0: now, dur: 5, step: (age, k, c) => {
            beams.set(tops, heads, c.camBody, Math.max(0.15, c.camBody.distanceTo(heads[0]) * 0.0025));
            beams.u.uK.value = smooth(0, 0.6, age) * (1 - smooth(0.7, 1, k));
            (beams.u.uCamB.value as Vector3).copy(c.camBody);
          }, end: () => { this.group.remove(beams.mesh); beams.dispose(); },
        });
        for (const h of heads) em({ sys: SYS.sparkle, x: h.x, y: h.y, z: h.z, size: 0.25, life: 3, count: 40, p0: 0.6, p1: 0.5, r: 1, g: 0.9, b: 0.6, duration: 4 });
        break;
      }
      default: {
        // any other miracle (an invented one): a ring of light and motes
        this.ring(g, R, [1, 0.9, 0.7], 5, true, ctx);
        em({ sys: SYS.motes, x: g.x, y: g.y, z: g.z, size: 0.4, life: 5, count: 240, p0: R * 0.6, r: 1, g: 0.9, b: 0.7, duration: 4 });
      }
    }
  }

  /** an expanding ring of light (or a soft one under it) over dur seconds */
  private ring(g: Vector3, R: number, col: [number, number, number], dur: number, light: boolean, _ctx: FxCtx, delay = 0): void {
    const t0 = (_ctx.now) + delay;
    this.moments.push({
      t0, dur, step: (age, k, c) => {
        const r = R * smooth(0, 1, Math.min(1, age / (dur * 0.7)));
        const d = decal(light ? DECAL.ripple : DECAL.ring, [g.x, g.y, g.z], r + R * 0.2);
        d.cr = col[0]; d.cg = col[1]; d.cb = col[2]; d.ca = 1 - k;
        d.p0 = r; d.p1 = Math.max(2, R * 0.06); d.p2 = (1 - k) * 2.2; d.q0 = Math.max(6, R * 0.25);
        c.decals.add(d);
      },
    });
  }

  private light(g: Vector3, reach: number, col: [number, number, number], I: number, dur: number): void {
    this.moments.push({
      t0: -1, dur, step: (age, k, c) => {
        const d = decal(DECAL.light, [g.x, g.y, g.z], reach);
        d.cr = col[0]; d.cg = col[1]; d.cb = col[2]; d.p0 = reach; d.p1 = I * Math.sin(Math.PI * Math.min(1, k)) * Math.min(1, age * 2); d.p2 = reach * 0.2; d.p3 = reach * 0.2;
        c.decals.add(d);
      },
    });
  }

  private burst(g: Vector3, R: number, ctx: FxCtx): void {
    const fb = new Fireball(this.fx);
    this.group.add(fb.mesh);
    const up = g.clone().normalize();
    ctx.vfx.emit({ sys: SYS.embers, x: g.x, y: g.y, z: g.z, size: 0.8, life: 5, count: 160, p0: R * 0.3, p1: 10, burst: true }, ctx.now);
    this.moments.push({
      t0: ctx.now, dur: 2.5, step: (age, k, c) => {
        const r = R * (0.3 + 0.7 * (1 - Math.exp(-age * 3)));
        fb.mesh.matrix.makeScale(r, r, r).setPosition(g.x + up.x * r * 0.6, g.y + up.y * r * 0.6, g.z + up.z * r * 0.6);
        fb.mesh.matrixWorldNeedsUpdate = true;
        fb.u.uHeat.value = 1 - k; fb.u.uK.value = Math.min(1, age * 8) * (1 - smooth(0.6, 1, k));
        const d = decal(DECAL.light, [g.x, g.y, g.z], R * 8);
        d.cr = 1; d.cg = 0.5; d.cb = 0.15; d.p0 = R * 8; d.p1 = 2e4 * (1 - k) * R * R / 1600; d.p2 = r; d.p3 = r;
        c.decals.add(d);
      }, end: () => { this.group.remove(fb.mesh); fb.dispose(); },
    });
  }

  update(ctx: FxCtx): void {
    const tick = ctx.pv.renderTick ?? ctx.pv.paramsTick;
    // shields: a dome while it holds, fading in and out
    for (const [id, s] of this.shields) {
      const live = s.until <= 0 || tick < s.until;
      s.fade += ((live ? 1 : 0) - s.fade) * Math.min(1, ctx.ease * 1.5);
      if (!live && s.fade < 0.02) { this.group.remove(s.dome.mesh); s.dome.dispose(); this.shields.delete(id); continue; }
      frameAt(s.p, _v.copy(s.p).normalize(), s.r, s.dome.mesh.matrix);
      s.dome.mesh.matrixWorldNeedsUpdate = true;
      s.dome.u.uK.value = s.fade * (0.85 + 0.15 * Math.sin(ctx.now * 1.7));
      s.hit = Math.max(0, s.hit - ctx.ease * 2);
      s.dome.u.uHit.value = s.hit;
      const ring = decal(DECAL.domeRing, [s.p.x, s.p.y, s.p.z], s.r * 1.1);
      ring.cr = 1; ring.cg = 0.8; ring.cb = 0.45; ring.p0 = s.r; ring.p1 = 2.2 * s.fade; ring.q0 = Math.max(6, s.r * 0.2);
      ctx.decals.add(ring);
    }
    // moments
    for (let i = this.moments.length - 1; i >= 0; i--) {
      const m = this.moments[i];
      if (m.t0 < 0) m.t0 = ctx.now;
      const age = ctx.now - m.t0;
      if (age < 0) continue;
      if (age > m.dur) { m.end?.(); this.moments.splice(i, 1); continue; }
      m.step(age, clamp01(age / m.dur), ctx);
    }
  }

  /** something struck a shield (an impact inside one): it ripples */
  hitShield(p: Vector3): void { for (const s of this.shields.values()) if (s.p.distanceTo(p) < s.r * 1.2) s.hit = 1; }

  /** the shield standing over ground point p (body m), if any: its centre and radius */
  shieldOver(p: Vector3): { c: Vector3; r: number } | null {
    let best: Shield | null = null;
    for (const s of this.shields.values()) if (s.fade > 0.05 && s.p.distanceTo(p) < s.r * 1.05 && (!best || s.r > best.r)) best = s;
    return best ? { c: best.p, r: best.r } : null;
  }

  dispose(): void { for (const s of this.shields.values()) s.dome.dispose(); this.shields.clear(); }
}
