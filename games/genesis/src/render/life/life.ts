// GENESIS — the life layer of one planet (CONTRACT.md §15.6, §15.7): buildings, people, animals, roads, night lights
// and fire / smoke, driven by the WorldView's blocks (BuildingBlock, MoverBlocks, SettlementViews) and fields.
// PlanetVisual owns one and calls update() every frame for the primary planet; the particle pass is drawn by the
// Renderer after the atmosphere composite (fx()).

import { Group, type Camera, type IUniform, type Scene, type Texture, type Vector3, type WebGLRenderer, type WebGLRenderTarget } from 'three';
import { hashFloat } from '../../sim/core/rng.ts';
import { EMIT } from '../gen/buildinggen.ts';
import { PSYS, Particles, type FxEmitter } from '../fx/particles.ts';
import { NightLights, type LightSource } from './nightlights.ts';
import type { PlanetView } from '../../client/worldview.ts';
import { groundHeight } from '../../sim/grid/surface.ts';
import { Buildings } from './buildings.ts';
import { Crowds } from './crowds.ts';
import { Animals } from './animals.ts';
import { Roads } from './roads.ts';

export interface LifeFrameContext {
  pv: PlanetView;
  camBody: Vector3;
  frame: number;
  /** real seconds (wind, flames) */
  time: number;
  /** seconds of sim-paced animation (people and animals freeze when the sim is paused) */
  animTime: number;
  primary: boolean;
  shadows: boolean;
  /** quality knobs */
  lightBudget: number;
  particleBudget: number;
  crowdDensity: number;
}

export class LifeLayer {
  readonly group = new Group();
  readonly buildings: Buildings;
  readonly crowds: Crowds;
  readonly animals: Animals;
  readonly roads: Roads;
  readonly particles: Particles;
  readonly lights = new NightLights();
  private fxStamp = '';
  private fxCam: [number, number, number] = [1e9, 0, 0];
  private time = 0;
  private shared: Record<string, IUniform>;
  /** the sim-paced animation clock: advances with real time while the sim runs, stops while it is paused */
  private animClock = 0;
  private lastTick = -1;
  private lastTime = -1;

  constructor(shared: Record<string, IUniform>) {
    this.shared = shared;
    this.group.name = 'life';
    this.group.matrixAutoUpdate = false;
    this.buildings = new Buildings(shared);
    this.group.add(this.buildings.group);
    this.crowds = new Crowds(shared);
    this.group.add(this.crowds.group);
    this.animals = new Animals(shared);
    this.group.add(this.animals.group);
    this.roads = new Roads(shared);
    this.group.add(this.roads.group);
    this.particles = new Particles(shared);
    this.group.add(this.particles.group);
    this.group.add(this.lights.group);
  }

  /**
   * Fire and smoke emitters near the camera, nearest first, within the particle budget: the buildings' (chimneys,
   * hearths, mouths, stacks, braziers, burning houses) and the wildfire (`fire` field cells). Also the point-light
   * candidates. Rebuilt when the sources change or the camera has moved ~150 m.
   */
  private collectFx(pv: PlanetView, cx: number, cy: number, cz: number, budget: number): void {
    const fire = pv.fields.get('fire');
    const stamp = `${this.buildings.emittersVersion}|${pv.fieldVersion.get('fire') ?? 0}|${budget}|${this.roads.lampVersion}`;
    const moved = Math.hypot(cx - this.fxCam[0], cy - this.fxCam[1], cz - this.fxCam[2]);
    if (stamp === this.fxStamp && moved < 150) return;
    this.fxStamp = stamp;
    this.fxCam = [cx, cy, cz];
    const R = pv.params.radius;
    const wX = pv.fields.get('windX'), wY = pv.fields.get('windY'), wZ = pv.fields.get('windZ');
    const wind = (x: number, y: number, z: number): [number, number, number] => {
      const l = Math.hypot(x, y, z) || 1;
      const ux = x / l, uy = y / l, uz = z / l;
      if (wX && wY && wZ) return [pv.grid.sample(wX, ux, uy, uz), pv.grid.sample(wY, ux, uy, uz), pv.grid.sample(wZ, ux, uy, uz)];
      // no wind field (lookdev): a light easterly breeze
      let ex = uz, ez = -ux;
      const el = Math.hypot(ex, ez) || 1;
      ex /= el; ez /= el;
      return [ex * 2.2, 0, ez * 2.2];
    };
    type Cand = { d: number; e: FxEmitter };
    const cands: Cand[] = [];
    const push = (x: number, y: number, z: number, sys: number, size: number, power: number, seed: number, count: number, maxD: number) => {
      const d = Math.hypot(x - cx, y - cy, z - cz);
      if (d > maxD) return;
      const [wx, wy, wz] = wind(x, y, z);
      const k = d > 900 ? 0.4 : d > 400 ? 0.65 : 1;
      cands.push({ d, e: { x, y, z, wx, wy, wz, sys, size, power, seed, count: Math.max(3, Math.round(count * k)) } });
    };
    for (const e of this.buildings.emitters) {
      switch (e.kind) {
        case EMIT.hearth:
          push(e.x, e.y, e.z, PSYS.flame, e.size, e.power, e.seed, 22, 1600);
          push(e.x, e.y, e.z, PSYS.ember, e.size, e.power, e.seed + 0.1, 10, 600);
          push(e.x, e.y + 0.4, e.z, PSYS.smoke, 0.5 + e.size * 0.4, e.power, e.seed + 0.2, 12, 2500);
          break;
        case EMIT.blaze:
          // a house on fire: tall tongues licking out of the roof, embers and sparks, black smoke
          push(e.x, e.y, e.z, PSYS.wild, e.size, e.power, e.seed, 20, 1800);
          push(e.x, e.y, e.z, PSYS.flame, e.size * 0.7, e.power, e.seed + 0.05, 12, 1200);
          push(e.x, e.y, e.z, PSYS.ember, e.size, e.power, e.seed + 0.1, 14, 700);
          push(e.x, e.y, e.z, PSYS.spark, 0.4, e.power, e.seed + 0.3, 8, 300);
          break;
        case EMIT.brazier:
          push(e.x, e.y, e.z, PSYS.flame, e.size * 0.9, e.power, e.seed, 10, 900);
          push(e.x, e.y + 0.3, e.z, PSYS.smoke, 0.25, e.power * 0.6, e.seed + 0.2, 5, 1200);
          break;
        case EMIT.mouth:
          push(e.x, e.y, e.z, PSYS.flame, Math.min(0.45, e.size * 0.6), e.power, e.seed, 7, 700);
          push(e.x, e.y, e.z, PSYS.spark, 0.3, e.power, e.seed + 0.3, 8, 300);
          break;
        case EMIT.smoke: push(e.x, e.y, e.z, PSYS.smoke, e.size, e.power, e.seed, 12, 2500); break;
        case EMIT.stack: push(e.x, e.y, e.z, PSYS.stack, e.size, e.power, e.seed, 26, 3500); break;
      }
    }
    // wildfire: a few flame clusters scattered over every burning cell near the camera, a smoke column per cell
    const lightExtra: LightSource[] = [];
    if (fire) {
      const treeF = pv.fields.get('tree');
      const rc = Math.hypot(cx, cy, cz) || 1;
      const cells = pv.grid.cellsWithin(cx / rc, cy / rc, cz / rc, 2200 / R);
      const P = pv.grid.pos;
      for (const c of cells) {
        const f = fire[c];
        if (f < 0.2) continue;
        const ux = P[c * 3], uy = P[c * 3 + 1], uz = P[c * 3 + 2];
        let ex = uz, ez = -ux;
        const el = Math.hypot(ex, ez) || 1;
        ex /= el; ez /= el;
        const nx = uy * ez, ny = uz * ex - ux * ez, nz = -uy * ex;
        const spacing = Math.sqrt(pv.grid.area[c]) * R;
        const n = 2 + Math.round(f * 4);
        for (let k = 0; k < n; k++) {
          const a = hashFloat(c, k, 1) * Math.PI * 2, rr = Math.sqrt(hashFloat(c, k, 2)) * spacing * 0.55;
          let px = ux + (ex * Math.cos(a) + nx * Math.sin(a)) * rr / R, py = uy + ny * Math.sin(a) * rr / R, pz = uz + (ez * Math.cos(a) + nz * Math.sin(a)) * rr / R;
          const pl = Math.hypot(px, py, pz); px /= pl; py /= pl; pz /= pl;
          const g = this.groundAt(pv, px, py, pz);
          push(px * g, py * g, pz * g, PSYS.wild, 2.2 + 2.5 * hashFloat(c, k, 3) * f, f, hashFloat(c, k, 4), 16, 2200);
          // crowning: in a burning wood some trees torch, flames running up into the canopy
          if (treeF && treeF[c] > 0.3 && f > 0.45 && hashFloat(c, k, 9) < 0.45 * treeF[c]) {
            const th = 5 + 9 * hashFloat(c, k, 10) * Math.min(1, treeF[c] + 0.3);
            push(px * (g + th), py * (g + th), pz * (g + th), PSYS.wild, 3 + 2.5 * hashFloat(c, k, 11), f, hashFloat(c, k, 12), 14, 2000);
          }
          if (k < 2) push(px * g, py * g, pz * g, PSYS.ember, 3, f, hashFloat(c, k, 5), 10, 500);
          if (k === 0) lightExtra.push({ x: px * g, y: py * g + 2, z: pz * g, kind: 10, power: f, seed: hashFloat(c, 6) });
        }
        const g = this.groundAt(pv, ux, uy, uz);
        push(ux * g, uy * g, uz * g, PSYS.wildSmoke, 4, f, hashFloat(c, 7), 14, 4000);
      }
    }
    cands.sort((a, b) => a.d - b.d);
    const list: FxEmitter[] = [];
    let used = 0;
    for (const c of cands) {
      if (used + c.e.count > budget) continue;
      used += c.e.count;
      list.push(c.e);
    }
    this.particles.setEmitters(list);
    this.lights.setSources(this.buildings.emitters, [...lightExtra, ...this.roads.lampLights, ...this.buildings.windowLights]);
  }

  private groundAt(pv: PlanetView, x: number, y: number, z: number): number {
    return groundHeight(pv.ground, x, y, z);
  }

  /** draw the fire and smoke into the composited image (called by the Renderer after the atmosphere) */
  renderFx(renderer: WebGLRenderer, scene: Scene, camera: Camera, target: WebGLRenderTarget | null, depth: Texture, w: number, h: number): void {
    if (!this.group.visible) return;
    this.particles.render(renderer, scene, camera, target, depth, w, h, this.time);
  }

  update(ctx: LifeFrameContext): void {
    const on = ctx.primary;
    this.group.visible = on;
    if (!on) return;
    const c = ctx.camBody;
    const pv = ctx.pv;
    const tick = pv.renderTick ?? pv.paramsTick;
    if (this.lastTime >= 0) {
      const dt = Math.max(0, Math.min(0.25, ctx.time - this.lastTime));
      const dTick = tick - this.lastTick;
      // 1x = 10 ticks per real second: the clock never runs faster than real time (limbs at 100x would blur)
      if (dTick > 1e-6) this.animClock += Math.min(dt, dTick / 10 + 1e-3);
    }
    this.lastTime = ctx.time;
    this.lastTick = tick;
    this.time = ctx.time;
    this.buildings.setShadowCasting(ctx.shadows);
    this.buildings.update(pv, c.x, c.y, c.z);
    this.roads.setShadowCasting(ctx.shadows);
    this.roads.update(pv, c.x, c.y, c.z, this.buildings);
    this.crowds.density = ctx.crowdDensity;
    this.crowds.setShadowCasting(ctx.shadows);
    this.crowds.update(pv, c, tick - pv.paramsTick, this.animClock + 1000, ctx.time, this.buildings);
    this.animals.setShadowCasting(ctx.shadows);
    this.animals.update(pv, c, tick - pv.paramsTick, this.animClock + 1000, ctx.time);
    this.collectFx(pv, c.x, c.y, c.z, ctx.particleBudget);
    // point lights: night at the camera from the sun's elevation there
    const sd = this.shared.uSunDirBody?.value as { x: number; y: number; z: number } | undefined;
    const cl = Math.hypot(c.x, c.y, c.z) || 1;
    const el = sd ? (sd.x * c.x + sd.y * c.y + sd.z * c.z) / cl : 1;
    const night = Math.min(1, Math.max(0, (0.08 - el) / 0.16));
    this.lights.setBudget(ctx.lightBudget);
    this.lights.update(c.x, c.y, c.z, ctx.time, night);
  }

  /**
   * What a body-frame ray (origin o, unit direction d) hits first among the life drawn this frame: people (within a
   * distance-scaled pixel allowance `slack`, radians), animals (their herd), buildings (their boxes). Only what is
   * drawn can be picked, so the answer matches what the player sees.
   */
  pick(o: ArrayLike<number>, d: ArrayLike<number>, maxT: number, slack: number): { kind: 'agent' | 'animal' | 'building'; id: number; t: number } | null {
    if (!this.group.visible) return null;
    const b = this.buildings.pick(o, d, maxT);
    // a person standing in front of (or in the doorway of) a building wins over the wall behind them
    const lim = b ? b.t + 1.5 : maxT;
    const a = this.crowds.pick(o, d, lim, slack);
    if (a) return { kind: 'agent', id: a.id, t: a.t };
    const m = this.animals.pick(o, d, lim, slack);
    if (m) return { kind: 'animal', id: m.id, t: m.t };
    return b ? { kind: 'building', id: b.id, t: b.t } : null;
  }

  /** body-frame position (m) of a drawn agent (its head) or a building (above its middle), or null */
  positionOf(kind: string, id: number): [number, number, number] | null {
    if (kind === 'agent') {
      const p = this.crowds.positionOf(id);
      if (!p) return null;
      const l = Math.hypot(p[0], p[1], p[2]) || 1;
      return [p[0] + (p[0] / l) * p[3] * 1.15, p[1] + (p[1] / l) * p[3] * 1.15, p[2] + (p[2] / l) * p[3] * 1.15];
    }
    if (kind === 'building') return this.buildings.positionOf(id);
    return null;
  }

  swapDepth(depth: boolean): void {
    this.buildings.swapDepth(depth);
    this.roads.swapDepth(depth);
    this.crowds.swapDepth(depth);
    this.animals.swapDepth(depth);
  }

  /** per-cell night light from the lit buildings (terrain light channel), with its version */
  lightField(): { data: Float32Array | null; version: number } {
    return { data: this.buildings.lightField, version: this.buildings.lightVersion };
  }

  dispose(): void {
    this.buildings.dispose();
    this.crowds.dispose();
    this.animals.dispose();
    this.roads.dispose();
    this.particles.dispose();
    this.lights.dispose();
  }
}
