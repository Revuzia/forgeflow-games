// A kit page = a list of sections; each section is one screenshot unit for shoot.mjs (`#sec-<id>`). A batch adds its own file
// (b0.ts, b2.ts, ...) and registers it in index.ts; earlier batches' pages stay so a later batch can see it did not break them.
import { h } from '../../../src/ui/dom.ts';

import type { LayoutHandle } from '../../../src/ui/layout.ts';

export interface KitCtx { layout: LayoutHandle }
export interface KitSection {
  id: string; title: string; note?: string;
  /** a full-bleed section (the page's side padding removed): a scene drawn at exactly the viewport's size */
  bleed?: boolean;
  build(host: HTMLElement, ctx: KitCtx): void;
}

/** A captioned specimen on a stage. `tone` picks the backdrop (white and amber are the worst cases for the focus ring and the glass). */
export function cell(caption: string, stage: Node[] | Node, o: { tone?: 'white' | 'amber' | 'felt' | 'ink'; col?: boolean; frame?: boolean } = {}): HTMLElement {
  const cls = ['kp-stage'];
  if (o.tone) cls.push(`kp-stage--${o.tone}`);
  if (o.col) cls.push('kp-stage--col');
  if (o.frame) cls.push('kp-stage--frame');
  return h('figure', { class: 'kp-cell' }, h('div', { class: cls.join(' ') }, ...(Array.isArray(stage) ? stage : [stage])), h('figcaption', { text: caption }));
}

export const sub = (text: string): HTMLElement => h('h3', { class: 'kp-sub', text });
export const grid = (cells: Node[], wide: boolean | 'panel' = false): HTMLElement => h('div', { class: wide === 'panel' ? 'kp-grid kp-grid--panel' : wide ? 'kp-grid kp-grid--wide' : 'kp-grid' }, ...cells);
