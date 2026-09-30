// HIT PARADE - tiny DOM helpers shared by the UI modules (lane UI).

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function div(cls: string, parent?: HTMLElement, text?: string): HTMLDivElement {
  const d = el('div', cls, text);
  if (parent) parent.append(d);
  return d;
}

/** a focusable menu button carrying [data-nav] (the spatial-focus machinery walks these) */
export function btn(cls: string, text = '', nav = true): HTMLButtonElement {
  const b = el('button', cls, text);
  b.type = 'button';
  if (nav) b.dataset.nav = '';
  return b;
}

export function svg(html: string, cls = 'hp-ico'): HTMLSpanElement {
  const s = el('span', cls);
  s.innerHTML = html;
  s.setAttribute('aria-hidden', 'true');
  return s;
}

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** set text only when it changed (per-frame HUD writes) */
export function setText(e: HTMLElement, s: string): void { if (e.textContent !== s) e.textContent = s; }

/** a one-shot Web Animation; never throws (old engines / hidden tabs) */
export function pulse(e: Element | null, frames: Keyframe[], ms: number, easing = 'ease-out'): Animation | null {
  if (!e) return null;
  try { return e.animate(frames, { duration: ms, easing }); } catch { return null; }
}

// ─────────────────────────── global UI flags (settings -> every module) ───────────────────────────
let reduceFlashing = false;
export function setReduceFlashing(on: boolean): void { reduceFlashing = on; document.documentElement.classList.toggle('hp-noflash', on); }
export function flashesReduced(): boolean {
  if (reduceFlashing) return true;
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** CONTRACT_MOBILE M1: touch mode is the class `hp-touch` on <html> (input.ts owns it; ?touch=1 pins it) */
export function touchModeOn(): boolean {
  const h = document.documentElement;
  if (h.classList.contains('hp-touch')) return true;
  if (h.classList.contains('hp-kbm')) return false;
  try {
    const q = new URLSearchParams(location.search).get('touch');
    if (q === '1') return true;
    if (q === '0') return false;
    return matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  } catch { return false; }
}

/** follow html.hp-touch / hp-kbm changes; returns an unsubscribe */
export function watchTouchMode(fn: (on: boolean) => void): () => void {
  let last = touchModeOn();
  const mo = new MutationObserver(() => { const on = touchModeOn(); if (on !== last) { last = on; fn(on); } });
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => mo.disconnect();
}

// ─────────────────────────── glyphs ───────────────────────────
export const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5 8 12l7 7" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.9 6 6.6.8-4.9 4.6 1.3 6.5L12 17.3l-5.9 3.2 1.3-6.5-4.9-4.6 6.6-.8z" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="4.5" y="10.5" width="15" height="10.5" rx="2" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="8.5" y="2.5" width="7" height="12" rx="3.5" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v4M8.5 21.5h7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  pad: '<svg viewBox="0 0 24 24"><path d="M7 7h10a5 5 0 0 1 4.9 6l-.9 4.2a2.6 2.6 0 0 1-4.5 1.2L14.3 16H9.7l-2.2 2.4A2.6 2.6 0 0 1 3 17.2L2.1 13A5 5 0 0 1 7 7z" fill="currentColor"/><path d="M7.5 10v4M5.5 12h4" stroke="#0b0b10" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="10.8" r="1.2" fill="#0b0b10"/><circle cx="18" cy="13" r="1.2" fill="#0b0b10"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/><rect x="13.8" y="5" width="4.2" height="14" rx="1.2" fill="currentColor"/></svg>',
  dice: '<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="3.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="8.5" cy="8.5" r="1.7" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.7" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.7" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.7" fill="currentColor"/><circle cx="12" cy="12" r="1.7" fill="currentColor"/></svg>',
  fs: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  wifi: '<svg viewBox="0 0 24 24"><path d="M2.5 9a14 14 0 0 1 19 0M5.8 12.6a9 9 0 0 1 12.4 0M9.2 16.2a4 4 0 0 1 5.6 0" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="19.5" r="1.8" fill="currentColor"/></svg>',
} as const;

/**
 * Direction glyph for numpad notation (1-9, 5 = neutral). Rendered as SVG so it never depends on the display fonts'
 * arrow coverage (the Latin subsets have no arrows).
 */
export function dirSvg(d: number): string {
  if (d === 5 || d < 1 || d > 9) return '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="currentColor"/></svg>';
  const ang: Record<number, number> = { 6: 0, 9: -45, 8: -90, 7: -135, 4: 180, 1: 135, 2: 90, 3: 45 };
  const a = ang[d] ?? 0;
  return `<svg viewBox="0 0 24 24"><g transform="rotate(${a} 12 12)"><path d="M4 12h12" stroke="currentColor" stroke-width="3.6" stroke-linecap="round"/><path d="M12.5 6.5 19 12l-6.5 5.5z" fill="currentColor"/></g></svg>`;
}

/** a button chip (L / M / H / S / PARRY ...) for notation rows */
export function chip(text: string, cls = ''): HTMLElement {
  const c = el('span', `hp-chip ${cls}`.trim(), text);
  c.dataset.b = text.toLowerCase();
  return c;
}
