// B5 page: THE HOARD FAMILY (UI.md 6). Two kinds of section.
//  * `hoard-parts`: the pieces in fixed forms, every state: tier gems with their words, the double-rim plinth by tier, the hold-to-merge label (rest, 55 % filled, disabled,
//    busy), result / tidy rows incl. the long-name row that broke one letter per line, the reveal plates (static), copy tags.
//  * `hoard-*`, `merge-*`, `tidy-*`, `plate-*`: THE REAL Hoard UI (src/ui/hoard/*) over a REAL seeded Collection (hoardMock.ts) in a scene at exactly the viewport's size
//    (the 8 kit sizes), so a sheet shows what the game shows. Only the HoardEnv seams to the live squishy / ceremonies / play mat are inert.
import { h } from '../../../src/ui/dom.ts';
import { gemSvg } from '../../../src/ui/gem.ts';
import { createHoldButton } from '../../../src/ui/hoard/hold.ts';
import { icon } from '../../../src/ui/icons.ts';
import { jelly } from '../../../src/ui/jelly/jelly.ts';
import '../../../src/ui/jelly/jelly.css';
import '../../../src/ui/hoard.css';
import { speciesIcon } from '../../../src/ui/speciesIcon.ts';
import { SPECIES_BY_TIER } from '../../../src/data/catalog.ts';
import { createRevealPlate } from '../../../src/ui/revealPlate.ts';
import type { RevealPlateInfo } from '../../../src/ui/revealPlate.ts';
import { TIER_NAMES } from '../../../src/core/rarity.ts';
import { MOCK } from '../mock.ts';
import { makeKitHoard } from '../hoardMock.ts';
import type { KitHoard, KitHoardOpts } from '../hoardMock.ts';
import { cell, sub } from './types.ts';
import type { KitSection } from './types.ts';
import '../b5.css';

type Tier = (typeof MOCK.rarities)[number][0];
const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T => root.querySelector<T>(sel) as T;
const click = (root: ParentNode, sel: string): void => { q(root, sel)?.click(); };

// ---------- the parts sheet ----------
const parts: KitSection = {
  id: 'hoard-parts', title: 'B5 parts: gems, tier frames, the hold-to-merge label, result rows, reveal plates',
  note: 'Rarity is a gem SHAPE + the tier word + a double-rim frame (3 px of the tier colour, 2 px of ink): never colour alone. The hold button label is a dual layer (cream on the track, ink on amber, clipped to the fill).',
  build(host) {
    host.append(sub('Tier gems with their words (the gem shape is never named in copy)'));
    const gems = h('div', { class: 'k-cluster' });
    for (const [t, label] of MOCK.rarities) gems.append(h('span', { class: 'k-tier', attrs: { 'data-tier': t } }, gemSvg(t, 'gem gem-md'), h('span', { text: label })));
    host.append(cell('six tiers on the panel', gems, { col: true }), cell('the same on white (the ink rim carries the shape)', h('div', { class: 'k-cluster' }, ...MOCK.rarities.map(([t]) => gemSvg(t, 'gem gem-md'))), { tone: 'white' }));

    host.append(sub('Jelly tier names (shelf headings, the plate)'));
    const names = h('div', { class: 'k-cluster' });
    for (const [t, label] of MOCK.rarities) names.append(jelly(label, { size: 'sm', tone: t, tag: 'span' }));
    host.append(cell('jelly sm in each tier tone', names, { col: true }));

    host.append(sub('Hold to merge: the label is a dual layer'));
    const holds: Node[] = [];
    for (const [cap, p, disabled, busy] of [['at rest', 0, false, false], ['55 % held', 0.55, false, false], ['fully held', 1, false, false], ['disabled', 0, true, false], ['busy', 0, false, true]] as const) {
      const hb = createHoldButton('Hold to merge', 500, () => {}, 'hold-btn k-btn k-cta');
      hb.el.style.setProperty('--p', String(p)); hb.el.style.setProperty('--hold', String(p));
      hb.setDisabled(disabled);
      if (busy) { hb.setLabel('Merging'); hb.el.setAttribute('aria-busy', 'true'); }
      holds.push(cell(cap, hb.el, { col: true }));
    }
    host.append(h('div', { class: 'kp-grid kp-grid--wide' }, ...holds));

    host.append(sub('Result and Tidy rows: the name keeps 12 characters of its own line, the rest wraps under it (narrow: 320 px column)'));
    const row = (species: string, tier: Tier, name: string, tail: Array<Node | null>): HTMLElement => h('li', { class: 'out', attrs: { 'data-tier': tier } }, speciesIcon(species, { cls: 'sp-icon out-icon' }), gemSvg(tier, 'gem gem-sm'), h('span', { class: 'out-name', text: name }), ...tail.filter(Boolean) as Node[]);
    const word = (t: string, cls: string): HTMLElement => h('span', { class: cls, text: t });
    const list = (rows: HTMLElement[]): HTMLElement => h('ul', { class: 'hmerge-outs kp-narrow' }, ...rows);
    host.append(grid2([
      cell('what it can become (merge pad)', list([
        row('cindergoo', 'uncommon', 'Cindergoo', [word('Uncommon', 'out-tier'), word('NEW', 'out-new'), word('12%', 'out-p')]),
        row('rattlebead', 'common', 'Rattlebead', [word('Common', 'out-tier'), word('88%', 'out-p')]),
      ]), { col: true }),
      cell('Tidy plan row (odds on their own line)', list([h('li', { class: 'out out-plan', attrs: { 'data-tier': 'common' } }, speciesIcon('rattlebead', { cls: 'sp-icon out-icon' }), gemSvg('common', 'gem gem-sm'), h('span', { class: 'out-name', text: 'Rattlebead' }), word('2 merges', 'out-tier'), word('Chance to move up to Uncommon: 20%', 'out-odds'))]), { col: true }),
      cell('Tidy result row', list([h('li', { class: 'out', attrs: { 'data-best': 'true', 'data-tier': 'rare' } }, h('span', { class: 'out-from' }, h('span', { text: 'Constello' }), icon('arrowRight', 'k-icon k-icon--sm')), speciesIcon('slumbrel', { cls: 'sp-icon out-icon' }), gemSvg('rare', 'gem gem-sm'), h('span', { class: 'out-name', text: 'Slumbrel' }), word('Rare', 'out-tier'), word('NEW', 'out-new'), word('TIER UP', 'out-up'))]), { col: true }),
    ]));

    host.append(sub('Reveal plates (static: in the game they sit top centre, or replace the bottom row on the portal phone)'));
    const plates: Node[] = [];
    const info = (tier: Tier, isNew: boolean, tierUp: boolean, copies = 2): RevealPlateInfo => ({ species: tier === 'mythic' ? 'Rattlebead' : 'Dollop', tier, isNew, copies, tierUp, nickname: null });
    for (const [cap, i] of [['Common, a spare', info('common', false, false)], ['Uncommon, NEW', info('uncommon', true, false)], ['Rare, tier up and NEW', info('rare', true, true)], ['Epic, NEW', info('epic', true, false)], ['Legendary, tier up', info('legendary', true, true)], ['Mythic, NEW', info('mythic', true, false)]] as const) {
      const box = h('div', { class: 'kp-plate-static' });
      const pl = createRevealPlate(box);
      pl.show(i);
      plates.push(cell(cap, box, { col: true }));
    }
    host.append(h('div', { class: 'kp-grid kp-grid--wide' }, ...plates));
  },
};
const grid2 = (cells: Node[]): HTMLElement => h('div', { class: 'kp-grid kp-grid--wide' }, ...cells);

// ---------- the scenes: the real Hoard at the viewport's size ----------
function scene(id: string, title: string, note: string, drive: (kh: KitHoard, stage: HTMLElement) => void, o: KitHoardOpts = {}): KitSection {
  return {
    id, title, note, bleed: true,
    build(host) {
      const stage = h('div', { class: 'kp-scene kp-hoardscene' });
      stage.style.height = `${innerHeight}px`;
      const d = Math.round(Math.min(innerHeight * 0.5, innerWidth * 0.6));
      const blob = h('div', { class: 'kp-blob' });
      blob.style.width = blob.style.height = `${d}px`;
      blob.style.left = `${Math.round(innerWidth * 0.3 - d / 2)}px`;
      blob.style.top = `${Math.round(innerHeight * 0.45 - d / 2)}px`;
      stage.append(blob);
      host.append(stage);
      const kh = makeKitHoard(stage, o);
      // driven once the page has attached every section: jelly fitting and the layout-dependent bits measure real boxes (kit.ts appends a section after build())
      queueMicrotask(() => drive(kh, stage));
    },
  };
}
const SHELF = (kh: KitHoard): void => kh.ui.open('shelf');
const withCard = (kh: KitHoard, sp: string): void => { kh.ui.open('shelf'); kh.ui.openCard(sp); };
const withPad = (kh: KitHoard, stage: HTMLElement, sp: string): void => { withCard(kh, sp); click(stage, '.hcard-merge'); };

const sections: KitSection[] = [
  parts,
  scene('hoard-shelf', 'Scene: the Hoard, shelves', 'Cabinet view: a recess per tier, lit plinths with the double-rim frame; unowned ones are dashed silhouettes. Practice note with "Got it" (one close button).', SHELF),
  scene('hoard-filters', 'Scene: filters open', 'Chips are 44 high; the Sort select keeps its id; Tidy up is the secondary button.', (kh, st) => { SHELF(kh); click(st, '[data-key="filters"]'); }),
  scene('hoard-grid', 'Scene: grid view', 'One flat grid: every plinth carries its tier word beside the gem.', (kh, st) => { SHELF(kh); click(st, '[data-key="view-grid"]'); }),
  scene('hoard-card', 'Scene: the detail card (owned, several copies)', 'The card is a right column beside the live squishy; a phone shows it as a bottom sheet. Play with this one is the gel.', (kh) => withCard(kh, kh.mergeSpecies)),
  scene('hoard-card-new', 'Scene: the detail card (not yet owned)', 'Silhouette, the odds line, the hint.', (kh) => { kh.ui.open('shelf'); kh.ui.openCard(SPECIES_BY_TIER[4][3].id); }),
  scene('hoard-gift', 'Scene: Gift tab, one picked', 'Three cards, the pick has a check mark as well as the ring; "Take this one" is the gel.', (kh, st) => { kh.ui.open('gift'); click(st, '.gift:nth-child(2)'); }),
  scene('hoard-today', 'Scene: Today tab', 'Two task cards with gel progress bars and "N of M" in text.', (kh) => kh.ui.open('today')),
  scene('merge-pad', 'Scene: the merge pad', 'Two slots (newest spares), the odds lines, every result with its chance, Hold to merge (dual-layer label).', (kh, st) => withPad(kh, st, kh.mergeSpecies)),
  scene('merge-hold', 'Scene: the merge pad, held 55 %', 'The label stays readable on both sides of the fill edge.', (kh, st) => { withPad(kh, st, kh.mergeSpecies); const b = q(st, '.hmerge .hold-btn'); b.style.setProperty('--p', '0.55'); b.style.setProperty('--hold', '0.55'); b.dataset.holding = 'true'; }),
  scene('merge-pick', 'Scene: the slot picker', 'Copies that cannot go in say why in text.', (kh, st) => { withPad(kh, st, kh.mergeSpecies); click(st, '.hmerge [data-key="slot-0"]'); }),
  scene('merge-last', 'Scene: the last-copy warning', 'A modal inside the pad, focus on Cancel.', (kh, st) => withPad(kh, st, kh.twoSpecies), { mergeCopies: 4 }),
  scene('tidy-plan', 'Scene: Tidy up (the plan)', 'Rows are name | action: the name keeps its own line, the odds sit under it.', (kh, st) => { SHELF(kh); click(st, '[data-key="tidy"]'); }),
];

export function b5Sections(): KitSection[] {
  const pl = (id: string, title: string, note: string, i: RevealPlateInfo): KitSection => scene(id, title, note, (_kh, st) => { document.body.dataset.hoard = 'closed'; const p = createRevealPlate(st); p.show(i); });
  return [
    ...sections,
    pl('plate-new', 'Scene: reveal plate, a new Uncommon', 'Top centre on wide (y 10), y 70 on stack and strip; the portal phone swaps it for the bottom row.', { species: 'Cindergoo', tier: 'uncommon', isNew: true, copies: 1, tierUp: false, nickname: null }),
    pl('plate-up', 'Scene: reveal plate, a merge that moved up', 'TIER UP + NEW.', { species: 'Constello', tier: 'epic', isNew: true, copies: 1, tierUp: true, nickname: null }),
    pl('plate-spare', 'Scene: reveal plate, a spare', '"x2 spare" instead of NEW.', { species: 'Rattlebead', tier: 'common', isNew: false, copies: 2, tierUp: false, nickname: null }),
  ];
}
void TIER_NAMES;

// bench hook (dev page only): the cost of opening the shelf (all 50 plinths) in this page, for the U08 budget (< 300 ms in the game on a quiet machine)
(window as unknown as { __b5bench: (n?: number) => { first: number; median: number; runs: number[] } }).__b5bench = (n = 5) => {
  const runs: number[] = [];
  for (let i = 0; i < n; i++) {
    const box = h('div', { class: 'kp-hoardscene' });
    box.style.cssText = 'position:fixed;inset:0;';
    document.body.append(box);
    const kh = makeKitHoard(box);
    const t = performance.now();
    kh.ui.open('shelf');
    runs.push(performance.now() - t);
    kh.ui.destroy(); box.remove();
  }
  const s = [...runs].sort((a, b) => a - b);
  return { first: runs[0], median: s[Math.floor(s.length / 2)], runs };
};
(window as unknown as { __b5parts: () => Record<string, number> }).__b5parts = () => {
  const t = (f: () => void, n = 1): number => { const a = performance.now(); for (let i = 0; i < n; i++) f(); return +(performance.now() - a).toFixed(2); };
  const ids = SPECIES_BY_TIER.flat().map((d) => d.id);
  const out: Record<string, number> = {};
  out.iconsCold = t(() => { for (const id of ids) speciesIcon(id, { cls: 'sp-icon' }); });
  out.iconsWarm = t(() => { for (const id of ids) speciesIcon(id, { cls: 'sp-icon' }); });
  out.gems50 = t(() => { for (let i = 0; i < 50; i++) gemSvg('rare', 'gem'); });
  out.glyphs100 = t(() => { for (let i = 0; i < 100; i++) icon('heart', 'k-icon', { size: 16 }); });
  out.jelly7 = t(() => { for (const w of ['Hoard', 'Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic']) jelly(w, { size: 'sm', tag: 'h3' }); });
  const box = h('div', { class: 'kp-hoardscene' }); box.style.cssText = 'position:fixed;inset:0;'; document.body.append(box);
  const kh = makeKitHoard(box);
  out.openJs = t(() => kh.ui.open('shelf'));
  out.reopenRender = t(() => kh.ui.refresh());
  out.layoutForced = t(() => { void box.getBoundingClientRect(); void (box.querySelector('.hoard-title') as HTMLElement).offsetWidth; });
  kh.ui.destroy(); box.remove();
  return out;
};
