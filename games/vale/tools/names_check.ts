// VALE — originality deny-list check for player-facing text (CONTRACT §0 "Originality", §3.4).
//
// Used by tools/build_content.ts on every name/title/label and every player-facing prose string.
// Also a CLI for the design team:
//   node tools/names_check.ts "Some Fighter Name" "another string"   → prints hits, exit 1 on a hit
//   node tools/names_check.ts --prose "a sentence of tooltip text"    → check as prose (see TIERS)
//   node tools/names_check.ts --list                                  → per category: flagged / exact / inert
//   --design <dir>  read the lists from <dir> instead of _design/
//
// INPUTS (all optional; a missing file contributes nothing — build_content warns when none exist):
//   <design>/research/protected_names.json
//       { "categories": { "<cat>": ["Name", {"name": "Name"}, …] },   whole-word / whole-phrase entries
//         "exact_only": { "<cat>": ["Name", …] },                        ordinary words: entire-name only
//         "strict": ["<cat>", …] }                                       optional
//   <design>/NAMES_NOT_USED.md      '- Name' bullets under '#' headings → category 'not_used/<heading-slug>'.
//                                   Text after ' — ', ' – ', ' - ', ': ' or ' (' is commentary; 'A / B'
//                                   lists two names. A heading containing '(strict)' makes it strict.
//   <design>/names_allowlist.json   { "allow": ["Rift", …], "why": {"Rift": "owner-chosen mode name"},
//                                     "scope": {"Rift": ["modes[].name", "strings"]},
//                                     "strict": ["<cat>", …] }        (why expected; scope, strict optional)
//                                   A scoped name is allowed only where the checked string's catalog path
//                                   (NameInput.at, e.g. "modes[].name") equals a scope pattern or lies
//                                   under it; everywhere else its normal tier applies. `[]` = any index.
//
// NORMALIZATION (protected names and checked text alike): Unicode NFKD, combining marks dropped
// (é → e), a few letters folded (æ → ae, ø → o, ß → ss), apostrophe look-alikes unified, a possessive
// "'s" dropped, other apostrophes removed (Kai'Sa → kaisa), any other non-letter/digit is a word
// break, lowercase. A protected name also matches with its apostrophes read as word breaks
// (Kog'Maw ~ "Kog Maw" / "Kog-Maw") and, when it has several words, written as one ("Baron Nashor"
// ~ "BaronNashor"). A NAME is also compared as a whole with every separator removed ("Kai Sa" ~
// "Kaisa"), and a leading "the" is ignored for entire-name comparisons.
//
// TIERS (why: many protected names are ordinary English — "Rift" is the owner-chosen mode name,
// "Herald" and "Dragon" are words — so matching every entry everywhere would block plain English
// without protecting anything; but an entire name that IS a shipped champion's name is a copy):
//   anywhere    multi-word entries ("Summoner's Rift") and single words that are NOT plain English
//               dictionary words ("Teemo"): whole-word match in names AND prose.
//   in names    single dictionary words in a STRICT category: whole-word match inside name fields
//               (a skin "Jinx Reborn" fails), never in prose (a tooltip "jinx" passes).
//   exact name  every other single dictionary word, and every `exact_only` entry: flagged only when an
//               ENTIRE name equals it ("Thresh" as a fighter name fails, "Iron Thresh" does not).
//   ignored     anything whose normalized form is in names_allowlist.json `allow`.
// The dictionary is tools/data/english_words.txt (SCOWL size ≤ 50, no proper nouns). Never edit it
// to silence a hit — allowlist the name with a `why`, or rename the content.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(TOOLS_DIR, '..');
export const DEFAULT_DESIGN_DIR = resolve(PROJECT_ROOT, '_design');
const DICTIONARY_FILE = resolve(TOOLS_DIR, 'data', 'english_words.txt');

export type TextKind = 'name' | 'prose';
export interface NameInput {
  path: string; text: string; kind?: TextKind;
  /** catalog path pattern of the string ("modes[].name", "strings.ui_play"), for scoped allowlist entries */
  at?: string;
}
export type HitReason = 'multi_word' | 'non_dictionary' | 'strict' | 'exact_name';
export type Tier = 'anywhere' | 'in_names' | 'exact_name' | 'ignored';
export interface NameHit {
  path: string; text: string; kind: TextKind;
  protectedName: string; category: string; source: string; reason: HitReason;
}

export interface DenyEntry {
  name: string; category: string; source: string;
  tier: Tier;
  reason: HitReason | null;
  /** canonical token form first, then alternates; matched as contiguous token runs */
  variants: string[][];
  /** all separators removed; used for entire-name comparisons */
  squashed: string;
  /** scoped allowlist: catalog path patterns where this entry is NOT flagged */
  allowedAt?: string[];
}

export interface DenyList {
  entries: DenyEntry[];
  strictCategories: string[];
  allow: string[];
  /** files actually read (relative to the project root when inside it) */
  sources: string[];
  /** malformed lines etc. — surfaced by build_content as warnings */
  warnings: string[];
  /** first token → (entry, variant) for 'anywhere' and 'in_names' entries */
  index: Map<string, { entry: DenyEntry; variant: string[] }[]>;
  /** squashed form → entries, for entire-name comparisons (every non-ignored entry) */
  whole: Map<string, DenyEntry[]>;
}

// ── normalization ───────────────────────────────────────────────────────────────────────────────
const APOSTROPHES = /[‘’‛ʼʹ`´′＇]/g;
const FOLD: Record<string, string> = { 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ß': 'ss', 'đ': 'd', 'ð': 'd', 'ł': 'l', 'þ': 'th', 'ı': 'i' };

function fold(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}+/gu, '').toLowerCase()
    .replace(/[æœøßđðłþı]/g, (c) => FOLD[c] ?? c)
    .replace(APOSTROPHES, "'");
}
const split = (s: string): string[] => s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Canonical whole-word tokens of a string (see NORMALIZATION). Exported for tests. */
export function nameTokens(text: string): string[] {
  return split(fold(text).replace(/'s(?![\p{L}\p{N}])/gu, '').replace(/'/g, ''));
}
function apostropheAsBreakTokens(text: string): string[] {
  return split(fold(text).replace(/'s(?![\p{L}\p{N}])/gu, '').replace(/'/g, ' '));
}
/** entire-name form: tokens without a leading "the", joined with nothing */
function wholeForm(tokens: string[]): string {
  return (tokens[0] === 'the' && tokens.length > 1 ? tokens.slice(1) : tokens).join('');
}

// ── dictionary ──────────────────────────────────────────────────────────────────────────────────
let dictionary: Set<string> | null = null;
export function isDictionaryWord(word: string): boolean {
  if (!dictionary) {
    dictionary = new Set(readFileSync(DICTIONARY_FILE, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.trim()));
  }
  return dictionary.has(word.toLowerCase());
}

// ── loading the lists ───────────────────────────────────────────────────────────────────────────
const rel = (p: string): string => { const r = relative(PROJECT_ROOT, p); return r.startsWith('..') ? p : r.replace(/\\/g, '/'); };

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')); } catch (e) {
    throw new Error(`names_check: cannot parse ${rel(file)}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function slug(s: string): string {
  return fold(s).replace(/\(strict\)/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'untitled';
}

/** '- **Name** — why' → 'Name'. Exported for the probe. */
export function parseNamesNotUsed(md: string): { category: string; name: string; strict: boolean }[] {
  const out: { category: string; name: string; strict: boolean }[] = [];
  let category = 'not_used/general';
  let strict = false;
  for (const raw of md.split(/\r?\n/)) {
    const h = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) { category = `not_used/${slug(h[1])}`; strict = /\(strict\)/i.test(h[1]); continue; }
    const b = /^\s*[-*+]\s+(.*)$/.exec(raw);
    if (!b) continue;
    let text = b[1]
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')   // [text](url) → text
      .replace(/[*_`~]+/g, '');                   // emphasis / code marks
    text = text.split(/\s+[—–]\s+|\s+-{1,2}\s+|:\s+|\s+\(/)[0].trim();
    for (const part of text.split(/\s+\/\s+/)) {
      const name = part.trim().replace(/[.;,]+$/, '');
      if (name) out.push({ category, name, strict });
    }
  }
  return out;
}

interface RawEntry { name: string; category: string; source: string; exactOnly: boolean }

function readCategoryMap(v: unknown, file: string, key: string, exactOnly: boolean, out: RawEntry[], warnings: string[]): void {
  if (v === undefined) return;
  if (!v || typeof v !== 'object' || Array.isArray(v)) { warnings.push(`${file}: "${key}" must be { "<category>": [names] } — skipped`); return; }
  for (const [cat, list] of Object.entries(v as Record<string, unknown>)) {
    if (!Array.isArray(list)) { warnings.push(`${file} ${key}.${cat} is not an array — skipped`); continue; }
    list.forEach((x, i) => {
      const name = typeof x === 'string' ? x : (x && typeof x === 'object' && typeof (x as { name?: unknown }).name === 'string') ? (x as { name: string }).name : null;
      if (name === null) warnings.push(`${file} ${key}.${cat}[${i}] is neither a string nor {name} — skipped`);
      else out.push({ name, category: cat, source: file, exactOnly });
    });
  }
}

export function loadDenyList(designDir: string = DEFAULT_DESIGN_DIR): DenyList {
  const sources: string[] = [];
  const warnings: string[] = [];
  const raw: RawEntry[] = [];
  const strict = new Set<string>();
  const strictList = (v: unknown): void => { if (Array.isArray(v)) for (const c of v) if (typeof c === 'string') strict.add(c); };

  const protectedFile = resolve(designDir, 'research', 'protected_names.json');
  if (existsSync(protectedFile)) {
    const f = rel(protectedFile);
    sources.push(f);
    const j = readJson(protectedFile) as { categories?: unknown; exact_only?: unknown; strict?: unknown };
    if (!j || typeof j !== 'object' || !j.categories) throw new Error(`names_check: ${f} must be { "categories": { "<cat>": ["Name", …] } }`);
    readCategoryMap(j.categories, f, 'categories', false, raw, warnings);
    readCategoryMap(j.exact_only, f, 'exact_only', true, raw, warnings);
    strictList(j.strict);
  }

  const notUsedFile = resolve(designDir, 'NAMES_NOT_USED.md');
  if (existsSync(notUsedFile)) {
    sources.push(rel(notUsedFile));
    for (const e of parseNamesNotUsed(readFileSync(notUsedFile, 'utf8'))) {
      raw.push({ name: e.name, category: e.category, source: rel(notUsedFile), exactOnly: false });
      if (e.strict) strict.add(e.category);
    }
  }

  /** normalized name → null (allowed everywhere) or the scope patterns where it is allowed */
  const allow = new Map<string, string[] | null>();
  const allowFile = resolve(designDir, 'names_allowlist.json');
  if (existsSync(allowFile)) {
    sources.push(rel(allowFile));
    const j = readJson(allowFile) as { allow?: unknown; strict?: unknown; why?: unknown; scope?: unknown };
    if (!j || typeof j !== 'object' || !Array.isArray(j.allow)) throw new Error(`names_check: ${rel(allowFile)} must be { "allow": ["Name", …], "why": { … } }`);
    const why = (j.why && typeof j.why === 'object') ? j.why as Record<string, unknown> : {};
    const scope = (j.scope && typeof j.scope === 'object') ? j.scope as Record<string, unknown> : {};
    for (const a of j.allow) {
      if (typeof a !== 'string') continue;
      const sc = scope[a];
      if (sc !== undefined && !(Array.isArray(sc) && sc.every((x) => typeof x === 'string'))) warnings.push(`${rel(allowFile)}: scope["${a}"] must be an array of catalog path patterns — treated as allowed everywhere`);
      allow.set(nameTokens(a).join(' '), Array.isArray(sc) && sc.every((x) => typeof x === 'string') ? sc as string[] : null);
      if (!(a in why)) warnings.push(`${rel(allowFile)}: "${a}" is allowlisted without a "why"`);
    }
    for (const k of Object.keys(scope)) if (!j.allow.includes(k)) warnings.push(`${rel(allowFile)}: scope["${k}"] has no matching "allow" entry — ignored`);
    strictList(j.strict);
  }

  const entries: DenyEntry[] = [];
  const index = new Map<string, { entry: DenyEntry; variant: string[] }[]>();
  const whole = new Map<string, DenyEntry[]>();
  const seen = new Set<string>();
  for (const r of raw) {
    const canon = nameTokens(r.name);
    if (canon.length === 0) { warnings.push(`${r.source}: protected name "${r.name}" has no letters/digits — skipped`); continue; }
    const key = `${r.category}\u0000${r.exactOnly ? 'x' : 'c'}\u0000${canon.join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const variants: string[][] = [canon];
    const alt = apostropheAsBreakTokens(r.name);
    if (alt.join(' ') !== canon.join(' ')) variants.push(alt);
    if (canon.length > 1) variants.push([canon.join('')]);

    let tier: Tier;
    let reason: HitReason | null;
    const allowed = allow.get(canon.join(' '));
    if (allowed === null) { tier = 'ignored'; reason = null; }
    else if (r.exactOnly) { tier = 'exact_name'; reason = 'exact_name'; }
    else if (canon.length > 1) { tier = 'anywhere'; reason = 'multi_word'; }
    else if (!isDictionaryWord(canon[0])) { tier = 'anywhere'; reason = 'non_dictionary'; }
    else if (strict.has(r.category)) { tier = 'in_names'; reason = 'strict'; }
    else { tier = 'exact_name'; reason = 'exact_name'; }

    const entry: DenyEntry = { name: r.name, category: r.category, source: r.source, tier, reason, variants, squashed: wholeForm(canon) };
    if (allowed) entry.allowedAt = allowed;
    entries.push(entry);
    if (tier === 'ignored') continue;
    const w = whole.get(entry.squashed) ?? [];
    w.push(entry);
    whole.set(entry.squashed, w);
    if (tier === 'anywhere' || tier === 'in_names') {
      for (const v of variants) {
        const list = index.get(v[0]) ?? [];
        list.push({ entry, variant: v });
        index.set(v[0], list);
      }
    }
  }
  return { entries, strictCategories: [...strict].sort(), allow: [...allow.keys()].sort(), sources, warnings, index, whole };
}

let cachedDefault: DenyList | null = null;

/** "modes[].name" covers itself and anything below it ("strings" covers "strings.ui_play"). */
export function scopeCovers(pattern: string, at: string): boolean {
  return at === pattern || at.startsWith(pattern + '.') || at.startsWith(pattern + '[');
}

/** Every protected-name hit in `strings`. `kind` defaults to 'name' (the stricter reading). */
export function checkNames(strings: readonly NameInput[], list?: DenyList): NameHit[] {
  const deny = list ?? (cachedDefault ??= loadDenyList());
  const hits: NameHit[] = [];
  if (deny.whole.size === 0) return hits;
  for (const s of strings) {
    const kind: TextKind = s.kind ?? 'name';
    const toks = nameTokens(s.text);
    const reported = new Set<DenyEntry>();
    const report = (entry: DenyEntry): void => {
      if (reported.has(entry)) return;
      if (entry.allowedAt && s.at !== undefined && entry.allowedAt.some((p) => scopeCovers(p, s.at as string))) return;
      reported.add(entry);
      hits.push({ path: s.path, text: s.text, kind, protectedName: entry.name, category: entry.category, source: entry.source, reason: entry.reason as HitReason });
    };
    // whole-word / whole-phrase runs
    for (let i = 0; i < toks.length; i++) {
      const cands = deny.index.get(toks[i]);
      if (!cands) continue;
      for (const { entry, variant } of cands) {
        if (entry.tier === 'in_names' && kind !== 'name') continue;
        if (i + variant.length > toks.length) continue;
        let ok = true;
        for (let k = 1; k < variant.length; k++) if (toks[i + k] !== variant[k]) { ok = false; break; }
        if (ok) report(entry);
      }
    }
    // entire-name comparisons (names only): exact-name tier, plus any entry spelled with different breaks
    if (kind === 'name' && toks.length) for (const entry of deny.whole.get(wholeForm(toks)) ?? []) report(entry);
  }
  return hits;
}

export function formatHit(h: NameHit): string {
  const why = { multi_word: 'multi-word protected name', non_dictionary: 'protected non-dictionary word', strict: 'strict-category word in a name', exact_name: 'entire name equals a protected name' }[h.reason];
  return `"${h.text.length > 80 ? h.text.slice(0, 77) + '…' : h.text}" matches deny-listed "${h.protectedName}" (${h.category}, ${h.source}; ${why})`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
function main(argv: string[]): number {
  let designDir = DEFAULT_DESIGN_DIR;
  let kind: TextKind = 'name';
  let listMode = false;
  const texts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--design') designDir = resolve(argv[++i] ?? '');
    else if (a === '--prose') kind = 'prose';
    else if (a === '--list') listMode = true;
    else if (a === '-h' || a === '--help') { console.log('usage: node tools/names_check.ts [--design <dir>] [--prose] [--list] [text …]'); return 0; }
    else texts.push(a);
  }
  const list = loadDenyList(designDir);
  for (const w of list.warnings) console.warn(`warn: ${w}`);
  if (list.sources.length === 0) console.warn(`warn: no deny-list files under ${rel(designDir)} — nothing can match`);
  if (listMode) {
    const byCat = new Map<string, DenyEntry[]>();
    for (const e of list.entries) byCat.set(e.category, [...(byCat.get(e.category) ?? []), e]);
    for (const [cat, es] of [...byCat].sort(([a], [b]) => a.localeCompare(b))) {
      const n = (t: Tier): number => es.filter((e) => e.tier === t).length;
      console.log(`${cat}${list.strictCategories.includes(cat) ? ' (strict)' : ''}: ${n('anywhere')} anywhere, ${n('in_names')} in names, ${n('exact_name')} exact-name, ${n('ignored')} allowlisted`);
      const ign = es.filter((e) => e.tier === 'ignored');
      if (ign.length) console.log(`  allowlisted: ${ign.map((e) => e.name).join(', ')}`);
      const scoped = es.filter((e) => e.allowedAt);
      if (scoped.length) console.log(`  allowlisted only at: ${scoped.map((e) => `${e.name} → ${e.allowedAt?.join(' | ')}`).join('; ')}`);
    }
    return 0;
  }
  const hits = checkNames(texts.map((t, i) => ({ path: `arg[${i}]`, text: t, kind })), list);
  for (const h of hits) console.log(`HIT ${h.path}: ${formatHit(h)}`);
  if (!hits.length) console.log(`clean (${texts.length} string${texts.length === 1 ? '' : 's'} checked as ${kind})`);
  return hits.length ? 1 : 0;
}

// run as a CLI only when executed directly (probes import this module); Windows paths compare case-insensitively
const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
if (process.platform === 'win32' ? invokedPath.toLowerCase() === selfPath.toLowerCase() : invokedPath === selfPath) process.exitCode = main(process.argv.slice(2));
