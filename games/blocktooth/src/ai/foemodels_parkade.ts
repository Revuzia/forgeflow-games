// BLOCKTOOTH v2 — PARKADE-6, the HALVARD MOBILE PARKING STRUCTURE (FEATURES_V2 §10.3, lane L7). VIEW.
//
// A six-legged multi-storey car park that walks. Everything is faceted low poly built with the foe Facet kit
// (non-indexed, flat normals, painted vertex colours, baked outline normals, 3.0 px ink hulls), authored
// facing +Z, ~64 m tall, ~50 × 70 m in plan:
//   * 4 open decks (P1–P4): concrete slabs on a 3 × 4 grid of square pillars (hazard-banded feet), cream
//     parapets with a coral cap rail and a coral slab stripe, painted bay lines + a dashed aisle line, a big
//     block-lettered level decal on three faces of every deck. Each deck is its OWN mesh on its own storey
//     joint, so the stack can squash (DECK DROP), pancake and restack (LEVEL COLLAPSE), sag (JAMMED) and
//     slide off like dominoes (defeat). The roof deck carries lamp posts and the stair/lift tower (the
//     64 m top) with a parking "P" sign on each face; its rear half is a hinged launch ramp (RAMP LAUNCH).
//   * 2 spiral ramps at the rear corners: helical ramp strips with a coral curb wrapped round a banded core.
//   * 6 legs (instanced: 3 draws + hulls): teal hydraulic piston + chrome rod (upper), navy strut with a
//     hazard band (lower), octagonal foot pad ringed with black/yellow hazard blocks. Two-bone IK, TRIPOD
//     gait (FL·MR·BL / FR·ML·BR), knees ride outward like stilts; per-leg hit flash through `instFlash`.
//   * the toll-booth head: cream cabin with a window band, a navy sign reading PAY ON EXIT, coral roof, a
//     rotating amber BEACON (its own glow material, glare-bar bounded), a yellow/black barrier pedestal.
//   * the BARRIER ARM: red/cream striped boom with a counterweight on a yaw + raise pivot.
//   * the TILL: a coral pay-station drawer with a coin slot and a gold interior (glow 3–8× the surface when
//     open) on hanger posts under a telescoping steel rail; it runs out of the booth front and drops to the
//     titan's chest height, placed from the till part's LIVE oz / y0 / y1.
//   * the tow WINCH under the booth: a spinning drum with a spooled chain and a hook.
//   * 24 parked toy cars: ONE InstancedMesh (+ hull) with per-instance paint from GRID-EAST's car list;
//     launched cars hide, restock with a pop, get crushed by a pancake and spill on defeat.
// Chain links (TOW CHAIN) and JAMMED steam puffs are instanced meshes in world space (bossview places the
// chain; the poser below emits the steam).
//
// Budget: 17 meshes → 34 draws including hulls, instanced cars / legs / links / puffs, zero per-frame
// allocation (scratch objects, fixed pools).

import * as THREE from 'three';
import type { BossState, World } from '../core/types.ts';
import { clamp, easeInCubic, easeOutBack, easeOutCubic, lerp, smoothstep, wrapAngle } from '../core/math.ts';
import { addOutline } from '../render/materials.ts';
import { FOE_PAL, Facet, M, makeFoeMaterial, ngon, rect } from './foemodels.ts';
import type { BossRig, FlashGroup } from './bossview.ts';

const P = FOE_PAL;
const PI = Math.PI;
const OUTLINE_W = 3.0;

// ─────────────────────────────── palette (GRID-EAST civic livery) ───────────────────────────────
export const PK = {
  cream: '#f1e4c8', creamD: '#dccfb2', coral: '#ff6f5e', coralD: '#e0513f',
  teal: '#2f7f86', tealD: '#225f65', chrome: '#d9dee3',
  conc: '#b9b2a3', concD: '#9a9385', asphalt: '#7b8388', line: '#f4ecd8',
  amber: '#ffb13b', glass: '#5f9fb3', glassD: '#3f6f82',
  red: '#e84a3c', hzY: '#ffc63d', hzK: '#1e242e',
  gold: '#ffbb2e', goldD: '#d9951c', cash: '#8fd08f',
  sign: '#3d5a80', lamp: '#fff1c4',
} as const;
/** GRID-EAST car paint list (city/meshkit.ts styleOf, day): the same toys that park on its streets. */
const CAR_PAINT = ['#ff6f5e', '#4f8fb0', '#f4efe4', '#6fbf9e', '#3d5a80', '#e6ab4a', '#c95d63', '#9f94d4'] as const;

// ─────────────────────────────── dimensions (metres) ───────────────────────────────
export const PKD = {
  bodyY: 22,               // root → body joint: the underside of the P1 slab
  storey: 8.4, slab: 1.8,  // deck spacing + slab thickness
  halfX: 19, zFront: 22, zBack: -24,
  tiltPivotZ: 22,          // the roof deck hinges at its front edge: the rear lip kicks up (RAMP LAUNCH)
  L1: 12.5, L2: 13,        // leg bones
  stride: 6.3, duty: 0.55, liftH: 2.6, rMean: 26, walk: 7,
  // booth + till (body-local)
  boothPivot: [0, 22, 24] as const,
  armPivot: [9, 24.4, 35] as const, armLen: 31,
  winch: [0, 14.2, 30] as const,
  drawerClosed: [0, 19.6, 32.8] as const,
  railY: 22.35, railZ0: 28,
  beacon: [0, 30.1, 31.5] as const,
} as const;

/** leg order = the sim's part order (bosses/parkade6.ts create): FL FR ML MR BL BR */
export const PK_LEGS = ['legFL', 'legFR', 'legML', 'legMR', 'legBL', 'legBR'] as const;
const HIPS: readonly (readonly [number, number, number])[] = [
  [16.5, -1.3, 19], [-16.5, -1.3, 19], [18, -1.3, 0], [-18, -1.3, 0], [16.5, -1.3, -19], [-16.5, -1.3, -19],
];
const FEET: readonly (readonly [number, number, number])[] = [
  [24, 2.4, 25], [-24, 2.4, 25], [27, 2.4, 0], [-27, 2.4, 0], [24, 2.4, -25], [-24, 2.4, -25],
];
/** tripod gait: FL, MR, BL swing together; FR, ML, BR half a cycle later */
const GAIT_OFF = [0, 0.5, 0.5, 0, 0, 0.5] as const;

// ─────────────────────────────── block letters (build time) ───────────────────────────────
const GLYPH: Record<string, readonly string[]> = {
  P: ['111', '101', '111', '100', '100'], A: ['010', '101', '111', '101', '101'], Y: ['101', '101', '010', '010', '010'],
  O: ['111', '101', '101', '101', '111'], N: ['1001', '1101', '1011', '1001', '1001'], E: ['111', '100', '110', '100', '111'],
  X: ['101', '101', '010', '101', '101'], I: ['111', '010', '010', '010', '111'], T: ['111', '010', '010', '010', '010'],
  L: ['100', '100', '100', '100', '111'],
  '1': ['010', '110', '010', '010', '111'], '2': ['110', '001', '010', '100', '111'], '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'], '6': ['011', '100', '110', '101', '010'], '-': ['000', '000', '111', '000', '000'],
};
/** Width in cells of a string (1-cell gaps, 2-cell spaces). */
function textCells(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) { const g = GLYPH[s[i]]; n += (g ? g[0].length : 2) + (i < s.length - 1 ? 1 : 0); }
  return n;
}
/** Raised block letters in the local XY plane (centred on the origin, facing +Z, `d` proud). */
function blockText(f: Facet, s: string, cell: number, d: number, col: string, m: THREE.Matrix4): void {
  f.group(m, () => {
    let x = -textCells(s) * cell / 2;
    for (let i = 0; i < s.length; i++) {
      const g = GLYPH[s[i]];
      if (!g) { x += 3 * cell; continue; }
      for (let r = 0; r < 5; r++) {
        const row = g[r];
        let c = 0;
        while (c < row.length) {
          if (row[c] !== '1') { c++; continue; }
          let e = c; while (e < row.length && row[e] === '1') e++;
          const w = (e - c) * cell;
          f.box(w, cell, d, col, M(x + c * cell + w / 2, (2 - r) * cell, d / 2));
          c = e;
        }
      }
      x += (g[0].length + 1) * cell;
    }
  });
}

// ─────────────────────────────── part builders ───────────────────────────────
const S = PKD.storey, SL = PKD.slab, HX = PKD.halfX, ZF = PKD.zFront, ZB = PKD.zBack;
const ZC = (ZF + ZB) / 2, DZ = ZF - ZB;
const PIL_X = [-17.2, 0, 17.2] as const;
const PIL_Z = [-21.6, -7.6, 6.4, 19.8] as const;

/** One deck storey: slab k (origin at its underside), its parapets, bay paint, decals, pillars up to k + 1. */
function deckGeo(f: Facet, k: number): void {
  // slab: concrete edge, asphalt top, a coral stripe round the edge
  f.box(HX * 2, SL, DZ, PK.conc, M(0, SL / 2, ZC), { ch: 1.4, top: PK.asphalt, bottom: PK.concD });
  f.box(HX * 2 + 0.3, 0.55, DZ + 0.3, PK.coral, M(0, SL * 0.46, ZC), { ch: 1.5 });
  // parapets: cream wall, coral cap rail (open front aisle in the middle)
  const ph = 1.4, py = SL + ph / 2;
  f.mirrorX(() => {
    f.box(0.6, ph, DZ - 0.4, PK.cream, M(HX - 0.3, py, ZC), { top: PK.coral });
    f.box(0.9, 0.35, DZ - 0.2, PK.coral, M(HX - 0.3, SL + ph + 0.12, ZC));
    f.box(HX - 6.5, ph, 0.6, PK.cream, M((HX + 6.5) / 2, py, ZF - 0.3), { top: PK.coral });
    f.box(HX - 6.3, 0.35, 0.9, PK.coral, M((HX + 6.5) / 2, SL + ph + 0.12, ZF - 0.3));
  });
  f.box(HX * 2 - 1.2, ph, 0.6, PK.cream, M(0, py, ZB + 0.3), { top: PK.coral });
  f.box(HX * 2 - 1, 0.35, 0.9, PK.coral, M(0, SL + ph + 0.12, ZB + 0.3));
  // painted bays (lines along X either side of the aisle) + dashed aisle centre line
  const ly = SL + 0.04;
  f.mirrorX(() => {
    for (let j = 0; j <= 7; j++) f.box(9.6, 0.08, 0.32, PK.line, M(11.6, ly, -20.5 + j * 5.6));
    f.box(0.32, 0.08, 40, PK.line, M(6.8, ly, ZC + 0.5));
  });
  for (let j = 0; j < 7; j++) f.box(0.36, 0.08, 3.2, PK.hzY, M(0, ly, -19 + j * 6));
  // level decal: navy plate + cream "P<k>" on both flanks and the rear
  const tag = 'P' + (k + 1);
  // (explicit per face, never mirrorX: a mirrored group would mirror the letters)
  const decal = (m: THREE.Matrix4) => f.group(m, () => {
    f.box(6.2, 2.9, 0.25, PK.sign, M(0, 1.55, 0.12));
    blockText(f, tag, 0.46, 0.2, PK.cream, M(0, 1.55, 0.24));
  });
  decal(M(HX + 0.02, 0, 9, 0, PI / 2));
  decal(M(-HX - 0.02, 0, 9, 0, -PI / 2));
  decal(M(9, 0, ZB - 0.02, 0, PI));
  // pillars up to the next slab (the top deck carries the roof furniture instead)
  if (k < 3) {
    const h = S - SL;
    for (const x of PIL_X) for (const z of PIL_Z) {
      f.box(1.7, h, 1.7, PK.cream, M(x, SL + h / 2, z), { ch: 0.3 });
      f.box(1.9, 0.9, 1.9, PK.hzY, M(x, SL + 0.45, z), { ch: 0.3 });
      f.box(1.95, 0.35, 1.95, PK.hzK, M(x, SL + 0.62, z), { ch: 0.3 });
    }
  }
  if (k === 0) underframe(f);
  if (k === 3) roofFurniture(f);
}

/** Under the P1 slab: hip housings (hydraulic sockets), longitudinal girders, reversing + tail lamps. */
function underframe(f: Facet): void {
  f.mirrorX(() => {
    f.box(1.6, 1.6, DZ - 3, P.navy, M(16, -0.8, ZC), { ch: 0.3 });
    f.box(1.4, 1.2, DZ - 3, P.navy, M(6.5, -0.6, ZC), { ch: 0.3 });
  });
  for (const h of HIPS) {
    f.box(4.4, 1.8, 4.4, P.navyD, M(h[0], -0.6, h[2]), { ch: 0.6 });
    f.cyl(1.9, 1.9, 1.4, 8, PK.teal, M(h[0], h[1] - 0.2, h[2]), { top: P.navyD, bottom: PK.tealD });
  }
  // rear lamps: amber reversing pair outside, red tail pair inside (glow)
  f.mirrorX(() => {
    f.box(2.2, 1.1, 0.5, PK.lamp, M(15.5, 0.9, ZB - 0.25), { glow: 0.9 });
    f.box(2.2, 1.1, 0.5, PK.red, M(11.8, 0.9, ZB - 0.25), { glow: 0.8 });
  });
  f.group(M(0, 0.9, ZB - 0.02, 0, PI), () => f.hazard(-8, 8, -0.6, 0.6, 0.2, 10, PK.hzY, PK.hzK));
}

/** Roof deck: lamp posts, the stair / lift tower (the 64 m top) with a parking "P" on every face. */
function roofFurniture(f: Facet): void {
  const top = SL;
  for (const [x, z] of [[13, 14], [-13, 14], [13, -6], [-13, -6]] as const) {
    f.box(0.5, 6, 0.5, PK.creamD, M(x, top + 3, z));
    f.box(2.2, 0.5, 0.9, P.navy, M(x - Math.sign(x) * 0.8, top + 6.1, z));
    f.box(1.6, 0.25, 0.6, PK.lamp, M(x - Math.sign(x) * 0.8, top + 5.8, z), { glow: 0.6 });
  }
  // tower: cream shaft with coral corners, a glass stair slot, a navy machine-room cap
  const tx = -10, tz = -18.5, th = 14.6, tw = 7.2;
  f.box(tw, th, tw, PK.cream, M(tx, top + th / 2, tz), { ch: 0.5 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(0.8, th, 0.8, PK.coral, M(tx + sx * (tw / 2 - 0.2), top + th / 2, tz + sz * (tw / 2 - 0.2)));
  f.box(1.6, th - 5, tw + 0.1, PK.glassD, M(tx + 1.2, top + (th - 5) / 2 + 0.6, tz));
  f.box(tw + 0.1, th - 5, 1.6, PK.glassD, M(tx, top + (th - 5) / 2 + 0.6, tz - 1.2));
  f.box(tw + 0.8, 1.2, tw + 0.8, P.navy, M(tx, top + th + 0.6, tz), { ch: 0.4 });
  const sy = top + th - 2.4;
  const face = (m: THREE.Matrix4) => f.group(m, () => {
    f.box(4.6, 4.6, 0.3, PK.sign, M(0, 0, 0.15), { ch: 0.5 });
    blockText(f, 'P', 0.72, 0.22, PK.cream, M(0, 0, 0.3));
  });
  face(M(tx, sy, tz + tw / 2 + 0.02));
  face(M(tx + tw / 2 + 0.02, sy, tz, 0, PI / 2));
  face(M(tx - tw / 2 - 0.02, sy, tz, 0, -PI / 2));
  face(M(tx, sy, tz - tw / 2 - 0.02, 0, PI));
  // the launch lip at the rear edge of the roof ramp: hazard kicker
  f.group(M(0, top + 0.1, ZB + 1.6, -PI / 2), () => f.hazard(-17, 17, -1.2, 1.2, 0.35, 16, PK.hzY, PK.hzK));
}

/** Two helical ramps at the rear corners (mirrored), wrapped round banded cores. Body-local. */
function rampGeo(f: Facet): void {
  const cx = 14.2, cz = -29.2, r0 = 2.6, r1 = 6.8, rm = (r0 + r1) / 2;
  const turns = 3, seg = 15, y0 = SL, y1 = 3 * S + SL;
  f.mirrorX((side) => {
    for (let b = 0; b < 3; b++) {
      f.cyl(r0, r0, S, 10, b % 2 ? PK.coral : PK.cream, M(cx, b * S + S / 2, cz), { top: null, bottom: null });
    }
    f.cyl(r0, r0, SL + 1.6, 10, PK.coral, M(cx, 3 * S + (SL + 1.6) / 2, cz), { top: null, bottom: null });
    f.cyl(r0 + 0.5, r0 + 0.3, 0.8, 10, P.navy, M(cx, 3 * S + SL + 2, cz), { top: PK.cream });
    const n = turns * seg;
    for (let i = 0; i < n; i++) {
      const a0 = (i / seg) * PI * 2 + 0.3, a1 = ((i + 1) / seg) * PI * 2 + 0.3;
      const ya = lerp(y0, y1, i / n), yb = lerp(y0, y1, (i + 1) / n);
      const sa = Math.sin(a0), ca = Math.cos(a0), sb = Math.sin(a1), cb = Math.cos(a1);
      f.beam(cx + sa * rm, ya - 0.3, cz + ca * rm, cx + sb * rm, yb - 0.3, cz + cb * rm, r1 - r0, 0.6, i % 3 === 0 ? PK.concD : PK.conc);
      f.beam(cx + sa * (r1 - 0.2), ya + 0.25, cz + ca * (r1 - 0.2), cx + sb * (r1 - 0.2), yb + 0.25, cz + cb * (r1 - 0.2), 0.4, 0.9, (i & 1) ? PK.coral : PK.cream);
    }
    void side;
  });
}

/** Toll-booth cabin + neck + winch bracket + barrier pedestal + beacon base. Authored in body space. */
function boothGeo(f: Facet): void {
  const cz = 31.5;
  // neck gantry from the upper decks to the booth
  f.box(10, 5.5, 6, P.navy, M(0, 20.5, 24.5), { ch: 0.8 });
  f.mirrorX(() => f.beam(4.5, 16.8, 22, 4.5, 16.2, 27, 1.2, 1.2, PK.coral));
  // lower body (cream) with the till housing recess in the front face
  f.box(13, 7.3, 11, PK.cream, M(0, 19.65, cz), { ch: 0.8, bottom: P.navyD });
  f.box(11.2, 5.0, 0.4, P.navyD, M(0, 19.6, cz + 5.4));
  f.hazard(-6.2, 6.2, 16.1, 16.9, 0.2, 12, PK.hzY, PK.hzK, M(0, 0, cz + 5.52));
  // window band: glass with navy mullions
  f.box(12.4, 3.4, 10.4, PK.glass, M(0, 25, cz), { ch: 0.9 });
  f.mirrorX(() => {
    f.box(0.5, 3.4, 0.5, P.navy, M(6.0, 25, cz + 4.95));
    f.box(0.5, 3.4, 0.5, P.navy, M(6.0, 25, cz - 4.95));
    f.box(0.5, 3.4, 0.4, P.navy, M(6.25, 25, cz));
  });
  f.box(0.4, 3.4, 0.5, P.navy, M(0, 25, cz + 5.2));
  f.box(13.2, 0.4, 11.2, PK.creamD, M(0, 23.35, cz), { ch: 0.9 });
  // sign band: PAY ON EXIT (front), PAY ON EXIT (rear, readable from behind)
  f.box(13.2, 1.7, 11.2, P.navy, M(0, 27.45, cz), { ch: 0.9 });
  const cell = 0.25;
  blockText(f, 'PAY ON EXIT', cell, 0.14, PK.cream, M(0, 27.45, cz + 5.62));
  blockText(f, 'PAY ON EXIT', cell, 0.14, PK.cream, M(0, 27.45, cz - 5.62, 0, PI));
  // coral roof with overhang + beacon plinth
  f.box(15, 1.2, 13, PK.coral, M(0, 28.9, cz), { ch: 0.6, top: PK.cream });
  f.cyl(2.0, 2.2, 0.9, 8, P.navy, M(PKD.beacon[0], 29.9, PKD.beacon[2]));
  // winch bracket (static): two plates hanging under the booth + a hook on a stub of chain
  const [wx, wy, wz] = PKD.winch;
  f.mirrorX(() => f.box(0.7, 3.8, 4, P.navyD, M(4.6, wy + 0.4, wz), { ch: 0.3 }));
  f.box(9.8, 0.7, 3, P.navy, M(wx, 16, wz));
  for (let i = 0; i < 3; i++) f.box(0.35, 1.2, 0.7, P.steelD, M(0, wy - 2.4 - i * 1.05, wz + 1.6));
  f.beam(0, wy - 5.4, wz + 1.6, 0, wy - 6.6, wz + 1.6, 0.9, 0.9, P.steel);
  f.beam(0, wy - 6.6, wz + 1.6, 0.9, wy - 7.5, wz + 1.6, 0.8, 0.8, PK.hzY);
  f.beam(0.9, wy - 7.5, wz + 1.6, 1.4, wy - 6.8, wz + 1.6, 0.7, 0.7, PK.hzY);
  // barrier pedestal: yellow/black striped post the arm pivots on
  const [ax, ay, az] = PKD.armPivot;
  f.box(3.2, 6.5, 3.2, PK.hzY, M(ax, ay - 3.4, az), { ch: 0.4, top: P.navyD });
  f.group(M(ax, 0, az + 1.62), () => f.hazard(-1.5, 1.5, ay - 6.2, ay - 1.2, 0.15, 3, PK.hzY, PK.hzK));
  f.group(M(ax + 1.62, 0, az, 0, PI / 2), () => f.hazard(-1.5, 1.5, ay - 6.2, ay - 1.2, 0.15, 3, PK.hzY, PK.hzK));
  f.beam(6.4, 21, az - 1, ax - 1.6, 21, az - 1, 1, 1, P.navy);
}

function beaconGeo(f: Facet): void {
  // rotor (spins about Y): amber lantern with two dark reflector vanes so the rotation reads
  f.cyl(1.75, 1.45, 2.8, 8, PK.amber, M(0, 1.4, 0), { glow: 1, top: PK.amber });
  f.box(3.7, 2.2, 0.4, P.navyD, M(0, 1.4, 0));
  f.cyl(1.1, 0.4, 0.8, 8, P.navy, M(0, 3.2, 0));
}

function armGeo(f: Facet): void {
  // boom along +X from the pivot: 3 m red / cream bands, reflector tip, counterweight behind the pivot
  const L = PKD.armLen, seg = 3;
  for (let i = 0; i * seg < L - 1; i++) {
    const x0 = 1 + i * seg, x1 = Math.min(L, x0 + seg);
    f.box(x1 - x0, 1.25 - i * 0.012, 1.25 - i * 0.012, (i & 1) ? PK.cream : PK.red, M((x0 + x1) / 2, 0, 0), { ch: 0.2 });
  }
  f.box(0.7, 1.6, 1.6, PK.amber, M(L + 0.2, 0, 0), { glow: 0.6 });
  f.cyl(1.4, 1.4, 3.4, 8, P.navy, M(0, 0, 0, PI / 2), { top: PK.hzY, bottom: PK.hzY });
  f.box(2.4, 3.2, 2.6, P.navyD, M(-2.2, -0.2, 0), { ch: 0.4 });
  f.group(M(-2.2, -0.2, 1.32), () => f.hazard(-1.1, 1.1, -1.4, 1.4, 0.12, 3, PK.hzY, PK.hzK));
  // a thin hanging fringe along the first third (a toll arm's skirt), so the boom reads as a barrier
  for (let i = 0; i < 6; i++) f.box(0.18, 1.6, 0.18, PK.cream, M(3 + i * 1.6, -1.4, 0));
}

function winchGeo(f: Facet): void {
  // drum spinning about X, chain wraps as dark bands, coral flanges
  f.cyl(1.8, 1.8, 8.4, 10, P.navyD, M(0, 0, 0, 0, 0, PI / 2), { top: PK.coral, bottom: PK.coral });
  f.mirrorX(() => f.cyl(2.7, 2.7, 0.5, 10, PK.coral, M(4.2, 0, 0, 0, 0, PI / 2)));
  for (let i = -3; i <= 3; i++) f.cyl(2.05, 2.05, 0.7, 10, i & 1 ? P.steelD : P.steel, M(i * 1.05, 0, 0, 0, 0, PI / 2), { top: null, bottom: null });
  f.box(8.6, 0.5, 0.9, PK.hzY, M(0, 2.0, 0));
}

function railGeo(f: Facet): void {
  // unit length along +Z (scaled per frame): twin runners + a top plate
  f.box(0.8, 1.0, 1, P.steel, M(4.4, 0, 0.5), { top: PK.chrome, bottom: P.steelD });
  f.box(0.8, 1.0, 1, P.steel, M(-4.4, 0, 0.5), { top: PK.chrome, bottom: P.steelD });
  f.box(0.3, 0.3, 1, PK.hzY, M(4.4, -0.62, 0.5));
  f.box(0.3, 0.3, 1, PK.hzY, M(-4.4, -0.62, 0.5));
}

function drawerGeo(f: Facet): void {
  // the TILL: an open-topped tray (origin = its centre) of gold, a coral front with a coin slot
  const w = 10, h = 4.4, d = 9, t = 0.6;
  f.box(w, t, d, P.steelD, M(0, -h / 2 + t / 2, 0));
  f.mirrorX(() => f.box(t, h, d, P.steel, M(w / 2 - t / 2, 0, 0), { top: PK.chrome }));
  f.box(w, h, t, P.steel, M(0, 0, -d / 2 + t / 2), { top: PK.chrome });
  f.box(w + 0.3, h + 0.3, 0.7, PK.coral, M(0, 0, d / 2 - 0.2), { ch: 0.3, top: PK.coralD });
  f.box(3.6, 0.45, 0.2, PK.hzK, M(0, 1.1, d / 2 + 0.18));                 // coin slot
  f.box(1.2, 1.2, 0.2, PK.cream, M(3.3, -0.3, d / 2 + 0.18));              // keypad
  blockText(f, 'TILL', 0.26, 0.12, PK.cream, M(-1.4, -0.9, d / 2 + 0.14));
  // gold interior: coin stacks + banded notes, glowing (the weak point reads from the camera above)
  f.box(w - 2 * t, 0.5, d - 1.2, PK.goldD, M(0, -h / 2 + t + 0.25, -0.2), { glow: 0.55 });
  let k = 0;
  for (let ix = -3; ix <= 3; ix += 1.5) for (let iz = -2.8; iz <= 2.6; iz += 1.35) {
    const hh = 0.8 + ((k * 7) % 5) * 0.28;
    if ((k % 4) === 3) f.box(1.2, 0.5, 0.8, PK.cash, M(ix, -h / 2 + t + 0.75, iz), { glow: 0.35 });
    else f.cyl(0.55, 0.55, hh, 7, PK.gold, M(ix, -h / 2 + t + 0.5 + hh / 2, iz), { glow: 1 });
    k++;
  }
  // hanger posts up to the rail + the rail shoe
  f.mirrorX(() => f.box(0.8, 6.6, 0.8, PK.teal, M(3.2, h / 2 + 3.3, -1.2), { top: P.navyD }));
  f.box(9.4, 0.7, 2.4, P.navy, M(0, h / 2 + 6.4, -1.2));
}

// legs (authored along +Y from the joint, +Z = knee side)
function legUpperGeo(f: Facet): void {
  const L = PKD.L1;
  f.box(3.4, 2.4, 3.4, P.navyD, M(0, 0.6, 0), { ch: 0.5 });
  f.cyl(1.75, 1.75, 7, 8, PK.teal, M(0, 4.6, 0), { top: PK.tealD, bottom: PK.tealD });
  f.cyl(1.95, 1.95, 0.6, 8, P.navy, M(0, 2.1, 0));
  f.cyl(1.95, 1.95, 0.6, 8, P.navy, M(0, 7.8, 0));
  f.cyl(0.8, 0.8, L - 8.6, 8, PK.chrome, M(0, 8.1 + (L - 8.6) / 2, 0));
  f.beam(1.6, 2.4, -0.6, 0.9, 8.4, -0.9, 0.45, 0.45, PK.hzK);                // hydraulic hose
  f.cyl(1.7, 1.7, 3.6, 8, P.navy, M(0, L, 0, 0, 0, PI / 2), { top: PK.hzY, bottom: PK.hzY });
}
function legLowerGeo(f: Facet): void {
  const L = PKD.L2;
  f.loft([
    { y: 0, pts: rect(2.6, 2.6, 0.5) },
    { y: L * 0.35, pts: rect(2.3, 2.3, 0.45) },
    { y: L * 0.85, pts: rect(1.9, 1.9, 0.4) },
    { y: L, pts: rect(2.2, 2.2, 0.45) },
  ], { side: [P.navy, P.navy, P.navyD], top: P.navyD, bottom: P.navyD });
  f.group(M(0, 0, 1.16), () => f.hazard(-1.0, 1.0, L * 0.55, L * 0.55 + 2.2, 0.15, 3, PK.hzY, PK.hzK));
  f.box(0.7, 0.7, 0.3, PK.lamp, M(0, L * 0.3, 1.2), { glow: 0.7 });
}
function footGeo(f: Facet): void {
  f.cyl(1.2, 1.4, 1.4, 8, P.steelD, M(0, -0.5, 0));
  f.loft([
    { y: -2.4, pts: ngon(8, 3.9, 3.9, PI / 8) },
    { y: -1.7, pts: ngon(8, 4.1, 4.1, PI / 8) },
    { y: -1.0, pts: ngon(8, 3.3, 3.3, PI / 8) },
  ], { side: [PK.hzK, P.navy], top: P.navy, bottom: PK.hzK });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * PI * 2;
    f.box(1.55, 0.55, 0.3, i & 1 ? PK.hzK : PK.hzY, M(Math.sin(a) * 4.05, -1.95, Math.cos(a) * 4.05, 0, a));
  }
}

function linkGeo(f: Facet): void {
  // one oval chain link, unit length along Z (x width 0.56, thickness 0.2)
  const hw = 0.28, hl = 0.5, t = 0.2;
  f.mirrorX(() => f.box(t, t, hl * 2 - 0.1, P.steel, M(hw, 0, 0), { top: PK.chrome }));
  f.box(hw * 2 + t, t, t, P.steelD, M(0, 0, hl - t / 2));
  f.box(hw * 2 + t, t, t, P.steelD, M(0, 0, -hl + t / 2));
}

function puffGeo(f: Facet): void {
  f.loft([
    { y: -0.5, pts: ngon(7, 0.2, 0.2) }, { y: -0.3, pts: ngon(7, 0.45, 0.45, 0.2) }, { y: 0.05, pts: ngon(7, 0.55, 0.55) },
    { y: 0.35, pts: ngon(7, 0.4, 0.4, 0.3) }, { y: 0.5, pts: ngon(7, 0.12, 0.12) },
  ], { side: ['#eef2f6', '#ffffff', '#ffffff', '#e2e8ee'], top: '#ffffff', bottom: '#dfe5eb' });
}

/**
 * A toy car (the city's family hatchback silhouette): body, glass cabin, painted roof, wheels, lamps.
 * `paint` colours the body (white = tintable per instance). `unit` → length 1 along Z centred at the origin
 * (the projectile view's convention), else real metres (4.2 m, wheels on y = 0).
 */
export function buildToyCarGeo(paint: string, unit: boolean): THREE.BufferGeometry {
  const f = new Facet(); f.jitter = 0.02;
  const s = unit ? 1 / 4.2 : 1, oy = unit ? -0.8 : 0;
  f.group(M(0, oy * s, 0, 0, 0, 0, s, s, s), () => {
    f.box(1.8, 0.62, 4.2, paint, M(0, 0.64, 0), { ch: 0.25, tw: 0.97, td: 0.95 });
    f.box(1.6, 0.55, 2.4, PK.glassD, M(0, 1.22, -0.25), { ch: 0.2, tw: 0.84, td: 0.78 });
    f.box(1.36, 0.1, 1.8, paint, M(0, 1.52, -0.3), { ch: 0.15 });
    f.box(1.84, 0.22, 0.18, P.steel, M(0, 0.44, 2.12));
    f.box(1.84, 0.22, 0.18, P.steel, M(0, 0.44, -2.12));
    f.mirrorX(() => {
      f.box(0.36, 0.18, 0.1, PK.lamp, M(0.62, 0.78, 2.1), { glow: 0.5 });
      f.box(0.36, 0.18, 0.1, PK.red, M(0.62, 0.8, -2.1), { glow: 0.5 });
      f.cyl(0.36, 0.36, 0.3, 8, P.tire, M(0.8, 0.36, 1.35, 0, 0, PI / 2), { top: P.steel, bottom: P.steel });
      f.cyl(0.36, 0.36, 0.3, 8, P.tire, M(0.8, 0.36, -1.35, 0, 0, PI / 2), { top: P.steel, bottom: P.steel });
    });
  });
  return f.build();
}

// ─────────────────────────────── rig ───────────────────────────────
export interface CarSlot { deck: number; local: THREE.Matrix4; pop: number; spin: number; sx: number; sz: number }
export interface ParkadeParts {
  decks: THREE.Group[];         // storey joints (children of body)
  tilt: THREE.Group;            // roof launch-ramp hinge (child of decks[3])
  ramps: THREE.Group;
  booth: THREE.Group; beacon: THREE.Group; armYaw: THREE.Group; armPitch: THREE.Group;
  rail: THREE.Mesh; drawer: THREE.Group; winch: THREE.Group;
  legUpper: THREE.InstancedMesh; legLower: THREE.InstancedMesh; legFoot: THREE.InstancedMesh;
  legFlash: THREE.InstancedBufferAttribute;
  cars: THREE.InstancedMesh; carSlots: CarSlot[]; topSlots: number[];
  chain: THREE.InstancedMesh;   // world space (bossview.ts places it)
  steam: THREE.InstancedMesh;   // world space
  winchTip: THREE.Object3D;     // chain exit point (child of the winch bracket)
}
export interface ParkadeRig extends BossRig { pk: ParkadeParts }

function group(glow: number): FlashGroup {
  const mat = makeFoeMaterial(false);
  mat.userData.bt.uGlowMul.value = glow;
  return { mat, flash: 0, glowBase: glow };
}
function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name; m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
  addOutline(m, OUTLINE_W);
  return m;
}
function inst(geo: THREE.BufferGeometry, mat: THREE.Material, cap: number, name: string, outline: number, shadow = true): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, cap);
  m.name = name; m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  if (outline > 0) addOutline(m, outline);
  return m;
}
function bld(fn: (f: Facet) => void, jitter = 0.03): THREE.BufferGeometry { const f = new Facet(); f.jitter = jitter; fn(f); return f.build(); }

export const CHAIN_CAP = 128;
export const STEAM_CAP = 24;

/** Build the PARKADE-6 rig (once per page; bossview keeps it). Group names match the §10.2 part table. */
export function buildParkadeRig(glowMul: number): ParkadeRig {
  const root = new THREE.Group(); root.name = 'boss:parkade6';
  const body = new THREE.Group(); body.name = 'p6:body';
  body.position.set(0, PKD.bodyY, 0);
  root.add(body);
  const groups: Record<string, FlashGroup> = {
    body: group(glowMul), booth: group(glowMul), arm: group(glowMul), till: group(glowMul),
    beacon: group(glowMul), legs: group(glowMul),
  };
  // the six leg flash groups are bookkeeping only (their flash is copied into instFlash per instance)
  for (const n of PK_LEGS) groups[n] = group(glowMul);
  const legMat = makeFoeMaterial(true);
  legMat.userData.bt.uGlowMul.value = glowMul;
  groups.legs = { mat: legMat, flash: 0, glowBase: glowMul };
  const fxMat = makeFoeMaterial(false);
  fxMat.userData.bt.uGlowMul.value = glowMul;
  groups.fx = { mat: fxMat, flash: 0, glowBase: glowMul };
  const meshes: THREE.Mesh[] = [];
  const add = <T extends THREE.Mesh>(parent: THREE.Object3D, m: T): T => { parent.add(m); meshes.push(m); return m; };
  const joint = (parent: THREE.Object3D, name: string, x: number, y: number, z: number) => {
    const j = new THREE.Group(); j.name = name; j.position.set(x, y, z); parent.add(j); return j;
  };

  // decks
  const decks: THREE.Group[] = [];
  let tilt: THREE.Group | null = null;
  for (let k = 0; k < 4; k++) {
    const g = joint(body, 'p6:storey' + k, 0, k * S, 0);
    decks.push(g);
    const geo = bld((f) => deckGeo(f, k), 0.025);
    if (k === 3) {
      tilt = joint(g, 'p6:rampHinge', 0, SL, PKD.tiltPivotZ);
      const m = add(tilt, mesh(geo, groups.body.mat, 'p6:deck4'));
      m.position.set(0, -SL, -PKD.tiltPivotZ);
    } else add(g, mesh(geo, groups.body.mat, 'p6:deck' + (k + 1)));
  }
  const ramps = joint(body, 'p6:ramps', 0, 0, 0);
  add(ramps, mesh(bld(rampGeo, 0.02), groups.body.mat, 'p6:rampM'));

  // booth head (pivot at the neck) + beacon, arm, winch, till
  const [bpx, bpy, bpz] = PKD.boothPivot;
  const booth = joint(body, 'p6:booth', bpx, bpy, bpz);
  const boothOff = joint(booth, 'p6:boothOff', -bpx, -bpy, -bpz);
  add(boothOff, mesh(bld(boothGeo, 0.025), groups.booth.mat, 'p6:boothM'));
  const beacon = joint(boothOff, 'p6:beacon', PKD.beacon[0], PKD.beacon[1], PKD.beacon[2]);
  add(beacon, mesh(bld(beaconGeo, 0.02), groups.beacon.mat, 'p6:beaconM', false));
  const armYaw = joint(boothOff, 'p6:armYaw', PKD.armPivot[0], PKD.armPivot[1], PKD.armPivot[2]);
  const armPitch = joint(armYaw, 'p6:armPitch', 0, 0, 0);
  add(armPitch, mesh(bld(armGeo, 0.02), groups.arm.mat, 'p6:armM'));
  const winch = joint(boothOff, 'p6:winch', PKD.winch[0], PKD.winch[1], PKD.winch[2]);
  add(winch, mesh(bld(winchGeo, 0.02), groups.booth.mat, 'p6:winchM'));
  const winchTip = new THREE.Object3D(); winchTip.name = 'p6:winchTip';
  winchTip.position.set(0, PKD.winch[1] - 1.9, PKD.winch[2] + 0.4); boothOff.add(winchTip);
  const railG = new THREE.Group(); railG.name = 'p6:railJ'; boothOff.add(railG);
  const rail = add(railG, mesh(bld(railGeo, 0), groups.till.mat, 'p6:rail'));
  rail.position.set(0, PKD.railY, PKD.railZ0);
  const drawer = joint(boothOff, 'p6:till', PKD.drawerClosed[0], PKD.drawerClosed[1], PKD.drawerClosed[2]);
  add(drawer, mesh(bld(drawerGeo, 0.02), groups.till.mat, 'p6:tillM'));

  // legs: 3 instanced meshes (upper / lower / foot), per-instance flash
  const upG = bld(legUpperGeo), loG = bld(legLowerGeo), ftG = bld(footGeo);
  const legFlash = new THREE.InstancedBufferAttribute(new Float32Array(6), 1);
  legFlash.setUsage(THREE.DynamicDrawUsage);
  for (const g of [upG, loG, ftG]) g.setAttribute('instFlash', legFlash);
  const legUpper = add(root, inst(upG, legMat, 6, 'p6:legUpper', OUTLINE_W));
  const legLower = add(root, inst(loG, legMat, 6, 'p6:legLower', OUTLINE_W));
  const legFoot = add(root, inst(ftG, legMat, 6, 'p6:legFoot', OUTLINE_W));
  const I = new THREE.Matrix4();
  for (let i = 0; i < 6; i++) { legUpper.setMatrixAt(i, I); legLower.setMatrixAt(i, I); legFoot.setMatrixAt(i, I); }

  // parked cars: 24 instances on 4 decks (6 each), GRID-EAST paint per instance
  const carGeo = buildToyCarGeo('#f7f3ea', false);
  const cars = add(body, inst(carGeo, groups.body.mat, 24, 'p6:cars', 2.4));
  const carSlots: CarSlot[] = [];
  const topSlots: number[] = [];
  const col = new THREE.Color();
  const bays = [-17.7, -12.1, -6.5, -0.9, 4.7, 10.3, 15.9];
  let n = 0;
  for (let k = 0; k < 4; k++) {
    // a different pattern of occupied bays per deck (both sides of the aisle)
    for (let j = 0; j < 6; j++) {
      const side = j & 1 ? -1 : 1;
      const bay = bays[(j * 3 + k * 2 + (j >> 1)) % bays.length] + 2.8;
      const z = k === 3 ? [-12, -6.5, -1][j >> 1] : bay;         // roof: the rear (launch) half
      const x = side * 11.6;
      const yaw = side > 0 ? -PI / 2 : PI / 2;            // nose into the bay, tail on the aisle
      const local = new THREE.Matrix4().compose(
        new THREE.Vector3(x + side * ((n * 0.37) % 0.6), SL + 0.02, z),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + ((n * 0.61) % 0.14) - 0.07, 0)),
        new THREE.Vector3(2, 2, 2));
      carSlots.push({ deck: k, local, pop: 1, spin: ((n * 0.713) % 1) * 2 - 1, sx: side, sz: ((n * 0.37) % 1) - 0.5 });
      if (k === 3) topSlots.push(n);
      cars.setColorAt(n, col.set(CAR_PAINT[(n * 5 + k) % CAR_PAINT.length]));
      cars.setMatrixAt(n, I);
      n++;
    }
  }
  if (cars.instanceColor) cars.instanceColor.needsUpdate = true;

  // world-space fx: tow chain links + JAMMED steam (bossview adds them to its world group)
  const chain = inst(bld(linkGeo, 0.02), fxMat, CHAIN_CAP, 'p6:chain', 2.0);
  chain.count = 0; chain.visible = false;
  const steam = inst(bld(puffGeo, 0.04), fxMat, STEAM_CAP, 'p6:steam', 1.6, false);
  steam.count = 0; steam.visible = false;
  meshes.push(chain, steam);

  const pk: ParkadeParts = {
    decks, tilt: tilt!, ramps, booth, beacon, armYaw, armPitch, rail, drawer, winch,
    legUpper, legLower, legFoot, legFlash, cars, carSlots, topSlots, chain, steam, winchTip,
  };
  return {
    id: 'parkade6', root, body, bodyY: PKD.bodyY, legs: [], groups, groupKeys: Object.keys(groups),
    joints: { booth, beacon, armYaw, armPitch, drawer, winch, rail, tilt: tilt!, ramps, winchTip }, meshes,
    stride: PKD.stride, duty: PKD.duty, liftH: PKD.liftH, rMean: PKD.rMean, walkSpeed: PKD.walk, footYawOut: true,
    pk,
  };
}

// ─────────────────────────────── scratch (pose) ───────────────────────────────
const _m0 = new THREE.Matrix4(), _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q0 = new THREE.Quaternion();
const _e0 = new THREE.Euler(0, 0, 0, 'YXZ');
const _p0 = new THREE.Vector3(), _s0 = new THREE.Vector3();
const _hip = new THREE.Vector3(), _knee = new THREE.Vector3(), _foot = new THREE.Vector3(), _pole = new THREE.Vector3();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();

function segMat(A: THREE.Vector3, B: THREE.Vector3, pole: THREE.Vector3, out: THREE.Matrix4): void {
  _y.subVectors(B, A);
  const L = _y.length();
  if (L < 1e-6) _y.set(0, 1, 0); else _y.multiplyScalar(1 / L);
  _z.copy(pole).addScaledVector(_y, -pole.dot(_y));
  if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
  if (_z.lengthSq() < 1e-8) _z.set(1, 0, 0);
  _z.normalize();
  _x.crossVectors(_y, _z);
  out.makeBasis(_x, _y, _z).setPosition(A);
}
function solve2(H: THREE.Vector3, F: THREE.Vector3, pole: THREE.Vector3, K: THREE.Vector3, Fo: THREE.Vector3): void {
  const L1 = PKD.L1, L2 = PKD.L2;
  _a.subVectors(F, H);
  let D = _a.length();
  if (D < 1e-6) { _a.set(0, -1, 0); D = 1e-6; } else _a.multiplyScalar(1 / D);
  const lo = Math.abs(L1 - L2) + 0.05, hi = L1 + L2 - 0.05;
  const Dc = D < lo ? lo : D > hi ? hi : D;
  Fo.copy(H).addScaledVector(_a, Dc);
  const a = (L1 * L1 - L2 * L2 + Dc * Dc) / (2 * Dc);
  const h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  if (_b.lengthSq() < 1e-8) _b.set(0, 1, 0);
  _b.normalize();
  K.copy(H).addScaledVector(_a, a).addScaledVector(_b, h);
}

/** Inputs the pose reads besides the World (bossview fills it; a record, so doubles are not boxed). */
export interface ParkadeFrame { dt: number; alpha: number; frozen: boolean; x: number; z: number; h: number; time: number }

const bumpF = (t: number, a: number, b: number) => (t <= a || t >= b ? 0 : Math.sin(((t - a) / (b - a)) * PI));
const kExp = (dt: number, rate: number) => 1 - Math.exp(-dt * rate);

/**
 * Procedural animation for PARKADE-6 (FEATURES_V2 §10.3). One instance per BossView. Reads the boss state,
 * its live telegraphs (windups) and its launched cars; never writes gameplay state.
 */
export class ParkadePoser {
  // gait
  private gInit = false; private lx = 0.5; private lz = 0.5; private lh = 0.5;
  private vlx = 0.5; private vlz = 0.5; private om = 0.5; private phase = 0.5; private pace = 0.5;
  // smoothed pose
  private dy = 0.5; private pitch = 0.5; private roll = 0.5; private twist = 0.5;
  private sc = new Float64Array(4);
  private tilt = 0.5;
  private bYaw = 0.5; private bPitch = 0.5; private bLift = 0.5;
  private aYaw = 0.5; private aRaise = 0.5;
  private dz = PKD.drawerClosed[2]; private dyD = PKD.drawerClosed[1];
  private tillK = 0.5;
  private beaconA = 0.5; private winchA = 0.5; private winchV = 0.5;
  private legX: THREE.Vector3[] = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3());
  private legT: THREE.Vector3[] = [0, 1, 2, 3, 4, 5].map(() => new THREE.Vector3());
  // one-shots
  deadT = -0.5;
  private roarT = 0.5;
  // per-frame doubles handed to the pose helpers through fields (V8 boxes double call arguments)
  private fdt = 0.5; private ftime = 0.5; private ftA = 0.5;
  private attackKey = '';
  private wuCache = new Map<string, number>();
  private hidden = 0;
  private steamT = 0.5; private steamN = 0;
  private sX = new Float32Array(STEAM_CAP); private sY = new Float32Array(STEAM_CAP); private sZ = new Float32Array(STEAM_CAP);
  private sAge = new Float32Array(STEAM_CAP); private sLife = new Float32Array(STEAM_CAP); private sSize = new Float32Array(STEAM_CAP);
  private steamSeq = 0;
  // targets (per frame)
  private t = { dy: 0.5, pitch: 0.5, roll: 0.5, twist: 0.5, sc0: 0.5, sc1: 0.5, sc2: 0.5, sc3: 0.5, tilt: 0.5, bYaw: 0.5, bPitch: 0.5, bLift: 0.5, aYaw: 0.5, aRaise: 0.5, winch: 0.5, glow: 0.5, beacon: 0.5, beaconSpin: 0.5, dim: 0.5, fast: 0.5 };

  constructor() { this.reset(); }

  reset(): void {
    this.gInit = false; this.vlx = 0; this.vlz = 0; this.om = 0; this.phase = 0; this.pace = 0;
    this.dy = 0; this.pitch = 0; this.roll = 0; this.twist = 0;
    for (let i = 0; i < 4; i++) this.sc[i] = 1;
    this.tilt = 0; this.bYaw = 0; this.bPitch = 0; this.bLift = 0; this.aYaw = 0; this.aRaise = 0;
    this.dz = PKD.drawerClosed[2]; this.dyD = PKD.drawerClosed[1]; this.tillK = 0;
    this.winchV = 0; this.deadT = -1; this.roarT = 0; this.attackKey = ''; this.wuCache.clear(); this.hidden = 0;
    this.steamN = 0; this.steamT = 0;
    for (const v of this.legX) v.set(0, 0, 0);
  }

  /** a bossPhase event arrived (the rig honks: booth lifts, arm salutes, beacon flares) */
  roar(): void { this.roarT = 1.6; }

  /** live windup (s) of this boss's unfired telegraph `tag`, cached for the attack, else `base` */
  private windup(w: World, tag: string, base: number): number {
    for (let i = 0; i < w.telegraphs.length; i++) {
      const tg = w.telegraphs[i];
      if (tg.alive && !tg.fired && tg.owner === 'boss' && tg.tag === tag) { this.wuCache.set(tag, tg.windup); return tg.windup; }
    }
    const c = this.wuCache.get(tag);
    return c !== undefined ? c : base;
  }

  update(w: World, b: BossState, r: ParkadeRig, F: ParkadeFrame): void {
    const dt = F.dt, time = F.time;
    this.fdt = dt; this.ftime = time;
    const pk = r.pk, t = this.t;
    if (b.alive) this.deadT = -1; else this.deadT = this.deadT < 0 ? 0 : this.deadT + dt;
    this.roarT = Math.max(0, this.roarT - dt);

    // ── gait from rendered motion ──
    if (!this.gInit) { this.lx = F.x; this.lz = F.z; this.lh = F.h; this.gInit = true; }
    let mdx = F.x - this.lx, mdz = F.z - this.lz, mdh = wrapAngle(F.h - this.lh);
    if (mdx * mdx + mdz * mdz > 120 * 120) { mdx = 0; mdz = 0; mdh = 0; }
    this.lx = F.x; this.lz = F.z; this.lh = F.h;
    const c = Math.cos(F.h), s = Math.sin(F.h);
    const k6 = Math.min(1, dt * 6);
    this.vlx += ((mdx * c - mdz * s) / dt - this.vlx) * k6;
    this.vlz += ((mdx * s + mdz * c) / dt - this.vlz) * k6;
    this.om += (clamp(mdh / dt, -3, 3) - this.om) * k6;
    this.pace = Math.sqrt(this.vlx * this.vlx + this.vlz * this.vlz) + Math.abs(this.om) * PKD.rMean;
    this.phase += (this.pace * dt) / PKD.stride;
    const mk = this.deadT >= 0 ? 0 : clamp(this.pace / (0.35 * PKD.walk), 0, 1);

    // attack instance key → fresh windup cache
    const tA = b.attack ? b.attackT + (F.frozen ? 0 : F.alpha * (1 / 30)) : 0;
    this.ftA = tA;
    const key = b.attack ?? '';
    if (key !== this.attackKey || (b.attack && tA < 0.05)) { this.attackKey = key; this.wuCache.clear(); }

    // ── targets: idle / walk ──
    const ph = this.phase * PI * 2;
    t.dy = -0.6 * mk * (0.5 + 0.5 * Math.cos(ph * 2)) + Math.sin(time * 0.8) * 0.15;
    t.pitch = Math.sin(ph * 2) * 0.006 * mk; t.roll = Math.sin(ph) * 0.012 * mk; t.twist = 0;
    t.sc0 = 1; t.sc1 = 1; t.sc2 = 1; t.sc3 = 1;
    t.tilt = 0;
    t.bYaw = Math.sin(time * 0.31) * 0.08 * (1 - mk); t.bPitch = Math.sin(time * 0.9) * 0.015; t.bLift = 0;
    t.aYaw = 0; t.aRaise = Math.sin(time * 1.1) * 0.17 * (0.6 + 0.4 * mk);        // ±10° idle bob
    t.winch = 0; t.glow = 1; t.beacon = 1; t.beaconSpin = 3.2; t.dim = 1; t.fast = 0;
    for (let i = 0; i < 6; i++) this.legT[i].set(0, 0, 0);

    const dead = this.deadT >= 0;
    const stag = !dead && b.staggerT > 0;
    if (dead) this.poseDead();
    else if (stag) {
      // JAMMED: decks sag 4°, legs splay, beacon strobes slowly, steam
      const e = smoothstep(0, 0.5, 5 - b.staggerT) * smoothstep(0, 0.6, b.staggerT);
      t.dy = -4.5 * e; t.roll = 0.07 * e + Math.sin(time * 1.3) * 0.012 * e; t.pitch = 0.035 * e;
      t.sc0 = 1 - 0.03 * e; t.sc1 = 1 - 0.03 * e; t.sc2 = 1 - 0.03 * e;
      t.bPitch = 0.16 * e; t.bYaw = Math.sin(time * 0.7) * 0.1 * e; t.aRaise = -0.22 * e;
      t.beacon = (Math.sin(time * 2 * PI * 0.65) > 0 ? 2.4 : 0.15); t.beaconSpin = 0.6;
      for (let i = 0; i < 6; i++) { const fx = FEET[i]; this.legT[i].set(Math.sign(fx[0]) * 4 * e, 0, Math.sign(fx[2]) * 2.5 * e); }
    } else {
      if (b.introT > 0) {
        // reversing in: arm up (barrier open), beacon fast, booth checks over its shoulder
        const rev = (b.data.reversing ?? 0) > 0 ? 1 : 0;
        t.aRaise = 0.55 * rev + t.aRaise * (1 - rev); t.beaconSpin = 7; t.beacon = 1.5;
        t.bYaw = 0.25 * rev * Math.sin(time * 1.5);
      }
      if (this.roarT > 0) {
        const rt = bumpF(1.6 - this.roarT, 0, 1.6);
        t.bLift += 1.4 * rt; t.aRaise += 0.5 * rt; t.beacon += 2 * rt; t.beaconSpin += 6 * rt; t.dy += 1.2 * rt;
        t.roll += Math.sin(time * 14) * 0.012 * rt;
      }
      this.poseAttack(w, b);
    }

    // ── smoothing ──
    const k = kExp(dt, dead ? 3 : 10);
    this.dy += (t.dy - this.dy) * k; this.pitch += (t.pitch - this.pitch) * k; this.roll += (t.roll - this.roll) * k;
    this.twist += (t.twist - this.twist) * k;
    const ks = kExp(dt, t.fast > 0 ? 40 : 12);
    this.sc[0] += (t.sc0 - this.sc[0]) * ks; this.sc[1] += (t.sc1 - this.sc[1]) * ks;
    this.sc[2] += (t.sc2 - this.sc[2]) * ks; this.sc[3] += (t.sc3 - this.sc[3]) * ks;
    this.tilt += (t.tilt - this.tilt) * kExp(dt, 14);
    this.bYaw += (t.bYaw - this.bYaw) * k; this.bPitch += (t.bPitch - this.bPitch) * k; this.bLift += (t.bLift - this.bLift) * k;
    const ka = kExp(dt, t.fast > 1 ? 30 : 9);
    this.aYaw += (t.aYaw - this.aYaw) * ka; this.aRaise += (t.aRaise - this.aRaise) * ka;
    for (let i = 0; i < 6; i++) this.legX[i].lerp(this.legT[i], k);
    this.winchV += (t.winch - this.winchV) * kExp(dt, 6);
    this.winchA = (this.winchA + this.winchV * dt) % (PI * 2);

    // ── apply: body + storeys + ramps ──
    const dimK = clamp(t.dim, 0, 1);
    r.body.position.set(0, PKD.bodyY + this.dy, 0);
    r.body.rotation.set(this.pitch, this.twist, this.roll, 'YXZ');
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const d = pk.decks[i];
      if (!dead) { d.position.set(0, y, 0); d.rotation.set(0, 0, 0); }
      d.scale.set(1, Math.max(0.05, this.sc[i]), 1);
      y += S * Math.max(0.05, this.sc[i]);
    }
    if (dead) this.slideDecks(pk);
    pk.ramps.scale.set(1, clamp(y / (4 * S), 0.1, 1.1), 1);
    if (dead) {
      // the corner ramps topple outward after the decks go
      const kr = easeInCubic(clamp((this.deadT - 1.6) / 1.2, 0, 1));
      pk.ramps.rotation.set(-0.5 * kr, 0, 0); pk.ramps.position.set(0, -10 * kr, -6 * kr);
    } else { pk.ramps.rotation.set(0, 0, 0); pk.ramps.position.set(0, 0, 0); }
    // the booth head rides on the P3/P4 junction of the stack (it follows a squash / pancake)
    const stackDy = S * (this.sc[0] + this.sc[1] + this.sc[2] - 3);
    pk.tilt.rotation.set(this.tilt, 0, 0);

    // booth, arm, beacon, winch
    pk.booth.position.set(PKD.boothPivot[0], PKD.boothPivot[1] + this.bLift + stackDy, PKD.boothPivot[2]);
    pk.booth.rotation.set(this.bPitch, this.bYaw, 0, 'YXZ');
    pk.armYaw.rotation.set(0, this.aYaw, 0);
    pk.armPitch.rotation.set(0, 0, this.aRaise);
    this.beaconA = (this.beaconA + t.beaconSpin * dt) % (PI * 2);
    pk.beacon.rotation.set(0, this.beaconA, 0);
    pk.winch.rotation.set(this.winchA, 0, 0);

    // the TILL, from the till part's live geometry
    this.poseTill(b, r);

    // glow: lamps dim on defeat; beacon sweeps (brighter as a vane passes the camera side)
    const G = r.groups;
    const sweep = 0.75 + 0.35 * Math.abs(Math.sin(this.beaconA));
    G.body.mat.userData.bt.uGlowMul.value = G.body.glowBase * dimK;
    G.booth.mat.userData.bt.uGlowMul.value = G.booth.glowBase * dimK;
    G.arm.mat.userData.bt.uGlowMul.value = G.arm.glowBase * dimK;
    G.legs.mat.userData.bt.uGlowMul.value = G.legs.glowBase * dimK;
    G.beacon.mat.userData.bt.uGlowMul.value = G.beacon.glowBase * Math.max(0, t.beacon) * sweep * dimK;
    G.till.mat.userData.bt.uGlowMul.value = G.till.glowBase * (0.25 + 0.8 * this.tillK + 0.1 * this.tillK * Math.sin(time * 7)) * dimK;

    r.root.updateMatrix();
    r.body.updateMatrix();
    for (let i = 0; i < 4; i++) pk.decks[i].updateMatrix();
    pk.tilt.updateMatrix();
    this.poseLegs(r);
    this.poseCars(w, b, r);
    this.poseSteam(r, stag);
  }

  // ─────────────────────────────── attacks ───────────────────────────────
  private poseAttack(w: World, b: BossState): void {
    const t = this.t, tA = this.ftA, time = this.ftime;
    // RAMP LAUNCH: the sim's deckTilt (0..1 over 0.3 s) → roof deck rear kicks up 12°
    const dT = clamp(b.data.deckTilt ?? 0, 0, 1);
    t.tilt = 0.2094 * easeOutCubic(dT);
    switch (b.attack) {
      case 'rampLaunch': {
        const kick = bumpF(tA, 0, 0.45);
        t.dy -= 1.2 * kick; t.pitch -= 0.03 * kick; t.bPitch -= 0.1 * kick; t.beacon = 1.8; t.beaconSpin = 7;
        break;
      }
      case 'barrierSwing': {
        const W = this.windup(w, 'barrierSwing', 1.5);
        const centre = clamp(wrapAngle((b.data.dir ?? b.heading) - b.heading), -0.6, 0.6);
        // arm-local yaw ψ: the boom points along heading-angle θ = ψ + π/2 (rest θ = 90°, out to the side)
        const start = centre + 0.698 - PI / 2, end = centre - 0.698 - PI / 2;
        const raise = easeOutCubic(clamp(tA / 0.4, 0, 1));
        t.aRaise = 0.436 * raise;                                              // 25° up in 0.4 s
        t.fast = 2;
        const s0 = W - 0.14, s1 = W + 0.14;                                    // sweep synced to the fire
        if (tA < s0) {
          const p = easeOutCubic(clamp((tA - 0.2) / Math.max(0.2, s0 - 0.25), 0, 1));
          t.aYaw = lerp(0, start, p); t.bYaw = 0.12 * p; t.twist = 0.02 * p;
          t.beacon = 1 + 0.8 * p;
        } else if (tA < s1 + 0.35) {
          const q = clamp((tA - s0) / (s1 - s0), 0, 1);
          t.aYaw = lerp(start, end, easeInCubic(q) * 0.3 + q * 0.7); t.aRaise = 0.436 * (1 - 0.8 * q);
          t.bYaw = lerp(0.12, -0.14, q); t.twist = lerp(0.02, -0.03, q); t.beacon = 2;
        } else {
          t.aYaw = end * Math.exp(-(tA - s1 - 0.35) * 5); t.aRaise = 0.09; t.bYaw = -0.05;
        }
        break;
      }
      case 'towChain': {
        const W = this.windup(w, 'towChain', 1.5);
        const hooked = (b.data.tow ?? 0) > 0 && !!w.titan.leash;
        if (tA < W) { t.winch = -9; t.bPitch = -0.08; t.bYaw = 0; t.beacon = 1.4; }
        else if (hooked) { t.winch = 7; t.bPitch = 0.12; t.dy -= 1.2; t.pitch = -0.02; t.beacon = 2.2; t.beaconSpin = 8; }
        else { t.winch = 12 * Math.exp(-(tA - W) * 3); }
        break;
      }
      case 'deckDrop': {
        const W = this.windup(w, 'deckDrop', 1.2);
        if (tA < W) {
          const p = tA / W;
          const crouch = easeOutCubic(clamp(p / 0.7, 0, 1));
          const rise = smoothstep(0.72, 1, p);
          t.dy = -6 * crouch * (1 - rise) + 3.5 * rise; t.pitch = 0.015 * crouch; t.beacon = 1 + 1.5 * p;
          for (let i = 0; i < 6; i++) { const fx = FEET[i]; this.legT[i].set(Math.sign(fx[0]) * 1.8 * crouch, 0, 0); }
        } else {
          const q = tA - W;
          const slam = q < 0.08 ? q / 0.08 : Math.exp(-(q - 0.08) * 4);
          t.dy = -4.5 * slam; t.fast = 1;
          const sq = 1 - 0.06 * slam;                                          // the decks squash 6 %
          t.sc0 = sq; t.sc1 = sq; t.sc2 = sq; t.sc3 = sq;
          t.roll = Math.sin(time * 23) * 0.01 * slam; t.bLift = -1.5 * slam; t.beacon = 1 + slam;
        }
        break;
      }
      case 'levelCollapse': {
        const WA = this.windup(w, 'levelCollapse:A', 1.3);
        const WB = this.windup(w, 'levelCollapse:B', WA + 0.451), WC = this.windup(w, 'levelCollapse:C', WA + 0.902);
        if (tA < WA) {
          const p = easeOutCubic(clamp(tA / WA, 0, 1));
          const st = 1 + 0.07 * p;                                             // the stack stretches up
          t.sc0 = st; t.sc1 = st; t.sc2 = st; t.dy = 1.5 * p; t.beacon = 1 + 1.6 * p; t.beaconSpin = 3 + 6 * p;
          t.roll = Math.sin(time * 19) * 0.006 * p;
        } else {
          const q = tA - WA;
          // pancake top to bottom, 0.15 s apart (storey 2 = P3 → P4 drops first), then restack after C
          const restack = smoothstep(WC - WA + 0.25, WC - WA + 1.05, q);
          const pc = (d: number) => 1 - 0.55 * smoothstep(d, d + 0.08, q) * (1 - restack);
          t.sc2 = pc(0); t.sc1 = pc(0.15); t.sc0 = pc(0.3);
          t.fast = 1;
          const beat = Math.max(bumpF(q, 0, 0.3), bumpF(q, WB - WA, WB - WA + 0.3), bumpF(q, WC - WA, WC - WA + 0.3));
          t.dy = -2.5 * beat; t.bLift = -2 * beat; t.beacon = 1 + 1.5 * beat;
          t.roll = Math.sin(time * 21) * 0.012 * beat;
        }
        break;
      }
    }
  }

  private poseDead(): void {
    const t = this.t, d = this.deadT, time = this.ftime;
    // legs buckle in sequence (0.22 s apart), the body drops and lists
    let buckled = 0;
    for (let i = 0; i < 6; i++) {
      const k = easeInCubic(clamp((d - i * 0.22) / 0.6, 0, 1));
      buckled += k;
      const fx = FEET[i];
      this.legT[i].set(Math.sign(fx[0]) * 9 * k, 0, Math.sign(fx[2]) * 5 * k);
    }
    const kb = buckled / 6;
    t.dy = -15 * kb; t.roll = 0.09 * kb; t.pitch = 0.05 * kb;
    t.bPitch = 0.4 * kb; t.aRaise = -0.5 * kb; t.beaconSpin = 0.4;
    t.dim = d < 1.4 ? (0.5 + 0.5 * Math.sin(time * 37) * Math.sin(time * 11.3)) * (1 - d / 1.4) : 0;
    t.beacon = t.dim * 2;
  }

  /** defeat: after the legs give, the decks slide off like dominoes (top first), rotating as they go */
  private slideDecks(pk: ParkadeParts): void {
    const d = this.deadT;
    let y = 0;
    for (let i = 0; i < 4; i++) {
      const g = pk.decks[i];
      const k = easeInCubic(clamp((d - 1.3 - (3 - i) * 0.3) / 1.1, 0, 1));
      const side = i & 1 ? -1 : 1;
      g.position.set(side * 9 * k * (0.6 + i * 0.25), y - k * i * S * 0.55, 6 * k * (i - 1.5) * 0.4);
      g.rotation.set(0.08 * k * side, 0, -side * 0.35 * k);
      y += S * Math.max(0.05, this.sc[i]);
    }
  }

  private poseTill(b: BossState, r: ParkadeRig): void {
    const pk = r.pk, dt = this.fdt, time = this.ftime;
    let open = (b.data.tillOpen ?? 0) > 0 || b.staggerT > 0;
    let oz = 43, oy = 35;
    for (let i = 0; i < b.parts.length; i++) {
      const p = b.parts[i];
      if (p.name === 'till') { if (p.strainMul > 0) { oz = p.oz; oy = (p.y0 + p.y1) / 2; } break; }
    }
    if (!b.alive) open = false;
    const zC = PKD.drawerClosed[2], yC = PKD.drawerClosed[1];
    const zO = oz, yO = oy - PKD.bodyY;
    // rail telescopes out in ~0.3 s, then the drawer drops; closing reverses the order
    const kz = kExp(dt, 16), ky = kExp(dt, 12);
    const outFrac = clamp((this.dz - zC) / Math.max(1, zO - zC), 0, 1);
    if (open) {
      this.dz += (zO - this.dz) * kz;
      const yt = outFrac > 0.8 ? yO : yC;
      this.dyD += (yt - this.dyD) * ky;
    } else {
      this.dyD += (yC - this.dyD) * kExp(dt, 16);
      if (Math.abs(this.dyD - yC) < 1.2) this.dz += (zC - this.dz) * kExp(dt, 10);
    }
    const drop = clamp((yC - this.dyD) / Math.max(1, yC - yO), 0, 1);
    this.tillK += ((open ? 0.35 + 0.65 * drop : 0) - this.tillK) * kExp(dt, 8);
    const shake = open ? Math.sin(time * 31) * 0.05 * drop : 0;
    pk.drawer.position.set(shake, this.dyD, this.dz);
    const railLen = Math.max(1, this.dz + 4.4 - PKD.railZ0);
    pk.rail.scale.set(1, 1, railLen);
  }

  // ─────────────────────────────── legs ───────────────────────────────
  private poseLegs(r: ParkadeRig): void {
    const pk = r.pk, G = r.groups;
    const moveK = this.deadT >= 0 ? 0 : clamp(this.pace / (0.35 * PKD.walk), 0, 1);
    const pace = Math.max(1e-3, this.pace);
    const half = PKD.stride * PKD.duty * 0.5;
    const flash = pk.legFlash.array as Float32Array;
    for (let i = 0; i < 6; i++) {
      const h = HIPS[i], ft = FEET[i];
      _hip.set(h[0], h[1], h[2]).applyMatrix4(r.body.matrix);
      // gait foot offset (tripod), slide direction = −(body velocity at the foot)
      const u0 = this.phase + GAIT_OFF[i];
      const u = u0 - Math.floor(u0);
      const fvx = this.vlx + this.om * ft[2], fvz = this.vlz - this.om * ft[0];
      const dxn = fvx / pace, dzn = fvz / pace;
      let a: number, lift = 0;
      if (u < PKD.duty) a = half * (1 - 2 * u / PKD.duty);
      else { const wv = (u - PKD.duty) / (1 - PKD.duty); a = half * (-1 + 2 * wv); lift = Math.sin(PI * wv); }
      const fl = G[PK_LEGS[i]].mat.userData.bt.uFlash.value;
      flash[i] = fl;
      _foot.set(ft[0] + dxn * a * moveK, ft[1] + lift * PKD.liftH * moveK + fl * 1.8, ft[2] + dzn * a * moveK).add(this.legX[i]);
      // knee rides outward + up over the pad (a stilt, never a biped knee)
      let px = _foot.x - _hip.x, pz = _foot.z - _hip.z;
      let pl = px * px + pz * pz;
      if (pl < 1e-6) { px = ft[0]; pz = ft[2]; pl = px * px + pz * pz; }
      pl = 1 / Math.sqrt(pl);
      _pole.set(px * pl, 1.1, pz * pl).normalize();
      solve2(_hip, _foot, _pole, _knee, _foot);
      segMat(_hip, _knee, _pole, _m0); pk.legUpper.setMatrixAt(i, _m0);
      segMat(_knee, _foot, _pole, _m0); pk.legLower.setMatrixAt(i, _m0);
      _q0.setFromEuler(_e0.set(lift * moveK * 0.2, Math.atan2(ft[0], ft[2]), 0, 'YXZ'));
      _m0.compose(_foot, _q0, _s0.set(1, 1, 1)); pk.legFoot.setMatrixAt(i, _m0);
    }
    pk.legUpper.instanceMatrix.needsUpdate = true;
    pk.legLower.instanceMatrix.needsUpdate = true;
    pk.legFoot.instanceMatrix.needsUpdate = true;
    pk.legFlash.needsUpdate = true;
  }

  // ─────────────────────────────── cars ───────────────────────────────
  private poseCars(w: World, b: BossState, r: ParkadeRig): void {
    const pk = r.pk, dt = this.fdt;
    // launched cars: live boss carLob shots of this RAMP LAUNCH hide that many roof-deck cars
    let flying = 0;
    if (b.attack === 'rampLaunch') for (let i = 0; i < w.projectiles.length; i++) {
      const p = w.projectiles[i];
      if (p.alive && p.owner === 'boss' && p.kind === 'carLob') flying++;
    }
    const tiltUp = this.tilt > 0.02;
    if (b.attack === 'rampLaunch') this.hidden = Math.max(this.hidden, Math.min(pk.topSlots.length, flying));
    else if (!tiltUp) this.hidden = 0;
    const d = this.deadT;
    for (let n = 0; n < pk.carSlots.length; n++) {
      const cs = pk.carSlots[n];
      const top = cs.deck === 3;
      const ti = top ? pk.topSlots.indexOf(n) : -1;
      const gone = top && ti >= 0 && ti < this.hidden;
      if (gone) cs.pop = 0; else cs.pop = Math.min(1, cs.pop + dt / 0.35);
      const deck = pk.decks[cs.deck];
      if (top) _m1.multiplyMatrices(deck.matrix, pk.tilt.matrix).multiply(_m2.makeTranslation(0, -SL, -PKD.tiltPivotZ));
      else _m1.copy(deck.matrix);
      if (d >= 0) {
        // spill: slide off the deck edge and tumble down as the decks go
        const k = clamp((d - 1.1 - (3 - cs.deck) * 0.3) / 1.4, 0, 1);
        const kk = k * k;
        _p0.set(cs.sx * 16 * k, -kk * (6 + cs.deck * 7), cs.sz * 8 * k);
        _q0.setFromEuler(_e0.set(cs.spin * 2.2 * k, cs.spin * 1.3 * k, cs.sx * 1.6 * kk, 'YXZ'));
        _m2.compose(_p0, _q0, _s0.set(1, 1, 1));
        _m1.multiply(_m2);
      }
      _m1.multiply(cs.local);
      if (cs.pop < 1) {
        const sc = cs.pop <= 0 ? 0 : clamp(easeOutBack(cs.pop), 0, 1.15);
        _m1.multiply(_m2.makeScale(sc, sc, sc));
      }
      pk.cars.setMatrixAt(n, _m1);
    }
    pk.cars.instanceMatrix.needsUpdate = true;
  }

  // ─────────────────────────────── steam (JAMMED) ───────────────────────────────
  private poseSteam(r: ParkadeRig, on: boolean): void {
    const pk = r.pk, st = pk.steam, dt = this.fdt;
    if (on) {
      this.steamT -= dt;
      while (this.steamT <= 0 && this.steamN < STEAM_CAP) {
        this.steamT += 0.09;
        const i = this.steamN++;
        const seq = this.steamSeq++;
        const h = HIPS[seq % 6];
        _p0.set(h[0] + Math.sign(h[0]) * 2.4, h[1] + 0.5, h[2]).applyMatrix4(r.body.matrix).applyMatrix4(r.root.matrix);
        const j = Math.sin(seq * 12.9898) * 43758.5453, rr = j - Math.floor(j);
        this.sX[i] = _p0.x + (rr - 0.5) * 2; this.sY[i] = _p0.y; this.sZ[i] = _p0.z + (rr - 0.5) * 2;
        this.sAge[i] = 0; this.sLife[i] = 1.0 + rr * 0.6; this.sSize[i] = 2.6 + rr * 1.8;
      }
    }
    let n = 0;
    for (let i = 0; i < this.steamN; i++) {
      const age = this.sAge[i] + dt;
      if (age >= this.sLife[i]) continue;
      if (n !== i) {
        this.sX[n] = this.sX[i]; this.sY[n] = this.sY[i]; this.sZ[n] = this.sZ[i];
        this.sLife[n] = this.sLife[i]; this.sSize[n] = this.sSize[i];
      }
      this.sAge[n] = age;
      this.sY[n] += dt * 7;
      const u = age / this.sLife[n];
      const sc = this.sSize[n] * (u < 0.2 ? 0.4 + 3 * u : 1 - Math.pow((u - 0.2) / 0.8, 1.7)) * (1 + u);
      _q0.setFromEuler(_e0.set(u * 2 + i, u * 3, 0, 'YXZ'));
      _m0.compose(_p0.set(this.sX[n], this.sY[n], this.sZ[n]), _q0, _s0.set(sc, sc * 0.85, sc));
      st.setMatrixAt(n, _m0);
      n++;
    }
    this.steamN = n;
    st.count = n;
    st.visible = n > 0;
    if (n > 0) st.instanceMatrix.needsUpdate = true;
  }
}
