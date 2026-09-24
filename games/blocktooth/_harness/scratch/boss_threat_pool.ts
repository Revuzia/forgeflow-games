// Pools boss_threat.ts (human-like fullrun policy port, god mode, no adds) over seeds × levels × bosses
// and prints the pooled boss-tell hit rate per titan/boss/level plus the mean build stats.
//   node _harness/scratch/boss_threat_pool.ts [titans=voltkite,molo] [seeds=8] [levels=8,34] [par=8]
import { spawn } from 'node:child_process';
import { cpus } from 'node:os';

const [tArg, sArg, lArg, pArg] = process.argv.slice(2);
const titans = (tArg ?? 'voltkite,molo').split(',');
const nSeeds = Number(sArg ?? 8);
const levels = (lArg ?? '8,34').split(',').map(Number);
const par = Number(pArg ?? Math.max(2, cpus().length - 2));
const bosses: [string, string][] = [['lockwater', 'CAISSON'], ['whitestacks', 'IRONGULLY']];

interface Job { titan: string; biome: string; boss: string; lv: number; seed: number }
const jobs: Job[] = [];
for (const titan of titans) for (const [biome, boss] of bosses) for (const lv of levels)
  for (let s = 1 + Number(process.env.SEED0 ?? 0); s <= nSeeds + Number(process.env.SEED0 ?? 0); s++) jobs.push({ titan, biome, boss, lv, seed: s * 7 + 3 });

interface Res { hits: number; n: number; stats: Record<string, number> | null; by: Record<string, string>; diag: Record<string, number>; t: number }
const out = new Map<Job, Res>();
function run(j: Job): Promise<void> {
  return new Promise((res) => {
    const p = spawn(process.execPath, ['_harness/scratch/boss_threat.ts', j.titan, j.biome, String(j.seed), '45'],
      { env: { ...process.env, LV: String(j.lv), STATS: '1' } });
    let so = '', se = '';
    p.stdout.on('data', (d) => (so += d)); p.stderr.on('data', (d) => (se += d));
    p.on('close', () => {
      const line = so.trim().split('\n').pop() ?? '{}';
      let r: { total?: string; by?: Record<string, string>; diag?: Record<string, number>; dashes?: number; t?: number } = {};
      try { r = JSON.parse(line); } catch { /* leave empty */ }
      const m = /^(\d+)\/(\d+)/.exec(r.total ?? '');
      let stats: Record<string, number> | null = null;
      const sl = se.split('\n').find((l) => l.startsWith('{"lv"'));
      if (sl) try { stats = JSON.parse(sl); } catch { /* none */ }
      if (!m) console.error('FAILED', j, se.slice(-400));
      out.set(j, { hits: m ? +m[1] : 0, n: m ? +m[2] : 0, stats, by: r.by ?? {}, diag: { ...(r.diag ?? {}), dashes: r.dashes ?? 0 }, t: r.t ?? 0 });
      res();
    });
  });
}
let next = 0;
await Promise.all(Array.from({ length: par }, async () => { while (next < jobs.length) await run(jobs[next++]); }));

const groups = new Map<string, Job[]>();
for (const j of jobs) { const k = `${j.titan.padEnd(10)} ${j.boss.padEnd(9)} LV ${String(j.lv).padStart(2)}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(j); }
console.log('titan      boss      level   hits/tells   rate   landed  dash/s  tells: hit|miss after a dash / walked   per-seed rates                     mean build (lv · maxSp · charges · cd · dist · maxHp)');
for (const [k, js] of groups) {
  let h = 0, n = 0; const per: string[] = []; const st: Record<string, number> = {}; let ns = 0; const dg: Record<string, number> = {}; let tt = 0;
  for (const j of js) {
    const r = out.get(j)!; h += r.hits; n += r.n; per.push(String(Math.round(100 * r.hits / Math.max(1, r.n)))); tt += r.t;
    for (const [a, v] of Object.entries(r.diag)) dg[a] = (dg[a] ?? 0) + v;
    if (r.stats) { ns++; for (const [a, v] of Object.entries(r.stats)) st[a] = (st[a] ?? 0) + v; }
  }
  const m = (a: string) => (ns ? +(st[a] / ns).toFixed(2) : NaN);
  console.log(`${k}   ${String(h).padStart(4)}/${String(n).padEnd(5)}  ${(100 * h / Math.max(1, n)).toFixed(1).padStart(5)} %  ${(100 * (dg.landed ?? 0) / Math.max(1, n)).toFixed(1).padStart(4)} %  ${(dg.dashes / Math.max(1, tt)).toFixed(2).padStart(5)}   ${dg.hitDash}|${dg.missDash} / ${dg.hitWalk}|${dg.missWalk}`.padEnd(107) + `   ${per.join(' ').padEnd(34)} ${m('lv')} · ${m('maxSp')} · ${m('dashCharges')} · ${m('dashCooldown')} · ${m('dashDistance')} · ${m('maxHp')}`);
}
if (process.env.BYTAG) {
  const agg: Record<string, [number, number]> = {};
  for (const [j, r] of out) if (j.titan === process.env.BYTAG) for (const [t, v] of Object.entries(r.by)) {
    const [a, b] = v.split('/').map(Number); const k = `${j.boss} LV${j.lv} ${t}`; const x = agg[k] ?? (agg[k] = [0, 0]); x[0] += a; x[1] += b;
  }
  for (const [k, [a, b]] of Object.entries(agg).sort()) console.log(`  ${k.padEnd(34)} ${a}/${b}`);
}
if (process.env.PERSEED) for (const [j, r] of out) if (j.titan === process.env.PERSEED && j.lv === Math.max(...levels))
  console.log(`  ${j.boss.padEnd(9)} seed ${String(j.seed).padStart(3)} ${String(r.hits).padStart(3)}/${String(r.n).padEnd(4)} ${(100 * r.hits / Math.max(1, r.n)).toFixed(0).padStart(3)} %  ${JSON.stringify(r.stats)}`);
