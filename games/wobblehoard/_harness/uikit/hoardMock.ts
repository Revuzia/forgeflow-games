// A REAL Hoard UI (src/ui/hoard/panel.ts + merge.ts) over a REAL Collection seeded in memory, for the kit page (B5). Nothing is a mock but the
// HoardEnv seams to the game (the live squishy, the ceremonies, the play mat): they do nothing here. So every pixel the sheet shows is the
// production DOM and CSS, on mock DATA (a mid-game shelf: 24 species owned, spares, a hearted copy, a resting copy, a NEW one).
import { memoryStorage } from '../../src/core/settings.ts';
import { mulberry32 } from '../../src/core/rng.ts';
import { MERGE_COST, MERGE_HOLD_MS } from '../../src/core/merge.ts';
import { TIERS, TIER_NAMES, TOP_TIER_INDEX } from '../../src/core/rarity.ts';
import { LANES, SPECIES_BY_TIER, getSpecies, speciesBaseGenome } from '../../src/data/catalog.ts';
import { MATERIAL_FAMILIES } from '../../src/data/materials.ts';
import { genomePalette, linearToSrgb } from '../../src/render/oklch.ts';
import type { Rgb } from '../../src/render/oklch.ts';
import { createCollection } from '../../src/collection/index.ts';
import type { Collection, HoardItem } from '../../src/collection/index.ts';
import { HOARD_KEY } from '../../src/collection/constants.ts';
import { FLAG_FAV, FLAG_SEEN, freshHoard, makeRow, serializeHoard } from '../../src/collection/store.ts';
import { h } from '../../src/ui/dom.ts';
import { gemSvg } from '../../src/ui/gem.ts';
import { createHoard } from '../../src/ui/hoard/panel.ts';
import type { HoardUi } from '../../src/ui/hoard/panel.ts';
import type { HoardEnv } from '../../src/ui/hoard/types.ts';
import { icon } from '../../src/ui/icons.ts';
import { fitJelly, jelly, setJelly } from '../../src/ui/jelly/jelly.ts';
import type { JellyOpts } from '../../src/ui/jelly/jelly.ts';
import { speciesIcon } from '../../src/ui/speciesIcon.ts';

export const NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
const HOUR = 3_600_000;
const hex = (c: Rgb): string => '#' + c.map((v) => Math.round(Math.max(0, Math.min(1, linearToSrgb(Math.max(0, v)))) * 255).toString(16).padStart(2, '0')).join('');

export interface KitHoardOpts {
  /** how many species to own per tier (common..mythic) */
  owned?: readonly number[];
  /** copies of the first owned species of each tier (the rest get 1, every third gets 2) */
  spares?: boolean;
  /** a species with exactly this many copies for the merge scenes (default 4: a merge without the last-copy warning) */
  mergeCopies?: number;
  /** the gift of today already taken */
  giftClaimed?: boolean;
  matOut?: number;
}

export interface KitHoard { c: Collection; ui: HoardUi; env: HoardEnv; root: HTMLElement; mergeSpecies: string; twoSpecies: string; ownedSpecies: string[] }

export function makeSave(o: KitHoardOpts = {}): { json: string; mergeSpecies: string; twoSpecies: string; owned: string[] } {
  const owned = o.owned ?? [9, 5, 3, 2, 1, 0];
  const save = freshHoard(NOW, mulberry32(3));
  save.ghosts.length = 0;
  let n = 0;
  const rows: string[] = [];
  let mergeSpecies = '', twoSpecies = '';
  SPECIES_BY_TIER.forEach((list, ti) => {
    list.slice(0, owned[ti] ?? 0).forEach((d, i) => {
      const copies = ti === 0 && i === 1 ? (o.mergeCopies ?? 4) : ti === 0 && i === 0 ? 2 : i % 3 === 2 ? 2 : ti === 1 && i === 1 ? 2 : 1;
      if (ti === 0 && i === 1) mergeSpecies = d.id;
      if (ti === 1 && i === 1) twoSpecies = d.id;
      for (let k = 0; k < copies; k++) {
        let flags = FLAG_SEEN;
        if (ti === 0 && i === 0 && k === 0) flags |= FLAG_FAV;                 // a hearted keeper
        if (ti === 1 && i === 3) flags &= ~FLAG_SEEN;                          // a NEW one
        const locked = ti === 2 && i === 0 ? NOW + 20 * HOUR : 0;               // a resting one
        save.ghosts.push(makeRow(`g-${(n++).toString(36).padStart(12, '0')}`, speciesBaseGenome(d.id, n * 7 + k), NOW - (n + k) * 3 * HOUR, flags, k === 0 ? 'drop' : 'blend', locked));
        rows.push(d.id);
      }
    });
  });
  void rows;
  save.ghostMerges = { day: null, count: 0 };
  return { json: serializeHoard(save), mergeSpecies, twoSpecies, owned: [...new Set(rows)] };
}

export function makeKitEnv(c: Collection, o: KitHoardOpts = {}): HoardEnv {
  let out = o.matOut ?? 0;
  return {
    collection: c,
    kit: { glyph: (name, cls, op) => icon(name, cls, op), jelly: (t, op) => jelly(t, op as JellyOpts), setJelly: (el, t, op) => setJelly(el, t, op as Omit<JellyOpts, 'tag'>), fit: (el, w) => fitJelly(el, w) },
    species(id) {
      const s = getSpecies(id);
      if (!s) return null;
      const fam = MATERIAL_FAMILIES[s.family];
      const laneIdx = LANES.findIndex((l) => l.id === s.lane);
      return { name: s.name, blurb: s.blurb, family: fam?.name ?? '', familyBlurb: fam?.blurb ?? '', lane: LANES[laneIdx]?.name ?? '', laneIdx };
    },
    lanes: LANES.map((l) => l.name),
    tiers: TIERS.map((t) => ({ id: t, label: TIER_NAMES[t] })),
    gem: (tier, cls) => gemSvg(tier, cls),
    icon: (sp, op) => speciesIcon(sp, op),
    swatch(it: HoardItem) {
      const p = genomePalette(it.genome);
      const el = h('span', { class: 'swatch', attrs: { 'aria-hidden': 'true' } });
      el.style.setProperty('--sw-a', hex(p.glow));
      el.style.setProperty('--sw-b', hex(p.body));
      el.style.setProperty('--sw-c', hex(p.attenuation));
      return el;
    },
    mergeCost: MERGE_COST,
    holdMs: MERGE_HOLD_MS,
    topTierIdx: TOP_TIER_INDEX,
    focus: () => true,
    restore: () => {},
    playWith: () => true,
    playItemId: () => c.items()[0]?.id ?? null,
    revealClaim: async () => {},
    replayReveal: async () => {},
    playMerge: async () => {},
    busy: () => false,
    whenIdle: (fn) => fn(),
    openCapsule: async () => {},
    mat: { get count() { return 1 + out; }, limit: 3, has: () => false, refusal: () => null, bringOut: () => { out++; return null; }, putBack: () => { out = Math.max(0, out - 1); }, clear: () => { out = 0; }, onChange: () => () => {} },
    holdInput: () => {}, cover: () => {}, announce: () => {}, toast: () => {}, now: () => NOW, calm: () => false, returnFocus: () => null,
  };
}

/** A real Hoard over a seeded collection, mounted in `root` (a viewport-sized scene whose transform makes its fixed children relative to it). */
export function makeKitHoard(root: HTMLElement, o: KitHoardOpts = {}): KitHoard {
  const seed = makeSave(o);
  const storage = memoryStorage({ [HOARD_KEY]: seed.json });
  const c = createCollection({ storage, now: () => NOW, random: mulberry32(11), setTimer: () => 0, clearTimer: () => {}, throttleMs: 1e9 });
  const env = makeKitEnv(c, o);
  const ui = createHoard(root, env);
  return { c, ui, env, root, mergeSpecies: seed.mergeSpecies, twoSpecies: seed.twoSpecies, ownedSpecies: seed.owned };
}
