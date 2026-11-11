import { Group, MeshBasicMaterial } from 'three';
import { ChunkLOD, Patch } from '/home/user/forgeflow-games/games/genesis/src/render/planet/chunks.ts';
import { getGrid } from '/home/user/forgeflow-games/games/genesis/src/sim/grid/icogrid.ts';
import { Noise3 } from '/home/user/forgeflow-games/games/genesis/src/sim/grid/noise.ts';
const grid = getGrid(48); const n = grid.count;
const lod = new ChunkLOD(grid, new Noise3(1234), 3000, new Group(), { terrain: () => new MeshBasicMaterial(), water: () => new MeshBasicMaterial() },
  { surface: new Float32Array(n), grad: null, waterLevel: new Float32Array(n).fill(-1000), waterDepth: new Float32Array(n), geomVersion: 0 });
let h = 0x811c9dc5 >>> 0;
const mix = (b: Uint8Array) => { for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } };
const t0 = performance.now(); let cnt = 0;
for (const [f, lv, k] of [[0,0,0],[3,1,0],[7,2,1],[11,4,3],[19,6,5],[5,9,17],[13,12,200],[2,14,1000]]) {
  const st = grid.n / 2 ** lv; const kk = k % (2 ** lv);
  const p = new Patch(f, lv, [kk * st, 0], [kk * st + st, 0], [kk * st, st]);
  const g = (lod as any).buildGeometry(p); cnt++;
  for (const name of Object.keys(g.attributes).sort()) mix(new Uint8Array(g.attributes[name].array.buffer, g.attributes[name].array.byteOffset, g.attributes[name].array.byteLength));
  mix(new Uint8Array(p.vcells!.buffer));
}
console.log('hash', h.toString(16), cnt, (performance.now()-t0).toFixed(1),'ms');
