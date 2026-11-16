// aggregate scratch jsonl -> markdown tables (mean over seeds). usage: node powers-stage0-tables.mjs file...
import fs from 'node:fs';
const R = process.argv.slice(2).flatMap((f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)));
const by = {}; for (const r of R) (by[r.scen + '|' + r.beh] ??= []).push(r);
const mean = (a) => a.reduce((x, y) => x + y, 0) / (a.length || 1);
const med = (a) => { const b = a.filter((x) => x >= 0).sort((x, y) => x - y); return b.length ? b[b.length >> 1] : null; };
const f = (v, d = 0) => (v === null || Number.isNaN(v) ? '-' : v.toFixed(d));
// row idx: 0 pop 1 f30 2 f55 3 e30 4 e55 5 l30 6 l55 7 fe30 8 fe55 9 fl30 10 fl55 11 gen 12 pool 13 shr 14 tmp 15 F1(old) 16 S 17 popMax 18 rT 19 rF 20 bel 21 Fv1 22 towns
const at = (rs, y, i) => mean(rs.map((r) => (r.rows[y - 1] ?? r.rows.at(-1))[i]));
const inc = (rs, y) => mean(rs.map((r) => (r.rows[y - 1][11] - (y > 1 ? r.rows[y - 2][11] : 0))));
let out = '';
for (const sc of [...new Set(R.map((r) => r.scen))]) {
  out += `\n### ${sc} (${by[sc + '|none']?.length ?? 0} seeds)\n\n`;
  out += '| god | yr | pop | faith>=.30 | >=.55 | fear>=.30 | >=.55 | trust>=.30 | >=.55 | faith&fear | faith&trust | believers (grown) | trust road | fear road | F v2 | S v2 | gen/yr | gen/town/day | pool | shr | tmp |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n';
  for (const b of ['none', 'help', 'severe', 'mixed']) {
    const rs = by[sc + '|' + b]; if (!rs) continue;
    for (const y of [1, 2, 3, 5, 10]) {
      const bel = at(rs, y, 20), t = at(rs, y, 18), fr = at(rs, y, 19), pm = at(rs, y, 17);
      const g = inc(rs, y), tw = Math.max(1, at(rs, y, 22));
      out += `| ${b} | ${y} | ${f(at(rs, y, 0))} | ${f(at(rs, y, 1))} | ${f(at(rs, y, 2))} | ${f(at(rs, y, 3))} | ${f(at(rs, y, 4))} | ${f(at(rs, y, 5))} | ${f(at(rs, y, 6))} | ${f(at(rs, y, 7))} | ${f(at(rs, y, 9))} | ${f(bel)} | ${f(t)} | ${f(fr)} | ${f(bel + t + fr)} | ${f((bel + t + fr) / (2 * pm), 2)} | ${f(g)} | ${f(g / 12 / tw, 1)} | ${f(at(rs, y, 12))} | ${f(at(rs, y, 13), 1)} | ${f(at(rs, y, 14), 1)} |\n`;
    }
  }
  out += '\nDay each v1 threshold is first crossed (median over seeds; plain F / with the share rules; "-" = never in 10 y; days, 12 = one year):\n\n| god | F>=3 | F>=20 | F>=70 | F>=200 | rule3 | rule20 | rule70 | rule200 |\n|---|---|---|---|---|---|---|---|---|\n';
  for (const b of ['none', 'help', 'severe', 'mixed']) {
    const rs = by[sc + '|' + b]; if (!rs) continue;
    out += `| ${b} | ${['F3', 'F20', 'F70', 'F200', 'R3', 'R20', 'R70', 'R200'].map((k) => { const v = rs.map((r) => r.cross[k]); const m = med(v); return m === null ? `- (0/${v.length})` : `${m} (${v.filter((x) => x >= 0).length}/${v.length})`; }).join(' | ')} |\n`;
  }
}
console.log(out);
