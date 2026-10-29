// VALE UI — what Settings › Credits lists (originality F7): the open-source code and the typefaces the client ships,
// each with its license and the copyright line from its LICENSE file (node_modules/<pkg>/LICENSE, read 2026-10-28).
// The build writes the authoritative list next to index.html: third_party_notices.json (every package whose code or
// files land in the bundle: {name, version, license, homepage}) and THIRD_PARTY_NOTICES.txt (the same with the full
// license texts); vite.config.ts serves both at the page root in dev and preview too. The panel lists what the JSON
// names, with the version it carries, and adds this file's display name, use and copyright line by package name;
// CREDITS below is the fallback when the JSON cannot be read. When a dependency is added, give it an entry here.
//
// Not content: these are library names and legal lines, not catalog ids, and they are never translated.

export interface CreditEntry {
  /** the npm package this entry describes (third_party_notices.json `name`) */
  pkg: string;
  /** the package or family name as its authors write it */
  name: string;
  kind: 'code' | 'type';
  /** SPDX id */
  license: string;
  /** the copyright line, as in the package's LICENSE */
  notice: string;
  /** where the project lives */
  url: string;
  /** what VALE uses it for (a strings key under settings.credits.use.*) */
  use: string;
  /** the version, from third_party_notices.json when it was read */
  version?: string;
}

export const CREDITS: readonly CreditEntry[] = [
  { pkg: 'three', name: 'three.js', kind: 'code', license: 'MIT', notice: 'Copyright © 2010-2026 three.js authors', url: 'https://github.com/mrdoob/three.js', use: 'render' },
  { pkg: 'postprocessing', name: 'postprocessing', kind: 'code', license: 'Zlib', notice: 'Copyright © 2015 Raoul van Rüschen', url: 'https://github.com/pmndrs/postprocessing', use: 'post' },
  { pkg: 'n8ao', name: 'N8AO', kind: 'code', license: 'CC0-1.0', notice: 'Released into the public domain by its author (CC0 1.0; its package lists ISC)', url: 'https://github.com/N8python/n8ao', use: 'ao' },
  { pkg: 'preact', name: 'Preact', kind: 'code', license: 'MIT', notice: 'Copyright (c) 2015-present Jason Miller', url: 'https://github.com/preactjs/preact', use: 'ui' },
  { pkg: '@preact/signals', name: 'Preact Signals', kind: 'code', license: 'MIT', notice: 'Copyright (c) 2022-present Preact Team', url: 'https://github.com/preactjs/signals', use: 'state' },
  { pkg: '@preact/signals-core', name: 'Preact Signals Core', kind: 'code', license: 'MIT', notice: 'Copyright (c) 2022-present Preact Team', url: 'https://github.com/preactjs/signals', use: 'state' },
  { pkg: 'meshoptimizer', name: 'meshoptimizer', kind: 'code', license: 'MIT', notice: 'Copyright (c) 2016-2026 Arseny Kapoulkine', url: 'https://github.com/zeux/meshoptimizer', use: 'mesh' },
  { pkg: 'zod', name: 'Zod', kind: 'code', license: 'MIT', notice: 'Copyright (c) 2025 Colin McDonnell', url: 'https://github.com/colinhacks/zod', use: 'data' },
  { pkg: '@fontsource/gloock', name: 'Gloock', kind: 'type', license: 'OFL-1.1', notice: 'Copyright 2022 The Gloock Project Authors', url: 'https://github.com/duartp/gloock', use: 'display' },
  { pkg: '@fontsource-variable/instrument-sans', name: 'Instrument Sans', kind: 'type', license: 'OFL-1.1', notice: 'Copyright 2022 The Instrument Sans Project Authors', url: 'https://github.com/Instrument/instrument-sans', use: 'heading' },
  { pkg: '@fontsource/atkinson-hyperlegible-next', name: 'Atkinson Hyperlegible Next', kind: 'type', license: 'OFL-1.1', notice: 'Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors', url: 'https://github.com/googlefonts/atkinson-hyperlegible-next', use: 'body' },
  { pkg: '@fontsource/atkinson-hyperlegible-mono', name: 'Atkinson Hyperlegible Mono', kind: 'type', license: 'OFL-1.1', notice: 'Copyright 2020-2024 The Atkinson Hyperlegible Mono Project Authors', url: 'https://github.com/googlefonts/atkinson-hyperlegible-next-mono', use: 'numeric' },
];

/** the notices file the build ships next to index.html */
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';
/** the machine-readable list the build ships next to it */
export const NOTICES_JSON = 'third_party_notices.json';

/** one row of third_party_notices.json */
export interface NoticeRow { name: string; version: string; license: string; homepage: string }

/** parse third_party_notices.json; null when it is not the list (an HTML fallback page, a broken file) */
export function parseNotices(raw: unknown): NoticeRow[] | null {
  if (!Array.isArray(raw)) return null;
  const out: NoticeRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.name !== 'string' || !o.name) continue;
    const s = (v: unknown): string => (typeof v === 'string' ? v : '');
    // the chip shows the SPDX id; the build may annotate it ('CC0-1.0; its package.json says ISC'), which the curated
    // copyright line already explains
    const lic = s(o.license).split(';')[0].trim();
    out.push({ name: o.name, version: s(o.version), license: lic || 'UNKNOWN', homepage: s(o.homepage) });
  }
  return out.length ? out : null;
}

/** the panel's rows: what the build bundles (the JSON), each with this file's name, use and copyright line by package
 *  name; a bundled package this file does not know yet still shows (its package name, license and homepage). Without
 *  the JSON, the curated list. */
export function creditRows(notices: readonly NoticeRow[] | null): CreditEntry[] {
  if (!notices) return [...CREDITS];
  const byPkg = new Map(CREDITS.map((c) => [c.pkg, c] as const));
  const font = (n: string): boolean => /^@fontsource(-variable)?\//.test(n);
  const rows = notices.map((n): CreditEntry => {
    const c = byPkg.get(n.name);
    return {
      pkg: n.name, name: c?.name ?? n.name, kind: c?.kind ?? (font(n.name) ? 'type' : 'code'), license: n.license || c?.license || 'UNKNOWN',
      notice: c?.notice ?? '', url: n.homepage || c?.url || '', use: c?.use ?? '', version: n.version || undefined,
    };
  });
  // the curated order (code, then the faces), then anything new by name
  const order = new Map(CREDITS.map((c, i) => [c.pkg, i] as const));
  return rows.sort((a, b) => (order.get(a.pkg) ?? 999) - (order.get(b.pkg) ?? 999) || a.name.localeCompare(b.name));
}
