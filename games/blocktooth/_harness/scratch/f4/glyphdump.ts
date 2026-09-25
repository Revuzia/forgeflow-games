import { UPGRADES } from '../../../src/data/upgrades.ts';
import { iconFor } from '../../../src/ui/icons.ts';
const by: Record<string, string[]> = {};
for (const u of UPGRADES) { if (u.perk) continue; const g = iconFor(u);
  const eff = u.effects.map((e) => e.trigger ? `T:${e.trigger.on}>${e.trigger.action}` : e.stat ? `S:${e.stat}` : JSON.stringify(e).slice(0, 30)).join(',');
  (by[g] ??= []).push(`${u.id}${u.evo ? '(evo)' : ''}${u.titan ? '[' + u.titan + ']' : ''} ${u.tags.join('/')} ${u.rarity} :: ${eff}`); }
for (const [g, l] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) { console.log(`== ${g} (${l.length})`); for (const s of l) console.log('   ' + s); }
