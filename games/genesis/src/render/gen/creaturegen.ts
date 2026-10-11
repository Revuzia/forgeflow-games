// GENESIS — the creatures' bodies (CONTRACT.md §11.5, §15.6: "the creature's morph params drive the mesh").
//
// One implicit-surface body per template (creatures.json `body`: ape, ox, cat, tortoise, wolf, bear — any other body
// falls back to the nearest plan), polygonised with surface nets (gen/sdfmesh.ts) and skinned to a rig (gen/rig.ts):
//   quadrupeds (ox, cat, wolf, bear) — a pelvis, spine and chest; a neck and head with a jaw; ears; horns for the ox;
//     three-segment legs (digitigrade cat and wolf, hoofed ox, plantigrade bear); a tail of three segments
//   ape — a knuckle-walker: a massive chest and shoulders, long arms with fists, short legs, a brow ridge and muzzle
//   tortoise — a domed, scuted shell over a plastron, stumpy columnar legs, a long wrinkled neck and a beaked head
// The morph (CreatureView.morph: fat, strong, spiky, glow) reshapes the body: fat rounds the belly, chest and neck;
// strong thickens limbs, shoulders and neck; spiky (a cruel creature) makes it gaunt — a tucked belly, thinner limbs,
// a ridge of spines along the back and spurs at the joints. Glow is the shader's (markings, eyes).
//
// Units: the creature's standing height = 1 (the sim's `height` scales it), feet on y = 0, facing +z, +x its left.
// Per-vertex data: aRest (bind position), aMark (x eye, y region: 0 coat, 1 belly, 2 bare skin / face, 3 horn, hoof
// or claw, 4 shell, 5 spine, z fur length 0..1, w along the body, tail 0 → nose 1), skin indices and weights.

import { BufferAttribute, BufferGeometry } from 'three';
import { Rig, bone, type RigBone, type V3 } from './rig.ts';
import { frame, meshSdf, sdCapsule, sdEllipsoid, sdRoundCone, segDist, skinWeights, smax, smin, smoothAttribute, type Frame } from './sdfmesh.ts';

export const CREATURE_BODIES = ['ape', 'ox', 'cat', 'tortoise', 'wolf', 'bear'] as const;
export type CreatureBody = (typeof CREATURE_BODIES)[number];

export interface CreatureMesh {
  geo: BufferGeometry;
  bones: RigBone[];
  body: CreatureBody;
  /** named bone indices (legs as [upper, lower, foot] in the order LF, RF, LH, RH; ape arms are the "front legs") */
  b: {
    root: number; spine: number; chest: number; neck: number; head: number; jaw: number;
    tail: number[]; legs: number[][]; ears: number[];
  };
  /** bind-pose foot points (ground contact) in leg order, eye centres, the mouth */
  feet: V3[];
  eyes: V3[];
  mouth: V3;
  /** body length (tail root → nose) in height units, the stride length of a walk */
  length: number;
  stride: number;
  /** fur: 0 none (tortoise), short hide (ox), up to 1 (bear, ape) */
  fur: number;
  verts: number;
}

export interface Morph { fat: number; strong: number; spiky: number }

interface Prim { kind: 0 | 1 | 2; a: V3; b: V3; ra: number; rb: number; r3?: V3; f?: Frame; k: number; region: number; sub?: boolean }

const cache = new Map<string, CreatureMesh>();

/** a body for (template body, morph) — morph quantised to quarters, cached */
export function creatureMesh(body: string, m: Morph): CreatureMesh {
  const b = normBody(body);
  const q = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 4) / 4;
  const key = `${b}|${q(m.fat)}|${q(m.strong)}|${q(m.spiky)}`;
  let c = cache.get(key);
  if (!c) {
    c = build(b, { fat: q(m.fat), strong: q(m.strong), spiky: q(m.spiky) });
    cache.set(key, c);
    // keep the cache bounded (a creature's morph drifts slowly: a handful of variants live at a time)
    if (cache.size > 12) { const first = cache.keys().next().value; if (first !== undefined && first !== key) { cache.get(first)?.geo.dispose(); cache.delete(first); } }
  }
  return c;
}

export function normBody(body: string): CreatureBody {
  if ((CREATURE_BODIES as readonly string[]).includes(body)) return body as CreatureBody;
  if (/lion|tiger|leopard|panther|lynx/.test(body)) return 'cat';
  if (/dog|fox|hyena|jackal/.test(body)) return 'wolf';
  if (/bull|cow|buffalo|bison|yak|horse|deer|elk/.test(body)) return 'ox';
  if (/turtle|shell/.test(body)) return 'tortoise';
  if (/gorilla|monkey|chimp|man/.test(body)) return 'ape';
  return 'bear';
}

/** a creature rig */
export function creatureRig(c: CreatureMesh): Rig { return new Rig(c.bones); }

const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a: V3, b: V3, t: number): V3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mx = (v: V3): V3 => [-v[0], v[1], v[2]];
/** the dorsal hint of bones that hang (legs, ears): forward — their flex swings the far end back */
const FWD: V3 = [0, 0, 1];

/** quadruped proportions (height = 1 at the top of the shoulders / back) */
interface QuadSpec {
  hipY: number; shoulderY: number; hipZ: number; shoulderZ: number;
  chestR: [number, number, number]; bellyR: [number, number, number]; hipR: [number, number, number];
  waist: number;
  neckLen: number; neckUp: number; neckR: [number, number];
  head: [number, number, number]; snout: number; snoutR: [number, number]; headTilt: number;
  legR: [number, number, number, number]; frontLeg: [number, number, number]; hindLeg: [number, number, number];
  digitigrade: boolean; paw: number; hoof: boolean;
  tail: [number, number, number]; tailUp: number; tailBushy: number;
  ear: [number, number]; earPointed: boolean; horns: boolean; hump: number; ruff: number; mane: number;
  fur: number; legSpread: number;
}

const QUADS: Record<'ox' | 'cat' | 'wolf' | 'bear', QuadSpec> = {
  ox: {
    hipY: 0.84, shoulderY: 0.86, hipZ: -0.5, shoulderZ: 0.42,
    chestR: [0.24, 0.27, 0.27], bellyR: [0.27, 0.27, 0.36], hipR: [0.22, 0.22, 0.22], waist: 0.9,
    neckLen: 0.26, neckUp: 0.15, neckR: [0.17, 0.13], head: [0.12, 0.13, 0.17], snout: 0.2, snoutR: [0.11, 0.095], headTilt: -0.7,
    legR: [0.085, 0.055, 0.05, 0.06], frontLeg: [0.28, 0.24, 0.12], hindLeg: [0.3, 0.26, 0.12], digitigrade: false, paw: 0.07, hoof: true,
    tail: [0.5, 0.025, 0.012], tailUp: -1.2, tailBushy: 0.06, ear: [0.07, 0.03], earPointed: false, horns: true, hump: 0.04, ruff: 0, mane: 0,
    fur: 0.25, legSpread: 0.16,
  },
  cat: {
    hipY: 0.78, shoulderY: 0.8, hipZ: -0.55, shoulderZ: 0.42,
    chestR: [0.17, 0.2, 0.22], bellyR: [0.15, 0.15, 0.28], hipR: [0.16, 0.17, 0.18], waist: 0.72,
    neckLen: 0.24, neckUp: 0.42, neckR: [0.12, 0.1], head: [0.13, 0.12, 0.13], snout: 0.09, snoutR: [0.085, 0.07], headTilt: -0.12,
    legR: [0.07, 0.045, 0.04, 0.05], frontLeg: [0.32, 0.3, 0.12], hindLeg: [0.34, 0.32, 0.2], digitigrade: true, paw: 0.065, hoof: false,
    tail: [0.85, 0.04, 0.03], tailUp: -0.5, tailBushy: 0.0, ear: [0.06, 0.045], earPointed: false, horns: false, hump: 0, ruff: 0, mane: 0,
    fur: 0.45, legSpread: 0.12,
  },
  wolf: {
    hipY: 0.8, shoulderY: 0.86, hipZ: -0.5, shoulderZ: 0.4,
    chestR: [0.15, 0.22, 0.22], bellyR: [0.13, 0.13, 0.24], hipR: [0.14, 0.15, 0.16], waist: 0.66,
    neckLen: 0.24, neckUp: 0.5, neckR: [0.13, 0.1], head: [0.1, 0.11, 0.13], snout: 0.19, snoutR: [0.07, 0.04], headTilt: -0.25,
    legR: [0.06, 0.04, 0.034, 0.04], frontLeg: [0.33, 0.32, 0.11], hindLeg: [0.35, 0.34, 0.2], digitigrade: true, paw: 0.05, hoof: false,
    tail: [0.6, 0.06, 0.04], tailUp: -0.9, tailBushy: 0.09, ear: [0.09, 0.05], earPointed: true, horns: false, hump: 0, ruff: 0.06, mane: 0,
    fur: 0.7, legSpread: 0.1,
  },
  bear: {
    hipY: 0.82, shoulderY: 0.92, hipZ: -0.48, shoulderZ: 0.36,
    chestR: [0.27, 0.32, 0.3], bellyR: [0.3, 0.31, 0.36], hipR: [0.26, 0.28, 0.26], waist: 0.95,
    neckLen: 0.22, neckUp: 0.15, neckR: [0.2, 0.15], head: [0.15, 0.14, 0.15], snout: 0.14, snoutR: [0.09, 0.07], headTilt: -0.3,
    legR: [0.11, 0.085, 0.075, 0.08], frontLeg: [0.3, 0.28, 0.06], hindLeg: [0.3, 0.28, 0.14], digitigrade: false, paw: 0.1, hoof: false,
    tail: [0.12, 0.05, 0.04], tailUp: -0.6, tailBushy: 0.03, ear: [0.06, 0.05], earPointed: false, horns: false, hump: 0.09, ruff: 0, mane: 0,
    fur: 1, legSpread: 0.18,
  },
};

function build(body: CreatureBody, m: Morph): CreatureMesh {
  if (body === 'ape') return buildApe(m);
  if (body === 'tortoise') return buildTortoise(m);
  return buildQuad(body, QUADS[body], m);
}

// ───────────────────────────── shared machinery ─────────────────────────────

/** evaluate a list of primitives: smooth unions in order, regions tracked to the nearest primitive */
function fieldOf(prims: Prim[]): (x: number, y: number, z: number) => number {
  // bounding spheres for culling (a primitive farther than its blend radius from the running value cannot matter)
  const bs = prims.map((p) => {
    const c = lerp3(p.a, p.b, 0.5);
    const half = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1], p.b[2] - p.a[2]) / 2;
    const r = p.kind === 1 ? Math.max(p.r3![0], p.r3![1], p.r3![2]) : Math.max(p.ra, p.rb);
    return { c, r: half + r };
  });
  // beyond CUT from every primitive's bounding sphere the field is only a lower bound (the right sign, a safe
  // magnitude for the mesher's coarse test); near the surface every primitive that matters is evaluated exactly
  const CUT = 0.16;
  return (x, y, z) => {
    let d = 1e9, far = 1e9;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      const b = bs[i];
      const dx = x - b.c[0], dy = y - b.c[1], dz = z - b.c[2];
      const lb = Math.sqrt(dx * dx + dy * dy + dz * dz) - b.r;
      if (p.sub) { if (lb < p.k) d = smax(d, -primDist(p, x, y, z), p.k); continue; }
      if (lb > d + p.k) continue;
      if (lb > CUT) { if (lb < far) far = lb; continue; }
      d = smin(d, primDist(p, x, y, z), p.k);
    }
    return d < far ? d : far;
  };
}

function primDist(p: Prim, x: number, y: number, z: number): number {
  if (p.kind === 0) return sdRoundCone(x, y, z, p.a, p.b, p.ra, p.rb);
  if (p.kind === 1) return sdEllipsoid(x, y, z, p.a, p.r3!, p.f);
  return sdCapsule(x, y, z, p.a, p.b, p.ra);
}

const cone = (a: V3, b: V3, ra: number, rb: number, k: number, region = 0): Prim => ({ kind: 0, a, b, ra, rb, k, region });
const ell = (c: V3, r: V3, k: number, region = 0, dir?: V3): Prim => ({ kind: 1, a: c, b: c, ra: 0, rb: 0, r3: r, f: dir ? frame(c, dir) : undefined, k, region });

/** mesh, skin, mark and package */
function finish(body: CreatureBody, prims: Prim[], bones: RigBone[], idx: CreatureMesh['b'], feet: V3[], eyes: V3[], mouth: V3, fur: number, length: number, stride: number,
  bmin: V3, bmax: V3, regionAt: (x: number, y: number, z: number, nearest: number) => number, furAt: (x: number, y: number, z: number, region: number) => number): CreatureMesh {
  const f = fieldOf(prims);
  const h = 0.0145;
  const m = meshSdf(f, bmin, bmax, h, 1);
  const n = m.vertexCount;
  const sk = skinWeights(m.pos, bones.map((b) => ({ a: b.head, b: b.tail, r: b.r })), 8, (best, other) => {
    // left and right legs never pull on each other; ears and jaw stay with the head
    const bn = bones[best].name, on = bones[other].name;
    const side = (s: string) => (s.includes('.l') ? 'l' : s.includes('.r') ? 'r' : '');
    if (side(bn) && side(on) && side(bn) !== side(on)) return false;
    return true;
  });
  const NB = bones.length;
  const full = new Float32Array(n * NB);
  for (let v = 0; v < n; v++) for (let s = 0; s < 4; s++) full[v * NB + sk.index[v * 4 + s]] += sk.weight[v * 4 + s];
  smoothAttribute(m.index, n, full, NB, 2, 0.5);
  const bIdx = new Float32Array(n * 4), bW = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const row = full.subarray(v * NB, (v + 1) * NB);
    const top = [-1, -1, -1, -1];
    for (let b = 0; b < NB; b++) {
      if (row[b] < 1e-3) continue;
      for (let s = 0; s < 4; s++) if (top[s] < 0 || row[b] > row[top[s]]) { for (let q = 3; q > s; q--) top[q] = top[q - 1]; top[s] = b; break; }
    }
    let sum = 0;
    for (let s = 0; s < 4; s++) if (top[s] >= 0) sum += row[top[s]];
    for (let s = 0; s < 4; s++) { bIdx[v * 4 + s] = top[s] >= 0 ? top[s] : 0; bW[v * 4 + s] = top[s] >= 0 ? row[top[s]] / sum : 0; }
  }
  const mark = new Float32Array(n * 4);
  const zMin = bmin[2], zMax = bmax[2];
  for (let v = 0; v < n; v++) {
    const x = m.pos[v * 3], y = m.pos[v * 3 + 1], z = m.pos[v * 3 + 2];
    let eye = 0;
    for (const e of eyes) { const d = Math.hypot(x - e[0], y - e[1], z - e[2]); eye = Math.max(eye, Math.max(0, Math.min(1, (0.038 - d) / 0.012))); }
    let nearest = 0, bd = Infinity;
    for (let b = 0; b < NB; b++) { const d = segDist(x, y, z, bones[b].head, bones[b].tail) / bones[b].r; if (d < bd) { bd = d; nearest = b; } }
    const region = regionAt(x, y, z, nearest);
    mark[v * 4] = eye;
    mark[v * 4 + 1] = region;
    mark[v * 4 + 2] = furAt(x, y, z, region) * (eye > 0.1 ? 0 : 1);
    mark[v * 4 + 3] = (z - zMin) / Math.max(1e-3, zMax - zMin);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(m.pos, 3));
  geo.setAttribute('normal', new BufferAttribute(m.nrm, 3));
  geo.setAttribute('aRest', new BufferAttribute(m.pos.slice(), 3));
  geo.setAttribute('aBoneIdx', new BufferAttribute(bIdx, 4));
  geo.setAttribute('aBoneW', new BufferAttribute(bW, 4));
  geo.setAttribute('aMark', new BufferAttribute(mark, 4));
  geo.setIndex(new BufferAttribute(m.index, 1));
  geo.computeBoundingSphere();
  return { geo, bones, body, b: idx, feet, eyes, mouth, length, stride, fur, verts: n };
}

// ───────────────────────────── quadrupeds ─────────────────────────────

function buildQuad(body: CreatureBody, S: QuadSpec, m: Morph): CreatureMesh {
  const fat = m.fat, strong = m.strong, gaunt = m.spiky;
  // morph factors: fat rounds the trunk, strong thickens the limbs and the forequarters, gaunt draws it all in
  const trunk = (1 + 0.22 * fat - 0.22 * gaunt);
  const belly = (1 + 0.38 * fat - 0.4 * gaunt);
  const limb = (1 + 0.28 * strong - 0.2 * gaunt);
  const fore = (1 + 0.18 * strong);
  const up: V3 = [0, 1, 0];
  const hip: V3 = [0, S.hipY - S.hipR[1] * 0.35, S.hipZ];
  const sho: V3 = [0, S.shoulderY - S.chestR[1] * 0.45, S.shoulderZ];
  const mid: V3 = lerp3(hip, sho, 0.5);
  const neckBase: V3 = add(sho, [0, S.chestR[1] * 0.35, S.chestR[2] * 0.45]);
  const neckDir: V3 = [0, S.neckUp, 1];
  const nl = Math.hypot(neckDir[1], neckDir[2]);
  const headBase: V3 = add(neckBase, [0, (S.neckUp / nl) * S.neckLen, (1 / nl) * S.neckLen]);
  const headC: V3 = add(headBase, [0, S.head[1] * 0.25, S.head[2] * 0.55]);
  const snoutDir: V3 = [0, Math.sin(S.headTilt), Math.cos(S.headTilt)];
  const snoutTip: V3 = add(headC, [0, snoutDir[1] * (S.head[2] * 0.6 + S.snout), snoutDir[2] * (S.head[2] * 0.6 + S.snout)]);
  const jawHinge: V3 = add(headC, [0, -S.head[1] * 0.45, -S.head[2] * 0.15]);
  const chin: V3 = add(snoutTip, [0, -S.snoutR[0] * 0.9, -S.snout * 0.15]);
  const tailRoot: V3 = add(hip, [0, S.hipR[1] * 0.45, -S.hipR[2] * 0.85]);
  const tailDir: V3 = [0, Math.sin(S.tailUp), -Math.cos(S.tailUp)];
  const t1 = add(tailRoot, [0, tailDir[1] * S.tail[0] * 0.38, tailDir[2] * S.tail[0] * 0.38]);
  const t2 = add(t1, [0, tailDir[1] * S.tail[0] * 0.33 - 0.03, tailDir[2] * S.tail[0] * 0.33]);
  const t3 = add(t2, [0, tailDir[1] * S.tail[0] * 0.29 - 0.05, tailDir[2] * S.tail[0] * 0.29]);
  // legs: [hipjoint, knee, ankle, toe]
  const leg = (front: boolean, left: boolean): V3[] => {
    const sx = (left ? 1 : -1) * S.legSpread * (front ? 1 : 1.05) * (1 + 0.1 * fat);
    const base: V3 = front ? [sx, sho[1] - 0.02, sho[2] + 0.02] : [sx, hip[1] - 0.02, hip[2] + 0.02];
    const L = front ? S.frontLeg : S.hindLeg;
    if (!front && S.digitigrade) {
      // hind: thigh forward-down, shin back-down, a long metatarsal to the toes
      const knee: V3 = [sx, base[1] - L[0] * 0.9, base[2] + L[0] * 0.38];
      const ankle: V3 = [sx * 0.95, Math.max(L[2] + 0.01, knee[1] - L[1] * 0.9), knee[2] - L[1] * 0.42];
      const toe: V3 = [sx * 0.95, 0.025, ankle[2] + 0.05];
      return [base, knee, ankle, toe];
    }
    if (!front) {
      const knee: V3 = [sx, base[1] - L[0] * 0.92, base[2] + L[0] * 0.3];
      const ankle: V3 = [sx * 0.97, Math.max(L[2], knee[1] - L[1] * 0.95), knee[2] - L[1] * 0.25];
      const toe: V3 = [sx * 0.97, 0.02, ankle[2] + (S.hoof ? 0.03 : 0.07)];
      return [base, knee, ankle, toe];
    }
    const elbow: V3 = [sx, base[1] - L[0] * 0.95, base[2] - L[0] * 0.2];
    const wrist: V3 = [sx * 0.97, Math.max(L[2], elbow[1] - L[1]), elbow[2] + 0.02];
    const toe: V3 = [sx * 0.97, 0.02, wrist[2] + (S.digitigrade ? 0.07 : S.hoof ? 0.03 : 0.08)];
    return [base, elbow, wrist, toe];
  };
  const LF = leg(true, true), RF = leg(true, false), LH = leg(false, true), RH = leg(false, false);
  // ── bones ──
  const bones: RigBone[] = [];
  const B = (name: string, parent: number, a: V3, b: V3, r: number, u: V3 = up) => { bones.push(bone(name, parent, a, b, u, r)); return bones.length - 1; };
  const root = B('pelvis', -1, hip, mid, S.hipR[1]);
  const spine = B('spine', root, mid, sho, S.bellyR[1]);
  const chest = B('chest', spine, sho, neckBase, S.chestR[1]);
  const neck = B('neck', chest, neckBase, headBase, S.neckR[0]);
  const head = B('head', neck, headBase, snoutTip, S.head[1]);
  const jaw = B('jaw', head, jawHinge, chin, S.snoutR[1] * 0.8);
  const tail = [B('tail1', root, tailRoot, t1, S.tail[1] + S.tailBushy), 0, 0];
  tail[1] = B('tail2', tail[0], t1, t2, S.tail[1] + S.tailBushy);
  tail[2] = B('tail3', tail[1], t2, t3, S.tail[2] + S.tailBushy);
  const legs: number[][] = [];
  const legBones = (L: V3[], name: string, parent: number, rs: number[]) => {
    const a = B(`${name}.up`, parent, L[0], L[1], rs[0], FWD);
    const b = B(`${name}.lo`, a, L[1], L[2], rs[1], FWD);
    const c = B(`${name}.ft`, b, L[2], L[3], rs[2], up);
    legs.push([a, b, c]);
  };
  const lr = S.legR.map((r) => r * limb);
  legBones(LF, 'fl.l', chest, [lr[0] * fore, lr[1] * fore, lr[2]]);
  legBones(RF, 'fl.r', chest, [lr[0] * fore, lr[1] * fore, lr[2]]);
  legBones(LH, 'hl.l', root, [lr[0], lr[1], lr[2]]);
  legBones(RH, 'hl.r', root, [lr[0], lr[1], lr[2]]);
  const earBase: V3 = add(headC, [S.head[0] * 0.55, S.head[1] * 0.7, -S.head[2] * 0.3]);
  const earTip: V3 = add(earBase, [S.ear[1] * 0.6, S.ear[0], S.earPointed ? 0.0 : -0.02]);
  const ears = [B('ear.l', head, earBase, earTip, S.ear[1], FWD), B('ear.r', head, mx(earBase), mx(earTip), S.ear[1], FWD)];
  // ── flesh ──
  const P: Prim[] = [];
  const hipC: V3 = add(hip, [0, 0, 0]);
  P.push(ell(hipC, [S.hipR[0] * trunk, S.hipR[1] * trunk, S.hipR[2] * trunk], 0.08));
  P.push(ell(lerp3(hip, sho, 0.5), [S.bellyR[0] * belly * S.waist / 0.8, S.bellyR[1] * belly, S.bellyR[2]], 0.12, 1));
  P.push(ell(add(sho, [0, -0.02, -0.02]), [S.chestR[0] * trunk * fore, S.chestR[1] * trunk, S.chestR[2]], 0.1));
  // the back line and the withers / hump
  P.push(cone(add(hip, [0, S.hipR[1] * 0.6, 0]), add(sho, [0, S.chestR[1] * 0.62 + S.hump, 0]), 0.07 * trunk, (0.08 + S.hump * 0.4) * trunk, 0.1));
  // the belly line (tucked for the lean ones, sagging for the fat)
  P.push(cone(add(hip, [0, -S.hipR[1] * 0.5, 0.06]), add(sho, [0, -S.chestR[1] * 0.75, -0.04]), 0.06 * belly, 0.09 * trunk, 0.12, 1));
  // shoulders and haunches
  for (const s of [1, -1]) {
    P.push(ell([s * S.legSpread * 0.9, sho[1] - 0.05, sho[2] - 0.01], [0.08 * limb * fore, 0.16 * limb, 0.13 * limb], 0.07));
    P.push(ell([s * S.legSpread * 0.85, hip[1] - 0.06, hip[2] + 0.02], [0.09 * limb, 0.17 * limb, 0.15 * limb], 0.07));
  }
  // neck, ruff, head
  P.push(cone(neckBase, headBase, S.neckR[0] * trunk * (1 + 0.15 * strong), S.neckR[1] * (1 + 0.1 * fat), 0.08));
  if (S.ruff > 0) P.push(ell(lerp3(neckBase, headBase, 0.35), [S.neckR[0] * 1.35, S.neckR[0] * 1.25, S.neckR[0]], 0.06));
  P.push(ell(headC, S.head, 0.06, 2));
  P.push(cone(add(headC, [0, -S.head[1] * 0.05, S.head[2] * 0.3]), snoutTip, S.snoutR[0], S.snoutR[1], 0.05, 2));
  // nose, jaw, cheeks, brows
  P.push(ell(add(snoutTip, [0, S.snoutR[1] * 0.25, -0.005]), [S.snoutR[1] * 0.75, S.snoutR[1] * 0.55, S.snoutR[1] * 0.45], 0.02, 2));
  P.push(cone(jawHinge, chin, S.snoutR[1] * 0.75, S.snoutR[1] * 0.55, 0.035, 2));
  for (const s of [1, -1]) {
    P.push(ell(add(headC, [s * S.head[0] * 0.55, -S.head[1] * 0.15, S.head[2] * 0.1]), [S.head[0] * 0.5, S.head[1] * 0.55, S.head[2] * 0.6], 0.04, 2));
  }
  const eyes: V3[] = [];
  for (const s of [1, -1]) {
    const e: V3 = add(headC, [s * S.head[0] * 0.66, S.head[1] * 0.28, S.head[2] * 0.52]);
    eyes.push(e);
    // the socket, then the eyeball in it
    P.push({ ...ell(add(e, [s * 0.012, 0.004, 0.006]), [0.034, 0.026, 0.03], 0.012), sub: true });
    P.push(ell(e, [0.026, 0.026, 0.026], 0.006, 2));
    // a brow ridge over it
    P.push(cone(add(e, [s * -0.03, 0.03, -0.01]), add(e, [s * 0.025, 0.028, 0.012]), 0.016, 0.012, 0.02, 2));
  }
  // ears
  for (const s of [1, -1]) {
    const eb: V3 = s > 0 ? earBase : mx(earBase), et: V3 = s > 0 ? earTip : mx(earTip);
    P.push(cone(eb, et, S.ear[1] * (S.earPointed ? 1 : 0.9), S.earPointed ? 0.006 : S.ear[1] * 0.6, 0.02));
  }
  // horns (ox): sweeping out and up, three segments tapering to a point
  if (S.horns) for (const s of [1, -1]) {
    const h0: V3 = add(headC, [s * S.head[0] * 0.7, S.head[1] * 0.75, -S.head[2] * 0.25]);
    const h1: V3 = add(h0, [s * 0.12, 0.02, 0.02]);
    const h2: V3 = add(h1, [s * 0.08, 0.08, 0.04]);
    const h3: V3 = add(h2, [s * 0.0, 0.08, 0.06]);
    P.push(cone(h0, h1, 0.032, 0.026, 0.02, 3), cone(h1, h2, 0.026, 0.017, 0.008, 3), cone(h2, h3, 0.017, 0.004, 0.006, 3));
  }
  // legs
  const legFlesh = (L: V3[], rs: number[], front: boolean) => {
    P.push(cone(L[0], L[1], rs[0], rs[1] * 1.05, 0.05));
    P.push(cone(L[1], L[2], rs[1], rs[2], 0.035));
    // the foot: a hoof, a paw or a broad bear's foot
    const fr = S.paw * (1 + 0.2 * strong);
    if (S.hoof) {
      P.push(cone(L[2], add(L[3], [0, 0.01, 0]), rs[2], fr * 0.75, 0.02));
      P.push(ell(add(L[3], [0, 0.02, 0]), [fr * 0.8, 0.035, fr * 0.85], 0.012, 3));
    } else {
      P.push(cone(L[2], L[3], rs[2] * 0.95, fr * 0.6, 0.03));
      P.push(ell(add(L[3], [0, fr * 0.35, 0.01]), [fr * 0.95, fr * 0.5, fr * 1.1], 0.03));
      // toes / claws
      for (let k = -1; k <= 1; k++) P.push(cone(add(L[3], [k * fr * 0.5, fr * 0.2, fr * 0.6]), add(L[3], [k * fr * 0.55, 0.012, fr * 1.25]), fr * 0.22, 0.008, 0.008, 3));
    }
    // knee / elbow bony points
    P.push(ell(L[1], [rs[1] * 1.05, rs[1] * 1.0, rs[1] * 1.0], 0.025));
    void front;
  };
  legFlesh(LF, [lr[0] * fore, lr[1] * fore, lr[2]], true);
  legFlesh(RF, [lr[0] * fore, lr[1] * fore, lr[2]], true);
  legFlesh(LH, lr, false);
  legFlesh(RH, lr, false);
  // tail
  P.push(cone(tailRoot, t1, S.tail[1] + S.tailBushy * 0.6, S.tail[1] + S.tailBushy, 0.04));
  P.push(cone(t1, t2, S.tail[1] + S.tailBushy, S.tail[2] + S.tailBushy * 1.1, 0.02));
  P.push(cone(t2, t3, S.tail[2] + S.tailBushy * 1.1, S.tail[2] * 0.6 + S.tailBushy * 0.6, 0.015));
  if (body === 'ox') P.push(ell(t3, [0.035, 0.07, 0.035], 0.015));
  // a cruel creature: spines along the back, spurs at the elbows
  if (gaunt > 0.05) {
    const n = 9;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const base = lerp3(add(hip, [0, S.hipR[1] * 0.75, -0.05]), add(sho, [0, S.chestR[1] * 0.75 + S.hump, 0.05]), t);
      const hgt = (0.06 + 0.09 * Math.sin(t * Math.PI)) * gaunt;
      P.push(cone(base, add(base, [0, hgt, -hgt * 0.45]), 0.022, 0.002, 0.012, 5));
    }
    for (const L of [LF, RF]) P.push(cone(L[1], add(L[1], [0, 0.02, -0.1 * gaunt]), 0.02, 0.002, 0.01, 5));
  }
  const feet = [LF[3], RF[3], LH[3], RH[3]];
  const zMin = Math.min(t3[2], tailRoot[2]) - 0.15, zMax = snoutTip[2] + 0.12;
  const xMax = S.legSpread + 0.3 + (S.horns ? 0.25 : 0);
  return finish(body, P, bones, { root, spine, chest, neck, head, jaw, tail, legs, ears }, feet, eyes, chin, S.fur,
    snoutTip[2] - tailRoot[2], (S.frontLeg[0] + S.frontLeg[1]) * 1.1,
    [-xMax, -0.02, zMin], [xMax, Math.max(headBase[1] + 0.35, 1.15), zMax],
    (x, y, z, nb) => {
      const name = bones[nb].name;
      if (name.endsWith('.ft') && y < S.paw * 0.9 && (S.hoof || true)) return y < 0.05 ? 3 : 0;
      if (name === 'head' || name === 'jaw') {
        // the face: the muzzle and around the eyes are short-haired skin
        const dz = z - headC[2];
        return dz > S.head[2] * 0.5 ? 2 : 0;
      }
      const lowBelly = (name === 'spine' || name === 'pelvis' || name === 'chest') && y < hip[1] - S.bellyR[1] * 0.25;
      return lowBelly ? 1 : 0;
    },
    (_x, y, _z, region) => (region === 3 ? 0 : region === 2 ? 0.2 : region === 1 ? 0.7 : y < 0.12 ? 0.5 : 1),
  );
}

// ───────────────────────────── the ape (a knuckle-walker) ─────────────────────────────

function buildApe(m: Morph): CreatureMesh {
  const fat = m.fat, strong = m.strong, gaunt = m.spiky;
  const trunk = 1 + 0.2 * fat - 0.22 * gaunt, limb = 1 + 0.3 * strong - 0.2 * gaunt;
  const up: V3 = [0, 1, 0];
  const hip: V3 = [0, 0.5, -0.2];
  const sho: V3 = [0, 0.86, 0.12];
  const mid = lerp3(hip, sho, 0.5);
  const neckBase: V3 = [0, 0.93, 0.2];
  const headBase: V3 = [0, 0.96, 0.3];
  const headC: V3 = [0, 0.98, 0.38];
  const snout: V3 = [0, 0.93, 0.5];
  const jawHinge: V3 = [0, 0.92, 0.38];
  const chin: V3 = [0, 0.86, 0.48];
  const bones: RigBone[] = [];
  const B = (name: string, parent: number, a: V3, b: V3, r: number, u: V3 = up) => { bones.push(bone(name, parent, a, b, u, r)); return bones.length - 1; };
  const root = B('pelvis', -1, hip, mid, 0.18);
  const spine = B('spine', root, mid, sho, 0.22);
  const chest = B('chest', spine, sho, neckBase, 0.24);
  const neck = B('neck', chest, neckBase, headBase, 0.12);
  const head = B('head', neck, headBase, snout, 0.13);
  const jaw = B('jaw', head, jawHinge, chin, 0.06);
  // arms (the "front legs"): shoulder → elbow → wrist → knuckles on the ground
  const arm = (s: number): V3[] => [[s * 0.24, 0.84, 0.14], [s * 0.3, 0.46, 0.2], [s * 0.27, 0.12, 0.24], [s * 0.25, 0.03, 0.31]];
  const legP = (s: number): V3[] => [[s * 0.13, 0.48, -0.2], [s * 0.18, 0.26, -0.06], [s * 0.17, 0.08, -0.17], [s * 0.18, 0.02, -0.02]];
  const LA = arm(1), RA = arm(-1), LL = legP(1), RL = legP(-1);
  const legs: number[][] = [];
  const chain = (L: V3[], name: string, parent: number, rs: number[]) => {
    const a = B(`${name}.up`, parent, L[0], L[1], rs[0], FWD);
    const b = B(`${name}.lo`, a, L[1], L[2], rs[1], FWD);
    const c = B(`${name}.ft`, b, L[2], L[3], rs[2], up);
    legs.push([a, b, c]);
  };
  chain(LA, 'fl.l', chest, [0.11 * limb, 0.09 * limb, 0.07]);
  chain(RA, 'fl.r', chest, [0.11 * limb, 0.09 * limb, 0.07]);
  chain(LL, 'hl.l', root, [0.1 * limb, 0.08 * limb, 0.06]);
  chain(RL, 'hl.r', root, [0.1 * limb, 0.08 * limb, 0.06]);
  const P: Prim[] = [];
  // trunk: a huge chest and shoulders tapering to the hips, the belly hanging between
  P.push(ell(add(sho, [0, -0.06, -0.04]), [0.3 * trunk * (1 + 0.15 * strong), 0.22 * trunk, 0.2 * trunk], 0.1));
  P.push(ell(mid, [0.24 * trunk * (1 + 0.25 * fat), 0.2 * trunk * (1 + 0.3 * fat), 0.22], 0.12, 1));
  P.push(ell(hip, [0.19 * trunk, 0.15, 0.15], 0.1));
  // the shoulder hump, the trapezius rising to the head
  P.push(cone(add(sho, [0, 0.08, -0.08]), add(neckBase, [0, 0.06, -0.02]), 0.17 * trunk * (1 + 0.2 * strong), 0.11, 0.08));
  for (const s of [1, -1]) P.push(ell([s * 0.22, 0.86, 0.12], [0.13 * limb, 0.12 * limb, 0.12 * limb], 0.08));
  // head: a cranium with a sagittal crest, the brow ridge, a short broad muzzle, the jaw
  P.push(ell(headC, [0.12, 0.11, 0.12], 0.05, 2));
  P.push(cone(add(headC, [0, 0.07, -0.06]), add(headC, [0, 0.09, 0.04]), 0.035, 0.03, 0.04));
  P.push(cone(add(headC, [0.09, 0.05, 0.085]), add(headC, [-0.09, 0.05, 0.085]), 0.03, 0.03, 0.03, 2));
  P.push(ell(snout, [0.085, 0.07, 0.06], 0.05, 2));
  P.push(ell(add(snout, [0, 0.025, 0.035]), [0.05, 0.03, 0.025], 0.02, 2));
  P.push(cone(jawHinge, chin, 0.07, 0.055, 0.04, 2));
  const eyes: V3[] = [];
  for (const s of [1, -1]) {
    const e: V3 = add(headC, [s * 0.05, 0.025, 0.1]);
    eyes.push(e);
    P.push({ ...ell(add(e, [0, 0, 0.012]), [0.03, 0.022, 0.025], 0.012), sub: true });
    P.push(ell(e, [0.021, 0.021, 0.021], 0.005, 2));
    P.push(ell(add(headC, [s * 0.115, 0.0, -0.01]), [0.02, 0.035, 0.03], 0.02, 2));
  }
  // arms: long, heavy; fists on their knuckles
  for (const [L, rs] of [[LA, [0.11, 0.095, 0.08]], [RA, [0.11, 0.095, 0.08]]] as [V3[], number[]][]) {
    P.push(cone(L[0], L[1], rs[0] * limb, rs[1] * limb, 0.05));
    P.push(ell(lerp3(L[1], L[2], 0.35), [rs[1] * limb * 1.15, rs[1] * limb * 1.2, rs[1] * limb * 1.1], 0.06));
    P.push(cone(L[1], L[2], rs[1] * limb, rs[2], 0.04));
    P.push(ell(add(L[3], [0, 0.04, -0.02]), [0.075, 0.055, 0.07], 0.04, 2));
  }
  // legs: short, bowed
  for (const L of [LL, RL]) {
    P.push(cone(L[0], L[1], 0.11 * limb, 0.085 * limb, 0.05));
    P.push(cone(L[1], L[2], 0.085 * limb, 0.06, 0.04));
    P.push(ell(add(L[3], [0, 0.02, 0.02]), [0.06, 0.035, 0.11], 0.04, 2));
  }
  if (gaunt > 0.05) {
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const base = lerp3(add(hip, [0, 0.12, -0.04]), add(sho, [0, 0.2, -0.1]), t);
      const hgt = (0.05 + 0.08 * Math.sin(t * Math.PI)) * gaunt;
      P.push(cone(base, add(base, [0, hgt, -hgt * 0.5]), 0.022, 0.002, 0.012, 5));
    }
  }
  const feet = [LA[3], RA[3], LL[3], RL[3]];
  return finish('ape', P, bones, { root, spine, chest, neck, head, jaw, tail: [], legs, ears: [] }, feet, eyes, chin, 1, 0.75, 0.55,
    [-0.48, -0.02, -0.45], [0.48, 1.2, 0.62],
    (x, y, z, nb) => {
      const name = bones[nb].name;
      if (name === 'head' || name === 'jaw') return z > headC[2] + 0.05 || (y < headC[1] - 0.02 && z > headC[2]) ? 2 : 0;
      if (name.endsWith('.ft')) return y < 0.07 ? 2 : 0;
      if ((name === 'spine' || name === 'chest') && z > mid[2] + 0.1 && y < sho[1]) return 2;
      void x;
      return 0;
    },
    (_x, _y, _z, region) => (region === 2 ? 0.1 : 1),
  );
}

// ───────────────────────────── the tortoise ─────────────────────────────

function buildTortoise(m: Morph): CreatureMesh {
  const fat = m.fat, strong = m.strong, gaunt = m.spiky;
  const limb = 1 + 0.3 * strong - 0.15 * gaunt;
  const up: V3 = [0, 1, 0];
  const shellC: V3 = [0, 0.48, -0.05];
  const shellR: V3 = [0.48 * (1 + 0.08 * fat), 0.48 * (1 + 0.12 * fat), 0.62];
  const hip: V3 = [0, 0.36, -0.32];
  const sho: V3 = [0, 0.38, 0.24];
  const mid = lerp3(hip, sho, 0.5);
  const neckBase: V3 = [0, 0.4, 0.45];
  const headBase: V3 = [0, 0.52, 0.78];
  const headC: V3 = [0, 0.55, 0.86];
  const snout: V3 = [0, 0.52, 0.99];
  const bones: RigBone[] = [];
  const B = (name: string, parent: number, a: V3, b: V3, r: number, u: V3 = up) => { bones.push(bone(name, parent, a, b, u, r)); return bones.length - 1; };
  const root = B('pelvis', -1, hip, mid, 0.3);
  const spine = B('spine', root, mid, sho, 0.32);
  const chest = B('chest', spine, sho, neckBase, 0.2);
  const neck = B('neck', chest, neckBase, headBase, 0.075);
  const head = B('head', neck, headBase, snout, 0.08);
  const jaw = B('jaw', head, [0, 0.5, 0.86], [0, 0.48, 0.97], 0.04);
  const tail0 = B('tail1', root, [0, 0.3, -0.55], [0, 0.22, -0.68], 0.04);
  const legs: number[][] = [];
  const legDef = (s: number, front: boolean): V3[] => {
    const z = front ? 0.3 : -0.36;
    return [[s * 0.33, 0.34, z], [s * 0.44, 0.2, z + (front ? 0.08 : -0.04)], [s * 0.45, 0.04, z + (front ? 0.12 : -0.02)], [s * 0.46, 0.015, z + (front ? 0.2 : 0.06)]];
  };
  const LF = legDef(1, true), RF = legDef(-1, true), LH = legDef(1, false), RH = legDef(-1, false);
  for (const [L, n, par] of [[LF, 'fl.l', chest], [RF, 'fl.r', chest], [LH, 'hl.l', root], [RH, 'hl.r', root]] as [V3[], string, number][]) {
    const a = B(`${n}.up`, par, L[0], L[1], 0.09 * limb, FWD);
    const b = B(`${n}.lo`, a, L[1], L[2], 0.085 * limb, FWD);
    const c = B(`${n}.ft`, b, L[2], L[3], 0.08, up);
    legs.push([a, b, c]);
  }
  const P: Prim[] = [];
  // the shell: a dome cut flat underneath (the plastron), with a rim
  P.push(ell(shellC, shellR, 0.04, 4));
  P.push({ ...ell([0, -0.8, -0.05], [2, 1.02, 2], 0.06), sub: true });
  P.push(ell([0, 0.24, -0.05], [0.44, 0.07, 0.56], 0.03, 1));
  P.push(ell([0, 0.28, -0.05], [0.5 * (1 + 0.08 * fat), 0.04, 0.64], 0.02, 4));
  // knobs for a cruel shell: spikes on the scutes
  if (gaunt > 0.05) for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const p: V3 = [Math.cos(a) * 0.32, 0.72 + 0.05 * Math.sin(a * 2), -0.05 + Math.sin(a) * 0.4];
    const n: V3 = [p[0] - shellC[0], p[1] - shellC[1], p[2] - shellC[2]];
    const l = Math.hypot(n[0], n[1], n[2]);
    P.push(cone(p, add(p, [n[0] / l * 0.1 * gaunt, n[1] / l * 0.1 * gaunt, n[2] / l * 0.1 * gaunt]), 0.035, 0.003, 0.012, 5));
  }
  // neck, head (a beak), legs as columns with nails, a stub tail
  P.push(cone(neckBase, headBase, 0.09 * (1 + 0.15 * fat), 0.065, 0.05, 2));
  P.push(ell(headC, [0.075, 0.07, 0.11], 0.04, 2));
  P.push(cone(add(headC, [0, -0.01, 0.06]), snout, 0.06, 0.03, 0.03, 2));
  P.push(cone([0, 0.5, 0.86], [0, 0.48, 0.97], 0.045, 0.02, 0.02, 2));
  const eyes: V3[] = [];
  for (const s of [1, -1]) {
    const e: V3 = add(headC, [s * 0.055, 0.025, 0.05]);
    eyes.push(e);
    P.push(ell(e, [0.02, 0.02, 0.02], 0.005, 2));
  }
  for (const L of [LF, RF, LH, RH]) {
    P.push(cone(L[0], L[1], 0.1 * limb, 0.095 * limb, 0.05, 2));
    P.push(cone(L[1], L[2], 0.095 * limb, 0.1 * limb, 0.03, 2));
    P.push(ell(add(L[2], [0, 0.0, 0.03]), [0.11 * limb, 0.05, 0.12], 0.03, 2));
    for (let k = -1; k <= 1; k++) P.push(cone(add(L[3], [k * 0.05, 0.03, -0.01]), add(L[3], [k * 0.06, 0.01, 0.04]), 0.018, 0.006, 0.006, 3));
  }
  P.push(cone([0, 0.3, -0.55], [0, 0.22, -0.68], 0.05, 0.015, 0.03, 2));
  const feet = [LF[3], RF[3], LH[3], RH[3]];
  return finish('tortoise', P, bones, { root, spine, chest, neck, head, jaw, tail: [tail0], legs, ears: [] }, feet, eyes, snout, 0, 1.3, 0.3,
    [-0.62, -0.02, -0.75], [0.62, 1.02, 1.08],
    (x, y, z, nb) => {
      const name = bones[nb].name;
      const se = (x / shellR[0]) ** 2 + ((y - shellC[1]) / shellR[1]) ** 2 + ((z - shellC[2]) / shellR[2]) ** 2;
      if (name === 'pelvis' || name === 'spine' || name === 'chest') return y > 0.29 && se > 0.75 ? 4 : y <= 0.29 ? 1 : 4;
      if (name.endsWith('.ft') && y < 0.04) return 3;
      return 2;
    },
    () => 0,
  );
}
