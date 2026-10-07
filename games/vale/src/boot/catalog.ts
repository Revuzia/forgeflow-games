// VALE — catalog boot (CONTRACT §3.3, §3.5 steps 1–2): find the manifest, pick a schema, fetch the catalog.
//
// The client build ships with NO content. At boot it reads a manifest from a URL decided at RUN time:
//   ?catalog=<url>  →  window.VALE_CONFIG.catalog (public/config.js)  →  './catalog/manifest.json'
// so a CDN move is a config.js edit (or a query param for QA), never a rebuild.
//
// Schema negotiation: the manifest lists one catalog per schema it still serves; this client reads
// only the schemas in CLIENT_SCHEMAS and picks the HIGHEST one offered. An old client therefore keeps
// working after a new schema ships, because the content build keeps emitting the old schema too.
//
// Everything that does not touch `window` or the network is a pure exported function so
// _harness/probe_schema_negotiation.ts can run it under plain node. This module must never import
// zod (it would ship in the client): catalog TYPES come in with `import type` only.

import type { CatalogT, SCHEMA_VERSION } from '../contracts/catalog.ts';
import type { CatalogManifest, ManifestSchemaEntry } from '../contracts/manifest.ts';

/** Every catalog schema this client can read. Add N here only together with code that reads schema N. */
export const CLIENT_SCHEMAS = [1] as const;
type Assert<T extends true> = T;
/** Compile-time guard (no runtime cost): bumping SCHEMA_VERSION in the contract without teaching
 *  this client to read the new schema fails `npm run typecheck` right here. */
export type ClientReadsCurrentSchema = Assert<typeof SCHEMA_VERSION extends (typeof CLIENT_SCHEMAS)[number] ? true : false>;

export const DEFAULT_CATALOG_URL = './catalog/manifest.json';

declare global {
  interface Window { VALE_CONFIG?: { catalog?: string } }
}

export type CatalogErrorCode = 'manifest_fetch' | 'manifest_invalid' | 'no_compatible_schema' | 'catalog_fetch' | 'catalog_invalid' | 'hash_mismatch';
export class CatalogLoadError extends Error {
  readonly code: CatalogErrorCode;
  readonly url: string;
  constructor(code: CatalogErrorCode, url: string, message: string) {
    super(message);
    this.name = 'CatalogLoadError';
    this.code = code;
    this.url = url;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ── pure helpers ────────────────────────────────────────────────────────────────────────────────
/** Absolute manifest URL. `location` and `config` default to the browser globals. */
export function resolveCatalogUrl(
  location: { href: string; search: string } = window.location,
  config: { catalog?: string } | undefined = typeof window !== 'undefined' ? window.VALE_CONFIG : undefined,
): string {
  const fromQuery = new URLSearchParams(location.search).get('catalog');
  const chosen = (fromQuery && fromQuery.trim()) || (config?.catalog && config.catalog.trim()) || DEFAULT_CATALOG_URL;
  return new URL(chosen, location.href).href;
}

/** The directory a manifest lives in; catalog paths and asset refs are relative to it (§3.2). */
export function manifestBaseUrl(manifestUrl: string): string {
  return new URL('./', manifestUrl).href;
}

/** Resolve a catalog AssetRef (`assets/<sha>-<name>`) against the manifest directory. */
export function assetUrl(ref: string, baseUrl: string): string {
  return new URL(ref, baseUrl).href;
}

/** Shape check without zod: enough to fail with a clear message instead of a TypeError later. */
export function parseManifest(raw: unknown, url: string): CatalogManifest {
  const bad = (why: string): never => { throw new CatalogLoadError('manifest_invalid', url, `catalog manifest ${url} is invalid: ${why}`); };
  if (!raw || typeof raw !== 'object') bad('not a JSON object');
  const m = raw as Partial<CatalogManifest>;
  if (m.format !== 1) bad(`unsupported manifest format ${JSON.stringify(m.format)} (this client reads format 1)`);
  if (m.product !== 'vale') bad(`product is ${JSON.stringify(m.product)}, expected "vale"`);
  if (!m.schemas || typeof m.schemas !== 'object') bad('missing "schemas"');
  for (const [k, e] of Object.entries(m.schemas as Record<string, ManifestSchemaEntry>)) {
    if (!/^\d+$/.test(k)) bad(`schema key "${k}" is not a number`);
    if (!e || typeof e.catalog !== 'string' || typeof e.version !== 'string' || typeof e.sha256 !== 'string') bad(`schemas["${k}"] needs version, catalog and sha256`);
  }
  return { format: 1, product: 'vale', schemas: m.schemas as Record<string, ManifestSchemaEntry>, history: Array.isArray(m.history) ? m.history : [] };
}

/** Highest schema offered by the manifest that the client lists. Throws a readable error otherwise. */
export function negotiateSchema(manifest: CatalogManifest, clientSchemas: readonly number[] = CLIENT_SCHEMAS): { schema: number; entry: ManifestSchemaEntry } {
  const offered = Object.keys(manifest.schemas).map(Number).filter(Number.isInteger).sort((a, b) => b - a);
  for (const s of offered) if (clientSchemas.includes(s)) return { schema: s, entry: manifest.schemas[String(s)] };
  const newest = offered[0];
  const hint = offered.length === 0 ? 'the manifest offers no catalogs'
    : newest !== undefined && newest > Math.max(...clientSchemas) ? 'this client is older than every catalog offered — reload to get the current client'
      : 'the catalog is older than this client supports — rebuild/redeploy content';
  throw new CatalogLoadError('no_compatible_schema', '', `no compatible catalog schema: manifest offers [${offered.join(', ')}], this client reads [${[...clientSchemas].join(', ')}] (${hint})`);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;   // insecure context (plain http on a LAN host): skip the integrity check
  const d = new Uint8Array(await subtle.digest('SHA-256', bytes));
  let s = '';
  for (const b of d) s += b.toString(16).padStart(2, '0');
  return s;
}

// ── network ─────────────────────────────────────────────────────────────────────────────────────
const globalFetch: FetchLike = (input, init) => fetch(input, init);   // unbound window.fetch throws "Illegal invocation"

export async function fetchManifest(url: string, fetchImpl: FetchLike = globalFetch): Promise<CatalogManifest> {
  let res: Response;
  // the manifest is the one mutable file of a catalog deploy: always revalidate it
  try { res = await fetchImpl(url, { cache: 'no-cache' }); } catch (e) {
    throw new CatalogLoadError('manifest_fetch', url, `cannot fetch catalog manifest ${url}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new CatalogLoadError('manifest_fetch', url, `cannot fetch catalog manifest ${url}: HTTP ${res.status}`);
  let raw: unknown;
  try { raw = await res.json(); } catch { throw new CatalogLoadError('manifest_invalid', url, `catalog manifest ${url} is not JSON`); }
  return parseManifest(raw, url);
}

export interface LoadedCatalog {
  catalog: CatalogT;
  manifest: CatalogManifest;
  manifestUrl: string;
  /** manifest directory; every AssetRef resolves against it */
  baseUrl: string;
  version: string;
  schema: number;
  assetUrl(ref: string): string;
}

export interface LoadCatalogOptions {
  /** manifest URL; default resolveCatalogUrl() */
  url?: string;
  fetch?: FetchLike;
  clientSchemas?: readonly number[];
  /** verify catalog.json against the manifest sha256 (default true; skipped where crypto.subtle is missing) */
  verifyHash?: boolean;
}

export async function loadCatalog(opts: LoadCatalogOptions = {}): Promise<LoadedCatalog> {
  const fetchImpl = opts.fetch ?? globalFetch;
  const manifestUrl = opts.url ?? resolveCatalogUrl();
  const manifest = await fetchManifest(manifestUrl, fetchImpl);
  const { schema, entry } = negotiateSchema(manifest, opts.clientSchemas ?? CLIENT_SCHEMAS);
  const baseUrl = manifestBaseUrl(manifestUrl);
  const catalogUrl = new URL(entry.catalog, manifestUrl).href;

  const get = async (cache: RequestCache): Promise<ArrayBuffer> => {
    let res: Response;
    try { res = await fetchImpl(catalogUrl, { cache }); } catch (e) {
      throw new CatalogLoadError('catalog_fetch', catalogUrl, `cannot fetch catalog ${catalogUrl}: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (!res.ok) throw new CatalogLoadError('catalog_fetch', catalogUrl, `cannot fetch catalog ${catalogUrl}: HTTP ${res.status}`);
    return res.arrayBuffer();
  };
  let bytes = await get('default');
  if (opts.verifyHash !== false) {
    let sha = await sha256Hex(bytes);
    // a CDN edge can still hold an older catalog.json at the same path (version not bumped): retry past caches once
    if (sha !== null && sha !== entry.sha256) { bytes = await get('reload'); sha = await sha256Hex(bytes); }
    if (sha !== null && sha !== entry.sha256) {
      throw new CatalogLoadError('hash_mismatch', catalogUrl, `catalog ${catalogUrl} does not match its manifest (sha256 ${sha.slice(0, 12)}… ≠ ${entry.sha256.slice(0, 12)}…)`);
    }
  }
  let catalog: CatalogT;
  try { catalog = JSON.parse(new TextDecoder().decode(bytes)) as CatalogT; } catch {
    throw new CatalogLoadError('catalog_invalid', catalogUrl, `catalog ${catalogUrl} is not JSON`);
  }
  if ((catalog as { schema?: unknown }).schema !== schema) {
    throw new CatalogLoadError('catalog_invalid', catalogUrl, `catalog ${catalogUrl} declares schema ${String((catalog as { schema?: unknown }).schema)}, manifest promised ${schema}`);
  }
  if (catalog.version !== entry.version) {
    throw new CatalogLoadError('catalog_invalid', catalogUrl, `catalog ${catalogUrl} is version ${catalog.version}, manifest promised ${entry.version}`);
  }
  return {
    catalog, manifest, manifestUrl, baseUrl, version: catalog.version, schema,
    assetUrl: (ref: string) => assetUrl(ref, baseUrl),
  };
}
