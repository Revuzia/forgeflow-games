// foes-view: attribute per-frame allocations of EnemyView / BossView to source lines (sampling heap profiler).
import * as THREE from 'three';
import { Session } from 'node:inspector/promises';
import { EnemyView } from '../../../src/ai/enemyview.ts';
import { BossView } from '../../../src/ai/bossview.ts';
import { createWorld, stepWorld } from '../../../src/core/world.ts';
import { spawnEnemy } from '../../../src/ai/enemies.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import { ENEMY_KINDS } from '../../../src/core/types.ts';
import type { World } from '../../../src/core/types.ts';
import type { FrameInfo, ViewCtx } from '../../../src/render/viewtypes.ts';
const which = process.argv[2] ?? 'enemy';
const ctx: ViewCtx = { renderer: {} as unknown as THREE.WebGLRenderer, scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), quality: { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true } };
const w = createWorld({ titan: 'molo', biome: which === 'enemy' ? 'grideast' : 'whitestacks', seed: 3 });
w.cheats.god = true; w.cheats.noSpawns = true;
let view: { update(w: World, f: FrameInfo): void };
if (which === 'enemy') {
  const v = new EnemyView(ctx); v.mount(w); view = v;
  for (let i = 0; i < 160; i++) spawnEnemy(w, ENEMY_KINDS[i % 8], w.titan.x + Math.sin(i) * 50, w.titan.z + Math.cos(i) * 50);
} else {
  const v = new BossView(ctx); v.mount(w); view = v; spawnBoss(w, which === 'caisson' ? 'caisson4' : 'irongully');
}
for (let i = 0; i < 300; i++) { stepWorld(w, { mx: 0.3, mz: 0.1, ability: false, abilityHeld: false, dash: false }); view.update(w, { alpha: 0.5, dt: 1 / 30, time: i, events: w.events, camDist: 100, frozen: false }); }
const f: FrameInfo = { alpha: 0.5, dt: 1 / 60, time: 0, events: [], camDist: 100, frozen: false };
for (let i = 0; i < 3000; i++) view.update(w, f);          // warm the JIT
const s = new Session(); s.connect();
await s.post('HeapProfiler.startSampling', { samplingInterval: 256, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
for (let i = 0; i < 10000; i++) view.update(w, f);
const { profile } = await s.post('HeapProfiler.stopSampling') as { profile: { head: Node } };
interface Node { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: Node[] }
const sites = new Map<string, number>();
const walk = (n: Node, stack: string) => {
  const cf = n.callFrame;
  const here = `${cf.functionName || '(anon)'} ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`;
  if (n.selfSize > 0) sites.set(here + '  <=  ' + stack, (sites.get(here + '  <=  ' + stack) ?? 0) + n.selfSize);
  for (const c of n.children) walk(c, here.includes('src/') || here.includes('three') ? here : stack);
};
walk(profile.head, '');
const top = [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
for (const [k, v] of top) console.log((v / 1024).toFixed(1).padStart(9), 'KB', k);
