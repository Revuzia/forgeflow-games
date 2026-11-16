// POWERS-GROWTH v3 §3.2: tag every power of src/data/powers.json with `tier` (0..4), `price` (worship in a bound world) and
// `free` (never charged). Idempotent; `cost` / `cooldown` (legacy restraint) are not touched. Run: node _harness/probes/reach-tag-powers.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const F = new URL('../../src/data/powers.json', import.meta.url);
const j = JSON.parse(readFileSync(F, 'utf8'));
const w = (s) => s.split(/\s+/).filter(Boolean);
const T1 = w('omen sacred-place sacred-animal disciple disciple-order inspire teach forbid sway-belief cast water-miracle fire-miracle wood-miracle');
const T2 = w(`food-miracle heal-miracle forest-miracle storm-miracle calm fertility teach-miracle fireball shield meteor-miracle heal-area bless curse kill-area invent-animal
 peace war treaty split merge move-settlement forget withdraw silence-town introduce-item introduce-idea introduce-artifact introduce-animal introduce-crop introduce-disease
 introduce-people introduce-substance invent-thing invent-idea flood omen-eclipse give-law set-hour invent-weather`);
const T3o = w('disaster-random scale-disaster move-disaster freeze-disaster tsunami-wave raise-seas lower-seas world-weather hold-season raze extinct set-law species-law freeze-sun day-length year-length magnetism');
const T4o = w('axial-tilt remove-air gravity spin star-kind star-brightness star-flare move-world birth-world crack-world erase-world add-moon moon-fall launch-ship destroy-ship');
// never charged: the clock, the Hand, possession, names, the settings, the story answers, and the very basic spells (owner 2026-11-16, second)
const FREE = w(`speed step rewind edit-past save load resume grab throw release place drop slap stroke possess possess-move possess-act rename-person rename-settlement
 wrath restraint natural-disasters rival rival-remove cancel-disaster recall-ship answer-prayer prophet-abandon disciple-order
 tower-confuse tower-strike tower-warn tower-let vow-no-flood vow-spare-the-many vow-gentle vow-warn-first vow-none answer-wrath answer-mercy answer-sign answer-patience
 rain heal-person plant lightning gift ignite extinguish`);
// priced away from the half-cost rule (owner 2026-11-16, third: the rainbow is a sign, priced as the smallest sign)
const PRICE = { 'omen-rainbow': 5 };
const count = [0, 0, 0, 0, 0];
for (const p of j.powers) {
  let t = 0;
  if (T1.includes(p.id)) t = 1; else if (T2.includes(p.id)) t = 2; else if (T3o.includes(p.id)) t = 3; else if (T4o.includes(p.id)) t = 4;
  else if (p.id.startsWith('disaster-') && p.id !== 'disaster-random') t = (p.cost ?? 0) >= 400 ? 4 : 3;
  const c = p.cost ?? 0;
  const free = FREE.includes(p.id);
  // price by size: the basics cost a little (half the old restraint cost, 1..40 so a new world's pool always covers one), the
  // bands above cost their data cost (regional acts x 1.25)
  const price = free ? 0 : PRICE[p.id] !== undefined ? PRICE[p.id] : t === 0 ? Math.max(1, Math.min(40, Math.round(c * 0.5))) : t === 3 ? Math.round(c * 1.25) : Math.max(1, c);
  p.tier = t; p.price = price;
  if (free) p.free = true; else delete p.free;
  count[t]++;
}
writeFileSync(F, JSON.stringify(j, null, 1) + '\n');
console.log('tiers', count.join(' / '), 'free', j.powers.filter((p) => p.free).length);
