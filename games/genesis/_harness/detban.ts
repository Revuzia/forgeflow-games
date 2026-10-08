// GENESIS — determinism ban (CONTRACT.md §6.1, §19). Part of `npm run check`.
//
//   node _harness/detban.ts            # scan src/sim/**; exit 0 = clean, 1 = violations
//   node _harness/detban.ts --selftest # prove the scanner catches every banned form
//
// The sim must give the same state hash for the same seed + command log. Clocks, Math.random, crypto, locale APIs and
// rendering/DOM imports are banned in src/sim/**. src/sim/worker.ts is the one host file allowed to use timers and
// postMessage (it paces the sim; it never feeds time into it).

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIM = resolve(ROOT, 'src/sim');
const HOST_FILES = new Set(['worker.ts']);

const BANNED: { re: RegExp; what: string; hostOk?: boolean }[] = [
  { re: /\bMath\s*\.\s*random\b/, what: 'Math.random' },
  { re: /\bDate\s*\.\s*now\b/, what: 'Date.now' },
  { re: /\bnew\s+Date\b/, what: 'new Date' },
  { re: /(^|[^.\w])Date\s*\(/, what: 'Date()' },
  { re: /\bperformance\s*\./, what: 'performance.*', hostOk: true },
  { re: /\bcrypto\s*\./, what: 'crypto.*' },
  { re: /\blocaleCompare\b/, what: 'localeCompare' },
  { re: /\btoLocale\w*String\b/, what: 'toLocale*String' },
  { re: /\bIntl\s*\./, what: 'Intl.*' },
  { re: /\bprocess\s*\.\s*hrtime\b/, what: 'process.hrtime' },
  { re: /\bset(Timeout|Interval|Immediate)\s*\(/, what: 'timers', hostOk: true },
  { re: /\brequestAnimationFrame\b/, what: 'requestAnimationFrame' },
  { re: /\b(document|window)\s*\./, what: 'DOM' },
  { re: /from\s+['"]three['"/]/, what: 'three.js import' },
  { re: /from\s+['"][./]*\.\.\/(render|ui|audio|client)\//, what: 'render/ui/audio/client import' },
];

/** blank comments and string/template literal text (keeps ${} code and line structure) */
export function stripCode(src: string): string {
  const out = src.split('');
  const n = src.length;
  const blank = (a: number, b: number) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  const tpl: number[] = [];
  let brace = 0;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      blank(i + 1, j); i = j + 1; continue;
    }
    if (c === '`' || (c === '}' && tpl.length && tpl[tpl.length - 1] === brace - 1)) {
      if (c === '}') { tpl.pop(); brace--; }
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { blank(j, j + 2); j += 2; continue; }
        if (src[j] === '`') { j++; break; }
        if (src[j] === '$' && src[j + 1] === '{') { tpl.push(brace); brace++; j += 2; break; }
        if (src[j] !== '\n') out[j] = ' ';
        j++;
      }
      i = j; continue;
    }
    if (c === '{') brace++;
    else if (c === '}') brace--;
    i++;
  }
  return out.join('');
}

function walk(dir: string, acc: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (p.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

export function scanText(file: string, text: string): string[] {
  const host = HOST_FILES.has(file.split(/[\\/]/).pop()!);
  const code = stripCode(text).split('\n');
  const raw = text.split('\n');
  const out: string[] = [];
  for (let ln = 0; ln < code.length; ln++) {
    for (const b of BANNED) {
      if (host && b.hostOk) continue;
      // imports are matched on the raw line (module specifiers are strings)
      const line = b.what.includes('import') ? raw[ln] : code[ln];
      if (b.re.test(line)) out.push(`${file}:${ln + 1}: ${b.what}: ${raw[ln].trim()}`);
    }
  }
  return out;
}

if (process.argv.includes('--selftest')) {
  const bad = [
    'const x = Math.random();', 'Date.now()', 'new Date()', 'const t = performance.now()', 'crypto.getRandomValues(a)',
    "a.localeCompare(b)", 'setTimeout(f, 1)', "import * as T from 'three';", 'document.body', "import { x } from '../render/y.ts';",
  ];
  let ok = true;
  for (const s of bad) if (scanText('x.ts', s).length === 0) { console.error('selftest MISSED:', s); ok = false; }
  const good = ['// Math.random() in a comment', "const s = 'Date.now()';", 'const r = rng.float();', 'const d = data.random;'];
  for (const s of good) if (scanText('x.ts', s).length !== 0) { console.error('selftest FALSE POSITIVE:', s); ok = false; }
  console.log(ok ? 'detban selftest OK' : 'detban selftest FAILED');
  process.exit(ok ? 0 : 1);
}

const files = walk(SIM, []);
const violations: string[] = [];
for (const f of files) violations.push(...scanText(relative(ROOT, f), readFileSync(f, 'utf8')));
if (violations.length) {
  console.error(`detban: ${violations.length} violation(s) in src/sim:`);
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log(`detban: ${files.length} sim files clean`);
