// Boot / title card: the wordmark, a one-line promise and one big button. The button is ALSO the audio-unlock gesture, so
// its click handler must call into the audio engine synchronously (no await first): main.ts passes onStart accordingly.
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

export function createTitleCard(root: HTMLElement, o: { onStart(): void }): TitleCard {
  const mark = h('div', { class: 'title-mark', attrs: { 'aria-hidden': 'true' } },
    ...[...WORD].map((ch, i) => h('span', { class: 'title-letter', text: ch, attrs: { style: `--i:${i}` } })));
  const promise = h('p', { class: 'title-promise', text: 'A squishy toy that squishes back.' });
  const button = h('button', { class: 'cta', attrs: { type: 'button', disabled: '', 'aria-busy': 'true' } },
    h('span', { class: 'cta-label', text: 'Warming up…' }));
  const fine = h('p', { class: 'title-fine', text: 'Sound on for the full squish.' });
  const el = h('div', { class: 'title', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'WOBBLEHOARD, a squishy toy. Press the button to start.' } },
    h('div', { class: 'title-top' }, mark, promise),
    h('div', { class: 'title-bottom' }, button, fine));
  root.append(el);
  let shown = true;

  button.addEventListener('click', () => { if (!button.disabled && shown) o.onStart(); });

  return {
    el, button,
    isShown: () => shown,
    setReady(ready) {
      const label = button.querySelector('.cta-label');
      if (label) label.textContent = ready ? 'Tap to wake it up' : 'Warming up…';
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
