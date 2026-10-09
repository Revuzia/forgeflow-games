// GENESIS — fire and lamp light near the camera (CONTRACT.md §15.6 night lights, §15.7 "point lights ... budgeted:
// nearest N dynamic lights"): a fixed pool of three.js PointLights (the count is the quality's light budget, so shader
// programs never recompile as fires come and go) placed each frame on the nearest light sources — hearths, braziers,
// kiln and forge mouths, beacons, burning houses, the wildfire front, and (at night) lit windows and street lamps —
// with a flicker for flames. Every MeshStandardMaterial-based surface (terrain, vegetation, buildings, bodies, roads)
// receives them. While nothing near is lit (daylight away from fires, orbit) the whole pool leaves the scene, so no
// material pays for lights it cannot see; it switches as a whole, with hysteresis (a switch recompiles once).
//
// The far view gets its light from the terrain's night-light channel instead (render/life/buildings.ts lightField →
// planet/fieldtex.ts S.z → terrainmat's emissive city lights), so a settlement glows from orbit.

import { Group, PointLight } from 'three';
import { EMIT } from '../gen/buildinggen.ts';
import type { LifeEmitter } from './buildings.ts';

export interface LightSource { x: number; y: number; z: number; kind: number; power: number; seed: number }

/** colour and candela per source kind */
function lightOf(kind: number): [number, number, number, number, number] {
  switch (kind) {
    case EMIT.hearth: return [1.0, 0.5, 0.18, 16, 26];
    // (a burning roof carries 3–6 of these: each lights the facades facing it without flooding the ground around)
    case EMIT.blaze: return [1.0, 0.42, 0.1, 55, 40];
    case EMIT.brazier: return [1.0, 0.55, 0.2, 6, 16];
    case EMIT.mouth: return [1.0, 0.42, 0.12, 9, 18];
    case EMIT.beacon: return [1.0, 0.9, 0.7, 70, 120];
    case 10: return [1.0, 0.45, 0.12, 45, 50];   // wildfire cell
    case 11: return [1.0, 0.7, 0.4, 2.2, 10];    // a lit window
    case 12: return [1.0, 0.72, 0.42, 7, 16];    // a street lamp
    default: return [1.0, 0.6, 0.3, 4, 12];
  }
}

export class NightLights {
  readonly group = new Group();
  private pool: PointLight[] = [];
  private sources: LightSource[] = [];
  private order: number[] = [];
  private on = true;
  private switched = -1e9;

  constructor() {
    this.group.name = 'night-lights';
    this.group.matrixAutoUpdate = false;
  }

  /** resize the pool to the quality budget */
  setBudget(n: number): void {
    n = Math.max(0, Math.min(16, Math.round(n)));
    if (n === this.pool.length) return;
    for (const l of this.pool) { this.group.remove(l); l.dispose(); }
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const l = new PointLight(0xffffff, 0, 20, 2);
      l.castShadow = false;
      l.visible = this.on;
      this.pool.push(l);
      this.group.add(l);
    }
  }

  /** the candidate sources (rebuilt when the emitters change) */
  setSources(emitters: LifeEmitter[], extra: LightSource[]): void {
    this.sources = [];
    for (const e of emitters) {
      if (e.kind === EMIT.smoke || e.kind === EMIT.stack || e.kind === EMIT.blink) continue;
      this.sources.push({ x: e.x, y: e.y, z: e.z, kind: e.kind, power: e.power, seed: e.seed });
    }
    for (const s of extra) this.sources.push(s);
  }

  /** place the pool on the nearest sources (within 160 m) with a flicker */
  update(camX: number, camY: number, camZ: number, time: number, night: number): void {
    const S = this.sources;
    const n = this.pool.length;
    if (!n) return;
    const d2 = new Float32Array(S.length);
    this.order.length = 0;
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      // by day only a real blaze (a burning house, the wildfire front) lights its surroundings noticeably
      if (night < 0.05 && s.kind !== EMIT.blaze && s.kind !== 10) continue;
      const dx = s.x - camX, dy = s.y - camY, dz = s.z - camZ;
      d2[i] = dx * dx + dy * dy + dz * dz;
      if (d2[i] < 160 * 160) this.order.push(i);
    }
    // fires first: a burning house or the wildfire front lights the facades around it before any window or lamp does
    const pri = (i: number) => (S[i].kind === EMIT.blaze || S[i].kind === 10 ? d2[i] * 0.15 : d2[i]);
    this.order.sort((a, b) => pri(a) - pri(b));
    // the pool is in the scene only while something near is lit: every lit material evaluates every visible point
    // light, and a change in their number recompiles those materials, so switch the whole pool, with hysteresis
    const want = this.order.length > 0;
    if (want !== this.on && (want || time - this.switched > 4)) {
      this.on = want;
      this.switched = time;
      for (const l of this.pool) l.visible = want;
    }
    if (!this.on) return;
    for (let k = 0; k < n; k++) {
      const l = this.pool[k];
      if (k >= this.order.length) { l.intensity = 0; continue; }
      const s = S[this.order[k]];
      const [r, g, b, cd, dist] = lightOf(s.kind);
      const flame = s.kind !== EMIT.beacon && s.kind !== 11 && s.kind !== 12;
      const fl = flame ? 0.78 + 0.22 * Math.sin(time * 9.1 + s.seed * 40) * Math.sin(time * 3.7 + s.seed * 17) : 1;
      l.color.setRGB(r, g, b);
      l.intensity = cd * s.power * fl * (s.kind === 11 || s.kind === 12 ? night : 1);
      l.distance = dist;
      l.position.set(s.x, s.y + (flame ? 0.6 : 0), s.z);
    }
  }

  dispose(): void { for (const l of this.pool) l.dispose(); }
}
