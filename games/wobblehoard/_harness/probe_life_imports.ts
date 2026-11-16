// LF-12 (LIFE.md L1): src/life/** is pure. It imports only ./, ../core/, ../data/ and ../contracts.ts (types); no DOM, three, physics,
// render, audio or shell; no Date.now, performance.now, Math.random, setTimeout, setInterval, requestAnimationFrame, AudioContext, musicClock;
// no fingerDown, grab or lock call (LF-05), no moveTo (D-63). Also: every module loads first in a fresh node process (no import cycle trap).
// Run: node _harness/probe_life_imports.ts   (exit 1 on any failure)
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const LIFE = resolve(here, '../src/life');
let fails = 0;
const check = (id: string, what: string, ok: boolean, detail = ''): void => {
  if (!ok) fails++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}${detail ? `: ${detail}` : ''}`);
};

const files = readdirSync(LIFE).filter((f) => f.endsWith('.ts')).sort();
check('LF-12', 'src/life has modules', files.length >= 8, files.join(', '));
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
const bad: string[] = [];
const FORBID = /\b(Date\.now|performance\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame|AudioContext|musicClock|document\.|window\.|globalThis\.|fingerDown|grabStart|grabMove|lockLobe|\.lock\(|moveTo\s*\()/;
for (const f of files) {
  const src = readFileSync(join(LIFE, f), 'utf8'), code = strip(src);
  for (const m of code.matchAll(/\b(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1], typeOnly = /^\s*(?:import|export)\s+type\b/.test(m[0]);
    const okPath = spec.startsWith('./') ? !spec.slice(2).includes('/') : spec.startsWith('../core/') || spec.startsWith('../data/') || (spec === '../contracts.ts' && typeOnly);
    if (!okPath) bad.push(`${f}: ${m[0].trim()}`);
  }
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)) bad.push(`${f}: dynamic import ${m[1]}`);
  for (const m of code.matchAll(/\brequire\s*\(/g)) bad.push(`${f}: require ${m.index}`);
  const line = code.split('\n').find((l) => FORBID.test(l));
  if (line) bad.push(`${f}: forbidden: ${line.trim().slice(0, 100)}`);
}
check('LF-12', 'every import is ./, ../core/, ../data/ or a type-only ../contracts.ts; no clock, no Math.random, no DOM, no timer, no musicClock', bad.length === 0, bad.join(' | '));
check('LF-05', 'no fingerDown, grab, lock or moveTo call anywhere in src/life (autonomy never pays; LIFE travels by scootTo)', !bad.some((b) => /fingerDown|grab|lock|moveTo/.test(b)), '');
// the data LIFE imports must itself be pure enough for the life chunk: no ../shell, ../render, ../audio, ../physics in what it reaches
const reach = new Set<string>(), queue = files.map((f) => join(LIFE, f));
while (queue.length) {
  const p = queue.pop() as string;
  if (reach.has(p)) continue;
  reach.add(p);
  const code = strip(readFileSync(p, 'utf8'));
  for (const m of code.matchAll(/\b(?:import|export)\s(?!type\b)[^'"`;]*?from\s*['"](\.[^'"]+)['"]/g)) queue.push(resolve(dirname(p), m[1]));
}
const outside = [...reach].filter((p) => /src[\\/](shell|render|audio|physics|ui|input|collection)[\\/]/.test(p));
check('LF-12', `the value-import closure of src/life (${reach.size} modules) reaches no shell, render, audio, physics, ui, input or collection module`, outside.length === 0, outside.join(', '));
// every module loads first in a fresh node (a cycle would throw a TDZ error)
for (const f of files) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify('file://' + join(LIFE, f))});`], { encoding: 'utf8' });
  if (r.status !== 0) { check('LF-12', `${f} loads first in a fresh node process`, false, (r.stderr || '').split('\n').slice(0, 3).join(' ')); }
}
check('LF-12', `every src/life module loads first in a fresh node process (${files.length})`, true);
console.log(fails ? `\n${fails} failure(s)` : '\nall LF-12 rows ok');
process.exit(fails ? 1 : 0);
