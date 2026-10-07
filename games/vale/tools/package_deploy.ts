// VALE — assemble the deploy folder (CONTRACT §3.1): deploy/ = dist/ + dist-catalog/ as deploy/catalog/.
//
//   node tools/package_deploy.ts [--dist <dir>] [--catalog <dir>] [--out <dir>]
//   (npm run build && npm run content first)
//
// deploy/ is what the existing R2 uploader ships. The client finds its catalog at
// ./catalog/manifest.json through public/config.js, so moving the catalog to another CDN later is a
// config.js edit (or ?catalog=), never a rebuild — this tool only stages the default co-located layout.
//
// The folder is rebuilt from scratch each run (a stale catalog version or asset left behind would be
// uploaded and served). Before copying it verifies what a broken deploy would only show in a
// player's browser: index.html exists, the client build carries no content and no source maps, the
// manifest parses, every catalog it lists exists with the sha256 it claims, and every asset ref in
// those catalogs exists in catalog/assets/. Exit 0 ok · 1 verification failed · 2 usage.

import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogManifest } from '../src/contracts/manifest.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

interface Opts { dist: string; catalog: string; out: string }

function parseArgs(argv: string[]): Opts | string {
  const o: Opts = { dist: join(ROOT, 'dist'), catalog: join(ROOT, 'dist-catalog'), out: join(ROOT, 'deploy') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    if ((a === '--dist' || a === '--catalog' || a === '--out') && v) { o[a.slice(2) as keyof Opts] = resolve(v); i++; }
    else if (a === '-h' || a === '--help') return 'usage: node tools/package_deploy.ts [--dist <dir>] [--catalog <dir>] [--out <dir>]';
    else return `unknown or incomplete argument "${a}"`;
  }
  return o;
}

const fmt = (n: number): string => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;
const show = (p: string): string => { const r = relative(ROOT, p); return (r.startsWith('..') ? p : r).replace(/\\/g, '/'); };

function listFiles(dir: string, base = dir): { rel: string; bytes: number }[] {
  const out: { rel: string; bytes: number }[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...listFiles(abs, base));
    else out.push({ rel: relative(base, abs).replace(/\\/g, '/'), bytes: st.size });
  }
  return out;
}

function verify(o: Opts): string[] {
  const errs: string[] = [];
  if (!existsSync(join(o.dist, 'index.html'))) errs.push(`${show(o.dist)}/index.html missing — run \`npm run build\``);
  if (existsSync(join(o.dist, 'catalog'))) errs.push(`${show(o.dist)}/catalog exists — the client build must carry no content (it would collide with deploy/catalog)`);
  if (existsSync(o.dist)) {
    const maps = listFiles(o.dist).filter((f) => f.rel.endsWith('.map'));
    if (maps.length) errs.push(`${maps.length} source map(s) in ${show(o.dist)} (e.g. ${maps[0].rel}) — they embed the full TS source; build with sourcemap: false`);
    if (!existsSync(join(o.dist, 'config.js'))) errs.push(`${show(o.dist)}/config.js missing — public/config.js tells the client where the catalog lives`);
  }
  const manifestFile = join(o.catalog, 'manifest.json');
  if (!existsSync(manifestFile)) { errs.push(`${show(manifestFile)} missing — run \`npm run content\``); return errs; }
  let m: CatalogManifest;
  try { m = JSON.parse(readFileSync(manifestFile, 'utf8')) as CatalogManifest; } catch (e) { errs.push(`${show(manifestFile)}: ${(e as Error).message}`); return errs; }
  if (m.format !== 1 || !m.schemas || Object.keys(m.schemas).length === 0) { errs.push(`${show(manifestFile)}: no schemas listed`); return errs; }
  for (const [schema, entry] of Object.entries(m.schemas)) {
    const file = join(o.catalog, entry.catalog);
    if (!existsSync(file)) { errs.push(`schema ${schema}: ${entry.catalog} missing`); continue; }
    const bytes = readFileSync(file);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== entry.sha256) errs.push(`schema ${schema}: ${entry.catalog} sha256 ${sha.slice(0, 12)}… ≠ manifest ${entry.sha256.slice(0, 12)}…`);
    const missing = new Set<string>();
    const text = bytes.toString('utf8');
    for (const match of text.matchAll(/"(assets\/[A-Za-z0-9_./-]+)"/g)) if (!existsSync(join(o.catalog, match[1]))) missing.add(match[1]);
    if (missing.size) errs.push(`schema ${schema}: ${missing.size} asset ref(s) not in ${show(o.catalog)}/assets (e.g. ${[...missing][0]}) — was it built with --allow-missing-assets?`);
  }
  return errs;
}

function main(argv: string[]): number {
  const o = parseArgs(argv);
  if (typeof o === 'string') { console.error(o); return o.startsWith('usage') ? 0 : 2; }
  const errs = verify(o);
  if (errs.length) { for (const e of errs) console.error(`error ${e}`); console.error(`\nFAILED: deploy/ not assembled`); return 1; }

  rmSync(o.out, { recursive: true, force: true });
  cpSync(o.dist, o.out, { recursive: true });
  cpSync(o.catalog, join(o.out, 'catalog'), { recursive: true });

  const files = listFiles(o.out);
  const groups = new Map<string, { n: number; bytes: number }>();
  for (const f of files) {
    const top = f.rel.startsWith('catalog/') ? f.rel.split('/').slice(0, 2).join('/') : f.rel.includes('/') ? f.rel.split('/')[0] + '/' : '(root files)';
    const g = groups.get(top) ?? { n: 0, bytes: 0 };
    g.n++; g.bytes += f.bytes;
    groups.set(top, g);
  }
  const total = files.reduce((s, f) => s + f.bytes, 0);
  const w = Math.max(...[...groups.keys()].map((k) => k.length), 5);
  console.log(`\nVALE deploy → ${show(o.out)}`);
  for (const [k, g] of [...groups].sort(([a], [b]) => a.localeCompare(b))) console.log(`  ${k.padEnd(w)}  ${String(g.n).padStart(5)} files  ${fmt(g.bytes).padStart(10)}`);
  console.log(`  ${'total'.padEnd(w)}  ${String(files.length).padStart(5)} files  ${fmt(total).padStart(10)}`);
  console.log('  largest:');
  for (const f of [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 5)) console.log(`    ${fmt(f.bytes).padStart(10)}  ${f.rel}`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
