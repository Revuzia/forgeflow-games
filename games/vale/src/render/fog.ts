// VALE render — fog of war texture (CONTRACT §9: view.visionGrid(localTeam) → R8 DataTexture,
// smoothed over time, sampled by the world chunk in world_material.ts).
//
// The sim decides visibility (entities outside vision are hidden by EntityView.visibleMask; the
// shader is cosmetic). Smoothing: each cell eases toward its target — reveal in ~0.18 s, conceal in
// ~0.35 s — so the 10 Hz vision rebuild never pops. Grid resolution and smoothing are identical on
// every quality tier. No per-frame allocation: two preallocated arrays + one Uint8 upload buffer.

import { DataTexture, LinearFilter, RedFormat, UnsignedByteType, ClampToEdgeWrapping } from 'three';
import type { TeamId, WorldView } from '../contracts/sim.ts';
import { worldUniforms } from './world_material.ts';

const REVEAL_PER_S = 5.5;
const CONCEAL_PER_S = 2.8;

export class FogOfWar {
  private tex: DataTexture | null = null;
  private cur: Float32Array = new Float32Array(0);
  private bytes: Uint8Array = new Uint8Array(0);
  private w = 0;
  private h = 0;
  private first = true;
  enabled = true;

  /** bind to a view/team; team < 0 (spectator) disables fog */
  update(view: WorldView, team: TeamId, dt: number): void {
    if (!this.enabled || team < 0) { worldUniforms.valeFogOn.value = 0; return; }
    let grid: ReturnType<WorldView['visionGrid']>;
    try { grid = view.visionGrid(team); } catch { worldUniforms.valeFogOn.value = 0; return; }
    if (grid.width !== this.w || grid.height !== this.h || !this.tex) this.allocate(grid.width, grid.height, grid.cell);
    const n = this.w * this.h;
    const src = grid.data, cur = this.cur, out = this.bytes;
    const up = this.first ? 1 : Math.min(1, dt * REVEAL_PER_S), down = this.first ? 1 : Math.min(1, dt * CONCEAL_PER_S);
    let changed = this.first;
    for (let i = 0; i < n; i++) {
      const t = src[i] > 0 ? 1 : 0;
      const c = cur[i];
      if (c === t) continue;
      let v = t > c ? c + up : c - down;
      if ((t > c && v > t) || (t < c && v < t)) v = t;
      cur[i] = v;
      const b = (v * 255 + 0.5) | 0;
      if (out[i] !== b) { out[i] = b; changed = true; }
    }
    this.first = false;
    if (changed && this.tex) this.tex.needsUpdate = true;
    worldUniforms.valeFogOn.value = 1;
  }

  private allocate(w: number, h: number, cell: number): void {
    this.w = w; this.h = h;
    this.cur = new Float32Array(w * h);
    this.bytes = new Uint8Array(w * h);
    this.tex?.dispose();
    const t = new DataTexture(this.bytes, w, h, RedFormat, UnsignedByteType);
    t.magFilter = LinearFilter; t.minFilter = LinearFilter;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.unpackAlignment = 1;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    this.tex = t;
    this.first = true;
    worldUniforms.valeFogTex.value = t;
    worldUniforms.valeFogScale.value.set(1 / (w * cell), 1 / (h * cell));
    worldUniforms.valeFogTexel.value.set(1 / w, 1 / h);
  }

  dispose(): void { this.tex?.dispose(); this.tex = null; this.w = this.h = 0; worldUniforms.valeFogOn.value = 0; }
}
