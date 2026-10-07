// VALE probe — content ids never appear in code (CONTRACT §0 "Content is data"). Lane TOOLS.
//
// Collects every content id (values of `id` and `sku` keys at any depth, plus audio cue / music
// keys and passive form keys) from
//   * the fixture catalog (tools/build_content.ts in --check mode on _harness/fixtures/content_min), and
//   * content/ when it has JSON (read RAW, so an in-progress content tree with errors still counts),
// then greps src/** (except src/contracts/) for any of them as a whole quoted string: '…', "…" or `…`.
// Any hit fails: code must read ids from the catalog, never name them.
//
// Not counted as ids (code vocabulary, allowed by §0): ids shorter than 4 characters, and any id
// that equals an enum/literal value of the zod contract (rule kinds, queue kinds, effect ops,
// status kinds, slots, clip roles, tags …), harvested from the schema itself so the list cannot
// drift. Such collisions are printed as notes so content authors can rename them if they want.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog } from '../src/contracts/catalog.ts';
import { buildContent, defaultOptions } from '../tools/build_content.ts';

const HARNESS = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HARNESS, '..');
const SRC = join(ROOT, 'src');
const EXCLUDED = [join(SRC, 'contracts')];
const MIN_LEN = 4;

let failures = 0;
const fail = (msg: string): void => { failures++; console.error(`FAIL ${msg}`); };

// ── code vocabulary straight from the zod schema ─────────────────────────────────────────────────
function schemaVocabulary(): Set<string> {
  const vocab = new Set<string>();
  const seen = new Set<unknown>();
  const walk = (s: any): void => {
    if (!s || seen.has(s)) return;
    seen.add(s);
    const def = s._zod?.def;
    if (!def) return;
    switch (def.type) {
      case 'object': for (const v of Object.values(def.shape)) walk(v); if (def.catchall) walk(def.catchall); break;
      case 'array': walk(def.element); break;
      case 'union': for (const o of def.options) walk(o); break;
      case 'intersection': walk(def.left); walk(def.right); break;
      case 'optional': case 'nullable': case 'default': case 'prefault': case 'readonly': case 'nonoptional': case 'catch': walk(def.innerType); break;
      case 'lazy': walk(def.getter()); break;
      case 'record': walk(def.keyType); walk(def.valueType); break;
      case 'tuple': for (const i of def.items) walk(i); if (def.rest) walk(def.rest); break;
      case 'pipe': walk(def.in); walk(def.out); break;
      case 'enum': for (const v of Object.values(def.entries)) vocab.add(String(v)); break;
      case 'literal': for (const v of def.values) vocab.add(String(v)); break;
    }
  };
  walk(Catalog);
  return vocab;
}

// ── id collection ───────────────────────────────────────────────────────────────────────────────
function collectIds(data: unknown, origin: string, into: Map<string, string>): void {
  const add = (id: unknown): void => { if (typeof id === 'string' && !into.has(id)) into.set(id, origin); };
  const walk = (v: unknown, key: string | null): void => {
    if (Array.isArray(v)) { v.forEach((x) => walk(x, null)); return; }
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    if (key === 'cues' || key === 'music' || key === 'forms') Object.keys(o).forEach(add);
    for (const [k, x] of Object.entries(o)) {
      if ((k === 'id' || k === 'sku') && typeof x === 'string') add(x);
      walk(x, k);
    }
  };
  walk(data, null);
}

function jsonFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) { if (name !== 'ui') out.push(...jsonFiles(abs)); }
    else if (name.endsWith('.json')) out.push(abs);
  }
  return out;
}

function codeFiles(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (EXCLUDED.some((e) => abs === e)) continue;
    if (statSync(abs).isDirectory()) out.push(...codeFiles(abs));
    else if (/\.(ts|tsx|js|mjs|jsx|css|html|glsl|wgsl)$/.test(name)) out.push(abs);
  }
  return out;
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** one regex for all ids: a quote, the whole id, the same quote */
function matcher(ids: string[]): RegExp {
  const alt = [...ids].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  return new RegExp(`(['"\`])(${alt})\\1`, 'g');
}

// ── run ─────────────────────────────────────────────────────────────────────────────────────────
const ids = new Map<string, string>();

const fixture = buildContent(defaultOptions({
  contentDir: join(HARNESS, 'fixtures', 'content_min'),
  designDir: join(HARNESS, 'fixtures', 'design_min'),
  check: true,
}));
if (!fixture.ok || !fixture.catalog) fail(`fixture catalog did not build: ${fixture.errors.slice(0, 3).map((e) => `${e.file} ${e.path}: ${e.msg}`).join('; ')}`);
else collectIds(fixture.catalog, 'fixture', ids);
const fixtureCount = ids.size;
if (fixtureCount < 30) fail(`only ${fixtureCount} ids collected from the fixture catalog — the collector is broken`);

const contentDir = join(ROOT, 'content');
let contentFiles = 0;
if (existsSync(contentDir)) {
  for (const f of jsonFiles(contentDir)) {
    try {
      collectIds(JSON.parse(readFileSync(f, 'utf8').replace(/^﻿/, '')), relative(ROOT, f).replace(/\\/g, '/'), ids);
      contentFiles++;
    } catch (e) {
      console.warn(`note: ${relative(ROOT, f)} is not valid JSON (${(e as Error).message}) — its ids are not checked`);
    }
  }
}

const vocab = schemaVocabulary();
const short: string[] = [];
const vocabHits: string[] = [];
const checked: string[] = [];
for (const id of ids.keys()) {
  if (id.length < MIN_LEN) short.push(id);
  else if (vocab.has(id)) vocabHits.push(id);
  else checked.push(id);
}
if (vocabHits.length) console.log(`note: ${vocabHits.length} content id(s) equal contract vocabulary and are not grepped: ${vocabHits.sort().join(', ')}`);

// self-test the matcher so a regex mistake cannot turn this probe into a silent pass
{
  const re = matcher(['fx_probe_selftest', 'fx_probe_other']);
  const sample = `a('fx_probe_selftest'); b("fx_probe_other"); c(\`fx_probe_selftest\`); d('fx_probe_selftest_x'); e(fx_probe_other); f('xfx_probe_other')`;
  const found = [...sample.matchAll(re)].map((m) => m[2]);
  if (found.join(',') !== 'fx_probe_selftest,fx_probe_other,fx_probe_selftest') fail(`matcher self-test: got [${found.join(', ')}]`);
}

const files = codeFiles(SRC);
let hits = 0;
if (checked.length) {
  const re = matcher(checked);
  for (const f of files) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        hits++;
        fail(`${relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}: content id '${m[2]}' (from ${ids.get(m[2])}) hard-coded in code — read it from the catalog`);
      }
    });
  }
}

console.log(`${failures ? 'FAIL' : 'PASS'} probe_content_ids: ${checked.length} ids (${fixtureCount} fixture, ${contentFiles} content/ files; ${short.length} short + ${vocabHits.length} vocabulary skipped) × ${files.length} src files, ${hits} hit(s)`);
process.exitCode = failures ? 1 : 0;
