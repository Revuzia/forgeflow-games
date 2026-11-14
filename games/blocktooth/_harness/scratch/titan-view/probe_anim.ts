// titan-view lane scratch probe (node, type-stripped): TitanAnimator + TitanView behaviour.
//  1. every pose family for every titan → no NaN in any bone matrix, root untouched
//  2. foot planting: during a steady walk, a stance foot's MODEL-space position must not slide
//     more than a few % of body height along Z (phase-locked gait), and never sink below rest
//  3. per-frame cost of anim.update (all 4 titans)
//  4. TitanView mounted on a REAL World (createWorld + stepWorld), fed the tick events → root
//     follows the sim pose, scale = titan.height, glow driven, unmount disposes
import * as THREE from 'three';
import { buildTitanModel } from '../../../src/titans/models.ts';
import { TitanAnimator } from '../../../src/titans/anim.ts';
import type { AnimState } from '../../../src/titans/anim.ts';
import { TitanView } from '../../../src/titans/titanview.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { screenToWorld } from '../../../src/core/config.ts';
import type { SimEvent, TitanId } from '../../../src/core/types.ts';

const ids: TitanId[] = ['molo', 'voltkite', 'hearthback', 'briarwick'];
const ATTACK: Record<TitanId, string> = { molo: 'curbBite', voltkite: 'forkArc', hearthback: 'magmaStomp', briarwick: 'vineLash' };
let fails = 0;
const fail = (m: string) => { fails++; console.log('FAIL', m); };
const st = (): AnimState => ({ speed01: 0, moving: false, turn: 0, attack: null, attackT: -1, dashT: -1, hurtT: -1, abilityT: -1, growT: -1, t: 0, kit: { stored: 50, cap: 100, stompT: 0.6, vacuumT: 0, sowT: 0, wires: 2, turrets: 1 }, speedH: 0, deadT: -1 });

const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
function finite(mo: ReturnType<typeof buildTitanModel>): boolean {
  mo.root.updateMatrixWorld(true);
  for (const k in mo.joints) { const e = mo.joints[k].matrixWorld.elements; for (let i = 0; i < 16; i++) if (!Number.isFinite(e[i])) return false; }
  return true;
}

for (const id of ids) {
  const mo = buildTitanModel(id);
  const an = new TitanAnimator(mo, id);
  const s = st();
  const dt = 1 / 60;
  // 1. pose families
  const families: [string, (s: AnimState, t: number) => void][] = [
    ['idle', () => {}],
    ['walk', (s) => { s.moving = true; s.speed01 = 0.8; s.speedH = 2.5; }],
    ['run', (s) => { s.moving = true; s.speed01 = 1.2; s.speedH = 6; }],
    ['turn', (s) => { s.moving = true; s.speed01 = 0.6; s.speedH = 1.5; s.turn = 9; }],
    ['attack', (s, t) => { s.attack = ATTACK[id]; s.attackT = t % 1.2; }],
    ['unknownAttack', (s, t) => { s.attack = 'zzz'; s.attackT = t % 1; }],
    ['dash', (s, t) => { s.moving = true; s.speedH = 10; s.dashT = t % 0.6; }],
    ['hurt', (s, t) => { s.hurtT = t % 0.5; s.hurtAmt = 1; }],
    ['ability', (s, t) => { s.abilityT = t % 1.5; s.kit.vacuumT = t % 1.5 < 1.2 ? 1 : 0; s.kit.sowT = 1; }],
    ['grow', (s, t) => { s.growT = t % 1.5; }],
    ['hero', (s) => { s.hero = 1; }],
    ['dead', (s, t) => { s.deadT = t; }],
    ['garbage', (s) => { s.speedH = NaN as number; s.turn = Infinity; s.speed01 = -3; }],
  ];
  for (const [name, set] of families) {
    const ss = st();
    let bad = false;
    for (let i = 0; i < 180; i++) { ss.t = i * dt; set(ss, i * dt); an.update(ss, i === 7 ? NaN : dt); if (!finite(mo)) { bad = true; break; } }
    if (bad) fail(`${id} ${name}: non-finite bone matrix`);
    if (mo.root.position.lengthSq() !== 0 || mo.root.rotation.y !== 0) fail(`${id} ${name}: animator touched the root`);
  }
  // 2. foot planting during a steady walk (speedH 1.5 H/s, below every cadence cap)
  s.moving = true; s.speed01 = 0.6; s.speedH = 1.5; s.hurtT = -1; s.attack = null;
  for (let i = 0; i < 240; i++) { s.t = i * dt; an.update(s, dt); }
  const legs = mo.legs.map((L) => mo.joints[L.foot]);
  const restY = mo.legs.map((L) => mo.rest[L.foot].y);
  const inv = new THREE.Matrix4();
  const prev = legs.map(() => new THREE.Vector3(NaN, NaN, NaN));
  const prevGround = legs.map(() => false);
  let worstSlip = 0, worstSink = 0, samples = 0;
  for (let i = 0; i < 240; i++) {
    s.t += dt;
    an.update(s, dt);
    mo.root.updateMatrixWorld(true);
    inv.copy(mo.root.matrixWorld).invert();
    // the body moves forward at speedH (model units/s); a planted foot moves backward at the same rate in model space
    legs.forEach((b, k) => {
      v.setFromMatrixPosition(b.matrixWorld).applyMatrix4(inv);
      const onGround = v.y - restY[k] < 0.0005;
      if (onGround && prevGround[k] && Number.isFinite(prev[k].z)) {
        const dz = v.z - prev[k].z;              // expected −speedH·dt
        worstSlip = Math.max(worstSlip, Math.abs(dz + s.speedH! * dt) / dt);
        samples++;
      }
      worstSink = Math.max(worstSink, restY[k] - v.y);
      prev[k].copy(v);
      prevGround[k] = onGround;
    });
  }
  // slip in H/s relative to the walk speed: < 15 % of the ground speed = planted
  const slipFrac = worstSlip / s.speedH!;
  if (slipFrac > 0.15) fail(`${id} foot slip ${(slipFrac * 100).toFixed(1)}% of ground speed`);
  if (worstSink > 0.01) fail(`${id} foot sinks ${worstSink.toFixed(3)} below rest`);
  // 3. cost
  const t0 = performance.now();
  for (let i = 0; i < 2000; i++) { s.t += dt; s.attack = i % 90 < 30 ? ATTACK[id] : null; s.attackT = (i % 90) * dt; an.update(s, dt); }
  const us = ((performance.now() - t0) / 2000) * 1000;
  console.log(`${id.padEnd(10)} poses OK · stance slip ${(slipFrac * 100).toFixed(1)}% of speed (${samples} samples) · sink ${worstSink.toFixed(4)} · update ${us.toFixed(1)} µs`);
  mo.dispose();
}

// 4. TitanView on a real World
for (const id of ids) {
  const w = createWorld({ titan: id, biome: 'grideast', seed: 11 });
  const scene = new THREE.Scene();
  const view = new TitanView({ renderer: null as unknown as THREE.WebGLRenderer, scene, camera: new THREE.PerspectiveCamera(), quality: { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true } });
  view.mount(w);
  const root = view.object!;
  if (root.parent !== scene) fail(`${id}: root not in scene after mount`);
  const mv = screenToWorld(0.6, 1);
  const seen: Record<string, number> = {};
  let glowMax = 0;
  for (let i = 0; i < 150; i++) {
    const evs: SimEvent[] = [];
    stepWorld(w, { mx: mv.mx, mz: mv.mz, ability: i === 20 || i === 100, abilityHeld: i >= 20 && i < 50, dash: i === 60 });
    for (const e of w.events) { evs.push(e); seen[e.type] = (seen[e.type] ?? 0) + 1; }
    for (const alpha of [0.5, 1]) {
      view.update(w, { alpha, dt: 1 / 60, time: i / 30 + alpha / 30, events: alpha === 0.5 ? evs : [], camDist: 17, frozen: false });
      const T = w.titan;
      const ex = T.px + (T.x - T.px) * alpha, ez = T.pz + (T.z - T.pz) * alpha;
      if (Math.abs(root.position.x - ex) > 1e-6 || Math.abs(root.position.z - ez) > 1e-6) { fail(`${id}: root not at the interpolated sim pose`); break; }
      if (alpha === 1 && Math.abs(root.scale.x - T.height) > 1e-6) fail(`${id}: root scale ${root.scale.x} != height ${T.height}`);
    }
  }
  // glow brightness actually driven (read the glow material colours)
  const mats = (root.children as THREE.Mesh[]).map((c) => c.material as THREE.MeshBasicMaterial).filter((m) => m && m.name.startsWith('titanGlow'));
  for (const m of mats) glowMax = Math.max(glowMax, m.color.r, m.color.g, m.color.b);
  // frozen: stays idle, no throw
  view.update(w, { alpha: 1, dt: 1 / 60, time: 99, events: [], camDist: 17, frozen: true });
  // kill → death pose path
  w.titan.alive = false;
  for (let i = 0; i < 30; i++) view.update(w, { alpha: 1, dt: 1 / 60, time: 100 + i / 60, events: [], camDist: 17, frozen: false });
  view.unmount();
  if (root.parent) fail(`${id}: root still parented after unmount`);
  // remount after unmount (retry)
  const w2 = createWorld({ titan: id, biome: 'lockwater', seed: 3 });
  view.mount(w2);
  if (!view.object || view.object.parent !== scene) fail(`${id}: remount failed`);
  view.unmount();
  console.log(`${id.padEnd(10)} TitanView OK · moved ${Math.hypot(w.titan.x - w.city.spawn.x, w.titan.z - w.city.spawn.z).toFixed(1)} m · glow mats ${mats.length} max ${glowMax.toFixed(2)} · events ${Object.keys(seen).filter((k) => ['titanAttack', 'dash', 'ability', 'footstep'].includes(k)).map((k) => k + ':' + seen[k]).join(' ')}`);
}
console.log(fails ? `FAIL ${fails}` : 'ALL OK');
process.exit(fails ? 1 : 0);
