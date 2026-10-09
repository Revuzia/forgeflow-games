// HUD: the brand (top-left: the jelly SQUISH KEEPER at its small size, the page's h1 once the title has left; shown on wide screens and on stack from 600 px, UI.md 4.2),
// Full screen, Sound and the Menu (top-right, in that Tab order; Full screen only where the page may use it), the name plate of the play squishy (bottom-left: catalog species name, tier gem and
// label, nickname if any), the meter ring + capsule button (bottom-right), a slot for the Hoard button in the strip layout (every other layout keeps it in the dock,
// ui/toolbar.ts) and the mat chip, one-line hint. The toolbar (the tools, the options bar) is built by hudBinding.ts into this element.
// The hint fades after the first interaction and comes back after 20 s idle (hint.ts), then names the tools until one was tried. No score, no currency, no timers.
import type { TierName } from '../contracts.ts';
import { h, isCoarsePointer } from './dom.ts';
import { icon } from './icons.ts';
import { gemSvg, setGem, tierLabel } from './gem.ts';
import { HINT_TEXT, createHintController } from './hint.ts';
import type { MeterRing } from './meterRing.ts';
import { createMeterRing } from './meterRing.ts';
import { jelly, pokeJelly } from './jelly/jelly.ts';
import { attachTooltip } from './tooltip.ts';
import './jelly/jelly.css';

export interface HudLabel { species: string; tier: TierName; nickname: string | null }

export interface HudOptions {
  label: HudLabel;
  muted: boolean;
  /** the Menu button (it was the Settings gear before UI v3): the Menu is the pause screen and the way to Settings */
  onMenu(): void;
  onMute(): void;
  /** the [FS] button: drawn only when `available` (shell/fullscreen.ts) */
  fullscreen?: { available: boolean; on: boolean; onToggle(): void };
  onOpenCapsule(): void;
  /** a capsule just became ready: the shell's haptic double pulse (UI.md 6) */
  onReady?(): void;
  /** the brand was poked (the shell plays the tick) */
  onPoke?(): void;
  now?: () => number;
}

export interface Hud {
  readonly el: HTMLElement;
  readonly menuButton: HTMLButtonElement;
  readonly muteButton: HTMLButtonElement;
  /** null where full screen is not available */
  readonly fsButton: HTMLButtonElement | null;
  readonly hintEl: HTMLElement;
  readonly meter: MeterRing;
  /** the bottom row's middle slot: the Hoard button in the strip layout (layout.ts bindHoard) and the mat chip */
  readonly slot: HTMLElement;
  /** the brand (the jelly h1) */
  readonly brand: HTMLElement;
  setLabel(l: HudLabel): void;
  setMuted(m: boolean): void;
  /** false while the title card is up */
  setActive(on: boolean): void;
  setMenuOpen(open: boolean): void;
  /** the [FS] button follows the real state (aria-pressed, the icon); `available` false takes the button away (a refusal) */
  setFullscreen(on: boolean, available?: boolean): void;
  interact(): void;
  /** switch the hint wording (a keyboard was used) */
  setHintMode(mode: 'touch' | 'pointer' | 'keyboard'): void;
  /** a tool was picked from anywhere: the first-run tool line ("Tap a tool to try it.") has done its job (hint.ts; memory only) */
  toolTried(): void;
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
  const nameTag = h('div', { class: 'nametag k-glass' }, nameEl, h('span', { class: 'nametag-line' }, gem, tierEl, nickEl));

  const muteBtn = h('button', { class: 'k-btn k-iconbtn', attrs: { type: 'button', 'aria-label': 'Mute sound', 'aria-pressed': 'false' }, on: { click: () => o.onMute() } });
  const menuBtn = h('button', {
    class: 'k-btn k-iconbtn',
    attrs: { type: 'button', 'aria-label': 'Menu', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'wh-menu', 'aria-keyshortcuts': 'P', 'data-sound': 'none' },
    on: { click: () => o.onMenu() },
  }, icon('menu'));
  const fsBtn = o.fullscreen?.available
    ? h('button', { class: 'k-btn k-iconbtn', attrs: { type: 'button', 'aria-label': 'Full screen', 'aria-pressed': 'false', 'aria-keyshortcuts': 'F' }, on: { click: () => o.fullscreen?.onToggle() } }, icon('fullscreen'))
    : null;
  const setFullscreen = (on: boolean, available = true): void => {
    if (!fsBtn) return;
    fsBtn.hidden = !available;
    fsBtn.setAttribute('aria-pressed', String(on));
    fsBtn.replaceChildren(icon(on ? 'fullscreenExit' : 'fullscreen'));
  };
  setFullscreen(!!o.fullscreen?.on);
  // the top row's three icon buttons name themselves with the kit tooltip (UI.md 3.3, K16): 450 ms on a fine pointer, at once on focus, never on touch, hoverable, Esc dismisses
  // (the native `title` it replaces is a browser tip the page cannot hold, dismiss or restyle)
  attachTooltip(muteBtn, () => (muteBtn.getAttribute('aria-pressed') === 'true' ? 'Unmute (M)' : 'Mute (M)'), { place: 'below' });
  attachTooltip(menuBtn, 'Menu (P)', { place: 'below' });
  if (fsBtn) attachTooltip(fsBtn, () => (fsBtn.getAttribute('aria-pressed') === 'true' ? 'Leave full screen (F)' : 'Full screen (F)'), { place: 'below' });

  let mode: 'touch' | 'pointer' | 'keyboard' = isCoarsePointer() ? 'touch' : 'pointer';
  const hintEl = h('p', { class: 'hint', text: HINT_TEXT[mode], attrs: { 'data-show': 'true' } });
  // the brand: the jelly lockup's small size (three passes), real text inside (the h1 names itself from it), a slow idle wobble (off in Calm), a poke squashes a letter
  const wordmark = jelly('SQUISH KEEPER', { size: 'sm', tone: 'amber', tag: 'h1' });
  wordmark.classList.add('wordmark', 'jl-idle');
  wordmark.addEventListener('pointerdown', (e) => { pokeJelly(wordmark, { x: e.clientX }); o.onPoke?.(); });
  const top = h('div', { class: 'hud-top' }, wordmark, h('div', { class: 'hud-actions' }, fsBtn, muteBtn, menuBtn));
  const slot = h('div', { class: 'hud-slot', attrs: { 'data-slot': 'hoard' } });
  const bottom = h('div', { class: 'hud-bottom' }, nameTag, slot);
  const el = h('div', { class: 'hud', attrs: { 'data-active': 'false' } }, top, hintEl, bottom);
  root.append(el);
  const meter = createMeterRing(bottom, { onOpen: () => o.onOpenCapsule(), onReady: o.onReady });
  meter.el.classList.add('k-glass');   // the info row's glass: [ring][Open] in one container (UI.md 4.2)

  const setMuted = (m: boolean): void => {
    muteBtn.replaceChildren(icon(m ? 'soundOff' : 'soundOn'));
    muteBtn.setAttribute('aria-pressed', String(m));
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
  // wrap as a last resort. System fonts differ a lot in width, so this is measured, not guessed.
  const MIN_FONT = 12;
  const fitHint = (): void => {
    hintEl.style.fontSize = '';
    hintEl.style.whiteSpace = 'nowrap';
    const cs = getComputedStyle(hintEl);
    let size = parseFloat(cs.fontSize) || 14;
    const max = parseFloat(cs.maxWidth);
    const border = hintEl.offsetWidth - hintEl.clientWidth; // box-sizing: border-box, scrollWidth excludes the border
    // the text must fit INSIDE the padding too. scrollWidth of an overflowing nowrap box counts the left padding but not the right one, so the text was allowed to run 16 px into the right
    // padding and touch the pill's border (seen at 390 px, SHELL-4): the text's own width is measured with a Range instead
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
    const avail = (Number.isFinite(max) ? max : document.documentElement.clientWidth - 32) - border - pad;
    const rg = document.createRange();
    const textW = (): number => { rg.selectNodeContents(hintEl); return rg.getBoundingClientRect().width; };
    while (textW() > avail + 0.5 && size > MIN_FONT) { size -= 0.5; hintEl.style.fontSize = `${size}px`; }
    if (textW() > avail + 0.5) hintEl.style.whiteSpace = ''; // still too long at the minimum: let it wrap
  };
  fitHint();
  // The HUD root is fixed full-screen, so a ResizeObserver on it fires after every viewport / orientation change, once layout
  // and the media queries are up to date (a window 'resize' listener can run too early). It never resizes itself, so no loop.
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { fitHint(); fitName(); }) : null;
  if (ro) ro.observe(el); else window.addEventListener('resize', fitHint);
  // The name tag's own box changes when its neighbours do (a capsule button and its pips arrive in the ring's column, the Hoard button changes its word and its count) with no change in the HUD's
  // size, so the observer above never fired and the name stayed fitted to the OLD room, cut off with an ellipsis (SHELL-4: "Boingle" in the crowded phone row, found by the hoard-phone
  // check). Observing the tag re-fits the name whenever its room changes; the fit ends where it began, so it does not loop.
  const roName = typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitName()) : null;
  roName?.observe(nameTag);
  void document.fonts?.ready.then(fitHint);

  let active = false;
  const refreshHint = (): void => {
    const show = active && hint.visible(now());
    if (show) {   // the pill comes BACK after the idle gap: the first-run tool line while no tool was tried (hint.ts line()), else the gesture help
      const t = hint.line(mode);
      if (hintEl.textContent !== t) { hintEl.textContent = t; fitHint(); }
    }
    hintEl.dataset.show = String(show);
  };
  const timer = setInterval(refreshHint, 400);
  refreshHint();

  return {
    el, menuButton: menuBtn, muteButton: muteBtn, fsButton: fsBtn, hintEl, meter, slot, brand: wordmark,
    setLabel,
    setMuted,
    setActive(on) { active = on; el.dataset.active = String(on); refreshHint(); },
    setMenuOpen(open) { menuBtn.setAttribute('aria-expanded', String(open)); },
    setFullscreen,
    interact() { hint.interact(now()); refreshHint(); },
    setHintMode(m) { if (m === mode) return; mode = m; hintEl.textContent = hint.line(m); fitHint(); },
    toolTried() { hint.toolTried(); },
    hintVisible: () => hintEl.dataset.show === 'true',
    destroy() { clearInterval(timer); ro?.disconnect(); roName?.disconnect(); window.removeEventListener('resize', fitHint); meter.destroy(); el.remove(); },
  };
}
