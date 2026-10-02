// Tiny DOM helpers. Text always goes through textContent (never innerHTML), so nothing from a URL or a name can inject markup.

export interface ElOpts {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: { [K in keyof HTMLElementEventMap]?: (e: HTMLElementEventMap[K]) => void };
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, o: ElOpts = {}, ...kids: Array<Node | string | null | undefined>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (o.class) el.className = o.class;
  if (o.text !== undefined) el.textContent = o.text;
  if (o.attrs) for (const [k, v] of Object.entries(o.attrs)) el.setAttribute(k, v);
  if (o.on) for (const [k, fn] of Object.entries(o.on)) el.addEventListener(k, fn as EventListener);
  for (const k of kids) if (k !== null && k !== undefined) el.append(k);
  return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Inline icons (24x24, stroke = currentColor). Original simple glyphs, no icon font. */
const ICONS: Record<string, string[]> = {
  // a cog: 8 chunky teeth around a ring, with a round hub
  gear: ['M18.47 10.69 L21.12 10.81 L21.12 13.19 L18.47 13.31 L17.50 15.65 L19.29 17.61 L17.61 19.29 L15.65 17.50 L13.31 18.47 L13.19 21.12 L10.81 21.12 L10.69 18.47 L8.35 17.50 L6.39 19.29 L4.71 17.61 L6.50 15.65 L5.53 13.31 L2.88 13.19 L2.88 10.81 L5.53 10.69 L6.50 8.35 L4.71 6.39 L6.39 4.71 L8.35 6.50 L10.69 5.53 L10.81 2.88 L13.19 2.88 L13.31 5.53 L15.65 6.50 L17.61 4.71 L19.29 6.39 L17.50 8.35Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z'],
  close: ['M6 6l12 12M18 6L6 18'],
  soundOn: ['M4.5 9.5h3.2L12 6v12l-4.3-3.5H4.5z', 'M15.2 9.3a3.6 3.6 0 0 1 0 5.4M17.6 7a7 7 0 0 1 0 10'],
  soundOff: ['M4.5 9.5h3.2L12 6v12l-4.3-3.5H4.5z', 'M15.5 9.5l5 5M20.5 9.5l-5 5'],
  table: ['M4 15h16', 'M7 15v4M17 15v4', 'M8.5 15c0-3 1.6-5.5 3.5-5.5s3.5 2.5 3.5 5.5'],
  float: ['M4 18.5h16', 'M8.5 13c0-3 1.6-5.5 3.5-5.5s3.5 2.5 3.5 5.5z', 'M9 16h6'],
};

export function icon(name: keyof typeof ICONS | string, cls = 'icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of ICONS[name] ?? []) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

export function prefersReducedMotion(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

export function isCoarsePointer(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches; } catch { return false; }
}
