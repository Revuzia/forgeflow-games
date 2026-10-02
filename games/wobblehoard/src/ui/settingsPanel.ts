// Settings: bottom sheet on phones, side panel on desktop (CSS decides). Native controls (range, checkbox switch, radio
// group, select) so keyboard, touch and screen readers work for free; 44 px targets and focus rings come from styles.css.
// Focus: opening moves focus to the panel title, Tab wraps inside while open, Escape / the close button / the gear close it
// and focus returns to the gear.
import type { QualityTier, Settings } from '../contracts.ts';
import { h, icon } from './dom.ts';

export interface SettingsPanelOptions {
  settings: Settings;
  hapticsSupported: boolean;
  onChange<K extends keyof Settings>(key: K, value: Settings[K]): void;
  onOpenChange?(open: boolean): void;
  /** receives focus when the panel closes */
  returnFocusTo?: HTMLElement;
}

export interface SettingsPanel {
  readonly el: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  sync(s: Settings): void;
  destroy(): void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function createSettingsPanel(root: HTMLElement, o: SettingsPanelOptions): SettingsPanel {
  let opened = false;

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const setFill = (input: HTMLInputElement): void => {
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  };

  interface SliderRef { row: HTMLElement; input: HTMLInputElement; out: HTMLOutputElement; set(v: number): void }
  function slider(id: string, label: string, fmt: (v: number) => string, key: 'volume' | 'squishBoost' | 'shake', hint?: string): SliderRef {
    const input = h('input', { attrs: { id, type: 'range', min: '0', max: '100', step: '1' } });
    const out = h('output', { class: 'row-value', attrs: { for: id } });
    const labelEl = h('label', { class: 'row-label', text: label, attrs: { for: id } });
    const sync = (): void => {
      const v = Number(input.value) / 100;
      out.textContent = fmt(v);
      input.setAttribute('aria-valuetext', fmt(v));
      setFill(input);
    };
    input.addEventListener('input', () => { sync(); o.onChange(key, (Number(input.value) / 100) as never); });
    const row = h('div', { class: 'row row-slider' }, labelEl, out, input, hint ? h('p', { class: 'row-hint', text: hint }) : null);
    return { row, input, out, set(v) { input.value = String(Math.round(v * 100)); sync(); } };
  }

  const volume = slider('wh-volume', 'Volume', pct, 'volume');
  const boost = slider('wh-boost', 'Louder squish', (v) => (v === 0 ? 'Normal' : `+${(v * 9).toFixed(1)} dB`), 'squishBoost');
  const shake = slider('wh-shake', 'Screen shake', (v) => (v === 0 ? 'Off' : pct(v)), 'shake');

  // haptics switch (hidden when navigator.vibrate is missing)
  const hapticsInput = h('input', { attrs: { id: 'wh-haptics', type: 'checkbox', role: 'switch' } });
  hapticsInput.addEventListener('change', () => o.onChange('haptics', hapticsInput.checked as never));
  const hapticsRow = h('div', { class: 'row row-switch', attrs: o.hapticsSupported ? {} : { hidden: '' } },
    h('label', { class: 'row-label', text: 'Haptics', attrs: { for: 'wh-haptics' } }),
    hapticsInput, h('span', { class: 'switch-ui', attrs: { 'aria-hidden': 'true' } }));
  if (!o.hapticsSupported) hapticsRow.hidden = true;

  // gravity <-> float segmented control (radio group)
  const radio = (value: 'table' | 'float', label: string): { el: HTMLElement; input: HTMLInputElement } => {
    const input = h('input', { attrs: { type: 'radio', name: 'wh-gravity', value } });
    input.addEventListener('change', () => { if (input.checked) o.onChange('gravity', (value === 'table') as never); });
    return { input, el: h('label', { class: 'seg-opt' }, input, h('span', { class: 'seg-face' }, icon(value), h('span', { text: label }))) };
  };
  const rTable = radio('table', 'Table'), rFloat = radio('float', 'Float');
  const gravityRow = h('fieldset', { class: 'row row-seg' }, h('legend', { class: 'row-label', text: 'Gravity' }), h('div', { class: 'seg' }, rTable.el, rFloat.el));

  // quality select
  const quality = h('select', { attrs: { id: 'wh-quality' } },
    h('option', { text: 'Auto', attrs: { value: 'auto' } }), h('option', { text: 'Low', attrs: { value: 'low' } }),
    h('option', { text: 'Medium', attrs: { value: 'med' } }), h('option', { text: 'High', attrs: { value: 'high' } }));
  quality.addEventListener('change', () => o.onChange('quality', quality.value as QualityTier | 'auto' as never));
  const qualityRow = h('div', { class: 'row row-select' }, h('label', { class: 'row-label', text: 'Quality', attrs: { for: 'wh-quality' } }), quality);

  const title = h('h2', { class: 'panel-title', text: 'Settings', attrs: { id: 'wh-settings-title', tabindex: '-1' } });
  const closeBtn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Close settings', title: 'Close (Esc)' } }, icon('close'));
  const keys = h('p', { class: 'row-hint keys', text: 'Keys: Space pokes · G gravity · M mute · Arrows look around' });
  const body = h('div', { class: 'panel-body' }, volume.row, boost.row, shake.row, hapticsRow, gravityRow, qualityRow, h('p', { class: 'row-hint saved', text: 'Saved on this device.' }), keys);
  const el = h('section', {
    class: 'panel', attrs: { id: 'wh-settings', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'wh-settings-title', 'data-open': 'false', 'data-haptics': String(o.hapticsSupported) },
  }, h('div', { class: 'panel-grip', attrs: { 'aria-hidden': 'true' } }), h('div', { class: 'panel-head' }, title, closeBtn), body);
  el.setAttribute('inert', '');
  root.append(el);

  function sync(s: Settings): void {
    volume.set(s.volume); boost.set(s.squishBoost); shake.set(s.shake);
    hapticsInput.checked = s.haptics;
    rTable.input.checked = s.gravity; rFloat.input.checked = !s.gravity;
    quality.value = s.quality;
  }
  sync(o.settings);

  function open(): void {
    if (opened) return;
    opened = true;
    el.dataset.open = 'true';
    el.removeAttribute('inert');
    o.onOpenChange?.(true);
    title.focus({ preventScroll: true });
  }
  function close(): void {
    if (!opened) return;
    opened = false;
    const hadFocus = el.contains(document.activeElement);
    el.dataset.open = 'false';
    el.setAttribute('inert', '');
    o.onOpenChange?.(false);
    if (hadFocus) (o.returnFocusTo ?? document.body).focus?.({ preventScroll: true });
  }

  closeBtn.addEventListener('click', close);
  const onKey = (e: KeyboardEvent): void => {
    if (!opened || e.key !== 'Tab') return;
    const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    const a = document.activeElement;
    if (e.shiftKey && (a === first || a === title)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
  };
  el.addEventListener('keydown', onKey);

  return {
    el, open, close,
    toggle() { if (opened) close(); else open(); },
    isOpen: () => opened,
    sync,
    destroy() { el.removeEventListener('keydown', onKey); el.remove(); },
  };
}
