// The title card (UI.md 4 and 6): the jelly lockup on the live scene, a glass tagline plate, the "Wake it up" gel button, the chips, a Sound
// toggle. The button is ALSO the audio-unlock gesture, so its click handler must call into the audio engine synchronously (no await first):
// boot.ts passes onStart accordingly. No inline style attributes (strict CSP: style-src 'self'): geometry goes through the CSSOM only.
//
// Layout: `data-layout` on the card (layout.ts: wide | strip | stack | tiny). The lockup is one row on wide / strip / tiny and one word per
// line on stack; its size is fitted to the card (fitJelly) and re-fitted on every resize. The intro (1.2 s: letters drop, the plate rises, the
// button pops, the chips fade in) is skipped by any key or tap; Calm and reduced motion have no drop, no idle, no bounce pose: a short fade.
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';
import { installLayout } from './layout.ts';
import type { LayoutHandle } from './layout.ts';
import { fitJelly, jelly, pokeJelly, setJelly } from './jelly/jelly.ts';
import { isCalm, watchReducedMotion } from './motion.ts';
import { BOUNCE_IN_CALM, BOUNCE_POSE, CTA_LABEL, INTRO_MS, STATUS_READY, STATUS_WARMING, TAGLINE, WORD } from './titleCopy.ts';
import './jelly/jelly.css';
import './title.css';

export type TitleChipId = 'howto' | 'trophies' | 'credits' | 'settings';
/** A destination chip. Only screens that exist are passed in (boot.ts owns that list); a later batch adds its chip, nothing here changes. */
export interface TitleChip { id: TitleChipId; label: string; onPress(): void }

export interface TitleOpts {
  onStart(viaKeyboard: boolean): void;
  /** The Sound chip was pressed: `muted` is the state the player now wants. */
  onSound(muted: boolean): void;
  /** The lockup was poked (a tap or click on it): the shell plays the tick. */
  onPoke?(): void;
  muted?: boolean;
  chips?: readonly TitleChip[];
}

export interface TitleCard {
  readonly el: HTMLElement;
  readonly button: HTMLButtonElement;
  /** The h1: the jelly lockup (its real text is "SQUISH KEEPER"). */
  readonly mark: HTMLElement;
  /** false = the button is busy (three jelly dots) and cannot be pressed yet */
  setReady(ready: boolean): void;
  /** Show the Sound chip's state (from the game: a key, the HUD, another tab). */
  setMuted(muted: boolean): void;
  /** Skip the intro now (any key or tap does this). */
  skipIntro(): void;
  /** fade out and remove */
  dismiss(): void;
  isShown(): boolean;
}

export { BOUNCE_IN_CALM, BOUNCE_POSE, CTA_LABEL, INTRO_MS, STATUS_READY, STATUS_WARMING, TAGLINE, WORD };

const CHIP_ICON: Record<TitleChipId, IconName> = { howto: 'help', trophies: 'trophy', credits: 'heart', settings: 'gear' };

export function createTitleCard(root: HTMLElement, o: TitleOpts): TitleCard {
  const bounceNow = (): number => (isCalm() && !BOUNCE_IN_CALM ? 0 : BOUNCE_POSE);
  const mark = jelly(WORD, { size: 'xl', tone: 'amber', tag: 'h1', bounce: bounceNow(), words: true, letters: true });
  mark.classList.add('title-mark', 'jl-idle', 'jl-intro');
  mark.id = 'wh-title-name';
  mark.setAttribute('data-sound', 'none');

  const plate = h('p', { class: 'title-promise k-glass', text: TAGLINE, attrs: { id: 'wh-title-tag' } });
  const status = h('p', { class: 'sr-only', text: STATUS_WARMING, attrs: { id: 'wh-title-status', role: 'status' } });
  const button = h('button', { class: 'cta k-btn k-gel k-cta', attrs: { type: 'button', disabled: '', 'aria-busy': 'true', 'aria-describedby': 'wh-title-status' } },
    h('span', { class: 'k-btn-label cta-label', text: CTA_LABEL }),
    h('span', { class: 'k-dots', attrs: { 'aria-hidden': 'true' } }, h('i', { class: 'k-dot' }), h('i', { class: 'k-dot' }), h('i', { class: 'k-dot' })));

  const chip = (label: string, ic: IconName, keep: boolean): HTMLButtonElement =>
    h('button', { class: `k-chip title-chip${keep ? ' title-keep' : ''}`, attrs: { type: 'button' } }, icon(ic, 'k-icon'), h('span', { class: 'title-chip-label', text: label }));
  const chips = h('div', { class: 'title-chips', attrs: { role: 'group', 'aria-label': 'More' } });
  for (const c of o.chips ?? []) {
    const b = chip(c.label, CHIP_ICON[c.id], c.id === 'settings');
    b.dataset.chip = c.id;
    b.addEventListener('click', () => c.onPress());
    chips.append(b);
  }
  // the Sound toggle: pressed = sound on (a switch), icon and state both change
  const snd = chip('Sound', 'soundOn', true);
  snd.classList.add('title-snd');
  snd.dataset.chip = 'sound';
  let muted = !!o.muted;
  const showMuted = (m: boolean): void => {
    muted = m;
    snd.setAttribute('aria-pressed', String(!m));
    snd.replaceChild(icon(m ? 'soundOff' : 'soundOn', 'k-icon'), snd.firstElementChild!);
  };
  showMuted(muted);
  snd.addEventListener('click', () => o.onSound(!muted));
  chips.append(snd);

  const el = h('div', { class: 'title', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'wh-title-name', 'aria-describedby': 'wh-title-tag', 'data-intro': 'play' } },
    mark, plate, h('div', { class: 'title-actions' }, button, chips), status);
  root.append(el);
  let shown = true;

  // ---- layout: the card follows the viewport (its own data-layout); the lockup is one row or one word per line, then fitted to the room
  const layout: LayoutHandle = installLayout({ body: el });
  const fit = (): void => {
    if (!shown) return;
    const l = layout.current().layout;
    mark.classList.toggle('jl-col', l === 'stack');
    const cs = getComputedStyle(el);
    const room = el.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    fitJelly(mark, room, { floor: 24 });
  };
  fit();
  const offLayout = layout.onChange(fit);
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fit()) : null;
  ro?.observe(el);

  // ---- Calm: the bounce pose is off (a straight lockup); re-drawn when the setting or the OS preference changes
  let calmWas = isCalm();
  const recalm = (): void => {
    const c = isCalm();
    if (c === calmWas || !shown) return;
    calmWas = c;
    setJelly(mark, WORD, { bounce: bounceNow() });
    fit();
  };
  const mo = typeof MutationObserver === 'function' ? new MutationObserver(recalm) : null;
  mo?.observe(document.body, { attributes: true, attributeFilter: ['data-calm'] });
  const offMotion = watchReducedMotion(recalm);

  // ---- intro: any key or tap skips it (the resting pose is the end state, so skipping is just taking the animations away)
  let introTimer = 0;
  const endIntro = (): void => {
    clearTimeout(introTimer);
    window.removeEventListener('keydown', skip, true);
    window.removeEventListener('pointerdown', skip, true);
    el.dataset.intro = 'done';
    mark.classList.remove('jl-intro');
    mark.style.setProperty('--jl-idle-delay', '0s');
  };
  const skip = (): void => endIntro();
  window.addEventListener('keydown', skip, true);
  window.addEventListener('pointerdown', skip, true);
  mark.style.setProperty('--jl-idle-delay', `${(INTRO_MS / 1000).toFixed(2)}s`);
  introTimer = window.setTimeout(endIntro, INTRO_MS + 100);
  if (isCalm()) endIntro();   // no drop in Calm: the resting pose at once (the card still fades in)

  // ---- poke: a tap or click on the lockup squashes the letter under it (and its neighbours); the shell plays the tick
  mark.addEventListener('pointerdown', (e) => { pokeJelly(mark, { x: e.clientX }); o.onPoke?.(); });

  // a click with detail 0 came from Enter / Space on the focused button: the keyboard user's focus then moves to the squishy
  button.addEventListener('click', (e) => { if (!button.disabled && shown) o.onStart(e.detail === 0); });

  const teardown = (): void => { endIntro(); ro?.disconnect(); mo?.disconnect(); offMotion(); offLayout(); layout.dispose(); };
  return {
    el, button, mark,
    isShown: () => shown,
    setReady(ready) {
      button.disabled = !ready;
      status.textContent = ready ? STATUS_READY : STATUS_WARMING;
      if (ready) { button.removeAttribute('disabled'); button.removeAttribute('aria-busy'); button.focus({ preventScroll: true }); }
      else { button.setAttribute('disabled', ''); button.setAttribute('aria-busy', 'true'); }
    },
    setMuted: showMuted,
    skipIntro: endIntro,
    dismiss() {
      if (!shown) return;
      shown = false;
      teardown();
      el.dataset.leaving = 'true';
      const done = (): void => { el.remove(); };
      if (isCalm()) window.setTimeout(done, 160);
      else { el.addEventListener('transitionend', done, { once: true }); window.setTimeout(done, 700); }
    },
  };
}
