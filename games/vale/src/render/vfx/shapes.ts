// VALE render — procedural meshes for the VFX `mesh` layer (CONTRACT §9.5: orb, blade, shard, cone,
// pillar, disc, spiral, crescent, spike). Unit-sized, authored so +Z is "forward" (path layers align
// it with the velocity) and +Y is "up" (ground layers stand on it). Procedural VFX geometry is allowed
// by CONTRACT §0; these never stand in for characters or landmarks.

import {
  BufferGeometry, CatmullRomCurve3, CircleGeometry, ConeGeometry, CylinderGeometry, ExtrudeGeometry, IcosahedronGeometry,
  OctahedronGeometry, Shape, TubeGeometry, Vector3,
} from 'three';

export const VFX_SHAPES = ['orb', 'blade', 'shard', 'cone', 'pillar', 'disc', 'spiral', 'crescent', 'spike'] as const;
export type VfxShape = (typeof VFX_SHAPES)[number];

export function shapeIndex(name: unknown): number {
  const i = VFX_SHAPES.indexOf(name as VfxShape);
  return i < 0 ? 0 : i;
}

export function buildShape(name: VfxShape): BufferGeometry {
  let g: BufferGeometry;
  switch (name) {
    case 'orb': g = new IcosahedronGeometry(0.5, 2); break;
    case 'blade': {
      // a flat, slightly curved blade along +Z
      const s = new Shape();
      s.moveTo(0, -0.5); s.quadraticCurveTo(0.16, -0.1, 0.07, 0.5); s.lineTo(0, 0.42); s.quadraticCurveTo(-0.1, -0.05, 0, -0.5);
      g = new ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false });
      g.translate(0, 0, -0.01);
      g.rotateX(Math.PI / 2);
      break;
    }
    case 'shard': g = new OctahedronGeometry(0.5, 0); g.scale(0.32, 0.26, 1); break;
    case 'cone': g = new ConeGeometry(0.5, 1, 18, 1, true); g.translate(0, 0.5, 0); break;
    case 'pillar': g = new CylinderGeometry(0.5, 0.5, 1, 20, 1, true); g.translate(0, 0.5, 0); break;
    case 'disc': g = new CircleGeometry(0.5, 40); g.rotateX(-Math.PI / 2); break;
    case 'spiral': {
      const pts: Vector3[] = [];
      for (let i = 0; i <= 48; i++) { const t = i / 48, a = t * Math.PI * 4; pts.push(new Vector3(Math.cos(a) * 0.45 * (1 - t * 0.4), t, Math.sin(a) * 0.45 * (1 - t * 0.4))); }
      g = new TubeGeometry(new CatmullRomCurve3(pts), 64, 0.035, 5, false);
      break;
    }
    case 'crescent': {
      const s = new Shape();
      s.absarc(0, 0, 0.5, -Math.PI * 0.42, Math.PI * 0.42, false);
      s.absarc(-0.16, 0, 0.42, Math.PI * 0.36, -Math.PI * 0.36, true);
      g = new ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false, curveSegments: 24 });
      g.translate(0, 0, -0.02);
      g.rotateX(-Math.PI / 2);
      g.rotateY(-Math.PI / 2);
      break;
    }
    case 'spike': g = new ConeGeometry(0.16, 1, 6, 1); g.translate(0, 0.5, 0); break;
  }
  g.computeVertexNormals();
  return g;
}
