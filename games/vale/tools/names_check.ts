// VALE — originality deny-list check for player-facing text (CONTRACT §0 "Originality", §3.4).
//
// Used by tools/build_content.ts on every name/title/label and every player-facing prose string.
// Also a CLI for the design team:
//   node tools/names_check.ts "Some Fighter Name" "another string"   → prints hits, exit 1 on a hit
//   node tools/names_check.ts --prose "a sentence of tooltip text"    → check as prose (see RULE)
//   node tools/names_check.ts --list                                  → what is flagged / inert, per category
//   --design <dir>  read the lists from <dir> instead of _design/
//
// INPUTS (all optional; a missing file contributes nothing — build_content warns when none exist):
//   <design>/research/protected_names.json   { "categories": { "<cat>": ["Name", {"name": "Name"}, …] },
//                                              "strict": ["<cat>", …] }            (strict: optional)
//   <design>/NAMES_NOT_USED.md               '- Name' bullets under '#' headings; category =
//                                              'not_used/<heading-slug>'. Text after ' — ', ' – ', ' - ',
//                                              ': ' or ' (' is commentary and ignored. A heading that
//                                              contains '(strict)' makes its category strict.
//   <design>/names_allowlist.json            { "allow": ["Rift", "Vale", …], "why": {"Rift": "…"},
//                                              "strict": ["<cat>", …] }            (why/strict optional)
//
// NORMALIZATION (both the protected names and the checked text): Unicode NFKD, combining marks
// dropped (é → e), a few ligatures/letters folded (æ → ae, ø → o, ß → ss), every apostrophe-like
// character unified, a possessive "'s" dropped, other apostrophes removed (Kai'Sa → kaisa), every
// other non-letter/digit is a word break, lowercase. Matching is whole-word on that token stream.
// A protected name also matches with its apostrophes read as spaces (Kog'Maw ~ "Kog Maw"/"Kog-Maw")
// and, when multi-word, written as one word ("Baron Nashor" ~ "BaronNashor").
//
// RULE (why: many protected names are ordinary English — "Rift" is the owner-chosen mode name,
// "Vale" is the product, "Dragon" is a word — so blindly matching every entry would block plain
// English while adding no originality protection):
//   * an entry whose normalized form is in the allowlist is ignored entirely;
//   * a MULTI-WORD entry ("Summoner's Rift", "Infinity Edge") is flagged anywhere: names and prose;
//   * a SINGLE-WORD entry that is NOT a plain English dictionary word ("Teemo") is flagged anywhere;
//   * a SINGLE-WORD dictionary word ("Jinx", "Herald") is flagged only when its category is
//     STRICT, and then only in NAME fields (a fighter called "Jinx" fails; a tooltip saying
//     "jinx" does not);
//   * any other single dictionary word is inert (listed by --list so the design team can see it).
// The dictionary is tools/data/english_words.txt (SCOWL size ≤ 50, no proper nouns). Do not edit
// it to silence a hit — add the name to the allowlist with a `why`, or rename the content.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(TOOLS_DIR, '..');
export const DEFAULT_DESIGN_DIR = resolve(PROJECT_ROOT, '_design');
const DICTIONARY_FILE = resolve(TOOLS_DIR, 'data', 'english_words.txt');

export type TextKind = 'name' | 'prose';
export interface NameInput { path: string; text: string; kind?: TextKind }
export type HitReason = 'multi_word' | 'non_dictionary' | 'strict';
export interface NameHit {
  path: string; text: string; kind: TextKind;
  protectedName: string; category: string; source: string; reason: HitReason;
}

export interface DenyEntry {
  name: string; category: string; source: string;
  /** canonical token form (first variant) + alternates; all matched as contiguous token runs */
  variants: string[][];
  flagName: boolean; flagProse: boolean;
  reason: HitReason | null;
  /** why it is inert, when reason is null */
  inertWhy?: 'allowlisted' | 'dictionary_word';
}

export interface DenyList {
  entries: DenyEntry[];             // every entry, flagged or inert
  strictCategories: string[];
  allow: string[];
  /** files actually read (relative to the project root when inside it) */
  sources: string[];
  /** malformed lines etc. — surfaced by build_content as warnings */
  warnings: string[];
  /** first token → candidate (entry, variant) pairs, flagged entries only */
  index: Map<string, { entry: DenyEntry; variant: string[] }[]>;
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
function apostropheAsSpaceTokens(text: string): string[] {
  return split(fold(text).replace(/'s(?![\p{L}\p{N}])/gu, '').replace(/'/g, ' '));
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
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
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

export function loadDenyList(designDir: string = DEFAULT_DESIGN_DIR): DenyList {
  const sources: string[] = [];
  const warnings: string[] = [];
  const raw: { name: string; category: string; source: string }[] = [];
  const strict = new Set<string>();

  const protectedFile = resolve(designDir, 'research', 'protected_names.json');
  if (existsSync(protectedFile)) {
    sources.push(rel(protectedFile));
    const j = readJson(protectedFile) as { categories?: unknown; strict?: unknown };
    if (!j || typeof j !== 'object' || !j.categories || typeof j.categories !== 'object') {
      throw new Error(`names_check: ${rel(protectedFile)} must be { "categories": { "<cat>": ["Name", …] } }`);
    }
    for (const [cat, list] of Object.entries(j.categories as Record<string, unknown>)) {
      if (!Array.isArray(list)) { warnings.push(`${rel(protectedFile)} categories.${cat} is not an array — skipped`); continue; }
      list.forEach((v, i) => {
        const name = typeof v === 'string' ? v : (v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string') ? (v as { name: string }).name : null;
        if (name === null) warnings.push(`${rel(protectedFile)} categories.${cat}[${i}] is neither a string nor {name} — skipped`);
        else raw.push({ name, category: cat, source: rel(protectedFile) });
      });
    }
    if (Array.isArray(j.strict)) for (const c of j.strict) if (typeof c === 'string') strict.add(c);
  }

  const notUsedFile = resolve(designDir, 'NAMES_NOT_USED.md');
  if (existsSync(notUsedFile)) {
    sources.push(rel(notUsedFile));
    for (const e of parseNamesNotUsed(readFileSync(notUsedFile, 'utf8'))) {
      raw.push({ name: e.name, category: e.category, source: rel(notUsedFile) });
      if (e.strict) strict.add(e.category);
    }
  }

  const allow = new Set<string>();
  const allowFile = resolve(designDir, 'names_allowlist.json');
  if (existsSync(allowFile)) {
    sources.push(rel(allowFile));
    const j = readJson(allowFile) as { allow?: unknown; strict?: unknown; why?: unknown };
    if (!j || typeof j !== 'object' || !Array.isArray(j.allow)) throw new Error(`names_check: ${rel(allowFile)} must be { "allow": ["Name", …], "why": { … } }`);
    for (const a of j.allow) if (typeof a === 'string') allow.add(nameTokens(a).join(' '));
    if (Array.isArray(j.strict)) for (const c of j.strict) if (typeof c === 'string') strict.add(c);
    const why = (j.why && typeof j.why === 'object') ? j.why as Record<string, unknown> : {};
    for (const a of j.allow) if (typeof a === 'string' && !(a in why)) warnings.push(`${rel(allowFile)}: "${a}" is allowlisted without a "why"`);
  }

  const entries: DenyEntry[] = [];
  const index = new Map<string, { entry: DenyEntry; variant: string[] }[]>();
  const seen = new Set<string>();
  for (const r of raw) {
    const canon = nameTokens(r.name);
    if (canon.length === 0) { warnings.push(`${r.source}: protected name "${r.name}" has no letters/digits — skipped`); continue; }
    const key = `${r.category}\u0000${canon.join(' ')}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const variants: string[][] = [canon];
    const alt = apostropheAsSpaceTokens(r.name);
    if (alt.join(' ') !== canon.join(' ')) variants.push(alt);
    if (canon.length > 1) variants.push([canon.join('')]);

    const entry: DenyEntry = { name: r.name, category: r.category, source: r.source, variants, flagName: false, flagProse: false, reason: null };
    if (allow.has(canon.join(' '))) entry.inertWhy = 'allowlisted';
    else if (canon.length > 1) { entry.reason = 'multi_word'; entry.flagName = entry.flagProse = true; }
    else if (!isDictionaryWord(canon[0])) { entry.reason = 'non_dictionary'; entry.flagName = entry.flagProse = true; }
    else if (strict.has(r.category)) { entry.reason = 'strict'; entry.flagName = true; }
    else entry.inertWhy = 'dictionary_word';
    entries.push(entry);

    if (entry.reason) {
      for (const v of variants) {
        const list = index.get(v[0]) ?? [];
        list.push({ entry, variant: v });
        index.set(v[0], list);
      }
    }
  }
  return { entries, strictCategories: [...strict].sort(), allow: [...allow].sort(), sources, warnings, index };
}

let cachedDefault: DenyList | null = null;

/** Every protected-name hit in `strings`. `kind` defaults to 'name' (the stricter reading). */
export function checkNames(strings: readonly NameInput[], list?: DenyList): NameHit[] {
  const deny = list ?? (cachedDefault ??= loadDenyList());
  const hits: NameHit[] = [];
  if (deny.index.size === 0) return hits;
  for (const s of strings) {
    const kind: TextKind = s.kind ?? 'name';
    const toks = nameTokens(s.text);
    const reported = new Set<DenyEntry>();
    for (let i = 0; i < toks.length; i++) {
      const cands = deny.index.get(toks[i]);
      if (!cands) continue;
      for (const { entry, variant } of cands) {
        if (reported.has(entry)) continue;
        if (kind === 'name' ? !entry.flagName : !entry.flagProse) continue;
        if (i + variant.length > toks.length) continue;
        let ok = true;
        for (let k = 1; k < variant.length; k++) if (toks[i + k] !== variant[k]) { ok = false; break; }
        if (!ok) continue;
        reported.add(entry);
        hits.push({ path: s.path, text: s.text, kind, protectedName: entry.name, category: entry.category, source: entry.source, reason: entry.reason as HitReason });
      }
    }
  }
  return hits;
}

export function formatHit(h: NameHit): string {
  const why = h.reason === 'multi_word' ? 'multi-word protected name' : h.reason === 'non_dictionary' ? 'protected non-dictionary word' : 'strict-category name';
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
      const flagged = es.filter((e) => e.reason);
      const inert = es.filter((e) => !e.reason);
      console.log(`${cat}${list.strictCategories.includes(cat) ? ' (strict)' : ''}: ${flagged.length} flagged, ${inert.length} inert`);
      if (inert.length) console.log(`  inert: ${inert.map((e) => `${e.name}${e.inertWhy === 'allowlisted' ? ' [allow]' : ''}`).join(', ')}`);
    }
    return 0;
  }
  const hits = checkNames(texts.map((t, i) => ({ path: `arg[${i}]`, text: t, kind })), list);
  for (const h of hits) console.log(`HIT ${h.path}: ${formatHit(h)}`);
  if (!hits.length) console.log(`clean (${texts.length} string${texts.length === 1 ? '' : 's'} checked as ${kind})`);
  return hits.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
