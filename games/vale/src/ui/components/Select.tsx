// VALE UI — choice controls. `Select` is a listbox popover (never the native <select>): ↑/↓ move,
// Enter picks, Esc closes (without leaving the screen), type-ahead by first letter. `Segmented` is a
// radio group for two to five options (←/→ move and pick).

import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app_ctx.ts';
import { Icon } from './Glyphs.tsx';

export interface Option<T extends string | number> { value: T; label: string; desc?: string; disabled?: string; adorn?: ComponentChildren }

export function Select<T extends string | number>(p: {
  value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; id?: string; disabled?: string; class?: string;
}): JSX.Element {
  const { sound } = useApp();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLUListElement>(null);
  const cur = p.options.find((o) => o.value === p.value);
  const listId = `${p.id ?? p.label.replace(/\W+/g, '-')}-list`;

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent): void => {
      if (!pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener('pointerdown', away, true);
    return () => removeEventListener('pointerdown', away, true);
  }, [open]);
  useEffect(() => { if (open) pop.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [open, active]);

  const openList = (): void => {
    if (p.disabled) { sound.play('error', 200); return; }
    setActive(Math.max(0, p.options.findIndex((o) => o.value === p.value)));
    setOpen(true);
  };
  const choose = (i: number): void => {
    const o = p.options[i];
    if (!o || o.disabled) { sound.play('error', 200); return; }
    if (o.value !== p.value) { sound.play('click'); p.onChange(o.value); }
    setOpen(false);
    btn.current?.focus();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); openList(); }
      return;
    }
    e.stopPropagation();
    if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') e.preventDefault(); setOpen(false); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(p.options.length - 1, a + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(p.options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
    else if (e.key.length === 1) {
      const i = p.options.findIndex((o) => o.label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (i >= 0) setActive(i);
    }
  };
  return (
    <div class={`select ${open ? 'is-open' : ''} ${p.class ?? ''}`}>
      <button ref={btn} type="button" id={p.id} class="select__btn" aria-haspopup="listbox" aria-expanded={open} aria-controls={listId}
        aria-label={`${p.label}: ${cur?.label ?? ''}`} aria-disabled={p.disabled ? 'true' : undefined} title={p.disabled}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onPointerDown={() => sound.play('click')} onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onKey}>
        {cur?.adorn ? <span class="select__adorn">{cur.adorn}</span> : null}
        <span class="select__value">{cur?.label ?? '—'}</span>
        <Icon name="chevron" class="select__chev" />
      </button>
      {open ? (
        <ul ref={pop} id={listId} class="select__pop" role="listbox" aria-label={p.label}>
          {p.options.map((o, i) => (
            <li id={`${listId}-${i}`} role="option" aria-selected={o.value === p.value} aria-disabled={o.disabled ? 'true' : undefined}
              class={`select__opt ${i === active ? 'is-active' : ''} ${o.value === p.value ? 'is-selected' : ''} ${o.disabled ? 'is-disabled' : ''}`}
              onPointerEnter={() => setActive(i)} onPointerDown={(e) => { e.preventDefault(); }} onClick={() => choose(i)}>
              {o.adorn ? <span class="select__adorn">{o.adorn}</span> : null}
              <span class="select__optlabel">{o.label}{o.desc ? <span class="select__desc t-caption">{o.desc}</span> : null}{o.disabled ? <span class="select__desc t-caption">{o.disabled}</span> : null}</span>
              {o.value === p.value ? <Icon name="check" class="select__check" /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function Segmented<T extends string | number>(p: {
  value: T; options: Option<T>[]; onChange: (v: T) => void; label: string; class?: string; size?: 's' | 'm';
}): JSX.Element {
  const { sound } = useApp();
  const root = useRef<HTMLDivElement>(null);
  const pick = (o: Option<T>, focus = false): void => {
    if (o.disabled) { sound.play('error', 200); return; }
    if (o.value !== p.value) { sound.play('click'); p.onChange(o.value); }
    if (focus) setTimeout(() => root.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(), 0);
  };
  const onKey = (e: KeyboardEvent): void => {
    const i = p.options.findIndex((o) => o.value === p.value);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    for (let k = 1; k <= p.options.length; k++) {
      const o = p.options[(i + d * k + p.options.length * 2) % p.options.length];
      if (!o.disabled) { pick(o, true); break; }
    }
  };
  return (
    <div ref={root} class={`seg seg--${p.size ?? 'm'} ${p.class ?? ''}`} role="radiogroup" aria-label={p.label} onKeyDown={onKey}>
      {p.options.map((o) => {
        const sel = o.value === p.value;
        return (
          <button type="button" role="radio" aria-checked={sel} tabIndex={sel ? 0 : -1} class={`seg__opt ${sel ? 'is-selected' : ''}`}
            aria-disabled={o.disabled ? 'true' : undefined} title={o.disabled ?? o.desc}
            onPointerEnter={() => sound.play('hover')} onClick={() => pick(o)}>
            {o.adorn ? <span class="seg__adorn">{o.adorn}</span> : null}
            <span class="t-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
