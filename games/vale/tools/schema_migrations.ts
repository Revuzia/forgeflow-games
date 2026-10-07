// VALE — catalog schema down-converters (CONTRACT §3.3).
//
// WHY: the client build and the content build ship separately. A client compiled for schema N keeps
// running on players' machines after content moves to schema N+1, so the content build must keep
// emitting every older schema it can still produce. Each breaking schema change therefore lands
// together with ONE down-converter `vN → vN-1` registered here.
//
// CONTRACT for a converter:
//   * keyed by its FROM schema; `to` must be `from - 1` (chains are walked one step at a time);
//   * input is a parsed, defaults-applied, asset-rewritten catalog of schema `from` (a private deep
//     copy — mutate freely); output is a catalog of schema `to`, `schema` field included (the
//     registry sets it if the converter forgets, and verifies it);
//   * pure and deterministic (same input ⇒ same bytes ⇒ same sha256 in the manifest);
//   * lossy is fine (drop what old clients cannot show), inventing ids is not: every id the old
//     catalog references must exist in it.
//
// The build emits SCHEMA_VERSION plus every schema reachable downward through registered converters
// (`reachable()`), stopping at the first gap. Only the current schema is zod-validated by the build;
// if an old schema needs validating, snapshot its zod file under tools/schemas/v<n>.ts when you
// write its converter.
//
// While SCHEMA_VERSION is 1 the production registry (MIGRATIONS) is empty. `identityDown()` is the
// worked example: it is exercised only by _harness/probe_schema_negotiation.ts, which pretends a
// schema 2 exists, builds schema 1 from it, and runs a schema-1 client against the result.

/** A catalog as plain JSON data. Converters see/produce untyped records on purpose: the TS type
 *  in src/contracts describes only the CURRENT schema. */
export type CatalogData = Record<string, unknown> & { schema: number };

export interface DownConverter {
  from: number;
  to: number;
  /** one line for the build log: what old clients lose */
  note: string;
  convert(catalog: CatalogData): CatalogData;
}

export interface MigrationRegistry {
  readonly converters: ReadonlyMap<number, DownConverter>;
  register(c: DownConverter): void;
  /** [from, from-1, …] down to the lowest schema reachable through registered converters */
  reachable(from: number): number[];
  /** convert `catalog` (any registered schema) down to `target`; returns a new object */
  applyDown(catalog: CatalogData, target: number): CatalogData;
}

export function createRegistry(initial: readonly DownConverter[] = []): MigrationRegistry {
  const converters = new Map<number, DownConverter>();
  const register = (c: DownConverter): void => {
    if (!Number.isInteger(c.from) || c.to !== c.from - 1 || c.to < 1) {
      throw new Error(`schema_migrations: converter must be vN → vN-1 with N ≥ 2 (got ${c.from} → ${c.to})`);
    }
    if (converters.has(c.from)) throw new Error(`schema_migrations: a converter from schema ${c.from} is already registered`);
    converters.set(c.from, c);
  };
  for (const c of initial) register(c);

  return {
    converters,
    register,
    reachable(from: number): number[] {
      const out = [from];
      for (let s = from; converters.has(s); s--) out.push(s - 1);
      return out;
    },
    applyDown(catalog: CatalogData, target: number): CatalogData {
      let cur: CatalogData = structuredClone(catalog);
      if (target > cur.schema) throw new Error(`schema_migrations: cannot convert UP (schema ${cur.schema} → ${target}); only down-converters exist`);
      while (cur.schema > target) {
        const c = converters.get(cur.schema);
        if (!c) {
          throw new Error(`schema_migrations: no down-converter registered from schema ${cur.schema} (needed to reach ${target}); `
            + `registered: [${[...converters.keys()].sort((a, b) => b - a).join(', ')}]`);
        }
        const next = c.convert(cur);
        if (next.schema === cur.schema) next.schema = c.to;
        if (next.schema !== c.to) throw new Error(`schema_migrations: converter ${c.from} → ${c.to} produced schema ${String(next.schema)}`);
        cur = next;
      }
      return cur;
    },
  };
}

/** Worked example (probe only): a breaking change that old clients can simply ignore. A real
 *  converter would e.g. drop a new required field or fold a new record family into an old one. */
export function identityDown(from: number, note = 'identity (example only)'): DownConverter {
  return { from, to: from - 1, note, convert: (c) => ({ ...c, schema: from - 1 }) };
}

/** The production registry used by tools/build_content.ts. Add `vN → vN-1` converters here when
 *  SCHEMA_VERSION is bumped. Empty while SCHEMA_VERSION = 1. */
export const MIGRATIONS: MigrationRegistry = createRegistry([]);
