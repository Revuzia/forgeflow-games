// BLOCKTOOTH v2 — marker projection (FEATURES_V2 §5.4, lane L6): objective / power-up / TILL anchors →
// CSS-px screen positions + off-screen edge arrows for the DOM marker layer (ui/markers.ts, L8). VIEW.
//
// Per frame (after the camera update, in the views loop) it projects every candidate anchor through the
// live camera and fills a pooled MarkerFrame (≤ 12 items, no per-frame allocation):
//   * objectives (alive): anchored at the top of their light column (OBJ_ANCHOR, ObjectiveView), always
//     listed while ON screen; OFF screen only within 3 × spawnRing (6 × with the ADVANCE TIP-LINE perk);
//   * power-ups (alive): anchored over the token; off screen only within 1.5 × spawnRing (× 2 with the perk);
//   * the PARKADE-6 TILL while it is open (`boss.data.tillOpen > 0`): `HIT THE TILL`, always listed.
// Off screen: the item is clamped to a 3u inset of the view edge along the ray from the view centre
// (a point behind the camera is mirrored first), `angle` = atan2(dy, dx) in CSS px (0 = right, +π/2 =
// down), `onScreen` false. `dist` = metres from the titan ÷ CITY.pitch (blocks). Priority when more than
// 12 qualify: the TILL, then objectives, then power-ups, each nearest-first.

import * as THREE from 'three';
import type { World } from '../core/types.ts';
import { CITY } from '../core/config.ts';
import { spawnRing } from '../ai/director.ts';
import { OBJECTIVE_NAMES } from '../data/objectives.ts';
import type { FrameInfo, ViewCtx, ViewModule } from './viewtypes.ts';
import type { MarkerFrame, MarkerItem, MarkerKind, MarkerViewApi } from '../v2types.ts';
import { OBJ_ANCHOR } from './objectiveview.ts';
import { TOKEN_TOP, tokenSize } from './powerupview.ts';

const MAX = 12;
/** candidates considered per frame before the 12-cap (objectives ≤ 8 + power-ups ≤ 3 + till 1 + slack) */
const CAND = 24;
const INSET_U = 3;
const OBJ_RANGE = 3, PU_RANGE = 1.5, TIP_MUL = 2;

interface Cand { kind: MarkerKind; sub: string; x: number; y: number; z: number; d: number; prio: number; always: boolean; liftPx: number }

const _v = new THREE.Vector4();
const _size = new THREE.Vector2();

export class MarkerView implements ViewModule, MarkerViewApi {
  private readonly ctx: ViewCtx;
  private readonly out: MarkerFrame = { items: [] };
  private readonly pool: MarkerItem[] = [];
  private readonly cand: Cand[] = [];
  private readonly order: number[] = [];
  private nCand = 0;

  constructor(ctx: ViewCtx) {
    this.ctx = ctx;
    for (let i = 0; i < MAX; i++) this.pool.push({ kind: 'overloadSite', sub: '', x: 0, y: 0, onScreen: false, angle: 0, dist: 0 });
    for (let i = 0; i < CAND; i++) this.cand.push({ kind: 'overloadSite', sub: '', x: 0, y: 0, z: 0, d: 0, prio: 0, always: false, liftPx: 0 });
  }

  mount(_w: World): void { this.out.items.length = 0; }

  update(w: World, _f: FrameInfo): void {
    const items = this.out.items;
    items.length = 0;
    if (!w.map || w.run.result) return;
    const T = w.titan;
    const H = Math.max(0.2, T.height);
    const ring = spawnRing(w);
    const tip = w.meta && w.meta.perk === 'perk_tip_line' ? TIP_MUL : 1;
    const objR = OBJ_RANGE * ring * tip, puR = PU_RANGE * ring * tip;
    this.nCand = 0;

    // TILL (PARKADE-6) while open
    const b = w.boss;
    if (b && b.alive && b.id === 'parkade6' && (b.data.tillOpen ?? 0) > 0) {
      for (let i = 0; i < b.parts.length; i++) {
        const p = b.parts[i];
        if (p.name !== 'till') continue;
        this.push('till', 'HIT THE TILL', p.x, Math.max(p.y1, 1), p.z, Math.hypot(p.x - T.x, p.z - T.z), 0, true);
        break;
      }
    }
    const objs = w.map.objectives;
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      if (!o.alive) continue;
      const d = Math.hypot(o.x - T.x, o.z - T.z);
      const top = OBJ_ANCHOR.get(o.id) ?? Math.max(4 * H, o.h + 1.6 * H);
      this.push(o.kind, OBJECTIVE_NAMES[o.kind], o.x, top, o.z, d, 1, false, objR);
    }
    const pus = w.map.powerups;
    for (let i = 0; i < pus.length; i++) {
      const p = pus[i];
      if (!p.alive) continue;
      const d = Math.hypot(p.x - T.x, p.z - T.z);
      // anchored on the token's top — the SAME size powerupview draws (incl. its on-screen floor, which is
      // what a Size I token actually is) — and lifted clear of it (the DOM chip hangs under its anchor)
      const s = tokenSize(Math.max(0.3, p.h > 0 ? p.h : H), _f.camDist);
      this.push('powerup', p.kind, p.x, s * TOKEN_TOP, p.z, d, 2, false, puR, 30);
    }
    if (this.nCand === 0) return;

    // project
    const cam = this.ctx.camera;
    this.ctx.renderer.getSize(_size);
    const W = Math.max(1, _size.x), Hh = Math.max(1, _size.y);
    const u = Math.max(8, Math.min(W / 100, (Hh * 1.7778) / 100));
    const inset = INSET_U * u;
    const cx = W / 2, cy = Hh / 2;
    // stable order: prio, then distance (insertion sort on ≤ 24 indices)
    const ord = this.order;
    ord.length = 0;
    for (let i = 0; i < this.nCand; i++) {
      let j = ord.length;
      ord.push(i);
      while (j > 0) {
        const a = this.cand[ord[j - 1]], c = this.cand[ord[j]];
        if (a.prio < c.prio || (a.prio === c.prio && a.d <= c.d)) break;
        const t = ord[j - 1]; ord[j - 1] = ord[j]; ord[j] = t; j--;
      }
    }
    for (let k = 0; k < ord.length && items.length < MAX; k++) {
      const c = this.cand[ord[k]];
      _v.set(c.x, c.y, c.z, 1).applyMatrix4(cam.matrixWorldInverse).applyMatrix4(cam.projectionMatrix);
      const behind = _v.w <= 1e-4;
      let nx = _v.x / Math.max(1e-4, Math.abs(_v.w)), ny = _v.y / Math.max(1e-4, Math.abs(_v.w));
      if (behind) { nx = -nx; ny = -ny; }
      const px = (nx * 0.5 + 0.5) * W, py = (0.5 - ny * 0.5) * Hh;
      const on = !behind && px >= 0 && px <= W && py >= 0 && py <= Hh;
      if (!on && !c.always && c.d > (c.prio === 2 ? puR : objR)) continue;
      const it = this.pool[items.length];
      it.kind = c.kind; it.sub = c.sub; it.dist = c.d / CITY.pitch; it.onScreen = on;
      if (on) { it.x = px; it.y = py - c.liftPx * (Hh / 720); it.angle = 0; }
      else {
        let dx = px - cx, dy = py - cy;
        if (Math.abs(dx) < 1e-3 && Math.abs(dy) < 1e-3) dy = 1;
        const tx = (cx - inset) / Math.max(1e-6, Math.abs(dx)), ty = (cy - inset) / Math.max(1e-6, Math.abs(dy));
        const t = Math.min(tx, ty);
        it.x = cx + dx * t; it.y = cy + dy * t;
        it.angle = Math.atan2(dy, dx);
        if (!Number.isFinite(it.x) || !Number.isFinite(it.y)) { it.x = cx; it.y = Hh - inset; it.angle = Math.PI / 2; }
        dx = 0; dy = 0;
      }
      items.push(it);
    }
  }

  unmount(): void { this.out.items.length = 0; }

  /** ≤ 12 projected markers for the DOM layer (a pooled frame: read it this frame, do not keep it). */
  frame(): MarkerFrame { return this.out; }

  private push(kind: MarkerKind, sub: string, x: number, y: number, z: number, d: number, prio: number, always: boolean, range = Infinity, liftPx = 0): void {
    if (this.nCand >= CAND) return;
    if (!always && d > range * 4) return;   // far beyond even the edge-arrow range: cannot be on screen either
    const c = this.cand[this.nCand++];
    c.kind = kind; c.sub = sub; c.x = x; c.y = y; c.z = z; c.d = d; c.prio = prio; c.always = always; c.liftPx = liftPx;
  }
}
