// VALE UI — the designed states every surface ships (bible §States):
//   loading  final-size skeleton plates with a SHADOW SWEEP (a 30° band, 1.4 s linear loop)
//   empty    one drawing (the uncarved dial), one sentence, one action
//   error    a HARM rule, the wedge "!" glyph, a plain message and Retry — never a dead end

import type { ComponentChildren, JSX } from 'preact';
import { Button } from './Button.tsx';
import { Icon } from './Glyphs.tsx';

export function Skeleton(p: { w?: string; h?: string; r?: 'plate' | 'round' | 'line'; class?: string; style?: JSX.CSSProperties }): JSX.Element {
  return <span class={`skel skel--${p.r ?? 'plate'} ${p.class ?? ''}`} style={{ width: p.w, height: p.h, ...p.style }} aria-hidden="true" />;
}

/** a list/grid of skeletons at their final size, announced once for screen readers */
export function SkeletonGroup(p: { label?: string; class?: string; children: ComponentChildren }): JSX.Element {
  return <div class={`skelgroup ${p.class ?? ''}`} role="status" aria-busy="true" aria-label={p.label ?? 'Loading'}>{p.children}</div>;
}

/** the empty-state drawing: an uncarved dial (120 px), line only */
export function UncarvedDial(p: { size?: number }): JSX.Element {
  const s = `calc(${p.size ?? 120}px * var(--k))`;
  const ticks = Array.from({ length: 12 }, (_, i) => i);
  return (
    <svg class="uncarved" viewBox="0 0 120 120" style={{ width: s, height: s }} aria-hidden="true" fill="none" stroke="currentColor">
      <circle cx="60" cy="60" r="52" stroke-width="1" />
      <circle cx="60" cy="60" r="40" stroke-width="1" stroke-dasharray="1 5" />
      {ticks.map((i) => {
        const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const carved = i === 0;
        return <line x1={60 + Math.cos(a) * 44} y1={60 + Math.sin(a) * 44} x2={60 + Math.cos(a) * (carved ? 52 : 47)} y2={60 + Math.sin(a) * (carved ? 52 : 47)} stroke-width={carved ? 1.5 : 1} opacity={carved ? 1 : 0.45} />;
      })}
      <path d="M60 60 L60 20" stroke-width="1" opacity="0.5" />
      <circle cx="60" cy="60" r="2.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function EmptyState(p: { text: string; action?: { label: string; run: () => void }; class?: string; compact?: boolean }): JSX.Element {
  return (
    <div class={`empty ${p.compact ? 'empty--compact' : ''} ${p.class ?? ''}`} role="status">
      <UncarvedDial size={p.compact ? 72 : 120} />
      <p class="t-body empty__text">{p.text}</p>
      {p.action ? <Button variant="secondary" onPress={p.action.run}>{p.action.label}</Button> : null}
    </div>
  );
}

export function ErrorState(p: { text: string; onRetry?: () => void; class?: string }): JSX.Element {
  return (
    <div class={`errstate ${p.class ?? ''}`} role="alert">
      <Icon name="danger" class="errstate__glyph" />
      <p class="t-body errstate__text">{p.text}</p>
      {p.onRetry ? <Button variant="secondary" icon="reroll" onPress={p.onRetry}>Retry</Button> : null}
    </div>
  );
}
