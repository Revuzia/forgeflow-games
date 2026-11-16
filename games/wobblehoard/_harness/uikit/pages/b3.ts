// B3a page: THE TOOLBAR (UI.md 4). Two kinds of section.
//  * `toolbar-parts`: the dock as a component, in its three forms (full | compact | bare), every state (rest, hover, focus, pressed, selected, disabled with
//    a reason, ceremony), the Hoard button inside it, the attachment with its caret, the More popover (five tools in a narrow tray), the caption chip and a
//    held tooltip. Fixed forms, so one page shows all of them whatever the viewport is.
//    (2026-10-09: the Table | Float pair beside the tools, its forms, states, the Hoard giving its count away and the pair behind More: the owner moved the control from Settings to the toolbar.)
//  * `scene-rest` / `scene-cut` / `scene-snap`: the real layout at THE VIEWPORT'S SIZE (the 8 kit sizes): a mock HUD as 4.2 draws it (top row, hint, name
//    plate, ring + Open, the squishy's band) around the REAL toolbar, which follows layout.ts like the game will. The mock pieces are the kit page's own
//    (kitpage.css); B3b / B3c replace them with the real HUD. Options bars are mocks too (B3b builds the real ones).
import { h } from '../../../src/ui/dom.ts';
import { icon } from '../../../src/ui/icons.ts';
import { bindHoard } from '../../../src/ui/layout.ts';
import { jelly } from '../../../src/ui/jelly/jelly.ts';
import '../../../src/ui/jelly/jelly.css';
import { TOOLS, createToolbar } from '../../../src/ui/toolbar.ts';
import type { Toolbar, ToolDef, ToolId } from '../../../src/ui/toolbar.ts';
import { MOCK } from '../mock.ts';
import { button } from '../parts.ts';
import { realCut, realSnap } from '../bars.ts';
import { createMeterRing } from '../../../src/ui/meterRing.ts';
import { createQuickSwitch } from '../../../src/ui/quickSwitch.ts';
import { HINT_TEXT } from '../../../src/ui/hint.ts';
import { cell, sub } from './types.ts';
import type { KitSection } from './types.ts';

const C = MOCK.copy;

// ---------- mock pieces ----------
/** The Hoard button exactly as ui/hoard/panel.ts builds it (class names, children, aria-label), so the dock's overrides are tested on the real contract. */
export function mockHoard(o: { count?: string; dot?: boolean; open?: boolean } = {}): HTMLButtonElement {
  const glyph = icon('hoard', 'icon hoard-glyph');
  const b = h('button', { class: 'hoard-btn', attrs: { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': String(!!o.open), 'aria-label': `Hoard, ${MOCK.hoard.have} of ${MOCK.hoard.of} species` } },
    glyph, h('span', { class: 'hoard-btn-text' }, h('span', { class: 'hoard-btn-word', text: 'Hoard' }), h('span', { class: 'hoard-btn-count', text: o.count ?? `${MOCK.hoard.have}/${MOCK.hoard.of}` })),
    h('span', { class: 'hoard-btn-dot', attrs: { 'aria-hidden': 'true' } }));
  if (o.dot) b.dataset.dot = 'true';
  return b;
}

/** the toolbar holds a node that does not carry `hidden` (toolbar.ts attach) */
const unhide = <T extends HTMLElement>(e: T): T => { e.hidden = false; return e; };

const EXTRA_TOOLS: ToolDef[] = [
  ...TOOLS,
  { id: 'stamp', label: 'Stamp', hint: 'Press a mark into it', icon: 'stamp', chip: '4', keys: '4' },
  { id: 'roll', label: 'Roll', hint: 'Roll it about', icon: 'roll', chip: '5', keys: '5' },
];

/** A fixed-form dock for the component sheet (not following the viewport). */
export function specimen(form: 'full' | 'compact' | 'bare', o: { tool?: string; tools?: ToolDef[]; hoard?: HTMLButtonElement | false; attach?: 'above' | 'inline'; disabled?: Record<string, string>; width?: number; gravity?: boolean; floating?: boolean } = {}): { host: HTMLElement; tb: Toolbar } {
  let tb!: Toolbar;
  tb = createToolbar({ form, attach: o.attach ?? 'above', tools: o.tools, onTool: (id) => tb.setTool(id), onBlocked: () => {}, ...(o.gravity ? { gravity: { table: !o.floating, onSet: (t: boolean) => tb.setGravity(t) } } : {}) });
  const host = h('div', { class: form === 'full' ? 'kp-dockhost kp-dockhost--full' : 'kp-dockhost' }, tb.el);
  if (o.width) host.style.width = `${o.width}px`;
  if (o.hoard !== false) { const hb = o.hoard ?? mockHoard(); tb.group.append(hb); tb.adoptHoard(hb); }
  if (o.tool) tb.setTool(o.tool);
  if (o.disabled) tb.setDisabled(o.disabled);
  const w = window as unknown as { __kitSpecimens?: Toolbar[] };
  (w.__kitSpecimens ??= []).push(tb);
  return { host, tb };
}

// ---------- the component sheet ----------
const parts: KitSection = {
  id: 'toolbar-parts', title: 'Toolbar: the dock in its forms and states',
  note: 'form full = wide (icon + label + key chip, 64 high); compact = icon only (52); bare = tiny (no tray, 44). Tools are the kit\'s OPAQUE glass-family buttons; the tray and the attachment are the only glass. States are forced through the DevTools protocol.',
  build(host) {
    // forms
    host.append(sub('Forms (Hoard in the Collection group, then Hand / Cut / Snap)'));
    const f1 = specimen('full'), f2 = specimen('compact', { tool: 'cut' }), f3 = specimen('bare', { tool: 'snap' });
    host.append(
      cell('full (wide 1280): Hand selected', f1.host),
      cell('compact (stack, wide-short): Cut selected', f2.host),
      cell('bare (tiny 358x201): Snap selected, no tray', f3.host));
    host.append(sub('On the worst-case grounds (white, amber)'));
    const w1 = specimen('full'), w2 = specimen('compact', { tool: 'cut' });
    host.append(cell('full on white', w1.host, { tone: 'white' }), cell('compact on amber', w2.host, { tone: 'amber' }));

    // states
    host.append(sub('States (full form)'));
    const st = (label: string, f: (tb: Toolbar) => void, o: Parameters<typeof specimen>[1] = {}): HTMLElement => { const s = specimen('full', o); f(s.tb); return cell(label, s.host); };
    host.append(
      st('rest + selected (Hand)', () => {}),
      st('hover (Cut)', (tb) => tb.button('cut')!.setAttribute('data-force', 'hover')),
      st('focus-visible (Cut)', (tb) => tb.button('cut')!.setAttribute('data-force', 'focus-visible')),
      st('pressed (Snap)', (tb) => tb.button('snap')!.setAttribute('data-force', 'hover active')),
      st('Cut selected, Snap focused', (tb) => tb.button('snap')!.setAttribute('data-force', 'focus-visible'), { tool: 'cut' }),
      st('Cut unavailable: disabled + reason', () => {}, { disabled: { cut: C.reasonCut } }),
      st('ceremony: every tool disabled (dock aria-disabled)', () => {}, { disabled: { hand: 'A capsule is opening.', cut: 'A capsule is opening.', snap: 'A capsule is opening.' } }),
      st('Hoard open (aria-expanded) + new dot', () => {}, { hoard: mockHoard({ open: true, dot: true }) }));

    // attachment + caret
    host.append(sub('The attachment: ONE slot above the dock, the caret on its tool'));
    const a1 = specimen('full', { tool: 'cut' });
    a1.tb.attach(unhide(realCut(h('div'), { pieces: 1, show: false }).bar.el), 'cut'); // the REAL bars (cutBar.ts, snapBar.ts), each fitting the room its slot has
    const a2 = specimen('compact', { tool: 'snap' });
    a2.tb.attach(unhide(realSnap(h('div'), { show: false }).el), 'snap');
    host.append(cell('Cut: the options bar, caret on Cut', a1.host), cell('Snap: caret on Snap (the bar slides to stay over it)', a2.host));

    // More
    host.append(sub('More: five tools in a 260 px tray (Stamp and Roll are hidden components until the features exist)'));
    const m1 = specimen('compact', { tools: EXTRA_TOOLS, width: 260 });
    const m2 = specimen('compact', { tools: EXTRA_TOOLS, width: 260, tool: 'roll' });
    host.append(cell('overflow: Snap, Stamp and Roll go behind More', m1.host), cell('the tool in hand never hides (Roll in hand stays beside Hand)', m2.host));
    const m3 = specimen('compact', { tools: EXTRA_TOOLS, width: 260 });
    queueMicrotask(() => requestAnimationFrame(() => { m3.tb.fit(); m3.tb.el.querySelector<HTMLElement>('.dock-more')?.click(); }));
    host.append(cell('More open: the popover takes the slot, caret on More', m3.host));

    // Table | Float (UI.md 1.8)
    host.append(sub('Table | Float: the pair beside the tools (one key, G; the selected face has the amber ring; the game keeps the setting)'));
    const g1 = specimen('full', { gravity: true }), g2 = specimen('compact', { gravity: true, floating: true, tool: 'cut' }), g3 = specimen('bare', { gravity: true, width: 330 });
    host.append(
      cell('full: Table selected (icon + word, one G chip)', g1.host),
      cell('compact: Float selected, Cut in hand (icon only)', g2.host),
      cell('bare 330 px (the Hoard is an icon already)', g3.host));
    const gst = (label: string, f: (tb: Toolbar) => void, o: Parameters<typeof specimen>[1] = {}): HTMLElement => { const x = specimen('full', { gravity: true, ...o }); f(x.tb); return cell(label, x.host); };
    host.append(
      gst('hover (Float)', (tb) => tb.gravityButton('float')!.setAttribute('data-force', 'hover')),
      gst('focus-visible (Table)', (tb) => tb.gravityButton('table')!.setAttribute('data-force', 'focus-visible')),
      gst('pressed (Float)', (tb) => tb.gravityButton('float')!.setAttribute('data-force', 'hover active')),
      gst('ceremony: the pair rests, with its reason', () => {}, { disabled: { hand: 'A capsule is opening.', cut: 'A capsule is opening.', snap: 'A capsule is opening.', gravity: 'A capsule is opening.' } }));
    host.append(sub('When the tray is too narrow: the Hoard gives its count away first, then the pair goes behind More (a group of two radios)'));
    const n1 = specimen('compact', { gravity: true, width: 338 }), n2 = specimen('compact', { gravity: true, width: 296 }), n3 = specimen('compact', { gravity: true, width: 296, floating: true });
    // (opening More focuses its first item: give the focus back to whoever had it, so the More sheet above keeps its own open popover and its focus for the harness)
    queueMicrotask(() => requestAnimationFrame(() => {
      n3.tb.fit();
      const prev = document.activeElement as HTMLElement | null;
      n3.tb.el.querySelector<HTMLElement>('.dock-more')?.click();
      if (prev && prev !== document.body) prev.focus(); else (document.activeElement as HTMLElement | null)?.blur();
    }));
    host.append(cell('338 px: the Hoard is an icon, the pair stays', n1.host), cell('296 px: the pair is behind More', n2.host), cell('296 px, More open (Float selected): the popover takes the slot', n3.host));

    // caption + tooltip
    host.append(sub('Caption chip (1.4 s in the game; held here) and the tooltip (450 ms hover, instant on focus; held here)'));
    const c1 = specimen('compact', { tool: 'cut' });
    c1.tb.showCaption('Cut', 'Swipe to slice it into pieces', Infinity);
    c1.host.classList.add('kp-dockhost--caption');
    const t1 = specimen('compact', { tool: 'hand' });
    t1.host.classList.add('kp-dockhost--tip');
    // a STATIC tip (the same .k-tip tooltip.ts draws, placed in the host): the live one is fixed-position and belongs to the viewport, not to a sheet
    queueMicrotask(() => requestAnimationFrame(() => {
      const b = t1.tb.button('cut')!;
      const tipEl = h('div', { class: 'k-tip', attrs: { role: 'tooltip', 'data-place': 'above' } }, h('span', { text: 'Cut (C)' }));
      tipEl.style.position = 'absolute';
      t1.host.append(tipEl);
      const r = b.getBoundingClientRect(), hr = t1.host.getBoundingClientRect();
      tipEl.style.left = `${Math.round(r.left - hr.left + r.width / 2 - tipEl.offsetWidth / 2)}px`;
      tipEl.style.top = `${Math.round(r.top - hr.top - tipEl.offsetHeight - 10)}px`;
      tipEl.style.setProperty('--tip-ax', `${Math.round(tipEl.offsetWidth / 2)}px`);
    }));
    host.append(cell('caption chip above the dock', c1.host), cell('tooltip over Cut (K16: hoverable, Esc dismisses, persistent)', t1.host));
  },
};

// ---------- the scenes: the real layout at the viewport's size ----------
function bandFor(w: number, hgt: number): { top: number; bottom: number } {
  if (w <= 420 && hgt <= 260) return { top: 50, bottom: 150 };               // tiny
  if (w > hgt && hgt <= 440) return { top: 64, bottom: hgt - 76 };          // strip
  if (w <= 819) return hgt >= 700 ? { top: 170, bottom: hgt - 190 } : { top: 150, bottom: hgt - 178 }; // stack
  return hgt <= 560 ? { top: 60, bottom: 378 } : { top: 70, bottom: hgt - 140 }; // wide (short: the portal box)
}

function scene(id: string, title: string, note: string, tool: ToolId, o: { caption?: boolean; cut?: Parameters<typeof realCut>[1] } = {}): KitSection {
  return {
    id, title, note, bleed: true,
    build(host, ctx) {
      const w = innerWidth, hgt = innerHeight;
      const band = bandFor(w, hgt);
      const d = Math.round(Math.min(band.bottom - band.top, w * 0.8) * 0.82);
      const stage = h('div', { class: 'kp-scene', attrs: { 'data-tool': tool } });
      stage.style.height = `${hgt}px`;
      const blob = h('div', { class: 'kp-blob' });
      blob.style.width = blob.style.height = `${d}px`;
      blob.style.left = `${Math.round(w / 2 - d / 2)}px`;
      blob.style.top = `${Math.round((band.top + band.bottom) / 2 - d / 2)}px`;
      stage.append(blob);

      // top row (mock): brand on wide, FS / Snd / Menu everywhere (FS only >= 700 in strip)
      const brand = jelly('SQUISH KEEPER', { size: 'sm', tone: 'amber', tag: 'div' });
      brand.classList.add('kp-brand');
      const top = h('div', { class: 'kp-top' },
        h('div', { class: 'kp-brand-slot' }, brand),
        h('div', { class: 'kp-top-btns' },
          h('span', { class: 'kp-fs' }, button({ kind: 'icon', icon: 'fullscreen', name: 'Full screen', pressed: false })),
          button({ kind: 'icon', icon: 'soundOn', name: 'Mute sound', pressed: false }),
          button({ kind: 'icon', icon: 'menu', name: 'Menu' })));
      stage.append(top);
      // the REAL hint pill (hint.ts text, hud.css skin); the sheet only places it
      stage.append(h('p', { class: 'hint kp-hint', text: HINT_TEXT.touch, attrs: { 'data-show': 'true' } }));

      // info row (mock): name plate + ring + Open
      const plate = h('div', { class: 'kp-plate k-glass' }, h('b', { text: MOCK.squishy.species }), h('span', { text: MOCK.squishy.tierLabel }));
      // the REAL ring + Open (meterRing.ts): a capsule waiting, so the ring glows and Open shows (UI.md 6)
      const ringbox = h('div', { class: 'kp-ringbox k-glass' });
      createMeterRing(ringbox, { onOpen: () => {} }).set({ fill: 0.62, credits: 1, resting: false, doneToday: false, tableFull: false, offline: false });
      const rowHoard = h('div', { class: 'kp-row-hoard' });
      const info = h('div', { class: 'kp-info' }, plate, rowHoard, ringbox);
      stage.append(info);

      // the real toolbar, following layout.ts
      const w2 = window as unknown as { __kitBlocked?: string[]; __kitToolbar?: Toolbar };
      const tb: Toolbar = createToolbar({ layout: ctx.layout, root: stage, onTool: (next) => select(next), onBlocked: (_id, why) => { (w2.__kitBlocked ??= []).push(why); }, gravity: { table: true, onSet: (t) => tb.setGravity(t) } });
      const hoard = mockHoard();
      tb.adoptHoard(hoard);
      bindHoard(ctx.layout, hoard, { dock: tb.group, row: rowHoard }, null);
      // the REAL quick switcher (quickSwitch.ts): the row above the plate on wide and tall stack; the fold at the top left on a short stack; none in strip and tiny
      const qs = createQuickSwitch(stage, () => {});
      qs.set(MOCK.switch);
      const select = (next: ToolId): void => {
        tb.setTool(next);
        stage.dataset.tool = next;
        attachFor(next);
        if (next !== 'hand') { const t = TOOLS.find((x) => x.id === next)!; tb.showCaption(t.label, t.hint); } else tb.hideCaption();
      };
      const attachFor = (next: ToolId): void => {
        stage.dataset.attach = next === 'hand' ? 'false' : 'true';
        const node = next === 'cut' ? cutKit.bar.el : next === 'snap' ? snapBar.el : null;
        if (node) node.hidden = false;   // (the node must not carry `hidden` when the toolbar holds it)
        tb.attach(node, next);
      };
      // the REAL options bars on a stub Cutter (bars.ts); the second Cut scene has the squishy already cut, so the locked style control and the limit show
      const cutKit = realCut(stage, { ...(o.cut ?? {}), show: false });
      const snapBar = realSnap(stage, { show: false });
      host.append(stage);
      tb.setTool(tool);
      attachFor(tool);
      if (o.caption && tool !== 'hand') { const t = TOOLS.find((x) => x.id === tool)!; tb.showCaption(t.label, t.hint, Infinity); }
      ctx.layout.onChange(() => attachFor(tb.tool as ToolId));
      requestAnimationFrame(() => { tb.fit(); });
      w2.__kitToolbar = tb;
    },
  };
}

const sceneRest = scene('scene-rest', 'Scene: the Hand in hand (rest)', 'The real layout at this viewport\'s size: mock HUD around the real toolbar. Hoard sits in the dock (wide, stack, tiny) or the bottom row (strip).', 'hand');
const sceneCut = scene('scene-cut', 'Scene: Cut in hand (options bar attached, caption chip held)', 'Wide and stack: the bar above the dock with its caret on Cut (stack: it replaces the info row); strip: inline to the right of the tools; tiny: it takes the Hoard button\'s and the ring\'s room.', 'cut', { caption: true });
const sceneCut2 = scene('scene-cut-2', 'Scene: Cut in hand, the squishy already cut (limit reached, style locked)', 'Two pieces: Split in two is off (the limit), Reconnect all is ready, the style control is locked with a lock mark and the plain reason. The Undo cut button appears once the Cutter offers it.', 'cut', { cut: { pieces: 2, undo: true, style: 'minis' } });
const sceneSnap = scene('scene-snap', 'Scene: Snap in hand (options bar attached)', 'Snap hides the brand, name plate, ring, hint and switcher in the game (B3c); the sheet keeps them so the fit is visible.', 'snap');

export function b3Sections(): KitSection[] { return [parts, sceneRest, sceneCut, sceneCut2, sceneSnap]; }
