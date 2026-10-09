// The toolbar (UI.md 4): the tools are ALWAYS visible as icon buttons in one dock, the active one clear, the options bar attached. It replaces
// the old tool tray and its button (the dock is the only place the tools live now). hudBinding.ts wires it into the HUD; the kit page shows it with mock data.
//
//   #wh-dock.dock                (DOM order = Tab order: Hoard, Tools, the options bar; CSS puts the attachment ABOVE the tray with column-reverse)
//     div.dock-bar                the tray
//       div[role=group "Collection"]   the Hoard button's parent in wide, stack and tiny (layout.ts bindHoard moves the node)
//       div[role=toolbar "Tools"]      button.dock-tool[data-tool][aria-pressed][aria-keyshortcuts] x N, roving tabindex, ONE Tab stop; a trailing More
//     div.dock-attach             the ONE attachment (an options bar, later a shelf, the More popover) with a caret on its tool
//     p.dock-caption              the 1.4 s, aria-hidden tool-change chip (R10), out of flow
//
// The form (full | compact | bare) and where an attachment goes (above | inline) come from layout.ts `dockFor` (or the options, for the kit's
// fixed specimens). Names never change with the form: a compact tool hides its label visually, not from the accessibility tree.
import './base.css';
import './kit.css';
import './a11y.css';
import './toolbar.css';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';
import { dockFor } from './layout.ts';
import type { DockForm, DockSpec, LayoutHandle } from './layout.ts';
import { squash } from './motion.ts';
import { attachTooltip } from './tooltip.ts';

export type ToolId = 'hand' | 'cut' | 'snap';

export interface ToolDef {
  /** `hand` | `cut` | `snap` live; the kit page adds `stamp` / `roll` to show the overflow (hidden components until the features exist) */
  id: string;
  label: string;
  /** the one-line meaning, shown in the 1.4 s caption chip */
  hint: string;
  icon: IconName;
  /** the key chip */
  chip: string;
  /** aria-keyshortcuts */
  keys: string;
}

/** Hand (1, Esc), Cut (2, C), Snap (3, S): UI.md 4.3. Wording is the old tray's. */
export const TOOLS: readonly ToolDef[] = [
  { id: 'hand', label: 'Hand', hint: 'Poke, squish, stretch', icon: 'hand', chip: '1', keys: '1 Escape' },
  { id: 'cut', label: 'Cut', hint: 'Swipe to slice it into pieces', icon: 'cut', chip: 'C', keys: '2 C' },
  { id: 'snap', label: 'Snap', hint: 'Take a photo', icon: 'snap', chip: 'S', keys: '3 S' },
];

export interface ToolbarOptions {
  /** a tool was chosen by click, tap, Enter or Space; the active Cut or Snap pressed again arrives as `hand`. The toolbar is CONTROLLED: it changes
   *  its own selection only through setTool() (the game's 'tool' event calls it). */
  onTool(id: ToolId): void;
  /** a disabled tool was pressed: say why (hudBinding sends it to the live region) */
  onBlocked?(id: string, reason: string): void;
  /** follow the viewport layout (the game); without it the dock keeps `form` / `attach` (the kit's fixed specimens) */
  layout?: LayoutHandle;
  form?: DockForm;
  attach?: 'above' | 'inline';
  tools?: readonly ToolDef[];
  /** the root the dock is appended to (the HUD); omit to build it detached (the kit page places it) */
  root?: HTMLElement;
}

export interface Toolbar {
  /** #wh-dock */
  readonly el: HTMLElement;
  readonly bar: HTMLElement;
  /** the Collection group: the Hoard button's parent in the dock */
  readonly group: HTMLElement;
  /** role=toolbar */
  readonly toolsEl: HTMLElement;
  readonly caption: HTMLElement;
  readonly tool: string;
  button(id: string): HTMLButtonElement | null;
  /** the tool in hand (aria-pressed, the caret, the roving stop) */
  setTool(id: string): void;
  /** which tools exist now (Cut only when the physics can cut); the rest are not drawn */
  setAvailable(ids: readonly string[]): void;
  /** tools that are busy or unavailable right now and WHY: `aria-disabled` + the reason (aria-describedby); null / {} = all enabled */
  setDisabled(reasons: Readonly<Record<string, string>> | null): void;
  /** put ONE node in the attachment slot, caret on `forTool` (default: the tool in hand); null empties it */
  attach(node: HTMLElement | null, forTool?: string): void;
  readonly attached: boolean;
  /** the 1.4 s aria-hidden chip above the dock; `ms` Infinity holds it (the kit sheet) */
  showCaption(label: string, hint?: string, ms?: number): void;
  hideCaption(): void;
  /** focus a tool's button (default: the one in hand) */
  focusTool(id?: string): void;
  /** the Hoard button joins the dock: kit classes, a tooltip, its key (H). The node itself stays B5's. */
  adoptHoard(node: HTMLElement): void;
  /** Escape, the toolbar's part: closes the More popover. True when it did. */
  escape(): boolean;
  /** re-measure now (fonts arrived, the form changed, a container was resized) */
  fit(): void;
  /** the tools drawn in the More popover, in order */
  overflowed(): string[];
  destroy(): void;
}

export const CAPTION_MS = 1400;
const ids = (n: string): string => `wh-dock-${n}`;

export function createToolbar(o: ToolbarOptions): Toolbar {
  const defs = [...(o.tools ?? TOOLS)];
  const byId = new Map(defs.map((d) => [d.id, d] as const));
  const buttons = new Map<string, HTMLButtonElement>();
  let current = 'hand';
  const available = new Set(defs.map((d) => d.id));
  let reasons: Record<string, string> = {};
  let overflow: string[] = [];
  let moreOpen = false;
  let base: { node: HTMLElement; forTool: string | null } | null = null;
  const form0: DockForm = o.form ?? 'full';
  let spec: DockSpec = o.layout ? dockFor(o.layout.current()) : { form: form0, attach: o.attach ?? 'above', hoard: 'dock', labels: form0 === 'full' };
  const offs: Array<() => void> = [];

  // ---- DOM ----
  const caption = h('p', { class: 'dock-caption k-glass', attrs: { 'aria-hidden': 'true', 'data-show': 'false' } });
  const slot = h('div', { class: 'dock-attach-slot' });
  const caretEl = h('i', { class: 'dock-caret', attrs: { 'aria-hidden': 'true' } });
  const attachBody = h('div', { class: 'dock-attach-body k-glass' }, slot, caretEl);
  const attachEl = h('div', { class: 'dock-attach', attrs: { hidden: '' } }, attachBody);
  const group = h('div', { class: 'dock-group', attrs: { role: 'group', 'aria-label': 'Collection' } });
  const sep = h('span', { class: 'dock-sep', attrs: { 'aria-hidden': 'true' } });
  const toolsEl = h('div', { class: 'dock-tools', attrs: { role: 'toolbar', 'aria-label': 'Tools', 'aria-orientation': 'horizontal' } });
  const bar = h('div', { class: 'dock-bar k-glass' }, group, sep, toolsEl);
  const reasonBox = h('div', { class: 'sr-only' });
  const el = h('div', { class: 'dock', attrs: { id: 'wh-dock', 'data-form': spec.form, 'data-attach': spec.attach, 'data-open': 'false', 'data-tool': current } }, bar, attachEl, caption, reasonBox);

  /** the strip dock sits at the top of the screen: its tips open downwards */
  const tipSide = (): 'above' | 'below' => (el.dataset.attach === 'inline' && el.dataset.form === 'compact' ? 'below' : 'above');
  for (const d of defs) {
    const b = h('button', { class: 'k-btn k-tool dock-tool', attrs: { type: 'button', 'data-tool': d.id, 'aria-pressed': 'false', 'aria-keyshortcuts': d.keys, tabindex: '-1' } },
      icon(d.icon), h('span', { class: 'k-btn-label k-tool-label dock-tool-label', text: d.label }), h('kbd', { class: 'k-kbd dock-kbd', text: d.chip, attrs: { 'aria-hidden': 'true' } }));
    b.addEventListener('click', () => choose(d.id));
    buttons.set(d.id, b);
    toolsEl.append(b);
    offs.push(attachTooltip(b, () => `${d.label} (${d.chip})`, { place: tipSide, when: () => el.dataset.form !== 'full' }).destroy);
  }
  const moreBtn = h('button', { class: 'k-btn k-tool dock-tool dock-more', attrs: { type: 'button', 'data-tool': 'more', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': ids('menu'), tabindex: '-1', hidden: '' } },
    icon('more'), h('span', { class: 'k-btn-label k-tool-label dock-tool-label', text: 'More' }));
  moreBtn.addEventListener('click', () => { if (moreOpen) closeMore(false); else openMore(); });
  toolsEl.append(moreBtn);
  offs.push(attachTooltip(moreBtn, 'More tools', { place: tipSide, when: () => el.dataset.form !== 'full' }).destroy);
  const menu = h('div', { class: 'dock-menu', attrs: { id: ids('menu'), role: 'menu', 'aria-label': 'More tools' } });

  // ---- selection ----
  const isOff = (id: string): boolean => reasons[id] !== undefined;
  function choose(id: string): void {
    if (moreOpen) closeMore(false);
    if (isOff(id)) { o.onBlocked?.(id, reasons[id]); return; }
    const next = id !== 'hand' && id === current ? 'hand' : id; // the active Cut or Snap pressed again returns the Hand
    if (next === current) return;
    o.onTool(next as ToolId);
  }
  function paint(): void {
    for (const [id, b] of buttons) b.setAttribute('aria-pressed', String(id === current));
    el.dataset.tool = current;
    roving();
  }

  // ---- roving tabindex: ONE Tab stop; arrows, Home, End ----
  const items = (): HTMLButtonElement[] => [...buttons.values(), moreBtn].filter((b) => !b.hidden);
  function roving(stop?: HTMLElement): void {
    const list = items();
    const cur = buttons.get(current);
    const active = (stop && list.includes(stop as HTMLButtonElement) ? stop : null) ?? (cur && !cur.hidden ? cur : list[0]);
    for (const b of list) b.tabIndex = b === active ? 0 : -1;
    for (const b of buttons.values()) if (b.hidden) b.tabIndex = -1;
  }
  toolsEl.addEventListener('focusin', (e) => roving(e.target as HTMLElement));
  toolsEl.addEventListener('focusout', (e) => { if (!toolsEl.contains(e.relatedTarget as Node | null)) roving(); });
  toolsEl.addEventListener('keydown', (e) => {
    const list = items();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    let n = -1;
    switch (e.key) {
      case 'ArrowRight': case 'ArrowDown': n = (i + 1) % list.length; break;
      case 'ArrowLeft': case 'ArrowUp': n = (i - 1 + list.length) % list.length; break;
      case 'Home': n = 0; break;
      case 'End': n = list.length - 1; break;
      default: return;
    }
    e.preventDefault();
    list[n].focus();
  });

  // ---- availability, disabled + reason ----
  function paintDisabled(): void {
    reasonBox.replaceChildren();
    for (const [id, b] of buttons) {
      const why = reasons[id];
      if (why === undefined) { b.removeAttribute('aria-disabled'); b.removeAttribute('aria-describedby'); continue; }
      const rid = ids(`why-${id}`);
      reasonBox.append(h('span', { text: why, attrs: { id: rid } }));
      b.setAttribute('aria-disabled', 'true');
      b.setAttribute('aria-describedby', rid);
    }
    const shown = [...buttons].filter(([, b]) => !b.hidden);
    if (shown.length && shown.every(([id]) => isOff(id))) toolsEl.setAttribute('aria-disabled', 'true'); else toolsEl.removeAttribute('aria-disabled');
  }

  // ---- overflow: what does not fit goes behind a trailing More (the tool in hand never does) ----
  function fit(): void {
    // a control that holds focus is never hidden by a re-measure (display:none would blur it): it stays, the measure goes on without it
    const fo = document.activeElement;
    const setHidden = (b: HTMLElement, v: boolean): void => { if (b.hidden !== v && !(v && b === fo)) b.hidden = v; };
    for (const [id, b] of buttons) setHidden(b, !available.has(id));
    setHidden(moreBtn, true);
    overflow = [];
    const tooWide = (): boolean => toolsEl.scrollWidth > toolsEl.clientWidth + 1;
    if (el.isConnected && tooWide()) {
      setHidden(moreBtn, false);
      const order = defs.map((d) => d.id).filter((id) => available.has(id));
      for (let k = order.length - 1; k >= 0 && tooWide(); k--) {
        const id = order[k];
        const b = buttons.get(id)!;
        if (id === current || id === 'hand' || b === fo) continue;
        b.hidden = true;
        overflow.unshift(id);
      }
      if (!overflow.length) setHidden(moreBtn, true);
    }
    if (!overflow.length && moreOpen) closeMore(false);
    if (moreOpen) renderMenu();
    paint();
    paintDisabled();
    positionAttach();
  }

  // ---- the More popover (an attachment of its own: it takes the slot while open, then gives it back) ----
  let over: { node: HTMLElement; forTool: string } | null = null;
  function renderMenu(): void {
    const held = menu.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset.tool : undefined; // a re-measure must not drop the focus
    menu.replaceChildren();
    for (const id of overflow) {
      const d = byId.get(id)!;
      const it = h('button', { class: 'k-btn dock-menuitem', attrs: { type: 'button', role: 'menuitemradio', 'aria-checked': String(id === current), 'data-tool': id, tabindex: '-1' } },
        icon(d.icon), h('span', { class: 'k-btn-label', text: d.label }), h('kbd', { class: 'k-kbd', text: d.chip, attrs: { 'aria-hidden': 'true' } }));
      if (isOff(id)) { it.setAttribute('aria-disabled', 'true'); it.title = reasons[id]; }
      it.addEventListener('click', () => { closeMore(true); choose(id); });
      menu.append(it);
    }
    if (held) [...menu.querySelectorAll<HTMLElement>('button')].find((b) => b.dataset.tool === held)?.focus();
  }
  function openMore(): void {
    if (!overflow.length) return;
    moreOpen = true;
    renderMenu();
    over = { node: menu, forTool: 'more' };
    moreBtn.setAttribute('aria-expanded', 'true');
    renderAttach();
    (menu.querySelector<HTMLElement>('[aria-checked="true"]') ?? menu.querySelector<HTMLElement>('button'))?.focus();
  }
  function closeMore(returnFocus: boolean): void {
    if (!moreOpen) return;
    moreOpen = false;
    over = null;
    moreBtn.setAttribute('aria-expanded', 'false');
    renderAttach();
    if (returnFocus) moreBtn.focus();
  }
  menu.addEventListener('keydown', (e) => {
    const list = [...menu.querySelectorAll<HTMLElement>('button')];
    const i = list.indexOf(document.activeElement as HTMLElement);
    let n = -1;
    switch (e.key) {
      case 'ArrowDown': n = (i + 1) % list.length; break;
      case 'ArrowUp': n = (i - 1 + list.length) % list.length; break;
      case 'Home': n = 0; break;
      case 'End': n = list.length - 1; break;
      case 'Escape': e.preventDefault(); e.stopPropagation(); closeMore(true); return;
      case 'Tab': closeMore(false); return;
      default: return;
    }
    e.preventDefault();
    list[n]?.focus();
  });
  const outside = (e: PointerEvent): void => { if (moreOpen && !menu.contains(e.target as Node) && !moreBtn.contains(e.target as Node)) closeMore(false); };
  document.addEventListener('pointerdown', outside, true);

  // ---- the attachment slot and its caret ----
  function renderAttach(): void {
    const a = over ?? base;
    const inBar = bar.contains(document.activeElement), inAttach = attachEl.contains(document.activeElement);
    slot.replaceChildren();
    if (!a) {
      attachEl.hidden = true;
      el.dataset.open = 'false';
      if (inAttach) { requestAnimationFrame(fit); api.focusTool('hand'); } // the bar the focus was in is gone: back to the Hand (UI.md 9.1)
      else if (el.dataset.form === 'bare') requestAnimationFrame(fit);   // the tray was hidden under an inline bar: measure it again
      return;
    }
    slot.append(a.node);
    attachEl.hidden = false;
    el.dataset.open = 'true';
    positionAttach();
    // tiny: the tray steps aside for the bar; focus that was in the tray goes to the bar's first control
    if (inBar && getComputedStyle(bar).display === 'none') (a.node.querySelector<HTMLElement>('button, [tabindex], input') ?? null)?.focus();
  }
  /** Centre the attachment on its tool (clamped inside the viewport) and aim the caret at it. Inline attachments (strip, tiny) have neither. */
  function positionAttach(): void {
    const a = over ?? base;
    if (!a || attachEl.hidden || el.dataset.attach !== 'above') return;
    const target = a.forTool === 'more' ? moreBtn : buttons.get(a.forTool ?? current);
    if (!target || target.hidden) return;
    // geometry that ignores the body's own (animated) transform: the slot centres it in .dock-attach
    const pr = attachEl.getBoundingClientRect(), t = target.getBoundingClientRect();
    const w = attachBody.offsetWidth;
    if (!w || !t.width) return;
    const box = el.getBoundingClientRect(); // the HUD's width in the game; a specimen's own box on the kit sheet
    const margin = 12;
    const left0 = pr.left + (pr.width - w) / 2;
    const tx = t.left + t.width / 2;
    const dx = Math.max(box.left + margin - left0, Math.min(box.right - margin - (left0 + w), tx - (left0 + w / 2)));
    attachBody.style.setProperty('--dk-ax', `${Math.round(dx)}px`);
    attachBody.style.setProperty('--dk-cx', `${Math.round(Math.max(20, Math.min(w - 20, tx - (left0 + dx))))}px`);
  }

  // ---- the caption chip ----
  let capTimer = 0;
  function hideCaption(): void { if (capTimer) { clearTimeout(capTimer); capTimer = 0; } caption.dataset.show = 'false'; }

  // ---- layout ----
  function applySpec(): void {
    if (o.layout) spec = dockFor(o.layout.current());
    el.dataset.form = spec.form;
    el.dataset.attach = spec.attach;
  }
  if (o.layout) offs.push(o.layout.onChange(() => { applySpec(); closeMore(false); requestAnimationFrame(fit); }));
  let ro: ResizeObserver | null = null;
  let raf = 0;
  const soon = (): void => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; fit(); }); };
  if (typeof ResizeObserver === 'function') { ro = new ResizeObserver(soon); ro.observe(el); }
  void document.fonts?.ready.then(soon);

  const api: Toolbar = {
    el, bar, group, toolsEl, caption,
    get tool() { return current; },
    get attached() { return !attachEl.hidden; },
    button: (id) => buttons.get(id) ?? null,
    setTool(id) {
      if (!byId.has(id) || id === current) { paint(); return; }
      current = id;
      if (overflow.includes(id)) fit(); else paint();
      const b = buttons.get(id);
      if (b && !b.hidden) squash(b.querySelector('svg') ?? b, 0.9);
      positionAttach();
    },
    setAvailable(list) {
      available.clear();
      for (const id of list) if (byId.has(id)) available.add(id);
      available.add('hand');
      fit();
    },
    setDisabled(map) {
      reasons = { ...(map ?? {}) };
      paintDisabled();
      if (moreOpen) renderMenu();
    },
    attach(node, forTool) {
      base = node ? { node, forTool: forTool ?? null } : null;
      renderAttach();
    },
    showCaption(label, hint, ms = CAPTION_MS) {
      caption.replaceChildren(h('b', { text: label }));
      if (hint) caption.append(h('span', { text: hint }));
      caption.dataset.show = 'true';
      if (capTimer) clearTimeout(capTimer);
      capTimer = 0;
      if (Number.isFinite(ms)) capTimer = window.setTimeout(hideCaption, ms);
    },
    hideCaption,
    focusTool(id) { (buttons.get(id ?? current) ?? items()[0])?.focus(); },
    adoptHoard(node) {
      node.classList.add('k-btn', 'dock-hoard');
      if (!node.hasAttribute('aria-keyshortcuts')) node.setAttribute('aria-keyshortcuts', 'H');
      offs.push(attachTooltip(node, 'Hoard (H)', { place: tipSide, when: () => el.dataset.form !== 'full' }).destroy);
    },
    escape() { if (!moreOpen) return false; closeMore(true); return true; },
    fit,
    overflowed: () => [...overflow],
    destroy() {
      for (const f of offs) f();
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      hideCaption();
      document.removeEventListener('pointerdown', outside, true);
      el.remove();
    },
  };

  if (o.root) o.root.append(el);
  roving();
  fit();
  return api;
}
