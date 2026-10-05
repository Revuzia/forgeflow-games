// BLOCKTOOTH — determinism ban (ONLINE_PLAN gate H3, lane B-DET). Part of `npm run check`.
//
//   node _harness/detban.ts              # scan the sim; exit 0 = clean, 1 = violations (listed), 2 = scanner error
//   node _harness/detban.ts --list       # also print every scanned file
//   node _harness/detban.ts --selftest   # prove the scanner catches every banned form (exit 0 = it does)
//
// Online VS runs the whole sim on every peer in lockstep (netcode.md §7.1), so the sim must compute the same bits in
// every JS engine. The ECMAScript spec lets engines approximate Math.sin/cos/tan/atan2/exp/log/pow/hypot/... and the
// `**` operator their own way (Chromium/Firefox/WebKit differ from Node: netcode.md §6.4), Math.random and clocks are
// not reproducible at all, and locale APIs depend on the machine. The sim uses src/core/detmath.ts instead.
//
// What is scanned (the "sim"): every module reachable through value imports (not `import type`) from the sim roots —
// src/core/world.ts (createWorld / stepWorld), src/upgrades/draft.ts (the draft path), the harness bots
// _harness/bot*.ts, and every .ts under src/vs/ (the VS rules + VS bot, Phase B) — so a new sim module is covered the
// moment the sim imports it. src/core/detmath.ts itself is exempt (it is the one place allowed to build on Math).
//
// What is banned in code (comments and string literals are ignored):
//   * any `Math` member except the exact ones: sqrt abs floor ceil round trunc sign min max imul fround clz32 and the
//     constants PI E LN2 LN10 LOG2E LOG10E SQRT2 SQRT1_2 (so Math.sin(...), Math.random(), Math['sin'], `const { sin }
//     = Math`, passing `Math` around are all flagged)
//   * the `**` / `**=` operator (Number::exponentiate is implementation-approximated, same as Math.pow)
//   * clocks: Date.now, new Date, Date(), performance.*, process.hrtime
//   * other non-reproducible sources: crypto.*, localeCompare, toLocale*String, Intl.*
//
// Harness code (not sim): node:fs is used to read sources.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DETMATH = resolve(ROOT, 'src/core/detmath.ts');

const ALLOWED_MATH = new Set(['sqrt', 'abs', 'floor', 'ceil', 'round', 'trunc', 'sign', 'min', 'max', 'imul', 'fround', 'clz32',
  'PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2']);

interface Violation { file: string; line: number; col: number; what: string; text: string }

/** Replace comments and the literal parts of strings / templates with spaces (newlines kept, so positions hold).
 *  `${...}` inside templates stays code. Regex literals are not special-cased (the sim does not use any with quotes). */
export function stripCode(src: string): string {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  const tplDepth: number[] = [];     // brace depth at which each open template's ${ started
  let brace = 0;
  const blank = (a: number, b: number) => { for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  const scanTemplate = (): void => {  // i at the char after ` (or after the } closing a ${ })
    while (i < n) {
      const c = src[i];
      if (c === '\\') { blank(i, i + 2); i += 2; continue; }
      if (c === '`') { i++; return; }
      if (c === '$' && src[i + 1] === '{') { tplDepth.push(brace); brace++; i += 2; return; }
      blank(i, i + 1); i++;
    }
  };
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? n : e; blank(i, end); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? n : e + 2; blank(i, end); i = end; continue; }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      blank(i + 1, j); i = j + 1; continue;
    }
    if (c === '`') { i++; scanTemplate(); continue; }
    if (c === '{') { brace++; i++; continue; }
    if (c === '}') {
      brace--;
      if (tplDepth.length && tplDepth[tplDepth.length - 1] === brace) { tplDepth.pop(); i++; scanTemplate(); continue; }
      i++; continue;
    }
    i++;
  }
  return out.join('');
}

const RULES: { re: RegExp; what: (m: RegExpExecArray) => string | null }[] = [
  { re: /\bMath\b(\s*\.\s*([A-Za-z_$][\w$]*))?/g, what: (m) => (m[2] && ALLOWED_MATH.has(m[2]) ? null : (m[2] ? `Math.${m[2]} (use src/core/detmath.ts)` : 'bare Math reference')) },
  { re: /\*\*=?/g, what: () => '`**` operator (use detmath pow or plain multiplication)' },
  { re: /\bDate\s*\.\s*now\b|\bnew\s+Date\b|\bDate\s*\(/g, what: () => 'clock (Date)' },
  { re: /\bperformance\s*\./g, what: () => 'clock (performance.*)' },
  { re: /\bprocess\s*\.\s*hrtime\b/g, what: () => 'clock (process.hrtime)' },
  { re: /\bcrypto\s*\./g, what: () => 'crypto randomness' },
  { re: /\blocaleCompare\b|\btoLocale\w*String\b|\bIntl\s*\./g, what: () => 'locale-dependent API' },
];

export function scanSource(file: string, src: string): Violation[] {
  const code = stripCode(src);
  const lines = src.split('\n');
  const starts: number[] = [0];
  for (let k = 0; k < src.length; k++) if (src[k] === '\n') starts.push(k + 1);
  const lineOf = (pos: number) => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= pos) lo = mid; else hi = mid - 1; } return lo; };
  const v: Violation[] = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = r.re.exec(code))) {
      const what = r.what(m);
      if (!what) continue;
      const ln = lineOf(m.index);
      v.push({ file, line: ln + 1, col: m.index - starts[ln] + 1, what, text: (lines[ln] ?? '').trim().slice(0, 140) });
    }
  }
  return v.sort((a, b) => a.line - b.line || a.col - b.col);
}

/** value-import specifiers of a module (skips `import type` / `export type`) */
function valueImports(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const out: string[] = [];
  const re = /\b(import|export)\s+(type\s+)?(?:[^'";]*?\bfrom\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) { if (m[2]) continue; out.push(m[3] ?? m[4]); }
  return out;
}

function walkTs(dir: string, acc: string[]): void {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkTs(p, acc); else if (p.endsWith('.ts')) acc.push(p);
  }
}

export function simFiles(): string[] {
  const roots = [resolve(ROOT, 'src/core/world.ts'), resolve(ROOT, 'src/upgrades/draft.ts')];
  for (const e of readdirSync(resolve(ROOT, '_harness'))) if (/^bot.*\.ts$/.test(e)) roots.push(resolve(ROOT, '_harness', e));
  walkTs(resolve(ROOT, 'src/vs'), roots);
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    if (!existsSync(f)) throw new Error(`missing module ${relative(ROOT, f)}`);
    seen.add(f);
    for (const s of valueImports(readFileSync(f, 'utf8'))) {
      if (!s.startsWith('.')) continue;                 // packages: a sim module importing one is caught below
      let t = resolve(dirname(f), s);
      if (!existsSync(t) && existsSync(t + '.ts')) t += '.ts';
      stack.push(t);
    }
  }
  return [...seen].filter((f) => f !== DETMATH).sort();
}

function selftest(): number {
  const cases: [string, number][] = [
    ['const a = Math.sin(x);', 1], ['const a = Math.cos(x) + Math.atan2(y, x);', 2], ['Math.random()', 1],
    ['const r = Math [ "hypot" ](a, b);', 1], ['const { sin } = Math;', 1], ['f(Math)', 1], ['x ** 2', 1], ['x **= 2', 1],
    ['Date.now()', 1], ['new Date()', 1], ['performance.now()', 1], ['crypto.getRandomValues(a)', 1], ['a.localeCompare(b)', 1],
    ['n.toLocaleString()', 1], ['Intl.NumberFormat()', 1], ['process.hrtime()', 1], ['`${Math.pow(a, b)}`', 1],
    // must NOT be flagged
    ['const a = Math.sqrt(x) + Math.abs(y) + Math.floor(z) + Math.min(1, 2) + Math.PI + Math.imul(a, b);', 0],
    ['// Math.sin in a comment', 0], ['/** x ** 2 and Date.now() in a doc comment */', 0], ['const s = "Math.random() in a string";', 0],
    ['const t = `Math.sin ${a + b} text`;', 0], ['const k = sin(x) * cos(y);', 0], ['/* a\n Math.exp(1) */ const b = 1;', 0],
  ];
  let bad = 0;
  for (const [src, want] of cases) {
    const got = scanSource('selftest', src).length;
    const ok = got === want;
    if (!ok) bad++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${JSON.stringify(src)} -> ${got} violation(s), want ${want}`);
  }
  console.log(bad ? `selftest: ${bad} FAILED` : `selftest: all ${cases.length} cases OK`);
  return bad ? 1 : 0;
}

function main(): number {
  const argv = process.argv.slice(2);
  if (argv.includes('--selftest')) return selftest();
  let files: string[];
  try { files = simFiles(); } catch (e) { console.error('detban: could not resolve the sim modules:', (e as Error).message); return 2; }
  const all: Violation[] = [];
  const pkgs: string[] = [];
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const rel = relative(ROOT, f).split(sep).join('/');
    all.push(...scanSource(rel, src));
    for (const s of valueImports(src)) if (!s.startsWith('.') && !s.startsWith('node:')) pkgs.push(`${rel}: imports package '${s}' (the sim is THREE-free / DOM-free)`);
    if (argv.includes('--list')) console.log('  scan ' + rel);
  }
  for (const v of all) console.log(`${v.file}:${v.line}:${v.col}  ${v.what}\n    ${v.text}`);
  for (const p of pkgs) console.log(p);
  const n = all.length + pkgs.length;
  console.log(n ? `detban: FAIL — ${n} violation(s) in ${files.length} sim files` : `detban: PASS — ${files.length} sim files, no browser-dependent maths, Math.random, clocks or locale APIs`);
  return n ? 1 : 0;
}

process.exit(main());
