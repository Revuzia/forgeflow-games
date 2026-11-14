// HIT PARADE - copy lookup (CONTRACT 2: ALL user-facing copy lives in data/strings.json, keyed, flat).
//
// t('key', {vars}) fills {placeholders}; a missing key renders as `[key]` (loud on purpose) and warns once. pool('x')
// collects x.0, x.1, ... in order. GameData.strings (the same file, loaded by core/data.ts) may be merged in with
// setStrings() - later keys win - so a data-side override needs no UI change.

import STR from '../../../data/strings.json' with { type: 'json' };

const table: Record<string, string> = { ...(STR as Record<string, string>) };
const warned = new Set<string>();

export function setStrings(extra: Readonly<Record<string, string>> | null | undefined): void {
  if (!extra) return;
  for (const k of Object.keys(extra)) { const v = extra[k]; if (typeof v === 'string') table[k] = v; }
}

export function has(key: string): boolean { return typeof table[key] === 'string'; }

export function fill(tpl: string, vars?: Readonly<Record<string, string | number>>): string {
  if (!vars) return tpl;
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

export function t(key: string, vars?: Readonly<Record<string, string | number>>): string {
  const s = table[key];
  if (typeof s !== 'string') {
    if (!warned.has(key)) { warned.add(key); console.warn(`[hit-parade ui] missing string "${key}"`); }
    return `[${key}]`;
  }
  return fill(s, vars);
}

/** t() with a fallback key / literal when the key is absent (no warning) */
export function tOr(key: string, fallback: string, vars?: Readonly<Record<string, string | number>>): string {
  const s = table[key];
  return fill(typeof s === 'string' ? s : fallback, vars);
}

export function pool(prefix: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < 64; i++) { const s = table[`${prefix}.${i}`]; if (typeof s !== 'string') break; out.push(s); }
  return out;
}

/** every key the UI has been asked for that did not resolve (read-back for the harness) */
export function missingKeys(): string[] { return [...warned]; }
