#!/usr/bin/env node
// VALE art: validate every art/out/**/art.json against the REAL zod schema the catalog build uses
// (src/contracts/catalog.ts FighterArt, .strict()), so the CONTENT lane can copy it verbatim, and
// every skins.json entry against the SkinDef asset fields. Called by `python3 art/build.py check`.
//
//   node art/tools/validate_art_json.mjs [file.json ...]      (default: every art.json/skins.json)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const GAME = resolve(HERE, '..', '..');
const OUT = join(GAME, 'art', 'out');
const { FighterArt, SkinDef } = await import(pathToFileURL(join(GAME, 'src', 'contracts', 'catalog.ts')).href);

function walk(d, acc = []) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (n === 'art.json' || n === 'skins.json') acc.push(p);
  }
  return acc;
}
const files = process.argv.slice(2).length ? process.argv.slice(2).map((f) => resolve(f)) : (existsSync(OUT) ? walk(OUT) : []);
let bad = 0;
const assetExists = (ref) => existsSync(join(OUT, ref.replace(/^assets\//, '')));
for (const f of files) {
  const rel = relative(GAME, f).split('\\').join('/');
  const data = JSON.parse(readFileSync(f, 'utf8'));
  const errs = [];
  if (f.endsWith('art.json')) {
    const r = FighterArt.safeParse(data);
    if (!r.success) errs.push(...r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`));
    for (const k of ['model', 'portrait', 'splash', 'icon']) if (data[k] && !assetExists(data[k])) errs.push(`${k} ${data[k]} not in art/out`);
  } else {
    // SkinDef minus the CONTENT-owned fields (name, tier, desc, releasedIn)
    const partial = SkinDef.pick({ id: true, fighter: true, model: true, portrait: true, splash: true });
    for (const [i, s] of data.entries()) {
      const r = partial.safeParse(s);
      if (!r.success) errs.push(...r.error.issues.map((x) => `[${i}].${x.path.join('.')}: ${x.message}`));
      for (const k of ['model', 'portrait', 'splash']) if (s[k] && !assetExists(s[k])) errs.push(`[${i}].${k} ${s[k]} not in art/out`);
    }
  }
  // technical builds (art/out/_<name>/: the proof, the look-dev reference, the template demo) use ids
  // starting with '_' that are not game content: the Id regex may reject them
  const proof = /(^|\/)out\/_[^/]+\//.test(rel);
  const real = proof ? errs.filter((e) => !/\bid\b|fighter:/.test(e)) : errs;
  if (real.length) { bad++; console.log(`[art.json] FAIL ${rel}`); for (const e of real) console.log(`   - ${e}`); }
  else console.log(`[art.json] OK   ${rel}${errs.length ? ` (proof-only id warnings: ${errs.length})` : ''}`);
}
process.exit(bad ? 1 : 0);
