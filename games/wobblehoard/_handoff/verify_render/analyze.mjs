// node analyze.mjs <out/flash_*.json> : transition times (global 0.04 / 0.02, each 3x3 cell at WCAG 0.1) next to the beats; plus an SVG plot.
import { readFileSync, writeFileSync } from 'node:fs';
import { zigzag, zigzagRel } from './common.mjs';
const f = process.argv[2];
const d = JSON.parse(readFileSync(f, 'utf8'));
const dt = 1 / 60, pre = 6;
const t = (k) => +((k - pre) * dt).toFixed(3);
console.log('beats', d.beats.map((b) => `${b.beat}@${b.t.toFixed(2)}`).join(' '));
console.log('global@0.04', zigzag(d.L, 0.04).map(t).join(' '), '| @0.02', zigzag(d.L, 0.02).map(t).join(' '));
for (let c = 0; c < 9; c++) { const C = d.g9.map((x) => x[c]); const z = zigzagRel(C, 0.1); if (z.length) console.log(`cell ${c} WCAG0.1`, z.map(t).join(' '), `range ${Math.min(...C).toFixed(3)}..${Math.max(...C).toFixed(3)}`); }
// plot
const W = 900, H = 260, n = d.L.length, mx = Math.max(...d.L, ...d.g9.flat()) * 1.05;
const path = (arr, col) => `<polyline fill="none" stroke="${col}" stroke-width="1.5" points="${arr.map((v, i) => `${(i / (n - 1)) * W},${H - (v / mx) * H}`).join(' ')}"/>`;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + 20}"><rect width="100%" height="100%" fill="#111"/>`;
svg += path(d.g9.map((x) => x[4]), '#c84') + path(d.g9.map((x) => x[1]), '#48c') + path(d.L, '#fff') + path(d.light.map((v) => v), '#f4f');
for (const b of d.beats) { const x = ((b.t / dt + pre) / (n - 1)) * W; svg += `<line x1="${x}" x2="${x}" y1="0" y2="${H}" stroke="#666"/><text x="${x + 2}" y="${H + 14}" fill="#aaa" font-size="11">${b.beat}</text>`; }
svg += `<text x="4" y="14" fill="#fff" font-size="12">${f.split('/').pop()} white=global mean L, orange=centre cell, blue=top-middle cell, magenta=screen light alpha; max ${mx.toFixed(3)}</text></svg>`;
writeFileSync(f.replace('.json', '.svg'), svg);
