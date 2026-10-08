// B0 Foundations page: tokens, icons, buttons (the full state matrix), controls, containers, layout. Components are NOT wired into screens
// yet (later batches do that); this page is where they are judged. Forced states (data-force) are painted by shoot.mjs.
import { h } from '../../../src/ui/dom.ts';
import { icon, ICON_NAMES } from '../../../src/ui/icons.ts';
import {
  COMPUTED, DERIVED, ELEV, JELLY, MEDALS, MEDAL_IDS, MOTION, PALETTE, RADII, TIERS, TIER_IDS, TYPE, contrastRatio,
} from '../../../src/ui/theme.ts';
import { KIT_SIZES, layoutFor } from '../../../src/ui/layout.ts';
import { bindSlots } from '../../../src/ui/layout.ts';
import { MOCK } from '../mock.ts';
import { button, card, chip, fieldError, modal, panel, progress, segmented, slider, switchRow, tierChip, tip, toast } from '../parts.ts';
import { cell, grid, sub } from './types.ts';
import type { KitSection } from './types.ts';

const C = MOCK.copy;

function swatch(name: string, cssVar: string, hex: string): HTMLElement {
  const cr = contrastRatio(PALETTE.cream, hex), ir = contrastRatio(PALETTE.ink, hex);
  const el = h('div', { class: 'kp-sw' }, h('b', { text: name }), h('span', { text: cr >= ir ? `cream ${cr.toFixed(1)}` : `ink ${ir.toFixed(1)}` }));
  el.style.setProperty('--sw', `var(${cssVar})`);
  el.style.color = cr >= ir ? `var(--wh-cream)` : `var(--wh-ink)`;
  return el;
}
const kebab = (s: string): string => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());

const tokens: KitSection = {
  id: 'tokens', title: 'Tokens: colour, type, shape, depth, motion',
  note: 'Numbers on swatches are the contrast of the better of cream / ink on that colour. All come from src/ui/theme.ts; there is no raw hex anywhere else.',
  build(host) {
    host.append(sub('Surfaces'));
    host.append(grid([
      swatch('ink', '--wh-ink', PALETTE.ink), swatch('felt', '--wh-felt', PALETTE.felt), swatch('panel', '--wh-panel', DERIVED.panel),
      swatch('surface2', '--wh-surface2', DERIVED.surface2), swatch('surface3', '--wh-surface3', DERIVED.surface3), swatch('track', '--wh-track', DERIVED.track),
      swatch('selTint', '--wh-sel-tint', COMPUTED.selTint), swatch('panelEdge', '--wh-panel-edge', DERIVED.panelEdge), swatch('edge', '--wh-edge', DERIVED.edge),
      swatch('creamDim', '--wh-cream-dim', DERIVED.creamDim), swatch('cream', '--wh-cream', PALETTE.cream),
    ]));
    host.append(sub('Gel, accents, states'));
    host.append(grid([
      swatch('gelHi', '--wh-gel-hi', DERIVED.gelHi), swatch('amber', '--wh-amber', PALETTE.amber), swatch('amberDeep', '--wh-amber-deep', DERIVED.amberDeep), swatch('lip', '--wh-lip', DERIVED.lip),
      swatch('coral', '--wh-coral', PALETTE.coral), swatch('danger', '--wh-danger', DERIVED.danger), swatch('ok', '--wh-ok', DERIVED.ok),
      swatch('lagoon', '--wh-lagoon', PALETTE.lagoon), swatch('plumBright', '--wh-plum-bright', DERIVED.plumBright),
    ]));
    host.append(sub('Rarity frames (6) and medals (4)'));
    host.append(grid([
      ...TIER_IDS.map((id) => swatch(id, `--wh-tier-${id}`, TIERS[id].frame)),
      ...MEDAL_IDS.map((id) => swatch(id, `--wh-medal-${id}`, MEDALS[id])),
    ]));
    host.append(sub('Jelly tones: top / body / shade (B2 paints the alphabet with these)'));
    const jelly: Node[] = [];
    for (const id of ['amber', 'cream', 'coral', 'lagoon', 'plum', 'rare', 'gold'] as const) {
      const s = JELLY[id];
      const row = h('div', { class: 'kp-stage' });
      for (const [k, v] of Object.entries(s)) {
        const el = h('div', { class: 'kp-sw' }, h('b', { text: `${id} ${k}` }), h('span', { text: v }));
        el.style.setProperty('--sw', v);
        el.style.flex = '1 1 80px';
        el.style.color = contrastRatio(PALETTE.cream, v) >= contrastRatio(PALETTE.ink, v) ? 'var(--wh-cream)' : 'var(--wh-ink)';
        row.append(el);
      }
      jelly.push(row);
    }
    host.append(grid(jelly, true));

    host.append(sub('Type scale (weights 600 / 800 only; tabular numerals)'));
    const type: Node[] = [];
    for (const [k, px] of Object.entries(TYPE)) {
      type.push(cell(`${k} ${px}px`, [h('p', { class: 'kp-spec', text: `Squish 0123 ${k === 'h1' ? '' : 'Keeper wobbles'}` })], { col: true }));
      (type[type.length - 1] as HTMLElement).querySelector('p')!.style.font = `800 var(--wh-fs-${k})/1.15 var(--wh-font-ui)`;
    }
    type.push(cell('body 600', [h('p', { class: 'kp-spec', text: 'Poke it, squash it, pull it, let go. 1,234 / 50' })], { col: true }));
    type.push(cell('long unbroken string (overflow-wrap: anywhere)', [h('p', { class: 'k-text', text: 'Supercalifragilisticexpialidocious_Wobblesworth_Squishington_' + MOCK.nick50.replaceAll(' ', '') })], { col: true }));
    host.append(grid(type, true));

    host.append(sub('Radii, elevation, motion'));
    const shape: Node[] = [];
    for (const [k, v] of Object.entries(RADII)) {
      const b = h('div', { class: 'kp-box', text: String(v) }); b.style.borderRadius = `var(--wh-r-${k})`; b.style.width = k === 'pill' ? '92px' : '56px';
      shape.push(cell(`r-${k}`, [b]));
    }
    for (const k of ['e1', 'e2', 'e3'] as const) {
      const b = h('div', { class: 'kp-box', text: k }); b.style.boxShadow = `var(--wh-${k})`; b.style.borderRadius = '14px';
      shape.push(cell(`${k}: ${ELEV[k]}`, [b], { tone: 'felt' }));
    }
    const dot = h('div', { class: 'kp-move' });
    const go = button({ kind: 'glass', label: 'Move', small: true });
    go.addEventListener('click', () => { dot.dataset.on = String(dot.dataset.on !== 'true'); });
    shape.push(cell(`move ${MOTION.t3} ms spring (Calm: ~0)`, [go, dot]));
    host.append(grid(shape));
  },
};

const icons: KitSection = {
  id: 'icons', title: `Icons: one family, ${ICON_NAMES.length} glyphs`,
  note: '24 grid, stroke 2, round caps and joins, currentColor. Shown at 24 px (real size) and 48 px (to judge the drawing).',
  build(host) {
    host.append(grid(ICON_NAMES.map((n) => h('div', { class: 'kp-ico' }, icon(n), h('span', { text: n })))));
    host.append(sub('Large (48 px) and filled variants'));
    host.append(grid(ICON_NAMES.map((n) => {
      const big = icon(n, 'k-icon', { size: 48 });
      big.style.width = '48px'; big.style.height = '48px';
      return h('div', { class: 'kp-ico' }, big, h('span', { text: n }));
    })));
    const f = (n: 'heart' | 'star' | 'play'): SVGSVGElement => icon(n, 'k-icon k-icon--lg', { fill: true });
    host.append(grid([cell('heart fill (hearted)', [f('heart')]), cell('heart outline', [icon('heart', 'k-icon k-icon--lg')]), cell('star fill', [f('star')]), cell('play fill', [f('play')])]));
  },
};

const buttons: KitSection = {
  id: 'buttons', title: 'Buttons: the full state matrix',
  note: 'Gel = primary (48, CTA 64). Glass family = secondary / icon / tool: OPAQUE surface2 + edge. States: rest, hover, focus, pressed, selected, disabled (reason), busy, error.',
  build(host) {
    host.append(sub('Gel (primary)'));
    host.append(grid([
      cell('rest', button({ kind: 'gel', label: C.takeThis })),
      cell('hover', button({ kind: 'gel', label: C.takeThis, force: 'hover' })),
      cell('focus-visible', button({ kind: 'gel', label: C.takeThis, force: 'focus-visible' })),
      cell('pressed', button({ kind: 'gel', label: C.takeThis, force: ['hover', 'active'] })),
      cell('disabled + reason', button({ kind: 'gel', label: C.takeThis, disabled: true, reason: C.reasonGift })),
      cell('busy', button({ kind: 'gel', label: C.takeThis, busy: true })),
      cell('with icon', button({ kind: 'gel', label: 'Save photo', icon: 'save' })),
      cell('long label wraps', button({ kind: 'gel', label: C.longLabel })),
    ], true));
    host.append(sub('CTA (64) and coral gel (destructive confirm; ink text, cream on coral is 2.76)'));
    host.append(grid([
      cell('CTA rest', button({ kind: 'cta', label: C.gel }), { tone: 'felt' }),
      cell('CTA hover', button({ kind: 'cta', label: C.gel, force: 'hover' }), { tone: 'felt' }),
      cell('CTA focus-visible', button({ kind: 'cta', label: C.gel, force: 'focus-visible' }), { tone: 'felt' }),
      cell('CTA busy (warming)', button({ kind: 'cta', label: C.gel, busy: true }), { tone: 'felt' }),
      cell('coral rest', button({ kind: 'coral', label: 'Tidy up' })),
      cell('coral pressed', button({ kind: 'coral', label: 'Tidy up', force: ['hover', 'active'] })),
      cell('coral disabled', button({ kind: 'coral', label: 'Tidy up', disabled: true })),
    ], true));
    host.append(sub('Glass family: secondary'));
    host.append(grid([
      cell('rest', button({ label: 'Settings', icon: 'gear' })),
      cell('hover', button({ label: 'Settings', icon: 'gear', force: 'hover' })),
      cell('focus-visible', button({ label: 'Settings', icon: 'gear', force: 'focus-visible' })),
      cell('pressed', button({ label: 'Settings', icon: 'gear', force: ['hover', 'active'] })),
      cell('selected (aria-pressed)', button({ label: 'Table', icon: 'table', pressed: true })),
      cell('selected + focus', button({ label: 'Table', icon: 'table', pressed: true, force: 'focus-visible' })),
      cell('disabled + reason', button({ label: 'Cut', icon: 'cut', disabled: true, reason: C.reasonCut })),
      cell('busy', button({ label: 'Saving', icon: 'save', busy: true })),
      cell('error (edge + icon + line)', button({ label: 'Save photo', icon: 'save', error: true })),
    ], true));
    host.append(sub('Glass family: icon buttons (44 x 44)'));
    host.append(grid([
      cell('rest', button({ kind: 'icon', icon: 'gear', name: 'Settings' })),
      cell('hover', button({ kind: 'icon', icon: 'soundOn', name: 'Mute sound', force: 'hover' })),
      cell('focus-visible', button({ kind: 'icon', icon: 'menu', name: 'Menu', force: 'focus-visible' })),
      cell('pressed', button({ kind: 'icon', icon: 'fullscreen', name: 'Full screen', force: ['hover', 'active'] })),
      cell('selected', button({ kind: 'icon', icon: 'fullscreenExit', name: 'Leave full screen', pressed: true })),
      cell('disabled', button({ kind: 'icon', icon: 'soundOff', name: 'Sound unavailable', disabled: true })),
      cell('busy', button({ kind: 'icon', icon: 'save', name: 'Saving', busy: true })),
      cell('on glass over white', button({ kind: 'icon', icon: 'close', name: 'Close', force: 'focus-visible' }), { tone: 'white' }),
    ], true));
    host.append(sub('Tools: icon + label + key chip (the dock composes these)'));
    host.append(grid([
      cell('selected (Hand)', button({ kind: 'tool', icon: 'hand', label: 'Hand', key: '1', pressed: true })),
      cell('rest (Cut)', button({ kind: 'tool', icon: 'cut', label: 'Cut', key: 'C', pressed: false })),
      cell('hover (Snap)', button({ kind: 'tool', icon: 'snap', label: 'Snap', key: 'S', pressed: false, force: 'hover' })),
      cell('focus (Cut)', button({ kind: 'tool', icon: 'cut', label: 'Cut', key: 'C', pressed: false, force: 'focus-visible' })),
      cell('disabled + reason', button({ kind: 'tool', icon: 'cut', label: 'Cut', key: 'C', pressed: false, disabled: true, reason: C.reasonCut })),
      cell('icon-only tools', [button({ kind: 'icon', icon: 'hand', name: 'Hand', pressed: true }), button({ kind: 'icon', icon: 'cut', name: 'Cut', pressed: false }), button({ kind: 'icon', icon: 'snap', name: 'Snap', pressed: false })]),
      cell('Cut options (labels from cutText)', [button({ kind: 'glass', icon: 'split', label: 'Split in two', small: true }), button({ kind: 'glass', icon: 'join', label: 'Reconnect all', small: true }), button({ kind: 'gel', label: 'Done', small: true })]),
    ], true));
    host.append(sub('Worst-case backdrops (focus ring = 3 px lagoon inside a 2 px ink halo)'));
    host.append(grid([
      cell('ring on white', button({ label: 'Menu', icon: 'menu', force: 'focus-visible' }), { tone: 'white' }),
      cell('ring on amber', button({ label: 'Menu', icon: 'menu', force: 'focus-visible' }), { tone: 'amber' }),
      cell('gel ring on white', button({ kind: 'gel', label: 'Resume', force: 'focus-visible' }), { tone: 'white' }),
      cell('ring on felt', button({ label: 'Menu', icon: 'menu', force: 'focus-visible' }), { tone: 'felt' }),
    ], true));
  },
};

const controls: KitSection = {
  id: 'controls', title: 'Controls: switch, slider, segmented, chip',
  note: 'Switch 56 x 32 with a tick when on. Slider: 10 px track, 28 px cream thumb. Segmented: native radios. Chip: 32 visual, 44 hit (pseudo-element).',
  build(host) {
    host.append(sub('Switch'));
    host.append(grid([
      cell('off', switchRow('Sound')),
      cell('on', switchRow('Sound', { checked: true })),
      cell('off, hover', switchRow('Haptics', { force: 'hover' })),
      cell('on, focus-visible', switchRow('Calm', { checked: true, force: 'focus-visible' })),
      cell('off, focus-visible', switchRow('Shake', { force: 'focus-visible' })),
      cell('disabled off', switchRow('Haptics', { disabled: true })),
      cell('disabled on', switchRow('Music', { checked: true, disabled: true })),
      cell('long label', switchRow('Skip animations and open capsules faster when I have seen them before', { checked: true })),
    ], true));
    host.append(sub('Slider'));
    host.append(grid([
      cell('0%', slider('Master', { value: 0 }), { col: true }),
      cell('50%', slider('Music', { value: 50 }), { col: true }),
      cell('100%', slider('Squish boost', { value: 100 }), { col: true }),
      cell('focus-visible', slider('Master', { value: 72, force: 'focus-visible' }), { col: true }),
      cell('disabled', slider('Music', { value: 40, disabled: true }), { col: true }),
    ], true));
    host.append(sub('Segmented'));
    host.append(grid([
      cell('Quality, 4-way', segmented('q1', 'Quality', MOCK.quality, { value: 'auto' }), { col: true }),
      cell('Gravity, 2-way with icons', segmented('g1', 'Gravity', MOCK.gravity, { value: 'table' }), { col: true }),
      cell('hover on Medium', segmented('q2', 'Quality', MOCK.quality, { value: 'auto', force: { value: 'med', f: 'hover' } }), { col: true }),
      cell('focus-visible on High', segmented('q3', 'Quality', MOCK.quality, { value: 'high', force: { value: 'high', f: 'focus-visible' } }), { col: true }),
      cell('disabled', segmented('q4', 'Quality', MOCK.quality, { value: 'low', disabled: true }), { col: true }),
    ], true));
    host.append(sub('Chips'));
    host.append(grid([
      cell('rest', chip('All', { n: MOCK.hoard.have })),
      cell('selected', chip('Uncommon', { pressed: true, n: 3 })),
      cell('hover', chip('Rare', { pressed: false, n: 2, force: 'hover' })),
      cell('focus-visible', chip('Epic', { pressed: false, n: 1, force: 'focus-visible' })),
      cell('pressed', chip('Epic', { pressed: false, force: ['hover', 'active'] })),
      cell('disabled', chip('Mythic', { pressed: false, n: 0, disabled: true })),
      cell('with icon', chip('Hearted', { icon: 'heart', pressed: false })),
      cell('error', chip('Name', { error: true })),
    ]));
    host.append(sub('Chip row at 12 px row gap (hit areas must not overlap: 32 + 12 = 44)'));
    host.append(h('div', { class: 'k-chips' }, ...MOCK.rarities.map(([id, label], i) => chip(label, { pressed: i === 1, n: 6 - i }))));
    host.append(sub('Tier chips and tier icons (always a gem and a word)'));
    host.append(h('div', { class: 'k-chips' }, ...MOCK.rarities.map(([id, label]) => tierChip(id, label, 'star')), ...MOCK.medals.map(([id, label]) => tierChip(id, label, 'trophy'))));
  },
};

const containers: KitSection = {
  id: 'containers', title: 'Containers: card, panel, sheet, modal, tooltip, toast',
  note: 'Panels are solid. Glass (translucent + blur) is used on the toast here; the cap is 4 glass containers on screen. Backdrop strips below show the worst cases.',
  build(host) {
    host.append(sub('Cards'));
    host.append(grid([
      cell('card', card({ title: 'Squish', text: 'Press and hold anywhere on your squishy. It squishes back.', icon: 'hand' }), { col: true }),
      cell('hero card', card({ title: 'Daily gift', text: 'One free squishy a day.', icon: 'gift', hero: true }, button({ kind: 'gel', label: C.takeThis, small: true })), { col: true }),
      cell('selectable', card({ title: 'Wrigglo', text: MOCK.longName, icon: 'star', selectable: true, selected: false }), { col: true }),
      cell('selected', card({ title: 'Wrigglo', text: '14 owned', icon: 'star', selectable: true, selected: true }), { col: true }),
      cell('focus-visible', card({ title: 'Wrigglo', text: '14 owned', icon: 'star', selectable: true, selected: false, force: 'focus-visible' }), { col: true }),
      cell('tier frame (3 px tier + 2 px ink) + chip', card({ title: MOCK.squishy.name, text: MOCK.squishy.species, tier: 'epic' }, tierChip('epic', 'Epic')), { col: true }),
    ], true));

    host.append(sub('Panel (card form), sheet form, with a Settings-like body'));
    const body = (): Node[] => [
      h('p', { class: 'k-group-title', text: 'Sound' }),
      slider('Master', { value: 80 }), slider('Music', { value: 45 }), switchRow('UI sounds', { checked: true }),
      h('p', { class: 'k-group-title', text: 'Feel' }),
      segmented(`pq-${Math.random().toString(36).slice(2, 6)}`, 'Quality', MOCK.quality, { value: 'auto' }), switchRow('Haptics', { checked: true }),
    ];
    host.append(grid([
      cell('card form', panel('Settings', body()), { col: true }),
      cell('sheet form (stack): grip, rounded top', panel('Settings', body(), { form: 'sheet' }), { col: true }),
    ], 'panel'));

    host.append(sub('Modal on scrim (focus trap, Esc and the 250 ms input arm are B4)'));
    host.append(grid([
      cell('confirm', modal(C.modalTitle, C.modalText, [button({ kind: 'glass', label: 'Not now' }), button({ kind: 'gel', label: 'Tidy up' })]), { frame: true }),
      cell('danger (alertdialog)', modal('Start over?', 'This clears your squishies in this browser. Hold the button to confirm.', [button({ kind: 'glass', label: 'Keep playing' }), button({ kind: 'coral', label: 'Hold to clear' })], true), { frame: true }),
    ], true));

    host.append(sub('Tooltip (450 ms on a fine pointer, instant on focus, none on touch: B3/B4 logic; here the bubble)'));
    host.append(grid([
      cell('above', [h('div', { class: 'kp-stack' }, tip(C.tooltip, 'above'), button({ kind: 'icon', icon: 'cut', name: 'Cut' }))]),
      cell('below', [h('div', { class: 'kp-stack' }, button({ kind: 'icon', icon: 'gear', name: 'Settings' }), tip('Settings', 'below'))]),
    ]));
    // tips are positioned absolutely in the app; here they flow so the caret is visible
    for (const t of host.querySelectorAll<HTMLElement>('.k-tip')) { t.style.position = 'relative'; }

    host.append(sub('Toasts (glass container; icon + text, never colour alone)'));
    host.append(grid([
      cell('info', toast('info', C.toastInfo)),
      cell('success', toast('success', C.toastOk)),
      cell('warning (offline)', toast('warning', C.toastWarn)),
      cell('error', toast('error', C.toastErr)),
      cell('trophy + tier chip', toast('trophy', C.toastTrophy, C.toastTrophySub, tierChip('bronze', 'Bronze', 'trophy'))),
      cell('glass over white (worst case)', toast('info', C.toastInfo), { tone: 'white' }),
      cell('glass over amber', toast('success', C.toastOk), { tone: 'amber' }),
      cell('long name wraps', toast('trophy', MOCK.nick50, 'Named your squishy. +20 XP')),
    ], true));

    host.append(sub('Progress, field error, busy dots, key chips'));
    host.append(grid([
      cell('progress 0%', progress(0, 'Boot'), { col: true }),
      cell('progress 40%', progress(0.4, 'Today'), { col: true }),
      cell('progress 100%', progress(1, 'Merge'), { col: true }),
      cell('field error', fieldError('Pick a name first.'), { col: true }),
      cell('keys', [h('kbd', { class: 'k-kbd', text: 'C' }), h('kbd', { class: 'k-kbd', text: 'Esc' }), h('kbd', { class: 'k-kbd', text: '1' })]),
      cell('link', [h('a', { class: 'k-link', text: 'How to play', attrs: { href: '#how' } }), h('a', { class: 'k-link', text: 'Credits (focus)', attrs: { href: '#c', 'data-force': 'focus-visible' } })]),
    ]));
  },
};

const layout: KitSection = {
  id: 'layout', title: 'Layout classes (body[data-layout])',
  note: 'layout.ts decides; CSS only reads body[data-layout|data-density|data-tall]. The 8 kit sizes of UI.md 4.1 and what the classifier says for each. The slot demo moves ONE node between a dock and a bottom row as the layout changes (the Hoard button, B3a).',
  build(host, ctx) {
    const now = layoutFor(window.innerWidth, window.innerHeight);
    const rows = KIT_SIZES.map((s) => {
      const got = layoutFor(s.w, s.h);
      const here = s.w === window.innerWidth && s.h === window.innerHeight;
      return h('tr', { attrs: { 'data-now': String(here) } },
        h('td', { text: `${s.w} x ${s.h}` }), h('td', { text: s.note }), h('td', { text: `${got.layout}${got.short ? ' short' : ''}${got.tall ? ' tall' : ''}` }), h('td', { text: got.layout === s.layout ? 'ok' : `EXPECTED ${s.layout}` }));
    });
    host.append(h('p', { class: 'k-text', text: `This viewport: ${window.innerWidth} x ${window.innerHeight} -> ${now.layout}${now.short ? ' (short)' : ''}${now.tall ? ' (tall)' : ''}` }));
    host.append(h('div', { class: 'kp-stage kp-stage--col' }, h('table', { class: 'kp-table' }, h('thead', {}, h('tr', {}, h('th', { text: 'size' }), h('th', { text: 'what' }), h('th', { text: 'class' }), h('th', { text: 'check' }))), h('tbody', {}, ...rows))));
    // slot demo
    const dockSlot = h('div', { class: 'kp-slot', text: 'dock (wide, stack)' });
    const rowSlot = h('div', { class: 'kp-slot', text: 'bottom row (strip, tiny)' });
    const hoard = button({ kind: 'glass', icon: 'hoard', label: `Hoard ${MOCK.hoard.have}/${MOCK.hoard.of}` }) as HTMLElement;
    host.append(h('div', { class: 'kp-stage kp-stage--col' }, dockSlot, rowSlot));
    bindSlots(ctx.layout, hoard, { wide: dockSlot, stack: dockSlot, strip: rowSlot, tiny: rowSlot });
  },
};

export function b0Sections(): KitSection[] { return [tokens, icons, buttons, controls, containers, layout]; }
