// GENESIS — the terrain patch building worker (patchbuild.ts): builds patch vertex arrays off the main thread and
// sends them back (transferred; the main thread hands the buffers back with its next request). Shared by every planet.

import { handlePatchMessage, type PatchRequest, type PatchState } from './patchbuild.ts';
import { getGrid } from '../../sim/grid/icogrid.ts';
import { Noise3 } from '../../sim/grid/noise.ts';

const state: PatchState = { builders: new Map(), free: [], makeGrid: getGrid, makeNoise: (s) => new Noise3(s) };
const scope = self as unknown as { onmessage: ((e: MessageEvent<PatchRequest>) => void) | null; postMessage(m: unknown, transfer: Transferable[]): void };
scope.onmessage = (e) => {
  const r = handlePatchMessage(state, e.data);
  if (r) scope.postMessage(r.reply, r.transfer);
};
