// VALE probe — schema negotiation: old clients keep the old schema (CONTRACT §3.3, §13). Lane TOOLS.
//
//   1. pure negotiation (src/boot/catalog.ts): a manifest offering schemas 1 and 2 → a [1] client
//      picks 1, a [1,2] client picks 2, nothing compatible → a clear CatalogLoadError; manifest
//      validation; catalog URL precedence (?catalog= → VALE_CONFIG → default); asset URL resolution.
//   2. the down-converter mechanism (tools/schema_migrations.ts) with the identity example.
//   3. end to end: build the fixture catalog, pretend it is schema 2, let emitCatalogs() write
//      schema 2 + the schema 1 down-conversion into one manifest, then run loadCatalog() for a
//      schema-1 client and a schema-1+2 client through a fake fetch that serves that folder as a
//      CDN — including the sha256 integrity check and a missing manifest.

import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA_VERSION } from '../src/contracts/catalog.ts';
import type { CatalogManifest } from '../src/contracts/manifest.ts';
import {
  assetUrl, CatalogLoadError, CLIENT_SCHEMAS, DEFAULT_CATALOG_URL, loadCatalog, manifestBaseUrl, negotiateSchema, parseManifest,
  resolveCatalogUrl, type FetchLike,
} from '../src/boot/catalog.ts';
import { buildContent, defaultOptions, emitCatalogs } from '../tools/build_content.ts';
import { createRegistry, identityDown, MIGRATIONS, type CatalogData } from '../tools/schema_migrations.ts';

const HARNESS = dirname(fileURLToPath(import.meta.url));
let failures = 0;
let checks = 0;
function check(cond: unknown, what: string, detail?: string): void {
  checks++;
  if (!cond) { failures++; console.error(`FAIL ${what}${detail ? `\n     ${detail}` : ''}`); }
}
function throwsCode(fn: () => unknown, code: string, what: string, msgRe?: RegExp): void {
  try { fn(); check(false, what, 'did not throw'); } catch (e) {
    check(e instanceof CatalogLoadError && e.code === code && (!msgRe || msgRe.test(e.message)), what, e instanceof Error ? e.message : String(e));
  }
}
async function rejectsCode(p: Promise<unknown>, code: string, what: string): Promise<void> {
  try { await p; check(false, what, 'did not reject'); } catch (e) {
    check(e instanceof CatalogLoadError && e.code === code, what, e instanceof Error ? `${(e as CatalogLoadError).code}: ${e.message}` : String(e));
  }
}

const entry = (s: number, v: string) => ({ version: v, catalog: `schema-${s}/${v}/catalog.json`, sha256: '0'.repeat(64) });
const both: CatalogManifest = { format: 1, product: 'vale', schemas: { '1': entry(1, '2026.10.0'), '2': entry(2, '2026.11.0') }, history: [] };

// ── 1. pure negotiation ─────────────────────────────────────────────────────────────────────────
check(JSON.stringify(CLIENT_SCHEMAS) === '[1]' && CLIENT_SCHEMAS.includes(SCHEMA_VERSION), 'this client reads exactly [1] and includes SCHEMA_VERSION');
check(negotiateSchema(both, [1]).schema === 1 && negotiateSchema(both, [1]).entry.version === '2026.10.0', 'schemas {1,2} + client [1] → 1');
check(negotiateSchema(both, [1, 2]).schema === 2 && negotiateSchema(both, [2, 1]).schema === 2, 'schemas {1,2} + client [1,2] → 2 (highest)');
check(negotiateSchema(both).schema === 1, 'default CLIENT_SCHEMAS negotiates 1');
throwsCode(() => negotiateSchema(both, [3]), 'no_compatible_schema', 'client [3] vs {1,2} → no_compatible_schema', /offers \[2, 1\].*reads \[3\]/);
throwsCode(() => negotiateSchema({ ...both, schemas: { '2': entry(2, '2026.11.0') } }, [1]), 'no_compatible_schema', 'old client vs newer-only manifest says "reload"', /older than every catalog/);
throwsCode(() => negotiateSchema({ ...both, schemas: {} }, [1]), 'no_compatible_schema', 'empty manifest → clear error', /offers no catalogs/);
throwsCode(() => parseManifest({ ...both, format: 2 }, 'u'), 'manifest_invalid', 'manifest format 2 rejected');
throwsCode(() => parseManifest({ ...both, product: 'other' }, 'u'), 'manifest_invalid', 'foreign product rejected');
throwsCode(() => parseManifest({ ...both, schemas: { one: entry(1, 'x') } }, 'u'), 'manifest_invalid', 'non-numeric schema key rejected');
throwsCode(() => parseManifest('nope', 'u'), 'manifest_invalid', 'non-object manifest rejected');

const page = { href: 'https://games.example/vale/play/index.html?x=1', search: '?x=1' };
check(resolveCatalogUrl(page, undefined) === 'https://games.example/vale/play/catalog/manifest.json', 'default URL is ./catalog/manifest.json relative to the page', resolveCatalogUrl(page, undefined));
check(DEFAULT_CATALOG_URL === './catalog/manifest.json', 'DEFAULT_CATALOG_URL');
check(resolveCatalogUrl(page, { catalog: 'https://cdn.example/vale/manifest.json' }) === 'https://cdn.example/vale/manifest.json', 'VALE_CONFIG.catalog beats the default');
check(resolveCatalogUrl({ href: 'https://g.example/a/?catalog=../c/m.json', search: '?catalog=../c/m.json' }, { catalog: 'https://cdn.example/m.json' }) === 'https://g.example/c/m.json', '?catalog= beats VALE_CONFIG and resolves relative to the page');
check(resolveCatalogUrl({ href: 'https://g.example/a/?catalog=', search: '?catalog=' }, { catalog: '  ' }) === 'https://g.example/a/catalog/manifest.json', 'blank overrides fall through to the default');
check(manifestBaseUrl('https://cdn.example/vale/catalog/manifest.json') === 'https://cdn.example/vale/catalog/', 'manifest base URL is its directory');
check(assetUrl('assets/0123456789ab-hero.glb', 'https://cdn.example/vale/catalog/') === 'https://cdn.example/vale/catalog/assets/0123456789ab-hero.glb', 'asset refs resolve against the manifest directory');

// ── 2. migration mechanism ──────────────────────────────────────────────────────────────────────
check(JSON.stringify(MIGRATIONS.reachable(SCHEMA_VERSION)) === JSON.stringify([SCHEMA_VERSION]), `production registry emits only schema ${SCHEMA_VERSION} while no converters exist`);
const reg = createRegistry([identityDown(2)]);
check(JSON.stringify(reg.reachable(2)) === '[2,1]' && JSON.stringify(reg.reachable(3)) === '[3]', 'reachable() walks registered converters down and stops at a gap');
const sample: CatalogData = { schema: 2, version: '2026.11.0', marker: { deep: [1, 2] } };
const down = reg.applyDown(sample, 1);
check(down.schema === 1 && sample.schema === 2 && JSON.stringify((down as { marker?: unknown }).marker) === '{"deep":[1,2]}', 'applyDown(2 → 1) converts a private copy');
const expectThrow = (fn: () => unknown, re: RegExp, what: string): void => {
  try { fn(); check(false, what, 'did not throw'); } catch (e) { check(re.test((e as Error).message), what, (e as Error).message); }
};
expectThrow(() => reg.applyDown(sample, 0), /no down-converter registered from schema 1/, 'applyDown past the last converter fails clearly');
expectThrow(() => reg.applyDown({ schema: 1 }, 2), /cannot convert UP/, 'applyDown never converts up');
expectThrow(() => reg.register(identityDown(2)), /already registered/, 'duplicate converter rejected');
expectThrow(() => reg.register({ from: 4, to: 2, note: '', convert: (c) => c }), /vN → vN-1/, 'converter must step exactly one schema');
expectThrow(() => createRegistry([{ from: 3, to: 2, note: '', convert: (c) => ({ ...c, schema: 7 }) }]).applyDown({ schema: 3 }, 2), /produced schema 7/, 'converter output schema is verified');

// ── 3. end to end ───────────────────────────────────────────────────────────────────────────────
const TMP = mkdtempSync(join(tmpdir(), 'vale-probe-schema-'));
try {
  const out = join(TMP, 'catalog');
  const built = buildContent(defaultOptions({
    contentDir: join(HARNESS, 'fixtures', 'content_min'), designDir: join(HARNESS, 'fixtures', 'design_min'), outDir: out, quiet: true,
  }));
  check(built.ok, 'fixture catalog builds', built.errors.slice(0, 3).map((e) => `${e.file} ${e.path}: ${e.msg}`).join('\n'));
  const m1 = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as CatalogManifest;
  const cat1 = JSON.parse(readFileSync(join(out, m1.schemas['1'].catalog), 'utf8')) as CatalogData;

  // pretend schema 2 shipped: same data, schema 2, newer version; the identity converter makes schema 1 from it
  const cat2: CatalogData = { ...cat1, schema: 2, version: '2026.11.0' };
  const em = emitCatalogs({ catalog: cat2, outDir: out, registry: reg, current: 2 });
  check(em.errors.length === 0 && em.emitted.map((e) => e.schema).join(',') === '2,1', 'emitCatalogs writes schema 2 and its schema-1 down-conversion', JSON.stringify(em.errors));
  const m = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')) as CatalogManifest;
  check(m.schemas['1']?.catalog === 'schema-1/2026.11.0/catalog.json' && m.schemas['2']?.catalog === 'schema-2/2026.11.0/catalog.json', 'manifest offers schema 1 and 2', JSON.stringify(m.schemas));
  check(m.history.map((h) => `${h.schema}@${h.version}`).join(' ') === '1@2026.10.0 2@2026.11.0 1@2026.11.0', 'history appended per emitted schema', JSON.stringify(m.history));
  check(existsSync(join(out, 'schema-1/2026.10.0/catalog.json')), 'previous schema-1 catalog file is untouched');

  const BASE = 'https://cdn.test/vale/catalog/';
  const requests: string[] = [];
  let tamper = false;
  const fakeFetch: FetchLike = async (input) => {
    requests.push(input);
    if (!input.startsWith(BASE)) return new Response('wrong host', { status: 404 });
    const file = join(out, decodeURIComponent(input.slice(BASE.length)));
    if (!existsSync(file)) return new Response('not found', { status: 404 });
    let bytes = readFileSync(file);
    if (tamper && input.endsWith('catalog.json')) bytes = Buffer.concat([bytes, Buffer.from(' ')]);
    return new Response(new Uint8Array(bytes), { status: 200 });
  };
  const url = `${BASE}manifest.json`;

  const old = await loadCatalog({ url, fetch: fakeFetch, clientSchemas: [1] });
  check(old.schema === 1 && old.catalog.schema === 1 && old.version === '2026.11.0', 'schema-1 client loads the schema-1 catalog', `${old.schema} ${old.version}`);
  check(requests.includes(`${BASE}schema-1/2026.11.0/catalog.json`) && !requests.some((r) => r.includes('schema-2/')), 'schema-1 client never fetches schema 2', requests.join(' '));
  check(old.baseUrl === BASE && old.manifestUrl === url, 'baseUrl is the manifest directory');
  const model = old.catalog.fighters[0].art.model;
  check(old.assetUrl(model) === `${BASE}${model}` && existsSync(join(out, model)), 'assetUrl(ref) points at a file the CDN folder has', old.assetUrl(model));

  requests.length = 0;
  const neu = await loadCatalog({ url, fetch: fakeFetch, clientSchemas: [1, 2] });
  check(neu.schema === 2 && (neu.catalog as unknown as CatalogData).schema === 2 && requests.includes(`${BASE}schema-2/2026.11.0/catalog.json`), 'schema-1+2 client loads schema 2');

  requests.length = 0;
  tamper = true;
  await rejectsCode(loadCatalog({ url, fetch: fakeFetch, clientSchemas: [1] }), 'hash_mismatch', 'catalog bytes not matching the manifest sha256 are rejected');
  check(requests.filter((r) => r.endsWith('catalog.json')).length === 2, 'hash mismatch retries the catalog once past caches', requests.join(' '));
  tamper = false;

  await rejectsCode(loadCatalog({ url: `${BASE}missing/manifest.json`, fetch: fakeFetch }), 'manifest_fetch', 'missing manifest → manifest_fetch error');
  await rejectsCode(loadCatalog({ url, fetch: fakeFetch, clientSchemas: [5] }), 'no_compatible_schema', 'incompatible client → no_compatible_schema through loadCatalog');

  // a catalog file whose declared schema lies about itself is refused even when its hash is right
  const liar = join(TMP, 'liar');
  cpSync(out, liar, { recursive: true });
  const lm = JSON.parse(readFileSync(join(liar, 'manifest.json'), 'utf8')) as CatalogManifest;
  writeFileSync(join(liar, lm.schemas['1'].catalog), JSON.stringify({ ...cat1, schema: 2, version: lm.schemas['1'].version }));
  const lf: FetchLike = async (input) => {
    const f = join(liar, input.slice(BASE.length));
    return existsSync(f) ? new Response(new Uint8Array(readFileSync(f))) : new Response('', { status: 404 });
  };
  await rejectsCode(loadCatalog({ url, fetch: lf, clientSchemas: [1], verifyHash: false }), 'catalog_invalid', 'catalog declaring the wrong schema is refused');
} finally {
  rmSync(TMP, { recursive: true, force: true });
}

console.log(`${failures ? 'FAIL' : 'PASS'} probe_schema_negotiation: ${checks - failures}/${checks} checks`);
process.exitCode = failures ? 1 : 0;
