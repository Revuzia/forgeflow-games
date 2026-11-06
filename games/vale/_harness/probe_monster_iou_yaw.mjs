/** CW4 critic:monsters: silhouette IoU between camps over every facing, read from a value_probe report (no browser).
 *  Evidence for the lead's gate ruling: a single free-facing reading is one draw from this spread.
 *
 *  First: node _harness/value_probe.mjs --maps rift --tiers high --monsters only --t 1000 --seed 23
 *           --monsterYaws 0,45,90,135,180,225,270,315 --tag fw_CW4_r3rf2_yaw --report fw_CW4_r3rf2_yaw.json
 *  Then:  node _harness/probe_monster_iou_yaw.mjs [report name] [tag]
 *  Writes _harness/_reports/<report name>_iou.json. Same-camp pairs are not the gate, as in value_probe's iouCycle. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const name = process.argv[2] ?? 'fw_CW4_r3rf2_yaw';
const tag = process.argv[3] ?? name;
const dir = join(dirname(fileURLToPath(import.meta.url)), '_reports');
const { monsters } = JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')).runs[tag].rift_high;
const SAME_CAMP = [['gloamoth', 'gloamoth_little'], ['stilltusk', 'stilltusk_young'], ['stray_numeral', 'stray_tick']];
const sameCamp = (a, b) => SAME_CAMP.some((f) => f.includes(a) && f.includes(b));

const iou = (a, b) => {
  let n = 0, u = 0;
  for (let i = 0; i < a.length; i++) { const x = a[i] === '1', y = b[i] === '1'; if (x && y) n++; if (x || y) u++; }
  return u ? n / u : 0;
};
const median = (v) => (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2);
const r3 = (x) => +x.toFixed(3);
const summary = (v) => { v.sort((a, b) => a - b); return { median: r3(median(v)), max: r3(v[v.length - 1]), min: r3(v[0]), over05: r3(v.filter((x) => x > 0.5).length / v.length), n: v.length }; };
const sils = (id) => Object.values(monsters[id].silByYaw).flat();

const ids = Object.keys(monsters);
const pairs = {}, self = {};
for (let i = 0; i < ids.length; i++) {
  const own = sils(ids[i]), v = [];
  for (let p = 0; p < own.length; p++) for (let q = p + 1; q < own.length; q++) v.push(iou(own[p], own[q]));
  self[ids[i]] = summary(v);
  for (let j = i + 1; j < ids.length; j++) {
    if (sameCamp(ids[i], ids[j])) continue;
    pairs[`${ids[i]}|${ids[j]}`] = summary(sils(ids[i]).flatMap((a) => sils(ids[j]).map((b) => iou(a, b))));
  }
}
const sorted = Object.entries(pairs).sort((a, b) => b[1].median - a[1].median);
const out = { pairCount: sorted.length, overMedian05: sorted.filter(([, s]) => s.median > 0.5).map(([k, s]) => [k, s.median]), pairs: Object.fromEntries(sorted), selfAcrossFacings: self };
writeFileSync(join(dir, `${name}_iou.json`), JSON.stringify(out, null, 1));
for (const [k, s] of sorted.slice(0, 6)) console.log(`${k}: median ${s.median} max ${s.max} over 0.5 in ${(s.over05 * 100).toFixed(0)} %`);
console.log(`cross-camp pairs with median over 0.5: ${out.overMedian05.length} of ${out.pairCount}`);
for (const [k, s] of Object.entries(self)) console.log(`${k} against itself: median ${s.median}, min ${s.min}`);
