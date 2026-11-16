// The toolbar (UI.md 4): the tools are ALWAYS visible as icon buttons in one dock, the active one clear, the options bar attached. It replaces
// the old tool tray and its button (the dock is the only place the tools live now). hudBinding.ts wires it into the HUD; the kit page shows it with mock data.
//
//   #wh-dock.dock                (DOM order = Tab order: Hoard, Tools, the options bar; CSS puts the attachment ABOVE the tray with column-reverse)
//     div.dock-bar                the tray
//       div[role=group "Collection"]   the Hoard button's parent in wide, stack and tiny (layout.ts bindHoard moves the node)
//       div[role=toolbar "Tools"]      button.dock-tool[data-tool][aria-pressed][aria-keyshortcuts] x N, then (when the game gives `gravity`) the Table | Float pair
//                                      div.dock-grav[role=group "Gravity"] > button.dock-grav-opt[data-grav][aria-pressed] x 2 (UI.md 1.8, the owner's call of 2026-10-09:
//                                      Table / Float lives HERE, not in Settings), then a trailing More; roving tabindex, ONE Tab stop
//     div.dock-attach             the ONE attachment (an options bar, later a shelf, the More popover) with a caret on its tool
//     p.dock-caption              the 1.4 s, aria-hidden tool-change chip (R10), out of flow
//
// The form (full | compact | bare) and where an attachment goes (above | inline) come from layout.ts `dockFor` (or the options, for the kit's
// fixed specimens). Names never change with the form: a compact tool hides its label visually, not from the accessibility tree.
//
// What gives way when the tray is too wide (fit(), in this order, each step only while the tray still overflows): the Hoard button drops its count (icon only,
// `.dock[data-hoard="icon"]`), the Table | Float pair moves behind More (a role=group of two menuitemradio items), then the tools from the end (the tool in hand never).
import './base.css';
import './kit.css';
import './a11y.css';
import './toolbar.css';
import { h } from './dom.ts';
import { icon } from './icons.ts';
import type { IconName } from './icons.ts';
import type { UiKind } from '../contracts.ts';
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

/** Table | Float (UI.md 1.8): the two faces of the gravity setting. `table` = gravity on (the game keeps a boolean: table = true). Words are the live line's and the tooltip's. */
export const GRAVITY_MODES = [
  { id: 'table', table: true, label: 'Table', icon: 'table', hint: 'Rests on the table', sound: 'on', line: 'Table' },
  { id: 'float', table: false, label: 'Float', icon: 'float', hint: 'Drifts in the air', sound: 'off', line: 'Floating' },
] as const satisfies ReadonlyArray<{ id: string; table: boolean; label: string; icon: IconName; hint: string; sound: UiKind; line: string }>;
export type GravityId = (typeof GRAVITY_MODES)[number]['id'];
export const GRAVITY_KEY = 'G';
export interface GravityOptions {
  /** true = Table (gravity on) */
  table: boolean;
  /** a Table or Float button was chosen (click, tap, Enter, Space). Like the tools it is CONTROLLED: the pair repaints only through setGravity() (the game's 'settings' event calls it). */
  onSet(table: boolean): void;
}

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
  /** the Table | Float pair next to the tools (omit it and the toolbar has none: the kit's older specimens) */
  gravity?: GravityOptions;
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
  /** tools that are busy or unavailable right now and WHY: `aria-disabled` + the reason (aria-describedby); null / {} = all enabled. The key `gravity` rests the Table | Float pair. */
  setDisabled(reasons: Readonly<Record<string, string>> | null): void;
  /** Table (true) or Float (false): aria-pressed on the pair and the checked item in More. No-op without a `gravity` option. */
  setGravity(table: boolean): void;
  /** null when the toolbar has no pair */
  readonly gravity: boolean | null;
  /** one half of the pair (null without a `gravity` option) */
  gravityButton(id: GravityId): HTMLButtonElement | null;
  /** the pair sits behind More right now (it did not fit) */
  readonly gravityInMore: boolean;
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
/** The room (px) an inline options bar keeps beside the tray (strip: the bar stands to the right of the tools). The widest bar in its tightest single row is Snap's, 311 px
 *  (optionsBar.ts: "568x320: Snap needs 311 px"); when the pair in the tray would leave less, the pair goes behind More while a bar is open. */
export const OPTS_ROOM = 320;
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
  let table = o.gravity?.table ?? true;
  let gravHidden = false;   // the pair is behind More (it did not fit)
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
  const el = h('div', { class: 'dock', attrs: { id: 'wh-dock', 'data-form': spec.form, 'data-attach': spec.attach, 'data-open': 'false', 'data-tool': current, 'data-hoard': 'full', 'data-gravity': o.gravity ? (table ? 'table' : 'float') : 'none' } }, bar, attachEl, caption, reasonBox);

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
  // ---- Table | Float: a group of two toggle buttons in the same toolbar (so the roving tabindex and the arrows walk it), after a separator ----
  const gravBtns = new Map<GravityId, HTMLButtonElement>();
  const gravSep = h('span', { class: 'dock-sep dock-grav-sep', attrs: { 'aria-hidden': 'true' } });
  const gravEl = h('div', { class: 'dock-grav', attrs: { role: 'group', 'aria-label': 'Gravity' } });
  if (o.gravity) {
    for (const m of GRAVITY_MODES) {
      const b = h('button', { class: 'k-btn k-tool dock-grav-opt', attrs: { type: 'button', 'data-grav': m.id, 'aria-pressed': 'false', 'aria-keyshortcuts': GRAVITY_KEY, tabindex: '-1' } },
        icon(m.icon), h('span', { class: 'k-btn-label k-tool-label dock-tool-label', text: m.label }));
      b.addEventListener('click', () => chooseGravity(m.table));
      gravBtns.set(m.id, b);
      gravEl.append(b);
      offs.push(attachTooltip(b, `${m.label} (${GRAVITY_KEY})`, { place: tipSide, when: () => el.dataset.form !== 'full' }).destroy);
    }
    gravEl.append(h('kbd', { class: 'k-kbd dock-kbd dock-grav-kbd', text: GRAVITY_KEY, attrs: { 'aria-hidden': 'true' } }));
    toolsEl.append(gravSep, gravEl);
  }
  const gravItems = (): HTMLButtonElement[] => [...gravBtns.values()];
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
    for (const m of GRAVITY_MODES) gravBtns.get(m.id)?.setAttribute('aria-pressed', String(m.table === table));
    if (o.gravity) el.dataset.gravity = table ? 'table' : 'float';
    roving();
  }
  /** Table or Float chosen (a button, or an item in More): a pair that rests says why; the face already showing does nothing */
  function chooseGravity(want: boolean): void {
    if (moreOpen) closeMore(false);
    if (reasons.gravity !== undefined) { o.onBlocked?.('gravity', reasons.gravity); return; }
    if (want === table) return;
    o.gravity?.onSet(want);
  }

  // ---- roving tabindex: ONE Tab stop; arrows, Home, End ----
  const items = (): HTMLButtonElement[] => [...buttons.values(), ...(gravHidden ? [] : gravItems()), moreBtn].filter((b) => !b.hidden);
  function roving(stop?: HTMLElement): void {
    const list = items();
    const cur = buttons.get(current);
    const active = (stop && list.includes(stop as HTMLButtonElement) ? stop : null) ?? (cur && !cur.hidden ? cur : list[0]);
    for (const b of list) b.tabIndex = b === active ? 0 : -1;
    for (const b of [...buttons.values(), ...gravItems()]) if (!list.includes(b)) b.tabIndex = -1;
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
    // the pair rests with its own key `gravity`; a press then says why (and, off the delegated sounds, makes the "not that" sound: kindOfControl reads `data-sound` first)
    const gwhy = reasons.gravity;
    for (const [id, b] of gravBtns) {
      if (gwhy === undefined) { b.removeAttribute('aria-disabled'); b.removeAttribute('aria-describedby'); b.dataset.sound = 'none'; continue; }
      const rid = ids(`why-grav-${id}`);
      reasonBox.append(h('span', { text: gwhy, attrs: { id: rid } }));
      b.setAttribute('aria-disabled', 'true');
      b.setAttribute('aria-describedby', rid);
      delete b.dataset.sound;
    }
    const shown = [...buttons].filter(([, b]) => !b.hidden);
    if (shown.length && shown.every(([id]) => isOff(id))) toolsEl.setAttribute('aria-disabled', 'true'); else toolsEl.removeAttribute('aria-disabled');
  }

  // ---- overflow: what does not fit gives way, in this order: the Hoard button's count, the Table | Float pair (behind a trailing More), then the tools from the end (the tool in hand never) ----
  /** one shape of the tray: the Hoard as an icon only (it drops its count), the pair in the tray or behind More */
  const SHAPES: ReadonlyArray<{ icon: boolean; pair: boolean }> = [{ icon: false, pair: true }, { icon: true, pair: true }, { icon: false, pair: false }, { icon: true, pair: false }];
  function fit(): void {
    // the tray is not drawn (tiny, an attachment open: the options bar or the More popover IS the row): nothing can be measured, so nothing changes; renderAttach() measures
    // again when the tray comes back. (Without this the open popover re-measured a 0-wide tray, found "nothing overflows" and closed itself.)
    if (el.isConnected && getComputedStyle(bar).display === 'none') { paint(); paintDisabled(); return; }
    // a control that holds focus is never hidden by a re-measure (display:none would blur it): it stays, the measure goes on without it
    const fo = document.activeElement;
    const setHidden = (b: HTMLElement, v: boolean): void => { if (b.hidden !== v && !(v && b === fo)) b.hidden = v; };
    for (const [id, b] of buttons) setHidden(b, !available.has(id));
    setHidden(moreBtn, true);
    overflow = [];
    gravHidden = false;
    const pairFocused = !!fo && gravEl.contains(fo);
    const showPair = (on: boolean): void => { gravEl.hidden = !on || !o.gravity; gravSep.hidden = gravEl.hidden; };
    showPair(!!o.gravity);
    el.dataset.hoard = 'full';
    const tooWide = (): boolean => toolsEl.scrollWidth > toolsEl.clientWidth + 1;
    /** strip: an options bar stands beside the tray and must keep OPTS_ROOM; the pair (not the tools) gives way for it */
    const cramped = (): boolean => {
      if (!base || el.dataset.attach !== 'inline') return false;
      const cs = getComputedStyle(el);
      return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - bar.offsetWidth - 8 < OPTS_ROOM;
    };
    if (el.isConnected && o.gravity && (tooWide() || cramped())) {
      // the Hoard icon-only is for the pair's sake (without a pair nothing changes); a shape that hides the pair is skipped while focus is in it
      for (const sh of SHAPES) {
        if (!sh.pair && pairFocused) continue;
        el.dataset.hoard = sh.icon ? 'icon' : 'full';
        showPair(sh.pair);
        setHidden(moreBtn, sh.pair);
        if (!tooWide() && !cramped()) break;
      }
      gravHidden = gravEl.hidden === true;
    }
    if (el.isConnected && (tooWide() || gravHidden)) {
      // still too wide, or the pair went behind More (which needs its button): the tools give way from the end, the tool in hand and the Hand never
      setHidden(moreBtn, false);
      const order = defs.map((d) => d.id).filter((id) => available.has(id));
      for (let k = order.length - 1; k >= 0 && tooWide(); k--) {
        const id = order[k];
        const b = buttons.get(id)!;
        if (id === current || id === 'hand' || b === fo) continue;
        b.hidden = true;
        overflow.unshift(id);
      }
      if (!overflow.length && !gravHidden) setHidden(moreBtn, true);
    }
    if (!overflow.length && !gravHidden && moreOpen) closeMore(false);
    // More is not needed (the pair came back, the room came back) but it may still hold focus, so the re-measure could not hide it: the focus goes to the tool in hand, then More goes
    if (!overflow.length && !gravHidden && !moreBtn.hidden) {
      if (document.activeElement === moreBtn) { const cur = buttons.get(current); (cur && !cur.hidden ? cur : items().find((b) => b !== moreBtn))?.focus(); }
      moreBtn.hidden = true;
    }
    if (moreOpen) renderMenu();
    paint();
    paintDisabled();
    // the neighbours' API (hud.css .nametag): the tray's REAL half width, so a long name or nickname ends 12 px before the tray at any width (the fixed 276 / 150 px of hud.css are the first-paint values)
    if (el.isConnected && bar.offsetWidth > 0) el.parentElement?.style.setProperty('--dk-half', `${Math.ceil(bar.offsetWidth / 2)}px`);
    positionAttach();
  }

  // ---- the More popover (an attachment of its own: it takes the slot while open, then gives it back) ----
  let over: { node: HTMLElement; forTool: string } | null = null;
  function renderMenu(): void {
    const ae = document.activeElement as HTMLElement | null;
    const held = ae && menu.contains(ae) ? (ae.dataset.tool ?? ae.dataset.grav) : undefined; // a re-measure must not drop the focus
    menu.replaceChildren();
    // an inline attachment (tiny, strip) is a ROW (toolbar.css): the tools in it are icon-only like the tray's (the name moves to aria-label, it never changes) and no key chips
    const row = el.dataset.attach === 'inline';
    for (const id of overflow) {
      const d = byId.get(id)!;
      const it = h('button', { class: 'k-btn dock-menuitem', attrs: { type: 'button', role: 'menuitemradio', 'aria-checked': String(id === current), 'data-tool': id, tabindex: '-1', ...(row ? { 'aria-label': d.label } : {}) } },
        icon(d.icon), row ? null : h('span', { class: 'k-btn-label', text: d.label }), row ? null : h('kbd', { class: 'k-kbd', text: d.chip, attrs: { 'aria-hidden': 'true' } }));
      if (isOff(id)) { it.setAttribute('aria-disabled', 'true'); it.title = reasons[id]; }
      it.addEventListener('click', () => { closeMore(true); choose(id); });
      menu.append(it);
    }
    // the pair that did not fit: its own role=group of two radios, set apart by a rule
    if (gravHidden) {
      const grp = h('div', { class: 'dock-menu-group', attrs: { role: 'group', 'aria-label': 'Gravity' } });
      for (const m of GRAVITY_MODES) {
        const it = h('button', { class: 'k-btn dock-menuitem', attrs: { type: 'button', role: 'menuitemradio', 'aria-checked': String(m.table === table), 'data-grav': m.id, 'aria-keyshortcuts': GRAVITY_KEY, tabindex: '-1' } },
          icon(m.icon), h('span', { class: 'k-btn-label', text: m.label }), row ? null : h('kbd', { class: 'k-kbd', text: GRAVITY_KEY, attrs: { 'aria-hidden': 'true' } }));
        if (reasons.gravity !== undefined) { it.setAttribute('aria-disabled', 'true'); it.title = reasons.gravity; }
        it.addEventListener('click', () => { closeMore(true); chooseGravity(m.table); });
        grp.append(it);
      }
      menu.append(grp);
    }
    if (held) [...menu.querySelectorAll<HTMLElement>('button')].find((b) => (b.dataset.tool ?? b.dataset.grav) === held)?.focus();
  }
  function openMore(): void {
    if (!overflow.length && !gravHidden) return;
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
    get gravity() { return o.gravity ? table : null; },
    get gravityInMore() { return gravHidden; },
    gravityButton: (id) => gravBtns.get(id) ?? null,
    setGravity(want) {
      if (!o.gravity || want === table) return;
      table = want;
      paint();
      if (moreOpen) renderMenu();
      const b = gravBtns.get(table ? 'table' : 'float');
      if (b && !b.hidden && !gravHidden) squash(b.querySelector('svg') ?? b, 0.9);
    },
    attach(node, forTool) {
      base = node ? { node, forTool: forTool ?? null } : null;
      renderAttach();
      if (o.gravity && el.dataset.attach === 'inline') fit();   // strip: a bar beside the tray wants room, the pair may have to step aside (or come back)
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
