import { EVOLUTIONS } from '../../../src/data/evolutions.ts';
import { UPGRADE_BY_ID } from '../../../src/data/upgrades.ts';
for (const r of EVOLUTIONS) { const e = UPGRADE_BY_ID[r.id], b = UPGRADE_BY_ID[r.base], w = UPGRADE_BY_ID[r.with];
  console.log(r.id, '|', e?.name, '| base', r.base, b?.titan ?? '-', b?.maxStacks, '| with', r.with, w?.titan ?? '-', '| evoTitan', e?.titan ?? '-', e?.locked ? 'LOCKED' : ''); }
