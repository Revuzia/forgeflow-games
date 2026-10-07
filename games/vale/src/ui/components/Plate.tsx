// VALE UI — the plate (structure), the bible's honed-slate surface: ink-2 at 94%, 2 px radius, 1 px
// top-left catch-light, 1 px bottom-right shade, 2% grain. No backdrop blur. `lit` adds the dawnglass
// inlay (selected / ready only). Ornaments (HourTicks, HourLine) tell time, rank or rarity — ≤ 2 per
// panel, never on scrolling lists.

import type { ComponentChildren, JSX } from 'preact';

export function Plate(p: {
  as?: 'div' | 'section' | 'article' | 'aside' | 'header' | 'li';
  class?: string; lit?: boolean; selected?: boolean; tone?: 'normal' | 'error' | 'quiet' | 'raised';
  children?: ComponentChildren; style?: JSX.CSSProperties; label?: string; id?: string;
}): JSX.Element {
  const Tag = p.as ?? 'div';
  return (
    <Tag id={p.id} class={`plate ${p.lit ? 'plate--lit' : ''} ${p.selected ? 'is-selected' : ''} ${p.tone ? `plate--${p.tone}` : ''} ${p.class ?? ''}`}
      style={p.style} aria-label={p.label}>
      {p.children}
    </Tag>
  );
}

/** 1–4 short ticks at a plate's top-left: the count is tier, rarity or rank */
export function HourTicks(p: { n: number; color?: string; class?: string; label?: string }): JSX.Element {
  const n = Math.max(0, Math.min(4, Math.round(p.n)));
  return (
    <span class={`hourticks ${p.class ?? ''}`} style={p.color ? { color: p.color } : undefined} aria-label={p.label} role={p.label ? 'img' : undefined}>
      {Array.from({ length: n }, () => <i />)}
    </span>
  );
}

/** a 1 px rule from a heading's baseline, ending in a 3 px dot (the shadow's tip) */
export function HourLine(p: { cols?: 1 | 2 | 3; class?: string }): JSX.Element {
  return <span class={`hourline hourline--${p.cols ?? 2} ${p.class ?? ''}`} aria-hidden="true"><i /></span>;
}

/** the "new" gloam dot (6 px), cleared once seen */
export function NewDot(p: { label?: string; class?: string }): JSX.Element {
  return <span class={`newdot ${p.class ?? ''}`} role="img" aria-label={p.label ?? 'New'} />;
}

/** key label chip (keyboard hints) */
export function Keycap(p: { k: string; quiet?: boolean }): JSX.Element {
  return <span class={`keycap ${p.quiet ? 'keycap--quiet' : ''}`}>{p.k}</span>;
}
