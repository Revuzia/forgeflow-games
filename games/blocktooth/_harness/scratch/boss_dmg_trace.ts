// Boss-threat lane scratch (not gate code): one full gate-bot run (probe_sim's exact loop: bot.ts +
// draft picks), then a breakdown of the boss fight — boss tells fired/landed by tag, titan damage by
// source kind while the boss is up, the fight length, min HP.
//   node _harness/scratch/boss_dmg_trace.ts voltkite lockwater [seed=1337]
import type { BiomeId, TitanId, World } from '../../src/core/types.ts';
import { createWorld, stepWorld } from '../../src/core/world.ts';
import { hasPendingDraft, pickUpgrade, rollOffer } from '../../src/upgrades/draft.ts';
import { botInput, botPickUpgrade } from '../bot.ts';

const [titan, biome, seedS] = process.argv.slice(2);
const seed = Number(seedS ?? 1337);
const w: World = createWorld({ titan: titan as TitanId, biome: biome as BiomeId, seed });
const tags = new Map<number, string>();
const tg: Record<string, [number, number]> = {};
const dmg: Record<string, number> = {};
let bossT0 = NaN, minHp = 1;
for (let i = 0; i < 13 * 60 * 30 && !w.run.result; i++) {
  let g = 0;
  while (hasPendingDraft(w) && g++ < 200) {
    const o = w.upgrades.offer?.length ? w.upgrades.offer : rollOffer(w, w.upgrades.chestDrafts > 0);
    if (!o.length) break;
    pickUpgrade(w, botPickUpgrade(w, o));
  }
  stepWorld(w, botInput(w));
  const b = w.boss;
  if (!b) continue;
  if (Number.isNaN(bossT0)) bossT0 = w.t;
  for (const t of w.telegraphs) if (t.owner === 'boss' && !tags.has(t.id)) {
    const sh = t.shape as { x?: number; z?: number };
    const fol = sh.x !== undefined && b.data.followX === sh.x && b.data.followZ === sh.z;
    tags.set(t.id, `P${b.phase}:${fol ? 'follow' : t.tag || t.style}`);
  }
  for (const e of w.events) {
    if (e.type === 'telegraphFire' && e.owner === 'boss') { const k = tags.get(e.id) ?? '?'; const a = tg[k] ?? (tg[k] = [0, 0]); a[0]++; if (e.hit) a[1]++; }
    if (e.type === 'titanHurt' && b.alive) dmg[e.src] = (dmg[e.src] ?? 0) + e.dmg;
  }
  if (b.alive) minHp = Math.min(minHp, w.titan.hp / w.titan.maxHp);
}
let n = 0, h = 0; const by: Record<string, string> = {};
for (const [k, [a, c]] of Object.entries(tg).sort()) { n += a; h += c; by[k] = `${c}/${a}`; }
const r = (x: number) => Math.round(x);
console.log(JSON.stringify({ titan, biome, seed, result: w.run.result, endT: r(w.t), bossT0: r(bossT0), fight: r(w.t - bossT0),
  maxHp: r(w.titan.maxHp), minHpInFight: +(minHp * 100).toFixed(0) + '%', tells: `${h}/${n} (${r(100 * h / Math.max(1, n))}%)`,
  dmgBySrc: Object.fromEntries(Object.entries(dmg).map(([k, v]) => [k, r(v)])), by }));
