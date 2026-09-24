// Titan model forward extent (nose) in height-1 units — scratch, for the CAISSON-4 keep-out.
import * as M from '../../src/titans/models.ts';
const fn = (M as unknown as Record<string, (id: string) => { size: { width: number; length: number; zMin: number; zMax: number } }>);
for (const id of ['molo', 'voltkite', 'hearthback', 'briarwick']) {
  try { const m = fn.buildTitanModel ? fn.buildTitanModel(id) : fn.createTitanModel(id); console.log(id, JSON.stringify(m.size)); }
  catch (e) { console.log(id, 'ERR', String(e).slice(0, 200)); }
}
