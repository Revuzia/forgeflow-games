// VALE — catalog manifest format (CONTRACT §3.2). Types only: the content build (tools/build_content.ts)
// writes this shape, the client boot (src/boot/catalog.ts) reads it. Neither side imports zod here.
//
// CHANGED(TOOLS): new file. It only names the shape §3.2 already specifies, so writer and reader
// cannot drift; nothing about the format changed.
//
// The manifest is the ONE mutable file of a deployed catalog. Everything it points at is immutable:
//   schema-<n>/<version>/catalog.json   one per (schema, version); never rewritten once published
//   assets/<sha256-12>-<basename>       content-addressed, shared by every version and schema
// so a CDN can cache everything but manifest.json forever. Paths are relative to the manifest URL,
// and asset refs inside a catalog are relative to the manifest DIRECTORY (not to catalog.json).

export const MANIFEST_FORMAT = 1 as const;
export const MANIFEST_PRODUCT = 'vale' as const;

export interface ManifestSchemaEntry {
  /** catalog version (YYYY.M.patch) currently served for this schema */
  version: string;
  /** path of catalog.json relative to the manifest URL, e.g. `schema-1/2026.10.0/catalog.json` */
  catalog: string;
  /** lowercase hex sha256 of the exact catalog.json bytes */
  sha256: string;
}

export interface ManifestHistoryEntry { schema: number; version: string; builtAt: string }

export interface CatalogManifest {
  format: typeof MANIFEST_FORMAT;
  product: typeof MANIFEST_PRODUCT;
  /** keyed by schema number as a string ("1", "2", …). A client picks the highest key it supports. */
  schemas: Record<string, ManifestSchemaEntry>;
  /** append-only build log, oldest first */
  history: ManifestHistoryEntry[];
}
