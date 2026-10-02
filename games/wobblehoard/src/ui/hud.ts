// HUD: wordmark (top-left), mute + gear (top-right), squishy name tag (bottom-left), one-line gesture hint.
// The hint fades after the first interaction and comes back after 20 s idle (see hint.ts).
import { h, icon, isCoarsePointer } from './dom.ts';
import { HINT_TEXT, createHintController } from './hint.ts';

export interface HudOptions {
  name: string;
  muted: boolean;
  onGear(): void;
  onMute(): void;
  now?: () => number;
}

export interface Hud {
  readonly el: HTMLElement;
  readonly gear: HTMLButtonElement;
  readonly hintEl: HTMLElement;
  setName(n: string): void;
  setMuted(m: boolean): void;
  /** false while the title card is up */
  setActive(on: boolean): void;
  setGearOpen(open: boolean): void;
  interact(): void;
  /** current hint visibility (the probe reads this) */
  hintVisible(): boolean;
  destroy(): void;
}

export function createHud(root: HTMLElement, o: HudOptions): Hud {
  const now = o.now ?? (() => performance.now());
  const hint = createHintController();

  const nameEl = h('span', { class: 'nametag-name', text: o.name });
  const nameTag = h('div', { class: 'nametag' }, h('span', { class: 'nametag-label', text: 'Your squishy' }), nameEl);

  const muteBtn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Mute sound', 'aria-pressed': 'false', title: 'Mute (M)' }, on: { click: () => o.onMute() } });
  const gear = h('button', {
    class: 'icon-btn',
    attrs: { type: 'button', 'aria-label': 'Settings', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'wh-settings', title: 'Settings' },
    on: { click: () => o.onGear() },
  }, icon('gear'));

  const hintEl = h('p', { class: 'hint', text: isCoarsePointer() ? HINT_TEXT.touch : HINT_TEXT.pointer, attrs: { 'data-show': 'true' } });
  const wordmark = h('h1', { class: 'wordmark', text: 'WOBBLEHOARD' });
  const top = h('div', { class: 'hud-top' }, wordmark, h('div', { class: 'hud-actions' }, muteBtn, gear));
  const el = h('div', { class: 'hud', attrs: { 'data-active': 'false' } }, top, hintEl, nameTag);
  root.append(el);

  const setMuted = (m: boolean): void => {
    muteBtn.replaceChildren(icon(m ? 'soundOff' : 'soundOn'));
    muteBtn.setAttribute('aria-pressed', String(m));
    muteBtn.title = m ? 'Unmute (M)' : 'Mute (M)';
  };
  setMuted(o.muted);

  let active = false;
  const refreshHint = (): void => { hintEl.dataset.show = String(active && hint.visible(now())); };
  const timer = setInterval(refreshHint, 400);
  refreshHint();

  return {
    el, gear, hintEl,
    setName(n) { nameEl.textContent = n; },
    setMuted,
    setActive(on) { active = on; el.dataset.active = String(on); refreshHint(); },
    setGearOpen(open) { gear.setAttribute('aria-expanded', String(open)); },
    interact() { hint.interact(now()); refreshHint(); },
    hintVisible: () => hintEl.dataset.show === 'true',
    destroy() { clearInterval(timer); el.remove(); },
  };
}
