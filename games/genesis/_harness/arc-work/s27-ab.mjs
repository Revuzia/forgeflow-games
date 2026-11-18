// node s27-ab.mjs FILE : the ArrayBuffer backing stores of a heap snapshot, grouped by size and by a retainer path
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const m = s.snapshot.meta, nf = m.node_fields.length, ef = m.edge_fields.length, N = s.nodes, E = s.edges, S = s.strings;
const ti = m.node_fields.indexOf('type'), ni = m.node_fields.indexOf('name'), si = m.node_fields.indexOf('self_size'), ci = m.node_fields.indexOf('edge_count');
const eti = m.edge_fields.indexOf('type'), eni = m.edge_fields.indexOf('name_or_index'), eto = m.edge_fields.indexOf('to_node');
const nT = m.node_types[0], eT = m.edge_types[0];
const n = N.length / nf;
const first = new Uint32Array(n + 1); let ec = 0;
for (let i = 0; i < n; i++) { first[i] = ec; ec += N[i * nf + ci]; } first[n] = ec;
// reverse edges: one retainer per node (prefer property / element / context edges over weak / shortcut)
const ret = new Int32Array(n).fill(-1), rname = new Array(n);
for (let i = 0; i < n; i++) for (let e = first[i]; e < first[i + 1]; e++) {
  const t = eT[E[e * ef + eti]]; if (t === 'weak' || t === 'shortcut') continue;
  const to = E[e * ef + eto] / nf; if (ret[to] >= 0) continue;
  ret[to] = i; rname[to] = (t === 'element' || t === 'hidden') ? `[${t}]` : S[E[e * ef + eni]];
}
const nm = (i) => S[N[i * nf + ni]];
const groups = new Map(); const bySize = new Map();
for (let i = 0; i < n; i++) {
  if (nm(i) !== 'system / JSArrayBufferData') continue;
  const sz = N[i * nf + si];
  const k = (sz >= 1 << 20 ? '>=1MB' : sz >= 1 << 16 ? '64k-1M' : sz >= 4096 ? '4k-64k' : '<4k');
  const b = bySize.get(k) ?? [0, 0]; b[0] += sz; b[1]++; bySize.set(k, b);
  if (sz < 4096) continue;
  // chain up from the data node
  let path = [], cur = i, d = 0;
  while (cur >= 0 && d < 40) { const r = ret[cur]; if (r < 0) break; const lab = `${nm(r).slice(0, 24)}.${rname[cur]}`; if (!/^(ArrayBuffer|Float32Array|Uint16Array|Uint32Array|Float64Array|Int32Array|Uint8Array)\./.test(lab) || path.length < 1) path.push(lab); cur = r; d++; }
  const key = path.slice(0, 7).join(' < ');
  const g = groups.get(key) ?? [0, 0, 0]; g[0] += sz; g[1]++; g[2] = Math.max(g[2], sz); groups.set(key, g);
}
const mb = (b) => (b / 1048576).toFixed(1);
console.log('BY SIZE', [...bySize].map(([k, v]) => `${k}: ${mb(v[0])}MB x${v[1]}`).join(' | '));
for (const [k, v] of [...groups].sort((a, b) => b[1][0] - a[1][0]).slice(0, 30)) console.log(`${mb(v[0])}MB x${v[1]} max ${mb(v[2])}  ${k}`);
