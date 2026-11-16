// The reference DOM for every kit component (UI.md 3.3). A screen builds a component EXACTLY like this (classes, roles, aria), so kit.css,
// a11y.css and the K-checks all see the same structure. Text goes through textContent only (dom.ts h()). Nothing here is shipped: when a
// batch needs one of these in the game it moves the builder into src/ui and keeps this file as the kit's copy.
import { h } from '../../src/ui/dom.ts';
import { icon } from '../../src/ui/icons.ts';
import type { IconName } from '../../src/ui/icons.ts';

/** Pseudo-states painted by shoot.mjs through CDP: `data-force="hover focus-visible"` etc. on the element the state belongs to. */
export type Force = 'hover' | 'active' | 'focus-visible' | 'focus';
const forceAttr = (f?: Force | Force[]): Record<string, string> => (f ? { 'data-force': Array.isArray(f) ? f.join(' ') : f } : {});

let uid = 0;
export const nextId = (p: string): string => `${p}-${++uid}`;

export interface BtnOpts {
  kind?: 'gel' | 'coral' | 'cta' | 'glass' | 'icon' | 'tool';
  label?: string;
  icon?: IconName;
  /** aria-label for an icon-only button (the tooltip text; always the full name) */
  name?: string;
  key?: string;
  pressed?: boolean;
  disabled?: boolean;
  /** the reason a disabled button gives (aria-describedby); shown under the button */
  reason?: string;
  busy?: boolean;
  error?: boolean;
  small?: boolean;
  force?: Force | Force[];
}

/** A button (or a button with its reason line). `disabled` uses aria-disabled so the button stays focusable and can explain itself. */
export function button(o: BtnOpts): HTMLElement {
  const kind = o.kind ?? 'glass';
  const cls = ['k-btn'];
  if (kind === 'gel' || kind === 'coral' || kind === 'cta') cls.push('k-gel');
  if (kind === 'coral') cls.push('k-gel--coral');
  if (kind === 'cta') cls.push('k-cta');
  if (kind === 'icon') cls.push('k-iconbtn');
  if (kind === 'tool') cls.push('k-tool');
  if (o.small) cls.push('k-btn--sm');
  const attrs: Record<string, string> = { type: 'button', ...forceAttr(o.force) };
  if (o.name) attrs['aria-label'] = o.name;
  if (o.pressed !== undefined) attrs['aria-pressed'] = String(o.pressed);
  if (o.disabled) attrs['aria-disabled'] = 'true';
  if (o.busy) attrs['aria-busy'] = 'true';
  if (o.error) attrs['data-state'] = 'error';
  if (o.key) attrs['aria-keyshortcuts'] = o.key;
  const kids: Node[] = [];
  if (o.icon) kids.push(icon(o.icon));
  if (o.label) kids.push(h('span', { class: o.kind === 'tool' ? 'k-btn-label k-tool-label' : 'k-btn-label', text: o.label }));
  if (o.key && kind === 'tool') kids.push(h('kbd', { class: 'k-kbd', text: o.key, attrs: { 'aria-hidden': 'true' } }));
  if (o.busy) kids.push(h('span', { class: 'k-dots', attrs: { 'aria-hidden': 'true' } }, h('i', { class: 'k-dot' }), h('i', { class: 'k-dot' }), h('i', { class: 'k-dot' })));
  const b = h('button', { class: cls.join(' '), attrs }, ...kids);
  if (!o.reason && !o.error) return b;
  const wrap = h('div', { class: 'kp-stack' }, b);
  if (o.reason) {
    const id = nextId('why');
    b.setAttribute('aria-describedby', id);
    wrap.append(h('p', { class: 'k-reason', text: o.reason, attrs: { id } }));
  }
  if (o.error) {
    const id = nextId('err');
    b.setAttribute('aria-describedby', id);
    wrap.append(fieldError('Could not save. Try again.', id));
  }
  return wrap;
}

export function fieldError(text: string, id?: string): HTMLElement {
  return h('p', { class: 'k-field-error', attrs: id ? { id } : {} }, icon('error', 'k-icon'), h('span', { text }));
}

export function chip(label: string, o: { icon?: IconName; n?: number; pressed?: boolean; disabled?: boolean; error?: boolean; force?: Force | Force[] } = {}): HTMLElement {
  const attrs: Record<string, string> = { type: 'button', ...forceAttr(o.force) };
  if (o.pressed !== undefined) attrs['aria-pressed'] = String(o.pressed);
  if (o.disabled) attrs['aria-disabled'] = 'true';
  if (o.error) attrs['data-state'] = 'error';
  const kids: Array<Node | string> = [];
  if (o.icon) kids.push(icon(o.icon));
  kids.push(h('span', { text: label }));
  if (o.n !== undefined) kids.push(h('span', { class: 'k-chip-n', text: String(o.n) }));
  return h('button', { class: 'k-chip', attrs }, ...kids);
}

export function tierChip(tier: string, label: string, ic: IconName = 'star'): HTMLElement {
  return h('span', { class: 'k-tier', attrs: { 'data-tier': tier } }, icon(ic), h('span', { text: label }));
}

export function switchRow(label: string, o: { checked?: boolean; disabled?: boolean; force?: Force | Force[] } = {}): HTMLElement {
  const input = h('input', { class: 'k-switch-input', attrs: { type: 'checkbox', role: 'switch', ...forceAttr(o.force) } });
  input.checked = !!o.checked;
  input.disabled = !!o.disabled;
  return h('label', { class: 'k-switch' },
    input,
    h('span', { class: 'k-switch-label', text: label }),
    h('span', { class: 'k-switch-ui', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'k-switch-thumb' }, icon('check'))));
}

export function slider(label: string, o: { value: number; disabled?: boolean; unit?: string; force?: Force | Force[] }): HTMLElement {
  const id = nextId('rng');
  const input = h('input', { class: 'k-slider', attrs: { type: 'range', min: '0', max: '100', step: '1', id, ...forceAttr(o.force) } });
  input.value = String(o.value);
  input.disabled = !!o.disabled;
  const out = h('output', { class: 'k-slider-value', text: `${o.value}${o.unit ?? '%'}`, attrs: { for: id } });
  const fill = (): void => { input.style.setProperty('--fill', `${input.value}%`); out.textContent = `${input.value}${o.unit ?? '%'}`; };
  input.addEventListener('input', fill);
  input.style.setProperty('--fill', `${o.value}%`);
  return h('div', { class: 'k-slider-row' }, h('label', { class: 'k-slider-head', attrs: { for: id } }, h('span', { text: label }), out), input);
}

export function segmented(name: string, label: string, options: Array<{ value: string; label: string; icon?: IconName }>, o: { value: string; disabled?: boolean; force?: { value: string; f: Force | Force[] } } = { value: '' }): HTMLElement {
  const wrap = h('div', { class: 'k-seg', attrs: { role: 'radiogroup', 'aria-label': label } });
  for (const opt of options) {
    const input = h('input', { class: 'k-seg-input', attrs: { type: 'radio', name, value: opt.value, ...(o.force && o.force.value === opt.value ? forceAttr(o.force.f) : {}) } });
    input.checked = o.value === opt.value;
    input.disabled = !!o.disabled;
    wrap.append(h('label', { class: 'k-seg-opt' }, input, h('span', { class: 'k-seg-face' }, opt.icon ? icon(opt.icon) : null, h('span', { text: opt.label }))));
  }
  return wrap;
}

export function card(o: { title: string; text?: string; icon?: IconName; hero?: boolean; selectable?: boolean; selected?: boolean; tier?: string; force?: Force | Force[] }, ...extra: Node[]): HTMLElement {
  const attrs: Record<string, string> = { ...forceAttr(o.force) };
  if (o.selectable) { attrs['data-selectable'] = ''; attrs.tabindex = '0'; attrs.role = 'button'; attrs['aria-pressed'] = String(!!o.selected); }
  if (o.tier) attrs['data-tier'] = o.tier;
  return h('div', { class: `k-card${o.hero ? ' k-card--hero' : ''}${o.tier ? ' k-frame' : ''}`, attrs },
    h('div', { class: 'k-card-head' }, o.icon ? icon(o.icon) : null, h('h3', { class: 'k-card-title', text: o.title })),
    o.text ? h('p', { class: 'k-card-text', text: o.text }) : null, ...extra);
}

export function toast(kind: 'info' | 'success' | 'warning' | 'error' | 'trophy', text: string, sub?: string, extra?: Node): HTMLElement {
  const ic: IconName = kind === 'trophy' ? 'trophy' : kind;
  return h('div', { class: 'k-toast k-glass', attrs: { 'data-kind': kind, role: kind === 'error' ? 'alert' : 'status' } },
    icon(ic), h('div', { class: 'k-toast-text' }, h('span', { text }), sub ? h('span', { class: 'k-toast-sub', text: sub }) : null), extra ?? null);
}

export function panel(title: string, body: Node[], o: { form?: 'sheet' | 'full' } = {}): HTMLElement {
  const close = button({ kind: 'icon', icon: 'close', name: `Close ${title}` });
  const p = h('section', { class: 'k-panel', attrs: { 'aria-label': title, ...(o.form ? { 'data-form': o.form } : {}) } },
    h('div', { class: 'k-panel-grip' }),
    h('header', { class: 'k-panel-head' }, h('h2', { class: 'k-panel-title', text: title }), close),
    h('div', { class: 'k-panel-body' }, ...body));
  return p;
}

export function modal(title: string, text: string, actions: Node[], danger = false): HTMLElement {
  const tid = nextId('mt'), did = nextId('md');
  return h('div', { class: 'k-scrim' },
    h('div', { class: 'k-modal', attrs: { role: danger ? 'alertdialog' : 'dialog', 'aria-modal': 'true', 'aria-labelledby': tid, 'aria-describedby': did } },
      h('h2', { class: 'k-modal-title', text: title, attrs: { id: tid } }), h('p', { class: 'k-modal-text', text, attrs: { id: did } }),
      h('div', { class: 'k-modal-actions' }, ...actions)));
}

export function tip(text: string, place: 'above' | 'below' = 'above'): HTMLElement {
  return h('div', { class: 'k-tip', attrs: { role: 'tooltip', 'data-place': place === 'below' ? 'below' : 'above' } }, h('span', { text }));
}

export function progress(value: number, label: string): HTMLElement {
  const el = h('div', { class: 'k-progress', attrs: { role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(value * 100)) } }, h('i', { class: 'k-progress-fill' }));
  el.style.setProperty('--p', String(value));
  return el;
}
