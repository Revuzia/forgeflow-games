import { UPGRADE_BY_ID } from '../../../src/data/upgrades.ts';
import { GATE_CARD_IDS } from '../../../src/data/upgrades_gate.ts';
for (const id of GATE_CARD_IDS) { const u = UPGRADE_BY_ID[id]; console.log(`[${u.rarity} locked=${u.locked}] ${u.name} x${u.maxStacks} (${u.tags.join(',')}): ${u.desc}`); }
