// Settings: bottom sheet on phones, side panel on desktop (CSS decides; both scroll inside themselves and reflow down to 320 CSS px and
// short landscape screens: WCAG 1.4.10). Native controls (range, checkbox switch, radio group, select) so keyboard, touch and screen
// readers work for free; 44 px targets and focus rings come from styles.css.
// Focus: opening moves focus to the panel title, Tab wraps inside while open. Closing with Escape returns focus to the squishy (the play
// target: Escape means "back to the toy", and Space then pokes instead of reopening the panel: audit finding 13); closing with the close
// button or the gear returns it to the gear.
// Rows: Volume, Music, Louder squish, Screen shake, Extra squish, Haptics (only where the device really vibrates), Calm effects,
// Skip animations, Fast open, Keyboard shortcuts, Gravity, Quality. Plain words, no dB (audit finding 17).
import type { QualityTier, Settings } from '../contracts.ts';
import type { ResolvedSettings } from '../core/settings.ts';
import { h, icon } from './dom.ts';

export interface SettingsPanelOptions {
  settings: ResolvedSettings;
  hapticsSupported: boolean;
  onChange<K extends keyof Settings>(key: K, value: Settings[K]): void;
  onOpenChange?(open: boolean): void;
  /** receives focus when the panel closes from the close button / the gear */
  returnFocusTo?: HTMLElement;
  /** receives focus when the panel closes with Escape (the squishy) */
  escapeFocusTo?: () => HTMLElement | null;
}

export interface SettingsPanel {
  readonly el: HTMLElement;
  open(): void;
  close(via?: 'escape' | 'button'): void;
  toggle(): void;
  isOpen(): boolean;
  sync(s: ResolvedSettings): void;
  destroy(): void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** "Louder squish" in words (0..1 = +0..9 dB on the squish voices; the audience is kids, so no dB). */
export const boostWords = (v: number): string => (v <= 0.001 ? 'Off' : v < 0.34 ? 'A little' : v < 0.67 ? 'More' : 'Lots');

export function createSettingsPanel(root: HTMLElement, o: SettingsPanelOptions): SettingsPanel {
  let opened = false;

  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  const setFill = (input: HTMLInputElement): void => {
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  };

  interface SliderRef { row: HTMLElement; input: HTMLInputElement; out: HTMLOutputElement; set(v: number): void }
  function slider(id: string, label: string, fmt: (v: number) => string, key: 'volume' | 'squishBoost' | 'shake' | 'music', hint?: string): SliderRef {
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

  interface SwitchRef { row: HTMLElement; input: HTMLInputElement }
  function toggle(id: string, label: string, key: 'haptics' | 'extraSquish' | 'calm' | 'skipAnimations' | 'fastOpen' | 'shortcuts', hint?: string): SwitchRef {
    const input = h('input', { attrs: { id, type: 'checkbox', role: 'switch' } });
    input.addEventListener('change', () => o.onChange(key, input.checked as never));
    const hintEl = hint ? h('p', { class: 'row-hint', text: hint, attrs: { id: `${id}-hint` } }) : null;
    if (hintEl) input.setAttribute('aria-describedby', hintEl.id);
    const row = h('div', { class: 'row row-switch' }, h('label', { class: 'row-label', text: label, attrs: { for: id } }), input, h('span', { class: 'switch-ui', attrs: { 'aria-hidden': 'true' } }), hintEl);
    return { row, input };
  }

  const volume = slider('wh-volume', 'Volume', pct, 'volume');
  const music = slider('wh-music', 'Music', (v) => (v <= 0.001 ? 'Off' : pct(v)), 'music');
  const boost = slider('wh-boost', 'Louder squish', boostWords, 'squishBoost');
  const shake = slider('wh-shake', 'Screen shake', (v) => (v === 0 ? 'Off' : pct(v)), 'shake');
  const extra = toggle('wh-extra', 'Extra squish', 'extraSquish', 'Presses go deeper.');
  const haptics = toggle('wh-haptics', 'Haptics', 'haptics');
  if (!o.hapticsSupported) haptics.row.hidden = true;
  const calm = toggle('wh-calm', 'Calm effects', 'calm', 'No camera moves, flashes or shake; fewer sparkles.');
  const skip = toggle('wh-skip', 'Skip animations', 'skipAnimations', 'Go straight to what came out.');
  const fast = toggle('wh-fast', 'Fast open', 'fastOpen', 'Quick pop for repeats.');
  const keys = toggle('wh-keys', 'Keyboard shortcuts', 'shortcuts', 'G gravity, M sound, H Hoard, [ ] switch squishy.');

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
  const keyLine = h('p', { class: 'row-hint keys', text: 'Keys: Tab to the squishy · Space pokes · arrows look around · + / − zoom · G gravity · M sound · H Hoard · [ ] switch squishy · Shift + drag pulls both sides · Esc closes' });
  const body = h('div', { class: 'panel-body' },
    h('h3', { class: 'panel-group', text: 'Sound' }), volume.row, music.row, boost.row,
    h('h3', { class: 'panel-group', text: 'Feel' }), extra.row, haptics.row, gravityRow,
    h('h3', { class: 'panel-group', text: 'Motion' }), calm.row, shake.row, skip.row, fast.row,
    h('h3', { class: 'panel-group', text: 'Other' }), keys.row, qualityRow,
    h('p', { class: 'row-hint saved', text: 'Saved on this device.' }), keyLine);
  const el = h('section', {
    class: 'panel', attrs: { id: 'wh-settings', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'wh-settings-title', 'data-open': 'false', 'data-haptics': String(o.hapticsSupported) },
  }, h('div', { class: 'panel-grip', attrs: { 'aria-hidden': 'true' } }), h('div', { class: 'panel-head' }, title, closeBtn), body);
  el.setAttribute('inert', '');
  root.append(el);

  function sync(s: ResolvedSettings): void {
    volume.set(s.volume); music.set(s.music); boost.set(s.squishBoost); shake.set(s.shake);
    haptics.input.checked = s.haptics; extra.input.checked = s.extraSquish; calm.input.checked = s.calm;
    skip.input.checked = s.skipAnimations; fast.input.checked = s.fastOpen; keys.input.checked = s.shortcuts;
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
  function close(via: 'escape' | 'button' = 'button'): void {
    if (!opened) return;
    opened = false;
    const hadFocus = el.contains(document.activeElement);
    el.dataset.open = 'false';
    el.setAttribute('inert', '');
    o.onOpenChange?.(false);
    if (!hadFocus) return;
    const target = via === 'escape' ? (o.escapeFocusTo?.() ?? o.returnFocusTo) : o.returnFocusTo;
    (target ?? document.body).focus?.({ preventScroll: true });
  }

  closeBtn.addEventListener('click', () => close('button'));
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
    toggle() { if (opened) close('button'); else open(); },
    isOpen: () => opened,
    sync,
    destroy() { el.removeEventListener('keydown', onKey); el.remove(); },
  };
}
