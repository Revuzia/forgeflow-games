// The tooltip (UI.md 3.3 "Tooltip [R18, 1.4.13]"): 450 ms after a fine pointer rests on the target, instantly on keyboard focus, never on
// touch. WCAG 1.4.13: HOVERABLE (the pointer may move onto the tip), DISMISSIBLE (Escape hides it without moving focus or pointer, and eats
// that one Escape so a tool is not dropped by accident), PERSISTENT (it stays until the pointer or focus leaves, the target is pressed, or
// Escape). One tip exists at a time. The tip is the kit's `.k-tip`, appended to <body> and placed with fixed coordinates (CSSOM only, so the
// strict CSP is untouched). It never sets aria-describedby: the target already carries its name and `aria-keyshortcuts`; the tip is the
// sighted, pointer-and-keyboard supplement.

export interface TooltipOptions {
  place?: 'above' | 'below' | (() => 'above' | 'below');
  /** ms a resting fine pointer waits (default 450) */
  delay?: number;
  /** asked at show time: false = stay quiet now (the full dock already draws its labels and key chips) */
  when?: () => boolean;
}
export interface TooltipHandle { show(): void; hide(): void; readonly visible: boolean; destroy(): void }

export const TIP_DELAY_MS = 450;
const HIDE_GRACE_MS = 140;
const EDGE = 8;
const GAP = 10;

let tipEl: HTMLElement | null = null;
let owner: TooltipHandle | null = null;
let escBound = false;

function tip(): HTMLElement {
  if (tipEl && tipEl.isConnected) return tipEl;
  const el = document.createElement('div');
  el.className = 'k-tip';
  el.setAttribute('role', 'tooltip');
  el.hidden = true;
  el.style.position = 'fixed';
  el.style.left = '0px';
  el.style.top = '0px';
  document.body.append(el);
  tipEl = el;
  return el;
}

function fineHover(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches; } catch { return false; }
}

function bindEscape(): void {
  if (escBound) return;
  escBound = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !owner || !owner.visible) return;
    owner.hide();
    e.preventDefault();
    e.stopImmediatePropagation(); // capture phase on window: this Escape only dismissed the tip
  }, true);
  // a tip is placed once, beside its target: when the window changes size (a rotation, a fold, the portal's box) the target moves and the tip would stay behind, over a neighbour (found by the
  // K11 height sweep: "Hand (1)" left standing over the tray after 640 -> 568 high), so the tip goes
  window.addEventListener('resize', () => { if (owner && owner.visible) owner.hide(); });
}

export function attachTooltip(target: HTMLElement, text: string | (() => string), o: TooltipOptions = {}): TooltipHandle {
  let timer = 0, hideTimer = 0, shown = false, overTip = false;
  const delay = o.delay ?? TIP_DELAY_MS;
  const label = (): string => (typeof text === 'function' ? text() : text);
  const clearTimers = (): void => { if (timer) { clearTimeout(timer); timer = 0; } if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; } };

  const onTipEnter = (): void => { overTip = true; if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; } };
  const onTipLeave = (): void => { overTip = false; scheduleHide(); };

  function place(el: HTMLElement): void {
    const r = target.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    const w = el.offsetWidth, hgt = el.offsetHeight;
    const cx = r.left + r.width / 2;
    const left = Math.max(EDGE, Math.min(vw - w - EDGE, cx - w / 2));
    let side: 'above' | 'below' = (typeof o.place === 'function' ? o.place() : o.place) ?? 'above';
    if (side === 'above' && r.top - hgt - GAP < EDGE) side = 'below';
    else if (side === 'below' && r.bottom + hgt + GAP > (window.innerHeight || 0) - EDGE) side = 'above';
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(side === 'above' ? r.top - hgt - GAP : r.bottom + GAP)}px`;
    el.dataset.place = side;
    el.style.setProperty('--tip-ax', `${Math.round(Math.max(12, Math.min(w - 12, cx - left)))}px`);
  }

  const handle: TooltipHandle = {
    get visible() { return shown; },
    show() {
      clearTimers();
      if (o.when && !o.when()) return;
      if (owner && owner !== handle) owner.hide();
      const el = tip();
      el.textContent = label();
      el.hidden = false;
      el.addEventListener('pointerenter', onTipEnter);
      el.addEventListener('pointerleave', onTipLeave);
      place(el);
      shown = true;
      owner = handle;
      bindEscape();
    },
    hide() {
      clearTimers();
      if (!shown) return;
      shown = false;
      overTip = false;
      const el = tip();
      el.hidden = true;
      el.removeEventListener('pointerenter', onTipEnter);
      el.removeEventListener('pointerleave', onTipLeave);
      if (owner === handle) owner = null;
    },
    destroy() {
      handle.hide();
      target.removeEventListener('pointerenter', onEnter);
      target.removeEventListener('pointerleave', onLeave);
      target.removeEventListener('pointerdown', onDown);
      target.removeEventListener('focusin', onFocus);
      target.removeEventListener('focusout', onBlur);
    },
  };

  function scheduleHide(): void {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => { hideTimer = 0; if (!overTip && !target.matches(':focus-visible')) handle.hide(); }, HIDE_GRACE_MS);
  }
  function onEnter(e: PointerEvent): void {
    if (e.pointerType === 'touch' || !fineHover()) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = 0; }
    if (shown || timer) return;
    timer = window.setTimeout(() => { timer = 0; handle.show(); }, delay);
  }
  function onLeave(e: PointerEvent): void {
    if (e.pointerType === 'touch') return;
    if (timer) { clearTimeout(timer); timer = 0; }
    if (shown) scheduleHide();
  }
  function onDown(): void { if (timer) { clearTimeout(timer); timer = 0; } if (shown) handle.hide(); }
  function onFocus(): void { if (target.matches(':focus-visible')) handle.show(); }
  function onBlur(): void { if (shown) handle.hide(); }

  target.addEventListener('pointerenter', onEnter);
  target.addEventListener('pointerleave', onLeave);
  target.addEventListener('pointerdown', onDown);
  target.addEventListener('focusin', onFocus);
  target.addEventListener('focusout', onBlur);
  return handle;
}
