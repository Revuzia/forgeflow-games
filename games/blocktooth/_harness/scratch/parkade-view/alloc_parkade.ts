// L7: per-frame allocation of BossView + the PARKADE-6 poser (node, THREE without a renderer).
//   node _harness/scratch/parkade-view/alloc_parkade.ts
// Steps the real sim into each state (walk, every attack incl. the tow HOOKED, JAMMED + steam, defeat), then
// runs 4000 view-only frames per state under the V8 sampling heap profiler and prints the bytes allocated per
// frame attributed to bossview.ts / foemodels_parkade.ts. Budget: 0 (CONTRACT §0.7, no per-frame allocation).
import * as THREE from 'three';
import { Session } from 'node:inspector/promises';
import { BossView } from '../../../src/ai/bossview.ts';
import { createWorld, stepWorld, NO_INPUT } from '../../../src/core/world.ts';
import { spawnBoss } from '../../../src/ai/bosses/index.ts';
import { SIM_DT } from '../../../src/core/config.ts';
import type { FrameInfo, ViewCtx } from '../../../src/render/viewtypes.ts';

const canvas = { clientHeight: 720 } as unknown as HTMLCanvasElement;
const ctx: ViewCtx = {
  renderer: { domElement: canvas } as unknown as THREE.WebGLRenderer, scene: new THREE.Scene(),
  camera: new THREE.PerspectiveCamera(30, 16 / 9, 1, 5000),
  quality: { dpr: 1, shadows: true, level: 2, reduceFlashing: false, screenShake: true },
};
ctx.camera.position.set(300, 300, 300);
const BID = (process.argv[2] ?? 'parkade6') as 'parkade6' | 'caisson4';
const w = createWorld({ titan: 'molo', biome: BID === 'caisson4' ? 'lockwater' : 'grideast', seed: 3 });
w.cheats.god = true; w.cheats.noSpawns = true;
w.titan.rank = 4; w.titan.height = 60; w.titan.radius = 25.2;
const view = new BossView(ctx); view.mount(w); spawnBoss(w, BID);
const b = w.boss!;
const PH: Record<string, 1 | 2 | 3> = BID === 'caisson4' ? { hookLane: 1, hookDrop: 1, winchLeash: 2, boomSweep: 2, legStomp: 3 } : { rampLaunch: 1, barrierSwing: 1, towChain: 2, deckDrop: 2, levelCollapse: 3 };

function reach(state: string): string {
  for (let i = 0; i < 30 * 300; i++) {
    stepWorld(w, i % 300 < 150 ? { mx: 0.5, mz: 0.3, ability: false, abilityHeld: false, dash: false } : NO_INPUT);
    view.update(w, { alpha: 0.5, dt: SIM_DT, time: w.t, events: w.events, camDist: 400, frozen: false });
    if (b.introT > 0) continue;
    if (state === 'walk' && (b.data.speed ?? 0) > 1 && !b.attack) return 'walk';
    if (state === 'jammed') { b.staggerT = 5; b.attack = null; b.data.tillOpen = 5; return 'jammed'; }
    if (PH[state]) {
      if (b.phase < PH[state]) b.phase = PH[state];
      if (b.attack === state && (state !== 'towChain' && state !== 'winchLeash' ? b.attackT > 0.5 : !!w.titan.leash)) return state + (w.titan.leash ? ' (hooked)' : '');
    }
  }
  return state + ' NOT REACHED';
}

const s = new Session(); s.connect();
interface Node { callFrame: { functionName: string; url: string; lineNumber: number }; selfSize: number; children: Node[] }
let worst = 0;
for (const st of ['walk', ...Object.keys(PH), 'jammed', 'dead']) {
  let label = st;
  if (st === 'dead') { b.alive = false; b.hp = 0; } else label = reach(st);
  // warm the frame path (JIT, caches), then profile view-only frames: moving alpha, live dt, frozen sim
  const f: FrameInfo = { alpha: 0.5, dt: 1 / 60, time: 0, events: [], camDist: 400, frozen: true };
  for (let k = 0; k < 600; k++) { f.time += 1 / 60; view.update(w, f); }
  await s.post('HeapProfiler.startSampling', { samplingInterval: 128, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
  const N = 4000;
  for (let k = 0; k < N; k++) { f.time += 1 / 60; view.update(w, f); }
  const { profile } = await s.post('HeapProfiler.stopSampling') as { profile: { head: Node } };
  let mine = 0;
  const sites = new Map<string, number>();
  const walk = (n: Node) => {
    const url = n.callFrame.url;
    if (n.selfSize > 0 && (url.includes('bossview') || url.includes('foemodels_parkade'))) {
      mine += n.selfSize;
      const k = `${n.callFrame.functionName || '(anon)'} ${url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
      sites.set(k, (sites.get(k) ?? 0) + n.selfSize);
    }
    for (const c of n.children) walk(c);
  };
  walk(profile.head);
  const perFrame = mine / N;
  worst = Math.max(worst, perFrame);
  const top = [...sites.entries()].sort((a, c) => c[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${(v / 1024).toFixed(1)}KB`).join(' | ');
  console.log(`${label.padEnd(26)} chain=${view['pkChainN' as keyof BossView] ?? '-'} bytes/frame ${perFrame.toFixed(2)}  ${top}`);
}
console.log(`WORST ${worst.toFixed(2)} bytes/frame (bossview.ts + foemodels_parkade.ts)`);
