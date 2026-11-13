import * as D from './detmath.ts';
let s = 7; const r = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const tests: [string, (x: number, y: number) => number, (x: number, y: number) => number, () => [number, number]][] = [
  ['sin', x => D.dsin(x), x => Math.sin(x), () => [(r() - 0.5) * 200, 0]],
  ['cos', x => D.dcos(x), x => Math.cos(x), () => [(r() - 0.5) * 200, 0]],
  ['tan', x => D.dtan(x), x => Math.tan(x), () => [(r() - 0.5) * 3, 0]],
  ['atan2', (x, y) => D.datan2(y, x), (x, y) => Math.atan2(y, x), () => [(r() - 0.5) * 2000, (r() - 0.5) * 2000]],
  ['asin', x => D.dasin(x), x => Math.asin(x), () => [(r() - 0.5) * 2, 0]],
  ['exp', x => D.dexp(x), x => Math.exp(x), () => [(r() - 0.5) * 60, 0]],
  ['log', x => D.dlog(x), x => Math.log(x), () => [r() * 1e6 + 1e-9, 0]],
  ['pow', (x, y) => D.dpow(x, y), (x, y) => Math.pow(x, y), () => [r() * 50, (r() - 0.5) * 6]],
  ['hypot', (x, y) => D.dhypot(x, y), (x, y) => Math.hypot(x, y), () => [(r() - 0.5) * 2000, (r() - 0.5) * 2000]],
];
for (const [n, d, m, g] of tests) {
  let worst = 0, diff = 0; const N = 200000;
  for (let i = 0; i < N; i++) { const [x, y] = g(); const a = d(x, y), b = m(x, y); const e = Math.abs(a - b) / Math.max(1e-300, Math.abs(b)); if (a !== b) diff++; if (e > worst) worst = e; }
  console.log(n.padEnd(6), 'max rel err', worst.toExponential(2), ' bits-differ-from-V8', (100 * diff / N).toFixed(1) + '%');
}
