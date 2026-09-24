// foes-view: allocation sites of BossView in the probe's late-fight scenario (after defeat → re-alive).
import * as THREE from 'three';
import { Session } from 'node:inspector/promises';
import { BossView } from '../../../src/ai/bossview.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import { SIM_DT } from '../../../src/core/config.ts';
import type { BossId, BiomeId } from '../../../src/core/types.ts';
import type { FrameInfo, ViewCtx } from '../../../src/render/viewtypes.ts';
const id = (process.argv[2] ?? 'caisson4') as BossId;
const biome: BiomeId = id === 'caisson4' ? 'lockwater' : 'whitestacks';
const ctx: ViewCtx = { renderer: {} as unknown as THREE.WebGLRenderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), quality: { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true } };
const w = createWorld({ titan: 'hearthback', biome, seed: 9 });
w.cheats.god = true; w.cheats.noSpawns = true;
w.titan.rank = 4; w.titan.height = 60; w.titan.radius = 25.2;
const view = new BossView(ctx); view.mount(w); spawnBoss(w, id);
const b = w.boss!;
for (let i = 0; i < 30 * 200; i++) {
  stepWorld(w, i % 400 < 200 ? { mx: 0.6, mz: 0.2, ability: false, abilityHeld: false, dash: false } : NO_INPUT);
  if (b.introT <= 0) b.phase = w.t > 60 ? 3 : w.t > 30 ? 2 : 1;
  view.update(w, { alpha: 0.5, dt: SIM_DT, time: w.t, events: w.events, camDist: 100, frozen: false });
}
b.alive = false; b.hp = 0;
for (let k = 0; k < 240; k++) view.update(w, { alpha: 1, dt: 1 / 60, time: k / 60, events: [], camDist: 500, frozen: true });
b.alive = true;
const f: FrameInfo = { alpha: 0.5, dt: 1 / 60, time: 0, events: [], camDist: 500, frozen: false };
for (let k = 0; k < 3000; k++) view.update(w, f);
console.log('state', b.attack, b.attackT.toFixed(2), 'stagger', b.staggerT, 'leash', !!w.titan.leash, 'projectiles', w.projectiles.filter((p) => p.alive).length, 'tells', w.telegraphs.filter((t) => t.alive).length);
const s = new Session(); s.connect();
await s.post('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
for (let k = 0; k < 10000; k++) view.update(w, f);
const { profile } = await s.post('HeapProfiler.stopSampling') as { profile: { head: Node } };
interface Node { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: Node[] }
const sites = new Map<string, number>();
const walk = (n: Node, parent: string) => {
  const cf = n.callFrame;
  const here = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
  if (n.selfSize > 0) { const k = here + '  <=  ' + parent; sites.set(k, (sites.get(k) ?? 0) + n.selfSize); }
  for (const c of n.children) walk(c, here);
};
walk(profile.head, '');
for (const [k, v] of [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log((v / 1024).toFixed(1).padStart(9), 'KB', k);
