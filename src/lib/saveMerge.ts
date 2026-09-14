/**
 * Cloud-save merge. Pure, no I/O — so it can be tested directly.
 *
 * THE RULE: a write never drops a key the stored record already had.
 *
 * Objects merge key by key; anything the incoming payload does not mention is
 * kept from storage. Scalars and arrays: incoming wins. A non-object payload
 * cannot be merged, so it replaces.
 *
 * This is a BACKSTOP, not a game's own merge logic. When a game reads the cloud
 * successfully it merges cloud into local and pushes the union, so this is a
 * no-op. It only bites when a game pushes a thin snapshot — which is exactly
 * the case that used to destroy an account: a signed-in Ascendant player lost
 * every unlock when the game's read timed out on a post-deploy cold boot and it
 * then pushed a fresh browser's snapshot over four cleared stages.
 */
export function mergePreservingKeys(stored: any, incoming: any): any {
  if (stored === null || stored === undefined) return incoming;
  if (incoming === null || incoming === undefined) return stored;
  const plain = (v: any) => v && typeof v === "object" && !Array.isArray(v);
  if (!plain(stored) || !plain(incoming)) return incoming;
  const out: any = { ...stored };
  for (const k of Object.keys(incoming)) {
    out[k] = plain(stored[k]) && plain(incoming[k])
      ? mergePreservingKeys(stored[k], incoming[k])
      : incoming[k];
  }
  return out;
}

/** Reserved marker a game sends when it genuinely means "wipe it". */
export const REPLACE_MARKER = "__replace";
