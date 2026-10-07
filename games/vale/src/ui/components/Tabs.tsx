// VALE UI — tabs (WAI-ARIA tablist, roving tabindex, ←/→ Home/End; selected keeps a chalk hour-tick).

import type { ComponentChildren, JSX } from 'preact';
import { useRef } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import { NewDot } from './Plate.tsx';

export interface TabItem { id: string; label: string; badge?: ComponentChildren; isNew?: boolean; disabled?: string }

export function Tabs(p: { items: TabItem[]; value: string; onChange: (id: string) => void; label: string; class?: string; size?: 'm' | 's' }): JSX.Element {
  const { sound } = useApp();
  const list = useRef<HTMLDivElement>(null);
  const pick = (id: string, focus = false): void => {
    if (id === p.value) return;
    sound.play('tab');
    p.onChange(id);
    if (focus) setTimeout(() => list.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(id)}"]`)?.focus(), 0);
  };
  const onKey = (e: KeyboardEvent): void => {
    const enabled = p.items.filter((t) => !t.disabled);
    const i = enabled.findIndex((t) => t.id === p.value);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = enabled.length - 1;
    if (n >= 0) { e.preventDefault(); e.stopPropagation(); pick(enabled[n].id, true); }
  };
  return (
    <div ref={list} class={`tabs tabs--${p.size ?? 'm'} ${p.class ?? ''}`} role="tablist" aria-label={p.label} onKeyDown={onKey}>
      {p.items.map((t) => {
        const sel = t.id === p.value;
        return (
          <button type="button" role="tab" class={`tab ${sel ? 'is-selected' : ''}`} aria-selected={sel} tabIndex={sel ? 0 : -1}
            aria-disabled={t.disabled ? 'true' : undefined} title={t.disabled} data-tab={t.id}
            onPointerEnter={() => sound.play('hover')}
            onClick={() => { if (!t.disabled) pick(t.id); }}>
            <span class="t-label">{t.label}</span>
            {t.badge !== undefined ? <span class="tab__badge num">{t.badge}</span> : null}
            {t.isNew ? <NewDot /> : null}
          </button>
        );
      })}
    </div>
  );
}
