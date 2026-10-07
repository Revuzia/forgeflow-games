// VALE — content build (CONTRACT §3). content/ → dist-catalog/ (manifest + per-schema catalogs + assets).
//
//   node tools/build_content.ts                       build content/ → dist-catalog/
//   node tools/build_content.ts --check               validate only; writes nothing
//   flags: --content <dir>  --out <dir>  --allow-missing-assets  --design <dir>  --art-out <dir>
//          --audio-out <dir>  --scripts <dir>  --quiet
//   exit:  0 ok · 1 content errors · 2 usage / internal error
//
// SOURCE LAYOUT (CONTRACT §1, file shapes §3.6). One JSON file per record family:
//   version.json { "version": "YYYY.M.patch" }        → catalog.version
//   roles.json resources.json items.json units.json team_buffs.json modes.json queues.json
//   ranks.json vfx.json bot_names.json                 → a JSON array (or { "<family>": [ … ] })
//   setup.json store.json client.json audio.json strings.en.json → one JSON object
//   fighters/<id>.json  maps/<id>.json                 → ONE record per file; record id == file name
//   skins/<fighter>.json                               → array of that fighter's skins
// Records are concatenated in file-name order, so output order is deterministic. "$comment" and
// "$schema" keys are stripped at any depth before validation (JSON has no comments); a UTF-8 BOM
// is tolerated (Windows editors).
//
// ASSET REFS. Every string `assets/<path>` in the catalog is an AssetRef. It resolves against
// these roots, first hit wins (a later root that also has the file triggers a "shadowed" warning):
//   1. <content>/<path>                          assets/ui/x.png              → content/ui/x.png
//   2. <art-out>/<path>                          assets/fighters/a/a.glb      → art/out/fighters/a/a.glb
//   3. <audio-out>/<path minus "audio/">         assets/audio/sfx/hit.ogg     → audio/out/sfx/hit.ogg
// <art-out> defaults to <content>/../art/out and <audio-out> to <content>/../audio/out, i.e. the
// project's art/out and audio/out for the default content/ (a fixture tree mirrors that shape).
// Each resolved file is copied to <out>/assets/<sha256-12>-<basename> (content-addressed:
// immutable, shared across versions and schemas, case-proof on any CDN) and the ref is rewritten
// to that path, which is relative to the manifest directory (§3.2). Refs must be exact-case and
// self-contained (GLB, not .gltf + .bin). Known binary formats are sniffed (a Git LFS pointer or a
// failed export fails the build here, not in a player's browser).
//
// OUTPUT (§3.1, §3.2):
//   <out>/schema-<n>/<version>/catalog.json   minified; one per schema in MIGRATIONS.reachable()
//   <out>/assets/…                            see above
//   <out>/manifest.json                       written LAST (it is the pointer a CDN serves fresh)
// A rebuild whose catalog equals the existing file for the same (schema, version) keeps the old
// file byte-for-byte (same builtAt, same sha256) and adds no history entry; a CHANGED catalog under
// an unchanged version is rewritten with a warning, because CDNs may still serve the old bytes.
// Schemas present in the previous manifest but no longer reachable are kept (frozen) if their
// catalog file is still in <out>, so old clients keep working.
//
// CHECKS (§3.4; the build fails on any): zod strict parse (defaults applied) · duplicate ids ·
// cross-references (roles, resources, units, item components, skins → fighters, offers → skins and
// currencies, shelves → offers, queues → modes, modes → maps, map music, mode slots, team buffs,
// setup defaults/paths, cues/vfx used by `present`, clip roles used by `present.anim`, form ids,
// script ids → src/sim/scripts/<id>.ts) · required fighter clips (§12) · every fighter has a base
// skin in store.starterOwnership · every asset ref resolves · deny-listed names (tools/names_check.ts)
// · item recipes (component costs ≤ total, no cycles) · kit completeness (passive + a1 a2 a3 ult,
// each with icon, non-blank desc, ai hint) · map coordinates inside the map.

import { createHash } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync,
  renameSync, statSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog, ClipRole, SCHEMA_VERSION, type CatalogT } from '../src/contracts/catalog.ts';
import { MANIFEST_FORMAT, MANIFEST_PRODUCT, type CatalogManifest, type ManifestHistoryEntry } from '../src/contracts/manifest.ts';
import { checkNames, DEFAULT_DESIGN_DIR, formatHit, loadDenyList, type NameInput, type TextKind } from './names_check.ts';
import { MIGRATIONS, type CatalogData, type MigrationRegistry } from './schema_migrations.ts';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── types ───────────────────────────────────────────────────────────────────────────────────────
type Seg = string | number;
export interface Diag { file: string; path: string; msg: string }
export interface BuildOptions {
  contentDir: string;
  outDir: string;
  check: boolean;
  allowMissingAssets: boolean;
  designDir: string;
  artOutDir: string;
  audioOutDir: string;
  scriptsDir: string;
  registry: MigrationRegistry;
  /** ISO time stamped into new catalogs; default now (or $SOURCE_DATE_EPOCH) */
  builtAt?: string;
  quiet?: boolean;
}
export interface AssetInfo { ref: string; abs: string; root: string; bytes: number; out?: string; sha256?: string }
export interface EmittedSchema { schema: number; version: string; catalog: string; sha256: string; unchanged: boolean; bytes: number }
export interface BuildResult {
  ok: boolean;
  errors: Diag[];
  warnings: Diag[];
  catalog?: CatalogT;
  counts: [string, number][];
  assets: AssetInfo[];
  emitted: EmittedSchema[];
  manifest?: CatalogManifest;
  namesChecked: boolean;
}

interface Origin { file: string; prefix: Seg[] }
interface FamilyOrigin { whole: Origin; items?: Origin[] }

// ── family table (CONTRACT §1 → Catalog keys) ───────────────────────────────────────────────────
type FamilyShape = 'array' | 'object' | 'recordPerFile' | 'arrayPerFile';
interface Family { key: keyof CatalogT & string; path: string; shape: FamilyShape }
const FAMILIES: Family[] = [
  { key: 'roles', path: 'roles.json', shape: 'array' },
  { key: 'resources', path: 'resources.json', shape: 'array' },
  { key: 'fighters', path: 'fighters', shape: 'recordPerFile' },
  { key: 'skins', path: 'skins', shape: 'arrayPerFile' },
  { key: 'items', path: 'items.json', shape: 'array' },
  { key: 'setup', path: 'setup.json', shape: 'object' },
  { key: 'units', path: 'units.json', shape: 'array' },
  { key: 'teamBuffs', path: 'team_buffs.json', shape: 'array' },
  { key: 'maps', path: 'maps', shape: 'recordPerFile' },
  { key: 'modes', path: 'modes.json', shape: 'array' },
  { key: 'queues', path: 'queues.json', shape: 'array' },
  { key: 'ranks', path: 'ranks.json', shape: 'array' },
  { key: 'store', path: 'store.json', shape: 'object' },
  { key: 'client', path: 'client.json', shape: 'object' },
  { key: 'audio', path: 'audio.json', shape: 'object' },
  { key: 'vfx', path: 'vfx.json', shape: 'array' },
  { key: 'strings', path: 'strings.en.json', shape: 'object' },
  { key: 'botNames', path: 'bot_names.json', shape: 'array' },
];
const KNOWN_ROOT_ENTRIES = new Set([...FAMILIES.map((f) => f.path), 'version.json', 'ui', 'README.md']);
const REQUIRED_CLIPS = ['idle', 'run', 'attack1', 'attack2', 'cast_a1', 'cast_a2', 'cast_a3', 'cast_ult', 'death', 'recall', 'idle_lobby', 'victory'];
const ASSET_RE = /^assets\/[A-Za-z0-9_./-]+$/;

// ── small helpers ───────────────────────────────────────────────────────────────────────────────
export function displayPath(p: string): string {
  const r = relative(PROJECT_ROOT, p);
  return (r.startsWith('..') || resolve(PROJECT_ROOT, r) !== resolve(p) ? p : r).replace(/\\/g, '/');
}
export function fmtPath(path: readonly PropertyKey[]): string {
  let s = '$';
  for (const k of path) {
    if (typeof k === 'number') s += `[${k}]`;
    else if (typeof k === 'string' && /^[A-Za-z_$][\w$]*$/.test(k)) s += `.${k}`;
    else s += `[${JSON.stringify(String(k))}]`;
  }
  return s;
}
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
const sha256 = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function stripComments(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripComments);
  if (isObj(v)) {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== '$comment' && k !== '$schema') o[k] = stripComments(x);
    return o;
  }
  return v;
}

function levenshtein(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
function unknownRef(kind: string, id: unknown, known: Iterable<string>): string {
  const list = [...known];
  const s = String(id);
  let best = ''; let bestD = Infinity;
  for (const k of list) { const dd = levenshtein(s, k); if (dd < bestD) { bestD = dd; best = k; } }
  const hint = best && bestD <= Math.max(2, Math.floor(s.length / 4)) ? ` — did you mean "${best}"?`
    : list.length ? ` (known: ${list.slice(0, 8).join(', ')}${list.length > 8 ? ', …' : ''})` : ` (none defined)`;
  return `unknown ${kind} "${s}"${hint}`;
}

type Visit = (node: Record<string, unknown>, path: Seg[]) => void | 'skip';
function walkObjects(v: unknown, path: Seg[], visit: Visit): void {
  if (Array.isArray(v)) { v.forEach((x, i) => walkObjects(x, [...path, i], visit)); return; }
  if (isObj(v)) {
    if (visit(v, path) === 'skip') return;
    for (const [k, x] of Object.entries(v)) walkObjects(x, [...path, k], visit);
  }
}
function walkStrings(v: unknown, path: Seg[], visit: (s: string, path: Seg[]) => void): void {
  if (typeof v === 'string') visit(v, path);
  else if (Array.isArray(v)) v.forEach((x, i) => walkStrings(x, [...path, i], visit));
  else if (isObj(v)) for (const [k, x] of Object.entries(v)) walkStrings(x, [...path, k], visit);
}
function mapStrings(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === 'string') return fn(v);
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  if (isObj(v)) { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) o[k] = mapStrings(x, fn); return o; }
  return v;
}

// ── diagnostics + locating catalog paths in source files ─────────────────────────────────────────
export class Diagnostics {
  errors: Diag[] = [];
  warnings: Diag[] = [];
  origins: Record<string, FamilyOrigin> = {};
  /** families whose source file is missing or unreadable — already reported, so zod's
   *  "expected array, received undefined" for them is noise */
  missing = new Set<string>();

  locate(path: readonly PropertyKey[]): { file: string; path: string } {
    const [fam, ...rest] = path;
    const o = this.origins[String(fam)];
    if (!o) return { file: '(catalog)', path: fmtPath(path) };
    if (o.items && typeof rest[0] === 'number' && o.items[rest[0]]) {
      const it = o.items[rest[0]];
      return { file: it.file, path: fmtPath([...it.prefix, ...rest.slice(1)]) };
    }
    return { file: o.whole.file, path: fmtPath([...o.whole.prefix, ...rest]) };
  }
  err(path: readonly PropertyKey[], msg: string): void { this.errors.push({ ...this.locate(path), msg }); }
  warn(path: readonly PropertyKey[], msg: string): void { this.warnings.push({ ...this.locate(path), msg }); }
  fileErr(file: string, msg: string, path = '$'): void { this.errors.push({ file, path, msg }); }
  fileWarn(file: string, msg: string, path = '$'): void { this.warnings.push({ file, path, msg }); }
}
export const formatDiag = (d: Diag): string => `${d.file} ${d.path}: ${d.msg}`;

// ── 1. load sources ─────────────────────────────────────────────────────────────────────────────
function readJsonFile(abs: string, dg: Diagnostics): unknown {
  let text: string;
  try { text = readFileSync(abs, 'utf8'); } catch (e) { dg.fileErr(displayPath(abs), `cannot read: ${(e as Error).message}`); return undefined; }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try { return stripComments(JSON.parse(text)); } catch (e) {
    dg.fileErr(displayPath(abs), `invalid JSON: ${(e as Error).message}`);
    return undefined;
  }
}

/** `[...]` or `{ "<key>": [...] }` → the array plus the json prefix it sits under */
function unwrapArray(v: unknown, keys: string[], file: string, dg: Diagnostics): { arr: unknown[]; prefix: Seg[] } | null {
  if (Array.isArray(v)) return { arr: v, prefix: [] };
  if (isObj(v)) {
    const ks = Object.keys(v);
    if (ks.length === 1 && keys.includes(ks[0]) && Array.isArray(v[ks[0]])) return { arr: v[ks[0]] as unknown[], prefix: [ks[0]] };
  }
  dg.fileErr(file, `expected a JSON array (or { "${keys[0]}": [ … ] })`);
  return null;
}

function jsonFilesIn(dir: string, dg: Diagnostics): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (name.endsWith('.json') && statSync(abs).isFile()) out.push(abs);
    else if (!name.startsWith('.')) dg.fileWarn(displayPath(abs), 'ignored: only <id>.json files are read here');
  }
  return out;
}

interface Loaded { raw: Record<string, unknown>; version: unknown }
function loadSources(contentDir: string, builtAt: string, dg: Diagnostics): Loaded | null {
  if (!existsSync(contentDir) || !statSync(contentDir).isDirectory()) {
    dg.fileErr(displayPath(contentDir), 'content directory not found');
    return null;
  }
  for (const name of readdirSync(contentDir).sort()) {
    if (!KNOWN_ROOT_ENTRIES.has(name) && name.endsWith('.json')) {
      dg.fileWarn(displayPath(join(contentDir, name)), 'not a catalog file (CONTRACT §1) — ignored; typo?');
    }
  }
  const versionFile = join(contentDir, 'version.json');
  let version: unknown;
  if (!existsSync(versionFile)) { dg.fileErr(displayPath(versionFile), 'missing: { "version": "YYYY.M.patch" } names this catalog build'); dg.missing.add('version'); }
  else {
    const v = readJsonFile(versionFile, dg);
    if (isObj(v) && typeof v.version === 'string') version = v.version;
    else { if (v !== undefined) dg.fileErr(displayPath(versionFile), 'expected { "version": "YYYY.M.patch" }'); dg.missing.add('version'); }
  }
  dg.origins.schema = { whole: { file: '(build)', prefix: ['schema'] } };
  dg.origins.version = { whole: { file: displayPath(versionFile), prefix: ['version'] } };
  dg.origins.builtAt = { whole: { file: '(build)', prefix: ['builtAt'] } };

  const raw: Record<string, unknown> = { schema: SCHEMA_VERSION, version, builtAt };
  for (const fam of FAMILIES) {
    const abs = join(contentDir, fam.path);
    const file = displayPath(abs);
    if (fam.shape === 'object' || fam.shape === 'array') {
      dg.origins[fam.key] = { whole: { file, prefix: [] } };
      if (!existsSync(abs)) { dg.fileErr(file, `missing (catalog.${fam.key})`); dg.missing.add(fam.key); continue; }
      const v = readJsonFile(abs, dg);
      if (v === undefined) { dg.missing.add(fam.key); continue; }
      if (fam.shape === 'object') { raw[fam.key] = v; continue; }
      const u = unwrapArray(v, [fam.key, fam.path.replace(/\.json$/, '')], file, dg);
      if (!u) { dg.missing.add(fam.key); continue; }
      raw[fam.key] = u.arr;
      dg.origins[fam.key] = { whole: { file, prefix: u.prefix }, items: u.arr.map((_, i) => ({ file, prefix: [...u.prefix, i] })) };
      continue;
    }
    // per-file families
    const items: unknown[] = [];
    const origins: Origin[] = [];
    for (const f of jsonFilesIn(abs, dg)) {
      const v = readJsonFile(f, dg);
      if (v === undefined) continue;
      const fileD = displayPath(f);
      const stem = basename(f, '.json');
      if (fam.shape === 'recordPerFile') {
        if (!isObj(v)) { dg.fileErr(fileD, `expected ONE ${fam.key.replace(/s$/, '')} record (a JSON object)`); continue; }
        if (v.id !== stem) dg.fileErr(fileD, `record id "${String(v.id)}" must equal the file name "${stem}"`, '$.id');
        items.push(v); origins.push({ file: fileD, prefix: [] });
      } else {
        const u = unwrapArray(v, [fam.key], fileD, dg);
        if (!u) continue;
        u.arr.forEach((x, i) => {
          items.push(x); origins.push({ file: fileD, prefix: [...u.prefix, i] });
          if (isObj(x) && typeof x.fighter === 'string' && x.fighter !== stem) {
            dg.fileErr(fileD, `skin belongs to fighter "${x.fighter}" but lives in skins/${stem}.json`, fmtPath([...u.prefix, i, 'fighter']));
          }
        });
      }
    }
    raw[fam.key] = items;
    dg.origins[fam.key] = { whole: { file: file + '/', prefix: [] }, items: origins };
  }
  return { raw, version };
}

// ── 2. zod → diagnostics ────────────────────────────────────────────────────────────────────────
interface IssueLike { code?: string; path: PropertyKey[]; message: string; keys?: string[]; errors?: IssueLike[][]; expected?: string; note?: string }
function reportIssues(issues: readonly IssueLike[], base: PropertyKey[], dg: Diagnostics): void {
  for (const is of issues) {
    const path = [...base, ...is.path];
    if (path.length === 1 && dg.missing.has(String(path[0]))) continue;
    if (is.code === 'invalid_union' && is.errors && is.errors.length) {
      const branches = is.errors;
      const rootTypeOnly = branches.every((b) => b.length === 1 && b[0].code === 'invalid_type' && b[0].path.length === 0);
      if (rootTypeOnly) { dg.err(path, `expected ${branches.map((b) => b[0].expected).join(' | ')}`); continue; }
      // the branch that got furthest is the one the author meant
      const depth = (b: IssueLike[]): number => Math.max(...b.map((x) => x.path.length + (x.code === 'invalid_type' ? 0 : 0.5)));
      const best = [...branches].sort((a, b) => depth(b) - depth(a))[0];
      reportIssues(best, path, dg);
      continue;
    }
    dg.err(path, is.message);
  }
}

// ── 3. semantic checks (only on a schema-valid catalog) ──────────────────────────────────────────
function checkUnique<T>(arr: readonly T[], key: (t: T) => string, path: Seg[], what: string, dg: Diagnostics): Set<string> {
  const seen = new Map<string, number>();
  arr.forEach((x, i) => {
    const k = key(x);
    if (seen.has(k)) dg.err([...path, i], `duplicate ${what} "${k}" (first at index ${seen.get(k)})`);
    else seen.set(k, i);
  });
  return new Set(seen.keys());
}

function semanticChecks(c: CatalogT, opts: BuildOptions, dg: Diagnostics): void {
  const roles = checkUnique(c.roles, (r) => r.id, ['roles'], 'role id', dg);
  const resources = checkUnique(c.resources, (r) => r.id, ['resources'], 'resource id', dg);
  const fighters = checkUnique(c.fighters, (f) => f.id, ['fighters'], 'fighter id', dg);
  const skins = checkUnique(c.skins, (s) => s.id, ['skins'], 'skin id', dg);
  const items = checkUnique(c.items, (i) => i.id, ['items'], 'item id', dg);
  const units = checkUnique(c.units, (u) => u.id, ['units'], 'unit id', dg);
  const teamBuffs = checkUnique(c.teamBuffs, (t) => t.id, ['teamBuffs'], 'team buff id', dg);
  const maps = checkUnique(c.maps, (m) => m.id, ['maps'], 'map id', dg);
  const modes = checkUnique(c.modes, (m) => m.id, ['modes'], 'mode id', dg);
  checkUnique(c.queues, (q) => q.id, ['queues'], 'queue id', dg);
  checkUnique(c.ranks, (r) => r.id, ['ranks'], 'rank id', dg);
  const vfx = checkUnique(c.vfx, (v) => v.id, ['vfx'], 'vfx id', dg);
  const currencies = checkUnique(c.store.currencies, (x) => x.id, ['store', 'currencies'], 'currency id', dg);
  const skus = checkUnique(c.store.offers, (o) => o.sku, ['store', 'offers'], 'offer sku', dg);
  checkUnique(c.store.shelves, (s) => s.id, ['store', 'shelves'], 'shelf id', dg);
  const spells = checkUnique(c.setup.spells, (s) => s.id, ['setup', 'spells'], 'spell id', dg);
  const boons = checkUnique(c.setup.boons, (b) => b.id, ['setup', 'boons'], 'boon id', dg);
  const paths = checkUnique(c.setup.paths, (p) => p.id, ['setup', 'paths'], 'path id', dg);
  checkUnique(c.client.home.tiles, (t) => t.id, ['client', 'home', 'tiles'], 'home tile id', dg);
  const cues = new Set(Object.keys(c.audio.cues));
  const music = new Set(Object.keys(c.audio.music));
  const unitKind = new Map(c.units.map((u) => [u.id, u.kind] as const));
  const clipRoles = new Set<string>(ClipRole.options);

  // ability ids travel in sim events without their fighter, so they must be unique across kits
  const abilityOwner = new Map<string, string>();
  c.fighters.forEach((f, fi) => {
    const k = f.kit;
    const list: [Seg[], string][] = [[['kit', 'passive', 'id'], k.passive.id]];
    for (const slot of ['a1', 'a2', 'a3', 'ult'] as const) {
      list.push([['kit', slot, 'id'], k[slot].id]);
      const rc = k[slot].recast;
      if (rc) list.push([['kit', slot, 'recast', 'ability', 'id'], rc.ability.id]);
    }
    for (const [p, id] of list) {
      const prev = abilityOwner.get(id);
      if (prev) dg.err(['fighters', fi, ...p], `ability id "${id}" already used by ${prev} (ability ids are global: sim events carry them alone)`);
      else abilityOwner.set(id, `fighter ${f.id}`);
    }
  });

  // presentation refs, effect refs and form refs, walked per owning record
  const scriptFirstUse = new Map<string, Seg[]>();
  const walkRecord = (rec: unknown, base: Seg[], ctx: { clips: Set<string> | null; clipOwner: string; forms: Set<string> | null }): void => {
    walkObjects(rec, base, (node, path) => {
      const last = path[path.length - 1];
      if (last === 'behavior' || last === 'terrain' || last === 'params') return 'skip';
      if (last === 'present') {
        for (const k of ['vfx', 'hitVfx'] as const) if (typeof node[k] === 'string' && !vfx.has(node[k] as string)) dg.err([...path, k], unknownRef('vfx id', node[k], vfx));
        for (const k of ['sfx', 'hitSfx'] as const) if (typeof node[k] === 'string' && !cues.has(node[k] as string)) dg.err([...path, k], unknownRef('audio cue', node[k], cues));
        if (typeof node.anim === 'string') {
          const pool = ctx.clips ?? clipRoles;
          if (!pool.has(node.anim)) dg.err([...path, 'anim'], `${unknownRef('clip role', node.anim, pool)} (${ctx.clipOwner})`);
        }
      }
      if (typeof node.op === 'string') {
        if (node.op === 'summon' && typeof node.unit === 'string' && !units.has(node.unit)) dg.err([...path, 'unit'], unknownRef('unit', node.unit, units));
        if (node.op === 'script' && typeof node.id === 'string' && !scriptFirstUse.has(node.id)) scriptFirstUse.set(node.id, [...path, 'id']);
        if (node.op === 'form' && typeof node.form === 'string') {
          if (!ctx.forms) dg.err([...path, 'form'], 'form effects are only valid inside a fighter (forms live on the fighter\'s passive)');
          else if (!ctx.forms.has(node.form)) dg.err([...path, 'form'], unknownRef('form (kit.passive.forms)', node.form, ctx.forms));
        }
      }
      if (node.kind === 'inForm' && typeof node.form === 'string') {
        if (!ctx.forms) dg.err([...path, 'form'], 'inForm conditions are only valid inside a fighter');
        else if (!ctx.forms.has(node.form)) dg.err([...path, 'form'], unknownRef('form (kit.passive.forms)', node.form, ctx.forms));
      }
    });
  };

  // fighters
  c.fighters.forEach((f, i) => {
    const p: Seg[] = ['fighters', i];
    if (!roles.has(f.role)) dg.err([...p, 'role'], unknownRef('role', f.role, roles));
    if (f.secondaryRole !== undefined && !roles.has(f.secondaryRole)) dg.err([...p, 'secondaryRole'], unknownRef('role', f.secondaryRole, roles));
    if (!resources.has(f.resource)) dg.err([...p, 'resource'], unknownRef('resource', f.resource, resources));
    const clips = new Set(Object.keys(f.art.clips));
    const missing = REQUIRED_CLIPS.filter((r) => !clips.has(r));
    if (missing.length) dg.err([...p, 'art', 'clips'], `missing required clip roles (CONTRACT §12): ${missing.join(', ')}`);
    // kit completeness: passive + a1 a2 a3 ult, each with icon, desc, ai hint (zod guarantees presence; blank text is the remaining hole)
    const kitChecks: [Seg[], { name: string; desc: string; icon: string; ai?: { use: string[] } }][] = [[['kit', 'passive'], f.kit.passive]];
    for (const slot of ['a1', 'a2', 'a3', 'ult'] as const) {
      kitChecks.push([['kit', slot], f.kit[slot]]);
      const rc = f.kit[slot].recast;
      if (rc) kitChecks.push([['kit', slot, 'recast', 'ability'], rc.ability]);
    }
    for (const [kp, a] of kitChecks) {
      if (!a.name.trim()) dg.err([...p, ...kp, 'name'], 'blank name');
      if (!a.desc.trim()) dg.err([...p, ...kp, 'desc'], 'blank desc (every kit entry needs player-facing text)');
      if (!a.icon) dg.err([...p, ...kp, 'icon'], 'missing icon');
      if (kp[1] !== 'passive' && (!a.ai || a.ai.use.length === 0)) dg.err([...p, ...kp, 'ai'], 'missing ai hint');
    }
    walkRecord(f, p, { clips, clipOwner: `fighter ${f.id} art.clips`, forms: new Set(Object.keys(f.kit.passive.forms ?? {})) });
  });

  // skins + base-skin ownership
  const starter = new Set(c.store.starterOwnership);
  c.skins.forEach((s, i) => { if (!fighters.has(s.fighter)) dg.err(['skins', i, 'fighter'], unknownRef('fighter', s.fighter, fighters)); });
  c.fighters.forEach((f, i) => {
    const base = c.skins.filter((s) => s.fighter === f.id && s.tier === 'base');
    if (!base.some((s) => starter.has(s.id))) {
      dg.err(['fighters', i], base.length
        ? `no base skin is in store.starterOwnership (base skins: ${base.map((s) => s.id).join(', ')})`
        : `has no skin with tier "base" (every fighter needs one, owned via store.starterOwnership)`);
    }
  });

  // items: components, recipe sums, cycles
  const itemById = new Map(c.items.map((it) => [it.id, it] as const));
  c.items.forEach((it, i) => {
    let sum = 0;
    it.components.forEach((cid, j) => {
      const comp = itemById.get(cid);
      if (!comp) dg.err(['items', i, 'components', j], unknownRef('item', cid, items));
      else if (cid === it.id) dg.err(['items', i, 'components', j], 'an item cannot be its own component');
      else sum += comp.cost;
    });
    if (sum > it.cost) dg.err(['items', i, 'cost'], `recipe does not sum: components cost ${sum} > total cost ${it.cost} (cost is the TOTAL price incl. components)`);
  });
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, trail: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const idx = c.items.findIndex((x) => x.id === id);
      dg.err(['items', idx, 'components'], `recipe cycle: ${[...trail.slice(trail.indexOf(id)), id].join(' → ')}`);
      return;
    }
    state.set(id, 1);
    for (const cid of itemById.get(id)?.components ?? []) if (itemById.has(cid) && cid !== id) visit(cid, [...trail, id]);
    state.set(id, 2);
  };
  for (const it of c.items) visit(it.id, []);
  c.items.forEach((it, i) => walkRecord(it, ['items', i], { clips: null, clipOwner: 'items use generic clip roles', forms: null }));

  // setup
  c.setup.boons.forEach((b, i) => { if (!paths.has(b.path)) dg.err(['setup', 'boons', i, 'path'], unknownRef('setup path', b.path, paths)); });
  c.setup.defaults.spells.forEach((s, i) => { if (!spells.has(s)) dg.err(['setup', 'defaults', 'spells', i], unknownRef('spell', s, spells)); });
  c.setup.defaults.boons.forEach((s, i) => { if (!boons.has(s)) dg.err(['setup', 'defaults', 'boons', i], unknownRef('boon', s, boons)); });
  if (c.setup.defaults.spells.length > c.setup.spellSlots) dg.err(['setup', 'defaults', 'spells'], `${c.setup.defaults.spells.length} default spells for ${c.setup.spellSlots} slots`);
  if (c.setup.defaults.boons.length > c.setup.boonSlots) dg.err(['setup', 'defaults', 'boons'], `${c.setup.defaults.boons.length} default boons for ${c.setup.boonSlots} slots`);
  walkRecord(c.setup, ['setup'], { clips: null, clipOwner: 'battle spells use generic clip roles', forms: null });

  // units + team buffs
  c.units.forEach((u, i) => {
    if (u.onTakedownTeamBuff !== undefined && !teamBuffs.has(u.onTakedownTeamBuff)) dg.err(['units', i, 'onTakedownTeamBuff'], unknownRef('team buff', u.onTakedownTeamBuff, teamBuffs));
    walkRecord(u, ['units', i], { clips: new Set(Object.keys(u.art.clips)), clipOwner: `unit ${u.id} art.clips`, forms: null });
  });
  c.teamBuffs.forEach((t, i) => walkRecord(t, ['teamBuffs', i], { clips: null, clipOwner: 'team buffs use generic clip roles', forms: null }));

  // maps
  const needUnit = (path: Seg[], id: string, kind: string): void => {
    if (!units.has(id)) dg.err(path, unknownRef('unit', id, units));
    else if (unitKind.get(id) !== kind) dg.err(path, `unit "${id}" is a ${unitKind.get(id)}, expected a ${kind}`);
  };
  c.maps.forEach((m, i) => {
    const p: Seg[] = ['maps', i];
    if (!music.has(m.art.music)) dg.err([...p, 'art', 'music'], unknownRef('music id (audio.music)', m.art.music, music));
    const lanes = checkUnique(m.lanes, (l) => l.id, [...p, 'lanes'], 'lane id', dg);
    const structs = checkUnique(m.structures, (s) => s.id, [...p, 'structures'], 'structure id', dg);
    checkUnique(m.camps, (s) => s.id, [...p, 'camps'], 'camp id', dg);
    checkUnique(m.pickups, (s) => s.id, [...p, 'pickups'], 'pickup id', dg);
    m.structures.forEach((s, j) => {
      needUnit([...p, 'structures', j, 'unit'], s.unit, 'structure');
      if (s.lane !== undefined && !lanes.has(s.lane)) dg.err([...p, 'structures', j, 'lane'], unknownRef('lane', s.lane, lanes));
      s.requires.forEach((r, k) => { if (!structs.has(r)) dg.err([...p, 'structures', j, 'requires', k], unknownRef('structure on this map', r, structs)); });
    });
    m.camps.forEach((cp, j) => cp.units.forEach((u, k) => needUnit([...p, 'camps', j, 'units', k, 'unit'], u.unit, 'monster')));
    m.pickups.forEach((pk, j) => needUnit([...p, 'pickups', j, 'unit'], pk.unit, 'pickup'));
    // every coordinate on the sim plane must be inside the map (CONTRACT §2)
    const [W, H] = m.size;
    const inside = (path: Seg[], v: readonly [number, number]): void => {
      if (!(v[0] >= 0 && v[0] <= W && v[1] >= 0 && v[1] <= H)) dg.err(path, `point (${v[0]}, ${v[1]}) is outside the map (0..${W}, 0..${H})`);
    };
    m.lanes.forEach((l, j) => l.path.forEach((v, k) => inside([...p, 'lanes', j, 'path', k], v)));
    m.bases.forEach((b, j) => { inside([...p, 'bases', j, 'spawn'], b.spawn); inside([...p, 'bases', j, 'fountain', 'at'], b.fountain.at); inside([...p, 'bases', j, 'shop', 'at'], b.shop.at); });
    m.spawns.forEach((v, j) => inside([...p, 'spawns', j], v));
    m.structures.forEach((s, j) => inside([...p, 'structures', j, 'at'], s.at));
    m.camps.forEach((cp, j) => cp.units.forEach((u, k) => inside([...p, 'camps', j, 'units', k, 'at'], u.at)));
    m.pickups.forEach((pk, j) => inside([...p, 'pickups', j, 'at'], pk.at));
    m.shops.forEach((s, j) => inside([...p, 'shops', j, 'at'], s.at));
  });

  // modes + queues (queue rules are overrides layered on the mode's rules)
  const mapById = new Map(c.maps.map((m) => [m.id, m] as const));
  const modeById = new Map(c.modes.map((m) => [m.id, m] as const));
  type RulesLike = Partial<CatalogT['modes'][number]['rules']>;
  const checkRules = (path: Seg[], rules: RulesLike, mapId: string | undefined): void => {
    rules.minionWaves?.composition.forEach((w, j) => needUnit([...path, 'minionWaves', 'composition', j, 'unit'], w.unit, 'minion'));
    const core = rules.end?.coreStructure;
    if (core !== undefined) {
      const placements = new Set(mapById.get(mapId ?? '')?.structures.map((s) => s.id) ?? []);
      if (!(units.has(core) && unitKind.get(core) === 'structure') && !placements.has(core)) {
        dg.err([...path, 'end', 'coreStructure'], `${unknownRef('structure unit', core, [...units].filter((u) => unitKind.get(u) === 'structure'))} (a structure UnitDef id, or a structure placement id on map "${mapId}")`);
      }
    }
  };
  c.modes.forEach((m, i) => {
    if (!maps.has(m.map)) dg.err(['modes', i, 'map'], unknownRef('map', m.map, maps));
    checkRules(['modes', i, 'rules'], m.rules, m.map);
    if (m.rules.end.kind === 'core' && m.rules.end.coreStructure === undefined) dg.err(['modes', i, 'rules', 'end', 'coreStructure'], 'end.kind "core" needs a coreStructure');
  });
  c.queues.forEach((q, i) => {
    const mode = modeById.get(q.mode);
    if (!mode) dg.err(['queues', i, 'mode'], unknownRef('mode', q.mode, modes));
    checkRules(['queues', i, 'rules'], q.rules, mode?.map);
  });

  // store
  c.store.offers.forEach((o, i) => {
    if (o.kind === 'skin' && !skins.has(o.ref)) dg.err(['store', 'offers', i, 'ref'], unknownRef('skin', o.ref, skins));
    if (o.kind === 'skin' && starter.has(o.ref)) dg.warn(['store', 'offers', i, 'ref'], `offers "${o.ref}", which every profile already owns (store.starterOwnership)`);
    if (!currencies.has(o.price.currency)) dg.err(['store', 'offers', i, 'price', 'currency'], unknownRef('currency', o.price.currency, currencies));
    for (const k of ['from', 'until'] as const) {
      const v = o[k];
      if (v !== undefined && Number.isNaN(Date.parse(v))) dg.err(['store', 'offers', i, k], `"${v}" is not a date (ISO 8601)`);
    }
    if (o.from && o.until && Date.parse(o.from) >= Date.parse(o.until)) dg.err(['store', 'offers', i, 'until'], `offer window ends (${o.until}) before it starts (${o.from})`);
  });
  c.store.shelves.forEach((s, i) => s.skus.forEach((sku, j) => { if (!skus.has(sku)) dg.err(['store', 'shelves', i, 'skus', j], unknownRef('offer sku', sku, skus)); }));
  c.store.starterOwnership.forEach((s, i) => { if (!skins.has(s)) dg.err(['store', 'starterOwnership', i], unknownRef('skin', s, skins)); });
  for (const cur of Object.keys(c.store.starterWallet)) if (!currencies.has(cur)) dg.err(['store', 'starterWallet', cur], unknownRef('currency', cur, currencies));

  // client
  c.client.modeSlots.forEach((s, i) => {
    if (s.status === 'live' && s.mode === null) dg.err(['client', 'modeSlots', i, 'mode'], 'a live mode slot needs a mode');
    if (s.mode !== null && !modes.has(s.mode)) dg.err(['client', 'modeSlots', i, 'mode'], unknownRef('mode', s.mode, modes));
  });

  // ranks read best in ascending order; the session layer relies on it for tier lookup
  for (let i = 1; i < c.ranks.length; i++) {
    if (c.ranks[i].minRating < c.ranks[i - 1].minRating) dg.err(['ranks', i, 'minRating'], 'ranks must be in ascending minRating order');
  }

  // scripts: every `script` op names a registered behaviour file (CONTRACT §5.3)
  for (const [id, path] of scriptFirstUse) {
    if (!existsSync(join(opts.scriptsDir, `${id}.ts`))) dg.err(path, `script "${id}" has no ${displayPath(join(opts.scriptsDir, `${id}.ts`))} (unknown script ids are a content build error)`);
  }
}

// ── 4. assets ───────────────────────────────────────────────────────────────────────────────────
function collectAssetRefs(data: Record<string, unknown>): Map<string, Seg[][]> {
  const refs = new Map<string, Seg[][]>();
  for (const [k, v] of Object.entries(data)) {
    if (k === 'strings' || k === 'botNames') continue;
    walkStrings(v, [k], (s, path) => {
      if (!s.startsWith('assets/')) return;
      const list = refs.get(s) ?? [];
      list.push(path);
      refs.set(s, list);
    });
  }
  return refs;
}

const dirCache = new Map<string, Set<string> | null>();
function exactCaseExists(abs: string): 'yes' | 'no' | 'case' {
  let st;
  try { st = statSync(abs); } catch { return 'no'; }
  if (!st.isFile()) return 'no';
  const dir = dirname(abs);
  let names = dirCache.get(dir);
  if (names === undefined) { try { names = new Set(readdirSync(dir)); } catch { names = null; } dirCache.set(dir, names); }
  return names && !names.has(basename(abs)) ? 'case' : 'yes';
}

function sniff(abs: string, ref: string): string | null {
  const ext = ref.slice(ref.lastIndexOf('.') + 1).toLowerCase();
  const fd = openSync(abs, 'r');
  const head = Buffer.alloc(64);
  let n: number;
  try { n = readSync(fd, head, 0, 64, 0); } finally { closeSync(fd); }
  const h = head.subarray(0, n);
  if (h.toString('latin1').startsWith('version https://git-lfs')) return 'is a Git LFS pointer, not the file (run `git lfs pull`)';
  const magic = (s: string, at = 0): boolean => h.subarray(at, at + s.length).toString('latin1') === s;
  switch (ext) {
    case 'glb': return magic('glTF') ? null : 'is not a GLB (missing "glTF" magic — failed export?)';
    case 'png': return magic('\x89PNG\r\n\x1a\n') ? null : 'is not a PNG';
    case 'jpg': case 'jpeg': return h[0] === 0xff && h[1] === 0xd8 ? null : 'is not a JPEG';
    case 'webp': return magic('RIFF') && magic('WEBP', 8) ? null : 'is not a WebP';
    case 'ogg': case 'opus': return magic('OggS') ? null : 'is not an Ogg file';
    case 'hdr': return magic('#?') ? null : 'is not a Radiance HDR (missing "#?" header)';
    case 'cube': return /LUT_3D_SIZE/.test(readFileSync(abs, 'latin1')) ? null : 'is not a .cube LUT (no LUT_3D_SIZE)';
    case 'json': try { JSON.parse(readFileSync(abs, 'utf8').replace(/^﻿/, '')); return null; } catch { return 'is not valid JSON'; }
    case 'svg': return /<svg[\s>]/.test(readFileSync(abs, 'utf8')) ? null : 'is not an SVG';
    default: return null;
  }
}

function resolveAssets(refs: Map<string, Seg[][]>, opts: BuildOptions, dg: Diagnostics): Map<string, AssetInfo> {
  const found = new Map<string, AssetInfo>();
  for (const [ref, paths] of refs) {
    const where = paths[0];
    const more = paths.length > 1 ? ` (and ${paths.length - 1} more use${paths.length > 2 ? 's' : ''})` : '';
    if (!ASSET_RE.test(ref)) continue; // zod already reported the malformed ref
    const rest = ref.slice('assets/'.length);
    if (rest.split('/').some((s) => s === '' || s === '.' || s === '..')) { dg.err(where, `asset ref "${ref}" has empty, "." or ".." segments`); continue; }
    const roots: { root: string; abs: string }[] = [
      { root: displayPath(opts.contentDir), abs: join(opts.contentDir, rest) },
      { root: displayPath(opts.artOutDir), abs: join(opts.artOutDir, rest) },
    ];
    if (rest.startsWith('audio/')) roots.push({ root: displayPath(opts.audioOutDir), abs: join(opts.audioOutDir, rest.slice('audio/'.length)) });
    let hit: { root: string; abs: string } | null = null;
    let caseMismatch = false;
    for (const r of roots) {
      const e = exactCaseExists(r.abs);
      if (hit) {
        // already resolved: only look for a shadowed copy further down the search order
        if (e === 'yes') { dg.warn(where, `asset "${ref}" also exists at ${displayPath(r.abs)} (shadowed by ${displayPath(hit.abs)})`); break; }
        continue;
      }
      if (e === 'case') {
        dg.err(where, `asset "${ref}": ${displayPath(r.abs)} differs in letter case from the file on disk (refs are case-sensitive on the CDN)${more}`);
        caseMismatch = true;
        break;
      }
      if (e === 'yes') hit = r;
    }
    if (caseMismatch) continue;
    if (!hit) {
      const msg = `asset not found: "${ref}"${more}; searched ${roots.map((r) => displayPath(r.abs)).join(', ')}`;
      if (opts.allowMissingAssets) dg.warn(where, msg + ' (--allow-missing-assets: ref left as is)');
      else dg.err(where, msg);
      continue;
    }
    const bad = sniff(hit.abs, ref);
    if (bad) { dg.err(where, `asset "${ref}" → ${displayPath(hit.abs)} ${bad}`); continue; }
    found.set(ref, { ref, abs: hit.abs, root: hit.root, bytes: statSync(hit.abs).size });
  }
  return found;
}

// ── 5. names ────────────────────────────────────────────────────────────────────────────────────
const NAME_KEYS = new Set(['name', 'title', 'label', 'headline', 'tagline', 'badge']);
const PROSE_KEYS = new Set(['desc', 'lore', 'job', 'body', 'sub', 'contract', 'note']);
function collectNames(data: Record<string, unknown>): { inputs: NameInput[]; paths: Seg[][] } {
  const inputs: NameInput[] = [];
  const paths: Seg[][] = [];
  const add = (path: Seg[], text: string, kind: TextKind): void => { paths.push(path); inputs.push({ path: String(paths.length - 1), text, kind }); };
  for (const [fam, v] of Object.entries(data)) {
    if (fam === 'vfx' || fam === 'audio') continue;            // engine data, never shown as text
    if (fam === 'botNames') { if (Array.isArray(v)) v.forEach((s, i) => typeof s === 'string' && add([fam, i], s, 'name')); continue; }
    if (fam === 'strings') {
      // UI copy, not the name of a game entity: prose rules (exact-name/strict tiers would flag
      // ordinary labels such as a shop tab that happens to equal a protected single word)
      if (isObj(v)) for (const [k, s] of Object.entries(v)) if (typeof s === 'string') add([fam, k], s, 'prose');
      continue;
    }
    walkObjects(v, [fam], (node, path) => {
      const last = path[path.length - 1];
      if (last === 'behavior' || last === 'terrain' || last === 'params' || last === 'layers') return 'skip';
      for (const [k, s] of Object.entries(node)) {
        if (typeof s === 'string') {
          if (NAME_KEYS.has(k)) add([...path, k], s, 'name');
          else if (PROSE_KEYS.has(k)) add([...path, k], s, 'prose');
        } else if (k === 'tips' && Array.isArray(s)) s.forEach((t, i) => typeof t === 'string' && add([...path, k, i], t, 'prose'));
      }
    });
  }
  return { inputs, paths };
}

// ── 6. emit catalogs + manifest ─────────────────────────────────────────────────────────────────
function readPrevManifest(outDir: string, dg: Diagnostics): CatalogManifest | null {
  const file = join(outDir, 'manifest.json');
  if (!existsSync(file)) return null;
  try {
    const m = JSON.parse(readFileSync(file, 'utf8')) as CatalogManifest;
    if (m.format !== MANIFEST_FORMAT || !isObj(m.schemas) || !Array.isArray(m.history)) throw new Error('unexpected shape');
    return m;
  } catch (e) {
    dg.fileErr(displayPath(file), `previous manifest is unreadable (${(e as Error).message}); fix or delete it — its history would be lost`);
    return null;
  }
}

function writeAtomic(file: string, data: string | Buffer): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, file);
}

const withoutBuiltAt = (c: Record<string, unknown>): string => JSON.stringify({ ...c, builtAt: null });

/** Write one catalog per reachable schema and the manifest. Exported for the schema probe, which
 *  drives it with a fake "schema 2" catalog and a registry holding an identity converter. */
export function emitCatalogs(args: {
  catalog: CatalogData; outDir: string; registry: MigrationRegistry; current: number; dg?: Diagnostics;
}): { manifest: CatalogManifest | null; emitted: EmittedSchema[]; warnings: Diag[]; errors: Diag[] } {
  const dg = args.dg ?? new Diagnostics();
  const { catalog, outDir, registry, current } = args;
  const version = String(catalog.version);
  const prev = readPrevManifest(outDir, dg);
  const emitted: EmittedSchema[] = [];
  if (dg.errors.length) return { manifest: null, emitted, warnings: dg.warnings, errors: dg.errors };

  for (const schema of registry.reachable(current)) {
    const data = schema === current ? catalog : registry.applyDown(catalog, schema);
    const rel = `schema-${schema}/${version}/catalog.json`;
    const file = join(outDir, rel);
    let text = JSON.stringify(data) + '\n';
    let unchanged = false;
    if (existsSync(file)) {
      try {
        const old = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (withoutBuiltAt(old) === withoutBuiltAt(data)) { unchanged = true; text = readFileSync(file, 'utf8'); }
        else dg.fileWarn(displayPath(file), `catalog changed but version "${version}" did not — overwriting; bump content/version.json before publishing (CDN caches key on the path)`);
      } catch { dg.fileWarn(displayPath(file), 'existing catalog unreadable — overwriting'); }
    }
    if (!unchanged) writeAtomic(file, text);
    emitted.push({ schema, version, catalog: rel, sha256: sha256(text), unchanged, bytes: Buffer.byteLength(text) });
  }

  const schemas: CatalogManifest['schemas'] = {};
  const emittedSet = new Set(emitted.map((e) => String(e.schema)));
  for (const [k, entry] of Object.entries(prev?.schemas ?? {})) {
    if (emittedSet.has(k)) continue;
    if (existsSync(join(outDir, entry.catalog))) {
      schemas[k] = entry;
      dg.fileWarn(displayPath(join(outDir, 'manifest.json')), `schema ${k} is no longer reachable from schema ${current}; keeping its last catalog (${entry.version}) frozen for old clients`, `$.schemas["${k}"]`);
    } else {
      dg.fileWarn(displayPath(join(outDir, 'manifest.json')), `schema ${k} dropped: not reachable and ${entry.catalog} is gone`, `$.schemas["${k}"]`);
    }
  }
  const history: ManifestHistoryEntry[] = [...(prev?.history ?? [])];
  for (const e of emitted) {
    schemas[String(e.schema)] = { version: e.version, catalog: e.catalog, sha256: e.sha256 };
    const before = prev?.schemas[String(e.schema)];
    if (!before || before.version !== e.version || before.sha256 !== e.sha256) {
      const builtAt = String((JSON.parse(readFileSync(join(outDir, e.catalog), 'utf8')) as { builtAt?: unknown }).builtAt ?? '');
      history.push({ schema: e.schema, version: e.version, builtAt });
    }
  }
  const manifest: CatalogManifest = { format: MANIFEST_FORMAT, product: MANIFEST_PRODUCT, schemas, history };
  writeAtomic(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return { manifest, emitted, warnings: dg.warnings, errors: dg.errors };
}

// ── the build ───────────────────────────────────────────────────────────────────────────────────
export function defaultOptions(over: Partial<BuildOptions> = {}): BuildOptions {
  const contentDir = resolve(over.contentDir ?? join(PROJECT_ROOT, 'content'));
  return {
    contentDir,
    outDir: resolve(over.outDir ?? join(PROJECT_ROOT, 'dist-catalog')),
    check: over.check ?? false,
    allowMissingAssets: over.allowMissingAssets ?? false,
    designDir: resolve(over.designDir ?? DEFAULT_DESIGN_DIR),
    artOutDir: resolve(over.artOutDir ?? join(contentDir, '..', 'art', 'out')),
    audioOutDir: resolve(over.audioOutDir ?? join(contentDir, '..', 'audio', 'out')),
    scriptsDir: resolve(over.scriptsDir ?? join(PROJECT_ROOT, 'src', 'sim', 'scripts')),
    registry: over.registry ?? MIGRATIONS,
    builtAt: over.builtAt,
    quiet: over.quiet ?? false,
  };
}

export function buildContent(opts: BuildOptions): BuildResult {
  const dg = new Diagnostics();
  const epoch = process.env.SOURCE_DATE_EPOCH;
  const builtAt = opts.builtAt ?? (epoch && /^\d+$/.test(epoch) ? new Date(Number(epoch) * 1000) : new Date()).toISOString();
  const result: BuildResult = { ok: false, errors: dg.errors, warnings: dg.warnings, counts: [], assets: [], emitted: [], namesChecked: false };

  const loaded = loadSources(opts.contentDir, builtAt, dg);
  if (!loaded) return result;
  const raw = loaded.raw;

  const parsed = Catalog.safeParse(raw);
  if (!parsed.success) reportIssues(parsed.error.issues as unknown as IssueLike[], [], dg);
  const data = (parsed.success ? parsed.data : raw) as Record<string, unknown>;

  if (parsed.success) semanticChecks(parsed.data, opts, dg);
  else if (!opts.quiet) dg.fileWarn('(build)', 'schema errors present — cross-reference checks are skipped until they are fixed');

  // assets + names run on raw data too, so one pass shows as many problems as possible
  const refs = collectAssetRefs(data);
  const assets = resolveAssets(refs, opts, dg);

  const deny = loadDenyList(opts.designDir);
  for (const w of deny.warnings) dg.fileWarn(displayPath(opts.designDir), w);
  if (deny.sources.length === 0) {
    dg.fileWarn(displayPath(opts.designDir), 'no deny-list (research/protected_names.json, NAMES_NOT_USED.md) — originality names check SKIPPED');
  } else {
    result.namesChecked = true;
    const { inputs, paths } = collectNames(data);
    for (const h of checkNames(inputs, deny)) dg.err(paths[Number(h.path)], `deny-listed name: ${formatHit(h)}`);
  }

  // counts (from whatever we have)
  const len = (v: unknown): number => Array.isArray(v) ? v.length : isObj(v) ? Object.keys(v).length : 0;
  const d = data as Record<string, Record<string, unknown>>;
  result.counts = [
    ['fighters', len(d.fighters)], ['skins', len(d.skins)], ['items', len(d.items)], ['units', len(d.units)],
    ['maps', len(d.maps)], ['modes', len(d.modes)], ['queues', len(d.queues)], ['roles', len(d.roles)],
    ['resources', len(d.resources)], ['teamBuffs', len(d.teamBuffs)], ['ranks', len(d.ranks)], ['vfx', len(d.vfx)],
    ['audio.cues', len(d.audio?.cues)], ['audio.music', len(d.audio?.music)],
    ['setup.spells', len(d.setup?.spells)], ['setup.boons', len(d.setup?.boons)],
    ['store.offers', len(d.store?.offers)], ['store.shelves', len(d.store?.shelves)],
    ['client.modeSlots', len(d.client?.modeSlots)], ['strings', len(d.strings)], ['botNames', len(d.botNames)],
  ];
  result.assets = [...assets.values()];

  if (dg.errors.length || !parsed.success) return result;
  result.catalog = parsed.data;
  if (opts.check) { result.ok = true; return result; }

  // copy assets content-addressed, rewrite refs
  const assetsDir = join(opts.outDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const rewrite = new Map<string, string>();
  const byOut = new Map<string, string>();
  for (const a of assets.values()) {
    const bytes = readFileSync(a.abs);
    a.sha256 = sha256(bytes);
    const outName = `${a.sha256.slice(0, 12)}-${basename(a.ref)}`;
    const prevSha = byOut.get(outName);
    if (prevSha && prevSha !== a.sha256) { dg.fileErr(displayPath(a.abs), `content-address collision on ${outName}`); continue; }
    byOut.set(outName, a.sha256);
    a.out = `assets/${outName}`;
    const dest = join(assetsDir, outName);
    if (!existsSync(dest) || statSync(dest).size !== bytes.length) copyFileSync(a.abs, dest);
    rewrite.set(a.ref, a.out);
  }
  if (dg.errors.length) return result;
  const rewritten: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    rewritten[k] = k === 'strings' || k === 'botNames' ? v : mapStrings(v, (s) => rewrite.get(s) ?? s);
  }
  const recheck = Catalog.safeParse(rewritten);
  if (!recheck.success) { reportIssues(recheck.error.issues as unknown as IssueLike[], [], dg); return result; }

  const out = emitCatalogs({ catalog: recheck.data as unknown as CatalogData, outDir: opts.outDir, registry: opts.registry, current: SCHEMA_VERSION, dg });
  result.emitted = out.emitted;
  result.manifest = out.manifest ?? undefined;
  result.ok = dg.errors.length === 0;
  return result;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const USAGE = `usage: node tools/build_content.ts [--check] [--content <dir>] [--out <dir>] [--allow-missing-assets]
                                    [--design <dir>] [--art-out <dir>] [--audio-out <dir>] [--scripts <dir>] [--quiet]`;

export function parseArgs(argv: string[]): BuildOptions | string {
  const over: Partial<BuildOptions> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = (): string => { const v = argv[++i]; if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`); return v; };
    try {
      switch (a) {
        case '--check': over.check = true; break;
        case '--allow-missing-assets': over.allowMissingAssets = true; break;
        case '--quiet': over.quiet = true; break;
        case '--content': over.contentDir = resolve(val()); break;
        case '--out': over.outDir = resolve(val()); break;
        case '--design': over.designDir = resolve(val()); break;
        case '--art-out': over.artOutDir = resolve(val()); break;
        case '--audio-out': over.audioOutDir = resolve(val()); break;
        case '--scripts': over.scriptsDir = resolve(val()); break;
        case '-h': case '--help': return USAGE;
        default: return `unknown argument "${a}"\n${USAGE}`;
      }
    } catch (e) { return `${(e as Error).message}\n${USAGE}`; }
  }
  return defaultOptions(over);
}

function printSummary(r: BuildResult, opts: BuildOptions): void {
  const rows: [string, string][] = r.counts.map(([k, n]) => [k, String(n)]);
  const total = r.assets.reduce((s, a) => s + a.bytes, 0);
  rows.push(['assets', `${r.assets.length} files, ${fmtBytes(total)}`]);
  rows.push(['names check', r.namesChecked ? 'ran' : 'SKIPPED (no deny-list)']);
  for (const e of r.emitted) rows.push([`schema ${e.schema}`, `${e.catalog} (${fmtBytes(e.bytes)}, sha256 ${e.sha256.slice(0, 12)}…${e.unchanged ? ', unchanged' : ''})`]);
  const w = Math.max(...rows.map(([k]) => k.length));
  console.log(`\nVALE content ${opts.check ? 'check' : 'build'} — ${displayPath(opts.contentDir)}${opts.check ? '' : ` → ${displayPath(opts.outDir)}`}`);
  for (const [k, v] of rows) console.log(`  ${k.padEnd(w)}  ${v}`);
}

export function runCli(argv: string[]): number {
  const opts = parseArgs(argv);
  if (typeof opts === 'string') { (opts === USAGE ? console.log : console.error)(opts); return opts === USAGE ? 0 : 2; }
  let r: BuildResult;
  try { r = buildContent(opts); } catch (e) { console.error(`build_content: internal error: ${(e as Error).stack ?? e}`); return 2; }
  for (const w of r.warnings) console.warn(`warn  ${formatDiag(w)}`);
  for (const e of r.errors) console.error(`error ${formatDiag(e)}`);
  if (!opts.quiet || !r.ok) printSummary(r, opts);
  if (!r.ok) { console.error(`\nFAILED: ${r.errors.length} error${r.errors.length === 1 ? '' : 's'}, ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}`); return 1; }
  console.log(`\nOK${opts.check ? ' (check only, nothing written)' : ''}: ${r.warnings.length} warning${r.warnings.length === 1 ? '' : 's'}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = runCli(process.argv.slice(2));
