// VALE sim — `script` effect registry (CONTRACT §5.3: "Every `script` behaviour lives in
// src/sim/scripts/<id>.ts and is registered by id").
//
// The escape hatch for behaviour the DSL cannot express. A script module calls
// `register('<id>', fn)` at import time and is imported from this file's list below, so the sim
// knows every script without dynamic loading. Unknown ids are a content-build error; at runtime
// an unknown id is a no-op (never throws mid-match).
//
// Scripts must obey the sim rules: deterministic (rng streams only, iterate in id order), no
// three/DOM, no wall-clock time. They receive the live World and the effect context.

import type { EffectCtx } from '../entity.ts';
import type { World } from '../world.ts';

export type ScriptFn = (w: World, ctx: EffectCtx, params: Readonly<Record<string, unknown>>) => void;

const registry = new Map<string, ScriptFn>();

/** register a script behaviour; ids are lower_snake_case content ids and must be unique */
export function register(id: string, fn: ScriptFn): void {
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw new Error(`script id '${id}' is not lower_snake_case`);
  if (registry.has(id)) throw new Error(`script '${id}' registered twice`);
  registry.set(id, fn);
}
/** remove a registration (tests only) */
export function unregister(id: string): void { registry.delete(id); }
export function getScript(id: string): ScriptFn | undefined { return registry.get(id); }
export function registeredScripts(): string[] { return [...registry.keys()].sort(); }

// ── shipped scripts ─────────────────────────────────────────────────────────────────────────────
// (none yet: import './<id>.ts' here when content needs one)
