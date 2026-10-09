// Batch -> pages. A batch appends its file here; `?batch=B3` shows B0..B3 cumulatively (a later batch must not break an earlier page).
import type { KitSection } from './types.ts';
import { b0Sections } from './b0.ts';
import { b2Sections } from './b2.ts';
import { b3Sections } from './b3.ts';
import { b3bSections } from './b3b.ts';
import { b5Sections } from './b5.ts';

export const BATCHES: ReadonlyArray<{ id: string; sections: () => KitSection[] }> = [
  { id: 'B0', sections: b0Sections },
  { id: 'B2', sections: b2Sections },
  { id: 'B3', sections: () => [...b3Sections(), ...b3bSections()] },
  { id: 'B5', sections: b5Sections },
];

export function sectionsUpTo(batch: string): KitSection[] {
  const out: KitSection[] = [];
  for (const b of BATCHES) { out.push(...b.sections()); if (b.id === batch) break; }
  return out;
}
