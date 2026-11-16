// HUD: wordmark (top-left), mute + gear (top-right), the name plate of the play squishy (bottom-left: catalog species name, tier gem and
// label, nickname if any), the meter ring + capsule button (bottom-right), a centre slot for SHELL-2b's Hoard button, one-line hint.
// The hint fades after the first interaction and comes back after 20 s idle (hint.ts). No score, no currency, no timers.
import type { TierName } from '../contracts.ts';
import { h, icon, isCoarsePointer } from './dom.ts';
import { gemSvg, setGem, tierLabel } from './gem.ts';
import { HINT_TEXT, createHintController } from './hint.ts';
import type { MeterRing } from './meterRing.ts';
import { createMeterRing } from './meterRing.ts';

export interface HudLabel { species: string; tier: TierName; nickname: string | null }

export interface HudOptions {
  label: HudLabel;
  muted: boolean;
  onGear(): void;
  onMute(): void;
  onOpenCapsule(): void;
  now?: () => number;
}

export interface Hud {
  readonly el: HTMLElement;
  readonly gear: HTMLButtonElement;
  readonly muteButton: HTMLButtonElement;
  readonly hintEl: HTMLElement;
  readonly meter: MeterRing;
  /** an empty slot, bottom centre, for SHELL-2b's Hoard button */
  readonly slot: HTMLElement;
  setLabel(l: HudLabel): void;
  setMuted(m: boolean): void;
  /** false while the title card is up */
  setActive(on: boolean): void;
  setGearOpen(open: boolean): void;
  interact(): void;
  /** switch the hint wording (a keyboard was used) */
  setHintMode(mode: 'touch' | 'pointer' | 'keyboard'): void;
  /** current hint visibility (the probe reads this) */
  hintVisible(): boolean;
  destroy(): void;
}

export function createHud(root: HTMLElement, o: HudOptions): Hud {
  const now = o.now ?? (() => performance.now());
  const hint = createHintController();

  const gem = gemSvg(o.label.tier, 'gem');
  const nameEl = h('span', { class: 'nametag-name', text: o.label.species });
  const tierEl = h('span', { class: 'nametag-tier', text: tierLabel(o.label.tier) });
  const nickEl = h('span', { class: 'nametag-nick' });
  const nameTag = h('div', { class: 'nametag' }, nameEl, h('span', { class: 'nametag-line' }, gem, tierEl, nickEl));

  const muteBtn = h('button', { class: 'icon-btn', attrs: { type: 'button', 'aria-label': 'Mute sound', 'aria-pressed': 'false', title: 'Mute (M)' }, on: { click: () => o.onMute() } });
  const gear = h('button', {
    class: 'icon-btn',
    attrs: { type: 'button', 'aria-label': 'Settings', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'wh-settings', title: 'Settings' },
    on: { click: () => o.onGear() },
  }, icon('gear'));

  let mode: 'touch' | 'pointer' | 'keyboard' = isCoarsePointer() ? 'touch' : 'pointer';
  const hintEl = h('p', { class: 'hint', text: HINT_TEXT[mode], attrs: { 'data-show': 'true' } });
  const wordmark = h('h1', { class: 'wordmark', text: 'SQUISH KEEPER' });
  const top = h('div', { class: 'hud-top' }, wordmark, h('div', { class: 'hud-actions' }, muteBtn, gear));
  const slot = h('div', { class: 'hud-slot', attrs: { 'data-slot': 'hoard' } });
  const bottom = h('div', { class: 'hud-bottom' }, nameTag, slot);
  const el = h('div', { class: 'hud', attrs: { 'data-active': 'false' } }, top, hintEl, bottom);
  root.append(el);
  const meter = createMeterRing(bottom, { onOpen: () => o.onOpenCapsule() });

  const setMuted = (m: boolean): void => {
    muteBtn.replaceChildren(icon(m ? 'soundOff' : 'soundOn'));
    muteBtn.setAttribute('aria-pressed', String(m));
    muteBtn.title = m ? 'Unmute (M)' : 'Mute (M)';
  };
  setMuted(o.muted);

  // a long species name shrinks to fit the name tag (down to 12 px) before it is ever cut off with an ellipsis (a phone's bottom row)
  const NAME_MIN = 12;
  const fitName = (): void => {
    nameEl.style.fontSize = '';
    if (!nameEl.clientWidth) return;
    let size = parseFloat(getComputedStyle(nameEl).fontSize) || 19;
    while (nameEl.scrollWidth > nameEl.clientWidth + 0.5 && size > NAME_MIN) { size -= 0.5; nameEl.style.fontSize = `${size}px`; }
  };
  const setLabel = (l: HudLabel): void => {
    nameEl.textContent = l.species;
    nameEl.title = l.species;
    requestAnimationFrame(fitName);
    tierEl.textContent = tierLabel(l.tier);
    setGem(gem, l.tier);
    nickEl.textContent = l.nickname ? `“${l.nickname}”` : '';
    nickEl.hidden = !l.nickname;
    nameTag.dataset.tier = l.tier;
  };
  setLabel(o.label);

  // One line, always: shrink the hint a little (down to 12 px) when the screen is too narrow for it at full size, and only
  // wrap as a last resort (then on two lines at the largest size, up to the full one, that still fits in two). System fonts differ a lot in
  // width, so this is measured, not guessed. The TEXT itself is measured (a Range) against the widest content box the pill may have (its
  // max-width less border and padding). The old test compared scrollWidth with the padding box, and Chromium's scrollWidth leaves out the end
  // padding of a line that overflows, so a line that ran into the pill's right padding counted as fitting (SHELL-4: the touch line at 390 px
  // sat 6 px from the pill's right edge and 17 px from its left). Runs only on a resize, a wording change or the fonts loading.
  const MIN_FONT = 12;
  const hintRange = document.createRange();
  const hintTextWidth = (): number => { hintRange.selectNodeContents(hintEl); return hintRange.getBoundingClientRect().width; };
  const hintLines = (): number => {
    hintRange.selectNodeContents(hintEl);
    const rs = hintRange.getClientRects(), tops: number[] = [];
    for (let i = 0; i < rs.length; i++) { const t = Math.round(rs[i].top); if (!tops.includes(t)) tops.push(t); }
    return tops.length;
  };
  const fitHint = (): void => {
    hintEl.style.fontSize = '';
    hintEl.style.whiteSpace = 'nowrap';
    const cs = getComputedStyle(hintEl);
    const full = parseFloat(cs.fontSize) || 14;
    let size = full;
    const max = parseFloat(cs.maxWidth);
    const side = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
    const avail = (Number.isFinite(max) ? max : document.documentElement.clientWidth - 32) - side;   // box-sizing: border-box
    while (hintTextWidth() > avail + 0.5 && size > MIN_FONT) { size -= 0.5; hintEl.style.fontSize = `${size}px`; }
    if (hintTextWidth() <= avail + 0.5) return;
    // still too long at the minimum: let it wrap, and grow back while it stays on two lines
    hintEl.style.whiteSpace = '';
    while (size < full) {
      hintEl.style.fontSize = `${size + 0.5}px`;
      if (hintLines() > 2) { hintEl.style.fontSize = `${size}px`; break; }
      size += 0.5;
    }
  };
  fitHint();
  // The HUD root is fixed full-screen, so a ResizeObserver on it fires after every viewport / orientation change, once layout
  // and the media queries are up to date (a window 'resize' listener can run too early). It never resizes itself, so no loop.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { fitHint(); fitName(); }) : null;
  if (ro) ro.observe(el); else window.addEventListener('resize', fitHint);
  void document.fonts?.ready.then(fitHint);

  let active = false;
  const refreshHint = (): void => { hintEl.dataset.show = String(active && hint.visible(now())); };
  const timer = setInterval(refreshHint, 400);
  refreshHint();

  return {
    el, gear, muteButton: muteBtn, hintEl, meter, slot,
    setLabel,
    setMuted,
    setActive(on) { active = on; el.dataset.active = String(on); refreshHint(); },
    setGearOpen(open) { gear.setAttribute('aria-expanded', String(open)); },
    interact() { hint.interact(now()); refreshHint(); },
    setHintMode(m) { if (m === mode) return; mode = m; hintEl.textContent = HINT_TEXT[m]; fitHint(); },
    hintVisible: () => hintEl.dataset.show === 'true',
    destroy() { clearInterval(timer); ro?.disconnect(); window.removeEventListener('resize', fitHint); meter.destroy(); el.remove(); },
  };
}
