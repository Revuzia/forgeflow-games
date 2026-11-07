// Offline T2 evaluator for probe-tcand.ts logs: for each (chance, leaderPride, leaderPop, base) combination, the year of
// the first tower attempt per seed under the §2.2 rules (world age >= 10, leader conditions, league >= 2, the roll
// roll < chance * clamp((pride - base) / 0.3)), and attempts in 60 y assuming each tower ends ~8 y after it begins
// (then the 20-year gap). The world after a begun tower is not modelled (first attempt exact, later ones estimates).
// Usage: node _harness/arc-work/tcand-eval.mjs <log>...
import { readFileSync } from 'node:fs';
import { hashFloat } from '../../src/sim/core/rng.ts';
const rows = [];
for (const f of process.argv.slice(2)) for (const l of readFileSync(f, 'utf8').split('\n')) if (l.startsWith('C ')) { try { rows.push(JSON.parse(l.slice(2))); } catch { /* a line still being written */ } }
// the planet id (the logged roll is hashFloat(pid, y, 0x70e1)); the live roll adds the world seed (stint 5)
const r0 = rows[0]; let pid = 0; while (pid < 100000 && Math.abs(hashFloat(pid, r0.y, 0x70e1) - r0.roll) > 1e-12) pid++;
for (const r of rows) r.roll = process.env.OLDROLL ? r.roll : hashFloat(pid, r.y, 0x70e1, r.seed);
const seeds = [...new Set(rows.map((r) => r.seed))].sort((a, b) => a - b);
const clamp = (v) => Math.max(0, Math.min(1, v));
function run(c, lp, pop, base) {
  const out = [];
  for (const s of seeds) {
    const R = rows.filter((r) => r.seed === s).sort((a, b) => a.y - b.y);
    let first = null, n = 0, freeAt = -1;
    for (const r of R) {
      const age = r.towns.reduce((m, t) => Math.max(m, t.age), 0);
      if (age < 10 || r.y < freeAt) continue;
      let host = null;
      for (const t of r.towns) {
        if (t.pride < lp || t.pop < pop || t.era < 2 || !t.brick || t.war || t.famine || t.harm || t.kin < 2) continue;
        if (!host || t.pride > host.pride) host = t;
      }
      if (!host) continue;
      if (r.roll >= c * clamp((host.pride - base) / 0.3)) continue;
      n++; if (first === null) first = age; freeAt = r.y + 8 + 20;
    }
    out.push({ s, first, n });
  }
  const begun = out.filter((o) => o.first !== null);
  const fy = begun.map((o) => o.first).sort((a, b) => a - b);
  const med = fy.length ? fy[Math.floor((fy.length - 1) / 2)] : null;
  return { c, lp, pop, base, seeds: out.length, begun: begun.length, median: med && +med.toFixed(1), maxN: Math.max(0, ...out.map((o) => o.n)), per: out.map((o) => `${o.s}:${o.first === null ? '-' : o.first.toFixed(1)}`).join(' ') };
}
// raw peaks per seed
for (const s of seeds) {
  const R = rows.filter((r) => r.seed === s);
  let best = { pride: 0 };
  for (const r of R) for (const t of r.towns) if (t.pride > best.pride) best = { ...t, y: r.y };
  console.log(`seed ${s}: years ${R.length}, peak pride ${JSON.stringify(best)}`);
}
const G = process.env.GRID ? JSON.parse(process.env.GRID) : { c: [0.15, 0.2, 0.3], lp: [0.62, 0.58], pop: [60, 50, 45], base: [0.6, 0.5] };
for (const c of G.c) for (const lp of G.lp) for (const pop of G.pop) for (const base of G.base)
  console.log(JSON.stringify(run(c, lp, pop, base)));
