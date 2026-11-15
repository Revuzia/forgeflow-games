// VALE harness — owner rule: nothing a player reads says bots / AI / CPU, and no marker singles out
// computer-controlled seats. Scans the player-facing text sources and the built output.
//
//   node _harness/probe_copy_no_bots.ts
//
// Sources: every string VALUE (never keys) of content/strings.en.json, queues.json, modes.json, client.json,
// ranks.json, store.json; index.html; public/game_meta.json; the UI source string literals handed to cv.t(...);
// dist/ (html + js) player-facing literals; dist-catalog/ json values when present.
// Allow-list: a queue/mode whose kind is 'bots' (an explicit bots game the player picks) may use the words.
// Exit 0 = clean, 1 = a hit.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BANNED = /\b(bots?|a\.?i\.?|cpu|computer[- ]controlled|vs\.? ?(ai|computer)|npcs?)\b/i;
const BANNED_CASE = /\b(AI|CPU)\b|\b[Bb]ots?\b|computer[- ]controlled/;
const hits: string[] = [];

function allowed(node: unknown): boolean { return !!node && typeof node === 'object' && (node as { kind?: string }).kind === 'bots'; }

function walk(v: unknown, path: string, file: string, ok: boolean): void {
  if (typeof v === 'string') { if (!ok && BANNED_CASE.test(v)) hits.push(`${file} ${path}: ${v.slice(0, 120)}`); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${path}[${i}]`, file, ok)); return; }
  if (v && typeof v === 'object') {
    const here = ok || allowed(v);
    for (const [k, x] of Object.entries(v)) {
      if (k === '$comment' || k === 'comment') continue;       // authoring notes never reach a player
      if (k === 'bots' || k === 'ai' || k === 'botNames') continue;   // config keys, not text
      walk(x, `${path}.${k}`, file, here);
    }
  }
}

for (const f of ['content/strings.en.json', 'content/queues.json', 'content/modes.json', 'content/client.json', 'content/ranks.json', 'content/store.json', 'public/game_meta.json']) {
  const p = join(root, f);
  if (existsSync(p)) walk(JSON.parse(readFileSync(p, 'utf8')), '', f, false);
}
{
  const p = join(root, 'index.html');
  if (existsSync(p)) for (const [i, line] of readFileSync(p, 'utf8').split('\n').entries()) if (BANNED_CASE.test(line)) hits.push(`index.html:${i + 1}: ${line.trim().slice(0, 120)}`);
}

// the UI source: any string literal passed to a text lookup
function files(dir: string, ext: RegExp, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) { const p = join(dir, n); const s = statSync(p); if (s.isDirectory()) files(p, ext, out); else if (ext.test(n)) out.push(p); }
  return out;
}
const LIT = /(["'`])((?:\\.|(?!\1)[^\\\n]){2,160})\1/g;
function scanLiterals(file: string, text: string, strict: boolean): void {
  for (const m of text.matchAll(LIT)) {
    const s = m[2]!;
    if (!BANNED_CASE.test(s) || s.includes('--') || /^bot \$\{/.test(s)) continue;
    const words = s.trim().split(/\s+/);
    const sentence = /^[A-Z]/.test(s) || words.length >= 3 && /[ .,·]/.test(s) && !/^[a-z_]+[:.]/.test(s);
    const exactChip = s === 'Bot' || /^Bot( |\$\{)/.test(s);
    if (strict ? (sentence || exactChip) : exactChip) hits.push(`${file}: "${s.slice(0, 100)}"`);
  }
}
for (const f of files(join(root, 'src/ui'), /\.(tsx?|css)$/)) {
  const t = readFileSync(f, 'utf8');
  // only strings the player can read: second argument of cv.t(key, 'fallback') and JSX text
  for (const m of t.matchAll(/cv\.t\(\s*'[^']*'\s*,\s*(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g)) if (BANNED_CASE.test(m[2]!)) hits.push(`${f.replace(root + '/', '')}: fallback "${m[2]!.slice(0, 100)}"`);
}
scanLiterals('src/session/setup.ts', readFileSync(join(root, 'src/session/setup.ts'), 'utf8').split('\n').filter((l) => /\?\?\s*`/.test(l)).join('\n'), false);

const ver = (JSON.parse(readFileSync(join(root, 'content/version.json'), 'utf8')) as { version: string }).version;   // older built catalogs are history
for (const f of [...files(join(root, 'dist'), /\.(html|js)$/), ...files(join(root, 'dist-catalog'), /\.json$/).filter((x) => x.includes(`/${ver}/`))]) {
  const rel = f.replace(root + '/', '');
  const t = readFileSync(f, 'utf8');
  if (rel.endsWith('.json')) { try { walk(JSON.parse(t), '', rel, false); } catch { /* not json */ } continue; }
  if (rel.endsWith('.html')) { for (const [i, line] of t.split('\n').entries()) if (BANNED_CASE.test(line.replace(/<script[\s\S]*?<\/script>/g, ''))) hits.push(`${rel}:${i + 1}`); continue; }
  scanLiterals(rel, t, true);
}

if (hits.length) { console.log(`probe_copy_no_bots: FAIL (${hits.length})`); for (const h of hits.slice(0, 60)) console.log('  ' + h); process.exit(1); }
console.log('probe_copy_no_bots: ok');
