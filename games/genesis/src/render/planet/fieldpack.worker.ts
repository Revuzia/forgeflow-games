// GENESIS — the field-texture packing worker (fieldpack.ts): packs the sim's fields into the terrain / water texture
// arrays off the main thread and sends them back (transferred). One worker serves every planet (keyed by id).

import { handlePackMessage, type PackRequest, type PackState } from './fieldpack.ts';

const state: PackState = new Map();
const scope = self as unknown as { onmessage: ((e: MessageEvent<PackRequest>) => void) | null; postMessage(m: unknown, transfer: Transferable[]): void };
scope.onmessage = (e) => {
  const r = handlePackMessage(state, e.data);
  if (r) scope.postMessage(r.reply, r.transfer);
};
