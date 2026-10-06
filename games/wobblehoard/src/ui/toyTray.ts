// The toy tray (FUN.md 1): one "Toys" button next to the Hoard button opens a small tray of tools. The Hand (poke, squish, stretch) is the
// default; Cut (CUT.md) and Snap (photo mode) are the live tools. Stamp and Roll are not built yet and are not shown (no "coming soon"
// clutter). The tray is a menu of radio items: the arrow keys move, Enter or Space picks, Escape (or Tab, or a tap outside) closes it, and
// focus goes back to the Toys button. T opens it from the keyboard (src/input/keyboard.ts, only with shortcuts on, never in a form control).
import { h } from './dom.ts';

export type ToolId = 'hand' | 'cut' | 'snap';

export interface ToolInfo { id: ToolId; label: string; hint: string }

export const TOOLS: readonly ToolInfo[] = [
  { id: 'hand', label: 'Hand', hint: 'Poke, squish, stretch' },
  { id: 'cut', label: 'Cut', hint: 'Swipe to slice it into pieces' },
  { id: 'snap', label: 'Snap', hint: 'Take a photo' },
];

export interface ToyTray {
  /** the HUD button ("Toys") */
  readonly button: HTMLButtonElement;
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  open(focusFirst?: boolean): void;
  close(returnFocus?: boolean): void;
  toggle(): void;
  /** the tool in hand (the tray marks it, the button shows its icon) */
  setTool(t: ToolId): void;
  /** which tools exist now (Cut only when the physics can cut) */
  setAvailable(ids: readonly ToolId[]): void;
  escape(): boolean;
  destroy(): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Small line icons (24 x 24, stroke = currentColor): a mitten hand, a blade, a camera. */
const PATHS: Record<ToolId | 'toys', string[]> = {
  hand: ['M8 12.5V6.8a1.6 1.6 0 0 1 3.2 0V11', 'M11.2 10.6V5.4a1.6 1.6 0 0 1 3.2 0v5.2', 'M14.4 10.8V6.6a1.6 1.6 0 0 1 3.2 0v6.6c0 4-2.6 6.8-6.2 6.8-2.6 0-4.1-1.3-5.4-3.4l-2-3.4a1.5 1.5 0 0 1 2.5-1.6L8 13'],
  cut: ['M5 19 15.5 8.5', 'M15.5 8.5l2.6-2.6a1.8 1.8 0 0 1 2.5 2.5L18 11', 'M5 19l3.6-.9', 'M9 15.4l2.2 2.2'],
  snap: ['M4 8.5h3l1.6-2.5h6.8L17 8.5h3v10H4z', 'M12 16.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z'],
  toys: ['M12 3.5l2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 15.9l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z'],
};
export function toolIcon(id: ToolId | 'toys', cls = 'icon tool-icon'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('class', cls); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  for (const d of PATHS[id]) { const p = document.createElementNS(SVG_NS, 'path'); p.setAttribute('d', d); svg.append(p); }
  return svg;
}

export function createToyTray(root: HTMLElement, o: { onPick(t: ToolId): void }): ToyTray {
  let tool: ToolId = 'hand';
  let available: ToolId[] = ['hand', 'snap'];
  let open = false;
  const btnIcon = h('span', { class: 'toys-btn-icon' }, toolIcon('toys'));
  const btnWord = h('span', { class: 'toys-btn-word', text: 'Toys' });
  const button = h('button', { class: 'toys-btn', attrs: { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'wh-toys', 'data-tool': 'hand' } }, btnIcon, btnWord);
  const list = h('div', { class: 'toys-list', attrs: { role: 'menu', 'aria-label': 'Toys' } });
  const el = h('div', { class: 'toys', attrs: { id: 'wh-toys', hidden: '' } }, h('p', { class: 'toys-title', text: 'Toys', attrs: { 'aria-hidden': 'true' } }), list);
  root.append(el);

  const items = (): HTMLButtonElement[] => [...list.querySelectorAll<HTMLButtonElement>('.toy')];
  function render(): void {
    list.textContent = '';
    for (const t of TOOLS) {
      if (!available.includes(t.id)) continue;
      const b = h('button', { class: 'toy', attrs: { type: 'button', role: 'menuitemradio', 'aria-checked': String(t.id === tool), 'data-tool': t.id, tabindex: '-1' } },
        toolIcon(t.id), h('span', { class: 'toy-text' }, h('span', { class: 'toy-label', text: t.label }), h('span', { class: 'toy-hint', text: t.hint })));
      b.addEventListener('click', () => pick(t.id));
      list.append(b);
    }
    btnIcon.replaceChildren(toolIcon(tool === 'hand' ? 'toys' : tool));
    button.dataset.tool = tool;
    button.setAttribute('aria-label', `Toys, ${TOOLS.find((x) => x.id === tool)?.label ?? 'Hand'} in hand`);
  }
  function pick(t: ToolId): void {
    tray.close(true);
    o.onPick(t);
  }
  list.addEventListener('keydown', (e) => {
    const its = items();
    const i = its.indexOf(document.activeElement as HTMLButtonElement);
    let n = -1;
    switch (e.key) {
      case 'ArrowDown': case 'ArrowRight': n = (i + 1) % its.length; break;
      case 'ArrowUp': case 'ArrowLeft': n = (i - 1 + its.length) % its.length; break;
      case 'Home': n = 0; break;
      case 'End': n = its.length - 1; break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); tray.close(true); return;
      case 'Tab': tray.close(false); return;
      case 'Enter': case ' ': e.preventDefault(); if (i >= 0) pick(its[i].dataset.tool as ToolId); return;
      default: return;
    }
    e.preventDefault();
    its[n]?.focus();
  });
  button.addEventListener('click', () => tray.toggle());
  const outside = (e: PointerEvent): void => { if (open && !el.contains(e.target as Node) && !button.contains(e.target as Node)) tray.close(false); };
  document.addEventListener('pointerdown', outside, true);

  const tray: ToyTray = {
    button, el,
    get isOpen() { return open; },
    open(focusFirst = true) {
      if (open) return;
      open = true;
      render();
      el.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      document.body.dataset.toys = 'open';
      const its = items();
      (its.find((b) => b.dataset.tool === tool) ?? its[0])?.focus(focusFirst ? undefined : { preventScroll: true });
    },
    close(returnFocus = true) {
      if (!open) return;
      open = false;
      el.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      delete document.body.dataset.toys;
      if (returnFocus) button.focus();
    },
    toggle() { if (open) tray.close(true); else tray.open(); },
    setTool(t) { tool = t; render(); },
    setAvailable(ids) { available = TOOLS.map((x) => x.id).filter((id) => ids.includes(id)); render(); },
    escape() { if (!open) return false; tray.close(true); return true; },
    destroy() { document.removeEventListener('pointerdown', outside, true); el.remove(); button.remove(); },
  };
  render();
  return tray;
}
