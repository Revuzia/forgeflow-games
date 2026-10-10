// GENESIS — tiny DOM helpers shared by the UI panels (CONTRACT.md §16: plain DOM + CSS, no framework).
//
// `h()` builds an element with classes, attributes, text and children in one call; `fmt*` turn sim numbers into the
// short readable strings the panels show; `download()` hands the player a file (chronicle exports, saves).

export type Child = Node | string | number | null | undefined | false;

export interface HAttrs {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  type?: string;
  role?: string;
  aria?: Record<string, string>;
  data?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration> | string;
  on?: Partial<{ [K in keyof HTMLElementEventMap]: (ev: HTMLElementEventMap[K]) => void }>;
  [attr: string]: unknown;
}

const SKIP = new Set(['class', 'text', 'html', 'aria', 'data', 'style', 'on']);

/** create an element: h('button', { class: 'gn-btn', title: 'Pause', on: { click } }, 'text', child, ...) */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: HAttrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (attrs) {
    if (attrs.class) e.className = attrs.class;
    if (attrs.text !== undefined) e.textContent = attrs.text;
    if (attrs.html !== undefined) e.innerHTML = attrs.html;
    if (attrs.aria) for (const [k, v] of Object.entries(attrs.aria)) e.setAttribute(`aria-${k}`, v);
    if (attrs.data) for (const [k, v] of Object.entries(attrs.data)) e.dataset[k] = v;
    if (typeof attrs.style === 'string') e.setAttribute('style', attrs.style);
    else if (attrs.style) Object.assign(e.style, attrs.style);
    if (attrs.on) for (const [k, fn] of Object.entries(attrs.on)) if (fn) e.addEventListener(k, fn as EventListener);
    for (const [k, v] of Object.entries(attrs)) {
      if (SKIP.has(k) || v === undefined || v === null || v === false) continue;
      if (v === true) e.setAttribute(k, '');
      else e.setAttribute(k, String(v));
    }
    if (tag === 'button' && !attrs.type) (e as HTMLButtonElement).type = 'button';
  } else if (tag === 'button') (e as HTMLButtonElement).type = 'button';
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    e.append(typeof c === 'number' ? String(c) : c);
  }
  return e;
}

export function clear(e: Element): void {
  while (e.firstChild) e.removeChild(e.firstChild);
}

export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));
export const cap = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** a number for people to read: 3 significant figures, thousands as k / M */
export function fmtNum(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}G`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(v / 1e3).toFixed(a >= 1e5 ? 0 : 1)}k`;
  if (a >= 100 || Number.isInteger(v)) return v.toFixed(0);
  return Number(v.toPrecision(digits)).toString();
}

/** metres → "320 m" / "4.2 km" */
export function fmtDist(m: number): string {
  const a = Math.abs(m);
  if (a >= 10000) return `${(m / 1000).toFixed(0)} km`;
  if (a >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/** game ticks (minutes) → "45 min" / "6 h" / "3 days" (a day of `dayHours`) */
export function fmtTicks(t: number, dayHours = 24): string {
  if (t < 0) return 'forever';
  const day = dayHours * 60;
  if (t >= day * 2) return `${Number((t / day).toFixed(t >= day * 10 ? 0 : 1))} days`;
  if (t >= day) return `${Number((t / day).toFixed(1))} day${t === day ? '' : 's'}`;
  if (t >= 60) return `${Number((t / 60).toFixed(1))} h`;
  return `${Math.round(t)} min`;
}

/** unit vector → "12°N 34°W" */
export function fmtLatLon(u: ArrayLike<number>): string {
  const lat = (Math.asin(clamp(u[1], -1, 1)) * 180) / Math.PI;
  const lon = (Math.atan2(u[0], u[2]) * 180) / Math.PI;
  return `${Math.abs(lat).toFixed(0)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(0)}°${lon >= 0 ? 'E' : 'W'}`;
}

/** hand the player a file */
export function download(name: string, data: BlobPart, type = 'text/plain'): void {
  const blob = new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** is the event's target a text field (keys belong to it, not to the game) */
export function isTyping(e: Event): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || !t.tagName) return false;
  if (t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
  if (t.tagName === 'INPUT') {
    const ty = (t as HTMLInputElement).type;
    return ty === 'text' || ty === 'search' || ty === 'number' || ty === 'email' || ty === '' || ty === 'url';
  }
  return t.tagName === 'SELECT';
}

/** localStorage that never throws (private windows, blocked storage) */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : fallback;
    } catch { return fallback; }
  },
  set(key: string, v: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* storage unavailable: settings last for this session */ }
  },
};
