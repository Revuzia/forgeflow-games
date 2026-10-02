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

  // One line, always: shrink the hint a little (down to 12 px) when the screen is too narrow for it at full size, and only
  // wrap as a last resort. System fonts differ a lot in width, so this is measured, not guessed.
  const MIN_FONT = 12;
  const fitHint = (): void => {
    hintEl.style.fontSize = '';
    hintEl.style.whiteSpace = 'nowrap';
    const cs = getComputedStyle(hintEl);
    let size = parseFloat(cs.fontSize) || 14;
    const max = parseFloat(cs.maxWidth);
    const avail = Number.isFinite(max) ? max : document.documentElement.clientWidth - 32;
    while (hintEl.scrollWidth > avail + 0.5 && size > MIN_FONT) { size -= 0.5; hintEl.style.fontSize = `${size}px`; }
    if (hintEl.scrollWidth > avail + 0.5) hintEl.style.whiteSpace = ''; // still too long at the minimum: let it wrap
  };
  fitHint();
  window.addEventListener('resize', fitHint);

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
    destroy() { clearInterval(timer); window.removeEventListener('resize', fitHint); el.remove(); },
  };
}
