import { buildTitanModel } from '../../../src/titans/models.ts';
for (const id of ['molo', 'voltkite', 'hearthback', 'briarwick'] as const) {
  try { const m = buildTitanModel(id); console.log(id, JSON.stringify(m.size)); } catch (e) { console.log(id, 'ERR', String(e).slice(0, 200)); }
}
