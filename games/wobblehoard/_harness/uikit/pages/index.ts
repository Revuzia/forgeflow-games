// Batch -> pages. A batch appends its file here; `?batch=B3` shows B0..B3 cumulatively (a later batch must not break an earlier page).
import type { KitSection } from './types.ts';
import { b0Sections } from './b0.ts';
import { b2Sections } from './b2.ts';

export const BATCHES: ReadonlyArray<{ id: string; sections: () => KitSection[] }> = [
  { id: 'B0', sections: b0Sections },
  { id: 'B2', sections: b2Sections },
];

export function sectionsUpTo(batch: string): KitSection[] {
  const out: KitSection[] = [];
  for (const b of BATCHES) { out.push(...b.sections()); if (b.id === batch) break; }
  return out;
}
