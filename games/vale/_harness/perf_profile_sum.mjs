// VALE harness — W4-C: summarise a perf_load --cpuprofile file. Finds every main-thread busy run (consecutive samples
// that are not idle, gaps under 4 ms) over --min ms (default 150) and prints, per run, the inclusive time of the
// heaviest functions inside it (a build made with `vite build --minify false` gives readable names).
//   node _harness/perf_profile_sum.mjs <profile.json> [--min 150] [--top 25]
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const { profile } = JSON.parse(readFileSync(args[0], 'utf8'));
const MIN = Number(opt('min', 150)), TOP = Number(opt('top', 25));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const key = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
const idle = (n) => n.callFrame.functionName === '(idle)' || n.callFrame.functionName === '(program)';
let t = profile.startTime;
const samples = profile.samples.map((id, i) => { t += profile.timeDeltas[i] ?? 0; return { id, t }; });
const runs = [];
let cur = null;
for (let i = 0; i < samples.length; i++) {
  const s = samples[i], n = byId.get(s.id);
  const busy = !idle(n);
  if (busy) {
    if (cur && s.t - cur.last <= 4000) { cur.last = s.t; cur.ids.push(i); }
    else { if (cur) runs.push(cur); cur = { first: s.t, last: s.t, ids: [i] }; }
  }
}
if (cur) runs.push(cur);
const long = runs.filter((r) => (r.last - r.first) / 1000 >= MIN);
console.log(`${runs.length} busy runs, ${long.length} over ${MIN} ms`);
for (const r of long) {
  const incl = new Map(), self = new Map();
  for (const i of r.ids) {
    const dt = (samples[i + 1]?.t ?? samples[i].t) - samples[i].t;
    const n = byId.get(samples[i].id);
    self.set(key(n), (self.get(key(n)) ?? 0) + dt);
    const seen = new Set();
    for (let p = samples[i].id; p !== undefined; p = parent.get(p)) { const k = key(byId.get(p)); if (seen.has(k)) continue; seen.add(k); incl.set(k, (incl.get(k) ?? 0) + dt); }
  }
  console.log(`\n=== run at ${((r.first - profile.startTime) / 1e6).toFixed(2)} s, ${((r.last - r.first) / 1000).toFixed(0)} ms`);
  for (const [k, v] of [...incl].filter(([k]) => !k.startsWith('(root)')).sort((a, b) => b[1] - a[1]).slice(0, TOP)) console.log(`  ${(v / 1000).toFixed(0).padStart(5)} ms  ${k}`);
  console.log('  -- self');
  for (const [k, v] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 10)) console.log(`  ${(v / 1000).toFixed(0).padStart(5)} ms  ${k}`);
}
