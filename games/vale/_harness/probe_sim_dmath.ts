// VALE probe — cross-engine determinism of the sim's math (online lockstep needs the same bits on every
// browser). src/sim may use only IEEE-exact operations: + − × ÷, Math.sqrt / floor / round / abs / min /
// max / sign / trunc, and the polynomials in src/sim/dmath.ts — never Math.sin / cos / tan / atan / atan2
// / asin / acos / hypot / exp / log / pow, the `**` operator, or Math.random / Date.now.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dasin, datan2, dcos, dhypot, dsin } from '../src/sim/dmath.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'sim');
const BANNED = /Math\.(sin|cos|tan|atan|atan2|asin|acos|hypot|exp|expm1|log|log2|log10|log1p|pow|cbrt|sinh|cosh|tanh|random)\b|Date\.now|performance\.now|[\w)\]]\s*\*\*\s*[0-9(a-zA-Z]/;
let fails = 0, files = 0;
const walk = (d: string): void => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!p.endsWith('.ts') || p.endsWith('dmath.ts')) continue;
    files++;
    readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/\/\*.*$/, '');
      if (/^\s*\*/.test(line)) return;                              // doc comment body
      if (BANNED.test(code)) { fails++; console.log(`FAIL ${relative(ROOT, p)}:${i + 1}: ${line.trim().slice(0, 120)}`); }
    });
  }
};
walk(ROOT);
// accuracy of the replacements against the platform (within 1e-12 on gameplay ranges)
let err = 0;
for (let i = 0; i < 20000; i++) {
  const x = (i / 20000 - 0.5) * 40, y = Math.cos(i) * 3, z = Math.sin(i * 0.7) * 2;
  err = Math.max(err, Math.abs(dsin(x) - Math.sin(x)), Math.abs(dcos(x) - Math.cos(x)), Math.abs(datan2(y, z) - Math.atan2(y, z)),
    Math.abs(dasin(Math.sin(x) * 0.999) - Math.asin(Math.sin(x) * 0.999)), Math.abs(dhypot(y, z) - Math.hypot(y, z)));
}
if (err > 1e-12) { fails++; console.log(`FAIL dmath accuracy ${err}`); }
console.log(`${fails ? 'FAIL' : 'PASS'} probe_sim_dmath: ${files} sim files scanned, max error ${err.toExponential(2)}`);
process.exit(fails ? 1 : 0);
