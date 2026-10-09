// GENESIS — the rewind ring in a save (CONTRACT.md §6.2 rewind, §6.6 save format): a loaded world can still be
// rewound and its past edited, back to the oldest keyframe the save kept (it used to start again at the moment of
// loading). The ring is stored as it lives in memory — each older keyframe encoded against the next newer one
// (core/kfcodec.ts) — and the newest keyframe encoded against the live state the save already holds, so the history
// costs only its deltas. A byte budget keeps the newest keyframes first; the command log is in the save's header.

import type { SaveWriter } from './core/serialize.ts';
import type { TypedArray } from './core/hash.ts';
import type { PackedArray } from './core/kfcodec.ts';

/** a keyframe as saved: its tick, its header (JSON text), its encoded arrays */
export interface SavedFrame {
  tick: number;
  header: string;
  packed: Map<string, PackedArray>;
}

/** what the save header holds per frame (the bytes are blobs named `blob`) */
interface FrameRecord {
  tick: number;
  header: string;
  arrays: { key: string; xor: boolean; byteLength: number; blob: string }[];
}

/** encoded bytes of history a save may hold (the newest keyframes are kept first) */
export const HISTORY_BUDGET = 24e6;
/** at most this many keyframes in a save */
export const HISTORY_FRAMES = 8;

/** keep the newest frames within the budget (the newest — the one the others decode through — always) */
export function trimHistory(frames: SavedFrame[]): SavedFrame[] {
  const out: SavedFrame[] = [];
  let bytes = 0;
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    let b = f.header.length * 2;
    for (const pk of f.packed.values()) b += pk.bytes.byteLength;
    if (out.length && (bytes + b > HISTORY_BUDGET || out.length >= HISTORY_FRAMES)) break;
    bytes += b;
    out.unshift(f);
  }
  return out;
}

/** write the frames' arrays as blobs; returns the header record */
export function writeHistory(w: SaveWriter, frames: SavedFrame[]): FrameRecord[] {
  return frames.map((f, i) => {
    const arrays: FrameRecord['arrays'] = [];
    for (const [key, pk] of f.packed) {
      const blob = `h${i}.${key}`;
      w.blob(blob, pk.bytes);
      arrays.push({ key, xor: pk.xor, byteLength: pk.byteLength, blob });
    }
    return { tick: f.tick, header: f.header, arrays };
  });
}

/** read the frames back (null: the save holds no history, or a malformed one — rewind then starts at the load) */
export function readHistory(h: unknown, blobs: Map<string, TypedArray>): SavedFrame[] | null {
  if (!Array.isArray(h) || !h.length) return null;
  const out: SavedFrame[] = [];
  for (const r of h as FrameRecord[]) {
    if (!r || typeof r.tick !== 'number' || typeof r.header !== 'string' || !Array.isArray(r.arrays)) return null;
    const packed = new Map<string, PackedArray>();
    for (const a of r.arrays) {
      const b = blobs.get(a.blob);
      if (!(b instanceof Uint8Array)) return null;
      packed.set(a.key, { xor: !!a.xor, bytes: b, byteLength: a.byteLength });
      blobs.delete(a.blob);
    }
    out.push({ tick: r.tick, header: r.header, packed });
  }
  return out;
}
