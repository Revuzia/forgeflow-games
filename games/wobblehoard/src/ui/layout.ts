// The layout classifier (UI.md 4.1): one function of the viewport that every layout rule keys off, written to the body as
// `body[data-layout]` (+ `data-density`, `data-tall`). CSS never guesses the layout from its own media queries, so the
// harness, the kit page and the game agree about which of the four layouts a size is.
//
//   tiny    max-width 420 and max-height 260                     (portal phone 358x201)
//   strip   landscape and max-height 440                         (844x390, 568x320, 632x355)
//   stack   max-width 819                                        (390x844, 320x568, tablet portrait)
//   wide    otherwise                                            (1280x800, 888x500, tablet landscape)
//   data-density="short"  = wide and max-height 560              (888x500: the portal desktop box)
//   data-tall="true"      = stack and height >= 700             (the quick switcher shows only on tall)
//
// The order above is the order of the tests: a size takes the first layout it fits. Pure first; the DOM binding guards every access.

export type LayoutId = 'tiny' | 'strip' | 'stack' | 'wide';
export interface LayoutState { layout: LayoutId; short: boolean; tall: boolean; width: number; height: number }

export const TINY_MAX_W = 420, TINY_MAX_H = 260;
export const STRIP_MAX_H = 440;
export const STACK_MAX_W = 819;
export const SHORT_MAX_H = 560;
export const TALL_MIN_H = 700;

/** The 8 kit sizes of UI.md 4.1 (every screen is checked at these). */
export const KIT_SIZES: ReadonlyArray<{ w: number; h: number; layout: LayoutId; note: string }> = [
  { w: 1280, h: 800, layout: 'wide', note: 'desktop' },
  { w: 888, h: 500, layout: 'wide', note: 'portal desktop box (short)' },
  { w: 390, h: 844, layout: 'stack', note: 'phone portrait (tall)' },
  { w: 320, h: 568, layout: 'stack', note: 'small phone portrait' },
  { w: 844, h: 390, layout: 'strip', note: 'phone landscape' },
  { w: 568, h: 320, layout: 'strip', note: 'small phone landscape' },
  { w: 358, h: 201, layout: 'tiny', note: 'portal phone' },
  { w: 632, h: 355, layout: 'strip', note: 'portal phone landscape' },
];

/** The layout of a viewport. Pure. */
export function layoutFor(width: number, height: number): LayoutState {
  const w = Math.max(0, Math.round(width)), h = Math.max(0, Math.round(height));
  let layout: LayoutId;
  if (w <= TINY_MAX_W && h <= TINY_MAX_H) layout = 'tiny';
  else if (w > h && h <= STRIP_MAX_H) layout = 'strip';
  else if (w <= STACK_MAX_W) layout = 'stack';
  else layout = 'wide';
  return { layout, short: layout === 'wide' && h <= SHORT_MAX_H, tall: layout === 'stack' && h >= TALL_MIN_H, width: w, height: h };
}

export const sameLayout = (a: LayoutState, b: LayoutState): boolean => a.layout === b.layout && a.short === b.short && a.tall === b.tall;

export interface LayoutHandle {
  /** The state last written to the body. */
  current(): LayoutState;
  /** Re-measure now (fullscreen toggles and orientation flips call this; the resize listener also does). */
  update(): LayoutState;
  /** Run `cb` whenever layout, density or tallness changes (not on every pixel of resize). Returns the unsubscribe. */
  onChange(cb: (now: LayoutState, before: LayoutState) => void): () => void;
  dispose(): void;
}

function measure(): [number, number] {
  const de = document.documentElement;
  return [window.innerWidth || de.clientWidth, window.innerHeight || de.clientHeight];
}

/** Write one state to the body (idempotent). */
export function applyLayout(s: LayoutState, body: HTMLElement = document.body): void {
  body.dataset.layout = s.layout;
  if (s.short) body.dataset.density = 'short'; else delete body.dataset.density;
  body.dataset.tall = String(s.tall);
}

/**
 * Keep `body[data-layout]` right: measures now, then on resize, orientationchange, fullscreenchange and visualViewport resize (one
 * rAF per burst). `fixed` pins a size (the kit page and tests); omit it in the game.
 */
export function installLayout(o: { fixed?: { w: number; h: number }; body?: HTMLElement } = {}): LayoutHandle {
  const body = o.body ?? document.body;
  const listeners = new Set<(now: LayoutState, before: LayoutState) => void>();
  const read = (): LayoutState => { const [w, h] = o.fixed ? [o.fixed.w, o.fixed.h] : measure(); return layoutFor(w, h); };
  let cur = read();
  applyLayout(cur, body);
  let raf = 0;
  const update = (): LayoutState => {
    const next = read();
    if (!sameLayout(next, cur)) {
      const before = cur;
      cur = next;
      applyLayout(cur, body);
      for (const cb of [...listeners]) { try { cb(cur, before); } catch (e) { console.error(e); } }
    } else cur = next; // width / height drift without a class change: keep the numbers fresh, write nothing
    return cur;
  };
  const soon = (): void => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; update(); }); };
  const evs: Array<[EventTarget, string]> = [[window, 'resize'], [window, 'orientationchange'], [document, 'fullscreenchange']];
  if (window.visualViewport) evs.push([window.visualViewport, 'resize']);
  for (const [t, n] of evs) t.addEventListener(n, soon);
  return {
    current: () => cur,
    update,
    onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    dispose() {
      for (const [t, n] of evs) t.removeEventListener(n, soon);
      if (raf) cancelAnimationFrame(raf);
      listeners.clear();
    },
  };
}

/**
 * Keep ONE node in the right parent for the current layout (the Hoard button moves between the dock and the bottom row, UI.md 4.1).
 * `slots` maps a layout to its parent; a layout with no slot leaves the node where it is. Returns the unsubscribe.
 */
export function bindSlots(h: LayoutHandle, node: HTMLElement, slots: Partial<Record<LayoutId, HTMLElement>>, before?: Partial<Record<LayoutId, Node | null>>): () => void {
  const place = (s: LayoutState): void => {
    const parent = slots[s.layout];
    if (parent && node.parentElement !== parent) parent.insertBefore(node, before?.[s.layout] ?? null);
  };
  place(h.current());
  return h.onChange(place);
}
