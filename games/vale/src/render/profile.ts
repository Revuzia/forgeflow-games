// VALE render — frame profiler (r12 B4: the perf gate's per-group report). Harness seam only: nothing runs
// unless a profile is asked for (Renderer.profile()), and then for exactly one frame.
//
// For that frame every drawable under the given roots gets onBeforeRender / onAfterRender (main passes) and
// onBeforeShadow / onAfterShadow (shadow maps) hooks that read three's own counters (renderer.info, which is
// updated inside renderBufferDirect, between the two hooks), so a group's calls and triangles are exactly what
// it submitted, instances included. Draws no hook saw (full-screen post passes, the hover rim's own draws, the
// overlay composite) are the remainder, `post`. A drawable's own hooks (instance_cull.ts sets its per-pass instance
// count in them) run first and are put back when the frame ends.

import type { Object3D, WebGLRenderer } from 'three';

export interface GroupCost { calls: number; tris: number; shadowCalls: number; shadowTris: number }

export interface RenderProfile {
  /** everything the frame submitted (all passes) */
  total: { calls: number; tris: number };
  /** per group: grass, canopy, terrain, clutter, rocks, landmarks, actors, vfx, ambient, overlay, post */
  groups: Record<string, GroupCost>;
  /** per named part (group:name) — the biggest first */
  detail: Record<string, GroupCost>;
  /** the live programs: material type and name, how many materials use it, three's cache key */
  programs: { type: string; name: string; used: number; key: string }[];
  /** distinct programs the frame bound (the live ones include warm-ups for states not on screen: veils, hover) */
  programsDrawn: number;
}

/** a root and its group; `part` names a drawable's part inside the root (default: the root's direct child's name) */
export interface ProfileRoot { root: Object3D; group: string | ((o: Object3D, top: Object3D) => string); part?: (o: Object3D, top: Object3D) => string }

type Hook = (...a: unknown[]) => void;
const HOOKS = ['onBeforeRender', 'onAfterRender', 'onBeforeShadow', 'onAfterShadow'] as const;
type Hooked = Object3D & Record<(typeof HOOKS)[number], Hook>;
/** a drawable's own hooks (not the prototype's no-ops), restored by end() */
type Saved = Partial<Record<(typeof HOOKS)[number], Hook>>;

const zero = (): GroupCost => ({ calls: 0, tris: 0, shadowCalls: 0, shadowTris: 0 });

export class FrameProfiler {
  private hooked = new Map<Hooked, Saved>();
  private bound = new Set<WebGLProgram>();
  private unbind: (() => void) | null = null;
  private groups: Record<string, GroupCost> = {};
  private detail: Record<string, GroupCost> = {};

  begin(gl: WebGLRenderer, roots: ProfileRoot[]): void {
    this.end();
    this.groups = {}; this.detail = {};
    // every program the frame binds (three skips a bind of the program already current: off by one at most)
    const ctx = gl.getContext() as WebGL2RenderingContext, use = ctx.useProgram;
    this.bound.clear();
    ctx.useProgram = (p: WebGLProgram | null) => { if (p) this.bound.add(p); use.call(ctx, p); };
    this.unbind = () => { ctx.useProgram = use; };
    const info = gl.info.render;
    let c0 = 0, t0 = 0;
    for (const r of roots) {
      // `top`: the root's direct child a drawable sits under (the root itself for the root)
      const visit = (o: Object3D, top: Object3D): void => {
        const d = o as unknown as { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean };
        if (d.isMesh || d.isPoints || d.isLine || d.isSprite) {
          const g = typeof r.group === 'string' ? r.group : r.group(o, top);
          const part = `${g}:${r.part ? r.part(o, top) : (top.name || top.type)}`;
          const G = (this.groups[g] ??= zero()), P = (this.detail[part] ??= zero());
          const h = o as Hooked;
          // a later root re-hooks an object an earlier one hooked (the scene first): chain to its OWN hooks only
          const prev = this.hooked.get(h);
          const own: Saved = prev ?? {};
          if (!prev) for (const k of HOOKS) if (Object.prototype.hasOwnProperty.call(h, k)) own[k] = h[k];
          const ob = own.onBeforeRender, os = own.onBeforeShadow, oa = own.onAfterRender, osa = own.onAfterShadow;
          h.onBeforeRender = (...a) => { ob?.apply(h, a); c0 = info.calls; t0 = info.triangles; };
          h.onAfterRender = (...a) => { oa?.apply(h, a); const dc = info.calls - c0, dt = info.triangles - t0; G.calls += dc; G.tris += dt; P.calls += dc; P.tris += dt; };
          h.onBeforeShadow = (...a) => { os?.apply(h, a); c0 = info.calls; t0 = info.triangles; };
          h.onAfterShadow = (...a) => { osa?.apply(h, a); const dc = info.calls - c0, dt = info.triangles - t0; G.shadowCalls += dc; G.shadowTris += dt; P.shadowCalls += dc; P.shadowTris += dt; };
          if (!prev) this.hooked.set(h, own);
        }
        for (const c of o.children) visit(c, o === r.root ? c : top);
      };
      visit(r.root, r.root);
    }
  }

  /** remove the hooks; `gl` given: the report of the frame just drawn */
  end(gl?: WebGLRenderer): RenderProfile | null {
    for (const [h, own] of this.hooked) {
      for (const k of HOOKS) { if (own[k]) h[k] = own[k]; else delete (h as Partial<Hooked>)[k]; }
    }
    this.hooked.clear();
    this.unbind?.(); this.unbind = null;
    if (!gl) return null;
    const info = gl.info.render;
    const seen = Object.values(this.groups).reduce((s, g) => ({ calls: s.calls + g.calls + g.shadowCalls, tris: s.tris + g.tris + g.shadowTris }), { calls: 0, tris: 0 });
    const groups = { ...this.groups, post: { calls: info.calls - seen.calls, tris: info.triangles - seen.tris, shadowCalls: 0, shadowTris: 0 } };
    const detail = Object.fromEntries(Object.entries(this.detail).filter(([, v]) => v.calls + v.shadowCalls > 0)
      .sort((a, b) => (b[1].tris + b[1].shadowTris) - (a[1].tris + a[1].shadowTris)));
    const programs = (gl.info.programs ?? []).map((p) => {
      const q = p as unknown as { type: string; name: string; usedTimes: number; cacheKey: string };
      return { type: q.type, name: q.name, used: q.usedTimes, key: q.cacheKey };
    });
    return { total: { calls: info.calls, tris: info.triangles }, groups, detail, programs, programsDrawn: this.bound.size };
  }
}
