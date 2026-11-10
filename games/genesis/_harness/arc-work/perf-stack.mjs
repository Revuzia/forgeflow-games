// PERF lane: who calls a hot function in a .cpuprofile — node perf-stack.mjs file.cpuprofile fnName [depth]
import { readFileSync } from 'node:fs';
const [file, fn, depthS] = process.argv.slice(2);
const depth = Number(depthS ?? 8);
const prof = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map(prof.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const per = prof.timeDeltas.reduce((a, b) => a + b, 0) / prof.samples.length / 1000;
const cnt = new Map(); for (const s of prof.samples) cnt.set(s, (cnt.get(s) || 0) + 1);
const chains = new Map();
for (const [id, c] of cnt) {
  const n = byId.get(id);
  if (n.callFrame.functionName !== fn) continue;
  const ch = []; let p = parent.get(id);
  while (p != null && ch.length < depth) { const cf = byId.get(p).callFrame; ch.push(`${cf.functionName || '(anon)'}:${cf.lineNumber + 1}`); p = parent.get(p); }
  const k = ch.join(' < ');
  chains.set(k, (chains.get(k) || 0) + c * per);
}
for (const [k, v] of [...chains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(v.toFixed(1).padStart(8), 'ms', k);
