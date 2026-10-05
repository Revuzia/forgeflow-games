// One polite live region for status messages (WCAG 4.1.3; audit finding 14): mute, gravity, the squishy's name, capsule ready, the
// reveal, meter states. Visually hidden. The same text twice in a row is re-announced (the region is cleared first); a burst of messages
// inside 250 ms is merged into one announcement so a screen reader is not flooded.
import { h } from './dom.ts';

export interface Announcer {
  readonly el: HTMLElement;
  say(text: string): void;
  /** the last announced text (the harness reads it) */
  readonly last: string;
  destroy(): void;
}

export function createAnnouncer(root: HTMLElement): Announcer {
  const el = h('div', { class: 'sr-only', attrs: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true', id: 'wh-live' } });
  root.append(el);
  let pending: string[] = [];
  let timer = 0;
  let last = '';
  const flush = (): void => {
    timer = 0;
    const text = pending.join(' ');
    pending = [];
    if (!text) return;
    last = text;
    el.textContent = '';
    // a new text node on the next task: assistive tech sees a change even when the text repeats
    setTimeout(() => { el.textContent = text; }, 30);
  };
  return {
    el,
    say(text) {
      const t = String(text).trim();
      if (!t) return;
      if (!pending.includes(t)) pending.push(t);
      if (!timer) timer = window.setTimeout(flush, 250);
    },
    get last() { return last; },
    destroy() { clearTimeout(timer); el.remove(); },
  };
}
