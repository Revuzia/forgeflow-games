// Import rules of _spec/COLLECTION.md 3.2 (acceptance test C10), checked over the WHOLE src tree (plain node, exits 1 on failure):
//   1. src/collection/** imports only ./*.ts (itself), ../core/*.ts, ../data/*.ts and ../contracts.ts, and contracts.ts only with
//      `import type` / `export type` (a value import would pull the lanes' runtime in). Never three, physics, render, audio, ui, input, a
//      package or a node: module. Relative imports end in .ts.
//   2. rollCapsule and rollMerge appear on the client only in src/collection/ghost.ts: anywhere else in src (code, not comments) is a
//      failure, except their definitions in src/core/drops.ts and src/core/merge.ts (core is shared with the server host).
//   3. src/collection/** reads no clock and no random source except the injected defaults in index.ts (Date.now, Math.random), and touches
//      no DOM or network global (window, document, localStorage, navigator, postMessage, fetch, XMLHttpRequest, WebSocket, sendBeacon...).
//   4. MERGE_COST is imported from src/core/merge.ts, never defined or re-typed in src/collection.
//   5. src/ui/hoard/** (when it exists: SHELL lane) imports only collection/*, ui/dom.ts, ui/theme.ts and contracts.ts types.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve, sep } from 'node:path';

let bad = 0;
let total = 0;
const check = (id: string, name: string, ok: boolean, extra = ''): void => { total++; if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${name}${extra ? '  ' + extra : ''}`); };

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, '../src');
const rel = (f: string): string => relative(SRC, f).split(sep).join('/');
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|mts|js|mjs)$/.test(n) ? [p] : []; });
const files = walk(SRC);

/** Source with comments removed (strings and template literals kept, so a string still counts). Regex literals are not special-cased. */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let q: string | null = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (q) {
      out += c;
      if (c === '\\') { out += n ?? ''; i += 2; continue; }
      if (c === q) q = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') out += '\n'; i++; } i += 2; continue; }
    out += c;
    i++;
  }
  return out;
}

interface Imp { spec: string; typeOnly: boolean; text: string }
function importsOf(code: string): Imp[] {
  const out: Imp[] = [];
  const re = /(^|[;\n}])\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*(['"])([^'"]+)\5/g;
  for (let m = re.exec(code); m; m = re.exec(code)) {
    const head = m[4];
    if (m[2] === 'export' && !/^(\*|\{|type\b)/.test(head.trim()) && !m[3]) continue; // `export const x = ... from` cannot happen; be strict otherwise
    out.push({ spec: m[6], typeOnly: !!m[3], text: m[0].trim() });
  }
  const side = /(^|[;\n])\s*import\s*(['"])([^'"]+)\2/g;
  for (let m = side.exec(code); m; m = side.exec(code)) out.push({ spec: m[3], typeOnly: false, text: m[0].trim() });
  const dyn = /\bimport\s*\(\s*(['"`])([^'"`]+)\1\s*\)/g;
  for (let m = dyn.exec(code); m; m = dyn.exec(code)) out.push({ spec: m[2], typeOnly: false, text: m[0].trim() });
  return out;
}

const collection = files.filter((f) => rel(f).startsWith('collection/'));
check('I00', 'src/collection exists and holds TypeScript files', collection.length >= 8, `${collection.length} files`);

// 1. what src/collection may import
const ALLOWED = [/^\.\/[A-Za-z0-9_]+\.ts$/, /^\.\.\/core\/[A-Za-z0-9_]+\.ts$/, /^\.\.\/data\/[A-Za-z0-9_]+\.ts$/, /^\.\.\/contracts\.ts$/];
const badImports: string[] = [];
const contractsValue: string[] = [];
let importCount = 0;
for (const f of collection) {
  const code = stripComments(readFileSync(f, 'utf8'));
  for (const imp of importsOf(code)) {
    importCount++;
    if (!ALLOWED.some((r) => r.test(imp.spec))) badImports.push(`${rel(f)}: ${imp.spec}`);
    if (imp.spec === '../contracts.ts' && !imp.typeOnly) contractsValue.push(`${rel(f)}: ${imp.text.replace(/\s+/g, ' ')}`);
  }
}
check('I01', 'src/collection/** imports only ./*.ts, ../core/*.ts, ../data/*.ts and ../contracts.ts (no three, physics, render, audio, ui, input, package or node: module; every relative import ends in .ts)',
  badImports.length === 0 && importCount > 0, badImports.length ? badImports.join(' | ') : `${importCount} imports`);
check('I02', 'src/collection imports contracts.ts with `import type` only', contractsValue.length === 0, contractsValue.join(' | '));

// 2. rollCapsule / rollMerge
const ROLL_HOME = new Set(['collection/ghost.ts', 'core/drops.ts', 'core/merge.ts']);
const rollUsers: string[] = [];
for (const f of files) {
  const code = stripComments(readFileSync(f, 'utf8'));
  if (/\b(rollCapsule|rollMerge)\b/.test(code) && !ROLL_HOME.has(rel(f))) rollUsers.push(rel(f));
}
const ghostCode = stripComments(readFileSync(join(SRC, 'collection/ghost.ts'), 'utf8'));
check('I03', 'rollCapsule and rollMerge appear on the client only in collection/ghost.ts (definitions in core/drops.ts and core/merge.ts), scanning every file under src',
  rollUsers.length === 0 && /\brollCapsule\(/.test(ghostCode) && /\brollMerge\(/.test(ghostCode), rollUsers.length ? rollUsers.join(', ') : `${files.length} files scanned`);
const dropsCode = stripComments(readFileSync(join(SRC, 'core/drops.ts'), 'utf8')), mergeCode = stripComments(readFileSync(join(SRC, 'core/merge.ts'), 'utf8'));
check('I03', 'core defines them and does not call them for itself (merge.ts and drops.ts only export the rolls)',
  /export function rollCapsule\(/.test(dropsCode) && /export function rollMerge\(/.test(mergeCode)
  && (dropsCode.match(/\brollCapsule\b/g) ?? []).length === 1 && (mergeCode.match(/\brollMerge\b/g) ?? []).length === 1);

// 3. clocks, randomness, DOM and network globals in src/collection
const FORBIDDEN = ['window', 'document', 'localStorage', 'sessionStorage', 'indexedDB', 'navigator', 'postMessage', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'requestAnimationFrame', 'performance', 'crypto', 'setInterval', 'BroadcastChannel'];
const domHits: string[] = [];
const clockHits: string[] = [];
for (const f of collection) {
  const code = stripComments(readFileSync(f, 'utf8')).replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""'); // strings do not count for globals
  for (const g of FORBIDDEN) if (new RegExp(`(^|[^.\\w$])${g}\\b`).test(code)) domHits.push(`${rel(f)}: ${g}`);
  const clocks = (code.match(/\b(Date\.now|Math\.random|new Date)\b/g) ?? []).length;
  if (clocks && rel(f) !== 'collection/index.ts') clockHits.push(`${rel(f)} (${clocks})`);
}
const indexCode = stripComments(readFileSync(join(SRC, 'collection/index.ts'), 'utf8'));
const indexClocks = indexCode.match(/\b(Date\.now|Math\.random|new Date)\b/g) ?? [];
check('I04', 'src/collection touches no DOM, storage, network or timer global (window, document, localStorage, navigator, postMessage, fetch, WebSocket, sendBeacon, performance, crypto ...)',
  domHits.length === 0, domHits.join(' | '));
check('I05', 'no clock or random read in src/collection except the two injected defaults in index.ts (`deps.now ?? (() => Date.now())`, `deps.random ?? (() => Math.random())`)',
  clockHits.length === 0 && indexClocks.length === 2 && /deps\.now \?\? \(\(\) => Date\.now\(\)\)/.test(indexCode) && /deps\.random \?\? \(\(\) => Math\.random\(\)\)/.test(indexCode),
  clockHits.length ? clockHits.join(', ') : `${indexClocks.length} in index.ts`);

// 4. MERGE_COST
const costDefs: string[] = [];
const costUsersWithoutImport: string[] = [];
for (const f of collection) {
  const code = stripComments(readFileSync(f, 'utf8'));
  if (/\b(const|let|var)\s+MERGE_COST\b|\bMERGE_COST\s*:\s*number\s*=/.test(code)) costDefs.push(rel(f));
  if (/\bMERGE_COST\b/.test(code) && !importsOf(code).some((i) => i.spec === '../core/merge.ts' && /\bMERGE_COST\b/.test(i.text))) costUsersWithoutImport.push(rel(f));
}
check('I06', 'MERGE_COST is never defined in src/collection; every file that uses it imports it from ../core/merge.ts', costDefs.length === 0 && costUsersWithoutImport.length === 0,
  [...costDefs, ...costUsersWithoutImport].join(', '));

// 5. src/ui/hoard (SHELL lane, planned)
const hoardDir = join(SRC, 'ui/hoard');
const hoard = existsSync(hoardDir) ? files.filter((f) => rel(f).startsWith('ui/hoard/')) : [];
const UI_ALLOWED = [/^\.\.\/\.\.\/collection\/[A-Za-z0-9_]+\.ts$/, /^\.\.\/dom\.ts$/, /^\.\.\/theme\.ts$/, /^\.\.\/\.\.\/contracts\.ts$/, /^\.\/[A-Za-z0-9_]+\.ts$/];
const uiBad: string[] = [];
for (const f of hoard) for (const imp of importsOf(stripComments(readFileSync(f, 'utf8')))) {
  if (!UI_ALLOWED.some((r) => r.test(imp.spec))) uiBad.push(`${rel(f)}: ${imp.spec}`);
  if (imp.spec.endsWith('contracts.ts') && !imp.typeOnly) uiBad.push(`${rel(f)}: contracts.ts as a value`);
}
check('I07', 'src/ui/hoard/** imports only collection/*, ui/dom.ts, ui/theme.ts and contracts.ts types', uiBad.length === 0, hoard.length ? (uiBad.join(' | ') || `${hoard.length} files`) : 'no src/ui/hoard yet (SHELL lane): nothing to check');

// self-test of the scanner on synthetic sources (a probe that cannot fail is not a probe)
const fake = stripComments(`// import x from 'three'\nimport type { A } from '../contracts.ts';\nimport { B } from "../render/stage.ts";\n/* rollMerge */ const s = 'rollMerge';\nexport * from './types.ts';\nconst y = await import('../ui/hud.ts');\nimport '../audio/engine.ts';`);
const fi = importsOf(fake).map((i) => `${i.spec}${i.typeOnly ? ':type' : ''}`).sort().join(',');
check('I08', 'scanner self-test: commented imports are ignored; type, value, re-export, side-effect and dynamic imports are all found; a string still counts for rollMerge',
  fi === '../audio/engine.ts,../contracts.ts:type,../render/stage.ts,../ui/hud.ts,./types.ts' && /\brollMerge\b/.test(fake) && !/three/.test(fake), fi);

console.log(`\n${total - bad}/${total} checks passed`);
process.exit(bad ? 1 : 0);
