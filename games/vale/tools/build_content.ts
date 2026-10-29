// VALE — content build (CONTRACT §3). content/ → dist-catalog/ (manifest + per-schema catalogs + assets).
//
//   node tools/build_content.ts                       build content/ → dist-catalog/
//   node tools/build_content.ts --check               validate only; writes nothing
//   flags: --content <dir>  --out <dir>  --allow-missing-assets  --design <dir>  --art-out <dir>
//          --audio-out <dir>  --scripts <dir>  --quiet  --prune  --keep-png
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
// FORMAT FALLBACK (CONTRACT §11): every resolved .ogg must have an AAC .m4a sibling next to it (the audio
// builds write audio/out/<x>.m4a); it ships content-addressed like any asset and the build writes
// audio.m4a = { <.ogg ref>: <.m4a ref> } into the catalog (content never lists it). A missing sibling is
// an error (a warning under --allow-missing-assets).
// IMAGE TRANSCODE (perf PERF-m1): a PNG used only as a splash or a portrait (the loading screen, draft, collection and
// store art: 1600×900 and 512² paintings) ships as lossy WebP (quality 90, PSNR ≈ 41-44 dB on the dusk plates, about a
// tenth of the PNG's bytes). The build encodes it with Pillow through the project's Python (VALE_PYTHON, else the repo's
// .venv, else python3 on PATH), caches the result by the PNG's sha256 in node_modules/.cache/vale-content/webp, and
// rewrites the ref to assets/<sha256-12>-<name>.webp. Images under 32 KB, a WebP that comes out larger, and a machine
// without Pillow keep the PNG (the last with a warning). --keep-png ships every PNG as is. --check encodes nothing.
// PRUNE (perf PERF-m2): --prune deletes every file in <out>/assets that no catalog the new manifest lists refers to
// (old builds' leftovers: a content-addressed name changes with every edit of the source file).
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
// script ids → src/sim/scripts/<id>.ts) · VFX layer vocabulary (§9.5: types, keys, values; preset
// naming is a warning) · presentation rules (r12: delayed areas that hurt enemies are telegraphed to
// everyone and warn >= 0.6 s; fighter VFX signatures in range and apart) · required fighter clips (§12) · every fighter has a base
// skin in store.starterOwnership · every asset ref resolves · deny-listed names (tools/names_check.ts)
// · player copy (src/ui/copy_lint.ts: VALE's words, American spelling, stat display names; COPY_LINT_PENDING warns)
// · item recipes (component costs ≤ total, no cycles) · kit completeness (passive + a1 a2 a3 ult,
// each with icon, non-blank desc, ai hint) · map coordinates inside the map · nav grid size ·
// UnitDef.behavior against the sim's vocabulary (src/sim/units/behavior_keys.ts: known keys for the
// unit's kind, value shapes, priority tokens); pickup `grant` effects are zod-parsed like every
// other effect list and emitted WITH their defaults (the schema types behavior as free-form).

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, copyFileSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync,
  renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalog, ClipRole, Effect, SCHEMA_VERSION, type CatalogT } from '../src/contracts/catalog.ts';
import { BEHAVIOR_KEYS, DAMAGE_MULT_KINDS, PRIORITY_TOKENS } from '../src/sim/units/behavior_keys.ts';
import { VFX_TEXTURE_NAMES } from '../src/render/vfx/atlas.ts';
import { VFX_SHAPES } from '../src/render/vfx/shapes.ts';
import { SCREEN_MUSIC_KINDS, STING_KINDS, UI_CUE_KINDS, UI_CUE_KINDS_OPTIONAL } from '../src/ui/audio_kinds.ts';
import { MANIFEST_FORMAT, MANIFEST_PRODUCT, type CatalogManifest, type ManifestHistoryEntry } from '../src/contracts/manifest.ts';
import { checkNames, DEFAULT_DESIGN_DIR, formatHit, loadDenyList, type NameInput, type TextKind } from './names_check.ts';
import { formatCopyHit, lintPlayerCopy } from '../src/ui/copy_lint.ts';
import { bansForRoster } from '../src/session/draft.ts';
import { fighterPool } from '../src/session/setup.ts';
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
  /** --prune: delete <out>/assets files no listed catalog refers to (build mode only) */
  prune?: boolean;
  /** --keep-png: ship splash / portrait PNGs as they are (no WebP transcode) */
  keepPng?: boolean;
}
export interface AssetInfo { ref: string; abs: string; root: string; bytes: number; out?: string; sha256?: string;
  /** set on an .m4a format-fallback sibling: the .ogg ref it stands in for (CONTRACT §11) */
  altOf?: string;
  /** perf PERF-m1: the PNG this asset was transcoded from (abs is then the cached WebP) and its bytes */
  encodedFrom?: { abs: string; bytes: number } }
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
  /** perf PERF-m1: splash / portrait PNGs shipped as WebP (encoded now, from the cache, kept as PNG) */
  webp?: { encoded: number; cached: number; kept: number };
  /** perf PERF-m2: --prune's deletions */
  pruned?: { files: number; bytes: number };
}

interface Origin { file: string; prefix: Seg[] }
interface FamilyOrigin { whole: Origin; items?: Origin[] }

// ── family table (CONTRACT §1 → Catalog keys) ───────────────────────────────────────────────────
type FamilyShape = 'array' | 'object' | 'recordPerFile' | 'arrayPerFile';
interface Family { key: keyof CatalogT & string; path: string; shape: FamilyShape }
const FAMILIES: Family[] = [
  { key: 'roles', path: 'roles.json', shape: 'array' },
  { key: 'classes', path: 'classes.json', shape: 'array' },
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

/** families the player-copy lint skips: engine data, never shown as text (strings.en.json is linted as the strings table) */
const COPY_LINT_SKIP = new Set(['vfx', 'audio', 'strings']);
interface Loaded {
  raw: Record<string, unknown>;
  version: unknown;
  /** every parsed source file outside COPY_LINT_SKIP, by its path relative to the content dir (the player-copy lint) */
  files: Record<string, unknown>;
}
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
  const files: Record<string, unknown> = {};
  const keepForLint = (fam: Family, abs: string, v: unknown): void => { if (!COPY_LINT_SKIP.has(fam.key)) files[relative(contentDir, abs).replace(/\\/g, '/')] = v; };
  for (const fam of FAMILIES) {
    const abs = join(contentDir, fam.path);
    const file = displayPath(abs);
    if (fam.shape === 'object' || fam.shape === 'array') {
      dg.origins[fam.key] = { whole: { file, prefix: [] } };
      if (!existsSync(abs)) { dg.fileErr(file, `missing (catalog.${fam.key})`); dg.missing.add(fam.key); continue; }
      const v = readJsonFile(abs, dg);
      if (v === undefined) { dg.missing.add(fam.key); continue; }
      keepForLint(fam, abs, v);
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
      keepForLint(fam, f, v);
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
  return { raw, version, files };
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
  const classes = checkUnique(c.classes, (r) => r.id, ['classes'], 'class id', dg);
  c.fighters.forEach((f, fi) => {
    if (!classes.has(f.class)) dg.err(['fighters', fi, 'class'], `unknown class "${f.class}"`);
  });
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
  for (const [k, tbl] of [['vfxEvents', c.client.vfxEvents], ['vfxStatus', c.client.vfxStatus]] as const) for (const [role, id] of Object.entries(tbl)) if (!vfx.has(id)) dg.err(['client', k, role], unknownRef('vfx id', id, vfx));
  const currencies = checkUnique(c.store.currencies, (x) => x.id, ['store', 'currencies'], 'currency id', dg);
  const skus = checkUnique(c.store.offers, (o) => o.sku, ['store', 'offers'], 'offer sku', dg);
  checkUnique(c.store.shelves, (s) => s.id, ['store', 'shelves'], 'shelf id', dg);
  const spells = checkUnique(c.setup.spells, (s) => s.id, ['setup', 'spells'], 'spell id', dg);
  const boons = checkUnique(c.setup.boons, (b) => b.id, ['setup', 'boons'], 'boon id', dg);
  const paths = checkUnique(c.setup.paths, (p) => p.id, ['setup', 'paths'], 'path id', dg);
  checkUnique(c.client.home.tiles, (t) => t.id, ['client', 'home', 'tiles'], 'home tile id', dg);
  const cues = new Set(Object.keys(c.audio.cues));
  const music = new Set(Object.keys(c.audio.music));
  if (c.audio.m4a !== undefined) dg.err(['audio', 'm4a'], 'audio.m4a is written by the content build (each .ogg\'s .m4a sibling, CONTRACT §11); remove it from content');
  for (const [role, cue] of Object.entries(c.audio.events)) if (!cues.has(cue)) dg.err(['audio', 'events', role], unknownRef('audio cue', cue, cues));
  // each map's ambience emitters (audio.ambience, systems-10): keyed by a map that exists, playing cues that exist
  for (const [map, list] of Object.entries(c.audio.ambience)) {
    if (!maps.has(map)) dg.err(['audio', 'ambience', map], unknownRef('map id', map, maps));
    list.forEach((a, i) => { if (!cues.has(a.cue)) dg.err(['audio', 'ambience', map, i, 'cue'], unknownRef('audio cue', a.cue, cues)); });
  }
  // the client's own sound roles (src/ui/audio_kinds.ts) must all be bound, to cues / beds that exist
  const roleSets: [ 'ui' | 'screens' | 'stings', readonly string[], Set<string>, string][] = [
    ['ui', UI_CUE_KINDS, cues, 'audio cue'], ['screens', SCREEN_MUSIC_KINDS, music, 'music bed'], ['stings', STING_KINDS, cues, 'audio cue']];
  for (const [key, kinds, known, what] of roleSets) {
    const bound = c.audio[key];
    for (const k of kinds) if (!(k in bound)) dg.err(['audio', key], `the client plays "${k}" but audio.${key} does not bind it (src/ui/audio_kinds.ts)`);
    for (const [role, id] of Object.entries(bound)) {
      // optional ui roles (UI_CUE_KINDS_OPTIONAL) play when bound and skip silently when not: neither state is a diagnostic
      if (!kinds.includes(role) && !(key === 'ui' && (UI_CUE_KINDS_OPTIONAL as readonly string[]).includes(role))) dg.warn(['audio', key, role], `audio.${key}.${role} is not a role the client plays (src/ui/audio_kinds.ts)`);
      if (!known.has(id)) dg.err(['audio', key, role], unknownRef(what, id, known));
    }
  }
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
        for (const k of ['vfx', 'hitVfx', 'windupVfx'] as const) if (typeof node[k] === 'string' && !vfx.has(node[k] as string)) dg.err([...path, k], unknownRef('vfx id', node[k], vfx));
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
  walkRecord(c.setup, ['setup'], { clips: null, clipOwner: 'Hour spells use generic clip roles', forms: null });

  // units + team buffs
  c.units.forEach((u, i) => {
    if (u.onTakedownTeamBuff !== undefined && !teamBuffs.has(u.onTakedownTeamBuff)) dg.err(['units', i, 'onTakedownTeamBuff'], unknownRef('team buff', u.onTakedownTeamBuff, teamBuffs));
    walkRecord(u, ['units', i], { clips: new Set(Object.keys(u.art.clips)), clipOwner: `unit ${u.id} art.clips`, forms: null });
    // per-team models (CONTRACT §12): GLBs like art.model (existence + magic are checked with every asset ref, §3.6)
    u.art.teamModels?.forEach((ref, k) => {
      if (!/\.glb$/i.test(ref)) dg.err(['units', i, 'art', 'teamModels', k], `team model "${ref}" must be a .glb (like art.model)`);
    });
    // r12 M9 structure states: vfx refs resolve, thresholds descend, only structures carry them
    const dmg = u.art.damage, ruin = u.art.ruin;
    if ((dmg || ruin) && u.kind !== 'structure') dg.err(['units', i, 'art'], `art.damage / art.ruin are for structures; "${u.id}" is a ${u.kind}`);
    if (dmg?.vfx !== undefined && !vfx.has(dmg.vfx)) dg.err(['units', i, 'art', 'damage', 'vfx'], unknownRef('vfx id', dmg.vfx, vfx));
    if (dmg && dmg.at.some((x, k) => k > 0 && x >= dmg.at[k - 1])) dg.err(['units', i, 'art', 'damage', 'at'], `damage thresholds must descend (got ${dmg.at.join(', ')})`);
    for (const k of ['breakVfx', 'landVfx'] as const) {
      const id = ruin?.[k];
      if (id !== undefined && !vfx.has(id)) dg.err(['units', i, 'art', 'ruin', k], unknownRef('vfx id', id, vfx));
    }
    if (ruin && ruin.height > u.art.height) dg.err(['units', i, 'art', 'ruin', 'height'], `ruin height ${ruin.height} m is taller than the structure (${u.art.height} m)`);
    checkBehavior(u, ['units', i, 'behavior'], dg);
    // effect lists inside behavior (pickup grants) get the same reference checks as any other
    for (const [k, v] of Object.entries(u.behavior)) {
      if (Array.isArray(v) && BEHAVIOR_KEYS[u.kind]?.[k] === 'effects') walkRecord(v, ['units', i, 'behavior', k], { clips: null, clipOwner: 'pickup grants use generic clip roles', forms: null });
    }
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
    // the sim allocates ~40 bytes per nav cell (walls, obstacles, components, A* scratch): a navCell
    // typo (0.05 for 0.5) must fail here, not as an out-of-memory tab
    const cells = Math.ceil(W / m.navCell) * Math.ceil(H / m.navCell);
    if (cells > MAX_NAV_CELLS) dg.err([...p, 'navCell'], `navCell ${m.navCell} gives ${cells.toLocaleString('en')} nav cells for a ${W}×${H} map (max ${MAX_NAV_CELLS.toLocaleString('en')}); use a larger cell`);
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
    // W4 polish: fighterWeights keys are FighterDef ids (the zod record takes any string)
    for (const id of Object.keys(rules.fighterWeights ?? {})) if (!fighters.has(id)) dg.err([...path, 'fighterWeights', id], unknownRef('fighter', id, fighters));
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
  // W4 polish: a draft's bansPerTeam is its bansByRoster step for today's playable roster (bansForRoster, session/draft.ts;
  // the fighters with art and a skin, session/setup.ts fighterPool), so every reader of bansPerTeam stays right as the
  // roster grows (probe_sim_draft_pace G8 checks the same)
  const roster = fighterPool(c).length;
  c.queues.forEach((q, i) => {
    const mode = modeById.get(q.mode);
    if (!mode) dg.err(['queues', i, 'mode'], unknownRef('mode', q.mode, modes));
    checkRules(['queues', i, 'rules'], q.rules, mode?.map);
    const d = q.draft;
    if (d?.bansByRoster?.length) {
      const want = bansForRoster(d, roster);
      if (d.bansPerTeam !== want) dg.err(['queues', i, 'draft', 'bansPerTeam'], `${d.bansPerTeam} is not the bansByRoster step for today's ${roster} playable fighters (${want})`);
    }
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

// ── 3a. UnitDef.behavior (CONTRACT §5.4) ──────────────────────────────────────────────────────────
const MAX_NAV_CELLS = 2_000_000;
const EffectList = Effect.array();
/** validate one unit's behavior against the sim's vocabulary; parses effect lists in place (defaults applied) */
function checkBehavior(u: CatalogT['units'][number], path: Seg[], dg: Diagnostics): void {
  const b = u.behavior as Record<string, unknown>;
  const allowed: Record<string, string> = { ...BEHAVIOR_KEYS.any, ...(BEHAVIOR_KEYS[u.kind] ?? {}) };
  for (const [k, v] of Object.entries(b)) {
    const p = [...path, k];
    const shape = allowed[k];
    if (!shape) {
      const readFor = Object.entries(BEHAVIOR_KEYS).filter(([, keys]) => k in keys).map(([kind]) => kind);
      dg.err(p, readFor.length ? `behavior "${k}" is not read for ${u.kind} units (only: ${readFor.join(', ')})`
        : unknownRef(`behavior key for a ${u.kind}`, k, Object.keys(allowed)));
      continue;
    }
    switch (shape) {
      case 'number': if (typeof v !== 'number' || !Number.isFinite(v)) dg.err(p, `expected a number, got ${JSON.stringify(v)}`); break;
      case 'boolean': if (typeof v !== 'boolean') dg.err(p, `expected true or false, got ${JSON.stringify(v)}`); break;
      case 'targetRules': if (v !== 'tower' && v !== 'none') dg.err(p, `expected "tower" or "none", got ${JSON.stringify(v)}`); break;
      case 'priority':
        if (!Array.isArray(v)) { dg.err(p, `expected an array of priority tokens (${PRIORITY_TOKENS.join(', ')})`); break; }
        v.forEach((t, j) => { if (typeof t !== 'string' || !PRIORITY_TOKENS.includes(t)) dg.err([...p, j], unknownRef('priority token', t, PRIORITY_TOKENS)); });
        break;
      case 'kindMults':
        if (!isObj(v)) { dg.err(p, `expected { <entity kind>: multiplier } (kinds: ${DAMAGE_MULT_KINDS.join(', ')})`); break; }
        for (const [kind, m] of Object.entries(v)) {
          if (!DAMAGE_MULT_KINDS.includes(kind)) dg.err([...p, kind], unknownRef('entity kind', kind, DAMAGE_MULT_KINDS));
          else if (typeof m !== 'number' || !Number.isFinite(m) || m < 0) dg.err([...p, kind], `expected a non-negative multiplier, got ${JSON.stringify(m)}`);
        }
        break;
      case 'effects': {
        const r = EffectList.safeParse(v);
        if (!r.success) reportIssues(r.error.issues as unknown as IssueLike[], p, dg);
        else b[k] = r.data;   // emitted parsed: the sim relies on defaulted fields (`to`, `pierce`, …)
        break;
      }
    }
  }
}

// ── 3b. VFX layer vocabulary (CONTRACT §9.5, v1 + CHANGED(RENDER) v2) ──────────────────────────────
// VfxDef.layers is z.record(unknown) in the schema; §9.5 is its real contract. The renderer ignores
// unknown keys, so the build is the only place a typo ("lifetime", "colour") gets caught. Texture and
// mesh-shape names come from the renderer itself (one list, no drift).
type VfxKind = 'num' | 'nonneg' | 'unit' | 'int' | 'bool' | 'str' | 'range' | 'pair' | 'vec3' | 'curve' | 'gradient' | 'color' | 'color2'
  | 'bursts' | 'enum' | 'clips';
type VfxKey = VfxKind | [ 'enum', readonly string[] ];
const E = (...v: string[]): VfxKey => ['enum', v];
const AT = E('origin', 'caster', 'target', 'path', 'ground');
const BLEND = E('add', 'alpha', 'ink', 'chip');
const TEX: VfxKey = ['enum', VFX_TEXTURE_NAMES];
/** the swing clips a layer's `clip` may name (the attack roles of ClipRole) */
const VFX_CLIPS: readonly string[] = ClipRole.options.filter((r) => r === 'attack1' || r === 'attack2' || r === 'crit');
const VFX_COMMON: Record<string, VfxKey> = {
  delay: 'nonneg', at: AT, phase: E('main', 'windup', 'release'), socket: 'str', offset: 'vec3', follow: 'bool', fit: 'bool', secondary: 'bool', chance: 'unit',
  repeat: 'nonneg', fitTime: 'bool', clip: 'clips',
};
const EMITTER: Record<string, VfxKey> = {
  count: 'int', rate: 'nonneg', perMeter: 'nonneg', bursts: 'bursts', duration: 'num',
  shape: E('point', 'sphere', 'ring', 'disc', 'cone', 'line', 'path', 'aura'), radius: 'nonneg', radiusInner: 'nonneg', angleDeg: 'num',
  length: 'nonneg', width: 'nonneg', surface: 'bool', height: 'nonneg',
  dir: E('up', 'out', 'in', 'forward', 'back', 'down', 'normal', 'random', 'none'), spreadDeg: 'num', speed: 'range', velocity: 'vec3', inherit: 'num',
  life: 'range', gravity: 'num', drag: 'nonneg', turbulence: 'nonneg', turbulenceScale: 'nonneg', orbitDeg: 'num', radial: 'num', bounce: 'unit', collide: 'bool',
  size: 'curve', sizeVar: 'range', stretch: 'nonneg', rotDeg: 'range', spinDeg: 'range',
  color: 'gradient', alpha: 'curve', emissive: 'curve', erode: 'curve',
  texture: TEX, frame: 'int', fps: 'nonneg', blend: BLEND, soft: 'nonneg', rim: 'color', rimAlpha: 'unit',
  align: E('camera', 'velocity', 'ground', 'axis'), aspect: 'nonneg', space: E('world', 'local'), hold: 'unit', max: 'int',
};
const RIBBON: Record<string, VfxKey> = {
  width: 'curve', life: 'nonneg', color: 'gradient', alpha: 'curve', emissive: 'nonneg', noise: 'unit', scroll: 'num', tile: 'nonneg',
  blend: BLEND, rim: 'color', rimAlpha: 'unit', minDist: 'nonneg', face: E('camera', 'ground'), texture: TEX, span: 'nonneg',
  arcRadius: 'nonneg', arcDeg: 'pair', arcTiltDeg: 'num', arcHeight: 'num', arcEase: 'nonneg',
};
const SHOCKWAVE: Record<string, VfxKey> = {
  radius: 'curve', width: 'curve', life: 'nonneg', color: 'gradient', alpha: 'curve', emissive: 'curve', sharp: 'nonneg', noise: 'unit',
  inner: 'unit', blend: BLEND, distort: 'nonneg', mode: E('flat', 'vertical'),
};
const VFX_LAYERS: Record<string, Record<string, VfxKey>> = {
  // v1 (still valid; parsed with their v1 meaning) — burst also takes every emitter key
  burst: { ...EMITTER, color: 'color2' },
  trail: { ...RIBBON, width: 'nonneg', alpha: 'unit' },
  ring: { ...SHOCKWAVE, radius: 'pair' },
  // v2
  emitter: EMITTER,
  sprite: { ...EMITTER, life: 'nonneg' },
  ribbon: RIBBON,
  shockwave: SHOCKWAVE,
  beam: {
    width: 'nonneg', life: 'nonneg', color: 'gradient', alpha: 'curve', emissive: 'nonneg', noise: 'nonneg', freq: 'nonneg', scroll: 'num',
    flare: 'nonneg', flareTexture: TEX, taper: 'pair', core: 'nonneg', blend: BLEND, from: AT, to: AT, texture: TEX, hold: 'unit',
  },
  flash: { radius: 'nonneg', life: 'nonneg', color: 'color', intensity: 'nonneg', texture: TEX, core: 'color', light: 'bool' },
  mesh: {
    shape: ['enum', VFX_SHAPES], scale: 'curve', stretch: 'vec3', life: 'nonneg', color: 'gradient', alpha: 'curve', emissive: 'curve',
    rim: 'color', rimPow: 'nonneg', rimEmissive: 'nonneg', noiseScale: 'nonneg', scroll: 'pair', noise: 'unit', dissolve: 'curve',
    edge: 'color', edgeWidth: 'nonneg', edgeEmissive: 'nonneg', mask: E('none', 'band', 'top', 'sweep', 'ends', 'edge'), maskParam: 'curve',
    blend: BLEND, spinDeg: 'num', rotateDeg: 'vec3', align: E('dir', 'flat', 'velocity', 'camera', 'up'), wobble: 'nonneg', twist: 'num',
    angleDeg: 'nonneg', hold: 'unit',
  },
  decal: {
    shape: E('circle', 'ring', 'cone', 'rect', 'line'), style: E('plain', 'scorch', 'crack', 'ink', 'frost', 'light'), radius: 'curve',
    life: 'nonneg', color: 'gradient', alpha: 'curve', emissive: 'curve', rim: 'color', texture: TEX, angleDeg: 'nonneg', length: 'nonneg', width: 'nonneg',
    hold: 'unit', rotateDeg: 'num',
  },
  light: { color: 'color', intensity: 'nonneg', radius: 'nonneg', life: 'nonneg', attack: 'nonneg', flicker: 'unit' },
  distort: { mode: E('ring', 'haze', 'bulge'), size: 'curve', strength: 'curve', life: 'nonneg', align: E('camera', 'ground') },
  feel: { shake: 'unit', who: E('self', 'all'), hitFlash: 'nonneg', hitStop: 'nonneg', squash: 'nonneg',
    exposure: 'nonneg', exposureRadius: 'nonneg', exposureHold: 'nonneg', exposureFade: 'nonneg', exposureDip: 'unit', exposureDesat: 'unit',
    exposureRepeat: 'unit' },
  bind: { event: 'str' },
};
const isColor = (v: unknown): boolean => typeof v === 'string' && (/^#[0-9a-fA-F]{6}$/.test(v) || v === 'team' || v === 'element' || v === 'signature' || v === 'secondary');
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isNumPair = (v: unknown): boolean => Array.isArray(v) && v.length === 2 && v.every(isNum);
const isKeys = (v: unknown, val: (x: unknown) => boolean): boolean => Array.isArray(v) && v.length > 0 && v.every((k) => Array.isArray(k) && k.length === 2 && isNum(k[0]) && k[0] >= 0 && k[0] <= 1 && val(k[1]));
function vfxValueError(kind: VfxKey, v: unknown): string | null {
  if (Array.isArray(kind)) return typeof v === 'string' && kind[1].includes(v) ? null : `expected one of ${kind[1].join(' | ')}`;
  switch (kind) {
    case 'num': return isNum(v) ? null : 'expected a number';
    case 'nonneg': return isNum(v) && v >= 0 ? null : 'expected a number ≥ 0';
    case 'unit': return isNum(v) && v >= 0 && v <= 1 ? null : 'expected a number in 0..1';
    case 'int': return isNum(v) && Number.isInteger(v) ? null : 'expected an integer';
    case 'bool': return typeof v === 'boolean' ? null : 'expected true or false';
    case 'str': return typeof v === 'string' && v.length > 0 ? null : 'expected a name';
    case 'range': return isNumPair(v) ? ((v as number[])[0] <= (v as number[])[1] ? null : 'range is [min, max] with min ≤ max') : 'expected a [min, max] range';
    case 'pair': return isNumPair(v) ? null : 'expected a [start, end] pair';
    case 'vec3': return Array.isArray(v) && v.length === 3 && v.every(isNum) ? null : 'expected [x, y, z]';
    case 'curve': return isNum(v) || (Array.isArray(v) && v.length >= 2 && v.every(isNum)) || isKeys(v, isNum) ? null
      : 'expected a curve: a number, [start, end], evenly spaced numbers, or [[t, value], …] keys (t in 0..1)';
    case 'gradient': return isColor(v) || (Array.isArray(v) && v.length >= 1 && v.every(isColor)) || isKeys(v, isColor) ? null
      : 'expected a gradient: a color, colors evenly spaced, or [[t, color], …] keys ("#rrggbb" | "team" | "element" | "signature" | "secondary")';
    case 'color': return isColor(v) ? null : 'expected "#rrggbb", "team", "element", "signature" or "secondary"';
    case 'color2': return isColor(v) || (Array.isArray(v) && v.length >= 1 && v.every(isColor)) || isKeys(v, isColor) ? null : 'expected colors [start, end] or a gradient';
    case 'bursts': return Array.isArray(v) && v.every((b) => Array.isArray(b) && b.length === 2 && isNum(b[0]) && b[0] >= 0 && isNum(b[1]) && b[1] >= 0) ? null : 'expected [[time s, count], …]';
    // a basic attack's swing clip(s) the layer plays on (render/vfx/defs.ts `clip`; the director passes the clip the
    // attacker's swing plays)
    case 'clips': return (typeof v === 'string' && VFX_CLIPS.includes(v)) || (Array.isArray(v) && v.length > 0 && v.every((c) => typeof c === 'string' && VFX_CLIPS.includes(c)))
      ? null : `expected a clip role or a list of them: ${VFX_CLIPS.join(' | ')}`;
    default: return null;
  }
}
// ── 3c. presentation rules (r12 M1 delayed-area warnings, M12 fighter signatures) ────────────────────────────
// Delayed areas that damage or control must be warned to everyone and give >= 0.6 s of ground warning: the
// renderer shows the warning from the FIRST tick of the wind-up (CONTRACT §9.5 wind-up telegraphs), so the
// warning is castTime + delay for a top-level area of a timed cast, the delay alone for a nested one.
// Fighter VFX signatures (FighterDef.vfx): HSV saturation >= 0.55, value 0.70-0.95, hue outside tokens.json
// vfx.reservedHuesHSV, no two fighters within 25 deg of hue unless >= 25 L* apart.
const WARN_MIN_S = 0.6;
type EffLike = { op?: string; delay?: number; filter?: { enemies?: boolean }; present?: { telegraph?: string }; [k: string]: unknown };
const NESTED_KEYS = ['onHit', 'onArrive', 'onEnd', 'onExpire', 'onPass', 'onTick', 'onCenter', 'onEnter', 'then', 'else', 'effects'] as const;
const harmsEnemies = (e: EffLike): boolean => (e.filter?.enemies !== false) && /"op":"(damage|status|displace|pull)"/.test(JSON.stringify(e));
function checkDelayedAreas(effects: unknown, castTime: number, top: boolean, path: Seg[], dg: Diagnostics, warnOnly: boolean): void {
  if (!Array.isArray(effects)) return;
  effects.forEach((raw, i) => {
    const e = raw as EffLike;
    if (!e || typeof e !== 'object') return;
    const p: Seg[] = [...path, i];
    if ((e.op === 'area' || e.op === 'zone') && (e.delay ?? 0) > 0 && harmsEnemies(e)) {
      const tg = e.present?.telegraph ?? 'everyone';
      const warn = (top ? castTime : 0) + (e.delay ?? 0);
      const say = warnOnly ? dg.warn.bind(dg) : dg.err.bind(dg);
      if (tg !== 'everyone') say([...p, 'present', 'telegraph'], `a delayed ${e.op} that damages or controls enemies must be telegraphed to everyone (r12 M1), got "${tg}"`);
      if (warn < WARN_MIN_S - 1e-6) say([...p, 'delay'], `delayed ${e.op} warns enemies for ${warn.toFixed(2)} s (castTime ${top ? castTime : 0} + delay ${e.delay}); it needs >= ${WARN_MIN_S} s (r12 M1)`);
    }
    // an `if` branch runs at once (the wind-up still counts); a `repeat` body's later passes and every on* list do not
    for (const k of NESTED_KEYS) if (k in e) checkDelayedAreas(e[k], castTime, top && (k === 'then' || k === 'else'), [...p, k], dg, warnOnly);
  });
}
const hexRgb = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
function hexHsv(h: string): [number, number, number] {
  const [r, g, b] = hexRgb(h);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let hue = 0;
  if (d > 0) hue = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((hue * 60) + 360) % 360, mx > 0 ? d / mx : 0, mx];
}
function hexLstar(h: string): number {
  const lin = hexRgb(h).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
}
function checkPresentation(c: CatalogT, designDir: string, dg: Diagnostics): void {
  // delayed areas: fighters (kit, forms, recasts), item actives and setup spells are errors; monsters warn
  c.fighters.forEach((f, fi) => {
    const kits: [Seg[], Record<string, unknown>][] = [[['fighters', fi, 'kit'], f.kit as unknown as Record<string, unknown>]];
    for (const [form, fm] of Object.entries(f.kit.passive.forms ?? {})) if (fm.kit) kits.push([['fighters', fi, 'kit', 'passive', 'forms', form, 'kit'], fm.kit as unknown as Record<string, unknown>]);
    for (const [kp, kit] of kits) for (const slot of ['a1', 'a2', 'a3', 'ult']) {
      const a = kit[slot] as { castTime?: number; effects?: unknown; recast?: { ability: { castTime?: number; effects?: unknown } } } | undefined;
      if (!a) continue;
      checkDelayedAreas(a.effects, a.castTime ?? 0, true, [...kp, slot, 'effects'], dg, false);
      if (a.recast) checkDelayedAreas(a.recast.ability.effects, a.recast.ability.castTime ?? 0, true, [...kp, slot, 'recast', 'ability', 'effects'], dg, false);
    }
  });
  c.items.forEach((it, ii) => { if (it.active) checkDelayedAreas(it.active.effects, it.active.castTime ?? 0, true, ['items', ii, 'active', 'effects'], dg, false); });
  c.setup.spells.forEach((sp, si) => checkDelayedAreas(sp.effects, sp.castTime ?? 0, true, ['setup', 'spells', si, 'effects'], dg, false));
  c.units.forEach((u, ui) => u.abilities.forEach((a, ai) => checkDelayedAreas(a.effects, a.castTime ?? 0, true, ['units', ui, 'abilities', ai, 'effects'], dg, true)));
  // signatures
  let reserved: Record<string, [number, number]> = { ally: [200, 225], harm: [28, 50], tritanAltRose: [340, 350], heal: [125, 150] };
  try {
    const tok = JSON.parse(readFileSync(join(designDir, 'tokens.json'), 'utf8')) as { vfx?: { reservedHuesHSV?: Record<string, unknown> } };
    const r = tok.vfx?.reservedHuesHSV;
    if (r) reserved = Object.fromEntries(Object.entries(r).filter(([, v]) => Array.isArray(v) && v.length === 2)) as Record<string, [number, number]>;
  } catch { /* the design dir is optional for a content build; the defaults above mirror tokens.json */ }
  const sig: { i: number; id: string; hex: string; h: number; l: number }[] = [];
  c.fighters.forEach((f, fi) => {
    if (!f.vfx) { dg.warn(['fighters', fi], `fighter "${f.id}" has no vfx { signature, secondary } (r12 M12): its effects fall back to the relationship colour`); return; }
    const [h, s, v] = hexHsv(f.vfx.signature);
    const p: Seg[] = ['fighters', fi, 'vfx', 'signature'];
    if (s < 0.55 - 1e-3 || v < 0.7 - 1e-3 || v > 0.95 + 1e-3) dg.err(p, `signature ${f.vfx.signature} has HSV saturation ${s.toFixed(2)}, value ${v.toFixed(2)}; it needs saturation >= 0.55 and value 0.70-0.95`);
    for (const [k, [a, b]] of Object.entries(reserved)) if (h >= a && h <= b) dg.err(p, `signature ${f.vfx.signature} (hue ${h.toFixed(0)}) is inside the reserved ${k} hues ${a}-${b} (tokens vfx.reservedHuesHSV)`);
    sig.push({ i: fi, id: f.id, hex: f.vfx.signature, h, l: hexLstar(f.vfx.signature) });
  });
  for (let a = 0; a < sig.length; a++) for (let b = a + 1; b < sig.length; b++) {
    const A = sig[a], B = sig[b];
    let d = Math.abs(A.h - B.h); d = Math.min(d, 360 - d);
    if (d < 25 && Math.abs(A.l - B.l) < 25) dg.err(['fighters', B.i, 'vfx', 'signature'], `signature ${B.hex} (${B.id}) is ${d.toFixed(0)} deg from ${A.hex} (${A.id}) and only ${Math.abs(A.l - B.l).toFixed(1)} L* apart; fighters need 25 deg or 25 L* between them`);
  }
}

function checkVfx(c: CatalogT, dg: Diagnostics): void {
  const fighterIds = c.fighters.map((f) => f.id);
  c.vfx.forEach((v, i) => {
    if (!v.id.startsWith('lib_') && !v.id.startsWith('amb_') && !fighterIds.some((f) => v.id.startsWith(`${f}_`))) {
      dg.warn(['vfx', i, 'id'], `"${v.id}" follows neither "lib_*" (shared), "amb_*" (T0 ambient) nor "<fighter>_<slot>_*" (bespoke) (CONTRACT §9.5)`);
    }
    if (v.id.startsWith('amb_')) checkAmbientDef(v, i, dg);
    v.layers.forEach((layer, j) => {
      const p: Seg[] = ['vfx', i, 'layers', j];
      const type = layer.type;
      const spec = typeof type === 'string' ? VFX_LAYERS[type] : undefined;
      if (!spec) { dg.err([...p, 'type'], `unknown layer type ${JSON.stringify(type)} (§9.5: ${Object.keys(VFX_LAYERS).join(', ')})`); return; }
      for (const [k, val] of Object.entries(layer)) {
        if (k === 'type') continue;
        const kind = spec[k] ?? VFX_COMMON[k];
        if (!kind) { dg.err([...p, k], `unknown key "${k}" for a ${type} layer (§9.5 keys: ${[...Object.keys(spec), ...Object.keys(VFX_COMMON)].join(', ')})`); continue; }
        const e = vfxValueError(kind, val);
        if (e) dg.err([...p, k], `${e}, got ${JSON.stringify(val)}`);
      }
    });
  });
}

// r12 M14: T0 ambient defs (tokens vfx.tiers.T0: emissive <= 0.8, <= 0.5 Hz, never a reserved / team colour) run as
// closed-form particles in render/ambient.ts: only emitter and sprite layers, lives >= 2 s, orbit and spin <= 180°/s,
// literal hex colours, no team tint.
const T0_EMISSIVE = 0.8;
const T0_MIN_LIFE = 2;
const T0_MAX_TURN_DEG = 180;
function curveMaxOf(v: unknown): number {
  if (typeof v === 'number') return v;
  if (!Array.isArray(v)) return 0;
  return Math.max(...v.map((x) => (Array.isArray(x) ? Number(x[1]) : Number(x))).filter(Number.isFinite), 0);
}
function checkAmbientDef(v: CatalogT['vfx'][number], i: number, dg: Diagnostics): void {
  if (v.teamTint) dg.err(['vfx', i, 'teamTint'], `ambient def "${v.id}" must set teamTint false (T0 never carries a team colour)`);
  v.layers.forEach((layer, j) => {
    const p: Seg[] = ['vfx', i, 'layers', j];
    const l = layer as Record<string, unknown>;
    if (l.type !== 'emitter' && l.type !== 'sprite') { dg.err([...p, 'type'], `ambient def "${v.id}": only emitter and sprite layers run in the T0 ambient layer (render/ambient.ts), got ${JSON.stringify(l.type)}`); return; }
    const e = curveMaxOf(l.emissive ?? 1);
    if (e > T0_EMISSIVE + 1e-6) dg.err([...p, 'emissive'], `ambient def "${v.id}": emissive peaks at ${e}; T0 caps it at ${T0_EMISSIVE} (tokens vfx.tiers.T0)`);
    const life = Array.isArray(l.life) ? Number(l.life[0]) : typeof l.life === 'number' ? l.life : NaN;
    if (!(life >= T0_MIN_LIFE)) dg.err([...p, 'life'], `ambient def "${v.id}": a particle lives ${Number.isFinite(life) ? life : 'unset'} s; T0 loops at <= 0.5 Hz, so lives are >= ${T0_MIN_LIFE} s`);
    for (const k of ['orbitDeg', 'spinDeg'] as const) {
      const val = l[k];
      const m = Array.isArray(val) ? Math.max(...val.map((x) => Math.abs(Number(x)))) : Math.abs(Number(val ?? 0));
      if (m > T0_MAX_TURN_DEG) dg.err([...p, k], `ambient def "${v.id}": ${k} ${m} exceeds ${T0_MAX_TURN_DEG}°/s (0.5 Hz)`);
    }
    const cols = Array.isArray(l.color) ? (l.color as unknown[]).map((x) => (Array.isArray(x) ? x[1] : x)) : [l.color];
    for (const c0 of cols) if (typeof c0 !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(c0)) dg.err([...p, 'color'], `ambient def "${v.id}": colours are literal "#rrggbb" (no team, element or signature refs), got ${JSON.stringify(c0)}`);
  });
}

/** r12 M14: map.art.ambient refs resolve to amb_* defs, and nothing ambient sits on a lane, a camp, an objective's pit,
 *  a base, a shop or a stage map's plate */
const AMB_LANE_CLEAR_M = 3.6 + 1.0;      // render/terrain.ts LANE_HALF + 1 m
const AMB_CAMP_CLEAR_M = 4.0;
/** an objective camp's whole pit is its fight zone (RIFT: Sunsplinter's r 8.5, Longshade's r 9) + 1 m */
const AMB_OBJECTIVE_CLEAR_M = 10.0;
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}
function checkAmbientMaps(c: CatalogT, dg: Diagnostics): void {
  const vfx = new Set(c.vfx.map((v) => v.id));
  c.maps.forEach((m, i) => {
    const a = m.art.ambient;
    if (!a) return;
    const p: Seg[] = ['maps', i, 'art', 'ambient'];
    // a stage map (FRAY's Noonplate): every metre of the plate is a gameplay zone
    const pl = ((m.art.terrain ?? {}) as Record<string, unknown>).plate as { at?: unknown; radius?: unknown } | undefined;
    const plate = pl && Array.isArray(pl.at) && typeof pl.at[0] === 'number' && typeof pl.at[1] === 'number' && typeof pl.radius === 'number'
      ? { at: [pl.at[0], pl.at[1]] as [number, number], r: pl.radius } : null;
    const zoneOf = (x: number, y: number, pad: number): string | null => {
      for (const l of m.lanes) for (let k = 1; k < l.path.length; k++) {
        if (segDist(x, y, l.path[k - 1][0], l.path[k - 1][1], l.path[k][0], l.path[k][1]) < AMB_LANE_CLEAR_M + pad) return `lane "${l.id}"`;
      }
      for (const cp of m.camps) for (const u of cp.units) if (Math.hypot(x - u.at[0], y - u.at[1]) < (cp.objective ? AMB_OBJECTIVE_CLEAR_M : AMB_CAMP_CLEAR_M) + pad) return cp.objective ? `objective "${cp.id}"'s pit` : `camp "${cp.id}"`;
      if (plate && Math.hypot(x - plate.at[0], y - plate.at[1]) < plate.r + pad) return 'the plate (the whole stage is the fight)';
      for (const b of m.bases) {
        if (Math.hypot(x - b.fountain.at[0], y - b.fountain.at[1]) < b.fountain.radius + pad) return 'a fountain';
      }
      for (const s of m.shops) if (Math.hypot(x - s.at[0], y - s.at[1]) < s.radius + pad) return 'a shop';
      return null;
    };
    const needAmb = (path: Seg[], id: string): void => {
      if (!vfx.has(id)) dg.err(path, unknownRef('vfx id', id, vfx));
      else if (!id.startsWith('amb_')) dg.err(path, `"${id}" is not a T0 ambient def (amb_*)`);
    };
    a.effects.forEach((e, j) => {
      needAmb([...p, 'effects', j, 'vfx'], e.vfx);
      e.at.forEach((pt, k) => { const z = zoneOf(pt[0], pt[1], 0); if (z) dg.err([...p, 'effects', j, 'at', k], `ambient effect point (${pt[0]}, ${pt[1]}) is on ${z}: T0 stays out of gameplay zones`); });
    });
    a.critters.forEach((cr, j) => cr.spots.forEach((s, k) => {
      const z = zoneOf(s[0], s[1], s[2]);
      if (z) dg.err([...p, 'critters', j, 'spots', k], `critter spot (${s[0]}, ${s[1]}) r ${s[2]} reaches ${z}: critters live off the gameplay zones`);
    }));
    a.props.forEach((pr, j) => {
      if (pr.fx) needAmb([...p, 'props', j, 'fx', 'vfx'], pr.fx.vfx);
      pr.at.forEach((pt, k) => { const z = zoneOf(pt[0], pt[1], 0); if (z) dg.err([...p, 'props', j, 'at', k], `ambient prop at (${pt[0]}, ${pt[1]}) stands on ${z}`); });
    });
  });
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
    case 'm4a': return magic('ftyp', 4) ? null : 'is not an MP4 / M4A file (no "ftyp" box)';
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
    if (/\.ogg$/.test(ref)) {
      // the AAC sibling for browsers that cannot decode Ogg Opus (CONTRACT §11), next to the resolved .ogg
      const altRef = ref.replace(/\.ogg$/, '.m4a');
      const altAbs = hit.abs.replace(/\.ogg$/, '.m4a');
      const e = exactCaseExists(altAbs);
      const altBad = e === 'yes' ? sniff(altAbs, altRef) : null;
      if (e === 'yes' && !altBad) found.set(altRef, { ref: altRef, abs: altAbs, root: hit.root, bytes: statSync(altAbs).size, altOf: ref });
      else {
        const msg = `asset "${ref}" has no usable .m4a sibling (${displayPath(altAbs)} ${altBad ?? (e === 'case' ? 'differs in letter case' : 'is missing')}): browsers without Ogg Opus would play nothing (CONTRACT §11; run audio/build.py / build_music.py)${more}`;
        if (opts.allowMissingAssets && e === 'no') dg.warn(where, msg + ' (--allow-missing-assets)');
        else dg.err(where, msg);
      }
    }
  }
  return found;
}

// ── 4a. splash / portrait PNG → WebP (perf PERF-m1) ─────────────────────────────────────────────
/** the catalog keys whose images are paintings shown as <img> / CSS art (never a WebGL texture) */
const WEBP_KEYS = new Set(['splash', 'portrait']);
const WEBP = { quality: 90, method: 6, minBytes: 32 * 1024 } as const;
const WEBP_CACHE = join(PROJECT_ROOT, 'node_modules', '.cache', 'vale-content', 'webp');
/** reads [{src, dst, q, m}] on stdin, writes each dst (via dst.tmp), prints [{ok, err?}]; exit 3 without Pillow + WebP */
const WEBP_PY = `
import json, os, sys
try:
    from PIL import Image, features
    if not features.check('webp'): raise ImportError('Pillow has no WebP support')
except Exception as e:
    print(json.dumps({'error': str(e)})); sys.exit(3)
out = []
for j in json.load(sys.stdin):
    try:
        im = Image.open(j['src']); im.load()
        icc = im.info.get('icc_profile')
        if im.mode not in ('RGB', 'RGBA'): im = im.convert('RGBA' if 'A' in im.getbands() else 'RGB')
        kw = {'quality': j['q'], 'method': j['m']}
        if icc: kw['icc_profile'] = icc
        im.save(j['dst'] + '.tmp', 'WEBP', **kw)
        os.replace(j['dst'] + '.tmp', j['dst'])
        out.append({'ok': True})
    except Exception as e:
        out.append({'ok': False, 'err': str(e)})
print(json.dumps(out))
`;

function pythonCandidates(): string[] {
  const list: string[] = [];
  if (process.env.VALE_PYTHON) list.push(process.env.VALE_PYTHON);
  for (const up of ['..', join('..', '..')]) {
    const v = join(PROJECT_ROOT, up, '.venv', 'bin', 'python3');
    if (existsSync(v)) list.push(v);
  }
  list.push('python3');
  return [...new Set(list)];
}

/** PNG refs every use of which sits under a splash / portrait key (a PNG also used elsewhere ships unchanged) */
function webpTargets(refs: Map<string, Seg[][]>, assets: Map<string, AssetInfo>): AssetInfo[] {
  const out: AssetInfo[] = [];
  for (const [ref, paths] of refs) {
    const a = assets.get(ref);
    if (!a || !/\.png$/i.test(ref) || a.bytes < WEBP.minBytes) continue;
    if (paths.every((p) => WEBP_KEYS.has(String(p[p.length - 1])))) out.push(a);
  }
  return out;
}

/**
 * Point each target at its cached WebP (encoding the ones not cached yet in one Python run). A target keeps its PNG
 * when the encode fails or comes out larger; no Pillow on the machine keeps every PNG, with one warning.
 */
function transcodeWebp(targets: AssetInfo[], dg: Diagnostics): { encoded: number; cached: number; kept: number } {
  const r = { encoded: 0, cached: 0, kept: 0 };
  if (!targets.length) return r;
  mkdirSync(WEBP_CACHE, { recursive: true });
  const plan = targets.map((a) => {
    const key = sha256(readFileSync(a.abs)).slice(0, 24);
    return { a, dst: join(WEBP_CACHE, `${key}-q${WEBP.quality}m${WEBP.method}.webp`) };
  });
  const todo = plan.filter((p) => !existsSync(p.dst));
  if (todo.length) {
    const jobs = JSON.stringify(todo.map((p) => ({ src: p.a.abs, dst: p.dst, q: WEBP.quality, m: WEBP.method })));
    let res: { ok: boolean; err?: string }[] | null = null;
    let why = '';
    for (const py of pythonCandidates()) {
      const run = spawnSync(py, ['-c', WEBP_PY], { input: jobs, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60 * 1000 });
      if (run.error) { why = `${py}: ${run.error.message}`; continue; }
      if (run.status !== 0) { why = `${py}: ${(run.stdout || run.stderr || `exit ${run.status}`).trim().slice(0, 200)}`; continue; }
      try { res = JSON.parse(run.stdout.trim().split('\n').pop() ?? '') as { ok: boolean; err?: string }[]; } catch { why = `${py}: unreadable output`; continue; }
      break;
    }
    if (!res) {
      dg.fileWarn('(build)', `${todo.length} splash / portrait PNG(s) ship as PNG: no Python with Pillow + WebP found (${why}; set VALE_PYTHON) — perf PERF-m1`);
    } else {
      todo.forEach((p, i) => { if (res![i]?.ok) r.encoded++; else dg.fileWarn(displayPath(p.a.abs), `WebP encode failed (${res![i]?.err ?? 'no result'}); shipping the PNG`); });
    }
  }
  for (const p of plan) {
    if (!existsSync(p.dst)) { r.kept++; continue; }
    const bytes = statSync(p.dst).size;
    if (bytes >= p.a.bytes || sniff(p.dst, 'x.webp')) { r.kept++; continue; }
    if (!todo.includes(p)) r.cached++;
    p.a.encodedFrom = { abs: p.a.abs, bytes: p.a.bytes };
    p.a.abs = p.dst;
    p.a.bytes = bytes;
  }
  return r;
}

/** perf PERF-m2: every assets/… path the catalogs a manifest lists refer to (the .m4a map values included) */
export function referencedAssets(outDir: string, m: CatalogManifest): Set<string> {
  const used = new Set<string>();
  for (const e of Object.values(m.schemas)) {
    const f = join(outDir, e.catalog);
    if (!existsSync(f)) continue;
    for (const x of readFileSync(f, 'utf8').matchAll(/"(assets\/[A-Za-z0-9_./-]+)"/g)) used.add(x[1]);
  }
  return used;
}

/** --prune: delete <out>/assets files the manifest's catalogs never name; returns the count and bytes freed */
function pruneAssets(outDir: string, m: CatalogManifest): { files: number; bytes: number } {
  const used = referencedAssets(outDir, m);
  const dir = join(outDir, 'assets');
  const r = { files: 0, bytes: 0 };
  if (!existsSync(dir)) return r;
  for (const name of readdirSync(dir)) {
    if (used.has(`assets/${name}`)) continue;
    const f = join(dir, name);
    const st = statSync(f);
    if (!st.isFile()) continue;
    unlinkSync(f);
    r.files++; r.bytes += st.size;
  }
  return r;
}

// ── 4b. fighter triangle budget (r12 B4) ────────────────────────────────────────────────────────
/** r12 B4: a fighter model's (and each skin's) triangles: the frame's ≤ 500k triangle budget draws every visible
 *  fighter twice (main and shadow pass), so ten of them at FIGHTER_TRIS are ~480k before the map, the crowd and the
 *  effects. Above the budget a warning names the model; above the ceiling (a broken or unreduced export) an error. */
export const FIGHTER_TRIS = { budget: 24000, ceiling: 40000 } as const;

/** triangles a GLB draws: every node's mesh, each triangle-list primitive (indexed or not) */
export function glbTriangles(abs: string): number | null {
  const b = readFileSync(abs);
  if (b.length < 20 || b.toString('latin1', 0, 4) !== 'glTF') return null;
  const len = b.readUInt32LE(12);
  let j: { accessors?: { count: number }[]; meshes?: { primitives: { mode?: number; indices?: number; attributes: Record<string, number> }[] }[]; nodes?: { mesh?: number }[] };
  try { j = JSON.parse(b.toString('utf8', 20, 20 + len)); } catch { return null; }
  const acc = j.accessors ?? [];
  const per = (j.meshes ?? []).map((m) => m.primitives.reduce((t, p) => ((p.mode ?? 4) !== 4 ? t
    : t + Math.floor((p.indices !== undefined ? acc[p.indices]?.count ?? 0 : acc[p.attributes.POSITION]?.count ?? 0) / 3)), 0));
  return (j.nodes ?? []).reduce((t, n) => t + (n.mesh !== undefined ? per[n.mesh] ?? 0 : 0), 0);
}

function checkFighterTriangles(c: CatalogT, assets: Map<string, AssetInfo>, dg: Diagnostics): void {
  const check = (ref: string, path: Seg[], what: string): void => {
    const a = assets.get(ref);
    if (!a || !/\.glb$/i.test(ref)) return;
    const n = glbTriangles(a.abs);
    if (n === null || n <= FIGHTER_TRIS.budget) return;
    const msg = `${what} "${ref}" draws ${n} triangles, over the per-fighter budget of ${FIGHTER_TRIS.budget} (r12 B4: every visible fighter draws twice, main and shadow pass, inside the frame's 500k)`;
    if (n > FIGHTER_TRIS.ceiling) dg.err(path, `${msg}; the ceiling is ${FIGHTER_TRIS.ceiling}`);
    else dg.warn(path, msg);
  };
  c.fighters.forEach((f, i) => check(f.art.model, ['fighters', i, 'art', 'model'], `fighter ${f.id}: model`));
  c.skins.forEach((s, i) => { if (s.model) check(s.model, ['skins', i, 'model'], `skin ${s.id}: model`); });
}

// ── 5. names ────────────────────────────────────────────────────────────────────────────────────
const NAME_KEYS = new Set(['name', 'title', 'label', 'headline', 'tagline', 'badge']);
const PROSE_KEYS = new Set(['desc', 'lore', 'job', 'body', 'sub', 'contract', 'note']);
function collectNames(data: Record<string, unknown>): { inputs: NameInput[]; paths: Seg[][] } {
  const inputs: NameInput[] = [];
  const paths: Seg[][] = [];
  // `at` is the path as a scope pattern ("modes[].name") for scoped allowlist entries
  const at = (path: Seg[]): string => path.map((s, i) => typeof s === 'number' ? '[]' : i === 0 ? s : `.${s}`).join('');
  const add = (path: Seg[], text: string, kind: TextKind): void => { paths.push(path); inputs.push({ path: String(paths.length - 1), text, kind, at: at(path) }); };
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

// ── 5b. player copy ─────────────────────────────────────────────────────────────────────────────
/**
 * Copy-lint hits that are known and routed to the lane that owns the file (integration_plan systems-10: modes / queues /
 * roles / classes / fighter kit copy; systems-14: skin desc spelling). Each one is reported as a warning; the entry
 * goes stale (harmlessly) once that copy is fixed. Keys are `<file relative to content/>$<json path>|<word>`. In the
 * project's own content/ a hit that is NOT listed here is an error, so no new copy can regress; any other --content tree
 * (the probe fixtures, whose placeholder text never reaches a player) gets warnings. Delete an entry once its fix lands.
 */
// empty: every routed hit is fixed (roles / classes / skins a5d8c275, 2553dcdf; the FRAY desc 84107482)
const COPY_LINT_PENDING: ReadonlySet<string> = new Set<string>([]);

function copyLint(files: Record<string, unknown>, strings: Record<string, string>, contentDir: string, dg: Diagnostics): void {
  const shipped = resolve(contentDir) === resolve(PROJECT_ROOT, 'content');
  for (const h of lintPlayerCopy(files, strings)) {
    let rel: string, at: string;
    if (h.path.startsWith('strings.')) { rel = 'strings.en.json'; at = fmtPath([h.path.slice('strings.'.length)]); }
    else {
      const i = h.path.indexOf(':');
      const rest = h.path.slice(i + 1);
      rel = h.path.slice(0, i);
      at = `$${rest.startsWith('[') ? '' : '.'}${rest}`;
    }
    const msg = formatCopyHit({ ...h, path: 'copy lint' });
    const file = displayPath(join(contentDir, rel));
    if (shipped && COPY_LINT_PENDING.has(`${rel}${at}|${h.word}`)) dg.fileWarn(file, `${msg} [pending copy fix]`, at);
    else if (shipped) dg.fileErr(file, msg, at);
    else dg.fileWarn(file, msg, at);
  }
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
    prune: over.prune ?? false,
    keepPng: over.keepPng ?? false,
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

  if (parsed.success) { semanticChecks(parsed.data, opts, dg); checkVfx(parsed.data, dg); checkAmbientMaps(parsed.data, dg); checkPresentation(parsed.data, opts.designDir, dg); }
  else if (!opts.quiet) dg.fileWarn('(build)', 'schema errors present — cross-reference checks are skipped until they are fixed');

  // assets + names run on raw data too, so one pass shows as many problems as possible
  const refs = collectAssetRefs(data);
  const assets = resolveAssets(refs, opts, dg);
  if (parsed.success) checkFighterTriangles(parsed.data, assets, dg);

  const deny = loadDenyList(opts.designDir);
  for (const w of deny.warnings) dg.fileWarn(displayPath(opts.designDir), w);
  if (deny.sources.length === 0) {
    dg.fileWarn(displayPath(opts.designDir), 'no deny-list (research/protected_names.json, NAMES_NOT_USED.md) — originality names check SKIPPED');
  } else {
    result.namesChecked = true;
    const { inputs, paths } = collectNames(data);
    for (const h of checkNames(inputs, deny)) dg.err(paths[Number(h.path)], `deny-listed name: ${formatHit(h)}`);
  }

  // player copy (src/ui/copy_lint.ts; originality F6 / F8, client F11): VALE's own words where the genre has its own,
  // American spelling, stat display names instead of raw stat ids. Every content file but vfx / audio, plus every
  // strings.en.json value. A hit on COPY_LINT_PENDING is a warning until its routed copy fix lands; any other hit fails
  copyLint(loaded.files, isObj(raw.strings) ? raw.strings as Record<string, string> : {}, opts.contentDir, dg);

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

  // perf PERF-m1: splash / portrait art as WebP (cached encodes; a machine without Pillow ships the PNGs)
  if (!opts.keepPng) result.webp = transcodeWebp(webpTargets(refs, assets), dg);

  // copy assets content-addressed, rewrite refs
  const assetsDir = join(opts.outDir, 'assets');
  mkdirSync(assetsDir, { recursive: true });
  const rewrite = new Map<string, string>();
  const byOut = new Map<string, string>();
  for (const a of assets.values()) {
    const bytes = readFileSync(a.abs);
    a.sha256 = sha256(bytes);
    const outName = `${a.sha256.slice(0, 12)}-${a.encodedFrom ? basename(a.ref).replace(/\.png$/i, '.webp') : basename(a.ref)}`;
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
  // .ogg → .m4a format-fallback refs (CONTRACT §11), sorted for a stable catalog
  const alts = [...assets.values()].filter((a) => a.altOf && a.out && rewrite.has(a.altOf))
    .map((a) => [rewrite.get(a.altOf!)!, a.out!] as const).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  if (alts.length) rewritten.audio = { ...(rewritten.audio as Record<string, unknown>), m4a: Object.fromEntries(alts) };
  const recheck = Catalog.safeParse(rewritten);
  if (!recheck.success) { reportIssues(recheck.error.issues as unknown as IssueLike[], [], dg); return result; }

  const out = emitCatalogs({ catalog: recheck.data as unknown as CatalogData, outDir: opts.outDir, registry: opts.registry, current: SCHEMA_VERSION, dg });
  result.emitted = out.emitted;
  result.manifest = out.manifest ?? undefined;
  result.ok = dg.errors.length === 0;
  if (result.ok && opts.prune && out.manifest) result.pruned = pruneAssets(opts.outDir, out.manifest);
  return result;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const USAGE = `usage: node tools/build_content.ts [--check] [--content <dir>] [--out <dir>] [--allow-missing-assets]
                                    [--design <dir>] [--art-out <dir>] [--audio-out <dir>] [--scripts <dir>] [--quiet]
                                    [--prune] [--keep-png]`;

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
        case '--prune': over.prune = true; break;
        case '--keep-png': over.keepPng = true; break;
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
  const alts = r.assets.filter((a) => a.altOf);
  if (alts.length) rows.push(['  of which .m4a', `${alts.length} files, ${fmtBytes(alts.reduce((s, a) => s + a.bytes, 0))} (Ogg Opus fallback, CONTRACT §11)`]);
  const webp = r.assets.filter((a) => a.encodedFrom);
  if (webp.length) rows.push(['  of which .webp', `${webp.length} splash / portrait files, ${fmtBytes(webp.reduce((s, a) => s + a.bytes, 0))} (from ${fmtBytes(webp.reduce((s, a) => s + a.encodedFrom!.bytes, 0))} of PNG; ${r.webp?.encoded ?? 0} encoded now, ${r.webp?.cached ?? 0} cached${r.webp?.kept ? `, ${r.webp.kept} kept as PNG` : ''})`]);
  if (r.pruned) rows.push(['pruned', `${r.pruned.files} unreferenced files, ${fmtBytes(r.pruned.bytes)} (--prune)`]);
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

// run as a CLI only when executed directly (probes import this module); Windows paths compare case-insensitively
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
if (process.platform === 'win32' ? invokedPath.toLowerCase() === selfPath.toLowerCase() : invokedPath === selfPath) process.exitCode = runCli(process.argv.slice(2));
