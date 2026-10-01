// HIT PARADE - how brightly the stage's light pool lights a point (CHANGED(fix_view) D5). Presentation only.
//
// The fixed light pool (view/stage.ts, stages.json `lights`) is evaluated the way three.js shades it (punctual:
// I / d^decay x the cutoff window, spots x the smoothstep cone; directional / ambient / hemisphere: their intensity),
// each weighted by its colour's luminance, summed (an upper bound: every light's own best-facing surface) and multiplied
// by the stage's tone-mapping exposure. Measured with this sum at chest height over the ring: rust_theater 3.6-4.1,
// butcher_block 4.2-4.6, wheel_of_pain 4.3-5.2, rooftop 2.0-5.8 (exposure 1.15), control_room 2.6-15.4 (its 320-cd ring
// spot alone gives 7.8-11.7 inside 2 m of the centre). `probe(x, y, z)` returns the toon light scale min(1, CAP / level):
// 1 everywhere on the first four stages, < 1 only where a stage is lit far above the rest.

import * as THREE from 'three';

/** level (sum x exposure) a toon body may receive before its light is scaled down */
export const LIGHT_CAP = 6.5;

interface Probe { kind: 0 | 1 | 2; e: number; px: number; py: number; pz: number; range: number; decay: number; ax: number; ay: number; az: number; cosOuter: number; cosInner: number }

function lumOf(c: THREE.Color): number { return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; }

export function makeLightProbe(lights: ReadonlyArray<THREE.Light>, exposure: number, cap = LIGHT_CAP): { probe: (x: number, y: number, z: number) => number; level: (x: number, y: number, z: number) => number } {
  const list: Probe[] = [];
  const p = new THREE.Vector3(), t = new THREE.Vector3();
  for (const L of lights) {
    const I = Number((L.userData as { base0?: number }).base0 ?? L.intensity) || 0;
    if (!(I > 0)) continue;
    const anyL = L as THREE.Light & { isHemisphereLight?: boolean; groundColor?: THREE.Color; isPointLight?: boolean; isSpotLight?: boolean; distance?: number; decay?: number; angle?: number; penumbra?: number; target?: THREE.Object3D };
    if (anyL.isHemisphereLight) { list.push({ kind: 0, e: I * 0.5 * (lumOf(L.color) + lumOf(anyL.groundColor ?? L.color)), px: 0, py: 0, pz: 0, range: 0, decay: 2, ax: 0, ay: 0, az: 0, cosOuter: -2, cosInner: -1 }); continue; }
    if (!anyL.isPointLight && !anyL.isSpotLight) { list.push({ kind: 0, e: I * lumOf(L.color), px: 0, py: 0, pz: 0, range: 0, decay: 2, ax: 0, ay: 0, az: 0, cosOuter: -2, cosInner: -1 }); continue; }
    L.updateMatrixWorld(true);
    L.getWorldPosition(p);
    const q: Probe = { kind: anyL.isSpotLight ? 2 : 1, e: I * lumOf(L.color), px: p.x, py: p.y, pz: p.z, range: anyL.distance ?? 0, decay: anyL.decay ?? 2, ax: 0, ay: -1, az: 0, cosOuter: -2, cosInner: -1 };
    if (anyL.isSpotLight && anyL.target) {
      anyL.target.updateMatrixWorld(true);
      anyL.target.getWorldPosition(t);
      t.sub(p);
      if (t.lengthSq() > 1e-9) t.normalize(); else t.set(0, -1, 0);
      q.ax = t.x; q.ay = t.y; q.az = t.z;
      const ang = anyL.angle ?? Math.PI / 6;
      q.cosOuter = Math.cos(ang); q.cosInner = Math.cos(ang * (1 - (anyL.penumbra ?? 0)));
    }
    list.push(q);
  }
  const ex = Number.isFinite(exposure) && exposure > 0 ? exposure : 1;
  const level = (x: number, y: number, z: number): number => {
    let sum = 0;
    for (const q of list) {
      if (q.kind === 0) { sum += q.e; continue; }
      const dx = x - q.px, dy = y - q.py, dz = z - q.pz;
      const d = Math.hypot(dx, dy, dz);
      let a = 1 / Math.max(Math.pow(d, q.decay), 0.01);
      if (q.range > 0) { const r = Math.min(1, Math.max(0, 1 - Math.pow(d / q.range, 4))); a *= r * r; }
      if (q.kind === 2) {
        const c = d > 1e-6 ? (dx * q.ax + dy * q.ay + dz * q.az) / d : 1;
        const s = q.cosInner > q.cosOuter ? Math.min(1, Math.max(0, (c - q.cosOuter) / (q.cosInner - q.cosOuter))) : (c >= q.cosOuter ? 1 : 0);
        a *= s * s * (3 - 2 * s);
      }
      sum += q.e * a;
    }
    return sum * ex;
  };
  return { probe: (x, y, z) => { const l = level(x, y, z); return l > cap ? cap / l : 1; }, level };
}
