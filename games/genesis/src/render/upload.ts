// PERF F3: upload only the written prefix of an instanced / streamed attribute. three re-uploads the WHOLE array on
// needsUpdate unless update ranges are given; the instanced pools are sized for the worst case (groundcover 6000
// instances = 384 kB of instanceMatrix per mesh) and usually hold a fraction of it. The GPU keeps the old tail, which
// is never drawn (mesh.count bounds every draw), so the image is identical.
import type { BufferAttribute, InstancedBufferAttribute, InterleavedBufferAttribute } from 'three';

type Attr = BufferAttribute | InstancedBufferAttribute;

/** mark items [0, count) of `a` for upload (nothing when count is 0) */
export function uploadPrefix(a: Attr | InterleavedBufferAttribute | null | undefined, count: number): void {
  if (!a || count <= 0) return;
  const b = a as Attr;
  if (typeof b.clearUpdateRanges !== 'function') { (a as Attr).needsUpdate = true; return; }
  b.clearUpdateRanges();
  b.addUpdateRange(0, Math.min(b.array.length, count * b.itemSize));
  b.needsUpdate = true;
}
