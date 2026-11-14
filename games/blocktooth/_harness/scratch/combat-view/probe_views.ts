// combat-view lane node probe: drives TelegraphView / ProjectileView / HazardView against a REAL
// World (createWorld + stepWorld, HEARTHBACK so titan-owned stomp telegraphs appear) plus injected
// records of every style / kind, WITHOUT a GL context (three's scene graph runs in node).
// Checks: id-keyed bookkeeping, flash / fade lifecycles, batch growth past initial capacity, chain
// link instancing, bloom fire detection, instance buffers free of NaN, mount/unmount symmetry.
//   node _harness/scratch/combat-view/probe_views.ts
import * as THREE from 'three';
import type { Hazard, HazardKind, Projectile, ProjectileKind, SimEvent, Telegraph, TelegraphStyle, World } from '../../../src/core/types.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import type { FrameInfo, ViewCtx } from '../../../src/render/viewtypes.ts';
import { TelegraphView } from '../../../src/render/telegraphview.ts';
import { ProjectileView } from '../../../src/render/projectileview.ts';
import { HazardView } from '../../../src/render/hazardview.ts';

let fails = 0;
function check(ok: boolean, msg: string): void {
  if (!ok) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg);
}

const ctx: ViewCtx = {
  renderer: { domElement: { clientHeight: 720 } } as unknown as THREE.WebGLRenderer,
  scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(30, 16 / 9, 0.1, 5000),
  quality: { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true },
};
const tv = new TelegraphView(ctx);
const pv = new ProjectileView(ctx);
const hv = new HazardView(ctx);
// deliberately loose access to internals for assertions
type Any = Record<string, any>;
const T = tv as unknown as Any, P = pv as unknown as Any, Hz = hv as unknown as Any;

function nanFree(arr: ArrayLike<number>, n: number): boolean {
  for (let i = 0; i < n; i++) if (!Number.isFinite(arr[i])) return false;
  return true;
}
function buffersOk(): boolean {
  for (const b of (T.batches as Map<string, Any>).values()) if (!nanFree(b.f, b.n * 24)) return false;
  for (const k of (P.kinds as Map<string, Any>).values()) if (!nanFree(k.mesh.instanceMatrix.array, k.n * 16)) return false;
  for (const qb of [P.streaks, P.halos, P.shadows, Hz.ribbons, Hz.dots]) if (!nanFree(qb.f, qb.n * qb.names.length * 4)) return false;
  for (const b of (Hz.decals as Map<string, Any>).values()) if (!nanFree(b.f, b.n * 20)) return false;
  for (const m of Hz.ims() as Any[]) if (!nanFree(m.mesh.instanceMatrix.array, m.n * 16)) return false;
  return true;
}

let time = 0;
function frame(w: World, events: readonly SimEvent[], camDist = 62): void {
  time += 1 / 60;
  const f: FrameInfo = { alpha: 0.5, dt: 1 / 60, time, events, camDist, frozen: false };
  tv.update(w, f); pv.update(w, f); hv.update(w, f);
}

// ───────────── 1. real sim: HEARTHBACK stomps (titan-owned telegraphs) + whatever spawns ─────────────
const w = createWorld({ titan: 'hearthback', biome: 'grideast', seed: 11 });
for (const v of [hv, tv, pv]) v.mount(w);
check(ctx.scene.children.length === 3, 'mount adds exactly one root per view (' + ctx.scene.children.length + ')');
let maxTg = 0, sawWarm = false, sawFlash = false, sawTgFire = 0, maxProj = 0;
for (let i = 0; i < 1800; i++) {
  stepWorld(w, i % 90 < 60 ? { ...NO_INPUT, mx: 0.7, mz: 0.3 } : NO_INPUT);
  for (const e of w.events) if (e.type === 'telegraphFire') sawTgFire++;
  frame(w, w.events.slice());
  maxTg = Math.max(maxTg, tv.drawn);
  const recs = T.recs as Map<number, Any>;
  for (const r of recs.values()) { if (r.owner === 'titan') sawWarm = true; if (r.firedAt >= 0) sawFlash = true; }
  let alive = 0; for (const p of w.projectiles) if (p.alive) alive++;
  maxProj = Math.max(maxProj, alive);
  if (!buffersOk()) { check(false, 'NaN in an instance buffer at tick ' + i); break; }
}
check(sawTgFire > 0, `real sim fired telegraphs (${sawTgFire} telegraphFire events, ${w.enemies.length} enemies, t=${w.t.toFixed(1)}s)`);
check(maxTg > 0, `telegraph decals drawn from the real sim (max ${maxTg} per frame)`);
check(sawWarm, 'titan-owned (warm variant) telegraph records seen');
check(sawFlash, 'fired telegraphs enter the flash state');
check(buffersOk(), 'instance buffers NaN-free after 1800 real ticks');
console.log('     real-sim projectiles max alive:', maxProj, 'counts now:', JSON.stringify(pv.counts()), 'hazards:', JSON.stringify(hv.counts()));

// ───────────── 2. injected: every style / kind, lifecycle + growth ─────────────
let id = 900000;
function tg(style: TelegraphStyle, shape: Telegraph['shape'], owner: Telegraph['owner'] = 'enemy', chain: number[] | null = null, active = 0): Telegraph {
  return { id: id++, alive: true, owner, style, shape, windup: 1, t: 0, active, dmg: 1, kind: 'generic', fired: false, hitTitan: false, onFire: null, chain, tag: 'probe' };
}
const w2 = createWorld({ titan: 'briarwick', biome: 'lockwater', seed: 3 });
for (const v of [hv, tv, pv]) v.unmount();
check(ctx.scene.children.length === 0, 'unmount removes every root');
for (const v of [hv, tv, pv]) v.mount(w2);
check((T.recs as Map<number, Any>).size === 0, 'remount starts with no stale telegraph records');
const x = w2.city.spawn.x, z = w2.city.spawn.z;
const tgs: Telegraph[] = [
  tg('cone', { k: 'cone', x, z, dir: 0.3, half: 0.5, r: 40 }),
  tg('oval', { k: 'oval', x, z, rx: 20, rz: 12, rot: 1 }),
  tg('lane', { k: 'lane', x, z, dir: 2, len: 60, w: 8 }),
  tg('ring', { k: 'ring', x, z, r0: 10, r1: 30 }),
  tg('circle', { k: 'circle', x, z, r: 6 }, 'titan'),
  tg('chain', { k: 'capsule', x0: x, z0: z, x1: x + 30, z1: z, r: 2 }, 'enemy', [x, z, x + 10, z + 5, x + 20, z - 5, x + 30, z, x + 40, z + 4]),
  tg('cone', { k: 'cone', x, z, dir: 1, half: 0.4, r: 90 }, 'boss', null, 1.0),
];
for (let i = 0; i < 150; i++) tgs.push(tg('circle', { k: 'circle', x: x + i, z, r: 3 }));
w2.telegraphs = tgs;
const styles: HazardKind[] = ['wire', 'magma', 'bloom', 'spore', 'frost', 'fire', 'oil'];
const hz: Hazard[] = styles.map((k, i) => ({ id: id++, alive: true, owner: k === 'frost' ? 'boss' : 'titan', kind: k,
  shape: k === 'wire' ? { k: 'capsule', x0: x, z0: z, x1: x + 12, z1: z + 3, r: 1.2 } : { k: 'circle', x: x + i * 5, z, r: 4 },
  t: 0.5, life: 6, dps: 0, tickT: 0, data: k === 'bloom' ? { cd: 0.4, spore: 4, h: 14 } : {} } as Hazard));
w2.hazards = hz;
const kinds: ProjectileKind[] = ['pellet', 'volley', 'rocket', 'shell', 'mortar', 'plate', 'hookDrop', 'seed', 'rubbleShot', 'spark'];
const pr: Projectile[] = [];
for (const k of kinds) for (let j = 0; j < 3; j++) {
  pr.push({ id: id++, alive: true, owner: 'enemy', kind: k, x: x + j, z, y: 3, px: x + j - 0.5, pz: z, py: 3.2, vx: 15, vz: 0, vy: -1,
    r: 0.5, dmg: 1, life: 2, pierce: 0, crit: false, lob: k === 'mortar', tx: x, tz: z, aoe: 3, tg: -1 });
}
w2.projectiles = pr;

for (let i = 0; i < 10; i++) {
  for (const t of tgs) if (t.alive) t.t = Math.min(t.windup, t.t + 0.05);
  for (const p of pr) { p.px = p.x; p.pz = p.z; p.py = p.y; p.x += 0.4; }
  frame(w2, [], 314);
}
const batches = T.batches as Map<string, Any>;
check(batches.get('circle')!.n === 151, `circle batch grew past its initial 64 (${batches.get('circle')!.n} instances)`);
check(batches.get('chain')!.n === 4, `chain polyline of 5 points → 4 link instances (${batches.get('chain')!.n})`);
for (const st of ['cone', 'oval', 'lane', 'ring'] as const) check(batches.get(st)!.n >= 1, `style ${st} drawn (${batches.get(st)!.n})`);
const pc = pv.counts();
check(kinds.every((k) => pc[k] === 3), 'every projectile kind instanced ×3: ' + JSON.stringify(pc));
const hc = hv.counts();
check(styles.every((k) => hc[k] === 1), 'every hazard kind has its decal: ' + JSON.stringify(hc));
check(hc.bolts > 0 && hc.crystals > 0 && hc.petals === 5, `wire bolts ${hc.bolts}, frost crystals ${hc.crystals}, bloom petals ${hc.petals}`);
check(P.puffN > 0, `rocket/mortar smoke puffs emitted (${P.puffN})`);

// bloom fire detection: cooldown re-arm → fireAt set this frame
const bloom = hz.find((h) => h.kind === 'bloom')!;
bloom.data.cd = 1.2;
frame(w2, [], 314);
const brec = (Hz.recs as Map<number, Any>).get(bloom.id)!;
check(Math.abs(brec.fireAt - time) < 1e-9, 'bloom cooldown jump detected as a seed shot (petals open)');

// fire one instant telegraph + one active (dps) telegraph, then remove one silently
const inst = tgs[1], act = tgs[6], silent = tgs[2];
inst.fired = true; inst.alive = false;
act.fired = true; act.t = act.windup;
silent.alive = false;
frame(w2, [{ type: 'telegraphFire', id: inst.id, owner: inst.owner, hit: false, x: 0, z: 0 },
  { type: 'telegraphFire', id: act.id, owner: act.owner, hit: true, x: 0, z: 0 }], 314);
const recs = T.recs as Map<number, Any>;
check(recs.get(inst.id)?.firedAt === time, 'instant telegraph: flash starts on telegraphFire');
check(recs.get(act.id)?.fired === true && recs.get(act.id)?.goneAt === -1, 'active telegraph stays drawn (filled) after firing');
check(recs.get(silent.id)?.goneAt === time && recs.get(silent.id)?.firedAt === -1, 'telegraph removed without firing → fade (no flash)');
// compact the sim arrays like world.ts does, then let the ghosts expire
w2.telegraphs = tgs.filter((t) => t.alive);
for (let i = 0; i < 30; i++) frame(w2, [], 314);
check(!recs.has(inst.id) && !recs.has(silent.id), 'flash / fade ghosts retire after they finish (≤ 0.5 s)');
check(recs.has(act.id), 'active telegraph still tracked while alive');
act.alive = false;
for (let i = 0; i < 30; i++) frame(w2, [], 314);
check(!recs.has(act.id), 'active telegraph retires after it ends');
// hazards removed early fade then retire
w2.hazards = [];
frame(w2, [], 314);
check((Hz.recs as Map<number, Any>).size === styles.length, 'hazards removed early are kept for their fade');
for (let i = 0; i < 20; i++) frame(w2, [], 314);
check((Hz.recs as Map<number, Any>).size === 0, 'hazard ghosts retire after GONE_FADE_S');
w2.projectiles = [];
frame(w2, [], 314);
check(Object.values(pv.counts()).every((n, i, a) => i === a.length - 1 || n === 0), 'no projectile drawn once the sim list is empty');
check(buffersOk(), 'instance buffers NaN-free after the injected lifecycle');

for (const v of [hv, tv, pv]) v.unmount();
console.log(fails === 0 ? 'PROBE PASS' : `PROBE FAIL (${fails})`);
process.exit(fails === 0 ? 0 : 1);
