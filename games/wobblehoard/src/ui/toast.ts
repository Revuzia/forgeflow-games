// The toast system (UI.md 6, W11 / W12): a small stack at the TOP centre under the top row (it used to stand over the dock). Five kinds, each with an icon and a word, never
// colour alone: info, success, warning, error, trophy. The live region says each one ONCE (the toast itself is aria-hidden); at most two are visible (one on the portal
// phone), the rest wait and show as a "+N more" pill; they wait while a capsule ceremony runs or the reveal plate shows (the player is looking at something that matters more);
// the same words twice in a row only restart the timer. Trophies last 3.2 s, the others 2.6 s (2 s and 3 s on the portal phone). The offline notice is the one sticky toast
// (it keeps its old class `net-banner`; it is hidden, not removed, when the connection returns). A sticky toast with `urgent` ignores the hold (the picture was interrupted).
// Sounds and haptics ride along: `toast` (a chime), `trophy`, `error` (+ the double pulse) through uiSound's cue().
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';
import { cue } from './uiSound.ts';

export type ToastKind = 'info' | 'success' | 'warning' | 'error' | 'trophy';
export interface ToastOpts {
  /** a second, dimmer line */
  sub?: string;
  /** a node after the text (a trophy's tier chip) */
  extra?: Node;
  /** ms visible (default by kind and layout) */
  ms?: number;
  /** stays until `remove()` */
  sticky?: boolean;
  /** shows at once even while held (a context loss) */
  urgent?: boolean;
  /** say it in the live region (default true) */
  say?: boolean;
  /** make the sound (default true) */
  sound?: boolean;
}
export interface ToastHandle { remove(): void }
export interface ToasterOptions {
  /** the live region: the toaster speaks each toast once */
  say(text: string): void;
  /** true while a ceremony runs or a plate shows: queued toasts wait */
  held(): boolean;
  /** viewport form: the portal phone shows one at a time and for less */
  tiny(): boolean;
}
export interface Toaster {
  readonly el: HTMLElement;
  show(kind: ToastKind, text: string, o?: ToastOpts): ToastHandle;
  /** the sticky offline notice (the element is `.net-banner`; always in the DOM, `hidden` while online) */
  offline(on: boolean, text?: string): void;
  readonly banner: HTMLElement;
  visibleCount(): number;
  waitingCount(): number;
  destroy(): void;
}

const ICON: Record<ToastKind, IconName> = { info: 'info', success: 'success', warning: 'warning', error: 'error', trophy: 'trophy' };
export const TOAST_MS = { normal: 2600, trophy: 3200, tinyNormal: 2000, tinyTrophy: 3000 } as const;
const OUT_MS = 180;
const HOLD_POLL_MS = 220;

/** The toast's DOM (the kit's reference build: `k-toast k-glass`, an icon, the words, a dimmer second line, an optional node). The kit page builds the same one. */
export function buildToast(kind: ToastKind, text: string, o: Pick<ToastOpts, 'sub' | 'extra'> = {}): HTMLElement {
  const words = h('div', { class: 'k-toast-text' }, h('span', { text }), o.sub ? h('span', { class: 'k-toast-sub', text: o.sub }) : null);
  return h('div', { class: 'toast k-toast k-glass', attrs: { 'data-kind': kind, 'aria-hidden': 'true' } }, icon(ICON[kind]), words, o.extra ?? null);
}

interface Item { kind: ToastKind; text: string; o: ToastOpts; el: HTMLElement | null; timer: number; gone: boolean }

export function createToaster(root: HTMLElement, opt: ToasterOptions): Toaster {
  const banner = h('div', { class: 'net-banner k-toast k-glass', attrs: { 'data-kind': 'warning', hidden: '', 'aria-hidden': 'true' } },
    icon('warning'), h('div', { class: 'k-toast-text' }, h('span', { text: '' })));
  const more = h('div', { class: 'toast-more', attrs: { hidden: '', 'aria-hidden': 'true' } });
  const el = h('div', { class: 'toasts', attrs: { 'data-keep-live': '', role: 'presentation' } }, banner, more);
  root.append(el);
  const shown: Item[] = [];
  const waiting: Item[] = [];
  let pollTimer = 0;
  let dead = false;

  const sync = (): void => {
    document.body.dataset.toasts = String(shown.length + (banner.hidden ? 0 : 1));
    if (!shown.length && banner.hidden) delete document.body.dataset.toasts;
    more.hidden = waiting.length === 0;
    more.textContent = waiting.length ? `+${waiting.length} more` : '';
  };
  const capacity = (): number => (opt.tiny() ? 1 : 2);
  const msFor = (it: Item): number => it.o.ms ?? (it.kind === 'trophy' ? (opt.tiny() ? TOAST_MS.tinyTrophy : TOAST_MS.trophy) : (opt.tiny() ? TOAST_MS.tinyNormal : TOAST_MS.normal));

  const build = (it: Item): HTMLElement => buildToast(it.kind, it.text, it.o);
  const dismiss = (it: Item): void => {
    if (it.gone) return;
    it.gone = true;
    clearTimeout(it.timer);
    let i = shown.indexOf(it);
    if (i >= 0) shown.splice(i, 1);
    i = waiting.indexOf(it);
    if (i >= 0) waiting.splice(i, 1);
    const node = it.el;
    if (node) { node.dataset.state = 'out'; window.setTimeout(() => node.remove(), OUT_MS); }
    sync();
    pump();
  };
  const start = (it: Item): void => {
    it.el = build(it);
    el.insertBefore(it.el, more);
    shown.push(it);
    if (!it.o.sticky) it.timer = window.setTimeout(() => dismiss(it), msFor(it));
    if (it.o.say !== false) opt.say(it.o.sub ? `${it.text}. ${it.o.sub}` : it.text);
    if (it.o.sound !== false) cue(it.kind === 'trophy' ? 'trophy' : it.kind === 'error' ? 'error' : 'toast');
    sync();
  };
  // admit waiting toasts while there is room and nothing holds them; poll while something waits (a ceremony ends without telling us)
  const pump = (): void => {
    if (dead) return;
    const held = opt.held();
    for (let i = 0; i < waiting.length && shown.length < capacity();) {
      const it = waiting[i];
      if (held && !it.o.urgent) { i++; continue; }
      waiting.splice(i, 1);
      start(it);
    }
    sync();
    if (waiting.length && !pollTimer) pollTimer = window.setInterval(() => { if (!waiting.length) { clearInterval(pollTimer); pollTimer = 0; return; } pump(); }, HOLD_POLL_MS);
    else if (!waiting.length && pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
  };

  return {
    el, banner,
    show(kind, text, o = {}) {
      const t = String(text).trim();
      // the same words already showing (or waiting): restart its timer, never stack a copy
      const dup = [...shown, ...waiting].find((x) => x.kind === kind && x.text === t && !x.gone);
      if (dup) {
        if (dup.el && !dup.o.sticky) { clearTimeout(dup.timer); dup.timer = window.setTimeout(() => dismiss(dup), msFor(dup)); }
        return { remove: () => dismiss(dup) };
      }
      const it: Item = { kind, text: t, o, el: null, timer: 0, gone: false };
      if (o.sticky && o.urgent) {
        // an urgent sticky toast takes a place even in a full stack (it is the only way the player learns what happened)
        start(it);
      } else { waiting.push(it); pump(); }
      return { remove: () => dismiss(it) };
    },
    offline(on, text) {
      const span = banner.querySelector('.k-toast-text span');
      if (text !== undefined && span) span.textContent = text;
      banner.hidden = !on;
      sync();
    },
    visibleCount: () => shown.length,
    waitingCount: () => waiting.length,
    destroy() {
      dead = true;
      clearInterval(pollTimer);
      for (const it of [...shown, ...waiting]) clearTimeout(it.timer);
      el.remove();
      delete document.body.dataset.toasts;
    },
  };
}
