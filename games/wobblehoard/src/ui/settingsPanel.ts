// Settings (UI.md 6, W14), on the kit. A later-* chunk (`ui/screens/later-screens.ts`): the shell builds an empty `section.panel#wh-settings` at boot (shell/screens.ts) and this
// file fills it the first time Settings opens. Four groups (Sound, Feel, Motion, Other) of kit rows: slider (10 px track, 28 px thumb), switch (56x32 with a tick), segmented
// radios (Quality 4-way; Gravity left for the toolbar on 2026-10-09), a link row (How to play). The row list is DATA (screens/screenCopy.ts SETTINGS_GROUPS): every key of core/settings.ts has one row.
// A side panel on a wide screen and on a strip, a bottom sheet on a stack, the whole screen on the portal phone (screens.css decides from body[data-layout]); it scrolls inside
// itself. NOT modal: the squishy keeps playing under it (a play-while-you-tweak panel), so its row ids and its `.panel[data-open]` contract stay what the harness knows.
// Focus: opening moves focus to the panel title, Tab wraps inside while open. Closing with Escape returns focus to the squishy (the play target: Escape means "back to the
// toy", and Space then pokes instead of reopening the panel: audit finding 13); closing with the close button returns it to where it was opened from (the Menu button; a title chip).
import type { QualityTier, Settings } from '../contracts.ts';
import type { ResolvedSettings } from '../core/settings.ts';
import { FEATURES } from '../core/features.ts';
import type { FeatureFlags } from '../core/features.ts';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import { headRoom, jelly, keepFitted } from './jelly/jelly.ts';
import { KEYS_LINE, SAVED_LINE, SETTINGS_GROUPS, VOICES_ROW } from './screens/screenCopy.ts';
import type { SettingRow } from './screens/screenCopy.ts';

export interface SettingsPanelOptions {
  settings: ResolvedSettings;
  hapticsSupported: boolean;
  onChange<K extends keyof Settings>(key: K, value: Settings[K]): void;
  onOpenChange?(open: boolean): void;
  /** receives focus when the panel closes from the close button (the Menu button) unless `open(from)` named another */
  returnFocusTo?: HTMLElement;
  /** receives focus when the panel closes with Escape (the squishy) */
  escapeFocusTo?: () => HTMLElement | null;
  /** the How to play row (Other): the shell opens that screen over the panel; `from` is the row (focus comes back to it) */
  onHowTo?(from: HTMLElement): void;
  /** hidden components (UI.md 1.7): the Voices switch is mounted only when `features.voices` is true (default FEATURES) AND `voices` gives it a place to keep its value */
  features?: Partial<FeatureFlags>;
  voices?: { get(): boolean; set(on: boolean): void };
}

export interface SettingsPanel {
  readonly el: HTMLElement;
  /** open it; `from` is the control that gets the focus back when it closes (a title chip) */
  open(from?: HTMLElement): void;
  close(via?: 'escape' | 'button'): void;
  toggle(): void;
  isOpen(): boolean;
  sync(s: ResolvedSettings): void;
  destroy(): void;
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([hidden]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** "Louder squish" in words (0..1 = +0..9 dB on the squish voices; the audience is kids, so no dB). */
export const boostWords = (v: number): string => (v <= 0.001 ? 'Off' : v < 0.34 ? 'A little' : v < 0.67 ? 'More' : 'Lots');
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const FORMAT: Record<string, (v: number) => string> = {
  volume: pct, music: (v) => (v <= 0.001 ? 'Off' : pct(v)), squishBoost: boostWords, shake: (v) => (v === 0 ? 'Off' : pct(v)),
  chatter: (v) => (v <= 0.001 ? 'Off' : pct(v)), ambience: (v) => (v <= 0.001 ? 'Off' : pct(v)),
};

/** Fill `shell` (or make a section) and return the panel. */
export function createSettingsPanel(root: HTMLElement, o: SettingsPanelOptions, shell?: HTMLElement): SettingsPanel {
  let opened = false;
  let openedFrom: HTMLElement | undefined;
  let unfit: () => void = () => {};
  let inerted: Element[] = [];
  const features: FeatureFlags = { ...FEATURES, ...o.features };

  const setFill = (input: HTMLInputElement): void => {
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
  };

  const syncers: Array<(s: ResolvedSettings) => void> = [];
  let hapticsRow: HTMLElement | null = null;

  function slider(r: Extract<SettingRow, { kind: 'slider' }>): HTMLElement {
    const fmt = FORMAT[r.key];
    const input = h('input', { class: 'k-slider', attrs: { id: r.id, type: 'range', min: '0', max: '100', step: '1' } });
    const out = h('output', { class: 'k-slider-value row-value', attrs: { for: r.id } });
    const sync = (): void => {
      const v = Number(input.value) / 100;
      out.textContent = fmt(v);
      input.setAttribute('aria-valuetext', fmt(v));
      setFill(input);
    };
    input.addEventListener('input', () => { sync(); o.onChange(r.key, (Number(input.value) / 100) as never); });
    syncers.push((s) => { input.value = String(Math.round(Number(s[r.key]) * 100)); sync(); });
    return h('div', { class: 'k-slider-row row row-slider set-item' },
      h('div', { class: 'k-slider-head' }, h('label', { class: 'row-label', text: r.label, attrs: { for: r.id } }), out), input);
  }

  function switchRow(r: { id: string; label: string; hint?: string }, get: (s: ResolvedSettings) => boolean, set: (on: boolean) => void): { item: HTMLElement; input: HTMLInputElement } {
    const input = h('input', { class: 'k-switch-input', attrs: { id: r.id, type: 'checkbox', role: 'switch' } });
    input.addEventListener('change', () => set(input.checked));
    const hint = r.hint ? h('p', { class: 'row-hint', text: r.hint, attrs: { id: `${r.id}-hint` } }) : null;
    if (hint) input.setAttribute('aria-describedby', hint.id);
    const label = h('label', { class: 'k-switch row row-switch' }, input,
      h('span', { class: 'k-switch-label row-label', text: r.label }),
      h('span', { class: 'k-switch-ui', attrs: { 'aria-hidden': 'true' } }, h('span', { class: 'k-switch-thumb' }, icon('check'))));
    syncers.push((s) => { input.checked = get(s); });
    return { item: h('div', { class: 'set-item' }, label, hint), input };
  }

  function seg(r: Extract<SettingRow, { kind: 'seg' }>): HTMLElement {
    const lid = `${r.id}-label`;
    const inputs: HTMLInputElement[] = [];
    const group = h('div', { class: 'k-seg seg', attrs: { id: r.id, role: 'radiogroup', 'aria-labelledby': lid } });
    for (const opt of r.options) {
      const input = h('input', { class: 'k-seg-input', attrs: { type: 'radio', name: `${r.id}-r`, value: opt.value } });
      input.addEventListener('change', () => { if (input.checked) o.onChange(r.key, opt.value as QualityTier | 'auto' as never); });
      inputs.push(input);
      group.append(h('label', { class: 'k-seg-opt seg-opt' }, input,
        h('span', { class: 'k-seg-face seg-face' }, opt.icon ? icon(opt.icon) : null, h('span', { text: opt.label }))));
    }
    syncers.push((s) => {
      for (const i of inputs) i.checked = i.value === s[r.key];
    });
    return h('div', { class: 'set-item set-seg' }, h('span', { class: 'row-label', text: r.label, attrs: { id: lid } }), group);
  }

  function link(r: Extract<SettingRow, { kind: 'link' }>): HTMLElement {
    const b = h('button', { class: 'k-btn set-link', attrs: { type: 'button', id: r.id, 'aria-haspopup': 'dialog' } },
      icon(r.icon), h('span', { class: 'row-label', text: r.label }), icon('chevronRight', 'k-icon set-chev'));
    b.addEventListener('click', () => o.onHowTo?.(b));
    if (!o.onHowTo) b.hidden = true;
    return h('div', { class: 'set-item' }, b);
  }

  const rowEl = (r: SettingRow): HTMLElement => {
    switch (r.kind) {
      case 'slider': return slider(r);
      case 'switch': {
        const s = switchRow(r, (st) => Boolean(st[r.key]), (on) => o.onChange(r.key, on as never));
        if (r.needs === 'vibrate') { hapticsRow = s.item; if (!o.hapticsSupported) s.item.hidden = true; }
        return s.item;
      }
      case 'seg': return seg(r);
      case 'link': return link(r);
    }
  };

  const groups = SETTINGS_GROUPS.map((g) => {
    const rows: HTMLElement[] = [];
    for (const r of g.rows) {
      rows.push(rowEl(r));
      // the Voices switch (pets update): not mounted until the flag is on and the shell can keep the value
      if (g.id === 'sound' && r.kind === 'switch' && r.key === 'uiSounds' && features.voices && o.voices) {
        const v = o.voices;
        rows.push(switchRow(VOICES_ROW, () => v.get(), (on) => v.set(on)).item);   // (reads and writes its own store through `voices`)
      }
    }
    const tid = `wh-set-${g.id}`;
    return h('div', { class: 'set-group', attrs: { role: 'group', 'aria-labelledby': tid } },
      h('h3', { class: 'k-group-title panel-group', text: g.title, attrs: { id: tid } }), h('div', { class: 'set-card' }, ...rows));
  });

  const title = jelly('Settings', { size: 'md', tone: 'amber', tag: 'h2' });
  title.id = 'wh-settings-title';
  title.classList.add('panel-title');
  title.setAttribute('tabindex', '-1');
  const closeBtn = h('button', { class: 'k-btn k-iconbtn icon-btn', attrs: { type: 'button', 'aria-label': 'Close settings', title: 'Close (Esc)' } }, icon('close'));
  const keyLine = h('p', { class: 'row-hint keys', text: KEYS_LINE });
  const body = h('div', { class: 'panel-body k-panel-body' }, ...groups, h('p', { class: 'row-hint saved', text: SAVED_LINE }), keyLine);

  const el = shell ?? h('section', { attrs: { id: 'wh-settings', 'data-open': 'false' } });
  el.classList.add('panel', 'k-panel');
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'false');
  el.setAttribute('aria-labelledby', 'wh-settings-title');
  el.dataset.haptics = String(o.hapticsSupported);
  el.setAttribute('inert', '');
  const head = h('div', { class: 'panel-head k-panel-head' }, title, closeBtn);
  el.append(h('div', { class: 'panel-grip k-panel-grip', attrs: { 'aria-hidden': 'true' } }), head, body);
  if (!el.isConnected) root.append(el);
  void hapticsRow;

  function sync(s: ResolvedSettings): void { for (const f of syncers) f(s); }
  sync(o.settings);

  function open(from?: HTMLElement): void {
    if (opened) return;
    opened = true;
    openedFrom = from;
    el.dataset.open = 'true';
    el.removeAttribute('inert');
    // the whole-screen form (the portal phone) covers everything: what is behind it must not be reachable by a screen reader either (a side panel or a sheet leaves the squishy live)
    if (document.body.dataset.layout === 'tiny') {
      inerted = [...root.children].filter((k) => k !== el && k.id !== 'wh-live' && !k.hasAttribute('data-keep-live') && !k.hasAttribute('inert'));
      for (const k of inerted) k.setAttribute('inert', '');
    }
    o.onOpenChange?.(true);
    title.focus({ preventScroll: true });
    unfit = keepFitted(title, () => headRoom(head, closeBtn), el);
  }
  function close(via: 'escape' | 'button' = 'button'): void {
    if (!opened) return;
    opened = false;
    const hadFocus = el.contains(document.activeElement);
    el.dataset.open = 'false';
    el.setAttribute('inert', '');
    unfit();
    unfit = () => {};
    for (const k of inerted) k.removeAttribute('inert');
    inerted = [];
    o.onOpenChange?.(false);
    const home = openedFrom?.isConnected ? openedFrom : o.returnFocusTo;
    openedFrom = undefined;
    if (!hadFocus) return;
    const target = via === 'escape' ? (o.escapeFocusTo?.() ?? home) : home;
    (target ?? document.body).focus?.({ preventScroll: true });
  }

  closeBtn.addEventListener('click', () => close('button'));
  const onKey = (e: KeyboardEvent): void => {
    if (!opened || e.key !== 'Tab') return;
    const f = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.closest('[hidden]') && (n.offsetParent !== null || n === document.activeElement));
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
