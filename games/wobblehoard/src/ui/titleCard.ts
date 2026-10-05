// Boot / title card: the wordmark, a one-line promise and one big button. The button is ALSO the audio-unlock gesture, so
// its click handler must call into the audio engine synchronously (no await first): boot.ts passes onStart accordingly.
// Copy is input-neutral ("Wake it up": a tap, a click, Enter and Space all work); the promise sits on its own ink pill so it keeps
// 4.5:1 over the glossy squishy behind it (audit finding 16). No inline style attributes (strict CSP: style-src 'self').
import { h, prefersReducedMotion } from './dom.ts';

export interface TitleCard {
  readonly el: HTMLElement;
  readonly button: HTMLButtonElement;
  /** false = the button shows "Warming up" and cannot be pressed yet (modules still loading) */
  setReady(ready: boolean): void;
  /** fade out and remove */
  dismiss(): void;
  isShown(): boolean;
}

const WORD = 'WOBBLEHOARD';
export const CTA_LABEL = 'Wake it up';

export function createTitleCard(root: HTMLElement, o: { onStart(viaKeyboard: boolean): void }): TitleCard {
  const letters = [...WORD].map((ch, i) => {
    const s = h('span', { class: 'title-letter', text: ch });
    s.style.setProperty('--i', String(i));   // CSSOM, allowed by a strict style-src (an inline style="" attribute is not)
    return s;
  });
  const mark = h('div', { class: 'title-mark', attrs: { 'aria-hidden': 'true' } }, ...letters);
  const promise = h('p', { class: 'title-promise', text: 'A squishy toy that squishes back.' });
  const button = h('button', { class: 'cta', attrs: { type: 'button', disabled: '', 'aria-busy': 'true' } },
    h('span', { class: 'cta-label', text: 'Warming up…' }));
  const fine = h('p', { class: 'title-fine', text: 'Sound on for the full squish.' });
  const el = h('div', { class: 'title', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'WOBBLEHOARD, a squishy toy. Press the button to start.' } },
    h('div', { class: 'title-top' }, mark, promise),
    h('div', { class: 'title-bottom' }, button, fine));
  root.append(el);
  let shown = true;

  // a click with detail 0 came from Enter / Space on the focused button: the keyboard user's focus then moves to the squishy
  button.addEventListener('click', (e) => { if (!button.disabled && shown) o.onStart(e.detail === 0); });

  return {
    el, button,
    isShown: () => shown,
    setReady(ready) {
      const label = button.querySelector('.cta-label');
      if (label) label.textContent = ready ? CTA_LABEL : 'Warming up…';
      button.disabled = !ready;
      if (ready) { button.removeAttribute('disabled'); button.removeAttribute('aria-busy'); button.focus({ preventScroll: true }); }
      else { button.setAttribute('disabled', ''); button.setAttribute('aria-busy', 'true'); }
    },
    dismiss() {
      if (!shown) return;
      shown = false;
      el.dataset.leaving = 'true';
      const done = (): void => { el.remove(); };
      if (prefersReducedMotion()) done();
      else { el.addEventListener('transitionend', done, { once: true }); setTimeout(done, 700); }
    },
  };
}
