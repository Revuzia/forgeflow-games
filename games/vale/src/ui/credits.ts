// VALE UI — what Settings › Credits lists (originality F7): the open-source code and the typefaces the client ships,
// each with its license and the copyright line from its LICENSE file (node_modules/<pkg>/LICENSE, read 2026-10-28).
// The full license texts travel with the build as THIRD_PARTY_NOTICES.txt (emitted by the build, W1); the panel opens
// that file when it is there. When a dependency is added or upgraded, update this list with it.
//
// Not content: these are library names and legal lines, not catalog ids, and they are never translated.

export interface CreditEntry {
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
}

export const CREDITS: readonly CreditEntry[] = [
  { name: 'three.js', kind: 'code', license: 'MIT', notice: 'Copyright © 2010-2026 three.js authors', url: 'https://github.com/mrdoob/three.js', use: 'render' },
  { name: 'postprocessing', kind: 'code', license: 'Zlib', notice: 'Copyright © 2015 Raoul van Rüschen', url: 'https://github.com/pmndrs/postprocessing', use: 'post' },
  { name: 'N8AO', kind: 'code', license: 'CC0-1.0', notice: 'Released into the public domain by its author (CC0 1.0; its package lists ISC)', url: 'https://github.com/N8python/n8ao', use: 'ao' },
  { name: 'Preact', kind: 'code', license: 'MIT', notice: 'Copyright (c) 2015-present Jason Miller', url: 'https://github.com/preactjs/preact', use: 'ui' },
  { name: 'Preact Signals', kind: 'code', license: 'MIT', notice: 'Copyright (c) 2022-present Preact Team', url: 'https://github.com/preactjs/signals', use: 'state' },
  { name: 'Zod', kind: 'code', license: 'MIT', notice: 'Copyright (c) 2025 Colin McDonnell', url: 'https://github.com/colinhacks/zod', use: 'data' },
  { name: 'Gloock', kind: 'type', license: 'OFL-1.1', notice: 'Copyright 2022 The Gloock Project Authors', url: 'https://github.com/duartp/gloock', use: 'display' },
  { name: 'Instrument Sans', kind: 'type', license: 'OFL-1.1', notice: 'Copyright 2022 The Instrument Sans Project Authors', url: 'https://github.com/Instrument/instrument-sans', use: 'heading' },
  { name: 'Atkinson Hyperlegible Next', kind: 'type', license: 'OFL-1.1', notice: 'Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors', url: 'https://github.com/googlefonts/atkinson-hyperlegible-next', use: 'body' },
  { name: 'Atkinson Hyperlegible Mono', kind: 'type', license: 'OFL-1.1', notice: 'Copyright 2020-2024 The Atkinson Hyperlegible Mono Project Authors', url: 'https://github.com/googlefonts/atkinson-hyperlegible-next-mono', use: 'numeric' },
];

/** the notices file the build ships next to index.html */
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';
