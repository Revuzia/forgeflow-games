// BLOCKTOOTH v2 — PARKADE-6, the HALVARD MOBILE PARKING STRUCTURE (FEATURES_V2 §10.3). VIEW model.
//
// ── L0 SKELETON STUB (PLACEHOLDER RIG) ── a faceted deck slab, a toll-booth block and 6 static box
// legs, built with the same Facet kit + foe material + 3 px ink hull as the other bosses, root named
// 'boss:parkade6', NO posing (bossview.ts's poseParkade is a no-op). It exists only so a parkade6 boss
// never renders as the wrong rig or crashes between lane L3's biome flip and lane L7's real model.
// Lane L7 replaces this whole file (decks, ramps, cars, booth, barrier arm, beacon, TILL drawer).

import * as THREE from 'three';
import { addOutline } from '../render/materials.ts';
import { FOE_PAL, Facet, M, makeFoeMaterial } from './foemodels.ts';
import type { BossRig, FlashGroup } from './bossview.ts';

export type ParkadeRig = BossRig;

const P = FOE_PAL;
const OUTLINE_W = 3.0;

function group(glow: number): FlashGroup {
  const mat = makeFoeMaterial(false);
  mat.userData.bt.uGlowMul.value = glow;
  return { mat, flash: 0, glowBase: glow };
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  m.frustumCulled = false;
  addOutline(m, OUTLINE_W);
  return m;
}

/** Placeholder rig (see header). Leg / booth / arm group names match the §10.2 part table so bossHit
 *  flashes land on the right block. */
export function buildParkadeRig(glowMul: number): BossRig {
  const root = new THREE.Group(); root.name = 'boss:parkade6';
  const body = new THREE.Group(); body.name = 'p6:body';
  const bodyY = 30;
  body.position.set(0, bodyY, 0);
  root.add(body);
  const names = ['legFL', 'legFR', 'legML', 'legMR', 'legBL', 'legBR'];
  const groups: Record<string, FlashGroup> = { body: group(glowMul), booth: group(glowMul), arm: group(glowMul), till: group(glowMul) };
  for (const n of names) groups[n] = group(glowMul);
  const meshes: THREE.Mesh[] = [];
  const bld = (fn: (f: Facet) => void) => { const f = new Facet(); f.jitter = 0.02; fn(f); return f.build(); };

  // four stacked decks (one merged slab stack), toll booth up front
  const deck = mesh(bld((f) => {
    for (let i = 0; i < 4; i++) f.box(40, 2.4, 44, i % 2 ? P.off : P.steelD, M(0, i * 7, 0), { ch: 0.6 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(3, 24, 3, P.navy, M(sx * 18, 10, sz * 20), { ch: 0.3 });
  }), groups.body.mat, 'p6:decks');
  body.add(deck); meshes.push(deck);
  const booth = mesh(bld((f) => {
    f.box(10, 12, 8, P.org, M(0, 0, 0), { ch: 0.5, top: P.navyD });
  }), groups.booth.mat, 'p6:booth');
  booth.position.set(0, 14, 32);
  body.add(booth); meshes.push(booth);

  const legGeo = bld((f) => f.box(4, 30, 4, P.navyD, M(0, 15, 0), { ch: 0.4 }));
  const at: [number, number][] = [[20, 24], [-20, 24], [22, 0], [-22, 0], [20, -24], [-20, -24]];
  for (let i = 0; i < 6; i++) {
    const m = mesh(legGeo, groups[names[i]].mat, `p6:${names[i]}`);
    m.position.set(at[i][0], 0, at[i][1]);
    root.add(m); meshes.push(m);
  }
  return {
    id: 'parkade6', root, body, bodyY, legs: [], groups, groupKeys: Object.keys(groups), joints: { booth }, meshes,
    stride: 14, duty: 0.7, liftH: 5, rMean: 30, walkSpeed: 5, footYawOut: false,
  };
}
