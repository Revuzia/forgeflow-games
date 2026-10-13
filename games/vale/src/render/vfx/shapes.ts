// VALE render — procedural FX-mesh shapes (CONTRACT §9.5 `mesh.shape`). Unit-sized; +Z is "forward"
// (path / dir alignment), +Y is "up" (ground layers stand on it). Every shape carries UVs the FX
// material can scroll, mask and dissolve along:
//   orb, dome          u around, v pole → equator (dome: v 0 at the rim, 1 at the top)
//   cone, pillar, wall, column, tornado   u around, v 0 at the base → 1 at the top
//   disc, ringwave     u around, v 0 at the centre / inner edge → 1 at the outer edge (polar)
//   fan                polar sector in the vertex shader: u across the opening, v along the radius
//   blade, crescent    u along the sweep (0 trailing → 1 leading), v across (0 inner → 1 outer edge)
//   shard, spike       u along the length, v around
//   spiral             u along the helix, v around the tube
// Procedural VFX geometry is allowed by CONTRACT §0; these never stand in for characters or landmarks.

import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, ConeGeometry, CylinderGeometry, SphereGeometry, TubeGeometry, Vector3,
} from 'three';

export const VFX_SHAPES = ['orb', 'blade', 'shard', 'cone', 'pillar', 'disc', 'spiral', 'crescent', 'spike', 'dome', 'ringwave', 'wall', 'column', 'tornado', 'fan'] as const;
export type VfxShape = (typeof VFX_SHAPES)[number];
/** shapes whose vertex shader is special: 1 = polar fan */
export const SHAPE_KIND: Partial<Record<VfxShape, number>> = { fan: 1 };

export function shapeIndex(name: unknown): number {
  const i = VFX_SHAPES.indexOf(name as VfxShape);
  return i < 0 ? 0 : i;
}

/** a grid surface from a (u, v) → position/normal function */
function surface(nu: number, nv: number, f: (u: number, v: number, p: Vector3, n: Vector3) => void): BufferGeometry {
  const pos: number[] = [], nor: number[] = [], uvs: number[] = [], idx: number[] = [];
  const p = new Vector3(), n = new Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const u = i / nu, v = j / nv;
    f(u, v, p, n);
    pos.push(p.x, p.y, p.z); nor.push(n.x, n.y, n.z); uvs.push(u, v);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(idx);
  return g;
}

export function buildShape(name: VfxShape): BufferGeometry {
  switch (name) {
    case 'orb': return new SphereGeometry(0.5, 40, 20);
    case 'dome': return new SphereGeometry(0.5, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    case 'blade': // a flat curved blade along +Z, lying in XZ: u hilt → tip, v edge to edge
      return surface(24, 2, (u, v, p, n) => {
        const z = u - 0.5;
        const cx = 0.14 * Math.sin(u * Math.PI) - 0.04;
        const w = 0.13 * Math.pow(Math.sin(Math.min(1, u * 1.08) * Math.PI), 0.55) * (1 - u * 0.35) + 0.004;
        p.set(cx + (v - 0.5) * 2 * w, 0, z); n.set(0, 1, 0);
      });
    case 'shard': // a long faceted glass sliver along +Z
      return surface(6, 6, (u, v, p, n) => {
        const a = u * Math.PI * 2;
        const prof = Math.sin(v * Math.PI) * (v < 0.35 ? 1 : 1 - (v - 0.35) * 0.4);
        const f = Math.round(a / (Math.PI / 3)) * (Math.PI / 3); // flat facets
        p.set(Math.cos(f) * 0.16 * prof, Math.sin(f) * 0.12 * prof, v - 0.5);
        n.set(Math.cos(f), Math.sin(f), 0);
      });
    case 'cone': { const g = new ConeGeometry(0.5, 1, 40, 4, true); g.translate(0, 0.5, 0); return g; }
    case 'pillar': case 'wall': { const g = new CylinderGeometry(0.5, 0.5, 1, 48, 4, true); g.translate(0, 0.5, 0); return g; }
    case 'column': return surface(48, 10, (u, v, p, n) => {
      const a = u * Math.PI * 2, r = 0.5 - 0.16 * v + 0.03 * Math.sin(v * Math.PI);
      p.set(Math.cos(a) * r, v, Math.sin(a) * r); n.set(Math.cos(a), 0.16, Math.sin(a)).normalize();
    });
    case 'tornado': return surface(48, 16, (u, v, p, n) => {
      const a = u * Math.PI * 2, r = 0.1 + 0.4 * Math.pow(v, 1.3);
      p.set(Math.cos(a) * r, v, Math.sin(a) * r); n.set(Math.cos(a), -0.4, Math.sin(a)).normalize();
    });
    case 'disc': return surface(48, 6, (u, v, p, n) => {
      const a = u * Math.PI * 2, r = v * 0.5;
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r); n.set(0, 1, 0);
    });
    case 'ringwave': return surface(64, 2, (u, v, p, n) => {
      const a = u * Math.PI * 2, r = 0.32 + 0.18 * v;
      p.set(Math.cos(a) * r, 0, Math.sin(a) * r); n.set(0, 1, 0);
    });
    case 'fan': return surface(32, 6, (u, v, p, n) => { p.set(u, 0, v); n.set(0, 1, 0); });
    case 'crescent': // a slash arc in front of the origin (bulging toward +Z): u along the arc, v inner → outer
      return surface(40, 3, (u, v, p, n) => {
        const th = (u - 0.5) * Math.PI * 0.84;
        const thick = 0.17 * Math.pow(Math.sin(u * Math.PI), 0.8) + 0.004;
        const r = 0.5 - thick + v * thick;
        p.set(Math.sin(th) * r, 0, Math.cos(th) * r - 0.25); n.set(0, 1, 0);
      });
    case 'spike': { const g = new ConeGeometry(0.16, 1, 8, 2); g.translate(0, 0.5, 0); return g; }
    case 'spiral': {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 64; i++) { const t = i / 64, a = t * Math.PI * 4; pts.push(new Vector3(Math.cos(a) * 0.45 * (1 - t * 0.4), t, Math.sin(a) * 0.45 * (1 - t * 0.4))); }
      return new TubeGeometry(new CatmullRomCurve3(pts), 96, 0.035, 6, false);
    }
  }
}
