// node s27-heap.mjs FILE.heapsnapshot : self size by node type and by constructor name (top 40)
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const m = s.snapshot.meta, nf = m.node_fields.length, N = s.nodes, S = s.strings;
const ti = m.node_fields.indexOf('type'), ni = m.node_fields.indexOf('name'), si = m.node_fields.indexOf('self_size');
const types = m.node_types[0];
const byT = new Map(), byN = new Map();
for (let i = 0; i < N.length; i += nf) {
  const t = types[N[i + ti]], n = S[N[i + ni]], z = N[i + si];
  byT.set(t, (byT.get(t) ?? 0) + z);
  const k = t + ':' + (t === 'string' || t === 'concatenated string' ? '(strings)' : n.slice(0, 60));
  const e = byN.get(k) ?? [0, 0]; e[0] += z; e[1]++; byN.set(k, e);
}
const mb = (b) => (b / 1048576).toFixed(1);
console.log('BY TYPE', [...byT].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${mb(v)}`).join(' | '));
console.log('TOP', [...byN].sort((a, b) => b[1][0] - a[1][0]).slice(0, 40).map(([k, v]) => `${k} ${mb(v[0])}MB x${v[1]}`).join('\n'));
